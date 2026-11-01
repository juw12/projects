# VALE — Architecture and API Contract

This document is the source of truth for the VALE codebase. Anything in here
that is contradicted by code is a bug. Anything in code that is not in here
is a design smell.

---

## Project overview

- **Engine**: Unity 6 (6000.0.x) LTS
- **Render pipeline**: HDRP 17.2.0 (high definition)
- **Input**: New Input System (`UnityEngine.InputSystem`)
- **Camera**: Cinemachine 3
- **Audio**: Built-in Unity audio + VFX Graph for fairy dust
- **UI**: UGUI (`UnityEngine.UI`) — easier tutorials than UI Toolkit

### Game design (one paragraph)

> You wake at the edge of an ancient fairy realm whose light is fading. The
> Fairy Elder asks you to recover five lost Lumenshards scattered across the
> Vale and to bring them to the Sacred Glade at its heart. Each shard is
> guarded by a fairy keeper who will share a memory when spoken to. When all
> five shards are placed on the Glade's altar, the Vale's light returns.

### Core loop

1. Spawn at the Vale's edge (Player Start).
2. Talk to the **Fairy Elder** → main quest **"The Fading Light"** begins.
3. Explore the forest; collect five **Lumenshards**.
4. Each shard area has a **Fairy Keeper** who gives a hint/dialogue.
5. Return to the **Sacred Glade** and place all five shards on the altar.
6. Quest completes; the Vale's light is restored.

---

## File layout

```
apps/vale/
├── Packages/manifest.json
├── ProjectSettings/
│   ├── ProjectVersion.txt         (committed)
│   └── PROJECTSETTINGS-NOTE.md    (regen-on-first-open)
├── Assets/Vale/
│   ├── Scripts/
│   │   ├── Vale.Runtime.asmdef    (runtime scripts asmdef; Editor/ has its own)
│   │   ├── Core/                  (GameManager, SaveSystem, SceneController, InputManager, AudioManager)
│   │   ├── Player/                (PlayerController, PlayerFlight, PlayerInteraction, PlayerCamera)
│   │   ├── Quests/                (QuestManager, Quest, Objective, QuestData)
│   │   ├── Dialogue/              (DialogueRunner, DialogueData, DialogueLine, DialogueChoice)
│   │   ├── Collectibles/          (Collectible, Lumenshard, CollectibleManager, CollectibleData)
│   │   ├── NPC/                   (NPCBase, FairyNPC, FairyElder, NPCWander, NPCData)
│   │   ├── UI/                    (HUDController, QuestLogUI, DialogueUI, InteractionPromptUI, PauseMenuUI)
│   │   ├── Audio/                 (AmbientAudioManager, FootstepPlayer, InteractionAudio)
│   │   └── Editor/                (Vale.Editor.asmdef + EditorWindow scripts)
│   ├── Scenes/                    (FairyVale.unity + boot scenes)
│   ├── Prefabs/                   (Player, FairyNPC, Lumenshard, Tree, Mushroom, SacredGlade, Altar)
│   ├── Materials/                 (Lit, ShaderGraph, Particle materials)
│   ├── Audio/                     (BGM, SFX, ambient loops)
│   └── Settings/                  (HDRP volume profiles, render settings)
└── README.md, SETUP.md, ARCHITECTURE.md, ASSETS.md
```

---

## Conventions

### Namespace

Every C# file declares its namespace explicitly. Use `Vale.<Subsystem>`:

- `Vale.Core` — game manager, save system, scene controller, input manager, audio manager
- `Vale.Player` — player controller, flight, interaction, camera
- `Vale.Quests` — quest system
- `Vale.Dialogue` — dialogue system
- `Vale.Collectibles` — collectibles (Lumenshards)
- `Vale.NPC` — fairy NPCs, Fairy Elder, wander AI
- `Vale.UI` — HUD, quest log, dialogue UI, prompts, pause menu
- `Vale.Audio` — ambient audio, footsteps, interaction sounds
- `Vale.Editor` — editor-only procedural placement and tools

