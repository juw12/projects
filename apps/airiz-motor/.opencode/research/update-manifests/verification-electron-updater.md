# electron-updater source-map verification

## SHAs

- Phase 1 SHA: `cdd9f7ec77007cdc9657b9f9faa0be2000564d59`
- Current HEAD SHA: `cdd9f7ec77007cdc9657b9f9faa0be2000564d59`

**SHAs are identical.** No code changes since Phase 1.

## Method

`gh api` against `electron-userland/electron-builder` (master ref), base64-decoded, and grep-verified against:
- `packages/electron-updater/src/AppUpdater.ts` (82,386 chars)
- `packages/electron-updater/src/types.ts` (7,928 chars)
- `packages/electron-updater/src/BaseUpdater.ts` (45,367 chars)
- `packages/electron-updater/src/NsisUpdater.ts` (NSIS-specific args, not in the abstract base)
- `packages/electron-updater/src/MacUpdater.ts` (macOS Squirrel.Mac delegation)

## Claim-by-claim verdict

### Claim 1 — Signing scheme is Ed25519 — **VERIFIED**

`AppUpdater.ts:357` (`updateManifestPublicKey` field doc):
> The Ed25519 public key(s) (PEM or base64 SPKI) trusted to have signed the update manifest

`AppUpdater.ts:833` (`verifyManifestSignature` method doc):
> Verifies the Ed25519 signature(s) embedded in the update manifest against the configured trust list.

### Claim 2 — `AutoInstallEvent` enum with 3 values — **VERIFIED**

`types.ts:32`:
```ts
export type AutoInstallEvent = "manual" | "onQuit" | "onNextLaunch"
```

Doc comments at `types.ts:27–30` describe all three semantics (spawn installer on quit / persist for next launch / manual only). Note this is a TS string-literal union, not a TS `enum` keyword — semantically equivalent and consistent with Phase 1's claim of "3 values".

### Claim 3 — `allowDowngrade` auto-set to `true` on channel change — **VERIFIED**

Channel setter at `AppUpdater.ts:327`:
```ts
this.allowDowngrade = true
```

Inside the setter that also documents the behavior (`AppUpdater.ts:314`):
> `allowDowngrade` will be automatically set to `true`. If this behavior is not suitable for you, simple set `allowDowngrade` explicitly after.

Field default at `AppUpdater.ts:208`: `allowDowngrade = false`.

### Claim 4 — `quitAndInstall` semantics + NSIS args + macOS Squirrel.Mac delegation — **VERIFIED**

**Abstract declaration** at `AppUpdater.ts:1040`:
```ts
abstract quitAndInstall(options?: QuitAndInstallOptions): void
```
`QuitAndInstallOptions` defined in `types.ts` with `isSilent`, `isForceRunAfter`, `waitUntilNextLaunch` fields.

**NSIS args** (in `NsisUpdater.ts`, not in the abstract base — that's why they were absent from the three initially fetched files):
- `NsisUpdater.ts:334` — `const args = ["--updated"]`
- `NsisUpdater.ts:336` — `args.push("/S")` (when `options.isSilent`)
- `NsisUpdater.ts:340` — `args.push("--force-run")` (when `options.isForceRunAfter`)
- Bonus: `NsisUpdater.ts:351` — ``args.push(`--package-file=${packagePath}`)``
- Bonus: `NsisUpdater.ts:357` — ``args.push(`/D=${this.installDirectory}`)``

**macOS Squirrel.Mac delegation** in `MacUpdater.ts`:
- `MacUpdater.ts:20` — `private readonly nativeUpdater: AutoUpdater = require("electron").autoUpdater`
- `MacUpdater.ts:146,150,235,238` — local HTTP proxy server that serves the downloaded file to Squirrel.Mac
- `MacUpdater.ts:250` — "on macOS both `onQuit` and `onNextLaunch` map to the same native behavior: Squirrel stages the update"
- `MacUpdater.ts:275` — "no deferred-install state is needed on macOS: Squirrel.Mac already stages the downloaded update natively"
- `MacUpdater.ts:278` — "quitAndInstall called with waitUntilNextLaunch: Squirrel.Mac stages updates natively, the staged update is applied on relaunch after quit"

### Claim 5 — Cache path on disk uses `baseCachePath` — **VERIFIED**

- `AppUpdater.ts:1200` — `const cacheDir = path.join(this.app.baseCachePath, dirName || this.app.name)`
- `BaseUpdater.ts:248` — `downloadedUpdateHelper = new DownloadedUpdateHelper(path.join(this.app.baseCachePath, dirName || this.app.name), this.log)`

`userDataPath` is used at `AppUpdater.ts:1146` only for `.updaterId` (the per-user updater ID file), not for update cache. Phase 1's "cache path = `baseCachePath` or `userDataPath`" was a union; the actual cache is on `baseCachePath`.

## Final verdict

**CONSISTENT.**

- HEAD SHA = Phase 1 SHA → source has not moved.
- All 5 claims independently re-grep-verified at HEAD.
- One nuance worth noting for the diff: NSIS args live in `NsisUpdater.ts`, not in the abstract base classes — Phase 1 should reflect that scope.
- The `AutoInstallEvent` is a TS string-literal union (`"manual" | "onQuit" | "onNextLaunch"`), not a `enum` keyword — semantically equivalent.
- Cache path is specifically `this.app.baseCachePath` (with `dirName || this.app.name` as the leaf); `userDataPath` is unrelated to update cache.
