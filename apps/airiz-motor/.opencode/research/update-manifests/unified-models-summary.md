# Unified Auto-Update Across Cross-Platform Frameworks — Survey

**Decision frame for AIRIZ Motor Console**
**Date:** 2026-11-05
**Verdict at a glance:** No framework fully solved the unified-updater problem end-to-end across desktop + iOS + Android + stores. Tauri solved it for **desktop only**. Every mobile framework either punted, sunset, or limited updates to JS/CSS bundles (which still can't change native code on iOS without store review).

---

## TL;DR Recommendation

| If we want… | Framework | Status |
|---|---|---|
| Desktop unified updater (Windows/macOS/Linux) | **Tauri** | SOLVED — first-party `tauri-plugin-updater`, signed, channel-aware, mature |
| Mobile JS/CSS OTA (skip store review for web bundle) | Capgo / Shorebird / Bitrise CodePush | SOLVED — but cannot ship native changes |
| Mobile native auto-update bypassing stores | **Nobody** | PUNTED — Apple/Google policy forbids it |
| Single framework for desktop + mobile + store-compliant updater | **Nobody** | PUNTED |

**For AIRIZ Motor Console** (which the context suggests is a desktop app with mobile considerations): **Tauri is the only sane migration target** if unified desktop auto-update is the blocker. If mobile store compliance also matters, treat that surface as a separate problem.

---

## 1. Tauri — `tauri-plugin-updater`

- **Unified updater:** **Yes** (desktop: Windows, macOS, Linux). Mobile (Android/iOS) supported in the plugin but constrained by store policy.
- **Status:** Active. Repo pushed 2026-11-05. Stars ~112K. First-party plugin in the official `plugins-workspace`.
- **Why:** Tauri ships a `tauri-plugin-updater` (crates.io: `tauri-plugin-updater`, npm: `@tauri-apps/plugin-updater`) that handles the full desktop lifecycle: signed manifest check → download → verify signature → install MSI/NSIS/AppImage/DMG/.tar.gz → relaunch. Manifest can be a static JSON on any HTTPS endpoint (works with GitHub Releases via `tauri-action`) or a dynamic update server. Channel switching (stable/beta), key rotation, proxy/auth headers, custom targets, and downgrade control are all first-class. Mobile builds (Android/iOS) get the same Rust API but apps must comply with Google Play and App Store rules — Apple policy 3.3.1 forbids executing downloaded JS, so Tauri's webview asset hot-swap is not a true store-bypass updater on iOS.
- **Repo / docs:**
  - https://github.com/tauri-apps/tauri
  - https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater
  - https://v2.tauri.app/plugin/updater/
  - https://docs.rs/tauri-plugin-updater
- **Real apps:** CrabNebula Cloud is the recommended hosted dynamic-update server partner. Customer logos on tauri.app include Daytona, Hoppscotch, Ghostty (announced), Spacedrive, and many indie/desktop apps (no public canonical "10M MAU Tauri app" because the framework skews desktop).

---

## 2. Flutter — `flutter/flutter`

- **Unified updater:** **Punt** (no first-party updater).
- **Status:** Active. Pushed 2026-11-05. Stars ~181K. Flutter itself has no built-in OTA update mechanism.
- **Why:** Google ships Flutter as a UI toolkit, not a release pipeline. The native binary (compiled AOT Dart) and the engine cannot be hot-swapped under App Store / Play policy. Google has explicitly punted this to third parties. The dominant solution is Shorebird (next section).
- **Repo / docs:**
  - https://github.com/flutter/flutter
  - https://flutter.dev
- **Real apps:** Google Pay, BMW, eBay Motors, Nubank, MyBMW — none use Flutter-native OTA; they ship through stores normally.

---

## 3. Shorebird — `shorebirdtech/shorebird` (Flutter code-push)

- **Unified updater:** **Partial Yes** — Dart-code OTA only. Native code and assets out of reach.
- **Status:** Active. Pushed 2026-11-05. Stars ~3K. Founded by Eric Seidel (creator of Flutter), backed by Accel. Production since 2023.
- **Why:** Shorebird forks Flutter to swap the AOT Dart compiler for a patchable variant. You ship a normal store release; subsequent Dart-only fixes (logic, UI, packages, endpoints) ship as signed patches that load on the user's next launch. Native code, `build.gradle`, `Podfile`, plugin native code, assets/fonts, and permission changes all still require a normal store release. Hosted SaaS only — no self-host, no on-prem.
- **Repo / docs:**
  - https://github.com/shorebirdtech/shorebird
  - https://shorebird.dev
- **Real apps:** Scapia (travel fintech, India), VETC (electronic toll collection, Vietnam), PushPress (1,500+ white-labeled apps for gym owners), Junglee Games (2M+ patch installs/month, 1M+ daily players), Delivery Hero, Couchsurfing, Kalshi, Cloudwalk, Solides. Visible production use at scale.

---

## 4. .NET MAUI — `dotnet/maui`

- **Unified updater:** **Punt**.
- **Status:** Active. Pushed 2026-11-05. Stars ~23K. Microsoft-maintained.
- **Why:** MAUI inherits each platform's native update flow: App Store/Play on mobile, Microsoft Store on Windows, package manager on Linux/macOS. There is no cross-platform .NET-runtime updater. App Center was retired (see §11) and Microsoft has no replacement SDK-side updater. WinAppSDK has package APIs but only for Windows.
- **Repo / docs:**
  - https://github.com/dotnet/maui
  - https://learn.microsoft.com/en-us/dotnet/maui/
- **Real apps:** Microsoft internal apps,一些小公司; rarely cited for OTA updates.

---

## 5. Uno Platform — `unoplatform/uno`

- **Unified updater:** **Punt** (web-bundle reload only).
- **Status:** Active. Pushed 2026-11-05. Stars ~10K. 200M+ NuGet downloads.
- **Why:** Uno renders a WinUI/XAML tree on each platform (iOS/Android/macOS/Windows/Linux/Web). The web output is naturally reloadable (it's a browser page), but native outputs have no OTA mechanism. Uno recommends MSIX/Appx signing on Windows and App Store/Play for mobile. No first-party code-push.
- **Repo / docs:**
  - https://github.com/unoplatform/uno
  - https://platform.uno
- **Real apps:** Toyota, Lufthansa, Kahua, Snowflake partners — cited as web/embedded cases, not OTA users.

---

## 6. Kotlin Multiplatform — `JetBrains/kotlin`

- **Unified updater:** **Punt**.
- **Status:** Active. Pushed 2026-11-05. KMP itself ships only the shared-logic story; Compose Multiplatform does UI. No bundled updater.
- **Why:** Kotlin Multiplatform intentionally stops at shared business logic. Each platform target uses its own delivery: App Store / Play on mobile, the platform's package manager on desktop. There is no JetBrains-hosted OTA server. The closest third-party is Shorebird (which works on the Dart side, not Kotlin/Native). Some teams have used AppCenter-style services or rolled their own, but no canonical solution exists.
- **Repo / docs:**
  - https://github.com/JetBrains/kotlin
  - https://kotlinlang.org/docs/multiplatform.html
- **Real apps:** Netflix (studio apps), Philips, VMware, Baidu, McDonald's — none use KMP-native OTA updates.

---

## 7. React Native — `facebook/react-native`

- **Unified updater:** **Yes (JS bundle), No (native).**
- **Status:** Active. Pushed 2026-11-05.
- **Why:** The official `react-native-code-push` (Microsoft) is **archived** (last push 2025-05-20; the cordova plugin variant archived 2021-10-25). After App Center / CodePush sunset, Microsoft transferred customers to App Center's deprecation path. Expo Updates (EAS Update) is the de-facto replacement but Expo is required for managed workflow; bare RN needs Expo Modules or a third-party CodePush host.
- **Repos / docs:**
  - https://github.com/facebook/react-native
  - https://github.com/microsoft/react-native-code-push  *(archived)*
  - https://github.com/expo/expo
  - https://docs.expo.dev/workflow/configuration/
- **Real apps:** Meta (Facebook, Instagram modules), Microsoft Office, Shopify, Discord, Tesla — but none of them depend on CodePush for native code; they ship native binaries normally and use CodePush/EAS only for JS bundle hotfixes.

---

## 8. Capawesome (Capacitor Live Reload) + Capgo — `ionic-team/capacitor` and `Cap-go/capgo`

- **Unified updater:** **Yes (web-bundle only).**
- **Status:** Capacitor active (pushed 2026-11-05, 17K stars). Capgo (commercial SaaS) active (pushed 2026-11-05, 3.2K stars on the meta repo, 9,400+ customer teams). Capawesome (the original team) now operates under the `capawesome-team` org and publishes Capacitor plugins.
- **Why:** Capacitor wraps a native WebView. Capgo (and Capawesome's plugin family) ships signed, encrypted JS/CSS bundles to installed apps, downloaded in the background, applied on next launch, with channels, staged rollouts, auto-rollback on failure, and native-build compatibility checks. Native code, manifest changes, and permissions still need a full store release. App Store policy 3.3.1 is the wall.
- **Repos / docs:**
  - https://github.com/ionic-team/capacitor
  - https://github.com/Cap-go
  - https://github.com/capawesome-team/capacitor-live-reload
  - https://capgo.app
- **Real apps:** Kick (20M+ installs), Pizza Hut, Vaia (10M+), Suez (3.2M), Nana (2.5M), Snowqueen (1.8M), StyleSeat (1M+), Huckleberry (1M+), SuperFrete (1M+), Shelf (950K), Rocket Lawyer. Live delivery metrics published at capgo.app/data.

---

## 9. Voltbuilder — `voltbuilder/voltbuilder`

- **Unified updater:** **No.**
- **Status:** Active. Last blog/news entries July 2025; still selling plans at $15/mo. Built by NS Basic (the PhoneGap / Ionic-Framework-of-old crowd).
- **Why:** Voltbuilder is purely a build service: zip your HTML/CSS/JS, it produces a signed Android/iOS binary via Cordova or Capacitor. No update channel, no manifest, no installed-app delivery. Their landing page even headlines "Replace Ionic Appflow" for builds, not for updates.
- **Repo / docs:**
  - https://voltbuilder.com
  - https://github.com/voltbuilder
- **Real apps:** Individual developers and very small shops. No marquee customers cited.

---

## 10. Appcircle — `appcircleio`

- **Unified updater:** **Partial Yes — branded "CodePush" module, RN-focused.**
- **Status:** Active. Enterprise CI/CD SaaS with on-prem option. 500+ enterprise clients.
- **Why:** Appcircle sells the full mobile CI/CD pipeline (Build, CodePush, Signing Identities, Testing Distribution, Publish, Enterprise App Store). Their "CodePush" feature is exactly an OTA-update delivery service targeting React Native, with controlled rollouts, signed bundles, diffs, rollback, and self-hosted mode. After App Center sunset, Appcircle is one of the named destinations. It does not solve native-bundle updates or non-RN frameworks.
- **Repo / docs:**
  - https://appcircle.io
  - https://docs.appcircle.io/
- **Real apps:** Ziraat Teknoloji (banking), Intertech (banking), Halkbank (banking), Hepsiburada, Getir, Turkcell, Panasonic, Renault, Coca-Cola Içecek, Starkey. (Logo wall on appcircle.io.)

---

## 11. Codemagic — CI/CD + `patch.codemagic.io`

- **Unified updater:** **Partial Yes — `patch.codemagic.io` for React Native (JS bundles).**
- **Status:** Active. 150,000+ developers. Owned by Nevercode Ltd.
- **Why:** Codemagic is fundamentally a CI/CD product (Flutter-first, also iOS/Android/React Native/Ionic/Unity/MAUI). Their OTA offering at `patch.codemagic.io` is a **self-hosted React Native OTA service** (JS bundle updates, binary diffs, native binary fingerprinting), positioned as the alternative to Bitrise / Appcircle CodePush — **not** a Flutter / Dart product (corrected from earlier draft after Phase 2 verification). It does not ship native binaries OTA. CI + signing + store publish + an OTA patch channel for RN.
- **Repo / docs:**
  - https://codemagic.io
  - https://patch.codemagic.io
  - https://docs.codemagic.io
- **Real apps:** Flutter shops, mobile studios. No specific marquee logo on the homepage beyond "Trusted by 150,000+ developers".

---

## 12. Bitrise + fastlane — `bitriseio`

- **Unified updater:** **Partial Yes — Bitrise CodePush (managed App Center successor).**
- **Status:** Active. 8,500+ mobile teams. Bought by OutSystems family-adjacent (independent).
- **Why:** Bitrise is the leading mobile-specialized CI/CD platform. After App Center / CodePush sunset, Bitrise explicitly launched **Bitrise CodePush** as "the managed App Center successor", free up to 100K MAU, supporting bare React Native and Expo. fastlane is the lower-level tool Bitrise integrates with — fastlane itself has no OTA update story (it's a release-orchestration CLI). Bitrise's whole stack: Bitrise CI, Build Hub (GitHub Actions accelerator), Build Cache, Release Management, **CodePush**, Remote Dev Environments, Bitrise AI.
- **Repo / docs:**
  - https://bitrise.io
  - https://docs.bitrise.io/en/release-management/codepush/about-codepush.html
- **Real apps:** Shopify, BuzzFeed, Fetch Rewards, Back Market, Redfin, Hyatt, Maven Clinic, N26, TAG Heuer, Drops, Ibotta, Mozilla, Pixiv, Speak (and many more on their customer-stories page). All use Bitrise for CI/CD; CodePush adoption is the relevant sub-set.

---

## 13. NativeScript — `NativeScript/NativeScript`

- **Unified updater:** **Punt.**
- **Status:** Active. Pushed 2026-11-02 (recent!). Stars ~25K. Maintained by the community / nStudio / Progress.
- **Why:** NativeScript runs native iOS/Android views from JS. The "Hot Module Replacement" is dev-only; production apps ship through the stores. There is no first-party OTA service. The old NativeScript Sidekick (a build/seed service) was deprecated. Apps use CodePush / Capgo-style solutions as bolt-ons.
- **Repo / docs:**
  - https://github.com/NativeScript/NativeScript
  - https://nativescript.org
- **Real apps:** Puma, SAP, AirBnB (legacy experiments), various enterprise internal apps.

---

## 14. Cordova — `apache/cordova`

- **Unified updater:** **Punt.**
- **Status:** **Functionally dead.** Repo not formally archived but pushed 2026-10-27 (last maintenance commit). Apache moved Cordova to the Attic. No new releases planned. Stars stagnated at ~713 on the new `apache/cordova` repo (the historical `cordova-cli` was archived years earlier).
- **Why:** Apache Cordova is the original WebView-wrapping hybrid framework. It never had an official updater. Third parties (Ionic Appflow historically, Hydration, etc.) filled the gap, and Ionic itself abandoned Appflow (see §15).
- **Repo / docs:**
  - https://github.com/apache/cordova
  - https://cordova.apache.org
- **Real apps:** Adobe PhoneGap-built apps, many legacy enterprise apps. None maintain an OTA story post-2025.

---

## 15. Ionic Appflow — `ionic-team/Ionic-Appflow`

- **Unified updater:** **Was Yes (web bundle) — now sunset.**
- **Status:** **Sunset.** Announced 2025-02-11. New customer sales discontinued. Existing Appflow customers retain access through **December 31, 2027**.
- **Why:** Appflow was the only "managed hybrid CI/CD + OTA update + native build + store publish" platform that worked across Capacitor, Ionic, React Native, Cordova, and native iOS/Android. OutSystems (who acquired Ionic in 2022) decided to wind down commercial products and absorb Live Updates / publish-to-store into OutSystems Developer Cloud instead. The community has effectively migrated to Capgo (Capacitor), Bitrise CodePush (RN), or self-hosted equivalents.
- **Repo / docs:**
  - https://ionic.io/appflow  *(page still up, banner about future)*
  - https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products  *(2025-02-11)*
- **Real apps:** AAA, NASA, IBM, Burger King, CAT, Target (logos historically on appflow landing page; current status: Appflow access continues only for paying customers through 2027).

---

## COMPARISON TABLE

| Framework / Tool | Unified updater (desktop+mobile+store-compliant)? | Scope of what actually updates | Status | Sunset / risk | Primary OTA mechanism | Repo / Doc |
|---|---|---|---|---|---|---|
| **Tauri** | **Yes (desktop)** | Full desktop bundle (Windows/macOS/Linux), signed | Active (2026-11) | None known | `tauri-plugin-updater` first-party | github.com/tauri-apps/tauri · v2.tauri.app/plugin/updater |
| **Flutter** | No (punt) | n/a | Active | n/a | None first-party | github.com/flutter/flutter |
| **Shorebird (Flutter code-push)** | Partial (Dart patches only) | Dart code/UI/packages | Active (2026-11) | No self-host; SaaS-only | Patch the AOT engine fork | github.com/shorebirdtech/shorebird · shorebird.dev |
| **.NET MAUI** | No (punt) | n/a | Active | App Center retired | None first-party | github.com/dotnet/maui |
| **Uno Platform** | No (punt; web reload) | Web bundle only | Active | n/a | None first-party | github.com/unoplatform/uno · platform.uno |
| **Kotlin Multiplatform** | No (punt) | n/a | Active | n/a | None first-party | github.com/JetBrains/kotlin |
| **React Native** | Partial (JS bundle) | JS/Metro bundle only | Active | MS CodePush archived 2025-05 | None first-party; Expo Updates or Bitrise CodePush | github.com/facebook/react-native · github.com/microsoft/react-native-code-push (archived) |
| **Capacitor + Capgo** | Partial (web bundle) | JS/CSS/assets | Active (2026-11) | None | Capgo SaaS + open-source plugin | github.com/ionic-team/capacitor · capgo.app |
| **Voltbuilder** | No | n/a | Active (slow) | Build service only, no updater | n/a | voltbuilder.com |
| **Appcircle** | Partial (CodePush module, RN-focused) | JS bundle | Active | None | Appcircle CodePush (self-host OK) | appcircle.io |
| **Codemagic** | Partial (patch.codemagic.io) | JS bundle (RN, self-hostable) | Active | None | `patch.codemagic.io` RN (self-host) | codemagic.io |
| **Bitrise + fastlane** | Partial (Bitrise CodePush, RN/Expo) | JS bundle | Active | None; explicitly App Center successor | Bitrise CodePush, free ≤100K MAU | bitrise.io |
| **NativeScript** | No (punt) | n/a | Active (slower) | Sidekick deprecated | None first-party | github.com/NativeScript/NativeScript |
| **Cordova** | No (punt; framework dying) | n/a | Apache Attic (effectively dead) | Apache winding down | None first-party | github.com/apache/cordova |
| **Ionic Appflow** | Was yes | Web bundle (Capacitor/Cordova/RN) | **Sunset (2027-12-31 EOL)** | OutSystems winding down Ionic commercial | Appflow Live Updates (legacy only) | ionic.io/appflow · ionic.io/blog (2025-02-11) |

---

## Strategic takeaways for AIRIZ Motor Console

1. **The unified updater problem has NOT been solved at the framework level** for any stack that must respect Apple/Google store policy. Every mobile-side "solution" only patches the JS/CSS bundle; native code, plugins, manifests, and permissions always require a store release.
2. **Tauri is the only framework that has solved the desktop side** in a first-party, signed, channel-aware way that doesn't depend on app stores. If AIRIZ Console is desktop-first, Tauri is a defensible migration target.
3. **Mobile-side OTA is a fragmented market**: Capgo (Capacitor), Shorebird (Flutter), Bitrise CodePush (RN) are the three serious incumbents post-App Center / Appflow sunsets. All three have non-trivial vendor-risk profiles — Appflow was the cautionary tale.
4. **Build-only vendors (Voltbuilder, Codemagic, Bitrise without CodePush, Appcircle) do not solve updater**; they solve CI/CD.
5. **The "punt" frameworks (.NET MAUI, Uno, KMP, Flutter, NativeScript, Cordova) have not adopted** any OTA story and should not be relied on for one.
6. **Recommendation if the goal is desktop unified updater**: migrate desktop surface to **Tauri** and treat any mobile extension as a separate, store-compliant deliverable.
7. **Recommendation if the goal is mobile-only OTA**: pick **Capgo (Capacitor)** or **Shorebird (Flutter)** based on framework; do not depend on **Appflow** (sunsetting) or **MS CodePush** (archived).
