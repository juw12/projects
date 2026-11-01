using System;
using System.Collections.Generic;
using UnityEngine;
using Vale.Core;
using Vale.Dialogue;

namespace Vale.Quests
{
    /// <summary>
    /// Singleton manager owning all active quests.
    /// Loads quest data from <c>Resources/Vale/Quests</c>, tracks progress,
    /// fires lifecycle events, and auto-starts follow-up quests.
    /// </summary>
    public class QuestManager : MonoBehaviour
    {
        /// <summary>Scene-wide singleton instance.</summary>
        public static QuestManager Instance { get; private set; }

        // ─── Events ────────────────────────────────────────────────────────────────

        /// <summary>Fired when a quest transitions to Active.</summary>
        public event Action<Quest> OnQuestStarted;

        /// <summary>Fired whenever an objective's progress increments.</summary>
        public event Action<Quest> OnQuestObjectiveProgressed;

        /// <summary>Fired when all objectives are complete and the quest transitions to Completed.</summary>
        public event Action<Quest> OnQuestCompleted;

        /// <summary>Fired when a quest is explicitly failed.</summary>
        public event Action<Quest> OnQuestFailed;

        // ─── Internal state ────────────────────────────────────────────────────────

        private readonly Dictionary<string, QuestData> _registry = new Dictionary<string, QuestData>();
        private readonly List<Quest> _activeQuests = new List<Quest>();
        private readonly HashSet<string> _completedQuestIds = new HashSet<string>();

        private DialogueRunner _dialogueRunner;
        private Collectibles.CollectibleManager _collectibleManager;

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

