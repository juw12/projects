# The 10 Hardest Trust Problems in Building a CI Runner Users Actually Trust
Prepared for OpenForge (github.com/juw12/openforge) - a self-hosted GitHub competitor.
Method: every citation below was verified on 2026-11-03 against the NVD REST API
(services.nvd.nist.gov/rest/json/cves/2.0) for CVEs, or the primary spec site for SLSA.
The human-readable URLs resolve (HTTP 200) to the same record; all are 2020-2026.
One candidate (runner impersonation / protocol-level MITM) had no single clean verifiable
record and was swapped, per the "if you cannot cite, swap" rule, for runner-fleet DoS.

---

## 1. Container escapes from CI workloads

A runner's core trust promise is that untrusted code from any PR, fork, or
third-party action cannot touch the host. Containers are the cheap isolation
boundary that makes a multi-tenant runner viable, but they are also the most
dangerous seam in the whole system. The OCI runc runtime, the default under most
container runners, shipped with a file-descriptor leak that let a freshly
spawned container inherit a working directory in the host's filesystem
namespace, and let a malicious image or runc exec payload overwrite
semi-arbitrary host binaries for a full escape. For a self-hosted competitor
like OpenForge this is brutal because you own the fleet: one escaped job on a
shared runner can read every other tenant's secrets and pivot to the host
kernel. The hard part is not patching runc; escape classes recur every year, so
you need defense in depth, not a patch.

Attack chain:
- A job or action triggers runc exec/run with a crafted image.
- The FD leak leaves a descriptor pointing at a host path (e.g. /proc/self/exe).
- The container process overwrites a host binary with its own copy.
- Re-exec the planted binary -> host root, host FS, co-tenant secrets.

Why it's hardest for self-hosted OpenForge:
- You own the fleet: one escape reaches every co-tenant's secrets and the host.
- Escape classes recur; a runtime patch is a moving target, not a solution.
- Isolation strength (runc vs gVisor/Kata/VM) directly sets your trust ceiling.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2024-21626
- URL: https://nvd.nist.gov/vuln/detail/CVE-2024-21626
- Verified via: NVD REST API cves/2.0?cveId=CVE-2024-21626
- Date: 2024-01-31 (NVD published)
- Title: runc container escape via internal file-descriptor leak -> host FS access + host binary overwrite
- CVSS 3.1: 8.6 (High)
- Affected: runc 1.1.11 and earlier (OCI container runtime); fixed in 1.1.12
- Takeaway: one untrusted job can become full host control; a patched runtime is not a trust boundary.

---

## 2. Cache poisoning / cross-job leakage

Build caches exist because re-downloading and rebuilding dependencies on every
job is unbearably slow. A cache is a write-once, read-many store that outlives
any single job, so it is a natural smuggling channel. The 2021 Gradle Enterprise
Build Cache flaw (CVSS 9.8) shows the risk: with the default open configuration
the cache node accepted anonymous writes, so anyone with network reach could
populate it with tampered entries that execute malicious code inside the build
of every consumer. On a shared self-hosted runner the blast radius is worse: a
cache keyed by dependency name or a guessable hash lets one tenant poison
artifacts every other tenant's jobs will trust and execute. For OpenForge,
correctness and security collide. Keys must be deterministic and fast, yet any
key an attacker can predict or collide becomes a cross-job implant vector;
writes must be authenticated, owner-scoped, and verified on every read.

Attack chain:
- Attacker reaches an open or guessable build-cache endpoint.
- Writes a poisoned entry keyed to a common dependency or hash.
- A victim job's build hits the key and fetches the "cached" artifact.
- Build executes the poisoned content -> RCE in the victim's pipeline.

