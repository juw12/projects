using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Vale.Collectibles;
using Vale.Core;
using Vale.NPC;
using Vale.Player;

namespace Vale.Editor
{
    /// <summary>
    /// Builds the FairyVale scene hierarchy from scratch.
    /// Creates terrain, lighting, player, camera, and empty placeholder roots
    /// for NPCs, collectibles, foliage, the Sacred Glade, UI, and audio.
    /// Run via menu: <c>Vale &gt; Build Vale Scene</c>.
    /// </summary>
    public static class ValeSceneBuilder
    {
        private const string ScenePath = "Assets/Vale/Scenes/FairyVale.unity";

        [MenuItem("Vale/Build Vale Scene")]
        public static void BuildScene()
        {
            EnsureFolder("Assets/Vale/Scenes");
            EnsureFolder("Assets/Vale/Prefabs/Collectibles");
            EnsureFolder("Assets/Vale/Prefabs/NPCs");
            EnsureFolder("Assets/Vale/Prefabs/Player");

            // Open (or create) the target scene.
            var scene = OpenOrCreateScene();

            // Wipe any previous roots so the tool is idempotent.
            foreach (var name in new[] {
                "Lighting", "Terrain", "Foliage", "NPCs", "Collectibles",
                "SacredGlade", "Player", "UI", "Audio", "Main Camera" })
            {
                var existing = GameObject.Find(name);
                if (existing != null) Undo.DestroyObjectImmediate(existing);
            }

            BuildEmptyRoots();
            BuildLighting();
            BuildTerrain();
            BuildMainCamera();
            BuildPlayer();
            BuildSacredGlade();
            BuildUIRoot();
            BuildAudioRoot();

            SaveScene(scene);
            AddSceneToBuildSettings();

            Debug.Log("[ValeTool] ValeSceneBuilder: FairyVale scene built at " + ScenePath);
        }

        // ---- Scene plumbing -------------------------------------------------

        private static Scene OpenOrCreateScene()
        {
            var active = EditorSceneManager.GetActiveScene();
            bool isOurScene = active.path == ScenePath;
            bool isEmptyUntitled = active.rootCount == 0 && string.IsNullOrEmpty(active.path);

            if (!isOurScene && !isEmptyUntitled)
            {
                Debug.Log("[ValeTool] Active scene is unrelated; creating new FairyVale scene.");
                return EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }

            // Reuse the empty untitled scene, or the existing FairyVale scene.
            if (isEmptyUntitled)
            {
                Debug.Log("[ValeTool] Reusing empty untitled scene; will save as FairyVale.unity.");
            }
            else
            {
                Debug.Log("[ValeTool] Reusing existing FairyVale scene.");
            }
            return active;
        }

        private static void SaveScene(Scene scene)
        {
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
        }

        private static void AddSceneToBuildSettings()
        {
            var scenes = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            bool already = false;
            foreach (var s in scenes) if (s.path == ScenePath) { already = true; s.enabled = true; break; }
            if (!already)
            {
                scenes.Add(new EditorBuildSettingsScene(ScenePath, true));
            }
            EditorBuildSettings.scenes = scenes.ToArray();
        }

        // ---- Roots ----------------------------------------------------------

        private static void BuildEmptyRoots()
        {
            foreach (var name in new[] {
                "Lighting", "Terrain", "Foliage", "NPCs", "Collectibles",
                "SacredGlade", "UI", "Audio" })
            {
                CreateEmpty(name);
            }
        }

        private static void BuildLighting()
        {
            var root = CreateEmpty("Lighting");

            // Directional light (warm-white, soft shadows).
            var lightGo = new GameObject("Sun");
            Undo.RegisterCreatedObjectUndo(lightGo, "Create Sun Light");
            lightGo.transform.SetParent(root.transform);
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.96f, 0.89f);
            light.intensity = 1.0f;
            light.shadows = LightShadows.Soft;
            lightGo.transform.rotation = Quaternion.Euler(45f, 35f, 0f);

            // Volume placeholder (HDRP profile assigned by user in inspector).
            var volumeGo = new GameObject("Volume");
            Undo.RegisterCreatedObjectUndo(volumeGo, "Create Volume");
            volumeGo.transform.SetParent(root.transform);
            volumeGo.AddComponent<UnityEngine.Rendering.Volume>();
            Debug.Log("[ValeTool] ValeSceneBuilder: 'Volume' placeholder created — assign an HDRP Volume Profile in the inspector.");
        }

        private static void BuildTerrain()
        {
            var root = GameObject.Find("Terrain");
            var data = new TerrainData();
            data.heightmapResolution = 513;
            data.size = new Vector3(120f, 8f, 120f);
            // Leave heights at zero; user can sculpt with Terrain Tools.
            var terrainGo = Terrain.CreateTerrainGameObject(data);
            Undo.RegisterCreatedObjectUndo(terrainGo, "Create Terrain");
            terrainGo.name = "ValeTerrain";
            terrainGo.transform.SetParent(root.transform);
        }

        private static void BuildMainCamera()
        {
            var camGo = new GameObject("Main Camera");
            Undo.RegisterCreatedObjectUndo(camGo, "Create Main Camera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.fieldOfView = 60f;
            camGo.AddComponent<AudioListener>();
            camGo.AddComponent<PlayerCamera>();
            camGo.transform.position = new Vector3(0f, 1.6f, 0f);
        }

        private static void BuildPlayer()
        {
            var playerGo = new GameObject("Player");
            Undo.RegisterCreatedObjectUndo(playerGo, "Create Player");
            playerGo.AddComponent<CharacterController>();
            playerGo.AddComponent<PlayerController>();
            playerGo.AddComponent<PlayerFlight>();
            playerGo.AddComponent<PlayerInteraction>();
            playerGo.transform.position = new Vector3(0f, 1f, 0f);
            // Hook camera as child.
            var mainCam = GameObject.Find("Main Camera");
            if (mainCam != null) mainCam.transform.SetParent(playerGo.transform, worldPositionStays: false);
        }

        private static void BuildSacredGlade()
        {
            var glade = GameObject.Find("SacredGlade");
            var altar = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            Undo.RegisterCreatedObjectUndo(altar, "Create Altar");
            altar.name = "Altar";
            altar.transform.SetParent(glade.transform);
            altar.transform.localScale = new Vector3(1.2f, 0.3f, 1.2f);
            altar.transform.position = new Vector3(0f, 0.3f, 0f);
        }

        private static void BuildUIRoot()
        {
            var ui = GameObject.Find("UI");
            // The actual Canvas is created by the user in SETUP.md (UGUI Canvas).
            // We just leave a marker so the user has a parent to drag panels under.
            ui.AddComponent<RectTransform>();
        }

        private static void BuildAudioRoot()
        {
            var audio = GameObject.Find("Audio");
            var source = audio.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.loop = true;
            source.spatialBlend = 0f; // 2D music
        }

        // ---- Helpers --------------------------------------------------------

        private static GameObject CreateEmpty(string name)
        {
            var go = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(go, "Create " + name);
            return go;
        }

        private static void EnsureFolder(string assetFolder)
        {
            if (AssetDatabase.IsValidFolder(assetFolder)) return;
            var parent = Path.GetDirectoryName(assetFolder).Replace("\\", "/");
            var leaf = Path.GetFileName(assetFolder);
            if (!AssetDatabase.IsValidFolder(parent)) EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, leaf);
        }
    }
}
