# Mint — prompt, tweak & sell spreadsheet templates

Describe a spreadsheet in English or Bahasa Indonesia ("inventory for my online shop in rupiah,
ocean theme"). **Mint AI** designs a themed Excel / Google Sheets template with live formulas,
dropdowns, colour rules and a dashboard. You can tweak it with words or by hand, then sell it on
the marketplace. Buyers pay the seller directly, and affiliates earn tracked commission.

**Live:** https://juw12.github.io/projects/mint/ ·
[App](https://juw12.github.io/projects/mint/app.html) ·
[Web](https://juw12.github.io/projects/mint/web.html) ·
[Mobile](https://juw12.github.io/projects/mint/mobile.html) ·
[Android app (APK)](https://github.com/juw12/projects/releases/download/mint-android/Mint-android.apk) ·
API `https://mint-api.juw12.workers.dev/api/health`

**Phones:** Android installs the APK (Capacitor shell around the live site, `mobile/`). iPhone uses
Safari → Share → *Add to Home Screen* (full-screen PWA). In-app guide: *Install on your phone*.

## How it works

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
  write requests are rate-limited.
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
- **Selling.** A paid template needs the seller's own payment link (Lynk.id, Saweria,
  Trakteer, Stripe/PayPal link, Gumroad…).
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
- **Offline.** If the API can't be reached, the app keeps working in this browser and shows
  an *Offline* badge.

## Layout

```
apps/mint/
  web/                      static app (GitHub Pages)
    js/core.js              generator, tweaks, formula engine, themes, promo kit, AI prompt (pure; also bundled into the worker)
    js/xlsx.js              .xlsx / CSV writer
    js/store.js             ApiStore (live API, bearer token) + LocalStore (offline fallback)
    js/app.js js/guides.js app.css  index/app/web/mobile.html  sw.js  manifest  icons  data/seed.json
  cloud/                    Cloudflare Worker + SQLite Durable Object
    src/index.js            API: auth, drafts, listings, orders, affiliate, seller ledger, AI
    wrangler.toml           production (AI binding, CORS origins, fee, AI limits)
    wrangler.local.toml     local/CI (no remote AI binding, fee 10% for ledger tests)
    test/api_test.mjs       end-to-end API test (23 scenario checks)
  tests/test_core.py        static + JS core/xlsx checks (runs in scripts/run_all_tests.py)
  tools/build_seed.py       regenerates data/seed.json
  mobile/                   Capacitor 8 Android/iOS shell (server.url = live app, UA MintApp/1.0); see mobile/README.md
apps/mint/cloud/github-workflow.yml   (move to .github/workflows/) test on local workerd → deploy from main → live smoke test (incl. AI)
```

## Develop & test

```bash
cd apps/mint/cloud && npm install
npm run dev                                   # API on http://127.0.0.1:8787 (local SQLite)
node test/api_test.mjs http://127.0.0.1:8787  # 23 end-to-end API checks

python3 -m http.server -d apps/mint/web 48714
# open http://127.0.0.1:48714/app.html?api=http://127.0.0.1:8787   (?api= is remembered; clear with localStorage "mint.api")

python3 apps/mint/tests/test_core.py
```

Deploys happen automatically when `apps/mint/cloud/**` changes on `main`. This uses the
repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## Limits

- There is no card or QRIS processing inside Mint. Payments go to the seller's own link and
  are confirmed by hand, which keeps Mint license-free and fee-free. Instant automatic unlock
  needs a payment provider: Midtrans or Xendit for Indonesia, or Stripe Connect globally. The
  webhook would call the existing order-confirm path.
- No email yet (no provider set up): password recovery uses the one-time recovery code, and
  sellers learn about new orders from the in-app badges rather than email/push.
- iPhone: no App Store build (needs the Apple Developer Program and Xcode); the Add to Home
  Screen PWA is the iPhone app. The Android APK is sideloaded, not on Google Play.
- Privacy and Terms pages are plain-language summaries, not lawyer-reviewed.
- Everything lives in one Durable Object. That is fine for thousands of users and listings,
  but would need sharding at real scale.
- The .xlsx files are verified with openpyxl plus an independent recalculation, and by a
  real-browser download. They have not been opened in desktop Excel by me.
