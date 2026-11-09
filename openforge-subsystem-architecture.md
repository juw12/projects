# OpenForge — Subsystem Architecture Breakdown

> **Status:** DRAFT v0.1 — engineering plan table of contents
> **Owner:** Platform Engineering
> **Date:** 2026-11-03
> **Rule of the doc:** every subsystem below becomes one engineering epic. One ticket
> per sub-bullet in each "Core" block. Nothing in this document is aspirational filler;
> every "gotcha" is a load-bearing failure mode we expect to hit.

---

## 0. How to read this document

### 0.1 Purpose

OpenForge is a self-hostable, open-core Git platform (think: GitHub on infrastructure
you control). This document breaks the product into ten buildable subsystems plus the
cross-cutting concerns that span all of them. It is deliberately written to be the
**table of contents of the engineering plan**: section = epic, bullet = ticket,
"gotcha" = the acceptance criterion that most often fails in review.

### 0.2 Conventions

- **v1** = first production release (≈6-month target). **v2** = next milestone.
- Each "Core" block is a tight ~200-word narrative covering five points: what it does,
  the recommended library/pattern (with version), how it integrates, v1-vs-v2 scope,
  and one specific gotcha/risk.
- Each subsystem cites **one** open-source reference project (URL) and names exactly
  what we borrow and where we deliberately diverge.
- A version is given for every recommended library. Where the exact minor is not
  pinned at write time, the major is named and marked **(verify minor at ticket time)**
  rather than left vague.

### 0.3 Assumed platform stack

The subsystems are designed against one concrete stack. If the language decision
changes, the auth/data-plane recommendations are the ones that move most.

| Layer | Choice | Rationale |
|---|---|---|
| App API | **Hono** on Node 24 (TypeScript, ESM) | Fast, framework-agnostic, first-class for better-auth |
| ORM / schema | **Drizzle ORM 0.4x** over **PostgreSQL 16** | Typed, migration-friendly, row-level-security ready |
| Cache / queue / rate-limit / job-claim | **Redis 7** | One runtime for four jobs (cache, BullMQ, token bucket, runner claim) |
| Object storage | **S3-compatible (MinIO self-host, or S3 managed)** | LFS, backups, artifacts, cold packfiles |
| Background jobs | **BullMQ 5.x** (see §11.2 for the debate) | Redis-backed, mature, at-least-once with retries |
| Auth | **better-auth 1.7.15** (verified) | See §1 |
| Observability | **OpenTelemetry + Pino + Sentry** | See §11.4 |

### 0.4 Headline risk callout (read this first)

- **Highest-risk subsystem to build: Repository Storage (§2).** It is the foundation,
  the least reversible, and the one where a wrong early decision taxes every later
  subsystem. De-risk it early — not last.
- **Highest long-tail effort: GitHub Actions compatibility (§10).** The expression
  language plus the `actions/*` runtime is an open-ended surface. Scope it ruthlessly.
- **Build order (de-risking, not just dependency):** Auth (§1) → Repository Storage
  (§2) → Org Permissions (§6) → PR Review (§9) → everything else. Auth is first in
  *sequence* (low risk, unblocks all); Repository Storage is first in *risk*.

---

## 1. Authentication

**Ticket:** `OF-AUTH-000` · **Depends on:** — · **Blocks:** API guard, CI Runners, Orgs

### 1.1 Core (≈200 words)

OpenForge authentication must (1) issue and validate sessions for email/password
logins, (2) complete OAuth/OIDC sign-ins for Google, GitHub, and enterprise IdPs,
(3) accept SSH public keys for git-over-SSH, (4) enforce TOTP/email 2FA, and (5)
support FIDO2/WebAuthn passkeys as a primary factor. The stack is **better-auth
1.7.15** (verified latest on the npm registry, 2026-11-01) on a Drizzle + Postgres
adapter. better-auth ships the `two-factor`, `magic-link`, `organization`,
`social-providers`, `jwt`, `captcha`, and `device-authorization` plugins plus a
dedicated **`@better-auth/passkey`** package, and uses `jose 6.2.3` for JWE/JWT. It
integrates with every subsystem: the API guard reads the session cookie, CI Runners
authenticate via the device-authorization flow to claim jobs, and Org Permissions
consumes the organization plugin's membership model. In v1 ship email/password,
GitHub+Google OAuth, SSH keys, TOTP 2FA, and passkey registration; defer SAML, SSO
federation, and one-tap to v2. The specific gotcha: better-auth's `two-factor`
after-hook only matches `/sign-in/email`, `/sign-in/username`, and
`/sign-in/phone-number` — it does **not** intercept `/passkey/verify-authentication`
or the OAuth `/callback/:id`, so a 2FA-enabled user can bypass 2FA entirely by
logging in with a passkey or a social provider. You must add a second after-hook
covering those paths, or 2FA is security theater.

### 1.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Core framework | `better-auth` | **1.7.15** (verified 2026-11-01) | Replaces deprecated Lucia |
| Passkeys / WebAuthn | `@better-auth/passkey` | 1.7.15 (package track) | Separate package, not core export |
| 2FA (TOTP/OTP) | `better-auth/plugins/two-factor` | 1.7.15 | See gotcha §1.6 |
| Social (Google/GitHub) | `better-auth/social-providers` | 1.7.15 | Built-in provider list |
| Orgs/membership | `better-auth/plugins/organization` | 1.7.15 | Feeds §6 |
| CLI/runner auth | `better-auth/plugins/device-authorization` | 1.7.15 | OAuth Device Flow for runners |
| Breach-check | `better-auth/plugins/haveibeenpwned` | 1.7.15 | Password policy |
| Token/JWE | `jose` | 6.2.3 | Transitive, do not fork |
| DB adapter | `@better-auth/drizzle-adapter` | 1.7.15 | Postgres via Drizzle |

### 1.3 Integration points

- **Upstream (who calls it):** every API route via a session guard; the public
  `/login`, `/callback/:id`, `/passkey/*` endpoints; the git-over-SSH `sshd` shim
  (key → identity lookup).
- **Downstream (what it calls):** Postgres (users, sessions, passkeys, 2FA tables),
  the Email subsystem (§11.3) for magic-link/OTP/breach alerts.
- **Contracts emitted:** a signed session cookie; an `authenticated user` context
  object on every request; SSH public-key records consumed by §2.

### 1.4 Reference project

- **Gitea** — <https://github.com/go-gitea/gitea>
- **Borrow:** the unified identity model where one user can have email/password,
  OAuth, and N SSH keys coexisting; the "key has a title + fingerprint, revocable
  per-key" design; the account-security settings page (2FA, passkeys, sessions).
- **Diverge:** Gitea is Go and monolith-wired; we use better-auth's plugin model and
  keep authn separate from the git data plane so SSH key auth is a lookup, not a
  credential check.

### 1.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Email/password (argon2id) | SAML enterprise IdP |
| GitHub + Google OAuth | SSO federation / IdP discovery |
| SSH public keys (add/revoke) | One-tap (Google) sign-in |
| TOTP + email-code 2FA | WebAuthn as *only* factor (passwordless org policy) |
| Passkey registration + use | Passkey cross-device (sync) |
| Session list + revoke | Device-trust policies per org |

### 1.6 Gotcha / risk (specific)

better-auth's 2FA enforcement is an **`after` hook whose matcher only fires for
`/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`**. The passkey
endpoint (`/passkey/verify-authentication`) and the OAuth callback (`/callback/:id`)
mint a session with no 2FA gate. Consequence: a user who "enables 2FA" is fully
protected only against password logins. **Fix in v1:** register a second after-hook
that matches the passkey + social callback paths and, when
`user.twoFactorEnabled`, deletes the fresh session and forces the challenge. Also
note the passkey plugin hardcodes `requireUserVerification: false` in the
verification path, so you cannot require a platform authenticator's user-presence
prompt out of the box — patch or wrap it if you need it.

---

## 2. Repository Storage

**Ticket:** `OF-GIT-000` · **Depends on:** Auth (§1) · **Blocks:** PR Review, Issues,
Wiki, Actions, Webhooks

### 2.1 Core (≈200 words)

OpenForge's data plane must (1) accept and serve git pushes/fetches over smart-HTTP
and SSH, (2) store bare repositories durably, (3) keep large-binary LFS objects
separate from git history, and (4) back up and archive cold packfiles. The pattern is
**GitLab's storage topology, not a novel "git-on-S3"**: bare repos live on POSIX
storage nodes and are served by git's `http-backend` and `git-upload-pack`/
`git-receive-pack`; **MinIO/S3** holds LFS objects, package artifacts, CI artifacts,
and *snapshots* of repos (backup + cold archive) — not the live object store. In
TypeScript, programmatic git (create repo, `merge-base`, diff) shells out to
**git 2.45+** via `simple-git 3.x`; LFS uses the **git-lfs 3.x** server protocol with
objects addressed by SHA-256 OID in S3. It integrates as the substrate: §9 computes
diffs from the stored objects, §7 links issues to commits, §8 stores the wiki as a
repo, §10 fetches working trees for jobs. v1: local bare repos + S3 LFS + nightly
snapshot. Defer to v2: true object-storage-backed live git and cross-region
replication. Gotcha: a partial S3 upload of a `.pack`/`.idx` pair corrupts the repo,
and S3 **ETag ≠ SHA-256** for multi-part objects — you must verify LFS content by
OID, never by ETag.

