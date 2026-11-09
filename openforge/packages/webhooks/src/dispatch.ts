/**
 * Webhook dispatch — actual HTTP POST delivery to a user-configured endpoint.
 *
 * Status code handling:
 *   - 2xx                          → success
 *   - 408 Request Timeout          → retry
 *   - 429 Too Many Requests        → retry (slow-drain lane)
 *   - 5xx                          → retry
 *   - other 4xx (incl. 410, 422)   → dead-letter (client error, not retrying)
 *   - network error / timeout      → retry
 */

import got, { type RequestError } from 'got'
import { pino } from 'pino'
import { eq } from 'drizzle-orm'
import { db } from '@openforge/db'
import { webhookDeliveries, webhookEndpoints } from '@openforge/db'
import { objectKey } from '@openforge/s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client, PRIMARY_BUCKET } from '@openforge/s3'
import { signPayload } from './signing.js'
import { enqueueRetry, enqueueDeadLetter } from './queue.js'
import { MAX_ATTEMPTS, nextRetryAt } from './backoff.js'

const log = pino({ name: 'webhook-dispatch' })

export interface DispatchResult {
  ok: boolean
  status?: number
  durationMs?: number
  error?: string
  retryScheduled?: boolean
  deadLettered?: boolean
}

const PERMANENT_4XX = new Set([400, 401, 403, 404, 405, 406, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 426, 428, 431, 451])
const RETRY_4XX = new Set([408, 425, 429])

export async function dispatchDelivery(deliveryId: string, attempt: number): Promise<DispatchResult> {
  const startedAt = Date.now()

  // 1. Load the delivery row
  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)
  if (!delivery) {
    log.warn({ deliveryId }, 'delivery not found')
    return { ok: false, error: 'delivery_not_found' }
  }

  // 2. Load the endpoint
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, delivery.endpointId))
    .limit(1)
  if (!endpoint) {
    log.warn({ deliveryId, endpointId: delivery.endpointId }, 'endpoint not found')
    await markFailed(deliveryId, 'endpoint_not_found', 0, Date.now() - startedAt)
    return { ok: false, error: 'endpoint_not_found' }
  }

  if (!endpoint.active) {
    log.info({ deliveryId, endpointId: endpoint.id }, 'endpoint inactive, skipping')
    await markSkipped(deliveryId, 'endpoint_inactive')
    return { ok: false, error: 'endpoint_inactive' }
  }

  // 3. Decrypt the endpoint secret (stored encrypted at rest)
  const secret = decryptSecret(endpoint.secretEnc)

  // 4. Fetch the payload from S3 (full body stored before enqueue)
  const body = await fetchPayload(delivery.payloadS3Key)

  // 5. Sign + POST
  const signature = signPayload(body, secret)
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'OpenForge-Hookshot/1.0',
    'x-openforge-event': delivery.eventType,
    'x-openforge-delivery': deliveryId,
    'x-openforge-attempt': String(attempt),
    'x-openforge-signature': signature,
  }

  try {
    const response = await got.post(endpoint.url, {
      body,
      headers,
      timeout: { request: 30_000 },
      retry: { limit: 0 }, // we manage retries
      throwHttpErrors: false,
      maxRedirects: 0,
      followRedirect: false,
      https: { rejectUnauthorized: !endpoint.insecureSsl },
    })

    const durationMs = Date.now() - startedAt
    const status = response.statusCode

    if (status >= 200 && status < 300) {
      await markSuccess(deliveryId, status, durationMs)
      return { ok: true, status, durationMs }
    }

    if (PERMANENT_4XX.has(status)) {
      await markDeadLetter(deliveryId, status, durationMs, `http_${status}`)
      return { ok: false, status, durationMs, deadLettered: true }
    }

    if (RETRY_4XX.has(status) || status >= 500) {
      return await scheduleRetry(deliveryId, endpoint.id, attempt, status, durationMs)
    }

    // Unknown status — treat as failure, retry
    return await scheduleRetry(deliveryId, endpoint.id, attempt, status, durationMs, `unknown_status_${status}`)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const e = err as RequestError
    const errorMsg = e.code ? `${e.code}: ${e.message}` : e.message
    log.warn({ deliveryId, attempt, error: errorMsg }, 'dispatch failed with transport error')
    return await scheduleRetry(deliveryId, endpoint.id, attempt, 0, durationMs, errorMsg)
  }
}

async function scheduleRetry(
  deliveryId: string,
  endpointId: string,
  attempt: number,
  status: number,
  durationMs: number,
  errorMsg?: string,
): Promise<DispatchResult> {
  if (attempt >= MAX_ATTEMPTS) {
    await markDeadLetter(deliveryId, status, durationMs, errorMsg ?? 'max_attempts_exceeded')
    return { ok: false, status, durationMs, deadLettered: true }
  }
  const nextAttempt = attempt + 1
  const delayMs = nextRetryAt(nextAttempt).getTime() - Date.now()
  await db
    .update(webhookDeliveries)
    .set({
      status: 'failed',
      attempts: nextAttempt,
      nextRetryAt: nextRetryAt(nextAttempt),
      lastError: errorMsg ?? `http_${status}`,
      responseStatus: status,
      responseDurationMs: durationMs,
    })
    .where(eq(webhookDeliveries.id, deliveryId))
  await enqueueRetry(deliveryId, endpointId, nextAttempt, delayMs)
  return { ok: false, status, durationMs, retryScheduled: true }
}

async function markSuccess(deliveryId: string, status: number, durationMs: number) {
  await db
    .update(webhookDeliveries)
    .set({
      status: 'success',
      responseStatus: status,
      responseDurationMs: durationMs,
      completedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId))
}

async function markFailed(deliveryId: string, reason: string, status: number, durationMs: number) {
  await db
    .update(webhookDeliveries)
    .set({ status: 'failed', lastError: reason, responseStatus: status, responseDurationMs: durationMs })
    .where(eq(webhookDeliveries.id, deliveryId))
}

async function markDeadLetter(deliveryId: string, status: number, durationMs: number, reason: string) {
  await db
    .update(webhookDeliveries)
    .set({
      status: 'dead_letter',
      lastError: reason,
      responseStatus: status,
      responseDurationMs: durationMs,
      completedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId))
}

async function markSkipped(deliveryId: string, reason: string) {
  await db
    .update(webhookDeliveries)
    .set({ status: 'failed', lastError: reason, completedAt: new Date() })
    .where(eq(webhookDeliveries.id, deliveryId))
}

async function fetchPayload(s3Key: string): Promise<string> {
  // Get the payload object from R2. We don't stream — webhook payloads are small (< 5MB typical).
  const response = await r2Client.send(
    new (await import('@aws-sdk/client-s3')).GetObjectCommand({
      Bucket: PRIMARY_BUCKET,
      Key: s3Key,
    }),
  )
  return await response.Body!.transformToString('utf-8')
}

function decryptSecret(_secretEnc: Buffer | Uint8Array | string): string {
  // Phase 1 stub: secrets stored encrypted-at-rest; for now, return as utf-8 string.
  // Phase 2: decrypt with @openforge/auth's crypto module using SECRET_ENCRYPTION_KEY.
  if (typeof _secretEnc === 'string') return _secretEnc
  return Buffer.from(_secretEnc).toString('utf-8')
}

// Suppress unused import warnings (objectKey reserved for future use)
void objectKey
void getSignedUrl
