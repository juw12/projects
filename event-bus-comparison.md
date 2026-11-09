# OpenForge Event Bus — Technology Comparison (Architecture RFC Input)

**Scope:** Internal event bus for a self-hosted Git platform (OpenForge) on which the
webhook delivery service sits. 1 region, 1 binary, startup scale **today**; clean
migration path to multi-region **tomorrow**.
**Authors:** Librarian (research) — evidence-based, no marketing.
**Date:** 2026-11-03
**Repos pinned:** nats-server `dc55f4b` (v2.15.2) · redis `dc1e7e2` (8.10.3) · kafka `598caf0` (4.x)

---

## 0. TL;DR — Recommendation

**Primary: NATS + JetStream** as the event bus the webhook delivery service consumes from.
**Explicit alternative (zero new infra):** a **Postgres outbox table + LISTEN/NOTIFY wake-up**
if you want to defer the broker entirely while you are well under ~1M events/day.
**Not recommended:** Apache Kafka (premature by ~2 orders of magnitude), GCP Pub/Sub and
AWS SNS+SQS (vendor lock-in + no self-hosted/on-prem parity, which a *self-hosted* Git
platform cannot accept as its primary bus).

Why NATS+JetStream wins for **this** constraint set (1-region → multi-region, 1 binary,
webhook durability + replay + retention, self-hosted):

1. It is the single choice that a Git platform of comparable ambition has already made.
   **GitLab evaluated Kafka, RabbitMQ, GCP Pub/Sub, AWS Kinesis, and NATS, and picked
   NATS+JetStream**, explicitly rejecting Kafka on ops/distribution grounds. (Section 6.2)
2. It is one compiled Go binary with **no ZooKeeper / KRaft / JVM / Erlang dependency** —
   the "1 binary" constraint. Single node today, 3-node Raft cluster later, multi-region
   via JetStream mirror/leaf without a re-architecture.
3. It gives the webhook service what it actually needs: durable streams, replay,
   retention, per-receiver pull consumers, at-least-once delivery, native Prometheus
   metrics. Form3 **replaced SNS+SQS with NATS+JetStream** and cut latency ~6x (300ms→50ms).
4. At your scale you are using **<0.1% of its throughput ceiling**, so you are buying
   durability + ops-simplicity + a migration path — not raw throughput.

The honest counterweight you must design around: **JetStream's durability evidence base is
weaker than Kafka's** (one Jepsen run at v2.12.1 showing data loss on power failure /
single-bit / split-brain; a 2-minute default deferred-fsync). See Section 5.1 and the
mitigations in Section 7. This is why the recommendation is conditional on the durability
controls in Section 7 — and why a Postgres-backed outbox is a defensible fallback.

---

## 1. The scale math (this decides everything)

Every throughput number in the industry (Kafka 1M+, NATS 800K, Redis 650K, RabbitMQ-streams
1.2M msg/s) is **irrelevant to you** because your volume is two to three orders of magnitude
smaller than the floor of any of them.

| | 100k events/day | 10M events/day |
|---|---|---|
| Average rate | **1.16 msg/s** | **116 msg/s** |
| Peak (≈10x, bursty webhook traffic) | ~12 msg/s | ~1,160 msg/s |
| At 1 KB/event, per month | ~3.2 GB | ~315 GB |
| % of NATS JetStream ceiling (~800k msg/s) | 0.00015% | 0.015% |
| % of Kafka ceiling (~1.2M msg/s) | 0.0001% | 0.01% |

**Implication:** You are not choosing a broker to move messages. You are choosing:
(a) a **durability + replay + retention** mechanism for webhooks (at-least-once, redeliver,
buffer, per-receiver ordering, dead-letter), and (b) the **lowest-ops, self-hosted,
multi-region-migratable** box that provides it. Throughput is a non-differentiator here;
persistence semantics + operational footprint + egress from vendor lock-in are the axes.

This is the entire "do we even need Kafka?" answer in one table. We revisit it in §8.

---

## 2. What the webhook delivery service actually needs (requirements)

From GitHub's public push-flow design (a push → Kafka event → fan-out to independent
consumers, one per task group, with retries + feature-flagging to avoid double processing)
and Atlassian's two-stage webhook pipeline (Events Queue → matching → Webhooks Queue →
delivery, with rate limits, exponential backoff, DLQ, and per-recipient concurrency limits):

