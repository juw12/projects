# Cross-Platform Unified Update Model — Survey of Real Apps and Tools

> **Purpose.** AIRIZ Motor Console is designing its own unified release/update
> architecture before another platform surface lands. This document surveys 15
> real cross-platform frameworks, services, and tools to answer one question:
> **who actually solved a unified update model across desktop + mobile + web,
> who punted, and who died?**
>
> **Companion doc.** This is a survey of *external* ecosystems. It is distinct
> from `airiz-release-update-architecture-survey.md`, which is the internal
> decision record for AIRIZ's own five surfaces (Electron Windows desktop,
> Capacitor Android/iOS, Web PWA + Pages, Cloudflare Workers + Durable Objects
> relay) and recommends the thin signed-manifest-on-R2 layer (Option C).
>
> **Date.** 2026-11-04
> **Owner.** Juwen Lie
> **Methodology.** Every claim below is grounded in an official doc, a GitHub
> repo, a vendor announcement, or a product page fetched during this research
> session. Where a claim could not be independently verified, it is flagged.
> The full source list is in the final appendix.

---

## How to read the verdicts

- **Solved** — the framework/tool ships a working, first-party update mechanism
  that covers the surfaces it claims. The caveat (which surfaces it *does not*
  cover) is always stated.
- **Half-solved** — works on some surfaces (usually desktop), punts on others
  (usually mobile, which is gated by the app stores).
- **Punted** — no first-party update mechanism; the developer is told to use the
  app store or a third party. The framework produces a binary and stops there.
- **Died** — a previously working update mechanism was retired or its vendor
  wound down. The date of death is stated.

The single most important finding of the whole survey is in the cross-cutting
section: **the update problem is a distribution-infrastructure problem, not a
framework problem.** Every framework below either solved it in isolation on
desktop or punted everywhere, because the framework's job is to *produce* a
binary, not to *deliver* it.

---

## 1. Tauri (Rust + webview, desktop + mobile)

**Verdict: SOLVED for desktop. PUNTED for mobile.**

Tauri's updater plugin (`tauri-plugin-updater`) is the most complete open-source
desktop update mechanism of any cross-platform framework surveyed. It supports
Windows (NSIS and MSI), Linux (Deb, RPM, AppImage), and macOS, and it enforces
Ed25519 signature verification by design — the public key is embedded in
`tauri.conf.json`, the private key signs every installer artifact, and the
signature check cannot be disabled. The protocol is clean: the app polls a
configured endpoint (or a static JSON file on S3/GitHub), compares versions with
SemVer, downloads the signed bundle, verifies the signature, and installs it.
On Windows the installer exits the app after launching the new version; on
macOS and Linux the app must be relaunched. The plugin has shipped continuously
since Tauri 2.0 (October 2024) and the latest release at survey time is
v2.13.3 (October 10, 2026). Recent work includes `allowDowngrades` becoming a
config-level setting (v2.12.0, September 2026), a Windows `restartAfterInstall`
option (v2.11.0), an AppImage cross-device-link fix (v2.13.x), and
`Updater::restore_update` for cached release metadata.

The updater does **not** work on Android or iOS. The plugin README lists
`Android: x` and `iOS: x` in its support table, and the v2.13.x changelog states
it plainly: "On Android and iOS, `Update::install` now returns
`Error::UnsupportedOs` instead of reporting success without installing
anything." Tauri 2 mobile is real and in active development — the framework
compiles to Android and iOS, plugins can carry native Kotlin and Swift
implementations, and there is a dedicated mobile plugin development guide — but
the updater plugin's Rust core only implements desktop install logic. There is
no path to push an Android APK/AAB or an iOS IPA through the same endpoint.
For mobile, Tauri apps go through Google Play / Apple App Store, the same
constraint every other framework faces.

For a PWA-style web target, Tauri does not apply at all: a PWA is a web app, not
a Tauri binary. If AIRIZ ships a web client beside desktop and mobile, the web
client updates by ordinary web deployment (CDN cache invalidation plus service
worker update), which is a fundamentally different mechanism from binary update.
The learning for AIRIZ is precise: Tauri proves the desktop half of the unified
story can be done well with a signed manifest, but it deliberately stops at the
mobile boundary. Pointing a Tauri updater at a self-hosted manifest endpoint is
the single easiest desktop update an AIRIZ team could adopt.

### Citations

- Tauri Updater plugin docs — https://v2.tauri.app/plugin/updater/ (platform
  table lists windows/linux/macos/android/ios; install notes differ per OS).
- Updater source —
  https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
  (target-selection and version-comparison logic).
- Updater README —
  https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/README.md
  (support table: Linux/Windows/macOS check, Android/iOS cross).
- Updater changelog — https://v2.tauri.app/release/updater/ (v2.0.0 October 2,
  2024 through v2.13.3 October 10, 2026; the `UnsupportedOs` mobile note).
- Mobile plugin development — https://v2.tauri.app/develop/plugins/develop-mobile/
  (Kotlin/Swift plugin implementation; confirms mobile is real but the updater
  is not among the plugins with a mobile implementation).

---

## 2. Flutter (Dart, all platforms)

**Verdict: PUNTED.**

Flutter has no first-party auto-update mechanism. Google's position is that app
distribution belongs to the app stores (Google Play, Apple App Store, Microsoft
Store) and the desktop package managers (Snap, Flatpak, winget). The Flutter SDK
exposes no update API, ships no update plugin, and its deployment documentation
has no auto-update section. Community packages such as `flutter_downloader` and
`flutter_cached_network_image` download individual files, but none of them
implements an application-level update protocol: check version, verify
signature, download binary, replace, relaunch.

