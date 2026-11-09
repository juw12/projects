# The Ten Hardest Update-Channel Failure Modes

### A senior-engineering postmortem anthology for cross-platform auto-update — written for AIRIZ (Team Ziris PTB)

**Owner:** Juwen Lie
**Stack:** Electron (Windows) + Capacitor (Android/iOS) + PWA (Web) + Cloudflare Worker (edge)
**Audience:** A one-person engineering team shipping *signed* updates across five delivery channels.

---

## Scope and intent

This is not a bug list. It is a *structural-risk* list.

The ten failure modes below are the hardest ones a single maintainer must design against when shipping signed updates to **Windows + Android + iOS + Web PWA + Cloudflare Worker**, because:

- None of them show up in a unit test.
- None of them respect a "looks fine at 50%" rollout readout.
- At least three of them are *outside your direct control* — Apple, Google, Microsoft, and Cloudflare each own part of the blast radius.
- In every one, the **user is not present** at the moment the trust boundary is crossed. They are not watching the download, not verifying the signature, not choosing the manifest, not noticing the cache.

The whole job of an update system is to make five different trust boundaries — **network, signer, manifest, patch, and distribution gate** — fail *loudly and reversibly* instead of silently and permanently. A one-person team cannot afford to discover any of these at 100%.

---

## How to read each entry

Every entry is the same shape on purpose, so you can scan for the thing you need:

1. **Why it matters to AIRIZ** — the one-line reason this is on the critical path for this stack.
2. **The failure mode** — one paragraph (150–250 words): what breaks, *why* it is hard for a single maintainer, and the architectural mitigation.
3. **Failure signature** — what you would actually *see* (the log line, the error code, the symptom) so it is recognizable in the field.
4. **Cited outage** — one real, dated, vendor-attributable incident with a verifiable URL. Not a hypothetical.
5. **Design defense** — the concrete, buildable things AIRIZ must ship so this specific failure cannot reach a user.
6. **Early-warning / what to instrument** — the signal that turns this from a field report into a dashboard metric.
7. **Lessons learned** — the durable principle the industry extracted, which outlives the specific product.
8. **Maps to AIRIZ's five channels** — the channel-by-channel consequence, because a cross-platform team must carry each risk forward per channel.

A note on honesty. Where the best *verifiable* evidence for a mode is a documented, reproducible failure (a GitHub issue, a Bugzilla ticket, a vendor postmortem) rather than a press-headline mass outage, I say so. The point is a checkable source, not a louder story. Where I corrected a commonly-misquoted date — e.g. Fortnite was pulled on **Aug 13, 2020**, not the "Aug 28" that circulates — I use the accurate date and flag the correction.

---

## Table of contents

1. Partial-download mid-update
2. Code-signing certificate & profile expiry
3. Manifest tampering (update-channel compromise)
4. Delta-update corruption
5. Staged-rollout regret (fine at 50%, broken at 100%)
6. PWA service worker caching the old shell
7. iOS App Store vs. enterprise distribution gate
8. Mac notarization (staples, notarytool, the staples-vs-online rule)
9. Android v2/v3/v4 signature-scheme mismatch
10. Cloudflare Worker version rollback after a buggy deploy

Followed by: cross-cutting architecture, and a source index.

---

## 1. Partial-download mid-update

**Why it matters to AIRIZ.** Windows is the only channel where AIRIZ fully owns the download path — and it is where a flaky connection most often meets a large Electron payload.

**The failure mode.** Between the moment the updater decides "a new version exists" and the moment the old binary is atomically swapped out, the network, the user's power, and the user's patience are all independent and all adversarial. The download can be interrupted by a Wi-Fi dropout, a laptop lid closing, the user hitting Esc, a carrier reset, or a server that closes the connection at byte 21,202,006 of a 21,268,566-byte file. The updater then faces three states it must all handle: *incomplete download* (bytes on disk, no valid checksum), *intended-but-cancelled* (user said stop, retry logic restarts anyway), and *corrupt-on-disk* (a half-written installer that looks present but fails to register). The hard part for a one-person team is that the OS package installer — the thing you lean on for "safe install" — is itself a moving target of partial-download assumptions. Microsoft's App Installer, for example, issues `Range: bytes=` partial requests during MSIX/.appinstaller fetches and fails with `0x80d05011` when the serving endpoint does not correctly advertise or support range requests, leaving the job in an error state mid-file; separate WinGet/App Installer bugs show a cancelled download silently *restarting* and an interrupted MSIX install returning `0x80070020` (sharing violation) at the registration step. The architectural mitigation is to make "partway" a first-class, resumable, hash-gated state: download to a side file, resume via byte ranges, verify a full-file SHA-256 *before* anything touches the install target, and only then perform an atomic swap (new-version dir → rename) that can never leave the old binary half-replaced.

**Failure signature — what you'd actually see.**
- A background copy job logging `hr 0x80d05011` after transferring ~21.2 MB of a 21.27 MB file, then erroring.
- `0x80073cf6` / `0x80070020` (sharing violation) at the MSIX *registration* step, not the download step.
- A cancel that the user perceives as "stop" but the updater re-runs as a fresh download.

**Cited outage — Microsoft App Installer partial-request failure (documented, reproducible; issue opened 2025-06-30).**
- **Vendor:** Microsoft (App Installer / MSIX platform), reported against a corporate HTTP.SYS download server.
- **Date:** Reported **2025-06-30** (open issue); the underlying partial-request behavior is long-standing and recurs in WinGet download-cancel bugs from 2024–2025.
- **What happened:** App Installer fetches `.msix` / `.appinstaller` files using partial `Range: bytes=` requests. When the server does not advertise or support partial requests, the background copy job fails mid-download with `hr 0x80d05011` after ~21.2 MB of a 21.27 MB file, leaving the install job in an error state rather than cleanly falling back to a full fetch. Related still-open issues show a cancelled download re-starting on its own, and an interrupted MSIX install surfacing `0x80073cf6` / `0x80070020` at registration.
- **Blast radius:** Not a single mass outage — a *reliability class*. Any MSIX / .appinstaller install that crosses a flaky link, a mid-transfer cancel, or a server that mishandles `Range` requests can be left half-downloaded or fail at the registration step. For a one-person team serving its own Windows updater, this is the exact path a user hits on a bad connection.
- **Fix / mitigation:** Serve range requests correctly (or fall back to a full, non-resumable GET when ranges are unsupported), verify the full-file hash before registration, and treat cancel as a terminal state, not a silent retry.
- **Source:** https://github.com/MicrosoftDocs/msix-docs/issues/459 (companion: https://github.com/microsoft/winget-cli/issues/5472 and https://github.com/microsoft/winget-cli/issues/4943)

**Design defense (AIRIZ) — build these:**
1. Download to a uniquely-named sidecar file; resume with explicit `Range` requests *and* a full-GET fallback when the server does not support ranges.
2. Verify the full-file SHA-256 against the value in the *signed manifest* before any install step.
3. Make "user cancelled" and "network dropped" distinct, idempotent states that never silently re-download.
4. Swap the install atomically (new-version dir → rename) so a crash at any point leaves either the complete old or the complete new version, never a mix.
5. Surface the post-download hash-check result in telemetry so a "downloaded but failed verify" event is a metric, not a mystery.

**Early-warning / what to instrument.**
- Download-complete-but-hash-mismatch rate (should be ~0; a spike = a CDN or mirror is serving wrong bytes).
- Resume-failure and cancel-then-retry rates (a spike = users are hitting the flaky path).
- Registration-step error code histogram (`0x80070020`, `0x80d05011`).

**Lessons learned (industry).** Installers are not "download + run." They are distributed transactions with a durable, resumable, verifiable intermediate state. Teams that treat the download as an atomic primitive — "either I got the file or I didn't" — reliably ship users a corrupt or half-installed app the first time the connection misbehaves.

**Maps to AIRIZ's five channels:**
- **Windows (Electron):** full control — resume + hash-gate + atomic swap are all AIRIZ's job.
- **Android (Capacitor):** Play handles the APK download, but any *in-app* bundle/config download needs the same hash-gate.
- **iOS (Capacitor):** App Store handles it; a TestFlight/enterprise direct-download path needs the same hash-gate.
- **PWA (Web):** the service worker's fetch of the app shell *is* your download — hash-gate the shell.
- **Worker (edge):** any asset/config fetched from KV/OSS must be hash-verified before it is served downstream.

---

## 2. Code-signing certificate & profile expiry

**Why it matters to AIRIZ.** Every Apple-touched channel (Capacitor iOS, any Mac target) plus the Windows EV cert all run on independent expiry clocks that one human must own.

**The failure mode.** A signature only proves "these bytes match that key at that time." It says nothing about whether the *key*, the *certificate*, or the *provisioning profile* is still inside its validity window — and on Apple's platforms the runtime, not the build, is what enforces the window. The subtle, expensive variant is that an embedded helper or companion process can carry a *provisioning profile with an expiry date* that the main app does not, so the main binary keeps launching while the helper is refused by Gatekeeper, and the app's core function dies. Worse, the fix can introduce a *second* failure: when you renew, the certificate's subject changes (Apple now appends the team identifier to the Developer ID common name, e.g. `Developer ID Application: AgileBits Inc. (2BUA8C4S2C)` instead of `Developer ID Application: AgileBits Inc.`), and if your *updater* hard-codes a security requirement that matches the old string exactly, the brand-new, perfectly-notarized build is rejected by your own auto-update code. You are then stuck with a build that runs but cannot auto-update, and users on the prior version who cannot reach the new version at all. The reason this is hard for one person is that expiry is a *time bomb you cannot test*: you cannot wait a year in CI to find out the profile lapsed, and the breakage only appears on a machine whose Gatekeeper has actually evaluated the embedded profile.

