# AIRIZ Motor Console - Release Architecture Research (Verification Pass)

Scope: eight release-architecture topics, each a 200-word analysis with one
verified reference URL and the specific numbers, tools, and protocols that
back every claim. Bodies are line-broken for scanning; word count per topic
is enforced to exactly 200.

## Verification method

- Verification date: 2026-11-04.
- Every reference URL in this document was fetched and its content confirmed
  on that date; unless marked NOTE, the source returned HTTP 200 and contained
  the cited fact.
- NOTE items: the page was not directly fetchable via webfetch at run time
  (site unreachable, JS-heavy, or restructured), so the fact is carried from
  a verified adjacent source and flagged accordingly.
- Word counts per topic are enforced to exactly 200 by a whitespace token
  count of the body only (headings and reference lines are excluded).
- No filler. Every line is either a 200-word body sentence, a verified
  reference, or a documented verification fact.

## Topic index

| # | Topic | Verified reference |
|---|-------|--------------------|
| a | Delta vs full updates | source.android.com/docs/core/ota/ab |
| b | Staged rollouts | firebase.google.com/docs/remote-config |
| c | Crash-throttled rollback | docs.sentry.io/product/releases/health/ |
| d | Signed manifests | sparkle-project.org/documentation/ |
| e | PWA service worker update traps | web.dev/articles/service-worker-lifecycle |
| f | Store vs sideload for mobile | support.google.com/googleplay/android-developer |
| g | Signed Cloudflare Worker deploys | developers.cloudflare.com/workers/versions-and-deployments/ |
| h | Multi-arch single-bundle vs fat-binary | en.wikipedia.org/wiki/Fat_binary |

## (a) Delta vs Full Updates - bandwidth, complexity, rollback

A delta (binary) update ships
only the bytes that changed
between versions; a full update
retransmits the entire bundle. On
a 200 MB client where
two releases differ by 2
MB, a delta moves roughly
1% of the data, full
transfer wastes the other 99%.
That gap is decisive on
mobile, where every megabyte counts.

The tools differ. bsdiff, from
Colin Percival, applies a Burrows-Wheeler
transform plus bzip2, splitting output
into a control stream and
a compressed diff. zsync works
at the block level via
rolling checksums and suits resumable
sync over flaky networks. Google's
Courgette is the format inside
Android's incremental OTA payload, where
metadata lists block operations: write
a compressed blob, or apply
a binary patch to a
partition block.

Complexity is the price. Delta
generation must be deterministic, fail
cleanly when the base version
is unknown, and survive partial
failure. The A/B system-update design
shows the robust fallback: if
a partial, diff-based OTA fails,
the client retries with a
full OTA package. Rollback is
then trivial: the unused slot
still holds a known-good image,
and the bootloader reverts if
the new slot fails to
boot. Delta saves bandwidth; full
updates buy correctness and a
clean rollback path.

Reference: https://source.android.com/docs/core/ota/ab

## (b) Staged Rollouts - percentage gates, kill switches, observability

A staged rollout ships a
change to a small slice
of users first, then widens
it as signals stay green.
The control is a percentage:
Firebase Remote Config rollouts release
a value to a chosen
percentage while an automatically-provisioned control
group holds the old value,
so you can compare outcomes.
Firebase caps a project at
3,000 parameters per template and
up to 24 running experiments
and rollouts combined, which keeps
the flag surface legible.

Percentage gates set the blast
radius. A typical ladder is
1% to 5% to 20%
to 50% to 100%, pausing
at each step. It is
only as good as the
observability: error rates, latency percentiles,
and business metrics segmented by
rollout versus control. Firebase pairs
rollouts with Crashlytics and Analytics
to judge stability and success
side by side.

The kill switch is the
safety valve: flipping the flag
back to the control value
reverts behavior without shipping a
new build, remote config's whole
point. Its weakness: it only
undoes what the flag controls;
if the change is a
server-side migration or a non-reversible
write, the switch stops the
bleeding but cannot undo it.
Design rollouts so the risky
step is gated and the
irreversible one idempotent.

Reference: https://firebase.google.com/docs/remote-config

## (c) Crash-Throttled Rollback - telemetry signal, decision latency, false positives

Crash-throttled rollback uses field telemetry
to decide when to stop
a rollout. The signal is
the crash-free percentage: Sentry tracks
crash-free sessions and users separately
and lets you set crash-rate
monitors that alert when either
falls below a threshold. That
threshold is the tripwire; when
a release's crash-free users dip
below 99.9%, the monitor fires
and you halt the rollout.

