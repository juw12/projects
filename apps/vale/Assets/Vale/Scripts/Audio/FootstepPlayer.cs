using UnityEngine;
using Vale.Core;

namespace Vale.Audio
{
    /// <summary>
    /// Plays randomized footstep sounds at intervals while the player is
    /// grounded and moving. Attach to the player root.
    /// </summary>
    [RequireComponent(typeof(Player.PlayerController))]
    public class FootstepPlayer : MonoBehaviour
    {
        [Header("Clips")]
        [SerializeField] private AudioClip[] grassClips;
        [SerializeField] private AudioClip[] dirtClips;
        [SerializeField] private AudioClip[] stoneClips;
        [SerializeField] private AudioClip[] waterClips;
        [SerializeField] private AudioClip flightLoop;

        [Header("Timing")]
        [Range(0.1f, 1.0f)]
        [SerializeField] private float stepIntervalWalk = 0.55f;
        [Range(0.1f, 1.0f)]
        [SerializeField] private float stepIntervalRun = 0.32f;

        [Header("Volume")]
        [Range(0f, 1f)]
        [SerializeField] private float baseVolume = 0.4f;

        private Player.PlayerController _player;
        private float _stepTimer;
        private AudioSource _flightLoopSource;

        private void Awake()
        {
            _player = GetComponent<Player.PlayerController>();
            _flightLoopSource = gameObject.AddComponent<AudioSource>();
            _flightLoopSource.loop = true;
            _flightLoopSource.playOnAwake = false;
            _flightLoopSource.volume = 0f;
        }

        private void Update()
        {
            if (_player == null) return;

            // Flight loop: play when flying.
            if (_player.IsFlying())
            {
                if (!_flightLoopSource.isPlaying && flightLoop != null)
                {
                    _flightLoopSource.clip = flightLoop;
                    _flightLoopSource.Play();
                }
                _flightLoopSource.volume = Mathf.MoveTowards(_flightLoopSource.volume, baseVolume * 0.6f, Time.deltaTime);
            }
            else
            {
                _flightLoopSource.volume = Mathf.MoveTowards(_flightLoopSource.volume, 0f, Time.deltaTime * 4f);
                if (_flightLoopSource.volume <= 0.001f && _flightLoopSource.isPlaying) _flightLoopSource.Stop();
            }

            // Footsteps only when grounded + moving.
            if (_player.IsFlying() || !_player.IsGrounded())
            {
                _stepTimer = 0f;
                return;
            }

            var speed = _player.HorizontalSpeed();
            if (speed < 0.1f) { _stepTimer = 0f; return; }

            var interval = _player.IsSprinting() ? stepIntervalRun : stepIntervalWalk;
            _stepTimer += Time.deltaTime;
            if (_stepTimer >= interval)
            {
                _stepTimer = 0f;
                PlayStepForSurface();
            }
        }

        private void PlayStepForSurface()
        {
            var clip = PickClipForCurrentSurface();
            if (clip != null)
            {
                GameManager.Instance?.Audio?.PlaySFX(clip, baseVolume);
            }
        }

        private AudioClip PickClipForCurrentSurface()
        {
            // Default to grass; in a richer implementation, raycast down to read a surface tag.
            var pool = grassClips;
            if (pool == null || pool.Length == 0) return null;
            return pool[Random.Range(0, pool.Length)];
        }
    }
}
