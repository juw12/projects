using System;
using TMPro;
using UnityEngine;
using Vale.Collectibles;
using Vale.Core;
using Vale.Dialogue;
using Vale.Quests;

namespace Vale.UI
{
    /// <summary>
    /// Top-of-screen HUD overlay showing the current quest title/objective,
    /// Lumenshard count, and an optional crosshair. Hides during dialogue.
    /// Toggles the quest log when the player presses Tab.
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        [Header("Quest Display")]
        [Tooltip("TMP text showing the active quest's title.")]
        [SerializeField] private TMP_Text questTitle;

        [Tooltip("TMP text showing the current objective description.")]
        [SerializeField] private TMP_Text questObjective;

        [Header("Collectibles")]
        [Tooltip("TMP text showing shard count, e.g. '3 / 5 Lumenshards'.")]
        [SerializeField] private TMP_Text shardCount;

        [Tooltip("Total number of Lumenshards in the game.")]
        [Min(1)]
        [SerializeField] private int totalShards = CollectibleManager.TotalShards;

        [Header("Crosshair")]
        [Tooltip("Optional crosshair sprite at the center of the screen.")]
        [SerializeField] private UnityEngine.UI.Image crosshair;

        [Header("Panel")]
        [Tooltip("Root GameObject for the entire HUD. Hidden during dialogue.")]
        [SerializeField] private GameObject hudRoot;

        // Runtime
        private bool _warnedMissingRefs;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            ValidateReferences();

            // Start hidden; shown on first quest start.
            if (hudRoot != null) hudRoot.SetActive(false);
        }

        private void OnEnable()
        {
            SubscribeEvents();
            SyncInitialState();
        }

        private void OnDisable()
        {
            UnsubscribeEvents();
        }

        // ---- Update -----------------------------------------------------------

        private void Update()
        {
            // Toggle quest log on Tab.
            var gm = GameManager.Instance;
            if (gm == null || gm.Input == null) return;

            if (gm.Input.QuestLogTriggered())
            {
                var questLog = FindObjectOfType<QuestLogUI>();
                questLog?.Toggle();
            }
        }

        // ---- Event handlers ---------------------------------------------------

        private void OnQuestStarted(Quest quest)
        {
            if (hudRoot != null) hudRoot.SetActive(true);
            UpdateQuestDisplay(quest);
        }

        private void OnQuestObjectiveProgressed(Quest quest)
        {
            UpdateQuestDisplay(quest);
        }

        private void OnQuestCompleted(Quest quest)
        {
            // Check if there are other active quests to show.
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                var next = qm.GetCurrentQuest();
                if (next != null)
                {
                    UpdateQuestDisplay(next);
                    return;
                }
            }

            // No active quests: hide the quest portion of the HUD.
            if (questTitle != null) questTitle.text = string.Empty;
            if (questObjective != null) questObjective.text = string.Empty;
        }

        private void OnCollectibleAdded(CollectibleData data, int newCount)
        {
            if (shardCount != null)
            {
                // Count total lumenshards collected across all shard ids.
                int collected = CountCollectedShards();
                shardCount.text = $"{collected} / {totalShards} Lumenshards";
            }
        }

        private void OnDialogueStarted(DialogueData data, DialogueNode node)
        {
            if (hudRoot != null) hudRoot.SetActive(false);
        }

        private void OnDialogueEnded(DialogueData data, DialogueNode node)
        {
            // Restore HUD if there's an active quest.
            var qm = QuestManager.Instance;
            if (qm != null && qm.GetCurrentQuest() != null)
            {
                if (hudRoot != null) hudRoot.SetActive(true);
            }
        }

        // ---- Internal ---------------------------------------------------------

        private void SubscribeEvents()
        {
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                qm.OnQuestStarted += OnQuestStarted;
                qm.OnQuestObjectiveProgressed += OnQuestObjectiveProgressed;
                qm.OnQuestCompleted += OnQuestCompleted;
            }

            var cm = CollectibleManager.Instance;
            if (cm != null)
            {
                cm.OnCollectibleAdded += OnCollectibleAdded;
            }

            var dr = DialogueRunner.Instance;
            if (dr != null)
            {
                dr.OnDialogueStarted += OnDialogueStarted;
                dr.OnDialogueEnded += OnDialogueEnded;
            }
        }

        private void UnsubscribeEvents()
        {
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                qm.OnQuestStarted -= OnQuestStarted;
                qm.OnQuestObjectiveProgressed -= OnQuestObjectiveProgressed;
                qm.OnQuestCompleted -= OnQuestCompleted;
            }

            var cm = CollectibleManager.Instance;
            if (cm != null)
            {
                cm.OnCollectibleAdded -= OnCollectibleAdded;
            }

            var dr = DialogueRunner.Instance;
            if (dr != null)
            {
                dr.OnDialogueStarted -= OnDialogueStarted;
                dr.OnDialogueEnded -= OnDialogueEnded;
            }
        }

        private void SyncInitialState()
        {
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                var current = qm.GetCurrentQuest();
                if (current != null)
                {
                    if (hudRoot != null) hudRoot.SetActive(true);
                    UpdateQuestDisplay(current);
                }
            }

            // Restore shard count.
            if (shardCount != null)
            {
                int collected = CountCollectedShards();
                shardCount.text = $"{collected} / {totalShards} Lumenshards";
            }
        }

        private void UpdateQuestDisplay(Quest quest)
        {
            if (quest == null) return;

            if (questTitle != null)
                questTitle.text = quest.Data.title;

            if (questObjective != null)
            {
                if (quest.CurrentObjectiveIndex < quest.ObjectiveCount)
                {
                    var obj = quest.GetObjective(quest.CurrentObjectiveIndex);
                    questObjective.text = obj.Data.description;
                }
                else
                {
                    questObjective.text = string.Empty;
                }
            }
        }

        private int CountCollectedShards()
        {
            var cm = CollectibleManager.Instance;
            if (cm == null) return 0;

            int count = 0;
            for (int i = 1; i <= totalShards; i++)
            {
                if (cm.GetCount($"lumenshard_{i}") > 0)
                    count++;
            }
            return count;
        }

        private void ValidateReferences()
        {
            if (_warnedMissingRefs) return;

            if (questTitle == null)
            {
                Debug.LogWarning("[HUDController] questTitle is not assigned.", this);
            }
            if (questObjective == null)
            {
                Debug.LogWarning("[HUDController] questObjective is not assigned.", this);
            }
            if (shardCount == null)
            {
                Debug.LogWarning("[HUDController] shardCount is not assigned.", this);
            }
            if (hudRoot == null)
            {
                Debug.LogWarning("[HUDController] hudRoot is not assigned.", this);
            }

            _warnedMissingRefs = true;
        }
    }
}
