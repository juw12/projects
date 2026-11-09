// AES-256-GCM helpers for encrypting secrets at rest (TOTP seeds primarily).
// Layout of the ciphertext blob:
//   iv (12 bytes) || authTag (16 bytes) || ciphertext
//
// The key is loaded once at module init from SECRET_ENCRYPTION_KEY, which
// must be 32 bytes of random material expressed as 64 hex characters. Generate
// with: `openssl rand -hex 32`. Store alongside the database credential in
// your secret manager (Vault / AWS Secrets Manager / Doppler / etc.).

import crypto from 'node:crypto';

const KEY = (() => {
  const raw = process.env['SECRET_ENCRYPTION_KEY'];
  if (!raw || raw.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(raw, 'hex');
})();

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decrypt(blob: Buffer): Buffer {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('ciphertext blob too short to contain iv + tag');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
