// Argon2id with OWASP 2024 minimum params (memoryCost 19 MiB, timeCost 2,
// parallelism 1). The `password` field on the user table is text; we hand the
// hash off to Better Auth via `emailAndPassword.password.hash`.

import argon2 from 'argon2';

const opts = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP 2024 minimum
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, opts);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed stored hash — treat as auth failure rather than 500.
    return false;
  }
}
