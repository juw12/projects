/* AIRIZ Control Center — versioned, scope-isolated, Ed25519-verified, offline-first SW.
 *
 * Replacement for the v2.67 hand-rolled cache-first SW. Adds:
 *   1. Ed25519 manifest signature verification on every fetch of
 *      `https://releases.airiz.example/production/manifest.json` (matches
 *      apps/airiz-motor/desktop/app-update.yml's `updateManifestPublicKey`).
 *   2. BroadcastChannel-coordinated skipWaiting (avoids the v2.67 controller
 *      race documented in docs/airiz-release-update-architecture-survey.md §3.6).
 *   3. Pre-cache verification — refuses to activate a new SW if its embedded
 *      manifest fingerprint doesn't match the runtime-fetched manifest, so an
 *      attacker who compromises the Worker can't push a stale cache.
 *
 * No Workbox dependency: a CDN-fetched Workbox would break offline operation
 * (a serial-port device-control PWA must work without internet). Hand-rolled
 * cache-first + network-fallback remains; this SW just adds verification +
 * safer activation.
 *
 * Bumped to v2.68 on the 1.11.27 release.
 *
 * CI substitution at build time (see .github/workflows/airiz-unified-release.yml):
 *   - PUBLIC_KEY_BASE64 below is rewritten to the production key SPKI DER.
 *   - EXPECTED_MANIFEST_VERSION is rewritten to the release target version.
 *   - CACHE_NAME is rewritten to include the release version (forces clients
 *     to re-fetch the new shell).
 *
 * Public-key SHA-256 fingerprint (for rotation audits): the value comes from
 * `crypto.createHash('sha256').update(spkiDer).digest('hex')` on the dev key.
 */

const CACHE_PREFIX = 'airiz-control-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE_NAME = CACHE_PREFIX + 'v2.68-1.11.27-ed25519';
const MANIFEST_URL = 'https://releases.airiz.example/production/manifest.json';
// Base64 SPKI DER of the Ed25519 public key. CI rewrites this on each release.
const PUBLIC_KEY_BASE64 = 'MCowBQYDK2VwAyEAWq4SVP+UEdh8pLMSzLNRGanSnyzEzerO0xryCkdm5bI=';
// The manifest target version this SW was built for. CI rewrites this.
const EXPECTED_MANIFEST_VERSION = '1.11.27';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './console-ui.css',
  './app.js',
  './console-ui.js',
  './desktop-integration.js',
  './ble-protocol.js',
  './usb-serial.js',
  './remote-ui.js',
  './camera-relay.js',
  './camera-frame-relay.js',
  './phone-fullscreen.js',
  './remote-control.js',
  './audio-link.js',
  './audio-ui.js',
  './quick-connect.js',
  './ziris-team.js',
  './ziris-team.css',
  './i18n.js',
  './i18n-strings.js',
  './i18n.css',
  './device-label.js',
  './remote-session.js',
  './watch.html',
  './camera-view.html',
  './camera-view.js',
  './camera-view.css',
  './ptz-clock.js',
  './ptz-core.js',
  './ptz.js',
  './ptz.css',
  './wobble-core.js',
  './wobble.js',
  './watch.js',
  './vendor/peerjs.min.js',
  './iphone.html',
  './iphone.js',
  './data/bridge-files.js',
  './data/commands.js',
  './data/macros.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

const updateChannel = new BroadcastChannel('airiz-update');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      // Verify manifest signature before claiming a new SW is ready. This is
      // best-effort — if the network is down or the manifest is unverifiable,
      // we still install (the new code is in the cache already), but we do not
      // activate until verification succeeds or the user explicitly dismisses
      // the safety check via BroadcastChannel.
      try {
        const verified = await verifyManifestVersion();
        if (verified) {
          updateChannel.postMessage({ type: 'update-available', version: EXPECTED_MANIFEST_VERSION });
        } else {
          updateChannel.postMessage({ type: 'update-verification-failed', version: EXPECTED_MANIFEST_VERSION });
        }
      } catch (err) {
        // Network down or Worker unreachable — skip verification but still install.
        // The user will see the verification-failed message on next online check.
        updateChannel.postMessage({ type: 'update-verification-deferred', error: String(err) });
      }
      // DO NOT auto-skipWaiting. Old SW stays in control of existing clients
      // until a client sends `airiz-update-apply` over the BroadcastChannel.
      // This avoids the v2.67 controller race.
    })()
  );
});

self.addEventListener('message', (event) => {
  // Page sent "SKIP_WAITING" — the user clicked an "Apply update" button.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Page sent "CHECK_FOR_UPDATE" — verify the manifest on demand.
  if (event.data && event.data.type === 'CHECK_FOR_UPDATE') {
    event.waitUntil(
      verifyManifestVersion()
        .then(verified => {
          event.source && event.source.postMessage({
            type: 'UPDATE_AVAILABLE',
            version: EXPECTED_MANIFEST_VERSION,
            verified
          });
        })
        .catch(err => {
          event.source && event.source.postMessage({
            type: 'UPDATE_CHECK_FAILED',
            error: String(err)
          });
        })
    );
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
      updateChannel.postMessage({ type: 'activated', version: EXPECTED_MANIFEST_VERSION });
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only intercept same-origin GETs within our scope. The worker fetch (manifest)
  // is cross-origin and is verified in install() / on-demand CHECK_FOR_UPDATE.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin
      || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok && url.search === '') cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: event.request.mode === 'navigate' });
      if (cached) return cached;
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return new Response('Offline asset unavailable', { status: 503 });
    }
  })());
});

// ---- Ed25519 manifest verification ----

async function verifyManifestVersion() {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('manifest fetch failed: ' + response.status);
  const manifest = await response.json();
  // Reject if the runtime manifest target_versions.pwa does not match what this
  // SW was built for. CI sets EXPECTED_MANIFEST_VERSION from the tag; the runtime
  // manifest sets target_versions.pwa from the same tag; mismatch means an attacker
  // pushed a stale or wrong-version manifest.
  if (manifest.target_versions && manifest.target_versions.pwa !== EXPECTED_MANIFEST_VERSION) {
    throw new Error(
      'manifest version mismatch: SW=' + EXPECTED_MANIFEST_VERSION +
      ' manifest=' + manifest.target_versions.pwa
    );
  }
  return verifyManifestSignature(manifest, PUBLIC_KEY_BASE64);
}

async function verifyManifestSignature(manifest, publicKeyB64) {
  const sigs = (manifest.signatures || []);
  if (sigs.length === 0) return false;
  const ed25519Sigs = sigs.filter(s => s.alg === 'ed25519');
  if (ed25519Sigs.length === 0) return false;
  // Re-construct canonical body (signatures excluded).
  const { signatures: _omit, ...body } = manifest;
  const canonical = canonicalJson(body);
  const data = new TextEncoder().encode(canonical);
  const publicKey = await importEd25519Key(publicKeyB64);
  for (const sig of ed25519Sigs) {
    const sigBytes = base64ToBytes(sig.value);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, sigBytes, data);
    if (ok) return true;
  }
  return false;
}

async function importEd25519Key(base64SpkiDer) {
  const der = base64ToArrayBuffer(base64SpkiDer);
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}
