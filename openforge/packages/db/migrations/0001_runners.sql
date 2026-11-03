-- 0001_runners.sql — CI runner registration and lifecycle tables.
-- See schema/runners.ts for the Drizzle definitions this migration
-- is generated from.
--
-- Design notes (verified 2026-11-03):
--   * registration_token stored as SHA-256 hash (cf. CircleCI Dec 2022)
--   * ephemeral runner default (matches GitHub-hosted runner model)
--   * sandbox enum defaults to gvisor (OpenForge default policy)

-- 1. Enum
CREATE TYPE runner_sandbox AS ENUM (
  'gvisor',
  'kata',
  'firecracker',
  'sysbox',
  'rootless'
);

-- 2. runners
CREATE TABLE runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,

  owner_repo_id uuid REFERENCES repositories(id) ON DELETE CASCADE,
  owner_org_id uuid,

  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  sandbox runner_sandbox NOT NULL DEFAULT 'gvisor',
  ephemeral boolean NOT NULL DEFAULT true,
  max_parallel_jobs integer NOT NULL DEFAULT 1,

  last_seen_at timestamptz,
  status text NOT NULL DEFAULT 'idle',
  version text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT runners_owner_exactly_one CHECK (
    (owner_repo_id IS NOT NULL)::int + (owner_org_id IS NOT NULL)::int <= 1
  ),
  CONSTRAINT runners_status_valid CHECK (
    status IN ('offline', 'idle', 'busy', 'draining')
  ),
  CONSTRAINT runners_max_parallel_positive CHECK (max_parallel_jobs >= 1)
);

CREATE UNIQUE INDEX runners_name_unique ON runners (name);
CREATE INDEX runners_owner_repo_idx ON runners (owner_repo_id);
CREATE INDEX runners_owner_org_idx ON runners (owner_org_id);
CREATE INDEX runners_status_idx ON runners (status);

-- 3. runner_registration_tokens
CREATE TABLE runner_registration_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT runner_reg_tokens_hash_len CHECK (
    char_length(token_hash) = 64  -- SHA-256 hex
  ),
  CONSTRAINT runner_reg_tokens_prefix_len CHECK (
    char_length(token_prefix) >= 4 AND char_length(token_prefix) <= 16
  )
);

CREATE INDEX runner_reg_tokens_runner_idx ON runner_registration_tokens (runner_id);
CREATE UNIQUE INDEX runner_reg_tokens_hash_unique ON runner_registration_tokens (token_hash);

-- 4. runner_jobs
CREATE TABLE runner_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id uuid NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  picked_up_at timestamptz,
  finished_at timestamptz,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT runner_jobs_outcome_valid CHECK (
    outcome IS NULL OR outcome IN ('success', 'failure', 'cancelled', 'timeout')
  )
);

CREATE INDEX runner_jobs_runner_idx ON runner_jobs (runner_id);
CREATE INDEX runner_jobs_job_idx ON runner_jobs (job_id);

-- A job can have AT MOST ONE active runner assignment at a time. Enforced
-- via partial unique index — multiple historical (finished_at IS NOT NULL)
-- rows are allowed, but only one row per job with picked_up_at IS NOT NULL
-- AND finished_at IS NULL.
CREATE UNIQUE INDEX runner_jobs_one_active_per_job
  ON runner_jobs (job_id)
  WHERE picked_up_at IS NOT NULL AND finished_at IS NULL;

-- 5. updated_at trigger for runners (matches the onUpdate pattern in
-- the Drizzle schema)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER runners_set_updated_at
  BEFORE UPDATE ON runners
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