### Class rules

- **One public class per file**, filename matches class name.
- **MonoBehaviour** for scene components, **ScriptableObject** for data assets.
- **Manager singletons**: `public static GameManager Instance { get; private set; }` with assignment in `Awake`.
- **Interfaces** for cross-system contracts (`IInteractable`, `IDialogueSpeaker`).
- **Events** for decoupling: `public event Action<Quest> OnQuestCompleted;`
- **No static state** outside manager singletons.

### Field rules

- Use `[SerializeField] private` for serialized fields; expose via public getter.
- Use `[Header("Group Name")]` to group inspector fields.
- Use `[Tooltip("Description")]` on every serialized field.
- Use `[Range(min, max)]` for numeric sliders.

### Lifecycle

- `Awake()` for one-time setup (references, singleton assignment).
- `OnEnable()` for event subscription.
- `Start()` for cross-component setup.
- `OnDisable()` for event unsubscription.
- `OnDestroy()` for singleton cleanup.
- `Update()` only when frame-by-frame work is needed; prefer events.

### Event pattern

```csharp
public event Action<Quest> OnQuestCompleted;
private void RaiseQuestCompleted(Quest q) => OnQuestCompleted?.Invoke(q);
```

No UnityEvents on ScriptableObjects. Use C# `event Action<>`.

### Save format

JSON to `Application.persistentDataPath/save.json`. Schema:

```json
{
  "version": 1,
  "sceneName": "FairyVale",
  "player": { "position": [x,y,z], "rotation": [x,y,z,w] },
  "quests": { "<questId>": { "state": "Active|Completed|Failed", "objectiveProgress": [0,1,2] } },
  "inventory": { "<collectibleId>": count },
  "shardsPlaced": [true, false, true, false, false],
  "timestamp": "ISO-8601"
}
```

`SaveSystem.Save()` is idempotent; called on quest complete and on pause.

---

## Public interfaces

### `IInteractable`

```csharp
namespace Vale.Core
{
    public interface IInteractable
    {
        string InteractionPrompt { get; }      // "Press E to talk", "Press E to pick up"
        bool CanInteract(PlayerController player);
        void Interact(PlayerController player);
    }
}
```

### `IDialogueSpeaker`

```csharp
namespace Vale.Dialogue
{
    public interface IDialogueSpeaker
    {
        string SpeakerName { get; }
        Sprite Portrait { get; }
        DialogueData GetDialogue(PlayerController player, string dialogueId = "default");
    }
}
```

### `IQuestTarget`

```csharp
namespace Vale.Quests
{
    public interface IQuestTarget
    {
        string QuestId { get; }                // which quest this contributes to
        string ObjectiveId { get; }            // which objective within the quest
        void OnObjectiveTrigger();             // called by objective tracker
    }
}
```

### `ICollectible`

```csharp
namespace Vale.Collectibles
{
    public interface ICollectible
    {
        CollectibleData Data { get; }
        bool IsCollected { get; }
        void Collect(PlayerController player);
    }
}
```

---

## Manager singletons

| Manager | Namespace | Responsibility |
|---|---|---|
| `GameManager` | `Vale.Core` | Boot, save/load trigger, scene transitions, quit |
| `SaveSystem` | `Vale.Core` | JSON save/load to persistent data path |
| `InputManager` | `Vale.Core` | New Input System wrapper (input actions, device management) |
| `SceneController` | `Vale.Core` | Async scene loading, spawn point resolution |
| `AudioManager` | `Vale.Core` | BGM, SFX, ambient layer routing |
| `QuestManager` | `Vale.Quests` | Active quests, completion, reward grants |
| `DialogueRunner` | `Vale.Dialogue` | Active dialogue, advance, choice handling |
| `CollectibleManager` | `Vale.Collectibles` | Tracked collectibles, placement state |

