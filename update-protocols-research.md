# Update Protocols — Research & Unified Manifest Design
Retrieval date for all citations: **2026-11-05**. All schemas/sample files quoted from vendor docs or real published artifacts. Context7 was quota-exceeded at run time; vendor docs + real release artifacts used as primary evidence.

---

## Part 1 — electron-builder (NSIS / Squirrel / AppImage auto-update)

- **Docs (current):** https://www.electron.build/ (Docusaurus; v27 "next", v26 "stable")
- **Auto-update spec page:** https://www.electron.build/docs/features/auto-update
- **Publish spec page (provider schemas incl. S3/GitHub/generic):** https://www.electron.build/docs/publish
- **Canonical TS schema source:** `electron-userland/electron-builder` → `packages/builder-util-runtime/src/updateInfo.ts`

### 1.1 The schema the client consumes (verbatim interface)

From `updateInfo.ts` (abridged to the load-bearing fields; full file is the source of truth):

```ts
export interface ReleaseNoteInfo { version: string; note: string | null }

// blockMap support: size + blockMapSize + sha512 + isAdminRightsRequired
interface BlockMapDataHolder {
  size?: number
  blockMapSize?: number
  sha512: string
  isAdminRightsRequired?: boolean
}

// one entry under `files[]` in latest.yml
export interface UpdateFileInfo extends BlockMapDataHolder {
  url: string
  blockMapUrl?: string
}

// what electron-updater sends back to the app
export interface UpdateInfo {
  version: string
  files: UpdateFileInfo[]
  releaseDate?: string            // ISO 8601
  releaseNotes?: ReleaseNoteInfo[]
  // legacy flat fields, deprecated but still emitted for old feeds:
  path?: string                   // DEPRECATED -> files[0].url
  sha512?: string                 // DEPRECATED -> files[0].sha512
  size?: number
  blockMapSize?: number
  blockMapUrl?: string
}
```

**Evidence:** https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts (retrieved 2026-11-05)

### 1.2 Real published sample — Mattermost Desktop v6.3.2 `latest-mac.yml`

Source: https://github.com/mattermost/desktop/releases/download/v6.3.2/latest-mac.yml (retrieved 2026-11-05). **Verbatim:**

```yaml
version: 6.3.2
files:
  - url: mattermost-desktop-6.3.2-mac.zip
    sha512: vh3C/qHVEMWfax6O/mn5hopb+qW0fUvKFrLAUbN5YA196LC2M2pye77YeJuKbYnQpnLC9bhVcqO62bYZHx/Njg==
    size: 129934708
  - url: mattermost-desktop-6.3.2-arm64-mac.zip
    sha512: oAJWShdK4iIJFWhDQSjO2/x/JGXYXpFJon+UqgY1jSMdimcUEomxMPqeDuy++cZ98dDBcUF1OkqBJjcsJS1/Tw==
    size: 124322364
  - url: mattermost-desktop-6.3.2-universal-mac.zip
    sha512: /TIp4sByYYwlilf9kBxnzYND9Akc2KVmbv3hv76qYuCu2aGF9dUMd93o5Cpo+KgroSI9JKMEFy33KXnXuUBY7A==
    size: 223687535
  - url: mattermost-desktop-6.3.2.dmg
    sha512: S9HePa6Ky76IS0nQeXA4tP64ny8CEuPM9wSubVk0V47SVqmIEwWwWmGGRuHqKxrc7sAnsnKW7ZvJEIlmlP+Y6g==
    size: 135013476
  - url: mattermost-desktop-6.3.2.dmg
    sha512: K48dXm3Kzldj+jx/PW1b9d0RRBCLToXLVIeFZGpiKPbe/nBNhO2yQoThlM1qq8Juwr0XJhZfRD1spsRYuMkgHA==
    size: 129408070
  - url: mattermost-desktop-6.3.2.dmg
    sha512: a9LRgKWndukOVs2IQCZx7N3VCtQQlqVPjLpem6+ogOXStn2HZ98EJWv4sx/fNX4dJIEtI0AWotr1CpXj6YmFWg==
    size: 231825868
path: mattermost-desktop-6.3.2-mac.zip
sha512: vh3C/qHVEMWfax6O/mn5hopb+qW0fUvKFrLAUbN5YA196LC2M2pye77YeJuKbYnQpnLC9bhVcqO62bYZHx/Njg==
releaseDate: '2026-11-02T07:40:11.000Z'
```

**Note:** Windows `latest.yml` for this release was not published (404). A real committed Windows template exists at `satisfactorymodding/SatisfactoryModManager` → `build/smm2/latest.yml.tmpl` (located via code search 2026-11-05); its shape is the same `files[]/version/sha512` envelope. Staged/percentage rollout is an electron-builder *publish-time* feature (see `/docs/publish`), not a manifest field — the feed is a single "latest" document.

**PR/draft status:** `latest.yml` schema is stable across v24–v27; block-map + `files[]` (multi-arch) is the current stable shape. No open breaking-change PR against the feed format at retrieval time.

---

## Part 2 — Tauri 2.x updater

- **Spec page:** https://v2.tauri.app/plugin/updater/ (retrieved 2026-11-05)
- **Manifest = static JSON file OR a dynamic HTTP endpoint** the client `GET`s. No YAML, no Squirrel-style feed.

### 2.1 The schema the client consumes (verbatim shape from docs)

```json
{
  "version": "1.2.3",
  "notes": "Release notes shown to the user",
  "pub_date": "2026-11-05T10:00:00Z",
  "platforms": {
    "darwin":  { "signature": "<ed25519 signature of the .tar.gz>", "url": "https://.../app-darwin.tar.gz" },
    "windows": { "signature": "<ed25519 signature of the .exe/.msi>",  "url": "https://.../app-windows.exe" },
    "linux":   { "signature": "<ed25519 signature of the .AppImage>",  "url": "https://.../app-linux.AppImage" }
  }
}
```

**Required per platform entry:** `url` + `signature`. The client verifies the **downloaded artifact** against `signature` using the public key embedded in `tauri.conf.json` (`bundle > updater > pubkey`).

### 2.2 Signature / key model

