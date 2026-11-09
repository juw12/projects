# AIRIZ Motor Console — Unified Release Manifest: Schema-Design Reference

> **Owner:** Juwen Lie · Team Ziris PTB
> **Status:** Research complete 2026-11-05
> **Purpose:** The *minimum viable* field contract for every major auto-updater
> manifest schema AIRIZ touches, plus the single signed manifest
> (`airiz-release.v1`) that subsumes them.
> **Companions:** `release-architecture-reference.md` (protocol mechanics —
> install/rollback/deltas per engine) and `tools/README.md` (implementation,
> CI flow, key setup).
> **How to read:** Each schema section lists the exact fields a *client* reads
> (type / required / default / signing / versioning semantics / provider
> extensions / citation). Sections end with the one-line "shape" the unified
> manifest must cover.

---

## 0. The 8 schemas at a glance

| # | Engine | Manifest medium | Signing | Versioning | Rollout knob |
|---|--------|-----------------|---------|------------|--------------|
| 1 | electron-builder (NSIS/DMG/AppImage) | `latest.yml` (YAML) | sha512 (integrity) + v27 `signatures[]` (ed25519) | SemVer | `stagingPercentage` |
| 2 | Tauri updater | static JSON / dynamic 200/204 | base64 Ed25519 (`.sig`) | SemVer | server-side |
| 3 | Capawesome live-update | cloud (config + `bundleId`) | RSA/PEM bundle sig | bundleId (UUID) + channel | cloud % |
| 4 | Capacitor live-update (official, deprecated) | cloud (Appflow) | **none** (a deprecation cause) | n/a | n/a |
| 5 | Squirrel.Windows | `RELEASES` (plain text) | SHA-1 (integrity only) | SemVer (nuspec) | `# nn%` |
| 6 | Sparkle | appcast (RSS+XML) | EdDSA/Ed25519 (`sparkle:edSignature`) | CFBundleVersion (monotonic) + shortVersionString | `phasedRolloutInterval` |
| 7 | PWA Service Worker | SW script bytes | TLS (+ optional SRI) | none built-in | none |
| 8 | Microsoft AppInstaller | `.appinstaller` (XML) | MSIX Authenticode (package) | 4-part (not SemVer) | server/enterprise |

**Unification thesis:** every engine is ultimately `(version, channel,
download URL(s), integrity hash, authenticity signature, rollout gate, release
time)`. Section 9 shows the 15-field `airiz-release.v1` that covers all five
AIRIZ surfaces and the mapping from each schema above onto it.

---

## 1. electron-builder — `latest.yml` (NSIS / DMG / AppImage)

**Citation:** `electron/electron-builder` →
`packages/app-builder-lib/src/publish/updateInfoBuilder.ts` (emitter),
`test/snapshots/updater/nsisUpdaterTest.js.snap` (verified sample),
`electron-userland/electron-builder` `packages/electron-updater` `AppUpdater.ts`
(consumer). Docs: https://www.electron.build (Auto-update).

**File layout:** `latest.yml` (Windows), `latest-mac.yml` (macOS),
`latest-linux.yml` (Linux — a *per-arch array*). One file per platform.

**Verified shape (from the test snapshot):**

```yaml
# latest.yml (Windows)
files:
  - size: 89
    url: "TestApp Setup 1.1.0.exe"
path: "TestApp Setup 1.1.0.exe"
releaseDate: "2024-01-01T00:00:00.000Z"
sha512: "<base64>"
stagingPercentage: 1
version: "1.1.0"
```

**Field contract:**

