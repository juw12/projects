using System;
using UnityEngine;
using UnityEngine.UI;
using Vale.Core;
using Vale.Player;

namespace Vale.UI
{
    /// <summary>
    /// Pause menu (Esc). Freezes time, disables player input, and shows a panel
    /// with Resume / Save / Quit buttons. Toggled via the Pause input action.
    /// </summary>
    public class PauseMenuUI : MonoBehaviour
    {
        [Header("Panel")]
        [Tooltip("Root panel GameObject for the pause menu. Hidden by default.")]
        [SerializeField] private GameObject panel;

        [Header("Buttons")]
        [Tooltip("Button to resume the game.")]
        [SerializeField] private Button resumeBtn;

        [Tooltip("Button to save the game.")]
        [SerializeField] private Button saveBtn;

        [Tooltip("Button to quit to the desktop / stop play mode.")]
        [SerializeField] private Button quitBtn;

        // Runtime state
        private bool _isPaused;
        private bool _warnedMissingRefs;
        private float _previousTimeScale;

        // ---- Unity lifecycle --------------------------------------------------

        private void Awake()
        {
            ValidateReferences();
            if (panel != null) panel.SetActive(false);
            WireButtons();
        }

        private void OnEnable()
        {
            if (panel != null)
            {
                // Ensure panel starts inactive when this script is enabled.
                panel.SetActive(false);
            }
        }

        // ---- Update -----------------------------------------------------------

        private void Update()
        {
            var gm = GameManager.Instance;
            if (gm == null || gm.Input == null) return;

            if (gm.Input.PauseTriggered())
            {
                TogglePause();
            }
        }

        // ---- Public API -------------------------------------------------------

        /// <summary>True if the game is currently paused.</summary>
        public bool IsPaused => _isPaused;

        /// <summary>Toggles the pause state.</summary>
        public void TogglePause()
        {
            if (_isPaused)
                Resume();
            else
                Pause();
        }

        // ---- Pause / Resume ---------------------------------------------------

        private void Pause()
        {
            if (panel == null) return;

            _isPaused = true;
            _previousTimeScale = Time.timeScale;
            Time.timeScale = 0f;

            panel.SetActive(true);

            // Disable player input map.
            var gm = GameManager.Instance;
            if (gm != null && gm.Input != null)
            {
                var playerMap = gm.Input.PlayerMap;
                if (playerMap != null) playerMap.Disable();
            }
        }

        private void Resume()
        {
            if (panel == null) return;

            _isPaused = false;
            Time.timeScale = _previousTimeScale;

            panel.SetActive(false);

            // Re-enable player input map.
            var gm = GameManager.Instance;
            if (gm != null && gm.Input != null)
            {
                var playerMap = gm.Input.PlayerMap;
                if (playerMap != null) playerMap.Enable();
            }
        }

        // ---- Button handlers --------------------------------------------------

        private void WireButtons()
        {
            if (resumeBtn != null)
            {
                resumeBtn.onClick.AddListener(Resume);
            }

            if (saveBtn != null)
            {
                saveBtn.onClick.AddListener(OnSaveClicked);
            }

            if (quitBtn != null)
            {
                quitBtn.onClick.AddListener(OnQuitClicked);
            }
        }

        private void OnSaveClicked()
        {
            var gm = GameManager.Instance;
            if (gm != null && gm.Save != null)
            {
                gm.Save.Save();
                Debug.Log("[PauseMenuUI] Game saved.");
            }
        }

        private void OnQuitClicked()
        {
            var gm = GameManager.Instance;
            if (gm != null)
            {
                // Restore timeScale before quitting so Application.Quit works properly.
                Time.timeScale = 1f;
                gm.Quit();
            }
        }

        // ---- Cleanup ----------------------------------------------------------

        private void OnDisable()
        {
            // If the component is disabled while paused, restore timeScale.
            if (_isPaused)
            {
                Time.timeScale = _previousTimeScale;
                _isPaused = false;

                var gm = GameManager.Instance;
                if (gm != null && gm.Input != null)
                {
                    var playerMap = gm.Input.PlayerMap;
                    if (playerMap != null) playerMap.Enable();
                }
            }
        }

        private void OnDestroy()
        {
            if (resumeBtn != null) resumeBtn.onClick.RemoveListener(Resume);
            if (saveBtn != null) saveBtn.onClick.RemoveListener(OnSaveClicked);
            if (quitBtn != null) quitBtn.onClick.RemoveListener(OnQuitClicked);
        }

        private void ValidateReferences()
        {
            if (_warnedMissingRefs) return;

            if (panel == null)
                Debug.LogWarning("[PauseMenuUI] panel is not assigned.", this);
            if (resumeBtn == null)
                Debug.LogWarning("[PauseMenuUI] resumeBtn is not assigned.", this);

            _warnedMissingRefs = true;
        }
    }
}