The closest community answer is the `app_updater` package (v2.1.0, published
roughly eight months before this survey, ~28 likes, ~245 weekly downloads). It
supports iOS, Android, macOS, Windows, and Linux, and it is feature-rich:
platform-native dialogs (Cupertino, Material 3, Fluent, Adwaita), release-notes
fetching, GitHub Releases as a version source, Firebase Remote Config, TestFlight
support, update urgency levels, skip-version and do-not-ask-again preferences,
and analytics callbacks. But its actual mechanism is **store-redirect**: it
queries the App Store / Play Store / Mac App Store / Microsoft Store / Snap /
Flathub (or a custom XML/JSON endpoint or GitHub Releases) for a newer version,
shows a native dialog, and opens the store URL. It does not download and install
the update itself. A Flutter desktop app that wants a true Sparkle-style
download-and-replace on macOS must hand-roll a platform channel into the Sparkle
framework; a Windows app must bridge to WinSparkle. Those bridges are not
maintained by the Flutter team and no unified abstraction exists over them.

The consequence for AIRIZ is the same as for any mobile-first framework: a
Flutter app cannot bypass app-store review on mobile, and on desktop it depends
on whichever package manager the user installed it with. There is no signed
binary download-and-replace flow out of the box. Flutter is a strong UI
framework with a large production footprint (Google Pay, BMW, Alibaba Xianyu
among others), and none of those apps publicly documents a custom unified update
mechanism — they all ride the stores. Framework choice, again, does not buy the
update architecture; it must be built or bought separately.

### Citations

- `app_updater` package — https://pub.dev/packages/app_updater (v2.1.0; 5
  platform targets; store-redirect + custom endpoint + GitHub Releases).
- `app_updater` repository — https://github.com/mantreshkhurana/app_updater.
- Flutter deployment docs — https://docs.flutter.dev/deployment (per-platform
  store publishing; no auto-update section — the absence is the finding).

---

## 3. .NET MAUI (Microsoft, C#)

**Verdict: HALF-SOLVED (desktop yes via MSIX, mobile no).**

.NET MAUI's deployment model is platform-specific and documented per platform in
Microsoft's official docs (last updated April 2026, covering .NET MAUI 8 through
11). On Windows, a MAUI app can be packaged as MSIX, which supports both
Microsoft Store distribution and sideloading via App Installer. MSIX brings the
benefits of the Windows package system: virtualization, atomic installs, and
automatic update checking through the Windows Package Manager. On macOS (via Mac
Catalyst), MAUI produces an `.app` or `.pkg`; distribution requires Apple
notarization, and updates go through the Mac App Store or manual re-download. On
Android it produces an APK or AAB for Google Play; on iOS an `.ipa` for the App
Store.

The critical gap is that there is no unified update abstraction. Microsoft's
documentation treats each platform's deployment as an independent concern. The
Windows MSIX update flow is owned by the OS; the mobile flows are owned by the
stores. A MAUI developer who wants OTA updates on mobile must integrate a
third-party service (Capawesome, EAS Update, and the like) as a separate layer
from the desktop flow. There is no `MauiApp.Updates` API or equivalent, and the
deployment docs contain no update-framework section. The framework is positioned
more toward enterprise and internal use, where MDM-managed distribution is an
acceptable answer to "how do users get updates."

For AIRIZ the implication is concrete: if the Motor Console used .NET MAUI, the
Windows desktop update story would be genuinely good (MSIX + App Installer),
but the mobile story would be "go to the store," and there would be nothing tying
the two together. The only route to a unified experience is a custom
manifest-checking layer that works across all platforms — exactly the
signed-manifest-on-R2 pattern in section 15. .NET MAUI is a cautionary example of
a first-class framework that invests heavily in per-platform packaging and
deliberately leaves cross-platform update orchestration to the developer.

### Citations

- .NET MAUI deployment index — https://learn.microsoft.com/en-us/dotnet/maui/deployment/
  (updated 2026-04-16, monikers net-maui-8.0 through net-maui-11.0; per-platform
  deployment: Android APK/AAB, iOS .ipa, Mac Catalyst .app/.pkg, Windows MSIX).
- Windows deployment overview —
  https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/overview
  (MSIX packaging, virtualization, and update benefits).
- No consumer reference app publicly documents a unified cross-platform update
  story for MAUI; the framework's own docs route every surface to a different
  store or package system.

---

## 4. Uno Platform (C#/XAML, native rendering)

**Verdict: PUNTED.**

Uno Platform (https://github.com/unoplatform/uno, ~10.1k stars, 200M+ NuGet
downloads, 52k+ commits) is a mature framework for building native Mobile, Web,
Desktop, and Embedded apps from a single C#/XAML codebase using the WinUI 3 API
surface. It targets Windows, macOS, Linux, iOS, Android, and WebAssembly, and it
renders on desktop through Skia (a Win32 shell on Windows, an AppKit/Metal shell
on macOS, X11 or Framebuffer on Linux) with optional native-control rendering on
mobile. It is backed by enterprise clients including Toyota, Microsoft, and Kahua.

Uno ships **no unified updater**. Its architecture means each platform head emits
a native package — a `.msix` for Windows, an `.app`/`.pkg` for macOS, an
`.apk`/`.aab` for Android, an `.ipa` for iOS, a WASM bundle for web — and each of
those inherits its platform's native update mechanism. There is no `Uno.Updates`
API, no update plugin, and no OTA service in the Uno ecosystem. A review of the
1.7k open issues and 400 open PRs surfaces no updater feature of note. This is a
deliberate scoping choice: Uno's value proposition is UI parity and rendering
consistency, not distribution infrastructure. Update delivery is intentionally
left to the developer and their CI/CD pipeline.

The Toyota/Microsoft/Kahua data point matters for AIRIZ: a framework trusted for
mission-critical enterprise applications still leaves update distribution outside
the framework. That strongly implies enterprise update delivery is handled by
external infrastructure (MDM, internal artifact repositories, or a custom signed
manifest), not by the UI toolkit. For the Motor Console, Uno — like Flutter and
MAUI — does not change the update calculus. The choice of rendering framework is
orthogonal to the choice of update mechanism.

### Citations

- Uno Platform repository — https://github.com/unoplatform/uno (10.1k stars,
  52,119 commits, 919 forks, Apache-2.0; README names Toyota, Microsoft, Kahua
  as enterprise clients; lists supported platforms with no update mechanism).
- Uno Platform site/docs — https://platform.uno/ (rendering, controls, theming,
  state management, platform-specific features; no distribution/update section).
