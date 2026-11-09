## Delta vs full updates

**Bandwidth saved per channel (compressed):**

- Electron `.asar` 30–50 MB
- block-diff → **5–15%** of size
- iOS IPA 30–100 MB
- no first-party delta → **0%**
- Android APK 20–60 MB
- Play App Delivery split → **40–60%**
- JS bundle → bsdiff **70–95%**


**Server-side generation complexity:**

- `bsdiff`/`bspatch` — O(n log n), stateless
- single base, CPU-bound
- `zsync` — chunk-hash, resumable, many bases
- `Courgette` (Google) — ELF/PE aware, heavy
- Electron: **blockmap** SHA256 per 4 MB chunk
- no bsdiff needed


```
old.blockmap + new.blockmap
→ download only changed blocks
```

- NSIS: `FileWithEmbeddedBlockMapDifferentialDownloader`
- Squirrel: `blockMap`


**Rollback story:**

- delta breaks → ship **full** base
- blast radius **doubles** (old + new)
- corrupt base → **all** diffs unusable
- cascade failure
- full-only: swap one URL
- delta: swap base + every derived diff


**When worth it / when full is fine:**

```
cellular / metered → delta
Wi-Fi / managed    → full
native binary      → blockmap / split
JS renderer        → bsdiff
```

- iOS: full IPA; store diffs internally
- Expo guard: patch only if **meaningfully smaller**
- AIRIZ: full binary + bsdiff JS bundle
- Electron asar: blockmap


Sources:
- https://github.com/develar/electron-builder
- https://docs.expo.dev/eas-update/bundle-diffing/
- https://en.wikipedia.org/wiki/Bsdiff


---

## Staged rollouts

**Percentage gating (deterministic, no per-user store):**

```
pct = (sha256(clientId) & 0xffff) % 100
eligible = pct < rolloutThreshold
```

- threshold lives in **signed manifest**
- hash **client id**, not user id
- canary cohort pinned to 100% via `force`
- Expo: `eas update --rollout-percentage=10`
- bump with `eas update:edit`


**Kill-switch latency:**

- manifest hot-update → **seconds** (CDN purge)
- new release build → **minutes–hours**
- keep manifest on a **short-TTL URL**
- separate from the binary URL
- purge → clients read old version next poll


**Observability:**

- Sentry **release health** (48 h window)
- Crashlytics ANR + fatal (Android)
- App Store Connect crash-free
- custom: tag `update.version` + `rolloutBucket`
- every event carries both tags


**Stage durations:**

| stage | duration | gate |
|---|---|---|
| pre-flight | 60 s | canary, 100% |
| ramp 1 | 1 h | 5% → 25% |
| ramp 2 | 6 h | 25% → 60% |
| soak | 24 h | 60% → 100% |


**Kill-switch false positives:**

- one flaky device → small-N false trip
- require **N ≥ 30** before acting
- two signals: crash **AND** ANR
- Schmitt hysteresis: trip 0.5%, clear 0.2%
- log every decision (bucket + version)


Sources:
- https://docs.expo.dev/eas-update/rollouts/
- https://developers.cloudflare.com/workers/deployments/traffic/
- https://docs.sentry.io/product/releases/

---

## Crash-throttled rollback

**Telemetry signals (right denominator):**

- crash-free sessions = 1 − crashed/total
- crash-free users = 1 − crashed_users/total
- ANR rate = ANR_sessions / total_sessions
- JS error rate = error_sessions / total
- baseline: rolling **7-day** per-version median


**Decision latency (need N sessions):**

- 1% crash delta → **≥ 200** sessions for 95% CI
- small fleet → lower N + **human confirm**
- sequential testing (SPRT) to stop early
- window: 15 min OR 100 sessions, **whichever later**
- never act on a single spike


**False-positive rate:**

- 0.1% threshold on small-N → **>20% FP**
- add **hysteresis** (Schmitt trigger)
- trigger at 0.5%, clear at 0.2%
- exclude app-open burst spikes
- require two independent signals


**Auto-revert mechanism:**

```
if crashFree(15m) < baseline - 0.5%
   and n >= 100 and anrUp:
    pin(manifest, prevStable)   # re-sign
    notify(oncall)
    freeze(rollouts)
```

- revert = **re-sign old manifest** + purge
- not a new binary
- cache last-known-good client-side
- offline revert still works


