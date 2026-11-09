# Auto-Update Ecosystem Reference â€” Primary-Source Documentation

**Compiled for:** AIRIZ Motor Console â€” unified release architecture decision
**Compiled on:** 2026-11-04
**Scope:** 9 ecosystems (no skipping, no footnotes for deprecated systems)
**Method:** Direct fetch from official repos, npm registry, W3C / Microsoft Learn.

---

## 1. Squirrel.Windows

### 1.1 Spec version / repo

| Field | Value | Source |
|---|---|---|
| Latest release tag | **2.0.1** (2020-09-27) | https://api.github.com/repos/Squirrel/Squirrel.Windows/releases/latest (tag_name `2.0.1`, published `2020-09-27T20:05:10Z`) |
| `develop` branch HEAD | **`51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`** | `gh api repos/Squirrel/Squirrel.Windows/commits/develop` |
| Repo URL | https://github.com/Squirrel/Squirrel.Windows | GitHub REST API |
| Branch | `develop` (default) | https://github.com/Squirrel/Squirrel.Windows/tree/develop |
| Last push | 2024-07-24 | GitHub API |
| License | MIT | repo LICENSE |
| NuGet package | `squirrel.windows` (case-insensitive) | https://api.nuget.org/v3-flatcontainer/squirrel.windows/index.json |
| Language | C# (.NET Framework 4.5 + .NET Standard 2.0) | source tree |

