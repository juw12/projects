# @openforge/api

Hono v4 HTTP API server.

- `/healthz` — DB-aware health probe (lessons from Gitea/Forgejo)
- `/api/auth/*` — Better Auth (mounted from `@openforge/auth`)
- `/api/repos/*` — repo CRUD (Phase 1)
- `/{owner}/{repo}.git/{info/refs,git-upload-pack,git-receive-pack}` — Smart HTTP for git clone / fetch / push

## Run locally

```bash
pnpm install                                  # from the monorepo root
cp .env.example .env                          # fill in DATABASE_URL, R2_*, BETTER_AUTH_SECRET, SECRET_ENCRYPTION_KEY
pnpm db:migrate                               # creates tables in Postgres
pnpm dev                                      # starts the API on :8787
```

`pnpm dev` runs `tsx watch src/index.ts`, which prefers Bun if installed and falls back to `@hono/node-server` otherwise.

## Auth middleware

`apps/api/src/middleware/auth.ts` exports `authMiddleware`, mounted globally
in `src/index.ts` via `app.use('*', authMiddleware)`. It calls
`@openforge/auth`'s `auth.api.getSession({ headers })` and populates
`c.get('user')` and `c.get('session')` on the Hono context. Anonymous
requests (no `openforge_session` cookie or expired cookie) get
`user = null`; route handlers gate privileged work on
`c.get('user')?.id`.

The git smart-HTTP routes use a separate `extractAuth()` path that reads
the `Authorization` header directly, so the cookie session middleware does
not interfere with HTTP Basic / PAT pushes.

## Repo routes (`/api/repos`)

All `POST` / `PATCH` / `DELETE` / `fork` operations require an
authenticated session cookie. Reads (`GET /`, `GET /:owner/:repo`) also
require auth — anonymous traffic goes through the smart-HTTP layer
instead. The route layer uses `requireRepoAccess()` (in
`middleware/authorize.ts`) to resolve the repo and enforce read access on
`/:owner/:repo/*`.

| Method   | Path                          | Auth | Description                                          | Status      |
|----------|-------------------------------|------|------------------------------------------------------|-------------|
| `GET`    | `/api/repos`                  | yes  | List repos visible to the current user (paginated)   | 200         |
| `GET`    | `/api/repos/:owner/:repo`     | yes  | Get one repo's metadata                              | 200 / 404   |
| `POST`   | `/api/repos`                  | yes  | Create a repo (DB row → bare `git init --bare` → R2 prefix → owner permission) | 201 |
| `PATCH`  | `/api/repos/:owner/:repo`     | yes  | Update `visibility` / `defaultBranch`                | 200         |
| `DELETE` | `/api/repos/:owner/:repo`     | yes  | Soft-delete (`deleted_at = now()`); 30-day sweep     | 200         |
| `POST`   | `/api/repos/:owner/:repo/fork`| yes  | Fork into the caller's namespace (name in body)      | 201         |

### Create a repo

`POST /api/repos` with a JSON body:

```json
{
  "name": "hello-world",
  "visibility": "public",
  "defaultBranch": "main"
}
```

- `name` — 1–100 chars, must match `/^[a-zA-Z0-9._-]+$/`. 400 if not.
- `visibility` — `public` | `private` | `internal`. Defaults to `private`.
- `defaultBranch` — optional, 1–100 chars. Defaults to `main`.
- `description` — accepted but **not persisted** in Phase 1 (the
  `repositories` table doesn't have a `description` column yet; tracked
  for Phase 2).

