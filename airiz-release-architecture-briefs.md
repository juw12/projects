# AIRIZ Motor Console — Unified Release Architecture: Eight Design-Knob Briefs

Context: one codebase, four shipping targets (Electron/Windows, Capacitor Android/iOS, PWA/Web, Cloudflare Workers). The owner must pick a unified release architecture. The eight topics below are independent design knobs; each has a tradeoff, a 2026 best answer, a residual risk, and one sentence on what it means for AIRIZ.

How to read this file:
- Each section (a)-(h) carries a narrative of roughly 200 words split into Tradeoff / 2026 best answer / Residual risk / AIRIZ implication.
- A Concrete (2026 tooling) block follows each narrative with the real commands or config that implement the answer.
- A Source line names at least one real, findable source per topic (exact URL where stable, doc title plus vendor otherwise).
- The reported (NNN words) is computed over the four labeled paragraphs only, including their label words.
- No section recommends the whole architecture; the decision is decomposed into eight pre-commits plus a cross-topic tension map.

Scope and assumptions:
- 2026 best answer means the operationally lowest-regret choice given tooling maturity as of late 2025, not a single vendor lock-in.
- AIRIZ is assumed to serve internal/enterprise operators plus a consumer PWA/web footprint.
- All four targets are assumed to consume one versioned, signed artifact graph.
- Where a fact depends on vendor policy that can change, the brief names the policy rather than hard-coding a date.
- Word counts exclude code blocks, source lines, the Concrete label, and the (NNN words) line.

---

## The eight briefs

### (a) Delta vs full updates

Knob: how much of a new build the client downloads versus recomputing locally.

**Tradeoff.** Deltas (bsdiff-style) cut transfer 70 to 90 percent by moving only changed blocks, but the server must generate patches and the client must apply them transactionally, so a failed apply risks a corrupt install. Full updates are simple and recoverable by redownload, yet waste bandwidth and slow time-to-update. Deltas pay off when the artifact is large and successive versions differ little, the normal case for a bundled Electron app.

**2026 best answer.** Ship the full signed bundle as the source of truth and layer bsdiff or zsync only on large, infrequently-changing assets such as the renderer bundle and heavy native libraries. Compute deltas at build time, pin each patch to its source and target hashes, and keep the client able to fall back to a full download on any checksum mismatch. Prefer bsdiff over Courgette because it is easier to audit and operate.

**Residual risk.** Silent corruption: a delta applies, local checksums pass, but an interrupted client left a hybrid binary. The fix is per-block hashes plus a full-integrity pass before launch, and a hard rule that any integrity failure forces a full redownload.

**AIRIZ implication.** Generate deltas only between adjacent released versions, gate them behind the signed manifest, and make a bad delta unable to bypass signature or integrity checks.

**Concrete (2026 tooling).**
```bash
# build-time delta generation (CI side), never client-side
bsdiff  old/app.asar  new/app.asar  app.asar.bspatch
sha256sum app.asar.bspatch | awk '{print $1}' > patch.sha256
# client: apply then verify; any failure -> full download
bspatch old.app.asar new.app.asar patch.bspatch || download_full_bundle()
# zsync for large stable assets (incremental resume)
zsyncmake assets/bundle.zip assets/bundle.zsync
# manifest pins both endpoints: patch.source_hash=<old sha256> / patch.target_hash=<new sha256>
```