All singletons use `DontDestroyOnLoad` for the GameManager only; subsystem
managers live in the gameplay scene and are re-initialized on scene load.

---

## ScriptableObject schemas

### `QuestData : ScriptableObject`

```csharp
[CreateAssetMenu(fileName = "Quest_", menuName = "Vale/Quest Data")]
public class QuestData : ScriptableObject
{
    public string questId;
    public string title;
    [TextArea] public string description;
    public List<ObjectiveData> objectives;
    public List<RewardData> rewards;
    public string nextQuestId;       // optional follow-up
}
```

### `ObjectiveData`

```csharp
[Serializable]
public class ObjectiveData
{
    public string objectiveId;
    [TextArea] public string description;
    public ObjectiveType type;       // Collect, Talk, Reach, Custom
    public string targetId;          // collectible id, NPC id, location id
    public int requiredCount;
}
```

### `DialogueData : ScriptableObject`

```csharp
[CreateAssetMenu(fileName = "Dialogue_", menuName = "Vale/Dialogue Data")]
public class DialogueData : ScriptableObject
{
    public string dialogueId;
    public string npcId;
    public List<DialogueNode> nodes;
    public string startNodeId;
}
```

### `DialogueNode`

```csharp
[Serializable]
public class DialogueNode
{
    public string nodeId;
    public string speakerName;
    [TextArea(3, 6)] public string text;
    public string nextNodeId;        // null = end dialogue
    public List<DialogueChoice> choices;
}
```

### `CollectibleData : ScriptableObject`

```csharp
[CreateAssetMenu(fileName = "Collectible_", menuName = "Vale/Collectible Data")]
public class CollectibleData : ScriptableObject
{
    public string collectibleId;
    public string displayName;
    [TextArea] public string description;
    public Sprite icon;
    public int value;
}
```

### `NPCData : ScriptableObject`

```csharp
[CreateAssetMenu(fileName = "NPC_", menuName = "Vale/NPC Data")]
public class NPCData : ScriptableObject
{
    public string npcId;
    public string displayName;
    public Sprite portrait;
    public List<DialogueData> dialogues;
    public bool isQuestGiver;
    public List<string> questsOffered;
    public float wanderRadius;
    public float wanderSpeed;
}
```

---

## Scene structure (FairyVale.unity)

```
Hierarchy:
├── Lighting (HDRP Volume)
├── Terrain (Unity Terrain + HDRP Lit terrain shader)
├── Foliage (procedurally placed trees, mushrooms)
├── NPCs
│   ├── FairyElder (quest giver)
│   ├── Keeper_Lumenshard1..5 (fairy NPCs near each shard)
├── Collectibles
│   ├── Lumenshard_1..5
├── SacredGlade (altar at the Vale's heart)
│   └── Altar (5 slot positions, lights when shards placed)
├── Player (PlayerController + Camera + Interaction)
├── UI (Canvas with HUD, prompts, dialogue panel)
├── Audio (AmbientAudioManager, MusicSource, SFXSource)
└── Main Camera (Cinemachine virtual camera)
```

The scene is built procedurally via Editor menu items:
`Vale → Build Vale Scene` regenerates NPCs, shards, and the glade from data
assets; `Vale → Populate Forest` scatters trees/mushrooms.

---

## Editor scripts

| File | Purpose |
|---|---|
| `ValeSceneBuilder.cs` | `MenuItem("Vale/Build Vale Scene")` — creates the scene hierarchy from data assets |
| `ForestPopulator.cs` | `MenuItem("Vale/Populate Forest")` — procedurally scatters trees/mushrooms on terrain |
| `ShardPlacer.cs` | `MenuItem("Vale/Place Lumenshards")` — places 5 shards around the Vale in cleared glades |
| `NPCPlacer.cs` | `MenuItem("Vale/Place NPCs")` — places Elder and 5 Keepers at fixed story positions |

All Editor scripts require `using UnityEditor;` and live under `Assets/Vale/Scripts/Editor/`.