Why it's hardest for self-hosted OpenForge:
- A cache must be fast and deterministic or it is useless, which invites collisions.
- One shared cache across tenants multiplies the blast radius.
- Integrity-on-read is often skipped for speed; that skipped check is the hole.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2021-41589
- URL: https://nvd.nist.gov/vuln/detail/CVE-2021-41589
- Verified via: NVD REST API cves/2.0?cveId=CVE-2021-41589
- Date: 2021-10-27 (NVD published)
- Title: Gradle Enterprise Build Cache poisoning and RCE via anonymous cache write access
- CVSS 3.1: 9.8 (Critical)
- Affected: Gradle Enterprise < 2021.3 / Enterprise Build Cache Node < 10.0 (default open config)
- Takeaway: an open or guessable cache turns a speed feature into a fleet-wide RCE primitive.

---

## 3. Secret exfiltration via logs, artifacts, env vars

CI systems hand jobs their secrets, deploy keys, cloud creds, and signing
tokens, as environment variables, and then run arbitrary code with them. The
leakage surfaces are everywhere: the job's own stdout, the runner's log files,
uploaded artifacts, and the raw process environment. The 2021 HashiCorp
vault-action bug is a clean, real example: a multi-line secret was not correctly
registered for GitHub Actions log masking, so it appeared verbatim in log files
and was readable by anyone with log access. The reason this is so hard is that
exfiltration requires no exploit at all; a job that legitimately receives a
secret can simply print or encode it, and the platform must catch every
accidental and malicious leak across logs, artifacts, env, and error traces
while still letting secrets be useful. For OpenForge this means log redaction,
artifact scanning, and secret injection that minimizes exposure, all on the hot
path.

Attack chain:
- Job receives a secret in its environment (e.g., a vault token).
- A multi-line or encoded secret is printed or written and not masked.
- The secret persists in a runner log, artifact, or error trace.
- Anyone with log or artifact access reads the credential directly.

Why it's hardest for self-hosted OpenForge:
- Exfil needs no exploit: a legit job can simply print its own secrets.
- Masking must catch base64, chunked, and multiline values across logs, artifacts, env, and traces.
- Redaction runs on the hot path for every job and every line.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2021-32074
- URL: https://nvd.nist.gov/vuln/detail/CVE-2021-32074
- Verified via: NVD REST API cves/2.0?cveId=CVE-2021-32074
- Date: 2021-05-07 (NVD published)
- Title: HashiCorp vault-action < 2.2.0 leaks sensitive information to log files
- CVSS 3.1: 7.5 (High)
- Affected: HashiCorp vault-action before 2.2.0
- Takeaway: secrets in env plus logs = exfil by default; masking misses multiline and encoded values.

---

## 4. Dependency confusion / supply-chain attacks

Every job installs third-party packages, and the package resolvers are where
trust silently breaks. Dependency confusion exploits the fact that many
ecosystems will pull a public package with the same name as an org's private
internal one if the public version numbers higher. The 2021 Bundler CVE (CVSS
8.8) is a canonical instance: Ruby's Bundler sometimes picked a dependency
source by highest gem version, so a rogue public gem could be chosen even when
the app intended a private gem. The attacker's code then runs during dependency
installation, i.e., on every build. For a self-hosted CI like OpenForge the
stakes are higher: a poisoned install is RCE on your runners before a line of
the user's code runs. The hard part is that the attack is legal on its face; the
resolver did nothing obviously wrong, so you must pin, allowlist, and verify
checksums without breaking real multi-source builds.

Attack chain:
- Victim org has a private package "foo" in a private registry.
- Attacker publishes a public "foo" with a higher version number.
- The resolver picks the public "foo" by version precedence.
- Build installs and runs attacker code during dependency install.

Why it's hardest for self-hosted OpenForge:
- The attack is "legal": the resolver did nothing obviously wrong.
- You must control registry precedence you do not fully own.
- Pinning and signing at scale without breaking real multi-source builds is the engineering cost.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2020-36327
- URL: https://nvd.nist.gov/vuln/detail/CVE-2020-36327
- Verified via: NVD REST API cves/2.0?cveId=CVE-2020-36327
- Date: 2021-04-29 (NVD published)
- Title: Bundler dependency confusion: a rogue public gem chosen over an intended private gem by highest version
- CVSS 3.1: 8.8 (High)
- Affected: Bundler 1.16.0-2.2.9, 2.2.11-2.2.16 (not the generic "dependency confusion" tag)
- Takeaway: resolver source-selection can run attacker code on every build with no traditional exploit.

