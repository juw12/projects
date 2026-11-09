# AIRIZ Motor Console — Unified Release Architecture Recommendation (PRELIMINARY)

**Status:** Preliminary synthesis. Pass 2 verification will refine specific facts.
**Author:** Sisyphus (orchestration)
**Date:** 2026-11-05
**Owner:** Juwen Lie, Ziris PTB
**Decision:** Pending verification pass; preliminary recommendation below.

---

## The Question

AIRIZ Motor Console has 5 surfaces today:

| # | Surface | Current update mechanism |
|---|---------|--------------------------|
| 1 | Electron Windows desktop (signed installer + portable) | `electron-updater` v6.8.11 + custom `sync_release_feed.py` |
| 2 | Capacitor Android mobile (signed APK, keystore in `AIRIZ_ANDROID_KEYSTORE_BASE64`) | Play Store only |
| 3 | Capacitor iOS mobile (unsigned IPA + zipped Xcode project) | App Store only (when published) |
| 4 | Static web PWA + Web Serial API | Pages-hosted service worker update |
| 5 | Cloudflare Workers + Durable Objects relay | `wrangler versions` + gradual deploys |

Goal: pick the **simplest unified release architecture** for a one-person team shipping signed updates to all five surfaces without inventing a new manifest format per platform.

---

## Option Analysis

### Option A — Keep current split, bolt on Capacitor Live Update

**Composition:**
- Windows: `electron-updater` + `sync_release_feed.py` (existing)
- Android/iOS: add `@capawesome/capacitor-live-update`
- PWA: native service worker
- Worker: wrangler

**Manifest formats:**
- Electron: `latest.yml` (electron-updater v27 with `updateManifestPublicKey` for ed25519 manifest signing)
- Capacitor: ZIP bundle manifest + `capawesome-live-update-manifest.json` (Capawesome)
- PWA: SW file + precache manifest
- Worker: wrangler versions metadata

**Signing schemes:**
- Windows: Authenticode (SHA-256) + ed25519 manifest
- Android: APK Signature Scheme v2/v3/v4 + RSA-2048 PKCS1v15 SHA256 (Capawesome) or platform-native
- iOS: Apple Developer ID + notarization
- PWA: SRI hashes (no PKI)
- Worker: wrangler signature

**Pros:**
- No rewrite of working code
- Each surface uses its native tool
- Battle-tested components

**Cons (decisive):**
- **5 manifest formats** to maintain
- **5 signing schemes** to manage
- **5 update triggers** (app lifecycle, app start, navigation event, wrangler deploy)
- **5 places to break** — unsustainable for a one-person team
- No cross-surface coordinated rollout
- No single telemetry signal to gate rollouts

**Verdict:** ✗ Not viable for a one-person team. 5 places to break means 5 different incident postmortems.

---

### Option B — Migrate to Tauri

**Composition:**
- Desktop (Win/macOS/Linux): Tauri replaces Electron
- Everything else unchanged

**Pros:**
- Single ed25519 updater for desktop (Tauri 2.x protocol)
- Smaller binary, better performance, modern Rust backend
- Active community, signed update manifests built in

**Cons (decisive):**
- **Tauri 2.x updater covers desktop ONLY** — Windows, macOS, Linux. NO first-party updater for mobile (Android, iOS) or for the PWA / Worker surfaces.
- Tauri mobile (v2.x) is experimental. No live-update plugin at all.
- Rewrite cost on desktop is significant. AIRIZ has existing custom logic in `desktop/update-controller.cjs` (validateUpdate, autoBusyReason, 5-min idle rule) that would need re-implementation.
- Tauri doesn't simplify mobile/PWA/Worker — half the problem is unchanged.
- Capgo Capacitor Live Update is still needed for mobile.

**Verdict:** ✗ Doesn't cover half the fleet. Mobile, PWA, Worker remain a separate problem.

---

### Option C — Build unified signed-manifest layer

**Composition:**
- One canonical ed25519-signed JSON manifest in CI
- Per-surface adapters emit each vendor's manifest from the canonical
- One signing key per environment
- One staged-rollout control plane (server-side gating on the canonical endpoint)

