using System;
using System.Collections.Generic;

namespace Vale.Quests
{
    /// <summary>Represents the lifecycle state of a quest.</summary>
    public enum QuestState
    {
        Inactive,
        Active,
        Completed,
        Failed
    }

    /// <summary>
    /// Runtime quest instance wrapping <see cref="QuestData"/> with live objective progress.
    /// Not a MonoBehaviour — owned by <see cref="QuestManager"/>.
    /// </summary>
    public class Quest
    {
        /// <summary>The ScriptableObject data asset for this quest.</summary>
        public QuestData Data { get; }

        /// <summary>Current lifecycle state.</summary>
        public QuestState State { get; private set; }

        /// <summary>Mirror of per-objective counts (index-aligned with Data.objectives).</summary>
        public int[] ObjectiveProgress { get; private set; }

        /// <summary>Index of the first non-complete objective (the one the player works on next).</summary>
        public int CurrentObjectiveIndex { get; private set; }

        private readonly List<Objective> _objectives;

        /// <summary>Creates a new quest instance in the <see cref="QuestState.Inactive"/> state.</summary>
        public Quest(QuestData data)
        {
            Data = data ?? throw new ArgumentNullException(nameof(data));
            State = QuestState.Inactive;
            _objectives = new List<Objective>();

            if (data.objectives != null)
            {
                foreach (var od in data.objectives)
                    _objectives.Add(new Objective(od));
            }

            ObjectiveProgress = new int[_objectives.Count];
            CurrentObjectiveIndex = 0;
        }

        /// <summary>Transitions the quest to <see cref="QuestState.Active"/>.</summary>
        public void Activate()
        {
            State = QuestState.Active;
        }

        /// <summary>
        /// Increments progress for the objective matching <paramref name="objectiveId"/>.
        /// When the objective reaches its required count, advances <see cref="CurrentObjectiveIndex"/>
        /// to the next incomplete objective.
        /// </summary>
        public void AdvanceObjective(string objectiveId, int delta = 1)
        {
            if (State != QuestState.Active) return;

            for (int i = 0; i < _objectives.Count; i++)
            {
                if (_objectives[i].Data.objectiveId == objectiveId)
                {
                    _objectives[i].AddProgress(delta);
                    ObjectiveProgress[i] = _objectives[i].CurrentCount;

                    if (_objectives[i].IsComplete)
                        RecalculateCurrentObjectiveIndex();

                    return;
                }
            }
        }

        /// <summary>True when every objective has reached its required count.</summary>
        public bool IsComplete()
        {
            for (int i = 0; i < _objectives.Count; i++)
            {
                if (!_objectives[i].IsComplete) return false;
            }
            return true;
        }

        /// <summary>Transitions the quest to <see cref="QuestState.Completed"/>.</summary>
        public void MarkCompleted()
        {
            State = QuestState.Completed;
        }

        /// <summary>Transitions the quest to <see cref="QuestState.Failed"/>.</summary>
        public void MarkFailed()
        {
            State = QuestState.Failed;
        }

        /// <summary>Gets the <see cref="Objective"/> at the given index.</summary>
        public Objective GetObjective(int index)
        {
            return _objectives[index];
        }

        /// <summary>Gets the number of objectives in this quest.</summary>
        public int ObjectiveCount => _objectives.Count;

        /// <summary>Serializes this quest's runtime state for saving.</summary>
        public QuestSaveData ToSaveData()
        {
            return new QuestSaveData
            {
                state = State.ToString(),
                objectiveProgress = (int[])ObjectiveProgress.Clone()
            };
        }

        /// <summary>Restores runtime state from a previously saved <see cref="QuestSaveData"/>.</summary>
        public void ApplySaveData(QuestSaveData saveData)
        {
            if (saveData == null) return;

            if (Enum.TryParse<QuestState>(saveData.state, out var parsedState))
                State = parsedState;

            if (saveData.objectiveProgress != null)
            {
                for (int i = 0; i < Math.Min(saveData.objectiveProgress.Length, _objectives.Count); i++)
                {
                    _objectives[i].SetProgress(saveData.objectiveProgress[i]);
                    ObjectiveProgress[i] = _objectives[i].CurrentCount;
                }
            }

            RecalculateCurrentObjectiveIndex();
        }

        private void RecalculateCurrentObjectiveIndex()
        {
            CurrentObjectiveIndex = 0;
            while (CurrentObjectiveIndex < _objectives.Count - 1 && _objectives[CurrentObjectiveIndex].IsComplete)
                CurrentObjectiveIndex++;
        }
    }
}
