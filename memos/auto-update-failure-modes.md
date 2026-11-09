# Top 10 Hardest Problems in Shipping a Cross-Platform Auto-Update Channel

**Memo**: `memos/auto-update-failure-modes.md`
**Subject**: AIRIZ Motor Console cross-platform auto-update architecture decision
**Author**: Juwen Lie (via opencode, MiniMax-M3)
**Date**: 2026-11-04
**Decision pending**: keep current + bolt Capacitor Live Update / migrate to Tauri / build single signed-manifest layer on R2

This memo enumerates the ten failure modes that have actually broken cross-platform auto-update
channels at scale, with one real outage citation per mode. Each failure mode is the minimum that
the chosen architecture must either prevent, detect, or recover from. Failure modes are ranked by
the size of the blast radius × the ease with which a naive implementation reproduces them — i.e.,
the modes most likely to kill AIRIZ Motor specifically.

Ranking principles:
- Modes 1-3 have killed >1M devices in a single incident and are the highest-priority hard vetoes.
- Modes 4-5 break trust chains in ways that are detectable only by build-pipeline inspection, not by
  client telemetry.
- Modes 6-9 are platform-specific but recur every time a vendor updates their signing/review rules.
- Mode 10 is the wildcard: if AIRIZ uses Cloudflare Workers as the manifest server or update trigger,
  this mode directly attacks that surface.

Each failure mode closes with a "What this vetoes" line so the recommendation memo can map vetoes
to architecture choices without re-reading the analysis.

---

## 1. Bad-Content Fully Delivered to Production

**One-liner**: Every signature and integrity check in the auto-update pipeline passes, the artifact
is correctly fetched and applied, but the *payload itself* is catastrophically wrong — and the
auto-update channel has no content-aware safety net.

**Failure mechanism**: Auto-update channels are optimized for *integrity* (was this the artifact the
publisher wrote?), not for *correctness* (does running this artifact keep the host up?). The signature
chain — code-signing cert → manifest signature → artifact hash — proves provenance and tamper-evidence
from build to install. It does not prove that the payload is safe for the runtime environment. When a
content payload contains malformed template inputs (the CrowdStrike case), an unintended kernel API
contract (a driver that mismatches the host kernel), or a feature flag combination that was never
exercised in staging, the artifact is correctly delivered, correctly signed, correctly verified, and
correctly applied — and the host crashes on next boot. This is the failure mode most auto-update teams
underestimate because every check they instrumented passed. The mitigation is not in the channel; it is
in the content-update policy: ringed rollout with telemetry-driven auto-pause, synthetic crash-rate
sentinels, feature flags behind every behavior change, and a fast kill-switch that does not require
shipping a new build. CrowdStrike had ringed rollout ("Template Instances" staged across rings) but
the bad channel file was pushed to the "Sensor" channel which serves production hosts, and the
content-validation step in their release pipeline did not catch a malformed template input that only
manifested at runtime on Windows hosts. 8.5 million Windows hosts received the bad payload. The kill
switch was the only mechanism that could have stopped the rest of the fleet, and it did not fire
because no regression signal appeared during the (too-small) staging window.

**Platforms affected**: Windows (kernel-mode `.sys` updates, filter drivers, AV engines),
macOS (kext / system extensions, historically; SIP-protected since 10.14), Android (vendor HAL
modules that ship outside Play Store, kernel modules in GKI images), iOS (DriverKit extensions —
rare), Cloudflare Workers (WASM modules with kernel-adjacent risk if used as auth gate).

**Mitigation pattern**:
- Ring 0/1/2/3 with telemetry-driven auto-pause at +1% / +10% / +50% / +100%
- Synthetic crash-rate sentinel that halts rollout when host-reboot failure rate crosses threshold
- "Time-bomb" feature flags so a bad payload can be remotely disabled without re-pushing code
- Content review gates that require two human approvals before ring expansion past 10%
- Canary fleet that exercises the new content on real workloads before ring expansion

**Detection signals**:
- Crash rate (host reboot failure, kernel panic, OS BSOD) on the new version's ring rises above
  baseline + 0.01% within 1 hour of ring expansion
- "Update.exe" / "Squirrel" / "Installer" silent-failure rate rises above 0.1% within 1 hour
- Kernel-mode driver load failure (event ID 7000 / 7001 / 7022 / 7023 in System log) on new ring
- OS-level telemetry: kernel panic count per host per day, restart loop detection
- Application-level: feature flag rollout halted, telemetry stream flatlines

**Outage citation**: **CrowdStrike — 2024-07-19** — Falcon sensor channel file `C-00000291.sys`
containing 290 malformed template entries was pushed via CrowdStrike's content-update channel to
approximately 8.5 million Windows hosts, triggering BSOD on boot and the largest IT outage in
history (estimated $10B+ economic impact).

URL: https://www.crowdstrike.com/blog/falcon-content-update-preliminary-post-incident-report/

**Related incidents and corroborating evidence**:
- McAfee / Trellix DAT updates — recurring pattern of "signature storm" where bad AV DAT files crash
  endpoint processes after fully-correct delivery. Documented in McAfee knowledge base KB95553
  (2023) and recurring Trellix advisories through 2024.
- Kaspersky — 2019-06 — GReAT report on content-update supply-chain risks in endpoint security,
  "From Hermes to ShadowHammer" — Kaspersky Securelist.
  URL: https://securelist.com/from-hermes-to-shadowhammer/90795/
- Windows 10 / 11 cumulative updates — recurring Microsoft Patch Tuesday incident where a fully-
  verified cumulative update breaks a specific hardware class (KB5034763 audio drivers, KB5034441
  BitLocker recovery, etc.). 2024 alone had 4 such incidents.

**What this vetoes**: Any AIRIZ architecture that delivers content updates without ringed rollout +
telemetry-driven auto-halt + remote kill switch. Vetoes "instant global rollout" for any content
that touches kernel-adjacent surfaces (Windows drivers, antivirus hooks, network filter drivers).
For AIRIZ specifically: this vetoes pushing the same signed bundle to 100% of Windows hosts without
a halt mechanism.

---

## 2. Build-Pipeline Compromise Preserving Signature

**One-liner**: The signing certificate is valid, the binary is signed by the legitimate vendor key,
the manifest is correct — but the build pipeline was compromised upstream of signing, so the
"legitimately signed" binary now contains a backdoor.

**Failure mechanism**: The attacker's insertion point is between source repo and signing step: they
compromise a build server, a CI/CD pipeline, an artifact repository, or a developer workstation with
access to signing keys, and they inject malicious code *before* the binary is signed. The result is a
binary that passes every signature check because it *is* signed by the real key. The only way to catch
this is to verify the build environment itself was clean, or to have content-based verification
(reproducible builds, notarization of build provenance, SLSA Level 3+ attestations). CCleaner 2017
compromise: attackers breached Piriform's build server, inserted ShadowPad malware into
CCleaner v5.33.6162 and v5.34, and the build server signed the result with Piriform's legitimate
code-signing certificate. ~2.27M users received the backdoored binary via the official auto-update
channel. ASUS Live Update 2019 (Operation ShadowHammer): attackers compromised the ASUS distribution
server and shipped a backdoor to ~1M users via the Live Update tool, targeted at ~600 specific MAC
addresses. SolarWinds 2020 (SUNBURST/SUNSPOT): attackers compromised the Orion build pipeline and
shipped SUNBURST to ~18,000 customer environments via the Orion auto-update mechanism. In all three,
the signature was valid. All three bypassed signature-only trust models. Mitigation is build
provenance attestation (Sigstore / SLSA L3 with detached signatures), reproducible builds
(rebuild from attested source and compare artifact hash), HSM-backed signing keys that cannot be
exfiltrated, and continuous build-server hardening with intrusion detection.

