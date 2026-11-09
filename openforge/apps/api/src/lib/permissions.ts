import { db } from '@openforge/db';
import { permissions, repositories } from '@openforge/db';
import { and, eq } from 'drizzle-orm';

/**
 * permissions — read-side helpers for the materialized `permissions` table.
 *
 * Rule: owner is always implicitly admin. After that, every other grant is a
 * row in `permissions` (source='direct'|'team'|'org'|'app'). Anonymous
 * callers (userId=null) only see `public` repos via userCanReadRepo().
 */

const RANK = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
} as const;

type RoleValue = keyof typeof RANK;
type MinRole = 'read' | 'write' | 'admin';

function meets(actual: RoleValue, required: MinRole): boolean {
  return RANK[actual] >= RANK[required];
}

export async function repoOwnerUserId(repoId: string): Promise<string | null> {
  const rows = await db
    .select({ ownerId: repositories.ownerId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  return rows[0]?.ownerId ?? null;
}

async function highestPermissionRole(
  userId: string,
  repoId: string,
): Promise<RoleValue> {
  const rows = await db
    .select({ role: permissions.role })
    .from(permissions)
    .where(and(eq(permissions.repoId, repoId), eq(permissions.userId, userId)));
  let best: RoleValue = 'none';
  for (const r of rows) {
    if (RANK[r.role as RoleValue] > RANK[best]) best = r.role as RoleValue;
  }
  return best;
}

export async function userCanReadRepo(
  userId: string | null,
  repoId: string,
): Promise<boolean> {
  const meta = await db
    .select({
      ownerId: repositories.ownerId,
      visibility: repositories.visibility,
    })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  const row = meta[0];
  if (!row) return false;
  if (row.visibility === 'public') return true;
  if (!userId) return false;
  if (row.ownerId === userId) return true;
  return meets(await highestPermissionRole(userId, repoId), 'read');
}

export async function userCanWriteRepo(
  userId: string | null,
  repoId: string,
): Promise<boolean> {
  if (!userId) return false;
  const owner = await repoOwnerUserId(repoId);
  if (!owner) return false;
  if (owner === userId) return true;
  return meets(await highestPermissionRole(userId, repoId), 'write');
}

export async function userCanAdminRepo(
  userId: string | null,
  repoId: string,
): Promise<boolean> {
  if (!userId) return false;
  const owner = await repoOwnerUserId(repoId);
  if (!owner) return false;
  if (owner === userId) return true;
  return meets(await highestPermissionRole(userId, repoId), 'admin');
}
