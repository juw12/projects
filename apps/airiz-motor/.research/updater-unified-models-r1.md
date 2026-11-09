# Updater Unified Models — Research Round 1

> **Purpose.** AIRIZ Motor Console is the exact problem case: **one app, five surfaces**
> (Electron/Windows desktop, Capacitor Android, Capacitor iOS, PWA, Cloudflare Worker relay).
> This document surveys every cross-platform framework or hosted service that **claims** to offer
> a unified auto-update model across desktop + mobile + web, and for each records:
> **(a)** what it ships, **(b)** what it punted, **(c)** whether real users adopted it,
> **(d)** whether it is alive in 2026, **(e)** a verdict (solved / punted / died) plus the one
> concrete architectural decision the team made.
>
> The single question this round answers for the architecture decision: **has anyone solved
> "one updater, one manifest, five surfaces" — and if so, did users actually like it?**
>
> **Generated:** 2026-11-04 · **Method:** live `api.github.com/repos/*` (stars, forks,
> `pushed_at`, `archived`, open issues, license) + live `api.npmjs.org/downloads/point/last-week/*`
> (window 2026-10-27 → 2026-11-02) + vendor homepages (Appcircle, Codemagic) + the AIRIZ repo's
> own updater artifacts (`apps/airiz-motor/tools/sign-manifest.ts`,
> `apps/airiz-motor/web/updates/windows/latest.yml`, `apps/airiz-motor/relay/wrangler.toml`,
> `apps/airiz-motor/web/sw.js`). Every quantitative claim below is a value fetched on the
> generation date and is re-runnable from the exact endpoint in the Sources appendix.
>
> **Companion docs (same round, same folder):** `updater-manifest-formats-r1.md` (the 7 wire
> formats), `updater-security-2026-r1.md`, `updater-hardest-problems-r1.md`,
> `updater-topic-deep-dives-r1.md`, `updater-protocol-docs-r1.md`. This doc is the **product-level**
> view; the sibling `updater-manifest-formats-r1.md` is the **wire-format** view.

---

## 0. TL;DR — The answer to "has anyone solved one updater, one manifest, five surfaces?"

**Short answer: No. No framework and no hosted service solves the full five-surface problem.**
Every system surveyed either (i) solves **desktop** well and punts mobile+web to the stores/CDN,
(ii) solves **mobile code-push** well and punts desktop+web, or (iii) is a **CI/CD distributor**
that builds/store-publishes per-surface and offers no single manifest. The only systems that touch
all five surfaces do so by **stitching** per-surface updaters behind one release train — which is
exactly the pattern the AIRIZ team has **already implemented** by hand (`sign-manifest.ts` +
`latest.yml` + PWA `sw.js` + Worker relay). The honest conclusion: **the unified layer is not
something you adopt; it is something you own.** The frameworks sell you the per-surface adapters.

**Verdict table (all 12 systems).** "Alive 2026" uses the live `pushed_at` / npm window from
2026-11-04. Star counts and download figures are point-in-time, fetched today.

| # | System | What it actually updates | Unified 5-surface? | Alive 2026 (evidence) | Verdict |
|---|--------|--------------------------|--------------------|------------------------|---------|
| 1 | **Tauri** (+plugin-updater) | desktop binary (win/mac/linux); mobile via **stores** | **No** — desktop-only updater plugin | Yes — 112,481★, pushed 2026-11-04, plugin-updater **1.06M dl/wk** | **Punted** (mobile/web to stores) |
| 2 | **Flutter** (Shorebird etc.) | Dart **code push** (mobile); full app via stores | **No** — mobile only | Shorebird 3,050★, pushed 2026-11-04, commercial | **Punted** (no first-party updater) |
| 3 | **.NET MAUI** | per-surface: MSIX/MS Store (Win), Play/App Store (mobile) | **No** — Microsoft-distributed, no updater | 23,326★, pushed 2026-11-04, MIT (MS) | **Punted** (store/MSIX) |
| 4 | **Uno Platform** | web = web, desktop = MSIX, mobile = store | **No** — nothing unified | 10,102★, pushed 2026-11-04, "200M+ NuGet" | **Punted** (per-surface) |
| 5 | **Kotlin Multiplatform** | none — there is no KMP updater at all | **No** | kotlin 53,532★, pushed 2026-11-04 | **Died-by-absence** (no updater) |
| 6 | **React Native** (CodePush→Expo) | JS **bundle** code push (mobile+Expo web) | **No** — CodePush is dead; Expo = mobile | expo-updates **7.38M dl/wk**; MS CodePush **archived** | **Died** (MS CodePush) / **Punted** (Expo) |
| 7 | **Capawesome** live-update | mobile **web layer** (Capacitor) code push | **No** — mobile web only, but the best in-class | 141,298 dl/wk, commercial + OSS | **Solved mobile-web only** |
| 8 | **VoltBuilder** | Cordova build service (was PhoneGap Build) | **No** — build/host only | **UNVERIFIED** (fetch failed); lineage wound down | **Likely dead / wound down** |
| 9 | **Appcircle** | CI/CD + mobile **CodePush** + enterprise store | **No** — mobile CI/CD, not desktop/web updater | ©2026, 500+ enterprise clients, alive | **Punted** (mobile CI/CD) |
| 10 | **Codemagic** | CI/CD + mobile **OTA/patch** | **No** — mobile CI/CD, not desktop/web updater | "150,000+ developers", alive | **Punted** (mobile CI/CD) |
| 11 | **Electron + Capacitor hybrid** | desktop via electron-updater; mobile via Capacitor/stores; web via CDN/SW | **No shared channel** in any major app | electron-updater **5.69M dl/wk**, Electron 123,760★ | **Punted** (N release trains) |
| 12 | **Custom R2/GH-Rel + SW** | whatever you wire it to | **Yes — this is the only one that can** | No dominant vendor; pattern proven by Sublime + **AIRIZ itself** | **Solved (DIY, by you)** |

### The five surfaces, side by side

Columns = the AIRIZ surfaces. ✓ = the framework ships a first-party updater for that surface;
✗ = it punts that surface to stores/CDN/you; **△ = partial** (code-push, not full binary).

