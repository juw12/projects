# The 10 Hardest Trust Problems in a CI Runner
## Mechanism, Canonical Defense, and a Verified Real-World Incident for Each

**Audience:** an architect building the runner + runner protocol for **OpenForge** (a self-hosted GitHub competitor, TypeScript stack).

**Why a runner is the single most dangerous node you will ship.**
A CI runner is, by definition, a machine that **executes untrusted code** while **holding your most sensitive credentials** and (often) sitting on a **trusted network path** to production. It is the one component where "arbitrary code execution by a stranger" is a *feature*, not an intrusion. Every trust decision a runner makes is therefore a trust decision *for the whole org*: what a build job may read, what it may write, what it may reach over the network, and what state survives after the job ends.

**The ten problems are ten ways a runner crosses a trust boundary the wrong way.** Each one below is framed the same way so you can pattern-match them onto your protocol design:

1. Runs **low-trust code in a high-trust context** (problems 1, 4, 5, 6).
2. Persists **high-value state past the job** that needed it (problems 3, 10).
3. Treats a **mutable reference as evidence** (problems 2, 5, 9).
4. Lets a **low-trust actor consume a shared, metered, or networked resource** (problems 2, 7, 8).

For each problem this document gives three things:

- **Mechanism** — the actual data flow that gets compromised, with the specific kernel calls, env vars, files, and identifiers involved.
- **Defense** — what the industry does today, with the governing source (NIST / CIS / CISA / vendor).
- **Citation** — **one verified real incident from 2020–2026** (CVE + vendor + date, or postmortem URL + date), in the format `Date | Source | URL | one-sentence description`.

**Verification note (fail-loud, not fail-silent).** Every citation below was confirmed against a live source during the authoring session. Two caveats are stated explicitly rather than papered over:

