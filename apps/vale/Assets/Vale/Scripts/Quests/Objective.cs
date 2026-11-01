using System;

namespace Vale.Quests
{
    /// <summary>
    /// Runtime wrapper around <see cref="ObjectiveData"/> tracking current progress.
    /// Not a MonoBehaviour — owned by <see cref="Quest"/> instances.
    /// </summary>
    public class Objective
    {
        /// <summary>The underlying data asset (read-only at runtime).</summary>
        public ObjectiveData Data { get; }

        /// <summary>Current progress count toward <see cref="ObjectiveData.requiredCount"/>.</summary>
        public int CurrentCount { get; private set; }

        /// <summary>True when <see cref="CurrentCount"/> has reached <see cref="ObjectiveData.requiredCount"/>.</summary>
        public bool IsComplete => CurrentCount >= Data.requiredCount;

        /// <summary>Creates a new runtime objective at zero progress.</summary>
        /// <param name="data">The ScriptableObject-derived data defining this objective.</param>
        public Objective(ObjectiveData data)
        {
            Data = data ?? throw new ArgumentNullException(nameof(data));
            CurrentCount = 0;
        }

        /// <summary>
        /// Increments progress by <paramref name="delta"/>. Clamped to requiredCount.
        /// No effect if already complete.
        /// </summary>
        public void AddProgress(int delta)
        {
            if (IsComplete) return;
            CurrentCount = Math.Min(CurrentCount + delta, Data.requiredCount);
        }

        /// <summary>Sets progress to an absolute value (used by save/load). Clamped to valid range.</summary>
        public void SetProgress(int count)
        {
            CurrentCount = Math.Clamp(count, 0, Data.requiredCount);
        }
    }
}
