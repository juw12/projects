/**
 * users — every authenticated principal on the instance.
 *
 * Phase 0 keeps one table for both human accounts and org-owned service
 * principals; `is_admin` plus a future `user_role` enum cover authz tiers.
 * Email is citext so "Foo@x" and "foo@x" are the same identity.
 * TOTP / WebAuthn fields stay null until the user opts in.
 */
import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea, citext } from './custom-types.js';

export const userRole = pgEnum('user_role', ['member', 'admin', 'system']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: citext('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash'), // argon2id; null once passkey-only
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  totpSecretEnc: bytea('totp_secret_enc'), // KMS-encrypted TOTP seed
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  webauthnCredentialId: text('webauthn_credential_id'), // current default passkey
  role: userRole('role').notNull().default('member'),
  isAdmin: boolean('is_admin').notNull().default(false),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});
