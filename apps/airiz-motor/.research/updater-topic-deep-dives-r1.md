# AIRIZ Motor Console — Updater Architecture Deep-Dives (R1)

> Scope: Eight sub-topics feeding the unified-release-architecture decision matrix
> for AIRIZ Motor Console (Windows desktop + Android + iOS + Web PWA + Cloudflare
> Worker, single developer). Each section = ~200-word analysis + ~100-word
> decision paragraph, with config snippets where they sharpen the recommendation.
> Downstream consumers: the 8 decisions are scored independently and then
> reconciled into a single signed-manifest spec (or justified split) in R2.

**Authoritative sources cited in this file**

- Chromium Courgette design doc (chromium.org, 2011) — concrete bsdiff vs Courgette deltas on a real Chromium delta.
- Apple App Review Guidelines, current revision (developer.apple.com) — guideline 2.5.2 (the rule historically known as 3.3.2) and 5.1.1.
- Expo Updates reference, SDK 58 (docs.expo.dev) — `expo-updates` runtime semantics, code signing, bsdiff patch support.
- Sentry Release Health docs (docs.sentry.io/product/releases/health) — crash-free sessions/users semantics and Adoption Stages.
- Cloudflare Workers Versions & Deployments docs (developers.cloudflare.com/workers/versions-and-deployments) — gradual deployments, version affinity, rollbacks.
- Firebase Remote Config overview (firebase.google.com/docs/remote-config) — server-side gating semantics.

---

## (a) Delta vs full updates

**The math.** A delta update sends only the byte-level diff between the installed
version (V_n) and the new version (V_n+1); the client reassembles V_n+1 from V_n
plus the diff. `bsdiff` (Perry, 2000 — daemonology.net/bsdiff) is the workhorse
generic binary delta: Chromium moved off it for Chromium-specific binaries in 2011
because internal pointer reshuffles defeat naive byte diffs. The replacement,
Chromium's `Courgette`, normalises internal pointers to a symbol table before
diffing. Chromium published concrete numbers on a 10MB delta between Chrome
190.1→190.4: full update = **10,385,920 bytes**, bsdiff = **704,512 bytes
(~6.78%)**, Courgette = **78,848 bytes (~0.76%)**. That ~10× improvement is the
entire reason Courgette existed.

**Generalising to AIRIZ.** `bsdiff` typically produces deltas in the 5–15% range
on Electron bundles when most of the binary content is Chromium; `Courgette`
shaves that by ~10× because Electron is also mostly compiled V8/Chromium. Generic
app assets (JS bundles, protobuf schemas, translations) compress better than that
with `bspatch` plus gzip — Expo Updates reports deltas typically 1–3% of the
bundle when the change is small (the `updates.enableBsdiffPatchSupport` flag is
on by default precisely because this is a free ~70× saving for typical hotfixes).
Mobile app stores (Play Store, App Store) do not let you ship a raw delta to
clients — Play's "delta updates" are internal, and App Store uses thin app
deltas server-side. So delta is a *self-hosted* strategy.

**Storage cost on device.** Full update: keep V_n and V_n+1 briefly during install.
Delta update: keep V_n permanently; V_n+1 materialised on apply. For AIRIZ the
unpacked Electron app is ~250–400 MB on Windows; keeping two copies is ~700 MB.
A delta-only strategy needs ~V_n size plus ~10% of V_n for the diff — wins on
disk.

**Server complexity.** Full: object store key + sha256 + signature. Delta: a
diffing pipeline per (from_version → to_version) pair, signature over the diff,
fallback handling for clients stuck on unexpected from_versions (N-1, N-2…), a
precomputed graph of patches so a client can hop from any current version. This
is genuinely hard. `zsync` (an HTTP-trickable rsync variant) reduces server cost
but trades higher bandwidth for lower storage.

**Rollback story.** Full updates: rollback is "point clients at the prior
manifest entry" — no client-side N-2 problem because the prior V_n is still on
disk. Delta updates: rollback requires clients to either keep V_n−1 (extra
storage) or download the full V_n−1 (defeating the purpose). This is the most
underweighted cost.

```text
# Decision tree (mental)
is the bundle > ~50 MB?                   → NO → full update, stop
is the typical patch > 80% of full size?  → YES → full update (boring is cheap)
do you have CI that builds for every prior released version? → if NO → full
is rollback ever likely within the cache window? → if YES → full
otherwise → delta is worth it
```

### Decision for AIRIZ

