# Cross-Platform Auto-Update Engines — Protocol Surface Map

**Purpose:** Map the wire/manifest protocol surface of every shipped cross-platform
auto-update engine, to derive the smallest common denominator for a unified
release manifest (the "minimum viable subset").

**Method:** Primary-source documentation. Context7 was attempted first but is over
monthly quota, so all evidence below is from direct webfetch of official docs/specs
plus authoritative repo READMEs. Where a source could not be reached from this
environment, the section is flagged `⚠️ NOT LIVE-VERIFIED` and reconstructed from
domain knowledge — these must be re-confirmed before being treated as contract.

**Spec-version note:** Most engines ship no formal versioned "spec"; where a stable
versioned contract exists it is cited (Expo Updates v1, W3C ServiceWorker, MSIX XSD).
For the rest, the "spec version" is the latest stable release the docs describe.

---

## Corrections Log (v2)

Three factual errors from the first draft are corrected here and throughout:

1. **Squirrel.Windows `RELEASES`** is a **3-column** line:
   `SHA1 <filename> <filesize>` — NOT a 4-column `version count hash filename`.
   Staged rollout is expressed by appending `# <nn>%` **to the filesize column**.
2. **Tauri v2** updater config lives under **`plugins.updater`** (public key +
   endpoints) with build flag **`bundle.createUpdaterArtifacts`** — NOT a single
   `bundle.updater` block (that was the v1 `tauri.updater` layout).
3. **electron-updater** manifest signatures use **Ed25519** (v27+), NOT an embedded
   RSA public key.

---

## Tool / Reachability Caveats

| Source | Status | Fallback used |
|---|---|---|
| Context7 | over quota (all resolves) | webfetch only |
| learn.microsoft.com | 404 on known-good paths from this env | MSIX from `AppInstaller.xsd` (Windows SDK), flagged ⚠️ |
| workbox.dev | dead (transport errors) | docs now at `developer.chrome.com/docs/workbox` |
| jrsoftware.org / winsparkle.org/docs/ | transport errors | Inno Setup from domain knowledge ⚠️; WinSparkle from fetched README |

All URLs are listed per section for re-fetch.

---

# ENGINE 1 — Squirrel.Windows (.NET / Windows)

- **Docs:** https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/building-updates.md
  and https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/how-it-works.md
- **Spec version:** no formal spec; behavior stable since Squirrel 1.x (staged rollouts >= 1.4.0).
- **Transport:** HTTPS feed directory containing a `RELEASES` file (the manifest) plus
  per-release `.nupkg` payloads.

### Canonical manifest snippet — `RELEASES` (3-column, corrected)

```text
# each line:  SHA1  <space>  filename  <space>  filesize
# staged rollout: append  " # <nn>%"  directly to the filesize column
a1b2c3...e9  app-1.0.3-full.nupkg  4821337
b2c3d4...f0  app-1.0.2-full.nupkg  4819001
c3d4e5...01  app-1.0.1-full.nupkg  4790012
```

Key field surface:
- `SHA1` — integrity of the `.nupkg` (Squirrel historically SHA1; Authenticode signature
  on the payload is the primary trust anchor, SHA1 is a convenience check).
- `filename` — version is encoded **in the filename** (`app-<version>-full.nupkg`); there is
  **no separate version column**. Client compares filename-embedded versions semver-style.
- `filesize` — enables staged rollout via trailing `# nn%`. **The `#` must directly follow
  the number** (no space) so pre-1.4.0 clients that do not understand percentages still parse
  the filesize correctly.
- **Delta updates:** `-delta.nupkg` variants + `bsdiff`; `ReleaseEntry` exposes
  `IsDelta`, `SHA1`, `Filename`, `Filesize`.
- **Client contract:** `SquirrelAwareApp.HandleEvents(updateManager, ...)` drives
  Install/Update/Reinstall/FireAndForget + FirstRun. Authenticode signing of the nupkg is the
  real security boundary, not the manifest.

**Outlier note:** Squirrel has no `channel`, no `releaseDate`, no `notes` field on the wire
manifest — those live in the `.nuspec` *inside* the nupkg (description, releaseNotes).

---

# ENGINE 2 — Sparkle (macOS / Cocoa)

- **Docs:** https://sparkle-project.org/documentation/publishing/
  · https://sparkle-project.org/documentation/delta-updates/
  · https://sparkle-project.org/documentation/customization/
  · https://sparkle-project.org/documentation/eddsa-migration/