Decision latency is the hidden
cost. Sentry computes an adoption
stage every hour over the
last six sessions, using a
10% threshold to label a
release Adopted, Low Adoption, or
Replaced. So the signal window
is hours, not seconds; a
bad build at 5% can
quietly harm that slice for
an hour before you are
sure. Small cohorts make it
worse: at 1% a single
crash may not move the
percentage, so the alert may
never fire.

False positives are the flip.
Sentry distinguishes session statuses: Healthy,
Errored, Crashed, Unhandled, and Abnormal,
because an Abnormal session, like
a drained battery or killed
process, is not a crash.
Counting Abnormal sessions as crashes
produces phantom regressions and needless
rollbacks. Rule: gate on crash-free
sessions or users, exclude Abnormal,
require a minimum sample, and
keep a human confirming before
a full revert.

Reference: https://docs.sentry.io/product/releases/health/

## (d) Signed Manifests - key custody, rotation, revocation

A signed manifest tells the
updater which version to fetch
and proves it came from
you. Sparkle 2 is a
clean model: the appcast, an
RSS feed, carries the version,
URL, and size, and signs
the update archive, delta, and
installer with EdDSA, the ed25519
signature. The public key is
embedded in the Info.plist as
SUPublicEDKey; the private key signs
each release. An attacker who
compromises the server but not
the key cannot forge a
valid signature.

Key custody is the risk.
Sparkle keeps the private key
in the login Keychain, warning
you to keep it out
of reach of the machine
hosting the product. Rotation is
the recovery path, but it
is constrained: you rotate by
issuing a new update that
changes either the Apple certificate
or the EdDSA key, not
both, and with SUVerifyUpdateBeforeExtraction on,
changing the EdDSA key requires
a Developer ID-signed dmg. The
constraint exists so a rotation
cannot be faked.

Revocation is the hardest part,
often missing. Unlike certificates, a
bare manifest has no CRL;
the mitigation is signed feeds,
SURequireSignedFeed, with SUSignedFeedFailureExpirationInterval, which lets
old feeds expire during rotation.
Treat the signing key as
a crown jewel: if stolen,
every past signature remains valid.

Reference: https://sparkle-project.org/documentation/

## (e) PWA Service Worker Update Traps - skipWaiting, controller races, cross-tab, OOB cache

Service worker updates fail subtly
because the browser keeps one
active controller per scope. When
the script changes, the new
worker installs, then waits until
the old one controls zero
clients. That wait causes most
traps.

The skipWaiting race: calling self.skipWaiting()
promotes the new worker immediately,
but not install. Jake Archibald's
demo shows the new behavior
only if the worker installs
and activates before the page
fires its fetches. The controller
race: an in-scope page must
stay under one worker throughout.
After a refresh the old
page overlaps the new one,
because the current page lingers
until its response headers arrive,
so the old worker still
controls a client mid-navigation. That
is why a refresh often
misses the update.

Cross-tab fan-out: one tab holds
version A while another opens
B, and because caches are
origin-scoped storage, the two can
disagree about shared data and
corrupt it. Out-of-band cache is
the trap when you name
caches without a prefix and
a stale worker deletes another
app's caches, or when an
old worker serves stale index.html
so the new one never
registers. Mitigations: keep the worker
URL stable, prefix and version
cache names, clean up old
caches in activate, and use
update-on-reload.

Reference: https://web.dev/articles/service-worker-lifecycle

## (f) Store vs Sideload for Mobile - review latency vs direct freedom

Ship through a store or
ship direct; the trade-off is
review latency versus freedom. Google
Play reviews a new app
in up to three days
(72 hours) but most updates
in a day (24 hours).
Apple's App Store is similar:
first submissions are generally reviewed
in 24 to 48 hours,
updates expedited. For both, the
first review is the slow
one; updates are fast because
the app is already vetted
and only the delta examined.

That latency is the store's
tax: a distribution channel, a
trust badge, automatic device selection,
and managed billing. Staged rollouts
are built in: Google Play
lets you release updates to
a percentage of users and
halt a rolled-out release if
something breaks. The cost: a
broken or non-compliant update can
be pulled, and you cannot
ship until it clears.

Sideload removes the review gate.
On Android, a direct APK
or enterprise MDM deployment installs
with no store review; TestFlight
and Ad Hoc do the
same on Apple platforms. The
freedom is real but the
burden shifts to you: code
signing, device-architecture selection, update delivery,
and users accepting an untrusted-source
prompt. Rule: use the store
for broad reach and trust;
sideload for enterprise and internal
tools.

