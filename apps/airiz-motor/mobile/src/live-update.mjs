// apps/airiz-motor/mobile/src/live-update.mjs
//
// AIRIZ Motor Console — custom Capacitor live-update with Ed25519.
//
// The unified release architecture (apps/airiz-motor/tools/sign-manifest.ts +
// apps/airiz-motor/release-relay/src/index.ts + apps/airiz-motor/web/sw.js)
// uses Ed25519 across all 5 surfaces. @capawesome/capacitor-live-update v8.x
// hard-requires PEM-encoded RSA for its built-in `publicKey` field — there is
// no Ed25519 option in v8 — so we keep the Capawesome plugin only for its
// state-management primitives (channel, rollback, setNextBundle) and verify
// signatures ourselves here.
//
// CI substitution (mirroring desktop/app-update.yml and web/sw.js):
//   PUBLIC_KEY_BASE64 below is rewritten to the production key SPKI DER.
//
// Capacitor plugins are lazy-imported so this module can be loaded (and its
// pure functions tested) in environments without the native plugin set
// installed — e.g. `node --test` on a host that has not run `npm ci`.

export const MANIFEST_URL = 'https://releases.airiz.example/production/manifest.json';

export const PUBLIC_KEY_BASE64 =
  'MCowBQYDK2VwAyEAWq4SVP+UEdh8pLMSzLNRGanSnyzEzerO0xryCkdm5bI=';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < buf.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function importEd25519Key(base64SpkiDer) {
  return crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(base64SpkiDer),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

export async function verifyManifestSignature(manifest, publicKeyB64) {
  const sigs = (manifest.signatures || []).filter((s) => s.alg === 'ed25519');
  if (sigs.length === 0) return false;
  const { signatures: _omit, ...body } = manifest;
  const canonical = canonicalJson(body);
  const data = new TextEncoder().encode(canonical);
  const publicKey = await importEd25519Key(publicKeyB64);
  for (const sig of sigs) {
    const sigBytes = base64ToArrayBuffer(sig.value);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, sigBytes, data);
    if (ok) return true;
  }
  return false;
}

export async function fetchManifest(url = MANIFEST_URL, fetcher = fetch) {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('manifest fetch failed: ' + response.status);
  return response.json();
}

export function targetVersionForPlatform(manifest, platform) {
  const versions = manifest.target_versions || {};
  return platform === 'ios' ? versions.capacitor_ios : versions.capacitor_android;
}

export function bundleArtifactForPlatform(manifest, platform) {
  const artifacts = manifest.artifacts || {};
  return platform === 'ios' ? artifacts.capacitor_ios : artifacts.capacitor_android;
}

async function loadCapacitorCore() {
  return import('@capacitor/core');
}

async function loadFilesystem() {
  return import('@capacitor/filesystem');
}

async function loadAppPlugin() {
  return import('@capacitor/app');
}

export async function currentAppVersion() {
  try {
    const { App } = await loadAppPlugin();
    const info = await App.getInfo();
    return info.version;
  } catch {
    return '';
  }
}

export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const defaultFileWriter = async (path, data) => {
  const { Filesystem, Directory } = await loadFilesystem();
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Data,
    recursive: true,
  });
};

export async function checkAndStageUpdate({
  url = MANIFEST_URL,
  publicKeyB64 = PUBLIC_KEY_BASE64,
  fetcher = fetch,
  fileWriter = defaultFileWriter,
  appVersionProvider = currentAppVersion,
} = {}) {
  const { Capacitor } = await loadCapacitorCore();
  if (!Capacitor.isNativePlatform()) {
    return { status: 'skipped', reason: 'not-native' };
  }
  const platform = Capacitor.getPlatform();
  const manifest = await fetchManifest(url, fetcher);
  if (!(await verifyManifestSignature(manifest, publicKeyB64))) {
    return { status: 'signature-invalid' };
  }
  const target = targetVersionForPlatform(manifest, platform);
  if (!target) return { status: 'no-target-version', platform };
  const current = await appVersionProvider();
  if (target === current) return { status: 'up-to-date', target };
  const artifact = bundleArtifactForPlatform(manifest, platform);
  if (!artifact?.url) return { status: 'no-artifact', platform };
  const response = await fetcher(artifact.url, { cache: 'no-store' });
  if (!response.ok) return { status: 'download-failed', statusCode: response.status };
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  const bundleId = platform + '-' + target;
  await fileWriter('live-update/' + bundleId + '.zip', base64);
  return { status: 'staged', bundleId, version: target, artifactUrl: artifact.url };
}