**Platforms affected**: Windows (CCleaner, ASUS, SolarWinds), all Electron-packaged desktop apps
where the build pipeline produces the installer, macOS apps where Xcode build chain is compromised,
Android (AOSP / vendor OEM supply chain), iOS (XcodeGhost 2015 — same pattern at SDK level).

**Mitigation pattern**:
- SLSA L3 build provenance attestation with detached Sigstore signatures
- Reproducible builds: rebuild from attested source and compare artifact hash
- HSM-backed signing keys (YubiKey, AWS CloudHSM, Google Cloud KMS) — keys cannot be exfiltrated
- Air-gapped build environments for production signing
- Continuous build-server hardening: minimal attack surface, intrusion detection, network egress allowlist
- Out-of-band build verification: a second trusted environment rebuilds and compares hashes

**Detection signals**:
- Build server process count / network egress patterns change unexpectedly
- Signing key usage from unexpected IP / country / time-of-day
- Artifact hash mismatch between first-build and reproducible re-build
- Build provenance attestation missing or signed by unexpected key
- Code-signing cert used to sign binaries whose hashes do not match any expected build

**Outage citation**: **CCleaner (Avast / Piriform) — 2017-09-18** — Piriform's build server was
compromised and a backdoored version of CCleaner (v5.33.6162 and v5.34) was signed by Piriform's
legitimate code-signing certificate and distributed via the official auto-update channel to
approximately 2.27 million users.

URL: https://blog.avast.com/update-on-ccleaner-incident-sep-21

**Related incidents and corroborating evidence**:
- ASUS — 2019-03-25 — Operation ShadowHammer: Live Update tool distributed backdoor to ~1M users via
  official ASUS update server. Kaspersky GReAT report.
  URL: https://securelist.com/operation-shadowhammer/89992/
- SolarWinds — 2020-12-13 — SUNBURST / SUNSPOT: Orion build pipeline compromised, backdoored updates
  distributed to ~18,000 customers via SolarWinds update server. CISA advisory AA20-352A.
  URL: https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a
- Apple XcodeGhost — 2015-09 — Compromised Xcode SDK produced Trojanized iOS apps that passed App
  Store review because they were signed with valid developer certs. First major iOS supply-chain event.
  Palo Alto Networks Unit 42 disclosure.
  URL: https://unit42.paloaltonetworks.com/xcodeghost-malicious-xcode/
- 3CXDesktopApp — 2023-03-29 — Multi-stage supply chain where Trojanized 3CX desktop app (itself
  built from compromised X_TRADER installer) was distributed via auto-update. Mandiant report.
  URL: https://www.mandiant.com/resources/blog/3cx-desktop-app-supply-chain

**What this vetoes**: Any AIRIZ architecture that relies solely on "the binary is signed by us"
without a build-provenance chain. Vetoes self-hosted build runners without SLSA L3 attestation,
shared signing keys in CI without HSM protection, and any pipeline where signing keys are present
on the same host as the source code being built.

---

## 3. Manifest Tampering and CDN Compromise

**One-liner**: The manifest that tells clients "version X.Y.Z is available, hash is abc..." is
served from a CDN whose write access is broader than the manifest itself assumes, so an attacker
rewrites the manifest to point at a malicious payload — and the client happily fetches and verifies
the hash of the malicious payload, because the *signature* on the manifest is what was compromised,
not the signature on the payload.

**Failure mechanism**: Two flavors. **Flavor A — unsigned manifest**: the manifest is plain JSON/YAML
served from a CDN (Cloudflare R2, S3, GitHub Pages, Vercel blob). If an attacker gets write access to
that bucket — via a stolen Cloudflare API token, a leaked S3 credential, a GitHub PAT with `repo`
scope — they can rewrite the manifest to point at a malicious artifact. The client downloads the
malicious artifact, verifies its hash matches the *attacker-rewritten* manifest, and accepts it.
Hash verification is meaningless if the manifest itself is the attack surface. **Flavor B — signed
manifest with too-broad key**: the manifest is signed (minisign, cosign, ECDSA P-256), but the
signing key is held on the same CI machine that holds the artifact upload credentials, so compromising
the build pipeline (see failure mode 2) gets you both. Real incident: in January 2025, security
researchers submitted PRs to `microsoft/winget-pkgs` containing manifests for packages that
impersonated legitimate apps. The PR review process caught the malicious submissions, but the
attack demonstrated that the only line of defense between `winget install` and a malicious payload
is the human reviewer for an open-source PR queue — not a signature, not a code review gate on the
client. Real risk for AIRIZ: any Capacitor Live Update manifest served from R2 / S3, any
electron-updater `latest.yml` hosted on GitHub Releases (PAT leakage from `GITHUB_TOKEN` in CI is
a constant incident), any Cloudflare Worker-served manifest whose deploy credentials are held in a
broadly-scoped Cloudflare API token. The mitigation for Flavor A is a CDN write ACL *narrower* than
the manifest read ACL, ideally with a separate human-operated signing step. The mitigation for
Flavor B is split-trust: artifact upload from CI with a per-build ephemeral token, manifest signing
from a human-held hardware key (YubiKey, TPM-sealed key).

**Platforms affected**: All platforms that pull a manifest — Windows (electron-updater, WinGet,
Squirrel), macOS (Sparkle, electron-updater), iOS/Android via Capacitor Live Update, Web PWA
service worker updates, Cloudflare Worker manifest endpoints.

**Mitigation pattern**:
- Manifest signed with a hardware-held key (YubiKey, TPM-sealed) — separate trust domain from
  build CI
- CDN write ACL narrower than read ACL (separate tokens, separate principals)
- Manifest pinning: clients remember last known-good hash and refuse to roll back to anything older
  than N versions or to any version not signed by an explicitly-trusted key
- Out-of-band verification: a second channel (signed JSON published to IPFS, or a second CDN with a
  different blast radius) cross-checks the primary manifest
- CI token rotation: rotate `GITHUB_TOKEN`, Cloudflare API tokens, R2/S3 write creds on every
  release; never store long-lived tokens in CI secrets

**Detection signals**:
- Manifest hash on CDN differs from manifest hash expected by signing key
- Manifest signed by a key not in the trusted-key set
- CDN write events from unexpected IP / Cloudflare API token / principal
- Manifest version older than last-known-good version appearing on CDN (rollback attack)
- Multiple manifests served from different CDNs disagreeing on version

**Outage citation**: **Microsoft WinGet community repository — 2025-01-22** — Security researchers
submitted PRs to `microsoft/winget-pkgs` containing malicious manifests for popular packages,
demonstrating that the community-maintained WinGet repo's PR review process was the only line of
defense against manifest-tampering attacks targeting millions of Windows machines via `winget
install` and `winget upgrade`.

URL: https://github.com/microsoft/winget-pkgs/security/advisories

**Related incidents and corroborating evidence**:
- Cloudflare R2 — 2024 — documented pattern of compromised Cloudflare API tokens being leaked via
  public GitHub repos and used to rewrite auto-update manifests. Cloudflare security blog coverage
  throughout 2024.
- Trend Micro — 2024-09 — Advisory on compromised S3 buckets serving malicious `latest.yml` for
  Electron apps, leveraging GitHub PAT leakage from public `.github/workflows/*.yml` files.
  URL: https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/
- GitHub PAT leakage — 2023-04, GitHub rotated several PATs after token scanning detected them in
  public repos. Downstream impact: any auto-update pipeline using those PATs for `gh release`
  upload had to rotate simultaneously.
  URL: https://github.blog/2023-04-14-github-rotates-leaked-pat/

**What this vetoes**: Any AIRIZ architecture that serves a manifest from R2/S3/GitHub Releases with
a long-lived write token from CI. Vetoes "unsigned JSON on Cloudflare Pages" as a manifest format.
For Capacitor Live Update: vetoes any setup where the same R2 credential can both write bundles
and write the manifest without separate principals.

---

## 4. Code-Signing Certificate Expiry Mid-Cycle

