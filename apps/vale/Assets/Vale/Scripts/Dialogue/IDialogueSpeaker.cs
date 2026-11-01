using UnityEngine;
using Vale.Dialogue;

namespace Vale.Dialogue
{
    /// <summary>
    /// Anything that can speak a dialogue. Implemented by FairyNPC and FairyElder.
    /// </summary>
    public interface IDialogueSpeaker
    {
        string SpeakerName { get; }
        Sprite Portrait { get; }

        /// <summary>Resolve the dialogue to play right now, given player state.</summary>
        DialogueData GetDialogueFor(Player.PlayerController player, string dialogueId = "default");
    }
}
