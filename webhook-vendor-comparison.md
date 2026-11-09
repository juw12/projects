# Webhook Delivery Vendor Comparison
## OpenForge Architecture Decision - Build vs Buy
**Data as of: 2026-11-03**

> This document enumerates real, cited data from each vendor's current pricing, SLA, and technical
> documentation pages. No recommendations are made. All facts are sourced from URLs cited inline.

---

## 1. Svix (Cloud + OSS)

**Vendor**: Svix Inc. | **URL**: https://svix.com | **OSS**: https://github.com/svix/svix-webhooks

### Pricing

Source: https://svix.com/pricing (retrieved 2026-11-03)

| Plan | Base /mo | Included Messages | Overage Rate | Rate Limit | Payload Retention |
|------|----------|-------------------|--------------|------------|-------------------|
| Free |  | 50,000 | - | 50 msg/s | 7 days |
| Basic | from  | 50,000 | .0001/msg | 200 msg/s | 30 days |
| Professional | from  | 50,000 | .0001/msg | 800 msg/s | 90 days |
| Enterprise | Custom | Custom | Custom | Custom | Custom |

**Billing unit**: Each 64 KiB chunk of payload = 1 message. Only *attempted* messages are billed.
Retries are free. Filtered messages (no matching endpoints) are free.

**Volume discounts**: Available at Professional tier and above.
**Contract length**: Monthly (Free/Basic/Professional); Annual (Enterprise).
**Egress fees**: None stated.

### SLA

| Plan | Uptime SLA | Support Method |
|------|-----------|----------------|
| Free | None | Slack Community |
| Basic | 99.9% | Slack Community |
| Professional | 99.99% | Email |
| Enterprise | 99.999% | Slack + Email + Phone + Dedicated Slack |

**Regions**: US and EU isolated regions (all plans). Custom regions (Enterprise only).
**Enterprise extras**: 24/7/365 on-call engineer, Account Manager, White-Glove Onboarding.

### Retry Policy

Source: https://docs.svix.com/retries (last updated Oct 9, 2026)

| Attempt | Delay After Previous |
|---------|---------------------|
| 1 | Immediate |
| 2 | 5 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 5 hours |
| 7 | 10 hours |
| 8 | 10 hours |

**Total max attempts**: 8 | **Total retry window**: ~43 hours
**Status codes triggering retry**: Any non-2xx (including 3xx). Only 2xx = success.
**Success timeout**: 30 seconds
**Jitter**: Not explicitly documented (fixed schedule)
**Customizability**: Standard (free schedule) on Free/Basic/Professional; Custom on Enterprise
**Abort mechanism**: Consumer sends webhook-delivery: abort-message header
**Auto-disable**: Endpoint disabled after 5 days of total failure (with 12h gap between failures)

### Dead-Letter Queue

- **TTL**: Per plan retention (7d/30d/90d/custom)
- **Alerting**: Operational webhook message.attempt.exhausted
- **Replay**: Single resend, "Recover Failed" (bulk), "Replay Missing" (never-attempted)
- **Export**: JSON via API; S3/GCS/Azure Blob (Professional+); Snowflake/BigQuery/Redshift (Enterprise)

### Ordering Guarantees

- **Default**: No ordering guarantee
- **FIFO endpoints**: Enterprise tier only ("Strict FIFO ordered webhook delivery")
- **Granularity**: Per-endpoint (per consumer app)

### Delivery Guarantee

**At-least-once** (explicitly stated in FAQ). Duplicates from retries are NOT billed.

### Signing

- **Schemes**: HMAC-SHA256 (symmetric, default) + Ed25519 (asymmetric)
- **Headers**: svix-id, svix-timestamp, svix-signature
- **Standard Webhooks**: **YES** - Svix co-created the spec. Branded aliases of webhook-id,
  webhook-timestamp, webhook-signature. Any Standard Webhooks lib can verify Svix webhooks.
- **Secret prefix**: whsec_ (symmetric), whsk_/whpk_ (asymmetric)
- **Rotation**: Via API (update endpoint secret). No dual-key grace period documented.
- **Additional auth (Enterprise)**: OAuth 2.0, mTLS
- **Custom signature scheme**: Enterprise only

### Replay Window

7 days (Free), 30 days (Basic), 90 days (Professional), custom (Enterprise).

### Notable Customers

