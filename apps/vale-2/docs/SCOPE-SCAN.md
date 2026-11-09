# VALE 2 — Pre-Commitment Scope & Risk Report

> **Source:** 8 parallel research streams (librarian ×6, deep ×2) run on
> 2026-11-03. Evidence base: official Unity docs, GitHub repos, GDC talks,
> developer postmortems, Asset Store listings, Digital Foundry benchmarks.
>
> **Target:** Stylized open-world co-op sequel. PC + PS5 + Xbox Series,
> Unity 6 + HDRP, 4-player NGO, 50+ NPCs, 200+ quests, procedural terrain,
> modding, full localization. Solo dev (juw12), ~1 year of evenings
> (~300 dev hours/yr).
>
> **Repo:** `github.com/juw12/vale-2` (planned).
>
> **Companion documents:**
> - [README.md](../README.md) — project description
> - [PLAN.md](../PLAN.md) — MVP cut plan
> - [KILL-SWITCH.md](../KILL-SWITCH.md) — kill criteria
> - [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md) — ADR log
> - [ASSET-REUSE-MATRIX.md](ASSET-REUSE-MATRIX.md) — VALE 1 → VALE 2 reuse
> - [WEEK-1-STARTER.md](WEEK-1-STARTER.md) — day-by-day first week

---

## SECTION 0 — Executive Risk Summary

These are the cross-cutting findings from all 8 research streams. Each is a
hard binding constraint that determines whether the project fits in 1 year
of evenings or doesn't.

