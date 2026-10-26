# Sheetmint — prompt, tweak & sell spreadsheet templates

Describe a spreadsheet in English or Bahasa Indonesia ("inventory for my online shop in
rupiah, ocean theme"). Sheetmint builds a themed Excel / Google Sheets template with live
formulas, dropdowns, colour rules and a dashboard. Tweak it with words or by hand, then
publish it to the built-in marketplace with a price and an affiliate commission. Affiliates
get a tracked link and a ready-made content kit.

**Live:** https://juw12.github.io/projects/sheetmint/ ·
[App](https://juw12.github.io/projects/sheetmint/app.html) ·
[Web](https://juw12.github.io/projects/sheetmint/web.html) ·
[Mobile](https://juw12.github.io/projects/sheetmint/mobile.html)

The GitHub Pages build runs in **demo mode**: accounts, listings, sales and affiliate
earnings live in your browser's localStorage. The checkout moves no real money. Run the
bundled server to get real shared accounts and a shared marketplace (see below).

## Features

- **Prompt → template.** A rule-based generator with 14 blueprints: budget, invoice,
  inventory, project, CRM, habit, content calendar, meal, workout, rental, pricing, travel,
  study and event. It detects currency (8 currencies, IDR formatting), theme and extra
  columns. When no blueprint fits, it builds a custom tracker from the fields you listed.
  If you set your own OpenAI-compatible endpoint and key under Account, an AI model can
  draft the template instead (optional).
- **Tweak with words** (EN/ID): `add column Supplier`, `tambah kolom Catatan`,
  `remove column X`, `rename A to B`, `add 10 rows`, `theme midnight`, `currency EUR`,
  `total of Amount`, `highlight Qty below 5 red`, `call it "Toko Stock"`,
  `add column Margin = [Price] - [Cost]`.
- **Safe formula engine.** It has no `eval` and supports `IF AND OR NOT ROUND MIN MAX ABS TODAY
  IFERROR SUM AVERAGE` and `[Column]` refs. Formulas are translated to real Excel formulas.
- **Real .xlsx export.** The zip/XML writer is built in. Each file has a Dashboard sheet
  and a Data sheet with 200 prepared rows, guarded formulas, dropdown validation,
  conditional formatting, theme colours, frozen header and autofilter. CSV export is also
  available.
- **Marketplace.** Search, filter by category or free, sort, live preview, buy, library,
  re-download, and customise a bought copy. Only buyers can leave reviews.
- **Seller dashboard.** Shows gross sales, platform fee (10%), affiliate payouts and net
  per listing. Sellers can unpublish and republish.
- **Affiliate program.** Per-listing commission is set by the seller (0–50%). Referrals
  use `?ref=` links with 30-day attribution, and self-referral is blocked. Affiliates see
  clicks, sales and earnings.
- **Content kit.** Copy for X/Threads, LinkedIn, a TikTok/Reels script, a blog/SEO
  outline, Pinterest and WhatsApp (ID), with the affiliate link included. Also a
  downloadable themed share-card PNG.
- **Guides.** Six creator guides: creating, themes, pricing, affiliates, content
  marketing and going live.
- 8 themes, including dark. Installable PWA with App / Web / Mobile shells.

## Layout

```
apps/sheetmint/
  web/                    static app (GitHub Pages)
    index.html app.html web.html mobile.html   same shell; mobile adds bottom nav
    js/core.js            generator, tweaks, formula engine, themes, promo kit (pure, no DOM)
    js/xlsx.js            .xlsx / CSV writer (pure)
    js/store.js           ApiStore (server) / LocalStore (demo) with identical rules
    js/guides.js js/app.js app.css
    data/seed.json        demo marketplace listings (tools/build_seed.py)
    sw.js manifest.webmanifest icons/ screenshot.png
  server/server.py        stdlib HTTP + SQLite API, also serves web/
  tools/build_seed.py     regenerates data/seed.json
  tests/test_core.py      static integrity + JS core/xlsx (node or macOS osascript)
  tests/verify_api.py     hermetic API test (accounts, buy, fee/commission ledger, reviews)
  docs/sheetmint.md       product & strategy note
```

## Run & test

```bash
# static demo (no backend)
python3 -m http.server -d apps/sheetmint/web 8000

# full app with accounts + shared marketplace (Python 3.9+, no dependencies)
python3 apps/sheetmint/server/server.py            # http://127.0.0.1:8792/
python3 apps/sheetmint/server/server.py --port 9000 --db /tmp/sheetmint.db --no-seed

python3 apps/sheetmint/tests/test_core.py
python3 apps/sheetmint/tests/verify_api.py
```

The web app probes `api/health`. If the API answers, it switches to server mode;
otherwise it runs in demo mode.

Server environment variables:

- `SHEETMINT_DB`: SQLite path.
- `SHEETMINT_FEE_PCT`: platform fee, default 10.
- `SHEETMINT_SECURE_COOKIE=1`: set this behind HTTPS.

Security measures:

- Passwords use PBKDF2-SHA256 with 200k iterations.
- The session cookie is HttpOnly and SameSite=Lax.
- Logins are rate-limited.
- POST requests must be JSON-only, which guards against CSRF.
- Static file serving has a path-traversal guard.

## Limits (honest)

- **No real payments yet.** The server's checkout is a test-mode ledger. It records the
  fee, commission and net in cents, but no money moves. For real payments, add Stripe
  Checkout (global) or Midtrans / Xendit (Indonesia: QRIS, VA, e-wallets) with a webhook
  that calls the existing purchase path. Payouts to sellers and affiliates also need a
  provider (Stripe Connect / Xendit payouts) or a manual monthly process.
- In demo mode, every account lives in one browser. This is useful for trying the flow, but
  it is not a shared marketplace.
- The built-in generator is rule-based (keyword blueprints plus a custom fallback). It is
  fast, free and offline, but it is not an LLM. The AI option uses the user's own key.
- The .xlsx files are verified with openpyxl and an independent formula recalculation.
  Check them once in desktop Excel and Google Sheets before selling.
