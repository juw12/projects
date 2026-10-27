# Fade 3.2: book barbers, watch haircut shorts, earn as a creator, now live on the Fade Network

*Formerly **Fadeline** (v1). 2.0 added shorts and commissions; 3.0 puts it online for free.*

[Open app](https://juw12.github.io/projects/fade/) ·
[Web](https://juw12.github.io/projects/fade/web.html) ·
[Mobile](https://juw12.github.io/projects/fade/mobile.html) ·
[Offline demo](https://juw12.github.io/projects/fade/?offline)

Fade is a barber marketplace and a short-video app in one. You can find a barber
from a 15-second cut, book the same slot at whichever shop they work in that day,
pay them directly, tip, rate and earn points. If you posted the short that sent the
booking, you earn a commission.

**3.0 is multi-user and online with no server and no fees.** Accounts, bookings,
shorts, DMs and payment records live on public decentralised infrastructure
(Nostr relays, Blossom media servers, ntfy push). Money moves directly between
people with the payment apps they already use. Fade takes 0% and never holds funds.

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

## Fade Network (3.0)

| Piece | How it works | Cost |
|---|---|---|
| **Accounts** | Your email + password derive a Nostr key on your device (PBKDF2, 310k rounds, 10+ char passwords). Nothing is sent to a server; log in anywhere with the same email + password, or back up the secret key. | free |
| **Data** | Public docs (profiles, barbers, shops, shorts, likes, follows, reviews, comments) are signed Nostr events on 5 public relays. Bookings, payments, orders, commissions and rent are **end-to-end encrypted** (NIP-44) to the people involved; DMs use NIP-17 gift wraps. | free |
| **Videos** | Recorded or uploaded shorts are re-encoded **on your device** (max 720×1280, 2.5 Mbps, 60 s) and stored on Blossom media servers, streamed with Range requests. | free |
| **Push** | Each account gets a private ntfy topic: booking requests, confirmations, payments, tags, DMs and a **reminder 2 h before your cut**. Install the free ntfy app or get alerts while Fade is open. | free |
| **Money** | Real payments go **directly** to the barber, shop or creator: PayPal.me (amount filled in), Venmo, Cash App, Revolut, Wise, the barber's own Stripe Payment Link, bank / e-wallet / QRIS-PIX-PromptPay QR, cash, or **Lightning** (invoice + QR, auto-verified via LUD-21). The payer marks it sent and the receiver confirms. | 0% Fade fee |
| **Automation** | The barber's app auto-confirms free slots, publishes anonymous busy times (no double booking), issues receipts that unlock verified reviews, and tracks commissions: pending → earned (cut done) → paid → received; void on cancel/no-show. | — |
| **Moderation** | Report any short, comment or profile (NIP-56). 3+ independent reports hide content automatically; moderators (keys in `web/config.js`) can hide, keep, ban or verify from the in-app admin console. Blocked-word filter, user blocking, owner approval for tags and chair shifts. | — |
| **Privacy** | Export all your data as JSON; delete your account (NIP-09 deletion + tombstones). | — |

New barbers are bookable immediately: sign-up creates a personal studio (0% facility
fee) with editable Tue–Sat 10:00–18:00 shifts. Opening a shop later upgrades it in place.

### Modes

| Mode | How | What you get |
|---|---|---|
| **Fade Network (default)** | Open the GitHub Pages link | Real multi-user app on public relays. Starts empty until real barbers join. |
| **Offline demo** | `?offline` (or "Explore the offline demo" on the welcome screen) | Fictional barbers, shops and creators on one device; nothing leaves the browser. |
| **Self-hosted server** | `python server/server.py --admin you@example.com` → <http://127.0.0.1:8790/> | REST server with SQLite: accounts, bookings, shorts, plus moderation, push and transcoding (below). |
| **Local devnet** | `python server/devnet.py` → <http://127.0.0.1:8797/app/?devnet=1> | A stdlib relay + Blossom + ntfy on one port for offline development and tests. |

### Moderation, push notifications and video transcoding: in every mode

| | Fade Network | Self-hosted server | Offline demo |
|---|---|---|---|
| **Reports + moderators** | NIP-56 reports, auto-hide at 3 reporters, moderator console for keys in `web/config.js` | `/api/report`, auto-hide at 3 reporters, moderator console for `--admin EMAIL` accounts (hide / keep / ban / verify / dismiss); bans sign the account out and make it read-only | Hidden on the device at once **and delivered to Fade's moderators** on the relays (queued while offline); moderators' removals of demo content sync back to every offline device |
| **Automatic scanning** | On-device nudity classifier before upload; held uploads hidden by every client until a moderator keeps them; shorts published without a scan are checked on viewers' devices and auto-reported | Same on-device check, enforced by the server; unscanned uploads are checked on the moderator's device; re-uploads of removed media blocked by perceptual hash; obfuscated slurs, link spam, copy-paste floods and bursts refused | Same on-device check before saving |
| **Push** | ntfy to each account's private topic + 2 h reminders, all with sequence ids: later pushes **replace** earlier ones; a cancelled/moved booking **deletes** its scheduled reminder; deleted comments recall their push | In-app feed + ntfy pushes with sequence ids; cancellations, deleted/hidden content and bans **recall** pushes from phones; reading in the app clears the phone's drawer; "remove from my devices"; topic rotation recalls the old topic | Local feed + device alerts and the 2 h reminder while the app is open |
| **Private previews** | Recipient's choice, honoured by senders | `PUT /api/me/push {preview}` | n/a |
| **Transcoding** | In the browser (≤ 720×1280, 2.5 Mbps, 60 s) | In the browser, plus server-side ffmpeg (H.264 720p, faststart, poster). If ffmpeg isn't installed the server **downloads a pinned, SHA-256-verified static build** once into `<data>/bin` and transcodes the backlog | In the browser before saving |

**How automatic scanning works.** `web/scan.js` runs NSFWJS (MobileNetV2, vendored in
`web/vendor/nsfw/`, ~5 MB, loaded only when someone uploads) in a Web Worker on the
uploader's device on the photo or 3 frames of the video: porn + hentai ≥ 0.85 is refused
before anything is uploaded; ≥ 0.5 (or "sexy" ≥ 0.9) is uploaded but hidden until a
moderator keeps it. The server and the network store the verdict; uploads that arrive
without one (old or modified clients) are checked on a moderator's device (server) or on
viewers' devices (network). The server also fingerprints every upload (64-bit dHash of up
to 3 frames via ffmpeg) and automatically hides re-uploads of anything a moderator removed.

```bash
python apps/fade/server/server.py --admin you@example.com --public-url https://fade.example.com
#   --ffmpeg auto (default: PATH, else verified download) | fetch | /path/to/ffmpeg | off
#   --ntfy https://ntfy.sh (default) | your own ntfy | off
python apps/fade/tests/verify_safety.py     # 62 checks (65 with a real ffmpeg on PATH or FADE_TEST_FFMPEG)
python apps/fade/tests/verify_limits.py     # 42 checks (47 with a real ffmpeg; FADE_TEST_DOWNLOAD=1 also fetches the real build)
```

URL overrides: `?ns=` (namespace), `?relays=wss://a,wss://b`, `?blossom=`, `?ntfy=`,
`?admins=<hex,...>`, `?profile=` (separate local identity per tab), `?sse=0`.

```bash
python apps/fade/tests/test_static.py       # bundle integrity (136 checks)
python apps/fade/tests/verify_devnet.py     # relay / Blossom / ntfy protocol checks
python apps/fade/tests/verify_api.py        # 130 checks against the self-hosted server
python apps/fade/tests/verify_safety.py     # moderation, push, transcoding on the server
python apps/fade/server/devnet.py           # local network for development
```

Browser suites (headless Chrome, outside CI): 70 multi-user network API checks,
49 two-user UI checks (barber + client) on the devnet, 70 offline-demo checks,
32 server UI checks, 16 safety checks and 17 end-to-end checks of the 3.2 fixes
(`test/net/run_limits.sh`: offline reports reaching moderators on a relay, moderator
removals syncing back, the real on-device classifier on uploads, held/blocked verdicts,
moderator-device scans and the push privacy controls).

## Honest limits

- **Fade can't force anyone to pay, refund or honour a commission.** It records
  what each side confirms (claimed → received) and shows it to both, encrypted.
  Lightning payments are verified automatically; other methods rely on the receiver
  confirming.
- **Card payments go through each person's own PayPal or Stripe**, which charge
  their usual fees. Fade itself charges nothing and holds nothing.
- **Public relays don't promise to keep data forever.** Fade publishes to 5 relays
  and caches locally, but a relay may drop old events. Videos on free Blossom hosts
  can likewise be removed.
- **Your password is your key.** There is no password reset; use a strong password
  and back up the secret key from *Account & privacy*.
- Booking contents are encrypted, but relays can see *that* two accounts share a
  booking record (the `p` tags), and timestamps.
- Automatic scanning is a filter, not a guarantee. The nudity classifier is a small
  on-device model: it misses some content and occasionally flags harmless photos (which
  go to a moderator rather than being deleted). It does not detect violence, hate symbols
  or CSAM by hash (PhotoDNA-style lists are not freely available); reports and moderators
  remain the backstop. On the open Fade Network a modified client can skip its own scan;
  viewers' devices then check the poster image, and three automatic reports hide it.
- Push recall uses ntfy's sequence ids. Per the ntfy docs the Android and web apps act on
  updates, clears and deletes; other ntfy clients may keep showing the original. ntfy.sh
  also keeps its append-only message cache (about 12 h), so turn on private previews if
  push contents themselves are sensitive.
- The automatic ffmpeg download covers macOS (Intel/Apple Silicon), Linux (x86_64/arm64)
  and Windows; other platforms need `--ffmpeg /path/to/ffmpeg`. Without ffmpeg, uploads are
  still optimised in the browser and fingerprint blocking is off.
- The network starts empty. The offline demo's barbers, shops, creators and reviews
  are fictional.
