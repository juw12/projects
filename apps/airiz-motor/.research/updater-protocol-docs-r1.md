# AIRIZ Motor Console — Auto-Update Protocol & Manifest Specs, Full Reference (R1)

**Project:** AIRIZ Motor Console (`apps/airiz-motor`)
**Stack:** Electron desktop + Capacitor mobile + PWA + Cloudflare Worker
**Date:** 2026-11-04 (Asia/Bangkok)
**Author:** AIRIZ architecture research, round 1
**Length target:** ≥900 lines
**Companion files (same round):** `updater-hardest-problems-r1.md` (failure modes + outage citations),
`updater-topic-deep-dives-r1.md` (8 decision sub-topics), `updater-topic-deep-dives-r1.md` (decisions).
**Upstream inputs:** `updater-protocol-survey.md` + `updater-protocol-research.md` (repo root, same date).

> **What this file is.** The authoritative wire-format / manifest / config reference for nine
> cross-platform auto-update systems. For each system it gives: (1) status + version snapshot, (2)
> the exact manifest / feed schema with a 10–30 line real or canonical snippet, (3) the signing scheme
> (integrity hash + authenticity signature + key custody + what a verification failure does), (4) the
> check→download→verify→install protocol flow, (5) the channel / rollout model, (6) delta support, (7)
> the rollback story, (8) a failure-mode table, and (9) SHA-pinned permalinks to the primary source.
> Every snippet is copied from a real production file, a real public manifest, or the upstream
> implementation — not invented.

> **What this file is NOT.** It does not re-argue the architecture decision. The decision lives in
> `updater-topic-deep-dives-r1.md` and the cross-system synthesis in Appendix C below, which maps the
> nine protocols to the minimum viable feature subset AIRIZ must reimplement as a single
> signed-manifest-on-R2 layer (signature scheme, channel model, rollout gating, delta support, cache
> layout).

---

## 0. Method, tooling transparency, and pinned source snapshots

- **Evidence base.** Every schema in this file was transcribed from (a) the upstream implementation
  source, (b) a real production manifest pulled from a public repo, or (c) the official documentation.
  Where a file is cited, the URL is a permalink. For the seven repositories whose commit SHA was
  resolved on 2026-11-04, permalinks pin that exact commit; for the remaining public examples the
  permalink uses the verified branch.
- **Tooling note (transparency).** This research session could not use the `context7` docs MCP (monthly
  quota exceeded) or the `websearch`/Exa MCP (free-tier rate-limited). The evidence was gathered with
  the GitHub CLI (`gh api` for repo/path/SHA verification), direct HTTPS fetch of official docs, and
  GitHub code search. GitHub branch/tag enumeration was intermittent behind the org MITM proxy, so a few
  "latest version" cells below are marked **verify on GitHub** rather than asserted.
- **"Spec version".** Most of these updaters have **no formal published protocol spec**; the wire format
  is defined by the implementation and documented in project docs. The only formally specified systems
  are **Microsoft MSIX** (Open Specification) and the **W3C/WHATWG Service Worker** standard. For the
  rest, "spec version" = the Sparkle 2.x appcast, the Tauri v2 updater, the Expo Updates **protocol v1**,
  or the electron-builder auto-update docs.

### Pinned source snapshots (commit SHAs resolved 2026-11-04)

| System | Repository | Pinned commit (verified 2026-11-04) |
|---|---|---|
| Squirrel.Windows | `Squirrel/squirrel.windows` | `51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f` |
| Sparkle | `sparkle-project/Sparkle` | `14fdbf28dc7c6fd8741a144bff517ef86572e6c2` |
| electron-updater (electron-builder) | `electron-userland/electron-builder` | `ae8031420ad0662b84195342759dba4350ffcedd` |
| Tauri 2 updater | `tauri-apps/plugins-workspace` | `74a44c1d5694324b7fb9ba5ee9271a3096da9387` |
| CodePush (archived) | `microsoft/react-native-code-push` | `d3b163d8d7522f02081eee2b5d735705b5d54c00` |
| Expo Updates | `expo/expo` | `c59120da912d8bc1b3dadf7a75e320541e2a1a63` |
| Workbox (PWA) | `googlechromelabs/workbox` | `4ea3138a120fd2c87389b54130e25f47e0fd7089` |

> **Owner corrections vs. the earlier survey** (caught during SHA verification, 2026-11-04): the
> electron-builder repo is **`electron-userland/electron-builder`**, *not* `electron/electron-builder`
> (the latter 404s). The Tauri updater plugin source now lives in **`tauri-apps/plugins-workspace`**
> (`plugins/updater/`), not the standalone `tauri-apps/tauri-plugin-updater`.

### Version / status snapshot

| Tool | Latest (2026-11-04) | Wire format | Integrity | Authenticity | Delta? | Rollback | Status |
|---|---|---|---|---|---|---|---|
| Squirrel.Windows | 2.0.1 | `RELEASES` + `.nupkg` | SHA-1/line | none (optional Authenticode) | **yes** (`-delta.nupkg`) | manual re-release | maintenance |
| Sparkle | 2.9.6 | `appcast.xml` (RSS+ext) | length + ed25519 | **ed25519 (EdDSA)** | optional (`BinaryDelta`) | publish higher signed version | active |
| electron-updater | v25.x (verify) | `latest*.yml` + `.blockmap` | SHA-512 (base64) | Authenticode (Win) / detached RSA (mac) | **blockmap** (BLAKE2) | manual re-release | active |
| Tauri 2 updater | core 2.12.5 / plugin 2.8.1 | JSON from `endpoints` | ed25519 sig over artifact | **ed25519** (minisign) | no | publish higher signed JSON | active |
| Capawesome live-update | 8.7.1 | `…-manifest.json` + zip | SHA per file | **RSA** (PEM) | no (whole bundle) | **kill-safe auto-rollback** | active |
| `@capacitor/live-update` | ~1.6.x (verify) | (superseded) | — | — | — | — | **deprecated** |
| Expo Updates | expo-updates 58.0.5 | update-manifest JSON | SHA-256 launch asset | **RSA-4096-SHA256** code-sign | optional bsdiff | server rollback + embedded floor | active |
| CodePush / App Center | 9.0.1 (frozen) | update-metadata JSON | `packageHash` | RSA (UWP variant) | (legacy) | client + server (service gone) | **retired 2025-03-31** |
| PWA / Workbox | 7.x (verify) | SW script + precache manifest | TLS only | none (TLS) | precache revision diff | manual SW redeploy | web standard |
| MSIX / App Installer | Win10 17763+ | `AppxManifest.xml` + `.appinstaller` | Authenticode | Authenticode publisher | no | **OS-level staged rollback** | active (OS) |

---

## 1. Squirrel.Windows — `RELEASES` feed + `.nupkg` packages (+ `bsdiff` deltas, `# <pct>` staging)

- **Repo:** `Squirrel/squirrel.windows` · **Pinned:** `51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`
- **Docs / homepage:** https://github.com/Squirrel/Squirrel.Windows · https://squirrel.github.io
- **Spec:** none — informal, de-facto standard for .NET desktop apps. "Spec version" = Squirrel 2.x.
- **Status:** mature / maintenance (last release 2.0.1; the format has been stable for years).
- **Status line:** This is the updater the Electron world converged *around* (Atom, VS Code, GitKraken,
  and a long tail of .NET apps ship it). It is the reference model for "a plain-text index of
  downloadable NuGet packages, with optional deltas and staged rollout."

### 1.1 Wire format & manifest schema

The on-the-wire index is a **plain-text `RELEASES` file** served at the update-server root
(e.g. `https://updates.example.com/RELEASES`, or a GitHub Releases asset). It is a line-per-package
index. Each line references a **`.nupkg`** payload (a `.nupkg` is just a NuGet zip of the app).