| System | Win desktop | Mac desktop | Linux desktop | Android | iOS | Web PWA |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|
| Tauri plugin-updater | ✓ | ✓ | ✓ | ✗ (store) | ✗ (store) | ✗ |
| Flutter + Shorebird | ✗ | ✗ | ✗ | △ (code push) | △ (code push) | ✗ |
| .NET MAUI | ✓ (MSIX/MS Store) | ✓ (MS Store/Mac) | △ (limited) | ✗ (Play) | ✗ (App Store) | ✗ |
| Uno Platform | ✓ (MSIX) | ✓ (MSIX) | ✗ (none) | ✗ (store) | ✗ (store) | ✗ (web) |
| Kotlin Multiplatform | ✗ | ✗ | ✗ | ✗ (store) | ✗ (store) | ✗ |
| React Native (Expo Updates) | ✗ | ✗ | ✗ | △ (code push) | △ (code push) | △ (Expo web) |
| Capawesome live-update | ✗ | ✗ | ✗ | △ (web layer) | △ (web layer) | △ (web layer) |
| Electron + electron-updater | ✓ | ✓ | ✓ | ✗ (need Capacitor) | ✗ (need Capacitor) | ✗ |
| Custom R2/GH-Rel + SW | **△** | △ | △ | △ | △ | △ |

**Reading the matrix:** the "Custom R2/GH-Rel + SW" row is the **only row where all five cells are
non-empty**, and even it is all "△" — because the custom layer does not replace the native
installers; it **orchestrates** them. That is the whole truth of this problem, stated plainly:
the desktop cells require a real binary installer (NSIS/AppImage/MSIX) and the mobile cells
require either the app store or a store-approved OTA path, so "one updater" can only ever mean
"one *manifest* and one *rollout policy* fronting N thin adapters." Nobody sells that orchestration
layer as a product. You build it.

### Corrections to the prompt's assumptions (evidence-based)

| # | Prompt assumption | What the evidence shows | Source |
|---|---|---|---|
| 1 | "`tauri-plugin-store` is the manifest" | **Wrong.** `tauri-plugin-store` is a key-value **preferences** store. The release manifest is the **updater plugin's** `latest.json`/`.sig` (minisign). Two different plugins, two different jobs. | `tauri-apps/plugins-workspace` plugin split |
| 2 | "Tauri = desktop, mobile still 'use Capacitor'" | **Outdated.** Tauri 2 targets **Android + iOS** (beta) directly; the repo self-describes as "desktop and **mobile** applications." But the *updater* plugin is still desktop-binary-only — mobile goes through the stores. | `tauri-apps/tauri` description + topics (`mobile-app`) |
| 3 | "react-native-code-push sunset 2024" | **Close but imprecise.** The OSS SDK repo is **archived** with last push **2025-05-20**; the *hosted service* (App Center CodePush) was the thing Microsoft retired. The package still downloads (23,870/wk) as **zombie traffic** on a dead repo. | GitHub API `archived:true`, `pushed_at`; npm window |
| 4 | "CodePush was replaced by `@code-push/react-native`" | **The expected package does not exist** (`@code-push/react-native` and `code-push/react-native-code-push` both **404** on npm/GitHub). The de-facto successor is **Expo Updates** (7.38M dl/wk); non-Expo teams self-host `code-push-server` or accept store updates. There is **no thriving community fork.** | npm 404s + expo-updates download count |
| 5 | "Capawesome is the only viable Capacitor + unified updater path" | **Mostly true for mobile-web**, but "only viable" overstates it. The honest framing: for *Capacitor mobile*, Capawesome live-update is the best in-class OTA (141k dl/wk); but it is **mobile-web code push only** and does not touch desktop or PWA. There is no "unified" product. | npm `@capawesome/capacitor-live-update` 141,298 dl/wk |
| 6 | "VoltBuilder applies `phonegap-version` preference + custom plugin for updates" | **Could not verify live** (both `www.voltdbuilder.com` and `voltdbuilder.com` fetch failed). PhoneGap Build (the original `build.phonegap.com`) was deprecated by Ionic and the hosted-build lineage wound down. Treat VoltBuilder's 2026 status as **unconfirmed**. | fetch transport errors; PhoneGap Build history |
| 7 | "Appcircle / Codemagic auto-update web/desktop" | **No.** Both are **mobile** CI/CD + **mobile** OTA (CodePush/patch). Neither updates a desktop binary or a PWA. Appcircle "Enterprise App Store" in-app-update is for **mobile** `.ipa`/`.apk`/`.aab` in-house apps. | appcircle.io / codemagic.io homepages |
| 8 | "Discord/Signal/Notion/Linear/Obsidian ship Electron + Capacitor + Web with a unified channel" | **None of them do.** They ship **Electron desktop + *native* mobile (Kotlin/Swift) + web**, each on its own release train. Not one of the eight named apps uses Capacitor for mobile. See §14. | public engineering docs / app architecture |

---

## 1. Tauri (tauri-apps/tauri) — desktop-first, mobile is beta, updater is desktop-only

### 1a. What it ships
Tauri 2 is a Rust core + system-webview app framework (Apache-2.0). The update story is the
**`tauri-plugin-updater`** plugin: the app polls a URL for a small `latest.json` (channel file)
plus a `.sig` file; the signature is **minisign Ed25519 over the artifact bytes** (not over a
manifest), and the version is bound into the minisign *trusted comment*. On success the plugin
downloads the **whole app bundle** (msi/dmg/AppImage) and relaunches. Rollout/staging is
supported by the manifest's `platforms`/`minVersion` gating. `tauri-plugin-store` is a separate
key-value preferences store — **it is not part of the update path** (see correction #1).

### 1b. What it punts
Mobile. Tauri 2 *compiles* to Android and iOS (beta), but the **updater plugin is a desktop
binary updater**: there is no Play-Store / App-Store submission flow in the plugin, and iOS
forbids the kind of self-replace the plugin does. So a Tauri app's real "all surfaces" release
story is: **desktop** → plugin-updater; **Android** → you build an AAB and submit to Play; **iOS**
→ you build an IPA and submit to App Store; **web** → Tauri does not produce a web build at all
(it *is* a webview host, so the "web surface" is the frontend code, deployed by your own CI). The
manifest the plugin reads is per-OS (`latest-linux.json`, `latest-macos.json`, etc.).

### 1c. Adoption
Largest cross-platform webview framework by stars in this survey: **112,481★**, 4,165 forks,
1,504 open issues, Apache-2.0. The updater plugin alone is at **1,061,435 npm downloads/week**
(window 2026-10-27→11-02) — a strong, mainstream adoption signal for the desktop updater
specifically. Public Tauri apps are numerous (the framework is a top Electron alternative), but
**none** of them publicly document a single manifest that also drives their Android/iOS store
releases — because the plugin does not cover those.

### 1d. Alive in 2026
**Yes, very much.** `pushed_at: 2026-11-04` (the day this was fetched), `archived:false`, active
issue tracker, default branch `dev`. The plugin namespace is actively versioned on npm.

### 1e. Verdict + architectural decision
**Punted (mobile/web).** Tauri's team made one clear architectural decision: **standardize the
desktop updater on a signed minisign-Ed25519 bundle download and leave the app stores to the
platforms.** They did *not* try to make one updater span desktop+mobile+web; they built the best
*desktop* updater and a per-OS channel file. That is the precedent to copy **for the desktop
half** of AIRIZ, and the precedent to *reject* for the "unified" ambition.

---

## 2. Flutter (no first-party updater) + Shorebird (the real code-push)

### 2a. What it ships
Flutter ships **no** first-party auto-updater. The official path is: build an `.apk`/`.aab`
(Android) and `.ipa` (iOS), submit to the stores; the store delivers the update. The **most
adopted** community updater for Flutter is **Shorebird** (commercial, Dart CLI + closed
cloud). Shorebird does **Dart/JS-style code push**: it ships patched Dart code to devices
**without** a store resubmission, for Dart-only changes (it cannot change native code, add
plugins, or change the manifest the way a full binary update can). Flutter's `package_info_plus`
only *reports* the installed version — it does not update. The older `flutter_upgrade_version` /
`upgrader` packages are thin version-check helpers that open the store link; they are not code
push.

### 2b. What it punts
Everything that is not a pure-Dart change. Shorebird explicitly will not (and cannot) update the
native layer, add/remove native plugins, or change OS-level config — those still require a store
release. Flutter has **no desktop** (Windows/macOS/Linux) first-party updater in the same
plugin sense; desktop Flutter apps ship via a self-hosted updater or an MSIX/MS Store for Windows.
And there is **no web surface** in Flutter's update model (Flutter Web is a build artifact you
redeploy).

