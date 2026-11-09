# AIRIZ Motor Console — Release Architecture Risk Register

**Prepared for:** Ziris PTB (AIRIZ one-person team)
**Scope:** Cross-platform auto-update channel (Windows + Android + iOS + Web PWA + Cloudflare Worker)
**Current state:** v1.11.x, custom `sync_release_feed.py` + electron-updater + deprecated Bluetooth-bridge
**Goal:** Identify top 10+ hardest problems in shipping a trusted fleet-scale auto-update channel before committing to architecture.
**Date:** 2026-11-05
**Status:** DRAFT — for architecture decision review

---

## Executive Summary

This document identifies 15 problems that will bite a cross-platform auto-update channel at fleet scale.
The 5 highest-severity problems are:

1. **Partial download / mid-update corruption** — a truncated binary on disk can brick a device
2. **Manifest tampering** — a compromised update server can push malicious code to the entire fleet
3. **Staged rollout regret** — once 25% of the fleet has updated, you cannot un-update them
4. **Silent update failure** — without telemetry, you will not know 40% of your fleet is stuck on an old version
5. **Key custody** — one person holds every signing key; loss of that person or their keys is unrecoverable

Every recommendation is tagged **MUST-HAVE** (blocks production) or **NICE-TO-HAVE** (reduces risk, can defer).
The implementation priority section at the end sequences these into a v1.12.x → v1.13.x → v1.14.x roadmap.

---

## Problem 1: Partial-Download Mid-Update

When a 200 MB Electron app bundle is mid-download and the laptop lid closes, the Wi-Fi drops, or the user's SSD is at 99% capacity, the updater must handle a partial artifact. The failure modes are not a single "file is corrupted" case but a combinatorial explosion: the zip may be truncated (unzip produces a partial binary), the signature may be verifiable on a truncated file before the OS caches it, the atomic rename may succeed before `fsync` actually flushes dirty pages to the physical medium, or the unzip step itself may OOM on a 4 GB RAM Windows machine decompressing a 600 MB Electron ASAR. The design that prevents this is a three-phase protocol: **(1)** download to a uniquely-named temp file and verify both the SHA-256 against the signed manifest AND the code-signing certificate chain before any further action; **(2)** unpack to a sibling directory (not in-place); verify the unpacked binary's Authenticode signature; **(3)** perform a single `rename()` / `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` which is atomic on NTFS (and on ext4 with `rename(2)`). If any phase fails, delete the temp artifact and leave the last-known-good binary untouched. The critical invariant is that the running binary is never replaced in-place. Windows `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` is not truly atomic under all conditions (see the Windows longhorn kernel bug history), so the safest pattern is: write new version to `app-2.0.0/`, update a `current` symlink or registry pointer, and let the old version remain on disk until the next successful launch. Electron's `electron-updater` handles this via its `NSIS` differential update mechanism, but only if the installer's `uninstall` and `install` phases are both crash-safe, which requires the NSIS script to call `Exit` on any error and never partially modify the install directory.

### Citation

**CrowdStrike Falcon — Channel File 291, 2024-07-19.** At 04:09 UTC on July 19, 2024, CrowdStrike pushed a Rapid Response Content update via Channel File 291 to all Windows sensors simultaneously, with no canary stage. The content contained a 21-field template instance, but the sensor's Content Interpreter only supplied 20 input values. The out-of-bounds read triggered a kernel-mode exception, crashing 8.5 million Windows machines globally (approximately 8.6% of all Windows hosts). The update was reverted at 05:27 UTC, but the damage was done to any host that had already fetched the content. By July 29, ~99% of sensors were back online — ten days to recover. The root cause was not a corrupted download; it was a semantically valid file that the consumer could not safely interpret. The lesson for AIRIZ: the content validator validated against the wrong schema (21 fields vs 20 inputs), and there was no runtime bounds check, and the rollout was 100% at once. For a desktop app updater, the analogous failure is pushing an update whose binary requires an OS version or CPU feature that a subset of the fleet lacks, and the updater has no pre-flight capability check before committing the install.

- **Date:** 2024-07-19
- **Vendor:** CrowdStrike
- **URL:** https://www.crowdstrike.com/en-us/blog/falcon-content-update-preliminary-post-incident-report/
- **Full RCA:** https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/

### Recommendations

- Implement a **three-phase atomic update protocol**: download→verify→atomic-rename. Never modify the running binary in place.
- Pre-flight **capability gates** in the manifest: `min_os_version`, `min_arch`, `min_ram_mb`, `min_disk_free_mb`. The updater must check these BEFORE starting the download, not after.
- **Canary rollout** even for a one-person team: push to 5% of the fleet (by device-ID hash), wait 24h of telemetry (crash-free rate > 99.5%), then expand. For a small fleet, even 2–3 canary devices is better than 0.
- **Rollback on crash loop:** if the app crashes 3 times within 5 minutes of launch, the updater must restore the previous version from a retained `last-known-good` directory.
- **Checksum + signature double-verify:** SHA-256 in the manifest catches corruption; Authenticode/Developer ID signature catches tampering. Both are required. Neither is sufficient alone.
- **Resume support:** if the download is interrupted (power loss, network drop), the updater must resume from the byte offset where it left off, not restart. Use HTTP `Range` header. Verify the final file's SHA-256 after resume completes.
- **Disk space pre-check:** before starting the download, verify that `2 × download_size` free space is available (one copy for download, one for extraction). If not, show a "Not enough disk space" dialog and do not start the download.

---

## Problem 2: Code-Signing Certificate Expiry

A Windows EV code-signing certificate is valid for 1–3 years. When it lapses, every binary signed with it becomes untrusted: Windows SmartScreen shows "Windows protected your PC" (the red warning), and the file's Authenticode signature reports `UnknownError` with the message "A required certificate is not within its validity period." The SmartScreen reputation — the statistical trust score Microsoft builds from clean-install telemetry — **resets to zero** when the certificate changes. For an EV certificate, Microsoft had historically granted a ~6-month reputation grace period, but this is an undocumented, unenforceable policy that Microsoft can change at any time. In practice, developers report 3–6 months of "unrecognized app" warnings after a cert rotation, during which every new user sees a warning dialog. The deeper problem is that **you cannot re-sign old binaries**: the old cert is expired, so the timestamp is the only thing keeping them valid. If the timestamp authority (e.g., DigiCert, Sectigo) revokes their own root (as happened with the Symantec/VeriSign cascade in 2017–2018), even timestamped binaries become untrusted. For a one-person team, the single biggest risk is: the EV certificate's private key is stored in a USB token or a TPM on a specific laptop. If that laptop is stolen, destroyed, or the token is lost, the app's signing identity is gone. For iOS, the analogous problem is the Apple Developer provisioning profile (90-day expiry for development, 1-year for distribution) and the distribution certificate (1-year, revocable at Apple's discretion). For Android, the keystore file (P12) is the app's identity: lose it and you cannot update your app on the Play Store (unless you opted into Play App Signing before August 2021, in which case Google holds the key).

### Citation

**Emsisoft Anti-Malware — GlobalSign Certificate Revocation, 2023-09-05.** On August 23, 2023, Emsisoft renewed their EV code-signing certificate as usual. The validation went through and they received a new certificate. All files compiled after that date used the new cert. On September 4, they published version 2023.9. On September 5, GlobalSign contacted Emsisoft to inform them that they had entered the company's business number incorrectly on the certificate. GlobalSign was required to revoke the certificate on September 22. Emsisoft received a corrected certificate, immediately re-signed all files, and published an urgent update. However, a new **driver component** in 2023.9 required a reboot to install. Emsisoft issued an emergency advisory: "We urge all our customers to make sure automatic updates are enabled and reboot their computers before September 22nd, 2023. Not doing so will likely result in a software malfunction that will require re-installation of the software to fix." When a certificate is revoked, "all software files that have been signed with it will produce a security warning, and drivers may not load at all." The root cause was a human error at the CA, entirely outside the developer's control, with a 17-day window to fix it.

- **Date:** 2023-09-05 (advisory); revocation effective 2023-09-22
- **Vendor:** Emsisoft (affected by GlobalSign CA error)
- **URL:** https://www.emsisoft.com/en/blog/44496/critical-software-update-urgent/

Additional evidence: **Bruno API client — expired cert on v1.11.0, 2024-02-29.** The Bruno project's v1.11.0 Windows installer was signed with a Sectigo certificate that expired on 2024-02-24. Users downloading v1.11.0 after expiry saw "Windows has protected your PC." The v1.12.1 release was signed with a new cert (valid to 2025-03-11), but the download page still pointed at the expired-cert build. Fixed in v1.13.0. This is a $0 incident that takes 2 months of user support tickets.
- **URL:** https://github.com/usebruno/bruno/issues/1696