**Source.** Colin Percival, *bsdiff* (2003), daemonology.net/bsdiff; zsync (Andreas Schenka), zsync2.github.io; Courgette (block-level binary differencing in Chromium's Omaha update engine).

(212 words)

### (b) Staged rollouts

Knob: what fraction of the fleet sees a new version, and how fast it can be advanced or halted.

**Tradeoff.** Staged rollout trades time-to-reach-users against blast radius: a 10 percent gate catches a regression on a small cohort first, but it delays the rest of the fleet. The deeper problem is speed asymmetry: a Worker version shifts by percentage in about thirty seconds, Play staged takes hours to days, and an App Store phased release can span two weeks, so one percentage cannot express a single policy.

**2026 best answer.** Express every rollout as one cohort predicate and map it to each target's native gate: Workers versions deploy --percentage, Play staged rollout, App Store phased release, and a LaunchDarkly or Unleash flag layer for in-app code. Advance the 10 to 50 to 100 ladder on release-health SLOs, not a calendar, defining the cohort as device-class plus version plus region. Keep the kill switch on a separate path, because flags are your only fast lever.

**Residual risk.** Cohort drift is the trap: too broad and a bad region looks green overall, too narrow and you get noise and cannot trust the gate. Sentry Release Health only helps if you instrument the exact keys you gate on.

**AIRIZ implication.** Pick one cohort schema and one flag provider now, and drive both the Worker percentage and the store percentage from the same green-red signal.

**Concrete (2026 tooling).**
```text
# one cohort predicate, four targets
cohort := { device_class, app_version, region }

# Cloudflare Workers (fast, ~30s to flip)
wrangler versions deploy 12 --percentage 10
wrangler versions deploy 12 --percentage 50
wrangler versions deploy 12 --percentage 100

# Play staged rollout (hours-days)   /   App Store phased (up to 2 weeks)

# feature flags gate in-app risky code (LaunchDarkly / Unleash)
flag: airiz.new_parser  -> 10% -> 50% -> 100%

# advance only on SLO, not calendar
advance() if crash_free >= 99.5% and error_rate <= 0.5% per cohort
```

**Source.** Cloudflare Workers *Versions and deployments* (developers.cloudflare.com); Google Play Console *Staged rollouts*; Apple *Phased release* (App Store Connect); Sentry *Release Health*; Unleash and LaunchDarkly rollout docs.

(212 words)

### (c) Crash-throttled rollback

Knob: the signal and decision loop that takes a bad release off the fleet automatically or on a human tap.

**Tradeoff.** The tradeoff is speed against false positives: an automated rollback that watches crash-free sessions or per-cohort error rate can pull a bad build in under five minutes, but a fast trigger also fires on a network blip or a flaky device class. A human decision is safer against noise but adds minutes to hours, unacceptable when a Worker throws on every request.

**2026 best answer.** Run two gates in series, not one: a minimum cohort size so a small segment cannot trigger alone, then a sustained breach, say crash-free below 99.5 percent against the previous release baseline or error rate above 0.5 percent, held for a short debounce window. Auto-rollback for fast, reversible targets like Workers and PWA, and require a human for store channels where rollback is slow. Cite the baseline, not an absolute.

**Residual risk.** The failure mode is a correlated false signal, a regression in your metrics pipeline, a tag change or sampling shift, that looks like a crash spike and tears down a good version. Guard with a canary of the metrics path and log the exact breach that fired.

**AIRIZ implication.** Separate the auto path, web, PWA and Worker, from the human path for the stores, and feed both from the same per-cohort Sentry baselines.

**Concrete (2026 tooling).**
```python
# Sentry Release Health thresholds, evaluated per cohort
def should_rollback(cohort, baseline):
    if cohort.session_count < 1000:      # gate 1: min cohort size
        return False
    cf = cohort.crash_free_sessions
    er = cohort.error_rate
    breach = (cf < baseline.crash_free - 0.5) or (er > 0.005)
    if not sustained(breach, window="90s"):  # gate 2: debounce
        return False
    return True

if target in ("worker", "pwa"):
    rollback(auto=True)                  # sub-5 min
else:                                    # play / appstore
    page_oncall(); rollback(auto=False)  # HITL
```

**Source.** Sentry *Release Health* and *Crash-free release* docs (docs.sentry.io/product/releases/release-health); Sentry alerting on error rate and crash-free percentage.

(211 words)

### (d) Signed manifests

Knob: who signs the artifact graph, where the key lives, and how you rotate or revoke it.

**Tradeoff.** A signed manifest turns download a file into verify a build, but the key becomes a high-value target, so the tradeoff is convenience against custody. A key on a runner is fast to use and instant to leak; an HSM, Azure Key Vault, AWS CloudHSM, GCP KMS or a YubiHSM 2, keeps the key non-exportable and logs every call, but an HSM outage blocks release.

**2026 best answer.** Put the key in an HSM, never on the runner, and sign through cosign or AWS Signer so any target can verify. Store the manifest encrypted at rest and keep signing on an isolated path, a Tailscale-only box or hosted AWS Signer, so key material never sits with build logs. Rotate annually with a ninety-day overlap, and for revocation ship a new manifest carrying a list of revoked old-key identifiers.

**Residual risk.** Overlap-window drift is the real risk: rotate the key but forget to publish the new public key to every target, and clients on the older release reject the next update. The overlap must be enforced by the pipeline, not by a human remembering.

**AIRIZ implication.** Choose one HSM provider and one signature format now, and make the manifest the single object that also pins the delta hashes and the Worker WASM hash.

**Concrete (2026 tooling).**
```bash
# HSM-backed signing (Azure Key Vault / AWS CloudHSM / GCP KMS / YubiHSM 2)
cosign sign  --key "kv:airiz/manifest-signer" manifest.json
cosign verify --key airiz-pub.pem manifest.json
# air-gap: sign over a Tailscale-only box OR hosted AWS Signer (never co-locate key+logs)

# annual rotation with 90-day overlap
# 1. publish airiz-pub-v8.pem to all targets
# 2. sign with v8 for 90 days while v7 still trusted
# 3. retire v7

# revocation: new manifest carries old-key revocation list
manifest.revoked_keys = [ "key-id-v7" ]
```

**Source.** sigstore / cosign (docs.sigstore.dev); Yubico *YubiHSM 2*; AWS *Signer* and *CloudHSM*; Azure *Key Vault* HSM-backed keys; GCP *Cloud KMS* HSM-backed keys.

(213 words)

### (e) PWA Service-Worker update traps

Knob: how the browser swaps the running service worker for a new one without stranding tabs on stale code.

**Tradeoff.** A service worker is a network cache that outlives the page that installed it, so the update problem is a synchronization problem across four races: skipWaiting, where you skip waiting but the page is still on the old controller; controllerchange, where tabs adopt the new controller at different times; cross-tab fan-out, where tab A updates but tab B serves stale responses; and the out-of-band cache, where old entries are never purged.

**2026 best answer.** Treat the update as a versioned transaction. Use Workbox to precache a hashed runtime manifest so a new version is a new cache name, and on activate purge every cache not in the current keep-list to kill the out-of-band trap. Call clientsClaim so the new worker takes over existing clients, pair skipWaiting with an explicit page message, and listen for controllerchange to reload a tab the moment it flips. Broadcast a reload over a BroadcastChannel so every tab converges on the new controller.

**Residual risk.** The races compound: two tabs, a flaky network, and an out-of-band cache can strand a user on a stale build for days. Make stale detectable with a version stamp in the response.

**AIRIZ implication.** Bake Workbox versioning, clientsClaim, skipWaiting-by-message, controllerchange-reload, and BroadcastChannel fan-out into the PWA shell as a fixed contract, because retrofitting it after launch is hard.

**Concrete (2026 tooling).**
```js
import { clientsClaim } from 'workbox-core';
clientsClaim();                                   // take over existing tabs
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
// reload a tab the instant it flips to the new controller
navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
// cross-tab fan-out (BroadcastChannel, with fallback)
const bc = 'serviceWorker' in navigator ? new BroadcastChannel('airiz-sw') : null;
if (bc) bc.onmessage = (e) => e.data === 'reload' && location.reload();
// OOB trap: version cache names, purge stale on activate
workbox.precaching.precacheAndRoute(manifest);    // hashed entries
workbox.cleanupOutdatedCaches();
```

**Source.** Workbox documentation (developer.chrome.com/docs/workbox); MDN *Service Worker API* (skipWaiting, clientsClaim, controllerchange); MDN *BroadcastChannel*.

(218 words)

### (f) Store vs sideload for mobile

Knob: whether mobile updates go through the app stores or bypass them, and what that costs in speed, trust, and reach.

**Tradeoff.** The store gives trust and reach but gates you: App Store review plus phased release takes days to two weeks, Play takes hours to days. Sideload inverts that: an enterprise IPA or direct APK is instant, but Apple can revoke the certificate at any time, a risk seen in 2019, and Play Protect flags a sideloaded APK as unverified. TestFlight is the fast middle, capped at a hundred testers and a 90-day expiry.

**2026 best answer.** Treat the store as the consumer trust anchor and sideload as the internal fast path. Ship consumer builds through Play staged rollout and App Store phased release, and for internal operators who need a same-day fix, use a signed enterprise build signed with the same HSM manifest as the store build, so a sideloaded device is cryptographically identical; use TestFlight for pre-release QA.

**Residual risk.** The slow channel is the real risk: when a critical fix must reach a consumer and the store is the only trusted path, the hours-to-days delay is the price of trust. Keep the PWA/web target current so a waiting consumer still gets the fix in the browser.

**AIRIZ implication.** Pre-commit the sideloading policy, allow for enterprise and internal, forbid for consumer, and the TestFlight cadence now, because it fixes which builds you sign each cycle.

**Concrete (2026 tooling).**
```text
# speed-to-fix vs trust vs reach, by channel
Play staged rollout:    hours-days   (review)          consumer
App Store phased:       days, up to 2 wks              consumer
TestFlight:             hours         (100 testers, 90-day expiry)  QA/dogfood
Enterprise IPA:         instant       (Apple may revoke)             internal
Sideload APK:           instant       (Play Protect warns)           internal

# same HSM manifest signs store AND sideload builds (see topic d)
cosign sign --key "kv:airiz/manifest-signer" airiz-play.aab
cosign sign --key "kv:airiz/manifest-signer" airiz-enterprise.ipa
```

**Source.** Apple *iPhone Program* / outside-distribution docs (developer.apple.com) — states Apple may revoke at any time; 2019 enforcement widely reported; Google *Play Protect* and Play Console help (support.google.com); Apple *TestFlight* limits.

(217 words)

### (g) Signed Cloudflare Worker deploys

Knob: how a Worker version gets hashed, uploaded, staged, and rolled back, and how that fits the manifest.

**Tradeoff.** A Worker deploy is the fastest-moving part of the architecture. The Wrangler flow is deterministic: source compiles, optionally to WASM, the artifact is hashed, and the version uploads with metadata, then deploys at a percentage. Rollback is nearly instant because wrangler rollback just repoints traffic to the prior version. The risk is that a bad Worker then runs a different latest than the fleet.

**2026 best answer.** Treat the Worker like any other signed target. Hash the compiled WASM at build time and record that SHA-256 in the signed manifest, so a version is trusted only if its hash matches. Stage with wrangler versions deploy --percentage on the same cohort as the store, and advance 10 to 50 to 100 on green release-health. Pin the compatibility date and flags in version control so a behavior change is reviewable.

**Residual risk.** Compat-date drift: bumping the compatibility date can change Worker behavior, a fetch flag or a queueing semantic, without a code change, and a rollout will not surface a subtle regression. Pin the date and flags so any change is a tested deploy.

**AIRIZ implication.** Record the Worker WASM hash in the same signed manifest as the app bundles, and advance the Worker percentage from the same cohort gate so it never defines a latest the fleet does not share.

**Concrete (2026 tooling).**
```bash
# deterministic build -> hash -> upload
wasm build airiz-worker            # source -> WASM
sha256sum airiz-worker.wasm | awk '{print $1}' > wasm.sha256
wrangler versions upload --name airiz-worker
wrangler versions deploy <version-id> --percentage 10
wrangler versions deploy <version-id> --percentage 50
wrangler versions deploy <version-id> --percentage 100
wrangler rollback                  # instant: repoints to prior version
# pin runtime behavior in VCS (not a silent deploy)
# compatibility_date = "2025-10-01"  /  compatibility_flags = []
wrangler secret put DATABASE_URL   # secrets out of the artifact
# manifest pins: worker.wasm_hash=<sha256 from build>
```

**Source.** Cloudflare Workers *Wrangler* command reference and *Versions and deployments* (developers.cloudflare.com/workers/wrangler); Cloudflare *compatibility dates* docs.

(220 words)

### (h) Multi-arch single-bundle vs fat binary

Knob: whether each target ships one universal artifact or several per-architecture variants.

**Tradeoff.** A single universal bundle is easy to distribute, but it carries code for every architecture it must run on, so an arm64 phone downloads x64 code it never executes. Per-architecture builds are lean, but you sign N variants per OS and your manifest and CI matrix multiply by N. They also do not map cleanly across platforms: iOS has required arm64 since iOS 11, and Android's store splits by ABI.

**2026 best answer.** Decide per platform, not globally. On Android, ship an AAB and let Play Asset Delivery and store-side ABI splitting choose the right native library per device, so you author one upload but the store delivers the lean payload. On macOS, build a universal binary with lipo. On Electron and Tauri for Windows, build per-arch, x64 and arm64. Keep the manifest able to hold per-arch entries with their own hashes.

**Residual risk.** Variant sprawl: per-arch builds multiply the signing and integrity surface, and one forgotten architecture ships a build with no signed variant, so the client has nothing valid to install. The pipeline must generate and sign the full matrix or fail loudly.

**AIRIZ implication.** Pre-commit the per-platform strategy, AAB plus store splitting for Android, lipo universal for macOS, per-arch for Electron and Tauri Windows, now, because it fixes the manifest schema and CI matrix.

**Concrete (2026 tooling).**
```bash
# Electron (Windows): per-arch
electron-builder --win --x64
electron-builder --win --arm64
# (add --ia32 only if a 32-bit target is still supported)
# Tauri (Windows): per-target
cargo tauri build --target x86_64-pc-windows-msvc
cargo tauri build --target aarch64-pc-windows-msvc
# macOS: single universal via lipo
lipo -create app-x86_64 app-arm64 -output app-universal
# Android: one AAB upload; store splits ABI at install
# manifest holds per-arch entries: arch=x64 hash=<...> delta=<...> / arch=arm64 ...
```

**Source.** electron-builder architecture options (electron.build); Tauri *tauri build* targets (tauri.app); Apple `lipo` man page; Google Play *AAB* and *Play Asset Delivery* docs (developer.android.com).

(218 words)

## Cross-topic tension map

The eight knobs are independent only on the surface. Once the manifest, cohort, and key policy are shared, a change in one knob changes the blast radius of two or three others. The table below names, for each knob, the knobs it most strongly tensions with and the mitigation that keeps them from fighting.

| Row | Tensions with | Why it tensions | Mitigation |
| --- | --- | --- | --- |
| (a) Delta | (b) staged, (c) rollback | A bad delta looks like a bad rollout and a crash, so it can poison both the gate and the rollback signal | Gate deltas behind the same cohort gates and the same signed manifest as the full bundle; treat integrity-failure as a distinct signal from crash |
| (b) Staged | (g) Worker, (f) store | Worker percentage is instant and reversible; store percentage is slow and locked, so one policy cannot drive both | Drive both from one cohort predicate and one flag layer; reconcile each target's current percentage into the manifest |
| (c) Rollback | (a) delta, (b) cohort | Delta-apply corruption can be misread as a crash and fire an auto-rollback of a healthy build | Keep integrity-failure and crash on separate signals; require a cohort-size gate so one corrupt segment cannot trigger alone |
| (d) Manifest | (a) delta, (g) Worker, (h) arch | One object must pin the bundle, the delta, the Worker WASM hash, and N per-arch entries; key rotation must update all atomically | Make the manifest the single source of truth and rotate it as one transaction across all pinned hashes |
| (e) PWA | (b) staged, (c) rollback | Controllerchange means some tabs stay on the old worker, so a staged rollout or rollback never fully completes per cohort | Version every cache and response with a stamp, and fan out a reload over BroadcastChannel so cohorts actually converge |
| (f) Sideload | (b) staged, (d) manifest | Sideload bypasses the store gate, so the same code is trusted by the store and not by the sideload channel | Sign sideload builds with the same HSM manifest so trust is identical regardless of channel |
| (g) Worker | (b) staged, (c) rollback | Worker rollback is instant but bypasses store review, so the Worker and the fleet can disagree on latest | Pin the WASM hash in the manifest and advance Worker percentage from the same cohort gate as the store |
| (h) Multi-arch | (a) delta, (d) manifest | Per-arch variants multiply the manifest rows and the delta endpoints, so a missing arch breaks signature or integrity | Generate and sign the full arch matrix or fail loudly; give each arch its own hash and delta endpoint |

Non-obvious tensions (the ones not listed in the task's eight topics):

1. (c) versus (a): delta-apply corruption and a real crash are indistinguishable to a naive crash-rate signal, so auto-rollback can roll back a healthy version because a bad delta, not a bad build, caused the failures. This is the most dangerous cross-topic interaction, and it is not visible from any one topic in isolation.
2. (e) versus (b): a PWA staged rollout never truly completes, because controllerchange leaves some tabs on the old worker, so the per-cohort green-red signal is mixed across the service-worker boundary and the gate can read green while a fraction of tabs are still stale.
3. (d) versus (h): key rotation must be atomic across architecture variants, or there is a window where arm64 is signed by key v8 and x64 by key v7, and clients on the older release reject the mixed manifest.
4. (f) versus (g): the Worker's instant rollback can diverge from the store's slow version, so mobile and web users run different latest builds; the manifest is the only thing that keeps a single definition of latest across the fast and slow channels.
5. (a) versus (h): a delta is only as safe as its two endpoints, and with per-arch variants there are four endpoints, old and new times x64 and arm64, so the chance that one endpoint is a missing or unsigned variant rises with the arch matrix size.

## AIRIZ decision inputs

These are the pre-commits the owner must make before the build pipeline exists, because each one fixes a schema, a matrix size, or a trust boundary that is expensive to retrofit.

1. (d) Signed manifest and HSM are the trust root. Choose one HSM provider and one signature format first, because the manifest, the delta pins, the Worker WASM hash, and the per-arch entries all hang off it.
2. (b) Cohort definition is the second root. Fix the cohort schema, device-class plus version plus region, and one flag provider, because the Worker percentage, the store percentage, and the rollback gate all read the same predicate.
3. (c) Auto versus human-in-the-loop boundary. Pre-commit that web, PWA, and Worker roll back automatically in under five minutes while Android and iOS stores require a human, because that split is driven by reversibility, not by preference.
4. (a) Delta scope. Decide which assets get deltas and the integrity policy before CI, because it changes what the pipeline emits and what the manifest pins.
5. (h) Per-platform arch strategy. Decide AAB plus store splitting for Android, lipo universal for macOS, and per-arch for Electron and Tauri Windows, because it fixes the manifest schema and the CI matrix size.
6. (f) Sideload policy. Pre-commit whether sideloading is allowed for enterprise and internal and forbidden for consumer, and the TestFlight cadence, because it determines which builds are produced and signed each cycle.
7. (e) Service-worker contract. Commit to the Workbox versioning, clientsClaim, skipWaiting-by-message, controllerchange-reload, and BroadcastChannel fan-out contract, because it is the hardest of the eight to retrofit after launch.
8. Cross-cutting: one manifest, one HSM key, and one cohort predicate across all four targets. Treat that as the constraint the other seven knobs must satisfy, a pre-commit to make, not a finished design to hand to a builder.

## Tooling matrix (knob by target)

| Knob | Electron/Windows | Capacitor Android | Capacitor iOS | PWA/Web | Cloudflare Worker |
| --- | --- | --- | --- | --- | --- |
| (a) Delta | bsdiff on asar | zsync on AAB assets | bsdiff on IPA | Workbox precache | n/a (small) |
| (b) Staged | custom manifest gate | Play staged rollout | App Store phased | flag layer | versions deploy --percentage |
| (c) Rollback | auto on integrity | HITL (store slow) | HITL (store slow) | auto (flag off) | wrangler rollback |
| (d) Manifest | cosign + HSM | cosign + HSM | cosign + HSM | cosign + HSM | cosign + HSM |
| (e) SW traps | n/a | n/a | n/a | Workbox + BroadcastChannel | n/a |
| (f) Channel | sideload (in-house) | Play + enterprise APK | App Store + enterprise IPA | n/a | n/a |
| (g) Worker deploy | n/a | n/a | n/a | n/a | wrangler versions |
| (h) Multi-arch | --x64 / --arm64 / --ia32 | AAB + ABI split | arm64 only | single | WASM single |

## Failure-mode catalog (what goes wrong, per knob)

- (a) Delta: interrupted apply leaves a hybrid binary; mitigation is per-block hashes plus a full-integrity pass before launch and a hard rule that any integrity failure forces a full redownload.
- (a) Delta: patch endpoints do not match a known-good build; mitigation is pinning source and target hashes in the manifest so the server refuses to serve the patch.
- (b) Staged: cohort too broad hides a bad region; mitigation is a per-region cohort dimension and a minimum per-cohort sample before a gate can read green.
- (b) Staged: advance on calendar instead of SLO; mitigation is gating the 10 to 50 to 100 ladder on release-health, not a date.
- (c) Rollback: a metrics-pipeline regression looks like a crash spike and tears down a good build; mitigation is a canary of the metrics path and logging the exact breach that fired.
- (c) Rollback: a tiny flaky cohort triggers a global rollback; mitigation is the minimum-cohort-size gate in series with the threshold gate.
- (d) Manifest: key rotated but the new public key not published to a target, stranding that target's clients; mitigation is the ninety-day overlap enforced by the pipeline.
- (d) Manifest: a revoked key is still trusted on old clients; mitigation is shipping a new manifest that carries the old-key revocation list.
- (e) SW: a tab never hears the update and serves stale content for days; mitigation is BroadcastChannel fan-out plus a version stamp in every response.
- (e) SW: old precached entries under the old cache name keep serving stale bytes; mitigation is purging all non-keep-list caches on activate.
- (f) Sideload: Apple revokes an enterprise certificate and the internal fleet loses its app; mitigation is keeping the PWA/web target current as the always-available fallback.
- (f) Sideload: Play Protect flags a legitimate internal APK; mitigation is signing it with the same HSM manifest and using a managed-APK distribution.
- (g) Worker: a compat-date bump changes runtime behavior with no code change; mitigation is pinning the date and flags in version control and treating a change as a tested deploy.
- (g) Worker: the Worker runs a different latest than the fleet; mitigation is recording the WASM hash in the manifest and reconciling the current version back into it.
- (h) Multi-arch: a new arm64 Windows machine has no signed variant to install; mitigation is generating and signing the full architecture matrix or failing the pipeline loudly.
- (h) Multi-arch: a universal bundle bloats the download for a single-arch majority; mitigation is per-arch builds for Windows and AAB store-side splitting for Android.

## Glossary of knobs and tools

- bsdiff / bspatch: a block-level binary diff and patch tool by Colin Percival; the default choice for delta updates because it is auditable and easy to operate.
- zsync: an incremental file-sync protocol that transfers only changed ranges, useful for resuming large stable assets across flaky links.
- Courgette: a block-level binary differencing technique used in Chromium's Omaha update engine; a reference design rather than a default tool.
- Manifest: the single signed object that pins the full bundle hash, the delta endpoint hashes, the Worker WASM hash, and the per-arch entries.
- HSM: a hardware security module that keeps a private signing key non-exportable; options include Azure Key Vault, AWS CloudHSM, GCP KMS, and YubiHSM 2.
- cosign / sigstore: an open signature format and tool that lets any target verify an artifact signature against a published public key.
- AWS Signer: a hosted HSM signing service usable as an air-gapped signing path without running your own HSM.
- Tailscale: a mesh VPN used here to isolate the signing box so key material never co-locates with build logs.
- Cohort: the release-health population you gate on; defined here as device-class plus app-version plus region.
- Release Health: Sentry's view of crash-free rate, error rate, and adoption per release and per cohort, used as the green-red signal for gates and rollbacks.
- LaunchDarkly / Unleash: feature-flag platforms that gate in-app code paths and act as the fast kill switch that store channels cannot match.
- wrangler versions: Cloudflare's versioning and percentage-deploy model for Workers, with instant wrangler rollback.
- Compatibility date: a Cloudflare Workers runtime-behavior pin; changing it alters behavior without a code change, so it must be version-controlled.
- Workbox: Google's service-worker library providing precaching, cache versioning, and activation hooks that avoid the PWA update traps.
- skipWaiting / clientsClaim / controllerchange: the three service-worker lifecycle hooks whose races cause stale-tab and stale-cache bugs.
- BroadcastChannel: a same-origin cross-tab message channel used to fan out a reload so all tabs converge on the new controller.
- AAB: the Android App Bundle format that lets Play Asset Delivery and store-side ABI splitting deliver the lean per-ABI payload.
- Play Asset Delivery: Play's mechanism for serving only the native library the device needs, making the developer-side per-arch decision partly moot.
- lipo: Apple's tool for creating a universal macOS binary from per-arch slices.
- TestFlight: Apple's pre-release QA channel, capped at one hundred external testers with a ninety-day expiry, used for dogfooding not production.

## References (one per cited source)

- (a) Colin Percival, bsdiff (2003), daemonology.net/bsdiff.
- (a) zsync (Andreas Schenka), zsync2.github.io.
- (a) Courgette, block-level differencing in the Chromium Omaha update engine (chromium source).
- (b) Cloudflare Workers, Versions and deployments, developers.cloudflare.com/workers/configuration/versions-and-deployments.
- (b) Google Play Console, Staged rollouts, support.google.com/googleplay/android-developer.
- (b) Apple, Phased release, App Store Connect developer documentation, developer.apple.com.
- (b) Sentry, Release Health, docs.sentry.io/product/releases/release-health.
- (b) Unleash and LaunchDarkly rollout documentation, unleash.io and launchdarkly.com.
- (c) Sentry, Release Health and Crash-free release, docs.sentry.io/product/releases/release-health.
- (d) sigstore and cosign, docs.sigstore.dev.
- (d) Yubico, YubiHSM 2 product documentation, yubico.com.
- (d) AWS, Signer and CloudHSM, docs.aws.amazon.com.
- (d) Azure, Key Vault HSM-backed keys, learn.microsoft.com.
- (d) GCP, Cloud KMS HSM-backed keys, cloud.google.com.
- (e) Workbox documentation, developer.chrome.com/docs/workbox.
- (e) MDN, Service Worker API (skipWaiting, clientsClaim, controllerchange), developer.mozilla.org.
- (e) MDN, BroadcastChannel, developer.mozilla.org.
- (f) Apple, iPhone Program and outside-distribution documentation, developer.apple.com (states Apple may revoke at any time).
- (f) 2019 Apple enterprise enforcement, widely reported by tech press (treat as policy-enforcement precedent, not a single paper).
- (f) Google, Play Protect and Play Console help, support.google.com.
- (f) Apple, TestFlight limits (100 testers, 90-day expiry), developer.apple.com.
- (g) Cloudflare Workers, Wrangler command reference, developers.cloudflare.com/workers/wrangler.
- (g) Cloudflare, compatibility dates documentation, developers.cloudflare.com/workers/platform/compatibility-dates.
- (h) electron-builder architecture options, electron.build.
- (h) Tauri, tauri build targets, tauri.app.
- (h) Apple, lipo man page, developer.apple.com/library.
- (h) Google Play, App Bundles and Play Asset Delivery, developer.android.com.

## Release sequence walkthrough (one release, all four targets)

1. A commit lands; CI builds every target in the arch matrix (per topic h) and the Worker WASM, in parallel.
2. CI hashes every artifact, the bundle, the per-arch entries, and the WASM, and records the hashes.
3. CI computes deltas for the assets chosen in topic (a), each pinned to a source and target hash.
4. The signer, an HSM via cosign or AWS Signer per topic (d), signs one manifest that pins all of the above.
5. The manifest is stored encrypted at rest and published to the update endpoint.
6. The Worker version uploads with its WASM hash and deploys at 10 percent on the shared cohort.
7. Play staged rollout and App Store phased release start from the same cohort definition.
8. Sentry Release Health begins measuring crash-free and error rate per cohort.
9. If every cohort is green for the debounce window, the ladder advances 10 to 50 to 100.
10. The PWA picks up the new manifest and, on activate, purges stale caches and fans out a reload.
11. If a cohort goes red, the fast path, Worker and PWA, rolls back automatically in under five minutes.
12. The slow path, the stores, pages on-call and a human confirms the rollback or holds.
13. The Worker current version is reconciled back into the manifest so latest stays single.
14. The release is marked done only when all four targets agree on the same latest version.

## Manifest schema (example)

```json
{
  "release": "airiz/2026.11.0",
  "signed_by": "kv:airiz/manifest-signer",
  "key_version": "v8",
  "revoked_keys": [ "key-id-v7" ],
  "cohort": { "dims": [ "device_class", "app_version", "region" ] },
  "slo": { "crash_free_min": 0.995, "error_rate_max": 0.005, "min_cohort": 1000 },
  "targets": {
    "electron": {
      "arch": {
        "x64":   { "bundle_sha256": "<...>", "delta": { "src": "<...>", "dst": "<...>" } },
        "arm64": { "bundle_sha256": "<...>", "delta": { "src": "<...>", "dst": "<...>" } }
      }
    },
    "android":  { "aab_sha256": "<...>", "abi": { "arm64": "<...>", "x86_64": "<...>" } },
    "ios":      { "ipa_sha256": "<...>", "arch": [ "arm64" ] },
    "pwa":      { "sw_version": "2026.11.0", "cache_keep": [ "airiz-v2026_11_0" ] },
    "worker":   { "wasm_sha256": "<...>", "version_id": "12", "pct": 10 }
  }
}
```

## When NOT to take the 2026 answer (counter-arguments)

- (a) Skip deltas entirely if the fleet is small or always on fast links; a full signed download is simpler and the bandwidth saving is not worth a patch pipeline.
- (b) Skip staged rollout if you have no real release-health instrumentation; a percentage gate you cannot read is worse than 100 percent with an honest error dashboard.
- (c) Never auto-rollback anything whose rollback has real cost, a store re-review or a forced client redownload; keep those human-confirmed even if it is slower.
- (d) Do not put the signing key in an HSM if you have no runbook for an HSM outage and no offline fallback, or the outage silently blocks every release.
- (e) Do not add the full Workbox fan-out contract for a single-tab tool; if users realistically have one tab, the BroadcastChannel machinery is more than you need.
- (f) Do not offer enterprise sideloading to a consumer product; if Apple revokes the certificate your users lose the app and you lose the trust the store bought.
- (g) Do not record the Worker WASM hash if the Worker is not user-facing and not part of the signed fleet; you only need it when the Worker must share latest with the rest.
- (h) Do not build per-arch for Windows if you have no arm64 Windows users yet; a single x64 bundle is simpler until arm64 Windows actually shows up in telemetry.

## Threat model (attacker -> control)

| Threat | Primary control | Backstop |
| --- | --- | --- |
| Tampered bundle in transit | signed manifest plus hash verify | full-download integrity pass |
| Bad delta applied | patch pinned to source and target hashes | integrity-failure forces full redownload |
| Rogue Worker version | WASM hash pinned in manifest | wrangler rollback |
| Signing key compromised on a runner | HSM-only signing | revocation list in the next manifest |
| Stale PWA build | SW version stamp plus fan-out reload | cleanupOutdatedCaches |
| Malicious sideload | same HSM manifest as the store | Play Protect plus managed distribution |
| Missing arch variant | full-matrix CI gate | pipeline fails loudly |

## Cohort and SLO reference

- Cohort dimensions: device_class, app_version, region. Never mix a Windows operator and an iOS consumer in one gate.
- Minimum cohort size before a gate reads green or red: 1000 sessions.
- crash_free_sessions: below (prior release crash-free minus 0.5 points) is red.
- error_rate: above 0.5 percent is red.
- Debounce window before any auto-rollback: 90 seconds sustained.
- Auto path: web, PWA, Worker. Human path: Play, App Store.

## Decision register

| Decision | Options | 2026 choice | Revisit trigger |
| --- | --- | --- | --- |
| Signing key custody | runner key / USB token / HSM | HSM, one provider | an HSM outage blocks release twice |
| Delta scope | none / full / asset-level | asset-level, renderer plus native libs | delta apply corruption observed |
| Rollback mode | all-auto / all-HITL / split | split by reversibility | a false auto-rollback in prod |
| Worker hashing | none / WASM hash | WASM hash in manifest | Worker diverges from the fleet |
| Windows arch | single / per-arch | per-arch, x64 plus arm64 | arm64 Windows hits a telemetry threshold |
| Android delivery | universal APK / per-ABI / AAB | AAB plus store ABI split | store policy or size change |
| Sideloading | none / internal / consumer | internal only | consumer demand with an enterprise gap |
| SW update contract | minimal / full fan-out | full fan-out | stale-tab reports persist |

## Target-by-target release profile

Electron/Windows:
- Ships per-arch (x64, arm64) signed bundles; delta on the asar.
- Rollback is fast and in-house (no store), so integrity failure can auto-rollback.
- Trust comes from the HSM manifest, not a store, so the manifest is the whole story.

Capacitor Android:
- Ships one AAB; the store splits by ABI at install.
- Rollback is human-gated and slow (Play review), so keep the PWA current as the fallback.
- Trust comes from Play signature plus the HSM manifest for internal builds.

Capacitor iOS:
- Ships arm64-only; no per-arch choice.
- Rollback is human-gated and slowest (App Store review plus phased release).
- Enterprise sideload is for internal only, signed with the same manifest.

PWA/Web:
- Ships a versioned service worker; no binary, no arch.
- Rollback is instant (flag off or repoint the manifest), fully automatic.
- The hard part is the SW update contract, not the signing.

Cloudflare Worker:
- Ships a hashed WASM version; deployed by percentage.
- Rollback is instant (wrangler rollback) but bypasses the stores, so it must reconcile into the manifest.
- The cohort gate and the WASM hash are what keep it honest.

## Failure drills to rehearse (tabletop, before launch)

- Inject a bad delta on one cohort and confirm the integrity signal, not the crash signal, triggers a full redownload.
- Simulate an HSM outage and confirm the fallback signing path or the hold-and-page behavior works.
- Flip a Worker to a red cohort at 100 percent and confirm the auto-rollback lands in under five minutes.
- Kill a cohort to below 1000 sessions and confirm no gate fires on the tiny segment.
- Straddle a key rotation and confirm a client on the older release accepts the next update during the overlap.
- Leave a PWA tab open across an SW update and confirm the fan-out reload converges it to the new controller.

## Cost of retrofit (per knob, if deferred past launch)

| Knob | If you defer it | Rough cost |
| --- | --- | --- |
| (a) Delta | add patch pipeline to CI later | medium, CI plus client changes |
| (b) Cohort | retrofit instrumentation and flag layer | high, every target must tag |
| (c) Rollback | add the auto path to a live system | medium, but risky |
| (d) Manifest | move an existing key into an HSM | high, key migration plus revocation |
| (e) SW | retrofit the fan-out contract to live users | high, stragglers stay stale |
| (f) Sideload | open a sideload channel later | medium, plus a trust policy change |
| (g) Worker hashing | start recording WASM hashes late | medium, old versions untrusted |
| (h) Multi-arch | add a missing arch variant later | low to medium, but a gap in coverage |

## Open questions for the owner

1. Which HSM provider, and is there a funded offline fallback for an outage?
2. Is there a real consumer mobile footprint, or is mobile internal and enterprise only?
3. What is the acceptable max time-to-fix for a consumer, and does the PWA fallback satisfy it?
4. Is arm64 Windows already present in the fleet, or is per-arch Windows speculative?
5. Who owns the metrics pipeline, and is there a canary for it to guard the rollback signal?
6. Is there one team that can run the 90-day key-overlap rotation without a human remembering it?

## Reading order for the owner

1. Read the Cross-topic tension map first; it is where the real risk lives.
2. Then the AIRIZ decision inputs; those are the pre-commits to make.
3. Then the eight briefs in order, a to h, for the detail behind each knob.
4. Then the Threat model and the Decision register before the build pipeline is written.
5. Keep the Verification section current and re-run the counts after any narrative edit.

## Assumptions register (validate before relying on this doc)

- All four targets consume one versioned, signed artifact graph.
- There is at least one consumer surface (PWA or store) distinct from internal/enterprise.
- Release-health data (Sentry) is instrumented with the exact cohort dimensions used to gate.
- The Worker is part of the signed fleet and must share latest with the rest of the targets.
- arm64 Windows is a real or near-term target, justifying per-arch Windows builds.
- An HSM (hosted or on-prem) is available and funded, with an outage runbook.
- The owner will make the sideloading policy decision once, not per release.
- Key rotation and revocation are owned by the release pipeline, not by individuals.

## Document control

- Title: AIRIZ Motor Console — Unified Release Architecture, eight design-knob briefs
- Version: 1.0, draft for owner decision
- Status: decision inputs only; no architecture is mandated
- Audience: the product owner choosing the unified release architecture
- Scope: eight design knobs (a)-(h) plus cross-topic tensions, decision inputs, and references
- Out of scope: a final architecture recommendation, a vendor purchase, or implementation code
- Last updated: 2026-11-05
- Counting rules: see the Verification section for word and line accounting

## Quick reference (which section answers what)

| Owner question | Go to |
| --- | --- |
| How do I keep one definition of latest? | Cross-topic tension map, row (g) |
| Which knob is the trust root? | AIRIZ decision inputs, item 1; topic (d) |
| How fast can I pull a bad build? | topic (c) plus Failure drills |
| What do I sign, and with what key? | topic (d) plus Manifest schema |
| How do I avoid stranding PWA users? | topic (e) plus When NOT to take the 2026 answer |
| May I sideload, and to whom? | topic (f) plus Decision register, Sideloading |
| How many build variants do I owe? | topic (h) plus Target-by-target release profile |
| What breaks if I defer a decision? | Cost of retrofit table |
| What do I rehearse before launch? | Failure drills to rehearse |
| Which assumptions must I validate? | Assumptions register |

## Verification (word and line accounting)

Counting rule: the (NNN words) per section is the token count of the four labeled paragraphs, from the Tradeoff line up to but not including the Concrete line, including the four label words. Code blocks, the Knob line, the Source line, and the (NNN words) line are excluded.

| Section | Declared | Computed | In 180-220 |
| --- | --- | --- | --- |
| (a) Delta | 212 | 212 | yes |
| (b) Staged | 212 | 212 | yes |
| (c) Rollback | 211 | 211 | yes |
| (d) Manifest | 213 | 213 | yes |
| (e) PWA SW | 218 | 218 | yes |
| (f) Sideload | 217 | 217 | yes |
| (g) Worker | 220 | 220 | yes |
| (h) Multi-arch | 218 | 218 | yes |

Total narrative words: 1721 (eight sections, each within 180-220; the 200 plus-or-minus-10 percent band spans 1440 to 1760 for all eight). Total file lines: 600 or more. The counts above are produced by a script over the file and should be re-run after any edit to a narrative.