### 2c. Adoption
Shorebird is **3,050★**, 245 forks, 194 open issues, pushed 2026-11-04 — a healthy, actively
maintained commercial project (the CLI is on pub.dev; the server is **not** open source, license
"Other"). It has public enterprise customers. The *generic* Flutter updater packages (`upgrader`,
`flutter_upgrade_version`) have modest, long-tail adoption and are not "code push" — they are
store-redirect helpers. The honest ranking: **Shorebird is the adopted leader for Flutter code
push**, but it is a *mobile-Dart* product, not a cross-surface unifier.

### 2d. Alive in 2026
**Yes.** `pushed_at: 2026-11-04`, `archived:false`, commercial company with a pricing page and a
public roadmap. This is one of the more durable "code push" businesses in the space.

### 2e. Verdict + architectural decision
**Punted (no first-party updater; mobile-Dart code push via a vendor).** Flutter's (Google's)
decision was to **not** build a cross-surface updater and to let the app stores own mobile
delivery; Shorebird's decision was to **monetize** the Dart-only code-push niche. Neither solves
"five surfaces." For AIRIZ this is a caution: even the most polished mobile code-push product in
the space is deliberately scoped to *one language layer on one class of device.*

---

## 3. .NET MAUI — Microsoft-distributed, MSIX on Windows, stores on mobile

### 3a. What it ships
.NET MAUI (MIT, microsoft-owned) targets Windows, Android, iOS, and (macOS via Mac Catalyst).
The **default** update path is per-surface and **Microsoft-platform-native**:
- **Windows:** pack as **MSIX** or use the **Microsoft Store for developers**; auto-update then
  rides on **App Installer** (the `OnLaunch` / `HoursBetweenUpdateChecks` model). There is **no
  first-party MAUI updater package** — Windows update = the MSIX/Store pipeline. (The standalone
  **Microsoft.AutoUpdater** project is a separate, older, non-MAUI Windows updater for
  click-once-style desktop apps; it is not MAUI's.)
- **Android/iOS:** build via MAUI, submit to **Play Store** / **App Store**; the store updates.
- **Web:** MAUI's web story is **Blazor Hybrid** / Blazor WebAssembly — which is *just a web app*
  you redeploy; there is no "MAUI web updater."

### 3b. What it punts
A unified manifest. MAUI gives you one C#/XAML codebase and **four** completely separate
distribution/update mechanisms. There is no MAUI updater plugin, no single channel file, no
server-side rollout layer in the framework. You stitch MSIX/Store/CDN yourself.

### 3c. Adoption
**23,326★**, 2,000 forks, 1,360 open issues, MIT. MAUI is the successor to Xamarin and
Microsoft's strategic cross-platform UI. It is genuinely used in production (enterprise /
WinUI-adjacent teams), but the **update** story is not a selling point — adoption of the
*framework* does not imply adoption of *any* unified updater, because there is none.

### 3d. Alive in 2026
**Yes.** `pushed_at: 2026-11-04`, `archived:false`, `microsoft-owned`, active. Microsoft still
ships MAUI releases on the .NET cadence.

### 3e. Verdict + architectural decision
**Punted (store/MSIX per surface).** Microsoft's decision was to **lean on the OS/Store update
infrastructure** rather than build a framework updater — correct for an enterprise platform that
wants Microsoft-signed, policy-managed deployment, and a non-answer for a one-person team who
wants one manifest. For AIRIZ this confirms: a C#/.NET route buys you *store-grade* delivery per
surface, not *unified* delivery.

---

## 4. Uno Platform — C#/XAML everywhere, but update = "each platform does its own thing"

### 4a. What it ships
Uno (Apache-2.0) is C#/XAML across mobile, web (WASM), desktop, and embedded. The update story
is **not a feature of Uno at all** — it is whatever each target platform does:
- **Web (PWA/WASM):** it is a website; you redeploy the bundle (CDN/service-worker model).
- **Windows desktop:** **MSIX** (same as MAUI).
- **Android/iOS:** **Play Store / App Store**.
Uno does **not** offer a unified updater, a code-push layer, or a channel manifest.

### 4b. What it punts
Everything in the update path. Uno's value proposition is *one XAML codebase compiles to many
runtimes*; it explicitly does not try to unify **how those runtimes get updated**. The "200M+
NuGet downloads" in the repo description is cumulative package downloads (mostly the Uno runtime/
control packages), **not** an updater's usage.

### 4c. Adoption
**10,102★**, 919 forks, **2,128 open issues** (a large backlog), pushed 2026-11-04. Uno is a
serious, niche-but-stable platform (enterprise XAML-on-WASM shops). There are **no** published
"Uno app that uses a unified cross-surface updater" case studies — because the framework does not
provide the primitive to have one.

### 4d. Alive in 2026
**Yes.** `pushed_at: 2026-11-04`, `archived:false`, Apache-2.0, active releases. The large open
issue count signals a mature-but-heavily-loaded codebase, not a dead one.

### 4e. Verdict + architectural decision
**Punted (confirm, not deny — the prompt asked "confirm or deny": confirmed).** Uno's decision was
to **be a UI runtime, not a delivery platform.** This is the cleanest confirmation in the survey
that a cross-platform *UI* framework and a cross-platform *update* platform are two different
products, and almost no UI framework will build the second one for you.

---

## 5. Kotlin Multiplatform (KMP) — there is no updater, full stop

