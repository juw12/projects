using UnityEngine;
using UnityEngine.InputSystem;
using Vale.Core;

namespace Vale.Player
{
    /// <summary>
    /// Fairy flight mode. Toggled via the ToggleFlight input action.
    /// When active, disables gravity and enables free-flight movement:
    /// WASD for horizontal, Space to ascend, Left Ctrl to descend.
    /// Includes smooth FOV and ambient-audio transitions on enter/exit.
    /// Lives and dies with the player GameObject (no DontDestroyOnLoad).
    /// </summary>
    public class PlayerFlight : MonoBehaviour
    {
        [Header("Flight Speed")]
        [Tooltip("Horizontal movement speed while flying (units/s).")]
        [Range(1f, 20f)]
        [SerializeField] private float flightSpeed = 8f;

        [Tooltip("Vertical ascent/descent speed while flying (units/s).")]
        [Range(1f, 20f)]
        [SerializeField] private float verticalSpeed = 6f;

        [Header("Transition")]
        [Tooltip("Duration in seconds for the FOV and audio transition on toggle.")]
        [Range(0.2f, 3f)]
        [SerializeField] private float transitionDuration = 0.8f;

        [Tooltip("Camera FOV when grounded.")]
        [Range(30f, 120f)]
        [SerializeField] private float groundFOV = 60f;

        [Tooltip("Camera FOV while flying.")]
        [Range(30f, 120f)]
        [SerializeField] private float flightFOV = 75f;

        [Tooltip("Multiplier applied to ambient volume while flying (1 = no change).")]
        [Range(1f, 3f)]
        [SerializeField] private float ambientBoost = 1.5f;

        [Tooltip("Base ambient volume level (restored when exiting flight).")]
        [Range(0f, 1f)]
        [SerializeField] private float baseAmbientVolume = 0.5f;

        [Header("Audio")]
        [Tooltip("Whoosh clip played when toggling flight. Safe to leave null.")]
        [SerializeField] private AudioClip whooshClip;

        // Runtime state
        private CharacterController _controller;
        private Camera _cam;
        private Vector3 _velocity;
        private float _transitionTimer;
        private bool _transitioning;
        private float _startFOV;
        private float _targetFOV;
        private float _startAmbient;
        private float _targetAmbient;

        // ---- Properties ------------------------------------------------------

        /// <summary>True when the player is in active flight mode.</summary>
        public bool IsFlying { get; private set; }

        // ---- Lifecycle -------------------------------------------------------

        private void Awake()
        {
            _controller = GetComponent<CharacterController>();
            _cam = GetComponentInChildren<Camera>();
        }

        private void Update()
        {
            if (GameManager.Instance == null || GameManager.Instance.Input == null) return;

            // Handle toggle input
            if (GameManager.Instance.Input.ToggleFlightTriggered())
            {
                ToggleFlight();
            }

            if (IsFlying)
            {
                HandleFlightMovement();
            }

            if (_transitioning)
            {
                UpdateTransition();
            }
        }

        // ---- Public API ------------------------------------------------------

        /// <summary>
        /// Toggles flight mode. If flying, exits; otherwise enters.
        /// Plays the whoosh SFX and starts the visual/audio transition.
        /// </summary>
        public void ToggleFlight()
        {
            if (IsFlying)
            {
                ExitFlight();
            }
            else
            {
                EnterFlight();
            }
        }

        /// <summary>
        /// Enters flight mode. Disables gravity implicitly (PlayerController skips ground logic).
        /// Starts FOV widening and ambient volume boost transition.
        /// </summary>
        public void EnterFlight()
        {
            if (IsFlying) return;

            IsFlying = true;
            _velocity = Vector3.zero;

            StartTransition(flightFOV, Mathf.Clamp01(baseAmbientVolume * ambientBoost));
            PlayWhoosh();
        }

        /// <summary>
        /// Exits flight mode. Gravity resumes immediately (handled by PlayerController).
        /// Starts FOV narrowing and ambient volume restore transition.
        /// </summary>
        public void ExitFlight()
        {
            if (!IsFlying) return;

            IsFlying = false;
            _velocity = Vector3.zero;

            StartTransition(groundFOV, baseAmbientVolume);
            PlayWhoosh();
        }

        // ---- Internal --------------------------------------------------------

        private void HandleFlightMovement()
        {
            var input = GameManager.Instance.Input;

            // Horizontal: WASD relative to player facing
            Vector2 moveInput = input.Move();
            Vector3 moveDir = transform.right * moveInput.x + transform.forward * moveInput.y;

            if (moveDir.sqrMagnitude > 1f)
            {
                moveDir.Normalize();
            }

            // Vertical: Space = ascend, Left Ctrl = descend
            float verticalInput = 0f;
            if (input.JumpHeld()) verticalInput += 1f;
            if (Keyboard.current != null && Keyboard.current.controlLeftKey.isPressed) verticalInput -= 1f;

            // Build velocity and apply via CharacterController (no Rigidbody)
            _velocity = moveDir * flightSpeed + Vector3.up * (verticalInput * verticalSpeed);
            _controller.Move(_velocity * Time.deltaTime);
        }

        private void StartTransition(float fovTarget, float ambientTarget)
        {
            _transitioning = true;
            _transitionTimer = 0f;
            _startFOV = _cam != null ? _cam.fieldOfView : groundFOV;
            _targetFOV = fovTarget;
            _startAmbient = baseAmbientVolume; // use stored base as starting point approximation
            _targetAmbient = ambientTarget;
        }

        private void UpdateTransition()
        {
            _transitionTimer += Time.deltaTime;
            float t = Mathf.Clamp01(_transitionTimer / transitionDuration);
            float smooth = Mathf.SmoothStep(0f, 1f, t);

            // Lerp camera FOV
            if (_cam != null)
            {
                _cam.fieldOfView = Mathf.Lerp(_startFOV, _targetFOV, smooth);
            }

            // Lerp ambient audio volume
            float currentVolume = Mathf.Lerp(_startAmbient, _targetAmbient, smooth);
            if (GameManager.Instance.Audio != null)
            {
                GameManager.Instance.Audio.SetAmbientVolume(currentVolume);
            }

            if (t >= 1f)
            {
                _transitioning = false;
            }
        }

        private void PlayWhoosh()
        {
            // AudioManager.PlaySFX already guards against null clip (early return).
            // Safe to pass null — no crash.
            GameManager.Instance?.Audio?.PlaySFX(whooshClip);
        }
    }
}