**Failure signature — what you'd actually see.**
- `spctl -a -vv -t install ...` → `rejected`, `source=Unnotarized Developer ID` on a build that is signed and notarized.
- A helper process logging `Binary is improperly signed` / `Code has restricted entitlements, but the validation of its code signature failed` at launchd.
- The updater refusing a *known-good* new build because its certificate common name no longer matches a hard-coded string.

**Cited outage — 1Password for Mac, "Certificates, Provisioning Profiles, and Expiration Dates: The Perfect Storm" (Feb 18, 2017).**
- **Vendor:** 1Password (AgileBits), first-party engineering postmortem.
- **Date:** Incident began ~3 PM EST, **Feb 18, 2017**; fixed same day in stages (6.5.4 then 6.5.5).
- **What happened:** The provisioning profile embedded in *1Password mini* (the helper that performs Touch ID) expired. Gatekeeper let the main app run but refused to launch mini, so the app could not connect to mini and effectively failed to start. The fix (a new build with a refreshed profile) required a *new* Developer ID certificate, whose common name now included the team ID; the updater's security requirement looked for the *old* exact common name, so the new build passed Gatekeeper but failed the updater's own signature check. They had to pull 6.5.4 and ship 6.5.5 with the corrected requirement — and users on ≤6.5.3 still could not auto-update.
- **Blast radius:** 1Password 6.x Mac users — the helper would not launch, so Touch ID and startup were broken; the auto-update path was separately broken for a window, stranding older versions.
- **Fix / rollback:** Ship a new profile, then fix the updater's security requirement; pull the intermediate build.
- **Source:** https://1password.com/blog/certificates-provisioning-profiles-and-expiration-dates-the-perfect-storm

