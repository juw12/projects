/**
 * Resolve an ExtractedAuth (from @openforge/git-transport) to a userId
 * for `refs.updated_by_user_id`.
 *
 * Phase 1 stubs:
 *   - basic:  match by email (citext). The Better Auth middleware in
 *             Phase 2 will validate the password too.
 *   - token:  PAT lookup (Phase 2 — deferred).
 *   - none:   null (route layer should already have rejected this).
 *
 * The route layer uses this to populate `updated_by_user_id` when
 * applying CAS updates. If it returns null we fall back to the repo
 * owner's userId so the audit trail still has *some* principal
 * attribution — better than NULL for forensic purposes.
 */
import { db, users } from '@openforge/db';
import { eq, or } from 'drizzle-orm';
import type { ExtractedAuth } from '@openforge/git-transport';

export async function resolveAuthUserId(auth: ExtractedAuth): Promise<string | null> {
  if (auth.type === 'basic') {
    const username = auth.username.trim();
    if (username.length === 0) return null;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, username), eq(users.displayName, username)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  if (auth.type === 'token') {
    // PAT lookup belongs to packages/auth/src/pat.ts once that lands
    // in Phase 2. For Phase 1 we cannot resolve token → user.
    return null;
  }

  return null;
}