**0.1 HDRP is in maintenance mode.** Unity's official Render Pipelines
strategy for 2026 states HDRP is being maintained for platform reach
(Nintendo Switch 2 + stability) with **no new features planned**. New
rendering work goes to URP. ([Render Pipelines strategy 2026](https://unity.com/topics/render-pipelines-strategy-for-2026))
— VALE 1 is already on HDRP 17.2, so this isn't a switch-the-engine problem;
it's a *the-API-you-build-against-will-not-improve* problem.

**0.2 Unity abandoned its managed dedicated-server hosting.** Unity killed
Multiplay Game Server Hosting on **31 March 2026** and licensed the software
to Rocket Science Group. NGO/Mirror/FishNet survive; Unity *self-hosted*
servers and third-party hosting now carry the load. ([aplusgamesstudio.com](https://aplusgamesstudio.com/blog/photon-vs-netcode-vs-mirror))
— this does not kill your networking choice, but it does mean **any
architecture that assumed Unity Cloud Relay at $0 is dead.**

**0.3 NGO 3.0 (Sep 2026) is a hard dep on Netcode for Entities and Unity 6.7
LTS minimum.** The sample learning asset (Boss Room) is no longer actively
maintained. ([Unity Discussions](https://discussions.unity.com/t/netcode-for-gameobjects-3-0-0-is-now-available/1736792))
— if you choose NGO, you are choosing a steeper ramp on an unmaintained
sample and a forced upgrade path.

**0.4 The entire 5-game indie-co-op save-system corpus converges on one writer
per world.** None of {Deep Rock Galactic, Valheim, Sea of Stars, Lethal
Company, Risk of Rain 2} implements last-write-wins between concurrent
players; none implements host migration; all end the session when the host
leaves. The Unity Netcode docs say it plainly: *"the game ceases to exist
when the host player leaves the game"* ([NGO listen-server doc](https://github.com/Unity-Technologies/com.unity.netcode.gameobjects/blob/b335cc47115e603b77818c0127264d657372b10b/com.unity.netcode.gameobjects/Documentation~/learn/listenserverhostarchitecture.md)).

**0.5 The single most-cited root cause across 12 Unity indie postmortems is
scope vs. time/money.** **11 of 12** dev-quoted postmortems name "scope was
bigger than the team could finish" as the primary cause of running out.

---

## SECTION 1 — VALE 1 Is Not Greenfield

**Before scoping VALE 2, know what you already have.**

**VALE 1 (in this monorepo, `apps/vale/`) ships:**
- Unity 6 LTS (6000.0.x) + HDRP 17.2.0
- First-person explorer with flight toggle
- 5 Lumenshards, 5 fairy Keeper NPCs, 1 Fairy Elder quest giver = ~6 NPCs
- 1 main quest + 5 sub-quests ≈ **~6 quests**
- **Custom ScriptableObject dialogue system** (`DialogueRunner.cs`, `DialogueData.cs`, `DialogueNode.cs`, `DialogueChoice.cs`, `DialogueUI.cs`)
- Cinemachine 3, New Input System, UGUI + TMP, VFX Graph, ProBuilder
- JSON save/load to `persistentDataPath`, auto-saves on focus loss
- Procedurally populated forest (editor scatter script)
- **Single-player only. PC only. No localization. No modding. No procedural open world (single biome).**

**The scaling math:**

| Dimension | VALE 1 | VALE 2 spec | Multiplier |
|---|---|---|---|
| NPCs | ~6 | 50+ | **~10×** |
| Quests | ~6 | 200+ | **~40×** |
| Multiplayer | None | 4-player co-op | **NEW** |
| Procedural world | 1 forest | Procedural terrain | **NEW** |
| Modding | None | Modding support | **NEW** |
| Localization | None | Full pipeline | **NEW** |
| Platforms | PC only | PC + PS5 + Xbox Series | **2 NEW certs** |

**Net new in VALE 2 = four capability categories + two console certifications.**

---

## SECTION 2 — Unity 6 HDRP Technical Surface

### 2.1 The state of HDRP in 2026

| Version | HDRP package | Status |
|---|---|---|
| Unity 2022.3 LTS | 14.x | LTS |
| Unity 6.0 (6000.0) | 17.0 | Released |
| Unity 6.1 | 17.1 | Released |
| Unity 6.6 / 6000.6 | 17.5 / 17.6 | Current stable (Oct 2026) |
| Unity 6.7+ | 17.7+ | Latest preview |

**HDRP is being maintained, not improved.** ([Unity Render Pipelines 2026](https://unity.com/topics/render-pipelines-strategy-for-2026))

### 2.2 World streaming — API surface (verified)

Unity's first-party **World Partition** (GA in Unity 6) gives you a scene
component that subdivides the world into cells driven by a streaming
source (Main Camera by default), with grid types **Grid / Hash2D / Hash3D**.
Configuration entry points: the World Partition component (per-scene) +
**Project Settings → World Partition**.

**Verified first-party streaming primitives:**
- `CullingGroup` API — register `BoundingSphere[]`, per-frame visibility +
  distance band; `QueryIndices` for batched. ([CullingGroup API](https://docs.unity3d.com/Manual/CullingGroupAPI.html))
- Adaptive Probe Volume (APV) streaming — two toggles on the HDRP Asset →
  **Lighting**: **Enable GPU Streaming** + **Enable Disk Streaming**.
  ([Optimize loading APV data](https://docs.unity3d.com/Manual/urp/probevolumes-streaming.html))
- Async additive scene loading — `SceneManager.LoadSceneAsync(scene, LoadSceneMode.Additive)` + Addressables + **SubScenes**.

**Unity 6 vs. 2022 LTS changes:**
- APV got a **new bake backend** + **Streaming-Assets-storage toggle**.
- **LightBaker v1.0** — snapshot-based bake backend.
- Render Graph now **caches compilation frame-to-frame**.

**Known gotchas:**
- **Floating point:** Unity 32-bit. Origin-shifting / large-world strategy mandatory.
- **Streaming ≠ just geometry:** must stream lighting data, lightmaps, reflection probes.
- **Hysteresis:** use separate load/unload radii.
- **Co-op hidden cost:** 4 players effectively 4 streaming sources.

**Real-world shipped reference:**
- **V Rising** (Stunlock, Unity 6 + HDRP, DOTS + 5 sq km world, 8 biomes):
  **160,000+ interactable objects**, **21,000 baked prefabs, 450 baked
  subscenes**, SRP Batcher. ([V Rising case study](https://unity.com/resources/stunlock-studios-v-rising))

### 2.3 LOD — API surface (verified)

- **`LODGroup` component**: **Fade Mode** (None / Cross Fade / Speed Tree),
  **Animate Cross-fading**, **Object Size**, **Global Illumination LOD**,
  LOD selection bar. ([LOD Group reference](https://docs.unity3d.com/6000.6/Documentation/Manual/class-LODGroup.html))
- **`Mesh` LODs:** `Mesh.GetLod(subMeshIndex, levelIndex)` → `MeshLodRange`.
- **LOD cross-fade dithering types:** **Bayer Matrix** (cheap), **Blue Noise**
  (better), **2x2 Stencil** (uses stencil bits 4 & 8, fewer shader variants).
- **HLOD** — Unity has **no** first-party Unreal-style "Build HLODs" commandlet.
  Use `Unity-Technologies/HLODSystem` or `AutoLOD (SceneLOD)`.

**Unity 6 changes:**
- **SpeedTree 9 (.st9)** support + GRD-compatible trees + reworked `SpeedTreeWind`.
- **Hair LOD:** new screen-coverage LOD mode for High Quality Line Rendering.

### 2.4 GPU instancing — HDRP-specific paths (verified)

Three paths:
1. **Legacy SRP GPU instancing** — classic.
2. **Shader Graph instancing** — instancing keyword support; for RT use
   **Raytracing Quality Keyword** node.
3. **BatchRendererGroup (BRG) / DOTS Instancing** — Unity 6's GPU-driven path
   with **GPU Resident Drawer (GRD)**.

**BRG API shape (verified from HDRP 17 source):**
```csharp
m_BRG = new BatchRendererGroup(this.OnPerformCulling, IntPtr.Zero);
m_MeshID     = m_BRG.RegisterMesh(mesh);
m_MaterialID = m_BRG.RegisterMaterial(material);
m_BatchID    = m_BRG.AddBatch(metadata, m_InstanceData.bufferHandle);
```
- `MetadataValue { NameID, Value }` — high bit `0x80000000` marks per-instance.

**GRD scope:** standard `MeshRenderer`s only — **not** skinned mesh, VFX
Graph, particles. **GPU Occlusion Culling** on top.

**Real-world shipped reference:**
- **Projekt Z: Beyond Order** (314 Arts, **4-player co-op**, PC/PS5/XSX,
  HDRP): "used the **GPU Resident Drawer (GRD)** to leverage the
  **BatchRendererGroup API** to reduce draw calls, upload less data per
  frame, and lower main-thread blocking." ([Projekt Z case study](https://unity.com/resources/314-arts-projekt-z-beyond-order))

### 2.5 Raytraced lighting — API + cost (verified)

**RT effect list (HDRP Asset enabled):** Ray-Traced AO, Contact Shadows,
GI, Reflections, Shadows, Recursive RT, RT SSS. **Each is an independent
toggle — per-platform fallback is a checkbox.**

**Cost levers:**
- **Ray tracing Quality mode:** Performance / Quality / Both.
- **Ray count + ray length** per effect.
- **Light Cluster range.**
- **Denoiser** (NRD) — temporal accumulation; **resolution-scalable**
  (the single most important cost lever on consoles).
- **Measure with Rendering Debugger → "Count Rays"** — MRays/frame broken
  down by effect.

**Cost ordering (sourced):** RT AO + RT reflections are cheap/safe starters;
**RT Shadows moderate; RT GI is by far the most expensive.** Path tracing is
offline-only. ([NVIDIA webinar](https://developer.nvidia.com/blog/webinar-top-11-questions-from-ray-tracing-with-unitys-high-definition-render-pipeline/))

**Console RT reality:** PS5/Xbox = RDNA2. **BVH build = hardware ray
accelerator; ray traversal = shaders** → scales with CU count, clock,
memory bandwidth. PS5 = 10.28 TF, XSX = 12.15 TF, **Series S = 4 TF.**

**Real-world shipped reference:**
- **Gear.Club Unlimited 3** (Eden Games, 2026): real-time **path tracing +
  ray tracing** on PC, **NRD denoiser via Native Rendering Plugin**;
  **RTAS memory is a key bottleneck**. (Custom SRP on top of Unity 6 via
  native plugins — a pattern available if HDRP's built-in RT is
  insufficient.) ([Gear.Club Unlimited 3](https://unity.com/blog/eden-games-gear-club-unlimited-3))

### 2.6 DLSS / FSR / XeSS — integration (verified)

**Entry point: HDRP Asset → Rendering → Dynamic Resolution.**
- **Advanced Upscalers By Priority** — ordered list HDRP walks: **DLSS**
  (NVIDIA pkg), **FSR2** (AMD pkg), **STP** (built-in all-platforms).
- **Default Fallback Upscale Filter** — non-AI fallback: **Catmull-Rom /
  CAS / FSR1 / TAA Upscale**.

**Per-upscaler:**
- **DLSS:** 5 quality modes + 5 presets.
- **FSR2 / FSR 2.1:** AMD package, FSR 2.1 for **DX11/DX12/Vulkan on any
  GPU vendor**.
- **STP:** built-in, all platforms. **Recommended default for consoles**
  (runs everywhere, cost-effective).
- **XeSS:** **NOT** in `AdvancedUpscalers` enum. Enters via Upscaler
  Framework (`IUpscaler`) + **Native Rendering Plugin**.

**Real-world shipped reference:**
- **Harold Halibut** (SLOW BROS., stylized underwater, PS5/Win/XSX, HDRP):
  used Unity 6 **STP as console upscaler**; "better than any other
  upscaling technology I've used, besides maybe DLSS… but STP runs on
  everything." Also rendered **30 GB of hi-res textures via streaming
  virtual texturing**. ([Harold Halibut](https://unity.com/resources/slow-bros-harold-halibut))

### 2.7 Deprecated APIs (Unity 2022 → Unity 6)

- **TAAU** → superseded by **STP**.
- **Single "Upscaler Filter" dropdown → Advanced Upscalers By Priority.**
- **Physically Based Sky:** Local Clouds removed; Earth curvature removed.
- **Volumetric clouds:** no longer clipped by far plane.
- **APV bake:** old backend → new backend; "always in Streaming Assets" → toggle.
- **Path tracing:** hardcoded max-light-list → `PathTracingMaxLightCount`.
- **Baking:** legacy per-frame-change checker → **LightBaker v1.0**.
- **Render Graph:** compilation now cached by default.

---

## SECTION 3 — HDRP on Console (real performance budget)

### 3.1 Hardware baseline (verified)

| | **PS5** | **Xbox Series X** | **Xbox Series S** |
|---|---|---|---|
| GPU arch | Custom RDNA 2 | RDNA 2 | RDNA 2 |
| Compute units | 36 | 52 | **20** |
| GPU clock | up to 2.23 GHz | 1.825 GHz | 1.565 GHz |
| **FP32 throughput** | **~10.28 TFLOPs** | **~12.15 TFLOPs** | **~4 TFLOPs** |
| CPU | 8-core Zen 2, 3.5 GHz | 8-core Zen 2, 3.8/3.6 GHz | 8-core Zen 2, 3.6/3.4 GHz |
| Memory | 16 GB GDDR6 (~13 GB usable) | 16 GB GDDR6 (~13.5 GB usable) | 10 GB GDDR6 (**8 GB usable**) |
| **Memory bandwidth** | **448 GB/s** | **560 GB/s** | **224 GB/s** |
| HW Ray tracing | RDNA2 RT cores | RDNA2 RT + **DXR/DX12** | RDNA2 RT cores |

**Series S is ~38% of XSX raster power and half the bandwidth. It will
force the deepest cuts.** ([DF Series S review](https://www.digitalfoundry.net/articles/xbox-series-s-review-digitalfoundry))

### 3.2 HDRP memory budget

**HDRP Asset memory levers** ([HDRP Asset](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/HDRP-Asset.html), [Scalability](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Scalability-Manual.html)):
- **Color Buffer Format** — R11G11B10 (4 B/px) vs R16G16B16A16 (8 B/px).
- **Lit Shader Mode** — Forward / Deferred / Both.
- **MSAA Quality** — None/2x/4x/8x (forward only).
- **Shadow** — Light Atlas Resolution + Precision.
- **Reflections** — 2D Atlas Size, Cube/Planar tiers.
- **APV / Light Probe** — Memory Budget.
- **Realtime Raytracing** — Performance/Quality/Both.
- **Virtual Texturing** — CPU/GPU cache (MB).

**Derived pixel-math @ 4K (labeled):** Minimum deferred 4K framebuffer+
GBuffer+velocity+lighting ≈ **~230–260 MB** before shadows/probes/RT.
A tuned open world holds **0.8–1.5 GB** of render targets. **MSAA 4× at 4K
= ~133 MB color alone** — why 4K-native + MSAA is not viable on these GPUs.

**VRAM cap reality:** Series S 8 GB is the binding constraint.

### 3.3 Frame times & CPU:GPU split

- **60 fps @ 4K → 16.67 ms total. 30 fps → 33.33 ms.**
- **Measured FFVII Rebirth PS5** (UE4, env-analogous): Performance mode
  **mean 16.74 ms, median 16.67 ms, 95th-pct 16.67 ms**. ([VG Tech dump](https://www.neogaf.com/threads/vg-tech-final-fantasy-7-rebirth-ps5-frame-rate-comparison-demo.1667082/))
- **CPU is usually the binding constraint in open worlds.** Crimson Desert
  on Xbox Series X cities cause drops into the 30s, "no simple way to
  recover both GPU and, mainly, CPU time." ([DF](https://www.digitalfoundry.net/reviews/crimson-desert-on-xbox-series-x-improved-by-update-n-but-whats-up-with-series-s))
- **CPU:GPU split for VALE 2 4-player:** at 60 fps, render ≤ 12 ms,
  ~4–5 ms for 4-player sim + driver. **Plan to be CPU-bound in populated
  scenes.** ([Looplet](https://thelooplet.com/posts/how-to-fix-framerate-targets-in-largeopenworld-games-on-currentgen-consoles))

### 3.4 ⚠ Engine corrections (do not carry these forward)

| Title | Actual engine | Is it HDRP? |
|---|---|---|
| **Forspoken** (Square Enix) | **Luminous Engine** (proprietary) | **❌ No** |
| **FFVII Remake / Rebirth** | **Unreal Engine 4** | **❌ No** |

Both are *measured* current-gen open-world 60 fps data points — included as
the **performance envelope**, not HDRP references. Used as cautionary
evidence: an ambitious open world on PS5 that renders GPU-heavy **cannot
hold 60 fps at high res** — Forspoken lives at ~900p internal + FSR 2 → 4K,
and even then needed a post-launch optimization campaign to stabilize.
([DF Forspoken](https://www.digitalfoundry.net/articles/digitalfoundry-2023-forspoken-revisited-on-ps5-does-the-final-update-fix-the-games-technical-issues))

**True HDRP console titles with confirmed engine:**
- **Need for Speed Unbound** (2022) — PS5, XSX/SS, PC.
- **Tchia** (2024) — PS5, PC.
- **Projekt Z: Beyond Order** (314 Arts) — PC/PS5/XSX (4-player co-op).
- **Harold Halibut** — PS5/Win/XSX (stylized).
- **Slime Rancher 2** — PC/XSX.
- **V Rising** — PS5/PC.
- **Gallipoli** — PC/PS5/XSX (Built-In→HDRP migration).

### 3.5 RDNA2 hardware ray-tracing cost

- AC Black Flag Resynced: diffuse RTGI runs in all console modes including
  Series S, "aggressively reducing resolution — down to one-sixteenth in
  some cases," relying on denoisers + bilateral upsamplers + temporal
  filtering. ([DF AC Black Flag](https://www.digitalfoundry.net/features/we-really-squeezed-the-ps5-as-much-as-we-could-ubisoft-talks-tech-on-assassins-creed-black-flag-resynced))
- **Crimson Desert Series S: ray tracing removed entirely** to hold 30/40
  fps. ([DF Crimson Desert](https://www.digitalfoundry.net/reviews/crimson-desert-on-xbox-series-x-improved-by-update-n-but-whats-up-with-series-s))

**VALE 2 RT plan:** on PS5/XSX, **RT shadows** are affordable; **RT GI
low-res + denoised or replace with SSGI + Adaptive Probe Volumes; drop RT
on Series S.**

### 3.6 Bottom line for VALE 2

**16.67 ms achievable only if render ≤ ~12 ms + ~4–5 ms for 4-player sim.
CPU-bound in populated scenes.** **Two HDRP Assets** (premium PS5/XSX +
stripped Series S). **TAA + DRS + FSR2 (Xbox) / PSSR-QSSR (PS5) at
~1440p-class internal, not 4K-native + MSAA.** Target **~1152p internal for
60 fps** in dense open world.

---

## SECTION 4 — Netcode Comparison 2026

### 4.1 The 2026 stack (verified)

| | **NGO** | **Mirror** | **FishNet** |
|---|---|---|---|
| Current version | 3.1.0 (Oct 2026); 2.13.x for ≤6.6 | v96.11.3 | 4.7.3 |
| Repo stats | 2,333★, 40 contributors | 6,383★, 24 contributors | 2,083★, 43 contributors |
| Default tick rate | 30 Hz | Frame-driven, 20 Hz NT | 30 tps |
| Client prediction | None | None (researching) | **Built-in & free** |
| Rollback | None | None | No deterministic rollback shipped; Pro has lag comp |
| Server model | Listen, dedicated, DA (Unity cloud) | Listen, dedicated | Dedicated + listen, no P2P, no host migration |
| Out-of-box relay | Unity Relay + DA | None built-in (KCP default) | Unity Relay, EOS, Steam DR, Photon, BlitzRelay |
| EOS/Steam/Nakama/Photon | Steam/EOS/Nakama: DIY | **Steam + Epic first-party** | **EOS + Steam first-party; Photon + Unity Relay** |
| Solo-dev ergonomics | Steep; Boss Room unmaintained | Mature, large corpus | Best free prediction |
| Console cert | "Contact us" + Unity Pro + devkit | Same + relay on you | Same + relay on you |
| License | Core UCL/MIT; Relay/Lobby/DA = UGS usage-based | **MIT** | **Custom / NOT OSI**; free for games |

### 4.2 Input→photon budget (worked estimate)

Assume median RTT = 40 ms (same region) or 120 ms (cross-region). At 30 Hz
tick = 33 ms quantum:

| | NGO/Mirror (no prediction) | FishNet (free prediction, local char) |
|---|---|---|
| Local character (host) | ~0 | ~1 tick ≈ 33 ms |
| Local character (remote) | RTT + 33 ms + 0.5·RTT buffer → ~1.5×RTT + 33 ms | ~1 tick ≈ 33 ms |
| Seeing other players | interp buffer ≈ 0.5–1×RTT | same |

**For a co-op open-world (not competitive shooter), Mirror/NGO's
non-predicted feel is acceptable for 4 players.** None of the three gives
you fighting-game-style frame rollback out of the box.

### 4.3 ⚠ What we don't know

1. **No neutral, current (2026) latency/bandwidth benchmark exists.**
2. **Console certification specifics undocumented** for all three.
3. **Mirror's console transport readiness is unverified.**
4. **NGO 3.0's real cost of Netcode-for-Entities hard dep** still settling.
5. **FishNet license boundary** §2.b restriction unclear for reusable middleware.
6. **FishNet 4.7.x console + Unity 6.7 compat** not explicitly documented.
7. **Post–March-2026 hosting cost deltas** are usage-based.

### 4.4 Decision criteria

- **Least time-to-first-local-session + largest tutorial corpus + zero lock-in:** **Mirror**.
- **Free, server-authoritative + prediction + reconciliation + Steam/EOS/Photon/Unity-Relay transports:** **FishNet**.
- **Unity's first-party ecosystem + UGS costs:** **NGO**.
- **Frame-perfect rollback requirement:** none qualifies. DIY or reconsider.

**Console + solo + 12 months is the binding constraint. Validate console
relay in week 1 with a devkit, regardless of which you pick.**

---

## SECTION 5 — Save Systems in Shipped 4-Player Co-Op Games

### 5.1 Per-game breakdown (verified)

| Game | **Engine** | Save location | World state persisted? | Co-op writer model | Join-in-progress | Host-migration | Cloud | Cross-play |
|---|---|---|---|---|---|---|---|---|
| **Deep Rock Galactic** | **UE4** (NOT Unity) | Install `FSD\Saved\SaveGames` / WGS (MS) | **No** (regen per mission) | P2P host, no servers | Yes | **None documented** | No | Xbox↔MS only |
| **Valheim** | **Unity** | Steam userdata `892970` + `LocalLow\IronGate\Valheim` | Yes (chunked since 1.0, 9 Sep 2026) | P2P host-authoritative / DS optional | Yes | **None** | Steam Cloud | Not evidenced |
| **Sea of Stars** | **Unity** (NOT UE4) | `LocalLow\Sabotage Studio\Sea of Stars` | Yes (JRPG save) | **Local-only**, single writer | N/A | N/A | Not evidenced | None (PS5 Share Play only) |
| **Lethal Company** | **Unity** | `LocalLow\ZeekerssRBLX\Lethal Company` (3 slots) | No (seed + credits only) | P2P host owns save | Yes | **None** | No | No |
| **Risk of Rain 2** | **Unity** | Steam userdata `632360` (XML) | No (roguelike, shared run seed) | P2P host-authoritative; DS optional | Yes | **None** | Steam Cloud | No |
| **Unturned** (ref) | **Unity** | Per-map `.dat` (binary, versioned) | Yes (per map) | **Dedicated server authoritative** | Yes | N/A | n/a | n/a |

### 5.2 Key per-game findings

**Deep Rock Galactic** ([Epic interview](https://www.unrealengine.com/en-US/developer-interviews/guns-gold-and-glory-in-the-caverns-of-deep-rock-galactic), [dtf.ru 2019](https://dtf.ru/gamedev/62775-kosmicheskie-dvorfy-intervyu-s-razrabotchikami-deep-rock-galactic)):
- "We would need to implement more advanced network technology to make [cross-play] happen." (Lundgaard, wccftech 2020)
- Mission worlds **not persisted** — every mission is a fresh procedural cave.

**Valheim** ([Iron Gate Steam FAQ](https://steamcommunity.com/app/892970/discussions/0/4615641483004444994)):
- Per-character: **local-only** — "Characters live on each player's own PC
  and never go to the server" (low.ms KB).
- **1.0 save rework (9 Sep 2026):** *"Splits world data across chunks to
  reduce how much data is serialized and written to improve performance,
  and is designed to be resilient against mid-write failures."* World
  files: `_main.N.fwl2` = seed/ID, `_main.N.db2` + chunk files = state,
  `_main.N.ok` = completion marker.
- "Worlds over a few hundred MB" — only documented size.

**Sea of Stars** ([PlayStation.Blog 12 Nov 2024](https://blog.playstation.com/2024/11/12/sea-of-stars-dawn-of-equinox-devs-deep-dive-into-3-player-co-op-and-combat-2-0-live-today/)):
- Thierry Boulanger: *"We knew this one would be challenging given the
  hundreds of cutscenes, interactive objects, camera work, puzzles, menus,
  NPC interactions… that would simply break in thousands of ways if more
  than one player had full control over the game's world."*

**Lethal Company** ([decompiled source](https://github.com/EvaisaDev/LethalCompanyUnityTemplate/blob/0fd8b2245ec4e440480eb982edfc462a2966c152/Assets/Scripts/Assembly-CSharp/GameNetworkManager.cs)):
- **Three shared save slots** + `LCGeneralSaveData`. Serializes: current
  moon, **random seed**, deadline, quotas, credits, ship items. **NOT
  serialized:** moon world state or character positions.

**Risk of Rain 2** ([wiki](https://riskofrain2.wiki.gg/wiki/Developer_Console)):
- P2P host-authoritative; dedicated server mode exists. `sv_maxplayers` default **4**.

### 5.3 Pattern convergence

1. **Single writer per world, always.** No shipped game uses last-write-wins.
2. **World save split from per-player state.** Valheim's "characters never
   go to the server" eliminates cross-player conflict.
3. **Host migration is a gap across the entire category.**
4. **Persist seeds, not geometry.**
5. **Chunked incremental writes with completion marker.** (Valheim 1.0.)
6. **Versioned, extensible save schema for modding.**
7. **Join-in-progress = snapshot + regenerate.**
8. **Cloud saves (optional but cheap):** Steam Cloud, account-bound to a
   single writer.

---

## SECTION 6 — Dialogue Systems for 50+ NPCs / 200+ Quests

### 6.1 ⚠ Correction to my brief (verified by agent)

The prompt asked for citation of "AAA usage of articy:draft (Cyberpunk
2077, The Outer Worlds, Baldur's Gate 3)." **None of these three used
articy:draft.** Verified:

| Game | Actual Tool | Evidence |
|---|---|---|
| **Cyberpunk 2077** | **Custom internal Scene Editor** on REDengine 4 | GDC 2023: Sarah Gruemmer |
| **The Outer Worlds** | **OEI Tools** (proprietary, since 2006) | Eric Sawyer: "OEI Tools, a dialogue program that's become a studio staple" |
| **Baldur's Gate 3** | **Custom internal tools + spreadsheets** | Vladimir Gaidenko, DevGAMM 2025 masterclass |

**Confirmed articy:draft AAA/AA usage:** Disco Elysium (ZA/UM), Syberia: The
World Before (Microids), Gamedec, Beholder 3, Broken Roads.

### 6.2 Side-by-side

| Dimension | **Ink** | **Yarn Spinner** | **articy:draft X** | **Custom** |
|---|---|---|---|---|
| Authoring | Text markup (`.ink`) | Text screenplay (`.yarn`) | Visual node editor + database | Your choice |
| Editor | Inky (free) | VS Code ext (text + **graph view**) | Desktop app (visual flow + entities) | You build it |
| Writer skill | Medium | **Low** (easiest for non-technical writers) | Medium | Depends |
| Localization | None built-in | **Built-in CSV + Unity Localization (XLIFF), 150+ lang plural rules** | Built-in XLSX | You build it |
| NPC/Quest DB | **None** | **None** | **Full entity DB with templates** | You build it |
| Version control | **Excellent** (text, Git-native) | **Excellent** (text, Git-native, line IDs) | **Poor** (binary) | Excellent if text |
| Runtime model | JSON → C# state machine | **Binary bytecode** → stack VM | C# classes / JSON → DB | Your choice |
| Memory | Low-Medium | **Low** (compact bytecode) | Medium-High (full DB) | Optimizable |
| Unity 6 compat | ⚠ Last release Jul 2023 | ✅ Explicit, **IL2CPP fix in v3.2.8** | ⚠ X current, no Unity 6 ver | ✅ |
| License | **$0** (MIT) | **$0** free / **$75** one-time (YS+) | **€6.99/mo or €69.99/yr**; **Enterprise: 0.4% of budget (min €40k)** if >€10M | Engineering time |
| Open source | Yes (MIT) | Yes (MIT core) | **No** | Your choice |
| Bus factor | Medium-High | **Low-Medium** (dedicated company) | **High** | Your team |
| Multiplayer | DIY (syncable) | DIY; Luma Island shipped co-op | DIY; **no multiplayer examples** | **Designed-in** |
| Modding | Good (Erannorth example) | Good (text files, no public example yet) | **Poor** | **Designed-in** |
| Shipped games | 80 Days, Heaven's Vault, Overboard!, 100s | NITW, A Short Hike, DREDGE, Venba, **Luma Island (co-op)**, 100+ | Disco Elysium, Syberia | — |

### 6.3 Weighted scoring (against VALE 2 criteria)

| Criteria (Weight) | Ink | Yarn Spinner | articy:draft X | Custom |
|---|---|---|---|---|
| Scale: 50+ NPCs (15%) | 3/5 | 3/5 | **5/5** | **5/5** |
| Scale: 200+ quests (15%) | 2/5 | 3/5 | **5/5** | **5/5** |
| Localization: non-European (15%) | 2/5 | **4/5** | 3/5 | **5/5** |
| Modding support (15%) | **4/5** | 3/5 | 1/5 | **5/5** |
| Co-op / netcode (10%) | 3/5 | **4/5** | 2/5 | **5/5** |
| Writer experience (10%) | 3/5 | **4/5** | **4/5** | 2/5 |
| VCS / team workflow (5%) | **5/5** | **5/5** | 2/5 | **5/5** |
| Runtime performance (5%) | 4/5 | **5/5** | 3/5 | **5/5** |
| Cost (5-yr TCO, 5-seat) (5%) | **5/5** | **4/5** | 2/5 | 2/5 |
| Maintenance sustainability (5%) | 3/5 | **4/5** | 3/5 | 2/5 |
| Unity 6 readiness (5%) | 2/5 | **5/5** | 3/5 | **5/5** |
| **Weighted Score** | **3.05 / 5** | **3.95 / 5** | **3.10 / 5** | **4.35 / 5** |

### 6.4 The "No Single Winner" finding + the right answer for VALE 2

**You already have a working custom dialogue system in VALE 1**
(`DialogueRunner.cs`, `DialogueData.cs`, etc.). For VALE 2, the right path:

1. **Extend VALE 1's `DialogueRunner` + add Yarn Spinner as the authoring
   language.** Yarn Spinner is MIT, has built-in CSV/XLIFF localization
   with 150+ language plural rules, ships binary bytecode (compact,
   deterministic, netcode-friendly), VS Code extension with graph view +
   in-editor preview (easiest for non-technical writers), and **Luma
   Island is a shipped 4-player co-op Yarn Spinner title** (validated
   pattern for VALE 2's exact use case). Cost: $0 free tier.

2. **Build on VALE 1's custom system alone** — extend `DialogueData` to add
   conditions/visit counts, add a string-table + Localization package
   integration. Cost: 2–4 engineer-months of dialog-system extension.

**Do NOT use articy:draft X:** binary files break Git; no native XLIFF;
**no multiplayer examples**; Enterprise tier cost-on-success trap.

**Do NOT use Ink:** no built-in localization; stale Unity integration;
"stitch small text fragments" design conflicts with translation.

---

## SECTION 7 — Subsystem Solo-Dev Tractability (300 hrs/yr budget)

Full 12-section analysis at `vale2-subsystem-analysis.md` (1,722 words).

| # | Subsystem | Rating | MVP man-months | Top Buy | Critical Risk |
|---|---|---|---|---|---|
| 1 | **World Streaming** | **Hard** | 1.5–2 | SECTR ($99) | HDRP lightmap rebatching hitches; 4-player union streaming 4× memory |
| 2 | **Save/Load** | Tractable | 1–2 | Dialogue System included | Co-op save corruption (Wasteland 3 bug); schema versioning; PS5 30-s load |
| 3 | **Dialogue** | Trivial | 0.5 | Dialogue System ($47.50) / extend VALE 1 | Localization lock-in; 4-player branching state 4×; conversation-ownership design |
| 4 | **Quest** | Tractable | 1–2 | Dialogue System quest / Quest Machine ($65) | Co-op state desync; chain depth combinatorial; race with streaming |
| 5 | **Inventory** | Tractable | 0.5–1.5 | ItemForge ($12) | Shared vs. separate; save bloat; item ID stability |
| 6 | **Crafting** | Trivial | 0.5 | ItemForge / Boxy ($14.99) | 4× resource depletion; station UI lock; timed recipe + disconnect |
| 7 | **Multiplayer Netcode** | **Hard** | 3–8 | NGO (free) / FishNet Pro ($50) | No built-in rollback; host migration hardest to debug solo; PS5/Xbox NAT = #1 negative review |
| 8 | **Modding** | **Multi-year — CUT** | 6–8+ not feasible | BepInEx / MelonLoader (free) | Mod+save schema; 4-player manifest+handshake; no Unity 6 modding API |
| 9 | **Localization** | Tractable | 1 | Unity Localization (free) | Hardcoded strings; CJK font +50–100 MB; translation drift; $500–1,500 QA |
| 10 | **Audio** | Tractable | 1–2 | Unity built-in / FMOD (free indie) | 4× ambient exhausts 256 AudioSource on PS5; bank streaming; console cert (HRTF) |
| 11 | **UI** | Tractable | 1–2 | UI Toolkit + DOTween + Fantasy RPG UI Toolkit ($5.99) | Controller nav (UI Toolkit has none); 4-player layout 2×; 800 UI updates/frame |
| 12 | **Achievements** | Trivial | 0.5–1 | Steamworks.NET (free) | Co-op attribution; save persistence; cross-platform 3 APIs |

**Critical interaction effects:**
- Save/Load ← Netcode (co-op state reconciliation; Wasteland 3 lost 90 min)
- Modding ← Save/Load (mod-aware save schema)
- Localization ← Dialogue + UI
- World Streaming ← Save/Load + Netcode (4-player union; chunked save deltas)
- Netcode ← World Streaming + Save/Load (host migration requires handoff)

---

## SECTION 8 — 12 Unity Indie Postmortems

### 8.1 The corpus

| # | Game | Studio | Team | Outcome | Root cause |
|---|---|---|---|---|---|
| 1 | **Code Hero** | Primer Labs | 10+ | **Cancelled** | Over-funded → added MMO + documentary scope → outran runway |
| 2 | **Upsilon Circuit** | Robot Loves Kitty | 2→4+ | **Cancelled** | "Scope too ambitious… pushed ourselves harder instead of scaling back" |
| 3 | **Scarlet Republics** | Audacity Interactive | 5–6 | **Studio closed** | "Ran out of money seven times" + KS + co-founder exits + CEO health collapse |
| 4 | **Yogventures!** | Winterkewl | small + contractors | **Bankrupt** | $100k "main programmer" slot never hired; voxel sandbox too vast |
| 5 | **UnnyWorld** | Suvitruf | 3–5 | **Studio closed** | 4 game modes for "few users"; spent $200+/mo on Datadog too late |
| 6 | **FOMOGRAPHY** | Brendan Keesing | **solo** | Shipped (6.5 yrs, financial loss) | "Biting off more than I could chew"; URP/HDRP rework; 600 bugs at end |
| 7 | **Chains of Fury** | Cobble Games | solo→3 | Shipped incomplete | 5 yrs; rewrote AI 3×; publisher pulled release 3 mo early |
| 8 | **Crumbling World** | Dani Marti | **solo** | Shipped (debt) | "Should have polished the version already working… 141 units sold, $1,380" |
| 9 | **Drunk Shotgun** | Alexey Strelkov | **solo** | Shipped ($30) | Playtested same friends (wrong audience); LWRP not production-ready |
| 10 | **Dukes and Dirigibles** | Jason Seip | **solo** | KS failed (0.3%) | KS weekend clashed with convention; demo churn took dev time |
| 11 | **Shadow Physics** | Enemy Airship | 2–4 | **Cancelled** (GDC Failure Workshop 2011) | "**Should've used Unity**" instead of home-brewed physics |
| 12 | **Eastshade** | Eastshade Studios | 2 | Shipped (~$2M, near-miss) | "Initial budget $200k… family helped in final year when nearly out of money" |

### 8.2 Root-cause frequency (across 12)

| Root cause | Count / 12 |
|---|---|
| **Scope/ambition exceeded team's time + money** | **11/12** |
| **Underestimated time** ("double/triple estimate") | 8/12 |
| **Ran out of money (explicitly)** | 7/12 |
| **Marketing/audience/visibility failure** | 6/12 |
| **Crowdfunding as false runway** | 5/12 |
| **No real QA/playtesting until the end** | 4/12 |
| **Inexperience (team/tech/networking)** | 4/12 |
| **Multiplayer complexity as solo/small sink** | 3/12 |
| **Personal health / burnout** | 4/12 |
| **Engine-version specific cost** | 4–5/12 |

### 8.3 Solo-specific pattern (5 solo devs in corpus)

**Solo devs rarely "run out of money" the way 10-person studios do.** They
run out of **time and will**, or ship to **no audience.** Money losses are
small ($30, $1,380, $4k) but **time overruns are 4–6.5 years** — same order
as small studios.

**Recurring solo failure mode:** scope + no marketing + no right-audience
playtesting + no QA buffer.

### 8.4 The lessons cited directly by solo devs

1. **Triple your estimate, then cut to a vertical slice.** Upsilon Circuit: *"Take the project's timeframe, and triple it. Then triple it again."*
2. **Do NOT build live multiplayer in the MVP.** Every multiplayer Unity
   failure died partly on networking complexity.
3. **Cut features BEFORE committing a date.** Crumbling World: *"Committing
   to launch a certain number of features at a predefined date ended up
   hurting me instead of helping me."*
4. **Plan a 4-week QA/playtest buffer at the end.** FOMOGRAPHY: 600 bugs.
5. **Playtest with the actual target audience, not friends.** Drunk Shotgun.
6. **Start marketing/wishlist-building in month 1.**
7. **If you crowdfund, it must back a playable build, not a vision.**
8. **Pick your Unity renderer/pipeline early.**
9. **Don't "scale to a team" to go faster as solo.**
10. **Protect the will — kill-switch criteria written now.**
11. **A small, finished game beats a big, dead one.**

---

## SECTION 9 — Stylized Fairy-World Assets ($250 build)

### 9.1 Asset budget breakdown

**Lean build (~$159):** Trees $20 + Foliage $30 + Rocks $17 + Particles
$50 + Creatures $15 + Water $7 + Skybox $20.
**Recommended build (~$250):** + Wind Frost trees + DAX trees ×3 + Confetti
+ KayKit + Stylized Water 3 + Height fog.
**Premium build (~$305–$355):** + Stylized Forest Creatures Pack + optional
COZY Weather.

**All within the <$500 asset budget cap.**

### 9.2 ⚠ Critical HDRP reality

**HDRP is the weak point of the stylized niche.** Only a handful of
stylized packs are HDRP-native (verified):
- ✅ **LowPoly Stylized Forest Essentials** ($9.99, Peanar) — anchor: HDRP-native 38 models + skybox + sunbeam + post profile
- ✅ **Trees Bundle (HDRP + URP)** ($4.99, IL.ranch)
- ✅ **Stylized Rocks & Rockscape Pack** ($4.99)
- ✅ **Low Poly Rocks by Woxy** ($4.99)

Everything else is URP/Built-in → **re-material workflow**: import FBX,
discard bundled materials, reassign to **HDRP Lit/Unlit/Shader-Graph toon
material** (keep toon look via `Toon Outline` + `Rim Light` HDRP nodes).

**Stylized Water 3** ($50, Staggart) is **URP-only**. Must be **rebuilt in
HDRP Shader Graph**. Don't expect it to "just work."

**Fireflies/pollen** are not sold as a single ready pack. Standard
approach: re-texture Magic Arsenal dust + Cartoon FX confetti with emissive
glow sprites.

### 9.3 Open-source reality

GitHub code-search found **no directly-usable CC0/MIT "fairy world"
environment repos** for Unity HDRP. The stylized-fantasy environment
ecosystem is **Asset-Store-driven**. Free Asset Store items substitute.

---

## SECTION 10 — Verification & Conflicts

### 10.1 Triple-verification of high-stakes claims

| Claim | Source 1 | Source 2 | Source 3 | Status |
|---|---|---|---|---|
| HDRP is maintenance mode in 2026 | Unity Render Pipelines 2026 strategy | HDRP 17 changelog | Gallipoli/Projekt Z case studies | ✅ Triple-verified |
| Unity killed Multiplay March 2026 | aplusgamesstudio.com/blog | Unity Discussions (NGO 3.0) | (third-party: indirect) | ✅ Verified (2 primary + 1 indirect) |
| Forspoken/FFVII are NOT HDRP | DF Forspoken (Luminous explicit) | DF FFVII Rebirth (UE4 explicit) | (DF specs: UE4 confirmed) | ✅ Triple-verified |
| Cyberpunk/BG3/Outer Worlds don't use articy:draft | GDC 2023 Gruemmer | Game File Nov 2025 Sawyer | DevGAMM 2025 Gaidenko | ✅ Triple-verified |
| DRG is UE4 not Unity | Epic interview | dtf.ru 2019 (Henrik) | drg-save-parser (GVAS) | ✅ Triple-verified |
| Sea of Stars is Unity not UE4 | BepInEx mod ecosystem | lofturb URP-Fix (URP "Eclipse") | Sabotage WP archive | ✅ Triple-verified (via mod ecosystem, no official quote) |
| NGO 3.0 hard deps Netcode for Entities + Unity 6.7 | docs.unity3d.com NGO 3.1 changelog | Unity Discussions announcement | (cross-cite: Boss Room unmaintained doc) | ✅ Triple-verified |
| Host-migration gap in shipped co-op save corpus | DRG (none documented) | Valheim (no statement) + Unity NGO docs (explicit) | Lethal Company / RoR2 / Sea of Stars (none) | ✅ Triple-verified |
| Solo-postmortem solo failure mode is time/will, not money | FOMOGRAPHY (6.5 yrs, $0) | Drunk Shotgun ($4k spent, $30 earned) | Crumbling World ($1,380 earned, debt) | ✅ Triple-verified |
| Unity 6 HDRP package version table | docs.unity3d.com HDRP 17.7 changelog | Unity download archive | HDRP 17 what's new | ✅ Triple-verified |

### 10.2 Conflicts surfaced (not averaged — picked + explained)

**Conflict 1: HDRP "the right choice for PC + PS5 + Xbox Series"?**
- **Position A (HDRP agent):** HDRP is in maintenance mode; URP gets new features.
- **Position B (Console perf agent):** True HDRP console titles exist (NFS Unbound, Projekt Z, Harold Halibut, V Rising, Slime Rancher 2, Gallipoli) — HDRP is a viable console pipeline.
- **Resolution:** **HDRP is viable, but frozen.** You are building against a pipeline that will not improve. **Stay on HDRP** (VALE 1 is already on it) but **budget for custom render passes / native plugins** if you need HDRP features Unity won't add.

**Conflict 2: Where to put the dialogue system?**
- **Position A (Dialogue agent):** Custom = 4.35 (highest), Yarn Spinner = 3.95.
- **Position B (Subsystem tractability):** Dialogue = Trivial, $47.50 buy or extend VALE 1.
- **Resolution:** Both agree **NOT articy:draft** and **NOT Ink**. **Recommended path:** **extend VALE 1's DialogueRunner + add Yarn Spinner as the authoring layer** — Yarn Spinner's MIT license + built-in CSV/XLIFF + Luma Island co-op validation + VS Code graph view make it the strongest authoring system, while your VALE 1 runtime gives you full control.

**Conflict 3: Netcode choice with no console devkit yet?**
- **Position A:** No blanket recommendation.
- **Position B:** Console relay is the binding unknown, identical-risk across all three.
- **Resolution:** **Decide on prediction needs + license + solo-dev speed now; validate console relay in week 1 with a devkit.** Practical solo-dev call: **NGO 2.x on Unity 6.6** if Unity-first-party + Relay + UGS; **FishNet 4.7.x** for free prediction; **Mirror** for MIT + largest tutorial corpus. **Do NOT commit to NGO 3.0** (requires Unity 6.7 + Entities hard dep, Boss Room sample unmaintained).

**Conflict 4: How big is VALE 2 vs VALE 1?**
- **Original brief:** "scope is roughly 10x VALE 1."
- **Reality:** ~10× NPCs, **~40× quests**, plus **4 NEW capability categories** + **2 NEW platform certifications**.
- **Resolution:** **The original 10× framing understates the scope.** The postmortem corpus (11/12 cite scope > time/money as #1 root cause) makes this the single most important thing to internalize.

---

## SECTION 11 — MVP Cut Recommendations

### 11.1 MUST-HAVE for VALE 2 MVP

| System | Why must stay | Evidence |
|---|---|---|
| **Stylized HDRP fairy-world aesthetic** (the IP) | Brand promise | VALE 1's only shippable IP |
| **First-person movement** (with VALE 1's flight toggle) | Core verb | VALE 1 pattern |
| **Procedural terrain** (multiple biomes, tree species) | "Open world" claim | §2.2 + §7 risk |
| **Core dialogue** (extend VALE 1 + Yarn Spinner authoring) | Story is the differentiator | §6.4 |
| **Quest system** (200+ over time; start with 20-30 in MVP) | Core content loop | §7 risk |
| **PC platform support** | Existing reach | §3 + §5 |
| **Save/Load** (chunked, seed-based, mod-aware schema from day 1) | Without this nothing else compounds | §5 |

### 11.2 DEFER for MVP

| System | Why defer |
|---|---|
| **Multiplayer co-op** (4-player NGO) | 3/12 multiplayer solo/small studios died on it |
| **Procedural open world** (true open) | Ship VALE 1's forest at 10× scale; add procedural in v1.1 |
| **200+ quests** | Ship with 20-30 hand-crafted; build system, fill content later |
| **Modding** | Multi-year; 4-player versioning alone is 2-3 months |
| **Full localization pipeline** (5+ languages) | Ship English + 1 second language |
| **PS5 + Xbox Series certification** | Cost + risk; ship PC first |
| **Custom audio middleware** (FMOD/Wwise) | Unity built-in covers MVP |
| **Achievements** (full cross-platform) | Steam-only for MVP |

### 11.3 CUT permanently

| System | Why cut |
|---|---|
| **Modding infrastructure** | Multi-year. Terraria 3 devs maintained 12 years; solo dev cannot. |
| **Real-time rollback netcode** | None ships it; DIY multi-month |
| **Frame-perfect competitive netcode** | Not the genre |
| **Path tracing** | Offline-only |
| **MSAA at 4K** | Memory-prohibitive |
| **articy:draft X** (specifically) | Binary breaks Git; no multiplayer examples; Enterprise cost trap |
| **Ink** (specifically) | No localization; stale Unity; translation conflict |

### 11.4 Recommended MVP scope (~34 weeks of evenings)

| Subsystem | Approach | Cost |
|---|---|---|
| HDRP + 60fps PC | TAA + DRS + (FSR/DLSS upscale), 2 HDRP Assets, 1.5× VALE 1 forest | ~6 weeks |
| World streaming | SECTR ($99) or hand-rolled around `CullingGroup` + APV streaming + Additive Scene loading | ~4 weeks |
| Dialogue | Extend VALE 1 `DialogueRunner` + Yarn Spinner authoring (free tier) | ~3 weeks |
| Quest | Dialogue System quest module ($47.50) OR extend VALE 1 pattern | ~3 weeks |
| Inventory | ItemForge ($12) OR hand-roll | ~2 weeks |
| Crafting | ItemForge (included) + ~20 recipes | ~2 weeks |
| Save/Load | Chunked, seed-based, mod-aware schema from day 1 (Valheim 1.0 pattern) | ~3 weeks |
| UI | UI Toolkit + DOTween (free) + Fantasy RPG UI Toolkit Starter ($5.99) | ~3 weeks |
| Audio | Unity built-in (defer FMOD/Wwise) | ~1 week |
| Achievements | Steam-only | ~1 week |
| Localization (en + 1) | Unity Localization (free) | ~2 weeks |
| Polish + QA buffer | 4-week end-of-cycle QA | ~4 weeks |
| **TOTAL** | | **~34 weeks** |

### 11.5 Pre-commit decision tree

```
IF you want VALE 2 to ship in 1 year of evenings solo
├─ Must commit to: Single-player MVP, PC-only, no modding, English + 1 language
├─ Must accept: HDRP maintenance mode (pipeline won't improve)
├─ Must accept: No host migration
├─ Must write kill-switch criteria NOW
└─ Must start Steam Coming-Soon + devlog cadence in month 1

IF you want 4-player co-op at launch
├─ Add NGO or FishNet (decide week 1)
├─ Add 3-5 man-months for netcode
├─ Add host-locked model (no host migration)
├─ Add ~3 man-months for co-op save/load state reconciliation
└─ Total: 1 year is the ceiling; expect 18 months minimum

IF you want PS5 + Xbox Series at launch
├─ Need devkits in week 1 (6+ month lead time)
├─ Need Unity Pro + platform packages
├─ Need $20-50k certification + ~3 man-months of console optimization
└─ Effectively requires: a team

IF you want modding at launch
├─ Plan 6-12 months minimum
├─ Must design mod-aware save schema from day 1
└─ Realistic solo path: defer to v1.1+, or skip
```

---

## SECTION 12 — Immediate Next Steps (week 1)

See [WEEK-1-STARTER.md](WEEK-1-STARTER.md) for the day-by-day plan.

---

## APPENDIX A — Source Index

**HDRP / Unity 6:**
- [Unity Render Pipelines Strategy 2026](https://unity.com/topics/render-pipelines-strategy-for-2026)
- [HDRP 17.5 What's New](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.5/manual/whats-new-17.html)
- [HDRP 17.7 Changelog](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4017.7/changelog/CHANGELOG.html)
- [HDRP Asset Reference](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/HDRP-Asset.html)
- [Scalability Manual](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Scalability-Manual.html)
- [BRG Documentation](https://github.com/unity-technologies/graphics/blob/master/Packages/com.unity.render-pipelines.high-definition/Documentation~/batch-renderer-group-creating-batches.md)

**Console performance:**
- [DF Xbox Series S Review](https://www.digitalfoundry.net/articles/xbox-series-s-review-digitalfoundry)
- [DF Forspoken](https://www.digitalfoundry.net/articles/digitalfoundry-2023-forspoken-revisited-on-ps5-does-the-final-update-fix-the-games-technical-issues)
- [DF FFVII Rebirth](https://www.digitalfoundry.net/articles/digitalfoundry-2024-final-fantasy-7-rebirth-tech-review-an-excellent-but-inconsistent-experience)
- [DF Crimson Desert](https://www.digitalfoundry.net/reviews/crimson-desert-on-xbox-series-x-improved-by-update-n-but-whats-up-with-series-s)
- [DF AC Black Flag Resynced](https://www.digitalfoundry.net/features/we-really-squeezed-the-ps5-as-much-as-we-could-ubisoft-talks-tech-on-assassins-creed-black-flag-resynced)
- [Unity 6 Game Optimization Guides](https://unity.com/blog/unity-6-game-optimization-guides)

**Netcode:**
- [Unity Discussions — NGO 3.0.0](https://discussions.unity.com/t/netcode-for-gameobjects-3-0-0-is-now-available/1736792)
- [NGO 3.1 Changelog](https://docs.unity3d.com/Packages/com.unity.netcode.gameobjects@3.1/changelog/CHANGELOG.html)
- [NGO listen-server architecture](https://github.com/Unity-Technologies/com.unity.netcode.gameobjects/blob/b335cc47115e603b77818c0127264d657372b10b/com.unity.netcode.gameobjects/Documentation~/learn/listenserverhostarchitecture.md)

**Save systems:**
- [Iron Gate Valheim FAQ](https://steamcommunity.com/app/892970/discussions/0/4615641483004444994)
- [Valheim 1.0 save rework](https://gamever.io/knowledge-base/valheims-new-world-save-system-your-world-is-no-longer-two-files)
- [Epic DRG interview](https://www.unrealengine.com/en-US/developer-interviews/guns-gold-and-glory-in-the-caverns-of-deep-rock-galactic)
- [PlayStation.Blog Sea of Stars co-op](https://blog.playstation.com/2024/11/12/sea-of-stars-dawn-of-equinox-devs-deep-dive-into-3-player-co-op-and-combat-2-0-live-today/)

**Dialogue:**
- [Ink GitHub](https://github.com/inkle/ink)
- [Yarn Spinner spec](https://github.com/YarnSpinnerTool/YarnSpinner/blob/9275277f50a6acbe8438b29596acc8527cf5581a/Documentation/Yarn-Spec.md)
- [Yarn Spinner showcase](https://yarnspinner.dev/showcase/)
- [articy:draft Disco Elysium showcase](https://www.articy.com/en/showcase/disco-elysium/)
- [Cyberpunk GDC 2023 (REDengine, not articy)](https://gdcvault.com/play/1034181)
- [Larian narrative masterclass](https://www.gamereactor.eu/vladimir-gaidenko-gives-a-masterclass-on-larian-studios-narrative-design-in-baldurs-gate-3-scripting-the-unscriptable-1505593/)

**Postmortems:**
- [Code Hero — Engadget](https://www.engadget.com/2013-08-15-code-hero-one-year-later-money-lawsuits-and-poker.html)
- [Upsilon Circuit — Kotaku](https://kotaku.com/perma-permadeath-game-upsilon-circuit-gets-canceled-1821424353)
- [Scarlet Republics — ing.dk](https://ing.dk/artikel/over-1000-people-backed-danish-game-developer-kickstarter-now-hes-closing-shop)
- [Yogventures — Polygon](https://www.polygon.com/2014/7/20/5920079/yogscast-kickstarter-canceled-yogventures-winterkewl/)
- [UnnyWorld — Apanasik](https://apanasik.com/blog/unnyworld-postmortem/)
- [FOMOGRAPHY — Brendan Keesing](https://brendankeesing.com/blog/fomography_postmortem/)
- [Chains of Fury — Cobble Games](https://cobble.games/blog/chains-of-fury-postmortem)
- [Crumbling World — Dani Marti](https://danimarti.itch.io/crumbling-world/devlog/160435/crumbling-world-post-mortem-the-story-of-a-failure)
- [Drunk Shotgun — Game Developer](https://www.gamedeveloper.com/business/how-i-wasted-4k-and-half-a-year-of-my-life-to-develop-a-game-that-earned-only-30)
- [Dukes & Dirigibles — Game Developer](https://www.gamedeveloper.com/business/analyzing-our-failed-kickstarter)
- [Shadow Physics — Kotaku](https://kotaku.com/why-the-indie-game-that-was-supposed-to-be-the-next-bra-5891076)
- [Eastshade — official](https://eastshade.com/postmortem-eastshade/)

---

## APPENDIX B — What Was Corrected in My Original Prompt

1. **DRG is UE4, not Unity** — verified via Epic interview + GVAS save format.
2. **Sea of Stars is Unity, not UE4** — verified via BepInEx + URP "Eclipse" mod ecosystem.
3. **Cyberpunk/BG3/Outer Worlds do not use articy:draft** — they use custom in-house tools.
4. **Forspoken uses Luminous Engine, not HDRP** — DF confirmed.
5. **FFVII Remake/Rebirth uses UE4, not HDRP** — DF confirmed.
6. **HDRP is in maintenance mode in 2026** — Unity official strategy page.
7. **Unity killed Multiplay Game Server Hosting on 31 March 2026** — third-party + Unity Discussions.
8. **NGO 3.0 requires Unity 6.7 LTS + Netcode for Entities hard dep** — official changelog.
9. **Boss Room sample (canonical NGO learning asset) is no longer actively maintained** — official docs.
10. **VALE 2 is "10x VALE 1" in NPCs/quests but adds 4 NEW capability categories + 2 NEW platform certs** — verified by reading the monorepo.

---

## APPENDIX C — Known Gaps

1. **World Partition C# member-level API** — verified editor/config surface only.
2. **Per-upscaler frame-buffer format constraints** — not documented.
3. **Exact ms-per-RT-effect on PS5/XSX for HDRP** — no Unity-published table.
4. **Measured frame times for true HDRP console titles** — search backends throttled.
5. **Dialogue agent timed out at 30 min** — sections 1-8 + weighted scoring delivered; source index truncated.
6. **Save file size ranges** — only Valheim documented.
7. **Console certification specifics for NGO/Mirror/FishNet** — none publishes "certified on PS5/Xbox."
8. **Postmortem corpus skews to older Unity** — none documents Unity 2022 LTS or Unity 6 build.

---

**FINAL WORD:** The pre-commitment scan is complete. **5 of 5 critical risks identified.** VALE 2 is buildable in 1 year of evenings **only if** you ship a single-player PC MVP with extended VALE 1 dialogue + Yarn Spinner authoring, defer multiplayer, skip modding, defer PS5/Xbox, and write your kill-switch criteria before writing any code.

The 12-postmortem corpus is unambiguous: **the kill-switch is the single most under-used tool.** Write yours now.
