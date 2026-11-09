# OpenForge runner ↔ API wire protocol

The runner is a stateless worker: each invocation handles ONE job, then exits. The orchestrator (API server) is responsible for job assignment, scheduling, and lifecycle.

## Job dispatch

The orchestrator spawns the runner container with:

- **Job metadata on stdin** as a single JSON document, terminated by EOF
- **mTLS certificate on the filesystem** at `/tmp/job-cert.pem` (ephemeral, expires in 60 min)
- **Environment variables** for the API endpoint and runner registration

```json
{
  "jobId": "uuid",
  "repoOwner": "acme",
  "repoName": "widgets",
  "ref": "refs/heads/main",
  "commitSha": "abc123...",
  "workflowPath": ".github/workflows/ci.yml",
  "secrets": [
    { "name": "DEPLOY_KEY", "value": "..." }
  ],
  "runnerLabels": ["self-hosted", "linux", "x64"],
  "requestedNetwork": "none",
  "timeoutSeconds": 3600,
  "memoryLimitMb": 4096,
  "cpuLimit": 2,
  "gitBinarySha256": "abc123..."
}
```

The runner reads this from stdin, validates the schema, then begins execution.

## Lifecycle

```
Orchestrator                    Runner Container
─────────────                   ────────────────
spawn container (--runtime=runsc, --read-only)
write job.json to stdin
                                 read job.json
                                 verify git binary SHA-256
                                 clone target repo (if network=clone-source)
                                 execute workflow steps
                                   │
                                 POST /logs (chunked, 64KB)
                                   │
                                 POST /status updates
                                 exit with job's exit code
container destroyed
next job dispatched
```

## Log streaming

The runner streams logs back over HTTP/2 to the orchestrator's `/api/runs/{jobId}/logs` endpoint. The orchestrator appends to S3 (`job-logs/{runId}/{jobId}/{chunkSeq}.log`) and fans out to any WebSocket subscribers (the web UI).

Log chunk format:
```
{
  "stream": "stdout" | "stderr",
  "data": "base64-encoded bytes",
  "timestamp": "2026-11-04T12:34:56.789Z",
  "seq": 12345
}
```

The orchestrator persists chunks in arrival order. Reordering is not allowed (a job's log must be sequentially readable).

**Log redaction**: the runner runs a regex pass over every chunk before POSTing:
- `(?i)(password|token|secret|api[_-]?key)\s*[:=]\s*\S+` → `[REDACTED]`
- AWS access keys: `AKIA[0-9A-Z]{16}` → `[REDACTED]`
- Private keys: `-----BEGIN [A-Z ]+PRIVATE KEY-----` → `[REDACTED]`

The redaction is best-effort. Receivers should NOT trust webhook payloads to be free of secrets.

## Job completion

On completion (success or failure), the runner POSTs:

```
POST /api/runs/{jobId}/complete
Content-Type: application/json

{
  "exitCode": 0,
  "durationMs": 123456,
  "logsS3Key": "job-logs/run-uuid/job-uuid/00000123.log",
  "error": null
}
```

The orchestrator marks the run as `success` (exit 0) or `failure` (non-zero), and updates the workflow_runs table.

## Cancellation

The orchestrator sends `SIGTERM` to the runner's main process. The runner has 30 seconds to clean up:

1. Flush all pending log chunks
2. POST `/api/runs/{jobId}/complete` with `cancelled: true`
3. Exit 0

If the runner doesn't exit within 30s, the orchestrator sends `SIGKILL`. Logs may be truncated.

## Timeouts

- **Hard wall-clock timeout**: 60 minutes (configurable per job, max 6 hours)
- **Step timeout**: 30 minutes per step (configurable per step)
- **Network timeout**: 30 seconds per outbound request
- **Log POST timeout**: 10 seconds

When the hard timeout fires, the runner exits with code 124 (timeout convention).

## Error codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 2 | Misuse of shell builtins |
| 64–78 | BSD sysexits.h convention (EX_USAGE, EX_DATAERR, etc.) |
| 100 | Job validation failed |
| 101 | Git binary verification failed |
| 102 | Repo clone failed |
| 124 | Wall-clock timeout |
| 130 | SIGINT (ctrl-C) |
| 137 | SIGKILL (orchestrator hard cancel) |

## Connection security

- **mTLS only.** The runner authenticates the orchestrator via the client cert; the orchestrator authenticates the runner via the same cert (the cert's CN encodes the runner's identity).
- **Cert rotation**: the orchestrator issues a new cert at job dispatch time. Old certs are revoked on the orchestrator's side immediately.
- **No long-lived credentials.** The runner has no API tokens, no SSH keys, no service account credentials. The job-scoped cert is the only identity.

## Versioning

The wire protocol is versioned via a `protocolVersion` field in the job metadata JSON. Current version: `1`. Breaking changes increment the major version.

## References

- BullMQ job options (used for orchestrator-side queueing): <https://docs.bullmq.io/>
- mTLS with Node.js: <https://nodejs.org/api/tls.html>
- GitHub Actions runner protocol (inspiration, not directly compatible): <https://github.com/actions/runner>
