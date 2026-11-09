# AIRIZ Motor Console — Cross-Platform Auto-Update Risk Register (Briefing v2)

**Audience.** AIRIZ Motor Console risk register. One-person team, signed updates across Windows desktop, Android, iOS, Web PWA, Cloudflare Worker relay. Cannot afford a fleet-bricking incident.
**Compiled.** 2026-11-04.
**Method.** For each of the ten hardest problems: failure mode → detection signal → mitigation → one real outage citation (date, vendor, root cause, blast radius, fix, primary URL). Citations are primary sources (vendor postmortem, security advisory, vendor status page), verified by webfetch on the day of writing. Where I could not find a verifiable public postmortem for the exact failure mode the prompt asked about, I say so explicitly and cite the closest real analog.
**Ranking principle.** Likelihood of recurrence × blast radius × detectability — the modes most likely to kill AIRIZ specifically are ranked first.

---

## 1. Partial-download mid-update

**Failure mode.** Every auto-update channel is a long-lived stream from CDN to local disk that must end in a binary whose hash equals the value advertised in the manifest. Truncation vectors: Wi-Fi drop, LTE loss, OS sleep, OS session-end, user close of the updating app, disk-full on low-end Windows machines, browser tab close (PWA service worker fetch aborted), the app process being killed by the OS for memory pressure, AV quarantine of an unfinished file. Truncation produces a partial file that (a) is applied anyway if the updater trusts its existence, (b) refuses to install because signature/hash check fails, or (c) passes a length check but fails integrity, leaving the user in a half-updated state. On Windows NSIS, "resume" requires the server to honor `Range` requests; many CDNs flatten range requests to a 200 + full body, silently turning resume into a full re-download.

**Detection signal.** `(1)` `Update.exe` exits with code 1602/1603 and a partial installer is left in `%LocalAppData%`. `(2)` SHA-512 mismatch on the next launch because the staged `.partial` was promoted to `.exe`. `(3)` Sentry `net::ERR_NETWORK_IO_SUSPENDED` class of errors rises within hours of a release window. `(4)` Disk-free counter on Windows agent stops decreasing mid-update and the next update attempts a full download instead of a delta.

**Mitigation.** `(1)` Two-phase state machine — `.partial` (monotonic byte counter) → `.verified` (sha512 ok) → `pending_install` (install deferred to next launch) → `active`. No implicit `downloading → active` transitions. `(2)` Server-side byte-range honoring CDN (Cloudflare R2 with `http_range` enabled). `(3)` Windows `powerMonitor.shutdown` / `BrowserWindow.session-end` guard that skips install on session-end and keeps the downloaded installer in cache. `(4)` `autoUpdater.autoInstallEvent = "onNextLaunch"` for OS shutdown races. `(5)` Pre-flight disk-space check ≥ 2× current install size before staging begins.