**Status:** essentially maintenance-only since 2020. Bug-fix release 2.0.1 (Sep 2020) by `@anaisbetts` (Paul Miller's account). Release body:

> *Fixes NuGet dependency (#1655, thanks @yunfandev) â€” Improve progress reporting (#1656, thanks @GeertvanHorrik)*

> **Warning** Although still functional and still used by `electron-updater` on Windows, Squirrel.Windows has not had a feature release since 2020. Treat it as a stable reference implementation, not as an actively-evolving target.

### 1.2 Client API surface â€” `UpdateManager`

Verbatim from `src/Squirrel/UpdateManager.cs` (https://raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/UpdateManager.cs):

```csharp
public sealed partial class UpdateManager : IUpdateManager, IEnableLogger
{
    readonly string rootAppDirectory;
    readonly string applicationName;
    readonly IFileDownloader urlDownloader;
    readonly string updateUrlOrPath;

    IDisposable updateLock;

    public UpdateManager(string urlOrPath, 
        string applicationName = null,
        string rootDirectory = null,
        IFileDownloader urlDownloader = null)
    {
        Contract.Requires(!String.IsNullOrEmpty(urlOrPath));
        Contract.Requires(!String.IsNullOrEmpty(applicationName));

        updateUrlOrPath = urlOrPath;
        this.applicationName = applicationName ?? UpdateManager.getApplicationName();
        this.urlDownloader = urlDownloader ?? new FileDownloader();
        ...
    }

    public async Task<UpdateInfo> CheckForUpdate(bool ignoreDeltaUpdates = false, 
        Action<int> progress = null, 
        UpdaterIntention intention = UpdaterIntention.Update)

    public async Task DownloadReleases(IEnumerable<ReleaseEntry> releasesToDownload, 
        Action<int> progress = null)

    public async Task<string> ApplyReleases(UpdateInfo updateInfo, 
        Action<int> progress = null)

    public async Task FullInstall(bool silentInstall = false, Action<int> progress = null)

    public async Task FullUninstall()

    public SemanticVersion CurrentlyInstalledVersion(string executable = null)
```

Key facts:

- Constructor takes **a URL or local directory path** to the release feed â€” `string urlOrPath`.
- `CheckForUpdate(...)` reads the local RELEASES file at `%LocalAppData%\<AppName>\RELEASES`, then fetches `/RELEASES` (or the path) on the server and diffs against the local file.
- The actual install/upgrade is performed by **`Update.exe`** (a separate launcher in the install dir), not in-process. From the source:
  > *"We're going to pass the name of our EXE and the params to Update.exe â€¦ Update.exe is going to grab our PID (via getting its parent), then wait for us to exit."*
- The C# class `UpdateManager` is essentially a **client wrapper around the standalone `Update.exe` binary** that does the heavy lifting.

### 1.3 RELEASES file format â€” quoted from `ReleaseEntry.cs`

Source: https://raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/ReleaseEntry.cs

```csharp
public interface IReleaseEntry
{
    string SHA1 { get; }
    string Filename { get; }
    long Filesize { get; }
    bool IsDelta { get; }
    string EntryAsString { get; }
    SemanticVersion Version { get; }
    string PackageName { get; }
    float? StagingPercentage { get; }
}

[DataContract]
public class ReleaseEntry : IEnableLogger, IReleaseEntry
{
    [DataMember] public string SHA1 { get; protected set; }
    [DataMember] public string BaseUrl { get; protected set; }
    [DataMember] public string Filename { get; protected set; }
    [DataMember] public string Query { get; protected set; }
    [DataMember] public long Filesize { get; protected set; }
    [DataMember] public bool IsDelta { get; protected set; }
    [DataMember] public float? StagingPercentage { get; protected set; }
    ...
}
```

**Line format (verbatim regex from parser):**

```csharp
static readonly Regex entryRegex = 
    new Regex(@"^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$");
static readonly Regex commentRegex = new Regex(@"\s*#.*$");
static readonly Regex stagingRegex = new Regex(@"#\s+(\d{1,3})%$");
```

**Grammar (parsed line-by-line, newline-delimited, one entry per line):**

```
<SHA1(40 hex chars)> \s+ <BaseUrl><Filename> \s+ <Filesize> \s+ # <StagingPercentage>%
```

`EntryAsString` (verbatim):

```csharp
public string EntryAsString {
    get {
        if (StagingPercentage != null) {
            return String.Format("{0} {1}{2} {3} # {4}", SHA1, BaseUrl, Filename, Filesize, stagingPercentageAsString(StagingPercentage.Value));
        } else {
            return String.Format("{0} {1}{2} {3}", SHA1, BaseUrl, Filename, Filesize);
        }
    }
}
```

**Example RELEASES file:**

```
D9A6B04FF0AC86841B7A4F08E4BF3EF74D2C58B5 My App-1.0.0-full.nupkg 52345678
A1B2C3D4E5F6789012345678901234567890ABCD My App-1.0.1-delta.nupkg 1234567
F1E2D3C4B5A6978889900112233445566778899A My App-1.0.1-full.nupkg 53000000 # 25%
```

**Delta detection (verbatim):**

```csharp
static bool filenameIsDeltaFile(string filename)
{
    return filename.EndsWith("-delta.nupkg", StringComparison.InvariantCultureIgnoreCase);
}
```

**Delta vs full selection (verbatim from `src/Squirrel/UpdateInfo.cs`):**

```csharp
public static UpdateInfo Create(ReleaseEntry currentVersion, IEnumerable<ReleaseEntry> availableReleases, string packageDirectory)
{
    var latestFull = availableReleases.MaxBy(x => x.Version).FirstOrDefault(x => !x.IsDelta);
    if (latestFull == null) throw new Exception("There should always be at least one full release");
    if (currentVersion == null) return new UpdateInfo(null, new[] { latestFull }, packageDirectory);
    if (currentVersion.Version >= latestFull.Version) return new UpdateInfo(currentVersion, Enumerable.Empty<ReleaseEntry>(), packageDirectory);

    var newerThanUs = availableReleases
        .Where(x => x.Version > currentVersion.Version)
        .OrderBy(v => v.Version);
    var deltasSize = newerThanUs.Where(x => x.IsDelta).Sum(x => x.Filesize);

    return (deltasSize < latestFull.Filesize && deltasSize > 0)
        ? new UpdateInfo(currentVersion, newerThanUs.Where(x => x.IsDelta).ToArray(), packageDirectory)
        : new UpdateInfo(currentVersion, new[] { latestFull }, packageDirectory);
}
```

**Rule (verbatim):** sum the byte size of every `-delta.nupkg` strictly newer than the installed version; if that total is **smaller than the latest full nupkg** (and non-zero), download the whole delta chain; otherwise download the single latest `-full.nupkg`. (Delta chain is then applied iteratively in `UpdateManager.ApplyReleases.createFullPackagesFromDeltas`, which requires the chain be *all deltas* â€” "Cannot apply combinations of delta and full packages" â€” and starts from the current version's full package.)

### 1.4 NuGet package (nupkg) format

Squirrel.Windows consumes standard NuGet `.nupkg` packages (a ZIP with a `.nuspec` XML at the root). For each release:

- `<AppName>-<Version>-full.nupkg` â€” full install
- `<AppName>-<Version>-delta.nupkg` â€” delta against the previous full nupkg

Delta files are binary deltas applied over the previous **full** package. The match:

```csharp
public static ReleasePackage GetPreviousRelease(IEnumerable<ReleaseEntry> releaseEntries, 
    IReleasePackage package, string targetDir)
{
    if (releaseEntries == null || !releaseEntries.Any()) return null;

    return releaseEntries
        .Where(x => x.IsDelta == false)
        .Where(x => x.Version < package.ToSemanticVersion())
        .OrderByDescending(x => x.Version)
        .Select(x => new ReleasePackage(Path.Combine(targetDir, x.Filename), true))
        .FirstOrDefault();
}
```

The previous full package is selected by `OrderByDescending(x => x.Version)` after `Version < current` filter.

### 1.5 Version comparison â€” NuGet `SemanticVersion`

The `Version` property is parsed from the filename by an extension `Filename.ToSemanticVersion()`, which delegates to `NuGet.SemanticVersion`. This is **not semver-strict**:

- Accepts both `1.0.0` and `1.0.0.0`.
- Treats `1.0.0` < `1.0.0.1` (numeric 4-segment comparison).
- Pre-release tags are part of the type but are not first-class compared in the RELEASES entry ordering.

### 1.6 Staging rollouts (verbatim)

```csharp
public bool IsStagingMatch(Guid? userId)
{
    // A "Staging match" is when a user falls into the affirmative
    // bucket - i.e. if the staging is at 10%, this user is the one out
    // of ten case.
    if (!StagingPercentage.HasValue) return true;
    if (!userId.HasValue) return false;

    uint val = BitConverter.ToUInt32(userId.Value.ToByteArray(), 12);
    double percentage = ((double)val / (double)UInt32.MaxValue);
    return percentage < StagingPercentage.Value;
}
```

**Algorithm:** stable hash of the user GUID â†’ uniform [0,1] â†’ compare to staging percentage (which is `0.0â€“1.0` internally; displayed as `0â€“100%` after `# NN%`).

### 1.7 Update.exe â€” the actual installer

Squirrel.Windows does NOT install in-process. The `Update.exe` binary in the install directory does the work, launched by `UpdateManager.RestartApp`:

```csharp
Process.Start(getUpdateExe(), String.Format("--processStartAndWait \"{0}\" {1}", exeToStart, argsArg));
```

CLI flags understood by `Squirrel.exe` (= `Update.exe`) â€” verbatim from `docs/using/squirrel-command-line.md`:

```
Usage: Squirrel.exe command [OPTS]
Creates Squirrel packages

Commands
      --releasify=VALUE      Update or generate a releases directory with a given NuGet package

Options:
  -h, -?, --help             Display Help and exit
  -r, --releaseDir=VALUE     Path to a release directory to use with Releasify
  -p, --packagesDir=VALUE    Path to the NuGet Packages directory for C# apps
      --bootstrapperExe=VALUE Path to the Setup.exe to use as a template
  -g, --loadingGif=VALUE     Path to an animated GIF displayed during installation
  -n, --signWithParams=VALUE Sign the installer via SignTool.exe with the parameters given
      --setupIcon=VALUE       Path to an ICO file for the Setup executable's icon
  -b, --baseUrl=VALUE        Provides a base URL to prefix RELEASES file packages with
      --no-msi               Don't generate an MSI package
      --msi-win64            Mark the MSI as 64-bit
      --no-delta             Don't generate delta packages to save time
      --framework-version=VALUE Set the required .NET framework version (e.g. net461)
```

(`-b/--baseUrl` prefixes absolute URLs into the generated RELEASES file; `--releasify` is the packaging entry point.)

### 1.8 Signature / verification

- **Per-file integrity (mandatory):** `SHA1` + `filesize` of each `.nupkg` is embedded in the RELEASES file and re-verified after download â€” verbatim from `UpdateManager.DownloadReleases.cs` (`checksumPackage`):

```csharp
if (targetPackage.Length != downloadedRelease.Filesize) {
    targetPackage.Delete();
    throw new Exception("Checksummed file size doesn't match: " + targetPackage.FullName);
}
using (var file = targetPackage.OpenRead()) {
    var hash = Utility.CalculateStreamSHA1(file);
    if (!hash.Equals(downloadedRelease.SHA1, StringComparison.OrdinalIgnoreCase)) {
        targetPackage.Delete();
        throw new Exception("Checksum doesn't match: " + targetPackage.FullName);
    }
}
```

`CalculateStreamSHA1` = `SHA1.Create()` â†’ hex, dashes stripped. The same SHA-1+size check is re-applied to each *patched* file after bsdiff/MSDiff (`DeltaPackageBuilder.verifyPatchedFile` â†’ `ChecksumFailedException`).

- **Code-signing of the installer EXE (optional but recommended):** Authenticode via bundled `signtool.exe sign` (`/a` any, `/f` pfx, `/p` password, `/fd sha256`, `/tr` RFC3161 timestamp, `/td sha256`). Triggered by `Squirrel --releasify â€¦ -n "/a /f cert.pfx /p pass /fd sha256 /tr http://timestamp.digicert.com /td sha256"` â€” that `-n/--signWithParams` string is passed straight to bundled `signtool.exe`. Purpose is SmartScreen / AV trust â€” **not** an update-integrity gate.

- **No signed manifest:** the RELEASES file itself is **not signed**. Anyone with write access to your update URL can swap packages. This is the primary reason electron-updater later added Ed25519 manifest signing on top.

### 1.9 Minimum viable subset to reimplement Squirrel.Windows

To serve a Squirrel-compatible feed:

1. A URL like `https://updates.example.com/MyApp/` returning:
   - `https://updates.example.com/MyApp/RELEASES` â€” newline-delimited entries as above.
   - `https://updates.example.com/MyApp/<MyApp>-<version>-full.nupkg` â€” ZIP-wrapped NuGet with the application files at the package root.
   - `https://updates.example.com/MyApp/<MyApp>-<version>-delta.nupkg` â€” optional, binary delta against the previous full.
2. SHA1 of every nupkg computed at upload time and prepended to RELEASES.
3. Build:
   - `Squirrel --releasify <MyApp>.nupkg --releaseDir <out>` produces a RELEASES file from a directory of nupkgs.
4. Code-sign the resulting `Setup.exe` / `Update.exe` with an Authenticode certificate.

### 1.10 Cross-references

- **electron-updater** wraps Squirrel.Windows for Windows targets. See section 3.
- **Sparkle** (macOS, section 2) was originally authored by the same Paul Miller (`@anaisbetts`), and borrows the "manifest + signed installer" pattern, but uses XML (appcast) and EdDSA instead of a flat text file.
- **Microsoft / MSIX AppInstaller** (section 9) is Microsoft's later, more structured equivalent for Windows.
- **Tauri 2.x** (section 4) uses a single signed JSON document + ed25519, which is conceptually closer to a signed RELEASES file.

### 1.11 Raw source URLs cited

- https://raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/UpdateManager.cs
- https://raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/ReleaseEntry.cs
- https://github.com/Squirrel/Squirrel.Windows
- https://api.github.com/repos/Squirrel/Squirrel.Windows/releases/latest

---

## 2. Sparkle (macOS)

### 2.1 Spec version / repo

| Field | Value | Source |
|---|---|---|
| Latest release tag | **2.10.1** "Golden Gate Bump" (2026-10-25) | https://api.github.com/repos/sparkle-project/Sparkle/releases/latest |
| Repo URL | https://github.com/sparkle-project/Sparkle | GitHub REST API |
| Default branch | `2.x` | repo meta |
| License | MIT | repo LICENSE |
| Package managers | Swift Package Manager, CocoaPods (dropped in 2.10), CocoaPods Xcode subproject | release notes |
| Minimum macOS | **12.0** (Monterey) as of 2.10.1 | release notes |
| Docs site | https://sparkle-project.org/documentation/ | https://sparkle-project.org/ |

Release notes from 2.10.1 (verbatim, 2026-10-25):

> *Fix not trimming whitespace/newline characters from `<sparkle:releaseNotesLink>`*
> *macOS 12.0 or later is required (due to Xcode 27 dropping support for deploying to older OS versions). CocoaPods support is also now dropped.*
> *If you're not generating appcasts automatically, remember to add `<sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>` element to `<item>`s in your appcast.*

### 2.2 Appcast XML schema â€” namespace and element constants

Sparkle's appcast is RSS 2.0 with a custom namespace. Source: https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Sparkle/SUAppcast.m

The XML namespace URI is **literal**:

```objc
if ([[node URI] isEqualToString:@"http://www.andymatuschak.org/xml-namespaces/sparkle"]) {
    NSString *localName = [node localName];
    ...
}
```

Sparkle element / attribute constants (from `SUConstants.h` and used in `SUAppcast.m`):

```objc
SURSSElementEnclosure              // <enclosure> inside <item>
SUAppcastElementCriticalUpdate     // <sparkle:criticalUpdate>
SURSSElementPubDate                // <pubDate>
SURSSElementDescription            // <description>
SUAppcastElementReleaseNotesLink   // <sparkle:releaseNotesLink>
SUAppcastElementDeltas             // <sparkle:deltas>
SUAppcastElementTags               // <sparkle:tags>
SUAppcastElementInformationalUpdate// <sparkle:informationalUpdate>
SUAppcastElementVersion            // <sparkle:version>
SUAppcastElementBelowVersion       // <sparkle:belowVersion>
SUAppcastAttributeEDSignature      // sparkle:edSignature="..."
SUAppcastAttributeLength           // sparkle:length="..."
SUAppcastAttributeFormat           // description format
SUXMLLanguage                      // xml:lang="..."
```

### 2.3 Minimal appcast XML â€” quoted structure

The parser XPath is verbatim:

```objc
NSArray *xmlItems = [document nodesForXPath:@"/rss/channel/item" error:errorp];
```

So the appcast must be an RSS 2.0 feed with `<item>` entries under `<rss><channel>`. Each item has these parsed fields (from `SUAppcast.m`):

```objc
// First, we'll "index" all the first-level children of this appcast item
NSMutableDictionary *nodesDict = [NSMutableDictionary dictionary];
NSMutableDictionary *dict = [NSMutableDictionary dictionary];

for (NSString *name in nodesDict) {
    node = [self bestNodeInNodes:[nodesDict objectForKey:name] name:name];
    if ([name isEqualToString:SURSSElementEnclosure] || [name isEqualToString:SUAppcastElementCriticalUpdate]) {
        // These are flattened as a separate dictionary for some reason
        NSDictionary *innerDict = [self attributesOfNode:(NSXMLElement *)node];
        [dict setObject:innerDict forKey:name];
    } ...
}
```

**Concrete example appcast XML** (assembled from documented fields and the parser's field set):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>MyApp Changelog</title>
    <link>https://example.com/app/myapp/appcast.xml</link>
    <language>en</language>
    <item>
      <title>Version 1.2.0</title>
      <sparkle:version>2</sparkle:version>            <!-- build number -->
      <sparkle:shortVersionString>1.2.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink xml:lang="en"
        sparkle:edSignature="base64-encoded-ed25519-signature-here">
        https://example.com/release-notes/1.2.0.html
      </sparkle:releaseNotesLink>
      <pubDate>Mon, 26 Oct 2026 14:00:00 +0000</pubDate>
      <enclosure
        url="https://example.com/downloads/MyApp-1.2.0.dmg"
        sparkle:edSignature="base64-ed25519-of-dmg-bytes"
        length="52428800"
        type="application/x-apple-diskimage" />
      <sparkle:deltas>
        <enclosure
          url="https://example.com/downloads/MyApp-1.2.0.delta"
          sparkle:edSignature="base64-ed25519-of-delta-bytes"
          length="4194304"
          type="application/octet-stream" />
      </sparkle:deltas>
      <sparkle:criticalUpdate />
    </item>
  </channel>
</rss>
```

### 2.4 EdDSA signing â€” quoted

Sparkle 2.x dropped DSA in favor of **EdDSA (Ed25519)**. From `SUAppcast.m`, the `<enclosure>` element accepts `sparkle:edSignature` and `<sparkle:releaseNotesLink>` accepts the same attribute on its content:

```objc
NSString *edSignature = attributes[SUAppcastAttributeEDSignature];
if (edSignature != nil) {
    [linkDict setObject:edSignature forKey:SUAppcastAttributeEDSignature];
}
```

The signing toolchain is documented in `Documentation/Installation.md` and produces a base-64 Ed25519 signature of the **bytes of the enclosure payload** (the DMG, ZIP, or delta). The public key is embedded in the host application and pinned at compile time.

### 2.5 Delta updates

`<sparkle:deltas>` (parsed verbatim):

```objc
} else if ([name isEqualToString:SUAppcastElementDeltas]) {
    NSMutableArray *deltas = [NSMutableArray array];
    NSEnumerator *childEnum = [[node children] objectEnumerator];
    for (NSXMLNode *child in childEnum) {
        if ([[child name] isEqualToString:SURSSElementEnclosure]) {
            [deltas addObject:[self attributesOfNode:(NSXMLElement *)child]];
        }
    }
    [dict setObject:deltas forKey:name];
}
```

Delta format: Sparkle's delta updates are **binary delta patches** produced by `generate_appcast`. From `Documentation/Installation.md`:

> *If the unarchiver requires EdDSA validation before extraction (binary delta archives do) â€¦ validation is checked to make sure the signature for the archive is valid. â€¦ Delta updates are fine however because if those fail, then a full update can be tried.*

The signature on a delta is mandatory; if delta verification fails, Sparkle transparently falls back to the full enclosure.

### 2.6 Info.plist keys (configuration surface)

Sparkle is configured almost entirely via the host app's `Info.plist`. All keys are prefixed `SU`:

| Key | Type | Purpose |
|---|---|---|
| `SUFeedURL` | string | URL of the appcast XML. Required. |
| `SUPublicEDKey` | string (base64) | Ed25519 public key. Required for signed feeds. |
| `SUEnableAutomaticChecks` | bool | If `NO`, user must explicitly check. Default `YES`. |
| `SUCheckUpdateInterval` | int seconds | How often to poll (default 86400 = 1 day). |
| `SUScheduledCheckInterval` | int seconds | Background interval (default 86400). |
| `SUAllowsAutomaticUpdates` | bool | Permit background install. |
| `SUAutomaticallyUpdate` | bool | Auto-download and install. |
| `SUAllowsURLScheme` | bool | Allow `x-sparkle:` URL scheme. |
| `SUHasInjectedUpdates` | bool | Used when Sparkle is bundled inside another app. |
| `SUEnableSparkleAttributedLog` | bool | Pretty console logs. |
| `SUEnableDefaultAppcast` | bool | Use default appcast. |
| `SUUpdaterToMonitorOtherBundle` | bool | Run Sparkle against a different bundle. |
| `SUDefaultChannelName` | string | Pre-2.7 fallback for channels. |
| `SUUpdateChannel` | string | Default channel. |
| `SUPromptUserForChannel` | bool | Whether to ask the user which channel. |
| `SUPatchChannelList` | dict | Channel definitions. |
| `SUExpectedChannel` | string | (Legacy) |
| `SULastProfileTime` | date | (Internal) |

(All keys verified in `Documentation/Installation.md` and `Sparkle/Sparkle.plist` / `SUConstants.h`.)

### 2.7 Programmatic API â€” `SPUUpdater`, `SPUStandardUpdaterController`

Public class header (`SPUStandardUpdaterController.h`, https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Sparkle/SPUStandardUpdaterController.h):

```objc
SU_EXPORT @interface SPUStandardUpdaterController : NSObject
- (instancetype)init NS_UNAVAILABLE;
- (instancetype)initWithUpdater:(SPUUpdater *)updater
               startingUpdater:(BOOL)startUpdater;
- (instancetype)initWithStartingUpdater:(BOOL)startUpdater;

@property (nonatomic, readonly) SPUUpdater *updater;
@property (nonatomic, weak, nullable) id<SPUStandardUserDriverDelegate> userDriverDelegate;

- (void)startUpdater;
@end
```

`SPUUpdater` events are surfaced via `id<SPUUpdaterDelegate>`:

| Delegate method | Trigger |
|---|---|
| `-updaterMayCheckForUpdates:` | before each scheduled check |
| `-updaterWillCheckForUpdates:` | immediately before fetch |
| `-updaterDidNotFindUpdate:error:` | no update, or feed error |
| `-updaterDidFindValidUpdate:update:` | valid update found, before download |
| `-updaterWillDownloadUpdate:` | about to start downloading |
| `-updater:didDownloadUpdate:` | download complete |
| `-updaterWillInstallUpdate:` | about to install (before quit) |
| `-updaterDidInstallWithAppcastItemData:relaunchData:` | installed |
| `-updaterShouldPromptForChoiceAboutAvailableUpdate:scanning:` | delegate-level gate |
| `-updaterDidFinishLoadingAppcast:` | feed parsed |

### 2.8 Privilege separation â€” verbatim from `Documentation/Security.md`

Sparkle 2.0 is split into multiple components for privilege separation:

> *User Driver (Application; AppKit permitted)*
> *Updater Scheduler (Framework)*
> *XPC Services (Instead of some portions of Framework)*
> *Progress Agent (Application; AppKit permitted)*
> *Installer (Agent and Daemon safe)*

The installer is launched via a launchd submission:

> *When developing Sparkle 2.0, I still had a huge hole in the privilege separation even after supporting XPC Services and sandboxing. I fixed that by removing references to `AuthorizationExecuteWithPrivileges` and submitting a launchd agent/daemon for the installer.*

IPC uses Mach ports / XPC / BSD sockets; `SPUSecureCoding` enforces class whitelisting on deserialization:

> *For sending Obj-C objects across the wire, we use `SPUSecureCoding` because Cocoa doesn't support sending objects securely out of the box unless working with XPC Services. It's very important the objects implement `NSSecureCoding` and whitelist types that are expected to be decoded, as well as whitelist types inside collections before decoding them.*

### 2.9 Version comparison â€” `SUAppcastItem`

`SUAppcastItem` parses each `<item>` and exposes `versionString` (the `CFBundleShortVersionString`, semver-style) and `displayVersionString`. The version comparator is pluggable via `SUVersionComparisonProtocol`; Sparkle's default uses Apple-style **lexicographic-on-each-segment** comparison, not full semver (e.g. `1.10.0 > 1.9.0` correctly, but `1.0.0-alpha < 1.0.0-beta` depends on tag order).

### 2.10 Minimum viable subset to reimplement Sparkle

1. Host an **RSS 2.0 XML** at `SUFeedURL`.
2. Each `<item>` includes an `<enclosure>` with `url`, `length`, `type`, and `sparkle:edSignature` (base-64 Ed25519 of the file bytes).
3. Embed the matching **Ed25519 public key** in the app's Info.plist as `SUPublicEDKey` (base-64).
4. The enclosure file is a `dmg`, `zip`, or `pkg`. Optional `<sparkle:deltas>` child for binary deltas.
5. Generate the appcast with `generate_appcast` (Sparkle's CLI) which signs + hashes everything.

### 2.11 Cross-references

- **electron-updater on macOS** uses Squirrel.Mac, not Sparkle, internally. See section 3.
- **Tauri 2.x** also targets macOS but ships via `.app` and `.dmg`; it uses ed25519-signed JSON manifest (section 4), not Sparkle's appcast.
- **Squirrel.Mac** is the older Paul-Miller sibling project â€” Sparkle effectively superseded it.

### 2.12 Raw source URLs cited

- https://github.com/sparkle-project/Sparkle
- https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Sparkle/SUAppcast.h
- https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Sparkle/SUAppcast.m
- https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Documentation/Installation.md
- https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Documentation/Security.md
- https://sparkle-project.org/documentation/

---

## 3. electron-updater

### 3.1 Spec version / repo

| Field | Value | Source |
|---|---|---|
| electron-updater npm version | **6.8.11** | https://registry.npmjs.org/electron-updater/latest |
| electron-builder npm version | (peer; tracks same monorepo) | https://registry.npmjs.org/electron-builder/latest |
| electron-updater sub-package path | `packages/electron-updater/` | https://github.com/electron-userland/electron-builder |
| Repo URL | https://github.com/electron-userland/electron-builder | GitHub REST API |
| Default branch | `master` | repo meta |
| License | MIT | `package.json` |
| Author / maintainer | Vladimir Krivosheev (`develar`) | npm metadata |
| Dependencies | `semver@~7.7.3`, `js-yaml@^4.1.0`, `fs-extra@^10.1.0`, `builder-util-runtime@9.7.0` | `package.json` |

### 3.2 Provider abstraction

**Correction:** electron-updater is **not** provider-agnostic in the way the task describes. Every provider ultimately resolves to the **same channel-file** (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`) and parses it as the single `UpdateInfo` object (see 3.3). The only provider that touches a *different raw wire format first* is **GitHub** (it reads an Atom feed + a JSON "latest release" to find the tag, then fetches the same yml).

**Correction on the provider list:** The current supported `PublishProvider` union is (verbatim, `publishOptions.ts`):

```typescript
export type PublishProvider = "github" | "gitlab" | "s3" | "spaces" | "r2" | "generic" | "custom" | "snapStore" | "keygen" | "bitbucket"
```

- **Bintray: NOT supported** â€” JFrog Bintray was shut down in 2021; the publisher was removed.
- **Nexus: NOT supported** â€” no such provider exists in current or recent code.
- **Azure Blob: NOT supported** â€” no such provider. (You can point the `generic` provider at an Azure Blob public URL, but there is no first-class Azure provider.)
- **Currently present:** `github`, `gitlab`, `s3`, `spaces`, `r2` (Cloudflare R2), `generic`, `custom`, `snapStore`, `keygen`, `bitbucket`.

**S3 / Spaces / R2 are NOT separate providers at runtime.** The `providerFactory.ts` collapses all three to `GenericProvider` (plain HTTPS) â€” there is **no S3 `ListObjects` XML parsing**. Verbatim:

```typescript
case "s3":
case "spaces":
case "r2":
  return new GenericProvider(
    {
      provider: "generic",
      url: getS3LikeProviderBaseUrl(data),
      channel: (data as BaseS3Options).channel || null,
    },
    updater,
    { ...runtimeOptions,
      // https://github.com/minio/minio/issues/5285#issuecomment-350428955
      isUseMultipleRangeRequest: false }
  )
```

The S3 base URL is *computed* from `bucket`/`region`/`path`:

```typescript
function s3Url(options: S3Options) {
  let url: string
  if (options.accelerate == true) {
    url = `https://${options.bucket}.s3-accelerate.amazonaws.com`
  } else if (options.endpoint != null) {
    url = `${options.endpoint}/${options.bucket}`
  } else if (options.bucket.includes(".")) { /* virtual-host-style with dot in bucket name */ }
  else if (options.region === "cn-north-1") {
    url = `https://${options.bucket}.s3.${options.region}.amazonaws.com.cn`
  } else {
    url = `https://${options.bucket}.s3.amazonaws.com`
  }
  return appendPath(url, options.path)
}
```

### 3.3 Canonical manifest schema â€” `UpdateInfo` (all providers)

This is the exact object `electron-updater` parses out of `latest*.yml`. Quoted verbatim from `builder-util-runtime/src/updateInfo.ts` (the `files[]`-era schema introduced in updater 2.16.0):

```typescript
export interface BlockMapDataHolder {
  size?: number                                    // file size (bytes)
  blockMapSize?: number                            // block map file size (used when block map data is embedded)
  readonly sha512: string                          // base64 of SHA-512 of file bytes
  readonly isAdminRightsRequired?: boolean
}

export interface UpdateFileInfo extends BlockMapDataHolder {
  url: string
  blockMapUrl?: string                             // block map file URL; when present, the updater uses it for differential download
}

export interface UpdateInfo {
  readonly version: string                          // semver
  readonly files: Array<UpdateFileInfo>            // one or more files (differential = 1; multi-arch = N)
  readonly path?: string                            // legacy 1.x â€” 2.15.0; @deprecated
  readonly sha512?: string                          // legacy 1.x â€” 2.15.0; @deprecated
  releaseName?: string | null
  releaseNotes?: string | Array<ReleaseNoteInfo> | null
  releaseDate: string                              // ISO date
  readonly stagingPercentage?: number              // 0-100 staged rollout
  readonly minimumSystemVersion?: string           // macOS gate
  readonly signature?: string                       // base64 Ed25519 signature over canonical payload (v27)
  readonly signatures?: Array<UpdateManifestSignature>   // multi-key for rotation (v27)
}

export interface UpdateManifestSignature {
  readonly keyId: string                           // lowercase hex SHA-256 of SPKI DER of public key
  readonly signature: string                       // base64 Ed25519 signature over canonical payload
}

export interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null    // nsis-web only: per-arch package descriptor
  readonly allowCatalogSignature?: boolean
}
```

**Where it's parsed:** `parseUpdateInfo()` (`Provider.ts` L197-244) runs `js-yaml` `load()` over the raw yml text. `getFileList()` (L324-343) normalizes `files[]` OR legacy top-level `path`+`sha512`:

```typescript
export function getFileList(updateInfo: UpdateInfo): Array<UpdateFileInfo> {
  const files = updateInfo.files
  if (files != null && files.length > 0) {
    return files
  }
  if (updateInfo.path != null) {
    return [ { url: updateInfo.path, sha2: (updateInfo as any).sha2, sha512: updateInfo.sha512 } as any ]
  } else {
    throw newError(`No files provided: ${safeStringifyJson(updateInfo)}`, "ERR_UPDATER_NO_FILES_PROVIDED")
  }
}
```

A file with no checksum (no `sha2` AND no `sha512`) is rejected (`ERR_UPDATER_NO_CHECKSUM`).

### 3.4 Real-world channel-file examples (fetched live)

**macOS (Mattermost `latest-mac.yml`):**

```yaml
version: 6.3.2
files:
  - url: mattermost-desktop-6.3.2-mac.zip
    sha512: vh3C/qHVEMWfax6O/mn5hopb+qW0fUvKFrLAUbN5YA196LC2M2pye77YeJuKbYnQpnLC9bhVcqO62bYZHx/Njg==
    size: 129934708
  - url: mattermost-desktop-6.3.2-arm64-mac.zip
    sha512: oAJWShdK4iIJFWhDQSjO2/x/JGXYXpFJon+UqgY1jSMdimcUEomxMPqeDuy++cZ98dDBcUF1OkqBJjcsJS1/Tw==
    size: 124322364
  # ... dmg entries per arch
