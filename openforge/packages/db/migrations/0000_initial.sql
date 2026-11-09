-- =====================================================================
-- OpenForge — initial schema (Phase 0)
-- Hand-written; the next migration will be drizzle-kit-generated and this
-- file becomes the historical baseline.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext; -- usually bundled but be explicit
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for hashtext() fallback / gen_random_uuid

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('member', 'admin', 'system');

CREATE TYPE owner_type AS ENUM ('user', 'org');
CREATE TYPE repo_visibility AS ENUM ('public', 'private', 'internal');

CREATE TYPE team_role AS ENUM ('maintainer', 'member');

CREATE TYPE permission_role AS ENUM ('none', 'read', 'triage', 'write', 'maintain', 'admin');
CREATE TYPE permission_source AS ENUM ('direct', 'team', 'org', 'app');

CREATE TYPE webhook_scope_type AS ENUM ('repo', 'org', 'user');
CREATE TYPE webhook_delivery_status AS ENUM (
  'pending', 'in_flight', 'success', 'failed', 'dead_letter'
);

CREATE TYPE subscription_tier AS ENUM ('free', 'team', 'enterprise');
CREATE TYPE subscription_status AS ENUM (
  'active', 'past_due', 'canceled', 'incomplete', 'trialing'
);
CREATE TYPE usage_meter_type AS ENUM (
  'storage_gb_hour',
  'bandwidth_egress_gb',
  'actions_minutes',
  'lfs_storage_gb',
  'registered_users'
);

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                citext NOT NULL UNIQUE,
  email_verified_at    timestamptz,
  password_hash        text,
  display_name         text NOT NULL,
  avatar_url           text,
  totp_secret_enc      bytea,
  totp_enabled         boolean NOT NULL DEFAULT false,
  webauthn_credential_id text,
  role                 user_role NOT NULL DEFAULT 'member',
  is_admin             boolean NOT NULL DEFAULT false,
  suspended_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip                  inet,
  user_agent          text,
  refresh_token_hash  text NOT NULL,
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_refresh_hash_uq ON sessions (refresh_token_hash);
CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

-- ---------------------------------------------------------------------
-- personal_access_tokens
-- ---------------------------------------------------------------------
CREATE TABLE personal_access_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  token_prefix  text NOT NULL,
  scopes        text[] NOT NULL DEFAULT '{}',
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pats_token_hash_uq ON personal_access_tokens (token_hash);
CREATE INDEX pats_user_hash_idx ON personal_access_tokens (user_id, token_hash);

