// SPDX-License-Identifier: MIT
//
// Runner authentication: SHA-256-hash lookup against the
// runner_registration_tokens table. The plaintext bearer token is
// NEVER stored (cf. CircleCI Dec 2022 — stolen plaintext tokens were
// the root cause of that breach).
//
// Issuance (handled elsewhere in apps/api, e.g. a future
// routes/runner-register.ts):
//   1. Server generates 256 bits of random data
//   2. Server computes SHA-256(token) and stores it + a short prefix
//      in runner_registration_tokens
//   3. Server returns the plaintext token to the admin ONE TIME —
//      after that, only the hash exists on the server
//
// Authentication (this module):
//   1. Runner sends `Authorization: Bearer <plaintext>`
//   2. We hash the plaintext with SHA-256
//   3. We look up the hash in runner_registration_tokens
//   4. If found and not expired, return the runner
//   5. Otherwise return null (caller returns 401)
//
// All comparisons are constant-time where possible.

import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@openforge/db'
import { runners, runnerRegistrationTokens } from '@openforge/db'

export interface AuthenticatedRunner {
  id: string
  name: string
  /** SHA-256 hash of the bearer; useful for logging or token-rotation reminders */
  tokenHash: string
}

/**
 * Constant-time bearer comparison. The lookup itself goes through an
 * indexed equality on the hash column (so timing is dominated by the DB
 * lookup, not the hash comparison).
 */
export async function authenticateRunnerByBearer(
  plaintextBearer: string,
): Promise<AuthenticatedRunner | null> {
  if (!plaintextBearer || plaintextBearer.length < 8) {
    // Short-circuit obviously-empty or too-short tokens without a DB hit.
    return null
  }

  const hash = sha256Hex(plaintextBearer)

  // Single round-trip: join runner_registration_tokens → runners so we
  // return the runner metadata in one query. The `expires_at IS NULL OR
  // expires_at > now()` predicate excludes expired tokens.
  const rows = await db
    .select({
      runnerId: runners.id,
      runnerName: runners.name,
      tokenHash: runnerRegistrationTokens.tokenHash,
    })
    .from(runnerRegistrationTokens)
    .innerJoin(runners, eq(runnerRegistrationTokens.runnerId, runners.id))
    .where(eq(runnerRegistrationTokens.tokenHash, hash))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // Constant-time hash comparison (defense in depth — DB lookup should
  // already be O(log n), but timing-safe is cheap and removes a class of
  // timing side-channel attacks against the auth path).
  const expected = Buffer.from(row.tokenHash, 'hex')
  const provided = Buffer.from(hash, 'hex')
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null
  }

  // Expiry check — a token with expires_at in the past must not work
  // even if its hash matches.
  // Note: a row that has expires_at NULL is treated as "no expiry" (the
  // common case for long-lived runner tokens).
  // We fetch expires_at again separately to keep this function's
  // signature minimal — for high-volume traffic, fold this into the
  // join above as a `and(expiresAtIsNullOrFuture)` predicate.
  const expiresRows = await db
    .select({ expiresAt: runnerRegistrationTokens.expiresAt })
    .from(runnerRegistrationTokens)
    .where(eq(runnerRegistrationTokens.tokenHash, hash))
    .limit(1)
  const expires = expiresRows[0]?.expiresAt
  if (expires && expires.getTime() <= Date.now()) {
    return null
  }

  return {
    id: row.runnerId,
    name: row.runnerName,
    tokenHash: row.tokenHash,
  }
}

/** Compute SHA-256 of a string, returning lowercase hex (64 chars). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Extract the bearer token from an Authorization header value. */
export function extractBearer(authHeader: string | undefined | null): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null
  return trimmed.slice('bearer '.length).trim() || null
}