Brex, Lob, Lithic, Guesty, Replicate, Stitch Money, 360Learning, Resend, SafeBase, Clerk,
Benchling, Drata. Scale: "billions of webhooks a year."

### OSS Component

- **License**: MIT | **Language**: Rust | **Stars**: 3,500 | **Commits**: 4,064
- **Dependencies**: PostgreSQL (required), Redis (optional)
- **Gap vs Cloud**: "some features, optimizations, and behaviors supported by the hosted
  dispatcher are not yet available in this repo"
- **Standard Webhooks spec**: https://github.com/standard-webhooks/standard-webhooks
  (compatible implementations: OpenAI, Anthropic, Google Gemini, Brex, Kong, Twilio, Etsy,
  PagerDuty, Clerk, Resend, ngrok, Lob, Render, Lithic + 30 more)

---

## 2. Hookdeck

**Vendor**: Hookdeck Technologies Inc. | **URL**: https://hookdeck.com | **OSS**: None

### Pricing

Source: https://hookdeck.com/pricing (retrieved 2026-11-03)

| Plan | Base /mo | Included Events/mo | Retention | Users |
|------|----------|--------------------|-----------|-------|
| Developer |  (always) | 10,000 | 3 days | 1 |
| Team | from  | 10,000 | 7 days | Unlimited |
| Growth | from  | 10,000 | 30 days | Unlimited |
| Enterprise | Custom | Custom | Custom | Unlimited |

**Per-event pricing (tiered)**:

| Monthly Volume | Price per 100k |
|---------------|----------------|
| Up to 5,000,000 | .00 |
| 5,000,001 - 10,000,000 | .00 |
| 10,000,001 - 20,000,000 | .00 |
| 20,000,001 - 200,000,000 | .75 |
| 200,000,001 - 500,000,000 | .50 |
| Over 500,000,000 | .35 |

**Retries are FREE** (included in event pricing).
**Throughput**: 5 events/sec/destination included; additional: .00-.00 per event/sec tier.
**Static IP add-on**: +/project. **Discarded requests**: +.50/million beyond 100k.
**Billing granularity**: Pro-rated by 10k events.

### SLA

| Plan | Uptime SLA | Latency SLA |
|------|-----------|-------------|
| Developer/Team | None | None |
| Growth | 99.999% | 99.99% |
| Enterprise | 99.999% | 99.99% |

**Real-world uptime** (status.hookdeck.com, 180-day as of 2026-11-03):
- Event Delivery: 99.951%
- Admin API: 99.998%
- Outpost API: 99.990%
- Retries: 99.989%

**Notable 180d incidents**: 3h 3m Outpost outage (Jul 2026), 2h 59m ingestion degradation
(Jul 2026), 1h 53m delivery latency (Oct 2026).

**Regions**: Not publicly listed.

### Retry Policy

Source: https://hookdeck.com/docs/retries (retrieved 2026-11-03)

- **Max automatic retries**: 50 (manual retries unlimited)
- **Strategies**: Linear (fixed interval) or Exponential (doubles each time)
- **Configurable per connection**: count, interval, strategy, status codes
- **Default timeout**: 60 seconds (max 15 minutes)
- **Status codes**: Fully configurable (ranges, inclusion, exclusion: 500-599, !501)
- **Retry-After header**: Supported. Up to 7 days future. -1 cancels retries.
- **Identifying retries**: x-hookdeck-will-retry-after header (seconds until next retry)
- **Jitter**: Not documented
- **Triggers**: Timeout, network error, configured status codes

### Dead-Letter Queue

- **TTL**: Per plan (3d/7d/30d/custom)
- **Alerting**: Issues system. Integrations: Slack, Discord, MS Teams, PagerDuty, Better Stack,
  incident.io, Sentry
- **Replay**: Single retry, bulk retry, "Replay" (full pipeline re-ingest, can route to new connections)
- **Export**: JSON via API. Metrics export: Datadog, New Relic, Dynatrace, Prometheus (Growth+)

### Ordering Guarantees

- **Delivery Groups**: Per-tenant isolation with independent queues, rates, observability
- **FIFO**: Not explicitly documented
- **No global ordering guarantee**

### Delivery Guarantee

**At-least-once** (stated: "Hookdeck has the same 'at least once' guarantee").
**Duplicates**: Retries not billed separately.

### Signing

