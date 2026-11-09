# VALE 2 — Subsystem Tractability Analysis (Solo Dev, ~300 hrs/yr, 4P Co-op, PC/PS5/Xbox, Unity 6 HDRP)

## 1. World Streaming

**Rating: Hard.** Hand-tuning chunk boundaries, HDRP lightmap transitions, and 4-player union streaming exceeds one year of evenings.

**Risks:** (1) HDRP lightmap rebatching on chunk load produces 200 ms hitches, blowing PS5's 16.6 ms frame budget. (2) Four players in separate chunks multiplies memory 4×, risking PS5's 16 GB cap. (3) Save state desyncs from streamed chunks—entity placed in chunk A is lost if chunk B streams first on reload.

**MVP:** 4–6 man-months from scratch; 1.5–2 with SECTR World Streaming ($99, assetstore.unity.com/packages/tools/terrain/sectr-world-streaming-for-unity-6-144433).

**Buy:** SECTR World Streaming, $99, HDRP-compatible, 1,514 favorites, 10-year track record.

**Hidden cost:** 4-player union-of-visible-regions tuning (hysteresis, priority, load distance) is a 2-week parameter search nobody budgets.

**Reference:** Elden Ring's 5-player co-op streaming on PS5—dynamic GI, 30 m draw distances, zero visible pop-in.

## 2. Save/Load

**Rating: Tractable.** JSON-serializable state is standard; the real difficulty is 4-player co-op state reconciliation.

**Risks:** (1) Co-op save corruption: one player's mid-action state written while another triggers a scene transition—Wasteland 3 shipped with this bug, losing 90 min of co-op progress. (2) Schema versioning: a new field in v1.1 breaks all v1.0 saves; no QA budget for 4-player load testing. (3) Save size: 4 inventories + quest flags + world state exceed PS5's 30-second load expectation.

**MVP:** 2–3 man-months from scratch; 1 man-month using Dialogue System's built-in save/load for dialogue/quest state.

**Buy:** No standalone asset. Dialogue System for Unity ($47.50) includes save/load. Build custom for world/inventory state.

**Hidden cost:** Regression-testing save/load across 4 players at every content update is a permanent 5–10% dev-time tax.

**Reference:** Wasteland 3 (inXile, 30+ staff) shipped with co-op save corruption requiring 3 patches.

## 3. Dialogue

**Rating: Trivial.** The most mature subsystem in Unity's ecosystem; two decade-tested assets handle everything.

**Risks:** (1) Localization lock-in: a dialogue format that doesn't export cleanly to LQA spreadsheets means rewriting 4,000+ lines. (2) Branching depth: 4 players independently talking to NPCs multiplies conversation states 4×. (3) Save/load: dialogue state (completed lines, taken branches) must persist across co-op sessions or players desync on story.

**MVP:** 0.5 man-months setup; content writing is the bottleneck, not the system.

**Buy:** Dialogue System for Unity, $47.50 (50% off, assetstore.unity.com/packages/tools/behavior-ai/dialogue-system-for-unity-11672). 11,846 favorites; used in Disco Elysium. Includes quests, save/load, localization. Alternative: Yarn Spinner+ ($37.50, 50% off).

**Hidden cost:** Determining which player "owns" a conversation when 4 are near the same NPC is a design problem unsolved in most co-op games.

**Reference:** Disco Elysium (ZA/UM, 33 people) used Dialogue System for Unity for 700+ branching conversations.

## 4. Quest

**Rating: Tractable.** Buying Dialogue System for Unity includes quest tracking at zero additional cost.

**Risks:** (1) Co-op state desync: Player A accepts a quest, Player B hasn't met the NPC—whose state is authoritative? Requires a design decision before any code. (2) Chain depth: 20 quests with branching = 100+ state combinations × 4 players = 400+ playtest hours. (3) Quest-triggered world state: spawning enemies mid-stream (see World Streaming) creates race conditions.

**MVP:** 1–2 man-months with Dialogue System's quest module; 3–4 building custom with co-op reconciliation.

**Buy:** Dialogue System for Unity quest module (included in $47.50). Alternative: Quest Machine ($65, Pixel Crushers, assetstore.unity.com/packages/tools/game-toolkits/quest-machine-39834).

**Hidden cost:** 4-player quest content is 2–3× single-player volume—every quest needs a "what do I do while waiting" fallback.

**Reference:** Stardew Valley (ConcernedApe, 1 person) shipped 40+ quests; co-op quest state is simply shared because all players see the same NPCs.

## 5. Inventory

**Rating: Tractable.** Data-driven item systems are standard; the 4-player sharing model is the design challenge.