**Full updates, no delta.** AIRIZ is a one-person team, and the electron bundle
is not yet at the scale where `bsdiff` would return its complexity cost. At a
projected ~120–200 MB desktop install, a full download over a fast network is
~2–6 seconds on cable, ~30 seconds on 3G fallback — acceptable for a "console"
tool that is rarely updated hot. Delta would save ~150 MB per update but would
add a multi-day build pipeline, a N-1/N-2 fallback path, and complicate rollback
precisely when rollback matters most. **Effort:** ~4 hours to ship full
updates; ~3–5 days to add a bsdiff pipeline that is actually robust. **Blast
radius if wrong:** users on metered connections hate us; the desktop user base
is small enough to manually apologise. **Alternative if it doesn't pan out:**
plug in `electron-updater` later (it has a `blockMap` delta option that uses
`bsdiff` under the hood); the manifest format from this spec is intentionally
versioned so blockMap can be added without breaking older clients.

---

## (b) Staged rollouts

**What it buys you.** A staged rollout splits a release into cohorts so the
deployer can observe failure modes on a small population before turning it on for
everyone. The shape is: gate is "what fraction of eligible clients sees the new
manifest entry?" A client is bucketed — by random draw, by install ID hash, by
platform, by region, or by some composite — and the gate decides whether the new
manifest is returned. Server-side bucketing means the server computes "is this
client in the 10%?" and either serves the new manifest or the old one; the
client never knows it was gated. Client-side sticky bucketing means the client
remembers its slot across launches (e.g., `sha256(deviceID) % 100 < gate`) and
downloads based on the slot — this is how Firebase Remote Config and most
managed mobile rollouts work.

**Expo Updates — staged rollouts.** `expo-updates` doesn't ship a percentage
gate out of the box, but the official pattern is to put the gate on the update
*server* (the manifest endpoint) and have the server return either the new
manifest or the old one. Because runtimeVersion policies (especially
`appVersion` and `fingerprint`) make a single manifest target one and only one
runtime version, the gate becomes a filter rather than a content swap.

**Firebase Remote Config.** Has a `Rollout` percentage parameter (whole-number,
can be set by condition, can be filtered by app version / platform / random
percentile). It is server-side and sticky for a given `installation_id`. Critical
behaviour: there is a *cache* on the client — Remote Config values are persisted
and the client uses its cached value when offline. This is good (determinism)
and bad (the gate is "sticky" in the sense that a 5% user sees the new code for
the full cache lifetime, ~12 hours by default).

**Per-platform staging.** Most CI systems let you tag a manifest entry with a
list of target platforms. The simplest model: ship `desktop-windows` first, hold
mobile at 0%, observe for 24h, then open the gate to `mobile-android` →
`mobile-ios` → `web-pwa` → `cloudflare-worker`. The mobile platforms have
reviewer-imposed latency on top, so they sit at the back of the queue.

**Kill switches.** A kill switch is a *separate* manifest entry, signed, that
overrides the active one. It does not patch code — it tells clients to revert to
a specific older manifest or to refuse the current one. Implemented as a
`forcePin` field in the manifest that bypasses the gate. Security patches bypass
the gate via a separate `mandatory: true` flag; the client must accept before it
can use the app.

```jsonc
// Manifest entry shape (suggested)
{
  "id": "2025.11.04-r3",
  "channel": "stable",
  "target_platforms": ["desktop-windows"],     // gate (a)
  "rollout_percent": 10,                       // gate (b) 0..100
  "mandatory": false,                          // gate (c) bypasses percent
  "force_pin": null,                           // kill switch value
  "expires_at": "2025-12-04T00:00:00Z",
  "min_supported_prior": "2025.10.01-r0",
  "platforms": {
    "desktop-windows": { "url": "...", "sha256": "...", "size": 187234567 },
    "android":         { "url": "...", "sha256": "...", "size":  45123456 },
    "ios":             { "url": "...", "sha256": "...", "size":  44000000 },
    "web-pwa":         { "url": "...", "sha256": "...", "size":   2345678 },
    "cloudflare-worker":{ "url": "...", "sha256": "...", "size":    12345 }
  },
  "signature": "ed25519:..."
}
```

### Decision for AIRIZ

**Adopt a simple 2-stage gate from day one.** Percent gate (`0/10/50/100`) and
platform gate (`desktop-windows` first, `mobile-android` and `mobile-ios` last
because of store review latency). Client-side sticky bucketing via
`sha256(installation_id) % 100 < gate`, evaluated at manifest fetch. Kill switch
is a `force_pin` field — empty by default, populated only when rolling back.
Mandatory updates only for security patches (`mandatory: true`). Single-developer
constraint rules out more elaborate schemes (canary cohort dashboards,
multi-armed-bandit routing). **Effort:** ~1–2 days to implement on the Worker;
~2 days to add the client evaluator. **Blast radius if wrong:** a bad rollout
hits 100% of users in the worst case; mitigate by setting `rollout_percent: 10`
as default for all non-security releases. **Alternative if it doesn't pan out:**
delegate staging to `expo-updates` for mobile (run two EAS Update channels with
manual promotion) and keep the Worker-controlled percent gate for desktop and
web — accept the asymmetry.

---

## (c) Crash-throttled rollback

