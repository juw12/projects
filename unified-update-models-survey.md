# Unified Update Models: Cross-Platform Frameworks & Hosted Services Survey

**Context**: AIRIZ Motor Console - selecting a unified release architecture for a cross-platform surface.
**Date**: November 2026
**Scope**: Which cross-platform frameworks and hosted services ship a *unified* update model that users actually like in production.

---

## Executive Summary

No single cross-platform framework ships a first-party unified update model that users universally love. The landscape splits into three camps:

| Camp | Tools | Reality |
|------|-------|---------|
| **OTA code-push (JS/Dart layer)** | Shorebird, Expo EAS Update, Capawesome, Codemagic Patch | Works well for mobile; cannot replace native binaries; store rules constrain scope |
| **Binary auto-update (desktop)** | Tauri Updater | Genuinely unified (Win/Linux/macOS) but mobile support is thin |
| **CI/CD only (no update model)** | VoltBuilder, Appcircle, Codemagic (core), Cloudflare Pages, Netlify, PWA Builder | Build and distribute - no self-updating runtime |

The **most liked** unified model in production is **Tauri's updater** for desktop (simple, signed, one JSON endpoint) and **Shorebird** for Flutter mobile (zero-code-change OTA with automatic fallback). The **biggest gap** is a single tool that covers desktop + mobile + web with one update pipeline - no tool does this today.

**Dead/sunset tools to avoid**:
- **Microsoft App Center CodePush** - sunset May 2025
- **Azure App Center (all services)** - fully retired July 2025
- **Ionic Appflow Live Updates** - deprecated, replaced by Capawesome
- **Apache Cordova as a primary framework** - in structural decline (2024+)

---

## Tool Comparison Table

| Tool | Surfaces | Update Model | Signing | Status | Year Launched | Last Major Update | Key Complaints |
|------|----------|-------------|---------|--------|---------------|-------------------|----------------|
| **Tauri Updater** | Win, Linux, macOS, Android, iOS | Binary auto-update (ed25519) | Ed25519 (mandatory) | Active, v2 stable | 2020/2021 | Nov 2025 | macOS less polished; mobile limited; no web |
| **Shorebird** | Android, iOS, macOS, Win, Linux | Dart code-push (binary diff) | Patch signing (default) | Active, GA | 2023 | 2025-2026 | No native patch; no self-host; Flutter fork |
| **Expo EAS Update** | Android, iOS | JS bundle OTA (RN) | RSA | Active, GA | 2021 | 2026 | RN-only; no native; requires Expo SDK |
| **Capawesome** | Android, iOS, Electron | Web bundle OTA (Capacitor) | RSA (optional) | Active, v8.x | 2022 | 2026 | Electron only desktop; web-view based |
| **flutter_upgrader** | Win, Linux, macOS | Manual check + dialog | None (OS-level) | Community, niche | 2022 | 2024 | Unmaintained; no signing; clunky |
| **.NET MAUI** | Android, iOS, macOS, Win, Tizen | Sideload + MSIX + Store | Platform-native | Active, v10 | 2022 | 2025-2026 | No OTA; MSIX manual |
| **Uno Platform** | Win, iOS, Android, Web, Linux, macOS | Native / WASM redeploy | Platform-native | Active, 5.2 | 2018 | 2026 | WASM full redeploy; no unified OTA |
| **Kotlin Multiplatform** | Android, iOS, Win, macOS, Linux, Web | No first-party | Platform-native | Active | 2019 | 2025-2026 | No update model at all |
| **RN CodePush** | Android, iOS | JS bundle OTA (dead) | RSA | **SUNSET May 2025** | 2016 | **Dead** | Full shutdown May 2025 |
| **VoltBuilder** | Android, iOS (Cordova/Cap) | **CI/CD only** | Platform-native | Active, small | 2021 | Jul 2025 | No update model; small vendor |
| **Appcircle** | Android, iOS, RN, Flutter | CI/CD + CodePush module | Native + CodePush RSA | Active, enterprise | 2017 | 2025-2026 | CodePush RN-only; enterprise pricing |
| **Codemagic+Patch** | Android, iOS, RN, Flutter, MAUI | CI/CD + self-hosted OTA | Native + fingerprinting | Active, GA | 2017/2024 | 2025-2026 | Patch self-host only; RN-only |
| **PWA Builder** | Windows (MSIX) | MSIX via Store | Authenticode + Store | Active | 2017 | 2024 | Windows-only; no mobile |
| **Cloudflare Pages+R2** | Web (PWA, any JS) | Instant deploy + rollback (CDN) | TLS + optional | Active, GA | 2020 | 2026 | Web-only; no native |
| **Netlify** | Web (PWA, any JS) | Instant deploy + rollback | TLS | Active, GA | 2014 | 2026 | Web-only; no native; egress fees |

---## Per-Tool Analysis

### 1. Tauri Updater

**Update Model (ed25519 flow)**

Tauri's updater is the most complete unified binary auto-update model in the cross-platform space.

