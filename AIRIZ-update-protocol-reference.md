# AIRIZ Motor Console - Cross-Platform Auto-Update Engine Protocol Reference

**Date**: 2026-11-05
**Scope**: Protocol-level spec for 11 update engines across desktop, mobile, web, and serverless.
**Purpose**: Enable side-by-side architectural comparison for AIRIZ unified release strategy.

---

## (a) electron-updater

**Canonical repo**: https://github.com/electron-userland/electron-builder
**Latest stable**: electron-updater@6.8.12 (published 2026-10-26)
**Latest alpha**: electron-updater@7.0.0-alpha.13 (published 2026-10-29)
**Package**: bundled in electron-builder monorepo under packages/electron-updater/

### Manifest / Channel File Format

The channel file is a **YAML document** (not JSON). For the latest channel on macOS the file is named latest-mac.yml; on Linux latest-linux.yml; on Windows latest.yml.

**Schema** (from packages/builder-util-runtime/src/updateInfo.ts):

`	ypescript
export interface UpdateInfo {
  readonly version: string                          // semver string
  readonly files: Array<UpdateFileInfo>             // array of download descriptors
  readonly releaseName?: string | null
  readonly releaseNotes?: string | Array<ReleaseNoteInfo> | null
  readonly releaseDate: string                      // ISO 8601
  readonly stagingPercentage?: number               // 0-100, staged rollout
  readonly minimumSystemVersion?: string            // e.g. "10.0.22631"
  readonly signature?: string                       // base64 Ed25519 (legacy single-key)
  readonly signatures?: Array<UpdateManifestSignature>  // multi-key (key rotation)
}

export interface UpdateFileInfo extends BlockMapDataHolder {
  url: string              // relative to feed base URL
  blockMapUrl?: string     // optional separate blockmap URL
  // inherited: size?, blockMapSize?, sha512: string, isAdminRightsRequired?
}

export interface UpdateManifestSignature {
  readonly keyId: string    // hex SHA-256 of SPKI DER
  readonly signature: string // base64 Ed25519 sig over canonical manifest
}
`

**Example latest.yml payload**:

`yaml
version: 2.1.0
files:
  - url: AIRIZ-Setup-2.1.0.exe
    sha512: a3f2b8c9d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12
    size: 52428800
  - url: AIRIZ-2.1.0.dmg
    sha512: b4c3d9e0f5a6b7c8192837465a6b7c8d9e0f1a2b3c4d5e6f70819283a4b5c6d7e8f
    size: 48234496
releaseDate: '2026-10-28T10:30:00.000Z'
stagingPercentage: 50
minimumSystemVersion: 10.0.22631
signature: MEUCIQD...base64ed25519...
signatures:
  - keyId: a1b2c3d4e5f6...
    signature: MEUCIQD...base64ed25519...
`

### Signature Scheme

- **Algorithm**: Ed25519 (pure EdDSA, no hash pre-processing)
- **What is signed**: canonicalized manifest's integrity-critical fields (version, files array with url+sha512, stagingPercentage, minimumSystemVersion). The signature does NOT cover releaseNotes or releaseDate.
- **Where stored**: embedded in the manifest itself as signature (legacy single-key) and/or signatures[] (multi-key for rotation)
- **Key format**: base64-encoded Ed25519 public key; keyId is lowercase hex SHA-256 of the SPKI DER encoding
- **Verification code path**: the updater fetches the channel file, parses YAML (with alias-bomb protection), verifies the Ed25519 signature against updateManifestPublicKey configured in app-update.yml, then checks the sha512 of the downloaded binary.
- **Authenticode (Windows)**: after download, the NSIS installer is verified via Windows Authenticode. VerifyUpdateFileAuthenticodeSignature callback allows custom publisher-name validation.

### Provider Abstraction

Five provider classes in packages/electron-updater/src/providers/:

| Provider | Config | Expected |
|----------|--------|----------|
| GenericProvider | url: string | Fetches {url}/latest.yml (or latest-mac.yml, latest-linux.yml) |
| GitHubProvider | owner, repo, host | Fetches Atom feed, finds latest release, reads latest.yml from assets |
| GitLabProvider | owner, repo, host | Similar to GitHub but via GitLab API |
| PrivateGitHubProvider | owner, repo, token | GitHub + Bearer token auth |
| BitbucketProvider | owner, repo, host | Bitbucket API |

The Provider base class defines getLatestVersion() (abstract), resolveFiles() (abstract), channelFileRequest() with size limit, and YAML alias-bomb protection (v27+ rejects manifests exceeding the budget).

### Verification Flow

1. Fetch channel file, parse YAML, verify manifest signature (if updateManifestPublicKey set)
2. Download update file, compute SHA-512, compare with files[].sha512
3. (Windows) Verify Authenticode signature on the downloaded NSIS installer
4. On mismatch: error thrown, update rejected
5. Revoked key: not natively supported; key rotation is handled by dual-signing

### Rollout Controls

- **Staged rollout**: stagingPercentage: 0-100 in the manifest. The updater hashes the user's machine ID and only applies if the hash falls within the percentage.
- **Channels**: separate files - latest.yml (stable), beta.yml, alpha.yml, canary.yml. Set via autoUpdater.channel = 'beta'.
- **Kill switch**: remove the channel file from the server (404 = no update).
- **Fallback channel**: not built-in.

### Rollback Mechanics

- **No auto-rollback**. If a new version crashes, the user must manually reinstall the previous version.
- autoInstallEvent setting: "onQuit", "onNextLaunch", or "manual".
- "onNextLaunch" (v7 alpha) defers installation to the next launch, re-validating the cached update.
- Rollback latency: indefinite (requires manual action).

### App-Quit Timing

- autoInstallEvent "onQuit": spawns installer while app exits
- autoInstallEvent "onNextLaunch": persists download, installs at next launch start
- autoInstallEvent "manual": never auto-installs; requires explicit quitAndInstall()
- Windows: NSIS installer runs post-quit; app restarts if isForceRunAfter: true
- macOS: Squirrel.Mac-style staging (app bundle swapped on next launch)

### Known Limitations

- YAML only - no JSON manifest support
- YAML alias bomb protection (v27+): manifests with excessive aliases are rejected
- No native key revocation: rotation requires dual-signing and updating all clients
- S3/B2 provider removed in v6+; use GenericProvider with pre-signed URLs or a CDN
- Bintray and Spaces providers deprecated/removed
- Authenticode only on Windows; macOS uses manifest signature + SHA-512
- No delta updates by default; blockmap-based differential download is supported but requires old blockmap
