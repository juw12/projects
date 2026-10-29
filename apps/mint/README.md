# Mint — shared budgets and spreadsheet templates, one app

Mint is one app with two halves:

- **Budget** (`web/budget/`, the home screen): a budget you share like a Google Sheet, with an
  interface built only for money. It plans from your income, works out your money personality,
  warns you before a limit breaks and tracks your investments. No account; shared budgets sync
  end-to-end encrypted.
- **Templates** (`web/app.html`): describe a spreadsheet in English or Bahasa Indonesia and
  **Mint AI** designs a themed Excel / Google Sheets template with live formulas, dropdowns, colour
  rules and a dashboard. Tweak it with words or by hand, then sell it on the marketplace. Buyers pay
  the seller directly, and affiliates earn tracked commission.

**Live:** https://juw12.github.io/projects/mint/ ·
[Budget](https://juw12.github.io/projects/mint/budget/) ·
[demo household](https://juw12.github.io/projects/mint/budget/demo.html) ·
[Marketplace](https://juw12.github.io/projects/mint/budget/?view=market) ·
[Get it for Windows, Mac, Android & iPhone](https://juw12.github.io/projects/mint/budget/get.html) ·
[downloads](https://github.com/juw12/projects/releases/tag/mint) ·
[Budget self-test](https://juw12.github.io/projects/mint/budget/tests.html) ·
API `https://mint-api.juw12.workers.dev/api/health`

## One app

- **Front door.** `web/index.html` sends template links (`#/…`, `?ref=`, `?coupon=`, `?listing=`,
  `?item=`) to the **Marketplace** tab (`budget/?view=market&m=<route>`) and everything else to Budget,
  so shared and affiliate links keep working. `app.html`, `web.html` and `mobile.html` redirect the same
  way unless they are opened with `?embed=1` (inside Mint) or `?standalone=1`.
- **Marketplace tab (3.2).** The template studio and store run inside Budget as one tab: a persistent
  iframe (`../app.html?embed=1&nolocale=1#/…`) styled like Budget, with chips instead of a second nav —
  Browse, Generate, Sell, Earn, Help, Account. *Sell this plan* / *Sell this mix* (Budget and Invest) turn
  the budget's envelopes or target mix into a draft template (shares of income only, never transactions
  or real amounts; `learn.js` → `planToSpec` / `mixToSpec`). Bought `mint-budget-plan` / `mint-invest-mix`
  templates get *Use in my budget* / *Use as my investing target*, which size the plan to your income or set
  the target mix. Prices show in the seller's currency plus an estimate in the buyer's region currency.
- **One install.** A single manifest (`web/manifest.webmanifest`) opens on Budget and covers the
  whole of `/projects/mint/`. Its `id` is the one Mint Templates always had, so existing installs
  carry over. Shortcuts: Add expense, Open sheet, Create a template, Template market.
- **Language and region first.** `web/js/locale.js` loads before everything else on every Budget and
  Templates page. On the first visit it asks for a language (English, Bahasa Indonesia, 简体中文, Español)
  and a region (29 choices); the region sets the currency of new budgets and templates. Both can be changed
  later (Budget: **Settings → Preferences**). Stored as `mint.lang`, `mint.region`, `mint.currency`.
  `?demo=1`, `demo.html`, `tests.html` and `get.html` never stop at the question.
- **Shared settings.** Light / Dark / System lives in `mint.theme` and both halves follow it, even
  in a tab that is already open. Both halves read the one `mint.lang`; Templates is translated into
  Indonesian, so Chinese and Spanish show Templates in English.
- **Two service workers.** `web/budget/sw.js` (scope `budget/`, caches `mint-budget-v…`) and
  `web/sw.js` (scope `mint/`, caches `mint-v…`). Each deletes only its own old caches.

## Mint 3.2: currencies, Invest learning, one account

- **Many currencies.** Quick-add, income and holdings take any supported currency. Amounts convert to the
  budget's currency with daily rates (`GET /api/fx`, cached 6 h at the edge; open.er-api.com, Frankfurter as
  fallback; a built-in snapshot works offline) and transactions keep the original as `txn.fx = {cur, amt, rate}`.
  Settings can convert a whole budget to the region's currency or only relabel it.
- **Invest → Portfolio · Learn · Tips · News.** A 12-question quiz with explanations (best score saved),
  tips built from your own portfolio and plan, and regional money headlines (`GET /api/news?region=&lang=`:
  Google News RSS, falling back to regional publisher feeds when Google refuses edge traffic; cached 2 h on the
  device). Not financial advice; Mint does not write the headlines.
- **One account, every device.** `js/mint-cloud.js` signs in once for sync and the Marketplace. Budgets and
  preferences are sealed on the device (AES-GCM, compressed, item key as AAD) with a random data key wrapped by
  PBKDF2-SHA-256 (210k) keys from the password and from a recovery code; the server only stores ciphertext
  (`/api/sync`, `/api/sync/key`). `budget/js/cloud-sync.js` pushes 1.2 s after a change, polls every 15 s, merges
  books per record on conflicts and never uploads demo budgets. Losing both the password and the recovery code
  means the synced copy cannot be read (the device copy stays).

### Budgets saved by older versions

- `locale.js` moves any budget data saved under the pre-3.1 storage prefix to `mint.budget.*` once, before
  any other script reads storage, then removes the old keys. Profiles, budgets, activity and sync state carry over.
- Shared budgets sync on relay topics `mint-<bookId>`. A device coming from an older version holds the whole
  budget locally and posts a full snapshot after its first replay on the new topic, so nothing is lost.
- Addresses from before Mint 3.0 are forwarded by redirect stubs that `scripts/build_site.py` writes (hash and
  query kept, so old invite links still open the right budget), and a retiring worker there clears the old caches.

## Budget

| Area | What it does |
| --- | --- |
| **30-second setup** | Three questions (name, take-home pay, who it is for) and Mint builds a ready-to-use budget. Currency is guessed from your language and device. A *Getting started* checklist on Home walks through the first expense, the plan, inviting people and the optional quiz, then disappears. |
| **Onboarding quiz** | 14 quick questions on needs, wants and behaviour → 5 traits (spender↔saver, spontaneous↔planner, cautious↔bold, independent↔generous, calm↔avoidant) → one of 6 personas: 🐿️ Squirrel, 🦉 Owl, 🦋 Butterfly, 🦁 Lion, 🐬 Dolphin, 🐢 Turtle. |
| **Plan from income** | Converts take-home pay into needs / wants / savings / investing envelopes tuned to the persona, then adjusts for emergency fund, debt and actual rent (it never budgets housing below what you pay). One click turns the plan into envelopes and goals. |
| **Overview** | "Left to spend" ring, safe daily spend, spending pace vs. budget, category donut, budget bars, warnings, who-spent-what, live activity and goals. Tap Income, Spent, Saved or Safe to open the page behind the number. |
| **Fast entry** | Type the amount and what it was; Mint picks the category from your own history first, then common words in English, Indonesian, Chinese and Spanish ("coffee", "Grab", "listrik", "午饭", "almuerzo"). Recent descriptions autocomplete. |
| **Sheet** | Spreadsheet-style grid: edit any cell inline, Enter moves down, sort, filter, search as you type, add rows, CSV import and export. Remote edits flash in place. |
| **Budget** | Income sources (monthly/weekly/yearly), left-to-assign, "Mint's plan vs actual" with *Apply plan*, and editable envelopes by group. |
| **Warnings** | Alert at a configurable threshold (default 80%), when a limit is over, and when the current pace will overspend before month end. Shown as toasts, in the bell and (optionally) as browser notifications, including for edits made by other people. Quick-add shows "this brings Groceries to 86%" before you save. |
| **Tips** | Persona-aware tips: one per day, sometimes after adding a transaction, and on demand. |
| **Goals** | Savings goals with progress rings and the monthly amount needed to reach the target date. |
| **Invest** | Holdings (units × price), allocation vs. a target (presets or custom), drift and the trades needed to rebalance, and a compound-growth projection with sliders. Prices are entered manually. |
| **Look & feel** | Light, Dark or System theme in one tap from the top bar (the new theme grows out of the button), with live previews in **Settings → Appearance**. Motion is calm: rings, bars and figures animate when a page or month opens, never on every edit, and *reduce motion* turns it off. |
| **Phone layout** | One tidy header row and a tab bar with a big **+** in the middle. **More** holds theme, language, Goals, Invest, You, Share, Settings and Templates. Dialogs open as bottom sheets you can drag down to close; toasts can be swiped away and never cover an open sheet. |
| **Keyboard** | `N` add · `T` theme · `1`–`8` pages · `/` search the sheet · `?` lists every shortcut. |
| **Updates** | Mint checks for a new version when it opens, every 30 minutes, when you come back to it and when the connection returns. A toast, the bell and **Settings → Updates** say when one is ready; one tap updates in place, keeping your budgets, the page and month you were on. With *Install updates automatically* on (the default) it also updates itself the next time you switch away, never while a sheet or a half-typed field is open. Afterwards a short *What's new* shows the release notes in your language. |
| **Languages** | English, Bahasa Indonesia, 简体中文 and Español. Picks your device language on first launch; switch any time from the welcome screen, the phone **More** sheet or **Settings → Preferences**. Dates and month names follow the language. |
| **Share your result** | One tap turns your money animal into a 1080×1350 card in your language (native share sheet on phones, PNG download on desktop) with a link back to the quiz. |
| **Share** | One link invites people to edit live. Shows presence ("2 online"), people and an activity feed. Works offline: edits queue and sync on reconnect. |

### Platforms (all free)

| Platform | How to get it | What you get |
| --- | --- | --- |
| **Windows 10/11** | [`Mint-Windows-Setup.exe`](https://github.com/juw12/projects/releases/download/mint/Mint-Windows-Setup.exe) (per-user, no admin) or the [portable zip](https://github.com/juw12/projects/releases/download/mint/Mint-Windows-Portable.zip) | Mint in its own window (Edge WebView2, `desktop/`). Budgets persist between launches; exports save to Downloads. |
| **Mac** | [`Mint-macOS-AppleSilicon.dmg`](https://github.com/juw12/projects/releases/download/mint/Mint-macOS-AppleSilicon.dmg) or [`Mint-macOS-Intel.dmg`](https://github.com/juw12/projects/releases/download/mint/Mint-macOS-Intel.dmg) | The same window app with WebKit. Not notarized: first open needs **Privacy & Security → Open Anyway**. |
| **Android** | [`Mint-Android.apk`](https://github.com/juw12/projects/releases/download/mint/Mint-Android.apk) | The Capacitor app in `mobile/`: opens on Budget, Back button, haptics, and backups / CSV / result cards / .xlsx go to the share sheet. Signed with the Mint key, so it updates earlier installs. |
| **iPhone / iPad** | Safari → [get.html](https://juw12.github.io/projects/mint/budget/get.html) → Share → **Add to Home Screen** | Full-screen home-screen app with its own icon, offline Budget and app shortcuts. |
| **Web** (any computer or phone) | Open https://juw12.github.io/projects/mint/ | The full app; Chrome/Edge can also install it as a window. |

The `Mint apps` workflow (`.github/workflows/mint-apps.yml`) builds the Windows, Mac and Android apps, opens each one
on its own OS (the Windows installer is installed, run and uninstalled; the APK runs on an emulator) and publishes the
ones that pass to the [`mint` release](https://github.com/juw12/projects/releases/tag/mint). The apps load the live site,
so new features arrive without reinstalling.

App Store and Play Store listings are not included: they need paid developer accounts (Apple $99/year, Google $25 once).

### Languages

All Budget UI text lives in one table, `budget/i18n/strings.txt` (`English || Indonesian || Chinese || Spanish`,
~815 rows). `python3 apps/mint/budget/i18n/build_i18n.py` validates it (column count, matching `{placeholders}`,
duplicates) and writes `web/budget/js/lang/{id,zh,es}.js`. At runtime `web/budget/js/i18n.js` picks the language
(`?lang=` → saved choice → Templates' choice → browser), translates rendered text and attributes in place, and leaves
user data (budget names, notes, amounts) untouched. To add a language, add a column, append its code to `LANGS` in
both files and rebuild.

### How sharing works

- **Local-first.** Every budget ("book") is a set of collections (`txns`, `categories`, `incomes`, `goals`, `holdings`, `members`, `meta`) stored in `localStorage`.
- **Cell-level merge.** Each record keeps a per-field Lamport/wall clock (`_f`), and deletions are tombstones. Two people editing different cells of the same row both keep their edits; the same cell resolves last-writer-wins. Merges are commutative and idempotent, so the order messages arrive in does not matter.
- **End-to-end encrypted.** Sharing creates a random 256-bit AES-GCM key. The invite link is `budget/index.html#join=<bookId>.<key>&n=<name>`. The key lives in the URL **fragment**, which browsers never send to any server. Every op is encrypted in the browser before it is published.
- **Transport.** Encrypted ops go to a pub/sub topic derived from the book id, on the free public [ntfy.sh](https://ntfy.sh) relay by default, or on your own relay (below). New joiners receive a compressed, chunked snapshot. Tabs on the same device sync through `BroadcastChannel`.
- **Threat model.** The relay sees only ciphertext, topic names, timing and sizes. Anyone who has the link can read and edit, so treat it like a password. *Stop syncing* removes the key from this device; to revoke someone, create a new share.

The public ntfy.sh relay is free but best-effort. It caches messages for about 12 hours and rate-limits anonymous
clients (roughly a few hundred messages a day per IP; see ntfy's docs for the current numbers). Collaborators who are
offline longer than the cache window catch up from the next snapshot one of them publishes. For always-on sync,
self-host the relay:

```bash
python apps/mint/budget/server/relay.py --port 8787 --data ./relay-data
# then: Mint → Budget → Share → Relay server → https://your-host:8787 (put it behind HTTPS)
```

`budget/server/relay.py` is a single stdlib-only file that implements the subset of the ntfy API Budget uses
(`POST /<topic>`, `GET /<topic>/sse?since=…`, `GET /<topic>/json?poll=1`, `GET /health`). It persists messages to
JSONL, has CORS, a 64 KB message limit and per-IP rate limiting, and never logs message bodies. Settings:
`--port` / `PORT`, `--data` / `MINT_RELAY_DATA`, `MINT_RELAY_VERBOSE`.

### Budget files

No build step and no dependencies: plain HTML, CSS and classic scripts.

| File | Role |
| --- | --- |
| `web/budget/js/core.js` | Data model, merge/CRDT, money parsing (`25k`, `1,5jt`, `Rp 25.000`), budget maths, alerts, tips, quiz scoring, planner, portfolio maths, demo data |
| `web/budget/js/sync.js` | AES-GCM crypto, snapshot chunking, relay transport (SSE + POST), outbox, presence |
| `web/budget/js/quiz.js` | Onboarding quiz UI |
| `web/budget/js/ui-kit.js` | Icons, rings, charts, toasts |
| `web/budget/js/app.js` | Views, routing, editing, alerts wiring, links to Templates |
| `web/budget/sw.js` | Network-first service worker: revalidates every file, offline shell, registered on HTTPS only |
| `web/budget/version.json` | The live Budget version and its release notes; the app reads it to notice updates |

## Templates

```
GitHub Pages (static PWA)  ──HTTPS + bearer token──▶  Cloudflare Worker "mint-api"
apps/mint/web                                          apps/mint/cloud/src/index.js
                                                         │
                                                         ├─ Durable Object "MintDB" (SQLite): users, sessions,
                                                         │  drafts, listings, orders, affiliate links, reviews
                                                         └─ Workers AI: prompt → template (Llama 3.3 70B)
```

- **Accounts.** Work on every device. Passwords use PBKDF2-SHA256 with 100k iterations.
  Sessions are random 256-bit bearer tokens, stored hashed. Login, sign-up, AI, order and
  write requests are rate-limited. Budget needs no account; the two never share data.
- **Account safety.** Sign-up shows a one-time recovery code (`MINT-XXXX-XXXX-XXXX`, stored as a
  SHA-256 hash). *Forgot password?* resets with email + code, issues a new code and signs out
  other devices. Account page: change password, new recovery code, delete account (listings
  removed, buyers keep paid templates, order records stay as "Deleted user").
- **Protecting paid templates.** Non-buyers get a preview: formula columns are baked into values
  server-side (marked 🔒), 8 rows max, so formulas never leave the server before purchase.
- **Moderation.** Logged-in users can report a listing; 5 distinct reporters (3 locally) hide it
  as `flagged` and the seller can't republish it. Pending orders expire after 14 days.
- **Badges.** Sell / Library show counts (orders to confirm, commissions owed, orders awaiting
  payment), refreshed every 60 s, plus `(n)` in the tab title.
- **Automatic payments (v2.2).** A seller can connect their own Midtrans, Xendit or Stripe
  account (secret key, stored AES-GCM encrypted with the `PAYMENT_KEY_SECRET` Worker secret). Orders
  then open a hosted checkout on the seller's account (Snap / Invoice / Checkout Session); Mint
  re-checks the status with the provider API (webhook bodies are only a hint) and unlocks the file
  instantly. Money goes to the seller; Mint never holds funds. Code: `cloud/src/payments.js`.
- **Notifications (v2.2).** Web Push with VAPID + aes128gcm (RFC 8291/8292, `cloud/src/notify.js`,
  no third-party service) for new orders, payments, unlocks and commissions; optional email through
  Resend when `RESEND_API_KEY` + `MAIL_FROM` are set.
- **Coupons (v2.3).** Sellers create codes (5–90% off, one template or all, optional max uses and
  expiry) under *Sell → Coupons*. Buyers type the code or open a coupon link (`?coupon=CODE`); the
  price, platform fee, affiliate commission and seller net are all computed on the discounted price
  server-side. Pending orders hold a use; cancelled/expired ones release it. A buyer who finds a
  coupon after ordering can replace the unpaid order at the lower price.
- **Seller insights (v2.3).** Listing views (one per network per hour, the seller's own visits
  excluded), 30-day views/sales/conversion/earnings with a daily chart, and views + conversion per
  listing.
- **Share previews (v2.3).** Shared and affiliate links go through `https://mint-api…/s/<listing>`,
  which serves Open Graph / Twitter tags (title, price, description, card image) so WhatsApp, X,
  Facebook and Telegram show a rich preview, then redirects into the app keeping `ref` and `coupon`.
- **English / Bahasa Indonesia (v2.4).** An EN/ID button in the top bar switches the whole UI
  (nav, pages, guides, Studio replies, dialogs, placeholders). English is the source; `js/i18n.js`
  translates the rendered text in place from a phrase dictionary and keeps the original on each
  node, so switching back is instant. User content (titles, descriptions, reviews, names, chat
  you typed) and sheet previews are marked `translate="no"` and never change. The choice is
  shared with Budget; first visit follows the browser language (`id`/`ms` → Indonesian).
- **Selling with a payment link.** Without automatic payments, a paid template needs the seller's
  own payment link (Lynk.id, Saweria, Trakteer, Stripe/PayPal link, Gumroad…).
  1. The buyer clicks *Buy* and gets an order reference such as `M-7K3QXA`.
  2. The buyer pays on the seller's link and puts the reference in the payment note.
  3. The seller taps *Payment received* in the dashboard.
  4. The template unlocks in the buyer's library. Mint never holds money.
- **Free templates** unlock instantly. The marketplace starts with 14 free showcase templates.
- **Affiliates.**
  - Commission is set per listing (0–50%).
  - Links use `?ref=`, with 30-day attribution and no self-referral.
  - Clicks are de-duplicated per network per hour.
  - Affiliates add their payout details. The seller sees the commission owed per confirmed
    order, pays it, then taps *Mark paid*.
  - The affiliate dashboard shows clicks, sales, earned and paid out.
- **Platform fee.** `PLATFORM_FEE_PCT` defaults to 0 at launch. It is recorded per order if
  you raise it.
- **Mint AI.** Each request is validated by the same core engine and normalised into a safe
  template. Each user gets 20 generations a day, anonymous visitors 5, with a global cap
  (`AI_DAILY_LIMIT`). If AI is busy, the instant rule-based generator takes over. An optional
  bring-your-own OpenAI-compatible model is available under Account.
- **Studio.** Tweak commands work in English and Indonesian: `add column Supplier`,
  `tambah kolom Catatan`, `theme midnight`, `currency EUR`, `highlight Qty below 5 red`,
  `add column Margin = [Price] - [Cost]`. It also includes a safe formula engine (no `eval`),
  a real .xlsx writer (Dashboard + Data sheets, 200 ready rows, validation, conditional
  formats), CSV export, a content kit (X, LinkedIn, TikTok, blog/SEO, Pinterest, WhatsApp
  copy plus a share card) and 7 creator guides.
- **Offline.** If the API can't be reached, Templates keeps working in this browser and shows
  an *Offline* badge.

## Layout

```
apps/mint/
  web/                      static app (GitHub Pages, /projects/mint/)
    index.html              front door: template links → app.html, everything else → budget/
    manifest.webmanifest    the one Mint install (opens on Budget)   icons/  shared by both halves
    budget/                 Budget: index/demo/get/tests/web/mobile.html, styles.css, sw.js, version.json
    js/locale.js            first-visit language & region, storage migration (loaded first by both halves)
      js/                   core, sync, quiz, ui-kit, app, i18n + lang/{id,zh,es}.js
    js/core.js              Templates generator, tweaks, formula engine, themes, promo kit, AI prompt (pure; also bundled into the worker)
    js/xlsx.js              .xlsx / CSV writer
    js/store.js             ApiStore (live API, bearer token) + LocalStore (offline fallback)
    js/app.js js/guides.js js/i18n.js app.css  app/web/mobile.html  sw.js  data/seed.json
  budget/
    i18n/                   strings.txt (Budget UI text, 4 languages) + build_i18n.py
    server/relay.py         optional self-hosted sync relay (stdlib only)
  cloud/                    Cloudflare Worker + SQLite Durable Object
    src/index.js            API: auth, drafts, listings, orders, affiliate, seller ledger, AI
    wrangler.toml           production (AI binding, CORS origins, fee, AI limits)
    wrangler.local.toml     local/CI (no remote AI binding, fee 10% for ledger tests)
    src/payments.js         Midtrans / Xendit / Stripe checkout + status + key encryption
    src/notify.js           Web Push (VAPID, aes128gcm) + Resend email
    test/api_test.mjs       end-to-end API test (30 scenario checks, incl. decrypting pushes)
    test/mock_services.mjs  local stand-ins for the providers, push services and Resend
  tests/test_core.py        Templates static + JS core/xlsx checks
  tests/test_budget_*.py    Budget: web files and cross-links, translations, relay
  tools/build_seed.py       regenerates data/seed.json
  desktop/                  Windows + Mac app (pywebview window, PyInstaller, Inno Setup); see desktop/README.md
  mobile/                   Capacitor 8 Android/iOS shell (server.url = live Mint, UA MintApp/1.1); see mobile/README.md
apps/mint/cloud/github-workflow.yml   (move to .github/workflows/) test on local workerd → deploy from main → live smoke test (incl. AI)
```

## Develop & test

```bash
python3 scripts/build_site.py && python3 -m http.server -d _site 8000
# open http://127.0.0.1:8000/mint/ (front door), /mint/budget/demo.html (sample household)

cd apps/mint/cloud && npm install
npm run dev                                   # API on http://127.0.0.1:8787 (local SQLite)
node test/api_test.mjs http://127.0.0.1:8787  # 30 end-to-end API checks (starts the mocks on :8799)
# open http://127.0.0.1:8000/mint/app.html?api=http://127.0.0.1:8787   (?api= is remembered; clear with localStorage "mint.api")

python3 apps/mint/tests/test_core.py          # Templates core, xlsx, front door, manifest, workers
python3 apps/mint/tests/test_budget_web.py    # Budget files, refs, language & region, storage migration, apps, cache isolation, old-address redirects
python3 apps/mint/tests/test_budget_i18n.py   # translation table valid, language packs up to date, load order
python3 apps/mint/tests/test_budget_relay.py  # relay: publish/poll/SSE, 400/413, persistence
```

All four run in `scripts/run_all_tests.py`. In the browser, `budget/tests.html` runs 103 Budget core tests (merge,
crypto, parsing, budgets, alerts, planner, portfolio, versions); add `?relay=https://ntfy.sh` or your relay URL for a
live two-client sync test (108 in total).

Deploy the API: `cd apps/mint/cloud && npx wrangler deploy` (after `npx wrangler login`). Worker secrets:
`VAPID_PRIVATE_KEY`, `PAYMENT_KEY_SECRET`, optional `RESEND_API_KEY` (+ `MAIL_FROM` var) —
`npx wrangler secret put NAME`. `github-workflow.yml` can be moved to `.github/workflows/` for CI deploys.

## Releasing

- **Budget:** bump `K.VERSION` in `web/budget/js/core.js` and `web/budget/version.json` together (two or three short
  release notes in English, Indonesian, Chinese and Spanish), and `CACHE` in `web/budget/sw.js`.
  `test_budget_web.py` fails if the versions drift apart. Once the site deploys, open copies of Budget notice the
  new version, tell their users and update themselves.
- **Apps:** bump `VERSION` in `desktop/mint_app.py` with the Budget version and `version` in `mobile/package.json`
  for a new Android build; pushing changes under `desktop/` or `mobile/` rebuilds and republishes them.
- **Templates:** bump `CACHE` in `web/sw.js` so browsers pick up the new shell; the Worker deploys from `cloud/`.
- Update `version` for `mint` in `scripts/apps.json`; the portfolio card reads it.

## Limits

- Budget is not a bank: it never connects to your accounts. Tips and plans are general guidance, not financial
  advice; investment prices are manual. Data is only as durable as your browser storage plus whoever you share with,
  so use **Settings → Backup** for a JSON export. Budget translations were written with AI assistance and have not
  had a native-speaker review.
- Templates speaks English and Indonesian only. Strings missing from its dictionary (and server error messages not
  listed there) fall back to English; the legal pages and the downloaded .xlsx / sheet contents stay in English.
- The desktop apps are not code-signed or notarized (SmartScreen / Gatekeeper ask once). They need an internet
  connection the first time they open; after that Budget also works offline.
- Automatic payments use each seller's own provider account (no platform money flow, so no
  payment licence needed); they were tested against local provider mocks and the real APIs'
  key validation, not with a real paid transaction. Mint collecting a fee automatically would
  need a marketplace product (Xendit xenPlatform / Midtrans split / Stripe Connect).
- Email needs a Resend API key + verified sender domain; until then notifications are Web Push
  + in-app badges. Push doesn't work inside the Android WebView app (use Chrome / installed PWA).
- iPhone: no App Store build (needs the Apple Developer Program and Xcode); the Add to Home
  Screen PWA is the iPhone app. The Android APK is sideloaded, not on Google Play; neither is the
  Microsoft Store or Mac App Store.
- Privacy and Terms pages are plain-language summaries, not lawyer-reviewed.
- Everything in Templates lives in one Durable Object. That is fine for thousands of users and
  listings, but would need sharding at real scale.
- The .xlsx files are verified with openpyxl plus an independent recalculation, by a
  real-browser download, and in desktop Excel (all 14 seed templates, 104/104 values match).