- **Standard Webhooks**: NOT compliant
- **Headers**: x-hookdeck-* (e.g., x-hookdeck-eventid)
- **Verification of incoming**: Supports provider-specific verification (Stripe, GitHub, etc.)
- **Rotation**: Per-connection via dashboard/API

### Notable Customers

No logos on pricing page. SOC2 Type 2 badge. G2 reviews linked. No explicit scale claims.

### OSS

**None.** Fully closed-source, cloud-managed.

---

## 3. Convoy (Cloud + OSS)

**Vendor**: Frain Inc. | **URL**: https://getconvoy.io | **OSS**: https://github.com/frain-dev/convoy

### Pricing

Source: https://getconvoy.io/pricing (retrieved 2026-11-03)

**Self-Hosted**:

| Plan | Price | Users | Projects | Events |
|------|-------|-------|----------|--------|
| Free Trial |  (14 days) | 1 | 2 | Unlimited |
| Community |  forever | 1 | 1 | Unlimited |
| Premium | /mo | Unlimited | Unlimited | Unlimited |
| Enterprise | Custom | Custom | Custom | Custom |

**Cloud**: Flat monthly price with throughput limit. No per-message metering.
"Flat and predictable. Each plan is a fixed monthly price with a set throughput limit."

**Key**: No per-message pricing. Volume discounts at Enterprise. Startup discounts available.

### SLA

- Community/Premium (self-hosted): No SLA (you operate it)
- Cloud: Not publicly listed
- Enterprise: "Dedicated support & SLA" (custom)
- **Status page**: https://status.getconvoy.io

### Retry Policy

From GitHub README:
- **Algorithms**: Constant time + Exponential backoff **with jitter**
- **Batch retries**: For endpoints that consecutively fail
- **Circuit breaking**: Opens on consecutive failures, probes before resuming (Premium)
- **Specific counts/intervals**: Configured per endpoint (not publicly documented)

### Dead-Letter Queue

- **Endpoint disable**: Consecutive failures trigger endpoint disable + notification
- **Alerting**: Email, Slack, Microsoft Teams
- **Retention**: "Advanced webhook retention" (Premium)
- **Export**: Not documented

### Signing

- **Payload signing**: Yes (HMAC-based, per README)
- **Auth methods**: Bearer token, OAuth2, mTLS
- **Rolling secrets**: Yes (listed as feature)
- **Standard Webhooks**: Not stated as compliant
- **Headers**: Not documented in fetched pages

### OSS Component

- **License**: **Elastic License v2.0** (source-available, NOT Apache/MIT)
- **Language**: Go | **Stars**: 2,900 | **Commits**: 1,732
- **Dependencies**: PostgreSQL, Redis (or Postgres queue with license)
- **Architecture**: server + gent (scale independently)
- **Community limits**: 1 user, 1 org, 2 projects
- **License restriction**: Cannot offer as competing managed service

---

## 4. AWS EventBridge

**Vendor**: Amazon Web Services | **URL**: https://aws.amazon.com/eventbridge | **OSS**: None

### Pricing

Source: https://aws.amazon.com/eventbridge/pricing/ (retrieved 2026-11-03)

**Custom Event Bus (Enhanced, launched Sept 2026)**:

| Dimension | Rate |
|-----------|------|
| Ingress (first 5,000 GB/mo) | .18/GB |
| Ingress (above 5,000 GB/mo) | .12/GB |
| Egress (per subscription) | .05/GB |
| Storage (beyond default) | .08/GB/month |
| Event evaluation | .15/M (64KB chunks) |

**Custom Event Bus (Classic)**:

| Event Type | Ingress | Delivery (cross-account) |
|-----------|---------|--------------------------|
| AWS management | .00/M (free) | .00/M |
| Partner | .00/M | .05/M |
| Custom | .00/M | .00/M ( same-account) |

**API Destinations**: .20 per million events (64 KB = 1 event).
**Pipes**: .40 per million requests.
**Replay**: .00/M (replayed) + .10/GB (archive processing) + .023/GB/mo (storage).

**Free Tier**: AWS management events free. Scheduler: 14M invocations/mo free.
**Egress**: Standard AWS Data Transfer (public internet: ~.09/GB after 100GB free).

### SLA

- **Standard AWS SLA**: 99.9% (typical for application integration services)
- **Regions**: 28+ regions for API destinations (full list in docs)
- **No webhook-specific SLA**

### Retry Policy

