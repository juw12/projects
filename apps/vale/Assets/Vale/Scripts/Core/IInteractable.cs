using UnityEngine;

namespace Vale.Core
{
    /// <summary>
    /// Anything in the world that the player can press E to interact with.
    /// Implemented by NPCs, Collectibles, the Altar, etc.
    /// </summary>
    public interface IInteractable
    {
        /// <summary>Short prompt shown on screen, e.g. "Press E to talk".</summary>
        string InteractionPrompt { get; }

        /// <summary>True when the player is currently allowed to interact.</summary>
        bool CanInteract(Player.PlayerController player);

        /// <summary>Trigger the interaction. Callers should check CanInteract first.</summary>
        void Interact(Player.PlayerController player);
    }
}