1. Developer runs 	auri signer generate to produce an ed25519 keypair.
2. At build time, TAURI_SIGNING_PRIVATE_KEY env var signs the binary artifact. Output: AppImage + .sig (Linux), .app.tar.gz + .sig (macOS), -setup.exe + .sig (Windows).
3. At runtime, the app calls check() to hit a configured endpoint (static JSON on S3/GitHub, or dynamic server).
4. The response includes version, url, and signature (the .sig file content inline).
5. The updater verifies the ed25519 signature against the embedded pubkey in tauri.conf.json. If valid, downloads and installs.
6. On Windows, the app auto-exits before installer runs. installMode: passive (default), basicUi, or quiet.

Signing **cannot be disabled**. TLS is enforced in production. Custom variables ({{target}}, {{arch}}, {{current_version}}) allow server-side routing. Dynamic server: HTTP 204 = no update, HTTP 200 + JSON = update available.

**Supported Platforms**

| Platform | Level | Notes |
|----------|-------|-------|
| Windows | Full | MSI or NSIS, passive/basicUi/quiet install modes |
| Linux | Full | AppImage, .tar.gz |
| macOS | Full | .app.tar.gz |
| Android | Listed | Limited, no store bypass |
| iOS | Listed | Limited, no store bypass |

**Production Examples**
- tauri-action (GitHub Action) generates the static JSON automatically.
- CrabNebula Cloud: official Tauri partner offering dynamic update server.
- Tauri 2.0 stable since Oct 2024. Requires Rust 1.90+ (Nov 2025).

**Complaints**
- macOS update UX less polished than Sparkle (no auto-download without user prompt).
- Mobile support exists in plugin table but not well-documented or widely used in production.
- No web surface - Tauri is a native shell around a webview.
- v1 to v2 artifact format change was breaking for some users.

**Verdict**: Best-in-class for desktop cross-platform binary auto-update. If AIRIZ has a desktop surface, Tauri's model is the gold standard.

### 2. Flutter + Shorebird + flutter_upgrader

**Update Model**

Flutter ships **no first-party OTA**. Options:

- **Shorebird** (primary, production-grade): Replaces Flutter engine with patched version. shorebird release publishes full binary to store; shorebird patch publishes Dart-only diff that downloads on next launch. Patches signed by default. Automatic fallback. Tracks (staging/beta/stable).
- **flutter_upgrader** (community): Checks URL, shows dialog. No auto-download, no signing, no mobile. Desktop only. Effectively abandoned.

**Shorebird Production Examples**
- **Junglee Games**: 2M+ patch installs/month, 1M+ daily active players.
- **PushPress**: 1,500+ white-labeled gym apps.
- **Scapia** (travel fintech, India): Same-day fixes on Android and iOS.
- **VETC** (Vietnam): Hours to ship hotfix, down from days.
- **Solides, Kalshi, Delivery Hero, Couchsurfing, Cloudwalk**: listed on shorebird.dev.

**Key Technical Details**
- Shorebird is a fork of the Flutter engine. Keep all Flutter tooling.
- Patches can change: any Dart code, packages, endpoints. Cannot change: native code, build.gradle, Podfile, permissions, images/fonts.
- Free tier: 5,000 patch installs/month. **No self-host option** (explicitly stated).
- CI/CD: shorebird patch android --json --release-version=1.14.0+15. Agentic triggering supported.
- Mission Control: real-time dashboard for patch adoption, version distribution, rollout status.
- Store compliance: patches must not change app primary purpose (Apple DPLA 3.3.1(B)).

**Complaints**
- Cannot self-host (dealbreaker for some enterprises).
- Patches only touch Dart - heavy platform channels limit scope.
- Requires Shorebird's Flutter engine fork (not vanilla Flutter).
- No Windows/Linux desktop OTA.
- Pricing scales with patch installs.

**Verdict**: Best mobile OTA available today. If AIRIZ uses Flutter for mobile, Shorebird is the production-proven choice.

### 3. .NET MAUI

**Update Model**

.NET MAUI has **no built-in OTA or auto-update**. Update model:

- **Windows**: MSIX to Microsoft Store auto-update, or sideloaded MSIX with manual reinstall.
- **Android**: Google Play Store.
- **iOS/macOS**: App Store / Mac App Store.
- **Tizen**: Tizen Store.
- **Blazor Hybrid**: Webview source could theoretically be swapped, but not first-party supported.

No check-for-update API, no OTA signing, no cloud service integration. Build, sign, submit to each store independently.

**Production Examples**
- Enterprise banking, healthcare, internal tools. Microsoft sample apps.
- .NET 10 is current LTS path. Codemagic supports MAUI builds.

**Complaints**
- No unified update story - each platform is separate.
- MSIX sideloading on Windows is poor UX (reinstall, no auto-check).
- Blazor Hybrid webview could be OTA'd but native shell still needs store updates.
- Smaller ecosystem than Flutter/RN.

**Verdict**: .NET MAUI **punts** entirely on the update model. You are on your own for each platform.

### 4. Uno Platform

**Update Model**

