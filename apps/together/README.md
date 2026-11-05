# Together — our life plan

A private life-planning app for couples: from dating to marriage, a home, kids, and growing old side by side.

**Open it:** https://juw12.github.io/projects/together/ · **Demo with sample data:** https://juw12.github.io/projects/together/?demo=1

- **Roadmap** across 10 life stages (dating → golden years); every milestone shows both partners' ages
  (and children's) plus a lifeline to ~90.
- **Goals** shared or personal, broken into steps.
- **Money**: savings pots linked to milestones, a retirement planner with inflation, fees and a
  "how much do we need" target, education funds per child, and a net-worth tracker.
- **Us**: monthly check-in with a connection trend, "talk before you decide" topics, a bucket list, and
  **Foundations** — an 8-week program summarising published relationship research (Gottman Institute,
  PREP) with sources. Educational, not therapy.
- **Partner sync**: one plan on both phones. End-to-end encrypted — the plan is sealed with AES-GCM on the
  device; the key travels only in the pairing link's `#fragment`, which never reaches the server.
  Edits merge item by item (newest edit wins, deletions tracked).
- **Reminders**: installable PWA with push notifications for check-ins, milestones, anniversaries,
  birthdays and backups. The server stores only *when* to ping; reminder text stays on the device.
  (iPhone/iPad: Add to Home Screen first, iOS 16.4+.)
- Works offline; export/import backups; print the whole plan; calendar (.ics) reminders.

## Layout

- `web/` — the app (`index.html`, service worker `sw.js`, manifest, icons). Published by GitHub Pages.
- `cloud/` — Cloudflare Worker + Durable Objects (`together-cloud`): encrypted sync rooms and the push
  scheduler. Deployed by `.github/workflows/together-cloud.yml`; the VAPID signing key is the
  `TOGETHER_VAPID_PRIVATE_JWK` repository secret.

## Tests

Open `index.html?selftest=1` — built-in tests for sync merge rules, encryption, two simulated phones
syncing through a mock server, money math, reminders, XSS and real-DOM flows. Add `&cloud=1` on the
published site to also run the live sync and push-scheduler tests against the deployed worker.
