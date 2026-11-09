# AIRIZ Motor Console — Unified Release Architecture Recommendation

**Date:** 2026-11-05 | **Owner:** Juwen Lie, Ziris PTB | **Decision:** Recommended

---

## Executive Summary

**Recommended architecture: Unified signed-manifest layer (Option C).** One canonical ed25519-signed JSON manifest as source of truth in CI. Per-surface adapters translate canonical → vendor format at release time. Single signing key (KMS-backed or GitHub OIDC → Sigstore/cosign). One staged-rollout control plane (server-side gating on canonical endpoint). One telemetry signal (Sentry crash-free sessions, auto-pause ≥ 99.5% CFS sustained 30 min, min-sample armed).

**Why this beats the alternatives:**
- Option A (keep current split + bolt on Capawesome) leaves 5 manifest formats, 5 signing schemes, 5 places to break — unsustainable for one-person team
- Option B (migrate to Tauri) only covers desktop; mobile stays the same problem (Tauri 2.x updater is desktop-first, mobile is app-store-gated)
- Option C gives ONE signing key, ONE manifest schema, ONE rollback command

**Critical constraints:**
1. **iOS is the load-bearing constraint.** App Store is the only sanctioned update path for native binaries. "Unified native updater" cannot exist across iOS + Android + Windows in the strict sense. Workaround: the PWA path IS the unified path for AIRIZ's web console, plus app-store-only for native.
2. **Signing key custody matters more than signing algorithm.** Ed25519 is the right choice (32-byte keys, deterministic, no padding oracle, constant-time verify) — but a static PEM in a CI secret is wrong. KMS-backed or Sigstore (Fulcio + Rekor) for real security.
3. **Atomic install is non-negotiable.** NSIS delete-then-write (electron-builder #6869), SIGTERM during extraction (Sparkle #2478), interrupted updates (electron-builder #10359), CrowStrike 100% push (no canary) — all produce bricked users. Each surface must have its own atomic-install guarantee.

---

## The 5 Surfaces — Current State and Updates

| # | Surface | Current | Recommended Update |
|---|---------|---------|-------------------|
| 1 | Electron Windows desktop | `electron-updater` v6.8.11 + custom `sync_release_feed.py` | Keep electron-updater; replace `sync_release_feed.py` with adapter that emits `latest.yml` from canonical |
| 2 | Capacitor Android mobile | Play Store only | Add `@capawesome/capacitor-live-update` (v8.7.1) reading canonical via custom endpoint |
| 3 | Capacitor iOS mobile | App Store only (unsigned IPA + Xcode project) | App Store remains the update path; no native OTA feasible |
| 4 | Static web PWA + Web Serial API | Service worker | Keep SW; bake SRI hashes from canonical into `index.html` |
| 5 | Cloudflare Workers + Durable Objects relay | `wrangler versions` + gradual deploys | Keep; add adapter that emits Worker manifest from canonical |

---

## Canonical Manifest Schema (v1)

Served at `https://releases.airiz/v1/{channel}/manifest.json`, ed25519-signed JSON:

```json
{
  "schema_version": 1,
  "release_id": "airiz-motor@1.2.3+2026.11.05",
  "channel": "stable",
  "staging_percentage": 10,
  "published_at": "2026-11-05T12:00:00Z",
  "release_notes": "...",
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

---

## Adapters (Phase 1 = 6 weeks)

| Phase | Adapter | Reads canonical, emits... | Vendor trust model |
|-------|---------|---------------------------|-------------------|
| 1 (wk 1-2) | `emit-windows.ts` | `latest.yml` (electron-updater v27+ with `updateManifestPublicKey`) + `app-update.yml` | electron-updater authenticates installer (Authenticode) + verifies manifest signature |
| 2 (wk 3-4) | `emit-capacitor.ts` | Custom Capawesome-compatible endpoint OR custom Capacitor plugin | Capawesome RSA-2048 PKCS1v15 SHA256 OR ed25519 via custom plugin |
| 3 (wk 5) | `emit-pwa.ts` | `sw.js` + asset files with SRI hashes baked into `index.html` | Browser HTTPS + SRI |
| 4 (wk 6) | `emit-worker.ts` | wrangler manifest + calls `wrangler versions deploy` with gradual split | Cloudflare dashboard + wrangler signature |
| 5 (wk 7) | Unified GitHub workflow `airiz-release.yml` triggered by tag | All 4 adapters in one pipeline | CI secret + OIDC federation |
| 6 (wk 8) | Staged-rollout gate | Sentry crash-free sessions ≥ 99.5% sustained 30 min, min-sample armed | Auto-pause (not auto-rollback) |

---

## Signing Key Custody

- **Private key**: GitHub Actions OIDC → KMS (AWS KMS / GCP KMS / Azure Managed HSM) or Sigstore (Fulcio + Rekor transparency log). Never on disk. Never in a long-lived secret.
- **Public key**: Embedded in each surface's binary:
  - Electron: `app-update.yml` → `updateManifestPublicKey`
  - Capawesome: Capacitor config → `releaseProtocol.publicKey` (if using ed25519) or kept as RSA with dual-sig
  - PWA: Embedded in `sw.js` → checked before applying update
  - Worker: Embedded in worker code → checked before applying staged rollouts
- **Rotation**: Ship a signed update with new pubkey embedded, signed by old key. The signed update embeds the new pubkey (Tauri/Sparkle pattern).
- **Revocation**: Signed "stop" flag in next manifest (blocklist of revoked manifest hashes). The manifest channel must itself be reachable + signed.

---

## Atomic Install Per Surface

| Surface | Strategy | Avoids |
|---------|----------|--------|
| Windows (NSIS) | 2-directory swap (avoid delete-then-write) | electron-builder #6869 — NSIS partial install leaves app uninstalled |
| Android (Capacitor) | current + next bundle, `readyTimeout` rollback | Capawesome readyTimeout pattern |
| iOS | App Store only — no native OTA feasible | Apple policy |
| PWA | SW `install` → populate new cache → `skipWaiting()` → `clients.claim()` (via message channel) | MDN SW update traps |
| Worker | `wrangler rollback <version-id>` (stateless only); DO schema changes must be forward-compatible + reversible for one cycle | Cloudflare 2022 config push incident |

---

## Critical Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Delta vs full | Full payload + hash-verified manifest | JS bundle too small to justify delta; clean rollback |
| Staging | 1→10→50→100 with per-ring metric gates | CrowdStrike 2024-07-19 was 100% push — anti-pattern |
| Telemetry gating | Auto-pause (not auto-rollback) at < 99.5% CFS sustained 30 min, min-sample armed | Pause reversible; rollback is human decision |
| Signing | Sigstore/cosign or KMS-backed Ed25519; rotate by `kid`; pin public key not cert | 1Password 2023 shows cert-pinning is fragile |
| PWA update | Versioned cache + message-channel skipWaiting, fan-out reload prompt, lockstep | Never auto-swap mid-session |
| Store vs sideload | Store default; sideload = MDM-controlled fleets only | iOS sideload is 7-day treadmill; don't design around it |
| Worker deploy | Route-level canary; instant-rollback only for stateless; schema changes forward-compatible + reversible one cycle | DO/D1 rollback is a new deploy, not a button |
| Multi-arch | N/A for web console; if native, universal on Apple, AAB on Android, per-arch Electron | Mirror platform norm |

---

## Defer Decisions

| Decision | Defer until | Why |
|----------|-------------|-----|
| Migrate to Tauri | Only if desktop binary size / memory / signing chain becomes a problem | Tauri doesn't simplify mobile/PWA/Worker |
| Delta updates | Phase 8+ | Start with full updates; add blockmap differential when bandwidth matters |
| Multi-region CDN | When staging rollout > 50% across regions | Start single region, add when needed |
| HSM-backed signing | When signing authority becomes a target | GitHub OIDC + KMS is sufficient for one-person team |

---

## Top 5 Real-World Incidents That Inform This Design

| Date | Vendor | Lesson |
|------|--------|--------|
| 2024-07-19 | CrowdStrike (8.5M Windows BSOD) | 100% push with no canary + malformed content channel = catastrophic. Always stage. |
| 2017-09 | CCleaner / Avast (2.27M) | Update channel compromised → trojanized binary distributed. Defense: build-pipeline integrity + signed manifests. |
| 2019 | ASUS Live Update (ShadowHammer) | Auto-update mechanism itself was the RCE vector. Defense: signed + verified update payloads, not just signed binaries. |
| 2020-12 | SolarWinds Orion (~18k orgs) | Build pipeline compromise + valid signing cert = trusted trojan. Defense: signed manifest independent of platform signing chain. |
| 2025-03-31 | Microsoft CodePush / App Center | "Unified" update services can die. Defense: own the protocol, don't depend on a hosted service that can sunset. |

---

## Implementation Phases

**Phase 1 (weeks 1-2): Windows adapter.** Replace `sync_release_feed.py` with `release-protocol emit windows`. Validate `latest.yml` matches v27+ format with `updateManifestPublicKey`. Wire to existing `airiz-desktop.yml`.

**Phase 2 (weeks 3-4): Capacitor adapter.** Deploy a custom endpoint that returns canonical in Capawesome's expected shape. OR wrap Capawesome to use ed25519 instead of RSA (requires fork or custom plugin).

**Phase 3 (week 5): PWA adapter.** Auto-bake SRI hashes from canonical into `index.html`. Wire to GitHub Pages deploy.

**Phase 4 (week 6): Worker adapter.** Call `wrangler versions deploy` from CI with staged-rollout split. Tag with `release_id`.

**Phase 5 (week 7): Unified workflow.** Replace 5 separate workflows with one `airiz-release.yml` triggered by tag.

**Phase 6 (week 8): Staged-rollout gate.** Wire Sentry crash-free sessions API to the canonical endpoint. Auto-pause when CFS < 99.5% sustained 30 min.

---

## Open Questions for Validation

1. Does AIRIZ's installed electron-updater version match v6.8.11 (no ed25519 manifest signing) or v27+ (with `updateManifestPublicKey`)? Verify by reading `package.json` in `apps/airiz-motor/desktop/`.
2. Is the existing `sync_release_feed.py` generating `latest.yml` correctly per electron-updater expectations?
3. What's the current Sentry SDK version? Crash-free sessions API requires Sentry SDK ≥ 7.0 with `Session` integration enabled.
4. What's the current Cloudflare account plan? Gradual deployments require Workers paid plan ($5/month minimum).
5. Does Capawesome's existing plugin need a fork to support ed25519, or can it work alongside RSA via dual-signing?