Targets: Windows (UWP/WinUI), iOS, Android, Web (WASM), Linux (Skia), macOS.
- **Native**: Standard store updates. No OTA. No first-party auto-update.
- **WASM**: Full redeploy to hosting server. Browser cache-busts via service worker.
- **Windows 7/UWP**: MSIX via Store or sideload.

No unified cross-target update mechanism.

**Production Examples**
- **Toyota, Air Canada, Sentry, Cineplex, Parkland, VCA, Netlift, Kahua, CCM, Trader Zero, NGL, Dispatch, Brain, Ziidms**.
- Enterprise line-of-business apps with XAML/WPF heritage.
- Transitioning to paid Studio model alongside free open-source core (Apache 2.0).

**Complaints**
- WASM builds are large (15MB+). Full re-download on every update.
- No OTA for any target - must go through stores.
- Paid Studio tier creates split: free core vs. paid tooling.

**Verdict**: Uno **punts** on the update model. WASM gives instant web updates at cost of large payloads. Native = store.

### 5. Kotlin Multiplatform

**Update Model**

KMP has **no first-party update mechanism**. It is a language/framework layer, not a distribution platform.
- **Android**: Google Play. **iOS**: App Store. **Desktop**: Manual. **Web**: Full redeploy.

**Production Examples**
- **Netflix**: KMP for shared business logic. **LinkedIn, TikTok, Slack, Square, Coinbase, JetBrains**: various adopters.
- KMP is primarily for **shared logic**, not full UI cross-platform.

**Complaints**
- No unified update story - same as MAUI/Uno.
- Compose Multiplatform desktop not as mature as Tauri/Electron.
- KMP is a code-sharing tool, not a distribution tool.

**Verdict**: Weakest option for unified updates. Not designed as a distribution framework.

### 6. React Native: CodePush to Expo EAS Update

**The CodePush Sunset (Critical)**

- **February 2024**: Microsoft announced App Center CodePush would stop accepting new apps.
- **April 30, 2025**: Existing CodePush apps could no longer receive new updates.
- **May 2025**: Full CodePush service shutdown.
- **July 2025**: All Azure App Center services (build, test, crash, distribute, CodePush) fully retired.

This left the React Native community without a Microsoft-backed OTA solution. Migration paths:
1. **Expo EAS Update** (official Expo replacement) - for Expo-based projects.
2. **Appcircle CodePush** - self-hosted or cloud, for bare RN.
3. **Codemagic Patch** - self-hosted, for bare RN.
4. **Capawesome Live Update** - for Capacitor (not RN).

**React Native's Own Position**

React Native itself (Meta) has never shipped a first-party OTA update mechanism. CodePush was Microsoft's (not Meta's) solution. After the sunset, the ecosystem fragmented.

**Production Examples (post-CodePush)**
- **Expo EAS Update**: Thousands of Expo-based RN apps. Expo is the default RN template.
- **Appcircle**: Ziraat, Halkbank, DenizBank, Coca-Cola, Getir, PTT, Accenture, AIA, Panasonic, Renault, Togg, Turkcell.
- **Codemagic Patch**: Newer, self-hosted. 150,000+ developers on Codemagic CI/CD.

**Complaints (CodePush era, 2022-2024)**
- CodePush updates got rejected by Apple (significant change without review). Recurring 2022-2023.
- CodePush is in maintenance mode - multiple GitHub issues 2023-2024 with no response.
- App Center is dying - widespread community panic in 2024.
- CodePush does not support new RN versions quickly - version lag complaints.

**Complaints (EAS Update)**
- Requires Expo SDK (or expo-updates library in bare mode).
- Cannot update native code, permissions, or SDK version.
- MAU billing model can be confusing.
- Classic Updates (pre-2021) are deprecated - migration required.

**Verdict**: The CodePush sunset was the biggest ecosystem disruption in RN since 2019. Expo EAS Update is the de facto replacement. Lesson: never build on a hosted service a single vendor can sunset without migration path.

### 7. Capawesome (Capacitor Live Update)

**Update Model**

Capawesome's Live Update plugin is the most feature-rich OTA for Capacitor. Key features:

- **Platforms**: Android, iOS, Electron (desktop).
- **Bundle management**: Download, set, delete bundles. Multiple coexist on-device.
- **Channels**: Versioned channels (e.g., production-5 tied to versionCode).
- **Auto-update**: Background strategy (checks on app start and resume, 15-min cooldown).
- **Rollback**: Automatic if ready() not called within readyTimeout (default 10s). Kill-safe on Electron.
- **Rollout**: Gradual percentage-based via Capawesome Cloud.
- **Delta updates**: Only download changed files.
- **Self-hosted bundles**: Download from any URL, no Capawesome Cloud dependency.
- **Security**: RSA public key verification of bundle integrity.
- **Ionic Portals / Federated Capacitor**: Supports Ionic Live Update Provider SDK.
- **autoBlockRolledBackBundles**: Auto-block bundles that caused rollback (up to 100).

**Scale**: 1,000+ projects, 20,000,000+ devices. Capacitor 6/7/8 support. MIT licensed.

**Compatibility**

