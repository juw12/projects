import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@openforge/db'
import { permissions, repositories, teams, teamMembers } from '@openforge/db'
import { hasRoleAtLeast, rankToDbRole, type Role, type RoleDb } from '../types.js'

type PermissionSource = 'direct' | 'team' | 'org' | 'app'

export async function grantPermission(
  repoId: string,
  userId: string,
  role: Role,
  source: PermissionSource,
  sourceId: string | null = null,
): Promise<void> {
  const dbRole = rankToDbRole(role)
  await db
    .insert(permissions)
    .values({ repoId, userId, role: dbRole as RoleDb, source, sourceId })
    .onConflictDoUpdate({
      target: [permissions.repoId, permissions.userId, permissions.source, permissions.sourceId],
      set: { role: dbRole as RoleDb },
    })
}

export async function revokePermission(
  repoId: string,
  userId: string,
  source: PermissionSource,
  sourceId: string | null = null,
): Promise<void> {
  await db
    .delete(permissions)
    .where(
      and(
        eq(permissions.repoId, repoId),
        eq(permissions.userId, userId),
        eq(permissions.source, source),
        sourceId === null
          ? sql`${permissions.sourceId} IS NULL`
          : eq(permissions.sourceId, sourceId),
      ),
    )
}

/**
 * canAccess — point lookup against the materialized permissions table.
 * The repo's owner has an implicit 'owner' role derived from repositories.ownerId,
 * which beats every persisted role. Returns true iff the effective role
 * (max over all permission rows, plus the implicit owner) is >= requiredRole.
 */
export async function canAccess(
  repoId: string,
  userId: string,
  requiredRole: Role,
): Promise<boolean> {
  const ownerRow = await db
    .select({ ownerId: repositories.ownerId })
    .from(repositories)
    .where(and(eq(repositories.id, repoId), isNull(repositories.deletedAt)))
    .limit(1)
  if (ownerRow[0]?.ownerId === userId) return true

  const rows = await db
    .select({ role: permissions.role })
    .from(permissions)
    .where(and(eq(permissions.repoId, repoId), eq(permissions.userId, userId)))

  for (const row of rows) {
    if (hasRoleAtLeast(row.role as Role, requiredRole)) return true
  }
  return false
}

/**
 * materializeOrgPermissions — recompute materialized permissions for every
 * repo in an org based on current team membership. Phase 1 keeps 'org' as
 * a row in `users`; once a proper orgs table lands this will replace the
 * users-row reference and add team hierarchy resolution. Current best-effort
 * pass: grants every team member 'write' on the org-scoped permission row.
 */
export async function materializeOrgPermissions(orgId: string): Promise<void> {
  const orgTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.orgId, orgId))
  if (orgTeams.length === 0) return
  const teamIds = orgTeams.map((t) => t.id)

  const members = await db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds))

  for (const m of members) {
    await grantPermission(`org:${orgId}:${m.teamId}`, m.userId, 'write', 'team', m.teamId)
  }
}