### 2.2 Recommended stack

| Component | Library / tool | Version | Notes |
|---|---|---|---|
| Git runtime | `git` (system) | 2.45+ | Authoritative for diffs/merge-base |
| TS git wrapper | `simple-git` | 3.x (verify minor) | Thin spawn wrapper |
| Smart-HTTP serving | git `http-backend` CGI | 2.45+ | Or a Go/Node git server |
| git-over-SSH | `sshd` + `git-receive-pack` | OpenSSH 9.x | Key auth via §1 |
| LFS server | `git-lfs` (server) | 3.x | OID = SHA-256 |
| Object store | MinIO / S3 SDK (`@aws-sdk/client-s3`) | 3.x | LFS, snapshots, artifacts |
| Repo backup | `restic` / `rclone` | 0.1x | Snapshot to S3 |

### 2.3 Integration points

- **Upstream:** the git endpoints (HTTP + SSH) fronted by the API; §9/§7/§10 read
  objects for diffs, commit links, and job checkouts.
- **Downstream:** POSIX storage node + MinIO/S3. Postgres holds only *metadata*
  (repo id, default branch, head ref) — **never object data**.
- **Contracts:** a stable `repo_id → path` mapping; LFS `oid` lookup; a
  `head(ref)` read used by §9/§10.

### 2.4 Reference project

- **GitLab** — <https://gitlab.com/gitlab-org/gitlab>
- **Borrow:** the clean split (git on storage node; S3 for LFS/packages/artifacts);
  the `gitlab-shell`-style thin SSH entrypoint that authenticates then execs git;
  the "repo metadata in DB, objects on disk" boundary.
- **Diverge:** GitLab is multi-process Ruby+Go; we keep one TypeScript control plane
  and one dumb storage node, and we do **not** attempt live git-on-S3 in v1.

### 2.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Bare repos on POSIX storage node | Live object-storage-backed git |
| git smart-HTTP + SSH push/fetch | Cross-region active replication |
| S3 LFS (OID-addressed) | LFS dedupe across tenants |
| Nightly snapshot backup to S3 | PITR / point-in-time restore |
| `merge-base` + diff service | Packfile-level GC tuning service |

### 2.6 Gotcha / risk (specific)

**Atomicity + checksums.** (a) `.pack` and `.idx` must land together; a partial S3
upload or a crash mid-write yields a repo that `git fsck`-fails. Write objects to a
temp path and rename; never stream-in-place. (b) **S3 ETag is not SHA-256** for
multi-part uploads — if you key LFS by ETag you will silently serve the wrong bytes.
Always key LFS by the git-lfs **OID (SHA-256)** and re-hash on upload. (c) Running
`git gc` while serving a push can delete in-flight objects; serialize maintenance
behind the same lock that guards writes.

---

## 3. Webhooks

**Ticket:** `OF-HOOK-000` · **Depends on:** Repo Storage, Events bus · **Blocks:** —

### 3.1 Core (≈200 words)

OpenForge webhooks must (1) fan out domain events (push, PR opened/closed, issue
comment, release, workflow run) to user-registered URLs, (2) retry failures with
bounded exponential backoff, (3) sign every delivery so receivers can verify the
source, and (4) retain a delivery log for debugging and replay. The pattern mirrors
GitHub: sign the raw JSON body with **HMAC-SHA256** using the endpoint's shared
secret and send it in an `X-Hub-Signature-256`-style header plus an `X-GitHub-
Event`-style type header and a delivery `Id`. Delivery runs on **BullMQ 5.x** (Redis):
each event enqueues one job per subscribed endpoint; failed deliveries requeue up to
3 attempts (10s / 30s / 60s) then mark dead and stop. It integrates by *consuming*
the same event stream that §11.2's job bus produces (push from §2, state changes
from §7/§9), and by exposing a `/webhooks` settings API. v1: push + PR + issue
events, 3 retries, 30-day log, single signing key. Defer: delivery replay UI, secret
rotation window, per-IP allow/deny. Gotcha: delivery is **at-least-once**, so
receivers get duplicates after a retry — you cannot dedupe for them, so the contract
must document idempotency and include the stable delivery `Id` in the signature
input.

### 3.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Delivery queue | `bullmq` | 5.x | Retry w/ backoff, dead-letter |
| HTTP client | Hono `app.fetch` / `undici` | undici 7.x | Timeout + connect limit |
| Signing | Node `crypto` (HMAC-SHA256) | builtin | `sha256=` + hex |
| Log store | Postgres `hook_deliveries` | — | Partitioned by day |
| Testing tunnel | `smee-client` | 2.x | Local dev relay |

### 3.3 Integration points

- **Upstream:** the event bus (every subsystem that emits domain events).
- **Downstream:** Redis (BullMQ), Postgres (delivery log + endpoint config).
- **Contracts:** an `Event { type, repo, actor, payload, occurred_at }`; a
  `HookEndpoint { url, secret, active, events[] }`; a `Delivery { id, status,
  attempt, response_code, latency_ms }`.

### 3.4 Reference project

- **Gitea** — <https://github.com/go-gitea/gitea>
- **Borrow:** the delivery-record table (one row per attempt, with status + body
  snippet), the secret-per-endpoint + HMAC signing, and the bounded retry count.
- **Diverge:** Gitea retries in-process with a cron sweep; we use BullMQ so retries
  survive restarts and scale horizontally.

### 3.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Push / PR / issue events | Release, check-run, workflow events |
| 3 retries, 10/30/60s | Adaptive backoff + jitter tuning |
| Single signing key per endpoint | Dual-key rotation window |
| 30-day delivery log, viewable | Manual replay-from-log UI |
| — | Per-IP allow/deny, webhook fan-out groups |

### 3.6 Gotcha / risk (specific)

**Idempotency is the receiver's job, and the signature must cover it.** Because
delivery is at-least-once, a transient 5xx causes a retry with a *new* delivery `Id`
but the *same* underlying event. If you sign only the body, a receiver can't tell
"new event" from "redelivered event." Put the stable **event `Id`** (not just the
delivery `Id`) into the HMAC input and require receivers to store seen event IDs.
Also: log retention is a GDPR/privacy surface — truncate response bodies in the log
and set a hard 30-day TTL, or you'll be retaining customer PII in webhook payloads.

---

## 4. CI Runners

**Ticket:** `OF-RUNNER-000` · **Depends on:** Auth, Repo Storage, Actions (§10) ·
**Blocks:** —

### 4.1 Core (≈200 words)

OpenForge's runner subsystem must (1) claim jobs from a queue and execute them on
ephemeral containers (or VMs), (2) expose **repo-scoped secrets** only to jobs in
that repo, (3) stream logs and results back, and (4) tear down the environment
after each job. The control plane is TypeScript; the worker executes jobs by talking
to the **Docker Engine API** (`dockerode 4.x`) for the container path or emitting a
**Kubernetes `batch/v1` Job** for the VM/cluster path. Job claiming is an atomic
`SELECT ... FOR UPDATE SKIP LOCKED` against a Postgres `ci_jobs` table (or a Redis
`SET NX`) so two runners never claim one job. Runners authenticate to the claim
endpoint via better-auth's **device-authorization** flow (§1), not a long-lived token.
Secrets are envelope-encrypted at rest (KMS/data-key) and injected as env vars at
container start, never persisted to disk. It integrates with §10 (which produces the
job graph from Actions YAML) and §2 (checkout). v1: single-node container runner,
repo secrets, log streaming, per-job teardown. Defer: self-hosted runner pools, VM
runner, runner autoscaling. Gotcha: **egress is the attack surface** — a runner
checks out untrusted code and holds secrets, so it must run with network egress
restricted to the package registry + this host, a non-root user, and a read-only root
fs.

### 4.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Job claim | Postgres `SKIP LOCKED` / Redis `SET NX` | — | Atomic, no double-claim |
| Container exec | `dockerode` | 4.x | Docker Engine API |
| Cluster path | Kubernetes client (`@kubernetes/client-node`) | 1.x | batch/v1 Job |
| Runner auth | better-auth `device-authorization` | 1.7.15 | No long-lived tokens |
| Secret encryption | `node:crypto` (AES-256-GCM) + KMS | builtin | Envelope encryption |
| Log streaming | SSE / WebSocket + Redis Stream | — | Append-only per job |

