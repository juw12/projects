using UnityEngine;
using UnityEngine.Events;
using Vale.Dialogue;
using Vale.Player;

namespace Vale.NPC
{
    /// <summary>
    /// A standard fairy NPC with gentle bobbing flight, idle wander, and optional
    /// slow turn toward the player. Designers can hook sounds/particles into
    /// <see cref="OnInteracted"/>.
    /// </summary>
    public class FairyNPC : NPCBase
    {
        [Header("Flight")]
        [Tooltip("Amplitude of the vertical bob (world units).")]
        [SerializeField] private float bobAmplitude = 0.3f;

        [Tooltip("Frequency of the vertical bob (cycles per second).")]
        [Range(0f, 3f)]
        [SerializeField] private float bobFrequency = 0.8f;

        [Header("Facing")]
        [Tooltip("Max distance at which the fairy turns to face the player.")]
        [SerializeField] private float noticeRadius = 6f;

        [Tooltip("How fast the fairy rotates toward the player (degrees/sec).")]
        [SerializeField] private float rotateSpeed = 90f;

        [Header("Wander")]
        [Tooltip("Assign an NPCWander component, or one will be added automatically.")]
        [SerializeField] private NPCWander wander;

        [Header("Events")]
        [Tooltip("Fired when the player completes a dialogue with this NPC.")]
        private UnityEvent onInteracted = new UnityEvent();
        public UnityEvent OnInteracted => onInteracted;

        // Internal state
        private Vector3 basePosition;
        private float bobPhase;

        // ---- Unity lifecycle --------------------------------------------------

        protected override void Awake()
        {
            base.Awake();
            basePosition = transform.position;

            if (wander == null)
                wander = GetComponent<NPCWander>();
            if (wander == null)
                wander = gameObject.AddComponent<NPCWander>();
        }

        protected override void OnSpawn()
        {
            basePosition = transform.position;
        }

        protected override void OnDespawn()
        {
            // No-op: state is re-captured on next OnSpawn.
        }

        // ---- IInteractable override -------------------------------------------

        public override void Interact(PlayerController player)
        {
            base.Interact(player);
            onInteracted?.Invoke();
        }

        // ---- Frame update -----------------------------------------------------

        private void Update()
        {
            // Pause all motion while a dialogue is active.
            if (DialogueRunner.Instance != null && DialogueRunner.Instance.IsActive)
                return;

            ApplyBob(Time.time);
            ApplyFacing();
        }

        // ---- Internal ---------------------------------------------------------

        private void ApplyBob(float time)
        {
            // Sin-wave vertical offset applied on top of the wander position.
            float offset = Mathf.Sin(time * bobFrequency * Mathf.PI * 2f + bobPhase) * bobAmplitude;
            var pos = transform.position;
            pos.y = basePosition.y + offset;
            transform.position = pos;
        }

        private void ApplyFacing()
        {
            var player = FindPlayer();
            if (player == null) return;

            float dist = Vector3.Distance(transform.position, player.transform.position);
            if (dist > noticeRadius) return;

            Vector3 toPlayer = player.transform.position - transform.position;
            toPlayer.y = 0f;
            if (toPlayer.sqrMagnitude < 0.001f) return;

            Quaternion targetRot = Quaternion.LookRotation(toPlayer);
            transform.rotation = Quaternion.RotateTowards(
                transform.rotation, targetRot, rotateSpeed * Time.deltaTime);
        }

        private PlayerController FindPlayer()
        {
            return PlayerController.Instance;
        }
    }
}