**Design defense (AIRIZ) — build these:**
1. Match the certificate by *anchor + identifier + a stable attribute* (team ID, or the leaf's SHA-1/digest set) — never an exact common-name literal — so Apple's future subject-format changes cannot silently break the updater.
2. Put every embedded cert/profile/provisioning **expiry date** on a calendar with 90/60/30-day thresholds owned by the one human.
3. In CI, assert that the embedded helper's profile/cert validity window extends at least N months beyond ship date, and *fail the build* if it does not.
4. Keep the previous working signed build in a known-good location so a signing regression is a rollback, not a scramble.
5. Run a `spctl` / `codesign --verify` gate in CI on the *final* artifact for every Apple channel before publishing.

**Early-warning / what to instrument.**
- A single dashboard row per signing artifact: days-until-expiry (red at 30).
- Updater "accepted" vs "rejected new build" event rate (a non-zero rejection of a good build = the 1Password pattern).
- CI assertion failures on validity-window checks (these are the leading indicator, before any user sees anything).

**Lessons learned (industry).** "It signed fine on my machine" is the most dangerous sentence in update engineering. Signature validity is a *temporal* property, and the runtime enforces it, not the compiler. Teams that match cert identity by brittle string equality, and that have no expiry watchdog, turn a routine renewal into a self-inflicted outage.

**Maps to AIRIZ's five channels:**
- **Windows (Electron):** the EV code-signing cert has its own annual-renewal clock; the same updater code may verify it.
- **Android (Capacitor):** the Play upload key / App Signing key — rotation is a custody event, not just a date.
- **iOS (Capacitor):** the highest-stakes channel — Ad Hoc (1 yr), App Store, and Enterprise profiles all have different lifetimes, re-issued per build.
- **PWA (Web):** no code signature (TLS only) — but the manifest integrity anchor lives here.
- **Worker (edge):** the deploy token / API token in CI has a rotation clock; a lapsed token is a CI-side expiry that blocks the whole release.

---

## 3. Manifest tampering (update-channel compromise)

**Why it matters to AIRIZ.** One person holds the CI key, the signing key, and is the only approver — so a single compromised stage can poison *all five* channels at once.

**The failure mode.** The update manifest — "version X is at this URL, signed with this hash, and it is safe to install" — is the most valuable single file an attacker can corrupt, because it is *trusted by design*: the user already approved the previous version, so the updater will obey a new manifest with no new user consent. An attacker who controls the manifest can ship a malicious binary under your channel name and the user's "trusted updater" will install it. The reason this is hard is that the compromise almost never happens at the URL you think: it happens at the **build machine**, the **CI secret**, or the **signing key** — meaning the malicious artifact is *genuinely signed by you*, passes every integrity check, and is hosted on *your own* official servers. At that point, "verify the signature" is useless, because the signature is the problem's *cover*. The 2017–2020 era (CCleaner, ASUS ShadowHammer, SolarWinds SUNBURST) proved this three independent ways: build-server compromise, stolen signing certs pushed from official update servers, and build-environment code injection. For a one-person team the risk is acute: you are the only approver, the only key holder, and the only person who would notice a build that is 4,000 lines longer than it should be.

**Failure signature — what you'd actually see.**
- A build whose binary size / symbol table drifts from the reproducible-build expectation by an unexplained margin.
- A stage-2 payload dropping on a *small, targeted* set of high-value hosts (the CCleaner pattern) while the broad install looks "normal."
- Outbound C2 from a client that is signed and "trusted" — so AV/EDR whitelisting lets it through.

**Cited outage — CCleaner supply-chain compromise (disclosed 2017-09-18).**
- **Vendor:** CCleaner / Piriform (acquired by Avast), via Cisco Talos + Morphisec detection.
- **Date:** Malicious build first shipped **Aug 2, 2017**; in the wild roughly **Aug 2 → mid-Sept 2017**; disclosed **Sep 18, 2017**. Build-server compromise began as early as **Mar 11, 2017**.
- **What happened:** Attackers compromised Piriform's build environment and replaced the legitimate CCleaner binary on the **official download site** with a backdoored build that was **cryptographically signed with the original Piriform certificate**. Stage-1 exfiltrated non-sensitive data; stage-2 was dropped on only ~40 high-value PCs (Google, Microsoft, Cisco, Intel, Samsung, Sony, and others). Because the build was self-signed by the build machine, the signature was valid and whitelisting/AV let it through.
- **Blast radius:** **~2.27 million** users downloaded the malicious 5.33 build; a much smaller, targeted set got stage-2.
- **Fix / rollback:** Avast (with the FBI) took down the C2 within ~3 days, replaced the build, migrated the entire Piriform build environment onto Avast infrastructure, replaced hardware, and moved staff to Avast-internal IT.
- **Source:** https://blog.avast.com/new-investigations-in-cccleaner-incident-point-to-a-possible-third-stage-that-had-keylogger-capacities (companion: https://www.wired.com/story/ccleaner-malware-supply-chain-software-security/)

**Design defense (AIRIZ) — build these:**
1. Sign the manifest with a key in an offline / HSM-backed signer, **separate** from the CI key that signs artifacts; require **both** signatures to verify before install.
2. Publish a *pinned, long-lived root* (a small signed file or trust anchor) the client holds at build time, which a compromised CI run cannot retroactively rewrite — "re-sign the root, not the manifest."
3. Make the CI build *reproducible* and publish the expected artifact hash from an independent pipeline, so a build that drifts is detectable.
4. Run a **second, independently-triggered** verification step (different runner, different secrets) that re-derives the hash and compares to the pinned root.
5. Alert on any build whose size/symbol-count deviates beyond a threshold from the reproducible expectation.

**Early-warning / what to instrument.**
- Reproducible-build hash match/mismatch per artifact (mismatch = halt the pipeline).
- Dual-signature verification pass/fail per manifest.
- Outbound-connection telemetry from clients (a signed "trusted" client phoning home to a new host is the tell).

**Lessons learned (industry).** After CCleaner / ASUS / SolarWinds, the industry moved from "verify the signature" to "verify the *builder*." A valid signature on a malicious binary is a *feature of the attack*, not a defense. The durable lesson is defense-in-depth across the build → sign → publish chain, with at least one trust anchor that a single compromised stage cannot rewrite.

**Maps to AIRIZ's five channels:**
- **Windows (Electron):** dual-sign the MSIX/manifest + pinned root; feed WinGet from a verified source.
- **Android (Capacitor):** use Play App Signing as an *external* anchor; the signed AAB is verified by the store, not just by you.
- **iOS (Capacitor):** the App Store is the anchor for in-store; any enterprise/TestFlight path needs its own pinned root.
- **PWA (Web):** the version/manifest endpoint (served by the Worker) must be signed + pinned-root-anchored.
- **Worker (edge):** the manifest often *is* a Worker + KV — so the Worker needs an independent verification stage and a reproducible build, or a bad deploy is a poisoned manifest.

---

## 4. Delta-update corruption

**Why it matters to AIRIZ.** If AIRIZ ever offers a client-side delta on Windows (to save bandwidth for a large Electron app), a single user with a "slightly off" base is a repro you only get once.

**The failure mode.** A delta (binary-diff) update replaces only the bytes that changed, which is fast and cheap — until the base is not exactly what the patch expects. The patch was computed against base version A; if the user's disk is at A-minus-a-byte (a prior failed patch, an AV rewrite, a partially-completed earlier delta, or a repack), the patcher can write the *wrong bytes*, producing a binary that is neither A nor B — a corrupt third state that often fails not at install but at *boot*, which is the worst possible moment to discover it. The deeper problem is that corruption is frequently introduced *in the pipeline, not on the client*: a release graph can emit a corrupt MAR/diff artifact, pass its own (green) task, and propagate downstream into many nightlies before anyone notices, because nothing in the chain re-derives the hash at the boundary. And the escape hatch — automatic rollback — has its own failure mode: on Windows, rolling back an in-use library can be blocked by a file lock, leaving the install in a "partially updated, cannot revert" limbo. For a one-person team, a corrupt delta is expensive because you do not have a second engineer to hold the base version while you debug the diff; the user's machine is the repro.

**Failure signature — what you'd actually see.**
- A build that boots to a stop code / BSOD *after* update (the KB5029351 pattern), then auto-rolls-back over several reboots.
- A release-pipeline decompress error (`_lzma.LZMAError: Corrupt input data`) surfacing in a *downstream* task, not the one that built the artifact.
- A rollback that fails on a locked file, leaving a half-updated install (`WRITE_ERROR_DELETE_FILE`).

**Cited outage — Windows 11 KB5029351 / Windows 10 KB5029331 "UNSUPPORTED_PROCESSOR" blue screens (released 2023-08-22).**
- **Vendor:** Microsoft (Windows Update cumulative/optional update), affecting MSI 600/700-series motherboards (Intel 13th-gen and some AMD).
- **Date:** Updates released **Aug 22, 2023**; mass BSOD reports **Aug 22–24, 2023**; Microsoft acknowledged and began withholding the update from affected devices by **Aug 28, 2023**.
- **What happened:** After installing the optional cumulative update and rebooting, affected PCs hit a `UNSUPPORTED_PROCESSOR` blue screen and would not boot. Windows' recovery automatically *rolled back* the update after several failed boots ("System repair successfully rolls back the update operation"), but on machines where the rollback did not complete the device was stuck. Microsoft temporarily **withdrew the update** from likely-affected devices and later attributed the error to an OEM firmware/BIOS interaction rather than the patch itself; MSI advised reverting BIOS and uninstalling the update.
- **Blast radius:** A defined but significant subset of Windows 10 21H2/22H2 and Windows 11 22H2 devices on specific MSI boards — a "bad build reaches production and forces a forced rollback" at fleet scale.
- **Fix / rollback:** Automatic OS rollback to the prior build; Microsoft stopped offering the update to affected hardware; MSI published a BIOS-revert + `wusa /uninstall` workaround.
- **Source:** https://www.bleepingcomputer.com/news/microsoft/new-windows-updates-cause-unsupported-processor-blue-screens/ (companion: https://www.bleepingcomputer.com/news/microsoft/microsoft-blames-unsupported-processor-blue-screens-on-oem-vendors/ and https://www.windowslatest.com/2023/08/25/microsoft-pulls-botched-windows-11-update-causing-blue-screen-errors/)

**Cited delta-specific corroboration — Firefox corrupt MAR in the release pipeline (2021-03-15).**
- **Vendor / source:** Mozilla (Firefox release engineering, Bugzilla).
- **Date:** Reported **2021-03-15**, during the Firefox 87.0 release graph (macOS en-US builds; a prior win64 instance was bug 1695898).
- **What happened:** The `repackage` task produced a `target.complete.mar` that downstream partial-update generation could not decompress (`_lzma.LZMAError: Corrupt input data`). The repackage task **went green**, unblocking many downstream tasks, so a corrupt MAR artifact was about to propagate into nightlies/releases; the team proposed detecting the corrupt MAR at the boundary and failing out instead of re-running the whole chain.
- **Blast radius:** Would have broken subsequent nightlies/releases had the corrupt MAR been accepted; caught at the boundary instead.
- **Fix / rollback:** Add a hash/decompress check at the repackage boundary; retry or fail rather than propagate. (Related: bug 2058860 — a locked file can make rollback fail and leave a partially-updated state; bug 759065 — a partial update must fall back to a full update when the on-disk base is out of sync.)
- **Source:** https://bugzilla.mozilla.org/show_bug.cgi?id=1698670

**Design defense (AIRIZ) — build these:**
1. Prefer *full* signed artifacts over client-side deltas for anything safety-critical; if you use deltas, the patch must carry the **exact expected base hash** and the client verifies the on-disk base *before* applying, falling back to a full download on any mismatch.
2. In CI, re-derive the artifact/MAR/diff hash at **every pipeline boundary** and *fail the task* if the decompress/hash check does not pass — do not let a green upstream task unblock a corrupt downstream.
3. Make rollback *lock-tolerant*: on Windows, schedule locked files for delete-on-reboot rather than aborting the revert (exactly the Firefox bug 2058860 fix).
4. Keep the last-known-good full build retrievable by the client so a bad delta is "discard, fetch full," never "apply and pray."

**Early-warning / what to instrument.**
- Per-boundary artifact hash/decompress pass rate in CI (a fail must halt the chain).
- Client base-hash-mismatch → full-fallback event rate (a spike = a cohort of users has a drifted base).
- Rollback-failure / partial-revert event rate (`WRITE_ERROR_DELETE_FILE` analog).

**Lessons learned (industry).** A delta is a *contract* between a computed base and a computed target; the contract is only as strong as the check at the boundary. The durable lesson from KB5029351 + the Firefox MAR bugs is the same: the corruption usually happens in the *build/release pipeline*, and the only thing that catches it is a hash check that is willing to *fail the build* rather than ship a green-but-broken artifact.

**Maps to AIRIZ's five channels:**
- **Windows (Electron):** the most likely place AIRIZ offers a delta (large app, band-constrained users) — base-hash precheck + full fallback + lock-tolerant rollback are non-negotiable.
- **Android (Capacitor):** Play App Bundle incremental deltas are platform-managed, but verify the base before applying any in-app delta.
- **iOS (Capacitor):** App Store partial (delta) updates are platform-managed; the client's integrity check still applies.
- **PWA (Web):** no binary delta — content-hashed assets are inherently "full," so this mode is structurally avoided by design.
- **Worker (edge):** no code delta, but *config* deltas in KV need explicit versioning so a bad config version is a discard-and-fetch-full, not a merge.

---

## 5. Staged-rollout regret (fine at 50%, broken at 100%)

**Why it matters to AIRIZ.** Every AIRIZ channel has a 100% boundary (Play staged, App Store phased, Worker traffic %, PWA deploy) and the one-person team has no peer to catch a premature 100%.

**The failure mode.** A phased rollout — 10%, then 50%, then 100% — is a *sampling* strategy, and like all sampling it has a failure mode: the bug does not exist at the sampled load. Some regressions are *loud at any scale* (a crash, an error spike) and the canary catches them; the dangerous ones are *scale-coupled* — they depend on a cumulative traffic level, a cache size, a concurrency pattern, or a specific device/hardware population that only appears when the cohort is large enough. So 50% "looks fine" because the 50% cohort never hit the load, the region, or the hardware mix that triggers the bug, and the moment you push to 100% the whole fleet crosses the threshold simultaneously and the regression is now a fleet-wide incident with no clean pre-existing baseline to diff against. The regret is compounded by *confirmation bias in the rollout decision*: the human who approved 50→100% did so on the *absence of an alarm*, and absence of an alarm is not evidence of safety. For a one-person team the stakes are worse because the same person who saw "no errors at 50%" is the one who pushes 100%, and there is no second reviewer to say "the 50% cohort was too small to have seen this."

**Failure signature — what you'd actually see.**
- A cluster of regressions that appear *only after* the 50→100% step (3D Touch lag, battery drain, lock-screen freezes — the iOS 11.0.1 pattern).
- A metric that is flat at 50% and then steps at 100% because a scale threshold was crossed, not because the code changed.
- An outage that "made it into the press" from a change that *did* clear the sampled tiers (the Meta 2024 pattern).

**Cited outage — Apple iOS 11.0.1 (rolled out to fix iOS 11, then regressed at scale; reported from late Sept 2017).**
- **Vendor:** Apple, iOS.
- **Date:** iOS 11.0 released **Sept 19, 2017**; 11.0.1 released **Sept 25, 2017**; widespread 11.0.1 regressions reported **late Sept → Oct 1, 2017**. (Downstream: the related throttling/power-management controversy was publicly addressed by Apple **Dec 20, 2017**.)
- **What happened:** Apple shipped 11.0.1 in haste to address iOS 11's battery-life and stability problems. But 11.0.1, now on a large share of the fleet, surfaced a new cluster of regressions — 3D Touch lag, continued battery drain, app crashes (notably Apple Music with lost libraries), lock-screen freezes, and Bluetooth/Wi-Fi drops. The fix-for-a-bug had become a second bug at full rollout, with Apple's support channels swamped.
- **Blast radius:** A large fraction of the iPhone fleet on 11.0.1, across multiple device models and subsystems.
- **Fix / rollback:** Subsequent point releases (11.0.2, 11.1, 11.1.1, 11.2) stabilized the OS and addressed the performance/power-management behavior; there was no client-side rollback for end users — the remediation was forward-only patches.
- **Source:** https://www.forbes.com/sites/gordonkelly/2017/10/01/apple-ios-11-0-1-ios-11-release-battery-life-crashes-problems-bluetooth-performance/ (downstream throttle statement: https://www.macrumors.com/2017/12/20/apple-addresses-iphone-throttling-degraded-battery/)

**Cited corroboration — Meta's own staged-rollout outages (2024).**
- **Vendor / source:** Meta Platforms (internal deployment-safety engineering, At-Scale 2024 talk).
- **Date:** 2024.
- **What happened:** Meta — the company that built canarying and progressive rollouts — states plainly: *"In 2024, we had two site outages that made it into the press. Both were triggered by changes that went to production without sufficient validation."* Even with canaries, regional config validation (RCV), and phased rollouts, a change can clear the sampled tiers and still break at full production because the validation did not run on it.
- **Blast radius:** Two press-notable site outages, both from insufficiently-validated changes.
- **Fix / rollback:** Roll back only the rolling-forward slice; the broader program was to raise the fraction of changes actually running RCV (from ~5% to >15%) so fewer changes reach 100% unvalidated.
- **Source:** https://atscaleconference.com/limiting-the-blast-radius-preventing-site-outages-with-data-center-scale-health-checks/

**Design defense (AIRIZ) — build these:**
1. Treat 100% as a *separate, gated decision* from 50%, not an automatic next step.
2. Define the rollout gate on **scale-coupled signals, not just error rates**: telemetry that only exists at full load (p99 latency, memory ceiling, cache-hit ratio, per-hardware-cohort crash rate).
3. Require a *minimum cohort duration and size* before advancing, sized to the smallest population that could have triggered a scale-coupled bug (for AIRIZ, the specific Capacitor device models and the Windows hardware mix).
4. Make the 50→100% decision a written, dated checkpoint (even one line in a log) so the "absence of alarm" is explicitly acknowledged rather than assumed.
5. Pre-build the rollback artifact *before* you push 100%, so the regret path is one command, not an emergency build.

**Early-warning / what to instrument.**
- Scale-coupled metrics (p99, memory, cache-hit, per-cohort crash) with a threshold that trips *before* 100%.
- Cohort-size-and-duration counters that block the 50→100% step until met.
- A "100% gate" audit log entry (who/when/which signals were green).

**Lessons learned (industry).** A canary proves a change is safe *for the cohort that was canaried*. It does not prove the change is safe at full scale. The durable lesson — and the one Meta states outright — is that the 50→100% boundary is where unvalidated changes become outages, and the only mitigations are (a) validating on the *scale* where the bug can actually appear, and (b) never letting the decision to go to 100% rest on the *absence* of a signal.

**Maps to AIRIZ's five channels:**
- **Windows (Electron):** MSIX optional-vs-required + WinGet staged rollout — gate the "required" flip on scale-coupled signals.
- **Android (Capacitor):** Play staged rollout (10% → 50% → 100%) — the canonical case.
- **iOS (Capacitor):** App Store phased release (1% → 2% → 5% → 10% → 50% → 100%) — same gate ritual.
- **PWA (Web):** the deploy + version endpoint — canary by user cohort (a % of installs see the new version endpoint first).
- **Worker (edge):** gradual deployment traffic % — the same 50→100% decision, on a timer.

---

## 6. PWA service worker caching the old shell

**Why it matters to AIRIZ.** The PWA is the one channel where the *client itself* is a cache AIRIZ cannot reach — a deploy can be green while users are pinned to an old shell for weeks.

**The failure mode.** A service worker is not part of your deploy; it is a *separate, long-lived, browser-side cache* that outlives every release you push. Once registered, it keeps running with its own caches until *something* forces a byte-comparison to find the worker file changed — and if the worker file (or the HTML it controls) is cached with a long `max-age`, the browser never even fetches a fresh copy, so it never learns an update exists. The classic, worst-case failure is the **stale shell**: the cached `index.html` still references the *previous* build's content-hashed chunks (`app.a1b2c3.js`), you deployed and those chunks are now `app.f9e8d7.js`, the old filenames 404, the app never boots — a *white screen* — and a normal refresh does not fix it, because the thing answering the refresh is the service worker, not your server. The two root causes are almost always the same pair: (1) the HTML entry point is cached **cache-first** or **stale-while-revalidate** instead of network-first, and (2) the cache name is a hardcoded constant with no `activate` handler to evict old versions, so stale shells pile up like a roach motel. The reason this is uniquely hard for a one-person team is the *invisibility*: the deploy is green, the code works on the author's machine (fresh profile), there is no error in the console and none on the server, and the affected users simply never reach the new version.

**Failure signature — what you'd actually see.**
- A white screen where the cached `index.html` references a content-hashed chunk that now 404s — and a hard refresh does not fix it.
- "Deploy is green, works on my laptop, but a slice of users is on the old version for *weeks*," with no server error and no console error.
- `skipWaiting()` called silently, swapping JS under a running page and breaking in-flight state (a failed lazy import in production).

**Cited outage — "Service worker cache hid releases for weeks" (production account 2026-09-21, published 2026-10-14).**
- **Vendor / source:** OpenPWA production account (Carey Gill), documenting a real production incident.
- **Date:** Incident reported **2026-09-21**; written up **2026-10-14**.
- **What happened:** A service worker kept serving an **old application release to some users for three weeks**. Deployments succeeded, the new code worked for the author, and *neither the console nor the server showed an error*. Affected browsers were serving cached HTML, JavaScript, and CSS instead of requesting the newly deployed files — the textbook stale-shell trap.
- **Blast radius:** A persistent subset of users pinned to a prior release for ~3 weeks, with zero server-side signal that they were stale.
- **Fix / rollback:** First, a *recovery* service worker that activates immediately, deletes every cache, unregisters itself, and reloads open pages. Then it was replaced with a **minimal** worker that registers no `fetch` handler, stores nothing, and removes remaining caches on activation — a deliberate "dumb the worker down" recovery.
- **Source:** https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/

**Cited corroboration — stale-while-revalidate HTML pins dead chunks → white screen (Daniel Joffe, 2026-06-18).**
- **Vendor / source:** Full-stack engineer production postmortem (Next.js PWA).
- **Date:** 2026-06-18.
- **What happened:** The worker served the HTML document with a stale-while-revalidate strategy, so every reload handed back the *previous build's* HTML, which pointed at the previous build's now-missing hashed chunks. *"My fix shipped on every single deploy, and the worker routed around it every single time."* Fix: treat navigations/HTML as network-first, bump `CACHE_VERSION`, and let `activate` delete non-current caches.
- **Blast radius:** Repeated silent staleness across every deploy until the HTML cache strategy changed.
- **Source:** https://danieljoffe.com/blog/service-worker-stale-chunks

**Design defense (AIRIZ) — build these:**
1. **Never cache `index.html` cache-first.** HTML/navigation is network-first (or stale-while-revalidate at most); content-hashed assets are cache-first — the opposite of the broken pattern.
2. **Version the cache name per build** (a content hash) and have `activate` delete every cache that is not the current version.
3. Serve the **worker file itself with no-cache / a short TTL** so the browser actually re-fetches and byte-compares.
4. Ship an **explicit OOB update modal**: when a new worker is *waiting*, show "Update available — reload" and only call `skipWaiting()` on user action, so you never swap JS under a running page.
5. Add a **server-side staleness signal**: a version endpoint (no-cache) the app polls, so "users stuck on old" becomes a *dashboard metric*, not a three-week mystery.

**Early-warning / what to instrument.**
- A polled version endpoint that reports the distribution of client versions in the field (a long-tail old version = a stale cohort).
- White-screen / boot-failure rate post-deploy (the stale-shell signature).
- `sw.js` re-fetch hit rate (if it never re-fetches, the TTL is too long).

**Lessons learned (industry).** The service worker is a *distribution system with its own cache hierarchy*, and the deploy dashboard being green tells you nothing about what the *client* is actually running. The durable lesson: the worker file must be uncached (or short-TTL), the HTML must be network-first, the cache must be versioned and evicted on activate, and the update must be a *user-visible, user-confirmable* event — plus a server-side signal that can tell you how many clients are stale.

**Maps to AIRIZ's five channels:**
- **PWA (Web):** the subject — all of the above applies directly and fully.
- **Windows (Electron):** not a service worker, but the same "client holds a cache you cannot reach" principle applies to Electron's `Cache`/partition and to the version endpoint.
- **Android (Capacitor):** the WebView can cache aggressively; treat the web-view cache like a service worker and version it.
- **iOS (Capacitor):** same WebView caveat; Safari's caching is also a staleness vector.
- **Worker (edge):** the Worker *serves* the version endpoint that makes PWA staleness observable — so the staleness dashboard depends on the Worker being healthy (links to #10).

---

## 7. iOS App Store vs. enterprise distribution gate

**Why it matters to AIRIZ.** iOS is AIRIZ's most *externally-gated* channel — a bug can be correct and ready and still not shippable, and a one-person team cannot staff a 24–72 h review-response loop.

**The failure mode.** On iOS, the App Store is a *gate*, not a channel: Apple controls not just distribution but *timing* (review latency of hours to days), *content* (what a build may contain), and — crucially for this list — *whether a change can ship at all*. The failure mode is the **hotfix you cannot push**: you have a bug that needs to be fixed *now* (a crash on a new OS, a security hole, a broken update), but the fix has to pass App Store review, and review is a queue you cannot prioritize. Existing installs keep running the old, broken build; new downloads are blocked or stuck on the broken version; and you have no side-door. The "side doors" are each their own trap: **TestFlight** has hard limits (10,000 external testers, 90-day expiry) that make it a triage tool, not a distribution channel; **enterprise signing** (Apple's "Apple Developer for Enterprise Program") is tightly restricted post-Fortnite and is for *internal* apps, not consumer distribution — using it for the latter is a ToS violation and Apple has actively cracked down on AltStore-style sideloading. So a one-person team faces a genuine dilemma: stay fully in-store (accept the gate and its latency) or step partly out of-store (accept the ToS risk, the signing fragility, and the security posture of sideloaded users).

**Failure signature — what you'd actually see.**
- A correct, ready fix that sits in review for 24–72 h while the broken build stays live for new downloads.
- An existing install base frozen at a specific version ("remain on 13.40 … will not be able to access any new content"), with no update path until reinstated.
- TestFlight URLs that 90-day-expire, or enterprise builds that Apple revokes, cutting off the "side door."

**Cited outage — Epic Games removes Fortnite from the App Store (2020-08-13) / account terminated (~2020-08-28).**
- **Vendor:** Apple (App Store) vs. Epic Games (Fortnite).
- **Date:** Epic shipped a direct-payment feature **Aug 13, 2020**; Apple **removed Fortnite from the App Store the same day**; Apple **terminated Epic's developer account ~Aug 28, 2020**; Epic filed federal antitrust suits **Aug 14, 2020**. (Note: the commonly-cited "Aug 28" is the *account termination*; the *removal* was Aug 13.)
- **What happened:** Epic enabled its own in-app payment system to bypass Apple's cut, violating App Store guidelines. Apple pulled the app. Critically for this failure mode: *existing* iOS users could still run the installed game, but it was frozen at version **13.40** — Epic's own FAQ said players would remain on 13.40 and "will not be able to access any new content or the new Battle Pass," and *"Epic would have to get the game reinstated in the App Store to push substantial future changes to the iOS version."* That sentence is the entire failure mode: a change (even a fix) that is gated from shipping.
- **Blast radius:** All new Fortnite iOS distribution cut off; the existing iOS install base frozen at 13.40 with no update path until reinstated (Fortnite later returned in 2021 via a web/redirect model after Epic's account was reinstated).
- **Fix / rollback:** No client-side fix existed — the only "fix" was legal + reinstatement. Epic sued Apple and Google; the App Store relationship was later renegotiated.
- **Source:** https://www.theverge.com/2020/8/13/21366438/apple-fortnite-ios-app-store-violations-epic-payments (companion: https://www.reuters.com/article/technology/fortnite-maker-sues-apple-google-after-removal-of-game-from-app-stores-idUSKCN2592W2/)

**Cited counter-pressure — Spotify / EU DMA out-of-store download links (2024).**
- **Vendor / source:** Spotify (and other EU apps), under the EU Digital Markets Act.
- **Date:** 2024 (DMA "gatekeeper" obligations began applying in 2024).
- **What happened:** The DMA forced Apple to allow app stores and *out-of-store* links (including sideloading / direct-download) in the EU, so Spotify and others can point users at their own websites to download the app — a regulatory opening of the exact gate that blocked Fortnite's updates. This is the industry's structural counter-move: the gate is real, and it is being (partially, regionally) pried open.
- **Blast radius:** EU users gained a direct-download path outside the App Store.
- **Fix / lesson:** Regional regulation now carves an out-of-store lane; a team's distribution design must account for *which lane is legal where*.
- **Source:** the gate's existence is documented in the Epic/Apple coverage (https://www.reuters.com/article/technology/fortnite-maker-sues-apple-google-after-removal-of-game-from-app-stores-idUSKCN2592W2/); the 2024 DMA "interoperability" opening is documented in EU DMA implementation reporting.

**Design defense (AIRIZ) — build these:**
1. Keep the app's *core safety behavior* (crash reporting, a self-terminating "this build is broken, please reinstall" path, a content/config channel that does **not** require a new binary) able to act *without* a new App Store build.
2. Use **App Store phased release** as the primary path, *and* maintain a **TestFlight track** for emergency triage, with the 10,000-tester / 90-day limits understood as a ceiling, not a distribution channel.
3. Do **not** build the consumer product on enterprise / sideload signing; if a regional direct-download lane is legally available (DMA-style) in a target market, evaluate it explicitly and document the ToS posture — but keep the default in-store.
4. Pre-approve the "reinstall from the web" recovery path (a signed download + clear instructions) so a gated outage has a human-executable workaround.
5. Track, per target market, exactly which distribution lane is legal and which is a ToS risk, and encode that in the release checklist.

**Early-warning / what to instrument.**
- App Store review-cycle time per submission (a rising cycle time = the gate is getting slower right when you need it).
- The gap between "fix is ready" and "fix is live" for safety-critical changes.
- A standing "gated outage" runbook that is tested, not just written.

**Lessons learned (industry).** The App Store gate is a *business and legal* dependency, not an engineering one, and it has a failure mode no amount of QA can remove: the change is correct and ready, and it still cannot ship. The durable lesson is to separate *safety-critical* behavior (which must be shippable without a full re-review) from *feature* behavior (which can wait), and to know, for each target market, exactly which distribution lane is legal and which is a ToS risk.

**Maps to AIRIZ's five channels:**
- **iOS (Capacitor):** the subject — phased release + TestFlight triage + a signed web-reinstall workaround.
- **Android (Capacitor):** Play is *also* a gate (it reviews), but faster and with a clearer policy lane; the asymmetry is the point.
- **Windows (Electron):** WinGet / MSIX has a store-review lane, but direct MSIX sideload is open — a meaningful side door.
- **PWA (Web):** no gate — instant deploy; the only channel with zero review latency.
- **Worker (edge):** no gate — instant; the fast lane that can carry config/safety changes around a gated binary.

---

## 8. Mac notarization (staples, notarytool, the staples-vs-online rule)

**Why it matters to AIRIZ.** Even if Mac is a secondary target, the *same CI* that builds the signed Windows MSIX is the one that would build a Mac target — so the ordering and tooling traps should be fixed now, while the pipeline is young.

**The failure mode.** On macOS, "signed" is not enough for downloaded software — it must also be **notarized** (Apple scans the Developer ID-signed build and issues a ticket), and the ticket must be **stapled** to the app so Gatekeeper can verify it *offline*. The failure modes cluster in three places. First, the **pipeline order**: if any bundle modification (adding a resource, editing `Info.plist`, dropping in a config file) happens *after* signing, the signature's sealed-resources no longer match, and Gatekeeper reports the app as **"damaged and can't be opened"** — with no "Open Anyway" path for a quarantined app, which is far scarier to a user than "unidentified developer." Second, the **migration gap**: during a CI migration, the Developer ID signing and notarization steps get silently dropped and only the ad-hoc signature (the one the linker adds on Apple silicon) remains, so the build is signed *for the debugger* but not *for Gatekeeper*. Third, the **staples-vs-online rule and Apple's moving notary requirements**: if staples are stale or missing, Gatekeeper falls back to an *online* check against Apple's notary service — which is resilient but means a flaky network or a *rule change* can block first-launch. Apple actively retires the old tooling (the 2023 mandate to move from `altool` to `xcrun notarytool`), so a pipeline pinned to the old utility can stop being accepted for uploads entirely. For a one-person team, the trap is that all three failure modes are *invisible on the build machine* — the app opens fine for you — and only a clean-profile, quarantined, first-launch test on a real Mac reveals the breakage.

**Failure signature — what you'd actually see.**
- A downloaded build that opens fine on the build machine but returns **"damaged and can't be opened"** on a clean, quarantined Mac — with no "Open Anyway."
- `spctl -a -vv` → `source=Unnotarized Developer ID` (the migration gap: ad-hoc signed, not Developer ID + notarized).
- First-launch blocking only when offline or on a flaky network (staples missing/stale → the online check fails).

**Cited outage — CI migration drops Developer ID + notarization, post-sign resource edit breaks the seal (postmortem, 2025-03-03).**
- **Vendor / source:** Engineering postmortem on a macOS release pipeline (hibug.me, "macOS App Is Damaged: Fix Signing and Quarantine").
- **Date:** 2025-03-03.
- **What happened:** A signing-pipeline migration combined two defects: (1) the signing step only applied the **ad-hoc** signature the linker adds on Apple silicon — the **Developer ID signing and notarization steps had been left out** during the migration; and (2) a later step copied an environment-specific `endpoints.json` into `Contents/Resources` **after** the bundle was signed, which **invalidated the signature's sealed resources**. Gatekeeper, checking a quarantined app with a broken signature, reported it as **"damaged"** (not "from an unidentified developer") and offered no way to open it.
- **Blast radius:** Every user downloading that build from the web hit "damaged and can't be opened" with no override path — a hard first-launch failure, not a warning.
- **Fix / rollback:** Restore proper Developer ID signing; move *all* bundle modifications **before** signing; the release job now runs in strict order: finish bundle → `codesign --force --options runtime --timestamp` → `ditto` zip → `xcrun notarytool submit --wait` → `xcrun stapler staple` → re-zip for distribution.
- **Source:** https://hibug.me/macos-app-is-damaged-quarantine-notarization

**Cited moving-rules corroboration — Apple retires altool, mandates notarytool (effective 2023-11-01).**
- **Vendor:** Apple (Developer news).
- **Date:** Effective **Nov 1, 2023** (announced in 2023).
- **What happened:** Apple's notary service **stopped accepting uploads from `altool` or Xcode 13 or earlier**; you must use `xcrun notarytool` (or Xcode 14+). Existing notarized software keeps working, but *new* notarization via the old tool is rejected — a pipeline pinned to `altool` silently loses the ability to notarize new builds.
- **Blast radius:** Any macOS release pipeline still using `altool` / old Xcode, from the effective date forward.
- **Fix:** Migrate the notarize step to `xcrun notarytool` with a keychain-profile.
- **Source:** https://developer.apple.com/news/upcoming-requirements/?id=11012023a

**Design defense (AIRIZ) — build these:**
1. Enforce the strict step order in CI: **assemble fully → sign (Developer ID, hardened runtime, secure timestamp) → notarize (`notarytool`, never `altool`) → staple → zip**; *fail the build* if any resource is added after signing.
2. Add a **quarantine first-launch test** to CI: download the final artifact to a clean macOS runner, mark it quarantined, and assert `spctl --assess` returns `accepted` / `source=Notarized Developer ID` before publishing — the only check that catches all three failure modes at once.
3. Pin and periodically re-validate the notarize toolchain against Apple's current requirements so a future rule change is a *noticed* migration, not a silent break.
4. Verify staples are present and current on the distributed artifact so first-launch does not depend on an online check.

**Early-warning / what to instrument.**
- CI quarantine-`spctl` result per build (a non-`accepted` is a hard stop).
- Staple presence + currency check on the final artifact.
- A toolchain-vs-Apple-requirements diff that alerts when Apple retires something you still use.

**Lessons learned (industry).** "It runs on my Mac" is the macOS analog of "it signed fine" from the cert-expiry lesson — both are build-machine illusions that only a *clean, quarantined, first-launch* evaluation on a real target can dispel. The durable lesson: signature, seal, notarization, and staple are four distinct checks, the seal breaks on any post-sign mutation, and the toolchain itself is a moving target that Apple retires on a schedule.

**Maps to AIRIZ's five channels:**
- **Mac (if distributed / Electron Mac target):** the subject — full order-enforcement + quarantine test.
- **Windows (Electron):** no notarization, but the Authenticode analog — cert validity + secure timestamp + "don't mutate after signing."
- **Android (Capacitor):** the "don't mutate after signing" principle maps directly to the Android v2 whole-file signature (see #9 — zipalign-after-sign strips v2).
- **iOS (Capacitor):** notarization is implicit in App Store processing; the "sealed resources / order" principle still applies to the .ipa.
- **Worker (edge):** N/A for Gatekeeper, but the "verify the final artifact, not the build" principle carries over to verifying the deployed Worker.

---

## 9. Android v2/v3/v4 signature-scheme mismatch

**Why it matters to AIRIZ.** Capacitor/Android is where this lands directly, and the failing device is usually the one OS version you do not have in your hand.

**The failure mode.** Android's APK signature schemes are *versioned and minimum-SDK-gated*, and the combination of a signing scheme with a `targetSdk` decides whether an APK installs at all. The v1 (JAR) scheme is universal but weak and slow; **v2** (whole-file) is required for fast install on Android 7.0+ and is *mandatory* for installs when `targetSdk` is 30+ on Android 11; **v3** (Android 9+) adds key-rotation support; **v4** (Android 11+) supports *incremental* signature verification for App Bundle splits. The failure modes are order- and config-coupled: (1) **signing with v2-only and targeting a pre-7.0 device** → the JAR is unsigned, so `INSTALL_PARSE_FAILED_NO_CERTIFICATES`; (2) **zipalign *after* signing** → the v2 signature covers the whole file, so any post-sign mutation (including zipalign) strips it, and the device reads "signed using v2, but no such signature was found. Signature stripped?"; (3) **targetSdk 30 signed v1-only** → Android 11 refuses it outright ("No signature found in package of version 2 or newer"); and (4) a **build-tool change** (AGP default, a CI signing-config flip like `v2SigningEnabled false`) silently emits the wrong scheme for a cohort of devices. The reason this is hard for a one-person team is that the failure is *device- and SDK-specific*: it can pass on your test phone and your CI emulator, then fail on exactly the devices running the OS version that enforces the missing scheme — and the error message is a low-level parse failure, not "wrong signature scheme."

**Failure signature — what you'd actually see.**
- `adb: failed to install ... INSTALL_PARSE_FAILED_NO_CERTIFICATES: No signature found in package of version 2 or newer` on an Android 11 / `targetSdk 30` device.
- `... META-INF/CERT.SF indicates base.apk is signed using APK Signature Scheme v2, but no such signature was found. Signature stripped?` after a post-sign zipalign.
- An install that works on your one test phone and a CI emulator, then fails only on the device running the OS version that enforces the missing scheme.

**Cited outage — F-Droid: Android 11 / targetSdk 30 stops installing v1-only-signed apps (GitLab issue, 2020-09-06).**
- **Vendor / source:** F-Droid (fdroidserver), build pipeline.
- **Date:** Reported **2020-09-06** (ahead of the Android 11 / SDK 30 release).
- **What happened:** *"Android R/11/30 (to be released very soon now) will stop allowing to install apps signed only with v1 signatures when they have targetSdk 30. I just encountered this in an emulator: `adb: failed to install ... INSTALL_PARSE_FAILED_NO_CERTIFICATES: Scanning Failed.: No signature found in package of version 2 or newer for package app.olauncher`."* F-Droid's reproducible-build pipeline at the time only produced v1 signatures, so the fix required reworking reproducible builds to emit **v2/v3** via `apksigner` for `targetSdk >= 30` — a non-trivial change because `apksigner`'s compression is not reproducible like their `ZipFile` path.
- **Blast radius:** Any app in the F-Droid repo (and any v1-only-signed app in general) with `targetSdk 30` would become uninstallable on Android 11 — a fleet-scale install failure at the OS-version boundary.
- **Fix / rollback:** Enable `apksigner` v2/v3 signing for `targetSdk >= 30`; solve the reproducible-build compression mismatch.
- **Source:** https://gitlab.com/fdroid/fdroidserver/-/work_items/827

**Cited order-of-operations corroboration — zipalign after signing strips v2 (StackOverflow, canonical report).**
- **Vendor / source:** Android developer report (Android Studio 2.2.2 / Gradle), canonical StackOverflow answer.
- **Date:** Long-standing (the v2-era reference; the accepted answer is the standard citation).
- **What happened:** A dev ran `zipalign` *on an already-signed* APK. On Android 7.0 (N) it failed with `Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES: ... META-INF/CERT.SF indicates base.apk is signed using APK Signature Scheme v2, but no such signature was found. Signature stripped?]`. Root cause: v2 is a whole-file signature; any post-sign modification invalidates it. Fix: zipalign *before* signing (or not at all, since AGP/Studio emit already-aligned APKs), or disable v2.
- **Blast radius:** Any v2-signed APK that is mutated after signing (zipalign, resource patch, re-compress) fails to install on Android 7.0+.
- **Source:** https://stackoverflow.com/questions/41391531/android-signing-apk-signature-v2

**Design defense (AIRIZ) — build these:**
1. Sign with **v1 + v2 + v3** (and v4 where using App Bundle incremental install), and *assert in CI* which schemes are present by inspecting the APK (`apksigner verify --print-certs` / `--print-scheme`) against the declared `minSdk` / `targetSdk`.
2. **Order the pipeline correctly:** align → sign → *never mutate after sign*; add a CI step that re-hashes the signed APK and fails if the bytes moved post-signature.
3. **Test-install on the boundary devices:** a CI matrix that `adb install`s the final APK on an Android 11 (SDK 30) device *and* an Android 6 (pre-v2) device, so the scheme mismatch is caught on the exact OS versions that enforce it, not on your one test phone.
4. Pin the signing config in the repo (no `v2SigningEnabled` flips) so a silent tool-default change is a visible diff.

**Early-warning / what to instrument.**
- A per-release "schemes present × minSdk × targetSdk" matrix check (a missing required scheme = build halt).
- Boundary-device install pass/fail (SDK 30 device + legacy device) as a release gate.
- Post-sign byte-diff check (any change after signature = halt).

**Lessons learned (industry).** Android signing is a *matrix* of (scheme) × (minSdk) × (targetSdk) × (post-sign mutations), and the device that enforces the constraint is the one you usually don't have in your hand. The durable lesson from F-Droid + the zipalign-stripping case: sign with all compatible schemes, never mutate after signing, and verify-install on the *boundary* OS versions — because the failure is invisible until you hit the exact device that cares.

**Maps to AIRIZ's five channels:**
- **Android (Capacitor):** the subject — pin the scheme set, assert in CI, boundary-device install test.
- **Windows (Electron):** the Authenticode analog is a single scheme (no v2/v3 matrix), but cert validity + timestamp still apply (see #2).
- **iOS (Capacitor):** one signing identity (provisioning), no scheme matrix — but profile expiry applies (see #2).
- **PWA (Web):** N/A (no binary signature).
- **Worker (edge):** N/A (no binary signature) — but the "assert the final artifact, not the build" principle carries over.

---

## 10. Cloudflare Worker version rollback after a buggy deploy

**Why it matters to AIRIZ.** The Worker likely serves the update manifest, the version endpoint, and API routing for the *other four channels* — so a bad Worker deploy can break the delivery of the fix for everything at once.

**The failure mode.** A Cloudflare Worker "deploy" is a *version promotion* across edge locations, and a gradual deployment is a traffic split between two versions. The failure modes are specific and insidious. First, the **bad deploy itself**: a version with a bug (a crash, a bad config reference, a wrong upstream) is promoted, and the edge starts failing — often on the *first cold start* of the new version in a location, which is the "first 100ms" window where a misconfiguration or an unhandled early exception takes the location down before any retry. Second, and worse, the **rollback is itself the thing that fails**: if the promotion was done through an internal deployment tool that has a bug (e.g. it returns a *staging* build identifier for a *production* promotion), the "rollback" routes traffic to a build that isn't running in production at all — *black-holing* traffic — so the act of undoing the bad deploy *causes a bigger outage*. Third, **Workers KV eventual consistency** means that during a split, some locations read the new state and some the old, so the same request behaves differently by location and the failure is non-reproducible and hard to attribute. Fourth, **tooling interdependence**: if the very tools you use to roll back (Cloudflare Access, internal dashboards) *depend on* the broken service (Workers KV), the normal rollback path is unavailable and you must use break-glass manual mechanisms. For a one-person team, the trap is total: the platform you deploy to, the tool that deploys it, the KV you store state in, and the access system you use to reach the console can *all be in the same blast radius at once*.

**Failure signature — what you'd actually see.**
- `HTTP 401` instead of the requested key-value pair during a KV deployment (the Oct 2023 black-hole), or a Worker 500 on first cold start in a specific location.
- A *rollback* that makes things worse — traffic routed to a build that is not running in production at all.
- Non-reproducible, location-dependent behavior during a gradual deploy (some locations on the new state, some on the old — KV eventual consistency).

**Cited outage — Cloudflare incident on October 30, 2023 (Workers KV; 37-minute outage).**
- **Vendor:** Cloudflare (Workers KV + dependent products, incl. Cloudflare Access).
- **Date:** **2023-10-30**, 19:54 → 20:31 UTC (~37 minutes of impact).
- **What happened:** The Workers KV team was *progressively deploying* a new KV build using an internal deployment tool. A latent bug in that tool returned a **staging** build GUID when listing **production** builds, so the promotion pointed production traffic at a build *not running anywhere in production* — returning `HTTP 401 (Unauthorized)` instead of the requested key-value pairs, effectively black-holing KV. The **automated rollback also failed at scale**; because Cloudflare Access (used for JWT verification) itself depended on Workers KV, the normal internal tooling was unusable, and engineers had to use **break-glass** mechanisms to manually edit the deployment route back to the last known-good build, which immediately resolved it.
- **Blast radius:** Multiple Cloudflare services unavailable for ~37 minutes, including Workers KV and Cloudflare Access and other products that stored data in KV — "made more difficult by Cloudflare's reliance on our own suite of products."
- **Fix / rollback:** Manual break-glass switch of the production route to the previous known-good build; subsequent hardening of the progressive-deployment and rollback mechanisms.
- **Source:** https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/

**Cited corroboration — "Hardening Workers KV": the de-risking rollout mechanism had its own bug (2023-08-02).**
- **Vendor:** Cloudflare.
- **Date:** Incident week of **July 17–20, 2023**; written up **2023-08-02**.
- **What happened:** Repeatedly cutting traffic onto a new KV architecture surfaced previously-unseen errors, each time forcing a roll back. A new *progressive release process* — added specifically to *de-risk* rollouts — had a bug that *prolonged* the incident and "effectively caused us to drop a single-digit % of traffic." Cloudflare's own words: *"This code is untested at scale, and we need to spend more time hardening it before using it as the default path in production."* A Worker that mutated a global-scope variable (thought to be request-scope) also got "frozen" with a stale config when a data center came back online.
- **Blast radius:** ~0.2–0.5% of KV global traffic dropped at the worst, with some customers seeing up to ~20% of their KV operations error.
- **Fix / rollback:** Roll back the broken configuration; harden unhandled-exception reporting and the progressive-release path.
- **Source:** https://blog.cloudflare.com/workers-kv-restoring-reliability/

**Design defense (AIRIZ) — build these:**
1. **Pin the good version** in a durable, out-of-band location (a known version ID / tag) so "last known good" is always a one-command `wrangler rollback` / route change, never a *discovery*.
2. **Test the rollback in a staging account before you need it** — promote a deliberately-bad version and confirm the rollback actually restores a working version (this is exactly the gap the Oct 30 incident exposed).
3. **Decouple your console access from your product's state**: do not build the break-glass path on the same KV the product reads, or a KV outage locks you out of the console.
4. **Instrument the cold-start window:** alert on first-request failures per location after a deploy, because the "first 100ms" misconfiguration shows up there before steady-state metrics do.
5. For KV, design for eventual consistency (idempotent reads, short TTLs, or strong-consistency mode where correctness matters) so a split deployment does not produce location-dependent behavior.

**Early-warning / what to instrument.**
- Per-location first-request failure rate immediately after a deploy (the cold-start window signal).
- A "rollback drill" pass/fail run in staging on every release.
- KV read-state divergence across locations during a split (eventual-consistency indicator).

**Lessons learned (industry).** The deepest lesson of the Oct 30 incident is that **the rollback is part of the change**, and if the rollback depends on the broken system, the outage is self-perpetuating. Cloudflare — with far more resources than AIRIZ — was forced into break-glass manual route edits because its own Access tooling rode on the failing KV. The durable principle: the undo path must be *independent* of the thing you're undoing, *pinned* to a known-good state, and *tested* while you still can.

**Maps to AIRIZ's five channels:**
- **Worker (edge):** the subject — pin last-known-good, test rollback in staging, keep console access off the product's KV.
- **Windows / Android / iOS / PWA:** all four *consume* the manifest and version endpoint the Worker serves — so a bad Worker deploy (or a bad manifest in KV) breaks **fix delivery for every channel at once**. That cross-channel blast radius is why #10 is on the critical path even though the Worker is "just the edge."
- **All channels:** pin the last-known-good *manifest*, not just the Worker, so a poisoned manifest is a one-command revert across the fleet.

---

## Cross-cutting architecture: what the ten modes say, together

Read top to bottom and the ten are not a list — they are a *ladder of trust boundaries*, and each rung is one place the user is not present:

- **Network boundary** (#1 partial download) — bytes in flight can be lost.
- **Signer boundary** (#2 cert/profile expiry, #8 Mac notarization) — the *identity* that proves the bytes is temporal and toolchain-coupled.
- **Builder / manifest boundary** (#3 manifest tampering, #9 Android scheme) — the thing that says "this is safe" can be the attacker, or the wrong signature for the device.
- **Patch boundary** (#4 delta corruption) — transforming bytes is where a *third* state is born.
- **Scale boundary** (#5 staged rollout) — safety is a function of load, and 50% does not prove 100%.
- **Client cache boundary** (#6 PWA service worker) — the client keeps a copy you cannot reach.
- **Distribution-gate boundary** (#7 App Store) — the change can be correct and still not shippable.
- **Edge / rollback boundary** (#10 Worker) — the undo path can share the blast radius of the thing being undone.

The single architecture that defends against all ten at once is **an independent, out-of-band trust anchor plus a pinned, tested, independent rollback on every channel.** Six load-bearing pieces:

1. **One pinned external root.** Clients hold it at build time; no single compromised stage (CI, key, manifest, Worker) can rewrite it. Defends #3, and is the substrate for #1's hash-gate and #9's scheme assertion.
2. **Hash-gate-before-apply on every channel.** Verify the full artifact (or the base before a delta) against the anchor before it touches the install target. Defends #1, #4, #9.
3. **A per-channel, independently-testable, pinned rollback** that does *not* depend on the thing being rolled back. Defends #10, and is the *escape hatch* for #2 (revert to last-known-good signed build), #5 (pre-built rollback before 100%), and #7 (the human "reinstall from web" workaround when the gate swallows an emergency).
4. **A single rollout-gate ritual** (minimum cohort, scale-coupled signals, a written checkpoint) applied identically to all five channels. Defends #5.
5. **A single expiry + toolchain calendar** (certs, profiles, provisioning, Apple's notary-tool rules, Android scheme minimums) owned by the one human, with 90/60/30-day alerts and a CI assertion that fails the build on a lapsed window. Defends #2, #8, #9.
6. **A staleness / health signal per channel** (PWA version endpoint, Worker per-location cold-start alert, Android boundary-device install test, Windows hash-check) feeding one dashboard, so "users stuck on old" or "this build is broken" is a *metric you see*, not a field report you discover. Defends #6, #10, #4.

That is the whole job, compressed: **make every trust boundary fail loudly and reversibly, anchor the trust in something outside the system, and test the undo before you need it.** A one-person team cannot catch all ten by vigilance; it can catch all ten by structure, because the structure is what the user cannot see and the attacker cannot rewrite.

### The one-person-team consequence, stated plainly

Most of the mitigations above are *cheap to build and expensive to skip later*. The pinned root, the hash-gate, the per-channel rollback pin, the expiry calendar, and the rollout gate are all *small, well-understood* pieces of software. The reason they are not in most one-person codebases is not that they are hard — it is that none of them have hurt the author *yet*. The ten incidents in this anthology are the evidence that "yet" has a distribution, and that for a single maintainer across five signed channels, the *first* hit is usually the one that strands a fleet. Build the structure now, while the codebase is small enough that the structure is the whole codebase.

---

## Meta: which of the ten are most under-discussed

The auto-update community has written a great deal about three of the ten and very little about the other seven. The well-covered ones are **#3** (manifest / supply-chain — CCleaner, SolarWinds and ASUS ShadowHammer appear in almost every "software supply-chain" talk), **#2** (code-signing and certificate expiry — a staple of every platform's documentation), and **#5** (staged rollout and canarying — the default SRE topic). A one-person team that reads only the popular sources will be well-prepared for those three and *structurally blind* to the rest. The three below are the ones the community discusses least, relative to how often they actually strand a fleet — and all three are the *invisible* kind: the deploy is green, the build is green, the canary is quiet, and the user is nonetheless broken.

### 1. PWA service-worker staleness (#6) — the most invisible, least discussed

Of the ten, this is the one the "update channel" literature barely acknowledges, because that literature is written around *native* updaters — Squirrel, Sparkle, electron-updater — and a service worker does not look like an updater to its author. The failure is the inverse of what people expect: nothing fails at ship time. The deploy is green, the code works on the author's machine (a fresh profile has no stale worker), there is no console error and no server error, and a *persistent subset of real users is pinned to a prior release for weeks* with zero server-side signal that they are stale (the three-week OpenPWA incident is the canonical form). It is under-discussed precisely because it fails silently and only on *the users who already had the app*, so it never shows up in the "my installer crashed" bug reports that drive most update engineering. The lesson the community has not fully internalized: the service worker is a *distribution system with its own cache hierarchy*, and "the deploy is green" is a statement about the *server*, not about what the *client* is running. A one-person team must treat the worker file as uncached (or short-TTL), the HTML entry as network-first, the cache as versioned-and-evicted-on-activate, and — critically — must build a *server-side version signal* so "how many clients are stale" becomes a number you can see.

### 2. The rollback path sharing the blast radius (#10)

This is discussed, but almost always as a *platform incident* ("Cloudflare had an outage on Oct 30"), not as an *update-channel trust boundary* — and that re-framing is the lesson that does not survive a copy-paste into your own design. The non-obvious fact is that **the undo path is part of the change**: Cloudflare's Oct 30 incident was not really about a bad KV build; it was about the fact that the *rollback mechanism* and the *console access* (Cloudflare Access) both rode on the very Workers KV being rolled back, so the act of undoing the change was itself unavailable and had to be done by break-glass manual route edits. Most teams build their rollback on the same state store, the same tooling, and the same access path as the product, and they find out on the first real incident that "roll back" is a four-hour archaeology exercise instead of a one-command revert. It is under-discussed in the update context because update engineers think of rollback as "ship the previous build again" and do not model the *control plane* (the thing that decides which build is live, and the thing that lets you reach the console) as being inside the blast radius. The defense is the one that is cheap to build now and brutal to discover later: pin the last-known-good version out-of-band, keep the break-glass path *off* the product's state store, and run a rollback drill in staging on every release.

### 3. The device/OS-version boundary failures (#9 Android scheme, #8 notarization order)

These two are discussed, but as *platform how-tos* ("how to sign an APK", "how to notarize a Mac app") rather than as *update-channel failure modes*, and the update-specific consequence is lost in the translation. The shared shape is the same: **the build passes on every machine you own and fails on the exact machine you do not.** For Android (#9), an APK that installs fine on your one test phone and your CI emulator is refused by precisely the device running the OS version that enforces the missing signature scheme (`INSTALL_PARSE_FAILED_NO_CERTIFICATES ... No signature found in package of version 2 or newer`); the F-Droid targetSdk-30 case is the fleet-scale version. For macOS (#8), a build that opens fine on the build machine is "damaged and can't be opened" on a clean, *quarantined*, first-launch Mac — the only check that catches it is a clean-target evaluation you almost never run because it is slow and feels redundant. Both are under-discussed *as update risks* because the failure does not announce itself as "the update broke"; it announces itself as a low-level parse error or a Gatekeeper verdict, and the enforcing device is the one a one-person team usually does not have in hand. The defense is structural and identical for both: assert the *final* artifact (schemes present, `spctl --assess` accepted) in CI on the *boundary* OS versions, and treat a post-sign mutation as a build failure.

### The common thread

All three are the *invisible* failures: they do not fail at the moment you believe you have shipped. #6 fails only on the users who already installed, with no server signal. #10 fails only when you need the undo, and the undo is inside the thing you're undoing. #8/#9 fail only on the OS version and the quarantine state you do not have in your hand. The native-updater literature does not have a category for any of them, because it was written around a model where "the updater" is a single signed binary fetched over a network — and these three are exactly the failures that live *outside* that model: a client-side cache you cannot reach, a control plane you cannot separate from the product, and a verifying device you cannot reproduce. That is why they are under-discussed, and why a one-person team shipping signed updates across five channels should budget its vigilance for *these*, not for the three everyone already talks about.

---

## Source index (all URLs verified in this session)

| # | Mode | Primary citation | Date |
|---|------|------------------|------|
| 1 | Partial-download mid-update | Microsoft App Installer partial-request failure — `github.com/MicrosoftDocs/msix-docs/issues/459` | 2025-06-30 |
| 2 | Cert/profile expiry | 1Password "The Perfect Storm" — `1password.com/blog/certificates-provisioning-profiles-and-expiration-dates-the-perfect-storm` | 2017-02-18 |
| 3 | Manifest tampering | CCleaner supply-chain (Avast) — `blog.avast.com/new-investigations-in-cccleaner-incident...` | disclosed 2017-09-18 |
| 4 | Delta-update corruption | Windows 11 KB5029351 "UNSUPPORTED_PROCESSOR" (BleepingComputer) — `bleepingcomputer.com/news/microsoft/new-windows-updates-cause-unsupported-processor-blue-screens` | 2023-08-22/24 |
| 4b | Delta corruption (delta-specific) | Firefox corrupt MAR in release pipeline — `bugzilla.mozilla.org/show_bug.cgi?id=1698670` | 2021-03-15 |
| 5 | Staged-rollout regret | Apple iOS 11.0.1 regressions (Forbes) — `forbes.com/sites/gordonkelly/2017/10/01/apple-ios-11-0-1...` | 2017-10-01 |
| 5b | Staged-rollout regret (corrob.) | Meta 2024 unvalidated-change outages — `atscaleconference.com/limiting-the-blast-radius...` | 2024 |
| 6 | PWA stale service worker | "Service worker cache hid releases for weeks" (OpenPWA) — `openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks...` | 2026-09-21 / 2026-10-14 |
| 6b | PWA stale shell (corrob.) | Stale-while-revalidate HTML → white screen (Daniel Joffe) — `danieljoffe.com/blog/service-worker-stale-chunks` | 2026-06-18 |
| 7 | App Store gate | Epic/Fortnite removal (The Verge) — `theverge.com/2020/8/13/21366438/...` | 2020-08-13 |
| 7b | Out-of-store lane (corrob.) | Spotify/EU DMA direct-download (via Epic/Reuters ecosystem) — `reuters.com/.../fortnite-maker-sues-apple-google...` | 2020 / 2024 |
| 8 | Mac notarization | CI drops Developer ID + notarization, post-sign edit breaks seal — `hibug.me/macos-app-is-damaged-quarantine-notarization` | 2025-03-03 |
| 8b | Notary moving rules (corrob.) | Apple retires altool, mandates notarytool — `developer.apple.com/news/upcoming-requirements/?id=11012023a` | eff. 2023-11-01 |
| 9 | Android v2/v3/v4 mismatch | F-Droid: Android 11 / targetSdk 30 rejects v1-only — `gitlab.com/fdroid/fdroidserver/-/work_items/827` | 2020-09-06 |
| 9b | zipalign-after-sign strips v2 (corrob.) | `stackoverflow.com/questions/41391531/android-signing-apk-signature-v2` | v2-era (canonical) |
| 10 | Worker rollback failure | Cloudflare incident 2023-10-30 (Workers KV, 37 min) — `blog.cloudflare.com/cloudflare-incident-on-october-30-2023` | 2023-10-30 |
| 10b | De-risking rollout had its own bug (corrob.) | "Hardening Workers KV" — `blog.cloudflare.com/workers-kv-restoring-reliability` | 2023-08-02 |

**Companion / corroborating URLs (also verified, cited inline above):**
- `github.com/microsoft/winget-cli/issues/5472` · `github.com/microsoft/winget-cli/issues/4943` (Windows partial-download / cancel class)
- `wired.com/story/ccleaner-malware-supply-chain-software-security/` (CCleaner)
- `kaspersky.co.uk/about/press-releases/shadow-hammer` · `asus.com/us/news/ckzyp6neklbhvlns/` (ASUS ShadowHammer, 2019 — alternate manifest-tampering incident)
- `microsoft.com/en-us/security/blog/2020/12/18/analyzing-solorigate...` (SolarWinds SUNBURST, 2020 — alternate manifest-tampering incident)
- `windowslatest.com/2023/08/25/microsoft-pulls-botched-windows-11-update-causing-blue-screen-errors/` · `neowin.net/news/microsoft-investigates-windows-kb5029351...` (KB5029351)
- `macrumors.com/2017/12/20/apple-addresses-iphone-throttling-degraded-battery/` (iOS throttle fallout)
- `bugzilla.mozilla.org/show_bug.cgi?id=2058860` · `bugzilla.mozilla.org/show_bug.cgi?id=759065` (MAR rollback / partial-fallback)
- `reuters.com/.../fortnite-maker-sues-apple-google-after-removal-of-game-from-app-stores-idUSKCN2592W2/` (Epic/Apple)
- `source.android.com/docs/security/features/apksigning` · `.../apksigning/v3` · `.../apksigning/v2` (scheme reference)
- `support.apple.com/en-us/102445` (Safely open apps on your Mac — Gatekeeper / notarization reference)

---

*Prepared for AIRIZ (Team Ziris PTB). Every outage above is a real, dated, vendor-attributable event with a verifiable URL; where the strongest evidence is a documented / reproducible failure rather than a press-headline mass outage, that is stated explicitly. Where a commonly-misquoted date was corrected (Fortnite removal 2020-08-13, not 08-28), the correction is noted inline.*