| Plugin Version | Capacitor Version | Status |
|---------------|-------------------|--------|
| 8.x.x | >=8.x.x | Active support |
| 7.x.x | 7.x.x | Maintenance |
| 6.x.x | 6.x.x | Maintenance |
| 5.x.x | 5.x.x | Deprecated |

**Production Examples**
- **Ionic Portals**: Powered by same Live Update plugin via provider SDK.
- **Federated Capacitor**: Multi-tenant shell apps with per-tenant live updates.
- Migration paths from Ionic Appflow (deprecated) and App Center (sunset).

**Complaints**
- Electron support is new (v0.2.0+). Only zip artifact type.
- No Windows/macOS native support - Electron only for desktop.
- Capawesome Cloud is separate paid service (plugin free, cloud not).
- ready() pattern is a footgun: forget to call it = auto-rollback.
- Capacitor in maintenance mode (Ionic pivoting to Ionic Portals).

**Verdict**: Best OTA for Capacitor-based apps. Kill-safe rollback and delta updates are production-grade.

### 8. VoltBuilder

**Update Model: None (CI/CD only)**

VoltBuilder is a **hosted build service** for Cordova and Capacitor. Upload ZIP, builds APK/AAB and IPA, signs, optionally uploads to stores. **No runtime update mechanism.**

- **What it does**: Build to Sign to Upload to App Store / Play Store to QR code for sideload.
- **What it does NOT do**: No OTA, no code-push, no auto-update, no in-app update check.
- **Pricing**: /month starting. 15-day free trial. NS Basic LLC.
- **Positioning**: Replace Ionic AppFlow. No Mac required.
- **VoltSigner**: Generates downloadable iOS and Android certificates for free.

**Production Examples**
- Small-to-mid-size Cordova/Capacitor developers who do not want to manage Xcode/Android Studio.
- No major production apps publicly listed. Small operation with weekly blog updates.

**Complaints**
- Extremely small vendor - high risk of abandonment.
- No CI/CD pipeline (just upload to build to download).
- No update model whatsoever.
- Cordova ecosystem in decline undermines the primary use case.

**Verdict**: VoltBuilder is a **build tool, not an update tool**. Irrelevant for AIRIZ update needs.

### 9. Appcircle

**Update Model: CI/CD + CodePush Module + Enterprise App Store**

Appcircle is an enterprise mobile CI/CD platform. Update-related modules:

- **Build**: iOS, Android, RN, Flutter, native. Stacks updated within 24h of release.
- **CodePush module**: OTA for React Native. Rollouts, rollbacks, signing, diff/full bundles.
- **Enterprise App Store**: Distribute .ipa/.apk/.aab directly with **built-in in-app update capabilities**.
- **Publish to Stores**: Automate App Store / Play Store / Huawei / Intune.
- **Signing Identities**: Centralized cert/keystore management. Auto-renewal.
- **Appcircle AI**: AI-powered build troubleshooting, MCP server, natural language queries.

**Enterprise App Store (most relevant for AIRIZ)**
- Keep apps up to date with built-in in-app update capabilities.
- For in-house, B2B, B2E apps: distribute binaries directly without public stores.
- No MDM required. SSO/LDAP, RBAC, usage reporting.

**Scale**: 500+ enterprise clients. 78% decrease in build times. 40% productivity. 50% faster releases.

**Production Examples**
- 2K, Coca-Cola, Getir, PTT, Renault, Togg, Turkcell, Halkbank, Ziraat, DenizBank, Accenture, AIA, Panasonic, Orange, Starkey, LifeScan, Mashreq NEO, Extended Stay America, Intertech, Hepsiburada, Proton, Flo, Gratis, GetContact, Dispo, Anadolubank, American Express, Cathago, Airdev, Albaraka, FWD, DeFacto, Vakif Katilim, Zurn, Wildflower, Teknasyon, Logo.
- Ziraat Teknoloji: 40+ mobile apps, 50M+ downloads, 10M+ active users.
- Intertech: 50%+ productivity boost, 80% less infra maintenance.
- Halkbank: 65% faster code review, 50%+ faster releases.

**Complaints**
- Enterprise pricing (+/month typical).
- CodePush module is RN-only (no Flutter, no native OTA).
- Enterprise App Store is for in-house apps only.
- Self-hosted deployment is complex (Docker, K8s, OpenShift).

**Verdict**: Strongest enterprise CI/CD option. Enterprise App Store with in-app updates is closest to unified update for B2B. Not consumer-facing OTA.

### 10. Codemagic + Patch

**Update Model: CI/CD + Self-Hosted OTA (Patch)**

Codemagic is a CI/CD platform (like Appcircle, Bitrise). 150,000+ developers. Supports Flutter, RN, native, MAUI, Unity, Ionic.

**Codemagic Patch (self-hosted OTA for React Native)**

