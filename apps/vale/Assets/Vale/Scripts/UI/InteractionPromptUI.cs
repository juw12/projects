using System;
using TMPro;
using UnityEngine;
using Vale.Player;

namespace Vale.UI
{
    /// <summary>
    /// Center-screen interaction prompt ("Press E to talk to ...").
    /// Shows/hides based on the PlayerInteraction target event.
    /// </summary>
    public class InteractionPromptUI : MonoBehaviour
    {
        [Header("Prompt")]
        [Tooltip("Root GameObject for the prompt. Hidden by default.")]
        [SerializeField] private GameObject promptRoot;

        [Tooltip("TMP text displaying the prompt string.")]
        [SerializeField] private TMP_Text promptLabel;

        // Runtime
        private bool _warnedMissingRefs;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            ValidateReferences();
            if (promptRoot != null) promptRoot.SetActive(false);
        }

        private void OnEnable()
        {
            var player = FindObjectOfType<PlayerInteraction>();
            if (player != null)
            {
                player.OnInteractableTargeted += OnInteractableTargeted;
            }
            else
            {
                Debug.LogWarning("[InteractionPromptUI] No PlayerInteraction found in scene.", this);
            }
        }

        private void OnDisable()
        {
            var player = FindObjectOfType<PlayerInteraction>();
            if (player != null)
            {
                player.OnInteractableTargeted -= OnInteractableTargeted;
            }
        }

        // ---- Event handlers ---------------------------------------------------

        private void OnInteractableTargeted(string prompt)
        {
            if (prompt == null || string.IsNullOrEmpty(prompt))
            {
                Hide();
            }
            else
            {
                Show(prompt);
            }
        }

        // ---- Internal ---------------------------------------------------------

        private void Show(string prompt)
        {
            if (promptRoot == null) return;
            promptRoot.SetActive(true);

            if (promptLabel != null)
                promptLabel.text = prompt;
        }

        private void Hide()
        {
            if (promptRoot == null) return;
            promptRoot.SetActive(false);
        }

        private void ValidateReferences()
        {
            if (_warnedMissingRefs) return;

            if (promptRoot == null)
                Debug.LogWarning("[InteractionPromptUI] promptRoot is not assigned.", this);
            if (promptLabel == null)
                Debug.LogWarning("[InteractionPromptUI] promptLabel is not assigned.", this);

            _warnedMissingRefs = true;
        }
    }
}