Source: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html

- **Max retries**: 185 (default: 3)
- **Max window**: 24 hours
- **Timeout per request**: 5 seconds
- **Retry on**: 401, 407, 409, 429, 5xx
- **Do NOT retry on**: 1xx, 2xx, 3xx, 4xx (except above)
- **Retry-After**: Read. Chooses more conservative of policy vs header. Negative = stop.
- **Jitter**: Not documented
- **Configurable**: Per rule (max attempts, max event age)

### Dead-Letter Queue

- **DLQ**: Yes (SQS queue). If no DLQ configured, "the event is dropped."
- **TTL**: Up to 14 days (SQS max)
- **Alerting**: CloudWatch + SNS
- **Replay**: EventBridge Replay feature + manual DLQ re-publish
- **Export**: JSON (SQS). No native S3 (requires Lambda)

### Signing

- **NO HMAC/ed25519 payload signing**
- **Auth**: AWS SigV4, API keys, OAuth 2.0, Basic auth (via Connections)
- **Headers**: User-Agent: Amazon/EventBridge/ApiDestinations
- **mTLS**: NOT supported
- **Standard Webhooks**: NOT compatible
- **Rotation**: AWS Secrets Manager

### Ordering

- Enhanced bus: "ordered delivery" (feature listed)
- Default/Classic: No ordering
- **FIFO**: Not first-class. No per-tenant ordering.

### Delivery Guarantee

At-least-once. **Retries ARE billed** (egress on enhanced; per-event on API destinations).

### OSS

**None.** Fully managed AWS service.

---

## 5. Azure Event Grid

**Vendor**: Microsoft Azure | **URL**: https://azure.microsoft.com/en-us/services/event-grid | **OSS**: None

### Pricing

Source: https://azure.microsoft.com/en-us/pricing/details/event-grid/ (retrieved 2026-11-03)

**NOTE**: Azure pricing page loads rates dynamically via JS. Static HTML shows "$-" for all rates.
Known structure (from page layout + FAQ):

**Standard Tier** (Event Grid Namespace - MQTT + pull/push):
- Throughput unit per hour: region-dependent
- Per million MQTT operations: region-dependent
- Per million event operations: region-dependent
- Free: 1,000,000 operations/month
- Event retention: 7 days free

**Basic Tier** (Custom topics, system topics, partner topics):
- Per million operations: region-dependent
- Free: 100,000 operations/month
- Event retention: 1 day free

**Billing unit**: 64 KB per operation.
**What's billed**: Publish, delivery attempts, advanced filtering, subject "ends with" filter.
**What's free**: Event type matching, "subject begins with" filter, retention within limits.
**Egress**: Standard Azure bandwidth charges. No egress for same-region delivery.

### SLA

- **SLA**: 99.9% (per Microsoft Online Services SLA, November 2026 edition)
- **Regions**: 40+ Azure regions (Central US, East US, West Europe, East Asia, etc.)
- **Downtime credits**: Per Microsoft SLA terms

### Retry Policy

- **Mechanism**: Exponential backoff (not publicly specified with exact intervals/counts)
- **DLQ after exhaustion**: Yes ("rejected events that require dead letter" = billable op)
- **Status codes**: Non-2xx triggers retry (not configurable per docs)
- **Jitter**: Not documented

### Dead-Letter Queue

- **DLQ**: Yes (internal)
- **TTL**: 1 day (Basic) / 7 days (Standard)
- **Alerting**: Azure Monitor
- **Replay**: Not first-class. Events in DLQ processed by consumer.
- **Export**: JSON (CloudEvent)

### Signing

- **NO HMAC/ed25519** (in the Standard Webhooks sense)
- **Auth**: Shared Access Key, Azure AD (Entra ID)
- **Event signature**: Event Grid events include a signature field (HMAC of event using topic key)
- **Standard Webhooks**: NOT compatible
- **Format**: CloudEvents 1.0 or Event Grid Schema
- **Rotation**: Via Azure Key Vault (rotate topic key)

### Ordering

**None.** Pub-sub model. No per-resource or per-tenant ordering.

### Delivery Guarantee

At-least-once. **Each delivery attempt IS billed** (retries cost money).

### OSS

**None.** Fully managed Azure service.

---

## 6. Google Eventarc

**Vendor**: Google Cloud | **URL**: https://cloud.google.com/eventarc | **OSS**: None

