# Fade 2.0: book barbers, watch haircut shorts, earn as a creator

*Formerly **Fadeline** (v1).*

[Open app](https://juw12.github.io/projects/fade/) ·
[Web](https://juw12.github.io/projects/fade/web.html) ·
[Mobile](https://juw12.github.io/projects/fade/mobile.html)

Fade is a barber marketplace and a short-video app in one. You can find a barber
from a 15-second cut, book the same slot at whichever shop they work in that day,
pay, tip, rate them and earn points. If you posted the short that sent the booking,
you earn a commission.

## What's in it

- **Barbers:** profiles, portfolios, services and weekly schedules. A barber can
  work part-time at several shops (split shifts per day). Worldwide sign-up is
  supported, and each shop has its own time zone.
- **Shops:** a facility % charged to customers, plus weekly rent and product fees
  paid by barbers (Basic/Pro/Luxe tiers). Shops can be rated and tipped.
- **Booking & payment:** live slots, a deposit or full payment, card / wallet /
  membership, re-validation at checkout, conflict-safe slots (409 on a taken
  slot) and no double-booking of yourself. Cancellations refund to the original
  payment method. Past bookings auto-complete with in-person settlement.
- **Shorts:** record or upload haircut videos (fade, taper, beard, braids, colour,
  transformation, tutorial…), with For you / Trending / Following / Near me feeds,
  hashtags, likes, views and shares. "Shop the look" links to the barber and products.
- **Following & trending:** follow barbers, shops and creators. The Home screen
  shows trending shorts, barbers, shops and creators. Leaderboards cover
  barbers, shops, creators and users by week, month and all time.
- **Creator commissions:** tag up to 4 barbers or shops as **featured** or
  **sponsored**. Sponsored shorts need the paid-partnership box and show a
  "Paid partnership" label. Bookings made within 24 h of watching earn the creator:

  | Tag | Commission | Status flow |
  |---|---|---|
  | Featured | 5% of service price | pending → earned when the cut is completed |
  | Sponsored | 10% of service price | pending → earned; void if the booking is cancelled |
  | Product (shop the look) | same rate on product subtotal | earned immediately |

  Self-referral is blocked. A tag on a claimed barber or shop profile stays
  *pending* until its owner approves it in Studio or Owner. Withdrawals have a
  $1 minimum.
- **Social:** DMs, communities, points, rewards, referrals, cut history and a
  product shop.

## Two modes

| Mode | How | What you get |
|---|---|---|
| **Offline (default)** | Open `web/index.html`, or the GitHub Pages link | Full app on one device. State is in `localStorage`, and uploaded videos are in IndexedDB. Other people are simulated. |
| **Server** | `python server/server.py` → <http://127.0.0.1:8790/> | Real accounts (PBKDF2, bearer tokens), shared feeds, uploads streamed with HTTP Range, live slots, DMs and commissions across users. Data goes in SQLite (`--data DIR`). |

The front-end detects the server automatically when served from the same origin,
or you can point it at one with `?api=https://your-host`. Add `?offline` to force
offline mode.

```bash
python apps/fade/server/server.py --port 8790 --data /tmp/fade-data
python apps/fade/tests/verify_api.py        # 130 API checks on a temp DB + free port
python apps/fade/tests/test_static.py       # web bundle integrity
python apps/fade/tools/build_seed.py        # regenerate web/data.js from tools/seed_v1.json
```

## Honest limits

- **Payments are simulated.** The built-in processor stores only card brand and
  last4. Real money needs a provider with marketplace payouts (for example
  Stripe Connect), plus KYC for barbers, shops and creators.
- **Multi-user needs a hosted server.** GitHub Pages serves the offline demo
  only. Host `server.py` behind HTTPS to share accounts and videos between people.
- Moderation, push notifications and video transcoding are not included. Uploads
  are capped by size and type, and played as-is.
- All demo barbers, shops, creators and reviews are fictional.
