// TOTP — RFC 6238. The shared secret is generated once at enrollment, then
// stored on `users.totpSecretEnc` (bytea) encrypted with AES-256-GCM via
// ./crypto.ts. Drift window ±1 step (±30 s) — balances UX tolerance against
// replay risk.

import speakeasy from 'speakeasy';
import { encrypt, decrypt } from './crypto.js';

export interface TotpSecret {
  ascii: string;
  otpauthUrl: string;
  qrCodeDataUrl?: string;
}

export function generateTotpSecret(userEmail: string, issuer = 'OpenForge'): TotpSecret {
  const secret = speakeasy.generateSecret({
    name: `${issuer} (${userEmail})`,
    length: 20,
  });
  if (!secret.otpauth_url) {
    throw new Error('speakeasy.generateSecret returned no otpauth_url');
  }
  return {
    ascii: secret.ascii,
    otpauthUrl: secret.otpauth_url,
  };
}

export function verifyTotp(secretAscii: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret: secretAscii,
    encoding: 'ascii',
    token,
    window: 1, // accept ±30 s drift
  });
}

// Encrypts a TOTP seed for storage in `users.totp_secret_enc`. Layout:
//   iv (12) || authTag (16) || ciphertext — see ./crypto.ts.
export function encryptedTotpSecret(secretAscii: string): Buffer {
  return encrypt(Buffer.from(secretAscii, 'ascii'));
}

export function decryptTotpSecret(blob: Buffer): string {
  return decrypt(blob).toString('ascii');
}
