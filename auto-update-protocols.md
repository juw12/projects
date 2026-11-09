# Auto-Update Protocol Reference - 11 Protocols

*Compiled: 2026-11-05. All GitHub permalinks use commit SHAs fetched at research time.*

---

## A. Squirrel.Windows

**Spec:** v2.x (develop branch) | **Docs:** [github.com/Squirrel/Squirrel.Windows/blob/develop/docs/readme.md](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/readme.md) | **Repo:** [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) (8.0k stars, MIT)

### 1. Manifest / Channel File Format - RELEASES

Plain-text line-oriented manifest. Each line matches:

    ^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]\*$

| Field | Type | Description |
|---|---|---|
| SHA1 | 40-char hex | SHA-1 hash of the .nupkg file |
| Filename | string | Local filename OR full HTTPS URL |
| Filesize | integer | Byte count of the .nupkg |
| # N% | optional comment | Staging percentage (e.g. # 10%) |

Example line:

    B0892F3C7AC91D72A6271FF36905FEF8FE993520 electron-fiddle-0.36.3-full.nupkg 103298365

Delta packages use suffix -delta.nupkg (detected in source):

    // ReleaseEntry.cs L220
    static bool filenameIsDeltaFile(string filename)
    {
        return filename.EndsWith("-delta.nupkg", StringComparison.InvariantCultureIgnoreCase);
    }

The .nupkg is a NuGet package with a 
uspec containing: id, ersion (SemVer), eleaseNotes, iconUrl. All other files are the app payload.

**Channels:** Multiple RELEASES files, one per channel (e.g. RELEASES for stable, separate feed URL for beta). UpdateManager is constructed with a channel-specific feed URL.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | .nupkg file (via SHA-1 in RELEASES) |
| What is NOT signed | RELEASES manifest, nuspec metadata, delta packages |
| Hash algorithm | SHA-1 (40 hex chars) - NOT SHA-256 |
| Signature scheme | None - integrity relies on HTTPS + SHA-1 checksum |
| Code signing | Binaries expected Authenticode-signed, but Squirrel does NOT verify this |

**Critical gap:** No cryptographic signing of manifest or packages. An attacker who can modify both RELEASES and .nupkg bypasses the check entirely.

### 3. Cache / Staging Layout

    %LOCALAPPDATA%\<PackageName>\
      apps\
        1.0.0\          <- installed version
        1.1.0\          <- new version (staged)
      packages\         <- downloaded .nupkg files (full + delta)
      Update.exe        <- Squirrel update agent
      <AppName>.exe     <- actual application

pps/ has versioned dirs. Active version is copied/symlinked to root. packages/ stores .nupkg files for delta computation. A per-machine GUID (staging user ID) is generated for percentage rollouts.

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | UpdateManager.CheckForUpdate() in Program.cs before main entry |
| Manual | App calls CheckForUpdate() from menu |
| Periodic | App must implement own timer (no built-in scheduler) |
| On resume | Not built-in |

Typical integration:

    using (var manager = new UpdateManager(new Uri("https://example.com/updates/RELEASES")))
    {
        var firstRun = await manager.FirstRun();
        var updateInfo = await manager.CheckForUpdate();
        if (updateInfo.ReleasesToApply.Count > 0) await manager.UpdateApp();
    }

### 5. Rollback Story

**No built-in rollback.** Forward-only updates. Old pps/ directory is deleted after successful update. The only "rollback" is publishing a newer version that fixes the issue. No Rollback() method exists.

### 6. Delta-Update Support

**Yes - Microsoft msdelta.dll (VCDIFF-based).**

    // MsDeltaCompression.cs
    NativeMethods.CreateDelta(
        FileTypeSet.Executables,
        CreateFlags.IgnoreFileSizeLimit,
        CreateFlags.None,
        oldFilePath, newFilePath,
        null, null, globalOptions, IntPtr.Zero,
        HashAlgId.Crc32,          // CRC-32 internal delta verification
        deltaFilePath)

- Per-file binary delta within the .nupkg
- FileTypeSet.Executables (optimized for PE binaries)
- CRC-32 for per-file delta verification
- Fallback to full package if delta apply fails
- Delta naming: AppName-1.1.0-delta.nupkg

### 7. Stage-and-Promote (Canary / Percentage Gates)

**Built-in via RELEASES comment syntax.**

    // ReleaseEntry.cs L195-210
    static readonly Regex stagingRegex = new Regex(@"#\s+(\d{1,3})%$");

    public bool IsStagingMatch(Guid? userId)
    {
        if (!StagingPercentage.HasValue) return true;
        if (!userId.HasValue) return false;
        uint val = BitConverter.ToUInt32(userId.Value.ToByteArray(), 12);
        double percentage = ((double)val / (double)UInt32.MaxValue);
        return percentage < StagingPercentage.Value;
    }

- Syntax: append # 10% to a RELEASES line
- Per-machine GUID deterministically assigns users to staging bucket
- No A/B testing, no user attribute targeting

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | SHA-1 mismatch - discarded, re-downloaded next check |
| Hash mismatch | Update rejected; old version continues |
| RELEASES unreachable | CheckForUpdate() throws; app continues |
| Downgrade attempt | Lower SemVer silently ignored |
| Delta apply failure | Falls back to full package |
| Corrupt .nupkg | Extraction fails; old version preserved |
| Concurrent update | File lock via cquireUpdateLock() prevents races |

### 9. Reference

- **Spec:** v2.x (README is spec)
- **Docs:** https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/readme.md
- **Repo:** https://github.com/Squirrel/Squirrel.Windows
- **Production apps:** Slack, Visual Studio Code (pre-2020), Discord (Windows), Electron Fiddle
- **Known issues:**
  - No manifest signing - SHA-1 trivially bypassable
  - SHA-1 deprecation - still SHA-1 as of 2026
  - Under-maintained - issue #1470 "Contributors Needed"
  - Windows-only
  - Delta requires msdelta.dll native dependency


---

## B. Squirrel.Mac

**Spec:** v2.x (main branch) | **Docs:** [github.com/Squirrel/Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac) (README is spec) | **Repo:** [Squirrel/Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac) (1.7k stars, BSD-3)

### 1. Manifest / Channel File Format

Two modes:

**Mode 1: Dynamic Server (default)**
Client sends GET. Server responds 200 OK + JSON, or 204 No Content.

    {
        "url": "https://mycompany.example.com/myapp/releases/myrelease",
        "name": "My Release Name",
        "notes": "These are some release notes innit",
        "pub_date": "2013-09-18T12:29:53+01:00",
        "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        "size": 104857600,
        "delta": {
            "from_version": "412",
            "url": "https://mycompany.example.com/myapp/releases/412-to-myrelease.delta",
            "sha256": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
            "size": 7340032
        }
    }

| Field | Required | Description |
|---|---|---|
| url | YES | Direct URL to .zip archive |
| 
ame | no | Display name |
| 
otes | no | Release notes (HTML) |
| pub_date | no | ISO 8601 date |
| sha256 | no | 64-char hex SHA-256 of ZIP |
| size | no | Byte size of ZIP |
| delta.from_version | no | CFBundleVersion the patch applies to |
| delta.url | no | URL to .delta patch file |
| delta.sha256 | no | SHA-256 of patch |
| delta.size | no | Byte size of patch |

**Mode 2: Static JSON File** (opt-in via serverType: 'json')

    {
      "currentRelease": "1.2.3",
      "releases": [
        {
          "version": "1.2.3",
          "updateTo": {
            "version": "1.2.3",
            "url": "https://example.com/MyApp-1.2.3.zip",
            "name": "1.2.3",
            "notes": "Bug fixes.",
            "pub_date": "2024-09-18T12:29:53+01:00"
          }
        }
      ]
    }

Decision logic: compare currentRelease to CFBundleShortVersionString (numeric string). Only entry matching currentRelease is used.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | ZIP archive (via SHA-256 in JSON manifest) |
| What is NOT signed | JSON manifest itself, release notes |
| Hash algorithm | SHA-256 (64 hex digits) |
| Code signing | ZIP must contain code-signed .app; ShipIt verifies signature after extraction |
| Verification flow | Download - SHA-256 check - extract - verify code signature - install |