---

## 5. Network egress data exfiltration

A CI job that can reach the open internet can exfiltrate secrets and data
trivially: curl a stolen token to an attacker server and you are done. The irony
in the 2024 Harden-Runner CVE is telling; the very tool teams deploy to filter
runner egress had its own command-injection weaknesses via environment variables
(CVSS 8.8), so a broken guardrail can itself become the injection point. The
difficulty for OpenForge is that egress must be open enough for real builds,
fetching deps, pushing artifacts, calling SaaS, and tight enough to stop exfil,
and that distinction often lives inside the job, not the platform. Default-allow
egress means any compromised or malicious job leaks; default-deny breaks
everything. Real defense needs per-job egress policy, DNS-level filtering, and
allowlists, plus keeping the enforcement layer itself free of injection. Here
the security control is itself a recurring, independently-exploitable attack
surface.

Attack chain:
- A compromised or malicious job obtains a secret.
- The egress filter enforces policy but reads an untrusted env value.
- Attacker injects through that value to bypass the filter or break its logic.
- The exfil payload leaves to an attacker endpoint unimpeded.

Why it's hardest for self-hosted OpenForge:
- Egress must be open for builds and closed for exfil; the line is inside the job.
- Default-allow leaks; default-deny breaks; the right policy is per-tenant.
- The guardrail itself, the filter, is a recurring, independently-exploitable surface.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2024-52587
- URL: https://nvd.nist.gov/vuln/detail/CVE-2024-52587
- Verified via: NVD REST API cves/2.0?cveId=CVE-2024-52587
- Date: 2024-11-18 (NVD published)
- Title: StepSecurity Harden-Runner network-egress filter: command injection via environment variables
- CVSS 3.1: 8.8 (High)
- Affected: step-security/harden-runner < v2.10.2
- Takeaway: the egress guardrail is itself an attack surface; a filter that can be injected stops filtering.

---

## 6. Cross-repo / cross-context PR privilege escalation

The most insidious CI escalation is a low-trust context quietly gaining a
higher-trust one's privileges: a fork's PR code running with the base repo's
token, or one tenant touching another's artifacts or data. The 2026 GitHub
Enterprise Server CVE is a real example of the flaw: tokens for reading a pull
request's raw diff/patch were scoped by repository name plus PR number, not a
globally unique repo ID, so an attacker who created a matching repo and PR could
reuse their own token to read the private PR's contents. This is hard because
scoping bugs are invisible; the API returns 200, the token "works," and nothing
looks wrong until cross-boundary data leaks. For OpenForge, every capability,
token, cache, and runner must bind to a cryptographically unique owner identity,
never to guessable names or numbers, and PR-triggered runs must get down-scoped
credentials that never reach the base repo's secrets.

Attack chain:
- Attacker creates a repo and PR matching the target's name and number.
- Requests the raw diff/patch; the token is scoped by name+number, not a unique ID.
- The platform matches the target's private PR and returns its contents.
- Cross-repo private data disclosure with a "valid" token, no exploit needed.

Why it's hardest for self-hosted OpenForge:
- Scoping bugs are invisible: 200 responses, "working" tokens, no alarm fires.
- You must bind every capability to an unguessable identity, everywhere.
- PR-triggered code is the low-trust context that always wants high trust.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2026-75101
- URL: https://nvd.nist.gov/vuln/detail/CVE-2026-75101
- Verified via: NVD REST API cves/2.0?cveId=CVE-2026-75101
- Date: 2026-09-22 (NVD published)
- Title: GitHub Enterprise Server auth bypass: PR diff/patch tokens scoped by name+number, not a unique repo ID
- CVSS 3.1: 6.5 (Medium)
- Affected: GitHub Enterprise Server < 3.22 (fixed 3.17.21/3.18.15/3.19.12/3.20.8/3.21.6)
- Takeaway: if capability scopes use guessable identifiers, another repo can mint a valid key for yours.

