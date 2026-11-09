# AIRIZ Motor Console — Release Architecture Comparative Analysis

> **Scope.** Eight-dimension evaluation of the unified Windows + Android +
> iOS + PWA + Cloudflare Worker release architecture for AIRIZ Motor Console
> (`apps/airiz-motor/`). This brief is the comparative layer that feeds the
> architecture decision.
> **Audience.** Owner Juwen Lie (one-person team), Ziris PTB co-admins/testers.
> **Method.** Each dimension weighs the published tradeoffs against AIRIZ's
> specific constraints: hardware-adjacent desktop tool, already-deployed
> Tauri updater, PWA service worker, Cloudflare relay Worker, GitHub Releases
> publishing, "Safe auto-update" with 5-minute idle gate (1.11.22), and the
> documented gap that "the initial binaries are unsigned"
> (`apps/airiz-motor/README.md`).
> **Date.** 2026-11-04.

---

## (a) Delta vs full updates

**Bandwidth reality, with real numbers.**
Chromium's Courgette design doc gives the canonical reference: a Chrome
190.1→190.4 update weighed **10,385,920 bytes** full, **704,512 bytes** with
`bsdiff`, and **78,848 bytes** with Courgette — a **99.2% reduction** vs full
and an **88.8% reduction** vs plain `bsdiff`
([chromium.org — Software Updates: Courgette](https://www.chromium.org/developers/design-documents/software-updates-courgette/)).
Squirrel.Windows is the long-standing delta framework used by Slack, GitHub
Desktop, MSIX and Electron Forge apps; its goals document promises "delta
update packages" out of NuGet tooling
([Squirrel.Windows README](https://github.com/Squirrel/Squirrel.Windows)).
Tauri v2's updater ships a tarball/tar.gz or zip per platform, supports the
`bsdiff` delta algorithm, and explicitly notes per-platform artifacts
(`myapp.app.tar.gz.sig`, `myapp.msi.zip.sig`) — typical Tauri deltas in the
wild cut an 18 MB → 4 MB update to roughly **~1.5–3 MB**, i.e. a 70–85%
delta ratio, with `bzip2` on Linux and `zstd`/`brotli` on Windows/macOS
([Tauri v2 Updater docs](https://v2.tauri.app/plugin/updater/)).

**Complexity / rollback story.**
Delta generation requires base-binary pinning (every shipped binary is the
base for some future delta until released) and **mandatory** Ed25519 signing
with `minisign`; Tauri explicitly warns *"if you lose this key you will NOT
be able to publish new updates to the users that have the app already
installed"*
([Tauri v2 Updater — Signing updates](https://v2.tauri.app/plugin/updater/)).
Rollback to a delta whose base does not exist on the user's disk requires a
full-fallback chain — Chrome solves this by carrying both the full and the
delta, but most desktop updaters don't, and an unpinned user is
unrecoverable.

**Position for AIRIZ.**
Ship **delta updates on Windows (NSIS zip + bsdiff) and Linux (AppImage +
bz2/zstd)** via Tauri's updater, with the *full installer always published
alongside* so a delta can never strand a user. Keep the macOS `.tar.gz` full.
The 5-minute idle gate (1.11.22) is exactly the safety net delta-breaks need:
it lets the operator notice a hung update before the next launch attempt,
which is when the user is most exposed. Do **not** generate deltas on first
public release — the unsigned-binary gap means there is no base binary
history yet. Start full, accumulate v1.x as the delta base, then enable
deltas from v2.x onward.

**Citations used in (a):** Chromium Courgette design doc (full
10,385,920 / bsdiff 704,512 / Courgette 78,848); Squirrel.Windows
README; Tauri v2 Updater docs (signing, dynamic endpoint,
`version_comparator`, `pubkey`); AIRIZ Motor Console README (5-min
idle gate, unsigned-binary gap).

---

## (b) Staged rollouts

**Mechanism, by surface.**
Windows desktop and PWA can do client-side staged rollouts via a manifest
version flag (Tauri: the dynamic-update endpoint can return `204 No Content`
or an older version, with `version_comparator` overridden to force
downgrades —
[Tauri v2 Updater — Dynamic Update Server](https://v2.tauri.app/plugin/updater/)).
Cloudflare Workers have **first-class gradual deployments**:
`wrangler versions upload` then `wrangler versions deploy` splits traffic
interactively between two versions, with
[version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)
to pin a user across the rollout window
([Cloudflare — Gradual Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)).
The store surfaces (App Store, Play Store) cannot stage — once Apple/Google
approves a build, every user gets it on next update check.

**Gates.**
Industry-standard phasing: **10% → 50% → 100%**, each gate held for an
observation window. A "kill switch" needs two layers: a server-side override
(the dynamic-update endpoint returns an older version) and a client-side
hard fallback (an `AppImage`/`-setup.exe` rebuild on the GitHub Releases
page, always pinned).

**Observability + decision latency.**
Sentry Release Health tracks crash-free sessions/users as a continuous
metric with **crash rate monitors** that fire when the percentage falls
below a threshold
([Sentry — Release Health](https://docs.sentry.io/product/releases/health/)).
Firebase Crashlytics offers **realtime alerts** for new/regressed/growing
issues plus BigQuery export for custom thresholds
([Firebase — Crashlytics](https://firebase.google.com/docs/crashlytics)).
End-to-end decision latency: a Sentry monitor can page in **≤5 minutes**,
but AIRIZ has no on-call rotation; a 1-hour "is this a real regression?"
window is more realistic for a solo dev. Cloudflare's gradual deployments
also expose `ScriptVersion` in Logpush so a relay bug can be tied to a
specific version
([Cloudflare — Gradual Deployments — Observability](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)).

**Position for AIRIZ.**
Stage **only the Cloudflare relay Worker** at 10% / 50% / 100% — it has the
cheapest rollback (just `wrangler rollback`, instant, no review) and the
highest blast radius if the relay breaks every connected AIRIZ console. For
Windows, use the **dynamic-update endpoint to stage the manifest** behind a
query parameter (`?channel=canary&min_version=1.11.22`) and keep GitHub
Releases as the "promote to 100%" button. **Do not stage the PWA beyond a
soft flag** — the service-worker update story (see topic (e)) makes
percentages unreliable. Skip staging on the stores; rely on TestFlight /
Play Internal track for pre-prod.

---

## (c) Crash-throttled rollback

**Signal stack.**
Three layers, each with different fidelity and lag. **Native crash** —
Sentry Release Health distinguishes `crashed` (hard crash) from `errored`
(handled) from `abnormal` (battery died, OOM kill) from `unhandled`
(unhandled error without process death)
([Sentry — Release Health — Session Status](https://docs.sentry.io/product/releases/health/)).
For Android, **ANR** (Application Not Responding) and **Firebase
Crashlytics' NDK + native crash reporters** give signal that pure JS
unhandled errors miss
([Firebase — Crashlytics](https://firebase.google.com/docs/crashlytics)).
For Web/PWA, **JS error rate per release** plus the Chrome `crashed`
lifecycle on the Web Serial disconnect path. Sentry explicitly says
*session data is NOT subject to inbound filters or sampling* — release-
health numbers are the trustworthy denominator for crash-free %
([Sentry — Sessions vs. Issues](https://docs.sentry.io/product/releases/health/)).

**Decision latency.**
Realistic bands for AIRIZ's one-person reality: 5 minutes is aspirational
(only achievable with a hot paging rotation); 1 hour is the working band —
long enough to spot noise, short enough that an actively-broken motor
console is fixed inside a working day. Sentry's adoption stage
recalculates every 6 hours over the last 6 hours
([Sentry — Adoption Stages](https://docs.sentry.io/product/releases/health/))
— that's the right cadence for *not* rolling back a noisy spike.

**False-positive traps.**
Network errors look like app errors in unfiltered Crashlytics (the
Cloudflare relay can flap and crash the relay client, not the app).
Device-specific ANRs (a single user with a dying battery) inflate the
crash-free denominator. Cloudflare version skew — Worker A on the new
version calling Worker B on the old version — produces intermittent
failures that *do not match* the new version's stack trace
([Cloudflare — Version skew between Workers](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)).
Mitigation: alert only on **statistically significant regressions vs. the
previous release** (Sentry's "regressed issue" detector) and a
**release-over-release drop in crash-free % ≥ 0.5%** as the throttle
threshold.

**Position for AIRIZ.**
Set Sentry crash-rate monitor to **release-over-release comparison with a
1-hour window, ≥ 0.5% drop, abort on trigger**. For PWA, gate on **JS error
rate per session ≥ 2x the previous 24-hour baseline** (the Web Serial
disconnect class needs separate filtering — it's network-shaped, not
app-shaped). For Cloudflare Worker, use **Cloudflare's `ScriptVersion`-
attributed 5xx rate per version**, alarm at **≥ 0.1% over 15 minutes** —
that's the most sensitive signal you can get without the relay itself
doing the alerting. **Hard rule:** never auto-rollback — only page, then
a human (Juwen) decides.

**Citations used in (c):** Sentry Release Health — Session Status;
Sentry Release Health — Sessions vs. Issues; Sentry Release Health —
Adoption Stages; Firebase Crashlytics (NDK + native reporters);
Cloudflare Gradual Deployments — Version skew between Workers.

---

## (d) Signed manifests

**Key custody options.**
Three practical tiers. (1) **GitHub Secrets** — the private key sits
encrypted at rest, accessible only to the Actions runner at build time.
Cheap, fits AIRIZ's one-person reality, but the secret is *only* as safe
as the GitHub org's access control. (2) **Cloud KMS / HSM** (AWS KMS, GCP
KMS, Azure Key Vault, or a YubiKey via Sigstore's PKCS#11 support —
[Sigstore — Hardware Tokens](https://docs.sigstore.dev/cosign/key_management/hardware-based-tokens/)).
Highest assurance, but adds a vendor to manage. (3) **Minisign key on an
encrypted USB + offline backup** — Tauri-generated `*.key` files are
designed for this workflow
([Tauri v2 — Signing updates](https://v2.tauri.app/plugin/updater/)).
Tauri's own warning is precise: *"if you lose this key you will NOT be
able to publish new updates to the users that have the app already
installed"* — same warning as Squirrel on Windows.

**Rotation cadence.**
For Tauri/Squirrel Ed25519 minisign keys, rotation is binary: ship one key
for the lifetime of v1.x, then on a major version bump (v2.0.0), mint a new
keypair and require users to install a "trust-anchor" build that contains
both old and new pubkeys. The Tauri plugin supports this directly:
`pubkey` is set in `tauri.conf.json` and the updater **will refuse to
install an update signed by a key whose public half doesn't match**
([Tauri v2 — Public key](https://v2.tauri.app/plugin/updater/)).
For Sigstore/cosign, keys are tied to OIDC identities via Fulcio (no long-
lived secret at all) and every signature is logged to Rekor — the
[transparency log](https://docs.sigstore.dev/logging/overview/) becomes
the revocation mechanism.

**Revocation.**
Three layers, in order of effort: (1) **CRL** (Certificate Revocation
List) for cert-based schemes — heavyweight to operate. (2) **OCSP**
(Online Certificate Status Protocol) — gives clients a freshness check;
Sigstore Rekor fulfils a similar role with cryptographic proof of
inclusion. (3) **Transparency log inclusion** — if the signed manifest
isn't in the log, it's not trusted. Sigstore is the only mainstream
stack that gives you all three nearly for free.

**Position for AIRIZ.**
**Use a single Tauri minisign keypair generated via `tauri signer
generate`, stored in GitHub Secrets + encrypted offline USB backup,
rotated only on a major-version boundary** (so v1.x ships one key, v2.x
gets a fresh one, and v1.x users must install a v1.x → v2.x transition
build that carries both pubkeys). This solves the documented "initial
binaries are unsigned" gap (`apps/airiz-motor/README.md`) with the
*minimum* operational surface area. Skip Sigstore/cosign for now — the
Tauri pubkey-in-config model is the simplest, works without an external
CA, and matches AIRIZ's solo-dev budget. Add a *manifest signed with a
separate key* (also in GitHub Secrets) for the Cloudflare Worker / PWA
version manifest so a stolen GitHub PAT can't roll back a Windows build
*and* a Cloudflare deploy in the same attack.

**Citations used in (d):** Tauri v2 Updater — Signing updates; Tauri v2
Updater — Public key; Sigstore — Hardware Tokens (PKCS#11/YubiKey);
Sigstore — Transparency Log (Rekor); Sigstore — About; AIRIZ Motor
Console README (unsigned-binary gap).

---

## (e) PWA service worker update traps

**The lifecycle, with citations.**
MDN: `skipWaiting()` "forces the waiting service worker to become the
active service worker", and is commonly called inside the `install`
event
([MDN — ServiceWorkerGlobalScope: skipWaiting()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)).
It only has effect if there is a *waiting* worker — i.e., a newer worker
is installed but the older active worker still has clients. The
`controllerchange` event fires on the **document** when it acquires a
new controller — clients can listen and reload themselves. The pattern
recommended by MDN: pair `skipWaiting()` with `Clients.claim()` to make
the new worker take over existing tabs on activation.

**Traps, in order of pain.**
(1) **The `skipWaiting` race**: calling `skipWaiting()` from `install`
can activate a worker *before* `clients.claim()` runs, and unhandled
requests can land on a half-initialised worker. (2) **Cross-tab fan-out**:
only one tab registers the worker; the others may serve stale `caches`
even after the new worker activates. AIRIZ's current `sw.js` is
`cache-first` (`apps/airiz-motor/web/sw.js`, per README "Service Worker:
Cache-first strategy, network fallback") — the staleness window is
unbounded. (3) **OOB cache**: the worker caches the entire app shell; if
a bug ships in v1 of the shell and v1 is cached on a user's first visit,
the bug persists until the user manually clears site data or the cache
TTL expires (if any). (4) **`controllerchange` not handled**: the page
does not auto-reload, so the user keeps using the *previous* controller
even after the new worker is active — they see stale UI until the next
hard reload.

**Mitigations the AIRIZ team has already shipped, partially.**
The PWA README explicitly notes "Service Worker: Cache-first strategy,
network fallback" — this is the most failure-prone of the cache
strategies. The desktop app has a 5-minute idle gate (1.11.22), but the
PWA does *not* — a bad PWA update can brick a phone browser mid-debug.

**Position for AIRIZ.**
Switch `sw.js` from **cache-first to stale-while-revalidate with a
versioned cache name** (`airiz-shell-v1.11.25`) so old caches self-evict
on bump. In `install`, do `self.skipWaiting()`; in `activate`, do
`clients.claim()` *and* send a `{type: 'SW_UPDATED'}` message to every
client; in the page, listen for `controllerchange` (or the postMessage)
and call `location.reload()`. Use a **network-first** strategy for
`app.js` (the high-churn file) and **cache-first** only for static
icons/fonts. Add a **"Reload to update" banner** that appears when
`navigator.serviceWorker.controller` differs from the latest installed.
Critically: ship a **feature kill-switch in `localStorage` keyed by
version** so a bad PWA release can be remotely disabled on the *next*
page load (via a manifest flag fetched network-first) — this is the only
PWA-side rollback knob Chrome does not give you for free.

---

## (f) Store vs sideload for mobile

**Review latency, by store.**
Apple's App Store review is gated by human reviewers; Apple's published
guidance is *"over 90% of submissions are reviewed in less than 24 hours"*
but first submissions, apps with in-app purchases, apps rejected on prior
submissions, and apps flagged for guideline concerns routinely take
**2–7 days**
([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
Play Store internal testing is **minutes**; closed tracks are **hours**;
production review historically completes **within hours** for clean
submissions and can extend to **several days** for new developer
accounts or policy flags
([Google Play Console](https://developer.android.com/distribute/console)).
Enterprise sideload on Android is unrestricted if the APK is signed with
the org's enterprise cert (Android Enterprise, MDM) or distributed as a
plain signed APK — Chrome OS, Android Automotive, and Android 14+ all
have added *registered app store* rules that push back on fully-
sideloaded installs on consumer devices.

**Tradeoffs for a hardware-adjacent app.**
AIRIZ is not a typical mobile app — it's a *test bench* for a USB serial
motor console. The Android path is partially covered by Chrome's WebUSB
in mobile Chrome (the AIRIZ `Phone instead of PC` 1.11.0 build), and iOS
has *no* WebUSB at all (Apple's WebKit doesn't expose USB serial). So
the iOS path is **either** TestFlight (90 days max, App Store required)
**or** a sideloaded enterprise IPA (requires an Apple Developer
Enterprise Program enrollment at **$299/yr** vs the standard **$99/yr**)
([Apple Developer Enterprise Program](https://developer.apple.com/programs/enterprise/)).
TestFlight caps at 10,000 external testers and has a strict 90-day
build expiry — fine for Ziris PTB, painful for end-user-style
distribution.

**What store review really buys you.**
Auto-update delivery (no user action), consumer trust, and
discoverability. AIRIZ doesn't need any of these — the user is an
engineer with a serial cable.

**Position for AIRIZ.**
**iOS: TestFlight only, no App Store submission**. Use the
`juw12/projects` GitHub org as the tester list source, accept the 90-day
build expiry as the release cadence, and treat App Store as a future
option if the product ever gets a consumer-grade UI. **Android: ship a
signed APK via GitHub Releases, sideloaded**, with documented
`adb install` instructions for Ziris PTB. For wider distribution, *also*
publish the Android app to the Play Store internal testing track so
testers can opt-in via a one-time link — Play internal review is fast
and free. **Do not pursue Android Enterprise / Apple Enterprise certs**
— they are designed for companies distributing to *employees*, not for
a hobbyist project with 30 testers, and the audit/admin overhead is
disproportionate. The README's note that the iOS path is "iPhone: open
in this site in Bluefy" remains the *only* viable consumer-grade iOS
path until AIRIZ becomes a shippable App Store product.

**Citations used in (f):** App Store Review Guidelines; Apple Developer
Enterprise Program; Google Play Console; AIRIZ Motor Console README
(no WebUSB on iOS, WebUSB via Chrome on Android, Bluefy fallback).

---

## (g) Signed Cloudflare Worker deploys

**Wrangler + version pinning.**
Cloudflare Workers ship via `wrangler`. A *version* is an immutable,
addressable artifact uploaded with `wrangler versions upload`; a
*deployment* routes traffic to one or more versions. The minimum-
required Wrangler version for gradual deployments is **3.40.0**
([Cloudflare — Gradual Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)).
Wrangler versions before 4.131.0 may error out on Durable Object
migrations with code `10211` — pin a recent Wrangler (≥ 4.131.0) in
`package.json` so the AIRIZ relay builds are reproducible. Cloudflare
dashboard deployments can also create versions via *Save* (vs. *Deploy*)
and roll back from the **Deployments** tab via the three-dot menu
([Cloudflare — Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)).

**Gradual deployments, by the numbers.**
Up to **100** recently-uploaded versions can be in a gradual deployment,
and you can roll back to any of the **last 100 published versions**
([Cloudflare — Gradual Deployments — Limits](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/);
[Cloudflare — Rollbacks — Limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)).
Version affinity is available to pin a user to one version across the
rollout window. Version skew is real: *consecutive requests from the
same user — including page reloads and asset fetches — can be handled
by different versions*
([Cloudflare — Version skew within a Worker](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)).
Service bindings can be pinned with version overrides for inter-Worker
skew.

**Durable Object state migration on rollback.**
This is the trap. Cloudflare explicitly warns: *"You cannot roll back
to a previous version of your Worker if the Cloudflare Developer
Platform resources (such as KV and D1) have been deleted or modified
between the version selected to roll back to and the version in the
active deployment"* and *"A Durable Object class lifecycle change (via
exports or the legacy migrations array) has occurred between the
version in the active deployment and the version selected to roll back
to"*
([Cloudflare — Rollbacks — Bindings](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)).
Translation: if AIRIZ's relay Worker adds a new DO class in v2 and v1
was rolled back to, the v2 class stays *live* but is unreachable —
orphaned state. If v1 → v2 added a new required field in DO storage, a
rollback to v1 reads garbage.

**Position for AIRIZ.**
The AIRIZ relay is currently a thin signaling layer (per the README:
rooms-by-code, camera relay via PeerJS); it likely has Durable Objects
for the per-room state. **Adopt the Cloudflare gradual deployment
workflow as the default** for the relay — `wrangler versions upload`
then `wrangler versions deploy` at 10% → 100% — because it gives a
one-command rollback that is faster than any other surface in the
architecture. **Treat DO schema changes as one-way doors**: any version
that changes DO class shape must be promoted via `wrangler deploy` (not
via gradual deployment) so the migration is observable, and a
`wrangler rollback` cannot silently strand the new schema. Add a
**schema-version field in the DO storage payload** and have the Worker
refuse to read a payload it does not understand — that turns "orphaned
class" into a recoverable runtime error instead of data corruption.
Finally, **sign Worker deploys** by storing the Cloudflare API token in
GitHub Secrets and tying the deploy to a GitHub Actions workflow with a
*required* CODEOWNERS approval — that gives an out-of-band audit trail
similar to a signed manifest for the desktop builds.

**Citations used in (g):** Cloudflare Gradual Deployments (Wrangler ≥
3.40.0); Cloudflare Gradual Deployments — Limits (100 versions);
Cloudflare Rollbacks (rollback procedure); Cloudflare Rollbacks —
Limits (100 versions); Cloudflare Rollbacks — Bindings (DO class
lifecycle blocker); Cloudflare Gradual Deployments — Version skew
within a Worker; Cloudflare Version affinity; Cloudflare Version
overrides.

---

## (h) Multi-arch single bundle vs fat-binary per platform

**The two patterns.**
(1) **Multi-arch single bundle**: one GitHub Release tag, one artifact
set, every platform's binary inside (or parallel-listed in a static
`latest.json`). Tauri + the GitHub Action generator produce exactly this
— a single `latest.json` points to `windows-x86_64`, `darwin-x86_64`
(or `darwin-aarch64`), `linux-x86_64` etc. with each platform's
signature file. (2) **Per-platform binary**: each platform produces its
own signed artifact that is independent of the others — Windows gets a
`setup.exe` signed by a code-signing cert + an Authenticode timestamp;
macOS gets a `.app.tar.gz` signed with an Apple Developer ID + notarized;
Android gets an `.aab` or `.apk` signed with a Play upload key; iOS gets
an `.ipa` signed by the App Store distribution cert.

**Tradeoffs.**
Single bundle = one publish event, one rollback decision, one source-of-
truth manifest — operationally the lightest. But the *signing primitives
are per-platform*: Windows wants Authenticode (`.pfx` + `signtool`),
macOS wants `codesign` + `notarytool`, Android wants a Play upload key
(JKS), iOS wants an App Store distribution cert + provisioning profile.
**A single artifact cannot be cross-signed** — a Windows code-signing
cert cannot sign a macOS `.app`, full stop. The Tauri docs explicitly
list per-platform sign config —
[Tauri v2 — Sign macOS](https://v2.tauri.app/distribute/sign/macos/),
[Windows](https://v2.tauri.app/distribute/sign/windows/),
[Linux](https://v2.tauri.app/distribute/sign/linux/),
[iOS](https://v2.tauri.app/distribute/sign/ios/),
[Android](https://v2.tauri.app/distribute/sign/android/) — confirming
the platform split is real. Bundle size: a single tarball with all
binaries in it is roughly the *sum* of the per-platform artifacts (no
savings), unless you only ship the platform-specific subset via Tauri's
`{{target}}-{{arch}}` URL template
([Tauri v2 — Tauri Configuration](https://v2.tauri.app/plugin/updater/)).

**The AIRIZ-specific factor.**
AIRIZ today ships only Windows x64 (the README: "A downloadable Windows
x64 desktop edition"). The signing cert for Windows is the only
platform cert in play. Adding macOS / Linux later means *each* new
platform cert is a separate procurement (Apple Developer Program at
$99/yr; Windows EV or OV code-signing cert at $200–$700/yr; Play
Developer account at $25 one-time). The cost is dominated by cert
procurement, not by build complexity.

**Position for AIRIZ.**
Use a **single GitHub Release per AIRIZ version, with per-platform
signed artifacts in that release, and a `latest.json` (static Tauri
updater format) that references each `{{target}}-{{arch}}` URL** —
this is the *multi-arch single bundle* pattern at the release level and
*fat-binary per platform* at the artifact level. Concretely:
`airiz-desktop-v1.12.0` release contains `setup.exe`
(Authenticode-signed) + `setup.exe.sig`, `airiz.app.tar.gz` (notarized)
+ `.sig`, `airiz.AppImage.tar.gz` + `.sig`, plus the matching
`airiz.apk` (Play-signed) and `airiz.ipa` (App Store-signed). The
updater only ever fetches the artifact matching its own platform — so
users see no extra bandwidth cost. **Do NOT** try to build one universal
`.exe` that runs on Windows + macOS — that's not a thing Tauri supports
for desktop. **Do** gate the macOS / Linux / mobile artifact generation
behind explicit `--target` flags in CI, so a Windows-only regression
doesn't accidentally break a macOS build that nobody is testing. This
is the right balance for a one-person team: one release per version
(operational simplicity), one signing cert per platform (technical
reality), no per-platform-only pipeline to maintain.

**Citations used in (h):** Tauri v2 Updater — Tauri Configuration
(`{{target}}-{{arch}}` template); Tauri v2 Sign macOS / Windows /
Linux / iOS / Android (per-platform cert requirements); AIRIZ Motor
Console README (current Windows-x64-only desktop shipping state).

---

## Cross-cutting summary

| # | Dimension | Primary recommendation | AIRIZ-specific constraint honored |
|---|-----------|------------------------|-----------------------------------|
| a | Delta vs full | Delta on Win/Linux from v2.x onward, full fallback always | 5-min idle gate (1.11.22) already there as safety net |
| b | Staged rollouts | Stage the Cloudflare Worker at 10/50/100; manifest-flag Windows; skip on stores | Solo-dev latency budget (1h, not 5min) |
| c | Crash-throttled rollback | Sentry release-over-release, 0.5% drop, 1h window; never auto | One-person team, no on-call rotation |
| d | Signed manifests | Tauri minisign + GitHub Secrets + offline USB; rotate on major version | Solves the documented unsigned-binary gap |
| e | PWA SW update traps | stale-while-revalidate + versioned cache + `controllerchange` reload + kill-switch in localStorage | AIRIZ sw.js is currently cache-first — needs the rewrite |
| f | Store vs sideload | TestFlight iOS + signed-APK Android + Play internal track | Hardware-adjacent user base, no consumer UI |
| g | Signed Worker deploys | `wrangler versions deploy` + DO schema-version field + GitHub Secrets | Relay DO state migration is the real risk |
| h | Multi-arch single bundle | One Release per version, per-platform signed artifacts, Tauri `{{target}}-{{arch}}` lookup | Single signing cert (Windows) today, more as the matrix grows |

**Top three followups before any architecture decision locks in:**

1. **Sign the Windows builds** — the documented "initial binaries are
   unsigned" gap is the largest single risk in the matrix and unblocks
   topic (a).
2. **Rewrite `sw.js` from cache-first to stale-while-revalidate with a
   versioned cache name** — this is a 30-line change that addresses the
   largest PWA failure mode before AIRIZ ever ships a breaking web
   change.
3. **Add a `schema_version` field to every Durable Object payload**
   before the relay's next DO class change — this is a 5-line change
   today that prevents data corruption during a future rollback.

---

## Source index (full URLs)

- Chromium Courgette design doc (numbers: full 10,385,920 / bsdiff
  704,512 / Courgette 78,848 for 190.1→190.4) —
  https://www.chromium.org/developers/design-documents/software-updates-courgette/
- Squirrel.Windows repository (delta-update framework, 8k stars) —
  https://github.com/Squirrel/Squirrel.Windows
- Tauri v2 Updater (signing, dynamic endpoints, `version_comparator`,
  rollback, `pubkey`) — https://v2.tauri.app/plugin/updater/
- Tauri v2 Sign per-platform —
  https://v2.tauri.app/distribute/sign/{macos,windows,linux,ios,android}/
- Cloudflare Workers — Gradual deployments (Wrangler ≥ 3.40.0,
  100-version limit, version affinity, version skew, DO caveat, Logpush
  `ScriptVersion`) —
  https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/
- Cloudflare Workers — Rollbacks (100 versions, bindings/DO migration
  blocker) —
  https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Cloudflare Workers — Version affinity —
  https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/
- Cloudflare Workers — Version overrides —
  https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/
- MDN — `ServiceWorkerGlobalScope: skipWaiting()` —
  https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting
- Sentry — Release Health (sessions, crash-free %, abnormal/crashed/
  errored/unhandled/healthy, 30s background rule, crash rate monitors,
  6h adoption stage, sessions-vs-issues) —
  https://docs.sentry.io/product/releases/health/
- Firebase — Crashlytics (realtime alerts, custom alerts, BigQuery
  export, Play integration) — https://firebase.google.com/docs/crashlytics
- Sigstore — About / Hardware Tokens / Transparency Log / Fulcio /
  Cosign — https://docs.sigstore.dev/about/,
  https://docs.sigstore.dev/cosign/key_management/hardware-based-tokens/,
  https://docs.sigstore.dev/logging/overview/
- Apple App Store Review Guidelines —
  https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Enterprise Program —
  https://developer.apple.com/programs/enterprise/
- Google Play Console — https://developer.android.com/distribute/console
- AIRIZ Motor Console README (current state, "Safe auto-update"
  1.11.22, "binaries are unsigned", "cache-first strategy") —
  `apps/airiz-motor/README.md` in the local monorepo.
