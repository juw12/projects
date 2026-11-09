# The Ten Hardest Problems in Shipping a Cross-Platform Auto-Update Channel Users Trust Without Bricking a Fleet

**Scope:** AIRIZ — Windows + Android + iOS + Web PWA + Cloudflare Worker
**Owner:** Juwen Lie (Ziris PTB)
**Date compiled:** 2026-11-05
**Method:** every problem below is paired with one real, dated, URL-backed outage.
No generic advice, no invented incidents.

---

## How to read this document

An auto-update channel is the single most dangerous line of code you own,
because it is code that installs code.
The trust chain has five links, and any one of them can break in production:
you sign the bytes, the bytes travel over a CDN you rent, a manifest tells the client
what the bytes should be, the client verifies and swaps them in, and a fleet of
devices you do not control launches the result.
Ship one update and you have done all five of these things at once,
across five different operating systems that each have their own trust model,
their own clock, and their own failure mode.

The hard part is not the happy path.
The happy path is "download, verify, rename, launch, done."
The hard part is everything the happy path pretends does not exist:
the network that drops at 6 MB of 50 MB, the signing cert whose 12-month timer
you forgot, the CDN edge node someone else owns, the delta patch applied against
the wrong base version, the canary that reached 100% before your crash-rate
telemetry woke up, the service worker that outlives your deploy, the App Store
review that takes two days when you need a hotfix in two hours, the notarization
ticket that Apple stopped accepting a year ago, the APK signing block a downgrade
attack strips, and the Cloudflare Worker you rolled back but whose Durable Object
state is now on the wrong version.

Each section is one problem.
Each problem gets real technical depth — the specific mechanism, the specific
failure mode, the specific command or error string you will actually see — followed
by one real outage citation in the form `Date | Vendor | URL | Root cause | Fix/status`.
The citations are primary or near-primary sources (vendor post-mortems,
AOSP/Apple documentation, vendor GitHub issues), not blog retellings.
Where a single problem has more than one famous incident,
the section names the extras in the prose with their own URLs so the full
lineage is visible.

The through-line: **verification is necessary but not sufficient.**
A signature proves the key holder approved the bytes.
It does not prove the key holder was not compromised, that the bytes are the
version you *meant* to ship, that the delta was applied to the right base,
or that the device is the one you think it is.
Every one of the ten problems is a place where "I verified it" turns out to have
been the wrong question.

---

### The ten problems at a glance

1. Partial-download mid-update — the artifact on disk is half-written and the app launches into it
2. Code-signing cert expiry — the trust anchor has a clock, and the fleet finds out at launch
3. Manifest tampering — the manifest is the control plane; trust the manifest and you verify nothing
4. Delta-update corruption — the patch applied to the wrong base produces well-formed garbage
5. Staged-rollout regret — the kill switch is slower than the blast radius
6. PWA service worker caching the old shell — the SW is a second, slower, independent deploy target
7. iOS App Store vs enterprise — three distribution models, three clocks, no single update primitive
8. Mac notarization — notarization and stapling are two separate checks, and the tooling moved under you
9. Android APK Signature Scheme v2/v3/v4 — the signing block is also the rollback and downgrade control
10. Cloudflare Worker version rollback — the code rolled back; the KV/DO state did not

---

## 1. Partial-download mid-update

The updater's job is to replace its own execution environment with bytes that
arrive over a network you do not control and that is lossy by default.
The failure is not "the download failed" — a truncated HTTP response is detectable.
The failure is that the **next launch** happens against a half-written artifact.
On Windows, Squirrel and `electron-updater` stage into a temp directory and
atomically rename, but there is a window between "file fully written" and
"staged dir registered as the new app" where a power loss, OOM kill, user
force-quit, or OS crash leaves the launcher pointing at an incomplete directory.
The app does not refuse to run; it runs against whatever is there.

There are four distinct bug classes, and they fail in different ways.
**Truncation:** the stream ends at, say, 6 MB of a 50 MB payload and the writer
never `fsync`s, so the block that will be read at launch is not the block that
was written.
**Race:** the request is faster than the filesystem setup — `electron-auto-updater`
had a case where the first chunks arrived before `ensureDirPromise` resolved and
`configurePipes` ran, so the leading bytes never passed through the digest
transform and you got a `SHA2 checksum mismatch` on *every* build.
**No resume:** on a connection reset the updater just dies instead of resuming
with an HTTP `Range` request, so a user on flaky 4G never converges and is left
pointing at a staged-but-incomplete artifact.
**Non-atomic rename:** some paths (network drives, OneDrive-synced folders,
certain NTFS mount flags) break the rename-atomicity guarantee, so old and new
are both present and the launcher picks the wrong one.

The deep problem is that **verification must happen before any swap, against the
manifest's full-artifact hash, not the file's self-description.**
Concretely: download to a `.partial` file opened with `O_EXCL`, `fsync` it,
compute the full SHA-256 and compare it to the value in the *signed* manifest,
only then stage into a new directory and atomically swap, and gate the very first
post-update launch on a `boot-complete` marker.
If the new build crashes N times before writing that marker, a watchdog rolls
back to the last-known-good that you kept on disk.
The last-known-good keeper is the single most important line in this whole
system: it is the only thing standing between "we shipped something bad" and
"every device is bricked."