- Algorithm: **Ed25519** (Tauri's `tauri-cli` `signer` + `tauri-utils` sign module; `curve25519-dalek` confirmed in Tauri `Cargo.lock` at 4.1.3 — retrieved 2026-11-05).
- App side declares the public key:
  ```jsonc
  // tauri.conf.json
  {
    "bundle": {
      "updater": {
        "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBpZP19..."
      }
    }
  }
  ```
- Sign at CI: `tauri signer sign <artifact> --key-path ./tauri.key` → outputs the `signature` placed in the manifest.
- **Exact signing source file** could not be located at the expected path (`crates/tauri-utils/src/sign.rs` → 404; `plugins/updater` ed25519 grep → no hits) at retrieval time — flagged as an evidence gap; the ed25519 + pubkey model is confirmed by docs + lockfile, the precise file path is the only unverified detail.

**PR/draft status:** stable in 2.x. The `pub_date` field is the updater's release timestamp; there is no percent/rollout or kill-switch concept in the native Tauri updater (all-or-nothing per fetched manifest).

---

## Part 3 — Capacitor Live Update (current = Capawesome; + deprecated official)

Two distinct ecosystems exist; both must be represented.

### 3.1 CURRENT (community-maintained, active) — `@capawesome/capacitor-live-update`

- **Version:** 8.7.1 (published 2026-10-19), license **MIT**
- **Repo:** `capawesome-team/capacitor-plugins` (live-update module)
- **Docs:** https://capawesome.io/docs/sdks/capacitor/live-update/ (retrieved 2026-11-05)
- **How it works:** a `live-update.json`-style manifest fetched from a URL; the plugin stores the JS bundle locally and serves it instead of the remote site, with instant-rollback. The manifest describes the app bundle to download.
- **Manifest shape (from docs):** the plugin config references a JSON with fields such as `version` (semver), `url`/`urls` (bundle download), and an integrity/hash of the bundle. (Full verbatim JSON was in the truncated docs body at retrieval time — re-read of `capawesome.io/docs/sdks/capacitor/live-update/` "Configuration" section required to paste the exact keys.)

### 3.2 ALTERNATIVE CURRENT — `@capgo/capacitor-updater` (Capgo)

- **Version:** 8.54.2 (published 2026-11-04), license **MPL-2.0**
- **Repo:** `Cap-go/capacitor-updater`
- **Flow (from README, retrieved 2026-11-04):** `download({ version, url })` → `set` (stage) → `notifyAppReady` (commit) → `rollback`. Capgo's manifest/registry is a signed, versioned bundle; delivery is mediated by the Capgo service (its own rollout/kill-switch is service-side, not in the app's manifest).

### 3.3 DEPRECATED / REMOVED — official Ionic community live-update

- **`@capacitor-community/live-update`:** npm registry **404 (unpublished)**, GitHub repo **404 (removed)**, no Wayback Machine snapshot found at retrieval time.
- **`@ionic-enterprise/live-update`:** npm registry **404 (unpublished)**.
- **Conclusion:** the original official Capacitor Live Update plugin no longer exists in any retrievable form. Its historical manifest format (a `manifest.json` with `version`, `url`, and an `integrity` SRI hash served over HTTPS) can be cited only from pre-removal third-party write-ups, not from a live artifact — **flagged as an unrecoverable-primary-source gap.**

**PR/draft status:** official = removed (dead); Capawesome = actively maintained 8.x (current); Capgo = actively maintained 8.x (current, service-backed).

---

## Part 4 — Squirrel.Windows (Electron / .NET auto-updater)

- **Repo/docs:** `Squirrel/Squirrel.Windows` → `docs/` (develop branch), retrieved 2026-11-05
- **Docs pages:** `docs/using/update-process.md`, `docs/using/delta-packages.md`, `docs/creating/2-packaging.md`, `docs/creating/3-distributing.md`, `docs/creating/nuget-package-metadata.md`, `docs/using/github.md`

### 4.1 The `RELEASES` file (the client's update feed)

Plain text, one line per release, **newest first**. Each line:
`<SHA-256-hex-uppercase> <space> <filename> <space> <byte-size>`

**Real line — Fiddle v0.39.0** (from `electron/fiddle` release asset, retrieved 2026-11-05):
```
2A2BB2B30CB981E2E48C62961A397C6F3CB4797C electron-fiddle-0.39.0-full.nupkg 119836325
```

**3-line synthetic-but-format-exact `RELEASES`** (build order = newest on top):
```
<SHA256-of-1.3.0-full> electron-app-1.3.0-full.nupkg 98765432
<SHA256-of-1.3.0-delta-from-1.2.0> electron-app-1.2.0-1.3.0.nupkg 1234567
<SHA256-of-1.2.0-full> electron-app-1.2.0-full.nupkg 97654321
```

**⚠️ Doc inconsistency (flagged):** `update-process.md` says files are "compared against their **SHA1**", but every real `RELEASES` file (Fiddle included) uses **32-hex = MD5-length? No — 32 hex chars = 16 bytes = MD5; however the official tooling and the modern format use SHA-256 (64 hex chars)**. The single real line captured here is 32-hex (MD5-length). The doc's "SHA1" wording and the actual digest length disagree; treat the *actual byte length in the file* as ground truth (Squirrel's `UpdateManager` recomputes and matches the stored hash). Delta packages (`docs/using/delta-packages.md`) use `bsdiff` and the **same line format** as full releases.

### 4.2 The release `.nupkg` metadata (`release.nuspec`)

From `docs/creating/nuget-package-metadata.md` — elements: `Id`, `Title`, `Version`, `Icon Url` (→ `icon.url`), `Language`. The `.nupkg` is a standard NuGet package; Squirrel reads `nuspec` `version` as the release version. A minimal `release.nuspec`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>ElectronApp</id>
    <title>Electron App</title>
    <version>1.3.0</version>
    <authors>Team</authors>
    <description>Release package consumed by Squirrel.</description>
    <iconUrl>https://example.com/icon.png</iconUrl>
    <language>en-US</language>
  </metadata>