| Field | Type | Req | Default | Notes |
|-------|------|-----|---------|-------|
| `version` | string (SemVer) | **Yes** | — | Compared against installed version. |
| `files` | array | **Yes** | — | Each entry below. |
| `files[].url` | string | **Yes** | — | Installer URL (may be relative to feed base). |
| `files[].sha512` | string (base64) | **Yes** (win) | — | SHA-512 of that file. |
| `files[].size` | int (bytes) | **Yes** | — | |
| `files[].arch` | string | No | — | `ia32`/`x64`/`arm64` (multi-arch feeds). |
| `path` | string | **Yes** (win) | — | Primary installer filename. |
| `sha512` | string (base64) | **Yes** (win) | — | SHA-512 of `path`. |
| `releaseDate` | string (ISO 8601) | emitted | now() | Set by builder: `new Date().toISOString()`. |
| `stagingPercentage` | int 0–100 | No | 100 | Staged rollout; consumed by `AppUpdater`. |
| `signatures[]` | array | No (v27+) | — | **v27+**: `[{value: <base64 ed25519>, ...}]`; verified against `updateManifestPublicKey`. |

**Blockmap (differential):** electron-updater also fetches
`<installer>.blockmap` (`.blockmap` next to the file) to compute a partial
download. Not a field in `latest.yml`; a sibling artifact. (In AIRIZ's
canonical manifest this is `artifacts.electron.blockmap_url`.)

**Signing / verification:**
- Integrity: `sha512` (base64) of the installer.
- Authenticity (**electron-updater v27+**): `updateManifestPublicKey` (base64
  SPKI DER) in `app-update.yml`; when set, the manifest **must** carry a
  verifiable `signatures[]` (Ed25519) or the update is rejected. AIRIZ signs
  the canonical manifest and emits the per-platform `latest.yml` with that
  signature (see `tools/manifest-to-electron-yml.ts`).

**Versioning semantics:** SemVer string, lexicographic-then-numeric compare in
electron-updater.

**Provider-specific extensions:** `provider` ∈ {`generic`, `github`, `s3`,
`bintray` (deprecated)} changes only the **URL base / hosting**, not the
`latest.yml` content. `channel` (e.g. `beta`) selects `latest-beta.yml`.

**Shape the unified manifest must cover:** `version`, `channel`,
`releaseDate→released_at`, `files[].{url,sha512,size,arch}`, `path`,
`stagingPercentage→staged_rollout`, blockmap, v27 `signatures[]`.

---

## 2. Tauri updater — `@tauri-apps/plugin-updater` (Tauri 2.x)

**Citation:** https://v2.tauri.app/plugin/updater/ ;
`tauri-apps/plugins-workspace` `plugins/updater`.

**Two delivery modes:** (a) **static JSON** file (S3/CDN/GitHub Releases),
(b) **dynamic server** that answers `200`+JSON (update) or `204` (no update).

**Static JSON:**

```json
{
  "version": "1.2.3",
  "notes": "Release notes",
  "pub_date": "2025-06-01T12:00:00Z",
  "platforms": {
    "linux-x86_64":   { "signature": "<b64>", "url": "https://.../app.AppImage" },
    "windows-x86_64": { "signature": "<b64>", "url": "https://.../app-setup.exe" },
    "darwin-aarch64": { "signature": "<b64>", "url": "https://.../app.app.tar.gz" }
  }
}
```

**Dynamic response:**

```json
{ "version": "1.2.3", "pub_date": "…", "url": "https://…", "signature": "<b64>", "notes": "…" }
```

**Field contract:**

| Field | Type | Req | Default | Notes |
|-------|------|-----|---------|-------|
| `version` | string (SemVer) | **Yes** | — | Leading `v` optional. |
| `notes` | string | No | — | |
| `pub_date` | string (RFC 3339) | No | — | |
| `platforms` | object (keyed `OS-ARCH`) | **Yes** (static) | — | Keys: `linux-x86_64`, `linux-aarch64`, `linux-armv7`, `linux-i686`, `windows-x86_64`, `windows-i686`, `darwin-x86_64`, `darwin-aarch64`. |
| `platforms.<t>.url` | string | **Yes** | — | |
| `platforms.<t>.signature` | string (base64) | **Yes** | — | Ed25519 `.sig` content. |
| `url` / `signature` | string | **Yes** (dynamic) | — | Flattened per-request. |

