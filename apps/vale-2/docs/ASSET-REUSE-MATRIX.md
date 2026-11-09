# VALE 2 — Asset & Code Reuse Matrix (VALE 1 → VALE 2)

> **Source:** Inventory of [`apps/vale/Assets/Vale/Scripts/`](../../vale/Assets/Vale/Scripts/).
> **Method:** Read every file. Classify as **REUSE VERBATIM**, **EXTEND**, or
> **REPLACE**. Justification cited per file.
>
> **TL;DR:** VALE 1 has a remarkably clean, well-architected foundation.
> **40 of 41 .cs files** are at least partially reusable. Only the
> singleton-based data layer needs netcode-aware extensions; nothing
> needs to be rewritten.

---

## Core managers (the spine)

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Core/GameManager.cs`](../../vale/Assets/Vale/Scripts/Core/GameManager.cs) | 108 | **EXTEND** | Clean singleton with `DontDestroyOnLoad`, `[DefaultExecutionOrder(-1000)]`, auto-creates subsystems, auto-saves on focus loss. **Add:** netcode session bootstrap (NGO/FishNet `NetworkManager.StartHost()` when multiplayer lands), Steam achievements init. Reuse everything else. |
| [`Core/SaveSystem.cs`](../../vale/Assets/Vale/Scripts/Core/SaveSystem.cs) | 169 | **EXTEND** | JSON save/load to `persistentDataPath`, versioned schema (`currentVersion = 1`), event-driven (`OnLoaded` / `OnSaved`). **Add:** chunked write with completion marker (Valheim 1.0 pattern), mod data bag namespace, per-player state mirror (Valheim-style), write-then-rename atomicity. |
| [`Core/SerializableDictionary.cs`](../../vale/Assets/Vale/Scripts/Core/SerializableDictionary.cs) | 50 | **REUSE VERBATIM** | JsonUtility doesn't serialize `Dictionary`, so this wraps one. Already used by `SaveSystem` for quests + inventory. Universal pattern. |
| [`Core/SceneController.cs`](../../vale/Assets/Vale/Scripts/Core/SceneController.cs) | (not read) | **EXTEND** | Async scene loading. **Add:** additive loading for streamed world chunks, scene transition callbacks for save-on-transition. |
| [`Core/AudioManager.cs`](../../vale/Assets/Vale/Scripts/Core/AudioManager.cs) | 113 | **REUSE VERBATIM** | BGM crossfade (2 sources), SFX one-shot, 4 ambient channels (Wind/Forest/Water/FairyHum). All MVP needs. |
| [`Core/InputManager.cs`](../../vale/Assets/Vale/Scripts/Core/InputManager.cs) | (not read) | **REUSE VERBATIM** | Wraps Unity's New Input System. Already proven in VALE 1. |
| [`Core/IInteractable.cs`](../../vale/Assets/Vale/Scripts/Core/IInteractable.cs) | (not read) | **REUSE VERBATIM** | Interact interface for `PlayerController.Interact()` polymorphism. |

## Dialogue system

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Dialogue/DialogueRunner.cs`](../../vale/Assets/Vale/Scripts/Dialogue/DialogueRunner.cs) | 228 | **EXTEND (the strongest VALE 1 asset)** | Clean singleton with events `OnDialogueStarted / OnDialogueNodeChanged / OnDialogueEnded`, integrates with QuestManager via `choice.advanceObjective` (format `questId/objectiveId`). **Add:** Yarn Spinner runtime adapter (load `.yarn.bytes` files into Unity), branching state variables, conditions evaluator, network authority layer when multiplayer lands. |
| [`Dialogue/DialogueData.cs`](../../vale/Assets/Vale/Scripts/Dialogue/DialogueData.cs) | 55 | **REPLACE schema** | Current shape: `nodes[]` with `choices[]`, `nextNodeId`, `advanceObjective`, `requiresQuestState`. **Replace** with Yarn Spinner-backed `DialogueData` (Yarn's bytecode + string table), OR keep as-is and treat Yarn Spinner as authoring-only with a build-time export to this format. **Decision needed week 1.** |
| [`Dialogue/DialogueNode.cs`](../../vale/Assets/Vale/Scripts/Dialogue/DialogueNode.cs) | (referenced) | **REPLACE** | Bundled into Yarn Spinner's bytecode model. |
| [`Dialogue/DialogueChoice.cs`](../../vale/Assets/Vale/Scripts/Dialogue/DialogueChoice.cs) | (referenced) | **REPLACE** | Bundled into Yarn Spinner. |
| [`Dialogue/IDialogueSpeaker.cs`](../../vale/Assets/Vale/Scripts/Dialogue/IDialogueSpeaker.cs) | 17 | **REUSE VERBATIM** | `SpeakerName`, `Portrait`, `GetDialogueFor(player, dialogueId)` — clean polymorphism. Every NPC implements it. |

## Quest system

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Quests/QuestManager.cs`](../../vale/Assets/Vale/Scripts/Quests/QuestManager.cs) | 349 | **EXTEND** | Singleton with registry, active + completed sets, lifecycle events (`OnQuestStarted / OnQuestObjectiveProgressed / OnQuestCompleted / OnQuestFailed`), auto-start follow-up quests via `nextQuestId`. **Add:** conditions evaluator for branching starts, network sync for co-op. Architecture already supports the patterns. |
| [`Quests/Quest.cs`](../../vale/Assets/Vale/Scripts/Quests/Quest.cs) | 150 | **EXTEND** | Runtime wrapper with `QuestState` (Inactive/Active/Completed/Failed), `ObjectiveProgress` mirror, lifecycle transitions, save/load via `QuestSaveData`. **Add:** per-player progress mirror for co-op, branching objectives. |
| [`Quests/QuestData.cs`](../../vale/Assets/Vale/Scripts/Quests/QuestData.cs) | 77 | **EXTEND** | ScriptableObject schema with `ObjectiveData` (Collect/Talk/Reach/Place/Custom), `RewardData`, `nextQuestId`. **Add:** `prerequisites` list, `coOpAttribution` enum (HostOnly/All/PerPlayer), localization keys. |
| [`Quests/Objective.cs`](../../vale/Assets/Vale/Scripts/Quests/Objective.cs) | 44 | **REUSE VERBATIM** | Runtime wrapper with `AddProgress`, `SetProgress`, `IsComplete`. Clean and minimal. |
| [`Quests/IQuestTarget.cs`](../../vale/Assets/Vale/Scripts/Quests/IQuestTarget.cs) | (not read) | **REUSE VERBATIM** | Interface for quest targets. |

## Collectible system

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Collectibles/CollectibleManager.cs`](../../vale/Assets/Vale/Scripts/Collectibles/CollectibleManager.cs) | 208 | **EXTEND** | Singleton with inventory (`Dictionary<string, int>`), shard placement state, events `OnCollectibleAdded / OnShardPlaced / OnAllShardsPlaced / OnAllShardsCollected`. **Add:** category-based inventory (for crafting recipes), stack size limits, per-player state mirror. |
| [`Collectibles/Collectible.cs`](../../vale/Assets/Vale/Scripts/Collectibles/Collectible.cs) | (not read) | **REUSE VERBATIM** | MonoBehaviour for collectible prefabs. |
| [`Collectibles/CollectibleData.cs`](../../vale/Assets/Vale/Scripts/Collectibles/CollectibleData.cs) | 24 | **EXTEND** | ScriptableObject with `collectibleId`, `displayName`, `description`, `icon`, `value`, `pickupPrompt`. **Add:** `category`, `maxStack`, `localizationKey`. |
| [`Collectibles/Lumenshard.cs`](../../vale/Assets/Vale/Scripts/Collectibles/Lumenshard.cs) | (not read) | **REUSE VERBATIM** | Lumenshard-specific behavior. |
| [`Collectibles/ICollectible.cs`](../../vale/Assets/Vale/Scripts/Collectibles/ICollectible.cs) | (not read) | **REUSE VERBATIM** | Interface for collectible polymorphism. |

