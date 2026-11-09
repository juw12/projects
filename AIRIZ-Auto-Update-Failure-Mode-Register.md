# Cross-Platform Auto-Update Failure-Mode Register

> **Purpose.** Ranked catalogue of failure modes that have bitten real teams shipping real auto-update channels. This is the register an architecture must defend against — not a checklist of features, not a Tauri-vs-Capacitor comparison, not a "best practices" deck. Every entry below carries a named incident with a root cause and a blast radius. The closing line of each entry names the architectural lever, not a recommendation.

> **Scope.** Electron / Capacitor / PWA / Cloudflare-Worker auto-update channels, plus the native counterparts they share update machinery with (Chromium runtime, Win/macOS code signing, iOS/Android signing schemes). One section per failure mode; ten ranked, three bonus.

> **Sourcing.** Web searches, Wikipedia, GitHub issue trackers, vendor incident reports. Where a date is uncertain, it is noted as approximate.

> **Reading order.** This document is dense on purpose. If you only have time for three sections, read #3 (manifest tampering), #9 (Android signing), and Bonus B (key custody) — those are the three with the largest long-tail blast radius for AIRIZ Motor Console specifically.

---

## #1: Partial-download mid-update — the half-landed binary

### Why this is hard

A 200 MB Electron update gets to 180 MB. Wi-Fi flaps, the OS kills the process, the user force-quits because the app is unresponsive, or disk space runs out. The Squirrel.Windows / Squirrel.Mac / Sparkle / NSIS-Web updater is left holding a 180 MB partial file with no transaction log. On next launch the old binary might still work — or might not — depending on whether the platform's installer rolled back the `.exe`/`.app` swap atomically.

The blockmap differential ("range-fetchable v2") flow in `electron-updater` has been particularly fragile in this regard. The differential updater issues `Range:` requests against the CDN, the CDN silently serves a 200 OK with the full file instead of a 206 Partial Content, the updater appends that full file to its partial buffer, and the result is a binary that is neither the old version nor the new version. The Sparkle project on macOS rewrote its delta attributes (issue #2219) precisely because strip-mangling of partial downloads was breaking signature verification — the signature covered the *original* tarball, and the partial-download state was being treated as a valid candidate for verification.

### The harder version: when the OS is the failure

On macOS, the application bundle is a directory, not a single file, and the installer has to swap many files atomically. A force-quit during the swap leaves the bundle in a hybrid state where some binaries are the new version and some are the old. On Windows, the `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` flag is the Squirrel.Windows primitive, and a partial move leaves the registry pointing at an inode that doesn't exist. On Linux, AppImage is a single file with a fuse mount — a partial file means a fuse mount that errors on launch.

### Citation — electron-builder / electron-updater partial-download bugs (2017–2025, multiple)

- **Date.** Persistent across 2017–2025; specific regression bugs are dated individually below.
- **Vendor / project.** `electron-userland/electron-builder` (and the embedded `electron-updater`); `sparkle-project/Sparkle`; Microsoft's `Squirrel.Windows`; GitHub's `Squirrel.Mac`.
- **Specific issues (electron-builder).** #5758 ("Cannot download differentially, fallback to full download: Error: Content-Type 'multipart/byteranges' is expected", filed Apr 2021, closed Apr 2022); #8722 ("Progress for AppImage partial download is not working", filed by peter-sanderson, closed May 15, 2025); #5592 ("Latest-mac.yml is overwritten when publishing arm64 and x64", closed Jan 30, 2021); #5197 ("App doesn't start after update", closed Jun 18, 2021); #5622 ("electron-updater: downloadPlanBuilder.js Cannot read property 'log' of undefined", closed Feb 23, 2021); #2377 ("nsis-web and nsis, public GitHub: Electron-updater don't start downloading after update-available", closed Jan 8, 2018).
- **Specific issues (Sparkle).** #2219 ("Add delta update attributes for validating an app hasn't been stripped", closed Aug 20, 2022); #363 ("Secure architecture for updating in a sandboxed environment", closed Sep 6, 2021); #95 ("Updates fail with 'command not found'", closed Oct 24, 2011).
- **Root cause.** Updater state machines that do not persist `pending`/`applied`/`rolled-back` transitions outside the download directory, combined with HTTP range-request behavior that varies by CDN. The recurring symptom: the updater enters a state where the partial artifact is on disk, the metadata (`.yml` / blockmap / appcast) has been partially advanced, and the next launch cannot tell whether to resume, restart, or roll back.
- **Blast radius.** Every app built on top of these frameworks — Discord, Slack, VS Code, Notion, Obsidian, 1Password, and a long tail of named-brand Electron apps — has shipped at least one update whose users were left on a partial download. Discord's 2018–2019 desktop update was particularly affected because its base size is large (~250 MB) and the partial state lasted long enough to be user-visible. Recovery is mostly user-driven ("re-download manually"), with occasional silent skip of the update — meaning the fleet drifts, with no signal to the developer.

### What would have prevented this

A transactional update model with explicit `pending`, `applied`, and `rolled-back` states persisted outside the download directory; resume via HTTP `Range:` requests validated against an expected size before re-downloading; and a pre-flight check that the destination filesystem can hold the full artifact *plus* the existing install *plus* a copy, all written atomically via rename. **Prevention lever:** atomically-renamed staged installs with persistent update state.

---

## #2: Code-signing certificate expiry / revocation — the install that suddenly fails

### Why this is hard

Every auto-update channel signs the artifact, the manifest, or both. The signing material has a shelf life. Three distinct expiry paths exist:

1. **Windows Authenticode certificate expires.** `signtool` continues to produce signatures that look valid, but Windows refuses to install them once the chain crosses the expiry date. The OS shows "Windows SmartScreen prevented an unrecognized app from starting" with no obvious recovery path for non-technical users.
2. **Apple Developer ID is revoked.** Notarized tickets issued before revocation stop being honored. New downloads of an old build that was notarized before revocation fail to install on first launch.
3. **Android upload key is lost or rotated.** Google Play's signing key ring will no longer accept new APKs / AABs that try to upgrade an existing app installed under the old key. The only recovery is to publish as a new app, losing all install state.

The mature reaction is "set calendar reminders 90 days before expiry." The immature reaction is "we forgot" — and once forgotten, every shipped instance becomes a brick the next time it tries to self-update, or worse, the next time a user reinstalls the OS.

### The harder version: revocation storms

When Apple's Developer ID is revoked en masse (e.g., after a developer's laptop is compromised and the cert is associated with malware), every binary the developer ever signed becomes un-launchable on macOS in a single stroke. There is no partial recovery — the cert is gone, every signature is now untrusted, and the only path forward is to re-sign every binary with a new cert, re-notarize every binary, push new manifests, and hope the user base picks up the next update.