**Signing:** Ed25519. `tauri signer generate` → public key into
`tauri.conf.json` `plugins.updater.pubkey`; private key in
`TAURI_SIGNING_PRIVATE_KEY` at build; per-platform `.sig` emitted. Verified
**before install; cannot be disabled.** Key rotation via runtime `pubkey()`
builder.

**Config (`tauri.conf.json`):** `bundle.createUpdaterArtifacts`
(`true`/`"v1Compatible"`); `plugins.updater.pubkey` (base64 key **content**);
`plugins.updater.endpoints[]` (TLS enforced in production); URL variables
`{{current_version}}`, `{{target}}`, `{{arch}}`.

**Versioning semantics:** SemVer. Custom `version_comparator` allows
downgrades.

**Provider extensions:** multiple `endpoints[]` tried in order; channel
emulated by distinct endpoint URLs.

**Shape the unified manifest must cover:** `version`, `pub_date→released_at`,
per-target `{url, signature}`, `notes`.

---

## 3. Capawesome — `@capawesome/capacitor-live-update`

**Citation:** `capawesome-team/capacitor-plugins` →
`packages/live-update/README.md`. Platforms: Android / iOS / Electron.
Capacitor 6/7/8. License: MIT.

**Model — cloud-driven.** There is **no public static `bundle.json` schema**.
A "bundle" is a UUID (`bundleId`) registered in the Capawesome cloud; the
client asks the cloud for the latest bundle per channel and applies it on next
launch. The *schema* you configure is the **plugin config**, and the bundle
reference is a `bundleId`. The field set commonly drawn for a "bundle record"
(`id, version, channel, url, checksum, signature, rolloutPercentage, createdAt`)
is an **abstraction** of the cloud record, not a 1:1 published schema.

**Plugin config (verbatim fields, with defaults):**

| Field | Type | Req | Default | Notes |
|-------|------|-----|---------|-------|
| `appId` | string (UUID) | **Yes** | — | Capawesome app id. |
| `autoBlockRolledBackBundles` | bool | No | `false` | Block a bundle after rollback. |
| `autoDeleteBundles` | bool | No | `false` | Prune unused bundles. |
| `autoUpdateStrategy` | `'none'`\|`'background'` | No | `'background'` | Download behaviour. |
| `defaultChannel` | string | No | `'production'` | Fallback channel. |
| `httpTimeout` | int (ms) | No | `60000` | |
| `publicKey` | string (**PEM-encoded RSA**) | **Yes** | — | **RSA, not Ed25519.** |
| `readyTimeout` | int (ms) | No | `0` | |
| `serverDomain` | string | No | `api.cloud.capawesome.io` | Self-host override. |

**JS API (client surface):** `sync()`, `ready()`, `fetchLatestBundle()`,
`fetchChannels()`, `downloadBundle({url, bundleId})` (self-hosted),
`setNextBundle(bundleId)`, `getCurrentBundle()`, `getBundles()`,
`deleteBundle(bundleId)`, `setChannel(channel)`, `reset()`, `reload()`.

**Signing:** bundle integrity/authenticity verified against `publicKey` —
**PEM-encoded RSA**. v8.x **hard-requires** RSA in `publicKey`.

**Versioning semantics:** `bundleId` (UUID) + channel. Display version is
metadata; there is no strict SemVer gate in the client.

**Rollout:** cloud-managed per channel (percentage/targeting in the
dashboard); not a client field.

**Why this matters for AIRIZ:** because Capawesome forces RSA, AIRIZ does **not**
let Capawesome verify. The mobile client verifies the manifest's **Ed25519**
signature itself (`apps/airiz-motor/mobile/src/live-update.mjs`) and keeps
Capawesome only for its state primitives (`setNextBundle`, channel state,
`autoBlockRolledBackBundles`) — one signing scheme across all 5 surfaces.

