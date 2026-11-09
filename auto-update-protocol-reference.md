# AIRIZ Motor Console - Cross-Platform Auto-Update Protocol Reference

Scope: wire format, signing model, channel/rollout model, and host-side requirements for every
notable auto-update tool, to decide between (a) electron-updater + Capacitor live update,
(b) Tauri one-updater, (c) a single signed-manifest layer on R2 / S3 / GitHub Releases.

Method: authoritative repos cloned (depth 1) and source-read; official specs/docs fetched.
Verified 2026-11-05. Context7 and Exa were unavailable this session (quota/rate limit);
SearxNG server returned empty results; everything below is from cloned source or fetched docs.

Verification legend:
  [SRC]  = read directly from a cloned source repo at the pinned commit below
  [SPEC] = read from the official protocol/spec document (URL + version + date)
  [DOC]  = read from official docs page (fetched this session)
  [KNOW] = established, well-known protocol detail; canonical URL cited, NOT fetched live this
           session - treat element names as high-confidence but re-verify before shipping

Pinned commits used for [SRC]:
  develar/electron-builder   master   cdd9f7ec77007cdc9657b9f9faa0be2000564d59
  sparkle-project/Sparkle    2.x      14fdbf28dc7c6fd8741a144bff517ef86572e6c2
  vslavik/winsparkle         master   0828b4fda11230907b65c48902ab6b3a2681a7ca
  Squirrel/Squirrel.Windows  develop  51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f
  tauri-apps/tauri           dev      c51f047e919e2659c822ccd0320919907b0e0c6c
  hotcodepush-team/capacitor-live-updates main 11688ae3241a4ebb4e03f757de6ef0769774614e


================================================================================
1. electron-updater (electron-builder) - Windows/macOS/Linux [Electron]
================================================================================

1.1 Wire format [SRC develar/electron-builder master cdd9f7e]
    One manifest per platform, served as a flat file next to the installers:
      Windows -> latest.yml      macOS -> latest-mac.yml      Linux -> latest-linux.yml
    (named after the "channel": beta.yml, nightly.yml for non-stable channels)

    Authoritative TS type (packages/builder-util-runtime/src/updateInfo.ts):

      UpdateInfo = {
        version: string                 // semver
        files: UpdateFileInfo[]         // modern clients read this array
        releaseName?: string | null
        releaseNotes?: string | ReleaseNoteInfo[] | null
        releaseDate: string             // ISO-8601
        stagingPercentage?: number      // 0-100, staged rollout
        minimumSystemVersion?: string   // e.g. macOS "23.1.0", Windows "10.0.22631"
        signature?: string              // Ed25519 (first key), base64
        signatures?: UpdateManifestSignature[]  // multi-key, for rotation
        // LEGACY (only emitted when electronUpdaterCompatibility includes legacy clients):
        path?: string                   // old single-file descriptor
        sha512?: string                 // old top-level checksum
      }
      UpdateFileInfo = {
        url: string                     // relative to feed or absolute
        sha512: string                  // base64 SHA-512 of the artifact
        size?: number                   // bytes (saves a HEAD request)
        blockMapSize?: number
        blockMapUrl?: string            // optional separately-signed blockmap URL
        isAdminRightsRequired?: boolean
      }
      UpdateManifestSignature = { keyId: string; signature: string }
        // keyId    = lowercase hex SHA-256 of the SPKI DER of the signing key
        // signature= base64 Ed25519 signature over the canonical manifest payload
      WindowsUpdateInfo (Windows only) adds:
        packages?: { [arch: string]: { path; sha512; size?; isAdminRightsRequired? } }
        allowCatalogSignature?: boolean // accept a valid security-catalog Authenticode sig
        sha2?: string                   // deprecated legacy

    Realistic latest.yml (Windows):

      version: 1.2.3
      files:
        - url: AIRIZ-Setup-1.2.3.exe
          sha512: Q3...base64...==
          size: 98765432
          blockMapSize: 1204
          isAdminRightsRequired: true
      path: AIRIZ-Setup-1.2.3.exe          # legacy mirror (compat)
      sha512: Q3...base64...==
      releaseDate: '2026-11-05T09:00:00.000Z'
      releaseName: v1.2.3
      releaseNotes: 'Fix motor calibration drift'
      stagingPercentage: 100
      minimumSystemVersion: 10.0.19045
      signature: MEUCIQ...Ed25519...
      signatures:
        - keyId: 9f2c... (hex sha256 of SPKI DER)
          signature: MEUCIQ...Ed25519...

    Blockmap (delta): a sibling latest.blockmap (per installer) enables
    binary block-level delta transfer for NSIS/MSI/AppImage. Not part of the .yml.

1.2 Signing [SRC]
    TWO independent layers:
    (a) MANIFEST signature (current mechanism in this source): Ed25519 over the
        canonicalized manifest fields (see canonicalizeForSigning / verifyManifestSignatures
        / computeUpdateManifestKeyId in AppUpdater.ts). Public key supplied via
        updateManifestPublicKey (PEM or base64 SPKI). When at least one trusted key is
        configured, verification is ENFORCED - no download starts until it passes.
        Multi-key: signature = first key; signatures[] carries every key tagged by keyId,
        so rotation is "any trusted key matches any entry".
        NOTE: historically this signature field was a minisign signature; the current
        master source implements Ed25519 canonical manifest signing. Treat minisign as the
        legacy form for very old clients.
    (b) INSTALLER Authenticode: the .exe/.msi/.app itself is Authenticode-signed with an
        (ideally EV) code-signing certificate, verified by electron-updater and by Windows.
        allowCatalogSignature lets a valid Windows security-catalog signature pass.

1.3 Channels / rollout [SRC + DOC electron.build]
    - Channel = a named feed file: latest / beta / nightly -> latest.yml, beta.yml, nightly.yml.
      Client sets autoUpdater.channel (or the build "channel") to pick one.
    - Staged rollout: stagingPercentage (0-100) in the manifest; the client buckets
      installs deterministically and only sees the update when in-bucket.

