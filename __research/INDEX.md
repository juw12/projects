# AIRIZ Auto-Update Research — Raw Research Artifacts Index

**Date**: 2026-11-05
**Project**: AIRIZ Motor Console (`apps/airiz-motor/` in `juw12/projects` monorepo)
**Owner**: Juwen Lie, Team Ziris PTB
**Goal**: Pick the simplest unified release architecture for 5 surfaces (Electron Windows, Capacitor Android, Capacitor iOS, PWA, Cloudflare Worker)

---

## Final Architecture Decision

**Recommendation: Option C — Build a unified signed-manifest layer on Cloudflare R2, with each surface's native updater as the consumer.**

Do NOT migrate to Tauri (mobile updater is `#[cfg(desktop)]`-guarded, gives no PWA/Worker benefit).
Do NOT keep 5 separate signing pipelines (3 keys, 3 manifest formats, 3 staging mechanisms, 3 rollback stories).

Build one signing layer (Ed25519, single keypair, embedded public key in all 5 surfaces). Serve a single signed JSON manifest. Let electron-updater, @capawesome/capacitor-live-update, PWA Service Worker, and Cloudflare Wrangler each consume it in a shape they already understand.

Implementation: ~3 weekends. See `__research/airiz-protocol-brief-2026-11-05.md` Section 9 for the full unified manifest schema + TypeScript verification code.

---

## Research Artifacts

All deliverables from the 8-agent survey are preserved below. Each artifact is a verbatim copy of the relevant agent's output (raw tool-output file from `C:\Users\juwen_lie\.local\share\opencode\tool-output\`). Where the agent ran out of token budget, the raw research is captured here for future extraction.

| File | Source task | Lines | What it covers |
|------|-------------|-------|----------------|
| `airiz-protocol-brief-2026-11-05.md` | `bg_b477a1a3` (librarian — protocol specs) | 1,133 | Full schemas for electron-builder v27, Tauri 2.x, Capgo/Capacitor, Squirrel.Windows, Sparkle, PWA SW, AppInstaller, Wrangler + minimum viable subset proposal with TS verification code |
| `10-hardest-problems-and-incidents.md` | `bg_ded052d8` (deep — 10 problems) | 228,815 bytes | 10 problems × ≥50 lines paragraphs + CrowdStrike/SolarWinds/CCleaner/ASUS/CodePush/electron-builder verified incident deep-dives |
| `postmortems-2022-2026.md` | `bg_289c5c41` (explore — postmortems) | 202,619 bytes | GitHub issues for Sparkle, Squirrel, electron-builder, Tauri, Workbox, Expo, CodePush + verified incident URLs |
| `security-best-practices-2026.md` | `bg_95900a64` (librarian — security) | 133,988 bytes | Ed25519 vs RSA, Android v3/v4, iOS signing chain, PWA SRI, Cloudflare Workers, staged rollouts, crash-throttled rollback, delta updates, SLSA/sigstore/in-toto — with Wails v3 Ed25519 updater as real-world anchor |
| `release-engineering-topics-8x200.md` | `bg_b8519cb2` (deep — 8 topics) | 54,923 bytes | Delta vs full updates, staged rollouts, crash-throttled rollback, signed manifests, PWA SW update traps, store vs sideload, signed Worker deploys, multi-arch single-bundle vs fat-binary — each verified at exactly 200 ±10 words |
| `electron-updater-capacitor-source-code-maps.md` | `bg_ce238140` (explore — source code) | 200,778 bytes | electron-updater lives in `electron-userland/electron-builder` monorepo at `packages/electron-updater/src` (BaseUpdater.ts 45KB core, AppUpdater.ts 82KB, NsisUpdater.ts, providers/, differentialDownloader/); @capawesome/capacitor-live-update lives in `capawesome-team/capacitor-plugins` monorepo and covers Android+iOS+Electron |
| `electron-updater-capacitor-source-code-maps-part2.md` | same session (early output) | 67,300 bytes | Earlier exploration iteration |

---

## Survey Methodology

### 8 Background Agents Launched (3 batches, queue-limited)

**Phase 1 (original 8):** All timed out in queue (6 simultaneous heavy agents overloaded the queue). 

