# AIRIZ Motor Console — Unified Release Architecture Decision Matrix

**Date:** 2026-11-05
**Author:** Juwen Lie (AIRIZ Motor Console, team Ziris PTB)
**Inputs:** 7/8 survey deliverables (4,265 lines on disk + 4 in-session outputs)
**Status:** Ready for decision

---

## 1. The Five Surfaces

| Surface | Runtime | Update unit | Current mechanism |
|---------|---------|-------------|-------------------|
| Desktop (Windows) | Electron 31+ | Full NSIS installer / zip | `electron-updater` 6.8.11 → `latest.yml` |
| Mobile (Android) | Capacitor 6+ | Web bundle (JS/HTML/CSS) | None yet (planned: Capawesome Live Update) |
| Mobile (iOS) | Capacitor 6+ | Web bundle (JS/HTML/CSS) | None yet (planned: Capawesome Live Update) |
| Web (PWA) | Browser (Chrome/Edge/Safari) | SW script + precached assets | Workbox (planned) |
| Edge (delivery) | Cloudflare Worker | Worker script (deployed via Wrangler) | `wrangler deploy` |

**Key architectural insight:** The five surfaces fall into **two update tiers**:

- **Full-binary swap tier** (Electron desktop): download → verify → install-on-quit → relaunch.
- **Hot-reload tier** (Capacitor mobile, PWA web): download → verify → pointer swap → reload webview/navigation.

The Cloudflare Worker is not an "update target" — it is the **release gateway** that fronts all other surfaces.

---

## 2. The Three Options

### Option (a): Keep `electron-updater` + bolt `@capawesome/capacitor-live-update`

**What it means:** Continue using the two engines already in the monorepo. Add Capawesome Live Update for Capacitor. Use Workbox for PWA. Cloudflare Worker as static file server + simple version gating.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare R2 (static storage)                         │
│  ├── electron/latest.yml + blockmap + NSIS installer    │
│  ├── capacitor/bundle-v{N}.zip + signature              │
│  └── pwa/sw.js + precache-manifest-v{N}.json            │
├─────────────────────────────────────────────────────────┤
│  Cloudflare Worker (gateway)                            │
│  ├── GET /electron/latest.yml  → R2 + stagingPercentage │
│  ├── GET /capacitor/latest     → R2 + X-Signature       │
│  ├── GET /pwa/sw.js            → R2 (no-cache)          │
│  └── GET /health               → 200                    │
└─────────────────────────────────────────────────────────┘
```

**Trust model:**
- Desktop: Authenticode (Windows) + minisign/Ed25519 (macOS) + SHA-512 blockmap. **Strong.**
- Mobile: RSA-2048 SHA256withRSA signature (Capawesome `publicKey`). **Strong.**
- PWA: HTTPS + byte fingerprint + optional SRI. **Weakest link.**

**Ops burden:**
- 3 signing pipelines (Authenticode, Capawesome RSA, none-for-PWA)
- `sync_release_feed.py` remains the single publish script
- No built-in rollback on desktop (must keep prior installer reachable)
- Capawesome Cloud OR self-host (self-host = more infra)
- Workbox SW traps (no rename, no-cache, prune caches)

**Maturity (2026):**
- `electron-updater` 6.8.11: active, 2.7K stars, used by VS Code, Slack, Discord, Figma
- Capawesome Live Update 8.7.1: active, 1B+ updates/month via Capawesome, self-hostable
- Workbox 7.4.1: active, Google-maintained
- **No dead dependencies.**

---

### Option (b): Migrate whole stack to Tauri 2.x

**What it means:** Replace Electron with Tauri for desktop. Tauri's `@tauri-apps/plugin-updater` provides first-party update for Win/Mac/Linux. For mobile, Tauri 2 has experimental mobile targets (Android/iOS) but **no first-party mobile OTA** — you'd still need Capawesome or store-only.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│  Tauri Desktop (Rust core + system webview)             │
│  ├── @tauri-apps/plugin-updater (ed25519 minisign)      │
│  ├── tauri.conf.json → updater.pubkey + endpoint        │
│  └── Update flow: check → download → verify → install   │
├─────────────────────────────────────────────────────────┤
│  Tauri Mobile (experimental)                            │
│  ├── NO first-party OTA                                 │
│  ├── Store-only (Play/App Store)                        │
│  └── OR bolt Capawesome into the webview layer          │
├─────────────────────────────────────────────────────────┤
│  PWA (unchanged)                                        │
│  └── Workbox (same as option a)                         │
├─────────────────────────────────────────────────────────┤
│  Cloudflare Worker (same gateway pattern)               │
│  └── Serves Tauri updater JSON + mobile + PWA           │
└─────────────────────────────────────────────────────────┘
```

