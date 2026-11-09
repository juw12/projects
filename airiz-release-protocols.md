# AIRIZ Motor Console — Unified Release Architecture: Protocol-Level Reference

> Compiled: 2026-01 (data current as of January 2026)
> Scope: 10 auto-update ecosystems, wire format + signing + storage + atomicity + quit + rollback
> Sources: Official docs, W3C specs, GitHub source, npm metadata

---

## Ecosystem 1: Squirrel.Windows

**Repo**: [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows)
**Status**: Maintenance — "Contributors Needed" ([#1470](https://github.com/Squirrel/Squirrel.Windows/issues/1470))
**Used by**: electron-builder (historically), VS Code, .NET desktop apps

### Wire Format

The protocol consists of two artifacts served over plain HTTP:

**1. RELEASES file** (plaintext, line-delimited, append-only):

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
```

Each line: `<SHA1_HEX> <filename> <byte_size>`
Source: [docs/getting-started/5-updating.md](https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/getting-started/5-updating.md)

**Why append-only**: The client downloads the remote RELEASES, diffs it against its local copy, and downloads any new entries. No lines are ever modified or removed — this makes the file safe for CDN caching, resumable HTTP, and trivially diffable. A staged rollout modifies the file by adding a `# nn%` suffix (e.g., `6030# 10%`), not by deleting lines.

**2. nupkg packages** (NuGet container format, ZIP with `.nuspec` metadata):
- `MyApp-1.0.1-full.nupkg` — complete application files
- `MyApp-1.0.1-delta.nupkg` — bsdiff patches (see Delta section)

### Delta Updates

**Algorithm**: [bsdiff/bspatch](http://code.logos.com/blog/2010/12/binary_patching_with_bsdiff.html) — binary-level diff.
- Squirrel replaces each EXE/DLL in the delta nupkg with a `.diff` file plus a `.shasum` file (SHA1 + expected filesize of the patched result).
- The client applies bspatch to the previous full package's files, verifies the SHA1, and assembles the new full package locally.
- New files (not in the previous version) are included verbatim in the delta package.
- Files removed in the new version are "nuke"d (deleted) if no bspatch exists for them.
Source: [docs/using/delta-packages.md](https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/delta-packages.md)

### Signing

**None.** The RELEASES file is NOT cryptographically signed. Integrity is checked via SHA-1 only (not a signature). The nupkg files themselves carry no code signature in the Squirrel protocol.

This is a known gap: without HTTPS, a MITM attacker who controls the RELEASES file can inject a malicious nupkg with a matching SHA1 (trivially — the SHA1 is computed by the attacker). HTTPS is the only transport-level protection.

### Backend Storage

Any HTTP/HTTPS server. Documented options:
- GitHub Releases (`GitHubUpdateManager`)
- Amazon S3
- Microsoft IIS
- Generic HTTP

The `UpdateManager` accepts a base URL; it appends `RELEASES` to find the manifest.

### Atomicity

**Versioned directories**: Each installed version lives in `%LocalAppData%\<AppName>\App-<version>\`.
- A new version is extracted to a new directory before the old one is touched.
- Shortcuts are updated only after successful extraction.
- If extraction fails, the old version directory is intact and the app continues to run.
- On next startup, all versions except the current and immediately previous are deleted.

### Quit Semantics

- Updates are applied **in the background** while the app runs.
- The app must be **restarted** to pick up the new version.
- `Update.exe --processStart` handles the restart: it launches the new version and exits the old one.
- No forced quit; the user controls when to restart.
- The `UpdateManager.UpdateApp()` call is non-blocking; the app continues running with the old version until restart.

### Rollback

- The **immediately previous version** is retained on disk after an update.
- Rollback is manual: re-point the shortcut to the previous `App-<version>` directory.
- No automatic rollback. If the new version is broken, the user is stuck until they manually revert or a new version is published.
- To pull a bad staged release: hand-edit the RELEASES file to remove the bad version's lines, then publish a version **higher** than the broken one (you cannot re-publish the same version number).
Source: [docs/using/staged-rollouts.md](https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/staged-rollouts.md)

### Staged Rollout

**Mechanism**: `# nn%` suffix on RELEASES file lines (Squirrel 1.4.0+).
```
0d777ea94c612e8bf1ea7379164caefba6e24463 myapp-1.0.1-delta.nupkg 6030# 10%
85f4d657f8424dd437d1b33cc4511ea7ad86b1a7 myapp-1.0.1-full.nupkg 600752# 10%
```
- `# 10%` = 10% of users get this update. The `#` must immediately follow the filesize (no space) due to a legacy parsing bug.
- Ramp up by editing the percentage: `# 50%`, then remove the comment for 100%.
Source: [docs/using/staged-rollouts.md](https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/staged-rollouts.md)

### Production Caveats

1. **No cryptographic signing** — HTTPS is mandatory. A compromised update server can distribute malicious payloads.
2. **SHA-1** is used for integrity (not collision-resistant; acceptable for integrity, not for authenticity).
3. **Contributors Needed** — the project has been in maintenance mode. electron-builder v27 explicitly states "Squirrel.Windows is not supported" for its auto-update path; NSIS is the recommended Windows target.
4. **No multi-channel** — staged rollout is percentage-based, not channel-based. You cannot have "beta" and "stable" as parallel release lines without separate RELEASES files on separate URLs.
5. **Delta packages require the previous full package** to be on disk. If the user deleted it (or it was cleaned up), the client falls back to downloading the full package.
6. **No delta for the first update** — a full download is always required on initial install.

---

## Ecosystem 2: Sparkle 2.x (macOS)

**Repo**: [sparkle-project/Sparkle](https://github.com/sparkle-project/Sparkle)
**Docs**: [sparkle-project.org/documentation/](https://sparkle-project.org/documentation/)
**Status**: Active. Latest stable: Sparkle 2.9+ (signed feeds, hardware requirements, markdown release notes).

### Wire Format

**Appcast XML** (RSS 2.0 with Sparkle namespace):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>My App Changelog</title>
    <language>en</language>
    <item>
      <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
      <link>https://myproductwebsite.com</link>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString>
      <sparkle:releaseNotesLink>https://example.com/release_notes/app_2.0.html</sparkle:releaseNotesLink>
      <sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
      <sparkle:criticalUpdate></sparkle:criticalUpdate>
      <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
      <sparkle:channel>beta</sparkle:channel>
      <pubDate>Mon, 05 Oct 2025 19:20:11 +0000</pubDate>
      <enclosure url="https://example.com/downloads/app-2.0.zip"
                 sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
                 length="1623481"
                 type="application/octet-stream" />
    </item>
  </channel>
</rss>
```

Source: [sparkle-project.org/files/sparkletestcast.xml](https://sparkle-project.org/files/sparkletestcast.xml), [documentation/publishing/](https://sparkle-project.org/documentation/publishing/)

**Key schema fields**:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sparkle:version` | string (CFBundleVersion) | Yes | Machine-readable build number |
| `sparkle:shortVersionString` | string | No | Human-readable version |
| `sparkle:edSignature` | base64 (on `<enclosure>`) | Yes* | EdDSA signature of the archive |
| `length` | integer (bytes) | Yes | File size |
| `type` | MIME string | Yes | `application/octet-stream` |
| `sparkle:releaseNotesLink` | URL | No | HTML, markdown (2.9+), or plain text |
| `sparkle:minimumSystemVersion` | string | No | e.g. "12.0.0" |
| `sparkle:maximumSystemVersion` | string | No | Upper bound |
| `sparkle:hardwareRequirements` | string | No | e.g. "arm64" (2.9+) |
| `sparkle:criticalUpdate` | element | No | Forces immediate update |
| `sparkle:phasedRolloutInterval` | integer (seconds) | No | Phased rollout interval |
| `sparkle:channel` | string | No | Channel name (default = "default") |
| `sparkle:minimumAutoupdateVersion` | string | No | Major upgrade gate |
| `sparkle:ignoreSkippedUpgradesBelowVersion` | string | No | Override skip for major upgrades |
| `sparkle:informationalUpdate` | element | No | Download-link-only update |
| `sparkle:fullReleaseNotesLink` | URL | No | Version history link |
| `sparkle:deltaUpdates` | element (in `<enclosure>`) | No | Delta update reference |

*Required if EdDSA is configured (which is recommended for all production apps).

**Custom namespaces**: You can extend the appcast with your own `xmlns` namespace and elements (parsed via `SPUUpdaterDelegate`).

### Delta Updates

**Supported**: Yes. Binary delta updates (BSDiff-based).
- `generate_appcast` tool automatically generates `.delta` files for each update.
- Delta files are named `<archive>.delta` and referenced in the appcast.
- If the app's checksum doesn't match the delta's source, Sparkle falls back to the full archive.
- Delta updates are optional per-item; you can mix delta and full in the same appcast.

Source: [documentation/delta-updates/](https://sparkle-project.org/documentation/delta-updates/)

### Signing

**Algorithm**: **EdDSA (Ed25519)**
- Key size: 32 bytes (256-bit security)
- Signature size: 64 bytes
- Key generation: `./bin/generate_keys` (stores private key in macOS Keychain, prints base64 public key)
- Public key location: `Info.plist` → `SUPublicEDKey` (base64-encoded string)
- What is signed: The update archive (`.zip`, `.dmg`, `.tar.*`, `.aar`)
- Signature location: `sparkle:edSignature` attribute on `<enclosure>` element

```
<key>SUPublicEDKey</key>
<string>pfIShU4dEXqPd5ObYNfDBiQWcXozk7estwzTnF9BamQ=</string>
```

**Why EdDSA not RSA**:
1. **Key size**: 32-byte Ed25519 key vs 256-byte RSA-2048 key. The public key is embedded in every installed app's Info.plist — smaller is better.
2. **Deterministic signatures**: EdDSA does not use a random nonce. RSA-PSS does. Deterministic signatures avoid timing side-channels and make signature verification consistent.
3. **Speed**: Ed25519 verification is ~10x faster than RSA-2048 on modern hardware.
4. **Apple ecosystem alignment**: Apple's Security framework and the `SecVerify` API have native Ed25519 support.

**Feed signing** (Sparkle 2.9+): The appcast XML file itself can be signed with `SURequireSignedFeed`. The signature covers the appcast + release notes. This prevents a compromised server from redirecting users to a malicious update URL.

**Key rotation**: Supported for Developer ID-signed apps. A new update can change either the Apple code signing cert OR the EdDSA key (not both simultaneously).

Source: [sparkle-project.org/documentation/](https://sparkle-project.org/documentation/), [documentation/publishing/](https://sparkle-project.org/documentation/publishing/)

### Backend Storage

Any HTTPS server. Recommended:
- Self-hosted web server (Apache, Nginx, etc.)
- GitHub Releases
- S3 / Cloudflare R2 / any object storage

The feed URL is set via `SUFeedURL` in `Info.plist`. Can be changed at runtime via `SPUUpdaterDelegate.feedURLStringForUpdater:`.

**App Transport Security**: Sparkle enforces HTTPS (per Apple's ATS requirements).

### Atomicity

- The new `.app` bundle is extracted to a temporary location.
- Code signature is verified (`codesign --verify`).
- EdDSA signature is verified.
- The new bundle is then **swapped** into place (replacing the old `.app`).
- If extraction or verification fails, the old `.app` remains untouched.
- **App translocation** (macOS Gatekeeper) can interfere: if the app is running from a read-only DMG mount, updates silently fail.

### Quit Semantics

- Sparkle **quits the app and relaunches** the new version automatically.
- `SUAutomaticallyUpdate` (user default) controls whether the user is prompted or the update is silent.
- Default: checks for updates in the background once every 24 hours.
- The user can trigger a manual check via the "Check for Updates…" menu item.
- Critical updates (`sparkle:criticalUpdate`) show a non-dismissable alert.
- Major upgrades (`sparkle:minimumAutoupdateVersion`) always show the update GUI, even if auto-update is enabled.

### Rollback

**No built-in rollback mechanism.** If an update is broken:
- The user is stuck on the broken version.
- The developer must publish a new (higher version) update to fix it.
- The user can manually re-download the old version from the developer's website.
- Sparkle does NOT keep the old `.app` after a successful update.

**Mitigation**: Use phased rollouts (`sparkle:phasedRolloutInterval`) to limit blast radius. Use `sparkle:minimumAutoupdateVersion` to gate major upgrades.

### Channels

**Mechanism**: `sparkle:channel` element in the appcast item.
- Default channel is implicit (no `sparkle:channel` element = default channel).
- An updater can subscribe to multiple channels via `SPUUpdaterDelegate.allowedChannelsForUpdater:`.
- Channels are NOT for parallel releases (e.g., "1.0 stable" and "1.0 demo"). They are for branching (e.g., "beta" updates that will eventually merge back to "default").
- Added in Sparkle 2 (June 27, 2021, [PR #1879](https://github.com/sparkle-project/Sparkle/pull/1879)).

Source: [documentation/publishing/#channels](https://sparkle-project.org/documentation/publishing/#channels)

### Phased Group Rollout

**Mechanism**: `sparkle:phasedRolloutInterval` (integer, seconds) + `<pubDate>`.
- Sparkle hardcodes **7 groups**.
- Each group gets the update one interval after the previous.
- Example: `phasedRolloutInterval=86400` (1 day) → full rollout in 7 days.
- Group ID is a random value in the app's user defaults (`SUUpdateGroupIdentifier`), regenerated on update download.
- **Does NOT apply** to critical updates or manual update checks.

Source: [documentation/publishing/#phased-group-rollouts](https://sparkle-project.org/documentation/publishing/#phased-group-rollouts)

### Production Caveats

1. **Private key in macOS Keychain** — if the Mac is lost or the Keychain is compromised, you lose the ability to sign updates. Export/backup the key with `generate_keys -x`.
2. **App translocation** — apps running from a read-only DMG mount cannot update. Sparkle silently does nothing.
3. **No rollback** — a bad update bricks the user until the next release. Use phased rollouts.
4. **DSA migration** — Sparkle 1.x used DSA signatures. If you have users on Sparkle 1.x, you must support both DSA and EdDSA during migration. See [eddsa-migration](https://sparkle-project.org/documentation/eddsa-migration).
5. **Sandboxed apps** — require the XPC services (`org.sparkle-project.Sparkle.Autoupdate` and `org.sparkle-project.Sparkle.Agent`). See [sandboxing guide](https://sparkle-project.org/documentation/sandboxing).
6. **`generate_appcast` must be re-run** after any modification to the appcast or release notes (if feed signing is enabled).
7. **Sparkle 1.x is EOL** — `SUUpdater` is a deprecated stub in Sparkle 2. New apps must use `SPUStandardUpdaterController`.

---

## Ecosystem 3: electron-updater (electron-builder)

**Repo**: [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)
**Docs**: [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update)
**Status**: Active. v26 = stable, v27 = next (breaking changes: native ESM, Node >=22.12, signed manifests required).

### Wire Format

**`latest.yml`** (YAML, generated by electron-builder, uploaded alongside the installer):

**v27 format** (`files[]` array, the default since electron-builder 27):

```yaml
version: 1.1.0
files:
  - url: TestApp Setup 1.1.0.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 62021782
    # blockMapUrl: https://example.com/blockmap-url  (optional, for pre-signed URLs)
stagingPercentage: 10
# signature: b0Qk...  (Ed25519, v27+)
# signatures:
#   - keyId: 3f9c...e1
#     signature: b0Qk...
#   - keyId: a71d...04
#     signature: Xr2w...
releaseName: v1.1.0
releaseNotes: "Bug fixes and improvements"
releaseDate: "2026-01-15T00:00:00.000Z"
```

**Legacy format** (electron-updater 1.x – 2.15.0, deprecated):

```yaml
version: 1.1.0
path: TestApp Setup 1.1.0.exe
sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
sha2: abc123...  # SHA-256 (deprecated, v28 will reject sha2-only manifests)
```

**Metadata format history**:
- `1.0.0` → `latest-mac.json` (JSON, not YAML)
- `2.15.0` → top-level `path`/`sha512` in YAML
- `2.16.0` → `files[]` array in YAML
- `7.0` (v27) → `files[]` + Ed25519 `signature`/`signatures`

The `electronUpdaterCompatibility` option controls which format is emitted (e.g., `>=7` for v27 format, `>=2.16.0` for files[] without signing, `>=1.0.0` for legacy).

**Per-platform files**: `latest.yml` (Windows), `latest-mac.yml` (macOS), `latest-linux.yml` (Linux).
Source: [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update)

### Delta Updates (Blockmap)

**Mechanism**: Content-defined chunking + HTTP Range requests (NOT bsdiff).

- electron-builder publishes a **block map file** (`<artifact>.blockmap`) next to each installer.
- The map contains content-defined blocks and their BLAKE2b hashes.
- electron-updater compares the new map with the cached map of the installed version and downloads only the byte ranges that changed, using HTTP `Range` requests.

**Two formats**:
- **v2** (legacy, for electron-updater ≤6): gzipped JSON, ~16 KiB blocks. Downloaded in full on every update. Fixed cost ~20 bytes/block.
- **v3** (default for electron-updater ≥7): uncompressed binary, 512 B – 2 KiB blocks. Fetched in parts via Range requests. Three-level layout (super-groups → groups → block records). Map cost grows with the change, not the installer size.

**Optimization for app code**:
```json
{
  "nsis": { "differentialPackage": "store-asar" },
  "asar": { "contentAlignment": 512 }
}
```
`store-asar` keeps `app.asar` uncompressed in the differential package, so a one-line change maps to a few changed blocks (~10 KB) instead of re-compressing the whole archive.

**Fallback**: If the blockmap comparison fails (format mismatch, missing cached map), electron-updater falls back to a full download.

**Supported targets**: NSIS (Windows), macOS zip, AppImage (map embedded in binary).

Source: [electron.build/docs/features/auto-update#differential-updates-blockmap](https://www.electron.build/docs/features/auto-update)

### Signing

**v27+ (current)**:
1. **Manifest signing**: Ed25519. The `latest*.yml` file itself is signed.
   - Key generation: `npx electron-builder create-update-key`
   - Private key: `ELECTRON_BUILDER_UPDATE_SIGN_KEY` (base64-encoded PEM) or `ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE`
   - Public key: embedded in `app-update.yml` as `updateManifestPublicKey`
   - What is signed: `version`, `stagingPercentage`, `minimumSystemVersion`, every file's `url`/`sha512`/`size`/`blockMapUrl`, and NSIS web installer `packages` entries
   - Verification: Before any download. Fail-closed (`ERR_UPDATER_MANIFEST_NOT_SIGNED` or `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`)
   - Key rotation: Dual-signing (old + new key) for a bridge release, then drop old key
2. **Artifact checksum**: SHA-512 (always)
3. **Windows code signing**: Authenticode (optional, separate from manifest signing)
4. **macOS code signing**: Required (Apple Developer ID)

**Pre-v27**: SHA-512 checksum only. No manifest signing.

**Signing is REQUIRED in v27**: Publishing fails unless a key resolves. `updateManifest: false` is the only opt-out (warns on every build).

Source: [electron.build/docs/features/signed-update-manifests](https://www.electron.build/docs/features/signed-update-manifests)

### Backend Storage (Provider Abstraction)

| Provider | Manifest Location | Artifact Location |
|----------|------------------|-------------------|
| GitHub Releases | Release assets | Release assets |
| GitLab Releases | Release assets | Release assets |
| Bitbucket | Release assets | Release assets |
| Amazon S3 | S3 bucket | S3 bucket |
| Cloudflare R2 | R2 bucket | R2 bucket |
| DigitalOcean Spaces | Spaces | Spaces |
| Keygen | Keygen CDN | Keygen CDN |
| Generic HTTP | Any URL | Any URL |
| Bintray | N/A (deprecated) | N/A (deprecated) |

The provider is configured in `electron-builder`'s `publish` config. The `app-update.yml` file (auto-generated, in `resources/`) tells the updater which provider to use.

**Credential isolation**: `Authorization` headers and feed query strings are only sent to the feed's origin (scheme + host + port). Cross-origin file URLs in `latest*.yml` do NOT receive the auth headers. Pre-signed URLs must be in the manifest before signing.

### Atomicity

**Per-target behavior**:

| Target | Install Mechanism | Atomicity |
|--------|-------------------|-----------|
| NSIS (per-user) | Detached installer process | Installer runs after app quit. Can be killed by OS shutdown. |
| NSIS (per-machine) | `elevate.exe` → UAC → installer | UAC prompt at install time. |
| AppImage | Replaces AppImage file | Atomic (single file swap). |
| deb/rpm/pacman | `pkexec`/`sudo` → package manager | Package manager handles atomicity. |
| macOS (Squirrel.Mac) | Native stage-and-relaunch | Atomic (app bundle swap). |

**Session-end guard** (v27+, always on): If the OS signals shutdown/reboot/logoff, the on-quit install is **skipped**. The update stays cached and installs on the next regular quit.

**Install on next launch** (v27+, opt-in): `autoUpdater.autoInstallEvent = "onNextLaunch"`. The update is installed at the start of the next launch (not during quit), avoiding the session-end race. Planned to become the default in v28.

**Residual race**: If the user launches the app during an OS shutdown, the startup install can still be killed mid-write. Probability is very low (requires deferred update + launch in shutdown window + OS kill). macOS is immune (Squirrel.Mac swaps atomically).

Source: [electron.build/docs/features/auto-update#install-on-next-launch](https://www.electron.build/docs/features/auto-update)

### Quit Semantics

`autoUpdater.autoInstallEvent` controls when the downloaded update is installed:
- `"manual"` (opt-in): No automatic install. Developer calls `quitAndInstall()`.
- `"onQuit"` (default in v27): Install when app quits. Spawns detached installer during exit.
- `"onNextLaunch"` (opt-in in v27, planned default in v28): Install at start of next launch.

Per-quit deferral: `autoUpdater.quitAndInstall({ waitUntilNextLaunch: true })` defers a single quit.
Explicit install: `await autoUpdater.installPendingUpdateIfAvailable()`.

### Rollback

**No built-in rollback.** If an update is broken:
- The user is stuck on the broken version until the next release.
- The developer must publish a higher version.
- The NSIS installer does not keep the previous version's files.

**Mitigation**: `stagingPercentage` for staged rollouts. `allowDowngrade` (opt-in) for server-directed downgrades.

### Staged Rollout

**Mechanism**: `stagingPercentage` field in `latest*.yml` (0–100).
```yaml
version: 1.1.0
files:
  - url: TestApp Setup 1.1.0.exe
    sha512: Dj51I0q8...
    size: 62021782
stagingPercentage: 10
```
- 10% of the userbase gets the update.
- **Warning**: `stagingPercentage` is covered by the manifest signature. Editing it by hand without re-signing causes `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID` on all signed installs.
- To pull a bad release: increment the version number (cannot re-publish the same version).

### Production Caveats

1. **Squirrel.Windows NOT supported** — electron-builder v27+ uses NSIS for Windows auto-update. Squirrel.Windows is explicitly excluded.
2. **Session-end race** — even with `onNextLaunch`, a launch during OS shutdown can kill the installer mid-write. [Issue #7807](https://github.com/electron-userland/electron-builder/issues/7807).
3. **Web installer disabled by default** — `disableWebInstaller: true` in v27. NSIS web installers download their payload at install time from a manifest URL, which may bypass signature verification.
4. **`sha2`-only metadata deprecated** — v27 warns, v28 rejects fail-closed.
5. **YAML alias DoS protection** — manifests with YAML aliases expanding to >100,000 values are rejected.
6. **10 MiB manifest limit** — `latest*.yml` larger than 10 MiB fails with `ERR_HTTP_RESPONSE_TOO_LARGE`.
7. **Linux GPG not enforced by default** — `allowUnverifiedLinuxPackages: true` (default). Set to `false` to enforce GPG signature checks.
8. **Key rotation requires a bridge release** — installs in the field trust the key list they shipped with. A new key must be dual-signed for one release.

---

## Ecosystem 4: Tauri 2.x Updater

**Repo**: [tauri-apps/plugins-workspace/tree/v2/plugins/updater](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater)
**Docs**: [v2.tauri.app/plugin/updater/](https://v2.tauri.app/plugin/updater/)
**Status**: Active. Tauri 2.x. Docs last updated Nov 28, 2025. Requires Rust ≥ 1.90.

### Wire Format

**Two modes**: static JSON file or dynamic update server.

**Static JSON** (for S3, GitHub Releases, any CDN):

```json
{
  "version": "1.0.0",
  "notes": "Bug fixes",
  "pub_date": "2026-01-15T00:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "MEUCIQ...",
      "url": "https://releases.example.com/linux/myapp.AppImage"
    },
    "windows-x86_64": {
      "signature": "MEUCIQ...",
      "url": "https://releases.example.com/windows/myapp-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "MEUCIQ...",
      "url": "https://releases.example.com/macos/myapp.app.tar.gz"
    }
  }
}
```

Required keys: `version`, `platforms.<target>.url`, `platforms.<target>.signature`.
Optional: `notes`, `pub_date` (RFC 3339).

Platform key format: `OS-ARCH` where OS ∈ {`linux`, `darwin`, `windows`}, ARCH ∈ {`x86_64`, `aarch64`, `i686`, `armv7`}.

**Dynamic server** (server decides if an update exists):

Request: `GET https://releases.example.com/{target}/{arch}/{current_version}`
- `{{current_version}}`, `{{target}}`, `{{arch}}` are template variables in the endpoint URL.

Response (no update): `HTTP 204 No Content`
Response (update available): `HTTP 200 OK` + JSON:

```json
{
  "version": "1.0.1",
  "pub_date": "2026-01-16T00:00:00Z",
  "url": "https://releases.example.com/windows/myapp-setup.exe",
  "signature": "MEUCIQ...",
  "notes": "Bug fixes"
}
```

Required keys: `version`, `url`, `signature`.
Optional: `pub_date`, `notes`.

Source: [v2.tauri.app/plugin/updater/#server-support](https://v2.tauri.app/plugin/updater/#server-support)

### Delta Updates

**Not supported.** Tauri's updater downloads the full installer/bundle every time. There is no blockmap, no bsdiff, no delta mechanism.

Rationale (inferred): Tauri apps are small (~10–20 MB for the installer). The complexity of a delta mechanism is not justified for the typical payload size. The Rust ecosystem lacks a mature binary diff library with the same maturity as bsdiff.

### Signing

**Algorithm**: **Ed25519**
- Key generation: `npm run tauri signer generate -- -w ~/.tauri/myapp.key`
- Private key: `TAURI_SIGNING_PRIVATE_KEY` env var (path or content) during build. Optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Public key: `tauri.conf.json` → `plugins.updater.pubkey` (content, NOT a file path)
- What is signed: The installer/bundle file
- Signature location: `.sig` file alongside the installer (e.g., `myapp-setup.exe.sig`)
- In the JSON: the `signature` field contains the content of the `.sig` file

**Cannot be disabled**: "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled."

**Key rotation**: Supported at runtime via `UpdaterBuilder::pubkey()` or `tauri_plugin_updater::Builder::new().pubkey()`.

**Build artifacts per platform**:
- Linux: `myapp.AppImage` + `myapp.AppImage.sig`
- macOS: `myapp.app.tar.gz` + `myapp.app.tar.gz.sig`
- Windows: `myapp-setup.exe` + `myapp-setup.exe.sig` (NSIS) or `myapp.msi` + `myapp.msi.sig`

Source: [v2.tauri.app/plugin/updater/#signing-updates](https://v2.tauri.app/plugin/updater/#signing-updates)

### Backend Storage

Any HTTPS server (TLS enforced in production mode). Documented options:
- Static JSON on S3 / Cloudflare R2 / GitHub Releases / any CDN
- Dynamic update server (custom backend)
- GitHub Releases with Tauri Action (auto-generates the static JSON)
- CrabNebula Cloud (official Tauri partner, dynamic server)

The `endpoints` array in `tauri.conf.json` supports fallback: Tauri tries each URL in order and continues to the next only on a non-2XX status code.

### Atomicity

**Platform-specific**:
- **Windows**: The application is **automatically exited** before the installer runs (Windows installer limitation — cannot replace running files). The NSIS/MSI installer then runs. `on_before_exit` hook allows cleanup before the forced exit.
- **macOS**: The `.tar.gz` is extracted and the `.app` bundle is swapped. The user must restart the app (or `app.restart()` is called).
- **Linux**: The AppImage is replaced. The user must restart.

**No transactional install**: If the installer fails mid-write (e.g., disk full, permission error), the state is undefined. The old version may be partially overwritten.

### Quit Semantics

- **Windows**: Forced exit during install. `on_before_exit` hook for cleanup.
- **macOS/Linux**: User-initiated restart. "Restarting your app immediately after installing an update is not required and you can choose how to handle the update by either waiting until the user manually restarts the app, or prompting them to select when to do so."
- `app.restart()` (Rust) or `relaunch()` (JS via `@tauri-apps/plugin-process`) triggers the restart.

### Rollback

**No built-in rollback.** The updater has no mechanism to revert to a previous version.

**Workaround**: Use the `version_comparator` API to allow downgrades:
```rust
let update = app
    .updater_builder()
    .version_comparator(|current, update| {
        update.version != current  // allow any version change
    })
    .build()?
    .check()
    .await?;
```
This allows the server to direct a downgrade, but it is not automatic.

### Staged Rollout

**No built-in mechanism.** The static JSON has no `stagingPercentage` or channel field. The dynamic server can implement rollout logic (the server sees `{{current_version}}`, `{{target}}`, `{{arch}}` and can return 204 or 200 based on its own logic).

### Multi-Channel

**Not built-in, but possible via runtime configuration**:
```rust
let channel = if beta { "beta" } else { "stable" };
let update_url = format!("https://{}.myserver.com/{{target}}-{{arch}}/{{current_version}}", channel);
let update = app
    .updater_builder()
    .endpoints(vec![update_url])?
    .build()?
    .check()
    .await?;
```
The `UpdaterBuilder` allows setting endpoints at runtime, enabling per-session channel selection.

### Production Caveats

1. **Windows forced exit** — the app is killed before install. Any unsaved state is lost. `on_before_exit` is the only hook.
2. **No delta updates** — every update downloads the full installer. For a 50 MB installer, this is 50 MB on every update.
3. **No built-in staged rollout** — must be implemented in the dynamic server.
4. **`createUpdaterArtifacts: "v1Compatible"` will be removed in Tauri 3** — migrate to `true`.
5. **`.env` files do NOT work** for `TAURI_SIGNING_PRIVATE_KEY` — must be a real environment variable.
6. **Custom targets** (e.g., `macos-universal`) change the platform key matching. The `{{arch}}` variable may need to be removed.
7. **TLS enforced in production** — `dangerousInsecureTransportProtocol: true` is required for HTTP endpoints (not recommended).
8. **The whole static JSON is validated before version check** — if any platform entry is malformed, the entire update check fails for all platforms.

---

## Ecosystem 5: @capawesome/capacitor-live-update

**Repo**: [capawesome-team/capacitor-plugins](https://github.com/capawesome-team/capacitor-plugins) (packages/live-update)
**NPM**: [`@capawesome/capacitor-live-update`](https://www.npmjs.com/package/@capawesome/capacitor-live-update)
**Version**: 8.7.1 (published ~17 days before 2026-01)
**Status**: Active. Supports Capacitor 6/7/8. Android, iOS, Electron.

### Wire Format

**No public manifest spec.** The update protocol is proprietary to Capawesome Cloud. The client communicates with the Capawesome Cloud API (or a self-hosted bundle URL).

**What the client sends**:
- `appId` (UUID from Capawesome Cloud)
- `channel` (string, e.g. `"production"`, `"production-5"`)
- `deviceId` (platform-specific: `adb` device ID on Android, `identifierForVendor` on iOS)
- `versionCode` / `versionName` (native app version)
- `httpTimeout` (ms)

**What the client receives** (inferred from API):
- `bundleId` (UUID) — identifier of the bundle to download
- Download URL for the bundle (zip file)
- Rollout percentage (server-side, not exposed in the API)

**Self-hosted mode**: `downloadBundle({ url: 'https://example.com/1.0.0.zip', bundleId: '1.0.0' })` — the developer controls the URL and bundle ID directly. No Capawesome Cloud dependency.

### Bundle Strategy

- A **bundle** is a zip file containing the web assets (HTML, JS, CSS, images).
- The **default bundle** is the one shipped with the native app binary.
- Downloaded bundles are stored locally with their `bundleId`.
- `setNextBundle({ bundleId })` marks a bundle to be used on next `reload()` or app restart.
- `reload()` reloads the webview (does NOT restart the native process).
- `getCurrentBundle()` / `getNextBundle()` for inspection.
- `getBundles()` / `getDownloadedBundles()` for listing.
- `deleteBundle({ bundleId })` for cleanup.
- `autoDeleteBundles: true` — auto-delete unused bundles after `ready()`.

### Signing

**Algorithm**: **RSA** (PEM-encoded public key)
- `publicKey` config: PEM-encoded RSA public key string
- What is signed: The bundle (zip file)
- Verification: Client verifies the bundle's authenticity and integrity using the public key
- The private key stays on the Capawesome Cloud (or the developer's self-hosted server)

**Key type**: RSA (not Ed25519). The docs show a PEM key starting with `MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD...` which is an RSA-1024 key (128 bytes). The actual key size in production is likely RSA-2048 or higher.

### Backend Storage

- **Capawesome Cloud** (`api.cloud.capawesome.io` or custom `serverDomain`): Hosted service, manages bundles, channels, rollout percentages.
- **Self-hosted URL**: Any HTTPS URL serving a zip file. `downloadBundle({ url })` bypasses the cloud entirely.

### Atomicity

- The default bundle (shipped with the native app) is **always available** and cannot be deleted.
- A downloaded bundle is set as "next" and applied on `reload()` or app restart.
- If the new bundle fails to load (crash, timeout), the plugin can roll back to the default bundle.
- **Kill-safe rollback** (Electron): If the app is closed or crashes before `ready()` is called, the rollback is performed on the next app start.

### Quit Semantics

**No quit needed.** The update is applied by reloading the webview:
- `reload()` — reloads the webview. Native process is NOT restarted.
- In-memory state (unsaved user input, IndexedDB, WebSockets) is lost on reload.
- Resources holding exclusive locks (IndexedDB, WebSockets) must be released before `reload()`.

### Rollback

**Built-in, multi-layered**:
1. **`ready()` timeout**: If `readyTimeout` is set (e.g., 10000 ms) and `ready()` is not called within that time, the plugin resets to the default bundle. This catches crashes during app initialization.
2. **`reset()`**: Explicit reset to the default bundle. Call `reload()` or restart to apply.
3. **`autoBlockRolledBackBundles`** (7.3.0+): When enabled, bundles that caused a rollback are automatically blocked (up to 100 bundles, LRU eviction). Blocked bundles are skipped in future sync operations.
4. **`clearBlockedBundles()`**: Manually clear the blocked list.

**What the user sees**: If rollback triggers, the user sees the old (default) version — not a corrupted half-update. The webview is reloaded with the default bundle's assets.

### Delta Updates

**Supported** (mentioned as a feature: "Make your updates faster by only downloading changed files"). The mechanism is not publicly documented — it is likely handled server-side by Capawesome Cloud.

### Channels

**Multi-channel, versioned**:
- `defaultChannel` in `capacitor.config.json` (or `Info.plist` / `strings.xml` / `capacitor.electron.config.ts` on each platform)
- `setChannel({ channel })` — persisted across app restarts
- `sync({ channel })` — one-time channel override (not persisted)
- Versioned channels: `production-5` (channel name + version code)
- `fetchChannels()` — list available channels (public channels only)
- Channel resolution priority: `sync({channel})` > native config > Capacitor config > `setChannel()`

### Staged Rollout

**Supported** (server-side). The Capawesome Cloud handles rollout percentages. The client API does not expose the percentage — the server decides whether to return a bundle for a given device.

### Production Caveats

1. **Webview resource locks** — IndexedDB and WebSockets are not released automatically on `reload()`. Must be released manually or defer the update to the next app start.
2. **No public manifest spec** — the wire format is proprietary. Self-hosted mode only supports `downloadBundle({ url, bundleId })` — there is no manifest to inspect.
3. **RSA-1024 in docs example** — the example `publicKey` in the docs is RSA-1024. Production should use RSA-2048 minimum. Verify what key size Capawesome Cloud actually uses.
4. **`readyTimeout` is strongly recommended** — without it, a crash during init leaves the app on the broken bundle until the user manually resets.
5. **`autoBlockRolledBackBundles` caps at 100** — after 100 rollbacks, the oldest blocked bundle is unblocked. In a rapid crash-loop scenario, a bad bundle could be retried.
6. **Electron differences** — only `zip` artifact type. Bundles stored in `userData/capacitor-live-update/`. App version from `electron/package.json`.
7. **Ionic Live Update Provider SDK** — the plugin implements the Ionic SDK contract. Federated Capacitor and Ionic Portals use this plugin as their live update provider.

---

## Ecosystem 6: Capacitor Live Update (Official, Deprecated)

**Original**: Part of Ionic Appflow (not a standalone npm package)
**Status**: **DEPRECATED**. Replaced by `@capawesome/capacitor-live-update`.
**Migration**: [Migrating from Ionic Appflow to Capawesome Cloud](https://capawesome.io/blog/migrating-from-ionic-appflow-to-capawesome-cloud/)

### What Was Removed

The original "Capacitor Live Update" was not a standalone open-source plugin. It was a feature of **Ionic Appflow**, a paid cloud service by Ionic. When Ionic deprecated Appflow (announced 2024), the live update capability was orphaned.

Key differences from the Cap Awesome replacement:

| Feature | Ionic Appflow (deprecated) | Cap Awesome (active) |
|---------|---------------------------|---------------------|
| Open source | No (proprietary) | Yes (MIT) |
| Self-hosted | No | Yes (`downloadBundle({ url })`) |
| Delta updates | Yes (proprietary) | Yes |
| Channels | Yes (Appflow UI) | Yes (API + config) |
| Rollback | Manual (Appflow UI) | Automatic (`ready()` timeout) + manual |
| Electron support | No | Yes |
| Staged rollout | Yes (Appflow UI) | Yes (server-side) |
| Bundle verification | Unknown (proprietary) | RSA public key |
| Versioned channels | No | Yes |
| `autoBlockRolledBackBundles` | No | Yes (7.3.0+) |

The Cap Awesome plugin is a **superset** of the original functionality, with the addition of self-hosting, Electron support, and explicit rollback semantics.

### Production Caveats

1. **No longer available** — Ionic Appflow is deprecated. Any app still using it will break.
2. **No public migration tool** — the migration guide is a blog post, not an automated tool.
3. **Bundle format may differ** — if the original Appflow used a different bundle format, existing bundles may not be compatible with the Cap Awesome plugin.

---

## Ecosystem 7: Expo Updates (EAS Update)

**Repo**: [expo/expo](https://github.com/expo/expo) (packages/expo-updates)
**Protocol spec**: [docs.expo.dev/technical-specs/expo-updates-1/](https://docs.expo.dev/technical-specs/expo-updates-1/)
**Status**: Active. Protocol v1 (modified Aug 12, 2026). EAS Update is the hosted implementation.

### Wire Format

**Expo Updates Protocol v1** — a formal HTTP protocol with a JSON manifest.

**Request** (client → server):
```http
GET /updates/latest HTTP/1.1
expo-protocol-version: 1
expo-platform: ios
expo-runtime-version: 1
expo-manifest-filters: channel="production"
accept: application/expo+json;q=0.9, application/json;q=0.8, multipart/mixed
```

Required headers:
- `expo-protocol-version: 1`
- `expo-platform`: `ios` or `android`
- `expo-runtime-version`: developer-defined string (native code compatibility)
- Any headers from `expo-server-defined-headers` in a previous response

Optional:
- `expo-expect-signature`: Expo SFV dictionary for code signing
  - `sig=true`, `keyid="root"`, `alg="rsa-v1_5-sha256"`

**Response** (server → client):

`Content-Type: application/json` or `application/expo+json`:
```
expo-protocol-version: 1
expo-sfv-version: 0
expo-manifest-filters: channel="production"
expo-server-defined-headers: device-id="abc123"
cache-control: private, max-age=0
content-type: application/expo+json
expo-signature: sig="base64sig", keyid="root", alg="rsa-v1_5-sha256"
```

**Manifest body** (JSON):

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "createdAt": "2026-01-15T10:30:00.000Z",
  "runtimeVersion": "1",
  "launchAsset": {
    "hash": "base64url-sha256-here",
    "key": "launch",
    "contentType": "application/javascript",
    "url": "https://updates.example.com/assets/launch-abc123.js"
  },
  "assets": [
    {
      "hash": "base64url-sha256-here",
      "key": "main",
      "contentType": "application/javascript",
      "fileExtension": ".js",
      "url": "https://updates.example.com/assets/main-def456.js"
    },
    {
      "hash": "base64url-sha256-here",
      "key": "logo",
      "contentType": "image/png",
      "fileExtension": ".png",
      "url": "https://updates.example.com/assets/logo-ghi789.png"
    }
  ],
  "metadata": {
    "channel": "production"
  },
  "extra": {
    "eas": {
      "projectId": "00000000-0000-0000-0000-000000000000"
    }
  }
}
```

**TypeScript schema**:
```ts
type Manifest = {
  id: string;           // UUID
  createdAt: string;    // ISO 8601
  runtimeVersion: string;
  launchAsset: Asset;   // entry point JS bundle
  assets: Asset[];      // other assets (JS, images, fonts)
  metadata: { [key: string]: string };  // server-controlled filters
  extra: { [key: string]: any };        // freeform
};

type Asset = {
  hash?: string;        // base64url SHA-256
  key: string;          // reference key
  contentType: string;  // MIME type
  fileExtension?: string; // e.g. ".js", ".png"
  url: string;          // fetch URL
};
```

**Multipart response** (supports directives):
- `Content-Type: multipart/mixed`
- Parts: `manifest` (optional), `extensions` (optional), `directive` (optional)

**Directive body** (JSON):
```json
{
  "type": "rollBackToEmbedded",
  "parameters": {},
  "extra": {}
}
```
The `rollBackToEmbedded` directive tells the client to use the update embedded in the host app binary instead of any downloaded update.

**Asset request** (client → server):
```http
GET /assets/main-def456.js HTTP/1.1
accept: application/javascript, */*
accept-encoding: br, gzip
```

**Asset response**:
```
content-encoding: br
content-type: application/javascript
cache-control: public, max-age=31536000, immutable
```

**Asset immutability**: "An asset located at a particular URL MUST NOT be changed or removed since client libraries may fetch assets for any update at any time."

Source: [docs.expo.dev/technical-specs/expo-updates-1/](https://docs.expo.dev/technical-specs/expo-updates-1/)

### Delta Updates (Asset-Level Reuse)

**Not true delta, but asset-level caching**:
- The client downloads the manifest first (phase 1).
- Then downloads only assets it does not already have locally (phase 2).
- Unchanged assets (same `key`, same `hash`) are NOT re-downloaded.
- This is more efficient than true binary delta for the typical Expo update (a changed JS bundle + a few images), where the JS bundle is the dominant payload.

**`fallbackToCacheTimeout`**: If the manifest + assets are not fully downloaded within this timeout, the app runs the old (cached) update and continues downloading in the background. The new update is available on the next launch.

### Signing

**Algorithm**: **RSA** (`rsa-v1_5-sha256` per the spec example)
- The client sends `expo-expect-signature` header to request a signed manifest.
- The server responds with `expo-signature` header containing the signature.
- The signature covers the manifest body.
- The manifest transitively signs the assets (their SHA-256 hashes are in the manifest).
- **Certificate chain verification**: The signing certificate must be either a self-signed trusted root or in a chain signed by a trusted root. The root certificate MUST be embedded in the application or device OS.
- `keyid` and `alg` in the signature allow the client to select the correct certificate.

### Backend Storage

- **EAS Update** (Expo's hosted service): Implements the full protocol. Manages branches, channels, runtime versions.
- **Custom server**: Any server implementing the Expo Updates v1 protocol. Reference implementation: [expo/custom-expo-updates-server](https://github.com/expo/custom-expo-updates-server).

### Channel / Branch Model

- **Branch**: A named list of updates (like a Git branch). The most recent update on a branch is the "active update."
- **Channel**: A named group of builds. A channel is linked to a branch (default: same name).
- **Runtime version**: A string in the native app binary. An update's `runtimeVersion` must exactly match the build's for the update to be delivered.
- **Platform**: Must match exactly (`ios` / `android`).

**Update policy**:
1. Platform of build == target platform of update (exact match)
2. Runtime version of build == runtime version of update (exact match)
3. Channel of build is linked to the branch containing the update

**Rollout via channel re-linking**:
```sh
eas channel:edit production --branch version-2.0
```
This atomically switches all "production" channel builds to the latest update on "version-2.0" branch.

Source: [docs.expo.dev/eas-update/how-it-works/](https://docs.expo.dev/eas-update/how-it-works/)

### Atomicity

- All assets are downloaded to disk before the update is executed.
- If the download is incomplete (timeout, network loss), the old update runs and the download continues in the background.
- The update database persists across app restarts.
- `rollBackToEmbedded` directive can force a rollback to the embedded (build-time) update.

### Quit Semantics

**No quit needed.** The new update is applied on the next app launch:
- If the manifest + assets are downloaded before `fallbackToCacheTimeout`, the new update runs immediately on the next launch.
- If not, the old update runs and the new one is picked up on the subsequent launch.

### Rollback

1. **`rollBackToEmbedded` directive**: Server sends a directive telling the client to use the embedded update.
2. **Channel re-linking**: Point the channel back to an older branch.
3. **Asset immutability**: Old assets remain available at their URLs (MUST NOT be deleted), so old updates remain fetchable.

### Production Caveats

1. **`runtimeVersion` is a hard gate** — a mismatch means the update is invisible to the client. Changing native code requires a new `runtimeVersion` and a new build.
2. **Asset immutability is a storage commitment** — assets at a given URL must never change. This means you cannot re-encode or re-compress an asset after publishing.
3. **`cache-control: private, max-age=0`** is recommended for the manifest — CDN caching can serve stale manifests.
4. **Multipart response for directives** — the JSON-only response format does NOT support directives. A server that needs to send `rollBackToEmbedded` must use `multipart/mixed`.
5. **`expo-manifest-filters` is a persistent filter** — the client stores it until overwritten. A malformed filter could permanently exclude updates.
6. **Expo SFV version is 0** — the structured field value format is at version 0. Future changes may break compatibility.
7. **No delta for the JS bundle** — the entire JS bundle is re-downloaded if it changes. For large apps, this can be several MB.

---

## Ecosystem 8: CodePush / App Center (DEPRECATED)

**Repo**: [microsoft/code-push](https://github.com/microsoft/code-push) — **archived May 20, 2025**
**Service**: Visual Studio App Center — **retired March 31, 2025**
**Status**: **DEAD**. No longer operational.

### Sunset Timeline

| Date | Event |
|------|-------|
| March 31, 2025 | App Center (including CodePush) retired. Analytics and Diagnostics extended. |
| May 20, 2025 | GitHub repository archived (read-only). |
| — | Recommended replacements: Expo Updates (for React Native), Cap Awesome (for Cordova/Capacitor). |

### Wire Format (Historical)

CodePush used a **ZIP bundle** deployed via the App Center REST API.

**Server endpoints** (v4.0.0+):
- Base URL: `https://api.appcenter.ms/v0.1`
- Deployments: `GET /apps/{owner}/{app}/deployments/`
- Release: `POST /apps/{owner}/{app}/deployments/{deployment}/releases`
- Rollback: `POST /apps/{owner}/{app}/deployments/{deployment}/rollback`

**Client protocol** (react-native-code-push):
1. Client sends `GET` to the App Center update endpoint with:
   - `appVersion` (native binary version)
   - `deploymentKey` (secret, identifies the deployment)
   - `clientInfo` (OS, device model, app version)
2. Server responds with either:
   - `UPDATE_AVAILABLE` + package metadata (label, package URL, packageHash, packageSize, mandatory)
   - `UPDATE_IGNORED` (no update for this client)
3. Client downloads the ZIP bundle from the package URL.
4. Client verifies the bundle hash (MD5 or SHA-256, depending on version).
5. Client applies the bundle (extracts JS files, replaces the app's JS bundle).

**Package format**: ZIP containing the React Native JS bundle + assets. The bundle is NOT the full app — only the JavaScript layer. Native code is unchanged.

**Deployment key**: A long-lived secret string that identifies the deployment. It is embedded in the app binary. There is no cryptographic signing — the deployment key is the only authentication.

### Signing

**None.** CodePush had NO cryptographic signing of the bundle. Protection was:
- HTTPS (TLS) for transport
- Deployment key for authentication (a shared secret, not a signature)
- Bundle hash (MD5/SHA-256) for integrity (not authenticity)

This is a significant security gap compared to all other ecosystems in this document. A compromised App Center server could distribute a malicious bundle to all clients.

### Backend Storage

- **App Center cloud** (Azure-based): `api.appcenter.ms`. Now retired.
- **Self-hosted**: `code-push-server` (open-source, [microsoft/code-push-server](https://github.com/microsoft/code-push-server)). Compatible with the CodePush SDK.

### Atomicity

- The ZIP bundle is downloaded and extracted to a local directory.
- The old bundle is retained until the new one is verified.
- If the new bundle fails to load (crash on startup), CodePush could roll back to the previous bundle.

### Quit Semantics

**No quit needed.** The JS bundle is swapped in-memory. The app reloads the new JS bundle on the next navigation or explicit `CodePush.restart()` call.

### Rollback

**Server-side rollback**: `codePush.rollback(appName, deploymentName, targetRelease?)` — reverts the deployment to a previous release. The next client check picks up the older bundle.

**Client-side**: If the new bundle crashes, the SDK could fall back to the previous bundle (implementation-dependent).

### Migration Path

| From | To | Notes |
|------|----|-------|
| CodePush (React Native) | Expo Updates | Expo is the recommended successor. `eas update` replaces `code-push deploy`. |
| CodePush (Cordova) | Cap Awesome Live Update | Cap Awesome supports Cordova via Capacitor. |
| App Center Distribution | TestFlight / Play Internal | Native app distribution. |
| App Center Analytics | Firebase / Mixpanel / self-hosted | Separate migration. |

The CodePush SDK v4.0.0+ changed the server URL from `codepush-management.azurewebsites.net` to `api.appcenter.ms/v0.1`. Both are now dead.

### Production Caveats

1. **Service is dead** — no updates, no support, no security patches.
2. **No signing** — the lack of cryptographic signing was a known weakness.
3. **Deployment key in binary** — a long-lived secret in the app binary. If the binary is reverse-engineered, the key is exposed.
4. **MD5 hash** (older versions) — collision-prone. SHA-256 was added later but was not the default.
5. **Self-hosted server is also unmaintained** — `code-push-server` has not been updated since the retirement.

---

## Ecosystem 9: PWA Service Worker Update Lifecycle

**Spec**: [W3C Service Workers Nightly](https://w3c.github.io/ServiceWorker/) — Editor's Draft, 29 October 2026
**Published version**: [W3C Service Workers 1](https://www.w3.org/TR/service-workers/) — advancing toward Recommendation
**MDN**: [developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
**Status**: Active. Implemented in all major browsers.

### Wire Format

**The "update" is the service worker script itself** (a JavaScript file). There is no separate manifest — the SW script IS the update payload.

**Update check** (browser-initiated):
1. Browser fetches the SW script from its registered URL.
2. Browser compares the fetched script **byte-wise** against the currently installed script.
3. If different (or first install), the new script enters the `installing` state.

**PWA manifest** (`manifest.webmanifest`) is separate from the SW update mechanism — it describes app metadata (name, icons, theme, start URL) and is NOT part of the update protocol.

**SW script lifecycle states** (W3C spec §2.1):
```
parsed → installing → installed → activating → activated → redundant
```
- `parsed`: Script fetched, not yet installed.
- `installing`: `install` event dispatching. `waitUntil()` can extend this.
- `installed`: Install succeeded. Waiting to activate.
- `activating`: `activate` event dispatching.
- `activated`: Ready to handle `fetch` events.
- `redundant`: Failed or replaced.

### Update Timing

**When the browser checks for a new SW** (W3C spec §2.3.1):
1. A navigation to an in-scope page occurs.
2. An event is fired on the SW and it hasn't been downloaded in the last **24 hours** (86400 seconds).

The registration is "stale" if `last update check time` is > 86400 seconds ago. The browser MUST perform an update check when the registration is stale and an in-scope navigation occurs.

**`updateViaCache`** registration option:
- `"imports"` (default): Only the SW script and its imports are fetched from the network. Other resources use cache.
- `"all"`: All resources are fetched from the network.
- `"none"`: No cache is used for any resource. All fetched from network.

This controls what the update check fetches — it does NOT affect the update mechanism itself.

Source: [w3c.github.io/ServiceWorker/](https://w3c.github.io/ServiceWorker/), [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

### skipWaiting() + clients.claim()

**Default behavior**: A new SW is installed in the background as the "worker in waiting." It activates only when NO clients (pages) are using the old SW. This means the update takes effect on the **next navigation** after all tabs using the old SW are closed.

**Immediate activation** (the pattern most PWA update flows use):

```javascript
// In the new SW script:
self.addEventListener('install', (event) => {
  self.skipWaiting();  // Become active immediately, don't wait for old SW to be unused
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      // Clean up old caches
      const cacheNames = ['v1', 'v2'];
      return Promise.all(
        caches.keys().then(names =>
          names.filter(name => !cacheNames.includes(name))
               .map(name => caches.delete(name))
        )
      );
    })
  );
});
```

- `skipWaiting()`: The new SW transitions from `installed` to `activating` immediately, without waiting for all clients to unload.
- `clients.claim()`: The new active SW claims control of ALL existing clients (pages) in its scope. Those pages now use the new SW for subsequent fetches.
- **Caveat**: Already-loaded resources (the page's HTML, CSS, JS) are NOT re-fetched. Only subsequent requests go through the new SW. The page must be reloaded (or the user navigates) to fully benefit from the update.

**`registration.update()`**: Forces an immediate update check (bypasses the 24-hour staleness). Called by the page or by a background sync mechanism.

```javascript
navigator.serviceWorker.ready.then(reg => reg.update());
```

### Delta Updates

**Not supported.** The SW script is replaced whole. There is no binary diff mechanism. The browser downloads the full new script and compares it byte-wise.

**Workaround**: If the SW script is small (< 50 KB), the full download is negligible. For larger SWs, code-split the logic into dynamically imported modules that are cached separately.

### Signing

**None.** The SW script is protected by HTTPS/TLS only. There is no cryptographic signature on the SW script.

The browser trusts the HTTPS certificate of the origin. A MITM attacker with a valid certificate (e.g., a compromised CA) could replace the SW script.

**CSP (Content Security Policy)** can restrict where the SW script is loaded from:
```
Content-Security-Policy: script-src 'self' https://trusted-origin.com
```

### Backend Storage

Any HTTPS server. The SW script is a static JS file served from the origin. No special storage requirements.

**CDN considerations**: The SW script should be served with `Cache-Control: no-cache` (or `max-age=0`) to ensure the browser re-fetches it on each update check. The SW script's URL must not change (changing the URL creates a new SW registration).

### Atomicity

- The new SW is installed to a separate slot. The old SW continues to serve traffic until the new one activates.
- If the `install` event handler fails (uncaught exception, `waitUntil` promise rejects), the new SW transitions to `redundant` and the old SW continues.
- If the `activate` event handler fails, the new SW becomes `redundant` and the old SW (if still active) continues.
- **No partial state**: Either the old SW is active or the new SW is active. There is no half-installed state.

### Quit Semantics

**No quit concept** — the browser manages the SW lifecycle. The user does not "quit" the app. The update takes effect when:
- All tabs using the old SW are closed (default), OR
- `skipWaiting()` is called (immediate), OR
- The user navigates to a new page (new SW takes over).

**Practical pattern**:
1. Page detects a new SW is waiting: `navigator.serviceWorker.getRegistrations()` → check `waiting` property.
2. Page prompts the user: "Update available. Reload to apply?"
3. User clicks "Reload" → `window.location.reload()`.
4. New SW handles the reload with the new code.

### Rollback

**No built-in rollback.** If a new SW is broken:
- The developer deploys a new (fixed) SW script.
- The browser's 24-hour check (or `registration.update()`) picks up the fix.
- Users who already activated the broken SW are stuck until the next check.

**Mitigation**:
- Use `skipWaiting()` + `clients.claim()` carefully — a broken SW that activates immediately affects all users instantly.
- Use the **stale-while-revalidate** caching strategy: serve the old cached content while fetching the new version. If the new version fails, serve the old.
- Use **versioned cache names** (`cache-v1`, `cache-v2`) and clean up old versions in the `activate` handler.

### Staged Rollout

**No built-in mechanism.** The browser does not support percentage-based rollouts.

**Workarounds**:
1. **Server-side A/B testing**: The server returns different SW script versions based on cookies, headers, or IP. The SW script URL is the same, but the content differs. (This works because the update check is byte-wise — different bytes = new SW.)
2. **Separate SW URLs**: Different user segments register different SW URLs (different scopes). This is complex and fragile.
3. **Feature flags**: The SW script checks a remote config endpoint and enables/disables features. The SW itself is the same for all users.

### Production Caveats

1. **24-hour update check** — the browser only checks for a new SW every 24 hours (or on navigation if stale). A critical fix can take up to 24 hours to reach users. `registration.update()` forces an immediate check but requires the page to be loaded.
2. **`skipWaiting()` is dangerous** — a broken SW that calls `skipWaiting()` affects all users immediately, with no gradual rollout.
3. **No signing** — HTTPS is the only protection. A compromised CDN or origin can distribute a malicious SW.
4. **SW script URL is immutable** — changing the URL creates a new registration, orphaning the old one. The old SW must be explicitly unregistered.
5. **`importScripts()` is synchronous** — the SW script's `importScripts()` calls are blocking. A slow CDN can delay SW installation.
6. **No `import()`** — dynamic `import()` is not allowed in SW classic scripts. Use static `import` (module SWs) or `importScripts()`.
7. **Cache cleanup in `activate`** — if the `activate` handler fails to clean up old caches, disk space grows unboundedly.
8. **Safari quirks** — Safari has historically had bugs with `skipWaiting()` and `clients.claim()`. Test on iOS Safari before relying on immediate activation.
9. **Workbox recipes** — [Google's Workbox library](https://developers.google.com/toolbox/workbox) provides pre-built caching strategies (cache-first, stale-while-revalidate, network-first, network-only, cache-only) that can be composed for update-safe caching.

---

## Ecosystem 10: Microsoft AppInstaller / MSIX

**Docs**: [learn.microsoft.com/en-us/windows/msix/](https://learn.microsoft.com/en-us/windows/msix/) (updated 2026-04-10)
**Schema**: [App Installer file schema](https://learn.microsoft.com/en-us/windows/uwp/schemas/appinstallerschema/schema-root)
**Status**: Active. Windows 10/11. Part of the Windows App SDK ecosystem.

### Wire Format

**AppInstaller XML** — a standalone XML file that references the MSIX bundle and defines update policy.

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstallerSchema xmlns="cap:packageSchema"
                    xmlns:msix="cap:package"
                    Version="1.0">

  <MainPackage
    Name="Com.AIRIZ.MotorConsole"
    Publisher="CN=Airiz Motors, O=Airiz, L=Shanghai, C=CN"
    Version="1.2.0.0"
    Uri="https://releases.airiz.com/motorconsole/AIRIZ.MotorConsole_1.2.0.0_x64.msix"
    SignatureSha256Contiguous="abc123def456..." />

  <UpdatePolicy
    Cycle="1440"
    Start="09:00"
    Duration="04:00"
    StagedRollout="3" />

  <DisplayLogo Uri="https://releases.airiz.com/motorconsole/logo.png" />
  <Logo Uri="https://releases.airiz.com/motorconsole/logo-large.png" />
  <Capabilities>
    <msix:Capability Name="internetClient" />
  </Capabilities>

</AppInstallerSchema>
```

**Key schema elements**:

| Element | Attribute | Type | Required | Notes |
|---------|-----------|------|----------|-------|
| `MainPackage` | `Name` | string | Yes | Package family name |
| `MainPackage` | `Publisher` | string | Yes | Certificate subject |
| `MainPackage` | `Version` | string (4-part) | Yes | e.g. "1.2.0.0" |
| `MainPackage` | `Uri` | URL | Yes | MSIX bundle location |
| `MainPackage` | `SignatureSha256Contiguous` | base64 | No | SHA-256 of the MSIX |
| `UpdatePolicy` | `Cycle` | integer (minutes) | No | Check interval (default: 1440 = 24h) |
| `UpdatePolicy` | `Start` | time (HH:MM) | No | Start of update window |
| `UpdatePolicy` | `Duration` | duration (HH:MM) | No | Length of update window |
| `UpdatePolicy` | `StagedRollout` | integer (days) | No | Staged rollout period |
| `DisplayLogo` | `Uri` | URL | No | 50x50 icon |
| `Logo` | `Uri` | URL | No | 50x50 or larger |
| `Capabilities` | — | — | No | Required capabilities |

**Why AppInstaller XML exists**: The MSIX bundle is a static file. The AppInstaller XML is a **live pointer** — it can be updated without re-publishing the MSIX. This enables:
- Changing the MSIX URL (e.g., moving from S3 to a CDN) without users re-downloading the XML.
- Adjusting the update policy (cycle, window, staged rollout) without a new MSIX.
- Pointing to a different MSIX version for staged rollout.

Source: [learn.microsoft.com/en-us/windows/msix/](https://learn.microsoft.com/en-us/windows/msix/), [App Installer file schema](https://learn.microsoft.com/en-us/windows/uwp/schemas/appinstallerschema/schema-root)

### Signing

**Algorithm**: **Authenticode** (Windows code signing, same as .exe/.dll signing)
- The MSIX bundle is signed with a Windows EV or OV code signing certificate.
- The AppInstaller XML is NOT signed (it is a pointer, not an executable).
- Windows verifies the MSIX signature on install. An invalid signature blocks installation.
- The `SignatureSha256Contiguous` attribute in the XML provides a pre-install integrity check (optional).

**Certificate requirements**:
- EV (Extended Validation) or OV (Organization Validation) code signing certificate.
- The certificate must be trusted by the user's Windows installation (or the user must accept the publisher).
- For Microsoft Store apps: the Store's certificate chain is used.

### Backend Storage

Any HTTP/HTTPS server or CDN. The MSIX bundle and the AppInstaller XML are static files.

**Documented options**:
- Microsoft Store (for Store apps)
- Direct URL (enterprise, CDN)
- App Installer with `Uri` pointing to any HTTP/HTTPS endpoint

**Windows 11 features**:
- **WinApp CLI** (new): Streamlines MSIX packaging and signing workflows.
- **MSIX Packaging Tool**: Creates MSIX from existing installers.
- **Package flighting**: [Package flighting](https://learn.microsoft.com/en-us/windows/uwp/publish/package-flights) for staged deployment in enterprise.

### Delta Updates

**Not supported.** The full MSIX bundle is downloaded on every update. There is no blockmap, no bsdiff, no delta mechanism.

**MSIX is a ZIP container** — theoretically, delta compression could be applied, but neither Microsoft nor the MSIX SDK provides this. The full bundle is always downloaded.

### Atomicity

**MSIX is transactional**:
- The MSIX installer validates the package (signature, manifest, dependencies) before any file is written.
- Files are written to a temporary location, then committed atomically.
- If the install fails (disk full, missing dependency, invalid signature), the previous version is untouched.
- The previous version is retained in the MSIX store and can be re-activated.

**Per-user vs per-machine**:
- Per-user install: No UAC prompt. Installed to the user's profile.
- Per-machine install: UAC prompt. Installed system-wide.

### Quit Semantics

- **The app must be closed** for the update to install. AppInstaller cannot replace running files.
- The update is scheduled within the `UpdatePolicy` window (`Start` + `Duration`).
- If the app is running when the update window starts, the update is deferred until the app is closed.
- The user is NOT prompted to close the app (unless the app itself implements a close prompt).
- After install, the app must be relaunched by the user (or by a scheduled task).

### Rollback

**MSIX retains the previous version**:
- After a successful update, the previous MSIX version is kept in the package store.
- The user (or IT admin) can "revert" to the previous version by re-activating it.
- This is not automatic — the user must explicitly choose the older version (via Settings → Apps, or `Add-AppxPackage` with the old version).

**Automatic rollback**: Not supported. If the new version is broken, the user is stuck until they manually revert or a new version is published.

### Staged Rollout

**`StagedRollout` attribute** (integer, days):
- Specifies the number of days over which the update is rolled out.
- Windows distributes the update to a subset of devices per day, ramping up over the specified period.
- This is a **client-side** rollout — Windows decides when to check for the update based on the device's position in the rollout cohort.

**Package flighting** (enterprise):
- [Package flighting](https://learn.microsoft.com/en-us/windows/uwp/publish/package-flights) allows enterprise IT to create named "flights" of packages and assign devices to flights.
- A device in "flight A" gets the update in flight A. Devices in "flight B" get it later.
- This is a **server-side** rollout controlled by the enterprise's deployment infrastructure.

### Production Caveats

1. **App must be closed** — AppInstaller cannot update a running app. This is a hard Windows limitation.
2. **No delta updates** — every update downloads the full MSIX. For a 200 MB app, this is 200 MB on every update.
3. **UAC for per-machine installs** — the update window must account for user availability to approve UAC.
4. **Certificate trust** — if the user's machine does not trust the code signing certificate, the install is blocked. Enterprise deployments must distribute the certificate via Group Policy.
5. **AppInstaller XML is not signed** — a MITM attacker who controls the XML can redirect the MSIX download. The MSIX signature is verified, but the XML itself is not. Use HTTPS + HSTS.
6. **`StagedRollout` is a hint, not a guarantee** — Windows may ignore it under certain conditions (e.g., the user manually triggers an update).
7. **Package flighting requires enterprise infrastructure** — not available for retail/consumer deployments.
8. **MSIX is not suitable for frequent updates** — the transactional install is slower than Squirrel's background update or Electron's NSIS update. For daily updates, MSIX is too heavy.
9. **Windows 10 S mode** — MSIX is required in S mode. This is an advantage for S mode deployments but a constraint for others.
10. **No auto-relaunch** — after install, the app must be manually relaunched. There is no equivalent of Squirrel's `Update.exe --processStart` or Electron's `quitAndInstall()`.

---

## Comparison Matrices

### Signing Algorithm Matrix

| Ecosystem | Algorithm | Key Size | Pubkey Location | Signs What |
|-----------|-----------|----------|-----------------|------------|
| Squirrel.Windows | None (SHA-1 integrity) | — | — | RELEASES entries only |
| Sparkle 2.x | **EdDSA (Ed25519)** | 32 bytes | `Info.plist` → `SUPublicEDKey` | Update archive (+ feed, 2.9+) |
| electron-updater v27 | **Ed25519** | 32 bytes | `app-update.yml` → `updateManifestPublicKey` | `latest*.yml` manifest |
| electron-updater ≤26 | None (SHA-512 checksum) | — | — | Artifact hash only |
| Tauri 2.x | **Ed25519** | 32 bytes | `tauri.conf.json` → `plugins.updater.pubkey` | Installer/bundle |
| Cap Awesome LU | **RSA** (PEM) | 1024–2048+ bytes | `capacitor.config.json` → `publicKey` | Bundle (zip) |
| Expo Updates | **RSA** (`rsa-v1_5-sha256`) | 2048+ bytes | Embedded cert / OS trust store | Manifest (+ assets transitively) |
| CodePush | **None** | — | — | Deployment key (auth only) |
| PWA Service Worker | **None** (HTTPS/TLS) | — | — | TLS cert (origin) |
| AppInstaller/MSIX | **Authenticode** (X.509) | 2048+ bytes | Windows cert store | MSIX bundle |

### Delta Update Support Matrix

| Ecosystem | Delta Type | Algorithm | Granularity |
|-----------|-----------|-----------|-------------|
| Squirrel.Windows | Yes | BSDiff | Per-file (EXE/DLL) |
| Sparkle 2.x | Yes | BSDiff | Full app archive |
| electron-updater | Yes | Blockmap (content-defined chunking) | 512 B – 2 KiB blocks (v3) |
| Tauri 2.x | **No** | — | — |
| Cap Awesome LU | Yes | Undisclosed | File-level (server-side) |
| Expo Updates | Asset-level reuse | SHA-256 hash comparison | Per-asset |
| CodePush | **No** | — | Full JS bundle |
| PWA Service Worker | **No** | — | Full SW script |
| AppInstaller/MSIX | **No** | — | Full MSIX bundle |

### Channel / Staged Rollout Matrix

| Ecosystem | Channels | Staged Rollout | Mechanism |
|-----------|----------|----------------|-----------|
| Squirrel.Windows | No | Yes (percentage) | `# nn%` in RELEASES file |
| Sparkle 2.x | Yes (`sparkle:channel`) | Yes (phased groups) | 7 groups, `phasedRolloutInterval` |
| electron-updater | No | Yes (percentage) | `stagingPercentage` in `latest.yml` |
| Tauri 2.x | No (runtime config) | No (server-side) | Dynamic server logic |
| Cap Awesome LU | Yes (versioned) | Yes (server-side) | Capawesome Cloud |
| Expo Updates | Yes (channel→branch) | Yes (channel re-linking) | EAS Update API |
| CodePush | Yes (deployments) | Yes (server-side) | App Center API |
| PWA Service Worker | No | No (workaround only) | A/B testing, feature flags |
| AppInstaller/MSIX | No | Yes (`StagedRollout` days) | Client-side cohort |

### Ecosystem Status Summary (as of January 2026)

| Ecosystem | Status | Version | Last Update |
|-----------|--------|---------|-------------|
| Squirrel.Windows | Maintenance (contributors needed) | 2.x | 2024 |
| Sparkle 2.x | Active | 2.9+ | 2025–2026 |
| electron-updater | Active | v26 (stable), v27 (next) | 2025–2026 |
| Tauri 2.x | Active | 2.x | Nov 28, 2025 |
| Cap Awesome LU | Active | 8.7.1 | ~Dec 2025 |
| Expo Updates | Active | Protocol v1 | Aug 12, 2026 |
| CodePush | **DEAD** | — | Archived May 20, 2025 |
| PWA Service Worker | Active | W3C ED (Oct 29, 2026) | Oct 29, 2026 |
| AppInstaller/MSIX | Active | Win11 SDK 1.8 | Apr 10, 2026 |

### AIRIZ Motor Console Platform Mapping

For the AIRIZ Motor Console (Windows desktop + Android + iOS + Web PWA + Cloudflare Worker):

| Platform | Recommended Ecosystem | Rationale |
|----------|----------------------|-----------|
| **Windows Desktop** | electron-updater v27 (NSIS) or Tauri 2.x | electron-updater: mature, blockmap deltas, signed manifests. Tauri: smaller binary, Ed25519, no delta. |
| **Android** | Expo Updates (if RN) or Cap Awesome LU (if Capacitor) | Expo: formal protocol, asset reuse, channel/branch model. Cap Awesome: self-hosted option, RSA signing. |
| **iOS** | Expo Updates (if RN) or Cap Awesome LU (if Capacitor) | Same as Android. Expo Updates has the most formal protocol. |
| **Web PWA** | Service Worker + Cloudflare Worker | W3C spec. Cloudflare Worker serves the SW script + manifest + assets. |
| **Cloudflare Worker** | Custom (serves as update server) | The Worker itself does not need an auto-update mechanism — it is deployed via `wrangler deploy`. It serves as the backend for the PWA SW update flow. |

**Cross-platform unification considerations**:
1. **Signing**: No single algorithm covers all. Ed25519 (Sparkle, Tauri, electron-updater v27) is the most modern. RSA (Cap Awesome, Expo) is more widely supported. If you need a single key type across platforms, RSA-2048 is the lowest common denominator.
2. **Wire format**: No single manifest format works for all. The Windows desktop (YAML/JSON) and mobile (JSON) formats are structurally similar but not identical. A unified backend can serve different formats to different clients.
3. **Staged rollout**: Only Sparkle, electron-updater, Expo, and AppInstaller have built-in rollout. Tauri, PWA SW, and Cap Awesome require server-side logic.
4. **Rollback**: Only Cap Awesome, Expo, CodePush (dead), and MSIX have meaningful rollback. Squirrel, Sparkle, electron-updater, and Tauri do not.
5. **Delta updates**: Only Squirrel, Sparkle, electron-updater, and Cap Awesome support true delta. This matters most for the Windows desktop (large NSIS installer) and mobile (large JS bundle).

---

## Appendix: Source URLs

| Ecosystem | Primary Source |
|-----------|---------------|
| Squirrel.Windows | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/readme.md |
| Squirrel RELEASES format | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/getting-started/5-updating.md |
| Squirrel update process | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/update-process.md |
| Squirrel staged rollouts | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/staged-rollouts.md |
| Squirrel delta packages | https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/delta-packages.md |
| Sparkle docs | https://sparkle-project.org/documentation/ |
| Sparkle publishing | https://sparkle-project.org/documentation/publishing/ |
| Sparkle sample appcast | https://sparkle-project.org/files/sparkletestcast.xml |
| electron-updater auto-update | https://www.electron.build/docs/features/auto-update |
| electron-updater signed manifests | https://www.electron.build/docs/features/signed-update-manifests |
| Tauri updater | https://v2.tauri.app/plugin/updater/ |
| Cap Awesome LU | https://www.npmjs.com/package/@capawesome/capacitor-live-update |
| CodePush (archived) | https://github.com/microsoft/code-push |
| CodePush migration | https://github.com/microsoft/code-push/blob/master/migration-notice.md |
| Expo Updates protocol | https://docs.expo.dev/technical-specs/expo-updates-1/ |
| Expo Update how-it-works | https://docs.expo.dev/eas-update/how-it-works/ |
| W3C Service Workers | https://w3c.github.io/ServiceWorker/ |
| MDN Service Worker API | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API |
| MSIX docs | https://learn.microsoft.com/en-us/windows/msix/ |
| AppInstaller schema | https://learn.microsoft.com/en-us/windows/uwp/schemas/appinstallerschema/schema-root |