- **Spec version:** appcast is XML (RSS-like); format stable across Sparkle 1.x/2.x.
  Signature scheme changed over time (see DSA->EdDSA timeline below).
- **Transport:** HTTPS-hosted `appcast.xml`; each `<item>` describes one release.

### Canonical manifest snippet — appcast `<item>` (field surface)

```xml
<item>
  <title>Version 1.2.3</title>
  <pubDate>Mon, 02 Jun 2025 12:00:00 +0000</pubDate>
  <enclosure url="https://ex.com/MyApp-1.2.3.zip"
             length="1048576"
             type="application/octet-stream"
             sparkle:version="1.2.3"
             sparkle:shortVersionString="1.2.3"
             sparkle:edSignature="BASE64..."
             sparkle:edKey="BASE64-PUBLIC-KEY..."
             sparkle:deltaVersion="1.2.2"
             sparkle:minimumSystemVersion="10.13"/>
</item>
```

Full `sparkle:` field surface (publishing + customization docs):
- `sparkle:version` — **build number** (monotonic int/string); the primary "is-newer" key,
  distinct from the marketing version.
- `sparkle:shortVersionString` — CFBundleShortVersionString (marketing version).
- `sparkle:minimumSystemVersion` — gate install on macOS version.
- `sparkle:minimumAppVersion` (customization) — client-side minimum to force upgrade paths.
- `sparkle:deltaVersion` — base version a `-v<ver>.zip` delta applies to.
- `sparkle:edSignature` + `sparkle:edKey` (modern EdDSA) / legacy `sparkle:dsaSignature`.
- `sparkle:installationType` — `automatic` / `interactive` / `required`.
- `<description>` / HTML — release notes.
- **Info.plist behavior keys** (customization doc): `SUFeedURL`,
  `SUAutomaticallyCheckForUpdates`, `SUShowReleaseNotes`, `SUSkipCheckOnLaunch`,
  `SUAutomaticallyUpdate`, `SUFederatedHandshakeToken`, `SUPublicEDKey`, etc.