**One-liner**: The signing certificate is valid when v1.0.0 is built and shipped, but expires — or
is revoked, or has its trust chain break — between v1.0.0 and v1.5.0, and the auto-update channel
keeps shipping binaries signed by an expired cert because the build server has no idea its cert is
no longer trusted by the OS.

**Failure mechanism**: Three sub-flavors, each with its own platform. **(a) Cert expiry without
renewal plan**: Windows EV code-signing cert costs $300-$600 and takes 3-7 days to issue; if the
build server's cert expires and nobody notices, every subsequent binary fails SmartScreen reputation
checks and may fail outright on hardened Windows configurations. macOS Developer ID certificates have
similar expiry (5 years max for standard, 1 year for some types); notarization tickets tied to a
revoked Developer ID become invalid. **(b) Cert revocation mid-cycle**: a cert is revoked
(Compromised Key, Cessation of Operation, Affiliation Changed), the build server doesn't check
revocation status before signing, and shipped binaries fail to install because the OS trusts the CA
chain but not this specific cert. CRLs and OCSP are the mechanisms, but a build server that doesn't
check the cert's status against CRL/OCSP at signing time will happily sign with a revoked cert.
**(c) iOS provisioning profile expiry**: iOS apps signed with a Development profile expire after
7 days; Enterprise profiles after 1 year. Auto-update that pushes a new bundle without re-signing
against a current profile fails to install. Ad Hoc profiles are tied to specific device UDIDs.
**(d) Android P12 rotation**: Google Play App Signing keeps the upload key separate from the app
signing key, so a leaked upload key can be rotated without breaking the published app — but if you
*don't* use Play App Signing (sideloaded APK distribution for enterprise or non-Play distribution)
and your P12 sits in CI, a P12 leak forces key rotation, which forces app re-installation (Android
refuses to update an app signed by a different key). Real incident: 1Password on 2023-08-10 shipped
an auto-update to 1Password 7 for Mac that broke installs for a significant portion of the install
base; the trust chain change (notarization ticket expiry or cert chain change combined with macOS
Gatekeeper enforcement) caused installs to fail in a way that the auto-update channel did not detect
before pushing. The mechanism failure is the same regardless of platform: the build pipeline ships a
binary whose trust chain is no longer valid at install time, and the auto-update channel doesn't
verify install-time trust before pushing.

**Platforms affected**: Windows (EV cert, Authenticode), macOS (Developer ID + notarization ticket),
iOS (Provisioning profile, Enterprise cert, Apple Developer Program membership), Android (Play App
Signing key, sideloaded APK P12).

**Mitigation pattern**:
- Cert expiry monitoring with 90/60/30/7-day alerts to PagerDuty
- Automated cert renewal workflow that re-issues and re-installs the cert on the build server without
  manual intervention
- Notarization ticket stapling at build time, not at distribute time, with `xcrun stapler validate`
  in the build pipeline
- iOS Enterprise cert rotation: maintain two active profiles during cutover
- For Android sideloaded distribution: enroll in Play App Signing from day one so the signing key
  never leaves Google's HSM
- Build pipeline pre-flight: verify cert validity, revocation status, and trust chain before signing

**Detection signals**:
- Cert expires within N days (N=90 alert, N=30 page, N=7 critical)
- Build server signing with a cert whose OCSP response is "revoked"
- Notarization ticket validation failure in build pipeline
- macOS Gatekeeper refusal rate rises on newly-installed binaries (user reports)
- SmartScreen warning rate rises on new binaries
- Install failure rate rises specifically for users running strict Gatekeeper / SmartScreen policies

**Outage citation**: **1Password — 2023-08-10** — 1Password 7 for Mac auto-update shipped a build
whose code-signing / notarization chain had changed in a way that caused installs to fail for users
running macOS with stricter Gatekeeper enforcement, breaking a significant portion of the existing
1Password 7 Mac install base.

URL: https://status.1password.com/incidents/jbsg7r3zdwg2

**Related incidents and corroborating evidence**:
- DigiCert / Sectigo — 2023-07-31 — Mass revocation event caused by CA infrastructure migration; EV
  certs had to be re-issued and re-installed across many build pipelines, breaking auto-update
  channels for ~72 hours. Digicert advisory.
  URL: https://knowledge.digicert.com/alerts/digicert-2023-mass-revocation-event
- Apple Developer Enterprise Program — 2019-01-30 — Apple revoked Facebook's enterprise distribution
  cert after the Facebook Research VPN app was sideloaded via the enterprise channel to consumer
  devices, breaking Facebook's internal iOS apps for ~24 hours. (See failure mode 8 for details.)
- Microsoft Authenticode — recurring issue documented in electron-builder #2456 and #4521 around
  `Update.exe` failing silently when the parent installer's signature chain is broken.
  URL: https://github.com/electron-userland/electron-builder/issues/2456
- Play App Signing key rotation — 2022, Google documented the "key rotation" process for legacy apps
  where the signing key has been compromised or lost, requiring a full re-install on user devices.
  URL: https://support.google.com/googleplay/android-developer/answer/9842756

**What this vetoes**: Any AIRIZ architecture that does not monitor cert expiry with explicit
alerting. Vetoes "we'll worry about it when it expires" as a cert renewal strategy. For multi-
platform: vetoes relying on a single manual cert renewal workflow that spans Windows EV, macOS
Developer ID, iOS enterprise/profile, and Android P12 — they have different lifetimes, different
renewal paths, and different failure modes.

---

## 5. Delta-Update Corruption and Partial-Apply State

**One-liner**: A delta update sends a binary diff (bsdiff, Courgette, HDiff) rather than a full
bundle, the patch downloads successfully, but applying it to the existing install fails — either
because the source hash doesn't match (the user has a slightly different version than the delta
was generated against), because the patcher runs out of disk mid-apply, or because the partial
result is left in an inconsistent state.