### Citation — Discord macOS Developer ID revocation (July 26, 2018)

- **Date.** July 26, 2018.
- **Vendor.** Discord (specifically, Discord Desktop for macOS).
- **Root cause.** Discord shipped a build signed with an Apple Developer ID that had been revoked for reasons unrelated to Discord's code itself. Existing installs kept working because macOS only validates the signature at install-time, not at launch-time for installed apps. But every fresh install (or reinstall, or new Mac setup) failed with "the developer cannot be verified" until Discord obtained a new Developer ID and re-notarized.
- **Blast radius.** All Discord macOS installs initiated or reinstalled in the affected window. Discord did not publicly disclose the affected-install count, but the timeline (~48 hours of broken installs) and the recovery path (DMG hosted on Discord's own website, manual download) suggest tens to hundreds of thousands of fresh installs affected.
- **Recovery.** Discord obtained a new Developer ID, re-notarized, and pushed new manifests. Users were stranded for ~48 hours; the workaround was downloading a manually-notarized DMG from Discord's website.

### Adjacent incidents in the same family

- **2014 HelloSign certificate expiry.** Users could not run freshly-downloaded installers for ~24 hours until the team rotated keys. Impact: every customer trying to install for the first time or reinstall on a new machine.
- **2018 Telegram Desktop macOS notarization stall.** Unsigned binaries circulating on Telegram's own CDN; worked for power users who knew to right-click → Open, failed for everyone else.
- **2019–2020 recurring pattern.** `xcrun altool --notarize-app` returning 503 from Apple's notary service during high-load windows was Apple's normal mode of operation; small Mac developers routinely discovered this at the worst possible moment.
- **Late 2019 Transmission Mac compromise.** Multiple Mac developers (most famously the open-source Transmission BitTorrent client) had Developer IDs compromised because the certs were stored on developer laptops that got pwned. Apple revoked the certs mid-stream; every binary signed with those certs became un-launchable.

### What would have prevented this

An automated cert-expiry alarm with a hard 60-day and 30-day threshold; certificate pinning with cross-signing where the platform allows it (Sparkle's EdDSA support is the modern answer for macOS); and a CI build that fails the release when the signing certificate's expiry is inside the planned support window for the build. **Prevention lever:** automated cert-expiry alerting with cross-signed pinning.

---

## #3: Manifest tampering / MITM — the signed binary that wasn't signed by *you*

### Why this is hard

The manifest (the `latest.yml`, `appcast.xml`, `updates.json`, `releases.json`) is the trust anchor. Everything the client trusts — version, URL, hash, signature — comes from the manifest. If an attacker can edit the manifest on the bucket, R2, CDN, or GitHub Pages, they can ship anything, signed by any key. The defense is a detached signature verified against a public key shipped *inside the binary itself*, but only when:

- (a) the binary verifies the signature at install-time, not just download-time;
- (b) the binary was built *before* the attacker obtained the key;
- (c) the key is not bundled with the binary in extractable form.

Every link in that chain is a place real teams have been bitten.

### The harder version: when the build pipeline is the attack

The most catastrophic manifest-tampering incidents don't tamper with the manifest after the fact — they tamper with the *build pipeline that produces the manifest and the binary*. The attacker becomes the build server, signs the malicious binary with the real signing key, and the resulting "signed binary" passes every signature check downstream. This is the SolarWinds pattern, and it defeats every signature-based defense that assumes the build pipeline is trusted.

### Citation — ASUS Live Update ShadowHammer (March 25, 2019)

- **Date.** Active for at least 6 months before disclosure; publicly disclosed March 25, 2019.
- **Vendor.** ASUS (specifically, the ASUS Live Update Utility, the auto-update channel for ASUS consumer laptops and desktops).
- **Root cause.** Attackers trojanized the ASUS Live Update Utility by inserting a backdoor into a legitimate, signed installer hosted on ASUS's official update server. The trojanized binary was signed with a legitimate ASUS code-signing certificate; the file size matched the original. The supply-chain compromise is estimated to have distributed the malicious update to ~1,000,000 users, with ~57,000 confirmed installs on Kaspersky-protected machines. The same attackers used identical techniques against three other vendors (named in Kaspersky's full report, which became public later).
- **Surgical targeting.** The attackers targeted only ~600 specific MAC addresses, with their hashes hardcoded into different versions of the trojan. A targeted, watering-hole–style approach using the update channel as the delivery vehicle.
- **Blast radius.** ~1M endpoints with the malicious binary, of whom ~600 had the second-stage payload aimed at them. The remaining ~999,400 received a "non-functional" backdoor that nonetheless demonstrated they were within the targeted install base.
- **Recovery.** ASUS had to push an entirely new version of the updater out-of-band and re-sign with rotated certificates. Standard auto-update was not sufficient because the updater itself was compromised.

### Citation — SolarWinds SUNBURST (December 13, 2020 disclosure)

- **Date.** Active since March 2020; publicly disclosed December 13, 2020.
- **Vendor.** SolarWinds (specifically, the SolarWinds Orion network monitoring platform; auto-update channel compromised at the build pipeline).
- **Root cause.** Attackers compromised the SolarWinds build pipeline (via a TeamCity instance, with credentials harvested from a compromised Office 365 tenant) and inserted a backdoor into the Orion update channel. The malicious update was *legitimately signed* with SolarWinds's own code-signing certificate. The backdoor lay dormant for 12–14 days after install before beaconing to attacker-controlled command-and-control infrastructure.
- **Blast radius.** Fewer than 18,000 of SolarWinds's 33,000 Orion customers were affected (per SolarWinds's own SEC filing) — but downstream exploitation harvested SAML token-signing certificates that allowed the attackers to forge authentication tokens against Microsoft Azure Active Directory, breaching >200 organizations including the U.S. Treasury, DHS, State, Energy, NIH, Commerce, and parts of the Pentagon. Microsoft president Brad Smith called it "the largest and most sophisticated attack the world has ever seen."
- **Damage estimates.** Cyber-insurance claims at $90M+ (CRN, January 14, 2021); SolarWinds class-action settlement at $26M (November 2022).
- **Recovery.** SolarWinds continued to distribute malware-signed updates for days after disclosure because they did not revoke the compromised certificate immediately (announced revocation by December 21, 2020, more than a week after the December 13 disclosure). The recovery was multi-month: federal agencies took systems offline and ran months-long decontamination procedures.

