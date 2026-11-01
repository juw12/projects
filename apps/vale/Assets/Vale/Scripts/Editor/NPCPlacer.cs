using UnityEditor;
using UnityEngine;
using Vale.Core;
using Vale.NPC;

namespace Vale.Editor
{
    /// <summary>
    /// Places the Fairy Elder at the Vale's entrance and a fairy Keeper near
    /// each Lumenshard. Auto-discovers NPCData assets from Resources/NPCs.
    /// Run via menu: <c>Vale &gt; Place NPCs</c>.
    /// </summary>
    public static class NPCPlacer
    {
        [MenuItem("Vale/Place NPCs")]
        public static void Place()
        {
            var npcsRoot = GameObject.Find("NPCs");
            if (npcsRoot == null)
            {
                Debug.LogError("[ValeTool] No 'NPCs' root. Run 'Vale > Build Vale Scene' first.");
                return;
            }

            var npcDataAssets = Resources.LoadAll<NPCData>("NPCs");

            // Wipe previously placed Elder + Keepers so the tool is idempotent.
            foreach (var existing in new[] { "FairyElder" })
            {
                var go = GameObject.Find(existing);
                if (go != null) Undo.DestroyObjectImmediate(go);
            }
            for (int i = 1; i <= 5; i++)
            {
                var go = GameObject.Find($"Keeper_{i}");
                if (go != null) Undo.DestroyObjectImmediate(go);
            }

            PlaceElder(npcsRoot.transform, npcDataAssets);

            // Keepers: one per shard, snapped to the shard's position with a small offset.
            for (int i = 1; i <= 5; i++)
            {
                var shard = GameObject.Find($"Lumenshard_{i}");
                Vector3 keeperPos = shard != null
                    ? shard.transform.position + new Vector3(2f, 1.5f, 0f)
                    : new Vector3(Mathf.Cos(i * 1.26f) * 22f, 1.5f, Mathf.Sin(i * 1.26f) * 22f);

                PlaceKeeper(npcsRoot.transform, i, keeperPos, npcDataAssets);
            }

            Debug.Log("[ValeTool] NPCPlacer: Fairy Elder + 5 Keepers placed.");
        }

        private static void PlaceElder(Transform parent, NPCData[] dataAssets)
        {
            var elder = CreateNPCPlaceholder("FairyElder", scale: 1.4f);
            elder.transform.SetParent(parent, worldPositionStays: false);
            elder.transform.position = new Vector3(2f, 0f, 0f);

            var elderScript = elder.GetComponent<FairyElder>();
            if (elderScript != null)
            {
                AssignNPCData(elderScript, dataAssets, "elder");
            }

            // ValeEntrance spawn point — empty child with a SpawnPoint component.
            var spawn = new GameObject("ValeEntrance");
            Undo.RegisterCreatedObjectUndo(spawn, "Create SpawnPoint");
            spawn.transform.SetParent(elder.transform, worldPositionStays: false);
            var sp = spawn.AddComponent<SpawnPoint>();
            var so = new SerializedObject(sp);
            var prop = so.FindProperty("pointName");
            if (prop != null) prop.stringValue = "ValeEntrance";
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void PlaceKeeper(Transform parent, int index, Vector3 worldPos, NPCData[] dataAssets)
        {
            var keeper = CreateNPCPlaceholder($"Keeper_{index}", scale: 1.0f);
            keeper.transform.SetParent(parent, worldPositionStays: false);
            keeper.transform.position = worldPos;

            var npcScript = keeper.GetComponent<FairyNPC>();
            if (npcScript != null)
            {
                AssignNPCData(npcScript, dataAssets, $"keeper_{index}");
            }
        }

        private static GameObject CreateNPCPlaceholder(string name, float scale)
        {
            // Capsule body + sphere head, all placeholders.
            var npc = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(npc, "Create NPC");
            npc.transform.localScale = Vector3.one * scale;

            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Undo.RegisterCreatedObjectUndo(body, "Create Body");
            body.name = "Body";
            body.transform.SetParent(npc.transform, worldPositionStays: false);
            body.transform.localPosition = new Vector3(0f, 1f, 0f);
            Object.DestroyImmediate(body.GetComponent<Collider>());

            var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Undo.RegisterCreatedObjectUndo(head, "Create Head");
            head.name = "Head";
            head.transform.SetParent(npc.transform, worldPositionStays: false);
            head.transform.localPosition = new Vector3(0f, 2.2f, 0f);
            head.transform.localScale = Vector3.one * 0.5f;
            Object.DestroyImmediate(head.GetComponent<Collider>());

            // Trigger collider for raycast-based interaction.
            var col = npc.AddComponent<SphereCollider>();
            col.radius = 0.6f;
            col.isTrigger = true;

            // Add the right MonoBehaviour.
            if (name == "FairyElder")
            {
                npc.AddComponent<FairyElder>();
            }
            else
            {
                npc.AddComponent<FairyNPC>();
            }

            return npc;
        }

        private static void AssignNPCData(MonoBehaviour behaviour, NPCData[] assets, string hint)
        {
            if (assets == null || assets.Length == 0) return;

            NPCData match = null;
            foreach (var a in assets)
            {
                if (a != null && a.npcId != null && a.npcId.ToLowerInvariant().Contains(hint.ToLowerInvariant()))
                {
                    match = a;
                    break;
                }
            }
            match ??= assets[0];

            var so = new SerializedObject(behaviour);
            var dataProp = so.FindProperty("data");
            if (dataProp != null) dataProp.objectReferenceValue = match;
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
