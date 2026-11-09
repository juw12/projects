# VALE 2 — Stylized Open-World Fairy Realm (sequel)

> **Status: pre-commitment planning.** No code committed. This directory exists
> to host the pre-commitment scope scan and the MVP plan for VALE 2, the
> sequel to [`apps/vale/`](../vale/) (VALE 1, shipped). Code lives in
> VALE 1 today; this directory is the planning surface for VALE 2.

## What VALE 2 is (the brief)

A stylized open-world co-op sequel to VALE 1, codename **VALE 2** (unambiguous).

- **Engine:** Unity 6 LTS + HDRP 17.x (inheriting VALE 1's pipeline)
- **Platforms:** PC + PS5 + Xbox Series (target ordering: PC first, consoles post-launch)
- **Multiplayer:** up to 4-player co-op (deferred from MVP — see [PLAN.md](PLAN.md))
- **World:** procedural terrain, multiple biomes, ~10× the scale of VALE 1's forest
- **Content:** 50+ NPCs, 200+ quests (vs. ~6 NPCs and ~6 quests in VALE 1)
- **Languages:** full localization pipeline (English + 1 second language at MVP, 5+ post-launch)
- **Modding:** deferred — see [PLAN.md](PLAN.md) and the kill-switch

## Repo location

The Unity project itself would live at `github.com/juw12/vale-2` once work
starts. This monorepo's `apps/vale-2/` holds the *planning artifacts* that
anchor the build decisions before any Unity scene opens.

## What's in this directory

| File | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | MVP cut plan derived from the scope scan (~34-week evening budget) |
| [KILL-SWITCH.md](KILL-SWITCH.md) | Hard kill-criteria, written before any code, modeled on 12 Unity indie postmortems |
| [docs/SCOPE-SCAN.md](docs/SCOPE-SCAN.md) | The full 12-section pre-commitment scope & risk report |
| [docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md) | Architecture Decision Record (ADR) log: netcode, dialogue, save, streaming picks with rationale and trade-offs |
| [docs/ASSET-REUSE-MATRIX.md](docs/ASSET-REUSE-MATRIX.md) | Which of VALE 1's 41 .cs files / assets to reuse verbatim, extend, or replace |
| [docs/WEEK-1-STARTER.md](docs/WEEK-1-STARTER.md) | Day-by-day first-week plan: what to commit, what to test, what to stop if it's not fun |

## Honest starting position (read first)

**VALE 2 is not greenfield.** VALE 1 already exists in this monorepo as a
shipped single-player prototype: Unity 6 + HDRP 17.2, ~6 NPCs, 1 main quest,
5 Lumenshards, custom ScriptableObject dialogue, JSON saves. VALE 2 inherits
VALE 1's architecture and extends it — the asset-reuse matrix in `docs/`
classifies every VALE 1 file as "reuse verbatim," "extend," or "replace."

**VALE 2 is also larger than the original "10× VALE 1" framing.**
The reality, after mapping the codebase:

- ~10× NPCs (6 → 50+)
- **~40× quests** (6 → 200+)
- **+4 NEW capability categories**: multiplayer co-op, procedural open world,
  modding support, full localization pipeline
- **+2 NEW platform certifications**: PS5, Xbox Series

Treat the original 10× framing as a *lower bound*. The dominant root cause
across 12 Unity indie postmortems (11 of 12 cite scope > time/money as the
primary failure mode) is exactly this kind of multiplier being underestimated.

## The 5 binding constraints (one-line summary)

1. **HDRP is in maintenance mode** (Unity 2026 strategy) — no new rendering
   features. Build against a frozen API surface.
2. **Unity killed managed dedicated-server hosting** (March 2026) — relay
   costs are not zero anymore.
3. **NGO 3.0 requires Unity 6.7 LTS + Netcode for Entities hard dep** +
   the Boss Room learning sample is unmaintained. NGO 2.x is the
   current-stable path.
4. **No shipped 4-player co-op save system implements host migration** —
   all 5 surveyed games end the session when the host leaves. Plan
   accordingly.
5. **The dominant solo-dev failure mode is time/will, not money** — every
   solo postmortem (5/12) tells a 4–6.5-year story. The kill-switch is
   the single most under-used tool. [KILL-SWITCH.md](KILL-SWITCH.md) is
   written before any code.

## Maintainer

[@juw12](https://github.com/juw12)
