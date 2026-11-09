/**
 * repositories — top-level Git repository metadata.
 *
 * `owner_type` + `owner_id` resolves a polymorphic owner (user or org).
 * Phase 1 keeps "org" pointing at the users table; we split into a proper
 * `orgs` table later and add an FK check then. UNIQUE(owner_type, owner_id, name)
 * is the namespace key — every clone, push and webhook URL is derived from it.
 * Soft-delete via deleted_at; the partial index keeps "live repos" scans cheap.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './custom-types.js';

export const ownerType = pgEnum('owner_type', ['user', 'org']);
export const repoVisibility = pgEnum('repo_visibility', ['public', 'private', 'internal']);

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerType: ownerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(), // → users.id (Phase 1) or orgs.id (later)
    name: citext('name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    visibility: repoVisibility('visibility').notNull().default('private'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    objectCount: bigint('object_count', { mode: 'number' }).notNull().default(0),
    lfsSizeBytes: bigint('lfs_size_bytes', { mode: 'number' }).notNull().default(0),
    forkedFromId: uuid('forked_from_id'), // self-reference added below via FK helper
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('repositories_owner_name_uq').on(t.ownerType, t.ownerId, t.name),
    index('repositories_deleted_at_idx').on(t.deletedAt),
    index('repositories_owner_idx').on(t.ownerType, t.ownerId),
  ],
);

export type RepositoryRow = typeof repositories.$inferSelect;
