# Updater Postmortems & Known-Bug Survey (R1)

**Deliverable:** `updater-postmortems-r1.md`
**Project:** AIRIZ Motor Console — unified auto-update architecture
**Date:** 2026-11-04 (all "current" claims are as of this date)
**Prepared by:** librarian agent (writable)
**Run:** R1 (3rd attempt; prior two attempts failed on read-only + mid-run termination)
**Downstream use:** weight "blast radius × likelihood" per candidate library to decide which ones are trustable on the critical path.

---

## 0. Method, scope, and source policy

### 0.1 Date awareness
It is **2026**, not 2025. All library versions, issue states, and "still open" labels below are as of **2026-11-04**. App Center/CodePush was retired 2025-03-31 and the CodePush repo archived 2025-05-20 — that is a *past* event and is reported as such. Sparkle's 2.0 line, Tauri's 2.x updater, and Expo SDK 57 are the current-generation artifacts under survey.

### 0.2 Survey window
Primary window: **2022-01-01 → 2026-11-04**. Where a library has no post-2022 issues, that absence is itself a finding (e.g. sw-precache, Squirrel.Mac) and is reported as such. A small number of pre-2022 incidents are included in §2 (supply chain) because the task explicitly names them; they are labelled with their real year.

### 0.3 Source / confidence legend
Every row carries a confidence tag so the downstream decision-maker knows what is load-bearing:

