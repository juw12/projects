/**
 * permissions — materialized effective permissions per (repo, user, source).
 *
 * This table is the read-side cache that makes "can this user push to this
 * repo?" an indexed point lookup instead of a join across teams/orgs/repos.
 * A background job recomputes rows whenever team_members or org membership
 * changes; readers must NEVER trust stale rows beyond the agreed TTL.
 *
 * source_id is the team.id (when source='team'), app.id (when 'app'), or
 * NULL when source='direct'|'org'. The composite PK keeps all four rows
 * distinct for the same (repo, user) tuple.
 */
import { pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';
import { users } from './users.js';

export const permissionRole = pgEnum('permission_role', [
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]);

export const permissionSource = pgEnum('permission_source', ['direct', 'team', 'org', 'app']);

export const permissions = pgTable(
  'permissions',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: permissionRole('role').notNull(),
    source: permissionSource('source').notNull(),
    sourceId: uuid('source_id'), // polymorphic → teams.id or apps.id; null for direct/org
  },
  (t) => [primaryKey({ columns: [t.repoId, t.userId, t.source, t.sourceId] })],
);