### Pricing

Source: https://cloud.google.com/eventarc/pricing (retrieved 2026-11-03)

**Eventarc Standard**:

| Component | Rate |
|-----------|------|
| First 50,000 events/month | Free |
| Google sources |  per million |
| Pub/Sub sources |  per million |
| Other sources |  per million (free in Preview) |
| Pub/Sub transport | /TiB (first 10 GiB free) |

**Eventarc Advanced**:

| Component | Rate |
|-----------|------|
| Bus publishing | .00 / 1,000,000 |
| Pipeline messages | .50 / 1,000,000 |
| Transformations | .40 / 1,000,000 |

**Billing unit**: Standard: 64 KiB/event. Advanced: 16 KiB/event.
**Egress**: Pub/Sub data transfer (/TiB). Receiver (Cloud Run/Functions) billed separately.
**Regional pricing**: Uniform across GCP regions (no regional differentiation for Eventarc itself).

### SLA

- Not explicitly on pricing page. Underlying Pub/Sub SLA: 99.95%.
- **Regions**: Multiple GCP regions.

### Retry Policy

- Via Pub/Sub: up to 50 redeliveries (default), 10 min max delivery time, 7 days retention.
- Cloud Run receiver: retries on non-2xx, configurable timeout.
- **Jitter**: Not documented.

### Dead-Letter Queue

- **Pub/Sub DLQ topic**: Yes (messages after 50 redeliveries)
- **TTL**: 7-30 days (Pub/Sub configurable)
- **Alerting**: Cloud Monitoring / Cloud Logging
- **Replay**: Re-subscribe / re-publish
- **Export**: JSON (CloudEvent). Pub/Sub to BigQuery (native).

### Signing

- **NO HMAC/ed25519**
- **Auth**: Google IAM, OAuth 2.0, IAP
- **Format**: CloudEvents 1.0
- **Standard Webhooks**: NOT compatible
- **Rotation**: Secret Manager / IAM

### Ordering

**None.** Pub/Sub at-least-once. No ordering guarantee.

### Delivery Guarantee

At-least-once (via Pub/Sub). **Redeliveries NOT separately billed** (data volume model).
Cloud Run invocations ARE billed per use.

### OSS

**None.** Fully managed GCP service.

---

## 7. Cross-Vendor Comparison Matrix

### Pricing Summary (as of 2026-11-03)

| Vendor | Free Tier | Entry Paid | Billing Model |
|--------|-----------|-----------|---------------|
| **Svix** | 50k msgs/mo | /mo (Basic) | Per 64KB message (.0001) |
| **Hookdeck** | 10k events/mo | /mo (Team) | Per event (tiered .35-/100k) |
| **Convoy** | 1 org, 2 projects | /mo (Premium) | Flat per plan |
| **AWS EventBridge** | Mgmt events free | Usage-based | Per GB (Enhanced) / per event (Classic) |
| **Azure Event Grid** | 100k-1M ops | Usage-based | Per 64KB operation |
| **GCP Eventarc** | 50k events/mo | /M (Standard) | Per million events |

### SLA Comparison

| Vendor | Best Uptime SLA | Latency SLA | Regions |
|--------|----------------|-------------|---------|
| **Svix** | 99.999% (Enterprise) | Not stated | US, EU, custom (Ent) |
| **Hookdeck** | 99.999% (Growth+) | 99.99% (Growth+) | Not publicly listed |
| **Convoy** | Custom (Enterprise) | Not stated | Not listed |
| **AWS EventBridge** | 99.9% (standard AWS) | Not stated | 28+ regions |
| **Azure Event Grid** | 99.9% | Not stated | 40+ regions |
| **GCP Eventarc** | 99.95% (via Pub/Sub) | Not stated | Multiple GCP regions |

### Retry Policy Comparison

| Vendor | Max Attempts | Backoff | Jitter | Configurable | Retry-After |
|--------|-------------|---------|--------|-------------|-------------|
| **Svix** | 8 (fixed) | Exponential (fixed) | Not stated | Enterprise only | Via abort header |
| **Hookdeck** | 50 | Linear or Exponential | Not stated | Fully (per conn) | Yes (7 days max) |
| **Convoy** | Configurable | Constant or Exp+Jitter | Yes | Per endpoint | Not documented |
| **AWS EventBridge** | 185 max / 3 def | Exponential (undocumented) | Not stated | Per rule | Yes |
| **Azure Event Grid** | Not public | Exponential (undocumented) | Not stated | No | Not documented |
| **GCP Eventarc** | 50 (Pub/Sub) | Exponential (Pub/Sub) | Not stated | Via Pub/Sub | Via Cloud Run |

