# CrewCup — app plan (v0.2)

Goal: turn the browser demo into something that feels and installs like a real app,
and close the biggest gaps found while reviewing v0.1. No new installs on this PC
(Python standard library + browser only).

## Why a PWA (not a native build) right now
- Android dominates Indonesia/SEA; a PWA installs from Chrome/Edge to the home screen with an icon,
  full-screen window, offline shell and notifications — no Play Store review, no Node/Android SDK needed.
- Same code later wraps into Play Store / App Store via Trusted Web Activity or Capacitor.

## Done this round (v0.2) — all 10 items shipped and verified
| # | Item | Why | Done when |
|---|------|-----|-----------|
| 1 | **PWA**: manifest, icons (192/512/maskable/Apple), service worker, offline screen, install button | "Make it an app" | Edge shows *Install app*; works offline with a cached shell |
| 2 | **Mobile-first layout**: bottom tab bar, compact header, touch-sized controls, sticky order bar | Most users order on phones | Usable at 390 px width |
| 3 | **Sign-in screen** (simulated Google / Microsoft SSO + work-email OTP); demo switcher moved into a "Demo" menu | Feels like a product, not a test harness | First launch shows sign-in; choice remembered per device |
| 4 | **Live updates via Server-Sent Events** (fallback to polling) | Instant updates, less traffic | Café and employee windows update < 1 s without polling |
| 5 | **App notifications**: system notification when your coffee is ready, courier at lobby, run opened | Core app behaviour | Notification appears when tab is in background (permission granted) |
| 6 | **One-tap reorder** of "my usual" and last order on Home | Fastest path to coffee | Order placed in one tap with allowance applied |
| 7 | **Desktop app window** on Windows: launcher starts the server hidden and opens CrewCup in its own app window | Desktop office users | Double-click `CrewCup.vbs` → app window, no console |
| 8 | **LAN mode** so phones on the same Wi-Fi can try it (`--lan`) | Test on real phones | Server prints phone URL |
| 9 | **Server hardening**: catch-all errors → JSON 500, body size limit, security headers | Robustness | Bad requests never kill the server |
| 10 | **API tests** (spin up server on a random port) | Protect the app shell + API | Tests green |

## Next (needs decisions, accounts or installs — not done automatically)
- Real backend: PostgreSQL + FastAPI/NestJS, multi-tenant, audit log, migrations.
- Real payments: Xendit or Midtrans sandbox (QRIS, e-wallet tokenisation for GoPay/OVO/DANA), PCI scope via gateway.
- Real SSO/SCIM: WorkOS / Auth0 / Keycloak with Google Workspace + Microsoft Entra.
- POS integrations: Moka, Pawoon, ESB (Indonesia), Square/Toast (SG); fallback café tablet app.
- Courier APIs: GoSend / GrabExpress / Lalamove; building visitor systems.
- Store release: Android TWA (Play Store), iOS via Capacitor; HTTPS domain required.
- Legal: PSE registration with Kominfo, PDP Law (UU 27/2022) compliance, e-wallet/stored-value licensing review with Bank Indonesia (or keep funds with a licensed partner), tax advice on natura/PB1.
- Pilot: one SCBD tower + 3–5 cafés; measure on-time ready rate, cups/office/week, café retention.

## Verification log (v0.2)
- 45 automated tests green (39 engine + 6 HTTP: PWA files, security headers, JSON errors incl. 500, one-tap reorder, SSE push).
- All 18 screens render without JS errors (headless Edge); phone layout checked at 390 px via `/preview.html`.
- Found & fixed while testing: corporate proxy intercepting localhost (tests + launcher now bypass it), `X-Frame-Options: DENY` blocking the phone preview (now SAMEORIGIN), headless browsers stalling on the live stream (`?live=0` switch for automation).

## Done in v0.3 — "make it trustworthy"
| # | Item | Verified by |
|---|------|-------------|
| 1 | **Real, scannable QR codes** (own ISO 18004 encoder, stdlib only): badge, join-link QR on host tools, guest & top-up payment QR | Reed-Solomon textbook vector; 77/80 random codes (v1–16, all ECC levels) decoded by OpenCV clean **and** with 3% damage; the 3 misses also fail with segno → OpenCV detector limit; QRs decoded straight from UI screenshots |
| 2 | **Payment gateway flow**: pending charge → EMVCo/QRIS-format payload with CRC → provider webhook (callback token) → credit once | Tests: wrong token 401, amount mismatch 400, replay = no double credit, other users can't settle your charge; CRC-16 reference vector `123456789 → 29B1`; SGD QR carries `20.00` not `2000` |
| 3 | **Sessions + authorization on every action** (HMAC-signed tokens per tab, role checks for employee / café / admin / guest) | Tests: no token 401, forged token 401, acting as someone else 403, other café 403, non-admin policy change 403 |
| 4 | **SQLite storage + append-only audit log** (sign-ins, actions, denials, webhooks; secrets redacted) + admin **Audit log** tab; auto-migrates the old JSON file | Tests: audit admin-only, denials recorded |
| 5 | 51 automated tests green; 8 key screens render without JS errors | |

## Still open (needs accounts, money or legal work)
- Plug a real provider into `crewcup/payments.py` (Xendit / Midtrans sandbox keys) — the interface and webhook are ready.
- Real SSO (Google Workspace / Microsoft Entra) replaces the demo account picker; `/api/state` must then be filtered per user (today it returns everything for the demo).
- Hosting with HTTPS (needed for phone install + payment webhooks), backups, monitoring.
- Legal: PSE registration (Kominfo), PDP Law compliance, Bank Indonesia view on holding wallet balances.