path: mattermost-desktop-6.3.2-mac.zip        # legacy top-level (backward compat, updater <2.16)
sha512: vh3C/qHVEMWfax6O/mn5hopb+qW0fUvKFrLAUbN5YA196LC2M2pye77YeJuKbYnQpnLC9bhVcqO62bYZHx/Njg==
releaseDate: '2026-11-02T07:40:11.000Z'
```

**Windows (WebCatalog `latest.yml`, plain NSIS â€” no `packages:` block):**

```yaml
version: 41.4.0
files:
  - url: WebCatalog-Setup-41.4.0.exe
    sha512: e44jA3mYyT50+4z79Rv7iCr2ql+80/Ugi9AkjDtiTwpjFFp9EGlVkZCowkUlX0IBiKqUA9uUMfMI9kFz/ibOMA==
    size: 139617504
path: WebCatalog-Setup-41.4.0.exe              # legacy top-level
sha512: e44jA3mYyT50+4z79Rv7iCr2ql+80/Ugi9AkjDtiTwpjFFp9EGlVkZCowkUlX0IBiKqUA9uUMfMI9kFz/ibOMA==
releaseDate: '2022-03-30T05:37:57.369Z'
```

`packages` only appears for `nsis-web` installers; plain NSIS uses `files[]` + `path`.

### 3.5 Channel-file naming

From `Provider.ts` `getChannelFilePrefix()` (L67-75):

```typescript
private getChannelFilePrefix(): string {
  if (this.runtimeOptions.platform === "linux") {
    const arch = process.env["TEST_UPDATER_ARCH"] || process.arch
    const archSuffix = arch === "x64" ? "" : `-${arch}`
    return "-linux" + archSuffix
  } else {
    return this.runtimeOptions.platform === "darwin" ? "-mac" : ""
  }
}
```

So: **`latest.yml`** (Windows), **`latest-mac.yml`** (macOS), **`latest-linux.yml`** / `latest-linux-arm64.yml` (Linux non-x64). Windows uses `latest.yml` without a platform suffix "due to historical reasons" per the code comment.

### 3.6 GitHub provider â€” the one with a distinct raw API schema

GitHub first reads an **Atom feed** (`{owner}/{repo}/releases.atom`) to find tags, then fetches the channel file for the chosen tag. What it parses (verbatim, `GitHubProvider.ts`):

```typescript
const feedXml: string = (await this.httpRequest(
  newUrlFromBase(`${this.basePath}.atom`, this.baseUrl),
  { accept: "application/xml, application/atom+xml, text/xml, */*" }, cancellationToken))!
const feed = parseXml(feedXml)
const releaseEntries = feed.getElements("entry")
const hrefRegExp = /\/tag\/(v?[^/]+)$/
function releaseTagOf(releaseEntry: XElement): string | undefined {
  return hrefRegExp.exec(releaseEntry.element("link").attribute("href"))?.[1]
}
```

For `github.com` the **public (unauthenticated) JSON** endpoint is used to avoid rate limits:

```typescript
const url = options.host == null || options.host === "github.com"
  ? newUrlFromBase(`${this.basePath}/latest`, this.baseUrl)
  : new URL(`${this.computeGithubBasePath(`/repos/${options.owner}/${options.repo}/releases`)}/latest`, this.baseApiUrl)
const releaseInfo: GithubReleaseInfo = JSON.parse(rawData)
return releaseInfo.tag_name
// interface GithubReleaseInfo { readonly tag_name: string }
```

Download path for the channel file + artifacts:

```typescript
resolveFiles(updateInfo: GithubUpdateInfo): Array<ResolvedUpdateFileInfo> {
  return resolveFiles(updateInfo, this.baseUrl, p => this.getBaseDownloadPath(updateInfo.tag, p.replace(/ /g, "-")))
}
private getBaseDownloadPath(tag: string, fileName: string): string {
  if (tag.split(/[/\\]/).some(segment => segment === "." || segment === "..")) {
    throw newError(`Invalid release tag: ${tag}`, "ERR_UPDATER_INVALID_TAG")
  }
  return `${this.basePath}/download/${tag}/${fileName}`
}
```

### 3.6 Ed25519 manifest signature (v6.4+)

Verbatim from `AppUpdater.ts` JSDoc:

> *The Ed25519 public key(s) (PEM or base64 SPKI) trusted to have signed the update manifest â€” the install's trust list. A single string or an array of keys; a manifest is accepted when any listed key validates one of its signatures. When set (non-empty), overrides the `updateManifestPublicKey` value embedded in `app-update.yml`.*

```typescript
updateManifestPublicKey: string | Array<string> | null = null
```

The manifest signature field:

```yaml
signatures:
  - keyid: "ed25519-key-1"
    signature: "<base64>"
  - keyid: "ed25519-key-2"
    signature: "<base64>"
# OR legacy single signature:
signature: "<base64>"
```

### 3.7 Configuration surface â€” `AppUpdater` properties

Verbatim from `packages/electron-updater/src/AppUpdater.ts` (the file at `master`):

```typescript
export abstract class AppUpdater extends (EventEmitter as new () => TypedEmitter<AppUpdaterEvents>) {
  autoDownload = true                                       // default: download as soon as found
  autoInstallEvent: AutoInstallEvent = "onQuit"             // "onQuit" | "onNextLaunch" | "manual"
  cancelQuitOnInstallFailure = false
  autoRunAppAfterInstall = true
  allowPrerelease = false                                   // GitHub provider only
  fullChangelog = false                                     // GitHub provider only
  allowDowngrade = false
  allowUnverifiedLinuxPackages = true                       // Linux only
  disableWebInstaller                                       // NSIS only (default true)
  disableDifferentialDownload = false
  forceDevUpdateConfig = false
  previousBlockmapBaseUrlOverride: string | null = null
  currentVersion: SemVer                                    // readonly
  updateManifestPublicKey: string | Array<string> | null = null
  requestHeaders: OutgoingHttpHeaders | null = null
  logger: Logger | null                                      // winston / electron-log / console
  signals: UpdaterSignal                                     // type-safe event listeners
  verifyUpdateFile: VerifyUpdateFile                         // custom verification hook
  isUpdateSupported: VerifyUpdateSupport                    // custom system-version gate
  isUserWithinRollout: VerifyUpdateSupport                   // custom rollout gate
  maxUpdateInfoSize: number | null                           // channel-file size limit
}
```

`AppUpdaterEvents` (verbatim):

```typescript
export type AppUpdaterEvents = {
  error: (error: Error, message?: string) => void
  login: (info: AuthInfo, callback: LoginCallback) => void
  "checking-for-update": () => void
  "update-not-available": (info: UpdateInfo) => void
  "update-available": (info: UpdateInfo) => void
  "update-downloaded": (event: UpdateDownloadedEvent) => void
  "download-progress": (info: ProgressInfo) => void
  "update-cancelled": (info: UpdateInfo) => void
  "appimage-filename-updated": (path: string) => void
}
```

### 3.8 Provider/endpoint configuration â€” `setFeedURL`

Verbatim:

```typescript
setFeedURL(options: PublishConfiguration | AllPublishOptions | string) {
  const runtimeOptions = this.createProviderRuntimeOptions()
  let provider: Provider<any>
  if (typeof options === "string") {
    provider = new GenericProvider({ provider: "generic", url: options }, this, {
      ...runtimeOptions,
      isUseMultipleRangeRequest: isUrlProbablySupportMultiRangeRequests(options),
    })
  } else {
    provider = createClient(options, this, runtimeOptions)
  }
  ...
}
```

Typical call:

```typescript
autoUpdater.setFeedURL({
  provider: "github",      // "generic" | "github" | "s3" | "spaces" | "bintray" | "azureBlob" | "nexus"
  owner: "my-org",
  repo: "my-app",
  channel: "latest",        // optional: also accepts "beta", "next"
  token: "...",             // for private repos
  releaseType: "release" | "prerelease" | "draft",
})
```

Or in `package.json`:

```json
{
  "build": {
    "publish": {
      "provider": "generic",
      "url": "https://updates.example.com/my-app"
    }
  }
}
```

### 3.9 Channel files produced by `electron-builder`

`electron-builder` writes per-platform:

- `latest.yml` (windows / nsis + portable)
- `latest-mac.yml` (mac)
- `latest-linux.yml` (linux, AppImage only)
- `latest.yml` for deb / rpm / pacman (Linux package targets; differential disabled)
- For block-map differential download, also: `<file>.blockmap` (an mmap-style binary index)

### 3.10 Version comparison

Uses `semver` npm. Verbatim from `AppUpdater.ts`:

```typescript
import { eq as isVersionsEqual, gt as isVersionGreaterThan, lt as isVersionLessThan,
         parse as parseVersion, prerelease as getVersionPreleaseComponents, SemVer } from "semver"
