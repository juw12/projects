using UnityEditor;
using UnityEngine;
using Vale.Core;

namespace Vale.Editor
{
    /// <summary>
    /// Procedurally scatters trees and mushrooms on the active scene's terrain.
    /// Skips a clearing around the player spawn point and around the Sacred Glade.
    /// Run via menu: <c>Vale &gt; Populate Forest</c>.
    /// </summary>
    public static class ForestPopulator
    {
        private const int TreeCount = 120;
        private const int MushroomCount = 80;
        private const int Seed = 42;
        private const float ClearRadiusAroundSpawn = 8f;
        private const float AvoidSacredGladeRadius = 6f;

        [MenuItem("Vale/Populate Forest")]
        public static void Populate()
        {
            var terrain = Selection.activeGameObject?.GetComponent<Terrain>()
                          ?? Object.FindFirstObjectByType<Terrain>();
            if (terrain == null)
            {
                Debug.LogError("[ValeTool] No Terrain found. Run 'Vale > Build Vale Scene' first.");
                return;
            }

            var foliage = GameObject.Find("Foliage");
            if (foliage == null)
            {
                Debug.LogError("[ValeTool] No 'Foliage' root. Run 'Vale > Build Vale Scene' first.");
                return;
            }

            var spawnPoints = Object.FindObjectsByType<SpawnPoint>(FindObjectsSortMode.None);
            var gladeTransforms = CollectGladeTransforms();
            var data = terrain.terrainData;
            Vector3 basePos = terrain.transform.position;
            float halfX = data.size.x * 0.5f;
            float halfZ = data.size.z * 0.5f;

            Random.InitState(Seed);
            int treesPlaced = 0, mushroomsPlaced = 0;

            // Trees.
            for (int i = 0; i < TreeCount && treesPlaced < TreeCount; i++)
            {
                if (!TryPickTerrainPosition(basePos, halfX, halfZ, terrain, spawnPoints, gladeTransforms,
                        out Vector3 world)) continue;
                CreateTree(foliage.transform, world, i);
                treesPlaced++;
            }

            // Mushrooms.
            for (int i = 0; i < MushroomCount && mushroomsPlaced < MushroomCount; i++)
            {
                if (!TryPickTerrainPosition(basePos, halfX, halfZ, terrain, spawnPoints, gladeTransforms,
                        out Vector3 world)) continue;
                CreateMushroom(foliage.transform, world, i);
                mushroomsPlaced++;
            }

            Debug.Log($"[ValeTool] ForestPopulator: placed {treesPlaced} trees and {mushroomsPlaced} mushrooms (seed {Seed}).");
        }

        // ---- Position picker -------------------------------------------------

        private static bool TryPickTerrainPosition(
            Vector3 basePos, float halfX, float halfZ, Terrain terrain,
            SpawnPoint[] spawns, System.Collections.Generic.List<Transform> gladeTransforms,
            out Vector3 worldPos)
        {
            float x = Random.Range(-halfX, halfX);
            float z = Random.Range(-halfZ, halfZ);
            Vector3 world = basePos + new Vector3(x, 0f, z);
            float y = terrain.SampleHeight(world);
            world.y = y;

            foreach (var sp in spawns)
            {
                if (Vector3.Distance(world, sp.transform.position) < ClearRadiusAroundSpawn)
                {
                    worldPos = default;
                    return false;
                }
            }
            foreach (var t in gladeTransforms)
            {
                if (Vector3.Distance(world, t.position) < AvoidSacredGladeRadius)
                {
                    worldPos = default;
                    return false;
                }
            }

            worldPos = world;
            return true;
        }

        private static System.Collections.Generic.List<Transform> CollectGladeTransforms()
        {
            var list = new System.Collections.Generic.List<Transform>();
            var glade = GameObject.Find("SacredGlade");
            if (glade == null) return list;
            list.Add(glade.transform);
            foreach (Transform child in glade.transform) list.Add(child);
            return list;
        }

        // ---- Placeholders ----------------------------------------------------

        private static void CreateTree(Transform parent, Vector3 worldPos, int index)
        {
            var tree = new GameObject($"Tree_{index:D3}");
            Undo.RegisterCreatedObjectUndo(tree, "Create Tree");
            tree.transform.SetParent(parent, worldPositionStays: false);
            tree.transform.position = worldPos;
            tree.transform.localRotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);
            float scale = Random.Range(0.8f, 1.4f);
            tree.transform.localScale = Vector3.one * scale;

            var trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            Undo.RegisterCreatedObjectUndo(trunk, "Create Trunk");
            trunk.name = "Trunk";
            trunk.transform.SetParent(tree.transform, worldPositionStays: false);
            trunk.transform.localPosition = new Vector3(0f, 1f, 0f);
            trunk.transform.localScale = new Vector3(0.3f, 1f, 0.3f);
            Tint(trunk, new Color(0.45f, 0.30f, 0.18f));

            var canopy = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Undo.RegisterCreatedObjectUndo(canopy, "Create Canopy");
            canopy.name = "Canopy";
            canopy.transform.SetParent(tree.transform, worldPositionStays: false);
            canopy.transform.localPosition = new Vector3(0f, 2.5f, 0f);
            canopy.transform.localScale = new Vector3(1.6f, 1.2f, 1.6f);
            Tint(canopy, new Color(0.20f, 0.55f, 0.25f));
            Object.DestroyImmediate(canopy.GetComponent<Collider>());
        }

        private static void CreateMushroom(Transform parent, Vector3 worldPos, int index)
        {
            var mush = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Undo.RegisterCreatedObjectUndo(mush, "Create Mushroom");
            mush.name = $"Mushroom_{index:D3}";
            mush.transform.SetParent(parent, worldPositionStays: false);
            mush.transform.position = worldPos + new Vector3(0f, 0.2f, 0f);
            mush.transform.localScale = new Vector3(0.3f, 0.4f, 0.3f);
            Tint(mush, new Color(0.8f, 0.15f, 0.15f));
            Object.DestroyImmediate(mush.GetComponent<Collider>());
        }

        private static void Tint(GameObject go, Color color)
        {
            var r = go.GetComponent<MeshRenderer>();
            if (r == null) return;
            // Use the primitive's default material; just tint it.
            r.material.color = color;
        }
    }
}
