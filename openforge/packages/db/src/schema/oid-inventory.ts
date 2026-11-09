/**
 * oid_inventory — per-repo packfile inventory (S3 + Postgres hybrid).
 *
 * Stores one row per pack (key = pack_sha), not per OID. The OID → pack
 * membership lives in the .idx/MIDX files in S3; Postgres only needs to
 * know "this pack exists for this repo, here is its .idx, size, object count".
 * The (repo_id, created_at) index drives background GC.
 */
import { bigint, char, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';

export const oidInventory = pgTable(
  'oid_inventory',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    packSha: char('pack_sha', { length: 40 }).notNull(),
    idxKey: text('idx_key').notNull(), // S3 key for the .idx sidecar
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    objectCount: bigint('object_count', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.repoId, t.packSha] }),
    index('oid_inventory_repo_created_idx').on(t.repoId, t.createdAt),
  ],
);