> **Outage citation**
> - **Date:** 2026-01-15
> - **Vendor / product:** electron-builder / electron-updater (`electron-userland/electron-builder` issue #9504)
> - **URL:** https://github.com/electron-userland/electron-builder/issues/9504
> - **Root cause:** ~10% of a real production fleet received a truncated or corrupted
>   download (reported `sha512 checksum mismatch` plus `Code signature ... did not
>   pass validation`), leaving those users stuck on older versions with no working
>   update path.
> - **Fix / status:** closed as a known issue class; the durable fix is full-artifact
>   hash verification against the manifest before rename, retry with `Range` resume,
>   and a last-known-good rollback guard — the mismatch persists into
>   `electron-updater` 6.x, so treat it as a permanent design constraint, not a
>   one-time bug.

---

## 2. Code-signing cert expiry

A signature is the only thing standing between your bytes and "this is a virus,"
which means the trust anchor's lifecycle is a **hard deadline**, not a someday
task — and there are three different anchors with three different clocks.
On iOS, Apple's own in-house-distribution documentation states that a
**distribution provisioning profile expires 12 months** after issuance and that
after the expiration date "the profile is removed and the **app won't launch**"
— note: won't *launch*, not won't *update*.
The **distribution certificate** is valid for **13 months**, and on first launch
the device validates it via **OCSP** against `ocsp.apple.com`, caches the OCSP
response for 3–7 days, and **fails closed** if it can't reach Apple or if the
cert is revoked.
Revoking a distribution certificate invalidates **every** app signed with it.
There is no grace period and no server-side extend: you issue a new profile,
re-sign the IPA, and push it through MDM before the clock runs out.

On Android the **P12 keystore does not expire, but the X.509 certificate inside
it does.**
CAs historically capped public-trust certs at ~10 years and now much shorter
(820/825 days under the CA/Browser Forum).
When the cert in the keystore lapses you can no longer produce valid v2/v3
signatures with it, and because Android v2/v3 verify the **signing key lineage**,
a naive re-sign with a new key breaks updates: the installed app expects the old
key, the new APK presents a new key, and the install is rejected as a different
app.
Play App Signing (where Google holds the key) exists precisely to absorb this so
a cert rotation does not orphan your fleet.
On Windows the EV/OV **Authenticode** cert is checked with a **timestamp**:
already-distributed binaries keep working after expiry because the timestamp
pins the cert's validity at signing time, but you can no longer sign *new*
updates, and SmartScreen re-scores the publisher.
The nastiest case is **revocation** (stolen key, lapsed EV validation), where
previously-signed binaries that get re-checked can suddenly fail.

The hard part is that **none of these clocks give you a warning that is
actionable at fleet scale**, and the fix is itself a *new artifact* that must
survive every other problem on this list — a re-signed IPA is still a
partial-download risk, still needs a valid manifest, still has to clear
notarization.
The operational answer is a calendar-driven, automated re-sign-and-re-push
pipeline that starts at ~90% of the profile's life, plus a standing rule that you
never let the distribution cert and the provisioning profile expire on the same
day, and you never revoke a cert that an in-flight fleet depends on.
A real operator hit exactly this: revoking the second enterprise cert
"immediately broke the application that was using it and it was no longer able
to be downloaded or opened."

> **Outage citation**
> - **Date:** 2020-02-06 (real-world MDM bricking; behavior documented continuously by Apple)
> - **Vendor / product:** Apple — in-house / enterprise distribution + provisioning profiles
>   (corroborated by a StackOverflow production report)
> - **URL:** https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web
> - **Root cause:** the in-house distribution provisioning profile hit its 12-month
>   expiry (and a related distribution-cert revocation), so devices could no longer
>   launch the app — the OCSP/profile check failed closed and the app stopped opening
>   across the fleet.
> - **Fix / status:** Apple requires issuing a new profile, re-signing the IPA with it,
>   and pushing the update through MDM before expiry; revoking a distribution cert
>   invalidates all apps signed with it, so the durable control is automated renewal
>   at ~90% of profile life.

---

## 3. Manifest tampering (CDN compromise, supply-chain, MITM)

The update **manifest** (`latest.yml`, `latest-mac.json`, a signed update list)
is a control-plane document: it tells the client *what* to download, *where*,
and — critically — what the artifact *should* hash to.
If the client trusts the manifest's hash, then **the manifest is the trust
root**, and a tampered manifest means you verify nothing.
There are three attack paths that all converge on the same question — "who am I
trusting the bytes to?" — and the answer differs for each.

**CDN / edge compromise:** the manifest and the artifact are served from a CDN
you rent.
A compromised edge node, a **subdomain takeover** of the update domain (the
classic: you spin down the update origin but the CNAME is left dangling, an
attacker registers the freed domain, and the dangling CNAME now points at their
server), or a poisoned cache entry will serve a malicious manifest.
The fix is not "use HTTPS" — HTTPS only proves the CDN presented a valid cert;
it does not prove the *content* is yours.
You must **sign the manifest with your code-signing key** (Authenticode / Apple /
APK v2) and have the client verify that *signature*, not just the hash, because a
forged hash in an untrusted manifest can simply be forged to match the malicious
artifact.

**MITM:** if the update channel is plain HTTP, or TLS with an over-broad
wildcard cert, or the client's trust store is weakened, an on-path attacker
swaps the manifest.
The fix is strict **key/cert pinning (SPKI pin + HSTS + a signed manifest)** —
pin the *key*, not the domain, so a renewed or mis-issued domain cert does not
open the door.

**Supply chain:** the CDN is clean and the manifest is legitimately signed by
*you*, but your build pipeline was compromised, so the signed manifest points at
a trojanized artifact.
No client-side check catches this short of **provenance** — SLSA, in-toto
attestations, reproducible builds, and a detached signature produced by an
isolated, attested signing step that is not the machine that built the bytes.

The meta-lesson, drawn from two real incidents, is that **signature verification
is necessary but not sufficient.**
A signature proves "the holder of this key approved these bytes."
It does not prove the holder was not compromised, or that these are the bytes
you *meant* to ship.
You need four things together: a signed manifest, a pinned signing key, a
provenance attestation that the bytes came from a clean build, and a **signed
revocation manifest** so you can recall a signed-but-bad artifact.
ASUS and CCleaner are the same class of failure viewed from two angles.

> **Outage citation**
> - **Date:** 2019-03-25
> - **Vendor / product:** ASUS Live Update — "Operation ShadowHammer" (Kaspersky)
> - **URL:** https://www.kaspersky.co.uk/about/press-releases/shadow-hammer
> - **Root cause:** threat actors compromised the official ASUS update server and used
>   stolen ASUS code-signing certificates to sign trojanized versions of ASUS Live
>   Update (June–Nov 2018), so the *channel and signature were legitimate* while
>   ~500k–1M users received a backdoor that then targeted ~600 hardcoded MAC addresses.
> - **Fix / status:** ASUS released Live Update v3.6.8 with multiple verification
>   mechanisms and end-to-end encryption plus a diagnostic tool; the durable control
>   is pinning the signing key, signing the manifest separately from the build, and
>   having a signed revocation path for a compromised-but-validly-signed artifact.
> - **Named companion incident:** CCleaner 5.33.6162 (2017-08-15, Avast/Piriform,
>   https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident) — the
>   build server itself was compromised (TeamViewer entry + a ShadowPad
>   `mscoree.dll` dropped on the build host), so a *legitimately signed* CCleaner
>   binary was trojanized and pushed to ~2.27M users; clean 5.35.4943 released, C2
>   taken down 2017-09-15. Same class: the signature was valid, the bytes were not.

---

## 4. Delta-update corruption (bsdiff / zsync / Courgette, signature mismatch on delta)

Delta patching (bsdiff/bspatch, zsync, Apple's Courgette, Play's patch protocol)
trades a full download for a computation: `patch + old_artifact → new_artifact`.
That introduces a brand-new corruption surface that full downloads do not have,
because now the correctness of the result depends on **two inputs matching
exactly** — the right base version *and* the exact old bytes — not just one
artifact.

The failure modes are specific and all of them produce **well-formed garbage**
rather than an obvious error.
**Base mismatch:** the patch is built against old = 1.2.0, but the device is
actually on 1.2.1 (it took a partial update, it is on a different channel, or a
rollback happened).
`bspatch` happily applies the patch to the wrong base and produces output that
is structurally a valid archive but is functionally corrupt — it will *install*.
The old version must be pinned in the patch metadata and the client must
**refuse to apply** if its base does not match, then fall back to a full download.

**Non-atomic application:** if the patcher is interrupted mid-apply (power loss),
the artifact on disk is now neither old nor new but a Frankenstein.
The patcher must apply to a *new* file, verify the **result**, and swap — exactly
the §1 discipline, except the source of truth for verification is the
*new artifact's* hash.
**Signature mismatch on the delta:** if you sign the full artifact but verify
only the delta (or sign the delta and verify the full), a corrupted or modified
delta slips through.
The correct model is: **sign and verify the final artifact's full hash**, and
after applying the delta, verify the *result* against the manifest's
full-artifact hash — never treat the delta's own hash as the final authority.
**Tool bugs:** `bspatch` has known trouble with large diffs and sparse files;
Courgette has its own failure modes (partly why Apple falls back to full
downloads for large updates).
A bad patch that *silently* produces wrong-but-valid-looking output is the worst
case of all.

The connective tissue to a real supply-chain incident is the insight that
**the "artifact" is whatever comes out of the pipeline, and a signature only
proves the key approved it, not that it is correct.**
SolarWinds is the canonical demonstration: the attacker did not need to break
the signature — they made the build *produce* the backdoor, so the signed
artifact was the backdoor.
The same logic applies to your delta pipeline: independently verify the final
artifact hash against a manifest produced and signed by a *different* system than
the one that built or patched the bytes, and keep a full-download fallback for
the moment any delta step fails.

> **Outage citation**
> - **Date:** 2020-12-14
> - **Vendor / product:** SolarWinds Orion — SUNBURST/TEARDROP (UNC2452), Mandiant 8-K
> - **URL:** https://www.sec.gov/Archives/edgar/data/1370880/000137088020000039/feye-20201213.htm
> - **Root cause:** UNC2452 compromised SolarWinds' build environment and used the
>   SUNSPOT implant to monitor `MsBuild.exe` and swap a source file
>   (`InventoryManager.cs`) with a SUNBURST-backdoored variant *during
>   compilation* (March–May 2020), so legitimate, SolarWinds-signed Orion updates
>   distributed the backdoor to customers via the official update channel.
> - **Fix / status:** SolarWinds secured the build pipeline, published a list of the
>   compromised signed-update hashes for customers to check, and C2 domains were
>   seized; the durable control for a delta pipeline is independent full-artifact
>   hash verification against an out-of-band signed manifest plus a full-download
>   fallback, never trusting the delta's self-reported hash.
> - **Named companion issue:** `electron-userland/electron-builder` #1081
>   (2017-01-04, https://github.com/electron-userland/electron-builder/issues/1081)
>   — leading bytes of a fast download were dropped before the digest pipe was
>   configured, producing `SHA2 checksum mismatch` on every build; a concrete
>   instance of "verify the final bytes, and only after the writer has actually
>   flushed."

---

## 5. Staged-rollout regret (kill switch too slow, 100% already deployed)

Staged rollout (ring/canary → 10% → 50% → 100%) is the only defense against
"we shipped something that bricks 100% of the fleet."
The hard part is that the **kill switch is a second, independent control plane
that must be faster than the blast radius of the first**, and in practice it is
almost always slower.
CrowdStrike is the textbook case, and it is worth dissecting precisely.

CrowdStrike delivers sensor updates in two tiers: **Sensor Content** (shipped
with the sensor binary, customer-controlled) and **Rapid Response Content**
(delivered as "Channel Files" over the air).
On 2024-07-19 at 04:09 UTC a Rapid Response Content update for
**Channel File 291** was pushed.
The root cause was a **bug in the Content Validator**: a new IPC Template Type
defined 21 input fields, but the integration code supplied only 20 to the
Content Interpreter, and the validator's test cases used a *wildcard* for the
21st field, so the mismatch passed validation, stress tests, and several prior
field deployments.
When the new channel file was loaded, the Content Interpreter read the 21st
input — an **out-of-bounds read** in kernel mode — that the "graceful exception
handling" was never designed to catch, producing a BSOD.
The blast was ~**8.5M Windows machines** (sensor 7.11+), and it was reverted at
05:27 UTC — but only after ~**78 minutes** in which essentially *all* in-scope
online sensors had already fetched it.

The design lesson is that **the content channel had no percentage gate.**
It went to 100% of online sensors at once, so there was no canary to read.
A real staged rollout has to be staged on the *content* channel too, not just the
binary.
And the kill switch has to do three independent things, because a single "stop
rollout" flag does none of them:
(a) **halt the ring** so no new device downloads;
(b) push a **"do not launch / fall back to last-known-good"** directive that the
client checks *before* launching the new build; and
(c) if the bad build is *already running*, signal it to self-rollback — which
only works if the client **kept the previous build on disk**, a direct conflict
with "save disk space."
The deeper truth is that you **cannot un-ship**: once the bad build is on a
device, recovery is either a hotfix pushed through the same (possibly suspect)
channel, or the device falling back to a kept last-known-good.
That is why the "keep the previous build" rule and a *separate, always-on
rollback channel independent of the update channel* are non-negotiable.

> **Outage citation**
> - **Date:** 2024-07-19
> - **Vendor / product:** CrowdStrike Falcon sensor — "Channel File 291" incident
> - **URL:** https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/
> - **Root cause:** a bug in the Content Validator let a Rapid Response Content
>   Template Instance with 21 input fields pass validation when the sensor only
>   supplied 20, causing an out-of-bounds read in the kernel-mode Content
>   Interpreter → BSOD on ~8.5M Windows sensors, all of which had received the
>   content within a ~78-minute window before it was reverted.
> - **Fix / status:** the channel file was reverted at 05:27 UTC on 2024-07-19;
>   runtime bounds checks were added 2024-07-25; a sensor hotfix reached GA by
>   2024-08-09; ~99% of Windows sensors were back online by 2024-07-29. Durable
>   controls: stage the *content* channel in rings, gate 100% on crash-rate
>   telemetry, and keep an independent rollback channel.

---

## 6. PWA service worker caching the old shell (controller race, skipWaiting trap, OOB cache)

A PWA's service worker is a **persistent, out-of-band cache controller** that
lives outside your app's code path and survives app restarts, browser crashes,
and — crucially — your deploying new code.
The update failure is subtle because nothing errors out: deploys succeed, the
new code works for the author, the console is clean, and the server logs look
fine.
The affected browsers are just quietly serving cached HTML, JS, and CSS instead
of requesting the newly deployed files.

The mechanism has three interlocking parts.
**The SW URL is the identity:** the browser only re-fetches `sw.js` when the
*bytes* of that URL change (byte-for-byte) and it is not served from the HTTP
cache (browsers enforce that service-worker responses are not cached).
If you ship a new app shell but leave `sw.js` byte-identical — same version
string, no cache-bust — **no new SW installs** and users keep the old one,
potentially for weeks.

**The skipWaiting / activate race:** by default a new SW stays in the "waiting"
state until *every* client it would control closes; "reload" does **not** move it
to activated — the tab must be *closed* (this is the exact trap in Workbox issue
#1528).
If you *do* call `skipWaiting()` to force activation, you must also clean the
caches in `activate` and call `clients.claim()`; otherwise you hit the
**out-of-band cache** bug: the new SW is active but the old precache still holds
the old `index.html`, which references old hashed asset names that were
*already deleted* from cache, so the app is broken on reload.

**The controller race:** even with a correct SW, a tab that loaded before the
new SW claimed it is still controlled by the old one until it is navigated,
which is why some users see stale behavior for days.

The only reliable unbreak is to deploy a **minimal no-op service worker at the
same `sw.js` URL** — `install` → `skipWaiting()`, `activate` → enumerate caches
and delete them all,
`self.clients.matchAll({ type: 'window' }).forEach(c => c.navigate(c.url))`, and
**no `fetch` handler** (so requests pass straight through to the network) — then
deploy the real worker later.
If you change the SW URL, the old buggy worker runs *alongside* the new one and
the problem persists.
The deep problem is that **the SW is a second, slower, independent deployment
target that your CI/CD does not own.**
You must version it, treat its URL as a contract, ship a kill-switch no-op worker
in the same pipeline, and make `index.html` `no-cache` so the shell is never
served stale.

> **Outage citation**
> - **Date:** 2026-09-21 (production report; published 2026-10-14)
> - **Vendor / product:** a production PWA (reported via OpenPWA)
> - **URL:** https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/
> - **Root cause:** the service worker kept serving a cached old app shell for three
>   weeks because `sw.js` was left byte-identical (so no replacement worker
>   installed), and when a replacement did arrive it entered the "waiting" state
>   and a user with an open tab stayed under the earlier worker — the OOB cache
>   then held a stale `index.html` referencing already-deleted hashed assets.
> - **Fix / status:** deployed a one-time no-op/kill-switch SW
>   (`skipWaiting` + delete all caches + `unregister()` + navigate all open
>   clients), followed by a minimal SW with no `fetch` handler; the durable
>   controls are a cache-busted SW URL, a no-op worker in the pipeline, and
>   `no-cache` on the shell.
> - **Named companion sources:** `GoogleChrome/workbox` #1528
>   (https://github.com/GoogleChrome/workbox/issues/1528) — "index.html cached in a
>   bad state when service worker updates"; Chrome/Workbox "remove buggy service
>   workers" (https://developer.chrome.com/docs/workbox/remove-buggy-service-workers)
>   — the no-op worker remedy and the "keep the SW URL unchanged" warning.

---

## 7. iOS App Store vs enterprise distribution (TestFlight latency, review, MDM, sideload)

iOS has **three fundamentally different distribution and trust models**, and
"auto-update" means something different in each — which means your "update
channel" is really three channels with three clocks, three latency profiles,
and three different "is the user even on the version I think they're on"
observability gaps.

**App Store:** the only path to a device with zero user action, gated on
**human review** (hours to days, and *re*-review on every update) and on
**TestFlight** for beta.
TestFlight has a **90-day build expiry**, an **10k external-tester cap**, and —
critically — TestFlight builds are *not* the production install: when you
promote to the App Store, testers receive a *different* binary and must
re-consent.
So your "canary fleet" silently drifts: testers sitting on a 60-day-old
TestFlight build are not representative, and a TestFlight build that was fine can
fail App Store review and stall the wide release.
You **cannot** do a true percentage-based staged rollout on the App Store —
Apple gates the release — so your effective staged rollout is "TestFlight rings →
App Store wide release," which is coarser and slower than your desktop rollout.

**Enterprise / in-house (Apple Developer Program Enterprise):** no App Store,
push through your own MDM.
But per §2 the **provisioning profile expires in 12 months** and the
**distribution cert in 13 months**, and the app **won't launch** when either
lapses — so enterprise "auto-update" is really "auto-*re*-sign and re-push before
the clock runs out," and the rollout pace is your MDM's, not Apple's.

**Sideload on personal devices:** Ad-Hoc caps at **100 registered devices per
year**, and a free personal developer sideload **expires every 7 days** — neither
scales, and both are fragile (every device must be in your provisioning set).

The hard problem is that **there is no single update primitive across these
three.**
The sharpest recent example is the retirement of the one service that let you
*bypass* the App Store for JS-bundle changes: Microsoft's App Center CodePush.
CodePush's entire value on iOS was out-of-store hot updates; its retirement
removed that path and forced iOS (and Android) React Native apps either back into
the App Store / Play review round-trip for JS changes, or onto self-hosting
`code-push-server` (which Microsoft also archived) or a third-party replacement.
If a chunk of your iOS update strategy rides on an out-of-store hot-patch
channel, the single biggest unpriced risk is that **the channel's vendor
disappears.**

> **Outage citation**
> - **Date:** 2025-03-31
> - **Vendor / product:** Microsoft — Visual Studio App Center / CodePush (retirement)
> - **URL:** https://github.com/microsoft/react-native-code-push/
> - **Root cause:** Microsoft retired Visual Studio App Center on 2025-03-31, and
>   CodePush with it, removing the out-of-App-Store JS-bundle hot-update channel;
>   every app relying on it lost its non-store update path and had to either ship a
>   store round-trip release or migrate to a self-hosted / third-party CodePush
>   server.
> - **Fix / status:** the `react-native-code-push` repo and the standalone
>   `code-push-server` repo
>   (https://github.com/microsoft/code-push-server/) are both archived; migration
>   guidance points to Expo Updates or a maintained fork. Durable control: never
>   make an out-of-store hot-patch channel a single point of failure, and pin a
>   migration path before the vendor announces a retirement.
> - **Named companion:** Apple in-house distribution clocks
>   (https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web)
>   — 12-month provisioning profile, 13-month distribution cert, OCSP validation,
>   "app won't launch" on expiry; this is the third clock your MDM must service in
>   parallel with the App Store.

---

## 8. Mac notarization (notarytool, stapling, hardened runtime, Gatekeeper)

macOS distribution outside the App Store is **two separate checks that people
constantly conflate**:
(1) the **Developer ID signature** (proves identity + integrity, checked
locally, no network needed), and
(2) **notarization** (Apple's automated scan, checked online or via a stapled
ticket).
An app can be validly signed and still fail Gatekeeper because it is not
notarized, and a notarized app can still be blocked if the ticket is missing,
the **hardened runtime** is off, an embedded framework is unsigned, or the file
**changed after notarization** (a resource added or a re-sign invalidates the
ticket — Gatekeeper stops recognizing the app).

The tooling moved under developers, which is the operational trap.
Apple **stopped accepting notarization uploads from `altool` and Xcode 13 or
earlier on 1 November 2023** — you must use `xcrun notarytool` (or a current
Xcode).
Any CI pipeline still on `altool` stopped producing notarization tickets
overnight, which meant signed-but-unnotarized DMGs that Gatekeeper rejects with
"cannot be opened" or "Apple cannot check it for malicious software."
The correct pipeline is: sign with Developer ID + **hardened runtime** + a
**secure timestamp** (and `com.apple.security.get-task-allow` must not be true
in the distributed build) → `xcrun notarytool submit --wait` → read the log (a
single missing timestamp or missing hardened runtime returns "Invalid") →
**staple** the ticket to the *final* artifact with `xcrun stapler` (you staple
the app, DMG, or PKG; a ZIP cannot be stapled directly — staple the app inside,
then re-zip) → `xcrun stapler validate`.
The `com.apple.security.get-task-allow` entitlement is the other silent killer:
if it is `true` (a debug setting), notarization fails.

The deep problem is that **notarization is a property of the exact bytes as
submitted**, and it is easily invalidated by the same "change after signing"
mistake that breaks §1 and §4 — a post-notarization re-zip, an added resource, or
a re-sign voids the ticket.
And Gatekeeper's "app is damaged" / "cannot be opened" message is a *symptom*
with multiple causes (incomplete download, broken signature, missing staple,
missing hardened runtime, revoked cert), so your on-call runbook has to
distinguish them rather than reflexively telling the user to "Open Anyway."
Stapling matters specifically because it lets Gatekeeper verify **offline** — an
app distributed to a device that cannot reach Apple still launches, whereas a
non-stapled app on an air-gapped or restricted network fails the online check.

> **Outage citation**
> - **Date:** 2023-11-01
> - **Vendor / product:** Apple — notarization tooling deprecation
>   (`altool` / Xcode ≤13 no longer accepted)
> - **URL:** https://www.bynilson.ch/en/launch-with-me/macos
> - **Root cause:** on 1 November 2023 Apple stopped accepting notarization uploads
>   from `altool` and Xcode 13 or earlier, so Mac-app build pipelines still on
>   `altool` stopped producing notarization tickets and shipped signed-but-
>   unnotarized artifacts that Gatekeeper blocks ("damaged" / "cannot be opened" /
>   "Apple cannot check it for malicious software").
> - **Fix / status:** migrate CI to `xcrun notarytool submit --wait`, enable the
>   hardened runtime with a secure timestamp, staple the ticket with `xcrun
>   stapler` (validate with `xcrun stapler validate`), and keep
>   `com.apple.security.get-task-allow` false; a file changed after notarization
>   voids the ticket, so notarize and staple the final bytes.

---

## 9. Android APK Signature Scheme v2/v3/v4 mismatches (downgrade attacks)

Android's signature scheme is not just integrity — the signing block
**is also the rollback and downgrade control**, and that dual role is exactly
what makes it a hard shipping problem.
**v1** (JAR signing) is per-file and slow;
**v2** (API 24+) signs the whole APK and is required for *installation via
ADB/sideloading* on Android 7+, so a **v2-only** APK that is not built for v2
fails to install on modern devices and a **v1-only** APK is installable only on
legacy targets.
**v3** (API 28+) adds **key rotation** via a *proof-of-rotation* block (a
singly-linked list of prior signing certs, each signing the next, so a new key
inherits the trust of its predecessors) and per-SDK rollback capability.
**v3.1** (API 33) fixes rotation edge cases (SDK-version targeting, rollback
capability semantics).
**v4** (API 33+) is a *verification-only* scheme that does not modify the APK
(used for App Bundle / split installs and pre-verification).

The hard part is the **downgrade attack and the "strip the block" failure.**
An attacker who cannot break your signature can still try to get a device to
*install an older, vulnerable version* by stripping the higher-scheme signing
block so the device falls back to an older (or weaker) scheme it will accept.
AOSP's defense, and your constraint, is that the platform **rejects installation
if a required signing block has been stripped** — the v3.2 doc states the
platform "rejects the installation to prevent a downgrade attack" when a block is
missing.
Practically this produces install failures that look like "incompatible" or
"different app" to the user: a **v3-only** app whose v3 block was tampered with
will not install; an app that **rotated its signing key** without a proper
proof-of-rotation lineage will fail `checkSignatures` for apps it communicates
with; and a device on an older Android that ignores v3 will try v2 then v1, so
your APK must contain **every block the floor of your minSdk requires** — a
v3-only APK breaks the v2-install path on the oldest devices you still support.

The connective discipline: **sign with the newest scheme your minSdk allows,
include all lower blocks you must, and never rotate a key without a
proof-of-rotation lineage** (Play App Signing absorbs this so your team does not
have to manage it).
The "v3-only vs v4-only installer" trap is that **v4 is verification-only** —
you cannot ship a *v4-only* installer, because v4 does not sign the APK; a v4
signature must coexist with a v2/v3 signing block.
So "which installer do I ship?" has a precise answer: ship v2 + v3 (and v3.1 if
you rotate), use v4 for the bundle/verification path, and let the platform's
strip-rejection be your downgrade guard.

> **Outage citation**
> - **Date:** 2024-10-15 (Android 15 / API 35, which carries the v3.1/v3.2 downgrade-attack controls)
> - **Vendor / product:** Google / Android Open Source Project — APK Signature Scheme v3 / v3.2
> - **URL:** https://source.android.com/docs/security/features/apksigning/v3-2
> - **Root cause:** a downgrade attack strips the higher-scheme signing block
>   (v3/v3.2) to make a device accept an older, weaker, or vulnerable signing
>   scheme; the failure mode is that an APK whose required signing block is missing
>   or whose rotation lineage is invalid is rejected at install, which presents to
>   users as an "incompatible / different app" install failure rather than a
>   signature error.
> - **Fix / status:** AOSP rejects installation when a required signing block is
>   stripped; the durable control is to sign with the newest scheme your minSdk
>   allows, include all lower blocks the floor of your support range requires, use
>   v3 proof-of-rotation for any key rotation (v3.1 for rotation edge cases, v4 as
>   the verification-only path for bundles), and prefer Play App Signing so the
>   platform, not you, owns the key.

---

## 10. Cloudflare Worker version rollback after a buggy deploy (KV state, DO state, route propagation)

Rolling back a Cloudflare Worker sounds like a one-liner — `wrangler rollback`
swaps the active version — and the docs are explicit that a rollback
"immediately create[s] a new deployment with the version specified and become[s]
the active deployment across all your deployed routes and domains."
The hard part is that **the code you roll back is only one half of the state
machine.**
The other half — **Workers KV**, **Durable Objects**, **R2**, cached edge
config, and the *route/progressive-deployment* machinery itself — is versioned,
partitioned, and propagated independently, and a rollback of the Worker code does
not, by itself, roll back or reconcile any of it.

The canonical real failure is the **2023-10-30 Cloudflare incident**, which is
precisely a "rollback after a buggy deploy" that went wrong.
A **Workers KV** team began a *progressive* deployment of a new KV build.
At 19:29 UTC the internal progressive-deployment API **returned a staging build
GUID in response to a "list production builds" call**, so the rollout continued
by routing a percentage of production traffic to the *staging*
(unauthorized-for-production) build, which returned **HTTP 401** — making
Workers KV unreachable in production.
Because KV is used by so many internal systems, the failure cascaded to
**Pages, Access, WARP, Turnstile, Waiting Room, and the dashboard** (37 minutes
of impact).
The critical detail for this problem: **the automated rollback via the same
progressive-deployment API also failed** — the API was the thing that was
misconfigured — so engineers had to **manually edit the production route via a
break-glass mechanism** to revert to the last known-good build, and only then did
error rates normalize.

Two later incidents reinforce the pattern:
the **2025-02-10** "Workers Builds & Workflows" incident
(https://www.cloudflarestatus.com/incidents/bhsk2l01d5pm) where *deploying* new
Workflows / initializing new Workers Builds failed, and the **2025-11-18** outage
where a single bad **config/feature file** doubled in size and was **propagated
to all machines** — resolved by *stopping the propagation and restoring a
previous version of the file*, i.e. a config-file rollback, not a Worker-code
rollback.

The engineering takeaway is that **a Worker rollback is not atomic with its
state.**
You must:
(a) treat **Durable Objects** state as durable-across-versions (a DO instance
created by version N keeps its state after you roll to version N-1, so your code
must be *forward- and backward-compatible* with the schema, or you get "state on
the wrong version" bugs that a code rollback does not fix);
(b) treat **KV / edge config** as a separately-propagated artifact with its own
rollback, and make sure the *control plane that performs the rollback is not the
same misconfigured component*;
(c) use **break-glass manual route overrides** as a first-class runbook step,
because the automated path is exactly the path that can be broken; and
(d) never let a single bad **config file** propagate to all edge machines without
a "stop propagation + restore last-known-good" control.
The Worker is the code; the fleet's *state* is the thing you actually have to
roll back.

> **Outage citation**
> - **Date:** 2023-10-30
> - **Vendor / product:** Cloudflare — Workers KV progressive-deployment incident
> - **URL:** https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/
> - **Root cause:** a misconfiguration in the progressive-deployment tool caused
>   the internal API to return a *staging* build GUID for a "list production builds"
>   call, routing a percentage of production Workers KV traffic to an unauthorized
>   build (HTTP 401), which made KV unreachable and cascaded to Pages, Access, WARP,
>   Turnstile, and the dashboard; the automated rollback through the same API failed,
>   forcing a manual break-glass route revert.
> - **Fix / status:** engineers manually switched the production route to the previous
>   known-good build via a break-glass mechanism, eliminating the failing path;
>   impact was 37 minutes (18:58–20:31 UTC). Durable controls: keep the rollback
>   control plane independent of the component being rolled back, make DO/KV state
>   version-tolerant, and have a stop-propagation + restore-last-known-good path
>   for config/edge files.
> - **Named companion incidents:** Cloudflare status 2025-02-10 "Workers Builds &
>   Workflows" (https://www.cloudflarestatus.com/incidents/bhsk2l01d5pm) —
>   deploying/initializing builds failed; Cloudflare 2025-11-18 outage
>   (https://blog.cloudflare.com/18-november-2025-outage/) — a bad Bot Management
>   config file doubled in size and propagated to all machines, fixed by stopping
>   propagation and restoring a prior version.

---

## Cross-cutting: the four invariants that close all ten gaps

1. **Verify the final bytes against an out-of-band signed manifest, after the
   writer has flushed, before any swap.**
   This closes §1 (partial), §3 (manifest), §4 (delta), §8 (notarized-bytes-
   changed), and §9 (signing block).
   The signature proves identity; the independent hash proves *these* bytes; the
   manifest proves *this version*.

2. **Keep a last-known-good and an independent rollback channel.**
   §5 (CrowdStrike) and §10 (Cloudflare) both show that the recovery path must be
   a *separate* control plane from the one that ships the bad thing, and that the
   "kept" previous artifact is the only thing that lets a device that already ran
   the bad build self-heal.

3. **Treat every trust anchor as a clock with a 90% tripwire.**
   §2 (provisioning profile 12mo / cert 13mo / EV cert), §7 (TestFlight 90-day /
   personal 7-day / CodePush retirement), and §8 (altool cutoff) are all "a
   vendor or a CA changed a deadline and your fleet found out at launch."

4. **Pin keys, not domains; stage content, not just binaries; version the SW and
   the Worker's state, not just the code.**
   §3 (pin the signing key), §5 (stage the *content* channel in rings), §6 (SW
   URL is a contract), and §10 (DO/KV state is versioned and propagated
   independently) all reduce to: the thing you think you are shipping and rolling
   back is a *subset* of the thing that is actually live on the fleet.

**Sources** are the vendor post-mortems and platform docs cited inline:
CrowdStrike (Falcon Content Update PIR + Channel File 291 RCA), Kaspersky
(ShadowHammer), Avast (CCleaner APT series), Mandiant/FireEye (SolarWinds 8-K +
SUNSPOT analysis), Apple (in-house distribution guide), Google/AOSP
(signature-scheme docs), electron-userland/electron-builder (issues #1081,
#1492, #3171, #9504), GoogleChrome/workbox (#1528 + no-op SW doc), Microsoft
(react-native-code-push + code-push-server), Cloudflare (2023-10-30, 2025-02-10,
2025-11-18), and OpenPWA (three-weeks stale-SW production report).
All URLs were verified against live sources as of 2026-11-05.