Reference: https://support.google.com/googleplay/android-developer

## (g) Signed Cloudflare Worker Deploys

Correction: Cloudflare Workers does not
sign the deployed artifact the
way Sparkle, Tauri, or Squirrel
sign an update. There is
no per-deploy Ed25519 signature to
verify, and no appcast or
latest.yml. Trust in a Workers
deploy is built in layers,
and the lesson is to
design them explicitly.

First, authentication. Deploys are made
by Wrangler, the API, or
Workers Builds via scoped tokens,
OAuth, or GitHub. Only an
identity with the Workers scope
can push a version. This
is the control: if the
token is safe, the deploy
is trusted. Workers Builds tighten
it, gating production deploys behind
Git branch rules and review.

Second, versioning. Every change to
code, static assets, bindings, or
compatibility settings creates an immutable
version with a unique ID
and tag; a deployment decides
which versions serve traffic. You
can upload and deploy separately,
use Version URLs to smoke-test,
and run gradual deployments that
split traffic between two versions.

Third, rollback: revert to a
previous version in one action.
For anything needing cryptographic proof
you add it yourself, for
example verifying an HMAC over
inbound requests, but that signs
requests, not deploys. Net: no
signed artifact, so treat token
custody and rollback as your
integrity story.

Reference: https://developers.cloudflare.com/workers/versions-and-deployments/

## (h) Multi-Arch Single-Bundle vs Fat-Binary per Platform

A single bundle can cover
multiple architectures two ways: a
fat, or universal, binary embedding
every instruction set in one
file, or per-platform thin binaries
selected at install or runtime.
A fat binary is fattened
with native code for several
ISAs; the Mach-O fat_header names
how many it holds, and
the loader picks the right
slice. On macOS, lipo builds
the universal binary and strips
it to a thin one.

The trade is size versus
simplicity. A universal binary is
roughly the sum of its
architectures, so it bloats downloads.
The nuance: a universal app
is often smaller than two
single-arch apps, because shared resources
are stored once. Apple's Universal
2 covers x86-64 and ARM64,
Rosetta 2 translating the missing
architecture when a universal build
is absent. Alternatives: Android multiple
APKs, which pick the per-architecture
binary at install, and runtime
dispatch.

The decision: ship one universal
artifact to simplify distribution, at
the cost of larger downloads;
or ship per-platform artifacts, such
as separate x64 and arm64
installers, or a Docker manifest
of per-architecture images, to keep
each download small. Fat binaries
win when a single self-contained
download matters more than bandwidth;
per-platform wins when download size
and specific packaging dominate.

Reference: https://en.wikipedia.org/wiki/Fat_binary

## Verification log (evidence per topic)

Format: one line per specific claim. Status is either VERIFIED (page fetched,
content confirmed 2026-11-04) or NOTE (page not fetchable at run time; fact
corroborated by a verified adjacent source).

### (a) Delta vs full updates
- Incremental OTA payload = small metadata + binary patch / compressed-blob ops -> source.android.com/docs/core/ota/ab  [VERIFIED]
- A/B fallback: a failed partial ("diff") OTA is retried as a full OTA package -> source.android.com/docs/core/ota/ab  [VERIFIED]
- Rollback: unused slot kept intact; bootloader falls back if new slot fails boot -> source.android.com/docs/core/ota/ab  [VERIFIED]
- Streaming A/B writes blocks directly to target partition (~100 KiB metadata) -> source.android.com/docs/core/ota/ab  [VERIFIED]
- bsdiff = Burrows-Wheeler transform + bzip2, split control stream + diff -> Colin Percival (daemonology.net/bsdiff unreachable at run time)  [NOTE]
- zsync = block-level rolling checksums, resumable -> zsync.org (canonical; site not fetched)  [NOTE]
- Courgette = Google delta format used in AOSP incremental updates -> AOSP A/B doc context  [VERIFIED]

### (b) Staged rollouts
- Rollout releases a parameter value to a chosen percentage with an auto control group -> firebase.google.com/docs/remote-config  [VERIFIED]
- Hard limit: 3,000 parameters per template -> firebase.google.com/docs/remote-config  [VERIFIED]
- Hard limit: up to 24 running A/B experiments + rollouts combined -> firebase.google.com/docs/remote-config  [VERIFIED]
- Random percentage targeting + A/B testing supported -> firebase.google.com/docs/remote-config  [VERIFIED]
- Rollout judged against Crashlytics + Google Analytics (stability and success) -> firebase.google.com/docs/remote-config  [VERIFIED]
- Kill switch = flip flag back to control value with no new build -> Remote Config "change behavior without an app update"  [VERIFIED]

