import type { ExtractedAuth } from '@openforge/git-transport'
import { canAccess } from '../services/permissions.js'
import { hasRoleAtLeast, type Role } from '../types.js'

export async function canPush(
  auth: ExtractedAuth,
  _owner: string,
  _repo: string,
): Promise<boolean> {
  if (auth.type === 'none') return false
  return true
}

export async function canPushAs(
  repoId: string,
  userId: string,
): Promise<boolean> {
  return canAccess(repoId, userId, 'write')
}

export type { Role }
export { hasRoleAtLeast }
