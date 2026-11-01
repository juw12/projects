using System;
using UnityEngine;
using Vale.Quests;

namespace Vale.Dialogue
{
    /// <summary>
    /// Singleton that drives the current dialogue tree.
    /// Manages node traversal, choice handling, and quest objective advancement
    /// triggered by dialogue choices.
    /// </summary>
    public class DialogueRunner : MonoBehaviour
    {
        /// <summary>Scene-wide singleton instance.</summary>
        public static DialogueRunner Instance { get; private set; }

        // ─── Events ────────────────────────────────────────────────────────────────

        /// <summary>Fired when a dialogue begins. Args: the DialogueData, the first node.</summary>
        public event Action<DialogueData, DialogueNode> OnDialogueStarted;

        /// <summary>Fired when the runner moves to a new node (Advance or Choose).</summary>
        public event Action<DialogueData, DialogueNode> OnDialogueNodeChanged;

        /// <summary>Fired when the dialogue ends. Args: the DialogueData, the final node.</summary>
        public event Action<DialogueData, DialogueNode> OnDialogueEnded;

        // ─── State ─────────────────────────────────────────────────────────────────

        private DialogueData _currentData;
        private DialogueNode _currentNode;
        private IDialogueSpeaker _currentSpeaker;

        /// <summary>True while a dialogue is actively playing. Player should block movement input when this is true.</summary>
        public bool IsInputBlocked { get; private set; }

        /// <summary>True when a dialogue is currently in progress.</summary>
        public bool IsActive => _currentData != null;

        /// <summary>The data asset for the current dialogue, or null.</summary>
        public DialogueData CurrentData => _currentData;

        /// <summary>The node currently being displayed, or null.</summary>
        public DialogueNode CurrentNode => _currentNode;

        /// <summary>The speaker currently in the dialogue, or null.</summary>
        public IDialogueSpeaker CurrentSpeaker => _currentSpeaker;

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
        /// Begins playing a dialogue from its start node.
        /// Overwrites any currently active dialogue.
        /// </summary>
        /// <param name="data">The dialogue tree to play.</param>
        /// <param name="speaker">The speaker context (name, portrait, etc.).</param>
        public void StartDialogue(DialogueData data, IDialogueSpeaker speaker)
        {
            if (data == null)
            {
                Debug.LogError("[DialogueRunner] StartDialogue: data is null.");
                return;
            }

            _currentData = data;
            _currentSpeaker = speaker;
            IsInputBlocked = true;

            _currentNode = FindNode(data.startNodeId);
            if (_currentNode == null)
            {
                Debug.LogError($"[DialogueRunner] Start node '{data.startNodeId}' not found in dialogue '{data.dialogueId}'.");
                End();
                return;
            }

            RaiseDialogueStarted(_currentData, _currentNode);
        }

        /// <summary>
        /// Advances to the next node via the current node's <c>nextNodeId</c>.
        /// If no next node exists, the dialogue ends.
        /// </summary>
        public void Advance()
        {
            if (!IsActive) return;

            if (string.IsNullOrEmpty(_currentNode.nextNodeId))
            {
                End();
                return;
            }

            var next = FindNode(_currentNode.nextNodeId);
            if (next == null)
            {
                Debug.LogWarning($"[DialogueRunner] Next node '{_currentNode.nextNodeId}' not found. Ending dialogue.");
                End();
                return;
            }

            _currentNode = next;
            RaiseDialogueNodeChanged(_currentData, _currentNode);
        }

        /// <summary>
        /// Selects a choice from the current node.
        /// If the choice has an <c>advanceObjective</c> directive, the quest is notified.
        /// Then transitions to the choice's <c>nextNodeId</c>, or ends if null.
        /// </summary>
        /// <param name="choiceIndex">Zero-based index into the current node's choices list.</param>
        public void Choose(int choiceIndex)
        {
            if (!IsActive) return;
            if (_currentNode.choices == null || choiceIndex < 0 || choiceIndex >= _currentNode.choices.Count)
            {
                Debug.LogWarning($"[DialogueRunner] Invalid choice index {choiceIndex} (count: {_currentNode.choices?.Count ?? 0}).");
                return;
            }

            var choice = _currentNode.choices[choiceIndex];

            // Handle quest objective advancement
            if (!string.IsNullOrEmpty(choice.advanceObjective))
            {
                ProcessAdvanceObjective(choice.advanceObjective);
            }

            // Transition
            if (string.IsNullOrEmpty(choice.nextNodeId))
            {
                End();
                return;
            }

            var next = FindNode(choice.nextNodeId);
            if (next == null)
            {
                Debug.LogWarning($"[DialogueRunner] Choice target node '{choice.nextNodeId}' not found. Ending dialogue.");
                End();
                return;
            }

            _currentNode = next;
            RaiseDialogueNodeChanged(_currentData, _currentNode);
        }

        /// <summary>
        /// Ends the current dialogue and clears state.
        /// Fires <see cref="OnDialogueEnded"/>.
        /// </summary>
        public void End()
        {
            if (!IsActive) return;

            var finalNode = _currentNode;
            var finalData = _currentData;

            _currentData = null;
            _currentNode = null;
            _currentSpeaker = null;
            IsInputBlocked = false;

            RaiseDialogueEnded(finalData, finalNode);
        }

        // ─── Private ───────────────────────────────────────────────────────────────

        private DialogueNode FindNode(string nodeId)
        {
            if (string.IsNullOrEmpty(nodeId) || _currentData?.nodes == null) return null;

            for (int i = 0; i < _currentData.nodes.Count; i++)
            {
                if (_currentData.nodes[i].nodeId == nodeId)
                    return _currentData.nodes[i];
            }
            return null;
        }

        /// <summary>
        /// Parses the "questId/objectiveId" format and notifies the QuestManager.
        /// </summary>
        private void ProcessAdvanceObjective(string directive)
        {
            var separator = directive.IndexOf('/');
            if (separator < 0)
            {
                Debug.LogWarning($"[DialogueRunner] Malformed advanceObjective: '{directive}'. Expected 'questId/objectiveId'.");
                return;
            }

            string questId = directive.Substring(0, separator);
            string objectiveId = directive.Substring(separator + 1);

            var qm = QuestManager.Instance;
            if (qm != null)
            {
                qm.NotifyObjectiveTriggered(questId, objectiveId);
            }
            else
            {
                Debug.LogWarning("[DialogueRunner] QuestManager.Instance not found. Cannot advance objective.");
            }
        }

        private void RaiseDialogueStarted(DialogueData data, DialogueNode node) => OnDialogueStarted?.Invoke(data, node);
        private void RaiseDialogueNodeChanged(DialogueData data, DialogueNode node) => OnDialogueNodeChanged?.Invoke(data, node);
        private void RaiseDialogueEnded(DialogueData data, DialogueNode node) => OnDialogueEnded?.Invoke(data, node);
    }
}