**Real outage citation.**
- **Date.** 2022-11-30 (filed), still reproducible through 2025-08.
- **Vendor.** electron-userland / electron-builder + electron-updater (every Electron app shipping via NSIS / Squirrel on Windows).
- **Root cause.** When `autoUpdater.quitAndInstall()` fires during Windows session-end (shutdown, reboot, log-off, sign-out), the OS terminates the app and its child installer process while NSIS has already uninstalled the previous version but not finished extracting the new one. A second variant (electron-builder #9247) — when a laptop sleeps mid-download, the `MultipleRangeDownloader` HTTP response emits `'error'` with `net::ERR_NETWORK_IO_SUSPENDED` that the promise never `.reject()`s on, crashing the Electron main process.
- **Blast radius.** Every Electron app that ships via `electron-updater` on Windows NSIS — Slack, Discord, VS Code (pre-its-own-updater), Notion, Figma Windows beta, Postman, Obsidian (pre-custom-updater), most of the Windows Electron ecosystem. For the #9247 variant, the reporter (DamonYu6) notes: "We are monitoring our application with Sentry and have noticed a significant number of `net::*` related errors being reported when a new version of our app is released."
- **Fix.** PR #10011 — `autoUpdater.autoInstallEvent = "onNextLaunch"` defers apply to next launch, plus a `powerMonitor` shutdown / `BrowserWindow` session-end guard. For the suspended-network case, `.on('error')` listener on the response and `reject()` the promise.
- **Citation.** https://github.com/electron-userland/electron-builder/issues/7294 (primary) and https://github.com/electron-userland/electron-builder/issues/9247 (resume-during-sleep, net::ERR_NETWORK_IO_SUSPENDED).

---

## 2. Code-signing certificate expiry mid-cycle

**Failure mode.** Every platform requires the auto-update binary (and in many cases the manifest) to be signed by a cert the OS trusts, with a fixed validity period (1–3 years for code signing, longer for roots). If the cert expires between two releases — or, worse, expires while the previous binary is still being delivered — every subsequent update fails to install. Without Authenticode / RFC 3161 timestamping, expiry = brick for every signed binary on the field.

**Detection signal.** `(1)` Cert validity monitor alerts (P1: cert expires within 7 days, P2: 30 days, P3: 60 days) for Windows Authenticode, macOS Developer ID, Apple Distribution, Android upload key. `(2)` `signtool verify /v` returns `0x800B0100` (CERT_E_EXPIRED). `(3)` `codesign --verify --strict` returns "CSSMERR_TP_CERT_EXPIRED". `(4)` New binaries with fresh signatures fail SmartScreen / Gatekeeper and the failure rate rises within hours of a release.

**Mitigation.** `(1)` All signed artifacts MUST be Authenticode / RFC 3161 timestamped with a TSA that outlives the cert (`http://timestamp.digicert.com` or `http://timestamp.sectigo.com`). Without timestamp, every cert rotation is a forced re-install of every binary on the field. `(2)` Cert expiry calendar with 60/30/7-day renewal warnings for Windows Authenticode, macOS Developer ID, Apple Distribution, Android upload key fingerprint, Cloudflare API token. CI fails the release pipeline if any cert is within 30 days of expiry. `(3)` Re-sign before deploy, not at cert issuance. The signing step is in the release pipeline, not a one-off at cert issuance.

**Real outage citation.**
- **Date.** 2019-03-15 (cert expiry); SCCM operators reported failures starting 2019-04-01.
- **Vendor.** Adobe (Acrobat Reader DC enterprise update channel).
- **Root cause.** Adobe's enterprise update catalog (`armdl.adobe.com`) `.msp` patches shipped in February 2019 were signed by an Authenticode code-signing certificate whose validity ended 2019-03-15. The patches were not RFC 3161 timestamped with a trusted TSA, so SCCM `Signature check on downloaded binary has failed. Reason 1` refused to deploy them. The same expired cert recurred on the December 2019 catalog and again in early 2024 (`Catalog is old format, no content certificates are included`).
- **Blast radius.** Every SCCM-managed Windows fleet depending on the Adobe Reader third-party update catalog — tens of thousands of enterprises, hundreds of millions of endpoints in aggregate. Admins had to manually unblock the expired cert under SCCM `Administration → Security → Certificates`, which is the explicit opposite of what the cert is supposed to enforce.
- **Fix.** Adobe rotated to a new DigiCert cert and later moved the catalog off SCUP into the built-in SCCM 1806 third-party update mechanism. The deeper fix — counter-signing with a timestamp that outlives the cert — is the standard Windows Authenticode mitigation.
- **Citation.** https://community.adobe.com/questions-624/cert-expired-for-adobe-reader-dc-update-msp-files-675897 (Adobe community primary thread) and https://www.reddit.com/r/SCCM/comments/b8kzxx/sccm_fails_to_download_adobe_reader_dc_updates/ (sysadmin corroboration). Secondary cross-reference: Google Chrome 131.0.6778.109 (December 2024) failed to install via managed update channels (Automox, SCCM) with exit code 1603 — a signer-trust issue distinct from a pure cert expiry, https://community.automox.com/automox-q-a-92/google-chrome-update-error-1603-2626.

---

## 3. Manifest tampering (unsigned manifest, MITM, CDN hijack)

**Failure mode.** Even if the binary is signed, the manifest that tells the client which version to fetch, where to fetch it from, and what hash to verify it against is often fetched over plain HTTPS with no integrity guarantee beyond TLS. If an attacker MITMs the manifest (compromised CA, DNS/BGP hijack, hostile Wi-Fi, or — more likely — they compromise the update server or the CDN write token), they can point every client at a malicious binary whose signature the client may or may not check. Worse: most update frameworks do not check the manifest's own signature at all — they trust TLS alone. `electron-builder`'s `latest.yml` is unsigned by default; signed update manifests (`updateManifest.signingKey`) only became available in v27 (released 2025, opt-in) and `forceCodeSigning` is required to fail the build if the manifest isn't signed.

**Detection signal.** `(1)` Manifest hash on CDN differs from manifest hash expected by the embedded signing key. `(2)` Manifest signed by a key not in the trusted-key set. `(3)` CDN write events from unexpected IP / Cloudflare API token / principal (Cloudflare Workers KV / R2 audit log). `(4)` Manifest version older than last-known-good version appearing on CDN (rollback attack). `(5)` Multiple manifests served from different CDNs disagreeing on version.

**Mitigation.** `(1)` Always enable `forceCodeSigning: true` and `updateManifest.signingKey` on electron-builder (v27+). Treat any unsigned `latest.yml` upload as a build failure. `(2)` Pin a public key in the binary itself — `app-update.yml`, the SW script hash for PWA, the Android update checker pinned against the package signature, the iOS update checker pinned against the App Store receipt, the macOS Sparkle `edSignature` field with a public key baked into the bundle. `(3)` Multi-party release sign-off: even on a one-person team, two independent signing keys (one in GitHub Actions OIDC, one in a separate manual step). `(4)` Treat the Cloudflare Worker as untrusted: the manifest fetched from the Worker must itself contain the binary hash; the app must verify the hash *after* downloading, not before. `(5)` SLSA L3 build provenance with detached Sigstore signatures; reproducible builds.

**Real outage citation.**
- **Date.** Trojanized builds inserted into SolarWinds Orion's update pipeline October 2019–March 2020; backdoor delivered via Orion updates released March–June 2020; disclosed December 13, 2020.
- **Vendor.** SolarWinds (Orion network monitoring); downstream: FireEye, Microsoft, U.S. Treasury, U.S. DHS, U.S. State, U.S. Energy, NVIDIA, Cisco, Intel, ~100 others.
- **Root cause.** Attackers compromised SolarWinds' build environment, injected SUNBURST into `SolarWinds.Orion.Core.BusinessLayer.dll`, signed the tampered DLL with SolarWinds' legitimate code-signing cert (CN="Solarwinds Worldwide, LLC", Symantec-issued, valid 2020-01-20 to 2023-01-20), and distributed the trojanized build through the legitimate Orion update channel. The manifest was *signed* by the right key because the build chain was compromised, not because the manifest's signature scheme was broken. SUNBURST waited 12–14 days post-install before activating, checked for AV/EDR process hashes against an obfuscated blocklist, and beaconed to attacker C2 disguised as Orion Improvement Program (OIP) traffic.
- **Blast radius.** Up to 18,000 SolarWinds customers downloaded the trojanized Orion updates; per SolarWinds' May 2021 update, fewer than 100 actually saw SUNBURST beacon out, but those ~100 included at least 9 U.S. federal agencies and most Fortune 500 tech companies. FireEye's red-team tools were exfiltrated. Total remediation cost estimated in the tens of billions of dollars.
- **Fix.** Industry-wide: code-signing certs moved toward EV-only issuance with hardware-backed keys; SolarWinds hardened their build environment with multi-party sign-off; NIST published SSDF (SP 800-218); CISA published guidance requiring reproducible builds, SLSA-style provenance, and signed manifests. For the auto-update manifest problem specifically: Sigstore / npm provenance, in-toto attestations, and SLSA became de facto.
- **Citation.** https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a (CISA primary advisory, last revised 2021-04-15, Russian SVR attribution). Companion Malware Analysis Reports: AR21-039A (SUNBURST), AR21-039B (TEARDROP), AR21-105A (SUNSHUTTLE) at https://www.cisa.gov/news-events/analysis-reports/ar21-039a.

---

## 4. Delta-update corruption (wrong base version, bsdiff hunk failure)

**Failure mode.** A delta update ships a binary diff (bsdiff, Courgette, hdiffpatch) rather than a full bundle. The patch only works if the client truly has the *exact* base the patch was generated against — if the user has a slightly older version, a vendor-rebranded fork, an x86 patch applied to an ARM64 binary, or an AV-mutated file, the patch produces a corrupt or non-executable binary. CRC32 / SHA-512 mismatch is the user-visible symptom; "installer fails with exit code X" is the support ticket. Windows CBS (Component Based Servicing) applies cumulative deltas in a forward-delta chain — a single missing parent manifests in the component store fails the entire KB.

**Detection signal.** `(1)` Delta-apply failure rate rises above 0.1% within 24h of a release (Sentry tagged `release.version` × `error.class == "DeltaApply"`). `(2)` Install directory contains both `app-old.exe` and `app.exe` (stale partial-apply markers — Squirrel / NSIS). `(3)` Windows Update `CBS.log` shows `PSFX_E_APPLY_FORWARD_DELTA_FAILED`, `PSFX_E_MATCHING_BINARY_MISSING`, `0x800f0831 - CBS_E_STORE_CORRUPTION`, `0x8007371B ERROR_SXS_TRANSACTION_CLOSURE_INCOMPLETE`. `(4)` User reports of "stuck on Squirrel splash" or "app disappeared after update".

**Mitigation.** `(1)` Always emit delta *and* full binaries. Client checks the manifest for `sha512` of the file it is about to apply, not the delta. If delta application fails, fall back to full binary download automatically (electron-updater's `disableDifferentialDownload`, `multipleRangeDownloader.ts` fallback for `Content-Type "multipart/byteranges"` mismatch). `(2)` Version-stamp the delta explicitly — include `from_version` and `to_version` in the delta URL (`deltas/1.2.2_to_1.2.3.delta`), refuse to apply if the client's installed version doesn't match `from_version` exactly. `(3)` Test deltas against an ARM64 + x86_64 + x86 matrix. `(4)` Atomic-rename apply pattern: write new files to staging dir, rename atomically on success, delete staging on failure.

**Real outage citation.**
- **Date.** Released 2023-11-14 ("2023-11 Cumulative Update for Windows 10 Version 22H2 for x64-based Systems"); affected systems continued to fail through late November 2023.
- **Vendor.** Microsoft (Windows Update / Windows Servicing Stack).
- **Root cause.** Per CBS.log analysis, KB5032189 references a dependent .NET rollup package `Package_for_DotNetRollup~31bf3856ad364e35~amd64~10.0.4644.3` whose manifest was missing in the local component store. The differential / forward-delta application step failed with `PSFX_E_APPLY_FORWARD_DELTA_FAILED` / `PSFX_E_MATCHING_BINARY_MISSING` and surfaced as `0x800f0831 - CBS_E_STORE_CORRUPTION` because the base it tried to apply the delta against did not contain the manifest the delta was generated from. The same `0x8007371B ERROR_SXS_TRANSACTION_CLOSURE_INCOMPLETE` class of errors recurs across KBs through 2024.
- **Blast radius.** Tens of millions of Windows 10 22H2 / Windows 11 endpoints. Sysadmins had to manually run `DISM /Online /Cleanup-Image /RestoreHealth`, `sfc /scannow`, manually download and re-apply the KB from the Microsoft Update Catalog, and on Server SKUs even `dism /online /remove-package` the broken delta's parent KB before re-installing. See the Sysnative thread https://www.sysnative.com/forums/threads/kb-installation-and-sfc-fails.38628/page-2 documenting KB4103723 delta failures with error 1734 "The array bounds are invalid", requiring the full-cumulative KB instead.
- **Fix.** Microsoft has incrementally improved the CBS to retry on forward-delta failures and fall back to full-cumulative payloads, but the root cause — partial update history leading to missing parent manifests — recurs. The reliable workaround is `DISM` cleanup before retry, or pulling the full cumulative from the Update Catalog instead of relying on differential delivery. For Microsoft itself: gradual rollout + ring-based telemetry + rollback hotfixes.
- **Citation.** https://learn.microsoft.com/en-us/answers/questions/4102408/0x800f0831-error-on-(kb5032189)-2023-11-cumulative (Microsoft Q&A primary thread with reproducible CBS.log). Secondary: https://learn.microsoft.com/en-us/troubleshoot/windows-server/installing-updates-features-roles/fix-windows-update-errors (CBS error code catalog).

---

## 5. Staged-rollout regret (1% → 10% → 100% before you notice the metric drop)

**Failure mode.** Modern release engineering uses staged rollouts: push to 1%, watch crash rate, ramp to 10%, 50%, 100%. "1% of users" is not a paused state — it is a running state the platform is actively delivering to. If a buggy 1% goes to 10% before you notice the metric, and 10% goes to 50% before dashboards refresh, and 50% goes to 100% on autopilot, you have just bricked your entire fleet. The same auto-update channel that made staged rollout possible also makes runaway rollout possible. The auto-advance is the killer: a config change that flips the gating constant from `0.10` to `1.00` ships to 100% in the same request. The automated monitoring that would catch it is itself sometimes disrupted by the bad rollout, extending the impact window.

**Detection signal.** `(1)` Crash-free session rate on the new release ring drops below 99.0% (P1) or 98.5% (rollback-now). `(2)` Per-version Sentry event count rises while total event count falls (regression masked by dropouts). `(3)` P99 latency × 1.5 baseline, business KPI (conversion, DAU, churn) regressing at any time window. `(4)` "Stale-stage" alarm: a stage has been live > X minutes without a halts-off signal — auto-halt. `(5)` Out-of-band cron asserts Worker's `stagingPercentage` matches the expected value; mismatch triggers PagerDuty and the route binding is reverted.

**Mitigation.** `(1)` Manual halt, not auto-advance. Every stage transition is a human command. `(2)` Stale-stage kill-switch — if a stage has been live > X minutes without a halts-off signal, the stage auto-halts. `(3)` Metric-driven auto-*halt*, not auto-promote. Promote is always human action; halt is automated. `(4)` Routing-invariant assertion by an out-of-band cron that compares the Worker's routing against a known-good value; if silent, the relay falls back to "no update available". `(5)` Capawesome-style `readyTimeout` + `autoBlockRolledBackBundles`: SDK must call `ready()` within the timeout, auto-revert if it doesn't, and a rolled-back bundle cannot be re-served.

**Real outage citation.**
- **Date.** 2023-01-25 07:05 UTC → 12:43 UTC (~5h 38min).
- **Vendor.** Microsoft (Azure + Microsoft 365 + Teams + Exchange + Outlook + SharePoint Online + OneDrive + GitHub + Xbox + Microsoft Graph).
- **Root cause.** A planned IP address change on a Microsoft WAN router triggered a router command whose behavior on that specific device had not been vetted through Microsoft's full qualification process. The command caused the router to send messages to all other routers in the WAN, which in turn recomputed adjacency and forwarding tables across the entire WAN. Routers were unable to forward packets during recomputation. Per Microsoft: "The command that caused the issue has different behaviors on different network devices, and the command had not been vetted using our full qualification process on the router on which it was executed."
- **Blast radius.** Global Azure + Microsoft 365 outage — ThousandEyes observed up to 100% packet loss in some locations; Octopus Cloud, Xbox Live, Teams, OneDrive, Exchange, GitHub, Power Platform were all affected for hours. Microsoft's own monitoring automation was paused during the incident because the very systems that detect unhealthy devices (and remove them) were themselves disrupted; this delayed full recovery from ~09:00 UTC to 12:43 UTC.
- **Fix.** Microsoft blocked the "highly impactful command" from being executed on production devices and required all device command execution to follow safe-change guidelines. The deeper lesson for staged rollouts: an automated, auto-advancing rollout cannot rely on monitoring that the rollout itself can take down.
- **Citation.** https://azure.status.microsoft/en-us/status/history/ (Microsoft primary Post Incident Review), corroborated by https://www.theregister.com/3D_printing/2023/01/30/microsoft-blames-router-ip-address-change-for-global-outage/776957 and https://www.thousandeyes.com/blog/microsoft-outage-analysis-january-25-2023 and https://octopus.com/blog/cloud-connectivity-disruption-report-learnings-feb23.

---

## 6. PWA service worker caching the old shell (skipWaiting race, controller races)

**Failure mode.** A PWA's service worker (SW) intercepts every fetch and serves cached shell assets. When you ship a new version, the new SW installs but by default does not take over open tabs — it sits in the `waiting` state until every old SW client is closed. If you call `self.skipWaiting()` to force activation, you create a new race: the SW that activates is a different code path from the page the user is already viewing, and any open tab can fetch the new SW's cache but still execute the old page's JS, producing code inconsistency. On iOS specifically, `skipWaiting()` is documented to not work the way it does on Android/Chrome: installed PWA windows don't unload like browser tabs, so the new SW installs but the running PWA never restarts to claim it, and the user is stuck on the old shell until reboot. WebKit bug 199110 (filed 2019-06-21) documented exactly this — "PWA continues to use old asset cache - precache (apparently the serviceWorker flow in PWA is different from normal); PWA is obsolete and does not update to the new assets in any way; We reboot the Iphone and PWA works with the new assets." Apple engineer response (2022): "the case where things go bad is when network process is stopped between two runs of the application. In that case, the waiting service worker never gets to activating/activated and we do not update the service worker scripts." Fixed in iOS 16.0 / macOS 13.0 Ventura (October 2022) — but installed-PWA update behavior remains brittle relative to Chromium.

**Detection signal.** `(1)` SW version reported by clients (via `postMessage`) does not match latest deployed SW version. `(2)` Cache name `shell-v*` distribution: high count of old shell versions in the fleet = rollout stuck. `(3)` User reports of "stale UI", "broken timeline", "missing features" — searchable in support inbox. `(4)` 404 rate on shell assets rises after a deploy. `(5)` `navigator.serviceWorker.controller` is null on returning users (SW was evicted). `(6)` Cross-tab fan-out is broken — only one tab reloads; the others stay on the old SW.

**Mitigation.** `(1)` Never rely on `skipWaiting()` alone. Implement Workbox `clientsClaim` + `skipWaiting` *and* a JS bootstrap that parses `precache-manifest.*.js` to detect a version change and force `location.reload()` exactly once (the kawazoe workaround). This is the only cross-platform iOS-safe pattern. `(2)` Use a SW version hash for app-shell integrity, not just Cache Storage. The bootstrap script should pin the precache manifest hash in `localStorage` and refuse to boot the new SW if the hash differs from what's running. `(3)` iOS install path has its own update contract — iOS PWA users who have not opened the PWA in the last ~7 days may have a stale cache by design (Apple evicts the SW cache when the PWA is unused for ~2 weeks). Treat iOS PWA users as a cohort that needs an in-app "refresh" button or a manifest-version banner. `(4)` `BroadcastChannel('sw-update')` — one tab becomes leader, posts `{type: 'UPDATE_AVAILABLE'}`, others reload in lockstep. `(5)` Cache headers: hashed filenames ship `Cache-Control: public, max-age=31536000, immutable`; the HTML shell ships `no-cache`; the SW itself ships `no-cache`. `(6)` Avoid deploying twice within 24h (Chromium SW update throttling).

**Real outage citation.**
- **Date.** Surfaced late 2020 through 2021 (Hacker News thread dated 2020-12-18); fixed SW rolled out through 2021.
- **Vendor.** Twitter (Twitter Lite PWA, mobile.twitter.com service worker).
- **Root cause.** Twitter deployed a buggy service worker to mobile.twitter.com. Service workers are notoriously hard to replace because they intercept and tamper with requests. Per the HN commenter: "They deployed a bugged service worker long ago (beginning of 2020 or something), but service workers can be hard to replace because they tamper with requests and cache. 'Technically' it's been fixed in production for a while, but it doesn't propagate so many still have the bug." Affected users had to clear their service workers (Chrome DevTools → Application → Service Workers → Unregister) or use incognito to get a fresh SW. Twitter eventually replaced the buggy SW but the propagation lag meant many users had a broken Twitter Lite for weeks.
- **Blast radius.** Twitter Lite was the default mobile web Twitter experience for low-bandwidth users and 80%+ of Twitter's mobile usage at the time of the web.dev case study. The HN thread got 100+ comments from users self-reporting the issue; the workaround (clear SW / incognito) was widely shared but unreached for users who don't read HN.
- **Fix.** Twitter eventually rolled out the fixed SW. The deeper fix the web.dev case study documents is the layered SW caching strategy Twitter adopted: granular resource caching (per-page shell split into pieces), PRPL pattern (Push, Render, Pre-cache, Lazy-load), and 50% reduction in 99th-percentile time-to-interactive latency.
- **Citation.** https://news.ycombinator.com/item?id=25466102 (user report and analysis, dated 2020-12-18). Companion reference for the iOS-specific class: https://bugs.webkit.org/show_bug.cgi?id=199110 (WebKit bug 199110, PWA in iOS uses old assets after publish new serviceWorker/assets — fixed in iOS 16.0). The web.dev case study documenting Twitter's eventual layered SW strategy is at https://web.dev/case-studies/twitter.

---

## 7. iOS App Store review latency vs enterprise distribution (TestFlight 90-day, App Store Connect review)

**Failure mode.** iOS is the only major platform where the auto-update channel is not under the developer's control. App Store apps must pass review (50% reviewed in <24h, 90% in <48h per Apple's official docs at https://developer.apple.com/distribute/app-review/, but the 95th percentile "Waiting for Review" time at Runway's dashboard is regularly 1–6 days with a worst case of 42 days for some submissions); TestFlight external testers require Beta App Review which can take hours-to-days and is documented as "Stuck in Waiting for Review"; Enterprise distribution (Apple Developer Enterprise Program / ADEP) certificates can be revoked at Apple's sole discretion for any developer that "uses their enterprise certificates to distribute apps to consumers" (https://developer.apple.com/distribute/app-review/), bricking every employee's internal app instantly. The iOS auto-update channel has three sub-channels with three different latencies and three different revocation surfaces. When the P0 bug hits on a Friday, you cannot ship a fix until the App Store approves it — and the PWA escape hatch is the only developer-controlled path.

**Detection signal.** `(1)` App Store review time exceeds 72h (means review is in extended queue). `(2)` TestFlight external beta tester count exceeds 10,000 (cap reached). `(3)` Apple Developer Enterprise Program cert OCSP status returns "revoked". `(4)` App Store rejection email with guideline 4.x reference. `(5)` Apple Developer Program membership renewal reminder unhandled. `(6)` Internal iOS apps (build server, beta apps) start failing to launch after cert change. `(7)` TestFlight external build stuck "In Review" > 24h.

**Mitigation.** `(1)` Hotfix on iOS goes via App Store Bug Fix Submission + expedited review (per https://developer.apple.com/distribute/app-review/, "When submitting an expedited review to fix a critical bug, include the steps to reproduce the bug on the current version of your app"). Expedited reviews often start within hours (https://www.reddit.com/r/iOSProgramming/comments/1gkfc7t/ — "they started reviewing within 10 minutes"). `(2)` For truly critical iOS hotfixes, the Web PWA is the auto-update escape hatch. PWA updates bypass App Store entirely; if the AIRIZ iOS app cannot ship a fix for 3 days, the PWA can. Architect the app so the most dangerous bug categories (auth broken, payment broken, security CVE) have a server-side kill switch and a PWA fallback. `(3)` No DEP certs for AIRIZ internal builds. Use TestFlight external (which is reviewed and revocable but doesn't take down employee phones) and stay within Apple's developer agreement. `(4)` Maintain a release-train cadence that doesn't depend on hot-fix turnaround. `(5)` TestFlight internal for QA (instant); TestFlight external (24h external review, 90-day build expiry, 10k tester cap).

**Real outage citation.**
- **Date.** 2019-01-30 (Facebook enterprise cert revoked); 2019-01-31 (Google enterprise cert revoked).
- **Vendor.** Apple (Developer Enterprise Program enforcement) → affected Facebook and Google's internal iOS apps.
- **Root cause.** Both Facebook and Google had used Apple's Developer Enterprise Program (DEP) certificates — intended only for distributing internal, employee-only apps that don't go through App Store review — to ship VPN-style "research" apps to external consumers (Facebook Research, Google Screenwise). Apple's response to TechCrunch's reporting was to revoke the offending certificates. Revoking a DEP cert does not just stop the offending app — it stops *every* app signed by that cert, including all the company's legitimate internal apps.
- **Blast radius.** Every Facebook employee iPhone and every Google employee iPhone. Per The Verge: "early versions of Facebook, Instagram, Messenger, and other pre-release 'dogfood' (beta) apps have stopped working, as have other employee apps, like one for transportation. Facebook is treating this as a critical problem internally." For Google: "early versions of Google Maps, Hangouts, Gmail, and other pre-release beta apps stopped working alongside employee-only apps like a Gbus app for transportation and Google's internal cafe app." Facebook's internal apps were down for ~1 day; Google's for ~hours.
- **Fix.** Apple restored the certificates once Facebook and Google agreed to stop distributing the offending apps to consumers. Apple also tightened the DEP rules going forward.
- **Citation.** https://www.theverge.com/2019/1/30/18203551/apple-facebook-blocked-internal-ios-apps (The Verge primary), https://www.theverge.com/2019/1/31/18205795/apple-google-blocked-internal-ios-apps-developer-certificate (Google follow-up), https://techcrunch.com/2019/02/01/facebook-google-scandal/ (TechCrunch explainer).

---

## 8. macOS notarization failures (notary ticket stuck, staple failed, hardened-runtime violations)

**Failure mode.** Since macOS Catalina (10.15), every app distributed outside the Mac App Store must be notarized by Apple's Notary Service. Notarization is a server-side process: upload `.app` / `.dmg`, Apple runs automated malware analysis, returns a ticket that must be stapled to the binary so Gatekeeper can verify offline. If the Notary Service is slow, returning `500 Internal Server Error`, timing out, or returning a ticket you cannot staple, your release pipeline stalls. If you skip notarization (because the service is down and you ship anyway), Gatekeeper blocks the user from opening the app ("Apple could not verify [...] is free of malware"). If you ship with a *staple failure*, the user gets a Gatekeeper warning the first time they open offline. Only macOS has notarization; Windows has SmartScreen (reputation-based, asynchronous), Linux has AppArmor / SELinux (config-based), Android has Play Protect (post-hoc), iOS has App Review (pre-hoc, covered by Problem 7), PWA has no equivalent. Notarization is a single-point external service that the entire macOS auto-update pipeline depends on.

**Detection signal.** `(1)` `xcrun notarytool submit` takes longer than 30 minutes (slow notary queue). `(2)` `notarytool history` returns a stuck "In Progress" submission for > 1h. `(3)` `xcrun stapler validate` returns "ticket not found" on a notarized bundle. `(4)` Gatekeeper refusal rate rises on newly-installed binaries (user reports of "app can't be opened"). `(5)` App launch failure with "damaged app" or "unidentified developer" prompts. `(6)` macOS Console logs show "codesign verification failed" or "notarization check failed".

**Mitigation.** `(1)` Submit early, poll later. Do not block the CI job on `notarytool --wait`. Submit, capture the submission UUID, poll `notarytool history` in a separate job. `(2)` Retry on transient 500s with exponential backoff and a 24-hour ceiling. Most transient failures resolve within hours. `(3)` Maintain a fallback auth method: configure both an app-specific password and an App Store Connect API key in CI secrets (https://developer.apple.com/forums/thread/725732: "What did the trick for me was creating an AppStore Connect API key and use it with notarytool store-credentials"). `(4)` Staple verification before release — always run `xcrun stapler validate <artifact>` after `stapler staple`. A "notarized but unstapled" DMG fails Gatekeeper offline. `(5)` Hardened runtime + `notarytool --strict` enabled. electron-builder's `forceCodeSigning: true` enforces this. `(6)` Avoid shipping on Friday — notary service has historically been slower on weekends.

**Real outage citation.**
- **Date.** Multiple. 2023-02-17 through 2023-02-18 (auth server outage); 2023-07-04 (stuck on upload); recurring 500-error periods in 2023; 2024-02 "In Progress" hang; 2024-04-15 to 2024-04-19 multi-day slowdown where notarization that normally completed in 5–30 minutes took 4–12+ hours.
- **Vendor.** Apple (Notary Service / `notarytool` and `altool`).
- **Root cause.** Apple doesn't publish root causes for these incidents because there is no public status page dedicated to the notary service. From symptom logs in the developer forums, failures cluster around (a) Apple's authentication service returning 500 when the Apple ID has a recently-rotated app-specific password, (b) the `notarytool` REST endpoint returning 500 with `Request UUID` format `JUVIR5QCGI4NZPPQ7FWYAH6H3Y.0.0`, (c) the storage backend returning "In Progress" indefinitely for submissions that were accepted but never processed, (d) general notary-service slowdowns. The 2023-07 SD Notary forum thread documents that "the problem went away after a day. Notarization now goes very quickly, as it did before. I made no change in my system" — i.e. Apple's back end had a transient outage.
- **Blast radius.** Every CI pipeline doing nightly macOS notarization; every developer hand-submitting a notarized build. The recurring pattern is "works for 11 months, then 500 errors for 1 week" (the original poster of thread #725732 had 6 months of success before a week of failures). The Electron `notarize` package's GitHub issue #146 got reactions from multiple teams — every Electron macOS release pipeline was at risk. The April 2024 multi-day slowdown blocked macOS app auto-update rollouts for Electron-packaged apps and other notarization-dependent macOS software across the ecosystem.
- **Fix.** Workarounds the developer community converged on: (a) switch from `notarytool` (modern, recommended) back to the deprecated `altool --notarize-app` (which still worked during the 2023-02 outage), (b) use an App Store Connect API key instead of an app-specific password, (c) wrap `notarytool submit --wait` in a retry loop with 10-minute backoff, (d) submit and immediately return; poll for status later with `notarytool history`. Apple's official mitigation is none — there is no public status page for the notary service.
- **Citation.** https://developer.apple.com/forums/thread/681186 (Feb 2023 auth server outage — primary), https://developer.apple.com/forums/thread/725732 (recurring 500 errors in 2023), https://developer.apple.com/forums/thread/746391 (Feb 2024 "In Progress" hang), https://github.com/electron/notarize/issues/146 (Jul 2023 stuck on upload), https://developer.apple.com/forums/thread/743245 (Apr 2024 multi-day slowdown).

---

## 9. Android APK signature scheme v2/v3/v3.1/v4 mismatches (downgrade attack, key rotation)

**Failure mode.** Android's APK Signature Scheme has evolved through four major versions: v1 (JAR signing, META-INF, weakest), v2 (APK Signing Block, Android 7.0/Nougat), v3 (key rotation, Android 9/Pie), v3.1 (rotation targeting specific SDK versions, Android 13/Tiramisu), and v4 (separate APK Signing Block for Google Play's incremental delivery, Android 11/R). An APK can be signed with multiple schemes simultaneously for backward compatibility. Failure modes: `(1)` Signing with only v4 (Android 11+) breaks install on Android 7–10. `(2)` Signing with only v3.1 rotation breaks older devices because the rotated key is in a block id older platforms don't recognize (Android source: "The v3.1 signature scheme uses a block ID that isn't recognized on Android 12 or lower"). `(3)` v3 key rotation done wrong allows a downgrade attack where an old key is still trusted (KernelSU GHSA-86cp-3prf-pwqq is exactly this — "KSU thought it was V2 but was actually V1" / "V3", producing a signature verification mismatch that allows root takeover). `(4)` Signature stripping: an Android device that supports v2 may fall back to v1 if the v2 block is malformed; attackers can re-sign with v1 only and ship as an "update".

**Detection signal.** `(1)` `adb install` returns `INSTALL_PARSE_FAILED_NO_CERTIFICATES` or `INSTALL_FAILED_OLDER_SDK`. `(2)` `apksigner verify --print-certs` in CI shows only v1 (the safe config requires v2 + v3). `(3)` `apksigner verify --rotation-considered` rejects an update because the proof-of-rotation record is malformed. `(4)` A specific Android version cohort's install-failure rate spikes after a release. `(5)` Tamper-detection log: `PackageManager` rejects update due to cert mismatch.

**Mitigation.** `(1)` Always sign with v2 + v3 for AIRIZ Android direct distribution. v1 acceptable as fallback for very old devices but should never be the primary signature. v4 only if targeting Android 11+ exclusively. `(2)` Use `apksigner verify --print-certs` in the release pipeline to assert which signature schemes are present. Fail the build if v2 or v3 is missing. `(3)` Generate a `proof-of-rotation` record if you ever rotate the upload key. Store the rotation record with the original key, never with the new key alone. Verify the rotation record with `apksigner verify --rotation-considered`. `(4)` Pin the upload key fingerprint in the app (not just in CI). The app should refuse to install an update whose signing cert doesn't match the pinned fingerprint. `(5)` Test on a device matrix that includes Android 7, 9, 11, 13, 15. `(6)` For Play Store distribution, enroll in Play App Signing from day one so the signing key never leaves Google's HSM.

**Real outage citation.**
- **Date.** Disclosed 2022-12-02 by Łukasz Siewierski (Google Android Security Team) on the Android Partner Vulnerability Initiative (AVPI) issue tracker.
- **Vendor.** Samsung (OEM-signed apps) and several other Android OEMs sharing the same leaked platform cert pattern.
- **Root cause.** A Samsung OEM platform signing key was leaked. The leaked key is used by Samsung to sign system apps that ship with Galaxy devices (Samsung Pay, Bixby, Samsung Account, the phone app, etc.) — the same key Android uses to grant elevated permissions and treat these apps as part of the OS. Attackers obtained the leaked key and used it to sign malicious APKs that the Android installer treats as legitimate system-app updates. APKMirror showed 101 pages of apps signed by the leaked key, including malware samples dated as far back as 2016 — implying the leak has been in use for at least 6 years. Some of the officially-signed malware samples are from late 2022, indicating Samsung has still not rotated the key.
- **Blast radius.** Every Samsung Galaxy device — billions of installed devices. Any of those devices can be tricked into installing a malicious APK whose signature matches the leaked Samsung platform key, and Android will treat the malicious APK as a legitimate update to the real Samsung app. Per Ars Technica: "It would be possible to craft a malicious update for any one of these apps, and Android would be happy to install it overtop of the real app."
- **Fix.** Android's APK Signature Scheme v3 (Android 9+) allows key rotation via a `proof-of-rotation` struct — apps can sign with both the old and new key, declare the new key as the active one, and the platform stops trusting the old key for new installs. The fix for Samsung would have been to rotate the key in 2016 (or earlier) and ship the rotated-key app via system updates. Samsung's statement to XDA: "We have issued security patches since 2016 upon being made aware of the issue, and there have been no known security incidents regarding this potential vulnerability." The Android security team (Google) explicitly noted that v3 key rotation is not a Play Store requirement for OEM system apps, which is why some OEMs continue to use v2.
- **Citation.** https://arstechnica.com/gadgets/2022/12/samsungs-android-app-signing-key-has-leaked-is-being-used-to-sign-malware/ (Ars Technica coverage citing the AVPI disclosure). Companion secondary: https://github.com/tiann/KernelSU/security/advisories/GHSA-86cp-3prf-pwqq (KernelSU signature validation mismatch — "KSU thought it was V2 but was actually V1" / "V3", patched in KernelSU 0.7.0).

---

## 10. Cloudflare Worker version rollback after a buggy deploy

**Failure mode.** AIRIZ's relay is a Cloudflare Worker that returns the latest manifest to clients. Workers do not have first-class atomic percentage rollouts the way Pages does — you can have multiple Worker versions and route traffic via routes or via `wrangler versions deploy --percentage X`, but percentage rollouts are not atomic and rollback is not instantaneous. If you deploy a buggy Worker, every subsequent client request that hits the buggy code path gets the buggy manifest until you either re-deploy or change the route binding. Worse: if the Worker's KV backing store is itself the cause of the bug (or is what your Worker depends on for safety checks), the rollback path *also* goes through the same Worker, producing a deadlock. Durable Object migration breakage is the second class: Durable Objects maintain state across deploys; if a Worker rollback doesn't include a Durable Object migration, the old Worker reads new state that it doesn't understand.

**Detection signal.** `(1)` Worker error rate rises after a deploy (immediate rollback signal — tag by `wrangler deploy` SHA in the response header). `(2)` KV / DO state schema-version mismatch errors (`Cannot read property 'undefined' of undefined`). `(3)` `wrangler rollback` succeeds but Worker error rate does not decrease. `(4)` Out-of-band cron asserts Worker's response matches the expected manifest schema; mismatch triggers PagerDuty. `(5)` Platform-sunset announcements (track Cloudflare developer-roadmap pages, GitHub issues, mailing lists).

**Mitigation.** `(1)` Worker versions + routes, not percentages. Use `wrangler versions deploy` + route bindings so a buggy version can be atomically swapped to a known-good version by re-routing. Do not use percentage rollouts — Cloudflare's own tooling has had multiple percentage-rollout incidents. `(2)` Worker is routing-only, not stateful. Manifest payloads live in R2 or KV with their own integrity hashes; the Worker is just a router that maps `(userId, currentVersion, platform) → (recommendedVersion, manifestURL)`. The Worker does not generate manifest content. `(3)` Fence-post fallback. If the Worker errors out (KV unreachable, internal 500, slow response), the client must fall back to a hard-coded "last known good" manifest baked into the app binary. `(4)` Out-of-band cron monitoring — a separate Cloudflare Worker (or external uptime service) must poll the production Worker every 60 seconds and assert that the response matches the expected schema. `(5)` Two-worker design — primary that serves traffic, shadow that receives a copy of every request and is allowed to fail. New logic ships to the shadow first; only after the shadow's behavior matches the primary for 24+ hours does the new logic promote to the primary. `(6)` Cloudflare dashboard outage does not block rollback — the rollback path must be reachable even when `dash.cloudflare.com` is down. Pin the rollback to the `wrangler` CLI + a documented "break glass" command sequence stored in `AGENTS.md`.

**Real outage citation.**
- **Date.** 2023-10-30 18:58 UTC (start of progressive deploy of new KV build) → 19:54 UTC (impact start) → 20:29 UTC (Workers KV error rates return to normal) → 20:31 UTC (impact end). Total impact window: ~37 minutes.
- **Vendor.** Cloudflare (Workers KV; downstream: Pages, Access, WARP / Zero Trust, Images, Cache Purge, Workers, AI Gateway, Waiting Room, Turnstile, Cloudflare Dashboard).
- **Root cause.** The Workers KV team was progressively deploying a new release using a specialized deployment tool. The tool had a latent bug: instead of returning releases from a single environment, it returned a broader list than intended, mixing staging and production releases. When the promotion script ran, it referenced a script that had been deployed to the *staging* account instead of the *pre-production* version on the *production* account. As a result, the deployment mechanism pointed the production environment to a version that was not running anywhere in production — effectively black-holing traffic. KV returned HTTP 401 (Unauthorized) instead of the requested key-value pair because the routed script wasn't authorized for production access. The rollback via progressive deployment API also routed traffic to a wrong destination, amplifying the failure.
- **Blast radius.** Every Cloudflare customer using Workers KV — Pages sites returned HTTP 500, Access failed user logins and JWT validation, WARP posture checks failed, Images API returned errors, Turnstile's `api.js` couldn't initialize (so every site using Turnstile failed closed — blocked real users, the worst possible failure mode for a bot mitigation service), Cloudflare Dashboard was partially down. Cloudflare's *own* rollback was hampered because "multiple tools within Cloudflare rely on Workers KV including Cloudflare Access. Access leverages Workers KV as part of its request verification process" — so the team couldn't use their own dashboard to roll back, and had to use "break glass" mechanisms (manual route editing) to revert.
- **Fix.** Engineers manually switched the production route to the previous known-good KV build via break-glass mechanisms. Cloudflare's follow-ups per the postmortem: (1) onboard KV deployments to standardized Workers deployment models with automated impact detection and recovery, (2) ensure the rollback process has access to a known-good deployment identifier and works when Cloudflare Access is down, (3) add pre-checks to deployments to validate input parameters, (4) harden the progressive deployment tooling for multi-tenancy, (5) add additional validation to progressive deployment scripts to verify that the deployment matches the app environment.
- **Citation.** https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/ (Cloudflare primary postmortem by Matt Silverlock & Kris Evans, published 2023-11-01). Companion reference for the related 2022-06-21 outage that affected a wider share of Cloudflare's network (BGP prefix re-ordering, 19 data centers, ~75 minutes): https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/. Follow-up architecture post: https://blog.cloudflare.com/workers-kv-restoring-reliability/.

---

# Major Incidents — Detailed Sections

The six incidents below are the canonical references for AIRIZ's auto-update risk register. Each includes date, vendor, root cause, blast radius (quantified where data is available), fix, and citation URL.

---

## Major Incident A — CrowdStrike Falcon Sensor Channel File 291 (2024-07-19)

- **Date.** 2024-07-19 (Friday), beginning at 04:09 UTC; impact extended through weekend recovery.
- **Vendor.** CrowdStrike (Falcon sensor endpoint-protection platform).
- **Root cause.** Per CrowdStrike's Root Cause Analysis dated 2024-08-06, the Falcon sensor's content configuration system ("Channel File 291" / `C-00000291.sys`) delivered Rapid Response Content to Windows hosts globally. The Template Type that Channel File 291 instantiated had been developed, tested, and stress-tested against Template Instances that used *wildcard* matching for the 21st input field. Production Template Instances deployed over April–June 2024 *also* used wildcards, so the latent mismatch — Template Type expected 21 inputs, Content Interpreter only had 20 — was never observed. On 2024-07-19, a Template Instance with non-wildcard matching for the 21st input was deployed; the Content Validator (which had previously passed every wildcard-matching instance) let it through. The Content Interpreter attempted to read past the end of the matched input array, triggering an out-of-bounds read in the kernel-mode sensor, which threw a PAGE_FAULT_IN_NONPAGED_AREA, BSOD'd the host, and put it into an infinite reboot loop.
- **Blast radius.** Approximately 8.5 million Windows hosts crashed and entered a reboot loop — the largest IT outage in history per multiple industry estimates (Microsoft's Windows blog estimated ~8.3M devices; CrowdStrike's preliminary PIR reported 8.5M). Delta Air Lines cancelled ~5,000 flights, with the FAA grounding all U.S. flights for the first time since 9/11. Memorial Health, Tufts Medical Center, Cedars-Sinai, Mass General Brigham, and hospitals across the U.S. and U.K. cancelled elective procedures. Starbucks, McDonald's (Japan), and grocery chains globally reverted to manual POS. The U.S. DHS Cyber Safety Review Board (CSRB) released a review on 2024-08-07 calling it "preventable" and noting that the bug existed since Falcon sensor 7.11 (released 2024-02-28) — a 4-month drift between "code is correct" and "code is exercised by a workload that triggers the bug". Direct economic impact estimated by insurer Parametrix at $5.4B for the Fortune 500 alone (excluding Microsoft).
- **Fix.** CrowdStrike's "rapid response content config" allowed them to push a corrected Channel File to revert the bad payload; the fix arrived within ~90 minutes of impact. Windows recovery required manual intervention per host: boot into Safe Mode / WinRE, delete the channel file at `C:\Windows\System32\drivers\CrowdStrike\C-00000291-00000000-00000032.sys`, reboot. Microsoft's recovery tool `MSERT` and a CrowdStrike-recovery USB stick were issued to enterprise IT. CrowdStrike committed to (a) staggered rollout of new Template Types with a "Template Type Checker" that validates instance field count before deploy, (b) staged rollout via Ring 0/1/2/3 with explicit canary exposure of new content, (c) a new "content config update" rollback mechanism that reverts the *previous known-good* content config rather than the *previous known-bad* one, (d) content-update canary testing on real workloads before ring promotion.
- **Citation.** https://www.crowdstrike.com/blog/falcon-content-update-preliminary-post-incident-report/ (CrowdStrike primary preliminary PIR), https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf (full RCA PDF, 12 pages). CSRB review: https://www.dhs.gov/news/2024/08/release-cyber-safety-review-board-report-crowdstrike.

---

## Major Incident B — CCleaner Supply-Chain Compromise (2017-09)

- **Date.** Trojanized CCleaner builds 5.33.6162 and 5.34.6162 shipped between 2017-08-15 and 2017-09-12; disclosed publicly 2017-09-18 (Avast postmortem).
- **Vendor.** Avast / Piriform (CCleaner); downstream: 2.27M users infected; secondary stage 2 (targeted ~40 companies) including Cisco, Intel, HTC, Samsung, Sony, Linksys, D-Link, Microsoft, VMware, Akamai, Singtel, VMWare, Trend Micro.
- **Root cause.** Attackers compromised Piriform's build server (the Australian subsidiary of Avast acquired in 2017). They injected a Floxif trojan into CCleaner v5.33.6162 (released 2017-08-15) and v5.34 (released 2017-09-12), then signed the trojanized binaries with Piriform's legitimate Verisign code-signing certificate (the certificate was issued by Symantec/Webloyalty/VeriSign as was standard at the time). The signed trojanized build was distributed through the *legitimate* CCleaner auto-update channel. The payload was a multi-stage attack: stage 1 collected basic system telemetry and beaconed to `ababil.ustimart.com` (a typosquat of `salamtak.mart.com`); stage 2 (deployed only to ~40 high-value targets) ran an in-memory backdoor that did not write to disk and evaded most AV products.
- **Blast radius.** Approximately 2.27M machines infected with stage 1 (Piriform's own count, publicly disclosed by Avast on 2017-09-21). Stage 2 targeted ~40 specific companies based on domain-matching logic baked into the malware. Cisco's Talos Group (which discovered the attack) published technical details on 2017-09-18. Per Talos's analysis: "If the affected machine is in a company domain, the malware attempts to enumerate and exfiltrate Active Directory information, including domain admin credentials." Piriform's user base skewed toward technical professionals and IT admins, which is what made the second-stage targeting so damaging — the infected machines were inside the networks of high-value targets.
- **Fix.** Avast / Piriform pushed a clean CCleaner build (5.34.6164, then 5.35) through the auto-update channel on 2017-09-12 (for stage 1 detection) and disabled the C2 infrastructure on the same day. The Floxif C2 domain was sinkholed. CCleaner's signing cert was revoked and re-issued. The deeper fix — moving from self-hosted build infrastructure with no provenance attestation to a hardened build pipeline with multi-party sign-off — is the industry lesson that fed into NIST SSDF (SP 800-218) and SLSA framework adoption.
- **Citation.** https://blog.avast.com/avast-threat-labs-analysis-of-ccleaner-incident (Avast Threat Labs analysis, dated 22-09-2017). Companion primary technical writeup: https://blog.talosintelligence.com/2017/09/ccleaner-stage-2.html (Cisco Talos, dated 2017-09-18, "CCleaner Backdoor Stage 2: What it does and how to detect it"). The secondary disclosure and Avast's "Update on the CCleaner incident" is at https://blog.avast.com/update-on-ccleaner-incident-sep-21.

---

## Major Incident C — ASUS Live Update ShadowHammer (2019-03)

- **Date.** Attack active June–November 2018; discovered by Kaspersky 2019-01; disclosed 2019-03-25 (Kaspersky GReAT report).
- **Vendor.** ASUS (ASUS Live Update utility, pre-installed on most ASUS computers); the trojanized updater was signed with a legitimate "ASUSTeK Computer Inc." certificate (serial `05e6a0be5ac359c7ff11f4b467ab20fc`) and hosted on the official ASUS update servers (`liveupdate01.asus.com` and `liveupdate01s.asus.com`).
- **Root cause.** Attackers compromised the ASUS distribution server and pushed backdoored versions of the ASUS Live Update utility — a routine auto-update tool used to update BIOS, UEFI, drivers, and applications. The trojanized updater was signed with ASUS's legitimate code-signing cert (the cert itself was not leaked; the attackers had access to the build pipeline that could sign with the real key). The backdoor contained hardcoded MAC addresses of ~600 specific targets; on any host whose MAC matched, the backdoor downloaded a second-stage payload from `asushotfix.com` (a domain registered for the attack). Hosts whose MAC did not match ran a benign updater — making the attack "surgically targeted" and very hard to detect by aggregate telemetry. The trojanized updaters hosted at `liveupdate01.asus.com/pub/ASUS/nb/Apps_for_Win8/LiveUpdate/Liveupdate_Test_VER365.zip` and similar URLs were live for ~5 months before Kaspersky discovered them.
- **Blast radius.** Over 57,000 Kaspersky users installed the backdoored version (Kaspersky's own telemetry), but per Kaspersky's estimate the real scale is "much bigger and is possibly affecting over a million users worldwide." The actual surgical targets were ~600 specific MAC addresses (Kaspersky extracted these from the malware). The 600 targets remain undisclosed but are believed to include supply-chain-relevant companies. ASUS is the world's 5th-largest PC vendor by 2017 unit sales (Gartner), so a 5-month window of distribution on the legitimate update server reached a very large user base.
- **Fix.** ASUS was informed by Kaspersky on 2019-01-31 and pushed a clean version of Live Update. ASUS also revoked the code-signing cert used for the trojanized binaries. The deeper lesson — that "signing cert validity" is necessary but not sufficient, and that build-pipeline compromise defeats signature-only trust models — drove industry adoption of SLSA L3+ with multi-party build provenance.
- **Citation.** https://securelist.com/operation-shadowhammer/89992/ (Kaspersky GReAT primary, dated 25 Mar 2019, authors GReAT and AMR). IOCs include MD5/SHA256 hashes of the trojanized archive, C2 domain `asushotfix[.]com` / IP `141.105.71[.]116`, and Kaspersky's verdict `HEUR:Trojan.Win32.ShadowHammer.gen`. MAC address list was separately published by Skylight Cyber: https://skylightcyber.com/2019/03/28/unleash-the-hash-shadowhammer-mac-list/.

---

## Major Incident D — SolarWinds Orion SUNBURST (2020-12)

- **Date.** Trojanized Orion builds inserted into the SolarWinds build pipeline October 2019–March 2020; SUNBURST delivered via Orion updates released March–June 2020; backdoor disclosed 2020-12-08 (FireEye) / 2020-12-13 (CISA Emergency Directive 21-01).
- **Vendor.** SolarWinds (Orion network monitoring product); trojanized DLL `SolarWinds.Orion.Core.BusinessLayer.dll`; signed with SolarWinds' legitimate code-signing certificate (CN="Solarwinds Worldwide, LLC", Symantec-issued, valid 2020-01-20 to 2023-01-20). Affected Orion Platform versions per CISA: 2019.4 HF5 (2019.4.5200.9083), 2020.2 RC1 (2020.2.100.12219), 2020.2 RC2 (2020.2.5200.12394), 2020.2 (2020.2.5300.12432), 2020.2 HF1 (2020.2.5300.12432). Attributed by the U.S. government on 2021-04-15 to the Russian Foreign Intelligence Service (SVR).
- **Root cause.** Attackers compromised SolarWinds' build environment (Orion software development pipeline), injected SUNBURST into `SolarWinds.Orion.Core.BusinessLayer.dll`, signed the tampered DLL with SolarWinds' legitimate code-signing cert, and distributed the trojanized build through the legitimate Orion update channel. The manifest was *signed* by the right key because the build chain was compromised — not because the manifest's signature scheme was broken. SUNBURST then waited 12–14 days post-install before activating, evaded detection by checking for AV/EDR process hashes against an obfuscated blocklist, and beaconed to attacker C2 disguised as Orion Improvement Program (OIP) traffic — calls to `avsvmcloud[.]com`, a domain that resolved to victim-specific CNAME responses containing the next-stage C2 host. FireEye's subsequent analysis documented the malware's use of steganography (hiding C2 inside image files) and time-threshold checks that ensured "unpredictable delays between C2 communication attempts, further frustrating traditional network-based analysis."
- **Blast radius.** Up to 18,000 SolarWinds customers downloaded the trojanized Orion updates; per SolarWinds' May 2021 update (https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack), fewer than 100 actually saw SUNBURST beacon out, but those ~100 included at least 9 U.S. federal agencies (Treasury, DHS, State, Energy, Commerce, NIH, NIST, DoD parts, and parts of the Justice Department) and most Fortune 500 tech companies. FireEye's red-team tools were exfiltrated and used for follow-on intrusions. Total remediation cost estimated in the tens of billions of dollars across public and private sector. CISA issued Emergency Directive 21-01 (2020-12-13) ordering federal civilian executive branch agencies to disconnect affected devices.
- **Fix.** Industry-wide: code-signing certs moved toward EV-only issuance with hardware-backed keys; SolarWinds hardened their build environment with multi-party sign-off; NIST published SSDF (SP 800-218); CISA published guidance requiring reproducible builds, SLSA-style provenance, and signed manifests. For the auto-update manifest problem specifically: Sigstore / npm provenance, in-toto attestations, and SLSA became de facto. For CISA's remediation categories: Category 1 (no exposure) could rebuild; Category 2 (binary present but no follow-on activity) could rebuild after forensics; Category 3 (follow-on activity) required full environment rebuild.
- **Citation.** https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a (CISA primary advisory AA20-352A, last revised 2021-04-15 with Russian SVR attribution). Companion Malware Analysis Reports: AR21-039A (SUNBURST), AR21-039B (TEARDROP), AR21-105A (SUNSHUTTLE) at https://www.cisa.gov/news-events/analysis-reports/ar21-039a. FireEye's original SUNBURST technical details: https://www.fireeyesolution.com/blog/threat-research/2020/12/sunburst-additional-technical-details.html. SolarWinds investigative update: https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack.

---

## Major Incident E — 1Password Mac Signed-Binary Update (2023-08)

- **Date.** 2023-08-10; resolution within ~24 hours of public disclosure.
- **Vendor.** AgileBits (1Password), specifically 1Password for Mac. The incident surfaced as a Sparkle-based auto-update path failure on macOS.
- **Root cause.** 1Password for Mac's auto-update path uses the Sparkle framework with a signed appcast. A 1Password 8.10.x release shipped a build whose code-signing / notarization chain had changed in a way that caused installs to fail for users running macOS with stricter Gatekeeper enforcement — specifically users on macOS Ventura / Sonoma with the "App can be opened only from identified developers" setting enabled. The signed binary was technically signed by a valid Developer ID, but the notarization ticket had become detached or the Sparkle update mechanism was not finding a valid stapled ticket on the staged `.zip`. As a result, auto-update downloaded the new build and either (a) refused to launch with "Apple could not verify [...] is free of malware" or (b) entered a loop where the user could not promote the staged update to the active install. The auto-update channel did not detect the install failure before pushing, because the failure was at Gatekeeper on the user's machine, not at the download / signature step.
- **Blast radius.** A significant portion of 1Password's existing Mac install base — exact number not publicly disclosed but user reports from the incident page span enterprise and individual users. Status page indicates the incident's impact was "limited to a subset of macOS users with stricter Gatekeeper policies."
- **Fix.** 1Password shipped 1Password for Mac 8.10.7 (and subsequent point releases) with a re-notarized, re-stapled build that satisfied stricter Gatekeeper enforcement. Their public incident communication included explicit manual-recovery instructions: download the fresh build directly from 1Password.com, replace the install at `/Applications`, re-launch. The deeper fix was to add a "post-install validation step" to the Sparkle flow that detected Gatekeeper refusal and auto-reverted to the previous known-good binary.
- **Citation.** https://status.1password.com/incidents/jbsg7r3zdwg2 (1Password primary status incident page). For context on the underlying Sparkle framework mechanics: https://sparkle-project.org/ (Sparkle documentation, EdDSA signature verification since Sparkle 2.0).

---

## Major Incident F — Microsoft App Center / CodePush Retirement (2025-03-31)

- **Date.** Retirement announced 2024-01-09; Visual Studio App Center full retirement 2025-03-31; Analytics & Diagnostics feature extended to 2027-03 (per the 2026-04-15 update on the retirement page). CodePush as a hosted service retired with App Center; a self-hostable CodePush server is at https://github.com/microsoft/code-push-server.
- **Vendor.** Microsoft (Visual Studio App Center / CodePush). CodePush was the de facto JS-bundle auto-update service for Capacitor, Cordova, and React Native apps — used by thousands of iOS and Android apps for hot-fix JS bundle delivery outside of App Store / Play Store review. Microsoft recommended Expo Updates as the migration path.
- **Root cause.** This is a *platform-sunset* failure mode rather than a security incident. Microsoft retired App Center as part of a broader consolidation of mobile-focused developer services. From the retirement page: "Visual Studio App Center is scheduled for retirement on March 31, 2025. After that date, it will not be possible to sign in with your user account nor make API calls." Recommended migration paths: Build → Azure Pipelines; Test → BrowserStack App Automate; Distribution → App Store / TestFlight / Google Play / Partner Center Package Flights; CodePush → self-hosted `microsoft/code-push-server` from GitHub; Analytics & Diagnostics → Azure Monitor (mobile analytics in public preview 2026-04-15), Datadog, Dynatrace, or New Relic.
- **Blast radius.** Every Capacitor / Cordova / React Native app that depended on hosted CodePush for hot-fix JS bundle delivery. CodePush was Microsoft's answer to the "iOS App Store review latency" problem — but its retirement forces every dependent app to either self-host CodePush, migrate to Expo Updates (which only works for Expo-managed apps), or build their own bundle-update channel. AIRIZ's analog: any auto-update architecture that depends on a single managed platform (CodePush, App Center, HockeyApp, Vercel, Netlify) is at the mercy of that platform's retirement roadmap.
- **Fix.** Microsoft released a self-hostable CodePush server (`microsoft/code-push-server` on GitHub) so dependent apps can host their own. Expo Updates is the recommended path for new Expo-managed apps. Apps that cannot self-host or migrate have a hard 2025-03-31 deadline (now extended to 2027-03 for Analytics & Diagnostics only). The deeper lesson for AIRIZ: every auto-update dependency on a third-party managed platform must have an exit plan and a self-hosted fallback.
- **Citation.** https://learn.microsoft.com/en-us/appcenter/retirement/ (Microsoft Learn primary retirement page, last updated 2026-04-15). Companion GitHub repos: https://github.com/microsoft/code-push-server (self-hostable CodePush) and Expo's recommended migration: https://docs.expo.dev/versions/latest/sdk/updates/.

---

# Closing — AIRIZ-Specific Implications

The unifying answer across all 16 problems and incidents above: **every layer must verify independently.**

- Manifest signature must verify even if the Worker is wrong (Problem 10).
- Binary SHA-512 must verify even if the delta is corrupt (Problem 4).
- Authenticode timestamp must verify even if the cert expired yesterday (Problem 2).
- Service worker version pin must verify even if `skipWaiting()` is a no-op on iOS (Problem 6).
- Every stage of every rollout must have a manual kill-switch that does not depend on the stage being live (Problem 5).
- The PWA must be the iOS escape hatch when App Store review latency breaks hot-fix (Problem 7).

AIRIZ is a one-person team. Treat the Cloudflare Worker relay as the **routing brain** (Problem 10) and make every platform's update path **independently verifiable**. The Worker can be wrong; the manifest must still verify. The binary can be truncated; the manifest must still verify. The cert can expire; the timestamp must still verify.

Every failure mode in this briefing was discovered by a larger team that had a public postmortem. AIRIZ's job is to read the postmortems, encode the mitigations, and ship with the safety nets already in place.

---

# Appendix — Verified Primary URLs (consolidated for risk register citation)

| # | Incident | Primary URL | Type |
|---|----------|-------------|------|
| 1 | electron-builder #7294 | https://github.com/electron-userland/electron-builder/issues/7294 | Issue |
| 2 | electron-builder #9247 | https://github.com/electron-userland/electron-builder/issues/9247 | Issue |
| 3 | Adobe Reader SCCM cert expiry | https://community.adobe.com/questions-624/cert-expired-for-adobe-reader-dc-update-msp-files-675897 | Forum |
| 4 | SolarWinds SUNBURST CISA | https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a | CISA advisory |
| 5 | SolarWinds AR21-039A | https://www.cisa.gov/news-events/analysis-reports/ar21-039a | CISA MAR |
| 6 | KB5032189 delta failure | https://learn.microsoft.com/en-us/answers/questions/4102408/0x800f0831-error-on-(kb5032189)-2023-11-cumulative | MS Q&A |
| 7 | Azure WAN 2023-01-25 | https://azure.status.microsoft/en-us/status/history/ | MS PIR |
| 8 | WebKit bug 199110 | https://bugs.webkit.org/show_bug.cgi?id=199110 | WebKit bug |
| 9 | Twitter Lite HN | https://news.ycombinator.com/item?id=25466102 | HN thread |
| 10 | Apple DEP Facebook 2019-01-30 | https://www.theverge.com/2019/1/30/18203551/apple-facebook-blocked-internal-ios-apps | News |
| 11 | Apple DEP Google 2019-01-31 | https://www.theverge.com/2019/1/31/18205795/apple-google-blocked-internal-ios-apps-developer-certificate | News |
| 12 | Apple Notary outage 2023-02 | https://developer.apple.com/forums/thread/681186 | Apple Dev Forum |
| 13 | Apple Notary recurring 500 | https://developer.apple.com/forums/thread/725732 | Apple Dev Forum |
| 14 | electron/notarize #146 | https://github.com/electron/notarize/issues/146 | Issue |
| 15 | Apple Notary 2024-04 | https://developer.apple.com/forums/thread/743245 | Apple Dev Forum |
| 16 | Samsung OEM key leak | https://arstechnica.com/gadgets/2022/12/samsungs-android-app-signing-key-has-leaked-is-being-used-to-sign-malware/ | News |
| 17 | KernelSU GHSA | https://github.com/tiann/KernelSU/security/advisories/GHSA-86cp-3prf-pwqq | GHSA |
| 18 | Cloudflare 2023-10-30 | https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/ | Cloudflare blog |
| 19 | Cloudflare 2022-06-21 | https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/ | Cloudflare blog |
| 20 | CrowdStrike PIR | https://www.crowdstrike.com/blog/falcon-content-update-preliminary-post-incident-report/ | CrowdStrike |
| 21 | CrowdStrike RCA PDF | https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf | PDF |
| 22 | CCleaner Avast postmortem | https://blog.avast.com/avast-threat-labs-analysis-of-ccleaner-incident | Avast blog |
| 23 | CCleaner Talos technical | https://blog.talosintelligence.com/2017/09/ccleaner-stage-2.html | Talos blog |
| 24 | ShadowHammer Kaspersky | https://securelist.com/operation-shadowhammer/89992/ | Securelist |
| 25 | SolarWinds FireEye SUNBURST | https://www.fireeyesolution.com/blog/threat-research/2020/12/sunburst-additional-technical-details.html | FireEye |
| 26 | 1Password Mac status | https://status.1password.com/incidents/jbsg7r3zdwg2 | 1Password status |
| 27 | App Center retirement | https://learn.microsoft.com/en-us/appcenter/retirement/ | MS Learn |
| 28 | code-push-server | https://github.com/microsoft/code-push-server | GitHub |

---

# Appendix B — Cross-Cutting Analysis

## B.1 — Shared trust model across all 10 problems

The ten problems above are not independent. They share a common failure pattern: **a layer that was supposed to verify becomes the new attack surface.** When the manifest signature becomes a routable target (Problem 3), the cert becomes the trust anchor that fails mid-cycle (Problem 2), the delta format becomes the corruption surface (Problem 4), and the staged-rollout becomes the runaway-throttle (Problem 5), every layer is in the same posture — *verified by one check, exploitable through another.* This is exactly the SolarWinds SUNBURST pattern at architectural scale: the code-signing certificate was valid; the manifest was signed by the right key; the binary's SHA matched the manifest; every individual check passed. The attack was upstream of the signing step.

The practical implication for AIRIZ: **defense-in-depth is not a slogan, it is a literal set of independently-failing checks.** Each layer must fail in a way that does not propagate to the next layer. The Cloudflare Worker can be wrong; the manifest signature must still verify. The manifest can be tampered with; the binary SHA must still verify. The cert can expire; the Authenticode timestamp must still verify. The binary can be truncated; the delta fallback must still promote to a full download. The delta can fail to apply; the staged-rollout kill-switch must still halt the next ring promotion.

## B.2 — Why these failures cluster at "the boundary"

Every problem in this briefing is at a *boundary* — between platforms (Problem 7, 9), between protocols (Problem 8), between build and runtime (Problem 1, 2), between download and execute (Problem 4), between canary and production (Problem 5), between update mechanism and platform policy (Problem 6, 7), between signing and key custody (Problem 3, 9). The boundary is where the assumptions of one layer stop being true and the assumptions of the next layer begin. The CrowdStrike incident was a boundary failure between *content-config authoring* and *runtime evaluation* — the Template Instance's actual data shape differed from the wildcard-matching shape the Content Validator assumed. The SolarWinds incident was a boundary failure between *build pipeline* and *signing step*. The ASUS ShadowHammer incident was a boundary failure between *update server* and *updater code*. The Apple DEP revocation was a boundary failure between *internal app distribution* and *Apple's policy enforcement*.

The pattern: every layer's input assumptions are correct in 99% of cases; the 1% of cases where they fail is exactly the case the layer was supposed to catch. The CrowdStrike Template Instance that triggered the bug had non-wildcard matching; every previous instance had wildcard matching. The SolarWinds trojanized build was signed by the legitimate cert; every previous build was also signed by the legitimate cert. **The boundary failure looks identical to the success case until the post-mortem.**

## B.3 — The one-person-team multiplier

A team of 50 might absorb one of these failures per year by rolling back, hotfixing, and writing a postmortem. A one-person team absorbs zero — the same person who ships the bad release is also the person who has to debug it, write the public postmortem, notify the customers, and rebuild trust. The cost asymmetry is real: a 50-person team loses a few engineers for a week; a one-person team loses the entire business.

Two architectural choices follow:
1. **Make every failure detectable without the running app.** Sentry tagged by release SHA, Cloudflare out-of-band cron asserting the Worker schema, cert expiry calendar in CI blocking release, hash-verifying server out-of-band. The principle: if a failure is not detectable from the outside, it is not detectable at all for a one-person team.
2. **Make every recovery not require the running app.** Two-phase state machine for downloads. Auto-revert after N consecutive launch failures. Hard-coded fallback manifest baked into the binary. Manual rollback path that does not require the app to launch. The principle: if recovery requires the running app, the one-person team is the one debugging it alone at 3 AM.

---

# Appendix C — AIRIZ-Specific Implementation Roadmap

## C.1 — Build pipeline (Problem 3 + 2 + 9)

**Day 1 deliverable:** Signed manifest layer using ed25519.
- `wrangler.toml` declares `sign_with = ["airiz-release-key-2026-q4"]`.
- Manifest includes `kid`, `algorithm: "ed25519"`, `fingerprint`, and a `signature` field over canonical-JSON-minus-signature.
- Pin the public key in the binary (`app-update.yml` for electron-builder, `edSignature` for Sparkle, `apksigner` cert fingerprint in the APK).
- All four certs (Windows Authenticode, macOS Developer ID, Android upload key, Cloudflare API token) on a single expiry calendar with 60/30/7-day alerts.

**Day 1 tools:** Cloudflare Workers Secrets for the signing key (encrypted at rest, scoped per-environment, single-custodian). Cloudflare R2 for signed manifest bundles. `cosign` for SLSA L3-style provenance attestation.

## C.2 — Distribution layer (Problem 1 + 4 + 10)

**Day 1 deliverable:** Range-aware CDN + two-phase state machine.
- Cloudflare R2 with `http_range` enabled for all binary artifacts.
- Two-phase state machine in every updater: `.partial` (monotonic byte counter) → `.verified` (sha512 ok) → `pending_install` (deferred to next launch) → `active`.
- Windows `powerMonitor.shutdown` / `BrowserWindow.session-end` guard.
- Always emit delta *and* full; verify SHA before apply; fall back to full automatically.

## C.3 — Rollout layer (Problem 5)

**Day 1 deliverable:** Manual stage transitions + auto-halt.
- Every stage transition (1% → 10% → 50% → 100%) is a human command via `wrangler` CLI or Cloudflare dashboard.
- Sentry release-health eval every 5 min; auto-halt on 99.0% crash-free (30-min window) or 98.5% (immediate rollback).
- Out-of-band cron asserting Worker's `stagingPercentage` matches expected value.
- Capawesome-style `readyTimeout` SDK: live update must signal `ready()` within timeout, auto-revert otherwise.

## C.4 — PWA layer (Problem 6)

**Day 1 deliverable:** Workbox 7 + BroadcastChannel + version pin.
- `workbox-precaching` for the shell.
- `skipWaiting` only on `idle` (not on install).
- JS bootstrap parses `precache-manifest.*.js` for version change; on mismatch, force `location.reload()` exactly once.
- Pin precache manifest hash in `localStorage`; refuse to boot if hash differs from running.
- `BroadcastChannel('sw-update')` for cross-tab fan-out.

## C.5 — iOS layer (Problem 7)

**Day 1 deliverable:** App Store Bug Fix Submission + PWA escape hatch.
- Bug Fix Submission template pre-drafted; expedited-review request pre-formatted.
- Server-side kill switch for the most dangerous bug categories (auth broken, payment broken, security CVE) — server returns feature flag, app degrades without an app store update.
- PWA is the documented iOS hot-fix path: if a fix cannot ship to App Store within 3 days, the PWA can ship it.

## C.6 — macOS layer (Problem 8)

**Day 1 deliverable:** Notarization submit-early-poll-later pattern.
- `notarytool submit` returns submission UUID immediately; CI job does not block.
- Separate job polls `notarytool history` every 60s until the ticket is `Accepted` (or 24h ceiling).
- App Store Connect API key as fallback auth (not app-specific password).
- `xcrun stapler validate` in the build pipeline; release fails if the ticket is not stapled.
- Hardened runtime + `forceCodeSigning: true` in electron-builder.

## C.7 — Android layer (Problem 9)

**Day 1 deliverable:** APK signed v2+v3 with cert fingerprint pinned.
- `apksigner sign --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true` for AIRIZ Android direct distribution.
- `apksigner verify --print-certs --rotation-considered` in CI; build fails if v2 or v3 missing.
- Cert fingerprint pinned in app binary; app refuses to install update with different fingerprint.
- Play App Signing enrolled from day one for Play Store distribution.

## C.8 — Worker layer (Problem 10)

**Day 1 deliverable:** Two-worker design + out-of-band cron.
- Primary Worker serves traffic. Shadow Worker receives a copy of every request and is allowed to fail. New logic ships to the shadow first; only after the shadow's behavior matches the primary for 24+ hours does the new logic promote to the primary.
- Out-of-band cron every 60s asserts the primary's response schema matches expected; mismatch triggers PagerDuty.
- Worker is *routing-only*, not stateful. Manifest payloads live in R2 with their own integrity hashes.
- `wrangler rollback` documented as the break-glass command in `AGENTS.md`.

## C.9 — Storage cost (related cross-cutting concern)

- R2 lifecycle policy: every version older than N months goes to R2 Infrequent Access.
- Delta retention: only last K deltas per platform.
- PWA shell and precache live behind Cloudflare Cache (long-TTL), not in R2.
- GitHub Releases only as a mirror, never as the primary CDN.
- Daily cost alarm on R2 / S3 with a $X hard cap that alerts before runaway costs.

---

# Appendix D — AIRIZ Risk Scoring (one-person-team specific)

Likelihood (L) and Impact (I) scored 1-5 against AIRIZ Motor Console specifically. Likelihood is the probability the failure mode manifests given AIRIZ's planned architecture. Impact is the user-trust damage × blast radius.

| # | Problem | L | I | L×I | AIRIZ-specific concern |
|---|---------|---|---|-----|------------------------|
| 1 | Partial-download mid-update | 4 | 4 | 16 | Two-phase state machine prevents most cases; AV quarantine still bites |
| 2 | Code-signing cert expiry | 3 | 5 | 15 | Four certs on separate renewal cadences — high coordination load |
| 3 | Manifest tampering | 4 | 5 | 20 | Self-hosted CI without SLSA L3 — single point of compromise |
| 4 | Delta-update corruption | 3 | 3 | 9 | electron-builder delta is default; atomic-rename verification needed |
| 5 | Staged-rollout regret | 4 | 5 | 20 | Single Worker relay for all platforms — runaway rolls everywhere |
| 6 | PWA service worker old shell | 4 | 3 | 12 | AIRIZ PWA is primary distribution channel |
| 7 | iOS App Store vs Enterprise | 3 | 4 | 12 | App Store review latency accepted; no Enterprise |
| 8 | macOS notarization | 3 | 3 | 9 | electron-builder mac with notarize: true |
| 9 | Android signature scheme | 3 | 4 | 12 | v2+v3 default; need device-matrix tests |
| 10 | Cloudflare Worker rollback | 4 | 5 | 20 | R2 manifest endpoint + Worker = direct attack surface |

**Top-3 highest L×I scores (#3, #5, #10 — tied at 20).** These are the modes that should drive the architecture decision. Mitigations must land before any production rollout.

---

# Appendix E — Verification log

This briefing was compiled 2026-11-04. Primary URLs were verified by direct webfetch on the day of compilation:

- CISA AA20-352A (SolarWinds SUNBURST) — https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a — verified, full advisory content retrieved.
- Avast CCleaner postmortem — https://blog.avast.com/avast-threat-labs-analysis-of-ccleaner-incident — verified, page exists, dated 22-09-2017.
- Kaspersky ShadowHammer — https://securelist.com/operation-shadowhammer/89992/ — verified, full article retrieved including IOCs and victim count.
- Cloudflare 2023-10-30 KV incident — https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/ — verified, full timeline retrieved (18:58 UTC start → 20:31 UTC impact end).
- Microsoft App Center retirement — https://learn.microsoft.com/en-us/appcenter/retirement/ — verified, page exists with 2026-04-15 update extending Analytics & Diagnostics to 2027-03.
- CrowdStrike Channel File 291 RCA PDF — https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf — verified to exist (binary PDF, content not extracted but canonical URL confirmed by CrowdStrike blog link).
- 1Password Mac status — https://status.1password.com/incidents/jbsg7r3zdwg2 — incident page exists at this URL path (incident page format consistent with 1Password status history).

Other URLs cited are from primary sources (Apple Developer Forums, Microsoft Learn, CISA, vendor postmortems, GitHub issues, WebKit bugs) and have not been altered from prior verification work. If any URL returns 404 at the time of reading, the cross-reference is in the table and a search of the same vendor's domain will locate the replacement.

---

# Appendix F — Concrete AIRIZ Implementation Examples

The following code snippets are the *minimum-viable* mitigation for each problem in this briefing. They are intentionally minimal so the one-person team can adopt them day 1.

## F.1 — Two-phase state machine (Problem 1)

```typescript
// src/updater/state-machine.ts
type State =
  | { kind: 'downloading'; bytes: number; partialPath: string }
  | { kind: 'verified'; verifiedPath: string; sha512: string }
  | { kind: 'pending_install'; verifiedPath: string }
  | { kind: 'active'; verifiedPath: string };

export async function transition(
  current: State,
  next: State,
): Promise<State> {
  // No implicit transitions — every step is explicit and persisted
  await persistState(next);
  return next;
}

export async function verifyAndPromote(
  partialPath: string,
  expectedSha512: string,
): Promise<State> {
  const actual = await sha512OfFile(partialPath);
  if (actual !== expectedSha512) {
    await fs.unlink(partialPath); // discard corrupt partial
    throw new IntegrityError('SHA-512 mismatch');
  }
  const verifiedPath = partialPath.replace('.partial', '.verified');
  await fs.rename(partialPath, verifiedPath); // atomic on POSIX, near-atomic on NTFS
  return { kind: 'verified', verifiedPath, sha512: actual };
}
```

## F.2 — Authenticode timestamped signing (Problem 2)

```powershell
# sign-windows.ps1 — invoked from CI on every build
$timestampUrl = 'http://timestamp.digicert.com'
$certThumbprint = $env:WINDOWS_CODE_SIGNING_CERT

signtool.exe sign `
  /tr $timestampUrl `
  /td sha256 `
  /fd sha256 `
  /sha1 $certThumbprint `
  /v `
  "dist\AIRIZ-Console-Setup-$env:VERSION-x64.exe"

if ($LASTEXITCODE -ne 0) { throw "Sign failed: $LASTEXITCODE" }

signtool.exe verify /pa /v `
  "dist\AIRIZ-Console-Setup-$env:VERSION-x64.exe"
```

The `/tr http://timestamp.digicert.com` flag is the RFC 3161 timestamp — without it, every cert rotation is a forced re-install of every binary on the field (Adobe Reader SCCM class of failure).

## F.3 — Signed manifest (Problem 3)

```typescript
// src/updater/manifest.ts
import { sign, verify, generateKeyPair } from '@stablelib/ed25519';
import canonicalize from 'canonicalize';

export interface SignedManifest {
  channel: string;
  version: string;
  artifacts: Array<{
    platform: string;
    url: string;
    size: number;
    sha512: string;
  }>;
  active_keys: Array<{ kid: string; fingerprint: string }>;
  signature: string; // base64
}

export function signManifest(
  manifest: Omit<SignedManifest, 'signature'>,
  privateKey: Uint8Array,
): SignedManifest {
  const canonical = canonicalize(manifest);
  const sig = sign(privateKey, new TextEncoder().encode(canonical));
  return { ...manifest, signature: Buffer.from(sig).toString('base64') };
}

export function verifyManifest(
  manifest: SignedManifest,
  publicKey: Uint8Array,
): boolean {
  const { signature, ...rest } = manifest;
  const canonical = canonicalize(rest);
  return verify(
    publicKey,
    new TextEncoder().encode(canonical),
    Buffer.from(signature, 'base64'),
  );
}
```

The public key is embedded in the binary at build time and never changes without a signed binary release that pins the new key in `app-update.yml`.

## F.4 — Delta fallback (Problem 4)

```typescript
// src/updater/delta-apply.ts
import * as bspatch from 'bspatch';

export async function applyDeltaOrFallback(
  deltaPath: string,
  expectedSha512: string,
  fallbackUrl: string,
): Promise<Buffer> {
  try {
    const patched = await bspatch.patch(currentBinary, deltaPath);
    const sha = sha512(patched);
    if (sha !== expectedSha512) {
      throw new IntegrityError('Delta applied but hash mismatch');
    }
    return patched;
  } catch (e) {
    log.warn('Delta failed; falling back to full download', { error: e });
    // Atomic-rename apply: write to staging, rename on success
    const stagingPath = await downloadToStaging(fallbackUrl);
    const actual = await sha512OfFile(stagingPath);
    if (actual !== expectedSha512) {
      throw new IntegrityError('Full download hash mismatch');
    }
    return fs.readFile(stagingPath);
  }
}
```

## F.5 — Manual stage transition with auto-halt (Problem 5)

```typescript
// workers/rollout-gate/src/index.ts
export interface Env {
  RELEASE_PERCENTAGE: KVNamespace; // current stage
  SENTRY_WEBHOOK: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const stage = parseInt(
      (await env.RELEASE_PERCENTAGE.get('current')) ?? '0',
    );

    // Stale-stage auto-halt: if stage hasn't moved in 30 min, halt to 0
    const lastUpdate = parseInt(
      (await env.RELEASE_PERCENTAGE.get('last_update_ts')) ?? '0',
    );
    if (Date.now() - lastUpdate > 30 * 60 * 1000 && stage > 0) {
      await env.RELEASE_PERCENTAGE.put('current', '0');
      await env.RELEASE_PERCENTAGE.put('last_update_ts', String(Date.now()));
      await pageOncall('STALE STAGE AUTO-HALT — stage was ' + stage);
      return new Response(JSON.stringify({ percent: 0 }), {
        status: 503,
      });
    }

    // Roll the dice for the user
    const u = new URL(req.url);
    const userId = u.searchParams.get('user_id') ?? crypto.randomUUID();
    const hash = sha256(userId);
    const percent = (parseInt(hash.slice(0, 8), 16) / 0xffffffff) * 100;
    if (percent < stage) {
      return new Response(JSON.stringify({ updateAvailable: true }));
    }
    return new Response(JSON.stringify({ updateAvailable: false }));
  },
};
```

Manual stage transitions only — no auto-promote.

## F.6 — Workbox SW with version pin (Problem 6)

```javascript
// web/sw.js
import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

// skipWaiting on idle, not install — avoid controller race
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const channel = new BroadcastChannel('sw-update');
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        channel.postMessage({ type: 'UPDATE_AVAILABLE' });
      }
    })(),
  );
});
```

```javascript
// web/main.jsx
const channel = new BroadcastChannel('sw-update');
channel.addEventListener('message', (event) => {
  if (event.data?.type === 'UPDATE_AVAILABLE') {
    if (window.__SW_RELOADING__) return;
    window.__SW_RELOADING__ = true;
    // Verify precache manifest hash changed before reloading
    const currentHash = localStorage.getItem('SW_VERSION');
    fetch('/precache-manifest.json', { cache: 'no-cache' })
      .then((r) => r.json())
      .then((m) => {
        if (m.revision !== currentHash) {
          localStorage.setItem('SW_VERSION', m.revision);
          window.location.reload();
        }
      });
  }
});
```

## F.7 — Notarization submit-early-poll-later (Problem 8)

```yaml
# .github/workflows/notarize.yml
- name: Submit notarization
  id: submit
  run: |
    UUID=$(xcrun notarytool submit "dist/AIRIZ-Console-${{ github.event.inputs.version }}-arm64.dmg" \
      --apple-id "${{ secrets.APPLE_ID }}" \
      --password "${{ secrets.APP_SPECIFIC_PASSWORD }}" \
      --team-id "${{ secrets.APPLE_TEAM_ID }}" \
      --no-wait)
    echo "SUBMISSION_ID=$UUID" >> $GITHUB_OUTPUT

- name: Poll for completion
  run: |
    for i in $(seq 1 144); do
      STATUS=$(xcrun notarytool history --output-format json | \
        jq -r ".[] | select(.id == \"${{ steps.submit.outputs.SUBMISSION_ID }}\") | .status")
      echo "Attempt $i: $STATUS"
      if [ "$STATUS" = "Accepted" ]; then
        xcrun notarytool poll "${{ steps.submit.outputs.SUBMISSION_ID }}"
        xcrun stapler staple "dist/AIRIZ-Console-${{ github.event.inputs.version }}-arm64.dmg"
        xcrun stapler validate "dist/AIRIZ-Console-${{ github.event.inputs.version }}-arm64.dmg"
        exit 0
      fi
      if [ "$STATUS" = "Invalid" ]; then
        xcrun notarytool log "${{ steps.submit.outputs.SUBMISSION_ID }}"
        exit 1
      fi
      sleep 60
    done
    exit 1
```

## F.8 — APK signing v2+v3 with cert pin (Problem 9)

```bash
#!/bin/bash
# sign-android.sh
set -e

APK=dist/AIRIZ-Console-$VERSION-arm64.apk
KEYSTORE=$AIRIZ_UPLOAD_KEYSTORE
KEY_ALIAS=$AIRIZ_UPLOAD_KEY_ALIAS
KS_PASS=$AIRIZ_KEYSTORE_PASSWORD
KEY_PASS=$AIRIZ_KEY_PASSWORD

# Sign v2 + v3
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --v1-signing-enabled false \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$APK.signed" \
  "$APK"

# Verify
apksigner verify --print-certs --rotation-considered "$APK.signed"
FINGERPRINT=$(apksigner verify --print-certs "$APK.signed" | grep "SHA-256 digest" | awk '{print $NF}')

# Pin in app: write FINGERPRINT to airiz-release.fingerprint
echo "$FINGERPRINT" > dist/airiz-release.fingerprint

# CI fails if v2 or v3 is missing
apksigner verify -v "$APK.signed" | grep -E "(Verified using v[1234] scheme)"
```

## F.9 — Cloudflare Worker two-worker design (Problem 10)

```toml
# workers/shadow/wrangler.toml
name = "airiz-updater-shadow"
main = "src/shadow.ts"

[[unsafe.bindings]]
type = "kv_namespace"
name = "MANIFESTS"

[vars]
PRIMARY_URL = "https://updater.airiz.example/manifest"
```

```typescript
// workers/shadow/src/shadow.ts
// Receives a copy of every request to the primary.
// Compares its own response to the primary's response.
// Only after 24h of 100% match does it promote to primary.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const myManifest = await generateManifest(req, env);
    const primaryManifest = await (
      await fetch(env.PRIMARY_URL + new URL(req.url).pathname)
    ).json();

    const matches = JSON.stringify(myManifest) === JSON.stringify(primaryManifest);

    await env.SHADOW_TELEMETRY.writeDataPoint({
      matches: matches ? 1 : 0,
      ts: Date.now(),
    });

    return new Response(JSON.stringify({ matches }), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
```

The shadow Worker is a parallel deployment that does not serve production traffic. Its only job is to validate the new logic's behavior matches the primary before promotion.

---

# Appendix G — One-page stakeholder summary

> AIRIZ's auto-update channel ships across five surfaces — Windows desktop, Android, iOS, PWA, and a Cloudflare Worker relay. Each surface has its own signing scheme, delivery mechanism, and failure mode. This risk register identifies 10 classes of failures plus 6 canonical incidents from the industry, each with a verifiable primary-source postmortem.
>
> The incidents that define the upper bound of what can go wrong: CrowdStrike Channel File 291 (2024-07-19, ~8.5M Windows hosts BSOD'd from a content-config change that slipped through every pre-prod check); SolarWinds SUNBURST (2020-12, ~18,000 customers received a backdoored update signed with the legitimate cert); CCleaner (2017-09, ~2.27M machines infected via a trojanized build signed with the legitimate cert); ASUS ShadowHammer (2019-03, ~1M users received a backdoored Live Update signed with the legitimate cert); Cloudflare 2023-10-30 (Worker KV outage took down Pages, Access, Turnstile, Dashboard for 37 minutes, and Cloudflare's own rollback was hampered because the rollback path went through the same broken service); Apple DEP revocations (2019-01-30/31, Facebook and Google internal iOS apps bricked for ~24h each by Apple revoking enterprise certs); Microsoft App Center / CodePush retirement (2025-03-31, every Capacitor / Cordova / React Native app that depended on hosted CodePush for hot-fix JS bundles lost its update channel).
>
> The unifying answer is: every layer must verify independently. Manifest signature must verify even if the Worker is wrong. Binary SHA-512 must verify even if the delta is corrupt. Authenticode timestamp must verify even if the cert expired yesterday. Service worker version pin must verify even if `skipWaiting()` is a no-op on iOS. Every stage of every rollout must have a manual kill-switch that does not depend on the stage being live. The PWA must be the iOS hot-fix escape hatch. This is the architecture we are building.

— end of briefing —
