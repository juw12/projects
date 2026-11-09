# @openforge/webhooks

Webhook delivery subsystem. Outbound HTTP POSTs to user-configured endpoints with HMAC-SHA256 signing, exponential backoff retries (matching GitHub's schedule), separate retry lane, dead-letter queue, and manual replay.

## Architecture

Top Risk #5 from the OpenForge architecture memo. The design addresses two failure modes:

1. **Synchronized retry storms** — a destination returning 429 at high rate can fill the queue to 300× normal depth, blocking healthy destinations. Mitigation: full-jitter backoff (random `[0, base)` instead of `base` exactly).
2. **Backlog starving first-attempts** — a failing destination's retries can pile up and delay fresh events. Mitigation: two separate BullMQ lanes (`webhook:first-attempts` and `webhook:retries`), with the retries lane at lower concurrency.

## Retry schedule

Matches GitHub's webhook retry cadence: 1, 5, 10, 20, 40, 80, 160, 320, 640 minutes, then hourly for 21 hours. Total: 30 attempts over ~24 hours.

`computeBackoffMs(attempt)` returns full-jitter: random integer in `[0, base)`. The randomness prevents synchronized retries from re-attacking the failing destination at peak rate.

## HTTP status handling

| Status | Action |
|---|---|
| 2xx | Mark delivery `success` |
| 408, 425, 429 | Retry (slow-drain lane) |
| 5xx | Retry |
| Other 4xx | Mark `dead_letter` immediately (don't retry client errors) |
| Network error / timeout | Retry |

## Queues

```
webhook:first-attempts   concurrency: 50 global, 5 per-endpoint
webhook:retries          concurrency: 30 global, 2 per-endpoint  
webhook:dead-letter      concurrency: 1, no auto-delivery
```

## Signing

All deliveries include:

```
X-OpenForge-Event: <event_type>
X-OpenForge-Delivery: <delivery_id>
X-OpenForge-Attempt: <attempt_number>
X-OpenForge-Signature: sha256=<hex_hmac>
```

Receivers verify by recomputing HMAC-SHA256 over the raw request body with their stored secret. Timing-safe comparison is essential — use `crypto.timingSafeEqual`, not `===`.

Recommended: include a timestamp header and verify with `verifySignatureWithTimestamp` (window: ±5 min) to defeat replay attacks.

## Usage

### Enqueue an event

```ts
import { enqueueWebhook } from '@openforge/webhooks'

await enqueueWebhook({
  eventType: 'push',
  eventId: `push-${repoId}-${commitSha}`, // stable idempotency key
  payload: {
    ref: 'refs/heads/main',
    before: '0000000000000000000000000000000000000000',
    after: commitSha,
    repository: { /* ... */ },
    pusher: { /* ... */ },
  },
})
```

### Start the worker

```bash
pnpm --filter @openforge/webhooks worker
```

### Replay a dead-letter delivery

```ts
import { replayDeadLetter } from '@openforge/webhooks'

await replayDeadLetter(deliveryId)
// or
import { replayAllForEndpoint } from '@openforge/webhooks'
await replayAllForEndpoint(endpointId)
```

## Operator runbook

**Queue depth alert** (>10k pending first-attempts): scale up worker concurrency or check Redis health.

**Retry queue depth alert** (>5k pending retries): check destination health. The retry schedule is exponential; a stuck endpoint will balloon this queue. Consider lowering the destination's per-endpoint concurrency or disabling it temporarily.

**Dead-letter rate** (>1% of total deliveries): investigate destination patterns. Are they all the same endpoint? All hitting 4xx? All timing out from a specific region?

## Security notes

- HMAC-SHA256 is required. Don't ship without it.
- Reject signatures with `bcrypt`-style prefixes — `sha256=` is the canonical format.
- Don't log the signature header value (it leaks the secret to log readers).
- Don't log the request body for deliveries to private endpoints (it may contain user data).
- The endpoint secret is stored encrypted-at-rest using `SECRET_ENCRYPTION_KEY` (AES-256-GCM). Phase 2 wires the decryption; Phase 1 has a placeholder.