### Signing Comparison

| Vendor | Scheme | Standard Webhooks | Headers | Rotation |
|--------|--------|-------------------|---------|----------|
| **Svix** | HMAC-SHA256 + Ed25519 | **YES** (co-creator) | svix-id/timestamp/signature | Per-endpoint API |
| **Hookdeck** | Proprietary | No | x-hookdeck-* | Per-connection |
| **Convoy** | HMAC | No | Not documented | Rolling secrets |
| **AWS EventBridge** | SigV4 / API key / OAuth | No | User-Agent + auth | Secrets Manager |
| **Azure Event Grid** | SAS + event signature | No | CloudEvent signature field | Key Vault |
| **GCP Eventarc** | IAM / OAuth 2.0 | No | N/A (CloudEvents) | Secret Manager |

### DLQ / Replay Comparison

| Vendor | DLQ | TTL | Replay | Export | Alerting |
|--------|-----|-----|--------|--------|----------|
| **Svix** | Yes | 7/30/90d/custom | Single+bulk+Missing | JSON, S3, Snowflake | Op webhook |
| **Hookdeck** | Yes | 3/7/30d/custom | Single+bulk+Full | JSON, Metrics | Issues (Slack/PD) |
| **Convoy** | Implied | Not public | Batch retries | Not documented | Email/Slack/Teams |
| **AWS EB** | Yes (SQS) | Up to 14d | Replay + DLQ | JSON (SQS) | CloudWatch+SNS |
| **Azure EG** | Yes (internal) | 1d/7d | Not first-class | JSON | Azure Monitor |
| **GCP EA** | Yes (Pub/Sub DLQ) | 7-30d | Re-subscribe | JSON, BigQuery | Cloud Monitoring |

### Ordering Comparison

| Vendor | FIFO | Per-Resource | Per-Tenant |
|--------|------|-------------|------------|
| **Svix** | Enterprise only | No | No (per-endpoint) |
| **Hookdeck** | Not documented | No | Delivery Groups |
| **Convoy** | Not documented | No | No |
| **AWS EventBridge** | Enhanced bus | No | No |
| **Azure Event Grid** | No | No | No |
| **GCP Eventarc** | No | No | No |

### OSS vs Managed

| Vendor | OSS | License | Language | Stars | Self-Host Viable? |
|--------|-----|---------|----------|-------|-------------------|
| **Svix** | Yes | **MIT** | Rust | 3,500 | Yes - full feature target |
| **Hookdeck** | None | Closed | - | - | No |
| **Convoy** | Yes | **Elastic v2.0** | Go | 2,900 | Yes (no competing SaaS) |
| **AWS EventBridge** | None | Closed | - | - | No |
| **Azure Event Grid** | None | Closed | - | - | No |
| **GCP Eventarc** | None | Closed | - | - | No |

---

## 8. Cost Projections at OpenForge Scale

### Startup: ~100k events/day (~3M events/month)

| Vendor | Est. Monthly Cost | Calculation |
|--------|------------------|-------------|
| **Svix Basic** | ~ |  + (2.95M x .0001) |
| **Svix Professional** | ~ |  + (2.95M x .0001) |
| **Hookdeck Team** | ~ |  + (3M x /100k) |
| **Hookdeck Growth** | ~ |  +  |
| **Convoy Community** |  | Self-hosted (1 user limit) |
| **Convoy Premium** |  | Flat |
| **AWS EB (API Dest)** | ~.60 | 3M x .20/M |
| **AWS EB (Enhanced)** | ~.40 | 6GB x .18 + egress |
| **Azure EG (Basic)** | ~.80 | 3M x ~.60/M (est) |
| **GCP Eventarc** | ~- | Under free tier or /M |

### Mid-Market: ~10M events/day (~300M events/month)

