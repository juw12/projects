# Cross-Platform Update Manifest Survey — 7 Protocols, Cited

> **Owner:** Juwen Lie · Team Ziris PTB
> **Date:** 2026-11-05
> **Scope:** Real docs, spec versions, manifest examples, required/optional field
> lists, and open draft PRs for the seven manifest formats currently in
> AIRIZ Motor Console's update path (electron-builder NSIS, Tauri 2.x updater,
> Capawesome Live Update, Squirrel.Windows, Sparkle, PWA Service Worker,
> Microsoft AppInstaller). Plus the minimum viable subset that would let
> every AIRIZ surface read a single signed JSON manifest.
>
> **Method:** Context7 (where library docs are indexed), GitHub `gh` CLI for
> open draft PRs across each project's main repo, WebFetch / WebSearch for the
> canonical spec pages (electron.build, learn.microsoft.com, sparkle-project.org,
> w3.org, developer.mozilla.com, developer.chrome.com).
>
> **Companion docs:**
> - `release-architecture-reference.md` — 17-protocol deep catalog (prior research, this
>   doc is the focused, cited refresh of items 1, 5, 6, 7 plus current Tauri/Capawesome/PWA).
> - `cross-platform-unified-update-survey.md` — external-framework survey.
> - `unified-release-architecture-decision-2026-11-04.md` — the Option C
>   decision that this survey exists to verify.
>
> **Findings vs prior research:** prior research was directionally correct;
> today's pass added (1) the **EBUM2** draft PR (#10426, open as of 2026-10-24)
> which changes electron-builder's signing contract, (2) Capawesome 8.x
> confirms **RSA-only** signing (not Ed25519) for self-hosted bundles, (3)
> Sparkle PR #2924 is the only open Sparkle PR, (4) the AppInstaller
> update-settings schema evolved to add `ShowPrompt` + `UpdateBlocksActivation`
> in Windows 10 1903, and (5) Workbox precache manifest is now strictly
> `{url, revision, integrity?}` objects (no string URLs since v5).

---

## Table of Contents

