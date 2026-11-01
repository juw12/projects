using UnityEngine;
using UnityEngine.InputSystem;

namespace Vale.Core
{
    /// <summary>
    /// Thin wrapper around the New Input System. Owns the InputActionAsset and
    /// exposes a few helpers. The .inputactions file lives at
    /// Assets/Vale/Settings/ValeInput.inputactions and is wired in the inspector.
    /// </summary>
    public class InputManager : MonoBehaviour
    {
        [Header("Input")]
        [Tooltip("Drag the .inputactions asset here. (Vale/Settings/ValeInput.inputactions)")]
        [SerializeField] private InputActionAsset inputActions;

        public InputActionAsset Actions => inputActions;

        public InputActionMap PlayerMap => inputActions?.FindActionMap("Player", throwIfNotFound: false);
        public InputActionMap UIMap => inputActions?.FindActionMap("UI", throwIfNotFound: false);

        // ---- Cached actions --------------------------------------------------

        public InputAction MoveAction => PlayerMap?.FindAction("Move");
        public InputAction LookAction => PlayerMap?.FindAction("Look");
        public InputAction JumpAction => PlayerMap?.FindAction("Jump");
        public InputAction InteractAction => PlayerMap?.FindAction("Interact");
        public InputAction ToggleFlightAction => PlayerMap?.FindAction("ToggleFlight");
        public InputAction SprintAction => PlayerMap?.FindAction("Sprint");
        public InputAction QuestLogAction => PlayerMap?.FindAction("QuestLog");
        public InputAction PauseAction => PlayerMap?.FindAction("Pause");

        // ---- Lifecycle -------------------------------------------------------

        private void OnEnable()
        {
            PlayerMap?.Enable();
            UIMap?.Enable();
        }

        private void OnDisable()
        {
            PlayerMap?.Disable();
            UIMap?.Disable();
        }

        // ---- Helpers ---------------------------------------------------------

        public Vector2 Move() => MoveAction?.ReadValue<Vector2>() ?? Vector2.zero;
        public Vector2 Look() => LookAction?.ReadValue<Vector2>() ?? Vector2.zero;
        public bool JumpHeld() => JumpAction?.IsPressed() ?? false;
        public bool SprintHeld() => SprintAction?.IsPressed() ?? false;
        public bool InteractTriggered() => InteractAction?.WasPerformedThisFrame() ?? false;
        public bool QuestLogTriggered() => QuestLogAction?.WasPerformedThisFrame() ?? false;
        public bool PauseTriggered() => PauseAction?.WasPerformedThisFrame() ?? false;
        public bool ToggleFlightTriggered() => ToggleFlightAction?.WasPerformedThisFrame() ?? false;
    }
}
