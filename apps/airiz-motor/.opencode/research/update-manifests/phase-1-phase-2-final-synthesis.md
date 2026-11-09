# AIRIZ Motor Console — Cross-Platform Auto-Update Survey (Phase 1 + Phase 2)

**Date:** 2026-11-05
**Owner:** Juwen Lie (one-person team, Team Ziris PTB)
**Project:** `apps/airiz-motor/` inside `juw12/projects` monorepo
**Goal:** Map every auto-update engine that has shipped for cross-platform desktop + mobile + web, and pick a unified release architecture for AIRIZ Motor Console.

---

## 0. Survey scope and method

Eight background agents were fired in parallel for Phase 1; the same eight were re-launched for Phase 2 verification (each Phase 2 agent reads the Phase 1 file for its task and re-verifies against canonical sources via `gh` CLI + `webfetch`).

**Phase 1 tasks:**
1. `electron-updater` (electron-userland/electron-builder) + `@capawesome/capacitor-live-update` source internals
2. Protocol surface for Squirrel.Windows, Sparkle, electron-updater, Tauri updater, Capacitor Live Update, Expo Updates, CodePush, PWA service worker, Microsoft.AutoUpdater / AppInstaller
3. Top 10 hardest problems + canonical outage citations (CrowdStrike, SolarWinds, CCleaner, ASUS ShadowHammer, CodePush sunset)
4. 2026 best-practices for cross-platform auto-update security (10 topics: ed25519, Windows EV+SmartScreen, Android v3/v4, iOS signing, PWA SRI+SW traps, Cloudflare Workers, staged rollouts, crash-throttled rollback, delta updates, PWA lifecycle)
5. Public postmortems since 2022 across electron-updater, electron-builder, Squirrel, Sparkle, Capacitor Live Update, CodePush, Expo Updates, Workbox, Tauri updater, MS AutoUpdater — plus canonical supply-chain incidents
6. 8 deep topics (200 words each) on delta vs full, staged rollouts, crash-throttled rollback, signed manifests, PWA SW traps, store vs sideload, signed Cloudflare Worker deploys, multi-arch binaries
7. Minimum viable subset for a unified signed-manifest layer (7 tools: electron-builder NSIS, Tauri, Capacitor Live Update, Squirrel.Windows, Sparkle, PWA SW, Microsoft AppInstaller)
8. Unified auto-update models survey (12 frameworks: Tauri, Flutter, .NET MAUI, Uno Platform, Kotlin Multiplatform, React Native, Capawesome/Capgo, Voltbuilder, Appcircle, Codemagic, Bitrise/fastlane, NativeScript/Cordova/Ionic)

---

## 1. Phase 1 — what was delivered

### 1.1 Delivered to chat above (this session transcript)

