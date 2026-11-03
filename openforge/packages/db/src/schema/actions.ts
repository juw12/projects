/**
 * actions — GitHub Actions-compatible workflow engine tables.
 *
 * Phase 0: tables exist with the minimum fields a runner can read/write.
 * workflow_secrets stores per-repo OR per-org secrets, KMS-encrypted with
 * the per-secret IV stored alongside (so secrets never share an IV).
 * Phase 2 expands runs/jobs (matrix expansion, step-level logs, etc.).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './custom-types.js';
import { repositories } from './repositories.js';

export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  path: text('path').notNull(), // .github/workflows/ci.yml
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  triggers: jsonb('triggers').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  headSha: text('head_sha').notNull(),
  event: text('event').notNull(),
  triggerSource: text('trigger_source').notNull().default('push'),
  isForkPr: boolean('is_fork_pr').notNull().default(false),
  status: text('status').notNull().default('queued'),
  conclusion: text('conclusion'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  logS3Prefix: text('log_s3_prefix'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowJobs = pgTable('workflow_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  matrix: jsonb('matrix').notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('queued'),
  runnerId: text('runner_id'),
  permissions: text('permissions').notNull().default('full'),
  isForkPr: boolean('is_fork_pr').notNull().default(false),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSecrets = pgTable('workflow_secrets', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id'), // nullable; exactly one of (repo_id, org_id) is set
  name: text('name').notNull(),
  encryptedValue: bytea('encrypted_value').notNull(),
  iv: bytea('iv').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});