**Sentry vs Rollbar vs Bugsnag vs custom:**

- **Sentry** — release health + rollouts + sourcemaps
- **Bugsnag** — ANR + breadcrumbs, mobile-first
- **Rollbar** — deploy tracking, weaker mobile
- **custom** — full control, no lock-in
- AIRIZ: Sentry + custom metrics


Sources:
- https://docs.sentry.io/product/releases/
- https://docs.expo.dev/eas-update/error-recovery/
- https://www.bugsnag.com/docs/platforms/


---

## Signed manifests

**Algorithm choice:**

| algo | sig | verify | use |
|---|---|---|---|
| **Ed25519** | 64 B | µs, tiny | default |
| ECDSA P-256 | 64–72 B | fast | TLS interop |
| RSA-SHA256 | 256–512 B | slow | legacy |

- **Ed25519** = Tauri `minisign`
- smallest + fastest → **default for AIRIZ**
- ECDSA if key also does mTLS/X.509
- RSA only for legacy store tooling


**Key custody (least-privilege first):**

- **HSM / YubiKey** — air-gapped, best
- not one-person-friendly daily
- **CF Secrets** — deploy-time only
- **GitHub OIDC-federated** — ephemeral
- **age-encrypted** key in repo
- passphrase is the secret
- AIRIZ: age key + CF Secret for deploy


**Rotation cadence:**

- Ed25519: **12-month** rotation
- or on suspected compromise
- 2 active key-ids during overlap (30 d)
- never reuse across dev/prod


**Revocation:**

- **TOFU + expiry** — record first-seen key
- reject after expiry (simplest)
- **key-id allowlist** (recommended)
- **CRL** — heavyweight, overkill
- manifest carries `allowedKeyIds`


**What gets signed:**

- **envelope** (best): manifest
- `{version, url, sha256(binary), sig}`
- sign manifest → binary via transitive hash
- Tauri signs the update bundle
- electron-builder signs blockmap + asar
- never sign binary inline (large)
- sign the **pointer + digest**


Sources:
- https://v2.tauri.app/plugin/updater/
- https://age-encryption.org

---

## PWA service worker update traps

**skipWaiting race:**

- new SW waits if a client controls old
- `skipWaiting()` forces takeover
- in-flight fetches may 404 on new cache
- fix: `message` handshake
- client calls `registerUncontrolled`
- never skipWaiting on cache bump


**clients.claim fan-out:**

- `clients.claim()` takes over **all** tabs
- without it, tabs keep old SW
- claim + skipWaiting = instant global switch
- dangerous mid-request
- prefer **graceful** idle-then-activate


**OOB cache eviction:**

- out-of-band pages run stale SW
- `fetch` hits **old** cache names
- mixed-version responses
- name caches `airiz-v<N>`
- on activate, **delete non-keep**
- enable `navigationPreload`


**Storage partitioning (Chrome 2026):**

- 3rd-party SW + storage **partitioned**
- by top-level site
- same SW, **different** caches per origin
- don't assume shared cache in webviews
- test **embedded** + **top-level** separately


**Workbox vs native SW:**

- **Workbox** — precache + sync, batteries in
- **native** — full control, less magic
- fewer version surprises with native
- AIRIZ: **native** + explicit cache names
- explicit activate cleanup


**Versioning (never edit an existing SW):**

- SW is **immutable** once installed
- version by **URL hash** `sw-<hash>.js`
- or `Cache-Control: no-cache` on `sw.js`
- bump **cache name** on every change
- keep `SW_VERSION` = `CACHE_VERSION`
- delete old on activate


Sources:
- https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- https://workbox.dev
- https://web.dev/articles/storage-partitioning

---

## Store vs sideload for mobile

**Review latency:**

- App Store: **24–72 h** typical
- expedite for crash/security (request it)
- Play: **few hours – 72 h**
- staged rollout built-in
- sideload: **instant**, no gate
- but **no auto-update**
- urgent: Apple "expedite review" for P0


**Direct APK / IPA freedom:**

- instant deploy, full control
- **no store auto-update**
- you implement OTA (signed manifest)
- user allows "unknown sources" (friction)
- iOS: MDM required
- best for first-party hardware


**Enterprise channels:**

- **Play Managed** — internal, auto-update
- **Apple Business Manager** (ABM) + MDM
- **Intune** — min version, remote wipe
- blocks sideload
- fleet-managed? use ABM/Play Managed
- else direct + OTA


