/**
 * team_members — many-to-many users ↔ teams with a role flag.
 *
 * Composite PK prevents duplicate memberships. The materialized `permissions`
 * table is what queries hit on the push hot path; team_members is the
 * source-of-truth that the permissions recomputation job reads.
 */
import { pgEnum, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { teams } from './teams.js';
import { users } from './users.js';

export const teamRole = pgEnum('team_role', ['maintainer', 'member']);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);