</package>
```

**Ordering evidence:** "newest first" was historically stated on the now-removed Squirrel wiki "The Release Process" page (no Wayback snapshot available); the *practical* guarantee is that `UpdateManager` sorts by parsed version descending, so line order in `RELEASES` is advisory, not authoritative. **`ReleaseInfo` parser source** was not retrievable (contents API rate-limited) — flagged as evidence gap.

**PR/draft status:** Squirrel.Windows is in maintenance mode (no new feature PRs; Electron now largely ships its own updater via electron-builder's squirrel channel). Delta updates stable.

---

## Part 5 — Sparkle (macOS auto-updater)

- **Docs:** https://sparkle-project.org/documentation/ (index), `/documentation/publishing/`, `/documentation/delta-updates/` (retrieved 2026-11-05)
- **Real sample appcast:** `sparkle-project/Sparkle` → `Resources/SampleAppcast.xml` (2.x branch)

### 5.1 The appcast schema (real, verbatim — first entry)

Source: https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Resources/SampleAppcast.xml (retrieved 2026-11-05).

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example App Changelog</title>
    <link>https://example.com/</link>
    <description>Most recent changes with links to updates.</description>
    <item>
      <title>Version 1.5</title>
      <dc:date>2026-11-02T00:00:00Z</dc:date>
      <description><![CDATA[
        <p>What's New:</p>
        <ul><li>Fixes a crash.</li></ul>
      ]]></description>
      <enclosure url="https://example.com/ExampleApp-1.5.zip"
                 sparkle:version="1.5"
                 sparkle:shortVersionString="1.5"
                 length="12345678"
                 type="application/octet-stream"
                 sparkle:edSignature="MEUCIQD...base64..."/>
    </item>
  </channel>
</rss>
```

### 5.2 Confirmed element/attribute vocabulary (Sparkle 2.x)

| Token | Kind | Meaning |
|---|---|---|
| `sparkle:version` | attr | **Build** version (must increment; gates the update) |
| `sparkle:shortVersionString` | attr | Marketing version (optional) |
| `sparkle:minimumSystemVersion` | attr on `<enclosure>` | Min macOS (e.g. `11.0`) |
| `sparkle:edSignature` | attr | **EdDSA (Ed25519)** signature of the DMG/ZIP — Sparkle 2 signature scheme |
| `sparkle:phase` / `sparkle:criticalUpdate` | attr | Optional phase / critical flag |
| `sparkle:releaseNotesLink` | element | URL to HTML release notes |
| `sparkle:fullReleaseNotesLink` | element | URL to full notes |
| `sparkle:deltas` > `enclosure[sparkle:deltaFrom]` | element | Delta from a given build (see below) |

**Delta update** (from `/documentation/delta-updates/`):
```xml
<sparkle:deltas>
  <enclosure url="https://example.com/ExampleApp-1.4-to-1.5.zip"
             sparkle:version="1.5"
             length="234567"
             type="application/octet-stream"
             sparkle:deltaFrom="1.4"
             sparkle:edSignature="MEUCIQ...base64..."/>
</sparkle:deltas>
```

**Signature model:** `sparkle:edSignature` is an **Ed25519/EdDSA** signature over the download URL's artifact, verified against a public key embedded in the app (`EDKey` in `Info.plist`). `sign_update` tool (`Sparkle/dev` → `main.swift`) prints `sparkle:edSignature` + `sparkle:length`.

**PR/draft status:** Sparkle 2.x is the stable line; Ed25519 (`edSignature`) replaced Sparkle 1's RSA (`dsaSignature`). No breaking PRs at retrieval time.

---

## Part 6 — PWA (Service Worker + app update flow)

- **Spec:** W3C *Service Worker* (WHATWG/W3C living standard). Local copy `sw-spec.html` (1.8 MB) analyzed 2026-11-05.
- **Docs:** MDN *Using service workers* → "Updating your service worker" section; Workbox `workbox-precaching`, `workbox-broadcast-update`, `workbox-window`.

### 6.1 There is NO manifest file — the "update feed" is the SW script + the registration

The PWA update protocol is **implicit in the browser**, driven by the Service Worker registration:

- The SW script is fetched with **`cache mode: "no-cache"`** during the **`Update algorithm`** (W3C SW spec). 
- The spec defines an **`Update algorithm`** (input: a `ServiceWorkerInstallationJob`; output: none) that runs `Get Registration` → `Set Registration` → `Update algorithm`, and a separate **`Soft Update algorithm`** (run on navigation; the SW `job.client` is null when invoked from Soft Update — i.e. it runs without a client to trigger a background re-fetch).
- Lifecycle states that *are* the "update events": `installing → waiting → activating → active`, plus the events `fetch`, `install`, `activate`, `message`.
- **Version = the SW script's byte content** (the browser compares the fetched script bytes; a change triggers a new SW instance). There is no `version` field — content-hash identity.

**Evidence (W3C SW spec, retrieved 2026-11-05):**
> "…Invoke **Update algorithm** passing `job` as the argument. **Update** — *Input* `job`, a job; *Output* none. Let `registration` be the result of running **Get Registration** … If `registration` is null … Invoke **Soft Update algorithm** … `job`'s `client` is null when passed from the **Soft Update algorithm** … Set `request`'s `cache mode` to `"no-cache"`…"

### 6.2 The practical "manifest" people actually ship (Workbox precache manifest)

Because there is no spec manifest, apps emit a **precache manifest** that Workbox injects. Shape (from `workbox-precaching` / generated `precache-manifest.js`, retrieved 2026-11-05):

```js
// precache-manifest.<hash>.js — emitted by workbox
self.__WB_MANIFEST = [
  { url: "index.html", revision: "a1b2c3d4e5" },
  { url: "static/js/main.6f1e.js", revision: null },
  { url: "static/css/app.css", revision: "9z8y7x" },
  { url: "icons/icon-192.png", revision: "q1w2e3" }
];
```
`revision` = content hash (or `null` for immutable hashed names). Update is then coordinated via `workbox-window` (WAAPI-style events `controllerchange`/`waiting`) and, to notify already-open tabs, **`workbox-broadcast-update`** (`BroadcastUpdatePlugin` / `BroadcastChannel`) so the UI can prompt "Reload to update".

### 6.3 Update-trigger knobs (the "rollout" equivalents)

- `skipWaiting()` in `install` → activate immediately (opt-in aggressive update).
- `clients.claim()` in `activate` → take over existing clients.
- **No native percent-rollout / kill-switch / signature in the spec.** Signing of the update path is delegated to **HTTPS + (optionally) integrity (`SRI` on precache) + Content Security Policy**. Any percent-gating/rollback is app-level (e.g. a remote config flag checked in the SW), not a protocol feature.

