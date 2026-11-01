using UnityEngine;

namespace Vale.Collectibles
{
    /// <summary>
    /// An in-world object that can be collected by the player.
    /// Implemented by Lumenshard and any future collectible types.
    /// </summary>
    public interface ICollectible
    {
        CollectibleData Data { get; }
        bool IsCollected { get; }
        void Collect(Player.PlayerController player);
    }
}