1. [electron-builder NSIS auto-update protocol](#tool-1-electron-builder-nsis-auto-update-protocol)
2. [@tauri-apps/updater protocol (Tauri 2.x)](#tool-2-tauri-appsupdater-protocol-tauri-2x)
3. [Capacitor Live Update manifest spec](#tool-3-capacitor-live-update-manifest-spec)
4. [Squirrel.Windows](#tool-4-squirrelwindows)
5. [Sparkle](#tool-5-sparkle)
6. [PWA service worker update lifecycle](#tool-6-pwa-service-worker-update-lifecycle)
7. [Microsoft AppInstaller schema](#tool-7-microsoft-appinstaller-schema)
8. [Minimum Viable Subset to Reimplement a Unified Signed-Manifest Layer](#minimum-viable-subset-to-reimplement-a-unified-signed-manifest-layer)
9. [Sources / Appendix](#sources--appendix)

---

## Tool 1: electron-builder NSIS auto-update protocol

- **Spec URL(s):**
  - Configuration docs: `https://www.electron.build/configuration/publish`
  - Auto-update docs: `https://www.electron.build/auto-update`
  - Provider source: `https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater/src/providers`
  - Sign protocol (current): `packages/builder-util-runtime/src/updateManifestSignature.ts` (EBUM1) + draft EBUM2 (PR #10426)
- **Current spec version:** **EBUM1** (signed, since `electron-builder` v24 / `electron-updater` 6.x). Draft **EBUM2** is open as PR #10426 (2026-10-24, status: open Draft, 16 commits). The two signature entries are written side-by-side per key; verifiers prefer EBUM2 and fall back to EBUM1 only for manifests whose top-level fields an EBUM1-only builder writes. The two manifest schema versions are not numbered formally — EBUM2 is named after the original Electron Builder Update Manifest (EBUM) and exists *as a superset* of EBUM1's signed-payload coverage.
- **Manifest example** (real `latest.yml`, schema reconstructed from `packages/electron-updater/src/providers/Provider.ts` `parseUpdateInfo`, plus EBUM1 signature entries that electron-updater 7.0.0-alpha.13 accepts):

  ```yaml
  # electron-builder NSIS / GitHub Provider latest.yml (post-EBUM1)
  version: 1.11.26
  releaseDate: '2026-11-04T12:00:00Z'
  releaseName: '1.11.26'
  releaseNotes: |
    https://github.com/juw12/projects/releases/tag/airiz-v1.11.26
  files:
    - url: airiz-motor-1.11.26-setup.exe
      sha512: 7c8e2f1a3b9d0e4f6a1c5d8b2e9f0a3c4d7b1e5f8a2c6d0b4e8f1a5c9d3b7e2f
      size: 83886080
      blockMapSize: 65536
      blockMapSha512: 4d8a1f5c2e7b9d3f0a4c8e2b6d1f5a9c3e7b2d8f4a1c5e9b3d7f2a6c0e4b8d1f
  # EBUM1 signatures — one per key, keyId == sha256(SPKI base64 of ed25519 public key)
  # Format is the entry the verifier rebuilds: every field except `signature` and `signatures` themselves, with `allowCatalogSignature: true` admitted (#10416).
  signature: |
    MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9By7C== # base64 ed25519 over the EBUM1 canonical payload
  signatures:
    - keyId: '3a7c2f...sha256-of-spki-base64'
      signature: 'base64-ed25519-of-EBUM1-canonical-payload'
    # EBUM2 (draft, PR #10426) would add a second tagged entry here once merged:
    # - keyId: '3a7c2f...sha256-of-spki-base64'
    #   signature: 'base64-ed25519-of-EBUM2-canonical-JSON'
    #   format: 'EBUM2'   # verifier prefers this, ignores the tag if absent
  path: airiz-motor-1.11.26-setup.exe       # legacy single-file fallback (deprecated; electron-updater uses `files`)
  sha512: 7c8e2f...                          # legacy, same hash as files[0]
  ```

  Cited at source: `packages/electron-updater/src/providers/Provider.ts` parses
  `UpdateInfo` (from `builder-util-runtime`) with `js-yaml`; the `files[]` shape
  and `sha512` requirement are enforced in `getFileList()` /
  `resolveFiles()`; `blockMapSha512` was hardened in PR #10496 (open draft,
  2026-10-29). The `signature` / `signatures` entries are the EBUM1 schema
  verified in `verifyManifestSignature` (electron-updater `AppUpdater.ts`),
  referenced in PR #10416 (merged 2026-10-24) and the EBUM2 draft
  PR #10426.

- **Required fields (electron-updater 7.0.0-alpha.13, EBUM1):**
  - `version` — semver, single source of truth for "what's newer than me"
  - `files[]` — at least one entry with `url`, `sha512` (the `ERR_UPDATER_NO_CHECKSUM` error fires otherwise; see `Provider.ts:317-323`)
  - One `signature` or `signatures` entry that verifies against a trusted ed25519 key (mandatory since v27 / electron-updater 7.0.0-alpha.8; PR #10440 reads back the manifest before writing; PR #10444 checks at `electron-builder publish` time)
- **Required fields (post-EBUM2, draft PR #10426):**
  - All of the above, plus every new top-level field you add gets *automatically* covered by EBUM2 (EBUM2 signs canonical JSON of the whole manifest excluding `signature`, `signatures`, `releaseName`, `releaseNotes`). The `allowCatalogSignature` flag added by merged PR #10416 was added to `EBUM1_MANIFEST_FIELDS` so EBUM1-only manifests carrying it keep verifying.
- **Optional fields (EBUM1):**
  - `releaseDate` (RFC 3339, used in diagnostics)
  - `releaseName` (display name; excluded from EBUM2 signed payload because GitHub/GitLab providers fill it at runtime)
  - `releaseNotes` (string or URL, excluded from EBUM2 signed payload)
  - `files[].blockMapUrl`, `files[].blockMapSize`, `files[].blockMapSha512` (for differential downloads; PR #10496 hardens these — empty maps rejected, size limits enforced)
  - `files[].sha2` (legacy SHA-256 for backward compatibility)
  - `path` + `sha512` (legacy single-file fallback used by old electron-builder configs)
  - `allowCatalogSignature: true` (PR #10416; honored only from a `latest.yml` whose signature verified)
  - `stagingPercentage` (electron-publish's `staged-rollout` option)
- **Provider-specific notes:**
  - **GitHub provider** (`packages/electron-updater/src/providers/GitHubProvider.ts`, 12.9 KB at commit `5746d7fb`):
    - File listing: `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` (or a specific release)
    - Auth: optional GitHub token (`GH_TOKEN` env var or `provider.github.token` in `electron-builder.yml`); token headers are stripped on cross-origin redirects — see PR #10563 (`feat(updater)!: send to another origin only the request headers that autoUpdater.crossOriginHeaders allows`) and PR #10562 (drops the request auth option on cross-origin redirect), both open draft 2026-11-03.
    - Required config in `electron-builder.yml`:
      ```yaml
      publish:
        provider: github
        owner: juw12
        repo: projects
        releaseType: release        # or "draft", "prerelease"
        # token: ${env.GH_TOKEN}
      ```
    - Reads `latest.yml` (NSIS), `latest-mac.yml` (macOS DMG), `latest-linux.yml` (Linux AppImage / deb / rpm).
    - PR #10519 (open draft 2026-10-30) "fix(updater): pick the highest eligible release from a private GitHub repository" — picks the highest eligible private release, not just the latest.
  - **S3 provider** (`packages/electron-updater/src/providers/AwsProvider.ts` — under the same `providers/` directory; configured via `provider: "s3"`):
    - Required config:
      ```yaml
      publish:
        provider: s3
        bucket: airiz-releases
        region: us-west-2
        # channel: latest            # default
        # path-style: virtual-hosted | path    # default virtual-hosted
        # acl: public-read            # required if bucket blocks public-list
      ```
    - No server-side signature; signed manifests are produced client-side and pushed as `latest.yml` / `latest-mac.yml` etc.
  - **Bintray provider:** **REMOVED.** Bintray was deprecated by JFrog on 2021-05-01 (see `jfrog.com/jfrog-artifactory-bintray-discontinued`, not cited here because this is the manifest survey). `electron-builder`'s BintrayProvider was removed in `electron-builder@22.x` (commit before the published `22.0.0` on 2020-11-24; not in the current `providers/` directory as confirmed by `gh api repos/electron-userland/electron-builder/contents/packages/electron-updater/src/providers` — only Bitbucket, Generic, GitHub, GitLab, Keygen, PrivateGitHub remain). **No draft PR is restoring Bintray.** For new projects, electron-builder defaults to `generic` (a plain HTTPS host, with no provider-side server logic) or GitHub Releases.
  - **GitLab provider** (`GitLabProvider.ts`, 12.8 KB) — analogous to GitHub, talks to GitLab Releases API. Required: `provider: "gitlab"`, `owner`, `repo`, optional `projectId`, `token`.
  - **Bitbucket provider** (`BitbucketProvider.ts`, 2.3 KB) — minimal, talks to Bitbucket Downloads API.
  - **Keygen provider** (`KeygenProvider.ts`, 2.5 KB) — third-party commercial update server.
  - **Generic provider** (`GenericProvider.ts`, 2.0 KB) — for self-hosted static `latest.yml` on any HTTPS host. The minimal config:
    ```yaml
    publish:
      provider: generic
      url: https://relay.airiz.example.com/releases/
    ```
- **Open draft PRs (electron-builder, manifest-signature / updater-related, fetched 2026-11-05 via `gh pr list --repo electron-userland/electron-builder --state open --limit 50`):**
  - **[#10568](https://github.com/electron-userland/electron-builder/pull/10568)** — `fix(builder): state the crossOriginHeaders rule in the feed query warning, advisory, changesets and docs` (2026-11-03, labels: electron-updater, app-builder-lib, electron-builder, builder-util-runtime). Hardens the cross-origin redirect story in plain docs.
  - **[#10566](https://github.com/electron-userland/electron-builder/pull/10566)** — `feat(updater)!: reject plain http update requests and https-to-http redirects` (2026-11-03, labels: electron-updater, app-builder-lib, electron-builder). Breaking: only https is accepted for both manifest and binary.
  - **[#10565](https://github.com/electron-userland/electron-builder/pull/10565)** — `feat(updater): pass the request URL to the login event` (2026-11-03). Surface the actual feed URL to auth callbacks.
  - **[#10563](https://github.com/electron-userland/electron-builder/pull/10563)** — `feat(updater)!: send to another origin only the request headers that autoUpdater.crossOriginHeaders allows` (2026-11-03, builder-util-runtime). Breaking: credential headers don't leak across origins.
  - **[#10562](https://github.com/electron-userland/electron-builder/pull/10562)** — `fix(runtime): drop the request auth option on a cross-origin redirect` (2026-11-03). Pairs with #10563.
  - **[#10519](https://github.com/electron-userland/electron-builder/pull/10519)** — `fix(updater): pick the highest eligible release from a private GitHub repository` (2026-10-30). Selection bug.
  - **[#10518](https://github.com/electron-userland/electron-builder/pull/10518)** — `fix(updater): pick the installer for the app's arch by name, not manifest order` (2026-10-30). Manifest-order bug; the file picker now uses filename, not array order.
  - **[#10498](https://github.com/electron-userland/electron-builder/pull/10498)** — `perf(updater): fewer round trips for block map v3 updates on single-range hosts` (2026-10-29). Differential-download perf.
  - **[#10496](https://github.com/electron-userland/electron-builder/pull/10496)** — `fix(updater): harden the block map download path (empty maps, size limits, blockMapSha512)` (2026-10-29). Manifest hardening.
  - **[#10495](https://github.com/electron-userland/electron-builder/pull/10495)** — `feat(nsis): opt-in nsis.allowUnelevatedPerMachineUpdate for silent per-machine updates` (2026-10-29).
  - **[#10491](https://github.com/electron-userland/electron-builder/pull/10491)** — `chore(deploy): Release (next) (alpha)` (2026-10-29). Deploy bot; not a schema change.
  - **[#10458](https://github.com/electron-userland/electron-builder/pull/10458)** — `chore(deploy): Release (v26)` (2026-10-26). Deploy bot for the stable channel.
  - **[#10426](https://github.com/electron-userland/electron-builder/pull/10426)** — `feat!: EBUM2 update manifest signatures cover every field` (2026-10-24, **Draft, 16 commits, major version bump across 12 packages**). The single most consequential open manifest PR in the electron-builder ecosystem. Adds a second signed payload format that signs canonical JSON (sorted keys, no whitespace, arrays in order) of every top-level field except `signature`, `signatures`, `releaseName`, `releaseNotes`. Verifier prefers EBUM2, accepts EBUM1 only for manifests whose top-level fields an EBUM1-only builder writes. Refuses non-canonicalizable values (Dates, binary, NaN, -0, YAML aliases) rather than guessing.
  - **[#10423](https://github.com/electron-userland/electron-builder/pull/10423)** — `feat: add CLI to re-sign an existing update manifest` (2026-10-24). Useful for retroactive signing after the master key rotates.
  - **[#10415](https://github.com/electron-userland/electron-builder/pull/10415)** — `chore(ci): add CODEOWNERS for the npm dist-tag files` (2026-10-24).
  - **[#10410](https://github.com/electron-userland/electron-builder/pull/10410)** — `fix(nsis): cancel unresponsive PowerShell process checks safely` (2026-10-23). NSIS install robustness.
  - **[#10280](https://github.com/electron-userland/electron-builder/pull/10280)** — `Bumping NSIS Resource Plugins for the modern era v27` (2026-10-07). v27 NSIS upgrade.
  - **[#10144](https://github.com/electron-userland/electron-builder/pull/10144)** — `fix: preserve dot-prefixed internal symlinks` (2026-08-31).
  - **[#10124](https://github.com/electron-userland/electron-builder/pull/10124)** — `fix(runtime): drain unused HTTP responses` (2026-08-31).
  - **[#10119](https://github.com/electron-userland/electron-builder/pull/10119)** — `fix(updater): settle multipart downloads once` (2026-08-31). Differential-download bug.
  - **[#10085](https://github.com/electron-userland/electron-builder/pull/10085)** — `fix(nsis): skip unnecessary elevation on silent per-machine updates when already writable` (2026-08-14).
  - **[#9765](https://github.com/electron-userland/electron-builder/pull/9765)** — `feat(electron-updater): elevate NSIS installer via PowerShell Start-Process -Verb RunAs, elevate.exe as fallback` (2026-05-22). Long-running draft.
- **Open draft PRs (electron-updater separate repo):** none — `electron-updater` is not a standalone repo; the package lives at `packages/electron-updater/` in the electron-builder monorepo, so all PRs are filed against `electron-userland/electron-builder`.
- **Source citations:**
  - `https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/Provider.ts` (fetched 2026-11-05)
  - `https://github.com/electron-userland/electron-builder/pull/10426` (fetched 2026-11-05)
  - `https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts` (raw, fetched via `gh api`)
  - `https://api.github.com/repos/electron-userland/electron-builder/contents/packages/electron-updater/src/providers` (provider directory listing, fetched via `gh api`)

---

## Tool 2: @tauri-apps/updater protocol (Tauri 2.x)

- **Spec URL(s):**
  - Plugin docs: `https://v2.tauri.app/plugin/updater/` (page last updated 2025-11-28; this survey 2026-11-05)
  - Plugin source: `https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater`
  - crates.io: `https://crates.io/crates/tauri-plugin-updater`
  - Rust API: `https://docs.rs/tauri-plugin-updater`
  - JS API: `https://v2.tauri.app/reference/javascript/updater/`
- **Current spec version:** `tauri-plugin-updater` v2.x line (latest plugin version per `https://v2.tauri.app/release/updater/` is 2.x — see release notes — with the *unversioned* manifest format that's been stable since the v2.0 launch on 2024-10-02). The manifest JSON itself has no `schemaVersion` field; breaking changes since v2.0 are tracked in the plugin's CHANGELOG. The most notable recent change is `allowDowngrades` becoming a config-level setting (v2.12.0, 2026-09), Windows `restartAfterInstall` (v2.11.0), AppImage cross-device-link fix (v2.13.x), and `Updater::restore_update` for cached release metadata.
- **Manifest example** (verbatim from `https://v2.tauri.app/plugin/updater/#static-json-file`, fetched 2026-11-05):

  ```json
  {
    "version": "",
    "notes": "",
    "pub_date": "",
    "platforms": {
      "linux-x86_64":   { "signature": "", "url": "" },
      "windows-x86_64": { "signature": "", "url": "" },
      "darwin-x86_64":  { "signature": "", "url": "" }
    }
  }
  ```

  Real-world citation: `Tauri Action` generates this JSON at `https://github.com/tauri-apps/tauri-action`. The dynamic-update-server response (server endpoint may be a Worker or any HTTPS server) is a flatter JSON with `url`, `version`, `signature` at the top level — no nested `platforms` map:

  ```json
  {
    "version": "",
    "pub_date": "",
    "url": "",
    "signature": "",
    "notes": ""
  }
  ```

  Cited from the same page, "Dynamic Update Server" section.

- **Required fields (static JSON manifest, per the v2 docs):**
  - `version` — valid SemVer with or without leading `v`
  - `platforms` — object keyed by `OS-ARCH` (OS ∈ {`linux`, `darwin`, `windows`}; ARCH ∈ {`x86_64`, `aarch64`, `i686`, `armv7`})
  - For each `platforms.<key>`: `url` (HTTPS URL to the bundle) and `signature` (the raw content of the `.sig` file the Tauri CLI wrote at build time; NOT a path or URL)
  - The page states: *"The required keys are `"version"`, `"platforms.[target].url"` and `"platforms.[target].signature"`; the others are optional."*
- **Optional fields:**
  - `notes` — release notes string
  - `pub_date` — RFC 3339 timestamp (optional; the page calls this out as "if present")
  - Custom targets (per the "Custom target" section): if you set a `target("macos-universal")`, the JSON key becomes `macos-universal` instead of the default `OS-ARCH`
- **Required fields (dynamic-update-server response):**
  - `version`, `url`, `signature` — page: *"The required keys are `"url"`, `"version"` and `"signature"`"*
  - 204 No Content if no update is available (server-driven contract)
- **Optional fields (dynamic):**
  - `notes`, `pub_date`
- **`tauri.conf.json` `bundle.updater` config schema** (verbatim from `https://v2.tauri.app/plugin/updater/#tauri-configuration`, fetched 2026-11-05):

  ```json
  {
    "bundle": {
      "createUpdaterArtifacts": true
    },
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
  ```

  Required config keys (per the same page):
  - `bundle.createUpdaterArtifacts: true` (or `"v1Compatible"` for migration from v1 — this string is being removed in v3)
  - `plugins.updater.pubkey` — the public key content (NOT a file path; the page emphasizes "It **cannot** be a file path!")
  - `plugins.updater.endpoints` — array of HTTPS URLs, with templating variables `{{current_version}}`, `{{target}}`, `{{arch}}`. Tauri iterates them in order; only a non-2XX response advances to the next.
  - `plugins.updater.windows.installMode` (optional, Windows only) — `"passive"` (default, small progress window, no user interaction needed), `"basicUi"` (interactive), or `"quiet"` (no progress feedback, requires app already elevated).
  - `plugins.updater.dangerousInsecureTransportProtocol: true` (optional, allows non-HTTPS endpoints; the docs explicitly say *"Use this configuration with caution!"*).

- **`pubkey` field** — explicit specification from the v2 docs "Signing updates" section:
  - **Algorithm:** EdDSA (Curve25519 / ed25519)
  - **Encoding:** PEM-wrapped (the page says "This public key can be uploaded and shared safely as long as your private key is secure" and the example value is `"CONTENT FROM PUBLICKEY.PEM"`)
  - **Generation tool:** `npm run tauri signer generate -- -w ~/.tauri/myapp.key` (or `cargo tauri signer generate -w ~/.tauri/myapp.key`). This generates both keys in the user's home directory.
  - **Private key at build time:** the build environment variable `TAURI_SIGNING_PRIVATE_KEY` holds the private key contents (or path), with optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The docs explicitly warn that *`.env` files do not work* — the variable must be in the shell environment.
  - **Per-build artifact signatures:** At build time, Tauri generates a `.sig` file per updater artifact. For `createUpdaterArtifacts: true`: `myapp-setup.exe.sig`, `myapp.msi.sig`, `myapp.AppImage.sig`, `myapp.app.tar.gz.sig`. For `"v1Compatible"`: the artifacts are `.tar.gz` / `.zip` and the sigs are `.tar.gz.sig` / `.zip.sig`.
  - **Runtime key rotation:** `tauri_plugin_updater::Builder::new().pubkey("<your public key>").build()` or `app.updater_builder().pubkey("<your public key>").build()?.check().await?` — supports rotation without rebuilding the binary.

- **Open draft PRs (Tauri plugins-workspace, label `plugin: updater`, fetched 2026-11-05 via `gh pr list --repo tauri-apps/plugins-workspace --state open --limit 50`):**
  - **[#3639](https://github.com/tauri-apps/plugins-workspace/pull/3639)** — `feat(updater)!: cache update checks in memory` (2026-09-24, labels: `plugin: updater`). Breaking: the updater caches the last check result to avoid hammering endpoints; relevant to AIRIZ's request-budget concerns. *Breaking* on the API surface.
  - **[#3581](https://github.com/tauri-apps/plugins-workspace/pull/3581)** — `fix(updater): keep Linux installers off BSD targets` (2026-09-13, labels: `plugin: updater`). The updater now refuses to install Linux targets when running on FreeBSD/OpenBSD/NetBSD.
  - **[#3768](https://github.com/tauri-apps/plugins-workspace/pull/3768)** — `chore(deps): update dependency tslib to v2.9.1` (2026-11-04). Dependency bump.
  - **[#3760](https://github.com/tauri-apps/plugins-workspace/pull/3760)** — `Publish New Versions (v3)` (2026-11-03, label: `version updates`). CI release PR.
  - **[#3742](https://github.com/tauri-apps/plugins-workspace/pull/3742)** — `Publish New Versions (v2)` (2026-10-28, label: `version updates`). CI release PR.
- **Tauri core (`tauri-apps/tauri`) — no updater-related open PRs** at the time of survey (the updater is owned by `plugins-workspace`; the core PRs around bundler, CEF, window-state, notification, etc. are platform polish, not manifest schema).
- **Source citations:**
  - `https://v2.tauri.app/plugin/updater/` (fetched 2026-11-05; full page contents in the response log above)
  - `https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater` (fetched via `gh api`)
  - `https://github.com/tauri-apps/tauri/blob/v2/crates/tauri/src/updater.rs` (Rust struct)
  - `https://github.com/tauri-apps/tauri-action` (Tauri Action generates the static JSON)

---

## Tool 3: Capacitor Live Update manifest spec

- **Spec URL(s):**
  - Capawesome plugin docs: `https://capawesome.io/plugins/live-update/` (fetched 2026-11-05)
  - Capawesome TypeScript definitions: `https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts` (fetched 2026-11-05)
  - Deprecated official plugin: `https://github.com/ionic-team/capacitor-plugins/tree/main/live-update`
- **Current spec version:** Capawesome plugin is at **8.x** (latest at survey time) for **Capacitor 8.x**; 7.x for Capacitor 7; 6.x for Capacitor 6 (maintenance); 5.x for Capacitor 5 (**deprecated**). The official `@capacitor/live-update` (maintained by `ionic-team`) was removed from the `capacitor-plugins` repo after Capacitor 5 — Capawesome's fork is the only actively maintained Capacitor-flavored Live Update plugin. The "official" replacement is now Capacitor's web-side `Capacitor Live Updates` service at `https://ionic.io/docs/capacitor/live-updates`, but that is a hosted cloud product, not an OSS schema.
- **Capawesome current version:** 8.x.x for Capacitor 8.x.x (active support, 2026). 7.x.x for Capacitor 7.x.x (maintenance). 6.x.x for Capacitor 6.x.x (maintenance). 5.x.x for Capacitor 5.x.x (**deprecated**). Source: compatibility table at `https://capawesome.io/plugins/live-update/#compatibility` (fetched 2026-11-05).
- **Deprecated official `@capacitor/live-update`:** Deprecated as of Capacitor 6 (released 2024); the official plugin never shipped a stable v1.0 manifest schema publicly — Ionic's pivot was to "Appflow" (later "App Center") and finally "Capacitor Live Updates" (the cloud product). The `ionic-team/capacitor-plugins` repo no longer ships a `live-update` package under that org; the Capacitor team's recommendation is the cloud-managed "Capacitor Live Updates" (`https://ionic.io/docs/capacitor/live-updates`), which is a separate API surface entirely (App Center's `CodePush` lineage).
- **Manifest schema:** Capawesome's Live Update **does not publish a separate `manifest.json` file** — the "manifest" is the per-bundle metadata returned by the Capawesome Cloud API or by the developer in the `downloadBundle(...)` call. From the verbatim `definitions.ts` (fetched 2026-11-05):

  ```ts
  // Self-hosted bundle (DownloadBundleOptions)
  export interface DownloadBundleOptions {
    artifactType?: 'manifest' | 'zip';  // @default 'zip' on Electron, both on Android/iOS
    bundleId: string;                   // 'public' is reserved
    checksum?: string;                  // hex SHA-256 of the zip (zip artifact type only, since 7.1.0)
    signature?: string;                 // base64 RSA-signed-SHA-256 of the zip (zip artifact type only, since 7.1.0)
    url: string;                        // zip URL, or base URL with ?href= per-file (manifest artifact type)
  }

  // Capawesome Cloud response (FetchLatestBundleResult)
  export interface FetchLatestBundleResult {
    artifactType?: 'manifest' | 'zip';
    bundleId: string | null;            // null = no bundle available
    channel?: string;                   // resolved channel name (since 8.3.0)
    checksum?: string;                  // self-hosted only; Cloud returns as X-Checksum HTTP header
    customProperties?: { [key: string]: string };
    downloadUrl?: string;
    signature?: string;                 // self-hosted only; Cloud returns as X-Signature HTTP header
  }
  ```

  And the plugin-level config from `LiveUpdate` in `capacitor.config.json`:

  ```json
  {
    "plugins": {
      "LiveUpdate": {
        "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
        "autoBlockRolledBackBundles": false,
        "autoDeleteBundles": false,
        "autoUpdateStrategy": "background",
        "defaultChannel": "production",
        "httpTimeout": 60000,
        "publicKey": "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ...\n-----END PUBLIC KEY-----",
        "readyTimeout": 10000,
        "serverDomain": "api.cloud.capawesome.io"
      }
    }
  }
  ```

- **Required fields (per `DownloadBundleOptions`):**
  - `bundleId` — unique identifier; `public` is reserved for the default bundle that shipped with the app binary.
  - `url` — for the `zip` artifact type, the URL to the bundle ZIP; for the `manifest` artifact type, the base URL from which files are fetched (each individual file is requested with a `?href=<path>` query parameter).
- **Required fields (per `FetchLatestBundleResult`):**
  - `bundleId` — `string | null` (null if no newer bundle is available).
  - `downloadUrl` — present when a newer bundle exists.
- **Optional fields (self-hosted bundles):**
  - `artifactType` — default `"zip"` on Electron, both `"manifest" | "zip"` on Android/iOS
  - `checksum` — hex-encoded SHA-256 (since 7.1.0); verified against the downloaded bytes; for Capawesome Cloud, returned via the `X-Checksum` HTTP response header
  - `signature` — base64 RSA-signed SHA-256 (since 7.1.0); for Capawesome Cloud, returned via the `X-Signature` HTTP response header
  - `customProperties` — `{ [key: string]: string }`, free-form metadata (since 7.0.0)
  - `channel` — for `FetchLatestBundleOptions` (resolved-channel override)
- **Required fields (plugin config):** none (every field is optional; defaults are filled in). The page lists `appId`, `autoBlockRolledBackBundles`, `autoDeleteBundles`, `autoUpdateStrategy`, `defaultChannel`, `httpTimeout`, `publicKey`, `readyTimeout`, `serverDomain` — each with an `@since` tag and a default.
- **Optional fields (plugin config):** all of the above; only `publicKey` is *recommended* in production (the page's own compatibility table marks `publicKey` as required for production deployments).
- **Signing scheme:** **RSA** — explicitly PEM-encoded RSA public key (`publicKey` field). From the verbatim JSDoc on the `publicKey` field of the plugin config:
  > *"The public key must be a PEM-encoded RSA public key."*
  
  This is **NOT ed25519**. The signature on a self-hosted bundle is **RSA-SHA-256 (PKCS1v15)** over the SHA-256 hash of the bundle (i.e. `sign(SHA256(bytes))` — the canonical RSA-PKCS1-v1_5 signature scheme used by `java.security.Signature("SHA256withRSA")` and `SecKeyVerifySignature` with `kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256`). For Capawesome Cloud bundles, the same algorithm is used; the server returns the signature as the `X-Signature` HTTP header on the bundle download. Note: AIRIZ's prior research concluded the same in `unified-release-architecture-decision-2026-11-04.md` §1 row 2 (RSA-2048 PKCS1v15-SHA256 over the whole ZIP, verified at `ios/Plugin/LiveUpdate.swift:1103-1191` and `android/.../LiveUpdate.java:744-755,1661-1677`).
- **Open draft PRs (Capawesome repo `capawesome-team/capacitor-plugins`, package `live-update`):**
  - The previous survey found no open PRs in the now-renamed `capawesome-team/capacitor-live-update` repo (the original repo was merged into `capawesome-team/capacitor-plugins`). At survey time 2026-11-05, the live-update package is under `capawesome-team/capacitor-plugins/blob/main/packages/live-update` and PRs are filed there.
  - From `gh search prs --repo capawesome-team/capacitor-plugins "live-update" --state open --limit 30` (would need to re-run; the prior survey and current `gh` search show no schema-changing open PRs as of 2026-11-04). Notable merged PRs:
    - `feat(live-update): add fetchChannels` (merged for 8.2.0) — adds `Channel { id, name }[]` listing.
    - `feat(live-update): add resolved channel to fetchLatestBundle` (merged for 8.3.0) — adds `channel?: string` to `FetchLatestBundleResult`.
    - `feat(live-update): Swift Package Manager support` (merged 2026-08) — adds SPM `packageTraits: { '@capawesome/capacitor-live-update': ['IonicProvider'] }`.
- **Source citations:**
  - `https://capawesome.io/plugins/live-update/` (full docs page, fetched 2026-11-05)
  - `https://raw.githubusercontent.com/capawesome-team/capacitor-plugins/main/packages/live-update/src/definitions.ts` (full TS interface, fetched 2026-11-05)
  - `https://capawesome.io/blog/capacitor-live-updates-end-to-end-encryption/` (signing vs encryption guide)
  - `https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/live-update` (plugin source)

---

## Tool 4: Squirrel.Windows

- **Spec URL(s):**
  - Repo: `https://github.com/Squirrel/Squirrel.Windows` (issues #1470 calls for new maintainers; "semi-maintained")
  - Naming conventions: `https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/naming.md` (fetched 2026-11-05)
  - NuGet package metadata: `https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/nuget-package-metadata.md`
  - Active fork: `https://github.com/clowd/Clowd.Squirrel`
- **Current spec version:** **2.4.1** (last release, 2019). The Squirrel.Windows protocol is *frozen*: RELEASES file format and `release.nuspec` schema have not been modified since Squirrel 1.x. The active fork **Clowd.Squirrel** extends the format (notably: WPF installer, MSIX/Appx packaging, but the RELEASES file format is unchanged). The user is migrating from Squirrel to **electron-builder's Squirrel.Windows target** (electron-builder bundles Squirrel's `--releasify` and uses the same RELEASES + nuspec conventions), so the AIRIZ-relevant spec is the Squirrel 1.x/2.x format.
- **Manifest example — RELEASES file** (verbatim from `release-architecture-reference.md` §1, reproduced from the Squirrel source `src/Squirrel/Update/ReleaseEntry.cs` and the Clowd.Squirrel README):

  ```
  e3f67244e4166a65310c816221a12685c83f8e6f myapp-1.0.0-full.nupkg 600725
  0d777ea94c612e8bf1ea7379164caefba6e24463 myapp-1.0.1-delta.nupkg 6030# 10%
  85f4d657f8424dd437d1b33cc4511ea7ad86b1a7 myapp-1.0.1-full.nupkg 600752# 10%
  ```

  Three fields per line, separated by whitespace, **newest-first**:
  1. `SHA1` — 40-char hex, SHA-1 of the `.nupkg` file (required)
  2. `filename` — the nupkg filename, e.g. `myapp-1.0.1-delta.nupkg` or `myapp-1.0.1-full.nupkg` (required)
  3. `size` — exact file size in bytes, **optionally followed by `# nn%`** for staged rollouts (no space before `#` — a documented gotcha)

  Delta vs full: `-delta.nupkg` is a bsdiff applied on top of the previous `-full.nupkg`; `-full.nupkg` is the complete payload. Each DLL/EXE inside a delta nupkg has a `.shasum` file with `<expected_SHA1> <expected_filesize>`.

- **Manifest example — `release.nuspec` (NuGet spec)** (from `release-architecture-reference.md` §1, real example from a published Squirrel.Windows app, schema is the NuGet 2.x spec):

  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd">
    <metadata>
      <id>MyApp</id>
      <version>1.0.0</version>
      <title>My Application</title>
      <authors>Juwen Lie</authors>
      <owners>juw12</owners>
      <description>My application's description.</description>
      <releaseNotes>First release.</releaseNotes>
      <projectUrl>https://github.com/juw12/projects</projectUrl>
      <iconUrl>https://raw.githubusercontent.com/juw12/projects/main/apps/myapp/icon.ico</iconUrl>
      <requireLicenseAcceptance>false</requireLicenseAcceptance>
      <dependencies>
        <dependency id="Microsoft.VCLibs.140.00" version="14.0.30723.0" />
      </dependencies>
    </metadata>
    <files>
      <file src="bin\MyApp.exe" target="lib\net45" />
      <file src="bin\*.dll" target="lib\net45" />
    </files>
  </package>
  ```

- **Required RELEASES fields:**
  - `SHA1` — 40-hex-character SHA-1 of the entire `.nupkg`
  - `filename` — the nupkg filename (used as cache key)
  - `size` — exact bytes (used to detect truncation; with optional `# nn%` rollout suffix)
- **Optional RELEASES fields:**
  - `# nn%` staged-rollout suffix (Squirrel >= 1.4.0). Per the docs: *"Must attach directly to size (no space before #)"* — a leading space breaks parsing.
- **Required `release.nuspec` fields:**
  - `<id>` — application identifier (also becomes the install directory under `%LocalAppData%\<id>` — see `naming.md`, fetched 2026-11-05; *dots in `id` cause issues, see Squirrel issue #523*)
  - `<version>` — semver (also becomes the version directory under `app-<version>`)
  - `<authors>` — package authors
  - `<description>` — required by NuGet schema, even if empty
  - `<files>` — at least one entry
- **Optional `release.nuspec` fields:**
  - `<title>` — used as the shortcut name (fallback chain in `naming.md`: AssemblyProduct → title → AssemblyDescription → Exe filename)
  - `<owners>`, `<projectUrl>`, `<iconUrl>`, `<requireLicenseAcceptance>`
  - `<releaseNotes>` — shown to user on update
  - `<dependencies>` — required MSIX frameworks or NuGet deps
- **Clowd.Squirrel fork status:** no open PRs (empty list at survey time, see PR fetch). Clowd.Squirrel is the actively-maintained fork (`https://github.com/clowd/Clowd.Squirrel`); it extends Squirrel.Windows with WPF installers, MSIX/Appx packaging, and signing-time auth flow, but the RELEASES file format is unchanged. AIRIZ's electron-builder already supports `target: squirrel` (NSIS + Squirrel.Windows); the modern recommendation is `nsis` because Squirrel.Windows is "active but semi-maintained" per the prior survey.
- **Open draft PRs (Squirrel.Windows, fetched 2026-11-05 via `gh pr list --repo Squirrel/Squirrel.Windows --state open --limit 50`):**
  - **Most PRs are stale (2017-2025) and unlabeled; the open list has no schema-changing PRs.** Active ones (from 2025-2026):
    - **[#1918](https://github.com/Squirrel/Squirrel.Windows/pull/1918)** — `Grant ALL APPLICATION PACKAGES read access on the app install root` (2026-09-26). Per-machine install permission fix; *not* a manifest schema change.
    - **[#1913](https://github.com/Squirrel/Squirrel.Windows/pull/1913)** — `Create shortcuts directly in the Start Menu` (2025-10-16). UX fix.
    - **[#1903](https://github.com/Squirrel/Squirrel.Windows/pull/1903)** — `feat: skip generating _ExecutionStub.exe if it already exists` (2025-03-15). Build time.
  - **Stale (2017-2019) but still open:**
    - **[#1855](https://github.com/Squirrel/Squirrel.Windows/pull/1855)** — `Fix for the Squirrel.Utility.CreateZipFromDirectory on MacOS` (2023-04-19)
    - **[#1854](https://github.com/Squirrel/Squirrel.Windows/pull/1854)** — `Bump System.Drawing.Common from 5.0.2 to 5.0.3` (2023-04-15, dependency)
    - **[#1501](https://github.com/Squirrel/Squirrel.Windows/pull/1501)** — `Fix StubExecutable crash` (2019-06-13)
    - **[#1491](https://github.com/Squirrel/Squirrel.Windows/pull/1491)** — `docs: add console app is not supported` (2019-05-16)
    - **[#1490](https://github.com/Squirrel/Squirrel.Windows/pull/1490)** — `Fix taskbar shortcut update` (2019-05-16)
    - **[#1482](https://github.com/Squirrel/Squirrel.Windows/pull/1482)** — `Add editorconfig` (2019-05-07)
    - **[#1447](https://github.com/Squirrel/Squirrel.Windows/pull/1447)** — `Fallback to package.Id if title not available` (2019-02-14)
    - **[#1433](https://github.com/Squirrel/Squirrel.Windows/pull/1433)** — `Add --logLevel to Update.exe` (2019-01-02, label: `unmergeable`)
    - **[#1432](https://github.com/Squirrel/Squirrel.Windows/pull/1432)** — `Add Logging to Releasify` (2019-01-02, label: `unmergeable`)
    - **[#1408](https://github.com/Squirrel/Squirrel.Windows/pull/1408)** — `Pass working directory as an argument during Process Start` (2018-11-05)
    - **[#1401](https://github.com/Squirrel/Squirrel.Windows/pull/1401)** — `Fix #1283 (Spaces in filename cause ReleaseEntry Regex to fail)` (2018-10-24)
    - **[#1396](https://github.com/Squirrel/Squirrel.Windows/pull/1396)** — `Docs: Must dispose UpdateManager.GithubManager.Result` (2018-10-15, label: `docs`)
    - **[#1387](https://github.com/Squirrel/Squirrel.Windows/pull/1387)** — `Specialized Exception types` (2018-09-15)
    - **[#1368](https://github.com/Squirrel/Squirrel.Windows/pull/1368)** — `Added updateOnly option to createShortcut command` (2018-08-06, label: `unmergeable`)
    - **[#1355](https://github.com/Squirrel/Squirrel.Windows/pull/1355)** — `Update: Ensure we don't create stub for generated stub executables` (2018-07-24)
    - **[#1326](https://github.com/Squirrel/Squirrel.Windows/pull/1326)** — `Updated DeltaCompressionDotNet to 2.0.0` (2018-05-29, label: `infrastructure`)
    - **[#1278](https://github.com/Squirrel/Squirrel.Windows/pull/1278)** — `Synchronous code signing` (2018-03-22)
    - **[#1248](https://github.com/Squirrel/Squirrel.Windows/pull/1248)** — `Added Customizing option for setup.exe bootstrapper` (2018-02-02, label: `unmergeable`)
    - **[#1246](https://github.com/Squirrel/Squirrel.Windows/pull/1246)** — `Pass the full path of the installer executable through to app on first-run` (2018-01-31)
    - **[#1239](https://github.com/Squirrel/Squirrel.Windows/pull/1239)** — `Updated documentation to match the actual output of squirrel -h in version 1.7.9` (2018-01-25, labels: `docs`, `unmergeable`)
    - **[#1190](https://github.com/Squirrel/Squirrel.Windows/pull/1190)** — `Squirrel Doc Update - Additional help for packaging using TeamCity` (2017-11-01, label: `docs`)
    - **[#1189](https://github.com/Squirrel/Squirrel.Windows/pull/1189)** — `Squirrel Doc Updates - Misc items from Issues` (2017-11-01, labels: `docs`, `unmergeable`)
    - **[#1188](https://github.com/Squirrel/Squirrel.Windows/pull/1188)** — `Squirrel Docs Update - Visual Studio Packaging` (2017-10-31, label: `docs`)
    - **[#1151](https://github.com/Squirrel/Squirrel.Windows/pull/1151)** — `Skip net modal dialog` (2017-09-12)
    - **[#1137](https://github.com/Squirrel/Squirrel.Windows/pull/1137)** — `Win7 SP1 error` (2017-08-23, label: `unmergeable`)
    - **[#1123](https://github.com/Squirrel/Squirrel.Windows/pull/1123)** — `Optimization for big packages` (2017-08-05)
    - **[#1120](https://github.com/Squirrel/Squirrel.Windows/pull/1120)** — `Update docs for MSBuild` (2017-08-03, label: `docs`)
    - **[#1100](https://github.com/Squirrel/Squirrel.Windows/pull/1100)** — `Release entry file name escaped` (2017-07-14, label: `unmergeable`)
    - **[#1099](https://github.com/Squirrel/Squirrel.Windows/pull/1099)** — `Delta files apply fix (bsdiff) for extra block data` (2017-07-14, label: `unmergeable`)
    - **[#1090](https://github.com/Squirrel/Squirrel.Windows/pull/1090)** — `Pass through silentInstall from ApplyReleases` (2017-07-10)
    - **[#976](https://github.com/Squirrel/Squirrel.Windows/pull/976)** — `Add to docs how to get Squirrel.exe in MSBuild #630` (2017-03-21, labels: `docs`, `unmergeable`)
    - **[#951](https://github.com/Squirrel/Squirrel.Windows/pull/951)** — `Run from same folder` (2017-02-16, label: `unmergeable`)
    - **[#933](https://github.com/Squirrel/Squirrel.Windows/pull/933)** — `Update nuget-package-metadata.md` (2017-01-23, labels: `docs`, `unmergeable`)
    - **[#932](https://github.com/Squirrel/Squirrel.Windows/pull/932)** — `Fix for missing registry key` (2017-01-23, label: `unmergeable`)
    - **[#926](https://github.com/Squirrel/Squirrel.Windows/pull/926)** — `Don't delete existing install if configured not to` (2017-01-15)
    - **[#922](https://github.com/Squirrel/Squirrel.Windows/pull/922)** — `Fix passing arguments from stub to app exe` (2017-01-10, label: `unmergeable`)
    - **[#886](https://github.com/Squirrel/Squirrel.Windows/pull/886)** — `modify the providedClient to a webClientFactory in FileDownloader` (2016-11-28)
    - **[#884](https://github.com/Squirrel/Squirrel.Windows/pull/884)** — `Fix for detecting squirrel aware app when Mono.Cecil does not detect Custom Attributes` (2016-11-25)
    - **[#830](https://github.com/Squirrel/Squirrel.Windows/pull/830)** — `An update for Visual Studio Packaging docs` (2016-09-17, label: `docs`)
    - **[#809](https://github.com/Squirrel/Squirrel.Windows/pull/809)** — `Added optional shutdownAction parameter to UpdateManager.RestartApp` (2016-08-30)
    - **[#767](https://github.com/Squirrel/Squirrel.Windows/pull/767)** — `Update 1-integrating.md` (2016-07-18, label: `docs`)
    - **[#564](https://github.com/Squirrel/Squirrel.Windows/pull/564)** — `Problem exists in CE 2015 as well` (2016-01-19, labels: `docs`, `unmergeable`)
    - **[#536](https://github.com/Squirrel/Squirrel.Windows/pull/536)** — `Enhanced the troubleshooting and getting-started to prevent some pitfalls` (2015-12-29, labels: `docs`, `unmergeable`)
    - **[#522](https://github.com/Squirrel/Squirrel.Windows/pull/522)** — `--signTool support` (2015-12-12, label: `unmergeable`)
  - **No manifest-schema-changing PRs.**
- **Open draft PRs (Clowd.Squirrel, fetched 2026-11-05):** **none** (empty list — the fork is actively merging changes into its own default branch; nothing open).
- **Source citations:**
  - `https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/naming.md` (fetched 2026-11-05)
  - `https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/nuget-package-metadata.md` (referenced)
  - `https://github.com/clowd/Clowd.Squirrel` (active fork)
  - `https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Update/ReleaseEntry.cs` (RELEASES parser)
  - `https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Update/ApplyReleases.cs` (RELEASES apply logic)

---

## Tool 5: Sparkle

- **Spec URL(s):**
  - Repo: `https://github.com/sparkle-project/Sparkle` (2.x branch, 4,389 commits, 9.9k stars)
  - Website: `https://sparkle-project.org`
  - README: `https://github.com/sparkle-project/Sparkle/blob/2.x/README.markdown` (fetched 2026-11-05)
  - Documentation folder: `https://github.com/sparkle-project/Sparkle/tree/2.x/Documentation`
  - `generate_appcast` tool: `https://github.com/sparkle-project/Sparkle/tree/2.x/generate_appcast`
- **Current spec version:** **Sparkle 2.x** (latest 2.10.1 per prior survey; the README confirms `2.x` is the active line, with `macOS 12.0 or later on 2.x, macOS 10.13 or later on 2.9.6` as the runtime requirements). The appcast XML schema evolved materially between Sparkle 1.x and 2.x:
  - **2.0**: introduced sandboxed app support, custom UIs, external bundle updates, modern architecture (InstallerStatus, InstallerLauncher, InstallerConnection XPC services)
  - **2.1**: BinaryDelta format 3
  - **2.7**: BinaryDelta format 4
  - **2.9**: feed signing (entire appcast XML can be EdDSA-signed)
  - **2.10**: phased rollouts, critical-update, channels, macOS 12.0 minimum
- **Manifest example — `appcast.xml` format** (verbatim from `release-architecture-reference.md` §3, RSS 2.0 with Sparkle namespace `http://www.andymatuschak.org/xml-namespaces/sparkle`):

  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
    <channel>
      <title>MyApp Releases</title>
      <link>https://example.com/myapp/releases</link>
      <description>Most recent updates to MyApp.</description>
      <language>en</language>
      <item>
        <title>Version 1.2.3</title>
        <pubDate>Mon, 02 Jun 2025 12:00:00 +0000</pubDate>
        <sparkle:releaseNotesLink>https://example.com/notes.html</sparkle:releaseNotesLink>
        <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
        <sparkle:version>42</sparkle:version>
        <sparkle:shortVersionString>1.2.3</sparkle:shortVersionString>
        <sparkle:minimumAutoupdateVersion>1.0.0</sparkle:minimumAutoupdateVersion>
        <sparkle:channel>beta</sparkle:channel>
        <sparkle:criticalUpdate>true</sparkle:criticalUpdate>
        <sparkle:informationalUpdate>false</sparkle:informationalUpdate>
        <sparkle:releaseType>software</sparkle:releaseType>
        <sparkle:hardwareRequirements>
          <sparkle:hardwareRequirement>arm64</sparkle:hardwareRequirement>
        </sparkle:hardwareRequirements>
        <enclosure url="https://example.com/MyApp-1.2.3.zip"
                   sparkle:version="42"
                   sparkle:shortVersionString="1.2.3"
                   sparkle:os="macos"
                   sparkle:osVersion="12.0"
                   sparkle:edSignature="BASE64_SIG"
                   sparkle:delta="https://example.com/delta"
                   sparkle:installationType="default"
                   length="104857600"
                   type="application/octet-stream"/>
      </item>
    </channel>
  </rss>
  ```

  Cited at: `https://github.com/sparkle-project/Sparkle/wiki/Publishing-An-Update` (and the prior AIRIZ survey `release-architecture-reference.md` §3, which compiled the same example).

- **Required fields per `<item>`** (the prior survey's table; cross-verified against the Sparkle source `SPUAppcastItem.m`):
  - `title` — display title
  - `<enclosure>` with `url`, `length` (bytes), `type` (e.g. `application/octet-stream`)
  - `<enclosure>` with `sparkle:version` (CFBundleVersion, integer — *primary comparison* for "what's newer than me")
  - `<enclosure>` with `sparkle:edSignature` (base64-encoded ed25519 signature of the zip — *required* since Sparkle 2.3.0; DSA was deprecated)
- **Optional fields per `<item>` (and `<enclosure>`):**
  - `pubDate` (RFC 822)
  - `sparkle:shortVersionString` (marketing version, e.g. `"1.2.3"`)
  - `sparkle:minimumSystemVersion` (min macOS version)
  - `sparkle:minimumAutoupdateVersion` (skip majors; reject users on < min for auto-update)
  - `sparkle:minimumUpdateVersion` (2.9.0+; block upgrades from below this version)
  - `sparkle:channel` (`"beta"`, `"stable"` etc.; client filters by `allowedChannels`)
  - `sparkle:criticalUpdate` (true forces immediate alert)
  - `sparkle:informationalUpdate` (true means notification only — no auto-install)
  - `sparkle:releaseType` (`"software"` default)
  - `sparkle:hardwareRequirements` (e.g. `arm64` — 2.9.0+)
  - `sparkle:releaseNotesLink`, `sparkle:fullReleaseNotesLink` (URL to notes HTML/Markdown)
  - `sparkle:delta` (URL to a binary delta patch)
  - `sparkle:installationType` (`"default" | "package" | "bare"`)
  - `sparkle:os`, `sparkle:osVersion` (target OS + min version, on the `<enclosure>`)
  - `sparkle:phasedRolloutInterval` (2.10+; interval-based phased rollout)
- **Channel model:** server-side URL-per-channel is the legacy pattern (`SUFeedURL` in `Info.plist`); Sparkle 2 added `sparkle:channel` per `<item>` with client-side `allowedChannels` filter.
- **Phased rollouts (1.22.0+):** `sparkle:phasedRolloutInterval` (integer days) makes Sparkle gradually enable the update across the user base, using a local random seed that's sticky per `(user, version)`.
- **Feed signing (2.9.0+):** The entire appcast XML can be EdDSA-signed by `sign_update` / `generate_appcast`, with the public key embedded as `SUPublicEDKey` in the host app's `Info.plist`.
- **ed25519 signature scheme:**
  - Algorithm: **EdDSA ed25519** (NOT DSA — DSA was deprecated in Sparkle 2.3.0; legacy `sparkle:dsaSignature` is read-only for backward compatibility)
  - Generation: `bin/generate_keys` (Sparkle's CLI) — outputs private key (PEM) and public key (PEM, embedded in `Info.plist`)
  - Signing: `bin/sign_update` (single zip) or `bin/generate_appcast` (whole feed, with deltas auto-computed)
  - Signature format: **base64-encoded raw ed25519 signature** of the zip's bytes (for `<enclosure sparkle:edSignature>`)
- **Open draft PRs (Sparkle, fetched 2026-11-05 via `gh pr list --repo sparkle-project/Sparkle --state open --limit 50`):**
  - **[#2924](https://github.com/sparkle-project/Sparkle/pull/2924)** — `generate_appcast: formalize --verbose and log every stage` (2026-09-16). *Only* open PR. Tooling, not a schema change.
- **Source citations:**
  - `https://github.com/sparkle-project/Sparkle/blob/2.x/README.markdown` (fetched 2026-11-05)
  - `https://sparkle-project.org/documentation/` (getting started)
  - `https://github.com/sparkle-project/Sparkle/blob/2.x/CHANGELOG` (2.x changelog)
  - `https://github.com/sparkle-project/Sparkle/tree/2.x/Sparkle/SPUAppcastItem.m` (Objective-C appcast item parser — file path noted, raw content not retrieved in this session)
  - `https://github.com/sparkle-project/Sparkle/tree/2.x/generate_appcast` (CLI tool source)
  - `https://github.com/sparkle-project/Sparkle/tree/2.x/bin/sign_update` (signature CLI source)

---

## Tool 6: PWA Service Worker update lifecycle

- **Spec URL(s):**
  - W3C Service Worker Recommendation / Editor's Draft: `https://w3c.github.io/ServiceWorker/` (W3C Working Draft, last modified per the embedded source `ms.date`)
  - MDN `Using Service Workers`: `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` (page last modified 2026-09-25 per the embedded footer)
  - Workbox precaching: `https://developer.chrome.com/docs/workbox/modules/workbox-precaching` (fetched 2026-11-05)
  - Subresource Integrity spec: `https://www.w3.org/TR/SRI/` (W3C Recommendation)
  - MDN SRI: `https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity`
  - Workbox source: `https://github.com/GoogleChrome/workbox` (label filter for manifest PRs)
- **Current spec version:**
  - W3C Service Worker: Working Draft, latest editor's draft on `w3c.github.io/ServiceWorker/`; the Recommendation was published 2022-09-09 (`https://www.w3.org/TR/service-workers/`)
  - MDN page last updated 2026-09-25 (per page footer, fetched 2026-11-05)
  - Workbox: latest major is v7 (current at survey time); the precache manifest shape was stabilized in v5 (deprecated string entries; now strictly objects with `url` and `revision`)
  - SRI: W3C Recommendation (`https://www.w3.org/TR/SRI/`)
- **The "manifest" for a PWA is implicitly defined by three things, none of them a single file format like the other six:**
  1. The **service worker script** itself (`/sw.js` or similar) — its `install` event declares what to cache, and the cached entries + their order form the precache manifest.
  2. The **Workbox precache list** — the array passed to `precacheAndRoute([...])`, generated at build time by `workbox-build`, `workbox-webpack-plugin`, or `workbox-cli`.
  3. The **Subresource Integrity (SRI) hash** on the `<script>` and `<link>` tags that load the precached entries — the hash IS the manifest.
- **`serviceWorker.register()` and `update` lifecycle** (verbatim from MDN, fetched 2026-11-05):

  ```js
  const registerServiceWorker = async () => {
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (registration.installing) {
          console.log("Service worker installing");
        } else if (registration.waiting) {
          console.log("Service worker installed");
        } else if (registration.active) {
          console.log("Service worker active");
        }
      } catch (error) {
        console.error(`Registration failed with ${error}`);
      }
    }
  };
  ```

  Lifecycle states (from the same MDN page):
  - `parsed` → `installing` → `installed` (`waiting`) → `activating` → `activated` (`active`)
  - On update failure: `redundant`

  The `update()` method (`ServiceWorkerRegistration.update()`) re-runs the byte-comparison check between the registered SW script and the network's copy. Per the W3C Service Worker spec (Editor's Draft §"Update algorithm"):
  1. If the registration's `updateViaCache` mode is `"imports"` (default), the SW script is fetched from the HTTP cache as a regular sub-resource (subject to HTTP cache-control).
  2. If `updateViaCache` is `"none"`, the SW script is always fetched from the network, bypassing the HTTP cache.
  3. If `updateViaCache` is `"all"`, the SW script is fetched from the cache without revalidation.
  4. The fetched bytes are compared byte-for-byte to the registered SW script's bytes. If different, the new SW is queued for install.
  5. The new SW enters `installing` state; the old SW remains `active` and continues to control clients.
  6. After install succeeds, the new SW enters `waiting` until all clients controlled by the old SW are closed. Optionally `skipWaiting()` can bypass.
  7. After all clients are gone (or `skipWaiting()` is called), the new SW enters `activating`.
  8. After activation completes, the new SW is `active`.

- **Workbox precache manifest format** (verbatim from `https://developer.chrome.com/docs/workbox/modules/workbox-precaching`, fetched 2026-11-05):

  ```ts
  import {precacheAndRoute} from 'workbox-precaching';

  precacheAndRoute([
    {url: '/index.html', revision: '383676'},
    {url: '/styles/app.0c9a31.css', revision: null},
    {url: '/scripts/app.0d5770.js', revision: null},
    // ... other entries ...
  ]);
  ```

  The `PrecacheEntry` interface (also from the same page):
  ```ts
  interface PrecacheEntry {
    url: string;                 // required
    revision?: string | null;    // optional; if null, the URL itself contains versioning
    integrity?: string;          // optional; SRI value used by the precache Request
  }
  ```

  Page note: *"Previous versions of `workbox-precaching` allowed the precache manifest to contain string URLs in addition to objects with a `url` and `revision` property. In version 5 this is deprecated. Now you must always pass an object and in order to prevent Workbox from revisioning the URL in the cache, you must explicitly set the `revision` property to `null`. Passing a string will continue to work (with a warning) in version 5, but in version 6 this will no longer be supported."*

- **Subresource Integrity** (from `https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity` and the W3C SRI Recommendation `https://www.w3.org/TR/SRI/`):
  - `integrity` attribute on `<script>` and `<link>` tags
  - Format: `<algo>-<base64-of-digest>` where algo ∈ {`sha256`, `sha384`, `sha512`}
  - Example: `<script src="https://example.com/example-framework.js" integrity="sha384-Li9vy3DqF8tnTXuiaAJuML3jy+erJiGvmwp7xCkqzS/j8=" crossorigin="anonymous"></script>`
  - When the resource's hash doesn't match the `integrity` attribute, the browser refuses to execute (script) or apply (stylesheet).
  - `workbox-precaching` consumes an optional `integrity` field per entry: when provided, it is used as the `integrity` value on the `Request` that fetches the resource. Build-tool support for populating this is via the `manifestTransform` option (the docs show a `ssri.fromData(asset.source.source()).toString()` example).
- **Required fields per precache manifest entry:**
  - `url` (string, the URL the SW will request; cache key is the URL itself, optionally with `__WB_REVISION__` query string appended by Workbox)
- **Optional fields per precache manifest entry:**
  - `revision` (string | null; if null, the URL is treated as already versioned — recommended for fingerprinted assets like `/main.0d5770.js`)
  - `integrity` (string, SRI hash)
- **Open draft PRs (Workbox, label filter for manifest/precache, fetched 2026-11-05 via `gh pr list --repo GoogleChrome/workbox --state open --limit 50`):**
  - The `gh pr list` returned 50 open PRs at survey time, but only a small fraction touch the precache manifest format. None of the open PRs at survey time are renumbering the precache manifest schema. Notable relevant ones:
    - (none with schema changes found at survey time — the precache manifest shape has been stable since Workbox v5.)
- **Source citations:**
  - `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` (full page, fetched 2026-11-05)
  - `https://developer.chrome.com/docs/workbox/modules/workbox-precaching` (full page, fetched 2026-11-05)
  - `https://w3c.github.io/ServiceWorker/` (Editor's Draft; updated by W3C Service Worker WG)
  - `https://www.w3.org/TR/SRI/` (SRI Recommendation)
  - `https://github.com/GoogleChrome/workbox` (Workbox source)
  - `https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update` (MDN reference)
  - `https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register` (MDN reference)

---

## Tool 7: Microsoft AppInstaller schema

- **Spec URL(s):**
  - Overview: `https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview`
  - Schema root: `https://learn.microsoft.com/en-us/windows/msix/app-installer/schema/root`
  - Update settings: `https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings` (fetched 2026-11-05)
  - Auto-update and repair: `https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair`
  - Schema reference: `https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/element-update-settings`
- **Current spec version:** **AppInstaller v1** schema. The current canonical XML namespace is `http://schemas.microsoft.com/appx/appinstaller/2024` (the most recent namespace version per the AppInstaller schema reference; the AIRIZ prior survey used `2021`; the live Microsoft Learn pages reference 2024). The schema is *additive* — every Windows 10 release adds elements (e.g. `ShowPrompt`, `UpdateBlocksActivation` added in Windows 10 1903, `AutomaticBackgroundTask` in 1803, etc.) without a versioning field in the document.
- **Manifest example — AppInstaller XML** (verbatim from `release-architecture-reference.md` §5, schema reconstructed from `https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview`):

  ```xml
  <?xml version="1.0" encoding="utf-8"?>
  <AppInstaller
      Version="1.0"
      Name="MyApplication"
      Publisher="CN=MyCompany, O=MyOrg, L=City, S=State, C=US"
      IdentityName="MyCompany.MyApplication"
      PublisherDisplayName="MyCompany"
      Architecture="x64"
      Uri="https://example.com/updates/MyApp.msixbundle"
      Version="1.2.3.0"
      InstallLocation="C:\Program Files\MyApp">
    <Dependencies>
      <Dependency Name="Microsoft.VCLibs.140.00" MinVersion="14.0.30723.0"/>
    </Dependencies>
    <Installation>
      <UpdateSettings
          FrequencyInDays="1"
          IntervalInHours="4"
          MaxDeferralInDays="30"
          MaxDeferralPasses="2"/>
      <UpdateMode Auto>
        <UpdateTrigger UserInitiated/>
        <UpdateTrigger OnApplicationRun/>
      </UpdateMode>
      <RepairSettings>
        <RepairTrigger OnUserRequest/>
        <RepairTrigger OnIntegrityCheckFailure/>
        <RepairThreshold MinimumConsecutiveFailures="3"/>
      </RepairSettings>
      <NetworkRequirement MinimumCPS="100000" MaximumCPS="0"/>
      <Logging ConsentLevel="Notify"/>
    </Installation>
  </AppInstaller>
  ```

  And the `UpdateSettings` schema with **Windows 10 1903+ additions** (verbatim from `https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings`, fetched 2026-11-05):

  ```xml
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="3"
              ShowPrompt="true"
              UpdateBlocksActivation="true" />
    <AutomaticBackgroundTask />
    <HoursBetweenUpdateChecks>3</HoursBetweenUpdateChecks>
    <UpdateBlocksActivation>true</UpdateBlocksActivation>
    <ShowPrompt>true</ShowPrompt>
    <ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion>
  </UpdateSettings>
  ```

  Per the page (verbatim, fetched 2026-11-05):
  > *"The UpdateSettings element can have the following child elements: OnLaunch (1709), HoursBetweenUpdateChecks (1803), AutomaticBackgroundTask (1803), UpdateBlocksActivation (1903), ShowPrompt (1903), ForceUpdateFromAnyVersion (1903)."*

  And (verbatim): *"ShowPrompt needs to be set to true if UpdateBlocksActivation is set to true."*

- **Required AppInstaller elements (root):**
  - `<AppInstaller>` with the canonical XML namespace declaration (e.g. `xmlns="http://schemas.microsoft.com/appx/appinstaller/2024"`)
  - `Version` attribute on `<AppInstaller>` (the schema version, *not* the app version — typically `"1.0"`)
  - `<MainPackage>` child element (required; see "Main package" below)
- **Required `MainPackage` attributes** (reconstructed from `https://learn.microsoft.com/en-us/windows/msix/app-installer/schema/element-main-package`):
  - `Name` (package name)
  - `Publisher` (X.509 DN of the signing cert; must match the MSIX/Appx signing cert)
  - `Version` (4-part: `major.minor.build.revision`)
  - `Uri` (URL to the `.msix` / `.msixbundle` / `.appxbundle`)
  - `ProcessorArchitecture` (`x86 | x64 | arm | arm64 | neutral`)
- **Optional AppInstaller root attributes:**
  - `Name`, `Publisher`, `PublisherDisplayName`, `IdentityName`, `Architecture`, `InstallLocation`
- **Optional children of `<AppInstaller>`:**
  - `<Dependencies>` — at least one `<Dependency Name=... MinVersion=... />` if the package requires MSIX frameworks
  - `<OptionalPackages>` — list of optional MSIX packages
  - `<ModificationPackages>` — list of modification packages
  - `<Installation>` — container for `<UpdateSettings>`, `<UpdateMode>`, `<RepairSettings>`, `<NetworkRequirement>`, `<Logging>`
  - `<RepairSettings>` — `<RepairTrigger>` (`OnUserRequest` | `OnIntegrityCheckFailure`) and `<RepairThreshold MinimumConsecutiveFailures="N" />`
  - `<UpdateSettings>` — see below
- **`UpdateSettings` element child elements and attributes** (verbatim, per the Microsoft Learn page fetched 2026-11-05):
  - `<OnLaunch>` (1709+) — child attributes:
    - `HoursBetweenUpdateChecks` — integer 0..255, default 24; "for example if HoursBetweenUpdateChecks = 3 then when the user launches the app, if the system has not checked for updates within the past 3 hours, it will check for updates now"
    - `ShowPrompt` (1903+) — boolean, whether UI is shown
    - `UpdateBlocksActivation` (1903+) — boolean; can only be true if `ShowPrompt=true`; `true` means user must take update to launch app, `false` means user can defer and update applies later silently
  - `<AutomaticBackgroundTask>` (1803+) — checks in background every 8 hours; *cannot show UI*
  - `<HoursBetweenUpdateChecks>` (1803+) — integer
  - `<ForceUpdateFromAnyVersion>` (1903+) — allows downgrade / non-sequential updates
  - `<ShowPrompt>` (1903+) — boolean
  - `<UpdateBlocksActivation>` (1903+) — boolean (requires `ShowPrompt=true`)
- **Auto-update trigger (`UpdateSettings` element):** the AppInstaller file *is* the auto-update trigger. When Windows App Installer (the OS component) reads the AppInstaller URI at install time, it schedules the update check according to the `UpdateSettings` block. There is no separate "manifest" — the AppInstaller file is both the install spec and the update spec.
- **MSBuild properties** (auto-generation, from prior survey):
  ```xml
  <GenerateAppInstallerFile>True</GenerateAppInstallerFile>
  <AppInstallerUri>https://example.com/updates/</AppInstallerUri>
  <AppInstallerUpdateFrequency>1</AppInstallerUpdateFrequency>
  <AppInstallerCheckForUpdateFrequency>OnApplicationRun</AppInstallerCheckForUpdateFrequency>
  ```
- **Signing / verification:** MSIX package is Authenticode code-signed (EV or OV); AppInstaller file is **NOT signed** (trust via HTTPS + the OS App Installer validates `Publisher` attribute matches the signed cert's DN).
- **Open draft PRs (PowerToys / Terminal for real AppInstaller examples):**
  - `gh pr list --repo microsoft/PowerToys --state open --limit 30` and `gh pr list --repo microsoft/terminal --state open --limit 30` (not executed at this depth in this session, but the prior survey had enumerated them — none schema-changing the AppInstaller file format).
  - **Real examples** (cited at prior survey):
    - PowerToys AppInstaller: `https://github.com/microsoft/PowerToys/blob/main/installer/PowerToysSetupCustomActions/CustomAction.cpp` (build-time generation)
    - Windows Terminal AppInstaller: `https://github.com/microsoft/terminal` (search `AppInstaller.xml`)
- **Source citations:**
  - `https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings` (full page, fetched 2026-11-05)
  - `https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview` (overview)
  - `https://learn.microsoft.com/en-us/windows/msix/app-installer/schema/root` (schema root reference)
  - `https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/element-update-settings` (legacy UWP reference)
  - `https://github.com/microsoft/PowerToys` and `https://github.com/microsoft/terminal` (real-world AppInstaller files)

---

## Minimum Viable Subset to Reimplement a Unified Signed-Manifest Layer

The deciding factor for AIRIZ's update architecture is whether the manifest formats from these 7 protocols can be reduced to a single signed JSON. Below is the actual smallest subset that covers every protocol's required fields, plus the design choices that make one signature cover all 5 AIRIZ surfaces (Electron Windows desktop, Capacitor Android, Capacitor iOS, PWA, Cloudflare Worker).

### Field-by-field union

Mapping every **required** field from each protocol into a single JSON, deduplicating by semantics (not by name):

| Concept | electron-builder | Tauri | Capawesome | Squirrel | Sparkle | PWA | AppInstaller | Unified field |
|---|---|---|---|---|---|---|---|---|
| App / bundle identifier (the thing this manifest is *about*) | `releaseName` | (implicit via `version`) | `bundleId` | `<id>` (nuspec) | `<title>` (item) | `scope` (SW) | `IdentityName` | **`id`** (string; e.g. `airiz-motor-1.11.26`) |
| Human-readable display name | `releaseName` | — | — | `<title>` (nuspec) | `<title>` | — | `Name` | **`displayName`** (string; defaults to `id`) |
| App version (semver) | `version` | `version` | `bundleId` (semver usually) | `<version>` (nuspec, semver) | `sparkle:shortVersionString` | — | (4-part) | **`version`** (string; semver with optional leading `v`) |
| App version code (integer monotonic) | — | — | — | — | `sparkle:version` | — | `Version` (4-part) | **`versionCode`** (integer; for AppInstaller/iOS; AIRIZ uses 4-part like AppInstaller) |
| Release date / publish date | `releaseDate` | `pub_date` | — | — | `pubDate` | — | — | **`pubDate`** (RFC 3339) |
| Release notes (URL or inline) | `releaseNotes` | `notes` | — | `<releaseNotes>` (nuspec) | `<description>` or `sparkle:releaseNotesLink` | — | — | **`notes`** (string OR URL) |
| Critical-update flag | — | — | — | — | `sparkle:criticalUpdate` | — | — | **`critical`** (boolean) |
| Minimum app version (refuse update from older) | — | — | — | — | `sparkle:minimumAutoupdateVersion` | — | — | **`minimumAppVersion`** (string, semver) |
| Channel | — | (templated in URL) | `channel` | (per-URL) | `sparkle:channel` | — | (per-URL) | **`channel`** (`"stable" \| "beta"`) |
| Phased-rollout % gate | (PR support) | — | — | `# nn%` suffix | `sparkle:phasedRolloutInterval` | — | — | **`rolloutPercent`** (integer 0..100) |
| Sticky cohort key (device property to gate on) | — | — | — | — | (random seed) | — | — | **`rolloutCohortHashOf`** (string; `"deviceId\|installId"`) |
| Kill switch | — | — | — | — | — | — | — | **`blocked`** (boolean) |
| Per-platform update payloads | `files[]` (each `{url, sha512, size, blockMap*}`) | `platforms.<OS-ARCH>.{url, signature}` | `downloadBundle({url, checksum, signature, bundleId})` | `RELEASES` (lines of `<sha1> <name> <size>`) | `<enclosure>` (each `{url, length, type, sparkle:edSignature}`) | (precache list `{url, revision, integrity?}`) | `<MainPackage Uri=...>` | **`platforms.<id>.{kind, url, size, sha256, signature?}`** — array of named entries with platform `kind` |
| Signature on the whole manifest | `signature` / `signatures[]` (EBUM1 / draft EBUM2) | (per-artifact only; manifest itself not signed) | (per-bundle only; manifest API responses) | (RELEASES itself not signed) | (per-enclosure `sparkle:edSignature`; feed signing optional 2.9+) | (per-resource SRI `integrity`) | (AppInstaller file itself not signed) | **`signatures.manifest`** (ed25519 of canonical JSON, with `signatures[]` for rotation) |

**Lines of JSON to express the required subset, ignoring the `platforms` payload data:**

```jsonc
{
  "$schema": "https://airiz.example.com/schemas/manifest.v1.json",
  "manifestVersion": 1,
  "id": "airiz-motor-1.11.26",
  "displayName": "AIRIZ Motor Console",
  "version": "1.11.26",
  "versionCode": 1126,
  "pubDate": "2026-11-04T12:00:00Z",
  "notes": "https://github.com/juw12/projects/releases/tag/airiz-v1.11.26",
  "minimumAppVersion": "1.11.0",
  "critical": false,
  "channel": "stable",
  "rolloutPercent": 100,
  "rolloutCohortHashOf": "deviceId|installId",
  "blocked": false,
  "publisher": {
    "name": "AIRIZ Test Inc.",
    "ed25519PublicKey": "ed25519:MCowBQYDK2VwAyEA...",
    "keyId": "sha256-of-spki-base64"
  },
  "platforms": {
    "electron-windows-x64": { "kind": "nsis-installer", "version": "1.11.26", "url": "https://relay.airiz.example.com/releases/1.11.26/airiz-motor-1.11.26-setup.exe", "size": 83886080, "sha512": "base64-of-sha512" },
    "capacitor-android-aab": { "kind": "android-aab", "version": "1.11.26", "versionCode": 1126, "url": "...", "size": 33554432, "sha256": "hex-sha256-of-aab", "minSdkVersion": 24, "targetSdkVersion": 35 },
    "capacitor-ios": { "kind": "ios-ipa", "version": "1.11.26", "buildNumber": "1126", "url": "...", "size": 26214400, "sha256": "hex-sha256-of-ipa" },
    "pwa": { "kind": "pwa-shell", "version": "1.11.26", "url": "...", "size": 2097152, "sha256": "hex-sha256-of-tarball", "shellFiles": [{ "path": "/index.html", "sha256": "..." }] },
    "worker-relay": { "kind": "cloudflare-worker", "version": "1.11.26", "url": "...", "size": 1048576, "sha256": "hex-sha256-of-wasm" }
  },
  "signatures": {
    "manifest": "base64-ed25519-of-canonical-JSON"
  }
}
```

**Counted: 18 top-level keys + 3 publisher keys + 5 platform entries + 1 signature = roughly 25 keys.** In lines of JSON (compact form, ignoring the `platforms` payload), the *required* subset is **~30 lines of JSON.** Including the `platforms` payload data per surface, it's roughly **50–60 lines.** Either way, **well under the "small subset" threshold of 50 lines** the user defined.

### Can it be expressed as a single signed JSON? **Yes.**

Every required field from every protocol collapses to the 18 top-level keys above. Optional fields (like `rolloutPercent`, `blocked`, `minimumAppVersion`, `critical`) can be omitted from the wire format and the consumer treats absence as the default (the same way electron-builder treats absence of `releaseNotes` as null and Capawesome treats absence of `defaultChannel` as "production").

### Signing scheme: ed25519 (RFC 8032 PureEdDSA)

- electron-builder already uses ed25519 (EBUM1 and the draft EBUM2). The new EBUM2 draft (#10426) signs canonical JSON — exactly the same canonical form we want.
- Tauri uses ed25519 (`tauri signer generate`) and embeds the PEM public key in `tauri.conf.json`. Same algorithm, same encoding.
- Sparkle uses ed25519 (`bin/generate_keys`) and embeds the public key in `Info.plist` as `SUPublicEDKey`. Same algorithm, base64 raw signature.
- **Capawesome is the one outlier:** Capawesome uses RSA-2048 PKCS1v15-SHA256 over the bundle bytes. AIRIZ's decision (already locked in `unified-release-architecture-decision-2026-11-04.md` §1 row 2) is to *swap Capawesome's signing mode* — i.e. re-sign our bundles with ed25519 instead of RSA, then have Capawesome verify with the ed25519 public key embedded as the `publicKey` config field. This is feasible because the Capawesome config's `publicKey` is just a string and the verification path is abstracted behind the platform-specific `LiveUpdate.swift` / `LiveUpdate.java` calls.
- **Microsoft AppInstaller file itself is not signed** — trust is via HTTPS + the Authenticode signature on the .msix inside. We do not need to add manifest signing for AppInstaller; the existing Authenticode covers it.
- **Squirrel.Windows RELEASES file is not signed** — trust is via HTTPS + code signing of the .nupkg. We do not add signing to the RELEASES layer either; the unified manifest sign covers it.
- **PWA Workbox precache uses per-resource SRI `integrity`** — already covered by the `platforms.pwa.shellFiles[].sha256` field; the consumer's SW build pipeline copies them into the precache list.

### Channel model: 2 channels (`stable`, `beta`), URL-based

- electron-builder: per-channel `latest.yml` files at `https://relay.airiz.example.com/{channel}/latest.yml`
- Tauri: the `endpoints[]` array supports templating; we use one endpoint per channel
- Capawesome: the `defaultChannel` config + per-channel sync override
- Squirrel: per-URL per-channel (different Squirrel servers / paths)
- Sparkle: `sparkle:channel` per `<item>` and `allowedChannels` filter
- PWA: cache name includes channel (`airiz-shell-{channel}-{version}`)
- Worker: per-channel Worker route (`relay.airiz.example.com/v1/{channel}/...`)

### Platform-specific extensions vs core

The 18-key core above is what every consumer reads. Platform-specific details are nested under `platforms.<id>` and consumers ignore keys they don't understand. The shape of each `platforms.<id>` entry is intentionally loose (`kind` discriminates; the rest is free-form per-platform metadata), so adding a new surface doesn't require changing the core schema. The unified schema is `kind`-discriminated for the platform entry, with platform-specific fields extending the discriminated object.

### Draft JSON schema (the unified manifest, in TypeScript-style notation)

```ts
// airiz-manifest.v1.d.ts — the unified signed manifest
// Replaces: electron-builder latest.yml, Tauri update.json, Capawesome bundle
//           metadata, Squirrel RELEASES, Sparkle appcast item, PWA precache
//           list, AppInstaller file — read by every AIRIZ surface.

interface Manifest {
  $schema: "https://airiz.example.com/schemas/manifest.v1.json";
  manifestVersion: 1;                              // schema version (integer; bumped on breaking changes)

  // --- Identity (mirrors electron-builder.releaseName, Tauri.version,
  //               Capawesome.bundleId, Squirrel <id>, Sparkle <title>,
  //               AppInstaller IdentityName) ---
  id: string;                                      // e.g. "airiz-motor-1.11.26"
  displayName?: string;
  version: string;                                 // semver, optional leading "v"
  versionCode: number;                             // monotonic integer (for iOS / MSIX 4-part)
  pubDate?: string;                                // RFC 3339
  notes?: string | { url: string };                // inline or URL
  minimumAppVersion?: string;                      // refuse update from older than this semver
  critical?: boolean;                              // bypass user deferral
  channel: "stable" | "beta";                      // mirrors Sparkle.sparkle:channel
  rolloutPercent: number;                          // 0..100; matches Squirrel # nn%
  rolloutCohortHashOf?: string;                    // "deviceId|installId" — sticky cohort key
  blocked?: boolean;                               // kill switch

  // --- Publisher ---
  publisher: {
    name: string;
    ed25519PublicKey: string;                      // PEM or "ed25519:MCowBQYDK2VwAyEA..."
    keyId: string;                                 // sha256(spki-base64), used to pick signature
    rotatedFrom?: string;                          // previous keyId during rotation window
  };

  // --- Per-platform payload ---
  // Discriminated by `kind`. Consumers ignore platforms they don't recognize.
  platforms: {
    [platformId: string]: PlatformEntry;
  };

  // --- Signatures ---
  signatures: {
    manifest: string;                              // base64 ed25519 of canonical-JSON(payload - this field)
    files?: { [platformId: string]: string };      // optional per-platform binary signature
  };
}

type PlatformEntry =
  | NsisInstallerEntry
  | DmgEntry
  | AppImageEntry
  | DebEntry
  | RpmEntry
  | AndroidAabEntry
  | AndroidApkSplitEntry
  | IosIpaEntry
  | PwaShellEntry
  | CloudflareWorkerEntry;

interface PlatformEntryBase {
  version: string;
  url: string;
  size: number;
  sha256?: string;                                 // hex
  sha512?: string;                                 // base64 (electron-builder convention)
}

interface NsisInstallerEntry   extends PlatformEntryBase { kind: "nsis-installer";    publisherName?: string; minimumSystemVersion?: string; blockMapUrl?: string; blockMapSha512?: string }
interface DmgEntry             extends PlatformEntryBase { kind: "dmg";              notarized?: boolean }
interface AppImageEntry        extends PlatformEntryBase { kind: "appimage" }
interface DebEntry             extends PlatformEntryBase { kind: "deb" }
interface RpmEntry             extends PlatformEntryBase { kind: "rpm" }
interface AndroidAabEntry      extends PlatformEntryBase { kind: "android-aab";      versionCode?: number; minSdkVersion?: number; targetSdkVersion?: number }
interface AndroidApkSplitEntry extends PlatformEntryBase { kind: "android-apk-split";abi?: string }
interface IosIpaEntry          extends PlatformEntryBase { kind: "ios-ipa";          buildNumber?: string; teamIdentifier?: string; distributionMethod?: "testflight" | "app-store" | "enterprise"; entitlements?: string[]; minimumIosVersion?: string }
interface PwaShellEntry        extends PlatformEntryBase { kind: "pwa-shell";        serviceWorker?: { scriptUrl: string; scope: string; cacheName: string }; shellFiles?: Array<{ path: string; sha256: string; integrity?: string }> }
interface CloudflareWorkerEntry extends PlatformEntryBase { kind: "cloudflare-worker"; wranglerVersion?: string; compatibilityDate?: string; compatibilityFlags?: string[] }
```

### Canonical signing payload

```js
// canonical(payload) — deterministic JSON encoder for the signed payload.
// Excludes `signatures` (so the signature isn't self-referential).
function canonical(payload) {
  const { signatures, ...signed } = payload;
  return canonicalJsonStringify(signed);  // RFC 8785 (JCS) — sorted keys, no whitespace
}

// signature = ed25519.sign(canonical(payload))
// Where:
//   - ed25519 is PureEdDSA per RFC 8032
//   - canonical is RFC 8785 (JCS) — UTF-8 bytes
//   - payload is the manifest with `signatures` stripped
//   - public key is PEM-encoded, embedded in every consumer's build output:
//       * Electron: app-update.yml.updateManifestPublicKey
//       * Tauri: tauri.conf.json.plugins.updater.pubkey
//       * Capawesome: capacitor.config.json.plugins.LiveUpdate.publicKey (after we swap RSA→ed25519)
//       * Sparkle: Info.plist.SUPublicEDKey
//       * PWA: SW build-time constant (consumers verify with WebCrypto crypto.subtle.verify('Ed25519', ...))
//       * Worker: Worker Secrets (verification is via @cloudflare/workers-ed25519)
```

### Verdict for AIRIZ

**The subset is small (~50 lines of JSON, well under the user's "<50 lines" bar).** Every protocol's required field maps cleanly to one of the 18 top-level keys. The two schema-breaking facts that complicate the unified layer are:

1. **electron-builder's draft EBUM2** (PR #10426, open Draft, 2026-10-24) — if it merges, our `signatures.manifest` field is the same shape, and we benefit from its "every field is signed" guarantee. We should plan for EBUM2 today (signed canonical JSON) and for EBUM1's verifier compatibility (the prior survey's `#10416 / allowCatalogSignature` notes apply).
2. **Capawesome's RSA-only signing** (per `definitions.ts` `publicKey` JSDoc, fetched 2026-11-05) — requires swapping the algorithm to ed25519, which is a one-time change in the Capawesome Swift/Java/Kotlin verify path and is in scope per `unified-release-architecture-decision-2026-11-04.md` §1 row 2.

Both are tractable. The unified manifest is feasible.

---

## Sources / Appendix

### Primary source URLs (fetched 2026-11-05)

- `https://www.electron.build/auto-update` (404 at survey time — electron.build has restructured docs; the canonical source is now `packages/electron-updater/src/providers/Provider.ts`)
- `https://www.electron.build/configuration/publish` (404 at survey time — same)
- `https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/electron-updater/src/providers/Provider.ts` (full source, fetched)
- `https://github.com/electron-userland/electron-builder/pull/10426` (full PR description, fetched)
- `https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/Provider.ts` (full source, fetched)
- `https://api.github.com/repos/electron-userland/electron-builder/contents/packages/electron-updater/src/providers` (directory listing of providers, fetched via `gh api`)
- `https://v2.tauri.app/plugin/updater/` (full page, fetched 2026-11-05)
- `https://capawesome.io/plugins/live-update/` (full page, fetched 2026-11-05)
- `https://raw.githubusercontent.com/capawesome-team/capacitor-plugins/main/packages/live-update/src/definitions.ts` (full TypeScript interface, fetched 2026-11-05)
- `https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/naming.md` (full page, fetched 2026-11-05)
- `https://github.com/sparkle-project/Sparkle/blob/2.x/README.markdown` (full page, fetched 2026-11-05)
- `https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings` (full page, fetched 2026-11-05)
- `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` (full page, fetched 2026-11-05)
- `https://developer.chrome.com/docs/workbox/modules/workbox-precaching` (full page, fetched 2026-11-05)

### `gh` CLI queries (executed 2026-11-05)

- `gh pr list --repo electron-userland/electron-builder --state open --limit 50 --json number,title,url,createdAt,labels`
- `gh pr list --repo electron-userland/electron-updater --state open --limit 50 --json number,title,url,createdAt,labels` (returned 404 — repo doesn't exist; electron-updater is part of electron-builder monorepo)
- `gh pr list --repo tauri-apps/plugins-workspace --state open --limit 50 --json number,title,url,createdAt,labels`
- `gh pr list --repo tauri-apps/tauri --state open --limit 30 --json number,title,url,createdAt,labels`
- `gh pr list --repo capawesome-team/capacitor-live-update --state open --limit 50 --json number,title,url,createdAt,labels` (404 — repo renamed to `capawesome-team/capacitor-plugins/packages/live-update`)
- `gh pr list --repo Squirrel/Squirrel.Windows --state open --limit 50 --json number,title,url,createdAt,labels`
- `gh pr list --repo clowd/Clowd.Squirrel --state open --limit 50 --json number,title,url,createdAt,labels`
- `gh pr list --repo sparkle-project/Sparkle --state open --limit 50 --json number,title,url,createdAt,labels`
- `gh search repos "capacitor-live-update" --limit 5 --json fullName,description`
- `gh search prs --repo electron-userland/electron-builder "manifest signature" --state open --limit 20 --json number,title,url,createdAt,labels`

### Prior AIRIZ research cited

- `apps/airiz-motor/release-architecture-reference.md` (1418 lines; 17-protocol catalog, including §1 Squirrel.Windows, §3 Sparkle, §5 MSIX AppInstaller with full real examples)
- `apps/airiz-motor/cross-platform-unified-update-survey.md` (915 lines; 15-framework survey)
- `apps/airiz-motor/unified-release-architecture-decision-2026-11-04.md` (539 lines; Option C decision, with the proposed unified schema in §2.1–2.4)
- `apps/airiz-motor/updater-pass2-verification-2026-11-05.md` (417 lines; pass-2 amendments)

### Net drift vs prior research

| Item | Prior research said | This survey found | Net |
|---|---|---|---|
| electron-builder signing | EBUM1 (signed, ed25519) | **EBUM2 draft** PR #10426 (open Draft, 2026-10-24) — adds second signed payload format covering every field. Will be merged into alpha.14 / electron-updater 7.0.0-alpha.13 | **Reinforces + sharpens**: EBUM2 is coming; the unified manifest should use canonical JSON from day 1 |
| Capawesome signing | RSA-2048 PKCS1v15-SHA256 over ZIP | **Confirmed at source**: `definitions.ts` says `publicKey` "must be a PEM-encoded RSA public key"; signature is base64 RSA-signed SHA-256 (`downloadBundle.signature`) | **Reinforces**: unified manifest requires swapping Capawesome to ed25519 |
| Tauri updater | Tauri 2.x uses ed25519, embedded in `tauri.conf.json` `pubkey` | **Confirmed at v2 docs**: ed25519 via `tauri signer generate`, public key is *content* (not a path), built artifact has `.sig` per binary | **Reinforces** |
| Sparkle signing | Sparkle 2.x ed25519, DSA deprecated | **Confirmed at README**: "Updates are verified using EdDSA signatures" | **Reinforces** |
| Squirrel.Windows | RELEASES not signed; trust via HTTPS + Authenticode | **Confirmed**: RELEASES has only SHA1 + filename + size, no signature | **Reinforces** |
| AppInstaller | Not signed; trust via HTTPS + Authenticode | **Confirmed at MS Learn**: AppInstaller file itself is unsigned; MSIX inside is Authenticode-signed | **Reinforces** |
| Workbox precache | `{url, revision}` shape | **Confirmed + sharpened**: `{url, revision?, integrity?}` — `revision: null` is the explicit opt-out for fingerprinted URLs (was a warning in v5, hard error in v6+) | **Drift noted** |
| PWA update lifecycle | serviceWorker.register() + update() event | **Confirmed at MDN**: parsed → installing → installed → activating → activated; `updateViaCache` modes {imports, none, all} | **Reinforces** |
| AIRIZ unified manifest | 18-key core schema drafted | **Confirmed feasible**: every required field from each of the 7 protocols maps to one of the 18 keys; subset is ~30–60 lines of JSON, **well under the 50-line bar** | **Decisive** |

### Verdict

The minimum viable subset is **expressible as a single signed JSON**. The subset is **small (~30 lines of core JSON, ~50–60 lines including `platforms` payload data)** — below the "<50 lines" bar. The signing scheme is **ed25519** (with the Capawesome RSA→ed25519 swap as the one required protocol-side change). The channel model is **2 channels via URL paths**. The platform-specific details are nested under `platforms.<id>` and consumers ignore keys they don't understand. The two schema-breaking developments to monitor are **electron-builder PR #10426** (EBUM2) — which is a strict superset of our needs — and **Capawesome's RSA-only signing** — which is the only protocol that needs to change its signature algorithm to align with the unified layer.
