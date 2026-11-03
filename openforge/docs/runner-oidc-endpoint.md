# OpenForge server-side: OIDC token endpoint

**Route:** `POST /api/v1/runner/oidc-token`
**Mounted at:** `apps/api/src/routes/runner.ts`
**Service:** `apps/api/src/services/oidc-token.ts`

## Spec

Mirrors the runner-side client (`openforge/runner/internal/app/openforge/oidc.go`). See
`openforge/runner/INTEGRATION.md` § "OIDC token injection" for the full
spec.

### Request

```json
{
  "jobId": 42,
  "audience": "sts.amazonaws.com",
  "lifetimeSec": 300
}
```

- `jobId` — required, positive integer. The runner's job ID.
- `audience` — required, non-empty string ≤ 512 chars. Echoed back in the response so the runner can detect server misconfiguration. Common values: `sts.amazonaws.com`, `container.googleapis.com`, `https://kubernetes.default.svc`, or a custom workload-identity audience.
- `lifetimeSec` — optional, default 300, hard max 900 (15 minutes). Anything longer is suspicious and rejected.

### Response (200)

```json
{
  "value": "header.payload.signature",
  "expiresAt": "2026-11-03T12:05:00.000Z",
  "audience": "sts.amazonaws.com",
  "jobId": 42,
  "notBefore": "2026-11-03T12:00:00.000Z",
  "issuer": "forge.example.com"
}
```

### Errors

| Status | When |
|--------|------|
| 400 | Schema validation failed (missing/negative jobId, empty audience, lifetimeSec > 900) |
| 401 | Missing or invalid Bearer token |
| 500 | Token issuance failed (e.g. signing key not configured) |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `OIDC_ISSUER` | yes | The canonical host that will appear in the `iss` claim. The runner verifies it matches what it expects. |
| `OIDC_SIGNING_SECRET` | yes | HS256 signing secret. Must be at least 32 bytes. **Use 64 random bytes in production.** |

## Algorithm

HS256 today (HMAC-SHA256, symmetric). Production should migrate to RS256
with a per-recipient JWKS endpoint so runners can verify without sharing a
secret with the server. Out of scope for Phase 1.

## Verification

```bash
# 1. Issue a token
curl -sX POST http://localhost:8787/api/v1/runner/oidc-token \
  -H "Authorization: Bearer <runner-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"jobId": 42, "audience": "sts.amazonaws.com"}' | jq

# 2. Decode the JWT (header.payload.signature)
echo "<jwt>" | cut -d. -f2 | base64 -d | jq

# 3. Verify with the same secret the server uses
```

## Tests

`apps/api/src/services/__tests__/oidc-token.test.ts` covers:

- config validation (empty issuer, short secret)
- default lifetime (5 min)
- custom lifetime within bounds
- rejection of lifetimeSec > 15 min
- rejection of non-positive jobId
- rejection of empty audience
- distinct jti per call
- signature verification round-trip
- expired-token rejection
- wrong-secret rejection
- malformed-token rejection

Run: `pnpm --filter @openforge/api test`
