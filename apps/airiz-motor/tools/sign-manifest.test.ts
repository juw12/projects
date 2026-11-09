// apps/airiz-motor/tools/sign-manifest.test.ts
//
// Smoke test for the unified release manifest signer.
//
// Run with:  node --experimental-strip-types --test tools/sign-manifest.test.ts
//
// Verifies:
//   1. Ed25519 keypair generation produces a valid pair.
//   2. canonicalJson is deterministic (sorted keys, no whitespace).
//   3. signManifest → verifyManifest round-trips.
//   4. Tampering with any signed field invalidates the signature.
//   5. The public-key round-trip works (derive pub from priv, verify).

import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";

import { canonicalJson, signManifest, verifyManifest } from "./sign-manifest.ts";

function newKey(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    publicPem: publicKey.export({ format: "pem", type: "spki" }) as string,
  };
}

function sampleBody() {
  return {
    schema_version: 1,
    app_id: "airiz-motor-console",
    channel: "production",
    released_at: "2026-11-04T00:00:00Z",
    staged_rollout: 100,
    target_versions: {
      electron: "1.7.3",
      capacitor_ios: "1.7.3",
      capacitor_android: "1.7.3",
      pwa: "1.7.3",
      worker: "1.7.3",
    },
    artifacts: {
      electron: {
        url: "https://releases.airiz.example/airiz-1.7.3.exe",
        sha512: "0".repeat(128),
        size: 72345678,
      },
      pwa: { url: "https://releases.airiz.example/web/1.7.3/" },
    },
  };
}