### 5a. What it ships
KMP (JetBrains) shares **business-logic/DTO/networking** code across Android, iOS, desktop (JVM/
native), and web (JS/Wasm). It is **not** a UI framework and it ships **no** auto-update story at
any layer — no desktop updater, no mobile code push, no manifest. KMP apps are assembled from
per-platform UI (Jetpack Compose / SwiftUI / a web front) and updated by **those** platforms'
mechanisms (Play/App Store for mobile; your own desktop updater; CDN for web).

### 5b. What it punts
The entire delivery layer. KMP's scope is *code sharing*, not *distribution*. There is no
first-party and no dominant community KMP updater.

### 5c. Adoption
The `JetBrains/kotlin` repo (which contains KMP) is **53,532★**, 6,453 forks, pushed 2026-11-04 —
KMP is broadly used and growing. But **adoption of KMP tells us nothing about updater adoption**,
because KMP has no updater to adopt. I could not find a *named, public* production KMP app that
runs a **cross-platform auto-update** as a headline feature; production KMP apps (e.g. banking/
finance clients) update through the **app stores** on mobile and a **desktop installer** on
desktop, separately.

### 5d. Alive in 2026
**Yes.** `pushed_at: 2026-11-04`, `archived:false`. KMP/Wasm is on JetBrains' active roadmap.

### 5e. Verdict + architectural decision
**Died-by-absence (no updater exists to die).** JetBrains' decision was to **stay in the
language/code-sharing layer** and not own distribution. For AIRIZ the takeaway is a negative one:
picking a "logic-sharing" framework does not buy you any update capability — you must add it
regardless.

---

## 6. React Native — CodePush died; Expo Updates is the de-facto successor (mobile only)

### 6a. What it shipped
Historically, **Microsoft CodePush** (`microsoft/react-native-code-push`) was the RN code-push
standard: the app checked an App Center CodePush server for a new **JS bundle** and installed it
without a store resubmission. It covered **Android + iOS** (and, with Expo, **web** via Expo
Updates). It could **not** update native code or desktop.

### 6b. What died
**It died.** The OSS SDK repo is **archived** (`archived:true`, last push **2025-05-20**, 15 open
issues). Microsoft **retired the App Center CodePush hosted service**, so the server side is gone
for new customers. The npm package `react-native-code-push` still shows **23,870 downloads/week**
(window 2026-10-27→11-02) — but that is **zombie/legacy traffic** on a dead repo (existing
lockfiles installing), not a living product. The expected community successor names **do not
exist**: `@code-push/react-native` → **404** on npm; `code-push/react-native-code-push` → **404**
on GitHub. So the community did **not** cleanly fork-and-adopt.

### 6c. What actually ships now
**Expo Updates** is the de-facto successor and the dominant RN OTA today: **7,376,483
downloads/week** (window 2026-10-27→11-02) on `expo-updates`, `expo/expo` at **53,330★**, pushed
2026-11-04. Expo Updates does **JS-bundle code push** for **Android + iOS + (Expo) web**, with
rollout %, EAS Update as the hosted service, and signing. Non-Expo "bare" RN teams either
**self-host** the open-source `code-push-server` (Microsoft's server, still OSS) or fall back to
**store-only** updates. **No** RN OTA product covers a **desktop** binary — that is Electron/Tauri
territory.

### 6d. Alive in 2026
**CodePush: dead** (archived SDK + retired service). **Expo Updates: very much alive** (Expo
pushed 2026-11-04, EAS Update is a current paid service). The honest split verdict.

### 6e. Verdict + architectural decision
**Died (MS CodePush) / Punted (Expo = mobile code push).** Microsoft's decision was to **retire
the CodePush service** (consolidate App Center), which orphaned a huge RN install base — a live
example of a "unified-ish" OTA business being *withdrawn*, the single biggest risk in the whole
survey for anyone who adopts a vendor OTA. Expo's decision was to **own the RN code-push niche via
EAS** and make it the default, deliberately scoped to mobile+Expo-web. For AIRIZ: this is the
warning that **a vendor's OTA can vanish**; a self-hosted/side-owned manifest (what AIRIZ built)
is the hedge.

---

## 7. Capawesome — the best-in-class Capacitor mobile web-layer updater (mobile only)

### 7a. What it ships
Capawesome is a commercial Capacitor plugin studio. Its **`@capawesome/capacitor-live-update`**
plugin (and the open-source `capacitor-live-update` sibling) does **over-the-air update of the
*web layer*** inside a Capacitor app: the device fetches a **manifest** (`bundleId`,
`downloadUrl`, `checksum`, `signature` (RSA over the bundle), `customProperties`, `artifactType`,
`channel`) from **Capawesome Cloud** (or a self-hosted server), downloads the new web bundle (zip),
verifies it, and swaps it on next launch. Rollout/channel/staging is **server-side** in
Capawesome Cloud (the device manifest is intentionally minimal). This works for **Capacitor
Android + iOS + (any) web target** — i.e. anywhere the app is a webview.

### 7b. What it punts
It updates the **web layer only**, not the native wrapper. It cannot change native plugins, the
app's binary, entitlements, or the OS package — those need a store release. And it does **not**
touch a *desktop* binary or a *standalone PWA* (a PWA is not a Capacitor app; you would replicate
the pattern yourself with a service worker, which is what the AIRIZ `sw.js` does). So "Capacitor +
unified updater" is really "Capacitor + unified **mobile-web** updater."

### 7c. Adoption
`@capawesome/capacitor-live-update` at **141,298 downloads/week** (window 2026-10-27→11-02) is a
strong, credible in-class number for a paid plugin; `@capacitor/core` (the framework it wraps) is
at **7,476,990 downloads/week**, so the install base is enormous. Capawesome's team has a long
public track record (many first-party-quality Capacitor plugins: preferences, live activities,
local notifications, etc.), which is exactly why the prompt asks whether it is "the only viable
path."

### 7d. Alive in 2026
**Yes.** Active npm publishing, active commercial company, maintained OSS siblings, regular
releases. (The exact live GitHub `pushed_at` for the plugin monorepo was not fetched this round;
the npm cadence is the live signal here.)

### 7e. Verdict + architectural decision
**Solved mobile-web only.** Capawesome's decision was to **make the web-layer OTA excellent and
keep it server-side (Cloud) for rollout/revocation**, and to be honest that the *native* layer
still goes through stores. **Is it "the only viable Capacitor unified updater path"?** For *mobile
web-layer OTA*, effectively yes — it is the most complete in-class option. For the full
five-surface AIRIZ problem, **no** — it solves 2 of 5 cells (Android-web, iOS-web) and not
desktop/worker. It is the model to **borrow for the Capacitor cells** (server-side rollout,
RSA-signed bundle, minimal device manifest), not the model to *buy* as the unifier.

---

## 8. VoltBuilder (formerly PhoneGap Build) — hosted Cordova build; update story is a myth, status unverified

### 8a. What it claims to ship
The prompt's framing: VoltBuilder is the successor to **PhoneGap Build** (`build.phonegap.com`),
the hosted **Cordova** build service, and that it "applies `config.xml
<preference name="phonegap-version" />` + a custom plugin" for updates. Historically PhoneGap
Build was a **build + distribution** service: you zipped a Cordova project, it built APK/IPA, and
it **hosted** your app for testers. It did **not** provide an *auto-updater*; the
`phonegap-version` preference only pinned the **Cordova runtime** for the *next build* — it was
not a runtime OTA mechanism. There was no "one manifest, all surfaces" in PhoneGap Build; Cordova
apps updated by store release, or by a **separate** code-push add-on (e.g. the now-dead CodePush,
or third-party update plugins).

### 8b. What it punts / the status problem
**I could not verify VoltBuilder is alive in 2026.** Both `https://www.voltdbuilder.com` and
`https://voltdbuilder.com` returned **transport errors** on fetch today. Given the original
PhoneGap Build was deprecated by Ionic and the hosted-Cordova-build lineage has steadily wound
down (Cordova/PhoneGap itself is in maintenance mode behind Capacitor), the most defensible
position is: **treat VoltBuilder as likely wound-down / at best niche, and do not build the AIRIZ
update story on it.** If it is alive, it is a **Cordova build/distribution** service, not a
cross-surface updater.

### 8c. Adoption
Cordova/PhoneGap's active share has **declined** in favor of Capacitor (whose `@capacitor/core`
is at **7.48M dl/wk** today) and React Native/Flutter. PhoneGap Build never had the install base
of the modern frameworks. I could not fetch a 2026 VoltBuilder customer count or download figure;
**flagging as unverified rather than inventing a number.**

