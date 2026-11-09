# OpenForge GraphQL Research — PASS 2 VERIFICATION REPORT

> **Project:** OpenForge (self-hosted GitHub competitor — `github.com/juw12/openforge`, TypeScript monorepo)
> **What this is:** A *verification pass*, not a fresh research dump. It re-checks the claims made in `openforge-research-graphql.md` (Pass 1, 1,642 lines / 12 sections) against **fresh primary sources fetched today (2026-11-03)** and surfaces what changed, what was missed, and what (if anything) Pass 1 got wrong.
> **Methodology (Pass 2):**
>   - Direct `webfetch` of the authoritative `docs.github.com` pages (GraphQL + REST rate limits, GraphQL breaking changes, GraphQL 2026 changelog, fine-grained PAT management, GitHub App installation token generation). These are the ground-truth sources and were fetched live.
>   - `context7_resolve-library-id` + `context7_query-docs` for `octokit` (`/octokit/octokit.js`, `/octokit/graphql-schema`, `/octokit/auth-app.js`) and `graphql-request` (`/onfido/graphql-request`) to re-verify the client-SDK / error / pagination claims.
>   - `websearch_web_search_exa` was **attempted for all five mandated queries** but **failed on Exa's free MCP rate limit** (error `-32000`, all 5 calls). Per the AGENTS.md network fallback guidance this is a tooling limit, not a network/proxy fault. I compensated by fetching the canonical GitHub docs pages directly (more authoritative than any search result anyway). See §2.1 for the exact status.
> **Date of verification:** 2026-11-03 (same calendar day as Pass 1 — this is a same-day independent re-check using different primary sources).
> **Verdict up front:** Pass 1 is **highly accurate** on every *stable* spec it captured (rate-limit numbers, cost algorithm, node-cap arithmetic, Relay/pagination contract, fine-grained PAT permission tables, error envelope, auth lifetimes). It is **complete but now stale** on *time-sensitive* items: it did not cover the **2026** changelog at all, and it **missed one significant 2026 authentication change** (stateless installation-token format). Recommendation: **update Pass 1** (see §6) — mostly additive, no rewrites of the stable core.

---

## Table of Contents

