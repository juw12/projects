# Sheetmint — product note

## Why

Selling Sheets / Excel templates still works, but the easy "generic budget template on
Etsy" market is saturated. The money now comes from three things:

- **Niche systems**, such as toko inventory, rental-property P&L, arisan or freelancer
  invoicing in rupiah.
- **Bundles**.
- **Distribution**: creators and affiliates who post about the template.

Most sellers struggle with the build (formulas, dropdowns, a dashboard that doesn't break)
and with the marketing (what to post). Sheetmint puts the whole loop in one place:
**prompt → tweak → publish → affiliates promote with a generated content kit.**

## Users

1. **Template creators.** They want a working, good-looking sheet in minutes and a place
   to sell it.
2. **Buyers.** Small business owners, freelancers and students who want a sheet that works
   in Excel and Google Sheets. Local currency formatting matters.
3. **Affiliates / content creators.** TikTok, Threads and blog creators who want something
   to promote without building it, plus ready-to-post copy.

## Loop & economics

- The seller sets the price and an affiliate commission (0–50%). The platform takes a 10%
  fee (`SHEETMINT_FEE_PCT`).
- Per sale:

  \[ \text{seller net} = P - \text{fee} - \text{commission} = P \,(1 - f - c) \]

  Example: \(P = \text{Rp }49.000\), \(f = 10\%\), \(c = 30\%\) gives a Rp 4.900 fee,
  Rp 14.700 to the affiliate and Rp 29.400 to the seller. This exact case is covered by
  the end-to-end test.
- Attribution: a `?ref=` link stores a 30-day cookie. The last click wins, and
  self-referral is blocked.
- Free listings act as lead magnets. They can be listed and "bought" for 0 and show up in
  the library.

## Go-to-market (suggested)

- Seed the market with niche Indonesian templates: toko stock, arisan, kos-kosan rental,
  UMKM invoice and wedding budget. Price them at Rp 29k–99k and set 30% commission.
- Recruit 10–20 micro-creators (TikTok / Threads, Indonesian productivity and UMKM
  niches). Give each one their content kit and share card.
- SEO guides: "template stok barang excel", "cara bikin invoice di google sheets". Every
  guide links to a template.
- Bundles and a "Pro" tier later: multi-sheet systems, Apps Script automations.

## Status

- **Shipped:** the static demo (GitHub Pages), a stdlib server with accounts and a shared
  market, xlsx/CSV export, the affiliate ledger, the content kit and the guides.
- **Verified:**
  - Exported xlsx files recalculate to the same dashboard values as the in-app engine
    (openpyxl + `formulas`).
  - The API test passes.
  - The browser end-to-end flow passes 27/27 checks in both demo mode and server mode:
    prompt → tweak → export → register → publish → affiliate link → referred purchase →
    download/review → ledger.

## Next decisions

1. **Payment provider.** Stripe (global cards, Connect payouts) or Midtrans / Xendit
   (QRIS, VA, e-wallets for Indonesia). Wire the provider's webhook into the existing
   purchase call.
2. **Fee %.** The default is 10%. Gumroad charges about 10% + fees, and Etsy charges a
   6.5% transaction fee plus listing and payment fees.
3. **Hosting for the server.** Options are a small VPS, Fly.io or Railway with a
   persistent volume for SQLite. Run it behind HTTPS with `SHEETMINT_SECURE_COOKIE=1`.
4. **AI generation.** Options are a hosted model behind the server (cost per prompt) or
   keeping bring-your-own-key. Either way, keep the rule-based generator as the free
   default.
