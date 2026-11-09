/**
 * webhook_endpoints — outbound webhook subscriptions.
 *
 * `secret_enc` is the per-endpoint HMAC secret, encrypted at rest with KMS.
 * `events` is the subscribed event filter (['*'] for everything).
 * `insecure_ssl` mirrors the GitHub setting — when true we still verify certs
 * but tolerate a recent chain; production callers should leave this false.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './custom-types.js';

export const webhookScopeType = pgEnum('webhook_scope_type', ['repo', 'org', 'user']);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  scopeType: webhookScopeType('scope_type').notNull(),
  scopeId: uuid('scope_id').notNull(),
  url: text('url').notNull(),
  secretEnc: bytea('secret_enc').notNull(),
  active: boolean('active').notNull().default(true),
  events: text('events').array().notNull().default(sql`'{}'::text[]`),
  insecureSsl: boolean('insecure_ssl').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});
