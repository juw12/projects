using System;
using System.IO;
using UnityEngine;

namespace Vale.Core
{
    /// <summary>
    /// JSON save/load to <see cref="Application.persistentDataPath"/>.
    /// Schema is documented in ARCHITECTURE.md.
    /// </summary>
    public class SaveSystem : MonoBehaviour
    {
        [Header("Save")]
        [Tooltip("File name inside persistentDataPath.")]
        [SerializeField] private string fileName = "vale_save.json";

        [Tooltip("Bump when the save schema changes.")]
        [SerializeField] private int currentVersion = 1;

        public string SavePath => Path.Combine(Application.persistentDataPath, fileName);
        public bool HasSave => File.Exists(SavePath);
        public SaveData Current { get; private set; }

        public event Action<SaveData> OnLoaded;
        public event Action<SaveData> OnSaved;

        private void Awake()
        {
            // Start with an empty default.
            Current = new SaveData { version = currentVersion };
        }

        // ---- Public API ------------------------------------------------------

        public void Save()
        {
            try
            {
                Current.version = currentVersion;
                Current.timestamp = DateTime.UtcNow.ToString("o");

                var snapshot = CaptureFromSubsystems();
                var json = JsonUtility.ToJson(snapshot, prettyPrint: true);

                File.WriteAllText(SavePath, json);
                Current = snapshot;
                OnSaved?.Invoke(snapshot);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SaveSystem] Save failed: {ex.Message}");
            }
        }

        public bool Load()
        {
            if (!HasSave) return false;

            try
            {
                var json = File.ReadAllText(SavePath);
                var data = JsonUtility.FromJson<SaveData>(json);

                if (data.version != currentVersion)
                {
                    Debug.LogWarning(
                        $"[SaveSystem] Save version {data.version} != current {currentVersion}. " +
                        "Migrating forward; missing fields reset to defaults.");
                    data.version = currentVersion;
                }

                Current = data;
                ApplyToSubsystems(data);
                OnLoaded?.Invoke(data);
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SaveSystem] Load failed: {ex.Message}");
                return false;
            }
        }

        public void DeleteSave()
        {
            if (HasSave) File.Delete(SavePath);
            Current = new SaveData { version = currentVersion };
        }

        // ---- Subsystem bridges ----------------------------------------------

        private SaveData CaptureFromSubsystems()
        {
            var data = Current ?? new SaveData { version = currentVersion };

            // Player position from the active player if present.
            var player = UnityEngine.Object.FindFirstObjectByType<Player.PlayerController>();
            if (player != null)
            {
                data.playerPosition = player.transform.position;
                data.playerRotation = player.transform.rotation;
            }

            data.sceneName = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name;

            // Quest progress.
            if (Quests.QuestManager.Instance != null)
            {
                data.quests = Quests.QuestManager.Instance.CaptureProgress();
            }

            // Collectibles.
            if (Collectibles.CollectibleManager.Instance != null)
            {
                data.inventory = Collectibles.CollectibleManager.Instance.CaptureInventory();
                data.shardsPlaced = Collectibles.CollectibleManager.Instance.CaptureShardsPlaced();
            }

            return data;
        }

        private void ApplyToSubsystems(SaveData data)
        {
            var player = UnityEngine.Object.FindFirstObjectByType<Player.PlayerController>();
            if (player != null)
            {
                var cc = player.GetComponent<CharacterController>();
                if (cc != null) cc.enabled = false;
                player.transform.SetPositionAndRotation(data.playerPosition, data.playerRotation);
                if (cc != null) cc.enabled = true;
            }

            if (Quests.QuestManager.Instance != null)
            {
                Quests.QuestManager.Instance.ApplyProgress(data.quests);
            }

            if (Collectibles.CollectibleManager.Instance != null)
            {
                Collectibles.CollectibleManager.Instance.ApplyInventory(data.inventory);
                Collectibles.CollectibleManager.Instance.ApplyShardsPlaced(data.shardsPlaced);
            }
        }
    }

    /// <summary>
    /// The on-disk save schema. Field names are part of the file format.
    /// </summary>
    [Serializable]
    public class SaveData
    {
        public int version;
        public string sceneName;
        public string timestamp;
        public Vector3 playerPosition;
        public Quaternion playerRotation;

        // questId -> QuestSaveData
        public SerializableDictionary<string, Quests.QuestSaveData> quests =
            new SerializableDictionary<string, Quests.QuestSaveData>();

        // collectibleId -> count
        public SerializableDictionary<string, int> inventory =
            new SerializableDictionary<string, int>();

        // 5 booleans, one per Lumenshard placed on the altar.
        public bool[] shardsPlaced = new bool[5];
    }
}
