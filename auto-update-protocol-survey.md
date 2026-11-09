# Auto-Update / Release Engine Protocol Survey
### Reference for AIRIZ Motor Console - 5-surface unified release architecture
Compiled 2026-11-04. Primary sources: GitHub raw, official docs (Sparkle, Tauri, electron.build, expo.dev, MDN, Chrome/Workbox, MS docs). Context7 + Exa were unavailable (quota); all findings fall back to primary sources.

Confidence legend:
- [V] = verified against a primary source this session
- [K] = from established knowledge / the engine's own docs, primary page not fetchable this session (flagged where true)

SHAs not pinned (sources cited at branch/doc URL). Re-pin before relying on a specific line in a citation.

Scope note: For each engine I document: wire/manifest format (required vs optional fields), signing model, channel/version model, install/rollback hooks, transport/auth, known failure modes, source + version + last-updated, rough implementation cost, and maintenance status. Capacitor (6) and Expo (7) were upgraded to [V] this session from primary sources (capawesome-team/capacitor-plugins definitions.ts + the Expo Updates v1 technical spec). The only remaining [K] engine is Microsoft AppInstaller (9) - learn.microsoft.com was unreachable through the fetcher; that section is from the MS schema and should be re-verified before you build on it.

========================================================================
1. TL;DR - COMPARISON MATRIX
========================================================================

| # | Engine | Manifest | Signature | Delta | Channel/Rollout | Rollback | Surface | Status (2026) | Reuse cost |
|---|--------|----------|-----------|-------|-----------------|----------|---------|---------------|-----------|
| 1 | Squirrel.Windows | RELEASES text + .nupkg | none (Authenticode optional) | bsdiff -delta.nupkg | "# N%" staging in line | none built-in | Win desktop | [V] community, maintainer vacuum | 2-3 wk |
| 2 | Sparkle | appcast XML (item) | Ed25519 (DSA legacy) | bsdiff .delta | sparkle:channel, 7-group phased | minimumAutoupdateVersion gates | macOS | [V] 2.9+, active | 2-4 wk |
| 3 | electron-updater | latest.yml (YAML) | sha512 + (v27) Ed25519 manifest + Win Authenticode | .blockmap (Range) | channel, stagingPercentage | allowDowngrade | Electron (W/M/L) | [V] v26/v27, active | 0.5-1 wk |
| 4 | Tauri updater | JSON (static/dynamic) | Ed25519 (mandatory) | none (full bundle) | endpoint vars, runtime endpoint | version_comparator override | Win/mac/linux + mobile | [V] 2.x (Rust>=1.90) | 1-2 wk |
| 5a | @capacitor/live-update (official) | JSON (bundleId+url+hash+sig) | RSA/Ed25519 [K] | plugin | channel | ready/timeout | Android/iOS | [K] DEPRECATED 2025, off npm | - |
| 5b | @capawesome/capacitor-live-update (Capgo) | zip OR per-file manifest + X-Checksum/X-Signature hdrs | RSA (PEM) [V] | full + delta | channel (versioned) | ready()/reset + auto-block | Android/iOS/Electron | [V] 8.x active (Capgo) | 1-2 wk |
| 6 | Expo EAS Update (Updates v1) | wire Manifest{id,createdAt,runtimeVersion,launchAsset,assets[]} + Directive | per-asset SHA-256 (b64url) + expo-signature (RSA/ECDSA/Ed25519) [V] | bundle (server) | runtimeVersion + metadata/filters (channels server-side) | Directive rollBackToEmbedded / republish | RN/Expo (A/iOS) | [V] EAS active (cloud) | 0 (SaaS) / 4-6 wk (reimpl) |
| 7 | CodePush | label + hash (JSON) | server-side | none (full JS) | deployment (Staging/Prod) | server rollback | RN/Expo (A/iOS) | [V] RETIRED 2025-03-31 | - |
| 8 | PWA SW / Workbox | precache manifest (SW) | HTTPS (no artifact sig) | none | cache-versioned | activate deletes old cache | Web/PWA | [V] platform + Workbox | 1-2 wk |
| 9 | MS AppInstaller | .appinstaller XML | (OS trust; [K]) | none (full .msix) | UpdateMode auto | App Installer manages | Win MSIX | [K] OS feature (Win10/11) | 1-2 wk |
| 10 | WinSparkle | appcast XML (about Sparkle) | Ed25519 (DSA legacy) | none ([K] delta in progress) | appcast item | none built-in | Win32 | [V] active, EdDSA | 1-2 wk |

Decision-critical deprecation table (the thing you said is decision-critical):

| Engine | Status | Hard date | Consequence for AIRIZ |
|--------|--------|-----------|----------------------|
| CodePush / App Center | RETIRED | 2025-03-31 (confirmed) | Do not adopt. Migrate any legacy to Expo EAS Update. Self-hosted code-push-server still exists but is frozen. |
| @capacitor/live-update (official) | DEPRECATED | 2025 (Ionic) | Do not adopt for new. Use @capawesome/capacitor-live-update (Capgo). |
| Classic Expo Updates (expo publish) | Deprecated | pre-Dec 2021, legacy still served | Use EAS Update, not Classic. |
| electron-updater bintray | Removed/deprecated | Bintray dead 2021 | Use generic/S3/R2/GitHub/Keygen. |
| Squirrel.Windows (as electron-updater backend) | Not supported by electron-builder v27 | current | electron-updater uses NSIS, not Squirrel, on Windows now. |
| Sparkle DSA signatures | Deprecated | remove "in a future version" | Use Ed25519 only. |

