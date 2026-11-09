/**
 * refs — every branch/tag tip the server has accepted.
 *
 * Hot path for the smart-HTTP `git push`:
 *   1. acquireRefLock(repoId, refName)
 *   2. UPDATE refs SET sha = $new, version = version + 1 WHERE repo_id = $r AND ref_name = $n AND version = $old
 *   3. releaseRefLock (auto via xact)
 *
 * `version` is the optimistic CAS column; the advisory lock prevents two
 * concurrent pushes from interleaving their CAS checks.
 */
import { sql } from 'drizzle-orm';
import { char, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';
import { users } from './users.js';

export const refs = pgTable(
  'refs',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    refName: text('ref_name').notNull(), // 'refs/heads/main'
    sha: char('sha', { length: 40 }).notNull(),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.refName] })],
);
