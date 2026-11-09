/**
 * Idempotent webhook enqueue.
 *
 * For each subscribed endpoint, insert a webhook_deliveries row (UNIQUE on
 * (endpoint_id, event_id) prevents duplicates), upload the payload to S3,
 * and enqueue a first-attempt job.
 */

import { eq, and, inArray } from 'drizzle-orm'
import { db } from '@openforge/db'
import { webhookEndpoints, webhookDeliveries } from '@openforge/db'
import { r2Client, PRIMARY_BUCKET } from '@openforge/s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import { enqueueFirstAttempt } from './queue.js'
import { pino } from 'pino'

const log = pino({ name: 'webhook-enqueue' })

export interface WebhookEvent {
  eventType: string
  eventId: string // stable, idempotency key
  payload: Record<string, unknown>
}

export async function enqueueWebhook(event: WebhookEvent): Promise<{ deliveredTo: number; skippedDuplicates: number }> {
  // 1. Find all endpoints subscribed to this event
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.active, true), inArray(webhookEndpoints.events, [event.eventType])))

  let deliveredTo = 0
  let skippedDuplicates = 0

  for (const endpoint of endpoints) {
    const deliveryId = randomUUID()
    const payloadKey = `webhook-payloads/${deliveryId}.json`
    const payloadBody = JSON.stringify({
      event: event.eventType,
      event_id: event.eventId,
      payload: event.payload,
    })

    try {
      // 2. Insert delivery row (UNIQUE constraint catches duplicates)
      await db.insert(webhookDeliveries).values({
        id: deliveryId,
        endpointId: endpoint.id,
        eventType: event.eventType,
        eventId: event.eventId,
        payloadS3Key: payloadKey,
        status: 'pending',
        attempts: 0,
        maxAttempts: 30,
        nextRetryAt: new Date(),
      })
    } catch (err: unknown) {
      // Likely the UNIQUE (endpoint_id, event_id) constraint — duplicate
      const msg = (err as Error).message ?? ''
      if (msg.includes('unique') || msg.includes('duplicate')) {
        skippedDuplicates++
        continue
      }
      throw err
    }

    // 3. Upload payload to S3
    await r2Client.send(
      new PutObjectCommand({
        Bucket: PRIMARY_BUCKET,
        Key: payloadKey,
        Body: payloadBody,
        ContentType: 'application/json',
      }),
    )

    // 4. Enqueue first-attempt
    await enqueueFirstAttempt(deliveryId, endpoint.id)
    deliveredTo++
  }

  log.info({ eventType: event.eventType, eventId: event.eventId, deliveredTo, skippedDuplicates }, 'webhook enqueued')
  return { deliveredTo, skippedDuplicates }
}
