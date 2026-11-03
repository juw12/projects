/**
 * runners — CI runner registration and lifecycle tables.
 *
 * Mirrors forgejo/runner's model (Runner + RunnerRegistrationToken +
 * RunnerJob) but expressed in OpenForge's existing schema style
 * (Drizzle + Postgres + uuid primary keys + ltree for org paths).
 *
 * Security design (verified 2026-11-03):
 *   - registration_token is stored as SHA-256 hash, not plaintext (cf.
 *     CircleCI Dec 2022 — stolen plaintext token was the root cause).
 *   - `last_seen_at` updates on every poll; stale runners are
 *     GC'd after `stale_after` interval (default 24h).
 *   - `ephemeral` defaults to TRUE — matches GitHub's hosted runner
 *     model (verified 2026-11-03) and prevents the long-lived runner
 *     state-leakage class (cf. Daytona PR #4474).
 *   - `sandbox` enum tracks which isolation mode the runner is using
 *     (gvisor | kata | firecracker | sysbox | rootless — default
 *     gvisor per OpenForge default policy).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { repositories } from './repositories.js';

export const runnerSandboxEnum = pgEnum('runner_sandbox', [
  'gvisor',
  'kata',
  'firecracker',
  'sysbox',
  'rootless',
]);

export const runners = pgTable(
  'runners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(), // globally unique; the human label shown in the UI
    description: text('description'),

    // owner: nullable, exactly one of (owner_repo_id, owner_org_id) is set.
    // Repository-scoped runners run jobs only for that repo; org-scoped
    // runners run jobs for any repo in the org. NULL = "global" runner
    // for trusted-org system jobs only.
    ownerRepoId: uuid('owner_repo_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    ownerOrgId: uuid('owner_org_id'),

    // labels: matches the runner label protocol used by forgejo +
    // GitHub Actions. e.g. ["self-hosted", "linux", "x64", "gvisor"].
    labels: jsonb('labels').notNull().default(sql`'[]'::jsonb`),

    // Isolation mode this runner uses. Mirrors the verified 2026-11-03
    // policy: default is gvisor; opt-in for kata (DinD), firecracker
    // (Lambda-grade), etc.
    sandbox: runnerSandboxEnum('sandbox').notNull().default('gvisor'),

    // Ephemeral vs persistent. Default TRUE — matches GitHub-hosted
    // runner model (per-job VM, no state leakage).
    ephemeral: boolean('ephemeral').notNull().default(true),

    // Concurrency cap. Ephemeral runners usually set this to 1 (one job
    // per VM). Persistent runners can host multiple concurrent jobs.
    maxParallelJobs: integer('max_parallel_jobs').notNull().default(1),

    // Last successful poll time. Used to GC stale runners.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),

    // Operational state — distinct from ephemeral/persistent. A runner
    // can be `offline` (deregistered), `idle` (waiting), `busy` (has
    // job in flight), or `draining` (finishing in-flight jobs, no new
    // assignments — used during graceful shutdown).
    status: text('status').notNull().default('idle'),

    // Runner version (semver). Used for upgrade-cohort management and
    // deprecation warnings when the server stops supporting old
    // protocol versions.
    version: text('version'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => ({
    nameUnique: unique('runners_name_unique').on(t.name),
    ownerRepoIdx: index('runners_owner_repo_idx').on(t.ownerRepoId),
    ownerOrgIdx: index('runners_owner_org_idx').on(t.ownerOrgId),
    statusIdx: index('runners_status_idx').on(t.status),
  }),
);

/**
 * runner_registration_tokens — the bearer tokens a runner presents to
 * the API to identify itself. Stored as SHA-256 hash, never plaintext.
 *
 * Issuance flow (server side):
 *   1. Admin clicks "Register runner" in the UI
 *   2. Server generates a 256-bit random secret, hashes it, returns
 *      the plaintext ONE TIME (it's never stored)
 *   3. Runner stores the plaintext locally and presents it as
 *      `Authorization: Bearer <plaintext>` on every request
 *   4. Server hashes the inbound bearer with SHA-256 and looks up the
 *      hash in this table
 *
 * Rotation: admins can rotate a token by deleting the row and issuing a
 * new one; the runner must re-register.
 *
 * Compromised token mitigation (cf. CircleCI Dec 2022): if a token is
 * leaked, the operator deletes the row. Every in-flight request with
 * that token immediately fails. The plaintext was never on the server.
 */
export const runnerRegistrationTokens = pgTable(
  'runner_registration_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runnerId: uuid('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    // SHA-256 of the plaintext bearer. 32 bytes fixed-length.
    tokenHash: text('token_hash').notNull(),
    // First 8 chars of the plaintext, for human identification in the
    // UI ("token prefix: abc12345…"). NOT a secret.
    tokenPrefix: text('token_prefix').notNull(),
    // Optional expiry. After this, the server rejects the token even
    // if the hash matches. NULL = no expiry (rotated manually).
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Last successful use. Useful for "this token hasn't been used in
    // 90 days, should we revoke it?" reminders.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runnerIdIdx: index('runner_reg_tokens_runner_idx').on(t.runnerId),
    // token_hash is unique so lookups are O(log n) via the hash match.
    tokenHashUnique: unique('runner_reg_tokens_hash_unique').on(t.tokenHash),
  }),
);

/**
 * runner_jobs — many-to-many between runners and workflow_jobs.
 * Tracks which runner is currently executing (or last executed) a job.
 *
 * A job has AT MOST ONE active runner assignment at a time (enforced
 * via partial unique index — see migration). When a runner picks up a
 * job, the row is inserted with `picked_up_at = now()`; when it
 * finishes, `finished_at` is set and `outcome` is recorded.
 */
export const runnerJobs = pgTable(
  'runner_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runnerId: uuid('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull(), // FK to workflow_jobs.id, declared in actions.ts
    // Set when the runner picks up the job; NULL until then.
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // "success" | "failure" | "cancelled" | "timeout" — mirrors the
    // GitHub Actions `conclusion` semantics.
    outcome: text('outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runnerIdIdx: index('runner_jobs_runner_idx').on(t.runnerId),
    jobIdIdx: index('runner_jobs_job_idx').on(t.jobId),
  }),
);