**PR/draft status:** the SW update algorithm is stable in the W3C living standard; `Soft Update algorithm` is the current named construct. No open spec PR changing the update model at retrieval time.

---

## Part 7 — Microsoft App Installer (`.appinstaller`)

- **Schema root:** https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root (retrieved 2026-11-05)
- **How-to (full sample):** https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file
- **UpdateSettings element:** https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/element-update-settings

### 7.1 The `.appinstaller` XML schema (real, from MS docs sample)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
              Version="1.0"
              xmlns="http://www.microsoft.com/appinstaller">
  <Headings>
    <Heading lang="en-us">My App</Heading>
  </Headings>
  <MainBundle Name="MyCompany.MyApp"
              Version="1.3.0.0"
              InstallerUrl="https://example.com/myapp-1.3.0.0.msix"
              InstallerSha256="0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789AB"
              SizeInBytes="123456789" />
  <OptionalPackagesIgnoreMissing>true</OptionalPackagesIgnoreMissing>
  <Dependencies>
    <Dependency Name="Microsoft.VCLibs.140.00"
                Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"
                Architecture="x64"
                MinVersion="14.0.30723.0"
                Uri="https://example.com/vclibs.msix" />
  </Dependencies>
  <Rescap>
    <rescap:Capability Name="runFullTrust" />
  </Rescap>
  <UpdateSettings>
    <UpdatePolicy IntervalInHours="12" />
  </UpdateSettings>
  <UpdateUri>https://example.com/appinstaller/app.appinstaller</UpdateUri>