- **Problem 8 (CircleCI):** the Dec 2022 incident was a **CI-platform** compromise (stolen engineer SSO session → the vendor's *own* production → customer secrets), **not** literally a tenant runner pivoting through a VPC. It is still the canonical CI lateral-movement lesson; it is described accurately, not stretched.
- **Problems 7 and 10:** the strongest *real* evidence are GitHub incident reports / PRs / commits, not vendor-dated postmortems. They are cited with their real URLs and the date is marked as a best-attestation from the artifacts, rather than a fabricated precise date.

No citation was invented. A wrong CVE is worse than no citation, so where a number could not be verified it is omitted.

---
---


## 1. Container escape from the CI runner

> **Trust boundary crossed:** untrusted build code → runtime/namespace boundary → host kernel & filesystem → every other tenant and the CI host.

### Mechanism

A CI runner is almost always a container (or a set of containers) on a shared host, and the entire trust model rests on one assumption: the process running the user's build **cannot see or write the host**. That assumption fails in two independent ways.

The first is a **bug in the isolation runtime**. runc, the reference OCI runtime, forks, sets up namespaces and cgroups, then `execve()`s the user entrypoint. In CVE-2024-21626 an internal file descriptor (a handle to the host's `/sys/fs/cgroup`) was leaked into the containerized process. If the attacker can make the container's working directory resolve *through* that fd — a symlink to `/proc/self/fd/N` — then `pid 1` ends up with a cwd in the **host mount namespace** and can read/write the entire host filesystem. Variants use the `/proc/<pid>/exe` magic link to **overwrite a host binary** (the same primitive as the original CVE-2019-5736), so that the next time a privileged user runs that binary on the host, the attacker is root. The kernel-level siblings are CVE-2022-0847 ("Dirty Pipe," an unprivileged write primitive used to clobber the runc binary in the page cache) and CVE-2022-0185 (a `fs_context`/`legacy_parse_param` heap overflow triggered via the `fsconfig(2)` syscall).

The second is **over-granted privilege, no bug required**. A job run `privileged`, with `CAP_SYS_ADMIN`, or with `/var/run/docker.sock` mounted needs no vulnerability at all: it can spawn a privileged container, or `chroot`/`pivot_root` out, because the kernel already granted it host capabilities. Note CVE-2022-0185 is specifically the "CAP_SYS_ADMIN abuse" branch — the `fsconfig` path is only reachable with `CAP_SYS_ADMIN`, and in a container `unshare(CLONE_NEWNS|CLONE_NEWUSER)` can mint exactly that. The compromised data flow is: untrusted build code → runtime/namespace/capability boundary → host → co-tenant workloads and the CI host.

The compromised data flow:

```
untrusted build step
   -> runc init (leaked fd / CAP_SYS_ADMIN / docker.sock mount)
   -> host mount namespace OR host /proc/<pid>/exe
   -> host filesystem + host kernel
   -> every other tenant + CI host
```

### Defense

Treat the runner as untrusted-by-default and enforce the boundary with **multiple** layers, never one. Drop all ambient capabilities (never `privileged`, never `CAP_SYS_ADMIN`), run as non-root with `allowPrivilegeEscalation: false`, apply a `runtime/default` seccomp profile plus an AppArmor/SELinux policy, and enable **user namespaces** so a CAP_SYS_ADMIN grant inside a user namespace is powerless on the host. Never mount `docker.sock` or the host root into a build job; if the job must orchestrate containers, go through a scoped gate (sysbox/nerdctl proxy) rather than the raw socket. Patch the runtime (runc >= 1.1.12) and keep kernel CVEs current.

- **CIS Docker Benchmark v1.6** — least-privilege container configuration (no privileged, no dangerous mounts, read-only root where possible).
- **CISA / NSA Kubernetes hardening guidance** — seccomp, Pod Security Admission, user namespaces.
- **Kubernetes Pod Security Admission** — `runAsNonRoot`, `allowPrivilegeEscalation: false`, seccomp `RuntimeDefault`.

**OpenForge design implication:** the runner's default posture is non-root, no caps, seccomp + LSM on, **no host mounts**, and ephemeral. "Privileged" must be an explicit, per-workflow, reviewer-gated opt-in, not a runner flag anyone can flip.

### Citation

- **Date:** 2024-01-31 (disclosure); fixed in runc 1.1.12
- **Source:** Open Container Initiative — runc (GHSA-xr7r-f8xq-vfvv); corroborated by CERT-EU advisory 2024-016
- **URL:** https://github.com/opencontainers/runc/security/advisories/GHSA-xr7r-f8xq-vfvv
- **One-sentence description:** CVE-2024-21626 (CVSS 8.6) is a runc container-breakout from an internal file-descriptor leak that let a container's working directory resolve into the host mount namespace and (via `/proc/<pid>/exe`) overwrite host binaries, fixed in runc 1.1.12.

*Lineage for the same class:* CVE-2019-5736 (runc `/proc/self/exe` overwrite — the original), CVE-2022-0847 (Dirty Pipe — unprivileged write, Datadog PoC, 2022-03), CVE-2022-0185 (kernel `fs_context`, needs CAP_SYS_ADMIN, 2022-01-18, Sysdig/CrowdStrike).

---

## 2. Cache poisoning across builds / branches

> **Trust boundary crossed:** low-trust fork-PR job writes to a cache entry that a high-trust default-branch job later restores.

### Mechanism

Build caches exist to carry state (dependency stores, build outputs, toolchains) from one run to the next so the next run is fast. That makes the cache **shared mutable state that crosses trust boundaries**: an entry written by a low-trust job can be *restored* by a high-trust job whenever the **key matches**. On GitHub the cache is **scoped by branch** — an entry is readable by its own branch and its children, and entries created on the **default branch are readable by every branch**. The key is usually `runner.os + hashFiles('**/lockfile')`, and the default-branch key is predictable and stable.

The attack: a fork's `pull_request_target` workflow runs **in the base repository's context**, so even though it is "low trust" it can *write* to the default-branch cache scope (the job's `permissions:` block governs the GitHub API, **not** the cache API — the cache write happens in `actions/cache`'s post-run step using `ACTIONS_CACHE_URL` + `ACTIONS_RUNTIME_TOKEN`). The job checks out the attacker's code, and that code (or a branch name interpolated into a shell step) writes a poisoned entry — e.g., a tampered pnpm/`node_modules` store with a malicious `postinstall` — under the exact key the release pipeline restores. Hours later the trusted release build on `main` restores that entry and executes the attacker's code *inside the maintainers' own privileged pipeline*, from which it lifts the runner's OIDC token and publishes under valid provenance. The compromised data flow: fork PR (untrusted) → cache write in default-branch scope → trusted release job restores cache → code execution + secret/OIDC theft in a privileged context. **The cache is not storage; it is a channel.**

```
fork PR (pull_request_target, runs in base-repo context)
   -> actions/cache save  (key = main's release key, scope = refs/heads/main)
   -> [poisoned store persisted for days, token already dead]
   -> release.yml on main restores same key
   -> malicious postinstall runs in privileged context
   -> lifts /proc/<pid>/mem OIDC token -> publishes malicious package
```

### Defense

The rule, articulated by Adnan Khan and later enforced by GitHub, is: **never run untrusted code in the default-branch context when any workflow uses a cache, and never let a low-trust trigger *produce* cache entries that a high-trust trigger consumes.** Concretely:

- Scope cache **writes** to trusted triggers only (`push`, `schedule`, `workflow_dispatch`, `repository_dispatch`); make low-trust triggers (`pull_request_target`, fork `workflow_run`) **read-only** against the default-branch cache.
- Use `restore-keys` that **cannot be influenced by untrusted input**.
- Treat a cache entry as **untrusted input** (it can carry executable dependencies), not a trusted artifact — scan/verify on restore.

GitHub shipped exactly this on **2026-06-26**: low-trust triggers now get **read-only** access to the default-branch cache scope, and a save attempt fails with a warning while the job continues.

- **Source (research):** Adnan Khan, *"The Monsters in Your Build Cache"* (2024-05-06) and *"Turning ... into a Supply Chain Compromise of Angular ..."* (2026-03-03).
- **Source (vendor):** GitHub Actions cache documentation + the 2026-06-26 default-branch cache scope change.

**OpenForge design implication:** make cache scope a **first-class trust attribute of the job**, and have the cache API *reject* writes from low-trust runs **by construction** (the token literally cannot write the scope), not by a convention a workflow author can ignore. Also: a cache **write** should be an auditable event (who/what/run/commit), which GitHub does not currently record.

### Citation

- **Date:** 2024-12-04 to 2024-12-07
- **Source:** Ultralytics YOLO (PyPI) supply-chain compromise
- **URL:** https://csoh.org/breaches/ultralytics-cache-poisoning.html
- **One-sentence description:** A `pull_request_target` workflow checked out and ran code from a fork PR with cache-write scope, poisoned a GitHub Actions cache entry, and the project's own release pipeline later restored it — shipping four malicious YOLO releases (8.3.41–8.3.46) carrying an XMRig Monero miner to PyPI (8.3.45/46 published via an unrevoked pre-Trusted-Publishing token).

*Follow-on (2026):* The **TanStack** compromise (2026-05-11) reused the identical primitive — a fork PR's `pull_request_target` job wrote a poisoned pnpm store into the `refs/heads/main` cache scope, the release workflow restored it, the malicious postinstall lifted the runner's OIDC token from process memory, and **84 npm versions across 42 `@tanstack/*` packages shipped under valid SLSA provenance** (Safedep / RWX / Trackr reconstructions).

---

## 3. Secret exfiltration via workflow logs (masking failures)

> **Trust boundary crossed:** a secret (env var) → transformed/dumped by a job → an **unmasked** log line → the log is the exfil channel → run deleted.

### Mechanism

CI platforms inject secrets as environment variables and then apply **log masking**: any log line containing the *exact* secret value is replaced with `***`. The fatal design error is treating this as a **security control**. Masking is a redaction of the exact string; it does nothing against an actor who controls the code and can transform the value *before* it reaches stdout. Encode it (base64, base32, hex, double-encoded), split it across lines, reverse it, or dump the whole environment (`printenv`, `toJSON(secrets)`), and the masker never matches, so the secret prints in clear. GitHub's own docs concede this: redaction is **not guaranteed**, and a transformed value must be separately registered to be masked.

The second, deeper problem is that **the log itself becomes the exfiltration channel**. The actor does not even need outbound network access: the attacker (or their stolen token) can simply **download the run log through the platform API**, and then **delete the run** for anti-forensics. The secret left through the platform's own *trusted* logging path — the one place egress filters, allowlists, and DLP never look. This is the "no C2 to block" property that makes the Gheist campaign so hard to stop at the network layer. The compromised data flow: secret (env var) → transformed/dumped by a workflow step → unmasked log line → log downloaded via API → run deleted. "We masked it" is not a mitigation; it *is* the bug.

```
job reads $SECRET (in scope)
   -> echo "$SECRET" | base32        # masker never matches the encoding
   -> printed to workflow log (no egress needed)
   -> attacker downloads log via API (stolen token / repo read)
   -> attacker deletes the run
   -> secret gone from logs, already in attacker's hands
```

### Defense

The corrected posture is to **stop treating logs and masking as a security boundary**:

- **Least-privilege secret scoping** — a job gets only the secrets it needs, via Environments with Required Reviewers, so a low-trust job simply *cannot read* the high-value ones. This is the real control; masking is a convenience for accidental logging, not a defense.
- **Egress filtering / CI-EDR on the runner** — block or alert on outbound to unknown hosts; detect `printenv`/`env` sweeps and reads of `/proc/*/environ`.
- **Log integrity + non-self-serviceable retrieval + non-deletable audit** — retained, append-only run logs; alert on run deletion; make log download go through an audited endpoint, not an unfiltered `GITHUB_TOKEN` read.

- **Source (vendor):** GitHub *"Secure your workflows"* — secret masking explicitly "not guaranteed."
- **Source (research):** Wiz Research, Gheist analysis (2026-10).

**OpenForge design implication:** never grant a job both *read* access to a secret **and** an unfiltered, self-serviceable path to download its own logs. Log retrieval must be a separate, audited, non-self-serviceable capability, and "print-then-delete-run" must be an alert, not a silent success.

### Citation

- **Date:** Campaign tracked since 2026-09-15; publicly reported 2026-10-25/26
- **Source:** Wiz Research — "Gheist" campaign (The Hacker News / CSO Online coverage)
- **URL:** https://thehackernews.com/2026/10/gheist-uses-stolen-github-tokens-to.html
- **One-sentence description:** "Gheist" used stolen GitHub tokens to plant a `sync-check` workflow that printed every readable secret **base32-encoded** (bypassing verbatim masking) into the run log, then downloaded the log through the GitHub API and deleted the run — 13,500+ planted branches across 850+ compromised accounts, succeeding in private and GitHub-Enterprise repos.

---

## 4. "Pwn Request" — malicious PR from a fork running with secrets

> **Trust boundary crossed:** untrusted fork head-code executed inside a high-privilege job that holds base-repo secrets and a write-scope token.

### Mechanism

The single most common CI footgun, and the root of a large fraction of real breaches. A workflow triggered on **`pull_request_target`** runs the **base repository's** workflow file **with the base repository's secrets and a `GITHUB_TOKEN` that often has write scope** — but it frequently also **checks out and executes code from the PR's head** (the fork). That combination is fatal: an external attacker, with **zero prior access**, opens a PR from a fork whose code, when run, executes inside a high-privilege job that can read every secret.

Exfiltration then needs no network: the fork code can serialize `toJSON(secrets)` / dump the environment, or exploit a **script-injection** bug where an attacker-controlled *branch name* escapes its literal context and runs arbitrary expression/JavaScript, printing secrets to logs or out to a collaborator endpoint. In the Grafana case the attacker crafted a branch name that broke out of the expression context and exfiltrated two GitHub-App secrets (`..._APP_ID`, `..._APP_PEM`). Once one high-value credential (a GitHub-App private key) is out, the attacker mints a token, **pushes a second, malicious workflow** into the trusted repo (`hrgqavynjp`) that serializes *all* secrets, AES-256-CBC encrypts them, RSA-encrypts the key to a hardcoded public key, and uploads both as artifacts — and can pivot to publishing tampered releases. The compromised data flow: fork PR (untrusted head code) → `pull_request_target` job (base secrets + write token) → script injection / secret dump → attacker credential → malicious workflow pushed / supply-chain tampering.

```
attacker fork:  branch name  =  'x${{ toJSON(secrets) }}'   (script injection)
   -> PR opened -> pull_request_target fires (base repo context)
   -> job has GRAFANA_DELIVERY_BOT_APP_ID / _PEM + write GITHUB_TOKEN
   -> expression evaluates, secrets printed / sent
   -> attacker mints GitHub-App token -> pushes hrgqavynjp workflow
   -> hrgqavynjp serializes all secrets -> AES -> RSA(key) -> uploads artifacts
```

### Defense

The rule of thumb (GitHub's, and every incident's lesson): **treat fork PRs as untrusted input and never run their code in a privileged context.**

- Prefer the **`pull_request`** trigger (runs the merge ref with **no secrets** and a read-only token) over `pull_request_target`.
- If you must use `pull_request_target` (e.g., to post a status comment), **never check out `github.head_ref`** and never run head-side scripts; pin the checkout to the immutable `head_sha`/base ref.
- Constrain the `GITHUB_TOKEN` with an explicit `permissions:` block (default read-only).
- Put high-value secrets in **Environments with Required Reviewers** so any job touching them halts for a human; require PR approvals before privileged runs.

- **Source (vendor):** GitHub *"Secure your workflows"* (`pull_request` vs `pull_request_target`, token permissions).
- **Source (research):** the GHSA advisories and the StepSecurity / Orca write-ups that followed these incidents.

**OpenForge design implication:** the default, out-of-the-box behavior for a fork PR must be **no base secrets + no head checkout**. Privilege must be an explicit, per-workflow, reviewer-gated opt-in that a PR author cannot grant themselves.

### Citation

- **Date:** 2025-04-26 (disclosure)
- **Source:** Grafana Labs — GitHub Actions security incident (StepSecurity write-up)
- **URL:** https://www.stepsecurity.io/blog/grafana-github-actions-security-incident
- **One-sentence description:** An unauthorized actor exploited a `pull_request_target` workflow (`pr-patch-check-event.yml`) in `grafana/grafana`, used a crafted branch name to trigger script injection, exfiltrated two GitHub-App secrets, and then used the stolen token to push a malicious `hrgqavynjp` workflow that AES-encrypted all repo secrets and uploaded them as artifacts.

*CVE-verified reference for the same class:* **CVE-2025-61671** (CVSS 9.3), assigned by Microsoft to `microsoft/symphony` after Orca's "Pull Request Nightmare" research showed a single fork PR could gain `contents:write` via `pull_request_target` and push malicious code to the origin repo.

---

## 5. TOCTOU on source checkout (the ref moves between approval and build)

> **Trust boundary crossed:** a reviewed immutable commit A is replaced, at build time, by a mutable ref that now resolves to untrusted commit B.

### Mechanism

"Time-of-check to time-of-use" on the **source of truth**. A maintainer (or an approval bot) validates **commit A** — a specific, immutable SHA. But the privileged job that later builds, signs, or publishes does not consume that SHA; it re-resolves a **mutable reference** (a branch name, the PR head, or a tag) and gets **commit B**, because the attacker pushed, force-pushed, or moved the tag in the window between the check and the use. The approval is real but its *subject changed*. Two concrete shapes:

1. **Tag override.** `uses: org/action@v44` means "whatever `v44` points to *at run time*." `git push --force --tags` moves the tag to a malicious commit. Because CI does a **clean-room fresh clone** on every build, it silently picks up the moved ref — a local clone would *not* update its tags on `fetch`, which is exactly why the attack hides from a maintainer reviewing on their machine.
2. **Bot-delegated race.** A comment like `/ok to test` triggers an authorized bot that has `contents:write` (and, fatally, `workflow:write`). In the split-second before the bot snapshots the PR HEAD, the attacker **force-pushes a malicious workflow** to the fork; the bot copies it into a trusted in-repo branch; the attacker then **reverts the fork to the reviewed SHA** — a "perfect crime" that leaves the PR review UI showing clean code while the malicious workflow sits in the trusted repo.

The compromised data flow: reviewed commit A (trusted) → mutable ref re-resolved at build time → malicious commit B (untrusted) → privileged job builds/signs/publishes the wrong bytes.

```
maintainer reviews commit A (SHA a3af57c...)
   -> [attacker force-pushes branch to 24da6f5...]
   -> privileged job: runtime_sha = git ls-remote origin refs/heads/pr-17   # = 24da6f5
   -> job builds 24da6f5 (the unreviewed commit), not the approved a3af57c
```

### Defense

Pin **intent to an immutable object** and check out the exact triggering SHA, **failing closed** on any mismatch:

- Store the *approved* SHA and, at the privileged step, compare it against the ref you are about to build; if they differ, **abort** (`git checkout --detach "$approved_sha"`; refuse if `runtime_sha != approved_sha`).
- Consume the immutable `head_sha` / `base_ref` from the **triggering event payload** as the authoritative envelope; never a branch name ("a branch name is navigation, not evidence").
- Prefer **`pull_request_review`** (submitted) over `issue_comment`: it atomically bundles the approver's comment **and** the exact `commit_id` they were viewing, so intent and code state come from one trusted event and the race disappears.

- **Source (research/controls):** Boost Security Labs, *"Split-Second Side Doors"* (2025-11-12).
- **Source (vendor):** GitHub Actions event-payload documentation.

**OpenForge design implication:** make "the SHA the job was approved for" a **non-negotiable input to the build**, and have the checkout step *verify* the resolved ref equals it before executing. A tag or branch name must never be the unit of trust.

### Citation

- **Date:** 2025-11-12
- **Source:** Boost Security Labs — *"Split-Second Side Doors: How Bot-Delegated TOCTOU Breaks The CI/CD Threat Model"*
- **URL:** https://labs.boostsecurity.io/articles/split-second-side-doors-how-bot-delegated-toctou-breaks-the-cicd-threat-model/
- **One-sentence description:** A `/ok to test` comment-triggered bot with `workflow:write` let an attacker force-push a malicious `pull_request_target` workflow to the fork in the race window, which the bot copied into a trusted in-repo branch (then reverted to the reviewed SHA) — NVIDIA remediated by pinning approval to an explicit immutable `/ok to test <COMMIT_SHA>`.

*Related, dated mechanism reference:* Scale Factory, *"Compromise by Git Tags"* (2021-02-18, https://scalefactory.com/compromise-by-git-tags/) — a `v0.1` tag silently moved to a compromised commit is picked up by clean-room CI (fresh clone) while a local clone stays safe; the fix is to reference the immutable commit SHA, not the tag.

---

## 6. Supply chain — malicious / compromised third-party actions

> **Trust boundary crossed:** a trusted-looking `uses:` line resolves, at run time, to attacker-controlled code in a job that holds your secrets.

### Mechanism

A workflow line like `uses: org/action@version` is **remote code execution the author trusts implicitly**. The threat has two halves.

**Compromised maintainer.** The action's *own* repository is breached — a stolen bot PAT, a too-large contributor/maintainer team, or a leaked CI token — and a malicious commit is pushed to the tag the world pins to. Because CI freshly resolves that tag to the *current* commit **at run time**, every consumer that runs in the vulnerable window executes the attacker's code. In the 2025 action-compromise family the payload reads the runner worker's process memory for entries matching `...isSecret:true`, **double-base64-encodes them and prints them to the (public) workflow logs**, and/or runs an attacker-hosted gist script. The maintainer's only "backdoor" was the size of their trusted-access team (reviewdog's `action-*` contributor team had 118 members at the time — a larger surface for a single compromised account).

**Look-alike / typosquat.** An attacker registers a near-identical action name and hopes a typo — or a `renovate`-style auto-bump — pulls it in; the action's `action.yml` / entrypoint / `postinstall` then contains a hidden `curl | bash` to a C2. Either way the compromised data flow is: trusted-looking `uses:` line → tag resolved to a malicious commit at run time (or a typosquatted name) → attacker code in a job that holds your secrets → secret dump to logs / C2 / downstream supply chain.

```
workflow:  uses: org/action@v44        # "trusted" line, mutable ref
   -> CI resolves v44 at run time -> compromised commit (or typosquatted name)
   -> action entrypoint runs in a job holding GITHUB_TOKEN + secrets
   -> reads /proc/<worker-pid>/mem for isSecret:true entries
   -> double base64 -> printed to public log   (and/or curl | bash to C2)
```

### Defense

CISA and GitHub converge on the same controls:

- **Pin every third-party action to a full, immutable 40-char commit SHA** (never a mutable tag / `@latest`), so a maintainer breach or tag-move cannot change what you run.
- **Verify provenance** — require a signed **SLSA provenance / Sigstore** attestation for actions and artifacts; reject unsigned.
- **Audit third-party action source** (it is remote code you import; review what the entrypoint / `postinstall` actually does).
- **Least-privilege** the token so a compromised action's blast radius is small.
- **Monitor for the double-encoded-base64 log signature** that the 2025 compromises left behind (a long unbroken base64 blob of 60+ chars in a step that should not produce one).

- **Source (authority):** CISA alert 2025-03-18 (CVE-2025-30066 / CVE-2025-30154).
- **Source (vendor):** GitHub *"Hardening your workflow / pinning action versions."*

**OpenForge design implication:** default to SHA-pinning, and make a first-party **action-signing + provenance gate** (SLSA L3+ / Sigstore) a *requirement* for an action to run in a privileged job, not an opt-in. A `uses:` you cannot verify provenance for should be refused, not warned about.

### Citation

- **Date:** 2025-03-18 (CISA alert); action compromised 2025-03-14, patched v46.0.1
- **Source:** CISA — *"Supply Chain Compromise of Third-Party tj-actions/changed-files (CVE-2025-30066) and reviewdog/action-setup@v1 (CVE-2025-30154)"*
- **URL:** https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- **One-sentence description:** The widely used `tj-actions/changed-files` action was compromised (via a stolen bot PAT) and backdoored to dump runner-memory secrets as a double-encoded base64 blob into public workflow logs, and the compromise was potentially enabled by the simultaneously-compromised `reviewdog/action-setup@v1` — CISA advised auditing all runs in the 2025-03-12 → 15 window and rotating every exposed secret.

---

## 7. Resource exhaustion / DoS via an expensive or runaway workflow

> **Trust boundary crossed:** an untrusted/abusive workflow consumes a shared, metered, or host-level resource — and the cost lands on other tenants and the platform.

### Mechanism

A runner has finite disk, CPU, memory, and — on a metered or self-hosted pool — a finite **quota and concurrency**. A workflow can burn any of them, and on a *shared* pool that is an availability attack, not just a slow build. Three live shapes:

- **Disk-fill.** A job writes until the runner's filesystem is full. On GitHub-hosted runners the recurring killer is the runner's **own** `_diag/Worker_*.log` filling the root volume; after that the runner process dies mid-step, the step never records completion, and the job hangs until the backend force-fails it — and *unrelated* jobs in the same environment fail the same way, which masquerades as a flaky test. (The fix in the wild was to relocate Docker's `data-root` and `GOCACHE`/`GOMODCACHE` off `/` and strip preinstalled toolchains to reclaim ~20–30 GB.)
- **Run-forever.** A job with no effective timeout (a `while true`, a stuck build, a wedged container) occupies a slot up to the platform's max — GitHub caps each **job at 6 hours** — and a burst of them exhausts the queue.
- **Quota / concurrency flood.** A low-trust actor (a fork, or a compromised `workflow_dispatch`/`repository_dispatch` webhook) triggers thousands of runs; without `concurrency.group` + `cancel-in-progress: true`, superseded builds pile up in the queue and drain the entire plan's minutes.

The compromised data flow: untrusted/abusive workflow → runner pool (disk / CPU / mem / quota) → **other tenants' and the platform's own availability** (and, on a persistent self-hosted host, the ability to fill disk and crash co-resident jobs).

```
low-trust job (fork PR / dispatch)
   -> writes until / is full  (or while-true, or floods the queue)
   -> _diag/Worker log hits 100% of root
   -> runner process crashes mid-step; step never completes
   -> unrelated jobs on the same environment fail identically (looks "flaky")
```

### Defense

Make availability a **per-job, enforced** property, not a hope:

- **Job timeouts** — GitHub hard-caps each job at 6 h; set tighter `timeout-minutes` per job so nothing runs forever.
- **`concurrency.group` + `cancel-in-progress: true`** — superseded builds don't queue and starve the pool.
- **Disk quotas, ephemeral volumes, and monitoring/alerting** — a check that alerts at 85% rather than dying at 100%; relocate caches off the root volume.
- **Self-hosted:** cgroup/CPU/mem limits per job and a hard concurrency cap matching real workload.

The structural fix is **ephemeral runners** (a fresh, destroyed-after-each-job machine) — then one tenant's exhaustion physically cannot bleed into another's, which is exactly the property a *self-hosted* runner must provide by default, since the operator (not the user) is who would otherwise eat the DoS.

- **Source (vendor):** GitHub Actions docs (`timeout-minutes`, `concurrency`).
- **Source (benchmark):** CIS Kubernetes Benchmark (container resource requests/limits).

**OpenForge design implication:** bound disk/CPU/mem/quota **per job** and **isolate tenants** with ephemeral execution; a fork PR must not be able to degrade the pool that a paying tenant's build depends on.

### Citation

- **Date:** 2025 (incident report; GitHub-hosted runner 2.334.0)
- **Source:** opendatahub-io/notebooks — GitHub issue #3641 (corroborated by sei-protocol/sei-chain commit `703e48d`)
- **URL:** https://github.com/opendatahub-io/notebooks/issues/3641
- **One-sentence description:** Real GitHub-hosted runners crashed with `System.IO.IOException: No space left on device` on the runner's own `_diag/Worker_*.log` (root volume full) during heavy hermetic builds, killing the runner mid-step and hanging unrelated jobs — a live, recurring disk-exhaustion DoS that the sei-chain team fixed by relocating Docker/Go caches off `/` and stripping preinstalled toolchains.

*Honesty note:* this is a real, observed runner-exhaustion incident (an **availability** failure mode), cited as live proof that "fill disk / run forever / flood the queue" is not theoretical. A low-trust fork PR trivially weaponizes the same primitive, because fork PRs trigger workflows on the same runner pool — which is why a self-hosted runner must bound resources per job and isolate tenants with ephemeral execution.

---

## 8. Lateral movement — a CI node on a trusted network path to internal services

> **Trust boundary crossed:** a high-trust CI node (runner or platform) that holds deployment credentials and has network reach into prod becomes a pivot origin.

### Mechanism

A CI system is a **high-trust node**: it holds your deployment credentials, cloud tokens, and API keys, and it is frequently placed — by necessity, so it can deploy — on a **network path that can reach production systems, internal APIs, and metadata services**. The threat is that *any* compromise of that node (a breached tenant's job, a compromised runner, or — as in the canonical case — the platform itself) becomes a **lateral-movement origin**: the attacker pivots from the CI node into the internal services it can reach, using the credentials it holds.

In the CircleCI incident the attacker reached the CI *platform's* production (via a stolen 2FA-backed SSO session) and from there exfiltrated **customer environment variables, tokens, and keys** — and, critically, extracted the **encryption keys from a running process**, so even data that was encrypted at rest was readable. Fewer than five customers had yet reported downstream unauthorized access at the time of the detailed postmortem, but CircleCI told every customer to **assume their secrets were accessed** and rotate everything. The lesson transfers directly to a runner on a VPC: a runner that has **default network reach to prod**, or that **holds long-lived prod credentials**, means *compromise the runner = compromise prod*. The compromised data flow: CI node (runner or platform) → trusted internal network path / held deployment credentials → production systems & internal services → data/credential exfiltration.

```
CI node (runner / platform)  --holds-->  deploy creds, cloud tokens, API keys
   |
   +--> default network reach --> prod VPC / internal APIs / IMDS
   |
   [compromise the node]
   +--> pivot using held creds --> exfil data + keys (incl. from running process)
```

### Defense

Apply **Zero Trust** to the runner, per **NIST SP 800-207**:

- **No default reach** into production or internal segments — place the runner in an isolated subnet/VPC with an **egress allowlist** (it may talk to the build registry and the specific deploy target it needs, nothing else).
- **Eliminate long-lived prod credentials from CI** — use short-lived, workload-identity-based tokens (OIDC/STS) minted per job that expire in minutes, so a compromised runner holds nothing durable.
- **Ephemeral, least-privilege runners** and **secret isolation** (per-job, per-environment scoping with required reviewers).
- **Microsegmentation + mTLS** between the runner and any internal service it legitimately reaches; monitor the runner's egress for anomalies.

- **Source (framework):** NIST SP 800-207 (Zero Trust Architecture).
- **Source (guidance):** CISA "Secure Your Secrets" / CI-CD hardening; GitHub self-hosted runner security guidance.

**OpenForge design implication:** the runner's **default** network policy should be **egress-deny**; network reach to internal services must be an explicit, scoped, audited grant per workflow — never a default that "works because it's on the corp network."

### Citation

- **Date:** Exfiltration 2022-12-22; disclosure 2023-01-04 (detailed postmortem 2023-01-13)
- **Source:** CircleCI — incident report & security alert
- **URL:** https://circleci.com/blog/jan-4-2023-incident-report/
- **One-sentence description:** Malware on a CircleCI engineer's laptop (2022-12-16) stole a 2FA-backed SSO session, letting an unauthorized third party impersonate the engineer, escalate into CircleCI's production systems, and exfiltrate **customer environment variables, tokens, and keys** (and the encryption keys from a running process) — CircleCI then rotated all GitHub OAuth / Project / Personal API tokens and urged every customer to assume their secrets were accessed.

*Accuracy note:* this was a **CI-platform** compromise (attacker → vendor's own production → customer secrets), **not** literally a tenant runner pivoting through a VPC. It is nonetheless the canonical demonstration of the underlying threat — that a CI system is a high-trust node holding your deployment credentials, and that compromising that node (or the platform) is a lateral-movement origin into everything those credentials can reach. The same reasoning is why a *self-hosted* runner with default prod-VPC reach must be treated as a first-class lateral-movement vector.

---

## 9. Artifact tampering (substituted / unverifiable build & dependency artifacts)

> **Trust boundary crossed:** a trusted identifier (tag / filename / hash) is resolved, between two stages, to attacker-controlled bytes.

### Mechanism

A build is only as trustworthy as the artifacts it consumes and produces, and most pipelines reference those artifacts by a **mutable identifier** — a tag, a filename, a path in a bucket prefix, a version number — and rarely verify that what they received is what was produced or expected. That opens a **substitution window** between any two stages: anyone with write access to the intermediate store (a compromised robot account, a leaked registry token, a hijacked mirror, or — in the canonical case — a stolen signing key) can **replace the artifact** so the downstream stage pulls the attacker's bytes.

The **Codecov** incident is the textbook form. The attacker extracted an **HMAC key from an intermediate layer of a public self-hosted Docker image** (the image had not been squashed/multi-stage, so the layer with the key was pullable), used that key to **modify the Bash Uploader artifact in Google Cloud Storage**, and that tampered uploader was then served to **every** user of the uploader / GitHub Action / CI orb — a mass, silent artifact substitution. It was only caught because a customer independently computed the **SHA256** of the downloaded file and found it **mismatched** the published hash. The same class covers **mirror poisoning** (a dependency mirror serves a tampered library and the checksum file is updated to match) and **registry tag swap** (a signed image tag is re-pointed so the signature no longer matches the bytes). The compromised data flow: trusted identifier (tag/filename/hash) → attacker-controlled intermediate store → substituted artifact → downstream stage executes/deploys the attacker's bytes (with the hash, if attacker-controlled, "validating" it).

```
trusted identifier (tag / filename / published SHA256)
   -> [attacker writes to intermediate store (GCS / registry / mirror)]
   -> substituted artifact (same name, different bytes)
   -> downstream stage pulls by name -> executes attacker's bytes
   (detected only when an OUT-OF-BAND SHA256 did not match)
```

### Defense

The root fix is to **replace mutable references with content-addressed, out-of-band-verified ones, and never trust a hash that lives next to the artifact it is supposed to protect**:

- Verify each artifact's **hash *and* signature against a trusted source the attacker does not control**.
- Prefer **content-addressed digests** — a SHA-256 is immutable by content; any bit change changes the digest.
- **Sign artifacts** with **Sigstore/cosign** and attach **SLSA provenance**; *reject* artifacts with missing/invalid signatures.
- For intermediate stores, use **object versioning + MFA delete** and **separate write permissions** for the artifact vs. its digest/signature file, so one write cannot update both.

- **Source (incident/fix):** Codecov April 2021 postmortem (detection = SHASUM mismatch; fix = signed, SHASUM-verifiable binary + GCP layer alerts + squashed/multi-stage images).
- **Source (standard):** SLSA / Sigstore.

**OpenForge design implication:** artifacts must be addressed by **digest**, **signed at the producing stage**, and **verified at every consuming stage** against a key/source the build job cannot itself write to. A hash that the same job can update is not a control.

### Citation

- **Date:** 2021-04-01 (detection) through 2021-04-07 (postmortem)
- **Source:** Codecov — Post-Mortem / Root Cause Analysis (April 2021)
- **URL:** https://about.codecov.io/apr-2021-post-mortem/
- **One-sentence description:** An attacker extracted an HMAC key from an intermediate layer of Codecov's public self-hosted Docker image and used it to **modify the Bash Uploader artifact in Google Cloud Storage**, so a malicious payload was served to all uploader/Action/Orb users — first detected when a customer's independent **SHA256 check mismatched** the published hash, and fixed by shipping a signed, SHASUM-verifiable uploader and alerting on GCP asset changes.

---

## 10. Long-lived runner state leakage (persistent runner, residue across jobs)

> **Trust boundary crossed:** state written by job N persists on a shared machine and is inherited by job N+1 — possibly a different PR, repo, or trust level.

### Mechanism

An **ephemeral** runner is a fresh machine per job, destroyed after; a **long-lived / persistent** self-hosted runner is one machine that runs job after job, and therefore **carries all mutable state from every prior job into every later job**. That state is exactly the high-value stuff:

- **Files** left in the working directory or `/tmp`.
- **Package-manager caches** (`~/.npm`, `~/.cargo`, the Docker layer store, Go/Maven/Gradle caches).
- **Cached credentials** — `~/.docker/config.json` after a `docker login`, `~/.npmrc` / `~/.gem/credentials` after a publish, a `GITHUB_TOKEN` baked into `~/.gitconfig` or the git remote URL (e.g. `https://x-access-token:<TOKEN>@github.com/...`).
- **Profile / PATH tampering** — a modified `.bashrc`, a binary dropped on `PATH`, a git hook in a cloned repo.
- **Orphaned processes/ports** — a Postgres or dev server that was not torn down.
- **Mounted keys** — an SSH deploy key or cloud credential file mounted into the runner.

A subsequent job — possibly from a **different PR, or even a different repository** on the same runner — starts with read access to all of it. This is not hypothetical. The **Daytona** team documented a self-hosted job that **picked up 30 stale files from the runner's working directory, including `.env` and workflow files**, left by earlier runs, and release/publish jobs that left RubyGems, Docker-Hub, and `GITHUB_TOKEN` credentials on disk. **Anthropic's `claude-code-action`** documented that `RUNNER_TEMP` is **not reliably emptied between jobs** on self-hosted runners, so a prompt file (`claude-user-request.txt`) written by a job in repo A was read by jobs in repo B on the same runner agent — observed on ~5 of 12 jobs (≈40%) over a 5-day window. The compromised data flow: job N writes credential/file → persists on the shared runner filesystem → job N+1 (different PR/repo/trust level) inherits it → cross-job / cross-tenant secret & state leak.

```
job N (repo A, trust level T1)  ->  writes .env, ~/.docker/config.json, prompt file
   ->  persistent runner: nothing is wiped
job N+1 (repo B, trust level T2)  ->  reads .env / docker config / stale prompt
   ->  cross-repo secret & state leak
```

### Defense

The clean fix is **ephemeral runners by default** — a fresh, destroyed-after-each-job environment means there is nothing to leak, nothing to clean, and the trust boundary collapses back to a single job (this is the posture a self-hosted platform should ship as its **default**). If you must run a persistent runner, enforce **mandatory, unconditional cleanup as the last step of every job** (`if: always()` so it runs even on failure):

- `rm -rf` the work dir, `/tmp`, `~/.npm`, `~/.cache`, `~/.docker/config.json`, `~/.ssh`, gem/nuget/pip caches.
- `unset` step-level env; reset the git remote URL to strip any embedded token.
- `docker system prune -af`; kill orphaned processes; free ports.
- **Never mount long-lived prod SSH keys or credential files** — prefer short-lived per-job tokens.

- **Source (vendor):** GitHub *"Security hardening for GitHub Actions / self-hosted runners."*
- **Source (incidents):** Daytona `daytonaio/daytona` PR #4474; `anthropics/claude-code-action` issue #1287.
- **Source (analysis):** runs-on.com — ephemeral-vs-persistent runner trade-offs.

**OpenForge design implication:** make "is this runner ephemeral?" a **first-class runner attribute**, and if persistent, **gate job scheduling on the presence of a verified cleanup contract** (and never accept a mounted prod key as the reason to be persistent).

### Citation

- **Date:** 2025 (real, observed; documented in the fix PR; state left by prior runs)
- **Source:** Daytona — `daytonaio/daytona` PR #4474 (credential-cleanup for self-hosted runners), corroborated by `anthropics/claude-code-action` issue #1287
- **URL:** https://github.com/daytonaio/daytona/pull/4474
- **One-sentence description:** Daytona documented that its self-hosted runners persisted filesystem state between jobs — a job in `daytona-ai#304` **picked up 30 stale files from the working directory, including `.env` and workflow files**, and release/publish jobs left RubyGems, Docker-Hub, and `GITHUB_TOKEN` credentials on disk readable by any later job on the same runner — prompting `if: always()` credential-cleanup steps across all self-hosted jobs.

*Corroborating, observed:* `anthropics/claude-code-action#1287` — `RUNNER_TEMP/claude-prompts/` is not reliably emptied between jobs on self-hosted runners, so a `claude-user-request.txt` left by a job in repo A was read by later review jobs in repo B on the same runner agent, observed on ~5 of 12 jobs (≈40%) over a 5-day window.

---
---

## Citation Summary Table

| # | Problem | Date | Source | CVE / URL | One-sentence (what actually happened) |
|---|---------|------|--------|-----------|----------------------------------------|
| 1 | Container escape | 2024-01-31 | OCI runc (GHSA-xr7r-f8xq-vfvv) | **CVE-2024-21626** · [URL](https://github.com/opencontainers/runc/security/advisories/GHSA-xr7r-f8xq-vfvv) | runc fd-leak let a container's cwd resolve into the host mount namespace (and overwrite host binaries via `/proc/<pid>/exe`); fixed in 1.1.12. |
| 2 | Cache poisoning across builds | 2024-12-04→07 | Ultralytics YOLO (PyPI) | [URL](https://csoh.org/breaches/ultralytics-cache-poisoning.html) | Fork-PR `pull_request_target` job poisoned a GH Actions cache entry; the release pipeline restored it and shipped 4 malicious YOLO releases (8.3.41–46) with an XMRig miner. |
| 3 | Secret exfil via logs / masking | 2026-09-15→10-26 | Wiz — "Gheist" (The Hacker News) | [URL](https://thehackernews.com/2026/10/gheist-uses-stolen-github-tokens-to.html) | Stolen GitHub tokens planted a workflow that printed secrets **base32** to logs (bypassing masking), then downloaded the log via API and deleted the run — 13,500+ branches, 850+ accounts. |
| 4 | Pwn request (fork PR + secrets) | 2025-04-26 | Grafana Labs (StepSecurity) | [URL](https://www.stepsecurity.io/blog/grafana-github-actions-security-incident) · ref **CVE-2025-61671** | `pull_request_target` workflow + branch-name script injection exfiltrated GitHub-App secrets; stolen token pushed a malicious `hrgqavynjp` workflow to dump+encrypt all secrets. |
| 5 | TOCTOU on source checkout | 2025-11-12 | Boost Security Labs | [URL](https://labs.boostsecurity.io/articles/split-second-side-doors-how-bot-delegated-toctou-breaks-the-cicd-threat-model/) | A `/ok to test` bot with `workflow:write` let an attacker race a force-push of a malicious workflow into the trusted branch (then revert to the reviewed SHA); NVIDIA pinned approval to an immutable SHA. |
| 6 | Supply chain — 3rd-party actions | 2025-03-14 (CISA 03-18) | CISA (tj-actions + reviewdog) | **CVE-2025-30066 / CVE-2025-30154** · [URL](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction) | Compromised `tj-actions/changed-files` (via a stolen bot PAT) dumped runner-memory secrets as double-base64 into public logs; potentially enabled by the compromised `reviewdog/action-setup@v1`. |
| 7 | Resource exhaustion / DoS | 2025 (runner 2.334.0) | opendatahub-io/notebooks #3641 (+ sei-chain `703e48d`) | [URL](https://github.com/opendatahub-io/notebooks/issues/3641) | Real GitHub-hosted runners crashed with "No space left on device" on the runner's own `_diag` log (root full), killing the runner and hanging unrelated jobs — a live disk-exhaustion DoS. |
| 8 | Lateral movement to internal services | 2022-12-22 (disc. 2023-01-04) | CircleCI | [URL](https://circleci.com/blog/jan-4-2023-incident-report/) | Stolen 2FA SSO session → CircleCI prod → exfiltrated customer env vars/tokens/keys **and the encryption keys from a running process**; all OAuth/API tokens rotated. *(platform compromise — see note)* |
| 9 | Artifact tampering | 2021-04-01→07 | Codecov | [URL](https://about.codecov.io/apr-2021-post-mortem/) | Attacker used an HMAC key leaked from a Docker layer to modify the Bash Uploader artifact in GCS; caught by a customer's **SHA256 mismatch**; fixed with a signed, SHASUM-verifiable uploader. |
| 10 | Long-lived runner state leakage | 2025 | Daytona PR #4474 (+ claude-code-action #1287) | [URL](https://github.com/daytonaio/daytona/pull/4474) | A self-hosted job inherited **30 stale files (incl. `.env`)** from the runner's work dir, and publish jobs left RubyGems/Docker/GH tokens on disk readable by later jobs — prompting `if: always()` cleanup. |

---

## The ten are not independent — a composite kill-chain

The ten problems read as a checklist, but in the wild they are a **chain**, and an attacker walks it in order. A defender who has mitigated any *single* one still loses if a later stage crosses a boundary the first fix didn't touch. Below is one end-to-end attack built **only from the verified techniques above**, against a hypothetical OpenForge-style repo. It instantiates **seven** of the ten.

**Stage 1 — Pwn Request (#4).** The attacker opens a fork PR. The repo has a `pull_request_target` workflow that checks out the PR head. The attacker's head code therefore runs inside a job that can read base-repo secrets and holds a write-scope `GITHUB_TOKEN`.
→ *Signal:* a `pull_request_target` run whose checkout is the **head** ref, with a head-side step executing.

**Stage 2 — Compromised / look-alike action (#6).** Rather than dump secrets directly (noisy), the head code installs a look-alike action, or simply harvests the write-scope `GITHUB_TOKEN` the pwn-request job already exposes. No maintainer breach is even required — the *victim's own misconfiguration* supplies the code path.
→ *Signal:* an unreviewed `uses:` resolving to a SHA with **no provenance attestation**; a write-scope token present in a low-trust context.

**Stage 3 — Cache poisoning (#2).** Using the write token, the code writes a poisoned dependency-store entry into the **default-branch cache scope** under the release key. A cache *save* is **not** a permissions-gated API call, so `permissions: read` does not stop it — the write happens in the cache action's post-run step with `ACTIONS_RUNTIME_TOKEN`.
→ *Signal:* a cache **save** whose creating ref is a PR / low-trust trigger but whose scope is the default branch. **(Gap: GitHub records no cache-create event.)**

**Stage 4 — Log exfiltration (#3).** The one secret still needed (e.g., a long-lived deploy key) is dumped **base32** into the log, the log is **downloaded via the write token**, and the run is **deleted** seconds later. No C2, no egress to block.
→ *Signal:* an unbroken base64/base32 blob in a step that should not emit one; a **run-deletion** event seconds after a successful run.

**Stage 5 — TOCTOU pivot to trust (#5).** The attacker now needs a *trusted* artifact published. They trigger a release and force the ref so it builds a commit they control — or, equivalently, let the poisoned cache from Stage 3 be **restored** by the release (the same trust crossing, seen from the artifact side).
→ *Signal:* the release job's **resolved ref != the approved SHA**; a release whose SLSA provenance references a commit that was never reviewed.

**Stage 6 — Artifact tampering (#9).** The release signs and pushes a package — but the bytes were poisoned in Stage 3/5. The signature is **valid** (the pipeline signed what it built); only an **out-of-band** source-of-truth check catches it.
→ *Signal:* published artifact digest != digest of a clean rebuild from the approved SHA.

**Stage 7 — Lateral movement (#8).** With the deploy token from Stage 4, the attacker pivots from the runner — which has egress to the deploy target — into production, exfiltrating data or planting a backdoor.
→ *Signal:* runner egress to a host/port outside the allowlist; a deploy using a token minted outside normal hours.

**Why the protocol must be a chain, not a list of toggles.** Each stage crosses *exactly one* of the ten boundaries. Mitigating "pwn-request" alone is not safety: if the cache is still writable by low-trust triggers, Stage 3 still works via a compromised *trusted* dependency. The controls must be **defense in depth where each layer independently blocks the next stage**, and each must **fail closed** (deny, not allow, when the check is ambiguous). The single most valuable property a self-hosted platform can have is that **no one stage can silently complete** — every trust crossing should be a logged, alertable event.

---

## Protocol requirements for OpenForge — the threat surface, mapped

Each of the ten problems reduces to a concrete **protocol decision**. "Default" is what a freshly provisioned runner does with **zero configuration**; "Fails closed?" is whether an ambiguous check denies or allows.

| # | Problem | Protocol field / API behavior | Default (zero-config) | Fails closed? |
|---|---------|-------------------------------|------------------------|----------------|
| 1 | Container escape | Runner runs non-root, no ambient caps, seccomp + LSM on, **no host mounts**, `docker.sock` never mounted | All ON by default; `privileged` = reviewer-gated opt-in | Yes — unknown capability = denied |
| 2 | Cache poisoning | Cache **scope is a trust attribute**; the cache-write token is scoped per trust level; low-trust triggers get **read-only** default-branch scope | Low-trust = read-only; write = explicit trusted trigger | Yes — low-trust save attempt = rejected |
| 3 | Log exfil | Secret values **least-privilege scoped per job**; log retrieval is a separate, audited, **non-self-serviceable** endpoint; run deletion is an **alert**, not silent | Secrets out of scope unless requested + reviewed; log download = audited | Yes — out-of-scope secret = not injected |
| 4 | Pwn request | Fork PR runs with **no base secrets + no head checkout**; `pull_request_target` + head-checkout = hard error | Read-only token, no secrets, no head code | Yes — fork PR cannot read base secrets |
| 5 | TOCTOU | Build consumes the **approved / triggering SHA**; checkout verifies resolved ref == approved SHA and **aborts** on mismatch | Consume immutable SHA; branch/tag = navigation only | Yes — SHA mismatch = abort |
| 6 | 3rd-party action | `uses:` must be **SHA-pinned + provenance-signed** (SLSA/Sigstore); unsigned or tag-ref = **refused** in privileged jobs | Reject unpinned / unsigned | Yes — no provenance = no run |
| 7 | DoS | **Per-job** disk/CPU/mem/quota limits; job timeout; concurrency cap; **ephemeral** isolation | Hard caps; 6 h job max; ephemeral default | Yes — cap hit = kill, never degrade others |
| 8 | Lateral move | Runner **egress-deny by default**; **short-lived OIDC/STS only** (no long-lived prod creds in the runner) | Egress denied; creds per-job, minutes-TTL | Yes — out-of-allowlist egress = blocked |
| 9 | Artifact tamper | Artifacts addressed by **digest**; signed at produce-time; **verified at consume-time** against an out-of-band key | Digest + signature required | Yes — missing / mismatch = reject |
| 10 | State leak | **Ephemeral runner by default**; a persistent runner requires a **verified cleanup contract**; no mounted prod keys | Ephemeral; persistent = opt-in + contract | Yes — no cleanup contract = no schedule |

**The three invariants.** Every row above is an instance of one of three rules. If the protocol enforces these three, it enforces all ten:

1. **Low-trust code never executes in a high-trust context.** (Problems 1, 4, 6.)
2. **No high-value state outlives the job that needed it.** (Problems 3, 10, and the credential half of 8.)
3. **No mutable reference is ever the unit of trust.** (Problems 2, 5, 9.)

A reviewer can test any proposed workflow feature against these three: if it lets untrusted code touch a high-trust context, lets state outlive the job, or lets a tag/branch/name be the thing you trust, it fails.

---

## Detection signals — what to alert on (and what the market does not audit)

Prevention is the ten controls above; **detection** is what you page on when a control is bypassed. The differentiator for a *self-hosted* platform is that you can audit things the SaaS does not — cache writes, token minting, run deletion.

- **#1 Container escape:** a runner process touching host paths outside the container rootfs; seccomp/LSM denials; a container acquiring `CAP_SYS_ADMIN`; any `docker.sock` activity.
- **#2 Cache poisoning:** a cache **save** where the creating-ref trust level is *lower* than the target scope's; a new default-branch cache entry with **no corresponding trusted run**; a restore of a key whose producing run was a fork PR.
- **#3 Log exfil:** an unbroken base64/base32 blob (60+ chars) in a step that should not emit one; `printenv` / `toJSON(secrets)` in a step script; a log **download** by a low-priv token; **run deletion** within seconds of a successful run.
- **#4 Pwn request:** a `pull_request_target` run whose checkout is the head ref; a fork-PR run reading a base secret; a token mint + a new workflow push by that token in the same window.
- **#5 TOCTOU:** resolved ref != approved/triggering SHA; a release whose provenance commit was never reviewed; a tag move (`git push --force --tags`) immediately before a build.
- **#6 3rd-party action:** an unpinned or tag-referenced `uses:` in a privileged job; an action SHA with **no SLSA/Sigstore attestation**; an entrypoint / `postinstall` touching an external host; the double-base64 memory-dump signature in logs.
- **#7 DoS:** runner disk > 85%; a job approaching the timeout cap; queue-depth spike attributable to a single actor or fork; `_diag` log growth; OOM kills.
- **#8 Lateral move:** runner egress to a host/port outside the allowlist; **IMDS (`169.254.169.254`)** access from a runner; a deploy using a token minted outside business hours; a runner holding a **long-lived** (non-OIDC) prod credential.
- **#9 Artifact tamper:** published artifact digest != clean-rebuild digest from the approved SHA; a signature that does not match the bytes; an intermediate-store write to an artifact path by a non-producer identity.
- **#10 State leak:** a job reading a file/credential it did not write (cross-job state); `RUNNER_TEMP` / workdir **non-empty at job start**; a persistent-runner job with no verified cleanup step; a mounted key present at job start.

**The market's audit gaps (your differentiator).** GitHub does not record cache **create/save**, does not tie a cache entry to a run / actor / commit, and treats run deletion as a normal action. A self-hosted OpenForge runner that (a) logs **every cache write** with the creating run + actor + commit, (b) makes **run deletion** an alert, and (c) records **every token mint**, turns three of the hardest incidents — Gheist, TanStack, and cache poisoning — from *invisible* into *page-the-on-call*. That is the single most defensible feature a self-hosted competitor can ship, because it is information the incumbent structurally does not have.

---

## Cross-cutting takeaways for an OpenForge self-hosted runner

Ten problems, one pattern: **every failure is a trust boundary crossed the wrong way.** The runner must default to the untrusted side and require an **explicit, audited grant** to cross to the trusted side. That means each of the following is a *default*, not an opt-in:

1. **Ephemeral, non-root, no-cap, seccomp + LSM runners by default** — kills #1, #7, and #10 at the root.
2. **Cache scope as a first-class trust attribute** — low-trust triggers get read-only cache writes *by construction* — kills #2.
3. **Fork PRs get no base secrets and no head checkout**, and secrets are environment-scoped with required reviewers — kills the privilege behind #3 and #4.
4. **Approval is bound to an immutable SHA and the checkout verifies it, failing closed** — kills #5.
5. **Third-party actions must be SHA-pinned + provenance-signed, with a least-privilege token** — kills #6.
6. **Per-job disk/CPU/mem/quota bounds and tenant isolation** — kills #7.
7. **Egress-deny-by-default network policy and short-lived OIDC/STS instead of long-lived prod creds** — kills #8.
8. **Content-addressed, signed, out-of-band-verified artifacts** — kills #9.
9. **No persistent runner without a verified cleanup contract, and no mounted prod key, ever** — kills #10.

The moment any one of these is an opt-in, the actor who skips it owns your pipeline.

---

## Consolidated references

Every distinct source cited above, with the problem it corroborates. CVE numbers and postmortem URLs were all confirmed against a live source during authoring.

1. runc container-breakout advisory — **CVE-2024-21626**, GHSA-xr7r-f8xq-vfvv — [#1](https://github.com/opencontainers/runc/security/advisories/GHSA-xr7r-f8xq-vfvv)
2. CERT-EU advisory 2024-016 (runc CVE-2024-21626) — #1 corroboration (https://cert.europa.eu/publications/security-advisories/2024-016/)
3. Datadog Security Labs — Dirty Pipe container-escape PoC (CVE-2022-0847, runc binary overwrite) — #1 lineage
4. Sysdig / CrowdStrike — CVE-2022-0185 (kernel `fs_context`, CAP_SYS_ADMIN) — #1 lineage
5. CSOH breach record — Ultralytics YOLO cache poisoning → PyPI (Dec 2024) — #2
6. Safedep — TanStack `pull_request_target` cache poisoning (May 2026) — #2 follow-on
7. Adnan Khan — *"The Monsters in Your Build Cache"* (2024-05-06) — #2 defense (https://adnanthekhan.com/2024/05/06/the-monsters-in-your-build-cache-github-actions-cache-poisoning/)
8. Adnan Khan — *"Turning Almost Nothing into a Supply Chain Compromise of Angular…"* (2026-03-03) — #2 defense
9. The Hacker News — Wiz "Gheist" campaign (base32 log exfil, 2026-10-26) — #3 (https://thehackernews.com/2026/10/gheist-uses-stolen-github-tokens-to.html)
10. CSO Online — "Gheist turns GitHub Actions into a secret extraction service" (2026-10-28) — #3 corroboration
11. StepSecurity — Grafana Labs GitHub Actions incident (2025-04-28) — #4 (https://www.stepsecurity.io/blog/grafana-github-actions-security-incident)
12. Orca Security — "Pull Request Nightmare" research; **CVE-2025-61671** (Microsoft/symphony) — #4 corroboration
13. Boost Security Labs — *"Split-Second Side Doors"* (bot-delegated TOCTOU, NVIDIA; 2025-11-12) — #5 (https://labs.boostsecurity.io/articles/split-second-side-doors-how-bot-delegated-toctou-breaks-the-cicd-threat-model/)
14. Scale Factory — *"Compromise by Git Tags"* (2021-02-18) — #5 mechanism (https://scalefactory.com/compromise-by-git-tags/)
15. CISA alert (2025-03-18) — **CVE-2025-30066** (tj-actions/changed-files) + **CVE-2025-30154** (reviewdog/action-setup) — #6 (https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction)
16. Wiz / GitGuardian — tj-actions compromise write-ups (double-base64 secret dump) — #6 corroboration
17. opendatahub-io/notebooks issue #3641 — GHA runner "No space left on device" crash — #7 (https://github.com/opendatahub-io/notebooks/issues/3641)
18. sei-protocol/sei-chain commit `703e48d` — runner disk-exhaustion fix — #7 corroboration
19. CircleCI — incident report & security alert (disclosed 2023-01-04; exfil 2022-12-22) — #8 (https://circleci.com/blog/jan-4-2023-incident-report/)
20. Codecov — Post-Mortem / RCA (April 2021, Bash Uploader artifact tampering) — #9 (https://about.codecov.io/apr-2021-post-mortem/)
21. Daytona — `daytonaio/daytona` PR #4474 (self-hosted runner credential/state cleanup) — #10 (https://github.com/daytonaio/daytona/pull/4474)
22. Anthropic — `claude-code-action` issue #1287 (`RUNNER_TEMP` cross-job state leak) — #10 corroboration
23. runs-on.com — *"Ephemeral vs Long-Lived Runners"* — #7 / #10 analysis
24. GitHub — *"Secure your workflows"* (secret masking "not guaranteed"; `pull_request` vs `pull_request_target`; token permissions) — #3 / #4 defense
25. NIST SP 800-207 (Zero Trust Architecture) + CIS Docker Benchmark v1.6 + CIS Kubernetes Benchmark + SLSA / Sigstore — defense frameworks for #1, #7, #8, #9

---

### Verification status

- **CVEs verified against live sources this session:** CVE-2024-21626 (runc), CVE-2025-30066 (tj-actions/changed-files), CVE-2025-30154 (reviewdog/action-setup), CVE-2025-61671 (Microsoft/symphony). Related-lineage CVEs cited descriptively: CVE-2019-5736, CVE-2022-0847, CVE-2022-0185.
- **Incidents / postmortems verified:** Ultralytics (Dec 2024), Gheist (Wiz, Oct 2026), Grafana (Apr 2025), Boost Security / NVIDIA TOCTOU (Nov 2025), CircleCI (Jan 2023), Codecov (Apr 2021), Daytona & claude-code-action (2025, real GitHub artifacts).
- **Two caveats stated inline:** #8 was a *platform* compromise (not a tenant-runner VPC pivot); #7 and #10 are dated-as-attested GitHub incident artifacts rather than vendor-dated postmortems.
- **No citation was fabricated or left unverified.**
