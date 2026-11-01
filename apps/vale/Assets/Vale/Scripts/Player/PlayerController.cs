using System;
using UnityEngine;
using Vale.Core;

namespace Vale.Player
{
    /// <summary>
    /// First-person player controller using CharacterController for movement.
    /// Handles WASD ground movement, sprint, jump, gravity, and optional head bob.
    /// Delegates camera look to <see cref="PlayerCamera"/> and flight to <see cref="PlayerFlight"/>.
    /// Persists across scene loads via DontDestroyOnLoad.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        /// <summary>Singleton instance, available across scene loads.</summary>
        public static PlayerController Instance { get; private set; }

        [Header("Movement")]
        [Tooltip("Base movement speed in units per second.")]
        [SerializeField] private float moveSpeed = 5f;

        [Tooltip("Speed multiplier applied while holding sprint.")]
        [Range(1f, 4f)]
        [SerializeField] private float sprintMultiplier = 1.6f;

        [Tooltip("Desired jump height in meters. Determines initial launch velocity.")]
        [Range(0.5f, 3f)]
        [SerializeField] private float jumpHeight = 1.2f;

        [Tooltip("Gravitational acceleration in units/s^2 (negative = downward).")]
        [Range(5f, 50f)]
        [SerializeField] private float gravity = 20f;

        [Header("Head Bob")]
        [Tooltip("Enable subtle head bobbing while moving on the ground.")]
        [SerializeField] private bool enableHeadBob = true;

        [Tooltip("Amplitude of the head bob oscillation in local units.")]
        [Range(0f, 0.2f)]
        [SerializeField] private float headBobIntensity = 0.03f;

        [Tooltip("Oscillation cycles per meter of horizontal travel.")]
        [Range(1f, 20f)]
        [SerializeField] private float headBobFrequency = 8f;

        [Header("Component References")]
        [Tooltip("Flight component on this GameObject (auto-assigned if null).")]
        [SerializeField] private PlayerFlight flight;

        [Tooltip("Camera child component for head bob targeting (auto-assigned if null).")]
        [SerializeField] private PlayerCamera playerCamera;

        // Runtime state
        private CharacterController _controller;
        private Vector3 _velocity;
        private float _headBobPhase;
        private bool _wasGrounded;

        // ---- Public Events ---------------------------------------------------

        /// <summary>Raised every frame the player displaces. Argument is the per-frame delta.</summary>
        public event Action<Vector3> OnPlayerMoved;

        /// <summary>Raised when the grounded state changes. True = on ground, false = airborne.</summary>
        public event Action<bool> OnPlayerGroundedChanged;

        /// <summary>Raised when the player dies. Reserved for a future health/damage system.</summary>
        public event Action OnPlayerDied;

        // ---- Properties ------------------------------------------------------

        /// <summary>The CharacterController component used for physics-based movement.</summary>
        public CharacterController Controller => _controller;

        // ---- Lifecycle -------------------------------------------------------

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            _controller = GetComponent<CharacterController>();

            if (flight == null) flight = GetComponent<PlayerFlight>();
            if (playerCamera == null) playerCamera = GetComponentInChildren<PlayerCamera>();
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ---- Update ----------------------------------------------------------

        private void Update()
        {
            if (GameManager.Instance == null || GameManager.Instance.Input == null) return;

            // Flight mode handles its own movement; skip ground logic entirely.
            if (IsFlying()) return;

            HandleGroundMovement();
            ApplyHeadBob();
        }

        // ---- Public API ------------------------------------------------------

        /// <summary>
        /// Sets the player's world position and rotation. Resets velocity and head bob state.
        /// Use for initial spawn, save/load restore, or level transitions.
        /// </summary>
        /// <param name="position">World-space position.</param>
        /// <param name="rotation">World-space rotation.</param>
        public void SetPosition(Vector3 position, Quaternion rotation)
        {
            transform.position = position;
            transform.rotation = rotation;
            _velocity = Vector3.zero;
            _headBobPhase = 0f;
            _wasGrounded = false;

            if (playerCamera != null)
            {
                playerCamera.ResetLook();
            }
        }

        /// <summary>
        /// Instantly moves the player to a new world position, preserving current rotation.
        /// Use for portals, checkpoints, or quest-based relocations.
        /// </summary>
        /// <param name="position">World-space position to teleport to.</param>
        public void Teleport(Vector3 position)
        {
            transform.position = position;
            _velocity = Vector3.zero;
            _headBobPhase = 0f;
            _wasGrounded = false;
        }

