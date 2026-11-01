using System.Collections.Generic;
using UnityEngine;
using Vale.Core;
using Vale.Dialogue;
using Vale.Player;

namespace Vale.NPC
{
    /// <summary>
    /// Base class for all NPCs in the Vale. Implements IInteractable and IDialogueSpeaker.
    /// Concrete subclasses (FairyNPC, FairyElder) add specific idle behaviour and quest logic.
    /// </summary>
    public abstract class NPCBase : MonoBehaviour, IInteractable, IDialogueSpeaker
    {
        [Header("Data")]
        [Tooltip("The ScriptableObject holding this NPC's identity, dialogues, and wander settings.")]
        [SerializeField] protected NPCData data;

        [Header("Transforms")]
        [Tooltip("Home position the NPC wanders around. Typically the NPC's spawn point.")]
        [SerializeField] protected Transform anchor;

        [Tooltip("Optional transform the interaction raycast should hit. Defaults to this transform.")]
        [SerializeField] protected Transform interactionTransform;

        // ---- IInteractable ----------------------------------------------------

        public string InteractionPrompt
        {
            get
            {
                if (data != null && data.dialogues != null && data.dialogues.Count > 0)
                    return $"Press E to talk to {data.displayName}";
                return null;
            }
        }

        public virtual bool CanInteract(PlayerController player)
        {
            return data != null && data.dialogues != null && data.dialogues.Count > 0;
        }

        public virtual void Interact(PlayerController player)
        {
            if (!CanInteract(player)) return;

            var runner = DialogueRunner.Instance;
            if (runner == null)
            {
                Debug.LogWarning($"[NPCBase] DialogueRunner.Instance is null on '{name}'. Cannot start dialogue.");
                return;
            }

            var dialogue = GetDialogueFor(player);
            if (dialogue != null)
                runner.StartDialogue(dialogue, this);
        }

        // ---- IDialogueSpeaker -------------------------------------------------

        public string SpeakerName => data != null ? data.displayName : name;

        public Sprite Portrait => data != null ? data.portrait : null;

        public virtual DialogueData GetDialogueFor(PlayerController player, string dialogueId = "default")
        {
            if (data == null || data.dialogues == null || data.dialogues.Count == 0)
                return null;

            // If a specific dialogue id is requested, try to find it.
            if (!string.IsNullOrEmpty(dialogueId) && dialogueId != "default")
            {
                for (int i = 0; i < data.dialogues.Count; i++)
                {
                    if (data.dialogues[i] != null && data.dialogues[i].dialogueId == dialogueId)
                        return data.dialogues[i];
                }
            }

            // Fallback: return the first available dialogue.
            return data.dialogues[0];
        }

        // ---- Abstract lifecycle -----------------------------------------------

        /// <summary>Called when the NPC becomes active in the scene.</summary>
        protected abstract void OnSpawn();

        /// <summary>Called when the NPC is deactivated or removed.</summary>
        protected abstract void OnDespawn();

        // ---- Unity lifecycle --------------------------------------------------

        protected virtual void Awake()
        {
            if (anchor == null) anchor = transform;
            if (interactionTransform == null) interactionTransform = transform;
        }

        protected virtual void OnEnable()
        {
            OnSpawn();
        }

        protected virtual void OnDisable()
        {
            OnDespawn();
        }

        // ---- Helpers ----------------------------------------------------------

        /// <summary>Convenience: the transform that should be hit by interaction raycasts.</summary>
        public Transform InteractionTarget => interactionTransform;
    }
}