### 4.3 Integration points

- **Upstream:** §10 (job graph), §1 (runner identity), §6 (who may trigger).
- **Downstream:** Docker/K8s, MinIO (artifacts), Postgres (`ci_jobs`, `ci_logs`).
- **Contracts:** `Job { id, repo, ref, env[], secrets[], steps[], status }`;
  `RunnerPool { capacity, region }`; result + artifact upload callback.

### 4.4 Reference project

- **Woodpecker CI** — <https://github.com/woodpecker-ci/woodpecker>
- **Borrow:** the decoupled agent model (control plane assigns, dumb agent executes
  on ephemeral infra), the per-repo secret scoping, and the clean "job → step →
  log" data model.
- **Diverge:** Woodpecker uses its own YAML; we must execute *GitHub Actions* YAML,
  which is why §10 is a separate, heavier subsystem.

### 4.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Single-node container runner | Self-hosted runner pools |
| Repo-scoped secrets (AES-GCM) | Org-scoped + shared secrets |
| SSE log streaming | Log search / retention tiers |
| Per-job teardown | VM runner + autoscaling |
| — | Runner metrics → Billing metering (§5) |

### 4.6 Gotcha / risk (specific)

**A runner is a multi-tenant code-execution boundary.** It checks out *untrusted*
code and is handed *secrets*. If egress is open, a single malicious job exfiltrates
secrets or pivots to the metadata endpoint. Enforce, per job: (a) a dedicated
non-root user, (b) read-only root filesystem with an ephemeral workspace, (c) a
network policy allowing egress only to the package registries and the control-plane
callback, (d) no `privileged: true`, no host mounts. And make the **claim** atomic —
a race that double-claims a job means two containers both read the same secret and
write the same artifact, which is both a correctness bug and a data-leak vector.

---

## 5. Billing & Metered Plans

**Ticket:** `OF-BILL-000` · **Depends on:** Org model (§6) · **Blocks:** — (limits enforced by §2/§4)

### 5.1 Core (≈200 words)

OpenForge billing must (1) sell fixed plans and metered add-ons through Stripe, (2)
record usage (runner-seconds, storage-GB, LFS-GB, API calls) in a durable ledger,
(3) enforce plan limits at the edge before work happens, and (4) produce invoices and
handle failed payments. The stack is **stripe-node 18.x** (verify minor) on the
**Stripe Billing** metered API: usage is emitted as meter events via
`stripe.billing.meterEvents.create` and aggregated into line items; the local source
of truth is a Postgres `usage_events` ledger (one append-only row per metered unit)
reconciled against Stripe nightly. Limit enforcement is a synchronous check in the
API/runner gate: read the current period's usage for the org, compare to the plan
ceiling, and 403 (or downgrade) before allocating a runner or accepting new LFS. It
integrates with §4 (runner-seconds), §2 (storage/LFS GB), and the Org model (§6) for
the billing subject. v1: monthly plans, runner-seconds + storage metering, Stripe
Checkout + Customer Portal, dunning email. Defer: usage-based auto-pricing, multiple
currencies, and air-gapped (no-Stripe) mode. Gotcha: Stripe webhooks are
**at-least-once** — store `event.id` and dedupe, or a retried `invoice.payment_failed`
double-triggers dunning; and metered usage double-counts if a job retries, so meter
by *settled* job, not by attempt.

### 5.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Stripe SDK | `stripe` (stripe-node) | 18.x (verify minor) | Billing + Checkout + Portal |
| Metered billing | Stripe **Billing** (meter events) | API v2 | `meterEvents.create` |
| Local ledger | Postgres `usage_events` | — | Append-only, partitioned |
| Reconciliation | BullMQ scheduled job | 5.x | Nightly Stripe↔ledger diff |
| Limits gate | in-API middleware | — | Sync check before work |

### 5.3 Integration points

- **Upstream:** §4 (runner-seconds), §2 (storage/LFS GB), API (call counters).
- **Downstream:** Stripe API + webhooks, Postgres ledger, Email (§11.3) for dunning.
- **Contracts:** `Plan { id, limits{runner_s, storage_gb, lfs_gb} }`; `UsageEvent { org, meter, qty, period, settled }`; `StripeCustomer ↔ org` mapping.

### 5.4 Reference project

- **Meteroid** — <https://github.com/meteroid/meteroid>
- **Borrow:** the metered-usage ledger pattern (usage recorded locally, billed via Stripe meters), the "meter definition is data, not code" model, and the Stripe-webhook idempotency handling.
- **Diverge:** Meteroid is a standalone billing engine we adopt conceptually, not as a drop-in; OpenForge keeps the ledger in the app DB so a limit check is a local read, not a remote call.

### 5.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Monthly plans | Annual + custom contracts |
| Runner-seconds + storage metering | API-call + compute-tier metering |
| Stripe Checkout + Customer Portal | Usage-based auto-pricing tiers |
| Dunning email | Multi-currency, FX |
| — | Air-gapped / no-Stripe self-host mode |

### 5.6 Gotcha / risk (specific)

**Double-counting, twice.** (a) Stripe webhooks are at-least-once: a retried
`invoice.payment_failed` re-fires your dunning handler unless you persist `event.id`
and no-op repeats. (b) Usage metering: if you meter by *job attempt*, a flaky job that
retries 3× bills the customer 3× for one logical run. Meter by the **settled** job
(final status) and make the ledger **append-only + idempotent** (one row per
`(job_id, meter)`, insert-if-absent) so nightly reconciliation can re-emit events
without inflating the total.

---

## 6. Organization Permissions

**Ticket:** `OF-ORG-000` · **Depends on:** Auth (§1) · **Blocks:** PR merge (§9), repo write (§2)

### 6.1 Core (≈200 words)

OpenForge org permissions must (1) model organizations and nested teams, (2) assign
role-based access to members and resources, (3) evaluate access on every request, and
(4) enforce **branch rulesets** (required reviewers, signed commits, protected
branches) at push/merge time. The model borrows GitLab's group hierarchy — org ⊃ team
⊃ project — with roles as an ordered ladder (owner > admin > write > read) plus
per-resource overrides. The policy engine is **Cerbos 0.4x** (verify minor), a
separate decision service queried as `Check({ resources, subjects })`, rather than
hand-rolled RBAC, because rulesets are *policy* and deserve a testable, versioned
policy store. Decisions are cached in Redis for ~30s to keep the hot path fast. It
integrates with Auth (§1) for identity, the API guard for per-request checks, and §9
(merge gating), which calls the same service to decide if a PR may merge. v1: orgs,
teams, the 4-role ladder, per-repo access, protected branches + required reviewers.
Defer: fine-grained content permissions, ruleset expressions, external IdP group
sync. Gotcha: rulesets are **global/branch-scoped and must be enforced server-side**
(pre-receive + merge check), not in the UI — a client-side "required reviewer" is
bypassed by a push, so the only correct block point is `git-receive-pack`/merge,
meaning the policy service must be reachable from the storage node.

### 6.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Policy engine | **Cerbos** | 0.4x (verify minor) | Decision service, policy-as-data |
| Embedded alt | `@node-casbin/adapter-postgresql` + casbin | casbin 2.x | If you reject a sidecar |
| Role model | Drizzle `org_members`, `teams` | 0.4x | Ordered role ladder |
| Decision cache | Redis | 7 | ~30s TTL |
| Push enforcement | pre-receive hook → policy svc | — | Must reach storage node |

### 6.3 Integration points

- **Upstream:** every API route (guard), §9 merge gate, §2 pre-receive.
- **Downstream:** Cerbos (or casbin), Redis cache, Postgres (orgs/teams/membership).
- **Contracts:** `Role ∈ {owner, admin, write, read}`; `Ruleset { scope, conditions[], enforcement }`; `Check → { allowed, reason, version }`.

### 6.4 Reference project

- **GitLab** — <https://gitlab.com/gitlab-org/gitlab>
- **Borrow:** the group→project inheritance, the granular role set, protected branches + approval rules (the closest OSS analog to GitHub rulesets), and the "policy evaluated at push/merge, not UI" posture.
- **Diverge:** GitLab's roles are DB-embedded; we externalize policy to Cerbos so rulesets are versioned, auditable, and unit-testable without an app deploy.

### 6.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Orgs + teams (no team nesting) | Fine-grained content permissions |
| 4-role ladder | Ruleset expression language |
| Per-repo access inheritance | External IdP / SCIM group sync |
| Protected branches + required reviewers | Path-scoped rulesets |
| — | Delegated ownership, policy-change audit |

### 6.6 Gotcha / risk (specific)

