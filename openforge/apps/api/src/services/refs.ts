/**
 * Ref CAS service for the smart-HTTP receive-pack hot path.
 *
 * Contract:
 *
 *   1. withRepoLock opens a Postgres transaction and acquires the
 *      repo-level advisory lock (`pg_try_advisory_xact_lock(hashtext(
 *      $repoId::text))`). Non-blocking — throws RepoLockedError if
 *      another push is in flight.
 *   2. readRefs snapshots every `refs` row into memory. Caller is
 *      expected to hold the lock so the snapshot is consistent.
 *   3. updateRefs bumps `version`, sets the new SHA, records
 *      `updated_by_user_id`. WHERE version = current_version — the
 *      version column is the canonical CAS token (NOT the SHA).
 *   4. The advisory xact lock auto-releases on COMMIT (success) or
 *      ROLLBACK (any throw out of the callback, including
 *      RefConflictError).
 *
 * On CAS failure (bare repo diverged from DB), applyPostReceiveChanges
 * writes a critical-severity audit row and rethrows. The bare repo
 * state is now ahead of the DB; the Phase 2 reconciler will sweep.
 */
import { sql } from 'drizzle-orm';
import {
  acquireRepoLock,
  auditLog,
  db,
  RepoLockedError,
  type LockHandle,
  type Transaction,
} from '@openforge/db';
import { logger } from '../lib/logger.js';

/** Thrown when the optimistic version check fails under the lock. */
export class RefConflictError extends Error {
  readonly repoId: string;
  readonly refName: string;
  readonly expectedVersion: number;
  constructor(repoId: string, refName: string, expectedVersion: number) {
    super(
      `ref ${refName} in repo ${repoId} changed under us (expected version ${expectedVersion})`,
    );
    this.name = 'RefConflictError';
    this.repoId = repoId;
    this.refName = refName;
    this.expectedVersion = expectedVersion;
  }
}

export interface RefSnapshot {
  sha: string;
  version: number;
}

export interface RefUpdateInput {
  refName: string;
  newSha: string;
  userId: string;
}

export interface RefChangeLine {
  oldSha: string;
  newSha: string;
  refName: string;
}

/**
 * Run `fn` inside a Postgres transaction that holds the repo-level
 * advisory lock for the duration. Throws RepoLockedError if the lock
 * is already held.
 */
export async function withRepoLock<T>(
  repoId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const handle: LockHandle | null = await acquireRepoLock(tx, repoId);
    if (!handle) throw new RepoLockedError(repoId);
    return fn(tx);
  });
}

/**
 * Read every ref for a repo into memory. Caller is expected to hold
 * the repo advisory lock so the snapshot is consistent.
 */
export async function readRefs(
  tx: Transaction,
  repoId: string,
): Promise<Map<string, RefSnapshot>> {
  const rows = await tx.execute<{
    ref_name: string;
    sha: string;
    version: number;
  }>(sql`
    SELECT ref_name, sha, version
    FROM refs
    WHERE repo_id = ${repoId}::uuid
  `);
  const out = new Map<string, RefSnapshot>();
  for (const row of rows) {
    out.set(row.ref_name, { sha: row.sha, version: row.version });
  }
  return out;
}

/**
 * CAS update for one or more refs in a single transaction. For each
 * update, the SQL is INSERT … ON CONFLICT DO UPDATE WHERE
 * version = $expected — so the version column is the CAS token, NOT
 * any SHA comparison done in TypeScript.
 *
 * Under the repo advisory lock the expectedVersion we read is the
 * only possible value; a mismatch can only happen if a non-locked
 * code path touched the row. Defense in depth.
 */
export async function updateRefs(
  tx: Transaction,
  repoId: string,
  updates: RefUpdateInput[],
): Promise<void> {
  if (updates.length === 0) return;

  // Single SELECT for the whole repo's current versions. Under the
  // advisory lock the read is consistent.
  const current = await tx.execute<{ ref_name: string; version: number }>(sql`
    SELECT ref_name, version FROM refs WHERE repo_id = ${repoId}::uuid
  `);
  const versionByName = new Map<string, number>();
  for (const row of current) {
    versionByName.set(row.ref_name, row.version);
  }

  for (const update of updates) {
    const expectedVersion = versionByName.get(update.refName) ?? 0;

    const inserted = await tx.execute<{ version: number }>(sql`
      INSERT INTO refs (
        repo_id, ref_name, sha, version, updated_at, updated_by_user_id
      )
      VALUES (
        ${repoId}::uuid,
        ${update.refName},
        ${update.newSha},
        1,
        now(),
        ${update.userId}::uuid
      )
      ON CONFLICT (repo_id, ref_name) DO UPDATE
        SET sha = EXCLUDED.sha,
            version = refs.version + 1,
            updated_at = now(),
            updated_by_user_id = EXCLUDED.updated_by_user_id
        WHERE refs.version = ${expectedVersion}
      RETURNING version
    `);

    if (inserted.length === 0) {
      // CAS failed. Under the lock this can only mean a non-locked
      // code path touched the row, or our expectedVersion is stale
      // because the same push raced itself (e.g. same ref listed twice
      // in the status report).
      throw new RefConflictError(repoId, update.refName, expectedVersion);
    }
  }
}

/**
 * High-level entry point for the receive-pack route:
 *
 *   1. Acquire the repo-level advisory lock.
 *   2. Inside the lock, CAS-update the refs from git's status report.
 *   3. Commit (lock releases).
 *
 * Throws:
 *   - RepoLockedError — another push in flight; caller returns 409.
 *   - RefConflictError — bare repo and DB diverged; caller logs a
 *                        critical audit row and returns 500.
 *
 * `changes` is the parsed post-receive status report. We ignore
 * `oldSha` (the version column is the CAS token; SHA matching happens
 * in SQL via WHERE version = $expectedVersion).
 */
export async function applyPostReceiveChanges(
  repoId: string,
  userId: string,
  changes: RefChangeLine[],
): Promise<void> {
  if (changes.length === 0) return;

  await withRepoLock(repoId, async (tx) => {
    try {
      await updateRefs(
        tx,
        repoId,
        changes.map((c) => ({ refName: c.refName, newSha: c.newSha, userId })),
      );
    } catch (e) {
      if (e instanceof RefConflictError) {
        await logRefDivergence(repoId, userId, e).catch((logErr) => {
          logger.error(
            { err: logErr, repoId, refName: e.refName },
            '[refs] failed to write divergence audit row',
          );
        });
      }
      throw e;
    }
  });
}

/**
 * Best-effort write to audit_log for the "bare repo diverged from DB"
 * event. Never throws — we don't want to mask the original error.
 */
async function logRefDivergence(
  repoId: string,
  userId: string,
  e: RefConflictError,
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: userId,
    action: 'ref.cas.divergence',
    targetType: 'repo',
    targetId: repoId,
    metadata: {
      refName: e.refName,
      expectedVersion: e.expectedVersion,
      severity: 'critical',
      message:
        'git receive-pack succeeded but CAS update failed; bare repo and DB may have diverged',
    },
  });
}