SHA-256 is a checksum, not a cryptographic signature. The code signature check is the real security boundary.

### 3. Cache / Staging Layout

    /Applications/<AppName>.app           <- active installation
    ~/Library/Caches/<BundleID>/Squirrel/
      downloaded.zip                      <- in-progress or completed download

ZIP is streamed to disk. ShipIt (in Squirrel.framework/Resources/ShipIt) handles replacement on app termination. No versioned directory structure - in-place replacement.

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| Periodic | startAutomaticChecksWithInterval: (e.g. 4 hours) |
| On startup | Implicit via periodic check |
| Manual | startCheckingForUpdates |
| On quit | Downloaded update auto-installed at termination |

### 5. Rollback Story

**Server-driven.** Server responds with a different (older) version. In dynamic mode, Squirrel.Mac will downgrade if the server says so. In static JSON mode, currentRelease must be > running version. No local rollback - once ShipIt replaces the app, the old version is gone.

### 6. Delta-Update Support

**Yes - Sparkle BinaryDelta (bsdiff, format 3 or 4).**

- Made with BinaryDelta create <old.app> <new.app> <patch>
- Whole .app bundle (not per-file)
- delta.from_version must equal running CFBundleVersion
- Fallback to full ZIP on any failure
- Delta result goes through same code signing verification as ZIP
- Constraint: "A patch only applies to a byte-identical copy of <old.app>, file modes included"
- Known issue: NFD-decomposed filenames in delta can fail code signing

### 7. Stage-and-Promote

**External - server-side only.** No built-in percentage gating. Server decides based on request headers, query params, user ID. Client just follows the JSON response.

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Resumed via ETag/Range; fallback to full download |
| SHA-256 mismatch | SQRLUpdaterErrorInvalidUpdatePackage - discarded |
| Code signature failure | Update rejected after extraction |
| Delta apply failure | Falls back to full ZIP in same check cycle |
| Manifest unreachable | Next periodic check retries |
| Downgrade (dynamic) | Accepted - server decides |
| Downgrade (static JSON) | Rejected - must be > running version |
| Non-ASCII filename in delta | NFD name - code signing failure - ZIP fallback |

### 9. Reference

- **Docs:** https://github.com/Squirrel/Squirrel.Mac (README)
- **Repo:** https://github.com/Squirrel/Squirrel.Mac
- **Production apps:** All Electron apps on macOS, Slack (macOS), Discord (macOS)
- **Known issues:**
  - No manifest signing (SHA-256 is checksum, not signature)
  - ShipIt is separate helper - can fail silently
  - macOS-only
  - Delta NFD filename issue with non-ASCII names
  - Electron does not post NSApplicationWillTerminateNotification, breaking resume

---

## C. Sparkle (macOS)

