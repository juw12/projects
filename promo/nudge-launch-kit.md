# nudge launch kit

Ready-to-paste posts for [nudge](https://github.com/juw12/nudge).

One rule above all others: the project is a work in progress, "tested on sample data; real-export testing next." Keep that line visible somewhere in whatever you post. Do not drop it.

Links to reuse:
- Repo: https://github.com/juw12/nudge
- Live app: https://juw12.github.io/nudge/
- Demo (fake data): https://juw12.github.io/nudge/?demo=1

Author: Juwen Lie (@juw12), solo builder, R&D mechanical engineer in Batam, Indonesia. MIT license.

---

## 1. Show HN

**Title** (paste as-is):

```
Show HN: nudge - reads your own chat exports and shows who you've left on read
```

**First comment** (post it right after the link goes up):

> I'm the author (@juw12), a mechanical engineer who builds side projects.
>
> The problem: I keep doomscrolling reels while people I actually care about sit on read, and I only notice days later. A friend sends a link, I never reply, the moment passes, and there's no built-in way to see who you've been leaving on read.
>
> So I built nudge. It reads the chat export you already downloaded from Instagram, Messenger, WhatsApp, Telegram or iMessage, and it shows you who you've left on read, which specific shares (reels, links) you never answered, and a ready-to-send opener to reconnect.
>
> It's a Python CLI and an installable browser app (PWA). There's also a weekly digest with a desktop notification, and an iOS widget (Scriptable) that reminds you before you open Instagram or TikTok.
>
> On privacy: it runs 100% locally. No network calls, no accounts, no telemetry, pure Python standard library. It only reads export files you downloaded yourself from your own accounts. No scraping, no unofficial APIs, so it breaks no platform's terms.
>
> How it works: it parses each app's export format. A reply within a configurable window (48h by default) counts as responding to a share. Each contact gets a priority score that weighs recency, reply streaks (messages they sent in a row that went unanswered), who starts conversations after a silence, and a missed-to-shared ratio.
>
> One honest caveat: this is work in progress. I've tested it on sample data; real-export testing is next. Treat the demo as a preview, not a finished product.
>
> MIT licensed. Feedback welcome.
>
> Repo: https://github.com/juw12/nudge
> Demo (fake data): https://juw12.github.io/nudge/?demo=1

**Notes for posting:**
- HN asks for no LLM-written text. This reads like a person wrote it. If you edit it, keep it that way.
- Add the first comment immediately, before people arrive.

---

## 2. Reddit (three separate posts, three different angles)

Do not reuse a body across these. Each is written for one subreddit.

### 2a. r/selfhosted

**Title:**

```
nudge - a tool that reads your own chat exports and shows who you've left on read, 100% local (WIP)
```

**Body:**

> Quick heads-up: nudge is under three months old, and I believe r/selfhosted sends brand-new projects to the weekly New Project Megathread. If that applies, I'll post it there instead. Flagging it here first to be safe.
>
> What it is: a small tool that reads the chat export you already downloaded from Instagram, Messenger, WhatsApp, Telegram or iMessage, and shows you who you've been leaving on read. It points at the specific shares you never answered (a reel, a link) and gives you a ready-to-send opener to reconnect.
>
> Why it fits this sub: it's 100% local. No network calls, no accounts, no telemetry, no cloud. It's pure Python standard library, so the only dependency is Python itself. It reads export files that are already on your machine, which you downloaded from your own accounts. No scraping, no unofficial APIs.
>
> What's included: a Python CLI, an installable browser app (PWA), a weekly digest with a desktop notification, and an iOS widget (Scriptable) that reminds you before you open Instagram or TikTok.
>
> Honest status: work in progress. I've tested it on sample data so far, and real-export testing is the next step. I'm not claiming it's finished.
>
> I'm the author (solo, @juw12). MIT licensed. I'd genuinely like feedback, especially on whether the local-only design meets this community's bar.
>
> Repo: https://github.com/juw12/nudge
> Demo (fake data): https://juw12.github.io/nudge/?demo=1

> Reminder for me: read the r/selfhosted sidebar and rules before posting, and disclose that I'm the author (done above).

### 2b. r/SideProject

**Title:**

```
I built a tool that shows who I keep leaving on read, and it runs entirely on my machine
```

**Body:**

> Show and tell. I'm Juwen (@juw12), a mechanical engineer who builds side projects. This one came out of an annoying habit of my own: doomscrolling reels while real people I care about sit on read, and only noticing it days later.
>
> nudge reads the chat export you already downloaded from Instagram, Messenger, WhatsApp, Telegram or iMessage, and shows you who you've left on read. It tells you which specific shares you never answered and gives you a ready-to-send opener to reconnect.
>
> What's in it:
> - A Python CLI.
> - An installable browser app (PWA) you can open like a normal app.
> - A weekly digest with a desktop notification.
> - An iOS widget (Scriptable) that nudges you before you open Instagram or TikTok.
>
> The part I'm most proud of is the privacy design: it's 100% local. No network calls, no accounts, no telemetry, pure Python standard library. It only reads exports you download from your own accounts. No scraping, no unofficial APIs, so it breaks no platform's terms.
>
> Upfront about status: it's a work in progress. I've tested it on sample data; real-export testing is next. Treat the demo as a preview.
>
> I'd love feedback from people who've shipped something in this space. What would you build next, and what am I missing?
>
> Repo: https://github.com/juw12/nudge
> Live app: https://juw12.github.io/nudge/
> Demo (fake data): https://juw12.github.io/nudge/?demo=1

> Reminder for me: read the r/SideProject sidebar and rules before posting, and disclose that I'm the author (done above).

### 2c. r/privacy

**Title:**

```
A tool that makes zero network calls: it only reads the chat exports you already downloaded yourself
```

**Body:**

> I'll lead with the design, because it's the whole point.
>
> nudge shows you who you've been leaving on read across your chats. Here's how it does that with no privacy trade-off:
>
> - It runs 100% locally. Zero network calls. No accounts. No telemetry.
> - It's pure Python standard library. Nothing to phone home, nothing to install beyond Python.
> - It only reads the chat export files you download from your own accounts (Instagram, Messenger, WhatsApp, Telegram, iMessage). No scraping, no unofficial APIs, so it breaks no platform's terms.
> - Your data never leaves your machine. There is no server, and no "us" to leak it.
>
> So the data flow is: you export your own chats from the official apps, you point nudge at those files, and everything after that happens on your device.
>
> Once it has the data, it tells you who you left on read, which specific shares (reels, links) you never answered, and a ready-to-send opener to reconnect. It ships as a Python CLI and a PWA, plus a weekly digest and an iOS widget.
>
> Status, honestly: work in progress, tested on sample data so far, real-export testing next.
>
> I'm the author (solo, @juw12), MIT licensed. This sub is the right audience for the privacy design, so I'd value scrutiny of the local-only claims. What would you want to see to trust it?
>
> Repo: https://github.com/juw12/nudge
> Demo (fake data): https://juw12.github.io/nudge/?demo=1

> Reminder for me: read the r/privacy sidebar and rules before posting, and disclose that I'm the author (done above).

---

## 3. dev.to article

**Title:**

```
I built a tool that shows who you've left on read, using only your own chat exports
```

**Body:**

> You're scrolling. A friend sent you a link three days ago. You never replied, and the moment's gone. I wanted to see exactly that kind of thing, clearly, without a single byte leaving my machine. So I built nudge.
>
> **The problem**
>
> We have apps that track our attention down to the second, and none of them tell us who we're leaving on read. Personal CRMs like Monica (~25k stars) do the opposite job: you log people by hand. And the scroll-blockers cut your doomscrolling but never point you back to the people waiting. I wanted something in the gap: a tool that measures one specific thing, the attention people gave me that I never returned.
>
> **What I built**
>
> nudge reads the chat export you already downloaded from Instagram, Messenger, WhatsApp, Telegram or iMessage. It shows you who you've left on read, which specific shares (a reel, a link) you never answered, and a ready-to-send opener to reconnect. It ships as a Python CLI and an installable browser app (PWA), plus a weekly digest with a desktop notification and an iOS widget (Scriptable) that reminds you before you open Instagram or TikTok.
>
> **How it works**
>
> *Parsing the export.* Each app exports chats in its own format. nudge parses each one directly from the files on your machine. No network, no API, no scraping.
>
> *The reply window.* Getting a "you missed this" list is easy. Getting it right is harder. If you replied to a thread within a window, I count that as responding to the shares in it. The window is configurable and defaults to 48 hours. So a reel shared on Monday doesn't count as "left on read" if you replied in the conversation on Tuesday.
>
> *The priority score.* "Who should I actually text back?" is the useful question. Each contact gets a score that weighs:
> - Recency: how recent the unanswered attention is.
> - Reply streak: messages they sent in a row that went unanswered. The longer the run, the more it matters.
> - Who starts after silence: people who keep opening conversations after a quiet period get weighted up, because that's real interest.
> - Missed-to-shared ratio: how much they've shared versus how much you've returned.
>
> That score is what orders the "who's waiting on you" list, so the one person you should really text shows up on top.
>
> **The privacy design**
>
> This part matters to me more than the features. nudge is 100% local. No network calls, no accounts, no telemetry. It's pure Python standard library. It only reads the export files you download from your own accounts, so there's no scraping and no unofficial API, and it breaks no platform's terms. Your data never leaves your device, because there's no server and no one to hand it to.
>
> **Where it's at**
>
> Honestly: it's a work in progress. I've tested it on sample data so far, and real-export testing is the next step. I'm not claiming it's finished. If you poke at it, that's exactly the kind of feedback I want.
>
> **Try it / read the code**
> - Repo: https://github.com/juw12/nudge
> - Live app: https://juw12.github.io/nudge/
> - Demo (fake data): https://juw12.github.io/nudge/?demo=1
>
> MIT licensed. Built solo by @juw12, a mechanical engineer in Batam, Indonesia.
>
> *Disclosure: I used AI assistance in drafting parts of this post. Disclosing that per dev.to's rules.*

**Suggested tags:** `#showdev` `#python` `#cli` `#privacy` `#opensource` `#webdev`

> Reminder for me: use `#showdev` (not `#opensource`) as the primary project tag per dev.to's 2026 rules, and keep the AI-assistance disclosure line in the published post.

---

## 4. Assets & timing

### Assets to make (before you post)

- **The "Who's waiting on you" report.** A screenshot or short GIF of the ranked list, with a friend on top, the missed share visible, and the ready-to-send opener. This is the hero visual. Use the demo (`?demo=1`) so you never expose real data.
- **The one-line terminal summary.** A screenshot of the CLI printing the single line that says who's on read. It sells "it just runs locally" better than anything else.
- **The iOS widget nudge.** A short screen recording of the Scriptable widget appearing right before the Instagram/TikTok icon, so people see the "stop before you scroll" moment.

Where images are allowed, put one at the top of the post and keep the rest as text.

### Posting windows

- Show HN: Tuesday to Thursday, around 8:00 to 11:00 am US Eastern.
- Reddit: Tuesday to Thursday, 9:00 to 11:00 am US Eastern.

### Sequencing (one channel per day)

1. dev.to (let it land and collect early comments)
2. Show HN (strongest audience for the technical write-up)
3. r/selfhosted (or the weekly New Project Megathread, if the rule applies)
4. r/privacy (the design fits this audience hardest)
5. r/SideProject (show and tell)

Never cross-post the same body to more than one subreddit. The three Reddit posts above are written differently on purpose.

---

## 5. Rules you must not break

- Never ask for upvotes or points, not in the post, not in a comment.
- Never post the same text to more than one subreddit. Different sub, different words.
- Keep self-promotion under roughly 10% of your Reddit activity. Help on other people's posts most of the time.
- Always disclose that you're the author, in writing, in every post.
- Don't oversell a WIP. Keep the "tested on sample data, real-export testing next" line. No "production-ready", no made-up numbers, no invented testimonials.
