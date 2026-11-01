using UnityEngine;
using Vale.Core;

namespace Vale.Audio
{
    /// <summary>
    /// Drives a four-channel ambient bed (wind, forest, water, fairy hum) plus
    /// gentle music crossfades for time-of-day and biome transitions. Wraps
    /// <see cref="Vale.Core.AudioManager"/> with game-specific ambient sets.
    /// </summary>
    public class AmbientAudioManager : MonoBehaviour
    {
        [System.Serializable]
        public class AmbientSet
        {
            public string setName = "Default";
            public AudioClip wind;
            public AudioClip forest;
            public AudioClip water;
            public AudioClip fairyHum;
            [Range(0f, 1f)] public float volume = 0.5f;
            [Range(0f, 5f)] public float fadeSeconds = 1.5f;
        }

        [Header("Ambient Sets")]
        [SerializeField] private AmbientSet defaultSet;
        [SerializeField] private AmbientSet[] biomeSets;

        [Header("Music")]
        [SerializeField] private AudioClip dayMusic;
        [SerializeField] private AudioClip nightMusic;
        [SerializeField] private AudioClip finaleMusic;

        private AmbientSet _currentSet;
        private float _fadeTimer;

        private void Start()
        {
            if (defaultSet != null) ApplySet(defaultSet, instant: true);
        }

        // ---- Public API ------------------------------------------------------

        public void ApplySet(AmbientSet set, bool instant = false)
        {
            if (set == null) return;
            _currentSet = set;

            var am = GameManager.Instance?.Audio;
            if (am == null) return;

            am.SetAmbient(AudioManager.AmbientChannel.Wind, set.wind);
            am.SetAmbient(AudioManager.AmbientChannel.Forest, set.forest);
            am.SetAmbient(AudioManager.AmbientChannel.Water, set.water);
            am.SetAmbient(AudioManager.AmbientChannel.FairyHum, set.fairyHum);
            am.SetAmbientVolume(set.volume);

            if (instant) _fadeTimer = 0f;
            else _fadeTimer = set.fadeSeconds;
        }

        public void ApplyBiome(string biomeName, bool instant = false)
        {
            if (biomeSets == null) return;
            foreach (var set in biomeSets)
            {
                if (set != null && set.setName == biomeName)
                {
                    ApplySet(set, instant);
                    return;
                }
            }
            Debug.LogWarning($"[AmbientAudioManager] No biome named '{biomeName}'.");
        }

        public void PlayDayMusic()
        {
            GameManager.Instance?.Audio?.PlayBGM(dayMusic);
        }

        public void PlayNightMusic()
        {
            GameManager.Instance?.Audio?.PlayBGM(nightMusic);
        }

        public void PlayFinaleMusic()
        {
            GameManager.Instance?.Audio?.PlayBGM(finaleMusic, fadeSeconds: 4f);
        }

        public void MuteAll(bool mute)
        {
            GameManager.Instance?.Audio?.SetAmbientVolume(mute ? 0f : (_currentSet?.volume ?? 0.5f));
        }
    }
}
