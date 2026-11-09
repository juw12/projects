# VALE 2 — Week 1 Starter Plan

> **Day-by-day plan for the first 7 days.** Concrete actions. No "research"
> filler. If week 1 isn't done by day 7, the kill-switch criteria become
> relevant (Kill 2: 3 consecutive months without playtest / progress
> signal).
>
> **Total week 1 evening budget:** ~10 hours (5 evenings × 2 hours each).

---

## Day 1 (Saturday) — Architecture decisions + kill-switch

**Goal:** Lock in 7 architecture decisions and re-read the kill-switch.

### Evening (2 hours)
- [ ] **Read KILL-SWITCH.md from top to bottom** (5 min)
- [ ] **Open [docs/ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md)** — review the 8 proposed ADRs
- [ ] **Make 8 explicit decisions** — write "ACCEPTED" + dated rationale on each ADR
- [ ] **Make 4 pending-decision decisions** (ADR-009 through ADR-012)
- [ ] **Commit the updated ADRs to git** as the foundational decisions

### Acceptance
- `docs/ARCHITECTURE-DECISIONS.md` has 12 ADRs, all ACCEPTED, all dated.
- KILL-SWITCH.md has been read aloud to yourself (or read slowly to yourself, aloud).

---

## Day 2 (Sunday) — Steam + devlog setup

**Goal:** Get the marketing loop running in month 1 (per postmortem corpus: 6/12 games failed from marketing neglect).

### Evening (2 hours)
- [ ] **Create Steam Coming-Soon page** with placeholder art (one VALE 1 screenshot is fine)
- [ ] **Write first devlog post:** "VALE 2 — What I'm building and why"
- [ ] **Open a Mastodon / Bluesky / X account** for the project (pick one; don't spread)
- [ ] **Subscribe to 5 Unity indie dev blogs** for context (optional but recommended)

### Acceptance
- Steam Coming-Soon URL exists; you can share it with one person and they can wishlist.
- First devlog post is live; pinned to your profile.
- Marketing channel is open (the rest is discipline, not setup).

---

## Day 3 (Monday) — VALE 1 reuse audit

**Goal:** Confirm which VALE 1 files you'll copy as-is vs. extend.

### Evening (2 hours)
- [ ] **Open [`docs/ASSET-REUSE-MATRIX.md`](../docs/ASSET-REUSE-MATRIX.md)** in a separate window
- [ ] **For each "EXTEND" file:** write a 1-line note on what to add (network hooks? localization? conditions?)
- [ ] **For each "REPLACE" file:** write a 1-line note on the replacement (mostly Yarn Spinner adapter)
- [ ] **For each "REUSE VERBATIM" file:** do nothing (it's already correct)
- [ ] **Decide: GitHub repo strategy**
  - Option A: `juw12/vale-2` (new repo, starts fresh)
  - Option B: `apps/vale-2/` subfolder of this monorepo (reuses monorepo CI/conventions)
  - **Recommendation: Option B** (the planning artifacts are already in this monorepo)

### Acceptance
- For each of the 17 EXTEND files, you have a 1-line "what to add" note.
- For each of the 2 REPLACE files (Yarn Spinner swap), you have a 1-line replacement note.
- You know whether the Unity project lives in this monorepo or a new repo.

---

## Day 4 (Tuesday) — Yarn Spinner trial

**Goal:** Prove the Yarn Spinner + Unity integration works on your machine.

### Evening (2 hours)
- [ ] **Open a scratch Unity 6 project** (don't pollute VALE 1)
- [ ] **Install Yarn Spinner for Unity** via Package Manager (com.yarnspinner.unity)
- [ ] **Create one `.yarn` file** with a 5-line dialogue + 1 choice
- [ ] **Verify** the dialogue plays in editor
- [ ] **Wire it up** to a placeholder `DialogueRunner` extension — confirm the existing `choice.advanceObjective` pattern still works
- [ ] **Decide:** Yarn Spinner or stay with VALE 1's custom system. (Recommendation: Yarn Spinner per ADR-003.)

### Acceptance
- A `.yarn` file plays in Unity.
- A choice can trigger an objective advancement via the existing `advanceObjective` hook.
- You've made the ADR-003 decision definitively.

---

## Day 5 (Wednesday) — Save system chunked-write sketch

**Goal:** Prove the chunked-save + completion-marker pattern (Valheim 1.0) works.

### Evening (2 hours)
- [ ] **Open the scratch Unity project from Day 4**
- [ ] **Sketch a `ChunkedSaveWriter` class** — write `_world.N.chunk` + `_world.N.ok` files atomically
- [ ] **Sketch a `ModDataBag` schema** — namespace + version byte + key→object dictionary
- [ ] **Test it:** save 5 chunks, kill the editor mid-write, restart, verify the `_world.N.ok` marker catches the partial state
- [ ] **Commit the sketch** (don't merge into VALE 1)

### Acceptance
- A chunked save + restore roundtrip works.
- A simulated mid-write crash is recoverable (the `.ok` marker protects the partial state).
- You know the API surface for VALE 2's `SaveSystem` extension.

---

## Day 6 (Thursday) — Vertical-slice task breakdown

**Goal:** Break the ~34-week MVP plan into concrete week-2-week-12 tasks.

### Evening (2 hours)
- [ ] **Open [PLAN.md](../PLAN.md)** — review the subsystem estimates
- [ ] **For each subsystem:** write 3-5 bullet points of "what does week 2 of this subsystem look like"
- [ ] **For each subsystem:** identify the **first concrete deliverable** (the first thing you'd commit)
- [ ] **Sequence the subsystems** by dependency: what can start week 2 vs. needs to wait for what?
- [ ] **Write the result** as `docs/WEEK-2-TO-WEEK-12.md`

### Acceptance
- You know exactly what to commit on day 8 (Monday of week 2).
- You know the dependency order: HDRP → world streaming → dialogue → quest → save/load → UI → audio → achievements → localization → polish/QA.
- You have a written plan for 12 weeks.

---

## Day 7 (Friday) — Kill-switch check + decision point

**Goal:** Re-read the kill-switch and decide whether to commit to VALE 2.

### Evening (2 hours)
- [ ] **Re-read KILL-SWITCH.md**
- [ ] **Answer in writing:**
  1. Is the vertical slice idea still fun to me? (if no → Kill 1)
  2. Did I make progress on VALE 2 every day this week? (if no → Kill 5)
  3. Do I have a clear Week 2 starter task? (if no → back to Day 6)
  4. Am I still willing to commit ~10 hours/week for 12 months? (if no → stop here)
- [ ] **Make the commit decision:**
  - **Yes:** write a "VALE 2 — I'm committing" devlog post; share on your marketing channel
  - **No:** write a postmortem; capture what you learned; move on
  - **Maybe:** defer the decision 1 week; set a reminder

### Acceptance
- You've made an honest, written, irreversible decision.
- If yes, the project is alive. Begin Week 2 Monday.
- If no, the project dies with dignity. The postmortem is the most valuable artifact you produce.

---

## After Week 1

The rest of the project follows the `docs/WEEK-2-TO-WEEK-12.md` plan you wrote on Day 6. The kill-switch re-reads monthly. The devlog cadence is weekly. The Steam Coming-Soon page is updated with each milestone.

**The single most important rule:** if at any point you find yourself adding a feature to MVP scope, stop. Re-read KILL-SWITCH.md #3 ("Feature creep after month 3"). Add it to a `docs/POST-MVP-BACKLOG.md` instead.

Good luck. 🫡
