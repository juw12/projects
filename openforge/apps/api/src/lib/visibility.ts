import { db } from '@openforge/db';
import { repositories, users } from '@openforge/db';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * RepoMetadata — full public-facing shape returned by repo endpoints.
 *
 * `description` is reserved for a future schema migration; current responses
 * include it as `null` so clients can be written against the eventual shape.
 */
export interface RepoMetadata {
  id: string;
  ownerId: string;
  ownerType: 'user' | 'org';
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  sizeBytes: number;
  createdAt: Date;
  forkedFromId: string | null;
  deletedAt: Date | null;
  description: string | null;
}

/**
 * Look up a single live repo by (owner displayName, repo name).
 *
 * Soft-deleted repos (deleted_at IS NOT NULL) are filtered out — callers see
 * 404, which is the right answer for "this repo is gone". Phase 2's sweeper
 * physically removes the bare dir + row 30 days after deleteRepo().
 */
export async function getRepoMetadata(
  owner: string,
  repo: string,
): Promise<RepoMetadata | null> {
  const rows = await db
    .select({
      id: repositories.id,
      ownerId: repositories.ownerId,
      ownerType: repositories.ownerType,
      name: repositories.name,
      defaultBranch: repositories.defaultBranch,
      visibility: repositories.visibility,
      sizeBytes: repositories.sizeBytes,
      createdAt: repositories.createdAt,
      forkedFromId: repositories.forkedFromId,
      deletedAt: repositories.deletedAt,
    })
    .from(repositories)
    .innerJoin(users, eq(users.id, repositories.ownerId))
    .where(
      and(
        eq(repositories.ownerType, 'user'),
        eq(users.displayName, owner),
        eq(repositories.name, repo),
        isNull(repositories.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, description: null };
}

/**
 * Backwards-compatible visibility-only lookup. Kept as a thin wrapper around
 * getRepoMetadata() so apps/api/src/routes/git.ts (and the Phase 0 callers
 * that still exist) don't have to change shape.
 */
export async function getRepoVisibility(
  owner: string,
  repo: string,
): Promise<'public' | 'private' | 'internal' | null> {
  const meta = await getRepoMetadata(owner, repo);
  return meta?.visibility ?? null;
}
