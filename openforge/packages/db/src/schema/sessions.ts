/**
 * sessions — Better Auth + custom cookie sessions.
 *
 * `refresh_token_hash` is sha256 of the opaque refresh token the client holds;
 * the raw value never lands on disk. Hot path: refresh + revoke.
 * Composite index supports "list active sessions for user" paginated scans.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inet } from './custom-types.js';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('sessions_refresh_hash_uq').on(t.refreshTokenHash),
    index('sessions_user_expires_idx').on(t.userId, t.expiresAt),
  ],
);