- **One-command install**: cmpatch selfhost install - configures OAuth, CDN cache rules, TLS, Docker Compose.
- **Fingerprinting**: Checks native binary fingerprint to block incompatible releases.
- **Binary diffs**: Only sends changed bytes (not full bundle).
- **Rollout/rollback**: Dashboard with adoption metrics, percentage rollouts, instant rollback.
- **CDN delivery**: Devices check/download from CDN, not the server. Scales to millions.
- **Install timing modes**: Immediate, restart, resume, suspend.
- **RBAC**: Role-based access in dashboard.
- **Support**: Licensed support available.

**Comparison (from patch.codemagic.io)**

| Feature | Other self-hosted OTA | Codemagic Patch |
|---------|----------------------|-----------------|
| Throughput | DIY autoscaling | CDN-backed |
| Downtime | API outage blocks checks | Only if CDN fails |
| Fingerprinting | Some | Bundle diffs |
| Install timing | sync() modes | Immediate, restart, resume, suspend |
| Release metrics | Often limited | Dashboard + CLI |
| User roles | Varies | RBAC in dashboard |
| Support | GitHub issues only | Support licence available |

**Production Examples**
- 150,000+ developers on Codemagic CI/CD.
- Flutter app dev companies in LATAM, social media tools, global retail, Australian bookmakers, GPS fitness, urban mobility, mobile games, mental health, virtual fitness.
- Patch is newer (2024+) - fewer public production case studies yet.
- Codemagic states: delivered billions of over-the-air updates to production apps.

**Complaints**
- Patch is **self-hosted only** - no managed option.
- Patch is **React Native only** - no Flutter, no native, no MAUI.
- CI/CD is not auto-update: separate self-hosted component needed.

**Verdict**: Most technically interesting self-hosted OTA for RN (CDN-backed, fingerprinting, binary diffs). But self-hosted and RN-only.

### 11. Shorebird (Detailed)

*(Covered in Section 2. Additional points:)*

**Security Model**
- We never see your source code. Only compiled builds and metadata reach us.
- Nothing about who your users are. No names, accounts, device identifiers, or location.
- Your app runs only your patches. New releases are signed by default.
- Trust center: trust.shorebird.dev. SAML SSO, audit logs, invoice billing.

**Patch Flow**
1. shorebird release android --release-version=1.14.0+15 - publishes to store
2. shorebird patch ios --release-version=1.14.0+15 - publishes Dart-only diff
3. Device checks on launch, downloads patch in background
4. Patch takes effect on next launch. Automatic fallback if patch fails.

**Verdict for AIRIZ**: If mobile is Flutter, Shorebird is the clear winner. Automatic fallback and patch signing make it production-safe. Only concern: no-self-host policy.

### 12. Expo EAS Update (Detailed)

*(Covered in Section 6. Additional points:)*

**Technical Architecture**
- expo-updates library checks for updates on launch (or custom timing via useUpdates() hook).
- Updates published via eas update --channel production --message ...
- Update = JS bundle + assets (not native code).
- Runtime version policies: updates only sent to compatible native builds.
- **Republish**: Roll back by republishing previous update (like git revert).
- **Rollouts**: Percentage-based gradual rollout.
- **Insights**: Adoption, crash rates, payload size, embedded vs OTA split.
- **Expo Skills for AI agents** (2026): AI agents can check update health.
- **GitHub Actions**: PR preview updates with QR code.
- **Expo Workflows**: Pre-packaged update job type.

**When to Use / When NOT to Use**

| Scenario | EAS Update? |
|----------|-------------|
| Fix JS bug, deploy in minutes | Yes |
| Update copy, translations, UI styling | Yes |
| Roll out to % of users | Yes |
| Publish from CI | Yes |
| Change native code | **No** (use EAS Build) |
| Change app permissions | **No** |
| Update Expo SDK version | **No** |
| Anything requiring new binary | **No** |

**Verdict**: Default choice for Expo-based RN. Production-proven, best observability of any OTA. If AIRIZ uses Expo RN, this is the answer for mobile.

### 13. PWA Builder (Microsoft)

**Update Model**

PWA Builder (pwabuilder.com) is a **conversion tool**, not an update mechanism.
1. Takes a PWA URL.
2. Packages it as a Windows Store (MSIX) app.
3. Adds manifest, icons, Windows-specific metadata.
4. Submits to Microsoft Store (or sideloads).

Update model: Windows Store = standard MSIX auto-update. Sideload = manual. PWA content = instant (server-side deploy). MSIX wrapper = thin shell.

**Production Examples**
- Microsoft 365 PWA versions. Various enterprise PWAs for Windows 10/11.

**Complaints**
- Windows-only - no Android, iOS, macOS, Linux.
- MSIX wrapper adds no real functionality beyond pinned to taskbar.
- PWA Builder future is uncertain (Microsoft pushing WebView2).
- Apple restrictions make PWA a dead end on iOS.

**Verdict**: Windows packaging tool, not cross-platform update solution. Only relevant for Windows PWA surface.

### 14. Cloudflare Pages + R2

**Update Model**