| Vendor | Est. Monthly Cost | Calculation |
|--------|------------------|-------------|
| **Svix Pro** | ~,490 |  + (299.95M x .0001) |
| **Svix Enterprise** | Custom | Volume discounts |
| **Hookdeck Growth** | ~,034 |  + +++++ |
| **Convoy Premium** |  | Flat (unlimited events) |
| **AWS EB (API Dest)** | ~ | 300M x .20/M |
| **AWS EB (Enhanced)** | ~+ | 600GB x .18 + egress (1 sub) |
| **Azure EG (Basic)** | ~ | 300M x ~.60/M |
| **GCP Eventarc (Adv)** | ~ | 300M x  + 300M x .50 |

### Enterprise: ~100M events/day (~3B events/month)

| Vendor | Est. Monthly Cost | Notes |
|--------|------------------|-------|
| **Svix Enterprise** | Custom | High volume discounts |
| **Hookdeck Enterprise** | ~,489-2,009 | .33-0.35/100k at floor |
| **Convoy Enterprise** | Custom | Volume discounts |
| **AWS EB (API Dest)** | ~ | 3B x .20/M + egress |
| **AWS EB (Enhanced)** | ~,000+ | 6TB x .18 + egress/sub |
| **Azure EG (Basic)** | ~,800 | 3B x ~.60/M |
| **GCP Eventarc (Adv)** | ~,500 | 3B x  + 3B x .50 |

*These are rough estimates. Actual costs depend on payload size, number of subscriptions/endpoints,
region, and negotiated discounts. Cloud pricing (AWS/Azure/GCP) scales with consumers, not just events.*

---

## 9. Signing and Interoperability

### Standard Webhooks Compatibility

Only **Svix** implements the Standard Webhooks specification (and co-created it).

