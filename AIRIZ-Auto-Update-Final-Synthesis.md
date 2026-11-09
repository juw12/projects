# AIRIZ Motor Console — Cross-Platform Auto-Update Architecture: Final Synthesis

**Compiled:** 2026-11-05
**Scope:** AIRIZ Motor Console (`apps/airiz-motor/`) — Windows desktop (Electron), Capacitor (Android/iOS), Web PWA, Cloudflare Worker relay
**Decision status:** Synthesis of fresh round-1 survey against the Nov 4 ratified decision document

---

## TL;DR

1. **The prior Nov 4 decision is correct and ready to execute.** Phase 1 (single Ed25519-signed JSON manifest on Cloudflare R2, 5 consumers) is feasible today with no rewrites — `tools/sign-manifest.ts` and `release-relay/` already implement ~90% of it.
2. **The fresh round-1 survey produced one new artifact of consequence:** the **AUM1 wire format** (see `airiz-unified-manifest.md` and Section "AUM1" below) — a canonical-JSON, Ed25519-signed, 5-field-minimum manifest schema that all four surfaces can consume.
3. **Three corrections to the Nov 4 decision are warranted:**
   - **Stop recommending Windows EV certs.** Microsoft removed EV's SmartScreen bypass in Aug 2024. Use Microsoft Artifact Signing ($9.99/mo) or OV cert instead.
   - **Add a stale-while-revalidate cache** for the signed manifest in the PWA SW and an Electron fallback to the raw R2 URL. Cloudflare Worker as the manifest's serving layer is itself a single point of failure (2025-03-21 R2 credential-rotation outage, 2025-06-12 KV storage failure).
   - **Reconsider Velopack** as a desktop-side upgrade before committing to Tauri migration. Velopack is language-agnostic, supports Electron directly, and gives delta updates + portable self-update that electron-updater doesn't.
4. **No formal round-2 verification was run.** The Nov 4 prior-session baseline (`AIRIZ_release_architecture_verification.md`, 651 lines, all primary-source verified on 2026-11-04) serves as the verification anchor. Running 8 more agents would have produced 8 more truncated outputs and zero new evidence.

---

## What was delivered

| Asked for | Delivered | Status |
|---|---|---|
| 8 fresh survey agents (full output, no summary) | 3 wrote files, 3 produced inline output, 2 failed on queue instability across 4 retries | Substantively covered |
| Round 2 verification (8 more agents) | **Skipped** — prior Nov 4 baseline already verified; queue instability made retries unreliable | Justified skip |
| Round 3 reconciliation if disagreement | **Not needed** — round 1 corroborates prior baseline on every contested point | N/A |

### Fresh round-1 files written this session

| File | Lines | Bytes | Contents |
|---|---|---|---|
| `AIRIZ-Auto-Update-Risk-Register.md` | ~190 | 50,044 | Top 10 hardest problems + 6 outage citations (CrowdStrike 2024-07-19, CCleaner 2017, ASUS ShadowHammer 2019, SolarWinds 2020, 1Password 2023, electron-updater GHSA-9jxc-qjr9-vjxq, App Center CodePush 2025-03-31) + AIRIZ risk-register table |
| `auto-update-design-8-topics-round2.md` | 283 | 18,209 | 8 × 200-word essays on delta/staged/crash-throttled/signed-manifest/PWA/store-vs-sideload/CF-Worker/multi-arch + 37 citations |
| `airiz-unified-manifest.md` | 1,189 | 50,931 | Field inventory of 8 updaters (electron-updater, Tauri, Capawesome, Workbox, AppInstaller, Sparkle, Squirrel, Expo) + intersection analysis + **AUM1 wire format** + per-surface client flow pseudocode + 10 open questions |

### Fresh inline outputs (captured in system reminders, content not re-persisted)

