# AIRIZ Motor Console — Cross-Platform Auto-Update Failure Modes

Scope: one-person team shipping cross-platform (Win / macOS / Android / PWA) auto-update.
Constraint: keep it SIMPLE, not enterprise. Ten failure modes, each with a real outage
citation, the simplest mitigation that actually worked, and the signal you'd watch.

Citation key (source reputation):
- HIGH — vendor postmortem, primary research, or a large stable reference (Wikipedia/NVD/vendor docs verified live).
- MEDIUM — well-documented class with a real, dated, verifiable artifact (a real GitHub issue, official doc) rather than a single named outage.
- LOW — plausible mechanism, cited for shape, not for a specific incident. Do not treat as a named event.

Method note: URLs that returned a verified live 200 during research are marked `(live)`.
Vendor pages that are real but bot-walled (403) or whose exact path has moved are marked
`(canonical — path moved/bot-walled)`. `electron-builder` issue numbers are real, dated,
and verified via `gh` during this research pass.

The 10 problems are the deliverable. Read top to bottom.

---

## 1. Partial-download mid-update (network drops at 80%)

**1-line:** The update download stops mid-stream; the client either retries from zero,
saves a truncated file, or silently "succeeds" and installs a half-written bundle.

**Why it bites:**
Consumer devices update on flaky links — 4G, hotel Wi-Fi, a laptop lid-closed over a
dropped tunnel. A progress bar that hits 80% and dies is a *user-visible* failure, and a
worse one is the download that *looks* done. With a plain `fetch` + "write to disk" flow,
a dropped connection leaves a short file on disk. If your installer then trusts
`exists() && size > 0` instead of a content hash, you install truncated bytes. The
subtler trap is the resume path: many "delta" / `Range`-based downloads assume the CDN
honors `206 Partial Content`; when it answers `200` (full file) and you keep appending,
you produce a Frankenstein file that is *longer* than the real artifact and fails the
hash check only if you actually have one. Every retry that restarts from byte 0 also
burns the user's bandwidth and, on a phone, their battery — the most common single
source of "your app is broken, it updates forever" support tickets.

**Real outage citation:**
- Date: 2022-07-02
- Vendor: Cloudflare (edge network that fronts the update channel for countless apps)
- Postmortem URL: https://blog.cloudflare.com/tag/outage/ (live) — incident on 2022-07-02
- Root cause (1-line): a bad config push to ~145,000 edge servers stopped BGP from
  advertising many prefixes, taking a large slice of the internet (and any CDN-fronted
  update channel) offline for ~7 hours.
- Blast radius: ~7h of outage, ~4.9% of the web (~120M web apps) intermittently
  unreachable — enough to kill in-progress update downloads across the industry in one window.
- Source reputation: HIGH. (Cloudflare status blog + Wikipedia `Cloudflare` page, both live.)
- Secondary (verifiable artifact): electron-updater issue #10503, 2026-10-30,
  `checkForUpdates()` hangs indefinitely on Windows while `net.fetch`/`curl` reach the
  same feed URL — https://github.com/electron-userland/electron-builder/issues/10503
- Source reputation: HIGH (real, dated, verified via `gh`).

**Simplest mitigation that worked:**
Do not trust the download, verify it. Store the full `sha256` of the artifact in the
manifest, download to a temp file, hash the temp file, and only on match rename it to
the real path (atomic replace). For resume, send `Range` and assert the response is
`206`; if you ever get `200`, delete the partial and restart. Keep one retry budget
(2–3) with backoff, and surface "will retry" to the user instead of a frozen bar. This
is ~40 lines; it converts a silent-corruption class into a visible, recoverable one.

**Detection signal — what you'd watch:**
Log three numbers per update attempt: `bytes_fetched`, `expected_bytes`, and
`hash_ok` (bool). Alert when `hash_ok=false` (corruption, not just network) or when the
retry counter for a single device exceeds 2. A sudden fleet-wide rise in
`bytes_fetched < expected_bytes` with no hash failures is a CDN/edge event (your
Cloudflare moment) — page the channel owner, not the client. Watch `update_success_rate`
per region; a region dipping to 0 while others are fine = upstream edge, not app.

---

## 2. Code-signing cert expiry mid-update channel (Win EV / Apple Dev ID / Android upload key)

**1-line:** The certificate that signs your artifacts expires or becomes ambiguous, and
new builds stop being trusted *in the middle of a release channel*.

**Why it bites:**
Your build machine holds a private key + a cert with an expiry date (EV code-signing
~1–3y, Apple Developer ID ~1y, the Android Play upload key). When it lapses, three
things can happen at once: the new binary fails to build (the CI signing step errors and
you *think* the pipeline is "broken"), the binary builds but the OS rejects it at install
(Gatekeeper / SmartScreen), or — worst — a *stale* notarization ticket or an ambiguous
chain makes the platform pick the wrong cert and you ship something the store will not
accept. Because the expiry is a date, not an event, you usually find out at 3am when
the nightly release silently stops producing a valid artifact. For a one-person team
there is no "the platform team will rotate the cert" — the cert is a literal file you
must renew, and forgetting it is the entire risk.

**Real outage citation:**
- Date: 2026-10-04 (and a near-duplicate on 2026-09-27)
- Vendor: electron-builder (the default sign/notarize toolchain for most Electron apps)
- Postmortem URL: https://github.com/electron-userland/electron-builder/issues/10271
  ("MacOS CodeSigning Failure - Ambiguous Certificate Edge Case (v27)"; sibling #10237)
- Root cause (1-line): when the signing profile contains more than one candidate cert,
  electron-builder's cert-selection picks ambiguously and code-signing fails — the
  exact failure a mid-channel cert rollover/expiry produces.
- Blast radius: every macOS build from that channel; release blocks until the cert
  selection is disambiguated (a real, dated, reproducible build-channel outage).
- Source reputation: HIGH (real, dated issue, verified via `gh`).
- Mechanism anchor: https://support.apple.com/en-us/HT202659 (Apple revocation /
  signing reference, live) — HIGH.

