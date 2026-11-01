namespace Vale.Quests
{
    /// <summary>
    /// A scene object that, when triggered, advances a quest objective.
    /// Implemented by Collectibles (Collect objective), NPCs (Talk objective), and area triggers.
    /// </summary>
    public interface IQuestTarget
    {
        string QuestId { get; }
        string ObjectiveId { get; }

        /// <summary>Called by the objective tracker when this target has been triggered.</summary>
        void OnObjectiveTrigger();
    }
}
