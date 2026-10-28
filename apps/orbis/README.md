# Orbis

Communication, identity, and protection in one app.

## What it is

Orbis is a zero-dependency Python backend + static PWA front-end that helps you manage replies, commitments, summaries, and personal growth tracking — and now includes **Orbis Chat**, a real-time multi-user messaging app with accounts, teams and email invites that runs on web, iPhone and Android. All data persists in SQLite.

## Quick Start

```bash
cd apps/orbis
python server/server.py
```

This opens http://127.0.0.1:8765/ in your browser. Orbis Chat is at http://127.0.0.1:8765/chat.html. The server serves both the API and the static front-end from the `web/` directory.

### CLI Options

```bash
python server/server.py --port 9000     # custom port (default: 8765)
python server/server.py --no-browser    # do not open browser on start
python server/server.py --host 0.0.0.0  # bind to all interfaces (default: 127.0.0.1)
```

## Interaction layer (Orbis Plus)

`web/orbis-plus.css` and `web/orbis-plus.js` load after `app.html`'s inline code and enhance the desktop app without changing its data model:

- **Command palette** — `Ctrl/⌘ K`: fuzzy search across views, actions, today items, commitments, drafts and summaries.
- **Keyboard first** — `G` then a letter to jump (`G T` Today, `G C` Commitments …), `N` new commitment, `F` focus timer, `[` collapse sidebar, `?` shortcut sheet.
- **Today triage** — greeting + KPI cards, progress ring, filters (Replies / Commitments / Snoozed / Done), `J`/`K` to move, `E` confirm, `S` snooze, `X` dismiss, `R` reply; unsnooze/reopen; inbox-zero state.
- **Undo everywhere** — confirm, snooze, dismiss, status changes, deletes, bulk edits and draft discards show an Undo toast.
- **Commitments** — working filters with counts, text filter, sortable columns, bulk select (done / open / delete), Kanban board with drag & drop, quick-add dialog.
- **Sidebar** — grouped sections, live count badges, collapsible icon rail.
- **Appearance** — Light / Dark / System theme, 7 accent colours, comfortable/compact density, reduce-motion. Saved per device in `localStorage` (`orbis-ui`).
- **Focus timer** — 25-minute Pomodoro chip in the top bar (survives reloads).

## API Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check: `{status, app, version}` |
| `GET` | `/api/state` | Full app state (all collections) |
| `GET` | `/api/export` | Full state as downloadable JSON |
| `GET` | `/api/audit` | Audit log (newest-first) |
| `GET` | `/api/<collection>` | Get a single collection |
| `PUT` | `/api/<collection>` | Replace a collection |
| `POST` | `/api/audit` | Append audit event `{actor, action, object}` |
| `POST` | `/api/reset` | Reset database to seed data |
| `OPTIONS` | `/api/*` | CORS preflight |

Collections: `queue`, `commitments`, `summaries`, `drafts`, `aura`, `culture`, `growth`, `sources`, `audit`, `settings`, `work`.

All API responses include `Access-Control-Allow-Origin: *` for CORS.

## Orbis Chat — live multi-user messaging

Orbis now includes a real chat app (`web/chat.html`) backed by accounts in the
same server. People sign up with email + password and chat live with each other
from a browser, an iPhone or an Android phone.

**Features**

- Accounts: sign up / sign in, password change, password reset by emailed
  6-digit code, sign out, account deletion. Passwords are PBKDF2-SHA256 hashed;
  sessions are revocable bearer tokens (60 days).
- Direct messages (find people by exact email, or teammates by name), group
  chats (rename, add people, leave), and **teams** with channels (`#general` is
  created automatically, everyone joins it), roles (owner/admin/member),
  removing members and renaming the team.
- Invites: invite to a team by email, or create a shareable invite link
  (7 days). Inviting an email with no account sends a sign-up link; when that
  person registers they automatically join the team or DM.
- Live delivery over Server-Sent Events: new messages, edits, deletes,
  reactions, typing indicators, read receipts ("Seen" / "Seen by"), and online
  presence ("last seen…"). Reconnects and re-syncs automatically.
- Replies (quoted), edits, deletes (content wiped), emoji reactions, image and
  file attachments (10 MB), links, full-text search over your own chats, mute.
- **Push notifications even when Orbis is fully closed** (standard Web Push:
  VAPID + RFC 8291 encryption, implemented in `server/webpush.py` with the
  standard library only). Works on Android (Chrome), iPhone/iPad (iOS 16.4+,
  after Add to Home Screen), desktop Chrome/Edge/Firefox/Safari. Alerts are
  skipped while you are looking at Orbis, respect mute, show the sender and
  text, set the app-icon badge, and open the right chat when tapped. Each
  device's subscription is tied to its login, so signing out stops alerts.