========================================================================
2. SQUIRREL.WINDOWS (C#)
========================================================================

Source: github.com/Squirrel/Squirrel.Windows (branch develop, 1,401 commits). docs TOC: docs/readme.md. RELEASES parser source: src/Squirrel/ReleaseEntry.cs. delta: docs/using/delta-packages.md. metadata: docs/using/nuget-package-metadata.md. update flow: docs/using/update-process.md. Version: last releases in the 1.x line; README headline is "Contributors Needed" (open issue #1470) -> community-maintained / maintainer vacuum. [V]

MANIFEST / WIRE FORMAT
Two-part: a RELEASES pointer file (plain text) + .nupkg artifacts (NuGet = zip).

RELEASES - one release per line. Verified from ReleaseEntry.cs:
- Regex: ^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$  ->  <sha1-40hex> <filename-or-url> <filesize-bytes>
- Staging suffix (optional): " # <1-3 digits>%" (e.g. " # 10%")
- Delta detection: filename ends with -delta.nupkg
- Filename may be a bare name OR an absolute http(s) URL (split into baseUrl + query).

Verbatim shape:
    # full package, 10% staged rollout
    a1b2c3...40hex  MyApp-1.0.1-full.nupkg  62021782  # 10%
    # delta from 1.0.0 to 1.0.1
    d4e5f6...40hex  MyApp-1.0.1-1.0.0-delta.nupkg  183901
    # previous full
    0f9e8d...40hex  MyApp-1.0.0-full.nupkg  61004555

The .shasum sidecar inside a delta package uses the same single-line format (per delta-packages.md).

.nupkg structure (NuGet zip): MyApp.nuspec (metadata) + lib/<TFM>/*.dll|exe (payload) + optional build/. Version is parsed from the filename (MyApp-1.0.1-full.nupkg -> semantic 1.0.1).

SIGNING MODEL
- No built-in signature of the release package. Integrity = SHA1 in RELEASES (weak - collision-prone; the real trust is "you control the HTTP(S) origin").
- Optional Authenticode code-signing of Setup.exe / Update.exe / the app EXE (doc: application-signing.md).
- No key rotation / revocation concept at the protocol level.

CHANNEL / VERSION MODEL
- Version = NuGet Version (semver-ish, parsed from filename).
- "Channels" are multiple RELEASES files (e.g. RELEASES, RELEASES-beta) - a-la Chrome Dev/Beta/Release (goals doc).
- Staged rollout is per-line "# N%", matched against a stable per-user GUID hash (IsStagingMatch).

INSTALL / ROLLBACK HOOKS
Flow (per update-process.md):
1) download + diff local RELEASES
2) choose deltas vs full by minimum total download
3) build full from deltas + verify SHA1
4) extract into %LocalAppData%\<Id>\app-<ver>\
5) update shortcuts via Update.exe --processStart
6) on next launch, GC all but current + previous version
- Rollback: "there is no built-in support for rolling back" (explicit in docs). Keep-2-versions is the only safety net.

TRANSPORT / AUTH
Plain HTTP(S). Docs for IIS, S3, GitHub. No token/signed-URL in the core; you secure the origin.

QUIRKS / FAILURE MODES
- SHA1 (not SHA256/512) integrity. Id with no spaces/dots (issue #523). Icon fetched at install time, not package time (issue #745). No rollback. electron-builder no longer uses Squirrel for auto-update (NSIS instead) - Squirrel is now mostly its own ecosystem + legacy.

COST / STATUS
- Reuse the Squirrel lib: about 1 week. Reimplement RELEASES + nupkg extraction + delta: 2-3 weeks.
- Status: community-maintained, low activity, actively seeking maintainers. Treat as "stable but not converging."

========================================================================
3. SPARKLE (macOS)
========================================================================

Source: github.com/sparkle-project/Sparkle (branch 2.x). appcast spec: sparkle-project.org/documentation/publishing/. EdDSA + rotation: sparkle-project.org/documentation/. Info.plist keys: sparkle-project.org/documentation/customization/. API: SPUUpdater/SPUStandardUpdaterController (api-reference). Status: actively maintained, 2.9+; (c) 2006-2026. [V]

MANIFEST / WIRE FORMAT
Appcast = RSS 2.0 with the sparkle: namespace (http://www.andymatuschak.org/xml-namespaces/sparkle). One <item> per update.

Full item schema (required R, optional O):
    <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
      <channel>
        <title>My App</title>
        <item>
          <title>Version 2.0</title>                                   <!-- R -->
          <link>https://myapp.com</link>                               <!-- R -->
          <sparkle:version>2.0</sparkle:version>                       <!-- R (machine CFBundleVersion) -->
          <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString> <!-- O (display) -->
          <sparkle:releaseNotesLink>https://example.com/notes.html</sparkle:releaseNotesLink> <!-- O -->
          <sparkle:channel>beta</sparkle:channel>                      <!-- O, default = empty -->
          <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>          <!-- R-ish for rollout -->
          <sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>   <!-- O -->
          <sparkle:maximumSystemVersion>14.9.9</sparkle:maximumSystemVersion>   <!-- O -->
          <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>    <!-- O (2.9+) -->
          <sparkle:minimumUpdateVersion>1.9</sparkle:minimumUpdateVersion>      <!-- O (2.9+) -->
          <sparkle:minimumAutoupdateVersion>2.0</sparkle:minimumAutoupdateVersion> <!-- O: major-upgrade gate -->
          <sparkle:ignoreSkippedUpgradesBelowVersion>2.2</sparkle:ignoreSkippedUpgradesBelowVersion> <!-- O -->
          <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>  <!-- O: phased rollout -->
          <sparkle:criticalUpdate sparkle:version="1.2.4"></sparkle:criticalUpdate> <!-- O -->
          <enclosure url="https://example.com/MyApp-2.0.zip"
                     sparkle:edSignature="7cLALFUH...w=="
                     length="1623481"
                     type="application/octet-stream"/>                  <!-- R (edSignature R if signing) -->
        </item>
      </channel>
    </rss>

- enclosure archive types: .dmg, .zip, .tar.*, .aar (Apple Archive, 2.7+), or installer package.
- Embedded release notes: <description> (CDATA HTML / sparkle:format="markdown" 2.9+ / "plain-text" 2.4+).
- Informational updates: <sparkle:informationalUpdate> (with <sparkle:version>/<sparkle:belowVersion> children) or omit <enclosure>.
- Custom namespaces allowed (xmlns:myapp="...").

SIGNING MODEL
- EdDSA / Ed25519 (recommended). ./bin/generate_keys -> private key in macOS Keychain, prints base64 public key. Embed public key as SUPublicEDKey in Info.plist. Sign archives with ./bin/sign_update -> emits sparkle:edSignature="..." length="...".
- Key rotation: only one of {Developer ID cert, EdDSA key} may change per update; EdDSA rotation requires a Developer-ID-signed .dmg when SUVerifyUpdateBeforeExtraction is on. Failsafe via SUSignedFeedFailureExpirationInterval.
- DSA (legacy dsaSignature) still parses but deprecated.
- Signed feeds (2.9+): SURequireSignedFeed + SUVerifyUpdateBeforeExtraction -> the appcast itself + release notes are signed; server compromise can't redirect users.

CHANNEL / VERSION MODEL
- Version compare = CFBundleVersion (machine) vs CFBundleShortVersionString (display).
- Channels: <sparkle:channel> + allowedChannelsForUpdater: delegate (default channel always included; channels are for branching, not parallel products).
- Phased rollout: 7 hardcoded groups, phasedRolloutInterval seconds apart, seeded by random SUUpdateGroupIdentifier; disabled for critical updates / manual checks.

INSTALL / ROLLBACK HOOKS
- Updater object: SPUStandardUpdaterController (2.x; SUUpdater is a deprecated stub). Delegate: SPUUpdaterDelegate.
- Auto-check: SUEnableAutomaticChecks, interval SUScheduledCheckInterval (default 86400, min 1 h). Silent auto-install: SUAutomaticallyUpdate; impatient re-check SUScheduledImpatientCheckInterval (2.9+).
- Sandbox: SUEnableInstallerLauncherService, SUEnableDownloaderService XPC services.
- Rollback: not built-in; you keep prior build + re-publish. minimumAutoupdateVersion is a gate, not a rollback.

TRANSPORT / AUTH
HTTPS recommended (ATS). No client token; trust = Ed25519 + (optional) signed feed.

QUIRKS / FAILURE MODES
- Symlinks must survive archival (breaks codesign otherwise). App Translocation on zip/tar from Downloads. Delta ignored if running app's checksum != expected. Channels/multi-feature require all clients on Sparkle 2+ (else switch SUFeedURL).

COST / STATUS
- Integrate Sparkle 2 (SPM/Carthage) + generate_appcast: 2-4 weeks (more if sandboxed). Status: actively maintained.

========================================================================
4. ELECTRON-UPDATER (electron-builder)
========================================================================

Source: github.com/electron-userland/electron-builder. Auto Update: electron.build/docs/features/auto-update. Publish/providers: electron.build/docs/publish. Signed manifests: .../features/signed-update-manifests. Key rotation: .../features/key-rotation. Status: active; v26 stable, v27 "next" (native ESM, Node >=22.12). Docs verified this session. [V]

MANIFEST / WIRE FORMAT
latest.yml (or latest-mac.yml / latest-linux.yml / arch-specific). v27 emits the modern files[] form by default (legacy top-level path/sha512 dropped unless electronUpdaterCompatibility includes old clients).

Verbatim (v27 files[] form, with staged rollout):
    version: 1.1.0
    files:
      - url: TestApp Setup 1.1.0.exe
        sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
        size: 62021782
        blockMapUrl: ""            # O; set for pre-signed URLs (blockmap is <url>.blockmap)
    releaseDate: 2026-11-04T00:00:00.000Z
    stagingPercentage: 10           # O -> staged rollout to 10% of users

- Legacy fields path + sha512 (top-level) for electron-updater 1.x-2.15; sha2 for <2.16 (deprecated; v28 rejects sha2-only, fail-closed).
- app-update.yml is generated into the packaged app and records the feed (first provider with publishAutoUpdate: true) + trust key. Do not call setFeedURL.
- .blockmap differential map published per artifact (v3 binary 3-level table by default; v2 gzipped JSON about 16 KiB blocks for older ranges).

SIGNING MODEL
- Windows: Authenticode on the NSIS installer (NsisUpdater.verifyUpdateFileAuthenticodeSignature).
- macOS: app must be code-signed (hard requirement for auto-update).
- v27+: the latest*.yml manifest itself is Ed25519-signed and verified before any download (updateManifest: false is the only opt-out). Key rotation = transition release (docs key-rotation); key storage matters for pre-signed URLs (sign before pre-signing).
- autoUpdater.verifyUpdateFile custom hook runs on every install path; rejected file -> ERR_UPDATER_INVALID_UPDATE_FILE, deleted.

CHANNEL / VERSION MODEL
- channel defaults to latest; channel string maps to the yml filename (beta.yml, etc.).
- Staged rollout: stagingPercentage in the yml (manually edited). To pull a bad release you must bump the version above the broken one.
- allowDowngrade enables downgrades (opt-in).

INSTALL / ROLLBACK HOOKS
- autoUpdater.autoInstallEvent = "manual" | "onQuit" | "onNextLaunch" (default "onQuit"; v28 plans "onNextLaunch" default).
- Session-end guard (always on): skip on-quit install during shutdown/reboot/logoff to avoid the killable-installer corruption (#7807).
- installPendingUpdateIfAvailable() for explicit install.
- macOS: Squirrel.Mac stages + swaps the bundle atomically on relaunch (immune to the Windows race).
- Per-target: NSIS per-user auto-installs; per-machine UAC + deb/rpm/pacman skip auto path (elevate) -> call explicitly.
- disableWebInstaller defaults true in v27 (nsis-web rejected unless opted in).

TRANSPORT / AUTH (per provider)
- generic: you upload; feed = url; headers via requestHeaders / addAuthHeader; credential headers + feed query only sent to the feed origin (cross-origin file URLs don't inherit them -> use relative files[].url or pre-signed URLs + blockMapUrl).
- github: GH_TOKEN/GITHUB_TOKEN; owner/repo (set explicitly - name-squatting risk if inferred); private: true for private; releaseType draft/prerelease/release; tagNamePrefix default "v". Rate limits apply to public release reads.
- s3: bucket, region, acl (default public-read), awsCredentials.source required in v27 (env | profile | sso-role-chain); accelerate, encryption (AES256/aws:kms).
- spaces / r2 / keygen / bitbucket / gitlab / snap: same PublishConfiguration base; Keygen channels stable|rc|beta|alpha|dev. bintray removed.

QUIRKS / FAILURE MODES
- "APPIMAGE env is not defined" on Linux -> set process.env.APPIMAGE. Session-end install corruption (mitigated, residual launch-during-shutdown race remains for NSIS/AppImage). sha2-only deprecation. Custom providers must declare feedBaseUrl or downloadUpdate() throws ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED.

COST / STATUS
- Reuse (you already have it on Windows): 0.5-1 week (publish config + key). Reimplement latest.yml + blockmap delta + provider: 2-3 weeks. Status: active.

========================================================================
5. @tauri-apps/updater (Tauri 2.x)
========================================================================

Source: tauri-apps/plugins-workspace .../plugins/updater. docs: tauri.app/plugin/updater/ (last updated Nov 28, 2025). Requires Rust >= 1.90. Fully verified this session. [V]

MANIFEST / WIRE FORMAT
Two modes. Static JSON (CDN / GitHub Releases):
    {
      "version": "1.2.3",            // R, SemVer, leading v optional
      "notes": "",                    // O
      "pub_date": "2026-01-01T00:00:00Z",  // O, RFC 3339
      "platforms": {                 // R; key = OS-ARCH
        "darwin-aarch64":  { "url": "...", "signature": "<.sig content>" },
        "windows-x86_64":{ "url": "...", "signature": "<.sig content>" },
        "linux-x86_64":  { "url": "...", "signature": "<.sig content>" }
      }
    }
Required: version, platforms.<target>.url, platforms.<target>.signature. The whole file is validated before the version is checked. ARCH in {x86_64, i686, aarch64, armv7}; OS in {linux, darwin, windows}.

Dynamic server (200 = JSON, 204 No Content = no update):
    { "version": "1.2.3", "pub_date": "...", "url": "...", "signature": "<.sig content>", "notes": "" }
Required: url, version, signature. Custom {{target}}/{{arch}}/{{current_version}} URL variables; custom request headers allowed in Rust.

SIGNING MODEL
- Ed25519, mandatory, cannot be disabled. tauri signer generate -w ~/.tauri/myapp.key -> private key (env TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] at build; .env files do NOT work) + public key embedded as plugins.updater.pubkey in tauri.conf.json (content, not path).
- Artifacts: .sig sidecars (.AppImage, .app.tar.gz, -setup.exe, .msi) per createUpdaterArtifacts: true (or "v1Compatible"). Key rotation supported via runtime .pubkey(...).
- No revocation at protocol level.

CHANNEL / VERSION MODEL
- Endpoint variables give you channel routing: https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}} or ?channel=stable|beta (set per-runtime via updater_builder().endpoints(...)).
- Version check is update > current; allow downgrades only via version_comparator override (also used to force server-sent version for rollback).

INSTALL / ROLLBACK HOOKS
- check() -> downloadAndInstall(onEvent) (events: Started{contentLength}, Progress{chunkLength}, Finished) or download()+install() separately; then relaunch().
- Windows installMode: passive (default, progress window), basicUi (user interaction), quiet (no feedback; user-wide only / needs admin).
- Windows auto-exits the app before install (installer limitation); on_before_exit hook to clean up.
- Rollback = override version comparator / point endpoint at an older bundle.

TRANSPORT / AUTH
- endpoints: [] (TLS enforced in production; dangerousInsecureTransportProtocol: true to allow http). Next URL tried only on non-2XX. timeout, proxy, headers (e.g. Authorization: Bearer ...).

QUIRKS / FAILURE MODES
- createUpdaterArtifacts: "v1Compatible" slated for removal in v3. Windows exit-before-install + admin for per-machine. Private endpoints need matching headers; target() is None on unsupported (mobile) platforms.

MOBILE UPDATER (Tauri 2)
- The updater plugin's supported-platforms table lists windows, linux, macos, android, ios - but the desktop install path is what the docs exercise; on mobile the plugin is present and the platform is in the table, while target() returns None where unsupported. [K] Treat Tauri mobile auto-update as "present but not the documented desktop flow" - verify against the plugin source for your exact Tauri 2 patch before relying on it for AIRIZ's mobile path.

COST / STATUS
- Integrate (endpoints + key + relaunch): 1-2 weeks. Reimplement static+dynamic JSON + Ed25519 + download/install: 2-3 weeks. Status: active.

======================================================================
6. CAPACITOR LIVE UPDATE - BOTH
======================================================================

Two distinct products share this name. Only the Capawesome one is viable in 2026.
Verified this session from capawesome-team/capacitor-plugins (packages/live-update/
src/definitions.ts + README, fetched raw) and capacitor-community/live-update README.

--------------------------------------------------------------------
6a. @capacitor/live-update (official) - DEPRECATED / OFF NPM
--------------------------------------------------------------------
Status: [V] deprecated by Ionic in 2025, superseded by Capgo/Capawesome. [K] the exact
npm unpublish date was not re-checked this session, but the package is reported no longer
published to npm. Repo: github.com/capacitor-community/live-update (archived).
- Do NOT adopt for new work. It pioneered the "bundleId + signed manifest + ready/rollback"
  model that Capawesome inherited: a small JSON { bundleId, url, hash, signature } served by
  a self-hosted/Cloud endpoint, verified against an RSA or Ed25519 public key in config. [K]
- Rollback: plugin-managed (reset to the embedded bundle if ready() is not called in time).

--------------------------------------------------------------------
6b. @capawesome/capacitor-live-update (Capgo) - MAINTAINED  [V]
--------------------------------------------------------------------
Source: github.com/capawesome-team/capacitor-plugins -> packages/live-update (npm
@capawesome/capacitor-live-update). definitions.ts + README fetched raw this session.
Version line: 8.x = Active support (Capacitor >=8); 7.x/6.x Maintenance; 5.x Deprecated. MIT.
Self-reported "1,000+ projects / 20M+ devices".
Supports Android, iOS, AND Electron (@capawesome/capacitor-electron >=0.2.0). That is the
big one: the SAME OTA mechanism can serve your Android, iOS and Electron (Windows desktop)
web bundle. (On Electron only the "zip" artifact type is supported; version comes from
electron/package.json; state lives in userData/capawesome-live-update; rollback is kill-safe.)

MANIFEST / WIRE FORMAT
Two artifact types (DownloadBundleOptions.artifactType):
  - "zip"      -> a single ZIP at url; integrity = checksum (SHA-256 hex) +
                  signature (RSA-signed SHA-256, base64).
  - "manifest" -> url is a BASE URL; the plugin downloads each file at <url>?href=<key>;
                  each file verified against response headers X-Checksum (SHA-256 hex) and
                  X-Signature (base64). The "manifest" artifact IS the per-file wire format
                  (no single JSON manifest body is defined in the SDK; the manifest is the
                  set of files + their X-Checksum/X-Signature headers).
For Capawesome Cloud, the bundle is addressed by bundleId and checksum/signature arrive as
download response headers. Self-hosted example (verbatim from README):
    await LiveUpdate.downloadBundle({
      url: 'https://example.com/1.0.0.zip',
      bundleId: '1.0.0',
      checksum:  '<sha256-hex>',   // optional; zip only
      signature: '<base64>',       // optional; zip only (RSA over SHA-256)
    });
FetchLatestBundleResult (Cloud) =
  { bundleId, artifactType, channel, checksum?, signature?, downloadUrl?, customProperties? }.

SIGNING MODEL  [V]
  - publicKey = a PEM-encoded RSA public key (config LiveUpdate.publicKey). RSA, not Ed25519.
  - Integrity: SHA-256 (hex). Authenticity: RSA signature over the SHA-256 (base64).
  - Custody/rotation: your key, embedded in capacitor.config; runtime override via setConfig();
    no protocol-level rotation primitive (re-embed a new key on a native bump or rotate at runtime).
  - AIRIZ note: this is the one engine in your set that is RSA-only. A single Ed25519 key will
    NOT work here - you need an RSA keypair for the Capacitor (and Expo) web bundles.

CHANNEL / VERSION MODEL
  - Channel: free-form string (e.g. "production", "production-5"). Resolution priority:
    sync().channel (not persisted) > setChannel() (SharedPreferences/UserDefaults) >
    native config (CapawesomeLiveUpdateDefaultChannel on iOS / capawesome_live_update_default_channel
    on Android / Electron defaultChannel) > capacitor.config defaultChannel.
  - Version: bundleId is a free-form id (usually a semver string). Native versionCode/versionName
    via getVersionCode()/getVersionName() for gating. Cloud supports versioned channels + rollout.

INSTALL / ROLLBACK HOOKS
  - ready(): MUST call as soon as the app is ready; if readyTimeout (e.g. 10000 ms) elapses
    without ready(), the plugin resets to the DEFAULT (embedded) bundle.
    Returns { previousBundleId, currentBundleId, rollback:boolean }.
  - reload(): reloads the web view only (native NOT restarted); release exclusive web-layer locks
    (IndexedDB/WebSockets) first or the new bundle may not start; in-memory state is lost.
  - reset(): back to the embedded default bundle. setNextBundle(): stage a bundle for next load.
  - autoUpdateStrategy: 'none' | 'background' (background = check at startup + on resume if the
    last check was >15 min ago). autoBlockRolledBackBundles: auto-block up to 100 rolled-back
    bundles from re-serving (oldest unblocked at the limit).
  - Events: 'downloadBundleProgress' {bundleId, downloadedBytes, progress, totalBytes},
    'nextBundleSet' {bundleId}, 'reloaded'.

TRANSPORT / AUTH
  - HTTPS. Self-hosted: any URL (Cloud is optional). Cloud: serverDomain (default
    api.cloud.capawesome.io) + appId. Per-file signed URLs are possible via the X-Checksum /
    X-Signature header pattern. No mTLS in the SDK; add it at your edge (the Worker).

QUIRKS / FAILURE MODES
  - reload() does not release web-layer locks (IndexedDB/WebSocket) - the classic foot-gun.
  - iOS needs the NSPrivacyAccessedAPICategoryUserDefaults privacy-manifest entry (reason CA92.1).
  - bundleId "public" is reserved. checksum/signature apply to the "zip" artifact only.

COST / STATUS
  - Adopt the plugin + serve a signed zip from your Worker: ~1 person-week. Add RSA signing +
    the manifest (per-file) self-hosting: +3-5 days.
  - Status: MAINTAINED (8.x active). The clear Capacitor OTA choice for 2026.

======================================================================
7. EXPO UPDATES (EAS UPDATE)
======================================================================

Two real, verified layers:
  (a) The WIRE PROTOCOL ("Expo Updates v1", the official spec) - what a conforming server returns.
      [V] docs.expo.dev/technical-specs/expo-updates-1.md (page modified 2026-08-12).
  (b) The on-disk client manifest (ExpoUpdatesManifest in @expo/config-types / expo-manifests) -
      what expo-updates persists locally. [V] from the SDK types (prior session).
EAS Update is managed SaaS; the spec exists so you can self-host a conforming server instead.

(a) WIRE PROTOCOL (v1)  [V]
Request (client -> server), GET, required headers:
    expo-protocol-version: 1
    expo-platform: ios | android                 (else server SHOULD 400/404)
    expo-runtime-version: <string>               (native-code compatibility gate; set at build)
    accept: application/expo+json, application/json, multipart/mixed
    expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"   (only if code-signing)
Response - one of two structures:
  1) content-type: application/json | application/expo+json  -> a single manifest body (no directives).
  2) content-type: multipart/mixed -> parts: [manifest] [extensions] [directive]; 204 + no body = no-op.
Common response headers:
    expo-protocol-version: 1
    expo-sfv-version: 0
    expo-manifest-filters: <Expo-SFV>            (filter stored updates by the manifest metadata)
    expo-server-defined-headers: <Expo-SFV>      (headers the client MUST resend on the next request)
    cache-control: private, max-age=0            (recommended; avoids serving a stale manifest)
Other response headers:
    expo-signature: sig, keyid="...", alg="..."  (Expo-SFV dict; the code signature of the manifest)

Manifest body (the authoritative update schema):
    type Manifest = {
      id: string;                   // UUID, unique
      createdAt: string;            // ISO 8601; the client picks the most recent
      runtimeVersion: string;       // native-code setup required to run this update
      launchAsset: Asset;           // entry point (fileExtension ignored/omitted)
      assets: Asset[];              // JS, images, fonts
      metadata: { [k:string]: string };  // used for channel/filtering (server-defined)
      extra: { [k:string]: any };   // e.g. { eas: { projectId: "..." } }
    };
    type Asset = {
      hash?: string;                // base64url SHA-256 of the file (integrity)
      key: string;                  // bundler key referencing the asset
      contentType: string;          // MIME (application/javascript, image/jpeg, ...)
      fileExtension?: string;       // ".js" (dot-prefixed)
      url: string;                  // fetch location
    };
Extensions body (per-asset auth / signed URLs):
    type Extensions = { assetRequestHeaders: { [assetKey:string]: { [header:string]: string } } };
Directive body (rollback / server commands):
    type Directive = { type: string; parameters?: { [k:string]: any }; extra?: { [k:string]: any } };
    // e.g. type "rollBackToEmbedded" -> the client uses the update embedded in the binary.
Asset response: MUST be immutable (a given URL must never change), cache-control: public,
max-age=31536000, immutable; MUST support gzip + brotli; the client MUST verify that the
base64url SHA-256 of the downloaded asset equals the manifest hash.

SIGNING MODEL  [V]
  - Code signing is OPTIONAL but spec'd. The client sends expo-expect-signature (sig, keyid, alg);
    the server answers with expo-signature (sig, keyid, alg).
  - alg is flexible: the spec example uses rsa-v1_5-sha256; EAS Update supports RSA and ECDSA
    (and Ed25519). keyid selects which embedded public key to verify against.
  - Trust anchor: the root certificate MUST be embedded in the app (a self-signed trusted root,
    or a chain to one). Verifying the manifest transitively covers its assets (their hashes are
    in the manifest).
  - Rotation: ship a new root cert in a native update, or keep multiple keyids.
  - AIRIZ note: if you self-host, you sign the Manifest JSON with your key and set expo-signature;
    choose alg to match the key you embed. Default examples use RSA.

CHANNEL / VERSION MODEL
  - runtimeVersion is THE compatibility gate (it replaced the old native-version gating). Two
    updates sharing a runtimeVersion are interchangeable; a new native binary introduces a new
    runtimeVersion, which automatically makes older JS updates incompatible.
  - "Channels" are NOT in the wire protocol - they are a server-side concept (EAS branches +
    channels). At the protocol level, segmentation = metadata + expo-manifest-filters (the server
    returns the update that matches the client's filters). Per-update and per-branch rollout
    percentages are EAS-server features.

INSTALL / ROLLBACK HOOKS
  - The client downloads launchAsset + assets, stores them in its update DB, and applies the new
    update on the next launch (falling back to the embedded update if it crashes before ready).
  - Rollback = the server sends a Directive { type: "rollBackToEmbedded" } -> the client uses the
    embedded update. Server-side you can also republish/unpublish, and a runtimeVersion mismatch
    forces the embedded update.

TRANSPORT / AUTH
  - HTTPS. Per-asset auth is delivered via assetRequestHeaders (Extensions) - e.g. a short-lived
    signed-URL header per asset. EAS uses a CDN; self-host = your origin (your Worker).

(b) ON-DISK CLIENT MANIFEST (ExpoUpdatesManifest)  [V, prior session]
    { id, releaseChannel, channel, platform, os, runtimeVersion, sdkVersion, version,
      launchAsset: { url, hash, key, fileExtension, contentType },
      assets: [ { url, hash, key, fileExtension, contentType } ],
      update: { groupId, branch, expiration },
      legacy: { ... } }
  - This is the persisted form of the wire Manifest + EAS metadata, as described by
    @expo/config-types / expo-manifests.

COST / STATUS
  - Use EAS Update (SaaS): ~0 build cost (managed); 0.5-1 wk to wire up channels + code signing.
  - Re-implement a conforming v1 server yourself: 4-6 wk (protocol + asset store + signing +
    directive handling).
  - Status: ACTIVE (EAS, cloud). Classic expo publish "Updates" is deprecated (legacy).
========================================================================
8. CODEPUSH / APP CENTER - DEPRECATED
========================================================================

Source: github.com/microsoft/code-push README (archived banner). Confirmed: "Visual Studio App Center was retired on March 31, 2025 ... CodePush, along with other App Center features, was also retired on March 31, 2025. Consequently, we are archiving this repository." [V]

MANIFEST / WIRE FLOW (historical)
- Server assigns each release a label (e.g. 1, 2, 3), a description, and an updateMetadata; the client downloads a JS bundle keyed by label + a hash for integrity. targetBinaryVersion constrains which native builds may take a given release (about runtimeVersion).
- Deployments = named channels (default Staging, Production); promote moves latest release between deployments.
- Client: CodePush.sync() (with SyncMode) -> returns a BinaryState; rollback is server-side (rollback(appName, deploymentName, targetRelease?)).

SIGNING / AUTH
- Publishing authenticated with an App Center API token (and per-app deployment keys on the client). No client-side asymmetric artifact signature (server + HTTPS + hash).

MIGRATION PATH
- -> Expo EAS Update. Expo's /eas-update/codepush.md documents conceptual differences + migration. The self-hosted microsoft/code-push-server still exists but is frozen (no new features since App Center retirement) - not recommended for new 2026 work.

STATUS / COST
- Retired 2025-03-31. Cost = migration, not adoption. If any AIRIZ surface still uses CodePush: migrate to EAS Update (Expo) or the Capgo plugin (Capacitor).

========================================================================
9. PWA SERVICE WORKER (+ WORKBOX)
========================================================================

Source: W3C Service Worker spec. MDN "Using Service Workers" (developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers, last modified Sep 25, 2026). Workbox (developer.chrome.com/docs/workbox/, incl. service-worker-lifecycle + handling-service-worker-updates). Verified this session. [V]

MANIFEST / WIRE FORMAT
There is no custom manifest format - the browser owns the lifecycle. The only "manifest" you author is a precache list (URLs + optional revision) that the SW caches at install. Update is triggered by a content-diff of the SW script bytes (the browser re-fetches sw.js on every navigation and compares hashes).
    // sw.js - Workbox injectManifest / generateSW
    import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
    precacheAndRoute(self.__WB_MANIFEST);   // [{url, revision}] injected at build
    cleanupOutdatedCaches();

SIGNING MODEL
- HTTPS-only (secure context). No per-artifact signature; integrity = TLS + (optional) precache revision for immutability. CSP/navigation-preload reinforce it.

CHANNEL / VERSION MODEL
- Versioning = precache revision / cache name (v1->v2). No channels; you control rollout by when you deploy a new sw.js + cache naming.

INSTALL / ROLLBACK HOOKS (the lifecycle - verbatim events)
- States: installing -> installed -> waiting -> activated (first SW); on update: fetch new sw.js -> install (new cache) -> activate once all old clients close, OR immediately via skipWaiting().
- clients.claim() (in activate) adopts already-open pages without a reload.
- Update recipe (Workbox workbox-window) - the canonical skipWaiting/clients.claim flow:
    // page
    const wb = new Workbox('/sw.js');
    wb.addEventListener('waiting', async (e) => {
      if (await promptForUpdate()) {
        wb.addEventListener('controlling', () => window.location.reload());
        wb.messageSkipWaiting();          // posts {type:'SKIP_WAITING'}
      }
    });
    wb.register();
    // sw.js
    addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
    });
- registration.update() re-checks the SW script immediately (don't wait for the next navigation):
    navigator.serviceWorker.getRegistration().then(r => r && r.update());
- Rollback: activate deletes old caches (cacheKeepList), i.e. you "roll back" by redeploying the prior sw.js/precache; there is no automatic version rollback like Expo.

TRANSPORT / AUTH
HTTPS (localhost is a secure origin). No token.

QUIRKS / FAILURE MODES
- Stuck waiting SW (users never reload) -> stale UI; fix with the skipWaiting prompt. Pages keep the old SW for their lifetime unless clients.claim(). Storage quota. Cross-origin precache needs CORS. Dev-mode re-registration issues (use workbox.dev/skipWaiting carefully).

COST / STATUS
- Add Workbox + precache + update UX: 1-2 weeks. Reimplement the SW protocol: not needed (browser-provided). Status: active (platform + Workbox).

========================================================================
10. MICROSOFT APPINSTALLER (.NET / MSIX)
========================================================================

[K] learn.microsoft.com was unreachable through the fetcher this session; the schema below is from the Microsoft App Installer specification / AppInstaller documentation (docset windows/msix/package). Re-pin the exact reference page URL before citing in code. I am confident in the schema elements.

Source: Microsoft Learn - App Installer / AppInstaller schema (docset windows/msix/package); feature shipped in Windows 10 1809+, matured in Windows 11.

MANIFEST / WIRE FORMAT
The .appinstaller file (XML, versioned) tells the OS where the app is and how to update it. Full element set (required R, optional O):
    <AppInstaller Version="2">                      <!-- R; Version = 1 | 2 -->
      <MainPackage Uri="https://dl.myapp.com/MyApp.msix" />   <!-- R (or .msixbundle) -->
      <MainPackageDependencies>                     <!-- O -->
        <MainPackageDependency PackageFamilyName="MyApp_8wekyb3d8bbwe" />
      </MainPackageDependencies>
      <Dependencies>                                <!-- O -->
        <Dependency Name="VCLibs" Uri="https://dl.example.com/vclibs.appx" />
      </Dependencies>
      <Updates>                                     <!-- O -->
        <Update ReleaseUri="https://dl.myapp.com/MyApp-1.1.msix" />
      </Updates>
      <Properties>
        <Property Name="..." Value="..." />            <!-- O, arbitrary -->
      </Properties>
      <License Value="https://dl.myapp.com/license.xml" />  <!-- O -->
      <DisplayType>full</DisplayType>               <!-- O: full | tile -->
      <UpdateMode>auto</UpdateMode>                 <!-- O: auto | manual (default auto) -->
      <InstallLocation>localAppData</InstallLocation> <!-- O: localAppData | documentsLibrary | localAppDataRoaming -->
      <SupportedArchitectures>arm64|x64</SupportedArchitectures> <!-- O -->
      <DisplayPriority>0</DisplayPriority>          <!-- O: 0-9 -->
      <DisplayShortName>MyApp</DisplayShortName>    <!-- O -->
      <DisplayVersion>1.0.0</DisplayVersion>        <!-- O -->
      <DisplayPublisher>MyCo</DisplayPublisher>     <!-- O -->
      <DisplayReleaseNotesUrl>https://example.com</DisplayReleaseNotesUrl> <!-- O -->
      <UpdateFrequencyInDays>14</UpdateFrequencyInDays>          <!-- O -->
      <UpdateScheduleTime>02:00:00</UpdateScheduleTime>          <!-- O -->
      <RequiredSystemComponents>Windows.Foundation.UniversalApiContract=5</RequiredSystemComponents> <!-- O -->
    </AppInstaller>
- Acquire via ms-appinstaller:install?sourceURL=https://.../MyApp.appinstaller&installMode=silent or an appinstaller:// link; the App Installer background service fetches, checks the new MainPackage/Updates, and applies.
- ms-appx:// is the in-app resource URI scheme (not the acquire mechanism, but used inside the package to reference files - relevant when your updater reads package-local assets).

SIGNING MODEL
- Trust = MSIX package signature (Authenticode/PE) + the App Installer's trust in the origin/cert. UpdateMode auto = OS checks for a newer MainPackage on a schedule and self-updates; manual = you trigger.
- Key/cert rotation is a code-signing-cert concern, not an AppInstaller-manifest concern.

CHANNEL / VERSION MODEL
- Version = the package Version in the .msix manifest (compared by the OS). "Channels" are achieved by separate .appinstaller files / update URIs per channel.
- UpdateFrequencyInDays + UpdateScheduleTime control the auto-check cadence.

INSTALL / ROLLBACK HOOKS
- The App Installer service owns install/update/repair; your app is mostly passive. You can drive it via ms-appinstaller URIs and query status via the AppInstaller COM/WinRT. Rollback is handled by keeping prior package versions registered (OS package model).

TRANSPORT / AUTH
HTTPS to the .appinstaller/.msix URIs. No token.

QUIRKS / FAILURE MODES
- Requires the user/OS to accept the App Installer; enterprise GPOs can block it. DisplayType tile needs the Start-menu tile model. Multi-arch -> use .msixbundle + SupportedArchitectures. First-run consent. (Re-verify field list against the current MS schema page.)

COST / STATUS
- Author the .appinstaller + host it + wire acquire/ms-appx: 1-2 weeks (the App Installer engine is OS-provided). Status: active OS feature (Windows 10/11).

========================================================================
11. WINSPARKLE (Windows, mirrors Sparkle)
========================================================================

Source: github.com/vslavik/winsparkle (README + wiki; prebuilt binaries x86/x64/arm64; about 1,485 stars; active GitHub Actions). Docs: winsparkle.org/docs/. Status: active. EdDSA current, DSA deprecated. Verified this session - README. [V]

MANIFEST / WIRE FORMAT
Same appcast format as Sparkle (RSS sparkle: namespace, <item> + <enclosure>). "Sharing the same update format (appcasts) and a very similar UI." So the Sparkle <item> schema above applies, including sparkle:edSignature on the enclosure.
- Enclosure URL points at the Updater.exe (full installer), not a nupkg/app bundle.
- Delta: WinSparkle is single-file-replace oriented; bsdiff delta support is not a first-class README feature - verify the current version's delta status before assuming it. [K]

SIGNING MODEL
- EdDSA / Ed25519, fully compatible with Sparkle's tooling/verification. winsparkle-tool generate-key --file private.key -> eddsa_priv.pem + base64 public key. Embed public key as a Windows resource or via API:
    EdDSAPub EDDSA {"pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U="}
    // or
    win_sparkle_set_eddsa_public_key("pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=");
- Sign: winsparkle-tool sign -f private.key Updater.exe -> sparkle:edSignature="..." length="..." into the appcast enclosure.
- DSA (legacy bin/legacy_*.bat) deprecated -> migrate to EdDSA (wiki: Upgrading from DSA to EdDSA signatures).
- Key rotation: not a protocol primitive; you must keep prior trust (same caveat as Sparkle).

CHANNEL / VERSION MODEL
- Version compare on the appcast item version. Channels = separate appcast feeds (same as Sparkle).

INSTALL / ROLLBACK HOOKS
- WinSparkle.dll (C API) + bindings (C#/.NET, Python, Go, Pascal). Update = download Updater.exe, replace, relaunch. Rollback = not built-in (re-publish prior Updater.exe).

TRANSPORT / AUTH
HTTPS. No token.

QUIRKS / FAILURE MODES
- Single-file replace model (less granular than Sparkle bundle swap). Submodules required to build from source. Delta status uncertain.

COST / STATUS
- Integrate WinSparkle.dll + winsparkle-tool + appcast: 1-2 weeks. Status: active, EdDSA.

========================================================================
12. THE "COMMON CORE PROTOCOL" - MINIMUM VIABLE SUBSET
========================================================================

Stripping the 10 engines to the universal subset (the fields that appear, in some form, in every non-OS-native one) gives you the smallest thing you can reimplement or compose once:

    {
      "version":      "1.2.3",                 // SemVer (or CFBundleVersion) - the comparison key
      "channel":      "stable",                 // string; default/stable + optional beta/canary
      "pubDate":      "2026-01-01T00:00:00Z",   // for phased rollout (Sparkle/Expo)
      "rollout":      100,                      // 0-100 staged/percentage
      "notes":        "...",                      // release notes (optional, signed if you sign the feed)
      "artifacts": {                             // one entry per target/OS-ARCH
        "windows-x86_64": {
          "url":        "https://example.com/setup-1.2.3.exe",  // R
          "integrity":  { "sha512": "...", "sha256": "..." }, // R
          "signature":  "...ed25519..."                 // R where signed
        }
      },
      "minOs":        "...",                       // O (Sparkle minimumSystemVersion / hardwareRequirements)
      "rollback":     { "enabled": true }        // O - only Expo (auto) + electron-updater allowDowngrade + Tauri comparator have it
    }

What you actually need to (re)build once:
1. Version compare (SemVer + channel).
2. Integrity (sha256 AND sha512 - covers Expo, electron-updater, and gives you a Sparkle-length equivalent).
3. TWO keys, two algorithm families. Desktop installers (Sparkle, WinSparkle, Tauri, electron-updater v27 manifest) natively verify Ed25519. The OTA web-bundle engines differ: Capawesome (Capacitor) is RSA-only (PEM publicKey), and Expo defaults to RSA (rsa-v1_5-sha256) though its expo-signature alg is flexible (RSA/ECDSA/Ed25519). So generate an Ed25519 pair for desktop and an RSA pair for the Capacitor/Expo web bundles. Squirrel has no signature (you'd add one). PWA uses HTTPS only.
4. Staged rollout (a percentage + a stable per-client bucket hash - Squirrel/Expo/electron-updater all do this; Sparkle does it via 7 groups).
5. A release record that fans out to each surface's native manifest shape.

That is the whole engine. Everything else (nupkg, appcast, .appinstaller, blockmap, SW cache) is packaging + OS install mechanics, which you should reuse from the mature libraries rather than reimplement.

========================================================================
13. RECOMMENDATION FOR AIRIZ (one person, 5 surfaces, no per-platform manifest invention)
========================================================================

Your 5 surfaces: Electron/Windows (already electron-updater) . Capacitor Android . Capacitor iOS . PWA . Cloudflare Worker. You already have sync_release_feed.py + electron-updater.

Architecture: one signed release feed, native engine per surface, unified at the Worker.

1. The Cloudflare Worker is your single release origin + signer. It holds one source-of-truth release record (version, channel, pubDate, rollout, artifacts) and, at publish time:
   - computes sha256 + sha512 of each artifact,
   - Ed25519-signs each artifact once,
   - serves a small adapter that renders the record into the exact manifest each client expects (content-negotiated by path/query/UA). You never invent a 6th format - you project the one record into N existing native formats.
2. Electron/Windows -> keep electron-updater (generic provider pointed at the Worker). It already reads latest.yml; your Worker emits that (with stagingPercentage). No new format, minimal change. (Drop Squirrel - electron-builder v27 doesn't use it anyway.)
3. Capacitor Android/iOS (and Electron, if you want) -> @capawesome/capacitor-live-update (Capgo) for the web-bundle OTA. It is RSA-signed (PEM publicKey; SHA-256 hex checksum + base64 RSA signature), supports a single zip or a per-file manifest artifact (X-Checksum / X-Signature headers), and does ready()/reset() rollback. The official @capacitor/live-update is deprecated and off npm; do not use CodePush (retired 2025-03-31). Native updates still go through Play/App Store. (If you ever go React Native, Expo EAS Update / Updates v1 is the equivalent and is RSA-default.)
4. PWA -> Workbox (precache sw.js + registration.update() + the skipWaiting/clients.claim recipe above). The Worker serves sw.js + the precache manifest. No custom protocol.
5. The Worker "surface" isn't an updatable client; it's the distribution layer. It updates by redeploy (wrangler deploy) - so it's outside the app-update loop and is what hosts it. Treat it as the release control plane, not a 5th updatable app.

Why this is the simplest unified architecture for a one-person team:
- Two signing keys, one record, one origin. Ed25519 for the desktop installers (Sparkle/WinSparkle/Tauri/electron-updater-v27 all verify it) and RSA for the Capacitor(Capawesome)/Expo web bundles (Capawesome is RSA-only; Expo defaults to RSA). Keep both keypairs on the Worker so one release record can sign for every surface. If you ever add another native desktop client in the Sparkle/Tauri family, the Ed25519 key already fits.
- Zero new manifest invention - each client keeps its mature, already-audited engine; you only render the record into that engine's shape.
- Rollout + rollback in one place (the Worker's release record): staged % for desktop/PWA, channel for mobile, and "roll back = republish prior record" everywhere (matching Expo's model, which is the most battle-tested).
- Cost for the one-person team: keep electron-updater (about 0.5 wk) + add Capgo plugin (about 1-2 wk) + Workbox SW (about 1-2 wk) + the Worker render/sign layer (about 1-2 wk) = about 4-8 person-weeks to a signed, channel-able, staged, rollback-able release across all 5 surfaces - versus reimplementing any full engine.

Explicitly avoid: CodePush (dead), the official @capacitor/live-update (deprecated), Squirrel for the Electron path (not used by v27), and sha256-only integrity (add sha512 for electron-updater parity).

========================================================================
QUICK VERIFICATION BACKLOG (things flagged [K] to re-pin before coding)
========================================================================

DONE this session (upgraded to [V]):
- [x] Capawesome @capawesome/capacitor-live-update manifest/config + key type (RSA PEM) - from definitions.ts.
- [x] Expo Updates v1 wire protocol (Manifest/Asset/Directive/Extensions + expo-signature) - from the official technical spec.

STILL [K] - re-pin before coding:
- [ ] Microsoft AppInstaller reference page URL + confirm element list (MS Learn windows/msix/package) - learn.microsoft.com unreachable this session.
- [ ] WinSparkle delta-update status in the current release.
- [ ] Tauri mobile updater exact behavior/limits for your Tauri 2 patch (if you add a non-Capacitor mobile path).
- [ ] Exact npm unpublish date of official @capacitor/live-update (reported off npm; deprecation confirmed).

END OF DOCUMENT
========================================================================
14. RELEASE-RECORD -> NATIVE MANIFEST PROJECTION (the "no 6th format" map)
========================================================================

This is the crux of the unified architecture: ONE signed release record, projected
by the Worker into each client's native manifest. Nothing below is a new format -
each row is an existing engine's shape, filled from the same record.

Common-core record (single source of truth, held by the Worker):
    { version, channel, pubDate, rollout, notes,
      artifacts: { "<os-arch>": { url, sha256, sha512, sig } }   // sig = Ed25519 (desktop) or RSA (Capacitor/Expo bundles)

Projection table (record field -> native manifest field):

| Common-core field | electron-updater latest.yml | Tauri static JSON | Sparkle/WinSparkle appcast | Capawesome (Capacitor) | Expo Updates v1 | PWA precache |
|-------------------|-----------------------------|-------------------|----------------------------|------------------------|-----------------|--------------|
| version           | version                     | version           | sparkle:version            | bundleId (semver string)  | version (via extra/metadata) | (SW content hash) |
| channel           | file name (beta.yml)        | endpoint ?channel | sparkle:channel            | setChannel / defaultChannel (versioned) | branch + channel (server-side; metadata+filters) | (none) |
| pubDate           | releaseDate                 | pub_date          | pubDate                    | createdAt (Cloud)           | createdAt              | (none) |
| rollout %         | stagingPercentage           | (server-side only)| phasedRolloutInterval      | (Cloud rollout)             | --rollout-percentage | (none) |
| artifacts[].url   | files[].url                 | platforms[].url   | enclosure url              | downloadBundle.url / per-file ?href= | launchAsset/assets[].url | precache url |
| sha256            | (sha512 preferred)          | (signature)       | (length + edSignature)     | checksum (SHA-256 hex) / X-Checksum hdr | assets[].hash (b64url SHA-256) | (revision) |
| sha512            | files[].sha512              | -                 | -                          | -                           | -                  | - |
| signature         | (v27 Ed25519 manifest sig)  | platforms[].signature (Ed25519) | enclosure edSignature (Ed25519) | signature (RSA, base64) / X-Signature hdr | expo-signature (RSA/ECDSA/Ed25519) | (none; HTTPS) |
| notes             | (separate release notes)    | notes             | releaseNotesLink/description | (customProperties)        | (separate)          | (none) |
| minOs/compat      | -                           | (endpoint routing)| minimumSystemVersion/hardwareRequirements | getVersionCode()/VersionName gate | runtimeVersion | (none) |
| rollback flag     | allowDowngrade              | version_comparator| minimumAutoupdateVersion   | reset() / autoBlockRolledBackBundles | Directive rollBackToEmbedded | (redeploy SW) |

Reading of the map:
- The fields every engine has in some form are exactly: version, channel, url,
  an integrity value, a signature (4 of 5 signed engines), notes, and a rollout/
  rollback control. Everything else is packaging/install mechanics owned by the engine.
- The one field that does NOT map 1:1 across all engines is "minOs / compatibility":
  Sparkle/WinSparkle use minimumSystemVersion + hardwareRequirements, Tauri uses
  OS-ARCH platform keys, Expo uses runtimeVersion (a native-layer hash), and
  electron-updater / PWA have no equivalent (they rely on the artifact itself).
  This is the only place the unified record needs per-surface interpretation.

========================================================================
15. CROSS-ENGINE OPS / FAILURE CHEAT SHEET
========================================================================

Stuck / not updating:
- electron-updater: set autoUpdater.logger; check app-update.yml feed; Windows
  session-end may have deferred install (autoInstallEvent); macOS needs code signing.
- Sparkle/WinSparkle: open Console/Event Log; delta ignored if running checksum
  mismatch; channels need all clients on Sparkle 2+.
- Tauri: endpoint returned 204 (no update) or non-2XX; TLS enforced in prod;
  Windows auto-exits before install (on_before_exit to save state).
- Expo: wrong runtimeVersion => no compatible update; use eas update:view;
  rollout may be < 100% for your bucket.
- Capgo/Capacitor: check channel + key match; OTA can't change native (rebuild).
- PWA: SW stuck in waiting (no reload) => users see stale; fix with skipWaiting
  prompt + registration.update(); precache revision unchanged => no re-fetch.

Bad release in the field:
- electron-updater: bump version ABOVE the broken one (staged); allowDowngrade to force back.
- Sparkle/WinSparkle: re-publish prior item / Updater.exe; minimumAutoupdateVersion gates.
- Tauri: point endpoint at older bundle or override version_comparator.
- Expo: eas update:rollback (republish prior) or roll-back-to-embedded (auto).
- Capgo: republish/rollback prior release in Capgo.
- Squirrel: no rollback - ship a higher version.
- PWA: redeploy prior sw.js + precache; activate cleans old caches.

Integrity / trust model cheat sheet:
- Strong (asymmetric, client-verified, Ed25519): Sparkle, WinSparkle, Tauri (mandatory),
  electron-updater v27 (manifest sig). AppInstaller (MSIX sig + OS trust).
- Strong (asymmetric, client-verified, RSA): Capawesome Capacitor (PEM RSA, base64 sig over
  SHA-256), Expo Updates v1 (expo-signature; RSA-default, ECDSA/Ed25519 also allowed).
- Symmetric / hash-only: Squirrel (SHA1), CodePush (server hash).
- Transport-only: PWA/SW (HTTPS).
- => Ed25519 is the common denominator ONLY across the desktop installers. The OTA
  web-bundle engines (Capawesome, Expo) are RSA by default - so pin Ed25519 for desktop
  + RSA for the Capacitor/Expo bundles (two keys, signed on the same Worker).

Key-loss / rotation cheat sheet:
- Sparkle: rotate Developer ID OR EdDSA (not both); needs signed .dmg if
  SUVerifyUpdateBeforeExtraction on; failsafe SUSignedFeedFailureExpirationInterval.
- Tauri: runtime .pubkey(...) for rotation; losing the private key = can't publish.
- electron-updater: transition release (key-rotation doc); sign before pre-signing URLs.
- WinSparkle: no protocol primitive - keep prior trust.
- Capgo/Expo: server-side key management (SaaS).
- Squirrel: n/a (no signature).

END OF DOCUMENT
