using System.Collections.Generic;
using UnityEngine;
using Vale.Dialogue;

namespace Vale.NPC
{
    [CreateAssetMenu(fileName = "NPC_", menuName = "Vale/NPC Data", order = 3)]
    public class NPCData : ScriptableObject
    {
        [Tooltip("Stable id; used in quest data and save.")]
        public string npcId;

        public string displayName;

        public Sprite portrait;

        [Tooltip("All dialogues this NPC can speak. Resolved by IDialogueSpeaker.GetDialogueFor.")]
        public List<DialogueData> dialogues = new List<DialogueData>();

        [Tooltip("If true, NPC can offer quests via dialogue choices.")]
        public bool isQuestGiver;

        [Tooltip("Quest ids this NPC can offer.")]
        public List<string> questsOffered = new List<string>();

        [Header("Idle Behaviour")]
        [Tooltip("Max distance the NPC will wander from its anchor point.")]
        public float wanderRadius = 3f;

        [Tooltip("NPC movement speed when wandering.")]
        public float wanderSpeed = 1.2f;

        [Tooltip("Seconds between wander direction changes.")]
        public float wanderInterval = 4f;
    }
}
