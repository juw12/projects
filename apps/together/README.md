# Together — our life plan

A private, offline life-planning app for couples: from dating to marriage, a home, kids,
and growing old side by side.

**Open it:** https://juw12.github.io/projects/together/ · **Demo with sample data:**
https://juw12.github.io/projects/together/?demo=1

- **Roadmap** across 10 life stages (dating → golden years); every milestone shows both
  partners' ages (and children's, once added) plus a lifeline to ~90.
- **Goals** shared or personal, broken into steps with progress.
- **Money** savings pots linked to milestones ("on track" / "needs X per month") and a
  rough retirement projection (not financial advice).
- **Us** monthly check-in with a connection trend, 15 "talk before you decide" topics,
  and a bucket list.
- **Home** "This month's focus": anniversaries, check-ins, next steps, backup reminders.
- **Data stays on the device** (localStorage, no account, no network). Export/import a
  JSON backup to share between partners; print the whole plan; calendar (.ics) reminders.

Single self-contained file: `web/index.html`. Built-in self-tests: open
`index.html?selftest=1` (results are written into the page; uses a separate storage key).
