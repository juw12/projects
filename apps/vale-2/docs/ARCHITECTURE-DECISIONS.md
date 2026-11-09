# VALE 2 — Architecture Decision Records

> **Format:** Lightweight ADR. One section per decision. Date stamped
> when the decision is made; rationale + alternatives + trade-offs.
>
> **These decisions are the foundation.** They affect every downstream
> system. They must be made in **week 1** and **not revisited** without
> writing a new ADR overriding the old.

---

## ADR-001 (draft): Renderer = HDRP 17.x (inherited from VALE 1)

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
Build VALE 2 on Unity 6 + HDRP 17.x, matching VALE 1's shipped stack.

### Context
- VALE 1 ships on Unity 6 LTS (6000.0.x) + HDRP 17.2 (per [`apps/vale/README.md`](../../vale/README.md))
- HDRP is in **maintenance mode** as of 2026 (no new features; only platform reach and stability) per Unity's [Render Pipelines Strategy 2026](https://unity.com/topics/render-pipelines-strategy-for-2026)
- URP is where Unity's new rendering work goes

### Alternatives considered
- **URP**: More actively developed, simpler shader complexity, but VALE 1's HDRP volume profiles + APV lighting + Raytraced effects all need re-authoring. Switching cost > staying cost.
- **Built-In Render Pipeline**: Legacy, deprecated in 6.5. Not viable.

### Trade-offs accepted
- No new HDRP features will land mid-project (frozen API surface)
- Any missing feature requires custom render passes / native plugins (Gear.Club Unlimited 3 used this pattern)

### Rationale
VALE 1 is already shipping on HDRP. Re-authoring the entire visual stack to URP would consume 2-3 months of evening work for no functional gain. The maintenance-mode risk is acceptable: HDRP 17.x is feature-complete for stylized open-world rendering.

---

## ADR-002 (draft): Netcode = NGO 2.x on Unity 6.6 (when added, post-MVP)

**Status:** Proposed (deferred to post-MVP)
**Date:** TBD (when multiplayer is added, if ever)

### Decision
When multiplayer is added post-MVP, use **NGO 2.x on Unity 6.6**, **not** NGO 3.0.

