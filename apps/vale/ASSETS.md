# VALE Asset Guide

Every asset you need to download or import for VALE, organized by priority.
The "Required" tier is the bare minimum for the prototype to look right.
"Recommended" significantly improves the visual and audio quality.
"Optional" is nice to have but the game works without it.

Setup steps for the required assets are also covered in
[SETUP.md](SETUP.md#import-free-assets). For the project overview, see
[README.md](README.md). For how assets fit into the scene structure, see
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Required

The project will not look or sound right without these three.

### HDRP Starter Assets

| Field | Value |
| --- | --- |
| **Source** | [Unity Asset Store](https://assetstore.unity.com/packages/editor/high-definition-rp-starter-assets-214547) |
| **License** | Unity Asset Store Free (free with Unity ID; subject to Unity Asset Store EULA) |
| **Used for** | HDRP materials, sample lighting setup, volume profile, reference scenes. The editor scripts in VALE reference materials from this pack for terrain, foliage, and the Sacred Glade altar. |
| **Install** | In Unity: Window > Package Manager > Unity Asset Store > search "HDRP Starter Assets" > Get > Import with defaults. |

### Poly Haven HDRI: kloofendal_48d_partly_cloudy_4k

| Field | Value |
| --- | --- |
| **Source** | [Poly Haven](https://polyhaven.com/hdris/kloofendal_48d_partly_cloudy) |
| **License** | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution required) |
| **Used for** | Skybox and ambient environment lighting. Provides soft, warm, partly cloudy light that suits a fairy forest setting. Any bright outdoor HDRI from Poly Haven will work as a substitute. |
| **Install** | Download the 4K `.hdr` file from the Poly Haven page. Drag it into `Assets/Vale/Settings/HDRIs/` in Unity. Set Texture Type to "Environment (360)" and click Apply. Assign it in Edit > Project Settings > Lighting as the environment background. |

### Kenney Nature Kit

| Field | Value |
| --- | --- |
| **Source** | [kenney.nl/assets/nature-kit](https://kenney.nl/assets/nature-kit) |
| **License** | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution required) |
| **Used for** | Low-poly trees, mushrooms, rocks, grass patches, and other foliage prefabs. The `ForestPopulator` editor script scatters these across the terrain to build the forest. |
| **Install** | Download the ZIP from the Kenney page, extract it, and drag the `Prefabs` folder into `Assets/Vale/Prefabs/Vegetation/` in Unity. |

---

## Recommended

These are not required for the prototype to work, but they make a big
difference in visual and audio quality.

### Low Poly Forest Pack (Unity Asset Store, free)

| Field | Value |
| --- | --- |
| **Source** | [Unity Asset Store](https://assetstore.unity.com) (search: "low poly forest", filter by Free) |
| **License** | Varies by pack. Most free packs are under the Unity Asset Store Free license. Check the individual pack page. |
| **Used for** | Additional tree and bush variety beyond the Kenney Nature Kit. Adds visual density to the forest. |
| **Install** | Search the Asset Store, filter by Free, pick a pack that suits the Vale's aesthetic (mossy, slightly whimsical), click Get, then Import. Drag the prefabs you like into `Assets/Vale/Prefabs/Vegetation/` alongside the Kenney prefabs. |

### Fairy Character Pack (Unity Asset Store, free)

| Field | Value |
| --- | --- |
| **Source** | [Unity Asset Store](https://assetstore.unity.com) (search: "fairy character", filter by Free) |
| **License** | Varies by pack. Check the individual pack page. |
| **Used for** | Fairy character models for the NPC prefabs (Fairy Elder and the five Keepers). Without a character model, NPCs use a placeholder capsule. |
| **Install** | Search the Asset Store, filter by Free, pick a fairy sprite or 3D model pack, click Get, then Import. Assign the model to the NPC prefab in `Assets/Vale/Prefabs/`. |

### Ambient forest audio (freesound.org)

| Field | Value |
| --- | --- |
| **Source** | [freesound.org](https://freesound.org) (search: "forest ambience" or "forest birds") |
| **License** | Varies by track. Most tracks are CC0 or CC-BY. **Check the license on each individual track before use.** CC0 requires no attribution. CC-BY requires you to credit the creator. |
| **Used for** | Looping ambient audio: birdsong, wind through leaves, distant water. Attached to the `AmbientAudioManager` in the scene. |
| **Install** | Download 1 to 3 tracks in `.wav` or `.ogg` format. Drag them into `Assets/Vale/Audio/` in Unity. In the `AmbientAudioManager` component, assign the clip(s) to the ambient audio source. If the track is CC-BY, note the creator's name and URL in a `CREDITS.md` file in the project root. |

### Fairy music (freesound.org or OpenGameArt.org)

| Field | Value |
| --- | --- |
| **Source** | [freesound.org](https://freesound.org) (search: "fairy music" or "whimsical ambient") or [OpenGameArt.org](https://opengameart.org) (search: "fairy" or "whimsical") |
| **License** | Varies by track. Most are CC0 or CC-BY. **Check the license on each track.** |
| **Used for** | Background music. A soft, whimsical loop for exploration; a slightly more emotional track for the Sacred Glade finale. |
| **Install** | Download in `.wav` or `.ogg`. Drag into `Assets/Vale/Audio/`. Assign to the `AudioManager`'s BGM source. Credit CC-BY tracks in `CREDITS.md`. |

---

## Optional

Nice to have. The game is fully playable without any of these.

### Realistic Tree Pack (SpeedTree, paid)

| Field | Value |
| --- | --- |
| **Source** | [Unity Asset Store](https://assetstore.unity.com/packages/3d/vegetation/trees) (search: "SpeedTree" or "realistic tree pack") |
| **License** | **Paid.** Individual packs range from $10 to $100+. The Unity Asset Store license applies. |
| **Used for** | High-quality, wind-animated trees with LOD support. Replaces the low-poly Kenney trees for a more realistic forest. |
| **Install** | Purchase and import from the Asset Store. Drag the tree prefabs into `Assets/Vale/Prefabs/Vegetation/` and update the `ForestPopulator` script's prefab list to include them. |

### HDRP Volumetric Fog

| Field | Value |
| --- | --- |
| **Source** | Built into HDRP (no separate download needed). Enable it in the Volume Profile. |
| **License** | Part of HDRP, subject to Unity's HDRP license. |
| **Used for** | Adds depth and atmosphere to the forest. Soft fog layers make the trees recede into a hazy background, enhancing the sense of scale and mystery. |
| **Install** | Select your Volume Profile asset in `Assets/Vale/Settings/`. In the Inspector, add a **Volumetric Fog** volume component. Set `Density` to about `0.01`, `Albedo` to a pale blue-white, and `Max Fade Distance` to `50`. Adjust to taste. |

---

## Licensing summary

| Asset | License | Attribution required? |
| --- | --- | --- |
| HDRP Starter Assets | Unity Asset Store Free | No (subject to Unity EULA) |
| Poly Haven HDRI | CC0 1.0 | No |
| Kenney Nature Kit | CC0 1.0 | No |
| freesound.org audio | CC0 or CC-BY (per track) | CC0: no. CC-BY: yes, credit creator and track name. |
| OpenGameArt.org music | CC0 or CC-BY (per track) | CC0: no. CC-BY: yes, credit creator and track name. |
| Unity Asset Store free packs | Unity Asset Store Free (per pack) | Check individual pack page |
| SpeedTree packs | Paid, Unity Asset Store license | Per Unity EULA |

**Rule of thumb:** if the license is CC-BY, create a `CREDITS.md` file in the
project root and list the creator's name, the asset name, and the source URL.
This satisfies the attribution requirement.