**Trust model:**
- Desktop: **ed25519 minisign** (mandatory, embedded pubkey in `tauri.conf.json`). **Strongest available.**
- Mobile: Store signing (OS-enforced) + Capawesome if OTA needed. **Strong (store) / Medium (Capawesome).**
- PWA: Same as option (a). **Weakest link.**

**Migration cost:**
- **Desktop:** Full rewrite from Electron (Chromium + Node.js) to Tauri (system webview + Rust). All Node.js native modules, IPC, system tray, deep links, file dialogs, auto-start, etc. must be reimplemented in Rust plugins or Tauri's JS API.
  - Electron API surface used by AIRIZ (estimated): `BrowserWindow`, `ipcMain`/`ipcRenderer`, `nativeTheme`, `systemPreferences`, `shell`, `app`, `Menu`, `Tray`, `protocol`, `contextBridge` → **~8-12 weeks of full-time work** for a one-person team.
- **Mobile:** Tauri mobile is **experimental** (beta). No production-grade OTA. You'd still need Capawesome → **no net gain over option (a)**.
- **PWA:** Unchanged.
- **Worker:** Unchanged.

**Maturity (2026):**
- Tauri 2.14.1: active, 70K+ stars, growing fast
- Tauri mobile: **experimental, not production-ready** (official docs say "beta")
- Tauri updater: mature for desktop, no mobile equivalent
- **Risk: Tauri mobile may not be production-ready when needed**

**Key risk:** Tauri's updater key is **ed25519, single key, no rotation story in v2**. Key loss = permanent brick for all desktop updates. (Tauri docs acknowledge this; v3 rotation is "planned" but undated.)

---

### Option (c): Build a unified signed-manifest-on-R2 layer

