/**
 * stripe — billing state, usage meters, and webhook idempotency.
 *
 * subscriptions is the authoritative Stripe mirror (idempotently upserted
 * from webhooks). usage_meters append every meter event; usage_rollups is the
 * daily bucket that actually ships to Stripe's usage API.
 *
 * stripe_events is keyed by Stripe's event id (e.g. evt_xxx) — duplicates
 * from at-least-once webhook delivery collapse here.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const subscriptionTier = pgEnum('subscription_tier', ['free', 'team', 'enterprise']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'trialing',
]);
export const usageMeterType = pgEnum('usage_meter_type', [
  'storage_gb_hour',
  'bandwidth_egress_gb',
  'actions_minutes',
  'lfs_storage_gb',
  'registered_users',
]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubId: text('stripe_sub_id').notNull(),
  tier: subscriptionTier('tier').notNull().default('free'),
  status: subscriptionStatus('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

export const usageMeters = pgTable(
  'usage_meters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    meterType: usageMeterType('meter_type').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_meters_org_period_idx').on(t.orgId, t.meterType, t.periodStart)],
);

export const usageRollups = pgTable(
  'usage_rollups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    meterType: usageMeterType('meter_type').notNull(),
    period: date('period').notNull(),
    totalQuantity: numeric('total_quantity', { precision: 18, scale: 6 }).notNull(),
    pushedToStripeAt: timestamp('pushed_to_stripe_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.meterType, t.period] }),
    index('usage_rollups_period_idx').on(t.period),
  ],
);

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(), // evt_...
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
