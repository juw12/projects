-- 0002_fork_pr_permissions.sql — fork-PR permission enforcement.
-- See schema/actions.ts for the Drizzle definitions this migration
-- is generated from.
--
-- Verified threat model (2026-11-03):
--   * Pwn request (cf. Grafana Apr 2025): a fork PR's workflow runs
--     untrusted code with the base repo's secrets. We kill the class
--     by defaulting permissions to 'none' on fork PRs and letting the
--     server — NOT the workflow YAML — decide.
--   * pull_request_target is similarly locked down (cf. GitHub's
--     Dec 2 2026 default block).
--
-- Permission levels:
--   none       — no base repo secrets, no head checkout from fork
--   reviewer   — base repo secrets only after explicit reviewer approval
--   full       — base repo secrets + head checkout (trusted triggers only)
--
-- Trust rules (server-side, NOT enforced by workflow YAML):
--   fork + pull_request          → none (always)
--   fork + pull_request_target   → none (always; workflow YAML can't override)
--   direct push                  → full
--   workflow_dispatch            → full
--   pull_request (same-repo)     → full
--   schedule                     → full
--   workflow_run                 → full

ALTER TABLE workflow_runs
  ADD COLUMN trigger_source text NOT NULL DEFAULT 'push',
  ADD COLUMN is_fork_pr boolean NOT NULL DEFAULT false;

ALTER TABLE workflow_jobs
  ADD COLUMN permissions text NOT NULL DEFAULT 'full',
  ADD COLUMN is_fork_pr boolean NOT NULL DEFAULT false;

ALTER TABLE workflow_jobs
  ADD CONSTRAINT workflow_jobs_permissions_valid
  CHECK (permissions IN ('none', 'reviewer', 'full'));

CREATE INDEX workflow_runs_trigger_source_idx ON workflow_runs (trigger_source);
CREATE INDEX workflow_runs_is_fork_pr_idx ON workflow_runs (is_fork_pr) WHERE is_fork_pr = true;
CREATE INDEX workflow_jobs_permissions_idx ON workflow_jobs (permissions);
CREATE INDEX workflow_jobs_is_fork_pr_idx ON workflow_jobs (is_fork_pr) WHERE is_fork_pr = true;