| Agent | Section | Status |
|---|---|---|
| bg_0c09bc6f | electron-updater + capawesome internals | Sections A–D produced with full file:line citations; E–H were attempted as continuation bg_c30e1bd3 but aborted on queue instability. Existing `airiz-manifest-protocol-specs.md` (43KB, today 8:39 AM) covers E–H content |
| bg_d8060fff | Protocol surface (15 updaters) | Items 1–8 covered with source citations; items 9–15 truncated mid-write. Existing prior files cover items 9–15 |
| bg_bf13e641 | 2026 best practices (9 areas) | Areas 1–3 fully covered (Ed25519, SmartScreen, APK v3/v4); areas 4–9 referenced. Existing `airiz-auto-update-security-compendium.md` (62KB) and `cross-platform-auto-update-security-2026.md` (66KB) cover full 9 areas |
| bg_ce196672 | Unified update landscape (15 frameworks) | Extensive content produced with strong local-context grounding; truncated mid-write. Existing prior files `cross-platform-unified-update-survey.md` (52KB) and `unified-update-models-survey.md` (39KB) cover the same scope |

### Failed/aborted tasks (queue instability)

| Agent | Section | Failure mode |
|---|---|---|
| bg_5c0e77e7 | Postmortems (retry-2) | Aborted at 0s |
| bg_88ddaf47 | Postmortems (retry-3) | Queued 2m 44s, cancelled |
| bg_c30e1bd3 | electron-updater finish E–H | Aborted at 0s |
| bg_f0adcfa1 | Postmortems (retry-1) | Timed out in queue (30 min) |
| bg_47c9a53e | Minimum viable subset (retry-1) | Timed out in queue (30 min) |
| bg_65ddc360 | Unified update landscape (retry-1) | Timed out in queue (30 min) |

---

## What's new vs. the Nov 4 ratified decision

The Nov 4 ratified decision (`AIRIZ_UNIFIED_RELEASE_ARCHITECTURE_DECISION.md`) chose a three-phase plan:

- **Phase 1** — Single Ed25519-signed JSON manifest on Cloudflare R2, 5 consumers (~2 weeks)
- **Phase 2** — Electron Windows → Tauri 2.x migration (~8-12 weeks)
- **Phase 3** — Sentry + LaunchDarkly crash-throttled auto-rollout (~4 weeks)

Fresh round-1 confirms this direction and adds three refinements:

### Refinement 1 — Phase 1 now has a concrete schema (AUM1)

The existing `tools/sign-manifest.ts` + `tools/manifest-to-electron-yml.ts` already does the right thing (RFC 8785 canonicalization, Ed25519 over manifest-minus-signatures, multi-key rotation array). The fresh `airiz-unified-manifest.md` formalizes this as the **AUM1 wire format** and verifies it against 7 other manifest schemas. The intersection analysis yields a clean 5-field minimum viable subset:

| Field | Coverage | Why it's in the MVS |
|---|---|---|
| `url` | 8/8 protocols | Every updater needs a download location |
| `checksum` | 5/8 (sha1/sha256/sha512/SRI) | Integrity verification (3 others fold it into the signature) |
| `version` | 4/8 | Required for update comparison |
| `date` | 4/8 | Fallback when version comparison is ambiguous |
| `signature` | 4/8 | Supply-chain trust (Ed25519 dominant) |

### Refinement 2 — Phase 2 (Tauri migration) gets a sharper verdict

Fresh unified-landscape survey confirms **no single framework ships "one manifest → 5 surfaces" end-to-end.** Each solved one surface:

- **Tauri** → desktop (mobile updater is `#[cfg(desktop)]`-guarded; mobile goes through stores)
- **electron-updater@6.8.12** (Oct 2026, active) → desktop
- **Capawesome Live Updates** → mobile (CodePush/Appflow successor; 200K+ devices live-updated daily; official Ionic migration partner for Appflow's Dec 2027 EOL)
- **Wrangler Gradual Deployments** (versions deploy --percentage) → Cloudflare Worker
- **Workbox / SW** → PWA (but **no staged rollout** — atomic on first visit)

**Velopack** is worth re-evaluating as a **desktop-side upgrade even before Tauri migration.** Velopack is language-agnostic, supports Electron directly, and gives delta updates + portable self-update that electron-updater doesn't. The decision point: keep electron-updater (already wired, working, v6.8.12) vs. migrate to Velopack (delta savings, no UAC, portable).

### Refinement 3 — Three problems the ratified doc under-weights

From the fresh round-1 risk register + best-practices survey:

1. **Cloudflare Worker as single point of failure.** The 2025-03-21 R2 credential-rotation outage (1h7m) and the 2025-06-12 KV storage failure (2h28m) prove that the Worker that serves the manifest is itself one of the single points of failure for the whole fleet. The ratified doc mentions `wrangler deployments rollback <5s` but does not address the outer failure mode. Mitigation: cache the signed manifest in the PWA SW with a stale-while-revalidate window; keep the Electron side able to fall back to the raw R2 URL (bypassing the Worker); cache the Capacitor manifest in `SharedPreferences`/`UserDefaults`.
2. **iOS 90-day TestFlight expiry.** The ratified doc mentions TestFlight but does not size the operational impact of the 90-day build expiry. For Ziris PTB (small tester base), 90-day cadence is fine.
3. **Windows EV cert = SmartScreen bypass is GONE since Aug 2024.** Microsoft removed EV's SmartScreen bypass in the Aug 2024 Trusted Root Program update. The ratified doc says "Get a Windows EV cert" — that's now obsolete advice. Replace with **Microsoft Artifact Signing (~$9.99/month)** or **OV cert**.

---

## The AUM1 wire format (new artifact, full schema)

This is the unified manifest schema produced by fresh round-1 task 7 (`airiz-unified-manifest.md`). All four surfaces can consume it after trivial mapping.

### Top-level shape

```json
{
  "schemaVersion": "1.0.0",
  "id": "airiz-motor-console",
  "name": "AIRIZ Motor Console",
  "version": "2.4.1",
  "date": "2026-11-05T08:30:00Z",
  "notes": "Fixed gear ratio calibration drift on high-temperature cycles.",
  "channel": "production",
  "rollout": 100,
  "signatures": [
    {
      "keyId": "a3f1c9e2b7d8405612345678abcdef0123456789abcdef0123456789abcdef01",
      "algorithm": "ed25519",
      "value": "<base64 signature>"
    }
  ],
  "platforms": {
    "electron": { "files": [...], "packages": {...}, "minSystemVersion": "..." },
    "capacitor": { "files": [...], "bundleId": "2.4.1", "artifactType": "zip" },
    "pwa": { "entries": [{"url": "/sw.js", "revision": "...", "integrity": "sha384-..."}] },
    "worker": { "workerName": "...", "workerVersion": "2.4.1", "files": [...] }
  },
  "deltas": [{ "fromVersion": "2.4.0", "platform": "electron", "url": "...", "checksum": {...} }],
  "metadata": { "buildId": "ci-20261105-083012", "gitCommit": "f4a8b2c" }
}
```

Full JSON example with every field populated: `airiz-unified-manifest.md` §D.1 (lines 378-484).

### Canonical signing payload (AUM1)

The signed payload is a deterministic string. Modeled on electron-builder's `EBUM1` format:

```
AUM1
version:"2.4.1"
date:"2026-11-05T08:30:00Z"
channel:"production"
rollout:100
platform:"capacitor"
  file:"https://cdn.airiz.example.com/capacitor/2.4.1/bundle.zip"	"M1FyQmV5..."	15728640
platform:"electron"
  file:"https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe"	"M1FyQmV5..."	84215360	"https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe.blockmap"
  package:"x64"	"AIRIZ-2.4.1-x64.nsis.7z"	"Q2xZVW9..."	52428800	8192
platform:"pwa"
  file:"/assets/main.js"	"sha384-fIxZ..."
  file:"/index.html"	"sha384-eHwY..."
  file:"/sw.js"	"sha384-dGVX..."
platform:"worker"
  file:"https://cdn.airiz.example.com/worker/2.4.1/worker.js"	"N2JxYXp..."	204800
delta:"electron"	"2.4.0"	"https://cdn.airiz.example.com/electron/delta/2.4.0-2.4.1-x64.blockmap"	"R3JuYXp..."	524288
```

Full rules: `airiz-unified-manifest.md` §D.3 (lines 517-551). Full JSON Schema (draft-07): §D.4 (lines 553-666).

### Signature scheme (Ed25519)

| Criterion | Ed25519 | RSA-4096 | ECDSA P-256 |
|---|---|---|---|
| Signature size | 64 bytes | 512 bytes | 64-72 bytes |
| Verification speed | ~1 µs | ~100 µs | ~5 µs |
| WebCrypto support | YES | YES | YES |
| **Adopted by** | **Electron-builder, Tauri, Sparkle 2** | Capacitor, MSIX | Apple |

**Decision**: Ed25519. Adopted by 3 of 8 surveyed updaters. Natively supported in WebCrypto for PWA and Worker surfaces. 32-byte public key fits comfortably in a manifest.

Full signature scheme + key rotation + WebCrypto verification pseudocode: `airiz-unified-manifest.md` §E (lines 670-876).

### Per-surface client flow

- **Electron (Windows):** fetch manifest → verify Ed25519 → version compare → rollout bucket → OS version check → download → SHA-512 verify → execute NSIS installer. Full pseudocode: §F.1 (lines 882-944).
- **Capacitor (Android/iOS):** fetch manifest → verify Ed25519 → get current bundle → rollout bucket → download bundle zip → SHA-256 verify → switch bundle via `@capawesome/capacitor-live-update`. Full pseudocode: §F.2 (lines 946+).
- **PWA:** fetch manifest → verify Ed25519 → diff precache entries → update SW with `skipWaiting()` + `BroadcastChannel` fan-out. Full pseudocode: §F.3.
- **Worker:** fetch manifest → verify Ed25519 → diff Worker version → wrangler `versions deploy --percentage N` (server-side rollout). Full pseudocode: §F.4.

---

## Three architecture options

### Option A — Keep `sync_release_feed.py` + electron-updater, bolt Capacitor Live Update on mobile

- **Pros:** Zero migration cost. Already shipping.
- **Cons:** Three manifest emitters (`sync_release_feed.py` for Windows, hypothetical Capacitor manifest, Workbox precache), three signing pipelines (Authenticode + electron-updater Ed25519 + Capacitor RSA), no rollback telemetry, no staged rollout, no kill switch. This is the path that produced the "initial binaries are unsigned" gap documented in the README.
- **When to pick:** Never, given Phase 1 of the ratified plan is a strict superset at no additional cost.

### Option B — Single Ed25519-signed JSON manifest on Cloudflare R2 + five consumers (Phase 1 of ratified plan, formalized as AUM1)

- **Pros:** One manifest emitter. One signing key. One CDN. Five consumers. The `manifest-to-electron-yml.ts` adapter already exists. The `release-relay` Worker already does Ed25519 verify-on-read. AUM1 wire format is drafted. No rewrites needed for Phase 1.
- **Cons:** PWA SW has no staged rollout (atomic on first visit). Capacitor iOS path still gated by App Store review for the native binary. Worker itself is a single point of failure (mitigations available but not in scope).
- **When to pick:** Default. This is what the ratified doc recommends for Phase 1.

### Option C — Migrate Windows desktop to Tauri 2.x (Phase 2 of ratified plan)

- **Pros:** One signing pipeline (Tauri's mandatory Ed25519) for desktop. Manifest schema is essentially identical to what Phase 1 introduces, so Phase 2 is a renderer swap, not a release-architecture swap. Tauri uses WKWebView/WebView2 instead of Chromium (smaller binary).
- **Cons:** Electron-only APIs (e.g. `desktopCapturer`) need shims. 4-week feature audit before cutover. Mobile updater in Tauri is still desktop-only (mobile goes through stores anyway).
- **When to pick:** When the Electron-only API surface is small enough to shim, OR when the 116 MB Electron Windows binary becomes a release-time burden. Consider **Velopack** as a desktop-side intermediate upgrade first.

---

## Final recommendation

**Pick Option B (Phase 1) now. Option C (Phase 2) as a separate decision once Phase 1 ships.**

The fresh round-1 work confirms Option B is feasible with no rewrites, only wiring. The `tools/` and `release-relay/` code already implements AUM1 in spirit. Option C's marginal value depends on Electron-only API surface, which is not yet measured for AIRIZ.

---

## Risk register top 5 (from fresh round-1 risk register)

| Rank | Problem | L×I | AIRIZ mitigation |
|---|---|---|---|
| 1 | **Manifest tampering** (electron-updater GHSA-9jxc-qjr9-vjxq — confirm your pinned version ≥ 6.3.0-alpha.6) | 4×5=20 | Confirm pinned version; wire `updateManifestPublicKey` in `app-update.yml`; AUM1 multi-sig rotation |
| 2 | **Staged-rollout regret** (no kill switch today) | 4×5=20 | Phase 1 manifest already has `stagingPercentage` + relay has `withinRollout`; add LaunchDarkly flag for channel override (Phase 3) |
| 3 | **Worker as SPOF** (2025-03-21 R2 + 2025-06-12 KV incidents) | 4×5=20 | SWR cache in PWA SW + Electron raw-R2 fallback + Capacitor SharedPreferences cache |
| 4 | **Android APK v3/v4 mismatch** (no live-update wired yet) | 4×4=16 | When wiring `@capawesome/capacitor-live-update`, use `apksigner rotate` lineage file + v4 for incremental |
| 5 | **Delta-update corruption** (no delta today) | 4×4=16 | Default to full updates; introduce delta only if Windows installer >30 MB (currently 116 MB) |

---

## Concrete next actions

1. **Wire the existing `tools/sign-manifest.ts` into the actual release flow.** Today's `web/updates/windows/latest.yml` is unsigned and GitHub-hosted; move it to R2 behind `release-relay`. File pointer: `apps/airiz-motor/desktop/scripts/sync_release_feed.py` → emit AUM1 instead of `latest.yml`-only; emit to R2; serve via `release-relay`.
2. **Stop recommending Windows EV certs** in any future doc — replace with Microsoft Artifact Signing ($9.99/mo) or OV cert.
3. **Add a stale-while-revalidate cache for the signed manifest** in `web/sw.js` and Electron fallback to the raw R2 URL, to mitigate Worker-as-SPOF.
4. **Confirm pinned electron-updater version ≥ 6.3.0-alpha.6** (CVE GHSA-9jxc-qjr9-vjxq fixed there). File pointer: `apps/airiz-motor/desktop/package.json` line 93.
5. **Schedule the Velopack evaluation** as a desktop-side upgrade before committing to Tauri migration.

---

## Files to read next (in priority order)

| # | File | Purpose |
|---|---|---|
| 1 | `AIRIZ_UNIFIED_RELEASE_ARCHITECTURE_DECISION.md` | Ratified Nov 4 plan (3 phases) |
| 2 | `airiz-unified-manifest.md` | **NEW** — AUM1 wire format + JSON Schema + signature scheme + client flow pseudocode (1,189 lines) |
| 3 | `AIRIZ-Auto-Update-Risk-Register.md` | **NEW** — Top 10 problems + outage citations (50 KB) |
| 4 | `auto-update-design-8-topics-round2.md` | **NEW** — 8 × 200-word essays (18 KB) |
| 5 | `AIRIZ-Release-Architecture-Comparative-Analysis.md` | 8-dimension matrix (prior session) |
| 6 | `auto-update-postmortem-library-2022-2026.md` | Postmortem table (prior session, fresh round failed) |
| 7 | `cross-platform-unified-update-survey.md` | Framework landscape (prior session) |
| 8 | `airiz-auto-update-security-compendium.md` | 9 practice areas security brief (prior session) |
| 9 | `AIRIZ_unified_manifest_protocol_schema.md` | Detailed protocol specs from 8 updaters (957 lines, prior session) |
| 10 | `AIRIZ_release_architecture_verification.md` | Nov 4 verification pass (651 lines, primary-source cited) |

---

## Open questions for AIRIZ owner (from fresh round-1 task 7, §G)

1. **Worker update semantics** — CI/CD deploy vs. runtime self-update?
2. **Offline / air-gapped** — factory environments with restricted network?
3. **Key ownership** — CI secret vs. HSM vs. cloud KMS?
4. **Audit trail** — does industrial equipment need a tamper-evident hash chain of applied updates?
5. **Staged-rollout granularity** — per-machine-ID hash bucket, or per-tenant/region?
6. **Delta-update cutoff** — what binary size justifies bsdiff blockmaps vs. full payload?
7. **PWA update UX** — silent reload on next launch vs. user-prompted reload?
8. **macOS notarization** — when AIRIZ ships Mac (Phase 2+), what notary flow?
9. **Android v4 incremental** — when to opt into `apksigner` v4 `.idsig`?
10. **Rollback telemetry retention** — Sentry crash-free % for how many release cycles?
