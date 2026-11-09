/**
 * lfs — Git LFS object tracking + cross-tenant pointer checks.
 *
 * lfs_objects stores the canonical "this SHA-256 exists in S3 at storage_key"
 * record. lfs_pointers is the per-repo pointer map that protects against a
 * malicious repo advertising an LFS OID it never referenced — a download
 * request must find a matching pointer row for the requesting repo_id.
 *
 * Index on (repo_id, oid) is the lookup the smart-HTTP LFS endpoint hits.
 */
import { bigint, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';

export const lfsObjects = pgTable('lfs_objects', {
  oid: text('oid').primaryKey(), // SHA-256 of the file contents
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(), // S3 key
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lfsPointers = pgTable(
  'lfs_pointers',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    oid: text('oid').notNull(),
    commitSha: text('commit_sha').notNull(),
    path: text('path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.repoId, t.oid, t.commitSha, t.path] }),
    index('lfs_pointers_repo_oid_idx').on(t.repoId, t.oid),
  ],
);
