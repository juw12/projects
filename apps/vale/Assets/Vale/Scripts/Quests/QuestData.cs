using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vale.Quests
{
    public enum ObjectiveType
    {
        Collect,        // pick up N of a collectible (collectibleId)
        Talk,           // speak to an NPC (targetId = npcId)
        Reach,          // enter a trigger zone (targetId = zoneId)
        Place,          // place items at a location (targetId = altarId)
        Custom          // game code calls QuestManager.AdvanceObjective directly
    }

    [Serializable]
    public class ObjectiveData
    {
        [Tooltip("Stable id within this quest. Used in save data.")]
        public string objectiveId;

        [TextArea(2, 4)]
        [Tooltip("Shown in the quest log.")]
        public string description;

        public ObjectiveType type;

        [Tooltip("Collectible id, NPC id, zone id, etc. Depends on Type.")]
        public string targetId;

        [Min(1)]
        [Tooltip("How many triggers are required.")]
        public int requiredCount = 1;
    }

    [Serializable]
    public class RewardData
    {
        public string collectibleId;        // grant N of this collectible
        public int amount;
        public string nextQuestId;          // start another quest on completion
        [TextArea] public string completionMessage;
    }

    [CreateAssetMenu(fileName = "Quest_", menuName = "Vale/Quest Data", order = 0)]
    public class QuestData : ScriptableObject
    {
        [Tooltip("Stable id; used in save data and lookups.")]
        public string questId;

        [Tooltip("Shown in HUD and quest log.")]
        public string title;

        [TextArea(3, 6)]
        [Tooltip("Shown when the quest is accepted.")]
        public string description;

        [Tooltip("Shown when offered. Optional.")]
        [TextArea(2, 4)] public string offerText;

        [Tooltip("Ordered objectives; player progresses through them.")]
        public List<ObjectiveData> objectives = new List<ObjectiveData>();

        public List<RewardData> rewards = new List<RewardData>();

        [Tooltip("Optional quest to start automatically when this one completes.")]
        public string nextQuestId;
    }

    /// <summary>Per-quest runtime save shape.</summary>
    [Serializable]
    public class QuestSaveData
    {
        public string state;       // "Inactive" | "Active" | "Completed" | "Failed"
        public int[] objectiveProgress; // current count per objective
    }
}