---

## 7. Token theft via action output / process substitution

Workflow platforms let jobs write to special files, $GITHUB_ENV, $GITHUB_PATH,
and $GITHUB_OUTPUT, that the runner later parses and applies; that is a hidden
code-and-configuration channel. The 2022 GitHub Actions Toolkit CVE shows the
real mechanics: core.exportVariable used a well-known delimiter that an attacker
who controls the value could inject, breaking out of the intended variable and
assigning arbitrary environment variables, including PATH, so the next command
the runner runs resolves to attacker-controlled code. This is process
substitution without a shell: untrusted data becomes configuration the runner
executes. For OpenForge the files are convenient and widely used, so the fix is
not to remove them but to treat every value as untrusted, use unguessable random
delimiters, and never let a value define where executables are found. Token
theft here needs no network and no kernel exploit at all, just a crafted value
that ends up on PATH.

Attack chain:
- Untrusted input is written to GITHUB_ENV via core.exportVariable.
- The value contains the well-known delimiter and escapes the intended variable.
- The attacker assigns PATH, or another variable, to point at planted code.
- The next runner command resolves to the attacker's executable and runs.

Why it's hardest for self-hosted OpenForge:
- The dangerous files (ENV, PATH, OUTPUT) are convenient and widely relied on.
- You cannot remove them; you must make values inert and delimiters unguessable.
- No network or kernel bug is needed: data quietly becomes executed configuration.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2022-35954
- URL: https://nvd.nist.gov/vuln/detail/CVE-2022-35954
- Verified via: NVD REST API cves/2.0?cveId=CVE-2022-35954
- Date: 2022-08-15 (NVD published)
- Title: GitHub Actions Toolkit core.exportVariable delimiter breakout -> arbitrary env var / PATH modification
- CVSS 3.1: 5.0 (Medium)
- Affected: @actions/core before 1.9.1 (fixed in 1.9.1)
- Takeaway: a "value" written to GITHUB_ENV can redefine PATH and steer the runner to run attacker code.

---

## 8. Persistent storage leakage between jobs

Runners keep state, workspaces, and artifact stores to be fast, and anything
that persists across jobs is a leakage vector if isolation is assumed rather
than enforced. The 2023 act artifact-server CVE is a concrete case: its
upload/download endpoints did not sanitize path inputs, so a job could read or
overwrite arbitrary host files via path traversal, a privilege escalation from a
normal build to the runner host. On a self-hosted fleet this is the cross-job
leak problem: if job A's workspace or artifact is not torn down and re-keyed
before job B runs, B can read A's source, secrets, or build output that lingered
on disk. The hard part is that you want to reuse warm storage while every byte
must be job-scoped and verified. OpenForge needs disposable per-job filesystems,
or strong per-job keying of any shared storage, plus path validation on every
artifact read and write.

Attack chain:
- A job uploads or reads an artifact with a path traversal in the name.
- The server uses the unvalidated path in os.Mkdir / os.Open.
- The job reads or overwrites arbitrary host files.
- Persisted files leak to the next job, or a host-file overwrite escalates to the host.

Why it's hardest for self-hosted OpenForge:
- Warm, reusable storage is the performance win that creates the leak.
- Every byte must be job-scoped and verified without paying full cold-start cost.
- Path validation on every read/write is easy to miss on a single endpoint.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2023-22726
- URL: https://nvd.nist.gov/vuln/detail/CVE-2023-22726
- Verified via: NVD REST API cves/2.0?cveId=CVE-2023-22726
- Date: 2023-01-20 (NVD published)
- Title: act GitHub-Actions artifact server path traversal -> read/overwrite arbitrary host files, privilege escalation
- CVSS 3.1: 8.0 (High)
- Affected: act before 0.2.40 (upload + artifact endpoints)
- Takeaway: persistent, path-unvalidated storage lets one job touch the next job's files, or the host.

---