        private void Start()
        {
            LoadQuestRegistry();
            SubscribeToExternalSystems();
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ─── Public API ────────────────────────────────────────────────────────────

        /// <summary>
        /// Starts the quest identified by <paramref name="questId"/>.
        /// No-op if the quest is already active or completed.
        /// </summary>
        public void StartQuest(string questId)
        {
            if (string.IsNullOrEmpty(questId)) return;

            if (_completedQuestIds.Contains(questId))
            {
                Debug.LogWarning($"[QuestManager] Cannot start quest '{questId}': already completed.");
                return;
            }

            if (IsQuestActive(questId))
            {
                Debug.LogWarning($"[QuestManager] Quest '{questId}' is already active.");
                return;
            }

            if (!_registry.TryGetValue(questId, out var data))
            {
                Debug.LogError($"[QuestManager] QuestData '{questId}' not found in registry.");
                return;
            }

            var quest = new Quest(data);
            quest.Activate();
            _activeQuests.Add(quest);

            RaiseQuestStarted(quest);
            Debug.Log($"[QuestManager] Quest started: {data.title}");
        }

        /// <summary>
        /// Increments progress on a specific objective of a specific quest.
        /// Fires <see cref="OnQuestObjectiveProgressed"/> and checks for completion.
        /// </summary>
        public void AdvanceObjective(string questId, string objectiveId, int delta = 1)
        {
            var quest = FindQuest(questId);
            if (quest == null || quest.State != QuestState.Active) return;

            quest.AdvanceObjective(objectiveId, delta);
            RaiseQuestObjectiveProgressed(quest);

            if (quest.IsComplete())
                CompleteQuest(quest);
        }

        /// <summary>
        /// Shortcut that advances an objective directly to its required count,
        /// effectively completing it in one call.
        /// </summary>
        public void CompleteObjective(string questId, string objectiveId)
        {
            var quest = FindQuest(questId);
            if (quest == null || quest.State != QuestState.Active) return;

            int index = -1;
            for (int i = 0; i < quest.ObjectiveCount; i++)
            {
                if (quest.GetObjective(i).Data.objectiveId == objectiveId)
                {
                    index = i;
                    break;
                }
            }

            if (index < 0) return;

            var obj = quest.GetObjective(index);
            int remaining = obj.Data.requiredCount - obj.CurrentCount;
            if (remaining <= 0) return;

            AdvanceObjective(questId, objectiveId, remaining);
        }

        /// <summary>
        /// Public entry point for any system (area triggers, NPC scripts, etc.)
        /// to fire an objective trigger without going through CollectibleManager.
        /// </summary>
        public void NotifyObjectiveTriggered(string questId, string objectiveId)
        {
            AdvanceObjective(questId, objectiveId, 1);
        }

        /// <summary>True if the quest is currently in the Active state.</summary>
        public bool IsQuestActive(string questId)
        {
            return FindQuest(questId)?.State == QuestState.Active;
        }

        /// <summary>True if the quest has been completed.</summary>
        public bool IsQuestCompleted(string questId)
        {
            return _completedQuestIds.Contains(questId);
        }

        /// <summary>Returns a copy of the list of currently active quests.</summary>
        public List<Quest> GetActiveQuests()
        {
            return new List<Quest>(_activeQuests);
        }

        /// <summary>Returns the first active quest, or null if none.</summary>
        public Quest GetCurrentQuest()
        {
            return _activeQuests.Count > 0 ? _activeQuests[0] : null;
        }

        /// <summary>Gets the <see cref="QuestData"/> for a given id, or null.</summary>
        public QuestData GetQuestData(string questId)
        {
            return _registry.TryGetValue(questId, out var data) ? data : null;
        }

        // ─── Save / Load ───────────────────────────────────────────────────────────

        /// <summary>
        /// Captures the state of all active and completed quests for saving.
        /// Returns a <see cref="SerializableDictionary{String,QuestSaveData}"/> keyed by questId.
        /// </summary>
        public SerializableDictionary<string, QuestSaveData> CaptureProgress()
        {
            var result = new SerializableDictionary<string, QuestSaveData>();

            foreach (var quest in _activeQuests)
            {
                result[quest.Data.questId] = quest.ToSaveData();
            }

            // Also include completed quests so they aren't re-started on load.
            foreach (var questId in _completedQuestIds)
            {
                if (!result.ContainsKey(questId))
                {
                    result[questId] = new QuestSaveData
                    {
                        state = QuestState.Completed.ToString(),
                        objectiveProgress = Array.Empty<int>()
                    };
                }
            }

            return result;
        }

        /// <summary>
        /// Restores quest state from a previously captured <see cref="SerializableDictionary{String,QuestSaveData}"/>.
        /// Clears current state before applying.
        /// </summary>
        public void ApplyProgress(SerializableDictionary<string, QuestSaveData> saved)
        {
            _activeQuests.Clear();
            _completedQuestIds.Clear();

            if (saved == null) return;

            foreach (var questId in saved.Keys)
            {
                var saveData = saved[questId];
                if (saveData == null) continue;

                if (saveData.state == QuestState.Completed.ToString())
                {
                    _completedQuestIds.Add(questId);
                    continue;
                }

                if (!_registry.TryGetValue(questId, out var data))
                {
                    Debug.LogWarning($"[QuestManager] ApplyProgress: quest data '{questId}' not found in registry.");
                    continue;
                }

                var quest = new Quest(data);
                quest.ApplySaveData(saveData);

                if (quest.State == QuestState.Active)
                    _activeQuests.Add(quest);
                else if (quest.State == QuestState.Completed)
                    _completedQuestIds.Add(questId);
            }
        }

        // ─── Private ───────────────────────────────────────────────────────────────

        private void LoadQuestRegistry()
        {
            var all = Resources.LoadAll<QuestData>("Vale/Quests");
            foreach (var data in all)
            {
                if (string.IsNullOrEmpty(data.questId))
                {
                    Debug.LogError($"[QuestManager] QuestData asset '{data.name}' has empty questId.");
                    continue;
                }

                if (_registry.ContainsKey(data.questId))
                    Debug.LogWarning($"[QuestManager] Duplicate questId '{data.questId}' — using '{data.name}'.");

                _registry[data.questId] = data;
            }

            Debug.Log($"[QuestManager] Loaded {_registry.Count} quest(s) from Resources/Vale/Quests.");
        }

        private void SubscribeToExternalSystems()
        {
            _dialogueRunner = FindFirstObjectByType<DialogueRunner>();
            if (_dialogueRunner != null)
            {
                _dialogueRunner.OnDialogueEnded += HandleDialogueEnded;
            }

            _collectibleManager = FindFirstObjectByType<Collectibles.CollectibleManager>();
            if (_collectibleManager != null)
            {
                _collectibleManager.OnCollectibleAdded += HandleCollectibleAdded;
            }
        }

        private void HandleDialogueEnded(DialogueData data, DialogueNode node)
        {
            // Dialogue choices that carry an advanceObjective directive are
            // handled by DialogueRunner directly (it calls NotifyObjectiveTriggered).
            // This hook is reserved for future "dialogue-end advances quest" logic.
        }

        private void HandleCollectibleAdded(Collectibles.CollectibleData data, int newCount)
        {
            // If a collectible is tied to a quest objective via IQuestTarget,
            // the Collectible component already called QuestManager.AdvanceObjective
            // in its Interact flow. This hook is a safety net for collectibles
            // that register through CollectibleManager without a direct QuestManager call.
        }

        private void CompleteQuest(Quest quest)
        {
            quest.MarkCompleted();
            _activeQuests.Remove(quest);
            _completedQuestIds.Add(quest.Data.questId);

            ApplyRewards(quest);
            RaiseQuestCompleted(quest);

            // Auto-start follow-up quest
            if (!string.IsNullOrEmpty(quest.Data.nextQuestId))
            {
                Debug.Log($"[QuestManager] Auto-starting follow-up quest: {quest.Data.nextQuestId}");
                StartQuest(quest.Data.nextQuestId);
            }
        }

        private void ApplyRewards(Quest quest)
        {
            if (quest.Data.rewards == null) return;

            foreach (var reward in quest.Data.rewards)
            {
                Debug.Log($"[QuestManager] Reward granted (placeholder): collectibleId='{reward.collectibleId}' amount={reward.amount}");
                if (!string.IsNullOrEmpty(reward.completionMessage))
                    Debug.Log($"[QuestManager] Completion message: {reward.completionMessage}");
            }
        }

        private Quest FindQuest(string questId)
        {
            for (int i = 0; i < _activeQuests.Count; i++)
            {
                if (_activeQuests[i].Data.questId == questId)
                    return _activeQuests[i];
            }
            return null;
        }

        private void RaiseQuestStarted(Quest q) => OnQuestStarted?.Invoke(q);
        private void RaiseQuestObjectiveProgressed(Quest q) => OnQuestObjectiveProgressed?.Invoke(q);
        private void RaiseQuestCompleted(Quest q) => OnQuestCompleted?.Invoke(q);
        private void RaiseQuestFailed(Quest q) => OnQuestFailed?.Invoke(q);
    }
}
