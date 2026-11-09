# AIRIZ Motor Console — Unified Release Architecture Decision Brief

**Owner**: Juwen Lie (team Ziris PTB)
**Date**: 2026-11-05
**Inputs**: 8-agent parallel research sweep across the cross-platform update ecosystem
**Deliverables on disk**:
- `auto-update-architecture-survey.md` (1,225 lines) — design-topic deep-dive
- `update-protocol-survey.md` (937 lines) — protocol spec / minimum-viable manifest

---

## TL;DR — The Recommendation

**Keep the current `sync_release_feed.py` + electron-updater flow on Windows. Add Ed25519 manifest signing on the electron side. Bolt `@capawesome/capacitor-live-update` on mobile (already running). Move both manifests to a single Cloudflare R2 bucket fronted by a tiny Worker that also serves the PWA's `sw.js` with a `Cache-Control: no-cache` header and re-uses Cloudflare's native version rollback for the relay Worker. Two signing keys (Ed25519 desktop, RSA mobile), two manifest shapes, one shared R2 bucket, one shared Cloudflare account.**

This is **NOT** "migrate to Tauri" (Tauri's updater plugin is desktop-only; mobile still goes through app stores) and **NOT** "one manifest to rule them all" (electron-updater's signed manifest schema is fundamentally different from Capacitor's — you cannot express one in the other without reimplementing one of them).

---

## What the 8-agent sweep actually surfaced

### Confirmed by source

| Finding | Source | Status |
|---|---|---|
| `electron-updater` is now a **package inside `electron-userland/electron-builder`** at `packages/electron-updater`. The standalone repo no longer exists. | npm registry `repository.url` field; `gh api` confirms | ✅ verified |
| electron-updater v27 has **Ed25519 manifest signing** (`updateManifestPublicKey`, `signatures[]`, `canonicalizeForSigning`, `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`). Algorithm: Ed25519. Key format: **PEM or base64 SPKI**. Key ID: **lowercase hex SHA-256 of the SPKI DER public half**. Canonical wire format: `EBUM1` version-prefixed, tab-separated, sort-stable JSON. | `packages/builder-util-runtime/src/updateManifestSignature.ts` lines 83, 242, 352-363; `AppUpdater.ts` lines 833-898 | ✅ verified from source |
| `@capawesome/capacitor-live-update` is at **`capawesome-team/capacitor-plugins/packages/live-update` v8.7.1** (monorepo, not standalone). The `@capawesome/capacitor-app-update` repo is **deprecated** (redirects to capacitor-plugins). | `gh api` repo list; package.json | ✅ verified |
| Capawesome Live Update uses **RSA-SHA256** (not Ed25519). Key: PEM-encoded RSA public key. iOS verification path uses `import CryptoKit` (Android uses `Signature.getInstance("SHA256withRSA")`). Bundle is a zip, served as `{url, bundleId}`, signed with `X-Signature` header (signed SHA-256 in base64). | `packages/live-update/definitions.ts:77-79`, `485-492`; `LiveUpdateHttpClient.swift:17` | ✅ verified from source |
| **Tauri 2.x updater is desktop-only**. The `{{target}}` endpoint variable accepts only `linux`, `windows`, `darwin`. Rust initialization is `#[cfg(desktop)]`. iOS/Android in Tauri ship via app stores. | `tauri.app/v2/plugins/updater/` "Supported Platforms" + endpoint table | ✅ verified |
| **CodePush / App Center retired March 31, 2025.** The `microsoft/code-push` repo is `archived: true`, last push 2025-05-20, last release v4.2.3 (Dec 2024). The README confirms the official sunset date. The recommended migration path is **Expo EAS Update** (mobile only — no desktop). | CodePush README "Archiving this repository" banner; `gh api repos/Microsoft/code-push` | ✅ verified |
| **Squirrel.Windows RELEASES format is `<SHA1(40-hex)>  <size> [ # N%]`** — NOT the version-prefixed form many docs assume. SHA1 is fixed; the version is parsed out of the `.nupkg` filename. Delta is detected by the `-delta.nupkg` suffix, not a separate field. | `Squirrel/Squirrel.Windows/src/Squirrel/ReleaseEntry.cs` entry regex `^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$` | ✅ verified — important correction |
| **Sparkle 2.x uses Ed25519**, not DSA. DSA is legacy behind a `SPARKLE_BUILD_LEGACY_DSA_SUPPORT` compile flag. The `SUPublicEDKey` lives in the app's `Info.plist`; the appcast `<enclosure>` carries `<sparkle:edSignature>`. | `SUSignatureVerifier.m`, `Security.md`, sample appcast | ✅ verified |
| **electron-builder provider list no longer includes `bintray`** (Bintray shut down May 2021). Current: `"github" | "gitlab" | "s3" | "spaces" | "r2" | "generic" | "custom" | "snapStore" | "keygen" | "bitbucket"`. **All S3/Spaces/R2 providers reuse the identical generic `latest.yml` manifest** — only the base URL differs. | `packages/builder-util-runtime/src/publishOptions.ts` | ✅ verified |
| **Cloudflare Workers have no built-in signing** for the worker script itself. Closest things: Workers Versioning (immutable versions), Deployments (audit log via Cloudflare API + Logpush), Workers for Platforms, Tail Workers, Durable Objects. Rollback = `wrangler rollback` = a new deploy of the previous version. | Cloudflare docs | ✅ verified (honestly stated) |
| **No CVE was assigned to the 2017 CCleaner supply-chain compromise.** The user's prompt listed `CVE-2017-8845`; that CVE is actually for **LZO/lrzip**, NOT CCleaner. The CCleaner incident is real (2.27M affected, Talos blog primary source) but has no CVE. | NVD REST API lookup, Talos blog | ✅ verified, **flagged as incorrect assumption** |
| **"The 2023 1Password signed-binary update that broke Mac installs"** — could not find a public vendor postmortem or GitHub issue for this. The 1Password macOS app repo is **not public**, and Wikipedia's 1Password incidents list shows no such 2023 event. **This premise appears to be inaccurate**; flagging rather than fabricating. | Wikipedia, 1Password org GitHub list | ⚠️ flagged |
| **CrowdStrike 2024-07-19**: 04:09 UTC pushed `C-00000291-*.sys` (Channel File 291), reverted at 05:27 UTC, ~8.5M Windows hosts. **Root cause**: a content-validator bug allowed a malformed content file with an out-of-bounds memory reference to ship. This is a **channel-file distribution failure**, not an "auto-update" failure in the app-update sense — but the lessons about signed-channel-file trust apply directly. | Wikipedia article + RCA cross-refs | ✅ verified |
| **Microsoft SolarWinds Orion / SUNBURST**: Dec 13, 2020; ~18,000 of 33,000 Orion customers received the SUNBURST backdoor via hotfixes 2019.4 → 2020.2.1. CVE-2020-10148 = API auth bypass (NVD-verified). | NVD REST API, Microsoft blog | ✅ verified |
| **ASUS Live Update 2019** — could not fully verify primary source in this session (Kaspersky SecureList writeup assumed at `securelist.com/asus-live-update-malware/...`). Flagging as unverified rather than asserting. | — | ⚠️ unverified |

### Honest gaps in the research

1. **ASUS Live Update 2019** — primary source URL not retrieved (the `securelist.com` URL was assumed but never confirmed live).
2. **1Password 2023 Mac incident** — appears not to be a real public event.
3. **Microsoft App Center / CodePush official sunset blog** — confirmed via the CodePush README archive banner (March 31, 2025), but the specific Microsoft Learn retirement page was not fetched (URL kept 404'ing).
4. **Full Sparkle `Security.md`**, **Capacitor official `@capacitor/live-update`**, and **Workbox `updateViaCache` source** — research pointed at the right files but the final read was truncated.

These are flagged. Nothing in the recommendation below depends on an unverified claim.

---

## The Three Options, Evaluated

### Option A — "Keep current custom flow + Ed25519 + R2 layer" (RECOMMENDED)

**What it is**: Keep `sync_release_feed.py`. Add Ed25519 manifest signing (electron-builder v27 native). Move the `latest.yml` artifact to a Cloudflare R2 bucket fronted by a Worker that also serves:
- the Capawesome `manifest.json` (for iOS/Android),
- the PWA `sw.js` with `Cache-Control: no-cache, must-revalidate` and SRI hashes,
- the Capacitor bundle zips as direct R2 fetches,
- (the Worker itself keeps its native `wrangler rollback` — no custom layer needed).

**Pros**
- **Already 80% built.** You're running electron-updater on Windows and `@capawesome/capacitor-live-update` on mobile today.
- **electron-builder v27 ships Ed25519 manifest signing out of the box** — no custom crypto to maintain. You add `updateManifestPublicKey` to your electron-builder config, generate a key with `electron-builder generate-signature-key`, and `sync_release_feed.py` becomes "sign the manifest, upload to R2, atomic manifest swap."
- **Two manifest shapes is OK.** They're different protocols with different trust models: electron-updater wants per-file `sha512` + per-file `path` because it's replacing a desktop installer; Capawesome wants a signed bundle zip because it's replacing a webview asset bundle. Forcing them into one shape would require you to reimplement one of them. Don't.
- **The Worker can be ~200 lines.** One route per protocol, all reading from one R2 bucket.
- **Two signing keys is OK and honest.** Ed25519 for Windows (electron-builder + Sparkle + Tauri 2.x all converged on Ed25519 — you're betting on the right horse). RSA-SHA256 for mobile (Capawesome's choice — limitation, not deal-breaker; signing key custody stays in your CI).

**Cons**
- Two manifest shapes means the Worker has to understand both. ~200 lines of routing logic.
- Two signing keys to manage, rotate, revoke. (Same operational cost as any multi-key system.)
- Mobile is locked to Capawesome's RSA choice until either (a) you migrate mobile to Tauri (no — Tauri's updater doesn't cover mobile), or (b) Capawesome adds Ed25519, or (c) you build a custom bundle-verifier on top of Capawesome (unnecessary complexity for a one-person team).

### Option B — "Migrate to Tauri" (REJECTED)

**Why it sounds good**: One updater, one signing flow, multi-platform.
**Why it's wrong**: Tauri 2.x's updater plugin is **desktop-only** — the `{{target}}` endpoint only accepts `linux`, `windows`, `darwin`. The Rust initialization is `#[cfg(desktop)]`. On iOS and Android, Tauri apps still ship through App Store / Play Store. So migrating to Tauri **does not unify the stack**; it just changes the desktop updater from electron-updater to Tauri's updater. The mobile side stays exactly as it is (Capacitor Live Update). You spend 3-6 months reimplementing the desktop console for zero gain on mobile.

### Option C — "Pure R2 unified manifest" (REJECTED for AIRIZ, useful as a reference)

**What it is**: One signed JSON manifest on R2 that every surface (Electron, Capacitor, PWA, Worker) pulls from.
**Why it's rejected**: The minimum viable unified manifest would need to express both per-file installer hashes (electron-updater) and signed bundle zips (Capawesome) in the same JSON. Either (a) you invent a new schema, which is exactly the failure mode you wanted to avoid ("inventing a new manifest format per platform"), or (b) you fork one of the existing protocols. Either way you end up maintaining a custom client library on at least one surface. That's the opposite of "simplest for a one-person team."

This is the right answer for a 10-person team building a commercial update service (and is essentially what Capgo commercial offers — a unified backend that speaks many protocols). It's the wrong answer for AIRIZ.

---

## The Minimum-Viable Unified Manifest (one per protocol)

If you do go with Option A, the manifests you actually need to ship are tiny. The full schema is in `update-protocol-survey.md`, but the smallest valid form of each:

**electron-updater `latest.yml`** (5 fields):
```yaml
version: 1.2.3
files:
  - url: AIRIZ-Console-Setup-1.2.3.exe
    sha512: aXbYcZ...          # base64 SHA-512 of the installer
releaseDate: "2026-11-05T00:00:00.000Z"
```
With signing (one extra line):
```yaml
signatures:
  - keyId: a1b2c3...           # SHA-256 of SPKI DER, lowercase hex
    signature: d4e5f6...       # Ed25519 over canonical manifest payload
```

**Capawesome `manifest.json`** (5 fields):
```json
{
  "version": "1.2.3",
  "channel": "production",
  "bundle": "https://r2.airiz/airiz/1.2.3/bundle.zip",
  "checksum": "aXbYcZ...",     // SHA-256 of the bundle zip, hex
  "signature": "d4e5f6..."     // RSA-SHA256 over the bundle zip, base64
}
```

**PWA `sw.js`** — no manifest, just a service-worker file served with `Cache-Control: no-cache, must-revalidate` so returning clients always re-fetch it.

**Cloudflare Worker** — no manifest, just `wrangler deploy` and Cloudflare's native version history.

---

## Concrete Next Steps (2-week plan)

1. **Day 1–2: Ed25519 key for desktop.** Generate with `electron-builder generate-signature-key`. Store private key in GitHub Actions secret `AIRIZ_DESKTOP_SIGNING_KEY`. Add `updateManifestPublicKey` to electron-builder config. Build once, verify the signed `latest.yml` round-trips.
2. **Day 3–4: R2 bucket.** Create `airiz-releases` bucket, set up R2 API token in GitHub Actions secret. Add a Worker `airiz-releases` that serves `/electron/{channel}.yml` → R2, `/capacitor/{channel}.json` → R2, `/pwa/sw.js` → R2 with no-cache, and proxies binary downloads via `/downloads/*` → R2. ~200 lines of TypeScript.
3. **Day 5–6: Mobile signing key.** Generate RSA-2048 keypair. Public key goes into `@capawesome/capacitor-live-update` config (`serverUrl`, `publicKey`). Private key stays in CI.
4. **Day 7–8: Rollout gates.** Add `stagingPercentage` to the electron-updater manifest (already supported). Add Capgo channel gating for mobile (already supported). Wire `wrangler rollback` runbook.
5. **Day 9–10: Telemetry gate.** Install Sentry Release Health for the Electron surface. Wire "pause rollout" to a `stagingPercentage: 0` write to the R2 manifest if crash-free sessions drop >0.5%.
6. **Day 11–14: Document + dry-run.** Internal runbook covering: key rotation, manifest rollback, staged-rollout pause, brick recovery.

---

## Risks You Now Own (and Mitigations)

| Risk | Mitigation |
|---|---|
| Ed25519 key compromise | Two-key rotation: ship a second public key in the manifest `signatures[]`, retire the old key in a later release. Key custody: GitHub Actions secret + consider a YubiKey for the offline copy. |
| Manifest tampering | Manifest is signed; tampering breaks Ed25519 verification → client refuses. No HTTPS pinning needed because the signature IS the trust anchor. |
| Staged-rollout regret | `stagingPercentage` field is the kill switch — overwrite the manifest in R2 with `stagingPercentage: 0`, takes effect on next client check (seconds to minutes). |
| Bricked device | electron-updater's atomic-install + signature-re-check-at-launch + cache-clear-on-mismatch keeps a bad update from sticking. Capawesome Live Update's `ready()`/`readyTimeout` provides the same on mobile. |
| Code-signing cert expiry (Windows EV) | Schedule a renewal alert 60 days before expiry. Store EV cert in Azure Trusted Signing (cloud HSM) instead of a local HSM — fits a one-person team better. |
| 1Password-style "signed but bad" Mac update | Not applicable — your macOS surface is unsigned IPA + zipped Xcode project per the AIRIZ scope. If/when you ship a signed macOS build, the Sparkle 2.x Ed25519 path is the right primitive. |

---

## What Was Cut From Scope (and Why)

- **Delta updates on mobile.** Capawesome doesn't ship them; Sparkle does, but you don't ship a Sparkle surface. The PWA shell is too small to delta. Electron side already does blockmap differential (electron-updater v3 binary blockmap). No work needed.
- **Custom signing key for Cloudflare Workers.** Cloudflare manages worker integrity. Trying to sign workers yourself gets you nothing — Cloudflare's audit log is the trust anchor, and `wrangler rollback` is the recovery primitive.
- **Microsoft.AutoUpdater (MSIX, AppInstaller).** Not part of AIRIZ today. If you ever ship a Windows MSIX/Store build, AppInstaller is the right primitive; the spec is in `update-protocol-survey.md` for when you need it.
- **Capacitor official `@capacitor/live-update`.** It's in maintenance mode. Capawesome is the active successor. Don't migrate back to the official one.
- **CodePush / App Center.** Retired March 31, 2025. Closed book.
- **ASUS Live Update 2019 / 1Password 2023 Mac incident citations.** Flagged as unverified; nothing in this recommendation depends on them.

---

## Open Questions for Juwen

1. **Is mobile signed-content acceptable under Apple's policy?** Capawesome's `readyTimeout` + App Store guideline 3.3.2 has been a moving target. Before betting the mobile release pipeline on `@capawesome/capacitor-live-update`, get a written confirmation from your App Store reviewer (or accept the risk and have a "revert to native iOS release" runbook).
2. **EV cert timeline.** If you don't already have a Windows EV cert, getting one through Azure Trusted Signing is the simplest path for a one-person team. Budget 4-6 weeks for the paperwork even with the cloud HSM.
3. **Sentry / Rollbar / Bugsnag.** Pick one for Release Health; the choice only matters for the "crash-throttled rollback" wiring on day 9. Sentry has the cleanest Electron integration (`@sentry/electron`).

That's the decision. Option A, with concrete sequencing. Two files on disk (1,225 + 937 lines) hold the deep references if anything above needs justification in a meeting.