- The 1.7k open issues / 400 open PRs contain no first-party updater request of
  consequence (checked at survey time).

---

## 5. Kotlin Multiplatform + Compose Multiplatform (JetBrains)

**Verdict: PUNTED.**

Kotlin Multiplatform is a language-level technology that compiles shared Kotlin
code to platform targets (JVM, Native, JavaScript, WASM); it has no concept of an
"app" and therefore no concept of "updating an app." Compose Multiplatform (CMP)
layers a shared UI on top, with Android, iOS, and Desktop (Windows/macOS/Linux)
all Stable for production, and Web in Beta. The production footprint is the
largest of any "shared code" framework in this survey: Feres (1M+ downloads,
taxi), Markaz (5M+ downloads, e-commerce, 100+ screens), Instabox (340K+ installs,
parcel delivery), Pocket Bard (750K+ downloads, RPG companion), Fabuly (350K+
downloads, audiobooks), Physics Wallah (17M active users, education), Wrike
(project management), Bilibili, Sony, Booking.com, Alipay, and Tencent Video.

None of these apps use a unified update mechanism supplied by KMP or CMP. The
update story is entirely platform-native: Android through Google Play, iOS
through the App Store, desktop through whatever the developer implements (there
is no CMP first-party updater), and web through normal web deployment. JetBrains
has not announced any cross-platform update framework, and the Compose
Multiplatform documentation focuses exclusively on UI development with no
distribution or update guidance. The framework's job, by design, ends at the
compiled artifact.

This is the strongest evidence in the survey that the unified update problem is
not a framework problem. The most production-proven shared-code ecosystem — apps
in the 5M+ download and 17M-user range — still leaves update delivery to the
stores and to bespoke infrastructure. For AIRIZ, the choice among KMP/CMP,
Flutter, Tauri, and .NET MAUI does not meaningfully move the update
architecture; the update layer must be designed and owned independently of the UI
framework, which is precisely what the companion internal survey concludes.

### Citations

- Compose Multiplatform official page — https://www.jetbrains.com/compose-multiplatform/
  (v2.4.21; Android/iOS/Desktop Stable, Web Beta; production app list and
  quotes; no update mechanism).
- Markaz — 5M+ downloads, 100+ screens fully in CMP, under 10MB on Android /
  137MB on iOS, distributed via Google Play and the App Store; no public custom
  update mechanism (cited on the official page).
- Wrike — Calendars, Boards, Dashboards, Charts, Timesheet Approvals in CMP in
  production since beta; "delivering consistent, high-quality experiences across
  platforms" — Alex Askerov, Mobile Tech Lead (quoted on the official page).

---

## 6. React Native — the post-CodePush landscape

**Verdict: DIED (CodePush, March 31, 2025). ECOSYSTEM SCATTERED.**

This is the most dramatic case in the survey. Microsoft's App Center CodePush —
the dominant over-the-air JavaScript update service for React Native from 2016
to 2025 — was retired on **March 31, 2025**. The hosted service shut down, and on
**May 20, 2025** Microsoft archived both the `react-native-code-push` client SDK
and the standalone `code-push-server` on GitHub; both repositories are now
read-only. The SDK's README states it will not support React Native's New
Architecture, which is the default from React Native 0.76 onward. There is no
official Microsoft replacement, and — to correct two errors that circulate in
other write-ups — there is no "Sentry CodePush" and there is no Microsoft-hosted
standalone CodePush (Microsoft released the server source for self-hosting and
then archived it, "as is," with no support).

The migration landscape that emerged is fragmented. The mainstream path is **Expo
EAS Update**, built on the open-source `expo-updates` library plus the hosted EAS
Update service. It uses a different model from CodePush: instead of
client-controlled deployment keys, it maps server-side *channels* to *branches*,
and a `runtimeVersion` field replaces CodePush's target-binary-version gate.
Pricing is by monthly active users of updates: Free (1,000 MAUs), Starter ($19/mo,
3,000 MAUs included), Production ($199/mo, 50,000 MAUs included). The other
options are self-hosted CodePush (archived, unsupported), and a scatter of
commercial and open-source drop-ins: CodeOnAir, Revopush, Stallion, Hot Updater
(open-source), Bundle Drop, AppZung, and Codemagic CodePush. The community is now
forced to choose among these, and there is no single dominant winner the way
CodePush once was.

The lesson for AIRIZ is the starkest in the whole survey: **a unified update
service can die.** CodePush was the category leader for a decade, backed by
Microsoft, and it disappeared with roughly two months of notice, orphaning every
app that depended on it. Any AIRIZ update architecture that hinges on a single
third-party OTA service carries that same existential risk — and the Appflow EOL
in section 13 shows the same pattern repeating one year later. The safe design is
an update protocol simple enough to self-host (a signed JSON manifest plus a
binary download) riding on commodity delivery infrastructure (CDN, object
storage). That is exactly the Cloudflare Pages + R2 + Workers pattern in section
15, and it is the same thin-manifest conclusion the internal AIRIZ survey
reaches.

### Citations

- Expo "Migrate from CodePush" guide — https://docs.expo.dev/eas-update/codepush/
  (uninstall `react-native-code-push`, add `expo-updates`, resubmit to stores;
  documents channels vs. deployments and runtime-version vs. target-binary).
- Expo blog "What to do without CodePush" — https://expo.dev/blog/what-to-do-without-codepush
  (March 31, 2025 shutdown; four options: stop OTA, self-host CodePush, self-host
  expo-updates, or use EAS Update).
- CodeOnAir "CodePush alternatives 2026" — https://codeonair.com/blog/codepush-alternatives-2026
  (October 25, 2026; "There is no official replacement... Microsoft published a
  standalone CodePush server and then archived it, with no support.").
- Appisto "CodePush alternatives for React Native in 2026" —
  https://appisto.app/blog/codepush-alternatives-react-native (August 25, 2026;
  confirms March 31, 2025 retirement and May 20, 2025 archival; corrects the
  Sentry / hosted-standalone misconceptions).
- Revopush alternatives table — https://revopush.org/react-native-codepush-alternative
  (managed vs. self-hosted vs. Expo-native options, first-release diff handling).

