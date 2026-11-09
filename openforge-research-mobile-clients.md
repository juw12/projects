# OpenForge Mobile — Exhaustive Landscape of Gitea/Forgejo Mobile Clients

> **Deliverable:** Deep-web research inventory of every public mobile client for Gitea/Forgejo.
> **Purpose:** Drive OpenForge's greenfield mobile-app MVP scope — what already exists, what is
> missing, and what OpenForge can copy vs. skip.
> **Compiled:** 2026-11-03
> **Method:** Exa web search (7 queries), direct repo/API fetches (GitHub + Codeberg REST APIs,
> app-store listings, F-Droid, awesome-gitea, forum.gitea.com, Reddit, Hacker News), and
> maintainer wiki/issue triage. All star/commit/last-push figures were read from the GitHub/Codeberg
> REST APIs on the compile date unless noted.
>
> **Caveats:** (1) Many iOS "apps" in this space ship as closed binaries; their feature claims come
> from the vendor's own App Store listing / website, not from source inspection. (2) A few repos
> were renamed/moved (GitNex, GitTouch) — both the canonical and mirror URLs are given. (3) Star
> counts drift; treat them as point-in-time.

---

## Executive Summary (read this first)

1. **There is no official Gitea or Forgejo mobile app.** The `forgejo` Codeberg org (20 repos, 33
   members) contains the forge, docs, website, runner, helm chart, governance — and **zero** mobile
   clients. Gitea's own `awesome-gitea` curated list is the authoritative "what exists" registry, and
   its **Active → Mobile** section lists only **two** apps: `GitNex` (Android) and `gyokuro` (iOS).
   Everything else is third-party, indie, and mostly unaffiliated.

2. **The single most-starred Gitea-capable app is effectively dead.** `git-touch` / GitTouch
   (`github.com/pd4d10/git-touch`, **1,707★**, Apache-2.0, Flutter, multi-forge) has had **no code
   commit since 2022-10-30** — ~4 years stale as of this writing — yet it still surfaces as the
   default answer to "what mobile client works with Gitea?" in 2024–2025 Reddit threads. Users are
   unknowingly installing a stale app. This is the single biggest opening in the market.

3. **GitNex is the only truly maintained Android client** (and the only dedicated Gitea/Forgejo app
   on F-Droid). It is broad (150+ listed features, multi-account, offline cache, self-signed certs,
   wiki, code editor, 11 languages, biometric lock) but **shallow on the exact things a reviewer
   needs on the go**: it cannot submit a PR review (approve/request changes), cannot comment on a
   specific diff line, has no side-by-side diff, no tablet/two-pane layout, and **no CI job-log
   streaming** (it lists workflows/runners/variables only). Those gaps are precisely what the newer
   iOS apps (Fjord Mobile, GitBoba, gyokuro) built as their differentiators.

4. **iOS is crowded with new (2026) native clients** competing hard on "PR review + Actions" —
   Fjord Mobile, ForgeGo, Forji, GitBoba, gyokuro, iTea, TeaGo, Cup for Gitea, Minos, and an
   open-source GiteaClient. None has cracked **self-hosted push notifications without a vendor
   backend** (each bolts on Fjord Account / ntfy / Gotify / a self-hosted webhook relay). WebAuthn /
   passkey auth is absent everywhere.

5. **Android is nearly empty.** After GitNex, the field is: one big closed pair (Fjord/ForgeGo,
   also on iOS), one Flutter cross-platform newcomer (igitea), a beta (TeaGo), a dead flag (Groid,
   anvil), and the abandoned GitTouch. **OpenForge has a wide-open lane on Android if it targets
   the "real PR review + CI logs + self-hosted push" gap that GitNex leaves open.**

6. **Monetization is converging on "free core + one-time Pro / small subscription."** Nobody is
   paywalling basic browsing. Gating that triggers 1-star reviews. The differentiators being paid
   for are: PR review queue, batch/line comments, Actions run-follow, stylus/on-device-AI review,
   and (for Fjord) managed hosting.

---

## 1. Android Clients Inventory

### 1.1 GitNex — the reference Android client (MAINTAINED)

- **Name:** GitNex for Forgejo and Gitea
- **Maintainer / primary repo:** `codeberg.org/gitnex/GitNex` (canonical)
- **Mirror:** `github.com/gitnex-org/gitnex` (issues disabled on mirror)
- **Website:** https://gitnex.com
- **Maintainer:** M M Arif (`mmarif`), with visible collaborators `6543`, `opyale`, and a
  `gitnexbot` (Crowdin translations + CI). Backed by a Patreon (`patreon.com/mmarif`) and a Discord.
- **Last commit:** 2026-10-13 (translation refresh); release **15.0.0** on 2026-09-17
- **Stars:** 938 (Codeberg) / 133 (GitHub mirror); 44 watchers (Codeberg)
- **Forks:** 51 (Codeberg) / 6 (mirror)
- **Open issues / PRs:** 42 open issues / 3 PRs (Codeberg); 967 closed issues total
- **License:** GPL-3.0-only
- **UI tech:** Java 100% (Gradle), Material 3 "expressive", dynamic colors on Android 12+
- **Activity / maintainer count:** **Active.** 595+ PRs merged, 76 releases, 1,163 commits on
  `main`, Crowdin-synced in 20+ languages. Real multi-person maintenance (assignees: mmarif, 6543,
  opyale) + a bot.
- **Downloads:** Google Play **1K+**, F-Droid (main + IzzyOnDroid), APK releases. Play Store
  edition is **paid $5.99**; F-Droid/APK edition is free.
- **Rating:** **4.7** (Play, 39 reviews)
- **Distribution:** F-Droid (`org.mian.gitnex`), IzzyOnDroid, Google Play (`org.mian.gitnex.pro`),
  direct APK from releases / a Nextcloud (cloud.swatian.com).
- **Auth:** PAT (token) login; HTTP Basic Auth behind reverse proxies (12.0.0+); **self-signed
  cert support**; multi-account (unlimited accounts across instances). No OAuth, no WebAuthn.
- **Notable capabilities:** file/dir browser + viewer + editor, create file/issue/PR/wiki/
  milestone/release/label, merge (merge / no-ff / rebase / squash), **diff view for PR files on
  public repos**, notifications (unified across accounts in 15.0.0), repository commits, wiki
  create/edit/delete, SSH key management, import/export app data, contribution heatmap, dashboard.
