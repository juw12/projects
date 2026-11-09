/**
 * BullMQ queues for webhook delivery.
 *
 * Two separate lanes:
 *  - `webhook:first-attempts` — fresh events; higher concurrency
 *  - `webhook:retries` — retry attempts; lower concurrency to bound pressure on failing endpoints
 *
 * Why two queues instead of one with priorities: a backlog in retries must NOT starve
 * first-attempts. Head-of-line blocking in a single queue is the classic webhook
 * outage pattern (GitHub Oct 2022: a backlog of dead-end retries delayed fresh pushes
 * for 31 minutes).
 */

import { Queue, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'

export const QUEUE_FIRST_ATTEMPTS = 'webhook:first-attempts'
export const QUEUE_RETRIES = 'webhook:retries'
export const QUEUE_DEAD_LETTER = 'webhook:dead-letter'

export const FIRST_ATTEMPT_CONCURRENCY_GLOBAL = 50
export const FIRST_ATTEMPT_CONCURRENCY_PER_ENDPOINT = 5
export const RETRY_CONCURRENCY_GLOBAL = 30
export const RETRY_CONCURRENCY_PER_ENDPOINT = 2

let _connection: ConnectionOptions | null = null

export function getRedisConnection(): ConnectionOptions {
  if (_connection) return _connection
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  // BullMQ wants the raw connection options, not a URL string
  const urlObj = new URL(url)
  _connection = {
    host: urlObj.hostname,
    port: Number(urlObj.port || 6379),
    password: urlObj.password || undefined,
    username: urlObj.username || undefined,
    tls: urlObj.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ for blocking commands
  }
  return _connection
}

let _firstAttemptsQueue: Queue | null = null
let _retriesQueue: Queue | null = null
let _deadLetterQueue: Queue | null = null

export function firstAttemptsQueue(): Queue {
  if (!_firstAttemptsQueue) {
    _firstAttemptsQueue = new Queue(QUEUE_FIRST_ATTEMPTS, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1, // we manage retries ourselves via the separate retries queue
        removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 }, // keep 7d for debugging
        removeOnFail: { age: 30 * 24 * 3600, count: 50_000 },
      },
    })
  }
  return _firstAttemptsQueue
}

export function retriesQueue(): Queue {
  if (!_retriesQueue) {
    _retriesQueue = new Queue(QUEUE_RETRIES, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 3600, count: 50_000 },
      },
    })
  }
  return _retriesQueue
}

export function deadLetterQueue(): Queue {
  if (!_deadLetterQueue) {
    _deadLetterQueue = new Queue(QUEUE_DEAD_LETTER, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 365 * 24 * 3600 }, // keep dead-letters for a year
        removeOnFail: false,
      },
    })
  }
  return _deadLetterQueue
}

export async function shutdownQueues(): Promise<void> {
  await Promise.all([
    _firstAttemptsQueue?.close(),
    _retriesQueue?.close(),
    _deadLetterQueue?.close(),
  ])
  _firstAttemptsQueue = null
  _retriesQueue = null
  _deadLetterQueue = null
  _connection = null
}

/**
 * Enqueue a first-attempt delivery. Called by enqueueWebhook().
 */
export async function enqueueFirstAttempt(deliveryId: string, endpointId: string): Promise<void> {
  await firstAttemptsQueue().add(
    'deliver',
    { deliveryId, endpointId, lane: 'first' },
    { jobId: `${deliveryId}:1` }, // stable jobId for idempotency
  )
}

/**
 * Enqueue a retry with the given delay. The retry worker computes the next
 * backoff on failure (handles transient errors with exponential growth).
 */
export async function enqueueRetry(
  deliveryId: string,
  endpointId: string,
  attempt: number,
  delayMs: number,
): Promise<void> {
  await retriesQueue().add(
    'deliver',
    { deliveryId, endpointId, lane: 'retry', attempt },
    { jobId: `${deliveryId}:${attempt}`, delay: delayMs },
  )
}

/**
 * Move a delivery to dead-letter. No auto-replay — requires manual replayDeadLetter().
 */
export async function enqueueDeadLetter(deliveryId: string, endpointId: string, lastError: string): Promise<void> {
  await deadLetterQueue().add(
    'dead',
    { deliveryId, endpointId, lastError, deadAt: Date.now() },
    { jobId: `${deliveryId}:dead` },
  )
}