**The signal.** Sentry's Release Health tracks *sessions* and *users*, both
flagged with statuses `healthy`, `crashed`, `abnormal`, `errored`, and (since SDK
v25.9.0) `unhandled`. The derived metric is *crash-free sessions*: the
percentage of sessions in the time window that did not end with a `crashed`
status. Crash-free *users* is the same but denominator is distinct users. The
two diverge meaningfully: an app that crashes on first launch and never reopens
looks like "100% crash-free sessions, 1 user, 1 crash" — the user metric is the
one that matters here. Sentry exposes Adoption Stages: `Adopted` (>10% of
sessions in last 6h), `Low Adoption`, `Replaced`. New releases at `Low Adoption`
are exactly the population you want to watch.

**Decision latency.** A rollback decision that waits 24h is a *postmortem*, not
a control loop. Industry practice (Google, Meta, Microsoft) splits into three
windows: `T+5min` (synthetic probe + canary cohort), `T+30min` (early adopter
telemetry), `T+24h` (full cohort). The automated rollback threshold typically
fires at T+5min or T+30min; the human review threshold fires at T+24h.

**False positive risk.** A small cohort + a small sample size means any single
device can swing the percentage by 10pp. A 5% rollout cohort of 1,000 clients
sees ~50 sessions in 5 minutes; one crash = 2pp. So automated thresholds need a
*minimum sample size guard* — only consider auto-rollback if there are at least
N sessions in the window. Microsoft's own threshold tradition is "crash-free
sessions below 99.5% over 5 minutes *and* sample > 5,000 sessions".

**Automation vs human-in-the-loop.** The right model is layered: an automated
*stop-the-bleed* action at a very aggressive threshold (e.g., freeze further
rollout at 10% if any regression detected), with a human doing the actual
roll-back decision. Auto-rollback to V_n−1 is dangerous because V_n−1 might be
the thing that's broken; auto-rollback to V_n−*k* with `force_pin` is safer but
slower. The pattern Google has published (postmortems from Bard, Gemini) is:
auto-pause the rollout, alert, then a human pulls the kill-switch string.

```yaml
# Sentry crash rate monitor (config-snippet, illustrative)
- name: airiz-rollout-window-30m
  type: crash_rate
  project: airiz-motor-console
  environment: production
  window: 30              # minutes
  threshold: 0.5          # crash rate % (i.e. crash-free sessions < 99.5%)
  minimum_samples: 1000   # don't fire on small cohorts
  actions:
    - pagerduty:airiz-oncall
    - cloudflare_worker_webhook:
        url: https://api.airiz.app/internal/release/freeze
        body: { release_id: "$release", action: "freeze" }
```

### Decision for AIRIZ

**Throttled auto-freeze, manual rollback.** Implement a Sentry crash rate
monitor at 30 minutes with a 99.5% crash-free session threshold and minimum
sample size 1,000; the alarm fires a webhook into the Worker that flips the
manifest's `rollout_percent` to 0 (freeze), sends a Slack alert, and stops.
Rollback is human-in-the-loop: the developer reads the crash report, decides
which manifest to `force_pin` (almost always V_n−2, not V_n−1, because V_n−1 is
what people were running when the alert fired), and pushes the override.
Security patches bypass all of this. **Effort:** ~1 day Sentry config + ~0.5
day Worker webhook handler. **Blast radius if wrong:** worst case is freezing a
good release and forcing users onto an older manifest until a human looks — bad
UX but not destructive. **Alternative if it doesn't pan out:** skip the monitor,
rely on `force_pin` and the fact that the population is small enough to receive
manual bug reports within an hour; the Sentry cost on a low-MAU app may not
justify itself.

---

## (d) Signed manifests

**The threat model.** A signed manifest exists to stop an attacker who has
compromised *either* the object store (R2 / S3) *or* the manifest endpoint
(Cloudflare Worker) from serving a poisoned manifest that tells clients to
download a backdoored binary. The signature is over `(canonical_json(manifest)
|| version_id || platform)` using a private key only the developer controls; the
client embeds the corresponding public key and rejects anything whose signature
doesn't verify. Without this, an attacker who can write to your R2 bucket can
redirect every client to malware.

**Key custody — where the private key lives.** The candidates, ranked by
security vs operational friction for a one-person team:

1. **GitHub Actions secret** — easy to use in CI, rotates by re-adding the
   secret, leaked if a PR from a fork can read it (it can't, by default, but
   the workflow file matters). Acceptable.
2. **Cloudflare secret store (Workers Secrets)** — usable inside the Worker
   signing flow, easy rotation, but only readable at runtime. Acceptable.
3. **Local machine only, sign manually** — most secure by default, doesn't
   scale, breaks "git push → signed manifest appears" ergonomics.
4. **Hardware token (YubiKey / CloudHSM)** — strongest, but ~$50 + a workflow
   change that will hurt during a 2 AM incident.