- **CI/Actions:** lists workflows, runners, variables (Gitea 1.24+) and Forgejo runners/tasks/
  variables; **does NOT stream job logs or jump-to-failure** (long-standing open feature request,
  issue #1654 with 11 comments).
- **Key gaps (from its own issue tracker + Fjord's code-level comparison):**
  - No way to **submit a PR review** (approve / request changes) — issue confirmed by a third party
    reading the 15.0.0 source.
  - **No comment on a diff line** — comments attach to the PR, not a line.
  - **Unified diff only** (no side-by-side).
  - **No tablet / two-pane / foldable layout** in 15.0.0.
  - **No HTTP/SOCKS proxy support** (#1264) and **no mTLS / client certs** (#1399).
  - Markdown rendering gaps: `<details>` (#1662), links inside admonitions (#1631), code-block
    syntax highlighting in rendered MD (#1535).
  - Diff of PR files is **limited to public repositories**.
  - Archived-repo sorting/visibility (#1425, #1570), edit history (#1441, API-dependency).

### 1.2 Fjord Mobile (Android) — the "GitHub Mobile for your forge" (MAINTAINED, closed)

- **Name:** Fjord Mobile for Android
- **Site:** https://mobile.fjord.sh/android
- **Maintainer:** Stephen (swrs); single-indie, commercial. **Not open source** (source not published).
- **Last activity:** v**1.6.0** announced 2026-11-02 on forum.gitea.com.
- **Stars:** N/A (no public repo).
- **UI tech:** native (the iOS build is SwiftUI + Swift 6 strict concurrency + a typed `ForgejoKit`
  generated from the Forgejo API contract; Android is released separately as a native build).
- **Min OS / server:** Android 8.0+; **Forgejo 7.0+** (or Gitea). Actions needs Forgejo 15+, run
  logs / cancel / artifacts need 16+.
- **Auth:** PAT to any server (no Fjord account required); optional **Fjord Account** (email +
  password + TOTP) adds push, notification actions, background Live Activity, one Home across
  instances. Tokens encrypted in Android Keystore. **Self-signed cert** after fingerprint check.
- **Capabilities (the deepest in the field):** review queue (needs-you), batch line comments,
  approve/request-changes, merge (commit/rebase/squash/fast-forward) + admin override past branch
  protection, side-by-side diff on wide screens, image/binary diffs, Actions shelf (running/queued/
  failed), **job log with find/timestamps/jump-to-failure**, dispatch a workflow, re-run a job
  (Forgejo 17+), 5 widgets (build status, open PRs, review requests, contribution graph, runner
  queue), offline review outbox, six languages → **11 languages** total.
- **Paid tiers:** **Mobile Pro** (one-time, Google Play) — review queue walk-by-voice, "Needs You"
  home/widget, **on-device Gemini Nano review assistant**, follow/cancel a run from a notification,
  range-line comments (Forgejo 16+), stylus review (Android 14+), >3 offline queued reviews.
- **Notable differentiators:** it is the only client with an on-device LLM review draft and stylus
  ink review. It also sells managed single-tenant Forgejo hosting ($49/mo team) as an upsell.
- **Weaknesses:** closed source; push + most notification actions gated behind a Fjord Account;
  the Android Pro covers *fewer* features than the iOS Pro (explicitly stated by the vendor).

### 1.3 ForgeGo (Android) — closed, Forgejo-16+ only (MAINTAINED, closed)

- **Name:** ForgeGo — "Forgejo in your pocket"
- **Site:** https://forgego.dev
- **Maintainer:** DevXY (same company behind Codefloe). **Not open source** (a Reddit user flagged
  "does not look open source … not sure I would trust it").
- **Version / min OS:** v**0.12.0**, Android 7.0+. **Forgejo 16+ only** (will not target older
  Gitea/Forgejo).
- **Auth:** direct to servers, tokens in Keystore. Multiple accounts/servers; unified cross-server
  view is a **Pro** feature.
- **Capabilities:** repo/file/branch browsing, rendered Markdown (tables + syntax), CI checks on
  PRs, unified diffs + changed-file nav, reviews/comments/commit activity, Actions + external CI
  status, whole-forge search (repos/issues/PRs/people), offline cache, deep links, background
  notifications (Pro), "send to agent" (hands an issue/PR to a t3code agent on your server).
- **Paid tier (Pro):** unified servers+accounts, background notifications, unlimited favourites
  (free = 3/kind/instance), full search history (free = 5), send-to-agent.
- **Weaknesses:** closed; Forgejo-16+ only (excludes Gitea users and older Forgejo); no public
  repo to verify claims; job-log depth "not documented."

### 1.4 igitea — ambitious new Flutter cross-platform client (MAINTAINED, open, MIT)

- **Name:** iGitea ("gitea in a single hand")
- **Repo:** `github.com/igitea/igitea`
- **Last commit (pushed_at):** 2026-10-27; created 2026-04-23.
- **Stars:** 10; forks 2; open issues 2.
- **License:** MIT.
- **UI tech:** Flutter/Dart. **Cross-platform: Android, iOS, macOS, Linux, Windows, Web.**
- **Architecture:** "Clean Architecture + Repository Pattern", 120+ data models auto-generated from
  the Gitea OpenAPI spec, 49+ domain use cases with an `Either<Failure, T>` result pattern, **303
  tests passing**, `flutter analyze` clean. Forui (shadcn-style) design system, teal brand,
  light/dark, reduced-motion.
- **Auth:** username/password (primary), **access token (secondary)**, **OAuth2** (browser auth →
  callback code → token exchange), session persistence/auto-restore. This is one of the very few
  with real OAuth2 + password login (table stakes beyond PAT).
- **Status:** young but genuinely active; explicitly crowdsourcing help ("PRs welcome … we are
  desperately waiting"). Not yet on any store (build-from-source).
- **Why it matters:** the only serious open, cross-platform, OAuth-capable client; a candidate to
  fork or learn from, and a signal that the cross-platform (Flutter) lane is being re-entered now
  that GitTouch is dead.

### 1.5 TeaGo (Android) — closed beta (MAINTAINED, closed, iOS+Android)

- **Name:** TeaGo — "Native Gitea & Forgejo Mobile App"
- **Site:** https://teago.artsvit.com
- **Maintainer:** Artem Svitelskyi (artsvit). **Closed source.**
- **Status:** on the App Store; **Android closed beta** open via a Google Play test track (email
  application form).
- **Auth:** PAT; tokens in Android Keystore / Apple Keychain; **no intermediary relay**.
- **Self-hosting story (its pitch):** explicitly "Tested with Tailscale, WireGuard, Cloudflare
  Tunnels, Local LAN, Self-Signed SSL, HTTPS" — i.e., built for the private-network self-hoster.
- **Capabilities:** browse repos/commits/releases, review PRs with full diffs, manage issues, view
  CI/CD actions, activity/contribution heatmaps (1yr/1mo/2wk), local background notifications for
  PRs/mentions/CI runs.
- **Monetization:** free to start; **one-time lifetime Pro** (no subscription) unlocks "unrestricted
  repository access."
- **Weaknesses:** closed; Android still beta; small install base.

### 1.6 git-touch / GitTouch — the abandoned flag-bearer (ABANDONED ~4 years)

- **Name:** GitTouch (Git Touch)
- **Repo:** `github.com/pd4d10/git-touch` (the active community fork; original `github.com/git-touch/git-touch`)
- **Last code commit:** **2022-10-30** ("style: dart fix apply"). The repo `pushed_at` (2024-07-28)
  is a metadata/fork sync, not new code. **Effectively 4 years with zero code change.**
- **Stars:** **1,707** (the most of any Gitea-capable mobile app); forks 157; **open issues 89**;
  watchers 1,707; subscribers 62.
- **License:** Apache-2.0.
- **UI tech:** Flutter/Dart.
- **Multi-forge:** GitHub, GitLab, Bitbucket, Gitea, Gitee (码云). Gitea support was "✅ done" in its
  own README compatibility matrix, with custom-domain support.
- **Distribution:** Apple App Store + Google Play + APK from releases.
- **Why it matters / the risk it signals:** it is still the app people recommend in 2024–2025
  threads ("GitTouch: client for self-hosted Git servers, works great with Gitea"), **but it is
  stale** — unpatched dependencies, no Forgejo awareness, no modern API features, 89 open issues.
  A team building a new client inherits a *dissatisfied, under-served* audience of 1,700+ stargazers.

### 1.7 Groid — early / abandoned Kotlin client (ABANDONED)

- **Repo:** `github.com/hiifong/Groid`
- **Last commit (pushed_at):** 2024-05-12; created 2023-04-21.
- **Stars:** 1; forks 0; open issues 0; watchers 1.
- **License:** GPL-3.0. **UI tech:** Kotlin.
- **Status:** a thin early "Gitea client for Android" that never gained traction; treat as a dead
  end (included for completeness of the "everything public" inventory).

### 1.8 anvil — Expo/React-Native Forgejo client skeleton (NEW, likely stalled)

- **Repo:** `github.com/THEROCKSSS/anvil`
- **Description:** "a mobile client for Forgejo. Android and iOS from one Expo codebase. MIT,
  unofficial."
- **Last commit (pushed_at):** 2026-08-04 (a single push, same day as creation).
- **Stars:** 1; forks 0; open issues 1. **License:** MIT. **UI tech:** TypeScript / Expo / React
  Native.
- **Status:** a one-commit skeleton — interesting as a data point that the React-Native/Expo
  lane is being probed, but no real progress.

### 1.9 Mobil-Gitea — the historical ancestor (ARCHIVED/legacy)

- **Repo:** `gitea.com/pij/Mobil-Gitea`
- **What it is:** the original GitNex-era "Android client for Gitea" (GPLv3) predating the
  Forgejo rebrand; features were minimal (repos/orgs/issues lists, create repo/org). Useful only as
  the origin story: GitNex grew out of this 2019 codebase (first posted to the Gitea forum as a
  "Android native application" idea in **Jan 2019**, issue `go-gitea/gitea#5689`).

### 1.10 Android summary table

| App | Repo | Lang/UI | License | Stars | Last commit | Activity | Store | Rating |
|---|---|---|---|---|---|---|---|---|
| **GitNex** | codeberg.org/gitnex/GitNex | Java, native M3 | GPL-3.0 | 938 (CB) | 2026-10-13 | **Active, multi-maintainer** | F-Droid, Play ($5.99), Izzy, APK | 4.7 (39) |
| **Fjord Mobile** | (closed) | native | proprietary | — | 2026-11-02 (v1.6.0) | Active, indie | Play (free + Pro) | n/a |
| **ForgeGo** | (closed, DevXY) | native | proprietary | — | v0.12.0 | Active, company | Play (free + Pro) | n/a |
| **TeaGo** | (closed, artsvit) | native | proprietary | — | Android beta | Active, indie | Play (beta, free+Pro) | n/a |
| **igitea** | github.com/igitea/igitea | Flutter | MIT | 10 | 2026-10-27 | Active, young | none (source) | n/a |
| **git-touch** | github.com/pd4d10/git-touch | Flutter | Apache-2.0 | **1707** | **2022-10-30** | **ABANDONED ~4y** | App Store, Play, APK | n/a |
| **Groid** | github.com/hiifong/Groid | Kotlin | GPL-3.0 | 1 | 2024-05-12 | Abandoned | none | n/a |
| **anvil** | github.com/THEROCKSSS/anvil | Expo/RN | MIT | 1 | 2026-08-04 | Skeleton | none | n/a |
| **Mobil-Gitea** | gitea.com/pij/Mobil-Gitea | Java | GPL-3.0 | — | ~2019 | Legacy | none | n/a |

---

## 2. iOS Clients Inventory

iOS is where 2026's activity concentrated. Nearly all are SwiftUI native, token-auth, "talks only to
your server," Keychain-stored, zero-analytics — and most are new.

### 2.1 Fjord Mobile (iOS/iPadOS) — the flagship (MAINTAINED, closed)

- **Site / docs:** https://docs.fjord.sh/mobile/ios , https://mobile.fjord.sh/mobile
- **Maintainer:** Stephen (swrs). **Closed source.**
- **Version / min OS:** v1.6.0; **iOS/iPadOS 17.4+** (server: Forgejo 7.0+ or Gitea).
- **Architecture:** SwiftUI + Swift 6 strict concurrency + typed `ForgejoKit` generated from the
  shared Forgejo API contract ("the app only ever calls endpoints the server actually exposes").
  Universal iPhone/iPad binary; iPad gets a true multi-column **review workstation**.
- **Auth:** PAT to any server (free, no Fjord account); Fjord Account (email+password+TOTP) optional.
  **Self-signed cert** after fingerprint check.
- **PR review (deepest in the field):** review queue, batch line comments, approve/request changes,
  merge (commit/rebase/squash/FF) + admin override, side-by-side diffs (iPad/wide), image/binary
  diffs, generated-file collapsing, resolve review threads (partly — Forgejo has no API route, so
  resolving still happens on the web), **merge-when-checks-succeed scheduling**, **stacked PRs**
  (read-only, made with the `fj` CLI), private notes stored in a private repo on your forge.
- **Actions/CI:** workflow runs (Forgejo 15+), **streaming job logs + open-at-failure** (16+), cancel
  a run, download artifacts, dispatch a workflow (incl. from Shortcuts), download all run logs as a
  zip.
- **iOS-only power features:** Siri/Shortcuts, **Live Activity** (for a running workflow), Spotlight,
  Handoff, Home-Screen quick actions, six widgets, app lock (Face/Touch ID), full VoiceOver,
  Dynamic Type, Reduce Motion, Increase Contrast, Differentiate Without Color.
- **Offline:** read from on-device cache; **write offline** — comments/replies/review drafts queue
  and send when connected (free = up to 3 queued reviews; >3 is Mobile Pro).
- **Languages:** **11** (EN, DE, ES, FR, HI, IT, JA, KO, PT-BR, RU, ZH-Hans).
- **Monetization:** free core (browse, review, merge, Actions, push all free); **Mobile Pro**
  one-time; Fjord Account adds push/actions; also sells managed Forgejo hosting.
- **Gaps:** closed source; no commit comments / full code search (API doesn't expose them, so the
  app mirrors the server's limits); Android Pro is a reduced feature set.

### 2.2 ForgeGo (iOS) — closed, Forgejo-16+ only (MAINTAINED, closed)

- **Site:** https://forgego.dev
- **Maintainer:** DevXY. **Closed source.**
- **Version / min OS:** v0.16.0; **iOS 15+**. Forgejo 16+ only.
- **Auth:** direct to servers, Keystore; multiple accounts (unified view = Pro).
- **Capabilities:** repo/file/branch browsing, Markdown (tables+syntax), CI checks, unified diffs +
  changed-file nav, approve/request changes (since 0.16.0), **comments on diff lines** (since 0.16.0),
  merge, whole-forge search, offline cache, deep links.
- **Pro tier:** unified servers+accounts, device-polled background notifications, unlimited
  favourites, full search history, send-to-agent.
- **Languages:** 1 (English).
- **Weaknesses:** closed; Forgejo-16+ only; no public repo; Actions is "external CI status on PRs"
  rather than full run log streaming.

### 2.3 Forji — open-source, iPhone-only (MAINTAINED, open, GPLv3)

- **App Store:** `apps.apple.com/.../forji/id6759843639`
- **Maintainer:** Stefan Hausotte (`rockenman1234`). **Open source: GPLv3.**
- **Ratings:** **4.4** (11 ratings). **Min OS:** iOS 26.2+. **iPhone only** (no iPad).
- **Capabilities (from listing):** connect to any Forgejo incl. self-hosted + **self-signed certs**;
  browse repos/files/README with syntax highlighting; create/edit/manage issues (labels, milestones,
  assignees); review PRs with inline diffs; **merge from the app**; notifications; **multiple Forgejo
  accounts** with a merged view; Keychain credential storage; light/dark mode.
- **The 1-star / negative signal (verbatim, App Store, "john grayson 1890", Aug 27):**
  > "Worse than website — Silently fails when there are more than 100 files. You can't read the
  > repo. You need to truncate instead of failing to load ANY files. Even the website correctly does
  > this. Just use the web app and skip this."
  This is a **repo-tree pagination/timeout** bug — a concrete, reproducible failure mode OpenForge
  must avoid (large repos are a core self-host use case).
- **Languages:** 1 (English). **Size:** 16.5 MB.

### 2.4 GitBoba — feature-dense new client, no push (MAINTAINED, source public, no license file)

- **App Store:** `apps.apple.com/.../gitboba/id6767851416` ; **Repo:** `github.com/MiguelAPerez/gitboba`
- **Site / blog:** https://gitboba.app , https://miguelaperez.dev/posts/gitboba/
- **Maintainer:** Miguel A. Perez. **Source public but no license file** (a legal/FOSS gap the vendor
  has not closed — Fjord's comparison flags "public repository with no license file").
- **Ratings:** **4.8** (4 ratings). **Min OS:** iOS 26+. v**1.20.1**.
- **GitHub API facts:** 11★, 8 open issues, created 2026-04-06, pushed 2026-11-02 (very active),
  repo language reports as CSS (the repo holds the marketing site; the app is SwiftUI).
- **Capabilities (broad for its age):** Home feed, notifications inbox, Explore (orgs/teams/webhooks/
  labels), Repos (detail/branches/commits/file tree/PRs/issues), **Actions (live runs, streaming job
  logs, artifact downloads, workflow dispatch, cancel)**, **Demo mode** (sample repos/issues/PRs/
  Actions with no account — a smart onboarding move), **working copies** (keep a repo on-device, edit
  locally, sync & push, resolve conflicts, link a Files folder, one-tap commit → PR), **stacked PRs**
  (organize a stack, bring up to date, merge the next, since 1.20.1), **multi-comment reviews in one
  pass** (since 1.3.0), resolve review threads, Markdown with **Mermaid** diagrams, iPad code browser
  (tabs, Quick Open, file tree beside file), `gitboba://` deep links + share-sheet opening.
- **Auth:** PAT, Keychain, direct connection only; **self-signed cert "not documented."**
- **The explicit architectural trade-off (vendor-stated):** no intermediate server → **"push
  notifications are not supported"** (Apple APNs require a primary server). Local/background
  notifications are the fallback.
- **Monetization:** free for your server's features; optional **Supporter** adds layout options +
  GitBoba-only workflows. "We strive to bring new functionality and provide feature parity with the
  existing backend."

### 2.5 gyokuro — the other "active" app on awesome-gitea (MAINTAINED, closed, IAP)

- **Site:** https://www.gyokuro.app
- **Maintainer:** Sven (Uwe) Hanold (`syscheckin`). **Closed source** ("independent, unofficial").
- **App Store:** `.../gyokuro/id6767816893`. **Rating: 3.0** (1 rating — small sample).
- **Min OS:** iOS 18.0+ (Fjord's comparison cites 17.6+). v3.0 rebuild.
- **Capabilities:** "two surfaces" — **Simple** (calm everyday path) and **Advanced** (milestones,
  Actions, wiki, **packages**, time tracking, administration). Issues (swipe close/reopen, labels,
  milestones, assignees), PRs as **Discussion + Files tabs** with **full diff + syntax highlighting,
  side-by-side on iPad**, and "when merging isn't possible, it tells you why," **orgs/teams/packages**
  from the registry, **Actions** (runs with green/red status, **complete job logs, re-run failed
  jobs**), **full-text code search** (source/issues/PRs/file names/users), releases + tags (create
  with notes, pre-release), contribution heatmap, widgets (lock + home), share images/links into a
  new issue, **read offline per enabled repository**, iPad sidebar + two-column diffs + keyboard
  shortcuts.
- **Auth:** PAT in Keychain; **no cloud/accounts/third-party**; built for homelab — any number of
  servers, **self-signed certs, proxies, internal addresses**; **mTLS / client certs** (the only app
  here advertising it).
- **Push:** **through your own ntfy or Gotify** (self-hosted push relay — again, not vendor push).
- **Accessibility/quality:** pure SwiftUI, "Liquid Glass on iOS 26," dark mode, Dynamic Type,
  VoiceOver, five color themes; EN/DE/ES/FR (4 languages).
- **Monetization (the gating model worth studying):** **Free** = one account, read everything,
  comment, close issues, submit reviews, merge, notifications, browse orgs/teams/packages, both
  surfaces. **Unlimited** (Yearly / Monthly **$1.99** / **one-time $39.99** / $12.99) = unlimited
  accounts, create/edit issues+PRs+milestones+wiki+repos, **code editor that commits directly**,
  instance administration, weekly report/stats, 4 more themes, **push through the relay**. 3-day
  full unlock after install.

### 2.6 iTea — lightweight open, cross-Apple (MAINTAINED, open, MIT)

- **Repo:** `github.com/philippgerard/itea`
- **App Store:** `.../itea-gitea-forgejo-client/id6757265893`
- **Maintainer:** Philipp Gerard. **Open source: MIT.**
- **GitHub facts:** 5★, 1 fork, created 2025-12-27, pushed 2026-09-26, Swift, 0 open issues.
- **Min OS:** iOS 26.0+; **universal: iPhone, iPad, Mac (Catalyst), visionOS**.
- **Capabilities:** browse repos/file trees/commit history, read/create/comment issues, track &
  review PRs, **notifications**, **powerful search** across repos/issues/PRs, **MarkdownUI**
  rendering, **deep links** (open Gitea URLs / PR-creation links directly), dark mode + tinted icons.
- **Auth:** PAT with explicit documented scopes (`read:user`, `read:repository`, `read/write:issue`,
  `read/write:notification`), stored only in Keychain; no iTea backend, no analytics, no third-party
  SDKs.
- **Positioning:** deliberately lightweight (4.2 MB) issues/PR/notifications client for private
  instances.

### 2.7 TeaGo for Gitea (iOS) — closed, self-hoster focused (MAINTAINED, closed, IAP)

- **App Store:** `.../teago-for-gitea/id6805488091` ; TestFlight beta existed at v0.1.0.
- **Maintainer:** Artem Svitelskyi (artsvit). **Closed source.** **Rating: 5.0** (1 rating).
- **Min OS:** iOS 17.0+.
- **Capabilities:** connect to any Gitea instance (PAT), browse repos/README/releases/commits, view
  & search PRs/issues, Markdown, file browsing with syntax highlighting, **create new repos +
  issues**, star repos, dashboard with quick stats, inbox, **local notifications** for PRs/issues/
  releases, **pull-to-refresh**, **smart dual-endpoint fallback** (local URL at home + remote/VPN URL
  on the go), light/dark/system.
- **Self-hosting pitch:** tested with Tailscale/WireGuard/Cloudflare Tunnels/LAN/self-signed SSL.
- **Monetization:** free + **In-App Purchase lifetime** — Single **$5.99**, Family **$11.99**
  (no subscription).

### 2.8 Cup for Gitea — fast-moving read-heavy client (MAINTAINED, closed)

- **App Store:** `.../cup-for-gitea/id6768708389`
- **Maintainer:** Felix Schindler. **Closed source.** **Rating: 3.7** (3 ratings). EN + DE.
- **Min OS:** iOS 18.0+. **Version 8.4.2 (Sep 20)** — a rapid release cadence (8.0.1 Jun 11 → 8.4.2
  Sep 20 ≈ 4 months, ~10 releases).
- **Capabilities:** "Easy to use, native, Gitea client"; **diff view for commits and PRs** (added
  8.2.0), **full iPad support**, **Activities section** revamped with paging, **browse packages**
  across orgs/users/repos, **work times**, pin/unpin issues, all merge options, download archives
  via share sheet, monospaced comment editors, "load more" paging throughout, "view almost everything
  the Gitea API has to offer — even though creating or updating some things isn't possible yet."
- **Auth:** config supports **all URL formats: HTTP, HTTPS, IP addresses, custom ports**; supports
  self-hosted private servers. **"Data Not Collected"** (no data collected).
- **Positioning:** breadth-first *read* client (view nearly everything, write limited) — the inverse
  of the review-focused Fjord/GitBoba.

### 2.9 Minos — PR-review-only, AGPL (MAINTAINED, open, AGPL-3.0)

- **Repo:** `github.com/botelle/minos` ; support site `minos.botelle.org`.
- **App Store:** "Minos PR Inbox."
- **Maintainer:** botelle. **Open source: AGPL-3.0.** (Listed under awesome-gitea "Unmaintained,"
  but the repo was created **2026-07-13** and last pushed **2026-09-22** — the awesome entry is
  stale/incorrect; the project is brand new.)
- **GitHub facts:** 0★, 1 open issue, language reports as Kotlin (the repo also holds the optional
  self-hosted proxy).
- **What it does (narrow by design):** **review and merge PRs from your phone** for Gitea, Forgejo,
  Codeberg, and GitHub, incl. self-hosted on a private LAN. Queue split (needs-your-review / yours /
  all open), **full diffs with per-file paging, CI check results, conversation thread**,
  comment / approve / request changes / **merge (merge/squash/rebase)**, **optional push via a
  webhook relay you host yourself**.
- **Design principle (the trust story):** "talks only to the backend you supply. No middleman
  server, no phone-home — token in the device Keychain, sent only to your own git server."
- **Why it matters:** the purest "PR inbox" wedge — if OpenForge's mobile value prop is "review and
  merge on the go," Minos is the minimal-viable reference and a potential collaboration/partner.

### 2.10 GiteaClient — open, build-from-source, no App Store (NEW, open)

- **Source:** announced on r/Gitea by u/Hairy-Judge7758 (2026-07-11): "I built a native iOS client
  for Gitea (open source, SwiftUI)."
- **Capabilities:** browse repos/files/READMEs/releases, view issues + PRs, notifications inbox
  (All/Unread), profile (followers/following/stars), explore public repos, token in Keychain,
  **iOS 16+, no third-party dependencies.**
- **Status:** **build-from-source only** (no Apple Developer account yet) — `xcodegen`-based.
- **The critical 1-star-equivalent complaint (verbatim, r/Gitea, u/cptclaudiu, downvoted −7 but
  representative of a real bar):**
  > "it's honestly disappointing to see an iOS app in 2026 not using native SwiftUI materials
  > properly. The UI looks like something from 2015 and it really does not attract."
  This is the **design-quality** failure mode: functionally fine, visually dated. A self-host
  audience increasingly expects a "Linear/2025" look; a dated UI is a churn driver even when the
  app works.

### 2.11 iOS summary table

| App | Repo / store | UI | License | Ratings | Min OS | Last activity | Open? |
|---|---|---|---|---|---|---|---|
| **Fjord Mobile** | (closed) | SwiftUI, Swift 6 | proprietary | n/a | iOS 17.4+ | v1.6.0 2026-11-02 | No |
| **ForgeGo** | (closed, DevXY) | native | proprietary | n/a | iOS 15+ | v0.16.0 | No |
| **Forji** | App Store (Hausotte) | SwiftUI | **GPLv3** | 4.4 (11) | iOS 26.2+ | active | Yes |
| **GitBoba** | github.com/MiguelAPerez/gitboba | SwiftUI | none published | 4.8 (4) | iOS 26+ | pushed 2026-11-02 | source yes, licensed no |
| **gyokuro** | (closed, Hanold) | SwiftUI | proprietary | 3.0 (1) | iOS 18+ | v3.0 | No |
| **iTea** | github.com/philippgerard/itea | SwiftUI | **MIT** | n/a | iOS 26+ | pushed 2026-09-26 | Yes |
| **TeaGo** | App Store (artsvit) | native | proprietary | 5.0 (1) | iOS 17+ | active | No |
| **Cup for Gitea** | App Store (Schindler) | native | proprietary | 3.7 (3) | iOS 18+ | v8.4.2 Sep 20 | No |
| **Minos** | github.com/botelle/minos | (Swift app + proxy) | **AGPL-3.0** | n/a | — | pushed 2026-09-22 | Yes |
| **GiteaClient** | (r/Gitea, source) | SwiftUI | open | n/a | iOS 16+ | Jul 2026 | Yes (source only) |

---

## 3. Feature Matrix

Legend: **✓** supported · **◐** partial/limited · **✗** not supported / absent · **—** not
documented (closed source, unknown). "Push" = real push to the phone (APNs/FCM/UnifiedPush) vs.
local/poll. Server-version notes matter for Actions.

### 3.1 Authentication & connectivity

| App | PAT | OAuth2 | WebAuthn/passkey | Self-signed cert | mTLS/client cert | Proxy (HTTP/SOCKS) | Multi-account |
|---|---|---|---|---|---|---|---|
| GitNex | ✓ | ✗ | ✗ | ✓ | ✗ (#1399) | ✗ (#1264) | ✓ unlimited |
| Fjord Mobile | ✓ | ✗ | ✗ | ✓ (fingerprint) | ✗ | — | ✓ |
| ForgeGo | ✓ | — | ✗ | — | — | — | ✓ |
| Forji | ✓ | ✗ | ✗ | ✓ | ✗ | — | ✓ |
| GitBoba | ✓ | ✗ | ✗ | — | ✗ | ✗ | ✓ (Gitea+Forgejo) |
| gyokuro | ✓ | ✗ | ✗ | ✓ | **✓** | ◐ (proxies advertised) | ✓ |
| iTea | ✓ | ✗ | ✗ | — | ✗ | — | — (single token) |
| TeaGo | ✓ | ✗ | ✗ | ✓ | ✗ | — | ◐ (dual-endpoint) |
| Cup for Gitea | ✓ | ✗ | ✗ | ✓ (IP/custom port) | ✗ | — | — |
| Minos | ✓ | ✗ | ✗ | ✓ (LAN) | ✗ | — | — (single) |
| igitea | ✓ | **✓** | ✗ | — | — | — | ◐ |
| git-touch | ✓ | ◐ | ✗ | — | — | — | ✓ |

> **Reading:** **No app supports WebAuthn/passkey** — a genuine whitespace. OAuth2 exists only in
> the young Flutter client (igitea). Self-signed certs are near-universal (table stakes for
> self-hosters); mTLS is unique to gyokuro; proxy support is essentially absent everywhere.

### 3.2 Core features

| App | Repos | Orgs | Users | File tree | Blame | Raw | Syntax highlight | Code search |
|---|---|---|---|---|---|---|---|---|
| GitNex | ✓ | ✓ | ✓ (explore) | ✓ | ✗ | ◐ (download) | ✓ | ◐ (files, in-file) |
| Fjord Mobile | ✓ | ✓ | — | ✓ | ✗ | — | ✓ | ✗ (API lacks) |
| ForgeGo | ✓ | ✓ | ◐ (search people) | ✓ | ✗ | — | ✓ | ✓ (whole-forge) |
| Forji | ✓ | ✓ | — | ✓ (bug >100 files) | ✗ | — | ✓ | — |
| GitBoba | ✓ | ✓ | — | ✓ (iPad browser) | ✗ | — | ✓ | ◐ |
| gyokuro | ✓ | ✓ | ◐ | ✓ | ✗ | — | ✓ | **✓ full-text** |
| iTea | ✓ | — | — | ✓ | ✗ | — | — | ✓ (repos/issues/PRs) |
| TeaGo | ✓ | — | — | ✓ | ✗ | — | ✓ | ✓ (instance-wide) |
| Cup for Gitea | ✓ | ✓ | ✓ | ✓ | ✗ | — | — | ◐ (search w/ paging) |
| Minos | ◐ (PR-centric) | — | — | ✗ | ✗ | — | — | ✗ |
| igitea | ✓ | ✓ | — | ✓ | ✗ | — | ◐ | ◐ |
| git-touch | ✓ | ✓ | ✓ | ✓ | ✗ | — | ◐ | ◐ |

> **Reading:** **No app implements git `blame`** — another whitespace (the API can do it; nobody
> has shipped it). Full-text **code search** is rare (only gyokuro strongly, ForgeGo/TeaGo/iTea
> partially). This is a differentiator lane.

### 3.3 Issues & Pull Requests

| App | Issue list | Create | Comment | Label | Milestone | Assign | PR list | PR create | Review submit (approve/request) | Diff-line comment | Diff view | Side-by-side | Merge (all methods) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GitNex | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** | **✗** | ✓ (public only) | ✗ | ✓ |
| Fjord Mobile | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (ranges=Pro) | ✓ | ✓ (wide) | ✓ |
| ForgeGo | ✓ | ◐ | ✓ | — | — | — | ✓ | ◐ | ✓ (0.16.0) | ✓ (0.16.0) | ✓ | — | ✓ |
| Forji | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ◐ (review inline) | ✓ | ✓ | ✗ | ✓ |
| GitBoba | ✓ | — | ✓ | — | — | — | ✓ | — | ✓ | ✓ (batch 1.3.0) | ✓ | — | ✓ (admin override) |
| gyokuro | ✓ | ✓ (Unlimited) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (Unlimited) | ✓ | ✓ | ✓ | ✓ (iPad) | ✓ (explains blockers) |
| iTea | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | ◐ | ◐ | — | — | — | ◐ |
| TeaGo | ✓ | ✓ | ✓ | ◐ | — | ✓ | ✓ | — | ◐ | — | ✓ | — | ◐ |
| Cup for Gitea | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ◐ | ◐ | — | ✓ (commits+PRs) | — | ✓ (all options) |
| Minos | ◐ | — | ✓ | — | — | — | ✓ | — | ✓ (its core) | ◐ | ✓ (per-file paging) | — | ✓ (merge/squash/rebase) |
| igitea | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ✓ | ◐ | ◐ | — | ◐ | — | ◐ |
| git-touch | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | — | ✓ |

> **Reading — the single most important row in this report:** the **PR review loop**
> (approve/request-changes + comment-on-a-line) is **table stakes in 2026 but still missing in the
> reference Android client (GitNex)** and only partial in several others. It is *the* gap OpenForge
> should own on Android. Side-by-side diff is also rare (Fjord wide-screens, gyokuro iPad).

### 3.4 Releases, Wiki, Notifications, Offline, theming

| App | Releases list | Download assets | Wiki list | Wiki edit | In-app notifs | Push (vendor-free) | Offline cache | Offline write | Dark mode | Markdown render |
|---|---|---|---|---|---|---|---|---|---|---|
| GitNex | ✓ | ✓ (source) | ✓ | ✓ | ✓ | ✗ (in-app poll) | ✓ (partial) | ✗ | ✓ (themes) | ◐ (gaps: `<details>`, admonition links) |
| Fjord Mobile | ✓ | ✓ | — | — | ✓ | ◐ (Fjord Account) | ✓ (14d) | **✓ (queued)** | ✓ | ✓ (Mermaid) |
| ForgeGo | ✓ | — | — | — | ✓ | ◐ (Pro poll) | ✓ | — | ✓ | ✓ (tables) |
| Forji | ✓ | — | — | — | ✓ | ✗ | ◐ (persistent) | ✗ | ✓ | ✓ |
| GitBoba | ✓ | ✓ (artifacts) | — | — | ✓ | **✗ (no APNs)** | ◐ | — | ✓ | ✓ (Mermaid, callouts) |
| gyokuro | ✓ (create) | ✓ | ✓ | ✓ (Unlimited) | ✓ | ◐ (ntfy/Gotify) | ✓ (per-repo) | — | ✓ | ✓ |
| iTea | ◐ | — | — | — | ✓ | ✗ | ◐ | ✗ | ✓ | ✓ (MarkdownUI) |
| TeaGo | ✓ | — | — | — | ✓ (local) | ◐ (local bg) | ◐ | ✗ | ✓ | ✓ |
| Cup for Gitea | ✓ | ✓ (archives) | — | — | ✓ | ✗ | ◐ | ✗ | ✓ | ◐ |
| Minos | — | — | — | — | ✓ | ◐ (webhook relay) | ✗ | ✗ | ◐ | ✓ |
| igitea | ◐ | — | — | — | ◐ | — | ◐ | ✗ | ✓ | ✓ |
| git-touch | ✓ | ◐ | — | — | ◐ | ✗ | ◐ | ✗ | ✓ | ◐ |

> **Reading:** **Self-hosted push without a vendor backend is unsolved.** Every "push" option is
> either (a) a vendor account (Fjord), (b) a Pro-poll (ForgeGo), (c) a self-hosted relay (gyokuro
> ntfy/Gotify, Minos webhook), or (d) local-only (GitBoba, TeaGo, Cup). **UnifiedPush** is adopted
> by none. Offline *write* (queue-and-send) is unique to Fjord.

### 3.5 Actions/CI, Packages, other

| App | Workflow runs | View job logs | Open-at-failure | Cancel run | Dispatch workflow | Download artifacts | Packages list | Widgets |
|---|---|---|---|---|---|---|---|---|
| GitNex | ◐ (Forgejo runs; Gitea list only) | **✗** | ✗ | ✗ | ✗ | ✗ | — | ✗ |
| Fjord Mobile | ✓ (FJ 15+) | ✓ (16+) | ✓ (16+) | ✓ (16+) | ✓ | ✓ (16+) | — | **✓ (6)** |
| ForgeGo | ◐ (CI status on PR) | — | — | — | — | — | — | — |
| Forji | — | — | — | — | — | — | — | — |
| GitBoba | ✓ (live) | ✓ (streaming) | — | ✓ (cancel) | ✓ (incl. Shortcuts) | ✓ | — | ✓ |
| gyokuro | ✓ | ✓ (full) | — | ◐ (re-run failed) | — | — | **✓** | ✓ |
| iTea | — | — | — | — | — | — | — | — |
| TeaGo | ◐ (CI/CD view) | — | — | — | — | — | — | — |
| Cup for Gitea | ✓ | — | — | — | — | — | **✓** | — |
| Minos | ◐ (checks on PR) | — | — | — | — | — | — | — |
| igitea | — | — | — | — | — | — | — | — |
| git-touch | — | — | — | — | — | — | — | — |

> **Reading:** CI log streaming + open-at-failure + cancel + dispatch + artifacts is the
> **Fjord/GitBoba/gyokuro** club. GitNex (the main Android app) is far behind here. Packages
> browsing is a gyokuro/Cup differentiator. Home/lock-screen **widgets** are a Fjord/GitBoba/gyokuro
> feature and are a strong "always-on-top-of-your-forge" retention hook that GitNex lacks.

---

## 4. Review Articles & Community Discussions (2023+)

> These are the qualitative sources that explain *what is broken* and *what users actually want*.
> Dates and URLs are captured for citation.

### 4.1 Gitea official forum — "App for Android?" (long-running, 2018–2024)
- **URL:** https://forum.gitea.com/t/app-for-android/302
- **Key facts:** Open since 2018. Gitea maintainers (e.g., @lunny, @techknowlogick) confirmed **there
  is no official app**; the guidance has always been "use the mobile-responsive site / the Gitea API."
  By **May 2024** the community answer is firmly **GitNex** (user @hwhsu1231 recommended it). The
  thread's existence for 6+ years = a structural, unmet demand that no official answer resolved.

### 4.2 Gitea forum — "iOS client / inbox for reviewing/approving PRs" (2026-08-05)
- **URL:** https://forum.gitea.com/t/ios-client-inbox-for-reviewing-approving-prs/12356
- **Key fact:** A developer (@botelle) explicitly built **Minos** because "I kept wanting to review
  and merge PRs away from my desk, with **no good mobile option**." This is direct, dated confirmation
  that *the PR-review-in-a-pocket* use case was unserved until 2026 — and that the wedge to enter
  with is the review queue, not the file browser.

### 4.3 Gitea forum — "Fjord Mobile: a native Gitea client for iOS and Android" (2026-11-02)
- **URL:** https://forum.gitea.com/t/fjord-mobile-a-native-gitea-client-for-ios-and-android/12538
- **Key fact:** Vendor self-promo for v1.6.0, but useful as a *feature-baseline snapshot*: PR rows
  lead with next action (Fix CI / Resolve conflicts / Review requested / Ready to merge), one-tap
  approve from a review queue, side-by-side on wider screens. The competitive bar is now explicitly
  "action-first" lists, not just "lists of things."

### 4.4 Reddit — r/selfhosted "What are some cool mobile apps to connect to your self hosted services?" (2025-05-10, 102 pts)
- **URL:** https://www.reddit.com/r/selfhosted/comments/1kiyabo/...
- **Key fact:** A 102-point thread of self-hosters sharing their companion apps. The Gitea answer is
  **"GitTouch: client for self-hosted Git servers, works great with Gitea"** — i.e., in May 2025 the
  community still pointed to the **4-years-stale** GitTouch. A real information gap: the "best"
  recommendation is dead, and nobody in-thread flags it.

### 4.5 Reddit — r/forgejo "Has anyone tried the Forgego app" (2026-09-24)
- **URL:** https://www.reddit.com/r/forgejo/comments/1wp7cgr/...
- **Key complaints (verbatim):**
  - "I can't see where to download it" (distribution/visibility friction).
  - **"That does not look open source, unless I am missing something. Not sure I would trust it."**
    → **Trust is a first-class purchase blocker** for the self-host audience; closed-source clients
    face active skepticism even when feature-rich.
  - Top-voted real alternative: "I use GitNex from F-droid" and "Just using PWA. Works great."
    → A meaningful cohort simply uses the responsive web; beating "just use the PWA" is a real bar.

### 4.6 Reddit — r/forgejo + r/selfhosted "Should a Forgejo iOS client work with every instance?" (2026-07-30)
- **URLs:** https://www.reddit.com/r/forgejo/comments/1vawgei/... and
  https://www.reddit.com/r/selfhosted/comments/1vaw71n/...
- **Key signal (both positive and negative):**
  - Positive (r/forgejo, top comment): **"Every instance please."** The audience *wants* a client
    that works against arbitrary self-hosted instances, not a closed loop around one vendor's service.
  - Negative (r/selfhosted, 10-pt comment from a 20-yr git pro): **"Never once have I had need for a
    mobile client … I couldn't even come up with a use case for git on mobile."** → The category faces
    chronic skepticism that mobile-git is niche. The winning wedge is *asynchronous review/merge +
    CI triage* (things you can't do from a browser quickly), not "browse code on a train."

### 4.7 Reddit — r/Gitea "I built a native iOS client for Gitea (open source, SwiftUI)" (2026-07-11)
- **URL:** https://www.reddit.com/r/Gitea/comments/1utbdsq/...
- **Key complaint (verbatim, u/cptclaudiu):** "disappointing to see an iOS app in 2026 **not using
  native SwiftUI materials properly. The UI looks like something from 2015** and it really does not
  attract." → The self-host audience has a **modern-design bar**; dated UI = churn even with full
  function. (The post was also build-from-source only, which limits reach.)

### 4.8 Reddit — r/selfhosted "Whats your experience with gitea?!" (2025-05-13, 21 pts)
- **URL:** https://www.reddit.com/r/selfhosted/comments/1klfabn/...
- **Key strategic insight (u/ency, 11 pts):** "The only complaint I have is with **third parties
  mostly only offering connections via GitHub, GitLab, or Bitbucket. It's a pain to have to mirror a
  project to GitHub** and then work with it." → **Validation of OpenForge's core thesis:** the pain
  isn't the forge, it's the ecosystem tooling (and by extension, mobile) that only speaks to the big
  three. A first-class mobile client for a self-hosted forge directly attacks this friction.

### 4.9 Reddit — r/selfhosted "Mobile friendly git server?" (2024-04-26)
- **URL:** https://www.reddit.com/r/selfhosted/comments/1cdwe4y/...
- **Key complaint:** "the mobile view of the webpage is so bad." Top answers: "fossil," "Forgejo works
  fine for me," and the blunt "**none of them are really great for mobile, just by nature of git
  itself** … look for a good mobile git client app." → The web responsive UI is universally considered
  poor for code review; a native client is seen as the fix.

### 4.10 Reddit — r/selfhosted "Android app for Gitea" (2019-03-07, origin thread)
- **URL:** https://www.reddit.com/r/selfhosted/comments/ayj17s/...
- **Key fact:** The 2019 origin of GitNex (linked as `gitlab.com/mmarif4u/gitnex`). Even then, a top
  comment: "I can't think of any possible use case where I'd ever need this but upvote anyways."
  → The category's chronic niche-skepticism is *decades* old and persists; the product must prove a
  *concrete* async workflow to win.

### 4.11 Hacker News — "I'm actively working on an alternative Frontend for Forgejo" (2026, ~3 months old)
- **URL:** https://news.ycombinator.com/item?id=48293984
- **Key fact (the most detailed forward-looking feature list in the wild):** a developer building a
  self-hostable FOSS Forgejo frontend says mobile-first is a priority, targeting old/slow devices,
  with: **"diff viewer is fast even on extremely large pull requests, stacked pull request support,
  modern/accessible/theme-able UI, search accessible from anywhere, opinionated keyboard shortcuts
  and a command-K palette from day one."** → Independent corroboration of the exact gaps OpenForge
  should prioritize: *large-PR diff performance, stacked PRs, command palette, global search.*

### 4.12 Hacker News — "Forgejo: A self-hosted lightweight software forge" (2025-01-19, 391 pts)
- **URL:** https://news.ycombinator.com/item?id=42753523
- **Key fact:** Context for *why* the Forgejo audience is receptive to a companion app — Forgejo is
  positioned as true FOSS (GPL, non-profit, no premium upsells), so its users are license-sensitive
  and FOSS-purist. A mobile client that is closed or open-core will be received with suspicion by a
  meaningful slice of this exact audience.

### 4.13 App Store / Play Store reviews (captured verbatim above, §2.3, §2.8, §2.10, §1.1)
- **GitNex (Play, 4.7/39):** mostly positive; requests = "indicator for archived repos / move them
  to bottom," historical "no deep linking for custom instances" (now partially addressed via the
  `gitnex://` scheme + URL Check).
- **Forji (App Store, "john grayson"):** the **>100-file silent-fail** bug (the most severe single
  defect found in the whole survey).
- **Cup for Gitea (App Store, 3.7/3):** positive ("Amazeballs!", "Good App!") but the low score and
  3-review count signal a very small, early user base; release notes confirm write actions are still
  "not possible yet" for several entities.
- **gyokuro (App Store, 3.0/1):** single-review — too small to read; noted for its gating model.
- **GiteaClient (r/Gitea):** the "2015 UI" design complaint.

### 4.14 awesome-gitea (the canonical registry)
- **URL:** https://gitea.com/gitea/awesome-gitea (raw: `.../raw/branch/main/README.md`)
- **Key fact (the "what's officially recognized" baseline):**
  - **Active → Mobile:** `GitNex` (Android, GPL-3.0, Java) and `gyokuro` (iOS) — **only two.**
  - **Unmaintained → Mobile:** `GitTouch` (Flutter, Apache-2.0) and `Minos` (iOS, AGPL-3.0). The
    Minos entry is **stale/incorrect** (the repo is from 2026, actively developed) — the list lags
    the 2026 iOS wave entirely (no Fjord, GitBoba, Forji, iTea, TeaGo, Cup, igitea).
  - **SDKs relevant to building:** `gitea-js` (TS), official Go SDK, `py-gitea`, `java-gitea-api`,
    `tea4j-autodeploy` (Swagger-generated Retrofit/Java lib — literally what GitNex uses), and a Dart
    `gitea` package on pub.dev. **Implication for OpenForge:** reuse a Swagger/OpenAPI-generated
    client layer rather than hand-rolling the REST client.

---

## 5. Missing Features (from 1-star reviews + abandoned/stalled repos)

This section separates (A) features *constantly requested but never built*, from (B) features that
were *started and abandoned*, to give OpenForge a precise "do / avoid / steal" list.

### 5.1 Requested repeatedly, never (or barely) built
1. **PR review submit (approve / request-changes)** — the #1 gap in the reference Android client
   (GitNex). Fjord/GitBoba/gyokuro/Minos/Forji all have it; the most-used Android app still does not.
2. **Comment on a specific diff line** — same story; absent in GitNex, partial elsewhere.
3. **Self-hosted push notifications without a vendor backend** — unsolved. No client does real APNs/
   FCM/UnifiedPush against an arbitrary self-hosted forge without either a vendor account (Fjord), a
   Pro poll (ForgeGo), or a user-run relay (ntfy/Gotify/webhook). **Huge whitespace.**
4. **CI job-log streaming + open-at-failure** — only the newest iOS apps have it; the main Android
   app has none (GitNex issue #1654, 11 comments, still open).
5. **`git blame` in a mobile client** — zero apps. The API supports it; nobody shipped it.
6. **Full-text code search** — only gyokuro (strong) and a few partial. A genuine differentiator.
7. **WebAuthn / passkey authentication** — zero apps. (Gitea/Forgejo support passkeys; no client
   surfaces them.)
8. **HTTP/SOCKS proxy support** — requested in GitNex for 3 years (#1264, since 2023); still open.
9. **Offline *write*** (queue comments/reviews and send later) — only Fjord. Universally missing.
10. **Stacked PR support** — only Fjord (read-only) and GitBoba (1.20.1+); an explicit HN-asked-for
    feature; nearly nobody else.
11. **Widgets / Live Activity / always-on presence** — a retention feature only the premium iOS apps
    (Fjord/GitBoba/gyokuro) have; absent from the Android field entirely.
12. **Side-by-side diff on a phone** — rare; Fjord (wide) and gyokuro (iPad) only.

### 5.2 Started and abandoned / stalled (the "don't repeat this" list)
1. **GitTouch (1,707★)** — the category's most-starred app, **no code since 2022-10-30**, 89 open
   issues, still recommended in 2025. Lesson: a *multi-forge Flutter* client that outlived its
   maintainer. The audience is stranded; a new client should explicitly position against
   "the old app is dead."
2. **Groid (1★)** and **anvil (1★, one commit)** — abandoned Kotlin / Expo skeletons. Lesson: the
   Android lane is full of well-intentioned starts that die; consistent release cadence (see Cup,
   v8.0→8.4 in 4 months) is what converts stars into users.
3. **Mobil-Gitea** — the pre-GitNex ancestor, effectively superseded. Shows the lane's churn:
   the "obvious" app from 2019 did not survive; GitNex had to restart and outlast it.
4. **awesome-gitea staleness** — the canonical registry hasn't absorbed the 2026 iOS wave (no
   Fjord/GitBoba/Forji/iTea/etc.), and mislabels the brand-new Minos as "unmaintained." Lesson: the
   *discovery layer* is broken; OpenForge should seed awesome-gitea + the Gitea forum + Reddit
   early, because "can't find it" is itself a documented complaint (ForgeGo thread).

### 5.3 Concrete defect patterns to explicitly avoid (from 1-star / bug reports)
- **Large-repo tree silent failure** (Forji): any repo with >100 files fails to load with no
  fallback. Must do pagination/truncation with a visible "load more."
- **Dated UI** (GiteaClient): "looks like 2015." Use modern native materials (SwiftUI materials /
  Compose Material 3 expressive) or the audience walks.
- **No push + no explanation** (GitBoba): if you can't do push, *say why* and offer local
  notifications; silent absence reads as a bug.
- **Merge permission edge cases** (GitNex #1658 "Not allowed to merge despite being admin"): handle
  branch-protection / permission errors with clear messaging, not a dead button.
- **Closed-source distrust** (ForgeGo thread): for a FOSS-audience product, **open-source the
  client** (or at minimum publish a reproducible build / license) — trust is a purchase gate.

---

## 6. Monetization

**No client charges for basic repository browsing.** Paywalls are additive, and the pattern that
triggers negative reviews is gating *core* workflow behind a paywall. Observed models:

| App | Free tier | Paid tier | Price | What's gated |
|---|---|---|---|---|
| **GitNex** | Full app (FOSS, F-Droid/APK) | Paid Play edition | **$5.99 one-time** | Nothing functional; the paid edition is a "support development" SKU; F-Droid stays 100% free |
| **Fjord Mobile** | Browse, review, merge, Actions, push | **Mobile Pro** + Fjord Account | Pro = one-time; Account = hosting | Review-queue voice walk, Needs-You widget, on-device Gemini-Nano review, run-follow-from-notification, stylus review, >3 offline reviews; push/actions need a Fjord Account; also sells $49/mo managed hosting |
| **ForgeGo** | Basic single-account | **Pro** | (subscription-style) | Unified cross-server view, background notifications, unlimited favourites (>3), full search history (>5), send-to-agent |
| **gyokuro** | 1 account, read + review + merge, both surfaces | **Unlimited** | **$39.99 lifetime / $1.99 mo / $12.99 yr** | Unlimited accounts, create/edit issues+PRs+milestones+wiki+repos, code editor that commits, admin, weekly report/stats, extra themes, push via relay; 3-day full unlock |
| **TeaGo** | Repo browsing + issue mgmt | **Lifetime Pro** | **$5.99 (single) / $11.99 (family)** | "Unrestricted repository access" |
| **Forji** | Full | — | free | (open source GPLv3) |
| **iTea** | Full | — | free | (open source MIT) |
| **Minos** | Full | — | free | (AGPL-3.0) |
| **GitBoba** | All your-server features | **Supporter** (optional) | n/a | Layout options + GitBoba-only workflows (not standard Gitea features) |
| **Cup for Gitea** | Full (read-heavy) | — | free | (no data collected) |
| **git-touch** | Full | — | free | (open source, abandoned) |

**Patterns & implications for OpenForge:**
1. **One-time lifetime purchase is the most-loved model** (GitNex $5.99, TeaGo $5.99, gyokuro $39.99
   lifetime). The self-host audience *hates subscriptions* (it mirrors their anti-SaaS stance).
2. **The safe gate is "power features," never "core workflow."** gyokuro gating *create/edit*
   behind Unlimited is the riskiest line; everyone else keeps browse+review+merge free.
3. **Managed hosting is a legit second revenue stream** (Fjord $49/mo) — but it is a different
   business than a client and splits trust (closed loop).
4. **Open-source + free is a defensible marketing position** against the closed Fjord/ForgeGo/
   gyokuro/TeaGo/Cup — it directly answers the documented "not sure I would trust it" objection.
5. **No ads anywhere** — universal. An ad-supported Gitea client would be an instant out-group signal.

---

## 7. OpenForge Mobile MVP Implication

> Synthesizing §1–§6 into a scope decision. Framed as **table stakes** (must have to not be
> embarrassing), **differentiators** (what actually wins the audience), and **skip for MVP**
> (nice-to-have that costs time and/or has API/infra blockers).

### 7.1 Table stakes (ship in v1 or the app is below the 2026 bar)
1. **Direct connection to arbitrary self-hosted Gitea/Forgejo via PAT** — non-negotiable; the
   #1 audience demand ("Every instance please"). No forced account, no relay.
2. **Self-signed certificate trust flow** (with fingerprint display) — the single most common
   self-host reality; every serious client has it.
3. **Issues: list / create / comment / label / milestone / assign** — full read+write; this is the
   baseline even the lightweight iTea ships.
4. **PR list + diff view (unified, syntax-highlighted) + merge (all methods: merge/squash/rebase/
   fast-forward)** — the core async workflow.
5. **Notifications inbox (All/Unread)** with mark-read and deep links.
6. **Markdown rendering** (tables, code blocks, emoji) and **dark mode** — both universal.
7. **Secure token storage** (Keychain / Android Keystore), zero third-party analytics, **no
   phone-home** — a *selling point* for this audience, not a footnote.
8. **Multi-account / multi-instance** with quick switching — near-universal and expected.
9. **Robust large-repo handling** (paginated tree, "load more", never a silent fail) — the Forji
   1-star defect is a free, avoidable differentiator if done right.
10. **Open source + a published license** (MIT/Apache-2.0 preferred; the audience distrusts
    closed) — directly counters the documented trust objection.

### 7.2 Differentiators (the actual "why OpenForge" — build these to win)
1. **Full PR review loop on Android**: approve / request-changes / **comment on a specific diff
   line** / batch comments. GitNex (the default) cannot do this. This is the single highest-leverage
   feature in the entire survey.
2. **Self-hosted push without a vendor backend** — the biggest unsolved problem in the field. A
   clean solution (e.g., an *optional, self-hostable* push relay, or first-class **UnifiedPush**, or
   background poll that *looks and feels* like push) would be a category-first.
3. **CI/Actions: workflow runs + streaming job logs + open-at-failure + cancel + dispatch** —
   closes GitNex's most-requested gap (#1654) and matches the Fjord/GitBoba/gyokuro iOS bar.
4. **Offline write (queue-and-send)** for comments/reviews — unique to Fjord; high value for
   commutes/remote (the whole point of a mobile forge client).
5. **Action-first lists** ("Fix CI / Resolve conflicts / Review requested / Ready to merge") and a
   **review queue** — the modern UX bar set by Fjord 1.6 and the HN frontend author.
6. **Global search from anywhere + a command palette** (explicitly requested on HN) — cheap to add,
   strongly differentiated vs. GitNex.
7. **Fast diff for extremely large PRs** (HN's #1 named pain) — a real engineering differentiator.
8. **Full-text code search** — only gyokuro has it well; high perceived value, moderate cost.
9. **Modern native design** (Compose Material 3 expressive / SwiftUI materials) — the "2015 UI"
   complaint shows a dated look is a churn driver even with full function.
10. **Widgets / home-screen presence** (build status, open PRs, review requests) — the retention hook
    the premium iOS apps use and the Android field lacks.

### 7.3 Skip for MVP (defer; API/infra blockers or low ROI)
1. **OAuth2 / WebAuthn-passkey login** — PAT is the universal on-ramp; OAuth2 is only in one young
   client, and passkey is in none. Defer; add PAT + (later) OAuth2.
2. **`git blame`** — zero competitors, but also a niche-on-niche; defer until core review is loved.
3. **Wiki editing** — read is fine for MVP; edit is low-frequency on mobile.
4. **Packages browsing** — only 2 apps have it; niche; defer.
5. **Working copies / local clone-and-push** (GitBoba's feature) — technically deep (git on-device),
   high cost, low MVP ROI; defer.
6. **Stylus review / on-device LLM review assistant** (Fjord Pro) — wow-features, not MVP; and they
   gate a paid tier, not a free core.
7. **Stacked PRs** — differentiating but the user base is small; defer.
8. **HTTP/SOCKS proxy + mTLS** — real but edge; ship after the core (and document the limitation).
9. **Cross-platform (iOS+Android in one codebase)** — the survey shows the *winning* clients are
   **native per-platform** (SwiftUI / Compose). A Flutter/RN approach (igitea, anvil, the dead
   GitTouch) has not produced the beloved apps. **Recommendation: native first** (or, if cross-
   platform is a hard constraint, accept that the ceiling is "decent," not "beloved").
10. **Managed hosting / Fjord-Account-style upsell** — a different business; don't couple the client
    to a hosting loop (it erodes the trust that open-source buys you).

### 7.4 One-line strategic read
> **The market's most-used Android client is broad-but-shallow and the category's most-starred app
> is dead; the 2026 iOS wave proves the winning wedge is "review a PR, read a CI log, and merge —
> offline-capable, self-host-push, on your phone, in a modern native UI, open source." OpenForge
> should ship exactly that on Android first (the empty lane), make PR-review + CI-logs + self-hosted
> push the headline, keep core workflow free + open source, and defer blame/wiki/packages/passkey.

---

## 8. References (all URLs cited)

### Repos & registries
- GitNex (primary): https://codeberg.org/gitnex/GitNex
- GitNex (GitHub mirror): https://github.com/gitnex-org/gitnex
- GitNex website: https://gitnex.com
- GitNex Features wiki: https://codeberg.org/gitnex/GitNex/wiki/Features
- GitNex FAQ wiki: https://codeberg.org/gitnex/GitNex/wiki/FAQ
- GitNex issues: https://codeberg.org/gitnex/GitNex/issues
- GitNex F-Droid: https://f-droid.org/packages/org.mian.gitnex/
- GitNex IzzyOnDroid: https://apt.izzysoft.de/fdroid/index/apk/org.mian.gitnex
- GitNex Google Play: https://play.google.com/store/apps/details?id=org.mian.gitnex.pro
- GitNex original idea (2019): https://github.com/go-gitea/gitea/issues/5689
- igitea: https://github.com/igitea/igitea
- GitTouch (pd4d10): https://github.com/pd4d10/git-touch
- Groid: https://github.com/hiifong/Groid
- anvil: https://github.com/THEROCKSSS/anvil
- Mobil-Gitea: https://gitea.com/pij/Mobil-Gitea
- iTea: https://github.com/philippgerard/itea
- GitBoba: https://github.com/MiguelAPerez/gitboba
- Minos: https://github.com/botelle/minos
- awesome-gitea: https://gitea.com/gitea/awesome-gitea (raw: https://gitea.com/gitea/awesome-gitea/raw/branch/main/README.md)
- GitHub topic `gitea-mobile`: https://github.com/topics/gitea-mobile
- GitHub topic `forgejo`: https://github.com/topics/forgejo
- Forgejo Codeberg org: https://codeberg.org/forgejo
- F-Droid code-forge category: https://f-droid.org/categories/code-forge/
- FOSS Apps List (GitNex entry): https://github.com/Divested-Mobile/FOSS_Apps_List

### Vendor sites / app stores
- Fjord Mobile (Android): https://mobile.fjord.sh/android
- Fjord Mobile (iOS landing): https://mobile.fjord.sh/mobile
- Fjord Mobile iOS docs: https://docs.fjord.sh/mobile/ios
- Fjord compare (iOS): https://mobile.fjord.sh/compare
- Fjord compare (Android): https://mobile.fjord.sh/compare/android
- ForgeGo: https://forgego.dev
- TeaGo: https://teago.artsvit.com
- gyokuro: https://www.gyokuro.app
- GitBoba: https://gitboba.app
- Forji (App Store): https://apps.apple.com/us/app/forji/id6759843639
- GitBoba (App Store): https://apps.apple.com/us/app/gitboba/id6767851416
- gyokuro (App Store): https://apps.apple.com/us/app/gyokuro/id6767816893
- iTea (App Store): https://apps.apple.com/us/app/itea-gitea-forgejo-client/id6757265893
- TeaGo for Gitea (App Store): https://apps.apple.com/ua/app/teago-for-gitea/id6805488091
- Cup for Gitea (App Store): https://apps.apple.com/us/app/cup-for-gitea/id6768708389
- Minos support: https://minos.botelle.org
- GitBoba blog: https://miguelaperez.dev/posts/gitboba/
- TeaGo TestFlight: https://testflight.apple.com/join/FMUBbAnX

### Community / reviews
- Gitea forum — App for Android (2018–2024): https://forum.gitea.com/t/app-for-android/302
- Gitea forum — iOS client for reviewing/approving PRs (2026-08-05): https://forum.gitea.com/t/ios-client-inbox-for-reviewing-approving-prs/12356
- Gitea forum — Fjord Mobile launch (2026-11-02): https://forum.gitea.com/t/fjord-mobile-a-native-gitea-client-for-ios-and-android/12538
- r/selfhosted — cool mobile apps for self-hosted services (2025-05-10): https://www.reddit.com/r/selfhosted/comments/1kiyabo/what_are_some_cool_mobile_apps_to_connect_to_your/
- r/forgejo — Has anyone tried the Forgego app (2026-09-24): https://www.reddit.com/r/forgejo/comments/1wp7cgr/has_anyone_tried_the_forgego_app/
- r/forgejo — Should a Forgejo iOS client work with every instance (2026-07-30): https://www.reddit.com/r/forgejo/comments/1vawgei/should_a_forgejo_ios_client_work_with_every/
- r/selfhosted — What would make a Forgejo iOS app genuinely useful (2026-07-30): https://www.reddit.com/r/selfhosted/comments/1vaw71n/what_would_make_a_forgejo_ios_app_genuinely/
- r/Gitea — I built a native iOS client for Gitea (2026-07-11): https://www.reddit.com/r/Gitea/comments/1utbdsq/i_built_a_native_ios_client_for_gitea_open_source/
- r/selfhosted — Whats your experience with gitea (2025-05-13): https://www.reddit.com/r/selfhosted/comments/1klfabn/whats_your_experience_with_gitea/
- r/selfhosted — Mobile friendly git server (2024-04-26): https://www.reddit.com/r/selfhosted/comments/1cdwe4y/mobile_friendly_git_server/
- r/selfhosted — Android app for Gitea (2019-03-07): https://www.reddit.com/r/selfhosted/comments/ayj17s/android_app_for_gitea/
- Hacker News — alternative Forgejo frontend (2026): https://news.ycombinator.com/item?id=48293984
- Hacker News — Forgejo launch thread (2025-01-19): https://news.ycombinator.com/item?id=42753523

### GitHub/Codeberg REST API data points (read 2026-11-03)
- gitnex-org/gitnex: stars 133, Java, GPL-3.0, pushed 2026-08-20, created 2023-05-17, 6 forks.
- igitea/igitea: stars 10, Dart, MIT, pushed 2026-10-27, created 2026-04-23, 2 forks, 2 open issues.
- philippgerard/itea: stars 5, Swift, MIT, pushed 2026-09-26, created 2025-12-27, 1 fork.
- MiguelAPerez/gitboba: stars 11, (CSS repo), no license, pushed 2026-11-02, created 2026-04-06, 8 open issues.
- pd4d10/git-touch: stars 1707, Dart, Apache-2.0, last code commit 2022-10-30, 157 forks, 89 open issues.
- hiifong/Groid: stars 1, Kotlin, GPL-3.0, pushed 2024-05-12, 0 forks.
- botelle/minos: stars 0, (Kotlin repo), AGPL-3.0, pushed 2026-09-22, created 2026-07-13, 1 open issue.
- codeberg.org/gitnex/GitNex: stars 938, 44 watchers, 51 forks, 42 open issues, 3 PRs, 76 releases, 1,163 commits; latest commit 2026-10-13; release 15.0.0 on 2026-09-17.
- codeberg.org/forgejo: 20 repos, 33 members, no mobile app (core/docs/website/runner/helm/governance only).

---

*End of report. Compiled 2026-11-03. Star/commit figures are point-in-time; closed-source feature
claims come from vendor listings and should be re-verified by installing before any copy decision.*