**Phase 2 (retries in batches of 2):**
- Batch 1: `bg_ce238140` (electron-updater source) ✅ + `bg_b477a1a3` (protocol specs) ✅
- Batch 2: `bg_adf6c313` (security) ❌ aborted + `bg_53692209` (postmortems) ❌ aborted
- Batch 3: `bg_81880d63` (unified models) ✅ + `bg_7fd907ae` (Context7 docs) ✅
- Batch 4: `bg_ded052d8` (10 hardest problems) ✅ + `bg_b8519cb2` (8 topics) ✅
- Batch 5: `bg_95900a64` (security retry) ✅ + `bg_289c5c41` (postmortems retry) ✅

**Verifications honored:** Every URL verified before citing; no fabricated citations; honesty notes where verification failed (e.g., searx search hit rate limit, Apple/MS/Cloudflare docs blocked automated fetch, NVD/MITRE pages JS-gated).

---

## Verified Citations Captured

**Tooling bugs (real GitHub issues):**
- electron-builder #10097/#10098 (blockmap/sha512 mismatch on differential downloads)
- electron-builder #10258/#10262/#10279 (NSIS "Installer integrity check has failed")
- electron-builder #10465/#10466 ("App is damaged" — sealed resource missing)
- electron-builder #10429/#10440 (forceCodeSigning doesn't verify manifest signing)
- Sparkle #2880 (2026-05) macOS 26 EPERM (app-bound provenance)
- Sparkle #2851 (2026-02) macOS 15 EdDSA mismatch
- Sparkle #2734 (2025-06) Delta update generation hangs on 500MB+ files
- Sparkle #2590 (2024-06) Improve security for validating archives
- Sparkle #2640 (2024-10) Mitigate enterprise anti-malware problems
- Sparkle #2671 (2024-12) Downloads may fail with unreliable connection
- Sparkle #2388 (2023-06) Autoupdate password prompt (Xcode 14.3)
- Squirrel.Windows #1783 (2022-01) Leading zero in version, BSOD 0xc0000409
- Squirrel.Windows #1763 (2021-11) Squirrel doesn't clean up previous version
- Squirrel.Mac #322 (2026-07) Updates fail after ShipIt logs rotate to 100th file
- Tauri #2558 (2025-03) `update.install()` never returns
- Tauri #16277 (2026-10) NSIS "Failed to kill App" since Restart Manager switch
- Tauri #8258 (2023-11) Updater fails for macOS sandboxed apps
- Tauri #9565 (2024-04) InvalidSignature
- Workbox #3247 (2023-09) Stale index.html even with revision
- Workbox #2732 (2021) non-precached-url after v5→v6 upgrade
- Expo Updates #48148 (2026-07) Google Play string-translation rewrites `expo_runtime_version`
- Expo Updates #51142 (2026-10) Crash at launch with expo-updates
- CodePush: archived 2025-03-31 with App Center retirement (verified via repo README)

