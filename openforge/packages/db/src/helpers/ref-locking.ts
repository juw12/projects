/**
 * Advisory locks for atomic ref updates (smart-HTTP push hot path).
 *
 * Two granularities:
 *
 *  - acquireRefLock(db, repoId, refName) — fine-grained per-(repo,ref).
 *    Used for individual ref mutations outside the receive-pack hot
 *    path (e.g. admin "reset branch" buttons).
 *
 *  - acquireRepoLock(tx, repoId) — repo-level. Used by the receive-pack
 *    handler so all pushes to the same repo serialize. Cheaper than
 *    per-ref locks (one Postgres round-trip) and matches Gitea's
 *    pattern; we always read every ref into memory before git runs
 *    anyway, so the coarse lock costs nothing.
 *
 * Both call pg_try_advisory_xact_lock — non-blocking and transaction-
 * scoped. The lock auto-releases on COMMIT/ROLLBACK and never leaks
 * if a worker dies.
 *
 * The lock key is hashtext($1), a 32-bit Postgres-internal hash. Plenty
 * unique for our use; collisions are tolerable (worst case: two
 * unrelated repos share a lock and serialize needlessly, but each still
 * progresses).
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import type { PgTransaction } from 'drizzle-orm/pg-core';

/**
 * Postgres transaction handle exposed by Drizzle's db.transaction()
 * callback. The Database type widens the schema; we accept the broader
 * one here so callers don't need to thread the full schema type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Transaction = PgTransaction<any, any, any>;

export class RepoLockedError extends Error {
  readonly repoId: string;
  constructor(repoId: string) {
    super(`repository ${repoId} is locked by another push in flight`);
    this.name = 'RepoLockedError';
    this.repoId = repoId;
  }
}

/**
 * Handle returned by acquireRepoLock. dispose() forces the surrounding
 * transaction to roll back (which releases the xact-scoped advisory
 * lock). Idempotent and safe to call from a finally block.
 *
 * Implementation note: pg_try_advisory_xact_lock acquires a transaction-
 * scoped lock that auto-releases on COMMIT or ROLLBACK. dispose()
 * therefore throws a LockDisposedSignal sentinel; the surrounding
 * db.transaction() callback catches the throw and issues ROLLBACK,
 * which releases the lock. Callers who want to commit must NOT call
 * dispose.
 */
export interface LockHandle {
  dispose(): Promise<void>;
}

export class LockDisposedSignal extends Error {
  constructor() {
    super('lock disposed by handle');
    this.name = 'LockDisposedSignal';
  }
}

export async function acquireRepoLock(
  tx: Transaction,
  repoId: string,
): Promise<LockHandle | null> {
  const rows = await tx.execute<{ ok: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtext(${repoId}::text)) AS ok
  `);
  if (rows[0]?.ok !== true) return null;
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      throw new LockDisposedSignal();
    },
  };
}

/**
 * Per-(repo, ref) lock. Retained for callers that need fine-grained
 * serialization outside the receive-pack hot path.
 */
export async function acquireRefLock(
  db: Database | Transaction,
  repoId: string,
  refName: string,
): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtext(${`${repoId}::text||${refName}`})) AS ok
  `);
  return rows[0]?.ok ?? false;
}

export async function releaseRefLock(
  db: Database | Transaction,
  repoId: string,
  refName: string,
): Promise<void> {
  // Advisory session locks released with pg_advisory_unlock; xact locks
  // auto-release, so this is only useful for explicit early release.
  await db.execute(
    sql`SELECT pg_advisory_unlock(hashtext(${`${repoId}::text||${refName}`}))`,
  );
}
