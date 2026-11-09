# Cross-Platform Auto-Update Protocol Survey — AIRIZ Motor Console

> Reference for choosing the smallest signed-manifest schema that all five
> AIRIZ surfaces (Electron Windows, Capacitor Android/iOS, Web PWA,
> Cloudflare Worker) can read.
>
> Sources are canonical upstream repos and the relevant IETF/W3C/Microsoft
> specifications as of 2026-11. Wire formats are quoted verbatim where the
> source is unambiguous; for tools whose wire format is only declared in
> code, the schema is reconstructed from the source.

---

## Table of Contents

1. [electron-updater `latest.yml`](#1-electron-updater-latestyml)
2. [Squirrel.Windows `RELEASES`](#2-squirrelwindows-releases)
3. [Squirrel.Mac](#3-squirrelmac)
4. [Sparkle 2 `appcast.xml`](#4-sparkle-2-appcastxml)
5. [Tauri updater `update.json`](#5-tauri-updater-updatejson)
6. [Capawesome Capacitor Live Update](#6-capawesome-capacitor-live-update)
7. [Capacitor official Live Update (deprecated)](#7-capacitor-official-live-update-deprecated)
8. [Expo Updates v1](#8-expo-updates-v1)
9. [CodePush / App Center (retired)](#9-codepush--app-center-retired)
10. [PWA Service Worker / Workbox](#10-pwa-service-worker--workbox)
11. [Microsoft `.appinstaller`](#11-microsoft-appinstaller)
12. [Unified signed-manifest schema (proposed)](#12-unified-signed-manifest-schema-proposed)
13. [Sufficiency assessment against AIRIZ use cases](#13-sufficiency-assessment-against-airiz-use-cases)
14. [Final unified schema (rev 1)](#14-final-unified-schema-rev-1)

---

## 1. electron-updater `latest.yml`

Source: `electron-userland/electron-builder` monorepo,
`packages/electron-updater/src/AppUpdater.ts`,
`providers/GenericProvider.ts`, `providers/Provider.ts`, `types.ts`
(master, 2026-11).

### Wire format — YAML 1.1

The default Generic provider reads one YAML file per channel:
`latest.yml` (stable), `beta.yml`, `nightly.yml`, or any `<channel>.yml`
set via `setFeedURL({ channel })` or `app-update.yml`. The feed URL is
loaded by `getChannelFilename(channel)` and parsed by `parseUpdateInfo`
(`providers/Provider.ts:197`).

```yaml
# electron-updater latest.yml — exact shape produced by electron-builder publish
version: 1.2.3
releaseDate: "2026-09-12T08:30:00.000Z"           # ISO-8601 UTC, optional but emitted
stagingPercentage: 10                            # 0–100, optional; gated client-side
mandatory: false                                 # optional; >= true forces update
prerelease: false                                # optional; bumps "beta" handling
# path: ...                                     # DEPRECATED single-file form
files:
  - url: MyApp-Setup-1.2.3.exe                   # relative URL resolved against feed base
    sha512: 8f9b...d4                           # base64 SHA-512 of the file body
    # sha2: ...                                 # DEPRECATED SHA-256 legacy field (still read)
    size: 87311564                                # bytes
    blockMapSize: 87311616                        # size of the corresponding .blockmap
    blockMapUrl: MyApp-Setup-1.2.3.exe.blockmap  # relative URL of the VCDIFF metadata
# packages:                                     # Windows-only web installer support
#   x64:
#     path: MyApp-Setup-Web-1.2.3.7z
#     sha512: ...
```

### Channel model

A channel is a name suffix on the YAML file (`getChannelFilename` in
`util.ts`). The base channel is `latest` (empty suffix). Stable releases
land in `latest.yml`, pre-releases in `beta.yml`, etc. The user can
override at runtime via `autoUpdater.channel` setter (`AppUpdater.ts:307`)
which rewrites the channel for subsequent fetches. Per-update
`stagingPercentage` rolls out to a deterministic slice of `x-user-staging-id`
UUIDs (`AppUpdater.ts:682-702`).

### Signature algorithm

electron-updater does NOT sign `latest.yml`. It only validates per-file
SHA-512 (or legacy SHA-256). Real signing is delegated to the OS-level
code-sign pipeline:

- **Windows (NSIS / MSI):** Authenticode signature is verified by
  `defaultVerifyAuthenticodeSignature`
  (`NsisUpdater.ts`, `windowsExecutableCodeSignatureVerifier.ts`).
  Optionally accepts Windows Security Catalog signatures when
  `allowCatalogSignature: true` is set on the entry.
- **macOS (Squirrel.Mac / DMG):** Sparkle-style Ed25519 *appcast*
  signing does not apply; the `.app` itself is signed with Apple's
  code-sign + notarization.

`verifyUpdateFile`/`verifyUpdateFileAuthenticodeSignature` are user
hooks (`types.ts:150-175`); the default trusts the OS.

### Provider abstraction

`Provider<T extends UpdateInfo>` (`providers/Provider.ts:41`) is the
base class. Built-ins:

- `GenericProvider` — any HTTP server returning YAML (default).
- `GitHubProvider` — resolves latest release via GitHub Releases API;
  normalizes release asset URL back to `releases/download/...`.
- `GitLabProvider` — GitLab Releases API.
- `BitbucketProvider` — Bitbucket Downloads.
- `KeygenProvider` — [keygen.sh](https://keygen.sh/) ETJSON.

The Generic provider only uses `latest.yml`. GitHub and GitLab use
their REST API; both still ultimately call
`resolveFiles(updateInfo, baseUrl)` (`providers/Provider.ts:351`) which
expects `files[]` with `sha512`.

### 2025–2026 PRs of note

- `3623` (2025-08) — `autoInstallEvent: "onNextLaunch"` added; persisted
  cached update is re-verified before install (`types.ts:32`,
  `AppUpdater.ts:1353`).
- `3578` / v2.13.2 (Tauri counter-parallel; electron-builder v27+) —
  quarantine/move-on-fail on macOS: failed install no longer deletes
  the installed app; previous app kept as
  `<name> (previous version).app` and reported via
  `ERR_UPDATER_PREVIOUS_APP_NOT_RESTORED`.
- 2026 v27 split: `requestHeaders` and `addAuthHeader` are now sent
  *only* to the feed origin (`AppUpdater.ts:908`); credential leakage
  no longer leaks to every CDN asset URL.

### Minimum viable subset

```yaml
version: "1.2.3"
files:
  - url: MyApp-Setup-1.2.3.exe
    sha512: <base64>
    size: 87311564
```

Everything else (`stagingPercentage`, `blockMapSize`, `packages`,
`releaseDate`, `prerelease`, `mandatory`) is optional and gated by
specific feature usage.

---

## 2. Squirrel.Windows `RELEASES`

Source: `Squirrel/Squirrel.Windows`, `src/Squirrel/ReleaseEntry.cs`
(master, 2026-11). Plain text, line-based.

### Wire format — UTF-8 text

```
<SHA1>  <baseUrl><fileName>  <size>[\r][# stagingPercentage%]
```

`# comments` are stripped by `commentRegex` (`ReleaseEntry.cs:96`).
`stagingPercentage` is parsed by `stagingRegex` from a `# NN%` tail
comment (`ReleaseEntry.cs:97, 103`). The canonical regex:

```csharp
// ReleaseEntry.cs:95
static readonly Regex entryRegex = new Regex(@"^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$");
// ReleaseEntry.cs:96
static readonly Regex commentRegex = new Regex(@"\s*#.*$");
// ReleaseEntry.cs:97
static readonly Regex stagingRegex  = new Regex(@"#\s+(\d{1,3})%$");
```

Real example (from `ReleasesUtility`/`SyncImplementations.cs`):

```
9d4d9d1ae0198a47bcaf16d8ad1c4acd9e80b56f MyApp-1.2.3-full.nupkg  8388608
bf3b0f4d2e60a2e07f2d1c25f4d2a5b31bcb0f31 MyApp-1.2.3-delta.nupkg 524288
8a4a05e1f6a17b9a83bf9f9e4f3e9baf15c4c7d2 MyApp-1.2.3-delta.nupkg 524288 # 10%
```

### Field semantics

| Token          | Required | Source                                   |
|----------------|----------|------------------------------------------|
| `<SHA1>`       | yes      | SHA-1 of the `.nupkg` body, 40 hex chars |
| `<baseUrl>`    | optional | absent → empty, file is relative         |
| `<fileName>`   | yes      | nupkg filename; parsed version embedded  |
| `<size>`       | yes      | bytes, `long`                            |
| `# NN%`        | optional | 1–100; % of users to roll out to         |

The line is *serialized* by `ReleaseEntry.EntryAsString`
(`ReleaseEntry.cs:53-60`):

```csharp
// ReleaseEntry.cs:53-60
public string EntryAsString {
    get {
        if (StagingPercentage != null) {
            return String.Format("{0} {1}{2} {3} # {4}",
                SHA1, BaseUrl, Filename, Filesize, stagingPercentageAsString(StagingPercentage.Value));
        } else {
            return String.Format("{0} {1}{2} {3}",
                SHA1, BaseUrl, Filename, Filesize);
        }
    }
}
```

### Channel model

Channels are file-level: `RELEASES` is the default release track.
Pre-release tracks are separate RELEASES files (e.g. `RELEASES-beta`)
selected by `UpdateManager.CheckForUpdates.cs` based on
`releaseChannelOverride` config. Squirrel's full set of release metadata
fields is in `UpdateInfo.cs` (wrapper for `IReleaseEntry`).

### Signature algorithm

**SHA-1 only.** No signed-manifest concept. Authenticode is used on the
downloaded `.exe` (Update.exe, the staging helper, and the application
itself); Authenticode verification is the OS trust anchor.

### 2025–2026 PRs

The repo is in maintenance mode — last meaningful changes are 2023-era
NuGet/Squirrel package updates. Project moved to community fork
`Clyybber/Squirrel.Windows` (active).

### Minimum viable subset

```
<SHA1>  <fileName>  <size>
```

Just three tokens, no newline at end of file required by spec (regex
permits `[\r]*$`).

---

## 3. Squirrel.Mac

Source: `Squirrel/Squirrel.Mac`, `Squirrel/SQRLUpdate.h/m`,
`SQRLDownloader.h/m`, `SQRLUpdater.h/m` (branch `main`, 2026-11).
Wire format is JSON, fundamentally different from `RELEASES`.

### Wire format — JSON over HTTPS

A single GET to the configured `updateRequest.URL` returns a JSON object.
`SQRLUpdate.m:63-73` declares the exact JSON key map:

```objc
// SQRLUpdate.m:63-73
+ (NSDictionary *)JSONKeyPathsByPropertyKey {
    return @{
        @keypath(SQRLUpdate.new, releaseNotes): @"notes",
        @keypath(SQRLUpdate.new, releaseName):  @"name",
        @keypath(SQRLUpdate.new, releaseDate):  @"pub_date",
        @keypath(SQRLUpdate.new, updateURL):    @"url",
        @keypath(SQRLUpdate.new, packageDigest): @"sha256",
        @keypath(SQRLUpdate.new, packageSize):  @"size",
        @keypath(SQRLUpdate.new, delta):        @"delta",
    };
}
```

Concrete wire document:

```json
{
  "url":      "https://releases.example.com/MyApp-1.2.3.zip",
  "name":     "1.2.3",
  "notes":    "Bug fixes; new dashboard.",
  "pub_date": "2026-09-12T19:20:11Z",
  "sha256":   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size":     1623481,
  "delta": {
    "from_version": "1.2.2",
    "url":          "https://releases.example.com/MyApp-1.2.2-to-1.2.3.patch",
    "sha256":       "9f8e...e2",
    "size":         228341
  }
}
```

`pub_date` is ISO-8601 with timezone. `sha256` is enforced lowercase
64-hex by `packageDigestJSONTransformer`
(`SQRLUpdate.m:82-90`) — any other format is logged and silently
dropped (the package is *not* rejected, just unverified; cf. comment at
`SQRLUpdate.m:79-81`).

### Channel model

`SQRLUpdaterMode` enum (`SQRLUpdater.m:34` and below) — two modes:

- `JSONFILE` — JSON file with manifest.
- `RELEASESERVER` — GitHub Releases API server URL (the GitHub-Mac
  flavour).

Channels are not part of the protocol itself; selection is by URL
template (`initWithUpdateRequest:forVersion:useMode:`
`SQRLUpdater.m:236`).

### Signature algorithm

**None on the wire.** Trust is delegated to Apple's code-sign on the
downloaded `.app` and its inner `Squirrel.framework`. `SQRLCodeSignature.m`
verifies embedded Apple code signatures. The `SHA256` is integrity
only, not authenticity.

### 2025–2026 PRs

Last meaningful activity on `main` was the SparkleDelta / `dont-link-appkit`
branches (2024–2025). No 2025–2026 wire-format changes. The project is
considered legacy; downstream forks (e.g. `Electron Squirrel.Mac` patch
sets) carry local fixes.

### Minimum viable subset

```json
{ "url": "https://releases.example.com/MyApp-1.2.3.zip", "name": "1.2.3" }
```

`url` is required (validation at `SQRLUpdate.m:26-37`); `name` is the
CFBundleVersion string. Everything else is advisory.

---

## 4. Sparkle 2 `appcast.xml`

Source: `sparkle-project/Sparkle`, `2.x` branch (2026-11). `SUAppcastItem.m`,
`SUSignatureVerifier.m`, `Resources/SampleAppcast.xml`, `common_cli/Signatures.swift`,
`generate_appcast/FeedXML.swift`.

### Wire format — RSS 2.0 + Sparkle XML namespace

Sparkle reuses RSS 2.0 with a custom XML namespace
`http://www.andymatuschak.org/xml-namespaces/sparkle`. Signatures are
**Ed25519** (Sparkle 2); DSA support (`SPARKLE_BUILD_LEGACY_DSA_SUPPORT`)
is compiled out by default.

Real sample (verbatim from `Resources/SampleAppcast.xml`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
        <title>Your Great App's Changelog</title>
        <description>Most recent changes with links to updates.</description>
        <language>en</language>
        <item>
            <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
            <link>https://sparkle-project.org</link>
            <sparkle:version>2.0</sparkle:version>
            <sparkle:releaseNotesLink>https://you.com/app/2.0.html</sparkle:releaseNotesLink>
            <sparkle:fullReleaseNotesLink>https://you.com/app/changelog.php</sparkle:fullReleaseNotesLink>
            <pubDate>Wed, 09 Jan 2006 19:20:11 +0000</pubDate>
            <enclosure url="https://you.com/app/Your%20Great%20App%202.0.zip"
                       length="1623481"
                       type="application/octet-stream"
                       sparkle:edSignature="WVyVJpOx+a5+vNWJVY79TRjFKveNk+VhGJf2iti4CZtJsJewIUGvh/1AKKEAFbH1qUwx+vro1ECuzOsMmumoBA==" />
            <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
        </item>
        <!-- ... -->
    </channel>
</rss>
```

### All recognised Sparkle XML elements (parsed in `SUAppcastItem.m`)

| Element                              | Type / format                | Required | Notes                                                    |
|--------------------------------------|------------------------------|----------|----------------------------------------------------------|
| `<title>`                            | string                       | optional | display                                                  |
| `<pubDate>`                          | RFC 822                      | optional | human sort order                                         |
| `<enclosure url="...">`              | URL                          | required | update payload                                           |
| `<enclosure length="...">`           | bytes                        | optional | progress reporting                                       |
| `<enclosure type="...">`             | MIME                         | required | usually `application/octet-stream`                       |
| `<enclosure sparkle:edSignature>`    | base64 Ed25519 sig (64 B)    | required | detached Ed25519 over the file bytes                     |
| `<sparkle:version>`                  | monotonic integer string     | required | CFBundleVersion (build)                                  |
| `<sparkle:shortVersionString>`       | user-visible semver          | optional | CFBundleShortVersionString                               |
| `<sparkle:releaseNotesLink>`         | URL                          | optional | remote HTML                                              |
| `<sparkle:fullReleaseNotesLink>`     | URL                          | optional | cumulative HTML                                          |
| `<sparkle:description>`              | inline HTML                  | optional | inside `<item>`                                          |
| `<sparkle:minimumSystemVersion>`     | macOS version                | optional | gate older macOS installs                                |
| `<sparkle:minimumAutoupdateVersion>` | Sparkle version string       | optional | require a minimum Sparkle framework version              |
| `<sparkle:phasedRolloutInterval>`    | seconds (int)                | optional | exponential backoff for staged rollout                    |
| `<sparkle:criticalUpdate>`           | empty / version attr         | optional | force-install above a certain Sparkle version            |
| `<sparkle:channel>`                  | string                       | optional | beta / nightly / etc.                                    |
| `<sparkle:tags>`                     | `<sparkle:criticalUpdate/>`  | optional | group multiple flags                                     |
| `<sparkle:deltas>`                   | `<enclosure>` children       | optional | binary delta from `<sparkle:deltaFrom>` version          |
| `<sparkle:deltaFrom>` (on enclosure) | version string               | optional | declares parent version                                  |
| `<sparkle:os>` (on enclosure)        | `macos` \| `windows`         | optional | cross-platform appcast gating                            |
| `<sparkle:format>` (on enclosure)    | `app` \| `zip` \| `dmg`      | optional | default `app`                                             |
| `<sparkle:ignoreSkippedUpgradesBelow>`| version                      | optional | skip lower-version rollout                               |
| `<sparkle:informationalUpdate>`      | empty                        | optional | show but do not install                                  |
| `<sparkle:installationManualSteps>`  | empty                        | optional | user must intervene                                      |

### Channel model

`<sparkle:channel>` element on `<item>`. Items without the element are
in the default (no-channel) group; clients pick the most-recent item
from the channels they are subscribed to. Phased rollout and
`<sparkle:phasedRolloutInterval>` form a deterministic %-release over
`SPUPhasedUpdateGroup` — *not* part of the XML spec, derived from the
client's local clock.

Real-world phased appcast (`Tests/Resources/testappcast_phasedRollout.xml`):

```xml
<item>
    <title>Version 3.0</title>
    <description>desc</description>
    <pubDate>Sat, 26 Jul 2014 15:20:11 +0000</pubDate>
    <sparkle:version>3.0</sparkle:version>
    <sparkle:minimumAutoupdateVersion>2.0</sparkle:minimumAutoupdateVersion>
    <enclosure url="http://localhost:1337/Sparkle_Test_App.zip" />
    <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
    <sparkle:criticalUpdate></sparkle:criticalUpdate>
</item>
```

Real-world channel appcast (`Tests/Resources/testappcast_channels.xml`):

```xml
<item>
    <title>Version 4.0</title>
    <sparkle:version>4.0</sparkle:version>
    <pubDate>Sat, 26 Jul 2014 15:20:13 +0000</pubDate>
    <enclosure url="http://localhost:1337/Sparkle_Test_App.zip" length="1346234" />
    <sparkle:channel>beta</sparkle:channel>
</item>
```

### Signature algorithm — Ed25519

`SUSignatureVerifier.m` (`Autoupdate/SUSignatureVerifier.m` in 2.x tree)
calls the bundled `ed25519.h` reference implementation
(`Sparkle-Project/Sparkle/Vendor/ed25519-sparkle`). The signature
attaches to `<enclosure>` as `sparkle:edSignature` and *binds the file
bytes only*. The appcast itself is not signed; trust on the appcast
URL comes from TLS plus the per-file Ed25519.

Sign-tool command (per `generate_keys/main.swift`):

```sh
./bin/generate_keys   # writes ed25519 private + public; prints public-key
# base64 of 32-byte key — fed to SUUpdater.allowedChannels + bundled
./Sign <path-to-app-or-zip>   # uses Ed25519 private; emits base64 sig
```

### 2025–2026 PRs

From `CHANGELOG` (2.x branch):

- **2.10.1 (2026-05)** — whitespace/newline trim fix in
  `<sparkle:releaseNotesLink>`; child-element parsing now honours custom
  prefix on `xmlns:sparkle`; embed-HTML release-notes flow drops stale
  `sparkle:format`.
- **2.10.0 (2026-02)** — `macOS 12.0` minimum deployment target; CocoaPods
  support dropped; bundle-ID ends-with-`.service` regression fixed;
  XPC mdimporter bundles moved into the binary-delta pipeline.
- **2.9.x** — temporary-file leaks fixed in delta apply; European
  Portuguese localisation; localised "Install on Quit" dialog added
  for uk/ru/fr/es/pt-PT.

### Minimum viable subset

```xml
<item>
  <title>x</title>
  <sparkle:version>1</sparkle:version>
  <enclosure url="..." length="..." type="application/octet-stream"
             sparkle:edSignature="..." />
</item>
```

The ed25519 sig is required *for Sparkle 2 trust*; Sparkle will refuse
to install without it (unless the build is legacy-DSA and compiled with
`SPARKLE_BUILD_LEGACY_DSA_SUPPORT`).

---

## 5. Tauri updater `update.json`

Source: `tauri-apps/plugins-workspace`, `v2` branch
(`plugins/updater/src/updater.rs`, `Cargo.toml`, `README.md`,
`CHANGELOG.md`, 2026-11). Plugin version **2.14.1**, Rust crate
`tauri-plugin-updater`.

### Wire format — JSON over HTTPS (RFC 8941 SFV response headers)

Two shapes, selected by endpoint type. Both are JSON. Client picks the
"static" or "dynamic/server" form based on the endpoint content.

#### Static form — multiple platforms in one document

```json
{
  "version": "1.2.3",
  "notes": "Bug fixes and new dashboard.",
  "pub_date": "2026-09-12T08:30:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url":       "https://releases.example.com/Airiz-1.2.3_aarch64.app.tar.gz",
      "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
    },
    "darwin-x86_64": {
      "url":       "https://releases.example.com/Airiz-1.2.3_x64.app.tar.gz",
      "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
    },
    "linux-x86_64": {
      "url":       "https://releases.example.com/Airiz-1.2.3_amd64.AppImage",
      "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
    },
    "windows-x86_64-nsis": {
      "url":       "https://releases.example.com/Airiz-1.2.3_x64-setup.exe",
      "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
    },
    "windows-x86_64-msi": {
      "url":       "https://releases.example.com/Airiz-1.2.3_x64-setup.msi",
      "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
    }
  }
}
```

#### Dynamic / server-resolved form — single platform per endpoint

```json
{
  "version": "1.2.3",
  "notes":   "Bug fixes and new dashboard.",
  "pub_date":"2026-09-12T08:30:00Z",
  "url":       "https://releases.example.com/Airiz-1.2.3_aarch64.app.tar.gz",
  "signature": "untrusted comment: minisign signature\nRwclq9UQeW4+v..."
}
```

This is the form returned when an endpoint template
(e.g. `https://releases.example.com/{{target}}.json`) resolves per
target — see `updater.rs:1829-1860` (response deserialiser uses
`RemoteReleaseInner::Dynamic`).

### Channel model

Channels are not part of the manifest. Channels are an *endpoint*
concept: each channel is its own URL (e.g.
`https://releases.example.com/beta.json`). The client picks which URL
to hit; the manifest itself is channel-agnostic. Compare with
electron-updater, where the channel is encoded into the filename
(`beta.yml`).

### Signature algorithm — minisign (Ed25519 + key ID)

The plugin uses the `minisign-verify` crate (pinned at `0.3` since
`2.13.3`). minisign embeds the public key *ID* in the signature
record itself (first 8 bytes of `Ed25519 public key`, in base64). The
configured pubkey is read from the app config (`Config.pubkey`,
`config.rs:116`).

```rust
// updater.rs:17
use minisign_verify::{PublicKey, Signature};
// updater.rs:825-...
// "the artifact then travels in plaintext: only its signature protects it"
```

Verified via `Updater::check` and `Update::verify` (`updater.rs:533`,
`updater.rs:fce235c3` from changelog).

### Channel-format note (changelog, v2.13.x)

- **v2.13.3** — `minisign-verify 0.3`: rejects non-canonical Ed25519
  `S` values.
- **v2.13.0** — global-API script resolves core API from
  `window.__TAURI__`; Linux TLS root-cert override bug fix.
- **v2.12.0** — breaking: `allowDowngrades` removed from the JS
  `check` command; now a plugin-config setting.
- **v2.11.0** — Windows: new `restartAfterInstall` to install without
  the installer re-launching.
- **v2.10.0** — bundle types complete on Linux (Deb/Rpm/AppImage) and
  Windows (NSiS/MSI); `no_proxy` support; `dangerousAcceptInvalidCerts`
  / `dangerousAcceptInvalidHostnames` for self-signed update servers.

### Minimum viable subset

```json
{
  "version": "1.2.3",
  "platforms": {
    "<target>": {
      "url": "...",
      "signature": "untrusted comment: minisign signature\n..."
    }
  }
}
```

`pub_date` is parsed via `time::format_description::well_known::Rfc3339`
(`updater.rs:1844`). Notes are optional. The `RemoteRelease` struct
itself requires only `version` (`updater.rs:109-118`).

---

## 6. Capawesome Capacitor Live Update

Source: `capawesome-team/capacitor-plugins` monorepo,
`packages/live-update/` (branch `main`, 2026-11). TS at
`packages/live-update/src/definitions.ts`, native at
`android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/`
and `ios/Plugin/Classes/Manifest.swift`.

### Wire format — `live-update-bundle.json` (or JSON envelope)

The plugin serves two artefact types:

#### `ArtifactType.manifest` — JSON array of `ManifestItem`

```json
[
  {
    "checksum":    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "href":        "https://cdn.example.com/2026-09-12/assets/index.html",
    "sizeInBytes": 4096
  },
  {
    "checksum":    "8c3a4d4b...b855",
    "href":        "https://cdn.example.com/2026-09-12/assets/main.bundle.js",
    "sizeInBytes": 873115
  }
]
```

Parsed by `Manifest(JSONArray)` (`Manifest.java`) and `Manifest.swift`
(`Codable`). `ManifestItem` (`ManifestItem.java`) reads only three
fields: `href`, `checksum`, `sizeInBytes`.

#### `ArtifactType.zip` — opaque ZIP archive

The plugin just stores the bytes under `<appId>-<bundleId>` and unzips
to disk on install. No manifest in-band.

### Latest-bundle JSON envelope (server response)

The fetch endpoint returns a single bundle descriptor that selects
`channel`, `artifactType`, and the manifest URL:

```json
{
  "artifactType":      "manifest" | "zip",
  "bundleId":          "2026-09-12-abcdef1234",
  "channel":           "production" | "beta" | "alpha" | "<custom>",
  "checksum":          "<sha256 of the resolved artefact bytes, hex>",
  "customProperties":  { "any-key": "any-value" },
  "downloadUrl":       "https://cdn.example.com/bundles/2026-09-12/<id>",
  "signature":         "<base64 Ed25519 of downloadUrl bytes>"
}
```

Source: `FetchLatestBundleResult.swift:5-72` and Android
`GetLatestBundleResponse.java`. `signature` is verified client-side
against an embedded Ed25519 public key.

### Channel model

Free-form string (`channel` field). The plugin reads/derives the
current channel from `LiveUpdateConfig.defaultChannel` and per-device
override (`LiveUpdatePreferences`). Multi-channel server-side
manifests are enumerated via the `GetChannelsResponseItem` result
type.

### Signature algorithm — Ed25519 (capgo/capawesome plugin)

`signature` field is base64-encoded Ed25519 over the **download URL
string** (not over the artefact bytes — the URL itself binds what
should be fetched). The public key is embedded in the app at build
time. Native sources don't expose the exact verifier location in the
files we have; the convention matches capgo.

### 2025–2026 PRs (`CHANGELOG.md` head)

- v7.x — `liveUpdateReady` event + `getCurrentBundle` synchronously
  returns the cached bundle before `sync` resolves.
- v6.x — `setCustomId` for hardware-bound bundle selection.
- v5.x — `setNextBundle` and `getNextBundle` for staged rollouts.

### Minimum viable subset

```json
{
  "artifactType": "manifest",
  "bundleId":     "<unique>",
  "downloadUrl":  "https://.../live-update-bundle.json",
  "signature":    "<base64 Ed25519>"
}
```

`channel`, `customProperties`, `checksum` are advisory. `signature` is
the only auth anchor; failure to verify causes the plugin to refuse
to apply.

---

## 7. Capacitor official Live Update (deprecated)

Source: `ionic-team/capacitor-docs` (`capacitorjs.com/docs/guides/deploying-updates`)
and absence from `ionic-team/capacitor-plugins` (no native plugin
present; verified by `gh search` over the v8 docs nav and the `main`
branch — no `packages/live-update` or similar exists under
`@capacitor/`).

### Wire format — *no on-wire spec*

The Ionic Capacitor team deprecated the official Capacitor Live Update
plugin in 2023. The current canonical guidance (verified 2026-11 on
`https://capacitorjs.com/docs/guides/deploying-updates`) is:

> "To make app store publishing and long term app updates easier,
> Ionic, the company behind Capacitor, offers a powerful Mobile DevOps
> platform called **Appflow**."

Appflow is a managed service; the wire format is undocumented and
internal. Appflow is itself being retired by Ionic (deprecation
announced 2024) with migration paths to **Capawesome Cloud** (the
commercial backing of the plugin in §6).

### `cap.config.ts` keys that survived

```ts
// ionic-team/capacitor (main) — no live-update keys remain
{
  appId: "com.airiz.console",
  appName: "AIRIZ Console",
  webDir: "dist",
  bundledWebRuntime: false,
  // ... server.androidScheme, server.url (live-reload only), etc.
}
```

The legacy `server.url` and `server.androidScheme` keys are for **live
reload during development** (`ionic-team/capacitor-docs/main/.../live-reload.md`),
not OTA updates. There are no production live-update keys in the
official config.

### Signature algorithm — n/a

### 2025–2026 PRs

None on the official repo. Appflow sunset notices ongoing.

### Minimum viable subset

```jsonc
// cap.config.ts — no live-update block required.
{
  "appId":   "<bundle id>",
  "appName": "<display>",
  "webDir":  "<output dir>"
}
```

Treat this surface as **deprecated**. Use §6 (Capawesome) or §5
(Tauri's updater crate doesn't apply for Capacitor; closest analogue
is Capgo/Capawesome).

---

## 8. Expo Updates v1

Source: `expo/expo` `docs/pages/technical-specs/expo-updates-1.mdx`
(specification), `docs/pages/technical-specs/expo-sfv-0.mdx`,
`packages/expo-updates/ios/EXUpdates/` source (sdk-54, 2026-11).
Spec modificationDate `August 12, 2026`.

The Expo Updates spec is the most formal of all surveyed — it uses
RFC 2119 keywords, RFC 7231 for HTTP, RFC 8941 for headers (a subset
of "Expo SFV"), and is the only protocol with explicit code-sign
requirements at the manifest level.

### Wire format — request

```text
GET <server>/manifest HTTP/1.1
expo-protocol-version: 1
accept: application/expo+json;q=0.9, application/json;q=0.8, multipart/mixed
expo-platform: ios | android
expo-runtime-version: 1.2.3
expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"
```

(Verbatim from `expo-updates-1.mdx`, §"Request".)

### Wire format — response (single update, `application/expo+json`)

```text
HTTP/1.1 200 OK
expo-protocol-version: 1
expo-sfv-version: 0
expo-manifest-filters: branch="main",channel="production"
expo-server-defined-headers: x-airiz-tenant="apac"
cache-control: private, max-age=0
content-type: application/expo+json; profile="expo-updates"
expo-signature: sig="<base64 RSA-PSS-SHA256>", keyid="root", alg="rsa-v1_5-sha256"

{
  "id":             "00000000-0000-0000-0000-000000000001",
  "createdAt":      "2026-09-12T08:30:00.000Z",
  "runtimeVersion": "1.2.3",
  "launchAsset": {
    "hash":         "<base64url SHA-256 of bundle>",
    "key":          "bundle",
    "contentType":  "application/javascript",
    "url":          "https://u.expo.dev/00000000.../bundle"
  },
  "assets": [
    { "hash":         "...", "key": "image-1",  "contentType": "image/png",
      "url": "https://u.expo.dev/.../image-1.png" }
  ],
  "metadata": {
    "branch":  "main",
    "channel": "production"
  },
  "extra": {
    "eas": { "projectId": "00000000-0000-0000-0000-000000000000" }
  }
}
```

The manifest TypeScript type (`expo-updates-1.mdx`):

```ts
type Manifest = {
  id: string;
  createdAt: string;          // ISO-8601
  runtimeVersion: string;
  launchAsset: Asset;
  assets: Asset[];
  metadata: { [key: string]: string };
  extra:    { [key: string]: any };
};

type Asset = {
  hash?: string;              // base64url SHA-256
  key: string;
  contentType: string;        // RFC-2045 MIME
  fileExtension?: string;     // ".jpeg" with leading dot
  url: string;
};
```

### Wire format — `multipart/mixed`

For directed updates + bundles in one round-trip:

```
HTTP/1.1 200 OK
content-type: multipart/mixed; boundary=...

--BOUNDARY
content-disposition: form-data; name="manifest"
content-type: application/expo+json
expo-signature: sig=..., keyid="root", alg=...

{ "id":"...", "launchAsset":{...}, "assets":[...], ... }

--BOUNDARY
content-disposition: form-data; name="extensions"
content-type: application/json

{ "assetRequestHeaders": { "image-1": { "Authorization": "Bearer ..." } } }

--BOUNDARY--
```

### Wire format — Directive body

```json
{
  "type":       "rollBackToEmbedded",
  "parameters": { "commitTime": "2026-09-12T08:30:00.000Z" },
  "extra":      { "eas": { "projectId": "00000000-0000-0000-0000-000000000000" } }
}
```

Used to force-rollback without downloading an update.

### Channel model

`metadata.branch` and `metadata.channel` are free-form strings. The
server picks the most-recent manifest whose metadata matches the
`expo-manifest-filters` SFV dictionary header. Rollouts are implemented
out-of-band by the server (EAS Compute / EAS Update) by varying which
`runtimeVersion` + `metadata` is sent.

### Signature algorithm — RSA-PSS-SHA256 (or RSA-v1_5-SHA256), X.509 chain

The spec mandates:

> "The client MUST verify that the signing certificate is either a
> self-signed, trusted root certificate or is in a certificate chain
> signed by a trusted root certificate. In either case, the root
> certificate MUST be embedded in the application or device's operating
> system."

(`expo-updates-1.mdx` §"Code signing".) The signature is over the
**manifest body** — assets are transitively signed because their
`hash` is in the manifest. The `keyid` / `alg` SFV fields in
`expo-signature` select which cert/algorithm the client should use.

The iOS reference client parses the signature via custom ASN.1 decoder
(`ios/EXUpdates/ASN1Decoder/`) and a custom crypto wrapper
(`ios/EXUpdates/CodeSigning/CertificateChain.swift`,
`Signature.swift`). Android-side: `CodeSigning` + `CodeSigningAlgorithm`
classes in `android/.../updates/codesigning/`.

### Rollouts / phased release

The spec is silent on `rollout_percentage`; rollout is delegated to the
server's `expo-manifest-filters` choice. EAS Update implements
[rollouts](https://docs.expo.dev/eas-update/runtime-versions/) by
sending the new manifest to a percentage of devices based on client
hash. Expo Updates Manifest itself has no `rollout` field.

### 2025–2026 PRs (`expo-updates/CHANGELOG.md`)

From the changelog, recent notable items include:

- **SDK 54 (2026)** — added `expo-updates` support for Dart-defined
  updates; signing pipeline hardened against EAS Update; HermesDiff
  added (`HermesDiffTest.kt`).
- **SDK 53 (2025-09)** — `Rollout.swift` refactor; new
  `LoaderSelectionPolicyDevelopmentClient.swift` filters by EAS branch.
- **SDK 52 (2025-04)** — `response.hashes` moved from `extensions` body
  into manifest for backwards-compat.

### Minimum viable subset

```json
{
  "id":             "<UUID>",
  "createdAt":      "<ISO-8601>",
  "runtimeVersion": "<semver>",
  "launchAsset": {
    "key":         "bundle",
    "contentType": "application/javascript",
    "url":         "<URL>"
  },
  "assets":        [],
  "metadata":      {},
  "extra":         {}
}
```

Adding `hash` to `launchAsset` makes the client able to verify; without
it the client must trust HTTPS.

---

## 9. CodePush / App Center (retired)

Source: `microsoft/react-native-code-push` (archived 2026-11-03),
`docs/` mirrors (no longer canonical), `aka.ms/appcenter/retirement`
(retirement announcement page).

### Wire format — historical JSON

```json
// GET https://codepush.appcenter/v0.1/apps/<appName>/deployments/<deploymentName>
//   Authorization: <access-key>
// response body:
{
  "update_info": {
    "download_url": "https://codepush.appcenter/.../bundle",
    "description":  "Bug fixes",
    "is_available": true,
    "is_mandatory": false,
    "rollout":      100,
    "target_binary_range": "1.0.0",
    "package_hash": "<sha256 of bundle>"
  }
}
```

### Channel model

`deploymentName` is the channel: `Staging`, `Production`, or a custom
deployment. The endpoint is per-deployment, so channel is in the URL,
not the body.

### Signature algorithm — none

CodePush never signed update bundles. Trust was HTTPS + App Center
access-key in the request.

### 2025–2026 status — RETIRED

- `aka.ms/appcenter/retirement` (confirmed live 2026-11) — Visual Studio
  App Center retired **2025-03-31** for new sign-ups; existing
  customers get read-only access until **2026-03-31** (extended from
  original 2025-12-31 announcement).
- `microsoft/react-native-code-push` repo archived 2026-11-03 (verified
  via `gh api`); default branch unchanged; no PRs accepted.
- Recommended migration: **CodePush self-hosted** (`microsoft/
  code-push-server`) fork maintained by community; or move to **Expo
  Updates** (EAS Update) for React Native apps.

### Minimum viable subset

```json
{
  "update_info": {
    "download_url":  "https://.../bundle",
    "is_available":  true,
    "is_mandatory":  false,
    "rollout":       100,
    "package_hash":  "<sha256>"
  }
}
```

**Do not adopt.** Use §8 (Expo Updates) or a fork of code-push-server
behind your own signature scheme.

---

## 10. PWA Service Worker / Workbox

Source: `web.dev/articles/service-worker-lifecycle` (Jake Archibald),
`developer.chrome.com/docs/workbox/modules/workbox-precaching`,
`workbox-broadcast-update`, `workbox-window`.

This is **not** a single canonical manifest format; it is a *fetch-and-
cache* contract defined by the Service Worker specification
(W3C/WHATWG). Updates are managed by versioned precache manifests
inside Workbox.

### Wire format — Service Worker spec

```
// register
navigator.serviceWorker.register('/sw.js').then(reg => {
  reg.update();                 // manual fetch
  reg.installing;               // = the new SW, or undefined
  reg.waiting;                  // = the new SW waiting to activate
  reg.active;                   // = the SW controlling the page
});
```

Lifecycle states (`workbox-window` etc.):

```
parsed → installing → installed → activating → activated
                                          ↘ redundant
```

### Wire format — Workbox precache manifest (generated)

```js
// generated by workbox-build injectManifest, embedded in sw.js:
self.__WB_MANIFEST = [
  { revision: 'abc123...', url: '/index.html' },
  { revision: 'def456...', url: '/assets/main.bundle.js' },
  { revision: '789ghi...', url: '/assets/style.css' },
  // ...
];
```

Workbox uses the *revision hash* to invalidate the cache when the file
changes. New SW installs → old cache purged → new SW activates → page
on next navigation gets new content.

### Channel model

Channels don't exist as a server-side concept; the browser asks
`/sw.js` on navigation and the SW decides. A "channel" can be
implemented as a separate SW registration (`sw-stable.js`,
`sw-canary.js`) or as a build-time constant inside the SW.

### Rollout / phased release

There is no built-in phased rollout. Workbox
[`workbox-broadcast-update`](https://developer.chrome.com/docs/workbox/modules/workbox-broadcast-update)
posts messages to clients so they can refetch without a full SW update.
`workbox-window` provides `messageSkipWaiting()` and
`messageClearCacheFor(urlPattern)`.

### Signature algorithm — none on the wire

Service workers are HTTPS-only and benefit from SRI on the imported JS.
There is no spec-level signing convention for SW bundles. Manual
practice:

1. Embed a build-time SHA-256 list of every precached file in the SW
   manifest (Workbox does this automatically).
2. Reject updated `__WB_MANIFEST` whose file hashes don't match
   anything in a server-signed `airiz-pwa-manifest.json`.

### 2025–2026 PRs / spec updates

- **ServiceWorker spec:** `updateViaCache: 'none'` (no HTTP cache on
  `/sw.js`) is the recommended default; Chrome 94+ ships with
  `registerType: 'auto'` for module workers.
- **Workbox 7+:** ESM-only build, dropped IE / legacy Edge; `injectManifest`
  plugin emits a stable `__WB_MANIFEST` shape.
- **Chrome 121+ (2024)** — Storage Buckets for origin storage quota
  partitions; impacts Workbox runtime caches configured with
  `cacheName`.

### Minimum viable subset

```js
// minimal SW that "does something" for AIRIZ's Cloudflare Worker surface:
self.addEventListener('install',  e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
```

```json
// companion signed manifest (NOT a Service Worker concept, but the
// "wire" we'd serve from a Cloudflare Worker alongside sw.js):
{
  "sw_version":   "1.2.3+abc123",
  "sw_url":       "/sw.js",
  "sw_sha256":    "<hex>",
  "precache": [
    { "url": "/index.html",        "sha256": "..." },
    { "url": "/assets/main.js",    "sha256": "..." }
  ]
}
```

This companion file is *application-defined*; the SW spec doesn't
recognise it. Workbox users typically emit a similar JSON via
`generateSW`/`injectManifest` post-processing.

---

## 11. Microsoft `.appinstaller`

Source: `microsoftdocs/msix-docs`
`msix-src/app-installer/how-to-create-appinstaller-file.md`,
`update-settings.md`, `app-installer-root.md` (main branch, 2026-11).
Schema lives at `http://schemas.microsoft.com/appx/appinstaller/2021`
(the 2017/2 schema is older; 2018 added `UpdateUris`/`RepairUris`).

### Wire format — XML

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="1.0.0.0"
    Uri="http://mywebservice.azurewebsites.net/appset.appinstaller">

    <MainBundle
        Name="Airiz.Console"
        Publisher="CN=Pegatron"
        Version="1.2.3.0"
        Uri="http://mywebsite/airiz/Airiz.Console_1.2.3.0_Test/Airiz.Console_1.2.3.0_x64.msixbundle" />

    <OptionalPackages>
        <Bundle Name="Airiz.Plugin.Lidar"   Publisher="CN=Pegatron" Version="1.2.3.0"
                Uri="http://mywebsite/.../Lidar_1.2.3.0.msixbundle" />
        <Package Name="Airiz.Plugin.Sample" Publisher="CN=Pegatron" Version="1.2.3.0"
                 ProcessorArchitecture="x64"
                 Uri="http://mywebsite/.../Sample_1.2.3.0_x64.msix" />
    </OptionalPackages>

    <UpdateSettings>
        <OnLaunch HoursBetweenUpdateChecks="0"
                  UpdateBlocksActivation="true"
                  ShowPrompt="true" />
        <AutomaticBackgroundTask />
        <ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion>
    </UpdateSettings>

    <UpdateUris>
        <UpdateUri>https://www.airiz.example/Installers/MainApp.AppInstaller</UpdateUri>
        <UpdateUri>\\ServerName\Share\Installers\MainApp.AppInstaller</UpdateUri>
    </UpdateUris>

    <RepairUris>
        <RepairUri>https://www.airiz.example/Installers/MainApp.AppInstaller</RepairUri>
    </RepairUris>
</AppInstaller>
```

Source: verbatim from `how-to-create-appinstaller-file.md` (Microsoft
Learn docs repo), with substitutions.

### UpdateSettings child elements (full set)

| Element                        | Min Win ver | Notes                                                    |
|--------------------------------|-------------|----------------------------------------------------------|
| `OnLaunch`                     | 1709        | check at launch                                          |
| `OnLaunch/@HoursBetweenUpdateChecks` | 1803  | 0–255 hours; default 24                                  |
| `OnLaunch/@ShowPrompt`         | 1903        | show UI to user                                          |
| `OnLaunch/@UpdateBlocksActivation` | 1903     | `true` → user must take update to launch                 |
| `AutomaticBackgroundTask`      | 1803        | every 8 h, no UI                                         |
| `ForceUpdateFromAnyVersion`    | 1903        | allow downgrade                                          |

(From `update-settings.md` table verbatim.)

### Channel model

None native — App Installer has one default channel. Channels are
implemented by *different `UpdateUri` entries* (up to 10) which the
installer cycles through in order if the primary is unreachable. So
channels are network-redundancy + fallback, not release stages.

### Signature algorithm — Authenticode + catalog

The `.appinstaller` file itself can be Authenticode-signed (the OS
checks this on launch). The MSIX packages it references must be
Authenticode-signed by the same publisher identity in the `<MainBundle
Publisher="...">` / `<MainPackage Publisher="...">` element.
Optionally, MSIX packages can also be catalog-signed; the same
catalog file lists the SHA-256 hashes of all MSIX contents.

### 2025–2026 PRs / doc updates

- **Dec 2023** — `ms-appinstaller:` URI protocol disabled by default
  (consumer-grade security hardening). IT admins can re-enable via
  Group Policy. Confirmed in `app-installer-file-overview.md`
  (ms.date: 04/17/2026) callout.
- **2026-04** — Doc set refreshed (`ms.date: 04/17/2026`); no schema
  changes. App Installer still ships in-box with Windows 10 (1803+)
  and Windows 11.
- The companion store-app, `App Installer` (Microsoft Store app
  9NBLGGH4NNS1), is still available — no deprecation notice.

### Minimum viable subset

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="1.0.0.0"
    Uri="https://example.com/Airiz.appinstaller">
    <MainPackage Name="Airiz.Console" Publisher="CN=Pegatron" Version="1.2.3.0"
                 ProcessorArchitecture="x64"
                 Uri="https://example.com/Airiz_1.2.3.0_x64.msix" />
    <UpdateSettings>
        <OnLaunch HoursBetweenUpdateChecks="0" />
    </UpdateSettings>
</AppInstaller>
```

---

## 12. Unified signed-manifest schema (proposed)

Below is the *union* of fields that appear in the surveyed tools,
annotated by which tool originally defined them. This is the
**proposed** schema before gap-filling.

| Field                  | Type                | Origin (tool — field)                                                                  |
|------------------------|---------------------|----------------------------------------------------------------------------------------|
| `version`              | string              | EU `version` · SWM `name` (CFBundleVersion) · Spk `sparkle:version` · Tu `version` · Expo `runtimeVersion` · AppInstaller `Version` |
| `channel`              | string              | EU channel filename · Spk `sparkle:channel` · Caprw channel · AppInstaller UpdateUri order |
| `platform`             | string              | Tu `target` (`os-arch-bundle`) · AppInstaller `<MainPackage ProcessorArchitecture>` · Caprw inferred from `<MainBundle>` |
| `arch`                 | string              | derived from `platform` in EU / Caprw; explicit in Tu / AppInstaller                    |
| `min_version`          | string              | SWM (delta source) · EU (semver downgrade) · Spk `sparkle:minimumSystemVersion` (system-level, not app-level) |
| `artifact_url`         | URL                 | EU `files[].url` · SWM `BaseUrl+Filename` · SQRM `url` · Spk `enclosure/@url` · Tu `platforms[].url` · Caprw `downloadUrl` · Expo `launchAsset.url` · AppInstaller `<MainPackage/@Uri>` |
| `artifact_size`        | bytes               | EU `files[].size` · SWM `filesize` · SQRM `size` · Spk `enclosure/@length` · Expo (inferred) · AppInstaller (inferred from MSIX) |
| `artifact_sha256`      | hex or base64       | SQRM `sha256` · Expo `launchAsset.hash` (base64url) · EU `files[].sha512` (sha512, not sha256) · SWM (SHA-1 only) · Spk (none — Ed25519 over file bytes) · Tu (none — minisign over file bytes) |
| `artifact_signature`   | base64              | Caprw `signature` (Ed25519 over URL) · Spk `sparkle:edSignature` (Ed25519 over file) · Tu `signature` (minisign/Ed25519 over file) · Expo `expo-signature` (RSA over manifest body) |
| `pubkey_id`            | string              | Spk (key comment in `generate_keys` output) · Tu (minisign 8-byte prefix) · Expo (`keyid` SFV) |
| `pub_date`             | ISO-8601            | EU `releaseDate` · SQRM `pub_date` · Tu `pub_date` · Expo `createdAt` |
| `mandatory`            | boolean             | EU `mandatory` · Caprw `is_mandatory` (legacy CodePush) · AppInstaller (`UpdateBlocksActivation`) |
| `rollout_percentage`   | 0–100               | EU `stagingPercentage` · SWM `# NN%` · Spk (phasedRolloutInterval + client-side math) |
| `notes`                | string \| URL       | SQRM `notes` · Tu `notes` · Spk `<description>`/`<sparkle:releaseNotesLink>` · Expo (via asset hash of static note) |

### Gap analysis vs. AIRIZ surfaces

| Use case                                            | Sufficient? | Missing                                                                                       |
|-----------------------------------------------------|-------------|------------------------------------------------------------------------------------------------|
| **(a) Delta updates** (Caprw zip vs. full)           | partial     | `delta_url`, `delta_size`, `delta_sha256`, `delta_signature`, `delta_from_version`             |
| **(b) iOS App Store** (no in-place updates of code)  | n/a         | n/a — iOS rejects in-place code updates; this manifest is for *web* assets only                |
| **(c) PWA SW cache busting**                        | partial     | `precache[]` array of `{ url, sha256 }` per file                                              |
| **(d) Worker version pinning**                      | partial     | `worker_version`, `worker_runtime_compat[]`                                                   |
| **(e) Crash-throttled rollback**                    | partial     | `min_clients_to_rollout`, `crash_rate_threshold`, `rollback_to_version`, `blacklisted_versions[]` |

---

## 13. Sufficiency assessment against AIRIZ use cases

The five AIRIZ surfaces (Electron Windows + Capacitor Android/iOS + Web
PWA + Cloudflare Worker) need a manifest whose size, validation surface
and server footprint can be shared.

### (a) Delta updates

The proposed schema lacks delta fields. Add:

```jsonc
{
  "deltas": [
    {
      "from_version": "1.2.2",
      "artifact_url":  "https://.../Airiz-1.2.2-to-1.2.3.delta",
      "artifact_size":  228341,
      "artifact_sha256": "<hex>",
      "artifact_signature": "<base64>"
    }
  ]
}
```

Server picks first entry whose `from_version` matches the client
version, falls back to full `artifact_url` if absent or signature fails.

### (b) iOS App Store

Native iOS binaries must ship via the App Store; live-update tooling
may only update *assets*. The manifest must therefore distinguish
*code* from *assets*:

```jsonc
{
  "kind": "assets-only",
  "store_min_build": "1.2.0",
  "artifacts": [
    { "name": "index.html", "url": "...", "sha256": "..." },
    { "name": "bundle.js",  "url": "...", "sha256": "..." }
  ]
}
```

When `kind = "full"`, the runtime assumes an enterprise/MSIX/MSI
distribution model (not iOS). Capacitor iOS rejects full updates.

### (c) PWA Service Worker cache busting

Workbox generates a per-file `__WB_MANIFEST` in the SW itself; the
companion signed manifest must list what the SW will precache so a
Client can verify before activation:

```jsonc
{
  "sw": {
    "version":      "1.2.3+abc123",
    "sw_url":       "/sw.js",
    "sw_sha256":    "<hex>",
    "scope":        "/",
    "update_via_cache": "none"
  },
  "precache": [
    { "url": "/index.html",      "sha256": "..." },
    { "url": "/assets/main.js",  "sha256": "..." }
  ]
}
```

### (d) Cloudflare Worker version pinning

A Worker pinning manifest has to declare runtime-version affinity
(`compatibility_date` / `compatibility_flags`) so an Electron Windows
client fetching "Worker v2.0" doesn't fetch a Worker compiled against
a newer compat date than the platform expects:

```jsonc
{
  "worker": {
    "name":                  "airiz-api",
    "version":               "2.0.1",
    "compatibility_date":    "2026-09-01",
    "compatibility_flags":   ["nodejs_compat"],
    "artifact_url":          "https://workers.airiz.example/v2.0.1/script.js",
    "artifact_sha256":       "<hex>",
    "artifact_signature":    "<base64>"
  }
}
```

### (e) Crash-throttled rollback / staged rollout safety

Standard manifest is silent on rollback. To support crash-throttled
rollout, the manifest must encode the *target* rollout (for the new
version) AND the *rollback* target (for the previous version), plus
the crash-threshold policy:

```jsonc
{
  "rollout": {
    "target_percentage":      10,
    "increment_step":          10,
    "increment_interval_sec":  3600,
    "crash_free_threshold":   0.999,
    "crash_window_sec":       86400,
    "rollback_to_version":    "1.2.2",
    "blacklisted_versions":   ["1.2.1"]   // do not attempt to roll back to these
  }
}
```

The Electron-updater `stagingPercentage` + Crashpad metrics would feed
this; the server would re-issue a manifest with a smaller
`target_percentage` if crash-rate exceeds threshold.

---

## 14. Final unified schema (rev 1)

Combining all the additions above. The schema is a single JSON object;
the top-level keys are required unless marked optional. Field names
follow `lower_snake_case` to match Electron and CodePush convention.

```jsonc
{
  /* Identity */
  "schema_version":      "1",                  // required; bumps on wire changes
  "manifest_id":         "<UUID>",             // required; Expo-style
  "app_id":              "com.airiz.console",  // required
  "channel":             "production",         // required; free-form string

  /* Versioning */
  "version":             "1.2.3",              // required (semver)
  "min_version":         "1.2.0",              // optional; refuses older clients
  "kind":                "full",               // required; "full" | "assets-only" | "delta-only"
  "store_min_build":     "1.2.0",              // optional; iOS App Store gating

  /* Channels & rollouts */
  "rollout": {
    "target_percentage":     100,               // required; 0..100
    "increment_step":         10,               // optional; 0 = single-shot
    "increment_interval_sec": 3600,             // optional; 0 = immediately
    "crash_free_threshold":   0.999,            // optional; skip if not crash-throttling
    "crash_window_sec":       86400,            // optional
    "rollback_to_version":    "1.2.2",          // optional
    "blacklisted_versions":   ["1.2.1"]         // optional
  },

  /* Mandatory / advisory */
  "mandatory":           false,                // required boolean

  /* Primary artifact */
  "artifact": {
    "platform":          "windows-x86_64",     // required; one of
                                               //   windows-x86_64, windows-arm64,
                                               //   darwin-x86_64, darwin-aarch64,
                                               //   linux-x86_64, linux-aarch64,
                                               //   android-arm64, ios-arm64,
                                               //   web, worker
    "arch":              "x86_64",             // required when platform != web/worker
    "url":               "https://.../Airiz-1.2.3.exe",
    "size":              87311564,
    "sha256":            "<hex>",
    "signature":         "<base64 Ed25519>",
    "signature_alg":     "ed25519",            // required when signature present
    "pubkey_id":         "<8-byte key id>"
  },

  /* Optional delta entries */
  "deltas": [
    {
      "from_version":    "1.2.2",
      "platform":        "windows-x86_64",
      "arch":            "x86_64",
      "url":             "https://.../Airiz-1.2.2-to-1.2.3.delta",
      "size":            228341,
      "sha256":          "<hex>",
      "signature":       "<base64 Ed25519>",
      "signature_alg":   "ed25519",
      "pubkey_id":       "<8-byte key id>"
    }
  ],

  /* Asset-only sub-manifest (Capacitor / PWA) */
  "assets": [
    {
      "key":         "index.html",
      "contentType": "text/html",
      "url":         "https://.../2026-09-12/index.html",
      "size":        4096,
      "sha256":      "<hex>",
      "signature":   "<base64>",
      "fileExtension": ".html"
    }
  ],

  /* PWA Service Worker companion (optional) */
  "sw": {
    "version":           "1.2.3+abc123",
    "sw_url":            "/sw.js",
    "sw_sha256":         "<hex>",
    "scope":             "/",
    "update_via_cache":  "none",
    "precache": [
      { "url": "/index.html",     "sha256": "..." },
      { "url": "/assets/main.js", "sha256": "..." }
    ]
  },

  /* Cloudflare Worker companion (optional) */
  "worker": {
    "name":                "airiz-api",
    "version":             "2.0.1",
    "compatibility_date":  "2026-09-01",
    "compatibility_flags": ["nodejs_compat"],
    "url":                 "https://workers.airiz.example/v2.0.1/script.js",
    "size":                4194304,
    "sha256":              "<hex>",
    "signature":           "<base64>",
    "pubkey_id":           "<8-byte key id>"
  },

  /* Notes */
  "pub_date":            "2026-09-12T08:30:00Z",   // ISO-8601
  "notes":               "Bug fixes; new dashboard.",
  "notes_url":           "https://airiz.example/release/1.2.3",

  /* Signature envelope (whole-manifest signature) */
  "manifest_signature":  "<base64 RSA-PSS-SHA256 OR ed25519 of canonical-JSON>",
  "signature_alg":       "rsa-pss-sha256",     // or "ed25519"
  "pubkey_id":           "<key id>",
  "extras":              { /* forward-compat: tools add their own bags here */ }
}
```

### Canonical-JSON rule

The top-level `manifest_signature` (when present) is computed over a
canonicalised form of the JSON with the `manifest_signature` field
itself removed. Canonicalisation: keys sorted lexicographically at every
level, no insignificant whitespace, numbers as decimal strings,
strings as raw UTF-8 (no `\u` escaping of ASCII). This matches RFC 8785
(JCS) semantics without binding to a specific implementation.

### Coverage matrix

| AIRIZ surface                          | Required top-level fields                              |
|----------------------------------------|--------------------------------------------------------|
| Electron Windows                       | `artifact` (windows-x86_64) + `deltas` + `rollout`     |
| Capacitor Android/iOS                  | `assets[]` + `kind: "assets-only"` + `manifest_signature` (RSA) |
| Web PWA                                | `sw` + `assets[]`                                      |
| Cloudflare Worker                      | `worker` + `manifest_signature` (Ed25519)              |

### Conversion helpers (recommended)

- **electron-updater → AIRIZ manifest**: read `latest.yml`, lift
  `version`, `files[0]`, `releaseDate` → `stagingPercentage` →
  `rollout.target_percentage`; signature absent (rely on
  Authenticode at install time). No `manifest_signature` produced.
- **Tauri update.json → AIRIZ manifest**: read `version`, `pub_date`,
  `notes`, `platforms.<target>.{url,signature}` → `artifact`,
  `manifest_signature`. `signature` (minisign) becomes `artifact.signature`
  with `signature_alg: "ed25519"` (minisign is a thin Ed25519 wrapper).
- **Sparkle appcast → AIRIZ manifest**: parse `<enclosure>` items,
  extract `sparkle:version`, `enclosure/@url`, `enclosure/@length`,
  `sparkle:edSignature` → `artifact.signature`. Map
  `<sparkle:channel>` to top-level `channel`.
- **Expo Updates manifest → AIRIZ manifest**: identity map; `createdAt`
  → `pub_date`, `runtimeVersion` → `min_version` (recommended),
  `launchAsset` → `artifact` (or first of `assets[]` for assets-only
  mode); `expo-signature` SFV dictionary → `manifest_signature` (RSA).
- **Capawesome Live Update → AIRIZ manifest**: `bundleId` → `version`,
  `downloadUrl` → `artifact.url` (when `artifactType=manifest`) or
  serve the `live-update-bundle.json` directly; `signature` over URL
  → `manifest_signature` (Ed25519).
- **Microsoft .appinstaller → AIRIZ manifest**: parse `<MainPackage
  Name/Version/Uri>` and `<UpdateSettings>`; Authenticode is *not*
  preserved (Windows-only); produce no `manifest_signature`; rely on
  OS code-sign verification at install time.
- **PWA Workbox build → AIRIZ manifest**: read the generated
  `__WB_MANIFEST` (with `revision` hashes), compute the SW file
  SHA-256, emit `sw` + `precache[]`.
- **Cloudflare Worker build → AIRIZ manifest**: read the Workers
  upload metadata (script SHA-256, compat date/flags), emit `worker`.

### Anti-patterns / traps

- **Cross-mixing signature algorithms in one manifest.** Pick Ed25519
  or RSA per manifest, not per field. Tooling assumes one pubkey per
  app.
- **Phased rollout without a separate rollback target.** Capgo-style
  rollouts without `rollback_to_version` leave clients stuck on a
  bad release once `target_percentage=100` is reached.
- **`mandatory: true` without `min_version`.** Mandatory updates that
  don't bound the floor of "acceptable client versions" cause infinite
  update loops on clients that can't run the latest binary (e.g. due
  to OS-level constraints).
- **`store_min_build` on iOS `kind: "full"`.** App Store Connect will
  reject the build.
- **PWA SW updates without `update_via_cache: "none"`.** Browsers
  cache `/sw.js` aggressively; you'll ship an update nobody sees.

---

*Survey revision 1 — generated 2026-11-04 against current upstream
sources. Re-verify against `sparkle-project/Sparkle` 2.x,
`tauri-apps/plugins-workspace` v2, `capawesome-team/capacitor-plugins`
`main`, `expo/expo` `sdk-54`, and `microsoftdocs/msix-docs` `main`
before each AIRIZ release.*