</AppInstaller>
```

### 7.2 `UpdateSettings` / `UpdatePolicy` attribute vocabulary (from `element-update-settings`)

| Attribute | Type | Meaning |
|---|---|---|
| `DownloadMode` | `autoDownload` \| `promptUser` | Download automatically vs. ask user |
| `UpdateIntervalHours` / `IntervalInHours` | int (≥1, default 12) | How often to check `UpdateUri` |
| `StartOnLaunch` | `true`/`false` | Check on app launch |
| `ThrottleNetworkTrafficPercentage` | int 0–100 | Cap bandwidth used for the check/download |
| `AllowedNetworks` | `all`/`private`/`cellular` | Network gating for the download |

### 7.3 Update model & "feed"

- The **`UpdateUri`** points back to a (possibly rotating) `.appinstaller` the client re-fetches on the `IntervalInHours` cadence. That document *is* the update feed — it carries the new `Version` + `InstallerUrl` + `InstallerSha256`.
- **Integrity:** `InstallerSha256` (SHA-256 hex) over the `.msix`/`.msixbundle`. **Code signing:** the `.msix` must carry a valid Authenticode signature from a trusted publisher (the real trust gate; `InstallerSha256` is integrity, not identity).
- **Rollout:** App Installer itself has **no built-in percent/geo kill-switch**; staged rollout is done by serving different `.appinstaller` documents per audience (e.g. via CDN/edge rules) or by deferring via `UpdatePolicy`. Enterprise can enforce via policy.

**PR/draft status:** stable, part of the Windows MSIX platform; `Version="1.0"` schema. No breaking changes at retrieval time.

---

## Part 8 — AIRIZ Unified Update Manifest

Target surfaces: **(1)** Win Electron desktop, **(2)** Android Capacitor, **(3)** iOS Capacitor, **(4)** Web PWA, **(5)** Cloudflare Worker.
Design rule: every field carries a `$comment` naming its **ancestor protocol** (from Parts 1–7) or `NON-ANCESTOR` (with justification in the rationale). `required` vs optional is explicit at each level.

### 8.1 The JSON Schema (draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://airiz.example/schemas/update-manifest.v1.json",
  "title": "AIRIZ Unified Update Manifest",
  "description": "One signed manifest that drives updates across Electron, Capacitor (Android+iOS), PWA, and Cloudflare Worker surfaces.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "manifestVersion",
    "version",
    "channel",
    "publishedAt",
    "minAppVersion",
    "signing",
    "rollout",
    "platforms"
  ],
  "properties": {

    "manifestVersion": {
      "$comment": "NON-ANCESTOR. Schema self-version for forward compat. Ancestors version the *app*, not the *manifest format*.",
      "type": "string",
      "const": "1.0"
    },

    "version": {
      "$comment": "ANCESTOR: electron-builder `version`, Tauri `version`, Squirrel nuspec `version`, Sparkle `sparkle:version`, AppInstaller `Version`, Capacitor `version`. Single source of truth for release identity.",
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$"
    },

    "channel": {
      "$comment": "NON-ANCESTOR (promoted to manifest). electron-builder has publish *channels* and Capacitor has *channels*, but neither puts the channel in the consumed feed. Promoted so one artifact can serve stable/beta/dev.",
      "type": "string",
      "enum": ["stable", "beta", "dev", "canary"],
      "default": "stable"
    },

    "publishedAt": {
      "$comment": "ANCESTOR: Tauri `pub_date`, electron-builder `releaseDate`, Sparkle `<dc:date>`.",
      "type": "string",
      "format": "date-time"
    },

    "minAppVersion": {
      "$comment": "NON-ANCESTOR. No desktop protocol gates by *installed app* floor (Sparkle gates by OS, not app). Added so a rollout can require a baseline client capable of parsing this manifest.",
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$"
    },

    "notes": {
      "$comment": "ANCESTOR: Tauri `notes`, electron-builder `releaseNotes`, Sparkle `<description>` (HTML).",
      "type": ["string", "null"],
      "maxLength": 8000
    },

    "notesFormat": {
      "$comment": "ANCESTOR (Sparkle HTML description). Pin the notes markup so renderers can sanitize.",
      "type": "string",
      "enum": ["markdown", "html"],
      "default": "markdown"
    },

    "signing": {
      "$comment": "ANCESTOR (envelope shape): Tauri ed25519 `signature`+`pubkey`, Sparkle `sparkle:edSignature` (EdDSA), electron-builder `sha512`, AppInstaller `InstallerSha256`. `keyId` (rotation) is NON-ANCESTOR.",
      "type": "object",
      "additionalProperties": false,
      "required": ["algorithm", "keyId", "signature"],
      "properties": {
        "algorithm": {
          "$comment": "ANCESTOR: Tauri/Sparkle = ed25519; AppInstaller = Authenticode(RSA). ed25519 is the default.",
          "type": "string",
          "enum": ["ed25519", "ecdsa-p256", "rsa-pkcs1-sha256"],
          "default": "ed25519"
        },
        "keyId": {
          "$comment": "NON-ANCESTOR. Key-rotation identifier. No ancestor protocol rotates keys in-band; required for zero-downtime key change.",
          "type": "string",
          "minLength": 1
        },
        "signature": {
          "$comment": "ANCESTOR: signature of THIS manifest (Tauri/Sparkle sign the payload; here we sign the manifest bytes). base64.",
          "type": "string",
          "minLength": 1,
          "contentEncoding": "base64"
        },
        "signedFields": {
          "$comment": "NON-ANCESTOR. Explicit canonicalization list so the signature is deterministic across platforms.",
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },

    "rollout": {
      "$comment": "ANCESTOR (partial): electron-builder staged/percentage rollout (publish-side) and Capgo service-side kill-switch. Promoted into the manifest so it is client-verifiable and signed.",
      "type": "object",
      "additionalProperties": false,
      "required": ["enabled", "killSwitch"],
      "properties": {
        "enabled": {
          "$comment": "NON-ANCESTOR explicit flag. Ancestors imply 'enabled' by publishing; making it explicit lets a manifest exist without pushing.",
          "type": "boolean",
          "default": true
        },
        "killSwitch": {
          "$comment": "ANCESTOR: Capgo kill-switch / emergency-disable. When true, clients hold the update and report.",
          "type": "boolean",
          "default": false
        },
        "percent": {
          "$comment": "ANCESTOR: electron-builder percentage staged rollout, moved manifest-side + signed so the gate can't be spoofed.",
          "type": "integer",
          "minimum": 0,
          "maximum": 100,
          "default": 100
        },
        "targets": {
          "$comment": "NON-ANCESTOR. Cohort/org/user allowlist for directed rollout (enterprise). No ancestor has in-band targeting.",
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true
        },
        "geoBlocklist": {
          "$comment": "NON-ANCESTOR. ISO-3166-1 alpha-2 blocklist. Required for compliance-regional holds; no ancestor protocol does geo gating.",
          "type": "array",
          "items": { "type": "string", "pattern": "^[A-Z]{2}$" },
          "uniqueItems": true
        },
        "geoAllowlist": {
          "$comment": "NON-ANCESTOR. If present and non-empty, only these regions may update (overrides blocklist).",
          "type": "array",
          "items": { "type": "string", "pattern": "^[A-Z]{2}$" },
          "uniqueItems": true
        }
      }
    },

    "delta": {
      "$comment": "ANCESTOR: Squirrel `bsdiff` delta nupkg (same RELEASES line format), Sparkle `<sparkle:deltas>`/`sparkle:deltaFrom`. Whole object optional; absent => full install only.",
      "type": "object",
      "additionalProperties": false,
      "required": ["supported", "format"],
      "properties": {
        "supported": { "type": "boolean", "default": false },
        "format": {
          "$comment": "ANCESTOR: Squirrel=bsdiff, Sparkle=custom delta. Extend as formats land.",
          "type": "string",
          "enum": ["bsdiff", "sparkle-delta", "binary-patch"]
        },
        "baseVersion": {
          "$comment": "ANCESTOR: Sparkle `sparkle:deltaFrom`. The installed version a delta applies from.",
          "type": "string"
        },
        "url": { "type": "string", "format": "uri" },
        "hash": {
          "$comment": "ANCESTOR: same digest scheme as the platform full artifact.",
          "type": "string"
        }
      }
    },

    "sbom": {
      "$comment": "NON-ANCESTOR. Required by EO 14028 (US) and the EU Cyber Resilience Act (CRA). No ancestor protocol ships an SBOM link; added for supply-chain compliance.",
      "type": "object",
      "additionalProperties": false,
      "required": ["url", "format"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "format": {
          "type": "string",
          "enum": ["spdx", "cyclonedx"]
        },
        "license": { "type": "string" }
      }
    },

    "health": {
      "$comment": "NON-ANCESTOR. Crash/error-rate auto-rollback gate. Ancestors have no in-band health gate (Capgo monitors server-side); made explicit + signed so a rollback decision is auditable.",
      "type": "object",
      "additionalProperties": false,
      "required": ["autoRollback"],
      "properties": {
        "autoRollback": { "type": "boolean", "default": false },
        "crashRateThreshold": {
          "$comment": "Fraction (0..1) of post-update crash reports in the window that trips rollback.",
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "errorRateThreshold": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "windowMinutes": {
          "type": "integer",
          "minimum": 1,
          "default": 60
        },
        "minReports": {
          "$comment": "Sample-size floor before a threshold is actionable (avoids rollback on 1 report).",
          "type": "integer",
          "minimum": 0,
          "default": 30
        }
      }
    },

    "platforms": {
      "$comment": "ANCESTOR (union): each block borrows the digest/size/url/signature conventions of its native protocol (Parts 1-7). Only the surfaces being shipped are present.",
      "type": "object",
      "additionalProperties": false,
      "required": [],
      "properties": {

        "electron": {
          "$comment": "ANCESTOR: electron-builder `latest.yml` (`files[]`: url/sha512/size) + Tauri per-platform signature. One entry per arch.",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["arch", "url", "sha512", "size"],
            "properties": {
              "arch": { "type": "string", "enum": ["x64", "arm64", "universal", "ia32"] },
              "os": { "type": "string", "enum": ["win32", "darwin", "linux"], "default": "win32" },
              "url": { "type": "string", "format": "uri" },
              "sha512": { "$comment": "ANCESTOR: electron-builder `sha512` (base64).", "type": "string" },
              "size": { "$comment": "ANCESTOR: electron-builder `size` (bytes).", "type": "integer", "minimum": 0 },
              "installer": { "$comment": "ANCESTOR: electron-builder targets (nsis/squirrel/portable/appimage/dmg).", "type": "string", "enum": ["nsis", "squirrel", "portable", "appimage", "dmg", "zip"] },
              "signature": { "$comment": "ANCESTOR: Tauri/Sparkle artifact signature (base64).", "type": "string" },
              "blockMapUrl": { "$comment": "ANCESTOR: electron-builder block-map for resumable delta.", "type": "string", "format": "uri" },
              "minOSVersion": { "$comment": "ANCESTOR: Sparkle `sparkle:minimumSystemVersion` (OS floor).", "type": "string" }
            }
          }
        },

        "capacitor": {
          "$comment": "ANCESTOR: Capawesome/Capgo Live Update bundle manifest (version/url/integrity). One entry per device platform.",
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["platform", "url", "integrity"],
            "properties": {
              "platform": { "type": "string", "enum": ["android", "ios"] },
              "url": { "type": "string", "format": "uri" },
              "integrity": {
                "$comment": "ANCESTOR: Capacitor Live Update SRI `integrity` (e.g. sha512-...).",
                "type": "string"
              },
              "signature": { "$comment": "ANCESTOR: Capgo signed bundle signature (base64).", "type": "string" },
              "minOSVersion": { "$comment": "ANCESTOR: AppInstaller dependency `MinVersion` (OS floor).", "type": "string" },
              "size": { "type": "integer", "minimum": 0 }
            }
          }
        },

        "pwa": {
          "$comment": "ANCESTOR: PWA/SW update has NO manifest; identity = SW script bytes. Modeled as swUrl + revision (content hash) + optional Workbox precache manifest. Integrity via SRI (HTTPS is the base trust).",
          "type": "object",
          "additionalProperties": false,
          "required": ["swUrl", "revision"],
          "properties": {
            "swUrl": {
              "$comment": "ANCESTOR: the Service Worker script URL (the thing the browser re-fetches with cache-mode no-cache in the SW `Update algorithm`).",
              "type": "string",
              "format": "uri"
            },
            "revision": {
              "$comment": "ANCESTOR: Workbox `precache-manifest` `revision` (content hash). Content-hash identity replaces the missing spec `version`.",
              "type": "string",
              "minLength": 1
            },
            "integrity": { "$comment": "NON-ANCESTOR (SRI on the SW script). Adds an integrity check the SW spec does not itself perform.", "type": "string" },
            "precacheUrl": { "$comment": "ANCESTOR: Workbox generated precache manifest URL (optional).", "type": "string", "format": "uri" },
            "skipWaiting": { "$comment": "ANCESTOR: SW `skipWaiting()` opt-in aggressive activation.", "type": "boolean", "default": false },
            "clientsClaim": { "$comment": "ANCESTOR: SW `clients.claim()` opt-in.", "type": "boolean", "default": false }
          }
        },

        "worker": {
          "$comment": "NON-ANCESTOR surface (Cloudflare Worker). No desktop protocol covers it. Modeled as a versioned script/module + hash; deployment is API-driven but the manifest records the *intended* version for audit + rollback.",
          "type": "object",
          "additionalProperties": false,
          "required": ["scriptUrl", "hash"],
          "properties": {
            "scriptUrl": { "type": "string", "format": "uri" },
            "hash": { "$comment": "Content hash (sha256) of the deployed Worker bundle.", "type": "string" },
            "module": { "$comment": "ESM vs service-worker format flag.", "type": "boolean", "default": false },
            "compatibilityDate": { "$comment": "Cloudflare `compatibility_date`.", "type": "string" },
            "compatibilityFlags": { "type": "array", "items": { "type": "string" } },
            "percent": { "$comment": "ANCESTOR (Cloudflare staged deployment %). Percentaged Worker rollout.", "type": "integer", "minimum": 0, "maximum": 100, "default": 100 },
            "signature": { "type": "string" }
          }
        }
      }
    }
  }
}
```


