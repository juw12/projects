/**
 * audit_log — append-only record of every privileged action.
 *
 * actor_user_id is null for system-triggered actions (e.g. auto-suspend on
 * ToS violation). Partitioned monthly by created_at so a year of audit data
 * can be dropped with a single DETACH/DROP without bloating the planner's
 * stats or taking AccessExclusive on the parent.
 *
 * Hot path: insert-by-trigger (so it never blocks the user-facing request)
 * and selective read by (target_type, target_id, created_at) for "what
 * happened to this repo" views.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inet } from './custom-types.js';
import { users } from './users.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorIp: inet('actor_ip'),
    action: text('action').notNull(), // 'repo.create', 'member.add', …
    targetType: text('target_type').notNull(), // 'repo', 'user', 'team', …
    targetId: uuid('target_id').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_target_idx').on(t.targetType, t.targetId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorUserId, t.createdAt),
  ],
);