**Standard Webhooks spec** (https://github.com/standard-webhooks/standard-webhooks):
- Headers: webhook-id, webhook-timestamp, webhook-signature
- Scheme: HMAC-SHA256 (default), Ed25519 (optional)
- Libraries: Python, JS/TS, Java/Kotlin, Rust, Go, Ruby, PHP, C#, Elixir
- Compatible: OpenAI, Anthropic, Google Gemini, Brex, Kong, Twilio, Etsy, PagerDuty,
  Clerk, Resend, ngrok, Lob, Render, Lithic + 30 more (see standardwebhooks.com)

**Implication for OpenForge**: If OpenForge's event schema targets Standard Webhooks, any vendor
switch later preserves consumer compatibility. Using vendor-specific schemes (Hookdeck, AWS, Azure,
GCP) creates lock-in at the verification layer.

### Header Name Compatibility

| Vendor | ID Header | Timestamp Header | Signature Header |
|--------|-----------|-----------------|-----------------|
| Svix | svix-id (or webhook-id) | svix-timestamp (or webhook-timestamp) | svix-signature (or webhook-signature) |
| Hookdeck | x-hookdeck-eventid | - | - (not documented) |
| AWS EB | - | - | - (uses connection auth) |
| Azure EG | - | - | signature (in body) |
| GCP EA | - | - | - (uses IAM) |
| Convoy | Not documented | Not documented | Not documented |

---

## 10. Dead-Letter and Replay Summary

| Vendor | DLQ Mechanism | Alerting | Replay API | Replay Window |
|--------|--------------|----------|-----------|---------------|
| Svix | Failed message state | Op webhook (exhausted) | Single / Bulk / Recover / Replay Missing | 7/30/90d/custom |
| Hookdeck | Failed events + Issues | Issues (Slack, PD, etc) | Single / Bulk / Full Replay | 3/7/30d/custom |
| Convoy | Endpoint disable | Email/Slack/Teams | Batch retries | Not public |
| AWS EB | SQS DLQ queue | CloudWatch + SNS | EventBridge Replay / DLQ re-publish | Configurable archive |
| Azure EG | Internal DLQ | Azure Monitor | Not first-class | 1d/7d |
| GCP EA | Pub/Sub DLQ topic | Cloud Monitoring | Re-subscribe / re-publish | 7-30d |

---

## 11. Regional Coverage and Egress

### Regions

| Vendor | Regions | Data Residency |
|--------|---------|----------------|
| Svix | US, EU + Custom (Ent) | Isolated regions (all paid tiers) |
| Hookdeck | Not publicly listed | Not documented |
| Convoy | Not listed (self-host: anywhere) | Self-host: your infra |
| AWS EB | 28+ regions | Per-region isolation |
| Azure EG | 40+ regions | Per-region isolation |
| GCP EA | Multiple GCP regions | Per-region isolation |

### Egress Fees

| Vendor | Egress Model |
|--------|-------------|
| Svix | None (folded into per-message price) |
| Hookdeck | None stated |
| Convoy | None stated (flat pricing) |
| AWS EB | Standard AWS Data Transfer (~.09/GB after 100GB free) + PrivateLink |
| Azure EG | Standard Azure bandwidth. Free same-region. |
| GCP EA | Pub/Sub: /TiB (10 GiB free/mo). Receiver billed separately. |

---

## 12. Support Tier Differences

| Vendor | Free/Entry | Mid | Enterprise |
|--------|-----------|-----|------------|
| Svix | Slack Community | Email + Basic SLA | 24/7 on-call, AM, phone, custom SLA |
| Hookdeck | Community Slack | Community + Email | Slack Connect, support mgr, premium |
| Convoy | Community (Slack/GitHub) | Priority support (Premium) | Dedicated + SLA + solutions eng |
| AWS EB | Free (community) | Business (/mo) | Enterprise (+/mo) |
| Azure EG | Community | Standard (per support plan) | Professional/Premium (per plan) |
| GCP EA | Community | Standard (.95+/mo) | Enterprise (per contract) |

---

## 13. Open Questions and Data Gaps

1. **Azure Event Grid exact per-operation rate**: The pricing page loads rates via JavaScript.
   The static HTML does not contain numeric values. Need to query the Azure Retail Prices API
   or use the pricing calculator with a specific region selected.

2. **Hookdeck regions**: Not publicly listed anywhere on their site. Contact sales required.

3. **Convoy Cloud pricing**: The pricing page only shows self-hosted tiers. Cloud plan pricing
   requires signup or sales contact. The FAQ confirms flat-rate model but no public numbers.

4. **Convoy retry specifics**: The etrystrategies/ directory in the repo has the code, but
   the exact default counts/intervals are not in the README or public docs.

5. **AWS EventBridge enhanced bus**: Launched September 2026. Limited public documentation.
   The pricing page has the rate structure but SLA and ordering specifics need deeper docs review.

6. **Hookdeck SLA credit terms**: The pricing page states 99.999% but does not detail the credit
   formula (e.g., 30% credit for <99.9%, 100% for <99%).

7. **Svix jitter**: The retry schedule is fixed (no documented randomization). Whether internal
   jitter is applied is not stated.

8. **Eventarc SLA**: The Eventarc product page does not state its own SLA. It inherits from
   the underlying services (Pub/Sub: 99.95%, Cloud Run: 99.9%).

9. **Convoy DLQ specifics**: No dedicated DLQ documentation found. The endpoint disable +
   notification mechanism may not be a true persistent DLQ.

10. **Azure Event Grid retry specifics**: The exact backoff intervals and max retry count are
    not publicly documented with precision. Azure docs reference "exponential backoff" without
    specific numbers.

---

## 14. Key Architectural Considerations for OpenForge

### Event Schema Constraints by Vendor

| Constraint | Affected Vendors |
|-----------|-----------------|
| Max payload 64 KB (billed in chunks) | Svix, Hookdeck, AWS EB, Azure EG, GCP EA (Std) |
| Max payload 16 KB (Advanced) | GCP Eventarc Advanced |
| Max payload 512 KiB | GCP Eventarc Standard |
| Max payload 256 KB (billing) | AWS EB (64KB chunks, 4 chunks max per event in examples) |
| CloudEvents required | Azure EG, GCP EA |
| JSON only | All (no binary payloads without base64) |
| HMAC signing required | Svix (Standard Webhooks) |
| No signing support | AWS EB, Azure EG, GCP EA (use platform IAM instead) |

### Multi-Tenancy Support

| Vendor | Tenant Isolation | Tenant-Scoped Rate Limits | Tenant Portal |
|--------|-----------------|--------------------------|---------------|
| Svix | Consumer Applications (DB-level) | Yes (per endpoint) | Yes (embeddable App Portal) |
| Hookdeck | Delivery Groups | Yes (per group) | Yes (via API) |
| Convoy | Per-project endpoints | Yes (per endpoint) | Yes (iframe embed) |
| AWS EB | Per-rule (manual) | No (per destination) | No |
| Azure EG | Per-subscription (manual) | No | No |
| GCP EA | Per-trigger (manual) | No | No |

---

*End of document. All data retrieved 2026-11-03. Pricing subject to change; re-verify before decision.*