Cloudflare Pages is **web hosting and deployment**. Update model:
- **Instant deploy**: Git push to build to deploy to global CDN. Zero-downtime.
- **Rollback**: One-click revert to any previous deployment.
- **Preview environments**: Every PR gets unique URL.
- **Pages Functions**: Serverless server-side code.
- **R2**: Object storage (S3-compatible). **Zero egress fees.**
- **Workers**: Serverless compute. Pages being migrated to Workers (Aug 2026).

**As Update Infrastructure (relevant use case)**
- Store Tauri updater JSON + binary artifacts on R2.
- Serve JSON via Pages (free tier: 500 deploys/month).
- CDN delivery = fast global downloads. No egress fees.

**Complaints**
- Pages to Workers migration creates uncertainty.
- Free tier: 500 deploys/month may be insufficient.
- No native app update capability - web infrastructure only.

**Verdict**: Infrastructure, not a solution. Excellent CDN/storage backend for your own update mechanism.

### 15. Netlify

**Update Model**

Netlify is **web hosting and deployment** (similar to Cloudflare Pages but older).
- **Instant deploy**: Git push to build to deploy. Zero-downtime.
- **Rollback**: One-click to any previous deploy.
- **Preview environments**: Per-PR unique URLs.
- **Functions**: Serverless (Lambda-based). Image CDN. Forms.

**Complaints**
- **Pricing complexity**: Egress fees surprising. Pricing changed multiple times.
- Netlify is for marketing sites, not apps - common perception.
- No native app update capability.
- Egress fees make it less attractive than Cloudflare R2 for binary downloads.

**Verdict**: Web hosting infrastructure. No relevance to native app updates. Use R2/S3 for binary downloads instead.

---

## Cross-Tool Synthesis

### What Solved Well

| Problem | Winner | Why |
|---------|--------|-----|
| Desktop binary auto-update (multi-OS) | **Tauri Updater** | ed25519, static JSON or dynamic server, one plugin covers Win/Linux/macOS |
| Mobile Dart code-push | **Shorebird** | Binary diff, auto fallback, tracks, patch signing, 2M+ installs/month |
| Mobile JS code-push | **Expo EAS Update** | Runtime versions, republish, insights, rollout. Production-proven since 2021 |
| Web bundle OTA (hybrid apps) | **Capawesome** | Kill-safe rollback, delta updates, channels, self-hosted, 20M+ devices |
| Enterprise CI/CD + in-house distribution | **Appcircle** | Enterprise App Store with in-app updates, 500+ enterprise clients |
| Self-hosted RN OTA at scale | **Codemagic Patch** | CDN-backed, fingerprinting, binary diffs, one-command Docker |
| Update artifact hosting | **Cloudflare R2** | Zero egress fees, global CDN, S3-compatible |

### What Punted (No Unified Update Model)

| Tool | What They Punted | Why |
|------|------------------|-----|
| **.NET MAUI** | Entire update model | Each platform uses native store. No OTA, no auto-update |
| **Uno Platform** | Entire update model | WASM = full redeploy. Native = store. No middle ground |
| **Kotlin Multiplatform** | Entire update model | Code-sharing tool, not a distribution platform |
| **VoltBuilder** | Entire update model | Build service, not an update mechanism |
| **Cloudflare Pages** | App-side update logic | Infrastructure (CDN/storage), not a solution |
| **Netlify** | App-side update logic | Web hosting, not app updates |
| **PWA Builder** | Cross-platform updates | Windows-only packaging. PWA content via web deploy |

### What Died

| Tool | Death Date | Cause |
|------|-----------|-------|
| **Microsoft App Center CodePush** | May 2025 | Microsoft divested from mobile tooling |
| **Azure App Center (all)** | July 2025 | Full retirement. No migration path for non-Expo users |
| **Ionic Appflow Live Updates** | 2023-2024 | Deprecated. Replaced by Capawesome (same codebase) |
| **Apache Cordova (as primary)** | Ongoing 2024+ | Structural decline. Capacitor is replacement |
| **Classic Expo Updates** | 2021+ deprecated | Replaced by EAS Update |
| **flutter_upgrader** | ~2024 abandoned | Community package, no maintainer, no signing, no mobile |

### The Key Insight

**No tool provides a single update mechanism that covers desktop + mobile + web.** The closest approaches:

1. **Tauri** for desktop + **Shorebird** for Flutter mobile + **web deploy** for web = three separate pipelines.
2. **Capawesome** for Android/iOS/Electron + **store** for native desktop = two pipelines.
3. **Expo EAS Update** for mobile + **web deploy** for web + **Tauri/MSIX** for desktop = three pipelines.

The unified update model that users actually like is **per-surface**: one mechanism per technology layer (binary, JS bundle, web), all managed from a single CI/CD pipeline. The unification is in the **pipeline**, not in the **update mechanism itself**.

**The pattern that works in production:**
- Desktop: Signed binary auto-update (Tauri-style ed25519).
- Mobile: Code-push for framework layer (Shorebird for Dart, EAS Update for JS).
- Web: Instant deploy to CDN (Cloudflare Pages/Workers, Netlify).
- All three orchestrated from one CI/CD pipeline (GitHub Actions, Azure DevOps).
- Update artifacts hosted on zero-egress CDN (Cloudflare R2).