test("canonicalJson sorts keys deterministically", () => {
  const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
  const b = canonicalJson({ c: { x: 2, y: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, `{"a":2,"b":1,"c":{"x":2,"y":1}}`);
});

test("canonicalJson preserves array order", () => {
  const arr = canonicalJson({ z: [3, 1, 2] });
  assert.equal(arr, `{"z":[3,1,2]}`);
});

test("sign/verify round-trip succeeds", () => {
  const { privatePem, publicPem } = newKey();
  const body: Record<string, unknown> = sampleBody();
  signManifest(body, privatePem, "test-key-1");
  assert.ok(Array.isArray(body.signatures));
  assert.equal(verifyManifest(body, publicPem), true);
});

test("signing is deterministic for the same key + body", () => {
  // Ed25519 signatures are deterministic (no RFC 6979-style nonce randomness
  // visible to callers). Same key + same body → same signature.
  const { privatePem, publicPem } = newKey();
  const a: Record<string, unknown> = sampleBody();
  const b: Record<string, unknown> = sampleBody();
  signManifest(a, privatePem, "k");
  signManifest(b, privatePem, "k");
  assert.equal(
    (a.signatures as Array<{ value: string }>)[0].value,
    (b.signatures as Array<{ value: string }>)[0].value,
  );
  assert.equal(verifyManifest(a, publicPem), true);
  assert.equal(verifyManifest(b, publicPem), true);
});

test("tampering with a signed field invalidates the signature", () => {
  const { privatePem, publicPem } = newKey();
  const body: Record<string, unknown> = sampleBody();
  signManifest(body, privatePem, "k");
  // Now mutate the body.
  body.staged_rollout = 0;
  assert.equal(verifyManifest(body, publicPem), false);
});

test("tampering with a nested artifact field invalidates the signature", () => {
  const { privatePem, publicPem } = newKey();
  const body: Record<string, unknown> = sampleBody();
  signManifest(body, privatePem, "k");
  (body.artifacts as Record<string, unknown>).electron = {
    url: "https://attacker.example/malware.exe",
    sha512: "f".repeat(128),
    size: 99999,
  };
  assert.equal(verifyManifest(body, publicPem), false);
});

test("wrong key fails verification", () => {
  const a = newKey();
  const b = newKey();
  const body: Record<string, unknown> = sampleBody();
  signManifest(body, a.privatePem, "a");
  assert.equal(verifyManifest(body, b.publicPem), false);
});

test("signature field is excluded from the signed payload", () => {
  const { privatePem, publicPem } = newKey();
  const body: Record<string, unknown> = sampleBody();
  // Capture the canonical form BEFORE signing.
  const preSignCanonical = canonicalJson(body);
  signManifest(body, privatePem, "k");
  // Capture the canonical form AFTER signing (signatures[] should be absent).
  const postSignCanonical = canonicalJson(body);
  assert.notEqual(preSignCanonical, postSignCanonical);
  assert.ok(postSignCanonical.includes('"signatures"'));
  // The signed payload is `body` minus the `signatures` key.
  // Sanity check: re-signing an identical pre-sign body yields the same sig.
  const replay: Record<string, unknown> = JSON.parse(preSignCanonical);
  signManifest(replay, privatePem, "k");
  assert.equal(
    (body.signatures as Array<{ value: string }>)[0].value,
    (replay.signatures as Array<{ value: string }>)[0].value,
  );
  assert.equal(verifyManifest(body, publicPem), true);
});

test("missing signatures[] fails verification", () => {
  const { publicPem } = newKey();
  const body: Record<string, unknown> = sampleBody();
  // No signatures[] → verify returns false.
  assert.equal(verifyManifest(body, publicPem), false);
});

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------
//
// During a rotation window the CI signs each release with BOTH the old key
// (so existing installs that haven't yet pulled the new pubkey keep updating)
// and the new key (so freshly-deployed installs update immediately). The
// verifier must accept whichever signature matches its pubkey; the order of
// signatures[] is therefore not significant.

test("rotation window: dual-signature manifest verifies against either pubkey", () => {
  const oldKey = newKey();
  const newKeyPair = newKey();
  const body: Record<string, unknown> = sampleBody();

  signManifest(body, oldKey.privatePem, "airiz-prod-2025");
  // Destructuring-omit removes the `signatures` key entirely (unlike
  // `{ ...body, signatures: undefined }`, which keeps the key with value
  // undefined and lets canonicalJson emit `"signatures":undefined`).
  const { signatures: _omit, ...bodyForSigning } = body;
  const canonical = canonicalJson(bodyForSigning);

  const newSigBytes = crypto.sign(
    null,
    Buffer.from(canonical, "utf8"),
    crypto.createPrivateKey(newKeyPair.privatePem),
  );
  (body.signatures as Array<unknown>).push({
    key_id: "airiz-prod-2026",
    alg: "ed25519",
    value: newSigBytes.toString("base64"),
  });

  assert.equal(
    verifyManifest(body, oldKey.publicPem),
    true,
    "rotation window: old pubkey must verify the dual-signed manifest",
  );
  assert.equal(
    verifyManifest(body, newKeyPair.publicPem),
    true,
    "rotation window: new pubkey must verify the dual-signed manifest",
  );
});

test("post-rotation: new-only signature rejects the old pubkey", () => {
  const oldKey = newKey();
  const newKeyPair = newKey();
  const body: Record<string, unknown> = sampleBody();

  signManifest(body, newKeyPair.privatePem, "airiz-prod-2026");

  assert.equal(
    verifyManifest(body, oldKey.publicPem),
    false,
    "post-rotation: an old-only client must NOT accept a new-only-signed manifest",
  );
  assert.equal(
    verifyManifest(body, newKeyPair.publicPem),
    true,
    "post-rotation: new pubkey verifies the new-only-signed manifest",
  );
});

test("rotation preserves the signed-payload byte-for-byte across both keys", () => {
  const oldKey = newKey();
  const newKeyPair = newKey();
  const body: Record<string, unknown> = sampleBody();
  const preSignCanonical = canonicalJson(body);

  signManifest(body, oldKey.privatePem, "k1");
  const { signatures: _omit1, ...bodyWithoutSigs1 } = body;
  assert.equal(canonicalJson(bodyWithoutSigs1), preSignCanonical);

  const newSigBytes = crypto.sign(
    null,
    Buffer.from(preSignCanonical, "utf8"),
    crypto.createPrivateKey(newKeyPair.privatePem),
  );
  (body.signatures as Array<unknown>).push({
    key_id: "k2",
    alg: "ed25519",
    value: newSigBytes.toString("base64"),
  });

  const { signatures: _omit2, ...bodyWithoutSigs2 } = body;
  assert.equal(
    canonicalJson(bodyWithoutSigs2),
    preSignCanonical,
    "adding a second signature must not mutate the canonical payload",
  );
});