- **Task 6 (8 deep topics × 200 words)** — top of this conversation; full text with citations.
- **Task 4 (2026 best practices, 10 topics)** — RFC 8032 §1/§5.1/§8.4 (Ed25519 key generation / sign / verify / malleability), `source.android.com/docs/security/features/apksigning` (v1/v2/v3 schemes, Android 7.0 / 9.0 release notes), Apple `developer.apple.com/help/account/manage-certificates` + `developer.apple.com/documentation/appstoreconnectapi` (Distribution cert vs Development cert, TestFlight 10,000 external cap, ES256 `.p8` API key), W3C SRI-2 §3.5/§3.7/§3.8 (hash algorithm set, Integrity-Policy header), MDN `skipWaiting()` + `clients.claim()` + `update()`, `developer.chrome.com/docs/workbox/modules/workbox-window` (Workbox version-pinned CDN `workbox-cdn/releases/6.4.1/workbox-window.prod.mjs`), `developers.cloudflare.com/workers/configuration/versions-and-deployments/` (ver Sep 2026, versions-and-deployments model, `wrangler rollback` documented at sub-page), RFC 3161 + CA/B Forum Baseline Requirements for Code-Signing (FIPS 140-2 Level 2 hardware mandate since 2023-06), `apksigner` (v3 lineage), Azure Trusted Signing endpoint, `learn.microsoft.com/en-us/azure/trusted-signing/`.
- **Task 1 (electron-updater source internals, A.1–A.13)** — at commit `cdd9f7ec77007cdc9657b9f9faa0be2000564d59` of `electron-userland/electron-builder` under `packages/electron-updater/src/`. Repo state: standalone `electron-userland/electron-updater` is **archived 2017-10-06** (description: *"Deprecated. Part of electron-builder now."*). Active canonical source is the `electron-builder` monorepo on `master` branch. File map (28 files), `AppUpdater.ts` events + `quitAndInstall` + `allowDowngrade`/`allowPrerelease`/`channel` + `verifyUpdateFile` + `isUserWithinRollout` (UUID v5 staging) + `updateManifestPublicKey` (Ed25519) + `maxUpdateInfoSize` (10 MiB default) + cache path (`<userDataPath>/.updaterId` for staging UUID, `<baseCachePath>/<name>/pending/` for update staging), `BaseUpdater.ts` install state machine (`idle` → `installing` → `handedOff`), `installPendingUpdateOnLaunch`, OS session-end detection (issue #7807), `NsisUpdater.ts` (Authenticode verification via `windowsExecutableCodeSignatureVerifier.ts` PowerShell `Get-AuthenticodeSignature`, NSIS args `--updated`/`/S`/`--force-run`/`--package-file`/`/D=`, `elevate.exe` for per-machine installs), `MacUpdater.ts` (delegates to `electron.autoUpdater` via a localhost HTTP proxy with random 64-byte Basic Auth and a 64-byte-hex random URL path), `AppImageUpdater.ts` (atomic `linkSync` → `renameSync` pattern, `chmod 0o755` deferred to `afterVerification` callback), `providerFactory.ts` + providers (`BitbucketProvider`, `GenericProvider`, `GitHubProvider` with Atom feed, `GitLabProvider`, `KeygenProvider`, `PrivateGitHubProvider`), `differentialDownloader/` (blockmap v2 gzipped JSON, blockmap v3 binary Range-request-fetchable, `downloadPlanBuilder.ts` COPY/DOWNLOAD operation coalescing), `windowsExecutableCodeSignatureVerifier.ts` (PowerShell `Get-AuthenticodeSignature`, 60-second timeout, fail-closed on unverified, `CATALOG_SIGNATURE_TYPE = 2` policy), `DownloadedUpdateHelper.ts` (pending-dir cache, `update-info.json` persistence with `installOnNextLaunch` marker, sha512 re-validation on cached reuse).

### 1.2 On disk

- `apps/airiz-motor/.opencode/research/update-manifests/1759950392-update-manifests-research.md` (1042 lines, 65 KB) — Task 7 manifest format research, 7 tools, draft unified JSON schema, "minimum viable subset" derivation (6 fields, ~9 lines of JSON: `{version, files, signatures, pub_date, notes, channel}` signed with ed25519).
- `apps/airiz-motor/.opencode/research/update-manifests/protocol-surface-summary.md` (26.6 KB) — Tasks 2+3 protocol surface for 9 updaters + cross-tool comparison table + common-subset diff (ed25519 manifest signature Tauri model = cleanest core; channel+rollout Expo = must-add; platform-policy flag Tauri desktop-only = must-add; PWA SW lifecycle / MSIX block-diff / Sparkle signed-feed out of scope).
- `apps/airiz-motor/.opencode/research/update-manifests/unified-models-summary.md` — Task 8 survey of 12 frameworks + comparison table.
- `apps/airiz-motor/.opencode/research/update-manifests/verification-*.md` (8 files) — Phase 2 verification reports (see §2).

### 1.3 Covered by existing AIRIZ research

Task 5 (postmortems) is covered by the project's existing deep research files (the Phase 1 task 5 agent found them and confirmed sufficiency):
- `apps/airiz-motor/docs/auto-update-postmortem-library-2022-2026.md` (1466 lines)
- `apps/airiz-motor/release-failure-modes.md` (687 lines)
- `apps/airiz-motor/docs/airiz-update-channel-risk-register.md`

---

## 2. Phase 2 — verification verdicts

### 2.1 Summary table

| # | Phase 1 task | Verdict report | Phase 2 verdict | Load-bearing disagreement? |
|---|---|---|---|---|
| 1 | Unified auto-update models survey | `verification-unified-models.md` | **1 CONTRADICTED, 1 MINOR DRIFT, 8 CONSISTENT** | **YES — Codemagic Patch** (corrected in Phase 1 §11) |
| 2 | Electron-updater source-map at `cdd9f7ec…` | `verification-electron-updater.md` | **CONSISTENT** (5/5 sub-claims VERIFIED, SHA identical to current HEAD) | No |
| 3 | Protocol surface (Tauri/Sparkle/Capgo/PWA/MSIX/CodePush) | `verification-protocol-surface.md` | **5 CONSISTENT, 1 MINOR DRIFT** | No |
| 4 | Best-practices citation spot-check (7 topics) | `verification-best-practices.md` | **4 CONSISTENT, 3 MINOR DRIFT** (page-scope gaps) | No |
| 5 | Top-10 problems + postmortem library | `verification-top-10-problems-and-postmortems.md` | **5/5 CONSISTENT** on canonical citations | No (one adjacent prose drift flagged) |
| 6 | 8 deep topics | `verification-deep-topics.md` | **8/8 VERIFIED** (3 minor drifts, no CONTRADICTED) | No |
| 7 | Manifest format research | `verification-manifest-research.md` | **NOT LANDED** (Phase 1 source file `1759950392-update-manifests-research.md` was missing from disk when the agent tried to read it) | Cannot certify until Phase 1 source is present |

### 2.2 The one CONTRADICTED verdict (and its correction)

**Codemagic Patch — Phase 1 §11 of `unified-models-summary.md`**

- **Phase 1 claim:** *"`patch.codemagic.io` is a Flutter-first patch delivery service (similar surface to Shorebird/Capgo). … Dart patches."*
- **Canonical finding:** `https://patch.codemagic.io` H1: *"Self-hosted OTA updates for React Native."* Product is a **self-hosted React Native OTA service** shipping **JavaScript bundles** (with binary diff, RBAC, native binary fingerprinting). Dart is not mentioned on the page. Codemagic's Flutter story lives in `codemagic.io`, not `patch.codemagic.io`.
- **Action taken:** Applied the correction to `unified-models-summary.md`:
  - Line 150: "Partial Yes — `patch.codemagic.io` for Flutter RN/Expo-style bundles." → "Partial Yes — `patch.codemagic.io` for React Native (JS bundles)."
  - Line 152: rewrote the paragraph to reflect the canonical framing, with explicit note *"corrected from earlier draft after Phase 2 verification"*.
  - Comparison-table row for Codemagic: "Dart patches / Flutter-first" → "JS bundle (RN, self-hostable)".

### 2.3 MINOR DRIFT observations (non-blocking)

| Source | Drift | Note |
|---|---|---|
| Unified models §1 (Tauri) | Mobile caveat overstated | The installable plugin is gated with `#[cfg(desktop)]`; the mobile code path does not exist in the installable package today. Apple/Google policy is the secondary, not primary, blocker. Desktop verdict still correct; caveat tone should be lowered in a follow-up pass. |
| Protocol surface | Capgo schema + §2.5.2 verbatim | Phase 1's schema (`{id, version, channel, bundle: {url, checksum (sha256), signature?}, …}`) and the verbatim §2.5.2 quote are sourced from the `capacitor-updater` plugin docs and Apple's developer guidelines, not from `capgo.app/` itself (which is marketing). Phase 1's own provenance note already lists `developer.apple.com` as the §2.5.2 source, which is correct. |
| Best practices | Page-scope gaps | Android `/apksigning/v3` and `/apksigning/v4` live on sub-pages; Cloudflare `wrangler rollback` lives at `/workers/versions-and-deployments/rollbacks/`; Sentry `setRelease()` lives at `/product/releases/setup/`. All three overview pages link to the right sub-page. |
| Top-10 + postmortem | Adjacent prose drift in §B.1.2 | Phase 1 postmortem library §B.1.2 says *"Cisco Talos notified Avast on 13 September 2017"*. Avast blog actually credits **Morphisec** (Sept 12, 8:35 AM PT) with the first notification; Cisco Talos notified Avast on **Sept 14, 7:25 AM PT**. User-flagged claims (19 Sep 2017, ~2.27M, fix in 5.33.6163 / 5.34) all match; this is an internal prose discrepancy only. One-sentence edit in a future pass. |

### 2.4 CONSISTENT verdicts

| Source | What was verified |
|---|---|
| Electron-updater | Ed25519 manifest signing (`AppUpdater.ts:357,833`), `AutoInstallEvent` string-literal union `"manual" \| "onQuit" \| "onNextLaunch"` (`types.ts:32`), `allowDowngrade = true` in channel setter (`AppUpdater.ts:327`), `quitAndInstall` abstract (`AppUpdater.ts:1040`) + NSIS args (`NsisUpdater.ts:334,336,340`) + macOS Squirrel.Mac delegation (`MacUpdater.ts:20,146,250,278`), cache path = `this.app.baseCachePath` (`AppUpdater.ts:1200`, `BaseUpdater.ts:248`). Phase 1 SHA `cdd9f7ec77007cdc9657b9f9faa0be2000564d59` is **identical** to current `master` HEAD. |
| Protocol surface | Tauri 2.x (desktop-only constraint + signed JSON manifest + "Tauri's updater needs a signature... This cannot be disabled" verbatim quote confirmed on `v2.tauri.app/plugin/updater/`); Sparkle 2.x (EdDSA / ed25519 `appcast.xml` `<sparkle:edSignature>` element confirmed); PWA `skipWaiting()` ("forces the waiting service worker to become the active service worker" verbatim on MDN); MSIX `UpdateSettings` (all six elements — `OnLaunch` 1709, `HoursBetweenUpdateChecks` 1803, `AutomaticBackgroundTask` 1803, `UpdateBlocksActivation` 1903, `ShowPrompt` 1903, `ForceUpdateFromAnyVersion` 1903 — verbatim on `learn.microsoft.com/.../app-installer/update-settings`); CodePush / App Center ("retirement on March 31, 2025" verbatim on `learn.microsoft.com/en-us/appcenter/retirement`). |
| Best practices | RFC 8032 (32-byte pubkey, 64-byte sig, ~128-bit security, SHA-512 internal hash all verbatim); W3C SRI-2 (hash algorithm set `«"sha256","sha384","sha512"»` verbatim, MD5/SHA-1 not allowed, Integrity-Policy header new in SRI-2); MDN `skipWaiting()`; Tauri updater signature-mandatory quote. |
| Top-10 + postmortems | CrowdStrike 2024-07-19 (19 Jul 04:09 UTC, 8.5M Windows, Channel File 291, revert 05:27 UTC verbatim on Wikipedia); SolarWinds SUNBURST 2020 (13 Dec 2020 disclosure, 18,000 of 33,000 Orion customers, APT29 attribution verbatim on Wikipedia); CCleaner 2017 (19 Sep 2017, ~2.27M, fix in 5.33.6163 / 5.34 verbatim on `blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident`); ASUS ShadowHammer 2019 (25 Mar 2019, >57K Kaspersky users, signed with legitimate ASUS cert verbatim on `securelist.com/operation-shadowhammer/89992/`); CodePush / App Center (sunset 31 Mar 2025 verbatim). |
| 8 deep topics | Electron Squirrel.Windows full+delta (verbatim on `electronjs.org/docs/latest/tutorial/updates`); Tauri full-only (no delta artifact generation in current Tauri updater); Play Console staged rollout (verbatim on `support.google.com/.../answer/6346149`); Sentry release dimension (crash-free users + crash-free sessions + `release:` SDK init field on `docs.sentry.io/product/releases/`); TUF CNCF Graduated (verbatim on `theupdateframework.io/`); Workbox `messageSkipWaiting()` + `{type: 'SKIP_WAITING'}` message constant (verbatim on `developer.chrome.com/docs/workbox/modules/workbox-window`); Android App Bundle mandate since Aug 2021 (verbatim on `developer.android.com/guide/app-bundle`); Apple Universal macOS binary (verbatim on `developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary` via markdown alternate); Cloudflare Workers 100-version immutable history + rollbacks page (verbatim on `developers.cloudflare.com/workers/configuration/versions-and-deployments/`). |

### 2.5 Not landed

- `verification-manifest-research.md` — Phase 1 source file `1759950392-update-manifests-research.md` was missing from disk when the agent tried to read it. Per AGENTS.md Rule 12 ("Fail loud") and the subagent file-state verification rule, the agent stopped rather than fabricate Phase 1 claims to verify against. **Phase 1 file exists** at the path above; this is a timing issue with the Phase 2 agent. Downstream action: re-run the verification agent (the Phase 1 source file is now confirmed present).

---

## 3. Phase 3 — not required

The Codemagic Patch CONTRADICTED verdict is clear-cut:
- Canonical source (`patch.codemagic.io` H1: *"Self-hosted OTA updates for React Native"*) is unambiguous.
- Phase 1 had incorrectly classified it as Flutter-first / Dart patches.
- The fix is to correct Phase 1 (already done), not to re-investigate the claim.

No Phase 3 tie-breaking pass is needed. The remaining MINOR DRIFT observations are page-scope and adjacent prose issues, not load-bearing factual disagreements.

---

## 4. Architectural recommendation

**Choose Option C: a custom signed-manifest-on-R2 + Cloudflare Worker layer that every AIRIZ surface consumes.**

### 4.1 Why not Option A (keep current hybrid)

Five update paths, three signing identities:

| Surface | Update engine | Signing identity |
|---|---|---|
| Windows Electron desktop | `electron-updater` (NSIS) | Authenticode / Azure Trusted Signing EV cert |
| Android Capacitor | Capgo/Capawesome | Android Play App Signing upload key (rotatable v3) |
| iOS Capacitor | Capgo/Capawesome (web-bundle only) | Apple Distribution cert (App Store Connect API key `.p8` ES256) |
| PWA | Service Worker (cache-first, NetworkFirst for navigations) | Subresource Integrity (SRI-2 sha384/sha512) |
| Cloudflare Worker | `wrangler deploy` | Worker Secrets |

Three signing identities = three rotation windows = three compromise scenarios. Five manifests = five divergent schemas = five extension points.

### 4.2 Why not Option B (migrate to Tauri)

`tauri-plugin-updater` is **explicitly desktop-only** — confirmed via `v2.tauri.app/plugin/updater/` page-scope and the `#[cfg(desktop)]` lib.rs guard + the install command `cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`. Tauri 2.x GA on iOS/Android (Tauri Mobile) but the updater never followed. Migration cost: rewrite Electron desktop to Tauri (substantial), but you **still need Capacitor (or native Swift/Kotlin) for mobile**, which means you end up with 2 updaters, not 1.

### 4.3 Why Option C wins

1. **One signing pipeline** — Cloudflare Worker signs the manifest with Ed25519 key stored in Cloudflare Workers Secrets (or Workers Secrets API); every surface fetches through the Worker.
2. **One manifest schema** — already documented in `apps/airiz-motor/unified-release-manifest-schema.md` (the project's own baseline); reduces to:
   ```json
   {
     "version": "1.11.25",
     "files": [{ "url": "...", "sha512": "...", "size": 12345678, "platform": "windows-x64" }],
     "signatures": [{ "key_id": "airiz-prod-2026", "alg": "ed25519", "value": "<base64>" }],
     "channels": { "stable": { "version": "1.11.25" }, "beta": { "version": "1.12.0-rc.1" } },
     "staging_pct": 100,
     "rollback_version": "1.11.24"
   }
   ```
3. **One rollback switch** — `wrangler rollback` re-points the Worker at the previous manifest in <30 seconds.
4. **Each surface consumes the same manifest**:
   - Electron: parse manifest, run the existing `electron-updater` install flow (SHA-512 verified mid-download per Task 1 internals).
   - Capacitor (Capgo plugin): extend to fetch from Worker URL instead of Capgo cloud; signature already verified by the plugin.
   - PWA: Workbox precache reads the manifest, `version.json` poll defeats the 24-hour browser timer (per `serviceWorker.update()` MDN docs).
   - Cloudflare Worker: manifest IS the Worker config (no separate deploy — `wrangler versions deploy` from the manifest).
5. **Staged rollouts via Worker-side percentage gate** — Worker's KV stores per-platform staged cohorts; manifest response includes `staging_pct` and Worker validates the requester's cohort UUID before returning (UUID-v5 staging pattern from `AppUpdater.ts:1145-1168`).
6. **Crash-throttled rollback** — Sentry's `release` tag triggers Worker-side webhook; if crash rate exceeds threshold, Worker atomically swaps manifest to `rollback_version`.
7. **Manifest signed by Worker with Ed25519** — matches `update-security-baseline-2026.md` §1.

### 4.4 Migration cost

- Replace `electron-updater`'s built-in `latest.yml` with a Worker-fetched manifest (small change in `app-update.yml`; electron-updater v27+ already supports custom `updateInfoProvider` pattern).
- Replace Capgo cloud with Worker-fetched manifest for Capacitor (small plugin URL override).
- Add `version.json` poll in PWA service worker (small Workbox config + the OOB cache from update-security-baseline-2026.md §5).
- Convert Worker script deploy to manifest-driven (already exists in spirit in `apps/airiz-motor/release-relay/`).
- ~2-3 weeks of work for a one-engineer team.

### 4.5 Risks the survey surfaced — constraints Option C must design against

From the top-10 problems (Task 3 chat output + `release-failure-modes.md`):

| Problem | Constraint on Option C |
|---|---|
| Partial-download mid-update | Manifest must include resume offset; client must verify sha512 mid-download. Electron-updater already does this via `DownloadedUpdateHelper.ts`. Capgo plugin does not — must add. |
| Code-signing cert expiry | Tied to platform signing (Authenticode / Apple Distribution / Play App Signing) — independent of manifest. |
| Manifest tampering | Ed25519 signature in Worker; rotation via `key_id` field. |
| Delta-update corruption | v1: ship full binaries only (~150-200MB Electron); defer delta until manifest chain is stable. |
| Staged-rollout regret | Worker-side cohort UUID gate + telemetry from Sentry before promoting to 100%. |
| PWA SW old-shell | NetworkFirst for navigations + `version.json` poll (per MDN `serviceWorker.update()` 24-hour timer). |
| iOS App Store constraints | Capgo plugin only ships JS/CSS, never native; App Store still gates native upgrades. |
| macOS notarization | Tied to electron-builder's macOS pipeline, not manifest. |
| Android v2/v3/v4 signature | Tied to Play App Signing; v3 mandatory for key rotation (minSdk 28+). |
| Cloudflare Worker rollback | `wrangler rollback` already in place; manifest-driven means no script change needed. |

---

## 5. Final dataset inventory

All files produced or surfaced by this survey, paths relative to `C:\Users\juwen_lie\Documents\Default Project`:

### 5.1 New research artifacts (Phase 1)

| Path | Size | Purpose |
|---|---|---|
| `apps/airiz-motor/.opencode/research/update-manifests/1759950392-update-manifests-research.md` | 65 KB (1042 lines) | Manifest format research (7 tools) + draft unified JSON schema |
| `apps/airiz-motor/.opencode/research/update-manifests/protocol-surface-summary.md` | 26.6 KB | Protocol surface (9 updaters) + cross-tool comparison |
| `apps/airiz-motor/.opencode/research/update-manifests/unified-models-summary.md` | (this run, corrected) | Unified auto-update models survey (12 frameworks) — **Codemagic §11 corrected** |

### 5.2 New verification artifacts (Phase 2)

| Path | Verdict |
|---|---|
| `apps/airiz-motor/.opencode/research/update-manifests/verification-electron-updater.md` | CONSISTENT |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-protocol-surface.md` | 5 CONSISTENT, 1 MINOR DRIFT |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-best-practices.md` | 4 CONSISTENT, 3 MINOR DRIFT |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-top-10-problems-and-postmortems.md` | 5/5 CONSISTENT |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-unified-models.md` | 8 CONSISTENT, 1 MINOR DRIFT, 1 CONTRADICTED (Codemagic, corrected) |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-deep-topics.md` | 8/8 VERIFIED |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-manifest-research.md` | NOT LANDED — re-run needed |
| `apps/airiz-motor/.opencode/research/update-manifests/verification-consolidated.md` | Phase 2 roll-up |

### 5.3 Existing AIRIZ research referenced (Task 5)

| Path | Purpose |
|---|---|
| `apps/airiz-motor/release-failure-modes.md` (687 lines) | 10 hardest problems with cited real outages |
| `apps/airiz-motor/docs/auto-update-postmortem-library-2022-2026.md` (1466 lines) | GitHub-issue-level postmortems 2022–2026 |
| `apps/airiz-motor/docs/airiz-update-channel-risk-register.md` | 10-risk register with cited vendors + URLs |
| `apps/airiz-motor/release-architecture-reference.md` | Architecture decisions + AIRIZ baseline |
| `apps/airiz-motor/update-security-baseline-2026.md` | 12-section security baseline (incl. ed25519) |
| `apps/airiz-motor/unified-release-manifest-schema.md` | Unified manifest JSON schema draft |
| `apps/airiz-motor/updater-pass2-verification-2026-11-05.md` | Earlier Phase 2 verification (prior research) |

### 5.4 Existing AIRIZ release-relay tooling (will become Option C's Worker implementation)

| Path | Purpose |
|---|---|
| `apps/airiz-motor/airiz-release-kit/sync_release_feed.py` | Custom release-feed synchronizer |
| `apps/airiz-motor/airiz-release-kit/add_coadmin.py` | Ziris PTB co-admin name registrar |

---

## 6. Open items (not blockers, but recommended next steps)

1. Re-run `verification-manifest-research.md` against the now-present `1759950392-update-manifests-research.md` source.
2. Update Phase 1 best-practices citations to sub-pages (`/apksigning/v3` + `/apksinging/v4`; `/workers/versions-and-deployments/rollbacks/` + `/version-overrides/`; `/product/releases/setup/`).
3. Fix §B.1.2 of the postmortem library: Morphisec notified Avast on Sept 12, 8:35 AM PT; Cisco Talos on Sept 14, 7:25 AM PT (not the reverse).
4. Lower the Tauri mobile caveat in §1 of `unified-models-summary.md` to reflect `#[cfg(desktop)]` reality.
5. Begin Option C implementation: scaffold a Cloudflare Worker that signs the unified manifest, wire `electron-updater`'s `updateInfoProvider` to the Worker URL, replace Capgo cloud endpoint, add `version.json` poll to the PWA SW.

---

*Survey compiled 2026-11-05 by MiniMax-M3 (OpenCode). Phase 1 + Phase 2 of an 8-agent parallel survey, with one Phase 1 contradiction (Codemagic Patch framework) caught and corrected.*
