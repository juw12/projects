/**
 * @openforge/webhooks
 *
 * Webhook delivery subsystem: BullMQ-backed outbound HTTP POSTs with HMAC-SHA256
 * signing, full-jitter exponential backoff, separate retry lane, dead-letter
 * queue, and manual replay.
 *
 * Architecture (Top Risk #5 from the OpenForge memo):
 *   webhook:first-attempts  →  high concurrency (50)
 *   webhook:retries         →  lower concurrency (30) — bounds pressure on failing endpoints
 *   webhook:dead-letter     →  no auto-delivery; manual replay only
 *
 * Why two lanes: a backlog in retries must NOT starve first-attempts. Head-of-line
 * blocking in a single queue is the GitHub Oct 2022 outage pattern.
 */

export { signPayload, verifySignature, verifySignatureWithTimestamp, SIGNATURE_HEADER, SIGNATURE_PREFIX } from './signing.js'
export { computeBackoffMs, baseBackoffMs, nextRetryAt, RETRY_SCHEDULE_MINUTES, MAX_ATTEMPTS } from './backoff.js'
export {
  firstAttemptsQueue,
  retriesQueue,
  deadLetterQueue,
  enqueueFirstAttempt,
  enqueueRetry,
  enqueueDeadLetter,
  shutdownQueues,
  QUEUE_FIRST_ATTEMPTS,
  QUEUE_RETRIES,
  QUEUE_DEAD_LETTER,
} from './queue.js'
export { dispatchDelivery } from './dispatch.js'
export { enqueueWebhook, type WebhookEvent } from './enqueue.js'
export { replayDeadLetter, replayAllForEndpoint } from './replay.js'
export { startWorkers } from './worker.js'
