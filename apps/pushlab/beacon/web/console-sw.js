// Service worker for the Beacon console itself ("Test on this browser").
importScripts("beacon-sw.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
