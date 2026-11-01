using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Vale.Core;
using Vale.Quests;

namespace Vale.UI
{
    /// <summary>
    /// Quest log panel. Populates from active quests, showing title, description,
    /// and per-objective progress. Toggled via Tab (handled by HUDController).
    /// </summary>
    public class QuestLogUI : MonoBehaviour
    {
        [Header("Panel")]
        [Tooltip("The root panel GameObject. Hidden by default.")]
        [SerializeField] private GameObject panel;

        [Tooltip("TMP text for the panel title (e.g. 'Quest Log').")]
        [SerializeField] private TMP_Text title;

        [Header("Quest Content")]
        [Tooltip("TMP text showing the current quest's title.")]
        [SerializeField] private TMP_Text questTitle;

        [Tooltip("TMP text showing the quest description.")]
        [SerializeField] private TMP_Text description;

        [Header("Objectives")]
        [Tooltip("Parent transform for instantiated objective rows.")]
        [SerializeField] private Transform objectiveList;

        [Tooltip("Prefab for each objective row. Must have a child TMP_Text named 'Label'.")]
        [SerializeField] private GameObject objectiveRowPrefab;

        // Runtime state
        private bool _isOpen;
        private bool _warnedMissingRefs;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            ValidateReferences();

            if (panel != null) panel.SetActive(false);
        }

        private void OnEnable()
        {
            // Subscribe to quest events so the log updates live while open.
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                qm.OnQuestStarted += OnQuestChanged;
                qm.OnQuestObjectiveProgressed += OnQuestChanged;
                qm.OnQuestCompleted += OnQuestChanged;
            }
        }

        private void OnDisable()
        {
            var qm = QuestManager.Instance;
            if (qm != null)
            {
                qm.OnQuestStarted -= OnQuestChanged;
                qm.OnQuestObjectiveProgressed -= OnQuestChanged;
                qm.OnQuestCompleted -= OnQuestChanged;
            }
        }

        // ---- Public API -------------------------------------------------------

        /// <summary>Toggles the quest log open/closed.</summary>
        public void Toggle()
        {
            if (_isOpen)
                Close();
            else
                Open();
        }

        /// <summary>Opens the quest log and populates content.</summary>
        public void Open()
        {
            if (panel == null) return;
            panel.SetActive(true);
            _isOpen = true;
            Populate();
        }

        /// <summary>Closes the quest log.</summary>
        public void Close()
        {
            if (panel == null) return;
            panel.SetActive(false);
            _isOpen = false;
        }

        /// <summary>True if the quest log is currently visible.</summary>
        public bool IsOpen => _isOpen;

        // ---- Event handlers ---------------------------------------------------

        private void OnQuestChanged(Quest quest)
        {
            if (_isOpen) Populate();
        }

        // ---- Internal ---------------------------------------------------------

        private void Populate()
        {
            var qm = QuestManager.Instance;
            if (qm == null) return;

            var activeQuests = qm.GetActiveQuests();

            if (activeQuests.Count == 0)
            {
                if (questTitle != null) questTitle.text = "No active quests";
                if (description != null) description.text = string.Empty;
                ClearObjectives();
                return;
            }

            // Show the first (current) quest.
            var quest = activeQuests[0];

            if (questTitle != null) questTitle.text = quest.Data.title;
            if (description != null) description.text = quest.Data.description;

            BuildObjectiveList(quest);
        }

        private void BuildObjectiveList(Quest quest)
        {
            ClearObjectives();

            if (objectiveList == null || objectiveRowPrefab == null) return;

            for (int i = 0; i < quest.ObjectiveCount; i++)
            {
                var obj = quest.GetObjective(i);
                var rowGO = Instantiate(objectiveRowPrefab, objectiveList);

                // Find the TMP_Text label in the row.
                var label = rowGO.GetComponentInChildren<TMP_Text>();
                if (label != null)
                {
                    string status = obj.IsComplete ? "✓" : "○";
                    string progress = obj.Data.requiredCount > 1
                        ? $" ({obj.CurrentCount}/{obj.Data.requiredCount})"
                        : string.Empty;

                    label.text = $"{status} {obj.Data.description}{progress}";

                    // Dim completed objectives.
                    var color = label.color;
                    if (obj.IsComplete)
                    {
                        color.a = 0.5f;
                    }
                    label.color = color;
                }
            }
        }

        private void ClearObjectives()
        {
            if (objectiveList == null) return;
            for (int i = objectiveList.childCount - 1; i >= 0; i--)
            {
                Destroy(objectiveList.GetChild(i).gameObject);
            }
        }

        private void ValidateReferences()
        {
            if (_warnedMissingRefs) return;

            if (panel == null)
                Debug.LogWarning("[QuestLogUI] panel is not assigned.", this);
            if (questTitle == null)
                Debug.LogWarning("[QuestLogUI] questTitle is not assigned.", this);
            if (objectiveRowPrefab == null)
                Debug.LogWarning("[QuestLogUI] objectiveRowPrefab is not assigned.", this);

            _warnedMissingRefs = true;
        }
    }
}