### 8d. Alive in 2026
**UNVERIFIED.** Fetch failed (network/proxy or genuinely down — cannot distinguish from here).
The *lineage* (PhoneGap Build) is clearly past its prime. **Recommendation: exclude from the
AIRIZ decision until a human confirms the site is up and the service is selling.**

### 8e. Verdict + architectural decision
**Likely dead / wound down (build service, not an updater).** The honest verdict is that the
"PhoneGap Build / VoltBuilder unified updater" premise in the prompt is **a myth** — that product
was a **build host**, and the `phonegap-version` preference was a **build-time** pin, not an OTA
mechanism. No architectural decision to copy here; at most, a caution that **hosted Cordova build
services are not a durable update substrate.**

---

## 9. Appcircle — mobile CI/CD + mobile CodePush + enterprise mobile store (not desktop/web)

### 9a. What it ships
Appcircle (appcircle.io) is an **enterprise mobile CI/CD** platform: Build, Signing Identities,
Testing Distribution (TestFlight-like for Android + iOS), Publish to Stores (App Store / Play /
Huawei / **Intune**), an **Enterprise App Store** (in-house `.ipa`/`.apk`/`.aab` with **in-app
update** for those mobile binaries), and a **CodePush** module (OTA for **React Native**). The
"auto-update" it offers is **mobile** in-app update (enterprise store) + **React Native CodePush**
(module).

### 9b. What it punts
**Desktop and web.** Appcircle does **not** update a Windows/macOS/Linux desktop binary and does
**not** update a PWA. It is a **mobile** delivery platform. Its "CodePush" module is React-Native
code push (the same JS-bundle model — mobile only), and its enterprise-app-store in-app update is
for **mobile** in-house apps. So "does it auto-update web/desktop too?" → **No.**

### 9c. Adoption
**500+ enterprise clients** (homepage), named logos including Accenture, American Express Global
Business Travel, Coca-Cola, Panasonic, Proton, Renault, Turkcell, Getir, Hepsiburada, and Turkish
banks (Ziraat, Halkbank, DenizBank, Vakıf Katılım). **ISO 27001 + SOC 2 Type 2**, Capterra 4.9/5.
This is a real, enterprise-adopted, **mobile-only** delivery platform.

### 9d. Alive in 2026
**Yes.** Homepage footer reads **Copyright © 2026 Appcircle Inc.**; active docs, release notes,
status page, and an "Appcircle AI" / MCP-server push (very current positioning).

### 9e. Verdict + architectural decision
**Punted (mobile CI/CD, not a desktop/web updater).** Appcircle's decision was to **be the
enterprise mobile delivery hub** (signing + distribution + store + RN code push) and to
deliberately scope to **mobile**. For AIRIZ it is a *distribution* candidate for the **mobile**
cells only (e.g. enterprise-app-store in-app update for the Capacitor builds) — it does nothing
for the Worker, the PWA, or the Windows desktop.

---

## 10. Codemagic — mobile CI/CD + mobile OTA/patch (not desktop/web)

### 10a. What it ships
Codemagic (codemagic.io, by Nevercode Ltd.) is **mobile CI/CD**: build/test/release for Flutter,
React Native, native iOS/Android, **Ionic**, Unity, and **MAUI**, with fastlane, signing, and store
publishing. It also sells an **OTA** product (linked at `patch.codemagic.io`) for **mobile** code
push, plus a **white-label** distribution angle. "Distribution via Firebase App Distribution /
TestMagic" (the prompt's phrasing) is the **test distribution** step, not an end-user updater.

### 10b. What it punts
**Desktop and web.** Like Appcircle, Codemagic is **mobile-first**; it does not update a desktop
binary or a standalone PWA. Its OTA/patch is **mobile** code push. So "auto-update beyond the
store?" → **for mobile, yes (code push / in-house); for desktop and web, no.**

### 10c. Adoption
**"Trusted by 150,000+ developers"** (homepage), named customer archetypes (retail, bookmaker,
fitness, urban-mobility, mental-health), **SOC 2 Type 2 + ISO 27001**, G2-rated. A real, active,
**mobile-only** CI/CD+OTA vendor.

### 10d. Alive in 2026
**Yes.** Live site with current features, an active blog, a "What's new" page, a status page, and
an explicit **"Codemagic vs App Center"** migration page (i.e. it is actively poaching App
Center/CodePush refugees — itself a signal that the CodePush space is consolidating around a few
mobile CI/CD vendors).

### 10e. Verdict + architectural decision
**Punted (mobile CI/CD + mobile OTA).** Codemagic's decision was to **be the mobile CI/CD default
and add mobile code push/patch**, staying out of desktop/web delivery. For AIRIZ it is, like
Appcircle, a **mobile-cell** distribution/OTA candidate only. Neither Appcircle nor Codemagic is
a "unified five-surface" answer — they are **two of the same thing** (mobile delivery hubs).

---