**Enforcement location.** A ruleset that only blocks in the web UI is *not enforced* —
anyone with push access bypasses it with `git push`. Rulesets must be evaluated in two
server-side gates: (1) **pre-receive** on the storage node (blocks direct pushes to
protected branches / unsigned commits) and (2) the **merge check** in §9 (blocks merge
without N approvals / green checks). That forces the policy service to be reachable
from the storage node and on the merge hot path — budget for a low-latency decision
API + cache, or your pushes stall. Also: GitHub teams **do not nest**; if you allow
team-in-team you must define the inheritance semantics explicitly or you'll create
privilege-escalation surprises.

---

## 7. Issue Tracker

**Ticket:** `OF-ISSUE-000` · **Depends on:** Org (§6) · **Blocks:** — (feeds §3, §9)

### 7.1 Core (≈200 words)

OpenForge's issue tracker must (1) store issues with a fixed schema plus user-defined
**custom fields**, (2) support labels, milestones, and assignment, (3) express
issue-to-issue **dependencies** (blocks / blocked-by), and (4) import existing
**GitHub Issues**. The store is Postgres via **Drizzle ORM 0.4x**: issues, labels,
milestones, and `issue_dependencies` are normalized tables; custom fields are an
**EAV** `issue_field_values` table keyed by a typed `field_def`. Queries on custom
fields use Postgres generated/indexed columns (or a JSONB `field_values` with a GIN
index) so filtering stays fast. Dependencies form a directed graph; the API computes
"blocking" via a recursive CTE and rejects cycles on write. It integrates with §2
(issues link to commits/PRs by ref), §9 (PRs reference issues to auto-close), and the
event bus (§3) for notifications. v1: issues, labels, milestones, assignees, four
dependency states, and a one-way **GitHub import** via `@octokit/rest 20.x`. Defer:
kanban boards, automation rules, custom-field-level permissions. Gotcha: **EAV custom
fields destroy query performance** if you naively JOIN — a list filtered on a custom
field becomes a correlated subquery; precompute indexed columns or p99 blows up as the
field count grows. And the GitHub import must re-link `#123` mentions, or imported
issues arrive with dead links.

### 7.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| ORM | `drizzle-orm` | 0.4x | Normalized + EAV tables |
| Custom fields | EAV + JSONB GIN index | — | Indexed for filtering |
| Dependency graph | Postgres recursive CTE | — | Cycle-reject on write |
| GitHub import | `@octokit/rest` | 20.x | Paged, rate-limited |
| Events | BullMQ / event bus | 5.x | Feeds §3 webhooks |

### 7.3 Integration points

- **Upstream:** users (create/edit), §9 (PR↔issue links), the GitHub import job.
- **Downstream:** Postgres, event bus (§3), search index (cross-cutting, §11.4).
- **Contracts:** `Issue { id, repo, title, body, state, labels[], milestone, field_values }`; `Dependency { from, to, type }`; `IssueEvent` for webhooks.

### 7.4 Reference project

- **Plane** — <https://github.com/makeplane/plane>
- **Borrow:** the issue data model (labels, milestones, typed property/custom-field definitions), and the clean issue↔PR linkage.
- **Diverge:** Plane is a full PM suite with its own project space; OpenForge keeps issues tightly coupled to git refs and leaner, with the dependency graph (blocks/blocked-by) as first-class rather than an add-on.

### 7.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Issues, labels, milestones, assignees | Kanban / board views |
| 4 dependency states + cycle guard | Automation rules (issue triggers) |
| Custom fields (typed) | Custom-field-level ACL |
| One-way GitHub import | Bidirectional / live sync |

### 7.6 Gotcha / risk (specific)

**EAV performance + import linking.** (a) Custom fields as EAV: filtering
`WHERE field='severity' AND value='X'` is a correlated scan over the EAV table; at
scale that is a p99 killer. Mitigate with generated columns per hot field or a JSONB
+ GIN index — decide at schema time, not after you feel the pain. (b) A GitHub issue
`body` is Markdown containing `@mentions` and cross-repo refs; importing verbatim
gives dead links and wrong mention notifications. Re-resolve IDs to OpenForge IDs and
rewrite refs, or every imported issue ships with broken cross-references.

---

## 8. Wiki

**Ticket:** `OF-WIKI-000` · **Depends on:** Repo (§2), Org (§6) · **Blocks:** —

### 8.1 Core (≈200 words)

OpenForge wiki must (1) store pages as Markdown, (2) render them safely, (3) keep full
**version history** per page, (4) gate access by **ACL**, and (5) make pages
**searchable**. The storage pattern is the elegant one Gitea uses: **a wiki is a git
repository** (one `.md` file per page), so versioning, blame, and rollback come free
from §2's git data plane — you do not build a custom revision store. Rendering is the
**unified/remark** pipeline (`remark 15` + `unified 11`) for Markdown-to-HAST, with
`rehype-sanitize 6.x` as a mandatory final pass to strip executable content (stored
XSS). ACL is per-wiki visibility (private-to-org / public) plus per-page read
restrictions, checked by §6. Search runs on **Meilisearch 1.12** (self-hosted), fed by
an index job that re-indexes a page on each save; smaller deployments fall back to
Postgres `tsvector` full-text. It integrates with §2 (git), §6 (ACL), §7 (page links),
and §11.2 (the index job). v1: per-repo private wiki, Markdown + code highlighting,
full-text search, history/rollback. Defer: multi-language wikis, rich embeds, wiki
analytics. Gotcha: **wiki-as-git-repo means concurrent edits are merge conflicts, not
last-write-wins** — mitigate with optimistic concurrency (`If-Match` on the page
blob); and without `rehype-sanitize`, a single `<script>` in a page is stored XSS for
every reader.

### 8.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Markdown | `remark` + `unified` | remark 15, unified 11 | md → HAST |
| XSS | `rehype-sanitize` | 6.x | Mandatory anti-XSS pass |
| Search | `Meilisearch` | 1.12 | Self-host; or Postgres `tsvector` |
| Storage | git repo (via §2) | — | One `.md` per page |
| Concurrency | HTTP ETag / `If-Match` | — | Optimistic locking |

### 8.3 Integration points

- **Upstream:** users (edit), §2 (git storage), §6 (ACL).
- **Downstream:** git (via §2), Meilisearch index, event bus (§3) on save.
- **Contracts:** `Page { id, slug, blob_ref, visibility }`; `PageRevision` (from git); `Wiki { id, repo, visibility }`.

### 8.4 Reference project

- **Gitea** — <https://github.com/go-gitea/gitea>
- **Borrow:** the wiki-as-git-repo pattern (free versioning/rollback/blame from the git plane), per-wiki visibility, and the "page = file" model.
- **Diverge:** Gitea renders server-side without a sanitization story we'd trust; we make `rehype-sanitize` mandatory and add a dedicated search index (Gitea has none).

### 8.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Per-repo private wiki | Multi-language wikis |
| Markdown + code highlighting | Rich embeds (diagrams, iframes) |
| Full-text search (Meili/FTS) | Wiki analytics / view counts |
| History + rollback | Cross-wiki links, page templates |

### 8.6 Gotcha / risk (specific)

**Two failure modes, one each.** (a) **Concurrency:** wiki-as-git means two editors
saving the same page produce a *merge conflict*, not last-write-wins — a non-technical
user cannot resolve a git conflict in the wiki. Mitigate with optimistic concurrency
(`ETag`/`If-Match` on the page blob) and a "someone else updated this, reload or
overwrite" prompt. (b) **Stored XSS:** Markdown rendered to HTML without a sanitizer
lets one `<script>` or `onerror=` in a page execute for *every* reader of that wiki.
`rehype-sanitize` is not optional; it must be the final pipeline step and must run on
import, not just on edit.

---

## 9. Pull Request Review

**Ticket:** `OF-PR-000` · **Depends on:** Repo (§2), Org (§6) · **Blocks:** — (feeds §3)

### 9.1 Core (≈200 words)

OpenForge pull-request review must (1) render an accurate **diff**, (2) support
**review threads** and **suggested changes**, (3) aggregate **status checks** into a
mergeable verdict, and (4) gate merges on required checks + approvals. The diff is
always a **three-way diff against the merge-base** (never head-vs-head), computed by
shelling to `git` on §2's objects — using merge-base avoids showing the base branch's
own changes as the PR's. Text diffing/patching uses **jsdiff (`diff` 8.x)**; HTML
rendering uses **diff2html 3.4.x**. Review comments are anchored to a diff hunk by a
stable position key (file + side + line + a content-hash), which is what lets a thread
survive when the PR updates. Suggested changes are stored as a patch and "applied" by
re-running it against the current head with conflict detection. Status checks follow
GitHub's **Check Suite / Check Run** model: each run has `status`
(queued/in_progress/completed) and `conclusion` (success/failure/…), and a PR is
mergeable only when all *required* suites conclude success. It integrates with §2
(objects), §10 (CI posts check runs), §6 (who may approve). v1: diff, review threads,
suggested changes, check runs + required gating. Defer: edit-in-diff, code-scanning
annotations. Gotcha: the anchor must include a **content hash**, not just line numbers
— after a push, line numbers shift and a line-anchored comment silently attaches to the
wrong line.