**Web OTA + Capacitor Live Update:**

- **Capacitor Live Update** (EAS Update)
- JS bundle OTA, **no store**
- native layer stays
- `runtimeVersion` gates compatibility
- bsdiff JS patch → **70–95%** savings
- renderer-only changes


**AIRIZ fit (consumer hardware console):**

```
Android → direct signed APK
iOS     → ABM + MDM (no sideload)
Win     → signed installer + blockmap
all     → OTA JS (bsdiff)
```

- OTA JS for fast fixes, **no store wait**
- iOS IPA = base; OTA JS = delta layer
- model: **binary = base (full) · JS = delta**
- Win: no store at all


Sources:
- https://docs.expo.dev/eas-update/
- https://capacitorjs.com/docs/app-auto-updates
- https://developer.apple.com/business-manager/


---

## Signed Cloudflare Worker deploys

**wrangler auth (least-privilege first):**

- **OIDC via GitHub Actions** — ephemeral
- **API token** — scoped, rotate quarterly
- **OAuth** — interactive, personal
- one-person: OIDC in CI + scoped token
- never commit `CLOUDFLARE_API_TOKEN`


**Versioning (rollback to vN):**

```
wrangler versions list <worker>
wrangler versions deploy <version-id>
wrangler versions rollback
```

- each deploy = **immutable version id**
- atomic rollback = re-point
- traffic split: 10% new / 90% old
- rollback = **single call**, seconds


**Tail Workers + Logpush:**

- **Tail** — per-request hooks, real-time
- **Logpush** — stream to S3/R2/Analytics
- Tail for canary inspection
- Logpush for durable audit
- tag logs with **version id**


**KV / R2 for signed + versioned manifest:**

- **R2** — object store
- `manifest-<version>.json` + `current.json`
- sign `current.json` (pointer)
- per-version manifests immutable
- **KV** — sub-ms edge reads for `current`
- R2 = signed payloads; KV = key-id allowlist
- purge KV on rollback (<1 s edge)


**Durable Object version pinning:**

- DOs keep **state across deploys**
- pin schema version explicitly
- `safe` (parallel) vs `unsafe` (stop)
- run **safe migrations** on prod
- tag DO with `schemaVersion`
- reject old-version writes
- rollback code ≠ rollback state
- state is forward-only


Sources:
- https://developers.cloudflare.com/workers/wrangler/commands/versions/
- https://developers.cloudflare.com/workers/observability/logs/
- https://developers.cloudflare.com/durable-objects/


---

## Multi-arch single bundle vs fat binary per platform

**Windows x64 vs arm64 (Snapdragon X, Surface Pro X):**

- ship **two** installers, not one fat exe
- `airiz-x64.exe` + `airiz-arm64.exe`
- arm64 runs x64 via Prism (slower)
- `electron-builder` `arch: [x64, arm64]`
- per-arch asar + blockmap


**macOS universal vs separate:**

- `lipo -create` → universal (x86_64+arm64)
- universal = 2× size, one DMG, one notarization
- AIRIZ: Win+Android+iOS+Web; macOS optional
- if added → **universal**


**Android ABI splits:**

- **AAB + Play App Delivery** per ABI
- ~40–60% smaller download
- sideload: `splits.abi` → `airiz-arm64-v8a.apk`
- arm64-v8a covers **all 2020+** devices
- drop v7a; keep **x86_64** for emulator CI only


**iOS device + simulator slices:**

- device: **arm64** (A12+) — required for App Store
- simulator: x86_64+arm64, dev only, never shipped
- one universal IPA; store validates **arm64 slice**
- no choice: arm64 = only ship target


**Web PWA manifest + SW versioning:**

- **arch-agnostic** — one bundle serves all
- WASM if native perf needed
- version by **content hash** on `sw.js`


**CF Worker: V8 isolates, no native arch:**

- Workers run in **V8 isolates** — no CPU arch
- one deploy serves **all** arches
- constraint: **no native addons**
- native crypto → **WebCrypto** (in-VM)
- single artifact; sign per-arch payload digests


Sources:
- https://www.electron.build/configuration/configuration
- https://developer.android.com/guide/app-bundle
- https://developer.apple.com/documentation/xcode/supported-instruction-sets-for-apple-platforms
