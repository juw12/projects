using UnityEngine;
using Vale.Player;
using Vale.Quests;

namespace Vale.Collectibles
{
    /// <summary>
    /// A Lumenshard — one of the five shards of light scattered across the Vale.
    /// Slowly rotates and bobs when idle; emits a particle burst on collection.
    /// Notifies the QuestManager and CollectibleManager when picked up.
    /// </summary>
    public class Lumenshard : Collectible
    {
        [Header("Visual Animation")]
        [Tooltip("Rotation speed in degrees per second.")]
        [SerializeField, Range(0f, 180f)]
        private float rotationSpeed = 30f;

        [Tooltip("Vertical bob amplitude in world units.")]
        [SerializeField, Range(0f, 0.5f)]
        private float bobAmplitude = 0.1f;

        [Tooltip("Bob speed in radians per second.")]
        [SerializeField, Range(0f, 5f)]
        private float bobSpeed = 2f;

        // ─── Runtime ───────────────────────────────────────────────────────────────

        private Vector3 _basePosition;
        private float _bobOffset;
        private int _shardIndex;

        private void Awake()
        {
            _basePosition = transform.position;
            _bobOffset = Random.Range(0f, Mathf.PI * 2f);
            _shardIndex = ParseShardIndex();
        }

        private void Update()
        {
            if (IsCollected) return;

            // Slow rotation
            transform.Rotate(Vector3.up * rotationSpeed * Time.deltaTime, Space.World);

            // Bob up/down
            float y = _basePosition.y + Mathf.Sin(Time.time * bobSpeed + _bobOffset) * bobAmplitude;
            transform.position = new Vector3(_basePosition.x, y, _basePosition.z);
        }

        // ─── Collectible override ──────────────────────────────────────────────────

        /// <summary>
        /// Handles shard-specific collection logic:
        /// advances the quest objective and registers with the CollectibleManager.
        /// </summary>
        protected override void OnCollect(PlayerController player)
        {
            // Notify CollectibleManager
            if (CollectibleManager.Instance != null && data != null)
            {
                CollectibleManager.Instance.Register(data);
            }

            // Notify QuestManager
            if (!string.IsNullOrEmpty(questId) && !string.IsNullOrEmpty(objectiveId))
            {
                if (QuestManager.Instance != null)
                {
                    QuestManager.Instance.AdvanceObjective(questId, objectiveId, 1);
                }
            }
            else
            {
                // Fallback: use conventional naming if quest fields aren't explicitly set
                // e.g. collectibleId "lumenshard_3" → quest "main_quest", objective "collect_lumenshard_3"
                if (QuestManager.Instance != null && data != null)
                {
                    string fallbackQuestId = "main_quest";
                    string fallbackObjectiveId = $"collect_{data.collectibleId}";
                    QuestManager.Instance.AdvanceObjective(fallbackQuestId, fallbackObjectiveId, 1);
                }
            }

            Debug.Log($"[Lumenshard] Shard {_shardIndex} collected! (collectibleId: {data?.collectibleId})");
        }

        // ─── Private ───────────────────────────────────────────────────────────────

        /// <summary>
        /// Extracts the shard index from the collectibleId.
        /// E.g. "lumenshard_3" → 3. Returns 0 if parsing fails.
        /// </summary>
        private int ParseShardIndex()
        {
            if (data == null || string.IsNullOrEmpty(data.collectibleId)) return 0;

            var id = data.collectibleId;
            int lastUnderscore = id.LastIndexOf('_');
            if (lastUnderscore >= 0 && lastUnderscore < id.Length - 1)
            {
                string numPart = id.Substring(lastUnderscore + 1);
                if (int.TryParse(numPart, out int index))
                    return index;
            }

            return 0;
        }
    }
}