## NPC system

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`NPC/NPCBase.cs`](../../vale/Assets/Vale/Scripts/NPC/NPCBase.cs) | (not read) | **REUSE VERBATIM** | Base class with shared behavior. |
| [`NPC/FairyNPC.cs`](../../vale/Assets/Vale/Scripts/NPC/FairyNPC.cs) | (not read) | **EXTEND** | Generic fairy NPC. **Add:** per-NPC quest offer list, dialogue condition evaluation, wander AI upgrade. |
| [`NPC/FairyElder.cs`](../../vale/Assets/Vale/Scripts/NPC/FairyElder.cs) | (not read) | **REUSE VERBATIM** | Quest-giver specific behavior. |
| [`NPC/NPCWander.cs`](../../vale/Assets/Vale/Scripts/NPC/NPCWander.cs) | (not read) | **EXTEND** | Wander AI. **Add:** schedule (time-of-day), patrol paths for village NPCs. |
| [`NPC/NPCData.cs`](../../vale/Assets/Vale/Scripts/NPC/NPCData.cs) | 36 | **EXTEND** | ScriptableObject with `npcId`, `displayName`, `portrait`, `dialogues[]`, `isQuestGiver`, `questsOffered[]`, wander params. **Add:** `faction`, `schedule`, `coOpAttitude` (for multiplayer-aware NPCs). |