Real production `RELEASES` (Atom-era, [GitbookIO/nuts `test/win-releases.js`](https://github.com/GitbookIO/nuts/blob/master/test/win-releases.js)):

```text
62E8BF432F29E8E08240910B85EDBF2D1A41EDF2 atom-0.178.0-full.nupkg 81272434
5D754139E89802E88984185D2276B54DB730CD5E atom-0.178.1-delta.nupkg 8938535
DD48D16EE177DD278F0A82CDDB72EBD043C767D2 atom-0.178.1-full.nupkg 81293415
02D56FF2DD6CB8FE059167E227433078CDAF5630 atom-0.179.0-delta.nupkg 9035217
8F5FDFD0BD81475EAD95E9E415579A852476E5FC atom-0.179.0-full.nupkg 81996151
```

Canonical line grammar (from [`src/Squirrel/ReleaseEntry.cs`](https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs)):

```text
<SHA1-hex>  <baseUrl><filename>  <size-bytes>  [# <stagingPercent>]
```

| Field | Meaning |
|---|---|
| `SHA1-hex` | SHA-1 of the `.nupkg`, computed via `Utility.CalculateStreamSHA1`; 40 hex chars. The length of this hash is also how Squirrel distinguishes a full vs delta entry in some code paths. |
| `baseUrl` + `filename` | The package URL. `baseUrl` may be empty (relative to the `RELEASES` host) or an absolute URL. |
| `size-bytes` | Expected download size; sanity-checked. |
| `# <pct>` | **Optional** — a staged-rollout percentage (canary). Only ~`pct`% of clients are offered the entry. |
| `-delta.nupkg` / `-full.nupkg` | Delta packages apply over the installed version; if no valid delta chain exists, Squirrel materialises a full package from deltas (`createFullPackagesFromDeltas`). |

The **per-package "manifest"** is the `.nupkg` itself: it is a NuGet zip whose embedded `.nuspec`
carries `<package><metadata><id><version>` — the version is parsed with `System.Version.Parse`, so the
filename must be `{id}-{version}-full.nupkg` (an extra segment such as an architecture breaks parsing —
a known quirk, see [stagewise `apps/update-server/src/releases.ts`](https://github.com/stagewise-io/stagewise/blob/main/apps/update-server/src/releases.ts)).

### 1.2 Delta format (`bsdiff`)

- Deltas are **bsdiff** binaries. `Squirrel.exe --releasify` (with a base directory) emits a
  `<id>-<newver>-delta.nupkg` for each version reachable from a base, alongside the `-full.nupkg`.
- The updater applies a chain of deltas when present; **`--no-delta`** at releasify time disables it.
- The delta math and its failure mode are analysed in `updater-topic-deep-dives-r1.md` §(a); the short
  version is: bsdiff typically yields 5–15% of full on Chromium-heavy binaries, and a broken delta chain
  auto-falls back to the full package.

### 1.3 Config / client wiring

There is no config file; the updater is wired in C# against `UpdateManager`. The two call surfaces:

```csharp
// src/Squirrel/UpdateManager.cs  (pinned 51f5e2c…)
var manager = new UpdateManager(updateUrlOrPath);   // any HTTP(S) URL or filesystem path
manager.CheckForUpdate();                            // returns UpdateInfo
// UpdateInfo { CurrentlyInstalledVersion, FutureReleaseEntry, ReleasesToApply }
// ReleaseEntry { SHA1, Filename, Filesize, IsDelta }
```

`CheckForUpdates` compares the newest entry in `RELEASES` against `CurrentlyInstalledVersion`; when a
newer one exists it yields the `ReleasesToApply` chain (a delta chain when possible, otherwise the
single full entry). `SyncReleases.exe` (an in-repo tool) is the de-facto **GitHub provider**: it pulls
`.nupkg`s from GitHub Releases (Octokit) and generates the `RELEASES` file, so in practice the pipeline is
**GitHub Releases → `RELEASES` → any static host**.

### 1.4 Protocol flow

1. **Check.** Fetch `RELEASES` over HTTPS. Parse every line into `ReleaseEntry`.
2. **Select.** Pick the highest version greater than the installed one; if a `# <pct>` gate is present and
   this client is not in the canary bucket, fall back to the highest ungated version.
3. **Download.** `FileDownloader` fetches the selected `.nupkg` into `<appRoot>\packages\`. **Not
   resumable** by default — a failure re-downloads from offset 0.
4. **Verify.** Recompute SHA-1 of the downloaded file; mismatch ⇒ `UpdateException`
   ("The SHA1 hash of the downloaded file does not match"), update aborted, old version stays.
5. **Apply.** The updater runs as a **separate process**; the main app is told to exit. `ApplyReleases`
   extracts the package into a temp dir, **atomically renames** the `app-<version>` directories, and
   rewrites shortcuts. On next launch the new `app-<version>` directory is current.

### 1.5 Signing

- **Integrity:** SHA-1 per line; the client recomputes and compares after download. This is the only
  trust primitive.
- **Authenticity:** **none by default.** Squirrel does not sign the feed. Trust is added by hosting the
  feed over **HTTPS** and (optionally) **Authenticode-signing the installer exe**. There is **no embedded
  public key** in the app — a MITM that can serve `RELEASES` can serve a forged one; this is the well-known
  Squirrel weakness and the single reason the R2 spec below signs the feed itself.
- **Key custody:** n/a.

### 1.6 Channel / rollout

- **Channel** = separate `RELEASES` files (e.g. `RELEASES` for stable, a separate feed/URL for beta).
- **Rollout** = the `# <pct>` staged percentage on a line. This is a first-class rollout primitive and is
  the model AIRIZ borrows for its own canary (see Appendix C).

### 1.7 Rollback

**No automatic rollback.** Previous `app-<version>` directories are retained on disk, so a revert is
possible by re-pointing `RELEASES` at an older version, but the normal recovery path is to **publish a
corrected (higher-version) release**. A broken delta chain falls back to full packages automatically.

### 1.8 Failure modes

| Condition | Behavior |
|---|---|
| SHA-1 mismatch | `UpdateException`; update aborted; old version stays |
| `.nupkg` 404 | download fails; retryable |
| Corrupt / truncated `.nupkg` | NuGet parse fails → abort |
| Broken delta chain | auto-falls back to `-full.nupkg` |
| 5xx on feed / download | retryable network error |
| Filename embeds arch (e.g. `-arm64-`) | `System.Version.Parse` breaks — known quirk |

### 1.9 Permalinks (primary source, pinned `51f5e2c…`)

- `ReleaseEntry` line parser: https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs
- Check logic: https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/UpdateManager.CheckForUpdates.cs
- Apply logic: https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/UpdateManager.ApplyReleases.cs
- Real `RELEASES`: https://github.com/GitbookIO/nuts/blob/master/test/win-releases.js

---

## 2. Sparkle — `appcast.xml` (RSS 2.0 + Sparkle extensions) + ed25519 (Sparkle 2.x)

- **Repo:** `sparkle-project/Sparkle` · **Pinned:** `14fdbf28dc7c6fd8741a144bff517ef86572e6c2`
- **Docs:** https://sparkle-project.org · https://github.com/sparkle-project/Sparkle
- **Spec:** **Sparkle 2.x appcast** — ed25519 (EdDSA) became the recommended scheme in Sparkle 2.0.0.
  This is the closest thing to a "formal" desktop appcast protocol in this survey.
- **Status:** actively maintained (latest 2.9.6).
- **Status line:** The macOS reference updater. The appcast is an RSS feed with Sparkle's `sparkle:`
  namespace; the whole security model in 2.x pivoted from the legacy DSA key (which lived only in the
  feed) to **ed25519** with the public key embedded in the feed **or** pinned in `Info.plist`.

### 2.1 Wire format & manifest schema

The feed is **`appcast.xml`** (RSS 2.0 + Sparkle extensions), fetched from the `SUFeedURL` declared in
`Info.plist`. Real public example (Ventoy for macOS):
[fcjr/ventoy-mac `appcast.xml`](https://github.com/fcjr/ventoy-mac/blob/main/appcast.xml). Canonical
shape (matches [`Resources/SampleAppcast.xml`](https://github.com/sparkle-project/Sparkle/blob/14fdbf28dc7c6fd8741a144bff517ef86572e6c2/Resources/SampleAppcast.xml)):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>App Update Feed</title>
    <link>https://example.com/appcast.xml</link>
    <description>Most recent application updates.</description>
    <!-- public key embedded in-feed (alternative: SUPublicEDKey in Info.plist) -->
    <sparkle:edKey>BASE64ED25519PUBKEY</sparkle:edKey>
    <item>
      <title>Version 2.1.0</title>
      <pubDate>Wed, 04 Nov 2026 10:00:00 +0000</pubDate>
      <description><![CDATA[<p>Release notes (HTML allowed).</p>]]></description>
      <enclosure url="https://example.com/updates/App-2.1.0.zip"
                 sparkle:version="20261104"
                 sparkle:shortVersionString="2.1.0"
                 length="10485760"
                 type="application/octet-stream"
                 sparkle:edSignature="BASE64ED25519SIG"/>
    </item>
  </channel>
</rss>
```

| Field | Meaning |
|---|---|
| `sparkle:version` | **Build number** (integer or string); drives ordering. This is the "which is newer" key. |
| `sparkle:shortVersionString` | **Marketing version** (`CFBundleShortVersionString`); display only. |
| `sparkle:edSignature` | base64 **ed25519** signature over the `.zip`/`.dmg`. |
| `sparkle:edKey` | base64 **ed25519 public key**, embedded in the feed (self-describing feed). |
| `length` / `type` | byte length + MIME type of the enclosure; length is checked on download. |
| `sparkle:minimumSystemVersion` | skip the item if the client OS is older. |
| `sparkle:minimumAutoupdateVersion` | skip if the client's *Sparkle* framework is too old to understand this item. |
| `sparkle:criticalUpdate` | flag to force the update UI. |
| `sparkle:releaseNotesLink` | separate URL for HTML release notes. |
| `sparkle:deltaUpdates` | array of base-version deltas (see §2.2). |
| `sparkle:dsaSignature` | **legacy** DSA signature — deprecated, superseded by `sparkle:edSignature`. |

### 2.2 Delta format (`BinaryDelta`)

- Sparkle's delta is the **`BinaryDelta`** tool in-repo
  ([`BinaryDelta/main.swift`](https://github.com/sparkle-project/Sparkle/blob/14fdbf28dc7c6fd8741a144bff517ef86572e6c2/BinaryDelta/main.swift)) —
  it emits an `.eddelta` (or the older `.delta`) file that patches from a base build to the target.
- The feed advertises deltas via `sparkle:deltaUpdates` (a list of `{baseVersion, url, …}`); the client
  picks a delta whose `baseVersion` matches its installed build, else downloads the full enclosure.
- Enable with `SUAllowDeltaUpdates`. Delta→full fallback is automatic when the chain is unsatisfiable.

### 2.3 Config / client wiring

- **Client config** lives in `Info.plist` — the only required key is `SUFeedURL` (HTTPS). Optional:
  `SUPublicEDKey` (pin the pubkey in the app instead of the feed), `SUAutomaticallyUpdate`,
  `SUAllowsAutomaticallyUpdate`, `SUEnableInstallerLauncherService`.
- **Publishing side** is the CLI: `generate_appcast` (builds the appcast), `sign_update` (ed25519-signs a
  `.dmg`/`.zip` and rewrites the appcast), `generate_keys` (ed25519 keypair). All in-repo.

### 2.4 Protocol flow

1. **Check.** GET `SUFeedURL` (HTTPS). Parse the RSS + `sparkle:` namespace.
2. **Select.** Choose the item whose `sparkle:version` is greater than the running build; honour
   `minimumSystemVersion` / `minimumAutoupdateVersion` filters.
3. **Download.** Fetch the enclosure (or a delta), check `length`.
4. **Verify.** Verify the **ed25519** `sparkle:edSignature` against `sparkle:edKey` (or the pinned
   `SUPublicEDKey`). Mismatch ⇒ Sparkle **refuses to install** ("The update is not valid / cannot be
   verified"); the app is not touched.
5. **Install.** On user approval (or `SUAutomaticallyUpdate`), Sparkle mounts the DMG, copies the new
   `.app` to its location, **atomically renames** the old app to a backup, and relaunches. The prior
   version is deleted after a clean relaunch.

### 2.5 Signing

- **Algorithm:** **ed25519 (EdDSA)** — the recommended and default scheme in Sparkle 2.x.
- **Integrity:** `length` + the ed25519 signature (the signature subsumes integrity).
- **Key custody:** the **private key** is held only by the developer and signs each release artifact.
  The **public key** lives either in the **appcast (`<sparkle:edKey>`)** or in the app's `Info.plist`
  (`SUPublicEDKey`). **Pinning in `Info.plist` is stronger** than in-feed (an attacker who can rewrite the
  feed can also rewrite an in-feed key, but not a compiled-in key) — this is the Sparkle "key rotation"
  story and the reason Apple's own tooling moved to in-app pinning.
- **Verification failure:** install blocked; a MITM cannot inject a malicious appcast because the
  signature binds the artifact to the pinned key.

### 2.6 Channel / rollout

- **Channel** = a separate feed URL per channel (e.g. `appcast-production.xml`, `appcast-beta.xml`); the
  app points at one via `SUFeedURL`.
- **Rollout:** no built-in percentage gate in the appcast itself. Staging is done by pointing a canary
  cohort (a beta channel) at a separate feed, or by gating `SUFeedURL` server-side. (This is the gap the
  R2 spec fills with a signed `staging` percentage — see Appendix C.)

### 2.7 SUP (Software Update Protocol)

- Sparkle's appcast is the historical **SUP** (Software Update Protocol) that was originally documented
  by Andy Matuschak (`andymatuschak.org/xml-namespaces/sparkle`). Sparkle 2.x is the maintained
  implementation of that protocol with the ed25519 upgrade. There is no separate open "SUP draft" PR to
  track; the protocol is the appcast format above.

### 2.8 Rollback

**No multi-version rollback.** Sparkle deletes the prior version after a clean relaunch; recovery from a
bad release = publish a **new higher-version signed appcast item**. Deltas fall back to full when the
delta chain is unsatisfiable.

### 2.9 Failure modes

| Condition | Behavior |
|---|---|
| ed25519 signature invalid | "update not valid" — install blocked, old version kept |
| Feed 404 / unreachable | "cannot check for updates" |
| `length` mismatch | artifact rejected |
| DMG/ZIP corrupt | copy fails → abort, old version kept |
| 5xx | retryable network error |

### 2.10 Permalinks (primary source, pinned `14fdbf2…`)

- Sample appcast (canonical field set): https://github.com/sparkle-project/Sparkle/blob/14fdbf28dc7c6fd8741a144bff517ef86572e6c2/Resources/SampleAppcast.xml
- Delta tool: https://github.com/sparkle-project/Sparkle/blob/14fdbf28dc7c6fd8741a144bff517ef86572e6c2/BinaryDelta/main.swift
- Publishing docs: https://sparkle-project.org/documentation/publishing/
- Real appcast (ed25519): https://github.com/fcjr/ventoy-mac/blob/main/appcast.xml

---

## 3. electron-updater (electron-builder) — `latest*.yml` + `.blockmap`, provider abstraction

- **Repo:** `electron-userland/electron-builder` · **Pinned:** `ae8031420ad0662b84195342759dba4350ffcedd`
- **Source path:** `packages/electron-updater/src/` (the standalone `electron-userland/electron-updater`
  is **deprecated**; it now ships inside the electron-builder monorepo — see §3.6).
- **Docs:** https://www.electron.build/docs/features/auto-update (v27; subpages `signed-update-manifests`,
  `key-rotation`)
- **Spec:** none — defined by the implementation, documented in the electron-builder auto-update docs.
- **Status:** actively maintained (electron-builder v25–v27; **verify exact tag on GitHub**).
- **Status line:** The de-facto standard for Electron. It generates a per-platform YAML feed
  (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`) plus a `.blockmap` that powers **block-level
  differential download** (BLAKE2 block hashes), and an `AppUpdater` that talks to a pluggable **provider**.

### 3.1 Wire format & manifest schema

Per-platform YAML at the feed root:

| Platform | Feed file | Primary artifact |
|---|---|---|
| Windows / NSIS | `latest.yml` | `*.exe` (NSIS installer) |
| macOS | `latest-mac.yml` | `*.zip` (+ `.dmg` alongside) |
| Linux / AppImage | `latest-linux.yml` | `*.AppImage` |

Real production `latest.yml` (Fiddler Everywhere 4.6.2):
[msojocs/fiddler-everywhere-enhance](https://github.com/msojocs/fiddler-everywhere-enhance/blob/v8.x/server/file/api.getfiddler.com/c/NUNHMjIyNkpNMDg4ZjMzMjZlLTk0OWQtNDgwNi1hMTc2LTFlZGY1MWJiOWRhOA%3D%3D/v/4.6.2/p/win/latest.yml):

```yaml
version: 4.6.2
files:
  - url: Fiddler Everywhere 4.6.2.exe
    sha512: BOJAqreovN4q41SFu6KAG4TILKiX7KUjN47TPUb4KAD+ZwVC6/HGcZ2P4CCHFqC5Ql2dVkRnzO0beQZ1sG6iCg==
    size: 139083536
path: Fiddler Everywhere 4.6.2.exe
sha512: BOJAqreovN4q41SFu6KAG4TILKiX7KUjN47TPUb4KAD+ZwVC6/HGCZ2P4CCHFqC5Ql2dVkRnzO0beQZ1sG6iCg==
releaseDate: '2023-09-19T06:31:12.124Z'
```

| Field | Meaning |
|---|---|
| `version` | semver of the release. |
| `files[]` | each entry: `url` (relative or absolute), `sha512` (**base64**), `size` (bytes). |
| `path` / `sha512` (top-level) | the primary artifact, repeated for convenience. |
| `releaseDate` | ISO-8601 timestamp; "newer" detection uses semver **and** this date. |
| `signature` (macOS only) | detached RSA signature (base64) over the `.zip` — see §3.4. |

A sibling **`.blockmap`** file (`<artifact>.blockmap`) holds **BLAKE2 block hashes** (64 KB blocks) of the
installer; electron-updater diffs the local block hashes against it and downloads only the changed blocks —
this is the "delta" (at the *download-block* level, not a product delta).

### 3.2 Config / client wiring

```ts
// packages/electron-updater/src/AppUpdater.ts  (pinned ae80314…)
// constructor options (subset):
//   autoDownload = true
//   autoRunAppAfterInstall = true
//   allowPrerelease = false
//   channel: string            // 'latest' | 'beta' | 'alpha' …
//   updateConfigPath: string   // where the feed metadata points
//   requestHeaders: Record<string,string>
//   stagingPercentage: number  // 0..100 staged rollout (see §3.6)
//   updateManifestPublicKey: string  // for signed update manifests (see §3.5)
```

The feed is fetched by the **provider** (§3.3); the channel selects which feed file name is requested
(`latest.yml` for `channel: 'latest'`, otherwise `<channel>.yml`).

### 3.3 Provider abstraction

Confirmed from [`providerFactory.ts`](https://github.com/electron-userland/electron-builder/blob/ae8031420ad0662b84195342759dba4350ffcedd/packages/electron-updater/src/providerFactory.ts)
and `providers/*`:

| Provider | Trigger | Notes |
|---|---|---|
| `GitHubProvider` / `PrivateGitHubProvider` | `publish: github` (or `GH_TOKEN`/`GITHUB_TOKEN` present) | uses `api.github.com` + Releases API; honors `prerelease` |
| `BitbucketProvider` | `publish: bitbucket` | bitbucket.org API |
| `GitLabProvider` | `publish: gitlab` | gitlab.com / self-hosted |
| `KeygenProvider` | `publish: keygen` | s3.amazonaws.com/keygen base |
| S3 / Spaces / R2 → `GenericProvider` | `publish: s3` / `spaces` / `r2` | resolves a base URL via `getS3LikeProviderBaseUrl`, then generic HTTP |
| `GenericProvider` | `publish: generic` / default | any base URL; the "self-hosted" path |
| custom | `provider` option | plug in your own |

> **Correction vs. the earlier survey:** there is **no direct `S3Provider`** (AWS S3 is handled by
> resolving a base URL and falling through to `GenericProvider`), and **Bintray was removed** in 2021
> when JFrog shut it down. The live provider set is the table above.

### 3.4 Signing

- **Integrity:** **SHA-512** (base64) of the installer in the yml; verified after download.
- **Authenticity:**
  - **Windows:** the NSIS installer is **Authenticode-signed** (code-signing cert, SHA-256); the yml
    carries the SHA-512 for integrity.
  - **macOS:** a **detached RSA signature** (from `@electron/osx-sign` / the Developer ID cert) is stored
    in the yml `signature` field and verified client-side; the `.app` is also signed + notarized.
  - **Linux:** SHA-512 integrity only (no default authenticity signature).
- **Key custody:** your EV / Developer-ID code-signing cert.
- **Signed update manifests (v27+):** electron-builder can now sign the `latest.yml` *itself* with a
  keypair; the client pins `updateManifestPublicKey` and verifies the manifest signature before trusting
  any of its fields. This closes the "the feed is only protected by TLS" gap that Squirrel has. This is
  the direct ancestor of the R2 "signed-manifest-on-R2" design. See `signed-update-manifests` +
  `key-rotation` doc subpages.
- **Verification failure:** SHA-512 mismatch or invalid macOS signature ⇒ update rejected; old version kept.

### 3.5 Protocol flow

1. **Check.** Provider fetches `<channel>.yml` (e.g. `latest.yml`). 404 ⇒ "cannot get update info"; a
   transient `ECONNREFUSED` is retried.
2. **Compare.** If the yml `version` is newer than the running app (and, if `allowPrerelease` is false,
   not a prerelease), an update is available.
3. **Staged gate.** If `stagingPercentage` is set, the client hashes a stable identity and only proceeds
   if it falls inside the percentage (see §3.6).
4. **Download.** Downloads the installer to the platform cache (Windows `%LOCALAPPDATA%\<app>\`, macOS
   `~/Library/Caches/…`, Linux `~/.cache`). **Blockmap differential:** compares local block hashes to the
   `.blockmap` and fetches only changed blocks (resumable-friendly).
5. **Verify.** SHA-512 (all platforms) + macOS detached signature + (v27) manifest signature.
6. **Install.** Install on **app quit** (`autoInstallOnAppQuit`) or on user prompt. Runs the platform
   installer (NSIS on Windows, atomic app replace on macOS, AppImage swap on Linux). Full install each time.

### 3.6 Channel / rollout

- **Channel** = the `channel` option → feed file name (`latest` / `beta` / `alpha` / …). A separate
  publish step per channel produces a separate `<channel>.yml`.
- **Rollout** = `stagingPercentage` (0–100): a built-in percentage gate, the electron equivalent of
  Squirrel's `# <pct>` line. This is a first-class rollout primitive in `AppUpdater`.

### 3.7 Rollback

**No automatic, multi-version rollback.** electron-updater does not retain multiple runnable versions. A
bad release is fixed by publishing a new `latest.yml` (higher version). NSIS can roll back a *failed
in-progress install*, but there is no client-side "revert to the version before last."

### 3.8 Failure modes

| Condition | Behavior |
|---|---|
| SHA-512 mismatch | install/verify fails; old version kept |
| macOS signature invalid | update rejected |
| manifest signature invalid (v27) | update rejected (feed untrusted) |
| `latest.yml` 404 | "cannot get update info" |
| 5xx on feed / installer | retryable |
| Blockmap / local hash drift | re-downloads the affected blocks |
| `ECONNREFUSED` | retried |

### 3.9 The "electron-builder wraps Squirrel/Sparkle" question — corrected

The task brief asked to "look at what electron-builder generates — electron-builder wraps Squirrel/Sparkle
for Windows/Mac." **The precise answer is: it does not wrap them; it is a parallel, convergent
implementation.** Concretely:

- **electron-updater does not embed Squirrel.** On Windows it drives its own NSIS differential installer
  (via the `blockmap`), not Squirrel's `Update.exe`/`RELEASES` model. Squirrel is a *separate* library that
  some Electron apps use directly (Atom, VS Code, GitKraken) via `electron-squirrel-windows`.
- **electron-updater does not embed Sparkle.** On macOS it uses its own atomic app-replace + a **detached
  RSA** signature in `latest-mac.yml`, not Sparkle's appcast + ed25519. Sparkle remains a *separate*
  framework apps can adopt instead.
- **What they share are the same primitives**, not the code:

| Concept | Squirrel.Windows | Sparkle | electron-updater |
|---|---|---|---|
| Feed file | `RELEASES` (text) | `appcast.xml` (RSS) | `latest.yml` (YAML) |
| Primary artifact | `.nupkg` | `.dmg`/`.zip` | `.exe`/`.zip`/`.AppImage` |
| Integrity | SHA-1/line | length + ed25519 | SHA-512 (base64) |
| Authenticity | none (HTTPS) | ed25519 | Authenticode / detached RSA / (v27) manifest sig |
| Delta | `bsdiff` (`-delta.nupkg`) | `BinaryDelta` (`.delta`) | `blockmap` (BLAKE2 blocks) |
| Rollout | `# <pct>` | none (channel feed) | `stagingPercentage` |

So for AIRIZ the practical read is: **electron-updater already gives you the Windows + macOS (and Linux)
desktop updater with block-level delta and a staged-rollout knob, and (in v27) a signed-manifest option —
which is exactly the shape the R2 spec wants.** You do *not* need to bolt Squirrel or Sparkle on top; you
need to make electron-updater's `latest.yml` the authoritative, signed feed (or sign your own R2 manifest
and point each client at its slice). See Appendix C.

### 3.10 Permalinks (primary source, pinned `ae80314…`)

- `AppUpdater` (staging, public key, blockmap): https://github.com/electron-userland/electron-builder/blob/ae8031420ad0662b84195342759dba4350ffcedd/packages/electron-updater/src/AppUpdater.ts
- `providerFactory` (live provider set): https://github.com/electron-userland/electron-builder/blob/ae8031420ad0662b84195342759dba4350ffcedd/packages/electron-updater/src/providerFactory.ts
- `GenericProvider`: https://github.com/electron-userland/electron-builder/blob/ae8031420ad0662b84195342759dba4350ffcedd/packages/electron-updater/src/providers/GenericProvider.ts
- `GitHubProvider`: https://github.com/electron-userland/electron-builder/blob/ae8031420ad0662b84195342759dba4350ffcedd/packages/electron-updater/src/providers/GitHubProvider.ts
- Real `latest.yml`: https://github.com/solidtime-io/solidtime/blob/main/public/desktop-version/latest.yml
- Auto-update docs (signed manifests, key rotation): https://www.electron.build/docs/features/auto-update

---

## 4. Tauri 2 updater — JSON manifest from templated `endpoints`, minisign/ed25519, `{{bundle_type}}`

- **Repo (plugin source):** `tauri-apps/plugins-workspace` · **Pinned:** `74a44c1d5694324b7fb9ba5ee9271a3096da9387`
  (the updater plugin moved out of the standalone `tauri-apps/tauri-plugin-updater` into the
  `plugins-workspace` monorepo; path is `plugins/updater/`).
- **Core:** `tauri-apps/tauri` 2.12.5 · **Plugin:** 2.8.1 · **Docs:** https://v2.tauri.app/plugin/updater/
- **Spec:** **Tauri v2 updater protocol** (informal; the JSON is defined by `updater.rs` deserialisation).
- **Status:** actively maintained (Tauri v2).
- **Status line:** The Rust-side updater for Tauri v2. It fetches a **JSON manifest** from one or more
  templated `endpoints`, verifies the artifact with a **minisign/ed25519** signature, and installs the
  right bundle for the current target. Because it is Rust + a small JSON contract, it is one of the
  cleanest "signed manifest" models in this survey and the closest existing analogue to the R2 spec.

### 4.1 Wire format & manifest schema

The manifest is **JSON** returned by any of the configured `endpoints` (templated URLs). From
[`plugins/updater/src/updater.rs`](https://github.com/tauri-apps/plugins-workspace/blob/74a44c1d5694324b7fb9ba5ee9271a3096da9387/plugins/updater/src/updater.rs)
(`RemoteRelease` + untagged `RemoteReleaseInner` + `ReleaseManifestPlatform{url, signature}`):

Single-platform (dynamic) form:

```json
{
  "version": "2.1.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-11-04T10:00:00Z",
  "url": "https://updates.example.com/darwin-aarch64/app.tar.gz",
  "signature": "BASE64MINISIGN_ED25519_SIGNATURE"
}
```

Multi-platform (static) form:

```json
{
  "version": "2.1.0",
  "notes": "Bug fixes",
  "pub_date": "2026-11-04T10:00:00Z",
  "platforms": {
    "darwin-aarch64": { "url": "https://…/app.tar.gz", "signature": "BASE64…" },
    "windows-x86_64": { "url": "https://…/app.msi",    "signature": "BASE64…" },
    "linux-x86_64":   { "url": "https://…/app.tar.gz", "signature": "BASE64…" }
  }
}
```

| Field | Meaning |
|---|---|
| `version` | semver; only applied if newer than the running app (a comparator rejects non-newer). |
| `notes` | release notes (shown in the update UI). |
| `pub_date` | ISO-8601 publish date (display + ordering tie-breaker). |
| `url` + `signature` | dynamic form — one target, chosen server-side. |
| `platforms` map | static form — keyed by target triple; each value has `url` + `signature`. One manifest can serve all targets. |
| `signature` | base64 **minisign/ed25519** signature over the artifact bytes. |

### 4.2 Config / client wiring

```jsonc
// tauri.conf.json  (v2 shape; v1 moved from updater.* to plugins.updater.*)
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://updates.example.com/{{target}}?version={{current_version}}&arch={{arch}}&bundle_type={{bundle_type}}"
      ],
      "pubkey": "…base64 minisign public key…",
      "dangerousAcceptInvalidCerts": false,
      "dangerousAcceptInvalidHostnames": false
    }
  }
}
```

- **Endpoint templating** is the "provider" mechanism: `{{target}}`, `{{current_version}}`, `{{arch}}`,
  and `{{bundle_type}}` are substituted client-side. **No named providers** — you host the JSON + artifacts
  anywhere over HTTPS.
- The **`pubkey`** is the minisign public key compiled into the config; the private key signs at build
  time (`tauri signer generate`, password via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- **`UPDATER_USER_AGENT`** is sent on the manifest request (useful for server-side client telemetry).

### 4.3 Signing

- **Algorithm:** **ed25519 via the `minisign-verify` crate.** `updater.rs` calls `minisign_verify` with a
  `PublicKey` and `Signature`; the signature is over the update artifact (`.tar.gz` on unix, `.msi`/`.nsis`
  exe on Windows). So the docs' "ed25519" is correct and the on-the-wire scheme is **minisign-flavoured
  ed25519** (minisign prepends a 42-byte header to the signature payload — a detail that matters if you
  re-implement verification and use a raw ed25519 library instead).
- **Integrity:** subsumed by the signature.
- **Key custody:** keypair from `tauri signer generate`; private key signs at build time, public key
  embedded in `tauri.conf.json`.
- **Verification failure:** the update is **rejected** (error surfaced to the app); nothing is installed.
  A forged manifest cannot pass without the private key.

### 4.4 Protocol flow

1. **Check.** Substitute the endpoint template, GET the JSON manifest (HTTPS, `UPDATER_USER_AGENT`).
2. **Select.** If `version` is newer, pick the platform entry: dynamic form uses the single `url`;
   static form looks up the current target triple in `platforms`.
3. **Download.** Fetch the target artifact (`.tar.gz`/`.msi`). **No delta** — full bundle only.
4. **Verify.** `minisign_verify(pubkey, signature, artifact_bytes)`. Fail ⇒ reject.
5. **Install.** The plugin's `installUpdate` (Rust) / JS `downloadAndInstall()` replaces the binary and
   **relaunches**. The **`Installer`** enum selects the install strategy per platform:

```rust
// plugins/updater/src/updater.rs  (pinned 74a44c1…)
enum Installer {
    AppImage,  // linux: swap the .AppImage in place
    Deb,       // linux .deb
    Rpm,       // linux .rpm
    App,       // macOS .app (atomic replace)
    Msi,       // windows .msi (runs the MSI installer)
    Nsis,      // windows .exe (NSIS)
}
```

### 4.5 Channel / rollout

- **Channel** = separate `endpoints` per channel (e.g. a `?channel=beta` endpoint vs production), or a
  separate endpoint list. There is no percentage gate in the protocol itself.
- **Rollout:** not built in. Staging is done by pointing a canary cohort at a different endpoint. (The R2
  spec adds a signed `staging` field — see Appendix C.)

### 4.6 Mobile caveat

- The updater is **desktop-only in effect**: on **iOS / Android** the store manages updates, so the Tauri
  updater is not used for OS-level updates (a web/JS layer or store submission handles it). For AIRIZ's
  Capacitor phones this is the same reason mobile updates go through Capawesome (System 5), not Tauri.

### 4.7 Rollback

**No built-in rollback.** The binary is replaced in place; recovery = publish a higher-version signed
manifest. Only upgrades are applied (the version comparator rejects non-newer versions).

### 4.8 Failure modes

| Condition | Behavior |
|---|---|
| minisign/ed25519 signature invalid | update rejected |
| endpoint 404 | "no update available" / error |
| `version` not newer | skipped (comparator) |
| 5xx | retryable network error |
| TLS / host mismatch | blocked unless `dangerousAcceptInvalid*` is set |

### 4.9 Permalinks (primary source, pinned `74a44c1…`)

- Updater protocol (`RemoteRelease`, `Installer`, minisign verify): https://github.com/tauri-apps/plugins-workspace/blob/74a44c1d5694324b7fb9ba5ee9271a3096da9387/plugins/updater/src/updater.rs
- Updater plugin docs: https://v2.tauri.app/plugin/updater/
- v1→v2 config migration (`updater.*` → `plugins.updater.*`): https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/migrate/migrations/v1/config.rs

---

## 5. Capacitor Live Update — the deprecated `@capacitor/live-update` and its successor `@capawesome/capacitor-live-update`

This system is a **two-part story**: the official Ionic plugin that is now deprecated, and the maintained
Capawesome successor that AIRIZ actually ships on mobile. The deprecation is the load-bearing fact.

### 5.1 The deprecated official: `@capacitor/live-update`

- **Repo:** `ionic-team/capacitor` (the `@capacitor/live-update` package) · **Status:** **deprecated /
  removed in Capacitor 6.** (Exact last version — verify on GitHub/npm; the package is no longer a
  first-class Capacitor release and its docs point users to Capawesome.)
- **npm note:** the registry metadata for `@capacitor/live-update` shows it under the **Ionic** author with
  a **Commercial** license; it is not flagged with a `deprecated` field in the registry (so `npm i`
  still resolves it), but it is documented as superseded. Treat it as frozen.
- **What it was:** a simpler web-asset OTA updater for Capacitor (Android/iOS/Electron): it downloaded a
  web bundle and swapped it in place of the remote/CDN assets. Its design was **less signed and had weaker
  rollback safety** than the successor (no mandatory RSA code-signing story, no kill-safe auto-rollback).
- **What replaced it:** **`@capawesome/capacitor-live-update`** (below). Migration is a drop-in plugin
  swap; the Capawesome version adds RSA signing, channels, and kill-safe rollback.
- **Design ideas it left behind:** (a) the **web-bundle-swap** model (update the JS/web layer without a
  native rebuild), (b) **channel-based** updates, (c) the idea that a Capacitor app's "update" is really
  "repoint the WebView's asset origin to a local bundle."

### 5.2 The current: `@capawesome/capacitor-live-update`

- **Repo:** `capawesome-team/capacitor-plugins → packages/live-update` · **Latest:** **8.7.1**
- **Docs:** https://capawesome.io/docs/plugins/live-update/
- **Spec:** none — the **Capawesome Cloud protocol** + a self-hostable mode. It implements the **Ionic Live
  Update Provider SDK** contract, so it also works with Federated Capacitor / Ionic Portals.
- **Status:** actively maintained.

#### 5.2.1 Wire format & manifest schema

Two artifacts on the wire:

1. **The bundle** — `artifactType` is either **`zip`** (a single file with `url` + `checksum` +
   `signature`) or **`manifest`** (a base URL whose file list lives in the manifest). See
   [`src/definitions.ts`](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts).
2. **The local manifest** — cached as **`capawesome-live-update-manifest.json`** (a constant the source
   explicitly marks **DO NOT CHANGE**, in
   [`LiveUpdate.java`](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java)), stored in the
   **`_capacitor_live_update_bundles`** dir (Android) / Library dir (iOS). Schema (from
   [`classes/Manifest.java`](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/classes/Manifest.java) /
   `Manifest.swift`):

```json
{
  "items": [
    { "path": "index.html",       "checksum": "SHA256HEX", "url": "https://cdn.example.com/…/index.html" },
    { "path": "assets/app.js",    "checksum": "SHA256HEX", "url": "https://cdn.example.com/…/app.js" },
    { "path": "styles/main.css",  "checksum": "SHA256HEX", "url": "https://cdn.example.com/…/main.css" }
  ]
}
```

- `items[]` — the files in the web bundle; each carries a **`checksum`** (SHA-256). The checksum is what
  lets the client diff "already cached" vs "must download."
- The **server** returns a `GetLatestBundleResponse` per channel (bundle id, url, checksum, signature,
  metadata). For **self-hosting**, the app can also call `downloadBundle({ url, bundleId })` directly.

#### 5.2.2 Config / client wiring

```jsonc
// capacitor.config.json  (Capawesome live-update plugin config)
{
  "plugins": {
    "LiveUpdate": {
      "appId": "com.airiz.console",
      "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjAN…PEM RSA…\n-----END PUBLIC KEY-----",
      "defaultChannel": "production-1042",
      "autoUpdateStrategy": "background",   // "none" | "background"
      "autoBlockRolledBackBundles": true,
      "maxBlockedBundles": 100,
      "readyTimeout": 60000,
      "downloadProgressThreshold": 10
    }
  }
}
```

- **`publicKey`** must be a **PEM-encoded RSA public key** (required since 6.1.0).
- **`defaultChannel`** is usually a **versioned channel** `production-<versionCode>` bound to the build's
  `versionCode` at build time (so a 1.0.4 build only receives 1.0.4-channel bundles until a native
  release advances it). There are also testing/QA channels and a plain `default` channel. **`public` is a
  reserved bundle id** and cannot be used.
- **`autoUpdateStrategy`** = `none` (manual) or `background` (auto-check on launch).

#### 5.2.3 Signing

- **Integrity:** **SHA-256** per file (manifest items) / per zip (bundle).
- **Authenticity:** **RSA** — the bundle `signature` is verified against the configured `publicKey`. The
  private key is generated by the **`generatesigningkey`** CLI; **Capawesome Cloud** holds the signing key
  in managed mode, and you configure only the public key in the app.
- **Verification failure:** the bundle is **rejected**; the previously good bundle (or the embedded
  default bundle) is used instead.

#### 5.2.4 Protocol flow

1. **Check.** On launch (or per `autoUpdateStrategy`), query the channel API (`GetLatestBundleResponse`)
   for the bundle bound to this `versionCode`.
2. **Select.** If the returned bundle id differs from the current local manifest, an update is available.
3. **Download.** Download the bundle (zip) or the individual manifest files into the bundles dir, with
   **download-progress events**. Verify checksum + RSA signature.
4. **Verify.** RSA signature against `publicKey`; per-file SHA-256.
5. **Install.** The app loads the **local** bundle instead of remote assets. Applied on **next app start**
   or an explicit **`reload()`**. **Full** bundle (no product-level delta).

#### 5.2.5 Channel / rollout

- **Channels:** `production-<versionCode>` (versioned, default), `default`, protected/testing channels.
  This is the strongest *channel* model of the mobile updaters here because the channel is bound to the
  native `versionCode`.
- **Rollout:** `--rollout-percentage` on the publish side controls what fraction of a channel's users are
  offered a new bundle. This is the mobile-side canary.

#### 5.2.6 Rollback ← strongest for hybrid apps in this survey

- **Explicit `rollback()` API** plus **automatic kill-safe rollback**: the app must call **`ready()`**
  once it is usable; if `ready()` is not called within **`readyTimeout`**, the plugin **resets to the
  embedded (default) bundle on the next start**. The rollback is kill-safe: if the app is closed or
  crashes before `ready()`, the rollback happens on the next app start.
- **`autoBlockRolledBackBundles`** keeps an LRU list (up to `maxBlockedBundles`, default 100) of bundle
  ids that caused a rollback, so a known-bad bundle is never re-applied.

#### 5.2.7 Self-hosting vs Cloud

- **Cloud (managed):** bundles + channel metadata served by Capawesome Cloud; the private key never leaves
  the cloud.
- **Self-hosted:** the app talks to your own server; the **metadata** may still be proxied to the cloud,
  but **the bundle is a single zip** and **delta is not supported in self-hosted mode** (whole bundle only).
  This matters for AIRIZ: a self-hosted R2-bundled mobile update is a full zip, not a delta.

### 5.3 Failure modes

| Condition | Behavior |
|---|---|
| checksum / RSA signature mismatch | bundle rejected; prior/embedded used |
| crash before `ready()` | **auto-rollback to embedded bundle** on next start |
| download fail | keeps the current good bundle |
| 404 / 5xx on channel API | retryable; no change |
| bad bundle re-applied | blocked by `autoBlockRolledBackBundles` (LRU) |

### 5.4 Permalinks

- Definitions (`artifactType` zip/manifest): https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts
- `Manifest` (Android): https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/classes/Manifest.java
- `Manifest` (iOS): https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/ios/Plugin/Classes/Manifest.swift
- `LiveUpdate` (manifest-file constant, DO NOT CHANGE): https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java
- Plugin docs (channels, rollouts, self-hosting, signing): https://capawesome.io/docs/plugins/live-update/

---

## 6. Expo Updates (EAS Update) — update-manifest JSON, `runtimeVersion` gate, RSA-4096 code-sign, optional bsdiff

- **Repo:** `expo/expo → packages/expo-updates` · **Pinned:** `c59120da912d8bc1b3dadf7a75e320541e2a1a63`
- **Latest:** expo-updates **58.0.5** (SDK 53-era)
- **Docs:** https://docs.expo.dev/develop/updates/ · **Spec:** **Expo Updates protocol v1** — the one
  updater in this survey with an actual *written conformance spec* (MUST/SHALL language) at
  https://docs.expo.dev/technical-specs/expo-updates-1.md
- **Status:** actively maintained.
- **Status line:** The React Native / Expo OTA updater and the **recommended migration target for retired
  CodePush** (System 7). Its two load-bearing ideas are: (a) **`runtimeVersion`** (not the app version) is
  the compatibility gate, and (b) a **SQLite-persisted Updates DB** plus an always-available **embedded
  update** as the anti-bricking floor.

### 6.1 Wire format & manifest schema

A server-served **update-manifest JSON** from the **`updateUrl`**, scoped by **`scopeKey`** (project id)
and **`runtimeVersion`**. Real shape from the in-repo update-server fixture
([`packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts`](https://github.com/expo/expo/blob/c59120da912d8bc1b3dadf7a75e320541e2a1a63/packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts)):

```json
{
  "id": "6f1e2c0a-…-uuid",
  "createdAt": "2026-11-04T10:00:00.000Z",
  "runtimeVersion": "sdk-53",
  "branch": "production",
  "description": "Bug fixes",
  "launchAsset": {
    "hash": "SHA256HEX",
    "key": "launchAsset",
    "contentType": "application/javascript",
    "url": "https://updates.example.com/assets/…/bundle"
  },
  "codeSigning": {
    "algorithm": "rsa-4096-sha256",
    "signature": "BASE64RSA",
    "certs": [ "BASE64CERT" ]
  }
}
```

| Field | Meaning |
|---|---|
| `id` | update UUID (the `UpdateEntity` key in the client DB). |
| `createdAt` | ISO timestamp. |
| `runtimeVersion` | **the compatibility key** — an update applies only when its `runtimeVersion` matches the app's. *Not* the app version. |
| `branch` | the release branch (e.g. `production`); maps to a channel. |
| `launchAsset` | the JS bundle: `hash` (**SHA-256**), `key`, `contentType`, `url`. |
| `codeSigning` | `algorithm` = **`rsa-4096-sha256`**, `signature` over the launch asset, `certs` = the cert chain. |

The **EAS Update** manifest endpoint is `https://u.expo.dev/v1/manifest/{platform}/{bundleId}` (managed);
self-hosting runs the open-source `expo-updates` server behind the same protocol. The client stores each
update as `UpdateEntity(uuid, date, runtimeVersion, projectId, manifest, …)` in a local **SQLite** DB (see
[`UpdatesConfiguration.kt`](https://github.com/expo/expo/blob/c59120da912d8bc1b3dadf7a75e320541e2a1a63/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt)) — multiple
runtime versions can coexist on device.

### 6.2 Config / client wiring

```jsonc
// app.config.js  (expo-updates config; the SDK also reads it from the EAS project)
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/v1/manifest/android/com.airiz.console",
      "fallbackToCacheTimeout": 0,
      "enableBsdiffPatchSupport": true,      // default true — bsdiff patch downloads
      "maxUpdatesToKeep": 2,                 // default 2 — how many old updates to retain
      "requestHeaders": { "Authorization": "Bearer …" }
    },
    "runtimeVersion": { "policy": "appVersion" },  // "appVersion" | "nativeVersion" | "fingerprint"
    "codeSigningCertificate": "BASE64CERT"        // or a cert path / getUpdatesCodeSigningCertificate
  }
}
```

- **`runtimeVersion` policies:**
  - **`appVersion`** — runtimeVersion = the app's native `version` (simplest; a JS update only applies to
    that exact native version).
  - **`nativeVersion`** — a manually-set string (you control when it bumps).
  - **`fingerprint`** — `file:fingerprint` auto-computed from the native code (any native change bumps it).
- **`enableBsdiffPatchSupport`** (default **true**) lets the client download a **bsdiff patch** between the
  installed launch asset and the new one instead of the full bundle — typically 1–3% of the bundle for a
  small change. **`maxUpdatesToKeep`** (default **2**) bounds the local Updates DB.
- **`disableAntiBrickingMeasures`** (off by default) is the escape hatch that turns the embedded-fallback
  safety off; leave it on.

### 6.3 Signing

- **Integrity:** **SHA-256** of the launch asset (`launchAsset.hash`).
- **Authenticity:** **code signing** — `codeSigning.algorithm` = **`rsa-4096-sha256`**, a signature over
  the launch asset plus a certificate chain (`certs`). Configured via `codeSigningCertificate` /
  `getUpdatesCodeSigningCertificate`.
- **Key custody:** your code-signing cert (EAS manages the signing key server-side for managed EAS Update).
- **Verification failure:** the update is **rejected**; the **embedded** (in-app) update is used. This is
  the anti-bricking guarantee: a bad JS update can never take the app down to zero.

### 6.4 Protocol flow

1. **Check.** At launch, fetch the manifest from `updateUrl` scoped by `scopeKey` + `runtimeVersion`
   (`checkOnLaunch: 'immediate' | 'background'`, `launchWaitMs` bounds how long launch waits).
2. **Gate.** Apply the update only if its `runtimeVersion` matches the app's; otherwise stay current.
3. **Download.** Fetch the JS launch asset + referenced assets (or a **bsdiff patch** if supported and a
   matching base exists), verify SHA-256 + code signature. Persist to the SQLite Updates DB.
4. **Activate.** Staged: the update is **activated on next launch**, or immediately via
   `reloadAsync()`. The **embedded update** is the always-available floor. **Full** JS bundle (or a bsdiff
   patch on top of it).

### 6.5 Channel / rollout

- **Channel** = a **branch** (`production`, `preview`, …). A build's `runtimeVersion` + branch selects the
  feed it reads.
- **Rollout:** **per-update rollout percentage** (EAS Update rolls a release out to N% of eligible clients)
  **plus branch-based rollout** (`eas channel:rollout`). The gate is server-side: the manifest endpoint
  returns either the new or the old manifest for a given client, so the client never knows it was gated.

### 6.6 Rollback

- **Server-side rollback:** `eas update:rollback` (or the API) marks an update rolled back → clients will
  not activate it.
- **Client fallback:** the **embedded update** is always the safe floor; **anti-bricking measures** are on
  by default (`disableAntiBrickingMeasures` off). So a bad JS update cannot brick the app — worst case the
  next launch reverts to the embedded bundle.

### 6.7 Failure modes

| Condition | Behavior |
|---|---|
| `runtimeVersion` mismatch | update not applicable (stays on current) |
| SHA-256 hash mismatch | rejected; embedded used |
| code-signature invalid | rejected; embedded used |
| bsdiff patch base missing / fails | falls back to full bundle |
| 404 / 5xx on updateUrl | retryable; embedded used |

### 6.8 Permalinks (primary source, pinned `c59120d…`)

- Update-server manifest fixture (canonical shape): https://github.com/expo/expo/blob/c59120da912d8bc1b3dadf7a75e320541e2a1a63/packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts
- Android config (`UpdateEntity`, runtimeVersion, code signing): https://github.com/expo/expo/blob/c59120da912d8bc1b3dadf7a75e320541e2a1a63/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt
- **Protocol v1 spec (MUST/SHALL):** https://docs.expo.dev/technical-specs/expo-updates-1.md
- Code signing + key rotation: https://docs.expo.dev/eas-update/code-signing/
- CodePush → EAS migration guide: https://docs.expo.dev/eas-update/codepush/

---

## 7. CodePush / App Center (React Native) — **retired 2025-03-31**, update-metadata JSON + `packageHash`

> **This system is dead. Read this section for what it was and what to do if you are stuck on it.**

- **Repo:** `microsoft/react-native-code-push` (**archived**) · **Pinned:** `d3b163d8d7522f02081eee2b5d735705b5d54c00`
- **Latest:** **9.0.1** (frozen; tags 9.0.1, 9.0.0)
- **Docs (archived):** https://github.com/microsoft/react-native-code-push
- **Status:** **Retired.** The README is unambiguous: "Visual Studio App Center was retired on
  **March 31, 2025** … CodePush, along with other App Center features, was also retired on
  **March 31, 2025**. Consequently, we are archiving this repository." (The broader App Center platform
  wind-down and the repo's *archival* landed in the following weeks — the authoritative service-retirement
  date is **2025-03-31**.)

### 7.1 What it was

CodePush was Microsoft's **JS-bundle-over-the-air** updater for React Native (plus Cordova). You deployed a
JS bundle (or full binary diff) to an **App Center** *deployment* (a named channel: `Production`, `Staging`,
…), and the app checked the deployment for a newer package at runtime. It was the dominant RN OTA tool
before Expo's EAS Update absorbed its niche.

### 7.2 Wire format & manifest schema

The on-the-wire unit is an **update-metadata JSON** returned by the CodePush server's update-check
endpoint, plus the **bundle** downloaded by hash. Locally each package is stored in a folder named by its
**`packageHash`** (see
[`windows-legacy/CodePush/UpdateManager.cs`](https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/windows-legacy/CodePush/UpdateManager.cs)).

The authoritative request/response types are in
[`src/script/types.ts`](https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/src/script/types.ts):

```ts
// src/script/types.ts  (pinned d3b163d…)  — the CodePush client/server contract
export interface UpdateCheckRequest {
  app_version: string;        // native binary version the update is built against
  client_unique_id: string;   // device/install identifier (rollout bucketing)
  deployment_key: string;     // secrets which deployment (channel) to check
  label?: string;             // current label, if known
  package_hash?: string;      // current package hash, if known
  is_companion?: boolean;
}

export interface UpdateCheckResponse {
  label: string;                     // e.g. "v2"
  download_url: string;              // where to fetch the bundle/package
  description: string;
  is_available: boolean;
  is_disabled: boolean;
  is_mandatory: boolean;
  package_hash: string;              // sha256 of the package
  package_size: number;              // bytes
  target_binary_range: string;       // semver range of native versions this applies to
  should_run_binary_version: string;
  update_app_version: string;
  deployment_key: string;
  app_version: string;
  rollout: number;                   // 0..100 staged rollout percentage
}

export interface DeploymentStatusReport {
  app_version: string;
  client_unique_id: string;
  deployment_key: string;
  label: string;
  package_hash: string;
  status: 'Succeeded' | 'Failed';
  previous_label?: string;
  previous_package_hash?: string;
  timestamp: string;
}
```

Client-side, `acquisition-sdk.ts` wraps the same shape
([`src/script/acquisition-sdk.ts`](https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/src/script/acquisition-sdk.ts)):

```ts
// src/script/acquisition-sdk.ts  (pinned d3b163d…)
const BASE_URL_PART = "appcenter.ms";   // the (now-dead) codepush.appcenter.ms / api.appcenter.ms/v0.1
export interface Package {
  deploymentKey: string; description: string; label: string;
  appVersion: string; isMandatory: boolean; packageHash: string; packageSize: number;
}
export interface RemotePackage extends Package { downloadUrl: string; }
export interface Configuration {
  appVersion: string; clientUniqueId: string; deploymentKey: string;
  serverUrl?: string; ignoreAppVersion?: boolean;
}
export enum AcquisitionStatus { NoUpdate, Updated, UpdateFailed, RollbackFailed, RollbackSucceeded }
```

| Field | Meaning |
|---|---|
| `app_version` / `update_app_version` | the **native binary** version the update is built against (the diffing basis) vs the one the update *wants* you on. |
| `target_binary_range` | a semver range gating which native builds may apply this JS update. |
| `package_hash` | SHA-256 of the package; also the on-disk folder name. |
| `download_url` | where to fetch the JS bundle (or full package). |
| `is_mandatory` | forces the update (no "remind me later"). |
| `rollout` | 0–100 staged rollout percentage (canary). |
| `deployment_key` | identifies the channel (deployment) the request is scoped to. |

### 7.3 Signing

- **Integrity:** `packageHash` (SHA-256).
- **Authenticity:** the **Windows UWP** client took a **`publicKey`** (RSA) and verified the package
  signature (see [`windows/CodePush/CodePushPackage.cpp`](https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/windows/CodePush/CodePushPackage.cpp)); iOS/Android
  historically relied on the **TLS-protected App Center endpoint** rather than an in-app public key.
- **Key custody:** server-side (App Center). **Verification failure:** package rejected.

### 7.4 Channel / rollout

- **Channel** = a **deployment** (named channel: `Production`, `Staging`, …), addressed by its
  `deployment_key`.
- **Rollout** = the **`rollout`** percentage field on the response (canary), bucketed by
  `client_unique_id`.

### 7.5 Rollback

- **Client-side rollback:** `rollback()` + `sync()`; the last rollback is persisted
  (`LATEST_ROLLBACK_INFO` with `packageHash`, `time`, `count`).
- **Server-side rollback:** `appcenter codepush rollback` stops additional users installing a bad release.
- **Failed-hash blocking:** `IsFailedHash` / `failedUpdates` prevents re-attempting a package that already
  failed to install (anti-brick at the package level).

### 7.6 Failure modes

| Condition | Behavior |
|---|---|
| hash mismatch | package rejected |
| failed install (crash) | hash added to `failedUpdates`; not retried; rollback available |
| 404 / 5xx on CodePush endpoint | retryable |
| `appVersion` / `target_binary_range` mismatch | update not applied to that binary |
| service itself | **gone** — `api.appcenter.ms` / `codepush.appcenter.ms` no longer serve CodePush |

### 7.7 What replaced it, and what design ideas survived

- **Replacement:** **Expo EAS Update** (System 6) is the recommended migration target — same
  JS-bundle-over-the-air model, but self-hostable, with `runtimeVersion` gating and RSA-4096 code signing.
  Official migration guide: https://docs.expo.dev/eas-update/codepush/.
- **Migration mechanics (from the repo's `migration-notice.md`):** the SDK's network layer moved to
  `api.appcenter.ms/v0.1` (legacy `codepush.appcenter.ms`); the deprecated methods
  (`getSessions`, `patchAccessKey`, `removeSession`, `getAccessKey`) and CLI 3.0.0 were the last supported
  surface. **You cannot self-host the official CodePush client anymore** — the service is gone.
- **Design ideas that survived and live on in the R2 spec:** (a) **`rollout` percentage** bucketed by a
  stable client id (now `staging` in Appendix C); (b) **`target_binary_range`** as an explicit
  native-version gate (now the `runtimeVersion`/`minNative` idea); (c) **`packageHash` as the on-disk
  folder name** (content-addressed staging); (d) **`isMandatory`**; (e) **failed-hash blocking**
  (never retry a known-bad package) and **`DeploymentStatusReport`** (client→server success/failure
  telemetry for canary observation).

### 7.8 Permalinks (archived, pinned `d3b163d…`)

- Contract types (`UpdateCheckRequest`/`Response`, `DeploymentStatusReport`): https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/src/script/types.ts
- Acquisition SDK (`BASE_URL_PART`, `RemotePackage`, `Configuration`): https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/src/script/acquisition-sdk.ts
- `packageHash` on-disk layout: https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/windows-legacy/CodePush/UpdateManager.cs
- UWP RSA verification: https://github.com/microsoft/react-native-code-push/blob/d3b163d8d7522f02081eee2b5d735705b5d54c00/windows/CodePush/CodePushPackage.cpp
- Retirement notice (README): https://github.com/microsoft/react-native-code-push/blob/master/README.md

---

## 8. PWA service worker / Workbox — the SW script *is* the update unit, `skipWaiting`/`clients.claim`, precache revisioning

- **Spec:** **W3C/WHATWG Service Worker** (https://w3c.github.io/ServiceWorker/) — the only formally
  specified "updater" here besides MSIX. **MDN:** https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- **Workbox:** `googlechromelabs/workbox` · **Pinned:** `4ea3138a120fd2c87389b54130e25f47e0fd7089`
  (default branch `v7`) · https://workboxjs.com
- **Status:** web standard (SW) + maintained library (Workbox 7.x; **verify exact tag on GitHub**).
- **Status line:** Not a native SDK — the **browser is the updater**. The "update unit" is the **service
  worker script itself**: the browser re-fetches `/sw.js`, and if the bytes changed, installs a new worker.
  Workbox layers on a **precache manifest** (a JS array of revision-hashed URLs) so the app shell updates as
  a unit. This is the updater for AIRIZ's web shell + the Worker's "version pin."

### 8.1 Wire format & "manifest" schema

There are two "manifests," and they are easy to confuse:

1. **The SW script URL** (`/sw.js`) — the update unit. `navigator.serviceWorker.register('/sw.js', options)`.
   The browser fetches it on a schedule and diffing is done by the platform (changed bytes ⇒ new SW).
2. **The Workbox precache manifest** (`precache-manifest.js`, inlined as `self.__WB_MANIFEST`) — a JS array
   of `{url, revision}` for the precached app-shell assets. When it changes, the SW updates its precache.
   The installable **Web App Manifest** (`manifest.webmanifest`) is *unrelated* to updates.

Registration / options (confirmed from
[angular service-worker `provider.ts`](https://github.com/angular/angular/blob/main/packages/service-worker/src/provider.ts)
and [next.js SW e2e](https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/service-worker/app/page.js)):

```js
const reg = await navigator.serviceWorker.register('/sw.js', {
  scope: '/',
  updateViaCache: 'imports',   // 'imports' (default) | 'all' | 'none'
  type: 'module'                // 'classic' | 'module'
});
// reg.update() forces an out-of-band re-check; reg.updateViaCache reflects the option
```

The precache manifest (what Workbox generates at build time — the per-asset "revision" is the **content
hash**, which is the whole update/rollback mechanism):

```js
// precache-manifest.js  (Workbox build output — revision = content hash)
self.__WB_MANIFEST = [
  { "url": "index.html",              "revision": "1a2b3c4d5e6f" },
  { "url": "assets/app.9f8e7d.js",    "revision": null },   // hashed filename → revision null
  { "url": "assets/main.4c3b2a.css",  "revision": null },
  { "url": "icons/icon-512.png",      "revision": "0a1b2c3d4e5f" }
];
```

### 8.2 `updateViaCache` semantics (the update-check behavior)

Per MDN (`ServiceWorkerRegistration.updateViaCache`):

| Value | Behavior |
|---|---|
| `'imports'` (default) | the main SW script is fetched **fresh** (no-cache); `importScripts()`/module imports go to the **HTTP cache** first. |
| `'all'` | both the SW script **and** its imports are consulted against the HTTP cache. |
| `'none'` | bypass the HTTP cache entirely — always-fresh update checks. |

### 8.3 Signing / integrity

- **None at the app level.** Integrity + authenticity come from **TLS/HTTPS** only. There is no
  application-level signature in the SW spec. (You *can* add your own content-hash checks inside the SW —
  the precache `revision` hash is exactly that — but the platform does not provide a signature.)
- **Verification failure:** an SW script that fails to parse/execute ⇒ the new SW **install fails and the
  old SW stays active**. The browser never "updates" to a broken worker.

### 8.4 Provider / scope

- The SW must be served from the **same origin** (or an allowed same-scope cross-origin) **over HTTPS**.
  No provider abstraction — it is an origin-scoped resource. (For AIRIZ the "origin" is the Pages/CDN
  fronting the console, and the Worker's version pin is replaced by a fetched `version.json` the worker
  reads at boot — see Appendix C.)

### 8.5 Protocol flow (browser-driven, not app-driven)

1. **Check.** The browser re-fetches the SW script automatically (roughly every 24h for idle clients, or
   on navigation / an explicit `reg.update()`), honoring `updateViaCache`. Plain HTTP — **not resumable**.
2. **Install.** If the bytes changed, the new SW runs its `install` event (Workbox precaches the app shell
   here from `self.__WB_MANIFEST`).
3. **Activate.** The new SW enters `waiting`; `self.skipWaiting()` makes it activate immediately (without
   waiting for the old SW's tabs to close).
4. **Control.** `clientsClaim()` makes the new SW take control of already-open clients immediately
   (instead of only documents loaded after activation); the `controllerchange` event fires on takeover.

Canonical Workbox recipe:

```js
// sw.js (Workbox 7)
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);   // precache app shell (revision-hashed URLs)
cleanupOutdatedCaches();                // drop old precache revisions on activate
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkFirst({ cacheName: 'api' }));
// optional: queue offline mutations
// registerRoute(..., new NetworkOnly({ plugins: [new BackgroundSyncPlugin('queue', {maxRetentionTime: 60*60})] }));
```

### 8.6 Channel / rollout

- **No channel model.** The "channel" is the origin + deploy. A canary is done by deploying to a different
  origin/host for a cohort, or feature-flagging behind a fetched `version.json`. There is no built-in
  percentage gate.

### 8.7 Delta / precache

- "Delta" is the **precache revision**: an asset's cache key is its content hash, so changing content
  changes the key and the old entry is garbage-collected by `cleanupOutdatedCaches()`. Only changed
  precache entries are re-fetched. (This is content-addressed diffing, not byte-level `bsdiff`.)

### 8.8 Rollback

**Forward-only at the platform level.** There is no built-in "revert to the previous SW." Rollback =
**redeploy the previous SW script** (same origin) + bump/restore precache revisions; `cleanupOutdatedCaches()`
then drops stale entries. Because the SW only takes over on a *successful* install, a broken deploy simply
does not activate — the last good SW keeps running, which is the practical safety net.

### 8.9 Failure modes

| Condition | Behavior |
|---|---|
| SW fetch 5xx / network | keeps the existing SW (no change) |
| SW script parse/runtime error | new SW install fails; old SW remains active |
| Precache revision mismatch | old precache cleaned, re-populated |
| Cache Storage quota exceeded | eviction (LRU-ish) |
| Offline | served from Cache Storage (per strategy) |
| queued offline mutation | replayed on connectivity (Background Sync) |

### 8.10 Permalinks

- Workbox precaching (`precacheAndRoute`, `cleanupOutdatedCaches`, revision semantics): https://github.com/googlechromelabs/workbox (pinned `4ea3138a120fd2c87389b54130e25f47e0fd7089`, branch `v7`)
- `updateViaCache` (MDN): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache
- W3C Service Worker spec (lifecycle, update algorithm): https://w3c.github.io/ServiceWorker/
- Registration options in the wild: https://github.com/angular/angular/blob/main/packages/service-worker/src/provider.ts

---

## 9. Microsoft App Installer / MSIX — `AppxManifest.xml` + `.appinstaller` feed, Authenticode publisher identity

- **Naming correction:** there is **no product literally called "Microsoft.AutoUpdater."** The Windows
  mechanism for MSIX deployment/updates is **Microsoft App Installer** (WinRT namespace
  `Microsoft.Management.Deployment`, aka **Windows Package Manager**) + the **MSIX** package format, with
  the **`Microsoft.AutoUpdater`** NuGet package as the in-app convenience wrapper. "Microsoft.AutoUpdater"
  in the task brief = this trio.
- **Repos/specs:** `microsoft/installer` (App Installer) · **MSIX Open Specification** (the one *formal*
  spec here) · Authenticode. **Docs:** https://learn.microsoft.com/en-us/windows/msix/
- **Status:** OS component, actively maintained (Win10 17763+ / Win11).
- **Status line:** The only updater in this survey where **the OS is the package manager**. It is the
  strongest *rollback* story (OS-level staged rollback to the prior version) and the only one with a hard
  **publisher-identity** constraint (an update must come from the same signing certificate). It is the
  reference model if AIRIZ ever packages the Electron app as MSIX for corporate deployment.

### 9.1 Wire format & the two manifests

Two manifests, distinct in role:

1. **`AppxManifest.xml`** — lives **inside** the `.msix` / `.msixbundle` (a ZIP container). Package
   identity + metadata. Real example (LocalSend):
   [localsend `AppxManifest.xml`](https://github.com/localsend/localsend/blob/main/support/build/msix/content/AppxManifest.xml).
2. **`.appinstaller`** — an **XML file served over HTTP**; the on-the-wire update feed App Installer
   fetches to learn where the current package + optional assets live.

`AppxManifest.xml` (canonical, from LocalSend):

```xml
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
         xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
         IgnorableNamespaces="uap5 desktop">
  <Identity Name="LocalSend.App" Version="1.18.2.0"
            Publisher="CN=LocalSend" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>LocalSend</DisplayName>
    <PublisherDisplayName>LocalSend</PublisherDisplayName>
    <Description>Local file sharing</Description>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" />
  </Dependencies>
  <Resources><Resource Language="en-us" /></Resources>
  <Applications>
    <Application Id="App" Executable="LocalSend.exe" />
  </Applications>
</Package>
```

| Field | Meaning |
|---|---|
| `<Identity>` `Name` | package family name (stable across updates). |
| `<Identity>` `Version` | **4-part** `major.minor.build.revision`; must increase to replace. |
| `<Identity>` `Publisher` | a **CN** (for non-Store, a GUID CN is common). **The Publisher is the update identity** — an update must come from the **same publisher** (same cert). |
| `<Identity>` `ProcessorArchitecture` | `x64`/`arm64`/`x86`/`neutral`; must match. |
| `<TargetDeviceFamily>` `MinVersion` | minimum OS build. |

`.appinstaller` (the update feed; auto-update elements added per the App Installer schema v2, Win10 2004+):

```xml
<Manifest xmlns:ms="http://schemas.microsoft.com/appx/appinstaller/2015"
          xmlns:uap5="http://schemas.microsoft.com/appx/manifest/desktop/windows10/5"
          Version="2.0">
  <MainPackage Name="Airiz.Motor"
               Publisher="CN=AIRIZ"
               Version="1.11.25.0" />
  <!-- poll the feed for updates automatically -->
  <UpdatePolicy AutomaticUpdateIntervalHours="24" />
  <UpdateSource StartUri="https://airiz-cdn.example.com/updates/Airiz.Motor.appinstaller"
                FallbackUri="https://airiz-cdn.example.com/updates/Airiz.Motor-fallback.appinstaller" />
  <Deployment>
    <OnLaunch HoursAfterUpdate="2" />          <!-- restart window after install -->
  </Deployment>
</Manifest>
```

> The `.appinstaller` points at the **next** `.appinstaller` (or a direct `.msix`/`.msixbundle` URL);
> `AutomaticUpdateIntervalHours` + `OnLaunch` are what make it *auto*-update without a user click.

### 9.2 Config / client wiring (the `Microsoft.AutoUpdater` surface)

```csharp
// Microsoft.AutoUpdater (NuGet) — the in-app wrapper over Microsoft.Management.Deployment
var updater = new AutoUpdater();                       // binds to the calling MSIX's PackageFamilyName
var result = await updater.CheckForUpdateAsync();      // DeploymentResult
switch (result.Result)
{
    case DeploymentResult.AlreadyUpToDate: /* … */ break;
    case DeploymentResult.PackageDownloaded:
        await updater.RegisterForUpdateAsync();        // schedule the staged install
        break;
    // InUse, InUseByOtherUser, BlockedByPolicy, … → surface a reason
}
// DeploymentManager (raw WinRT) equivalents:
//   FindPackageUpdatesByPackageFamilyName("Airiz.Motor_publisher")
//   AddPackage / UpdatePackage (staged)
```

- **Provider surfaces:** a **`.appinstaller` file** (any URL) as the feed; a **direct `.msix`/`.msixbundle`
  URL**; the **Microsoft Store**; or **Windows Update for Business**. The programmatic surface is
  `DeploymentManager` / the `Microsoft.AutoUpdater` wrapper.
- **Diff updates:** the Windows package store performs **differential app installs** (only changed
  package files are written) — an OS-level delta, transparent to the app.

### 9.3 Signing

- **Algorithm:** **Authenticode** (PE signing). The whole `.msix` is signed; the `AppxManifest.xml` is
  signed with the publisher's certificate (hashes of all package files + the manifest).
- **Integrity:** Authenticode signature over every package file (subsumes hashing).
- **Key custody:** your **code-signing certificate** (a real CA cert, or a self-signed / GUID CN cert for
  sideloading). **Public key location:** the signing cert / Windows **publisher identity** trust store.
- **Verification failure:** Windows **blocks installation** — signature invalid, **or publisher mismatch**
  with the installed package. Update identity is enforced: a different publisher cannot update your app.

### 9.4 Protocol flow

1. **Check.** App Installer reads the `.appinstaller` (or the `Microsoft.AutoUpdater` wrapper queries
   `DeploymentManager`), honoring `AutomaticUpdateIntervalHours`.
2. **Select.** If the feed's `MainPackage` `Version` is higher than the installed one **and** the
   `Publisher` matches, an update is available.
3. **Download.** The OS downloads the `.msix`/`.msixbundle` (WinHTTP; the OS manages the transfer),
   verifying the Authenticode signature. Caches the package in the Windows package store (differential).
4. **Install.** `UpdatePackage`/`AddPackage` → Windows **stages** and **atomically installs** the new
   package. Supports **staged deployment** (deploy to a staging area, apply at maintenance time / next
   boot, or within the `OnLaunch` restart window). A higher 4-part version is required to replace.

### 9.5 Channel / rollout

- **Channel** = separate `.appinstaller` feeds (or Store vs sideloaded tracks). There is no percentage gate
  in the `.appinstaller` itself; a canary is a separate feed/endpoint.
- **Rollout:** for enterprise, **Windows Update for Business** rings/feature updates provide the rollout
  machinery; a self-hosted `.appinstaller` has no built-in percentage (the R2 spec adds one — Appendix C).

### 9.6 Rollback ← strongest OS-level rollback in this survey

Windows **retains the previous package version** and can **roll back a failed update** automatically (the
package manager restores the prior version if the new one fails to deploy/launch). This is the most robust
"real" rollback of all nine systems because it is enforced by the **OS package store**, not the app.

### 9.7 Failure modes

| Condition | Behavior |
|---|---|
| Authenticode signature invalid | install blocked |
| Publisher mismatch with installed app | update blocked (identity check) |
| New `Version` not higher | no-op (must be newer) |
| Download fail / 5xx | retryable (BITS/WinHTTP) |
| `.appinstaller` 404 | "update source not found" |
| `InUse` / `InUseByOtherUser` | install deferred until the app is closed |
| Blocked by policy | `BlockedByPolicy` (enterprise App Installer policy) |

### 9.8 Permalinks

- `AppxManifest.xml` (real, LocalSend): https://github.com/localsend/localsend/blob/main/support/build/msix/content/AppxManifest.xml
- Blender MSIX `AppxManifest.xml.template`: https://github.com/blender/blender/blob/main/release/windows/msix/AppxManifest.xml.template
- App Installer (AppxInstaller / schema): https://learn.microsoft.com/en-us/windows/msix/app-installer/
- App Installer file overview: https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview
- `Microsoft.Management.Deployment` (WinRT): https://learn.microsoft.com/en-us/windows/win32/api/
- MSIX Open Specification: https://learn.microsoft.com/en-us/windows/msix/

---

# Appendices

## Appendix A — Cross-system failure-mode matrix and rollback ranking

Legend: ✅ handled gracefully · ⚠️ manual / degraded · ❌ none

| Failure | Squirrel | Sparkle | electron-upd | Tauri | Capawesome | Expo | CodePush | PWA/SW | MSIX |
|---|---|---|---|---|---|---|---|---|---|
| Integrity / checksum mismatch | ✅ SHA-1 abort | ✅ len+ed abort | ✅ SHA-512 abort | — (sig) | ✅ checksum abort | ✅ hash abort | ✅ hash abort | n/a (TLS) | ✅ Authenticode |
| Signature / auth invalid | ⚠️ (none; HTTPS) | ✅ ed25519 block | ✅ AuthCode/RSA/manifest | ✅ minisign reject | ✅ RSA reject | ✅ code-sign reject | ⚠️ (UWP key only) | ❌ (TLS only) | ✅ publisher check |
| Feed / manifest 404 | ✅ retry/keep | ✅ "can't check" | ✅ "no update info" | ✅ "no update" | ✅ keep prior | ✅ embedded floor | ✅ retry | ✅ keep old SW | ✅ keep current |
| 5xx / transient | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ keep old SW | ✅ retryable |
| Partial / corrupt download | ✅ hash fail | ✅ len fail | ✅ blockmap+sha | ✅ sig fail | ✅ checksum fail | ✅ hash fail | ✅ hash fail | ✅ SW parse fail | ✅ sig fail |
| Crash mid-install | ⚠️ re-release | ⚠️ re-release | ⚠️ re-release | ⚠️ re-release | ✅ kill-safe rollback | ✅ embedded floor | ✅ failed-hash block | ✅ old SW stays | ✅ OS rollback |
| Bad release already shipped | ⚠️ new release | ⚠️ new signed | ⚠️ new yml | ⚠️ new JSON | ✅ rollback()+block | ✅ server rollback | ✅ client+server rb | ⚠️ redeploy SW | ✅ OS rollback |

**Rollback capability ranking** (best → weakest):

1. **MSIX / App Installer** — OS-enforced staged rollback to the prior version (package store keeps it).
2. **Capawesome live-update** — kill-safe auto-rollback to the embedded bundle + LRU blocked-bundle list.
3. **Expo Updates** — server-side rollback + an always-available embedded fallback floor (anti-bricking).
4. **CodePush** — client + server rollback + failed-hash blocking (but the service is retired).
5. **PWA / Workbox** — forward-only; a broken SW simply never activates, so the last good SW survives.
6. **electron-updater / Tauri / Sparkle / Squirrel** — no auto-rollback; ship a corrected higher version.

**Integrity-only (no authenticity) systems:** Squirrel (HTTPS + SHA-1) and PWA/SW (TLS only) are the two
that can be MITM'd at the feed level if you lose TLS. Every other system in the table has a real signature.
This is the single most important reason the R2 spec signs the feed itself (Appendix C).

---

## Appendix B — Design-idea provenance (where each R2-spec feature came from)

Every feature in the proposed AIRIZ manifest (Appendix C) is borrowed from a real, working system. This
table records the provenance so the R2 decision is auditable — no feature is invented from scratch.

| R2 feature | Borrowed from | The exact prior-art field / mechanism |
|---|---|---|
| Single signed JSON feed | Tauri (`endpoints` + JSON) | `RemoteRelease` JSON; the only clean "one JSON, signed" desktop model |
| Feed-level ed25519 signature | Sparkle 2.x + Tauri + electron-builder v27 | Sparkle `sparkle:edSignature`/`edKey`; Tauri minisign `signature`+`pubkey`; electron `updateManifestPublicKey` |
| Per-artifact hash + size | All nine | Squirrel `SHA1`+size; electron `sha512`+`size`; Expo `launchAsset.hash`; Capawesome `checksum` |
| Channel = field, not just URL | Expo (branch) + Capawesome (channel) + CodePush (deployment) | Expo `branch`; Capawesome `defaultChannel`/`production-<versionCode>`; CodePush `deployment_key` |
| Native-version gate | CodePush + Expo | CodePush `target_binary_range`/`app_version`; Expo `runtimeVersion` (appVersion/nativeVersion/fingerprint) |
| Staged rollout percentage | Squirrel + electron + Capawesome + CodePush | Squirrel `# <pct>`; electron `stagingPercentage`; Capawesome `--rollout-percentage`; CodePush `rollout` |
| `mandatory` flag | CodePush | `is_mandatory` |
| Publish timestamp | Sparkle + Tauri + electron | `pubDate` / `pub_date` / `releaseDate` |
| Content-addressed staging | CodePush + restic/ipfs (general) | CodePush `packageHash` folder name; hash-named staging dir |
| Failed-package blocking | CodePush + Capawesome | CodePush `IsFailedHash`/`failedUpdates`; Capawesome `autoBlockRolledBackBundles` (LRU) |
| Client→server status telemetry | CodePush | `DeploymentStatusReport` (Succeeded/Failed, prev label/hash) |
| Kill-safe rollback to embedded | Capawesome | `ready()` + `readyTimeout` → reset to embedded bundle |
| Embedded fallback floor (anti-brick) | Expo | always-available embedded update + `disableAntiBrickingMeasures` (off) |
| Block-level delta (desktop) | electron-updater | `.blockmap` BLAKE2 block hashes |
| bsdiff delta (mobile/JS) | Expo + Squirrel + Sparkle | Expo `enableBsdiffPatchSupport`; Squirrel `-delta.nupkg`; Sparkle `BinaryDelta` |
| Content-hash precache (web) | Workbox | `precache-manifest.js` `revision` = content hash + `cleanupOutdatedCaches()` |
| Publisher-identity constraint | MSIX | `<Identity>` `Publisher` CN must match the installed package |
| OS-level staged rollback | MSIX | Windows package store keeps the prior version and restores on failure |
| Self-signed / TLS feed as baseline trust | Squirrel + PWA | (the anti-pattern we are fixing by signing the feed) |

> **Reading of the provenance:** the R2 spec is essentially *Tauri's JSON-feed shape* + *Sparkle/Tauri's
> ed25519 feed signature* + *Expo's channel/runtimeVersion/anti-brick* + *CodePush's rollout/telemetry/
> failed-block* + *Capawesome's kill-safe rollback* + *electron's blockmap delta*, with *MSIX's*
> publisher-identity and rollback as the "if we ever go MSIX" end-state. Nothing in it is novel; the
> novelty is only in *assembling one signed feed that all four AIRIZ surfaces read a slice of.*

---

## Appendix C — Minimum-viable-subset synthesis: one signed manifest on R2 (the R2 spec input)

This is the decision-relevant output. The goal: choose the **smallest** set of update features — signature
scheme, channel model, rollout gating, delta support, cache layout — that (a) is provably sufficient for
AIRIZ's four surfaces (Electron desktop, Capacitor mobile, PWA, Cloudflare Worker), and (b) each of whose
pieces is borrowed from a system already proven in production (Appendix B). The recommendation below is a
**single signed JSON feed on R2** that every client reads its own slice of.

### C.1 The five decisions, decided

**1. Signature scheme → ed25519 (EdDSA), raw, over the manifest; per-artifact SHA-256.**
- The **manifest itself is signed** (not just the artifacts). This is the one change that fixes the two
  MITM-able systems (Squirrel's HTTPS+SHA-1, PWA's TLS-only) and matches the three strongest precedents:
  Sparkle 2.x (`sparkle:edSignature`), Tauri (minisign `signature`+`pubkey`), and electron-builder v27
  (`updateManifestPublicKey`).
- Use **raw ed25519** (RFC 8032), *not* minisign. Reason: minisign prepends a 42-byte header to the signed
  payload, which is a foot-gun when a *fourth* surface (a Worker, a Python script) must verify the same
  signature with a generic crypto lib. Raw ed25519 verifies identically in every language AIRIZ touches.
  (Tauri still works — you sign the manifest with raw ed25519; only Tauri's *artifact* signatures stay
  minisign, which the Tauri client verifies itself.)
- **Key model:** one ed25519 keypair. The **public key is compiled into every client** (desktop binary,
  mobile bundle, PWA, Worker) — not fetched. This is the Sparkle "pin in the app" posture, strictly stronger
  than Sparkle's in-feed `edKey`. The **private key lives only in CI** (signing step); it never reaches R2.
- Per-artifact integrity stays a **SHA-256** in the manifest (universal, what Expo/Capawesome/CodePush use);
  the ed25519 manifest signature is what makes that hash trustworthy.

**2. Channel model → one feed document, a `channels` map, each entry per (surface × channel).**
- A channel is a **field in the manifest, not a separate URL** (Expo `branch` + Capawesome `channel`
  precedent). The feed is *one* signed document; a client selects
  `channels[surface][channel]`. This means a canary is a *slice of the same signed doc*, so the feed stays
  the single source of truth and the signature covers every channel at once.
- Surface slices: `desktop` (electron-updater), `mobile` (Capawesome), `web` (PWA/Worker). A client reads
  only its own slice; the others are inert to it.

**3. Rollout gating → signed `staging` percentage, client-id bucketed, sticky.**
- Borrow the knob that exists in four systems (Squirrel `# <pct>`, electron `stagingPercentage`,
  Capawesome `--rollout-percentage`, CodePush `rollout`). The percentage lives **in the manifest** (so it is
  signed and cannot be flipped by a feed MITM), and the client buckets by a **stable, app-owned identity**
  (`sha256(installId) % 100 < staging`), sticky across launches — the CodePush `client_unique_id` /
  Firebase-model behaviour. Gating is **client-side and deterministic**, which is what makes it auditable and
  what keeps the "is this client in the 10%" decision reproducible offline.

**4. Delta support → NONE for v1 (full artifacts only); the schema reserves the field for blockmap/bsdiff.**
- This is the highest-leverage "do less" decision. AIRIZ is a one-person team; the desktop bundle is not yet
  at the scale where `bsdiff`/`blockmap` returns its complexity cost (the multi-day per-prior-version diff
  pipeline, the N-1/N-2 fallback graph, the rollback complication — all analysed in
  `updater-topic-deep-dives-r1.md` §(a)). Ship **full artifacts + SHA-256** first.
- Reserve, do not build: a per-artifact `delta` object (`{ fromVersion, url, hash, kind: "blockmap"|"bsdiff" }`).
  When it pays for itself, electron-updater's **blockmap** is the desktop delta to adopt (it is already
  BLAKE2-block differential and resumable) and Expo's **bsdiff** is the mobile/JS delta — so the reserved
  field maps 1:1 onto an existing implementation, not a new one.

**5. Cache layout → content-addressed staging dir; verify-before-rename; embedded floor on mobile.**
- Every artifact is staged by **hash**, not version: `<cache>/staging/<sha256>`. The client downloads to
  the hash path, **verifies SHA-256 *then* verifies the manifest signature**, and only then atomically
  renames into place. (This is the restic/ipfs/content-addressed pattern that makes a partial write
  indistinguishable from "no download" — the exact CrowdStrike-class failure mode §1 of
  `updater-hardest-problems-r1.md`.)
- **Mobile keeps the embedded bundle as the floor** (Expo/Capawesome anti-brick): a bad JS bundle can never
  take the app to zero, and `ready()`+`readyTimeout` gives kill-safe rollback to that floor.

### C.2 The manifest document (concrete, signable, four-surface)

```jsonc
// https://airiz-cdn.example.com/updates/manifest.json   (served from R2, over HTTPS)
// Signed by CI with the ed25519 private key; the public key is compiled into every client.
{
  "format": "airiz.update/1",           // manifest schema version (bump on breaking change)
  "pub_date": "2026-11-04T10:00:00Z",   // publish timestamp (Sparkle/Tauri/electron precedent)
  "signature": "BASE64_ED25519_SIGNATURE_OVER_CANONICAL_JSON",   // over the doc minus this field
  "channels": {
    "desktop": {
      "latest": {
        "version": "1.11.25",
        "staging": 100,                              // 0..100 signed rollout gate
        "mandatory": false,
        "artifacts": {
          "windows-x64":  { "url": "…/airiz-1.11.25-win-x64.exe",  "hash": "SHA256HEX", "size": 139083536 },
          "darwin-arm64": { "url": "…/airiz-1.11.25-mac-arm64.zip", "hash": "SHA256HEX", "size": 98000000 }
        }
        // reserved, NOT built in v1:  "delta": { "fromVersion":"1.11.24", "kind":"blockmap", "url":"…", "hash":"…" }
      },
      "beta": { "version": "1.12.0-rc.1", "staging": 25, "artifacts": { "…": { "…": "…" } } }
    },
    "mobile": {
      "latest": {
        "version": "1.11.25",
        "runtimeVersion": "1.11",                   // Expo-style native/runtime gate
        "staging": 50,
        "artifacts": {
          "bundle": { "url": "…/airiz-web-1.11.25.zip", "hash": "SHA256HEX", "size": 4200000, "kind": "zip" }
        }
      }
    },
    "web": {
      "latest": {
        "version": "1.11.25",
        "staging": 100,
        "assets": [                                  // Workbox-style content-hash precache slice
          { "path": "index.html",        "hash": "SHA256HEX" },
          { "path": "assets/app.9f8e7d.js", "hash": null }   // hashed filename → null
        ]
      }
    }
  }
}
```

- **`format`** is the version the verifier refuses to ignore (an unknown major ⇒ reject, never guess).
- **`signature`** is the only self-referential field: it is computed over the canonical-JSON serialisation
  of the document *with `signature` removed* (deterministic key order, no whitespace) — the standard way to
  avoid the sign-your-own-signature problem.
- **`staging`** is per (surface × channel), so desktop/beta can canary at 25% while desktop/latest is at
  100% and mobile is at 50%, independently.

### C.3 Verification sequence (every client, identical)

1. **Fetch** `manifest.json` over HTTPS. (TLS protects transport; the signature protects content.)
2. **Parse + gate on `format`.** Unknown/unsupported `format` major ⇒ refuse, keep current.
3. **Verify the ed25519 signature** over the canonical-JSON-minus-signature against the **compiled-in public
   key.** Fail ⇒ refuse the whole feed, keep current, and (desktop/mobile) report a `ManifestBad` status.
4. **Select the slice** `channels[surface][channel]`.
5. **Bucket:** compute `bucket = sha256(installId) % 100`; if `bucket >= staging`, this client is *not yet*
   offered the entry → stay current (the signed percentage is what makes this MITM-proof).
6. **Download** the artifact to `<cache>/staging/<hash>` (content-addressed).
7. **Verify SHA-256** of the downloaded bytes == `hash`. Fail ⇒ delete, keep current.
8. **Activate:** desktop → atomic rename into place, relaunch; mobile → load local bundle, call `ready()`
   (kill-safe rollback to embedded floor if `ready()` is missed within `readyTimeout`); web → update
   precache / `version.json`, `skipWaiting`+`clientsClaim`.

### C.4 Rollback posture (per surface, using only what already exists)

| Surface | Rollback | Mechanism (all prior-art, Appendix B) |
|---|---|---|
| Desktop (Electron) | ship a corrected higher `version`; the hash-staged prior version is still on disk | electron-updater "re-release"; content-addressed staging keeps N-1 recoverable |
| Mobile (Capacitor) | **kill-safe auto-rollback** to the embedded bundle + block the bad bundle id | Capawesome `ready()`/`readyTimeout` + `autoBlockRolledBackBundles` (LRU) |
| Web (PWA) | redeploy prior precache; a bad SW never activates anyway | Workbox content-hash precache + SW install-only-on-success |
| Feed itself | republish a corrected signed manifest (atomic R2 overwrite) | the signature makes a republish instant and tamper-evident |

### C.5 What is deliberately NOT in v1

- **No delta** (blockmap/bsdiff) — reserved field only; add when the bundle is large enough to justify it.
- **No in-feed public key** — the key is compiled in; a feed MITM cannot swap the key.
- **No percentage on the feed server** — the gate is in the signed doc + client-side, so it is deterministic
  and offline-reproducible.
- **No MSIX publisher identity** — that comes free only if the Electron app is ever packaged as MSIX
  (System 9); for a one-person team it adds Authenticode + publisher-cert ops for no near-term benefit.

### C.6 One-paragraph bottom line

Adopt **Tauri's single-signed-JSON shape**, sign it with **raw ed25519** (public key compiled in — the
Sparkle/Tauri/electron-v27 posture), carry an **Expo-style `runtimeVersion`** gate and a **signed `staging`
percentage** (the Squirrel/electron/Capawesome/CodePush canary knob, client-id bucketed and sticky), store
artifacts by **SHA-256 in a staging dir** (content-addressed, verify-before-rename), and **skip delta in
v1** (reserve the `delta` field for electron's blockmap / Expo's bsdiff). Keep the **embedded-bundle floor +
kill-safe rollback** on mobile (Capawesome/Expo anti-brick) and the **content-hash precache** on web
(Workbox). That is the minimum set: one signed feed on R2, one key, one deploy step, four surfaces each
reading its slice, with the strongest mobile rollback in the class and zero invented features.

---

## Appendix D — Consolidated citations

### Primary source (code) — SHA-pinned where the commit was resolved 2026-11-04

**Squirrel.Windows** (`Squirrel/squirrel.windows` @ `51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`)
- `ReleaseEntry` (line grammar, SHA-1): …/blob/51f5e2c…/src/Squirrel/ReleaseEntry.cs
- Check logic: …/blob/51f5e2c…/src/Squirrel/UpdateManager.CheckForUpdates.cs
- Apply logic: …/blob/51f5e2c…/src/Squirrel/UpdateManager.ApplyReleases.cs
- Real `RELEASES`: https://github.com/GitbookIO/nuts/blob/master/test/win-releases.js
- Arch-parsing quirk: https://github.com/stagewise-io/stagewise/blob/main/apps/update-server/src/releases.ts

**Sparkle** (`sparkle-project/Sparkle` @ `14fdbf28dc7c6fd8741a144bff517ef86572e6c2`)
- Canonical appcast field set: …/blob/14fdbf2…/Resources/SampleAppcast.xml
- Delta tool: …/blob/14fdbf2…/BinaryDelta/main.swift
- Real ed25519 appcast: https://github.com/fcjr/ventoy-mac/blob/main/appcast.xml

**electron-updater** (`electron-userland/electron-builder` @ `ae8031420ad0662b84195342759dba4350ffcedd`)
- `AppUpdater` (staging, public key, blockmap): …/blob/ae80314…/packages/electron-updater/src/AppUpdater.ts
- `providerFactory` (live provider set): …/blob/ae80314…/packages/electron-updater/src/providerFactory.ts
- `GenericProvider`: …/blob/ae80314…/packages/electron-updater/src/providers/GenericProvider.ts
- `GitHubProvider`: …/blob/ae80314…/packages/electron-updater/src/providers/GitHubProvider.ts
- Real `latest.yml`: https://github.com/msojocs/fiddler-everywhere-enhance/…/v/4.6.2/p/win/latest.yml · https://github.com/solidtime-io/solidtime/blob/main/public/desktop-version/latest.yml

**Tauri 2 updater** (`tauri-apps/plugins-workspace` @ `74a44c1d5694324b7fb9ba5ee9271a3096da9387`)
- Protocol (`RemoteRelease`, `Installer`, minisign verify): …/blob/74a44c1…/plugins/updater/src/updater.rs
- v1→v2 config migration: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/migrate/migrations/v1/config.rs

**Capacitor Live Update** (`capawesome-team/capacitor-plugins`)
- Definitions (`artifactType`): https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts
- `Manifest` (Android/iOS): …/packages/live-update/android/…/classes/Manifest.java · …/ios/Plugin/Classes/Manifest.swift
- `LiveUpdate` (manifest-file constant): …/packages/live-update/android/…/LiveUpdate.java

**Expo Updates** (`expo/expo` @ `c59120da912d8bc1b3dadf7a75e320541e2a1a63`)
- Update-server manifest fixture: …/blob/c59120d…/packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts
- Android config (`UpdateEntity`, runtimeVersion, code signing): …/blob/c59120d…/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt

**CodePush** (`microsoft/react-native-code-push` @ `d3b163d8d7522f02081eee2b5d735705b5d54c00`, archived)
- Contract types (`UpdateCheckRequest`/`Response`, `DeploymentStatusReport`): …/blob/d3b163d…/src/script/types.ts
- Acquisition SDK (`BASE_URL_PART`, `RemotePackage`, `Configuration`): …/blob/d3b163d…/src/script/acquisition-sdk.ts
- `packageHash` on-disk layout: …/blob/d3b163d…/windows-legacy/CodePush/UpdateManager.cs
- UWP RSA verification: …/blob/d3b163d…/windows/CodePush/CodePushPackage.cpp
- Retirement notice: https://github.com/microsoft/react-native-code-push/blob/master/README.md

**PWA / Workbox** (`googlechromelabs/workbox` @ `4ea3138a120fd2c87389b54130e25f47e0fd7089`, branch `v7`)
- precaching / strategies / core sources in-repo
- Registration options in the wild: https://github.com/angular/angular/blob/main/packages/service-worker/src/provider.ts · https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/service-worker/app/page.js

**MSIX / App Installer**
- `AppxManifest.xml` (real): https://github.com/localsend/localsend/blob/main/support/build/msix/content/AppxManifest.xml · https://github.com/blender/blender/blob/main/release/windows/msix/AppxManifest.xml.template
- App Installer repo: https://github.com/microsoft/installer

### Official docs / specs

- Squirrel.Windows: https://github.com/Squirrel/Squirrel.Windows · https://squirrel.github.io
- Sparkle (appcast + publishing): https://sparkle-project.org/documentation/
- electron-builder auto-update (signed update manifests, key rotation): https://www.electron.build/docs/features/auto-update
- Tauri updater: https://v2.tauri.app/plugin/updater/
- Capawesome live-update (channels, rollouts, self-hosting, signing): https://capawesome.io/docs/plugins/live-update/
- Expo Updates + **protocol v1 spec**: https://docs.expo.dev/develop/updates/ · https://docs.expo.dev/technical-specs/expo-updates-1.md
- CodePush → EAS migration: https://docs.expo.dev/eas-update/codepush/
- W3C Service Worker + MDN `updateViaCache`: https://w3c.github.io/ServiceWorker/ · https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache · Workbox: https://workboxjs.com
- MSIX / App Installer: https://learn.microsoft.com/en-us/windows/msix/ · https://learn.microsoft.com/en-us/windows/msix/app-installer/

*Reference compiled 2026-11-04 (Asia/Bangkok). Pinned commits were resolved via `gh api` on that date;
"verify on GitHub" cells (electron-builder exact tag, Workbox exact tag, deprecated Capacitor last version)
could not be machine-confirmed behind the org proxy and are flagged as such rather than asserted.*

---

## Appendix E — In-progress PR drafts (checked 2026-11-04 via `gh search prs --state open`)

The task asked to "call out any in-progress PR drafts" and "if a system has a known protocol draft PR,
call out the differences." I searched the live repos on 2026-11-04. **Finding: none of the nine systems has
an open PR that redefines its manifest / wire schema.** Each protocol is either implemented and stable
(Sparkle 2.x appcast, Tauri v2, electron `latest.yml`), published as a formal spec (Expo Updates protocol
v1, MSIX Open Spec), or archived (CodePush). The open PRs that matter are **hardening / behaviour**
changes *around* the protocol, not redefinitions of it:

| System | Open PR | What it changes | Protocol impact |
|---|---|---|---|
| electron-updater | **#10566** (open, 2026-11-03, `!` breaking) | **Reject plain-HTTP update requests and https→http downgrade redirects** | Hardens feed *transport* security. Reinforces the R2 rule: HTTPS for transport, ed25519 for content. |
| electron-updater | **#10563** (open, 2026-11-03, `!` breaking) | Cross-origin feed requests send only headers `autoUpdater.crossOriginHeaders` allows | Tightens which request headers cross the feed origin boundary (CORS hygiene). |
| electron-updater | #10568 (open, 2026-11-04) | Document the `crossOriginHeaders` rule in the feed-query warning + changesets + docs | Advisory; makes the #10563 rule visible. |
| Tauri 2 updater | #3639 (open, 2026-11-03, `!` breaking) | Cache update checks in memory | Behaviour / perf only; JSON manifest shape + minisign signature unchanged. |
| Tauri 2 updater | #3581 (open, 2026-09-24) | Keep Linux installers off BSD targets | Installer targeting only. |
| Sparkle | #2924 (open, 2026-09-16) | `generate_appcast`: formalize `--verbose`, log every stage | CLI / observability only; appcast schema + ed25519 unchanged. |
| Expo Updates | #52903, #52902 (open, 2026-11-04) | Use error codes / add log-message keys from `expo-updates-interface` (iOS+Android) | Error / log plumbing; **protocol v1 wire format unchanged**. |
| Expo Updates | #51882, #51884 (open, Oct–Nov 2026) | `[observe]` expo-updates integration + report log entries | Observability only; no wire-format change. |
| Expo Updates | #48337 (open, 2026-10-28) | Fix SSR memory leak (OOM) when imported by expo-router | Bug fix; no protocol change. |

**Net for AIRIZ (Appendix C):** the only in-flight change touching the *security model* is electron-updater's
**reject-plain-HTTP / reject-downgrade** work (#10566, with #10563/#10568 as companions). That is current,
strong prior-art validation of the R2 spec's two-layer trust model (TLS for transport + signed feed for
content). Adopt the same posture in the client: **reject a `http://` manifest URL and any `https→http`
redirect before the JSON is even parsed.** Every other open PR (Tauri caching, Sparkle logging, Expo
observability) leaves the manifest schema untouched, so there is no "draft-difference" to reconcile against
this spec.

- https://github.com/electron-userland/electron-builder/pull/10566
- https://github.com/electron-userland/electron-builder/pull/10563
- https://github.com/electron-userland/electron-builder/pull/10568
- https://github.com/tauri-apps/plugins-workspace/pull/3639
- https://github.com/sparkle-project/Sparkle/pull/2924
- https://github.com/expo/expo/pull/52903 · /pull/52902 · /pull/51882 · /pull/51884 · /pull/48337