---

## 7. Capawesome (Capacitor ecosystem — Cloud + SDKs)

**Verdict: SOLVED for Capacitor/Ionic/Cordova mobile OTA. NOT for desktop or web.**

Capawesome (https://capawesome.io/, Genz IT Solutions GmbH, Germany) has
positioned itself as the mobile DevOps platform for the Capacitor/Ionic/Cordova
ecosystem. Two product lines: **Capawesome Cloud** (CI/CD + OTA Live Updates +
automated App Store publishing, $19-$499/month, 14-day trial) and **Capawesome
SDKs** (~150 open-source and enterprise mobile plugins, 5M+ downloads/month).
The Cloud platform builds iOS on Apple Silicon M4 Pro hardware, manages signing
and provisioning, and auto-submits to TestFlight and Google Play. It reports
3,000+ customers, ISO 27001 and SOC 2 Type II, and a CLI (`@capawesome/cli`) with
40+ commands including `apps:liveupdates:create` and `apps:liveupdates:rollback`.

The Live Update product is the relevant feature for an update story: it delivers
OTA web-asset updates to Capacitor, Ionic, and Cordova apps without app-store
review, with gradual rollouts, rollbacks, and code signing. The homepage at
survey time showed Live Update v4.2.1 serving ~4.48M devices. But the scope is
narrow and explicit: the FAQ states "Native Android and iOS support every cloud
feature except Live Updates." Live Update only works for web-technology wrapper
apps. There is no desktop update story, no web update story, and no Electron or
Tauri support. For a motor-control console that needs native hardware access,
Capawesome solves the mobile-OTA slice of a Capacitor app and nothing else.

The strategic signal here is the **Ionic partnership**: in September 2026
Capawesome announced it is the officially recommended migration destination for
Appflow and the Ionic Enterprise SDKs, and it markets itself as "the recommended
way off Appflow." Combined with the customer testimonials (King Arthur Baking,
snapAddy at 200,000+ daily live-updated devices, Summon Worlds migrating off
Capgo), the picture is of a consolidating, viable survivor in the mobile-OTA
market — but a specialist, not a unified cross-surface solution. AIRIZ could use
it for a Capacitor mobile target and still have to solve desktop and web
independently.

### Citations

- Capawesome homepage — https://capawesome.io/ (Live Update v4.2.1, ~4.48M
  devices; Ionic partnership banner; pricing $19/$49/$149/$499 in structured
  data; "Native Android and iOS support every cloud feature except Live
  Updates").
- King Arthur Baking testimonial — "Capawesome's live updates have been a game
  changer for our mobile recipe app... without app store delays" — Jordan Kilby,
  Digital Marketing Leader (homepage, 2026).
- snapAddy testimonial — "reduce our live update costs by more than 90%... daily
  live updates to more than 200,000 devices" — Michael Wolz, Head of Development
  (homepage, dated 2025-08-26).
- Ionic partnership — https://capawesome.io/blog/announcing-partnership-with-ionic/
  (September 21, 2026).

---

## 8. Voltbuilder (hosted Cordova / PWA builder)

**Verdict: DIED / NEGLIGIBLE.**

Voltbuilder (volt.build) was a hosted service that took a Cordova or PWA project
and built, hosted, and distributed it as a native mobile app. The native shell
was thin, so the "update" was really a web-asset update: the wrapper checked a
manifest URL, downloaded updated web assets when the version changed, and
reloaded the WebView. Native-code changes still required a new store build.

The service has effectively disappeared. The volt.build domain does not resolve
to an active product as of this survey, and there is no public migration path or
archived case-study trail. The plugins that would underpin such a workflow
(`cordova-plugin-app-update`, `cordova-plugin-code-push`) are both unmaintained,
and the CodePush one is archived (section 6). The hosted-Cordova-builder niche
Voltbuilder occupied has been absorbed by Capawesome Cloud and, before its EOL,
Ionic Appflow. No production app publicly cites Voltbuilder as its update
mechanism at survey time.

The narrow lesson for AIRIZ: **hosted thin-wrapper builders are a dead end** for
anything more complex than a 90%-web app. They collapse the moment the app needs
native features, offline-first data, or hardware access — all of which a motor
console requires. The update mechanism is only as capable as the web content it
wraps, and the native shell itself still needs store updates. This is a caution
against reaching for a hosted "wrapper" product as the unified update answer.

### Citations

- volt.build — does not resolve to an active product at survey time; no archived
  documentation or customer case studies accessible (flagged as unverified /
  defunct).
- `cordova-plugin-app-update` and `cordova-plugin-code-push` — unmaintained /
  archived on npm and GitHub; the broader Cordova plugin ecosystem has declined
  since Capacitor's rise.
- Market context — Capawesome's homepage ("From commit to App Store in minutes")
  and Appflow's pre-EOL positioning show the hosted-mobile-build niche being
  absorbed into the Capawesome/Appflow/EAS ecosystem.

---

## 9. Appcircle (mobile CI/CD)

**Verdict: PUNTED (CI/CD only, no first-party update mechanism).**

Appcircle (appcircle.io) is a mobile CI/CD platform that builds, tests, and
distributes mobile apps. It supports iOS, Android, and cross-platform frameworks
(Flutter, React Native, Ionic, Xamarin/MAUI). It produces build artifacts (IPA,
APK, AAB) and can hand them to testers via QR code, a link, or internal
TestFlight / Play Store tracks.

Appcircle provides no first-party auto-update or OTA mechanism. Its role in the
update pipeline is upstream of delivery: it builds and signs the binary that gets
submitted to a store. The actual update to end users is handled by the store or a
third-party OTA service. The product documentation has no in-app update feature,
no manifest checking, and no OTA delivery. It competes with Codemagic, Bitrise,
and Fastlane in the CI/CD category — not in the update-delivery category.

For AIRIZ, Appcircle is a candidate build pipeline, not an update solution. It
would sit in the pipeline that produces signed binaries, but the update protocol
(manifest schema, versioning, delivery, rollback) would have to be implemented
elsewhere. This is the identical position of every CI/CD tool in this survey:
they produce artifacts; they do not deliver updates. The choice among CI/CD
vendors is a build-infrastructure decision, fully independent of the update
architecture.

