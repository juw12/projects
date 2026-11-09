import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { repositories, permissions } from '@openforge/db'

export type Repository = InferSelectModel<typeof repositories>
export type NewRepository = InferInsertModel<typeof repositories>
export type Permission = InferSelectModel<typeof permissions>

export const ROLE_RANK = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
  owner: 6,
} as const
export type Role = keyof typeof ROLE_RANK

// DB enum doesn't have 'owner' — owner is a TypeScript concept derived from
// repositories.ownerId. Persist everything else; cap 'owner' at 'admin' on write.
export type RoleDb = Exclude<Role, 'owner'>

export function hasRoleAtLeast(actual: Role | null | undefined, required: Role): boolean {
  if (!actual) return false
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

export function rankToDbRole(role: Role): RoleDb {
  if (role === 'owner') return 'admin'
  return role
}
