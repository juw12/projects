using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Vale.Core
{
    /// <summary>
    /// Async scene loading with a "spawn point name" contract.
    /// Other systems call LoadSceneAsync(name) and then resolve the player to a
    /// GameObject tagged PlayerSpawn with a matching SpawnPoint component.
    /// </summary>
    public class SceneController : MonoBehaviour
    {
        [Tooltip("Default spawn point tag if no override is provided.")]
        [SerializeField] private string defaultSpawnPoint = "ValeEntrance";

        public string PendingSpawnPoint { get; private set; }

        public event System.Action<string> OnSceneLoadStarted;
        public event System.Action<string> OnSceneLoadCompleted;

        // ---- Public API ------------------------------------------------------

        public void LoadSceneAsync(string sceneName, string spawnPoint = null)
        {
            PendingSpawnPoint = string.IsNullOrEmpty(spawnPoint) ? defaultSpawnPoint : spawnPoint;
            StartCoroutine(LoadSceneRoutine(sceneName));
        }

        public void ReloadCurrentScene()
        {
            var current = SceneManager.GetActiveScene().name;
            LoadSceneAsync(current, PendingSpawnPoint);
        }

        // ---- Routine ---------------------------------------------------------

        private IEnumerator LoadSceneRoutine(string sceneName)
        {
            OnSceneLoadStarted?.Invoke(sceneName);
            var op = SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Single);
            while (!op.isDone) yield return null;
            yield return null; // let scene initialize

            // Resolve spawn point.
            ResolveSpawnPoint();

            OnSceneLoadCompleted?.Invoke(sceneName);
        }

        private void ResolveSpawnPoint()
        {
            var spawns = FindObjectsByType<SpawnPoint>(FindObjectsSortMode.None);
            SpawnPoint chosen = null;

            foreach (var sp in spawns)
            {
                if (sp.PointName == PendingSpawnPoint) { chosen = sp; break; }
            }
            if (chosen == null && spawns.Length > 0) chosen = spawns[0];

            if (chosen == null)
            {
                Debug.LogWarning($"[SceneController] No SpawnPoint found (wanted '{PendingSpawnPoint}').");
                return;
            }

            var player = FindFirstObjectByType<Player.PlayerController>();
            if (player == null) return;

            var cc = player.GetComponent<CharacterController>();
            if (cc != null) cc.enabled = false;
            player.transform.SetPositionAndRotation(chosen.transform.position, chosen.transform.rotation);
            if (cc != null) cc.enabled = true;

            chosen.OnPlayerSpawned(player);
        }
    }

    /// <summary>
    /// Tag a transform as a player spawn point. SceneController resolves these by PointName.
    /// </summary>
    public class SpawnPoint : MonoBehaviour
    {
        [SerializeField] private string pointName = "ValeEntrance";
        public string PointName => pointName;

        public virtual void OnPlayerSpawned(Player.PlayerController player) { }
    }
}
