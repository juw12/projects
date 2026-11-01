using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vale.Core
{
    /// <summary>
    /// Top-level game lifecycle. Owns subsystem manager references and routes
    /// save/load/quit. Survives scene loads so other managers can find it.
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        [Header("Boot")]
        [Tooltip("First scene to load when the game launches.")]
        [SerializeField] private string bootSceneName = "FairyVale";

        [Header("Subsystem References")]
        [SerializeField] private SaveSystem saveSystem;
        [SerializeField] private SceneController sceneController;
        [SerializeField] private AudioManager audioManager;
        [SerializeField] private InputManager inputManager;

        public SaveSystem Save => saveSystem;
        public SceneController Scenes => sceneController;
        public AudioManager Audio => audioManager;
        public InputManager Input => inputManager;

        // ---- Lifecycle -------------------------------------------------------

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            EnsureSubsystems();
        }

        private void Start()
        {
            // Auto-save on focus loss.
            Application.focusChanged += OnAppFocusChanged;

            // Load the boot scene if we're sitting in an empty one.
            if (SceneManager.GetActiveScene().name == "DontDestroyOnLoad" ||
                string.IsNullOrEmpty(SceneManager.GetActiveScene().name))
            {
                Scenes.LoadSceneAsync(bootSceneName);
            }
        }

        private void OnDestroy()
        {
            Application.focusChanged -= OnAppFocusChanged;
            if (Instance == this) Instance = null;
        }

        // ---- Public API ------------------------------------------------------

        public void Quit()
        {
            Save?.Save();
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        public void RestartFromSave()
        {
            Save?.Load();
        }

        // ---- Internal --------------------------------------------------------

        private void EnsureSubsystems()
        {
            if (saveSystem == null) saveSystem = GetOrAdd<SaveSystem>();
            if (sceneController == null) sceneController = GetOrAdd<SceneController>();
            if (audioManager == null) audioManager = GetOrAdd<AudioManager>();
            if (inputManager == null) inputManager = GetOrAdd<InputManager>();
        }

        private T GetOrAdd<T>() where T : Component
        {
            var existing = GetComponentInChildren<T>(true);
            if (existing != null) return existing;
            var go = new GameObject(typeof(T).Name);
            go.transform.SetParent(transform);
            return go.AddComponent<T>();
        }

        private void OnAppFocusChanged(bool hasFocus)
        {
            if (!hasFocus)
            {
                Save?.Save();
            }
        }
    }
}