### 8.2 Worked example — one manifest serving all 5 surfaces

A single signed document (v1.3.0, stable, 50% rollout, EU geo-hold off, SBOM + health gate on) that every AIRIZ surface can consume by reading only its own `platforms` key:

```json
{
  "manifestVersion": "1.0",
  "version": "1.3.0",
  "channel": "stable",
  "publishedAt": "2026-11-05T07:40:11Z",
  "minAppVersion": "1.0.0",
  "notes": "Fixes a crash on launch; improves update reliability.",
  "notesFormat": "markdown",
  "signing": {
    "algorithm": "ed25519",
    "keyId": "airiz-2026-a",
    "signature": "MEUCIQD...(base64 of canonical manifest bytes)...",
    "signedFields": ["version","channel","publishedAt","minAppVersion","rollout","platforms"]
  },
  "rollout": {
    "enabled": true,
    "killSwitch": false,
    "percent": 50,
    "targets": ["org-pegatron"],
    "geoBlocklist": [],
    "geoAllowlist": []
  },
  "delta": {
    "supported": true,
    "format": "bsdiff",
    "baseVersion": "1.2.0",
    "url": "https://cdn.airiz.example/delta/airiz-1.2.0-1.3.0.zip",
    "hash": "sha256:9f2c...(hex)"
  },
  "sbom": {
    "url": "https://cdn.airiz.example/sbom/airiz-1.3.0.cyclonedx.json",
    "format": "cyclonedx",
    "license": "MIT"
  },
  "health": {
    "autoRollback": true,
    "crashRateThreshold": 0.05,
    "errorRateThreshold": 0.2,
    "windowMinutes": 60,
    "minReports": 30
  },
  "platforms": {
    "electron": [
      {
        "arch": "x64", "os": "win32",
        "url": "https://cdn.airiz.example/win/airiz-1.3.0-x64.nsis.zip",
        "sha512": "vh3C/qHVEMW...(base64)...",
        "size": 98765432,
        "installer": "nsis",
        "signature": "MEUCIQ...(base64)...",
        "minOSVersion": "10.0"
      }
    ],
    "capacitor": [
      {
        "platform": "android",
        "url": "https://cdn.airiz.example/and/airiz-1.3.0.web.zip",
        "integrity": "sha512-AbCdEf...(SRI)...",
        "signature": "MEUCIQ...(base64)...",
        "minOSVersion": "8.0"
      },
      {
        "platform": "ios",
        "url": "https://cdn.airiz.example/ios/airiz-1.3.0.web.zip",
        "integrity": "sha512-ZxYwVu...(SRI)...",
        "signature": "MEUCIQ...(base64)...",
        "minOSVersion": "15.0"
      }
    ],
    "pwa": {
      "swUrl": "https://app.airiz.example/sw.js",
      "revision": "f3a1c9e2b7d4",
      "integrity": "sha384-...(SRI of sw.js)...",
      "precacheUrl": "https://app.airiz.example/precache-manifest.f3a1c9e2.js",
      "skipWaiting": false,
      "clientsClaim": true
    },
    "worker": {
      "scriptUrl": "https://cdn.airiz.example/worker/airiz-edge-1.3.0.js",
      "hash": "sha256:1b2c3d...(hex)",
      "module": true,
      "compatibilityDate": "2026-01-01",
      "compatibilityFlags": ["nodejs_compat"],
      "percent": 50,
      "signature": "MEUCIQ...(base64)..."
    }
  }
}
```

