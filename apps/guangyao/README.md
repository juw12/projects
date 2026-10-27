# Guang Yao Together · 光耀同行

**Unofficial 發一光耀 learning/community app · installable PWA · v4.0.1 public beta.**

Live: <https://juw12.github.io/projects/guangyao/> · Admin console: <https://juw12.github.io/projects/guangyao/admin.html> · Published content: <https://github.com/juw12/projects/tree/main/content/guangyao>

One responsive app for desktop and phones: an **Android app** (APK below), iPhone via Safari → Share → Add to Home Screen, and the web. Version 4 turns the study prototype into something people can actually use:

| Who | How they get in | What is real |
| --- | --- | --- |
| Learner with an account | **Sign in with Puter** (free account, same as the Glow app) | Progress, XP, streaks, flashcards, journal and registrations sync across devices; the AI study companion uses the learner's own Puter AI quota. |
| Guest | **Continue as guest** | Everything stays on this device. Nothing is sent to Puter. Offline tutor only. Can sign in later; local progress is merged. |
| Admin | `admin.html` with a GitHub token | Upload handouts, add lessons (text, YouTube, quiz, cards), events and an announcement. Learners see changes within about five minutes. |

## Phone apps (4.2)

- **Android:** <https://github.com/juw12/projects/releases/download/guangyao-android/GuangYao-android.apk> — open it on the phone and allow installing from the browser. A Capacitor shell around the live site, so content and fixes arrive without reinstalling.
- **iPhone (free):** open the site in Safari, Chrome or Edge → Share → **Add to Home Screen**. It opens full screen with its own icon and launch screen, and updates with the site. iPhone visitors get a one-time hint and a step-by-step guide (`使用指南`, install button).
- **iPhone native app (free sideload, advanced):** <https://github.com/juw12/projects/releases/download/guangyao-ios/GuangYao-iOS.ipa> is an unsigned build from CI. Sign it with your own free Apple ID in Sideloadly or AltStore and turn on Developer Mode. Apple limits free Apple IDs to 7-day signatures (refresh weekly) and 3 sideloaded apps. App Store/TestFlight would need the paid Apple Developer Program.
- Inside the app, Puter sign-in opens in an in-app window, other links open in the phone's browser, and the progress card / calendar export use the native share sheet. Details: `mobile/README.md`.

## How learners use it

1. Open the app → choose **Sign in** or **Continue as guest** on the welcome screen. A short first-visit tour follows.
2. **今日** shows the daily goal, due flashcards, the announcement and the newest official lessons.
3. **官方教材** (`#library`) lists admin-published lessons and downloadable materials. Lessons give XP, flashcards and a journal entry.
4. **複習** runs spaced review (keys `Space`, `1`–`4`).
5. **光光** is the AI study companion. Signed-in learners get streamed AI answers grounded in the course text and official material notes (it says when something is not covered, gives hints before answers, can make flashcards). Guests and the "offline only" setting use the on-device tutor.
6. **使用指南** (`#guide`) explains everything above in Traditional Chinese, including privacy and an FAQ.

## How admins publish

Admins are collaborators on `juw12/projects`. The full step-by-step guide is in `docs/admin-guide.md`; in short:

1. The owner adds a collaborator (repository → Settings → Collaborators).
2. The admin creates a token: the owner can use a **fine-grained token** limited to `projects` with *Contents: Read and write*; collaborators use a **classic token** with the `public_repo` scope (fine-grained tokens cannot write to another user's personal repository).
3. Open `admin.html`, paste the token. It is checked against `/user` and the repository's push permission and is kept in session storage only (unless "remember on this device" is ticked). Sign out removes it.
4. Publish. Each change is a commit (file first, then `catalog.json`, with conflict retries), so the repository history is the audit log and anything can be reverted.

Limits: files ≤ 20 MB (put video on YouTube, unlisted is fine); the content repository is **public**, so never upload private or member information; learners see updates after ≤ 5 minutes (catalog cache), files are served from commit-pinned jsDelivr URLs.

## Architecture

- `web/index.html` – app shell, UI and state (local storage with validation, Web Locks, cross-tab refresh).
- `web/study.js` – lessons, SM-2 review, streaks, stats, and the 光光 companion (offline retrieval tutor + Puter AI for signed-in users).
- `web/catalog.js` – fetches and sanitizes the published catalog (ID/HTTPS/YouTube/path validation, drafts hidden, 5-minute cache with API fallback).
- `web/account.js` – welcome gate, Puter sign-in/guest mode, cloud sync (chunked `puter.kv` keys, merge never loses XP/cards/completions), official library, guide, tour and announcement.
- `web/admin.html`, `web/admin.js` – GitHub-backed admin console (not cached by the service worker).
- `web/sw.js` – caches the exact public shell (release 4.0.1); updates wait for user approval.

No build step and no server of our own: GitHub Pages hosts the app, GitHub stores content, Puter provides accounts, storage and AI.

## Run locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open <http://127.0.0.1:8765/>. The local copy reads the live content catalog.

## Checks

```sh
python3 tests/verify_static.py      # standard-library structural checks
python3 qa/browser_checks.py        # Playwright, Chromium + WebKit
```

The browser suite mocks GitHub and Puter. It covers the welcome/guest/sign-in gate, cloud merge and resume, sign-out and shared-device reset, the official library (drafts hidden, `javascript:`/path traversal rejected, titles escaped), admin-lesson playback, admin login/upload/lesson/event/settings/delete flows with conflict retry, the AI companion (streaming, history, privacy toggle, AI flashcards, offline fallback), plus all v3 study, PWA and layout checks. Screenshots in `docs/images/` are refreshed by the suite.

Not covered automatically: a real Puter sign-in and real AI call (Puter requires an interactive account popup), physical devices and screen readers.

## Still demonstration only

Points/rewards, giving, community chat/polls, meetings and referrals remain local demonstrations with fictional data. They are labelled as such in the app and must not be used for real money or personal information.

## Before an official launch

Confirm institutional authorization, content ownership, teaching standards, certificate issuer, age/region policy, moderation, privacy/retention and accessibility. Donations need a legal recipient and payment provider. None of this is solved by static hosting.

Code follows the repository's MIT license. That license does not grant permission to use organizational trademarks, teaching materials or imply official endorsement.

## Repository migration

The catalog now lives at `content/guangyao/catalog.json` and uploads at
`content/guangyao/files/` in `juw12/projects`. Admin tokens must have access to
this repository. Write permission covers all of Projects, not only this folder.
Browser-only progress and installed PWAs do not automatically move between
`juwpegatron.github.io` and `juw12.github.io`; keep the old installation until
needed data has been recovered or account sync has been verified.
