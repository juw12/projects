// Personal Access Tokens — the `of_pat_…` kind used for `git push` over HTTPS
// and the API.
//
// `issuePat()` returns the raw token exactly once. Callers must hand `raw`
// back to the user and persist `hash` + `prefix` only. On every subsequent
// authentication, compare the SHA-256 of the inbound token against `token_hash`
// in the `personal_access_tokens` table.

import crypto from 'node:crypto';

const PREFIX = 'of_pat_';

export interface IssuedPat {
  raw: string; // shown to user ONCE; never persisted
  hash: string; // sha256(raw), stored in personal_access_tokens.token_hash
  prefix: string; // first 12 chars of raw, for display ("of_pat_a1b2…")
}

export function issuePat(scopes: string[] = []): IssuedPat {
  void scopes; // reserved for future scope-tagged tokens; intentionally unused today.
  const random = crypto.randomBytes(32).toString('base64url');
  const raw = `${PREFIX}${random}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

export function hashPat(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
