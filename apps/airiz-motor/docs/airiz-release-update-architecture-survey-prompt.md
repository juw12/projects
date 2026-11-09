# AIRIZ Motor Console — Release / Auto-Update Architecture Survey Prompt

> **What this is**: a session-opener prompt. Paste it into a fresh OpenCode session to
> drive an exhaustive, parallel-agent research project before deciding the unified
> release / auto-update architecture for the AIRIZ Motor Console
> (`apps/airiz-motor/`, GitHub: `juw12/projects`, monorepo at `C:\Users\juwen_lie\Documents\Default Project`).
>
> **Source**: adapted from the OpenForge CI/CD runner-architecture prompt (8 parallel
> agents, MAX TOKEN EXPENDITURE mode, search + analyze, three verification passes).
> The decision space is mapped 1:1: runner protocol → release protocol, container build
> → cross-platform build, cache layer → binary cache, secret store → code-signing key
> store, matrix strategy → multi-platform release matrix.

---

[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures, ast-grep)
- librarian agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
NEVER stop at first result - be exhaustive.

[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- 1-2 explore agents (codebase patterns, implementations)
- 1-2 librarian agents (if external library involved)
- Direct tools: Grep, AST-grep, LSP for targeted searches

IF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:
- **Oracle**: Conventional problems (architecture, debugging, complex logic)
- **Artistry**: Non-conventional problems (different approach needed)

SYNTHESIZE findings before proceeding.

MANDATORY delegate_task params: ALWAYS include load_skills and run_in_background when calling delegate_task. Evaluate available skills before dispatch - pass task-appropriate skills when relevant, pass [] ONLY when no skill matches the task domain.
Example: delegate_task(subagent_type="explore", prompt="...", run_in_background=true, load_skills=[])

---

🚨 MAXIMUM TOKEN EXPENDITURE MODE 🚨

Context — three times, for emphasis: AIRIZ Motor Console,
`apps/airiz-motor/` inside the `juw12/projects` monorepo
(`C:\Users\juwen_lie\Documents\Default Project`). Owner Juwen Lie,
team Ziris PTB. Cross-platform console for an AIRIZ motor test
device. Five surfaces today: (1) Electron Windows desktop (signed
installer + portable), (2) Capacitor Android mobile (signed APK,
keystore in `AIRIZ_ANDROID_KEYSTORE_BASE64` secret), (3) Capacitor
iOS mobile (unsigned IPA + zipped Xcode project, no App Store yet),
(4) static web PWA + Web Serial API + Pages-hosted update channel,
(5) Cloudflare Workers + Durable Objects relay for WebSocket/WebRTC
fallback. Plus a Python stdlib server for device-audio auto-save, a
Bluetooth-bridge for legacy phone-remote (deprecated in 1.11.18 but
still in tree), three locales (en / 繁中 / 简中) and a release-kit
tool folder with `sync_release_feed.py` and `add_coadmin.py`. Five
GitHub workflows already wire this: `airiz-desktop.yml`,
`airiz-mobile.yml`, `airiz-mobile-runtime.yml`, `airiz-relay-worker.yml`,
`airiz-update-feed.yml`. Three independent signing pipelines, five
independent update mechanisms. I will not pick the unified release
architecture until the survey is done.

Goal — three angles:

1. I need an exhaustive map of every auto-update / release engine
   that has ever shipped for a cross-platform desktop + mobile +
   web app — `electron-updater` (electron-userland), Squirrel.Windows,
   Squirrel.Mac, Sparkle, WinSparkle, Microsoft.AutoUpdater (MSIX),
   `@tauri-apps/updater`, Capacitor Live Update (Capawesome +
   official), CodePush (App Center, deprecated 2025), Expo Updates,
   Sentry Releases, `@capawesome/capacitor-live-update`, Flutter
   `package_info_plus` + custom, .NET MAUI deployment, Uno Platform,
   React Native `react-native-code-push`, PWA service worker
   lifecycle, Chrome component updater (OMA-DM) — with their
   tradeoffs.
2. The objective is to pick the simplest unified release
   architecture that lets a one-person team ship signed updates to
   Windows desktop + Android + iOS + Web PWA + Cloudflare Worker
   without inventing a new manifest format per platform.
3. Said differently: do we keep the custom `sync_release_feed.py`
   + `electron-updater` flow on Windows and bolt Capacitor Live
   Update on mobile, do we migrate the whole stack to Tauri
   (one updater, one signing flow, multi-platform targets), or do
   we build a single signed-manifest-on-R2 (or S3 / GitHub
   Releases) layer that every surface — Electron, Capacitor, PWA
   service worker, Cloudflare Worker — pulls from?

Downstream: AIRIZ's release protocol (signed manifest schema,
channel model, delta-vs-full, stage-and-promote), cross-platform
build strategy (electron-builder vs Tauri vs Capacitor CLI vs
custom), binary cache (Cloudflare R2 vs S3 vs GitHub Releases),
code-signing key store (Windows EV cert handling, Android P12
keystore rotation, iOS provisioning profile lifecycle, PWA
subresource integrity), and multi-platform release matrix (Win +
macOS + Android + iOS + Web PWA + Worker, all in one GitHub
workflow or split) all depend on what you find.