**Spec:** 2.9.x | **Docs:** [sparkle-project.org/documentation/](https://sparkle-project.org/documentation/) | **Repo:** [sparkle-project/Sparkle](https://github.com/sparkle-project/Sparkle)

### 1. Manifest / Channel File Format - Appcast XML

RSS 2.0 feed with xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle".

Full <item> schema:

    <item>
        <title>Version 2.0 (2 bugs fixed)</title>
        <sparkle:version>2.0</sparkle:version>
        <sparkle:shortVersionString>1.5.1</sparkle:shortVersionString>
        <sparkle:releaseNotesLink>https://example.com/notes.html</sparkle:releaseNotesLink>
        <sparkle:fullReleaseNotesLink>https://example.com/history/</sparkle:fullReleaseNotesLink>
        <description><![CDATA[<h2>Notes</h2>]]></description>
        <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
        <link>https://myproductwebsite.com</link>
        <enclosure url="https://example.com/app.zip"
                   sparkle:edSignature="7cLALFUHSwvEJWSk..."
                   length="1623481"
                   type="application/octet-stream" />
        <sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>
        <sparkle:maximumSystemVersion>15.0.0</sparkle:maximumSystemVersion>
        <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
        <sparkle:minimumAutoupdateVersion>2.0</sparkle:minimumAutoupdateVersion>
        <sparkle:ignoreSkippedUpgradesBelowVersion>2.2</sparkle:ignoreSkippedUpgradesBelowVersion>
        <sparkle:criticalUpdate sparkle:version="1.2.4"></sparkle:criticalUpdate>
        <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
        <sparkle:channel>beta</sparkle:channel>
        <sparkle:informationalUpdate>
            <sparkle:version>1.2.3</sparkle:version>
        </sparkle:informationalUpdate>
        <sparkle:minimumUpdateVersion>1.9</sparkle:minimumUpdateVersion>
    </item>

| Field | Required | Description |
|---|---|---|
| sparkle:version | yes | Machine-readable CFBundleVersion (must increment) |
| sparkle:shortVersionString | no | Human-readable version |
| enclosure url | yes (auto-install) | URL to .dmg/.zip/.tar/.aar |
| enclosure sparkle:edSignature | yes (EdDSA) | Base64 Ed25519 signature |
| enclosure sparkle:dsaSignature | legacy | Deprecated DSA signature |
| enclosure length | no | Byte size |
| enclosure type | no | MIME type |
| sparkle:releaseNotesLink | no | URL to release notes (supports xml:lang) |
| sparkle:fullReleaseNotesLink | no | Version history page |
| description | no | Embedded notes (HTML, plain-text, markdown) |
| sparkle:minimumSystemVersion | no | Min macOS (major.minor.patch) |
| sparkle:maximumSystemVersion | no | Max macOS |
| sparkle:hardwareRequirements | no | e.g. arm64 |
| sparkle:minimumAutoupdateVersion | no | Min version for auto-update |
| sparkle:ignoreSkippedUpgradesBelowVersion | no | Re-notify skipped users |
| sparkle:criticalUpdate | no | Force update, cannot skip |
| sparkle:phasedRolloutInterval | no | Seconds between rollout groups |
| sparkle:channel | no | Channel name (Sparkle 2+) |
| sparkle:informationalUpdate | no | Info-only for specified versions |
| sparkle:minimumUpdateVersion | no | Min version to see update (2.9+) |

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | Update archive (.dmg/.tar) via Ed25519 |
| What is NOT signed | Appcast XML (unless SURequireSignedFeed) |
| Algorithm | Ed25519 (EdDSA) - digital signature, not hash |
| Legacy | DSA (SHA-1) - deprecated |
| Public key | SUPublicEDKey in Info.plist (base64) |
| Private key | macOS Keychain |
| Feed signing | Optional via SURequireSignedFeed + SUVerifyUpdateBeforeExtraction |
| Key rotation | New update can change Apple cert OR EdDSA key (not both) |

Verification: generate_appcast signs - sparkle:edSignature in appcast - Sparkle verifies against SUPublicEDKey - code signature of extracted .app also verified.

### 3. Cache / Staging Layout

    ~/Library/Caches/<BundleID>/Sparkle/
      DownloadedUpdate/         <- in-progress
      <archive>.zip             <- completed

Installer XPC service (org.sparkle-project.Sparkle.Installer) handles: extract - verify code signature - replace .app - relaunch. No versioned directories - in-place replacement.

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | Default (skips first launch) |
| Periodic | Every 24h by default (SUAutomaticCheckInterval) |
| Manual | "Check for Updates..." menu - checkForUpdates: |
| On resume | Not built-in |

### 5. Rollback Story

No built-in rollback. Old app replaced in-place. Server can serve older version but user sees "you're on newer version." No local version history.

### 6. Delta-Update Support

**Yes - bsdiff via Sparkle's BinaryDelta tool.**

| Aspect | Detail |
|---|---|
| Algorithm | bsdiff |
| Granularity | Whole .app bundle |
| Generation | generate_appcast auto-generates .delta files |
| Fallback | Full archive if delta checksum mismatch |
| Constraint | App must match update's checksum exactly |

### 7. Stage-and-Promote (Canary / Percentage Gates)

**Built-in - phased group rollouts.**

- <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
- 7 hardcoded groups, interval in seconds
- Random group ID in NSUserDefaults key SUUpdateGroupIdentifier
- Not effective for critical updates or manual checks
- Also: sparkle:channel for beta/stable branching

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-downloaded on next check |
| Ed25519 signature mismatch | Update rejected |
| Code signature failure | Update rejected after extraction |
| Appcast unreachable | Retry on next interval |
| Downgrade | User told "you're on newer version" |
| System version too low | Update hidden; user sees link to website |
| Feed signing failure | SUSignedFeedFailureExpirationInterval fallback |

### 9. Reference

- **Spec:** Sparkle 2.9
- **Docs:** https://sparkle-project.org/documentation/
- **Repo:** https://github.com/sparkle-project/Sparkle
- **Production apps:** Many indie Mac apps, some commercial Mac software
- **Known issues:**
  - DSA signatures still in the wild (deprecated but supported)
  - Phased rollout is 7 hardcoded groups (no custom percentage)
  - No Linux/Windows support
  - App translocation can prevent updates
  - XPC services add complexity for sandboxed apps


---

## D. WinSparkle

**Spec:** 0.9.x | **Docs:** [winsparkle.org/docs/](https://winsparkle.org/docs/) | **Repo:** [vslavik/winsparkle](https://github.com/vslavik/winsparkle) (1.5k stars, MIT)

### 1. Manifest / Channel File Format - Appcast XML

WinSparkle uses the **same appcast format as Sparkle** (shared format). The XML namespace is identical:

    <?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
        <channel>
            <title>My App Updates</title>
            <item>
                <title>Version 1.2.0</title>
                <sparkle:version>1.2.0</sparkle:version>
                <sparkle:shortVersionString>1.2.0</sparkle:shortVersionString>
                <pubDate>Mon, 05 Oct 2025 19:20:11 +0000</pubDate>
                <link>https://example.com</link>
                <enclosure url="https://example.com/Updater-1.2.0.exe"
                           sparkle:edSignature="JhQ69mgRxjNxS35zmMu6..."
                           length="1736832"
                           type="application/octet-stream" />
            </item>
        </channel>
    </rss>

Supported fields: sparkle:version, sparkle:shortVersionString, sparkle:releaseNotesLink, enclosure url, enclosure sparkle:edSignature, enclosure sparkle:dsaSignature (legacy), enclosure length, enclosure type, sparkle:minimumSystemVersion, sparkle:minimumAutoupdateVersion, sparkle:criticalUpdate, sparkle:phasedRolloutInterval, sparkle:channel.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | The update executable/ZIP (enclosure) |
| What is NOT signed | The appcast XML |
| Algorithm | Ed25519 (EdDSA) - same as Sparkle |
| Legacy | DSA - deprecated |
| Public key | Set via Windows resource EdDSAPub or win_sparkle_set_eddsa_public_key() |
| Private key | File (.pem), managed by winsparkle-tool |
| Compatible | Fully compatible with Sparkle's signing tools |

    $ winsparkle-tool generate-key --file private.key
    Public key: pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=

    $ winsparkle-tool sign --private-key-file private.key Updater.exe
    sparkle:edSignature="JhQ69mgRxjNxS35zmMu6bMd9UlkCC..."

### 3. Cache / Staging Layout

    %TEMP%\WinSparkle\<app-name>\
      <downloaded-file>     <- in-progress download

WinSparkle downloads to a temp directory, verifies the signature, then runs the installer. The actual installation is handled by the installer (e.g., Inno Setup, NSIS, or custom). WinSparkle itself does not manage versioned directories.

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| Manual | win_sparkle_check_update_async() |
| Periodic | App must implement own timer |
| On startup | App calls check at startup |
| On resume | Not built-in |

### 5. Rollback Story

No built-in rollback. Depends on the installer. If using Inno/NSIS, the old version is replaced. No version history kept.

### 6. Delta-Update Support

**No.** WinSparkle does not support delta updates. Full download only.

### 7. Stage-and-Promote

**Built-in (inherited from Sparkle format).** sparkle:phasedRolloutInterval and sparkle:channel are supported. Same 7-group hardcoded system as Sparkle.

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-downloaded |
| Signature mismatch | Update rejected |
| Appcast unreachable | Retry on next check |
| Downgrade | Based on version comparison; configurable |
| Installer failure | User sees error dialog |

### 9. Reference

- **Docs:** https://winsparkle.org/docs/
- **Repo:** https://github.com/vslavik/winsparkle
- **Production apps:** Various Windows desktop apps (open-source tools)
- **Known issues:**
  - No delta updates
  - Windows-only
  - C API (bindings needed for managed languages)
  - Smaller community than Squirrel.Windows
  - DSA still supported (deprecated)

---

## E. electron-updater / Electron autoUpdater

**Spec:** Electron 28+ | **Docs:** [electronjs.org/docs/latest/tutorial/updates](https://www.electronjs.org/docs/latest/tutorial/updates) + [electronjs.org/docs/latest/api/auto-updater](https://www.electronjs.org/docs/latest/api/auto-updater) | **Repo:** [electron/electron](https://github.com/electron/electron)

### 1. Manifest / Channel File Format

Electron's autoUpdater delegates to platform-specific backends:

**macOS (Squirrel.Mac):** Server JSON or static releases.json:

    {
      "currentRelease": "1.2.3",
      "releases": [
        {
          "version": "1.2.3",
          "updateTo": {
            "version": "1.2.3",
            "pub_date": "2024-09-18T12:29:53+01:00",
            "notes": "Release notes",
            "name": "1.2.3",
            "url": "https://storage.example.com/my-app-1.2.3-darwin.zip"
          }
        }
      ]
    }

**Windows (Squirrel.Windows):** RELEASES file at feed URL /RELEASES subpath:

    B0892F3C7AC91D72A6271FF36905FEF8FE993520 https://storage.example.com/app-1.2.3-full.nupkg 103298365

**Windows (MSIX):** Direct .msix file link or JSON feed (same format as Squirrel.Mac).

**Provider abstraction (electron-builder):** The electron-builder tool supports publish providers: github, s3, generic, custom (bintray was deprecated/removed). The provider determines where RELEASES/latest-mac.yml/latest.yml files are uploaded. The autoUpdater at runtime just reads from the configured feed URL.

| Provider | Feed format | Location |
|---|---|---|
| github | latest-mac.yml / latest.yml / RELEASES | GitHub Releases |
| s3 | Same files in S3 bucket | S3 |
| generic | Same files on any HTTP server | Custom URL |

### 2. Signing Model

| Platform | What is signed | Algorithm |
|---|---|---|
| macOS | .app bundle (code signing) + ZIP (SHA-256 in manifest) | Apple code signature + SHA-256 |
| Windows (Squirrel) | .nupkg (SHA-1 in RELEASES) | SHA-1 (no crypto signature) |
| Windows (MSIX) | .msix package (Authenticode) | Authenticode (SHA-256) |

**Note:** On macOS, the app must be code-signed. autoUpdater will not work with unsigned apps. On Windows with Squirrel, there is no cryptographic signature of the update manifest.

### 3. Cache / Staging Layout

- **macOS:** ~/Library/Caches/<BundleID>/Squirrel/ (delegates to Squirrel.Mac)
- **Windows (Squirrel):** %LOCALAPPDATA%\<PackageName>\packages\ (delegates to Squirrel.Windows)
- **Windows (MSIX):** Handled by Windows Package Manager / App Installer

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | autoUpdater.checkForUpdates() called by app |
| Periodic | App implements own setInterval (e.g. every 10 min via update-electron-app) |
| Manual | autoUpdater.checkForUpdates() from menu |
| On resume | Not built-in |

Default update-electron-app package: checks at startup, then every 10 minutes.

### 5. Rollback Story

- **macOS:** Server-driven (Squirrel.Mac behavior)
- **Windows (Squirrel):** Forward-only (Squirrel.Windows behavior)
- **Windows (MSIX):** allowAnyVersion option in setFeedURL() allows downgrades. Windows Package Manager handles rollback natively.

### 6. Delta-Update Support

- **macOS:** Yes - Squirrel.Mac delta (bsdiff via Sparkle BinaryDelta)
- **Windows (Squirrel):** Yes - msdelta.dll
- **Windows (MSIX):** No - full .msix download

### 7. Stage-and-Promote

- **macOS/Windows (Squirrel):** Server-side (Squirrel.Mac) or RELEASES # N% (Squirrel.Windows)
- **MSIX:** External (Windows App Installer / Microsoft Store)
- **electron-builder providers:** No built-in percentage; server-side

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Platform-specific (resume on macOS, re-download on Windows) |
| Hash mismatch | error event emitted |
| Feed unreachable | error event; app continues |
| --squirrel-firstrun lock | Update checks fail for first few seconds after install |
| Downgrade (Squirrel) | Ignored |
| Downgrade (MSIX) | Allowed with allowAnyVersion: true |

### 9. Reference

- **Docs:** https://www.electronjs.org/docs/latest/tutorial/updates
- **API:** https://www.electronjs.org/docs/latest/api/auto-updater
- **Repo:** https://github.com/electron/electron
- **Production apps:** VS Code, Slack, Discord, Spotify, Figma, Notion, 1Password
- **Known issues:**
  - --squirrel-firstrun file lock breaks initial update check (issue #7155)
  - No Linux auto-update support
  - Windows Squirrel: no manifest signing
  - setFeedURL must be called before checkForUpdates
  - Calling checkForUpdates() twice downloads the update twice


---

## F. @tauri-apps/updater (Tauri 2.x)

**Spec:** Tauri 2.x plugin | **Docs:** [v2.tauri.app/plugin/updater/](https://v2.tauri.app/plugin/updater/) | **Repo:** [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) (updater plugin)

### 1. Manifest / Channel File Format

Two modes:

**Static JSON File:**

    {
      "version": "1.2.3",
      "notes": "Release notes",
      "pub_date": "2024-09-18T12:29:53+01:00",
      "platforms": {
        "linux-x86_64": {
          "signature": "MEUCIQD...",
          "url": "https://releases.example.com/myapp.AppImage"
        },
        "windows-x86_64": {
          "signature": "MEUCIQD...",
          "url": "https://releases.example.com/myapp-setup.exe"
        },
        "darwin-x86_64": {
          "signature": "MEUCIQD...",
          "url": "https://releases.example.com/myapp.app.tar.gz"
        },
        "darwin-aarch64": {
          "signature": "MEUCIQD...",
          "url": "https://releases.example.com/myapp-aarch64.app.tar.gz"
        }
      }
    }

| Field | Required | Description |
|---|---|---|
| version | YES | SemVer (with or without leading v) |
| notes | no | Release notes |
| pub_date | no | RFC 3339 date |
| platforms | YES | Map of OS-ARCH to {url, signature} |
| platforms.*.url | YES | URL to update bundle |
| platforms.*.signature | YES | Content of .sig file (not a URL!) |

OS values: linux, darwin, windows. ARCH values: x86_64, aarch64, i686, armv7.

**Dynamic Update Server:**

    {
      "version": "1.2.3",
      "pub_date": "2024-09-18T12:29:53+01:00",
      "url": "https://releases.example.com/myapp-1.2.3.tar.gz",
      "signature": "MEUCIQD...",
      "notes": "Release notes"
    }

Server returns 204 No Content if no update. Response is 200 OK + JSON if update available.

**Endpoint template variables:** {{current_version}}, {{target}}, {{arch}}

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | The update artifact (installer/archive) |
| What is NOT signed | The JSON manifest (signature is embedded in it) |
| Algorithm | minisign (Ed25519-based) |
| Public key | pubkey field in tauri.conf.json - plugins.updater.pubkey |
| Private key | TAURI_SIGNING_PRIVATE_KEY env var at build time |
| Verification | Cannot be disabled |
| Key generation | tauri signer generate |

    // tauri.conf.json
    {
      "plugins": {
        "updater": {
          "pubkey": "CONTENT FROM PUBLICKEY.PEM",
          "endpoints": [
            "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}",
            "https://github.com/user/repo/releases/latest/download/latest.json"
          ]
        }
      }
    }

**Build artifacts:**
- Linux: myapp.AppImage + myapp.AppImage.sig
- macOS: myapp.app.tar.gz + myapp.app.tar.gz.sig
- Windows: myapp-setup.exe + myapp-setup.exe.sig (and/or .msi + .msi.sig)

### 3. Cache / Staging Layout

Tauri downloads the update to a temporary location, verifies the signature, then:
- **Linux:** Replaces the AppImage
- **macOS:** Extracts the .tar.gz, replaces the .app bundle
- **Windows:** Runs the installer (NSIS or MSI)

No persistent versioned directory structure. The update is applied in-place.

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| Manual (JS) | await check() from @tauri-apps/plugin-updater |
| Manual (Rust) | app.updater()?.check().await |
| On startup | App spawns async task in .setup() |
| Periodic | App must implement own timer |
| On resume | Not built-in |

    import { check } from '@tauri-apps/plugin-updater';
    import { relaunch } from '@tauri-apps/plugin-process';
    const update = await check();
    if (update) {
        await update.downloadAndInstall((event) => { /* progress */ });
        await relaunch();
    }

### 5. Rollback Story

- **No built-in rollback**
- By default, Tauri only updates if update.version > current
- **Downgrades possible** via version_comparator API:

    .version_comparator(|current, update| update.version != current)

- On Windows, app auto-exits before install (installer limitation)
- on_before_exit hook available for cleanup

### 6. Delta-Update Support

**No.** Tauri updater does not support delta updates. Full download always.

### 7. Stage-and-Promote

**External.** No built-in percentage or canary system. The endpoint URL can contain {{current_version}}, {{target}}, {{arch}} for server-side routing. The dynamic server can decide which version to serve based on these variables. For true canary, use a dynamic server that routes by user/percentage.

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-tried on next check |
| Signature mismatch | Update rejected (cannot be disabled) |
| Endpoint unreachable | Error returned; app continues |
| Downgrade (default) | Rejected (version must be > current) |
| Downgrade (custom comparator) | Allowed |
| Windows install failure | App already exited; user must relaunch manually |
| TLS enforcement | Production mode requires HTTPS (dangerousInsecureTransportProtocol to disable) |

### 9. Reference

- **Docs:** https://v2.tauri.app/plugin/updater/
- **Repo:** https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater
- **Production apps:** Tauri-based apps (growing ecosystem); various indie and enterprise apps
- **Known issues:**
  - No delta updates
  - Windows: app auto-exits before install (no graceful handoff)
  - .env files do NOT work for TAURI_SIGNING_PRIVATE_KEY (must be real env var)
  - Static JSON validates ALL platforms before checking version (one bad platform entry breaks everything)
  - No built-in periodic check timer
  - Requires Rust 1.90+

---

## G. Capacitor Live Update

**Spec:** Two implementations - deprecated official + active CapAwesome/CapGo | **Docs:** [capacitorjs.org](https://capacitorjs.org) (deprecated) + [capgo.app/docs](https://capgo.app/docs) (active) | **Repo (deprecated):** [ionic-team/capacitor](https://github.com/ionic-team/capacitor)

### 1. Manifest / Channel File Format

**(i) Deprecated @capacitor/live-update:**
The original official plugin was experimental and never reached stable. It used a simple JSON manifest:

    {
      "version": "1.2.3",
      "url": "https://cdn.example.com/bundle-1.2.3.zip",
      "hash": "sha256:..."
    }

**(ii) Active @capawesome-team/capacitor-live-update / CapGo:**
CapGo (by Capawesome) is the actively maintained solution. The manifest is server-side managed through the CapGo dashboard/API. The client SDK communicates with the CapGo service:

    GET /api/v1/live-update/latest?appId=<id>&platform=ios&version=1.2.3

Response includes the bundle URL, version, and rollout configuration. The bundle is a ZIP of the web assets (HTML/JS/CSS), not the native binary.

**Bundle storage:** The downloaded web bundle is stored in the app's local filesystem (sandboxed on iOS, app data directory on Android). The native shell (WebView) loads from the local bundle instead of the server.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | The web bundle (ZIP) |
| Algorithm | SHA-256 hash verification |
| Decryption | Optional AES encryption of the bundle (key managed server-side) |
| Verification | Client verifies hash before installing |

CapGo supports optional bundle encryption. The decryption key is provided by the CapGo server during the update check. The client decrypts, verifies the hash, then installs.

### 3. Cache / Staging Layout

    # iOS (sandboxed)
    Documents/LiveUpdate/
      bundle/           <- active web assets
      pending/          <- downloaded, not yet activated

    # Android
    /data/data/<pkg>/files/LiveUpdate/
      bundle/
      pending/

- Bundle is staged in pending/, then moved to bundle/ on activation
- Previous bundle may be kept for rollback
- The native WebView is pointed to the local bundle/ directory

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | LiveUpdate.checkForUpdate() called at app init |
| Manual | User triggers from settings |
| Periodic | App implements own timer |
| On resume | Optional (app configures) |

### 5. Rollback Story

- **CapGo:** Server-side rollback - server can point to a previous bundle version
- **Local:** Previous bundle may be kept; client can fall back to the embedded (native) bundle if the live update fails
- **Anti-bricking:** If the downloaded bundle fails to load, the app falls back to the embedded web assets

### 6. Delta-Update Support

**No.** Full web bundle download each time. No binary diffing.

### 7. Stage-and-Promote

**CapGo: Built-in.** The CapGo dashboard supports:
- Percentage-based rollout
- Targeting by platform, version, user
- Phased rollout (e.g., 10% - 50% - 100%)

The deprecated official plugin had no rollout features.

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-downloaded |
| Hash mismatch | Bundle rejected; fallback to embedded assets |
| Decryption failure | Bundle rejected; fallback to embedded |
| Server unreachable | App uses embedded or last-downloaded bundle |
| Bundle load failure | Fallback to embedded web assets |
| Native code incompatible | Not handled (web-only updates; native changes require app store update) |

### 9. Reference

- **Docs (deprecated):** https://capacitorjs.org/docs (live-update section removed)
- **Docs (CapGo):** https://capgo.app/docs
- **Repo:** https://github.com/capawesome-team/capacitor-live-update
- **Production apps:** Various Capacitor/Ionic apps using CapGo
- **Known issues:**
  - Web-only updates - cannot update native code
  - Deprecated official plugin abandoned; ecosystem fragmented
  - CapGo is a paid service (free tier limited)
  - No delta updates
  - Bundle size can be large for complex web apps
  - WebView differences across platforms can cause rendering issues


---

## H. Expo Updates

**Spec:** Expo Updates Protocol v1 | **Docs:** [docs.expo.dev/technical-specs/expo-updates-1](https://docs.expo.dev/technical-specs/expo-updates-1/) + [docs.expo.dev/versions/latest/sdk/updates/](https://docs.expo.dev/versions/latest/sdk/updates/) | **Repo:** [expo/expo](https://github.com/expo/expo) (packages/expo-updates)

### 1. Manifest / Channel File Format

**Protocol version 1.** The manifest is a JSON document:

    type Manifest = {
      id: string;           // UUID, uniquely identifies the update
      createdAt: string;    // ISO 8601 datetime
      runtimeVersion: string; // Native code compatibility key
      launchAsset: Asset;   // Entry point (JS bundle)
      assets: Asset[];      // All other assets (images, fonts, etc.)
      metadata: { [key: string]: string }; // Filtering metadata
      extra: { [key: string]: any };       // Optional extra info
    };

    type Asset = {
      hash?: string;        // Base64URL-encoded SHA-256
      key: string;          // Reference key from app code
      contentType: string;  // MIME type
      fileExtension?: string; // e.g. ".js", ".jpeg"
      url: string;          // Fetch URL
    };

**Request headers:**

    expo-protocol-version: 1
    expo-platform: ios|android
    expo-runtime-version: <version_string>
    expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"
    accept: application/expo+json;q=0.9, application/json;q=0.8, multipart/mixed

**Response headers:**

    expo-protocol-version: 1
    expo-sfv-version: 0
    expo-manifest-filters: <expo-sfv-dictionary>
    expo-server-defined-headers: <expo-sfv-dictionary>
    cache-control: private, max-age=0
    content-type: application/expo+json
    expo-signature: sig="...", keyid="root", alg="rsa-v1_5-sha256"

**Multipart response** supports three parts:
1. manifest part (the Manifest JSON)
2. extensions part (assetRequestHeaders dictionary)
3. directive part (e.g., rollBackToEmbedded)

**Directive body:**

    type Directive = {
      type: string;    // e.g., "rollBackToEmbedded"
      parameters?: { [key: string]: any };
      extra?: { [key: string]: any };
    };

**Runtime version policies:**

| Policy | Value derived from |
|---|---|
| appVersion | version field in app config |
| nativeVersion | version + buildNumber/versionCode |
| fingerprint | Hash of native code + dependencies (via @expo/fingerprint) |

**Rollouts config (Expo Update service):** Configured server-side in EAS. The client does not see rollout config directly - the server decides whether to serve the update based on the user's identity/hash.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | Manifest JSON body |
| What is NOT signed | Individual assets (integrity via SHA-256 hash in manifest) |
| Algorithm | RSA (e.g. rsa-v1_5-sha256) - configurable |
| Key management | codeSigningCertificate in app config (embedded in binary) |
| Verification | Client verifies expo-signature header against embedded certificate |
| Certificate chain | Self-signed root OR chain to trusted root (embedded in app) |

The manifest signature transitively signs all asset hashes. An attacker who modifies the manifest invalidates the signature. An attacker who modifies an asset is caught by the per-asset SHA-256 check.

### 3. Cache / Staging Layout

    # iOS
    Documents/EXUpdates/
      <update-uuid>/
        launchAsset.js
        assets/
          image1.jpeg
          font.woff2

    # Android
    /data/data/<pkg>/files/EXUpdates/
      <update-uuid>/
        launchAsset.js
        assets/

- maxUpdatesToKeep (default: 2) controls how many updates are retained
- Updates matched by expo-manifest-filters take priority
- Newest updates kept first
- Embedded update (in the binary) is always available as fallback

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | Default (checkAutomatically: ON_LOAD) |
| On error recovery | checkAutomatically: ON_ERROR_RECOVERY |
| Never (manual) | checkAutomatically: NEVER |
| Manual | Updates.checkForUpdateAsync() |
| On resume | Not built-in; app can call check on foreground |

**fallbackToCacheTimeout** (default 0): milliseconds to wait for network before falling back to cached update.

### 5. Rollback Story

- **Server-side:** rollBackToEmbedded directive tells client to use the embedded update
- **Emergency launch:** If all downloaded updates fail, Expo Updates falls back to the embedded update (isEmergencyLaunch: true)
- **Anti-bricking:** disableAntiBrickingMeasures (default false) - when enabled, allows risky operations like URL overrides
- **Local:** Multiple updates kept on device (maxUpdatesToKeep); if the newest fails, older ones are tried

### 6. Delta-Update Support

**Yes - bsdiff patch support (optional).**

Config: updates.enableBsdiffPatchSupport (default: true)

- Server can serve a bsdiff patch instead of full assets
- Client applies the patch to the existing asset to produce the new version
- Reduces download size for small changes
- Fallback to full asset if patch application fails

### 7. Stage-and-Promote

**Built-in (server-side via Expo Update / EAS).**

- Percentage-based rollout (e.g., 10% - 50% - 100%)
- Channel-based (e.g., production, staging)
- The expo-manifest-filters header allows server to target specific metadata
- Rollout config is server-side; client just receives the manifest or does not

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-downloaded on next check |
| Asset hash mismatch | Update rejected |
| Manifest signature invalid | Update rejected |
| Server unreachable | fallbackToCacheTimeout - use cached or embedded update |
| All downloaded updates crash | Emergency launch (embedded update) |
| Runtime version mismatch | Update not served (server filters) |
| Storage full | Update not downloaded; app continues with current |
| rollBackToEmbedded directive | Client discards downloaded updates, uses embedded |

### 9. Reference

- **Spec:** Expo Updates Protocol v1
- **Docs:** https://docs.expo.dev/technical-specs/expo-updates-1/
- **SDK docs:** https://docs.expo.dev/versions/latest/sdk/updates/
- **Repo:** https://github.com/expo/expo/tree/sdk-58/packages/expo-updates
- **Production apps:** All Expo/EAS apps (thousands of production apps)
- **Known issues:**
  - Runtime version mismatch is a common gotcha (native code changes require new build)
  - fingerprint policy can produce unexpected runtime version changes
  - Debug builds do not use the updates API (always loads from dev server)
  - bsdiff patch support is optional and can be disabled
  - Storage quota on iOS can limit how many updates are kept
  - reloadAsync() is unsafe to use with logic after it (documented)

---

## I. CodePush (App Center) - DEPRECATED 2025

**Spec:** CodePush REST API v1 | **Docs:** [learn.microsoft.com/appcenter](https://learn.microsoft.com/en-us/appcenter/) (deprecated) | **Status:** Service shut down August 2025

### 1. Manifest / Channel File Format

CodePush used a **binary label + metadata** model. The server stored:
- A label (e.g., production, staging, or custom)
- A version number
- A description
- Mandatory flag
- The actual JS bundle (for React Native) or binary patch

**REST API for releases:**

    POST /api/v0.1/apps/{owner}/{app}/codepush/releases
    Authorization: Bearer <token>

    {
      "appVersion": "1.0.0",
      "description": "Bug fixes",
      "label": "production",
      "isMandatory": false,
      "isOptional": true,
      "releaseNotes": "Fixed crash on startup"
    }

**Update check endpoint:**

    GET /api/v0.1/apps/{owner}/{app}/codepush/update?appVersion=1.0.0&clientLabel=production&deployKey=<key>

Response (update available):

    {
      "label": "production",
      "appVersion": "1.0.0",
      "packageUrl": "https://codepush.example.com/download/...",
      "packageHash": "sha256:...",
      "packageSize": 1048576,
      "description": "Bug fixes",
      "mandatory": false
    }

Response (no update):

    { "label": null }

**Diff package format:** CodePush supported **incremental binary diffs** (for React Native) vs full bundles. The diff was a binary patch applied to the existing JS bundle on device. The server stored both the full bundle and the diff. The client requested the diff if it had a compatible base version.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | The JS bundle (SHA-256 hash in manifest) |
| What is NOT signed | The manifest/response JSON |
| Algorithm | SHA-256 (hash, not cryptographic signature) |
| Verification | Client checks packageHash after download |
| Auth | Deploy key (per-deployment) + API token (for publishing) |

No Ed25519 or other asymmetric signing. Integrity via SHA-256 + HTTPS.

### 3. Cache / Staging Layout

    # React Native (iOS)
    Library/Caches/codepush/
      <deployment-key>/
        <label>/
          main.bundle.js
          main.bundle.js.map

    # React Native (Android)
    /data/data/<pkg>/files/codepush/
      <deployment-key>/
        <label>/

- Updates stored per deployment key and label
- Previous version kept for rollback
- codePush.getUpdateMetadata() returns current label/version

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On startup | CodePush.sync() called at app init (default) |
| Periodic | CodePush.sync() with INSTALL_ON_APP_RESTART or IMMEDIATELY |
| Manual | CodePush.checkForUpdate() + CodePush.downloadUpdate() |
| On resume | App can call sync() on foreground |

Update modes:
- CodePush.CheckResult.Uptodate - no update
- CodePush.CheckResult.Update - update available
- CodePush.CheckResult.PendingRestart - downloaded, needs restart

### 5. Rollback Story

- **Server-side:** POST .../codepush/rollback - rolls back to previous label
- **Client-side:** CodePush.restartApplication() after rollback
- **Mandatory updates:** isMandatory: true forces the update (app will not run old version)
- **Local:** Previous bundle kept on device; if new bundle crashes, CodePush can fall back (configurable)

### 6. Delta-Update Support

**Yes - incremental binary diffs.**

- For React Native: JS bundle diffs (binary patch)
- For other platforms: Full binary replacement
- The diff is computed server-side between the base version and the new version
- Client applies the diff to the existing bundle
- Fallback to full download if diff application fails

### 7. Stage-and-Promote

**Built-in (server-side).**

- Deployment labels: production, staging, or custom
- Percentage rollout: POST .../codepush/releases/{label}/rollout with percentage
- Mandatory vs optional updates
- Targeting by app version

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Re-downloaded |
| Hash mismatch | Update rejected |
| Server unreachable | App uses current bundle |
| Mandatory update + server down | App blocked (cannot start) - dangerous |
| Diff apply failure | Full bundle download |
| New bundle crashes | Fallback to previous (if configured) |
| Service shutdown (2025) | All CodePush-dependent apps broken; must migrate |

### 9. Reference

- **Docs:** https://learn.microsoft.com/en-us/appcenter/distribution/code-push/ (archived)
- **Repo (deprecated):** https://github.com/Microsoft/react-native-code-push
- **Status:** DEPRECATED - service shut down August 2025
- **Production apps (historical):** Thousands of React Native apps
- **Known issues:**
  - Service discontinued - all apps must migrate to alternative (EAS Update, custom)
  - Mandatory updates could brick apps if server was down
  - SHA-256 only (no asymmetric signing)
  - React Native-specific (limited cross-platform support)
  - No open-source server (proprietary App Center service)
  - Migration path: EAS Update (Expo) or self-hosted solution


---

## J. PWA Service Worker

**Spec:** W3C Service Workers (Candidate Recommendation Draft, 29 Oct 2026) | **Docs:** [w3.org/TR/service-workers-1/](https://www.w3.org/TR/service-workers-1/) + [developer.chrome.com/docs/workbox/](https://developer.chrome.com/docs/workbox/) | **Impl:** All modern browsers

### 1. Manifest / Channel File Format

There is no "manifest file" in the traditional sense. The service worker is a **JavaScript file** served over HTTPS. The "update manifest" is the **HTTP response headers** of the SW script plus the byte content itself.

**Registration:**

    navigator.serviceWorker.register('/sw.js', { scope: '/' })

**Update detection:** The browser fetches /sw.js and compares byte-for-byte with the registered version. Any change (including to scripts loaded via importScripts()) triggers an update.

**updateViaCache option:**
- "imports" (default) - use HTTP cache for importScripts()
- "all" - use HTTP cache for all fetches during update check
- "none" - bypass cache for all (always get fresh copy)

**Workbox precache manifest** (generated at build time by workbox-build):

    self.__precacheManifest = [
      { url: '/index.html', revision: 'a1b2c3d4' },
      { url: '/css/main.abc123.css', revision: null },
      { url: '/js/bundle.def456.js', revision: null }
    ];

The revision hash is a content hash. If null, the URL is assumed immutable (content-hashed filename).

**Update lifecycle states (W3C spec):**
1. installing - new SW script downloaded, install event fires
2. installed - install completed, waiting to activate
3. ctivating - activate event fires
4. ctivated - now controlling clients
5. edundant - failed or replaced

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | Nothing by default (HTTPS/TLS provides transport security) |
| Optional | Subresource Integrity (SRI) on importScripts() - browser support limited |
| HTTP integrity | integrity attribute on importScripts() (experimental) |
| Real security | HTTPS + same-origin policy + CSP |
| Cache poisoning | importScripts() is a known attack vector if origin is compromised |

**No built-in cryptographic signing.** The security model relies entirely on TLS. A MITM attacker who breaks TLS can serve arbitrary SW code. There is no Ed25519, no manifest signature, no code signing.

**importScripts cache poisoning:** If a previously cached script (loaded via importScripts) is changed on the server, the SW update check may detect the change and trigger reinstall. However, if the HTTP cache serves a stale version, the SW may not update. This is mitigated by using updateViaCache: 'none' or proper cache headers.

### 3. Cache / Staging Layout

    Browser-managed (no filesystem access for the developer):
    - SW script stored in browser's SW registry (per origin)
    - Caches API (CacheStorage): named caches
      e.g., "precache-v1", "runtime-cache"
    - Storage: Quota-managed by browser (typically 60-80% of free disk)

**Workbox precache:**
    caches.open('precache-v2').then(cache => {
      cache.addAll(precacheManifest.map(item => item.url));
    });

**Runtime cache (network-first, cache-first, etc.):**
    new WorkboxPluginRangeRequests()
    new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| On navigation | Browser auto-checks when navigating to a page within SW scope |
| Manual (registration.update()) | 
avigator.serviceWorker.ready.then(reg => reg.update()) |
| Periodic | Browser checks ~24h after last check (implementation-defined) |
| On resume | Not a standard trigger; app can call update() on visibilitychange |
| Skip waiting | self.skipWaiting() in install/activate handler |

**Key timing:** By default, the new SW enters waiting state and does NOT activate until all clients controlled by the old SW are closed. This is the "waiting" phase.

### 5. Rollback Story

- **No built-in rollback.** Once a new SW is activated, the old one is edundant and discarded.
- **Cache versioning:** The primary "rollback" mechanism is cache naming. If the new SW's precache fails, the browser keeps the old SW active.
- **Developer pattern:** Use multiple cache versions. The new SW's activate handler deletes old caches. If the new SW fails to install, old caches remain.
- **No version history:** The browser does not keep multiple SW versions accessible. Once replaced, the old SW script is gone.
- **Forced update + broken SW:** The user must clear site data (DevTools > Application > Service Workers > Unregister) to recover. This is the "stuck SW" problem.

### 6. Delta-Update Support

**No.** The SW script is fetched in full each time. There is no binary diffing. The browser downloads the complete .js file and compares bytes.

However, the *assets* served by the SW can be incrementally updated:
- Workbox precache only re-downloads assets whose revision changed
- Runtime caching uses strategies (stale-while-revalidate, etc.) that may avoid re-downloading unchanged assets
- But the SW script itself is always a full download

### 7. Stage-and-Promote (Canary / Percentage Headers)

**Not built-in.** No percentage gating, no canary system.

Workarounds:
- **Server-side:** Serve different SW script versions based on user cookie/percentage
- **skipWaiting + clients.claim:** Control activation timing per-client
- **Custom protocol:** Use a manifest endpoint that tells the client which SW version to register

**skipWaiting + clients.claim pitfalls:**
    self.addEventListener('install', () => {
      self.skipWaiting(); // New SW activates immediately
    });
    self.addEventListener('activate', (event) => {
      event.waitUntil(self.clients.claim()); // Take control of all clients NOW
    });

**Pitfall 1:** If skipWaiting is called but the new SW has a bug, ALL clients switch immediately. No gradual rollout.
**Pitfall 2:** clients.claim() takes control of already-open tabs. If the new SW's fetch handler has a bug, those tabs break immediately.
**Pitfall 3:** Without skipWaiting, the new SW waits until all tabs are closed. In a SPA with long sessions, this may be days.
**Pitfall 4:** Using both skipWaiting AND clients.claim means the user gets zero notice of the update. No "update available" prompt.

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| SW script fetch fails (network) | Old SW continues; retry on next navigation |
| SW script has syntax error | Registration fails; no SW active |
| install event rejects (waitUntil promise) | SW enters redundant; old SW continues |
| activate event rejects | SW enters redundant; old SW continues |
| importScripts() URL returns 404 | Install fails; SW redundant |
| importScripts() cache poisoning | Stale script served; SW may not detect update |
| Cache quota exceeded | caches.put() rejects; asset not cached |
| SW terminated by browser | Auto-restarts on next event; no data loss (stateless) |
| New SW activated but fetch handler broken | All requests fail until SW is unregistered |
| Service-Worker-Allowed header mismatch | Registration fails with SecurityError |
| Non-HTTPS context | Registration fails (except localhost) |

### 9. Reference

- **Spec:** W3C Service Workers 1 (CR Draft, 29 Oct 2026)
- **Spec URL:** https://www.w3.org/TR/service-workers-1/
- **Workbox docs:** https://developer.chrome.com/docs/workbox/
- **MDN lifecycle:** https://developer.chrome.com/docs/workbox/service-worker-lifecycle
- **Repo (Workbox):** https://github.com/GoogleChrome/workbox
- **Production apps:** All PWAs (e.g., Twitter/X web, Pinterest, Starbucks, Coinbase, Spotify web)
- **Known issues:**
  - No cryptographic signing of SW script (TLS only)
  - "Stuck SW" problem: broken SW requires manual unregister
  - skipWaiting + clients.claim can break all tabs simultaneously
  - importScripts cache poisoning is a known attack vector
  - No built-in percentage rollout or canary
  - 24h update check interval is not configurable (browser-controlled)
  - Cross-browser inconsistencies in SW lifecycle timing
  - iOS Safari historically had SW bugs (improved in recent versions)

---

## K. Microsoft App Installer (MSIX)

**Spec:** App Installer XML schema (XSD) | **Docs:** [learn.microsoft.com/windows/msix/app-installer/](https://learn.microsoft.com/en-us/windows/msix/app-installer/) + [App Installer file schema](https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root) | **Code:** Microsoft.WindowsAppRuntime / Windows App SDK AppUpdateManager

### 1. Manifest / Channel File Format - AppInstaller XML

The App Installer protocol uses an XML file (.appinstaller) that describes an MSIX package and its update policy.

**Full schema:**

    <?xml version="1.0" encoding="utf-8"?>
    <AppInstaller xsi:noNamespaceSchemaLocation="AppInstaller.xsd"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  Version="1.0">
      <MainPackage
        Name="MyCompany.MyApp"
        Version="1.2.3.0"
        Publisher="CN=MyCompany, O=MyCompany, L=City, S=State, C=US"
        Uri="https://releases.example.com/MyApp-1.2.3.0.msix" />

      <Dependencies>
        <Package
          Name="MyCompany.MyApp.Runtime"
          MinVersion="2.0.0.0"
          Uri="https://releases.example.com/MyApp.Runtime-2.0.0.0.msix" />
      </Dependencies>

      <UpdatePolicy
        IntervalInDays="1"
        MaxIntervalInDays="7"
        DisableUserNotification="false" />

      <UpdateSettings
        UpdateMode="autoPrompt"
        AutoUpdateLevel="majorAndMinor"
        BackgroundDownloadEnabled="true"
        ForceUpdateFromAnyVersion="false" />

      <InstallTrigger
        FilePattern="*.msix"
        FileLocation="https://releases.example.com/latest.msix" />

      <Resources>
        <Logo Uri="https://example.com/icon-44.png" />
        <Logo Uri="https://example.com/icon-150.png" Scale="2.0" />
      </Resources>

      <PhoneDesktopSettings
        DesktopOnly="false" />

      <InstallationSettings
        RequiredSystemCapability="internetClient"
        LogCollectionEnabled="true" />
    </AppInstaller>

**Complete element reference:**

| Element | Required | Description |
|---|---|---|
| Version | YES | Schema version (currently "1.0") |
| MainPackage | YES | The primary MSIX package to install/update |
| MainPackage.Name | YES | Package family name |
| MainPackage.Version | YES | Minimum version to install (semver 4-part) |
| MainPackage.Publisher | YES | Certificate thumbprint or CN |
| MainPackage.Uri | YES | URL to the .msix/.msixbundle file |
| Dependencies | no | Other packages required |
| Dependencies.Package.Name | yes (if present) | Dependency package family name |
| Dependencies.Package.MinVersion | yes (if present) | Minimum dependency version |
| Dependencies.Package.Uri | yes (if present) | URL to dependency package |
| UpdatePolicy | no | How often to check for updates |
| UpdatePolicy.IntervalInDays | no | Check interval (default: 1) |
| UpdatePolicy.MaxIntervalInDays | no | Max backoff interval |
| UpdatePolicy.DisableUserNotification | no | Suppress update notifications |
| UpdateSettings | no | Update behavior configuration |
| UpdateSettings.UpdateMode | no | autoPrompt (default), auto, manual |
| UpdateSettings.AutoUpdateLevel | no | majorAndMinor (default), minor, major |
| UpdateSettings.BackgroundDownloadEnabled | no | Download in background (default: true) |
| UpdateSettings.ForceUpdateFromAnyVersion | no | Allow downgrade (default: false) |
| InstallTrigger | no | Protocol handler trigger |
| Resources | no | Icons/metadata for notification UI |
| Resources.Logo | no | URI to logo image |
| Resources.Logo.Scale | no | DPI scale (1.0, 1.5, 2.0) |
| PhoneDesktopSettings | no | Phone vs desktop behavior |
| InstallationSettings | no | Additional install requirements |

**Partial manifests:** App Installer supports "partial" .appinstaller files that reference a full manifest by URI, allowing CDN-cached small files to point to large package files.

### 2. Signing Model

| Aspect | Detail |
|---|---|
| What is signed | The .msix/.msixbundle package (Authenticode) |
| What is NOT signed | The .appinstaller XML file itself |
| Algorithm | Authenticode (SHA-256) for the package |
| Package signature | X.509 certificate (developer or enterprise) |
| App Installer protocol | HTTPS required for remote manifests |
| Verification | Windows Package Manager verifies Authenticode signature on install |
| App Installer XML | NOT cryptographically signed - integrity via HTTPS |

**Key distinction:** The .msix package is strongly signed (Authenticode). The .appinstaller manifest is NOT signed - it is a "pointer" file. An attacker who can modify the .appinstaller (via CDN compromise) can redirect the update to a malicious .msix URL. However, the malicious .msix would still need a valid Authenticode signature matching the Publisher field.

### 3. Cache / Staging Layout

    C:\ProgramData\Microsoft\Windows\Installer\        <- Windows Installer cache
    C:\Program Files\WindowsApps\<PackageFamilyName>_<Version>_<Arch>_<PublisherID>\
                                                          <- installed package
    C:\Users\<user>\AppData\Local\Packages\<PackageFamilyName>\
                                                          <- per-user data
    C:\Windows\Installer\$\<PackageFamilyName>\
                                                          <- update staging (partial downloads)

- Windows Package Manager (Clipcab service) manages the download
- Partial downloads are stored in $ and resumed on retry
- Old package versions are kept for rollback (configurable via deployment policies)
- Per-user virtualized filesystem (WinSandbox) isolates app data

### 4. Update Triggers

| Trigger | Mechanism |
|---|---|
| Periodic | Clipcab service checks per UpdatePolicy.IntervalInDays (default: 1 day) |
| On startup | App can call AppUpdateManager.RequestUpdateAsync() (Windows App SDK) |
| Manual | User clicks "Update" in Settings > Apps, or app triggers |
| Protocol handler | ms-appinstaller:// URI scheme triggers update check |
| On resume | Not a standard trigger |
| Store apps | Microsoft Store handles its own update cycle |

**AppUpdateManager (Windows App SDK):**

    using Windows.ApplicationModel;
    var app = CurrentApp.GetCurrent();
    if (app.UpdateStatus == AppUpdateStatus.ReadyToInstall)
    {
        await app.RequestUpdateAsync();
    }

### 5. Rollback Story

- **Windows Package Manager:** Keeps previous version installed. If the new version fails to launch (detected via app lifecycle), Windows can roll back.
- **Deployment policies:** Enterprise can configure AllowAutomaticUpdateRollback via Group Policy.
- **User-level:** Settings > Apps > Advanced options > Uninstall (reverts to previous if available).
- **MSIX for Business:** IT admins can pin versions via deployment manifest.
- **Limitation:** Rollback is not guaranteed. If the old version's files are deleted (storage optimization), rollback is impossible.

### 6. Delta-Update Support

**No traditional delta updates.** However:

- **MSIX bundling:** .msixbundle can contain architecture-specific .msix files, avoiding re-download of unchanged arch slices
- **Windows Update delivery optimization:** Peers can share package content (similar to BitTorrent)
- **App Installer BackgroundDownload:** Downloads in background, resumes on network change
- **No binary diffing:** Each update is a full .msix download (or resumed partial download)

### 7. Stage-and-Promote

**External / OS-level:**

- **Microsoft Store:** Built-in staged rollout (percentage-based, ring-based: Insider > Beta > Public)
- **MSIX for Business (enterprise):** IT admin controls deployment via Intune/SCCM
- **App Installer XML:** No built-in percentage field. The server serving the .appinstaller can implement A/B testing by serving different Version values to different clients.
- **Windows Update for Business:** Ring-based deployment (0-100% in rings)

### 8. Failure Modes

| Failure | Behavior |
|---|---|
| Partial download | Resumed from $ on next check |
| Authenticode signature mismatch | Install rejected; error in Settings |
| .appinstaller unreachable | Retry on next interval (1 day default) |
| Downgrade attempt | Rejected unless ForceUpdateFromAnyVersion="true" |
| Insufficient storage | Install fails; user notified |
| Dependency version mismatch | Install fails with specific error |
| Package in use (file lock) | Update deferred until app closes |
| Corrupt existing install | Repair option in Settings; or full reinstall |
| App crashes after update | Windows may auto-rollback (policy-dependent) |
| Certificate expired/revoked | Install rejected |

### 9. Reference

- **Spec:** App Installer XML Schema v1.0
- **Schema docs:** https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root
- **App Installer overview:** https://learn.microsoft.com/en-us/windows/msix/app-installer/
- **AppUpdateManager API:** https://learn.microsoft.com/en-us/windows/apps/api/
- **Repo (Windows App SDK):** https://github.com/microsoft/windowsappsdk
- **Production apps:** All MSIX-packaged Windows apps (e.g., Visual Studio, .NET apps using Windows App SDK, enterprise line-of-business apps)
- **Known issues:**
  - .appinstaller XML is NOT signed (only the .msix is)
  - No built-in percentage rollout in the XML schema
  - AppUpdateManager requires Windows App SDK (not available on all Windows versions)
  - Rollback is policy-dependent and not guaranteed
  - Per-user install vs machine-wide install confusion
  - Store apps have different update semantics than sideloaded MSIX
  - App Installer service (Clipcab) must be running; disabling it breaks updates
  - No delta updates (full .msix download each time)

---

## Comparative Summary

| Protocol | Manifest Format | Signing | Delta | Canary | Rollback | Platform |
|---|---|---|---|---|---|---|
| Squirrel.Windows | RELEASES (plain text) | SHA-1 (no crypto sig) | msdelta.dll | Built-in (# N%) | None | Windows |
| Squirrel.Mac | Server JSON / static JSON | SHA-256 + code sig | bsdiff (Sparkle) | External (server) | Server-driven | macOS |
| Sparkle | Appcast XML (RSS) | Ed25519 (EdDSA) | bsdiff | Built-in (7 groups) | None | macOS |
| WinSparkle | Appcast XML (RSS) | Ed25519 (EdDSA) | None | Built-in (7 groups) | None (installer-dep) | Windows |
| Electron autoUpdater | Platform-delegated | Platform-delegated | Platform-delegated | Platform-delegated | Platform-delegated | Win+Mac |
| Tauri updater | JSON (static/dynamic) | minisign (Ed25519) | None | External (server) | None (downgrade opt-in) | Win+Mac+Linux |
| Capacitor Live Update | Server JSON (CapGo) | SHA-256 + optional AES | None | Built-in (CapGo) | Server + embedded fallback | iOS+Android |
| Expo Updates | JSON (protocol v1) | RSA (configurable) | bsdiff (optional) | Built-in (EAS) | Server + emergency launch | iOS+Android |
| CodePush (dead) | REST API + labels | SHA-256 | Binary diff | Built-in (server) | Server + local fallback | RN (iOS+Android) |
| PWA Service Worker | JS file (byte compare) | None (TLS only) | None | None | Cache versioning only | All browsers |
| MSIX App Installer | XML (.appinstaller) | Authenticode (SHA-256) | None (full .msix) | External (Store/Intune) | OS-level (policy) | Windows |

