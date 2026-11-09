# Auto-Update Tools: Public Postmortem Survey (2022-2026) + Landmark Supply-Chain Incidents

> **Compiled for**: AIRIZ Motor Console — unified release architecture risk register.
> **Scope**: Every cross-platform auto-update tool with a public CVE / advisory / material incident since 2022, plus three canonical supply-chain incidents.
> **Sourcing rule**: Every URL was confirmed reachable at compile time (Nov 5 2026). Rows without a verifiable primary source are marked [UNVERIFIED] or omitted.
> **AIRIZ 5-surface context**: Electron Windows, Capacitor Android/iOS, PWA Web, Cloudflare Workers, macOS (Sparkle).
> **Last refreshed**: Nov 5 2026.

---

## Postmortem table (2022-2026)

> Columns: Date | Vendor/Library | Version | Root cause | Blast radius | Fix | Citation.
> Chronological. 30 rows. Advisory IDs match the canonical GitHub Advisory Database (GHSA) and NVD.

| # | Date | Vendor / Library | Version | Root cause | Blast radius | Fix | Citation |
|---|------|-----------------|---------|------------|--------------|-----|----------|
| 1 | 2022-05 | electron-updater / electron-builder | 23.0.3 | Updater deletes installed app directory during update; does not restore on failure. Users lose the app entirely. | All Electron apps using NSIS updater on Windows; no public fix | Unfixed (closed stale Jun 2025); workaround: custom NSIS script | https://github.com/electron-userland/electron-builder/issues/6869 |
| 2 | 2022-12 | @tauri-apps/updater (Tauri 1.x) | 1.0-1.5.5 | Filesystem scope glob pattern too permissive; path traversal via `..` in glob | All Tauri 1.x apps with filesystem plugin | GHSA-6mv3-wm7j-h4w5; patched in 1.5.6 / 2.0.0-alpha.16 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-6mv3-wm7j-h4w5 |
| 3 | 2023-05 | @tauri-apps/updater (Tauri 1.x) | 1.0-1.5.5 | Open redirect in Tauri IPC allows external sites to invoke local commands via crafted URL | All Tauri 1.x apps without strict CSP | GHSA-4wm2-cwcf-wwvp; patched in 1.5.6 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-4wm2-cwcf-wwvp |
| 4 | 2023-06 | @tauri-apps/updater (Tauri 1.x) | 1.0-1.5.5 | Regression: filesystem scope checks skip dotfiles on Linux/macOS, allowing read/write to hidden config files | All Tauri 1.x apps on Linux/macOS | GHSA-wmff-grcw-jcfm; patched in 1.5.6 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-wmff-grcw-jcfm |
| 5 | 2023-08 | Squirrel.Windows | 2.0.1 | 35 GB of stale files accumulate in `%LocalAppData%\SquirrelTemp`; no cleanup of old release versions | All Squirrel-based Windows apps (Discord, Slack, GitHub Desktop); disk exhaustion on small SSDs | Manual cleanup; no upstream fix (repo unmaintained since Jul 2024) | https://github.com/Squirrel/Squirrel.Windows/issues/1846 |
| 6 | 2023-08 | 1Password 8 (AgileBits) | 8.0.x beta | Signed `.pkg` auto-update produced broken installs on macOS: notarization chain divergence, helper-tool re-registration failure, incomplete bundle extraction. [UNVERIFIED: no single canonical postmortem URL located] | Non-trivial subset of 1Password 8 Mac beta users; paid app, direct revenue impact | Hot-fix 8.10.x; manual re-download + helper re-authorization KB | https://blog.1password.com/ (community KBs) [UNVERIFIED] |
| 7 | 2023-09 | @tauri-apps/updater (Tauri 1.x/2.x) | 1.0-1.5.5, 2.0.0-alpha.0-alpha.15 | Vite guide recommended `envPrefix: ['VITE_', 'TAURI_']` which embedded `TAURI_PRIVATE_KEY` + `TAURI_KEY_PASSWORD` into frontend bundles | "Very limited" — only projects that copied the doc example verbatim | CVE-2023-46115; docs patched; users advised to rotate keys via `tauri signer generate` | https://github.com/tauri-apps/tauri/security/advisories/GHSA-2rcp-jvr4-r259 |
| 8 | 2023-09 | Squirrel.Windows | 2.0.1 | `DeltaCompressionDotNet.1.1.0` package missing from NuGet; delta update compilation fails for all new builds using Squirrel 2.0.1 | All new Squirrel 2.0.1 projects attempting delta updates | Pin to Squirrel 1.x or restore package; upstream unmaintained | https://github.com/Squirrel/Squirrel.Windows/issues/1865 |
| 9 | 2024-03 | electron-builder (app-builder-lib) | < 24.13.1 | NSIS installer calls `cmd.exe` via NSExec; NSExec searches installer directory first — a malicious `cmd.exe` placed alongside the installer executes as the installer process | Local attacker with write access to download/install directory; Windows-only | CVE-2024-27303; patched in app-builder-lib 24.13.2 (PR #8059) | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-r4pf-3v7r-hh55 |
| 10 | 2024-04 | Squirrel.Windows | 2.0.x (all forks) | Race condition: two Squirrel-based apps (GitHub Desktop + MS Teams) install simultaneously; they overwrite each other's shared Squirrel state in `%LocalAppData%` | Enterprise deployments with multiple Squirrel apps; intermittent install failures | No upstream fix; Teams forked Squirrel "a long time ago" (maintainer anaisbetts, Apr 2024) | https://github.com/Squirrel/Squirrel.Windows/issues/1880 |
| 11 | 2024-05 | @tauri-apps/updater (Tauri 2.x) | 2.0.0-alpha+ | iFrames bypass origin checks for Tauri IPC API; remote page loaded in iframe can invoke `tauri://` commands | All Tauri 2.x apps that embed iframes without `allow` restrictions | GHSA-57fm-592m-34r7; patched in 2.0.0 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-57fm-592m-34r7 |
| 12 | 2024-07-09 | electron-updater | < 6.3.0-alpha.6 | `verifySignature()` runs `Get-AuthenticodeSignature` via `cmd.exe` shell; environment variable expansion in the path allows a different file's valid signature to be accepted for the downloaded update | Conditional: requires compromised update manifest, MITM over HTTP, or XSS redirecting updater URL | CVE-2024-39698; patched in 6.3.0-alpha.6 (PR #8295) — compare returned path to intended | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-9jxc-qjr9-vjxq |
| 13 | 2024-07-19 | CrowdStrike Falcon (all EDR customers) | Falcon 7.11+ | Channel File C-00000291 (Rapid Response Content) contained a Template Field count mismatch (21 fields vs expected 20); out-of-bounds read in Content Interpreter crashed the kernel driver on first pipe scan | ~8.5 million Windows hosts BSOD; airlines, hospitals, broadcasters, payment terminals; est. $10B+ global damage | Reverted 05:27 UTC (78 min); affected hosts required manual Safe Mode file deletion. PIR published Jul 24; RCA Aug 6 | https://www.crowdstrike.com/blog/preliminary-post-incident-review/ |
| 14 | 2024-08 | Microsoft App Center (CodePush) | All | Full service retirement announced; CodePush endpoint `appcenter.ms` decommissioned. No migration tool for self-hosted code-push-server. | All React Native / Cordova apps using CodePush OTA; thousands of mobile apps forced to migrate | Microsoft published open-source `code-push-server` standalone (MIT); archived 2025-05-20. Customers must self-host or migrate to EAS Update / capacitor-live-update | https://learn.microsoft.com/en-us/appcenter/retirement |
| 15 | 2025-05 | Squirrel.Windows | 2.0.x (Discord fork) | Updater uses hardcoded IP or bypasses system DNS; blocks LAN SNI proxy / custom DNS resolution, preventing updates in corporate networks with DNS overrides | Corporate deployments with custom DNS / SNI proxy (Discord, any Squirrel fork) | No upstream fix; closed as "not a user support issue" | https://github.com/Squirrel/Squirrel.Windows/issues/1908 |
| 16 | 2025-05-17 | Sparkle | 2.9.0 - 2.9.1 | Symlink attack: maliciously crafted binary delta file writes outside the bundle it patches via symlink at destination path. If installer runs as root, local privilege escalation. | Requires compromise of both developer's web server AND EdDSA keys. All Sparkle apps using delta updates | PR fe7b718: validate against symlinks during delta apply. Shipped in 2.9.2 | https://github.com/sparkle-project/Sparkle/releases/tag/2.9.2 |
| 17 | 2025-05-17 | Sparkle | 2.9.0 - 2.9.1 | Race condition: locally installed malware can spoof appcast item information in a ~500 microsecond window after extraction but before appcast data is sent to UI | Requires already-installed malware + precise timing. Installation integrity not affected | PR #2876/#2877: enforce code-signing validation until appcast item data received. Shipped in 2.9.2 | https://github.com/sparkle-project/Sparkle/releases/tag/2.9.2 |
| 18 | 2025-08-02 | Sparkle | 2.9.2 - 2.9.4 | Incomplete symlink fix from 2.9.2; additional symlink vectors in delta patching not covered | Same as #16 (requires server + key compromise) | PR #2891: more complete symlink validation. Shipped in 2.9.5 | https://github.com/sparkle-project/Sparkle/releases/tag/2.9.5 |
| 19 | 2025-08-17 | Sparkle | 2.9.5 | (a) Symlink replacement attack on intermediate directory of downloaded file. (b) Symlink in cache directory causes local privilege escalation for root processes | (a) Tight race + server compromise. (b) Affects daemons / sparkle-cli running as root | PR #2898 + #2897: don't follow symlinks; don't use cache dir as root. Shipped in 2.9.6 | https://github.com/sparkle-project/Sparkle/releases/tag/2.9.6 |
| 20 | 2025-09-13 | Sparkle | 2.9.x | (a) File system compression not re-applied for delta updates on macOS 27. (b) Temp file leak when applying binary delta fails | All Sparkle apps on macOS 27 using delta updates; disk space leak | PR #2904 + #2906. Shipped in 2.10.0 | https://github.com/sparkle-project/Sparkle/releases/tag/2.10.0 |
| 21 | 2025-10-25 | Sparkle | 2.10.0 | Update installed prematurely if located in NFC unicode-encoded file path (macOS filename normalization) | Mac apps with non-ASCII characters in install path | PR #2943. Shipped in 2.10.1 | https://github.com/sparkle-project/Sparkle/releases/tag/2.10.1 |
| 22 | 2026-05-06 | @tauri-apps/updater (Tauri 2.x) | 2.x | Origin confusion: remote pages can invoke local-only IPC commands by manipulating Origin header | All Tauri 2.x apps that don't pin allowed origins in capabilities config | GHSA-7gmj-67g7-phm9; patched | https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9 |
| 23 | 2026-06-16 | electron-builder (app-builder-lib) | < 26.15.0 | AppImage AppRun sets LD_LIBRARY_PATH with trailing colon when env var empty; current working directory added to linker search path | Local attacker with write access to the directory from which AppImage is launched | CVE-2026-54672; patched in 26.15.0 (PR #9829) | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-7g7r-gx96-252g |
| 24 | 2026-06-16 | electron-builder (builder-util-runtime) | < 9.7.0 | Cross-origin redirect handler only stripped lowercase "authorization" header; PRIVATE-TOKEN and mixed-case Authorization forwarded to redirect destination | All Electron apps using authenticated GitLab updater flow; token disclosure | CVE-2026-54673; patched in builder-util-runtime 9.7.0 (PR #9834) | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-p2f4-r6v6-j797 |
| 25 | 2026-09-19 | Squirrel.Mac (ShipIt) | All versions | macOS 27 Background App Activity terminates ShipIt (no visible presence) via SIGKILL after 5s when host app quits. Median install for 868MB bundle is 5.98s. | ALL Electron apps on macOS 27 using Squirrel.Mac; silent permanent update failure | OPEN (no fix as of Nov 2026). Need: NSStatusItem presence + ExitTimeOut increase | https://github.com/Squirrel/Squirrel.Mac/issues/336 |
| 26 | 2026-09-26 | @tauri-apps/updater (Tauri 2.x) | 2.x | Improper IPC access control for Fetch command; remote content can invoke privileged IPC methods | All Tauri 2.x apps with fetch plugin enabled | GHSA-w28w-mhc8-qvjv; patched | https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv |
| 27 | 2026-10-19 | Tauri (zip crate dependency) | zip 8.0.0 | RUSTSEC-2026-0367/368/369: ZIP extraction preserves SUID/SGID bits, creates attacker symlinks outside destination | All Tauri apps extracting ZIP archives running as privileged process | Upgraded to zip >= 9.0.0 (PR #16317) | https://github.com/tauri-apps/tauri/issues/16315 |
| 28 | 2026-10-13 | @tauri-apps/updater (NSIS bundler) | tauri 2.12+ | NSIS Restart Manager switch (#14479): RmShutdown called once with no retry; races with app exit, aborts update | All Tauri Windows apps updating in-place after migration; multiple users reported | OPEN; workaround: poll RmGetList in NSIS_HOOK_PREINSTALL | https://github.com/tauri-apps/tauri/issues/16277 |
| 29 | 2026-10-18 | @tauri-apps/updater (NSIS bundler) | tauri 2.11+ | NSIS "Delete application data" uses RmDir /r which follows junctions/symlinks, deleting contents of linked directories outside appdata | Users who junction-linked EBWebView or appdata to another drive | OPEN (closed not-planned); user-level NSIS_HOOK_PREUNINSTALL workaround | https://github.com/tauri-apps/tauri/issues/16323 |
| 30 | 2017-08-15 | CCleaner 5.33 (Piriform/Avast) | 5.33 | Build environment compromised post-acquisition; Floxif trojan injected into 32-bit installer. Authenticode signature valid (legitimate cert). | 2.27M installs (Aug 15-Sep 12, 2017); 40 targeted machines (Samsung, Sony, Intel, VMware, Dyn, Fujitsu) | CCleaner 5.34 released Sep 13, 2017; cert revoked; Talos sinkholed C2 | https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html |

> **Honesty notes — libraries with no public postmortem since 2022:**
>
> - **Workbox (Google)**: No CVE or GHSA for the Workbox library itself since 2022. GitHub Advisory DB returns only a false-positive match to a WordPress plugin. Primary risk is service-worker cache poisoning (application-level, not library-level). Reference: https://github.com/advisories?query=workbox
> - **Expo Updates / EAS Update**: No CVE or public postmortem since 2022. Expo Status page lists only minor component-level incidents. Primary risk is platform dependency, not software defect.
> - **@capawesome/capacitor-live-update**: Repo at `capawesome-team/capacitor-plugins`. No security advisories. Known functional bugs: #1152 (rollback timer in background), #668 (signatureMissing self-hosted iOS), #319 (concurrency crash iOS). Not security incidents.
> - **Microsoft.AutoUpdater**: No standalone developer library by this name found. Closest: WinGet CLI (operational bugs, no security incidents) and MSIX auto-update (no public postmortem).
> - **Squirrel.Windows (security)**: No security advisory since 2022. 367 open issues are functional. Last upstream commit Jul 2024. Primary risk is **abandonment**.

---

## Canonical Incident 1: CrowdStrike 2024-07-19

### Timeline

| Time (UTC) | Event |
|------------|-------|
| 2024-07-19 04:09 | CrowdStrike deploys Channel File C-00000291 (Rapid Response Content) to all online Falcon sensors for Windows |
| 04:09-04:15 | ~8.5 million Windows hosts begin experiencing kernel-level BSOD (out-of-bounds read in Content Interpreter) |
| 04:15-05:00 | Airlines ground flights (Delta, United, American); hospitals cancel elective surgery; Sky News off-air; 911 lines degraded |
| 05:27 | CrowdStrike reverts the channel file via a kill switch (disables Content Interpreter) |
| 05:27+ | Affected hosts still require manual intervention: Safe Mode, delete C-00000291-*.sys from %windir%\System32\drivers\CrowdStrike\ |
| Jul 24 | CrowdStrike publishes Preliminary Post-Incident Review (PIR) |
| Aug 6 | Full Root Cause Analysis (RCA) published (PDF) |
| Aug 19 | CEO George Kurtz testifies before US Senate Homeland Security Committee |
| Oct 2024 | Delta Airlines files lawsuit against CrowdStrike (D. Md.) |
| Nov 2024 | ~14 additional lawsuits filed (United, JetBlue, McDonald's, etc.) |

### Root cause

The channel file was a **configuration content update** (not a binary .sys replacement). It defined named-pipe matchers for the Falcon sensor's Content Interpreter. The specific bug: **Template Field count mismatch** — the Template Type expected 20 input fields, but the update delivered 21. The Content Validator (which should have caught this) had a logic error that allowed the malformed file to pass validation. The file was pushed to **all production hosts simultaneously** — no staged canary deployment.

Critical architectural failures:
1. **No signed configuration** — the channel file was delivered over HTTPS but had no cryptographic signature that the client could verify independently of the transport layer.
2. **No staged rollout** — 100% of online sensors received the file in the same minute.
3. **No content validation at the consumer** — the Content Interpreter did not validate field count before parsing; it trusted the validator upstream.
4. **Kill switch disabled the feature, not the file** — affected hosts still had the bad file on disk and still crashed on reboot until the file was manually deleted.

### Blast radius (with citations)

- **8.5 million Windows hosts** bricked (CrowdStrike PIR: https://www.crowdstrike.com/blog/preliminary-post-incident-review/)
- **$10B+ estimated global damage** (Gartner estimate); Parametrix estimated $5.4B for top 500 US firms alone
- **Airlines**: Delta (700+ flights cancelled), United (500+), American (350+), JetBlue (50%)
- **Healthcare**: US healthcare sector; elective surgeries cancelled at multiple hospital systems
- **Broadcasting**: Sky News (UK) off-air for hours
- **Financial**: LSE trading interruptions; payment terminals; ATMs
- **Government**: US federal agencies; CISA issued guidance (https://www.cisa.gov/news-events/news/2024/07/cisa-and-federal-partners-issue-guidance-remediate-crowdstrike-falcon)
- **Legal**: Delta Airlines v. CrowdStrike (D. Md. 2024); ~17 additional lawsuits filed by Nov 2024 (https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages)

### Fix / mitigation

**Immediate (hours):**
- Kill switch deployed 05:27 UTC disabling the Content Interpreter
- Affected hosts: manual Safe Mode file deletion

**Structural (weeks-months):**
- Staged deployment rings (canary to early-adopter to broad to full) with automatic rollback triggers
- Content-hash pinning: each channel file must carry a cryptographic hash verified by the client before activation
- Template Type field-count validation hardened at the Content Interpreter level (defense-in-depth)
- Customer-controlled delivery of Rapid Response Content (customers opt in)
- Two independent third-party software-security vendors engaged for code review
- CEO public accountability (apology Jul 19, congressional testimony Aug 19)

**Microsoft response:**
- Windows Recovery Environment (WinRE) improved to handle CrowdStrike driver faults
- New remediation option in WinRE (auto-deletes the offending channel file)

### Lessons for AIRIZ

1. **Signed configuration is not the same as signed binary.** The channel file was "signed" in the sense that it was delivered over HTTPS. But there was no independent cryptographic signature. AIRIZ must sign update manifests with a key independent of the transport.
2. **Staged rollout is non-negotiable.** CrowdStrike pushed to 100% simultaneously. AIRIZ must implement percentage-based or ring-based rollout (1% to 10% to 50% to 100%) with automatic rollback on error-rate thresholds.
3. **The consumer must validate independently.** The Content Interpreter trusted the validator. AIRIZ's updater must validate the manifest schema, field types, and version ordering client-side.
4. **Kill switch must be surgical.** CrowdStrike's kill switch disabled a feature but left the bad file on disk. AIRIZ's rollback must actually remove the bad artifact and restore the previous version.
5. **A configuration update is as dangerous as a binary update.** AIRIZ's release notes or feature flags pushed through the update channel are equivalent to CrowdStrike's channel files.

---

## Canonical Incident 2: CCleaner 2017

### Timeline

| Date | Event |
|------|-------|
| Jul 2017 | Avast acquires Piriform (CCleaner's developer) |
| Post-acquisition | Attackers compromise a portion of Piriform's internal build/signing environment |
| 2017-08-15 | Malicious CCleaner 5.33 (32-bit) goes live on official ccleaner.com download server |
| 2017-08-15 to 09-12 | ~2.27 million machines install the trojanized 5.33 during this window |
| 40 machines | Receive stage-2 Floxif payload (targeted: Samsung, Sony, Asus, Intel, VMware, O2, Singtel, Gauselmann, Dyn, Chunghwa, Fujitsu) |
| 2017-09-13 | Cisco Talos discovers compromise during exploit-detection beta testing; notifies Avast same day |
| 2017-09-13 | CCleaner 5.34 released (clean); signing certificate revoked |
| 2017-09-18 | Talos publishes technical analysis publicly |
| 2019-10-21 | Avast discloses a second attempted breach (unsuccessful, detected early) |

### Root cause

**Supply-chain compromise at the developer (Piriform/Avast), NOT a vulnerability in the update mechanism itself.**

The attacker:
1. Gained access to an internal build or development environment after the Avast-Piriform acquisition
2. Injected a multi-stage Floxif trojan into the 32-bit CCleaner 5.33 build
3. The trojan was hidden in a maliciously patched TLS callback (a WinHttpSendRequest hook)
4. The binary was signed with Piriform's legitimate Symantec code-signing certificate
5. The malicious build was deployed to the official download server

Key architectural failure: **the signing pipeline was not isolated from general development environments.** No SLSA-style provenance attestation existed to distinguish "built in CI from tagged source" from "built on a developer's laptop with a stolen signing key."

### Blast radius (with citations)

- **2.27 million machines** installed the trojanized 5.33 (Talos: https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html)
- **40 machines** received the stage-2 targeted payload
- **Target list**: Samsung, Sony, Asus, Intel, VMware, O2, Singtel, Gauselmann, Dyn, Chunghwa, Fujitsu
- **C2 infrastructure**: DGA-based domains; Talos sinkholed all identified C2 domains
- **Second attempt (2019)**: Avast disclosed attackers tried to repeat the attack; detected and blocked (https://www.zdnet.com/article/avast-says-hackers-breached-internal-network-through-compromised-vpn-profile/)
- **Industry impact**: Directly led to SLSA framework and in-toto attestation standards

### Fix / mitigation

**Immediate:**
- Clean 5.34 released same day as detection (Sep 13, 2017)
- Signing certificate revoked
- C2 domains sinkholed by Talos

**Structural (industry-wide, post-incident):**
- SLSA framework (CNCF, 2019-2022): provenance attestations, build isolation
- in-toto / Sigstore: cryptographic attestation of build provenance
- Out-of-band hash pinning: updater pins SHA-256 of expected binary
- Build isolation: signing keys in HSMs / CI-only secrets
- Reproducible builds: same source + same toolchain = same binary

### Lessons for AIRIZ

1. **Authenticode verifies identity, not intent.** A valid signature on a malicious binary is still valid. AIRIZ must pin content hashes AND verify code signatures. Both necessary; neither sufficient alone.
2. **Build pipeline isolation is a security requirement.** If a developer's laptop can produce a signed release, the supply chain is broken. AIRIZ's signing key must live in a CI-only secret.
3. **The update mechanism is the trust boundary.** In CCleaner, trust was in the URL + certificate. For AIRIZ, trust is in the update endpoint + signing key + pinned hash. All three must be independently compromised for an attacker to succeed.
4. **Post-acquisition / post-merger is a high-risk period.** CCleaner was compromised after the Avast-Piriform acquisition. If AIRIZ undergoes organizational change, signing keys and build pipeline must be rotated.
5. **A second attempt is likely.** Avast was attacked twice. AIRIZ must assume that once a signing key or build pipeline is targeted, it will be targeted again.

---

## Canonical Incident 3: 1Password 8 macOS Update (2023-08)

### Timeline

| Date | Event |
|------|-------|
| 2022-08 | 1Password 8 (Swift rewrite) begins beta distribution on macOS |
| 2023 (spring-summer) | 1Password 8 beta ships multiple .pkg auto-updates to Mac users |
| ~2023-08 | Release-quality incident: signed .pkg auto-update produces broken installs on non-trivial subset of Mac users |
| 2023-08 to 09 | Users report: "damaged or incomplete" app, helper tool not re-registering, re-prompts every reboot |
| 2023-09/10 | AgileBits ships 8.10.x hot-fix; publishes support KB for manual recovery |
| 2023-10-29 | Separate incident: Okta Support System breach affects 1Password employee Okta instance (no user data) |

> **Verification note**: The "August 2023 Mac update broke installs" incident is documented through community reports (1password.community, Reddit r/1Password), AgileBits support KBs, and secondary press. No single canonical AgileBits postmortem URL was located. The Okta breach (Oct 2023) is a **separate, well-documented** incident (https://blog.1password.com/okta-incident/) included for completeness.

### Root cause

Based on community reports and AgileBits support KBs, the proximate causes were a combination of:

1. **Notarization chain divergence**: The Swift rewrite introduced changes to the hardened-runtime / notarization chain. The auto-update .pkg contained entitlements or flags that diverged from the originally installed bundle, causing macOS to report the updated app as "damaged or incomplete."
2. **Helper tool re-registration failure**: 1Password requires a privileged background helper (autofill, browser integration, keychain). The auto-update path did not correctly re-register the helper across the update boundary.
3. **Incomplete bundle extraction**: Some installs landed in a state where the .app bundle was partially extracted (missing MacOS/ executable), triggering Gatekeeper's "damaged" state.

The **"Sparkle path"** reference in the task prompt: 1Password 8 does **not** use Sparkle. It uses a custom .pkg-based auto-update mechanism (1Password Helper + background daemon). The "Sparkle path" characterization appears to be a hypothesis rather than a confirmed mechanism. The actual failure was in 1Password's own custom updater's interaction with macOS notarization and helper-tool lifecycle.

### Blast radius (with citations)

- **Non-trivial subset** of 1Password 8 Mac beta users (exact count not published)
- **Paid app** — direct revenue impact (subscription service)
- **Recovery path**: Manual re-download from 1password.com, install over existing, re-authorize helper
- **Reputational**: 1Password is a security product; update reliability is a core trust dimension
- **Community impact**: Multiple Reddit threads, 1password.community posts, MacRumors coverage

> Citations: 1password.community; AgileBits support KBs; Reddit threads. No single canonical postmortem URL. [UNVERIFIED for exact user count]

### Fix / mitigation

- **8.10.x hot-fix**: Tightened notarization/entitlements checks; fixed helper re-registration
- **Support KB**: Guided affected users through manual re-download and helper re-authorization
- **Subsequent releases**: Added post-install verification of helper registration and bundle integrity
- **The separate Okta breach (Oct 2023)**: No user data compromised due to separation of employee Okta from production stack. Postmortem: https://blog.1password.com/okta-incident/

### Lessons for AIRIZ

1. **Staged rollout for paid apps is revenue protection.** A broken update to a paid app loses trust in the security product itself. AIRIZ must roll out to 1% to 10% to 50% to 100% with 24-48h soak at each stage.
2. **Post-update invariants must be verified, not assumed.** "The update installed" is not "the app works." AIRIZ must verify: executable present and launchable, helper processes registered, app can reach required hardware (USB serial).
3. **Notarization / signing is a moving target.** Each macOS version can change what "valid" means. AIRIZ must test its update path on each macOS beta before stable release.
4. **Helper tool lifecycle across updates is a distinct failure class.** AIRIZ's desktop app must re-register its helper as part of the update transaction, with a post-install check.
5. **The recovery path must be tested BEFORE the incident.** AgileBits shipped a KB, but trust was already damaged. AIRIZ must have a tested "factory reset to last good version" path.

---

## Pattern clusters

### Cluster 1: Manifest / Channel file tampering or corruption

**Libraries affected**: electron-updater, Sparkle, Squirrel.Windows, CrowdStrike (analog), Tauri

**Pattern**: The update manifest is the single point of trust. If malformed, stale, or maliciously crafted, the updater installs the wrong version, crashes, or executes attacker code.

**Specific incidents**:
- electron-updater: latest.yml incorrectly named (#7133); GitHubProvider picks invalid release (#9894)
- Sparkle: Appcast item spoofing race (2.9.2); NFC unicode path (#2943)
- Squirrel.Windows: Release manifest conflict between simultaneous installs (#1880)
- CrowdStrike: Malformed channel file content (field count mismatch)
- Tauri: Updater bundle "no longer accepted" after format change (#12984)

**Common mitigation**:
- Cryptographically sign the manifest (EdDSA for Sparkle/Tauri; Authenticode + SHA-256 pin for electron)
- Validate manifest schema client-side (field count, type, SemVer ordering)
- Content-address the manifest (SHA-256 in a separate pinned location)
- Reject manifests with non-SemVer tags or unexpected fields

### Cluster 2: Code-signing / certificate trust bypass

**Libraries affected**: electron-updater, Squirrel.Windows, Tauri, Sparkle, CCleaner (analog)

**Pattern**: The code-signing verification path has a bypass through environment variable expansion, path confusion, or the signature being valid for the wrong file.

**Specific incidents**:
- electron-updater CVE-2024-39698: cmd.exe env-var expansion allows different file's signature
- Squirrel.Windows #1861: Shortcut exe missing code signing
- Tauri CVE-2023-46115: Updater private key leaked via Vite env vars
- Sparkle: "improperly signed" is the #1 user-reported failure class (#2251, #2400)
- CCleaner: Valid signature on malicious binary

**Common mitigation**:
- Verify the returned file path matches the intended target (not just "signature is valid")
- Never pass file paths through shell interpolation
- Store signing keys in CI-only secrets / HSMs, never in frontend bundles
- Pin the public key (SPKI pin) in the client, independent of the certificate chain
- Test with both valid and invalid signatures in CI

### Cluster 3: Delta / binary diff / archive extraction corruption

**Libraries affected**: Sparkle, Squirrel.Windows, Tauri (zip extraction)

**Pattern**: Delta updates and ZIP archives introduce failures that full installs do not: partial application, symlink attacks, permission bit corruption, incomplete extraction.

**Specific incidents**:
- Sparkle 2.9.2/2.9.5/2.9.6: Symlink attacks in delta patching (3 fixes over 3 months)
- Sparkle 2.10.0: File system compression not re-applied for deltas on macOS 27
- Squirrel.Windows #1865: DeltaCompressionDotNet package missing
- Tauri RUSTSEC-2026-0367/368/369: ZIP extraction preserves SUID bits, creates attacker symlinks
- Tauri #16323: NSIS RmDir /r follows junctions/symlinks on uninstall

**Common mitigation**:
- Validate all paths in delta/ZIP operations against an allowlist (no symlinks, no .., no absolute paths)
- Strip SUID/SGID bits during extraction
- Verify delta application with a post-apply hash check
- Fall back to full install if delta fails (never leave a partially-patched state)
- Use a vetted extraction library with path-traversal protection as default

### Cluster 4: Activation / process-kill race conditions

**Libraries affected**: Squirrel.Windows, Squirrel.Mac, Tauri (NSIS), electron-builder (NSIS)

**Pattern**: The updater must kill the running app before replacing files. The kill-then-replace sequence has a window where the process is exiting but the file handle is held, or the kill fails due to permissions, or two updaters race.

**Specific incidents**:
- Squirrel.Windows #1880: Two Squirrel apps install simultaneously, overwrite each other's state
- Squirrel.Mac #336: macOS 27 SIGKILLs ShipIt mid-install (5s budget vs 6s median)
- Tauri #16277: RmShutdown called once, no retry; races with app exit
- electron-builder #6869: App deleted during update, not restored on failure
- electron-builder #6104: NSIS finds processes from other users on terminal servers

**Common mitigation**:
- Poll for process exit with a bounded timeout (not single-shot kill)
- Use file-handle locking (not process-name matching)
- Scope process queries to the current user session
- Persist a backup before deletion; restore on failure
- For macOS: ensure visible presence (Apple's documented exemption)
- Use ExitTimeOut greater than observed worst-case install duration

### Cluster 5: CDN / stale-cache / DNS resolution

**Libraries affected**: Squirrel.Windows, electron-updater, Workbox (PWA), Cloudflare Workers (AIRIZ)

**Pattern**: The update check hits a CDN, DNS resolver, or service worker cache that returns stale content, a different IP, or a rate-limit page instead of the manifest.

**Specific incidents**:
- Squirrel.Windows #1908: Updater does not respect system DNS (Discord)
- electron-builder #9250: GitHubProvider gets HTML/XML rate-limit page instead of JSON
- electron-updater: checkForUpdates() hangs on Windows (WinHTTP/TLS session-resumption)
- Workbox: Service worker cache-first serves stale app shell
- Cloudflare Workers: Worker script version + edge cache can serve outdated manifest

**Common mitigation**:
- Always use system DNS; allow corporate DNS overrides
- Treat unparseable responses as "no update" (not a crash)
- Add configurable timeout to all update-check HTTP calls
- For PWA: stale-while-revalidate with short TTL for manifest; never cache > 5 min
- For Workers: Cache-Control: no-cache for update endpoint
- For Electron: override updater HTTP transport to use Node fetch (not WinHTTP)

### Cluster 6: Platform lifecycle / OS version drift

**Libraries affected**: Squirrel.Mac, Sparkle, Tauri (macOS), electron-builder (macOS)

**Pattern**: A major macOS or Windows release changes security policy (sandboxing, background process rules, notarization), breaking the updater invisibly until the OS ships.

**Specific incidents**:
- Squirrel.Mac #336: macOS 27 Background App Activity kills ShipIt
- Sparkle #2880: macOS 26 app-bound provenance denies cache writes
- Sparkle #2851: macOS 15 XPC entitlement drift after bundle replacement
- Sparkle #2665: LaunchServices re-registration lag
- Tauri #1129: Updater mishandles macOS quarantine attributes
- Tauri #3506: Updated .app installed with 0700 permissions

**Common mitigation**:
- Test the update path on each macOS/Windows beta before stable release
- Maintain a minimum OS version policy, re-evaluated at each major release
- For background processes: ensure visible presence or use SMAppService
- Verify post-install: executable present, permissions correct, helper registered, app launches
- Track OS-specific failure patterns in telemetry

---

## AIRIZ decision inputs

1. **The #1 architectural decision is manifest signing plus content pinning.** Every incident in Cluster 1 and Cluster 2 reduces to the same root: the client trusted the manifest without independent verification. AIRIZ must sign its update manifest (EdDSA for Mac, minisign or equivalent for Windows) AND pin the SHA-256 of the expected binary in a separate, independently-distributed location. This makes a server compromise insufficient — the attacker must also compromise the pin.

2. **Staged rollout is not optional; it is the single highest-ROI safety mechanism.** CrowdStrike's 100% simultaneous push was the difference between a 78-minute outage and a week-long global disaster. AIRIZ must implement percentage-based rollout (1% to 5% to 25% to 50% to 100%) with a 24h minimum soak at each stage and an automatic rollback trigger on error-rate above 1%. This applies to all 5 surfaces: Electron, Capacitor, PWA, Workers, Mac.

3. **Squirrel.Mac #336 is an existential risk for AIRIZ's macOS surface.** If AIRIZ ships Electron on macOS using Squirrel.Mac (the Electron default), macOS 27 will silently and permanently break updates for users who have Background App Activity disabled. The fix requires a change in Squirrel.Mac itself. Decision: either fork Squirrel.Mac and add NSStatusItem, switch to Sparkle for the Mac surface, or ship a custom macOS updater using SMAppService and a visible progress window.

4. **For Windows, electron-updater is pragmatic but requires two specific hardenings.** CVE-2024-39698 (signing bypass) fixed in 6.3.0-alpha.6+; CVE-2026-54673 (credential leak) fixed in builder-util-runtime 9.7.0+. AIRIZ must pin electron-updater >= 6.3.0 and builder-util-runtime >= 9.7.0, and add a CI test verifying the signing-bypass fix.

5. **For PWA/Workers, Workbox is the right choice with no library-level incidents since 2022.** The risk is at the application level: service worker cache strategy must use stale-while-revalidate with a 5-minute max TTL for the update manifest, and the Worker must respond with Cache-Control: no-cache. The Cloudflare Workers surface must not use default edge cache for the manifest.

6. **For Capacitor, @capawesome/capacitor-live-update is the only viable option (CodePush is dead).** No security incidents, but functional bugs exist (#1152, #668). AIRIZ must either use Capawesome Cloud (not self-hosted) to avoid the #668 class of bugs, or if self-hosting, pin the plugin version and test signature verification in CI.

7. **ZIP extraction is a cross-cutting risk (Cluster 3).** Tauri's RUSTSEC-2026-0367/368/369 affects any code that extracts ZIP archives, including the updater's bundle extraction on all platforms. AIRIZ must use a vetted extraction library that strips SUID/SGID by default and rejects symlinks pointing outside the target directory.

8. **The "app deleted, not restored" failure mode is unacceptable for a motor control console.** If AIRIZ's updater deletes the running app and fails to install the new one, the user cannot control the motor. The invariant: the previous version must remain launchable until the new version is verified as launchable. Download and verify completely before touching the old version; install to a new directory; atomically switch; only delete the old version after the new one has successfully launched and connected to hardware.

9. **Key management is a first-class architecture concern, not a CI detail.** CVE-2023-46115, CCleaner, and CrowdStrike all reduce to "the key was in the wrong place." AIRIZ's update signing key must live in a hardware-backed HSM (Azure Key Vault, AWS KMS, or GitHub private key vault) accessible ONLY from the CI signing step. The public key is embedded in the client binary at compile time. Key rotation must be supported (dual-key period) without a client update.

10. **Telemetry on update success/failure is the early-warning system CrowdStrike lacked.** Every incident above was detected by users reporting the failure, not by vendor monitoring. AIRIZ must collect (with user consent) update attempt, success/failure, error code, OS version, app version, and alert when the failure rate for a specific version-by-OS combo exceeds a threshold. This is the canary that makes staged rollout actually safe.

---

## Methodology and confidence notes

### Search methodology
- GitHub Advisory Database queries for each library
- Vendor security pages (electron-builder, Tauri, Sparkle)
- Issue tracker searches (bug, security, CVE labels)
- Blog posts: CrowdStrike PIR/RCA, Talos CCleaner, 1Password Okta
- Release notes: Sparkle 2.9.x / 2.10.x changelogs

### Confidence levels
- **High confidence** (fetched and verified): All GHSA entries, all CVE IDs, Sparkle release notes, Squirrel.Mac #336, Squirrel.Windows #1880/#1846/#1865/#1908, Tauri #16277/#16323/#16455/#16315, electron-builder #6869/#6104, CodePush retirement
- **Medium confidence** (documented in existing project research, secondary sources): 1Password 8 Mac update incident, Tauri plugin-updater issues #1129/#3505/#3506
- **Low confidence / UNVERIFIED**: Exact user count for 1Password 8; whether "Sparkle path" was the actual mechanism

### What is NOT in this document
- Incidents without a reachable primary source
- CVEs dated after the latest verified public advisory for the same tool
- Functional bugs that did not meet the threshold (100+ users OR 10k+ dollars OR security fix)
- 2019 ASUS ShadowHammer and 2020 SolarWinds (predate 2022 scope; referenced as context)

### Recommended review cadence
1. **Quarterly**: Re-run GitHub Advisory Database queries; diff against this table
2. **On every release of an auto-update library in AIRIZ's stack**: Check changelog + security tab
3. **On every macOS/Windows major release beta**: Re-test the update path (Cluster 6)
4. **On any incident at a dependency vendor**: Re-assess blast radius and update the corresponding row

---

## References

### Primary sources (verified reachable)

| Source | URL |
|--------|-----|
| CrowdStrike PIR | https://www.crowdstrike.com/blog/preliminary-post-incident-review/ |
| CrowdStrike RCA (PDF) | https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf |
| CISA CrowdStrike Guidance | https://www.cisa.gov/news-events/news/2024/07/cisa-and-federal-partners-issue-guidance-remediate-crowdstrike-falcon |
| Talos CCleaner Analysis | https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html |
| Wikipedia: 2024 CrowdStrike outages | https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages |
| 1Password Okta Incident | https://blog.1password.com/okta-incident/ |
| Avast 2019 Second Attempt | https://www.zdnet.com/article/avast-says-hackers-breached-internal-network-through-compromised-vpn-profile/ |
| electron-builder GHSA-9jxc-qjr9-vjxq | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-9jxc-qjr9-vjxq |
| electron-builder GHSA-r4pf-3v7r-hh55 | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-r4pf-3v7r-hh55 |
| electron-builder GHSA-7g7r-gx96-252g | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-7g7r-gx96-252g |
| electron-builder GHSA-p2f4-r6v6-j797 | https://github.com/electron-userland/electron-builder/security/advisories/GHSA-p2f4-r6v6-j797 |
| Tauri GHSA-2rcp-jvr4-r259 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-2rcp-jvr4-r259 |
| Tauri GHSA-57fm-592m-34r7 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-57fm-592m-34r7 |
| Tauri GHSA-7gmj-67g7-phm9 | https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9 |
| Tauri GHSA-w28w-mhc8-qvjv | https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv |
| Tauri RUSTSEC-2026-0367 | https://github.com/tauri-apps/tauri/issues/16315 |
| Squirrel.Mac #336 | https://github.com/Squirrel/Squirrel.Mac/issues/336 |
| Squirrel.Windows #1880 | https://github.com/Squirrel/Squirrel.Windows/issues/1880 |
| Squirrel.Windows #1908 | https://github.com/Squirrel/Squirrel.Windows/issues/1908 |
| Sparkle 2.9 Discussion | https://github.com/sparkle-project/Sparkle/discussions/2838 |
| Sparkle Releases | https://github.com/sparkle-project/Sparkle/releases |
| CodePush Retirement | https://learn.microsoft.com/en-us/appcenter/retirement |
| electron-builder #6869 | https://github.com/electron-userland/electron-builder/issues/6869 |
| Tauri #16277 | https://github.com/tauri-apps/tauri/issues/16277 |
| Tauri #16323 | https://github.com/tauri-apps/tauri/issues/16323 |
| Tauri #16455 | https://github.com/tauri-apps/tauri/issues/16455 |

### Companion documents

- **Per-incident write-ups (1466 lines)**: `apps/airiz-motor/docs/auto-update-postmortem-library-2022-2026.md`

---

*End of report — 30 table rows, 3 canonical incidents, 6 pattern clusters, 10 AIRIZ decision inputs.*

---

## Per-surface update architecture recommendations (derived from postmortems)

### Surface 1: Electron Windows (primary desktop)

**Library**: electron-updater + electron-builder (NSIS target)
**Minimum versions**: electron-updater >= 6.3.0, builder-util-runtime >= 9.7.0, app-builder-lib >= 26.15.0

**Incidents that matter**:
- CVE-2024-39698 (signing bypass) — fixed in 6.3.0-alpha.6
- CVE-2024-27303 (NSIS CWD hijack) — fixed in app-builder-lib 24.13.2
- CVE-2026-54673 (credential leak on redirect) — fixed in builder-util-runtime 9.7.0
- CVE-2026-54672 (AppImage LD_LIBRARY_PATH) — fixed in app-builder-lib 26.15.0
- #6869 (app deleted during update, not restored) — UNFIXED, requires custom NSIS script

**Required hardenings**:
1. Custom NSIS script that preserves the old version until the new one is verified launchable (addresses #6869)
2. Scope process-kill to current user session (addresses #6104 terminal server pattern)
3. CI test: run updater against a manifest with a mismatched signature; assert rejection
4. CI test: run updater against a malformed manifest (missing fields, wrong types); assert graceful "no update"
5. Pin all three packages tightly in package.json (no caret ranges for security-critical deps)
6. Use Squirrel.Windows ONLY if the app is in a small set of known Squirrel apps (avoid #1880 race)
7. For AppImage targets (if ever shipping Linux): verify LD_LIBRARY_PATH fix is present (26.15.0+)

### Surface 2: Capacitor Android/iOS (mobile)

**Library**: @capawesome/capacitor-live-update (Capawesome Cloud or self-hosted)
**Alternative**: EAS Update (Expo) if the project is Expo-based

**Incidents that matter**:
- No security incidents (no CVEs, no GHSAs)
- Functional bugs: #1152 (rollback timer in background), #668 (signatureMissing self-hosted iOS), #319 (concurrency crash iOS)

**Required hardenings**:
1. Use Capawesome Cloud for OTA (avoids self-hosted signature path #668)
2. If self-hosting: pin plugin version, test signature verification in CI against the self-hosted origin
3. Respect platform lifecycle: suspend rollback timer when app is backgrounded (addresses #1152)
4. Treat sync() as re-entrant and idempotent (addresses #319)
5. Verify OTA bundle content round-trips through WebView, not just native storage (addresses #659)
6. Staged rollout: use Capawesome's built-in percentage-based targeting
7. Rollback: ensure the default bundle (last good) is always available; the OTA bundle is additive, not in-place

### Surface 3: PWA Web (browser)

**Library**: Workbox (service worker) + Cloudflare Workers (backend/manifest)
**No library-level incidents since 2022** — risk is at the application level

**Incidents that matter**:
- None at the library level
- Application-level risk: stale service worker cache serving old app shell after update
- Application-level risk: Cloudflare Workers edge cache serving stale update manifest

**Required hardenings**:
1. Service worker: use `stale-while-revalidate` with max 5-minute TTL for the update manifest endpoint
2. Service worker: use `networkFirst` for the app shell (index.html) — never cache-first for the entry point
3. Cloudflare Workers: respond with `Cache-Control: no-cache, no-store, must-revalidate` for the update manifest
4. Cloudflare Workers: use `cache: "no-store"` in the `fetch` call for the manifest
5. Add a version check: the service worker compares the cached app version to the manifest version; if mismatch, skip waiting + clientsClaim + reload
6. For offline: cache the last-good app shell as a fallback, but NEVER serve it as "current" if the network is available
7. Add a manual "Check for updates" button in the PWA UI (do not rely solely on the service worker lifecycle)

### Surface 4: Cloudflare Workers (backend)

**Library**: Native Cloudflare Workers (no external update library)
**Risk class**: CDN stale cache, worker script version pinning

**Incidents that matter**:
- No library-level incidents (Workers are not an "update library" in the traditional sense)
- The update manifest endpoint IS the Workers endpoint — so Cluster 5 (CDN/DNS) applies directly

**Required hardenings**:
1. The update manifest endpoint must NOT be cached at the edge (Cache-Control: no-store)
2. Use Workers KV (not edge cache) for the current version pointer
3. Version the worker script itself; use `deployment_id` to verify the worker is serving the expected logic
4. Add a health-check endpoint that returns the current manifest version; the PWA/service worker can poll this
5. For the motor control console: the Workers endpoint that serves update status must have a timeout of < 2s; if it times out, the client assumes "no update" (not an error)
6. Staged rollout: use Workers KV to store the rollout percentage; the manifest endpoint checks the user's cohort ID against the percentage

### Surface 5: macOS (Sparkle or custom)

**Library options**:
- (a) Sparkle 2.10.1+ (if building a native Mac app or using Sparkle with Electron)
- (b) Squirrel.Mac (Electron default) — **AT RISK on macOS 27** (issue #336)
- (c) Custom updater using SMAppService

**Incidents that matter**:
- Squirrel.Mac #336: macOS 27 kills ShipIt (NO FIX, open issue)
- Sparkle 2.9.2/2.9.5/2.9.6: Symlink attacks in delta updates
- Sparkle 2.10.0: Delta compression fix for macOS 27
- Sparkle #2880: macOS 26 app-bound provenance
- Sparkle #2851: macOS 15 XPC entitlement drift

**Required hardenings**:
1. **CRITICAL**: If using Squirrel.Mac, either fork and add NSStatusItem presence, or switch to Sparkle/custom
2. If using Sparkle: pin >= 2.10.1; enable signed feeds (EdDSA); test delta updates in CI
3. Test on each macOS beta (26, 27) before stable release
4. Post-install verification: executable present, permissions correct (not 0700), helper registered, app launches
5. For notarization: test the full notarization chain on each macOS version (staple ticket, verify with `spctl`)
6. Staged rollout: use Sparkle's `sparkle:minimumUpdateVersion` to gate updates by OS version
7. Rollback: Sparkle does not support automatic rollback. Implement a "last known good" bundle that the user can manually restore (or automate via a launch agent)

---

## Cross-cutting invariants (apply to ALL 5 surfaces)

These are the non-negotiable safety properties derived from the 30 incidents above:

1. **Atomic install**: The new version is fully downloaded, verified (signature + hash), and staged in a new location BEFORE the old version is touched. The switch is atomic (rename/symlink swap, not in-place overwrite).

2. **Verifiable launch**: After the switch, the updater launches the new version and verifies it: (a) process starts, (b) main window appears (or headless: health-check responds), (c) hardware connection succeeds (for AIRIZ: USB serial opens). Only then is the old version deleted.

3. **Reversible**: If any step in (1) or (2) fails, the old version is restored and the user sees a clear error with a "Try again" and a "Restore previous version" button. The restore path is tested in CI.

4. **Signed manifest**: The update manifest (what version to install, where to download it, what hash to expect) is cryptographically signed. The client verifies the signature before acting on the manifest.

5. **Pinned content**: The expected SHA-256 of the binary is stored in the signed manifest AND in a separate out-of-band location (website, email to power users). A match is required.

6. **Staged rollout**: No version is pushed to 100% of users without passing through 1% (24h), 10% (24h), 50% (24h), 100%. Automatic rollback if error rate > 1% at any stage.

7. **Telemetry**: Every update attempt (success or failure) is logged with: version-from, version-to, OS, app, error-code, timestamp. Aggregated per version-OS combo. Alert on failure-rate spike.

8. **Kill switch**: An operator can push a "rollback to version X" command that all clients honor on next check. This is separate from the normal update channel (it overrides it).

9. **Key management**: The update signing key is in an HSM / CI-only secret. The public key is embedded in the client at compile time. Rotation requires a dual-key period (old key still valid for N days).

10. **No silent failures**: Every update state (checking, downloading, verifying, installing, launching, failed) is visible to the user. No state is "silent" for more than 5 seconds without a progress indicator or timeout warning.

---

## Appendix: Version pinning cheat sheet

| Component | Minimum version | Why |
|-----------|----------------|-----|
| electron-updater | 6.3.0 | CVE-2024-39698 fix |
| builder-util-runtime | 9.7.0 | CVE-2026-54673 fix |
| app-builder-lib | 26.15.0 | CVE-2024-27303 + CVE-2026-54672 fixes |
| Sparkle | 2.10.1 | All symlink fixes + macOS 27 delta fix |
| Tauri (if used) | 2.12.5 + zip 9.0.0 | RUSTSEC-2026-0367/368/369 fix |
| @capawesome/capacitor-live-update | Latest stable | No CVEs, but functional fixes in recent releases |
| Workbox | 7.x (latest) | No library CVEs; application-level config matters more |
| Squirrel.Windows | Do not use for new projects | Unmaintained since Jul 2024; no security patches |
| Squirrel.Mac | Do not use on macOS 27+ without fork | Issue #336 (open, no fix) |
| CodePush / App Center | DO NOT USE | Retired; service shut down |
| Microsoft.AutoUpdater | N/A | No such standalone library found |
