using UnityEngine;
using Vale.Core;
using Vale.Player;
using Vale.Quests;

namespace Vale.Collectibles
{
    /// <summary>
    /// Abstract base for all in-world collectible objects.
    /// Implements <see cref="IInteractable"/>, <see cref="ICollectible"/>, and <see cref="IQuestTarget"/>.
    /// Subclasses implement <see cref="OnCollect"/> for type-specific pickup behavior.
    /// </summary>
    [RequireComponent(typeof(Collider))]
    public abstract class Collectible : MonoBehaviour, IInteractable, ICollectible, IQuestTarget
    {
        [Header("Collectible Data")]
        [Tooltip("The data asset defining this collectible.")]
        [SerializeField] protected CollectibleData data;

        [Header("Quest Binding (optional)")]
        [Tooltip("Quest this collectible contributes to. Leave empty if not quest-linked.")]
        [SerializeField] protected string questId;

        [Tooltip("Objective within the quest. Leave empty if not quest-linked.")]
        [SerializeField] protected string objectiveId;

        [Header("Visual")]
        [Tooltip("If true, the GameObject is deactivated after collection.")]
        [SerializeField] protected bool hideOnCollect = true;

        [Tooltip("Optional particle burst to play on collection.")]
        [SerializeField] protected ParticleSystem particleBurst;

        // ─── IInteractable ─────────────────────────────────────────────────────────

        /// <inheritdoc />
        public string InteractionPrompt =>
            data != null && !string.IsNullOrEmpty(data.pickupPrompt)
                ? data.pickupPrompt
                : "Press E to pick up";

        /// <inheritdoc />
        public virtual bool CanInteract(PlayerController player) => !IsCollected;

        /// <inheritdoc />
        public virtual void Interact(PlayerController player)
        {
            if (!CanInteract(player)) return;
            Collect(player);
        }

        // ─── ICollectible ──────────────────────────────────────────────────────────

        /// <inheritdoc />
        public CollectibleData Data => data;

        /// <inheritdoc />
        public bool IsCollected { get; protected set; }

        /// <inheritdoc />
        public void Collect(PlayerController player)
        {
            if (IsCollected) return;
            IsCollected = true;

            OnCollect(player);

            // Fire particle burst if assigned
            if (particleBurst != null)
                particleBurst.Play();

            // Hide GameObject if configured
            if (hideOnCollect)
                gameObject.SetActive(false);
        }

        // ─── IQuestTarget ──────────────────────────────────────────────────────────

        /// <inheritdoc />
        public string QuestId => questId;

        /// <inheritdoc />
        public string ObjectiveId => objectiveId;

        /// <summary>
        /// Called by an external system (e.g. area trigger, scripted event) to
        /// auto-collect this object without player interaction.
        /// </summary>
        public void OnObjectiveTrigger()
        {
            if (IsCollected) return;

            // Trigger collection with null player (system-triggered)
            IsCollected = true;
            OnCollect(null);

            if (particleBurst != null)
                particleBurst.Play();

            if (hideOnCollect)
                gameObject.SetActive(false);
        }

        // ─── Subclass contract ─────────────────────────────────────────────────────

        /// <summary>
        /// Called when this collectible is picked up. Subclasses implement type-specific
        /// behavior here (notify managers, advance quests, play VFX, etc.).
        /// </summary>
        /// <param name="player">The player who collected this, or null if system-triggered.</param>
        protected abstract void OnCollect(PlayerController player);
    }
}