- Also: in-app toasts, unread badges, and **email notifications** for people
  with no push-enabled device (max one per chat every 10 minutes).
- Installable app (PWA): iPhone (Safari → Share → Add to Home Screen),
  Android (Chrome → Install app), desktop Chrome/Edge. Dark mode, safe-area and
  on-screen-keyboard aware.

### Try it with people on your Wi-Fi

```bash
cd apps/orbis
python server/server.py --host 0.0.0.0
```

The console prints a `http://<your-ip>:8765/chat.html` address. Open it on
your phone and on other people's phones on the same network, create accounts
and start chatting. (Over plain `http` on a LAN, chat works but phones will not
offer "install" or background notifications — those need HTTPS, see below.)

### Put it online (HTTPS) so anyone can use it

The server is a single Python process with SQLite, so it needs a host with a
**persistent disk** (not a static host).

- **Fly.io** (config included): from `apps/orbis` run `fly launch --no-deploy
  --copy-config`, `fly volumes create orbis_data --size 1`, set secrets (below),
  then `fly deploy`. Open `https://<app>.fly.dev/chat.html`.
- **Any Docker host** (Render, Railway, a VPS…): build `apps/orbis/Dockerfile`,
  mount a volume at `/data`, expose port 8080 behind HTTPS.
- **GitHub Pages** only hosts the static front-end. Set
  `window.ORBIS_CHAT_SERVER` in `web/chat-config.js` to your deployed server's
  HTTPS URL and the Pages copy of `chat.html` will talk to it (CORS is enabled
  for bearer-token requests). Users can also switch servers from the sign-in
  screen.

### Email

Without SMTP settings, emails (invites, reset codes, notifications) are written
to `data/outbox/*.eml` and logged to the console — fine for development. To
send real email set:

| Variable | Example |
| --- | --- |
| `ORBIS_SMTP_HOST` | `smtp.sendgrid.net`, `smtp.gmail.com`, … |
| `ORBIS_SMTP_PORT` | `587` (STARTTLS, default) or `465` with `ORBIS_SMTP_SSL=1` |
| `ORBIS_SMTP_USER` / `ORBIS_SMTP_PASSWORD` | provider credentials / app password |
| `ORBIS_SMTP_FROM` | `Orbis <no-reply@yourdomain.com>` |
| `ORBIS_PUBLIC_URL` | `https://orbis.yourdomain.com/` (used in emailed links) |

### Push notifications

Nothing to configure: the server creates its VAPID key pair on first run and
stores it in the database. Users turn alerts on in **Profile → Push
notifications → Turn on** (iPhone: add Orbis to the Home Screen first and open
it from the icon). Push requires HTTPS (or `localhost`). Optional settings:

| Variable | Purpose |
| --- | --- |
| `ORBIS_VAPID_PRIVATE_KEY` | Pin the key (base64url, 32 bytes) when running several servers or rebuilding the database; changing it requires devices to re-subscribe (automatic on next open) |
| `ORBIS_VAPID_SUBJECT` | Contact URL for push services, e.g. `mailto:you@example.com` (defaults to `ORBIS_PUBLIC_URL` or the SMTP sender) |

Other settings: `ORBIS_ALLOW_SIGNUP=0` (invite-only server),
`ORBIS_TRUST_PROXY=1` (behind a proxy; set in the Dockerfile), `PORT`, `HOST`,
`ORBIS_DB`.

### Chat API (`/api/chat/…`, JSON, `Authorization: Bearer <token>`)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `config` | Public server info (email enabled, sign-up open) |
| `POST` | `auth/register`, `auth/login`, `auth/logout` | Accounts and sessions |
| `POST` | `auth/reset/request`, `auth/reset/confirm` | Password reset by emailed code |
| `GET`/`PATCH` | `me` | Profile (name, status, color, email notifications) |
| `POST` | `me/password`, `me/delete` | Change password, delete account |
| `GET` | `users?q=` | Find teammates by name, anyone by exact email |
| `GET`/`POST` | `teams` | List / create teams |
| `GET`/`PATCH` | `teams/{id}` | Team detail (members, channels) / rename |
| `POST` | `teams/{id}/invites`, `teams/{id}/channels`, `teams/{id}/leave` | Invite, new channel, leave |
| `PATCH`/`DELETE` | `teams/{id}/members/{userId}` | Change role / remove member |
| `POST` | `invites` · `GET invites/{code}` · `POST invites/{code}/accept` | Friend invites and invite links |
| `GET`/`POST` | `conversations` | List / start a DM or group |
| `GET`/`PATCH` | `conversations/{id}` | Detail / rename, topic, mute |
| `POST` | `conversations/{id}/members`, `/join`, `/leave`, `/read`, `/typing` | Membership, receipts, typing |
| `GET`/`POST` | `conversations/{id}/messages?before=&after=&limit=` | History (paged) / send |
| `PATCH`/`DELETE` | `messages/{id}` | Edit / delete your message |
| `POST` | `messages/{id}/reactions` | Toggle an emoji reaction |
| `POST` · `GET` | `uploads` · `uploads/{id}` | Upload a file (raw body) / download |
| `GET` | `search?q=` | Search your messages |
| `GET` | `events?token=&client=&active=` | Server-Sent Events stream (live updates) |
| `GET` · `POST` | `push/key` · `push/subscribe`, `push/unsubscribe`, `push/test` | Web Push key and device subscriptions |
| `POST` | `presence` | Device reports foreground/background (no push while you are looking) |