### Citations

- Appcircle — https://appcircle.io/ (mobile CI/CD; iOS, Android, Flutter, React
  Native, Ionic; no update/OTA features in product documentation).
- Category position — Appcircle competes with Codemagic, Bitrise, and Fastlane;
  none of the four provides first-party update delivery (consistent across the
  category, verified at survey time).

---

## 10. Codemagic (CI/CD, Flutter-friendly)

**Verdict: PUNTED (CI/CD only; carried a now-dead CodePush integration).**

Codemagic (codemagic.io) is a CI/CD platform with strong Flutter integration. It
uses YAML-based workflows, handles the CocoaPods/Gradle build steps, manages
signing certificates, and can deploy directly to TestFlight and Google Play. For
a Flutter app it is a turnkey build-and-submit pipeline.

Codemagic is worth a special mention in this survey because it integrated
**CodePush** as a built-in step before CodePush's sunset. It appears in the
post-CodePush alternatives landscape as "Codemagic CodePush — Managed OTA inside
a CI/CD platform — Original CodePush SDK compatibility." With CodePush retired in
March 2025 and the client SDK archived in May 2025 (section 6), that integration
is no longer a viable path, and Codemagic has not shipped a replacement OTA
service. The platform otherwise does not implement any update protocol.

The takeaway is the same as for Appcircle and Bitrise: Codemagic is a build
pipeline. If the Motor Console used Flutter, Codemagic could be the build leg,
but the update architecture would still be designed independently. A dead built-in
integration (CodePush) is itself a useful warning: baking a third-party OTA
dependency into a CI pipeline inherits that dependency's mortality.

### Citations

- Codemagic — https://codemagic.io/ (Flutter-focused YAML workflows, signed
  builds, TestFlight/Play Store deployment; no first-party update mechanism).
- Codemagic in the CodePush-alternatives table —
  https://revopush.org/react-native-codepush-alternative ("Codemagic CodePush —
  Managed OTA inside a CI/CD platform — Original CodePush SDK compatibility"),
  now moot after CodePush's retirement.

---

## 11. Bitrise (mobile CI/CD)

**Verdict: PUNTED (CI/CD only, no first-party update mechanism).**

Bitrise (bitrise.io) is one of the largest mobile CI/CD platforms, with a visual
workflow builder and a step library that includes Fastlane integration, code
signing, and app-store deployment. It supports iOS, Android, React Native,
Flutter, and other cross-platform frameworks, and it sells managed build
infrastructure (Apple Silicon Macs for iOS, Android emulators, automated store
submission).

Bitrise provides no first-party update or OTA mechanism. Its step library covers
building, signing, testing, and deploying to stores, but nothing for in-app update
checking or OTA delivery. Its relationship to the update problem is identical to
every other CI/CD tool: it produces the artifact and hands it to the store; it
does not deliver the update to the device. The presence of Fastlane steps (gym,
pilot, supply) confirms that "the update story" from Bitrise's perspective is
"submit a new build to the store," not "push an update to the user."

For AIRIZ, Bitrise is a viable build-pipeline option that contributes nothing to
the update architecture. Choosing Bitrise over Codemagic or Appcircle changes the
build experience, not the update design.

### Citations

- Bitrise — https://www.bitrise.io/ (visual workflows, step library, managed
  Apple Silicon infrastructure; no update/OTA features).
- Fastlane step integration — Bitrise wraps the same Fastlane actions described in
  section 12; the update path is "use Fastlane to submit to the store," not "push
  an update to the user."

---

## 12. Fastlane (Ruby mobile automation)

**Verdict: PUNTED (automation scripts for store submission, not an update mechanism).**

Fastlane (fastlane.tools) is a Ruby automation framework for mobile deployment.
Its core actions are: `gym` (build IPA/APK), `pilot` (upload to TestFlight),
`match` (manage certificates and provisioning profiles), `deliver` (update App
Store metadata), `supply` (manage Google Play listings), `pem` (manage push
certificates), and `screengrab` (capture screenshots). Fastlane is the underlying
automation layer for most of the CI/CD platforms above — Bitrise, Codemagic, and
others wrap Fastlane steps rather than reimplementing them.

Fastlane is not an update mechanism. It automates getting a binary *to* the app
store; it implements no in-app update checking, no manifest fetching, and no OTA
delivery. There is no `fastlane update` action that pushes an update to a device.
The `fastlane-plugin-app_store_build_automation` plugin automates App Store build
submission, which reinforces rather than changes this positioning: it is about
the submission leg, not the delivery leg.

For AIRIZ, Fastlane is a build-and-submit tool — the scripting backbone of the
release pipeline that produces and submits signed binaries. The update protocol
is designed separately. Whether AIRIZ invokes Fastlane directly or through a
CI/CD wrapper, its role in the update story is the same: get the artifact to the
store, then stop.

### Citations

- Fastlane — https://fastlane.tools/ (gym, pilot, match, deliver, supply, pem,
  screengrab; no update/OTA actions).
- Fastlane as the automation layer under Bitrise / Codemagic / Appcircle —
  consistent across the CI/CD category; its role is "automate store submission,"
  not "deliver the update."

---

## 13. Ionic Appflow (Live Update + CI/CD)

**Verdict: DIED (EOL announced February 11, 2025; access through December 31, 2027).**

The second major death in this survey, and more recent than CodePush. On
**February 11, 2025** Ionic published "Important Announcement: The Future of
Ionic's Commercial Products." The substance: all Ionic commercial products —
Appflow, Identity Vault, Portals, and every paid component — were discontinued
for *new* customers. Existing Appflow customers keep access through **December
31, 2027**, a multi-year wind-down. Enterprise customers were offered a
self-service maintenance option for commercially licensed software. The open-source
half — Ionic Framework and Capacitor — continues, maintained as part of
OutSystems' mobile stack (Ionic joined OutSystems in October 2022). Ionic
officially recommends **Capawesome** as its preferred migration partner for
Appflow, Auth Connect, Identity Vault, and Secure Storage.

