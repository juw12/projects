# AIRIZ MOTOR CONSOLE — Cross-Platform Auto-Update Architecture Decision

Owner: Juwen Lie | Team: Ziris PTB | One-person team
Date: 2026-11-05
Product surfaces: Windows desktop + Android + iOS + Web PWA + Cloudflare Worker
Current state: 3 locales (en / 繁中 / 简中), Python stdlib server for device-audio
auto-save, Bluetooth-bridge (deprecated 1.11.18 but in tree), 3 independent signing
pipelines, 5 independent update mechanisms.

---

# Section 1 — Executive Recommendation

**PICK: A (evolved) — keep the existing Electron + Capacitor stack, reduce 5
update mechanisms to 3 effective paths, adopt electron-builder v27 Ed25519
manifest signing, consolidate artifact storage on Cloudflare R2, and use a
single Cloudflare Worker as the update-check endpoint.**

One-line rationale: For a one-person team already shipping on Electron +
Capacitor, the lowest-risk path to "signed updates on 5 surfaces without
inventing a new manifest per platform" is to use each platform's native
updater protocol (which already exists and is maintained by the community),
unify the signing to one Ed25519 key, and unify artifact storage to R2. The
"unification" is in the release pipeline and signing ceremony, not in the
wire protocol.

## Why B (Tauri 2.x) loses for a one-person team

1. **Full rewrite of a shipping product.** Migrating an existing Electron +
   Capacitor codebase to Tauri 2.x is a 4-8 month rewrite. The frontend
   (React/Vue/Svelte) may port, but all native IPC, system tray, Bluetooth
   bridge, and device-audio server integration must be reimplemented in Rust.
   For a one-person team, this blocks ALL feature work for the migration
   duration. [Survey 8 — Tauri section: "single Rust core + OS WebView shell"]

2. **Mobile updater does NOT work.** The Tauri updater plugin's install code
   uses `#[cfg(desktop)]`, which excludes Android and iOS. The docs platform
   table lists all 5 platforms, but the actual code gate means the updater
   does not run on mobile. Tauri's own 2.0 blog confirms: "On mobile not all
   of the official plugins are supported." [Survey 8 — Tauri updater section,
   citing https://tauri.app/blog/tauri-20/]

3. **No web target.** Tauri has no web deployment. The PWA surface would
   still need its own update path (service worker), defeating the
   "unification" premise. [Survey 8 — Tauri: "Web: NO. Tauri is desktop +
   mobile only. No web target."]

4. **Known NSIS update failures in production.** Tauri issue #16277 (Oct
   2026): "NSIS update aborts with 'Failed to kill <App>'" confirmed in at
   least 4 independent projects. The Restart Manager `RmShutdown` call has
   no wait or retry. [Survey 5 — Tauri section]

## Why C (custom R2 manifest) loses for a one-person team

1. **It IS "inventing a new manifest format per platform."** The unified
   manifest JSON proposed in Survey 7 (lines 1052-1094) is well-designed,
   but every platform's updater would need a custom adapter to read it.
   electron-updater natively reads `latest.yml`; Tauri reads its own JSON;
   Capgo reads its own schema. Building a single custom format that all 5
   surfaces consume means writing 5 custom update-check clients. That is
   MORE engineering, not less. [Survey 7 — "THE MINIMUM VIABLE UNIFIED
   MANIFEST" section]

2. **No production precedent.** Survey 8 explicitly states: "There is NO
   known production case where a single manifest is consumed by Electron +
   Capacitor + PWA + Worker simultaneously." The closest attempts (Tauri's
   JSON, electron-updater's latest.yml, Capgo's manifest) are all
   single-framework. [Survey 8 — "single manifest" question]

3. **Maintenance burden of a custom protocol.** A custom manifest means
   custom version comparison, custom rollback logic, custom staging
   percentage interpretation, custom SRI computation for PWA — all
   maintained by one person. The native protocols have community
   maintenance; a custom one has only you.

4. **PWA is the odd one out.** Survey 7 states: "PWA has NO manifest file —
   the update IS the script. No signing, no version field, no channel
   concept. For unified manifest: PWA is the odd one out; it needs a
   synthetic manifest." [Survey 7 — Protocol 7 cross-platform reuse]

## What "A evolved" means concretely

| Surface | Mechanism | Manifest format | Signing |
|---------|-----------|----------------|---------|
| Windows desktop | electron-updater v27 | latest.yml (native) | Ed25519 (v27) |
| macOS desktop | electron-updater v27 | latest-mac.yml (native) | Ed25519 (v27) |
| Android | Capgo (JS bundle) + Play Store (native) | Capgo manifest (native) | Ed25519 (Capgo server-side) |
| iOS | Capgo (JS bundle) + App Store (native) | Capgo manifest (native) | Ed25519 (Capgo server-side) |
| Web PWA | Cloudflare Worker deploy + SW | No manifest (script IS update) | SRI hashes (build-time) |
| Cloudflare Worker | wrangler deploy | No manifest (code IS artifact) | Opaque API token auth |

The "3 effective paths" are:
1. **Desktop**: electron-updater v27 (one tool, one key, one R2 bucket)
2. **Mobile**: Capgo for JS OTA + app stores for native (two tools, but
   Capgo handles signing server-side; store handles native signing)
3. **Edge**: Cloudflare Worker deploy (no manifest, atomic version switch,
   `wrangler rollback` for recovery)

The unification is in: ONE Ed25519 key (for desktop manifest signing), ONE
R2 bucket (all artifacts), ONE release trigger (GitHub Action that builds,
signs, uploads to R2, deploys Worker), ONE version number (single semver).

---

# Section 2 — Score Matrix

Each cell: 1-2 sentences. Cite [Survey 6 — brief (a)-(h)].

