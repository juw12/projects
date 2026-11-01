// Service worker for the /try/ subscribe page (scope /try/).
importScripts("beacon-sw.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