---

## AIRIZ Applicability Matrix

Assumptions about AIRIZ Motor Console:
- Cross-platform surface (likely: desktop + mobile + possibly web).
- Enterprise/industrial context (motor monitoring, telemetry, control).
- Needs reliable updates without user intervention (field devices hard to reach).
- Security requirements (signed updates, integrity verification).
- Possibly offline environments (factory floor, remote locations).

| Tool | Desktop | Mobile | Web/PWA | Offline | Signed | Self-Host | Enterprise | Verdict for AIRIZ |
|------|---------|--------|---------|---------|--------|-----------|-----------|-------------------|
| **Tauri Updater** | **Strong** | Weak | N/A | Yes | **Yes** (mandatory) | Yes | Yes | **Adopt for desktop** |
| **Shorebird** | No | **Strong** | N/A | Partial | **Yes** (default) | **No** | Yes (SAML) | **Adopt if Flutter** |
| **Expo EAS Update** | No | **Strong** (RN) | N/A | Partial | Yes (RSA) | No | Partial | **Adopt if Expo RN** |
| **Capawesome** | Weak (Electron) | **Strong** | N/A | Yes | Yes (optional) | Yes | Partial | **Adopt if Capacitor** |
| **.NET MAUI** | Weak | Weak | N/A | Yes | Native | N/A | Yes | **Avoid for updates** |
| **Uno Platform** | Weak | Weak | Partial (WASM) | Yes | Native | N/A | Yes | **Avoid for updates** |
| **Kotlin MP** | None | None | None | N/A | None | N/A | N/A | **Not applicable** |
| **CodePush (dead)** | N/A | **DEAD** | N/A | N/A | N/A | N/A | N/A | **DO NOT USE** |
| **VoltBuilder** | N/A | Build only | N/A | N/A | N/A | No | No | **Irrelevant** |
| **Appcircle** | N/A | CI/CD + CodePush | N/A | N/A | Yes | Yes | **Yes** | **For CI/CD + B2B** |
| **Codemagic+Patch** | N/A | Self-hosted (RN) | N/A | Yes | Yes | **Yes** | Yes | **If RN + self-host** |
| **PWA Builder** | Weak (MSIX) | No | **Strong** | Yes | Authenticode | No | No | **Windows PWA only** |
| **CF Pages+R2** | N/A (infra) | N/A (infra) | **Strong** | Yes | TLS | Yes | Yes | **Artifact hosting** |
| **Netlify** | N/A (infra) | N/A (infra) | **Strong** | Yes | TLS | No | Yes | **Web hosting only** |

### Recommended Architecture for AIRIZ Motor Console

**If tech stack is Tauri (Rust + Web):**
- Desktop: Tauri Updater (ed25519, static JSON on Cloudflare R2).
- Mobile: Capacitor + Capawesome (Tauri mobile is limited).
- Web: Deploy to Cloudflare Pages/Workers.
- Pipeline: GitHub Actions to build all targets to sign to upload to update JSON.

**If tech stack is Flutter:**
- Mobile: Shorebird (code-push, automatic fallback).
- Desktop: No good Flutter desktop updater. Use Tauri or accept manual updates.
- Web: Flutter Web to Cloudflare Pages.
- Pipeline: GitHub Actions to shorebird release + shorebird patch + web deploy.

**If tech stack is React Native (Expo):**
- Mobile: Expo EAS Update (code-push, runtime versions).
- Desktop: No RN desktop. Use Tauri/Electron + Capawesome.
- Web: React Native Web to Cloudflare Pages.
- Pipeline: GitHub Actions to eas build + eas update + web deploy.

**If tech stack is .NET (MAUI/Uno):**
- No good OTA option. Accept store-based updates.
- For in-house distribution: Appcircle Enterprise App Store.
- Web: Blazor to any static host.

**Universal recommendations regardless of stack:**
- Host update artifacts on **Cloudflare R2** (zero egress fees, global CDN).
- Use **GitHub Actions** as unified CI/CD pipeline.
- Implement **signed updates** (ed25519 desktop, RSA mobile).
- Build **rollback mechanism** (JSON version pinning or OTA rollback).
- For field/offline devices: **local update cache** (download online, install when ready).
- For enterprise B2B: consider **Appcircle Enterprise App Store**.

---

## Recommendation

| Priority | Recommendation | Rationale |
|----------|---------------|-----------|
| 1 | Tauri Updater (desktop) + Shorebird (Flutter mobile) | Best-in-class per surface. ed25519 + patch signing |
| 2 | Tauri Updater (desktop) + Expo EAS Update (RN mobile) | If RN-fluent. Best observability |
| 3 | Capawesome Live Update (Capacitor/Electron) | If web-technology-based. Kill-safe rollback |
| 4 | Appcircle Enterprise App Store | If B2B/in-house. Centralized distribution |
| 5 | Cloudflare R2 + custom updater | Full control, zero egress. Tauri-style JSON |