### 9.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| Diff (text/patch) | `diff` (jsdiff) | 8.x | Three-way vs merge-base |
| Diff (render) | `diff2html` | 3.4.x | Split/unified HTML |
| Merge-base | `git merge-base` (via §2) | 2.45+ | Authoritative |
| Check model | Check Suite / Check Run | — | GitHub-compatible |
| Suggested changes | patch + conflict detect | — | Re-apply on current head |

### 9.3 Integration points

- **Upstream:** §2 (objects for diff), §6 (approve permission), §10 (CI check runs).
- **Downstream:** Postgres (PRs, review threads, check runs), event bus (§3).
- **Contracts:** `PR { id, repo, head, base, merge_base }`; `ReviewThread { anchor }`; `CheckRun { suite_id, status, conclusion }`.

### 9.4 Reference project

- **GitLab** — <https://gitlab.com/gitlab-org/gitlab>
- **Borrow:** the merge-request discussion model (threads anchored to diff positions), suggested changes, approval rules as the merge gate, and pipelines-as-status checks.
- **Diverge:** GitLab's diff anchoring has historically drifted on rebase; we pin the anchor to a content-hash so threads survive pushes deterministically.

### 9.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| Three-way diff render | Edit-in-diff (inline code edit) |
| Review threads + position anchors | Code-scanning / SAST annotations |
| Suggested changes + apply | Cross-PR thread linking |
| Check runs + required gating | Merge trains / queue |

### 9.6 Gotcha / risk (specific)

**Anchoring + "no checks yet".** (a) A review comment anchored only to a line number
silently re-attaches to the *wrong* line after the PR is updated, because line numbers
shift. Anchor to `file + side + line + content-hash` and re-resolve on each push.
(b) The merge gate has a subtle state: a PR with **zero** check runs. If "mergeable =
all required checks green" and there are no required checks, the PR is always
mergeable — that's correct. But if a required check *suite exists but no run has
completed*, you must treat it as *not passing* (block), otherwise a PR whose CI hasn't
started is mergeable. Get the "pending required check" state right or you'll let
unverified code merge.

---

## 10. GitHub Actions Compatibility

**Ticket:** `OF-ACT-000` · **Depends on:** CI Runners (§4), Auth (§1) · **Blocks:** §4 execution

### 10.1 Core (≈200 words)

OpenForge must run **GitHub Actions** workflows so users port existing YAML with near-
zero edits. This subsystem must (1) **parse** the workflow YAML (triggers, jobs,
`steps`, the `needs` DAG), (2) expand **matrix builds** into the Cartesian product of
job instances, (3) evaluate the **`${{ }}` expression language** (contexts
`github/secrets/env/matrix/inputs` + functions like `format`, `join`, `contains`,
`startsWith`, `toJSON`, `hashFiles`, `always`, `success`), (4) execute `actions/*`
from the marketplace (JS, composite, Docker), and (5) implement the **runner API**
(job claim + log streaming) that §4 executes. Parsing uses the `yaml 2.6` package;
the expression language is a small custom grammar — we port a vetted subset from
**nektos/act** rather than hand-roll a parser, and we *version-lock* which GitHub
Actions semantics we support via a published compatibility matrix. It integrates with
§4 (the executor), §1 (secrets + runner auth), §9 (posts check runs). v1: the 80% of
expressions that cover real workflows, `actions/checkout` + `actions/setup-*`, matrix,
`needs`, secrets, artifacts. Defer: full expression parity, service containers,
self-hosted runner registration UI. Gotcha: the expression language is an **open-ended
long tail** — `hashFiles` reads the working tree and `always()` must still run a step
after a prior step failed; get the short-circuit/`if:` semantics wrong and a caching or
cleanup step silently never runs.

### 10.2 Recommended stack

| Component | Library | Version | Notes |
|---|---|---|---|
| YAML parse | `yaml` (eemeli) | 2.6 | Workflow + composite |
| Expression lang | port from `nektos/act` | act 0.2.x (verify) | `${{ }}` grammar |
| Matrix expand | in-app (Cartesian) | — | `×` of matrix axes |
| Action runtime | JS (Node) / composite / Docker | — | `actions/*` compat |
| Runner API | long-poll + log stream | — | Job claim → §4 |

### 10.3 Integration points

- **Upstream:** §1 (secrets, runner identity), §6 (who may trigger).
- **Downstream:** §4 (executor), §9 (check runs), MinIO (artifacts).
- **Contracts:** `Workflow { jobs[], needs DAG, matrix }`; `JobInstance` (post-expansion); `ActionSpec { type: js|composite|docker }`.

### 10.4 Reference project

- **nektos/act** — <https://github.com/nektos/act>
- **Borrow:** the expression-language implementation (contexts + functions), the `needs` DAG evaluation, matrix expansion, and the `actions/checkout`/`setup-*` behavior.
- **Diverge:** act is a local dev tool that runs everything in-process; we target a distributed runner pool (§4) with a real runner API and a published, version-locked compatibility matrix instead of "best-effort parity."

### 10.5 v1 vs v2

| In v1 | Deferred to v2 |
|---|---|
| 80% of expressions (the common set) | Full GitHub expression parity |
| `actions/checkout`, `actions/setup-*` | Service containers |
| Matrix + `needs` DAG | Composite-action marketplace browsing |
| Secrets + artifacts | Self-hosted runner registration UI |
| — | `environment` protection rules, concurrency groups |

### 10.6 Gotcha / risk (specific)

**The expression language is an open-ended long tail, not a one-time build.** Three
concrete traps: (1) `hashFiles('**/package-lock.json')` reads the *working tree*, so
you must implement it against the checked-out repo, not a metadata lookup — get it
wrong and cache keys collide. (2) `if: ${{ always() }}` must run a cleanup/deploy step
*even after a prior step failed* — naive short-circuit evaluation silently skips
exactly the steps users rely on for rollback. (3) `fromJSON`/`toJSON` parse
*untrusted* workflow data; a malicious `secrets`/`env` value that breaks the JSON
round-trip can change control flow. Budget this subsystem as a **continuing parity
effort** with a tracked compatibility matrix, not a fixed-scope ticket.

---

## 11. Cross-cutting Concerns

These are not features; they are services every subsystem depends on. They get their
own epics but ship behind the first vertical slice (§1 + §2 + one read path), not on
day one.

### 11.1 Audit logging

- **What:** an append-only, tamper-evident record of *who did what to what, when* —
  every auth event, permission change, push, merge, secret rotation, billing event.
- **Recommendation:** a dedicated `audit_events` table in Postgres, partitioned by
  month, **append-only** (no UPDATE/DELETE grants), with each row hash-chained
  (`prev_hash`) so back-dated edits are detectable. Emit via the same event bus as
  §3 so audit is a subscriber, not an inline call. Hot rows in Postgres, cold rows
  flushed to S3 after 90 days.
- **2024–26 shift:** teams moved from "log to the app log" to *structured, queryable,
  immutable* audit as a compliance requirement (SOC 2 / ISO 27001); hash-chaining is
  now table-stakes for "prove it wasn't tampered with."