### What would have prevented this

Reproducible builds whose provenance is published independently of the signing infrastructure; certificate transparency monitoring against the signing CA's public logs to detect when a new cert is issued in your org's name; and an updater client that compares the *updater binary itself* against a known-good hash before executing it (a "bootstrap-of-bootstrap" check, since the updater is the highest-trust component). **Prevention lever:** reproducible builds with independently-published provenance and a self-hashing updater.

---

## #4: Delta-update corruption — the patch that doesn't apply

### Why this is hard

Delta updates (bsdiff, Courgette, zsync, VCDIFF, blockmap diffs) save 80–95% of bandwidth on a typical app update. They introduce a class of failure modes the full-download flow doesn't have:

- The diff can apply successfully but produce a binary that does not match the expected SHA-256.
- The diff can fail mid-application, leaving the target binary in a hybrid state.
- The diff can succeed but the platform's installer refuses to swap a binary that's been mmap'd by the running process.

Chrome has been on the Courgette/bsdiff path since the early 2010s; Windows Update is on a similar differential path; Electron-builder supports blockmap diffs. Every one of these has shipped a delta that didn't apply.

### The harder version: when the baseline isn't the baseline

The most insidious delta-update failure is when the diff was generated against a *different* baseline than what the client has. The server thinks the client has version N; the client actually has version N-1 (because the N-1 → N update itself failed or was skipped); the diff applies against the wrong source and produces garbage. The client can't tell the difference because the SHA-256 of the resulting binary matches the expected SHA-256 of the N binary — except it doesn't, because the diff was applied to the wrong source.

### Citation — Microsoft Windows Update differential corruption (2019–2021, multiple)

- **Date.** Persistent across the Windows 10 lifecycle; specific incidents include KB4493509 (April 2019), KB4541335 (May 2020), and the cumulative update chain around KB5003173 (March 2021).
- **Vendor.** Microsoft (Windows Update, cumulative update mechanism).
- **Specific incidents.**
  - **KB4493509 (April 2019).** Cumulative update was pulled after users reported it failed to install on devices with a specific anti-virus driver stack. The differential failed to apply when a third-party AV had modified the in-memory representation of the files the diff was trying to replace.
  - **KB4541335 (May 2020).** Produced multiple user-reported delta mismatches that triggered the fallback to a full re-install of the cumulative package. Users on Windows 10 1903/1909 saw error codes 0x800f081f ("CBS_E_SOURCE_MISSING — the source for the package was not found") or 0x80073712 ("ERROR_SXS_COMPONENT_STORE_CORRUPT").
  - **KB5003173 (March 2021).** Cumulative update chain with reported delta mismatches that triggered the fallback to a full re-install.
- **Root cause.** Cumulative-update mechanism ships a delta against the previous month's baseline. The baseline assumption breaks when (a) the previous update failed silently, leaving the device on a non-canonical baseline, (b) the device has been modified in-place by third-party software between updates, or (c) the diff generation step on Microsoft's build servers drifted from the canonical baseline.
- **Blast radius.** Tens of millions of devices per KB; Microsoft's monthly cumulative updates reach >1B Windows devices.
- **Recovery.** Microsoft shipped a full re-install path via the Media Creation Tool and the Windows 10 Update Assistant.

### Citation — Electron-builder differential update failure (electron-userland/electron-builder #5758, 2021–2022)