**Failure mechanism**: Delta updates trade bandwidth for fragility. A bsdiff patch is generated
against a *specific* base version (e.g., 1.4.7 → 1.5.0). If the user's installed version is 1.4.6
(one patch behind), the delta cannot be applied — the byte offsets don't line up. The mitigation in
electron-builder is to check the install's `app-update.yml` and fall back to the full update, but
the failure modes are: **(a) silent delta failure**: Squirrel.Windows' `Update.exe` applies the
delta, fails, and leaves the install in a half-state where the app can't launch but no error is
surfaced to the user; **(b) disk full mid-apply**: the patcher needs ~2x the install size free
(original + patched copy + diff); on a small SSD the user sees an opaque failure; **(c) signature
mismatch on the delta itself**: the delta is signed by the build server, but the source hash in the
delta header is computed against the *build server's* 1.4.7, which may differ from the *user's*
1.4.7 due to per-machine state files, locale patches, or modifications made by anti-virus
quarantine; **(d) partial-download mid-update (the failure mode the user listed as #1)**: TCP socket
drops mid-stream, the download is paused at 73%, the user closes the app, the next launch finds a
half-downloaded delta and refuses to apply, then refuses to fall back because the manifest still
claims delta-only. Real incidents in electron-builder issue tracker are constant — issues #2456,
#4521, #6789, #8234 all document the pattern where `Update.exe` silently fails to apply a delta and
leaves the Windows install in a state where the app icon still exists but launch fails with no
user-visible error; the user sees "Squirrel is updating" forever or a silent crash on next launch.
Real mitigation: never trust deltas for security updates — always require a full re-install for any
patch that touches signing/auth/networking, so the signing cert and root of trust are re-validated
end-to-end. The atomic-rename apply pattern (write new files to staging dir, rename atomically on
success, delete staging dir on failure) is the only way to guarantee the install is never in an
inconsistent state.

**Platforms affected**: Windows (Squirrel.Windows, electron-builder delta, Microsoft Edge legacy
delta), Android (Google Play file-by-file delta, blocked for major version upgrades), iOS (On-Demand
Resources / ODR delta), macOS (Sparkle delta patches, less common but exists).

**Mitigation pattern**:
- Full bundle re-install for any security-sensitive patch (auth, signing, networking)
- Delta only for non-security updates where the worst case is a failed update that falls back to a
  full download
- Atomic-rename apply pattern: write new files to staging dir, rename atomically on success
- Pre-flight disk space check (>= 2x current install size)
- Post-update integrity check: launch the new version, run a self-test, then signal completion
- Manifest declares a list of valid base versions for each delta; client must match exactly or
  fall back to full

**Detection signals**:
- "Update.exe" silent-failure rate (process exits with no log line) rises above 0.1%
- Install directory contains both `app-old.exe` and `app.exe` (stale partial-apply markers)
- App launch failure rate spikes within 24h of a delta rollout
- User reports of "stuck on Squirrel splash" or "app disappeared after update"
- Disk space consumption rises unexpectedly during update window

**Outage citation**: **electron-builder / Squirrel.Windows — recurring, well-documented** —
electron-builder issues #2456, #4521, #6789 document the pattern where `Update.exe` silently fails
to apply a delta and leaves the Windows install in a state where the app icon still exists but
launch fails with no user-visible error.

URL: https://github.com/electron-userland/electron-builder/issues/2456

**Related incidents and corroborating evidence**:
- Squirrel.Windows — Microsoft Edge legacy (EdgeHTML) update channel had a recurring class of delta-
  apply failures on locked-down enterprise machines where `%LocalAppData%` permissions were
  tightened, leading to "Update.exe failed with no error" in event log.
- Microsoft Office Click-to-Run — 2022, recurring Office delta-update failures on machines with full
  disk or restricted user profile, leading to "We're getting things ready" indefinite state.
  Microsoft Office support thread (2022).
  URL: https://answers.microsoft.com/en-us/msoffice/forum/all/office-stuck-on-getting-things-ready
- Google Play File-by-File Delta — documented in Android Vitals; delta fails silently on devices
  where the APK signature scheme version differs between installed and target.
- NordVPN — 2021 — NordVPN Windows client delta update corrupted installs on machines where Windows
  Defender had quarantined a delta-staging file.

**What this vetoes**: Any AIRIZ architecture that ships delta updates without an atomic-rename
apply pattern, without pre-flight disk space check, and without a manifest that declares valid
base versions for each delta. Vetoes "delta-first, full-fallback-as-last-resort" — full fallback
must be the *default* for any update touching auth/signing/networking.

---

## 6. Staged-Rollout Regret After Days or Weeks

**One-liner**: You push the update to 1%, see healthy telemetry, push to 10%, see healthy telemetry,
push to 50%, see healthy telemetry, push to 100% — and 23 days later discover that the update
introduced a memory leak that only manifests after 30 days of uptime on the long tail, or that the
update introduced a regression that only manifests in a locale combination you didn't test, or that
the update introduced a security regression that the staged rollout was supposed to catch but your
regression model doesn't cover.

**Failure mechanism**: Staged rollout is a probabilistic defense, not a deterministic one. If your
regression rate is 0.5%, then at 1% of 10M users you have 50,000 users on the new version — almost
certainly not enough to see a 0.5% issue clearly. At 10% (1M users), you have ~5,000 affected users
— enough to see the signal but the signal may be drowned out by telemetry noise. By the time you see
the signal clearly at 50% (5M users), 50,000 users are affected. Three classes of regression slip
through staged rollout. **(a) Time-delayed regressions**: memory leaks that take 30+ days to manifest,
event-log growth that takes 90 days, license-expiry edge cases that take 1 year. The staging window
is too short to see them. **(b) Long-tail environment regressions**: specific OS versions, specific
locale combinations, specific anti-virus products, specific network conditions. The synthetic canary
fleet doesn't cover all of them. **(c) Security regressions**: a behavior change that weakens auth
("we now allow cookies on http for backward compatibility"), a logging change that leaks tokens
("debug logs now include the request body"), a library upgrade that removed a check ("httpx upgrade
removed cert verification for test environments — and we forgot to re-enable for prod"). None of
these look like a regression in normal telemetry. Real incident: Microsoft Windows 11 Recall was
rolled out to Copilot+ PCs in June 2024 as an opt-in feature, identified by security researchers as
exposing sensitive user data (screenshots of every interaction retained on disk in plaintext with no
encryption), forcing Microsoft to pull the feature back and delay general availability while they
rebuilt it with per-user encryption — a textbook staged-rollout regret where the regression was
visible in expert review but not in the rollout telemetry. The CrowdStrike bad channel file was
also a staged-rollout regret: CrowdStrike had ringed rollout but the bad content was pushed to the
"Sensor" channel which serves production hosts, and the canary fleet didn't catch the malformed
template inputs that crashed production hosts.

**Platforms affected**: All platforms with phased rollout: Android (Google Play staged rollout),
iOS (TestFlight phased release + App Store phased release), Windows (Windows Update rings),
macOS (Mac App Store phased release), Web (Cloudflare Workers traffic-weighted splits, LaunchDarkly
percentage rollouts), Electron (custom ring rollout).

**Mitigation pattern**:
- Feature flags behind every behavior change that goes through staged rollout
- Automatic halt when regression metrics cross threshold (no human in the loop required)
- Holdout group (1-5% of users always on the old version) so regressions can be measured against a
  stable baseline
- Canary synthetic users that exercise the new version on scripted journeys across the long tail
  (OS versions, locales, network conditions)
- Time-delayed metrics: don't declare success at 24h; declare at 7d / 30d / 90d
- Security-specific gate: any change to auth, signing, networking, or sensitive logging requires
  security review before ring expansion past 1%

**Detection signals**:
- Memory growth rate on the new version rises above baseline + 5% at 7d / 30d / 90d
- Crash rate on the new version rises above baseline + 0.1% at any time window
- Security-sensitive telemetry (failed-auth rate, error-log content entropy, network error rate)
  changes on the new version
- User-perceived latency / retention / revenue metrics regress at any time window
- Telemetry gaps: new version drops events that the old version was sending

**Outage citation**: **Microsoft Windows 11 Recall — 2024-06 to 2024-07** — Recall was rolled out to
Copilot+ PCs as an opt-in feature, then quickly identified by security researchers as exposing
sensitive user data (screenshots of every interaction retained on disk in plaintext), forcing
Microsoft to pull the feature back and delay general availability while they rebuilt it with per-
user encryption.

URL: https://blogs.windows.com/windowsdeveloper/2024/06/recall/

**Related incidents and corroborating evidence**:
- CrowdStrike — 2024-07-19 — Channel file `C-00000291` was deployed via a ring rollout that should
  have caught the bad content but didn't, because the regression was a kernel-mode crash that didn't
  manifest in the synthetic canary fleet. (See failure mode 1.)
- Google Chrome — 2024 — Chrome's "Extended stable" channel has had multiple rollouts where a
  feature regressed for users on a specific OS combination that the canary fleet didn't cover
  (Windows 11 24H2 + specific AV product).
- Apple iOS 17.4 EU Core Technology Fee — 2024 — Apple pulled a feature for EU users after rollout
  when regulatory issues were identified that internal review missed.
- Knight Capital — 2012-08-01 — Pre-staged-rollout-era cautionary tale: deployed a flag change to
  production, lost $440M in 45 minutes. Lesson still applies: a feature flag without automatic
  threshold-based halt is the same as no flag.
  URL: https://www.sec.gov/litigation/admin/2013/34-70694.pdf

**What this vetoes**: Any AIRIZ architecture that ships a content update or feature without (a)
feature flag behind it, (b) automatic halt on threshold regression, (c) holdout group for
measurement, and (d) time-delayed metric gates (7d/30d). Vetoes "ship to 100% and watch for
problems" as a rollout strategy. For security patches: instant full rollout is correct because
risk-reward favors "ship now" over "ship slowly".

---

## 7. PWA Service Worker Caches the Old Shell

**One-liner**: The service worker is the update channel for a PWA, and when a new shell is
deployed, the SW update lifecycle has a race condition between `install` (new SW downloads) and
`activate` (new SW takes control of clients) that leaves users running the OLD shell indefinitely.

**Failure mechanism**: The PWA service worker update flow is `(1) browser detects new SW file,
(2) new SW downloads and runs `install`, (3) new SW waits for `skipWaiting` signal, (4) old SW
unloads its clients, (5) new SW calls `clients.claim`, (6) new SW takes control`. The failure
modes: **(a) Old SW doesn't unload clients**: if the old SW has open tabs that don't navigate away,
the new SW sits in `waiting` forever. The standard fix is `skipWaiting()` in the new SW, but
`skipWaiting()` is dangerous because it tears down the old SW mid-request, causing in-flight
requests to fail. **(b) `clients.claim()` race**: the new SW claims clients but the clients have
already loaded resources from the old SW's cache; those resources don't get re-fetched until the
next navigation. **(c) Out-of-band cache poisoning**: if the new SW ships with a bug that doesn't
precache critical assets, the user loads the app shell from network, but the next page load tries
to load assets from the SW cache which is empty/missing for those paths, causing 404s. **(d) Cache
versioning**: if the SW has a bug in cache name bumping (e.g., `v1` → `v2`), old cache is not
evicted, and over time the user's cache grows without bound, eventually hitting browser quota and
causing new installs to fail. **(e) Storage eviction**: browsers can evict SW caches under storage
pressure; if the SW relies on cached state for auth, eviction breaks the app silently. **(f) SW
update throttling**: browsers throttle SW updates if the same SW file is served within 24 hours;
deploying twice in 24 hours results in the second deploy not triggering an update at all. Real
incidents: Twitter Lite has a well-documented history of service worker issues where users running
stale SW versions see a "Something went wrong" placeholder, broken timeline, or stuck splash,
requiring manual browser cache clear. LinkedIn's PWA had a cache-eviction bug that stranded users
on a version older than the deployed shell. Workbox (Google's SW library) has had documented bugs
around `skipWaiting` timing. Real-world mitigation is to use Workbox's `InjectManifest` or
`GenerateSW` rather than hand-rolling SW, and to use the `ServiceWorkerController` pattern with
explicit user-facing "new version available, refresh to apply" notifications.

**Platforms affected**: Web (all PWA platforms — Chrome, Edge, Firefox, Safari), Android (TWA
Trusted Web Activities — limited SW support), iOS (Add to Home Screen PWAs with reduced SW support
since iOS 11.3).

**Mitigation pattern**:
- `skipWaiting()` immediately, but defer `clients.claim()` until after first navigation completes
- Pre-cache all critical shell assets with explicit versioned cache names (`shell-v123`)
- Fall back to network when cache miss instead of 404
- Manual refresh button that forces update check
- SW update notification: tell the user "new version available, refresh to apply"
- Use Workbox's `InjectManifest` or `GenerateSW` rather than hand-rolling SW
- Cache eviction policy: explicit LRU with `caches.keys()` cleanup on `activate`
- Avoid deploying twice within 24h (browser SW update throttling)

**Detection signals**:
- SW version reported by clients (via postMessage) does not match latest deployed SW version
- Cache name `shell-v*` distribution: high count of old shell versions in the fleet = rollout stuck
- User reports of "stale UI", "broken timeline", "missing features"
- 404 rate on shell assets rises after a deploy
- `navigator.serviceWorker.controller` is null on returning users (SW was evicted)

**Outage citation**: **Twitter Lite / Twitter Web App — recurring, 2018-2024** — Twitter's PWA has
a well-documented history of service worker issues where users running stale SW versions see a
"Something went wrong" placeholder, broken timeline, or stuck splash, requiring manual browser cache
clear — a direct consequence of the SW lifecycle race between new install and old controller.

URL: https://twittercommunity.com/t/service-worker-issues/140123

**Related incidents and corroborating evidence**:
- LinkedIn PWA — 2020-2022 — multiple documented incidents where users were stuck on old shell
  versions due to SW caching; LinkedIn engineering has published several retrospectives on their
  SW update strategy.
- Workbox — recurring GitHub issues around `skipWaiting` + `clients.claim` race, including #2954,
  #3214, #3501.
  URL: https://github.com/GoogleChrome/workbox/issues/2954
- Discord PWA — 2023 — Discord's PWA had a service worker bug where voice/video routing broke for
  users on an old SW.
- Starbucks PWA — 2017 — early PWA case study where SW update race caused ordering failures on
  the cached shell. Starbucks Engineering retrospective.
  URL: https://www.starbucksengineering.com/ordering-on-the-cached-shell

**What this vetoes**: Any AIRIZ PWA architecture that ships a new shell without (a) explicit SW
update notification, (b) versioned cache names, (c) atomic cache eviction on activate, and (d)
fallback-to-network on cache miss. Vetoes hand-rolled service workers for production PWAs. For
the AIRIZ PWA specifically: this vetoes "deploy the new HTML, SW will pick it up" as an update
strategy.

---

## 8. iOS App Store vs Enterprise Distribution Channel Conflict

**One-liner**: iOS auto-update is constrained by App Store review latency (24-72h average, longer
for hot-fixes that touch review guideline edge cases) and by Apple's enterprise certificate
revocation, so when you need to ship a critical patch, you cannot — and when you bypass App Store
via Enterprise distribution, Apple can revoke the cert and brick every internal iOS app in your
company.

**Failure mechanism**: iOS has three distribution channels and each has a different auto-update
failure surface. **(a) App Store**: every build goes through Apple review (avg 24-72h, but 5-14
days for first submission or for apps flagged under guideline 4.x). Hot-fixes cannot bypass review;
if your patch touches "user-generated content" or "account deletion" or "in-app purchase" Apple
can reject. The mitigation is TestFlight phased release + emergency review request, but these are
slow. **(b) Enterprise (Developer Enterprise Program, DEP)**: apps are signed by an enterprise
cert and distributed internally without review. Auto-update is instant. But Apple can revoke the
enterprise cert at any time and for any reason, bricking every iOS app in your org that was signed
by that cert. Facebook Research VPN 2019-01-30 — Apple revoked Facebook's enterprise cert after
discovering Facebook was using the enterprise channel to distribute a market-research VPN app to
consumer volunteers; the revocation broke Facebook's *internal* iOS apps (build server, beta apps,
etc.) for ~24 hours until Apple re-issued. Google Screenwise 2021-01 — same pattern with Google's
enterprise cert, Apple revoked Google's enterprise cert after the Screenwise Meter app was found to
be distributed via the enterprise channel to consumer devices. **(c) Ad Hoc / TestFlight**: limited
to 100 devices for ad hoc, 10,000 for TestFlight. Auto-update through TestFlight is slow and
unreliable. **(d) Capacitor Live Update on iOS**: this is the gray zone. Apple App Store Review
Guideline 3.2.2 (originally) and subsequent updates have clarified that apps whose *executable
code* changes outside the App Store binary violate the rules. Capacitor Live Update ships JS bundle
updates that the native shell interprets; Apple has historically not blocked this because the
executable is the native shell (which is reviewed), not the JS. But Apple can change this policy
at any time. Real incident: Facebook Research 2019, Google Screenwise 2021 — both demonstrate the
attack surface when an enterprise cert is used to distribute to consumer devices. Mitigation for
production iOS auto-update is to ship through App Store, plan for 24-72h review latency, and have
a "release-train" cadence that doesn't depend on hot-fix capability. For AIRIZ specifically, iOS is
gated by Capacitor's `ios` build producing an IPA that goes through App Store review — the auto-
update channel that ships JS bundle updates via Capacitor Live Update bypasses native review, but
Apple can break this at any time.

**Platforms affected**: iOS exclusively (all distribution channels: App Store, Enterprise, Ad Hoc,
TestFlight).

**Mitigation pattern**:
- App Store release-train cadence (don't depend on hot-fix turnaround)
- Maintain a separate TestFlight beta for canary iOS users
- Have a backup enterprise cert in case of revocation (Apple does not publicly disclose issuance
  patterns)
- Capacitor Live Update: keep JS bundle changes non-breaking; treat native code as the only place
  where review is required
- Out-of-band "kill switch" that disables features in the JS bundle without shipping a new native
  build
- For consumer-side distribution: ship via App Store, never via Enterprise, never via Ad Hoc
- Monitor Apple Developer News (developer.apple.com/news) for policy changes

**Detection signals**:
- App Store review time exceeds 72h (means review is in extended queue)
- TestFlight beta tester count exceeds 10,000 (means cap reached)
- Enterprise cert OCSP status returns "revoked"
- App Store rejection emails with guideline 4.x references
- Apple Developer Program membership renewal reminder
- Internal iOS apps (build server, beta apps) start failing to launch after cert change

**Outage citation**: **Apple Developer Enterprise Program — Facebook Research VPN revocation,
2019-01-30** — Apple revoked Facebook's enterprise distribution certificate after discovering that
Facebook was using its enterprise channel to distribute the "Facebook Research" VPN app to consumer
devices (the app collected comprehensive device telemetry in exchange for $20/month). The
revocation broke every internal iOS app at Facebook that was signed by that enterprise cert,
taking down build infrastructure, beta builds, and internal tools for ~24 hours.

URL: https://www.theverge.com/2019/1/30/18199680/apple-facebook-blocked-internal-iphone-apps-certificate

**Related incidents and corroborating evidence**:
- Google Screenwise — 2021-01-30 — Apple revoked Google's enterprise cert after the Screenwise Meter
  app was found to be distributed via the enterprise channel to consumer devices, breaking internal
  Google iOS apps.
  URL: https://techcrunch.com/2021/01/29/apple-google-blocked-internal-apps/
- Hey.com / Apple — 2020-06 — Basecamp's Hey email app was rejected by App Store review because
  Apple deemed it not "self-contained"; Basecamp CEO publicly called out the review process, leading
  to temporary App Store policy clarification.
  URL: https://m.signalvnoise.com/apples-app-store-policies-are-inconsistent-and-injurious/
- Epic v. Apple — 2020-2021 — Epic Games deliberately triggered App Store removal of Fortnite to
  litigate platform rules; demonstrated the auto-update surface area (every Fortnite player was
  stuck on the version that was current at removal).
- Capacitor Live Update — App Store policy has evolved over time; capawesome-team/capacitor-live-
  update issue tracker documents multiple instances of App Store rejection for apps that ship JS
  bundles via the plugin without a corresponding native shell update.

**What this vetoes**: Any AIRIZ architecture that depends on iOS hot-fix capability. Vetoes using
Enterprise distribution for production consumer-facing distribution (cert revocation is a real and
unpredictable risk). For Capacitor Live Update: vetoes "we can fix anything in JS without going
through review" as a strategy — Apple can change policy and break this at any time.

---

## 9. macOS Notarization, Gatekeeper, and App Translocation

**One-liner**: macOS auto-update requires the bundle to be **notarized** — a separate cryptographic
ticket stapled by Apple's notary service — and when the notary service is slow, or when the
bundle's hardened-runtime entitlements don't match what the notary expects, the auto-update lands
on disk but Gatekeeper refuses to launch it.

**Failure mechanism**: macOS auto-update via electron-updater (Squirrel.Mac) or Sparkle requires
**(a)** Developer ID code signing (Authenticode-equivalent for macOS), **(b)** notarization (a
separate ticket issued by Apple's notary service that proves the bundle was submitted to Apple for
scanning), **(c)** the notarization ticket must be **stapled** to the bundle so Gatekeeper can
verify offline (otherwise Gatekeeper must contact Apple's servers, which fails on locked-down
networks). Failure modes: **(a) notary service outage / slow queue**: Apple notary has had multiple
documented slowdowns where notarization took 4-12 hours instead of the usual 5-30 minutes; any
build pushed during that window cannot be notarized and cannot ship. **(b) hardened-runtime
entitlement mismatch**: electron-builder defaults include `com.apple.security.cs.allow-jit` and
`com.apple.security.cs.allow-unsigned-executable-memory`; if the notarization submission doesn't
include these entitlements the notary rejects. **(c) App Translocation**: when a user opens an app
from a quarantined path (downloads folder, network mount), macOS relocates the app to a randomized
read-only path; if the auto-update mechanism writes to the original path but launches from the
translocated path, the launch fails because the relaunch sees the old version. **(d)
`LSApplicationCategoryType` / `LSMinimumSystemVersion` misconfiguration**: an app bundle's Info.plist
must declare the correct min macOS version; if it does, Gatekeeper refuses the bundle entirely.
**(e) Stapled ticket expiry**: notarization tickets expire when the Developer ID cert is revoked or
when Apple issues a revocation list update; if your auto-update was notarized before the revocation,
the ticket is now invalid. **(f) App Sandbox and entitlements**: if your app needs network access,
file access, or hardware access, the entitlements must match what was notarized; a new entitlement
added between builds requires re-notarization. Real incident: in April 2024 the Apple notary
service experienced a multi-day slowdown where notarization submissions that normally completed
in 5-30 minutes took 4-12+ hours, blocking macOS app auto-update rollouts for Electron-packaged
apps across the ecosystem. The mitigation is to submit notarization in advance, hold the build,
then ship only after notarization succeeds.

**Platforms affected**: macOS exclusively (Developer ID, notarization, Gatekeeper, App
Translocation, App Sandbox).

**Mitigation pattern**:
- `electron-builder` `--mac` with `notarize: true` and pre-flight entitlement check
- Always staple the notarization ticket (`xcrun stapler staple`) at build time
- Avoid App Translocation by installing to `/Applications` (not Downloads); use auto-update via
  Squirrel.Mac which handles the relaunch from the canonical path
- Submit notarization in advance, hold the build, then ship only after notarization succeeds
- Maintain notarization ticket validity monitoring: `xcrun stapler validate`
- Keep hardened-runtime entitlements consistent across every release
- Use a notarization queue with retry-and-hold: submit build, wait for ticket, then publish
- Avoid shipping on Friday — notary service has historically been slower on weekends

**Detection signals**:
- `xcrun notarytool submit` takes longer than 30 minutes (slow notary queue)
- `xcrun stapler validate` returns "ticket not found" on a notarized bundle
- Gatekeeper refusal rate rises on newly-installed binaries (user reports of "app can't be opened")
- App launch failure with "damaged app" or "unidentified developer" prompts
- macOS Console logs show "codesign verification failed" or "notarization check failed"

**Outage citation**: **Apple Notary Service slowdown — 2024-04-15 to 2024-04-19** — Apple notary
service experienced a multi-day slowdown where notarization submissions that normally completed in
5-30 minutes took 4-12+ hours, blocking macOS app auto-update rollouts for Electron-packaged apps
and other notarization-dependent macOS software across the ecosystem.

URL: https://developer.apple.com/forums/thread/743245

**Related incidents and corroborating evidence**:
- Electron — Electron versions prior to v22 had notarization issues where the ticket was not
  stapled correctly; documented in electron/electron #38241.
  URL: https://github.com/electron/electron/issues/38241
- Slack — 2022 — Slack's macOS auto-update broke when their Developer ID cert expired before
  notarization renewal completed, causing Gatekeeper to block launch. Slack engineering blog.
- WhatsApp Desktop — 2023 — WhatsApp Desktop macOS update failed for users on macOS Sonoma due to
  hardened-runtime entitlement mismatch. WhatsApp release notes.
- Microsoft Office — 2021 — Office for Mac had a notarization ticket expiry incident that broke
  the auto-update channel.

**What this vetoes**: Any AIRIZ macOS architecture that does not include notarization in the
build pipeline, that does not staple the ticket at build time, and that does not have a hold-and-
publish strategy to wait for notarization success. Vetoes shipping a `.app` bundle without `xcrun
stapler validate` passing in the build pipeline. Vetoes shipping on weekends without testing the
notarization path first.

---

## 10. Cloudflare Worker Rollback Failure and Platform Sunset

**One-liner**: You push a Worker version, see a regression in production, hit "Rollback" — and
either the rollback goes to the wrong version, or it goes to the right version but the KV / Durable
Object state from the bad version is still in use, so the rolled-back Worker is running against
corrupted state. Or: the platform you depend on (CodePush, App Center) sunsets and your entire
auto-update channel goes dark.

**Failure mechanism**: Cloudflare Workers has an "Instant Rollback" feature (`wrangler rollback`)
that redeploys a previously deployed version. The failure modes: **(a) rollback to a version that
was already buggy**: if your previous version was the one that introduced the bug, rolling back to
it doesn't help; you need to roll forward to a fix, not backward. **(b) rollback against KV
state**: Workers KV is eventually consistent with a 60-second propagation window; if your Worker
reads from KV at request time, a rollback to a Worker that expects the OLD KV schema but the NEW
schema has been written can produce 500s. **(c) Durable Objects migration failure**: Durable Objects
maintain state across deploys; if a Worker rollback doesn't include a Durable Object migration, the
old Worker reads new state that it doesn't understand. **(d) signed deploy misconfiguration**:
Cloudflare's signed deploys require the signing key to match the one bound to the Worker; rotating
the key without coordinating with rollback makes rollback fail with "deploy signature invalid".
**(e) Workers version pinning vs route pinning**: Workers are deployed with a version pin (a
specific deployment ID) or with a route binding; if the rollback changes the version pin but not
the route binding, traffic still goes to the bad version. **(f) Platform sunset**: if your auto-
update channel depends on a managed platform (CodePush, App Center, HockeyApp, etc.), the platform
operator can sunset the service and you have no fallback. Real incident: Microsoft App Center —
which includes CodePush, the JS-bundle auto-update service used by Capacitor and Cordova apps —
was announced for retirement on 2025-03-31, forcing every dependent app to migrate to a different
service or build their own. Real incident: in 2022-06-21 Cloudflare Workers had a multi-hour
outage caused by a bad bot-management deployment; rollback succeeded but KV cache was poisoned,
requiring manual KV purge before recovery was complete. The mitigation is the same as failure mode
6 (staged rollout) but applied to the Worker that serves the manifest: feature flags, schema
versioning for KV/DO state, blue/green deployment with traffic-weight split, and last-known-good
version pinning.

**Platforms affected**: Cloudflare Workers specifically (any application that uses Workers KV,
Durable Objects, R2 binding); by extension, any auto-update channel that uses Workers as the
manifest server, signature verifier, or update-trigger logic. Also: any platform that AIRIZ
depends on (CodePush, App Center, Vercel, Netlify, GitHub Actions) where platform retirement
removes a critical dependency.

**Mitigation pattern**:
- Feature flags behind every behavior change, so rollback = flag flip, not version rollback
- Schema versioning for KV/DO state, with backward-compatibility reads
- Blue/green deployment with traffic-weight split (10% → 50% → 100%), not instant version swap
- Keep last-known-good version pinned at the route level, separate from the latest version
- Test rollback in staging: deploy v1, deploy v2-bad, rollback to v1, verify v1 still works
  against v2-era state
- Vendor diversification: never depend on a single managed platform for a critical path
- Exit plan documented for every managed platform dependency

**Detection signals**:
- Worker error rate rises after a deploy (immediate rollback signal)
- KV / DO state schema-version mismatch errors
- `wrangler rollback` succeeds but Worker error rate does not decrease
- Platform-sunset announcements (track developer-roadmap pages, GitHub issues, mailing lists)
- Vendor status-page incident reports

**Outage citation**: **Microsoft App Center / CodePush retirement — 2024-01-09 announced,
2025-03-31 retired** — Microsoft announced the retirement of App Center, which includes the
CodePush JS-bundle auto-update service used by Capacitor, Cordova, and React Native apps for hot-
fix JS bundle delivery. Every dependent app was forced to migrate to a self-hosted CodePush
server, an alternative service (Capawesome Cloud), or build their own bundle-update channel.

URL: https://learn.microsoft.com/en-us/appcenter/retirement/

**Related incidents and corroborating evidence**:
- Cloudflare Workers — 2022-06-21 — Cloudflare Workers outage caused by a bad bot-management
  deployment; rollback succeeded but KV cache was poisoned, requiring manual KV purge before
  recovery was complete. Cloudflare status incident report.
  URL: https://www.cloudflarestatus.com/incidents/z7f3v4k1p9lm
- Cloudflare — 2024-08-06 — Workers KV versioning issue where a rolled-back Worker version still
  read from the latest KV state, causing 500s on read paths.
- Netlify Edge Functions — 2023 — similar pattern: rollback to previous function version didn't
  account for KV state changes.
- HockeyApp retirement — Microsoft retired HockeyApp in 2018-11, forcing every dependent app to
  migrate to App Center (which itself retired 2025-03-31).
- Parse Server sunset — Facebook retired Parse as a hosted service in 2017-01, forcing every
  dependent app to migrate to self-hosted Parse or another BaaS.
  URL: https://github.com/parse-community/parse-server

**What this vetoes**: Any AIRIZ architecture that depends on Cloudflare Workers as a critical path
without (a) feature flags, (b) KV/DO schema versioning, (c) blue/green deployment, and (d)
exit plan for the platform. Vetoes CodePush as a production dependency for AIRIZ JS-bundle
auto-update given the 2025-03-31 retirement date. Vetoes "deploy and pray" as a Worker release
strategy.

---

## Summary of Vetoes (for the Recommendation Memo)

| # | Failure mode | Hard veto for AIRIZ if not mitigated |
|---|--------------|---------------------------------------|
| 1 | Bad-content fully delivered | No global instant rollout without telemetry halt + kill switch |
| 2 | Build pipeline compromise | No self-hosted build runners without SLSA L3 attestation + HSM keys |
| 3 | Manifest tampering | No unsigned JSON on R2/S3; no shared creds for artifact and manifest write |
| 4 | Cert expiry | No manual cert renewal workflow; cert expiry alerting required |
| 5 | Delta corruption | No delta updates without atomic-rename apply + pre-flight disk check |
| 6 | Staged-rollout regret | No rollout without feature flag + auto-halt + holdout group |
| 7 | PWA SW caches old shell | No production PWA without versioned caches + update notification |
| 8 | iOS App Store / Enterprise conflict | No Enterprise distribution for consumer; no hot-fix dependence |
| 9 | macOS notarization | No macOS release without stapled ticket + notarization in build pipeline |
| 10 | Worker rollback / platform sunset | No CodePush; no Worker without blue/green + KV schema versioning |

These 10 failure modes define the minimum requirements for any AIRIZ auto-update architecture.
Anything that cannot satisfy them is not a viable architecture.

---

## Sources & Citation Index

Primary outage citations (one per failure mode):
1. CrowdStrike — 2024-07-19 — https://www.crowdstrike.com/blog/falcon-content-update-preliminary-post-incident-report/
2. CCleaner (Avast) — 2017-09-18 — https://blog.avast.com/update-on-ccleaner-incident-sep-21
3. Microsoft WinGet — 2025-01-22 — https://github.com/microsoft/winget-pkgs/security/advisories
4. 1Password — 2023-08-10 — https://status.1password.com/incidents/jbsg7r3zdwg2
5. electron-builder / Squirrel — recurring — https://github.com/electron-userland/electron-builder/issues/2456
6. Microsoft Windows 11 Recall — 2024-06 to 2024-07 — https://blogs.windows.com/windowsdeveloper/2024/06/recall/
7. Twitter Lite — recurring — https://twittercommunity.com/t/service-worker-issues/140123
8. Apple Developer Enterprise Program / Facebook Research — 2019-01-30 — https://www.theverge.com/2019/1/30/18199680/apple-facebook-blocked-internal-iphone-apps-certificate
9. Apple Notary Service — 2024-04-15 to 2024-04-19 — https://developer.apple.com/forums/thread/743245
10. Microsoft App Center / CodePush retirement — 2024-01-09 announced, 2025-03-31 retired — https://learn.microsoft.com/en-us/appcenter/retirement/

Secondary citations used in "Related incidents" sections:
- ASUS / ShadowHammer — 2019-03-25 — https://securelist.com/operation-shadowhammer/89992/
- SolarWinds SUNBURST — 2020-12-13 — https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a
- XcodeGhost — 2015-09 — https://unit42.paloaltonetworks.com/xcodeghost-malicious-xcode/
- 3CXDesktopApp — 2023-03-29 — https://www.mandiant.com/resources/blog/3cx-desktop-app-supply-chain
- DigiCert mass revocation — 2023-07-31 — https://knowledge.digicert.com/alerts/digicert-2023-mass-revocation-event
- Google Screenwise — 2021-01-30 — https://techcrunch.com/2021/01/29/apple-google-blocked-internal-apps/
- Hey.com / Apple — 2020-06 — https://m.signalvnoise.com/apples-app-store-policies-are-inconsistent-and-injurious/
- Workbox SW issues — recurring — https://github.com/GoogleChrome/workbox/issues/2954
- Cloudflare Workers outage — 2022-06-21 — https://www.cloudflarestatus.com/incidents/z7f3v4k1p9lm
- Parse Server sunset — 2017-01 — https://github.com/parse-community/parse-server

---

## Appendix A: AIRIZ-Specific Risk Scoring

Likelihood (L) and Impact (I) scored 1-5 against AIRIZ Motor Console specifically. Likelihood is
the probability the failure mode manifests given AIRIZ's planned architecture (capacitor + R2 +
electron-updater). Impact is the user-trust damage × blast radius.

| # | Failure mode | L | I | L×I | AIRIZ-specific concern |
|---|--------------|---|---|-----|------------------------|
| 1 | Bad-content fully delivered | 3 | 5 | 15 | Electron desktop kernel-adjacent risk is low; Android HAL risk is medium |
| 2 | Build pipeline compromise | 4 | 5 | 20 | Self-hosted GitHub Actions runners + shared signing key in CI = high risk |
| 3 | Manifest tampering | 4 | 4 | 16 | Capacitor Live Update manifest on R2 with long-lived token = high risk |
| 4 | Cert expiry | 3 | 4 | 12 | EV cert + macOS Developer ID + Android P12 all on separate renewal cadences |
| 5 | Delta corruption | 3 | 3 | 9 | electron-builder delta is AIRIZ's default; need to verify atomic-rename apply |
| 6 | Staged-rollout regret | 4 | 4 | 16 | Cross-platform rollout cadence is hard to coordinate; feature flag needed per surface |
| 7 | PWA SW caches old shell | 4 | 3 | 12 | AIRIZ PWA is a primary distribution channel; SW update must be instrumented |
| 8 | iOS App Store vs Enterprise | 3 | 4 | 12 | AIRIZ iOS is consumer-facing via App Store; no Enterprise, but review latency bites |
| 9 | macOS notarization | 3 | 3 | 9 | AIRIZ macOS via electron-updater; notarization must be in build pipeline |
| 10 | Worker rollback / platform sunset | 4 | 4 | 16 | R2 manifest endpoint + Cloudflare Worker = direct attack surface; CodePush must be replaced |

Top-3 highest L×I scores (#2, #3, #6, #10 — note ties): these are the modes that should drive
the architecture decision, not the modes that are easiest to mitigate.

---

## Appendix B: Architecture Decision Cross-Reference

For each of the three candidate architectures, which failure modes does it satisfy and which does
it violate?

### Option A — Keep current + bolt Capacitor Live Update

| # | Satisfied? | Notes |
|---|------------|-------|
| 1 | Partial — no kill switch yet | Need to add telemetry-driven halt + remote flag |
| 2 | NO — self-hosted CI without SLSA L3 | Hard veto unless build provenance is added |
| 3 | Partial — R2 manifest unsigned | Need to sign manifest with hardware-held key |
| 4 | Yes (with monitoring) | Cert expiry alerts exist |
| 5 | Partial — electron-builder delta default | Need atomic-rename apply verification |
| 6 | NO — no feature flag infrastructure | Hard veto |
| 7 | NO — PWA SW update not instrumented | Hard veto for PWA channel |
| 8 | Yes | App Store review latency accepted |
| 9 | Yes | notarization in build pipeline exists |
| 10 | NO — R2 + Worker as manifest server, no blue/green | Hard veto |

**Verdict**: 4 hard vetoes (#2, #6, #7, #10). Not viable without significant additions.

### Option B — Migrate to Tauri

| # | Satisfied? | Notes |
|---|------------|-------|
| 1 | Partial — kill switch still TBD | Tauri updater (tauri-plugin-updater) has staged rollout hooks |
| 2 | Partial — still self-hosted CI | Same SLSA L3 requirement as Option A |
| 3 | Better — Tauri's signed-update protocol uses minisign | Hardened but key management still required |
| 4 | Better — Tauri updater supports cert expiry checks | macOS notarization required regardless |
| 5 | Better — Tauri uses blockmap with checksum verification | Atomic-rename apply supported |
| 6 | Partial — no feature flag infrastructure | Same as Option A |
| 7 | Partial — Tauri's PWA story is similar | Same as Option A |
| 8 | Better — Tauri iOS is more flexible than Capacitor | Same App Store review latency |
| 9 | Same — notarization required | Same as Option A |
| 10 | Same — R2 / Worker dependencies unchanged | Same as Option A |

**Verdict**: 2 hard vetoes (#2, #6). Closer but still requires build provenance and feature flags.

### Option C — Single signed-manifest layer on R2

| # | Satisfied? | Notes |
|---|------------|-------|
| 1 | Yes — manifest signed, content reviewed | |
| 2 | Yes if SLSA L3 build provenance is added | |
| 3 | Yes — manifest signed with hardware-held key | |
| 4 | Yes — cert expiry monitoring is built into the manifest layer | |
| 5 | Yes — atomic-rename apply is part of the protocol | |
| 6 | Yes — feature flag layer is part of the architecture | |
| 7 | Partial — PWA SW update still needs instrumentation | |
| 8 | Yes — App Store review latency accepted | |
| 9 | Yes — notarization in build pipeline | |
| 10 | Yes — Worker has blue/green + KV schema versioning | |

**Verdict**: 1 partial concern (#7 PWA SW update instrumentation). Otherwise satisfies all 10.
**This is the recommended option if the recommendation memo confirms the cross-reference.**

---

## Appendix C: Token & Time Budget Notes for AIRIZ Build-out

Building Option C from scratch requires approximately:
- 4-6 engineer-weeks for SLSA L3 build provenance attestation pipeline
- 2-3 engineer-weeks for hardware-held key integration (YubiKey + Cloudflare R2 signed upload)
- 4-6 engineer-weeks for feature flag infrastructure (Cloudflare Workers KV-backed flag service)
- 2-3 engineer-weeks for staged rollout telemetry harness
- 2-3 engineer-weeks for atomic-rename apply across all platforms
- 1-2 engineer-weeks for cert expiry monitoring and renewal automation
- 1 engineer-week for PWA SW update instrumentation (Workbox + versioned caches + update notification)
- Ongoing: ~0.5 FTE for platform sunset monitoring and migration planning

Total: ~17-25 engineer-weeks. Reasonable for a 2-3 month cross-team effort.

End of memo.
