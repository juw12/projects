using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vale.Dialogue
{
    [Serializable]
    public class DialogueChoice
    {
        [Tooltip("Player-facing label.")]
        public string label;

        [Tooltip("Next node id; null to end dialogue.")]
        public string nextNodeId;

        [Tooltip("Optional quest to advance when this choice is taken.")]
        public string advanceObjective; // format: "<questId>/<objectiveId>"

        [Tooltip("Optional condition: quest must be in this state.")]
        public string requiresQuestState; // e.g. "MainQuest/Active"
    }

    [Serializable]
    public class DialogueNode
    {
        [Tooltip("Stable id within this dialogue.")]
        public string nodeId;

        [Tooltip("Display name. May be overridden by IDialogueSpeaker.SpeakerName.")]
        public string speakerName;

        [TextArea(2, 6)]
        public string text;

        [Tooltip("Auto-advance target; if null and no choices, dialogue ends.")]
        public string nextNodeId;

        public List<DialogueChoice> choices = new List<DialogueChoice>();
    }

    [CreateAssetMenu(fileName = "Dialogue_", menuName = "Vale/Dialogue Data", order = 1)]
    public class DialogueData : ScriptableObject
    {
        [Tooltip("Stable id; matches NPCData.dialogues[].name.")]
        public string dialogueId;

        [Tooltip("NPC this dialogue belongs to.")]
        public string npcId;

        public List<DialogueNode> nodes = new List<DialogueNode>();

        [Tooltip("Id of the first node to play.")]
        public string startNodeId;
    }
}