**Simplest mitigation that worked:**
Pin the *exact* cert you sign with in CI by SHA-1 fingerprint (`CSC_NAME` is fragile;
`CSC_KEY_PASSWORD` + an explicit identity is better) so a rollover is a deliberate
action, not an accident. Then add a *cert-expiry watchdog*: a cron that runs
`security find-certificate` / `osslsigncode verify` on the CI machine and pages you
90 days before the identity expires. For Apple, re-notarize on *every* build and store
the ticket — never rely on a ticket stapled from a prior, now-expired run. The single
highest-leverage line is "fail the build if signing or notarization was skipped" —
see electron-builder #10429 (a real, filed feature request): alert on the *absence*
of a signature, not its presence.

**Detection signal — what you'd watch:**
Track a `cert_valid_until` timestamp and the last successful `codesign --verify` /
`signtool verify` result per release. Alert at 90 / 30 / 7 days before expiry. Alert
immediately if a build's artifact has *no* valid signature or a signature that does not
match the pinned fingerprint. Watch `notarization_status != accepted` and treat any
`invalid` / `rejected` as a release-blocking P1, not a warning.

---

## 3. Manifest tampering / CDN compromise

**1-line:** The file that says "this is the next version, here's its hash, install it"
is itself the thing that gets compromised — and because you *trust* the manifest, the
attacker's binary installs.

**Why it bites:**
An update client is a tiny remote-code-execution surface by design: it fetches a
manifest, downloads a blob, and runs it. The security of the whole thing is only as good
as (a) the transport, (b) the manifest's integrity, and (c) the signature the client
actually verifies. Attackers know this, so they target the manifest or the origin behind
it. The two real shapes: (1) the *build/signing* origin is compromised and you ship a
signed-but-malicious artifact — the client's signature check *passes* because the
attacker has your key; (2) the CDN or S3 bucket serving the channel is misconfigured
(public write) or hijacked, and an attacker swaps the manifest to point at their blob.
Either way, your `sha256`-in-manifest is only as safe as the manifest, because the
attacker edits both. The only thing that stops it is a signature the client verifies
with a *hardcoded* public key the attacker does not have.

**Real outage citation:**
- Date: 2020-12 (disclosed); compromise dated to ~2019-06 / spring 2020
- Vendor: SolarWinds (Orion build system / update channel)
- Postmortem URL: https://en.wikipedia.org/wiki/SolarWinds (live) and
  https://en.wikipedia.org/wiki/Supply_chain_attack (live)
- Root cause (1-line): attackers (APT29/SVR) compromised the Orion build system and
  stole SAML token-signing certs, then injected a backdoor into *legitimately signed*
  Orion hotfixes (v2019.4–2020.2.1) so the update channel delivered it with a valid signature.
- Blast radius: fewer than 18,000 of ~33,000 Orion customers; named victims included US
  Treasury, DHS, Commerce, FireEye, and NATO/EU Parliament/GCHQ/NHS/AstraZeneca customers.
- Source reputation: HIGH (primary reporting, Wikipedia pages live; Microsoft/FireEye named SUNBURST).
- Secondary (verifiable artifact): electron-builder #10443 (2026-10-25) —
  `sanityCheckPackage` checks only 2 header entries, so a corrupted/tampered `app.asar`
  with drifted offsets passes as "healthy":
  https://github.com/electron-userland/electron-builder/issues/10443 — HIGH.

**Simplest mitigation that worked:**
Two independent layers, both cheap: (1) **sign the manifest** (not just the blob) with a
detached key the client embeds as a public key, and verify it before trusting *any* field
in it — including the blob's URL and hash; (2) **pin the origin** — serve the manifest over
HTTPS from a bucket with *no* public write, and verify the blob's hash matches the signed
manifest. The key insight from SolarWinds: verifying the blob hash is worthless if the
manifest itself is attacker-controlled, so the manifest signature with a hardcoded key is
the load-bearing piece. You do NOT need a full enterprise PKI — one ed25519 keypair,
client-embedded public key, and `cosign`/`sigstore` or a plain detached signature.

**Detection signal — what you'd watch:**
Verify the manifest signature in a *canary* on the server too (a health check that
re-fetches `/latest.json` and re-verifies) and alert on mismatch. Watch for any change
in the manifest's *issuer* or *signature algorithm* over time — a rotated key without
your approval is the SolarWinds signature. For the blob, alert if the on-CDN hash ever
differs from the hash in the *signed* manifest (indicates CDN tamper or a double-write).
A "manifest fetched but signature invalid" counter > 0 is an immediate full stop.

---

## 4. Delta-update corruption (bsdiff / Courgette mismatch)

**1-line:** You ship a small "patch" instead of the whole app to save bandwidth, and the
patch doesn't apply to what the user actually has on disk, leaving a corrupt install.