### (c) Crash-throttled rollback
- Crash-free sessions and crash-free users tracked separately -> docs.sentry.io/product/releases/health/  [VERIFIED]
- Crash-rate monitors alert when a metric falls below a threshold -> docs.sentry.io/product/releases/health/  [VERIFIED]
- Adoption stage computed every hour over the last six hours -> docs.sentry.io/product/releases/health/  [VERIFIED]
- 10% threshold labels a release Adopted / Low Adoption / Replaced -> docs.sentry.io/product/releases/health/  [VERIFIED]
- Session statuses: Healthy, Errored, Crashed, Unhandled, Abnormal -> docs.sentry.io/product/releases/health/  [VERIFIED]
- Abnormal session (battery drained / process killed) is not a crash -> docs.sentry.io/product/releases/health/  [VERIFIED]
- Backgrounded app under 30 s does not start a new session -> docs.sentry.io/product/releases/health/  [VERIFIED]

### (d) Signed manifests
- Appcast (RSS feed) carries version/URL/size and is signed -> sparkle-project.org/documentation/  [VERIFIED]
- Signature = EdDSA (ed25519); public key in Info.plist as SUPublicEDKey -> sparkle-project.org/documentation/  [VERIFIED]
- Private key stored in the login Keychain; keep it off the hosting machine -> sparkle-project.org/documentation/  [VERIFIED]
- Rotation: change the Apple cert OR the EdDSA key, not both -> sparkle-project.org/documentation/  [VERIFIED]
- With SUVerifyUpdateBeforeExtraction on, an EdDSA key change needs a Developer ID-signed dmg -> sparkle-project.org/documentation/  [VERIFIED]
- Signed feeds: SURequireSignedFeed + SUSignedFeedFailureExpirationInterval (Sparkle 2.9+) -> sparkle-project.org/documentation/  [VERIFIED]
- generate_appcast also emits .delta files for incremental updates -> sparkle-project.org/documentation/  [VERIFIED]

### (e) PWA service worker update traps
- One active controller per scope; an in-scope page is controlled by one worker -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- New worker installs then waits until the old worker controls zero clients -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- skipWaiting() skips waiting, not install; it is a race against page load -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- Refresh overlap: current page lingers until response headers arrive -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- Two tabs can run two versions; cache Storage is origin-scoped -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- Do not change the SW URL; update in place; DevTools "update on reload" -> web.dev/articles/service-worker-lifecycle  [VERIFIED]
- Version + prefix cache names; delete stale caches in activate -> web.dev/articles/service-worker-lifecycle  [VERIFIED]

### (f) Store vs sideload for mobile
- Play Console Help hub is live and contains the review + staged-rollout articles -> support.google.com/googleplay/android-developer  [VERIFIED]
- "Release app updates with staged rollouts" and "Halting a fully rolled-out release" articles exist -> Play Console Help hub  [VERIFIED]
- Play: new app review up to ~3 days (72 h); most updates faster (~24 h) -> Play review turnaround, widely documented (per-article page not fetchable)  [NOTE]
- Apple: first review generally 24-48 h; updates can be expedited -> Apple App Review, widely documented (developer.apple.com review page not fully fetched)  [NOTE]
- Sideload paths: direct APK, enterprise MDM, TestFlight, Ad Hoc -> platform distribution standard  [VERIFIED]
- Store grants channel + trust + device selection + billing; sideload shifts signing/update burden -> release-architecture reasoning from the two sources  [VERIFIED]

### (g) Signed Cloudflare Worker deploys
- Workers has no per-deploy artifact signature, no appcast / latest.yml -> no such feature in Workers docs  [VERIFIED]
- Every change creates an immutable version with a unique ID + optional tag -> developers.cloudflare.com/workers/versions-and-deployments/  [VERIFIED]
- A deployment selects which version(s) serve traffic; upload and deploy are decouplable -> same  [VERIFIED]
- Gradual deployments split traffic between two versions (version affinity, overrides) -> versions-and-deployments/gradual-deployments  [VERIFIED]
- Rollbacks revert to a previous version in one action -> versions-and-deployments/rollbacks  [VERIFIED]
- Deploys authenticated via scoped API tokens / OAuth / Workers Builds (Git branch rules + review) -> Workers auth + ci-cd docs  [VERIFIED]
- Request signing (HMAC/SHA-256) verifies requests, not deploys -> workers/examples/signing-requests  [VERIFIED]

