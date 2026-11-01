using UnityEditor;
using UnityEngine;
using Vale.Collectibles;

namespace Vale.Editor
{
    /// <summary>
    /// Places five Lumenshard instances around the Vale in a rough pentagon
    /// pattern. Each shard auto-discovers its CollectibleData asset from
    /// Resources/Collectibles and assigns its questId/objectiveId.
    /// Run via menu: <c>Vale &gt; Place Lumenshards</c>.
    /// </summary>
    public static class ShardPlacer
    {
        private const float InnerRadius = 18f;
        private const float OuterRadius = 28f;

        [MenuItem("Vale/Place Lumenshards")]
        public static void Place()
        {
            var root = GameObject.Find("Collectibles");
            if (root == null)
            {
                Debug.LogError("[ValeTool] No 'Collectibles' root. Run 'Vale > Build Vale Scene' first.");
                return;
            }

            // Try to find authored data assets (optional).
            var dataAssets = Resources.LoadAll<CollectibleData>("Collectibles");

            for (int i = 0; i < 5; i++)
            {
                float angle = i * (360f / 5f) * Mathf.Deg2Rad;
                float r = Random.Range(InnerRadius, OuterRadius);
                Vector3 pos = new Vector3(Mathf.Cos(angle) * r, 0f, Mathf.Sin(angle) * r);

                var shard = CreateShardPlaceholder($"Lumenshard_{i + 1}");
                shard.transform.SetParent(root.transform, worldPositionStays: false);
                shard.transform.position = pos;

                var shardScript = shard.GetComponent<Lumenshard>();
                if (shardScript != null)
                {
                    var so = new SerializedObject(shardScript);
                    var dataProp = so.FindProperty("data");
                    if (dataProp != null && i < dataAssets.Length)
                    {
                        dataProp.objectReferenceValue = dataAssets[i];
                    }
                    so.ApplyModifiedPropertiesWithoutUndo();
                }
            }

            Debug.Log("[ValeTool] ShardPlacer: 5 Lumenshards placed.");
        }

        private static GameObject CreateShardPlaceholder(string name)
        {
            // Use a small octahedron primitive as a placeholder shape.
            var shard = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Undo.RegisterCreatedObjectUndo(shard, "Create Lumenshard");
            shard.name = name;
            shard.transform.localScale = Vector3.one * 0.4f;

            // Glowing tint.
            var r = shard.GetComponent<MeshRenderer>();
            if (r != null)
            {
                r.material.color = new Color(0.5f, 0.9f, 1f);
                r.material.EnableKeyword("_EMISSION");
                r.material.SetColor("_EmissionColor", new Color(0.4f, 0.85f, 1f) * 1.5f);
            }

            // Replace collider with a trigger for interaction raycast + pickup detection.
            var col = shard.GetComponent<Collider>();
            if (col != null) col.isTrigger = true;

            // Add the actual MonoBehaviour.
            shard.AddComponent<Lumenshard>();

            // Add a soft point light for ambient glow (works in HDRP too).
            var glow = shard.AddComponent<Light>();
            glow.type = LightType.Point;
            glow.color = new Color(0.5f, 0.9f, 1f);
            glow.intensity = 2f;
            glow.range = 3f;

            return shard;
        }
    }
}