**Third-party incidents (verified via Wikipedia, GitHub, or vendor docs):**
- **CrowdStrike 2024-07-19** — Falcon Channel File 291, 04:09 UTC push, 8.5M Windows hosts, revert at 05:27 UTC, fix: delete `C-00000291-*.sys` in `%windir%\System32\drivers\CrowdStrike\`
- **SolarWinds SUNBURST (CVE-2020-10148)** — Sept 2019 foothold, March 2020 trojanized Orion updates, Dec 13 2020 disclosure, 200+ orgs compromised, FireEye notified
- **CCleaner 2017** — Sept 2017, v5.33 Floxif trojan (Cobalt Strike), 2.27M machines, ~40 second-stage targets (Samsung/Sony/Asus/Intel/VMware), Talos/Trend Micro disclosed Sep 18
- **ASUS Live Update 2019 ShadowHammer** — CVE-2019-10989 (verification status: re-verify)
- **1Password 2023** — Oct 2023 Okta customer-service breach (correction: the "signed-binary Mac install break" framing couldn't be verified; documented 2023 incident is Okta-related)
- **CodePush/App Center EOL 2025** — confirmed via archived repo README

**Real-world reference implementations (verified):**
- **Wails v3 updater** (`wailsapp/wails/v3/pkg/updater/verify.go`) — uses `ed25519.Verify` + `ed25519ph` (SHA-512 prehash via `ed25519.VerifyWithOptions`). Cleanest real-world reference for the manifest verification pattern.
- **stablyai/orca** (`updater-release-feed.ts`) — real-world staged rollout pattern with "publishing window" + "last-good tag" pinning + `allowDowngrade: true` + `disableDifferentialDownload`
- **pingdotgg/t3code** (`ElectronUpdater.ts`) — real electron-updater config with provider, channel, allowPrerelease
- **cundong/SmartAppUpdates** — Android APK patching using bspatch (BSDIFF40) with hardening notes (fixed-width int parsing, length checks, bzip2 stream limits, atomic commit)
- **ostreedev/ostree** — static delta processing using bspatch
- **jitsi/jitsi** — Windows setup using `Setup_executeBspatch`

**Real configs (verified):**
- cosign keyless in: home-assistant/core, siderolabs/talos, falcosecurity/falco, Stirling-PDF, qdrant, paperclipai, stacklok/toolhive, mudler/LocalAI, stefanprodan/podinfo
- in-toto attestation in: gravitational/teleport, in-toto/attestation, moby

**Verified protocol specs (full schemas captured):**
- electron-builder v27 `latest.yml` (files[], stagingPercentage, signature, signatures[] with keyId, blockmap v3)
- Tauri 2.x `latest.json` (platforms, signature, pubkey, dynamic variables {{target}}/{{arch}}/{{current_version}})
- Capgo bundle manifest (RSA-4096 + AES-256-GCM, channels, keyId, ivSessionKey)
- Squirrel.Windows RELEASES file format (`ReleaseEntry.EntryAsString` source)
- Sparkle appcast XML (RSS 2.0 + sparkle: namespace, edSignature, deltaFrom)
- Microsoft AppInstaller (MainPackage, UpdateSettings, AutoUpdate, DependencyGroup)
- Wrangler config (JSON/TOML with KV, R2, D1, Durable Objects bindings)

**Honesty notes (not verified in this session):**
- 1Password "2023 signed-binary Mac install break" — couldn't verify; documented 2023 incident is Okta-related
- ASUS ShadowHammer CVE details — NVD/MITRE pages JS-gated, verification status re-verify
- Slack 2021 / Notion 2022 notarization incidents — couldn't fetch specific dated incidents; mechanism verified via Apple docs + electron-builder #10465
- Facebook 2019 / Instagram 2020 staged-rollout — specific dated incidents not re-verified
- Cloudflare Workers status incidents — status.cloudflare.com transport error
- Cert-expiration incident — specific dated incident not re-verified (mechanism documented)

---

## Why the Decision

See `airiz-protocol-brief-2026-11-05.md` Section 9 for the proposed unified manifest schema, Section 9.5 for the TypeScript verification flow, and Section 9.6 for the R2 storage layout.

### Three risks accepted

1. **Cross-surface key rotation cost** — mitigation: dual-sign for N releases via `signatures[]` array
2. **PWA service-worker update trap** — mitigation: don't call `skipWaiting()` unconditionally; gate on manifest verification + user confirmation; use `BroadcastUpdatePlugin`
3. **Capacitor JS-bundle ≠ full app** — mitigation: manifest carries `nativeVersion` field; reject updates whose `nativeVersion` doesn't match installed native shell

### Implementation order

1. **Weekend 1**: Generate Ed25519 keypair; create R2 bucket; write `sign-manifest.py` (CI step); wire into existing `airiz-update-feed.yml`
2. **Weekend 2**: Wire manifest URL into electron-updater (`provider: generic`); ship Windows release that uses new manifest alongside old `latest.yml`
3. **Weekend 3**: Wire manifest URL into Capacitor (`CapacitorUpdater.setUpdateUrl()`); write PWA manifest-verification worker; migrate Worker relay to consume manifest for deploy audit; decommission old `sync_release_feed.py`

---

## Downstream Decisions (now unblocked)

- **AIRIZ release protocol**: signed manifest schema ✅ (see protocol brief Section 9), Ed25519, channel model (stable/beta/canary), staged rollout (cohortSeed), nativeVersion gate
- **Cross-platform build strategy**: keep electron-builder (Windows) + Capacitor (Android/iOS) + Workbox (PWA) + Wrangler (Worker)
- **Binary cache**: Cloudflare R2 (canonical), GitHub Releases (electron-updater provider option for backup)
- **Code-signing key store**: Ed25519 keypair in CI secret; AIRIZ_ANDROID_KEYSTORE_BASE64 for Android (already in place); EV cert for Windows (existing)
- **Multi-platform release matrix**: single `airiz-release.yml` workflow signing manifest + per-surface builds, all in one shot

---

*End of index.*
