# Mint — product note

## Why

Selling Sheets / Excel templates still works, but the generic "budget template on Etsy" market is
saturated. The money is in:

- **niche systems**, such as toko stock, kos-kosan rental, arisan, UMKM invoicing in rupiah;
- **bundles**;
- **distribution**: creators and affiliates who post about the template.

Sellers struggle with the build (formulas, dropdowns, a dashboard that doesn't break) and with
marketing. Mint covers the whole loop: **prompt → AI template → tweak → publish → affiliates
promote with a generated content kit → buyer pays the seller → file unlocks.**

## Users

1. **Template creators.** They want a working, good-looking sheet in minutes and a place to sell it.
2. **Buyers.** Small business owners, freelancers and students who need a sheet that works in Excel
   and Google Sheets, with local currency.
3. **Affiliates / content creators.** They want something to promote, with copy ready to post and a
   clear way to get paid.

## Money flow

- The seller sets the price and an affiliate commission \(c\) (0–50%). The platform fee \(f\) is 0%
  at launch and configurable.
- Per confirmed sale:

  \[ \text{seller keeps} = P\,(1 - f - c) \qquad \text{affiliate earns} = P\,c \]

  Example: \(P = \text{Rp }49.000\), \(c = 30\%\). The affiliate earns Rp 14.700 and the seller keeps
  Rp 34.300 at \(f = 0\), or Rp 29.400 at \(f = 10\%\). The 10% case is covered by the API and browser
  tests.
- The buyer pays the seller directly through the seller's payment link, quoting the order reference.
  The seller confirms the payment and the file unlocks. The seller pays the affiliate to the payout
  details the affiliate saved, then marks it paid. Mint never holds funds.

## Status

- **Live:**
  - the PWA on GitHub Pages;
  - the API on Cloudflare: Worker plus a SQLite Durable Object, Workers AI;
  - accounts that work across devices;
  - the marketplace, orders, affiliate ledger and payouts;
  - Mint AI generation, the content kit and guides.
- **Verified:**
  - 17 end-to-end API checks on local `workerd`.
  - A 24-check real-browser flow with three separate profiles (seller, affiliate, buyer): AI-less
    prompt → tweak → publish with required payment link → affiliate link and payout details →
    buyer order with reference → checkout tab → seller confirms → .xlsx download → review → ledger
    → commission paid → offline fallback.
  - 160 static and JS-core checks.
  - Exported xlsx files recalculate correctly in openpyxl and `formulas`.

## Next decisions

1. **Automatic payments.** Midtrans or Xendit (QRIS, VA, e-wallet) or Stripe Connect. Wire the
   provider webhook to the order-confirm path for instant unlock, and Mint can then collect a fee.
2. **Fee.** Stay at 0% to attract sellers, or turn on 5–10% once payments are automatic.
3. **Email.** Add a provider (Resend, Mailchannels) for password reset and order notifications.
4. **Custom domain** (for example mint.id-style) and a privacy and terms page before marketing.