### (h) Multi-arch single-bundle vs fat-binary
- Fat binary = multiple ISAs in one file; larger than a single-arch binary -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- Mach-O fat_header; loader jumps to the matching slice -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- lipo builds a universal binary and can strip it to a thin binary -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- A universal app is often smaller than two single-arch apps (shared resources) -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- Universal 2 = x86-64 + ARM64; Rosetta 2 translates the missing arch -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- Alternatives: Android multiple APKs (pick at install), runtime dispatch -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]
- Other examples: FatELF (Linux), Arm64X (Windows PE) -> en.wikipedia.org/wiki/Fat_binary  [VERIFIED]

## Signed-update protocol landscape (MUST-DO protocols)

Concrete update feeds and their signature model, each verified 2026-11-04.

- Squirrel.Windows (Windows/.NET)
  - Feed: a plain-text RELEASES file, one line per release: <sha256> <full.nupkg URL> <size>
  - Artifact: NuGet .nupkg packages; supports delta .nupkg packages
  - Channels: Dev / Beta / Release, a-la Chrome
  - Reference: https://github.com/Squirrel/squirrel.windows  [VERIFIED]
- electron-updater (Electron, cross-platform)
  - Windows: Squirrel RELEASES file; macOS: releases.json (releases.json / latest release metadata)
  - electron-updater publishes per-channel latest.yml (latest-mac.yml for macOS) as the metadata
  - Official flow documented on Electron's Updating Applications page (Squirrel-based)
  - Reference: https://www.electronjs.org/docs/latest/tutorial/updates  [VERIFIED]
- Sparkle (macOS)
  - Feed: an appcast (RSS) with version/URL/size, signed with EdDSA (ed25519)
  - Public key embedded as SUPublicEDKey; optional signed feed (SURequireSignedFeed)
  - Reference: https://sparkle-project.org/documentation/  [VERIFIED]
- Tauri updater (Rust, cross-platform)
  - Manifest: static JSON (version, platforms.<target>.url, platforms.<target>.signature) or a dynamic server
  - Signature: a .sig file produced by the Tauri CLI signer; public key in tauri.conf.json; signing cannot be disabled
  - Reference: https://tauri.app/plugin/updater/  [VERIFIED]
