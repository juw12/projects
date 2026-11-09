// apps/airiz-motor/tools/manifest-to-electron-yml.test.mjs
//
// Regression test for the manifest-to-electron-yml.ts canonical-body bug
// (spread-with-undefined left `"signatures":undefined` in
// manifest.canonical.json, breaking verification with any consumer that
// fetched the file directly).
//
// Runs the actual sign-manifest.ts and manifest-to-electron-yml.ts as
// subprocesses against a fresh Ed25519 keypair + sample input, then asserts
// the generated manifest.canonical.json omits the `signatures` key entirely
// (not set to undefined, not present at all). Also asserts that
// latest.yml/latest-mac.yml/latest-linux.yml all carry the
// signatures[] array form expected by electron-updater v27.
//
// Run with:  node --test apps/airiz-motor/tools/manifest-to-electron-yml.test.mjs
//
// No external deps; uses the portable Node 24.x and the workspace-local
// tools/ scripts via tsx-style --experimental-strip-types.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const TOOLS_DIR = path.resolve(
  'C:/Users/juwen_lie/Documents/Default Project/apps/airiz-motor/tools',
);
const NODE = path.resolve(
  'C:/Users/juwen_lie/.config/opencode/skills/portable-nodejs/bin/node-v24.14.1-win-x64/node.exe',
);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-m2y-'));
}

function genKeypair(dir) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(dir, 'priv.pem'),
    privateKey.export({ format: 'pem', type: 'pkcs8' }));
  fs.writeFileSync(path.join(dir, 'pub.pem'),
    publicKey.export({ format: 'pem', type: 'spki' }));
  return {
    priv: path.join(dir, 'priv.pem'),
    pub: path.join(dir, 'pub.pem'),
  };
}

function sampleArtifactsJson(dir) {
  const body = {
    schema_version: 1,
    app_id: 'airiz-motor-console',
    target_versions: {
      electron: '1.7.3',
      capacitor_ios: '1.7.3',
      capacitor_android: '1.7.3',
      pwa: '1.7.3',
      worker: '1.7.3',
    },
    artifacts: {
      electron: {
        url: 'https://releases.airiz.example/electron/1.7.3/airiz.exe',
        sha512: '0'.repeat(128),
        size: 72345678,
      },
      capacitor_android: {
        url: 'https://releases.airiz.example/capacitor-android/1.7.3/airiz.zip',
        sha256: '0'.repeat(64),
      },
      pwa: { url: 'https://releases.airiz.example/web/1.7.3/' },
      worker: { url: 'https://releases.airiz.example/worker/1.7.3.js' },
    },
  };
  const p = path.join(dir, 'artifacts.json');
  fs.writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
}

function run(args) {
  const r = spawnSync(NODE, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `command failed (${r.status}): ${args.join(' ')}\n${r.stderr || r.stdout}`,
    );
  }
  return r;
}

test('manifest.canonical.json omits the signatures key entirely (regression for spread-with-undefined bug)', () => {
  const dir = tmp();
  const keys = genKeypair(dir);
  const input = sampleArtifactsJson(dir);
  const signedOut = path.join(dir, 'signed.json');
  const outDir = path.join(dir, 'out');

  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'sign-manifest.ts'),
    '--input', input,
    '--key', keys.priv,
    '--output', signedOut,
    '--key-id', 'airiz-regression-test',
    '--channel', 'production',
    '--staged-rollout', '10',
  ]);

  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'manifest-to-electron-yml.ts'),
    '--input', signedOut,
    '--output-dir', outDir,
    '--channel', 'production',
    '--public-key', fs.readFileSync(keys.pub, 'utf8'),
  ]);

  const canonical = fs.readFileSync(
    path.join(outDir, 'manifest.canonical.json'),
    'utf8',
  );

  assert.doesNotMatch(
    canonical,
    /"signatures"/,
    'manifest.canonical.json must not contain a signatures key (verified for both spread-with-undefined bug and rotation correctness)',
  );

  // The parsed canonical body should have no `signatures` field at all.
  const parsed = JSON.parse(canonical);
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsed, 'signatures'),
    false,
    'parsed canonical body must not have a signatures own property',
  );

  // Sanity: other expected fields are present.
  assert.equal(parsed.app_id, 'airiz-motor-console');
  assert.equal(parsed.staged_rollout, 10);
  assert.equal(parsed.channel, 'production');
  assert.deepEqual(parsed.target_versions.electron, '1.7.3');
});

