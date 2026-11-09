Auto Update | electron-builder 

[Skip to main content](#__docusaurus_skipToContent_fallback)

You are reading the documentation for **next (v27)**, which has not been released yet. For the current stable release, see the [v26 documentation](/v26/).

[**electron-builder**](/)[Docs](/docs/)[Changelog](/changelog)

[next (v27)](#)

-   [next (v27)](/)
-   [v26](/v26/)

[GitHub](https://github.com/electron-userland/electron-builder)

-   [Overview](/docs/)
-   [CLI](/docs/cli)
-   [Migration](/docs/migration/whats-new-v27)
    
    -   [What's New in v27](/docs/migration/whats-new-v27)
    -   [v26 → v27 Walkthrough](/docs/migration/v26-to-v27)
    -   [v27 Breaking Changes](/docs/migration/v27-breaking-changes)
        
    -   [Changelog](/changelog)
-   [Configuration](/docs/configuration)
    
-   [Platforms & Targets](/docs/targets)
    
-   [Features](/docs/features/build-lifecycle)
    
-   [Auto Update](/docs/features/auto-update)
    
    -   [Signed Update Manifests](/docs/features/signed-update-manifests)
    -   [Key Rotation](/docs/features/key-rotation)
-   [Code Signing & Security](/docs/features/code-signing/)
    
-   [Tutorials](/docs/tutorials/adding-electron-fuses)
    
-   [Troubleshooting](/docs/troubleshooting)
-   [Programmatic API](/docs/programmatic-usage)
    
-   [Reference](/docs/environment-variables)
    
-   [Donate](/docs/donate)

-   [](/)
-   Auto Update

On this page

# Auto Update

Auto updates are enabled by the `electron-updater` package. Ideally, auto updates are configured to run in a CI pipeline to automatically provision new releases. See [publish configuration](/docs/publish) for information on how to configure your local or CI environment for automated deployments.

Auto updates work as follows:

-   You configure the package to build release metadata (`latest.yml`)
-   Electron builder uploads the actual release targets and metadata files to the configured target (except for generic server, where you have to upload manually)
-   You configure the Electron application to use auto-updates, which queries the publish server for possible new releases

Read the remainder of this guide to configure everything.

Code signing is required on macOS

macOS application must be [signed](/docs/features/code-signing/) in order for auto updating to work.

## Auto-updatable Targets[​](#auto-updatable-targets "Direct link to Auto-updatable Targets")

-   macOS: DMG.
-   Linux: AppImage, DEB, Pacman and RPM.
-   Windows: NSIS.

All these targets are default, custom configuration is not required. (Though it is possible to [pass in additional configuration, e.g. request headers](#custom-options-instantiating-updater-directly).)

info

1.  **Squirrel.Windows is not supported.** Simplified auto-update is supported on Windows if you use the default NSIS target, but is not supported for Squirrel.Windows. You can [easily migrate to NSIS](https://github.com/electron-userland/electron-builder/issues/837#issuecomment-355698368).
2.  `zip` target for macOS is **required** for Squirrel.Mac, otherwise `latest-mac.yml` cannot be created, which causes `autoUpdater` error. Default [target](/docs/mac#macos-target-overview) for macOS is `dmg`+`zip`, so there is no need to explicitly specify target.

## Differences between electron-updater and built-in autoUpdater[​](#differences-between-electron-updater-and-built-in-autoupdater "Direct link to Differences between electron-updater and built-in autoUpdater")

The `electron-updater` package offers a different functionality compared to Electron's built-in auto-updater. Here are the differences:

-   Linux is supported (not only macOS and Windows).
-   Code signature validation not only on macOS, but also on Windows.
-   All required metadata files and artifacts are produced and published automatically.
-   Download progress and [staged rollouts](#staged-rollouts) supported on all platforms.
-   Different providers supported out of the box: ([GitHub Releases](https://help.github.com/articles/about-releases/), [Amazon S3](https://aws.amazon.com/s3/), [DigitalOcean Spaces](https://www.digitalocean.com/community/tutorials/an-introduction-to-digitalocean-spaces), [Cloudflare R2](https://developers.cloudflare.com/r2/), [Keygen](https://keygen.sh/docs/api/#auto-updates-electron) and generic HTTP(s) server).
-   You need only 2 lines of code to make it work.

## Quick Setup Guide[​](#quick-setup-guide "Direct link to Quick Setup Guide")

1.  Install [electron-updater](https://yarn.pm/electron-updater) as an app dependency.
    
2.  Configure the [`publish`](/docs/publish) options depending on where you want to host your release files.
    
3.  Build your application and check that the build directory contains the metadata `.yml` files next to the built application. For most publish targets, the building step will also upload the files, except for the generic server option, where you have to upload your built releases and metadata manually.
    
4.  Use `autoUpdater` from `electron-updater` instead of `electron`:
    
    CommonJS
    
    ```
    const { autoUpdater } = require("electron-updater")
    ```
    
    ESM
    
    ```
    import { autoUpdater } from "electron-updater"
    ```
    
    TypeScript
    
    ```
    import electronUpdater, { type AppUpdater } from 'electron-updater';export function getAutoUpdater(): AppUpdater {   // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.   // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.   const { autoUpdater } = electronUpdater;   return autoUpdater;}
    ```
    
5.  Call `autoUpdater.checkForUpdatesAndNotify()`. Or, if you need custom behaviour, implement `electron-updater` events, check examples below.
    

note

Do not call `setFeedURL`. electron-builder automatically creates `app-update.yml` file for you on build in the `resources` (this file is internal, you don't need to be aware of it). Its feed is the first provider that receives the update manifest (`publishAutoUpdate` not `false`) in the `publish` settings of the targets that write update info — a target-level `publish` such as `nsis.publish` counts — see [which settings become the auto-update feed](/docs/publish#app-update-yml-feed).

## Examples[​](#examples "Direct link to Examples")

Example in TypeScript using system notifications

```
import { autoUpdater } from "electron-updater"export default class AppUpdater {  constructor() {    const log = require("electron-log")    log.transports.file.level = "debug"    autoUpdater.logger = log    autoUpdater.checkForUpdatesAndNotify()  }}
```

-   A [complete example](https://github.com/iffy/electron-updater-example) showing how to use.
-   An [encapsulated manual update via menu](https://github.com/electron-userland/electron-builder/blob/7f6c3fea6fea8cffa00a43413f5335097aca94b0/pages/encapsulated%20manual%20update%20via%20menu.js).

### Custom Options instantiating updater Directly[​](#custom-options-instantiating-updater-directly "Direct link to Custom Options instantiating updater Directly")

If you want more control over the updater configuration (e.g. request header for authorization purposes), you can instantiate the updater directly.

```
import { NsisUpdater } from "electron-updater"// Or MacUpdater, AppImageUpdaterexport default class AppUpdater {    constructor() {        const options = {            requestHeaders: {                // Any request headers to include here            },            provider: 'generic',            url: 'https://example.com/auto-updates'        }        const autoUpdater = new NsisUpdater(options)        autoUpdater.addAuthHeader(`Bearer ${token}`)        autoUpdater.checkForUpdatesAndNotify()    }}
```

Credentials are only sent to the update feed's origin

The credential headers in `requestHeaders` / `addAuthHeader` — headers such as `Authorization`, the same set that is removed on a cross-origin redirect — and the query string of the feed `url` are only sent to the feed's origin (scheme, host and port; as on redirects, an `http` → `https` upgrade of the feed host on the default ports keeps the headers and the feed query). With the generic, s3, spaces, r2, keygen, bitbucket, github and gitlab providers, an update file whose URL in `latest*.yml` is on another origin, and the blockmaps and differential range requests derived from it, are downloaded without them; such a URL keeps its own query string. A blockmap is downloaded from `${url}.blockmap` with the file URL's query string, so a pre-signed installer URL's signature does not fit it: set `files[].blockMapUrl` in `latest*.yml` to the blockmap's own (pre-signed) URL. A relative value resolves like `url` (against the feed URL); an absolute URL is used as-is, with its own host and query string. Either follows the same origin rule. With a `blockMapUrl`, the old version's blockmap comes from the local cache or from `previousBlockmapBaseUrlOverride`; when neither has it, that one update is downloaded in full, which fills the cache for the next one (the private GitHub and GitLab providers, which resolve files from the release assets, ignore `blockMapUrl`). With every provider, including custom ones, a URL that electron-updater resolves against the feed URL (such as `files[].url` or a blockmap) gets the feed query only on the feed's origin. Serve the update files from the feed origin (relative `files[].url`, the default) or use pre-signed URLs. [Signed update manifests](/docs/features/signed-update-manifests) cover `files[].url` and `packages.<arch>.path`, so a pre-signed URL has to be in `latest*.yml` before it is signed (see [Key storage](/docs/features/key-rotation#key-storage)). A custom provider (one that does not extend a built-in provider such as `GenericProvider`) declares where these headers go by overriding `Provider.feedBaseUrl`: return its feed URL to send them only to that origin, or `null` to send the request headers to every download URL. If it declares neither and the downloads carry credential headers, `downloadUpdate()` fails with `ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED` before any download request:

```
class MyProvider extends Provider<UpdateInfo> {  get feedBaseUrl(): URL | null {    return new URL("https://updates.example.com/") // or null  }  // getLatestVersion(), resolveFiles(), …}
```

### Custom downloaded-file verification[​](#custom-downloaded-file-verification "Direct link to Custom downloaded-file verification")

All updater classes inherit `AppUpdater.verifyUpdateFile`, which lets you run your own verification step on an update file before it is allowed to become installable. If the verification fails, the update is aborted, the file is deleted and an `ERR_UPDATER_INVALID_UPDATE_FILE` error is emitted.

The hook runs on **every** path that can lead to an install, so a rejected file can never reach the installer:

When

`updateFilePath` points to

Right after a fresh download

the file under a **temporary** name — it is renamed to `originalUpdateFileName` only after your verification succeeds, so an unverified file is never executable under its real name

An update downloaded by an earlier session and reused from the cache

the cached file, under its real name

Before an install-on-next-launch spawns the cached installer

the pending installer, under its real name

Only the first case can quarantine the file under a temporary name; in the other two the bytes are already on disk under their real name from a previous session, and the hook is a re-verification of a file at rest. `cancellationToken` is set only when the verification belongs to a download.

For NSIS web installers, `packageFilePath` is also provided and points to the downloaded companion `.7z` package. It is omitted when no such package was downloaded.

This hook is generic and works across updater implementations. On Windows NSIS updates, the built-in Authenticode verification remains available separately as `NsisUpdater.verifyUpdateFileAuthenticodeSignature`, and both run — Authenticode first, then your hook.

```
import { NsisUpdater } from "electron-updater"const updater = new NsisUpdater()updater.verifyUpdateFile = async ({ updateFilePath, originalUpdateFileName, packageFilePath, cancellationToken }) => {  try {    // Example for your custom code, which can inspect the update file at `updateFilePath`,    // can use the expected filename `originalUpdateFileName`, and for NSIS web installers can also inspect    // the downloaded companion package at `packageFilePath`.    const signatureFile = getCorrespondingSignatureFile(originalUpdateFileName)    checkSignature(updateFilePath, signatureFile)    return { response: "success" }  }  catch (err) {    return { response: "failure", message: `${err}` }  }}// assigning null restores the default (a stub that always succeeds)updater.verifyUpdateFile = null
```

A `failure` must carry a `message`; it is what the emitted error reports as the reason.

## Install on Next Launch (Windows/Linux)[​](#install-on-next-launch-windowslinux "Direct link to Install on Next Launch (Windows/Linux)")

When a downloaded update is automatically installed is controlled by `autoUpdater.autoInstallEvent` (`"manual" | "onQuit" | "onNextLaunch"`, default `"onQuit"`). With the default `"onQuit"`, the update is installed when the app quits: the updater spawns the installer as a detached process while the app is exiting. If the quit happens because the OS session is ending (shutdown, reboot or log off on Windows), the OS can kill that installer mid-install and leave the app in a broken, partially-uninstalled state ([#7807](https://github.com/electron-userland/electron-builder/issues/7807)).

electron-updater ≥ 7.0 (electron-builder v27) mitigates this in two ways:

1.  **Session-end guard (always on).** When the OS signals that the session is ending, the on-quit install is skipped and a warning is logged. The downloaded update stays cached and is installed on the next regular quit. Detection is best-effort: `powerMonitor` `shutdown` on macOS/Linux, and the `BrowserWindow` `session-end` event on Windows (windowless, e.g. tray-only, apps cannot be covered on Windows).
    
2.  **Install on next launch (opt-in).** Instead of installing while quitting, persist the downloaded update and install it at the start of the *next* launch, when no session teardown can interrupt it:
    
    ```
    autoUpdater.autoInstallEvent = "onNextLaunch"
    ```
    
    With this set, any app quit records the downloaded update as pending instead of spawning the installer. On the next launch the updater fetches fresh update info from your update server, re-validates the cached installer against it (checksum, and code signature on Windows), verifies the pending version is still an installable change (newer than the running app — or a downgrade when `allowDowngrade` is enabled), then runs the installer silently and restarts the app. If validation fails or the version is no longer an installable change, the pending state is cleared and the app starts normally.
    
    Set `autoInstallEvent = "manual"` to disable automatic installation entirely (the downloaded update stays cached until you call `quitAndInstall()` yourself).
    
    A single quit can also be deferred without setting the property:
    
    ```
    autoUpdater.quitAndInstall({ isSilent: true, isForceRunAfter: true, waitUntilNextLaunch: true })
    ```
    
    You can also trigger the pending install explicitly (e.g. before opening your first window):
    
    ```
    await autoUpdater.installPendingUpdateIfAvailable()
    ```
    

### Per-target behavior[​](#per-target-behavior "Direct link to Per-target behavior")

The *automatic* install at startup only runs for targets that can install the pending update without an elevation/authentication prompt. Targets that always elevate to install (deb/rpm/pacman via pkexec/sudo, per-machine NSIS via UAC) skip the automatic path with a log message and keep the pending update — call `installPendingUpdateIfAvailable()` explicitly at a moment your app controls to install those.

Target

Automatic install at next launch

Explicit `installPendingUpdateIfAvailable()`

NSIS (per-user)

✓

✓

NSIS (per-machine, `isAdminRightsRequired`)

skipped — would show a UAC prompt at startup

✓ (UAC prompt)

AppImage

✓

✓

deb / rpm / pacman

skipped — package managers always elevate (pkexec/sudo)

✓ (auth prompt)

macOS

n/a — Squirrel.Mac stages updates natively and applies them on relaunch

resolves `false`

electron-builder v27 sets `isAdminRightsRequired` in the update info of every per-machine `nsis` and `nsis-web` build (`perMachine: true`), including assisted installers (`oneClick: false`) and builds with `differentialPackage: false`, so their updates are started with `elevate.exe` and skipped by the automatic install at launch.

Planned default change in v28

`autoInstallEvent` defaults to `"onQuit"` in v27; `"onNextLaunch"` is planned to become the **default** in v28 to resolve this class of session-end corruption once and for all. macOS is unaffected: Squirrel.Mac natively stages downloaded updates and applies them on relaunch, without a killable installer process (there `"onQuit"` and `"onNextLaunch"` behave identically).

Launching during an OS shutdown is a residual, best-effort-only race

Deferring the install to the next launch moves the installer out of the session-end quit — the common [#7807](https://github.com/electron-userland/electron-builder/issues/7807) trigger — but it does not make the install itself atomic. If the user *launches* the app while the OS is already shutting down or rebooting (for example, right before a scheduled restart fires), the automatic startup install spawns the same detached NSIS/AppImage installer, and the OS can still terminate it mid-write.

The session-end guard does **not** cover this launch window: it is wired into the on-quit path only, and on a fresh launch the `shutdown` / `session-end` signal generally arrives *after* the startup install has already been spawned, so it cannot reliably win the race. The probability is very low — it requires a deferred update, a launch inside the shutdown window, *and* the OS killing the installer mid-write — and macOS is immune (Squirrel.Mac swaps the app bundle atomically). The only complete fix for NSIS/AppImage is an atomic install, which is out of scope for this feature.

## Debugging[​](#debugging "Direct link to Debugging")

You don't need to listen to all events to understand what's wrong. Just set `logger`. [electron-log](https://github.com/megahertz/electron-log) is recommended (it is an additional dependency that you can install if needed).

```
autoUpdater.logger = require("electron-log")autoUpdater.logger.transports.file.level = "info"
```

Note that in order to develop/test UI/UX of updating without packaging the application you need to have a file named `dev-app-update.yml` in the root of your project, which matches your `publish` setting from electron-builder config (but in [yaml](https://www.json2yaml.com) format). In latest version you need [force the updater](https://github.com/electron-userland/electron-builder/issues/6863) to work in "dev" mode:

```
autoUpdater.forceDevUpdateConfig = true
```

note

If you see this in logs:

```
APPIMAGE env is not defined, current application is not an AppImage
```

you need to apply [this workaround](https://github.com/electron-userland/electron-builder/issues/3167#issuecomment-627696277) otherwise update won't continue:

```
process.env.APPIMAGE = path.join(__dirname, 'dist', `app_name-${app.getVersion()}.AppImage`)
```

But it is not recommended, better to test auto-update for installed application (especially on Windows). [Minio](https://github.com/electron-userland/electron-builder/issues/3053#issuecomment-401001573) is recommended as a local server for testing updates.

## Compatibility[​](#compatibility "Direct link to Compatibility")

Since electron-builder 27 the generated `latest*.yml` targets the modern `files[]` metadata format by default and no longer includes the legacy top-level `path`/`sha512` fields, which are needed only by electron-updater 1.x – 2.15.0.

The `electronUpdaterCompatibility` option sets the electron-updater compatibility semver range: the electron-updater versions your installed apps ship, which have to read the update files a build publishes (e.g. `>=7`, `>=6`, `>=1.0.0`). Can be specified per platform (e.g. `win.electronUpdaterCompatibility`). Defaults to `>=7`. The range decides:

-   the [`.blockmap` format](#differential-updates-blockmap): the binary map for a range that includes only electron-updater 7 and later, the JSON map (with a build warning) for a range that includes earlier versions;
-   the legacy fields emitted in addition to `files[]`: the top-level `path`/`sha512` and the Windows `sha2` checksum for ranges intersecting `<2.16.0`, and the old `latest-mac.json` for ranges intersecting `<2.0.0`.

The build fails when the app's own electron-updater is outside the range of a platform it builds (for example electron-updater 6 with the default `>=7`): upgrade it, or declare a range that includes it. The app's electron-updater is the one in `dependencies`, else in `devDependencies` (bundled by webpack, vite and the like), else, with two package.json files, in the development package.json. Where the build writes binary `.blockmap` files (an NSIS installer, a macOS zip), electron-updater 7.0.0-alpha.0 to 7.0.0-alpha.12, which cannot read it, fail the build as well: upgrade to 7.0.0-alpha.13 or later, or set `blockmap` to `"v2"`.

Metadata format history:

-   `1.0.0` latest-mac.json
-   `2.15.0` path
-   `2.16.0` files

sha2-only metadata is deprecated

Update metadata validated only by the legacy SHA-256 `sha2` checksum is deprecated — v27 warns and **v28 rejects it (fail-closed)**. Avoid pinning `electronUpdaterCompatibility` to a legacy range unless you actually ship 1.x–2.15 clients.

## Update security options[​](#update-security-options "Direct link to Update security options")

Two `AppUpdater` settings changed or were added in v27. See the [Security & Hardening](/docs/features/security#update-security-electron-updater) page for the full rationale.

The update manifest (`latest*.yml`) itself **is** cryptographically signed and verified before any download as of v27. Publishing a build that emits update metadata fails unless an Ed25519 signing key resolves; `updateManifest: false` is the only opt-out — see [Signed Update Manifests](/docs/features/signed-update-manifests).

Changing a signing key or certificate that installs in the field already trust requires a transition release — see [Key Rotation](/docs/features/key-rotation).

### `disableWebInstaller` (now defaults to `true`)[​](#disablewebinstaller-now-defaults-to-true "Direct link to disablewebinstaller-now-defaults-to-true")

NSIS **web** installers download their full payload at install time from a manifest-supplied URL, which may not undergo signature verification. As of v27, `AppUpdater.disableWebInstaller` defaults to **`true`**, so a web-installer update is not loaded unless you opt in.

Unless the flag is `false`, a web-installer update is rejected with `ERR_UPDATER_WEB_INSTALLER_DISABLED` — at download time (including an update already cached by a previous launch), before an [install on next launch](#install-on-next-launch-windowslinux), and at install time.

Installs made by an `nsis-web` installer built with electron-builder v27+ carry a `resources/package-type` marker, and `NsisUpdater` then defaults the flag to `false` automatically. Set it yourself only for web-installer installs without that marker (installed by an installer built before v27, or with a custom script) or when switching an app from `nsis` to `nsis-web`:

```
import { NsisUpdater } from "electron-updater"const updater = new NsisUpdater()updater.disableWebInstaller = false // only if you intentionally ship a web installer
```

Set it before the app is `ready`, e.g. right after creating the updater: with `autoInstallEvent: "onNextLaunch"`, a pending web-installer update is checked against the flag when the app is ready, and rejected (its pending-install marker cleared) while the flag is `true`.

A web update cached by a previous launch, or pending an install on next launch, is used only if its web package still matches the freshly fetched manifest; otherwise it is discarded. The `nsis-web` installer itself verifies the package electron-updater passes to it and installs its own copy — see [Web Installer](/docs/nsis#web-installer). Once the app runs the version of that update, `NsisUpdater` removes the package from its `pending` cache directory at startup (app `ready`); the package of an update that is not installed yet, or whose install failed, is kept for the install or a retry. Because the manifest vouches for the web package, don't set `updateManifest: false` for `nsis-web` apps: [signed update manifests](/docs/features/signed-update-manifests) cover its path, SHA-512 and size.

### `allowUnverifiedLinuxPackages` (new)[​](#allowunverifiedlinuxpackages-new "Direct link to allowunverifiedlinuxpackages-new")

`AppUpdater.allowUnverifiedLinuxPackages` (default **`true`**, preserving historical behavior) controls GPG signature enforcement when installing `.deb` / `.rpm` auto-updates. Because electron-builder does not sign Linux packages itself, the default is permissive; set it to **`false`** to enforce signature checks where the package manager supports them:

```
import { autoUpdater } from "electron-updater"autoUpdater.allowUnverifiedLinuxPackages = false
```

## Staged Rollouts[​](#staged-rollouts "Direct link to Staged Rollouts")

Staged rollouts allow you to distribute the latest version of your app to a subset of users that you can increase over time, similar to rollouts on platforms like Google Play.

Staged rollouts are controlled by manually editing your `latest.yml` / `latest-mac.yml` (channel update info file).

```
version: 1.1.0files:  - url: TestApp Setup 1.1.0.exe    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==    size: 62021782stagingPercentage: 10
```

Update will be shipped to 10% of userbase.

If you want to pull a staged release because it hasn't gone well, you **must** increment the version number higher than your broken release. Because some of your users will be on the broken 1.0.1, releasing a new 1.0.1 would result in them staying on a broken version.

## File Generated and Uploaded in Addition[​](#file-generated-and-uploaded-in-addition "Direct link to File Generated and Uploaded in Addition")

`latest.yml` (or `latest-mac.yml` for macOS, or `latest-linux.yml` for Linux) will be generated and uploaded for all providers except `bintray` (because not required, `bintray` doesn't use `latest.yml`).

### Differential updates: `.blockmap`[​](#differential-updates-blockmap "Direct link to differential-updates-blockmap")

For targets that support differential (delta) updates (NSIS on Windows and the macOS update zip; AppImage embeds its map in the binary), electron-builder publishes a **block map** next to the artifact: a list of content-defined blocks and their hashes. electron-updater compares the new map with the one of the installed version and downloads only the byte ranges that changed, using HTTP `Range` requests.

One `<artifact>.blockmap` is published per artifact. Its format follows [`electronUpdaterCompatibility`](#compatibility), since the map is read by the updater already installed in your users' apps:

-   `"v3"` (the default when `electronUpdaterCompatibility` includes only electron-updater 7 and later, as the default `>=7` does): an uncompressed binary map that electron-updater fetches in parts with `Range` requests. It carries the blocks in a three-level layout (a small table of *super-groups*, a table of *groups* of blocks, then one 10-byte record per block), so the updater reads the super-group table, compares it with its cached previous map, fetches only the group entries of the super-groups that changed, compares those, and finally fetches only the records of the groups that changed. The map cost of an update therefore grows with the change, not with the installer size, which is what makes 512 B blocks inside `app.asar` affordable.
-   `"v2"` (the default when the range includes electron-updater 6 or earlier): the gzipped JSON map (~16 KiB blocks) every electron-updater release reads. It is downloaded in full on every update, a fixed cost of roughly 20 bytes per block of the installer. The build warns that it writes this format and why.

![Block map file layout: header, super-group and group tables and 10-byte block records, with content-defined groups](data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjgzMCIgdmlld0JveD0iMCAwIDE2MDAgODMwIj4KICA8c3R5bGU+CiAgaHRtbCxib2R5e21hcmdpbjowO2JhY2tncm91bmQ6I2ZmZn0KICBzdmd7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSwiU2Vnb2UgVUkiLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmO2ZvbnQtc2l6ZToxNXB4O2ZpbGw6IzFmMjkzN30KICAudHtmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDB9Lmh7Zm9udC1zaXplOjE3cHg7Zm9udC13ZWlnaHQ6NzAwfS5ze2ZvbnQtc2l6ZToxM3B4O2ZpbGw6IzRiNTU2M30KICAubXtmb250LWZhbWlseTp1aS1tb25vc3BhY2UsTWVubG8sQ29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMi41cHh9LmxibHtmb250LXNpemU6MTNweDtmaWxsOiMzNzQxNTF9Lm51bXtmb250LXdlaWdodDo3MDB9Cjwvc3R5bGU+CiAgPHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iODMwIiBmaWxsPSIjZmZmZmZmIi8+CiAgPGRlZnM+PG1hcmtlciBpZD0iYXJyIiB2aWV3Qm94PSIwIDAgMTAgMTAiIHJlZlg9IjkiIHJlZlk9IjUiIG1hcmtlcldpZHRoPSI4IiBtYXJrZXJIZWlnaHQ9IjgiIG9yaWVudD0iYXV0by1zdGFydC1yZXZlcnNlIj48cGF0aCBkPSJNMCwwIEwxMCw1IEwwLDEwIHoiIGZpbGw9IiM2YjcyODAiLz48L21hcmtlcj48L2RlZnM+CiAgPHRleHQgeD0iNDAiIHk9IjQ0IiBjbGFzcz0idCI+QmxvY2sgbWFwIGZvcm1hdCAidjMiICguYmxvY2ttYXApIOKAlCBhIHJhbmdlLWZldGNoYWJsZSwgdGhyZWUtbGV2ZWwgbWFwPC90ZXh0PgogIDx0ZXh0IHg9IjQwIiB5PSI3MCIgY2xhc3M9InMiPnYyIGlzIGd6aXBwZWQgSlNPTiwgfjIyIEIgcGVyIGJsb2NrLCBkb3dubG9hZGVkIHdob2xlIG9uIGV2ZXJ5IHVwZGF0ZS4gdjMgaXMgdW5jb21wcmVzc2VkIHdpdGggZml4ZWQtc2l6ZSB0YWJsZXMsIHNvIGFuIHVwZGF0ZXIgY2FuIGZldGNoIHRoZSBwYXJ0cyBpdCBuZWVkcyBieSBieXRlIHJhbmdlLjwvdGV4dD4KCiAgPCEtLSAxLiBmaWxlIGxheW91dCAtLT4KICA8dGV4dCB4PSI0MCIgeT0iMTE4IiBjbGFzcz0iaCI+MSDCtyBGaWxlIGxheW91dCDigJQgZXZlcnkgb2Zmc2V0IGlzIGNvbXB1dGFibGUgZnJvbSB0aGUgaGVhZGVyPC90ZXh0PgogIDxyZWN0IHg9IjQwIiB5PSIxMzQiIHdpZHRoPSIzMzAiIGhlaWdodD0iNTYiIGZpbGw9IiNmZGU2OGEiIHN0cm9rZT0iI2Q5NzcwNiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8dGV4dCB4PSIyMDUiIHk9IjE1NyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9ImxibCIgZm9udC13ZWlnaHQ9IjcwMCI+aGVhZGVyIChmaXhlZCBzaXplKTwvdGV4dD4KICA8dGV4dCB4PSIyMDUiIHk9IjE3NyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9Im0iPm1hZ2ljIMK3IHNpemVzIMK3IGNodW5rZXJzIMK3IHJlZ2lvbnM8L3RleHQ+CiAgPHJlY3QgeD0iMzcwIiB5PSIxMzQiIHdpZHRoPSIzMzAiIGhlaWdodD0iNTYiIGZpbGw9IiNmZGU2OGEiIHN0cm9rZT0iI2Q5NzcwNiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8dGV4dCB4PSI1MzUiIHk9IjE1NyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9ImxibCIgZm9udC13ZWlnaHQ9IjcwMCI+c3VwZXItZ3JvdXBzIOKAlCBzdXBlckNvdW50IMOXIDE2IEI8L3RleHQ+CiAgPHRleHQgeD0iNTM1IiB5PSIxNzciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJtIj57IHN1cGVySGFzaCwgYmxvY2tDb3VudCwgZ3JvdXBDb3VudCB9PC90ZXh0PgogIDxyZWN0IHg9IjcwMCIgeT0iMTM0IiB3aWR0aD0iMzQwIiBoZWlnaHQ9IjU2IiBmaWxsPSIjYmJmN2QwIiBzdHJva2U9IiMxNmEzNGEiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgPHRleHQgeD0iODcwIiB5PSIxNTciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJsYmwiIGZvbnQtd2VpZ2h0PSI3MDAiPmdyb3VwcyDigJQgZ3JvdXBDb3VudCDDlyAxNiBCPC90ZXh0PgogIDx0ZXh0IHg9Ijg3MCIgeT0iMTc3IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBjbGFzcz0ibSI+eyBncm91cEhhc2gsIGJ5dGVMZW5ndGgsIGJsb2NrQ291bnQgfTwvdGV4dD4KICA8cmVjdCB4PSIxMDQwIiB5PSIxMzQiIHdpZHRoPSI1MjAiIGhlaWdodD0iNTYiIGZpbGw9IiNlM2VlZjkiIHN0cm9rZT0iIzE1NjVjMCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8dGV4dCB4PSIxMzAwIiB5PSIxNTciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJsYmwiIGZvbnQtd2VpZ2h0PSI3MDAiPnJlY29yZHMg4oCUIGJsb2NrQ291bnQgw5cgMTAgQiwgaW4gZmlsZSBvcmRlcjwvdGV4dD4KICA8dGV4dCB4PSIxMzAwIiB5PSIxNzciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJtIj57IGJsb2NrSGFzaCB1NjQgKGZpcnN0IDggQiBvZiB0aGUgYmxha2UyYi0xOCBkaWdlc3QpLCBzaXplIHUxNiB9PC90ZXh0PgogIDx0ZXh0IHg9IjQwIiB5PSIyMTQiIGNsYXNzPSJzIj5DdW11bGF0aXZlIHN1bXMgb2YgZ3JvdXBDb3VudCAvIGJsb2NrQ291bnQgLyBieXRlTGVuZ3RoIGdpdmUgZXZlcnkgc3VwZXItZ3JvdXAncyBlbnRyaWVzLCBldmVyeSBncm91cCdzIHJlY29yZHMgYW5kIGV2ZXJ5IGJsb2NrJ3Mgb2Zmc2V0IOKGkiBlYWNoIGlzIG9uZSBSYW5nZSByZXF1ZXN0LjwvdGV4dD4KICA8dGV4dCB4PSI0MCIgeT0iMjMzIiBjbGFzcz0icyI+MzIgTUIgYXNhciBhdCA1MTIgQi8xLzIgS2lCLCBjdXQgYXQgZXZlcnkgZmlsZSDiiYggMjhrIGJsb2NrcyAvIDc0MSBncm91cHMgLyAzOCBzdXBlci1ncm91cHM6IGEgMC42IEtCIHN1cGVyIHRhYmxlLCBhIDExLjkgS0IgZ3JvdXAgdGFibGUsIDI4NCBLQiBvZiByZWNvcmRzIOKAlCBvbmx5IHdoYXQgY2hhbmdlZCBpcyBldmVyIGZldGNoZWQuPC90ZXh0PgoKICA8IS0tIDIuIGJsb2NrcyAtPiBncm91cHMgLS0+CiAgPHRleHQgeD0iNDAiIHk9IjI2NiIgY2xhc3M9ImgiPjIgwrcgQnVpbGQg4oCUIGJsb2NrcyBhcmUgZ3JvdXBlZCBjb250ZW50LWRlZmluZWQgb24gdGhlIGhhc2ggc3RyZWFtIChub3QgYnkgaW5kZXgpLCBhbmQgZ3JvdXBzIGFnYWluIGludG8gc3VwZXItZ3JvdXBzPC90ZXh0PgogIDx0ZXh0IHg9IjQwIiB5PSIyODYiIGNsYXNzPSJzIj5jb250ZW50LWRlZmluZWQgUmFiaW4gYmxvY2tzICg1MTIgQi8xLzIgS2lCIGluc2lkZSB0aGUgc3RvcmVkIGFzYXIgcmVnaW9uLCBjdXQgYXQgZXZlcnkgcGFja2VkIGZpbGU7IDgvMTYvMzIgS2lCIGVsc2V3aGVyZSkg4oaSIG9uZSAxMC1ieXRlIHJlY29yZCBlYWNoOjwvdGV4dD4KICA8IS0tIGJsb2NrcyByb3cgLS0+CiAgPGc+CiAgICA8cmVjdCB4PSI0MCIgeT0iMjk0IiB3aWR0aD0iMTUyMCIgaGVpZ2h0PSIzNCIgZmlsbD0iI2YxZjZmYyIgc3Ryb2tlPSIjOWVjMmViIi8+CiAgICA8ZyBzdHJva2U9IiM1YjliZDUiIHN0cm9rZS13aWR0aD0iMSI+CiAgICAgIDxsaW5lIHgxPSI4MCIgeTE9IjI5NCIgeDI9IjgwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjExMiIgeTE9IjI5NCIgeDI9IjExMiIgeTI9IjMyOCIvPjxsaW5lIHgxPSIxNTAiIHkxPSIyOTQiIHgyPSIxNTAiIHkyPSIzMjgiLz48bGluZSB4MT0iMTg0IiB5MT0iMjk0IiB4Mj0iMTg0IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjIzMCIgeTE9IjI5NCIgeDI9IjIzMCIgeTI9IjMyOCIvPjxsaW5lIHgxPSIyNjIiIHkxPSIyOTQiIHgyPSIyNjIiIHkyPSIzMjgiLz48bGluZSB4MT0iMzAwIiB5MT0iMjk0IiB4Mj0iMzAwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjMzNiIgeTE9IjI5NCIgeDI9IjMzNiIgeTI9IjMyOCIvPjxsaW5lIHgxPSIzNzIiIHkxPSIyOTQiIHgyPSIzNzIiIHkyPSIzMjgiLz48bGluZSB4MT0iNDE2IiB5MT0iMjk0IiB4Mj0iNDE2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjQ1MCIgeTE9IjI5NCIgeDI9IjQ1MCIgeTI9IjMyOCIvPjxsaW5lIHgxPSI0ODYiIHkxPSIyOTQiIHgyPSI0ODYiIHkyPSIzMjgiLz48bGluZSB4MT0iNTMwIiB5MT0iMjk0IiB4Mj0iNTMwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjU2NiIgeTE9IjI5NCIgeDI9IjU2NiIgeTI9IjMyOCIvPjxsaW5lIHgxPSI2MDAiIHkxPSIyOTQiIHgyPSI2MDAiIHkyPSIzMjgiLz48bGluZSB4MT0iNjQwIiB5MT0iMjk0IiB4Mj0iNjQwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjY3NiIgeTE9IjI5NCIgeDI9IjY3NiIgeTI9IjMyOCIvPjxsaW5lIHgxPSI3MjAiIHkxPSIyOTQiIHgyPSI3MjAiIHkyPSIzMjgiLz48bGluZSB4MT0iNzU2IiB5MT0iMjk0IiB4Mj0iNzU2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9Ijc5MCIgeTE9IjI5NCIgeDI9Ijc5MCIgeTI9IjMyOCIvPjxsaW5lIHgxPSI4MzAiIHkxPSIyOTQiIHgyPSI4MzAiIHkyPSIzMjgiLz48bGluZSB4MT0iODY4IiB5MT0iMjk0IiB4Mj0iODY4IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjkwMCIgeTE9IjI5NCIgeDI9IjkwMCIgeTI9IjMyOCIvPjxsaW5lIHgxPSI5NDYiIHkxPSIyOTQiIHgyPSI5NDYiIHkyPSIzMjgiLz48bGluZSB4MT0iOTgwIiB5MT0iMjk0IiB4Mj0iOTgwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEwMTYiIHkxPSIyOTQiIHgyPSIxMDE2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEwNjAiIHkxPSIyOTQiIHgyPSIxMDYwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEwOTYiIHkxPSIyOTQiIHgyPSIxMDk2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjExMzAiIHkxPSIyOTQiIHgyPSIxMTMwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjExNzAiIHkxPSIyOTQiIHgyPSIxMTcwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEyMDYiIHkxPSIyOTQiIHgyPSIxMjA2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEyNTAiIHkxPSIyOTQiIHgyPSIxMjUwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEyODYiIHkxPSIyOTQiIHgyPSIxMjg2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEzMjAiIHkxPSIyOTQiIHgyPSIxMzIwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEzNjAiIHkxPSIyOTQiIHgyPSIxMzYwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjEzOTgiIHkxPSIyOTQiIHgyPSIxMzk4IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjE0MzAiIHkxPSIyOTQiIHgyPSIxNDMwIiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjE0NzYiIHkxPSIyOTQiIHgyPSIxNDc2IiB5Mj0iMzI4Ii8+PGxpbmUgeDE9IjE1MTAiIHkxPSIyOTQiIHgyPSIxNTEwIiB5Mj0iMzI4Ii8+CiAgICA8L2c+CiAgPC9nPgogIDwhLS0gZ3JvdXAgYnJhY2tldHMgLS0+CiAgPGcgc3Ryb2tlPSIjMTZhMzRhIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiPgogICAgPHBhdGggZD0iTTQwLDM0MiB2MTAgaDMzMCB2LTEwIi8+PHBhdGggZD0iTTM3MiwzNDIgdjEwIGgzMDQgdi0xMCIvPjxwYXRoIGQ9Ik02NzgsMzQyIHYxMCBoMjY4IHYtMTAiLz48cGF0aCBkPSJNOTQ4LDM0MiB2MTAgaDMwMiB2LTEwIi8+PHBhdGggZD0iTTEyNTIsMzQyIHYxMCBoMzA4IHYtMTAiLz4KICA8L2c+CiAgPGcgY2xhc3M9Im0iIGZpbGw9IiMxNjY1MzQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPjx0ZXh0IHg9IjIwNSIgeT0iMzcwIj5ncm91cCAwIMK3IGhhc2ggZzA8L3RleHQ+PHRleHQgeD0iNTI0IiB5PSIzNzAiPmdyb3VwIDEgwrcgaGFzaCBnMTwvdGV4dD48dGV4dCB4PSI4MTIiIHk9IjM3MCI+Z3JvdXAgMiDCtyBoYXNoIGcyPC90ZXh0Pjx0ZXh0IHg9IjEwOTkiIHk9IjM3MCI+Z3JvdXAgMyDCtyBoYXNoIGczPC90ZXh0Pjx0ZXh0IHg9IjE0MDYiIHk9IjM3MCI+Z3JvdXAgNCDCtyBoYXNoIGc0PC90ZXh0PjwvZz4KICA8dGV4dCB4PSI0MCIgeT0iNDAwIiBjbGFzcz0icyI+QSBncm91cCBlbmRzIHdoZW4gdGhlIGxvdyA1IGJpdHMgb2YgYSBibG9jaydzIGhhc2ggYXJlIGFsbCBzZXQgKOKJiCBldmVyeSAzMiBibG9ja3M7IG1pbiA4LCBtYXggMTI4KSwgb3IgYXQgYSByZWdpb24gZWRnZSAvIEVPRjsgYSBzdXBlci1ncm91cCBlbmRzIHRoZSBzYW1lIHdheSBvbiB0aGUgZ3JvdXAgaGFzaGVzICjiiYggMTYgZ3JvdXBzKS48L3RleHQ+CiAgPHRleHQgeD0iNDAiIHk9IjQyMCIgY2xhc3M9InMiPmdyb3VwSGFzaCA9IGJsYWtlMmIgb2YgdGhlIGdyb3VwJ3MgcmVjb3Jkcywgc3VwZXJIYXNoID0gYmxha2UyYiBvZiB0aGUgc3VwZXItZ3JvdXAncyBncm91cCBlbnRyaWVzLiBCb3VuZGFyaWVzIGNvbWUgZnJvbSB0aGUgaGFzaGVzLCBzbyBhbiBlZGl0IG9ubHkgcGVydHVyYnMgdGhlIGdyb3VwKHMpIGFuZCBzdXBlci1ncm91cChzKSBjb250YWluaW5nIGl0OjwvdGV4dD4KICA8IS0tIGJlZm9yZS9hZnRlciAtLT4KICA8Zz4KICAgIDx0ZXh0IHg9IjQwIiB5PSI0NTQiIGNsYXNzPSJsYmwiIGZvbnQtd2VpZ2h0PSI3MDAiPnByZXZpb3VzIHJlbGVhc2U8L3RleHQ+CiAgICA8cmVjdCB4PSIyMDAiIHk9IjQ0MCIgd2lkdGg9IjMzMCIgaGVpZ2h0PSIyMiIgZmlsbD0iI2JiZjdkMCIgc3Ryb2tlPSIjMTZhMzRhIi8+PHJlY3QgeD0iNTMwIiB5PSI0NDAiIHdpZHRoPSIzMDQiIGhlaWdodD0iMjIiIGZpbGw9IiNiYmY3ZDAiIHN0cm9rZT0iIzE2YTM0YSIvPjxyZWN0IHg9IjgzNCIgeT0iNDQwIiB3aWR0aD0iMjY4IiBoZWlnaHQ9IjIyIiBmaWxsPSIjYmJmN2QwIiBzdHJva2U9IiMxNmEzNGEiLz48cmVjdCB4PSIxMTAyIiB5PSI0NDAiIHdpZHRoPSIzMDIiIGhlaWdodD0iMjIiIGZpbGw9IiNiYmY3ZDAiIHN0cm9rZT0iIzE2YTM0YSIvPgogICAgPGcgY2xhc3M9Im0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMxNjY1MzQiIHN0eWxlPSJmb250LXNpemU6MTJweCI+PHRleHQgeD0iMzY1IiB5PSI0NTUiPmcwPC90ZXh0Pjx0ZXh0IHg9IjY4MiIgeT0iNDU1Ij5nMTwvdGV4dD48dGV4dCB4PSI5NjgiIHk9IjQ1NSI+ZzI8L3RleHQ+PHRleHQgeD0iMTI1MyIgeT0iNDU1Ij5nMzwvdGV4dD48L2c+CiAgICA8dGV4dCB4PSI0MCIgeT0iNDkyIiBjbGFzcz0ibGJsIiBmb250LXdlaWdodD0iNzAwIj5uZXcgKCs3IEIgaW4gZzEpPC90ZXh0PgogICAgPHJlY3QgeD0iMjAwIiB5PSI0NzgiIHdpZHRoPSIzMzAiIGhlaWdodD0iMjIiIGZpbGw9IiNiYmY3ZDAiIHN0cm9rZT0iIzE2YTM0YSIvPjxyZWN0IHg9IjUzMCIgeT0iNDc4IiB3aWR0aD0iMzEyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjZmVjYWNhIiBzdHJva2U9IiNkYzI2MjYiLz48cmVjdCB4PSI4NDIiIHk9IjQ3OCIgd2lkdGg9IjI2OCIgaGVpZ2h0PSIyMiIgZmlsbD0iI2JiZjdkMCIgc3Ryb2tlPSIjMTZhMzRhIi8+PHJlY3QgeD0iMTExMCIgeT0iNDc4IiB3aWR0aD0iMzAyIiBoZWlnaHQ9IjIyIiBmaWxsPSIjYmJmN2QwIiBzdHJva2U9IiMxNmEzNGEiLz4KICAgIDxnIGNsYXNzPSJtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBzdHlsZT0iZm9udC1zaXplOjEycHgiPjx0ZXh0IHg9IjM2NSIgeT0iNDkzIiBmaWxsPSIjMTY2NTM0Ij5nMCDinJM8L3RleHQ+PHRleHQgeD0iNjg2IiB5PSI0OTMiIGZpbGw9IiNiOTFjMWMiPmcx4oCyIOKAlCBjaGFuZ2VkLCBmZXRjaCBpdHMgcmVjb3JkczwvdGV4dD48dGV4dCB4PSI5NzYiIHk9IjQ5MyIgZmlsbD0iIzE2NjUzNCI+ZzIg4pyTIChzaGlmdGVkLCBzYW1lIGhhc2gpPC90ZXh0Pjx0ZXh0IHg9IjEyNjEiIHk9IjQ5MyIgZmlsbD0iIzE2NjUzNCI+ZzMg4pyTPC90ZXh0PjwvZz4KICA8L2c+CgogIDwhLS0gMy4gY29zdCAtLT4KICA8dGV4dCB4PSI0MCIgeT0iNTQ4IiBjbGFzcz0iaCI+MyDCtyBXaHkgdGhpcyBjaGFuZ2VzIHRoZSB0cmFkZS1vZmY8L3RleHQ+CiAgPHJlY3QgeD0iNDAiIHk9IjU2NCIgd2lkdGg9Ijc0MCIgaGVpZ2h0PSIxMjAiIHJ4PSI4IiBmaWxsPSIjZjlmYWZiIiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgPHRleHQgeD0iNTYiIHk9IjU4OCIgY2xhc3M9ImxibCIgZm9udC13ZWlnaHQ9IjcwMCI+YmxvY2ttYXA6ICJ2MiIgKGd6aXBwZWQgSlNPTik8L3RleHQ+CiAgPHRleHQgeD0iNTYiIHk9IjYxMiIgY2xhc3M9ImxibCI+Y29zdCBwZXIgdXBkYXRlIOKJiCA8dHNwYW4gY2xhc3M9Im51bSI+MjIgQiDDlyBldmVyeSBibG9jazwvdHNwYW4+LCB3aG9sZSBmaWxlLCBldmVyeSB0aW1lPC90ZXh0PgogIDx0ZXh0IHg9IjU2IiB5PSI2MzQiIGNsYXNzPSJsYmwiPjMyIE1CIGFzYXI6IDM4IEtCIGF0IDE2IEtpQiBibG9ja3Mg4oaSIDU2MCBLQiBhdCAxIEtpQiBibG9ja3M8L3RleHQ+CiAgPHRleHQgeD0iNTYiIHk9IjY2NCIgY2xhc3M9InMiPuKGkiBibG9ja3MgZmluZXIgdGhhbiB+OCBLaUIgY29zdCBtb3JlIG1hcCB0aGFuIHRoZXkgc2F2ZSBpbiBkYXRhOyBmbG9vciDiiYggOTYgS0IgLyBvbmUtbGluZSBjaGFuZ2U8L3RleHQ+CiAgPHJlY3QgeD0iODIwIiB5PSI1NjQiIHdpZHRoPSI3NDAiIGhlaWdodD0iMTIwIiByeD0iOCIgZmlsbD0iI2YxZjZmYyIgc3Ryb2tlPSIjMTU2NWMwIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogIDx0ZXh0IHg9IjgzNiIgeT0iNTg4IiBjbGFzcz0ibGJsIiBmb250LXdlaWdodD0iNzAwIj5ibG9ja21hcDogInYzIiAodGhlIGRlZmF1bHQgd2l0aCBlbGVjdHJvblVwZGF0ZXJDb21wYXRpYmlsaXR5ICI+PTciKTwvdGV4dD4KICA8dGV4dCB4PSI4MzYiIHk9IjYxMiIgY2xhc3M9ImxibCI+Y29zdCBwZXIgdXBkYXRlIOKJiCA8dHNwYW4gY2xhc3M9Im51bSI+c3VwZXIgdGFibGUgKyBlbnRyaWVzIG9mIGNoYW5nZWQgc3VwZXJzICsgcmVjb3JkcyBvZiBjaGFuZ2VkIGdyb3VwczwvdHNwYW4+PC90ZXh0PgogIDx0ZXh0IHg9IjgzNiIgeT0iNjM0IiBjbGFzcz0ibGJsIj4zMiBNQiBhc2FyLCBvbmUtbGluZSBjaGFuZ2U6IDIuMCBLQiBmaXJzdCByZXF1ZXN0ICsgMS4wIEtCIGVudHJpZXMgKyAxLjggS0IgcmVjb3JkcyA9IDx0c3BhbiBjbGFzcz0ibnVtIj40LjkgS0I8L3RzcGFuPiBvZiBtYXA8L3RleHQ+CiAgPHRleHQgeD0iODM2IiB5PSI2NjQiIGNsYXNzPSJzIj7ihpIgbWFwIGNvc3QgZ3Jvd3Mgd2l0aCB0aGUgY2hhbmdlLCBub3QgdGhlIGluc3RhbGxlciwgc28gNTEyIEIgYmxvY2tzIGZpbmFsbHkgcGF5OiA5LjEgS0IgdG90YWwgKDguNiBLQiBhbGlnbmVkKTwvdGV4dD4KCiAgPHJlY3QgeD0iNDAiIHk9IjcxMiIgd2lkdGg9IjE1MjAiIGhlaWdodD0iODYiIHJ4PSI4IiBmaWxsPSIjZjNmNGY2IiBzdHJva2U9IiNkMWQ1ZGIiLz4KICA8dGV4dCB4PSI1NiIgeT0iNzM4IiBjbGFzcz0ibGJsIiBmb250LXdlaWdodD0iNzAwIj5Db21wYXRpYmlsaXR5PC90ZXh0PgogIDx0ZXh0IHg9IjU2IiB5PSI3NjIiIGNsYXNzPSJsYmwiPuKAoiBPbmUgLmJsb2NrbWFwIHBlciBhcnRpZmFjdCwgZWl0aGVyIGZvcm1hdDsgZWxlY3Ryb24tdXBkYXRlciB0ZWxscyB0aGVtIGFwYXJ0IGJ5IHRoZSBmaXJzdCBieXRlcyAoPHRzcGFuIGNsYXNzPSJtIj5FQkIzPC90c3Bhbj4gdnMgZ3ppcCkuICAg4oCiIGxhdGVzdC55bWwgaXMgdW5jaGFuZ2VkLjwvdGV4dD4KICA8dGV4dCB4PSI1NiIgeT0iNzg0IiBjbGFzcz0ibGJsIj7igKIgZWxlY3Ryb24tdXBkYXRlciBiZWZvcmUgNy4wIGNhbm5vdCByZWFkIHYzIOKGkiBvbmUgZnVsbCBkb3dubG9hZCwgYW5kIHRoZSB1cGRhdGUgaXQgaW5zdGFsbHMgY2FuLiAgIOKAoiBTYW1lIGJsYWtlMmIgZGlnZXN0cyBhcyB2MiwganVzdCA4IGJ5dGVzOyB0aGUgZmluYWwgc2hhNTEyIG9mIHRoZSBpbnN0YWxsZXIgaXMgc3RpbGwgdGhlIHNhZmV0eSBuZXQuPC90ZXh0Pgo8L3N2Zz4K)

The `blockmap` option overrides the choice: `"v2"` always writes the JSON map, `"v3"` the binary map (the build fails when `electronUpdaterCompatibility` includes electron-updater versions before 7), and `"latest"` the newest format the range allows, so that a future format is picked up without a config change.

Compatibility: electron-updater tells the two formats apart by the file's first bytes, so `latest.yml` is the same for both. electron-updater before 7.0 cannot read `"v3"`: an app still on electron-updater 6 that receives a release with a binary map falls back to a full download once ("Cannot download differentially, fallback to full download"), and the update it installs brings an updater that can. From electron-updater 6.8.10 the next update is differential again when the artifact name includes `${version}`, as the default names do; 6.8.9 and earlier leave the old block map in their cache, which can make the next update a full download too. With an artifact name without the version (e.g. `"${productName} Setup.${ext}"`) the transition costs two full downloads: electron-updater 6 caches no map for the release it could not read, and the URL electron-updater 7 derives for the installed version's map (the new map's URL with the version replaced) is then the new map's own, so the next update is downloaded in full as well and caches its map ("…because the artifact name has no version: downloading the full update"); the update after it is differential. The same one-time full download happens whenever the format changes between two releases (the first release built with the other format, or a future format under `"latest"`), because blocks of maps in different formats are not compared; electron-updater 7 logs it once at `info`. Block maps embedded in an artifact (AppImage, the NSIS web installer's app package) are always `"v2"`.

```
{  "electronUpdaterCompatibility": ">=7",  "blockmap": "v3"}
```

The `"v3"` format pays off most for app-code changes when the asar is stored uncompressed and laid out so that a small edit does not shift the rest of the archive:

```
{  "nsis": { "differentialPackage": "store-asar" },  "asar": { "contentAlignment": 512 }}
```

`nsis.differentialPackage: "store-asar"` stores `resources/app.asar` uncompressed in the differential package (so a one-line change maps to a few changed blocks instead of a re-compressed archive), and `asar.contentAlignment` pads file contents inside the asar so that a file growing by a few bytes does not move the offsets of every later file. The `"v3"` format additionally starts a new block at every packed file of the stored asar, so an edit inside one file never touches a block of its neighbour, and in a build that writes it the 7z header of every differential package is stored as is and chunked on its own, so the CRCs that change with each build cost a few hundred bytes instead of the package's last block (a `"v2"` build packages exactly as electron-builder 26 did). With all of that, the `"v3"` rows of the repository benchmark (`test/src/differentialOneLineBenchTest.ts`) bring a one-line change in a 32 MB asar down to about ten kilobytes on the wire.

![What electron-updater fetches for a &quot;v3&quot; block map: header and super-group table, the entries and records of what changed, then the changed data ranges; any failure falls back to a full download](data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjkwMCIgdmlld0JveD0iMCAwIDE2MDAgOTAwIj4KICA8c3R5bGU+CiAgaHRtbCxib2R5e21hcmdpbjowO2JhY2tncm91bmQ6I2ZmZn0KICBzdmd7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSwiU2Vnb2UgVUkiLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmO2ZvbnQtc2l6ZToxNXB4O2ZpbGw6IzFmMjkzN30KICAudHtmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDB9Lmh7Zm9udC1zaXplOjE3cHg7Zm9udC13ZWlnaHQ6NzAwfS5ze2ZvbnQtc2l6ZToxM3B4O2ZpbGw6IzRiNTU2M30KICAubXtmb250LWZhbWlseTp1aS1tb25vc3BhY2UsTWVubG8sQ29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMi41cHh9LmxibHtmb250LXNpemU6MTNweDtmaWxsOiMzNzQxNTF9Lm51bXtmb250LXdlaWdodDo3MDB9Cjwvc3R5bGU+CiAgPHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iOTAwIiBmaWxsPSIjZmZmZmZmIi8+CiAgPGRlZnM+CiAgICA8bWFya2VyIGlkPSJhcnIiIHZpZXdCb3g9IjAgMCAxMCAxMCIgcmVmWD0iOSIgcmVmWT0iNSIgbWFya2VyV2lkdGg9IjgiIG1hcmtlckhlaWdodD0iOCIgb3JpZW50PSJhdXRvLXN0YXJ0LXJldmVyc2UiPjxwYXRoIGQ9Ik0wLDAgTDEwLDUgTDAsMTAgeiIgZmlsbD0iIzZiNzI4MCIvPjwvbWFya2VyPgogICAgPG1hcmtlciBpZD0iYXJyciIgdmlld0JveD0iMCAwIDEwIDEwIiByZWZYPSI5IiByZWZZPSI1IiBtYXJrZXJXaWR0aD0iOCIgbWFya2VySGVpZ2h0PSI4IiBvcmllbnQ9ImF1dG8tc3RhcnQtcmV2ZXJzZSI+PHBhdGggZD0iTTAsMCBMMTAsNSBMMCwxMCB6IiBmaWxsPSIjZGMyNjI2Ii8+PC9tYXJrZXI+CiAgPC9kZWZzPgogIDx0ZXh0IHg9IjQwIiB5PSI0NCIgY2xhc3M9InQiPmVsZWN0cm9uLXVwZGF0ZXIgd2l0aCBibG9ja21hcDogInYzIiDigJQgd2hhdCBnb2VzIG92ZXIgdGhlIHdpcmUgZm9yIGEgb25lLWxpbmUgY2hhbmdlPC90ZXh0PgogIDx0ZXh0IHg9IjQwIiB5PSI3MCIgY2xhc3M9InMiPkV2ZXJ5dGhpbmcgdG8gdGhlIHJpZ2h0IG9mICJyZWNvbnN0cnVjdCIgaXMgdGhlIGV4aXN0aW5nIGRpZmZlcmVudGlhbCBwaXBlbGluZSwgdW5jaGFuZ2VkLiBBbnkgZmFpbHVyZSBiZWZvcmUgaXQgZmFsbHMgYmFjayB0byBhIGZ1bGwgZG93bmxvYWQsIGFzIHRvZGF5LjwvdGV4dD4KCiAgPCEtLSBsYW5lcyAtLT4KICA8cmVjdCB4PSI0MCIgeT0iOTYiIHdpZHRoPSIzMzAiIGhlaWdodD0iNTYwIiByeD0iOCIgZmlsbD0iI2Y5ZmFmYiIgc3Ryb2tlPSIjOWNhM2FmIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogIDx0ZXh0IHg9IjIwNSIgeT0iMTIyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBjbGFzcz0ibGJsIiBmb250LXdlaWdodD0iNzAwIj5vbiB0aGUgdXNlcidzIG1hY2hpbmU8L3RleHQ+CiAgPHJlY3QgeD0iMTIzMCIgeT0iOTYiIHdpZHRoPSIzMzAiIGhlaWdodD0iNTYwIiByeD0iOCIgZmlsbD0iI2Y5ZmFmYiIgc3Ryb2tlPSIjOWNhM2FmIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogIDx0ZXh0IHg9IjEzOTUiIHk9IjEyMiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9ImxibCIgZm9udC13ZWlnaHQ9IjcwMCI+dXBkYXRlIHNlcnZlciAoc3RhdGljIGZpbGVzLCBIVFRQIFJhbmdlKTwvdGV4dD4KCiAgPCEtLSBsb2NhbCBpdGVtcyAtLT4KICA8cmVjdCB4PSI2MCIgeT0iMTQwIiB3aWR0aD0iMjkwIiBoZWlnaHQ9IjQ0IiByeD0iNiIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjNmI3MjgwIi8+PHRleHQgeD0iMjA1IiB5PSIxNTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJsYmwiPnByZXZpb3VzIGluc3RhbGxlci5leGUgKGNhY2hlZCk8L3RleHQ+PHRleHQgeD0iMjA1IiB5PSIxNzYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJzIiBzdHlsZT0iZm9udC1zaXplOjEycHgiPnNvdXJjZSBvZiBldmVyeSBDT1BZPC90ZXh0PgogIDxyZWN0IHg9IjYwIiB5PSIxOTYiIHdpZHRoPSIyOTAiIGhlaWdodD0iNDQiIHJ4PSI2IiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2YjcyODAiLz48dGV4dCB4PSIyMDUiIHk9IjIxNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9ImxibCI+Y3VycmVudC5ibG9ja21hcCAoY2FjaGVkIHByZXZpb3VzIG1hcCwgdjMpPC90ZXh0Pjx0ZXh0IHg9IjIwNSIgeT0iMjMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBjbGFzcz0icyIgc3R5bGU9ImZvbnQtc2l6ZToxMnB4Ij5ncm91cCBoYXNoZXMgKyByZWNvcmRzIG9mIHRoZSBwcmV2aW91cyByZWxlYXNlPC90ZXh0PgogIDwhLS0gc2VydmVyIGl0ZW1zIC0tPgogIDxyZWN0IHg9IjEyNTAiIHk9IjE0MCIgd2lkdGg9IjI5MCIgaGVpZ2h0PSI0NCIgcng9IjYiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzZiNzI4MCIvPjx0ZXh0IHg9IjEzOTUiIHk9IjE1OCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9ImxibCI+bGF0ZXN0LnltbCDigJQgdW5jaGFuZ2VkPC90ZXh0Pjx0ZXh0IHg9IjEzOTUiIHk9IjE3NiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9InMiIHN0eWxlPSJmb250LXNpemU6MTJweCI+dGhlIG1hcCBVUkwgaXMgZGVyaXZlZCBmcm9tIHRoZSBmaWxlIFVSTDwvdGV4dD4KICA8cmVjdCB4PSIxMjUwIiB5PSIxOTYiIHdpZHRoPSIyOTAiIGhlaWdodD0iNDQiIHJ4PSI2IiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2YjcyODAiLz48dGV4dCB4PSIxMzk1IiB5PSIyMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJsYmwiPm5ldyBpbnN0YWxsZXIuZXhlLmJsb2NrbWFwICh2Myk8L3RleHQ+PHRleHQgeD0iMTM5NSIgeT0iMjMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBjbGFzcz0icyIgc3R5bGU9ImZvbnQtc2l6ZToxMnB4Ij5oZWFkZXIgwrcgZ3JvdXAgdGFibGUgwrcgcmVjb3JkczwvdGV4dD4KICA8cmVjdCB4PSIxMjUwIiB5PSIyNTIiIHdpZHRoPSIyOTAiIGhlaWdodD0iNDQiIHJ4PSI2IiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2YjcyODAiLz48dGV4dCB4PSIxMzk1IiB5PSIyNzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGNsYXNzPSJsYmwiPm5ldyBpbnN0YWxsZXIuZXhlPC90ZXh0Pjx0ZXh0IHg9IjEzOTUiIHk9IjI4OCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgY2xhc3M9InMiIHN0eWxlPSJmb250LXNpemU6MTJweCI+c291cmNlIG9mIGV2ZXJ5IERPV05MT0FEIHJhbmdlPC90ZXh0PgoKICA8IS0tIHN0ZXBzIGluIHRoZSBtaWRkbGUgLS0+CiAgPGc+CiAgICA8cmVjdCB4PSI0MjAiIHk9IjE0MCIgd2lkdGg9Ijc2MCIgaGVpZ2h0PSI1NiIgcng9IjgiIGZpbGw9IiNmMWY2ZmMiIHN0cm9rZT0iIzE1NjVjMCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iMTYzIiBjbGFzcz0ibGJsIj48dHNwYW4gY2xhc3M9Im51bSI+MSDCtyBSYW5nZS1HRVQgdGhlIGhlYWRlciArIHN1cGVyLWdyb3VwIHRhYmxlPC90c3Bhbj4gIChzaXplIGVzdGltYXRlZCBmcm9tIHRoZSBjYWNoZWQgbWFwOyAy4oCTNjQgS2lCLCBvbmUgcmVxdWVzdCk8L3RleHQ+CiAgICA8dGV4dCB4PSI0MzYiIHk9IjE4NCIgY2xhc3M9InMiPjMyIE1CIGFzYXIgLyAzOCBzdXBlci1ncm91cHMgb2YgNzQxIGdyb3VwcyDihpIgPHRzcGFuIGNsYXNzPSJudW0iPjIuMCBLQjwvdHNwYW4+ICh0aGUgMiBLaUIgZmxvb3I7IHRoZSBzdXBlciB0YWJsZSBpcyAwLjYgS0IpPC90ZXh0PgogICAgPHBhdGggZD0iTTEyNTAsMjE0IEgxMjI1IFYxNjggSDExODIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzE1NjVjMCIgc3Ryb2tlLXdpZHRoPSIyIiBtYXJrZXItZW5kPSJ1cmwoI2FycikiLz4KCiAgICA8cmVjdCB4PSI0MjAiIHk9IjIxMiIgd2lkdGg9Ijc2MCIgaGVpZ2h0PSI1NiIgcng9IjgiIGZpbGw9IiNmMWY2ZmMiIHN0cm9rZT0iIzE1NjVjMCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iMjM1IiBjbGFzcz0ibGJsIj48dHNwYW4gY2xhc3M9Im51bSI+MiDCtyBNYXRjaCBzdXBlci1ncm91cHMsIHRoZW4gZ3JvdXBzPC90c3Bhbj4gYWdhaW5zdCB0aGUgY2FjaGVkIG1hcCBieSAoaGFzaCwgY291bnRzKTwvdGV4dD4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iMjU2IiBjbGFzcz0icyI+bWF0Y2hlZCDihpIgY29waWVkIGZyb20gdGhlIGxvY2FsIG1hcCwgemVybyBieXRlcyBvbiB0aGUgd2lyZSDCtyB1bm1hdGNoZWQg4oaSIGZldGNoIDEuMCBLQiBvZiBlbnRyaWVzICg0IHN1cGVyLWdyb3Vwcyk8L3RleHQ+CiAgICA8cGF0aCBkPSJNMzUwLDIxOCBIMzgwIFYyNDAgSDQxOCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNmI3MjgwIiBzdHJva2Utd2lkdGg9IjIiIG1hcmtlci1lbmQ9InVybCgjYXJyKSIvPgoKICAgIDxyZWN0IHg9IjQyMCIgeT0iMjg0IiB3aWR0aD0iNzYwIiBoZWlnaHQ9IjU2IiByeD0iOCIgZmlsbD0iI2YxZjZmYyIgc3Ryb2tlPSIjMTU2NWMwIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogICAgPHRleHQgeD0iNDM2IiB5PSIzMDciIGNsYXNzPSJsYmwiPjx0c3BhbiBjbGFzcz0ibnVtIj4zIMK3IFJhbmdlLUdFVCBvbmx5IHRoZSBjaGFuZ2VkIGdyb3VwcycgcmVjb3JkczwvdHNwYW4+ICAoYWRqYWNlbnQgZ3JvdXBzIGNvYWxlc2NlZDsg4omkIDIwMCByYW5nZXMgcGVyIG11bHRpcGFydCByZXF1ZXN0KTwvdGV4dD4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iMzI4IiBjbGFzcz0icyI+NCBjaGFuZ2VkIGdyb3VwcyDihpIgPHRzcGFuIGNsYXNzPSJudW0iPjEuOCBLQjwvdHNwYW4+IGluIDQgcmVxdWVzdHMgb24gR2l0SHViL1MzLWNsYXNzIGhvc3RzIChvbmUgcmVxdWVzdCBwZXIgcmFuZ2UpLCAxIHJlcXVlc3QgZWxzZXdoZXJlPC90ZXh0PgogICAgPHBhdGggZD0iTTEyNTAsMjI2IEgxMjEyIFYzMTIgSDExODIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzE1NjVjMCIgc3Ryb2tlLXdpZHRoPSIyIiBtYXJrZXItZW5kPSJ1cmwoI2FycikiLz4KCiAgICA8cmVjdCB4PSI0MjAiIHk9IjM1NiIgd2lkdGg9Ijc2MCIgaGVpZ2h0PSI1NiIgcng9IjgiIGZpbGw9IiNlY2ZkZjUiIHN0cm9rZT0iIzE2YTM0YSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iMzc5IiBjbGFzcz0ibGJsIj48dHNwYW4gY2xhc3M9Im51bSI+NCDCtyBSZWNvbnN0cnVjdCArIHZlcmlmeTwvdHNwYW4+ICBoZWFkZXIgKyBzdXBlcnMgKyBncm91cHMgKyByZWNvcmRzIOKGkiBldmVyeSBoYXNoLCBsZW5ndGggYW5kIGNvdW50IHJlLWNoZWNrZWQ8L3RleHQ+CiAgICA8dGV4dCB4PSI0MzYiIHk9IjQwMCIgY2xhc3M9InMiPnNhdmVkIGFzIHBlbmRpbmcvY3VycmVudC5ibG9ja21hcCDihpIgdGhlIGNhY2hlIGFmdGVyIGEgc3VjY2Vzc2Z1bCBpbnN0YWxsIMK3IHRoZW4gPHRzcGFuIGNsYXNzPSJtIj50b0Jsb2NrTWFwKCk8L3RzcGFuPiDihpIgdGhlIHYyIHNoYXBlPC90ZXh0PgoKICAgIDxyZWN0IHg9IjQyMCIgeT0iNDI4IiB3aWR0aD0iNzYwIiBoZWlnaHQ9IjU2IiByeD0iOCIgZmlsbD0iI2YzZjRmNiIgc3Ryb2tlPSIjNmI3MjgwIiBzdHJva2Utd2lkdGg9IjEuNSIvPgogICAgPHRleHQgeD0iNDM2IiB5PSI0NTEiIGNsYXNzPSJsYmwiPjx0c3BhbiBjbGFzcz0ibnVtIj41IMK3IGNvbXB1dGVPcGVyYXRpb25zKG9sZCwgbmV3KTwvdHNwYW4+IOKAlCBleGlzdGluZyBwbGFubmVyICsgaG9zdC1hd2FyZSBnYXAgY29hbGVzY2luZzwvdGV4dD4KICAgIDx0ZXh0IHg9IjQzNiIgeT0iNDcyIiBjbGFzcz0icyI+c2luZ2xlLXJhbmdlIGhvc3RzOiBnYXBzICZsdDsgOCBLaUIgZG93bmxvYWRlZCB0aHJvdWdoIChhIHJhbmdlIGNvc3RzIH4x4oCTMS41IEtCICsgMSBSVFQpOyBtdWx0aXBhcnQgaG9zdHM6ICZsdDsgMjU2IEI8L3RleHQ+CgogICAgPHJlY3QgeD0iNDIwIiB5PSI1MDAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNTYiIHJ4PSI4IiBmaWxsPSIjZjNmNGY2IiBzdHJva2U9IiM2YjcyODAiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICA8dGV4dCB4PSI0MzYiIHk9IjUyMyIgY2xhc3M9ImxibCI+PHRzcGFuIGNsYXNzPSJudW0iPjYgwrcgRG93bmxvYWQgY2hhbmdlZCBkYXRhIHJhbmdlcywgY29weSB0aGUgcmVzdDwvdHNwYW4+IOKAlCBleGlzdGluZyBEaWZmZXJlbnRpYWxEb3dubG9hZGVyLCB1bmNoYW5nZWQ8L3RleHQ+CiAgICA8dGV4dCB4PSI0MzYiIHk9IjU0NCIgY2xhc3M9InMiPm9uZS1saW5lIGNoYW5nZTogPHRzcGFuIGNsYXNzPSJudW0iPjIuNCBLQjwvdHNwYW4+IGluIDQgcmFuZ2VzICg3eiBoZWFkZXIgPSBpdHMgb3duIDQ0MiBCIGJsb2NrKSDCtyBmaW5hbCBzaGE1MTIgPSBpbnRlZ3JpdHkgY2hlY2s8L3RleHQ+CiAgICA8cGF0aCBkPSJNMTI1MCwyNzQgSDEyMDAgVjUyOCBIMTE4MiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNmI3MjgwIiBzdHJva2Utd2lkdGg9IjIiIG1hcmtlci1lbmQ9InVybCgjYXJyKSIvPgogICAgPHBhdGggZD0iTTM1MCwxNjIgSDM5MiBWNTI4IEg0MTgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzZiNzI4MCIgc3Ryb2tlLXdpZHRoPSIyIiBtYXJrZXItZW5kPSJ1cmwoI2FycikiLz4KCiAgICA8IS0tIGZhbGxiYWNrIC0tPgogICAgPHJlY3QgeD0iNDIwIiB5PSI1ODAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjZmVmMmYyIiBzdHJva2U9IiNkYzI2MjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICA8dGV4dCB4PSI0MzYiIHk9IjYwMyIgY2xhc3M9ImxibCIgZmlsbD0iIzk5MWIxYiI+PHRzcGFuIGNsYXNzPSJudW0iPkFueSBmYWlsdXJlIGluIDHigJM0IOKGkiBmdWxsIGRvd25sb2FkLCBhcyB0b2RheTwvdHNwYW4+PC90ZXh0PgogICAgPHRleHQgeD0iNDM2IiB5PSI2MjQiIGNsYXNzPSJzIj5IVFRQIOKJpSA0MDAgwrcgNDE2IMK3IHNob3J0IGJvZHkgwrcgbXVsdGlwYXJ0IG1pc21hdGNoIMK3IHBhcnNlL3ZlcmlmaWNhdGlvbiBlcnJvciDCtyBtYXBzIGluIGRpZmZlcmVudCBmb3JtYXRzIChvbmNlKTwvdGV4dD4KICAgIDxwYXRoIGQ9Ik00MjAsMzg0IEg0MDYgVjYxMCBINDE4IiBmaWxsPSJub25lIiBzdHJva2U9IiNkYzI2MjYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtZGFzaGFycmF5PSI2IDUiIG1hcmtlci1lbmQ9InVybCgjYXJycikiLz4KICA8L2c+CgogIDwhLS0gdG90YWxzIC0tPgogIDx0ZXh0IHg9IjQwIiB5PSI3MDAiIGNsYXNzPSJoIj5NZWFzdXJlZCB0b3RhbCBvbiB0aGUgd2lyZSAoMzIgTUIgYXNhciwgMywwMDEgZmlsZXM7IG1hcCArIGRhdGEgKyAxMjAgQiBwZXIgcmVxdWVzdCk8L3RleHQ+CiAgPGc+CiAgICA8cmVjdCB4PSI0MCIgeT0iNzE2IiB3aWR0aD0iMTUyMCIgaGVpZ2h0PSIyOCIgZmlsbD0iI2YzZjRmNiIgc3Ryb2tlPSIjZDFkNWRiIi8+CiAgICA8ZyBjbGFzcz0ibGJsIiBmb250LXdlaWdodD0iNzAwIj48dGV4dCB4PSI1NiIgeT0iNzM1Ij52YXJpYW50PC90ZXh0Pjx0ZXh0IHg9IjU2MCIgeT0iNzM1IiB0ZXh0LWFuY2hvcj0iZW5kIj52MiB0b2RheSAoYmVzdCk8L3RleHQ+PHRleHQgeD0iODYwIiB5PSI3MzUiIHRleHQtYW5jaG9yPSJlbmQiPnYzLCBhc2FyIDUxMiBC4oCTMiBLaUI8L3RleHQ+PHRleHQgeD0iMTIwMCIgeT0iNzM1IiB0ZXh0LWFuY2hvcj0iZW5kIj52MyArIDUxMiBCIGFzYXIgYWxpZ25tZW50PC90ZXh0PjwvZz4KICAgIDxnIGNsYXNzPSJsYmwiPjx0ZXh0IHg9IjU2IiB5PSI3NjUiPm9uZSBsaW5lIGNoYW5nZWQsIHNhbWUgbGVuZ3RoPC90ZXh0Pjx0ZXh0IHg9IjU2MCIgeT0iNzY1IiB0ZXh0LWFuY2hvcj0iZW5kIj45NiBLQjwvdGV4dD48dGV4dCB4PSI4NjAiIHk9Ijc2NSIgdGV4dC1hbmNob3I9ImVuZCIgY2xhc3M9Im51bSIgZmlsbD0iIzEyNThhOCI+OS4xIEtCPC90ZXh0Pjx0ZXh0IHg9IjEyMDAiIHk9Ijc2NSIgdGV4dC1hbmNob3I9ImVuZCIgY2xhc3M9Im51bSIgZmlsbD0iIzEyNThhOCI+OC42IEtCPC90ZXh0PjwvZz4KICAgIDxnIGNsYXNzPSJsYmwiPjx0ZXh0IHg9IjU2IiB5PSI3OTEiPm9uZSBsaW5lIGNoYW5nZWQsICs3IGJ5dGVzPC90ZXh0Pjx0ZXh0IHg9IjU2MCIgeT0iNzkxIiB0ZXh0LWFuY2hvcj0iZW5kIj40MDkgS0I8L3RleHQ+PHRleHQgeD0iODYwIiB5PSI3OTEiIHRleHQtYW5jaG9yPSJlbmQiPjMzMCBLQjwvdGV4dD48dGV4dCB4PSIxMjAwIiB5PSI3OTEiIHRleHQtYW5jaG9yPSJlbmQiIGNsYXNzPSJudW0iIGZpbGw9IiMxMjU4YTgiPjkuNiBLQjwvdGV4dD48L2c+CiAgICA8ZyBjbGFzcz0ibGJsIj48dGV4dCB4PSI1NiIgeT0iODE3Ij4rNjAwIEIgZWRpdCDCtyBuZXcgMiBLQiBmaWxlPC90ZXh0Pjx0ZXh0IHg9IjU2MCIgeT0iODE3IiB0ZXh0LWFuY2hvcj0iZW5kIj40MDjigJM0NDAgS0I8L3RleHQ+PHRleHQgeD0iODYwIiB5PSI4MTciIHRleHQtYW5jaG9yPSJlbmQiPjMzMeKAkzM1NiBLQjwvdGV4dD48dGV4dCB4PSIxMjAwIiB5PSI4MTciIHRleHQtYW5jaG9yPSJlbmQiPjMzM+KAkzM1NyBLQjwvdGV4dD48L2c+CiAgICA8dGV4dCB4PSIxMjIwIiB5PSI3NjUiIGNsYXNzPSJzIiBzdHlsZT0iZm9udC1zaXplOjEycHgiPm1hcCA0LjkgS0IgKyBkYXRhIDIuNCBLQjwvdGV4dD4KICAgIDx0ZXh0IHg9IjEyMjAiIHk9Ijc5MSIgY2xhc3M9InMiIHN0eWxlPSJmb250LXNpemU6MTJweCI+aGVhZGVyIHN0YWJsZSAoYWxpZ25tZW50KSwgZWRpdCBpbiBpdHMgb3duIGJsb2NrczwvdGV4dD4KICAgIDx0ZXh0IHg9IjEyMjAiIHk9IjgxNyIgY2xhc3M9InMiIHN0eWxlPSJmb250LXNpemU6MTJweCI+Zmxvb3IgPSBhc2FyIEpTT04gaGVhZGVyIChvZmZzZXRzIHNoaWZ0KTwvdGV4dD4KICA8L2c+CiAgPHRleHQgeD0iNDAiIHk9Ijg2MCIgY2xhc3M9InMiPk5vIGNhY2hlZCBtYXAgKGZyZXNoIGluc3RhbGwsIG9yIGEgdjIgY2FjaGUpOiB0aGUgbmV3IG1hcCBhbmQgdGhlbiB0aGUgb2xkIG9uZSBhcmUgZG93bmxvYWRlZCB3aG9sZSAofjEwIEIvYmxvY2spLCB0aGVuIGNvbXBhcmVkLiBWZWxvcGFjaydzIHpzdGQgZGVsdGFzOiAzLjbigJMxMSBLQiBvbiB0aGUgc2FtZSBlZGl0czsgdGhlIGdhcCBpcyBibG9jayBncmFudWxhcml0eSBwbHVzIHRoZSBtYXAuPC90ZXh0Pgo8L3N2Zz4K)

How this compares with per-version delta packages (Squirrel, Velopack): those frameworks compute a binary patch between two specific releases on the build machine and publish one delta file per consecutive version pair, which a client applies in sequence from the exact release it has installed. The patch itself is small (a zstd `--patch-from` diff of a one-line change is a few kilobytes), but every release pair needs its own artifact, a client that skipped releases applies several of them, and the old release must still be present in full. A block map describes a single artifact independently of any previous version: one `.blockmap` per installer serves updates from any older version, the server only needs HTTP `Range` support, and the cost of an update is a handful of kilobytes of map plus the changed blocks. The repository benchmark reports both side by side for the same synthetic app.

![Per-version delta packages versus block maps: what is published, what a client downloads, measured bytes for the same edits](/assets/images/blockmap-v3-vs-delta-a83964c161139295cc3ed030bc8d1d94.svg)

electron-updater also downloads through small gaps between changed ranges (copy gaps below 8 KiB are fetched rather than copied, saving one request per gap on hosts such as GitHub or S3 that serve a single range per request) and never puts more than 200 ranges into one `multipart/byteranges` request (Apache's default `MaxRanges`).

## Private GitHub Update Repo[​](#private-github-update-repo "Direct link to Private GitHub Update Repo")

You can use a private repository for updates with electron-updater by setting the `GH_TOKEN` environment variable (on user machine) and `private` option. If `GH_TOKEN` is set, electron-updater will use the GitHub API for updates allowing private repositories to work.

warning

Private GitHub provider only for [very special](https://github.com/electron-userland/electron-builder/issues/1393#issuecomment-288191885) cases — not intended and not suitable for all users.

note

The GitHub API currently has a rate limit of 5000 requests per user per hour. An update check uses up to 3 requests per check.

## Events[​](#events "Direct link to Events")

The `autoUpdater` object emits the following events:

#### Event: `error`[​](#event-error "Direct link to event-error")

-   `error` Error

Emitted when there is an error while updating.

#### Event: `checking-for-update`[​](#event-checking-for-update "Direct link to event-checking-for-update")

Emitted when checking if an update has started.

#### Event: `update-available`[​](#event-update-available "Direct link to event-update-available")

-   `info` [UpdateInfo](#updateinfo) (for generic and github providers) Emitted when there is an available update. The update is downloaded automatically if `autoDownload` is `true`.

#### Event: `update-not-available`[​](#event-update-not-available "Direct link to event-update-not-available")

Emitted when there is no available update.

-   `info` [UpdateInfo](#updateinfo) (for generic and github providers)

#### Event: `download-progress`[​](#event-download-progress "Direct link to event-download-progress")

-   `progress` ProgressInfo
    -   `bytesPerSecond`
    -   `percent`
    -   `total`
    -   `transferred`

Emitted on progress.

#### Event: `update-downloaded`[​](#event-update-downloaded "Direct link to event-update-downloaded")

-   `info` [UpdateInfo](#updateinfo) — for generic and github providers.

#### Event: `update-cancelled`[​](#event-update-cancelled "Direct link to event-update-cancelled")

-   `info` [UpdateInfo](#updateinfo)

Emitted when an update is cancelled by the user or the download is otherwise aborted.

#### Event: `appimage-filename-updated`[​](#event-appimage-filename-updated "Direct link to event-appimage-filename-updated")

-   `path` string

Emitted after a successful AppImage update when the file is moved to its final location. Only fires on Linux AppImage builds.

## UpdateInfo[​](#updateinfo "Direct link to UpdateInfo")

# Interface: UpdateInfo

## Extended by[​](#extended-by "Direct link to Extended by")

-   [`UpdateDownloadedEvent`](/docs/api/electron-updater.Interface.UpdateDownloadedEvent)

## Properties[​](#properties "Direct link to Properties")

### files[​](#files "Direct link to files")

> `readonly` **files**: [`UpdateFileInfo`](/docs/api/electron-updater.Interface.UpdateFileInfo)\[\]

---

### minimumSystemVersion?[​](#minimumsystemversion "Direct link to minimumSystemVersion?")

> `readonly` `optional` **minimumSystemVersion?**: `string`

The minimum version of system required for the app to run. Sample value: macOS `23.1.0`, Windows `10.0.22631`. Same with os.release() value, this is a kernel version.

---

### path?[​](#path "Direct link to path")

> `readonly` `optional` **path?**: `string`

Legacy top-level download descriptor for electron-updater 1.x – 2.15.0. Modern clients read `files`. Only emitted when `electronUpdaterCompatibility` includes legacy clients, so it may be absent.

#### Deprecated[​](#deprecated "Direct link to Deprecated")

---

### releaseDate[​](#releasedate "Direct link to releaseDate")

> **releaseDate**: `string`

The release date.

---

### releaseName?[​](#releasename "Direct link to releaseName?")

> `optional` **releaseName?**: `string` | `null`

The release name.

---

### releaseNotes?[​](#releasenotes "Direct link to releaseNotes?")

> `optional` **releaseNotes?**: `string` | [`ReleaseNoteInfo`](/docs/api/builder-util-runtime.Interface.ReleaseNoteInfo)\[\] | `null`

The release notes. List if `updater.fullChangelog` is set to `true`, `string` otherwise.

---

### sha512?[​](#sha512 "Direct link to sha512")

> `readonly` `optional` **sha512?**: `string`

Legacy top-level checksum for electron-updater 1.x – 2.15.0. Modern clients read `files[].sha512`. Only emitted when `electronUpdaterCompatibility` includes legacy clients, so it may be absent.

#### Deprecated[​](#deprecated-1 "Direct link to Deprecated")

---

### signature?[​](#signature "Direct link to signature?")

> `readonly` `optional` **signature?**: `string`

Base64-encoded Ed25519 signature over the manifest's integrity-critical fields, populated at publish time when update manifest signing is enabled. Verified by electron-updater against the configured `updateManifestPublicKey` before any download starts. See `canonicalizeForSigning`.

Always the signature of the *first* configured signing key; `signatures` carries the same value (tagged with its key id) plus one entry per additional signing key. Kept so updaters that only know this single-signature form keep verifying.

---

### signatures?[​](#signatures "Direct link to signatures?")

> `readonly` `optional` **signatures?**: [`UpdateManifestSignature`](/docs/api/builder-util-runtime.Interface.UpdateManifestSignature)\[\]

One Ed25519 signature per signing key the manifest was signed with, each tagged with the id of the key that produced it (see `computeUpdateManifestKeyId`). All entries sign the same canonical payload. A manifest carrying several entries is "dual-signed": an install verifies it as long as *any* of its trusted keys matches *any* entry, which is what makes key rotation possible without a flag day.

---

### stagingPercentage?[​](#stagingpercentage "Direct link to stagingPercentage?")

> `readonly` `optional` **stagingPercentage?**: `number`

The [staged rollout](https://www.electron.build/docs/features/auto-update#staged-rollouts) percentage, 0-100.

---

### version[​](#version "Direct link to version")

> `readonly` **version**: `string`

The version.

[Edit this page](https://github.com/electron-userland/electron-builder/edit/master/website/docs/features/auto-update.md)

[

Previous

Electron Forge

](/docs/features/electron-forge)[

Next

Signed Update Manifests

](/docs/features/signed-update-manifests)

-   [Auto-updatable Targets](#auto-updatable-targets)
-   [Differences between electron-updater and built-in autoUpdater](#differences-between-electron-updater-and-built-in-autoupdater)
-   [Quick Setup Guide](#quick-setup-guide)
-   [Examples](#examples)
    -   [Custom Options instantiating updater Directly](#custom-options-instantiating-updater-directly)
    -   [Custom downloaded-file verification](#custom-downloaded-file-verification)
-   [Install on Next Launch (Windows/Linux)](#install-on-next-launch-windowslinux)
    -   [Per-target behavior](#per-target-behavior)
-   [Debugging](#debugging)
-   [Compatibility](#compatibility)
-   [Update security options](#update-security-options)
    -   [`disableWebInstaller` (now defaults to `true`)](#disablewebinstaller-now-defaults-to-true)
    -   [`allowUnverifiedLinuxPackages` (new)](#allowunverifiedlinuxpackages-new)
-   [Staged Rollouts](#staged-rollouts)
-   [File Generated and Uploaded in Addition](#file-generated-and-uploaded-in-addition)
    -   [Differential updates: `.blockmap`](#differential-updates-blockmap)
-   [Private GitHub Update Repo](#private-github-update-repo)
-   [Events](#events)
-   [UpdateInfo](#updateinfo)
-   [Extended by](#extended-by)
-   [Properties](#properties)
    -   [files](#files)
    -   [minimumSystemVersion?](#minimumsystemversion)
    -   [path?](#path)
    -   [releaseDate](#releasedate)
    -   [releaseName?](#releasename)
    -   [releaseNotes?](#releasenotes)
    -   [sha512?](#sha512)
    -   [signature?](#signature)
    -   [signatures?](#signatures)
    -   [stagingPercentage?](#stagingpercentage)
    -   [version](#version)

Docs

-   [Overview](/docs)
-   [CLI](/docs/cli)
-   [Configuration](/docs/configuration)

Community

-   [GitHub Issues](https://github.com/electron-userland/electron-builder/issues)
-   [npm](https://www.npmjs.com/package/electron-builder)

Donate

-   [Donate](https://www.electron.build/docs/donate)

Copyright © 2026 electron-builder contributors. Built with Docusaurus.