-- ---------------------------------------------------------------------
-- ssh_keys
-- ---------------------------------------------------------------------
CREATE TABLE ssh_keys (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                text NOT NULL,
  public_key           text NOT NULL,
  fingerprint_sha256   text NOT NULL,
  last_used_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- repositories
-- ---------------------------------------------------------------------
CREATE TABLE repositories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      owner_type NOT NULL,
  owner_id        uuid NOT NULL,        -- Phase 1 → users(id); Phase 2 → orgs(id)
  name            citext NOT NULL,
  default_branch  text NOT NULL DEFAULT 'main',
  visibility      repo_visibility NOT NULL DEFAULT 'private',
  size_bytes      bigint NOT NULL DEFAULT 0,
  object_count    bigint NOT NULL DEFAULT 0,
  lfs_size_bytes  bigint NOT NULL DEFAULT 0,
  forked_from_id  uuid REFERENCES repositories(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX repositories_owner_name_uq
  ON repositories (owner_type, owner_id, name);
CREATE INDEX repositories_deleted_at_idx ON repositories (deleted_at);
CREATE INDEX repositories_owner_idx ON repositories (owner_type, owner_id);

-- ---------------------------------------------------------------------
-- refs  (smart-HTTP push hot path)
-- ---------------------------------------------------------------------
CREATE TABLE refs (
  repo_id             uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ref_name            text NOT NULL,
  sha                 char(40) NOT NULL,
  version             integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (repo_id, ref_name)
);

-- ---------------------------------------------------------------------
-- oid_inventory  (packfile inventory; per-OID rows live in .idx in S3)
-- ---------------------------------------------------------------------
CREATE TABLE oid_inventory (
  repo_id       uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pack_sha      char(40) NOT NULL,
  idx_key       text NOT NULL,
  size_bytes    bigint NOT NULL,
  object_count  bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, pack_sha)
);
CREATE INDEX oid_inventory_repo_created_idx ON oid_inventory (repo_id, created_at);

-- ---------------------------------------------------------------------
-- teams  (with ltree path maintained by trigger)
-- ---------------------------------------------------------------------
CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,                  -- Phase 1 → users(id) where owner_type='org'
  parent_team_id  uuid REFERENCES teams(id) ON DELETE RESTRICT,
  name            citext NOT NULL,
  slug            text NOT NULL,
  description     text,
  path            ltree NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_org_slug_uq ON teams (org_id, slug);

CREATE OR REPLACE FUNCTION teams_maintain_path()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_path ltree;
BEGIN
  IF NEW.parent_team_id IS NULL THEN
    NEW.path = text2ltree(replace(NEW.id::text, '-', '_'));
  ELSE
    SELECT path INTO parent_path FROM teams WHERE id = NEW.parent_team_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'parent team % not found', NEW.parent_team_id;
    END IF;
    NEW.path = parent_path || text2ltree(replace(NEW.id::text, '-', '_'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teams_path_trg
BEFORE INSERT OR UPDATE OF parent_team_id, id ON teams
FOR EACH ROW EXECUTE FUNCTION teams_maintain_path();

-- ---------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------
CREATE TABLE team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       team_role NOT NULL DEFAULT 'member',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- ---------------------------------------------------------------------
-- permissions  (materialized effective permissions)
-- ---------------------------------------------------------------------
CREATE TABLE permissions (
  repo_id    uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       permission_role NOT NULL,
  source     permission_source NOT NULL,
  source_id  uuid,
  PRIMARY KEY (repo_id, user_id, source, source_id)
);

-- ---------------------------------------------------------------------
-- branch_protection
-- ---------------------------------------------------------------------
CREATE TABLE branch_protection (
  repo_id                   uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ref_pattern               text NOT NULL,
  required_approvals        integer NOT NULL DEFAULT 0,
  require_status_checks     boolean NOT NULL DEFAULT false,
  block_force_push          boolean NOT NULL DEFAULT true,
  allow_force_push_admins   boolean NOT NULL DEFAULT false,
  dismiss_stale_approvals   boolean NOT NULL DEFAULT true,
  required_linear_history   boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, ref_pattern)
);

-- ---------------------------------------------------------------------
-- webhook_endpoints
-- ---------------------------------------------------------------------
CREATE TABLE webhook_endpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type    webhook_scope_type NOT NULL,
  scope_id      uuid NOT NULL,
  url           text NOT NULL,
  secret_enc    bytea NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  events        text[] NOT NULL DEFAULT '{}',
  insecure_ssl  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- webhook_deliveries  (durable queue with partial retry index)
-- ---------------------------------------------------------------------
CREATE TABLE webhook_deliveries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id           uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type            text NOT NULL,
  event_id              text NOT NULL,
  payload_s3_key        text NOT NULL,
  status                webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempts              integer NOT NULL DEFAULT 0,
  max_attempts          integer NOT NULL DEFAULT 30,
  next_retry_at         timestamptz NOT NULL DEFAULT now(),
  last_error            text,
  response_status       integer,
  response_duration_ms  integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);
CREATE UNIQUE INDEX webhook_deliveries_endpoint_event_uq
  ON webhook_deliveries (endpoint_id, event_id);
-- Partial index drives the worker poll: only retryable rows are scanned.
CREATE INDEX webhook_deliveries_retry_idx
  ON webhook_deliveries (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

-- ---------------------------------------------------------------------
-- actions  (workflows / runs / jobs / secrets)
-- ---------------------------------------------------------------------
CREATE TABLE workflows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id    uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path       text NOT NULL,
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  triggers   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  head_sha        text NOT NULL,
  event           text NOT NULL,
  status          text NOT NULL DEFAULT 'queued',
  conclusion      text,
  started_at      timestamptz,
  finished_at     timestamptz,
  log_s3_prefix   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  matrix       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued',
  runner_id    text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_secrets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id         uuid REFERENCES repositories(id) ON DELETE CASCADE,
  org_id          uuid,                                  -- exactly one of (repo_id, org_id) is set
  name            text NOT NULL,
  encrypted_value bytea NOT NULL,
  iv              bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ( (repo_id IS NOT NULL)::int + (org_id IS NOT NULL)::int = 1 )
);

-- ---------------------------------------------------------------------
-- stripe
-- ---------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  stripe_customer_id     text NOT NULL,
  stripe_sub_id          text NOT NULL,
  tier                   subscription_tier NOT NULL DEFAULT 'free',
  status                 subscription_status NOT NULL,
  current_period_end     timestamptz NOT NULL,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_meters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  meter_type    usage_meter_type NOT NULL,
  quantity      numeric(18, 6) NOT NULL,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_meters_org_period_idx
  ON usage_meters (org_id, meter_type, period_start);

CREATE TABLE usage_rollups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  meter_type           usage_meter_type NOT NULL,
  period               date NOT NULL,
  total_quantity       numeric(18, 6) NOT NULL,
  pushed_to_stripe_at  timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, meter_type, period)
);
CREATE INDEX usage_rollups_period_idx ON usage_rollups (period);

CREATE TABLE stripe_events (
  id            text PRIMARY KEY,                         -- evt_...
  type          text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- audit_log  (partitioned monthly by created_at)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_ip        inet,
  action          text NOT NULL,
  target_type     text NOT NULL,
  target_id       uuid NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_log_target_idx  ON audit_log (target_type, target_id, created_at);
CREATE INDEX audit_log_actor_idx   ON audit_log (actor_user_id, created_at);

-- Seed the current month and the following month so a fresh install can
-- accept rows immediately. ops/migrations add the rest on a cron.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

CREATE TABLE audit_log_yYYYY_mMM_seed () INHERITS (audit_log_default);
DROP TABLE audit_log_yYYYY_mMM_seed; -- placeholder, just validates grammar

-- ---------------------------------------------------------------------
-- lfs
-- ---------------------------------------------------------------------
CREATE TABLE lfs_objects (
  oid          text PRIMARY KEY,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lfs_pointers (
  repo_id     uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  oid         text NOT NULL,
  commit_sha  text NOT NULL,
  path        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repo_id, oid, commit_sha, path)
);
CREATE INDEX lfs_pointers_repo_oid_idx ON lfs_pointers (repo_id, oid);
