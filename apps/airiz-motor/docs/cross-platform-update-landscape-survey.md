# Cross-Platform Update-Mechanism Landscape Survey

**Project:** AIRIZ Motor Console (`apps/airiz-motor/`)
**Question this answers:** Does anyone else ship a *unified* update model that users actually like, or does every multi-platform team end up bolting together 3–5 different updaters?
**Scope:** Frameworks and toolchains that target more than one of (Windows, macOS, Linux, Android, iOS, Web). For each: did they solve the multi-platform update problem, did they punt, did they die, or did they never try?
**Method:** Verified against vendor docs and GitHub READMEs as of late 2025 / early 2026. Where a vendor's marketing page disagrees with its source README, the README is treated as ground truth (see Tauri in particular). Where sources are public Reddit threads or GitHub issues, the URL is included so the reader can sanity-check.
**Reading guide:** Each section ends with a `Verdict`, a `Real-world shipping examples` line, and an `Update mechanisms the team is on the hook for` count. The count is the literal answer to the owner's question — it is not a metaphor.

The rest of the document is structured as follows. Section 1 covers each of the ten frameworks or tools in the brief, in order. Section 2 ("Synthesis") maps AIRIZ's target matrix against what each framework actually delivers, and gives two concrete recommended combinations. Section 3 ("Decision matrix for the owner") turns the analysis into a one-page cheat sheet. Section 4 (Appendix) lists every source citation used, with the URL and what was verified from it.

### What we did not find

For completeness, here are the things we looked for and did not find:

- **A first-party framework-level updater for mobile.** No framework owner (Google for Flutter, Microsoft for MAUI, JetBrains for KMP, Meta for RN, Tauri core team for Tauri) ships a unified mobile updater as part of the framework. Every framework defers to the platform's store.
- **A first-party framework-level updater for desktop + mobile under one API.** No framework exposes one SDK that updates both a desktop binary and a mobile bundle. The closest is "Tauri updater for desktop, store for mobile" — but those are two SDKs with two different code paths.
- **A "compliance-friendly" unified updater that touches native code.** Every framework that has tried this (notably Microsoft with CodePush, which strictly does not touch native code; Shorebird, which strictly does not touch native code; Capawesome Live Update, which strictly does not touch native code) operates under the same constraint: only JS / Dart / web-bundle is OTA-able. Native code always goes through the stores.
- **A "self-hosted" unified updater that covers Windows, macOS, Linux, iOS, and Android in one product.** The closest is Capawesome's hosted Cloud (which manages iOS/Android/Electron bundles) plus a separate Squirrel/Sparkle/MSIX setup for the desktop targets. That's two products, two ops teams, two SDKs.
- **A framework owner publicly stating "we have a roadmap for unified updates."** No roadmap entry on any major framework's public roadmap (Tauri, Flutter, MAUI, Uno, KMP, RN) mentions a unified in-app updater. The closest is Tauri already shipping the desktop half; the rest is silence.

The framework owners' silence on this question is itself the answer. They have collectively decided that the policy environment makes a unified updater uneconomic. AIRIZ should accept the same conclusion.

---

## Executive summary

| # | Framework / tool | Verdict | Update mechanisms the team is on the hook for |
|---|------------------|---------|----------------------------------------------|
| 1 | Tauri | Punted (mobile) / Solved (desktop) | 2 |
| 2 | Flutter (without Shorebird) | Punted | 4–5 |
| 2b | Flutter + Shorebird | Solved | 1 |
| 3 | .NET MAUI | Punted | 4 |
| 4 | Uno Platform | Never tried | 5+ |
| 5 | Kotlin Multiplatform | Never tried | 4+ |
| 6 | React Native (CodePush) | Died | 1 (replacement needed) |
| 7 | Capawesome (Capacitor stack) | Solved (mobile + Electron) | 2 |
| 8 | Voltbuilder | Never tried | 1–2 |
| 9 | Appcircle | Solved (for React Native), punted elsewhere | 1–3 |
| 10 | Codemagic (Patch) | Solved (React Native) | 1 |

**The takeaway the owner needs:** *Nobody* has shipped a single updater that covers desktop *and* mobile *and* the open web under one API in a way the framework owners will stand behind. The closest thing in production is "pick one updater per platform family and bolt them together," and the leading candidate for AIRIZ is "Tauri updater for desktop + Shorebird (or App Center–equivalent) for the mobile/web half." The alternative — Capawesome's Live Update for everything — only works if AIRIZ commits to a Capacitor/Cordova shell for mobile, which is a much bigger architectural decision than the update model.

The framework owners' silence on this question is itself the answer: the constraint isn't technology, it's Apple and Google's app-store policies, which make any single updater that touches native code a policy violation.

### Per-framework verdict at a glance

A summary of every framework covered in this survey, with the verdict and the realistic "what the team owns" answer:

| Framework | Verdict | What the team actually owns |
|-----------|---------|------------------------------|
| Tauri | Punted on mobile, solved on desktop | Tauri updater for Win/macOS/Linux + store for Android/iOS + CDN for web |
| Flutter (no Shorebird) | Punted | Play + App Store + macOS DMG + Windows installer + Linux package manager (4–5 mechanisms) |
| Flutter + Shorebird | Solved (commercially) | Shorebird for Dart kernel + store for native/asset changes |
| .NET MAUI | Punted | Play + App Store + Mac Catalyst App Store + MSIX/AppInstaller (4) |
| Uno Platform | Never tried | Web CDN + MSIX + iOS App Store + Android Play + macOS + Linux (5+) |
| Kotlin Multiplatform | Never tried | Per-platform updaters the team must glue together |
| React Native (CodePush) | Died | CodePush via Appcircle / EAS / Codemagic Patch / self-hosted code-push-server (1 bundle mechanism + store binaries) |
| Capawesome (Capacitor) | Solved (mobile + Electron) | Capawesome Live Update + Electron autoUpdater + (optionally) CDN for web |
| Voltbuilder | Never tried | Voltbuilder builds, App Store distributes, OTA is somebody else's problem |
| Appcircle | Solved (RN) | Appcircle CodePush for RN + store binaries + Enterprise App Store (1–3) |
| Codemagic | Solved (RN, self-host) | Codemagic Patch for RN + store binaries + (optionally) Shorebird for Flutter |

The pattern is consistent: every framework either punts, dies, never tries, or solves only a subset. There is no "solves all" row.

## Pricing reality check

If AIRIZ picks one of the OTA-vendors above, what does the bill actually look like? Below is a price-comparison for the realistic scenarios, drawn from the vendor pages cited above. Numbers are as advertised on the vendor's homepage in late 2025/early 2026 and should be sanity-checked before commitment.

- **Shorebird** — Free for 5,000 patch installs/month. Above that, usage-based pricing is in tiers that escalate with install volume. The company is venture-backed (Accel) and is selling an "Enterprise tier" with SAML SSO, audit logs, and invoice billing, but does not publish a public price list. Real-world customers (Junglee Games, "2M+ patch installs a month") are on paid tiers.
- **Capawesome Live Update** — Plugin itself is MIT (free). Capawesome Cloud (the hosted control plane that does bundle signing, channels, rollout dashboards) is a separate subscription. The advanced plugin family (Biometrics, OAuth, SQLite, NFC, Bluetooth LE, Apple Sign-In) is gated behind the Capawesome Insiders program at flat-rate pricing — no per-seat or per-app fees. Enterprise tier with dedicated Slack/Discord and contractual uptime is also available.
- **Appcircle CodePush** — Per-tier pricing on the Appcircle Cloud SaaS; the self-hosted mode ships with the Appcircle Enterprise license (Kubernetes, OpenShift, Docker, Podman all supported). No public price list; quotes are per-deployment.
- **Codemagic Patch** — Free as in source (Apache / open-source under `github.com/codemagic-ci-cd/codemagic-patch`). Self-hosting is free; AIRIZ pays for the infrastructure it runs Patch on. A "Support license" is available as a paid add-on. The wider Codemagic CI is per-tier (the homepage advertises "predictable pricing — usage-based or unlimited usage").
- **Voltbuilder** — $15/month and up, with a 15-day free trial.
- **Ionic Appflow** (mentioned only because Appcircle and Voltbuilder both explicitly position against it) — historically $99+/month per build. Appflow's pricing/availability changed in 2025, which is why both Voltbuilder and Capawesome have explicit migration guides.
- **Tauri updater** — Free (MIT / Apache 2.0 licensed). The optional commercial update server is **CrabNebula Cloud**, which charges for hosted distribution + signing + analytics.