Fire 8 background agents in parallel. All 8:

1. explore — `electron-updater` (electron-userland/electron-updater)
   AND `@capawesome/capacitor-live-update` source code. File paths,
   manifest format (latest.yml / latest.yml.gz, capacitor-live-update
   manifest), signed channels, cache layer (downloaded .exe / .zip
   staging), binary verification flow, app-quit timing hooks,
   rollback mechanics. Compare: how does each tool decide "this
   update is good enough to keep", how does each surface a failure
   to the user, how does each survive a partial download.
2. librarian — Context7 + official docs for Squirrel.Windows
   (C# nuspec / RELEASES file), Sparkle (macOS appcast XML),
   electron-updater (provider abstraction: generic, github,
   s3, bintray), @tauri-apps/updater (Tauri 2.x protocol with
   signatures + ed25519), Capacitor Live Update (Capawesome +
   official), Expo Updates (manifest + rollouts), CodePush
   (deprecated App Center code, migration to Expo), PWA service
   worker (Workbox vs native, update lifecycle, skipWaiting +
   clients.claim), Microsoft.AutoUpdater (MSIX, AppInstaller).
   Full protocol surface for each.
3. deep — top 10 hardest problems in shipping a cross-platform
   auto-update channel that users actually trust without
   bricking a fleet. One paragraph each + one real outage
   citation (e.g. CrowdStrike 2024-07-19 channel file, CCleaner
   2017, ASUS Live Update 2019, SolarWinds 2020, electron-builder
   known issues, CodePush sunset). Cover: partial-download
   mid-update, code-signing cert expiry, manifest tampering,
   delta-update corruption, staged-rollout regret, PWA SW caching
   the old shell, iOS App Store vs enterprise distribution, Mac
   notarization, Android v2/v3/v4 signature scheme mismatches,
   Cloudflare Worker version rollback after a buggy deploy.
4. librarian — best-practice docs (Context7 + web) for
   cross-platform auto-update security in 2026: ed25519 manifest
   signatures, Windows EV cert + SmartScreen reputation,
   Android APK Signature Scheme v3/v4, iOS app signing chain +
   provisioning profile lifecycle, PWA subresource integrity +
   service worker update traps, Cloudflare Worker signed deploys,
   staged rollouts (10% → 50% → 100%), crash-throttled rollback
   (Sentry / Rollbar / Bugsnag telemetry-gated deploys), delta
   updates (bsdiff / zsync / Courgette). Real docs, real
   benchmarks, real outage write-ups.
5. explore — every public postmortem from electron-updater,
   electron-builder, Squirrel.Windows, Squirrel.Mac, Sparkle,
   @capawesome/capacitor-live-update, CodePush / App Center,
   Expo Updates, PWA service worker libraries (Workbox),
   @tauri-apps/updater, Microsoft.AutoUpdater since 2022.
   Table: date, vendor, root cause, fix, blast radius. Also
   include the 2024-07-19 CrowdStrike incident (channel-file
   distribution failure), the 2017 CCleaner supply-chain
   compromise (signed-binary trust), and the 2023 1Password
   signed-binary update that broke Mac installs.
6. deep — 200 words per topic: (a) delta vs full updates
   (bandwidth, complexity, rollback story), (b) staged rollouts
   (percentage gates, kill switches, observability),
   (c) crash-throttled rollback (telemetry signal, decision
   latency, false positives), (d) signed manifests (key custody,
   rotation, revocation), (e) PWA service worker update traps
   (skipWaiting race, controller races, cross-tab fan-out,
   OOB cache), (f) store vs sideload for mobile (App Store /
   Play Store review latency vs enterprise / direct-APK freedom),
   (g) signed Cloudflare Worker deploys, (h) multi-arch single-
   bundle vs fat-binary per platform. 1600 words total.
7. librarian — real docs for: electron-builder NSIS auto-update
   protocol (latest.yml schema, github provider token, S3
   provider), @tauri-apps/updater protocol (Tauri 2.x signed
   JSON, pubkey in bundle config), Capacitor Live Update manifest
   spec (Capawesome current version + the deprecated official
   plugin), Squirrel.Windows release.nuspec + RELEASES file
   format, Sparkle appcast XML schema, PWA service worker
   update lifecycle (W3C spec, MDN, Workbox recipes), Microsoft
   AppInstaller schema. What is the **minimum viable subset** of
   all of these to reimplement? Cite spec version + any open
   draft PRs.
8. explore — does any cross-platform app ship a **unified**
   update model that users actually like? Cite Tauri (single
   updater for desktop + mobile web targets), Flutter (no
   first-party updater — community), .NET MAUI (sideload +
   MSIX), Uno Platform (web + native), Kotlin Multiplatform
   (no first-party updater), React Native (`react-native-
   code-push` sunset), Capawesome (Capacitor Live Update +
   Live Activities + plugins), Voltbuilder (hosted Cordova),
   Appcircle, Codemagic. Cite which tools solved multi-platform
   updates well, which ones punted, which ones died.

DO NOT summarize. Full output. If any agent returns <500 lines,
re-run it. After all 8 finish, run all 8 again for verification.
Then a third pass if the first two disagree.

Begin. 🫡
