using System;
using TMPro;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;
using Vale.Core;
using Vale.Dialogue;

namespace Vale.UI
{
    /// <summary>
    /// Bottom dialogue panel. Shows the speaker's portrait, name, and current
    /// line of text, with choice buttons for branching nodes. Advances on E/Space
    /// when the current node has no choices.
    /// </summary>
    public class DialogueUI : MonoBehaviour
    {
        [Header("Panel")]
        [Tooltip("Root panel GameObject for the dialogue box. Hidden by default.")]
        [SerializeField] private GameObject panel;

        [Header("Speaker")]
        [Tooltip("Portrait image for the speaking NPC.")]
        [SerializeField] private Image speakerPortrait;

        [Tooltip("TMP text showing the NPC's display name.")]
        [SerializeField] private TMP_Text speakerName;

        [Header("Text")]
        [Tooltip("TMP text showing the current dialogue line.")]
        [SerializeField] private TMP_Text body;

        [Header("Choices")]
        [Tooltip("Parent transform for instantiated choice buttons.")]
        [SerializeField] private Transform choiceContainer;

        [Tooltip("Prefab for each choice button. Must have a child TMP_Text named 'Label' and a Button component.")]
        [SerializeField] private GameObject choiceButtonPrefab;

        [Header("Input")]
        [Tooltip("Keys that advance the dialogue (E, Space).")]
        [SerializeField] private KeyCode[] advanceKeys = { KeyCode.E, KeyCode.Space };

        // Runtime
        private bool _warnedMissingRefs;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            ValidateReferences();
            if (panel != null) panel.SetActive(false);
        }

        private void OnEnable()
        {
            var runner = DialogueRunner.Instance;
            if (runner != null)
            {
                runner.OnDialogueStarted += OnDialogueStarted;
                runner.OnDialogueNodeChanged += OnNodeChanged;
                runner.OnDialogueEnded += OnDialogueEnded;
            }
        }

        private void OnDisable()
        {
            var runner = DialogueRunner.Instance;
            if (runner != null)
            {
                runner.OnDialogueStarted -= OnDialogueStarted;
                runner.OnDialogueNodeChanged -= OnNodeChanged;
                runner.OnDialogueEnded -= OnDialogueEnded;
            }
        }

        // ---- Update -----------------------------------------------------------

        private void Update()
        {
            if (!IsPanelVisible()) return;

            // Advance on key press (only when current node has no choices).
            if (DialogueRunner.Instance != null &&
                DialogueRunner.Instance.CurrentNode != null &&
                (DialogueRunner.Instance.CurrentNode.choices == null ||
                 DialogueRunner.Instance.CurrentNode.choices.Count == 0))
            {
                if (AnyAdvanceKeyPressed())
                    Advance();
            }
        }

        // ---- Event handlers ---------------------------------------------------

        private void OnDialogueStarted(DialogueData data, DialogueNode node)
        {
            if (panel != null) panel.SetActive(true);
            UpdateSpeaker();
            UpdateNode(node);
        }

        private void OnNodeChanged(DialogueData data, DialogueNode node)
        {
            UpdateNode(node);
        }

        private void OnDialogueEnded(DialogueData data, DialogueNode node)
        {
            if (panel != null) panel.SetActive(false);
            ClearChoices();
        }

        // ---- Public API -------------------------------------------------------

        /// <summary>Advances the dialogue to the next node. Called on E/Space.</summary>
        public void Advance()
        {
            var runner = DialogueRunner.Instance;
            if (runner != null && runner.IsActive)
            {
                runner.Advance();
            }
        }

        /// <summary>Selects a choice by index. Called by choice button onClick.</summary>
        /// <param name="choiceIndex">Zero-based index into the current node's choices.</param>
        public void Choose(int choiceIndex)
        {
            var runner = DialogueRunner.Instance;
            if (runner != null && runner.IsActive)
            {
                runner.Choose(choiceIndex);
            }
        }

        // ---- Internal ---------------------------------------------------------

        private bool IsPanelVisible()
        {
            return panel != null && panel.activeSelf;
        }

        private void UpdateSpeaker()
        {
            var runner = DialogueRunner.Instance;
            if (runner == null || runner.CurrentSpeaker == null) return;

            if (speakerName != null)
                speakerName.text = runner.CurrentSpeaker.SpeakerName;

            if (speakerPortrait != null)
                speakerPortrait.sprite = runner.CurrentSpeaker.Portrait;
        }

        private void UpdateNode(DialogueNode node)
        {
            if (node == null) return;

            // Update the speaker name if it differs from the default.
            if (!string.IsNullOrEmpty(node.speakerName) && speakerName != null)
            {
                speakerName.text = node.speakerName;
            }

            if (body != null)
                body.text = node.text;

            BuildChoices(node);
        }

        private void BuildChoices(DialogueNode node)
        {
            ClearChoices();

            if (node.choices == null || node.choices.Count == 0) return;
            if (choiceContainer == null || choiceButtonPrefab == null) return;

            for (int i = 0; i < node.choices.Count; i++)
            {
                var choice = node.choices[i];
                var btnGO = Instantiate(choiceButtonPrefab, choiceContainer);

                // Set the label text.
                var label = btnGO.GetComponentInChildren<TMP_Text>();
                if (label != null)
                    label.text = choice.label;

                // Wire up the button.
                var button = btnGO.GetComponent<Button>();
                if (button != null)
                {
                    int index = i;
                    button.onClick.AddListener(() => Choose(index));
                }
            }
        }

        private void ClearChoices()
        {
            if (choiceContainer == null) return;
            for (int i = choiceContainer.childCount - 1; i >= 0; i--)
            {
                Destroy(choiceContainer.GetChild(i).gameObject);
            }
        }

        private bool AnyAdvanceKeyPressed()
        {
            foreach (var key in advanceKeys)
            {
                if (Keyboard.current != null && Keyboard.current[key].wasPressedThisFrame)
                    return true;
            }
            return false;
        }

        private void ValidateReferences()
        {
            if (_warnedMissingRefs) return;

            if (panel == null)
                Debug.LogWarning("[DialogueUI] panel is not assigned.", this);
            if (body == null)
                Debug.LogWarning("[DialogueUI] body is not assigned.", this);
            if (speakerName == null)
                Debug.LogWarning("[DialogueUI] speakerName is not assigned.", this);

            _warnedMissingRefs = true;
        }
    }
}
