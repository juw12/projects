/**
 * personal_access_tokens — long-lived API tokens (the "of_pat_..." kind).
 *
 * token_hash is sha256 hex; the raw secret is shown to the user exactly once
 * at creation and never stored. token_prefix lets the UI render "of_pat_a1b2…"
 * for recognition without leaking the secret.
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
import { users } from './users.js';

export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('pats_token_hash_uq').on(t.tokenHash),
    index('pats_user_hash_idx').on(t.userId, t.tokenHash),
  ],
);