**Risks:** (1) Shared vs. separate inventories: shared (Diablo-style) creates "who grabbed the last potion" conflicts; separate requires a trading UI most solo devs under-spec. (2) Save bloat: 4 × 200 items × modifiers = 800+ serialized objects, pushing saves past PS5's 30s threshold. (3) Item ID stability: adding items shifts indices, corrupting saves unless you use stable string IDs.

**MVP:** 1.5–2 man-months from scratch; 0.5 with ItemForge ($12, v2.1, assetstore.unity.com/packages/tools/game-toolkits/itemforge-advanced-inventory-system-322147).

**Buy:** ItemForge, $12, v2.1, Unity 6-compatible, single-database, includes crafting + trading. Fuller: Inventory 2 (Game Creator 2, $79.99) with loot tables, merchants.

**Hidden cost:** The 4-player inventory UI (whose is open, trade confirmations) is 3× single-player UI work and the #1 "clunky co-op" complaint.

**Reference:** Diablo IV (Blizzard, 200+ staff) uses shared co-op inventory; "one player grabs the loot" is a known review theme.

## 6. Crafting

**Rating: Trivial.** Crafting is a data table (inputs → output) with a UI; recipe content is the actual work.

**Risks:** (1) 4-player resource depletion: all 4 crafting simultaneously drains resources 4× faster, breaking the economy unless drops scale. (2) Station lock: 4 players at one crafting station creates a UI lock requiring queue or per-player station logic. (3) Timed recipe + disconnect: a 30-second smelting recipe must survive Player 3 dropping—pause or complete?

**MVP:** 0.5 man-months for the system; 2–3 for 100+ balanced recipes with 4-player economy scaling.

**Buy:** Included in ItemForge ($12, v2.1). Standalone: Boxy ($14.99, v1.2.3, assetstore.unity.com/packages/tools/utilities/boxy-inventory-crafting-system-222478) with timed crafting + multiple stations.

**Hidden cost:** 100+ recipes with icons, descriptions, and balancing = 40–60 hours of design work no asset package covers.

**Reference:** Stardew Valley (1 person) shipped 500+ recipes; co-op simply shares world resources. Valheim (10 people) uses per-player stations, avoiding the queue problem.

## 7. Multiplayer Netcode

**Rating: Hard.** The #1 subsystem that derails solo co-op projects. Budget 40–60% of total dev time here.

**Risks:** (1) NGO (Netcode for GameObjects) has no built-in rollback—4-player physics interactions (pushing, carrying) require custom reconciliation. (2) Host migration: if the host drops, authority must transfer without desyncing world state; the hardest feature to debug solo. (3) PS5/Xbox NAT traversal: "can't connect" is the #1 negative review theme for co-op games.

**MVP:** 3–4 man-months for basic 4-player co-op with NGO (free, github.com/Unity-Technologies/com.unity.netcode.gameobjects); 6–8 with host migration + NAT + reconnect.

**Buy:** NGO, free, MIT-licensed, Unity-first-party. Paid alternative: FishNet Pro ($50, v4.7.4R, assetstore.unity.com/packages/tools/network/fishnet-pro-networking-evolved-287711) with client-side prediction.

**Hidden cost:** You cannot test 4-player netcode alone. You need 4 playtesters on different networks; each test cycle takes 3–4× longer than single-player.

**Reference:** Moon Hunters (Kitfox, 6 people) lost all online co-op when Unity shut down ML-Agents networking (July 2025); no resources to re-implement.

## 8. Modding

**Rating: Multi-year.** Full modding infrastructure (API, versioning, Workshop) is years of work. Cut for MVP.

**Risks:** (1) Mod + save: mod adds items → save → mod removed → invalid IDs → crash. Requires mod-aware save schema (2–3 months alone). (2) 4-player versioning: all players need identical mod versions or desync; requires manifest + handshake. (3) Unity 6 has no native modding API; expose a stable C# surface to BepInEx/MelonLoader you can't break.

**MVP:** Not feasible in 300 hrs/yr. Forced: 6–8 man-months for BepInEx loader + 5 API classes; +2–3 for Workshop.

**Buy:** BepInEx 5.4.x (free, github.com/BepInEx/BepInEx) or MelonLoader 0.7.x (free, github.com/nightmare/monomod).

**Hidden cost:** Every update breaks mods, generating compounding 1-star reviews. Terraria's 3 devs maintained modding 12 years; a solo dev cannot.

**Reference:** Terraria (3 developers) shipped with modding via tModLoader (250K+ downloads). Rust (Facepunch, 7 people) has 3,000+ Workshop mods but 2 dedicated modding engineers.