**Pros (decisive):**
- **ONE signing key** (ed25519) for the whole fleet
- **ONE manifest schema** to maintain
- **ONE place** to gate staged rollouts (canonical endpoint)
- **ONE telemetry signal** (Sentry crash-free sessions tagged by `release_id`)
- **ONE rollback** (re-publish previous canonical manifest)
- Future surfaces (Linux, ChromeOS, visionOS) need only a new adapter
- Adapters are colocated in one repo (`apps/airiz-motor/release-protocol/`)

**Cons:**
- Initial build cost: write 4 adapters, replace `sync_release_feed.py`
- Adapters must handle vendor quirks (electron-updater needs `files[]` array; Capawesome wants RSA; PWA needs SRI baked into HTML; Worker needs wrangler invocation)
- 5 adapter failure modes — but they're all in one repo, one language (Python or Node), one CI step

**Verdict:** ✓ **RECOMMENDED.** Single source of truth, single signing key, single rollback.

---

## Recommended Architecture (Option C)

### Canonical Manifest Schema (v1)

Served at `https://releases.airiz/v1/{channel}/manifest.json`:

```json
{
  "schema_version": 1,
  "release_id": "airiz-motor@1.2.3+2026.11.05",
  "channel": "stable",
  "staging_percentage": 10,
  "published_at": "2026-11-05T12:00:00Z",
  "release_notes": "Bug fixes for Bluetooth bridge, new Web Serial fallback.",
  "min_app_versions": {
    "windows": "1.0.0",
    "android": "1.0.0",
    "ios": "1.0.0",
    "pwa": "v1.0.0"
  },
  "platforms": {
    "windows-x64": {
      "format": "nsis",
      "version": "1.2.3",
      "url": "https://releases.airiz/airiz-motor-1.2.3-setup.exe",
      "sha512": "<base64>",
      "size": 12345,
      "blockmap_url": "https://releases.airiz/airiz-motor-1.2.3-setup.exe.blockmap"
    },
    "android-arm64-v8a": {
      "format": "aab",
      "version_code": 1020300,
      "version_name": "1.2.3",
      "url": "https://releases.airiz/airiz-motor-1.2.3.aab",
      "sha256": "<hex>",
      "play_track": "internal"
    },
    "ios-arm64": {
      "format": "ipa",
      "build_number": "1020300",
      "version": "1.2.3",
      "url": "https://releases.airiz/airiz-motor-1.2.3.ipa",
      "ipa_sha256": "<hex>"
    },
    "web-pwa": {
      "format": "service-worker",
      "version": "v1.2.3",
      "sw_url": "https://airiz.app/sw.js",
      "sri": {
        "sw.js": "sha384-...",
        "app.js": "sha384-...",
        "app.css": "sha384-...",
        "index.html": "sha384-..."
      },
      "cache_strategy": "precache-v2"
    },
    "worker-relay": {
      "format": "wrangler-version",
      "version_id": "<cloudflare-version-id>",
      "rollout_percentage": 50,
      "do_migration": false
    }
  },
  "signature": {
    "key_id": "<hex-sha256-of-spki>",
    "algorithm": "ed25519",
    "value": "<base64>"
  }
}
```

### Adapters (Phase 1 = 6 weeks)

| Phase | Adapter | Surface | Reads canonical, emits... |
|-------|---------|---------|---------------------------|
| 1 (wk 1-2) | `emit-windows.ts` | Electron Windows | `latest.yml` + `app-update.yml` (electron-updater v27 with `updateManifestPublicKey`) |
| 2 (wk 3-4) | `emit-capacitor.ts` | Android/iOS | Capawesome JSON manifest, OR custom Capacitor plugin reading canonical directly |
| 3 (wk 5) | `emit-pwa.ts` | Web | `sw.js` + asset files with SRI hashes baked into `index.html` |
| 4 (wk 6) | `emit-worker.ts` | Cloudflare Worker | wrangler manifest + calls `wrangler versions deploy` with gradual split |

### Signing Key Custody

