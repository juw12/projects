/**
 * ssh_keys — OpenSSH public keys users register for `git push` auth.
 *
 * public_key is the OpenSSH wire format (what `ssh-keygen -e` emits).
 * fingerprint_sha256 is `SHA256:base64(key)` — the same string ssh prints.
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  publicKey: text('public_key').notNull(),
  fingerprintSha256: text('fingerprint_sha256').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});