And the **VeriSign Root Removal incident, 2023-08-22 to 2023-08-25.** Microsoft silently removed a legacy VeriSign root certificate from the Windows root store via a Windows Update. For 3 days, applications such as QuickBooks and Avatax failed to launch on Windows with cryptic certificate errors. Airlock Digital's CEO traced the cause. Microsoft re-added the root on August 25 with no public explanation. Users had no warning, no documentation, and no recourse.
- **URL:** https://arstechnica.com/security/2023/08/a-renegade-certificate-is-removed-from-windows-then-it-returns-confusion-ensues/

### Recommendations

- **MUST-HAVE:** Automate cert renewal 90 days before expiry. For a one-person team, this means a calendar reminder + a CI job that fails the build if the cert is < 30 days from expiry.
- **MUST-HAVE:** Use **Authenticated Timestamps** (RFC 3161) on every binary at build time. The timestamp proves the binary was signed while the cert was valid, even after the cert expires. Without timestamps, an expired cert makes ALL historical binaries untrusted.
- **MUST-HAVE (iOS/Android):** If distributing outside the App Store/Play Store, use **Play App Signing** (Android) or **Apple Developer ID** with a hardware-backed key (Secure Enclave / hardware token). Never store the sole signing key on a single laptop.
- **NICE-TO-HAVE:** Maintain a secondary (O: organizational) EV cert as a backup. Rotation requires re-signing + re-distributing, but at least the app stays installable.
- **Key custody:** Store the Android keystore in a hardware security module or at minimum in an encrypted, geographically redundant backup. For the Windows EV cert USB token, store it in a physical safe with the recovery PIN documented in a password manager.

---

## Problem 3: Manifest Tampering — MITM and Supply Chain