**Shape the unified manifest must cover:** `channel`, `defaultChannel`,
`appId→app_id`, per-bundle `{url, integrity}`, and a signature that is
**decoupled from the OTA engine** (hence manual ed25519 verify).

---

## 4. Capacitor live-update (official — DEPRECATED)

**Citation:** `ionic-team/capacitor` → `cli/src/tasks/copy.ts` (references
`@capacitor/live-updates`); the package is the **Ionic Appflow Live Updates**
integration.

**Status:** Deprecated/removed (~2023–2024). Superseded by Capawesome (Capgo).
It was a cloud (Appflow) service; the app called `getLiveUpdateURL()` to fetch
the web-bundle URL and swapped the WebView.

**Honesty note (fail loud):** I could **not** verify a public static
`bundle.json` schema for `@capacitor/live-updates`. Treat any field list for it
as unverified. Its deprecation is attributed to **no cryptographic signing**
(MITM exposure) plus maintenance gaps — which is exactly the gap AIRIZ's
ed25519-signed manifest closes. Do not design against it.

---

## 5. Squirrel.Windows — `RELEASES` (+ nuspec)

**Citation:** `Squirrel/Squirrel.Windows` (branch `develop`) →
`docs/getting-started/5-updating.md` (RELEASES),
`docs/getting-started/update-process.md` (SHA-1 verify, full-vs-delta, no
rollback), `docs/getting-started/nuget-package-metadata.md` (nuspec).