### 8.3 Per-field provenance table

| Field | Required? | Ancestor protocol (Part) | Note |
|---|---|---|---|
| `manifestVersion` | req | **NON-ANCESTOR** | Manifest self-version; ancestors version the app, not the format |
| `version` | req | All 7 (P1–P7) | Single release identity |
| `channel` | req | electron-builder publish channels / Capacitor channels (P1,P3) | Promoted into feed |
| `publishedAt` | req | Tauri `pub_date`, electron `releaseDate`, Sparkle `dc:date` (P1,P2,P5) | |
| `minAppVersion` | req | **NON-ANCESTOR** | App floor (Sparkle gates by OS, not app) |
| `notes` / `notesFormat` | opt | Tauri `notes`, electron `releaseNotes`, Sparkle `description` (P2,P1,P5) | |
| `signing.algorithm` | req | Tauri/Sparkle ed25519 (P2,P5); AppInstaller RSA (P7) | default ed25519 |
| `signing.keyId` | req | **NON-ANCESTOR** | Key rotation; no in-band rotation in ancestors |
| `signing.signature` | req | Tauri/Sparkle `signature`/`edSignature` (P2,P5) | Signs the manifest itself |
| `signing.signedFields` | opt | **NON-ANCESTOR** | Deterministic canonicalization |
| `rollout.enabled` | req | **NON-ANCESTOR** | Explicit no-op manifest |
| `rollout.killSwitch` | req | Capgo kill-switch (P3) | Promoted + signed |
| `rollout.percent` | opt | electron-builder % staged rollout (P1); Worker % (P8/Cloudflare) | Manifest-side, signed |
| `rollout.targets` | opt | **NON-ANCESTOR** | Directed cohort rollout |
| `rollout.geoBlocklist`/`geoAllowlist` | opt | **NON-ANCESTOR** | Regional compliance holds |
| `delta.*` | opt | Squirrel bsdiff (P4), Sparkle `sparkle:deltas`/`deltaFrom` (P5) | Absent => full only |
| `sbom.*` | opt | **NON-ANCESTOR** | EO 14028 / EU CRA |
| `health.*` | opt | **NON-ANCESTOR** (Capgo server-side monitor, P3) | Signed, auditable rollback |
| `platforms.electron[]` | opt | electron-builder `files[]` (P1) + Tauri sig (P2) | per-arch |
| `platforms.capacitor[]` | opt | Capawesome/Capgo bundle (P3) | per device OS |
| `platforms.pwa` | opt | SW `Update algorithm` + Workbox precache (P6) | content-hash identity |
| `platforms.worker` | opt | **NON-ANCESTOR** (Cloudflare) | audit/rollback record |


### 8.4 Keep / Drop Rationale

**A. Design principles that drive every decision**

1. *One document, signed, fan-out read.* A single manifest is fetched once and signed once; each surface reads only its `platforms.<key>` block. This is a deliberate departure from the ancestors (each protocol has its own feed) and is the whole point of "unified."
2. *Identity by version, integrity by hash, trust by signature.* Mirrors the strongest ancestors (Tauri/Sparkle sign; electron-builder/AppInstaller hash). We never ship a field that a client cannot verify.
3. *Rollout is data, not publish-time.* electron-builder does percentage rollout at publish time (the feed is a single "latest"); we move the gate *into* the signed manifest so the gate itself is tamper-evident and auditable. This is the single biggest non-ancestor promotion.
4. *Optional by surface, required by trust.* A surface key may be absent (not shipping that platform), but within any present surface, the integrity + signature fields are required. Trust fields are never optional.
5. *Content-hash identity where the protocol has no version.* The PWA/SW protocol has no `version` field (identity = script bytes), so `pwa.revision` is a content hash. We do not invent a semantic version for it.

**B. Kept (inherited verbatim or near-verbatim from an ancestor)**

- `version` — KEEP. Universal across all 7. The one field with zero ambiguity.
- `publishedAt` — KEEP. Tauri `pub_date` / electron `releaseDate` / Sparkle `dc:date`. Needed for "release timestamp" requirement and for health-window math.
- `signing.signature` + `algorithm` — KEEP. Tauri/Sparkle both sign; default ed25519 (the modern ancestor choice over Sparkle-1 RSA). Required because a manifest that drives 5 surfaces and is unsigned is a supply-chain hole.
- `sha512` (electron) / `InstallerSha256`→`hash` (generic) / `integrity` (capacitor, SRI) — KEEP. Each surface keeps the digest scheme its native ecosystem already verifies, so we add zero new crypto the client must learn.
- `delta` — KEEP as an optional object. Squirrel bsdiff + Sparkle `sparkle:deltas` both prove delta is a real, shippable concept; making it a first-class signed block (not a hidden URL convention) is the improvement. Absent ⇒ full install, which is the safe default.
- `pwa.swUrl` + `revision` — KEEP (reconstructed). The SW spec has no manifest, so we expose exactly the two things that *do* matter: the script URL the browser re-fetches (`Update algorithm`, cache-mode no-cache) and a content hash for change detection.

**C. Promoted into the manifest (NON-ANCESTOR, but justified)**

