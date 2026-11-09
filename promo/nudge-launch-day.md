# nudge — launch day plan (run the whole launch from here)

One file to run the launch. It points at the copy that already exists:
- Posts (Show HN, Reddit, dev.to): `promo/nudge-launch-kit.md`
- Social (LinkedIn, X): `promo/nudge-social-posts.md`

Links:
- Repo: https://github.com/juw12/nudge
- Live app: https://juw12.github.io/nudge/
- Demo (fake data): https://juw12.github.io/nudge/?demo=1

The one line that must survive every post: **work in progress, tested on sample
data, real-export testing next.**

---

## T-1 — the day before

- [ ] Make three assets and save them in `promo/assets/`:
  - `who-waiting.gif` — the "Who's waiting on you" report (hero visual).
  - `cli-oneliner.png` — the CLI printing the one-line summary.
  - `ios-widget.mp4` — the widget nudge before Instagram opens.
- [ ] Open the demo on a real phone: https://juw12.github.io/nudge/?demo=1 (confirm it works).
- [ ] Confirm the repo README top shows the demo link and a star badge.
- [ ] Pin `nudge` on your GitHub profile (Edit profile -> Pinned items).
- [ ] Set profile fields: bio, website, LinkedIn (see the follower playbook).
- [ ] Log in to every account you'll post from: Hacker News, Reddit, dev.to,
      LinkedIn, X. (Reddit: have some non-promo history so you don't look like a
      drive-by.)
- [ ] Keep this file + the two copy files open in tabs.

## Launch sequence — one channel per day

Do **not** fire everything on day one. Different communities, different words.

### Day 1 — dev.to
- [ ] Publish the article from `nudge-launch-kit.md` section 3.
- [ ] Tags: `#showdev` `#python` `#cli` `#privacy` (use `#showdev`, not `#opensource`).
- [ ] Keep the AI-assistance disclosure line.
- [ ] Reply to every comment for 48 hours.

### Day 2 — Show HN
- [ ] Post Tuesday to Thursday, ~8-11am US Eastern.
- [ ] Title + first comment from `nudge-launch-kit.md` section 1.
- [ ] Add the first comment immediately, before people arrive.
- [ ] Stay in the thread all day. Answer skeptics with something they can run.
- [ ] Never ask for upvotes.

### Day 3 — r/selfhosted
- [ ] If the repo is under 3 months old, use the weekly New Project Megathread.
- [ ] Post from `nudge-launch-kit.md` section 2a.

### Day 4 — r/privacy
- [ ] Post from `nudge-launch-kit.md` section 2c.
- [ ] Invite scrutiny of the local-only claims.

### Day 5 — r/SideProject
- [ ] Post from `nudge-launch-kit.md` section 2b.

### Day 6 — LinkedIn + X
- [ ] LinkedIn post (Tuesday to Thursday, morning), attach the GIF.
- [ ] X thread, attach the GIF to tweet 1, then pin it.
- [ ] Copy from `promo/nudge-social-posts.md`.

## Post-launch

- [ ] **T+2:** clear any remaining comments and fix any bug that got reported.
- [ ] **T+7:** post a short "what I learned launching nudge" update. Build in
      public is a second visibility bump for free.
- [ ] **T+30:** one monthly update note.
- [ ] Thank everyone who opened an issue or a PR; those people are your first
      followers.

## Rules (recap)

- Never ask for upvotes, points or follows.
- Never post identical text to two subreddits.
- Keep Reddit self-promotion under roughly 10% of your activity.
- Always disclose you're the author.
- Don't oversell a WIP. Keep the sample-data caveat.

## Tracking

Log once a day while the launch is live. Keep it simple:

| Day | GitHub stars | Repo views | Demo visits | Notes |
| --- | --- | --- | --- | --- |
| D1 |  |  |  | dev.to live |
| D2 |  |  |  | Show HN |
| D3 |  |  |  | r/selfhosted |
| D4 |  |  |  | r/privacy |
| D5 |  |  |  | r/SideProject |
| D6 |  |  |  | LinkedIn + X |

Stars: the repo page. Views: repo **Insights -> Traffic**. Demo visits: any
analytics you have on the page, or leave blank.

## What "done" looks like

You're done launching when the thread/comments have gone quiet and you've logged
the week. A first launch usually lands tens of stars, not thousands. The point
is the compounding: the SEO from the dev.to post and the Search/Explore index
keep working long after the launch week ends.
