# Together — our life plan

A private life-planning app for couples: from dating to marriage, a home, kids, and growing old side by side.

**Open it:** https://juw12.github.io/projects/together/ · **Demo with sample data:** https://juw12.github.io/projects/together/?demo=1

- **Roadmap** across 10 life stages (dating → golden years); every milestone shows both partners' ages
  (and children's) plus a lifeline to ~90 — including the later-life conversations people put off
  (caring for parents, a retirement check, where to live as you age, wills and powers of attorney).
- **Goals** shared or personal, broken into steps.
- **This week together** (Home): each savings pot's weekly target (monthly plan × 12 / 52, or what a pot
  behind its milestone really needs), with a per-day figure, what each of you put in this week and a quick
  **+ Add**; each partner's share (equal or by income), your weekly saving streak, active challenges, the
  next goal step and a date-night idea to tick off. A Sunday-evening reminder nudges you before the week ends.
- **Money**: savings pots linked to milestones, a retirement planner with inflation, fees and a
  "how much do we need" target, education funds per child, and a net-worth tracker. Import a bank-statement
  CSV to see your real monthly surplus (parsed on the device only — no bank login, nothing uploaded).
- **Shared piggy bank**: every deposit is logged with who added it (you, your partner, or together) and a
  date, so each pot shows "added so far" per partner and a short history. Each deposit is its own synced
  record, so two phones adding money at the same moment both count. Pots can be linked to a bucket-list
  dream ("Save" on the Us tab), which then shows how much of it is saved.
- **Financial freedom**: your freedom number (yearly spending you want ÷ safe withdrawal rate), how far
  along you are, the projected date with both your ages, how much sooner 10% more saving gets you there,
  and one tap to put "Financially free" on the roadmap. Uses the retirement planner's assumptions.
- **Income & savings rate**: both incomes, how the monthly saving splits between you (50/50 or in proportion
  to income), and a savings-rate table showing how many years to financial freedom at 10–50% saved.
- **Debt-free plan**: list loans and cards, pick avalanche (highest rate first) or snowball (smallest first)
  plus an extra monthly payment; see each debt's payoff date, total interest, and how much sooner you're
  free once the freed-up payments go into investing.
- **Saving challenges & streaks**: 52-week challenge and no-spend weekends (ticking one logs a deposit), and
  a streak counter for consecutive weeks you hit the weekly target, with milestone toasts.
- **Date nights & fun money**: a monthly fun budget, an idea list, and a log of dates you actually did.
- **Mint numbers**: if you also use the Mint budget app on the same phone/browser, this month's spending
  and saving from your Mint books show on the Money tab (read-only, never changed).
- **Kids' plans**: an investment or deposit plan per child and goal (primary school, junior/senior high, university,
  or your own), in a time deposit, money-market fund, retail government bonds (SBN), an index fund, gold or anything
  else, with an editable rate and tax on growth (presets follow Indonesia's rules: 20% on deposit interest, 10% on SBN
  coupons, none on fund gains). A chart shows what you put in versus what it earns up to the target age, the goal
  with education inflation, and what closes any gap (more per month, or the growth rate you'd need). Log deposits
  (who added them) and the real balance now and then, and the app works out your **real yearly growth rate**
  (money-weighted) next to the plan's. "Plan it" on Education funds pre-fills one; the weekly target shows on Home.
- **Trips & honeymoon**: plan flights, stay per night, food per day, activities, transport and shopping plus a buffer;
  one tap makes a savings pot tied to a roadmap milestone (the Honeymoon one if you have it), so it gets a weekly
  target on Home. While away, log spending to see what's left per day; afterwards, how you did against the plan.
- **Rupiah-friendly**: with currency Rp/IDR, amounts show as "Rp 1.500.000" and money fields accept
  shorthand like `250rb`, `1,5jt` or `Rp 25.000`.
- **Us**: monthly check-in with a connection trend, "talk before you decide" topics, a bucket list, and
  **Foundations** — an 8-week program summarising published relationship research (Gottman Institute,
  PREP) with sources. Educational, not therapy.
- **Partner sync**: one plan on both phones. End-to-end encrypted — the plan is sealed with AES-GCM on the
  device; the key travels only in the pairing link's `#fragment`, which never reaches the server.
  Optional shared passphrase (PBKDF2, 600k rounds) so a leaked link alone can't read or change the plan, and
  **Replace link** to rotate the key and delete the old room. Edits merge field by field (two partners
  editing different fields or steps of the same goal both keep their change; only the very same field is
  newest-wins). Rooms are kept while either partner opens the app; deleted after 400 days of no use.
- **Reminders**: installable PWA with push notifications for check-ins, milestones, anniversaries,
  birthdays and backups. The server stores only *when* to ping; reminder text stays on the device.
  "Send a test" pushes through the real server → push service → phone path. (iPhone/iPad: Apple requires
  Add to Home Screen first and iOS 16.4+; the app shows step-by-step guidance and detects in-app browsers.)
- Works offline; export/import backups — optionally **password-locked** (AES-GCM, PBKDF2 600k rounds, so a
  backup left in Downloads or e-mail doesn't expose your plan); print the whole plan; calendar (.ics) reminders.
- **Light / dark / system appearance** (per device, applied before first paint) and a calm, emoji-free
  interface with one consistent line-icon set.
- **Accessible**: every control has an accessible name, text meets WCAG AA contrast in light and dark mode,
  visible keyboard focus, labelled dialogs (checked by an automated audit on every tab).

## Layout

- `src/` — the app's source, split by concern: `index.html` (page shell), `styles.css`, and `js/NN-*.js`
  (constants, utils, calculations, bank CSV, reminders, sync merge / crypto / room client, store, views,
  actions, demo data, self-tests, boot). Plain classic scripts sharing one scope — no bundler.
- `build.py` — inlines `src/` into the single self-contained `web/index.html` (so the published app stays
  one offline file). Edit `src/`, then run `python apps/together/build.py`; CI runs `--check`.
- `web/` — the published app (`index.html` built from `src/`, service worker `sw.js`, manifest, icons).
- `cloud/` — Cloudflare Worker + Durable Objects (`together-cloud`): encrypted sync rooms and the push
  scheduler. Deployed by `.github/workflows/together-cloud.yml`; the VAPID signing key is the
  `TOGETHER_VAPID_PRIVATE_JWK` repository secret.

## Tests

Open `index.html?selftest=1` — built-in tests for sync merge rules, encryption, two simulated phones
syncing through a mock server, money math, reminders, XSS and real-DOM flows. Add `&cloud=1` on the
published site to also run the live sync and push-scheduler tests against the deployed worker.
