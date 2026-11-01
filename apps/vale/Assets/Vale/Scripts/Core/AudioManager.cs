using UnityEngine;
using UnityEngine.Audio;

namespace Vale.Core
{
    /// <summary>
    /// Lightweight audio router: BGM crossfade, one-shot SFX, and a 4-channel
    /// ambient layer (wind, forest, water, fairy hum). Mixer groups are wired
    /// in the inspector — see SETUP.md.
    /// </summary>
    public class AudioManager : MonoBehaviour
    {
        [Header("Mixer (optional)")]
        [SerializeField] private AudioMixer mixer;

        [Header("Channels")]
        [SerializeField] private AudioSource bgmSourceA;
        [SerializeField] private AudioSource bgmSourceB;
        [SerializeField] private AudioSource sfxSource;
        [SerializeField] private AudioSource ambientWind;
        [SerializeField] private AudioSource ambientForest;
        [SerializeField] private AudioSource ambientWater;
        [SerializeField] private AudioSource ambientFairyHum;

        [Header("Default Volumes")]
        [Range(0f, 1f)] [SerializeField] private float bgmVolume = 0.7f;
        [Range(0f, 1f)] [SerializeField] private float sfxVolume = 1.0f;
        [Range(0f, 1f)] [SerializeField] private float ambientVolume = 0.5f;

        private bool _bgmAIsActive = true;

        // ---- Public API ------------------------------------------------------

        public void PlayBGM(AudioClip clip, float fadeSeconds = 1.5f)
        {
            if (clip == null) return;
            StartCoroutine(CrossfadeBGM(clip, fadeSeconds));
        }

        public void PlaySFX(AudioClip clip, float volumeScale = 1.0f)
        {
            if (clip == null || sfxSource == null) return;
            sfxSource.PlayOneShot(clip, volumeScale * sfxVolume);
        }

        public void SetAmbient(AmbientChannel channel, AudioClip clip, bool loop = true)
        {
            var src = GetAmbientSource(channel);
            if (src == null) return;
            src.clip = clip;
            src.loop = loop;
            src.volume = clip == null ? 0f : ambientVolume;
            if (clip != null && !src.isPlaying) src.Play();
            if (clip == null && src.isPlaying) src.Stop();
        }

        public void SetAmbientVolume(float volume01)
        {
            ambientVolume = Mathf.Clamp01(volume01);
            if (ambientWind != null) ambientWind.volume = ambientWind.clip == null ? 0 : ambientVolume;
            if (ambientForest != null) ambientForest.volume = ambientForest.clip == null ? 0 : ambientVolume;
            if (ambientWater != null) ambientWater.volume = ambientWater.clip == null ? 0 : ambientVolume;
            if (ambientFairyHum != null) ambientFairyHum.volume = ambientFairyHum.clip == null ? 0 : ambientVolume;
        }

        public enum AmbientChannel
        {
            Wind,
            Forest,
            Water,
            FairyHum
        }

        // ---- Internal --------------------------------------------------------

        private System.Collections.IEnumerator CrossfadeBGM(AudioClip newClip, float seconds)
        {
            var outgoing = _bgmAIsActive ? bgmSourceA : bgmSourceB;
            var incoming = _bgmAIsActive ? bgmSourceB : bgmSourceA;

            incoming.clip = newClip;
            incoming.volume = 0f;
            incoming.loop = true;
            incoming.Play();

            float t = 0f;
            float startOut = outgoing != null ? outgoing.volume : 0f;
            while (t < seconds)
            {
                t += Time.unscaledDeltaTime;
                float k = t / seconds;
                if (outgoing != null) outgoing.volume = Mathf.Lerp(startOut, 0f, k);
                incoming.volume = Mathf.Lerp(0f, bgmVolume, k);
                yield return null;
            }
            if (outgoing != null) { outgoing.Stop(); outgoing.volume = 0f; }
            incoming.volume = bgmVolume;
            _bgmAIsActive = !_bgmAIsActive;
        }

        private AudioSource GetAmbientSource(AmbientChannel channel)
        {
            return channel switch
            {
                AmbientChannel.Wind => ambientWind,
                AmbientChannel.Forest => ambientForest,
                AmbientChannel.Water => ambientWater,
                AmbientChannel.FairyHum => ambientFairyHum,
                _ => null,
            };
        }
    }
}