### Context
- NGO 3.0 (Sep 2026) is a **hard dep on Netcode for Entities** and requires **Unity 6.7 LTS minimum** ([release notes](https://docs.unity3d.com/Packages/com.unity.netcode.gameobjects@3.1/changelog/CHANGELOG.html))
- NGO 3.0's main learning asset (Boss Room sample) is no longer actively maintained ([source](https://docs.unity3d.com/Packages/com.unity.netcode.gameobjects@2.10/manual/samples/bossroom/optimizing-bossroom.html))
- Unity killed managed dedicated-server hosting (Multiplay Game Server Hosting) on **31 March 2026** and licensed the software to Rocket Science Group ([source](https://aplusgamesstudio.com/blog/photon-vs-netcode-vs-mirror))
- The full comparison (NGO vs Mirror vs FishNet) is in `docs/SCOPE-SCAN.md` §4

### Alternatives considered
- **Mirror** (MIT, largest tutorial corpus, mature but UNET-descended): faster local prototyping; prediction/rollback is on you
- **FishNet** (custom license, free client prediction + reconciliation out of the box, smaller community): best free prediction; Pro tier features behind $50 paywall
- **NGO 2.x** (Unity Companion License, Unity-first-party, no built-in prediction, steepest solo ramp): Unity-first-party + UGS integration

### Trade-offs accepted
- NGO has no built-in client prediction — must build or accept ~1.5×RTT perceived latency for remote players
- Solo dev ramp is steepest of the three (UNET-descended patterns + UGS ceremony)
- Console relay is identical-risk across all three (PSN/EOS devkit-dependent)

### Rationale
VALE 2's aesthetic + scale doesn't require competitive netcode. For 4-player co-op, NGO 2.x's non-predicted feel is acceptable (FFVII/Forspoken-environmental norm). Unity-first-party + UGS integration gives the cheapest path to matchmaking + relay. **Defer to post-MVP** — single-player MVP ships first.

---

## ADR-003 (draft): Dialogue authoring = Yarn Spinner (free tier) + extend VALE 1 `DialogueRunner`

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
Use **Yarn Spinner (MIT, free)** as the dialogue authoring language, and **extend VALE 1's `DialogueRunner`** as the Unity runtime.

### Context
VALE 1's dialogue system is a clean custom singleton ([`DialogueRunner.cs`](../../vale/Assets/Vale/Scripts/Dialogue/DialogueRunner.cs)) with event-driven lifecycle and quest-objective integration via `choice.advanceObjective`. It works for VALE 1 but does not scale to:
- 50+ NPCs (current: 5 Keepers + 1 Elder)
- 200+ quests (current: ~6)
- Branching state variables (current: linear nodes, no state)
- Localization (current: hardcoded English strings in `TextArea` fields)
- Multiplayer (current: single-machine only)

### Alternatives considered
- **articy:draft X** (proprietary, subscription, binary files): weighted score 3.10/5 against VALE 2 criteria; binary files break Git; **no multiplayer examples**; Enterprise tier cost-on-success trap (0.4% of project budget, min €40k)
- **Ink** (MIT, $0): weighted score 3.05/5; **no built-in localization**; last Unity integration release Jul 2023, no explicit Unity 6 statement; "stitch small text fragments" design conflicts with translation
- **Custom-only** (extend VALE 1 alone): weighted score 4.35/5 BUT requires 2-4 engineer-months of dialog-system extension; weaker authoring ergonomics
- **Yarn Spinner + extend VALE 1 runtime** (this proposal): weighted score 3.95/5 (Yarn Spinner alone) + the control of extending VALE 1

### Trade-offs accepted
- Yarn Spinner's VS Code extension is the writer tool (not built into Unity)
- Yarn Spinner's authoring is text-based `.yarn` files — designers need a basic understanding of Yarn syntax
- Yarn Spinner's runtime uses its own bytecode format; we adapt to `DialogueRunner`'s API rather than replacing it

### Rationale
Yarn Spinner is the strongest off-the-shelf authoring tool for VALE 2's exact use case:
- **Luma Island** is a shipped 4-player co-op Yarn Spinner title (validated pattern)
- Built-in CSV export + Unity Localization XLIFF bridge (150+ language plural rules)
- Binary bytecode runtime = compact, fast, deterministic (good for netcode when added)
- MIT license, $0, Yarn Spinner Pty Ltd is a dedicated company with government funding + published roadmap (low bus factor)

Combined with extending VALE 1's existing `DialogueRunner`, we get:
- The control and integration points we already have (quest objective hook via `choice.advanceObjective`)
- The authoring ergonomics + localization + netcode-friendliness of Yarn Spinner
- A single design document for writers

---

## ADR-004 (draft): Save format = chunked + versioned + mod-aware data bag (Valheim 1.0 pattern)

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
Extend VALE 1's [`SaveSystem.cs`](../../vale/Assets/Vale/Scripts/Core/SaveSystem.cs) (already versioned, JSON to `persistentDataPath`) with:
1. **Chunked writes** with completion marker (Valheim 1.0 pattern: "only the chunks that have been modified since the last save will be affected" + `_main.N.ok` written last)
2. **Mod-aware data bag** namespace (per the RoR2 `ProperSave` pattern: mods contribute a key→object dictionary serialized to JSON alongside vanilla data)
3. **Per-player state mirror** (Valheim-style: characters live on each player's own PC and never go over the network) — even if multiplayer is deferred, schema must support it

### Context
- VALE 1's `SaveSystem` is already versioned (`currentVersion = 1`), uses `JsonUtility` with `SerializableDictionary`, event-driven (`OnLoaded`/`OnSaved`), auto-saves on focus loss
- The 5-game indie co-op save corpus (DRG, Valheim, Sea of Stars, Lethal Company, Risk of Rain 2) all converged on **single-writer-per-world** + **no host migration** + **chunked incremental writes**
- Valheim's 1.0 save rework (9 Sep 2026) explicitly says the chunked format is "designed to be resilient against mid-write failures"

### Alternatives considered
- **Whole-file write** (VALE 1's current shape): mid-write crash = corrupted save. **Rejected** by Valheim's explicit postmortem.
- **Database (SQLite)**: adds dependency, complexity, no shipped co-op precedent for it
- **Steam Cloud only**: doesn't work for offline / non-Steam platforms / save sharing

### Trade-offs accepted
- More complex write path (chunk files + completion marker)
- Schema versioning must be deliberate (Unturned's pattern: version byte at start, reject-on-unknown = planned failure mode)

### Rationale
The save format is one of the hardest things to change mid-project. Designing it for modding + co-op + crash-resilience from day 1 costs ~1 week of extra work and saves 6-12 months of painful retrofit later (Sea of Stars: "manually implementing every single edgecase one at a time").

---

## ADR-005 (draft): Platforms at MVP = PC only

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
VALE 2 ships PC-only (Steam) at MVP. PS5 + Xbox Series are post-launch.

### Context
- Console certification requires: Unity Pro + platform packages + Sony/Microsoft devkits (6+ month lead time) + $20-50k certification budget
- Console performance budgets are documented in `docs/SCOPE-SCAN.md` §3: 60fps @ 4K = 16.67 ms, 4-player sim budget = ~4-5 ms, RT GI cost-prohibitive on Series S (8GB VRAM cap is binding)
- Series S is the floor for console optimization (4 TF, 8 GB, 224 GB/s — half the bandwidth of PS5/Xbox Series X)

### Alternatives considered
- **Ship PC + PS5 at MVP**: halves the certification + lead-time risk by deferring Xbox. Still requires 6-month devkit lead time before launch.
- **Ship all 3 platforms at MVP**: effectively requires a team, not a solo dev.

### Trade-offs accepted
- VALE 2's first-year audience is PC-only
- Consoles gain ~6-12 months later
- Console-specific optimizations (separate HDRP Asset per platform, controller nav, accessibility compliance) are deferred

### Rationale
Consoles are post-launch, not pre-launch. PC-first reduces the up-front coordination cost by ~12 months and the certification cost by ~$30-50k. Once the core is stable, console port is a known quantity (Unturned-style dedicated-server pattern works on console too).

---

## ADR-006 (draft): Modding = **NO** (deferred indefinitely)

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
VALE 2 ships **without** modding support. The data schema supports a mod data bag (per ADR-004) but **no mod loader is exposed**.

### Context
- The modding subsystem was rated **Multi-year** tractability in [`vale2-subsystem-analysis.md`](../../vale2-subsystem-analysis.md) — not feasible at 300 hrs/yr
- **Terraria** (Re-Logic, 3 devs) maintained modding via tModLoader for 12 years; **Rust** (Facepunch, 7 people) has 3 dedicated modding engineers
- 4-player versioning is a hard problem: all players need identical mod versions or world desyncs
- Unity 6 has no native modding API; any implementation is a BepInEx/MelonLoader fork with no upstream support

### Alternatives considered
- **BepInEx loader + 5 API classes + Workshop**: 6-8 man-months alone
- **First-class modding from day 1**: requires team-scale investment, not solo

### Trade-offs accepted
- VALE 2 has no modding community at launch
- VALE 2's data format is "mod-aware" but modders can't actually use it

### Rationale
Modding is a multi-year commitment that doesn't fit a 1-year solo budget. The architecture supports it; the **exposed surface** doesn't. If VALE 2 ships successfully and the community demands modding, the schema retrofit is cheap (~1 man-month). If it doesn't ship successfully, modding is moot.

---

## ADR-007 (draft): Audio = Unity built-in (defer FMOD/Wwise)

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
VALE 2 ships with Unity's built-in audio. FMOD Studio / Wwise are deferred unless a specific gap appears.

### Context
- VALE 1's [`AudioManager.cs`](../../vale/Assets/Vale/Scripts/Core/AudioManager.cs) already covers BGM crossfade + SFX + 4 ambient channels (Wind/Forest/Water/FairyHum) using Unity's built-in audio
- FMOD Studio is **free for indie** (revenue < $200K), Wwise is **free Indie tier** (< $250K). Cost is not the blocker.
- Subsystem tractability rated Audio as **Tractable** with Unity built-in (1-2 man-months), **3-4 months** with FMOD/Wwise

### Alternatives considered
- **FMOD Studio**: better adaptive music + console spatial audio; 2-3 extra man-months vs Unity built-in
- **Wwise**: best console spatial audio (Hades used 40% of audio time on PS5/Xbox); 2-3 extra man-months

### Trade-offs accepted
- Console spatial audio (HRTF) is not as polished as Wwise-grade; PS5/Xbox certification may require additional tuning
- Adaptive music is harder; ambient layers + crossfade is the only music complexity available

### Rationale
Audio is not a critical-path risk at MVP. Defer FMOD/Wwise until post-launch when there's evidence the built-in pipeline can't deliver the desired experience. VALE 1's audio system is already proven.

---

## ADR-008 (draft): Localization = English + 1 (probably zh-TW) at MVP

**Status:** Proposed
**Date:** TBD (week 1)

### Decision
VALE 2's MVP ships English + 1 second language (probably Traditional Chinese, given developer's locale). Unity Localization package used.

### Context
- Unity Localization is **free** (built-in via `com.unity.localization`), handles text + audio + font + assets
- TMS integration via CSV export (compatible with Lokalise, POEditor, Crowdin, Weblate)
- Yarn Spinner's localization is CSV-based with built-in `[plural]` markup for 150+ languages

### Alternatives considered
- **English only at MVP**: ship + add languages post-launch. Cheapest.
- **English + 5 languages**: broader reach but +$2-4k in translation costs (8-12k strings × 4 languages × $8-12/string) + QA time

### Trade-offs accepted
- Limited geographic reach at MVP
- Translation pipeline must be built even for 2 languages (can't skip Unity Localization setup)

### Rationale
The Unity Localization + Yarn Spinner CSV pipeline takes ~2 weeks to set up regardless of how many languages are translated. Adding 1 second language from day 1 proves the pipeline works; adding more languages is just translation work, not engineering work.

---

## Pending decisions (to be made in week 1)

- ADR-009: Specific HDRP Asset structure (premium + stripped) — derive from console-perf section
- ADR-010: Save file format chunking strategy (write-ahead completion marker pattern)
- ADR-011: Steam Coming-Soon + devlog cadence (per postmortem corpus: month 1, weekly)
- ADR-012: Kill-switch trigger re-evaluation cadence (read KILL-SWITCH.md monthly)
