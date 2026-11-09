// OpenSSH public-key parsing via ssh2.
//
// Two responsibilities:
//   1. Validate the key is well-formed (ssh2 throws on malformed input).
//   2. Compute the SHA-256 fingerprint in the format `ssh-keygen -lf` prints:
//        SHA256:<base64-of-SHA256(key-blob)>
//      where `key-blob` is the base64-decoded middle field of the OpenSSH
//      wire format `<algorithm> <base64-blob> [comment]`. We parse the wire
//      format directly rather than depending on ssh2 internals — ssh2 may
//      return either a single Key or an array of Keys (modern OpenSSH), and
//      its `ParsedKey` type (per @types/ssh2) does not document a `data`
//      field, so going through the wire format is simpler and more
//      forward-compatible.

import ssh2 from 'ssh2';
import crypto from 'node:crypto';

const { parseKey } = ssh2.utils;

export interface ParsedSshKey {
  publicKeyOpenSsh: string; // original wire format, stored verbatim
  algorithm: string; // e.g. 'ssh-rsa', 'ssh-ed25519'
  fingerprintSha256: string; // 'SHA256:base64'
}

export function parseSshKey(publicKey: string): ParsedSshKey {
  // ssh2 throws on malformed input — propagates as a clear rejection.
  const result = parseKey(publicKey);
  // Modern OpenSSH keys can return an array; older single-key formats return
  // a single object. Normalise to "first key".
  const parsed = Array.isArray(result) ? result[0] : result;
  if (!parsed) {
    throw new Error('ssh2.utils.parseKey returned no keys');
  }

  // Pull the binary blob straight from the wire format. This is what
  // `ssh-keygen -lf` does and what GitHub's UI shows — matching it exactly
  // is the whole point of storing a fingerprint users can verify visually.
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error('SSH public key must be in `<algorithm> <base64> [comment]` form');
  }
  const blob = Buffer.from(parts[1], 'base64');
  if (blob.length === 0) {
    throw new Error('SSH public key base64 blob is empty or malformed');
  }
  const b64 = crypto
    .createHash('sha256')
    .update(blob)
    .digest('base64')
    .replace(/=+$/, '');

  // Cross-check the wire-format algorithm against what ssh2 recognised.
  // Disagreement means the key is corrupt — reject loudly.
  const wireAlgorithm = parts[0];
  const parsedType = (parsed as { type?: string }).type;
  if (parsedType && parsedType !== wireAlgorithm) {
    throw new Error(
      `SSH key algorithm mismatch: wire="${wireAlgorithm}" parsed="${parsedType}"`,
    );
  }

  return {
    publicKeyOpenSsh: publicKey,
    algorithm: wireAlgorithm,
    fingerprintSha256: `SHA256:${b64}`,
  };
}
