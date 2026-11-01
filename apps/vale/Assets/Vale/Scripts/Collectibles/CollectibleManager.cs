using System;
using System.Collections.Generic;
using UnityEngine;
using Vale.Core;

namespace Vale.Collectibles
{
    /// <summary>
    /// Singleton that tracks inventory counts for all collectibles and
    /// manages shard placement state at the altar.
    /// </summary>
    public class CollectibleManager : MonoBehaviour
    {
        /// <summary>Scene-wide singleton instance.</summary>
        public static CollectibleManager Instance { get; private set; }

        // ─── Events ────────────────────────────────────────────────────────────────

        /// <summary>Fired when a collectible is added to the inventory. Args: data, new total count.</summary>
        public event Action<CollectibleData, int> OnCollectibleAdded;

        /// <summary>Fired when a shard is placed on the altar. Args: zero-based shard index (0-4).</summary>
        public event Action<int> OnShardPlaced;

        /// <summary>Fired when all 5 shards have been placed on the altar.</summary>
        public event Action OnAllShardsPlaced;

        /// <summary>Fired when all 5 Lumenshards have been collected (not yet placed).</summary>
        public event Action OnAllShardsCollected;

        // ─── State ─────────────────────────────────────────────────────────────────

        /// <summary>Number of Lumenshards expected in the world.</summary>
        public const int TotalShards = 5;

        private readonly Dictionary<string, int> _inventory = new Dictionary<string, int>();
        private readonly bool[] _shardsPlaced = new bool[TotalShards];

        // ─── Unity lifecycle ───────────────────────────────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ─── Public API ────────────────────────────────────────────────────────────

        /// <summary>
        /// Registers a collected item, incrementing its inventory count.
        /// Fires <see cref="OnCollectibleAdded"/> and checks for all-shards-collected.
        /// </summary>
        public void Register(CollectibleData data)
        {
            if (data == null) return;

            if (!_inventory.ContainsKey(data.collectibleId))
                _inventory[data.collectibleId] = 0;

            _inventory[data.collectibleId]++;
            int newCount = _inventory[data.collectibleId];

            RaiseCollectibleAdded(data, newCount);

            // Check if all shards are now collected
            if (IsLumenshardId(data.collectibleId))
            {
                CheckAllShardsCollected();
            }
        }

        /// <summary>Gets the inventory count for a collectible id. Returns 0 if not present.</summary>
        public int GetCount(string collectibleId)
        {
            return _inventory.TryGetValue(collectibleId, out int count) ? count : 0;
        }

        /// <summary>
        /// Places a shard on the altar at the given index.
        /// Called by the Altar interaction handler.
        /// </summary>
        /// <param name="shardIndex">Zero-based shard index (0-4).</param>
        public void PlaceShard(int shardIndex)
        {
            if (shardIndex < 0 || shardIndex >= TotalShards)
            {
                Debug.LogWarning($"[CollectibleManager] Invalid shard index: {shardIndex}");
                return;
            }

            if (_shardsPlaced[shardIndex])
            {
                Debug.LogWarning($"[CollectibleManager] Shard {shardIndex} is already placed.");
                return;
            }

            _shardsPlaced[shardIndex] = true;
            RaiseShardPlaced(shardIndex);

            if (AllShardsPlaced())
                RaiseAllShardsPlaced();
        }

        /// <summary>True if the shard at the given index has been placed on the altar.</summary>
        public bool IsShardPlaced(int shardIndex)
        {
            return shardIndex >= 0 && shardIndex < TotalShards && _shardsPlaced[shardIndex];
        }

        /// <summary>True when all 5 shards are placed on the altar.</summary>
        public bool AllShardsPlaced()
        {
            for (int i = 0; i < TotalShards; i++)
            {
                if (!_shardsPlaced[i]) return false;
            }
            return true;
        }

        /// <summary>True when all 5 Lumenshards have been picked up (regardless of placement).</summary>
        public bool AllShardsCollected()
        {
            for (int i = 1; i <= TotalShards; i++)
            {
                string id = $"lumenshard_{i}";
                if (GetCount(id) < 1) return false;
            }
            return true;
        }

        // ─── Save / Load ───────────────────────────────────────────────────────────

        /// <summary>
        /// Captures inventory counts for saving.
        /// Returns a <see cref="SerializableDictionary{String,int}"/> keyed by collectibleId.
        /// </summary>
        public SerializableDictionary<string, int> CaptureInventory()
        {
            var result = new SerializableDictionary<string, int>();
            foreach (var kvp in _inventory)
            {
                result[kvp.Key] = kvp.Value;
            }
            return result;
        }

        /// <summary>Restores inventory counts from save data. Clears current state first.</summary>
        public void ApplyInventory(SerializableDictionary<string, int> saved)
        {
            _inventory.Clear();
            if (saved == null) return;

            foreach (var key in saved.Keys)
            {
                int value = saved[key];
                _inventory[key] = value;
            }
        }

        /// <summary>Captures shard placement state for saving.</summary>
        public bool[] CaptureShardsPlaced()
        {
            return (bool[])_shardsPlaced.Clone();
        }

        /// <summary>Restores shard placement state from save data.</summary>
        public void ApplyShardsPlaced(bool[] saved)
        {
            if (saved == null) return;
            int len = Math.Min(saved.Length, TotalShards);
            for (int i = 0; i < len; i++)
            {
                _shardsPlaced[i] = saved[i];
            }
        }

        // ─── Private ───────────────────────────────────────────────────────────────

        private static bool IsLumenshardId(string collectibleId)
        {
            if (string.IsNullOrEmpty(collectibleId)) return false;
            return collectibleId.StartsWith("lumenshard_", StringComparison.Ordinal);
        }

        private void CheckAllShardsCollected()
        {
            if (AllShardsCollected())
            {
                Debug.Log("[CollectibleManager] All 5 Lumenshards collected!");
                RaiseAllShardsCollected();
            }
        }

        private void RaiseCollectibleAdded(CollectibleData data, int newCount) => OnCollectibleAdded?.Invoke(data, newCount);
        private void RaiseShardPlaced(int index) => OnShardPlaced?.Invoke(index);
        private void RaiseAllShardsPlaced() => OnAllShardsPlaced?.Invoke();
        private void RaiseAllShardsCollected() => OnAllShardsCollected?.Invoke();
    }
}
