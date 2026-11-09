/**
 * Manual replay of a dead-letter delivery.
 *
 * When an endpoint comes back online (e.g., fixed a bug), operators can
 * replay specific deliveries or all dead-letters for an endpoint.
 */

import { eq } from 'drizzle-orm'
import { db } from '@openforge/db'
import { webhookDeliveries, webhookEndpoints } from '@openforge/db'
import { enqueueFirstAttempt } from './queue.js'
import { pino } from 'pino'

const log = pino({ name: 'webhook-replay' })

export async function replayDeadLetter(deliveryId: string): Promise<{ ok: boolean; reason?: string }> {
  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)
  if (!delivery) return { ok: false, reason: 'delivery_not_found' }
  if (delivery.status !== 'dead_letter') return { ok: false, reason: 'not_in_dead_letter' }

  await db
    .update(webhookDeliveries)
    .set({
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      completedAt: null,
    })
    .where(eq(webhookDeliveries.id, deliveryId))

  await enqueueFirstAttempt(deliveryId, delivery.endpointId)
  log.info({ deliveryId, endpointId: delivery.endpointId }, 'dead-letter replayed')
  return { ok: true }
}

export async function replayAllForEndpoint(endpointId: string): Promise<{ replayed: number }> {
  const dead = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))

  let replayed = 0
  for (const d of dead) {
    const result = await replayDeadLetter(d.id)
    if (result.ok) replayed++
  }
  return { replayed }
}

// Suppress unused import (webhookEndpoints reserved for endpoint-scoped queries)
void webhookEndpoints