Appflow's Live Update was a direct CodePush competitor: it delivered web-asset
updates to Capacitor/Ionic/Cordova apps without store review, with gradual
rollouts, rollbacks, and A/B testing, alongside native builds, app-store
publishing, automations, web previews, and a Cloud CLI. The Appflow landing page
displayed NASA, IBM, Burger King, CAT, and Target as customers. But the entire
commercial platform is being wound down, and the Live Update service will cease to
exist by the end of 2027. The Appflow page still carries the EOL banner at survey
time.

The lesson reinforces CodePush: **commercial OTA services for web-wrapper mobile
apps are a consolidating, mortal category.** Two of the three marquee services in
this survey are dead or dying (CodePush 2025, Appflow 2027), and the survivors
(EAS Update, Capawesome) serve only web-wrapper mobile apps and do not touch
desktop or native mobile. Building your own update layer — even a minimal signed
manifest — removes you from this category of vendor risk entirely, which is the
same conclusion the internal AIRIZ survey draws.

### Citations

- Ionic EOL announcement — https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products
  (February 11, 2025; "discontinued new customer sales for all Ionic commercial
  products... Appflow users: You'll continue to have access through December 31,
  2027").
- Appflow landing page — https://ionic.io/appflow (EOL banner; Live Updates,
  Native Builds, App Store Publishing, Automations, Web Previews, Cloud CLI;
  trusted by NASA, IBM, Burger King, CAT, Target).
- Capawesome-Ionic partnership — https://capawesome.io/blog/announcing-partnership-with-ionic/
  (September 21, 2026; "the recommended way off Appflow and the Ionic Enterprise
  SDKs"; FAQ: "Ionic Appflow is discontinued, end of life December 31, 2027").

---

## 14. PWABuilder (Microsoft)

**Verdict: SOLVED for Windows (MSIX from a PWA). PUNTED for everything else.**

PWABuilder (https://github.com/pwa-builder/PWABuilder, ~3.8k stars, ~5,978
commits, MIT) is a Microsoft open-source tool that generates installable app
packages from a Progressive Web App. Its primary output is a **Windows MSIX**,
which can ship through the Microsoft Store or be sideloaded via App Installer.
It also generates packages for Google Play (Android) and Meta Quest (VR), though
those are secondary. The toolset spans PWABuilder.com (the web UI), PWA Studio
(a VS Code extension), and the PWA Starter template, and it is deployed on Azure
with full CI/CD and PR-deployment-slot workflows.

The update story for a PWABuilder-generated Windows app is the standard MSIX flow:
the Windows Package Manager checks for updates automatically, or App Installer
polls a manifest URL. That is a real, working, OS-level update mechanism — but it
is Windows-only. The Android and Quest packages follow their respective store
update flows, and a PWA running in a plain browser on any platform updates by
normal web cache invalidation plus service-worker update. There is no
cross-platform update abstraction; the tool's scope is explicitly "package a PWA
for a store," not "build a unified cross-surface update mechanism."

For AIRIZ, PWABuilder is relevant only if a Motor Console surface could be
expressed as a PWA and targeted at Windows — unlikely for a motor-control app
that needs serial/USB and hardware access. Its value here is as a reference: it
shows a credible open-source path from web to a *signable, auto-updating Windows
package*, which is the one desktop surface where a PWA-based update story is
genuinely workable. It does not unify the other surfaces.

### Citations

- PWABuilder repository — https://github.com/pwa-builder/PWABuilder (3.8k stars,
  416 forks, 5,978 commits, MIT; tools: PWABuilder.com, PWA Studio, PWA Starter;
  topics include microsoft-store, play-store, meta-quest).
- PWABuilder docs — https://docs.pwabuilder.com/ (PWA packaging for Windows MSIX,
  Android Play Store, Meta Quest; the Windows MSIX flow includes App Installer
  auto-update).
- PWABuilder.com — https://pwabuilder.com/ (web UI; enter a PWA URL, get a
  packaged app per store).

---

## 15. Cloudflare Pages + R2 + Workers (the self-hosted pattern)

**Verdict: SOLVED (if you build it). THE PATTERN AIRIZ SHOULD ADOPT.**

This is not a product; it is an architecture pattern, and it is the only entry in
the survey that actually delivers a *unified* update model across desktop, mobile,
and web. The shape: use **Cloudflare Pages** to host the update manifest (a small
JSON document) and the web surface, **Cloudflare R2** (S3-compatible object
storage with *zero egress fees*) to store the update binaries, and **Cloudflare
Workers** (serverless JS/TS/Rust/Python) to implement the manifest API. The client
app — regardless of framework — polls the Worker, receives a signed JSON manifest,
verifies the signature, downloads the binary from R2, and installs it through its
platform-native apply path.

The protocol is deliberately trivial, which is the point:

1. Client sends `GET /api/update?platform=windows&arch=x86_64&version=1.2.3`.
2. Worker looks up the latest version for that platform/arch, compares it to the
   client's version, and returns `204 No Content` (no update) or `200 OK` with
   `{ version, url, signature, notes, pub_date }`.
3. Client verifies the Ed25519 signature against the public key embedded in the
   app (the same scheme Tauri uses — section 1).
4. Client downloads the binary from the R2 URL (CDN-accelerated, zero egress).
5. Client installs: NSIS/MSI on Windows, Sparkle on macOS, file replacement or
   the distro package manager on Linux, a store submission (native) plus a
   web-asset swap (hotfix) on mobile.

The decisive advantage over every product in sections 1-14 is that **you own the
protocol.** No vendor can sunset it (unlike CodePush and Appflow). No vendor can
move the pricing model (unlike EAS Update's MAU billing or Capawesome's tiers). No
vendor can introduce a dependency you did not choose. The infrastructure
(Cloudflare) is commodity and multi-year stable, the manifest format is trivial,
and the signing scheme (Ed25519) is well understood. Because the same Worker
endpoint can serve a Tauri desktop app, a Flutter or MAUI or Capacitor mobile app,
and a web/PWA surface, this is the only entry that genuinely unifies all three.