**`RELEASES` file:** plain text, one line per release, **newest first**.

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
```

**Line format:** `<SHA1: 40-hex uppercase> <filename> <size bytes>[ # nn%]`
(name comes **before** size).

| Token | Type | Req | Default | Notes |
|-------|------|-----|---------|-------|
| SHA-1 | 40-hex (upper) | **Yes** | — | Integrity of the `.nupkg`. |
| filename | string | **Yes** | — | `-full.nupkg` or `-delta.nupkg`. |
| size | int (bytes) | **Yes** | — | |
| `# nn%` | comment | No | 100 | Staged rollout (Squirrel ≥ 1.4.0), attached to size. |

**nuspec (the package metadata):**

| Field | Purpose |
|-------|---------|
| `<id>` | App identifier (no spaces/dots). |
| `<version>` | SemVer → becomes the app version dir name. |
| `<title>` / `<releaseNotes>` | Display / update notes. |
| `lib/` files | Application binaries. |

**Signing / verification:** **SHA-1 integrity only.** No cryptographic
signature of `RELEASES` (trust = HTTPS + Authenticode code-signing of the
payload).

**Versioning semantics:** SemVer (nuspec `<version>`); full-vs-delta chosen by
size; **no built-in rollback** (fix = remove entry + ship a higher version).

**Shape the unified manifest must cover:** `version`, `files[].{url,hash,size}`,
rollout %, and — critically — a **real authenticity signature** (which
Squirrel lacks).

---

## 6. Sparkle — appcast (RSS + `sparkle` namespace)

**Citation:** https://sparkle-project.org/documentation/publishing/ ;
`sparkle-project/Sparkle` (2.x).

```xml
<item>
  <title>Version 2.0</title>
  <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
  <sparkle:version>2</sparkle:version>
  <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
  <sparkle:minimumAutoupdateVersion>1.0.0</sparkle:minimumAutoupdateVersion>
  <sparkle:channel>stable</sparkle:channel>
  <sparkle:criticalUpdate>true</sparkle:criticalUpdate>
  <sparkle:phasedRolloutInterval>3600</sparkle:phasedRolloutInterval>
  <enclosure url="https://…/App-2.0.zip"
             sparkle:edSignature="BASE64"
             length="1623481"
             type="application/octet-stream"/>
</item>
```

**Field contract:**

| Element/attr | Type | Req | Default | Notes |
|--------------|------|-----|---------|-------|
| `sparkle:version` (item/enclosure) | string (CFBundleVersion) | **Yes** | — | **Monotonic build number** — primary compare key. |
| `sparkle:shortVersionString` | string | No | — | Marketing version (SemVer-ish). |
| `enclosure url` | string | **Yes** | — | |
| `sparkle:edSignature` | string (base64) | **Yes** (2.x) | — | **EdDSA / Ed25519** of the ZIP. |
| `enclosure length` | int (bytes) | No | — | |
| `sparkle:releaseNotesLink` / `fullReleaseNotesLink` | URL | No | — | |
| `sparkle:minimumSystemVersion` | string | No | — | Min macOS. |
| `sparkle:minimumAutoupdateVersion` | string | No | — | Skip majors below this. |
| `sparkle:minimumUpdateVersion` (2.9+) | string | No | — | |
| `sparkle:channel` | string | No | all | Channel marker. |
| `sparkle:criticalUpdate` / `informationalUpdate` | bool | No | `false` | |
| `sparkle:phasedRolloutInterval` | int (s) | No | — | 7-cohort phased rollout. |
| `sparkle:hardwareRequirements` (2.9+) | e.g. `arm64` | No | — | |

**Signing:** Ed25519 (`generate_keys` → `SUPublicEDKey` in Info.plist →
`sign_update`/`generate_appcast` → `sparkle:edSignature`). DSA deprecated
(2.3+). Optional feed-level signature (2.9+).

**Versioning semantics:** **dual** — `CFBundleVersion` (monotonic, machine
compare) vs `CFBundleShortVersionString` (human).

**Shape the unified manifest must cover:** `version` (monotonic),
`shortVersionString`, `enclosure.{url, size, edSignature}`, channel,
critical flag, phased rollout.

---

## 7. PWA Service Worker — update lifecycle

**Citation:** W3C Service Workers 1 (Editor's Draft)
https://w3c.github.io/ServiceWorker/v1/ ; MDN
https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API ; Workbox
https://developers.google.com/workbox.

**There is no manifest schema** — the **SW script bytes** are the unit of
update; a byte change triggers the update flow.

**Lifecycle states:** `installing → waiting → activating → active`
(→ `redundant` on failure).

| Concept | Value | Ref |
|---------|-------|-----|
| Update-check interval | 86400 s (24 h) default, or on fetch failure | §3.2 |
| `updateViaCache` | `imports` (default) / `all` / `none` | §3.2.6 |
| `skipWaiting()` | new SW takes control immediately | §4.1.3 |
| `clients.claim()` | new SW claims all open clients | §4.3.4 |
| `registration.update()` | force re-fetch | MDN |

**Workbox (concrete recipe):** `workbox.core.skipWaiting()` /
`clientsClaim()` / `messageSkipWaiting()`; **BroadcastUpdatePlugin** with
`headersToCheck` (default `Content-Length`, `ETag`, `Last-Modified`) posting
`{ type:'CACHE_UPDATED', meta:'workbox-broadcast-update',
payload:{cacheName, updatedURL} }`.

**Signing / verification:** none built-in — **TLS** in transit, optional
Subresource Integrity / Workbox precache integrity.

**Versioning / rollout:** none built-in — developer-controlled (versioned
cache names, OOB `version.json` poll). SW activates **atomically on first
visit** to the new script.

**Shape the unified manifest must cover:** for PWA, essentially just a
**version marker + asset URL** the page can OOB-poll; the manifest's
`staged_rollout` is **not honored** by the SW (activation is atomic).

---

## 8. Microsoft AppInstaller — `.appinstaller` (XML)

**Citation:**
https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/app-installer-file
; https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file

**Namespaces (versioned):** `xmlns=…/appinstaller/2017` (Win 1709),
`s2=…/2017/2` (1803), `s3=…/2018` (1809), `s4=…/2021` (21H2).

```xml
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2017"
              xmlns:s2="http://schemas.microsoft.com/appx/appinstaller/2017/2"
              xmlns:s4="http://schemas.microsoft.com/appx/appinstaller/2021"
              Version="1.0" Uri="https://…/update.appinstaller">
  <MainBundle Name="Contoso.App" Publisher="CN=Contoso,…"
              Version="1.2.3.0" ProcessorArchitecture="x64"
              Uri="https://…/App.msixbundle"/>
  <Dependencies><Package Name="Microsoft.VCLibs.140.00" MinVersion="14.0.30723.0"/></Dependencies>
  <s4:UpdateUris><s4:Uri>https://…/update.appinstaller</s4:Uri></s4:UpdateUris>
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="24" UpdateBlocksActivation="false"
              ShowPrompt="true" s3:HoursAfterStart="72"
              s2:StartWindow="12" s2:ThrottleNetworkDownload="true"
              Update="true"/>
    <s4:ForceUpdateFromAnyVersion>false</s4:ForceUpdateFromAnyVersion>
  </UpdateSettings>
</AppInstaller>
```

**Field contract (representative):**

| Element/attr | Type | Req | Default | Notes |
|--------------|------|-----|---------|-------|
| `@Version` (root) | 4-part | **Yes** | — | Not SemVer. |
| `@Uri` (root) | URL | **Yes** | — | Self-URI for re-check. |
| `MainPackage`/`MainBundle` | element | **Yes** | — | The MSIX to install. |
| `MainPackage.@{Name,Publisher,Version,ProcessorArchitecture,Uri}` | — | **Yes** | — | Publisher = X.509 DN. |
| `Dependencies/Package` | element | No | — | Required frameworks. |
| `UpdateURIs`/`RepairURIs` (old) / `s4:UpdateUris`/`s4:RepairUris` (21H2, max 10) | URL list | No | — | Where to check next. |
| `UpdateSettings/OnLaunch/@HoursBetweenUpdateChecks` | int (h) | No | `24` | Check cadence. |
| `OnLaunch/@{UpdateBlocksActivation,ShowPrompt,Update}` | bool | No | varies | Update behaviour. |
| `s3:HoursAfterStart`, `s2:StartWindow`, `s2:ThrottleNetworkDownload` | — | No | — | 1809+/1803 refinements. |
| `s4:AutomaticBackgroundTask` | bool | No | — | 21H2 background install. |
| `s4:ForceUpdateFromAnyVersion` | bool | No | `false` | 21H2. |

**Signing / verification:** the **MSIX package** is Authenticode-signed
(EV/OV); the `.appinstaller` itself is **not signed** (trust = HTTPS). Windows
checks code-sig validity, publisher match, version newer, deps satisfied.

**Versioning semantics:** **4-part** `major.minor.build.revision`.

**Shape the unified manifest must cover:** `version` (4-part), main
`{name, publisher, arch, url}`, dependencies, check cadence. (AIRIZ uses the
**unpackaged** NSIS path via electron-builder instead, so this is reference-only.)

---

## 9. Minimum Viable Unified Schema — `airiz-release.v1` (AIRIZ proposal)

**This schema is already implemented** — `tools/sign-manifest.ts` signs it,
`tools/manifest-to-electron-yml.ts` projects it to `latest.yml`, and
`tools/examples/dryrun/sample-release.json` is a concrete instance. It is the
single signed manifest every AIRIZ surface pulls from one R2 bucket.

**Design rules:**
- **One Ed25519 scheme for all 5 surfaces** (Capawesome's RSA is bypassed by
  manual client-side verify).
- **Sign the body, not the signature field:** Ed25519 over **canonical JSON**
  (RFC 8785 / JCS subset — recursive key sort, no whitespace) of the manifest
  **excluding `signatures[]`**.
- **Key rotation:** `signatures[]` is an *array*; CI can emit the old + new key
  side by side, and verification accepts **any** signature that verifies.

**Canonical example (from `tools/examples/dryrun/sample-release.json`):**

```json
{
  "schema_version": 1,
  "app_id": "airiz-motor-console",
  "channel": "production",
  "released_at": "2026-11-05T09:08:52.702Z",
  "staged_rollout": 10,
  "target_versions": {
    "electron": "1.7.3",
    "capacitor_ios": "1.7.3",
    "capacitor_android": "1.7.3",
    "pwa": "1.7.3",
    "worker": "1.7.3"
  },
  "artifacts": {
    "electron":          { "url": "https://releases.airiz.example/electron/1.7.3/airiz-motor-1.7.3.exe", "sha512": "<64-hex>", "size": 72345678, "blockmap_url": "https://releases.airiz.example/electron/1.7.3/airiz-motor-1.7.3.exe.blockmap" },
    "capacitor_ios":     { "url": "https://releases.airiz.example/capacitor-ios/1.7.3/airiz-motor-1.7.3.ipa" },
    "capacitor_android": { "url": "https://releases.airiz.example/capacitor-android/1.7.3/airiz-motor-1.7.3.zip", "sha256": "<64-hex>" },
    "pwa":               { "url": "https://releases.airiz.example/web/1.7.3/" },
    "worker":            { "url": "https://releases.airiz.example/worker/1.7.3.js" }
  },
  "signatures": [
    { "key_id": "airiz-prod-2026", "alg": "ed25519", "value": "<base64>" }
  ]
}
```

**Field contract (~15 fields):**

| # | Field | Type | Req | Default | Meaning | Subsumes |
|---|-------|------|-----|---------|---------|----------|
| 1 | `schema_version` | int | **Yes** | `1` | Schema evolution marker. | — |
| 2 | `app_id` | string | **Yes** | `airiz-motor-console` | Stable app identity. | Capawesome `appId` |
| 3 | `channel` | string | **Yes** | `production` | Routes the file + gating. | electron `channel`, Sparkle `channel`, Capawesome `defaultChannel` |
| 4 | `released_at` | string (ISO 8601) | **Yes** | now() | Monotonic release time. | electron `releaseDate`, Tauri `pub_date`, Sparkle `pubDate` |
| 5 | `staged_rollout` | int 0–100 | **Yes** | `100` | % of cohort eligible. | electron `stagingPercentage`, Squirrel `# nn%`, Sparkle `phasedRollout`, Capawesome cloud % |
| 6 | `target_versions` | object | **Yes** | `{}` | Per-surface SemVer (5 keys). | electron `version`, Tauri `version`/`platforms`, Sparkle `version` |
| 7 | `target_versions.electron` | string (SemVer) | **Yes** | — | | |
| 8 | `target_versions.capacitor_ios` | string (SemVer) | **Yes** | — | | |
| 9 | `target_versions.capacitor_android` | string (SemVer) | **Yes** | — | | |
| 10 | `target_versions.pwa` | string (SemVer) | **Yes** | — | | |
| 11 | `target_versions.worker` | string (SemVer) | **Yes** | — | | |
| 12 | `artifacts` | object | **Yes** | `{}` | Per-surface download record. | electron `files[]`, Tauri `platforms`, Capawesome bundle url |
| 13 | `artifacts.<surface>.url` | string | **Yes** | — | Download URL (or prefix). | every engine's `url` |
| 14 | `artifacts.<surface>.{sha512,sha256,size,blockmap_url}` | hex/int/string | per-surface | — | Integrity + delta. | electron `sha512`/`size`/blockmap; Capawesome checksum |
| 15 | `signatures[]` | array | **Yes** | `[]` | `[{key_id, alg:"ed25519", value: <b64>}]`. | electron v27 `signatures[]`, Tauri `.sig`, Sparkle `edSignature` |

**Signing spec (exact):**
1. Drop `signatures[]`.
2. Canonical-JSON the remainder (recursive key sort, no whitespace).
3. `Ed25519-Sign(privateKey, canonicalUTF8)` → base64 → append to
   `signatures[]` with its `key_id`.
4. Verify: for each `alg==="ed25519"` entry, re-canonicalize the
   signatures-removed body and `Ed25519-Verify`; **accept if any** verifies
   (rotation window). Mirrors electron-updater v27 (sign over
   manifest-minus-signatures).

**R2 layout (host):**
```
airiz-releases/<channel>/manifest.json              # production | beta | …
airiz-releases/electron/<version>/latest.yml        # + latest-mac.yml, latest-linux.yml
airiz-releases/electron/<version>/*.exe + *.blockmap
airiz-releases/capacitor-android/<version>/*.zip
airiz-releases/capacitor-ios/<version>/*.ipa
airiz-releases/web/<version>/…                       # PWA build
airiz-releases/worker/<version>.js
```

**Per-surface consumption (how each surface reads the SAME manifest):**

| Surface | Reader | `staged_rollout` | Signature check | Notes |
|---------|--------|------------------|-----------------|-------|
| Windows (Electron) | `manifest-to-electron-yml.ts` → `latest.yml` | → `stagingPercentage` | v27 `signatures[]` + `updateManifestPublicKey` in `app-update.yml` | sha512 hex→base64 on projection; blockmap sibling. |
| Android (Capacitor) | `release-relay/` `withinRollout()` | `SHA-256(deviceId+channel)` bucket vs % (404 if out) | client verifies **Ed25519** itself (`mobile/src/live-update.mjs`) | Capawesome used only for state primitives (its `publicKey` forces RSA). |
| iOS (Capacitor) | same as Android | same | same | IPA via App Store for native; JS via OTA. |
| PWA | OOB poll of `manifest.json` | **not honored** | verify Ed25519, then SW `registration.update()` | SW activates atomically on first visit to new script. |
| Worker | `wrangler versions deploy --percentage N` | **server-side** (CF gradual deployments) | n/a (not a client manifest) | CF controls the split, not the manifest field. |

**What it deliberately drops (and why):**
- **Delta payloads** (Squirrel bsdiff / Sparkle BinaryDelta) — electron
  blockmap covers the Windows delta need; mobile/PWA ship full bundles. Keep
  the door open via `blockmap_url`.
- **Sparkle's dual versioning** — a single SemVer per surface is sufficient
  for AIRIZ; no monotonic build number needed.
- **AppInstaller 4-part versioning / MSIX** — AIRIZ ships unpackaged NSIS, not
  MSIX; section 8 is reference-only.
- **Capawesome's cloud record fields** — `bundleId`/cloud % are Capawesome
  internals; AIRIZ's `channel` + `staged_rollout` + `artifacts` replace them
  for the self-hosted path.

---

## 10. Verification status (honest ledger)

| Item | Verified against | Notes |
|------|------------------|-------|
| electron-builder `latest.yml` fields | builder source + test snapshot (prior session); project `tools/README.md` (v27) | Re-fetch 404'd today (branch/path moved); fields stable & cross-checked vs project README. |
| Tauri updater | v2.tauri.app/plugin/updater | Exact. |
| Capawesome config + API | capawesome-team/capacitor-plugins README | Exact; **RSA/PEM**, cloud-driven, no public static bundle.json. |
| Official Capacitor bundle.json | — | **NOT verified** — no public static schema; stated as uncertainty. |
| Squirrel `RELEASES` line order | Squirrel docs real example | `<SHA1> <name> <size>` (name before size). |
| Sparkle appcast | sparkle-project.org/documentation/publishing | Exact. |
| PWA SW lifecycle | W3C ServiceWorkers 1 + MDN + Workbox | Exact. |
| MS AppInstaller | learn.microsoft.com schema pages | Exact. |

*End of schema-design reference. Generated 2026-11-05.*