- **Reference:** **Gitea** — <https://github.com/go-gitea/gitea> (activity log as a
  first-class, per-user + per-repo feed). Borrow the event taxonomy; diverge by making
  it append-only + hash-chained (Gitea's log is mutable).

### 11.2 Background job system  *(the BullMQ vs Inngest debate)*

- **What:** durable, retryable async work — webhook retries (§3), search re-indexing
  (§8), GitHub import (§7), Stripe reconciliation (§5), CI fan-out (§4/§10), audit
  flush (§11.1).
- **Recommendation:** **BullMQ 5.x** on Redis as the default. We already run Redis for
  cache + rate-limit + runner-claim, so a second job runtime is pure overhead. BullMQ
  gives retries, backoff, dead-letter, and cron for free.
- **2024–26 shift (the real debate):**
  - **BullMQ** — Redis-backed, mature, at-least-once, you own the worker. Best when
    you have a long-lived service + Redis.
  - **Inngest 1.x** — the rising "durable execution" framework (steps, automatic
    replay, serverless-friendly, built-in observability). Wins if you go **serverless**
    or want step-level retry without writing it. The 2025 debate is essentially
    *"queue you operate" (BullMQ) vs "durable execution you rent/self-host" (Inngest).*
  - **pgmq** (Postgres-native, from AWS) / **pg-boss 10.x** — the "one less service"
    option if you'd rather not run Redis at all. Viable for a lean self-host profile.
  - **Decision rule:** default **BullMQ**; if the deployment target is serverless,
    switch to **Inngest**; if a customer refuses Redis, offer **pgmq**. Keep the job
    API thin so this is a swap, not a rewrite.
- **Reference:** **Inngest** — <https://github.com/inngest/inngest> for the durable-
  execution + step-retry model we'd adopt if we flip; **BullMQ** —
  <https://github.com/taskforcesh/bullmq> for the default.

### 11.3 Email delivery

- **What:** transactional mail (magic-link, 2FA OTP, mention/digest, dunning,
  passkey alerts) for every subsystem.
- **Recommendation:** **Nodemailer 7.x** as the transport library, pointed at a relay
  for v1 (Resend or Postmark) so we don't own SMTP deliverability on day one. For the
  fully self-hosted profile, stand up **Maddy** (a single-binary Go SMTP server,
  <https://github.com/mjl-/maddy>) with SPF + DKIM + DMARC configured. Digests/broadcast
  (release notes, org announcements) can use **Listmonk**
  (<https://github.com/knadh/listmonk>) if we outgrow transactional sends.
- **2024–26 shift:** deliverability got harder (major providers raised authentication
  bar: DKIM/DMARC + `List-Unsubscribe` now effectively mandatory for bulk); "just use
  nodemailer to localhost" silently fails in production.
- **Reference:** **Maddy** — <https://github.com/mjl-/maddy> (lightweight, modern SMTP
  for self-host) + **Listmonk** for the broadcast path.

### 11.4 Observability (OpenTelemetry + Sentry + structured logs)

- **What:** traces, metrics, structured logs, and error tracking — the "why is this
  slow / what broke" layer.
- **Recommendation:** **OpenTelemetry** as the single instrumentation standard —
  `@opentelemetry/api 1.9` + `@opentelemetry/sdk-node` (verify minor) for auto-
  instrumentation of Hono/Node + Postgres/Redis/HTTP. Structured logs via **Pino 9.x**
  (JSON, low-overhead), correlated to the active OTel trace id. Error tracking via
  **Sentry** (`@sentry/node 9.x`). Traces to **Grafana Tempo**, metrics to **Prometheus**
  + **Grafana** — all self-hostable, matching the product's ethos.
- **2024–26 shift:** OTel won the "which tracing standard" fight — vendor-specific
  agents are being replaced by OTel so you can switch backends; structured (JSON) logs
  superseded free-text logs for anything queryable.
- **Reference:** **OpenTelemetry** — <https://github.com/open-telemetry/opentelemetry-js>
  (the JS/TS SDK) + **Pino** — <https://github.com/pinojs/pino>.

### 11.5 Feature flags

- **What:** ship-behind-a-toggle for every risky rollout (rulesets, metered billing,
  Actions parity tiers, passkey-by-default).
- **Recommendation:** **GrowthBook 1.x** (self-hostable, open source, includes an
  A/B + paywall feature — useful since we have billing in §5). Alt: **Unleash 6.x** if
  you prefer the dedicated flag-service model. Flags read from a small API + client
  SDK, with server-side evaluation for anything security-relevant (never trust the
  client for a gate).
- **2024–26 shift:** flags + *experiments* are converging — teams want the same
  primitive to gate a feature and measure its impact, which is why GrowthBook (flags +
  experiments in one) is the pick over a flag-only tool.
- **Reference:** **GrowthBook** — <https://github.com/growthbook/growthbook>.

### 11.6 Rate limiting

- **What:** per-identity + per-org + per-IP throttling to stop abuse, credential
  stuffing (§1), API hammering, and runner-enqueue floods (§4).
- **Recommendation:** **Upstash RateLimit 2.x** (sliding window over Redis) for the
  API/runner claim path — it's Redis-native (we run Redis), supports sliding window +
  token bucket, and is multi-tenant keyed by `org:ip`. For credential-stuffing
  specifically, add a tighter per-IP + per-account limit *in front of* better-auth's
  sign-in, plus the `captcha` and `haveibeenpwned` plugins (§1).
- **2024–26 shift:** fixed-window (the old `express-rate-limit` default) is considered
  too coarse — sliding window / token bucket over a shared store (Redis) is the
  expected baseline for multi-tenant APIs.
- **Reference:** **Upstash RateLimit** — <https://github.com/upstash/ratelimit>.

---

## 12. Build order & highest-risk subsystem (decisive answer)

### 12.1 The question, answered

> **Which subsystem is the highest risk to build first?**

**Repository Storage (§2).** It is the single most dangerous early decision in the
whole product, for four compounding reasons:

1. **It is the foundation.** §7, §8 (wiki-as-git), §9 (diffs), §10 (checkouts), and
   §3 (push events) all read the git data plane. A wrong model here is discovered only
   after five other subsystems exist.
2. **It is the least reversible.** You can re-skin an API, re-shard a table, or swap a
   job library; you cannot easily migrate millions of existing packfiles between
   storage topologies without a stop-the-world.
3. **It is the hardest to get *right*, not just *working*.** Concurrency (push vs `gc`),
   partial-write atomicity, and the LFS OID-vs-ETag checksum trap (§2.6) are the kind
   of bugs that pass the happy path and corrupt data under load.
4. **It sets the performance floor.** Clone/fetch latency is the most user-visible
   number; a storage decision you make in month 1 caps the ceiling for the life of the
   product.

**But "highest risk" ≠ "build first."** Auth (§1) still ships first in *sequence*
because it is low-risk (better-auth does the heavy lifting) and unblocks every other
epic. Repository Storage must be **de-risked early — by sprint 3–4, not in the last
month** — via a spike: push 10k commits to the chosen topology, run `git fsck`,
measure clone p95, and crash-test a mid-write S3 upload. If the spike fails, you still
have time to change course.

### 12.2 Sequenced plan (de-risking order)

| Phase | Subsystems | Why this order |
|---|---|---|
| P0 (sprint 1–2) | §1 Auth, §11.4 Observability, §11.1 Audit | Unblocks all; you cannot see/audit anything without these |
| P1 (sprint 3–4) | §2 Repository Storage (**spike first**) | Highest risk — de-risk before stacking on it |
| P2 (sprint 5–7) | §6 Org Permissions, §3 Webhooks | §9 and §2-pre-receive need the policy engine; events need a bus |
| P3 (sprint 8–10) | §9 PR Review, §7 Issues | The core product loop (clone → review → merge → track) |
| P4 (sprint 11–13) | §4 CI Runners, §10 Actions compat | Long-tail effort; start §10 expression port in parallel |
| P5 (sprint 14–16) | §8 Wiki, §5 Billing, §11.2–11.6 | Completing the platform; billing gates GA |

### 12.3 Risk register (all ten, ranked)

| Rank | Subsystem | Risk type | One-line reason |
|---|---|---|---|
| 1 | §2 Repository Storage | Irreversibility + correctness | Foundation; packfile atomicity + LFS checksum trap |
| 2 | §10 Actions compat | Long-tail effort | Open-ended expression grammar + `actions/*` runtime |
| 3 | §6 Org Permissions | Retro-fit difficulty | Rulesets must be enforced server-side; hard to add later |
| 4 | §1 Auth | Security (mitigated) | 2FA-matcher bypass (§1.6) — real but fixable in days |
| 5 | §9 PR Review | Correctness (diff) | merge-base + anchor stability under rebase |
| 6 | §4 CI Runners | Security (egress) | Untrusted code + secrets = blast radius |
| 7 | §7 Issues | Performance (EAV) | Custom-field queries; schema-time decision |
| 8 | §5 Billing | Money correctness | Double-count / proration |
| 9 | §3 Webhooks | Ops (reliability) | At-least-once → dedupe discipline |
| 10 | §8 Wiki | Lower (git-backed) | Concurrency + XSS, both well-understood |

---

## 13. Master reference project index

| # | Subsystem | Reference project | URL | What we borrow (one line) |
|---|---|---|---|---|
| 1 | Auth | Gitea | <https://github.com/go-gitea/gitea> | Unified identity (email+OAuth+N SSH keys coexist) |
| 2 | Repo Storage | GitLab | <https://gitlab.com/gitlab-org/gitlab> | git-on-node + S3-for-LFS split; metadata-in-DB boundary |
| 3 | Webhooks | Gitea | <https://github.com/go-gitea/gitea> | Per-attempt delivery log + HMAC signing |
| 4 | CI Runners | Woodpecker CI | <https://github.com/woodpecker-ci/woodpecker> | Decoupled control-plane / ephemeral-agent model |
| 5 | Billing | Meteroid | <https://github.com/meteroid/meteroid> | Local usage ledger + Stripe meter reconciliation |
| 6 | Org Permissions | GitLab | <https://gitlab.com/gitlab-org/gitlab> | Group→project roles + protected branches/approvals |
| 7 | Issues | Plane | <https://github.com/makeplane/plane> | Issue model + typed properties + issue↔PR links |
| 8 | Wiki | Gitea | <https://github.com/go-gitea/gitea> | Wiki-as-git-repo (free versioning/rollback) |
| 9 | PR Review | GitLab | <https://gitlab.com/gitlab-org/gitlab> | MR discussions + suggested changes + approval rules |
| 10 | Actions compat | nektos/act | <https://github.com/nektos/act> | Expression grammar + `needs` DAG + matrix + checkout |
| 11 | Jobs | BullMQ / Inngest | <https://github.com/taskforcesh/bullmq> / <https://github.com/inngest/inngest> | Queue-vs-durable-execution pattern |
| 11 | Feature flags | GrowthBook | <https://github.com/growthbook/growthbook> | Flags + experiments + paywalls in one |

---

## 14. Consolidated library / version matrix

> "verify minor" = major is the floor as of 2026-11-03; pin the exact minor at ticket
> time. The two entries marked **verified** were checked against the npm registry on
> this date.

| Subsystem | Library | Version | Status |
|---|---|---|---|
| 1 Auth | `better-auth` | **1.7.15** | **verified 2026-11-03** |
| 1 Auth | `@better-auth/passkey` | 1.7.15 (package track) | verified |
| 1 Auth | `lucia` | 3.2.2 | **DEPRECATED — do not use** |
| 1 Auth | `jose` | 6.2.3 | transitive |
| 2 Storage | `simple-git` | 3.x | verify minor |
| 2 Storage | `git-lfs` | 3.x | verify minor |
| 2 Storage | `@aws-sdk/client-s3` | 3.x | verify minor |
| 3 Webhooks | `bullmq` | 5.x | verify minor |
| 3 Webhooks | `smee-client` | 2.x | verify minor |
| 4 Runners | `dockerode` | 4.x | verify minor |
| 4 Runners | `@kubernetes/client-node` | 1.x | verify minor |
| 5 Billing | `stripe` (stripe-node) | 18.x | verify minor |
| 6 Perms | `cerbos` | 0.4x | verify minor |
| 6 Perms | `casbin` (+pg adapter) | 2.x | embedded alt |
| 7 Issues | `drizzle-orm` | 0.4x | verify minor |
| 7 Issues | `@octokit/rest` | 20.x | verify minor |
| 8 Wiki | `remark` / `unified` | 15 / 11 | verify minor |
| 8 Wiki | `rehype-sanitize` | 6.x | verify minor |
| 8 Wiki | `meilisearch` | 1.12 | verify minor |
| 9 PR | `diff` (jsdiff) | 8.x | verify minor |
| 9 PR | `diff2html` | 3.4.x | verify minor |
| 10 Actions | `yaml` (eemeli) | 2.6 | verify minor |
| 10 Actions | `nektos/act` (port) | 0.2.x | verify minor |
| 11 Jobs | `bullmq` (default) | 5.x | verify minor |
| 11 Jobs | `inngest` (serverless) | 1.x | verify minor |
| 11 Jobs | `pgmq` (no-Redis) | 1.x | verify minor |
| 11 Email | `nodemailer` | 7.x | verify minor |
| 11 Email | `maddy` / `listmonk` | — | self-host SMTP / broadcast |
| 11 Obs | `@opentelemetry/sdk-node` | — | verify minor |
| 11 Obs | `pino` | 9.x | verify minor |
| 11 Obs | `@sentry/node` | 9.x | verify minor |
| 11 Flags | `growthbook` | 1.x | verify minor |
| 11 Rate | `upstash/ratelimit` | 2.x | verify minor |
| 0 Platform | `hono` | 4.x | verify minor |
| 0 Platform | `drizzle-orm` + `postgres 16` + `redis 7` | — | base runtime |

---

## 15. 2024–2026 community shifts we are riding (and what we rejected)

1. **Auth: Lucia → better-auth.** `lucia@3.2.2` carries an active npm deprecation
   notice ("This package has been deprecated… see lucia-auth.com/lucia-v3/migrate").
   The TypeScript community consolidated around **better-auth 1.7.15** — the "most
   comprehensive authentication framework for TypeScript," with a plugin surface that
   covers 2FA, passkeys, organizations, and device-flow in one package. **We adopt
   better-auth; Lucia is explicitly rejected** (deprecated, smaller ecosystem, no
   first-class passkey/org plugins).
2. **Jobs: BullMQ vs Inngest (and pgmq's rise).** The 2024–26 debate is "queue you
   operate" (BullMQ/Redis) vs "durable execution you rent/self-host" (Inngest), with
   Postgres-native **pgmq**/**pg-boss** as the "one less service" third option. We
   default to BullMQ (Redis already present) and keep the job API thin so Inngest or
   pgmq is a swap, not a rewrite.
3. **Observability: OpenTelemetry won.** Vendor-specific tracing agents are being
   replaced by OTel (switchable backends) + structured JSON logs (Pino). Free-text
   logs are no longer acceptable for anything queryable.
4. **Permissions: policy-as-data.** Hand-rolled RBAC is giving way to external
   decision services (Cerbos/OPA) so rulesets are versioned, testable, and auditable —
   exactly what branch rulesets (§6) demand.
5. **Wiki: git-backed, not DB-backed.** The Gitea pattern (wiki = git repo) is the
   accepted "free versioning" answer; DB-backed wikis that build a custom revision
   store are now seen as reinventing git.
6. **Deliverability: authentication bar rose.** DKIM/DMARC + `List-Unsubscribe` are
   effectively mandatory for bulk; "nodemailer to localhost" silently fails in prod, so
   a real relay (v1) or Maddy (self-host) is required.
7. **Flags + experiments converge.** GrowthBook's flags+experiments+paywalls-in-one
   beats flag-only tools, and it composes with our billing (§5).

---

## 16. Open decisions (need a human, not an agent)

- **Language of the git data plane:** stay all-TypeScript (shell to `git`) or accept a
  small Go sidecar for `http-backend`/`receive-pack`? Affects §2 and §4.
- **Policy engine:** Cerbos sidecar (recommended) vs embedded casbin — a deploy-topology
  call for self-host customers.
- **Job runtime default:** confirm BullMQ for the managed profile; decide whether the
  self-host profile ships pgmq instead of requiring Redis.
- **Actions parity tier for v1 GA:** publish the exact expression/action matrix we
  guarantee (§10.5) before marketing "GitHub Actions compatible."

---

## 17. Data models (key tables, Postgres)

Compact column sketches — the authoritative schema is Drizzle migrations, but these are
the load-bearing shapes. **Rule: object/blob bytes never live in Postgres; Postgres
stores references.**

### 17.1 Auth (§1)

```
users            (id, email, name, password_hash, totp_secret, totp_verified, created_at)
sessions         (token, user_id, expires_at, ip, ua)
passkeys         (user_id, credential_id, public_key, counter, transports)
ssh_keys         (user_id, title, fingerprint, public_key, last_used)
oauth_accounts   (provider, provider_user_id, user_id)
verification     (id, value, identifier, expires_at)   -- magic-link / OTP / 2FA challenge
```

### 17.2 Repository Storage (§2)

```
repos            (id, org_id, name, default_branch, head_sha, storage_path, visibility, created_at)
repo_refs        (repo_id, name, sha)                  -- head cache; source of truth is git
lfs_objects      (oid, byte_size, repo_id, s3_key)      -- oid = SHA-256, NEVER ETag
snapshots        (repo_id, sha, taken_at, s3_prefix)    -- backup pointer
```

### 17.3 Webhooks (§3)

```
hook_events      (id, type, repo_id, actor, payload, occurred_at)   -- stable id, signed
hook_endpoints   (id, repo_id, url, secret, active, events[], created_by)
hook_deliveries  (id, endpoint_id, event_id, attempt, status, resp_code, latency_ms, body_snippet, delivered_at)
```

### 17.4 CI Runners (§4)

```
runner_pools     (id, name, capacity, region, status)
ci_jobs          (id, repo_id, workflow, ref, pool_id, status, claimed_by, settled_at, log_ref)
ci_steps         (job_id, idx, name, status, started_at, ended_at)
secrets          (scope, scope_id, name, key_id, ciphertext, created_by)   -- envelope-encrypted
```

### 17.5 Billing & Metered Plans (§5)

```
plans            (id, name, price, limits_runner_s, limits_storage_gb, limits_lfs_gb)
org_plans        (org_id, plan_id, stripe_sub_id, current_period_end)
usage_events     (org_id, meter, qty, period, ref_id, settled, created_at)  -- unique(ref_id, meter)
stripe_event_log (event_id, type, processed_at)   -- dedupe store
```

### 17.6 Organization Permissions (§6)

```
orgs             (id, name, slug)
teams            (id, org_id, parent_id, name)        -- parent_id NULL in v1 (no nesting)
org_members      (org_id, user_id, role)              -- role ∈ owner/admin/write/read
team_members     (team_id, user_id)
repo_access      (repo_id, principal_type, principal_id, role)   -- per-resource override
rulesets         (id, repo_id, scope, config_json, enforcement)
```

### 17.7 Issue Tracker (§7)

```
issues           (id, repo_id, number, title, body, state, assignee_id, milestone_id, created_by)
labels           (id, repo_id, name, color)
issue_labels     (issue_id, label_id)
milestones       (id, repo_id, title, due_date, state)
issue_dependencies(from_id, to_id, type)              -- type ∈ blocks/blocked_by
field_defs       (id, repo_id, name, type, options_json)
issue_field_values(issue_id, field_def_id, value)     -- EAV; GIN index on (field_def_id, value)
```

### 17.8 Wiki (§8)

```
wikis            (id, repo_id, visibility)            -- page bodies are git files in §2
page_meta        (slug, wiki_id, blob_ref, etag, updated_by)   -- etag = concurrency token
```

### 17.9 Pull Request Review (§9)

```
pull_requests    (id, repo_id, number, head_ref, base_ref, merge_base, state, author_id)
review_threads   (pr_id, anchor_json, state, author_id)   -- anchor = {file, side, line, hash}
review_comments  (thread_id, body, suggested_patch, applied, created_by)
check_suites     (id, pr_id, app, status)
check_runs       (id, suite_id, name, status, conclusion, details_url)
```

### 17.10 GitHub Actions Compatibility (§10)

```
workflows        (id, repo_id, path, name, content_hash)   -- parsed cache
job_instances    (id, workflow_id, run_id, matrix_json, needs_json, status)
action_cache     (action_ref, digest, type, cached_at)     -- fetched actions/*
```

---

## 18. API surface (endpoints per subsystem)

REST, JSON, behind the §1 session guard + §11.6 rate limiter unless noted.

| Subsystem | Endpoints |
|---|---|
| 1 Auth | `POST /auth/sign-in/email` · `POST /auth/sign-in/social` · `POST /auth/sign-out` · `POST /auth/two-factor/verify` · `POST /auth/passkey/{register,verify-authentication}` · `GET/DELETE /auth/sessions` |
| 2 Repo | `GET/POST /repos/:org/:name` · `GET /:org/:name.git/info/refs` · `POST /:org/:name.git/{git-upload-pack,git-receive-pack}` · `POST /:org/:name.git/info/lfs/objects/batch` |
| 3 Webhooks | `GET/POST /repos/:id/webhooks` · `PUT/DELETE /repos/:id/webhooks/:hid` · `POST /webhooks/:hid/test` (redeliver) |
| 4 Runners | `POST /runner/claim` (device-auth) · `POST /runner/jobs/:id/log` · `GET /runner/pools` · `POST /orgs/:id/secrets` |
| 5 Billing | `GET /orgs/:id/billing` · `POST /billing/checkout` · `POST /billing/portal` · `GET /orgs/:id/usage` · `POST /webhooks/stripe` (signed) |
| 6 Perms | `GET/PUT /orgs/:id/members` · `GET/PUT /orgs/:id/teams` · `GET/PUT /repos/:id/rulesets` · `POST /policy/check` (internal) |
| 7 Issues | `GET/POST /repos/:id/issues` · `GET/PUT /repos/:id/issues/:n` · `GET/POST /repos/:id/{labels,milestones}` · `POST /repos/:id/issues/:n/dependencies` · `POST /repos/:id/import/github` |
| 8 Wiki | `GET/PUT /repos/:id/wiki/:slug` (`If-Match`) · `GET /repos/:id/wiki/:slug/history` · `POST /repos/:id/wiki/:slug/revert` |
| 9 PR | `GET /repos/:id/pulls/:n` · `GET /repos/:id/pulls/:n/diff` · `POST /repos/:id/pulls/:n/reviews` · `POST /repos/:id/pulls/:n/merge` · `GET /repos/:id/check-runs` |
| 10 Actions | `GET /repos/:id/actions/workflows` · `POST /repos/:id/actions/workflows/:id/dispatches` · `GET /actions/runs/:rid` · `GET /actions/runs/:rid/logs` |

---

## 19. Load-bearing tests (one per subsystem)

Each test encodes the *intent* behind that subsystem's gotcha — a test that can't fail
when the bug appears is a wrong test. These are the acceptance criteria that gate GA.

1. **Auth:** a 2FA-enabled user who signs in **via passkey** (and via OAuth) is *denied*
   a session until the 2FA challenge passes. Assert the extra after-hook fires on
   `/passkey/verify-authentication` and `/callback/:id` — this is the test that catches
   the §1.6 bypass if someone "simplifies" the matcher.
2. **Storage:** kill the process mid LFS upload → the repo must still pass `git fsck`,
   and a re-fetched LFS object must re-hash to its **OID** (not the S3 ETag). Assert no
   orphan `.pack` without its `.idx`.
3. **Webhooks:** a delivery that gets a 5xx then a 200 is delivered, and a replayed
   event is idempotent. Assert the **stable event_id** (not delivery_id) is in the
   HMAC input, so receivers can dedupe.
4. **Runners:** two runners claim one job concurrently → **exactly one** wins
   (`SKIP LOCKED`); and a job's container cannot egress to a non-allowlisted host
   (assert the network policy drops it).
5. **Billing:** a job that fails then retries 3× meters **1×** (settled), and a replayed
   `invoice.payment_failed` webhook does **not** re-trigger dunning (assert on
   `stripe_event_log` dedupe).
6. **Perms:** a direct `git push` to a protected branch is rejected **pre-receive**
   (not just in the UI); and (if team nesting is ever enabled) a nested team cannot
   escalate a member above the parent's role.
7. **Issues:** filtering by a custom field produces an **index scan** (`EXPLAIN`), not a
   sequential scan over the EAV table; and a GitHub import rewrites `#123` to the new
   OpenForge id (assert no dead `#` links remain).
8. **Wiki:** two concurrent saves to one page → one `200`, one `409` (via `If-Match`);
   and a page body containing `<script>` renders **inert** (sanitizer pass asserted).
9. **PR:** after a push, a review comment **re-anchors** to the same hunk (content-hash
   match); and a PR with a *required-but-pending* check run is **not** mergeable.
10. **Actions:** `if: ${{ always() }}` runs a step **after** a prior step failed;
    `hashFiles(...)` reflects **working-tree** content; and a malformed `fromJSON`
    value does **not** alter control flow.

---

## 20. Non-functional targets (SLOs, v1)

| Subsystem | Target |
|---|---|
| Auth sign-in | p99 < 300 ms (password); < 800 ms (OAuth round-trip) |
| Git clone/fetch | p95 < 5 s for a 10 MB repo |
| Push (pre-receive + ruleset) | p95 < 1 s |
| Webhook first attempt | dispatched < 1 s after event |
| Job claim | p99 < 250 ms (no double-claim) |
| PR merge gate | p95 < 400 ms (policy + check aggregation) |
| Wiki/Issue search | p95 < 150 ms |
| Rate-limit check | < 5 ms on the hot path |
| Audit write | < 10 ms, never blocks the request (async) |
| Availability | 99.5% control plane; storage durability ≥ 99.9999% (S3) |

---

## 21. Critical flows (sequence)

### 21.1 Push → ruleset gate → storage → webhook

```
client        api/guard       storage(pre-receive)    policy(Cerbos)      event-bus      webhook-queue
  |  push         |                     |                     |                |                 |
  |-------------->|  authn (§1)         |                     |                |                 |
  |               |------------------->|  git-receive-pack    |                |                 |
  |               |                     |  ruleset? ---------->|  Check()       |                 |
  |               |                     |<--------------------|  {denied}      |                 |
  |<-- 403 ------|<--------------------|  (protected branch)  |                |                 |
  |               |                     |  (allowed) commit    |                |                 |
  |               |                     |-------------------> |                |                 |
  |<-- 200 ------|<--------------------|                     |  emit event ---|--> enqueue       |
  |               |                     |                     |                |        deliver   |
```

### 21.2 PR merge → gate → diff → commit → event

```
user        api/merge       policy(Cerbos)     check-runs       git(§2)         event-bus
  |  merge      |                  |                |                |                 |
  |----------->|  who may merge? ->|  Check()       |                |                 |
  |            |<-----------------|  {allowed}      |                |                 |
  |            |  required checks green? ---------->|  suite status   |                 |
  |            |<-----------------|  {all success}  |                |                 |
  |            |  three-way diff vs merge_base ------------------>|  git diff        |
  |            |  create merge commit -------------------------------------------------->|
  |            |                                            emit PR.merged ------------>|
  |<-- 200 ---|                                                                     fan-out
```

---

*End of document. Each `OF-*` ticket above is an engineering epic; each Core bullet is
a user story; each "gotcha" is a load-bearing acceptance criterion.*