The cost is engineering effort and operational ownership. You implement
client-side apply logic per platform (or point a framework's existing updater —
e.g. Tauri's, which natively supports custom endpoints — at your manifest), you
manage the Ed25519 private key (loss of the key means you can never ship an
update again — the single largest operational risk), and you build rollback
(serve the previous manifest) and staged rollout (Worker logic gating by
user/region/percentage) yourself. But the total complexity is far below adopting
and depending on a third-party OTA service, and the long-term risk is far lower.
The Tauri updater is, in effect, this exact pattern already implemented for
desktop: same manifest fields, same Ed25519 signing, same endpoint polling. AIRIZ
can reuse it for desktop and implement the same protocol natively for mobile, all
served from one Cloudflare Worker — which is precisely the "thin signed-manifest
layer" (Option C) the internal AIRIZ survey recommends.

### Citations

- Cloudflare Pages — https://pages.cloudflare.com/ (static hosting + Functions;
  global CDN; free tier; suitable for the manifest and web surface).
- Cloudflare R2 — https://www.cloudflare.com/products/r2/ (S3-compatible object
  storage, **zero egress fees** — the key differentiator vs. S3/GCS for shipping
  update binaries; e.g. a 100MB binary to 10,000 users costs ~$0 egress on R2
  vs. ~$9 on S3).
- Cloudflare Workers — https://workers.cloudflare.com/ (serverless compute for the
  manifest API, version comparison, staged rollout, A/B; free tier 100k
  requests/day).
- Tauri updater as reference implementation — https://v2.tauri.app/plugin/updater/
  (the manifest format, Ed25519 signing, and endpoint polling are this pattern
  already built for desktop; it natively accepts a custom endpoint).

---

## Cross-Cutting Findings

### F1. The update problem is not a framework problem.

Every framework surveyed — Tauri, Flutter, .NET MAUI, Uno, KMP/CMP — either
solved the desktop update problem in isolation (Tauri) or punted everywhere.
None solved the unified desktop + mobile + web problem. This is because updating
is a **distribution-infrastructure** concern, not a UI concern: the framework
produces a binary, and something else must deliver it. Those are orthogonal jobs,
and no UI framework in this survey owns the second one.

### F2. First-party OTA services are a dying, consolidating category.

Two of the three marquee OTA services are dead or dying: CodePush (dead 2025-03-31,
archived 2025-05-20) and Ionic Appflow (EOL 2027-12-31). The survivors (EAS Update,
Capawesome Cloud) only cover web-wrapper mobile apps (React Native, Capacitor/
Ionic/Cordova) and do not touch desktop or native mobile. The market is
consolidating around "use the app store" or "build your own," with Capawesome
actively absorbing Appflow's customer base via the Ionic partnership.

### F3. The app-store moat is real and unbreakable for native binaries.

No technology in this survey can bypass the Apple App Store or Google Play for a
*native binary* update. OTA web-asset updates can bypass the stores, but only for
web-wrapper apps. New native code, new permissions, and new native modules all
require a store resubmission. This is a platform constraint, not a technology gap.
AIRIZ must accept a store-latency component on mobile and design the update UX
around it ("update available in the App Store" vs. "updating now...").

### F4. The desktop story is the easy half, and it is already solved.

Windows (MSIX + App Installer), macOS (Sparkle / notarized `.app`), and Linux
(AppImage / `.deb` / `.rpm`) all have mature, well-understood update mechanisms,
and Tauri's updater is the best open-source implementation. A signed-manifest
endpoint (the Cloudflare pattern) can serve desktop updates with minimal effort.
The desktop problem is solved; the mobile problem is the hard one, and it is gated
by the stores.

### F5. Vendor mortality is the dominant long-term risk.

CodePush and Appflow both had large, trusted user bases and both died within a
two-year window, with only a few months to two years of notice. Any AIRIZ
architecture that depends on a single third-party OTA service inherits that
mortality. The mitigation is structural: own a trivial, self-hostable protocol on
commodity infrastructure, and treat any third-party service as an optional
accelerator — never a dependency.

### F6. Framework choice does not buy the update architecture.

Across a 1M+-download taxi app (KMP/CMP), a 5M+-download e-commerce app (CMP), a
17M-user education platform (CMP), and the Flutter/MAUI/Uno estates, the update
mechanism is consistently external to the UI framework. AIRIZ's decision among
Tauri / Flutter / MAUI / Uno / KMP-CMP should be made on UI, performance, and
hardware-access grounds; the update layer is a separate, framework-agnostic
decision.

---

## What AIRIZ Motor Console should do (derived from the survey)

Based on the evidence above, the recommended update architecture is a
framework-agnostic signed-manifest layer, with each surface keeping its native
apply path. This matches Option C in the internal survey
(`airiz-release-update-architecture-survey.md`).

1. **Desktop (Windows / macOS / Linux).** Serve a signed manifest from a Cloudflare
   Worker; store binaries in R2. On Windows use MSIX + App Installer (the same
   mechanism PWABuilder and .NET MAUI rely on). On macOS use Sparkle (notarized).
   If a Tauri surface exists, point its built-in updater — which natively accepts
   a custom endpoint — at the same manifest, so desktop is solved with zero
   custom client code.

2. **Mobile (iOS / Android).** Accept store latency for native binaries
   (Play Store / App Store; use EAS Update or Capawesome *only* for web-asset
   hotfixes if a surface is a web wrapper). Do not build the core update path on
   a third-party OTA service given the F2/F5 mortality evidence.

3. **Web / PWA.** Ordinary web deployment: CDN cache invalidation plus a service
   worker update. No bespoke update mechanism needed.

4. **One unified manifest.** A single Worker endpoint serves every surface. The
   manifest carries platform, architecture, version, download URL, Ed25519
   signature, release notes, and publication date. The Worker implements version
   comparison, staged rollout, and rollback (serve the previous manifest).

5. **Key management is the critical control.** The Ed25519 private key must live
   in a KMS/HSM with strict access control. Loss of the key is a permanent
   inability to ship updates — the single largest operational risk in the whole
   design. Treat it like a root CA key.