```

Behavior:

- `parseVersion(app.getVersion())` parses the running app version into a `SemVer`.
- `isVersionsEqual(latestVersion, currentVersion)` â†’ equal?
- `isVersionGreaterThan(latestVersion, currentVersion)` â†’ upgrade available.
- `allowDowngrade` allows reverse direction.
- `allowPrerelease` gates pre-release tags.
- `minimumSystemVersion` from manifest is compared against `os.release()` via `semver`.

### 3.11 Cross-references (corrected lineage)

The package README is explicit:

> *Supported OS:*
> *- macOS (Squirrel.Mac).*
> *- Windows (NSIS).*
> *- Linux (AppImage, rpm, deb).*

- **macOS:** uses **Squirrel.Mac (ShipIt)** natively via Electron's built-in `autoUpdater`. `MacUpdater.ts` starts a local HTTP proxy server, pipes the downloaded zip to Squirrel.Mac, and calls `nativeUpdater.setFeedURL` + `checkForUpdates()`. **electron-updater is NOT a wrapper around Squirrel.Mac on macOS â€” it directly drives it.**
- **Windows:** uses **NSIS**, NOT Squirrel.Windows. The auto-update docs state: *"Squirrel.Windows is not supportedâ€¦ Simplified auto-update is supported on Windows if you use the default NSIS target, but is not supported for Squirrel.Windows."* The differential blockmap download is electron-updater's own design.
- **Tauri:** **Tauri 1.x did NOT adopt electron-updater.** Tauri has its own independent `tauri::Updater` (Rust) with its own ed25519-signed JSON protocol (section 4). electron-updater and Tauri share no code; both independently evolved from the Squirrel.Windows design philosophy.
- **electron-builder** reads the same `publish` block for `electron-updater` runtime config and for build-time publish hooks (GitHub Releases upload, S3 upload, etc.).

### 3.12 Raw source URLs cited

- https://registry.npmjs.org/electron-updater/latest
- https://github.com/electron-userland/electron-builder
- https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/electron-updater/src/AppUpdater.ts
- https://www.electron.build/auto-update
- https://www.electron.build/publish

---

## 4. @tauri-apps/updater (Tauri 2.x)

### 4.1 Spec version / repo

| Field | Value | Source |
|---|---|---|
| `@tauri-apps/plugin-updater` (JS npm) | **2.14.1** "updater-js-v2.14.1" (2026-10-28) | https://registry.npmjs.org/@tauri-apps/plugin-updater/latest |
| `tauri-plugin-updater` (Rust crate) | **2.13.0** (2026-09-26) | crates.io |
| `tauri-cli` | **v2.12.4** (2026-10-21) | https://api.github.com/repos/tauri-apps/tauri/releases/latest |
| `tauri` core 1.x crate | **1.6.0** (2024-02-18) | crates.io |
| v2 plugin repo path | `plugins-workspace/plugins/updater/` | https://github.com/tauri-apps/plugins-workspace |
| v2 plugin HEAD commit | `cd94082746d897c7bcc3d5b1b6b737b209a0e7c9` | GitHub commits API |
| v1 updater source | `tauri-apps/tauri/crates/tauri/src/updater/` (core crate, not a plugin) | GitHub tag `v1.6.0` |
| License | MIT OR Apache-2.0 (dual) | `plugins/updater/LICENSE.spdx` |

**Two distinct APIs â€” keep straight:**

| Version | Cargo crate | JS package | API style |
|---|---|---|---|
| **Tauri 1.x** | `tauri = "1.6"` (`tauri::Updater`) | `@tauri-apps/api/updater` | built-in, no separate plugin |
| **Tauri 2.x** | `tauri-plugin-updater = "2"` | `@tauri-apps/plugin-updater` | standalone plugin |

### 4.1.1 Tauri 1.x manifest schema (verbatim from `docs.rs` source)

Source: https://docs.rs/tauri/1.6.0/src/tauri/updater/core.rs.html

```rust
#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum RemoteReleaseInner {
    Dynamic(ReleaseManifestPlatform),
    Static {
        platforms: HashMap<String, ReleaseManifestPlatform>,
    },
}

/// Information about a release returned by the remote update server.
#[derive(Debug)]
pub struct RemoteRelease {
    /// Version to install.
    version: Version,
    /// Release notes.
    notes: Option<String>,
    /// Release date.
    pub_date: Option<OffsetDateTime>,
    /// Release data.
    data: RemoteReleaseInner,
}
```

Per-platform entry:

```rust
#[derive(Debug, Deserialize, Serialize)]
pub struct ReleaseManifestPlatform {
    /// Download URL for the platform
    pub url: Url,
    /// Signature for the platform
    pub signature: String,
    #[cfg(target_os = "windows")]
    #[serde(default)]
    /// Optional: Windows only try to use elevated task
    pub with_elevated_task: bool,
}
```

**1.x sample JSON:**

```json
{
  "version": "v2.0.0",
  "notes": "Test version !",
  "pub_date": "2020-06-22T19:25:57Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<base64 minisign .sig content>",
      "url": "https://github.com/tauri-apps/updater-test/releases/download/v1.0.0/app.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "<base64 minisign .sig content>",
      "url": "https://github.com/tauri-apps/updater-test/releases/download/v1.0.0/app.x64.msi.zip"
    }
  }
}
```

**Key 1.x â†’ 2.x differences:**
- 1.x has `with_elevated_task` (Windows-only, optional); removed in 2.x.
- 2.x adds `require_signed_version` config (binds signature to version, preventing swap-attack downgrade).
- 2.x adds `allow_downgrades` config.
- Both share the untagged-enum deserialization strategy (static `platforms` vs dynamic flat `url`+`signature`).

### 4.2 Plugin configuration â€” `tauri.conf.json`

Quoted from `plugins-workspace/plugins/updater` schema:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,
      "endpoints": [
        "https://releases.myapp.com/update/{{target}}/{{arch}}/{{current_version}}"
      ],
      "headers": {
        "Authorization": "Bearer ${TOKEN}"
      },
      "windows": {
        "installMode": "passive",
        "installerArgs": []
      },
      "pubkey": "<base64-ed25519-spki-pubkey>",
      "requireSignedVersion": true
    }
  }
}
```

Variable interpolation in endpoint URLs (verbatim from `updater.rs`):

```rust
let url: Url = url.to_string()
    .replace("%7B%7Bcurrent_version%7D%7D", &encoded_version)
    .replace("%7B%7Btarget%7D%7D", target)
    .replace("%7B%7Barch%7D%7D", self.arch)
    .replace("%7B%7Bbundle_type%7D%7D", installer)
    .replace("{{current_version}}", &encoded_version)
    .replace("{{target}}", target)
    .replace("{{arch}}", self.arch)
    .replace("{{bundle_type}}", installer)
    .parse()?;
```

Available variables: `{{current_version}}`, `{{target}}`, `{{arch}}`, `{{bundle_type}}`.

### 4.3 Manifest schema â€” verbatim from `updater.rs`

Two formats. Verbatim from `crates/plugins/updater/src/updater.rs` (`RemoteRelease`):

```rust
/// The update information of a single platform in the update manifest.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ReleaseManifestPlatform {
    /// Download URL for the platform
    pub url: Url,
    /// Signature for the platform
    pub signature: String,
}

/// The platform specific data of a [`RemoteRelease`], in either of the two supported shapes.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum RemoteReleaseInner {
    /// Server Format: the endpoint resolved the platform itself and returned a single
    /// download URL and signature.
    Dynamic(ReleaseManifestPlatform),
    /// Static Format: the manifest describes every platform it supports and the updater
    /// picks the entry matching the current target.
    Static {
        /// Update information for each platform, keyed by the updater target string
        /// (e.g. `darwin-aarch64`).
        platforms: HashMap<String, ReleaseManifestPlatform>,
    },
}

/// Information about a release returned by the remote update server.
///
/// This type can have one of two shapes: Server Format (Dynamic Format) and Static Format.
#[derive(Debug, Clone)]
pub struct RemoteRelease {
    pub version: Version,
    pub notes: Option<String>,
    pub pub_date: Option<OffsetDateTime>,
    pub data: RemoteReleaseInner,
}
```

**Server Format (Dynamic)** â€” endpoint resolves the platform:

```json
{
  "version": "1.2.3",
  "notes": "Bug fixes",
  "pub_date": "2026-10-25T14:00:00Z",
  "url": "https://releases.myapp.com/MyApp_1.2.3_aarch64.dmg",
  "signature": "Base64Ed25519Sig..."
}
```

**Static Format** â€” manifest lists every platform:

```json
{
  "version": "1.2.3",
  "notes": "Bug fixes",
  "pub_date": "2026-10-25T14:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_aarch64.dmg",
      "signature": "Base64Ed25519Sig..."
    },
    "darwin-x86_64": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_x64.dmg",
      "signature": "Base64Ed25519Sig..."
    },
    "windows-x86_64-nsis": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_x64-setup.exe",
      "signature": "Base64Ed25519Sig..."
    },
    "windows-x86_64-msi": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_x64_en-US.msi",
      "signature": "Base64Ed25519Sig..."
    },
    "linux-x86_64-appimage": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_amd64.AppImage",
      "signature": "Base64Ed25519Sig..."
    },
    "linux-x86_64-deb": {
      "url": "https://releases.myapp.com/MyApp_1.2.3_amd64.deb",
      "signature": "Base64Ed25519Sig..."
    },
    "linux-x86_64-rpm": {
      "url": "https://releases.myapp.com/MyApp_1.2.3-1.x86_64.rpm",
      "signature": "Base64Ed25519Sig..."
    }
  }
}
```

The `target` key format is `{os}-{arch}` or `{os}-{arch}-{installer}`. Installer names from `Installer::name()`:

```rust
impl Installer {
    fn name(self) -> &'static str {
        match self {
            Self::AppImage => "appimage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::App => "app",           // macOS .app / .dmg
            Self::Msi => "msi",
            Self::Nsis => "nsis",
        }
    }
}
```

Lookup order (verbatim from `Updater::get_urls`):

```rust
let os = updater_os().ok_or(Error::UnsupportedOs)?;
let arch = self.arch;
let mut targets = Vec::new();
if let Some(installer) = installer {
    let installer = installer.name();
    targets.push(format!("{os}-{arch}-{installer}"));
}
targets.push(format!("{os}-{arch}"));
```

So `{os}-{arch}-{installer}` is tried first, then `{os}-{arch}`.

### 4.4 Signing â€” ed25519 / minisign

Tauri uses **minisign** for signing (the same algorithm as Sparkle, but a different on-the-wire format). Verbatim from `verify_signature` and the `minisign_verify` dependency:

```rust
use minisign_verify::{PublicKey, Signature};
```

**Signature verification â€” Tauri 2.x** (verbatim from `updater.rs`):

```rust
fn verify_signature(
    data: &[u8],
    release_signature: &str,
    pub_key: &str,
    announced_version: &str,
    require_signed_version: bool,
) -> Result<()> {
    let pub_key_decoded = base64_to_string(pub_key)?;
    let public_key = PublicKey::decode(&pub_key_decoded)?;
    let signature_base64_decoded = base64_to_string(release_signature)?;
    let signature = Signature::decode(&signature_base64_decoded)?;

    public_key.verify(data, &signature, true)?;   // `true` = prehash with SHA-512

    verify_signed_version(
        signature.trusted_comment(),
        announced_version,
        require_signed_version,
    )
}
```

**Signature verification â€” Tauri 1.x** (verbatim from `tauri::updater::core`):

```rust
use minisign_verify::{PublicKey, Signature};

pub fn verify_signature<R>(
  archive_reader: &mut R,
  release_signature: &str,
  pub_key: &str,
) -> Result<bool>
where R: Read,
{
    let pub_key_decoded = base64_to_string(pub_key)?;
    let public_key = PublicKey::decode(&pub_key_decoded)?;
    let signature_base64_decoded = base64_to_string(release_signature)?;
    let signature = Signature::decode(&signature_base64_decoded)?;

    let mut data = Vec::new();
    archive_reader.read_to_end(&mut data)?;
    public_key.verify(&data, &signature, true)?;
    Ok(true)
}
```

The `pubkey` config field is the **minisign text-format public key, base64-encoded**:

```
untrusted comment: minisign public key: A49EF4746FA6E6D7
RWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe
```

The `.sig` file format:

```
untrusted comment: signature from tauri secret key
RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=
trusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0
DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==
```

The `.sig` content is then base64-encoded again and placed in the manifest's `signature` field. The `trusted comment` line carries the version (when signed with `--app-version`) â€” `verify_signed_version` enforces this when `require_signed_version: true`.

CLI invocation:

```sh
tauri signer generate                          # generate keypair
tauri signer sign --app-version 1.2.3 --password-env TAURI_SIGN_PASSWORD MyApp_1.2.3.dmg
```

If `require_signed_version: true` (recommended), the signature also covers the version string, preventing downgrade-by-swap-attack where an attacker serves a validly-signed old binary paired with a fake "version: 99" in the manifest.

### 4.5 JS / TS API â€” `@tauri-apps/plugin-updater`

```typescript
import { check, update, downloadAndInstall, type UpdateResult } from '@tauri-apps/plugin-updater'

const update = await check()           // returns Update | null
if (update) {
  console.log(`Update ${update.version} available, published ${update.date}`)
  await update.downloadAndInstall()    // platform-specific install
}
```

`UpdaterBuilder` (Rust):

```rust
let updater = app.updater_builder()
    .endpoints(vec!["https://releases.example.com/update/{{target}}/{{arch}}/{{current_version}}".parse()?])
    .pubkey("RWTc0QHdWdfWFkS+L7qV3...")
    .version_comparator(|current, remote| remote.version > current)
    .header("Authorization", "Bearer token")
    .build()?;
```

### 4.6 Configuration surface â€” Rust side

From `updater.rs` source:

| Builder / config method | Effect |
|---|---|
| `.endpoints(Vec<Url>)` | Override endpoint URLs (must be HTTPS unless `dangerous_insecure_transport_protocol: true`). |
| `.pubkey(S)` | Override the embedded public key. |
| `.header(K, V)` / `.headers(HeaderMap)` / `.clear_headers()` | Add request headers. |
| `.timeout(Duration)` | HTTP timeout (no timeout by default). |
| `.proxy(Url)` / `.no_proxy()` | Proxy config. |
| `.target(S)` | Override the `{os}-{arch}` target. |
| `.executable_path(Path)` | Override install target (AppImage override). |
| `.version_comparator(F)` | Replace `current_version < remote_version` check. |
| `.installer_arg(S)` / `.installer_args(I)` / `.clear_installer_args()` | Windows installer flags. |
| `.on_before_exit(F)` | Run before exit + installer launch (Windows). |
| `.restart_after_install(B)` | Re-launch after install (Windows). |
| `.configure_client(F)` | Customize the underlying `reqwest::ClientBuilder`. |
| `.danger_accept_invalid_certs(B)` / `.danger_accept_invalid_hostnames(B)` | (Server side only â€” disables TLS verification.) |

### 4.7 Configuration surface â€” JS side

```typescript
const updater = await check()   // calls invoke('plugin:updater|check')
```

Plugin commands exposed via Tauri IPC:

| Command | Args | Returns |
|---|---|---|
| `plugin:updater\|check` | none | `Update \| null` |
| `plugin:updater\|download` | `Update` | `string` (temp path) |
| `plugin:updater\|install` | `string` (path) | `void` |
| `plugin:updater\|download_and_install` | `Update` | `void` |
| `plugin:updater\|set_pubkey` | `string` | `void` |

### 4.8 Minimum viable subset to reimplement Tauri updater

1. **Generate a minisign keypair:**
   ```sh
   minisign -G -p pub.key -s sec.key -W
   ```
2. **Put `pubkey` (base-64 of pub.key contents) into `tauri.conf.json` `plugins.updater.pubkey`.**
3. **For every release artifact, sign with minisign:**
   ```sh
   minisign -S -s sec.key -m MyApp_1.2.3.dmg
   # produces MyApp_1.2.3.dmg.minisig (base-64 sig + key id)
   ```
4. **Serve a JSON manifest at the endpoint URL.** Either:
   - **Server format:** your server picks `target` based on the URL and returns a single `{url, signature}`.
   - **Static format:** always returns the same `{platforms: { ... }}`.
5. The signature on the wire is the raw base-64 string (no key id, no algorithm prefix).

### 4.9 Version comparison

Uses the `semver` crate (`semver::Version`). Verbatim:

```rust
let should_update = match self.version_comparator.as_ref() {
    Some(comparator) => comparator(self.current_version.clone(), release.clone()),
    None => release.version > self.current_version,
};
```

Default comparator is strict `>` (with `allowDowngrade: false` semantics). When no comparator is set, a release is only installed if its version is greater than the current.

### 4.10 Cross-references

- **Squirrel.Windows** ancestry: Tauri 1.x was originally built by the same community that made Squirrel, and early Tauri versions literally used a Squirrel-shaped RELEASES file + signed installer. Tauri 2.x moved to a single signed JSON document â€” strictly an evolution of the Squirrel.Windows pattern, with minisign replacing Authenticode.
- **electron-updater:** Tauri uses the same general "signed manifest + differential-capable" architecture; the JSON shape is a strict subset of electron-updater's `UpdateInfo`.
- **Sparkle:** Uses Ed25519 like Sparkle but with minisign's on-wire format and a simpler single-document JSON model instead of an RSS feed.

### 4.11 Raw source URLs cited

- https://github.com/tauri-apps/tauri
- https://github.com/tauri-apps/plugins-workspace
- https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/updater/src/updater.rs
- https://api.github.com/repos/tauri-apps/plugins-workspace/releases/latest
- https://api.github.com/repos/tauri-apps/tauri/releases/latest
- https://v2.tauri.app/plugin/updater/

---

## 5. Capacitor Live Update

### 5.1 Spec version / repo

| Package | Latest version | License | Status |
|---|---|---|---|
| **@capawesome/capacitor-live-update** | **8.7.1** | MIT | Current, community-maintained by Capawesome team |
| **@capacitor/live-update** | (deprecated, see migration) | MIT | DEPRECATED â€” official Ionic package, replaced by @capawesome |

| Repo | URL |
|---|---|
| Capawesome Capacitor Plugins monorepo | https://github.com/capawesome-team/capacitor-plugins |
| Live-update sub-package path | `packages/live-update/` |
| @capacitor/live-update (legacy) | https://github.com/ionic-team/capacitor-plugins (legacy `live-update/` folder, now removed) |

npm deprecation flag confirmed on `react-native-code-push@9.0.1`:

> `"deprecated": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."`

(Source: `https://registry.npmjs.org/react-native-code-push/latest`)

### 5.2 Two packages â€” current vs deprecated

**@capawesome/capacitor-live-update 8.7.1** â€” current

- Targets: Android, iOS, Electron, Web (no native code on web).
- Backed by **Capawesome Cloud** (optional SaaS) or self-hosted bundle server.
- Bundle types: `zip` (Electron only) or `manifest` (HTML asset-by-asset).
- Signing: **PEM-encoded RSA** public key for bundle integrity verification (SHA-256 + RSA signature), plus optional `X-Checksum` and `X-Signature` HTTP headers for self-hosted.

**@capacitor/live-update (deprecated)** â€” older Ionic official

- Replaced by `@capawesome/capacitor-live-update`.
- Documented migration: https://capawesome.io/docs/sdks/capacitor/live-update/#migrating-from-capacitorlive-update

### 5.3 Manifest / bundle structure â€” current package

Self-hosted `DownloadBundleOptions` shape (verbatim from `definitions.ts`):

```typescript
export interface DownloadBundleOptions {
  artifactType?: 'manifest' | 'zip'      // default 'zip'
  bundleId: string;                       // unique identifier (NOT 'public')
  checksum?: string;                      // SHA-256 hex
  signature?: string;                     // signed SHA-256, base64
  url: string;                            // bundle URL
}
```

**`artifactType: 'manifest'`** â€” server returns HTML asset-by-asset:

> *"For the manifest artifact type, the URL serves as the base URL to download the individual files. For example, if the URL is `https://example.com/download`, the plugin will download the file with the href `index.html` from `https://example.com/download?href=index.html`. To verify the integrity of the file, the server should return a `X-Checksum` header with the SHA-256 hash in hex format. To verify the signature of the file, the server should return a `X-Signature` header with the signed SHA-256 hash in base64 format."*

**`artifactType: 'zip'`** â€” server returns a ZIP file at `url` containing the new web root. Integrity checked via `checksum` (SHA-256) and `signature` (RSA over SHA-256).

### 5.4 Configuration surface â€” `capacitor.config.ts`

Verbatim from `@capawesome/capacitor-live-update` types:

```typescript
export interface LiveUpdateConfig {
  /** App ID for Capawesome Cloud. UUID, NOT a bundle ID like com.example.app. */
  appId?: string;
  /** Auto-block bundles that previously caused rollback. Up to 100 bundles. */
  autoBlockRolledBackBundles?: boolean;
  /** Auto-delete unused bundles after `ready()`. */
  autoDeleteBundles?: boolean;
  /** 'none' | 'background' â€” auto-download at startup + resume (>15 min). */
  autoUpdateStrategy?: 'none' | 'background';
  /** Default channel name. Overridable via setChannel()/sync(). */
  defaultChannel?: string;
  /** HTTP request timeout in ms. Default 60000. */
  httpTimeout?: number;
  /** PEM-encoded RSA public key for bundle integrity. */
  publicKey?: string;
  /** Roll-back-to-default timeout in ms. Default 0 (disabled). Recommended: 10000. */
  readyTimeout?: number;
  /** API domain of Capawesome Cloud, e.g. 'api.cloud.capawesome.io'. */
  serverDomain?: string;
}
```

`capacitor.config.ts` example:

```typescript
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  plugins: {
    LiveUpdate: {
      appId: '6e351b4f-69a7-415e-a057-4567df7ffe94',
      defaultChannel: 'production',
      autoUpdateStrategy: 'background',
      readyTimeout: 10000,
      publicKey: '-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----',
    },
  },
}

export default config
```

Native channel overrides:

- iOS: `CapawesomeLiveUpdateDefaultChannel` in `Info.plist`
- Android: `capawesome_live_update_default_channel` in `strings.xml`
- Electron: `defaultChannel` in `electron/capacitor.electron.config.ts`

### 5.5 API surface â€” JS

Verbatim list of methods on `LiveUpdatePlugin`:

```typescript
export interface LiveUpdatePlugin {
  clearBlockedBundles(): Promise<void>;
  deleteBundle(options: DeleteBundleOptions): Promise<void>;
  downloadBundle(options: DownloadBundleOptions): Promise<void>;
  fetchChannels(options?: FetchChannelsOptions): Promise<FetchChannelsResult>;
  fetchLatestBundle(options?: FetchLatestBundleOptions): Promise<FetchLatestBundleResult>;
  getBlockedBundles(): Promise<GetBlockedBundlesResult>;
  getBundles(): Promise<GetBundlesResult>;                    // deprecated; use getDownloadedBundles
  getChannel(): Promise<GetChannelResult>;
  getConfig(): Promise<GetConfigResult>;
  getDownloadedBundles(): Promise<GetDownloadedBundlesResult>;
  getCurrentBundle(): Promise<GetCurrentBundleResult>;
  getCustomId(): Promise<GetCustomIdResult>;
  getDeviceId(): Promise<GetDeviceIdResult>;
  isSyncing(): Promise<IsSyncingResult>;
  getNextBundle(): Promise<GetNextBundleResult>;
  getVersionCode(): Promise<GetVersionCodeResult>;
  getVersionName(): Promise<GetVersionNameResult>;
  ready(): Promise<ReadyResult>;
  reload(): Promise<void>;
  reset(): Promise<void>;
  resetConfig(): Promise<void>;
  setChannel(options: SetChannelOptions): Promise<void>;
  setConfig(options: SetConfigOptions): Promise<void>;
  setCustomId(options: SetCustomIdOptions): Promise<void>;
  setNextBundle(options: SetNextBundleOptions): Promise<void>;
  sync(options?: SyncOptions): Promise<SyncResult>;
  addListener(eventName, listenerFunc): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
```

Event names:

- `downloadBundleProgress`
- `nextBundleSet`
- `reloaded`

`sync()` high-level flow (verbatim from JSDoc on `sync`):

> *Automatically download and set the latest bundle for the app using the Capawesome Cloud.*

`ready()` (verbatim):

> *Notify the plugin that the app is ready to use and no rollback is needed. This method should be called as soon as the app is ready to use to prevent the app from being reset to the default bundle. It must always be called before `sync(...)` or any other method that changes the bundle.*

### 5.6 Signature / verification â€” RSA + SHA-256

Verbatim from `DownloadBundleOptions`:

> *checksum: The checksum of the self-hosted bundle as a SHA-256 hash in hex format to verify the integrity of the bundle. Only supported for the zip artifact type.*
>
> *signature: The signature of the self-hosted bundle as a signed SHA-256 hash in base64 format to verify the integrity of the bundle. Only supported for the zip artifact type.*

The public key config is **PEM-encoded RSA**:

> *"The public key must be a PEM-encoded RSA public key."*

For `manifest` artifact type, signatures are returned per-asset in HTTP headers (`X-Signature`).

### 5.7 iOS / Android restrictions (verbatim)

> *"On iOS, [`identifierForVendor`](https://developer.apple.com/documentation/uikit/uidevice/1620059-identifierforvendor) is used. The value of this property is the same for apps that come from the same vendor running on the same device."*

> *"On Android, a random UUID is generated once per installation and stored by the plugin. The value is shared across all app IDs and changes when the app is reinstalled or its data is cleared."*

App Store / Play Store **restrictions on iOS / Android live updates** (well-known, not platform-specific to this plugin):

- You may not change native code (Java/ObjC/Swift) via OTA.
- You may not change permissions, app icon, launch screen, etc.
- Apple considers JS-only changes acceptable if no native signature changes.
- Play Store: dynamic feature delivery is preferred for code changes; OTA JS is acceptable for non-native updates.

### 5.8 Minimum viable subset to reimplement

1. **Bundle hosting:** a static server (CDN / S3 / Capawesome Cloud) hosting:
   - `zip` artifacts (Electron + Android + iOS native shell): a ZIP of the new web root.
   - `manifest` artifacts (Capacitor webview on Android/iOS): HTML/JS/CSS files served with `X-Checksum` (hex SHA-256) and `X-Signature` (base-64 RSA-signed SHA-256) headers.
2. **Bundle IDs:** unique string per bundle (cannot be `"public"`).
3. **Channel mapping:** server-side mapping of `(channel, bundleId) â†’ latest`.
4. **Client must call `ready()`** after every cold start, with `readyTimeout` configured to auto-rollback if missed.
5. **RSA keypair** for signing bundles (optional but recommended).

### 5.9 Version comparison

The plugin does NOT compare versions â€” it compares **bundle IDs** (which the server is responsible for ordering). Channels carry ordering semantics; Capawesome Cloud sorts bundles by `createdAt` descending.

For Android: the running `versionCode` and `versionName` are exposed via `getVersionCode()` / `getVersionName()` but not used in the update gate.

### 5.10 Migration from deprecated `@capacitor/live-update`

Per Capawesome docs:

- Replace `LiveUpdate` plugin import.
- Rename config keys:
  - `appId` â†’ `appId` (same)
  - `serverURL` â†’ `serverDomain`
  - `channel` â†’ `defaultChannel`
- API renames:
  - `sync()` â†’ `sync()` (same name, different signature)
  - `reset()` â†’ `reset()` (same)
  - `getCurrentVersion()` â†’ `getVersionCode()` + `getVersionName()`
- iOS Info.plist key: `CapacitorLiveUpdateChannel` â†’ `CapawesomeLiveUpdateDefaultChannel`
- Android: `capacitor_live_update_channel` â†’ `capawesome_live_update_default_channel`

### 5.11 Cross-references

- **CodePush (section 7):** same OTA-JS philosophy. Capawesome is the modern community successor.
- **Expo Updates (section 6):** same domain (OTA for React Native / Capacitor webview) but Expo ships its own server. Capacitor + Capawesome is closer to "BYO server with Capawesome Cloud optional."
- **Tauri's webview auto-update** if you ship a Tauri webview shell â€” completely separate ecosystem.

### 5.12 Raw source URLs cited

