/**
 * teams — hierarchical groups of users inside an org.
 *
 * Phase 1 stores the org as a `users` row (owner_type='org'); we lift this
 * into a proper `orgs` table later. `path` is an ltree populated by trigger
 * so ancestor / descendant queries are O(log n) instead of recursive CTEs.
 * `slug` is the URL-safe identifier (e.g. "platform-eng"); unique per org.
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, ltree } from './custom-types.js';

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(), // → users where owner_type='org' (Phase 1)
    parentTeamId: uuid('parent_team_id'), // self-FK added via raw SQL in migration
    name: citext('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    path: ltree('path').notNull(), // maintained by trigger on insert/update
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [uniqueIndex('teams_org_slug_uq').on(t.orgId, t.slug)],
);