In one line: **write one signed manifest, have one release-side writer, and teach
every surface to read it while keeping its own native install path.** That collapses
N independent update workflows into one, and it is the only pattern in this survey
that actually unifies desktop + mobile + web without depending on a mortal vendor.

---

## Appendix A — Verdict summary table

| # | Technology | Verdict | Desktop | Mobile | Web |
|---|-----------|---------|---------|--------|-----|
| 1 | Tauri | Solved (desktop) / Punted (mobile) | Yes — Ed25519 updater | No — `UnsupportedOs` | n/a |
| 2 | Flutter | Punted | No — store-redirect only | No — store only | n/a |
| 3 | .NET MAUI | Half-solved | Yes — MSIX (Windows) | No — store only | n/a |
| 4 | Uno Platform | Punted | No — native per-platform | No — store only | No — WASM deploy |
| 5 | KMP / Compose MP | Punted | No — no updater | No — store only | Beta (web target) |
| 6 | React Native (post-CodePush) | Died (CodePush) / scattered | n/a | EAS Update / Capawesome (web-asset only) | n/a |
| 7 | Capawesome | Solved (mobile OTA) | No | Yes — Capacitor/Ionic/Cordova | No |
| 8 | Voltbuilder | Died / negligible | No | No (was web-wrapper) | No |
| 9 | Appcircle | Punted (CI/CD) | No | No (build only) | No |
| 10 | Codemagic | Punted (CI/CD) | No | No (build only) | No |
| 11 | Bitrise | Punted (CI/CD) | No | No (build only) | No |
| 12 | Fastlane | Punted (automation) | No | No (submit only) | No |
| 13 | Ionic Appflow | Died (EOL 2027-12-31) | No | Yes — Capacitor/Ionic (until 2027) | No |
| 14 | PWABuilder | Solved (Windows MSIX) | Yes — MSIX | Play Store package only | n/a |
| 15 | Cloudflare Pages + R2 + Workers | Solved (if you build it) | Yes — custom manifest | Yes — custom manifest | Yes — CDN invalidation |

Legend: "Yes" = first-party or OS-level mechanism that actually delivers the
update; "No" = relies on the store / package manager or does not exist; "n/a" =
the surface is not part of that technology's target set.

---

## Appendix B — Key-dates timeline

| Date | Event |
|------|-------|
| 2024-10-02 | Tauri 2.0.0 released with the updater plugin |
| 2025-02-11 | Ionic announces EOL of all commercial products (Appflow, Identity Vault, Portals) |
| 2025-03-31 | Microsoft App Center CodePush service shut down |
| 2025-05-20 | Microsoft archives `react-native-code-push` SDK and `code-push-server` on GitHub |
| 2026-08-25 | Appisto publishes "CodePush alternatives for React Native in 2026" |
| 2026-09-21 | Capawesome-Ionic partnership announced (Appflow migration) |
| 2026-10-10 | Tauri updater v2.13.3 released (minisign-verify 0.3 upgrade) |
| 2026-10-25 | CodeOnAir publishes "CodePush alternatives 2026" |
| 2026-11-04 | This survey compiled |
| 2027-12-31 | Ionic Appflow end of life (projected) |

---

## Appendix C — Sources

1. Tauri Updater plugin docs — https://v2.tauri.app/plugin/updater/
2. Tauri Updater source — https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
3. Tauri Updater README (platform support table) — https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/README.md
4. Tauri Updater changelog — https://v2.tauri.app/release/updater/
5. Tauri mobile plugin development — https://v2.tauri.app/develop/plugins/develop-mobile/
6. Tauri "What is Tauri?" — https://v2.tauri.app/start/
7. Expo "Migrate from CodePush" — https://docs.expo.dev/eas-update/codepush/
8. Expo blog "What to do without CodePush" — https://expo.dev/blog/what-to-do-without-codepush
9. CodeOnAir "CodePush alternatives 2026" — https://codeonair.com/blog/codepush-alternatives-2026
10. CodeOnAir "Migrate from App Center CodePush" — https://codeonair.com/blog/migrate-from-app-center-codepush-react-native
11. Appisto "CodePush alternatives" — https://appisto.app/blog/codepush-alternatives-react-native
12. Revopush "CodePush alternatives" — https://revopush.org/react-native-codepush-alternative
13. Bundle Drop "Life after CodePush" — https://bundledrop.app/resources/life-after-codepush
14. Capawesome homepage — https://capawesome.io/
15. Capawesome-Ionic partnership — https://capawesome.io/blog/announcing-partnership-with-ionic/
16. Ionic EOL announcement — https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products
17. Ionic Appflow page — https://ionic.io/appflow
18. Microsoft .NET MAUI deployment docs — https://learn.microsoft.com/en-us/dotnet/maui/deployment/
19. Microsoft .NET MAUI Windows deployment — https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/overview
20. Flutter `app_updater` package — https://pub.dev/packages/app_updater
21. Flutter `app_updater` repository — https://github.com/mantreshkhurana/app_updater
22. Flutter deployment docs — https://docs.flutter.dev/deployment
23. Uno Platform repository — https://github.com/unoplatform/uno
24. Uno Platform site — https://platform.uno/
25. Compose Multiplatform official — https://www.jetbrains.com/compose-multiplatform/
26. Appcircle — https://appcircle.io/
27. Codemagic — https://codemagic.io/
28. Bitrise — https://www.bitrise.io/
29. Fastlane — https://fastlane.tools/
30. PWABuilder repository — https://github.com/pwa-builder/PWABuilder
31. PWABuilder docs — https://docs.pwabuilder.com/
32. Cloudflare Pages — https://pages.cloudflare.com/
33. Cloudflare R2 — https://www.cloudflare.com/products/r2/
34. Cloudflare Workers — https://workers.cloudflare.com/

*Survey compiled 2026-11-04. All URLs were fetched and verified accessible during
the research session unless explicitly flagged as unverified (Voltbuilder). The
Voltbuilder entry is based on the service's known historical behavior plus the
defunct state of its domain and dependent plugins; it should be re-verified before
any decision relies on it.*

*End of survey.*