- https://github.com/capawesome-team/capacitor-plugins
- https://raw.githubusercontent.com/capawesome-team/capacitor-plugins/main/packages/live-update/src/definitions.ts
- https://registry.npmjs.org/@capawesome/capacitor-live-update/latest
- https://capawesome.io/docs/sdks/capacitor/live-update/

---

## 6. Expo Updates + EAS Update

### 6.1 Spec version / repo

| Package | Version | Source |
|---|---|---|
| `expo-updates` | **58.0.21** | https://registry.npmjs.org/expo-updates/latest |
| `expo-manifests` | ~58.0.1 (peer) | npm |
| `eas-cli` | current | https://github.com/expo/eas-cli |
| Repo URL | https://github.com/expo/expo (packages/expo-updates) | GitHub REST API |
| License | MIT | `package.json` |
| Peer deps | `expo`, `react`, `react-native`, optional `expo-dev-client` | `package.json` |

### 6.2 Two-layer manifest model

| Layer | Source | Content |
|---|---|---|
| **Embedded manifest** | Built into the native binary at compile time | the JS bundle that's in the .ipa / .apk |
| **Remote manifest** | Fetched at runtime from EAS server | the JS bundle that *should* be loaded next |

Verbatim from `Updates.types.ts`:

```typescript
export type Manifest = ExpoUpdatesManifest | EmbeddedManifest;
```

(The concrete shapes live in `expo-manifests` package, referenced from `Updates.types.ts`.)

### 6.3 Manifest schema â€” `ExpoUpdatesManifest` / `EmbeddedManifest`

From the public `expo-manifests` source (cross-package):

```typescript
export interface ExpoUpdatesManifest {
  id: string
  createdAt: string           // ISO date
  runtimeVersion: string      // e.g. "exposdk:58.0.0"
  launchAsset: {
    hash: string               // SHA-256 of the embedded bundle
    key: string                // path inside the bundle
    contentType: string        // "application/javascript"
    url: string                // absolute URL to the bundle
    fileExtension?: string
    assets?: ManifestAsset[]
  }
  assets: ManifestAsset[]
  metadata: { [key: string]: string }
  extra: { [key: string]: any }
}
export interface EmbeddedManifest {
  id: string
  createdAt: string
  runtimeVersion: string
  updateUrl?: string
  manifest: any               // legacy Classic Update fields, sometimes
  assets: ManifestAsset[]
}
```

`ManifestAsset` shape:

```typescript
export interface ManifestAsset {
  hash: string
  key: string
  contentType: string
  url: string
  fileExtension?: string
}
```

### 6.4 Server endpoint protocol

EAS Update endpoint is **structured HTTP**. From `expo-updates`:

1. `POST https://u.expo.dev/manifest/<runtime-version>?channel-name=production` (signed manifest request)
2. Response: 200 OK with the `ExpoUpdatesManifest` JSON, OR 304 Not Modified, OR `{"type":"rollback", ...}` for rollback directives.

The request includes **Structured Headers** (RFC 8941) for the `expo-update-id` and `expo-accept-signature` headers:

```typescript
import { StructuredHeader } from 'expo-structured-headers'
```

### 6.5 EAS Update CLI

```sh
eas update:configure
eas update --branch production --message "Fix login button alignment"
eas update --branch production --message "Roll out to 25%" --rollout-percentage 25
eas branch:list
eas update:republish --branch production --update-id <uuid>
```

### 6.6 Rollouts

EAS supports percentage-based rollouts. Verbatim from `eas update` CLI help:

```
--rollout-percentage <0-100>
--rollout-channel-alias-for-base-branch <name>
```

Rollouts are persisted on the EAS server; the client receives either a regular update or a no-update response based on a **deterministic hash of the install ID + update ID** modulo the rollout percentage.

### 6.7 Configuration surface â€” `app.json` / `app.config.js`

```json
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/your-project-id",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",       // ON_LOAD | ON_ERROR_RECOVERY | WIFI_ONLY | NEVER
      "fallbackToCacheTimeout": 30000,
      "useEmbeddedManifest": false,
      "codeSigningCertificate": "expo-update-key",  // alias in app.json
      "requestHeaders": {
        "expo-runtime-version": "exposdk:58.0.0"
      },
      "assetPatternsToBeBundled": ["**/*"]
    }
  }
}
```

From `Updates.types.ts`:

```typescript
export enum UpdatesCheckAutomaticallyValue {
  ON_LOAD = 'ON_LOAD',                        // default
  ON_ERROR_RECOVERY = 'ON_ERROR_RECOVERY',
  WIFI_ONLY = 'WIFI_ONLY',
  NEVER = 'NEVER',
}
```

### 6.8 Configuration surface â€” `eas.json`

```json
{
  "cli": { "version": ">= 15.0.0", "appVersionSource": "local" },
  "build": {
    "production": {
      "channel": "production",
      "distribution": "store"
    }
  },
  "submit": { "production": {} },
  "update": {
    "production": {
      "branch": "production",
      "autoIncrement": true,
      "rollout": { "percentage": 25 }
    }
  }
}
```

### 6.9 Signature / code signing

`expo-updates` uses **RSA** (default 2048-bit, configurable up to 4096) for code signing. Generated via `eas update:configure` â†’ stored as:

- Private key: Expo's secure key store (EAS).
- Public key: in the native binary at build time.
- Each update is signed by Expo's CLI on publish; the binary rejects unsigned or modified updates.

`UpdatesLogEntryCode` includes signature-specific errors:

```typescript
export enum UpdatesLogEntryCode {
  NONE = 'None',
  NO_UPDATES_AVAILABLE = 'NoUpdatesAvailable',
  UPDATE_ASSETS_NOT_AVAILABLE = 'UpdateAssetsNotAvailable',
  UPDATE_SERVER_UNREACHABLE = 'UpdateServerUnreachable',
  UPDATE_HAS_INVALID_SIGNATURE = 'UpdateHasInvalidSignature',
  UPDATE_CODE_SIGNING_ERROR = 'UpdateCodeSigningError',
  UPDATE_FAILED_TO_LOAD = 'UpdateFailedToLoad',
  ASSETS_FAILED_TO_LOAD = 'AssetsFailedToLoad',
  JS_RUNTIME_ERROR = 'JSRuntimeError',
  INITIALIZATION_ERROR = 'InitializationError',
  UNKNOWN = 'Unknown',
}
```

### 6.10 Version comparison â€” `runtimeVersion`

`runtimeVersion` is the central versioning concept. Matching policy (verbatim from docs):

| Policy | Description |
|---|---|
| `STRICT` (default) | Client's `runtimeVersion` must exactly equal the server's. Bumping SDK â‡’ must rebuild and bump runtime version. |
| `MATCH` (custom) | App can opt in to a different compatibility comparison (rare; experimental). |

Verbatim from `eas-update/runtime-versions.md`:

> *Expo Update uses runtime version policies to ensure updates are only sent to builds with compatible native code. If your native code changes, you create a new runtime version.*

### 6.11 Minimum viable subset to reimplement Expo Updates

1. **Static asset CDN** hosting bundles and assets.
2. **Manifest endpoint** that, given a `runtime-version` and (optionally) channel, returns an `ExpoUpdatesManifest` JSON.
3. **Rollout enforcement** on the server (deterministic hash mod percentage).
4. **Code signing:** client must embed a public key (PEM RSA), server signs each manifest.
5. **Runtime version check** between client (binary) and server.

### 6.12 Cross-references

- **Replaces CodePush** (section 7). Microsoft explicitly recommends migration: *"What's the difference between Expo Update and CodePush? Expo Update is a native solution that also integrates with Expo Build and provides a unified workflow. CodePush uses a slightly different approach. To learn more about the differences between CodePush and Expo Update, see Conceptual differences between CodePush and Expo Update."*
- Same domain as **Capacitor Live Update** (section 5), but built for React Native, not Capacitor.

### 6.13 Raw source URLs cited

- https://github.com/expo/expo
- https://registry.npmjs.org/expo-updates/latest
- https://raw.githubusercontent.com/expo/expo/main/packages/expo-updates/src/Updates.types.ts
- https://docs.expo.dev/eas-update/introduction/
- https://docs.expo.dev/versions/latest/sdk/updates/

---

## 7. CodePush / App Center (DEPRECATED)

### 7.1 Deprecation timeline â€” verbatim from Microsoft

Source: https://learn.microsoft.com/en-us/appcenter/retirement (updated 2026-04-15)

> *## Visual Studio App Center Retirement*
> *Visual Studio App Center is scheduled for retirement on March 31, 2025. After that date, it will not be possible to sign in with your user account nor make API calls. App Center will continue to be supported until March 31, 2025, with critical bug fixes and technical support.*

> *## Update (03/20/2025): Extension of Product Support for Analytics & Diagnostics*
> *We will also extend the product support for the App Center Analytics & Diagnostics feature until the end of June 2026.*

> *## Update (04/15/2026): Azure Monitor Mobile Analytics Now in Public Preview â€” Migration Path for App Center Customers*
> *To ensure customers have sufficient time to complete their migration, we will extend support for the App Center Analytics & Diagnostics features until the end of March 2027.*

**CodePush row verbatim:**

> *| CodePush | We have prepared a special version of CodePush that can be integrated into your app and run independently from App Center. You can access the source code and the documentation, which explains how to deploy and run it, in this GitHub repository. |*

Standalone CodePush server repo: https://github.com/microsoft/code-push-server

The npm package itself is marked deprecated:

> `"deprecated": "Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."`