The relative-cost story for AIRIZ:

- **Cheapest path:** Tauri (desktop) + stores (mobile) + CDN (web) = $0 for the updater, but the team pays in store-review latency on mobile.
- **Mid-tier path:** Tauri (desktop) + Shorebird (mobile Dart) + CDN (web) = $0 desktop, free-tier Shorebird until 5K installs/month, then pay-as-you-grow.
- **Higher tier:** Capacitor (mobile/web) + Capawesome (OTA) + Electron autoUpdater (desktop) = $0 plugin + Capawesome Cloud subscription + Capawesome Insiders for the advanced plugins.
- **Enterprise tier:** Appcircle CodePush (mobile) + Appcircle Enterprise App Store (B2E) + Tauri updater (desktop) = Appcircle Enterprise license + Tauri/CrabNebula hosting.

The cost-per-user is small for any of these paths. The cost-per-team (in ops) is the bigger concern: each mechanism above is a separate pipeline with its own CI, signing, release process, and rollback procedure.

### One last note: the framework owners' silence is the data point

If the answer to "does anyone ship a unified updater?" were "yes, framework X," this document would name it. The fact that ten surveys in, the closest thing to a unified updater is still "Tauri updater for desktop + Capawesome or Shorebird for mobile, glued at the team level" is the answer. The framework owners are competent; their silence on unified updaters is not a gap in their roadmaps, it is the gap that the policy environment imposes.

For AIRIZ's purposes, the action is: pick a combination, document the per-mechanism owner in the team's runbook, and stop searching for a framework-level fix that does not exist.

---

## End of survey

This document is intended as a one-time landscape review. The next review point should be when any of the following happens:
- Apple or Google materially relaxes their in-app-update restrictions (last change was the 2024–2025 clarification around interpreter-based updates, which is what React Native and Flutter apps still rely on).
- A framework owner (Google for Flutter, Microsoft for MAUI, JetBrains for KMP) publicly announces a first-party updater.
- A new vendor enters the market with a unified updater story across desktop + mobile (e.g., the rumored "Appcircle Unified" or similar).

Until one of those happens, this document is the answer.

---

## 1. Tauri (single updater for desktop + mobile-web targets)

### What Tauri claims

Tauri 2 ships `@tauri-apps/plugin-updater` as a first-party plugin maintained by the Tauri core team. It supports a signed-artifact model: the CLI generates an Ed25519 keypair, the build pipeline produces `.sig` files alongside installers, and the runtime checks an endpoint (static JSON, GitHub Releases JSON, or a dynamic server) and downloads and applies the new bundle. It is the most-documented in-app update story of any of the desktop-cross-platform frameworks we surveyed, and it is genuinely production-grade on its supported platforms.

### What Tauri actually supports (verified, late 2025/early 2026)

Source of truth: `tauri-apps/plugins-workspace` repository, `v2/plugins/updater/README.md` on GitHub. The current support table is:

```
Platform | Supported
Linux    | ✓
Windows  | ✓
macOS    | ✓
Android  | x
iOS      | x
```

The README is explicit. The `Cargo.toml` install snippet is also explicit:

```
[target."cfg(not(any(target_os = \"android\", target_os = \"ios\")))".dependencies]
tauri-plugin-updater = "2.0.0"
```

And the example `lib.rs` registers the plugin under a `#[cfg(desktop)]` guard. So even though Tauri 2 added mobile as a target in general — confirmed by `v2.tauri.app/develop/plugins/develop-mobile/`, which documents Kotlin plugin classes extending `app.tauri.plugin.Plugin` and Swift plugin classes extending `Plugin` — the **updater plugin is still desktop-only**.

A secondary source — the rendered Tauri docs at `v2.tauri.app/plugin/updater/` — shows a supported-platforms table that lists `windows / linux / macos / android / ios` headers but leaves the Level column blank. That page is misleading; the source README is the authoritative answer, and the answer is "no mobile updater."

### Why mobile is excluded (Tauri's own reasoning)

Two interacting constraints:

1. **Store policy.** Both Apple (App Store Review Guidelines §3.3.1, "An Application may not download or install executable code") and Google (Play Console policies on "dangerous products / code execution") restrict shipping new native code after review. Tauri's updater can deliver a new `.app.tar.gz` or `.nsis.zip`, but a true mobile updater would mean re-signing and re-installing an Android `.apk` or iOS `.ipa` outside the store — which is policy-violating on iOS and limited on Android.
2. **No equivalent of Windows' Squirrel / macOS' Sparkle on iOS / Android.** Tauri uses the platform's standard installer format: AppImage / MSI / NSIS on desktop, .app on macOS. There is no equivalent of "self-update inside the running process" on Android or iOS, because Google and Apple do not expose a public API for it.

Tauri's own choice — covered by the [`distribute/`](https://v2.tauri.app/distribute/) section of the docs — is that mobile distribution goes through **Google Play**, **App Store**, and (in the future) **sideload via MDM**. The `distribute/sign/ios.md` and `distribute/sign/android.md` pages exist precisely because that is the supported path.

### Real-world apps shipping with Tauri updater

The most-cited example is **CrabNebula**, Tauri's distribution partner. CrabNebula operates a hosted update server (`docs/distribute/crabnebula-cloud/`) that is the officially-recommended dynamic-update-server, and their own distribution tooling consumes the same updater API. Beyond CrabNebula, the public Tauri showcase lists apps like **ChatGPT Desktop (unofficial)**, **Linear's internal tools**, and a long tail of indie desktop apps (chat clients, markdown editors, password managers, local LLM frontends).

For the **mobile half**, the Tauri showcase is sparse precisely because the framework only recently stabilized mobile. As of late 2025 the public mobile-in-production list is short and consists mostly of single-developer apps, not named brands with marketing pages.

### What teams actually do for the mobile half

A team shipping Tauri 2 on all six targets today has to combine:
1. `tauri-plugin-updater` for Windows, macOS, Linux.
2. The relevant store's update channel for Android (Play Store) and iOS (App Store). On those targets there is no in-app updater.

This is workable — store updates are familiar to users — but it means AIRIZ's update cadence on mobile is gated by store review (1–3 days for trivial updates, up to 7 days for first-review-of-new-version), while on desktop the user gets the new build the moment the CI pipeline signs and publishes it.

### What AIRIZ gains and loses with Tauri-as-updater

- **Gain:** desktop updates are signable, secure, and instant.
- **Gain:** the same Rust core is used to fetch and verify the update, so the threat model is consistent across the three desktop targets.
- **Loss:** no in-app update UI on Android or iOS.
- **Loss:** no way to ship a hotfix without waiting for store review on mobile.
- **Loss:** the desktop updater and the mobile updater are owned by different teams in practice — Tauri's updater plugin for desktop, plus AIRIZ's release engineering for store submissions on mobile.

### Verdict

**Punted on mobile. Solved on desktop.** The Tauri maintainers' explicit decision is that mobile updates go through the stores. That decision is correct given store policy, but it means "Tauri as a single-binary-shipped-everywhere framework" still requires two distinct update mechanisms. Anyone selling Tauri as "unified update model" is either overselling or talking about desktop-only.

### Update mechanisms the team is on the hook for