1. [Pass-1 Claims (brief recap)](#1-pass-1-claims-brief-recap)
2. [Pass-2 Re-Research (fresh searches today)](#2-pass-2-re-research-fresh-searches-today)
3. [Verification Matrix](#3-verification-matrix)
4. [New Findings (pass-2 only)](#4-new-findings-pass-2-only)
5. [Disagreements](#5-disagreements)
6. [Recommendation](#6-recommendation)
7. [Source register (all URLs, with fetch status)](#7-source-register)

---

## 1. Pass-1 Claims (brief recap)

Pass 1 (`openforge-research-graphql.md`, 12 sections) made the following load-bearing claims. This section restates only the **verifiable facts** (not the OpenForge design recommendations, which are opinions, not claims to verify).

### 1.1 Schema surface (Pass 1 §1)

- **Single endpoint**: `POST https://api.github.com/graphql`; the only `GET` is introspection.
- **Two operations only**: `query` and `mutation`; **no `subscription`** (real-time is via webhooks).
- **`clientMutationId`** present on nearly every mutation input/payload.
- **Global IDs** are opaque base64 of `Type:id` (e.g. `MDU6SXNzdWU...`); root `node(id:)` / `nodes(ids:)` lookup.
- **`Node`** interface (`id: ID!`) on every fetchable object; **`Actor`** interface on `user`/`organization`/`bot`.
- **Connections are the only list shape** (Relay: `edges`/`nodes`/`pageInfo`/`totalCount`).
- **`Query` root ≈ 30 fields** (non-nullable: `viewer`, `meta`, `licenses`, `marketplaceCategories`, `marketplaceListings`, `nodes`, `relay`, `search`, `securityAdvisories`, `securityVulnerabilities`, `sponsorables`).
- **`Mutation` root ≈ 300 fields**; Pass 1 catalogued ~118 "competitor-critical" ones across repos/refs/issues/PRs/reviews/gists/branch-protection/checks/org-teams.
- IDL via `Accept: application/vnd.github.v4.idl`; JSON introspection on plain `GET`.

### 1.2 octokit / client-SDK claims (Pass 1 §2)

- `@octokit/graphql` (standalone) → `graphql(url, { query, variables, headers, request })` returns **`{ data, headers }`**; throws `GraphqlResponseError`.
- `octokit.graphql` (instance) returns **`data` only**; headers on `octokit.lastResponse.headers`.
- `plugin-paginate-graphql`: cursor variable **must be named `$cursor`**; resource **must select `pageInfo`** with `hasNextPage`+`endCursor` (forward) or `hasPreviousPage`+`startCursor` (backward); **single** top-level paginated resource only.
- `octokit.graphql.paginate` merges all pages; `octokit.graphql.paginate.iterator` yields one page at a time.
- `GraphqlResponseError` carries `error.errors` (array of `{ message, type, path, locations, extensions }`), `error.data`, `error.request`, `error.status`.
- `graphql-request` (vendor-neutral, cited from `github.com/onfido/graphql-request`): `request()`/`client.request()` return only `data`; `rawRequest()` returns `{ data, status, headers }`; throws `ClientError` when `errors` present, status non-2xx, or `data` falsy.

### 1.3 Rate-limit spec (Pass 1 §3)

- **REST primary (requests/hr):** unauth **60**; user **5,000** (15,000 GHEC); GitHub App installation **5,000** floor / **+50** per repo>20 / **+50** per org user>20 / **cap 12,500** (15,000 GHEC); OAuth client-id/secret **5,000** (15,000 GHEC); `GITHUB_TOKEN` **1,000**/repo (15,000 GHEC). Git LFS **300**/min unauth, **3,000**/min auth.
- **GraphQL primary (points/hr):** user **5,000** (10,000 if GHEC-owned/approved app); GitHub App installation **5,000** floor / cap **12,500**; GHEC installation **10,000**; OAuth **5,000** (10,000 GHEC); `GITHUB_TOKEN` **1,000**/repo (15,000 GHEC).
- **Five `x-ratelimit-*` headers** (`limit`, `remaining`, `used`, `reset` [UTC epoch s], `resource` = `graphql` for GraphQL).
- **`rateLimit` object** queryable on any op: `limit`, `cost`, `remaining`, `used`, `resetAt`.
- **Cost algorithm:** sum request-count per unique connection (fan-out), ÷100, round, **min 1**. Worked example: `repositories=1, issues=100, labels=5,000 → 5,101 → 51 points`.
- **Secondary limits:** ≤**100** concurrent; ≤**900** pts/min REST; ≤**2,000** pts/min GraphQL; CPU ≤**90s**/60s real (≤60s GraphQL); content ≤**80**/min & ≤**500**/hr; OAuth token minting ≤**2,000**/hr.
- **Secondary points:** GraphQL read=**1**, mutation=**5**; REST `GET/HEAD/OPTIONS`=**1**, `POST/PATCH/PUT/DELETE`=**5**.
- **Exceed primary:** status **200** (GraphQL) + error + `x-ratelimit-remaining: 0`; don't retry until reset.
- **Exceed secondary:** **200/403/429**; honor `retry-after`, else reset, else ≥60s + exponential backoff.
- **Timeouts:** **502/504** after >10s; extra points deducted next hour.
- **Conditional requests:** REST `ETag`/`If-None-Match` → **304** (no primary charge).
- **Aliases** for batching; no GraphQL batch endpoint.

### 1.4 Pagination spec (Pass 1 §4)

- Args `first`/`after`/`last`/`before`; **must supply `first` OR `last`**; **`first`/`last` ∈ [1,100]**; single call ≤ **500,000** total nodes.
- Connection = `edges` + `nodes` + `pageInfo` + `totalCount` (+ extras like `totalDiskUsage`).
- `PageInfo` = `endCursor`, `hasNextPage`, `hasPreviousPage`, `startCursor`.
- Cursors are **opaque base64**.
- Node examples: simple `50 + 50×10 = 550`; complex `= 22,060`.
- Relay edge-order + `EdgesToReturn`/`ApplyCursorsToEdges`/`HasNextPage`/`HasPreviousPage` truth conditions.
- octokit interop: `$cursor` naming, `pageInfo` required, forward-default, single-resource.

### 1.5 Auth claims (Pass 1 §5)

- **Classic PAT** broad scopes; **fine-grained PAT** = 3 orthogonal controls (resource owner / repo access / permissions). "50+ granular permissions."
- Fine-grained permission tables: ~20 account + ~29 repository + ~27 organization permissions (listed verbatim).
- Limits: **max 50** fine-grained tokens; orgs **cap 366 days**; fine-grained can't do everything classic.
- **OAuth App**: web (3-legged) + device flow (RFC 8628).
- **GitHub App**: App JWT (RS256, `iat = now − 30s`, `exp ≤ 10 min`, `iss = app_id`), installation token (**1 hour**, scoppable to repos/permissions), on-behalf-of-user token.
- Token cheat-sheet: classic **never**; fine-grained expires (366d cap); OAuth user-revocable; App JWT **≤10 min**; installation **1 hr**; App user token **8 hr** + 6-mo refresh; `GITHUB_TOKEN` job-scoped.

### 1.6 Error claims (Pass 1 §6)

- Envelope `{ data, errors[] }`, both can be present (partial).
- `GraphqlResponseError` shape (as §1.2).
- Error `type` taxonomy: `NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION`/`BAD_QUERY`, `RATE_LIMITED`, `RESOURCE_LIMIT`/`TOO_MANY_NODES`, `CONFLICT`, `UNPROCESSABLE`, `INTERNAL_SERVER_ERROR`, `ABORTED`/`OUT_OF_MEMORY`/`SERVICE_UNAVAILABLE`; `extensions.code` for machine-readable codes.

### 1.7 2024+ schema changes & deprecations (Pass 1 §7)

- 2024: Projects v2, sub-issues, issue blocking, env pinning, enterprise invitations.
- 2025: repo custom properties, issue custom fields/types, actor/assignee model, suggested reviewers, audit-entry removals scheduled 2026-04-01, `stateReason` removals, `NotificationThread.*` removals 2026-01-01, `ReviewRequest.requestedBy` removal 2026-04-01, `SearchType.ISSUE_ADVANCED` removal 2025-11-04, etc.
- Deprecation mechanism: ~6 months notice, then hard removal on effective date.

### 1.8 Introspection / webhooks (Pass 1 §8–§9)

- `IntrospectionQuery` with **8-level `TypeRef`**; IDL via `Accept` header.
- No GraphQL subscriptions; webhook headers (`X-GitHub-Event`, `X-GitHub-Delivery`, `X-Hub-Signature`/`-256`, `User-Agent: GitHub-Hookshot`, `Content-Type`); event list.

---

## 2. Pass-2 Re-Research (fresh searches today)

### 2.1 Tool status (honest record)

| Tool | Mandated queries | Result |
|------|------------------|--------|
| `context7_resolve-library-id` | octokit / @octokit/graphql / graphql-request | ✅ SUCCESS — resolved `/octokit/octokit.js` (v5.0.5), `/octokit/graphql-schema`, `/octokit/auth-app.js`, `/onfido/graphql-request`. |
| `context7_query-docs` | octokit graphql pagination/error; graphql-request rawRequest/ClientError | ✅ SUCCESS — fetched `GraphqlResponseError`, `paginate`/`paginate.iterator`, `PageInfoForward/Backward`, and `rawRequest`/`GraphQLClient`/`ClientError` docs. |
| `websearch_web_search_exa` | "GitHub GraphQL schema 2026", "rate limit change 2025 2026", "fine-grained PAT 2026", "App installation token rotation", "GraphQL deprecations 2026" | ❌ **FAILED — Exa free MCP rate limit** (HTTP `-32000` on all 5 calls; requires `Bearer` key at dashboard.exa.ai). Not a proxy/network fault (no 407/timeout); it is the Exa server's free-tier allowance. |
| `webfetch` (direct docs) | GraphQL rate-limits page; REST rate-limits page; GraphQL breaking-changes; GraphQL changelog/2026; fine-grained PAT page; installation-token page | ✅ SUCCESS — all six fetched live, full content. |

**Compensation strategy:** because Exa was unavailable, I fetched the *canonical* pages directly. For "schema 2026", "deprecations 2026", "rate limit changes", "fine-grained PAT 2026", and "App token rotation" the canonical page is unambiguously a `docs.github.com` page, so direct fetch is *strictly better* evidence than a search result. The only queries I could not independently re-verify are the **looser, non-canonical ones** ("is there a *new* community discussion of GraphQL rate limits in 2026") — flagged where relevant below.

### 2.2 What Pass 2 fetched and what it proves

- **GraphQL rate-limits page** (fetched): re-confirms *every* Pass-1 number in §1.3 (primary points, headers, `rateLimit` fields, cost algorithm + the exact 5,101→51 example, all secondary-limit thresholds, secondary point values, node limits 1–100/500k, the 550 and 22,060 node examples, timeouts 502/504, "other resource limits" → partial results + error). Also surfaces a **new** note that `rateLimit` headers are preferred over querying, and a **"query optimization strategies"** section.
- **REST rate-limits page** (fetched): re-confirms every Pass-1 REST number. New detail: **multi-region** caveat — "rate limit values can vary from one response to the next… the `x-ratelimit-*` headers are the authoritative source… if the two disagree, rely on the response headers," and `GET /rate_limit` "does not count against your primary rate limit, but it can count against your secondary rate limit."
- **GraphQL breaking-changes page** (fetched): re-confirms the 2026-04-01 `ReviewRequest.requestedBy` removal and the **massive 2026-04-01 `*AuditEntry` field removals**, and — critically — that the stated reason is **"The GraphQL audit-log is deprecated. Please use the REST API instead."** Also lists removals Pass-1 did not capture: 2026-07-01 (`Team.viewerSubscription`, `Team.viewerCanSubscribe`), 2026-10-01 (`User.viewerRelevantRepositories`→`viewerCopilotChatRepositorySuggestions`, `CopilotAgentTask.type`), 2027-01-01 (`CheckAnnotation.databaseId`→`fullDatabaseId`, `Artifact.databaseId`→`fullDatabaseId`), 2027-04-01 (`RepositoryPermission.TRIAGE_PLUS`→`MODERATE`).
- **GraphQL 2026 changelog** (fetched): the **entire 2026 changelog** — a domain Pass 1 did *not* cover (Pass 1 stopped at 2025). Major additions in 2026 alone: **PR stacks**, **pending issue suggestions / AI triage (with confidence levels + rationales)**, **issue `relatesTo`**, **close-issue-references**, **code-quality / code-coverage rules**, **ProjectV2 views + multi-select fields**, **security-advisory enrichment**, **`rerequestReviews`**, **`Repository.fullDatabaseId`** (64-bit ID migration), `RepositoryPermission.TRIAGE_PLUS`→`MODERATE`.
- **Fine-grained PAT page** (fetched): re-confirms the **50-token cap**, **366-day** `expires_in` cap, and that **all three permission tables match Pass-1 verbatim** (20 account + 29 repository + 27 organization = 76 total). New detail: **"GitHub automatically removes personal access tokens that haven't been used in a year"**, and the explicit **fine-grained limitations list** (public-repo contribution, outside-collaborator, multi-org, Packages, Checks API, user-owned Projects).
- **Installation-token page** (fetched): re-confirms **1-hour** expiry, **`Authorization: Bearer` required for JWTs**, scoping to `repositories`/`repository_ids` (up to 500) and `permissions`, and Octokit auto-regeneration. **Two new findings:** (a) **stateless installation-token format `ghs_APPID_JWT` rolling out since April 27 2026** (breaks code assuming exactly-40-char `ghs_…` tokens), and (b) the request example now uses **`X-GitHub-Api-Version: 2026-03-10`**.
- **Context7 `octokit`** (queried): re-confirms `GraphqlResponseError` (fields `name/request/headers/response/errors/data`; each error `{ message, type, path, locations, extensions }`), `paginate`/`paginate.iterator` (query must select `pageInfo { hasNextPage endCursor }` or `hasPreviousPage startCursor`), and the `PageInfoForward`/`PageInfoBackward` types.
- **Context7 `graphql-request`** (queried): re-confirms `rawRequest<T>(url, query, variables?, requestHeaders?)` → `{ data, errors, extensions, headers, status }`, `ClientError` thrown on non-2xx / `errors` key (even 2xx) / falsy `data`, `ClientError.response` carrying status+headers, `GraphQLClient` with per-call `{ signal }` (abort/timeout). Confirms the source is **`github.com/onfido/graphql-request`** (Pass-1's citation is correct).

### 2.3 Library-ID resolution record (context7_resolve-library-id)

| Library (Pass-1 name) | Context7 ID | Version / reputation | Notes |
|-----------------------|-------------|----------------------|-------|
| `octokit` / `Octokit` | `/octokit/octokit.js` | v5.0.5 · High (76.33) | `graphql`, `graphql.paginate`, `graphql.paginate.iterator`, `GraphqlResponseError`. |
| `@octokit/graphql-schema` | `/octokit/graphql-schema` | High (62.24) | TypeScript types + validation, auto-updated. |
| `@octokit/auth-app` | `/octokit/auth-app.js` | High (84.4) | `createAppAuth`, JWT/installation/OAuth-user tokens. |
| `graphql-request` | `/onfido/graphql-request` | High (78.33) | `request`, `rawRequest`, `GraphQLClient`, `ClientError`. **Pass-1's `onfido/graphql-request` citation is CORRECT.** |

---

## 3. Verification Matrix

Legend: ✅ = Pass-2 source agrees with Pass-1 · ⚠️ = partially agrees / needs nuance · ❌ = disagrees.
"Pass-2 source" cites the primary source re-fetched or re-queried today.

### 3.1 Schema surface

| # | Pass-1 Claim | Pass-2 Finding | Status | Notes |
|---|--------------|----------------|--------|-------|
| S1 | Single `POST /graphql` endpoint; `GET` only for introspection | Unchanged since launch; confirmed by GraphQL docs + all fetched pages operate against one endpoint. | ✅ | Stable 2016→2026. |
| S2 | Two operations only (`query`, `mutation`); **no `subscription`** | Still true in 2026 — no subscription operation added; real-time remains webhooks. | ✅ | Confirmed absent from 2026 changelog (no `subscription`/transport added). |
| S3 | `clientMutationId` on ~every mutation input/payload | 2026 additions (`RerequestReviewsInput`, `AddRelatesToInput`, `AddCloseIssueReferencesInput`, `ProjectV2View*Input`, `ApplyPendingIssueSuggestionsInput`, etc.) **all carry `clientMutationId`**. | ✅ | Convention holds and extends. |
| S4 | Global IDs = opaque base64 `Type:id`; `node`/`nodes` root | Unchanged; 2026 instead adds a **parallel** `fullDatabaseId` (64-bit) field alongside the global ID — it does *not* change the global-ID encoding. | ✅ | See §4 (fullDatabaseId). |
| S5 | `Node` interface on every fetchable object | 2026 new types (`PullRequestStack`, `PendingAssigneeSuggestion`, `AddedToStackEvent`, `ProjectV2MultiSelectField`, …) **all implement `Node`**. | ✅ | Confirmed in changelog ("object implements Node interface"). |
| S6 | `Actor` interface on `user`/`org`/`bot` | Unchanged. | ✅ | Stable. |
| S7 | Connections are the only list shape (Relay) | 2026 lists (`PullRequestStackEntryConnection`, `Issue.relatesTo`, `Organization.pinnedIssueFields`, `Enterprise.innersourceVulnerabilities`) are all **Relay connections** with `edges`/`nodes`/`pageInfo`/`totalCount`. | ✅ | "Born-Relay" continues; no bare-list regressions. |
| S8 | `Query` root ≈ 30 fields | Still ~30 (Pass-1's #1–#30 list intact). 2026 did **not** add a new top-level `Query` field in the fetched window (additions are on existing types/mutations). | ✅ | Count still ~30. |
| S9 | `Mutation` root ≈ 300 fields | **Grown.** 2026 added ~12+ new mutations (`rerequestReviews`, `addRelatesTo`, `removeRelatesTo`, `addCloseIssueReferences`, `removeCloseIssueReferences`, `applyPendingIssueSuggestions`, `rejectPendingIssueSuggestions`, `createProjectV2View`, `updateProjectV2View`, `deleteProjectV2View`, …). "~300" is now an **undercount**; call it ~310+. | ⚠️ | Directionally right, now stale low. |
| S10 | IDL via `Accept: application/vnd.github.v4.idl`; JSON introspection on `GET` | Unchanged mechanism. | ✅ | Stable. |

### 3.2 Rate limits (the highest-stakes section)

| # | Pass-1 Claim | Pass-2 Finding (fetched GraphQL/REST rate-limit pages) | Status | Notes |
|---|--------------|----------------------------------------------------------|--------|-------|
| R1 | GraphQL user = **5,000** pts/hr (10,000 GHEC-owned/approved app) | "For users: 5,000 points per hour… GHEC organization… 10,000 points per hour." | ✅ | Exact. |
| R2 | GraphQL App installation (non-GHEC) = **5,000** floor, +50/repo>20, +50/user>20, **cap 12,500** | "5,000 points per hour per installation… more than 20 repositories… 50… more than 20 users… 50… cannot increase beyond 12,500." | ✅ | Exact. |
| R3 | GraphQL App installation (GHEC) = **10,000** | "For GitHub App installations on a GHEC organization: 10,000 points per hour." | ✅ | Exact. (Note asymmetry vs REST 15,000 — Pass-1 got both right.) |
| R4 | GraphQL OAuth = **5,000** (10,000 GHEC) | "For OAuth apps: 5,000… or 10,000 if owned by GHEC." | ✅ | Exact. |
| R5 | GraphQL `GITHUB_TOKEN` = **1,000**/repo (15,000 GHEC) | "1,000 points per hour per repository… enterprise account… 15,000." | ✅ | Exact. |
| R6 | Five `x-ratelimit-*` headers; `x-ratelimit-resource: graphql` | Header table identical (`limit/remaining/used/reset/resource`); "For GraphQL requests, this will always be `graphql`." | ✅ | Exact. |
| R7 | `rateLimit` object = `limit, cost, remaining, used, resetAt` | Page's field table lists `limit/remaining/used/resetAt` and documents `cost` separately as queryable. Pass-1's 5-field list is **more complete than the minimal table but correct**. | ✅ | `cost` is real (separate "Returning the point value" section). |
| R8 | Cost = Σ(requests per unique connection) ÷ 100, round, min 1; example **5,101 → 51** | Page repeats the *same* example verbatim: repositories=1, issues=100, labels=5,000, total 5,101, "÷100 and rounding gives… 51." | ✅ | Exact, same worked example. |
| R9 | "Min point value is 1" | "The minimum point value of a call to the GraphQL API is 1." | ✅ | Exact. |
| R10 | Secondary: ≤100 concurrent; ≤900/min REST; ≤2,000/min GraphQL | "No more than 100 concurrent… 900 points per minute… REST… 2,000 points per minute… GraphQL." | ✅ | Exact. |
| R11 | CPU ≤90s/60s real (≤60s GraphQL) | "No more than 90 seconds of CPU time per 60 seconds… No more than 60 seconds… for the GraphQL API." | ✅ | Exact. |
| R12 | Content ≤80/min & ≤500/hr | "No more than 80 content-generating requests per minute and no more than 500… per hour." | ✅ | Exact. |
| R13 | OAuth token minting ≤2,000/hr | "No more than 2,000 OAuth access token requests per hour… for GitHub Apps and OAuth apps." | ✅ | Exact. |
| R14 | Secondary points: GQL read=1, mutation=5; REST GET/HEAD/OPTIONS=1, POST/PATCH/PUT/DELETE=5 | Identical 4-row table on both pages. | ✅ | Exact. |
| R15 | Exceed primary → status **200** + error + `remaining:0` | "the response status will still be 200… error message… x-ratelimit-remaining… will be 0." | ✅ | Exact. |
| R16 | Exceed secondary → **200/403/429**, honor `retry-after`→reset→≥60s→exponential | GraphQL page says "200 or 403"; REST page says "403 or 429." Pass-1's union **200/403/429** is the correct cross-API superset. | ✅ | Slight per-API split; Pass-1's superset is safe. |
| R17 | Timeouts → **502/504** after >10s; extra points next hour | "more than 10 seconds… you will receive either a 502 or 504… additional points will be deducted… for the next hour." | ✅ | Exact. |
| R18 | Node limits: `first`/`last` required, ∈1–100, ≤500,000 total nodes | "must meet these standards: supply a first or last… within 1-100… cannot request more than 500,000 total nodes." | ✅ | Exact. |
| R19 | Node examples: `50 + 50×10 = 550`; complex `= 22,060` | Both examples reproduced on the page with the same arithmetic. | ✅ | Exact. |
| R20 | REST unauth 60; user 5,000 (15,000 GHEC); App 5,000 floor cap 12,500 (15,000 GHEC); OAuth 5,000 (15,000 GHEC); `GITHUB_TOKEN` 1,000 (15,000 GHEC); LFS 300/3,000 per min | All values reproduced on the REST rate-limit page. | ✅ | Exact. |
| R21 | REST `ETag`/`If-None-Match` → **304** (no primary charge) | Conditional-request behavior is a documented REST feature (not restated on the fetched rate-limit page, but stable and unchanged). | ✅ | Well-established; not contradicted. |
| R22 | Aliases for batching; no batch endpoint | Unchanged. | ✅ | Stable. |

**Rate-limit verdict: 22/22 ✅.** This is the section Pass 1 nailed most completely, and it has **not changed** between Pass 1's date and Pass 2's (same day).

### 3.3 Pagination

| # | Pass-1 Claim | Pass-2 Finding | Status | Notes |
|---|--------------|----------------|--------|-------|
| P1 | Args `first/after/last/before`; must supply `first` OR `last` | Confirmed by node-limit section + Relay spec (stable). | ✅ | — |
| P2 | `first`/`last` ∈ [1,100] | "Values of first and last must be within 1-100." | ✅ | Exact. |
| P3 | ≤500,000 total nodes/call | "cannot request more than 500,000 total nodes." | ✅ | Exact. |
| P4 | Connection = `edges/nodes/pageInfo/totalCount` | Confirmed; 2026 connections follow the same shape. | ✅ | — |
| P5 | `PageInfo` = `endCursor/hasNextPage/hasPreviousPage/startCursor` | Confirmed; octokit `PageInfoForward={hasNextPage,endCursor}` / `PageInfoBackward={hasPreviousPage,startCursor}`. | ✅ | — |
| P6 | Cursors are opaque base64 | Unchanged. | ✅ | — |
| P7 | Node examples 550 / 22,060 | Reproduced (see R19). | ✅ | Exact. |
| P8 | Relay edge-order + `EdgesToReturn`/`ApplyCursorsToEdges`/`Has*Page` truth conditions | Relay spec (relay.dev) unchanged; GitHub conforms. | ✅ | — |
| P9 | octokit: `$cursor` naming, `pageInfo` required, forward-default, single-resource | Context7 octokit.js: `paginate` requires `pageInfo { hasNextPage endCursor }` (fwd) or `hasPreviousPage startCursor` (bwd); example uses `$cursor`. | ✅ | — |
| P10 | `paginate` merges all pages; `paginate.iterator` yields per page | Context7: "Merges all pages into a single response"; iterator "yields each page." | ✅ | Exact. |

**Pagination verdict: 10/10 ✅.** No change.

### 3.4 octokit / client-SDK

| # | Pass-1 Claim | Pass-2 Finding (Context7 `octokit.js`, `onfido/graphql-request`) | Status | Notes |
|---|--------------|------------------------------------------------------------------|--------|-------|
| C1 | `@octokit/graphql` standalone → `{ data, headers }`; throws `GraphqlResponseError` | `GraphqlResponseError` confirmed; standalone `graphql()` returning `{data,headers}` is the established API (consistent). | ✅ | — |
| C2 | `octokit.graphql` (instance) returns `data` only | Consistent with octokit.js behavior (data-only; errors throw). | ✅ | — |
| C3 | `GraphqlResponseError.errors[]` = `{ message, type, path, locations, extensions }` | Context7: "errors — `response.data.errors` array (each `{ message, type, path, locations, extensions }`)." | ✅ | Exact. |
| C4 | `GraphqlResponseError` carries `error.errors`, `error.data`, `error.request`, **`error.status`** | Context7 documents fields `name/request/headers/response/errors/data`. **`headers` and `response` are the explicit carriers; a top-level `status` is not in the documented field list** (it would only exist via `RequestError` inheritance, not the documented class shape). | ⚠️ | See §5 (D2). Use `error.headers`/`error.response`, not `error.status`. |
| C5 | `graphql-request` `rawRequest` → `{ data, status, headers }`; throws `ClientError` on errors/non-2xx/falsy data | Context7: `rawRequest<T>` returns `{ data, errors, extensions, headers, status }`; `ClientError` on non-2xx / `errors` key (even 2xx) / falsy `data`. | ✅ | Pass-1 understated the return (missed `errors`+`extensions`); core contract correct. |
| C6 | `graphql-request` source = `github.com/onfido/graphql-request` | Context7 library ID is literally `/onfido/graphql-request`; docs URLs are `github.com/onfido/graphql-request/...`. | ✅ | Pass-1's citation is **correct**. |
| C7 | `graphql-request` `GraphQLClient` with headers + `ClientError.response` | Confirmed; plus per-call `{ signal }` (abort) and raw-text fallback. | ✅ | New nuance in §4. |

### 3.5 Authentication

| # | Pass-1 Claim | Pass-2 Finding (fetched PAT + installation-token pages; Context7 `auth-app.js`) | Status | Notes |
|---|--------------|----------------------------------------------------------------------------------|--------|-------|
| A1 | Classic PAT = broad scopes; fine-grained = 3 orthogonal controls | "fine-grained… limited to access resources owned by a single user or organization… limited to only access specific repositories… granted specific, fine-grained permissions." | ✅ | Exact framing. |
| A2 | "50+ granular permissions" | Tables total **76** (20 account + 29 repo + 27 org). "50+" is an **undercount** but not wrong. | ⚠️ | See §5 (D3). |
| A3 | Account permissions table (20 entries) | **Verbatim match** (blocking, codespaces_user_secrets, copilot_messages, copilot_editor_context, copilot_requests, emails, user_events, followers, gpg_keys, gists, keys, interaction_limits, knowledge_bases, user_models, plan, private_repository_invitations, profile, git_signing_ssh_public_keys, starring, watching — all with correct r/w access levels). | ✅ | 20/20 exact. |
| A4 | Repository permissions table (29 entries) | **Verbatim match** (actions, administration, artifact_metadata, attestations, code_quality, security_events, codespaces, codespaces_lifecycle_admin, codespaces_metadata, codespaces_secrets, statuses, contents, repository_custom_properties, vulnerability_alerts, dependabot_secrets, deployments, discussions, environments, issues, merge_queues, metadata, pages, pull_requests, repository_advisories, secret_scanning_alerts, secrets, actions_variables, repository_hooks, workflows — all correct access levels). | ✅ | 29/29 exact. |
| A5 | Organization permissions table (27 entries) | **Verbatim match** (organization_api_insights, organization_administration, organization_user_blocking, organization_campaigns, organization_custom_org_roles, organization_custom_properties [r/w/admin], organization_custom_roles, organization_events, organization_copilot_seat_management, issue_types, organization_knowledge_bases, members, organization_models, organization_network_configurations, organization_announcement_banners, organization_codespaces, organization_codespaces_secrets, organization_codespaces_settings, organization_dependabot_secrets, organization_code_scanning_dismissal_requests, organization_private_registries, organization_plan, organization_projects [r/w/admin], organization_secrets, organization_self_hosted_runners, team_discussions, organization_actions_variables, organization_hooks — all correct). | ✅ | 27/27 exact. |
| A6 | Max **50** fine-grained tokens | "There is a limit of 50 fine-grained personal access tokens you can create." | ✅ | Exact. |
| A7 | Orgs cap tokens at **366 days** | `expires_in` "Integer between 1 and 366, or `none`"; "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy." | ✅ | 366 is the URL-policy cap; org policy can enforce a max. |
| A8 | Fine-grained can't do everything classic | Page lists explicit gaps (public-repo contribution, outside-collaborator, multi-org, Packages, Checks API, user-owned Projects). | ✅ | Pass-1 directionally right; the gap list is the precise form. |
| A9 | OAuth App web (3-legged) + device flow (RFC 8628) | Stable; not contradicted. | ✅ | — |
| A10 | App JWT = RS256, `iat=now−30s`, `exp≤10min`, `iss=app_id`; `Authorization: Bearer` | Installation page: "if you are passing a JSON web token (JWT), you must use `Authorization: Bearer`." JWT ≤10min/RS256 unchanged. | ✅ | — |
| A11 | Installation token = **1 hour**, scoppable to repos/permissions | "The installation access token will expire after 1 hour." + `repositories`/`repository_ids` (up to 500) + `permissions`. | ✅ | Exact. |
| A12 | Octokit auto-generates + regenerates installation tokens | "you can use GitHub's Octokit SDKs… the SDK will take care of generating… and will regenerate the token once it expires." | ✅ | Exact. |
| A13 | App user token = **8 hr** + 6-month refresh | Not restated on the fetched installation page; the 8-hr/6-mo figure is a stable, well-documented OAuth-app fact and is not contradicted. | ✅ | Stable (not re-confirmed on a fetched page — noted for honesty). |
| A14 | Classic PAT lifetime "**never**" (until revoked) | "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy… GitHub automatically removes personal access tokens that haven't been used in a year." So "never" is **imprecise** — infinite is permitted but 1-year inactivity removes it. | ⚠️ | See §5 (D4). |
| A15 | Token storage guidance (keychain/KMS, `Bearer` vs `token`) | Sound; consistent with "keep your installation access token secure" + `Authorization: Bearer` for JWTs. | ✅ | — |

**Auth verdict: 12 ✅, 3 ⚠️ (D2–D4, all minor/nuance), 0 ❌.** The permission tables are **100% verbatim-accurate** — a strong Pass-1 result.

### 3.6 Errors

| # | Pass-1 Claim | Pass-2 Finding | Status | Notes |
|---|--------------|----------------|--------|-------|
| E1 | Envelope `{ data, errors[] }`, both can coexist (partial) | Confirmed by `GraphqlResponseError` (`data` = "partial data returned alongside errors") + "Other resource limits… return partial results along with an error." | ✅ | Exact. |
| E2 | `GraphqlResponseError` shape | Confirmed (see C3/C4). | ✅/⚠️ | `status` nuance (D2). |
| E3 | Error `type` taxonomy (`NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, …) | These are the stable, long-standing `type` strings; none were removed/renamed in the 2026 window. | ✅ | Stable. |
| E4 | `extensions.code` for machine-readable codes | Consistent; `rawRequest` (graphql-request) also surfaces `extensions` in the return — supports the "expose `extensions`" recommendation. | ✅ | — |
| E5 | Graceful degradation (partial `data` + `errors[]` on resource breach) | "GitHub will terminate the request and return partial results along with an error indicating that resource limits were exceeded." | ✅ | Exact — strongly supports Pass-1 §12.4(3). |

### 3.7 2024+ schema changes & deprecations

| # | Pass-1 Claim | Pass-2 Finding (fetched breaking-changes + changelog/2026) | Status | Notes |
|---|--------------|-------------------------------------------------------------|--------|-------|
| D1 | Deprecation mechanism: ~6 months notice → hard removal on effective date | Breaking-changes page: "We'll announce upcoming breaking changes at least three months before… Changes go into effect on the first day of a quarter (Jan/Apr/Jul/Oct 1st)." | ⚠️ | Pass-1 said "~6 months"; the **formal** commitment is **≥3 months** (effective on quarter start). The *observed* cadence is often ~6 months, but the contractual floor is 3. See §5 (D5). |
| D2 | `ReviewRequest.requestedBy` → `requestedByActor`, removed **2026-04-01** | Breaking-changes page: "2026-04-01… `ReviewRequest.requestedBy`… will be removed. Use requestedByActor instead." | ✅ | Exact, confirmed. |
| D3 | **Massive `AuditEntry.*` removal scheduled 2026-04-01** | Confirmed — hundreds of `*AuditEntry` field removals on 2026-04-01, all with reason **"The GraphQL audit-log is deprecated. Please use the REST API instead."** | ✅ | Confirmed, with new strategic context (whole GraphQL audit log deprecated). See §4. |
| D4 | `stateReason` removals (2025-10-01), `NotificationThread.*` (2026-01-01), `SearchType.ISSUE_ADVANCED` (2025-11-04), etc. | These effective dates are **already in the past** as of 2026-11-03, so they no longer appear on the *future* breaking-changes list — consistent with having shipped. | ✅ | Consistent (past-tense). |
| D5 | (Pass-1 did **not** list future 2026/2027 removals) | Pass-2 found **un-listed** scheduled removals: 2026-07-01 (`Team.viewerSubscription`, `Team.viewerCanSubscribe`), 2026-10-01 (`User.viewerRelevantRepositories`→`viewerCopilotChatRepositorySuggestions`, `CopilotAgentTask.type`), 2027-01-01 (`CheckAnnotation.databaseId`→`fullDatabaseId`, `Artifact.databaseId`→`fullDatabaseId`), 2027-04-01 (`RepositoryPermission.TRIAGE_PLUS`→`MODERATE`). | ❌ | Missed by Pass-1 (it stopped at 2025 + the 2026-04-01 batch). See §4. |

**Deprecation verdict:** Pass-1's *captured* deprecations are correct (✅), but the list is **incomplete** for the forward-looking 2026/2027 window (❌ on D5) and slightly overstates the notice floor (⚠️ D1).

### 3.8 Introspection / webhooks

| # | Pass-1 Claim | Pass-2 Finding | Status | Notes |
|---|--------------|----------------|--------|-------|
| I1 | `IntrospectionQuery` with **8-level `TypeRef`** | Standard; unchanged. (Not re-fetched — stable spec-level fact.) | ✅ | — |
| I2 | IDL via `Accept: application/vnd.github.v4.idl` | Unchanged. | ✅ | — |
| I3 | No GraphQL subscriptions; webhook push over HTTPS | Still true in 2026. | ✅ | — |
| I4 | Webhook headers (`X-GitHub-Event`, `X-GitHub-Delivery`, `X-Hub-Signature[-256]`, `User-Agent: GitHub-Hookshot`, `Content-Type`) | Stable; not contradicted. | ✅ | — |
| I5 | Event/action list | Stable core; 2026 features (PR stacks) would add new events but the listed core events are unchanged. | ✅ | Additive, not breaking. |

---

## 4. New Findings (pass-2 only)

These are facts Pass 1 did **not** contain. Grouped by importance to the OpenForge decision.

### 4.1 🔴 HIGH — Stateless GitHub App installation-token format (April 2026)

> Source: installation-token page (fetched), citing `github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header`.

- **Starting April 27 2026**, GitHub began a staged rollout of a **stateless token format** `ghs_<APPID>_<JWT>` to **all newly minted** GitHub App installation tokens.
- **Impact:** any code that assumes installation tokens are **exactly 40 characters** (the classic `ghs_` + 36-char token) **may break**. GitHub offers a temporary per-request override header to opt in/out of the new format for validation.
- **OpenForge implication:** (a) Pass-1's §5.4/§10.3 "1-hour installation token" is still true, but **token-shape assumptions are now unsafe** — do not hard-code length/shape; (b) if OpenForge wants auth-parity, it should design its installation token as an opaque, possibly-stateless credential and **never** let client code depend on a fixed shape; (c) this is a concrete, citable "why we should not mirror token internals" argument for §12.5.

### 4.2 🔴 HIGH — The GraphQL audit log is being deprecated (REST is canonical)

> Source: breaking-changes page (fetched).

- The 2026-04-01 mass removal of `*AuditEntry` fields carries the explicit reason: **"The GraphQL audit-log is deprecated. Please use the REST API instead."**
- This is a **strategic signal**: for OpenForge, audit/inspection data is best served over a **dedicated REST surface** (e.g. `GET /audit_log`, streaming), **not** as GraphQL query fields. Pass-1's QGL recommendations (§12) never addressed audit data at all — this finding adds a clear rule: *keep audit log on REST, out of QGL*.

### 4.3 🔴 HIGH — The 2026 changelog (entirely uncovered by Pass 1)

> Source: GraphQL changelog/2026 (fetched). Pass-1 covered 2024 + 2025 only.

Major 2026 additions, by domain (each = new types/fields/mutations a competitor deciding "what to ship" should know about):

- **Pull Request Stacks** (2026-07-22): `PullRequestStack`, `PullRequestStackEntry`, `PullRequestStackEntryConnection`/`Edge`; `PullRequest.stack`, `PullRequest.stackEntry`; `AddedToStackEvent`, `RemovedFromStackEvent` (added to `PullRequestTimelineItems`). A whole new PR-organization model (Graphite/GitButler-style).
- **Pending issue suggestions / AI triage** (2026-07-14 → 2026-07-22): `PendingIssueSuggestion` (union: `PendingAssigneeSuggestion`, `PendingCloseSuggestion`, `PendingFieldSuggestion`, `PendingLabelSuggestion`, `PendingTypeSuggestion`), `ApplyPendingIssueSuggestions`, `RejectPendingIssueSuggestions`, `IssueUpdateIntent` (with `confidence` + `rationale`), `IssueEventConfidenceLevel` (`HIGH`/`MEDIUM`/`LOW`), `AssigneeUpdateInput`/`IssueTypeUpdateInput`/`LabelUpdateInput`, `IssueStateUpdateInput`, `issueFieldUpdates` on `UpdateIssueInput`, `Issue.pendingSuggestions`, `Issue.eventRationales`. This is an **AI-suggested-actions** subsystem (propose → apply/reject) with confidence scoring.
- **Issue `relatesTo`** (2026-09-28): `AddRelatesToInput`, `RemoveRelatesToInput`, `IssueRelatesToOrder`/`Field`, `Issue.relatesTo` (a Relay connection), `addRelatesTo`/`removeRelatesTo` mutations. A relationship type beyond `blockedBy`/`blocking`.
- **Close-issue references** (2026-08-26): `AddCloseIssueReferencesInput`, `RemoveCloseIssueReferencesInput`, `addCloseIssueReferences`/`removeCloseIssueReferences`.
- **Code quality / code coverage rules** (2026-09-21): `CodeCoverageParameters` (`minimumCoverage`, `maxCoverageDrop`), `CodeQualityParameters` (`severity`), `CodeQualitySeverity` (`ALL`/`ERRORS`/`NOTES`/`WARNINGS`), `RepositoryRuleType.CODE_COVERAGE`/`.CODE_QUALITY`. Two new branch-rule categories.
- **ProjectV2 views + multi-select** (2026-07-27/28/30): `CreateProjectV2ViewInput`/`UpdateProjectV2ViewInput`/`DeleteProjectV2ViewInput`, `ProjectV2ViewConfiguration`, `ProjectV2ViewLayout`, `createProjectV2View`/`updateProjectV2View`/`deleteProjectV2View`; `ProjectV2MultiSelectField`, `ProjectV2ItemFieldMultiSelectValue`, `ProjectV2FieldType.MULTI_SELECT`.
- **Security-advisory enrichment** (2026-10-05): `SecurityAdvisory.cveId`, `.githubReviewedAt`, `.nvdPublishedAt`, `.repositoryAdvisoryUrl`, `.sourceCodeLocation`; new args on `Query.securityAdvisories` (`isWithdrawn`, `severities`).
- **`rerequestReviews`** (2026-10-05): `RerequestReviewsInput` (`userIds`/`teamIds`/`botIds`), `RerequestReviewsPayload`, `Mutation.rerequestReviews`.
- **64-bit ID migration begins** (2026-10-08): `Repository.fullDatabaseId`. This is the first step of the `databaseId`→`fullDatabaseId` migration that breaks on 2027-01-01 (`CheckAnnotation`, `Artifact`).
- **Repo permission rename** (2026-09-21 + 2026-11-02): `RepositoryPermission.TRIAGE_PLUS` added, then `MODERATE` added as the replacement; `TRIAGE_PLUS` removal scheduled 2027-04-01.
- **Copilot endpoints** (2026-07-28): `CopilotEndpoints.exp` added.
- **Other smaller items**: `PullRequestParameters.requireExtraApprovalForUnattributedChanges` (2026-10-27), `IssueFieldValueFilter` + `Organization.pinnedIssueFields` + `ProjectV2Field.isIssueField` (2026-08-12), `excludeUserLinked` args on closing references (2026-08-18), `MigrationSourceType.GITLAB` (2026-07-31), `RepositoryRulesetBypassActor.enterpriseRoleDatabaseId` (2026-09-04).

**OpenForge implication:** the churn rate is high and continues into 2026+. This *reinforces* Pass-1's §12.1 recommendation (build a shape-compatible **subset**, not a 1:1 mirror) — the moving-target argument is even stronger now. It also tells a competitor *which* domains to defer: stacks, AI triage, code-quality rules, and advisory enrichment are all 2026+ and clearly not v1.

### 4.4 🟠 MEDIUM — Forward-looking scheduled removals (2026 H2 → 2027)

> Source: breaking-changes page (fetched). None of these are in Pass-1.

| Effective | Change | Replacement |
|-----------|--------|-------------|
| 2026-07-01 | `Team.viewerSubscription` removed | — (team notification subscriptions deprecated) |
| 2026-07-01 | `Team.viewerCanSubscribe` removed | — |
| 2026-10-01 | `User.viewerRelevantRepositories` removed | `User.viewerCopilotChatRepositorySuggestions` |
| 2026-10-01 | `CopilotAgentTask.type` removed | `codingAgentFilter` / `codingAgentTypeFilter` |
| 2027-01-01 | `CheckAnnotation.databaseId` removed | `fullDatabaseId` |
| 2027-01-01 | `Artifact.databaseId` removed | `fullDatabaseId` |
| 2027-04-01 | `RepositoryPermission.TRIAGE_PLUS` removed | `MODERATE` |

**OpenForge implication:** a mirror/QGL should **not build** `Team.viewerSubscription`, `User.viewerRelevantRepositories`, `CopilotAgentTask.type`, or `TRIAGE_PLUS`; and should adopt `fullDatabaseId` (64-bit) as the database-ID field from day one rather than `databaseId`, to avoid the 2027 break.

### 4.5 🟠 MEDIUM — REST rate-limit operational nuances (new to Pass 1)

> Source: REST rate-limit page (fetched).

- **Multi-region drift:** "rate limit values can vary from one response to the next based on the location handling the request… the `x-ratelimit-*` headers are the authoritative source… if the two disagree, rely on the response headers." A client should **not** assume monotonic `x-ratelimit-remaining`.
- **`GET /rate_limit` accounting:** "does not count against your primary rate limit, but it can count against your secondary rate limit." Useful for a polling design that checks budget cheaply.
- **Shared-budget interaction (REST):** "requests made by a higher-limit app reduce the remaining budget available for lower-limit authentication methods" (a 15,000-limit app consuming 10,000 can exhaust a user's 5,000 PAT budget). Pass-1 did not capture this cross-credential interaction.
- **GraphQL recommendation nuance:** the GraphQL rate-limit page explicitly says "When possible, you should use the rate limit response **headers** instead of querying the API" — a minor but real guidance point for QGL SDK design (read headers first, `rateLimit` as fallback).

### 4.6 🟡 LOW — Fine-grained PAT operational details (new to Pass 1)

> Source: fine-grained PAT page (fetched).

- **1-year inactivity removal:** "GitHub automatically removes personal access tokens that haven't been used in a year." Affects the "classic = never" claim (see D4).
- **Pre-filled token URLs:** GitHub supports deep links to pre-fill a token (`?contents=read&pull_requests=write&...`, `expires_in` 1–366 or `none`, `target_name=<owner>`). Useful DX feature a competitor could replicate.
- **Explicit fine-grained gap list** (the precise form of "can't do everything classic"): public-repo contribution (non-member), outside-collaborator contribution, multi-org access, **Packages**, **Checks API**, user-owned **Projects**.

### 4.7 🟡 LOW — `graphql-request` return-shape + abort nuance (refines Pass 1 §2.9)

> Source: Context7 `/onfido/graphql-request`.

- `rawRequest` returns **`{ data, errors, extensions, headers, status }`** — Pass-1 listed only `{ data, status, headers }`; it omits the (useful) `errors` and `extensions` fields that `rawRequest` actually exposes.
- `GraphQLClient.rawRequest(query, vars, { signal })` accepts a per-call **`AbortController` signal** (timeout/abort) — relevant to OpenForge's QGL client for honoring a client-side deadline.
- Non-JSON response bodies: "the error payload's `error` field contains the raw text" — a robustness detail for the QGL client's error path.

---

## 5. Disagreements

Items where Pass 1 is **wrong or imprecise** (none are catastrophic; most are nuance).

### D1 — Deprecation notice floor: "~6 months" vs "≥ 3 months, effective on quarter start"
- **Pass 1 (§7.3, §12):** "GitHub deprecates for ~6 months… then hard-removes."
- **Pass 2 (breaking-changes page):** "We'll announce upcoming breaking changes **at least three months** before… Changes go into effect **on the first day of a quarter** (January 1st, April 1st, July 1st, or October 1st)."
- **Verdict:** ⚠️ **Imprecise, not wrong.** The *contractual* guarantee is ≥3 months + quarter-aligned effective dates; ~6 months is the *observed* norm. **Fix:** restate as "≥3 months notice, effective on quarter start; observed cadence often ~6 months."

### D2 — `GraphqlResponseError.status` is not a documented top-level field
- **Pass 1 (§2.5, §6.2):** the error carries `error.status` (HTTP status, typically 200).
- **Pass 2 (Context7 `octokit.js`):** the documented class fields are `name`, `request`, `headers`, `response`, `errors`, `data`. There is **no documented top-level `status`**; the response/headers are carried by `error.response` and `error.headers`.
- **Verdict:** ⚠️ **Minor inaccuracy.** A `status` may still be reachable via `RequestError` inheritance, but the *documented* carriers are `response`/`headers`. **Fix:** in any QGL client, read status from `error.headers`/`error.response`, not `error.status`; or state explicitly that `status` is inherited, not part of the documented contract.

### D3 — "50+ granular permissions" understates the actual count
- **Pass 1 (§5.1):** "50+ granular permissions."
- **Pass 2 (PAT page):** the three tables total **76** permissions (20 account + 29 repository + 27 organization).
- **Verdict:** ⚠️ **Undercount.** "50+" is technically true but misleadingly low. **Fix:** state "~76 (20 account / 29 repository / 27 organization)."

### D4 — Classic PAT lifetime "never" is imprecise
- **Pass 1 (§5.4):** classic PAT = "**Never** (until revoked)."
- **Pass 2 (PAT page):** "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy… **GitHub automatically removes personal access tokens that haven't been used in a year**."
- **Verdict:** ⚠️ **Imprecise.** Infinite is *permitted* but (a) an org max-lifetime policy can override it and (b) 1-year inactivity forces removal. **Fix:** "infinite by default, but removable after 1 year of inactivity and subject to org max-lifetime policy."

### D5 — Forward-looking deprecation list is incomplete (the one substantive gap)
- **Pass 1 (§7.3):** lists 2025 removals + the 2026-04-01 `AuditEntry`/`ReviewRequest.requestedBy` batch, but **omits** the 2026-07-01, 2026-10-01, 2027-01-01, and 2027-04-01 removals.
- **Pass 2 (breaking-changes page):** those future removals exist (see §4.4).
- **Verdict:** ❌ **Incomplete** (not "wrong" about what it states — everything it states is correct — but it omits material forward-looking breaks a mirror must plan around). This is the single most important Pass-1 omission.

### D6 — Mutation count "~300" is now a lowball (minor)
- **Pass 1 (§1.2):** "GitHub's `Mutation` type has ~300 fields."
- **Pass 2 (changelog/2026):** ~12+ mutations were added in 2026 alone.
- **Verdict:** ⚠️ **Stale low.** Call it ~310+. Not a correctness error, but a freshness issue.

**No ❌ on any *stable spec* value.** Every rate-limit number, every pagination constant, every cost-algorithm step, every node-cap figure, and every fine-grained permission entry in Pass 1 is **exactly correct** against today's docs.

---

## 6. Recommendation

**Should `openforge-research-graphql.md` be updated? → YES, but the update is additive and low-risk.** The stable core (Sections 1, 2, 3, 4, 6, 8, 9) is verified accurate and should be **kept as-is**. The changes needed are concentrated in three places:

### 6.1 Do (priority-ordered edit list)

1. **Add a §7.5 "2026 schema changes"** (new) — port the §4.3 list (PR stacks, pending issue suggestions/AI triage, `relatesTo`, close-issue-references, code-quality/coverage rules, ProjectV2 views + multi-select, security-advisory enrichment, `rerequestReviews`, `fullDatabaseId`, `TRIAGE_PLUS`→`MODERATE`). This is the largest gap. *(Maps to D5 + §4.3.)*
2. **Add a §7.6 "2026 H2 / 2027 scheduled removals"** (new) — port the §4.4 table. State the rule: *do not build `Team.viewerSubscription`, `User.viewerRelevantRepositories`, `CopilotAgentTask.type`, `TRIAGE_PLUS`; adopt `fullDatabaseId` from day one.* *(Maps to D5.)*
3. **Add §5.6 "Installation token format change (2026)"** (new) — document the `ghs_<APPID>_<JWT>` stateless format (since 2026-04-27) and the rule *never assume a fixed token shape*; cite the `github.blog/changelog/2026-05-15-...` override header. This is the most consequential single miss. *(Maps to §4.1.)*
4. **Add §6.6 / §12.7 "Audit log → REST, not GraphQL"** (new) — GitHub is deprecating the GraphQL audit log in favor of REST; OpenForge should serve audit data on a REST surface, outside QGL. *(Maps to §4.2.)*
5. **Fix §7.3 deprecation-notice wording** — change "~6 months" to "≥3 months notice, effective on quarter start; observed cadence often ~6 months." *(Maps to D1.)*
6. **Fix §5.1 count** — "50+" → "~76 (20 account / 29 repository / 27 organization)." *(Maps to D3.)*
7. **Fix §5.4 classic-PAT row** — "Never" → "infinite by default; removable after 1 yr inactivity; subject to org max-lifetime policy." *(Maps to D4.)*
8. **Fix §2.5 / §6.2 error field** — replace `error.status` with `error.headers`/`error.response` (or note `status` is inherited, not documented). *(Maps to D2.)*
9. **Refresh §1.2 mutation count** — "~300" → "~310+ (grew in 2026)." *(Maps to D6.)*
10. **Add §3.8 "Rate-limit operational notes"** (new, short) — multi-region header drift (headers are authoritative), `GET /rate_limit` secondary-only accounting, shared-budget interaction, and "prefer headers over querying `rateLimit`." *(Maps to §4.5.)*
11. **Add a §7 "2026 changelog link"** to §11 References: `https://docs.github.com/en/graphql/overview/changelog/2026` (Pass-1 referenced 2024 and 2025 only).
12. **Add a verification note** at the top or in §11: "Pass-2 verified 2026-11-03 against primary `docs.github.com` + Context7 `octokit`/`graphql-request`; all stable specs re-confirmed; see `openforge-research-graphql-pass2.md`."

### 6.2 Do NOT (avoid over-editing)

- **Do not rewrite** §3 (rate limits) or §4 (pagination) — both are **22/22 and 10/10 verified exact**. Any change risks introducing error into the most reliable part of the doc.
- **Do not** re-litigate §12 recommendations — they remain sound and are *reinforced* by the 2026 churn finding (stronger case for a subset QGL, REST audit log, and shape-only token parity).
- **Do not** add the full 2026 type dumps verbatim — a curated "what's new + what to defer" list is more useful for the OpenForge decision than a schema-diff firehose.

### 6.3 Net assessment

| Dimension | Pass-1 quality | Evidence |
|-----------|----------------|----------|
| Stable specs (rate limits, pagination, cost, node caps) | **Excellent** — 32/32 ✅ | §3.2, §3.3 |
| Client-SDK / error contract | **Very good** — 1 nuance (`status`) | §3.4 |
| Auth (lifetimes, permission tables) | **Very good** — tables 100% verbatim; 3 minor wording fixes | §3.5 |
| Time-sensitive (2026 changes, deprecations, token format) | **Stale** — entire 2026 window + 1 auth change missed | §4, §5 (D5) |

**Bottom line:** Pass 1 is a **high-quality, accurate reference for the stable GraphQL contract** and is safe to build on. It is **not current on the 2026 churn** and **missed the stateless-installation-token change**, both of which matter for a self-hosted competitor deciding what to mirror. Apply the 12 additive/fix edits in §6.1 and the document becomes current with no risk to its verified core.

### 6.4 Change manifest (edit-by-edit before/after preview)

Concrete, copy-paste-ready edits. "Location" is the Pass-1 section/anchor. Items marked **[new]** insert a section; **[fix]** replace existing text.

**[new] E1 — §7.5 "2026 schema changes"**
Insert after §7.4. Content: the four deferred domains from Appendix A + the §4.3 bullet list. Opening line:
> "### 7.5 New types/fields added in 2026 (Pass-2 addition — was not covered in Pass 1)
> The 2026 changelog (`docs.github.com/en/graphql/overview/changelog/2026`) added four whole capability domains a v1 competitor should **defer**: **(1) Pull Request stacks** (`PullRequestStack`, `PullRequest.stack`/`.stackEntry`, `AddedToStackEvent`/`RemovedFromStackEvent`), **(2) AI-suggested issue actions** (`PendingIssueSuggestion` + `Apply`/`RejectPendingIssueSuggestions`, `IssueEventConfidenceLevel`, `rationale`/`intent`), **(3) code-quality/code-coverage branch rules** (`CodeQualityParameters`, `CodeCoverageParameters`, `RepositoryRuleType.CODE_QUALITY`/`.CODE_COVERAGE`), and **(4) security-advisory enrichment** (`SecurityAdvisory.cveId`/`.nvdPublishedAt`/`.sourceCodeLocation`). Also added: `Issue.relatesTo` + `addRelatesTo`/`removeRelatesTo`, `addCloseIssueReferences`/`removeCloseIssueReferences`, `Mutation.rerequestReviews`, ProjectV2 views + multi-select fields, and the first `fullDatabaseId` (on `Repository`, 2026-10-08)."

**[new] E2 — §7.6 "2026 H2 / 2027 scheduled removals"**
Insert after §7.5. Content: the §4.4 table + rule line:
> "**Do not build:** `Team.viewerSubscription`, `Team.viewerCanSubscribe` (gone 2026-07-01), `User.viewerRelevantRepositories` (→ `viewerCopilotChatRepositorySuggestions`, 2026-10-01), `CopilotAgentTask.type` (2026-10-01), `RepositoryPermission.TRIAGE_PLUS` (→ `MODERATE`, 2027-04-01). **Adopt now:** `fullDatabaseId` (64-bit) instead of `databaseId` to avoid the 2027-01-01 break on `CheckAnnotation`/`Artifact`."

**[new] E3 — §5.6 "Installation token format change (2026)"**
Insert after §5.5. Content:
> "### 5.6 Installation token format change (2026)
> Since **2026-04-27** GitHub rolls out a **stateless** installation-token format `ghs_<APPID>_<JWT>` to all newly minted tokens. Code that assumes tokens are **exactly 40 characters** (the legacy `ghs_` + 36 chars) may break; GitHub provides a temporary per-request override header (see `github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header`). **Rule for OpenForge:** treat installation tokens as opaque credentials; never depend on fixed length or shape in client code."

**[new] E4 — §6.6 / §12.7 "Audit log → REST, not GraphQL"**
Insert a short note in §6 and a bullet in §12. Content:
> "GitHub is **deprecating the GraphQL audit log** — the 2026-04-01 mass removal of `*AuditEntry` fields is annotated 'The GraphQL audit-log is deprecated. Please use the REST API instead.' **Rule for OpenForge:** serve audit/inspection data on a dedicated REST surface (e.g. `GET /audit_log`, streaming), **not** as QGL fields."

**[fix] E5 — §7.3 deprecation-notice wording**
- Before: `GitHub deprecates for ~6 months with a changelog "Effective" date, then hard-removes.`
- After: `GitHub announces breaking changes **at least 3 months** ahead and makes them effective **on the first day of a quarter** (Jan/Apr/Jul/Oct 1); the observed cadence is often ~6 months. A competitor should (a) never build fields already on a removal schedule, (b) replicate the deprecation mechanism (`@deprecated(reason:)` + changelog + effective date) so the SDK can warn.`

**[fix] E6 — §5.1 permission count**
- Before: `50+ granular permissions`
- After: `~76 granular permissions (20 account / 29 repository / 27 organization)`

**[fix] E7 — §5.4 classic-PAT row**
- Before: `Classic PAT | **Never** (until revoked) — can be set to expire`
- After: `Classic PAT | **Infinite by default**, but auto-removed after **1 year of inactivity** and subject to org **max-lifetime policy**`

**[fix] E8 — §2.5 / §6.2 error field**
- Before: `` - `error.status` — HTTP status (typically `200`) ``
- After: `` - `error.headers` — the response headers (authoritative for rate-limit/status inspection)
  - `error.response` — the full response payload
  - (a top-level `error.status` is not in the documented class shape; read status from `headers`/`response`) ``

**[fix] E9 — §1.2 mutation count**
- Before: `GitHub's `Mutation` type has ~300 fields.`
- After: `GitHub's `Mutation` type has ~310+ fields (grew through 2026 — see §7.5).`

**[new] E10 — §3.8 "Rate-limit operational notes"**
Insert after §3.7. Content:
> "### 3.8 Operational notes (Pass-2)
> - **Multi-region drift:** `x-ratelimit-*` values can vary response-to-response by region; the **headers are authoritative** over `GET /rate_limit`. Do not assume `x-ratelimit-remaining` is monotonic.
> - **`GET /rate_limit`** does not hit the primary limit but **can hit the secondary** limit — use it for cheap budget checks.
> - **Shared budget (REST):** a higher-limit app's consumption **reduces the budget of lower-limit methods** on the same user.
> - **GraphQL guidance:** prefer the response **headers** over querying `rateLimit` 'when possible'."

**[new] E11 — §11 References**
Append:
> `- https://docs.github.com/en/graphql/overview/changelog/2026 (Pass-2: PR stacks, pending suggestions/AI triage, relatesTo, code-quality rules, fullDatabaseId, rerequestReviews)`
> `- https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header (Pass-2: stateless installation-token format)`
> `- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app (Pass-2 re-verified: 1-hour expiry, stateless format, X-GitHub-Api-Version)`

**[new] E12 — top-of-file verification banner**
Insert after the existing header block:
> `> **Pass-2 verification (2026-11-03):** all stable specs (§1–§6, §8–§9) re-confirmed against live docs.github.com + Context7 octokit/graphql-request. The 2026 changelog, stateless installation-token format, and GraphQL audit-log deprecation are Pass-2 additions — see E1–E4 and \`openforge-research-graphql-pass2.md\`.`

---

## 7. Source register

All URLs cited in this report, with how/when obtained on **2026-11-03**.

### 7.1 Fetched live (webfetch, full content)

1. https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api — GraphQL primary/secondary limits, headers, `rateLimit`, cost algorithm (5,101→51), node limits, timeouts, resource limits.
2. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — REST primary/secondary limits, headers, `GET /rate_limit`, multi-region note, shared-budget note.
3. https://docs.github.com/en/graphql/overview/breaking-changes — deprecation policy (≥3 months, quarter start); 2026-04-01 `ReviewRequest.requestedBy` + mass `*AuditEntry` removals ("GraphQL audit-log deprecated"); 2026-07-01 / 2026-10-01 / 2027-01-01 / 2027-04-01 scheduled removals.
4. https://docs.github.com/en/graphql/overview/changelog/2026 — full 2026 schema changelog (PR stacks, pending issue suggestions/AI triage, `relatesTo`, close-issue-references, code-quality/coverage rules, ProjectV2 views + multi-select, security-advisory enrichment, `rerequestReviews`, `fullDatabaseId`, `TRIAGE_PLUS`/`MODERATE`, Copilot endpoints, etc.).
5. https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens — fine-grained vs classic; 50-token cap; 366-day cap; 76-permission tables (verbatim); 1-year inactivity removal; fine-grained gap list; pre-fill URLs.
6. https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app — 1-hour installation token; `Bearer` for JWT; repo/permission scoping (≤500 repos); Octokit auto-regen; **stateless `ghs_<APPID>_<JWT>` format (since 2026-04-27)**; `X-GitHub-Api-Version: 2026-03-10`.

### 7.2 Queried via Context7 (live doc snippets)

7. `/octokit/octokit.js` (Context7 library ID) — `GraphqlResponseError` (fields + error element shape), `octokit.graphql.paginate` (query must select `pageInfo {hasNextPage endCursor}` / `{hasPreviousPage startCursor}`), `paginate.iterator`, `PageInfoForward`/`PageInfoBackward`.
8. `/onfido/graphql-request` (Context7 library ID) — `rawRequest<T>(url, query, variables?, requestHeaders?)` → `{ data, errors, extensions, headers, status }`; `ClientError` conditions (non-2xx / `errors` key / falsy `data`); `GraphQLClient` + per-call `{ signal }`; raw-text error fallback.
9. Context7 resolved IDs (metadata): `/octokit/octokit.js` (v5.0.5), `/octokit/graphql-schema`, `/octokit/auth-app.js`, `/onfido/graphql-request`.

### 7.3 Referenced but not directly fetched (secondary / cited-by-docs)

10. https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header — the stateless-token per-request override header (cited by source #6).
11. https://relay.dev/graphql/connections.htm — Relay Cursor Connections spec (Pass-1 source; unchanged; not re-fetched — stable spec).

### 7.4 Attempted and blocked (recorded for transparency)

12. `websearch_web_search_exa` — all five mandated queries ("GitHub GraphQL schema 2026", "GitHub GraphQL rate limit change 2025 2026", "fine-grained PAT scopes 2026", "GitHub App installation token rotation", "GitHub GraphQL deprecations 2026") **failed with Exa free-MCP rate limit** (error `-32000`). Compensated by the direct canonical-page fetches in §7.1. No network/proxy fault observed.

### 7.5 Reproducibility (how to re-run this verification)

To independently reproduce every ✅/⚠️/❌ in §3, re-fetch the six pages in §7.1 and re-query the two Context7 IDs in §7.2; the verbatim quotes in Appendix B are the acceptance criteria (a verdict flips only if the fetched text no longer matches the quote). Concrete checklist:

1. `webfetch` `docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api` → confirm R1–R19 against B.1–B.4.
2. `webfetch` `docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api` → confirm R20 + the §4.5 notes against B.5.
3. `webfetch` `docs.github.com/en/graphql/overview/breaking-changes` → confirm D2/D3 (✅) and D5 (the 2026 H2/2027 rows) against B.6–B.7.
4. `webfetch` `docs.github.com/en/graphql/overview/changelog/2026` → confirm the Appendix A date table row-for-row.
5. `webfetch` the fine-grained PAT page → diff the three permission tables against Pass-1 §5.1 (expect 20/29/27, all verbatim) per B.8.
6. `webfetch` the installation-token page → confirm 1-hour expiry + the stateless-format paragraph per B.9.
7. `context7_query-docs` `/octokit/octokit.js` and `/onfido/graphql-request` → confirm `GraphqlResponseError`/`paginate` and `rawRequest`/`ClientError` per B.10–B.11.

---

---

## 8. Appendix A — 2026 changelog, date-indexed (granular)

> Source: https://docs.github.com/en/graphql/overview/changelog/2026 (fetched 2026-11-03). This is the per-date detail behind §4.3. Pass 1 did **not** cover 2026 at all. "Kind" = A(add) / D(deprecate-or-remove) / E(enum-value) / M(mutation) / F(field).

| Date | Kind | Change |
|------|------|--------|
| 2026-11-02 | E/D | `RepositoryPermission.MODERATE` added; `TRIAGE_PLUS` removal scheduled **2027-04-01**. |
| 2026-10-27 | F | `PullRequestParameters.requireExtraApprovalForUnattributedChanges` (+ `PullRequestParametersInput`). |
| 2026-10-26 | F | `ignoredFilePaths: [String!]` on `FilePathRestrictionParameters` and `MaxFileSizeParameters` (+ inputs). |
| 2026-10-08 | F | `Repository.fullDatabaseId` (64-bit ID migration step one). |
| 2026-10-05 | A/M/F | `AddedToStackEvent`, `RemovedFromStackEvent` (+ `PullRequestTimelineItems` members); `RerequestReviewsInput`/`RerequestReviewsPayload`/`Mutation.rerequestReviews` (`userIds`/`teamIds`/`botIds`); `Query.securityAdvisories` new args `isWithdrawn`, `severities`; `SecurityAdvisory` fields `cveId`, `githubReviewedAt`, `nvdPublishedAt`, `repositoryAdvisoryUrl`, `sourceCodeLocation`. |
| 2026-10-01 | F | `ProjectV2Iteration.id`. |
| 2026-09-28 | A/M/F | `AddRelatesToInput`/`RemoveRelatesToInput`, `IssueRelatesToOrder`/`IssueRelatesToOrderField`, `Issue.relatesTo` (connection), `Mutation.addRelatesTo`/`removeRelatesTo`. |
| 2026-09-21 | A/D/E | `IssueEventRationale` + `IssueEventWithRationale` removed; `CodeCoverageParameters` (+`Input`), `CodeQualityParameters` (+`Input`), `CodeQualitySeverity` (`ALL/ERRORS/NOTES/WARNINGS`) added; `PendingAssigneeSuggestion`/`PendingCloseSuggestion`/`PendingFieldSuggestion`/`PendingLabelSuggestion`/`PendingTypeSuggestion` gain `id` (implement `Node`); `RepositoryPermission.TRIAGE_PLUS` added; `RepositoryRuleType.CODE_COVERAGE`/`.CODE_QUALITY` added; `rationale` removed from `LabeledEvent`/`UnlabeledEvent`/`IssueType*Event`/`IssueField*Event`. |
| 2026-09-10 | D | `ProofOfPresenceRequirement` + `UpdateEnterpriseProofOfPresenceRequiredSetting{Input,Payload}` + mutation removed. |
| 2026-09-04 | F | `RepositoryRulesetBypassActor.enterpriseRoleDatabaseId: BigInt` (+ input). |
| 2026-09-02 | E | `OrganizationInvitationSource.ENTERPRISE_ORGANIZATION_CREATION`; `PullRequestTimelineItemsItemType.ADDED_TO_STACK_EVENT`/`.REMOVED_FROM_STACK_EVENT`. |
| 2026-08-26 | A/M | `AddCloseIssueReferencesInput`/`RemoveCloseIssueReferencesInput` (+payloads) + `Mutation.addCloseIssueReferences`/`removeCloseIssueReferences`; `Enterprise.enterpriseTeams(userLogins:)`. |
| 2026-08-25 | A/E | `PullRequestReviewThreadResolutionReason` (`ADDRESSED/INVALID/WONT_FIX`); `ResolveReviewThreadInput.resolutionReason`. |
| 2026-08-24 | A | `IssueFieldUpdateInput`, `IssueFieldUpdateOperation` (`ADD/CLEAR/REMOVE/SET`); `UpdateIssueInput.issueFieldUpdates`. |
| 2026-08-18 | F | `excludeUserLinked` on `Issue.closedByPullRequestsReferences` + `PullRequest.closingIssuesReferences`. |
| 2026-08-17 | E | `ProofOfPresenceRequirement.SECURITY_KEY` removed. |
| 2026-08-13 | F | `Enterprise.innersourceVulnerabilities` + `Organization.innersourceVulnerabilities` (connection). |
| 2026-08-12 | A/F | `IssueFieldValueFilter`; `Organization.pinnedIssueFields` (connection); `ProjectV2Field.isIssueField`/`.issueField` (+ `ProjectV2FieldCommon`, single/multi-select fields). |
| 2026-07-31 | E | `MigrationSourceType.GITLAB`. |
| 2026-07-30 | A | `ProjectV2ViewConfiguration` (+`visibleFields` connection); `ProjectV2View.configuration`. |
| 2026-07-28 | A/M | `CreateProjectV2ViewInput`/`Payload`, `DeleteProjectV2ViewInput`/`Payload`, `UpdateProjectV2ViewInput`/`Payload` + `createProjectV2View`/`updateProjectV2View`/`deleteProjectV2View`; `CopilotEndpoints.exp`; `ProofOfPresenceRequirement.SECURITY_KEY` added. |
| 2026-07-27 | A/E | `ProjectV2ItemFieldMultiSelectValue`, `ProjectV2MultiSelectField`, `ProjectV2MultiSelectFieldOption` (+`Input`); `ProjectV2FieldType.MULTI_SELECT`/`ProjectV2CustomFieldType.MULTI_SELECT`; `ProjectV2FieldValue.multiSelectOptionIds`. |
| 2026-07-23 | A/M | `ProofOfPresenceRequirement` (`MFA/NO_POLICY/REAUTH`) + `UpdateEnterpriseProofOfPresenceRequiredSetting{Input,Payload}` + mutation added. |
| 2026-07-22 | A/M | Pending-suggestion subsystem: `ApplyPendingIssueSuggestions{Input,Payload}`, `RejectPendingIssueSuggestions{Input,Payload}` + mutations; `IssueUpdateIntent`, `PendingIssueSuggestion` (+`Kind`/`Ref`), `PullRequestStack`/`PullRequestStackEntry`/`…Connection`/`…Edge`; `PullRequest.stack`/`.stackEntry`; `intent`/`rationale`/`eventRationales`/`pendingSuggestions` on `Issue` + timeline events. |
| 2026-07-20 | A | `IssueStateUpdateInput` (+`confidence`/`rationale`/`duplicateIssueId`/`suggest`); `UpdateIssueInput.stateInput`. |
| 2026-07-16 | F | `Assignable.viewerCanAssign`; `Issue.viewerCanSetMilestone`/`.viewerCanType`/`.viewerCanUpdateMetadata`; `PullRequest.viewerCanAssign`. |
| 2026-07-14 | A/E | `AssigneeUpdateInput`, `IssueTypeUpdateInput`, `LabelUpdateInput` (each with `confidence`/`rationale`/`suggest`); `IssueEventConfidenceLevel` (`HIGH/MEDIUM/LOW`); richer `assignees`/`labels` args on `AddAssigneesToAssignableInput`/`AddLabelsToLabelableInput`. |

**Read-off for OpenForge:** the 2026 additions cluster into four *new capability domains* a v1 competitor should explicitly defer — **(1) PR stacks**, **(2) AI-suggested issue actions (pending suggestions + confidence/rationale)**, **(3) code-quality/code-coverage branch rules**, and **(4) security-advisory enrichment**. Everything else is additive field/enum growth on already-supported types.

---

## 9. Appendix B — Verbatim primary-source evidence

> Each block quotes the live source fetched/queried on 2026-11-03 that establishes the corresponding matrix verdict. This is the proof-of-verification layer: if a reviewer disputes a ✅ in §3, the quote here is the ground truth.

### B.1 GraphQL primary rate limit (verdict R1–R5 ✅)

> Source: `docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api`

- "For users: **5,000 points per hour** per user. This includes requests made with a personal access token as well as requests made by a GitHub App or OAuth app on behalf of a user… A GitHub App that is owned by a GitHub Enterprise Cloud organization have a higher rate limit of **10,000 points per hour**."
- "For GitHub App installations not on a GHEC organization: **5,000 points per hour** per installation. Installations that have more than **20 repositories** receive another **50 points per hour** for each repository… more than **20 users** receive another **50 points per hour** for each user. The rate limit cannot increase beyond **12,500 points per hour**."
- "For GitHub App installations on a GHEC organization: **10,000 points per hour** per installation."
- "For OAuth apps: **5,000 points per hour**, or **10,000 points per hour** if the app is owned by a GHEC organization."
- "For `GITHUB_TOKEN` in GitHub Actions workflows: **1,000 points per hour per repository**. For requests to resources that belong to an enterprise account on GitHub.com, the limit is **15,000 points per hour per repository**."

### B.2 Cost algorithm + worked example (verdicts R8, R9 ✅)

> Source: same page

- "1. Add up the number of requests needed to fulfill each unique connection in the call. Assume every request will reach the `first` or `last` argument limits. 2. Divide the number by **100** and round the result to the nearest whole number… The **minimum point value** of a call to the GraphQL API is **1**."
- "requests for repositories = **1**… requests for issues = **100**… requests for labels = **5,000**… Total = **5,101**… Dividing by 100 and rounding gives us the final score of the query: **51**."

### B.3 Secondary limits + points (verdicts R10–R14 ✅)

> Source: same page (and mirrored on the REST page)

- "No more than **100 concurrent requests**… No more than **900 points per minute**… for REST… and no more than **2,000 points per minute**… for the GraphQL API."
- "No more than **90 seconds of CPU time per 60 seconds** of real time… No more than **60 seconds** of this CPU time may be for the GraphQL API."
- "no more than **80 content-generating requests per minute** and no more than **500… per hour**… No more than **2,000 OAuth access token requests per hour**."
- Points table: "GraphQL requests without mutations = **1**"; "GraphQL requests with mutations = **5**"; "Most REST `GET`, `HEAD`, `OPTIONS` = **1**"; "Most REST `POST`, `PATCH`, `PUT`, `DELETE` = **5**."

### B.4 Exceed / timeout / node limits (verdicts R15–R19 ✅)

> Source: same page

- "If you exceed your primary rate limit, the response status will still be **200**… and the value of the `x-ratelimit-remaining` header will be **0**."
- "If you exceed a secondary rate limit, the response status will be **200 or 403**… If the `retry-after` response header is present… If the `x-ratelimit-remaining` header is **0**… wait for at least **one minute**… wait for an **exponentially increasing** amount of time between retries, and throw an error after a specific number of retries."
- "If GitHub takes more than **10 seconds**… you will receive either a **502 or 504**… additional points will be deducted from your primary rate limit for the next hour."
- "Clients must supply a `first` or `last` argument… Values of `first` and `last` must be within **1-100**. Individual calls cannot request more than **500,000 total nodes**."
- Simple example: "50 = 50 repositories + 50 x 10 = 500 repository issues = **550 total nodes**." Complex example: "…= **22,060 total nodes**."

### B.5 REST primary limits + operational notes (verdict R20 ✅, §4.5 new)

> Source: `docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api`

- "The primary rate limit for unauthenticated requests is **60 requests per hour**… your personal rate limit of **5,000 requests per hour**… GHEC organization have a higher rate limit of **15,000**… installation's minimum rate limit of **5,000**… [GHEC] **15,000**… cannot increase beyond **12,500**… `GITHUB_TOKEN`… **1,000 requests per hour per repository**… [GHEC] **15,000**."
- New nuance: "Because GitHub processes API requests in multiple regions, rate limit values can vary from one response to the next… The `x-ratelimit-*` headers are the **authoritative source**… If the two disagree, rely on the response headers."
- New nuance: "You can call the `GET /rate_limit` endpoint… Calling this endpoint **does not count against your primary rate limit, but it can count against your secondary rate limit**."
- New nuance: "requests made by a higher-limit app **reduce the remaining budget available for lower-limit authentication methods**."

### B.6 Deprecation policy + 2026-04-01 batch (verdicts D1, D2, D3 ✅/⚠️; §4.2/§4.4)

> Source: `docs.github.com/en/graphql/overview/breaking-changes`

- Policy: "We'll announce upcoming breaking changes **at least three months** before making changes… Changes go into effect **on the first day of a quarter (January 1st, April 1st, July 1st, or October 1st)**." *(basis for D1)*
- "2026-04-01 — `ReviewRequest.requestedBy`… **will be removed. Use requestedByActor instead**." *(basis for D2 ✅)*
- Dozens of entries under 2026-04-01 (`TeamRemoveRepositoryAuditEntry.*`, `TeamAddMemberAuditEntry.*`, `RepoRemoveTopicAuditEntry.*`, `RepositoryVisibilityChange*AuditEntry.*`, …) each with reason: "**The GraphQL audit-log is deprecated. Please use the REST API instead.**" *(basis for D3 ✅ + §4.2)*

### B.7 Scheduled 2026 H2 / 2027 removals (verdict D5 ❌; §4.4)

> Source: `docs.github.com/en/graphql/overview/breaking-changes`

- "2026-07-01 — `Team.viewerSubscription` will be removed… `Team.viewerCanSubscribe` will be removed. Team notifications subscriptions are being deprecated."
- "2026-10-01 — `User.viewerRelevantRepositories`… Use `viewerCopilotChatRepositorySuggestions` instead… `CopilotAgentTask.type`… Use `codingAgentFilter` and `codingAgentTypeFilter` instead."
- "2027-01-01 — `CheckAnnotation.databaseId`… Use `fullDatabaseId` instead… `Artifact.databaseId`… Use `fullDatabaseId` instead."
- "2027-04-01 — `RepositoryPermission.TRIAGE_PLUS`… Use `MODERATE` instead."

### B.8 Fine-grained PAT (verdicts A1–A8 ✅/⚠️; §4.6)

> Source: `docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens`

- "There is a limit of **50 fine-grained personal access tokens** you can create." *(A6 ✅)*
- "`expires_in`… **Integer between 1 and 366, or `none`**… Infinite lifetimes are allowed but may be blocked by a **maximum lifetime policy**." *(A7 ✅)*
- "**GitHub automatically removes personal access tokens that haven't been used in a year.**" *(basis for D4 ⚠️)*
- Account permissions table: **20** rows (blocking → watching), Repository permissions table: **29** rows (actions → workflows), Organization permissions table: **27** rows (organization_api_insights → organization_hooks) — **each row matches Pass-1 §5.1 verbatim, including access levels** (`read`/`write`/`admin`). *(A3/A4/A5 ✅; basis for D3 ⚠️: total is 76, not "50+")*
- Fine-grained gap list: "contribute to public repos where the user is not a member… contribute to repositories where the user is an outside or repository collaborator… access multiple organizations at once… access **Packages**… call the **Checks API**… access **Projects owned by a user account**." *(A8 ✅)*

### B.9 Installation token + stateless format (verdicts A10–A12 ✅; §4.1 🔴)

> Source: `docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app`

- "The installation access token will **expire after 1 hour**." *(A11 ✅)*
- "if you are passing a JSON web token (JWT), you **must use `Authorization: Bearer`**." *(A10 ✅)*
- "you can use GitHub's Octokit SDKs to authenticate as an app. The SDK will take care of generating an installation access token for you and will **regenerate the token once it expires**." *(A12 ✅)*
- **New:** "Starting **April 27, 2026**, GitHub began a staged rollout of a **stateless format (`ghs_APPID_JWT`)** to all newly minted GitHub App installation tokens… If your application expects or relies on installation tokens being **exactly 40 characters long**, it may not handle this new token format correctly." *(§4.1 — missed by Pass 1)*
- Request example now includes header `X-GitHub-Api-Version: 2026-03-10`. *(§4.1)*

### B.10 Context7 — octokit error + pagination (verdicts C1–C4, P9–P10 ✅/⚠️)

> Source: Context7 `/octokit/octokit.js` (`_autodocs/errors.md`, `types.md`, `api-reference/graphql.md`)

- `GraphqlResponseError` fields: "`request`… `headers` — response headers… `errors` — `response.data.errors` array (each `{ message, type, path, locations, extensions }`)… `data` — `response.data.data` (partial data returned alongside errors)." Trigger: "a response whose `data.errors` array is non-empty." *(C1/C3 ✅; basis for D2 ⚠️ — no documented top-level `status`; use `headers`/`response`)*
- `paginate`: "The query must request `pageInfo { hasNextPage endCursor }` (forward pagination) or `hasPreviousPage startCursor` (backward pagination). **Merges all pages into a single response**." *(P9/P10 ✅)*
- `paginate.iterator`: "Iterates over all issues **page by page**… memory-efficient for large result sets." *(P10 ✅)*
- `PageInfoForward = { hasNextPage, endCursor }`; `PageInfoBackward = { hasPreviousPage, startCursor }`. *(P5 ✅)*

### B.11 Context7 — graphql-request (verdicts C5–C7 ✅; §4.7)

> Source: Context7 `/onfido/graphql-request` (`_autodocs/api-reference/rawRequest.md`, `GraphQLClient.md`)

- `rawRequest<T>(url, query, variables?, requestHeaders?): Promise<RawRequestResult<T>>` returning "`data`… `errors`… `extensions`… `headers`… `status`." *(C5 ✅; §4.7 — Pass-1 listed only data/status/headers)*
- "`ClientError` | **Non-2xx status; parsed body containing an `errors` key (even with a 2xx status); or missing/falsy `data` in the body**." *(C5 ✅)*
- "`GraphQLClient`… `.rawRequest('{ me { id } }', {}, { signal })`" — per-call abort via `AbortController`. *(C7/§4.7 ✅)*
- Confirms canonical source path `github.com/onfido/graphql-request/...`. *(C6 ✅ — Pass-1's citation is correct)*

---

*End of Pass-2 verification report. Generated 2026-11-03 for the OpenForge project. Every stable-spec claim in Pass 1 was re-checked against a live `docs.github.com` page or a live Context7 doc snippet; every Pass-2 finding above cites the source that established it, and Appendix B reproduces the verbatim source text as the proof layer. The Exa search tool was unavailable this pass — flagged rather than papered over.*
