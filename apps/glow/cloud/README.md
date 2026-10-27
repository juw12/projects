# Glow instant cloud browser

A Cloudflare Worker that gives GlowLead a short-lived hidden browser (Cloudflare Browser Rendering) and drives
it through the shared Glow Hands core, with the same safety rules as Glow Hands on a PC.

API (only `ALLOWED_ORIGINS` may call it):

- `GET /v1/status`
- `POST /v1/sessions` starts a browser (kept 5 minutes after the last call; GlowLead opens it at the first browser step)
- `POST /v1/sessions/<id>/call` with `{ "path": "status" | "observe" | "act" | "close", "body": {...} }`

Glow Pro plans (free to run, nothing stored):

- `GET /v1/plans`: whether Pro is on sale, its checkout link and price label (from `wrangler.toml` vars)
- `POST /v1/license` with `{ "action": "activate" | "validate" | "deactivate", "licenseKey", "instanceId", "device" }`:
  checks a Lemon Squeezy license key (License API, no secret key) and answers `{ pro: true | false }`. Keys from
  another store or product, ended subscriptions and malformed keys never give Pro.
  Test: `node --test test/license.test.js`.

Errors are explained to the phone: 429 when the shared free daily browser time is used up, 503 when no
browser is available, 410 when a session has ended.

Test locally with a real Chromium: `GLOW_PLAYWRIGHT_CORE=<playwright-core package> node --test test/service.test.js`.
Deploy: `.github/workflows/glow-cloud-worker.yml` (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
