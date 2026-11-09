# VALE 2 — KILL-SWITCH CRITERIA

> **Write this before writing any code.** Re-read monthly.
>
> **Why this exists:** 11 of 12 Unity indie postmortems surveyed for
> the scope scan cite "scope was bigger than the team's time and money"
> as the primary root cause of failure. **5 of those 12 are solo-dev
> postmortems** (FOMOGRAPHY 6.5 years, Crumbling World debt, Drunk
> Shotgun $30 earned on $4k spent, Dukes 0.3% funded, Chains of Fury
> 5 years). The single most under-used tool across every postmortem
> is **a kill-switch written down in advance.** This is yours.

---

## The 5 hard kill conditions

If **any one** of these is true at the indicated checkpoint, **stop.**
Do not continue. Do not "try one more month." Sunk cost is sunk.

### Kill 1 — Fun not present by month 6

**Trigger:** 6 months of evenings have passed and the vertical slice
(1 biome, 5 NPCs, 5 quests, dialogue, save/load, 60fps PC) is not fun
when 5 strangers play it.

**Source pattern:** FOMOGRAPHY (mid-dev playtest — "the game felt so
unfocused and all over the place"), Crumbling World ("I probably needed
around a month to properly test and debug the game").

**Action:** Stop. Capture the slice as-is, release as a free playable
demo or scrap. Do not rebuild.

### Kill 2 — No playtest for 3 consecutive months

**Trigger:** 3 consecutive calendar months pass without an outside
playtest (5 strangers, not friends, not you).

**Source pattern:** Drunk Shotgun ("tested it on the same people every
time… they were simply not the intended game audience"), FOMOGRAPHY
("I didn't do a full game play test until the game was pretty much done…
600 bugs").

**Action:** Stop. If you can't recruit 5 strangers in 3 months, the
audience-fit signal is broken — the project is being built for no one.

### Kill 3 — Feature creep after month 3

**Trigger:** Any feature is added to the MVP scope after month 3 of
active development.

**Source pattern:** Upsilon Circuit ("scope of the game was too ambitious
and we underestimated the time and money needed… Instead of scaling the
project back when we realized our money would run out long before
release, we pushed ourselves harder"), Code Hero (over-funded → added MMO
+ documentary → outran runway), Crumbling World ("I should have focused
my efforts on polishing up the version of the game that was already
working properly").

**Action:** Stop. The MVP scope is frozen. New features are post-launch.

### Kill 4 — Wishlist growth below 100/month at month 6

**Trigger:** Steam wishlist growth is below 100/month at month 6 of
active development.

**Source pattern:** UnnyWorld ("invested almost nothing in marketing. We
hoped that players would arrive organically. The game never reached the
critical mass"), Drunk Shotgun ($30 total revenue on a finished game),
FOMOGRAPHY (financial loss on a 6.5-year solo project).

**Action:** Stop or pivot audience strategy. If 100/month wishlist
growth is not happening, the audience-fit signal is broken — no amount
of extra development will sell the game to people who aren't already
interested.

### Kill 5 — 3 consecutive weeks of avoidance

**Trigger:** 3 consecutive weeks pass without working on VALE 2
(where "working on" means opening the project, even if just reading
code).

**Source pattern:** Every solo postmortem named this. FOMOGRAPHY
("New Pokemon Snap hit hard… should I keep at it?" identity crisis),
Upsilon Circuit ("nervous breakdown or two"), Chains of Fury ("blood,
mental breakdowns, almost a divorce"), Scarlet Republics (CEO health
collapse).

**Action:** Stop. The project is dead to you. The sunk cost is real but
the remaining cost is your time and health. Continuing past this point
is the exact pattern that produces 6.5-year solo projects with 600 bugs
and 141 sales.

---

## What "stop" means

Stopping is not the same as deleting the repo. Stopping means:

1. **Capture the current state as a release** — even if it's a small
   free demo, ship it. Do not let the work disappear.
2. **Write a postmortem** — what worked, what didn't, what you'd do
   differently. This is the most valuable artifact you produce.
3. **Move on.** Solo dev has limited time. Use it elsewhere.

Every postmortem in the corpus (12/12) was written by someone who
shipped or who deliberately stopped. None of them regret stopping.
Several of them regret *not* stopping earlier.

---

## Re-evaluation points (not kills, but pauses)

These are NOT kill conditions, but they are *re-evaluation* triggers.
When you hit one, write a 1-page note in `docs/RE-EVALUATIONS.md`
describing the situation and your next decision.

- **Month 3:** First vertical slice playtest. Fun? Not fun?
- **Month 6:** Mid-development checkpoint. On track? Off track?
- **Month 9:** Content-complete checkpoint. QA buffer adequate?
- **Month 11:** Pre-release. Are you shipping the right game?

---

## The discipline

Read this file on the 1st of every month. It takes 5 minutes. If you
can't bring yourself to read it, that's the kill signal — start
Kill 5 immediately.

The hardest thing about solo dev is not the code. It is the willingness
to kill a project you love. This file is the institutional memory of
that willingness.

---

*Modeled on the failure patterns of 12 Unity indie postmortems surveyed
for [docs/SCOPE-SCAN.md](docs/SCOPE-SCAN.md). Cite this file when
explaining to yourself why stopping is the right move.*