### Honest limits (what is not done yet)

- **Native store apps**: Orbis Chat is an installable web app (PWA). It is not
  packaged for the App Store / Play Store; wrapping it with Capacitor is the
  next step if store distribution is needed.
- Push on iPhone needs iOS 16.4+ and Orbis installed to the Home Screen
  (Apple's rule for web apps). Delivery to the phone is done by Apple/Google's
  push services; Orbis's side (encryption, VAPID, routing) is covered by the
  test-suite against the published RFC vectors.
- **Scale**: one process + SQLite comfortably serves a small community or
  company, not millions of users. No end-to-end encryption; messages are stored
  in plain text on your server, protected by HTTPS in transit.
- Attachment URLs are unguessable links (anyone holding a link can open it).

## Storage Model

- **Database**: `data/orbis.db` (SQLite, created on first run)
- **Override**: Set `ORBIS_DB` environment variable to use a different path
- **Seed data**: Inserted on first run or after `POST /api/reset`

## File Map

```
apps/orbis/
  web/                    # Static front-end (served at /)
    index.html            # Landing page
    app.html              # Main desktop app
    orbis-plus.css        # Interaction/polish layer styles
    orbis-plus.js         # Command palette, shortcuts, undo, board, appearance
    chat.html             # Orbis Chat (web, iPhone, Android)
    chat-config.js        # Optional remote chat server URL (for GitHub Pages)
    app-mobile.html       # Mobile app variant
    mobile.html           # Mobile landing
    manifest.webmanifest  # PWA manifest
    sw.js                 # Service worker
    icons/orbit.svg       # App icon
  server/
    server.py             # Zero-dependency HTTP server
    chat.py               # Accounts, teams, messaging, live events, email
    webpush.py            # Web Push: P-256, AES-GCM, RFC 8291/8292 (stdlib)
  tests/
    verify_api.py         # Hermetic API test (stdlib only)
    verify_chat.py        # Multi-user live chat + push test (stdlib only)
    verify_webpush.py     # Known-answer crypto tests (RFC 8291, RFC 6979, NIST)
  docs/                   # Product specs and guides
  data/                   # SQLite database (created at runtime)
  README.md
  start.bat               # Windows launcher
  .gitignore
```

## Testing

Run the hermetic end-to-end test (stdlib only, no pytest):

```bash
cd apps/orbis
python tests/verify_api.py
```

Expected output: `31 passed, 0 failed` with exit code 0.
Expected output: `41 passed, 0 failed` with exit code 0.

The chat suite signs up several users and checks live delivery end to end:

```bash
python tests/verify_chat.py     # expected: 84 passed, 0 failed
python tests/verify_webpush.py  # expected: 25 passed (RFC/NIST crypto vectors)
```

If IPv4 loopback is blocked on your machine, point the test at IPv6 loopback:
`ORBIS_TEST_HOST=::1 python tests/verify_api.py`.

The test:
- Starts an isolated server instance with a temporary database
- Exercises all API endpoints
- Verifies CORS headers and error handling
- Cleans up on exit

## PWA Notes

- **Manifest**: `manifest.webmanifest` is scope-relative (works from any path)
- **Service Worker**: `sw.js` caches static assets and API responses
- **Icons**: Referenced relative to manifest location

To install as a PWA:
1. Open the app in a supported browser
2. Look for the install prompt or use "Add to Home screen"

## Prototype Disclaimer

This is a **prototype** implementation:
- The original workspace API (`/api/<collection>`) is still single-user with no authentication; Orbis Chat (`/api/chat`) has real accounts
- CORS is `*`; chat uses bearer tokens (no cookies), so this does not expose sessions
- Chat has input validation and in-memory rate limits; the workspace API does not
- Not production-hardened

Use for local development, testing, and prototyping only.

## License

See the root [LICENSE](../../LICENSE).