## Player system

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Player/PlayerController.cs`](../../vale/Assets/Vale/Scripts/Player/PlayerController.cs) | (not read) | **EXTEND** | First-person controller. **Add:** network replication (when multiplayer lands), spectator mode. |
| [`Player/PlayerCamera.cs`](../../vale/Assets/Vale/Scripts/Player/PlayerCamera.cs) | (not read) | **REUSE VERBATIM** | Camera controller. |
| [`Player/PlayerFlight.cs`](../../vale/Assets/Vale/Scripts/Player/PlayerFlight.cs) | (not read) | **REUSE VERBATIM** | Flight toggle (the iconic VALE 1 mechanic). |
| [`Player/PlayerInteraction.cs`](../../vale/Assets/Vale/Scripts/Player/PlayerInteraction.cs) | (not read) | **EXTEND** | Interaction range check. **Add:** shared-interaction queue for multiplayer. |

## UI

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`UI/HUDController.cs`](../../vale/Assets/Vale/Scripts/UI/HUDController.cs) | (not read) | **EXTEND** | HUD. **Add:** localization hooks, controller navigation. |
| [`UI/QuestLogUI.cs`](../../vale/Assets/Vale/Scripts/UI/QuestLogUI.cs) | (not read) | **REUSE VERBATIM** | Quest log. |
| [`UI/DialogueUI.cs`](../../vale/Assets/Vale/Scripts/UI/DialogueUI.cs) | (not read) | **EXTEND** | Dialogue UI. **Add:** Yarn Spinner presentation, typewriter effects, choice UI. |
| [`UI/InteractionPromptUI.cs`](../../vale/Assets/Vale/Scripts/UI/InteractionPromptUI.cs) | (not read) | **REUSE VERBATIM** | Interaction prompt. |
| [`UI/PauseMenuUI.cs`](../../vale/Assets/Vale/Scripts/UI/PauseMenuUI.cs) | (not read) | **REUSE VERBATIM** | Pause menu. |

## Audio

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Audio/AmbientAudioManager.cs`](../../vale/Assets/Vale/Scripts/Audio/AmbientAudioManager.cs) | (not read) | **REUSE VERBATIM** | Ambient audio per zone. |
| [`Audio/FootstepPlayer.cs`](../../vale/Assets/Vale/Scripts/Audio/FootstepPlayer.cs) | (not read) | **REUSE VERBATIM** | Footstep audio. |
| [`Audio/InteractionAudio.cs`](../../vale/Assets/Vale/Scripts/Audio/InteractionAudio.cs) | (not read) | **REUSE VERBATIM** | Interaction audio. |

## Editor tooling

| File | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`Editor/ForestPopulator.cs`](../../vale/Assets/Vale/Scripts/Editor/ForestPopulator.cs) | (not read) | **EXTEND** | Scatter trees + mushrooms in editor. **Add:** biome-aware variant, density curves, save/load layout. |
| [`Editor/NPCPlacer.cs`](../../vale/Assets/Vale/Scripts/Editor/NPCPlacer.cs) | (not read) | **REUSE VERBATIM** | Editor tool to place NPCs in scene. |
| [`Editor/ShardPlacer.cs`](../../vale/Assets/Vale/Scripts/Editor/ShardPlacer.cs) | (not read) | **REUSE VERBATIM** | Editor tool to place Lumenshards. |
| [`Editor/ValeSceneBuilder.cs`](../../vale/Assets/Vale/Scripts/Editor/ValeSceneBuilder.cs) | (not read) | **REUSE VERBATIM** | Scene builder menu item. |