## 9. Resource exhaustion / DoS against the runner fleet

Because runners execute untrusted code, a single malicious or buggy job can
weaponize the fleet's own resources against everyone else: starving CPUs,
filling disks, exhausting file handles, or crashing the daemon. The 2020 GitLab
runner CVE is a clean example at the daemon level: malformed queries could crash
the gitlab-runner process itself, denying service to every queued job on the
node (CVSS 6.5). The difficulty is that the attacker is the tenant; you cannot
trust job input, and the control plane, queue, scheduler, and runner daemon is
the one thing that must stay up under adversarial load. It demands per-job
cgroups, hard caps on concurrency and disk, daemon isolation from the job crash
domain, input validation on every runner API, and auto-healing so one bad node
cannot sink the pool. It is a resilience problem as much as a security one.

Attack chain:
- An attacker sends a malformed query to the runner daemon.
- The daemon crashes (no input validation or error handling).
- The runner process dies.
- Every queued job on that node loses its runner.
- Fleet availability drops; one tenant DoSes the others.

Why it's hardest for self-hosted OpenForge:
- Your tenant is your attacker; you cannot trust job input at all.
- The control plane must survive adversarial load and a single bad request.
- Resilience (cgroups, daemon isolation, auto-heal) is as hard as the security.

Citation:
- Source: CVE record (NVD)
- CVE / Ref: CVE-2020-13310
- URL: https://nvd.nist.gov/vuln/detail/CVE-2020-13310
- Verified via: NVD REST API cves/2.0?cveId=CVE-2020-13310
- Date: 2020-09-14 (NVD published)
- Title: GitLab runner denial of service: malformed queries crash the gitlab-runner process
- CVSS 3.1: 6.5 (Medium)
- Affected: gitlab-runner < 13.1.3 / 13.2.3 / 13.3.1
- Takeaway: one malformed, tenant-controlled request can kill the daemon that serves every other tenant.

---

## 10. Audit log integrity / non-repudiation

When a build signs a release or deploys to prod, someone must later prove what
ran, who triggered it, what inputs it had, and that the record was untampered;
that is non-repudiation. The problem is that CI logs are produced by the same
untrusted runtime the attacker controls, so a compromised job can rewrite or
forge its own audit trail, with no way to tell a truthful log from a forged one.
SLSA, the Supply-chain Levels for Software Artifacts, is the verifiable answer:
cryptographically signed, out-of-band provenance attestation that is anchored so
it cannot be repudiated or quietly altered. For OpenForge this is hard because
it pushes integrity below the runner: append-only or signed logs, tamper-evident
storage, attestation of each step's inputs and outputs, plus a chain of custody
from artifact to the job and identity that made it. Enterprise trustworthiness
and regulatory sign-off live or die here.

Attack chain:
- A compromised job edits its own log or audit record on the same filesystem.
- The attacker forges which code ran, who triggered it, and the inputs used.
- No out-of-band signature exists to contradict the forged record.
- After the incident, the platform cannot prove what actually happened.

Why it's hardest for self-hosted OpenForge:
- The logger and the attacker share the same untrusted runtime.
- You must push integrity below the runner: signed, out-of-band, and anchored.
- Provenance plus a verifiable chain of custody is what enterprise trust actually checks.

Citation:
- Source: Specification (primary site)
- Ref: SLSA v1.0 Specification (provenance and build levels)
- URL: https://slsa.dev/spec/v1.0/
- Verified via: GET https://slsa.dev/spec/v1.0/ (HTTP 200, title "SLSA specification")
- Date: SLSA v1.0 (2023; maintained through 2026)
- Title: SLSA specification - signed, out-of-band provenance for non-repudiable build attestation
- Takeaway: non-repudiation requires signed provenance generated outside the runner, not logs the job can edit.

---
End of findings. 10/10 entries carry a verified 2020-2026 citation: 9 NVD CVEs + 1 SLSA spec.
Citations verified via the NVD REST API (services.nvd.nist.gov/rest/json/cves/2.0) and direct fetch of slsa.dev.