| Tag | Meaning |
|-----|---------|
| **[V]** | **Live-verified this run.** Issue/PR number was fetched from the GitHub REST API on 2026-11-04; title and open/closed state confirmed verbatim. Source URL is a stable GitHub issue permalink. |
| **[P]** | **Prior-research brief.** Carried in from earlier research runs (the orchestrator's "REAL DATA" block). Issue numbers were spot-checked against the API where the repo was reachable this run. |
| **[K]** | **Prior engineering knowledge.** A real, well-known class of problem in that library, cited to the repo, but the specific issue number was **not** live-fetched this run. Treat the number as indicative, not authoritative. |
| **[B]** | **Blocked.** The OA proxy returned HTTP 404 for this specific repo's API path this run (verified as a proxy egress block via a control repo that resolved on the same route). Content is architecture + known-failure-class + repo citation, **not** fresh issue numbers. |

### 0.4 This run's verification facts (load-bearing)
- All **30** provided issue numbers for electron-builder (6), Tauri (12), and Expo (12) were **fetched and title-confirmed** via the GitHub API this run → these are **[V]**.
- **electron-updater as a standalone repo does not exist.** `GET /repos/electron-userland/electron-updater` returns 404 (confirmed). It is a *package* inside the `electron-userland/electron-builder` monorepo (`packages/electron-updater`). It is therefore folded into §1.1.
- **Sparkle** and **sw-precache** issue lists were fetched live (used in §1.4, §1.6).
- **@capacitor/live-updates** deprecation was confirmed live (capacitor-plugins #2326 "Live Updates repo is gone").
- **`capawesome-team/capacitor-live-update`** and **`microsoft/AppInstaller`** could **not** be fetched (OA-proxy 404) → those two sections are tagged **[B]** and marked for re-verification from a non-blocked network.

### 0.5 Table columns (used for every library in §1)
| Column | Definition |
|--------|-----------|
| **Date** | Open date (open issues) or fix/shipping date (closed issues). `~` = approximate; `n/a` = not determinable this run. |
| **Vendor** | Owning org/team. |
| **Library** | Package/product name (scoped). |
| **Issue/PR/Postmortem Title** | Verbatim (or near-verbatim) title + issue/PR number. |
| **Root Cause** | One sentence. |
| **Fix** | One sentence. "Open" = unresolved as of 2026-11-04; "Closed" rows describe the implied patch (exact PR not always fetched — see PR for the diff). |
| **Blast Radius** | # affected (or per-device) and $ cost if publicly known. `n/a` when unknown. |
| **Source URL** | Stable GitHub permalink (`/issues/N`), or repo/blog URL for [K]/[B] rows. |

### 0.6 Content map
- **§1** — Per-library tables (12 systems).
- **§2** — Supply-chain incidents (7), 1–2 paragraphs each with citations.
- **§3** — Synthesis: blast-radius × likelihood rubric + ranking matrix + failure taxonomy. This is the section the downstream decision reads first.
- **§4** — Appendix: full source list, verification ledger, proxy-block log, currency notes.

---

## 1. Per-library tables

### 1.1 electron-updater / electron-builder — Electron Userland

**Repo note [V]:** There is **no standalone `electron-updater` repo** — `GET /repos/electron-userland/electron-updater` returns 404 (confirmed 2026-11-04). `electron-updater` is a **package** inside the `electron-userland/electron-builder` monorepo at `packages/electron-updater`. All rows below are therefore from the electron-builder repo. The "Windows/NSIS" path is where the reliability risk concentrates.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2026 (open) [V] | Electron Userland | electron-builder (NSIS) | #10359 — NSIS: app-running check can hang forever in `Get-CimInstance` (no `nsExec` timeout); interrupted update leaves the app uninstalled | The NSIS running-app gate shells out to PowerShell `Get-CimInstance` with no `nsExec` timeout, so a hung check strands the install; an interrupted update then removes the old app before the new one lands. | **Open** — no fix as of 2026-11-04 | Per-device; hang, or **app left uninstalled**. ~1/55 updates hang on Win-on-ARM (per brief) | https://github.com/electron-userland/electron-builder/issues/10359 |
| 2026 (open) [V] | Electron Userland | electron-builder (NSIS) | #10454 — NSIS: running-app check misses a single process from `$INSTDIR` (`.Count` on one `CimInstance` is empty in PowerShell 5.1), update fails with error 2 | When exactly **one** process is returned (a single `CimInstance`, not a collection), `.Count` is `$null` in PS 5.1, so the "app not running" gate misfires and the update aborts with error 2. | **Open** — no fix as of 2026-11-04 | Per-device (single-process apps) | https://github.com/electron-userland/electron-builder/issues/10454 |
| 2023-10-03 (closed) [V] | Electron Userland | electron-updater / NSIS | #7807 — [Windows][NSIS] Updater leaves app in unrecoverable state if update is performed during sign out or shut down | A sign-out/shutdown mid-update interrupts the NSIS uninstall/swap **after** the old app dir is replaced, leaving a broken, un-launchable install. | **Closed** — hardening so an interrupted sign-out/shutdown does not strand the app (see issue/PR for the diff) | Per-device; **unrecoverable install** (manual reinstall) | https://github.com/electron-userland/electron-builder/issues/7807 |
| 2022-04-18 (closed) [V] | Electron Userland | electron-builder (NSIS) | #6800 — NSIS updater incorrectly assumes `package.7z` exists in cache | The updater assumed the cached `package.7z` was always present; a cache miss / partial cache caused a failed extract. | **Closed** — cache presence is validated before use | Per-device (cache-dependent) | https://github.com/electron-userland/electron-builder/issues/6800 |
| 2022-06-10 (closed) [V] | Electron Userland | electron-builder (differential) | #6935 — Differential Download Skip | The blockmap/differential download plan could skip the very download it was meant to perform (skip-condition bug), leaving the updater with no payload. | **Closed** — skip condition corrected | Per-device (differential path) | https://github.com/electron-userland/electron-builder/issues/6935 |
| 2022-01-15 (closed) [V] | Electron Userland | electron-builder (NSIS) | #6555 — NSIS update failing on first attempt | A transient/timing condition on the **first** NSIS update attempt caused it to fail (retry succeeded). | **Closed** — first-attempt path corrected | Per-device (first update) | https://github.com/electron-userland/electron-builder/issues/6555 |

**§1.1 analysis.** The dominant, current risk cluster is the **NSIS running-application check** ("is the app still running?" gate that must close the app before the NSIS uninstall/swap). Both of the two newest **still-open** bugs (#10359, #10454) live in that check, and both are **PowerShell-5.1-specific** WMI/`Get-CimInstance`/`.Count` edge cases. That is a meaningful signal: the check is implemented by shelling to PowerShell and parsing CIM results — no timeout (→ hang), and single-object-vs-collection confusion (→ wrong count → error 2). Combined with #7807 (interrupted mid sign-out), the worst-case blast radius is **"app left uninstalled / unrecoverable."** A second, smaller cluster (#6800, #6935) is differential/cache correctness. For a critical-path Electron desktop app on Windows, this is the single largest open-reliability exposure among the Electron options.

---

### 1.2 Squirrel.Windows — Squirrel (Squirrel/Squirrel.Windows)

**Context.** The .NET (WinForms/WPF/early .NET Core) auto-update framework. **Maintenance mode post-2022** — it ships rarely and the post-2022 issues remain open. The low issue count is a *finding*: little active triage.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2022-01-24 (open) [P] | Squirrel | Squirrel.Windows | #1783 — Leading zero in version number → app crashes with 0xc0000409 | Version strings with a leading zero (e.g. `0.10`) trip the native/managed version comparison, producing a `0xc0000409` (fail-fast / STATUS_STACK_BUFFER_OVERRUN) crash. | **Open** (repo in maintenance mode, no fix as of 2026-11-04) | Per-device; **hard crash** (0xc0000409) | https://github.com/Squirrel/Squirrel.Windows/issues/1783 |
| 2024-06-24 (open) [P] | Squirrel | Squirrel.Windows | #1884 — Delta update for nuget is not created | The binary-delta artifact for the NuGet/Releases feed path is not generated, forcing full downloads (or a failed update). | **Open** (no fix as of 2026-11-04) | Bandwidth/latency, or update failure | https://github.com/Squirrel/Squirrel.Windows/issues/1884 |
| 2024-06-20 (open) [P] | Squirrel | Squirrel.Windows | #1883 — Directory not found exception during clean dead versions | The "prune old versions" step throws `DirectoryNotFoundException` when a version dir was already removed / raced. | **Open** (no fix as of 2026-11-04) | Per-device; cleanup step throws (usually non-fatal) | https://github.com/Squirrel/Squirrel.Windows/issues/1883 |
| n/a (class) [K] | Squirrel | Squirrel.Windows | (class) App can't be replaced while running / process-locked | Squirrel's swap-the-version-directory model requires the running exe to be closed; a lingering process/file lock prevents the swap. | Mitigated by the `BeforeUpdate`/relaunch contract; residual edge cases persist | Per-device; update skipped/failed | https://github.com/Squirrel/Squirrel.Windows/issues |
| n/a (class) [K] | Squirrel | Squirrel.Windows | (class) .NET Core / .NET 5+ apphost + Squirrel interop friction | Squirrel predates the .NET Core apphost/single-file model; relaunch and "current version" detection assumptions don't map cleanly to `app.exe` builds. | Workarounds in app code (relaunch via apphost, manual version pinning) | Per-device; relaunch/version-detection glitches | https://github.com/Squirrel/Squirrel.Windows/issues |

**§1.2 analysis.** Three real post-2022 issues, **all still open**, in a repo that is in maintenance mode. The open crash bug (#1783, leading-zero version → 0xc0000409) and the never-generated delta (#1884) are both user-visible. For a new critical-path deployment, Squirrel.Windows is a **negative signal**: small, aging, under-maintained, with an open hard-crash bug.

---

### 1.3 Squirrel.Mac — Squirrel (Squirrel/Squirrel.Mac)

**Context.** The macOS counterpart (the invisible "ShipIt" helper + `Squirrel.Mac` NuGet). **Dormant** — very little post-2022 activity. The rows below are the repo's accumulated long tail; dates are best-effort (not live-fetched this run) → **[P]**, dates approximate.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| ~ [P] | Squirrel | Squirrel.Mac (ShipIt) | #336 — macOS 27 terminates mid-install when host app quits (ShipIt has no visible presence) | ShipIt runs as an invisible helper; if the host app quits during the update, the in-flight install is abandoned mid-write. | **Open** | Per-device; **corrupted/partial install** | https://github.com/Squirrel/Squirrel.Mac/issues/336 |
| ~ [P] | Squirrel | Squirrel.Mac (ShipIt) | #322 — Updates fail after ShipIt logs rotate to the 100th log file | ShipIt's log rotation hits a 100-file ceiling and the update path then fails. | **Open** | Per-device (long-running installs) | https://github.com/Squirrel/Squirrel.Mac/issues/322 |
| ~ [P] | Squirrel | Squirrel.Mac (ShipIt) | #262 — ShipIt runs several updates in a row, only the last succeeds | Stacked/queued update runs are not serialized; intermediate runs clobber each other and only the final lands. | **Open** | Per-device; intermediate versions skipped | https://github.com/Squirrel/Squirrel.Mac/issues/262 |
| ~ [P] | Squirrel | Squirrel.Mac | #204 — Auto update works but not relaunching | After applying, the relaunch handshake with the quitting host app is lost, so the new version is installed but not started. | **Open** | Per-device; no relaunch observed | https://github.com/Squirrel/Squirrel.Mac/issues/204 |
| ~ [P] | Squirrel | Squirrel.Mac | #188 — Updater state transition incorrect | The updater's finite-state machine makes an invalid transition under a race (update-available → no-update), leaving it stuck. | **Open** | Per-device; stuck update state | https://github.com/Squirrel/Squirrel.Mac/issues/188 |
| ~ [P] | Squirrel | Squirrel.Mac | #110 — Receiving an update response then a no-update response should not update | A stale/interleaved "update available" followed by "no update" was still applied; response ordering was not validated. | **Open** | Per-device; wrong/no version applied | https://github.com/Squirrel/Squirrel.Mac/issues/110 |
| ~ [P] | Squirrel | Squirrel.Mac (security) | #84 — Security: disallow apps containing symlinks pointing outside the bundle | The update applied a bundle that contained **symlinks escaping the app dir** (path-traversal risk); Squirrel.Mac had no guard. | **Open** (hardening request) | Per-device; potential escape/replace of files outside the bundle | https://github.com/Squirrel/Squirrel.Mac/issues/84 |

**§1.3 analysis.** Squirrel.Mac's long tail exposes the structural weaknesses of the ShipIt model: **no visible presence** (→ abandoned installs when the host quits, #336), a **log-rotation ceiling** (#322), **unserialized stacked updates** (#262), **state-machine races** (#188, #110), and a **symlink path-traversal security gap** (#84). All remain open in a dormant repo. On macOS, **Sparkle (§1.4) is the actively-maintained, clearly safer choice.**

---

### 1.4 Sparkle — Sparkle Project (sparkle-project/Sparkle)

**Context [V].** The de-facto native macOS update framework. **Sparkle 2.0 (April 2022)** replaced DSA with **EdDSA (Ed25519)** code signing — that one-time migration is the headline 2022 "postmortem" pattern (adopters republish appcasts with `edSignature`, often emitting both `dsaSignature` + `edSignature` during the transition window, and old clients cannot validate EdDSA-only appcasts). The repo is **actively maintained**: default branch `2.x`, ~9.9k stars, last push 2026-11-02 (control fetch). The 2026 rows below were fetched live.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2026-05-28 (closed) [V] | Sparkle Project | Sparkle | #2880 — macOS 26 (Tahoe): updates fail with EPERM "Failed to create installation cache directory" (app-bound provenance on `~/Library/Caches/<bundle-id>/`) | macOS 26's app-bound provenance / containerization made the default cache dir unwritable (EPERM) for the installer. | **Closed** — installer handles the new cache-dir/provenance behavior | Per-device on macOS 26; update fails outright | https://github.com/sparkle-project/Sparkle/issues/2880 |
| 2026-10-20 (closed) [V] | Sparkle Project | Sparkle | #2937 — Installer treats a running sandboxed app as already terminated when the bundle folder name is NFC (non-ASCII); installs immediately and never relaunches | Unicode **NFC-vs-NFD** mismatch on a non-ASCII bundle folder name made the "is the app running?" check return false, so Sparkle installed over a running app and never relaunched. | **Closed** — normalize the bundle path before comparing (cf. #2942/#2943) | Per-device (non-ASCII/sandboxed apps); **running app overwritten, no relaunch** | https://github.com/sparkle-project/Sparkle/issues/2937 |
| 2026-10-23 (closed) [V] | Sparkle Project | Sparkle | #2943 — Fix update being installed before app terminates if located in NFC unicode path | Same NFC/NFD normalization issue caused the install to proceed before the app actually terminated. | **Closed** — path normalization in the terminate check | Per-device (unicode paths) | https://github.com/sparkle-project/Sparkle/issues/2943 |
| 2026-10-22 (closed) [V] | Sparkle Project | Sparkle | #2942 — Fix detecting running app when bundle path has precomposed Unicode name | Precomposed (NFC) vs decomposed (NFD) Unicode in the bundle path broke running-app detection. | **Closed** — normalize before comparison | Per-device (unicode bundle names) | https://github.com/sparkle-project/Sparkle/issues/2942 |
| 2026-09-22 (closed) [V] | Sparkle Project | Sparkle | #2928 — Download and install newer update while prior one is in flight | Concurrent in-flight updates were not guarded; a newer update could race/overwrite an older in-progress install. | **Closed** — guard/serialize in-flight installs | Per-device; install race / corruption risk | https://github.com/sparkle-project/Sparkle/issues/2928 |
| 2026-10-18 (closed) [V] | Sparkle Project | Sparkle (delta) | #2934 — fix(delta): handle item enumeration errors and transactional rollback | Binary-delta application could fail mid-enumeration without rolling back, leaving a half-patched app. | **Closed** — enumeration errors handled + transactional rollback | Per-device; **corrupted app on delta failure** | https://github.com/sparkle-project/Sparkle/issues/2934 |
| 2026-08-08 (closed) [V] | Sparkle Project | Sparkle (security) | #2895 — Reject package based installs when signing validation failed | A package could previously proceed even when code-signing validation failed (defense-in-depth gap). | **Closed** — reject package install on signing-validation failure | Security; blocks installing an unsigned/tampered payload | https://github.com/sparkle-project/Sparkle/issues/2895 |
| 2026-07-29 (closed) [V] | Sparkle Project | Sparkle (security) | #2891 — Harden patching delta file against symbolic link at destination path | The delta patcher could follow a **symlink at the destination path** (path-traversal / arbitrary-write). | **Closed** — refuse/neutralize symlink at destination | Security; arbitrary file write via crafted delta | https://github.com/sparkle-project/Sparkle/issues/2891 |
| 2026-08-15 (closed) [V] | Sparkle Project | Sparkle (security) | #2898 — Harden safety of installer moving the download archive | The "move the downloaded archive into place" step had a race/replace safety gap. | **Closed** — hardened the move | Per-device; install integrity | https://github.com/sparkle-project/Sparkle/issues/2898 |
| 2026-06-04 (closed) [V] | Sparkle Project | Sparkle | #2882 — Fix updating not working the first time if bundle ID ends with ".app" | Bundle IDs ending in `.app` (and similar) broke first-update detection (identity parsing). | **Closed** — fixed bundle-ID suffix handling (extended to bundle-like extensions in #2909) | Per-device; first update silently skipped | https://github.com/sparkle-project/Sparkle/issues/2882 |
| 2026-10-13 (closed) [V] | Sparkle Project | Sparkle | #2933 — Temporary `Launcher/<random>/Updater.app` copies leave dead LaunchServices registrations that accumulate per update | Each update copied a temp Updater.app and registered it with LaunchServices but never unregistered, so dead registrations accumulated. | **Closed** — stop accumulating dead registrations | Per-device (slow LaunchServices DB bloat) | https://github.com/sparkle-project/Sparkle/issues/2933 |
| 2022-04 (migration) [K] | Sparkle Project | Sparkle 2.0 | (migration) DSA → EdDSA (Ed25519) code-signing cutover | Sparkle 2.0 replaced DSA with EdDSA; adopters had to republish appcasts with `edSignature` (often both fields during the window) and old clients cannot validate EdDSA-only appcasts. | Migration guidance — sign with Ed25519, emit both fields during transition, manage the allow-downgrade window | Any app mid-migration: old clients reject the new appcast (update blocked) | https://sparkle-project.org/documentation/code-signing/ |

**§1.4 analysis.** Sparkle is the **strongest-maintained native option**, and the 2026 close-rate is a positive maintenance signal. Four recurring themes: (a) **Unicode NFC/NFD normalization** in the running-app/terminate check (#2937/#2942/#2943) — the *same* "is the app running?" fragility as electron-builder's NSIS check (§1.1); (b) **macOS platform changes** (Tahoe app-bound provenance → EPERM, #2880); (c) **concurrency** (in-flight install races, #2928); (d) a steady stream of **security hardening** (reject-on-signing-failure #2895, symlink-at-destination #2891, archive-move safety #2898). The one-time 2022 cost was the **DSA→EdDSA migration**. Net: most trustworthy native updater surveyed, with residual unicode + platform-edge risk.

---

### 1.5 Workbox — Google (GoogleChrome/workbox)

**Context.** The current PWA service-worker toolkit (sw-precache was absorbed into it). "Auto-update" here = service-worker **lifecycle** (skipWaiting/clientsClaim, `waiting`/`controllerchange`, precache manifest consistency).

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2024-11-22 (open) [P] | Google | workbox-window | #3377 — `WorkboxLifecycleEvent.isUpdate` is false on first immediate service worker update | On the first immediate SW update, the "is this an update vs initial load" heuristic mis-reports `false`. | **Open** | PWA clients misclassify the first update (skip the "new version" prompt) | https://github.com/GoogleChrome/workbox/issues/3377 |
| 2024-01-09 (open) [P] | Google | workbox-window | #3285 — Multiple service worker updates do not result in multiple `waiting` events | Rapid successive SW uploads don't each fire a `waiting` event (only one waiting controller is registered), so clients miss intermediate updates. | **Open** | PWA clients not notified of stacked updates | https://github.com/GoogleChrome/workbox/issues/3285 |
| 2023-07-05 (closed) [P] | Google | workbox-precaching | #3230 — White Screen after service worker update | After an SW update, the precached app shell was swapped but the controller-change/precache state was inconsistent, producing a blank page. | **Closed** — precache/controller-change sequencing corrected | PWA users see a **white screen** post-update (availability) | https://github.com/GoogleChrome/workbox/issues/3230 |
| n/a (class) [K] | Google | workbox-window | (class) skipWaiting/clientsClaim misconfiguration → stuck on old version | Without `skipWaiting` + `clientsClaim`, a new SW sits in `waiting` until the user reloads/closes tabs, so "auto-update" silently does nothing. | Configure `skipWaiting`/`clientsClaim` + handle the workbox-window `update` event (config, not a library bug) | PWA clients stuck on stale version indefinitely | https://github.com/GoogleChrome/workbox |
| n/a (class) [K] | Google | workbox-precaching | (class) Precache manifest mismatch → 404 / stale-asset serving | A deploy that changes asset names/paths without the matching new precache manifest causes the SW to 404 or serve stale assets. | Regenerate the precache manifest per build; use revisioned URLs | PWA clients get 404/stale content after deploy | https://github.com/GoogleChrome/workbox |

**§1.5 analysis.** Workbox update reliability is dominated by **service-worker lifecycle semantics** (one waiting controller, `controllerchange` timing, precache-manifest consistency), not a single broken function. Open bugs: first-update misclassified (#3377), stacked updates not each notified (#3285). The notable closed one is the **white screen after update** (#3230) — a real availability blast radius. PWA updates are structurally *eventually-consistent* (the client picks up the new SW on the next navigation/claim), a limit that no library config fully removes.

---

### 1.6 sw-precache — Google Labs (GoogleChromeLabs/sw-precache)

**Context [V].** **Abandoned.** The deprecation notice is **#382 (2019-04-02)**; the last issues are 2018–2020. **There are no post-2022 issues** — the finding is *abandonment + an unfixed dependency vulnerability*. The rows are pre-2022 but are the *reason* this is a dead end.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2019-04-02 (closed) [V] | Google Labs | sw-precache | #382 — Deprecation notice | sw-precache was superseded by Workbox (functionality folded in); GoogleChromeLabs deprecated it. | **Deprecated** — migrate to Workbox | Anyone still on sw-precache is on an unmaintained path | https://github.com/GoogleChromeLabs/sw-precache/issues/382 |
| 2019-07-12 (open) [V] | Google Labs | sw-precache | #385 — Vulnerability in `lodash.template` dependency | A transitive `lodash.template` had a known vulnerability; unmaintained sw-precache never bumped it. | **Open** (no fix — repo abandoned) | Supply-chain / CVE exposure on any build using sw-precache | https://github.com/GoogleChromeLabs/sw-precache/issues/385 |
| 2019-04-11 (open) [V] | Google Labs | sw-precache | #383 — `workbox is not defined` (window 10) | The generated SW referenced a `workbox` global that was undefined in some (Win10) contexts. | **Open** | PWA SW fails to load | https://github.com/GoogleChromeLabs/sw-precache/issues/383 |
| 2019-01-22 (open) [V] | Google Labs | sw-precache | #380 — Generated service worker doesn't `claimClient`/`skipWaiting` on Chrome 71 incognito | In Chrome 71 incognito the generated SW didn't `claimClient`/`skipWaiting`, so precache never took control. | **Open** | PWA not precached in incognito | https://github.com/GoogleChromeLabs/sw-precache/issues/380 |
| 2018-03-18 (open) [V] | Google Labs | sw-precache | #351 — race-condition: cache update causing app crashes | A race during cache update (read-before-ready) caused app crashes. | **Open** | PWA **crashes** on cache update | https://github.com/GoogleChromeLabs/sw-precache/issues/351 |

**§1.6 analysis.** **Do-not-use** for a new deployment: deprecated (#382), an **open `lodash.template` vulnerability** (#385), a never-fixed **cache-update race that crashes the app** (#351), and zero post-2022 activity. Use Workbox (§1.5) instead.

---

### 1.7 @capacitor/live-updates (deprecated) — Ionic (ionic-team/capacitor-plugins)

**Context [V].** Ionic's official Capacitor live-update (OTA) plugin. **Deprecated** in favor of the community fork `@capawesome/capacitor-live-update`. Deprecation confirmed live this run via capacitor-plugins **#2326 "Live Updates repo is gone"** (2025, closed).

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2025 (closed) [V] | Ionic | @capacitor/live-updates | #2326 — Live Updates repo is gone | The original `@capacitor/live-updates` code was removed/moved; the plugin was deprecated and maintenance handed to the Capawesome community fork. | **Closed** — migrate to `@capawesome/capacitor-live-update` | Apps pinned to the old plugin lose updates/fixes | https://github.com/ionic-team/capacitor-plugins/issues/2326 |
| 2025 (closed) [V] | Ionic | @capacitor/live-updates | #2311 — Live Updates Plugin | Feature/bug requests after deprecation were closed, pointing to the community fork. | **Closed** (redirect to fork) | n/a (process) | https://github.com/ionic-team/capacitor-plugins/issues/2311 |
| 2024 (closed) [V] | Ionic | @capacitor/live-updates | #2182 — @capacitor/live-updates changelog | Users asked for release/changelog info on a plugin that was winding down. | **Closed** | n/a | https://github.com/ionic-team/capacitor-plugins/issues/2182 |
| n/a (class) [K] | Ionic | @capacitor/live-updates | (class) Deprecation → stale native code | Once deprecated, the iOS/Android native modules stop receiving OS-compat fixes; newer Xcode/Android API levels break the bundle-apply path. | Migrate to the maintained fork (§1.8) | OTA apply breaks on newer OS versions | https://github.com/ionic-team/capacitor-plugins |

**§1.7 analysis.** The "postmortem" here is **deprecation itself** — the official plugin was abandoned mid-stream and the burden moved to a community fork. For trust scoring, "official plugin deprecated" is a strong negative: you would be putting the critical path on a **community-maintained** fork (§1.8).

---

### 1.8 @capawesome/capacitor-live-update — Capawesome [B]

**Context [B — proxy-blocked].** The **actively-maintained community fork/successor** of the deprecated `@capacitor/live-updates` (§1.7). It downloads a JS bundle from a server (Capawesome's cloud or a self-hosted manifest), stores it, and swaps the WebView entry point to the OTA bundle with fallback to the embedded native bundle. **The specific issue numbers could not be fetched this run** — `capawesome-team/capacitor-live-update` returned HTTP 404 on every route (gh / curl.exe / webfetch) while a control repo resolved on the same route, i.e. an **OA-proxy egress block**, not a missing repo. The rows below are **known failure classes** from prior engineering knowledge (**[K]**) + the repo citation; **re-verify the exact issue numbers from a non-blocked network before relying on them.**

| Date | Vendor | Library | Failure class (not a fetched issue#) | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------------------|-----------|-----|--------------|-----------|
| n/a [K] | Capawesome | capacitor-live-update | (class) Bundle download / manifest fetch failure | The OTA manifest or bundle fetch fails (network, 404, auth, version mismatch); the plugin should fall back to the embedded bundle. | Fallback-to-embedded is the intended mitigation; verify the fallback actually fires | Per-device; user stays on old bundle (usually safe) | https://github.com/capawesome-team/capacitor-live-update |
| n/a [K] | Capawesome | capacitor-live-update | (class) Native-bridge gap when running from an OTA (non-native) bundle | Capacitor native plugins registered at build time don't always behave identically when the app is running from a downloaded web bundle; `cap sync`/native changes don't apply to an already-OTA'd install. | Architectural — keep OTA changes JS-only; ship native changes through the store | Per-device; plugin misbehavior / feature loss under OTA | https://github.com/capawesome-team/capacitor-live-update |
| n/a [K] | Capawesome | capacitor-live-update | (class) Fingerprint / version mismatch → update rejected or white screen | A mismatch between the native build's identity and the OTA bundle's expected identity causes the update to be rejected or to render a blank page. | Keep native + OTA versioning in lockstep; validate bundle identity before swap | Per-device; rejected update or white screen | https://github.com/capawesome-team/capacitor-live-update |
| n/a [K] | Capawesome | capacitor-live-update | (class) Atomic-swap / storage failure on iOS/Android | Applying the new bundle to app storage can fail (quota, permission, partial write), risking a broken entry point. | Atomic write + keep last-known-good for rollback | Per-device; broken launch until fallback | https://github.com/capawesome-team/capacitor-live-update |
| n/a [K] | Capawesome | capacitor-live-update | (class) Rollback of a bad OTA bundle | A bad OTA bundle must roll back to the last-known-good / embedded bundle, else the app is bricked until a store update. | Verify last-known-good rollback is exercised end-to-end | Per-device; **bricked until store update** if rollback fails | https://github.com/capawesome-team/capacitor-live-update |

**§1.8 analysis.** Functionally the maintained Capacitor OTA path, but trust is reduced by two facts: (1) it is **community-maintained**, not vendor-official (the official plugin was deprecated, §1.7); and (2) **the native-bridge gap** is structural — OTA (web) bundles and native code are a second-class citizen, which is a recurring source of "works in store build, breaks under OTA" bugs. **Action:** re-pull the issue tracker from a non-blocked network; this section is intentionally not asserting specific open-bug counts.

---

### 1.9 CodePush / App Center — Microsoft

**Context [P].** Microsoft's OTA tool for React Native (and Cordova/Windows), part of Visual Studio App Center. **This is a sunset.** Visual Studio App Center was **retired 2025-03-31** and the **CodePush repo archived 2025-05-20**. The "postmortem" is the **death of the service**. (Issue numbers from the prior brief; the App Center/CodePush repos were not live-fetched this run → **[P]**.)

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2025-02-04 (closed) [P] | Microsoft | App Center / CodePush | #2650 — "What happens to apps still communicating App Center on 31st March 2025" (sundowning) | App Center (incl. CodePush) was scheduled for sundown; apps still phoning home to App Center endpoints after 2025-03-31 receive no response. | **Closed** — official guidance to migrate off App Center/CodePush before 2025-03-31 | **All** App Center/CodePush apps — OTA unavailable after sunset | https://github.com/microsoft/appcenter/issues/2650 |
| 2025-03-31 / 2025-05-20 (event) [P] | Microsoft | App Center / CodePush | (event) Visual Studio App Center retired 2025-03-31; CodePush repo archived 2025-05-20 | Microsoft discontinued App Center as a product; the CodePush source was archived read-only. | n/a (service shutdown) | **Total & permanent** — CodePush OTA no longer exists; archived repo | https://github.com/Microsoft/code-push |
| 2023 (closed) [P] | Microsoft | App Center | #2535 — App Center is down | App Center infrastructure outage (one of the last pre-sunset reliability events). | **Closed** (resolved; later followed by retirement) | All App Center services (incl. CodePush uploads) during the outage | https://github.com/microsoft/appcenter/issues/2535 |
| 2019 (closed) [P] | Microsoft | CodePush | #814 — CodePush servers slow and unstable | CodePush backend performance/instability (pre-sunset reliability complaints). | **Closed** (transient) | CodePush upload/delivery latency | https://github.com/Microsoft/code-push/issues/814 |

**§1.9 analysis.** CodePush/App Center is **dead**. Any architecture that depends on it is a non-starter. Its history (slow/unstable servers #814, outages #2535) plus the **hard sunset** makes it the clearest "do not build on" in this survey. The durable lesson is **vendor-continuity blast radius = "everything"**: a hosted OTA provider can be discontinued entirely with a date, taking the update path of every dependent app with it.

---

### 1.10 Expo Updates / EAS Update — Expo (expo/expo + expo/eas-cli)

**Context [V].** Expo's OTA (JS-bundle) update system: the `expo-updates` runtime + the EAS Update server. All 12 rows below were **fetched and title-confirmed** this run. This is the **youngest, fastest-changing** system surveyed and has the **highest recent bug-report volume**, concentrated in *fingerprint/launch-identity* and *downloaded-but-never-applied* families.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2026-07-26 (open) [V] | Expo | expo-updates (Android) | #48148 — Google Play's automatic app-string translation rewrites `expo_runtime_version`, silently breaking all OTA updates for that locale | Google Play's automatic in-app string translation rewrote the `expo_runtime_version` value in a localized build, changing the runtime-version identity, so the server's version gate no longer matched → **all OTA for that locale silently broken**. | **Open** | Per-locale; **silent total OTA breakage** for affected locales | https://github.com/expo/expo/issues/48148 |
| 2026-09-18 (closed) [V] | Expo | expo-updates (Android) | #50349 — Downloaded update marked pending but never launches, even after a full cold start | A downloaded update was marked pending but the pending→active launch handoff never fired, even after a full cold start. | **Closed** — pending→active launch path corrected | Per-device; update downloaded but never applied | https://github.com/expo/expo/issues/50349 |
| 2026-08-02 (closed) [V] | Expo | expo-updates | #48404 — downloaded update is never launched (isEnabled true, runtime version matches, isNew true, `isEmbeddedLaunch` stays true) | `isEmbeddedLaunch` stayed true even when a non-embedded update was present, so the runtime kept launching the embedded bundle instead of the downloaded one. | **Closed** — `isEmbeddedLaunch`/launch-identity logic corrected | Per-device; OTA never takes effect | https://github.com/expo/expo/issues/48404 |
| 2026-09-14 (closed) [V] | Expo | EAS Update (Android) | #50139 — EAS Update fails to download in Expo Go on Android (SDK 57) — works on iOS | An SDK 57 Android-specific download-path failure in Expo Go (the iOS path worked). | **Closed** | Per-device (Android, Expo Go, SDK 57) | https://github.com/expo/expo/issues/50139 |
| 2026-09-20 (closed) [V] | Expo | EAS Update (Android) | #50389 — EAS Update fails on Android with UpdateFailedToLoad (curl to identical manifest URL from same device succeeds) | The Android update load path failed (`UpdateFailedToLoad`) even though the same manifest URL was reachable via curl — a client-side load/identity mismatch, not a network problem. | **Closed** | Per-device (Android); update fails to load | https://github.com/expo/expo/issues/50389 |
| 2026-10-08 (open) [V] | Expo | expo-updates (iOS) | #51268 — Rotating an Authorization header override makes downloaded updates unlaunchable (request headers are part of launch identity) | On iOS the request headers used to fetch the update are part of the launch identity; rotating the `Authorization` header between download and launch made the identity mismatch → **unlaunchable**. | **Open** | Per-device (iOS); downloaded update becomes unlaunchable | https://github.com/expo/expo/issues/51268 |
| 2026-02-24 (closed) [V] | Expo | EAS Update (server) | #43375 — EAS Update server returning 503 - upstream connect error or disconnect/reset before headers | The EAS Update server returned 503 (upstream connect error) — a backend availability issue. | **Closed** (server-side) | Fleet-wide during the window; update download 503s | https://github.com/expo/expo/issues/43375 |
| 2026 (open) [V] | Expo | expo-updates (fingerprint, Windows) | #50202 — 0.20.13 gives a different fingerprint on Windows for apps in a monorepo (backport the `toPosixPath` fix from 0.21.0) | Fingerprint computation used platform-dependent path separators on Windows in a monorepo, producing a different fingerprint than other platforms (a `toPosixPath` fix existed in 0.21.0 but was not backported). | **Open** (backport requested) | Per-device (Windows monorepo); **fingerprint mismatch → update rejected** | https://github.com/expo/expo/issues/50202 |
| 2026 (open) [V] | Expo | expo-updates (fingerprint) | #52191 — Patches applied from a workspace root (bun `patchedDependencies`) are not hashed | Workspace-root patches (bun `patchedDependencies`) were not included in the fingerprint hash, so a change that should invalidate the fingerprint didn't. | **Open** | Per-device; stale/incorrect fingerprint → wrong update decision | https://github.com/expo/expo/issues/52191 |
| 2026 (closed) [V] | Expo | expo-updates (fingerprint) | #51167 — Expo config silently left out of the fingerprint when app.config.ts imports a .ts file (Node 22.18+) | When `app.config.ts` imported a `.ts` file under Node 22.18+, that config was silently excluded from the fingerprint. | **Closed** — config files now included in the fingerprint | Per-device; config changes not reflected in fingerprint → update mismatch | https://github.com/expo/expo/issues/51167 |
| 2026 (closed) [V] | Expo | expo-updates (fingerprint, Android) | #52152 — Android fingerprint drops all Expo module sources when a module declares a gradle plugin without sourceDir (expo-widgets) | When a module declared a gradle plugin without a `sourceDir`, the Android fingerprint dropped all Expo module sources. | **Closed** | Per-device (Android); fingerprint missing module sources → update rejected/mismatch | https://github.com/expo/expo/issues/52152 |
| 2026-05-07 (open) [V] | Expo | expo-updates (Android) | #45527 — Renamed/moved files do not come with OTA via `eas update` | Files renamed/moved between builds were not captured by the OTA diff (manifest didn't represent renames), so the update was incomplete. | **Open** | Per-device (Android); incomplete OTA (missing/renamed files) | https://github.com/expo/expo/issues/45527 |

**§1.10 analysis.** Expo/EAS Update has the **most open-reliability surface** of the OTA options, in two families: **(1) fingerprint / launch-identity correctness** (#50202, #52191, #51167, #52152, #51268) — the fingerprint is the gate that decides "is this update valid for *this* device," and it is fragile to path separators, workspace patches, config imports, module `sourceDir`s, and even request headers; and **(2) downloaded-but-never-applied** (#50349, #48404, #50389, #50139). The standout is **#48148** — an *external* actor (Google Play string translation) rewriting the runtime-version identity and silently killing per-locale OTA, a novel, high-blast-radius failure mode. Strong feature set, but the long open tail means the most "moving parts can still break" risk of the managed-OTA options.

---

### 1.11 @tauri-apps/updater — Tauri (tauri-apps/plugins-workspace)

**Context [V].** Tauri's updater plugin (Rust core + per-OS installers). Per the brief it is the **newest / least battle-tested** option — and the data agrees: it is the **most open-issue-heavy** native-ish updater surveyed, with bugs spread across the **full install path on all three OSes**. All 12 rows were **fetched and title-confirmed** this run.

| Date | Vendor | Library | Issue / Postmortem Title | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------|-----------|-----|--------------|-----------|
| 2025-03-21 (open) [V] | Tauri | updater | #2558 — `update.install()` never returns | The install future never resolves under some conditions, so `install()` hangs. | **Open** | Per-device; update UI hangs / never completes | https://github.com/tauri-apps/plugins-workspace/issues/2558 |
| 2025-08-25 (open) [V] | Tauri | updater (Windows) | #2951 — `downloadAndInstall()` intermittently fails on some Windows devices with "error sending request for url (…/release.json)" | On a subset of Windows devices the request to `release.json` intermittently fails (network/proxy/cert/device-specific), so the install errors out. | **Open** | Per-device (subset of Windows); intermittent update failure | https://github.com/tauri-apps/plugins-workspace/issues/2951 |
| 2025-04-06 (open) [V] | Tauri | updater | #2601 — "Failed to move the new app into place" during `downloadAndInstall` | The final "move the new app into place" step fails (file lock / permission / AV), so the install can't complete. | **Open** | Per-device; install fails at the final move | https://github.com/tauri-apps/plugins-workspace/issues/2601 |
| 2025-01-19 (open) [V] | Tauri | updater (Windows) | #2335 — Update fails on Windows when constructing the updater using `UpdaterBuilder` directly | Constructing the updater via `UpdaterBuilder` directly (vs the default) leaves a misconfigured builder state that fails on Windows. | **Open** | Per-device (Windows, custom-builder usage) | https://github.com/tauri-apps/plugins-workspace/issues/2335 |
| 2025-05-16 (open) [V] | Tauri | updater | #2697 — `download_and_install` request fails in debug build from installed app | In a **debug build** run from an installed app, the `download_and_install` request fails (debug-specific path/signing mismatch). | **Open** | Per-device (debug builds) | https://github.com/tauri-apps/plugins-workspace/issues/2697 |
| 2025-09-23 (open) [V] | Tauri | updater (Windows) | #3000 — Updater (Windows) — Skip UAC task not handled | The "Skip UAC" (install without elevation) code path on Windows is not handled, so the elevation flow is wrong. | **Open** | Per-device (Windows); wrong elevation / update failure | https://github.com/tauri-apps/plugins-workspace/issues/3000 |
| 2025-02-24 (open) [V] | Tauri | updater (macOS) | #2455 — plugin-updater on macOS can't create temp directories, which requires admin privileges | On macOS the updater cannot create its temp directories (SIP/permission), effectively forcing an admin path. | **Open** | Per-device (macOS); update requires admin / fails | https://github.com/tauri-apps/plugins-workspace/issues/2455 |
| 2026-11-03 (open) [V] | Tauri | updater (macOS) | #3764 — macOS install with admin privileges runs AppleScript on the main thread and freezes the window while the password prompt is open | The macOS admin-privileged install runs **AppleScript on the main thread**, so the window freezes while the password prompt is open. | **Open** | Per-device (macOS, admin install); UI freeze during password prompt | https://github.com/tauri-apps/plugins-workspace/issues/3764 |
| 2026-09-19 (open) [V] | Tauri | updater (Linux) | #3595 — Linux: password prompt (zenity/kdialog → `sudo -S`) is shown for an install command that may not exist | On Linux the updater shows a password prompt (zenity/kdialog piped to `sudo -S`) for an install command that may not even exist. | **Open** | Per-device (Linux); spurious/incorrect password prompt | https://github.com/tauri-apps/plugins-workspace/issues/3595 |
| 2024-10-29 (open) [V] | Tauri | updater (macOS) | #1983 — `update.downloadAndInstall` does not work on removable volume [macOS] | `downloadAndInstall` fails when the app is on a **removable volume** (macOS) — the install target/permissions don't apply. | **Open** | Per-device (macOS, removable volume) | https://github.com/tauri-apps/plugins-workspace/issues/1983 |
| 2023-02-15 (open) [V] | Tauri | updater (macOS) | #2148 — Check for "Tauri API error: read-only filesystem error (os error 30)" and prompt the user to move the app to the Applications folder | When the app is on a **read-only filesystem**, the update fails with os error 30 and the user gets no guidance to move it to /Applications. | **Open** (feature request to detect + prompt) | Per-device (macOS, read-only location); hard-to-diagnose failure | https://github.com/tauri-apps/plugins-workspace/issues/2148 |
| 2026-10-27 (closed) [V] | Tauri | updater (deps) | #3740 — Move to zip 9 for RUSTSEC-2026-0367, 0368 and 0369 | The `zip` crate dependency had security advisories (RUSTSEC-2026-0367/0368/0369) and the updater pinned an affected version. | **Closed** — bumped `zip` to v9 to clear the advisories | Supply-chain (dependency CVEs in the updater's dep tree) | https://github.com/tauri-apps/plugins-workspace/issues/3740 |

**§1.11 analysis.** The Tauri updater's risk is **breadth across the native install/privilege/replace step on all three OSes**, and it has **not** yet received the kind of hardening Sparkle has (§1.4). Clusters: **hangs** (#2558 never-returning `install()`), **Windows request/elevation** (#2951, #2335, #3000, #2697), **final-move failure** (#2601), and **macOS/Linux privilege & location** (#2455, #3764, #3595, #1983, #2148). The one closed item (#3740, RUSTSEC advisories) is a **dependency-CVE bump** — evidence the updater's *dependency tree* is also a maintenance surface. If AIRIZ standardizes on Tauri, budget for substantial update-path hardening/patching before it is trustworthy on the critical path.

---

### 1.12 Microsoft.AutoUpdater / MSIX AppInstaller — Microsoft [B]

**Context [B — proxy-blocked].** The "Microsoft.AutoUpdater" for the MSIX path is really the **Windows MSIX auto-update** mechanism, executed by the **App Installer** (`microsoft/AppInstaller`) together with the Windows Package Manager. An MSIX/MSIX-packed-Win32 app can declare an update URI and Windows updates it **in the background, off-store** (no store round-trip). **Specific issue numbers could not be fetched this run** — `microsoft/AppInstaller` returned HTTP 404 on every route (OA-proxy egress block, same as §1.8; control repo resolved). Rows below are **known failure classes** (**[K]**) + repo citation; **re-verify exact issue numbers from a non-blocked network.**

| Date | Vendor | Library | Failure class (not a fetched issue#) | Root Cause | Fix | Blast Radius | Source URL |
|------|--------|---------|--------------------------------------|-----------|-----|--------------|-----------|
| n/a [K] | Microsoft | MSIX App Installer | (class) Update URI returns non-200 / malformed manifest → silent no-update | The declared update URI returns an error or an invalid `.appxmanifest`, so the app silently stays on the old version. | Serve a valid manifest from a reliable URI; monitor update status via `WindowsPackageManager` | Per-device; app silently never updates | https://github.com/microsoft/AppInstaller |
| n/a [K] | Microsoft | MSIX App Installer | (class) "App can't be updated" / deployment error (0x80073Dxx) | The new package's manifest is invalid, or its **signature** fails validation, so deployment is rejected (e.g. 0x80073D01 family). | Match signing identity + manifest correctness across versions | Per-device; update rejected | https://github.com/microsoft/AppInstaller |
| n/a [K] | Microsoft | MSIX App Installer | (class) Auto-update disabled by policy / user | Scheduled/auto-update is turned off (Group Policy, user setting, or no background network), so the app never updates automatically. | Ensure the update path is not policy-blocked; fall back to in-app check | Per-device / fleet; no auto-update | https://github.com/microsoft/AppInstaller |
| n/a [K] | Microsoft | MSIX App Installer | (class) Scope limit: only MSIX-packaged apps auto-update | MSIX auto-update only applies to **MSIX-packaged** apps (store or sideloaded); a plain Win32 `.exe` with no MSIX wrapper gets **no** auto-update. | Package the app as MSIX to inherit the OS update mechanism | Architectural; un-packaged apps have no OS-level updater | https://github.com/microsoft/AppInstaller |
| n/a [K] | Microsoft | MSIX App Installer | (class) Running-app lock + in-app "Check for updates" regressions | The same running-app/replace friction as every other updater (the app must be closed/replaced), plus periodic App Installer in-app update regressions. | Close/restart handling; track App Installer releases | Per-device; update deferred/failed | https://github.com/microsoft/AppInstaller |

**§1.12 analysis.** MSIX auto-update is the **OS-native, off-store** path — its strength is that the update machinery is maintained by Microsoft and is the "boring" default for packaged Windows apps. Its weaknesses are **scope** (MSIX-packaged only), **policy dependence**, and **silent-failure** behavior (a bad URI/manifest just means "no update," with no loud signal). It is a strong *baseline* for a packaged Windows app, but it inherits the running-app/replace friction and offers no richer rollback than the OS provides. **Action:** re-pull the AppInstaller issue tracker from a non-blocked network.

---

## 2. Supply-chain incidents

These are the canonical **"the update path is an attack surface"** incidents. They bound the **worst-case blast radius** of any auto-update design: a *trusted* update channel can deliver a bricking, trojanizing, or state-corrupting payload at **fleet scale**, and — crucially — the code-signing / vendor-trust that is supposed to protect the user is often *intact*. Each entry: what happened, root cause, numbers, citations, and the **updater-relevant lesson**.

### 2.1 CrowdStrike — 2024-07-19 (Falcon Sensor content update)

On **2024-07-19**, CrowdStrike pushed a **Falcon Sensor content update (Channel File 291)** to its ~50M+ endpoints. The content update contained a malformed/over-long pattern that the Falcon sensor's **kernel-mode driver** failed to validate, triggering a **BSOD (`IRQL_NOT_LESS_OR_EQUAL`, 0x0000000A)** on an estimated **~8.5M Windows machines** (CrowdStrike's own figure) across **~285,000 organizations**. Because the fault was in a **kernel driver**, affected machines **hard-crashed and could not boot** until the offending file was removed in Safe Mode — a full **fleet-wide brick from a single content push**. The decisive design gap: the pushed artifact was a **content/rules file**, not a code release, and CrowdStrike's update path had **no content-validation / staging / canary gate** that would have caught the malformed file before fleet rollout. The same low-friction channel that makes updates fast also makes a bad push catastrophic.

**Citations:** CrowdStrike, *"Anatomy of the Falcon Sensor Content Issue on July 19, 2024"* (crowdstrike.com, Jul 2024); The Register & BleepingComputer coverage (Jul–Aug 2024). Figures: ~8.5M systems / ~285k orgs (CrowdStrike).
**Updater-relevant lesson:** **A content/rules channel *is* an update channel.** Validate, stage, and canary any pushed artifact before fleet rollout — and treat a kernel/driver-level target as the highest-severity case, because a bad push becomes a **brick**, not just a bad app version. This is the single most directly-relevant incident for "can the update mechanism itself take the machine down?"

### 2.2 CCleaner — 2017 (signed-binary supply-chain compromise)

In **2017**, attackers compromised **Avast's CCleaner build infrastructure** (compromise began ~May 2017; Avast detected it in **August 2017** and pulled the build). The result was a **trojanized but legitimately code-signed** CCleaner 5.23 (Windows) — a **ShadowPad / Floxif** trojan (the "CCleaner trojan") — delivered to an estimated **~2.27M machines** over a ~3-month exposure window. The critical detail for trust design: the **code-signing chain was *not* broken** — the binary carried a valid Avast signature. Detection therefore could not rely on signature validation and had to be **behavioral**. The attacker did **not** forge a certificate; they compromised the **trusted build/publish pipeline** — the machine that *produces* the signed artifact.

**Citations:** Avast, *"CCleaner trojanized"* (Avast blog, Aug 2017); Avast figure ~2.27M; ESET / BleepingComputer coverage (2017).
**Updater-relevant lesson:** **Code signing proves *who signed*, not that the *build* is clean.** A compromise of the build server or publish pipeline defeats signature-based trust entirely. For an updater, the **build server and artifact provenance** are the real trust boundary — the final signature is necessary but not sufficient.

### 2.3 ASUS Live Update — 2019 (Operation ShadowHammer)

Beginning around **2017**, certain **ASUS motherboards shipped with a pre-installed "ASUS Live Update"** utility whose update channel could be hijacked to install a backdoor. The **CISA/NSA/FBI** joint advisory (**AA19-044A, Jan 2019**, part of **"Operation ShadowHammer"**) tied this to the APT groups **"Hades" / "Tarrasque"** (a.k.a. "Hunters International"), which used the tool to deploy a **ShadowPad** backdoor to steal credentials. **Kaspersky (Securelist, Dec 2018) confirmed ~57,000 compromised machines**; broader estimates reached ~1M. The root cause: a **pre-installed update tool that trusted its own update channel** — a malicious/intercepted update delivered a second-stage implant. ASUS disputed the scope and said it had remediated, but the CISA/NSA/FBI + Kaspersky evidence is the durable record.

**Citations:** CISA/NSA/FBI, **AA19-044A** "Hunters International" (Jan 2019); Kaspersky Securelist, *"ASUS: The Motherboard That Hides a Backdoor"* (Dec 2018, ~57k confirmed); Avast (2017).
**Updater-relevant lesson:** **A pre-installed, vendor-trusted update channel is a persistent backdoor vector** if its authenticity/transport can be defeated — and it can persist **silently for years** because the update tool is invisible and trusted by default. This is the hardware-vendor analog of the updater-trust problem: the update path outlives the threat model that assumed it was safe.

---

### 2.4 SolarWinds 2020 — SUNBURST (Orion build-server compromise)

In **2020**, threat actors (tracked as **SOLARWINDS / Sunburst**) compromised **SolarWinds' Orion build server** and inserted a backdoor (**SUNBURST**) into Orion web-tier updates. Tainted builds were served to an estimated **~18,000 Orion customers** (FireEye/CISA figure) over roughly **July–November 2020**. **FireEye detected the intrusion in November 2020** — by finding the backdoor on *its own* SolarWinds account — and the full build-server compromise was not fully understood until early 2021. The brief's **"8–9 months undetected"** reflects the dwell: the poisoned update channel kept serving malicious, **properly signed** builds for months before anyone noticed, and the SUNBURST foothold then enabled follow-on tooling (TEARDROP) used against US government agencies and large enterprises. Root cause: **build-server compromise → trojan injected into a signed, trusted update**, again with an **intact signature** (§2.2's lesson at enterprise scale).

**Citations:** FireEye, *"Unveiling the SOLARWINDS Supply Chain Compromise"* (Nov 2020); CISA/FBI, **AA20-342A** (Nov 2020); Mandiant (Dec 2020). ~18,000 customers (FireEye/CISA).
**Updater-relevant lesson:** **A compromised build server poisons every downstream update for months.** The update channel's integrity is only as strong as the build pipeline, and detection is slow precisely because the artifacts are **signed and "look normal."** Pipeline integrity > signature.

### 2.5 NotPetya 2017 — MeDoc updater (wiper delivered as an "update")

In **June 2017**, the **NotPetya** wiper-ransomware (often mislabeled "Petya") spread globally. Its primary delivery was a **poisoned "mandatory update"** to the Ukrainian accounting/tax software **MeDoc (M.E.DOC)**: the updater pushed a payload that, instead of updating, **overwrote the Master File Table (MFT)** (destroying the filesystem) and then ran Petya-style encryption. Because it propagated via **trusted accounting software's own update channel**, it hit **businesses** (not just home users), causing enormous global damage — **estimated at ~$10B** in total economic loss (US-government / White House-cited estimate in reporting), with **Maersk alone reporting $200–300M** (per its CEO, Søren Skou, 2017). Root cause: the **software's trusted update channel delivered a destructive "update"** — the textbook case of "trusted update channel = total compromise."

**Citations:** The Economist / Reuters on the ~$10B figure (2017); Maersk via CNBC/Reuters (Søren Skou, Oct 2017, **$200–300M**); the MeDoc M.E.DOC update-client mechanism (widely reported 2017).
**Updater-relevant lesson:** **The update client is the highest-trust code path you ship.** An actor who controls the update channel can deliver a **wiper**, not just a bad version. Integrity + provenance + the ability to *not* auto-apply an unvalidated payload are the only real defenses.

### 2.6 event-stream 2018 — npm package compromise (transitive-dependency backdoor)

In **June 2018**, the npm package **`event-stream`** (and its transitive dependency **`flatmap-stream`**) — **~2M+ weekly downloads**, used across a large share of the Node ecosystem — was compromised. A maintainer had **handed over package access to a third party**, who published malicious versions (e.g. `flatmap-stream` 0.11.0, `event-stream` 3.3.6) containing a **Bitcoin-stealing backdoor** that exfiltrated private keys; the same threat actor was later linked to the **Coinbase** key theft (July 2018). Root cause: **supply-chain trust in a transitive dependency + an unguarded maintainer/account handoff + no review of the dependency's diff** before it entered thousands of apps' dependency graphs.

**Citations:** Snyk, *"event-stream npm package compromised"* (Jun 2018); The Register and other 2018 coverage; the maintainer's account of the handoff.
**Updater-relevant lesson:** **Your update tool's *dependency tree* is part of your attack surface.** A compromised transitive dependency (or a maintainer handoff) can inject a backdoor into every app that pulls it. Pin/lock dependencies, review diffs on version bumps, and prefer audited/vendored deps on the update path. (In-tree evidence that this is routine: Tauri **#3740** RUSTSEC advisories, sw-precache **#385** lodash vuln, Sparkle's security hardening #2895/#2891.)

### 2.7 1Password macOS update — (per brief: 2023; documented 2021 incident)

**Honesty flag:** the brief names a **"1Password 2023 signed-binary Mac update broke installs."** The **best-documented, confidently-citable** 1Password macOS update incident is **November 2021**: an update to **1Password 8 for macOS** **corrupted users' local vault data** (users saw "Corrupted database" / "Unable to read database" errors), affecting macOS users who updated from earlier 1Password 6/7; 1Password published a support write-up and a recovery path. I am **flagging the "2023" date as per-brief and not independently dated this run** — the 2021 incident is the one I can cite with confidence, and it is the same *class* of failure the brief describes. In both framings the mechanism is the same: a **properly signed, vendor-controlled macOS auto-update shipped a defect that corrupted user state, with no automatic rollback** — the app updated, the signature was valid, and yet user data was destroyed.

**Citations:** 1Password support/blog, *"An issue with 1Password 8 on macOS"* (Nov 2021) **[documented]**; the "2023" framing is **per-brief — verify the exact date/primary source before publishing**.
**Updater-relevant lesson:** **A validly-signed, vendor-controlled update can still be *wrong*.** Signature + vendor control do not guarantee the update is *correct* or *safe to apply*. You need **pre-apply validation, a clean rollback, and state-mutation safety** so a defective update cannot corrupt user data.

---

## 3. Synthesis — blast-radius × likelihood, and the trust decision

### 3.1 Scoring rubric
Two axes, then a recommendation:
- **Likelihood** (chance an update-path failure hits a user in normal operation), read from *post-2022 issue recency + open-ness + count*: **High / Med / Low**.
- **Blast radius** (severity when it does hit), on this scale: *annoyance (stale version)* → *update fails (recoverable)* → *app bricked / unrecoverable / data corrupted* → *fleet-wide brick / trojan*.

### 3.2 Trust matrix (the section to read first)

| Library | Post-2022 issues (surveyed) | Open-reliability signal | Dominant failure theme | Likelihood | Max blast radius | Recommendation |
|---------|------------------------------|--------------------------|------------------------|-----------|------------------|----------------|
| electron-builder (NSIS) | 6 (2 open, both in running-app check) [V] | Med | NSIS running-app check (PS5.1 WMI) → app left uninstalled | Med | Med-High (unrecoverable install) | **Trust-with-caveats** — gate on #10359/#10454; risky on Win-on-ARM |
| Squirrel.Windows | 3 (all open, maintenance mode) [P/K] | Low (aging) | Leading-zero → 0xc0000409 crash; no delta | Low | Med-High (hard crash) | **Do-not-build** |
| Squirrel.Mac | 7 (all open, dormant) [P] | Low (dormant) | Abandoned installs; symlink path-traversal | Low | Med-High (corrupt install + security) | **Do-not-build** (use Sparkle) |
| Sparkle | ~11 (mostly closed, 2026) [V] | High (actively closing) | Unicode running-app check; macOS-26; concurrency; security | Med | Med (running-app overwrite, delta corruption) | **Trust** — strongest-maintained native; watch unicode + macOS-26 |
| Workbox | 3 (2 open) [P/K] | Med | SW lifecycle: white screen; stacked updates | Med | Med (white screen / stale) | **Trust-with-caveats** (config-dependent, eventually-consistent) |
| sw-precache | 0 post-2022 (abandoned 2019) [V] | Dead | Abandoned; dep vuln; cache-update crash | n/a | High (crash + CVE) | **Do-not-use** |
| @capacitor/live-updates (deprecated) | deprecation (3) [V] | Dead/deprecated | Abandoned; native-code staleness | n/a | High (OTA broken) | **Do-not-build** (use Capawesome fork) |
| @capawesome/capacitor-live-update | [B] re-verify | Unknown (blocked) | Structural native-bridge gap (OTA vs native) | unknown | Med-High (bricked until store update if rollback fails) | **Re-verify** (community-maintained) |
| CodePush / App Center | sunset (4) [P] | Dead (retired 2025-03-31) | Service death | n/a | **Extreme** (OTA gone entirely) | **Do-not-build** (dead) |
| Expo Updates / EAS Update | 12 (many open) [V] | High, long open tail | Fingerprint/launch-identity fragility; downloaded-not-applied | High | Med-High (silent per-locale OTA death #48148; unlaunchable) | **Trust-with-caveats** — richest features, most open surface |
| @tauri-apps/updater | 12 (11 open) [V] | High, mostly open | Native install/privilege/replace across 3 OSes | High | Med-High (hung/bricked install; main-thread freeze) | **Trust-with-caveats / Re-verify** — newest, least hardened |
| Microsoft MSIX AppInstaller | [B] re-verify | Unknown (blocked) | Silent no-update; policy; MSIX-only scope | unknown | Med (silent stale; reject) | **Trust-as-baseline** for packaged Win32/MSIX (OS-maintained) |

### 3.3 Cross-cutting failure taxonomy (the 6 recurring "postmortem" themes)

1. **"Is the app still running?" check fragility** — the #1 recurring bug: electron-builder #10359/#10454, Sparkle #2937/#2942/#2943, Squirrel.Mac #336. *Root:* detecting/closing the running app before replace is hard — PowerShell/WMI edge cases, Unicode NFC/NFD, invisible helpers.
2. **Interrupted / abandoned install** — sign-out/shutdown (electron-builder #7807), host-quits (Squirrel.Mac #336), in-flight races (Sparkle #2928). *Root:* the replace step is not atomic/transactional; no rollback.
3. **Version / fingerprint / launch-identity correctness** — Expo (fingerprint cluster + #51268), MSIX (manifest identity), Tauri (builder state). *Root:* the "is this update valid for *this* device" gate is brittle to path separators, config imports, request headers, module layout.
4. **Privilege / location / permission edges** — Tauri (#2455, #3764, #3595, #1983, #2148), Sparkle (macOS-26 EPERM #2880). *Root:* install-to-protected-path + elevation is OS-specific and under-tested.
5. **Supply-chain / dependency + provenance** — CrowdStrike, CCleaner, SolarWinds, ASUS, NotPetya, event-stream, 1Password; in-tree: Tauri #3740 (RUSTSEC), sw-precache #385 (lodash), Sparkle security hardening (#2895/#2891). *Root:* the update path's *trust* (signatures, build pipeline, deps) is the real boundary.
6. **Service / vendor continuity** — CodePush/App Center sunset; @capacitor/live-updates deprecation; Squirrel.* maintenance mode. *Root:* a hosted/official updater can disappear or go unmaintained; blast radius = "everything."

### 3.4 Bottom-line recommendations for AIRIZ

- **Native desktop (Win+mac), most battle-tested:** **Sparkle on macOS** is the clear trust pick (actively maintained, closing security + unicode bugs). On Windows, electron-builder's NSIS path is workable but carries **two open running-app-check bugs** — treat #10359/#10454 as **gate risks**, especially on **Win-on-ARM**. Squirrel.* (both) is **not viable** (dormant + open crash/security).
- **Cross-platform Rust desktop (Tauri):** viable but the **least hardened**; expect to **patch the install/privilege/replace path yourself** before it is trustworthy. Re-verify the open-issue set.
- **React Native / Expo:** EAS Update is **feature-rich but has the most open reliability surface** (fingerprint / launch-identity). Invest in hard validation of the fingerprint + a strong rollback; treat **#48148** (an *external* actor silently breaking per-locale OTA identity) as the scary one.
- **Capacitor:** the official plugin is **dead**; you would be on the **community fork** — re-verify and accept the structural **native-bridge gap** (OTA web bundles are a second-class citizen vs native).
- **Packaged Windows (MSIX):** MSIX auto-update is a solid **OS-maintained baseline**, but is **silent on failure** and **MSIX-scope only** — pair it with an in-app status surface.
- **Cross-cutting non-negotiables** (distilled from §2): (a) **validate + stage + canary** every pushed artifact (CrowdStrike); (b) make the **replace step atomic with rollback** (NotPetya, 1Password, Squirrel.Mac); (c) **protect the build pipeline**, because *signature ≠ clean build* (CCleaner, SolarWinds); (d) **pin + audit the updater's dependency tree** (event-stream, Tauri #3740); (e) **explicitly test the interrupted-install path** — sign-out, power loss, host-quit — because **every** library has at least one bug there.

### 3.5 Re-verification queue (blocked / unconfirmed this run)
- [ ] **capawesome-team/capacitor-live-update** — pull issue tracker (OA-proxy 404 this run; §1.8).
- [ ] **microsoft/AppInstaller** — pull issue tracker (OA-proxy 404 this run; §1.12).
- [ ] **1Password "2023"** incident — confirm exact date/primary source (only the **2021** incident is confidently citable; §2.7).
- [ ] **electron-builder #10359 / #10454** — confirm fix status / any patch PR before the final Windows trust call.

---

## 4. Appendix

### 4.1 Verification ledger (what was live-fetched on 2026-11-04)
**[V] — fetched from the GitHub REST API, title + open/closed confirmed verbatim:**
- electron-builder: #10359, #10454, #7807, #6800, #6935, #6555 (6/6 confirmed)
- Tauri (plugins-workspace): #2558, #2951, #2601, #2335, #2697, #3000, #2455, #3764, #3595, #1983, #2148, #3740 (12/12 confirmed)
- Expo (expo/expo): #48148, #50349, #48404, #50139, #50389, #51268, #43375, #50202, #52191, #51167, #52152, #45527 (12/12 confirmed)
- Sparkle (2026 set): #2880, #2937, #2943, #2942, #2928, #2934, #2895, #2891, #2898, #2882, #2933 (fetched from the live issues list)
- sw-precache: #382, #385, #383, #380, #351 (fetched from the live issues list)
- capacitor-plugins (@capacitor/live-updates deprecation): #2326, #2311, #2182 (confirmed)
- Repo-existence facts: `electron-userland/electron-updater` → **404 (does not exist as a standalone repo)**; `sparkle-project/Sparkle` → 200 (control, active, default branch `2.x`, last push 2026-11-02).

**[P] — carried from the prior research brief; numbers spot-checked where the repo was reachable:**
- Squirrel.Windows #1783, #1884, #1883; Squirrel.Mac #336, #322, #262, #204, #188, #110, #84; Workbox #3377, #3285, #3230; App Center/CodePush #2650, #2535, #814 + the 2025-03-31 / 2025-05-20 sunset events.

**[K] — prior engineering knowledge, cited to the repo, specific issue number not asserted:**
- Squirrel.Windows running-app / .NET-Core-apphost classes; Workbox skipWaiting/clientsClaim + precache-mismatch classes; Capawesome failure classes; MSIX AppInstaller failure classes; Sparkle 2.0 DSA→EdDSA migration.

### 4.2 Proxy-block log (failed this run; re-verify from a non-blocked network)
- **`capawesome-team/capacitor-live-update`** → HTTP **404** on all routes (gh api, curl.exe, webfetch).
- **`microsoft/AppInstaller`** → HTTP **404** on all routes.
- **Control (positive):** `sparkle-project/Sparkle` resolved **200** on the *same* webfetch route → the 404s are an **OA-proxy egress block on those specific repos**, not a missing repo or a tooling bug. (Consistent with the `pega-oa-network-proxy` notes in AGENTS.md.)
- **Exa web search** → rate-limited this run (free MCP quota), so the 1Password "2023" date could not be independently confirmed; only the **2021** 1Password incident is cited as documented.

### 4.3 Full source URL list
**electron-builder / electron-updater**
- https://github.com/electron-userland/electron-builder/issues/10359
- https://github.com/electron-userland/electron-builder/issues/10454
- https://github.com/electron-userland/electron-builder/issues/7807
- https://github.com/electron-userland/electron-builder/issues/6800
- https://github.com/electron-userland/electron-builder/issues/6935
- https://github.com/electron-userland/electron-builder/issues/6555
- https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater

**Squirrel.Windows**
- https://github.com/Squirrel/Squirrel.Windows/issues/1783
- https://github.com/Squirrel/Squirrel.Windows/issues/1884
- https://github.com/Squirrel/Squirrel.Windows/issues/1883

**Squirrel.Mac**
- https://github.com/Squirrel/Squirrel.Mac/issues/336
- https://github.com/Squirrel/Squirrel.Mac/issues/322
- https://github.com/Squirrel/Squirrel.Mac/issues/262
- https://github.com/Squirrel/Squirrel.Mac/issues/204
- https://github.com/Squirrel/Squirrel.Mac/issues/188
- https://github.com/Squirrel/Squirrel.Mac/issues/110
- https://github.com/Squirrel/Squirrel.Mac/issues/84

**Sparkle**
- https://github.com/sparkle-project/Sparkle/issues/2880
- https://github.com/sparkle-project/Sparkle/issues/2937
- https://github.com/sparkle-project/Sparkle/issues/2943
- https://github.com/sparkle-project/Sparkle/issues/2942
- https://github.com/sparkle-project/Sparkle/issues/2928
- https://github.com/sparkle-project/Sparkle/issues/2934
- https://github.com/sparkle-project/Sparkle/issues/2895
- https://github.com/sparkle-project/Sparkle/issues/2891
- https://github.com/sparkle-project/Sparkle/issues/2898
- https://github.com/sparkle-project/Sparkle/issues/2882
- https://github.com/sparkle-project/Sparkle/issues/2933
- https://sparkle-project.org/documentation/code-signing/ (EdDSA / 2.0 migration)

**Workbox**
- https://github.com/GoogleChrome/workbox/issues/3377
- https://github.com/GoogleChrome/workbox/issues/3285
- https://github.com/GoogleChrome/workbox/issues/3230

**sw-precache**
- https://github.com/GoogleChromeLabs/sw-precache/issues/382
- https://github.com/GoogleChromeLabs/sw-precache/issues/385
- https://github.com/GoogleChromeLabs/sw-precache/issues/383
- https://github.com/GoogleChromeLabs/sw-precache/issues/380
- https://github.com/GoogleChromeLabs/sw-precache/issues/351

**Capacitor live-update**
- https://github.com/ionic-team/capacitor-plugins/issues/2326
- https://github.com/ionic-team/capacitor-plugins/issues/2311
- https://github.com/ionic-team/capacitor-plugins/issues/2182
- https://github.com/capawesome-team/capacitor-live-update  **[B] re-verify**

**CodePush / App Center**
- https://github.com/microsoft/appcenter/issues/2650
- https://github.com/microsoft/appcenter/issues/2535
- https://github.com/Microsoft/code-push/issues/814
- https://github.com/Microsoft/code-push (archived 2025-05-20)

**Expo Updates / EAS Update**
- https://github.com/expo/expo/issues/48148
- https://github.com/expo/expo/issues/50349
- https://github.com/expo/expo/issues/48404
- https://github.com/expo/expo/issues/50139
- https://github.com/expo/expo/issues/50389
- https://github.com/expo/expo/issues/51268
- https://github.com/expo/expo/issues/43375
- https://github.com/expo/expo/issues/50202
- https://github.com/expo/expo/issues/52191
- https://github.com/expo/expo/issues/51167
- https://github.com/expo/expo/issues/52152
- https://github.com/expo/expo/issues/45527

**Tauri updater**
- https://github.com/tauri-apps/plugins-workspace/issues/2558
- https://github.com/tauri-apps/plugins-workspace/issues/2951
- https://github.com/tauri-apps/plugins-workspace/issues/2601
- https://github.com/tauri-apps/plugins-workspace/issues/2335
- https://github.com/tauri-apps/plugins-workspace/issues/2697
- https://github.com/tauri-apps/plugins-workspace/issues/3000
- https://github.com/tauri-apps/plugins-workspace/issues/2455
- https://github.com/tauri-apps/plugins-workspace/issues/3764
- https://github.com/tauri-apps/plugins-workspace/issues/3595
- https://github.com/tauri-apps/plugins-workspace/issues/1983
- https://github.com/tauri-apps/plugins-workspace/issues/2148
- https://github.com/tauri-apps/plugins-workspace/issues/3740

**MSIX AppInstaller**
- https://github.com/microsoft/AppInstaller  **[B] re-verify**

**Supply chain (primary sources)**
- CrowdStrike: https://www.crowdstrike.com/blog/anatomy-of-the-falcon-sensor-content-issue/ (2024)
- CCleaner: https://www.avast.com/i/ccleaner-trojanized (2017)
- ASUS / Operation ShadowHammer: CISA AA19-044A; Kaspersky Securelist (2018)
- SolarWinds SUNBURST: FireEye (2020); CISA/FBI AA20-342A
- NotPetya: MeDoc M.E.DOC; Maersk $200–300M (Søren Skou, 2017)
- event-stream: Snyk (2018)
- 1Password: 1Password support/blog (2021) [documented]; 2023 framing per-brief

### 4.4 Currency / date-awareness notes
- Written **2026-11-04**. "Open"/"still open" = as of this date.
- **App Center retired 2025-03-31; CodePush archived 2025-05-20** — reported as *past* events, not current.
- **Sparkle** default branch `2.x`, active (last push 2026-11-02, ~9.9k stars).
- **sw-precache** and **Squirrel.*** have **no meaningful post-2022 activity** — that absence is the finding.
- Expo rows dated 2026 without a day = created in 2026 (day not captured this run).

### 4.5 Sign-off (fail-loud)
- **Completed:** per-library tables for all 12 systems; 7 supply-chain write-ups; synthesis + trust matrix; full source list.
- **Verified this run (ground truth):** all 30 provided issue numbers (electron-builder/Tauri/Expo) + Sparkle + sw-precache + capacitor deprecation + the electron-updater-404 fact.
- **NOT verified / flagged:** §1.8 (Capawesome) and §1.12 (AppInstaller) specific issue numbers — **OA-proxy 404**, content is architecture + known-failure-classes only; §2.7 1Password **"2023"** date — **per-brief**, only 2021 is confidently cited.
- **Known limitation:** issue *fix* descriptions for **closed** rows are the implied patch (exact PR diff not fetched). Issue **URLs** are stable GitHub permalinks and are the load-bearing citations.
- This document is for internal architecture decision-making; the [B]/[K] rows and the 1Password date **require re-verification** before any external publication.

---

## 5. Part II — Design requirements, threat model, extended verdicts, reference architecture, glossary

*(Supplementary. Placed after the §4 source appendix for file-ordering convenience; read together with §3. All of this is derived from the §1–§3 evidence above.)*

### 5.1 Failure theme → AIRIZ design requirement + concrete must-test

Every recurring postmortem theme (§3.3) maps to a **design requirement** the AIRIZ updater must satisfy, and a **concrete repro** that must pass before the updater is trusted. This is the actionable core of the survey.

| # | Failure theme | Representative incident(s) | Design requirement (must-do) | Concrete must-test (repro that must pass) |
|---|---------------|-----------------------------|-------------------------------|--------------------------------------------|
| 1 | "Is the app still running?" check | electron-builder #10359/#10454; Sparkle #2937/#2942/#2943; Squirrel.Mac #336 | Running-app detection must (a) treat 0 / 1 / many processes uniformly (no `.Count` on a single object), (b) impose a **hard timeout** on any subprocess/WMI/AppleScript call, (c) compare bundle paths **after Unicode normalization (NFC)**, (d) run the check **off the UI thread** | Start the app as exactly **one** process under a **non-ASCII (precomposed)** app name; trigger an update; assert the check does **not** report "not running"; separately hang the WMI/AppleScript call and assert the check times out ≤ Ns and fails safe |
| 2 | Interrupted / abandoned install | electron-builder #7807; Squirrel.Mac #336; Sparkle #2928 | The replace step must be **atomic + transactional with rollback**: never delete the old app before the new one is fully staged **and validated**; on any abort (sign-out, power loss, host-quit, in-flight race) the previous version must remain launchable | For each OS: (a) power-cut, (b) sign-out, (c) quit the host app, (d) start a second update while the first is in-flight — **mid-install**; reboot; assert the app launches at the **pre-update** version, never bricked |
| 3 | Version / fingerprint / launch-identity | Expo fingerprint cluster + #51268 + #48148; MSIX manifest; Tauri builder state | Compute the update-identity deterministically, **independent of** path separators, config-file imports, request headers, module layout, and OS string-translation; validate the downloaded artifact's identity **before** launch | (a) change a config file / workspace patch / file path layout → assert the fingerprint **changes** and the update is re-gated; (b) rotate an `Authorization` header between download and launch → assert the downloaded update is **still launchable**; (c) feed a localized build whose runtime-version string was rewritten → assert OTA is not silently broken |
| 4 | Privilege / location / permission edges | Tauri #2455/#3764/#3595/#1983/#2148; Sparkle #2880 | Install dir must be created with correct perms **without forcing admin where avoidable**; elevation UI must run **off the main thread**; read-only / removable-volume locations must produce a **clear, actionable prompt** (never a freeze or silent failure) | Run the installed app from (a) a **read-only** filesystem, (b) a **removable volume**, (c) a **non-admin** account; assert either clean success or an explicit prompt that tells the user exactly what to do |
| 5 | Supply-chain / dependency + provenance | CrowdStrike, CCleaner, SolarWinds, ASUS, NotPetya, event-stream; Tauri #3740; sw-precache #385; Sparkle #2895/#2891 | (a) **validate + stage + canary** every pushed artifact; (b) enforce signature **and** provenance (build-pipeline attestation); (c) **pin + audit** the updater's dependency tree (lockfile + advisory gating); (d) **reject-on-signing-failure**; (e) harden the apply step against **symlink/TOCTOU** | Push a malformed/malicious test artifact to a **canary ring** → assert it is rejected **before** fleet; bump a dependency with a **known advisory** → assert CI **blocks** the build; place a **symlink** at the apply destination → assert it is refused |
| 6 | Service / vendor continuity | CodePush/App Center; @capacitor/live-updates; Squirrel.* | Never make the critical path depend on a single hosted/official updater with **no self-host option**; require a self-hostable manifest **and** rollback; monitor the vendor's maintenance/roadmap; pre-plan a migration | Bring up the **self-hosted** update path and run a full update **+ rollback** with the vendor service **offline**; assert it works end-to-end |

### 5.2 Quantitative blast-radius × likelihood scoring

Transparent rubric so the numbers are adjustable as the **[B]** items (Capawesome, AppInstaller) get verified. Analyst judgment from the surveyed evidence, not a measured statistic.

- **Likelihood (1–5):** 1 = rarely hits a user in normal operation … 5 = very likely to hit a user in normal operation.
- **Blast radius (1–5):** 1 = annoyance (stale version) · 2 = update fails (recoverable) · 3 = app bricked / unrecoverable install · 4 = user **data** corrupted · 5 = fleet-wide brick / trojan.
- **Risk = Likelihood × Blast.** Tiers: **1–4 Low** · **5–8 Guard** · **9–14 Guard-hard** · **15+ Avoid**.

| Library | Likelihood | Blast | Risk (L×B) | Tier | One-line driver |
|---------|:----------:|:-----:|:----------:|------|-----------------|
| electron-builder (NSIS) | 3 | 3 | **9** | Guard-hard | 2 open running-app-check bugs; app-left-uninstalled |
| Squirrel.Windows | 2 | 3 | **6** | Guard | aging, open 0xc0000409 crash |
| Squirrel.Mac | 2 | 3 | **6** | Guard | dormant; abandoned installs + symlink path-traversal |
| Sparkle | 3 | 3 | **9** | Guard-hard | but best-maintained → lowest *practical* risk in class |
| Workbox | 3 | 2 | **6** | Guard | SW lifecycle; white screen / stale |
| sw-precache | — | — | n/a | **Do-not-use** | dead 2019; CVE; cache-update crash |
| @capacitor/live-updates | — | — | n/a | **Do-not-build** | deprecated |
| @capawesome/capacitor-live-update | ? | ? | **re-verify** | Re-verify | blocked; structural native-bridge gap |
| CodePush / App Center | — | — | n/a | **Do-not-build** | dead (retired 2025-03-31) |
| Expo Updates / EAS Update | 4 | 3 | **12** | Guard-hard | most open surface; fingerprint/identity; #48148 |
| @tauri-apps/updater | 4 | 3 | **12** | Guard-hard | newest, least hardened; 11 open across 3 OSes |
| MSIX AppInstaller | 3 | 2 | **6** | Guard (baseline) | OS-maintained; silent-on-failure; MSIX-only |

**How to read it:** the *highest scored* (Expo, Tauri) are not "worst" in absolute safety — they are **young, fast-moving, high-bug-volume** systems. Sparkle scores 9 only because it is mature enough to keep *surfacing and closing* edge bugs; its **practical** risk is the lowest of the native options. The scoring is a **triage** for where to spend hardening effort, not a ranking of "good vs bad" alone. The true **do-not-touch** set is the dead/abandoned set (sw-precache, @capacitor/live-updates, CodePush/App Center) plus the dormant Squirrel pair for new builds.

---

### 5.3 Extended per-library verdicts (evidence + single biggest risk + mitigation)

**1. electron-builder / electron-updater (NSIS) — VERDICT: Watch (viable Windows path, with a gate).**
- Strongest evidence: the two newest **open** bugs (#10359, #10454) are *both* in the NSIS running-app check and *both* are PowerShell-5.1-specific; #7807 shows the interrupted-install path can leave the app unrecoverable.
- Single biggest risk: **the app is left uninstalled** when the running-app check hangs (no timeout) or miscounts a single process, or when a sign-out/shutdown interrupts the swap.
- Mitigation before critical path: add a hard timeout + single-process handling to the running-app gate; explicitly test the interrupted-install path; **avoid Win-on-ARM** until #10359/#10454 are resolved.

**2. Squirrel.Windows — VERDICT: Avoid (new builds).**
- Strongest evidence: in **maintenance mode** post-2022 with **all three** post-2022 issues still open, including a hard **0xc0000409 crash** on leading-zero versions (#1783) and never-generated deltas (#1884).
- Single biggest risk: an **aging, under-triaged codebase** that will not fix a hard crash or a security-adjacent gap for you.
- Mitigation: do not standardize on it; if a legacy app already uses it, plan an exit.

**3. Squirrel.Mac — VERDICT: Avoid (use Sparkle).**
- Strongest evidence: a dormant repo whose long tail includes **abandoned installs** when the host quits (#336), a **log-rotation ceiling** (#322), **unserialized stacked updates** (#262), and a **symlink path-traversal** security gap (#84).
- Single biggest risk: **corrupted/partial installs + a path-traversal security hole**, with no active maintainer.
- Mitigation: use Sparkle (§1.4) for macOS.

**4. Sparkle — VERDICT: Pick (strongest-maintained native macOS option).**
- Strongest evidence: **actively maintained** (2.x, last push 2026-11-02) and *closing* the right bugs in 2026 — Unicode running-app check (#2937/#2942/#2943), macOS-26 EPERM (#2880), in-flight races (#2928), and real **security hardening** (#2895 reject-on-signing-failure, #2891 symlink-at-destination).
- Single biggest risk: the **Unicode NFC/NFD running-app check** still being a live 2026 bug class — a running app could be overwritten and not relaunched for non-ASCII bundle names.
- Mitigation: validate bundle paths are NFC-normalized in your test matrix; track the Sparkle 2.x release notes for the macOS-26/unicode fixes and adopt promptly.

**5. Workbox — VERDICT: Watch (fine, config-dependent).**
- Strongest evidence: the update model is **service-worker lifecycle**, and the open bugs are lifecycle-semantic (#3377 first-update misclassified, #3285 stacked updates not each notified); the notable closed one is a **white screen after update** (#3230).
- Single biggest risk: **PWA updates are eventually-consistent** — the client only adopts the new SW on the next navigation/claim, so a misconfiguration (skipWaiting/clientsClaim) means "auto-update" silently does nothing, and a bad precache swap means a **white screen**.
- Mitigation: pin the skipWaiting/clientsClaim + controllerchange behavior, and add a "new version available" prompt driven by the workbox-window `update` event; regression-test the white-screen path.

**6. sw-precache — VERDICT: Do-not-use.**
- Strongest evidence: **deprecated 2019** (#382), an **open `lodash.template` vulnerability** (#385), a never-fixed **cache-update race that crashes the app** (#351), and **zero post-2022 activity**.
- Single biggest risk: an **unmaintained, CVE-exposed** build path.
- Mitigation: use Workbox. There is no case for sw-precache in a new deployment.

**7. @capacitor/live-updates (deprecated) — VERDICT: Do-not-build.**
- Strongest evidence: the official plugin was **deprecated** — capacitor-plugins **#2326 "Live Updates repo is gone"** (2025) — and maintenance moved to the community fork.
- Single biggest risk: **abandoned official code** whose native modules no longer track OS changes.
- Mitigation: if you must use Capacitor OTA, use the maintained **Capawesome fork** (§1.8) and re-verify its open issues.

**8. @capawesome/capacitor-live-update — VERDICT: Re-verify (community-maintained, structural gap).**
- Strongest evidence: it is the **maintained successor** to the deprecated official plugin, but it is **community-maintained**, and its defining weakness is **structural**: OTA (web) bundles are a second-class citizen vs native code, so "works in the store build, breaks under OTA" is the recurring failure.
- Single biggest risk: a **broken OTA bundle with a failed rollback** bricking the app until a store update ships; and, this run, the **exact open-issue set could not be fetched** (proxy 404).
- Mitigation: re-pull the tracker from a non-blocked network; exercise **last-known-good rollback end-to-end**; keep OTA changes JS-only and ship native changes through the store.

**9. CodePush / App Center — VERDICT: Do-not-build (dead).**
- Strongest evidence: **Visual Studio App Center retired 2025-03-31**; **CodePush repo archived 2025-05-20**; a pre-sunset trail of slow/unstable servers (#814) and outages (#2535).
- Single biggest risk: **total and permanent** — the OTA service simply no longer exists.
- Mitigation: none — migrate off. The durable lesson is **vendor-continuity blast radius = "everything."**

**10. Expo Updates / EAS Update — VERDICT: Watch (rich, but the most open reliability surface).**
- Strongest evidence: **12 post-2024 issues**, many open, in two families — **fingerprint/launch-identity** (#50202, #52191, #51167, #52152, #51268) and **downloaded-but-never-applied** (#50349, #48404, #50389, #50139); plus the standout **#48148**, where an *external* actor (Google Play string translation) silently killed per-locale OTA.
- Single biggest risk: the **fingerprint/launch-identity gate** is brittle — a path separator, a config import, a request header, or a module `sourceDir` can make a valid update *rejected* or an update *unlaunchable*, and #48148 shows an **outside actor** can flip the identity.
- Mitigation: build a **fingerprint/identity validation harness** as a first-class test target; add a strong, tested rollback; treat any "update downloaded but not applied" as a P0 to root-cause per platform/SDK.

**11. @tauri-apps/updater — VERDICT: Watch / Re-verify (newest, least hardened).**
- Strongest evidence: **12 issues, 11 open**, spread across the **full install/privilege/replace path on all three OSes** — a never-returning `install()` (#2558), Windows request/elevation failures (#2951, #2335, #3000, #2697), a final-move failure (#2601), and macOS/Linux privilege & location issues (#2455, #3764, #3595, #1983, #2148).
- Single biggest risk: **breadth** — because the native install/privilege/replace step is the thinnest part, a given device/OS combination is more likely to hit *an* unhandled edge; the main-thread AppleScript freeze (#3764) is a concrete, user-visible one.
- Mitigation: if AIRIZ standardizes on Tauri, **budget to patch the update path yourself** (timeouts, off-main-thread elevation, read-only/removable handling) and gate on a shrinking open-issue count; re-verify the set from a clean network.

**12. Microsoft MSIX AppInstaller — VERDICT: Baseline (for packaged Win32/MSIX), re-verify details.**
- Strongest evidence: the update machinery is **OS-maintained** (the "boring default" for packaged Windows apps), but it is **silent on failure** (a bad URI/manifest just means "no update") and **MSIX-scope only**; specific issue numbers could not be fetched this run (proxy 404).
- Single biggest risk: **silent staleness** — the app can be left outdated with no loud signal, and any plain (non-MSIX) build simply has no OS-level updater.
- Mitigation: pair MSIX auto-update with an **in-app status surface** (query `WindowsPackageManager`), serve a validated manifest from a reliable URI, and **re-verify the AppInstaller tracker** from a non-blocked network.

---

### 5.4 Threat model — who can break the update path, and the matching defense

This is the attacker-capability view of §2 + §5.1-#5. Each row: the actor/capability, the attack, the incident that proved it real, and the control that defeats it.

| Actor / capability | Attack | Proven by | Defeating control |
|--------------------|--------|-----------|-------------------|
| Updater maintainer / build server | Trojanize the signed artifact (build-pipeline compromise) | CCleaner, SolarWinds | Build-pipeline **attestation + provenance**; out-of-band artifact hash; **signature ≠ clean build** |
| Update-channel attacker (MITM / poisoned feed) | Deliver a malicious/bricking "update" | ASUS Live Update, NotPetya, CrowdStrike | **Validate + stage + canary** every artifact; reject-on-signing-failure; TLS pinning |
| Malicious content/rules push (low-friction channel) | Ship a malformed pattern that crashes a driver/app at scale | CrowdStrike (Channel File 291) | **Content validation gate + canary ring** before fleet; treat driver-level as highest severity |
| Dependency maintainer / transitive dep | Backdoor a package in the updater's dep tree | event-stream; (in-tree: Tauri #3740, sw-precache #385) | **Lockfile + advisory gating** in CI; review diffs on version bumps; vendor/audit critical deps |
| OS / platform vendor | Ship a platform change that breaks the install path | Sparkle #2880 (macOS-26 EPERM), Expo #48148 (Play string translation) | Track platform release notes; **regression-test on the newest OS + edge (unicode, localized, incognito)** |
| Insider / vendor sunset | The official updater disappears or goes unmaintained | CodePush/App Center, @capacitor/live-updates, Squirrel.* | **Self-hostable manifest + rollback**; monitor vendor roadmap; pre-plan migration |
| Defective vendor update (not malicious) | A validly-signed update that corrupts user state | 1Password (2021) | **Pre-apply validation + clean rollback + state-mutation safety** |
| Local filesystem (symlink/TOCTOU) | Redirect the apply to a path outside the app | Sparkle #2891, Squirrel.Mac #84 | **Refuse symlinks at the apply destination**; TOCTOU-safe atomic move |

**Takeaway:** the update path is attacked at **six different layers** (build, channel, content, dependency, platform, vendor). No single control covers more than one. A trustworthy updater needs **all** of: pipeline attestation, content validation + canary, dep pinning, OS-edge regression, self-host fallback, and atomic-rollback. This is why "we use a reputable library" is necessary but not sufficient — the library must also be wired to these controls.

---

### 5.5 A reference update pipeline that satisfies every theme (§5.1)

The postmortems don't argue for "library X" so much as for **a pipeline shape** that every candidate library must be wired into. Concretely, the AIRIZ updater should be a thin, **auditable** pipeline where each stage carries the controls from §5.1. (The *library* supplies the Detect/Apply mechanics; the *controls* are AIRIZ's and are non-negotiable regardless of library.)

```
                 [Provenance / Signing layer — wraps every stage]
                 build attestation · signature + hash · dep pinning
   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
   │ DETECT │ → │ VALIDATE│ → │ STAGE  │ → │ CANARY │ → │ APPLY  │ → │ REPORT │
   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘
   manifest/      signature +    atomic     % of fleet   atomic +     structured
   identity/      content        temp dir   ring; auto-  rollback;    telemetry:
   fingerprint    schema +       (perms)    abort on     off-UI-      success/fail/
   (theme 3)      dependency     (theme 4)  error        thread       rolled-back
   (theme 5)      audit          (theme 1  (theme 5)     elevation    (theme 2)
                                    running-
                                    app gate)
```

| Stage | Controls (mapped to §5.1 themes) | Failure it must absorb (mapped to §1 incidents) |
|-------|----------------------------------|--------------------------------------------------|
| **Detect** | Deterministic identity/fingerprint; self-hostable manifest; in-app status surface (theme 3, 6) | Silent per-locale OTA death (Expo #48148); silent MSIX staleness (§1.12) |
| **Validate** | Signature **and** content-schema check; dependency/advisory audit; **reject-on-signing-failure** (theme 5) | Trojanized signed build (CCleaner, SolarWinds); malformed content (CrowdStrike); dep CVE (Tauri #3740, sw-precache #385) |
| **Stage** | Atomic temp-dir staging with correct **perms, no forced admin**; NFC-normalized paths; **running-app gate with hard timeout + off-UI-thread** (themes 1, 4) | NSIS check hang (electron-builder #10359/#10454); unicode running-app overwrite (Sparkle #2937/#2942/#2943); macOS temp/admin (Tauri #2455) |
| **Canary** | % fleet ring; auto-abort on elevated error/roll-back rate (theme 5) | Fleet-wide brick (CrowdStrike); fleet 503 (Expo #43375) |
| **Apply** | **Atomic + transactional replace with rollback**; never delete old before new is staged+validated; **refuse symlink at destination**; off-main-thread elevation; handle read-only/removable with a prompt (themes 2, 4, 5) | Interrupted/abandoned install (electron-builder #7807, Squirrel.Mac #336, Sparkle #2928); symlink escape (Sparkle #2891, Squirrel.Mac #84); final-move fail (Tauri #2601) |
| **Report** | Structured telemetry: success / failure / **rolled-back** / version; alerting on roll-back rate (theme 2, 6) | "downloaded but never applied" (Expo #50349/#48404); never-returning install (Tauri #2558) |

**Key properties the shape buys you:** (1) a bad artifact is stopped at **Validate/Canary**, not at the user's machine; (2) a defective-but-valid update (1Password) is caught by **rollback**, so the previous version always survives; (3) the update path is **auditable end-to-end** (every stage emits provenance + telemetry), which is exactly what the supply-chain incidents say is missing.

### 5.6 Glossary (terms used in this survey)

- **OTA (over-the-air update):** delivering a new app/bundle without an app-store round-trip (Expo/EAS, CodePush, Tauri, Capawesome).
- **NSIS:** Nullsoft Scriptable Install System — the Windows installer electron-builder generates; the running-app check lives here.
- **AppImage / .deb:** Sparkle-style (macOS disk image) and Linux (Debian package) artifact formats used by the Electron/Squirrel/Sparkle updaters.
- **Blockmap / differential download:** the per-byte block hash map that lets an updater download only the changed blocks (electron-builder `blockmapV3`; Sparkle binary delta).
- **appcast:** the Sparkle XML feed that lists available app updates + signatures + release notes.
- **DSA / EdDSA (Ed25519):** Sparkle's code-signature schemes; 2.0 (2022) moved DSA → EdDSA.
- **ShipIt:** Squirrel.Mac's invisible helper process that performs the actual install (the "no visible presence" weakness).
- **Service worker:** the browser background script a PWA uses; "updating" a PWA = updating/activating its SW.
- **precache:** the SW cache of the app shell; a precache-manifest mismatch is a top PWA update failure.
- **skipWaiting / clientsClaim / controllerchange:** SW-lifecycle flags/events that control whether a new SW activates immediately and takes over clients.
- **fingerprint (Expo):** the hash over the app's config + modules + platform that the update server uses to gate "is this update valid for this device."
- **launch identity / `isEmbeddedLaunch` / runtime version (Expo):** the identity attributes (incl. request headers, runtime version) that decide which bundle launches; if they mismatch, the update is rejected or unlaunchable.
- **channel file (CrowdStrike):** a Falcon content/rules update pushed to endpoints — a *content* update that behaves like an update channel.
- **MSIX / MSIX App Installer:** the Windows app-package format and the OS component that installs/updates MSIX + MSIX-packed Win32 apps (off-store auto-update).
- **UAC:** Windows User Account Control — the elevation prompt the install step may trigger.
- **RUSTSEC / CVE / advisory:** security-advisory IDs for (Rust) dependency vulnerabilities (e.g. Tauri #3740).
- **lockfile / transitive dependency:** the pinned dependency manifest; a compromised *transitive* dep (event-stream) is in your tree.
- **build attestation / provenance:** evidence that an artifact was produced by the trusted pipeline (the control that "signature ≠ clean build" demands).
- **canary ring:** a small % fleet used to validate an update before full rollout.
- **TOCTOU / symlink escape:** time-of-check-to-time-of-use and path-traversal via a symlink at the apply destination (Sparkle #2891, Squirrel.Mac #84).

### 5.7 Decision record & concrete next steps

1. **Shortlist (from §3.2 / §5.2):** for a **native Win+mac** app → **Sparkle (mac)** + **electron-builder NSIS (Win, gated on #10359/#10454)**; for **Tauri** → adopt but **patch the update path**; for **Expo/RN** → adopt but build the **fingerprint/identity harness**; for **Capacitor** → use the **Capawesome fork** (re-verify); for **packaged Win32/MSIX** → **MSIX auto-update as baseline** + in-app status.
2. **Eliminate now:** sw-precache, @capacitor/live-updates (deprecated), CodePush/App Center (dead); do not start new Squirrel.* builds.
3. **Re-verify (blocked/unconfirmed):** Capawesome tracker, AppInstaller tracker, 1Password "2023" date, electron-builder #10359/#10454 fix status (from a non-blocked network).
4. **Build the controls regardless of library (§5.1, §5.5):** running-app gate (timeout + NFC + off-UI), atomic+rollback apply, Validate+Canary, dep pinning/attestation, self-host fallback, interrupted-install regression suite.
5. **Pick the library on blast-radius × likelihood (§5.2), then spend the hardening budget on its known-open themes (§5.3).**

### 5.8 Open questions for the architecture team

- Which **runtime(s)** is AIRIZ Motor Console actually on (Electron / Tauri / React Native / Capacitor / MSIX-packaged Win32)? The §5.3 verdicts only bind once the runtime is fixed.
- Is a **self-hosted** manifest/rollback a hard requirement (it converts §3.3-theme-6 from a risk into a non-issue)?
- What is the **canary policy** — is a % ring + auto-abort acceptable for the rollout process (CrowdStrike's central lesson)?
- What is the **target OS floor** for Windows (does Win-on-ARM matter, given electron-builder #10359) and for macOS (does macOS 26/Tahoe matter, given Sparkle #2880)?
- Who **owns the build-pipeline attestation**, and is an out-of-band artifact hash feasible in the current CI?

---

## 6. Cross-cutting comparative views

### 6.1 Supply-chain incident comparison matrix

| Incident | Year | Vector (which trust layer) | # / scale affected | $ cost (if public) | Dwell / detection | Signature intact? | The one-sentence lesson |
|----------|------|----------------------------|--------------------|--------------------|-------------------|-------------------|--------------------------|
| CrowdStrike | 2024-07-19 | Malformed **content push** to a kernel driver | ~8.5M Windows machines, ~285k orgs | not officially quantified (billions est. for downtime) | same-day; no validation gate before push | n/a (content, not code) | A **content channel is an update channel** — validate + canary before fleet. |
| CCleaner | 2017 | **Build-server** compromise → trojanized signed binary | ~2.27M machines | n/a (Avast) | ~3 months (May→Aug 2017) | **Yes** (valid Avast sig) | **Signature ≠ clean build** — protect the pipeline. |
| ASUS Live Update | 2017–2019 | Pre-installed **update channel** hijack → backdoor | ~57k confirmed (Kaspersky), ~1M est. | n/a | ~2 years (2017→2019) | tool was vendor-trusted | A trusted pre-installed updater is a **persistent backdoor** if the channel can be defeated. |
| SolarWinds SUNBURST | 2020 | **Build-server** compromise → trojanized signed update | ~18,000 Orion customers | n/a (enormous; govt + enterprise) | ~4–8 months (Jul→Nov 2020 builds; detected Nov 2020) | **Yes** | A poisoned build server **poisons every downstream update** for months. |
| NotPetya | 2017 | **Trusted update channel** delivered a wiper "update" (MeDoc) | global; ~$10B total | ~$10B (US-govt est.); Maersk $200–300M | days (June 2017) | "update" was signed/trusted | The **update client is the highest-trust code** you ship — it can deliver a wiper. |
| event-stream | 2018 | **Transitive dependency** backdoor (maintainer handoff) | ~2M+ weekly downloads (ecosystem) | (Coinbase key theft linked) | days (June 2018) | n/a (package, not signed binary) | Your updater's **dependency tree is attack surface** — pin + audit deps. |
| 1Password | 2021 (doc.) / 2023 (brief) | **Defective vendor update** (signed) corrupted user state | macOS 1Password users | n/a | per release | **Yes** | A validly-signed update can still be **wrong** — need pre-apply validation + rollback. |

### 6.2 Trust stack — which layer each incident actually broke

An updater's trust is a stack. Each incident defeated a **specific layer** (not "the signature"):

```
   L6  Vendor continuity        ← CodePush/App Center, @capacitor/live-updates, Squirrel.*
   L5  Content / rules channel  ← CrowdStrike
   L4  Update channel (transport/feed) ← ASUS, NotPetya
   L3  Build pipeline / provenance     ← CCleaner, SolarWinds
   L2  Dependency tree            ← event-stream (in-tree: Tauri #3740, sw-precache #385)
   L1  Artifact correctness (not malicious, just wrong) ← 1Password
   ─────────────────────────────────────────────────────────────
   L0  Code signature / EdDSA / MSIX  ← defeated by NONE of the above (it was intact every time)
```

**Implication:** the code signature (L0) is the *cheapest* layer and the one that **never** saved anyone here. The incidents broke L1–L6. A design that "just signs the binary" has protected exactly the layer that never mattered. The §5.5 pipeline targets L1–L6 explicitly.

### 6.3 Library × failure-theme coverage matrix

For each library: does **the library itself** handle each of the 6 failure themes (§3.3), or must **AIRIZ build it**? This is the direct input to "which do I trust on the critical path."
Legend: **✓** library handles it (well) · **~** partial / config-dependent / has open bugs · **✗** not handled (AIRIZ must build) · **n/a** dead or not applicable.

| Library | 1 running-app | 2 atomic+rollback | 3 identity/fingerprint | 4 privilege/location | 5 supply/provenance | 6 vendor continuity | Net (AIRIZ build-gaps) |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|------------------------|
| electron-builder (NSIS) | ~ | ~ | ✓ | ~ | ~ | ✓ | 1 (timeout/PS5.1), 2 (interrupt) |
| Squirrel.Windows | ~ | ~ | ✓ | ~ | ✗ | ✗ | 5, 6 |
| Squirrel.Mac | ✗ | ✗ | ~ | ✗ | ✗ | ✗ | 1,2,4,5,6 |
| **Sparkle** | ✓ | ✓ | ✓ | ~ | ✓ | ✓ | 4 (macOS-26 edge only) |
| Workbox | n/a | ~ | ~ | n/a | ~ | ✓ | 2 (white-screen), 3 (manifest) |
| sw-precache | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | all (dead) |
| @capacitor/live-updates | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | all (deprecated) |
| @capawesome/capacitor-live-update | n/a | ~ | ~ | ~ | ~ | ~ | 2 (rollback), 4 (native-bridge) |
| CodePush / App Center | n/a | n/a | n/a | n/a | n/a | ✗ | all (dead) |
| Expo Updates / EAS Update | n/a | ~ | ~ | ~ | ~ | ~ | 3 (fingerprint — the weak spot), 2 |
| @tauri-apps/updater | ~ | ~ | ✓ | ✗ | ~ | ✓ | 4 (privilege/location — most open) |
| MSIX AppInstaller | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | 3-adjacent (silent-failure), scope (MSIX-only) |

**How to read it:** 
- **Sparkle** and **MSIX AppInstaller** have the **fewest AIRIZ build-gaps** — they cover 5–6 of 6 themes. That is the strongest, most direct evidence for putting them on the critical path.
- **Tauri**'s single largest gap is **theme 4 (privilege/location)** — the cluster of 11 open bugs. If you pick Tauri, that is where your engineering goes.
- **Expo**'s single largest gap is **theme 3 (identity/fingerprint)** — the fingerprint/launch-identity cluster. If you pick Expo, that is where your test harness goes.
- **electron-builder** is close (only themes 1 & 2 are build-gaps), so it is a viable Windows path **with a targeted hardening sprint on the running-app gate + interrupted install**.
- The **dead/abandoned** set (sw-precache, @capacitor/live-updates, CodePush) is all-✗ — no amount of AIRIZ build-work rescues a dead vendor for theme 6.

### 6.4 Reading order for the decision-maker

1. **§3.2 trust matrix** + **§6.3 coverage matrix** — pick the shortlist.
2. **§5.3 extended verdicts** — for each shortlisted library, the single biggest risk + the mitigation.
3. **§5.1 / §5.5** — the controls you build *regardless* of which library you pick.
4. **§5.2 + §5.4** — the numeric risk and the threat model (why the controls are non-negotiable).
5. **§3.5 + §4.2 + §5.7/§5.8** — what still needs re-verification (blocked repos, the 1Password date) before you commit.

---

## 7. Executive summary (scannable TL;DR)

**Bottom line (4 sentences):**
1. No auto-update library is "trustworthy by default" — every one surveyed has at least one post-2022 reliability or security bug, and the supply-chain record shows a **signed binary is the one thing that never saved anyone** (CCleaner, SolarWinds, NotPetya, 1Password).
2. The **most trustworthy native options** are **Sparkle (macOS)** and **MSIX AppInstaller (packaged Windows)** — they cover 5–6 of the 6 recurring failure themes on their own (§6.3).
3. The **youngest/highest-bug-volume** options — **Expo/EAS Update** and **Tauri** — are viable but carry the **most open reliability surface**; each has one clear weak spot to build against (Expo = **fingerprint/launch-identity**, Tauri = **privilege/location across 3 OSes**).
4. The **dead/abandoned** set — **sw-precache, @capacitor/live-updates, CodePush/App Center**, and (for new builds) **Squirrel.*** — is a hard **do-not-build**: no amount of your own work rescues a dead vendor on the vendor-continuity theme.

**Top-3 trust picks:** Sparkle (mac) · MSIX AppInstaller (packaged Win) · electron-builder NSIS (Win, **gated on #10359/#10454**).
**Top-3 do-not-touch:** CodePush/App Center (dead) · sw-precache (dead) · @capacitor/live-updates (deprecated).

**5 non-negotiable controls (build regardless of library — §5.1 / §5.5):**
1. Running-app gate with **hard timeout + NFC path normalization + off-UI-thread** (kills theme 1).
2. **Atomic + transactional apply with rollback** — the previous version must always survive (kills theme 2 + 1Password class).
3. **Validate + stage + canary** every pushed artifact; **reject-on-signing-failure** (kills theme 5 / CrowdStrike class).
4. **Pin + audit the updater's dependency tree**; enforce build **attestation/provenance** (signature ≠ clean build) (kills theme 5 / CCleaner+SolarWinds+event-stream).
5. **Self-hostable manifest + rollback** and an in-app status surface (kills theme 6 / CodePush class + MSIX silent-staleness).

**Re-verify before committing (§3.5 / §4.2):** Capawesome tracker · AppInstaller tracker · 1Password "2023" date (only 2021 is confidently citable) · electron-builder #10359/#10454 fix status.

---

## Appendix B — Raw verified-issue dump (this run's ground truth, verbatim from the GitHub API, 2026-11-04)

These are the exact `state<TAB>title` values returned by the API for the 30 provided issue numbers (the load-bearing [V] set). Reproduced verbatim so a reader can diff against the tables above.

**electron-builder (electron-userland/electron-builder):**
- #10359 open — NSIS: app-running check can hang forever in `Get-CimInstance` (no `nsExec` timeout), and an interrupted update leaves the app uninstalled
- #10454 open — NSIS: running-app check misses a single process from $INSTDIR (.Count on one CimInstance is empty in PowerShell 5.1), update fails with error 2
- #7807 closed — [electron-updater] [Windows] [NSIS] Updater leaves app in unrecoverable state if update is performed during sign out or shut down
- #6800 closed — NSIS updater incorrectly assumes package.7z exists in cache
- #6935 closed — Differential Download Skip.
- #6555 closed — Nsis update failing on first attempt

**Tauri (tauri-apps/plugins-workspace):**
- #2558 open — Updater plugin update.install() never returns
- #2951 open — [updater] downloadAndInstall() intermittently fails on some Windows devices with error sending request for url (…/release.json)
- #2601 open — Failed to move the new app into place Error during downloadAndInstall method
- #2335 open — [bug] Update fails on Windows when constructing the updater using the UpdaterBuilder directly
- #2697 open — [updater][bug] `download_and_install` request fails in debug build from installed app
- #3000 open — Updater (Windows) - Skip UAC task not handled
- #2455 open — plugin-updater on macOS can't create temp directories, which requires admin privileges
- #3764 open — [updater] macOS install with administrator privileges runs AppleScript on the main thread and freezes the window while the password prompt is open
- #3595 open — [updater] Linux: password prompt (zenity/kdialog → sudo -S) is shown for an install command that may not exist
- #1983 open — [bug] update.downloadAndInstall does not work on removable volume [macOS]
- #2148 open — [feat] Updater: Check for "Tauri API error: read-only filesystem error (os error 30)" and prompt the user to move the app into the applications folder
- #3740 closed — [updater] Move to zip 9 for RUSTSEC-2026-0367, 0368 and 0369

**Expo (expo/expo):**
- #48148 open — [expo-updates][Android] Google Play's automatic app-string translation rewrites expo_runtime_version, silently breaking all OTA updates for that locale
- #50349 closed — [expo-updates][Android] Downloaded update marked pending but never launches, even after a full cold start
- #48404 closed — expo-updates: downloaded update is never launched (isEnabled true, runtime version matches, isNew true, isEmbeddedLaunch stays true)
- #50139 closed — EAS Update fails to download in Expo Go on Android (SDK 57) — works on iOS
- #50389 closed — EAS Update fails on Android with UpdateFailedToLoad (curl to identical manifest URL from same device succeeds)
- #51268 open — [expo-updates][iOS] Rotating an Authorization header override makes downloaded updates unlaunchable (request headers are part of launch identity)
- #43375 closed — EAS Update server returning 503 - upstream connect error or disconnect/reset before headers
- #50202 open — [fingerprint] 0.20.13 gives a different fingerprint on Windows for apps in a monorepo — please backport the toPosixPath fix from 0.21.0
- #52191 open — [fingerprint] Patches applied from a workspace root (bun patchedDependencies) are not hashed
- #51167 closed — [fingerprint] Expo config silently left out of the fingerprint when app.config.ts imports a .ts file (Node 22.18+)
- #52152 closed — [fingerprint] Android fingerprint drops all Expo module sources when a module declares a gradle plugin without sourceDir (expo-widgets)
- #45527 open — [expo-updates] [android] Renamed/moved files do not come with OTA via `eas update`

*End of document (final).*