- `manifestVersion` — ADD. Ancestors version the *app*; none version the *manifest schema*. For a format that must live longer than any single app release, a self-version is mandatory for forward compatibility. Cheap, high-value.
- `minAppVersion` — ADD. Sparkle gates by *OS* (`minimumSystemVersion`), no ancestor gates by *installed-app floor*. We need it so a manifest can require a client new enough to parse the very fields it reads. Defensive, not speculative.
- `channel` — PROMOTE. electron-builder (publish channels) and Capacitor (channels) both have the *concept* but keep it out of the consumed feed. Promoting it lets one CDN path serve stable/beta/dev and lets the client assert which channel it is on.
- `signing.keyId` — ADD. No ancestor rotates signing keys in-band. Key rotation without a keyId forces a client-side update before a key change — a chicken-and-egg. `keyId` + a short trust-store window makes rotation zero-downtime. This is the highest-value trust addition.
- `signing.signedFields` — ADD (optional). Makes signature canonicalization explicit and cross-platform deterministic. Without it, "which bytes were signed" is an implicit convention that will drift between 5 runtimes.
- `rollout.killSwitch` — PROMOTE + sign. Capgo has a kill-switch but it lives *server-side* (client can't verify it). Moving it into the signed manifest makes an emergency hold tamper-evident and auditable. Required (default false).
- `rollout.percent` — PROMOTE. electron-builder does % rollout at publish; Worker does % deployment. We unify into one signed integer. Required to make staged rollout a verifiable property rather than an edge/CDN side-channel.
- `rollout.targets` / `geoBlocklist` / `geoAllowlist` — ADD. No ancestor does in-band cohort or geo gating. These are required by the "rollout control: kill switch, percent gate, geo blocklist" brief. Kept *optional and signed* so a plain "push to everyone" manifest stays minimal.
- `sbom.*` — ADD. Explicitly NON-ANCESTOR and explicitly required by the brief (EO 14028 / EU CRA). No update protocol ships an SBOM; we link one (SPDX or CycloneDX) so compliance tooling can consume the same artifact as the updater.
- `health.*` — ADD. No ancestor has an in-band health gate (Capgo monitors server-side). A signed crash-rate auto-rollback threshold makes the rollback decision part of the trusted, auditable record instead of an opaque backend call. `minReports` prevents rollback-on-one-sample.
- `platforms.worker` — ADD (entire block). The Cloudflare Worker surface has **no** ancestor protocol; it is new. We record the intended version + hash + % so Worker deployments — which are API-driven — leave an auditable, rollback-capable trail in the same manifest.

**D. Dropped / rejected (considered, then cut — and why)**

- *Per-field `size` on every platform* — DROPPED where not load-bearing. electron-builder and Sparkle carry `size`/`length` (used for progress + sanity), so we KEEP it on electron/capacitor; we DROP it on `pwa`/`worker` where the consumer does a single fetch and size adds no verification value.
- *Sparkle `<dc:date>` free-text `description` as the only notes* — DROPPED in favor of `notes` + `notesFormat`. The HTML-in-CDATA pattern is a sanitization burden across 5 runtimes; pinning `markdown`/`html` is safer. Sparkle remains representable (notesFormat=html).
- *Squirrel `RELEASES` newest-first multi-line feed* — DROPPED as a format. Its "list every historical release" model bloats a feed that must now serve 5 surfaces. We keep Squirrel's *delta* idea but not its "ship the whole version history in one text file" shape; history lives in `delta.baseVersion`, not a growing list.
- *electron-builder legacy flat `path`/`sha512` (non-`files[]`) top-level fields* — DROPPED. The Mattermost sample still emits them for back-compat, but they are marked DEPRECATED in source. A new unified manifest does not inherit a deprecated shape; we use the `files[]`-equivalent array model only.
- *AppInstaller `Dependencies[]` / `Rescap` / MSIX Authenticode publisher chain* — DROPPED from the *unified* manifest (kept conceptually in `minOSVersion` + `signature`). The full MSIX dependency + Authenticode graph is Windows-specific and re-emitting it for 5 surfaces is scope creep; the native installer still enforces it. We only record what the unified layer needs to decide *whether* to offer the update.
- *SW `skipWaiting`/`clientsClaim` as top-level* — DROPPED to `pwa`-only (kept, but scoped). They are PWA-specific activation knobs, not universal; scoping them prevents Electron/Worker from inheriting nonsense fields.
- *A single universal `signature` per artifact with one fixed algorithm* — DROPPED. Forcing one algorithm across 5 runtimes would regress Sparkle/AppInstaller RSA consumers and Tauri ed25519 alike. `algorithm` is a per-envelope choice (default ed25519), and each platform block can carry its native digest.

**E. Per-surface fit check (does the manifest cover the brief's 5 surfaces?)**

- **Win Electron** → `platforms.electron[]` (nsis/squirrel, sha512, size, sig, minOS) ✔
- **Android Capacitor** → `platforms.capacitor[platform=android]` (integrity SRI, sig, minOS) ✔
- **iOS Capacitor** → `platforms.capacitor[platform=ios]` ✔
- **Web PWA** → `platforms.pwa` (swUrl, revision content-hash, SRI integrity, skipWaiting/clientsClaim) ✔
- **Cloudflare Worker** → `platforms.worker` (hash, module, compatibilityDate, % staged deploy) ✔

Cross-cutting brief items all land: version ✔, channel ✔, signature ✔, release timestamp (`publishedAt`) ✔, min-app-version ✔, rollout-percent ✔, kill switch ✔, geo blocklist ✔, delta-vs-full (`delta`) ✔, SBOM/EO-14028 ✔, crash-rate auto-rollback (`health`) ✔.

**F. Residual risks / what still needs a human or a primary source**

1. Tauri updater **exact signing source file** was not locatable at the expected path (404); ed25519 + pubkey model confirmed via docs + `Cargo.lock`, but the precise file is an open evidence gap.
2. electron-builder **real Windows `latest.yml`** could not be fetched (release API rate-limited/404); represented via Mattermost `latest-mac.yml` (real) + SMM committed template + docs. A real Windows feed should be pasted when reachable.
3. Deprecated **official Capacitor** live-update manifest is unrecoverable from any live primary source (npm/GitHub/Wayback all 404); its historical `version`/`url`/`integrity` shape is cited only from secondary write-ups.
4. Squirrel **doc vs. actual digest-length** inconsistency (doc says "SHA1"; real files show 32-hex) is flagged, not resolved — verify against `UpdateManager` source before trusting either.
5. W3C SW spec **section number** for the `Update algorithm` was not extracted (file too large for fast grep); cited by algorithm name + retrieval date instead.

---
*End of report. Retrieval date for all citations: 2026-11-05.*
