/* Cache only this release's public app shell. Never cache API or user-data requests. */
'use strict';

const RELEASE = '4.2.2';
const BASE = new URL(self.registration.scope);
const PREFIX = `guangyao-shell-${encodeURIComponent(BASE.pathname)}-`;
const CACHE_NAME = `${PREFIX}${RELEASE}`;
const SHELL_FILES = [
  './index.html',
  './app-plan.html',
  './pwa.js',
  './catalog.js',
  './study.js',
  './account.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const SHELL_URLS = new Set(SHELL_FILES.map(path => new URL(path, BASE).href));

self.addEventListener('install', event => {
  // All-or-nothing release installation. Do not interrupt an active form or session.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(
      [...SHELL_URLS].map(url => new Request(url, {cache: 'reload'}))
    ))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_APPROVED_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || url.search) return;
  url.hash = '';
  const directoryRequest = request.mode === 'navigate' && url.href === BASE.href;
  const canonicalURL = directoryRequest ? new URL('./index.html', BASE).href : url.href;
  if (!SHELL_URLS.has(canonicalURL)) return;

  // Only immutable, explicitly listed shell resources enter the cache.
  // A server endpoint, signed download, payment URL or chat response cannot match.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(canonicalURL);
    if (cached) return cached;
    return fetch(request);
  })());
});
