# E2E tests

**Status:** Scaffold ready. Requires `DATABASE_URL` (Postgres + migrations applied) to actually run.

## What this exercises

The E2E test (`apps/api/src/__tests__/e2e/oidc-roundtrip.test.ts`) covers the full **OIDC token round-trip**:

1. Insert a test runner + SHA-256-hashed registration token into the DB
2. Insert a `runner_jobs` row assigning the test runner to a job
3. Send `POST /api/v1/runner/oidc-token` with `Authorization: Bearer <plaintext>`
4. Verify the server:
   - Hashes the bearer and looks it up in `runner_registration_tokens`
   - Checks `runnerOwnsJob` (runner actually assigned to that job)
   - Mints an HS256 JWT with the requested `cache_mode` + `permissions` claims
5. Verify the JWT round-trip:
   - Signature verifies with the same secret
   - `iss`, `aud`, `sub`, `cache_mode`, `permissions` claims all correct
   - `exp` is ~5 minutes from now (within tolerance)
6. Verify tampering detection:
   - Modified signature → rejected with "signature mismatch"
   - Modified issuer → rejected

## What's NOT yet covered (out of scope for the scaffold)

- The actual Go runner binary: the test mocks the runner side via HTTP requests. To exercise the full runner flow, you need `go test` in `openforge/runner` with the Go code reading and forwarding.
- Webhook delivery end-to-end
- Real sandbox boot (requires `runsc`/`kata-runtime` installed)
- Real egress filter (requires eBPF or iptables)
- Concurrent job dispatch

These belong in a separate integration suite that runs against a fully provisioned host.

## Setup

```bash
# 1. Bring up Postgres
docker run -d --name openforge-pg-e2e -p 55432:5432 \
  -e POSTGRES_USER=openforge -e POSTGRES_PASSWORD=openforge \
  -e POSTGRES_DB=openforge postgres:16

# 2. Apply migrations (from openforge/packages/db)
export DATABASE_URL=postgres://openforge:openforge@localhost:55432/openforge
psql $DATABASE_URL < migrations/0000_initial.sql
psql $DATABASE_URL < migrations/0001_runners.sql
psql $DATABASE_URL < migrations/0002_fork_pr_permissions.sql

# 3. Run the E2E tests
cd openforge/apps/api
DATABASE_URL=postgres://openforge:openforge@localhost:55432/openforge \
  pnpm vitest run src/__tests__/e2e
```

## Files

- `apps/api/src/__tests__/e2e/setup.ts` — boots the Hono app in-process, sets `OIDC_ISSUER` + `OIDC_SIGNING_SECRET` env vars, exposes a `fetch()` wrapper
- `apps/api/src/__tests__/e2e/oidc-roundtrip.test.ts` — the test itself