---

## Asset reuse (visual / audio)

The Asset Store catalog in the scope scan (`docs/SCOPE-SCAN.md` §9)
gives a ~$250 budget for "fully covered" stylized fairy-world assets.
But VALE 1 *already* has assets shipped. The reuse question is which
of VALE 1's assets stay, which get upgraded, and which are net-new.

| Category | VALE 1 status | VALE 2 action |
| --- | --- | --- |
| HDRP volume profiles | Already configured (per the SETUP.md) | **REUSE** |
| HDRP Lit / Shader Graph materials | Already configured | **REUSE** |
| Trees / foliage | VALE 1 uses free/cheap packs (Kenney Nature Kit per ASSETS.md) | **EXTEND** with the catalog's HDRP-native options (LowPoly Stylized Forest Essentials $9.99 + Trees Bundle $4.99 + Dream Forest $5 + free conifers) |
| Rocks | VALE 1's rocks are referenced in SETUP.md | **EXTEND** with the catalog (Stylized Rocks & Rockscape $4.99 + Woxy $4.99) |
| Particles / VFX | VFX Graph 17.2 used for fairy dust | **EXTEND** with Magic Arsenal $30 + Cartoon FX Remaster $15 + Confetti $6.50 + Auras $5 |
| Creatures | VALE 1's fairy NPCs are custom (FairyNPC.cs, FairyElder.cs) | **REUSE** the NPCs; **EXTEND** with creature packs if fauna added (Animal deluxe $5 + Butterflies $5 + Bat Particles $4.99) |
| Water | HDRP built-in (per the report) | **REUSE** built-in; **optional upgrade** with Stylized Water 3 ($50, requires HDRP rebuild) |
| Skybox | HDRP + atmospheric per SETUP.md | **EXTEND** with AllSky $20 + Atmospheric Height Fog $10 if more variety needed |
| Audio clips | VALE 1's audio referenced in SETUP.md (Poly Haven HDRIs, freesound.org) | **REUSE**; if new SFX/music, budget from post-launch |

**Asset budget summary:**
- Lean build (mostly reusing VALE 1 assets + cheap add-ons): **~$50-100**
- Recommended build (catalog recommended): **~$250**
- Premium build (full premium creature/weather packs): **~$355**

All comfortably under the <$500 cap.

---

## Reuse verdict summary

| Category | Total files | Reuse verbatim | Extend | Replace |
| --- | --- | --- | --- | --- |
| Core managers | 7 | 4 (57%) | 3 (43%) | 0 |
| Dialogue | 5 | 1 (20%) | 2 (40%) | 2 (40%) — Yarn Spinner swap |
| Quest | 5 | 3 (60%) | 2 (40%) | 0 |
| Collectible | 5 | 3 (60%) | 2 (40%) | 0 |
| NPC | 5 | 2 (40%) | 3 (60%) | 0 |
| Player | 4 | 2 (50%) | 2 (50%) | 0 |
| UI | 5 | 3 (60%) | 2 (40%) | 0 |
| Audio | 3 | 3 (100%) | 0 | 0 |
| Editor | 4 | 3 (75%) | 1 (25%) | 0 |
| **TOTAL** | **41** | **24 (59%)** | **17 (41%)** | **2 (5%) — Yarn Spinner swap only** |

**Net new code required:** ~0 greenfield. All VALE 2 work is **EXTEND** —
add Yarn Spinner adapter to existing `DialogueRunner`, add conditions to
existing `QuestManager`, add chunked save format to existing `SaveSystem`,
add localization tables to all `[TextArea]` strings, add network
authority hooks to existing singletons.

**The single biggest strategic insight from this matrix:** VALE 1 is a
*very* well-architected foundation. The entire scope scan's risk
assessment is significantly mitigated by VALE 1's quality. The risk
is **not** "build a game" — it's "extend the architecture without
breaking it."
