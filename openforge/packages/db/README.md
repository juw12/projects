# @openforge/db

Drizzle ORM Postgres schema for OpenForge. **Every other package depends on
this one** — the schema here is the contract.

## Layout

```
src/
  client.ts              postgres-js driver + Drizzle wrapper
  index.ts               public surface (re-exports)
  schema/                one file per logical domain
  helpers/
    ref-locking.ts       advisory-lock helpers for atomic ref updates
migrations/              hand-written 0000, generated 0001+ after
```

## Quick start

```bash
# 1. boot Postgres (local docker, RDS, whatever) and set DATABASE_URL
cp ../../.env.example .env  # edit DATABASE_URL

# 2. apply the initial schema
pnpm db:migrate

# 3. (later) regenerate after schema changes
pnpm db:generate
pnpm db:migrate

# 4. browse the DB
pnpm db:studio
```

`pnpm db:migrate` from the repo root runs `drizzle-kit migrate` against
`./migrations`. The first migration (`0000_initial.sql`) is hand-written and
shippable as-is.

## Conventions

- All IDs are `uuid` with `.defaultRandom()`.
- All timestamps are `timestamptz` with `.defaultNow()`.
- All enums live in the schema file they belong to and are exported by name.
- All Postgres extension types (`citext`, `inet`, `ltree`, `bytea`) are
  declared in `schema/custom-types.ts` and imported as ordinary Drizzle
  column builders.
- Self-referential and polymorphic FKs are declared in the migration SQL,
  not the schema — Drizzle cannot model them directly.

## Adding a new table

1. Create `src/schema/<thing>.ts`. Use `pgTable`, custom column builders,
   `index()` and `primaryKey()` helpers — no hand-rolled SQL in the schema.
2. Export the table (and any enum) from `src/schema/index.ts`.
3. `pnpm db:generate` — review the produced SQL in `migrations/`.
4. `pnpm db:migrate` to apply locally.
5. Update the catalog below.

## Table catalog

| Table | Purpose | Hot path |
| --- | --- | --- |
| `users` | Authenticated principals (humans + service). citext email, TOTP + WebAuthn slots. | login |
| `sessions` | Cookie / refresh-token sessions. | refresh, revoke |
| `personal_access_tokens` | Long-lived API tokens (`of_pat_*`). sha256 hash + display prefix. | auth middleware |
| `ssh_keys` | OpenSSH public keys for `git push`. | SSH auth |
| `repositories` | Top-level repo metadata. `owner_type`+`owner_id` is polymorphic. | clone, push, webhook fan-out |
| `refs` | Branch/tag tip SHA + monotonic `version` for CAS. | **smart-HTTP push** |
| `oid_inventory` | Per-repo packfile inventory; per-OID membership lives in S3 `.idx`. | GC, repack |
| `teams` | Hierarchical org teams with `ltree` `path`. | permission computation |
| `team_members` | User ↔ team + role. | source for `permissions` recompute |
| `permissions` | Materialized effective `(repo, user)` role per source. | **push authz check** |
| `branch_protection` | Per-repo rule set keyed by ref pattern. | post-CAS push evaluation |
| `webhook_endpoints` | Outbound webhook subscriptions. KMS-encrypted secret. | event emission |
| `webhook_deliveries` | Durable delivery queue + retry log. Partial index on `(status, next_retry_at) WHERE status IN ('pending','failed')`. | **delivery worker** |
| `workflows` / `workflow_runs` / `workflow_jobs` / `workflow_secrets` | GitHub Actions-compatible engine (Phase 0 minimum; expanded in Phase 2). | runner pickup |
| `subscriptions` / `usage_meters` / `usage_rollups` / `stripe_events` | Billing state + Stripe webhook idempotency. | metered billing rollup |
| `audit_log` | Append-only audit trail, partitioned monthly by `created_at`. | trigger insert, "what happened to X" views |
| `lfs_objects` / `lfs_pointers` | LFS object catalog + per-repo pointer map (cross-tenant guard). | LFS upload/download |

## Advisory locks for refs

The smart-HTTP push handler needs to serialize concurrent updates to the
same `(repo_id, ref_name)`. `acquireRefLock(db, repoId, refName)` calls
`pg_try_advisory_xact_lock(hashtext(repo_id || ref_name))` — non-blocking,
transaction-scoped, auto-released on commit/rollback.

```ts
import { db, acquireRefLock } from '@openforge/db';

await db.transaction(async (tx) => {
  if (!(await acquireRefLock(tx, repoId, 'refs/heads/main'))) {
    throw new Error('ref busy, retry');
  }
  // CAS update on `refs` here; lock holds until commit.
});
```

## What's NOT here

- Application logic, query helpers beyond `acquireRefLock`, business rules.
- Stripe / KMS clients — those are `@openforge/integrations`.
- Migration runtime — `drizzle-kit` handles it; this package just ships SQL.
