/**
 * webhook_deliveries — durable queue + delivery log for outbound webhooks.
 *
 * payload_s3_key points at the canonical event JSON in object storage; the
 * worker streams it to the endpoint on each attempt. UNIQUE(endpoint_id, event_id)
 * is the idempotency guarantee — emitting the same event twice enqueues nothing.
 *
 * Partial index on (status, next_retry_at) WHERE status IN ('pending','failed')
 * keeps the worker poll cheap: only retryable rows are scanned.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { webhookEndpoints } from './webhook-endpoints.js';

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'in_flight',
  'success',
  'failed',
  'dead_letter',
]);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventId: text('event_id').notNull(), // idempotency key from emitter
    payloadS3Key: text('payload_s3_key').notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(30),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    responseStatus: integer('response_status'),
    responseDurationMs: integer('response_duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_endpoint_event_uq').on(t.endpointId, t.eventId),
    index('webhook_deliveries_retry_idx')
      .on(t.status, t.nextRetryAt)
      .where(sql`status IN ('pending','failed')`),
  ],
);