1.4 Minimum backend [SRC]
    - Any static HTTPS host that serves latest.yml + the installers + *.blockmap.
    - Provider abstraction (packages/app-builder-lib, publish/*): generic server,
      GitHub (GitHubProvider.ts), GitLab, S3, Azure, Google Drive, Spaces, (Bintray legacy).
      GitHub Releases works out of the box (provider maps release assets to the feed).
      S3/GCS/Azure can use presigned URLs (blockMapUrl supports a separate presigned URL).

1.5 Maturity / 2026 status
    Production-ready, actively maintained (Electron 33/34/35 era). Ed25519 manifest
    signing + multi-key rotation is the newest (2025/26) hardening. The desktop workhorse.

Sources:
  [SRC] https://github.com/develar/electron-builder/blob/cdd9f7ec77007cdc9657b9f9faa0be2000564d59/packages/builder-util-runtime/src/updateInfo.ts
  [SRC] https://github.com/develar/electron-builder/blob/cdd9f7ec77007cdc9657b9f9faa0be2000564d59/packages/electron-updater/src/AppUpdater.ts
  [DOC] https://www.electron.build/auto-update/  (configuration/auto-update + staged-rollouts)


================================================================================
2. Squirrel.Windows - Windows desktop (legacy, non-Electron)
================================================================================

2.1 Wire format [SRC Squirrel/Squirrel.Windows develop 51f5e2c]
    A plain-text file named RELEASES. One line per published version, ordered by
    version ascending, and within a version the full package precedes its delta
    (OrderBy(Version).ThenByDescending(IsDelta)).
    Line grammar (ReleaseEntry.entryRegex):  ^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$
      <40-hex-SHA1> <filename-or-absolute-URL> <size-bytes> [ # 0-100% ]
    - Token 1: SHA-1 of the .nupkg, 40 chars LOWER/UPPER HEX (NOT base64).
      Verified: Contract.Requires(sha1.Length == 40); Utility.CalculateStreamSHA1.
    - Token 2: either a bare "x.y.z.nupkg" name OR a full http(s) URL (then base URL
      and query are split off). Bare names are resolved against the RELEASES base URL.
    - Token 3: file size in bytes.
    - Optional comment / staging: a trailing " # NN%" sets that entry's staging %.
    Delta packages are named *<something>-delta.nupkg (filenameIsDeltaFile).

    Example RELEASES:
      d34db33f...40hex...  1.0.0.nupkg  51234567
      9f86d081...40hex...  1.0.1.nupkg  51300112
      1a2b3c4d...40hex...  1.0.1-delta.nupkg  812345
      0badc0de...40hex...  1.1.0.nupkg  52000000  # 25%

    Each .nupkg is a NuGet zip. Squirrel reads the embedded .nuspec:
      - releaseNotes : REQUIRED (GetReleaseNotes throws if empty/whitespace)
      - icon         : read for the update UI (GetIconUrl)
      - id/version   : standard NuGet identity (semantic version drives ordering)

2.2 Delta vs full [SRC]
    BinaryPatchUtility + DeltaPackage implement bsdiff-style per-file deltas.
    GetPreviousRelease picks the newest non-delta release below the target; a chain of
    -delta.nupkg files can fast-forward multiple versions. On apply, Squirrel tries the
    delta and falls back to the full nupkg if it fails; it re-verifies SHA1 of the result.

2.3 Update.exe flow [SRC UpdateManager.*]
    Update.exe (small Authenticode-signed stub) -> UpdateManager.UpdateApp:
      CheckForUpdates  : GET RELEASES -> ParseReleaseFile -> semantic-version compare ->
                         staging filter (ParseReleaseFileAndApplyStaging, IsStagingMatch)
      DownloadReleases : GET each .nupkg -> verify size == Filesize AND SHA1 == entry.SHA1
      ApplyReleases    : extract to app-<version> dir, apply deltas, write .squirreltmp,
                         refresh shortcuts/AppUserModelId, relaunch new exe, kill old.
    Staging match (IsStagingMatch): last 4 bytes of the per-user token GUID -> uint32;
    (val / UInt32.MaxValue) < percentage  =>  deterministic, serverless bucketing.

2.4 Signing model [SRC]
    - The RELEASES file itself is NOT signed. Integrity = SHA-1 per .nupkg (weak: SHA-1,
      and only integrity, not authenticity - an attacker who can rewrite RELEASES can point
      to a malicious nupkg and supply its matching SHA-1).
    - Authenticode is expected on Update.exe and on the app binaries INSIDE the nupkg, but
      Squirrel does NOT verify Authenticode of the payload by default.
    - There is NO ed25519/minisign manifest signature and NO per-file signature.
    MFA / SmartScreen: not a protocol feature. SmartScreen is a Windows reputation gate that
    consults the Authenticode publisher + download reputation; an EV certificate lowers
    "unknown publisher" friction. No field in RELEASES affects it.

2.5 Channels
    None in the file. "Channels" are done by hosting separate RELEASES files / hosts per
    channel. Per-line " # NN%" gives coarse staged rollout only.

2.6 Backend
    Any static HTTPS (S3, Azure Blob, GitHub Pages, raw.githubusercontent). Serve RELEASES
    + the .nupkg set. No API required.

2.7 Maturity / 2026 status
    Legacy / effectively frozen (last substantive activity ~2021). Still works, but the
    SHA-1 + unsigned-RELEASES trust model is considered weak by modern standards.
    Superseded on Windows by MSIX + App Installer and, for Electron, by electron-updater.

Sources:
  [SRC] https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs
  [SRC] .../src/Squirrel/UpdateManager.DownloadReleases.cs , UpdateManager.ApplyReleases.cs , BinaryPatchUtility.cs , DeltaPackage.cs


================================================================================
3. Squirrel.Mac - macOS (historical; renamed to Sparkle)
================================================================================

3.1 Identity
    Squirrel.Mac (2012-2014, by Andy Matuschak) was renamed/absorbed into **Sparkle**.
    So "Squirrel.Mac" and "Sparkle" are the same lineage; the modern protocol is Sparkle's.
    This section only records the historical delta; full current detail is in section 4.

3.2 Historical wire [KNOW]
    - Appcast = RSS 2.0 with xmlns:sparkle (same namespace Sparkle still uses today:
      http://www.andymatuschak.org/xml-namespaces/sparkle).
    - Signature: DSA only (sparkle:dsaSignature, base64), public key via SUPublicDSAKey
      (a "BEGIN PGP PUBLIC KEY BLOCK" DSA key) in Info.plist. No ed25519.
    - Enclosure: url, length, type, sparkle:version, sparkle:shortVersionString,
      sparkle:dsaSignature. No channels, no phased rollout, no binary deltas (deltas came
      later in Sparkle 1.x/2.x).

3.3 Status
    DEPRECATED / renamed. Use Sparkle 2.x (ed25519). Migrating away from DSA is documented
    by Sparkle (eddsa-migration). 2026: do not target Squirrel.Mac.

Sources:
  [KNOW] https://sparkle-project.org/documentation/ (Squirrel.Mac history)
  [DOC]  https://sparkle-project.org/documentation/eddsa-migration/ (DSA -> EdDSA)


================================================================================
4. Sparkle 2.x (macOS) - incl. 2.6+ EdDSA/ed25519
================================================================================

4.1 Wire format (appcast) [DOC sparkle-project.org/documentation, verified 2026-11-05]
    An appcast is RSS 2.0 extended with the Sparkle namespace:
      <rss version="2.0"
           xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
        <channel><title>App Changelog</title>
          <item> ...one item per released version, newest first... </item>
        </channel>
      </rss>

    Field-by-field (all in the Sparkle namespace unless noted):
      <title>                        human title
      <link>                         URL to visit when no/other update applies
      <pubDate>                      RFC-822 date; REQUIRED for phased rollout
      <sparkle:version>              machine version == CFBundleVersion (e.g. "1248" or "2.0")
      <sparkle:shortVersionString>   human version == CFBundleShortVersionString (e.g. "1.5.1")
      <sparkle:releaseNotesLink>     release notes URL (xml:lang per-locale supported)
      <sparkle:fullReleaseNotesLink> version-history URL
      <description>                  embedded notes; CDATA HTML, or sparkle:format="plain-text"
                                     (2.4+) / "markdown" (2.9+, macOS 12+)
      <enclosure>                    THE update artifact:
          url=                       dmg/zip/tar/aar/package URL
          length=                    byte size
          type=                      e.g. application/octet-stream
          sparkle:edSignature=       base64 EdDSA(ed25519) signature of the artifact
          sparkle:dsaSignature=      LEGACY base64 DSA signature (migrate away)
          sparkle:os=                optional cross-OS marker (not recommended; use separate feeds)
      <sparkle:deltas>               optional; each child <enclosure>:
          url=                       the .delta file
          length=
          sparkle:edSignature=       signature of the delta
          sparkle:deltaFrom=         version the delta patches FROM
          sparkle:deltaFromSparkleExecutableSize=  (2.3+) Sparkle exe size to pre-filter
          sparkle:deltaFromSparkleLocales=         (2.3+) comma list of .lproj to pre-filter
      <sparkle:minimumSystemVersion> e.g. "12.0.0" (major.minor.patch)
      <sparkle:maximumSystemVersion> e.g. "13.0.0"
      <sparkle:hardwareRequirements> "arm64" (2.9+) - require Apple silicon
      <sparkle:minimumAutoupdateVersion>  major-upgrade gate: lowest version that may auto-update
      <sparkle:ignoreSkippedUpgradesBelowVersion>  re-notify past a skipped major
      <sparkle:minimumUpdateVersion>  (2.9+) min bundle version required to see this update
      <sparkle:criticalUpdate>        force/no-skip; may carry sparkle:version="lastCritical"
      <sparkle:informationalUpdate>   link-only update; children specify which versions see it as
                                      informational (sparkle:belowVersion / sparkle:version)
      <sparkle:channel>               e.g. "beta"; default channel is implicit
      <sparkle:phasedRolloutInterval> seconds between rollout groups (7 hardcoded groups)
      Custom top-level elements allowed via your own xmlns (e.g. myapp:messageOfTheDay).

    Minimal full example (with delta):
      <item>
        <title>Version 2.0</title>
        <link>https://myapp.example</link>
        <sparkle:version>2.0</sparkle:version>
        <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
        <sparkle:releaseNotesLink xml:lang="en">https://myapp.example/notes/2.0.html</sparkle:releaseNotesLink>
        <description><![CDATA[<h2>New features</h2><p>...</p>]]></description>
        <pubDate>Wed, 09 Jan 2026 19:20:11 +0000</pubDate>
        <enclosure url="https://cdn.myapp.example/MyApp-2.0.zip"
                   length="1623481"
                   type="application/octet-stream"
                   sparkle:edSignature="7cLALFUH...base64...==" />
        <sparkle:deltas>
          <enclosure url="https://cdn.myapp.example/1.9-2.0.delta"
                     sparkle:deltaFrom="1.9"
                     length="1485"
                     type="application/octet-stream"
                     sparkle:edSignature="AbCdEf...base64...==" />
        </sparkle:deltas>
      </item>

4.2 Signing model [DOC]
    - EdDSA = ed25519. generate_keys stores the private key in the login Keychain and prints
      the base64 PUBLIC key to embed as SUPublicEDKey in Info.plist.
    - sign_update emits the sparkle:edSignature + length fragment for one artifact.
    - generate_appcast builds the appcast AND signs every enclosure + delta automatically
      (Keychain access required).
    - Legacy DSA: sparkle:dsaSignature; migrate off via eddsa-migration.
    - Signed feeds (2.9): SURequireSignedFeed + SUVerifyUpdateBeforeExtraction make Sparkle
      validate the appcast + release notes are signed too (prevents a compromised server
      redirecting users). SUSignedFeedFailureExpirationInterval is the fail-safe window.
    - Key rotation (2.x): for Developer-ID-signed apps, a new update can rotate the EdDSA key
      (or the Developer ID cert, not both) - no flag day.
    - Notarization interplay: sign with Developer ID + notarize; Hardened Runtime enables
      Library Validation, so Sparkle.framework must be "Embed & Sign"; avoid app
      translocation by shipping a zip/tar with only the .app inside.

4.3 Channels / rollout [DOC]
    - Channels: sparkle:channel; an updater opts into extra channels via the delegate
      allowedChannelsForUpdater: (it can never leave the default channel). Channels are for
      branching to a later default release, NOT parallel products.
    - Phased group rollout: sparkle:phasedRolloutInterval (seconds) + a pubDate; Sparkle
      hardcodes 7 groups and assigns each user a stable group via SUUpdateGroupIdentifier
      (random, local, not transmitted). No effect for critical updates or manual checks.

4.4 Backend
    Any static HTTPS host: appcast + artifact archives + .delta files. generate_appcast
    automates signing. No SaaS, no API, no database.

4.5 Delta format versions [DOC]
    4 = Sparkle 2.7 (preserves bundle creation date, more efficient hash verify)
    3 = Sparkle 2.1 (lzma + compression options, rename heuristics)
    2 = Sparkle 1.10 (improved hash to cut collisions)
    1 = Sparkle 1.5 (original bsdiff + bzip2/libxar)
    On any delta failure Sparkle falls back to the full update and re-verifies a checksum.

4.6 Maturity / 2026 status
    Production-ready, actively maintained (copyright footer 2006-2026; features landing in
    2.9: signed feeds, markdown notes, arm64 hardware requirements, min update version).
    The reference macOS updater.

Sources:
  [DOC] https://sparkle-project.org/documentation/  (basic setup, EdDSA, appcast)
  [DOC] https://sparkle-project.org/documentation/publishing/  (item fields, channels, phased)
  [DOC] https://sparkle-project.org/documentation/delta-updates/
  [DOC] https://sparkle-project.org/documentation/customization/  (SU* Info.plist keys)
  [SRC] https://github.com/sparkle-project/Sparkle (2.x @ 14fdbf2)


================================================================================
5. WinSparkle - Windows (Win32/Qt/etc.), Sparkle-clone
================================================================================

5.1 Wire format (WinSparkle.appcast) [SRC vslavik/winsparkle master 0828b4f]
    WinSparkle parses the SAME Sparkle RSS namespace (hardcoded in appcast.cpp):
      NS_SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
    So a WinSparkle appcast is structurally a Sparkle appcast restricted to what WinSparkle
    implements. Parsed elements (src/appcast.cpp):
      <channel> <item>
      <title> <description> <link>
      <sparkle:releaseNotesLink>
      <sparkle:version>        (item OR legacy enclosure attr)
      <sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>   Windows build gate, see 5.3
      <sparkle:criticalUpdate>
      <enclosure
          url=
          length=
          sparkle:edSignature=      EdDSA(ed25519) of the file   (current)
          sparkle:dsaSignature=     LEGACY DSA of the file
          sparkle:os=               arch selection: "windows" | "windows-x64" |
                                    "windows-x86" | "windows-arm64"
          sparkle:installerArguments=  extra args passed to the installer (e.g. NSIS)
      >
    Multiple <enclosure> per item are allowed; find_best_enclosure_for_os_arch picks the
    arch-specific one, else a generic "windows" one, else the first compatible. Items whose
    enclosures are all incompatible are skipped (so one feed can carry many OS/arch targets).

    Example (Windows x64 NSIS):
      <item>
        <title>Version 1.4.0</title>
        <link>https://myapp.example</link>
        <sparkle:version>1.4.0</sparkle:version>
        <sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>
        <sparkle:releaseNotesLink>https://myapp.example/notes/1.4.0.html</sparkle:releaseNotesLink>
        <sparkle:minimumSystemVersion>10.0.19041</sparkle:minimumSystemVersion>
        <sparkle:criticalUpdate></sparkle:criticalUpdate>
        <pubDate>Mon, 05 Nov 2026 09:00:00 +0000</pubDate>
        <enclosure url="https://cdn.myapp.example/myapp-1.4.0-setup.exe"
                   length="98765432"
                   type="application/octet-stream"
                   sparkle:os="windows-x64"
                   sparkle:edSignature="MEUCIQ...base64...=="
                   sparkle:installerArguments="/S" />
      </item>

5.2 WINSPARKLE_USE_EXPERIMENTAL_TAG [KNOW]
    This is a BUILD-TIME (preprocessor/CMake) opt-in flag, NOT an appcast field. Defining it
    enables experimental updater features at compile time. It changes no wire format.
    (Confirm the exact feature set it gates against the tag's header before relying on it.)

5.3 Version / arch gating [SRC]
    is_compatible_with_windows_version parses sparkle:minimumSystemVersion as
    major[.minor[.build]] (also legacy major.minor-servicepack, and major.minor-build for
    pre-0.8.2) and compares with VerifyVersionInfoW (>=). OS markers: windows / windows-x64
    / windows-x86 / windows-arm64 (selected by _WIN64 + _M_ARM64 at build time).

5.4 Providers [KNOW/DOC]
    WinSparkle fetches the appcast from a URL you give it. The "github-releases provider"
    (0.8.x+) is a convenience that assembles the appcast URL from a GitHub repo/release and
    can auto-derive the latest asset. It is still just: fetch appcast XML + fetch enclosure.
    Canonical: https://winsparkle.org

5.5 Signing / trust [SRC + DOC]
    - File signature: sparkle:edSignature (ed25519, EdDSA) verified by signatureverifier.cpp;
      legacy sparkle:dsaSignature still parsed for backward compat. Public key configured in
      the app (winsparkle_set_public_key / via API), same model as Sparkle.
    - EV code-signing: the installer .exe is Authenticode-signed; an EV cert lowers
      SmartScreen friction. Authenticode is orthogonal to the ed25519 file signature.

5.6 Backend
    Any static HTTPS: the appcast + installer exe(s) (+ optional deltas). No API.

5.7 Maturity / 2026 status
    Production, actively maintained (copyright 2009-2026, Vaclav Slavik; 0.8.x line). The
    go-to for non-Electron Windows desktop (Qt, wxWidgets, raw Win32, Flutter/Win32).

Sources:
  [SRC] https://github.com/vslavik/winsparkle/blob/0828b4fda11230907b65c48902ab6b3a2681a7ca/src/appcast.cpp
  [SRC] .../src/signatureverifier.cpp , src/updatechecker.cpp , src/updatedownloader.cpp
  [DOC] https://winsparkle.org


================================================================================
6. Microsoft App Installer (AppInstaller / MSIX) - Windows
================================================================================

Note: App Installer is an OS component (Windows 10 1809+) that lets a desktop app register a
"deployment" and have Windows check + silently install newer MSIX/MSIXBundle packages.
Distinct from WinGet (CLI manifests) and from the Microsoft Store.

6.1 Wire format (.appinstaller file) [KNOW - canonical URL cited; not fetched live this session]
    A .appinstaller is XML, namespace http://schemas.microsoft.com/appx/appinstaller/2015/.
    Two shapes are documented: a simple Product/Uri form and a Deployment form. Core elements:

      <?xml version="1.0" encoding="utf-8"?>
      <Package xmlns="http://schemas.microsoft.com/appx/appinstaller/2015/">
        <MainApp>AIRIZConsole.exe</MainApp>
        <UpdatePolicy CycleDays="2" VersionOverride="0.0.0.0" />
        <Uri Name="Default" Uri="https://cdn.myapp.example/updates/" />
        <Product Name="AIRIZ.MotorConsole"
                 PackageFamilyName="AIRIZ.MotorConsole_p5p...pubid"
                 DisplayName="AIRIZ Motor Console">
          <Uri Name="Default" Uri="https://cdn.myapp.example/updates/AIRIZ_1.2.3.0_x64.msix" />
          <Hash>
            <Resource Uri="https://cdn.myapp.example/updates/AIRIZ_1.2.3.0_x64.msix"
                      Algorithm="SHA256" Value="0123abc...base16/sha256..." />
          </Hash>
          <MainApp>AIRIZConsole.exe</MainApp>
        </Product>
      </Package>

    Field notes:
      MainApp          top-level or per-Product; the executable identity that triggers updates
      UpdatePolicy     CycleDays (check cadence), VersionOverride (pin a version), and for the
                       Deployment form: UpdateMode / UpdateSource / staged-deployment controls
      Uri              a named update source URL
      Product          identifies the package by PackageFamilyName (+ DisplayName)
      Hash/Resource    the SHA256 of the .msix/.msixbundle the client must verify before install
      (staged/Deployment form adds Deployment, UpdateSource, and per-target Uri entries used
       for enterprise staged rollout)

    Canonical reference: https://learn.microsoft.com/en-us/windows/package-manager/appinstaller
    (App Installer file reference). Re-verify exact element names for the Deployment/staged
    form against that page before shipping, as [KNOW] above.

6.2 MSIX update flow [KNOW]
    - App registers the AppInstaller file at runtime (or the user/MSX installer does). Windows
      stores the deployment and on each check downloads the new .msix/.msixbundle.
    - Verifies SHA256 (Hash/Resource) AND Authenticode of the MSIX (the .msix must be signed
      with the same publisher key as the registered package; for Store apps, the Store identity).
    - Stages via the Package Deployment service (silent Add-AppxPackage-style register). No
      app code re-implements install; the OS does it.

6.3 Auto / silent / force [KNOW]
    - Auto: UpdatePolicy CycleDays drives background checks; installs are silent by default.
    - Silent vs UI: deployment/UpdateMode controls whether a UI is shown; default is silent.
    - Force: VersionOverride + a newer Product with a higher version; enterprise staged
      deployment can force a target version/time. There is no in-band "mandatory" boolean like
      mobile updaters; enforcement is via version comparison + deployment policy.

6.4 Protocol handler [KNOW]
    - ms-appinstaller: URI scheme (e.g. ms-appinstaller://source?content_url=...&update=1)
      and the .appinstaller file association both register/update a deployment.

6.5 Microsoft Store engagement [KNOW]
    - If the app is a Store app, App Installer can route updates through the Store
      (ms-store) instead of the side channel. Side-channel (self-hosted MSIX) and Store are
      two different update sources for the same PackageFamilyName.

6.6 Backend
    Static HTTPS serving the .appinstaller + the .msix/.msixbundle. (Or Microsoft Store.)
    No custom API.

6.7 Maturity / 2026 status
    Production, OS-integrated, current. The modern recommended path for Windows desktop
    updates where MSIX is acceptable (per-machine or per-user, no store). ClickOnce is legacy
    (see section 14).

Sources:
  [KNOW] https://learn.microsoft.com/en-us/windows/package-manager/appinstaller
  [KNOW] https://learn.microsoft.com/en-us/windows/msix/package/  (MSIX/MSIXBundle, Authenticode)


================================================================================
7. Tauri 2.x updater (tauri-plugin-updater) - desktop [Rust core]
================================================================================

Note: in Tauri 2 the updater is a PLUG-IN (tauri-apps/plugins-workspace/plugins/updater),
crate tauri-plugin-updater, npm @tauri-apps/plugin-updater - NOT a core crate (hence absent
from crates/ in the main repo). Desktop-only in practice (win/linux/mac); android/ios are
listed but have no real updater path.

7.1 Wire format [DOC v2.tauri.app/plugin/updater, last updated 2025-11-28]
    TWO server modes.

    (A) Static JSON (e.g. latest.json on S3/GitHub Releases):
      {
        "version": "1.2.3",
        "notes": "notes",
        "pub_date": "2026-11-05T09:00:00Z",     // RFC 3339, optional
        "platforms": {
          "windows-x86_64": { "signature": "<base64 minisign>", "url": "https://.../app-setup.exe" },
          "darwin-aarch64": { "signature": "<base64 minisign>", "url": "https://.../app.app.tar.gz" },
          "linux-x86_64":   { "signature": "<base64 minisign>", "url": "https://.../app.AppImage" }
        }
      }
      platform key = OS-ARCH, OS in {linux,darwin,windows}, ARCH in {x86_64,aarch64,i686,armv7}.
      Required: version, platforms[target].url, platforms[target].signature.

    (B) Dynamic update server (single target per response):
        204 No Content  -> no update
        200 OK          ->
      {
        "version": "1.2.3",
        "pub_date": "2026-11-05T09:00:00Z",
        "url": "https://.../app-setup.exe",
        "signature": "<base64 minisign>",
        "notes": "notes"
      }
      Required: url, version, signature.

    Endpoint URL templating: {{current_version}}, {{target}}, {{arch}}.
      e.g. https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}
          https://github.com/user/repo/releases/latest/download/latest.json

7.2 Signing [DOC + SRC tauri dev c51f047 updater_signature.rs]
    - Algorithm: MINISIGN (an ed25519-based file signature). tauri signer generate -> .pub
      (base64 minisign public key box) + encrypted secret. Build with
      TAURI_SIGNING_PRIVATE_KEY (env, .env NOT supported) -> each artifact gets a .sig.
    - .sig = base64(minisign signature) with a trusted comment
      "timestamp:<unix>\tfile:<filename>" [+ "\tversion:<version>"]. The version binding is a
      2025 addition that ties the signed artifact to the release version to prevent
      manifest-downgrade pairing (see requireSignedVersion config).
    - bundle.pubkey in tauri.conf.json = the .pub content (not a path). Verified before install;
      cannot be disabled. Key rotation = set pubkey at runtime via builder (Rust).

7.3 Artifacts produced [DOC + SRC updater_bundle.rs]
    - createUpdaterArtifacts: true (v2) ->
        Windows: reuses myapp-setup.exe / myapp.msi + <file>.sig
        macOS:   myapp.app.tar.gz + .sig
        Linux:   myapp.AppImage + .sig
    - createUpdaterArtifacts: "v1Compatible" (legacy) ->
        Windows: myapp-setup.nsis.zip / myapp.msi.zip + .sig
        macOS:   myapp.app.tar.gz + .sig ; Linux: myapp.AppImage.tar.gz + .sig

7.4 Config (tauri.conf.json) [DOC]
      bundle.createUpdaterArtifacts : true | "v1Compatible"   (removed in v3; use true)
      plugins.updater.pubkey        : base64 minisign pubkey (required)
      plugins.updater.endpoints[]   : one or more check URLs
      plugins.updater.dangerousInsecureTransportProtocol : allow non-HTTPS (dangerous)
      plugins.updater.windows.installMode : "passive" (default) | "basicUi" | "quiet"

7.5 Rust API (the "Updater trait") [DOC]
    tauri_plugin_updater::{ UpdaterExt, UpdaterBuilder, Update }
      app.updater_builder()
         .endpoints(vec![url]) .pubkey(pk) .target("macos-universal")
         .version_comparator(|cur,up| up != cur)   // enable downgrades/rollback
         .header("Authorization","Bearer ..") .timeout(..) .proxy(..)
         .on_before_exit(|| {...})                  // Windows pre-exit hook
         .build()?.check().await -> Option<Update>
      update.download_and_install(|chunk, total|.., ||{})  -> install -> app.restart()
    JS: import { check } from '@tauri-apps/plugin-updater'; await check() -> update?.downloadAndInstall()
    Permissions: updater:default (allow-check/download/install/download-and-install).

7.6 Channels / rollback
    - Channels are done by pointing endpoints at a per-channel URL (no channel field in JSON).
    - Rollback/downgrade: version_comparator override (default is update > current).

7.7 Backend
    Static JSON on S3/R2/GitHub Releases (tauri-action generates latest.json) OR a dynamic
    REST server (204/200). TLS enforced in production.

7.8 Maturity / 2026 status
    Production (Tauri 2.x, plugin requires Rust 1.90+). One updater for Win/macOS/Linux
    desktop; does NOT cover Android/iOS/PWA/Worker.

Sources:
  [DOC] https://v2.tauri.app/plugin/updater/  (last updated 2025-11-28)
  [SRC] https://github.com/tauri-apps/tauri/blob/c51f047e919e2659c822ccd0320919907b0e0c6c/crates/tauri-cli/src/helpers/updater_signature.rs
  [SRC] .../crates/tauri-bundler/src/bundle/updater_bundle.rs
  [SRC] https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater


================================================================================
8. Capacitor Live Update - Cap Awesome / HotCodePush (current) + deprecated official
================================================================================

8.1 Current (2026): HotCodePush  [SRC hotcodepush-team/capacitor-live-updates main 11688ae]
    - Package @hotcodepush/capacitor-live-updates; the rebrand of Cap Go's
      @capgo/capacitor-live-updates. It is a HOSTED SAAS (hotcodepush.com).
    - Requires Capacitor 7/8, iOS 15+. Native cores: HotCodePushCore (iOS),
      com.hotcodepush:core-android (Android).
    - Every native build writes hotcodepush.json into the app; an Xcode archive / Gradle
      release build registers the store build in the HotCodePush cloud (needs a token).
    - JS API (src/definitions.ts, src/index.ts):
        HotCodePush.sync() -> { status, release:{number,...}, applyStrategy, ... }
        checkStrategy: "auto" (start+resume+foreground) | "manual"
        downloadStrategy / applyStrategy: "auto" | "manual"
        downloadUpdate() / applyUpdate() for manual control
    - Delta transport: bspatch (binary delta) + bzip2 (see THIRD-PARTY-NOTICES of the cores).
    - The UPDATE MANIFEST is SERVER-SIDE (HotCodePush API) - it is a closed SaaS protocol,
      not a public static schema you host yourself. Channels, rollouts, and release gating
      live in their dashboard/SDK, not in a file you publish.
    - Web vs native mapping: the live update replaces the WEB/JS layer (the Capacitor web
      assets) - native plugins cannot change.

8.2 Deprecated official @capacitor/live-updates [KNOW - deprecated spec]
    The original official Capacitor Live Updates (now deprecated/archived in favor of the
    Cap Awesome/HotCodePush plugin) used a small public JSON manifest you hosted yourself:
      {
        "version": 12,
        "hash": "<sha256 of bundle.zip>",
        "assets": { "js/app.js": "https://cdn/app.js", "index.html": "https://cdn/index.html" },
        "target": { "ios": "12.0.0", "android": "31" },
        "mandatory": true,
        "channel": "prod",
        "rollout": 100,
        "notes": "notes"
      }
    - bundle = bundle.zip (the web assets); assets maps local web paths -> CDN URLs.
    - channel + rollout (%) gave named channels + percentage rollout; mandatory forced install.
    - Integrity: single hash of the bundle.zip (no per-file signing).
    Status: DEPRECATED/abandoned (migrate to Cap Awesome/HotCodePush). Re-verify exact field
    names against the archived capacitor live-updates source before relying on [KNOW] above.

8.3 Backend
    - Current: HotCodePush SaaS (their cloud). No self-hosted manifest.
    - Deprecated: any static host serving the JSON manifest + bundle.zip (+ asset files).

8.4 Maturity / 2026 status
    HotCodePush: production SaaS. Official @capacitor/live-updates: abandoned.

Sources:
  [SRC] https://github.com/hotcodepush-team/capacitor-live-updates (main @ 11688ae) : README.md, src/definitions.ts, src/index.ts
  [KNOW] archived @capacitor/live-updates spec (deprecated)


================================================================================
9. CodePush / App Center (DEPRECATED 2025)
================================================================================

9.1 Status [DOC microsoft/react-native-code-push README, verified 2026-11-05]
    "Visual Studio App Center was retired on March 31, 2025 ... CodePush ... was also retired
    on March 31, 2025. Consequently, we are archiving this repository."
    - Hard cutoff: 2025-03-31. Both microsoft/react-native-code-push and microsoft/code-push
      (and code-push-server) are ARCHIVED.
    - Also will not support React Native New Architecture (RN 0.76+ requires opting out).
    - Migration path (per Expo): https://docs.expo.dev/eas-update/codepush.md -> Expo Update
      or Cap Awesome/HotCodePush.

9.2 Wire format (historical protocol) [KNOW]
    The CodePush service served a small JSON manifest per deployment; the client downloaded a
    bundle.zip of the JS + assets and applied it on next launch. Native code could NOT change.
      {
        "label": "12",
        "packageHash": "<hash of bundle.zip>",
        "description": "fix",
        "appVersion": "1.0.0",     // gate: only native builds with this appVersion (or "*")
        "mandatory": false,
        "updateRawFile": true,
        "releaseNotes": "notes",
        "assetUrls": { "images/logo.png": "https://cdn/.../logo.png" },
        "isDev": false,
        "rollout": 100
      }
    - appVersion is the load-bearing native-compat gate (like Expo runtimeVersion).
    - assetUrls maps asset keys -> URLs (like Expo/Capacitor asset maps).
    - rollout (%) for staged delivery; mandatory forces.
    - Delta: CodePush supported binary diffs of the bundle (updateRawFile / diff), keyed by
      packageHash; client fell back to full bundle.zip.

9.3 Backend
    App Center SaaS (DEAD) or self-hosted code-push-server (ARCHIVED).

9.4 Maturity / 2026 status
    DEPRECATED + ABANDONED, cutoff 2025-03-31. Do not adopt.

Sources:
  [DOC] https://github.com/microsoft/react-native-code-push (archived README; retire notice 2025-03-31)
  [DOC] https://docs.expo.dev/eas-update/codepush.md  (migration from CodePush)


================================================================================
10. Expo Updates (EAS Update) - React Native / Expo
================================================================================

10.1 Wire format - Expo Updates Protocol v1  [SPEC docs.expo.dev/technical-specs/expo-updates-1, modified 2026-08-12]
    An update = a manifest + the assets it references. A directive = a server->client command.

    CLIENT REQUEST (GET):
      expo-protocol-version: 1
      expo-platform: ios | android          (else server SHOULD 400/404)
      expo-runtime-version: <string>        (native-code compat gate, set at build)
      accept: application/expo+json, application/json, multipart/mixed
      expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"   (if code signing on)
      <any previously stored expo-server-defined-headers>

    RESPONSE HEADERS (common):
      expo-protocol-version: 1
      expo-sfv-version: 0
      expo-manifest-filters:  <Expo SFV dict>   # client-side update filter on manifest.metadata
      expo-server-defined-headers: <Expo SFV dict>  # headers the client MUST store + replay
      cache-control: private, max-age=0           # recommended; avoids stale manifests
      content-type: application/expo+json | application/json | multipart/mixed
      expo-signature: sig, keyid=.., alg=..       # only if expo-expect-signature was sent

    RESPONSE BODY - Manifest (TS type, normative):
      type Manifest = {
        id: string;                 // UUID, unique
        createdAt: string;          // ISO 8601; server returns most recent satisfying filters
        runtimeVersion: string;     // native-code compat this update requires
        launchAsset: Asset;         // entry point (fileExtension ignored/omitted)
        assets: Asset[];            // JS, images, fonts, ...
        metadata: { [k:string]: string };  // must pass expo-manifest-filters (channel etc.)
        extra:   { [k:string]: any   };    // e.g. { "eas": { "projectId": "..." } }
      };
      type Asset = {
        hash?: string;              // base64url SHA-256 (RFC 4648 s5) - integrity
        key: string;                // reference key from app code (bundler-generated)
        contentType: string;        // MIME (RFC 2045), e.g. application/javascript
        fileExtension?: string;     // ".js"; iOS requires extensions
        url: string;                // fetch URL
      };

    EXTENSIONS BODY (multipart part name="extensions"):
      type Extensions = { assetRequestHeaders: { [assetKey]: { [header]: string } } };

    DIRECTIVE BODY (multipart part name="directive"):
      type Directive = { type: string; parameters?: {..}; extra?: {..} };
      // Expo uses "rollBackToEmbedded" to force the embedded update.

    ASSET REQUEST/RESPONSE:
      GET asset.url ; client MUST verify base64url SHA-256 == asset.hash.
      asset SHOULD be immutable: cache-control: public, max-age=31536000, immutable
      supports gzip + brotli (accept-encoding).

    Multipart response = up to 3 parts (manifest / extensions / directive); zero parts = no-op
    (204). Single JSON response cannot carry directives (406 if that's all that's available).

10.2 Signing [SPEC]
    - Code signing of the manifest (and directive) bodies via the expo-signature SFV header.
      Signing the manifest transitively covers assets (their hashes are in the manifest and
      verified). Client MUST verify the signing cert is a trusted root or in a chain to a
      trusted root, and the ROOT CERT MUST be embedded in the app/OS.
    - Config: updates.codeSigningCertificate + updates.codeSigningMetadata (app config).
    - Algorithm example in the spec: "rsa-v1_5-sha256" (RSA-based, NOT ed25519).

10.3 Channels / rollout / runtime version  [DOC docs.expo.dev/eas-update]
    - runtimeVersion (REQUIRED): the native-compat key. Policies: appVersion (use "version"),
      nativeVersion ("version"(buildNumber|versionCode)), fingerprint (hash of native code via
      @expo/fingerprint - most robust).
    - Branch + Channel: an update is published to a BRANCH (e.g. production, staging); a build
      is bound to a CHANNEL; a channel points at a branch. Channel is enforced via
      manifest.metadata + the expo-manifest-filters header (client-side).
    - Rollouts: percentage per branch (gradual delivery).
    - Rollback: eas update republish (re-publish a prior update on top) + rollBackToEmbedded
      directive + client anti-bricking (emergency launch, maxUpdatesToKeep).
    - bsdiff patching: updates.enableBsdiffPatchSupport (default true) -> delta between updates.

10.4 Client config (app.json "updates")  [DOC docs.expo.dev/versions/latest/sdk/updates]
      updates.url (required), runtimeVersion (required), updates.enabled,
      updates.checkAutomatically (ON_LOAD|ON_ERROR_RECOVERY|NEVER),
      updates.fallbackToCacheTimeout, updates.useEmbeddedUpdate,
      updates.codeSigningCertificate, updates.codeSigningMetadata,
      updates.assetPatternsToBeBundled, updates.disableAntiBrickingMeasures,
      updates.enableBsdiffPatchSupport, updates.maxUpdatesToKeep (default 2)

10.5 Backend
    EAS Update (SaaS) OR self-hosted: any server implementing Expo Updates Protocol v1
    (reference: github.com/expo/custom-expo-updates-server). Static-ish but the manifest is
    chosen dynamically from headers (runtime version / channel / filters).

10.6 Maturity / 2026 status
    Production (Expo SDK 58, protocol v1 last modified 2026-08-12). The reference for RN/Expo.

Sources:
  [SPEC] https://docs.expo.dev/technical-specs/expo-updates-1 (modified 2026-08-12)
  [DOC]  https://docs.expo.dev/eas-update/introduction
  [DOC]  https://docs.expo.dev/versions/latest/sdk/updates
  [SRC]  https://github.com/expo/expo/tree/sdk-58/packages/expo-updates


================================================================================
11. Sentry Releases - release/health + rollback gate (NOT an updater)
================================================================================

11.1 Role
    Sentry does not deliver updates. It is the health signal you use as a ROLLOUT GATE:
    pause the rollout or republish the previous update when crash-free metrics drop.

11.2 API surface (REST, Bearer org/auth token)  [DOC docs.sentry.io/api/releases, verified 2026-11-05]
    Base: /api/0/organizations/{organization_slug}/...
    Releases:
      POST   /organizations/{org}/releases/                       create release
             body: { version, ref?, url?, projects[]? , ... }
      GET    /organizations/{org}/releases/                       list
      POST   /organizations/{org}/releases/{version}/             finalize/patch a release
    Commits (per release):
      POST   /organizations/{org}/releases/{version}/commits/     add commits {commits:[{id,author,patch_set?}]}
      GET    /organizations/{org}/releases/{version}/commits/     list
      GET    /organizations/{org}/releases/{version}/files/       changed files (sourcemap/dSYM)
    Deploys (per release):
      POST   /organizations/{org}/releases/{version}/deploys/     { name?, environment, url?, promote? }
      GET    /organizations/{org}/releases/{version}/deploys/     list
    Release health (the rollback-gate data):
      GET    /organizations/{org}/releases/{version}/...          "Retrieve Release Health
             Session Statistics": returns event counts and user counts per outcome, e.g.
             { crashed:{count,userCount}, errored:{...}, ok:{...},
               crashFreeUsers: 0.99, crashFreeSessions: 0.997 }
             (CFU = 1 - crashed.users/total.users ; CFS = 1 - crashed.sessions/total.sessions)
      GET    ".../release-thresholds..." (Alpha)                  threshold status vs a baseline
    Artifact bundles:
      POST   /organizations/{org}/releases/{version}/files/...    upload sourcemaps/dSYMs
      POST   /organizations/{org}/artifacts/...                   "Assemble an Artifact Bundle"

11.3 How it acts as a rollback gate (pattern)
    - After you flip rollout to N% (or republish), poll the release-health endpoint over a
      window (e.g. 5 min / 1 h) for the new version.
    - If crashFreeSessions (or crashFreeUsers) < your threshold (or vs the previous release
      baseline), trigger your updater's rollback: republish the prior update (Expo), or point
      the channel/manifest back (your Worker), or lower the rollout.
    - Sentry only provides the metric + threshold status; the actual rollback is your updater's
      job. Sentry is the "eyes", the updater is the "hand".

11.4 Backend
    Sentry SaaS or self-hosted. Auth = org/auth token (Bearer). No update channel.

11.5 Maturity / 2026 status
    Production (releases/deploys/commits/release-health are stable GA; release THRESHOLDS are
    still Alpha). 2026: current.

Sources:
  [DOC] https://docs.sentry.io/api/releases/  (endpoint list, verified 2026-11-05)
  [DOC] https://docs.sentry.io/product/release-health/


================================================================================
12. Flutter - no first-party updater; community OTA
================================================================================

12.1 Clarify the premise
    Flutter has NO first-party auto-updater. package_info_plus is NOT an updater - it only
    READS installed metadata (appName/packageName/version/buildNumber) via platform channels.
    "Update" in Flutter land = (a) store updates for the native shell, plus (b) an OTA layer
    for Dart code/assets if you add one.

12.2 Community OTA packages
    - Shorebird (shorebirdtech) - the production one [SRC shorebirdtech/shorebird main]
        * SaaS. Compiles Dart to AOT and ships PATCHES (diff of AOT code) + assets via its
          CodePush-style protocol (packages: shorebird_code_push_client,
          shorebird_code_push_protocol). CLI: shorebird release (full) / shorebird patch (diff).
        * A "release" is tied to a store build; a "patch" is an OTA delta of Dart code + assets
          that applies to that release's runtime. Android-first (iOS via a managed native shell).
        * Backend: Shorebird cloud (their CodePush API). Not self-hostable.
    - neat_update_manager - community helper (NOT a wire protocol). It checks a version/
      endpoint, downloads a NEW APK/AAB, and triggers the Android package-install intent.
      Your own manifest/endpoint; Android-only in practice. [KNOW]
    - fota (Flutter OTA) - community SaaS/helper for OTA via a manifest; lighter than
      Shorebird; less battle-tested. [KNOW]
    - (Flutter desktop) auto_updater (leanflutter) wraps Sparkle/WinSparkle for desktop - it
      reuses section 4/5 protocols, not a new one. [KNOW]

12.3 Backend
    Shorebird = their SaaS. Custom = your endpoint + Android install intent; iOS is
    effectively store/AdHoc only (no OOTB self-distribution of a new .ipa).

12.4 Maturity / 2026 status
    Shorebird: production. Flutter itself: no updater (combine store + Shorebird/OTA).

Sources:
  [SRC] https://github.com/shorebirdtech/shorebird (main) : README.md, packages/ table
  [DOC] https://docs.shorebird.dev
  [KNOW] package_info_plus, neat_update_manager, fota


================================================================================
13. react-native-code-push (React Native client for CodePush)
================================================================================

13.1 Status [DOC, verified 2026-11-05]
    Same as section 9: retired 2025-03-31, repo archived. This is just the RN client module
    for the (dead) CodePush service. Will not support RN New Architecture (0.76+ must opt out).

13.2 Wire
    Identical to CodePush (section 9.2): manifest JSON (label, packageHash, appVersion,
    mandatory, assetUrls, rollout) + bundle.zip + optional diff. Self-hosted = code-push-server
    (archived).

13.3 Sunset
    Hard: 2025-03-31. Migrate to Expo Update or Cap Awesome/HotCodePush.

Sources:
  [DOC] https://github.com/microsoft/react-native-code-push (archived; retire 2025-03-31)


================================================================================
14. .NET MAUI deployment / update
================================================================================

MAUI is a cross-platform .NET framework (single C#/XAML codebase -> Android, iOS, macOS,
Windows). It has NO dedicated updater; it reuses each host platform's mechanism:

14.1 Per-target update path
    - Windows  : MSIX sideload via App Installer (section 6) or Microsoft Store. ClickOnce is
                 the LEGACY .NET-Framework-era option - Windows-only, effectively deprecated for
                 new MAUI apps; do not plan on it.
    - macOS    : Sparkle (section 4) or the Mac App Store.
    - Android  : Play Store (AAB) for store; self-distributed APK + in-app install intent for
                 sideload (signature must match the existing install or user must reinstall).
    - iOS      : App Store / TestFlight / Ad Hoc ONLY. No OOTB self-distribution of a new .ipa.

14.2 Implication
    A MAUI app's "auto-update" is the UNION of: App Installer (Win) + Sparkle (mac) + Store
    (Android/iOS). There is no MAUI-level manifest protocol.

14.3 Maturity / 2026 status
    Tracks the platform updaters. ClickOnce: legacy/deprecated. 2026: use App Installer +
    Sparkle + Store.

Sources:
  [KNOW] https://learn.microsoft.com/dotnet/maui/  (deployment: MSIX, Store)
  [KNOW] https://learn.microsoft.com/en-us/visualstudio/pubde/  (ClickOnce, legacy)


================================================================================
15. Uno Platform - web + native (no dedicated updater)
================================================================================

15.1 Targets
    Uno is a cross-platform .NET/XAML framework: Windows (WinUI/UWP), Android, iOS, macOS,
    Linux, and WebAssembly (WASM) via Skia/BlazorWebView.

15.2 Update story (per surface; no first-party updater)
    - Web (WASM): it is a web app -> standard static deployment + PWA service-worker updates
      (section 16). No special protocol; the "update" is the SW script byte-diff + precache
      manifest revision.
    - Native (Windows): MSIX/Store (section 6/14) or, if Win32, WinSparkle (section 5).
    - Native (Android/iOS/macOS): Store / Play / App Store / Sparkle, same as any native app.
    - Conclusion: Uno has NO dedicated auto-update protocol - it delegates to the host
      platform mechanism. "Or absence" is the accurate answer: there is nothing Uno-specific
      to integrate.

15.3 Maturity / 2026 status
    Production framework; no dedicated updater layer. 2026: current.

Sources:
  [KNOW] https://uno.platform  (targets + web WASM)


================================================================================
16. PWA service worker update lifecycle (W3C) + Workbox
================================================================================

16.1 W3C Service Worker update lifecycle  [KNOW - W3C Service Worker spec + MDN]
    States: installing -> installed -> (waiting) -> activating -> active -> redundant.
    - Update check: on idle/navigation the browser re-fetches the SW script; if the bytes
      differ (gated by HTTP cache validation), a NEW worker is installed.
    - waiting: the new worker sits in "waiting" until the old worker's pages close, UNLESS
      the new worker calls self.skipWaiting() in its 'install' event -> it activates now and
      the old worker becomes redundant (deleted).
    - clients.claim(): called in the 'activate' event -> the new worker immediately controls
      already-open pages. Without it, existing pages keep the old worker until reload.
    - The classic RACE: skipWaiting WITHOUT claim -> new worker active but open pages still on
      the old one (need a reload prompt); claim WITHOUT skipWaiting -> new worker won't
      activate until clients close. Best practice: skipWaiting on install + clients.claim on
      activate + BroadcastChannel "new version" message to prompt a reload.
    - Navigation preload: registration.navigationPreload.enable() -> the SW fetches the
      navigation request, enabling SWR/caching of the HTML shell.

16.2 Workbox recipes  [KNOW - workbox.dev]
    - workbox-window:
        const wb = new Workbox('/sw.js');
        wb.addEventListener('waiting',    () => showUpdateButton());
        wb.addEventListener('controlling',() => location.reload());
        showUpdateButton.onclick = () => wb.messageSW({ type:'SKIP_WAITING' });
      events: waiting | controlling | message | offline | error | registered.
    - workbox-broadcast-update (BroadcastUpdateSW):
        new BroadcastUpdateSW({ channelName:'sw-update' });
      broadcasts across all open tabs when a new SW activates -> each tab can prompt reload.
    - workbox-precaching:
        self.__WB_MANIFEST -> generated list of hashed/revisioned assets; a revision change
        triggers an SW update. workbox.precaching.precacheAndRoute(self.__WB_MANIFEST).
    - workbox-strategies: CacheFirst, StaleWhileRevalidate (serve cache, revalidate in
      background), NetworkFirst, NetworkOnly, CacheFirst.
        workbox.routing.registerRoute(pattern, new StaleWhileRevalidate({ cacheName }));
    - workbox-background-sync / workbox-range-requests as needed.

16.3 "Wire format"
    There is no single manifest file. The update unit is:
      - the service worker script URL (byte-diff is the change signal), plus
      - the precache manifest (asset list with hashes/revisions), plus
      - HTTP Cache-Control on the SW + assets (short for SW, long/immutable for assets).
    For a Cloudflare Worker: serve the SW + precache manifest with dynamic headers, and
    canary by hostname/query string to different precache sets.

16.4 Signing
    None. Trust = same-origin HTTPS (+ optional subresource integrity via CSP script-src).

16.5 Channels / rollout
    No native channel. Canary = serve a different SW/manifest per origin, path, or query.

16.6 Backend
    Any static HTTPS (the SW + precached assets): R2/Cloudflare, S3, GitHub Pages, Vercel,
    Netlify. A Worker is ideal (dynamic headers, canary, versioned precache).

16.7 Maturity / 2026 status
    Production. W3C standard across evergreen browsers; Workbox stable. 2026: current.

Sources:
  [KNOW] https://www.w3.org/TR/service-workers-2/ (W3C Service Worker spec)
  [KNOW] https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
  [KNOW] https://workbox.dev (workbox-window / broadcast-update / precaching / strategies)


================================================================================
17. Chrome component updater (Google-Update / OMA-DM) - "what Google trusts"
================================================================================

17.1 What it is
    Google's mechanism for auto-updating Chrome + components (Safe Browsing lists,
    extensions, NaCl, historically Flash) runs through the Google Update (AU) client, a
    dedicated update binary separate from the app. On managed/enterprise devices it is
    steered via OMA-DM (Open Mobile Alliance Device Management).

17.2 Protocol (brief)
    - Consumer: Google-Update backend over HTTPS; update manifests + signed components.
      Components are Authenticode/Google-signed and verified before install.
    - Managed: OMA-DM (OMA-TS-OMA-DM) - an XML protocol (ProvisioningDOC / ManagementObject)
      over HTTP(S) used by Android/Chrome management to push component + policy updates.
    - Trust model = Google's own code-signing root + signature verification + (for consumer)
      reputation. It is NOT a protocol you can adopt for your app.

17.3 Relevance to AIRIZ
    Only as a reference for "what Google itself trusts": a dedicated signed update client,
    signature-verified artifacts, and (enterprise) OMA-DM policy. Nothing to reuse directly
    for a 5-surface product; it exists to justify that a signed-manifest + signature-verified
    artifact is the industry norm.

17.4 Maturity / 2026 status
    Google-internal; OMA-DM is an OMA standard but effectively Google/Android-managed. Not a
    general-purpose updater.

Sources:
  [KNOW] https://www.openmobilealliance.org/specifications/... (OMA-DM, OMA-TS-OMA-DM)
  [KNOW] Google Update / component update (proprietary; OMA-DM for managed)


================================================================================
CLOSING - Minimum viable subset to reimplement
================================================================================

Goal: one person, one GitHub workflow, shipping Win + Android + iOS + Web PWA + a Cloudflare
Worker. Which fields from all of the above are actually LOAD-BEARING?

The load-bearing core (the intersection every real updater depends on):
  1. version         (semver) - every protocol; the "is this newer?" key.
  2. url             - the artifact to fetch.
  3. sha256          - integrity of the artifact. (Upgrade Squirrel's SHA-1 to SHA-256;
                      matches Expo asset hash, AppInstaller Hash, CodePush packageHash.)
  4. signature       - ONE Ed25519 signature over the canonical manifest (version+url+sha256
                      +pub_date). The trust anchor. (Tauri=minisign, electron-updater=Ed25519
                      manifest, Sparkle=EdDSA, Expo=RSA. Pick Ed25519; embed the public key in
                      each client; keep the private key as a CI secret.)
  5. pub_date / createdAt (ISO-8601) - ordering/recency.
  6. minVersion / runtimeVersion - the native-compat gate (Sparkle minSystemVersion, Expo
                      runtimeVersion, electron-updater minimumSystemVersion, AppInstaller
                      PackageFamilyName). Prevents pushing a native-breaking update.
  7. channel + rollout (0-100) - canary/percentage. (Sparkle channel+phased, electron-updater
                      stagingPercentage, Squirrel " # NN%", Expo rollout, Tauri endpoint-per-
                      channel.) One field each; bucket deterministically client-side.
  8. platforms / OS-ARCH map - because you ship 5 surfaces. (Tauri platforms{}, WinSparkle
                      sparkle:os, electron-updater per-platform .yml.)
  9. notes           - optional, universal.
 10. mandatory / critical - force flag (CodePush mandatory, Sparkle criticalUpdate).
 11. assets map      - ONLY for the JS/web surfaces (Expo assets[], CodePush assetUrls,
                      Capacitor assets). Native installers ship the whole artifact; no asset
                      map needed.

Deliberately NOT load-bearing (add later / skip):
  - Delta/blockmap (Sparkle deltas, electron-updater .blockmap, Tauri .zip, CodePush diff,
    Expo bsdiff, bspatch): saves bandwidth, NOT required for correctness or safety.
  - Multi-key rotation / keyId / signed feeds: overkill for one person. Single Ed25519 key +
    CI secret is sufficient; plan rotation manually if you ever lose the key.
  - OMA-DM, AppInstaller Deployment/staged, Store deep-integration: only if you go Store or
    enterprise-managed.

Concrete minimal architecture:
  - Cloudflare Worker serves, per target:
        GET /manifest/{target}   target in { win-x64, android, ios-web, pwa }
      -> small JSON: { version, url, sha256, signature, pub_date, notes, minVersion,
                      channel, rollout }
    plus the PWA service worker + precache manifest (section 16) on the same Worker.
  - Artifacts on R2: MSIX or NSIS/EXE (Win), signed APK (Android), the PWA static bundle.
  - GitHub workflow: build all surfaces -> sha256 each -> sign the manifest with Ed25519
    (private key = GH secret) -> upload artifacts to R2 -> write manifest/{target}.json.
    Optionally gate rollout-to-100 on a Sentry release-health check (section 11) before
    flipping the rollout field.
  - Clients: Win (electron-updater or Tauri or raw fetch+verify+install), Android (fetch
    manifest, verify Ed25519 + sha256, install APK via intent), PWA (SW + Workbox), Worker
    (its own config fetch). Each embeds the public key.

The per-surface realities that CONSTRAIN the "one manifest for everything" dream (these are the
true load-bearing facts, not the fields):
  - iOS NATIVE: you CANNOT self-distribute a new .ipa to existing users outside App Store /
    Ad Hoc / Enterprise. So a single manifest layer CANNOT deliver iOS native binaries OOTB.
    iOS "auto-update" = App Store (Apple delivers) OR OTA of the in-app web/JS layer only
    (the manifest via an in-app webview). This is the #1 constraint on the unified layer.
  - Android: you CAN sideload a signed APK (Play App Bundle is store-only). A self-hosted APK
    + in-app install intent works (Shorebird / neat_update_manager model), but the APK signature
    must match the existing install or the user must uninstall/reinstall.
  - Windows: MSIX via App Installer, or self-distributed NSIS/EXE (Electron/Tauri model), or
    Store. Self-distributed NSIS/EXE is the easiest pure-OTA path.
  - PWA / Worker: fully self-distributable (SW + static).

Bottom line for the (a)/(b)/(c) decision:
  - (c) A single signed-manifest layer (Ed25519 JSON on a Worker + artifacts on R2) is the
    simplest unifying design and works for Win + Android-APK + PWA + Worker. But it CANNOT
    cover iOS native (store-only) - plan iOS as store + (optionally) in-app JS OTA.
  - (a) Keep electron-updater (Win/macOS desktop) + a Capacitor live-update (HotCodePush) for
    the mobile web layer is the pragmatic "use what's native per platform" path, at the cost
    of maintaining 2 update stacks + their signing keys.
  - (b) Tauri gives ONE updater for Win/macOS/Linux desktop but does NOT cover Android/iOS/
    PWA/Worker - so it does not unify all 5 surfaces; it only unifies desktop.
  - Recommended framing: there is no single tool for 5 heterogeneous surfaces. The realistic
    minimum is: a single Ed25519-signed manifest contract you OWN (on the Worker/R2) that the
    PWA + Android + Windows surfaces pull, with macOS via Sparkle (if you ship it) and iOS
    native delegated to the App Store. Sentry as the rollout gate.
