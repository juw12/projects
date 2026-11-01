using UnityEngine;
using Vale.Core;

namespace Vale.Player
{
    /// <summary>
    /// First-person camera look controller. Must be attached to the camera transform,
    /// which is a child of the player root. Applies yaw rotation to the parent
    /// (player root) and pitch rotation to its own local transform.
    /// Pitch is clamped to prevent flipping. This is the body camera that a
    /// Cinemachine virtual camera will follow — no direct Cinemachine integration here.
    /// </summary>
    public class PlayerCamera : MonoBehaviour
    {
        [Header("Sensitivity")]
        [Tooltip("Mouse look sensitivity multiplier. Higher = faster rotation.")]
        [Range(0.1f, 10f)]
        [SerializeField] private float sensitivity = 2.0f;

        [Header("Pitch Limits")]
        [Tooltip("Maximum upward pitch in degrees.")]
        [Range(10f, 90f)]
        [SerializeField] private float maxPitch = 85f;

        [Tooltip("Maximum downward pitch in degrees (negative).")]
        [Range(-90f, -10f)]
        [SerializeField] private float minPitch = -85f;

        [Header("Damping")]
        [Tooltip("Enable smooth damping for camera look. Off = instant 1:1 mouse mapping.")]
        [SerializeField] private bool useDamping = false;

        [Tooltip("Damping response speed. Higher = snappier. Only used when Use Damping is on.")]
        [Range(1f, 30f)]
        [SerializeField] private float dampingSpeed = 12f;

        // Runtime state
        private Transform _playerRoot;
        private Vector2 _currentRotation;
        private Vector2 _targetRotation;

        // ---- Properties ------------------------------------------------------

        /// <summary>Current pitch angle in degrees. Useful for UI indicators or debugging.</summary>
        public float CurrentPitch => _currentRotation.y;

        /// <summary>Current yaw angle in degrees. Useful for UI indicators or debugging.</summary>
        public float CurrentYaw => _currentRotation.x;

        // ---- Lifecycle -------------------------------------------------------

        private void Awake()
        {
            // Camera is a child of the player root; parent transform gets yaw.
            _playerRoot = transform.parent;
            _currentRotation = Vector2.zero;
            _targetRotation = Vector2.zero;
        }

        // ---- Update ----------------------------------------------------------

        private void Update()
        {
            if (GameManager.Instance == null || GameManager.Instance.Input == null) return;

            // Read mouse look delta from the New Input System via InputManager
            Vector2 lookDelta = GameManager.Instance.Input.Look();

            if (useDamping)
            {
                // Accumulate target rotation, then lerp current toward target
                _targetRotation.x += lookDelta.x * sensitivity;
                _targetRotation.y -= lookDelta.y * sensitivity;
                _targetRotation.y = Mathf.Clamp(_targetRotation.y, minPitch, maxPitch);

                _currentRotation = Vector2.Lerp(
                    _currentRotation, _targetRotation,
                    dampingSpeed * Time.deltaTime
                );
            }
            else
            {
                // Direct 1:1 mapping (no smoothing)
                _currentRotation.x += lookDelta.x * sensitivity;
                _currentRotation.y -= lookDelta.y * sensitivity;
                _currentRotation.y = Mathf.Clamp(_currentRotation.y, minPitch, maxPitch);
            }

            // Apply: yaw on player root, pitch on camera local
            if (_playerRoot != null)
            {
                _playerRoot.localRotation = Quaternion.Euler(0f, _currentRotation.x, 0f);
            }
            transform.localRotation = Quaternion.Euler(_currentRotation.y, 0f, 0f);
        }

        // ---- Public API ------------------------------------------------------

        /// <summary>
        /// Resets both yaw and pitch to zero. Call after teleporting or loading a save
        /// to avoid residual camera rotation from a previous location.
        /// </summary>
        public void ResetLook()
        {
            _currentRotation = Vector2.zero;
            _targetRotation = Vector2.zero;

            if (_playerRoot != null)
            {
                _playerRoot.localRotation = Quaternion.identity;
            }
            transform.localRotation = Quaternion.identity;
        }
    }
}
