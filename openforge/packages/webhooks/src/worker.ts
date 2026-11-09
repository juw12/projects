/**
 * BullMQ Worker entrypoint for the webhook subsystem.
 *
 * Run with: pnpm --filter @openforge/webhooks worker
 *
 * Three workers:
 *   - first-attempts: high concurrency, fresh events
 *   - retries: lower concurrency, retry storms contained
 *   - dead-letter: NO auto-delivery; only manual replay via replayDeadLetter()
 */

import { Worker, type Job } from 'bullmq'
import { getRedisConnection, QUEUE_FIRST_ATTEMPTS, QUEUE_RETRIES, QUEUE_DEAD_LETTER } from './queue.js'
import { dispatchDelivery } from './dispatch.js'
import { pino } from 'pino'

const log = pino({ name: 'webhook-worker' })

export async function startWorkers(): Promise<void> {
  const conn = getRedisConnection()

  const firstAttemptsWorker = new Worker(
    QUEUE_FIRST_ATTEMPTS,
    async (job: Job) => {
      const { deliveryId } = job.data
      log.info({ deliveryId, jobId: job.id }, 'first-attempt delivery')
      return await dispatchDelivery(deliveryId, 1)
    },
    { connection: conn, concurrency: 50 },
  )

  const retriesWorker = new Worker(
    QUEUE_RETRIES,
    async (job: Job) => {
      const { deliveryId, attempt } = job.data as { deliveryId: string; attempt: number }
      log.info({ deliveryId, attempt, jobId: job.id }, 'retry delivery')
      return await dispatchDelivery(deliveryId, attempt)
    },
    { connection: conn, concurrency: 30 },
  )

  const deadLetterWorker = new Worker(
    QUEUE_DEAD_LETTER,
    async (job: Job) => {
      // No auto-delivery. The dead-letter queue is for inspection and replay only.
      log.info({ jobId: job.id, data: job.data }, 'dead-letter inspection (no-op)')
      return { skipped: true }
    },
    { connection: conn, concurrency: 1 },
  )

  for (const w of [firstAttemptsWorker, retriesWorker, deadLetterWorker]) {
    w.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'job failed'))
    w.on('error', (err) => log.error({ err }, 'worker error'))
  }

  log.info({ queues: [QUEUE_FIRST_ATTEMPTS, QUEUE_RETRIES, QUEUE_DEAD_LETTER] }, 'webhook workers started')

  // Graceful shutdown
  const shutdown = async () => {
    log.info('shutting down workers')
    await Promise.all([firstAttemptsWorker.close(), retriesWorker.close(), deadLetterWorker.close()])
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorkers().catch((err) => {
    log.error({ err }, 'failed to start workers')
    process.exit(1)
  })
}
