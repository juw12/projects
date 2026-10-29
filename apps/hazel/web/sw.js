/* Hazel home has no offline worker of its own. This file retires the worker that the pre-Hazel
 * "Hazel" app registered at this same address (scope hazel/): it deletes only that worker's
 * 'hazel-app-*' caches, then unregisters. Hazel Sped and Hazel Long keep their own workers in
 * their sub-folders, and other apps' caches are never touched. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('hazel-app-')).map((name) => caches.delete(name))
      ))
      .then(() => self.registration.unregister())
  );
});
