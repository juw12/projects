using UnityEngine;

namespace Vale.Collectibles
{
    [CreateAssetMenu(fileName = "Collectible_", menuName = "Vale/Collectible Data", order = 2)]
    public class CollectibleData : ScriptableObject
    {
        [Tooltip("Stable id; used in save data.")]
        public string collectibleId;

        public string displayName;

        [TextArea(2, 4)]
        public string description;

        public Sprite icon;

        [Tooltip("Generic value used by reward systems. Optional.")]
        public int value;

        [Tooltip("Hint shown on the interaction prompt when in range.")]
        public string pickupPrompt = "Press E to pick up";
    }
}
