using UnityEngine;
using Vale.Dialogue;
using Vale.Player;
using Vale.Quests;

namespace Vale.NPC
{
    /// <summary>
    /// The Fairy Elder — the primary quest giver. Slightly larger than a standard
    /// fairy, emits a gentle aura glow, and resolves dialogue based on the state
    /// of the main quest ("main_quest"): offer / active / complete.
    /// </summary>
    public class FairyElder : NPCBase
    {
        [Header("Identity")]
        [Tooltip("The quest id this elder offers.")]
        [SerializeField] private string questId = "main_quest";

        [Header("Appearance")]
        [Tooltip("Default scale for the elder (1.4x a standard fairy).")]
        [SerializeField] private Vector3 elderScale = new Vector3(1.4f, 1.4f, 1.4f);

        [Tooltip("Child renderer that receives the aura tint.")]
        [SerializeField] private Renderer auraRenderer;

        [Tooltip("Base tint color for the aura.")]
        [SerializeField] private Color auraColor = new Color(1f, 0.9f, 0.5f, 1f);

        [Tooltip("How much the aura brightness oscillates.")]
        [Range(0f, 1f)]
        [SerializeField] private float auraPulseStrength = 0.15f;

        [Tooltip("Pulse frequency in Hz.")]
        [SerializeField] private float auraPulseSpeed = 0.5f;

        // Internal state
        private MaterialPropertyBlock mpb;

        // ---- Unity lifecycle --------------------------------------------------

        protected override void Awake()
        {
            base.Awake();
            transform.localScale = elderScale;

            if (auraRenderer != null)
                mpb = new MaterialPropertyBlock();
        }

        protected override void OnSpawn()
        {
            // No-op — Elder stays in place.
        }

        protected override void OnDespawn()
        {
            // No-op.
        }

        // ---- IInteractable override -------------------------------------------

        public override void Interact(PlayerController player)
        {
            if (!CanInteract(player)) return;

            var questMgr = QuestManager.Instance;

            if (questMgr != null)
            {
                if (questMgr.IsQuestCompleted(questId))
                {
                    // Quest complete — play completion dialogue.
                    StartDialogueFor(player, "complete");
                    return;
                }

                if (questMgr.IsQuestActive(questId))
                {
                    // Quest in progress — play hint dialogue.
                    StartDialogueFor(player, "active");
                    return;
                }

                // Quest not started — start it and play offer dialogue.
                questMgr.StartQuest(questId);
                StartDialogueFor(player, "offer");
                return;
            }

            // Fallback if QuestManager not ready: just play the first dialogue.
            base.Interact(player);
        }

        // ---- IDialogueSpeaker override ----------------------------------------

        public override DialogueData GetDialogueFor(PlayerController player, string dialogueId = "default")
        {
            if (data == null || data.dialogues == null || data.dialogues.Count == 0)
                return null;

            // If a specific dialogue id was explicitly passed and it's not "default",
            // try to match it directly first.
            if (!string.IsNullOrEmpty(dialogueId) && dialogueId != "default")
            {
                var match = FindDialogueById(dialogueId);
                if (match != null) return match;
            }

            // Resolve based on quest state.
            var questMgr = QuestManager.Instance;
            if (questMgr != null)
            {
                if (questMgr.IsQuestCompleted(questId))
                {
                    var complete = FindDialogueById("complete");
                    if (complete != null) return complete;
                }

                if (questMgr.IsQuestActive(questId))
                {
                    var active = FindDialogueById("active");
                    if (active != null) return active;
                }

                // Default to offer.
                var offer = FindDialogueById("offer");
                if (offer != null) return offer;
            }

            // Fallback: first dialogue in the list.
            return data.dialogues[0];
        }

        // ---- Frame update -----------------------------------------------------

        private void Update()
        {
            // Aura pulse.
            if (auraRenderer != null && mpb != null)
            {
                float pulse = 1f + Mathf.Sin(Time.time * auraPulseSpeed * Mathf.PI * 2f) * auraPulseStrength;
                Color tinted = auraColor;
                tinted.r *= pulse;
                tinted.g *= pulse;
                tinted.b *= pulse;

                auraRenderer.GetPropertyBlock(mpb);
                mpb.SetColor("_BaseColor", tinted);
                auraRenderer.SetPropertyBlock(mpb);
            }
        }

        // ---- Internal ---------------------------------------------------------

        private DialogueData FindDialogueById(string id)
        {
            if (data == null || data.dialogues == null) return null;

            for (int i = 0; i < data.dialogues.Count; i++)
            {
                if (data.dialogues[i] != null && data.dialogues[i].dialogueId == id)
                    return data.dialogues[i];
            }
            return null;
        }

        private void StartDialogueFor(PlayerController player, string stateId)
        {
            var runner = DialogueRunner.Instance;
            if (runner == null)
            {
                Debug.LogWarning($"[FairyElder] DialogueRunner.Instance is null on '{name}'.");
                return;
            }

            var dialogue = FindDialogueById(stateId);
            if (dialogue == null)
                dialogue = data.dialogues.Count > 0 ? data.dialogues[0] : null;

            if (dialogue != null)
                runner.StartDialogue(dialogue, this);
        }
    }
}