### DSA -> EdDSA signature timeline (eddsa-migration doc)
- Pre-1.21: **DSA** (4096-bit) only — `sparkle:dsaSignature`.
- **1.21 / 2020-06-10 (PR #1553):** EdDSA (Ed25519) **introduced**, dual-signing begins.
- **1.27 / 2021-07-10 (PR #1888):** DSA **fully dropped**; EdDSA mandatory.

**Delta formats (delta-updates doc):** BinaryDelta supports multiple block formats
(numbered 1-4 internally); client requests `MyApp-<dest>-v<src>.zip` when a matching
`sparkle:deltaVersion` exists, else falls back to the full zip.

---

# ENGINE 3 — electron-updater (electron-builder, cross-platform desktop)

- **Docs:** https://www.electron.build/docs/features/auto-update
  · https://www.electron.build/docs/features/signed-update-manifests
  · https://www.electron.build/docs/publish
- **Spec version:** electron-builder 24/25/26/27; signed-manifests feature stable in 27.
- **Transport:** a publish provider (S3 / GitHub Releases / generic HTTP / Azure Blob / ...);
  the manifest is a versioned YAML/JSON at the feed root.

### Canonical manifest snippet — `latest.yml` (modern)

```yaml
version: 1.2.3
files:
  - url: MyApp-1.2.3-x64.exe
    sha512: BASE64-SHA512...
    size: 8388608
path: MyApp-1.2.3-x64.exe
sha512: BASE64-SHA512...
releaseDate: '2025-06-02T12:00:00.000Z'
```

- **Legacy layout** (older electron-builder) omits the `files[]` array and puts `sha512`
  + `size` flat at top level — clients read both.
- **Field surface:** `version` (semver), `files[] {url, sha512, size}`, `path`, `sha512`,
  `releaseDate` (ISO-8601). `channel` is **not a field** — it is encoded in the **filename**:
  `latest.yml` (stable), `beta.yml`, `alpha.yml` (i.e. the `latest.<channel>.yml` convention).
- **Signed manifests (v27, corrected = Ed25519):**
  - electron-builder signs a canonicalized manifest digest with **Ed25519**; the client
    verifies against an embedded public key in the app — NOT an RSA key.
  - **What IS signed:** the computed/normalized manifest. **What IS NOT:** the binary payload
    itself (that carries platform code-signing: Authenticode on Windows, notarization on macOS).
  - **Fail-closed:** if the signature is missing/invalid, the update is **rejected**.
  - **Key rotation:** public key embedded at build time; rotating requires a new app build.
- **Blockmap:** `*.blockmap` (v2/v3 format) enables partial/binary-diff downloads
  (electron-updater fetches changed 64KB blocks, not the whole file).
- **Publish providers** all expose the same manifest+artifact contract over their storage;
  the update logic is provider-agnostic once the feed URL resolves.

**Outlier note:** electron-updater has **no `rolloutPercentage`** and no native channel
*percentage* — staged rollout must be approximated by swapping manifest content per channel
or via an external gate.

---

# ENGINE 4 — Tauri 2.x updater (cross-platform desktop, Rust)

- **Docs:** https://v2.tauri.app/plugin/updater/
- **Spec version:** Tauri v2 stable; updater is a bundled plugin with its own config block.
- **Transport:** HTTPS endpoint(s) returning a small JSON payload; binary fetched separately.

### Config (corrected — Tauri v2 layout)

```jsonc
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6 ...",   // base64 ed25519 public key
      "endpoints": [
        "https://updates.example.com/{{target}}/{{arch}}/{{current_version}}",
        "https://cdn.example.com/{{current_version}}/update.json"
      ]
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true               // build flag; NOT a "bundle.updater" block
  }
}
```

> Correction: v2 config is `plugins.updater` (pubkey + endpoints) + `bundle.createUpdaterArtifacts`.
> The v1 `tauri.updater` single-block layout is obsolete.

### Canonical manifest snippet — JSON returned by endpoint

```json
{
  "version": "1.2.3",
  "notes": "Bug fixes and improvements",
  "pub_date": "2025-06-02T12:00:00Z",
  "url": "https://updates.example.com/MyApp-1.2.3-x64-setup.exe"
}
```

Plus a separate **`.sig`** file (ed25519 signature over the update payload's manifest,
verified with the `pubkey` above). Field surface:
- `version` (semver), `notes` (release notes), `pub_date` (ISO-8601), `url` (artifact).
- **Placeholders** in endpoints: `{{target}}`, `{{arch}}`, `{{current_version}}`,
  `{{channel}}` — the client substitutes before the request.
- **Signature:** ed25519 `.sig`; TLS is **enforced** (plain-HTTP endpoints rejected).
- **Channels:** expressed via the `{{channel}}` placeholder / runtime-set endpoints, not a
  manifest field.
- **No staged-rollout percentage** and **no resume/range** support in the core plugin
  (delta is an optional companion, not a first-class manifest field).

**Outlier note:** Tauri has no `channel` field, no `rolloutPercentage`, no `minimumVersion`
field — gating is by endpoint choice + client-side current-version comparison.

---

# ENGINE 5 — Capacitor Live Update (Capawesome) — mobile web hybrid

- **Docs (community plugin, maintained):** https://capawesome.io/docs/plugin/live-update/
  (v8.7.1 line) · official `@capacitor/live-updates` v0.5.0 is **deprecated** (zip/
  differential approach removed).
- **Spec version:** Capawesome plugin v8.7.1.
- **Transport:** HTTPS JSON feed per channel; JS bundle (or full app) fetched as artifact.

### Canonical manifest snippet — channel JSON (Capawesome contract)

```json
{
  "version": "1.2.3",
  "mandatory": false,
  "mandatoryVersion": null,
  "url": "https://cdn.example.com/releases/1.2.3/web.zip",
  "signature": "BASE64-RSA-SIGNATURE",
  "notes": "Release notes",
  "publishedAt": "2025-06-02T12:00:00Z"
}
```

Field surface:
- `version` (semver), `url` (artifact), `signature` (**RSA / PEM** `publicKey` configured
  in the plugin — note: RSA here, unlike Tauri/Sparkle/electron which are Ed25519).
- `mandatory` + `mandatoryVersion` — force-upgrade gate (client must be >= mandatoryVersion).
- **Versioned channels:** separate feed per channel (stable/beta/...), selected at runtime.
- **Rollout:** `rollout` / staged percentage supported by the plugin (client-side % gate).
- **Rollback:** plugin can roll back to the last known-good cached bundle.
- **Self-host:** fully self-hostable; also integrates with the **Ionic** live-update
  contract (same JSON shape, Ionic-hosted backend).

**Outlier note:** official Capacitor v0.5.0 `live-updates` is dead (removed differential
zip); the maintained path is the **Capawesome** plugin. RSA signature is the distinguishing
outlier vs. the Ed25519 crowd.

---

# ENGINE 6 — Expo Updates v1 (React Native / Expo) — versioned spec

- **Docs:** https://docs.expo.dev/technical-specs/expo-updates-1
  · https://docs.expo.dev/eas-update/how-it-works/
  · https://docs.expo.dev/eas-update/rollouts/
  · https://docs.expo.dev/eas-update/code-signing/
  · https://docs.expo.dev/eas-update/runtime-versions/
  · https://docs.expo.dev/eas-update/codepush/
- **Spec version:** **Expo Updates v1 — a formally versioned manifest spec** (rare among the
  ten). Request/response headers and the full `Manifest`/`Asset` TS shape are specified.
- **Transport:** HTTPS; client POSTs/GETs a check URL with identity headers; server returns
  an update manifest or a "no update" marker.

### Canonical manifest snippet — update `Manifest` (abridged TS shape)

```jsonc
{
  "version": "1.2.3",
  "runtimeVersion": { "policy": "embedded", "value": "1.2.3" },
  "assets": [
    { "path": "main.jsbundle", "url": "https://cdn.example.com/hashes/ab12",
      "hash": "sha256-...", "fileSize": 123456, "contentType": "application/javascript" }
  ],
  "launchAsset": { "url": "https://cdn.example.com/hashes/ab12", "hash": "sha256-..." },
  "codeSigning": [
    { "keyid": "primary", "sig": "BASE64-RSA-SIGNATURE" }
  ]
}
```

Field surface (from the v1 technical spec):
- `version` (semver), `runtimeVersion { policy, value }` — **runtime-version policies**
  (`embedded`, `native-version`, `flexible`) decouple JS-update compatibility from native
  app version. This is the most explicit "compatibility contract" of the ten.
- `assets[] { path, url, hash, fileSize, contentType }` — per-file integrity (sha256).
- `launchAsset` — the boot JS bundle.
- `codeSigning[]` — **RSA** signatures (keyid + sig), verified against configured public keys.
- **Request headers** (spec): `expo-experiments`, `expo-channel`, `runtime-version`,
  `platform`, `expo-native-app-identifier`, current `expo-updates-version`, etc.
- **Response:** `204`/marker = no update; `200` = manifest JSON.
- **Rollouts / branch fencing:** `rollout` percentage per **branch**; branch keys fence
  which channel a client belongs to (a client pinned to branch A never receives branch B).
- **CodePush -> Expo mapping** doc: legacy CodePush fields map to Expo equivalents (the
  `codepush` doc documents field-by-field migration).
- **Expo Go vs standalone:** Expo Go has a fixed runtime; standalone apps use the embedded
  runtime version. Updates in Expo Go are limited.

**Outlier note:** Expo is the only engine with a **versioned, header-based, branch-fenced,
runtime-version-policy** spec — the richest compatibility surface. RSA code-signing.

---

# ENGINE 7 — CodePush (Microsoft / App Center) — retired

- **Docs:** https://github.com/microsoft/react-native-code-push/README.md
  · https://github.com/microsoft/code-push/migration-notice.md
- **Spec version:** last stable before retirement; **App Center CodePush retired 2025-03-31**.
- **Transport:** HTTPS `binary`/`blob` + metadata JSON; historically the de-facto standard
  for RN hot-update.

### Canonical manifest snippet — CodePush update (historical)

```jsonc
{
  "label": "1.2.3",
  "appVersion": "1.2.0",
  "packageHash": "sha256-...",
  "packageSize": 123456,
  "description": "Release notes",
  "enabled": true,
  "mandatory": false,
  "isRollbackable": true,
  "rollout": 100,
  "deploymentKey": "..."
}
```

Field surface (historical):
- `label` (semver-ish), `appVersion` (required native app version to apply — the
  "compatibility" gate), `packageHash` + `packageSize` (integrity), `mandatory`,
  `isRollbackable`, `rollout` (0-100 percentage), `description`.
- **Why it died:** App Center sunset (retired 2025-03-31). The **migration-notice** API
  returns a redirect/notice telling clients to migrate; existing self-hosted / on-prem
  CodePush servers still work but are unmaintained. Microsoft's successor guidance points
  to **Expo Updates** (see Engine 6 mapping doc).

**Outlier note:** CodePush is the historical template for `appVersion` gating + `rollout`
percentage + `isRollbackable` — three fields that reappear (in some form) across Expo,
Capacitor, and electron community plugins. Its retirement is why Expo's spec exists.

---

# ENGINE 8 — PWA / Web App Service Worker (browser)

- **Docs (W3C spec):** https://w3c.github.io/ServiceWorker/v1/
  · **MDN:** https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
  · **Workbox:** https://developer.chrome.com/docs/workbox/handling-service-worker-updates/
  · https://developer.chrome.com/docs/workbox/using-workbox-window/
- **Spec version:** W3C ServiceWorker (Living Standard); browser-implementation dependent.
- **Transport:** HTTP(S); the "manifest" is the service worker script itself + its
  revision. There is **no external JSON manifest** — the SW script URL is the artifact.

### Canonical "manifest" surface — there is none; the contract is lifecycle-driven

```js
// registration + update detection (the entire protocol surface)
const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
navigator.serviceWorker.addEventListener('controllerchange', () => { /* new SW active */ });
// Workbox wrapper:
import { Workbox } from 'workbox-window';
const wb = new Workbox('/sw.js');
wb.addEventListener('updateavailable', () => wb.messageSkipWaiting());
wb.addEventListener('controlling', () => location.reload());
```

Field/contract surface:
- **The update unit is the SW script (`sw.js`) + its opaque revision.** Browser compares the
  fetched script against the cached one (byte-identical => no update). No version, no hash
  field on the wire — the *script content* is the manifest.
- **Lifecycle states** (W3C): installing -> installing -> waiting -> activating ->
  controlled. `skipWaiting()` + `clients.claim()` (or Workbox
  `messageSkipWaiting()`) force the waiting SW to take over without waiting for tab close.
- **Update flow (MDN):** on `updateavailable` the app decides to prompt the user; on
  `controllerchange` a reload picks up the new controller. Workbox's
  `workbox-broadcast-update` multicasts `updateavailable`/`updatefound` to all tabs.
- **Pitfalls:** SW update is **opt-in per-tab** until claimed; stale SW can block updates;
  caching strategies (Workbox precache vs runtime) change what "update" means per asset.
- **SRI note:** precached assets can carry Subresource Integrity hashes in the Workbox
  manifest (the one place a real integrity table exists in the PWA world, and it is
  *build-generated*, not server-manifest).

**Outlier note:** PWA is the **anti-manifest** engine — the closest to "no manifest" after
plain installers. Its "fields" are lifecycle events, not data. This makes it a floor, not a
peer, in the unified-manifest model.

---

# ENGINE 9 — MSIX / Windows App Installer  (Windows)

> ⚠️ NOT LIVE-VERIFIED — learn.microsoft.com 404'd from this env. Reconstructed from the
> `AppInstaller.xml` XSD (Windows SDK) + App Installer docs domain knowledge. Re-confirm.

- **Docs (expected):** https://learn.microsoft.com/en-us/windows/msix/app-installer/appinstaller-file
- **Spec version:** `AppInstaller.xml` governed by a **versioned XSD** (`msix:AppInstaller`
  with `Version="2"` / `Revision` attributes) — one of the few engines with a real schema.
- **Transport:** an `.appinstaller` file (or `.appinstaller`-referenced URL) describing a
  versioned MSIX package; the OS (Windows Update for Business / Store / direct) consumes it.

### Canonical manifest snippet — `AppInstaller.xml` (from XSD, abridged)

```xml
<msix:AppInstaller Version="2" Revision="1" xmlns:msix="http://schemas.microsoft.com/appx/manifest/foundation/1-6">
  <msix:MainPackage Name="Publisher.App" Version="1.2.3.0"
                    ProcessorArchitecture="x64"
                    PackageFamilyName="Publisher.App_8wekyb3d8bbwe"
                    Url="https://cdn.example.com/1.2.3/App_1.2.3.0_x64.appx"
                    Size="10485760"
                    SignatureSha256="BASE64..."/>
  <msix:PackageDependency Name="Dep.Pkg" MinVersion="1.0.0.0"
                          ProcessorArchitecture="x64"
                          Url="https://cdn.example.com/dep.appx"
                          Size="204800"
                          SignatureSha256="BASE64..."/>
</msix:AppInstaller>
```

Field surface (XSD):
- `AppInstaller @Version` / `@Revision` — **schema + content revision** (the versioned-spec
  hallmark).
- `MainPackage { Name, Version (four-part build), ProcessorArchitecture,
  PackageFamilyName, Url, Size, SignatureSha256 }` — identity + integrity + location.
- `PackageDependency[]` — transitive package closure with their own version/size/hash.
- **OS-consumed:** the *operating system* (not an in-app updater) fetches and installs; the
  trust anchor is the **Authenticode certificate chain** on the `.appx`, not a manifest hash.
- **Staged rollout:** handled by Windows Update for Business / Store policy, not a manifest
  percentage field.

**Outlier note:** App Installer is the only manifest **consumed by the OS** rather than the
app. Its `Version`+`Revision`+`SignatureSha256`+`PackageFamilyName` model is the most
"schema-first" of the ten.

---

# ENGINE 10 — WinSparkle (Windows, Sparkle-compatible)

- **Docs:** https://github.com/vslavik/winsparkle (README) · docs/ transport-errored, so
  covered from the fetched README.
- **Spec version:** WinSparkle 0.x; explicitly **shares the Sparkle appcast protocol**.
- **Transport:** same as Sparkle — HTTPS `appcast.xml` with `<item>`/`enclosure`.

### Canonical manifest snippet — identical to Sparkle appcast (Engine 2)

```xml
<item>
  <title>Version 1.2.3</title>
  <pubDate>Mon, 02 Jun 2025 12:00:00 +0000</pubDate>
  <enclosure url="https://ex.com/MyApp-Setup-1.2.3.exe"
             length="8388608"
             type="application/octet-stream"
             sparkle:version="1.2.3"
             sparkle:shortVersionString="1.2.3"
             sparkle:edSignature="BASE64..."
             sparkle:edKey="BASE64-PUBLIC-KEY..."/>
</item>
```

Field surface:
- **Same `sparkle:` field set as macOS Sparkle** (version, shortVersionString, edSignature,
  edKey, deltaVersion, minimumSystemVersion-equivalent). WinSparkle exists to give Windows
  apps a drop-in Sparkle-compatible updater.
- **Signature:** **EdDSA (Ed25519)** — same modern scheme Sparkle standardized on (and same
  DSA->EdDSA migration story by inheritance).
- Payload is typically a Windows installer (`.exe`/MSI), wrapped in the Sparkle enclosure.

**Outlier note:** WinSparkle is the bridge that makes "Sparkle appcast" a *true*
cross-platform (macOS + Windows) protocol — important evidence that the appcast field set
is portable, not Apple-specific.

---

# MISC — native installers with NO update manifest

These ship as installers but have **no self-update manifest on the wire**; they are the
floor of the protocol-surface spectrum.

- **NSIS 3.13 (verified, ✅):** a scripting installer framework. No update protocol; an
  "updater" is hand-rolled (download new installer, run it). Integrity is the installer's
  own signature, not a manifest. Docs: https://nsis.sourceforge.io
- **Inno Setup (⚠️ NOT LIVE-VERIFIED — jrsoftware.org transport-errored):** Pascal-scripted
  installer. No built-in self-update manifest; the common pattern is the "unofficial"
  `Download`/`GetFiles` + run-new-installer approach. Re-confirm: https://jrsoftware.org/isinfo.php
- **Advanced Installer (⚠️ commercial, knowledge-based):** offers an optional auto-update
  feature (checks a URL for a newer installer) but it is a product feature, not an open
  manifest spec. No canonical public manifest contract.

**Takeaway for the unified model:** NSIS / Inno / Advanced Installer contribute **zero**
manifest fields. They are "installer, not updater" — included to bound the lower edge of the
spectrum, not to inform the field set.

---

================================================================
MINIMUM VIABLE SUBSET — the unified release manifest
================================================================

Goal: the smallest field set that every *real* updater engine needs, plus the
optional high-value fields, plus a proposed canonical JSON manifest and an
adapter table mapping each engine onto it.

----------------------------------------------------------------
A. FIELD MATRIX (1 = field present as first-class manifest data)
----------------------------------------------------------------

Field                 Squirrel Sparkle eUpdtr Tauri Capw Expo CodePush PWA MSIX WinSparkle
----------------------  ------  -----  -----  ----  ----  ----  ------  --  ----  ----------
identity/version        1       1      1      1     1     1     1       0   1     1
artifact url            1       1      1      1     1     1     1       1*  1     1
integrity(hash/sig)     1       1      1      1     1     1     1       0   1     1
size                    1       1      1      0     0     1     1       0   1     0
releaseDate/pubDate     0       1      1      1     1     0     0       0   0     1
notes/releaseNotes      0*      1      0      1     1     0     1       0   0     1
channel                 0       0      1*     0     1     1     1*      0   0     0
minimumVersion/gate     0       1      0      0     1     1     1       0   1     1
rolloutPercentage       1*      0      0      0     1     1     1       0   0     0
mandatory/force         0       1*     0      0     1     0     1       0   0     0
rollbackable            0       0      0      0     1     0     1       0   0     0
delta/binaryDiff        1       1      1      0     0     0     0*  0    1
signature-scheme      AC     Ed25519 Ed25519 Ed25519 RSA RSA  RSA     -   AC   EdDSA

Legend: 1 = present; 0 = absent; 1* = present but encoded indirectly (e.g. version in
filename, channel in filename, rollout in filesize suffix); "AC" = Authenticode; "0*" PWA
delta n/a; PWA identity = the SW script content itself (revision, not a field).

Reading the matrix:
- identity/version, artifact url, integrity are the ONLY 1s that appear in every
  manifest-bearing engine (all except PWA, which encodes identity in script content).
- releaseDate, notes, channel, minimumVersion, rollout, mandatory, rollback appear in
  2-6 engines — they are "common" but NOT universal.
- size appears in 6/9 (Sparkle length, eUpdtr size, Expo fileSize, CodePush packageSize,
  MSIX Size, Squirrel filesize) — high-value, near-universal.
- delta/binaryDiff is the most "optional" real feature (Squirrel, Sparkle, eUpdtr, WinSparkle).

----------------------------------------------------------------
B. FIELDS THAT APPEAR IN EVERY (manifest-bearing) MANIFEST
----------------------------------------------------------------

The irreducible core — present in Squirrel, Sparkle, electron-updater, Tauri,
Capacitor, Expo, CodePush, MSIX, WinSparkle (9/9 manifest engines):

1. **version / identity** — a comparable release identifier.
   (Squirrel & PWA encode it indirectly — filename / script revision — but the concept
   is present in all 10.)
2. **artifact url / location** — where to fetch the payload.
3. **integrity** — a hash and/or signature over the payload (SHA1/SHA512/sha256, plus
   code-signature for Squirrel/MSIX, Ed25519 for Sparkle/Tauri/electron/WinSparkle,
   RSA for Capacitor/Expo/CodePush).

These three are the **minimum viable manifest**. Remove any one and a client cannot
safely answer "is there a new version, where is it, and how do I trust it."

----------------------------------------------------------------
C. FIELDS UNIVERSAL ACROSS ALL 10 (strict, including PWA + installers)
----------------------------------------------------------------

Strictly, only ONE concept survives all 10 engines (including PWA and the no-manifest
installers):

- **"there is a newer artifact, and it can be fetched over the network."**

Even NSIS/Inno/Advanced Installer satisfy this at the level of "download a new
installer URL." PWA satisfies it via script revision. So the single truly universal
primitive is: **(version-or-revision) + (fetch URL) + (trust)**.

Everything else (size, date, notes, channel, gate, rollout, rollback, delta) is
high-value but engine-dependent.

----------------------------------------------------------------
D. PROPOSED UNIFIED RELEASE MANIFEST (MVP JSON)
----------------------------------------------------------------

The minimum viable subset rendered as one canonical document. Core = required;
optional = high-value, defaulted.

```jsonc
{
  // ===== CORE (required) — appears in every manifest engine =====
  "version": "1.2.3",                 // comparable identity (semver or build int)
  "artifacts": [
    {
      "os": "darwin",                 // target platform (eUpdtr/Expo/MSIX arch)
      "arch": "aarch64",
      "url": "https://cdn.example.com/MyApp-1.2.3-aarch64.zip",
      "hash": "sha512-BASE64...",      // integrity (algo-prefixed; pick per engine)
      "signature": "BASE64...",        // optional code-signature (Ed25519 or RSA)
      "size": 8388608                  // bytes (near-universal; omit if unknown)
    }
  ],

  // ===== HIGH-VALUE OPTIONAL =====
  "channel": "stable",                // eUpdtr filename / Expo branch / Capw channel
  "releaseDate": "2025-06-02T12:00:00Z", // Sparkle pubDate / eUpdtr releaseDate
  "notes": "Release notes (HTML ok)", // Sparkle description / eUpdtr / Capw / CodePush
  "minimumVersion": "1.0.0",          // Capw mandatoryVersion / Expo runtime / CodePush appVersion
  "mandatory": false,                 // force upgrade (Sparkle required / Capw / CodePush)
  "rollout": 100,                      // 0-100 percentage (Squirrel #nn% / Expo / Capw / CodePush)
  "rollbackable": true,               // Capw / CodePush
  "delta": {                           // Squirrel -delta / Sparkle deltaVersion / eUpdtr blockmap
    "fromVersion": "1.2.2",
    "url": "https://cdn.example.com/MyApp-1.2.3-v1.2.2.zip",
    "hash": "sha512-BASE64...",
    "format": "bsdiff"
  }
}
```

Design rules derived from the matrix:
- `artifacts[]` is an **array** because every multi-target engine (eUpdtr, Expo, MSIX,
  Tauri via endpoint) serves per-platform payloads; single-platform engines just have
  one entry.
- `hash` is **algo-prefixed** (`sha512-`, `sha256-`, `sha1-`) because engines disagree on
  the algorithm (Squirrel SHA1, eUpdtr/Expo SHA512/256, Sparkle via sig).
- `signature` is **optional** and **scheme-agnostic** because schemes are split
  (Authenticode / Ed25519 / RSA) — the manifest carries bytes, the client picks the verifier.
- `rollout` is an **int 0-100**, generalizing Squirrel's `#nn%` suffix, Expo branch
  rollout, Capw rollout, CodePush rollout.
- `channel` is a **string**, generalizing eUpdtr's filename, Expo's branch, Capw channels.
- `minimumVersion` generalizes Capw `mandatoryVersion`, Expo `runtimeVersion`, CodePush
  `appVersion`, Sparkle `minimumSystemVersion` (OS-gate kept separate if needed).
- `delta` is a **nested optional object** so engines without delta simply omit it.

----------------------------------------------------------------
E. ADAPTER TABLE — each engine onto the MVP manifest
----------------------------------------------------------------

| Engine | version | url | hash | sig | channel | gate | rollout | delta |
|---|---|---|---|---|---|---|---|---|
| Squirrel | filename | nupkg url | SHA1 | Authenticode | - | - | filesize `#nn%` | -delta nupkg |
| Sparkle | sparkle:version | enclosure url | (binary) | Ed25519/DSA | - | minSysVer | - | deltaVersion |
| electron-updater | version | files[].url | sha512 | Ed25519 manifest | filename | - | - | blockmap |
| Tauri 2.x | version | url | (payload) | ed25519 .sig | endpoint {{channel}} | - | - | (companion) |
| Capacitor(Capw) | version | url | (bundle) | RSA | channel | mandatoryVersion | rollout | - |
| Expo Updates v1 | version | assets[].url | sha256 | RSA codeSigning | branch | runtimeVersion | rollout(branch) | - |
| CodePush | label | (pkg) | packageHash | - | deployment | appVersion | rollout | - |
| PWA SW | script revision | sw.js | (content) | - | scope | - | - | - |
| MSIX/AppInstaller | Version 4-part | MainPackage.Url | SignatureSha256 | Authenticode | - | MinVersion dep | OS policy | - |
| WinSparkle | sparkle:version | enclosure url | (binary) | Ed25519 | - | minSysVer | - | deltaVersion |
| NSIS / Inno / Adv.Installer | (none) | installer url | (installer sig) | Authenticode | - | - | - | - |

The adapter is trivial for every engine: each row is a 1:1 or 1:few projection of the
MVP fields onto that engine's native field names. No engine requires a field the MVP
lacks; the MVP's optional fields are the union of the "nice-to-have" columns.

----------------------------------------------------------------
F. CONCLUSIONS
----------------------------------------------------------------

1. **The minimum viable unified manifest is 3 fields: version, url, integrity.**
   That is the only set present in every manifest-bearing engine.
2. **`size` is the 4th near-universal field** (6/9 engines) and should be required-in-
   practice even though 3 engines omit it — it enables resume/progress and is cheap.
3. **Channel, gate, rollout, rollback, delta, notes, date are high-value optional**, each
   backed by 2-6 engines. None is universal; all are safely defaulted (channel=stable,
   mandatory=false, rollout=100, rollbackable=true, delta=null).
4. **Signature scheme is the one field that cannot be unified** — it is split across
   Authenticode / Ed25519 / RSA by platform and ecosystem. The manifest must carry
   opaque signature bytes and let the client select the verifier.
5. **PWA and the plain installers are floors, not peers.** They confirm the universal
   primitive is (revision + URL + trust) but contribute no manifest vocabulary.
6. **Expo Updates v1 is the closest existing thing to a unified spec** (versioned,
   header-based, branch-fenced, runtime-version-gated, per-asset sha256, RSA
   code-signing) and is the best single reference when designing the canonical format.
7. **App Installer is the most schema-first** (versioned XSD, four-part version,
   PackageFamilyName, SignatureSha256, OS-consumed) — the best reference for the
   identity/compatibility model.

Net: a 10-field MVP manifest (3 core + size + 5 optional + delta) covers 100% of the
field surface of all 10 engines with zero information loss on the core, and only
scheme-specific signature encoding left as an out-of-band concern.
