# nudge — social posts (LinkedIn + X)

Companion to `nudge-launch-kit.md`. These are the **social → GitHub** posts: the
strongest lever you're currently not using.

Keep the honesty line in whatever you post: **work in progress, tested on sample
data, real-export testing next.** Never ask for follows/upvotes, and disclose
it's your own project.

Assets to attach: the "Who's waiting on you" GIF, the CLI one-line screenshot,
the iOS widget clip (pick one; visuals beat links).

Links:
- Repo: https://github.com/juw12/nudge
- Live app: https://juw12.github.io/nudge/
- Demo (fake data): https://juw12.github.io/nudge/?demo=1

---

## LinkedIn

Post Tuesday to Thursday, morning in your audience's timezone. Attach the GIF.
Only the first ~2 lines show before "see more", so the hook has to land fast.

```
I built a small tool because I kept leaving my friends on read.

Not on purpose. I'd be scrolling reels, and meanwhile someone I actually care
about had sent me something days ago. I only noticed when it was too late to
reply naturally.

So I built nudge. It reads the chat export you already downloaded from
Instagram, WhatsApp, Telegram or iMessage, and shows you who you've been
leaving on read: the specific reels and links you never answered, and a
ready-to-send opener to reconnect.

The part I care about most is how it runs. It's 100% local. No network calls,
no account, no telemetry, and it's pure Python standard library. It only reads
export files you downloaded from your own accounts. Nothing leaves your machine.

How it works, briefly: a reply within 48 hours counts as answering a share.
Each friend gets a priority score built from recency, how many messages they've
sent without an answer, who starts conversations after a silence, and the ratio
of what they've shared to what you've returned. The people who matter most
float to the top.

It ships as a Python CLI and an installable browser app, plus a weekly digest
and an iOS widget that nudges you before you open Instagram.

Honest status: it's a work in progress. I've tested it on sample data;
real-export testing is next.

I'm an R&D mechanical engineer who builds software on the side, and this one
came out of a habit I wanted to fix. If it sounds like you too:

Repo: https://github.com/juw12/nudge
Try the demo (fake data): https://juw12.github.io/nudge/?demo=1

#buildinpublic #opensource #python #privacy
```

---

## X (Twitter) — single tweet

Use this if you only want to post once.

```
Your friends keep sending you reels.
You keep scrolling past them.

nudge reads your own chat exports (Instagram, WhatsApp, Telegram, iMessage) and
shows who you've been leaving on read, plus an opener to reply.

100% local, no account, pure Python stdlib.

https://github.com/juw12/nudge
```

---

## X (Twitter) — thread

Post the thread with the GIF/video attached to tweet 1, then pin it.

```
1/
Your friends keep sending you reels.
You keep scrolling past them. 🧵

I built nudge: it reads your own chat exports and shows who you've been
leaving on read.

2/
The problem isn't that we don't care. It's that the feed buries the people who
matter. A reel sent in a DM is a small "I thought of you" — and it disappears
under the same infinite scroll it came from.

3/
nudge reads the export you already downloaded from Instagram, WhatsApp,
Telegram or iMessage.

It shows:
- who's waiting on a reply
- which reels/links you never answered
- a ready-to-send opener to reconnect

4/
How it runs (the part I care about):
- 100% local, no network calls
- no account, no telemetry
- pure Python standard library
- reads only your own exports, no scraping, no unofficial APIs

Your data never leaves your machine.

5/
How it decides: a reply within 48h means you answered the share. Each friend
gets a priority score from recency, unanswered streaks, who reaches out after
silence, and missed/shared ratio. The people who matter float up.

6/
Ships as:
- a Python CLI
- an installable browser app (PWA)
- a weekly digest + desktop notification
- an iOS widget that nudges you before you open Instagram

7/
Status, honestly: work in progress. Tested on sample data; real-export testing
next.

If you've been leaving friends on read too:

Repo: https://github.com/juw12/nudge
Demo (fake data): https://juw12.github.io/nudge/?demo=1
```

---

## Timing & rules

- **LinkedIn:** Tuesday to Thursday, morning. One post. Attach the GIF.
- **X:** the thread can go any weekday; attach visuals to tweet 1 and pin it.
- **Sequence:** don't fire everything on day one. A clean order is dev.to → Show
  HN → Reddit → social (LinkedIn + X). One channel per day.
- **Do:** lead with the problem, keep the WIP caveat, answer every reply.
- **Don't:** ask for follows or upvotes, use hype words, or claim it's finished.