| Trade-off | A (evolved) | B (Tauri) | C (R2 manifest) |
|-----------|-------------|-----------|-----------------|
| **(a) Delta vs full** | electron-updater blockmap gives delta for free on Windows + macOS. Full package is the fallback. [S6-a] | No delta support. Full binary download every time. Tauri docs confirm. [S2-Tauri: "NO delta support"] | You build it yourself. bsdiff/bspatch or HDiffPatch. Most engineering. [S6-a] |
| **(b) Staged rollouts** | electron-updater v27 `stagingPercentage` field (0-100). Capgo has percentage rollout in dashboard. PWA/Worker: Cloudflare traffic splitting. [S7-Protocol 1: stagingPercentage] | No built-in channel or percentage rollout. Must build custom endpoint logic. [S2-Tauri: "No built-in channel or percentage rollout"] | You define the staging field in your manifest. Full control but full implementation burden. [S6-b] |
| **(c) Crash-throttled rollback** | Sentry release-health + Capgo one-click rollback + `wrangler rollback`. 30-min decision loop achievable. [S6-c] | Sentry + custom (no native rollback trigger). Tauri has no crash-rate-gated auto-rollback. [S6-c] | You build the telemetry tripwire, the kill-switch flag, and the rollback trigger yourself. [S6-c] |
| **(d) Signed manifests** | electron-builder v27 adds Ed25519 manifest signing natively. Capgo signs server-side. PWA uses SRI. One key for desktop, Capgo key for mobile. [S7-Protocol 1: v27 Ed25519] | Ed25519, one key, embedded in tauri.conf.json. Cleanest single-key story for desktop. [S2-Tauri: signing flow] | Ed25519, one key signs the unified manifest. But you implement verification in all 5 clients. [S6-d] |
| **(e) PWA SW traps** | Workbox skipWaiting + clients.claim recipe. Standard, well-documented. No new risk. [S6-e] | N/A (no web target). PWA still needs its own SW. [S8-Tauri: no web] | Same Workbox recipe, but your custom manifest adds one more fetch before SW update check. More moving parts. [S6-e] |
| **(f) Store vs sideload** | Capgo for JS OTA (no store resubmission for web changes). Play/App Store for native. Standard path. [S6-f] | Same: Play + App Store for native. No OTA for mobile (updater doesn't work). [S8-Tauri: cfg(desktop)] | Same store paths, but your custom manifest could enable direct APK sideload with Ed25519 verification (Obtainium pattern). More control, more work. [S6-f] |
| **(g) CF Worker signed deploys** | `wrangler deploy` with `compatibility_date` pinned. `wrangler rollback` in CI. Pages Upload Issue (2026-10-26) and DO/R2 ENAM spike (2026-11-04) are known risks. [S6-g, S4-Cloudflare] | Same Worker path (Worker is independent of desktop framework). Identical risk profile. [S6-g] | Same Worker path, but your Worker now also serves the custom manifest to all clients. Single point of failure. [S6-g] |
| **(h) Multi-arch** | electron-builder handles per-arch NSIS/MSI (Windows), universal .app (macOS via lipo). Standard. [S6-h] | Tauri handles per-arch. NSIS on Windows, .app.tar.gz on macOS, AppImage on Linux. [S2-Tauri] | You define arch keys in your manifest. More configuration, same outcome. [S6-h] |

**Score summary** (where 3 = best, 1 = worst for a one-person team):

| Trade-off | A | B | C |
|-----------|---|---|---|
| (a) Delta | 3 | 1 | 2 |
| (b) Staged | 3 | 1 | 2 |
| (c) Rollback | 3 | 2 | 2 |
| (d) Signing | 2 | 3 | 3 |
| (e) PWA SW | 3 | 1 | 2 |
| (f) Store | 3 | 2 | 3 |
| (g) Worker | 3 | 3 | 2 |
| (h) Multi-arch | 3 | 3 | 2 |
| **Total** | **23** | **16** | **20** |

A wins on operational simplicity. B wins only on signing elegance. C wins
on signing + store flexibility but loses on operational burden.

---

# Section 3 — Architecture Diagrams

## Candidate A (evolved) — RECOMMENDED

```
                         ONE RELEASE PIPELINE (GitHub Action)
                         ====================================
                              |
                              v
                    +---------------------+
                    |  sync_release_feed  |  (Python, existing)
                    |  .py / GitHub Action|
                    +---------------------+
                              |
            +-----------------+-----------------+
            |                 |                 |
            v                 v                 v
   +----------------+  +--------------+  +------------------+
   |  R2 Bucket     |  |  Capgo Cloud |  |  Cloudflare      |
   |  (artifacts)   |  |  (JS bundle  |  |  Worker          |
   |                |  |   OTA)       |  |  (PWA + API)     |
   |  /releases/    |  |              |  |                  |
   |   v1.0.0/     |  |  /bundles/   |  |  /pwa/ (static)  |
   |    win-x64.exe|  |   prod/      |  |  /api/ (routes)  |
   |    mac-arm.zip|  |              |  |                  |
   |    latest.yml |  +--------------+  |  wrangler.toml   |
   |    latest.yml |                    |  compatibility_  |
   |    .blockmap  |                    |  date = pinned   |
   +----------------+                   +------------------+
            |                 |                 |
            |    Ed25519      |   Ed25519       |   Opaque  |
            |    (v27)        |   (Capgo)       |   API     |
            |                 |   (server)      |   token   |
            v                 v                 v
   +----------------+  +--------------+  +------------------+
   |  ELECTRON      |  |  CAPACITOR   |  |  BROWSER         |
   |  (Win/macOS)   |  |  (Android/   |  |  (PWA)           |
   |                |  |    iOS)      |  |                  |
   |  electron-     |  |              |  |  Service Worker  |
   |  updater v27   |  |  Capgo SDK   |  |  (Workbox)       |
   |  reads         |  |  polls       |  |  skipWaiting +   |
   |  latest.yml    |  |  Capgo API   |  |  clients.claim   |
   |  verifies      |  |              |  |                  |
   |  Ed25519 sig   |  |  Play Store  |  |  Cloudflare      |
   |  + SHA-512     |  |  / App Store |  |  Worker serves   |
   |                |  |  (native)    |  |  SW + assets     |
   +----------------+  +--------------+  +------------------+

   ROLLBACK PATHS:
   - Desktop: re-point latest.yml to previous version in R2
   - Mobile JS: Capgo one-click rollback in dashboard
   - Mobile native: Play staged rollout revert / App Store
   - Worker: wrangler versions deploy <previous-version-id>
   - PWA: redeploy previous Worker version (Serves old SW)
```

Moving parts unique to A:
- electron-builder v27 config (build.publish, sign config)
- Capgo plugin config in capacitor.config.ts
- Workbox config in PWA build
- wrangler.toml (compatibility_date, routes)
- sync_release_feed.py (existing, generates latest.yml + uploads)

## Candidate B (Tauri 2.x)

```
                         ONE RELEASE PIPELINE (GitHub Action)
                         ====================================
                              |
                              v
                    +---------------------+
                    |  tauri build        |
                    |  (Rust CLI)         |
                    +---------------------+
                              |
            +-----------------+-----------------+
            |                 |                 |
            v                 v                 v
   +----------------+  +--------------+  +------------------+
   |  R2 / GitHub   |  |  Play Store  |  |  Cloudflare      |
   |  Releases      |  |  / App Store |  |  Worker          |
   |                |  |  (native     |  |  (PWA + API)     |
   |  latest.json   |  |   only - NO |  |                  |
   |  (per platform)|  |   OTA for   |  |  Same as A       |
   |                |  |   mobile)   |  +------------------+
   +----------------+  +--------------+
            |                 |
            |    Ed25519      |   Apple/Google
            |    (one key)    |   codesign
            v                 v
   +----------------+  +--------------+
   |  TAURI         |  |  MOBILE      |
   |  (Win/macOS/   |  |  (Android/   |
   |    Linux)      |  |    iOS)      |
   |                |  |              |
   |  tauri-plugin- |  |  NO UPDATER  |
   |  updater       |  |  (cfg        |
   |  reads         |  |   desktop)   |
   |  latest.json   |  |              |
   |  verifies      |  |  Play        |
   |  Ed25519 .sig  |  |  staged      |
   |                |  |  rollout +   |
   |  installMode:  |  |  App Store   |
   |  passive       |  |  review      |
   +----------------+  +--------------+
                              |
                    +--------------+
                    |  PWA        |
                    |  (SEPARATE  |
                    |   from      |
                    |   Tauri)    |
                    +--------------+

   ROLLBACK PATHS:
   - Desktop: re-point latest.json to previous version
   - Mobile: Play revert / App Store (NO OTA)
   - PWA: redeploy previous Worker version
   - Worker: wrangler versions deploy <previous-version-id>
```

Moving parts unique to B:
- Full Rust backend rewrite
- Tauri plugin system (replaces all Electron IPC)
- Separate PWA codebase (Tauri has no web target)
- No mobile updater (store-only)
- CrabNebula Cloud (optional, for dynamic update server)

## Candidate C (custom R2 manifest)

```
                         ONE RELEASE PIPELINE (GitHub Action)
                         ====================================
                              |
                              v
                    +---------------------+
                    |  Build + Sign       |
                    |  (all artifacts)    |
                    +---------------------+
                              |
                              v
                    +---------------------+
                    |  UNIFIED MANIFEST   |  (the custom format from Survey 7)
                    |  (Ed25519-signed)   |
                    |                    |
                    |  {                 |
                    |    "version": "1.0.0",|
                    |    "channel": "stable",|
                    |    "platforms": {  |
                    |      "electron-win": {...}|
                    |      "capgo-android": {...}|
                    |      "pwa": {...}    |
                    |    },              |
                    |    "signature": "..." |
                    |  }                 |
                    +---------------------+
                              |
                    +--------+--------+
                    |        |        |
                    v        v        v
              +--------+ +--------+ +--------+
              |  R2    | |  Capgo | |  CF    |
              |  (all  | |  Cloud | |  Worker|
              |  artifacts)|     | |  (serves|
              +--------+ +--------+ |  manifest|
                                    |  to all  |
                                    |  clients) |
                                    +--------+
                    |        |        |
                    v        v        v
              +--------+ +--------+ +--------+
              |CUSTOM  | |CUSTOM  | |CUSTOM  |
              |ELECTRON| |CAPACITOR| |PWA     |
              |UPDATER | |CLIENT  | |CLIENT  |
              |ADAPTER | |ADAPTER | |ADAPTER |
              |        | |        | |        |
              |fetches | |fetches | |fetches |
              |manifest| |manifest| |manifest|
              |verifies| |verifies| |verifies|
              |Ed25519 | |Ed25519 | |Ed25519 |
              |downloads| |downloads| |downloads|
              |installs| |installs| |caches  |
              +--------+ +--------+ +--------+

   ROLLBACK PATHS:
   - ALL: rewrite manifest to point at previous artifacts
   - Worker: wrangler versions deploy <previous-version-id>
   - PWA: SW re-fetches manifest, gets old URLs
   - Risk: manifest write is atomic (R2 per-object), but clients
     may have cached the old manifest
```

Moving parts unique to C:
- Custom manifest JSON schema (design + version)
- 5 custom client adapters (Electron, Capgo, PWA, Worker, fallback)
- Custom version comparison logic
- Custom staging percentage interpretation
- Custom SRI computation for PWA assets
- Custom rollback trigger (no native tooling)
- Single point of failure: the Worker serving the manifest

---

# Section 4 — Signing Key Strategy

## Algorithm choice: Ed25519

Ed25519 (RFC 8032) is the correct choice for 2026. Verified facts from
the surveys:

- **Tauri**: Ed25519, mandatory (cannot be disabled). [Survey 2 — Tauri
  section: "This cannot be disabled."]
- **Sparkle 2.x**: EdDSA (Ed25519), DSA deprecated. [Survey 2 — Sparkle:
  "Sparkle 2.0 migration: DSA signatures REMOVED"]
- **electron-builder v27**: Ed25519 manifest signing (NEW in v27). [Survey
  7 — Protocol 1: "signature: string YES(v27), signatures[]: array
  YES(v27)"]
- **Capgo**: Ed25519, server-side signing. [Survey 2 — Capgo: "Capgo signs
  bundles SERVER-SIDE with their Ed25519 key"]
- **electron-updater pre-v27**: RSA-SHA256 (derived from code-signing cert).
  [Survey 4 — Topic 1: "electron-updater is actually RSA-SHA256, not
  Ed25519!"]

Why Ed25519 over RSA-SHA256:
- 32-byte public key vs 256-byte RSA-2048 [Survey 4 — Topic 1]
- Deterministic (no nonce-reuse attack vector) [Survey 4 — Topic 1:
  RFC 8032 §5.1.5]
- Fast: sub-microsecond verify vs tens-of-microsecond RSA
- Smaller signatures: 64 bytes vs 256 bytes
- Universal across Tauri, Sparkle, Capgo, and now electron-builder v27

For the Windows Authenticode code-signing certificate (separate from
manifest signing), the existing EV/OV cert continues to be used. The
Ed25519 key signs the MANIFEST (latest.yml); the code-signing cert signs
the BINARY. These are two different trust layers. [Survey 2 — electron-
updater: "Windows: Authenticode (SHA-256) via win.sign"]

## Key custody

For a one-person team, the practical hierarchy is:

1. **YubiKey (FIDO2)** for the Ed25519 manifest key. Generate on the YubiKey,
   sign in CI via `gpg` or a small Rust/Node helper that calls the YubiKey
   over USB/NFC. The private key never exists on disk.
   [Survey 6 — brief (d): "a FIDO2 / YubiKey (minisign, sigstore) keeps it
   on a token you carry"]

2. **GitHub Actions secret** for the code-signing certs (Windows PFX,
   macOS P12, Android keystore). These must be in CI because the build
   machine signs the binary. Store as encrypted secrets.
   [Survey 4 — Topic 1: "a GitHub Actions secret is better but still a
   blob"]

3. **Capgo server** holds the Capgo Ed25519 key (their infrastructure).
   You do NOT custody this key. [Survey 2 — Capgo: "Capgo signs bundles
   SERVER-SIDE"]

4. **Cloudflare API token** for Worker deploys. Scoped to Workers Scripts
   Edit. Stored as GitHub Actions secret. [Survey 1 — Wrangler: "Auth:
   OAuth token or CLOUDFLARE_API_TOKEN"]

## Key rotation ceremony

- **Ed25519 manifest key**: electron-builder v27 supports `signatures[]`
  array with `keyId` per entry. A bridge release dual-signs with old + new
  key; embed both in the trust list; next release drops the old key.
  [Survey 7 — Protocol 1: "Key rotation: bridge release dual-signs with
  old+new; embed [old, new] in trust list"]

- **Android APK key**: APK Signature Scheme v3 `signersHistory` allows
  multiple current + past signing keys. Play App Signing key rotation is a
  multi-party ceremony (Google + your legal/tech sign-off).
  [Survey 4 — Topic 3: "v3 adds signer rotation support via signers and
  signersHistory"]

- **iOS distribution cert**: 1-year validity. Renew before expiry. The
  WWDR intermediate cert rotation is the classic failure mode — if you
  signed with an old intermediate that Apple later revokes, your binary
  fails validation. [Survey 4 — Topic 4: "The WWDR intermediate cert
  changed over time... This is THE classic iOS signing failure mode"]

## Cross-platform reuse of the SAME key

| Candidate | Same key for all? | Details |
|-----------|-------------------|---------|
| A (evolved) | PARTIALLY | Ed25519 key signs desktop manifests (latest.yml). Capgo has its own server-side key. PWA uses SRI (no key). Worker uses API token. So: ONE key for desktop, Capgo key for mobile, no key for edge. |
| B (Tauri) | PARTIALLY | Ed25519 key signs desktop manifests (latest.json). Mobile has no updater. PWA/Worker still separate. |
| C (R2 manifest) | YES (in theory) | ONE Ed25519 key signs the unified manifest. All platforms verify the same signature. BUT: PWA has no native signature verification — you'd embed the public key in the SW and verify manually. |

[Surveys 1, 2, 4, 7 — all signing sections]

---

# Section 5 — Manifest Schema

## Decision: Use native per-platform manifests, NOT a custom unified format

The unified manifest JSON from Survey 7 (lines 1067-1094) is a well-designed
proposal, but for candidate A (evolved), each platform uses its own native
format. The "unification" is in the release pipeline that generates all
variants from one source of truth.

### Windows (electron-updater v27) — `latest.yml`

```yaml
version: "1.0.0"
files:
  - url: AirizMotorConsole-setup-x64.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 62021782
    blockMapUrl: AirizMotorConsole-setup-x64.exe.blockmap
stagingPercentage: 100
releaseDate: "2026-11-05T12:00:00.000Z"
minimumSystemVersion: "10.0.17763.0"
# v27 Ed25519 manifest signing:
signature: <base64-ed25519>
signatures:
  - keyId: <hex-sha256-of-spki-der>
    signature: <base64-ed25519>
```

Field rationale [Survey 7 — Protocol 1]:
- `version`: SemVer, compared by electron-updater
- `files[].sha512`: Integrity check (base64 SHA-512)
- `files[].blockMapUrl`: Delta download via HTTP Range requests
- `stagingPercentage`: 0-100, client-side deterministic hash
- `minimumSystemVersion`: Gate for old Windows
- `signature` / `signatures[]`: Ed25519 (v27), key rotation via array

### macOS (electron-updater v27) — `latest-mac.yml`

Same schema as Windows, with `.zip` (Squirrel.Mac) or `.dmg` artifacts.
Ed25519 signing identical. [Survey 7 — Protocol 1]

### Android/iOS (Capgo) — Capgo manifest (server-side)

```json
{
  "id": "bundle-uuid",
  "version": "1.0.0",
  "url": "https://capgo.app/bundles/.../bundle.zip",
  "checksum": "sha256:...",
  "channel": "production",
  "signature": "<ed25519-server-side>",
  "min_update_version": "1.0.0",
  "mandatory": false
}
```

[Survey 7 — Protocol 3: Capgo manifest fields]
- Capgo signs server-side; you do not hold the key
- `channel`: production / staging / dev
- `mandatory`: force-update flag (use sparingly for App Store compliance)

### Web PWA — No manifest (SRI + SW)

The PWA has no update manifest. The "update" is the service worker script
itself. Security is via:
- HTTPS/TLS (mandatory)
- SRI hashes on build-time assets (`<script integrity="sha384-...">`)
- Workbox precache manifest (generated at build time) [Survey 7 — Protocol 7]
- Cloudflare Worker serves the assets; Worker version IS the content version

### Cloudflare Worker — No manifest (wrangler.toml + code)

```toml
name = "airiz-worker"
main = "src/index.js"
compatibility_date = "2026-01-01"  # PINNED. Do not change casually.
compatibility_flags = ["nodejs_compat"]
routes = [{ pattern = "api.airiz.dev/*", zone_name = "airiz.dev" }]
```

[Survey 1 — Wrangler docs: `compatibility_date` "will be used to determine
which version of the Workers runtime is used"]
[Survey 7 — Protocol 11: "compatibility_date: locks the Workers runtime
version. Changing it is equivalent to a breaking version bump."]

### How each platform's updater consumes the manifest

| Platform | Updater | Fetches | Verifies | Installs |
|----------|---------|---------|----------|----------|
| Windows | electron-updater v27 | latest.yml from R2 | Ed25519 manifest sig + SHA-512 file hash | NSIS installer (passive) |
| macOS | electron-updater v27 | latest-mac.yml from R2 | Ed25519 manifest sig + SHA-512 file hash | Squirrel.Mac atomic swap |
| Android JS | Capgo SDK | Capgo API (channel) | Ed25519 (Capgo server) + checksum | Next launch (JS bundle) |
| iOS JS | Capgo SDK | Capgo API (channel) | Ed25519 (Capgo server) + checksum | Next launch (JS bundle) |
| Android native | Play Store | Google's servers | Google Play signing (v3/v4) | OS package manager |
| iOS native | App Store | Apple's servers | Apple codesign + notarization | OS |
| PWA | Service Worker | Worker (SW script) | TLS + SRI (build-time) | Browser SW lifecycle |
| Worker | N/A (server-side) | N/A | N/A | wrangler deploy (atomic) |

[Surveys 1, 2, 7 — all protocol sections]

---

# Section 6 — Mobile Path (iOS + Android)

## App Store / Play Store review latency

- **Play Store**: 24-72 hours typical for first review; subsequent updates
  often faster (1-4 hours). Staged rollouts available (1% → 5% → 20% →
  50% → 100%). [Survey 6 — brief (f)]
- **App Store**: 24-72 hours typical. "Emergency review" fast-track exists
  for critical security fixes but is rarely invoked. [Survey 6 — brief (f)]
- **TestFlight**: Internal testers (max 100), external testers (max 10,000).
  Builds expire after 90 days (both internal and external). [Survey 4 —
  Topic 4: "both internal and external TestFlight builds are 90 days"]

## iOS enterprise cert revocation risk

- Apple periodically revokes enterprise (in-house) certs used for
  sideloading. A revoked cert bricks ALL devices with that build.
  [Survey 6 — brief (f): "Apple periodically revokes abused enterprise
  profiles, bricking installs"]
- For AIRIZ: do NOT use enterprise distribution for production. Use
  App Store + TestFlight only. Enterprise is a one-strike-and-you're-out
  risk for a one-person team.

## Android APK Signature Scheme v3/v4 rotation

- **v3 (API 28+)**: `signersHistory` array allows multiple keys. During
  rotation, both old and new keys are present; devices verify against
  either. [Survey 4 — Topic 3: "v3 adds signer rotation support via
  signers and signersHistory"]
- **v4 (API 31+)**: Per-file SHA-256 digests, enables incremental updates.
  The v4 block can be hosted OUTSIDE the APK (server-side). [Survey 4 —
  Topic 3]
- **Play App Signing**: Google holds the app signing key. You upload with
  your upload key. Key rotation requires a signed declaration ceremony
  (Google + your legal/tech sign-off). [Survey 4 — Topic 3: "Play supports
  key rotation where you upload a re-signed bundle"]
- **Failure mode**: If you sign with a different key than the installed
  version, PackageManager rejects the update with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. This is irreversible — the user
  must uninstall and reinstall. [Survey 6 — brief (f): "you cannot update
  in place if the signing key changes"]

## Capacitor Live Update feasibility

- **Capgo (Capawesome)** is the maintained successor to the deprecated
  `@capacitor-community/live-update`. The original was abandoned; Capgo
  took over the namespace. [Survey 2 — Protocol 8: "Capgo (Capawesome)
  took over the namespace and built a full commercial platform"]
- Capgo updates JS/HTML/CSS bundles ONLY. Native code changes require
  store resubmission. [Survey 2 — Capgo: "The Over-the-Air (OTA) update
  feature is applicable only for modifications made to HTML, CSS, and
  JavaScript files"]
- For AIRIZ: the Bluetooth bridge and device-audio server are native
  plugins. Changes to those require a new store build. Web UI changes
  (the 3-locale system, dashboard, charts) can be OTA'd via Capgo.
- **Pricing**: $19/month Starter plan. Acceptable for a one-person team.
  [Survey 8 — Capawesome: "Starter $19/mo"]

## Tauri mobile updater status

- **CONFIRMED: Does NOT work.** The updater plugin install code uses
  `#[cfg(desktop)]`, which excludes Android and iOS. [Survey 8 — Tauri:
  "The docs platform table lists all 5 platforms, but the Rust install
  code uses #[cfg(desktop)]. This cfg gate EXCLUDES Android and iOS."]
- Tauri's own 2.0 blog: "On mobile not all of the official plugins are
  supported. Some are by design not a good fit for mobile." [Survey 8 —
  Tauri, citing https://tauri.app/blog/tauri-20/]
- Even if it worked, Apple policy 2.5.2 prohibits downloading executable
  code that changes app functionality. OTA native updates on iOS are
  impossible regardless of framework. [Survey 6 — brief (f)]

---

# Section 7 — Worker Path

## Wrangler deploy protocol

From the official Wrangler CLI documentation [Survey 1 — full document]:

1. `wrangler deploy` bundles code (esbuild) and uploads to Cloudflare API
2. Auth: `CLOUDFLARE_API_TOKEN` (opaque, account-scoped) or OAuth session
3. Each deploy creates an immutable **version**
4. The deployment atomically switches traffic: 100% old -> 100% new
5. `wrangler versions deploy <version-id>` re-deploys a previous version
   (this IS the rollback mechanism) [Survey 1 — `versions` section]

**Critical**: The auth is an opaque API token, NOT a signed JWT.
[Survey 4 — Topic 6: "Cloudflare API tokens are not JWTs in the
public-claim sense; they're opaque API tokens"]

## compatibility_date pinning

```toml
compatibility_date = "2026-01-01"  # PIN THIS. Do not bump casually.
```

- Locks the Workers runtime to a specific date's behavior
- Bumping can change API semantics (new APIs available, old flags removed)
- [Survey 7 — Protocol 11: "Changing it is equivalent to a breaking
  version bump"]
- [Survey 1 — `deploy` command: "A date in the form yyyy-mm-dd, which
  will be used to determine which version of the Workers runtime is used"]

## wrangler rollback

```bash
# List all versions
wrangler versions list

# Roll back to a specific version (atomic, instant)
wrangler versions deploy <version-id>

# Delete an old version (if not current)
wrangler versions delete <version-id>
```

- No automatic rollback. No health-check-triggered rollback. Manual only.
  [Survey 7 — Protocol 11: "No automatic rollback. No health-check-
  triggered rollback (manual only)."]
- For a one-person team: wire `wrangler versions deploy <last-known-good>`
  into a GitHub Action that triggers on alert (Sentry error spike,
  Cloudflare status page incident).

## KV/R2/D1 atomic deploys

- **R2**: Per-object atomic. Upload the new Worker bundle + manifest, then
  deploy. [Survey 7 — Protocol 11: "R2: S3-compatible, per-object atomic;
  bucket-level is NOT atomic"]
- **KV**: Per-key atomic. Namespace-level is NOT atomic.
- **D1**: Transactional (atomic within a transaction).
- For AIRIZ: store the release manifest + artifacts in R2. The Worker
  reads from R2 at request time. The R2 object write is atomic; the
  Worker code deploy is atomic. They are independent operations.
  [Survey 7 — Protocol 11: "The manifest write is atomic; the traffic
  switch is NOT (Workers code vs R2 object are independent)"]

## 2026-10-26 to 2026-11-04 Cloudflare Pages Upload Issue

- Duration: ~9 days (Oct 26 to Nov 4, 2026)
- Affected: Dashboard, Pages
- Impact: Deploy/upload blocked for affected users
- [Survey 6 — brief (g): "a 2026-10-26 'Cloudflare Pages Upload Issue'
  (Dashboard, Pages) blocked deploys for days" — verified from Cloudflare
  status page history]
- **Mitigation**: If the Worker deploy path is blocked, the existing Worker
  version continues serving. The R2 artifacts remain accessible. Only NEW
  deploys are blocked. For a one-person team, this means: ship the release
  a day early, or accept the delay.

## 2026-11-04 DO/R2 ENAM error spike

- "Increased Errors for Durable Objects and Downstream Services in Eastern
  North America (ENAM)" — resolved 2026-11-04
- Affected: R2 (downstream of Durable Objects)
- [Survey 6 — brief (g): "a 2026-11-04 Durable-Objects/R2 error spike hit
  ENAM" — verified from Cloudflare status page history]
- **Mitigation**: The R2 bucket for artifacts should be in a region
  outside ENAM if possible, or accept brief degradation. The Worker
  serves cached assets from Cloudflare's edge even if R2 origin is
  degraded.

---

# Section 8 — Failure Modes (Top 10 for Candidate A)

Each with: detection, mitigation, recovery. Cite [Survey 3] and [Survey 5].

## 1. electron-updater stale blockmap causes SHA-512 mismatch

- **What**: `current.blockmap` and cached old binary refresh on different
  conditions. A stale blockmap causes wrong byte ranges to be copied;
  SHA-512 fails with a generic error. [Survey 5 — electron-builder #10097:
  "Differential download sha512 mismatch — a class of bug open for years"]
- **Detection**: Sentry error `ERR_UPDATER_INVALID_HASH` or user reports
  "update failed"
- **Mitigation**: Keep `electronUpdaterCompatibility` at `>=7`. Always
  ship the full package alongside the blockmap. electron-updater falls
  back to full download on blockmap failure.
- **Recovery**: User retries update (full download). No manual intervention
  needed.

## 2. NSIS running-app check misses single process (PowerShell 5.1)

- **What**: `Get-CimInstance` returns a single CimInstance (not array)
  when exactly one process matches. `.Count` is `$null`, check exits 1.
  Installer skips kill; update fails. [Survey 5 — electron-builder #10454:
  "NSIS running-app check misses a single process from $INSTDIR"]
- **Detection**: User reports "update failed, please close the app and try
  again"
- **Mitigation**: Ensure `quitAndInstall()` in Electron properly kills
  ALL renderer + main processes before the installer runs. The NSIS
  script's check is a safety net, not the primary mechanism.
- **Recovery**: User manually closes app, runs installer from
  `latest.yml` URL.

## 3. Capgo bundle applied but native plugin version mismatch

- **What**: OTA JS bundle references a native plugin API that doesn't exist
  in the installed native binary (e.g., Bluetooth bridge was updated in
  native but the JS bundle expects the new API). [Survey 2 — Capgo: "If
  you make any changes to the native code, it is mandatory to resubmit
  the application to the app store"]
- **Detection**: Crashes on app launch after OTA. Sentry shows
  `TypeError: undefined is not a function` in native bridge calls.
- **Mitigation**: `min_update_version` field in Capgo manifest gates the
  JS bundle to a minimum native version. Test OTA bundles against the
  oldest supported native version before publishing.
- **Recovery**: Capgo one-click rollback to previous JS bundle. If the
  native version is too old, the app shows "Update required" and links
  to the store.

## 4. PWA service worker stuck on old version (skipWaiting race)

- **What**: `skipWaiting()` + `controllerchange` + reload creates a loop,
  OR the new SW installs but `controllerchange` never fires for tabs that
  were opened before the update. [Survey 6 — brief (e): "the classic trap
  is the skipWaiting race"]
- **Detection**: Users report "app looks the same after update" or
  "some features missing". Browser DevTools > Application > Service
  Workers shows old version still controlling.
- **Mitigation**: Use Workbox `workbox-window` recipe: `skipWaiting()` +
  `clients.claim()` in SW, single guarded reload in page, `BroadcastChannel`
  for cross-tab fan-out. [Survey 7 — Protocol 7: "skipWaiting() +
  clients.claim() in the new worker, then a single guarded reload"]
- **Recovery**: User hard-refreshes (Ctrl+Shift+R) or clears site data.
  Next natural navigation picks up the new SW.

## 5. Cloudflare Worker deploy blocked (Pages Upload Issue)

- **What**: Cloudflare infrastructure issue blocks new deploys for days.
  Existing version continues serving. [Survey 6 — brief (g): "2026-10-26
  'Cloudflare Pages Upload Issue' blocked deploys for days"]
- **Detection**: `wrangler deploy` fails with 500/502 or timeout.
  Cloudflare status page shows incident.
- **Mitigation**: Schedule releases with buffer. If blocked, the existing
  Worker continues serving — no user impact for already-deployed code.
  R2 artifacts are still uploadable (different service).
- **Recovery**: Wait for Cloudflare resolution. Deploy immediately after.
  No data loss.

## 6. iOS WWDR intermediate cert rotation breaks Ad Hoc builds

- **What**: Apple replaces the WWDR intermediate CA cert. Apps signed with
  the old intermediate fail validation until re-signed. App Store apps are
  unaffected (Apple re-staples). [Survey 4 — Topic 4: "This is THE
  classic iOS signing failure mode"]
- **Detection**: Ad Hoc / TestFlight builds stop working on devices.
  "This app cannot be used because it is not correctly signed."
- **Mitigation**: For AIRIZ, use App Store distribution (not Ad Hoc) for
  production. TestFlight builds are signed with App Store signature and
  are re-stapled by Apple. Avoid enterprise distribution entirely.
- **Recovery**: Re-sign and re-upload. For TestFlight: new build. For
  production App Store: no action needed (Apple handles re-stapling).

## 7. Android APK key mismatch after rotation failure

- **What**: A new APK is signed with a different key than the installed
  version. PackageManager rejects with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. [Survey 6 — brief (f): "you cannot
  update in place if the signing key changes, so a key mismatch forces a
  clean reinstall"]
- **Detection**: Play Store shows "Update failed" for affected users.
  Crash-free rate drops. Users file "app won't update" reports.
- **Mitigation**: NEVER change the Play App Signing key without a
  rotation ceremony. Use v3 `signersHistory` during the migration window.
  Test the rotation on the internal test track first.
- **Recovery**: If it happens: publish a new APK with the correct key.
  Users must uninstall + reinstall. This is IRREVERSIBLE for the
  affected install. [Survey 5 — Squirrel #1898 is analogous: "Delta
  updates do not work if target file contains spaces" — a path issue
  that's similarly hard to recover from]

## 8. electron-builder v27 manifest signing key missing in CI

- **What**: `ELECTRON_BUILDER_UPDATE_SIGN_KEY` not set or mistyped in
  GitHub Actions. v27 adds fail-fast, but pre-v27 only logged a warning.
  [Survey 5 — electron-builder #10429: "forceCodeSigning did not cover
  update manifest signing — a missing ELECTRON_BUILDER_UPDATE_SIGN_KEY
  produced unsigned latest*.yml files with only a warning log"]
- **Detection**: CI succeeds but `latest.yml` has no `signature` field.
  Clients refuse the update with `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`.
- **Mitigation**: In v27, `forceCodeSigning: true` + missing key = build
  FAILS. Add a CI check step that greps `latest.yml` for `signature:`
  after the build. [Survey 5 — #10429: "v27.0.0-alpha.12 added fail-fast
  for manifest key"]
- **Recovery**: Set the key, re-run the release workflow. Old unsigned
  manifest is overwritten.

## 9. Tauri NSIS "Failed to kill <App>" (if any Tauri component remains)

- **What**: If any part of the product is still on Tauri (e.g., a
  companion utility), the NSIS installer's `RmShutdown(RmForceShutdown)`
  has no wait/retry. If the app is still exiting, the check races and
  aborts. Confirmed in 4+ independent projects. [Survey 5 — Tauri #16277]
- **Detection**: "Failed to kill <App>" in installer log. User sees error
  dialog.
- **Mitigation**: For the recommended architecture (A), this is avoided
  because Electron's `quitAndInstall()` handles process termination before
  the NSIS installer runs. If any Tauri component exists, use
  `NSIS_HOOK_PREINSTALL` workaround.
- **Recovery**: User closes the app manually, re-runs the installer.

## 10. R2 origin degraded (DO/R2 ENAM error spike)

- **What**: Cloudflare Durable Objects issue in ENAM region causes R2
  read errors for ~hours. [Survey 6 — brief (g): "2026-11-04
  Durable-Objects/R2 error spike hit ENAM"]
- **Detection**: electron-updater gets 502/503 on `latest.yml` fetch.
  Sentry shows update-check failures. Cloudflare status page shows
  incident.
- **Mitigation**: Cloudflare's edge cache serves the R2 object if it was
  recently fetched (R2 objects are cacheable at the edge). The Worker's
  static assets (PWA) are served from edge cache independent of R2
  origin. Desktop updaters retry with exponential backoff.
- **Recovery**: Automatic when R2 origin recovers (typically < 1 hour).
  No manual action needed. Users who missed the update window will
  pick it up on next check.

---

# Section 9 — Migration Plan

For candidate A (evolved), migrating from the current state (5 independent
mechanisms, 3 signing pipelines) to the target state (3 effective paths,
2 signing keys, 1 artifact store).

## Phase 0 (Week 1): Foundation

- [ ] Generate Ed25519 key pair on YubiKey:
  `npx electron-builder create-update-key --key-file airiz-update.key`
  [Survey 7 — Protocol 1: "Private key: PKCS#8 PEM, generated by
  `npx electron-builder create-update-key`"]
- [ ] Add `updateManifestPublicKey` to `app-update.yml` (the SPKI DER
  base64 of the public key)
- [ ] Create R2 bucket `airiz-releases` with versioned layout:
  `/releases/{version}/{platform}/{arch}/`
- [ ] Pin `compatibility_date` in `wrangler.toml` to current working date
- [ ] Add `CLOUDFLARE_R2_S3_ACCESS_KEY_ID` + `SECRET` to GitHub Actions
  secrets
- [ ] Verify: `wrangler versions list` returns current production version
- [ ] Document: write `RELEASES.md` in repo describing the new pipeline

**Exit criteria**: Key generated, R2 bucket exists, wrangler.toml pinned.

## Phase 1 (Weeks 2-4): Desktop cutover

- [ ] Upgrade electron-builder to v27 (or v27.0.0-alpha if stable not
  yet available): `npm install electron-builder@next`
- [ ] Configure `build.publish` in `package.json`:
  ```json
  {
    "build": {
      "publish": {
        "provider": "s3",
        "bucket": "airiz-releases",
        "region": "auto",
        "path": "releases/"
      }
    }
  }
  ```
  [Survey 7 — Protocol 1: "Cloudflare R2: S3-compatible, uses `r2`
  provider type in config"]
- [ ] Set `forceCodeSigning: true` in build config so missing manifest
  key fails the build
- [ ] Update `sync_release_feed.py` to:
  1. Build with `electron-builder` (generates latest.yml + .blockmap)
  2. Sign latest.yml with Ed25519 key (v27 does this automatically)
  3. Upload all artifacts to R2 via S3-compatible API
  4. Write the release tag to a KV key (for Worker to read)
- [ ] Test on Windows: `electron-builder --win --x64`, verify latest.yml
  has `signature:` field, verify `electron-updater` fetches and installs
- [ ] Test on macOS: same, verify Squirrel.Mac atomic swap works
- [ ] Test rollback: manually re-upload previous version's latest.yml

**Exit criteria**: Desktop update works end-to-end on Win + macOS with
Ed25519-signed manifest from R2.

## Phase 2 (Months 2-3): Mobile + PWA integration

- [ ] **Mobile (Capgo)**:
  - Install `@capgo/capacitor-updater` in the Capacitor project
  - Configure via `npx @capgo/cli@latest init <API_KEY>`
  - Set channel to "production"
  - Test OTA: push a JS bundle change, verify it applies on next launch
  - Test rollback: Capgo dashboard one-click rollback
  - Verify `min_update_version` gating works
  [Survey 2 — Capgo: "CapacitorUpdater.notifyAppReady()",
  "CapacitorUpdater.setChannel('production')"]

- [ ] **PWA (Service Worker)**:
  - Audit current SW: ensure `skipWaiting()` + `clients.claim()` are in
    place
  - Add `BroadcastChannel('sw-update')` for cross-tab fan-out
  - Add Workbox `workbox-window` for the page-side update prompt
  - Verify SRI hashes are generated at build time for all JS/CSS assets
  [Survey 6 — brief (e): "skipWaiting + clients.claim, a single guarded
  reload, stale-while-revalidate"]

- [ ] **Worker**:
  - Verify Worker reads release version from KV (for /api/version endpoint)
  - Add `wrangler versions deploy <last-known-good>` as a rollback script
  - Wire Cloudflare status page webhook to GitHub Action (auto-deploy
    rollback on P1 incident)

**Exit criteria**: All 5 surfaces receive updates through their respective
mechanisms. Single GitHub Action trigger builds + signs + deploys all.

## Phase 3 (Month 4+): Hardening + observability

- [ ] **Crash-throttled rollback**:
  - Configure Sentry release-health for all 5 surfaces
  - Set alert: crash-free rate < 99% for 15 min -> Slack notification
  - For Capgo: configure automatic rollback threshold in dashboard
  - For Worker: Sentry error rate > 5% -> auto `wrangler versions deploy`
    to last-known-good
  [Survey 6 — brief (c): "crash-free-sessions plus a debounced regional
  split, with a 30-minute automated rollback"]

- [ ] **Staged rollout**:
  - Desktop: use `stagingPercentage` in latest.yml (start at 10%, ramp
    to 100% over 48 hours)
  - Mobile: Capgo percentage rollout (5% → 25% → 100%)
  - Worker: Cloudflare traffic splitting (if needed)
  [Survey 6 — brief (b): "client-hash cohorts, a single kill-switch flag,
  and minutes-level decision latency"]

- [ ] **Kill switch**:
  - Single KV key: `airiz:kill_switch` = "active" | "inactive"
  - Worker checks this key before serving /api/update-check
  - If "active": return 204 (no update) to all clients
  - One `wrangler kv put` command to stop ALL updates instantly
  [Survey 6 — brief (b): "one server-side flag is the single source of
  truth"]

- [ ] **Key rotation drill**:
  - Generate a second Ed25519 key
  - Dual-sign the next release (old + new in `signatures[]`)
  - Next release: drop old key
  - Document the ceremony in `RELEASES.md`
  [Survey 7 — Protocol 1: "Key rotation: bridge release dual-signs with
  old+new"]

- [ ] **Remove deprecated Bluetooth-bridge code** (1.11.18 deprecation)
  from the tree to reduce update payload size

**Exit criteria**: Full observability loop. Kill switch tested. Key
rotation documented and drilled. All 5 surfaces shipping through one
pipeline.

---

# Section 10 — Appendix: What We Don't Know

## Things that could not be verified in the surveys

1. **electron-builder v27 stable release date**. The surveys reference
   v27.0.0-alpha.12 through alpha.14 (Oct 2026). Whether v27.0.0 stable
   has shipped as of 2026-11-05 is unconfirmed. [Survey 5 — electron-
   builder issues reference "v27.0.0-alpha.12" as the latest alpha]

2. **Capgo free tier / exact feature limits at $19/mo**. The Starter plan
   pricing is confirmed [Survey 8 — Capawesome], but the exact feature
   matrix (max bundles, max devices, rollout granularity) is not
   documented in the surveys.

3. **Cloudflare R2 free tier limits for a one-person team**. R2 has a
   free tier (10 GB storage, 1M Class A requests/month) but the surveys
   do not confirm whether AIRIZ's artifact size (estimated 50-100 MB per
   release, 5-10 releases/month) fits within free tier.

4. **electron-updater v27 `stagingPercentage` client-side hash
   algorithm**. The field exists [Survey 7 — Protocol 1], but the exact
   deterministic hash used to assign clients to percentage buckets is
   not documented in the surveys. (Squirrel.Windows uses machine name
   hash [Survey 2 — Squirrel: "Squirrel hashes the machine name to assign
   a stable percentage bucket"]; electron-updater v27's algorithm is
   assumed similar but not verified.)

5. **The Python stdlib server for device-audio auto-save**. The user
   described it as part of the current stack, but none of the 8 surveys
   cover it. Its update mechanism (if any) is unknown. It may be
   deployed alongside the Worker or as a separate service.

## Things Juwen needs to verify themselves

1. **EV cert budget**. If the Windows code-signing cert is an EV cert,
   the renewal cost ($1,500-$3,000/yr) and the 39-month max validity
   (phasing down per CA/B Forum) need to be in the budget. [Survey 4 —
   Topic 2: "EV certs ~ $1,500-$3,000/yr"]

2. **iOS distribution choice for the EU**. The EU DMA alternative
   distribution (2025) allows third-party stores and side-loading for
   business users. If AIRIZ targets EU users, this may affect the
   distribution strategy. [Survey 4 — Topic 4: "EU DMA alternative
   distribution (2024-2025)"]

3. **Whether Capgo's $19/mo Starter plan includes automatic rollback**.
   The surveys confirm "one-click in dashboard" [Survey 2 — Capgo:
   "Rollback: one-click in dashboard"] but do not confirm whether
   threshold-based automatic rollback is available at the Starter tier
   vs. Professional ($49/mo).

4. **The exact current version of the Bluetooth-bridge plugin in the
   tree**. The user states it's "deprecated 1.11.18 but in tree." The
   surveys do not cover this plugin. Removing it changes the native
   binary and requires a store resubmission.

5. **Whether the PWA is currently deployed on Cloudflare Pages or as
   Worker Static Assets**. The 2026-10-26 Pages Upload Issue [Survey 6 —
   brief (g)] affects Pages specifically. If the PWA is on Pages (not
   Worker Assets), it was affected. If it's on Worker Assets, it was
   not.

6. **The current state of the 3 signing pipelines**. The user describes
   "3 independent signing pipelines" but the surveys do not document
   AIRIZ's specific current setup. Are they: (a) Windows Authenticode +
   Apple Developer ID + Android keystore? (b) Something else? This
   affects the Phase 1 migration scope.

7. **Sentry (or equivalent) already configured?** The crash-throttled
   rollback plan (Phase 3) assumes a telemetry backend exists. If not,
   adding one is a Phase 2 prerequisite.

8. **The exact R2 bucket region and whether ENAM is a risk**. The
   2026-11-04 DO/R2 ENAM error spike [Survey 6 — brief (g)] affected
   Eastern North America. If the R2 bucket is in `auto` (Cloudflare's
   default, which uses the account's home region), it may or may not be
   in ENAM.

---

## Citation Key

| Tag | File | Description |
|-----|------|-------------|
| Survey 1 | tool_1a97c158d001cr65SiGMuARlN4 | Wrangler CLI documentation (Cloudflare Workers deploy, versions, secrets) |
| Survey 2 | tool_1a97e4023001ZcIh0nqjUuVXZ4 | 12 update protocols (electron-updater, Squirrel, Sparkle, Tauri, Capgo, Expo, CodePush, PWA SW, AppInstaller) |
| Survey 3 | tool_1a97e687f001ferp31rL3ATq5w | Top 10 hardest problems + outage citations (CrowdStrike, CCleaner, ASUS, SolarWinds, electron-builder) |
| Survey 4 | tool_1a97e65bc00135ytK13AqgsjJ7 | Security best practices 2026 (ed25519, EV certs, APK v3/v4, iOS signing, PWA SRI, Cloudflare Workers, staged rollouts) |
| Survey 5 | tool_1a97e6377001Gv6f9g94jbqNzD | Postmortems since 2022 (electron-builder, Squirrel.Windows, Sparkle, Tauri, CodePush/App Center, cross-cutting incidents) |
| Survey 6 | tool_1a97e6f980014kFghHrdoWSrEm | 8 architecture trade-off briefs (delta-vs-full, staged rollouts, crash-throttled rollback, signed manifests, PWA SW traps, store-vs-sideload, CF Worker signed deploys, multi-arch) |
| Survey 7 | tool_1a97e6a84001bCJgxiiRTJvwhf | Protocol specs minimum viable subset + unified manifest JSON schema proposal |
| Survey 8 | tool_1a97e6ce7001BEOf64CNwJznOB | 18 framework update landscape (Tauri, Flutter, MAUI, Uno, KMP, RN, Capawesome, Electron, Capacitor, etc.) |

## Verification Status

| Claim | Status |
|-------|--------|
| electron-builder v27 adds Ed25519 manifest signing | Verified (Survey 5 #10429, Survey 7 Protocol 1) |
| Tauri updater does NOT work on mobile (cfg(desktop)) | Verified (Survey 8, citing Tauri source + blog) |
| Capgo is the successor to deprecated capacitor-community/live-update | Verified (Survey 2 Protocol 8, Survey 7 Protocol 3) |
| Cloudflare Pages Upload Issue 2026-10-26 to 2026-11-04 | Verified (Survey 6 brief g, from CF status page history) |
| DO/R2 ENAM error spike 2026-11-04 | Verified (Survey 6 brief g, from CF status page history) |
| CrowdStrike 2024-07-19 (channel file 291, 8.5M machines) | Verified facts, blog URL slug 404'd on re-check (Survey 3, 5) |
| CCleaner 2017 (2.27M machines) | Verified facts, canonical URL not re-verified (Survey 3, 5) |
| ASUS Live Update 2019 (1M+ machines, Kaspersky) | Verified HTTP 200 this session (Survey 3) |
| SolarWinds 2020 (18,000 orgs) | Verified facts, canonical URL not re-verified (Survey 3, 5) |
| electron-builder #10097 (stale blockmap) | Verified via GitHub (Survey 5) |
| electron-builder #10454 (NSIS single process) | Verified via GitHub (Survey 5) |
| Tauri #16277 (NSIS Failed to kill) | Verified via GitHub (Survey 5) |
| Squirrel.Windows #1470 (seeking maintainers) | Verified via GitHub (Survey 2, 5) |
| CodePush / App Center sunset March 31, 2025 | Verified (Survey 8, citing learn.microsoft.com) |
| PWA has no signing protocol | Verified (Survey 7 Protocol 7: "NO signing protocol") |
| Cloudflare Workers auth is opaque API token (not JWT) | Verified (Survey 4 Topic 6) |
| iOS WWDR intermediate cert rotation is THE classic failure | Verified (Survey 4 Topic 4) |
| APK v3 signersHistory for key rotation | Verified (Survey 4 Topic 3) |
| TestFlight builds expire after 90 days | Verified (Survey 4 Topic 4) |
| No known production case of single manifest across Electron+Capacitor+PWA+Worker | Verified (Survey 8: explicit statement) |

---

END OF REPORT.
