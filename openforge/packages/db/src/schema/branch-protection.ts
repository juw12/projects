/**
 * branch_protection — per-repo rules keyed by ref pattern.
 *
 * ref_pattern is a git refs pattern (refs/heads/main or refs/heads/release/*).
 * Rules are looked up by the smart-HTTP push handler after the ref CAS
 * succeeds but before responding 200.
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';

export const branchProtection = pgTable(
  'branch_protection',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    refPattern: text('ref_pattern').notNull(),
    requiredApprovals: integer('required_approvals').notNull().default(0),
    requireStatusChecks: boolean('require_status_checks').notNull().default(false),
    blockForcePush: boolean('block_force_push').notNull().default(true),
    allowForcePushAdmins: boolean('allow_force_push_admins').notNull().default(false),
    dismissStaleApprovals: boolean('dismiss_stale_approvals').notNull().default(true),
    requiredLinearHistory: boolean('required_linear_history').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.refPattern] })],
);