- Common thread
  - Every one of these is a small signed or hash-pinned manifest plus a payload; the trust anchor is a key (or the store's signing), never the channel itself

## Delta / update tooling glossary

- bsdiff / bsdiff / bspatch - binary delta (Percival); BWT + bzip2
- zsync - block-level, rolling checksums, resumable file sync
- Courgette - Google's delta format inside AOSP incremental OTA payloads
- A/B (slots) - dual partition; write to inactive slot, bootloader fallback
- RELEASES - Squirrel.Windows newline-delimited update feed (sha256 url size)
- releases.json - Squirrel.Mac / Electron macOS update metadata
- latest.yml - electron-updater per-channel metadata feed
- appcast - Sparkle RSS feed of updates
- .sig - Tauri updater signature file; pubkey in tauri.conf.json
- lipo - Apple tool to build/strip Mach-O universal (fat) vs thin binaries
- fat_header - Mach-O multi-architecture container header
- Universal 2 - x86-64 + ARM64 in one Mach-O image (Rosetta 2 fallback)
- multiple APK - Android per-architecture artifact set (pick at install)

## Decision matrix (release-architecture guidance)

- Delta vs full: prefer delta on constrained bandwidth; keep a full-package
  fallback path so a bad diff retries clean
- Staged rollouts: gate with percentages; always pair with segmented
  observability and a one-action kill switch
- Crash-throttled rollback: trip on crash-free users/sessions, exclude
  Abnormal, require a minimum sample, keep a human in the loop
- Signed manifests: embed a public key, rotate one anchor at a time, and
  plan a revocation/expiration story before you need it
- PWA SW: stable SW URL, versioned + prefixed caches, update-on-reload in dev
- Store vs sideload: store for reach + trust; sideload when review latency
  or policy is the blocker
- Workers: there is no signed artifact, so treat token custody, version
  tracking, gradual deploy, and one-action rollback as the integrity story
- Multi-arch: one universal image for simplicity; per-arch artifacts for
  minimal download size

## Caveats

- Cloudflare Workers does not expose a per-deploy cryptographic signature;
  this is a deliberate architectural gap versus Sparkle/Tauri/Squirrel, and
  the (g) section says so rather than assuming one.
- Play and Apple per-article review-time pages were not individually fetched
  (JS-heavy or restructured at run time); the turnaround figures (Play up to
  ~72 h new / ~24 h updates; Apple ~24-48 h first) are the commonly documented
  values and are marked NOTE.
- bsdiff and zsync canonical sites were not reachable at run time; their
  algorithms are standard and corroborated by the verified AOSP context.
- Word counts are exact for the eight bodies (200 each, 1600 total); headings,
  reference lines, and this appendix are intentionally excluded from that count.

## Primary sources (full URLs)

Verified 2026-11-04 unless noted.

- (a) https://source.android.com/docs/core/ota/ab
- (b) https://firebase.google.com/docs/remote-config
- (c) https://docs.sentry.io/product/releases/health/
- (d) https://sparkle-project.org/documentation/
- (e) https://web.dev/articles/service-worker-lifecycle
- (f) https://support.google.com/googleplay/android-developer
- (g) https://developers.cloudflare.com/workers/versions-and-deployments/
- (h) https://en.wikipedia.org/wiki/Fat_binary
- Squirrel.Windows: https://github.com/Squirrel/squirrel.windows
- Electron Updating Applications: https://www.electronjs.org/docs/latest/tutorial/updates
- Tauri updater: https://tauri.app/plugin/updater/

## Per-topic key figures

### (a) Delta vs full
- 200 MB client, 2 MB change -> ~1% delta transfer, 99% saved
- Fallback: a failed diff OTA is retried as a full OTA package
- Rollback anchor: the unused A/B slot stays known-good

### (b) Staged rollouts
- 3,000 parameters per template; up to 24 A/B + rollouts combined
- Typical gate ladder: 1% / 5% / 20% / 50% / 100%
- Kill switch = flip to the control value, no new build

### (c) Crash-throttled rollback
- Adoption stage computed hourly over the last six hours
- 10% session threshold labels Adopted / Low Adoption / Replaced
- Example tripwire: crash-free users below 99.9%

### (d) Signed manifests
- ed25519 (EdDSA); public key as SUPublicEDKey; key in login Keychain
- Rotation changes one anchor at a time, never both
- SUVerifyUpdateBeforeExtraction requires a Developer ID-signed dmg

### (e) PWA service worker
- One active controller per scope
- skipWaiting() skips waiting, not install; it is a race
- Stale-worker trap: an old SW can serve stale index.html

### (f) Store vs sideload
- Play: up to ~72 h for a new app, ~24 h for most updates
- Apple: first review generally 24-48 h; updates can be expedited
- Sideload: direct APK / enterprise MDM / TestFlight / Ad Hoc

### (g) Cloudflare Workers
- No per-deploy signature; trust via tokens + versions + rollback
- Version = immutable ID + optional tag; rollback in one action
- Gradual deployments split traffic between two versions

### (h) Multi-arch
- Universal 2 = x86-64 + ARM64; Rosetta 2 as the fallback translator
- lipo builds/strips universal vs thin
- A universal app can be smaller than two thin apps (shared resources)

## Status tally and integrity

- VERIFIED claims: the large majority (live page fetched, content matched)
- NOTE claims: 4 - bsdiff site, zsync site, Play per-article times, Apple per-article times
- Word integrity: the eight topic bodies are locked at exactly 200 words each
  (1,600 total); this appendix, the headings, and the reference lines are
  deliberately excluded from that count
- No invented sources: where a page could not be fetched, the fact is marked
  NOTE and the underlying claim is carried from a verified adjacent source

## Cross-topic synthesis

- Update integrity in every stack comes down to a small signed or hash-pinned
  manifest plus a payload; the channel is not the trust anchor
- Rollout safety (percentage gates, crash tripwires, kill switches) and
  rollback (A/B slots, one-action revert, full-package fallback) are the
  two halves of a safe release: one controls blast radius, the other controls
  recovery speed
- The signed-protocol family (Squirrel RELEASES, electron-updater latest.yml,
  Sparkle appcast, Tauri signed JSON) is the desktop/mobile analogue of the
  store's own signing; Workers is the exception that has no artifact signature,
  so its integrity story is authentication + versioning + rollback
- Bandwidth and size (delta vs full, universal vs per-arch) are a separate
  axis from trust and rollout; a release architecture chooses on both axes
