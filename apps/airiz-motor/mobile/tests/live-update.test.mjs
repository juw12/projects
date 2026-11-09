import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {
  canonicalJson,
  verifyManifestSignature,
  targetVersionForPlatform,
  bundleArtifactForPlatform,
} from '../src/live-update.mjs';

function ed25519Keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const pubSpkiDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privPem,
    pubB64: Buffer.from(pubSpkiDer).toString('base64'),
  };
}

function signManifestEd25519(body, privPem) {
  const { signatures: _omit, ...forSigning } = body;
  const canonical = canonicalJson(forSigning);
  const sigBytes = crypto.sign(null, Buffer.from(canonical, 'utf8'), crypto.createPrivateKey(privPem));
  return {
    ...body,
    signatures: [{ key_id: 'test-key', alg: 'ed25519', value: sigBytes.toString('base64') }],
  };
}

function sampleManifest(overrides = {}) {
  return {
    schema_version: 1,
    app_id: 'airiz-motor-console',
    channel: 'production',
    released_at: '2026-11-05T00:00:00Z',
    staged_rollout: 100,
    target_versions: {
      electron: '1.7.3',
      capacitor_ios: '1.7.3',
      capacitor_android: '1.7.3',
      pwa: '1.7.3',
      worker: '1.7.3',
    },
    artifacts: {
      capacitor_ios: { url: 'https://releases.airiz.example/capacitor-ios/1.7.3/airiz.zip' },
      capacitor_android: { url: 'https://releases.airiz.example/capacitor-android/1.7.3/airiz.zip' },
    },
    ...overrides,
  };
}

test('canonicalJson sorts keys deterministically (matches the Node signer)', () => {
  const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
  const b = canonicalJson({ c: { x: 2, y: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":{"x":2,"y":1}}');
});

test('verifyManifestSignature accepts a Node-signed manifest', async () => {
  const { privPem, pubB64 } = ed25519Keypair();
  const body = sampleManifest();
  const signed = signManifestEd25519(body, privPem);
  assert.equal(await verifyManifestSignature(signed, pubB64), true);
});

test('verifyManifestSignature rejects a manifest signed with a different key', async () => {
  const signer = ed25519Keypair();
  const wrong = ed25519Keypair();
  const signed = signManifestEd25519(sampleManifest(), signer.privPem);
  assert.equal(await verifyManifestSignature(signed, wrong.pubB64), false);
});

test('verifyManifestSignature rejects a tampered manifest', async () => {
  const { privPem, pubB64 } = ed25519Keypair();
  const signed = signManifestEd25519(sampleManifest(), privPem);
  signed.staged_rollout = 0;
  assert.equal(await verifyManifestSignature(signed, pubB64), false);
});

test('verifyManifestSignature accepts dual-signature manifests (rotation window)', async () => {
  const oldKey = ed25519Keypair();
  const newKey = ed25519Keypair();
  const body = sampleManifest();
  const signed = signManifestEd25519(body, oldKey.privPem);
  const { signatures: _omit, ...forSigning } = signed;
  const canonical = canonicalJson(forSigning);
  const newSigBytes = crypto.sign(
    null,
    Buffer.from(canonical, 'utf8'),
    crypto.createPrivateKey(newKey.privPem),
  );
  signed.signatures.push({
    key_id: 'test-key-new',
    alg: 'ed25519',
    value: newSigBytes.toString('base64'),
  });
  assert.equal(await verifyManifestSignature(signed, oldKey.pubB64), true);
  assert.equal(await verifyManifestSignature(signed, newKey.pubB64), true);
});

test('verifyManifestSignature returns false for missing signatures[]', async () => {
  const { pubB64 } = ed25519Keypair();
  assert.equal(await verifyManifestSignature(sampleManifest(), pubB64), false);
});

test('targetVersionForPlatform picks the right field per platform', () => {
  const m = sampleManifest();
  assert.equal(targetVersionForPlatform(m, 'ios'), '1.7.3');
  assert.equal(targetVersionForPlatform(m, 'android'), '1.7.3');
  assert.equal(targetVersionForPlatform({ ...m, target_versions: {} }, 'ios'), undefined);
});

test('bundleArtifactForPlatform picks the right artifact per platform', () => {
  const m = sampleManifest();
  assert.equal(bundleArtifactForPlatform(m, 'ios').url, m.artifacts.capacitor_ios.url);
  assert.equal(bundleArtifactForPlatform(m, 'android').url, m.artifacts.capacitor_android.url);
  assert.equal(bundleArtifactForPlatform({ ...m, artifacts: {} }, 'ios'), undefined);
});