The service inserts the DB row first to surface the unique constraint as
a typed `RepoError('already_exists', ..., 409)`, then runs
`git init --bare <barePath>` and sets `receive.denyCurrentBranch=ignore`
(so force-push during Phase 1 doesn't bounce), then best-effort uploads a
`repos/<owner>/<repo>/.keep` placeholder to R2 to claim the prefix, then
materializes a `permissions` row granting the creator `owner`/`admin` via
`source='direct'`. Every step writes an `audit_log` entry.

201 response shape:

```json
{
  "id": "5c5e...-uuid",
  "ownerId": "...",
  "ownerType": "user",
  "name": "hello-world",
  "defaultBranch": "main",
  "visibility": "public",
  "sizeBytes": 0,
  "objectCount": 0,
  "lfsSizeBytes": 0,
  "forkedFromId": null,
  "createdAt": "2026-11-03T...Z",
  "updatedAt": "2026-11-03T...Z",
  "deletedAt": null
}
```

### curl example

```bash
curl -X POST http://localhost:8787/api/repos \
  -b cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"hello-world","visibility":"public"}'
```

`cookies.txt` is the Netscape-format file produced by logging in via
`/api/auth/sign-in/email` (or by the web app's `auth-client`).

### Fork

`POST /api/repos/:owner/:repo/fork` with a JSON body:

```json
{ "name": "parent" }
```

- Caller must be authenticated and have read access on the source.
- Forks share the source's object store via
  `<forkBarePath>/objects/info/alternates`. The implementation does a
  full `git clone --bare --no-local --no-hardlinks` first (so the clone
  works across filesystems), then strips the cloned `objects/` directory
  and writes a relative `alternates` path. Read cost is ~zero for
  un-mutated forks.
- A `public` source forks into `private` by default (matches GitHub's
  behaviour — you opt-in to publicity explicitly). Other visibilities are
  inherited.
- `forkedFromId` is recorded on the new row; the web UI can render a
  "forked from" badge.

### Visibility filtering

- `GET /api/repos` returns the union of: (repos the user owns) ∪
  (`visibility = 'public'` ∨ `visibility = 'internal'`) ∪ (repos where
  the user has a `permissions` row). Limit defaults to 50, max 200.
- `GET /api/repos/:owner/:repo` returns 404 (never 403) when the caller
  lacks read access — this avoids leaking the existence of private repos.
- `PATCH` / `DELETE` require an `owner` / `admin` permission on the repo
  (the implicit owner of the repo, or a row in `permissions`).

### Soft delete + 30-day sweep

`DELETE /api/repos/:owner/:repo?hard=true` returns `400 hard delete not
allowed` — soft-delete only in Phase 1. The handler sets
`repositories.deleted_at = now()` and leaves the bare directory on disk.
The Phase 2 sweeper removes the disk path and the row after 30 days;
Phase 1 deliberately does not delete files synchronously because a hard
delete during a running push could corrupt packfile state.

## Service layer (`apps/api/src/services`)

| File                  | Purpose |
|-----------------------|---------|
| `repos.ts`            | `createRepo` / `getRepo` / `getRepoByDisplayName` / `listRepos` / `updateRepo` / `softDeleteRepo` / `forkRepo` / `RepoError` |
| `permissions.ts`      | `grantPermission` / `revokePermission` / `canAccess` / `materializeOrgPermissions` |
| `refs.ts`             | ref CAS — refs/ref-CAS agent's territory |
| `push-validation.ts`  | push handler validation |
| `git-ref-readback.ts` | ref read-back for the smart-HTTP layer |

`createRepo` and `forkRepo` shell out to `git` via `child_process.spawn`
(args as an array, no shell). Bare paths are computed inside the service
via `path.join(REPO_ROOT, owner, '<name>.git')` — owner / name are
validated against `/^[a-zA-Z0-9._-]+$/` so `..` and `/` cannot escape
`REPO_ROOT`.

## Lib layer (`apps/api/src/lib`)

| File           | Purpose |
|----------------|---------|
| `repo-path.ts` | `bareRepoPathFor(owner, repo)` (no disk check) + `resolveBareRepoPath(owner, repo)` (existence check). Used by the smart-HTTP layer. |
| `visibility.ts`| `getRepoMetadata(owner, repo)` (full `RepoMetadata`) + `getRepoVisibility(owner, repo)` (visibility-only wrapper, kept for `routes/git.ts`). |
| `permissions.ts` | `userCanReadRepo` / `userCanWriteRepo` / `userCanAdminRepo` / `repoOwnerUserId`. Independent role ranking; layered on top of the materialized `permissions` table plus the implicit owner check. |
| `can-push.ts`  | Phase 0 push authorization (replaced by `services/permissions.ts` `canAccess` in Phase 1). |
| `logger.ts`    | pino instance. |

## Atomic push contract (Phase 1, Risk #2)

`POST /git-receive-pack` is the only path that writes to both the
bare repo on disk and the `refs` table in Postgres. The two MUST
converge on every successful push. The implementation enforces this
as follows:

- **Concurrent pushes to the same repo serialize via a Postgres
  advisory lock** (`pg_try_advisory_xact_lock(hashtext(repo_id))`).
  Transaction-scoped, non-blocking, auto-releases on COMMIT/ROLLBACK.
  Per-ref granularity is available via `acquireRefLock` for callers
  outside the receive-pack hot path.
- **Failed pushes roll back the transaction (no DB state changes).**
  Git's `receive-pack` subprocess runs *inside* the transaction; if
  it exits non-zero, we throw and the advisory lock releases via the
  implicit ROLLBACK. The bare repo on disk may have partial state —
  a Phase 2 reconciler will sweep divergent refs.
- **Returns 409 Conflict if another push is in flight; client should
  retry.** The advisory lock acquisition is non-blocking; the route
  surfaces `RepoLockedError` as HTTP 409 with a retry hint. Every
  mainstream git client already backs off and retries on 409.
- **Version column is the canonical CAS token.** `updateRefs` issues
  `INSERT … ON CONFLICT … DO UPDATE … WHERE refs.version =
  $expectedVersion`. SHA matching happens in SQL, not TypeScript. A
  version mismatch throws `RefConflictError`; under the advisory lock
  this can only happen if a non-locked code path touched the row.
- **Bare-repo / DB divergence is a critical incident.** If git
  succeeded but the CAS update failed, we write a `severity=critical`
  audit row to `audit_log` and the route returns HTTP 500. The Phase
  2 reconciler (out of scope) reads these audit rows and replays the
  missed CAS updates.
- **Per-ref updates are all-or-nothing.** A push that updates several
  refs runs every CAS update in a single transaction; one failure
  rolls back the whole batch.

The `OPENFORGE_REPO_ID=$repoId` env var is set when the git
subprocess is spawned so post-receive hooks can look up repo
metadata (visibility, branch protection rules, webhook fan-out) via
the same DB row the lock guards.

## Layout

```
src/
  index.ts              — Hono app bootstrap (Bun → @hono/node-server fallback)
  middleware/
    request-id.ts       — sets requestId on every request (for error correlation)
    error.ts            — global error handler (HTTPException + unhandled errors)
    authorize.ts        — requireRepoAccess / requireRole (per-repo authz gates)
    auth.ts             — Better Auth session → c.get('user') / c.get('session')
  routes/
    health.ts           — GET /healthz, pings Postgres
    auth.ts             — wraps @openforge/auth's router
    repos.ts            — POST /api/repos, GET /api/repos, PATCH/DELETE/fork
    git.ts              — Smart HTTP: /info/refs, /git-upload-pack, /git-receive-pack
  lib/
    repo-path.ts        — bareRepoPathFor() + resolveBareRepoPath()
    visibility.ts       — getRepoMetadata() + getRepoVisibility() (wrapper)
    permissions.ts      — userCanReadRepo / userCanWriteRepo / userCanAdminRepo
    can-push.ts         — Phase 0 push authorization (superseded by services/permissions.ts)
    logger.ts           — pino instance
  services/
    repos.ts            — createRepo / getRepo / listRepos / updateRepo / softDeleteRepo / forkRepo / RepoError
    permissions.ts      — grantPermission / canAccess / materializeOrgPermissions
    __tests__/
      repos.test.ts     — vitest tests, mocks @openforge/db + @openforge/s3, runs real git
  types.ts              — Repository / NewRepository / Role / hasRoleAtLeast / rankToDbRole
```

## Constraints

- Hono v4.x only — no Express, no Fastify
- `@hono/zod-validator` for request validation
- `pino` for structured logging (console.log only for the bootstrap "listening" line)
- Smart HTTP handlers come from `@openforge/git-transport` — no packet-line or process spawning here
- All DB access uses Drizzle from `@openforge/db` (raw `SELECT 1` only in the healthz ping)
- Repository creation uses `child_process.spawn('git', ['init', '--bare', ...])` — args are an array, no shell. Path comes from validated inputs (regex `/^[a-zA-Z0-9._-]+$/`) so `..` and `/` can't escape `REPO_ROOT`.
- Forks use `git clone --bare --no-local --no-hardlinks` + an `objects/info/alternates` file pointing at the source's objects dir (GitHub's pattern for cheap forks). The implementation writes a relative alternates path.