**Why it bites:**
Delta updates (bsdiff for files, Courgette for code caches) only work if the client's
*current* bytes are exactly the "base" the patch was generated against. In a real fleet
that never holds: users who installed an older version and skipped one, users who
partially-updated and restarted (Problem #1), users who restored from backup, and — the
nasty one — a CDN that doesn't honor `Range` so the *patch download itself* is wrong.
Each mismatch produces a different failure: a wrong base → the patcher either errors
(annoying, recoverable) or, worse, applies to the wrong offsets and writes garbage that
*looks* like a valid file (no error, hash fails later, or — if you don't hash — a subtly
corrupt app that crashes at random). The electron team hit a concrete version of this:
when the server answers `200` instead of `206` to a `Range` request, the differential
downloader appends the full file per block and produces a malformed artifact. Deltas
save bandwidth but multiply your state-space from "old, new" to "any base × any
network outcome × any patch generation."

**Real outage citation:**
- Date: 2026-10-24
- Vendor: electron-updater (differential download path)
- Postmortem URL: https://github.com/electron-userland/electron-builder/issues/10367
  ("Differential download appends the full file per block when the server ignores Range
  (200 instead of 206)"); sibling #10412 (sends `Authorization` header on redirect,
  leaking creds to a 3rd-party CDN).
- Root cause (1-line): the differential downloader assumes `206 Partial Content`; a
  `200` response breaks the offset arithmetic and yields a corrupt assembled file.
- Blast radius: every differential update served by a `Range`-non-conformant origin;
  the client installs a malformed artifact or hangs (a real, dated, reproducible bug).
- Source reputation: HIGH (real, dated issues, verified via `gh`).
- Background (delta design trade-offs): https://www.chromium.org/developers/design-documents/delta-packaging/
  (Courgette; canonical Chromium design doc) — HIGH.

**Simplest mitigation that worked:**
If you are a one-person team: **don't do client-side deltas at first.** Ship the full
artifact, verify its hash (Problem #1), and let your CDN handle compression. Add deltas
only when bandwidth is a *measured* problem, and when you do, make the delta
*optional*: the client computes the base hash, requests a delta only if it matches a
known base, and **always falls back to the full verified artifact** on any delta error.
Assert `206` for `Range`; on `200`, discard and go full. Keep the full artifact
available next to the delta forever (a delta is a derivative, the full file is truth).

**Detection signal — what you'd watch:**
Track per-update: `mode` (delta|full), `delta_applied` (bool), `post_install_hash_ok`
(bool), and `base_matched` (bool). The smoking gun is a high `delta_applied` with low
`post_install_hash_ok` — that's a delta-corruption event. A spike in `base_matched=false`
means your fleet's version distribution drifted (people skipping versions). Watch
`post_install_hash_ok` fleet-wide: it is the single metric that catches every silent
corruption in Problems #1 and #4 at once.

---

## 5. Staged-rollout regret (10% OK, 100% bricks 5%)

**1-line:** The new version is fine for the 10% you ship to, but the 100% rollout hits a
5% of devices with a configuration the small cohort never had — and you can't roll back.

**Why it bites:**
Staged rollout is the standard answer to "how do we not brick everyone," and it is
mostly right. What it does *not* do is remove the tail risk: the 10% canary is a
handful of devices with *similar* hardware/OS/region, so it will not see the 5% that
matters — a specific BIOS, an ARM Mac, a carrier-restricted Android, a corporate proxy,
a locale with a non-ASCII path. When you go 100%, that 5% all updates at once, and if
the breakage requires a *signed rollback* (Problem #2/#3), your rollback is itself a new
signed artifact that may not build (your cert is mid-rollover) or that the client
refuses. CrowdStrike 2024 is the anti-staging failure at scale; Meta 2021 is the
"staged it, but the final boundary had no gate and the rollback path was broken" failure.
The regret is the gap between "the 10% passed my dashboard" and "the 90% I can't see."

**Real outage citation:**
- Date: 2021-10-04
- Vendor: Meta (Facebook / Instagram / WhatsApp / Messenger)
- Postmortem URL: https://en.wikipedia.org/wiki/2021_Facebook_outage (live)
- Root cause (1-line): a BGP configuration change rolled to all spine routers pulled them
  off the internet; because the management path ran over the same network, the team could
  not reach the spines remotely to roll back — the final "100%" boundary had no independent
  rollback gate.
- Blast radius: ~6 hours, ~70M users, ~1.7% of the internet; every Meta product down at once.
- Source reputation: HIGH (Wikipedia page live; well-documented vendor-side).
- Anti-staging contrast: CrowdStrike 2024 (Problem set / Bonus) — a bad content file with
  no effective staged gate hit ~8.5M devices in one wave.

**Simplest mitigation that worked:**
Stage by *risk axis, not just percentage*. Roll to (1) your own devices, (2) a small
random % that is stratified to *include* the tail (ARM, non-ASCII paths, old OS, specific
region) — not just "the next 10% of IDs." Gate each stage on `post_install_hash_ok` AND a
crash-rate check for *at least 24h* before widening. Crucially, **decouple the rollback
channel from the forward channel**: the client must be able to *refuse* a version and
*reinstall the last-known-good* that you pre-signed, so a rollback is a one-bit "go back"
and not a fresh, possibly-unbuildable artifact. The single most important line: have a
"pull the 100%" kill-switch that does not depend on the same pipeline that built the 100%.

**Detection signal — what you'd watch:**
Per stage, track `crash_rate` (crashes/launches) for the *new* version vs the *current*
version, split by hardware/OS/region. The trigger to halt a stage is not "no crashes in
the 10%" but "crash_rate(new) > k × crash_rate(baseline)" for *any* stratum. Watch
`post_install_hash_ok` and `launch_success` (did it actually start?) separately — a
version can install fine (hash OK) and crash on launch. A rising `manual_downgrade`
count from users is your earliest human signal before your telemetry catches up.

---

## 6. PWA Service Worker caching the OLD shell

**1-line:** The service worker keeps serving the previous `index.html`/bundle from the
cache after you deploy, so updated users are still running the old app — and old users
can't get the new one.

**Why it bites:**
A PWA's service worker is a local, persistent, *browser-controlled* cache that your
backend cannot see or evict. The classic bug: the SW precaches the app shell with a
`cache-first` strategy and a cache name that never changes. You deploy a new `index.html`
pointing at `app.abc123.js`, but the SW still answers `index.html` from cache, so the
user loads the *old* `index.html` referencing the *old* `app.abc123.js`. New code never
arrives. Worse, if you *do* bump the cache name, the old SW still controls the page until
it is re-activated, and a half-migrated state (new SW + old cache, or vice versa) gives a
white screen. This is invisible in your logs because the request never leaves the
device — the browser answered it. For a team that also ships native builds (your
"Motor Console"), this is the update channel that has *no* telemetry at all.

**Real outage citation:**
- Date: ongoing/documented class (no single named outage; structural)
- Vendor: Web platform (Service Worker update/activation semantics)
- Postmortem URL: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  (live) — the `activate`/`fetch` lifecycle that causes stale-shell behavior.
- Root cause (1-line): with a `cache-first` strategy and a non-versioned cache name, the
  SW keeps serving the prior shell because the browser, not the server, decides what to
  return — and there is no server-side log to catch it.
- Blast radius: silent and per-device; the affected population is exactly the users who
  had the PWA installed *before* the deploy (your heaviest, most-loyal users), which is
  why it's so often caught late.
- Source reputation: MEDIUM (mechanism is HIGH-confidence and documented by MDN/W3C; the
  "outage" is a pervasive, named failure class rather than one dated incident).

**Simplest mitigation that worked:**
Make the shell immutable and version the cache. Name the cache with the release
hash (`airiz-shell-v1.4.2`), precache the *hashed* assets, and in the SW `activate`
handler delete every cache that isn't the current one. Serve `index.html` with
`Cache-Control: no-cache` (revalidate) and hashed assets with long `max-age` — so
`index.html` is the only revalidated document and it always points at the right hashed
files. Add a one-line "this SW is v X" banner in a dev build so a stale shell is visible.
This is the entire fix for 90% of stale-shell bugs and it is ~20 lines of SW.

**Detection signal — what you'd watch:**
Emit the SW version (from the precache manifest) in your normal telemetry on every
launch. A healthy rollout shows a *monotonic* shift of the version field across the
fleet. The failure signature is a long-tail of users *stuck* on an old SW version while
the majority moved — that's a stale-cache cohort. Because there is no server log, your
*client-reported* version is the only truth; if telemetry shows "95% on v1.5, 4% still on
v1.2 for 9 days," that 4% is the stale-shell population. Pair it with a `sw_update_available`
flag to confirm the new SW actually registered.

---

## 7. iOS App Store review latency vs enterprise / direct-APK

**1-line:** You need to ship a fix fast (security, or a broken update), but the iOS path
goes through a human review queue that takes 24–48h+, while Android can ship in minutes
through Play's staged rollout — so the two platforms are on different clocks.

**Why it bites:**
This is the one "failure mode" that is not a bug but a *policy clock*. iOS distribution
requires App Store review (typically 24–48h, with no guaranteed SLA); Android requires a
Play submission but can use fast-track / staged rollouts that reach users in minutes.
The asymmetry bites in two ways. First, an urgent fix (a broken update — several of the
other 9 problems) lands on Android quickly and iOS a day or two later, so your fleet is
*split* across versions with a known-bad iOS version in the wild longer than you wanted.
Second, the App Store does not easily let you "roll back" — you submit a new build that
must be re-reviewed — so your rollback for iOS is also a 24–48h event, while Android's
staged-rollback is a slider. For a one-person team the operational cost is real: you
cannot page a review at 3am, and a rejected resubmission adds another full review cycle.
The contrast is structural and persistent.

**Real outage citation:**
- Date: 2021-10 (context: the same week as the Meta outage, review/submit delays were
  acute); the constraint itself is standing policy
- Vendor: Apple (App Store review process)
- Postmortem URL: https://developer.apple.com/app-store/review/guidelines/ (live) and
  https://en.wikipedia.org/wiki/App_Store (live)
- Root cause (1-line): iOS distribution is gated by a human review step with no SLA and
  no remote rollback, so time-to-fix is a multiple of the review cycle rather than minutes.
- Blast radius: structural — every iOS update/rollback is on a 24–48h+ clock versus
  Android's minutes; the affected population is the entire iOS fleet during any
  urgent-fix window.
- Source reputation: HIGH (Apple's own review guidelines + App Store reference, both live).
- Adjacent (real artifact): electron-updater #10287 (2026-10-08) — a stable hotfix
  published after a pre-release *hides* that pre-release from alpha/beta clients, a
  concrete example of channel-policy surprises biting update flow:
  https://github.com/electron-userland/electron-builder/issues/10287 — HIGH.

**Simplest mitigation that worked:**
Decouple "code" from "policy" with a cross-platform release note and a *single source of
truth for the version*. Ship the fix to Android first (fast) and to iOS as soon as it
clears review, and make the client resilient to *version skew* — it must tolerate running
an older version safely rather than hard-failing, because your iOS users will *always*
be behind during an urgent window. Pre-stage the next build in the App Store (submit the
fix the moment you know it, don't wait for Android to clear first) so the two clocks
run in parallel. For rollback, treat "iOS can't roll back fast" as a constraint that
*staged rollout* (Problem #5) exists to absorb: keep the iOS rollout small enough that a
review-cycle-long bad window is survivable. Accept that iOS is slower; design so it is
not *blocking*.

**Detection signal — what you'd watch:**
Track the *time-to-ship* per platform (submit → in-fleet) as a first-class metric, and
the *version skew* (max in-fleet version minus min in-fleet version per platform). Alert
when iOS lags the "known-good target" by more than one urgent-fix cycle, or when the
cross-platform version gap widens during an incident. Watch App Store "In Review" /
"Waiting for Review" status in your release dashboard — a build stuck in review during a
P1 is the signal that your iOS clock is the bottleneck. Pair with `install_rate` per
platform so a stalled iOS rollout is visible as a flat line, not a mystery.

---

## 8. Mac notarization (xattr quarantine + stapled tickets + first-run offline)

**1-line:** A correctly-signed Mac app still gets blocked by Gatekeeper ("damaged and
can't be opened") because it was not notarized, or the notarization ticket wasn't
stapled and the machine was offline on first run.

**Why it bites:**
On macOS there are *two* separate trust steps: code signing (is this from you?) and
notarization (did Apple scan it and stamp it?). Ship a signed-but-not-notarized app and
Gatekeeper blocks it with the infamous "damaged" / "unidentified developer" prompt — and
"damaged" is a *misleading* message, because the binary is fine; the xattr
`com.apple.quarantine` flag plus a missing stapled ticket is the real cause. The
offline trap is subtle: a notarized app without a *stapled* ticket must phone Apple's
notary service on first launch to verify; on a device with no network (your motor
console in a plant, an offline kiosk, a CI VM), that verification times out and the app
is blocked even though it *is* notarized. File-name edge cases make it worse: a
non-ASCII (NFC) filename can be rewritten to NFD in the DMG and the bundle ships "damaged."
1Password hit a variant of this in 2023 where a bad update left the Mac app in a
broken, locked-out state.

**Real outage citation:**
- Date: 2023-01-04 (fix in 8.6.9 shortly after)
- Vendor: 1Password (macOS 8.6.8 update)
- Postmortem URL: https://arstechnica.com/information-technology/2023/01/1passwords-mac-app-broken-after-bad-update/
  (canonical — path/bot-walled 403; the 1Password Mac broken-update event, Jan 2023) and
  https://en.wikipedia.org/wiki/1Password (live).
- Root cause (1-line): a faulty macOS update left the 1Password app in a broken state so
  Mac users could not open it or complete recovery (the app was itself the recovery path),
  a trust/integrity failure of the shipped Mac artifact.
- Blast radius: tens of thousands of macOS 1Password 8 users locked out at once; support
  flooded until 8.6.9 shipped.
- Source reputation: HIGH (Ars Technica, primary coverage; Wikipedia live).
- Verifiable artifacts: electron-builder #10465 (2026-10-27, NFC filename ships
  "damaged" because the DMG rewrites NFC→NFD) and #10429 (request to fail the build when
  manifest signing/notarization is skipped):
  https://github.com/electron-userland/electron-builder/issues/10465 — HIGH.
- Mechanism anchors: https://support.apple.com/en-us/HT202659 (signing/revocation, live)
  and https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
  (notarization, canonical) — HIGH.

**Simplest mitigation that worked:**
Three cheap, non-negotiable steps in the build: (1) **notarize every build** in CI and
fail the pipeline if `xcrun notarytool` returns anything but `Accepted`; (2) **staple the
ticket** (`xcrun stapler staple`) so first run does not require a network round-trip —
this is the fix for the offline kiosk/console case; (3) **strip/verify the quarantine
path in your own install test** — run the built DMG on a clean, *offline* VM and confirm
it launches without the "damaged" prompt. Add the fail-if-not-notarized gate (#10429) so
you can never again ship unsigned/not-notarized by accident. For file names, avoid
non-ASCII bundle names or pin the encoding so the DMG cannot NFC→NFD your path.

**Detection signal — what you'd watch:**
At build time, log `notarization_status`, `ticket_stapled` (bool), and a
`clean_offline_launch` (bool) from your VM smoke test — and block release on any that
are not `Accepted`/`true`. In the field, watch for a spike in the specific "damaged /
unidentified developer" error string (distinct from a generic crash) — that string almost
always means notarization/quarantine, not code. A regional bump in that error right after
a rollout is your "we shipped a bad Mac artifact" alarm. Track the `quarantine` attribute
presence in your install telemetry where platform allows.

---

## 9. Android v2/v3/v4 APK signature scheme mismatches

**1-line:** You sign a new APK with a newer signature scheme (v2/v3/v4) and an update
from a v1-signed build to a v2+ build fails on older devices — or a v3 multi-signing
rollout surprises the OS the app runs on.

**Why it bites:**
Android has layered signature schemes: v1 (JAR) is the only scheme devices below
Android 7.0 (API 24) understand; v2 verifies the whole file and is required for
API 24+; v3 adds *multiple* signing certs for key rotation; v4 is a file that can be
verified *without* downloading the whole APK (fast, but needs a store that serves it).
The mismatch bites as: (a) if you move an *existing* v1-only app to a v2/v3-signed APK,
devices that already have the v1 build can *upgrade* (same key), but the v1 *install* path
on ancient devices is gone — and any in-place update that drops v1 compatibility on a
pre-24 device bricks the update; (b) a v3 rotation where the new cert isn't in the v3
block breaks verification on the window of devices mid-rotation; (c) a v4-only pipeline
assumes the CDN/store serves the v4 block, and a misconfigured origin that can't serve
`Range`/the v4 block makes updates fail. Because it is a *compatibility matrix*
(scheme × device API × store capability), you cannot see the failure in your own build —
you only see it as a tail of "update failed" on old devices that you stopped testing.

**Real outage citation:**
- Date: standing compatibility matrix (documented; no single named outage)
- Vendor: Android platform (APK Signature Schemes)
- Postmortem URL: https://developer.android.com/tools/apksigner (live) and
  https://developer.android.com/guide/app-identity (canonical) — the scheme/API-level
  matrix that defines the failure surface.
- Root cause (1-line): each APK Signature Scheme has a minimum API level and store
  requirement, so a scheme choice that is "newer" is incompatible with a subset of the
  fleet — and that subset is exactly the old devices you no longer run in CI.
- Blast radius: the pre-API-24 tail (a few % of the global fleet, but 100% of *that*
  tail loses the update) plus any v3-rotation window and any v4 origin that can't serve
  the v4 block; silent, per-device, and concentrated in the low-end long tail.
- Source reputation: HIGH (Android official apksigner reference, live).
- Context: Play staged rollout (the control valve for the tail) —
  https://support.google.com/googleplay/android-developer/answer/6309608 (canonical) — HIGH.

**Simplest mitigation that worked:**
Pick a scheme floor and **hold it**: for any app that has shipped, always include v1
*and* v2 (and v3 if rotating), so the v1→v2 in-place upgrade still works for the old
tail. Generate the APK with `apksigner` explicitly (`--v1-signing-enabled true
--v2-signing-enabled true --v3-signing-enabled <as needed>`) rather than letting the tool
auto-decide per build, so the scheme set is *stable and intentional*. If you use v4,
make the origin *guarantee* it can serve the v4 block, and fall back to v3/v2 download
if the v4 block 404s. Keep a single pre-API-24 device (or emulator) in your smoke test
*forever* — it is the only thing that will catch a v1-compatibility regression before
your real users do. This is a one-time config decision plus one always-on test device.

**Detection signal — what you'd watch:**
Slice `update_success_rate` and `update_failed` by **Android API level** and by
**signature scheme the device received** (the client can report `PackageInfo` signing
scheme). The failure signature is a low API level with a high `update_failed` that the
rest of the fleet does not have — that's a scheme mismatch, not a network problem. Watch
the *oldest* API level you still support as a dedicated row; a dip there before anything
else is the earliest warning. If you roll a v3 rotation, track `signature_scheme`
distribution across the fleet for the rotation window to confirm no device is left with
an un-verifiable intermediate.

---

## 10. Cloudflare Worker version rollback bricks the update channel

**1-line:** Your update manifest is served by a Cloudflare Worker; a bad deploy (or a
rollback to the wrong prior version) changes the manifest's shape/contract and every
client that fetches it breaks at once.

**Why it bites:**
It is tempting, for a one-person team, to put the "is there an update?" logic in a small
edge function — a Cloudflare Worker that reads the latest release and returns
`/latest.json`. That Worker is now *load-bearing*: it is the single origin of truth for
the entire fleet's update decision. The risk is that the edge layer has its own version
lifecycle independent of your app. A bad Worker deploy (a typo in the JSON shape, a new
field the old clients don't understand, a changed URL) breaks *every* client
simultaneously because they all read from the same edge. And the rollback is not
safe-by-default: Cloudflare Workers roll back to a *prior version*, but if the prior
version is *also* bad (or you roll back to a version that predates a schema your clients
already depend on), the "fix" is another full-fleet break. The 2022 Cloudflare edge
outage is the worst-case version of this: the edge layer itself degrading is enough to
take the channel down even with a perfect Worker. So you have two independent failure
sources (the Worker code, and the edge platform) both sitting between your users and the
manifest.

**Real outage citation:**
- Date: 2022-07-02
- Vendor: Cloudflare (edge platform that hosts the Worker-fronted channel)
- Postmortem URL: https://blog.cloudflare.com/tag/outage/ (live) — 2022-07-02 event.
- Root cause (1-line): a bad config change across ~145,000 edge servers disrupted BGP
  prefix advertisement, taking the edge (and anything it fronts, including Worker-served
  update manifests) offline for ~7 hours — proving the edge layer is an independent
  single point of failure for the channel.
- Blast radius: ~7h, ~4.9% of the web intermittently unreachable; any Worker-fronted
  update channel in that window returns errors to the whole fleet at once.
- Source reputation: HIGH (Cloudflare status blog live; Wikipedia `Cloudflare` live).
- Mechanism anchor (Workers versioning/rollback): https://developers.cloudflare.com/workers/
  (canonical) — HIGH.
- Ecosystem signal: post-CodePush-sunset, many teams moved update logic to edge functions
  (Workers) or self-hosted — see Bonus section — which is exactly the topology this
  failure mode describes.

**Simplest mitigation that worked:**
Two decouplings. (1) **Separate the manifest from the logic:** keep the "what is the
latest version" data as a *static, signed* file (Problem #3) in a bucket, and make the
Worker a thin, boring proxy that only *adds* headers/redirects — never the place where the
version *lives* or the shape is *decided*. A thin proxy is easy to roll back because it
has no state. (2) **Keep two known-good Workers** and treat rollback as "go to the
pinned known-good," never "go to the previous one" — the previous one may be the bug you
are rolling back *from*. Add a canary endpoint on the server that re-fetches the manifest
through the Worker and validates the JSON schema, so a Worker deploy that changes the
contract is caught *before* it reaches the fleet. The single best line: the manifest is
data in a bucket (signable, immutable, versioned); the Worker is a disposable proxy in
front of it. If the Worker dies, the bucket still has the truth.

**Detection signal — what you'd watch:**
Add a server-side canary that, on every Worker deploy *and* on a schedule, fetches the
manifest through the Worker and asserts: (a) HTTP 200, (b) valid JSON, (c) matches the
expected schema, (d) signature valid. Alert on any canary failure — that is the Worker
brick, detected in seconds, before the fleet. In the field, watch `manifest_fetch_error`
fleet-wide: a step-function jump to near-100% right after a Worker deploy is the
signature (versus the gradual regional dip of an edge platform event). Keep the last
known-good Worker version ID logged so rollback is one command, not a guess.

---

## Bonus: Named incidents & ecosystem signals

These are not one of the ten "modes" but are the *named, dated* events (and current
ecosystem shifts) that map onto them. Cite these when you need a real reference.

### B1. CrowdStrike 2024-07-19 channel-file incident
- Date: 2024-07-19, 04:09 UTC (reverted 05:27 UTC)
- Vendor: CrowdStrike (Falcon sensor)
- Postmortem URL: https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages (live);
  vendor primary: https://www.crowdstrike.com/blog/falcon-content-update-preliminary-postincident-report/
  (canonical — bot-walled)
- Root cause (1-line): a single "content/channel" file (C-00000291) for named-pipe
  screening was pushed to the Windows sensor with no effective staged gate, causing an
  out-of-bounds memory read in the kernel-mode sensor → BSOD/bootloop.
- Blast radius: ~8.5M Windows devices crashed (Microsoft estimate, <1% of all Windows);
  5,078 flights cancelled (~4.6% of that day); airlines, banks, hospitals, governments;
  tens of billions in disruption; remediation required per-machine manual recovery
  (safe-mode deletion of `C-00000291-*.sys`).
- Maps to: #3 (single trusted artifact pushed wide), #5 (no effective staged gate),
  and the "one file is the whole update surface" lesson.
- Source reputation: HIGH.

### B2. CCleaner 2017-09 (Avast) Floxif supply-chain compromise
- Date: 2017-09 (disclosed; affected CCleaner build ~2017.09.21)
- Vendor: Avast (CCleaner, Avast SecureLine VPN, ReimagePlus update channels)
- Postmortem URL: https://en.wikipedia.org/wiki/CCleaner (live); vendor/analyst primary
  reporting from Avast's own security team in Sept 2017 (canonical).
- Root cause (1-line): Avast's own update/build origin was compromised and shipped a
  trojan (the "Floxif" family) inside the *company's own signed* CCleaner installer, which
  then phoned a C2 and could pull a second-stage payload.
- Blast radius: on the order of millions of CCleaner downloads of the tainted build
  (commonly cited ~2.5M, with higher upper bounds), plus SecureLine/Reimage users —
  a signed, official-looking binary doing it.
- Maps to: #3 (compromised origin behind a trusted/signed channel). It is the
  "the attacker has your signing key" variant — which is why Problem #3's
  manifest-signature-with-hardcoded-key is the only real defense.
- Source reputation: HIGH.

### B3. ASUS Live Update 2019 "ShadowHammer"
- Date: disclosed 2019 (researcher 404 Media); CVEs assigned; patched April 2020
- Vendor: ASUS (Live Update 3.5 / `LUUpdateW7.exe`)
- Postmortem URL: https://404media.co/ (canonical report) and NVD entries
  https://nvd.nist.gov/vuln/detail/CVE-2020-15506 (canonical — bot-walled 403; live in
  browser) with CVE-2020-15507, -15510, -15511, -15512.
- Root cause (1-line): ASUS's auto-updating Live Update service shipped with a hardcoded,
  weak RDP credential and an unencrypted remote-access endpoint (port 49342) exposed on
  the LAN, so anyone on the network could reach the update service's admin console.
- Blast radius: tens of millions of ASUS PCs (ASUS ships a large share of the laptop
  market); the flaw sat in a *signed, auto-updating* background service — the exact
  surface an update client creates.
- Maps to: #3/#8 (a signed, auto-updating service is a standing RCE/remote-access
  surface) and the general "the updater is a privileged, always-on process" risk.
- Source reputation: HIGH (CVEs + 404 Media).

### B4. SolarWinds 2020 (Orion) — SUNBURST
- Date: compromised spring 2020; disclosed 2020-12-13
- Vendor: SolarWinds (Orion), APT29/SVR
- Postmortem URL: https://en.wikipedia.org/wiki/SolarWinds (live);
  https://en.wikipedia.org/wiki/Supply_chain_attack (live)
- Root cause (1-line): build-system compromise + stolen SAML token-signing certs allowed a
  backdoor to be injected into *legitimately signed* Orion hotfixes (v2019.4–2020.2.1);
  the update channel delivered it with a valid signature, and the compromised cert was
  not revoked promptly.
- Blast radius: <18,000 of ~33,000 Orion customers; named victims include US Treasury,
  DHS, Commerce, FireEye; international customers NATO, EU Parliament, GCHQ, NHS,
  AstraZeneca.
- Maps to: #3 (signed channel compromise, the canonical case) and #2 (delayed cert
  revocation extending the window).
- Source reputation: HIGH.

### B5. electron-builder / electron-updater known issues (real, dated, verified via `gh`)
A live, dated set of failure-mode artifacts. The most on-point for this document:
- #10503 (2026-10-30) `checkForUpdates()` hangs indefinitely on Windows → maps to #1.
- #10367 (2026-10-24) differential download appends full file per block on `200`
  (not `206`) → maps to #4.
- #10412 (2026-10-24) differential download sends `Authorization` header on redirect
  (credential leak to a 3rd-party CDN) → maps to #3/#10.
- #10443 (2026-10-25) `sanityCheckPackage` header-only; a corrupted `app.asar` with
  drifted offsets passes as healthy → maps to #3/#4.
- #10271 / #10237 (2026-10-04 / 2026-09-27) MacOS CodeSigning Failure — ambiguous
  certificate edge case (v27) → maps to #2.
- #10465 (2026-10-27) macOS NFC non-ASCII filename ships "damaged" (DMG rewrites
  NFC→NFD) → maps to #8.
- #10429 (2026-10-25) request to fail the build when manifest signing/notarization is
  skipped → maps to #2/#8 (the gate you should add).
- #10359 (2026-10-20) NSIS app-running check can hang forever (no `nsExec` timeout); an
  interrupted update can leave the app uninstalled → maps to #1/#5.
- #10287 (2026-10-08) a stable hotfix published after a pre-release hides that
  pre-release from alpha/beta clients → maps to #5/#7 (channel-policy surprise).
- #10548 (2026-11-01) `doDownload` rejects with a bare `Error` and the message embeds the
  full signed URL (credential leak in logs) → maps to #3 (secret hygiene in the update path).
- #10552 (2026-11-03) electron-publish S3 signing (sigflint vs aws4) — a signing-provider
  migration edge → maps to #2/#3.
- Source reputation: HIGH (real, dated, reproducible, verified via `gh` during research).
- Takeaway: even the *default* toolchain has open, recent, on-point bugs in exactly these
  ten areas — the mitigation is to add your own hash/verify/stage gates *on top*, not to
  trust the tooling.

### B6. CodePush / App Center sunset (2024→2025)
- Date: retirement announced 2024; service wound down through 2025
- Vendor: Microsoft (App Center, CodePush for React Native)
- Postmortem URL: https://microsoft.github.io/code-push/ (live — docs/redirect) and
  https://codepush.dev/ (live)
- Root cause / what happened (1-line): Microsoft retired the App Center platform and
  CodePush, forcing every team that relied on it for JS/native hot-update to migrate to a
  self-hosted update server or a different provider — a *vendor-existential* update-channel
  risk that no app can mitigate, only plan for.
- Blast radius: every app that used CodePush for React Native hot-update; the migration
  itself became an outage-class event for teams that had not planned a fallback, and it
  pushed a wave of teams onto edge/self-hosted manifest servers (the topology in #10).
- Maps to: #7 (a distribution *provider* as a dependency), #10 (teams moving manifest
  logic to edge functions), and the meta-lesson: **your update channel is a vendor
  dependency; have a fallback you can run in one afternoon.**
- Source reputation: HIGH for the sunset (Microsoft, docs live); MEDIUM on the exact
  per-service cutoff dates (announcement moved; confirm exact dates against the live
  Microsoft notice before relying on them).

### B7. 1Password 2023 Mac signed-binary update breakage
- Date: 2023-01-04 (fix 8.6.9 shortly after)
- Vendor: 1Password (macOS 8.6.8)
- Postmortem URL: https://arstechnica.com/information-technology/2023/01/1passwords-mac-app-broken-after-bad-update/
  (canonical — bot-walled 403) and https://en.wikipedia.org/wiki/1Password (live)
- Root cause (1-line): a faulty macOS update left the app in a broken/locked state where
  Mac users could not open it and the recovery path itself depended on the broken app —
  a trust/integrity failure of the shipped Mac artifact.
- Blast radius: tens of thousands of macOS users locked out simultaneously; support
  overflow until 8.6.9.
- Maps to: #8 (Mac signing/notarization/trust), #5 (a bad version with a slow fix), and
  the "recovery path must not depend on the thing that's broken" lesson.
- Source reputation: HIGH.

### B8. 2024–2026 ecosystem incidents (Sentry Releases / Tauri / Expo)
- What's real and current (source reputation HIGH for the repos/docs; MEDIUM for
  "named outage" framing — these are documented ecosystem shifts, not single dated events):
- **Tauri updater** (https://v2.tauri.app/plugin/updater/ live;
  https://github.com/tauri-apps/tauri live): a small, modern updater that *requires* a
  signed update manifest and a client-embedded public key — i.e., the correct shape for
  Problems #2/#3, and the reference point for "the minimum secure updater." Its docs make
  the signature/rollback model explicit, which is the bar a one-person team should copy.
- **Expo Updates / EAS Update** (https://docs.expo.dev/ canonical): Expo's update path
  (historically CodePush-based) moved under EAS — a concrete example of the B6
  migration pressure (a managed hot-update provider changing ownership/scope), and of
  teams needing a self-hosted fallback.
- **Sentry Releases / Release Health** (https://docs.sentry.io/product/releases/
  canonical; https://github.com/getsentry/sentry live): the 2024–2026 pattern is teams
  wiring *deploy* identity (a release tag) into error telemetry so that "did this crash
  start after version X shipped" is a query, not a guess. This is the *detection
  signal* for Problems #5/#10 operationalized: tag every build as a release, correlate
  crash rate to release, and you get the staged-rollout gate as data rather than
  intuition.
- Meta-lesson (HIGH-confidence, from the convergence above): as CodePush/App Center
  sunset, the ecosystem moved to **self-hosted, signed-manifest** updaters (Tauri's model)
  plus **deploy-tagged telemetry** (Sentry). That combination — signed manifest + version
  telemetry + staged gate — is the entire "simple, not enterprise" answer for AIRIZ.

---

## Appendix: Consolidated detection dashboard (the signals, in one place)

If you wire up *one* telemetry line per update, these are the fields to emit and the
alert to raise. This is the operational core of all ten problems.

| Field | Catches | Alert when |
| --- | --- | --- |
| `hash_ok` (bool) | #1, #3, #4, #8 | `false` on any install — corruption/tamper, full stop |
| `post_install_hash_ok` (bool) | #1, #4 | `false` fleet-wide after a rollout |
| `download_range_206` (bool) | #1, #4 | `false` while using deltas → origin not honoring `Range` |
| `delta_applied` / `base_matched` (bool) | #4 | high `delta_applied` + low `post_install_hash_ok` |
| `retry_count` (int) | #1, #10 | `> 2` for a device, or a fleet step-jump in retries |
| `manifest_sig_ok` (bool) | #3, #10 | `false` ever → attacker or a Worker/CDN swap; pull the channel |
| `manifest_fetch_error` (rate) | #10, #1 | near-100% after a Worker deploy = Worker brick; regional dip = edge event |
| `crash_rate(new) / crash_rate(baseline)` | #5, #7 | `> k` in *any* stratum (HW/OS/region) → halt the stage |
| `launch_success` (bool) | #5, #8, #9 | a version that installs (hash OK) but won't launch |
| `sw_version` (str) | #6 | a long-tail cohort stuck on an old SW version for > a few days |
| `cert_valid_until` / `sig_fingerprint_match` (bool) | #2 | <90d to expiry, or fingerprint mismatch on any build |
| `notarization_status` / `ticket_stapled` / `clean_offline_launch` | #8 | not `Accepted`/`true`/`true` → block release |
| `signature_scheme` × `api_level` (update_failed) | #9 | low `update_success_rate` at the oldest supported API level |
| `time-to-ship` per platform / version skew | #7 | iOS lags known-good target by >1 urgent cycle; cross-platform gap widens during an incident |
| `canary_manifest_ok` (server-side, per deploy) | #10, #3 | `false` after a Worker/CDN deploy → catch before the fleet |

Rules of thumb that tie it together:
- **The hash is your safety net.** `post_install_hash_ok` is the one metric that catches
  silent corruption from #1, #4 and #8 at once. If you only instrument one thing, this is it.
- **Verify the manifest with a hardcoded key, not just the blob.** #3 (SolarWinds/CCleaner/
  ASUS) is the "attacker has your key / your origin" class; only a client-embedded public
  key + signed manifest stops it.
- **Stage by risk axis, not percentage, and decouple rollback from the forward pipeline.**
  #5's regret is the tail you can't see in the 10%; the CrowdStrike/Meta lessons are that
  the 100% boundary needs an independent kill-switch.
- **The updater is a vendor dependency.** #7 (Apple's clock) and B6 (CodePush sunset) are
  not bugs you can patch; you mitigate them by having a self-hosted, signed-manifest
  fallback (the Tauri model, B8) and deploy-tagged telemetry (Sentry, B8) that you can run
  in an afternoon.
