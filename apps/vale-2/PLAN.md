# VALE 2 — MVP CUT PLAN

> **Source:** Derived from `docs/SCOPE-SCAN.md` (12-section pre-commitment
> scope & risk report). This is the executable plan, not the analysis.
>
> **Budget:** ~1 year of evenings (~300 dev hours/yr). Solo dev (juw12).
> **Goal:** ship a *complete, fun, shippable small game* in 12 months,
> not "all the features I imagined" (see [KILL-SWITCH.md](KILL-SWITCH.md)).

---

## 1. The cut (the single most important decision)

The original brief framed VALE 2 as "10× VALE 1" with co-op multiplayer,
procedural world, modding, and localization. After the scope scan, the
**honest cut** is:

| Category | In MVP? | When added |
| --- | --- | --- |
| **Stylized HDRP fairy-world aesthetic** (the IP) | ✅ **IN** | Day 1 |
| First-person movement + flight toggle (VALE 1) | ✅ **IN** | Day 1 |
| Procedural terrain (multiple biomes) | ⚠ **REDUCED** | 1.5× current VALE 1 forest, hand-curated; true procedural post-launch |
| **Core dialogue** (extend VALE 1 `DialogueRunner` + add Yarn Spinner) | ✅ **IN** | Day 1 |
| Quest system (~30 hand-crafted quests at MVP, 200+ post-launch) | ✅ **IN** | Day 1 |
| **Inventory + crafting** (small, ~20 recipes at MVP) | ✅ **IN** | Day 1 |
| **PC platform support** | ✅ **IN** | Day 1 |
| **Save/Load** (chunked, seed-based, mod-aware schema from day 1) | ✅ **IN** | Day 1 |
| **UI** (UI Toolkit + DOTween + a starter template) | ✅ **IN** | Day 1 |
| **Audio** (Unity built-in at MVP) | ✅ **IN** | Day 1 |
| **Achievements** (Steam-only at MVP) | ✅ **IN** | Day 1 |
| **Localization** (English + 1 second language at MVP) | ⚠ **REDUCED** | English + 1 (probably zh-TW) at MVP; 5+ post-launch |
| **Multiplayer co-op** (4-player NGO) | ❌ **CUT FROM MVP** | Post-launch stretch (adds ~3-5 man-months + 4-player state reconciliation) |
| **Procedural open world** (true procedural terrain) | ❌ **CUT FROM MVP** | 1.1+ — use VALE 1 forest at 10× scale first |
| **200+ quests** (full content scope) | ⚠ **REDUCED** | ~30 hand-crafted at MVP; system built, content scaled post-launch |
| **Modding** | ❌ **CUT PERMANENTLY** | Multi-year; deferred indefinitely |
| **PS5 + Xbox Series certification** | ❌ **CUT FROM MVP** | PC-first; add consoles when core is stable (requires devkit lead time + $20-50k cert budget) |
| **Custom audio middleware** (FMOD/Wwise) | ❌ **CUT FROM MVP** | Unity built-in covers MVP; FMOD/Wwise post-launch if needed |
| **Achievements** (full cross-platform) | ⚠ **REDUCED** | Steam-only at MVP; PSN/Xbox post-launch with console port |

**What this leaves:** a stylized single-player PC open-world fairy game
with branching dialogue, ~30 quests, English + 1 language, ~1.5× the
scale of VALE 1's forest, save/load, achievements, and the architecture
to extend with multiplayer + procedural + consoles post-launch without
rewriting.

---

## 2. The recommended scope (the executable cut)

| Subsystem | Approach | Cost (evenings) |
| --- | --- | --- |
| HDRP + 60fps PC | TAA + DRS + (FSR/DLSS upscale), 2 HDRP Assets (PC + future console stripped), 1.5× VALE 1 forest scale | **~6 weeks** |
| World streaming | SECTR ($99) OR hand-roll around `CullingGroup` + APV streaming + Additive Scene loading | **~4 weeks** |
| Dialogue | Extend VALE 1 `DialogueRunner` (reusable) + Yarn Spinner (free tier) as authoring language | **~3 weeks** |
| Quest | Reuse VALE 1 `QuestManager` / `Quest` / `QuestData` / `Objective` (extend for branching state + conditions) | **~3 weeks** |
| Inventory | Hand-roll on VALE 1 `CollectibleManager` pattern OR ItemForge ($12) | **~2 weeks** |
| Crafting | ~20 recipes, simple data table + UI; reuse ItemForge if bought | **~2 weeks** |
| Save/Load | Extend VALE 1 `SaveSystem`: chunked, seed-based, versioned schema, mod-aware data bag from day 1 (Valheim 1.0 pattern) | **~3 weeks** |
| UI | UI Toolkit (free) + DOTween (free) + Fantasy RPG UI Toolkit Starter ($5.99); extend VALE 1's existing UI files | **~3 weeks** |
| Audio | Unity built-in (defer FMOD/Wwise); extend VALE 1 `AudioManager` (4 ambient channels already) | **~1 week** |
| Achievements | Steamworks.NET (free); Steam-only | **~1 week** |
| Localization (en + 1) | Unity Localization (free); reuse VALE 1's string fields | **~2 weeks** |
| Polish + QA buffer | 4-week end-of-cycle QA + bug-fix only (NO new features) | **~4 weeks** |
| **TOTAL** | | **~34 weeks** |

**Buffer:** 12+ weeks of buffer on top of a 52-week evening budget.
That's the explicit margin for unknown unknowns (asset compatibility,
renderer bugs, platform-cert work, life events).