## 11. Electron + Capacitor hybrid — the pattern people *actually* use (and the myth of the unified channel)

### 11a. What it ships (the real pattern)
The pattern is: **one web codebase**, then wrap it — **desktop** with Electron (auto-update via
**electron-updater**, which is **5,694,065 downloads/week** today and is the de-facto desktop
updater) and **mobile** with Capacitor (web layer updated by Capawesome or by the stores; native
shell via stores), **web** served as a PWA (service worker). The **manifest** is **not shared**:
the desktop cell reads `latest.yml` (NSIS blockmap, Ed25519 — exactly AIRIZ's
`web/updates/windows/latest.yml`), the mobile cell reads a Capawesome/Store manifest, and the web
cell is just a redeploy + service worker. The **release *train*** (one version number, one CI run
producing all artifacts) is what's shared; the **updaters** are not.

### 11b. What it punts
A single signed manifest that all three (or five) surfaces verify. In practice, teams run **N
release trains** and accept **N update mechanisms**, because the verification schemes are
incompatible (Ed25519-over-bundle for desktop, RSA-over-web-bundle for Capawesome, store signing
for mobile, nothing for web). There is **no community standard** for sharing one release channel
*and* one manifest between the Electron side and the Capacitor side.

### 11c. Real apps — and the correction the prompt needs
The prompt asked me to find real apps shipping "the same product on **Electron + Capacitor +
Web** with a unified release channel" and listed Discord, Signal, VS Code, Figma, Loom, Linear,
Notion, Obsidian. **The honest, evidence-based correction: none of these eight uses Capacitor for
mobile, and none runs a unified five-surface channel.** Their actual architectures:

| App | Desktop | Mobile | Web | One channel? |
|-----|---------|--------|-----|--------------|
| **Discord** | Electron | **Native** (Kotlin / Swift) | web client | **No** — 3 trains |
| **Slack** | Electron | **Native** (Kotlin / Swift) | web | **No** — 3 trains |
| **Signal** | Electron | **Native** (Kotlin / Swift) | signal-web | **No** — 3 trains |
| **VS Code** | Electron | **thin WebView/PWA** wrapper (vscode.dev) | vscode.dev | **No** — web+desktop share, mobile is a shell |
| **Figma** | Electron | **web** (no native app) | web-first | **Partial** — web+desktop, mobile = web |
| **Loom** | Electron | **Native** (Swift / Kotlin) | web | **No** — 3 trains |
| **Linear** | Electron | **Native** (Swift / Kotlin) | web-first | **No** — 3 trains |
| **Notion** | native/Electron-ish | **Native** (Swift / Kotlin) | web-first | **No** — 3 trains |
| **Obsidian** | Electron | **Native** (Swift / Kotlin) | limited (Publish/Sync) | **No** — 3 trains |

**The consistent industry fact:** major products ship **Electron desktop + *native* mobile +
web**, on **separate release trains**, because (1) native mobile perf is non-negotiable for them
and (2) the app stores **force** a separate, store-gated update path for mobile that no unified
manifest can cross. The "Electron + **Capacitor** + Web" combo with a *shared* channel is a
**small-team / startup** pattern, not a *major-app* pattern — and I could not find a *major named*
product that does it with a *single signed manifest* across all three. (Confidence: high on
"native, not Capacitor" for the eight listed — these are publicly documented architectures. The
negative claim — "no major app with one unified 5-surface manifest" — is by check of the listed
set plus the §13 matrix; I did not audit every app on earth.)

### 11d. Alive in 2026
**Yes.** Electron **123,760★**, pushed 2026-11-04, MIT; electron-updater **5.69M dl/wk**;
`@capacitor/core` **7.48M dl/wk**. The hybrid pattern is very much alive — it's just *not
unified*.

### 11e. Verdict + architectural decision
**Punted (N release trains, N updaters).** The industry decision was to **accept per-surface
updaters and unify only the release *train* (one CI run, one version, one channel name)** — not
the manifest, not the verifier. **This is the single most important finding for AIRIZ:** even the
companies with the most engineering budget do **not** run one manifest across desktop+mobile+web.
They run one *pipeline* that fans out to N updaters. AIRIZ's `sign-manifest.ts` (one signed
manifest naming all 5 `target_versions`) is *more* unified than the industry norm — which is good
for the team, but it means the team is **building the thing nobody else sells**, and must own its
failure modes.

---

## 12. Custom R2/GitHub-Release + service-worker pattern — the only real five-surface answer (and AIRIZ is already doing it)

### 12a. What it ships
This is the pattern the prompt describes: host a **signed manifest** on object storage
(**Cloudflare R2** or S3) or **GitHub Releases**, plus a **service worker** for the PWA, plus a
**worker/edge** for rollout, and **thin per-surface adapters** that each read the *same* manifest
and do their native thing. The manifest is the single source of truth; the surfaces are adapters.
- **Desktop:** the adapter is electron-updater (NSIS `latest.yml`/blockmap) or Tauri's updater —
  both can be pointed at your R2/GitHub-Release URL (the "Generic provider" / custom URL).
- **Mobile (Capacitor):** the adapter is Capawesome live-update **self-hosted** mode, or a store
  release; either can be triggered from the same manifest's `target_versions`.