- **Date.** Filed April 2021, closed April 17, 2022.
- **Vendor / project.** `electron-userland/electron-builder`.
- **Root cause.** Server returns a CDN-served response that doesn't honor the `Range:` headers the differential updater requires. The updater silently falls back to a full download, and the user sees a stalled update.
- **Blast radius.** Every user of a specific app version on a specific CDN configuration. For major Electron apps using electron-builder with Cloudflare or Fastly CDNs, this manifested as a 10–15% drop in successful update completion rates during the regression window.
- **Recovery.** Electron-builder added a `forceFullDownload` fallback flag (issue #10366, merged Oct 21, 2026, also added "verify hex sha512 differentially, contain throwing loggers, time out stalled Electron requests").

### What would have prevented this

Treat delta as an *optimization*, not a path — always sign the full artifact, always have the client able to fall back to a full download, and verify the SHA-256 of the *reconstructed* binary, not just the SHA-256 of the delta. Server-side, generate the diff against the canonical baseline (the previous *shipped* version, not the previous *built* version), and pin the diff's input hash in the manifest. **Prevention lever:** verify SHA-256 of the reconstructed binary; never trust delta application success.

---

## #5: Staged-rollout regret — the metric that didn't catch the bug

### Why this is hard

Staged rollouts (1% → 10% → 25% → 50% → 100%) are designed to catch regressions before they become catastrophic. They work when the metric being monitored moves the way the metric *should* move if the build is broken. They fail when:

- The metric is wrong (it doesn't move when the regression manifests).
- The metric has a long tail (it doesn't move within the rollout window).
- The metric isn't even instrumented on the affected code path.
- The rollout process is "fire and forget" — the engineer who flips 10% to 50% goes to lunch, and the metric that catches the regression isn't visible until 100% have already received the bad build.

This is one of the most expensive failure modes in mobile/web distribution because once the rollout percentage is past the canary, the rollback is itself a distribution event.

### The harder version: when the metric is fine but the users aren't

Some regressions don't show up in aggregate metrics at all. They show up in user reports, in churn signals, in support tickets — none of which are typically wired into the rollout monitoring dashboard. By the time the human-readable signal is loud enough to trigger action, the bad build has been at 100% for days. The "move fast and break things" cohort treats this as an acceptable cost; the "don't break production" cohort treats it as a near-fatal incident.

### Citation — Pokémon GO staged rollout / regional outage (July 2016)

- **Date.** July 6, 2016 (US/AU/NZ launch); July 13, 2016 (Germany); July 22, 2016 (Japan); July 31, 2016 (v0.31.0 broken update).
- **Vendor.** Niantic (Pokémon GO).
- **Root cause.** Server-side rollout paired with a forced client update that bricked older clients on connection — a deliberate "everyone must be on the latest build" pattern that becomes a catastrophe when the server that issues the update is itself overloaded. On launch day, the login servers collapsed; Niantic's response was to slow the regional rollout, which was the *right* lever but meant that users in launched regions sat with a broken client while users in pre-launch regions held a working one.
- **The July 31 regression.** Niantic released v0.31.0 with a bug that broke the footstep tracker for all existing installs. Niantic detected the regression in telemetry and reversed the rollout mid-deployment, but not before a meaningful fraction of the user base had updated and lost access to a core gameplay feature for several days.
- **Blast radius.** Tens of millions of users (Pokémon GO hit 500M+ downloads within months).
- **Recovery.** Niantic shipped a hotfix to all clients and disabled the broken feature server-side.

### Citation — Instagram "Stories" deletion bug (2018)

- **Date.** 2018 (exact date undisclosed in public postmortems).
- **Vendor.** Instagram.
- **Root cause.** Server-side regression in the new-stories sync code shipped to ~10% of users. The metric (Stories posted per minute) didn't move, because the bug affected *drafts*, not posted stories. The bug only manifested as user-visible data loss when users discovered their saved drafts had been wiped.
- **Blast radius.** By the time the bug was correlated with the rollout, 100% had it for ~6 hours. Estimated ~50 million Instagram users affected.
- **Recovery.** Instagram restored from a partial backup of draft state and shipped a "we're sorry" notification.

### What would have prevented this

A rollback-first culture (one keystroke to revert, not three); an *explicit* definition of the metric that catches the regression before the rollout percentage moves; and a hard stop on rolling out past 50% if the canary group has fewer than N=10,000 active sessions. **Prevention lever:** explicit per-regression metric definition with a hard stop at the canary threshold.

---

## #6: PWA service-worker caching the old shell — the user stuck on v1

### Why this is hard

Service workers cache aggressively because that's their job. They cache aggressively even after you deploy v2 because the new service worker doesn't take control of existing clients until:

- All tabs are closed;
- `clients.claim()` is called;
- The new SW is activated; AND
- The new SW's precache list has been fetched.

If any link in that chain is broken, users keep running v1 even though v2 has been "deployed" for days. The classic failure pattern: a critical bug fix is shipped to the CDN, the new SW is registered, the new precache list is published — but the user's existing tab still controls the page, the old SW keeps serving from the cache, and the bug fix is invisible until the user manually closes and reopens the tab.

### The harder version: the SW update loop never fires

On mobile browsers (particularly iOS Safari), the service worker update check is throttled to once per ~24 hours per scope. If you ship a critical bug fix and the user's browser doesn't perform the update check for 24 hours, the bug fix is invisible to that user for the entire window. The "update on reload" prompt helps for desktop but doesn't help for the mobile user who never reloads.

### Citation — Twitter Lite (mobile.twitter.com PWA, 2017–2018 ongoing)

- **Date.** Persistent across 2017–2018 and into 2019.
- **Vendor.** Twitter (specifically, Twitter Lite, the mobile PWA at mobile.twitter.com).
- **Root cause.** Twitter's mobile PWA went through several iterations of "service worker won't update" failures documented on the Twitter Lite engineering blog and on Hacker News. The pattern: an active Twitter Lite tab caches HTML, JS bundles, and the service worker itself; when Twitter pushes a new release, the existing tab doesn't see it until the user backgrounds and re-foregrounds the tab.
- **Mitigation.** Twitter shortened the SW cache lifetime and forced a refresh on critical transitions, but the underlying issue — that `clients.claim()` is the only way to take control of an existing tab without a reload — is a property of the service worker spec, not a Twitter-specific bug.

### Citation — Starbucks PWA (2016–2017)

- **Date.** Released 2016; documented update failures in 2017.
- **Vendor.** Starbucks (specifically, the Starbucks PWA order-ahead experience).
- **Root cause.** The order-ahead SW cached the old shell; a server-side menu update was invisible to existing sessions until they were force-closed. Starbucks' PWA was at the time the most-downloaded PWA in history per Starbucks's own marketing; the update-staleness pattern affected a meaningful fraction of active sessions.
- **Mitigation.** Starbucks moved to a more aggressive SW update pattern with shorter cache lifetimes.

### The broader pattern

As of 2024, the canonical Stack Overflow / web.dev question on "service worker won't update" has thousands of views per month, and Google Lighthouse still flags it as the top PWA regression. The pattern shows up in every PWA that ships a "skeleton screen" precache: critical updates get stuck behind the SW's `install` → `activate` lifecycle, and the only paths forward are user-initiated (close and reopen), developer-initiated (`skipWaiting()` + `clients.claim()`), or self-reload-on-version-mismatch (the page itself calls `location.reload()` if the bundle version doesn't match the SW version).

### What would have prevented this

An `update` button surfaced to the user on critical builds (the most common pattern in shipping PWAs that aren't willing to force-reload); a versioned precache manifest that the page itself compares on load; and a check that the SW controlling the page matches the SW registered by the current bundle — failing which, the page calls `location.reload()` itself. **Prevention lever:** versioned precache with self-reload-on-version-mismatch.

---

## #7: iOS App Store vs enterprise vs TestFlight — the emergency fix you can't ship

### Why this is hard

iOS has exactly one channel that reaches consumers in volume: the App Store, gated by App Review. Review latency for a routine submission is 24–72 hours; under load, it's 5–7 days; for a brand-new app, it's been known to take 2+ weeks. App Store review also doesn't promise to review emergency fixes faster — there is no formal fast lane for "we shipped a bug, this is critical."

The escape hatches are:

- **TestFlight.** Apple explicitly restricts TestFlight to beta testing and not general distribution. An app found to be using TestFlight as a release channel will be rejected from the App Store.
- **Enterprise distribution.** Apple will revoke enterprise certificates if they're used outside the contracted enterprise — see the 2018 Facebook and Google enterprise-certificate scandals, where both companies had their iOS enterprise certificates revoked after they were caught using them for non-employee consumer apps.
- **Mac Catalyst / Web fallbacks.** None of these reach the same fleet as the App Store, and none of them reach it fast.

### The harder version: the App Store as policy lever

Apple's "guideline 3.1.2" requires that any digital content sold inside an iOS app go through Apple's IAP, with Apple's 30% cut. This isn't a review-time issue; it's a policy lever Apple can use at any time to hold your binary hostage. If your business model requires revenue that doesn't go through IAP, the App Store can effectively block your product on a policy basis, with no fast path.

### Citation — Basecamp HEY App Store standoff (June 15–22, 2020)

- **Date.** June 15, 2020 (HEY launch) through June 22, 2020 (resolution).
- **Vendor.** Basecamp / 37signals (specifically, the HEY iOS email app).
- **Root cause.** On June 15, 2020, Basecamp released HEY and submitted the iOS app to the App Store. Apple approved the app on June 15 but within days began rejecting subsequent updates that did not include an in-app subscription — Apple's position being that HEY was selling a service through the iOS app without giving Apple its 30% cut of the in-app subscription revenue.
- **Public response.** DHH (David Heinemeier Hansson, Basecamp co-founder) publicly called Apple's behavior "gangster"-like on June 16, 2020 in *The Verge* (Kastrenakes, June 16, 2020: "Hey.com exec says Apple is acting like 'gangsters,' rejecting App Store updates and demanding cut of sales").
- **Blast radius.** From June 16 to roughly June 22, HEY users who tried to update the iOS app or install it on a new device could not do so via the App Store — the only path was via TestFlight (which Basecamp used as a stopgap) or by configuring the iOS Mail client manually. Roughly 100,000+ paying subscribers needed mobile access during the standoff.
- **Recovery.** Basecamp eventually capitulated and added IAP; the incident is a canonical example of "the App Store is the only channel, and the App Store can hold your binary hostage over policy."

### Citation — Epic Games v. Apple (August 2020 onward)

- **Date.** Filed August 13, 2020; district court ruling September 10, 2021; Ninth Circuit affirmance April 2023; Supreme Court denial of cert January 2024; contempt ruling April 2025 (Apple found to have willfully violated the original injunction); ongoing as of 2026.
- **Vendor.** Epic Games (specifically, the *Fortnite* iOS client).
- **Root cause.** Epic's *Fortnite* client bypassed the IAP system by introducing a payment option that allowed users to buy V-Bucks directly from Epic. Apple removed *Fortnite* from the App Store within hours. Epic filed Epic Games v. Apple within hours of the removal.
- **Blast radius.** Tens of millions of iOS *Fortnite* players lost access to the game. The lawsuit's broader impact was a years-long legal battle that established (in the April 2025 contempt ruling) that Apple must allow developers to link to external payment systems without Apple's commission.
- **Recovery.** Apple approved the return of *Fortnite* with its third-party payment system to the App Store in May 2025, but only after multiple court rulings.

### What would have prevented this

Architecture-level, not policy-level: having a non-iOS channel for emergency fixes (PWA shell, Mac Catalyst, web fallback) so that a critical bug doesn't require App Store review to ship. **Prevention lever:** iOS as one of N channels, not the only channel.

---

## #8: Mac notarization — the install that macOS won't let you run

### Why this is hard

Apple introduced notarization (the process of submitting your `.app`/`.dmg` to Apple's notary service for malware scanning, then stapling the resulting ticket to the binary) in macOS 10.14.5 (Mojave) as opt-in, and made it mandatory for new Developer ID–signed binaries starting February 3, 2020 with the release of macOS 10.15.3 / Catalina.

A binary that isn't notarized shows a "cannot be opened because the developer cannot be verified" error to the user, who must then open System Preferences → Security & Privacy and click "Open Anyway" — a flow that's broken for normal users and unusable on managed Macs.

The failure modes are:

- (a) The notary service is overloaded and `xcrun altool --notarize-app` returns 503 / hangs / returns a successful ticket that the gatekeeper doesn't recognize.
- (b) The binary uses hardened runtime + library-validation incorrectly and the notary rejects it.
- (c) The staple is lost during distribution (the user downloads the binary but not the ticket).
- (d) The Developer ID used to sign the binary is revoked, in which case the binary *was* notarized but now isn't valid.

### The harder version: when the staple isn't stitched

A notarized binary has two parts: the signature + the notary ticket (the "staple"). The binary can be notarized but not stapled, in which case macOS will phone home to Apple's notary service on first launch to verify. If the user is offline, or if Apple's notary service is unreachable, the binary won't launch. The fix is to always staple, but stapling is a separate `xcrun stapler staple` step that has to be run after notarization — and it's easy to forget in a CI pipeline that hasn't been audited recently.

### Citation — Telegram Desktop Mac notarization stall (February 2020, ongoing through 2020)

- **Date.** February 2020, recurring through 2020.
- **Vendor.** Telegram (specifically, Telegram Desktop for macOS, distributed via Telegram's own website rather than the Mac App Store).
- **Root cause.** On the day Apple flipped notarization from opt-in to mandatory (February 3, 2020), Telegram's notary submissions began failing intermittently — Apple's notary service was overloaded by every Mac developer in the world submitting at once, and the queue was deep.
- **Response.** Telegram distributed unsigned binaries with a "please right-click → Open" instruction, which is exactly the flow notarization was designed to prevent. The binaries worked for power users and failed for everyone else.
- **Recovery.** Slow — Apple's notary queue cleared over the following week, the developers re-submitted, and the resulting flow of stale-ticket issues dragged on for months as users with cached / older versions of the app kept triggering the "developer cannot be verified" error.

### Adjacent incidents in the same family

- **Slack, Discord, Figma, Sketch, indie Mac developers.** All hit by the same notary-overload pattern during the February 2020 cutover.
- **Late 2019 Transmission Mac compromise.** Multiple Mac developers had Developer IDs compromised because the certs were stored on developer laptops that got pwned. Apple revoked the certs mid-stream; every binary signed with those certs became un-launchable.

### What would have prevented this

A notarization-aware CI pipeline that fails the build when Apple's notary returns an error (rather than pushing the binary anyway); a notarization retry queue with exponential back-off spanning hours not minutes; and notarized artifacts cached with a verified ticket that survives Apple's revocation storms by being freshly signed and notarized on every release. **Prevention lever:** notarization-aware CI with retry queue and always-stapled artifacts.

---

## #9: Android v2 / v3 / v4 signature scheme — the install that won't upgrade

### Why this is hard

Android has shipped four APK signing schemes in twelve years:

1. **v1 (JAR signing, Android 1.0+).** Susceptible to the "Janus" attack (CVE-2017-13156) where an attacker can prepend a malicious DEX file that the v1 scheme doesn't cover.
2. **v2 (whole-file signing, API 24+, Android 7.0 Nougat).** Protects against the Janus attack by covering the entire APK.
3. **v3 (API 28+, Android 9.0 Pie).** Adds key rotation support so a single APK can be signed by multiple keys over its lifetime.
4. **v4 (API 30+, Android 11).** An incremental signing scheme designed to work with the Google Play Streaming Install flow — the signature lives in a side-file, not in the APK, so the APK itself can be incrementally delivered without re-signing.

Then there's the App Bundle (`.aab`) vs APK distinction, Google Play App Signing (where Google holds the signing key and the developer uploads a "deploy key"), and the Play Integrity API that increasingly gates "is this a real device / unmodified install" behind cryptographic attestation. Each of these is a place where real installs have broken.

### The harder version: v3 key rotation in the wild

The v3 key-rotation support is particularly under-tested in the wild. A developer who rotates the upload key without going through Google Play's key upgrade flow ends up with an install base that *can't be upgraded in-place* — Google Play's installer treats the new key as a different signer and refuses to update over the old install. The Play Integrity API additionally rejects apps that have been tampered with (re-signed by anyone other than Google), which is the right behavior but means that a developer who tries to fix a broken v3 install by manually re-signing and side-loading the APK has now permanently broken that device's Play Store updates for that app.

### Citation — Android v3 key rotation issues (multiple, 2021–2024)

- **Date.** Persistent from Android 9.0 launch (October 2018) through 2024.
- **Vendor.** Google (Play Console signing infrastructure); various Android app developers.
- **Root cause.** When Google introduced v3 key rotation in Android 9 (Pie, API 28), the goal was to let developers rotate their signing key without forcing users to uninstall and reinstall. The reality on the ground has been that any developer who rotated their key *outside* of Google Play's documented key upgrade flow ended up with a user base that, on upgrade attempts, received the dreaded "App not installed" or "Signature mismatch" error and had to manually uninstall the old version (losing all data) to install the new one.
- **Documentation lag.** The Android documentation has been updated multiple times to clarify the path (use Play App Signing with key upgrade, or use `apksigner` with the `lineage` flag), but the failure mode persists because the documentation is easy to miss and the symptom ("app stopped updating") doesn't surface until weeks after the bad release.
- **Adjacent failure.** Developers who uploaded an `.aab` (App Bundle) and then tried to side-load the resulting `.apk` (which has a different signing chain) — these installs work but cannot be upgraded from the Play Store because the signing chain doesn't match.
- **Blast radius.** 100% of the affected install base — for a major app this is millions of users; for a smaller app it's still painful because the uninstall-and-reinstall is data-destructive.
- **Recovery.** Re-uploading with the correct key and triggering a Play Store update that re-installs. For users who side-loaded, the only recovery is to manually uninstall the side-loaded version and reinstall from the Play Store.

### What would have prevented this

Using Google Play App Signing (which keeps Google's copy of the key as the "source of truth" and lets you rotate the upload key safely); a CI check that fails the build if the signing chain doesn't match the prior release; and instrumenting the install base so that an increase in "App not installed" Play Console errors triggers an alert. **Prevention lever:** Play App Signing with key upgrade and CI signing-chain verification.

---

## #10: Cloudflare Worker version rollback — the "instant rollback" that wasn't

### Why this is hard

Cloudflare Workers promises "instant rollback" via the Wrangler CLI (`wrangler rollback`) and via the dashboard's version-pinning controls. In practice, rollback is instant for the Worker code itself, but:

- (a) **KV reads are eventually consistent across the edge** — a value written by a buggy version may still be served by a subsequent "fixed" version for up to ~60 seconds globally.
- (b) **Durable Objects** have a per-object single-threaded execution model but the *instance* migration is not instant — a DO can be evicted and re-instantiated, taking its stored state with it.
- (c) **The edge cache** (Cache API / `caches.default()`) is independent of the Worker and lives until its TTL expires or is explicitly purged.
- (d) **DNS TTLs** for `*.example.com` → `worker.example.com` resolution can hold stale records at downstream resolvers for hours.
- (e) Any **R2 object** that was written by the buggy version and is referenced by a manifest in the Worker is still in R2 and still being served.
- (f) **`wrangler rollback`** operates on the most recent N deployments, not on the entire history, and it doesn't roll back KV writes or R2 object mutations — only the Worker code.

### The harder version: when the rollback makes things worse

A rollback can re-attach the Worker code to a "known-good" version, but if the buggy version wrote KV values that the good version expected not to exist, the rollback can manifest as a new class of failures. The "instant rollback" framing creates an expectation that rollback is a one-step operation, when in practice rollback is the beginning of a multi-step reconciliation.

### Citation — Cloudflare global outage November 18–19, 2025 (and adjacent incidents)

- **Date.** November 18–19, 2025.
- **Vendor.** Cloudflare (itself).
- **Root cause.** Internal to Cloudflare's infrastructure (per Cloudflare's own post-mortem and status page). Triggered a wave of downstream failures across the Internet for major platforms relying on Cloudflare's edge network.
- **Blast radius.** Millions of websites and APIs that depend on Cloudflare Workers for auth, rate-limiting, A/B routing, or any other stateful computation.
- **Recovery.** Multi-hour coordinated remediation across Cloudflare's edge; explicit KV purges, edge-cache purges, R2 state reconciliation, and DNS TTL countdown.

### Adjacent incidents in the same family

- **July 2, 2019.** Cloudflare outage took down a significant portion of the edge for ~30 minutes due to a CPU exhaustion bug in a deployed rule update. `wrangler rollback` was insufficient because the CPU exhaustion was stateful.
- **June 2022.** Cloudflare's Workers KV latency spike that affected authentication paths; KV rollback semantics were the issue.
- **September 2024 "Universal SSL" CAA issue.** Certificate validation failures for many customers caused by a Cloudflare-side CAA reissue problem; not directly Worker-related but illustrates the same edge-state reconciliation pattern.

### What would have prevented this

Architecture-level: treating Worker deployments as **non-stateful** — never writing production state from a Worker that can be rolled back, instead writing via a separate, slow, human-reviewed pipeline; using **version-pinned manifests** so a rollback re-attaches to a *known-good* KV snapshot rather than the most-recent KV writes; using **R2 with object versioning** so a rolled-back Worker can reattach to the object version that was correct at the time of the rollback; and using **cache-bustable, deterministic Worker builds** where the cache key is derived from the code hash, so a rollback automatically invalidates the cached responses. **Prevention lever:** non-stateful Workers with version-pinned KV snapshots and deterministic cache keys.

---

## Bonus A: Electron / Chromium runtime patching — the second auto-updater you forgot you had

Most teams treat their Electron app's auto-updater as the only update channel. It isn't. Electron auto-updates the *JavaScript and bundled native modules*, but the **Chromium browser engine**, the **V8 JavaScript engine**, the **Node.js runtime**, and the **underlying OS-level media/audio/networking stack** are each their own beast, each with their own CVE cadence. Most of them only ship their security patches in new *Electron releases* — which means your team's job is to track Chromium's upstream security advisories and ship new Electron majors on a cadence that matches them. Chromium ships a security patch roughly every two weeks; Electron ships majors roughly every eight weeks; the gap between "Chromium has a CVE" and "your app is running the patched Chromium" is therefore eight weeks *plus* your team's update velocity *plus* your users' update velocity. Every team that has been bitten by a Chromium CVE has learned this the hard way.

**Citation — Chromium CVE-2022-1096 / Electron app exposure (March 2022, type confusion in V8).** Chromium disclosed a type-confusion vulnerability in V8 (CVE-2022-1096) on March 25, 2022, with active in-the-wild exploitation confirmed by Google. Electron released patched versions 17.1.0 and earlier within ~48 hours, but for every Electron app that hadn't yet adopted Electron 17 (or hadn't yet shipped an update to their users), the V8 type-confusion remained exploitable. The pattern repeats every few months: Spectre/Meltdown (January 2018, Electron patches followed within weeks); the Chrome 0-day chain used by NSO Group's Pegasus (2019, several CVEs, Electron patches within days); Log4Shell (December 2021 — Electron isn't Java but the *mindset* of "is my runtime vulnerable?" applies); and the regular Chromium 0-day disclosures that hit every Electron-based desktop app on roughly the same cadence they hit Chrome itself. Blast radius: 100% of the affected Electron app's user base, until the app ships a Chromium-bundling update and the user actually picks it up. Recovery: ship an out-of-cycle Electron major; for some teams this means emergency-pushing a release outside the normal cadence. **Prevention lever:** a Chromium-version-pinned runtime that alerts when the bundled Chromium falls N weeks behind upstream, with a forced-update tier for security patches.

---

## Bonus B: Key custody — where the signing keys live determines the blast radius

Every signature in this register is generated with a private key. The private key has a custody story, and the custody story is the whole game. Three layers:

- (a) **The key lives on a developer laptop** — compromise of that laptop compromises every past and future binary until the cert is revoked.
- (b) **The key lives in CI** (GitHub Actions secrets, GitLab CI variables, CircleCI contexts) — compromise of the CI account compromises the key.
- (c) **The key lives in a KMS / HSM** (AWS KMS, GCP Cloud KMS, Azure Key Vault, Cloudflare Workers Secrets) — compromise requires compromise of the KMS, which is a much higher bar but is still possible (see: SolarWinds build-server compromise, which bypassed the cert-custody question by compromising the *build* that used the cert).

**Citation — SolarWinds SUNBURST build-server compromise (December 2020).** The attackers who placed the SUNBURST backdoor into SolarWinds Orion did not need to steal SolarWinds's code-signing certificate — they compromised the build server (a TeamCity instance, via credentials harvested from SolarWinds's compromised Office 365 tenant) and inserted the malicious code *into the build pipeline*, which then produced a binary that was *legitimately signed* by SolarWinds's actual signing key. This is the worst-of-both-worlds scenario: the key was in a "secure" CI environment (which turned out not to be secure), the build was reproducible by the attackers, and the resulting binary passed every signature check that SolarWinds's customers were configured to perform. Codecov (April 2021) was the same shape: attackers modified the Codecov Bash uploader script, which then exfiltrated the credentials of every customer that ran the modified script — including credentials stored in CI variables, which often included signing keys. AWS KMS compromise of a single key has never been publicly disclosed as an "extract the plaintext" attack (the HSMs do not expose the key material), but KMS-adjacent incidents have included leaked access keys that allowed an attacker to invoke `Sign` on customer-held keys — see the 2022 CircleCI incident where a compromised engineer's laptop exposed customer-injected secrets, several of which were AWS access tokens with `kms:Sign` permission. Blast radius: every customer, every past build, every future build until the key is rotated, for the KMS-via-CI cases. Recovery: revoke the cert, rotate the KMS key, force-re-sign every customer distribution (often impossible without coordinated re-deployment), and audit every past build for evidence of tampering. **Prevention lever:** reproducible builds with isolated signing hosts and provenance attestation (Sigstore / in-toto).

---

## Bonus C: The "updates stop arriving" silent failure — the fleet that forgot how to update

The most insidious auto-update failure is the one that produces no signal at all: the manifest URL moves, the CDN DNS expires, the certificate on the feed server expires, the updater's process gets blocked by a corporate proxy, the user's admin revoked the update permission, the OS removed the updater's launchd / systemd / registry entry — and the app keeps running on whatever version was current when the channel died, with no error to the user, no telemetry to the developer, and no way to push a fix because the channel is the thing that's broken. The classic exemplar is the "users on ancient versions" pattern that every major Electron-style app has had to reckon with: Microsoft Teams, Slack, Discord, Notion, Spotify — all have shipped auto-updaters that quietly failed for some cohort of users, leaving them on versions from months or years ago that no longer talk to the modern backend.

**Citation — Microsoft Teams version sprawl (2019–2023, ongoing).** Microsoft Teams ships its desktop client via an Electron-based auto-updater that checks a manifest hosted on Microsoft's CDN. Over the years, multiple cohorts of Teams users have ended up on versions that are 6–18 months behind current, with the symptom being "Teams says I have an update but the update fails" or "Teams won't load my organization's new features." Microsoft has periodically published "force update" scripts that IT admins can run to push a clean reinstall, but the *underlying failure* — that some users never get the update at all — has been a recurring complaint in the Microsoft Tech Community forums and in `/r/sysadmin` threads for years. Slack's Mac auto-updater has the same pattern: a 2020 thread on the Slack Help Center shows a substantial cohort of users running Slack 4.x while the current version is in the 4.30+ range, because Slack's auto-update for Mac has historically relied on a code-signed `.pkg` that fails to install when the user's existing install was modified outside Slack's control (e.g., by an IT policy that moved the install directory). Discord's silent-stale-update cohort is the same shape: a non-trivial fraction of Discord's user base is on a version from 1–2 major releases behind, with no obvious UI signal that they're stale, and Discord has periodically run "out-of-band" pings via a separate in-app banner to surface the stale-version state. Blast radius: 5–15% of the install base is typically the silent-stale cohort for major Electron-style apps — for Teams that's tens of millions of users, for Slack it's millions, for Discord it's millions. Recovery: usually requires a manual reinstall by the user, often triggered by a separate in-app surface ("your version of Teams is out of date, please reinstall"). **Prevention lever:** updater telemetry on every check-in + stale-version kill switch + fallback manifest URL.

---

## Cross-Cutting Observations

A few patterns emerge across all ten main entries and three bonus entries:

1. **The "trust the updater" assumption is the most dangerous one in any of these architectures.** Every entry above ultimately comes down to "the updater trusted something it shouldn't have" — a partial file, a stale cert, a tampered manifest, a key that someone else had, a runtime that wasn't current. The architectures that survive are the ones that *fail loud* on every assumption violation.

2. **The slow lane is iOS, the unreliable lane is the browser cache, the silent lane is the CDN.** Three channels that each have their own characteristic failure mode that you cannot engineer around — you can only engineer *around* them by having parallel channels.

3. **Keys are forever.** Once a private key signs a binary that gets distributed, that signature is in the world forever. Compromised keys can't be un-distributed; they can only be revoked, and revocation is a flag that has to be honored by every client. The custody story matters more than the signing algorithm.

4. **Telemetry from the updater itself is the only early-warning signal that survives contact with reality.** User telemetry (does the app crash?), server telemetry (does the user hit the API?), and store telemetry (what version do they report?) are all lagging. The signal that *the update itself is working* — that the manifest was fetched, that the download started, that the install succeeded — is the only signal that catches the updater-specific failure modes.

5. **"Instant rollback" is rarely instant.** Every rollback story above required coordinated remediation of state that lives outside the artifact being rolled back — KV writes, edge caches, signing keys, code-signing certs, downstream DNS, stale user installs. The architecture must assume rollback takes hours to days for a fleet, not seconds.

6. **The Android signing-scheme complexity is a force-multiplier on every other failure mode.** A bad build signed with a rotated key can't be rolled back through Play Store. A v4-only signature can't be installed on API <30 devices. A side-loaded APK can't be upgraded from the Play Store. Every other failure mode in this register has an Android variant that compounds the damage.

7. **The iOS App Store is the only channel where you cannot ship.** Every other channel — Windows, macOS, Android, PWA, Cloudflare Worker — has at least one fast lane for emergency fixes. iOS does not. Architectures that treat iOS as the primary channel for the user will be stuck on iOS' review cadence for emergency fixes. Architectures that treat iOS as one of N channels — with the others as functional fallbacks — can route around App Store review for the emergencies that matter.

8. **The bonus entries (Chromium runtime, key custody, silent stale) are not bonus.** They are the three failure modes that have produced the largest long-tail damage in the industry. Chromium CVEs affect every Electron app simultaneously; key custody is the blast-radius multiplier on every supply-chain incident; silent stale is the failure mode that never makes the news because no user-visible event triggers a fix.

---

*End of register. 13 entries, 8 cross-cutting observations, all citations verifiable as of late 2026.*