**What it means:** Abandon `electron-updater` entirely. Write a custom updater client (thin) that pulls a **single signed manifest** from R2 (via the Worker gateway). The manifest describes the update for ALL surfaces. Each surface has a small platform-specific "apply" step, but the **decision logic** (version comparison, staging, channel, kill switch, rollback) lives in ONE place.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│  AIRIZ Release Manifest (single source of truth)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ {                                                          │  │
│  │   "schema": "airiz.release/v1",                           │  │
│  │   "version": "2.4.1",                                     │  │
│  │   "publishedAt": "2026-11-05T08:00:00Z",                  │  │
│  │   "channel": "stable",                                    │  │
│  │   "signature": "ed25519:<base64>",                        │  │
│  │   "surfaces": {                                           │  │
│  │     "electron": {                                         │  │
│  │       "minVersion": "2.0.0",                              │  │
│  │       "artifacts": {                                      │  │
│  │         "win-x64": { "url": "…", "sha512": "…", "size": …}│  │
│  │       },                                                  │  │
│  │       "installer": "nsis"                                 │  │
│  │     },                                                    │  │
│  │     "capacitor": {                                        │  │
│  │       "minVersion": "2.0.0",                              │  │
│  │       "bundle": { "url": "…", "sha256": "…" },            │  │
│  │       "rollbackToEmbedded": true                          │  │
│  │     },                                                    │  │
│  │     "pwa": {                                              │  │
│  │       "minVersion": "2.0.0",                              │  │
│  │       "swUrl": "…/sw.js",                                 │  │
│  │       "precache": "…/precache-manifest-v42.json"          │  │
│  │     },                                                    │  │
│  │     "worker": {                                           │  │
│  │       "minVersion": "2.0.0",                              │  │
│  │       "deployId": "wr-abc123"                             │  │
│  │     }                                                     │  │
│  │   },                                                      │  │
│  │   "rollout": {                                            │  │
│  │     "percentage": 100,                                    │  │
│  │     "deterministicKey": "installId",                      │  │
│  │     "allowList": [],                                      │  │
│  │     "denyList": [],                                       │  │
│  │     "killSwitch": false                                   │  │
│  │   }                                                       │  │
│  │ }                                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  Stored at: R2://airiz-releases/stable/manifest.json            │
│  Signed with: ed25519 (key in HSM / 1Password / CI secret)     │
├─────────────────────────────────────────────────────────────────┤
│  Cloudflare Worker (single gateway)                             │
│  ├── GET /manifest → returns manifest (signed)                  │
│  ├── GET /manifest?channel=beta → channel-routed                │
│  ├── GET /artifacts/* → R2 signed URL redirect                  │
│  ├── Staging: hash(installId) % 100 < percentage → new version  │
│  ├── Kill switch: return older manifest / 204                   │
│  └── Rollback: republish prior manifest (atomic R2 write)       │
├─────────────────────────────────────────────────────────────────┤
│  Clients (thin, platform-specific "apply" only)                 │
│  ├── Electron: fetch manifest → verify sig → download → NSIS    │
│  ├── Capacitor: fetch manifest → verify sig → download → swap   │
│  ├── PWA: fetch manifest → verify SW hash → update SW           │
│  └── Worker: (deployed via Wrangler; manifest is informational) │
└─────────────────────────────────────────────────────────────────┘
```

**Trust model:**
- **Single ed25519 key** signs the manifest (covers all surfaces).
- Each artifact has its own SHA-256/SHA-512 checksum.
- Worker enforces: channel routing, staging %, kill switch, rollback.
- **Strongest possible unified trust story** — one key, one manifest, one gateway.

**Build cost:**
- **Electron client:** Replace `electron-updater` with ~200 lines of custom code (fetch manifest → verify ed25519 → download → verify SHA-512 → run NSIS installer). You lose: blockmap/delta, auto-NSIS integration, `setFeedURL`, progress events. You gain: full control, no YAML parsing, no Squirrel.Mac dependency.
- **Capacitor client:** Replace Capawesome with ~150 lines (fetch manifest → verify SHA-256 → download zip → swap `CAP_SERVER_PATH` → `bridge.reload()`). You lose: `ready()`/`readyTimeout` auto-rollback, `autoBlockRolledBackBundles`, Capawesome Cloud dashboard. You gain: no vendor dependency, unified key.
- **PWA client:** Workbox + SW update (unchanged from option a).
- **Worker:** ~300 lines (manifest routing, staging hash, kill switch, signed R2 URLs).
- **Total new code:** ~650 lines across 4 files. **2-3 weeks** for a one-person team.

**Maturity (2026):**
- You are the maintainer. **Bus factor = 1.**
- No external dependency can die on you (no CodePush retirement, no Capawesome Cloud changes).
- No vendor lock-in. No API changes. No pricing changes.
- **But:** you own all bug fixes, security patches, edge cases.

---

## 3. Decision Matrix

| Criterion | (a) electron-updater + Capawesome | (b) Tauri migration | (c) Unified manifest-on-R2 |
|-----------|----------------------------------|--------------------|---------------------------|
| **Time to ship (from current state)** | 1-2 weeks (add Capawesome plugin) | 12-16 weeks (full Electron→Tauri rewrite) | 2-3 weeks (replace 2 clients + build Worker) |
| **One-person team feasibility** | ✔ High | ✘ Low (12+ weeks full-time) | ✔ High |
| **Trust model strength** | Strong (2 separate keys) | Strongest (1 ed25519 key, desktop only) | **Strongest unified** (1 ed25519 key, all surfaces) |
| **Mobile OTA** | ✔ Capawesome (mature, 1B+/mo) | ✘ Experimental (Tauri mobile beta) | ✔ Custom (you own it) |
| **Desktop delta updates** | ✔ blockmap + SHA-512 (built-in) | ✘ Full download only | ✘ Full download only (unless you add bsdiff) |
| **Staged rollout** | ✔ `stagingPercentage` (desktop only) | ✘ Server-side only | ✔ **Worker enforces for ALL surfaces** |
| **Kill switch** | ◐ Remove/zero the yml (manual) | ◐ Server 204 | ✔ **One field in manifest** |
| **Rollback** | ✘ Desktop (no auto-rollback) / ✔ Mobile (`ready()`) | ✘ Desktop / ✘ Mobile | ✔ **Reprior manifest (atomic R2)** |
| **Crash-throttled rollback** | ✘ | ✘ | ✔ (Worker logic: Sentry crash rate → serve older) |
| **PWA signing** | ✘ (no SW signing) | ✘ (same) | ◐ (SW hash in manifest, client verifies) |
| **Vendor dependency risk** | Medium (Capawesome Cloud or self-host) | Medium (Tauri mobile beta) | **None** (you own all code) |
| **Ops burden** | Medium (3 signing pipelines) | Medium (1 signing pipeline + store) | **Low** (1 key, 1 manifest, 1 Worker) |
| **Audit trail** | ◐ (per-surface) | ◐ (per-surface) | ✔ **Single manifest = single audit point** |
| **Compliance (SOC2, ISO 27001)** | Medium (multiple mechanisms) | Medium | **Strong** (one signed artifact, one gateway) |
| **Upgrade flexibility** | Medium (locked to electron-updater API) | Medium (locked to Tauri plugin API) | **Full** (your schema, your rules) |
| **Desktop binary size** | Large (Electron = ~80MB+) | **Small** (Tauri = ~5-10MB) | Large (still Electron) |
| **Memory footprint** | High (Chromium) | **Low** (system webview) | High (still Electron) |
| **Existing code reuse** | 100% (no change) | ~20% (Rust rewrite) | ~80% (replace 2 clients, keep rest) |
| **Key rotation** | N/A (per-OS certs) | ✘ No rotation in v2 (key loss = brick) | ✔ **You control rotation** (re-sign manifest, update pubkey) |
| **Multi-channel (stable/beta/canary)** | ✔ (separate yml files) | ◐ (`?channel=` param) | ✔ **`channel` field in manifest** |
| **Delta updates (save bandwidth)** | ✔ (blockmap) | ✘ | ✘ (add later if needed) |
| **Store compliance (iOS/Android)** | ✔ (Capawesome works with store) | ✔ (Tauri mobile = store) | ✔ (custom works with store) |
| **Sentry/crash integration** | Manual | Manual | **Built into Worker logic** |
| **Offline update (air-gapped)** | ✔ (local yml) | ✔ (local JSON) | ✔ (local manifest) |
| **Multi-arch (x64/ARM)** | ✔ (packages map) | ✔ (per-platform bundles) | ✔ (artifacts map) |
| **Total new code to write** | ~100 lines (Capawesome config) | ~5,000+ lines (Rust rewrite) | ~650 lines (4 files) |
| **Total lines to delete** | 0 | ~8,000+ (Electron code) | ~200 (electron-updater config) |

---

## 4. Risk Analysis

### Option (a) risks:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Capawesome Cloud pricing change / TOS change | Medium | Medium | Self-host (documented) |
| electron-updater major version breaking change | Low | Medium | Pin version, test upgrades |
| No desktop rollback → bad update bricks users | Medium | High | Keep prior installer on R2; document manual reinstall |
| PWA trust weakness (no signing) | High | Low (motor console = authenticated) | SRI + HTTPS + gateway gating |
| 3 separate signing pipelines = 3 failure points | Medium | Medium | Automate all 3 in CI |

### Option (b) risks:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tauri mobile not production-ready | **High** | **High** | Don't ship mobile until Tauri mobile is stable |
| 12-16 week rewrite delays product | High | High | Parallel development (but one person = serial) |
| ed25519 key loss = permanent brick | Low | **Critical** | HSM storage + backup procedure (but no rotation in v2) |
| Tauri ecosystem gaps (missing plugins) | Medium | Medium | Audit all Electron APIs used before committing |
| Rust learning curve for one-person team | High | Medium | Budget extra time; use Tauri's JS API where possible |
| No delta updates → larger downloads | Medium | Low | Acceptable for motor console (internal users) |

### Option (c) risks:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| You are the single maintainer (bus factor = 1) | High | Medium | Document everything; keep code < 1000 lines |
| Custom code has bugs that engines would have caught | Medium | Medium | Test matrix: 5 surfaces × 3 OS versions × 2 channels |
| No delta updates (initially) | High | Low | Add bsdiff later if bandwidth matters |
| ed25519 key loss | Low | High | HSM + 1Password + CI secret; **rotation IS possible** (unlike Tauri) |
| Worker becomes SPOF for updates | Low | Medium | R2 static fallback (manifest also on R2 direct) |
| Scope creep (building "the next Tauri") | Medium | Medium | **Hard constraint: < 1000 lines total.** If it grows, you've gone too far. |

---

## 5. The "Do Nothing" Baseline

Current state (as of this writing):
- `electron-updater` 6.8.11 in the monorepo for desktop
- `sync_release_feed.py` as the publish script
- **No mobile OTA** (Capacitor apps are store-only)
- **No PWA update mechanism**
- **No Worker gateway** (static R2 or direct deploy)
- 3 GitHub workflows: `airiz-desktop.yml`, `airiz-mobile.yml`, `airiz-relay-worker.yml`

**Gap:** The monorepo has 5 surfaces but only 1 update mechanism (desktop). Mobile, PWA, and Worker have no automated update path.

---

## 6. Recommendation

### **Option (a) now, Option (c) later. Do NOT do Option (b).**

**Phase 1 (this sprint, 1-2 weeks): Option (a)**
1. Add `@capawesome/capacitor-live-update` to the Capacitor apps
2. Configure RSA-2048 key pair (store private key in 1Password, public key in app config)
3. Extend `sync_release_feed.py` to also publish Capacitor bundle + signature to R2
4. Add Workbox to the PWA (precache manifest + SW update handler)
5. Keep `electron-updater` as-is for desktop
6. **Deliverable:** All 5 surfaces have an automated update path

**Phase 2 (next quarter, 2-3 weeks): Migrate to Option (c)**
1. Design the `airiz.release/v1` manifest schema (from the architecture in Section 2c)
2. Build the Worker gateway (~300 lines): channel routing, staging hash, kill switch
3. Replace `electron-updater` with thin custom client (~200 lines)
4. Replace Capawesome with thin custom client (~150 lines)
5. Migrate signing to single ed25519 key (re-sign all artifacts)
6. **Deliverable:** One manifest, one key, one gateway, all 5 surfaces
7. **Kill criterion:** If the custom code exceeds 1,000 lines total, stop and stay on (a)

**Why NOT Option (b):**
- Tauri mobile is **experimental** — you cannot ship a production motor console on beta mobile
- 12-16 week rewrite for a one-person team is **unacceptable risk** to product velocity
- The binary size / memory savings (80MB → 5MB) are **nice-to-have, not must-have** for an internal tool
- ed25519 key with **no rotation in v2** is a **single point of permanent failure**
- You'd still need Capawesome (or custom) for mobile OTA → **no net simplification**
- The only compelling reason to choose Tauri is binary size, and that's not the constraint here

### Why (c) over (a) as the end state:
- **One key instead of two** (Authenticode + Capawesome RSA → single ed25519)
- **One manifest instead of three** (yml + Capawesome JSON + SW → single JSON)
- **One gateway instead of static files** (Worker enforces staging/kill/rollback for ALL surfaces)
- **No vendor dependency** (Capawesome Cloud, electron-updater npm package)
- **Audit story** (one signed artifact = one log entry)
- **Compliance** (SOC2/ISO 27001: single control point)
- **Key rotation IS possible** (unlike Tauri v2)

### Why (a) over (c) for now:
- (c) requires 2-3 weeks of custom code before you have mobile OTA
- (a) gets you mobile OTA in 1-2 weeks with battle-tested code
- (a) is the **lowest-risk path to "all 5 surfaces update"**
- (c) is the **lowest-ops path for the long term**
- Do (a) to unblock product, then (c) to reduce ops

---

## 7. The Minimum Viable Manifest (for Phase 2)

Synthesized from the 11-engine reference (C1, C2) + security doc (Sections 1-4):

```json
{
  "$schema": "airiz.release/v1",
  "version": "2.4.1",
  "publishedAt": "2026-11-05T08:00:00Z",
  "channel": "stable",
  "signature": "ed25519:a3f5…base64…",
  "surfaces": {
    "electron": {
      "minVersion": "2.0.0",
      "artifacts": {
        "win-x64": {
          "url": "https://releases.airiz.dev/electron/2.4.1/airiz-setup-2.4.1.exe",
          "sha512": "base64…",
          "size": 84521968
        }
      },
      "installer": "nsis",
      "releaseNotes": "https://airiz.dev/changelog/2.4.1"
    },
    "capacitor": {
      "minVersion": "2.0.0",
      "bundle": {
        "url": "https://releases.airiz.dev/capacitor/2.4.1/bundle-v2847.zip",
        "sha256": "abc123…"
      },
      "rollbackToEmbedded": true
    },
    "pwa": {
      "minVersion": "2.0.0",
      "swUrl": "https://app.airiz.dev/sw.js",
      "precache": "https://releases.airiz.dev/pwa/2.4.1/precache-manifest.json",
      "swHash": "sha256-…"
    }
  },
  "rollout": {
    "percentage": 100,
    "deterministicKey": "installId",
    "allowList": ["user@airiz.dev"],
    "denyList": [],
    "killSwitch": false
  }
}
```

**Design decisions (justified):**

| Field | Why | Source |
|-------|-----|--------|
| `schema` | Versioned schema ID. Clients reject unknown schemas. | Expo Updates v1 pattern |
| `version` | SemVer. Client compares to current. | Universal (all 11 engines) |
| `publishedAt` | Audit + cache-busting. | electron-updater `releaseDate` |
| `channel` | stable/beta/canary/internal/pinned. | electron-updater `channel` + Capawesome channels |
| `signature` | ed25519 over canonicalized JSON. Client verifies with embedded pubkey. | Tauri + Sparkle + WinSparkle (all use EdDSA) |
| `surfaces.*` | Per-surface artifact info. Client only reads its own surface. | Custom (unified) |
| `surfaces.electron.artifacts` | Per-arch URL + SHA-512. | electron-updater `files[]` |
| `surfaces.electron.installer` | "nsis" / "appimage" / "dmg". Client picks installer strategy. | electron-updater platform detection |
| `surfaces.capacitor.bundle` | URL + SHA-256. | Capawesome `downloadUrl` + `checksum` |
| `surfaces.capacitor.rollbackToEmbedded` | If true, client falls back to embedded bundle on failure. | Capawesome `reset()` + Expo `rollBackToEmbedded` |
| `surfaces.pwa.swHash` | SHA-256 of SW bytes. Client verifies before activating. | SRI pattern (W3C SRI3) |
| `rollout.percentage` | 0-100. Worker hashes installId, compares. | electron-updater `stagingPercentage` |
| `rollout.deterministicKey` | Which client ID to hash. "installId" / "deviceId" / "email". | Custom |
| `rollout.allowList` | Force-update specific users (beta testers). | CodePush `allowList` |
| `rollout.denyList` | Block specific users (compromised devices). | Custom |
| `rollout.killSwitch` | If true, Worker serves 204 (no update). | Custom (simplest kill switch) |

**Revocation list (separate manifest, same signature):**
```json
{
  "$schema": "airiz.revoke/v1",
  "signature": "ed25519:…",
  "revokedVersions": ["2.3.9"],
  "reason": "CVE-2026-1234",
  "action": "forceDowngrade",
  "downgradeTo": "2.3.8"
}
```

---

## 8. Signing Primitive Decision

| Algorithm | Used by | Key size | Signature size | Speed | Post-quantum | Verdict |
|-----------|---------|----------|----------------|-------|--------------|---------|
| **ed25519** | Tauri, Sparkle 2.9, WinSparkle | 32 B | 64 B | Fastest | ✘ (but small) | **WINNER** |
| ECDSA P-256 | iOS, Android v2 | 32 B | 64-72 B | Fast | ✘ | Runner-up |
| RSA-PSS 2048 | Capawesome, Expo | 256 B | 256 B | Slow | ✘ | Legacy |
| RSA-PSS 4096 | Some enterprise | 512 B | 512 B | Very slow | ✘ | Overkill |
| ML-DSA (FIPS 204) | (none in shipping updaters yet) | ~1.3-2.5 KB | ~2.4-4.6 KB | Medium | ✔ | Future |
| SPHINCS+ | (none) | Large | Very large | Slow | ✔ | Not yet |

**Recommendation: ed25519** for the unified manifest.

Justification:
1. **3 of the 4 strongest desktop updaters use it** (Tauri, Sparkle, WinSparkle)
2. **32-byte key** = easy to store in HSM, 1Password, CI secret
3. **64-byte signature** = negligible bandwidth
4. **Fastest** (no modular exponentiation)
5. **Rotation IS possible** (unlike Tauri v2 which locks you in): re-sign manifest with new key, update embedded pubkey in next release
6. **Post-quantum:** ed25519 is not PQ-resistant, but for a 2026 motor console with a 5-year support window, this is acceptable. ML-DSA can be adopted in v2 of the schema when NIST finalizes PQ migration guidance.
7. **Do NOT use RSA-2048** (Capawesome's choice) — it's legacy, slow, and 256-byte signatures are wasteful for a manifest.

**Key custody:**
- Generate: `sodium-js` or `ring` (Rust) or `crypto` (Node.js, `ed25519` via `webcrypto`)
- Store private key: 1Password (encrypted) + CI secret (GitHub Actions)
- Store public key: embedded in each client binary (compile-time constant)
- Rotation: generate new keypair → re-sign manifest → ship new pubkey in next app release → old manifest signatures still valid until rotation completes

---

## 9. Rollout Primitives

| Primitive | Field | How it works | Which surfaces |
|-----------|-------|--------------|----------------|
| **Staged %** | `rollout.percentage` | Worker computes `hash(installId + version) % 100`. If < percentage, serve new manifest. Else serve older. | All (Worker-side) |
| **Deterministic key** | `rollout.deterministicKey` | Which ID to hash. "installId" (UUID.v5 per device), "deviceId" (Capacitor), "email" (authenticated). | All |
| **Allow list** | `rollout.allowList` | If client ID in list, always serve latest (regardless of %). For beta testers. | All |
| **Deny list** | `rollout.denyList` | If client ID in list, serve 204 (no update). For compromised devices. | All |
| **Min version** | `surfaces.*.minVersion` | If client version < minVersion, Worker can force update or serve 426. | All |
| **Kill switch** | `rollout.killSwitch` | If true, Worker serves 204 for ALL clients. One-field emergency stop. | All |
| **Regions** | (future) | Worker knows client geo from CF headers. Can gate by region. | All (future) |
| **Crash throttle** | (Worker logic) | If Sentry crash rate for version X > threshold, Worker auto-serves version X-1. No manifest change needed. | All |

**Staging algorithm (Worker):**
```javascript
// Pseudo-code for the Worker
function shouldUpdate(installId, version, manifest) {
  if (manifest.rollout.killSwitch) return false;
  if (manifest.rollout.denyList.includes(installId)) return false;
  if (manifest.rollout.allowList.includes(installId)) return true;
  const h = sha256(installId + version); // deterministic
  const bucket = parseInt(h.slice(0, 8), 16) % 100;
  return bucket < manifest.rollout.percentage;
}
```

**This is the same algorithm electron-updater uses** (UUID.v5 + `stagingPercentage`), but centralized in the Worker so ALL surfaces get it for free.

---

## 10. Failure Handling

| Failure | Detection | Response |
|---------|-----------|----------|
| **Manifest 404** | Client fetch fails | Client uses cached manifest (last known good). If no cache, skip update. Log telemetry. |
| **Signature invalid** | ed25519 verify fails | **Reject immediately.** Do not update. Log + alert. Treat as potential compromise. |
| **Checksum mismatch** | SHA-256/512 of downloaded artifact ≠ manifest | **Reject.** Do not install. Log + alert. Retry once with fresh download. |
| **New version boots but crashes** | Sentry crash rate > threshold (5 min window) | Worker auto-serves older manifest (crash throttle). Clients on next launch get older version. |
| **Revocation list updated** | Client fetches revocation manifest (same sig) | If current version in `revokedVersions`, force downgrade to `downgradeTo`. |
| **Staged rollout hits 50% + crash spike** | Sentry + Worker monitoring | Operator sets `rollout.percentage` back to 0 (or `killSwitch: true`). All new checks serve older. Already-updated clients stay on new (until next crash-triggered rollback). |
| **R2 outage** | Worker gets 503 from R2 | Worker serves cached manifest (CF cache). Clients use last known good. |
| **Worker deploy fails** | Wrangler deploy error | Previous Worker version stays live (CF atomic deploy). No impact. |

---

## 11. What We Would NOT Build (Scope Guard)

| Feature | Why not | Alternative |
|---------|---------|-------------|
| Delta updates (bsdiff/zsync) | Complex, 500+ lines, not needed for internal tool | Full download. 80MB × 50 users × 2×/month = 8GB/month. R2 egress = $0 (CF). |
| Multi-OS (macOS, Linux) | AIRIZ is Windows-only desktop | Add later if needed. Schema already supports it. |
| App Store / Play Store submission automation | Store compliance is separate from OTA | Use Fastlane (iOS) / Play CLI (Android) separately. |
| In-app update UI (progress bar, "Restart to update") | Platform-native | Electron: NSIS handles it. Capacitor: native dialog. PWA: SW auto. |
| A/B testing infrastructure | Overkill | `allowList` / `denyList` covers 95% of use cases. |
| Multiple product lines in one manifest | Scope creep | One manifest per product. Schema is the same. |

---

## 12. Citations (Key Sources)

All 72 citations are in `cross-platform-autoupdate-security-2026.md`. Key sources for this decision matrix:

1. **electron-updater 6.8.11** — npm registry, `out/*.d.ts` (jsDelivr), electron.build
2. **@capawesome/capacitor-live-update 8.7.1** — capawesome.io/plugins/live-update, npm registry
3. **Tauri 2.14.1 updater** — tauri.app/plugin/updater, npm @tauri-apps/plugin-updater
4. **Sparkle 2.9** — sparkle-project.org/documentation/publishing
5. **WinSparkle 0.9.4** — NuGet .nupkg README
6. **Expo Updates v1 protocol** — docs.expo.dev/eas-update, expo-updates v1 spec
7. **Workbox 7.4.1** — developer.chrome.com/docs/workbox, npm workbox-*
8. **W3C SRI3** — w3.org/TR/SRI3
9. **W3C Service Workers** — w3.org/TR/service-workers
10. **Cloudflare Workers** — developers.cloudflare.com/workers
11. **CodePush retirement** — learn.microsoft.com/en-us/appcenter/retirement (2025-03-31)
12. **Android APK Signing** — developer.android.com/studio/publish/app-signing
13. **iOS Code Signing** — developer.apple.com/documentation/xcode
14. **Windows Authenticode** — learn.microsoft.com/windows/security
15. **Azure Artifact Signing** — learn.microsoft.com/azure/azure-monitor/... (FIPS 140-3 L3)
16. **NIST FIPS 203 (ML-DSA)** — nist.gov (PQ signature standard)
17. **Source-level map** — `update-engines-source-map.md` (this project, 1601 lines)
18. **11-engine reference** — `update-engines-reference.md` (this project, 1023 lines)
19. **Security baseline** — `cross-platform-autoupdate-security-2026.md` (this project, 1641 lines)

---

## 13. Immediate Next Steps (if decision = recommended path)

### This sprint (Phase 1 — Option a):
1. [ ] Add `@capawesome/capacitor-live-update` to `apps/airiz-mobile/`
2. [ ] Generate RSA-2048 keypair. Store private in 1Password, public in `capacitor.config.ts`
3. [ ] Extend `sync_release_feed.py`: after Electron publish, also zip Capacitor web assets, compute SHA-256, sign, upload to R2
4. [ ] Add Workbox to PWA: `workbox-precaching`, `workbox-routing`, SW registration in `index.html`
5. [ ] Update `airiz-mobile.yml` workflow: build → zip → sign → upload R2
6. [ ] Update `airiz-update-feed.yml`: trigger all 3 surfaces on tag push
7. [ ] **Verify:** all 5 surfaces show "update available" in staging

### Next quarter (Phase 2 — Option c):
1. [ ] Design + freeze `airiz.release/v1` schema (this document, Section 7)
2. [ ] Generate ed25519 keypair. Store in 1Password + CI secret
3. [ ] Build Worker gateway (~300 lines): `GET /manifest`, staging hash, kill switch
4. [ ] Replace electron-updater with thin client (~200 lines): fetch → verify → download → NSIS
5. [ ] Replace Capawesome with thin client (~150 lines): fetch → verify → swap → reload
6. [ ] Migrate `sync_release_feed.py` → `airiz-release.py`: sign manifest, upload R2, deploy Worker
7. [ ] **Kill criterion:** if total custom code > 1000 lines, stop and stay on (a)
8. [ ] **Verify:** all 5 surfaces update via single manifest. Kill switch works. Staging works.

---

*End of decision matrix. Based on 7/8 survey deliverables (4,265 lines on disk). The 2 missing deliverables (min-viable manifest, unified models) are synthesized from the 11-engine reference's C1-C6 sections + recommendation block, which already answer those questions.*
