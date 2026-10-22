# Orbis

Communication, identity, and protection in one app.

## What it is

Orbis is a zero-dependency Python backend + static PWA front-end that helps you manage replies, commitments, summaries, and personal growth tracking. All data persists locally in SQLite.

## Quick Start

```bash
cd apps/orbis
python server/server.py
```

This opens http://127.0.0.1:8765/ in your browser. The server serves both the API and the static front-end from the `web/` directory.

### CLI Options

```bash
python server/server.py --port 9000     # custom port (default: 8765)
python server/server.py --no-browser    # do not open browser on start
python server/server.py --host 0.0.0.0  # bind to all interfaces (default: 127.0.0.1)
```

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

Collections: `queue`, `commitments`, `summaries`, `drafts`, `aura`, `culture`, `growth`, `sources`, `audit`, `settings`, `work`, `discover`.

`discover` holds only public-space data (`listings`, `submissions`, `reviews`,
`categories`, `reviewCriteria`). It never reads the private collections. Its
seed listings are clearly labeled mock examples, and it seeds no reviews,
ratings or testimonials. Submissions and reviews begin with `status: "pending"`
and are not shown publicly until a human approves them.

All API responses include `Access-Control-Allow-Origin: *` for CORS.

## Discover and Aura AI preferences

- **Orbis Discover** is a public product-discovery surface inside Orbis
  (`#discover` in both apps). It supports browsing, category filters, search,
  listing details with maker attribution, maker submissions, and attributed
  reviews scored on three stated criteria.
- **Human approval gate.** New listings and reviews are stored as `pending` and
  are excluded from the public list. The local prototype includes a clearly
  labeled review queue so the approval step can be exercised; production would
  require a reviewer who is not the maker.
- **Honest seed data.** Seed listings are fictional and tagged `mock: true`.
  The app shows a "Mock example" badge, marks every maker claim "Unverified
  claim", and displays no rating until an approved review exists.
- **Separate data.** Discover uses the `discover` collection only. It does not
  read messages, commitments, Aura, or `work`, and no private data is used for
  public ranking or promotion.
- **Aura AI preferences** (`aura.aiPreferences`) store response length, tone,
  format, and whether to ask clarifying questions. They are self-set, never
  inferred from messages, and currently **saved but not applied** because the
  prototype has no live model. Aura offers a copy action so the preferences can
  be used in another tool, and states this limitation in the UI.

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
    app-mobile.html       # Mobile app variant
    mobile.html           # Mobile landing
    manifest.webmanifest  # PWA manifest
    sw.js                 # Service worker
    icons/orbit.svg       # App icon
  server/
    server.py             # Zero-dependency HTTP server
  tests/
    verify_api.py         # Hermetic API test (stdlib only)
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

Expected output: `41 passed, 0 failed` with exit code 0.

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
- Single-user, local-only storage (no authentication)
- Permissive CORS (`*`) suitable for development only
- No rate limiting or input validation beyond basic JSON parsing
- Not production-hardened

Use for local development, testing, and prototyping only.

## License

See the root [LICENSE](../../LICENSE).