## 9. Localization

**Rating: Tractable.** The technical system is trivial (key-value + font swapping); the content pipeline is the real cost.

**Risks:** (1) A single hardcoded string in C# means a broken language at launch. (2) CJK fonts: Japanese/Korean require 6,000–11,000 glyph fonts, adding 50–100 MB. (3) Translation drift: a string changed in v1.2 must trigger re-translation in all languages; without a LQA tool, you track it manually.

**MVP:** 1 man-month for the system; 3–6 for translating 5,000+ strings into 5 languages (~$8–12/string).

**Buy:** Unity Localization (free, built-in, com.unity.localization) handles text, audio, font, assets. Paid: I2 Localization ($45, v2.8.22, assetstore.unity.com/packages/tools/localization/i2-localization-14884).

**Hidden cost:** You can't test 5 languages yourself. Native-speaker playtesting (5 × 20 hrs) costs $500–1,500 most solo devs don't budget.

**Reference:** Celeste (3 people) shipped in 7 languages; the founder spent 4 months on the localization pipeline post-launch. Risk of Rain (3 people) shipped English-only; localization came 3 months later.

## 10. Audio

**Rating: Tractable.** Unity's built-in audio handles 80% of indie needs; the gap is adaptive music and console spatial mixing.

**Risks:** (1) 4× ambient sources (4 footstep sets, 4 character audio) exhaust Unity's 256 AudioSource pool on PS5. (2) Bank streaming: FMOD/Wwise banks must stream with world chunks or hit a 500 MB ceiling. (3) Console certification: PS5/Xbox require spatial audio formats and HRTF profiles Unity's audio doesn't meet.

**MVP:** 1–2 man-months with Unity's built-in audio; 3–4 with FMOD or Wwise.

**Buy:** FMOD Studio, free for indie (revenue < $200K, fmod.com/studio). Wwise, free Indie tier (< $250K, audiokinetic.com). Unity built-in is free and sufficient for MVP.

**Hidden cost:** A sound designer for 100+ SFX and 10+ music tracks costs $15,000–40,000. No solo dev budget covers this; expect asset-store packs or deferred audio.

**Reference:** Hades (Supergiant, 25 people) used Wwise; 40% of audio time went to PS5/Xbox spatial tuning.

## 11. UI

**Rating: Tractable.** Unity's UI Toolkit is free and sufficient; 4-player co-op UI patterns are the design challenge.

**Risks:** (1) Controller navigation: PS5/Xbox require full focus management; UI Toolkit has no built-in gamepad navigation—you implement it. (2) 4-player layout: local co-op vs. online (4 screens) = 2× UI layouts; shared inventory shows 4× the slots. (3) Performance: 4 × 200 animated icons = 800 UI updates/frame, dropping below 16 ms without virtualization.

**MVP:** 2–3 man-months for a complete UI system; 1–2 with a template.

**Buy:** UI Toolkit (free, built-in). DOTween (free, 15,065 favorites) for animations. Head start: Fantasy RPG UI Toolkit Starter ($5.99, assetstore.unity.com/packages/2d/gui/fantasy-rpg-ui-toolkit-starter-338266).

**Hidden cost:** Gamepad focus management + Xbox screen reader + PS5 accessibility compliance is 2–3 weeks no asset covers, required for certification.

**Reference:** Stardew Valley (1 person) completed its UGUI UI in 3 weeks, never redesigned. Hades (25 people) spent 3 months on custom gamepad UI.

## 12. Achievements

**Rating: Trivial.** The most underscoped subsystem. Platform services provide the backend; you need only trigger conditions and UI.

**Risks:** (1) Co-op attribution: 4 players complete a quest together—do all 4 get it, or just the host? (2) Save/load: achievements must persist; loading an old save must not re-trigger unlocked ones. (3) Cross-platform: Steam, PSN trophies, Xbox Gamerscore are 3 separate APIs with different icons and naming.

**MVP:** 0.5 man-months for Steam (Steamworks.NET, free, v2025.161.0, github.com/rlabrecque/Steamworks.NET); 1 man-month for all 3 platforms.

**Buy:** Steamworks.NET, free. UI wrapper: Basic Integration For Steam (assetstore.unity.com/packages/tools/integration/basic-integration-for-steam-368574). PSN/Xbox: platform SDKs only.

**Hidden cost:** 50+ achievements with descriptions, icons, and platform-specific naming is 10–15 hours of design work. The integration is trivial; the content is not.

**Reference:** Hades (25 people) shipped 30+ achievements across 4 platforms as a 2-week task. Valheim (10 people) added 15–20 achievements post-launch, not in MVP.