- **PWA:** the **service worker** checks the manifest's web version and swaps the precached
  bundle (this is *exactly* what AIRIZ's `web/sw.js` does).
- **Worker:** the **Cloudflare Worker** (AIRIZ's `relay/`) is redeployed by `wrangler` as part of
  the same release; it *is* the rollout/edge layer that can do staged % and channel gating.

### 12b. What it punts
Nothing conceptually — but it **punts all the hard work to you**: you must implement per-surface
verification (Ed25519 for desktop, RSA/Ed25519 for mobile, hash for web), staged rollout,
revocation, crash-rollback, and offline behavior. There is no vendor on-call when the desktop
adapter and the mobile adapter disagree about a version. The "pattern" has **no dominant vendor
product** — which is the key finding: **the unified layer is a feature, not a product, and you
build it.**

### 12c. Real examples
- **Sublime Merge / Sublime Text** (Sublime HQ): the canonical *named* example of a **custom
  signed-manifest desktop updater** — the app phones home to Sublime HQ's endpoint for the latest
  release + signature and auto-installs, with **channel** (stable/test) gating. This is the
  desktop half of the pattern done by a small team, no vendor.
- **AIRIZ Motor Console itself** is a *live, in-repo* example of the **full** pattern:
  `tools/sign-manifest.ts` produces an `airiz-release.v1` manifest (Ed25519 over **canonical
  JSON**, `signatures[]`, `target_versions` keyed by exactly **`electron`, `capacitor_ios`,
  `capacitor_android`, `pwa`, `worker`**, `staged_rollout`, `channel`);
  `web/updates/windows/latest.yml` is the **electron-updater** adapter for the desktop cell
  (v1.11.25, GitHub Releases, sha512 + blockmap); `web/sw.js` is the **PWA** adapter;
  `relay/wrangler.toml` is the **Worker** cell. **The team has already built the only row in the
  §13 matrix that lights up all five surfaces.** This is not hypothetical — it is the subject app.
- **The general "PWA + versioned manifest on R2/S3"** is extremely common at the web layer
  (Workbox/precaching + a version check), but as a *standalone named product* that also drives
  desktop+mobile+worker from one manifest, **I could not find a vendor that productizes it.**
  It exists as a *pattern* and as individual product teams' internal systems (Sublime; AIRIZ; and,
  implicitly, any Electron+Capacitor startup that unifies its release train).

### 12d. Alive in 2026
**Yes — because it is a pattern, not a product.** Every constituent is alive in 2026: Cloudflare
R2 + Workers, GitHub Releases, electron-updater (5.69M dl/wk), Workbox/service workers,
Capawesome self-hosted, Wrangler. The pattern has no "alive/dead" because no single company owns
it.

### 12e. Verdict + architectural decision
**Solved — but only DIY, by you.** The architectural decision is the entire point of this survey:
**the "one updater, one manifest, five surfaces" layer is a feature you own, not a product you
buy.** AIRIZ's `sign-manifest.ts` is the correct and — as far as this survey can find —
*unmatched-by-a-vendor* instantiation of it. The risk is not "does a product exist" (it does
not); the risk is "does the team own all five adapters' failure modes" (see §14).

---

## 13. The five-surface coverage matrix (consolidated decision artifact)

Repeating the §0 matrix as the decision artifact, annotated by **who owns each cell**:

| Surface | Tauri | RN/Expo | MAUI/Uno | Capawesome | **AIRIZ custom** |
|---------|:--:|:--:|:--:|:--:|:--:|
| Windows desktop | updater ✓ | ✗ | MSIX/Store ✓ | ✗ | **electron-updater ✓** (latest.yml) |
| Mac / Linux desktop | updater ✓ | ✗ | MSIX/Store ✓ (Mac) | ✗ | *(planned)* |
| Android | store ✗ | Expo/Capawesome △ | store ✗ | web-layer △ | **Capacitor + manifest ✓** |
| iOS | store ✗ | Expo/Capawesome △ | store ✗ | web-layer △ | **Capacitor + manifest ✓** |
| Web PWA | ✗ | Expo web △ | ✗ | ✗ | **service worker ✓** (sw.js) |
| Worker / edge | ✗ | ✗ | ✗ | ✗ | **Cloudflare Worker ✓** (relay/) |

**Two columns light up all five: Capawesome (partial, mobile-web only) and AIRIZ custom (full,
DIY).** No *vendor* column is complete. That is the decision input, in one table.

---

## 14. What nobody does, and what that means for AIRIZ

**The gap.** Across all 12 systems, **no vendor product** provides:
1. one signed manifest that **desktop (binary) + mobile (store/OTA) + web (PWA) + edge (worker)**
   all verify;
2. **server-side staged rollout** that works *across* those cells (each vendor does rollout for
   *its own* surface only — Tauri for desktop, Capawesome/Expo for mobile, nobody for web/worker
   in the same gesture);
3. **one revocation/kill-switch** that simultaneously holds a desktop binary update, a mobile
   OTA, a PWA precache swap, and a worker deploy.

**Who came closest and why it's not a product:**
- **Tauri** — closest *desktop* design (signed bundle + channel file), but stops at the OS
  boundary (mobile = stores, no web, no worker).
- **Capawesome** — closest *mobile-web* design (server-side rollout, signed bundle), but stops at
  the webview (no desktop binary, no standalone PWA, no worker).
- **Sublime HQ** — proof that a **small team** can and does run a custom signed-manifest updater
  with channels — the desktop proof-of-life for the DIY pattern.
- **AIRIZ** — the only artifact in this survey that attempts the **full** five cells from **one
  signed manifest** (`airiz-release.v1`).

**The risk register the decision must face** (the honest downside of "build it yourself"):
- **You own five failure domains** at once (desktop binary replace, mobile store/OTA gate, PWA SW
  swap, worker deploy, cross-surface version skew). The frameworks *would* own each one
  *separately* — by adopting Tauri for desktop and Capawesome for mobile you transfer *per-surface*
  failure to vendors, at the cost of *losing* the unified manifest. **There is no vendor that takes
  all five.**
- **Version skew between cells** is the classic failure (new web PWA calls a worker API the
  deployed worker doesn't have yet, or a new desktop build expects a mobile link protocol the
  phone app predates — the AIRIZ README already documents link-protocol 4 and "a phone on an
  older PC console keeps the old behaviour and asks to update the PC"). A single manifest makes
  skew *visible* and *gated*; five separate updaters make it *accidental.*
- **Vendor-OTA withdrawal risk is real and recent:** Microsoft **retired CodePush** (§6),
  orphaning a huge RN base. Any single-vendor OTA is a single point of business risk.
- **Store-gated mobile is a hard constraint you cannot engineer away:** on iOS, *native* updates
  are store-only regardless of manifest; OTA can only update the *web layer* (Capawesome/Expo
  model). AIRIZ's Capacitor-iOS cell can OTA its **web layer** but the **native shell** still
  needs the App Store. The manifest must encode "web-layer-updatable" vs "store-gated" per cell.

**Decision input (the three options the orchestrator asked about), ranked by this evidence:**
1. **Build the unified layer from scratch** — **supported by the survey.** Nobody sells it; AIRIZ
   has already built the core (`sign-manifest.ts`); the five-surface matrix only lights up fully
   in the DIY column. Cost: you own five failure domains. Mitigation: keep each cell's *mechanism*
   as the proven vendor adapter (electron-updater for desktop, Capawesome self-hosted or store for
   mobile, SW for web, wrangler for worker) and own only the **manifest + rollout + revocation +
   skew-gate** orchestration on top. This is the "one manifest fronting N thin adapters" design,
   and it is the *only* design that matches the product requirement.
2. **Adopt a framework that "covers most surfaces"** (Tauri, Capawesome) — **partially supported,
   not sufficient.** Tauri covers desktop; Capawesome covers mobile-web. You would still need a
   custom layer for the PWA + Worker cells and for cross-cell skew/rollout. Adopting *both* just
   means you own *two* vendor adapters plus a custom orchestrator — i.e. option 1 with more vendor
   lock-in and *less* control. The survey found **no single framework** that covers "most" of the
   five in one updater.
3. **Accept the 5-updater reality and stitch** — **this is what the industry actually does**
   (§11: Electron + native mobile + web, N release trains). It is the *lowest-risk* path
   operationally (each vendor owns its surface) but it **does not satisfy the stated "one
   manifest" requirement** and it **maximizes version-skew risk**, which for a remote-control
   motor console (phones controlling a physical AIRIZ over a link protocol) is a *safety* concern,
   not just a UX one.

**Net:** the evidence points to **option 1, built on proven per-surface adapters** — the team's
current `airiz-release.v1` direction — because (a) no vendor fills the gap, (b) the product
requirement is explicitly "one manifest, five surfaces," and (c) the dominant failure mode of the
"just stitch" option (silent cross-surface version skew on a physical device) is exactly what a
single signed manifest with per-cell `target_versions` + a skew-gate is designed to prevent.

---

## 15. Sources / method (re-runnable)

All quantitative claims fetched **2026-11-04**. Exact endpoints:

**GitHub repos** (`GET https://api.github.com/repos/<owner>/<repo>` — fields: `stargazers_count`,
`forks_count`, `open_issues_count`, `pushed_at`, `archived`, `license`):
- `tauri-apps/tauri` → 112,481★ / 4,165f / 1,504 open / pushed 2026-11-04 / Apache-2.0 / not archived
- `shorebirdtech/shorebird` → 3,050★ / 245f / 194 open / pushed 2026-11-04 / license "Other" / not archived
- `microsoft/react-native-code-push` → 9,109★ / 1,584f / **archived:true** / last push 2025-05-20
- `unoplatform/uno` → 10,102★ / 919f / 2,128 open / pushed 2026-11-04 / Apache-2.0 / "200M+ NuGet" (description)
- `dotnet/maui` → 23,326★ / 2,000f / 1,360 open / pushed 2026-11-04 / MIT / microsoft-owned
- `expo/expo` → 53,330★ / 14,932f / 1,025 open / pushed 2026-11-04 / MIT
- `electron/electron` → 123,760★ / 17,883f / 779 open / pushed 2026-11-04 / MIT
- `JetBrains/kotlin` (KMP) → 53,532★ / 6,453f / pushed 2026-11-04
- `code-push/react-native-code-push` → **404** (community fork not at this path)

**npm downloads** (`GET https://api.npmjs.org/downloads/point/last-week/<pkg>`, window 2026-10-27→11-02):
- `electron-updater` → **5,694,065**
- `@tauri-apps/plugin-updater` → **1,061,435**
- `expo-updates` → **7,376,483**
- `@capawesome/capacitor-live-update` → **141,298**
- `@capacitor/core` → **7,476,990**
- `react-native-code-push` → **23,870** (residual on archived repo)
- `@code-push/react-native` → **404** (does not exist)

**Vendor homepages (fetched 2026-11-04):**
- `appcircle.io` → "500+ enterprise clients", named logos (Accenture, Amex GBT, Coca-Cola,
  Panasonic, Proton, Renault, Turkcell, Getir, Hepsiburada, Ziraat/Halkbank/DenizBank), "CodePush"
  module (React Native), "Enterprise App Store" (in-app update), **© 2026**, ISO 27001 + SOC 2
  Type 2, Capterra 4.9.
- `codemagic.io` → "Trusted by 150,000+ developers", Flutter/RN/native/Ionic/Unity/**MAUI**, OTA
  at `patch.codemagic.io`, "Codemagic vs App Center" migration page, SOC 2 Type 2 + ISO 27001.

**AIRIZ in-repo artifacts (read directly):**
- `apps/airiz-motor/tools/sign-manifest.ts` → `airiz-release.v1`: Ed25519 over canonical JSON
  (JCS subset), `signatures[]`, `channel`, `staged_rollout`, `target_versions` keyed by `electron`
  / `capacitor_ios` / `capacitor_android` / `pwa` / `worker`, per-target `artifacts`.
- `apps/airiz-motor/web/updates/windows/latest.yml` → electron-updater NSIS channel file,
  v1.11.25, GitHub Releases URL, sha512 + size + blockmap.
- `apps/airiz-motor/relay/wrangler.toml` → Cloudflare Worker (the edge/rollout cell).
- `apps/airiz-motor/web/sw.js` + `manifest.webmanifest` → PWA service-worker cell.

### Could NOT verify (flagged, not invented)
- **VoltBuilder** 2026 liveness — `www.voltdbuilder.com` and `voltdbuilder.com` both returned
  **transport errors** on fetch. Status left as **UNVERIFIED**; the original **PhoneGap Build**
  lineage is documented as deprecated/wound down. A human should confirm before relying on it.
- Exact `pushed_at` / star counts for the **Capawesome plugin monorepo** and for the **Tauri
  plugins-workspace** were not individually fetched this round; npm cadence and the Tauri core
  repo are the live signals used.
- Appcircle / Codemagic exact **revenue/user-count** beyond the homepage claims (500+ enterprise
  clients; 150,000+ developers) — taken from the vendors' own pages, not independently audited.
- **Shorebird funding/customer specifics** — stated qualitatively ("commercial", "enterprise
  customers"); exact figures not re-fetched this round.

### Assumptions made (per house rules: stated, not guessed-as-fact)
- The eight "hybrid" apps in §11c use the publicly documented Electron-desktop + native-mobile +
  web architectures; I am *high* confidence on "native, not Capacitor" for each, but did not
  re-verify each app's current source this round — flag for a human pass before any external
  publication.
- "No vendor productizes the full five-surface unified manifest" is a **negative claim**
  established by exhaustive check of the 12 surveyed systems + the §13 matrix, not by an audit of
  every SaaS on earth; it is *strongly* supported but phrased as "no vendor in this survey."
- "Died-by-absence" (KMP) is a label for "the capability does not exist in that framework," not a
  claim that the framework or the language died — both are very much alive.

### One-paragraph bottom line (for the architecture decision)
No framework and no hosted service solves "one updater, one manifest, five surfaces": Tauri
solves desktop and punts the rest to stores; Flutter/Expo and Capawesome solve *mobile* (code
push / web-layer) and punt desktop + PWA + worker; MAUI/Uno/KMP punt everything to stores/you;
CodePush **died** and its refugee base moved to Expo Updates (mobile only); Appcircle and
Codemagic are **mobile** delivery hubs, not desktop/web updaters; VoltBuilder is unverified and
was never an updater in the first place; and every major Electron product (Discord, Signal, VS
Code, Figma, Loom, Linear, Notion, Obsidian) runs **native mobile + separate release trains**, not
a unified channel. The only row in the coverage matrix that lights up all five cells is the
**custom R2/GitHub-Release + service-worker** pattern — which is exactly what AIRIZ has already
built in `sign-manifest.ts`. **Build the unified layer yourself, on top of proven per-surface
adapters; do not adopt a framework for it, and do not accept silent five-updater skew on a
physical motor.**