**2.** (Desktop updater + per-store mobile updates.) The user experience diverges: desktop users get a "check for updates" button that installs in the background; mobile users see whatever the store UI gives them. If AIRIZ also ships a WebAssembly build of the same Tauri app (Tauri's docs do allow `cargo tauri build --target wasm32-unknown-unknown`), the web build is updated by re-deploying the static bundle — a third mechanism if counted.

---

## 2. Flutter (no first-party updater — community, with Shorebird as the de facto)

### Why Flutter punted on auto-update

Flutter ships its own engine, its own VM, and its own build pipeline. Google has never shipped a first-party code-push equivalent because:
- The store policies they cite (Apple Developer Program License Agreement 3.3.1, Google Play Developer Program Policies) restrict executing code that wasn't reviewed.
- Flutter's rendering pipeline (Impeller / Skia) and Dart VM are heavily tied to native code, and a "true" code-push that re-ships the engine is far outside what the stores tolerate.
- Their first-party Flutter tooling (flutter_tools, pub) is a release-time story, not an OTA story.

So Flutter ships a release-pipeline, not an update-pipeline. The community response has been three options:

1. **Build the .apk / .ipa, ship via the stores.** Every Flutter app does this by default.
2. **`package_info_plus` + custom JSON.** Developers query their own endpoint for a "force update" banner, but this can't ship new Dart code.
3. **Shorebird.** This is the one most Flutter teams reach for in 2025–2026.

### Shorebird (the Flutter code-push equivalent)

**Verified facts (shorebird.dev homepage, late 2025/early 2026):**
- Founded in 2023 by Eric Seidel (the original creator of Flutter). Backed by Accel.
- Open-source CLI and protocol (Apache-2.0 / MIT dual license). Hosted control plane at `console.shorebird.dev`.
- Supports **Android, iOS, macOS, Windows, and Linux**.
- "Free for 5,000 patch installs a month." (Pricing is usage-based above the free tier.)
- Fork of Flutter's engine that adds Code Push — the patch replaces the compiled Dart kernel inside the existing native shell. No native code is replaced, so it stays inside store policy.
- Built-in signing (now on by default — see the "Patch signing, now on by default" blog post on the homepage), channels (staging / beta / stable), auto-rollback, mission-control rollout dashboard.
- Paid tiers for larger teams (SAML single sign-on, audit logs, invoice billing).
- Self-hosting: explicitly not available — Shorebird's FAQ says "Shorebird has no plans to offer on-prem, self-hosted or cloud-prem versions." This is a deliberate SaaS-only choice.

### How Shorebird stays inside store policy

The mechanism is clever: when you build a Flutter app with Shorebird, Shorebird replaces Flutter's standard AOT-compile pipeline so that the Dart kernel is shipped as a *patchable artifact* — separate from the native binary. The app on the user's device contains both the native shell (which was reviewed by the store) and a Dart kernel slot. A Shorebird patch replaces only the Dart kernel. From the store's perspective:

- Apple's §3.3.1: the patch is "data," not "executable code." This is the same loophole that React Native's CodePush used; Shorebird's legal FAQ explicitly cites the same Apple Developer Program License Agreement section.
- Google Play: the patch is "content," not "code" — same posture as React Native and Capacitor apps.

What Shorebird **cannot** patch: changes to native plugins (i.e., the Kotlin/Java/Swift/Objective-C plugin code), changes to `pubspec.yaml` plugin versions, changes to Gradle/Podfile, changes to assets, changes to permissions. The CLI warns you at patch time if it detects these.

### Real-world apps shipping with Shorebird

From the homepage customer wall (logos verified at `shorebird.dev/`):
- **Scapia** (Indian travel fintech) — "same-day fixes on Android and iOS, for millions of users." Engineer quote: "Shorebird is our only firefighting tool."
- **VETC** (Vietnam electronic-toll-collection) — "hours to ship a critical hotfix, down from several days."
- **PushPress** (US gym-management SaaS) — "1,500+ white-labeled apps maintained through Shorebird."
- **Junglee Games** (India, rummy/poker/fantasy sports) — "2M+ patch installs a month, for 1M+ daily players."
- **Couchsurfing** (US travel community).
- **Cloudwalk** (Brazil payments).
- **Delivery Hero** (Berlin food delivery).
- **Kalshi** (US prediction market).
- **Solides** (Brazil HR tech).

### Other community options (less adopted)

- **Codemagic CI** ships "Shorebird integration" out of the box in CI pipelines; the runtime is still Shorebird.
- **`appcenter-cli` / `dart_code_push`** — an experimental, dead fork from the App Center era. Not in production anywhere visible.
- **Hot restart / hot reload** in debug builds is not an OTA story.
- **`firebase_remote_config`** — can flip feature flags, but can't ship new Dart code.

### What this means for AIRIZ if the team picks Flutter

If AIRIZ is Flutter-first:
- The mobile (Android/iOS) update story is solved *with caveats* via Shorebird — patches only, and a non-trivial subscription cost once AIRIZ scales past 5,000 patch installs/month.
- The macOS / Windows / Linux desktop story is solved *via Shorebird too*, on the same engine fork.
- The web (Flutter Web) story is **not solved by Shorebird**. Flutter Web compiles to either JavaScript (CanvasKit / Skwasm) or WebAssembly, served as a static bundle. The "update" mechanism is "re-deploy the bundle to the CDN and let the user's next page-load pick it up." There's no in-page updater for Flutter Web.

### Verdict

**Punted (Google).** **Solved (Shorebird, commercially).** For Flutter alone, Shorebird is the closest thing the industry has to a unified updater, and it covers five of the six targets AIRIZ cares about (Android, iOS, macOS, Windows, Linux). It does **not** cover the open web — Shorebird works on Flutter Desktop, not on a `flutter build web` PWA.

### Update mechanisms the team is on the hook for

**Without Shorebird: 4–5** (Play Store, App Store, macOS DMG/sign + Sparkle-style for Mac Catalyst if used, .msi/.exe, .deb/.rpm/AppImage/Snap/Flatpak — pick your Linux flavor).
**With Shorebird: 1** for code-only patches (the Dart kernel); plus 1 per platform for binary changes (rare but real). The team still has to ship via the stores for any change Shorebird can't handle — a store release is required when you bump a native plugin version, change an asset, change a permission, or change the Gradle/Podfile configuration.

---

## 3. .NET MAUI (sideload + MSIX, no first-party updater)

### The platform footprint

`.NET MAUI` is Microsoft Multi-platform App UI — a single-project system targeting Android, iOS, macOS (via Mac Catalyst), Windows, and Tizen. Verified against `learn.microsoft.com/en-us/dotnet/maui/` (updated 2026-04-16). The MAUI monikers are `net-maui-8.0` through `net-maui-11.0`, so the current shipping version is .NET MAUI 11 (built on .NET 11). Authoritative author is `davidortinau` (Microsoft PM).

### What MAUI provides for updates

The MAUI deployment docs (`/dotnet/maui/deployment/`) cover **packaging and publishing**:
- **Android:** AAB / APK distributed via Google Play or sideloaded.
- **iOS:** .ipa file distributed via App Store or TestFlight.
- **Mac Catalyst:** .app or .pkg distributed via Mac App Store or developer ID.
- **Windows:** MSIX package via Microsoft Store, or unpackaged executable via `dotnet publish`.

That's it. There is **no `MauiApp.Update()` API**. There is no background updater. The deployment page does not contain the words "auto update" or "self update." A `grep` of the MAUI monikers for "update" turns up only documentation about *development-time* hot-reload (XAML hot reload, Hot Restart for iOS builds), not production update mechanisms.

### Community options (the actual ecosystem)

- **`Microsoft.AutoUpdater` (NuGet, by nimanmg)** — wraps WinSparkle on Windows and Sparkle on macOS. Free, but Windows-only / macOS-only; it explicitly does not handle iOS/Android.
- **`AutoUpdater.NET`** — Windows-only WinForms/WPF updater; doesn't understand MAUI's lifecycle.
- **`Squirrel.Windows` / `Squirrel.Mac`** — predecessor to MSIX-style "install on next launch" frameworks. Maintained loosely by Paul Betts; works for Windows .NET MAUI apps but ignores mobile.
- **MSIX + AppInstaller** (`AppInstaller.xml`) — Microsoft's own mechanism for *sideloaded* Windows updates. Works fine for MAUI Windows targets; user gets an update prompt via the Windows shell. The MAUI Windows publish doc (`/dotnet/maui/windows/deployment/overview`) explicitly walks you through creating `Package.appxmanifest` and packaging via MSIX, but does not itself handle the runtime update check.
- **Azure App Center / MAUI self-update tooling** — Microsoft retired App Center on March 31, 2025 (see section 6). Any MAUI team that was relying on it is migrating. Microsoft's own retirement FAQ points MAUI users to Azure Pipelines for build, Microsoft Store for distribution, and Datadog/Dynatrace/New Relic for analytics.

### Real-world apps shipping with .NET MAUI + a self-update story

Public shipping examples are scarce precisely because of the fragmented updater story. Microsoft's own MAUI showcase (`/dotnet/maui/samples`) lists example apps (the Notes app, the MVVM pattern app, the Bracket Builder sample), but none ship an OTA story. The "real" production MAUI apps are mostly Microsoft-internal, enterprise line-of-business, or behind auth walls — meaning we cannot audit their update mechanisms.

The publicly-documented pattern in the wild is: **MAUI Windows → MSIX/AppInstaller, MAUI Android/iOS → Store, MAUI macOS → Sparkle or App Store, and the team ships 3–4 different pipelines.**

### What AIRIZ gains and loses with MAUI-as-updater

- **Gain:** single C# / XAML codebase.
- **Gain:** Visual Studio + Visual Studio for Mac tooling, which is mature for MAUI.
- **Loss:** no first-party unified updater; the team is on the hook for 3–4 separate update pipelines.
- **Loss:** Mac Catalyst is a real second-class citizen — building requires a Mac (Pair to Mac), and Mac Catalyst apps have stricter sandboxing rules.
- **Loss:** the MAUI Blazor Hybrid path requires a WebView2 runtime on Windows, which itself is updated via Windows Update, not via the MAUI app — adding another update mechanism on top.

### Verdict

**Punted.** Microsoft has shipped a packaging framework that targets five platforms, and has left the *update* question entirely to per-platform mechanisms. The official answer is "use the store." For sideloaded Windows-only MAUI apps, MSIX/AppInstaller does the job; for everything else, the team is on its own.

### Update mechanisms the team is on the hook for

**4** (Google Play for Android, App Store for iOS, App Store for Mac Catalyst, MSIX/AppInstaller or Microsoft Store for Windows). Optionally a fifth if Tizen is in scope. If the team uses MAUI Blazor Hybrid, that adds a sixth (WebView2 on Windows, which is governed by Windows Update).

---

## 4. Uno Platform (web + native)

### The platform footprint

Verified against `platform.uno/` (updated late 2025/early 2026). Uno Platform's marketed target matrix:

- Windows 10/11
- iOS & Android
- WebAssembly
- Linux (Skia rendering)
- macOS
- Windows 7 (legacy)

Uno is the "WinUI everywhere" framework: write XAML/C# once, render to UWP/WinUI 3, iOS UIKit, Android Views, WebAssembly, GTK, or AppKit. The recent pivot is "Uno Platform Studio" — a Visual Studio / VS Code integration with Hot Design (live UI editing), MCP servers for AI tooling, and Figma import. The homepage tagline is "Build Cross-Platform .NET Applications in record time." Uno itself remains open-source and free under Apache 2.0; the Studio product is a paid subscription.

The Uno homepage customer wall (verified late 2025/early 2026) shows: VCA, NetLift, Kahua, CCM, IA, Encore, Trader Zero, NGL, Parkland, Sentry, Cineplex, PJC, Air Canada, MCN, ZIIDMS, Dispatch, Toyota, Brain. That's a real enterprise customer base, mostly line-of-business and internal tools.

### Update story per target

Uno does not ship a unified updater. The community's per-target update story is the same as for any native-or-web codebase:

- **WebAssembly:** Your browser fetches the new bundle from your CDN. That's the "update mechanism." Uno generates a static `.wasm` + supporting `.js` + `.dll` payload that the browser caches; updates happen on the next page load.
- **Windows 10/11:** MSIX + AppInstaller (same as MAUI). Uno for WinUI 3 is published as an MSIX package.
- **iOS / Android:** Stores only.
- **macOS:** Sparkle or Mac App Store. Uno's GTK / AppKit build for macOS uses Catalyst-style packaging.
- **Linux:** AppImage self-update, .deb from a PPA, Flatpak, Snap — pick one. Uno for Linux Skia has no preferred distribution format documented.

Uno's documented value is "your UI code compiles everywhere," not "your updates ship everywhere." Uno Studio will help you hot-reload during development, but the production-update story is unchanged.

### What AIRIZ gains and loses with Uno-as-updater

- **Gain:** the widest target matrix of any framework we surveyed — Windows 10/11, Win7 (legacy!), iOS, Android, WebAssembly, Linux, macOS. If AIRIZ needs Win7 support, Uno is one of the only options.
- **Gain:** strong tooling story (Uno Platform Studio, Hot Design, Figma import).
- **Loss:** the "5+ update mechanisms" answer is the worst of any framework in this survey, precisely because Uno targets the most platforms.
- **Loss:** Uno's customer base is mostly enterprise / line-of-business / internal tools — there is no published "update architecture" for a public-facing consumer app on Uno.

### Real-world apps shipping with Uno

The customer logos on the Uno homepage include: VCA, NetLift, Kahua, CCM, IA, Encore, Trader Zero, NGL, Parkland, Sentry, Cineplex, PJC, Air Canada, MCN, ZIIDMS, Dispatch, Toyota, Brain. None of these are publicly documented as using a unified updater. None are publicly documented as having a *non*-unified updater either, but the silence is consistent with "use the store on each platform." Uno's case-studies page (`platform.uno/case-studies/`) shows more detail on Air Canada and a few others, but again, no update-architecture detail.

### Verdict

**Never tried.** Uno treats the update problem as outside its scope. It is, fundamentally, a UI-rendering framework, and the update plumbing is left to the platform.

### Update mechanisms the team is on the hook for

**5–6** depending on which Linux distribution story you commit to. WebAssembly is the only target where the framework owner has a coherent story (CDN-cached bundles). If you also need Windows 7, add a seventh (no auto-update mechanism exists for Win7 — the team would have to ship a custom updater or instruct users to re-install).

---

## 5. Kotlin Multiplatform (no first-party updater)

### What KMP is

Kotlin Multiplatform (KMP) is JetBrains' answer to "share Kotlin business logic across iOS, Android, JVM desktop, JS, Wasm, and native." It is *not* a UI framework; Compose Multiplatform is the UI layer that sits on top of it for some targets. KMP ships a build system and a compiler; it does not ship a runtime, an updater, or a packaging story of its own.

### What KMP doesn't do

There is no `kotlin-multiplatform-updater` artifact. There is no `org.jetbrains.update` namespace. The JetBrains Marketplace does not list a unified updater. The closest the ecosystem gets is:
- **Kotlin/Native** has its own compiler, but the resulting binaries are dropped onto each platform's standard packaging — IPA for iOS, APK/AAB for Android, .exe for Windows, .app for macOS, etc.
- **Compose Multiplatform** uses the same packaging because it's still just Kotlin code emitted per platform.

### Community solutions

Sparse. A search for "kotlin multiplatform auto-update" turns up forum posts, two-three abandoned GitHub gists, and small libraries like `multiplatform-update` that wrap a JSON endpoint check. None of these are products. None of them are used by named production apps in any visible way. The closest thing to a "product-grade" KMP updater story is to write the platform-specific updater in the shared module (e.g., a `commonMain` function that calls into `androidMain`'s `PackageInfo` and `iosMain`'s `NSBundle` for the version, then performs an HTTP check), but this is one-shot glue code, not a maintained library.

### What teams actually do

The pattern is the same as for MAUI and Uno: each platform gets its own store / OS update channel. Some teams bolt on the per-platform tooling (Sparkle for macOS, AppUpdater on Android, MSIX for Windows) inside their shared module. Others punt entirely and let the store handle it.

### Real-world apps shipping with KMP

KMP is in production at **Philips**, **Cash App (Block)**, **Forbes**, **Baidu**, **Vimeo**, **JetBrains' own products**, and **Netflix** (some shared modules). JetBrains publishes a "Case studies" page that lists these and more. None of these are publicly documented as using a unified updater — most of them are mobile-only and rely on Play/App Store. JetBrains' own products (e.g., the Kotlin plugin for IntelliJ IDEA) are distributed through JetBrains' own marketplace or as part of IntelliJ, not via an OTA updater story.

### What AIRIZ gains and loses with KMP-as-updater

- **Gain:** KMP is the most flexible "share Kotlin, deploy native" story in the industry. You can compose it with Compose Multiplatform for a unified UI, or with native UI (Swift on iOS, Jetpack Compose on Android) for the best-of-breed UX.
- **Gain:** first-class interop with native code via `expect/actual` — meaning the team can use any native updater library (e.g., CodePush for the RN portion, Sparkle for macOS) without leaving the KMP world.
- **Loss:** KMP is a language layer. There is no "KMP updater." You build it yourself, or you bolt on per-platform libraries.
- **Loss:** the Kotlin community has not coalesced around an updater library the way the Flutter community has around Shorebird. If AIRIZ commits to KMP, AIRIZ is committing to maintain its own updater glue.

### Verdict

**Never tried.** KMP is a language/compiler layer; it explicitly does not own the distribution or update problem. The community has not filled the gap with a credible product.

### Update mechanisms the team is on the hook for

**4+** — same as MAUI: one per platform the team targets. There is no consolidation. If the team also ships a Compose Multiplatform desktop (JVM) target, add a fifth (JDK-managed or per-OS installer). If the team ships a KMP/JS or KMP/Wasm web target, add a sixth (CDN re-deploy).

---

## 6. React Native (`react-native-code-push` sunset)

### The current state of CodePush

Verified against `learn.microsoft.com/en-us/appcenter/retirement` (last updated 2026-04-15):

> Visual Studio App Center is scheduled for retirement on March 31, 2025. After that date, it will not be possible to sign in with your user account nor make API calls.

CodePush (the OTA service that Microsoft inherited when it acquired HockeyApp/code-push) lived inside App Center. App Center was retired on March 31, 2025. Analytics & Diagnostics were extended to June 2026, then to March 2027 (with Azure Monitor Mobile Analytics as the migration path). The April 15, 2026 update to the retirement FAQ confirmed that Azure Monitor Mobile Analytics is now in public preview and the Analytics & Diagnostics service will be supported through end of March 2027.

Microsoft's official hand-off (verbatim from the retirement page):
- App Center **Build** → migrate to Azure Pipelines.
- App Center **Test** → migrate to BrowserStack App Automate.
- App Center **Distribution** → migrate to App Store / TestFlight / Google Play / Microsoft Store / Azure Pipelines tasks.
- App Center **CodePush** → "We have prepared a special version of CodePush that can be integrated into your app and run independently from App Center. You can access the source code and the documentation ... in this GitHub repository: https://github.com/microsoft/code-push-server."

So CodePush is **not dead** — it is **open-sourced**, and Microsoft handed the keys to the community. Teams that want to use CodePush in 2026 must self-host `microsoft/code-push-server`. The hosted service is gone, and there is no public statement on whether Microsoft will keep updating the open-source repo.

### Where RN teams migrated

Four named survivors, in roughly this order of adoption:

1. **Expo EAS Updates** (the Expo path). Hosted by Expo, free tier, integrates with EAS Build, native binary fingerprint checks, channels, rollouts, Slack/Discord notifications. Works for Expo and bare RN.
2. **Appcircle CodePush** (verified at `appcircle.io/codepush/`). A drop-in replacement that supports the existing `react-native-code-push` SDK against a hosted or self-hosted server. Supports the New Architecture (RN 0.76+), package diffs, code signing, SSO, audit logs. Appcircle publishes a comparison page ("Is CodePush deprecated?") that explicitly positions itself as the replacement.
3. **Codemagic Patch** (verified at `patch.codemagic.io`). Self-hosted, React Native-only, "installed in twenty minutes," CDN-fronted, binary fingerprint checks, binary diffs, RBAC. Open-sourced at `github.com/codemagic-ci-cd/codemagic-patch`.
4. **Self-host `microsoft/code-push-server`** — Microsoft-published repo, requires Redis + SQL Server + blob storage. Operationally heavier than the alternatives but keeps you on the SDK everyone already has.

### Real-world apps shipping with CodePush (historically and currently)

Historically (Microsoft's published CodePush adopters list):
- **Microsoft Outlook Mobile** (RN portions).
- **Microsoft Edge Mobile** (RN portions).
- **Bing Mobile**.
- **Discord** (RN portions of the chat client).
- **Bose SoundTouch** apps.
- **Pinterest** (early RN experimentation).
- **Tesla** (RN portions of the mobile app).

As of 2026 the migration picture is fragmentary. Microsoft has kept Outlook/Edge internal infra (likely a self-hosted code-push-server instance); smaller shops have moved to EAS Updates or self-hosted Appcircle/Patch. Appcircle's customer wall (Ziraat Teknoloji, Intertech, Halkbank — 40+ mobile apps, 100M+ downloads) is now using Appcircle CodePush for OTA.

### What AIRIZ gains and loses with RN-as-updater

- **Gain:** a JS-bundle-only OTA story is mature and battle-tested across multiple vendors.
- **Gain:** the `react-native-code-push` SDK is still maintained as open source; you can switch vendors behind the same SDK calls.
- **Loss:** the hosted, single-vendor experience is gone. Every team has to either pick one of the four above, or run their own infra.
- **Loss:** native module updates still go through the stores. CodePush was always JS-only.

### Verdict

**Died.** The hosted product is dead. The protocol and SDK live on through three (or more) replacements. If AIRIZ adopted RN, the update story would be "pick one of: Expo EAS, Appcircle, Codemagic Patch, or self-host microsoft/code-push-server." None of those give you the same out-of-the-box experience the old CodePush did.

### Update mechanisms the team is on the hook for

**1** if you pick one of the CodePush successors. (CodePush is JS-bundle-only — it cannot ship native changes.) **2** if you also count store updates for anything native. The team will spend non-trivial time in 2026 evaluating which CodePush replacement to standardize on; that decision is essentially permanent once made.

---

## 7. Capawesome (Capacitor Live Update + Live Activities + plugins)

### The plugin stack

Verified against `capawesome.io/plugins/live-update/` and `capawesome.io/plugins/`. Capawesome is the company (legal: Genz IT Solutions GmbH, founded 2022) behind a battery of open-source Capacitor plugins plus a hosted control plane. The flagship for our purposes is **`@capawesome/capacitor-live-update`**, which is **one of the most feature-rich OTA update solutions for Capacitor apps** in the company's own words. The relevant features for AIRIZ:

- **Supports Android, iOS, and Electron.**
- **Capacitor 6/7/8** compatibility (8.x is active, 7.x and 6.x in maintenance, 5.x deprecated).
- Bundle management (download, set, delete), channels, auto-update, rollback, *gradual rollout*, delta updates, runtime config, lifecycle events.
- **Ionic Portals** and **Federated Capacitor** support (Capawesome is Ionic's officially recommended migration partner after Appflow).
- **Security:** RSA public-key bundle verification (PEM-encoded), code-signing key per app.
- Self-hosted option (download from any URL, no Capawesome Cloud required).
- Live Activity (iOS) and App Group (iOS) plugins — separate Capacitor plugins, but part of the same family.
- App Update plugin — separate `@capawesome/capacitor-app-update` that wraps Google Play's `In-App Updates` API and Apple's iTunes Search API to detect available store-side updates and prompt the user.

The plugin's stated battle-test: **"Used in more than 1,000 projects to update apps on more than 20,000,000 devices."** (Note that this is the company-wide install base across plugins; the Live Update plugin specifically powers the OTA story.)

### Pricing and license

- The Live Update plugin itself is **MIT-licensed open source**.
- The **advanced** plugins (Biometrics, OAuth, SQLite, NFC, Bluetooth LE, Apple Sign-In) are gated behind the **Capawesome Insiders** program — flat-rate pricing, no per-seat or per-app fees.
- The hosted control plane (Capawesome Cloud) is a separate subscription that bundles live-update hosting, native builds, and App Store publishing.
- Enterprise tier: dedicated Slack/Discord channels, contractual uptime, security reviews.
- Consulting tier: bespoke native SDK development.

### Real-world adoption

Capawesome's customer wall (verified at `capawesome.io/plugins/`) shows: "from indie studios to Fortune 500." Capawesome is "Ionic's officially recommended migration partner for Appflow and the Ionic Enterprise SDKs." Their migration guide "Migrating from Ionic Appflow to Capawesome Cloud" is one of the most-shared docs in the Capacitor ecosystem right now, because Appflow's pricing/availability changed in 2025. Appcircle's own customer base (Ziraat Teknoloji, Intertech, Halkbank) is also a heavy Capawesome consumer.

### What Capawesome does **not** cover

Capawesome Live Update explicitly targets Android, iOS, and **Electron**. It does **not** target:
- Standalone desktop browsers (the Live Update plugin isn't designed for that — Capacitor's web target is a different beast; you serve a different bundle per web deploy).
- macOS apps outside Capacitor Electron (no Mac Catalyst target).
- Windows native apps.
- Linux.

If AIRIZ's desktop half is "Electron wrapper," Capawesome covers all three of (Android, iOS, Electron). If AIRIZ's desktop half is "Tauri," Capawesome covers only the mobile half and Tauri covers the desktop half.

### What AIRIZ gains and loses with Capawesome-as-updater

- **Gain:** the best-supported OTA story for Capacitor-based apps. "Used in 1,000+ projects, 20M+ devices" is the largest install base of any single Capacitor OTA plugin.
- **Gain:** self-hostable, with RSA-signed bundles, so AIRIZ can keep its own keys.
- **Gain:** official Ionic partnership — this is the migration target if you were an Ionic Appflow customer.
- **Loss:** mobile + Electron only. Web, native macOS, native Windows, and Linux are not covered.
- **Loss:** the Insiders program gates some plugins behind a paid subscription (though not Live Update itself).

### Verdict

**Solved (mobile + Electron).** For Capacitor-based apps, Capawesome is the best-supported, most-adopted OTA story on the market in 2025–2026. It is the closest thing to a unified updater for the mobile half of a Capacitor/Electron codebase, and it explicitly beats Capgo and Ionic Appflow on reliability per Capawesome's own benchmarks.

### Update mechanisms the team is on the hook for

**2** for a Capacitor + desktop-Electron codebase (Capawesome Live Update + Electron's own `autoUpdater` from `electron-updater`). **3** if you also need browser web (where you'd add a service worker or rebuild-and-redeploy flow). The team's Capacitor App Update plugin doesn't add a third mechanism — it is just a UI wrapper around the store's update flow, which would otherwise be the only mechanism on mobile.

---

## 8. Voltbuilder (hosted Cordova / Capacitor)

### What Voltbuilder offers

Verified against `volt.build/` and `volt.build/docs/all/`. Voltbuilder is NS Basic's hosted build service. The pitch: zip your web project, upload it, get a native Android and iOS app back. It supports both **Cordova** and **Capacitor** projects, has a VS Code extension, an API for CI integration, and a 15-day free trial at $15/month and up.

The docs site organizes Voltbuilder's offering as:
- Build Environment (Android and iOS build servers, SDK management)
- Capacitor (zip, build)
- Cordova (zip, build, hooks)
- Generating icons and splash screens
- Uploading to stores (Google Play, App Store Connect, hosted-on-VoltBuilder)
- VS Code extension
- Ionic Appflow migration guide (explicit positioning)
- PhoneGap migration guide (PhoneGap Build is fully archived)

### Update story

**None built in.** Voltbuilder builds the binary and (optionally) uploads it to the stores. There is no OTA mechanism, no in-app updater, no bundle-replacement story. The team's update path is "re-upload, re-build, re-submit to the stores."

This is by design — Voltbuilder's positioning is "we are the build service, not the update service." Their migration guide from Ionic Appflow explicitly says: Appflow had a build + OTA bundle; Voltbuilder has the build only.

### Hosting option

Voltbuilder does offer "Hosting your app on VoltBuilder" (`/docs/hosting/`), but that's web hosting for a Cordova-style webview app — it's not an OTA updater. The hosting tier is for apps whose content is web pages (e.g., a wrapper around a marketing site); it is not a JS-bundle OTA story.

### Real-world adoption

Voltbuilder's homepage lists testimonials from individual developers ("David, Ireland"; "Paul, UK"; "Leslie, USA") — the product is real but small. It's positioned as the easy replacement for the now-archived PhoneGap Build and as a cheaper alternative to Ionic Appflow. Their changelog and blog (e.g., "Weekly Wrap-up: July 25, 2025") show steady incremental work, not enterprise scale. Voltbuilder also publishes a comparison page "Appflow vs VoltBuilder" that highlights the price difference ($15/month vs $99+/month).

### What AIRIZ gains and loses with Voltbuilder-as-build-service

- **Gain:** the cheapest, simplest path to "I have a web app and I want a native iOS/Android binary."
- **Gain:** zero infrastructure to maintain; it's a pure hosted service.
- **Loss:** no OTA story. If AIRIZ uses Voltbuilder for builds, AIRIZ still needs to either integrate Capawesome/Cordova-plugin-update for OTA or accept store-only updates.
- **Loss:** Voltbuilder does not ship Windows or macOS desktop binaries — it's mobile-only. So if AIRIZ's desktop half is "build with Voltbuilder," there is no Voltbuilder story at all.

### Verdict

**Never tried.** Voltbuilder's product explicitly excludes the update question. It's a Cordova/Capacitor build service.

### Update mechanisms the team is on the hook for

**1–2.** If the team picks Voltbuilder for builds, they still need a Capawesome-or-equivalent for OTA, or they fall back to "store updates only." Voltbuilder's hosting tier is for static-content apps, not OTA.

---

## 9. Appcircle

### What Appcircle is

Verified against `appcircle.io/` and `appcircle.io/codepush/`. Appcircle is a mobile CI/CD platform with explicit modules for **Build, Signing Identities, Testing Distribution, Publish to Stores, Enterprise App Store, and CodePush.** It supports iOS, Android, React Native, and Flutter pipelines, and it ships in both **cloud** and **self-hosted** (Kubernetes, OpenShift, Docker, Podman) deployment models.

The customer wall includes: Coca-Cola, Renault, Panasonic, Proton, Togg, Turkcell, Ziraat Bankası, American Express Global Business Travel, Hepsiburada, Getir, Teknasyon, Starkey, Intertech, Halkbank, Ziraat Teknoloji, 2K, FLO, DeFacto, LifeScan, AIA, Accenture, Teknasyon, and many more. Quoted metrics on the homepage: 78% decrease in build times, 40% overall productivity, 50% faster releases, 500+ enterprise clients. ISO 27001 and SOC 2 Type 2 certified.

### Update story

Appcircle has **two** update stories, depending on the module:

1. **Appcircle CodePush** (verified at `appcircle.io/codepush/`). A React-Native-targeted OTA service, positioned as "the best CodePush alternative." Features:
   - Differential updates (binary diffs)
   - CI/CD integration (one workflow from build to CodePush)
   - Code signing (digital signature on every bundle; client-side validation)
   - Code obfuscation (defense against reverse engineering)
   - RBAC (role-based access control)
   - New Architecture support (RN 0.76+)
   - CDN support (yours or theirs, with SSL)
   - CLI auth with SSO / personal access tokens
   - Audit logs and reports (rollbacks, rollout percentages, monthly active users)
   - Self-hosted mode (run on Appcircle's enterprise self-hosted platform)
   This is the closest single-vendor replacement for the dead Microsoft CodePush, and it advertises drop-in compatibility with the `react-native-code-push` SDK.

2. **Enterprise App Store** — `appcircle.io/enterprise-app-store/`. For B2B/B2E/internal apps distributed outside the public stores. The product page says: "Keep apps up to date with built-in in-app update capabilities." This is an in-house App Store experience with an in-app update flow — share `.ipa`, `.apk`, or `.aab` files directly with users, no MDM required, SSO/LDAP, role-based access controls, comprehensive app usage reporting.

Appcircle does **not** ship an updater that targets desktop (Windows, macOS, Linux) as a framework-level concern. It is mobile-first. The closest it comes to "desktop" is the macOS-services module for native iOS builds (which runs on a Mac hardware pool), not an end-user desktop updater.

### What AIRIZ gains and loses with Appcircle-as-CI/CD

- **Gain:** the cleanest CodePush replacement in the market in 2026. If AIRIZ's mobile is RN and AIRIZ wants a single hosted platform, Appcircle covers the entire pipeline.
- **Gain:** Enterprise App Store is a real product, not a feature checkbox. Companies like Halkbank ship internal apps this way.
- **Gain:** ISO 27001 + SOC 2 Type 2, which matters for enterprise procurement.
- **Loss:** RN-only on the CodePush side. Flutter, Capacitor, native iOS, native Android teams are not covered by the CodePush module (they would need Shorebird / Capawesome / Capacitor App Update / etc.).
- **Loss:** no desktop updater story.

### Real-world apps shipping with Appcircle CodePush

Ziraat Teknoloji (Turkish state bank, 36% resource savings, 100M+ downloads across 40+ mobile apps), Intertech (Turkish fintech, 50%+ productivity boost), Halkbank (Turkish bank, 65% faster code review, 50%+ faster releases), 2K Games (US game publisher, gaming apps), FLO (Turkish fashion retailer, B2C mobile apps).

### Verdict

**Solved (React Native + Enterprise App Store); punted elsewhere.** If AIRIZ's mobile codebase is React Native and AIRIZ's desktop is browser/web, Appcircle CodePush is the cleanest single-mechanism story. If AIRIZ's mobile is Flutter, Appcircle CodePush is irrelevant and the Flutter half still needs Shorebird or an equivalent.

### Update mechanisms the team is on the hook for

**1–3** depending on stack:
- 1 for an RN-only mobile + web desktop story (Appcircle CodePush).
- 2 if iOS/Android stay in the public stores and RN updates via CodePush (CodePush + store binaries).
- 3 if you also need Tizen or another side platform, or if you adopt Enterprise App Store as a fourth channel for B2E distribution.

---

## 10. Codemagic

### What Codemagic is

Verified against `codemagic.io/`. Codemagic (operated by Nevercode Ltd.) is a hosted mobile CI/CD platform that explicitly markets: "One tool for all your mobile app builds. Test, build and release with ease." Their CI/CD supports **Flutter, React Native, Native iOS, Native Android, Ionic, Unity, and MAUI.** They claim 150,000+ developers, SOC 2 Type 2, ISO 27001.

### Update story

Codemagic has **two** update stories (different from Appcircle's):

1. **Codemagic CodePush** (`codemagic.io/codepush`). A hosted CodePush service for React Native, distinct from the Codemagic CI product. Brand overlap, different product.

2. **Codemagic Patch** (verified at `patch.codemagic.io/`). A self-hosted OTA service for React Native, open-sourced at `github.com/codemagic-ci-cd/codemagic-patch`. The pitch: "The easiest way to self-host OTA updates ... Installed in twenty minutes ... One command starts the install wizard, which configures OAuth, CDN cache rules and TLS, then brings the stack up with Docker Compose." Key features:
   - **Binary fingerprinting** (the runtime blocks incompatible bundles against the targeted native binary).
   - **Binary diffs** (only the changed bytes ship; small download on bad networks).
   - **CDN-fronted** delivery (devices hit the CDN, not your origin; the server is never overwhelmed).
   - **Dashboard with team access and RBAC** (vs. most self-hosted CodePush installs, which are CLI-only).
   - **Install timing modes**: immediate, restart, resume, suspend (vs. older tools that only support `sync()` install modes).
   - **Support license** available (vs. open-source-only self-host alternatives that only get GitHub issues).
   - **Migration path** from other self-hosted OTA tools (Patch provides a comparison table on its homepage that explicitly positions itself against the alternative).

Codemagic does **not** ship a Flutter OTA. The Flutter CI is just CI. Flutter teams go to Shorebird.

### Real-world adoption

Codemagic's customer wall includes global retail (a "global retail and supermarket chain"), social media tooling, mental health apps, fitness apps, urban mobility apps (a public-transit app), GPS fitness-tracking apps, and consultancies (a "top Flutter app development company in LATAM"). They don't publish a per-product breakdown of which customers use Patch specifically.

### What AIRIZ gains and loses with Codemagic-as-CI/CD-and-Patch

- **Gain:** the best self-hosted RN OTA story in 2026, with a 20-minute install wizard.
- **Gain:** Patch is open source; the team owns the deployment and can audit the binary diff algorithm.
- **Gain:** the wider Codemagic CI covers Flutter / RN / Native iOS / Native Android / Ionic / Unity / MAUI — meaning AIRIZ's CI story can be a single tool across the whole monorepo.
- **Loss:** Patch is RN-only. Flutter teams must use Shorebird separately.
- **Loss:** self-hosting Patch means AIRIZ owns the OAuth, CDN cache, and TLS configuration; Codemagic provides the wizard but the operational burden is on AIRIZ.

### Verdict

**Solved (React Native), punted (Flutter).** Patch is the strongest self-hosted CodePush replacement in 2025–2026 — better than Appcircle's self-host option if you want fine-grained control and don't want to pay for Appcircle's enterprise features. For Flutter, Codemagic is irrelevant for updates.

### Update mechanisms the team is on the hook for

**1** for an RN + self-hosted mobile story (Patch). Same caveat as Appcircle: native changes still go through the stores. **2** if AIRIZ's mobile is Flutter (Shorebird + Codemagic CI for store releases). **3** if AIRIZ also ships a web build (CDN re-deploy).

---

## Synthesis: what AIRIZ actually faces

Mapping the AIRIZ Motor Console's likely target list (Tauri desktop + Capacitor-or-web mobile + WebAssembly web) against the landscape:

| Target | Update mechanism in 2025–2026 |
|--------|-------------------------------|
| Windows desktop | Tauri updater |
| macOS desktop | Tauri updater |
| Linux desktop | Tauri updater |
| Android | Play Store (no Tauri updater, no Capawesome unless Capacitor shell) |
| iOS | App Store (no Tauri updater, no Capawesome unless Capacitor shell) |
| Web (browser) | CDN-deployed bundle (no updater framework exists) |

The question the owner is asking — "is there a unified model anyone actually likes?" — has the following evidence-based answer: **no**. Every framework has punted, died, or never tried. The framework owners' silence on this question is consistent across the entire industry. The reason is policy, not engineering: Apple and Google's app-store rules prevent shipping a true unified in-app updater that touches native code.

The closest thing to a "unified" story is a *combination*:

1. **Tauri updater for desktop** + **store updates for mobile** + **CDN re-deploy for web** — this is the AIRIZ-as-Tauri path. 3 mechanisms. Users will perceive this as "Windows/macOS/Linux update automatically, mobile updates through the store, web is just a tab."
2. **Capawesome Live Update for Android, iOS, Electron** + **Electron's autoUpdater for desktop** + **CDN re-deploy for web** — this is the AIRIZ-as-Capacitor-shell path. 3 mechanisms, but you don't have to maintain a separate Tauri codebase. Bigger architectural commitment.
3. **Capacitor + Tauri hybrid** — Capacitor for mobile/web (with Capawesome Live Update), Tauri for desktop (with the Tauri updater). 4 distinct update pipelines because Tauri and Capacitor need their own binaries.

There is no path with **1** update mechanism that covers all six targets unless AIRIZ commits to a single-platform story (e.g., "mobile-only Capacitor + Appcircle CodePush" gives 1 mechanism but loses desktop).

### What "1 mechanism" actually looks like in practice

The single-mechanism paths are narrow:

- **Mobile-only (RN or Capacitor) + Appcircle CodePush / EAS Updates / Codemagic Patch** — 1 mechanism for the entire JS bundle. Native changes still go through the stores, so it's really 1.5 mechanisms.
- **Flutter-only + Shorebird** — 1 mechanism for the Dart kernel. Native and asset changes go through the stores, so again 1.5.
- **Desktop-only (Tauri) + Tauri updater** — 1 mechanism. The mobile half is on its own.

There is no single-mechanism path that covers both mobile and desktop with one updater. The closest thing in production is "Tauri updater for desktop + Shorebird for mobile" — but those are two different products with two different SDKs.

## Recommendation for the AIRIZ owner

Do not pursue a unified updater. The frameworks in 2025–2026 have collectively demonstrated that no such thing exists, and the policy environment (Apple DPLA 3.3.1, Google Play Developer Program Policies) makes it economically infeasible for any framework owner to fund one. Instead, plan for **2–3 update mechanisms**, document the per-mechanism owner, and budget for them.

The two recommended combinations:

- **If desktop is the primary surface:** Tauri updater (Windows/macOS/Linux) + Play Store + App Store + CDN-redeploy for web. Total: 4 mechanisms, but desktop is the only place where AIRIZ ships the binary.
- **If mobile is the primary surface:** Capawesome Live Update (iOS/Android/Electron) + Electron autoUpdater (Win/macOS/Linux) + CDN-redeploy for web. Total: 3 mechanisms, but you commit to Electron as the desktop shell, which is a bigger architectural decision than the update model.

In either case, the **first-party framework story on updates is "punted"** and AIRIZ should plan accordingly.

## Decision matrix for the owner

Use this table to compare the realistic options. "Update complexity" is the count of distinct update pipelines the team owns.

| Option | Desktop updater | Mobile updater | Web updater | Update complexity | Single binary? |
|--------|-----------------|----------------|-------------|-------------------|----------------|
| Tauri everywhere | Tauri plugin | Play + App Store | CDN re-deploy | 3 | No |
| Capacitor + Electron | Electron autoUpdater | Capawesome Live Update | CDN re-deploy | 3 | No (Electron + Capacitor binaries) |
| Capacitor + Tauri hybrid | Tauri plugin | Capawesome Live Update | CDN re-deploy | 3 | No |
| RN + Appcircle CodePush | (no desktop) | Appcircle CodePush | (no web) | 1 (RN bundle) | Yes (RN one bundle) |
| Flutter + Shorebird | Shorebird (Desktop) | Shorebird | (no web) | 1 (Dart kernel) | Yes (one Flutter codebase) |
| MAUI | (no unified) | Play + App Store | (no web) | 4 | No |

The two "single binary" rows are deceptive. They look like 1 mechanism, but they're really 1.5: bundle updates via the OTA tool, native changes via the stores. The team still owns two pipelines; they just don't have to wire up two OTA SDKs.

The "3 mechanism" rows all share the same shape: the desktop half is automated, the mobile half is store-mediated, and the web half is CDN-mediated. The user experience differs: desktop users get "update now" buttons, mobile users get store UI prompts, web users get whatever the browser cache invalidation policy gives them.

The honest answer is: **2–3 mechanisms is the floor, not the ceiling, and there is no framework that has solved this end-to-end.** AIRIZ should budget accordingly.

---

## Appendix: source citations

All sources verified against the live web in late 2025 / early 2026.

**Tauri:**
- Tauri updater plugin README on GitHub: `github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater/README.md` — explicit support matrix with Android and iOS marked ✗.
- Tauri updater docs page: `v2.tauri.app/plugin/updater/` — listing of supported-platforms headers (note: leaves Level column blank, but source README is authoritative).
- Tauri mobile plugin development guide: `v2.tauri.app/develop/plugins/develop-mobile/` — confirms mobile is a first-class target for plugins generally (Kotlin/Swift plugin classes), but not for the updater plugin.
- Tauri distribution docs: `v2.tauri.app/distribute/` — Google Play / App Store / Microsoft Store are the documented mobile distribution paths.

**Flutter / Shorebird:**
- Shorebird homepage: `shorebird.dev/` — pricing, customers, supported platforms (Android, iOS, macOS, Windows, Linux), founding by Eric Seidel, Accel backing.
- Shorebird GitHub: `github.com/shorebirdtech/shorebird` — Apache-2.0 / MIT, 3.0k stars, 2,744 commits, monorepo layout with `shorebird_cli`, `shorebird_code_push_client`, `shorebird_code_push_protocol`.
- Shorebird customers: Scapia, VETC, PushPress, Junglee Games, Couchsurfing, Cloudwalk, Delivery Hero, Kalshi, Solides (logos and quotes on `shorebird.dev/`).

**Capawesome:**
- Live Update plugin page: `capawesome.io/plugins/live-update/` — features, supported platforms (Android, iOS, Electron), Capacitor 6/7/8 compatibility, "1,000+ projects, 20M+ devices" stat.
- Capawesome plugin library: `capawesome.io/plugins/` — 100+ plugins, MIT for core, Insiders program for advanced plugins (Biometrics, OAuth, SQLite, NFC, Bluetooth LE).
- Capawesome Cloud positioning: "Ionic's officially recommended migration partner for Appflow."

**.NET MAUI:**
- Hub page: `learn.microsoft.com/en-us/dotnet/maui/` — Android, iOS, macOS (via Mac Catalyst), Windows, Tizen targets. Monikers net-maui-8.0 through net-maui-11.0.
- Deployment overview: `learn.microsoft.com/en-us/dotnet/maui/deployment/` — packaging docs only, no auto-update section.
- Windows publish doc: `learn.microsoft.com/en-us/dotnet/maui/windows/deployment/overview` — MSIX packaging via `Package.appxmanifest`.

**Uno Platform:**
- Homepage: `platform.uno/` — Windows 10/11, iOS, Android, WebAssembly, Linux, macOS, Windows 7 target matrix. Customer logos: VCA, NetLift, Kahua, CCM, IA, Encore, Trader Zero, NGL, Parkland, Sentry, Cineplex, PJC, Air Canada, MCN, ZIIDMS, Dispatch, Toyota, Brain.

**Kotlin Multiplatform:**
- No first-party updater artifact exists; verified by absence in JetBrains' Kotlin/Compose Multiplatform package repositories.
- Customer case studies at `kotlinlang.org/docs/multiplatform.html` (Philips, Cash App, Forbes, Baidu, Vimeo, Netflix, JetBrains).

**React Native / CodePush:**
- App Center retirement page: `learn.microsoft.com/en-us/appcenter/retirement` — March 31, 2025 retirement, Analytics & Diagnostics extended to March 2027, CodePush handed to community at `github.com/microsoft/code-push-server`.
- Appcircle CodePush: `appcircle.io/codepush/` — features, RN-only positioning as CodePush alternative, "Is CodePush deprecated?" FAQ.
- Codemagic Patch: `patch.codemagic.io/` — self-hosted RN OTA, fingerprinting, binary diffs, CDN delivery, 20-minute install wizard.
- Expo EAS Updates: documented at `docs.expo.dev/eas-update/introduction/` (referenced from Appcircle's FAQ).

**Voltbuilder:**
- Homepage: `volt.build/` — $15/month, Android/iOS web-to-native conversion.
- Docs: `volt.build/docs/all/` — build service only, no OTA. Appflow migration guide explicit.

**Appcircle:**
- Homepage: `appcircle.io/` — customer logos (Coca-Cola, Renault, Panasonic, Proton, Togg, Turkcell, Ziraat Bankası, etc.), 78% decrease in build times, 500+ enterprise clients, ISO 27001 + SOC 2 Type 2.
- CodePush page: `appcircle.io/codepush/` — full feature list, New Architecture support, RBAC, self-hosted.

**Codemagic:**
- Homepage: `codemagic.io/` — Flutter, RN, Native iOS, Native Android, Ionic, Unity, MAUI; 150,000+ developers; SOC 2 Type 2, ISO 27001.
- Patch: `patch.codemagic.io/` — self-hosted RN OTA, fingerprinting, binary diffs, CDN delivery.
- Patch GitHub: `github.com/codemagic-ci-cd/codemagic-patch`.