- **Private key:** GitHub secret `AIRIZ_RELEASE_SIGN_KEY` (base64) — used in CI only via OIDC federation (no long-lived secret on disk)
- **Public key:** Compiled into each surface's binary
  - Electron: `app-update.yml` → `updateManifestPublicKey`
  - Capacitor: Capacitor config → `releaseProtocol.publicKey`
  - PWA: Embedded in `sw.js` → checked before applying update
  - Worker: Embedded in worker code → checked before applying staged rollouts
- **Rotation:** ship an update with a new pubkey embedded, signed by the old key (Tauri/Sparkle pattern)

### Staged Rollout Gate

- **10% canary → 30 min observation**
- **50% rollout → 60 min observation** (≥ 1000 sessions for statistical significance)
- **100% → 4 hr observation**
- **Auto-rollback** if Sentry crash-free sessions drops below 99.5% for any version
- **Kill switch:** Re-publish previous `release_id` to canonical endpoint (all clients re-check)

### Atomic Install (per surface)

| Surface | Atomic strategy |
|---------|-----------------|
| Windows (NSIS) | 2-directory swap (avoid delete-then-write). Required because electron-builder NSIS known bug (#6869) leaves app uninstalled on partial install |
| Android/iOS (Capacitor) | current bundle + next bundle (Capawesome already does this with `readyTimeout`) |
| PWA | SW `install` → populate new cache → `skipWaiting()` → `clients.claim()` (avoid the SW update traps documented in MDN) |
| Worker | `wrangler rollback <version-id>` → immediate new deployment at 100% |

### Initial Decisions (Defer Deltas + Tauri)

- **Delta updates:** Phase 8+. Start with full updates. Add bsdiff/blockmap deltas once bandwidth matters. Electron-updater already supports blockmap differential — wire it up when needed.
- **Tauri migration:** Defer indefinitely. Tauri doesn't simplify mobile/PWA/Worker. Revisit only if desktop binary size, memory, or signing chain becomes a problem.
- **Staged rollout start:** Day 1. Even at 1-person team, the 10% canary discipline prevents the CrowdStrike scenario.

---

## Critical Design Decisions (Pre-Implementation)

1. **Key custody:** GitHub secret + OIDC federation (Azure Trusted Signing pattern). No long-lived secrets on disk. Validate at CI step.
2. **Atomic install:** 2-directory swap (Win), current+next bundle (Capacitor), SW install+claim (PWA), wrangler rollback (Worker). Avoid the documented failure modes from each platform.
3. **Telemetry-gated rollout:** Sentry crash-free sessions ≥ 99.5% per stage. Auto-rollback if breached. Manual override via "promote-now" command.
4. **One signing key:** ed25519 (32-byte keys, deterministic signatures, no padding oracle). Consistent across surfaces. Public key embedded in binary.
5. **No new manifest format per platform:** canonical schema → adapters → vendor manifests. Single signing key + signing operation per release.
6. **Defer deltas + Tauri:** not needed yet. Re-evaluate when bandwidth or binary size becomes a problem.

---

## Open Questions for Pass 2 Verification

1. Does the recovered key-findings digest for `electron-updater` and `@capawesome/capacitor-live-update` match what other agents independently found? (Pass 2 verification needed.)
2. Is the canonical schema above sufficient for all 5 surfaces, or does PWA need separate `manifest.json` (web app manifest) beyond the SW manifest? (Verify W3C + MDN guidance.)
3. Does electron-updater v27 signed-manifest verification actually require ed25519, or does it accept the current SHA-512-only path? (Verify in v27 docs.)
4. Can the Cloudflare Worker read the canonical manifest directly, or does it require an adapter that calls `wrangler versions deploy`? (Verify wrangler API.)
5. Does Capacitor (Capawesome) support ed25519, or only RSA-2048? If only RSA, the canonical ed25519 needs a parallel RSA path for Capacitor only. (Verify Capawesome source.)

---

## Next Steps

- **IMMEDIATE:** Fire Pass 2 verification of all 8 research agents to validate findings, especially the open questions above.
- **After Pass 2:** Reconcile disagreements (Pass 3) if any.
- **After verification:** Lock the canonical schema, build Phase 1 adapter (`emit-windows.ts`), wire to existing `airiz-desktop.yml` workflow.