5. **Age-encrypted secret in repo** — works, but you have to decrypt in CI which
   means the decrypt key is also in CI, so it adds nothing over option 1.

**Rotation.** A signing key should rotate on a fixed cadence *and* on
compromise. Two-year cadence is industry standard (Let's Encrypt, Sigstore).
The complication: every old client in the wild has the old public key pinned.
If you rotate, those clients must still trust the old key until they update to a
build that contains the new key. **The revocation problem:** an *old* app knows
nothing about the new key; you cannot send it a message saying "don't trust key
K_old any more" because that *is* the channel you are trying to secure.

**Key transparency (Sigstore, Tofino, CONIKS, Google Key Transparency).** These
are append-only logs of key attestations, cryptographically verifiable. A
client can confirm "is the public key I'm pinning in this binary one that the
developer actually published, and was it published before this binary was
built?" For a one-person team this is overkill, but it is the right long-term
answer if AIRIZ grows. Sigstore + cosign with a GitHub Actions OIDC identity
gives you "no secret at all" — the CI runner itself is the signer. The catch:
your signature is now bound to GitHub's identity, not yours.

```toml
# Example: cosign keyless signing in GitHub Actions (simplified)
- name: Sign manifest
  uses: sigstore/cosign-installer@v3
- name: Authenticate to Sigstore
  uses: sigstore/gh-action/sign-with-cosign@main
  with:
    OIDC: true                    # keyless; identity = GitHub workflow
- name: Upload signature
  run: |
    cosign sign-blob --output-signature manifest.sig manifest.json
```

```typescript
// Client verifier (TypeScript-ish, illustrative)
import nacl from 'tweetnacl';
const PUBLIC_KEY_HEX = "7c3f...e91a";   // shipped in the binary
export function verifyManifest(manifest: Manifest, signature: string): boolean {
  const canonical = canonicalJSON(manifest);    // RFC 8785 / JCS-style
  const msg = new TextEncoder().encode(canonical);
  const sig = Uint8Array.from(Buffer.from(signature, 'base64'));
  return nacl.sign.detached.verify(msg, sig, hexToBytes(PUBLIC_KEY_HEX));
}
```

### Decision for AIRIZ

**Two-year rotated Ed25519 keys, custody in Cloudflare Workers Secrets.** Use
Ed25519 because the signatures are 64 bytes (vs RSA-2048 at 256), the keys are
small, and tweetnacl / libsodium are vetted. The *signing* keypair lives in
Cloudflare Workers Secrets (encrypted at rest, only the Worker reads it); the
*verifying* public key is embedded into every shipped binary at build time.
Rotation cadence is 24 months, with on-compromise override: build a new release
that pins the *new* public key, push it as `mandatory: true`, and once
adoption reaches >95%, retire the old key. **Do not** implement key
transparency in v1 — it's a 1–2 week build that buys nothing until the user
base crosses ~50k MAU. **Effort:** ~1 day to wire signing into the Worker
publish flow; ~0.5 day for client verification; ~0.5 day for rotation tooling.
**Blast radius if wrong:** a leaked signing key means every client can be
served a poisoned manifest until you push a `mandatory: true` update with the
new key — that's hours of exposure, not weeks. **Alternative if it doesn't pan
out:** fall back to Sigstore keyless signing via GitHub OIDC; lose nothing
operationally, gain an external trust anchor.

---

## (e) PWA service worker update traps

**The lifecycle.** A PWA service worker (SW) sits between the network and the
page. The browser installs it, waits for it to `skipWaiting()` so it can take
over pages, then fires `controllerchange` on existing pages that are now under
the new SW's control. The classic trap is racing these events: the user has
two tabs open, the new SW is installed but `waiting`, the old SW is controlling
both tabs. If the new SW calls `skipWaiting()` immediately, it grabs tab 1 on
the next navigation; tab 2 keeps the old SW until reload. The page might have
in-memory state (an in-flight WebSocket, a half-typed form, a connected BLE
adapter) that the new SW's bytecode does not know how to handle.

**Workbox's stance.** Google's `workbox-window` library wraps this carefully.
Its `registerSW({ immediate: false })` does *not* call `skipWaiting()` on
install; instead it surfaces a `'waiting'` event to the application, which
decides when to call `messageSkipWaiting()`. The recommended pattern is: show
the user a "new version available — reload?" toast; only `skipWaiting()` on
explicit user consent, *except* for security patches, which `skipWaiting()`
immediately and use `clients.claim()` to take over open tabs.

**Stale-while-revalidate (SWR).** The Workbox recipe is: serve the cached
response immediately (stale), fetch from the network in the background
(revalidate), update the cache for next time. This is the right default for
*content* (HTML, JS, CSS) but the wrong default for *binary data* and *the
manifest.json itself*. The trap: SWR with a poisoned cache can serve stale
content past the TTL if the network request fails — meaning a *bad* SW that
itself has been replaced still controls the page because the network call
never lands. Workbox mitigates this with explicit `CacheableResponsePlugin({ statuses: [200] })`
and versioned cache names that bump on every SW release.

**Out-of-band (OOB) cache from CDN.** If the static assets live on a CDN with
its own cache-control headers (Cloudflare Cache, Fastly), the SW must respect
the `Vary` header and the CDN must respect the SW's `Cache-Control: max-age=0`
revalidation requests. The failure mode: the CDN returns `304 Not Modified` on
a revalidation probe that the SW expected to be `200 OK`, the SW skips the
revalidate, the user is stuck on a stale HTML page that points at a JS file the
SW just deleted from its cache. The fix: aggressive `Cache-Control: no-cache`
on the SW root and SW cache name versioning.

```js
// Workbox recipe for the "explicit user-consent reload" pattern
import { Workbox } from 'workbox-window';
const wb = new Workbox('/sw.js');
wb.addEventListener('waiting', (event) => {
  // surface a toast; the toast's "reload" handler does this:
  wb.addEventListener('controlling', () => window.location.reload());
  wb.messageSkipWaiting();   // promote waiting → active
});
wb.register();
```

### Decision for AIRIZ

**Workbox-window with user-consent reload, SWR for assets, network-first for
the manifest.** Install Workbox-window; let the SW fetch its own `/sw.js`
versioned file with `Cache-Control: max-age=0` so updates land within one
session. On a `waiting` event, show a non-blocking toast (top-right, dismissable,
visible for 7 days). For the manifest itself (the JSON file describing available
desktop/mobile binaries) use *network-first, fall back to cache* — never serve
stale. Use `stale-while-revalidate` for app shell assets (JS/CSS) only.
Security patches are the only release class that may call `skipWaiting()`
immediately; everything else waits for the user. **Effort:** ~1 day to wrap
the existing service worker in Workbox-window; ~0.5 day for the toast UI.
**Blast radius if wrong:** worst case is a tab stuck on old code that calls
into a removed JS API; the user reloads to fix. Not destructive. **Alternative
if it doesn't pan out:** disable the service worker for the PWA entirely and
rely on the browser's HTTP cache + a banner-style "hard refresh" CTA; loses
PWA installability but is functionally the same for a console app.

---

## (f) Store vs sideload for mobile

**Store distribution, by the numbers.** Apple App Store typical first review is
~24–48 hours median for a new app, ~24 hours median for an update, with
significant variance (submissions during US weekend often wait until Monday).
Play Store typical review is hours for trusted developers, days for new
developer accounts. Both require a $99/yr (Apple) and $25 one-time (Google)
fee; both can reject. Apple's reviewer can be opaque: a "Guideline 2.1 - App
Completeness" rejection is a generic catch-all that often hides the real reason.
Rejections are appealable but cost days.

**Apple Enterprise Program** ($299/yr) was the canonical "bypass the store"
path. Apple deprecated wide-distribution use of it in 2021; modern use is
restricted to internal-only distribution (≤100 devices per app under traditional
rules, with new allowances for specific use-cases like pilot programs). Detection
is real: Apple looks for `com.apple.developer.enterprise-installation` in
provisioning profiles and refuses apps in the store that use the entitlement.
Enterprise-signed apps are not launchable on consumer devices without explicit
trust, and Apple has revoked certs in bulk when misused (the 2019 Facebook /
Google cert-revocation incidents).

**Google Managed Play** (formerly "Android Enterprise") is the equivalent: an
EMM (Enterprise Mobility Management) provider pushes a private Play Store to
the device. Devices must be MDM-managed to install from the private channel;
ordinary consumer phones can't see it. Distribution is essentially unlimited
once configured. Detection: Google Play Protect may flag apps distributed
outside the public store unless they're signed with a recognised enterprise
signing key.

**Direct APK / IPA sideload.** Android: `adb install` works; iOS: requires
jailbreak or AltStore-style workaround. Sideloaded apps on Android can be
silently updated by the sideloader (F-Droid does this). iOS sideload via
AltStore uses a 7-day developer-cert refresh loop that is operationally
painful for a one-person team.

**Apple Guideline 2.5.2 — what actually blocks what.** Apple guidelines
section 2.5.2 (the rule historically referred to as "3.3.2" because of an
earlier numbering scheme) reads:

> Apps should be self-contained in their bundles, and may not read or write
> data outside the designated container area, nor may they **download, install,
> or execute code which introduces or changes features or functionality of the
> app**, including other apps. Educational apps designed to teach, develop, or
> allow students to test executable code may, in limited circumstances,
> download code provided that such code is not used for other purposes.

The carve-out is WebKit-rendered JavaScript: a Capacitor/Cordova app whose
webview loads a freshly-downloaded JS bundle from your own server does *not*
violate 2.5.2 because the interpreter is Apple's WebKit. This is the legal
basis for every React Native / Capacitor / Cordova / Expo live-update product.
What is *not* allowed: downloading and loading a new native dylib, swapping
the webview engine, or executing non-WebKit JS (e.g., V8 standalone). Expo
Updates explicitly requires the `runtimeVersion` to match the native runtime,
which is how it stays inside the carve-out.

**App signing identity.** iOS apps are signed by Apple with a provisioning
profile that pins the bundle ID and a team ID. The private key for that
signature lives in your Apple Developer account, accessible only via Xcode or
Transporter. You can't sign an iOS app from CI without uploading a
distribution certificate — which is what `fastlane match` automates. Android
uses a keystore (`.jks` or `.keystore`) that you generate yourself; Google Play
App Signing lets Google hold the production key and you hold an upload key, so
losing your keystore doesn't lose the app.

```gradle
// android/app/build.gradle — Play App Signing setup
android {
    signingConfigs {
        release {
            storeFile file("../play-account-credentials/upload-key.jks")
            storePassword System.getenv("PLAY_UPLOAD_KEY_PASSWORD")
            keyAlias System.getenv("PLAY_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("PLAY_UPLOAD_KEY_PASSWORD")
        }
    }
}
```

### Decision for AIRIZ

**Store distribution for iOS + Android, no sideload path.** Submit through App
Store + Play Store. The store review latency is acceptable for AIRIZ because
(a) the manifest-based live update of the *webview bundle* is permitted under
2.5.2, so most bug fixes never need a store re-review; (b) AIRIZ is a
consumer-facing app, so users expect the store. Apple Enterprise is off the
table: the $299/yr cost and audit exposure don't pay back for a consumer app.
Google Managed Play is reserved for a future "fleet operator" feature if and
only if a real enterprise customer asks for it. Capacitor live updates will
carry the manifest version through `runtimeVersion` matching, which is the
critical bit: the native shell stays on the store version, the webview
content ships via the manifest. **Effort:** ~2 days to wire `fastlane match`
+ Capacitor live updates end to end; recurring 30-min submissions per store
release. **Blast radius if wrong:** a rejected iOS submission blocks mobile
releases for days; mitigate by using TestFlight internal testers as the
pre-flight reviewer. **Alternative if it doesn't pan out:** drop iOS support
entirely, ship Android + Web PWA only — the PWA covers most of the iOS
functionality without the App Store tax.

---

## (g) Signed Cloudflare Worker deploys

**Cloudflare's own versioning.** Cloudflare Workers treats each `wrangler
deploy` as a *version* (immutable, identified by a UUID, carries
`{id, message, tag}` metadata), and a *deployment* is a pointer that says
"this version is live" (or "split 90/10 between these two versions"). The two
are coupled by default — `wrangler deploy` does both — but `wrangler versions
upload` creates a version without deploying it, and `wrangler versions deploy`
promotes a version. Gradual deployments support a two-version split with a
percentage per side; version affinity pins a user (cookie-based, scoped to the
deployment window) to the same version across requests. Rollbacks are first-class:
a single API call (`PUT /accounts/{id}/workers/scripts/{name}/deployments`)
that points the deployment at any prior version's ID.

**What "signing" means here.** Workers for Platforms (the multi-tenant product)
has a *script signing* feature where the platform tenant signs a deploy token
that authorises a customer's deploy. For a single-tenant Worker (which AIRIZ
is), the security model is different: the *deployment to Cloudflare* is
authenticated by the Cloudflare API token you hold in CI; Cloudflare then
stores the Worker code as a version. Cloudflare themselves hold the trust
anchor: they serve only what their API allowed, and their audit log records
who deployed what when. So the signing question becomes: how do you prove to
yourself (and your customers) that the code currently serving in the Worker is
the code you intended to ship?

**Source maps to Sentry.** The recommended pattern is `wrangler deploy` with
the source map auto-uploaded to Sentry at the same time, so a stack trace from
the Worker deobfuscates correctly. The wrangler config is:

```toml
# wrangler.toml (relevant snippets)
name = "airiz-api"
main = "src/index.ts"
compatibility_date = "2026-11-01"

[upload_source_maps]
enabled = true

[[unsafe.bindings]]
# versioning metadata binding — exposes version id to the runtime
type = "version_metadata"
```

**Durable Object migration safety.** Durable Objects are stateful: the class
holds the only persistent state for its instances. If a new version of the
Worker adds a field to the DO and an existing instance gets a request with the
new code, reading the missing field returns `undefined` (graceful), but if the
new code *removes* a field, the old data still has it (also graceful). The
real risk is during migrations: Cloudflare lets you run a "migration" that
deletes all instances of a DO class and rebuilds them under the new code. On a
gradual deployment, both old and new code touch the same DO instance, so any
schema change risks inconsistency. The fix: never change a DO's stored schema
without a two-deploy dance — first deploy adds the new field with default
values and reads both old and new; second deploy (after full rollout) drops
the old field.

**`wrangler --no-bundle`.** By default, wrangler bundles Worker code with
esbuild — fast, but loses the ability to debug with original filenames in some
cases, and the bundle hash is non-deterministic across machines. `--no-bundle`
ships your source as-is, gives deterministic output, lets you upload your own
source maps. Cost: cold-start is slightly slower because there's no minification.

```bash
# CI snippet — deterministic deploy with version metadata tag
npx wrangler versions upload \
  --no-bundle \
  --tag "release/2025.11.04-r3" \
  --message "feat(bluetooth): add model X pairing"
# promote 10% → 100% via separate command
npx wrangler versions deploy \
  --tag "release/2025.11.04-r3" \
  --percentage 10
```

### Decision for AIRIZ

**Cloudflare-managed signing, plus a self-attestation digest.** Treat the
Worker as *implicitly signed* by Cloudflare (they hold the trust anchor via
the API token model), and *additionally* publish a `version_metadata` record
to the manifest that contains a SHA-256 of the deployed Worker bundle. Clients
that care (the Windows desktop app, calling the Worker) can include that
digest in their pinned manifest. Source maps auto-upload to Sentry on every
deploy. Gradual deployments via `wrangler versions deploy --percentage` are
the rollout mechanism (10 → 50 → 100); rollback via the Cloudflare API is the
kill switch. **DO schema migrations** follow the two-deploy rule from day
one. **Effort:** ~0.5 day to add `version_metadata` + Sentry source-map
upload to the CI pipeline; ongoing is just the `wrangler versions deploy`
promotion. **Blast radius if wrong:** a poisoned Worker is only reachable if
Cloudflare's API auth or your GitHub repo is compromised; the self-attestation
digest is a second line of defence. **Alternative if it doesn't pan out:**
fall back to GitHub Actions–only deployment gated by a required manual
approval; lose gradual deploys but gain an explicit human gate.

---

## (h) Multi-arch single-bundle vs fat-binary per platform

**The two strategies.** A *single artifact* approach produces one binary that
detects the host platform at runtime (Node.js's `process.platform`, libc
probes, etc.) and runs the right code path. A *per-target artifacts* approach
produces one binary per (platform × arch × optional detail) combination — the
canonical example is Electron's `electron-builder` output:

```text
dist/
  AIRIZ Motor Console-1.0.0-x64.exe          # Windows x86_64
  AIRIZ Motor Console-1.0.0-arm64.exe         # Windows ARM64 (Snapdragon X)
  AIRIZ Motor Console-1.0.0.dmg               # macOS x86_64
  AIRIZ Motor Console-1.0.0-arm64.dmg         # macOS Apple Silicon
  AIRIZ Motor Console-1.0.0.AppImage          # Linux x86_64
  AIRIZ Motor Console-1.0.0-arm64.AppImage    # Linux ARM64
```

Plus the mobile binaries (`app-release.apk`, `app-release.ipa`), the Web PWA
zip, and the Cloudflare Worker tarball.

**Tradeoffs — single bundle.** Storage: smallest total bytes across the matrix
(one binary × one download per client). Complexity: build pipeline is simpler
(no per-arch matrix). Downside: download size for *any* client is the size of
*all* platforms combined — for AIRIZ that's a 1+ GB download on every update,
unacceptable on metered connections.

**Tradeoffs — per-platform fat binary.** Storage: largest total bytes across
the matrix (one binary per (platform × arch)). Complexity: the manifest must
list each target's URL, sha256, and size — manageable. Download size for any
client: only their platform's binary, ~120–200 MB for AIRIZ desktop, ~40–50 MB
for mobile, ~2–5 MB for the PWA, ~12 KB for the Worker. The canonical choice.

**A middle path: per-platform with arch sub-selection.** Some teams ship a
single `.dmg` that contains both x86_64 and arm64 slices (Apple's "universal"
binary). Saves the client the choice, costs disk. For AIRIZ the Windows + Linux
matrix doesn't have an equivalent, so the universal-binary trick is Apple-only.

**Manifest size.** A per-platform manifest entry with `url`, `sha256`, `size`
per target is ~150 bytes × 7 platforms ≈ 1 KB. Negligible. A single-bundle
manifest with embedded platform detection is ~200 bytes total. Both fit in a
single HTTP round-trip.

**CDN cache implications.** Per-platform artifacts cache-key by URL; a single
binary changes invalidate one cache entry, a multi-binary release invalidates
six. For Cloudflare Cache + R2 this is fine, but the *content* delta matters:
a Windows-only hotfix should not require re-uploading the macOS DMG.

**Build matrix cost.** Each (platform × arch) is a separate CI job. AIRIZ
matrix is ~7 desktop + 2 mobile + 1 web + 1 worker = 11 jobs per release.
On GitHub-hosted runners that's ~30–60 minutes total per release on parallel
matrix; on self-hosted it's the same. Per-platform binaries are the natural
output of this matrix anyway.

```yaml
# GitHub Actions matrix snippet (illustrative)
strategy:
  matrix:
    include:
      - { os: windows-latest,  arch: x64,    suffix: 'x64.exe' }
      - { os: windows-latest,  arch: arm64,  suffix: 'arm64.exe' }
      - { os: macos-latest,    arch: x64,    suffix: '.dmg',        mac: true }
      - { os: macos-latest,    arch: arm64,  suffix: '-arm64.dmg',  mac: true }
      - { os: ubuntu-latest,   arch: x64,    suffix: '.AppImage' }
      - { os: ubuntu-latest,   arch: arm64,  suffix: '-arm64.AppImage' }
```

### Decision for AIRIZ

**Per-platform fat-binary, manifest-driven.** One binary per
(platform × arch × optional variant), seven entries in the manifest for the
desktop matrix, two for mobile, one for PWA, one for the Worker. The manifest
is the source of truth, the client only ever downloads its row. Universal
binary trick is reserved for macOS only (where it's free). Build matrix is the
GitHub Actions matrix; cost is bounded. Single-bundle is rejected because the
download size on a 200 MB desktop app becomes 1+ GB per update, which is
unacceptable on metered mobile hotspots. **Effort:** ~1 day to define the
manifest schema for the per-platform matrix; recurring ~30 min per release for
the matrix build. **Blast radius if wrong:** the manifest schema is internal;
changing it is a non-breaking version bump. **Alternative if it doesn't pan
out:** collapse to a smaller matrix (drop Linux arm64 if no real demand,
drop Windows arm64 until Snapdragon X adoption matters) — never collapse to a
single bundle.

---

## Cross-cutting observations (for the matrix step, not a ninth decision)

These three threads appear in multiple decisions and should be reconciled in R2:

1. **Manifest format is the spine.** Sections (a), (b), (c), (d), (h) all
   produce manifest fields. If those fields can be unified into one document,
   the architecture is one manifest; if they can't, the architecture splits
   (e.g., "binary manifest" for desktop/mobile, "deployment manifest" for the
   Worker, "manifest-of-manifests" for the PWA).

2. **The kill switch has two ends.** A `force_pin` in the manifest from (b)
   works for the client; the Cloudflare rollback in (g) works for the Worker.
   These are the *same* logical operation expressed at different layers and
   should be triggered from the same alert in (c).

3. **Signing key custody is the trust root.** Section (d) is the only decision
   that affects every other layer: a leaked signing key compromises every
   platform; a Worker-only compromise is bounded to the Worker. The R2 matrix
   must weight (d) accordingly.

---

## Glossary of concrete numbers used

| Number | Source | Used in |
| --- | --- | --- |
| 10,385,920 B Chrome 190.1→190.4 full | chromium.org Courgette doc | (a) |
| 704,512 B Chrome 190.1→190.4 bsdiff (~6.78%) | chromium.org Courgette doc | (a) |
| 78,848 B Chrome 190.1→190.4 Courgette (~0.76%) | chromium.org Courgette doc | (a) |
| 5–15% typical bsdiff ratio on Electron bundles | generalised from Courgette doc | (a) |
| 1–3% Expo Updates bsdiff for small patches | expo-updates docs | (a) |
| App Store typical review 24–48h median | common knowledge, consistent with Apple's public statements | (f) |
| Play Store typical review hours–days | common knowledge | (f) |
| Apple Enterprise Program $299/yr | developer.apple.com | (f) |
| Google Play Console $25 one-time | developer.android.com | (f) |
| Apple Guideline 2.5.2 (was 3.3.2) | developer.apple.com/app-store/review/guidelines | (f) |
| Ed25519 signature 64 bytes | Bernstein et al., standard | (d) |
| 99.5% crash-free session threshold | common industry practice (Google, Meta) | (c) |
| 10% Sentry Adoption Stage threshold | docs.sentry.io/product/releases/health | (c) |
| Cloudflare gradual deploy: 2 versions max, percentage split | developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments | (g) |
| Cloudflare version history: last 100 versions | developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments | (g) |

---

## Notes for R2 reconciliation

- All eight decisions share a manifest schema. R2 must either (a) ratify the
  schema in section (b)'s JSON example as canonical, or (b) split into two
  schemas (binary manifest for native clients, deployment manifest for Worker
  + PWA).
- The signing decision in (d) binds every other decision. If R2 finds (d) too
  heavy, every other decision must re-justify without it.
- The store/sideload decision in (f) constrains the rollout in (b) — iOS and
  Android clients can never get a same-day hotfix because of store review.
  R2's staged-rollout policy must acknowledge this asymmetry.
- The PWA decision in (e) does not need (b)'s percent gate because the SW
  lifecycle itself provides staging (the "waiting" event). R2 may exempt
  PWA from the percent gate entirely.