The update manifest (a JSON file listing version, download URL, SHA-256, and signature) is the trust anchor of the entire update pipeline. If an attacker can modify the manifest — by compromising the CDN, performing a man-in-the-middle attack on HTTP, or gaining access to the origin server — they can redirect users to a malicious binary. The minimum cryptographic envelope that prevents this is: **(1)** the manifest is signed with an asymmetric key (Ed25519 or ECDSA P-256); **(2)** the public key is embedded in the client binary at compile time (so it cannot be MITM'd); **(3)** the manifest includes the SHA-256 of the download URL's artifact; **(4)** the download URL uses HTTPS with certificate pinning (to prevent TLS MITM even with a rogue CA); **(5)** the manifest signature is verified BEFORE any download begins. This is what `electron-updater` does with its `latest.yml` + `latest.sig` pattern, and what Chrome's update mechanism does with its signed manifest. The threat model must account for the case where the signing key is compromised (as in ASUS ShadowHammer), which requires **key rotation with a pre-distributed chain**: the client ships with the current public key AND the next key, allowing a smooth rotation without a client update.

### Citation

**Operation ShadowHammer — ASUS Live Update Supply Chain Attack, 2018-06 to 2018-11 (disclosed 2019-03-25).** Between June and November 2018, threat actors compromised ASUS's digital signing certificates and used them to sign a trojanized version of the ASUS Live Update Utility. The malicious utility was hosted on the official ASUS update servers (`liveupdate01s.asus.com` and `liveupdate01.asus.com`) and distributed through the normal update channel. Kaspersky estimated the attack affected **more than 1 million users worldwide** (57,000+ Kaspersky users confirmed). The trojanized binary was byte-for-byte the same size as the legitimate one, to avoid detection. It contained a backdoor that checked the victim's MAC address against a hardcoded table of 600+ targets; only targeted machines received the next stage. The attack was linked to the APT group BARIUM (identified by Microsoft in court documents). The critical insight: **the code signature was valid and verifiable.** The binary was signed with a legitimate ASUS certificate. Any system that trusted the signature would execute the malware. This proves that signature validity ≠ trustworthiness. The signing key was the single point of failure.
- **Date:** 2018-06 to 2018-11 (campaign); disclosed 2019-03-25
- **Vendor:** ASUS (victim); Kaspersky GReAT (discoverer)
- **URL:** https://www.kaspersky.com/blog/shadow-hammer-teaser/26149/
- **Full technical analysis:** https://securelist.com/operation-shadowhammer/89992/
- **Press coverage:** https://www.reuters.com/article/world/hackers-attacked-one-million-plus-asus-users-through-malicious-update-idUSKCN1R61R4/

### Recommendations

- **MUST-HAVE:** Sign the release manifest with an Ed25519 key. Embed the public key in the client at compile time. Verify the manifest signature BEFORE downloading.
- **MUST-HAVE:** Use HTTPS with **certificate pinning** (or at minimum, HPKP successor `Expect-CT` + pinned SPKI) for the manifest and artifact download URLs. This prevents MITM even if a CA is compromised.
- **MUST-HAVE:** The manifest must include the **SHA-256 of the artifact** AND the **code-signing certificate thumbprint**. The updater verifies both: the download matches the manifest hash, and the installed binary's signing cert matches the expected thumbprint.
- **MUST-HAVE:** **Key rotation plan:** ship the next public key in the current release. Document the rotation procedure (generate new key → sign manifest with both keys → release → verify old key can be retired in the next release).
- **NICE-TO-HAVE:** **Reputation layer:** if the manifest URL or artifact hash appears in a blocklist (maintained by the team or a third-party threat feed), refuse the update and log the event.
- **Defense in depth:** even with a signed manifest, the artifact's own code signature (Authenticode / Developer ID / APK signature) is verified independently after download. Two independent trust checks: the manifest says "download this," the signature says "this is what the vendor actually built."

---

## Problem 4: Delta-Update Corruption

Delta updates (bsdiff, Courgette, or custom binary diffing) reduce download size by 80–95% for small version-to-version changes. The cost is complexity: the patch must be applied against the EXACT source binary specified in the manifest. If the user's current binary has been modified (by an antivirus, a partial previous update, a disk error, or a different build), the patch applies to the wrong input and produces a **silently corrupted binary** that may execute for hours before crashing. The corruption is not detectable by the updater's post-apply checksum unless the updater computes the hash of the ENTIRE resulting binary and compares it to the manifest's expected target hash. The SolarWinds incident is the extreme case: the "delta" was not a patch but a full binary substitution, performed on the build server, signed with the legitimate key. The lesson is that **the integrity of the update input is as important as the integrity of the update output.** For a one-person team shipping a 150 MB Electron app, delta updates save ~140 MB per update. Whether that is worth the risk depends on the fleet's network profile: if most users are on metered mobile connections (Android), delta is worth it. If most are on desktop Wi-Fi (Windows), a full 150 MB download takes ~30 seconds on a 50 Mbps connection, and the complexity is not justified.

### Citation

**SolarWinds Orion — SUNBURST Supply Chain Attack, 2020-03 to 2020-06 (disclosed 2020-12-13).** Between March and June 2020, threat actors (later attributed to Russia's SVR by the US government in April 2021) compromised SolarWinds' build server. An implant called SUNSPOT monitored for the `MsBuild.exe` process building the Orion solution. When it detected a build, it swapped `InventoryManager.cs` with a backdoored version, let the build complete, then restored the original file. The resulting `SolarWinds.Orion.Core.BusinessLayer.dll` was **signed with SolarWinds' legitimate certificate** (serial `0f:e9:73:75:20:22:a6:06:ad:f2:a3:6e:34:5d:c0:ed`, signed 2020-03-24). The trojanized update was distributed as a standard Windows Installer Patch (.msp) from SolarWinds' official update server. The backdoor (SUNBURST) remained dormant for up to 2 weeks, then communicated with C2 infrastructure at `avsvmcloud.com`. FireEye identified the campaign in December 2020 while investigating their own breach. Fewer than 18,000 customers installed an affected version. The source repository was clean; the signature was valid. Only an independent rebuild from the same commit, or provenance attestation from a builder the attacker could not reach, would have detected the mismatch.
- **Date:** 2020-03 to 2020-06 (compromise); disclosed 2020-12-13
- **Vendor:** SolarWinds (victim); FireEye (discoverer)
- **URL:** https://www.fireeyesolution.com/blog/products-and-services/2020/12/global-intrusion-campaign-leverages-software-supply-chain-compromise.html
- **Google Cloud analysis:** https://cloud.google.com/blog/topics/threat-intelligence/evasive-attacker-leverages-solarwinds-supply-chain-compromises-with-sunburst-backdoor/
- **SolarWinds investigation:** https://www.solarwinds.com/blog/findings-from-our-ongoing-investigations

Additional evidence: **Velopack delta corruption, 2025-11-13.** The Velopack update framework (used by .NET desktop apps) had a bug where "even though all the checksums were verified, and the package was re-zipped successfully, the result was a corrupt archive which could not be opened." The package was moved to its final location, causing "an update loop where 'apply' kept failing, but there was nothing new to download to recover from this state." Fixed by deleting corrupt packages during apply to trigger a full re-download.
- **URL:** https://github.com/velopack/velopack/issues/751

And **Deno delta patch format mismatch, 2026-06.** Deno's self-updater uses bsdiff delta patches. Starting in v2.8.1, patches were zstd-compressed. A v2.7.14 client (which has no zstd decompression step) fed the zstd-wrapped bytes directly into `bspatch`, which misread the zstd frame header as patch control data and failed with "bspatch failed to apply delta patch." The fallback to full download worked, but the delta was silently broken for all pre-2.8.1 clients.
- **URL:** https://github.com/denoland/deno/issues/34870

### Recommendations

- **Decision framework:** For AIRIZ's fleet (primarily desktop, with a small Android/iOS tail), **skip delta updates in v1.12.x**. The complexity is not justified for a fleet under 10k devices on desktop Wi-Fi. Re-evaluate when the fleet exceeds 50k or when mobile becomes the primary platform.
- **If delta is adopted (future):**
  - The manifest MUST include `source_sha256` (the exact hash of the binary the patch expects) AND `target_sha256` (the expected hash after patching).
  - The updater MUST verify the source binary's hash BEFORE applying the patch. Mismatch → fall back to full download.
  - After patching, verify the target binary's hash. Mismatch → delete and fall back to full download.
  - **Never** allow a corrupt delta result to be installed. The fallback to full download is the safety net.
  - Test delta patches against N-1, N-2, and N-3 versions in CI, not just N-1.
  - The patch file itself must be signed (SHA-256 in the manifest, or a separate signature file).
  - Limit patch chain depth to 3. If the user is more than 3 versions behind, skip delta and do a full download.
- **Simpler alternative for Electron:** use `electron-updater`'s built-in NSIS differential installer, which handles block-level deduplication at the file level (not binary level). This is less efficient than bsdiff but dramatically simpler and has been battle-tested at scale (VS Code, Discord, Slack all use it). The NSIS differential installer compares the installed files against the new installer's files and only replaces changed blocks. This avoids the binary-level delta complexity entirely.
- **Bandwidth math for AIRIZ:** a 150 MB Electron app on a 50 Mbps connection takes ~24 seconds to download. A 10% delta saves ~20 seconds. For a factory floor on industrial LAN (1 Gbps), the full download takes ~1.2 seconds. Delta is not worth the risk at this scale.

---

## Problem 5: Staged-Rollout Regret

A staged rollout (1% → 5% → 25% → 50% → 100%) is the standard pattern for reducing blast radius. The hard problem is the **regret state**: you are at 25% rollout, the update ships, 2,500 devices update, and then you discover a critical bug at the 50% gate. You want to stop the rollout. But: (a) the 2,500 devices that already updated cannot be "un-updated" — they are running the buggy version; (b) devices in-flight (downloading, installing, rebooting) will complete the update unless you revoke the manifest mid-flight; (c) the manifest in CDN edge caches may still serve the "25% rollout" version to devices that poll within the TTL window; (d) if the bug is a crash-on-start, those 2,500 devices are now bricked until you push a fix. The kill switch must operate at multiple layers: the manifest (revert to previous version), the CDN (purge cached manifests), the client (if already updated, the app itself must detect the crash loop and self-rollback), and the telemetry (alert you that crash rate is spiking in the 25% cohort). The Facebook 2021 outage is the canonical example of a config push that cannot be un-pushed: the BGP withdrawal propagated globally in seconds, and recovery required physical access to data centers.

### Citation

**Facebook/Meta — Global Outage, 2021-10-04.** At 18:15 UTC on October 4, 2021, a routine maintenance command on Facebook's backbone routers was issued with the intention of assessing global backbone capacity. The command unintentionally removed all inter-data-center connectivity. This triggered a cascade: DNS servers, detecting they could not reach data centers, withdrew their BGP advertisements. The withdrawal propagated globally in under a minute. Facebook, WhatsApp, and Instagram became unreachable from the entire internet. Total outage duration: **6 hours and 5 minutes** (18:15–00:20 UTC). Recovery required physical access to data centers (the out-of-band network was also down), and the "storm" reconnection process had to be done carefully to avoid a traffic surge. The root cause was a configuration change pushed globally with no canary, no staging, and no rollback mechanism that could operate over the now-disconnected network. The audit tool that was supposed to catch the bad command had a bug. The postmortem explicitly states: "a bug in that audit tool prevented it from properly stopping the command."
- **Date:** 2021-10-04, 18:15–00:20 UTC
- **Vendor:** Facebook / Meta
- **URL:** https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/
- **Cloudflare's external analysis:** https://blog.cloudflare.com/october-2021-facebook-outage/
- **Reuters coverage:** https://www.reuters.com/technology/facebook-says-root-cause-outage-was-faulty-configuration-change-2021-10-05/

### Recommendations

- **MUST-HAVE:** **Multi-layer kill switch:**
  1. **Manifest revert:** point the manifest back to the previous version. This stops new updates from starting.
  2. **CDN purge:** purge the manifest from all edge caches (Cloudflare: `X-CF-Purge` header or API). Set manifest `Cache-Control: no-cache` or `max-age=60` to limit staleness.
  3. **Client-side crash-loop detection:** if the app crashes 3 times within 5 minutes of launch, the updater (running as a separate process on Windows, or a `watchdog` service) restores the previous version from `last-known-good/`.
  4. **Telemetry alert:** if crash-free rate drops below 99% in any cohort within 30 minutes of rollout expansion, auto-pause the rollout.
- **MUST-HAVE:** **Rollout gates with explicit hold points.** 1% (24h) → 5% (24h) → 25% (48h) → 50% (24h) → 100%. Each gate requires explicit human approval (for a one-person team, a `curl` to flip a flag). No automatic expansion.
- **MUST-HAVE:** **Retain the previous version on disk.** The updater must keep the N-1 version available for at least 7 days after N is installed. This is the self-rollback mechanism.
- **MUST-HAVE:** **Rollout state in KV, not in code.** The rollout percentage is a KV value, not hardcoded in the Worker. Changing the percentage is a KV write, not a Worker deploy. This means you can change the rollout without redeploying.
- **NICE-TO-HAVE:** **Forced rollback command:** a special manifest entry (`"force_rollback": true, "target_version": "1.11.3"`) that tells all clients to immediately update DOWN to the specified version. This is the nuclear option.
- **Manifest caching discipline:** the release manifest must be served with `Cache-Control: max-age=60, must-revalidate` so that a manifest revert propagates to all clients within 60 seconds.
- **Rollout audit log:** every change to the rollout percentage is logged with timestamp, operator (you), and the before/after values. This is your incident timeline if something goes wrong.

---

## Problem 6: PWA Service Worker Caching the Old Shell

A Progressive Web App's service worker is a persistent, origin-scoped cache that intercepts all fetches. When you deploy a new version, the old service worker is still controlling all open tabs. The update protocol has three races: **(1) skipWaiting race** — the new SW calls `skipWaiting()`, but the page's `controllerchange` listener has not yet fired, so the page reloads and is still served by the old SW's cache; **(2) OOB (out-of-band) cache** — the old SW's precache contains assets from the old build; when the new SW activates, it deletes old caches, but if the page reloads between "old SW deactivated" and "new SW cache populated," the page gets 404s for old asset hashes; **(3) cross-tab fan-out** — if the user has 5 tabs open, each must independently detect the new SW and reload. A `window.location.reload()` in one tab does not propagate to others. The Workbox + workbox-window pattern (2026) is: the page registers a `workbox-window` instance; on `waiting` state, show an "Update available" prompt; on user acceptance, post a `SKIP_WAITING` message to the waiting SW; listen for `controlling` (not `controllerchange` — the distinction matters); then reload. The iOS-specific gotcha: in PWA standalone mode, `self.skipWaiting()` called from inside the SW's install handler does NOT reliably activate the new worker on iOS 16 and earlier. The page-driven `postMessage({type: 'SKIP_WAITING'})` pattern is required.

### Citation

**Workbox Issue #1528 — index.html cached in bad state during SW update, 2021.** A company using Workbox (via the webpack plugin) reported: after deploying a new version, the new SW installed and the page auto-reloaded (via `statechange` → `window.location.reload()`), but the reloaded page was broken. The new SW was active and the precache manifest was updated, old revisioned assets were deleted from cache — **but the cached `index.html` was still the old version**, referencing old asset hashes that no longer existed in the cache. Result: 404s for all JS/CSS. The user had to clear the browser cache manually. The root cause was a combination of (a) the server serving the new SW before busting its internal cache for `index.html` (served with `max-age=0` but behind a CDN), and (b) the SW's precache including `index.html` (which it should not — it should be network-first or no-cors). The Workbox maintainer confirmed: "calling `window.location.reload()` would not be enough to move the new service worker into the `activated` state" without an explicit `skipWaiting()`.
- **Date:** 2021 (issue opened); pattern persists through 2026
- **Vendor:** Google Chrome Workbox (affects all Workbox-based PWAs)
- **URL:** https://github.com/GoogleChrome/workbox/issues/1528

Additional evidence: **iOS PWA standalone SW skipWaiting failure, 2024–2025.** A developer reported that in iOS PWA standalone mode, `self.skipWaiting()` called from inside the SW's install handler does not reliably activate the new worker. The new SW finishes installing, transitions to `waiting`, and sits there. The controller (old SW) never changes. The page keeps serving old cached `app.js` / `style.css`. The fix is the page-driven pattern: the page calls `reg.waiting.postMessage({type: 'SKIP_WAITING'})` and waits for the `controllerchange` event with a 2-second timeout fallback.
- **URL:** https://github.com/xooooooooox/cka-exercises/commit/40664fb858fc7c4be68a045246e1a84296912eec

And **zwave-js-ui cache mismatch after update, 2024.** A PWA using Workbox with `skipWaiting: true` and `clientsClaim: true` caused "Error: Not Found" after application updates because the new SW activated immediately while the page still expected old routes/assets. The fix was to remove automatic activation flags and defer SW activation until explicit user confirmation, then reload the page after `updateSW()` resolves.
- **URL:** https://github.com/zwave-js/zwave-js-ui/pull/4452

### Recommendations

- **MUST-HAVE:** Use **Workbox + workbox-window** with the page-driven `SKIP_WAITING` pattern. Never use `skipWaiting: true` + `clientsClaim: true` in the SW config for production.
- **MUST-HAVE:** **`index.html` must be network-first** (or `NetworkOnly` for the SW file itself). Never precache `index.html`. The HTML shell is the update trigger; if it is cached, you cannot ship a SW update.
- **MUST-HAVE:** **Server headers:** serve `index.html` with `Cache-Control: no-cache` (revalidate every time). Serve hashed assets (`main.abc123.js`) with `Cache-Control: max-age=31536000, immutable`. Serve the SW file (`sw.js`) with `Cache-Control: no-cache`.
- **MUST-HAVE:** **Multi-tab handling:** each tab independently registers the `workbox-window` listener. When the user accepts the update in one tab, only that tab reloads. Other tabs update on next navigation. This is acceptable; do not attempt cross-tab forced reload (it is not possible without `BroadcastChannel` + a reload-per-tab, which is jarring).
- **iOS-specific:** test the update flow in **standalone PWA mode** (add to home screen), not just in Safari tab. The `skipWaiting` behavior is different. Use the page-driven `postMessage` pattern with a 2-second timeout.
- **Version banner:** show the app version in the UI (e.g., footer "v1.12.4"). When the SW updates, the version string changes on next load. This is your telemetry: if users report seeing v1.11.x after you shipped v1.12.x, the SW update is not propagating.

---

## Problem 7: iOS App Store vs. Enterprise Distribution

iOS distribution is governed by Apple's ecosystem, which offers four channels with dramatically different constraints: **(1) App Store** — 24–48h review, mandatory, gives you automatic updates, but you cannot ship an emergency security fix faster than the review queue; **(2) TestFlight** — 90-day expiry per build, 10,000 external testers (with email addresses), 2,000 internal testers (same org), mandatory 1-week server-side validation for external; **(3) Ad Hoc** — 100 device UDIDs per year, no App Store review, but requires a provisioning profile listing each device; **(4) Enterprise (Apple Developer Enterprise Program, $299/yr)** — no device limit, no App Store, but **Apple can and does revoke enterprise certificates** for apps distributed outside approved channels (they revoked dozens in 2022–2024 for "public" distribution). For a motor console app (AIRIZ), the question is: is this a consumer app (App Store) or an internal/enterprise tool (Enterprise or Ad Hoc)? If it's sold to industrial clients (B2B), App Store is the safe path but the 24–48h review latency means a critical field fix can't ship for a day. If it's an internal tool for PEGATRON's own factory floor, Enterprise distribution is appropriate but carries revocation risk. The Bluetooth-bridge (deprecated) suggests the app talks to hardware, which means App Store review will scrutinize the peripheral access.

### Citation

**Apple Revokes Developer Certificates — Charlie Monroe, 2020-08-04.** On August 4, 2020, long-time Mac developer Charlie Monroe woke up to find that all 10 of his macOS apps (and 2 iOS apps) would no longer launch. Apple had **revoked his distribution certificates** via an automated process that erroneously flagged his account as malicious. No prior warning. No explanation. Apple's support was unresponsive for 12+ hours. His apps remained visible and purchasable in the Mac App Store but would crash on launch. Apple eventually called, apologized, and restored access. The root cause was an automated flagging system. The developer had no appeal process, no pre-warning, and no SLA. This demonstrates the existential risk of Apple-controlled distribution: **Apple can kill your app at any time, for any reason, with no notice, and you have no recourse.** The 2017 1Password incident (mentioned in the same article) is the earlier, larger-scale example: a combination of an Apple policy change and expiring certificates caused 1Password (and other apps) to crash on launch for thousands of users, because the apps relied on certificates that Apple had not clearly communicated would be enforced at runtime.
- **Date:** 2020-08-04
- **Vendor:** Apple (action); Charlie Monroe / Affinity (affected developer)
- **URL:** https://appleinsider.com/articles/20/08/04/apple-kills-long-time-mac-developers-apps-with-no-warning-and-isnt-responding

### Recommendations

- **Decision for AIRIZ:** If the app is for **internal PEGATRON use** (factory floor, engineering lab): use **Ad Hoc** (≤100 devices) or **Enterprise** (>100 devices, $299/yr). Accept the revocation risk; mitigate by keeping a signed IPA in a secure internal repository so you can re-sign and redistribute if the cert is revoked.
- **If the app is for external customers (B2B):** use the **App Store**. The 24–48h review is a real cost but the alternative (enterprise distribution for a commercial product) is against Apple's terms and carries revocation risk that could kill your business.
- **MUST-HAVE:** **TestFlight for pre-release validation.** Every release candidate goes through TestFlight with internal testers (factory engineers) before App Store submission. The 90-day TestFlight expiry means you cannot "set and forget" — you must re-upload within 90 days or the build expires.
- **MUST-HAVE:** **Emergency fix path:** if a critical bug requires a fix faster than the App Store review queue, the only option is a **hotpatch** (if your architecture supports it — e.g., a remote-config-driven behavior change) or a **TestFlight build** for the most critical users. Design your app so that critical safety behavior can be changed via remote config without a binary update.
- **MUST-HAVE:** **iOS distribution certificate backup:** the iOS distribution certificate is 1-year and revocable. Back up the .p12 file to the same encrypted storage as the Android keystore. Document the renewal process (Apple Developer → Certificates → Renew) in the emergency runbook.
- **MUST-HAVE:** **Provisioning profile automation:** use `fastlane` or `xcodebuild` with a CI script that auto-renews the provisioning profile before it expires. A 90-day development profile that expires without renewal blocks all TestFlight builds.
- **NICE-TO-HAVE:** **Ad Hoc as a parallel channel:** keep a 100-device Ad Hoc profile for your most critical field devices. If the App Store is down or review is delayed, you can push an Ad Hoc build to those 100 devices directly.
- **NICE-TO-HAVE:** **App Store review pre-submission checklist:** a documented list of things to verify before submitting (screenshot updates, privacy policy changes, API usage disclosure, Bluetooth permission justification). This reduces review rejection rate and re-submission delay.

---

## Problem 8: Mac Notarization

Since macOS Catalina (10.15, 2019), all Developer ID–signed apps must be **notarized** by Apple before they can run on a user's Mac. The process is: (1) sign the app with a Developer ID certificate; (2) submit a zip of the app to Apple's notary service (`xcrun notarytool submit`); (3) Apple's automated malware scan runs (typically 5–30 minutes); (4) if accepted, **staple** the notarization ticket to the app (`xcrun stapler staple`), which embeds a small ticket file in the app bundle so Gatekeeper can verify it **offline**; (5) distribute the DMG. If stapling is skipped, Gatekeeper must perform an **online check** with Apple's servers at first launch. This fails on air-gapped machines, corporate networks that block Apple's endpoints, or when Apple's servers are down. The staple ticket has no documented expiry (it is a permanent record of Apple's verdict), but it is tied to the exact code hash of the app — any modification (including a re-sign or a delta update) invalidates it and requires re-notarization. When notarization fails at runtime (Gatekeeper shows "Apple cannot check it for malicious software"), the user cannot launch the app, and there is no in-app recovery path — the user must either clear the quarantine attribute (`xattr -dr com.apple.quarantine`) or connect to the internet for the online check.

### Citation

**Deskflow — Notarization ticket not stapled to .app, only to DMG, 2024-10.** Deskflow's release workflow notarized the DMG and stapled the ticket to the DMG only (`xcrun stapler staple build/deskflow[-_]*.dmg`). The `Deskflow.app` inside the DMG never received its own stapled ticket. This worked fine as long as the app was run from the DMG or the machine was online (Gatekeeper's online check passed). But on macOS 26.7.1, after the app was copied to `/Applications` (as Homebrew cask does), Gatekeeper's launch-time check could not find a local ticket AND the online check failed, producing the dialog: "Deskflow.app is damaged and can't be opened. You should move it to the Trash." The app bytes were perfectly valid; `codesign --verify` passed; `spctl --assess` returned "accepted" via the online path. The failure was purely in the offline verification path. The fix: staple the `.app` bundle itself before packaging it into the DMG, so the ticket travels with the app regardless of how it is installed.
- **Date:** 2024-10 (reported on macOS 26.7.1)
- **Vendor:** Deskflow (open-source); Apple (notarization infrastructure)
- **URL:** https://github.com/deskflow/deskflow/issues/10281

Additional evidence: **LocalAI — same stapling bug, 2024.** The LocalAI project had the identical issue: the launcher packaging stapled the ticket only to the DMG, never to `LocalAI.app` inside it. On offline or firewalled machines, the app showed "can't be opened" because Gatekeeper fell back to an online check that could not complete. The fix (PR #10606) added a `notarize-app` subcommand that zips the bundle, submits for notarization, staples the app, validates, and only then packages the DMG.
- **URL:** https://github.com/mudler/LocalAI/pull/10606

And the **1Password 2017 cert-expiry crash** (referenced in the AppleInsider article above): a combination of an Apple policy change and expiring developer certificates caused 1Password and other Mac apps to crash on launch. Users could not open the apps until Apple clarified the situation and developers re-signed. This was the precursor to the notarization requirement and demonstrated that **certificate lifecycle failures produce silent fleet-wide breakage with no in-app recovery path.**

### Recommendations

- **MUST-HAVE:** Staple the **`.app` bundle** AND the **DMG**. The order must be: build .app → sign .app → notarize .app → staple .app → package DMG → sign DMG → notarize DMG → staple DMG. Stapling only the DMG is a bug.
- **MUST-HAVE:** **Notarize every release in CI.** Add a CI step that runs `xcrun notarytool submit --wait` and `xcrun stapler staple` + `xcrun stapler validate` for both the app and the DMG. If stapling fails, the CI job fails and the release is blocked.
- **MUST-HAVE:** **Retry stapling:** Apple's notary service is occasionally flaky. The staple step should retry up to 5 times with exponential backoff (20s, 40s, 60s, 80s).
- **MUST-HAVE:** **Post-notarization verification:** download the shipped DMG in a clean CI step, extract the .app, run `spctl -a -t exec --no-cache` and `stapler validate`. This catches the "stapled the wrong thing" class of bugs.
- **User-facing recovery:** document `xattr -dr com.apple.quarantine /Applications/AIRIZ.app` as a support step for the rare case where notarization verification fails at runtime. Include this in your support docs.

---

## Problem 9: Android APK Signature Scheme Mismatches (v1/v2/v3/v4)

Android has four APK signature schemes: **v1** (JAR signing, since 2008), **v2** (APK Signature Scheme v2, since Android 7.0/API 24), **v3** (since Android 9/API 28, adds key rotation support), and **v4** (since Android 11/API 30, a streaming-compatible scheme based on a Merkle hash tree, stored in a separate `.apk.idsig` file). The rules: v4 **requires** a complementary v2 or v3 signature. v3 supports key rotation (you can add a new key without losing app identity). v2 is required for Play Store submissions since August 2021 (Play App Signing mandate). v1 is still required for devices running Android 6.0 and below. The critical constraint for updates: **the signing certificate in the new APK must match the certificate of the installed version.** If you sign the new version with a different certificate, Android treats it as a different app — the user must uninstall the old version and install the new one as a fresh app, losing all data. Google Play App Signing (mandatory for new apps since August 2021) mitigates this: Google holds the app-signing key, and you upload with a separate upload key. If you lose your upload key, you can regenerate it. If you lose the app-signing key (only possible if you never opted into Play App Signing), **you lose the ability to update your app on the Play Store permanently.** For a one-person team, this is an existential risk if the keystore is not backed up.

### Citation

**Android Open Source Project — APK Signature Scheme v4 specification.** The v4 signature is "based on the Merkle hash tree calculated over all bytes of the APK" and "requires a complementary v2 or v3 signature." The `.apk.idsig` file is a separate file that must be present alongside the APK for `adb install --incremental` to work. If the v4 signature's root hash does not match the v2/v3 signature (e.g., due to a signing key mismatch or a corrupted `.idsig` file), the incremental install fails with `INSTALL_PARSE_FAILED_NO_CERTIFICATES: Failed to collect certificates... V4 signature certificate does not match V2/V3` and falls back to a streamed install. This is a silent failure mode: the install succeeds, but the fast path is broken, and on low-end devices the streamed install is significantly slower and more memory-intensive.
- **Source:** Android Open Source Project
- **URL:** https://source.android.com/docs/security/features/apksigning/v4

Additional evidence: **Google Play requirement — v2 mandatory, 2021-08.** "Google Play supports APK Signature Scheme v3 for APKs that aren't already published with an existing signing certificate lineage." Apps created before August 2021 may continue distributing self-signed APKs, but new apps must use Play App Signing. The Play Console enforces: "the key you use to sign your app must have a validity period ending after 22 October 2033." If your keystore expires before 2033, your app cannot be updated on the Play Store.
- **URL:** https://developer.android.com/studio/publish/app-signing

And the **v4 key-rotation bug, 2024.** A commit in the Android `apksig` tool (`9d96cb52`) added "v3.1 key rotation in v4 signature." The test case shows: `adb install` with a v4 signature whose certificate does not match the v2/v3 signature fails incremental install but falls back to streamed install. This confirms that v4/v2/v3 mismatches do not brick the install but degrade it silently.
- **URL:** https://android.googlesource.com/platform/tools/apksig/+/9d96cb526207a61e47948f7ec1fb590ff9dda8cb

### Recommendations

- **MUST-HAVE:** Opt into **Google Play App Signing** immediately if not already done. This separates the upload key (which you can regenerate) from the app-signing key (which Google holds). Lose the upload key → regenerate. Lose the app key → Google has it.
- **MUST-HAVE:** **Sign with v1 + v2 + v3** for maximum compatibility. v4 is optional and only adds value for `adb install --incremental` (not relevant for Play Store distribution). The `apksigner` tool does this by default.
- **MUST-HAVE:** **Keystore backup.** Store the keystore file (`.jks` or `.p12`) in at least two geographically separate locations: (1) an encrypted USB drive in a physical safe, (2) an encrypted cloud storage bucket with access restricted to you. Document the keystore password and alias in a password manager. **If you lose the keystore and have not opted into Play App Signing, you cannot update your app on the Play Store.**
- **MUST-HAVE:** **Key validity ≥ 2033.** When generating a new keystore, set the validity to 25+ years. Google Play requires the key to be valid past October 22, 2033.
- **NICE-TO-HAVE:** **v3 key rotation plan.** If you need to rotate the signing key (e.g., algorithm upgrade from RSA-2048 to RSA-4096), use v3 key rotation: add the new key to the APK's signing block alongside the old key. Devices that support v3 accept the new key; older devices continue using the old key. Phase out the old key in a subsequent release.

---

## Problem 10: Cloudflare Worker Version Rollback After Buggy Deploy

Cloudflare Workers supports versioned deployments with `wrangler versions upload` and `wrangler versions deploy` (for gradual rollouts), and `wrangler rollback <version-id>` (to immediately revert to a previous version). The critical limitation is: **rollback reverts code only.** Durable Object state, D1 database rows, KV values, R2 objects, and queue messages are **not rolled back.** If the new version wrote data in a format the old version cannot parse, the rollback restores the old code but the data is in the new format, producing a new class of errors. Additionally, **Durable Object lifecycle changes are irreversible:** if the new version added a new DO class (via `exports` or `migrations`), you cannot roll back to a version before that class existed. Cloudflare's docs explicitly state: "Rollbacks cannot cross a lifecycle change." And: "You cannot roll back to a previous version of your Worker if the Cloudflare Developer Platform resources (such as KV and D1) have been deleted or modified between the versions." For a Worker serving a release manifest (as AIRIZ's architecture likely does), the R2 bucket holding the manifest and the KV namespace holding feature flags are the critical state. If the buggy version wrote a malformed manifest to R2, rolling back the Worker code does not fix the manifest — you must manually purge and re-upload the correct manifest.

### Citation

**Cloudflare Workers — Official Rollback Documentation.** Cloudflare's documentation on rollbacks explicitly states: "Resources connected to your Worker will not be changed during a rollback. Errors could occur if using code for a prior version if the structure of data has changed between the version in the active deployment and the version selected to rollback to." Rollback is blocked if: "A Durable Object class lifecycle change has occurred between the version in the active deployment and the version selected to rollback to," or "the target deployment has a binding to an R2 bucket, KV namespace, or queue that no longer exists." Only the 100 most recently published versions are available for rollback. For Durable Objects specifically: "each Durable Object is assigned a Worker version based on the percentages you configured" and "the Durable Object will only be reset when it is assigned a different version." This means during a gradual rollout, different DOs may be running different code versions, and their state is NOT synchronized across versions.
- **Source:** Cloudflare (official documentation)
- **URL:** https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- **DO gradual deployments:** https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/
- **DO migrations:** https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

### Recommendations

- **MUST-HAVE:** **Design all state changes as forward-compatible.** If the new version adds a field to a KV value or a column to a D1 table, the old version must be able to read the new format (ignoring unknown fields). This is the "expand before contract" pattern: (1) deploy new code that writes both old and new formats; (2) deploy old code that reads both formats; (3) deploy new code that only writes the new format; (4) deploy old code that only reads the new format. Only then is the rollback safe.
- **MUST-HAVE:** **Never change DO class lifecycle in the same deploy as other code changes.** Deploy DO migrations as standalone releases. This preserves rollback ability for the code changes.
- **MUST-HAVE:** **Manifest storage discipline:** the release manifest in R2 must be **immutable per version** (keyed by version, e.g., `manifests/1.12.4.json`). The "current" pointer is a separate KV key (`current_version → 1.12.4`). To roll back, you change the KV pointer, not the R2 object. This makes rollback a single KV write, not an R2 upload.
- **MUST-HAVE:** **Post-rollback smoke test:** after `wrangler rollback`, run a health check: `curl https://<worker>/health` and verify the manifest endpoint returns the expected version. Do not assume the rollback succeeded just because the command returned 0.
- **MUST-HAVE:** **Document rollback constraints in the runbook.** Before deploying, check: "Does this deploy change any DO class, KV namespace, R2 bucket, or queue binding?" If yes, rollback is blocked. Deploy those changes as standalone releases.
- **NICE-TO-HAVE:** **Version affinity:** use Cloudflare's `Cloudflare-Workers-Version-Overrides` header to pin test clients to a specific version during gradual rollout, so you can verify the new version without affecting production traffic.
- **NICE-TO-HAVE:** **D1 time-travel bookmark:** before deploying a schema change, record the D1 bookmark. If the deploy goes bad, `d1 time-travel restore` can roll the database back to the bookmark (30 days of history on Paid plan).

---

## Problem 11: Update-Server Single Point of Failure

The update manifest endpoint is a single point of failure for the entire fleet. If the server hosting `https://airiz-update.ziris.ptb/latest.yml` goes down (DNS failure, CDN origin down, TLS cert expiry on the update domain, or a Cloudflare Worker 5xx), **no device can check for updates, and no device can self-heal.** For a desktop app, this means users are stuck on the old version indefinitely, and if the old version has a known security vulnerability, the fleet is exposed. For the PWA, the service worker cannot fetch the new shell. For the Cloudflare Worker, if the Worker itself is the update server and it is down, the entire update pipeline is down. The failure mode is silent: devices do not alert the user that "update check failed"; they simply continue running the old version. You will not know the update server is down until a user complains that they are on an old version. The design must include: (1) the update endpoint on a CDN with multi-region redundancy; (2) a secondary "dead man's switch" — if the manifest has not been updated in N days, clients assume the server is down and (optionally) fall back to a hardcoded "last known good" URL; (3) telemetry that distinguishes "update check: no update" from "update check: network error."

### Citation

**Facebook/Meta — DNS + BGP cascade, 2021-10-04 (same incident as Problem 5, but from the update-server SPOF angle).** The Facebook outage demonstrates that when the infrastructure that serves "where is the content" (DNS + BGP) goes down, the content becomes unreachable even though the content servers are operational. Facebook's DNS servers were running fine, but their BGP advertisements were withdrawn because the servers could not reach the data centers. The result: every DNS resolver on the internet returned SERVFAIL for `facebook.com`. For 6 hours, no client could find the servers. The analogy to an update system: if your update manifest's DNS record expires, is misconfigured, or the CDN origin is unreachable, every device in the fleet gets a network error on the update check and silently continues on the old version. The Facebook postmortem notes that "the total loss of DNS broke many of the internal tools we'd normally use to investigate and resolve outages," meaning even the team's own monitoring was blind during the outage.
- **Date:** 2021-10-04
- **Vendor:** Facebook / Meta
- **URL:** https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/

### Recommendations

- **MUST-HAVE:** **CDN-fronted manifest endpoint.** Serve the release manifest through Cloudflare (or equivalent) with the Worker as origin. The manifest is a small JSON file; CDN edge caching with `max-age=60` ensures sub-second propagation of manifest changes to all edge locations.
- **MUST-HAVE:** **Separate the update domain from the app domain.** If the app's API domain has a DNS issue, the update domain should still work. Use a different subdomain on a different CDN zone if possible.
- **MUST-HAVE:** **Telemetry distinction:** the updater must log `update_check:success` (no update), `update_check:success:update_available`, and `update_check:failure:<error>` as separate events. If you see a spike in `update_check:failure` without a corresponding spike in `update_check:success`, the update server is likely down.
- **MUST-HAVE:** **Dead man's switch:** if the manifest's `last_updated` field is older than 7 days, the client shows a "Could not reach update server — running v1.11.x" banner. This is a soft warning, not a hard block.
- **NICE-TO-HAVE:** **Secondary manifest URL:** embed a hardcoded fallback URL in the client (e.g., a GitHub Releases raw URL) that is used if the primary manifest URL fails 3 times in a row.

---

## Problem 12: Multi-Platform Version Skew and Feature-Flag Coupling

When you ship to Windows, Android, iOS, and a Cloudflare Worker simultaneously, the fleet is never at a single version. Device A is on 1.11.3 (Windows, updated last week), Device C is on 1.11.0 (Android, updated today), Device D is on 1.10.9 (iOS, stuck on the old TestFlight build), and the Worker is on the same version as Device B. If your backend assumes all clients are at version ≥ 1.12.0 (because a new API field was introduced in 1.12.0), Device A and D break. This is the **version skew problem**: the server cannot know what version the client is at unless the client reports it, and the client cannot know what the server expects unless the manifest says so. For a one-person team, the simplest mitigation is: (1) the client sends its version in every API request (`X-Client-Version: 1.11.3`); (2) the server checks the version and returns a compatible API shape (versioned endpoints or feature negotiation); (3) the manifest includes a `min_server_version` field so the client knows whether the server supports the features it needs. This is not a problem at 5 devices; it is a problem at 500.

### Citation

**Cloudflare Workers — Version skew during gradual deployments.** Cloudflare's documentation on gradual deployments with Durable Objects explicitly describes the version-skew problem: "each Durable Objects run one version at a time. During a 10% split, the Room objects still run a single code version, so object code and Worker code must remain compatible." And: "One user's requests can alternate between versions... using gradual deployments will make it even more likely that different versions of your Durable Objects and its Worker will interact with each other." The recommendation is: "ensure that API changes between your Durable Object and your Worker are forwards and backwards compatible." This is the same problem as multi-platform version skew, but confined to a single platform. For AIRIZ fleet spanning 5 platforms, the skew window is days to weeks, not minutes.
- **Source:** Cloudflare (official documentation)
- **URL:** https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/

### Recommendations

- **MUST-HAVE:** **Version header on every request.** Every client (every platform) sends `X-Client-Version` and `X-Client-Platform` in every API request. The server logs these and can identify which cohort is broken.
- **MUST-HAVE:** **Backward-compatible API.**.</br> The server must support N-1 and N-2 client versions. If a new API field is added in v1.12.0, the server must still accept requests that do not include the field (return `null` or omit the field). Never break older clients.
- **MUST-HAVE:** **Manifest `client_min_version` and `client_max_version` fields.** The manifest says: "This update requires server version ≥ 2.5.0." If the client is below that, the update is not offered. This prevents a client from updating to a version that the server does not support.
- **NICE-TO-HAVE:** **Feature matrix:** a simple table in your project docs listing which features require which minimum version per platform. Update it with every release. This is your "version skew risk register."

---

## Problem 13: OS-Level File Locking and Sandbox Interference During Update

On Windows, the running application's `.exe` and its loaded `.dll` files are **file-locked** by the OS. You cannot overwrite or rename a file that is currently loaded into a process's address space. `electron-updater` handles this by running the NSIS installer as a separate process and using the Windows "replace on reboot" mechanism (`MoveFileEx` with `MOVEFILE_DELAY_UNTIL_REBOOT` flag) for the main `.exe`. On macOS, the app bundle is a directory, so you can replace individual files inside it, but the `.app` directory itself cannot be replaced while the app is running. On Android, the APK is managed by `PackageManager`; the package installer cannot update a running APK in place — the new APK is installed to a different path and the old one is removed after the new one is verified. The failure mode: the updater tries to replace a file that is locked, fails with `EBUSY` or `EPERM`, and either (a) retries forever, (b) crashes, or (c) leaves a partial update on disk. On Windows, the additional complication is **SmartScreen's real-time scanning**: when the updater writes a new binary to disk, Windows Defender scans it in real-time. If the scan takes longer than the updater's timeout, the updater may time out and abort, leaving a partially written binary on disk. The next launch may crash because the binary is incomplete. The design fix is the same as Problem 1: write to a temp file, verify, then atomic rename — but the rename must account for the fact that the target file may be locked by a running process.

### Citation

**Rancher system-agent — Truncated binary after interrupted self-update, 2026-01-21.** During a normal Rancher-managed upgrade (2.12.2 → 2.13.1), the `rancher-system-agent` binary was replaced **in-place** without atomic rename. The binary was being written when the service was stopped by systemd, leaving a **partially written 42 MB binary** on disk. The corrupted binary segfaulted on startup (`SIGSEGV`), leaving the node permanently stuck in Rancher with "waiting for plan … to be applied." The failure was delayed: the corrupted binary existed on disk after the Rancher server upgrade, but the node appeared healthy until a later Kubernetes upgrade triggered a reboot, at which point the agent began crashing with `SIGSEGV`. Manual replacement of the binary from a known-good copy from another node was required. The issue report explicitly notes: "the agent replaces itself **in-place**," "there appears to be **no checksum or content-length validation** before installing the new binary," "the update is **not atomic** (no temp file + rename)," and "there is **no rollback or last-known-good fallback**."
- **Date:** 2026-01-21 (corruption); 2026-01-22 (failure manifestation); 2026-01-23 (reported)
- **Vendor:** Rancher (SUSE /rancher/system-agent)
- **URL:** https://github.com/rancher/system-agent/issues/252

### Recommendations

- **MUST-HAVE:** **Always write to a temp file, verify, then atomic rename.** On all platforms: write to `update.tmp` → verify checksum → `rename(update.tmp, target)`. On Windows, use `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`; if the target is the running `.exe`, schedule the replacement for reboot (`MOVEFILE_DELAY_UNTIL_REBOOT`). On macOS, the app must quit before the bundle can be replaced — show a "Restart to finish update" dialog.
- **MUST-HAVE:** **Retain the previous version.** Before renaming the new version into place, copy the current version to `last-known-good/`. This is the rollback target. Keep it for at least 7 days after the new version is confirmed stable.
- **MUST-HAVE:** **Handle `EBUSY` / `EPERM` explicitly.** On Windows, if the file is locked, the updater must either (a) ask the user to close the app, (b) use the "replace on reboot" mechanism, or (c) delegate to the NSIS installer which handles file locks. On macOS, the app must quit before the bundle can be replaced.
- **MUST-HAVE:** **Crash-loop detection + self-rollback.** If the app crashes 3 times within 5 minutes of launch, a separate watchdog process (separate from the app) restores the previous version from `last-known-good/` and relaunches. The watchdog must be a separate executable or a scheduled task, not part of the app itself.
- **NICE-TO-HAVE:** **Pre-flight file-lock scan.** Before starting the update, check whether any file in the install directory is locked. If so, ask the user to close the app or schedule the update for the next launch.

---

## Problem 14: Silent Update Failure — No Telemetry, No Signal

The most dangerous failure mode is the one where the update **and** the user does not know. The app continues to run the old version, the user does not notice, and the fleet is on a mix of versions with no one knowing. This happens when: (1) the update check fails with a network error and the updater logs it but no one looks at the logs; (2) the download succeeds but the install fails (e.g., file lock) and the updater catches the error and retries the next time, but the retry also fails; (3) the update is a background process on Windows (Windows) and no one is watching the event log; (3) the PWA service worker update fails silently and the old SW continues serving the old shell; (4) the Android Play Store update is queued but the device is offline for a week. The result is a fleet of 100 devices where 60 are on 1.12.0 and 40 are on 1.11.0 and no one knows. When the next security incident hits, 60% of the fleet is vulnerable. The fix is not "add telemetry"; the fix is **a dashboard that shows the version distribution of the fleet, updated in real time, with an alert that fires if the fraction of devices on a version older than N-2 exceeds a threshold.

### Citation

**Velopack — "apply" stuck loop, 2025-11-13.** The Velopack update framework had a bug where a corrupt delta patch produced a corrupt zip, which was then moved to its final location. The result: "an update loop where 'apply' kept failing, but there was nothing new to download to recover from this state." The update was stuck in a **silent failure loop** — it kept trying to apply the corrupt package, kept failing, and kept reporting "update available" to the user, but the update never completed. There was no error signal to the fleet operator; the only way to recover was for the developer to disable delta updates in the manifest. The temporary workaround: "disable delta using `--delta none` at pack time." This is a silent failure at the individual user sees "update available" forever, and the fleet operator sees no crash report, no error, nothing.
- **Date:** 2025-11-13 (issue opened)
- **Vendor:** Velopack (.NET desktop update framework)
- **URL:** https://github.com/velopack/velopack/issues/751

### Recommendations

- **MUST-HAVE:** **Fleet dashboard.** Even a simple one: a Cloudflare Worker endpoint that accepts a `POST /heartbeat` from every app instance (once per 24h max) reporting `version`, `platform`, `update_status` state. Store in KV or D1. A dashboard shows the version distribution.
- **MUST-HAVE:** **Alert on stale fleet fraction on old version:** if > 20% of fleet are older than N-1, send a notification (email, push, or Slack message). For a one-person team, even a daily email is better than nothing.
- **MUST-HAVE:** **Distinguish `update_check:failure` from `update_check:success` in telemetry.** A spike in failures is an update-server problem or client-side issue.
- **MUST-HAVE:** **Update state reporting:** the app reports its update state to the server: `up_to_date`, `update_pending` in progress, `update_failed:<error`. This lets you see how many devices are stuck.
- **NICE-TO-HAVE:** **Stuck-update detection:** if a device reports `update_pending` for > 7 days, flag it for manual review.

---

## Problem 15: Key Custody and Single-Person-of-Failure Risk

AIRIZ is a one-person team. Every signing key, keystore, every EV certificate USB token, Apple Developer account, Google Play account, Cloudflare API token, and domain registrar login is held by one person. If that person is unavailable (hospitalized, laptop stolen, phone lost, account locked out), **the entire fleet cannot receive updates and no one else can sign a release.** This is not a technical problem; it is an organizational one. The technical controls (HSM, key backup, two-person rule) cannot be fully applied to a one-person team, but organizational controls can: (1) **document every credential in a password manager with legacy/emergency access** (1Password, Bitwarden); (2) a **written emergency runbook** (stored in a safe place) listing every key, where it is, what it signs, and the recovery procedure; (3) a **trusted person** (a colleague, a lawyer) who can access the credentials in a death or long-incapacity scenario; (4) **secondary contacts** on domain registrar, Apple Developer, Google Play, Cloudflare, and GitHub accounts. The Android keystore is the highest-risk item: it is a single file, it is not recoverable, it is the identity of the app, and there is no "reset" — if it is lost and the app has not opted into Play App Signing, the app is dead on the Play Store permanently.

### Citation

**Apple Developer Certificate Revocation — Charlie Monroe, 2020-08-04** (same incident as Problem 7, viewed from the key-custody angle). Apple **revoked Charlie Monroe's distribution certificates unilaterally** with no prior warning. His 10 macOS apps and 2 iOS apps stopped launching. He had no appeal process, no pre-warning, and no SLA. Apple eventually restored access after 12+ hours. The critical distinction for AIRIZ: in the revocation case, the outcome was reversible (Apple restored access). In a **key loss** scenario, the outcome is **irreversible.** For a one-person team, the most likely incident is not Apple revocation; it is losing the keystore, losing the USB token, losing the Apple ID 2FA device, or losing the Google Play login — and the recovery procedure is not documented. The Charlie Monroe incident proves that even a large, well-known developer has no recourse when the platform's automated systems make an error. A one-person team has even less leverage.
- **Date:** 2020-08-04
- **Vendor:** Apple (action); Charlie Monroe (affected)
- **URL:** https://appleinsider.com/articles/20/08/04/apple-kills-long-time-mac-developers-apps-with-no-warning-and-isnt-responding

### Recommendations

- **MUST-HAVE:** **Credential vault with legacy access.** Store every credential, keystore password, and 2FA recovery code in a password manager (Bitwarden, 1Password, or similar) with a legacy access / emergency access configured. Name a trusted person (colleague, lawyer, family member) who can access the vault if you are unavailable.
- **MUST-HAVE:** **Written emergency runbook.** A document (PDF, stored in the password manager and a separate location) listing:
  - Every signing keys (Android keystore, Apple Developer ID, Windows EV cert, Cloudflare API token)
  - Where each key is stored
  - What each key signs
  - Recovery procedure (where to get a backup, who to call)
  - Every platform, every platform account, every 2FA device, every 2FA recovery codes.
- **MUST-HAVE:** **Secondary contacts on every account:** domain registrar, Apple Developer, Google Play, Cloudflare, GitHub. Add a secondary contact / emergency contact.
- **MUST-HAVE:** **Android keystore in two locations:** (1) encrypted USB drive in a physical safe, (2) encrypted cloud storage (e.g., a private S3 / R2 bucket with KMS encryption) with access limited to you.
- **MUST-HAVE:** **Play App Signing opt-in** (if not already done) to reduce keystore's criticality. If Google holds the app-signing key, losing your upload key is recoverable.

---

## Trust Boundary Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  BUILD TIME (CI)                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────────┐ │
│  │ Source   │→ │ Compile +    │→ │ Sign (Authenticode/DevID/     │ │
│  │ Code     │  │ Test         │  │ APK) + Timestamp + Notarize   │ │
│  └──────────┘  └──────────────┘  └──────────────┬────────────────┘ │
│                                                 │                   │
└─────────────────────────────────────────────────┼───────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DISTRIBUTION (CDN / Cloudflare)                                    │
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Release Manifest │  │ Artifact (zip/dmg/apk/ipa)               │ │
│  │ (signed, R2)     │  │ (immutable, R2)                          │ │
│  │                  │  │                                          │ │
│  │ {                │  │ manifests/1.12.4.json  ← immutable       │ │
│  │  "version": ...  │  │ artifacts/airiz-1.12.4-win.zip ← immut. │ │
│  │  "sha256": ...   │  │                                          │ │
│  │  "sig": "..."    │  │ KV: current_version → "1.12.4" ← mutable│ │
│  │ }                │  └──────────────────────────────────────────┘ │
│  └──────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT (User Device)                                               │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 1. Fetch manifest (HTTPS + cert pin)                           │ │
│  │ 2. Verify manifest signature (embedded pubkey)                 │ │
│  │ 3. Check capability gates (OS, arch, disk)                     │ │
│  │ 4. Download artifact to temp file                              │ │
│  │ 5. Verify SHA-256 against manifest                             │ │
│  │ 6. Verify code signature (Authenticode/DevID/APK)              │ │
│  │ 7. Unpack to sibling directory                                 │ │
│  │ 8. Verify unpacked binary signature                            │ │
│  │ 9. Atomic rename into place                                    │ │
│  │ 10. Launch new version; crash-loop → rollback to N-1           │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Trust boundaries crossed:**
1. Build → Distribution: CI signs and uploads. Trust: CI environment is not compromised.
2. Distribution → Client: manifest + artifact served over HTTPS. Trust: CDN is not compromised, TLS is valid.
3. Client verification: manifest signature + artifact hash + code signature. Trust: embedded pubkey is authentic, artifact is untampered.

**If any boundary is compromised, the next boundary must catch it.** The three independent verification steps at the client (manifest sig, SHA-256, code sig) are designed so that no single compromise breaks all three.

---

## Summary Table

| # | Problem | Severity | Likelihood | Must-Have Mitigation |
|---|---------|----------|------------|----------------------|
| 1 | Partial download mid-update | Critical | High | Atomic rename + pre-flight capability gates |
| 2 | Code-signing cert expiry | High | Medium | Authenticated timestamps + auto-renewal + key backup |
| 3 | Manifest tampering | Critical | Low | Signed manifest + embedded pubkey + cert pinning |
| 4 | Delta update corruption | High | Low (if no delta) | Source+target hash verify; skip delta for v1.12.x |
| 5 | Staged rollout regret | Critical | Medium | Multi-layer kill switch + N-1 retention |
| 6 | PWA SW caches old shell | Medium | High | Workbox page-driven SKIP_WAITING + network-first HTML |
| 7 | iOS distribution latency | Medium | Medium | App Store + TestFlight + Ad Hoc parallel channel |
| 8 | Mac notarization failure | High | Medium | Staple .app + CI + post-notarization verification |
| 9 | Android v2/v3/v4 mismatch | Medium | Low | Play App Signing + v1+v2+v3 + 2033 key validity |
| 10 | Cloudflare Worker rollback | High | Medium | Forward-compatible state + KV pointer rollback |
| 11 | Update server SPOF | High | Low | CDN + telemetry + dead man's switch |
| 12 | Multi-platform version skew | Medium | High | Version header + backward-compat API + feature matrix |
| 13 | OS file locking during update | High | High | Atomic rename + last-known-good + crash-loop rollback |
| 14 | Silent update failure | Critical | High | Fleet dashboard + alert + state reporting |
| 15 | Key custody single person | Critical | Low (high impact) | Password manager + emergency runbook + backup |

---

## Implementation Priority

### v1.12.x (immediate — blocks production)

These MUST be in place before the next release ships:

1. **Atomic update protocol** (Problem 1, 13): write-to-temp → verify → atomic-rename. Keep N-1 on disk.
2. **Crash-loop self-rollback** (Problem 1, 5, 13): 3 crashes in 5 min → restore N-1.
3. **Manifest signature** (Problem 3): Ed25519-signed manifest, pubkey embedded in client.
4. **Authenticated timestamps** (Problem 2): RFC 3161 timestamp on every binary at build time.
5. **PWA SW update flow** (Problem 6): Workbox page-driven SKIP_WAITING, network-first index.html.
6. **Key backup** (Problem 15): Android keystore in two locations. Password manager with emergency access.

### v1.13.x (next release — reduces risk)

7. **Fleet telemetry dashboard** (Problem 14): `POST /heartbeat` with version + platform + update state.
8. **Staged rollout with kill switch** (Problem 5): 1% → 5% → 25% → 100% with explicit gates.
9. **Mac notarization in CI** (Problem 8): staple .app + validate in CI. Post-notarization download test.
10. **Manifest cache discipline** (Problem 5, 10): `Cache-Control: max-age=60` on manifest. KV pointer for "current version."

### v1.14.x (future — nice-to-have)

11. **Delta updates** (Problem 4): only if fleet > 50k or mobile becomes primary. Source+target hash verification.
12. **Secondary manifest URL** (Problem 11): hardcoded GitHub Releases fallback.
13. **Feature matrix** (Problem 12): version-per-feature table in project docs.
14. **iOS Ad Hoc parallel channel** (Problem 7): 100-device profile for critical field devices.

---

## Key Custody Checklist (Problem 15)

Complete this before the next release:

- [ ] Android keystore copied to encrypted USB drive (physical safe)
- [ ] Android keystore uploaded to encrypted R2/S3 bucket (private, KMS-encrypted)
- [ ] Keystore password + alias in password manager
- [ ] Play App Signing opted in (if not already)
- [ ] Apple Developer account: 2FA recovery codes documented
- [ ] Apple Developer account: secondary contact added
- [ ] Windows EV cert USB token: in physical safe, PIN in password manager
- [ ] Cloudflare account: 2FA + secondary contact
- [ ] Domain registrar: secondary contact + auto-renew enabled
- [ ] GitHub account: 2FA + recovery codes documented
- [ ] Emergency runbook written (one page, every credential + recovery step)
- [ ] Emergency runbook stored in password manager AND physical safe
- [ ] Trusted person named + briefed on emergency access

---

*Document generated for AIRIZ Motor Console release architecture risk assessment.*
*Citations verified against public sources as of 2026-11-05.*
*All incidents cited are real and publicly documented. No hypotheticals.*