**What NOT to do:**
- Do NOT use CodePush (dead since May 2025).
- Do NOT rely on .NET MAUI or Uno Platform for update model (they punt).
- Do NOT use VoltBuilder as update mechanism (build tool only).
- Do NOT use Netlify for binary update hosting (egress fees; use R2).
- Do NOT assume CI/CD = auto-update (different problems).
- Do NOT build on single-vendor hosted service without migration path (CodePush lesson).

**The honest truth**: There is no single tool that gives one update, all platforms, users love it. The best approach is one signed update mechanism per technology layer, all orchestrated from a single CI/CD pipeline. Tauri's model (ed25519 + JSON endpoint) is the cleanest pattern to replicate.

---

## Appendix: Key Dates and Deadlines

| Event | Date | Impact |
|-------|------|--------|
| Microsoft announces CodePush sunset | Feb 2024 | RN community panic. Migration begins |
| CodePush stops accepting new apps | Feb 2024 | New apps must use EAS Update or alternatives |
| CodePush existing apps stop receiving updates | Apr 30, 2025 | Hard deadline. All CodePush apps frozen |
| CodePush full shutdown | May 2025 | Service gone |
| Azure App Center full retirement | Jul 2025 | All App Center services dead |
| Tauri 2.0 stable | Oct 2024 | Updater plugin v2 with new artifact format |
| Shorebird patch signing on by default | 2025 | Security improvement |
| Cloudflare Pages to Workers migration notice | Aug 2026 | Pages in maintenance. New projects to Workers |
| Uno Platform 5.2 | 2026 | Hot Design, MCP. No update model changes |
| .NET MAUI 10 (.NET 10) | 2025-2026 | No update model changes. Still store-based |
| Capacitor 8 / Capawesome 8.x | 2026 | Active support. 20M+ devices |

---

## Appendix: User Complaints (Curated)

### Tauri Updater
- macOS auto-update does not work the way Sparkle does - users click Install every time. (GitHub, 2024)
- The v1 to v2 artifact format change broke existing users. (GitHub, 2024)
- No way to do silent updates on Windows without admin. (GitHub, 2024)
- Mobile updater is barely documented. (Discord, 2025)

### Shorebird
- I cannot self-host. For compliance requirements, this is a dealbreaker. (Reddit r/FlutterDev, 2024)
- Patches cannot touch native code. Half my app is platform channels. (HN, 2024)
- The Flutter engine fork means I cannot use latest Flutter until Shorebird catches up. (GitHub, 2025)
- Pricing at scale (500K+ installs) is not trivial. (Reddit, 2025)

### Expo EAS Update
- Expo is a wrapper, not a framework. Stuck in their ecosystem. (HN, recurring)
- MAU billing confusing. 10K installs but only 2K download updates - pay for which? (Expo forums, 2024)
- Cannot update native code. My app has a native payment SDK. (GitHub, 2024)
- Runtime version policies are powerful but confusing. (Expo forums, 2025)

### Capawesome Live Update
- The ready() pattern is a footgun. Forget to call it = rollback every launch. (GitHub, 2024)
- Electron support is too new for production. Zip extraction issues. (GitHub, 2025)
- Capacitor is in maintenance mode. Worried about long-term future. (Reddit, 2025)
- Self-hosted option works but docs are thin. (GitHub, 2024)

### React Native / CodePush (historical)
- CodePush updates got app rejected by Apple. Significant change without review. (GitHub, 2022-2023)
- CodePush does not support latest RN version. Stuck on old version. (GitHub, 2023)
- App Center is in maintenance mode. No new features. No bugs fixed. (GitHub, 2023-2024)
- CodePush sunset with no good alternative for bare RN. (HN, Feb 2024)

### .NET MAUI
- No way to update sideloaded MSIX without user re-running installer. (MS Forums, 2024)
- Each platform is a completely separate build pipeline. No shared update logic. (MS Forums, 2024)
- Blazor Hybrid webview cannot be OTA-updated without native shell update. (MS Forums, 2025)

### Uno Platform
- WASM builds are 15MB+. Every update is full re-download. (Uno forums, 2024)
- No OTA for any target. We use MDM for enterprise deployment. (Uno forums, 2024)
- The paid Studio tier is confusing. Is the core still free? (Uno forums, 2025)

### Codemagic / Patch
- Patch is self-hosted only. For a 5-person team, Docker + CDN is overkill. (Codemagic forum, 2025)
- Patch is RN-only. We use Flutter and have no option. (Codemagic forum, 2025)
- CI/CD is great but does not update the app. Still need separate OTA. (Codemagic forum, 2024)

### Appcircle
- Enterprise pricing is +/month. For a startup, not feasible. (G2, 2024)
- CodePush module is RN-only. We use Flutter. (Appcircle forum, 2024)
- Self-hosted deployment is complex. Spent 2 weeks on Docker + K8s. (Appcircle forum, 2025)

### VoltBuilder
- No CI/CD pipeline. Just upload, build, download. (User feedback)
- Cordova is dying. What is the point of building on a dying framework? (Community)

---

*End of report. Sources: official documentation (fetched Nov 2026), GitHub issues, Reddit, Hacker News, vendor websites.*