- **R1 Durable ingest.** The event must survive a broker/process crash before the
  downstream delivery succeeds (ack-on-durable-write; "acknowledge the webhook only after
  the broker durably recorded it, or you reintroduce event loss").
- **R2 At-least-once + idempotent consumers.** Redelivery will happen; consumers must dedupe.
- **R3 Replay.** Re-drive a window of history (after a bad consumer deploy, for new
  subscribers, to rebuild a DLQ). Kafka/Retain, JetStream, Redis Streams, and a Postgres
  table all do this; classic NATS core and SNS do **not**.
- **R4 Retention / buffering.** Absorb spikes; hold events for a bounded window (7–31 days
  is the norm) so a downed delivery service does not lose webhooks.
- **R5 Per-receiver ordering.** Webhooks to the same receiver URL must be ordered
  (GitHub keys events by receiver; the same key ⇒ in-order).
- **R6 Fan-out.** One event → N consumers (delivery, audit, analytics, indexing).
- **R7 Dead-letter + reconciliation.** Failed deliveries go to a DLQ; a reconciliation job
  catches stragglers.
- **R8 Self-hosted / on-prem parity.** A *self-hosted* Git platform must run the bus
  identically in .com, dedicated, and air-gapped on-prem (GitLab's stated constraint).
- **R9 Multi-region path.** Region-local today; replicate/failover later without re-arch.

A technology that satisfies R1–R6 and R8/R9 with minimal ops is the candidate. That is
JetStream (R8 via single binary), a Postgres outbox (R8 via "you already run Postgres"),
and Kafka (R8 is its weakest: JVM cluster, cost-prohibitive at small scale).

---

## 3. Technology deep-dives

Each section: throughput ceiling (real numbers) · latency p50/p99 (real numbers) ·
persistence · operational complexity · real footguns (linked) · Git-platform users · cost.

### 3.1 Postgres LISTEN/NOTIFY

**What it is:** In-DB pub/sub. `NOTIFY channel, 'payload'` wakes sessions that have
`LISTEN channel`. **Not a queue** — it is a live signal with at-most-once, no-replay
semantics. The durable mechanism is the **table**; NOTIFY is only the wake-up.

**Throughput ceiling (real):** No official benchmark. A single-process round-trip
benchmark (Nimbus, 2026) measured **2,471 msg/s with p99 = 5,619 ms** — i.e., Postgres
pub/sub is *latency-bound and single-connection-bound*, not a high-throughput bus. The
real ceiling is the **DB commit path**: a Postgres mailing-list report (2020, Brian
Dunavant) found throughput "decreased quite a bit" as listeners were added, and production
guides (2026) note "**NOTIFY serializes commits under load**" — every notifier waits on the
notification queue. Practically: fine into the thousands of msg/s for a *wake-up signal*,
but it is not a firehose.

**Latency p50/p99 (real):** Sub-millisecond when a listener is attached (asyncpg, 2026:
callback fires "in under a millisecond"). But: **delivered at COMMIT, not at NOTIFY** — a
NOTIFY inside an open transaction is invisible until commit (measured: 0 received 300ms
after NOTIFY, 1 immediately after COMMIT). p99 in the round-trip benchmark was ~5.6 s
because of connection handling, not the signal itself.

**Persistence guarantees:** **None.** At-most-once, live-only, no replay. If no session is
listening when NOTIFY fires, the message is gone. Rolled-back transaction ⇒ notification
never existed. **The only way to get durability is the outbox table** (write the row,
NOTIFY as the nudge, `FOR UPDATE SKIP LOCKED` claim, periodic sweep). PgQueuer ADR-0003
states this explicitly: "LISTEN/NOTIFY wakes workers up; it never delivers work."

**Operational complexity:** **Zero new infrastructure** — you already run Postgres. One
dedicated *session* per process (LISTEN must not ride a pooled request connection).
**Footgun: LISTEN does not work through PgBouncer in transaction-pooling mode** (the mode
most production stacks use) — you need session-pooling or a direct connection for listeners.

**Real footguns (linked):**
- Payload **capped just under 8,000 bytes** (7,999 OK; 8,000 ⇒ `payload string too long`).
  [sql-notify](https://www.postgresql.org/docs/current/sql-notify.html) · [asyncpg measured](https://async-concurrency.com/network-io-protocol-handling/async-database-drivers/using-listen-notify-with-asyncpg/) · [PgQueuer ADR](https://janbjorge.github.io/pgqueuer/adr/ADR-0003-notifications-signal-not-carry/)
- **No replay / at-most-once.** [Sequin](https://blog.sequinstream.com/all-the-ways-to-capture-changes-in-postgres/) · [Neon](https://neon.com/guides/pub-sub-listen-notify)
- **8 GB notification queue**; a listener stuck in a long transaction blocks cleanup and
  eventually makes `NOTIFY` **fail at commit**. [sql-notify Notes](https://www.postgresql.org/docs/current/sql-notify.html)
- **PgBouncer transaction mode breaks LISTEN.** [nerdleveltech 2026](https://nerdleveltech.com/postgres-listen-notify-job-queue)
- **Burst DoS:** a million-row migration firing per-row NOTIFY can flood app servers.
  [matthewpalma 2026](https://matthewpalma.dev/blog/postgresql-listen-notify-real-time-invalidation-patterns-and-limits)
- **Resync order bug:** must `LISTEN` *then* snapshot; the reverse loses the gap.
  [monpg 2026](https://monpg.app/blog/postgresql-listen-notify-queue-pitfalls)

**Git-platform users:** The **outbox table** pattern is exactly what small/mid platforms run
in-process. **g1t.sh** (docs) runs a durable **SQLite log + per-service fan-out queues + DLQ
with 3 retries** — i.e., "table-as-source-of-truth + wake-up," not a broker. SourceHut
(sr.ht) uses **direct HTTP callbacks between services, no central broker at all**.
**Codeberg** (Gitea-based) exposes no public broker — in-process events. This cluster of
self-hosted Git platforms is strong evidence that *a separate broker is not mandatory* at
their scale.

**Cost model:** Marginal infra ≈ **$0** (you already pay for Postgres). Real cost = eng
time to build/operate the claim/sweep/DLQ logic, and the PgBouncer session-pool carve-out.
Scales to 10M/day (116 msg/s avg) easily; the binding constraint is commit throughput and
fan-out ergonomics, not raw rate.

**Verdict:** Best *zero-new-infra* starting point and a great **fallback/source-of-truth**.
Wrong as the *sole* bus once you need cross-service fan-out, multi-region, or >~1M/day.

---

### 3.2 NATS Core (fire-and-forget)

**What it is:** The base pub/sub: at-most-once, no persistence, no replay, topic
wildcards, request/reply. **This is NOT the durable layer** — JetStream is. Cite this
only to be precise, because most "NATS slow consumer drops messages" incidents are Core NATS.

**Throughput ceiling (real):** Single node, 1-byte msgs, loopback: **4.9M–5.2M msg/s**
(foomo, `nats bench`). 16-byte, 16-subscriber: **2.25M msg/s** (NATS.jl). These are the
"fast" numbers; they are ephemeral.

**Latency (real):** Brave New Geek (2016, still the reference latency-distribution study):
NATS and Redis both **sub-millisecond to ~4 nines** for small payloads; NATS ~0.1–0.4 ms
faster than Redis. Under 1MB msgs, tail blows up (peaks ~214 ms).

**Persistence:** None. **Replay: none.** A disconnected subscriber gets nothing.

**Ops complexity:** **The whole point.** Single Go binary, ~15–50 MB RAM idle, no
coordinator, no disk requirement for Core. Clustering is a config change (routes/leafnodes);
no ZK/KRaft.

**Real footguns (linked) — this is the famous one:**
- **Slow consumer ⇒ server closes the connection** (write deadline default 2s); **client
  side drops messages at the 65,536-msg / 64 MB pending limit and it is at-most-once —
  "it is up to your application to detect the missing messages."** [nats-io slow_consumers docs](https://nats-io.github.io/docs/nats_admin/slow_consumers.html) · [nats.go #524](https://github.com/nats-io/nats.go/issues/524) · [nats.c #317](https://github.com/nats-io/nats.c/issues/317)
- **High-throughput drop:** 25–30k msg/s, slow consumer **dropped 1,081,447 messages**
  (2016, still representative). [nats-server #217](https://github.com/nats-io/nats-server/issues/217)
- **400+ concurrent ordered consumers ⇒ connection resets** (default 64 MB max_pending);
  raising to 512 MB "fixes" it at a RAM blow-up. [nats.go #1981 (2025)](https://github.com/nats-io/nats.go/discussions/1981)
- **60k msg/s ⇒ MaxPending (64MB) exceeded, "no longer consume properly."** [nats.go #1950 (2025)](https://github.com/nats-io/nats.go/discussions/1950)
- **A slow consumer degrades *fast producers* ~30–50%** (fast-producer stall); opt out with
  `no_fast_producer_stall`. [nats-server #5394](https://github.com/nats-io/nats-server/issues/5394)

**Verdict:** Use Core NATS for transient signaling / request-reply / cache-invalidation,
**never as the durable webhook bus.** The webhook service must sit on JetStream.

---

### 3.3 NATS JetStream (the durable layer) — primary candidate

**What it is:** Durable persistence layer on top of Core: streams (append-only, retained),
consumers (push or **pull**), ack, replay, retention policies (limits / interest /
workqueue), dedup window, multi-replica (Raft), mirror/source (multi-region).

**Throughput ceiling (real) — read the caveats:**
- **Best-case (loopback, M4):** the docs' own example is **403,828 msg/s (async publish,
  128 B)** — but the maintainer warns these are **same-machine loopback numbers, "your
  mileage will vary."** [nats-server discussion #7599 (2025)](https://github.com/nats-io/nats-server/discussions/7599)
- **Single node, file storage, realistic:** **~10,965 ops/s (p50 836 µs, p99 2,123 µs)**;
  memory storage **~16,957 ops/s (p99 1,653 µs)**. [openobserve/nats-benchmark](https://github.com/openobserve/openobserve/pull/8875)
- **Durable with `fsync=always` (the honest durability number):** **716 enqueue / 724 drain
  jobs/s, p50 3.2 ms, p99 23.75 ms** — because "NATS fsyncs serially and plateau[s] by
  eight connections." **Buffered mode: 97,857 enqueue / 29,205 drain, p99 0.82 ms.**
  [sepp benchmarks](https://sepp-org.github.io/sepp/docs/benchmarks/)
- **Three-node, 3 replicas, 1KB (C-Pro/brokers-bench):** **1,230 msg/s with ACKs,
  p99 3.53 ms** — versus Kafka 594 msg/s (p99 3.06 ms) and Redpanda 1,395 msg/s in the
  *same* strictly-ordered 3-replica test. [brokers-bench](https://github.com/C-Pro/brokers-bench)
- **Throughput vs Kafka head-to-head (single 16-vCPU GCloud):** NATS JetStream
  **~50k pub / 34–86k sub (sync/async ack)** vs Kafka **~41k pub / ~107k sub**.
  [ThreeDotsLabs/watermill-benchmark](https://github.com/ThreeDotsLabs/watermill-benchmark)

**The takeaway:** JetStream's *sustained, fsync-every-write* throughput is modest (hundreds
to low-thousands msg/s single-node) — but that is **10–50x above your 116 msg/s peak** even
at 10M/day. You are not throughput-bound; you are choosing durability/ops.

**Latency p50/p99 (real):** p99 **0.8–3.5 ms** in the durable/3-replica tests above;
**~2.1 ms** single-node file; buffered ~0.8 ms. Consistent with "sub-5 ms p99 is
achievable" — far tighter than Kafka's ~12–45 ms p99 at equivalent durability.

**Persistence / retention / replay:** Durable (memory or file), retained per stream,
**replay from any sequence/timestamp**, ack + redelivery, dedup window, workqueue consumers.
Retention: `limits` (max msgs/bytes/age) — **set `max_age`/`max_bytes` or the stream grows
until you stop it** (the JetStream analog of "XADD without MAXLEN").

**Operational complexity:** **1 binary, no ZK/KRaft/JVM.** Single node today; 3-node Raft
for quorum; **multi-region via JetStream `mirror`/`source` or leafnodes** — no re-arch.
~100 MB–1 GB RAM. Prometheus endpoint built in. This is the "1 binary" + "multi-region"
constraint satisfied in one tool.

**Real footguns (linked) — the ones that will actually bite you:**
- **Durability is the weak spot (the big one).** A 2026 Jepsen analysis of v2.12.1 found
  **14.1% loss on coordinated power failure, 49.6% loss from a single-bit error on 1 of 5
  nodes, up to 78% acknowledged-write loss under split-brain**, driven by a **2-minute
  default deferred-fsync** that "violates sync-before-acknowledgment" — which Synadia
  documented rather than changed. **No independent post-v2.12.3 re-test published.**
  [securitydataworks (2026)](https://securitydataworks.com/writing/pipelines/nats-jetstream/)
  → **Mitigation (Section 7):** 3 replicas, SSD, and accept the at-least-once + idempotent
  consumer + Postgres-outbox-fallback design so a rare JetStream loss is not a lost webhook.
- **Slow consumer / backpressure:** in **pull** consumers this becomes `MaxAckPending`
  backpressure (no silent drop, but throughput stalls); in **push**/Core it is the
  connection-close drop in §3.2. [nats.go #888](https://github.com/nats-io/nats.go/discussions/888)
- **Workqueue redelivery race:** `AckSync` timeout that *still* acks can double-deliver or
  (with `MaxMessagesPerSubject:1`) appear to drop on a second pass (2.10.20+ backpressure
  change made the server "more susceptible to load"). [nats-server #5930 (2024)](https://github.com/nats-io/nats-server/issues/5930)
- **`max_payload` default 1 MB; >8 MB degrades reliability (HOL blocking).** [nats-server #7068](https://github.com/nats-io/nats-server/discussions/7068)
- **Cluster fragility:** 3-node cluster "could only tolerate a single node failure before
  quorum was lost"; scaling to 5 nodes, anti-affinity, and non-colocation were required to
  harden it (a real operator's re-architecture). [Snapp! (2025)](https://medium.com/@sina3050/building-trust-in-messaging-a-jetstream-re-architecture-journey-bfe80e9c65de)

**Git-platform / scale users (citable — addresses "is NATS production-proven?"):**
- **GitLab** chose NATS+JetStream as its messaging layer over Kafka/RabbitMQ/PubSub/Kinesis. (§6.2)
- **Form3** (payments, millions/day, multi-cloud) **replaced SNS+SQS with NATS+JetStream**,
  ~6x latency drop (300ms→50ms). [Gophercon UK 2021](https://www.form3.tech/blog/engineering/gophercon-nats) · [Synadia](https://www.linkedin.com/posts/synadia-communications_lightning-fast-payments-with-natsio-activity-7422271614005743617-cUJc)
- **NVIDIA NVCF** (cloud inference) runs a Synadia-managed NATS supercluster (multi-region).
  [Synadia (2026)](https://www.synadia.com/blog/scaling-global-ai-inference-with-nats-jetstream)
- **Snapp!** (5B rides) runs JetStream as its tier-1 async backbone. (above)
- Named Synadia customers: **Walmart, Rivian, Replit, FinecoBank, PowerFlex.** (above)
- Long-tail production users (billing, data-mesh, NOC) in the nats end-user census.
  [nats-general #58](https://github.com/nats-io/nats-general/discussions/58)

**Cost model:** 1 node (today) ≈ **100 MB–1 GB RAM**, negligible CPU, disk = retention
window. At 10M/day with 7-day retention ≈ **70 GB disk**. Add ~$10–50/month for a dedicated
node; 3-node cluster later ≈ 3x that. **No per-message fee.** This is the cheapest
self-hosted *durable + replay* option.

**Verdict:** Best fit for the full requirement set **if** you accept and mitigate the
durability caveats (Section 7). Strongest Git-platform precedent of any self-hosted broker.

---

### 3.4 Redis Streams

**What it is:** Append-only stream data structure inside Redis. `XADD`, `XREAD`, consumer
groups (`XGROUP`), replay by ID, retention via `MAXLEN`/`MINID`. Single-threaded process.

**Throughput ceiling (real):**
- **Single 16-vCPU GCloud (watermill):** **59,158 pub / 12,134 sub (16 B)** — note the
  consumer side is the bottleneck, ~1/5 of the publish rate. [watermill](https://github.com/ThreeDotsLabs/watermill-benchmark)
- **Single-node loopback, 1 B (foomo):** pub-side ~**5M msg/s** (but no consumer).
- **arXiv standardized table:** peak **650,000 msg/s**, p95 8 ms, p99 25 ms, 0.8 FTE,
  $2,400/mo per 10k msg/s. [arXiv 2510.04404](https://arxiv.org/html/2510.04404v2)
- **dev.to 2026 (3-node, 1KB):** **480k producer / 520k consumer, p99 0.8 ms.**
- **Single-process round-trip (Nimbus 2026):** only **2,522 msg/s, p99 1.06 ms** — i.e.,
  per-connection round-trip is the real-world ceiling, not the firehose number.

**Latency p50/p99 (real):** **Sub-millisecond** is the headline (p99 0.8–1.1 ms in the
tests above). Tight tails for small payloads (Brave New Geek: Redis tail peaks ~1.5 ms,
sensitive to memory pressure). 1MB payloads degrade past ~95th percentile.

**Persistence / retention / replay:** Optional. RDB snapshots (point-in-time, loss window)
and AOF (`appendfsync` always/everysec/no). **Replay: yes, by stream ID.** **Retention:**
**you must set `MAXLEN`/`MINID` — an unbounded stream grows memory unbounded** (the exact
footgun named in the brief; Redis is memory-first, evicts/OOMs under pressure).

**Operational complexity:** One process you may *already run* (GitLab runs 12 Redis
families). Single-threaded = **one core**; scale by sharding (Redis Cluster) or by
separate instances. Consumer groups are **per-key** (sharding streams across slots is the
non-obvious part). HA via Sentinel/replication.

**Real footguns (linked):**
- **`XADD` without `MAXLEN` ⇒ unbounded memory ⇒ OOM.** Redis is memory-first; at
  GitLab, the Sidekiq queue Redis is deliberately **not** allowed to evict, so "if we have
  too many (or overly large) queued jobs we could **OOM the Redis cluster**." [GitLab SRE survival guide](https://runbooks.gitlab.com/sidekiq/sidekiq-survival-guide-for-sres/)
- **Single-core ceiling** (one core, no multithreading); "dumb secondaries" that serve no
  load. [GitLab scalability docs](https://docs.gitlab.com/development/scalability/)
- **Memory pressure ⇒ tail latency + eviction** if `maxmemory`/eviction is mis-set (wrong
  for a queue: evicted key = dropped job). [GitLab scalability](https://docs.gitlab.com/development/scalability/)
- **Durability is the weakest of the durable options** vs Kafka/JetStream (RDB window, AOF
  fsync policy). [arXiv: "Limited" multi-tenancy, "Medium" lock-in](https://arxiv.org/html/2510.04404v2)

**Git-platform users (strong, citable):**
- **GitLab uses Redis as its job/event substrate** — Sidekiq job queues (split into its own
  Redis cluster in 2019), ActionCable Pub/Sub, cache, sessions, rate limits. [GitLab Redis dev guide](https://docs.gitlab.com/development/redis/) · [architecture](https://docs.gitlab.com/development/architecture/) · [12-Redis-family runbook](https://runbooks.gitlab.com/redis/redis-survival-guide-for-sres/)
- **But** GitLab's *forward-looking* event platform (Siphon, DAP) **moved off plain Redis
  to NATS+JetStream** for durable cross-platform streaming — "pluggable message broker
  (e.g., Redis, NATS)." [GitLab messaging layer](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/gitlab_messaging_layer/) · [DAP events](https://handbook.gitlab.com/handbook/engineering/ai/ai-coding/dap-events/)
  → This is the single most instructive datapoint: a Git platform **lives on Redis today
  and reached for JetStream when it needed durable, replayable, multi-consumer streaming.**

**Cost model:** 1 instance, **~1–4 GB RAM** (in-memory; streams live in memory), AOF disk
for durability. ~$20–100/month. Cheapest if you already run Redis; the RAM bill grows with
retention (unlike Kafka/JetStream, where retention is cheap *disk*, not RAM).

**Verdict:** Excellent if Redis is already your substrate and you keep retention short
(MAXLEN-bounded). Weaker than JetStream for *long retention + multi-consumer replay +
multi-region*, and the single-core + RAM-for-retention model is the ceiling.

---

### 3.5 Apache Kafka

**What it is:** Partitioned, replicated, disk-backed commit log. The de-facto standard for
very-high-throughput event streaming. **Kafka 4.x is KRaft-only** (ZooKeeper removed).
Consumer groups own partitions; ordering is per-partition.

**Throughput ceiling (real):**
- **arXiv standardized:** **1,200,000 msg/s** peak, p95 18 ms, p99 45 ms, **2.3 FTE**,
  $4,200/mo per 10k msg/s, 8–12 week learning curve. [arXiv](https://arxiv.org/html/2510.04404v2)
- **Single 16-vCPU GCloud (watermill, 1 node, 16 B):** **41,492 pub / 101,669 sub** — note
  a *single* under-tuned node does ~40k; the 1.2M is a tuned multi-broker cluster. [watermill](https://github.com/ThreeDotsLabs/watermill-benchmark)
- **3-replica strictly-ordered 1KB (C-Pro):** **594 msg/s, p99 3.06 ms** — the honest
  "guaranteed delivery of a strictly ordered stream" number, ~2x *lower* than NATS
  JetStream in the same test. [brokers-bench](https://github.com/C-Pro/brokers-bench)

**Latency p50/p99 (real):** p99 **~12–45 ms** at durability (vs NATS ~3 ms, Redis ~1 ms).
Brave New Geek: Kafka holds tight tails only to ~94th percentile, then disk-persistence cost
surfaces; 1MB msgs blow up past ~80th percentile. **Kafka p99 is "tens of ms, not
sub-millisecond"** (Big Iron homelab, 2026).

**Persistence / retention / replay:** **The strongest of the group.** Disk-backed,
replicated (RF=3), retention in **days–weeks** (the GitHub push topic + an enterprise CI
example both retain ~60 days), replay by offset, log-compaction for state. This is why
GitHub's push-flow and Hootsuite's webhook dispatcher are built on it.

**Operational complexity: the whole cost.** JVM, multi-broker cluster (3+ for prod),
KRaft controller quorum, partition planning, consumer-group tuning, `acks`/`min.insync`
durability knobs, broker upgrades. **2.3 FTE and 8–12 weeks** (arXiv). This is why GitLab's
design doc lists Kafka as "cost-prohibitive regardless of scale" and "operationally
intensive."

**Real footguns (linked) — the "rebalance hell" is real and documented:**
- **Rebalance = stop-the-world.** A rolling restart of a **240-consumer group caused 9
  minutes of continuous rebalancing, throughput to zero, 34 min customer impact** (session
  timeout math off by 2x). Fixed with static membership + cooperative-sticky. [Nova AI Ops](https://novaaiops.com/blog/real-outage-kafka-consumer-rebalance)
- **Every rolling deploy froze ALL topics ~15 s** (900 consumers in one group ⇒ O(900×600)
  coordination). Fix: **split into per-topic/per-flow groups ⇒ 15 s → ~500 ms (30x).**
  [slice.bank.in (2026)](https://engineering.slice.bank.in/how-we-solved-a-kafka-freeze-5x-ed-throughput-and-right-sized-our-partitions-lessons-from-d9b0e20c3cc2)
- **Scaling consumers *during* an incident made it worse** — more members ⇒ more
  rebalances ⇒ stop-the-world; in-flight work aborted/duplicated. [michal-drozd](https://www.michal-drozd.com/en/blog/kafka-consumer-rebalance-storm/)
- **Default eager assignor revokes ALL partitions on every member change**; a single
  restart can pause a 40-consumer group for seconds-to-minutes. [matthewpalma (2026)](https://matthewpalma.dev/blog/kafka-consumer-group-rebalancing-partition-assignment-production)
- **Kafka Streams apps pause >45 s on a single instance restart** (default 45 s session
  timeout); even a 92 ms rebalance produced 25–48 s of no processing. [Thriving.dev](https://thriving.dev/blog/reduce-rebalance-downtime-for-stateless-kafka-streams-apps)
- **8-min payment-service outage from a rebalance thundering herd** (self-reported).
  [LinkedIn post](https://www.linkedin.com/posts/jagdeep56_kafka-backendengineering-systemdesign-activity-7468151810957070336-FLrJ)
- **The fix is KIP-848 (Kafka 4.0's new consumer rebalance protocol)** — server-side,
  incremental, "no stop-the-world" — which is itself evidence the old behavior was a
  production hazard. [Confluent (2025)](https://www.confluent.io/blog/kip-848-consumer-rebalance-protocol/)

**Git-platform users (the canonical citation):**
- **GitHub uses Kafka for push flow / webhook fan-out.** "We added a new Kafka topic that we
  publish an event to for each push … enqueueing background jobs in response to Kafka events
  via independent consumers … a reliable publisher that retries until broker
  acknowledgement." [github.blog — How we improved push processing (2024)](https://github.blog/engineering/architecture-optimization/how-we-improved-push-processing-on-github/) · [~500M pushes/month summary](https://newsletter.scalablethread.com/p/how-github-scaled-push-flow-using)
- **Hootsuite** runs a **Kafka-backed webhook dispatcher** (partition by receiver-URL hash,
  log-compacted state topic, at-least-once + idempotent). [Hootsuite (2018)](https://medium.com/hootsuite-engineering/a-scalable-reliable-webhook-dispatcher-powered-by-kafka-2dc3d677f16b)
- **Atlassian/Bitbucket** run an "internal event substrate … durably persists it …
  distribution layer fans events out to our Events Queue" feeding a two-stage webhook
  pipeline (matching → delivery, DLQ, per-recipient concurrency). The broker is not named
  publicly (proprietary), but the shape is a durable, replayable log. [Atlassian (2026)](https://www.atlassian.com/blog/how-we-build/inside-atlassians-webhook-delivery-platform) · [Bitbucket DC event system](https://confluence.atlassian.com/bitbucketserver095/event-system-1528535541.html)

**Cost model:** **The floor is high.** Production = 3+ JVM brokers + KRaft quorum,
**~12 GB+ RAM minimum**, plus the 2.3 FTE / 8–12-week learning curve. At 10M/day you use
~0.01% of capacity but still pay the cluster floor: realistically **$300–1,000/month infra +
substantial eng time**, and it does not run in an air-gapped on-prem without a big
investment. This is the "cost-prohibitive regardless of scale" GitLab called out.

**Verdict:** The *correct* tool at 100x your scale and for a public cloud at GitHub's
volume. **Premature for a 1-region, 1-binary, self-hosted startup.** Keep it as the
"we outgrew everything" end-state, not the starting point.

---

### 3.6 RabbitMQ Streams

**What it is:** A *distinct* queue type (not classic queues) — an **append-only, replicated,
non-destructive log** with replay/time-travel and large fan-out, consumable over the
**stream protocol** (fastest) or AMQP (translated, slower).

**Throughput ceiling (real) — the "streams vs classic" gap is the story:**
- **RabbitMQ 4.3.6, 1KB (jacar.es, 2026):** **stream protocol 281,330 msg/s** vs
  **quorum queue 45,156 msg/s (6.2x)** vs stream-over-AMQP 120,860 pub / 62,360 consumed.
  1M msgs: stream **1.11 GB disk / 9 KB RAM** vs quorum 1.24 GB / 20.5 MB RAM.
  [jacar.es](https://jacar.es/en/rabbitmq-streams-vs-quorum-queues/)
- **Full Cycle (2025, 3 vCPU / 4 GB):** **~1.27M published msg/s on a stream**, ~1M
  consumed; quorum ~100k. Note: stream consumers each read the **whole** stream (divide the
  displayed total by N consumers). [skalablog](https://skalablog.com/p/rabbitmq-1-million-messages-per-second-tested/)
- **RabbitMQ official (m7i.4xlarge, 3M msgs):** stream consumers read "several million
  msg/s at chunk 300," dropping to ~200k at chunk 15. [rabbitmq.com (2025)](https://www.rabbitmq.com/blog/2025/09/26/stream-delivery-optimization)
- **RabbitMQ official AMQP 1.0 (12 B, 1M msgs):** classic **99,413 msg/s (p99 2 ms)**;
  stream **136,705 pub / 112,587 recv** but e2e latency 1.5–1.6 s (backlog build-up).
  [rabbitmq.com (2024)](https://www.rabbitmq.com/blog/2024/08/21/amqp-benchmarks)

**Latency p50/p99 (real):** Stream protocol at 10k msg/s: **median ~1 ms, p99 ~2 ms**
(jacar.es). Stream-over-AMQP: **median 0.8 ms / p99 5.4 ms** at 10k, but **9.1 s median
e2e** when the consumer can't keep up (jacar.es) — the AMQP translation + backlog is the
hidden cost.

**Persistence / retention / replay:** Always persistent + replicated (Raft). **Replay /
time-travel: yes (by offset/timestamp).** Retention: max-age / max-length. **But:** a stream
does **not fsync before confirming** (can lose the most recent messages on crash), and
streams have **no dead-letter, no TTL, no priorities** — those live on quorum/classic
queues. [rabbitmq.com/docs/streams](https://www.rabbitmq.com/docs/streams)

**Operational complexity:** Erlang/BEAM VM (not a single static binary the way NATS is, but
far lighter than Kafka's JVM). 1 node today, 3 for quorum. **Throughput decreases as
message size grows** (disk-I/O heavy) and as replicas increase. Streams are a *separate
concept* from classic RabbitMQ queues, so you carry both mental models.

**Real footguns (linked):**
- **`x-queue-type=stream` via AMQP 0-9-1 is ~2x slower** than the stream protocol (message
  translation); RabbitMQ had to ship a PR just to lift AMQP stream receive +55%.
  [rabbitmq-server #4811](https://github.com/rabbitmq/rabbitmq-server/pull/4811)
- **Streams have no DLQ/TTL/priorities** — you must bolt those on or use a quorum queue for
  the parts that need them. [rabbitmq.com/docs/streams](https://www.rabbitmq.com/docs/streams)
- **Buffered writes can lose the most recent messages on crash** (no fsync-before-confirm);
  durability is "moderate" vs quorum's "highest." [skalablog](https://skalablog.com/p/rabbitmq-1-million-messages-per-second-tested/)
- **Fan-out semantics:** every consumer reads every message — 10 consumers = 10x the
  displayed rate; plan capacity accordingly. [skalablog](https://skalablog.com/p/rabbitmq-1-million-messages-per-second-tested/)

**Git-platform users:** No public statement found for GitHub/GitLab/Bitbucket/Codeberg/
SourceHut using RabbitMQ Streams as their event bus. (Bitbucket DC has its own internal
event-queue system; not RabbitMQ-streams-specific.) Treat as **no direct Git-platform
precedent** — it's a strong general-purpose broker but not a demonstrated Git-platform pick.

**Cost model:** 1 Erlang node **~0.5–2 GB RAM**, disk = retention. ~$50–200/month; 3-node
quorum ~3x. No per-message fee. Middle between Redis (cheapest) and Kafka (heaviest).

**Verdict:** A credible Kafka-alternative with replay + huge fan-out, *if* you want to stay
in the AMQP/RabbitMQ ecosystem. For a from-scratch TS startup it adds Erlang ops and a
two-queue-type mental model for a problem JetStream solves with one binary and a clearer
Git-platform precedent.

---

### 3.7 Google Cloud Pub/Sub (managed)

**What it is:** Fully managed, globally-replicated pub/sub. Topics are **global**;
subscribers pull or get pushed. At-least-once (exactly-once available). Ordering by
**ordering key** (per-key, 1 MB/s per key).

**Throughput / latency (real):** "Latencies on the order of **100 milliseconds**" (official
overview); scales to millions msg/s. arXiv standardized: **300,000 msg/s, p95 78 ms,
p99 165 ms, 0.4 FTE, $2,100/mo per 10k msg/s.** [arXiv](https://arxiv.org/html/2510.04404v2)
[overview](https://docs.cloud.google.com/pubsub/docs/pubsub_overview) — **100 ms p99-class
latency is ~30x worse than NATS/Redis** and is the wrong shape for a low-latency internal
bus, though fine for webhook fan-out.

**Persistence / retention / replay:** Retention **7 days default, up to 31 days.**
Replay by timestamp (snapshot/seek). **A subscriber that acks without processing can cause
subscriber-induced message loss** — you must be idempotent. [reliability-intro](https://docs.cloud.google.com/pubsub/docs/reliability-intro) [subscription-properties](https://docs.cloud.google.com/pubsub/docs/subscription-properties)

**Operational complexity:** **Zero** (managed) — but **you cannot self-host it.** For a
*self-hosted* Git platform that must run air-gapped/on-prem, managed Pub/Sub **fails
requirement R8**. It also pins you to GCP (lock-in).

**Real footguns (linked):**
- **Fan-out billing multiplier:** throughput is charged per publish **and per subscription
  delivery** — "publishing 1 TiB to a topic with four subscriptions costs 5 TiB."
  [c3x (2026)](https://c3x.dev/blog/gcp-pubsub-cost-explained/)
- **Ordering reduces publish availability + raises e2e latency**, and a stuck key (hot key)
  head-of-line-blocks that key; redelivery of one message redelivers all later messages for
  that key. [ordering docs](https://docs.cloud.google.com/pubsub/docs/ordering)
- **Subscriber-induced loss** on ack-without-process. [reliability-intro](https://docs.cloud.google.com/pubsub/docs/reliability-intro)

**Cost model (real, from the price page):** **$40/TiB throughput, first 10 GiB/month free**,
+ **$0.27/GiB-month** retained storage. At 100k/day (~3.2 GB/mo) ⇒ **~$0 (free tier).**
At 10M/day (~315 GB/mo, 3 subs ⇒ ~1 TiB metered) ⇒ **~$40/mo throughput + ~$9/mo
7-day retention ≈ $50/mo.** 31-day retention on 2 TiB ≈ $553/mo. **The message cost is
negligible at your scale — the real costs are lock-in + no self-host + 100 ms latency.**
[pricing](https://cloud.google.com/pubsub/pricing)

**Verdict:** Zero-ops and cheap *if you are a GCP shop and self-hosting parity doesn't
matter*. For a self-hosted Git platform it is a **fallback/edge fan-out, not the primary
bus.**

---

### 3.8 AWS SNS + SQS (managed)

**What it is:** The classic AWS fan-out: **SNS topic** (push, per-64KB-chunk billing,
**not persisted — delivered in real time**) fans out to **SQS queues** (pull, **persisted**
until consumed/expired). SQS standard = at-least-once, best-effort order, "nearly
unlimited" TPS; SQS FIFO = exactly-once + strict order but **300 TPS** (non-batch) /
3,000 (batch) / up to **70k–700k** (high-throughput mode, region-dependent).

**Throughput / latency (real):** SQS "tens to low hundreds of ms" (FAQ); standard
throughput is effectively unbounded per action; arXiv standardized **SQS 300,000 msg/s,
p99 350 ms.** [arXiv](https://arxiv.org/html/2510.04404v2) [SQS FAQ](https://aws.amazon.com/sqs/faqs/) **Sub-second, but the FIFO ceiling (300 TPS non-batch) is a real trap**
for ordered per-receiver webhooks unless you batch or pay for high-throughput mode.

**Persistence / retention / replay:** SQS **persists** (multi-AZ, to disk) up to **14 days**;
**replay is NOT a first-class feature** (you get at-least-once redelivery + DLQ, not
"rewind the log"). SNS messages do **not persist** (they're delivered, gone). Max payload
**1 MiB** (256 KB default). [SQS features](https://aws.amazon.com/sqs/features/) [quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)

**Operational complexity:** **Zero** (managed) — but **AWS-only**, so it **fails R8** for a
self-hosted/air-gapped Git platform, and it locks you to AWS.

**Real footguns (linked):**
- **FIFO 300 TPS (non-batch) ceiling** per group; high-throughput mode is region-gated
  (some regions 2,400 TPS default). [SQS quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- **At-least-once ⇒ duplicates** (standard); you must dedupe (Shortcut's design does
  exactly this for GitHub/Bitbucket/GitLab webhooks → S3 + SQS). [Shortcut (2019)](https://www.shortcut.com/blog/using-clojure-spec-datomic-and-webhooks-to-integrate-version-control-systems-vcs/)
- **No log replay** — the moment you need to "re-drive the last hour to a new consumer,"
  SQS has no answer (you need a durable log). [decision guide](https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html)
- **1 MiB cap**; "your event still shouldn't carry the file." [dev.to (2026)](https://dev.to/gabrielanhaia/sqs-sns-and-eventbridge-now-take-1-mib-your-event-still-shouldnt-carry-the-file-5d63)

**Cost model (real, from the price pages):** SQS **1M requests/month free**, then ~**$0.40
per million requests** (US; batch 10 msgs = 1 request); **each 64 KB chunk = 1 request**.
SNS **$0.50/million requests + $0.06/100k HTTP deliveries**, 1M req + 100k HTTP free.
At 100k/day: **within free tier ⇒ ~$0.** At 10M/day: ~30M–90M requests/mo (send/receive/
delete, less with batching) ⇒ **~$15–60/mo**. **Again: message cost is trivial at your
scale; the differentiators are AWS lock-in + no self-host + FIFO TPS + no replay.**
[SQS pricing](https://aws.amazon.com/sqs/pricing/) [SNS pricing](https://aws.amazon.com/sns/pricing/)

**Verdict:** The pragmatic *AWS-native* webhook bus (it is exactly what Shortcut and Form3's
*old* architecture used). **Form3 left SNS+SQS for NATS+JetStream** specifically to escape
the 300 ms latency spikes and the fan-out coupling — a direct, citable "managed → NATS"
data point for this exact use case. [Form3](https://www.form3.tech/blog/engineering/gophercon-nats)

---

## 4. Side-by-side (the decision table)

Numbers are the *representative durable/realistic* figures from the linked sources, not the
marketing peak. "Durable" rows assume fsync/AOF-on durability, not the buffered fast path.

| | **NATS JetStream** | **Postgres L/N + outbox** | **Redis Streams** | **Kafka 4.x** | **RabbitMQ Streams** | **GCP Pub/Sub** | **AWS SNS+SQS** |
|---|---|---|---|---|---|---|---|
| Durable throughput (realistic) | ~1.2k msg/s (3-repl) / ~11k (1-node file) | ~10³ msg/s (wake-up) | ~12k consumer-bound / ~50k pub | ~41k (1 node) / 1.2M (cluster) | ~281k (stream proto) | ~300k | ~300k |
| p50 / p99 latency (durable) | ~0.4 / **0.8–3.5 ms** | <1 ms signal / ~5.6 s roundtrip | <1 / **0.8–25 ms** | ~5–12 / **12–45 ms** | ~1 / **2 ms** (stream proto) | ~ / **~100–165 ms** | ~ / **tens–hundreds ms** |
| Replay | **Yes (seq/time)** | **Yes (query table)** | **Yes (by ID)** | **Yes (offset)** | **Yes (offset/time)** | **Yes (time, 7–31d)** | **No (redelivery only)** |
| Retention | Yes (limits) | **Yes (table, ∞)** | Yes (MAXLEN, RAM) | **Yes (days–weeks, disk)** | Yes (age/len, disk) | Yes (7–31d) | Yes (SQS 14d) |
| Per-receiver ordering | Yes (workqueue/stream) | Yes (claim by key) | Yes (per stream) | Yes (per partition) | Yes (per stream) | **Yes (ordering key)** | **Yes (FIFO group)** |
| Fan-out | **Native (subjects)** | Manual (N queries) | Consumer groups | Consumer groups | **Native (all read all)** | Native (subs) | **Native (SNS)** |
| Dead-letter | Yes | Manual | Manual (XCLAIM) | Yes | **No (on streams)** | Yes (DL topic) | **Yes (SQS DLQ)** |
| Single binary / no coordinator | **Yes (Go, none)** | **Yes (you run PG)** | Yes (1 process) | **No (JVM + KRaft quorum)** | No (Erlang) | n/a (managed) | n/a (managed) |
| Multi-region path | **Mirror/leaf (native)** | App-level / PG logical repl | App-level / sharding | Cross-region mirror | Shovel/mirroring | **Native global** | **Native (cross-region)** |
| Runs air-gapped / on-prem | **Yes** | **Yes** | **Yes** | Yes (heavy) | Yes | **No** | **No** |
| Ops burden | **Low** | **Low (if PG exists)** | Low–Med | **High (2.3 FTE)** | Med | **None** | **None** |
| At-your-scale ceiling headroom | ~10,000x | ~1,000x | ~100x | ~10,000x | ~2,400x | ~2,600x | ~2,600x |
| Git-platform precedent | **GitLab, Form3** | **g1t.sh, sr.ht pattern** | **GitLab (current)** | **GitHub, Hootsuite, Atlassian** | none found | none found | Shortcut, Form3(old) |

Legend for "headroom": peak-rate (116 msg/s at 10M/day) headroom = realistic durable
throughput / 116. Every self-hosted option clears 100x+; this is **not** the decision axis.

---

## 5. Durability — the axis that actually separates the finalists

At your scale, throughput is a non-issue, so **durability semantics are the deciding axis**
for a webhook bus (a lost webhook = a missed deploy notification / CI trigger / security
event). Ranked by "how sure am I the event is durably recorded before I ack the sender":

1. **Kafka** — a decade of independent Jepsen analyses (2013/2018/2020) with documented fix
   cycles and re-verification; `acks=all` + `min.insync.replicas` is the gold standard.
   The cost is the cluster + ops. [securitydataworks comparison](https://securitydataworks.com/writing/pipelines/nats-jetstream/)
2. **Postgres outbox** — **ACID**: the event row and the domain write commit atomically;
   "durable" means "in the transaction log." This is the *strongest* durability-per-unit-of
  -complexity, because it's the DB you already trust. The wake-up (NOTIFY) can be lost and it
   doesn't matter — the sweep reclaims it.
3. **RabbitMQ Streams** — replicated log, but **no fsync-before-confirm** ⇒ recent-loss
   window on crash; durability "moderate." [skalablog](https://skalablog.com/p/rabbitmq-1-million-messages-per-second-tested/)
4. **NATS JetStream** — durable + replay, **but** the 2026 Jepsen (v2.12.1) loss numbers and
   the 2-minute default deferred-fsync mean you must *explicitly* configure sync + 3
   replicas and still design for at-least-once + idempotent + a Postgres fallback.
5. **Redis Streams** — AOF/RDB durability with a real loss window; RAM-backed retention.
6. **GCP / AWS** — vendor-durable (multi-AZ), but you trust the provider and cannot
   self-host.

**Consequence for the recommendation:** the durable, replayable, low-ops self-hosted choice
is **NATS JetStream**, *but* because its durability evidence is thinner than Kafka/Postgres,
the defensible design **pairs it with a Postgres outbox as the source of truth** — JetStream
is the fast fan-out bus, Postgres is the durable ledger. (This is the same "table is the
source of truth, broker is the wake-up" pattern GitLab, g1t.sh, and pgqueuer all converge on.)

---

## 6. Git-platform precedent — the strongest signal for a self-hosted Git platform

This is the section that most directly de-risks the choice, because these are **the same
product category** as OpenForge.

### 6.1 The map (public evidence)
- **GitHub** → **Kafka** for push flow / webhook fan-out (public blog, 2024). Scaled to
  ~500M pushes/month. [github.blog](https://github.blog/engineering/architecture-optimization/how-we-improved-push-processing-on-github/)
- **GitLab** → **Redis** (Sidekiq) today for jobs; **NATS+JetStream** chosen for the
  durable cross-platform messaging layer, **explicitly over Kafka.** [handbook](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/gitlab_messaging_layer/)
- **Atlassian/Bitbucket** → proprietary "durable event substrate + two-stage queue" (log-like,
  replayable, DLQ); broker not named. [Atlassian (2026)](https://www.atlassian.com/blog/how-we-build/inside-atlassians-webhook-delivery-platform)
- **g1t.sh** → **SQLite durable log + per-service fan-out + DLQ (3 retries).** No broker.
  [docs.g1t.sh](https://docs.g1t.sh/architecture/events/)
- **SourceHut (sr.ht)** → **no central broker; direct async HTTP between services.**
- **Codeberg** → Gitea-based; in-process events, no public broker.
- **Hootsuite / Shortcut** → **Kafka** (Hootsuite) and **S3+SQS** (Shortcut) webhook buses.

**Pattern:** the *largest* (GitHub) runs Kafka at a volume no startup has. The *self-hosted /
multi-deployment-model* platform (GitLab) — the closest analog to OpenForge — **rejected
Kafka and chose NATS+JetStream.** The *small* self-hosted platforms (g1t.sh, sr.ht) use
**a durable table/log + wake-up, no broker at all.** All three data points bracket OpenForge:
you are between "small self-hosted (table is enough)" and "GitLab (NATS, not Kafka)."

### 6.2 GitLab's "Why not Kafka?" — quote-worthy
From the GitLab messaging-layer design doc, the reasons Kafka lost to NATS (all of which map
to OpenForge's constraints):
- "Support for Kafka across deployment-environments is **non-existent**."
- "Kafka can be **cost-prohibitive regardless of scale**."
- "Kafka can be **operationally intensive**."
- "Kafka requires **Zookeeper/KRaft** for coordination … NATS ships as a **single-binary
  with no external dependencies** … can run natively on the given host."
- Topology: "NATS will be deployed **region-local only** similar to Redis … **JetStream to
  persist all ingested data durably** … enforce retention policies … enable compression."

This is a self-hosted Git platform, at far larger scale than OpenForge, making **exactly the
call we're being asked to make**, for **exactly our reasons**.

---

## 7. Defensible recommendation

### Primary: **NATS + JetStream**, with a **Postgres outbox as the source of truth**

**Architecture (the webhook service sits on this):**
1. **Ingest → outbox (durable, ACID).** The webhook receiver validates the signature, writes
   an `events` row (the ledger) **in the same transaction** as any domain write, and
   `INSERT`s into the bus. Postgres commit = the durability boundary that satisfies R1.
2. **Outbox relay → JetStream stream.** A small relay (or the same app) publishes each
   committed event to a JetStream stream (e.g. `openforge.webhooks.>`). JetStream is the
   **fan-out + replay + retention** bus (R3, R4, R6) with per-receiver **pull consumers**
   (R5) and a **workqueue/DLQ** (R7).
3. **Delivery consumers.** One consumer group per delivery concern; per-receiver ordering via
   a per-receiver stream/subject or message group; at-least-once + **idempotency key**
   (event ID) so redelivery is safe (R2).
4. **Sweep / reconciliation.** A periodic job reads `events` not-yet-`delivered` and
   re-publishes — this is the safety net that makes a lost NOTIFY or a rare JetStream loss
   **non-fatal** (it's exactly the pgqueuer/g1t.sh "broker is the fast path, table is the
   truth" pattern).

**Why this is defensible (maps to §2 requirements):**
- R1 durability: **Postgres ACID outbox** (strongest available per unit of complexity).
- R3/R4/R6 replay/retention/fan-out: **JetStream** (native, retained, per-subject).
- R5 ordering: per-receiver stream/subject or JetStream workqueue.
- R7 DLQ: JetStream consumer + `events` table DLQ state.
- R8 self-hosted/on-prem: **single Go binary + the Postgres you already run** (air-gapped OK).
- R9 multi-region: **JetStream `mirror`/`source`** for cross-region + Postgres logical
  replication for the ledger — no re-architecture.
- "1 binary": **nats-server** is the only new binary.
- Precedent: **GitLab made this exact call; Form3 made the SNS/SQS→NATS call** for webhooks.

**Durability controls (non-negotiable, to neutralize the §5.1 Jepsen findings):**
- **3 JetStream replicas** (Raft quorum) once you are past single-node; SSD-backed file store.
- **Tighten fsync** (do not run the 2-minute deferred default for the webhook stream);
  accept the ~700 msg/s durable rate (still 6x your 116 msg/s peak).
- **At-least-once + idempotent consumers** (event-ID dedup) so a rare loss/redelivery is safe.
- **Postgres outbox sweep** as the ultimate backstop (the loss is only *latency*, never *data*).
- **Prometheus metrics** on stream lag, consumer lag, raft health (built-in endpoint).
- **5-node cluster + anti-affinity + non-colocation** when you outgrow 3 (the Snapp! lesson).

### Explicit alternative (if you want **zero new infrastructure** today):
**Postgres outbox + LISTEN/NOTIFY wake-up only** (no separate broker). The receiver writes the
row + NOTIFY; workers `LISTEN` on a dedicated session-pool connection, claim with
`FOR UPDATE SKIP LOCKED`, sweep every 30 s. This is g1t.sh's and pgqueuer's pattern, it runs
on infra you already have, and it satisfies R1–R7 at 100k–1M/day. **Migrate to JetStream when
you need** cross-service fan-out, multi-region, or >~1M/day — the outbox table is unchanged;
you only add the relay + bus. This is the cheapest credible starting point and a *clean*
on-ramp to the primary.

### What we are explicitly NOT doing, and why:
- **Not Kafka now:** ~0.01% utilization of its ceiling, 2.3 FTE + 8–12-week curve, JVM+KRaft
  cluster floor, rebalance stop-the-world on every deploy/scale, and **no air-gapped
  self-host parity**. Revisit at ~100x scale or if you go public-cloud-and-huge (then
  Kafka/Redpanda with KIP-848's new rebalance protocol).
- **Not GCP Pub/Sub / AWS SNS+SQS as primary:** they **fail R8** (can't run air-gapped/
  on-prem) and lock you to a vendor. They remain fine as **edge fan-out** for cloud-hosted
  integrations. (Note the 100 ms Pub/Sub latency and SNS+SQS's lack of log replay.)
- **Not RabbitMQ Streams as primary:** no Git-platform precedent, Erlang ops, two-queue-type
  mental model, and no DLQ/TTL on the stream itself — JetStream gives the same replay/fan-out
  with one binary and a direct Git-platform track record.

---

## 8. "Do we even need Kafka for a 1-region, 1-binary startup?" — No

Three independent reasons, each sufficient:

1. **The math (Section 1):** 10M events/day = **116 msg/s average**. Kafka's realistic
   single-node number is ~41k msg/s and its cluster number is ~1.2M. You would run Kafka at
   **~0.01–0.3% utilization** and pay its full cluster/ops floor. You are buying a Ferrari
   to deliver 116 letters a second.

2. **The ops floor (Section 3.5):** Kafka's cost is not the messages, it's the **3-broker
   JVM + KRaft quorum + 2.3 FTE + 8–12-week learning curve + rebalance stop-the-world on
   every deploy/scale/broker-change** (9-min zero-throughput incident; 15 s all-topic freeze;
   8-min payment outage — all documented, §3.5). A 1-binary startup has neither the headcount
   nor the need.

3. **The precedent (Section 6.2):** the closest Git-platform analog (GitLab, self-hosted +
   SaaS + on-prem, larger than you) **evaluated Kafka and rejected it** on cost/ops/distribution
   grounds, choosing NATS+JetStream. GitHub runs Kafka because it does **~500M pushes/month**
   — a scale you will not approach for years, and only in a public cloud.

**Conclusion:** Do not adopt Kafka now. Adopt it (or a Kafka-compatible broker like Redpanda,
which removes the JVM/ZK tax) **only when** you (a) go public-cloud-and-massive, or (b) need
the specific features only a partitioned commit log with Kafka-ecosystem tooling gives you at
scale. The Postgres-outbox → JetStream path keeps that door open without paying for it today.

---

## 9. Migration path: 1 region (today) → multi-region (tomorrow)

| Stage | Bus | Ledger | Multi-region mechanism | Trigger |
|---|---|---|---|---|
| **0 — start** | Postgres outbox + NOTIFY wake-up | Postgres | — (single region) | now, 100k/day |
| **1 — add bus** | + **NATS JetStream** (1 node) via outbox relay | Postgres | region-local (like GitLab's Redis) | need fan-out/replay, or >~1M/day |
| **2 — HA** | JetStream **3-node Raft** (SSD, tight fsync) | Postgres (HA/replica) | region-local | past a single-node SLO |
| **3 — multi-region** | JetStream **`mirror`/`source`** (active-passive or active-active) | Postgres **logical replication** or per-region ledger + idempotent merge | cross-region fan-out, failover | 2nd region |
| **4 — (only if huge)** | Kafka/Redpanda (KIP-848) cross-region mirror | — | native geo-replication | ~100x scale / public-cloud-massive |

Key property: **the `events` outbox table and the webhook consumer contract never change.**
You add a relay and a bus in Stage 1; you add replicas in Stage 2; you add a mirror in
Stage 3. Each step is additive and reversible. This is the "clean migration path" the brief
asks for, and it is why the Postgres-ledger + JetStream-bus pairing (not Kafka, not a
managed service) is the spine of the recommendation.

---

## 10. Risk register (what could make the recommendation wrong)

| Risk | Likelihood | Mitigation |
|---|---|---|
| JetStream durability loss (Jepsen: power/single-bit/split-brain) | Low (with 3 repl + tight fsync) | Postgres outbox sweep makes loss = latency, not data loss; idempotent consumers |
| You outgrow JetStream durable rate (~700 msg/s fsync) before Kafka is justified | Very low at 116 msg/s | Buffer/async ack; raise replicas; Redpanda is the Kafka-compatible escape valve |
| Slow-consumer backpressure stalls delivery (JetStream `MaxAckPending`) | Medium | Pull consumers + bounded `MaxAckPending` + autoscale consumers; monitor consumer lag |
| PgBouncer transaction-pool breaks NOTIFY wake-up (Stage 0) | Medium | Session-pool or direct connection for listeners; sweep is the backstop regardless |
| Postgres commit-path becomes the bottleneck at scale | Low at this scale | Outbox relay batching; move the ledger to a replica; JetStream carries fan-out |
| Team lacks NATS/Go operational experience | Medium | It's 1 binary + Prometheus; GitLab/Form3 playbooks are public; Start-of-scope is small |
| Requirement R8 (self-hosted/air-gapped) later relaxes and you move fully to a cloud | Low | JetStream runs fine in-cloud too; the outbox contract is unchanged |

---

## 11. Sources

**Benchmarks (real numbers, with methodology caveats noted in-line):**
- NATS JetStream — nats-server discussion #7599 (docs 403k loopback vs 134k real); openobserve/nats-benchmark (10,965 file / 16,957 mem, p99 1.6–2.1 ms); sepp benchmarks (716 durable fsync / 97,857 buffered, p50/p99); C-Pro/brokers-bench (1,230 3-repl 1KB, p99 3.5 ms); ThreeDotsLabs/watermill-benchmark (single GCloud node).
- Kafka — arXiv 2510.04404 (1.2M, p99 45 ms, 2.3 FTE); watermill (41k single node); C-Pro/brokers-bench (594 3-repl 1KB, p99 3 ms); Brave New Geek (latency distributions, 2016).
- Redis Streams — watermill (59k pub / 12k sub); foomo (loopback ~5M pub); arXiv (650k, p99 25 ms); dev.to 2026 (480k, p99 0.8 ms); Nimbus 2026 (2,522 round-trip, p99 1.06 ms).
- RabbitMQ Streams — jacar.es 2026 (281k stream-proto vs 45k quorum, p99 2 ms); skalablog (1.27M); rabbitmq.com 2024/2025 (official); rabbitmq-server PR #4811.
- Postgres LISTEN/NOTIFY — Nimbus 2026 (2,471, p99 5.6 s); asyncpg measured (commit-time, 8000-byte cap); sql-notify docs (8 GB queue).
- GCP/AWS — cloud.google.com/pubsub (pricing, ordering, retention, reliability); aws.com/sqs + /sns (pricing, FIFO TPS, durability).

**Footguns (linked in-line above):**
- NATS slow consumer: nats-io slow_consumers docs, nats.go #524/#888/#1950/#1981, nats.c #317, nats-server #217/#5930/#5394, nats-server discussion #7068.
- NATS durability: securitydataworks 2026 (Jepsen v2.12.1 loss numbers + 2-min fsync); Snapp! 2025 re-architecture.
- Kafka rebalance: Nova AI Ops (9-min storm), slice.bank.in 2026 (15 s all-topic freeze → per-flow groups 30x), michal-drozd, matthewpalma 2026, Thriving.dev (>45 s Streams pause), KIP-848 (Confluent 2025), LinkedIn (8-min outage).
- Postgres: sql-notify docs, asyncpg guide, PgQueuer ADR-0003, nerdleveltech 2026 (commit serialization, PgBouncer), monpg 2026, matthewpalma 2026, Neon.
- Redis: GitLab SRE survival guide (OOM), GitLab scalability (single-core, dumb secondaries).
- RabbitMQ: rabbitmq-server #4811, rabbitmq.com/docs/streams, skalablog (no fsync-before-confirm).
- GCP/AWS: c3x 2026 (fan-out billing), Pub/Sub ordering/reliability docs, SQS FIFO quotas, dev.to 1 MiB.

**Git-platform usage (public sources):**
- GitHub → Kafka: github.blog "How we improved push processing on GitHub" (2024); scalablethread summary (~500M pushes/mo).
- GitLab → Redis + NATS (not Kafka): docs.gitlab.com (redis, architecture, scalability), runbooks.gitlab.com (Sidekiq + Redis survival guides), handbook.gitlab.com (messaging layer design doc — the "why not Kafka" table; DAP events).
- Atlassian/Bitbucket → durable event substrate + two-stage webhook pipeline: atlassian.com blog (2026); Bitbucket DC event-system docs.
- g1t.sh → SQLite log + fan-out + DLQ: docs.g1t.sh/architecture/events.
- Hootsuite → Kafka webhook dispatcher (2018); Shortcut → S3+SQS webhook bus (2019).
- NATS production users: Form3 (Gophercon UK 2021, replaced SNS/SQS), NVIDIA NVCF + inference.net (Synadia 2026), Snapp! (2025), Synadia named customers (Walmart, Rivian, Replit, FinecoBank, PowerFlex), nats-general #58 census.

**Repo pins (for permalink stability):** nats-server `dc55f4b` (v2.15.2) · redis `dc1e7e2`
(8.10.3) · apache/kafka `598caf0` (4.x, KRaft-only).

---
*Prepared as input to the OpenForge event-bus architecture RFC. Combine with the vendor
comparison (Agent 8) and reliability-problem research (Agent 3). Numbers are cited to
their sources in-line; re-run the sepp/brokers-bench/watermill suites on your own
hardware before fine-tuning retention/fsync, per the sepp methodology note.*