---

## 3. Architecture decisions (the lock-in)

These are the choices that affect every downstream system. They must be
made in week 1 and **not revisited** without a written rationale in
[docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md).

| Decision | Pick | Why (one line) |
| --- | --- | --- |
| **Renderer** | HDRP 17.x (inherited from VALE 1) | Already shipped; switching costs more than staying; accept maintenance-mode risk |
| **Render path** | Deferred | Open world + many lights = GBuffer amortizes light cost |
| **Upscaler** | DLSS on PC, STP as console fallback (built-in) | Cheapest path; STP runs on every platform |
| **Anti-aliasing** | TAA + DRS + upscaler (no MSAA at 4K) | Memory-prohibitive at 4K |
| **Netcode** (deferred) | **Decision only at MVP**; recommend NGO 2.x on Unity 6.6 if added | Unity-first-party + UGS integration; avoid NGO 3.0's Entities hard dep |
| **Dialogue authoring** | Yarn Spinner (free) | MIT, built-in CSV/XLIFF localization with 150+ language plural rules, VS Code extension, deterministic bytecode; **Luma Island is a shipped 4-player co-op Yarn Spinner title** |
| **Dialogue runtime** | Extend VALE 1's `DialogueRunner` | You already wrote it; clean singleton pattern with quest-objective integration via `choice.advanceObjective` |
| **Quest runtime** | Extend VALE 1's `QuestManager` + `QuestData` + `Objective` | Already versioned save format, event-driven, auto-start follow-up quests |
| **Save format** | Chunked + versioned + mod-aware data bag (Valheim 1.0 pattern) | Mid-write crash resilience; mod extensibility from day 1 |
| **Localization** | Unity Localization (free) + CSV string table | Built-in, free; CSV = every TMS tool compatible |
| **Audio** | Unity built-in (defer FMOD/Wwise) | Covers MVP needs; defer expensive middleware |
| **Modding** | **NO** — built into the data schema but no mod API exposed | Multi-year commitment; Terraria took 3 devs 12 years to maintain |
| **Platforms at MVP** | **PC only** (Steam) | Consoles require devkit lead time + $20-50k cert budget; defer to post-launch |

---

## 4. The cut-list (the explicit deferrals)

These are explicitly **out of MVP** and won't be added unless the MVP
ships successfully:

1. **Multiplayer co-op (4-player).** Save schema is co-op-aware from day 1
   (per-player local state mirrors Valheim's pattern), but the netcode
   layer is not built. Adding it post-launch requires either (a) NGO/FishNet
   integration + 4-player state reconciliation (~3-5 man-months) or
   (b) a separate dedicated-server hosting pipeline.

2. **True procedural terrain.** MVP ships VALE 1's forest at 1.5× scale
   with editor-script scattering (existing `ForestPopulator.cs` pattern).
   True procedural generation (V Rising-style 5 sq km + 8 biomes + 160k
   interactables) is a v1.1+ effort.

3. **200+ quests.** System supports it (`QuestManager` already extensible).
   MVP content = ~30 hand-crafted quests. Add quests at 10-15/quarter
   post-launch.

4. **Modding.** Data schema supports mod data bags (per the Valheim 1.0
   pattern) but no mod loader is exposed. Adding BepInEx + mod API + asset
   bundles + versioning = 6-12 months minimum.

5. **PS5 + Xbox Series.** Requires Unity Pro + platform devkits (6+ month
   lead time from Sony/MS) + platform packages + certification budget.
   Plan for v1.1 once the core is stable.

6. **More than 2 languages.** Unity Localization is configured from day 1;
   only English + 1 second language (probably zh-TW given developer) is
   translated at MVP. Add languages at 2-3/quarter post-launch.

7. **Custom audio middleware.** Unity built-in covers 80% of indie needs.
   FMOD Studio / Wwise are deferred unless a specific feature gap appears.

---

## 5. The pre-commit decision tree

```
IF you want VALE 2 to ship in 1 year of evenings solo
├─ Must commit to: Single-player MVP, PC-only, no modding, English + 1 language
├─ Must accept: HDRP maintenance mode (pipeline won't improve)
├─ Must accept: No host migration (session ends when host leaves) — not relevant at MVP, but schema must support it
├─ Must write kill-switch criteria NOW (e.g., "if vertical slice isn't fun by month 6, stop")
└─ Must start Steam Coming-Soon + devlog cadence in month 1

IF you want 4-player co-op at launch
├─ Add NGO 2.x or FishNet 4.x (decide week 1)
├─ Add 3-5 man-months for netcode (solo, no playtesters beyond friends)
├─ Add host-locked model (no host migration)
├─ Add ~3 man-months for co-op save/load state reconciliation
└─ Total: 1 year of evenings is the ceiling; expect 18 months minimum

IF you want PS5 + Xbox Series at launch
├─ Need devkits in week 1 (6+ month lead time from Sony/MS)
├─ Need Unity Pro + platform packages
├─ Need to budget $20-50k certification + ~3 man-months of console-specific optimization
└─ Effectively requires: a team, not a solo dev

IF you want modding at launch
├─ Plan 6-12 months minimum (multi-year commitment to maintain)
├─ Must design mod-aware save schema from day 1 (already in this plan)
└─ Realistic solo path: defer modding to post-launch v1.1+, or skip entirely
```

---

## 6. Immediate next steps (week 1)

See [docs/WEEK-1-STARTER.md](docs/WEEK-1-STARTER.md) for the day-by-day
first-week plan.