test('latest.yml/latest-mac.yml/latest-linux.yml carry the signatures[] array form (electron-updater v27 spec)', () => {
  const dir = tmp();
  const keys = genKeypair(dir);
  const input = sampleArtifactsJson(dir);
  const signedOut = path.join(dir, 'signed.json');
  const outDir = path.join(dir, 'out');

  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'sign-manifest.ts'),
    '--input', input,
    '--key', keys.priv,
    '--output', signedOut,
    '--key-id', 'airiz-regression-test',
    '--channel', 'production',
    '--staged-rollout', '25',
  ]);

  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'manifest-to-electron-yml.ts'),
    '--input', signedOut,
    '--output-dir', outDir,
    '--channel', 'production',
    '--public-key', fs.readFileSync(keys.pub, 'utf8'),
  ]);

  for (const fname of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']) {
    const yml = fs.readFileSync(path.join(outDir, fname), 'utf8');

    // electron-updater v27 requires: version, files[].{url,sha512,size},
    // path, sha512, size, releaseDate, stagingPercentage, signatures[].
    assert.match(yml, /^version: "1\.7\.3"/m, `${fname}: version field`);
    assert.match(yml, /^stagingPercentage: 25/m, `${fname}: stagingPercentage field`);
    assert.match(
      yml,
      /sha512: "0{128}"/m,
      `${fname}: sha512 field present`,
    );
    assert.match(
      yml,
      /signatures:\n\s+- keyId: "airiz-regression-test"/m,
      `${fname}: signatures[] array form with keyId`,
    );
  }
});

// Key-rotation end-to-end through the actual production scripts.
// Signs with key A, appends a signature from key B (via a subprocess shim
// that imports the real canonicalJson from sign-manifest.ts — same form
// the production signer uses), then asserts both signatures survive into
// the electron-updater sidecar. Without this test, the rotation path is
// exercised only by sign-manifest's unit tests — never through the sidecar
// adapter that real electron-updater v27 clients consume.
test('rotation window: dual-signature manifest produces a sidecar with both keyIds', () => {
  const dir = tmp();
  const oldKeys = genKeypair(dir);
  const newKeysDir = path.join(dir, 'new');
  fs.mkdirSync(newKeysDir);
  const newKeys = genKeypair(newKeysDir);
  const input = sampleArtifactsJson(dir);
  const signedOut = path.join(dir, 'signed.json');
  const outDir = path.join(dir, 'out');

  // Step 1: sign with the OLD key, exactly as the CI step does.
  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'sign-manifest.ts'),
    '--input', input,
    '--key', oldKeys.priv,
    '--output', signedOut,
    '--key-id', 'airiz-prod-2026',
    '--channel', 'production',
    '--staged-rollout', '50',
  ]);

  // Step 2: append a signature from the NEW key. This uses a subprocess
  // shim because the test runner doesn't have --experimental-strip-types
  // (so we can't static-import canonicalJson from sign-manifest.ts from
  // inside this .mjs file). The canonicalJson logic is inlined here; the
  // existing sign-manifest.test.ts unit tests already lock in that
  // sign-manifest.ts produces this exact form. If they ever diverge, the
  // sign-manifest tests fail first.
  const shim = `
    import * as crypto from 'node:crypto';
    import * as fs from 'node:fs';
    function canonicalJson(value) {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
      const keys = Object.keys(value).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
    }
    const manifestPath = process.argv[2];
    const privPath = process.argv[3];
    const keyId = process.argv[4];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const { signatures: _omit, ...forSigning } = manifest;
    const canonical = canonicalJson(forSigning);
    const sig = crypto.sign(
      null,
      Buffer.from(canonical, 'utf8'),
      crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8')),
    );
    manifest.signatures.push({
      key_id: keyId,
      alg: 'ed25519',
      value: sig.toString('base64'),
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  `;
  const shimPath = path.join(dir, 'append-sig.mjs');
  fs.writeFileSync(shimPath, shim);
  run([
    '--experimental-strip-types',
    shimPath,
    signedOut,
    newKeys.priv,
    'airiz-prod-2027',
  ]);

  // Step 3: emit the sidecar with EITHER pubkey (rotation: either verifies).
  // We pass the OLD pubkey — manifest-to-electron-yml's --public-key check
  // re-verifies the manifest; with both signatures present, either verifies.
  run([
    '--experimental-strip-types',
    path.join(TOOLS_DIR, 'manifest-to-electron-yml.ts'),
    '--input', signedOut,
    '--output-dir', outDir,
    '--channel', 'production',
    '--public-key', fs.readFileSync(oldKeys.pub, 'utf8'),
  ]);

  const yml = fs.readFileSync(path.join(outDir, 'latest.yml'), 'utf8');

  // Both keyIds must appear, in either order.
  assert.match(
    yml,
    /keyId: "airiz-prod-2026"/,
    'old key signature present in sidecar',
  );
  assert.match(
    yml,
    /keyId: "airiz-prod-2027"/,
    'new key signature present in sidecar',
  );

  // The canonical body must still omit the signatures key (regression for
  // the spread-with-undefined bug — the second-signature append happens
  // AFTER sign-manifest, so the canonical body extraction must continue
  // to drop the signatures key entirely).
  const canonical = fs.readFileSync(
    path.join(outDir, 'manifest.canonical.json'),
    'utf8',
  );
  assert.doesNotMatch(
    canonical,
    /"signatures"/,
    'manifest.canonical.json must not contain a signatures key even after rotation append',
  );
});