        /// <summary>
        /// Returns true if the player is currently in flight mode.
        /// Convenience proxy so external systems can query without holding a PlayerFlight reference.
        /// </summary>
        public bool IsFlying() => flight != null && flight.IsFlying;

        /// <summary>
        /// True when the underlying CharacterController reports grounded.
        /// Proxied so external systems (audio, footstep, particles) don't need
        /// a direct CharacterController reference.
        /// </summary>
        public bool IsGrounded() => _controller != null && _controller.isGrounded;

        /// <summary>
        /// True while the sprint input action is held. Read once per frame.
        /// </summary>
        public bool IsSprinting()
        {
            var input = GameManager.Instance != null ? GameManager.Instance.Input : null;
            return input != null && input.SprintHeld();
        }

        /// <summary>
        /// Current horizontal speed in world units per second (XZ magnitude of velocity).
        /// Used by FootstepPlayer to gate footstep timing and by audio to vary effects.
        /// </summary>
        public float HorizontalSpeed()
        {
            if (_controller == null) return 0f;
            Vector3 v = _controller.velocity;
            return new Vector2(v.x, v.z).magnitude;
        }

        /// <summary>
        /// Raises the OnPlayerDied event. Called by a future damage/health system.
        /// </summary>
        public void Die()
        {
            OnPlayerDied?.Invoke();
        }

        // ---- Internal --------------------------------------------------------

        private void HandleGroundMovement()
        {
            var input = GameManager.Instance.Input;

            // --- Horizontal movement (WASD relative to player facing) ---
            Vector2 moveInput = input.Move();
            Vector3 moveDir = transform.right * moveInput.x + transform.forward * moveInput.y;

            if (moveDir.sqrMagnitude > 1f)
            {
                moveDir.Normalize();
            }

            float currentSpeed = input.SprintHeld() ? moveSpeed * sprintMultiplier : moveSpeed;
            Vector3 targetHorizontal = moveDir * currentSpeed;

            // Smoothly accelerate/decelerate horizontal velocity
            Vector3 horizontalVelocity = Vector3.Lerp(
                _velocity, targetHorizontal,
                Mathf.Clamp01(12f * Time.deltaTime)
            );

            // Preserve Y from previous frame (gravity/jump)
            horizontalVelocity.y = _velocity.y;

            // --- Vertical: gravity ---
            horizontalVelocity.y -= gravity * Time.deltaTime;

            // --- Jump ---
            if (input.JumpHeld() && _controller.isGrounded)
            {
                // v = sqrt(2 * g * h) gives the launch velocity to reach jumpHeight
                float jumpVelocity = Mathf.Sqrt(2f * gravity * jumpHeight);
                horizontalVelocity.y = jumpVelocity;
            }

            _velocity = horizontalVelocity;

            // --- Apply via CharacterController ---
            Vector3 displacement = _velocity * Time.deltaTime;
            _controller.Move(displacement);

            // Raise moved event if there was actual displacement
            if (displacement.sqrMagnitude > 0.000001f)
            {
                OnPlayerMoved?.Invoke(displacement);
            }

            // --- Grounded state change ---
            bool isGrounded = _controller.isGrounded;
            if (isGrounded != _wasGrounded)
            {
                _wasGrounded = isGrounded;
                OnPlayerGroundedChanged?.Invoke(isGrounded);
            }

            // Prevent velocity from accumulating on ground contact
            if (_controller.isGrounded && _velocity.y < 0f)
            {
                _velocity.y = -2f;
            }

            // --- Advance head bob phase ---
            float horizontalDistance = new Vector3(displacement.x, 0f, displacement.z).magnitude;
            _headBobPhase += horizontalDistance * headBobFrequency;
        }

        private void ApplyHeadBob()
        {
            if (!enableHeadBob || playerCamera == null) return;
            if (!_controller.isGrounded) return;

            float horizontalSpeed = new Vector3(_velocity.x, 0f, _velocity.z).magnitude;

            if (horizontalSpeed < 0.1f)
            {
                // Ease back to rest position
                var camTransform = playerCamera.transform;
                camTransform.localPosition = Vector3.Lerp(
                    camTransform.localPosition, Vector3.zero,
                    10f * Time.deltaTime
                );
                return;
            }

            float bobY = Mathf.Sin(_headBobPhase) * headBobIntensity;
            float bobX = Mathf.Cos(_headBobPhase * 0.5f) * headBobIntensity * 0.5f;
            Vector3 targetOffset = new Vector3(bobX, bobY, 0f);

            var camTransform = playerCamera.transform;
            camTransform.localPosition = Vector3.Lerp(
                camTransform.localPosition, targetOffset,
                15f * Time.deltaTime
            );
        }
    }
}
