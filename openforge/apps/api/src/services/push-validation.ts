/**
 * Orchestrates the full push validation flow:
 *   1. Diff post-receive git state against pre-push DB snapshot.
 *   2. CAS-update every ref the push actually moved.
 *   3. Log critical incidents for conflicts (git advanced, DB did not).
 *
 * This is the only place where the pre-snapshot from the route layer
 * meets the live git state and gets folded back into Postgres. It exists
 * as a separate service so it can be unit-tested without spinning up Hono.
 *
 * The HTTP response is already on the wire by the time we get here —
 * `postReceivePack` has streamed git's status report back to the client
 * before `await wait` resolves. So we cannot "reject the push" after the
 * fact. Conflicts become audit incidents that the Phase 2 reconciliation
 * job (memo Risk #2) will replay.
 */
import { casUpdateRefs, type RefSnapshot, type RefUpdate } from './refs.js';
import { readRefsFromGit } from './git-ref-readback.js';
import { logger } from '../lib/logger.js';
import type { Database } from '@openforge/db';

export type PushValidationResult =
  | { ok: true; updatedRefs: RefSnapshot[] }
  | {
      ok: false;
      reason: 'git_readback_failed' | 'cas_conflict';
      conflictingRef?: string;
      details?: string;
    };

export async function validateAndCommitPush(
  db: Database,
  repoDir: string,
  repoId: string,
  preSnapshot: ReadonlyMap<string, RefSnapshot>,
  actorUserId: string | null,
): Promise<PushValidationResult> {
  let postRefs;
  try {
    postRefs = await readRefsFromGit(repoDir);
  } catch (err) {
    logger.error(
      { err, repoId, repoDir },
      '[push-validation] failed to read refs back from git',
    );
    return { ok: false, reason: 'git_readback_failed', details: String(err) };
  }

  const updates: RefUpdate[] = [];
  for (const ref of postRefs) {
    const before = preSnapshot.get(ref.refName);
    const previousSha = before?.sha ?? null;
    const expectedVersion = before?.version ?? 0;
    if (previousSha === ref.sha) continue;
    updates.push({
      refName: ref.refName,
      newSha: ref.sha,
      expectedVersion,
    });
  }

  if (updates.length === 0) {
    return { ok: true, updatedRefs: [] };
  }

  const cas = await casUpdateRefs(db, repoId, updates, actorUserId ?? undefined);
  if (!cas.ok) {
    logger.error(
      {
        repoId,
        conflict: cas.conflict,
        gitRefsAdvanced: updates.map((u) => u.refName),
      },
      '[push-validation] CRITICAL: git state advanced but DB CAS failed — manual reconciliation required (Phase 2)',
    );
    return {
      ok: false,
      reason: 'cas_conflict',
      conflictingRef: cas.conflict.refName,
      details: `expected v${cas.conflict.expectedVersion}, actual v${cas.conflict.actualVersion}`,
    };
  }

  const updatedRefs: RefSnapshot[] = updates.map((u) => ({
    refName: u.refName,
    sha: u.newSha,
    version: (preSnapshot.get(u.refName)?.version ?? 0) + 1,
  }));

  return { ok: true, updatedRefs };
}
