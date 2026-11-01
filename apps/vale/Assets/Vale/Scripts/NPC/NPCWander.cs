using UnityEngine;
using Vale.Dialogue;

namespace Vale.NPC
{
    /// <summary>
    /// Idle wander AI for NPCs. Picks a random point within <c>wanderRadius</c>
    /// of the anchor every <c>wanderInterval</c> seconds and moves there at
    /// <c>wanderSpeed</c>. Flying NPCs hover at the anchor's altitude with a
    /// gentle Sin-wave. Pauses automatically while any dialogue is active.
    /// </summary>
    public class NPCWander : MonoBehaviour
    {
        [Header("Wander")]
        [Tooltip("Max distance from anchor the NPC will wander. 0 = no wander.")]
        [Min(0f)]
        [SerializeField] private float wanderRadius = 3f;

        [Tooltip("Movement speed while wandering (units/sec).")]
        [Min(0f)]
        [SerializeField] private float wanderSpeed = 1.2f;

        [Tooltip("Seconds between picking a new wander target.")]
        [Min(0.5f)]
        [SerializeField] private float wanderInterval = 4f;

        [Tooltip("If true, the NPC hovers (maintains anchor Y + Sin wave).")]
        [SerializeField] private bool isFlying = true;

        [Header("References")]
        [Tooltip("The NPC's home position. Defaults to this transform's initial position.")]
        [SerializeField] private Transform anchor;

        [Tooltip("If set, reads wander settings from this NPCData instead of local fields.")]
        [SerializeField] private NPCData data;

        // Internal state
        private Vector3 wanderTarget;
        private float nextWanderTime;
        private Vector3 homePosition;
        private bool hasInitialized;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            if (anchor == null) anchor = transform;
            homePosition = transform.position;
        }

        private void Start()
        {
            PickNewTarget();
            nextWanderTime = Time.time + wanderInterval;
            hasInitialized = true;
        }

        // ---- Frame update -----------------------------------------------------

        private void Update()
        {
            // Pause while any dialogue is active.
            if (DialogueRunner.Instance != null && DialogueRunner.Instance.IsActive)
                return;

            if (!hasInitialized) return;

            float radius = data != null ? data.wanderRadius : wanderRadius;
            float speed = data != null ? data.wanderSpeed : wanderSpeed;
            float interval = data != null ? data.wanderInterval : wanderInterval;

            // Pick a new target periodically.
            if (Time.time >= nextWanderTime)
            {
                PickNewTarget();
                nextWanderTime = Time.time + interval;
            }

            // Return to anchor if drifted too far.
            float distFromHome = Vector3.Distance(transform.position, homePosition);
            if (distFromHome > radius * 1.5f)
            {
                wanderTarget = homePosition;
            }

            // Move toward the current target.
            if (wanderRadius > 0f && speed > 0f)
            {
                Vector3 target = GetTargetPosition();
                Vector3 current = transform.position;

                Vector3 newPt = Vector3.MoveTowards(current, target, speed * Time.deltaTime);

                // If flying, maintain hover altitude.
                if (isFlying)
                {
                    float hoverY = anchor.position.y + Mathf.Sin(Time.time) * 0.5f;
                    newPt.y = Mathf.MoveTowards(newPt.y, hoverY, speed * Time.deltaTime);
                }

                transform.position = newPt;
            }
        }

        // ---- Public API -------------------------------------------------------

        /// <summary>Force the wander to reset to home and pick a new target.</summary>
        public void Reset()
        {
            homePosition = transform.position;
            PickNewTarget();
            nextWanderTime = Time.time + (data != null ? data.wanderInterval : wanderInterval);
        }

        // ---- Internal ---------------------------------------------------------

        private Vector3 GetTargetPosition()
        {
            // Clamp target to wander radius.
            Vector3 flat = wanderTarget - homePosition;
            flat.y = 0f;

            float maxDist = data != null ? data.wanderRadius : wanderRadius;
            if (flat.magnitude > maxDist)
                wanderTarget = homePosition + flat.normalized * maxDist;

            return wanderTarget;
        }

        private void PickNewTarget()
        {
            float radius = data != null ? data.wanderRadius : wanderRadius;
            if (radius <= 0f)
            {
                wanderTarget = homePosition;
                return;
            }

            // Random point within a circle (uniform distribution).
            float angle = Random.Range(0f, Mathf.PI * 2f);
            float dist = Random.Range(0f, radius);
            wanderTarget = homePosition + new Vector3(Mathf.Cos(angle) * dist, 0f, Mathf.Sin(angle) * dist);

            if (isFlying)
                wanderTarget.y = anchor.position.y;
        }
    }
}
