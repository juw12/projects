using UnityEngine;
using Vale.Core;

namespace Vale.Audio
{
    /// <summary>
    /// One-shot SFX palette for interactions: pickup chime, dialog blip,
    /// quest-complete fanfare, gentle "whoosh" on flight toggle, etc.
    /// Hook this onto any GameObject; methods are static so other systems
    /// can call without a reference.
    /// </summary>
    public class InteractionAudio : MonoBehaviour
    {
        public static InteractionAudio Instance { get; private set; }

        [Header("Clips")]
        [SerializeField] private AudioClip pickupChime;
        [SerializeField] private AudioClip dialogBlip;
        [SerializeField] private AudioClip dialogAdvance;
        [SerializeField] private AudioClip questComplete;
        [SerializeField] private AudioClip questStart;
        [SerializeField] private AudioClip shardPlace;
        [SerializeField] private AudioClip flightWhoosh;
        [SerializeField] private AudioClip errorSoft;

        [Header("Volume")]
        [Range(0f, 1f)] [SerializeField] private float defaultVolume = 0.8f;

        private void Awake()
        {
            Instance = this;
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        // ---- Public hooks ---------------------------------------------------

        public void PlayPickup()      => Play(pickupChime);
        public void PlayDialogBlip()  => Play(dialogBlip, 0.6f);
        public void PlayDialogAdvance() => Play(dialogAdvance, 0.7f);
        public void PlayQuestStart()  => Play(questStart);
        public void PlayQuestComplete() => Play(questComplete);
        public void PlayShardPlace()  => Play(shardPlace);
        public void PlayFlightWhoosh() => Play(flightWhoosh);
        public void PlayError()       => Play(errorSoft, 0.5f);

        // ---- Static API (for code that doesn't have a direct reference) -----

        public static void Pickup()      => Instance?.PlayPickup();
        public static void DialogBlip()  => Instance?.PlayDialogBlip();
        public static void QuestStart()  => Instance?.PlayQuestStart();
        public static void QuestComplete() => Instance?.PlayQuestComplete();
        public static void ShardPlace()  => Instance?.PlayShardPlace();
        public static void FlightWhoosh() => Instance?.PlayFlightWhoosh();

        // ---- Internal -------------------------------------------------------

        private void Play(AudioClip clip, float volumeScale = 1f)
        {
            if (clip == null) return;
            GameManager.Instance?.Audio?.PlaySFX(clip, volumeScale * defaultVolume);
        }
    }
}