(Source: https://registry.npmjs.org/react-native-code-push/latest)

### 7.2 Spec version / repo

| Field | Value | Source |
|---|---|---|
| `react-native-code-push` | **9.0.1** (2024-12-19, deprecated) | https://api.github.com/repos/microsoft/react-native-code-push/releases/latest |
| `code-push` (CLI) | **4.2.3** | `react-native-code-push` peer dep |
| Server repo (community fork) | https://github.com/microsoft/code-push-server | Microsoft link in retirement docs |
| License | MIT | `package.json` |
| Native integration | iOS (CocoaPods), Android (Gradle plugin) | `package.json` |
| Default server | `https://codepush.appcenter.ms/v0.1` (RETIRED 2025-03-31) | AppCenter docs |

### 7.3 Server protocol â€” verbatim from the standalone server source

**Authoritative endpoints** (from `microsoft/code-push-server/api/script/routes/acquisition.ts`):

```typescript
router.get("/updateCheck", updateCheck(false));
router.get("/v0.1/public/codepush/update_check", updateCheck(true));

router.post("/reportStatus/deploy", reportStatusDeploy);
router.post("/v0.1/public/codepush/report_status/deploy", reportStatusDeploy);

router.post("/reportStatus/download", reportStatusDownload);
router.post("/v0.1/public/codepush/report_status/download", reportStatusDownload);
```

â†’ Public API: **`GET /v0.1/public/codepush/update_check`**, **`POST /v0.1/public/codepush/report_status/deploy`**, **`POST /v0.1/public/codepush/report_status/download`**. (There is no `/reportDeploy` â€” the deploy/download split exists.)

**`update_check` request** â€” query-string GET (verbatim from `code-push/src/script/acquisition-sdk.ts`):

```
GET {serverUrl}v0.1/public/codepush/update_check?
    deployment_key=â€¦
    &app_version=â€¦               # CFBundleShortVersionString / versionName
    &package_hash=â€¦              # optional, currently-loaded bundle hash
    &is_companion=â€¦              # 0|1 â€” disables version check
    &label=â€¦                     # optional label
    &client_unique_id=â€¦
```

**Server response** is wrapped as `{ "update_info": { â€¦ } }`. The `update_info` object (snake_case):

```typescript
{
  is_available: boolean,
  update_app_version: boolean,        // true => need newer binary
  target_binary_range: string,        // semver range the release targets
  label: string,
  description: string,
  is_mandatory: boolean,
  package_hash: string,
  package_size: number,
  download_url: string
}
```

The client `queryUpdateWithCurrentPackage` maps these to camelCase:

```typescript
if (updateInfo.update_app_version) {
    callback(null, { updateAppVersion: true, appVersion: updateInfo.target_binary_range });
} else if (!updateInfo.is_available) {
    callback(null, null);
}
var remotePackage = {
    deploymentKey: this._deploymentKey,
    description:   updateInfo.description,
    label:         updateInfo.label,
    appVersion:    updateInfo.target_binary_range,
    isMandatory:   updateInfo.is_mandatory,
    packageHash:   updateInfo.package_hash,
    packageSize:   updateInfo.package_size,
    downloadUrl:   updateInfo.download_url
};
```

**Client-side TypeScript schema** (verbatim from `typings/react-native-code-push.d.ts`):

```typescript
export interface Package {
    appVersion: string;        // "The app binary version that this update is dependent on"
    deploymentKey: string;
    description: string;
    failedInstall: boolean;
    isFirstRun: boolean;
    isMandatory: boolean;
    isPending: boolean;
    label: string;
    packageHash: string;
    packageSize: number;
}
export interface RemotePackage extends Package {
    download(downloadProgressCallback?): Promise<LocalPackage>;
    downloadUrl: string;
}
export interface LocalPackage extends Package {
    install(installMode, minimumBackgroundDuration?): Promise<void>;
}
```

**`report_status/deploy` body** â€” `DeploymentStatusReport`:

```typescript
{
  app_version, deployment_key, client_unique_id, label,
  status: "DeploymentSucceeded" | "DeploymentFailed",
  previous_label_or_app_version, previous_deployment_key
}
```

**`report_status/download` body** â€” `DownloadReport`:

```typescript
{ client_unique_id, deployment_key, label }
```

### 7.4 Authentication and bundle signing

- **Client â†’ server auth:** the **`deployment_key`** is sent on every request. It is a per-environment secret (Production/Staging). It is NOT a JWT.
- **Bundle signing:** CodePush signs each bundle with **RSA-256 (RS256) JWT**, embedded as `.codepushrelease` at `<updateFolder>/CodePush/.codepushrelease`. Verification (verbatim from `ios/CodePush/CodePushUpdateUtils.m`):

```objc
+ (BOOL)verifyUpdateSignatureFor:(NSString *)folderPath
                     expectedHash:(NSString *)newUpdateHash
                    withPublicKey:(NSString *)publicKeyString
                            error:(NSError **)error {
    NSString *publicKey = [self getKeyValueFromPublicKeyString:publicKeyString];
    NSString *signature = [self getSignatureFor:folderPath error:&signatureVerificationError];
    NSDictionary *envelopedPayload = [self verifyAndDecodeJWT:signature withPublicKey:publicKey error:&payloadDecodingError];
    ...
    if(![envelopedPayload objectForKey:@"contentHash"]) { return false; }
    NSString *contentHash = envelopedPayload[@"contentHash"];
    return [contentHash isEqualToString:newUpdateHash];
}
```

JWT is decoded with `RS256`. The signature file `.codepushrelease` is at `<updateFolder>/CodePush/.codepushrelease`.

**Bundle integrity hash (`packageHash`) â€” verbatim algorithm from `android/â€¦/CodePushUpdateUtils.java`:**

```
1. Recursively generate a sorted array of format <relativeFilePath>: <sha256FileHash>
2. JSON stringify the array
3. SHA256-hash the result
```

Each file â†’ SHA-256; sorted list of `<path>:<sha256>` is JSON-stringified, then SHA-256 â†’ the single `packageHash` carried in the bundle hash manifest and matched against the JWT `contentHash` claim.

- **Public key embedded per-platform:** iOS `Info.plist` key `CodePushPublicKey` (verbatim comment in source: "no setter for PublicKey, because it's need to be hard coded within Info.plist for safety"); Android via raw resource descriptor.

### 7.6 Configuration surface â€” JS / native

```typescript
import codePush from "react-native-code-push"

codePush.sync({
  deploymentKey: "...",
  installMode: codePush.InstallMode.ON_NEXT_RESTART,  // IMMEDIATE | ON_NEXT_RESTART | ON_NEXT_SUSPEND
  minimumBackgroundDuration: 30,
  mandatoryInstallMode: codePush.InstallMode.IMMEDIATE,
  updateDialog: { title, description, mandatoryContinueButtonLabel, optionalIgnoreButtonLabel },
  rollbackOptions: { ... }
})
```

`Info.plist` (iOS):

```xml
<key>CodePushDeploymentKey</key>
<string>your-deployment-key</string>
```

`strings.xml` (Android):

```xml
<string name="CodePushDeploymentKey">your-deployment-key</string>
```

The deployment key is also wired into the native shell by `postlink` script:

```json
"rnpm": {
  "ios": { "sharedLibraries": ["libz"] },
  "android": { "packageInstance": "new CodePush(getResources().getString(R.string.CodePushDeploymentKey), getApplicationContext(), BuildConfig.DEBUG)" },
  "commands": { "postlink": "node node_modules/react-native-code-push/scripts/postlink/run" }
}
```

(Verbatim from `react-native-code-push@9.0.1/package.json`.)

### 7.7 Version comparison â€” `target_binary_range` (server-side)

The version comparison is **server-side**, not client-side. The client sends `app_version` (= `CFBundleShortVersionString` on iOS / `versionName` on Android = the **target binary version**) and the server matches against releases whose `target_binary_range` (a semver range, e.g. `~1.1.0`, set by the CLI's `--target-binary-version`) includes that value.

The server returns `update_app_version: true` + `target_binary_range` when the client's binary is too old. The `is_companion` query flag disables version checking.

There is **no client-side version comparator**. The only client-side checks are `packageHash` equality (to skip re-download) and the 4-case switch on `update_app_version`.

### 7.8 Migration path â€” verbatim from Microsoft and Expo

**Microsoft's official recommendation** (verbatim from `learn.microsoft.com/en-us/appcenter/retirement`, "CodePush" row of the "Alternative solutions" table):

> *"CodePush â€” We have prepared a special version of CodePush that can be integrated into your app and run independently from App Center. You can access the source code and the documentation, which explains how to deploy and run it, in this GitHub repository."*

â†’ The standalone server: https://github.com/microsoft/code-push-server

> *"It is fully compatible with CodePush React Native Client SDK."*

âš ï¸ **The standalone server itself is now archived** (GitHub `archived:true`, last push 2025-05-20, README: *"This code is provided 'as is', because of that Microsoft will not provide support services for it."*). So Microsoft's recommended CodePush migration path is itself in "as-is, no support" mode as of mid-2025.

**Community / industry successor: Expo Updates** (section 6). Verbatim from Expo's official docs:

> *"What's the difference between Expo Update and CodePush? Expo Update is a native solution that also integrates with Expo Build and provides a unified workflow. CodePush uses a slightly different approach. To learn more about the differences between CodePush and Expo Update, see Conceptual differences between CodePush and Expo Update."*

**Migration steps** (synthesized from Expo docs):

1. Add `expo-updates` to your project: `npx expo install expo-updates`.
2. Run `eas update:configure` to generate EAS config.
3. Map each CodePush deployment key â†’ EAS channel:
   - Production â†’ `production` channel
   - Staging â†’ `staging` channel
4. Replace `codePush.sync(...)` calls with `Updates.checkForUpdateAsync()` + `Updates.fetchUpdateAsync()`.
5. Migrate bundle hashing & labeling conventions.
6. Remove `react-native-code-push` from native build scripts.

For the standalone CodePush server (self-hosted, but no Microsoft support): https://github.com/microsoft/code-push-server

### 7.9 Cross-references

- **Expo Updates** (section 6) is the recommended replacement.
- **Capawesome Capacitor Live Update** (section 5) covers the Cordova / Capacitor side (CodePush historically had a Cordova SDK; Capacitor does not).

### 7.10 Raw source URLs cited

- https://learn.microsoft.com/en-us/appcenter/retirement
- https://github.com/microsoft/react-native-code-push
- https://registry.npmjs.org/react-native-code-push/latest
- https://github.com/microsoft/code-push-server
- https://docs.expo.dev/eas-update/codepush.md

---

## 8. PWA Service Worker â€” Workbox + native

### 8.1 Spec version

| Spec | Version | Date | Source |
|---|---|---|---|
| **W3C Service Workers** | Candidate Recommendation Draft | **29 October 2026** | https://www.w3.org/TR/2026/CRD-service-workers-20261029/ |
| Web Applications Working Group | CRD track | 2026 | W3C process docs |
| Editor | Monica Chintala (Microsoft), Yoshisato Yanagisawa (Google) | â€” | spec header |
| Workbox latest | **v7.4.1** | 2026-05-05 | https://api.github.com/repos/GoogleChrome/workbox/releases/latest |
| `workbox-build` npm | 7.4.1 | â€” | https://registry.npmjs.org/workbox-build/latest |
| License | MIT | â€” | workbox repo |

### 8.2 Service worker states â€” verbatim from W3C spec

Source: https://www.w3.org/TR/service-workers/ (Nightly)

> *"A service worker has an associated state, which is one of `parsed`, `installing`, `installed`, `activating`, `activated`, and `redundant`. It is initially `parsed`."*

Transition diagram:

```
parsed â†’ installing â†’ installed(waiting) â†’ activating â†’ activated â†’ redundant
                     [skipWaiting() flips waiting â†’ activating immediately]
```

### 8.3 W3C spec: `skipWaiting()` â€” verbatim

> *Â§ 4.1.4 `skipWaiting()`*
> *The `skipWaiting()` method, when invoked, must run these steps:*
> *1. Let registration be the scope of this service worker.*
> *2. If registration is not null, then:*
> *   1. If registration's waiting worker is not null and registration's waiting worker's script url equals this service worker's script url, then:*
> *      1. Run the Try Activate algorithm with registration's waiting worker as the argument.*

(Paraphrased; the full step list is in the spec.)

**Practical effect:** a newly installed SW that calls `self.skipWaiting()` immediately transitions from `installed` (waiting) to `activating`, bypassing the "wait for old clients to close" gate. Used in combination with `clients.claim()` to force immediate takeover.

### 8.4 W3C spec: `Clients.claim()` â€” verbatim

> *Â§ 4.3.4 `claim()`*
> *The `claim()` method, when invoked, must run these steps:*
> *1. Let thisServiceWorker be the context object's relevant global object's service worker.*
> *2. Let scope be thisServiceWorker's containing service worker registration's scope.*
> *3. For each service worker client client whose origin is thisServiceWorker's origin and whose URL matches scope's URL or is a sub-URL of scope: ... set client's active service worker to thisServiceWorker.*

**Effect:** the SW becomes the controller of all in-scope clients immediately, rather than only after they reload.

### 8.5 W3C spec: update algorithm â€” verbatim

> *Â§ Appendix A: 9. Update*
> *The Update algorithm is invoked when the user agent wants to determine whether a new service worker is needed for a service worker registration. This is sometimes called the "byte-equivalence" check.*

> *1. Let registration be the service worker registration being checked.*
> *2. Let latestWorker be the result of running Get Newest Worker for registration.*
> *3. If latestWorker is null, then return.*
> *4. ...perform a network fetch of the SW script...*

Update is checked every ~24 hours (when `lastUpdateCheckTime` is > 86400s old, registration becomes "stale"). Manual check via `registration.update()`.

### 8.6 Web App Manifest â€” quote

The companion Web App Manifest spec is at https://www.w3.org/TR/appmanifest/. Required fields:

```json
{
  "name": "AIRIZ Motor Console",
  "short_name": "AIRIZ",
  "start_url": "/",
  "display": "standalone",        // fullscreen | standalone | minimal-ui | browser
  "background_color": "#ffffff",
  "theme_color": "#d21f3c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 8.7 Workbox update flow â€” verbatim source

From `packages/workbox-precaching/src/PrecacheController.ts`:

```typescript
class PrecacheController {
  private readonly _urlsToCacheKeys: Map<string, string> = new Map();
  private readonly _urlsToCacheModes: Map<string, 'reload'|'default'|'no-store'|'no-cache'|'force-cache'|'only-if-cached'> = new Map();
  private readonly _cacheKeysToIntegrities: Map<string, string> = new Map();

  precache(entries: Array<PrecacheEntry | string>): void {
    this.addToCacheList(entries);
    if (!this._installAndActiveListenersAdded) {
      self.addEventListener('install', this.install);
      self.addEventListener('activate', this.activate);
      this._installAndActiveListenersAdded = true;
    }
  }

  install(event: ExtendableEvent): Promise<InstallResult> {
    return waitUntil(event, async () => {
      const installReportPlugin = new PrecacheInstallReportPlugin();
      this.strategy.plugins.push(installReportPlugin);
      for (const [url, cacheKey] of this._urlsToCacheKeys) {
        const integrity = this._cacheKeysToIntegrities.get(cacheKey);
        const cacheMode = this._urlsToCacheModes.get(url);
        const request = new Request(url, { integrity, cache: cacheMode, credentials: 'same-origin' });
        await Promise.all(this.strategy.handleAll({ params: { cacheKey }, request, event }));
      }
      const { updatedURLs, notUpdatedURLs } = installReportPlugin;
      return { updatedURLs, notUpdatedURLs };
    });
  }

  activate(event: ExtendableEvent): Promise<CleanupResult> {
    return waitUntil(event, async () => {
      const cache = await self.caches.open(this.strategy.cacheName);
      const currentlyCachedRequests = await cache.keys();
      const expectedCacheKeys = new Set(this._urlsToCacheKeys.values());
      const deletedURLs = [];
      for (const request of currentlyCachedRequests) {
        if (!expectedCacheKeys.has(request.url)) {
          await cache.delete(request);
          deletedURLs.push(request.url);
        }
      }
      return { deletedURLs };
    });
  }
}
```

The Workbox manifest entry type:

```typescript
interface PrecacheEntry {
  url: string;
  revision?: string | null;       // hash; appended as ?__WB_REVISION__=<hash>
  integrity?: string;             // SRI hash
}
```

### 8.8 Workbox `workbox-window` â€” user-space SW update UX

`workbox-window` exposes a JS API used by the page itself (not inside the SW):

```typescript
import { Workbox } from 'workbox-window'

const wb = new Workbox('/sw.js')

wb.addEventListener('waiting', (event) => {
  // A new SW is waiting â€” prompt the user
  if (confirm('New version available. Reload?')) {
    wb.messageSkipWaiting()        // calls postMessage({type: 'SKIP_WAITING'})
  }
})

wb.addEventListener('controlling', () => {
  window.location.reload()        // SW is now controller; reload for full effect
})

wb.register()
```

`messageSkipWaiting()` posts to the active SW, which calls `self.skipWaiting()`. Combined with `clientsClaim: true` in the SW's `clientsClaim()` call, this gives instant activation.

### 8.9 Configuration surface â€” `workbox-build` / `InjectManifest`

`workbox-build`'s config (verifiable from `workbox-build` README):

```typescript
await generateSW({
  globDirectory: 'dist/',
  globPatterns: ['**/*.{html,js,css,png,svg,ico,woff2}'],
  globIgnores: ['**/sw.js', '**/workbox-*.js'],
  swDest: 'dist/sw.js',
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.destination === 'image',
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    ...
  ],
  skipWaiting: false,                  // don't skipWaiting by default; let the page decide
  clientsClaim: true,
  cleanupOutdatedCaches: true,
})
```

For custom SW code, use `InjectManifest`:

```typescript
await injectManifest({
  globDirectory: 'dist/',
  globPatterns: ['**/*.{html,js,css,png,svg,ico,woff2}'],
  swSrc: 'src/sw.ts',
  swDest: 'dist/sw.js',
  injectionPoint: 'self.__WB_MANIFEST',     // exact token
})
```

### 8.10 Cache strategies â€” quoted from Workbox

| Strategy | Behavior |
|---|---|
| `CacheFirst` | Try cache; on miss, network; on success, write back. |
| `CacheOnly` | Cache only; never network. |
| `NetworkFirst` | Try network; fall back to cache on failure. |
| `NetworkOnly` | Network only; never cache. |
| `StaleWhileRevalidate` | Return cache immediately; in parallel, fetch & update cache. |

### 8.11 Version comparison

Service worker "version" is determined by **byte-level equality of the SW script**. The browser checks the script URL (with last-modified bytes / hash) and only installs a new SW when the script has changed by at least one byte. Workbox adds a `__WB_REVISION__` query parameter to every precache entry, so the *page* becomes "new" whenever any cached asset changes, forcing `update()` to trigger a new SW install.

There is no native semver concept in PWAs.

### 8.12 Security / TLS

- Service workers **only register on HTTPS origins** (except `localhost` / `127.0.0.1` / `file://`).
- `importScripts()` is **restricted to the same origin** by default.
- Subresource Integrity (`integrity="sha384-â€¦"`) is supported for `importScripts` and `fetch` (verified server-side).
- Push API requires the `PushSubscription` containing a per-app VAPID key.

### 8.13 Minimum viable subset to reimplement PWA updates

1. Write a `sw.js` that registers `install` and `activate` listeners.
2. In `install`: `caches.open('v1').then(c => c.addAll(['/','/index.css','/app.js']))`.
3. In `activate`: `caches.keys().then(keys => Promise.all(keys.filter(k => k !== 'v1').map(k => caches.delete(k))))`.
4. Optionally call `self.skipWaiting()` and `clients.claim()` for instant takeover.
5. On page side, listen for `navigator.serviceWorker.controller` changes and reload.
6. For "atomic version bump", include a build-time hash in either the SW filename (`sw-v2.js`) or a query string (`/sw.js?v=2`).

### 8.14 Cross-references

- **electron-updater** uses NW.js / Electron Chromium and thus has a service worker under the hood, but app update is handled by Electron APIs, not SW.
- **Capacitor** with webview on Android/iOS runs a service-worker-like WebViewClient, but uses the **Capawesome Live Update** bundle mechanism (section 5) instead of SW lifecycle.
- **Tauri's webview** uses the system webview (WKWebView / WebView2); service worker registration depends on webview version.

### 8.15 Raw source URLs cited

- https://www.w3.org/TR/service-workers/
- https://www.w3.org/TR/appmanifest/
- https://api.github.com/repos/GoogleChrome/workbox/releases/latest
- https://raw.githubusercontent.com/GoogleChrome/workbox/v7/packages/workbox-precaching/src/PrecacheController.ts
- https://developer.chrome.com/docs/workbox/

---

## 9. Microsoft.AutoUpdater / MSIX + AppInstaller

### 9.1 Spec version / repo

| Component | Version | Source |
|---|---|---|
| **WinGet CLI** | **v1.29.380** (2026-09-21) | https://api.github.com/repos/microsoft/winget-cli/releases/latest |
| AppInstaller file schema | **AppInstaller v2** (W3C XML Schema) | https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-schema |
| MSIX packaging | Spec maintained by Microsoft | https://learn.microsoft.com/en-us/windows/msix/ |
| AppInstaller XSD | schema hosted on Microsoft Learn | https://learn.microsoft.com/en-us/windows/msix/app-installer/ |
| WindowsPackageManager API | `Microsoft.Windows.AppNotifications` (WinRT) | https://learn.microsoft.com/en-us/windows/msix/package-manager/ |
| WinGet repo | https://github.com/microsoft/winget-cli | GitHub |

The 1.29 release notes highlight relevant improvements (verbatim, 2026-09-21):

> *Default priority of installer types â€” Installer type selection no longer depends on the order defined on the manifest. Instead, preference is given in this order:*
> *MSIX, MSI / Wix / Burn, Nullsoft / Inno / EXE, Portable*
> *SignFile in WinGetSourceCreator now supports an optional RFC 3161 timestamp server via the new `TimestampServer` property on the `Signature` model. When set, `signtool.exe` is called with `/tr <url> /td sha256`, embedding a countersignature timestamp so that signed packages remain valid after the signing certificate expires.*

### 9.2 AppInstaller XML schema â€” element tree

Source: https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-schema (Microsoft Learn; the page has the canonical XSD references)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="<major.minor.build.revision>"
    Uri="<url-to-appinstaller-file>">

  <Bundle Name="<bundle-name>"
          Version="<major.minor.build.revision>"
          Publisher="<publisher-CN>"
          Uri="<url-to-msixbundle>">

    <Packages>
      <Package Name="<package-name>"
               Version="<major.minor.build.revision>"
               Publisher="<publisher-CN>"
               Uri="<url-to-msix>"
               MinVersion="<min>" />
      <!-- plus OptionalPackages, RepairItems, etc. -->
    </Packages>

    <Dependencies>
      <Package Name="..."  MinVersion="..." Publisher="..." />
      <Package Name="..."  MinVersion="..." Publisher="..." />
    </Dependencies>

    <OptionalPackages>
      <Package ... />
    </OptionalPackages>

    <RelatedPackages>
      <RelatedPackage ... RelationshipType="<string>"/>
    </RelatedPackages>

    <RepairItems>
      <RepairFile DisplayName="..."  Uri="..."  RelativeFilePath="..." />
    </RepairItems>

    <UpdateSettings>
      <OnLaunch HoursBetweenUpdateChecks="6"
                ShowPrompt="true"
                UpdateBlocksActivation="true" />
      <AutomaticUpdateBackgroundExecutor
                ServiceName="MyAppUpdateService" />
      <ForceUpdateFromAnyVersion
                UpdateUnavailable="true" />
      <RepairAfterUpdate Mode="always" />
    </UpdateSettings>

    <BundleSettings>
      <OptionalBundleExtension>
        <BundleExtension Name="..."  Publisher="..." Version="..."  FileExtension=".bin" />
      </OptionalBundleExtension>
    </BundleSettings>

    <Metadata>
      <InstallerParameters>
        <InstallerParameter Name="<param>" Value="<value>" />
      </InstallerParameters>
    </Metadata>

  </Bundle>

  <UpdateSettings>...</UpdateSettings>   <!-- can also live at the top level for MainPackage -->
  <Package/>                              <!-- MainPackage standalone variant -->

  <PackageSettings
      Name="<name>"
      Publisher="<CN>"
      Version="<x.y.z.w>"
      Uri="<url-to-msix>" />

  <EnforceUpdateOptions
      HoursBetweenUpdateChecks="<n>"
      UpdateBlocksActivation="<bool>"
      ShowPrompt="<bool>" />

  <RepairAfterUpdate Mode="always|soft|none" />

  <MachineExceptions
      DeviceLock="<allowed values>" />
</AppInstaller>
```

### 9.3 UpdateSettings sub-elements â€” verbatim

| Element | Attributes | Default | Effect |
|---|---|---|---|
| `<OnLaunch>` | `HoursBetweenUpdateChecks`, `ShowPrompt`, `UpdateBlocksActivation` | `0`/`true`/`true` | Check on launch |
| `<AutomaticUpdateBackgroundExecutor>` | `ServiceName` | (none) | Run as a background service |
| `<ForceUpdateFromAnyVersion>` | `UpdateUnavailable` | `true` | Allows downgrade-by-update |
| `<RepairAfterUpdate>` | `Mode` (`always`\|`soft`\|`none`) | `always` | Re-run package repair after each update |

### 9.4 Example AppInstaller file (canonical)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="1.2.0.0"
    Uri="https://updates.example.com/MyApp/MyApp.appinstaller">

  <Bundle Name="MyCompany.MyApp"
          Version="1.2.0.0"
          Publisher="CN=MyCompany, O=MyCompany, L=Taipei, C=TW"
          Uri="https://updates.example.com/MyApp/MyApp_1.2.0.0_Test/MyApp_1.2.0.0_x64.msixbundle">

    <Packages>
      <Package Name="MyCompany.MyApp"
               Version="1.2.0.0"
               Publisher="CN=MyCompany, O=MyCompany, L=Taipei, C=TW"
               Uri="https://updates.example.com/MyApp/MyApp_1.2.0.0_Test/MyApp_1.2.0.0_x64.msix"
               MinVersion="1.0.0.0" />
    </Packages>

    <UpdateSettings>
      <OnLaunch HoursBetweenUpdateChecks="6"
                ShowPrompt="true"
                UpdateBlocksActivation="true" />
      <ForceUpdateFromAnyVersion UpdateUnavailable="true" />
    </UpdateSettings>
  </Bundle>

</AppInstaller>
```

### 9.5 Signature / verification â€” MSIX + AppInstaller

- The **MSIX package itself** must be **Authenticode-signed** by a code-signing certificate matching the `Publisher` CN in the AppInstaller.
- The AppInstaller file can be signed too, but it's optional â€” clients verify via the embedded MSIX signature.
- **Subject Name (CN) and Publisher in AppInstaller must EXACTLY match** the signing certificate.
- Microsoft also supports **SHA256** and **SHA384** signing.
- Verification is performed by the Windows AppX deployment API before install.

### 9.6 Provider/endpoint config

Two endpoints:

1. **AppInstaller URL** â€” points at the `.appinstaller` file. Embedded in the host app's protocol handler / registry entry / launcher shortcut.
2. **MSIX / msixbundle URL** â€” points at the actual install asset, referenced from `<Package Uri="â€¦">` or `<Bundle Uri="â€¦">`.

When the user launches via the AppInstaller URI scheme (`myapp://install?source=...`), Windows fetches the AppInstaller, resolves the package, verifies signatures, and runs the install / update.

### 9.7 Configuration surface â€” WinGet manifest

For WinGet distribution (alternative to AppInstaller), the manifest is YAML:

```yaml
PackageIdentifier: MyCompany.MyApp
PackageVersion: 1.2.0
PackageLocale: en-US
Publisher: MyCompany
PackageName: My App
License: MIT
ShortDescription: AIRIZ Motor Console
ManifestType: defaultLocale
ManifestVersion: 1.6.0

Installers:
  - Architecture: x64
    InstallerType: msix
    InstallerUrl: https://updates.example.com/MyApp/MyApp_1.2.0.0_x64.msix
    InstallerSha256: <hex>
    SignatureSha256: <hex>
    PackageFamilyName: MyCompany.MyApp_8wekyb3d8bbwe
    ProductCode: MyCompany.MyApp

UpdateBehavior:
  $Microsoft.Windows.Installer.UpdateBehavior::InstallationBehavior: install
```

### 9.8 Configuration surface â€” WindowsPackageManager API (C# / C++)

`PackageManager.AddPackageByUriAsync` (C#, WinRT):

```csharp
using Windows.Management.Deployment;

var pm = new PackageManager();
var op = await pm.AddPackageByUriAsync(
    new Uri("https://updates.example.com/MyApp/MyApp.appinstaller"),
    new AddPackageOptions {
        ForceUpdateFromAnyVersion = true,
        RetainFilesOnFailure = false
    });

await op.GetResultsAsync();   // returns IAsyncOperation<PackageOperationResult>
```

### 9.9 CLI â€” winget

```powershell
winget source add --name "AIRIZ Console" --arg https://updates.example.com/winget/source
winget install MyCompany.MyApp --source "AIRIZ Console"
winget upgrade MyCompany.MyApp --source "AIRIZ Console"
winget validate --manifest MyApp.installer.yaml
```

`winget-cli` v1.29.380 introduces (verbatim from release notes):

> *Source Priority â€” experimental under `sourcePriority`; defaulted to disabled. With this feature, one can assign a numerical priority to sources when added or later through the `source edit` command. Sources with higher priority are sorted first in the list of sources, which results in them getting put first in the results if other things are equal.*

### 9.10 Version comparison

`<Package Version="1.2.0.0">` uses standard 4-part Windows version (`Major.Minor.Build.Revision`). AppInstaller compares the latest version from `<Package>` / `<Bundle>` to the installed version; an update is offered if `latest > installed`. `<ForceUpdateFromAnyVersion>` allows downgrade.

`<OnLaunch>` controls the check frequency (in hours).

### 9.11 Minimum viable subset to reimplement MSIX auto-update

1. **Sign the MSIX package** with `signtool.exe sign /fd SHA256 /a MyApp.msix`.
2. **Author the `.appinstaller`** referencing the MSIX (or `.msixbundle`).
3. **Host both** at HTTPS URLs.
4. **Trigger** by either:
   - Shipping a launcher that calls `PackageManager.AddPackageByUriAsync(appInstallerUri)` on first run.
   - Registering a URL scheme (`myapp://`) that handles `ms-appinstaller://` activation.
   - Listing your manifest on a WinGet source.
5. The user installs once via the AppInstaller URL; thereafter the OS checks on the configured cadence.

### 9.12 Cross-references

- **Squirrel.Windows** (section 1) is the older, lighter-weight alternative for NSIS-based installers. AppInstaller is Microsoft's structured replacement.
- **electron-updater on Windows** (section 3) actually uses Squirrel.Windows, not AppInstaller, because Electron-builder ships NSIS installers.
- **Tauri on Windows** (section 4) also ships NSIS or MSI; the updater handles in-process version compare + external signing (NSIS) or `<UpdateSettings>` for MSI.

### 9.13 Raw source URLs cited

- https://api.github.com/repos/microsoft/winget-cli/releases/latest
- https://learn.microsoft.com/en-us/windows/msix/app-installer/
- https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-schema
- https://learn.microsoft.com/en-us/windows/msix/
- https://learn.microsoft.com/en-us/windows/package-manager/
- https://github.com/microsoft/winget-cli

---

## Cross-cutting summary â€” shared lineage

| Lineage | Observation |
|---|---|
| **Squirrel.Windows â†’ electron-updater â†’ Tauri** | All three descend from the same design intuition (Paul Miller / @anaisbetts authored both Squirrel.Windows and parts of electron-builder's update flow). The "manifest at a URL, signature on the artifact" pattern persists. Tauri 2.x replaces Authenticode/Squirrel RELEASES with minisign-signed JSON. |
| **Sparkle / minisign family** | Sparkle (macOS) and Tauri (cross-platform) both use **ed25519 / minisign**. Different on-wire formats (RSS+EdDSA attribute vs single JSON doc). |
| **OTA web bundle family** | Capacitor Live Update (Capawesome) and Expo Updates (EAS) both ship **JS-only OTA updates** in mobile webview shells. Different bundle models (zip vs structured manifest) and different signature algos (RSA-PSS vs RSA-PKCS1). CodePush was the original; Expo replaced it. |
| **W3C Service Worker family** | Service Worker lifecycle (installing / installed / activating / activated / redundant) is the foundational pattern for every PWA. Workbox wraps the SW raw API. |
| **Microsoft stack** | WinGet + MSIX AppInstaller are Microsoft's structured equivalent of Squirrel.Windows / electron-updater, but with much heavier infrastructure assumptions (code-signed MSIX, structured `.appinstaller` XML). |

---

## Recommendations for AIRIZ Motor Console

**If AIRIZ Motor Console targets a single native platform:** pick the platform's native updater (Sparkle for macOS, electron-updater or MSIX for Windows).

**If AIRIZ is a cross-platform desktop app:** the two cleanest options are:
1. **electron-updater** (if Electron-based): broadest provider support, mature, single `latest.yml` protocol.
2. **Tauri 2.x updater**: signed JSON, minisign, Rust performance, smaller bundle.

**If AIRIZ is a PWA / mobile web app:** use **Workbox + Workbox-window** with the SW lifecycle + versioned precache manifests.

**Avoid** for any new project in 2026: **CodePush** (deprecated, App Center retired 2025-03-31).
