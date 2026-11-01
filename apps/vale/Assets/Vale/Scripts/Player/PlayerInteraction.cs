using System;
using UnityEngine;
using Vale.Core;

namespace Vale.Player
{
    /// <summary>
    /// Interaction raycaster. Casts a ray from the camera forward each frame to find
    /// an <see cref="IInteractable"/> within range. Emits a prompt event when the
    /// targeted object changes, and calls Interact when the interact input triggers.
    /// Attached to the player root (same GameObject as PlayerController).
    /// </summary>
    public class PlayerInteraction : MonoBehaviour
    {
        [Header("Raycast")]
        [Tooltip("Maximum distance from camera for interaction raycast (meters).")]
        [Range(1f, 10f)]
        [SerializeField] private float interactRange = 3f;

        [Tooltip("Layer mask restricting which colliders can be interaction targets.")]
        [SerializeField] private LayerMask interactLayer = ~0;

        [Header("Debug")]
        [Tooltip("Draw the interaction ray in the Unity Scene view (green = hit, white = miss).")]
        [SerializeField] private bool drawDebugRay = true;

        // Runtime state
        private Camera _cam;
        private IInteractable _currentTarget;
        private string _lastPrompt;

        // ---- Public Events ---------------------------------------------------

        /// <summary>
        /// Raised when the targeted interactable changes (including clearing to null).
        /// Argument is the prompt text (e.g. "Press E to talk"), or empty string when no target.
        /// Subscribe from UI (InteractionPromptUI) to show/hide the prompt.
        /// </summary>
        public event Action<string> OnInteractableTargeted;

        // ---- Properties ------------------------------------------------------

        /// <summary>The currently targeted interactable, or null if nothing is in range.</summary>
        public IInteractable CurrentTarget => _currentTarget;

        // ---- Lifecycle -------------------------------------------------------

        private void Awake()
        {
            // Camera is a child of this GameObject (player root)
            _cam = GetComponentInChildren<Camera>();
        }

        // ---- Update ----------------------------------------------------------

        private void Update()
        {
            if (GameManager.Instance == null || GameManager.Instance.Input == null) return;

            RaycastForTarget();

            // Handle interact trigger
            if (GameManager.Instance.Input.InteractTriggered() && _currentTarget != null)
            {
                var player = GetComponent<PlayerController>();
                if (player != null && _currentTarget.CanInteract(player))
                {
                    _currentTarget.Interact(player);
                }
            }
        }

        // ---- Internal --------------------------------------------------------

        private void RaycastForTarget()
        {
            if (_cam == null) return;

            Ray ray = new Ray(_cam.transform.position, _cam.transform.forward);
            RaycastHit hit;

            bool hitSomething = Physics.Raycast(ray, out hit, interactRange, interactLayer);

            if (hitSomething)
            {
                IInteractable interactable = hit.collider.GetComponentInParent<IInteractable>();
                if (interactable != null)
                {
                    _currentTarget = interactable;
                    string prompt = interactable.InteractionPrompt;

                    // Only raise event when prompt actually changes (avoids per-frame spam)
                    if (prompt != _lastPrompt)
                    {
                        _lastPrompt = prompt;
                        OnInteractableTargeted?.Invoke(prompt);
                    }
                }
                else
                {
                    ClearTarget();
                }
            }
            else
            {
                ClearTarget();
            }

            // Debug visualization
            if (drawDebugRay)
            {
                Color rayColor = _currentTarget != null ? Color.green : Color.white;
                Debug.DrawRay(ray.origin, ray.direction * interactRange, rayColor);
            }
        }

        private void ClearTarget()
        {
            if (_currentTarget != null)
            {
                _currentTarget = null;
                _lastPrompt = string.Empty;
                OnInteractableTargeted?.Invoke(string.Empty);
            }
        }
    }
}
