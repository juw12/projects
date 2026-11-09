# OpenForge Webhook Prior Art: Delivery Systems in Gitea, Forgejo, OneDev, GitLab CE, and Sourcehut

**Purpose**: Exhaustive mapping of every public webhook delivery system in five open-source
code hosting platforms. Feeds OpenForge's hook surface design, event schema, and delivery
service architecture.

**Method**: Source-reading of primary repositories (main/HEAD at time of clone). Every claim
is cited with `path:line` or `path:lines-a-b` referencing the cloned tree at:
`C:\Users\JUWEN_~1\AppData\Local\Temp\opencode\openforge-research\`

---

## Master Comparison Table

| Dimension | Gitea (main, 12b20c7) | Forgejo (main, bd7bb18) | OneDev (main, 219e92f) | GitLab CE (v19.5.3, 215874a1) | Sourcehut (core-go 2026-09-01) |
|---|---|---|---|---|---|
| **Transport** | POST (default), GET, PUT (Matrix) | POST (default), GET, PUT | POST only | POST only | POST only |
| **Queueing** | UniqueQueue (`webhook_sender`), in-process | UniqueQueue (`webhook_sender`), in-process | `ExecutorService.submit()` (fire-and-forget) | Sidekiq (`WebHookWorker`), Redis-backed | `dowork` queue, in-process (configurable size) |
| **Auto-retry** | **None** | **None** | **None** | Sidekiq `retry: 4` (4s/6s/30s/60s) | 5 retries (exp backoff, base 3min, cap 30min, jitter) |
| **Retry on what** | N/A | N/A | N/A | All non-2xx/3xx | 502, 503, 504 only |
| **Max retries** | 0 | 0 | 0 | 4 | 5 |
| **Dead letter** | None | None | None (app log only) | `dead: false` — auto-disable instead | None (logged) |
| **Auto-disabling** | None | None | None | Yes: temp after 3, perm after 40 failures | None |
| **Signing** | HMAC-SHA1 + SHA256 (dual, hex) | HMAC-SHA1 + SHA256 (dual, hex) | HMAC-SHA256 (hex) | HMAC-SHA256 (`v1,` + base64) | Ed25519 (base64) |
| **Replay protection** | None | None | None | Timestamp in sig + Idempotency-Key | Ed25519 nonce + Redis 90-day TTL |
| **Delivery replay (operator)** | Yes (`ReplayHookTask`) | Yes (`ReplayHookTask`) | No | No | Yes (redeliver API) |
| **Delivery log** | Yes (unbounded, configurable cleanup) | Yes (unbounded, configurable cleanup) | No | Yes (7-day partition) | Yes (unbounded) |
| **Timeout** | 5s | 5s | Default (Apache HC) | 10s | 30s |
| **Request size limit** | None | None | None | 25 MB | None |
| **Response size limit** | 1 MB | None | None | 8 KB (stored) | 256 KiB (stored) |
| **Event types** | 28 | 42 | 7 | 25 (18 project + 4 system) | 3 (git) |
| **Hook/target types** | 11 | 14 | 1 | 3 (project, system, group[EE]) | 1 (generic) |
| **Ordering guarantee** | None | None | None | None | None |
| **Rate limiting** | None | None | None | Yes (per root namespace) | None |
| **Recursion detection** | None | None | None | Yes (COUNT_LIMIT=100) | None |
| **Branch filtering** | Yes | Yes | No | Yes (wildcard/regex/all) | No |
| **Encryption at rest** | XOR or keying module | Keying module (AES-256) | Plaintext | AES-256-GCM | None |

## 1. Gitea

**Repo**: `go-gitea/gitea` (redirect of `gitea/gitea`), main branch, commit `12b20c7`.
**Clone**: `openforge-research/gitea2/`

### 1.1 Registration Model

- **Webhook struct** (`models/webhook/webhook.go`): fields include `RepoID`, `OwnerID`,
  `IsSystemWebhook`, `URL`, `HTTPMethod` (POST/GET/PUT), `ContentType` (json/form),
  `Secret` (encrypted), `Events` (array of `HookEventType`), `IsActive`, `Type`
  (one of 11 service types), `Meta`, `LastStatus`, `HeaderAuthorizationEncrypted`.
- Three scoping levels: **repository** (`RepoID`), **user/organization** (`OwnerID`),
  **system** (`IsSystemWebhook`).
- `PrepareWebhooks` in `services/webhook/webhook.go` collects matching hooks from
  repo + owner + system scope, then filters by event type and branch pattern.

### 1.2 Queue and Delivery

- **Queue type**: `queue.CreateUniqueQueue[int64]("webhook_sender")`
  (`services/webhook/deliver.go:Init`). The "unique" qualifier means duplicate task IDs
  are coalesced — at most one in-flight delivery per `HookTask.ID`.
- **Worker**: `WorkerPoolQueue[int64]` with `QueueLength = 1000` (default, configurable
  via `services.webhook.QUEUE_LENGTH` in `app.ini`).
- **Delivery function** (`Deliver` at `services/webhook/deliver.go:147`):
  1. Loads `Webhook` by ID.
  2. Selects request builder by `Webhook.Type` (e.g., Matrix uses PUT with txn_id).
  3. Builds HTTP request via `newDefaultRequest` (or type-specific builder).
  4. Attaches signing headers via `addDefaultHeaders`.
  5. Sends with timeout = `setting.Webhook.DeliverTimeout` (default **5s**).
  6. Records `IsDelivered = true` immediately before sending (crash-safe: on restart,
     `populateWebhookSendingQueue` re-enqueues undelivered tasks).
  7. **No retry**: on non-2xx response, `IsSucceed = false` is stored, the response is
     logged, and the task is terminal.

### 1.3 Crash Recovery

- `FindUndeliveredHookTaskIDs` (`models/webhook/hooktask.go`): queries tasks where
  `IsDelivered = false` AND `Delivered < now - grace_period`. Called during `Init`
  to repopulate the queue after a crash/restart.

### 1.4 Signing

`addDefaultHeaders` (`services/webhook/deliver.go:94-143`):

- HMAC-SHA1 and HMAC-SHA256 computed over the raw payload bytes using the decrypted secret.
- Headers set:
  - `X-Gitea-Delivery` = t.UUID
  - `X-Gitea-Event` = event string (e.g. "push")
  - `X-Gitea-Event-Type` = full type (e.g. "pull_request_review_approved")
  - `X-Gitea-Signature` = signatureSHA256 (hex)
  - `X-Gitea-Hook-Installation-Target-Type` = "repository"|"user"|"organization"|"system"
  - `X-Gogs-Delivery`, `X-Gogs-Event`, `X-Gogs-Event-Type`, `X-Gogs-Signature` (backward compat)
  - `X-Hub-Signature` = "sha1=" + signatureSHA1 (GitHub compat)
  - `X-Hub-Signature-256` = "sha256=" + signatureSHA256
  - `X-GitHub-Delivery`, `X-GitHub-Event`, `X-GitHub-Event-Type` (GitHub compat)
- **No timestamp or nonce is included in the signature.** Replay protection is absent.

### 1.5 Delivery Replay (Operator Action)

- `ReplayHookTask` (`services/webhook/webhook.go`): loads a `HookTask` by ID, re-creates
  the HTTP request from stored `RequestInfo` (URL, method, headers, body), sends it, and
  stores a new `HookTask` row with the new UUID. The original task is unchanged.
- Accessible via admin API: `PUT /api/v1/hook_task/{task_id}/replay`.

### 1.6 Delivery Log

- **Table**: `hook_task` (model `HookTask`, `models/webhook/hooktask.go:58-78`).
- Fields: `ID`, `HookID`, `UUID`, `PayloadContent` (LONGTEXT), `PayloadVersion` (1 or 2),
  `EventType`, `IsDelivered`, `Delivered`, `IsSucceed`, `RequestContent` (LONGTEXT),
  `ResponseContent` (LONGTEXT).
- **Retention**: configurable via `services.webhook.HOOK_TASK_CLEANUP_TYPE`:
  - `OlderThan`: delete tasks older than N days
  - `PerWebhook`: keep at most N tasks per webhook

### 1.7 Event Type Taxonomy (28 types)

`modules/webhook/type.go:10-43`:

create, delete, fork, push, issues, issue_assign, issue_label, issue_milestone,
issue_comment, pull_request, pull_request_assign, pull_request_label,
pull_request_milestone, pull_request_comment, pull_request_review_approved,
pull_request_review_rejected, pull_request_review_comment, pull_request_sync,
pull_request_review_request, wiki, repository, release, package, status,
pull_request_review, schedule, workflow_run, workflow_job

### 1.8 Hook (Service) Types (11)

`gitea`, `gogs`, `slack`, `discord`, `dingtalk`, `telegram`, `msteams`, `feishu`,
`matrix`, `wechatwork`, `packagist`

### 1.9 Configuration

`modules/setting/webhook.go`:
- `QUEUE_LENGTH` = 1000
- `DELIVER_TIMEOUT` = 5s
- `SKIP_TLS_VERIFY` = false
- `ALLOWED_HOST_LIST` = [] (SSRF protection via `egress` package)
- `PAGING_NUM` = 10
- `PROXY_URL` = ""

### 1.10 Push Payload Example

modules/structs/hook.go:349 defines `PushPayload`:

`json
{
  "ref": "refs/heads/main",
  "before": "9049f12dad0b0e5454d19ce84a1756181bb3a7b4",
  "after": "0d1a26e67d8f4eaf4f320b26abe94a50c58c5c32",
  "created": false, "deleted": false, "forced": false,
  "base_ref": "",
  "commits": [
    {
      "id": "0d1a26e67d8f4eaf4f320b26abe94a50c58c5c32",
      "message": "fix bug",
      "url": "https://gitea.com/user/repo/commit/0d1a26e...",
      "author": { "name": "Jun", "email": "jun@example.com", "username": "jun" },
      "committer": { "name": "Jun", "email": "jun@example.com", "username": "jun" },
      "added": [], "modified": ["file1"], "removed": []
    }
  ],
  "total_commits": 1,
  "repository": {
    "id": 1, "name": "repo", "full_name": "user/repo",
    "owner": { "id": 1, "login_name": "user", "full_name": "User Name" },
    "private": false, "url": "https://gitea.com/user/repo",
    "star_count": 0, "forks_count": 0, "watchers_count": 0,
    "open_issues_count": 0, "default_branch": "main",
    "html_url": "https://gitea.com/user/repo"
  },
  "pusher": { "id": 1, "login_name": "user", "full_name": "User Name" },
  "sender": { "id": 1, "login_name": "user", "full_name": "User Name" }
}
`

---

## 2. Forgejo

**Repo**: `codeberg.org/forgejo/forgejo`, main branch, commit `bd7bb18`.
**Clone**: `openforge-research/forgejo/`

### 2.1 Relationship to Gitea

Forgejo is a fork of Gitea (diverged 2022). The webhook subsystem is structurally
identical to Gitea's with the following differences:

### 2.2 Differences from Gitea

| Aspect | Gitea | Forgejo |
|---|---|---|
| Additional event types | 28 | 42 (adds Actions/workflow lifecycle events) |
| Additional hook types | 11 | 14 (adds sourcehut_builds, git_pages) |
| Signing headers | X-Gitea-* primary | X-Forgejo-* primary + X-Gitea-* compat |
| SSRF protection | egress package (allowed host list) | hostmatcher package (per-host proxy glob) |
| Response body limit | 1 MB | None |
| Secret encryption | XOR or keying module | Keying module (AES-256-GCM) |
| Payloader location | services/webhook/deliver.go | services/webhook/shared/payloader.go |

### 2.3 Additional Event Types (42 total)

`modules/webhook/type.go:11-53`. Beyond Gitea's 28, Forgejo adds:

- `workflow_dispatch`, `action_run_failure`, `action_run_success`
- `workflow_run_blocked`, `workflow_run_cancelled`, `workflow_run_failure`,
  `workflow_run_running`, `workflow_run_skipped`, `workflow_run_success`,
  `workflow_run_waiting`
- `workflow_job_blocked`, `workflow_job_cancelled`, `workflow_job_failure`,
  `workflow_job_running`, `workflow_job_skipped`, `workflow_job_success`,
  `workflow_job_waiting`

### 2.4 Additional Hook Types

- **sourcehut_builds** (`services/webhook/sourcehut/builds.go`): triggers a build
  on builds.sr.ht when a push or PR event occurs.
- **git_pages** (`services/webhook/git_pages.go`): triggers a Git Pages deployment
  rebuild when a push to the pages branch occurs.

### 2.5 Signing Headers

`services/webhook/shared/payloader.go` sets:

- `X-Forgejo-Delivery` = t.UUID
- `X-Forgejo-Event` = event string
- `X-Forgejo-Event-Type` = full type
- `X-Forgejo-Signature` = signatureSHA256 (hex)
- Plus all Gitea/Gogs/Hub/GitHub compat headers (identical to Gitea section 1.4)

### 2.6 No Retry, No Auto-Disabling

Identical to Gitea: the handler logs the failure and marks the task terminal.
No retry logic, no backoff, no auto-disabling exists anywhere in the codebase.

---

## 3. OneDev

**Repo**: `github.com/theonedev/onedev`, main branch, commit `219e92f`.
**Clone**: `openforge-research/onedev/`

### 3.1 Registration Model

- **`WebHook` entity** (`server-core/.../model/support/WebHook.java`):
  - `postUrl`: the target URL (POST only, no method choice)
  - `secret`: 40-character alphanumeric string (user-generated)
  - `eventTypes`: array of `EventType` enum values
  - `headers`: user-defined custom HTTP headers (name-value pairs)
- **Hierarchy**: webhooks are defined on a project and inherited from ancestor
  folders (`getHierarchyWebHooks()` walks the project tree upward).

### 3.2 Event Type Taxonomy (7 types)

`WebHook.EventType` enum:

| Value | Includes |
|---|---|
| `CODE_PUSH` | `RefUpdated` events |
| `PULL_REQUEST` | `PullRequestUpdated` events |
| `ISSUE` | `IssueUpdated` events |
| `CODE_COMMENT` | `CodeCommentUpdated` events |
| `BUILD` | `BuildFinished` events |
| `PACKAGE` | `PackageCreated` events |
| `WORKSPACE` | `WorkspaceUpdated` events |

### 3.3 Delivery Mechanism

`WebHookManager.java` (full file, 89 lines):

1. Listens to all `ProjectEvent` instances via `@Listen` annotation (line 46-47).
2. Serializes the event to JSON bytes using Jackson (line 50).
3. Iterates `event.getProject().getHierarchyWebHooks()` (line 55).
4. For each matching hook, submits a lambda to `executorService` (line 58)
   -- fire-and-forget, no queue, no tracking.
5. Inside the lambda:
   - Creates a default Apache `HttpClients` instance (line 59).
   - Builds `HttpPost` to `webHook.getPostUrl()` (line 60).
   - Sets `Content-Type: application/json`, `Accept: application/json`.
   - Applies user-defined custom headers (line 67-68).
   - Sets `X-OneDev-Signature` = hex(HMAC-SHA256(secret, eventBody)) (lines 70-71).
   - Executes the POST (line 73).
   - **If response is not 200**: logs an error. **No retry.** (line 76-77)
   - **If IOException**: logs the exception. **No retry.** (line 79-81)

### 3.4 What Is Absent

- **No delivery log table**: no persistence of individual delivery attempts.
- **No replay mechanism**: once delivered (or failed), the event is gone.
- **No dead letter queue**: failures are only in the application log.
- **No retry**: single attempt, terminal on failure.
- **No timeout configuration**: uses Apache HttpClient defaults.
- **No rate limiting**: unbounded concurrent deliveries.
- **No ordering guarantee**: `ExecutorService.submit()` provides no ordering.

### 3.5 Signing

- Algorithm: HMAC-SHA256
- Key: the 40-char `secret` field (UTF-8 bytes)
- Message: the exact JSON bytes sent as request body
- Header: `X-OneDev-Signature` (hex-encoded digest)
- No timestamp, no nonce, no replay protection.

### 3.6 Push Event Payload Example

The `RefUpdated` event serialized:

```json
{
  "event": "refUpdated",
  "refName": "refs/heads/main",
  "oldCommitId": "9049f12dad0b0e5454d19ce84a1756181bb3a7b4",
  "newCommitId": "0d1a26e67d8f4eaf4f320b26abe94a50c58c5c32",
  "user": { "loginName": "admin", "name": "Admin" },
  "date": "2025-06-15T10:30:00.000Z",
  "project": { "name": "my-project", "path": "my-project" }
}
```

---

## 4. GitLab CE

**Repo**: `github.com/sonicxs/gitlab-foss-v19.5.3` (mirror), commit `215874a1`.
**Note**: this mirror does NOT include the `ee/` directory. GroupHook details are
partially unavailable (cited from schema/comments only).
**Clone**: `openforge-research/gitlab/`

### 4.1 Registration Model

Three hook types (in CE):

| Type | Model | Scope | Available Triggers |
|---|---|---|---|
| `ProjectHook` | `app/models/hooks/project_hook.rb` | Single project | 18 triggers |
| `SystemHook` | `app/models/hooks/system_hook.rb` | Instance-wide | 4 triggers |
| `GroupHook` | `ee/app/models/hooks/group_hook.rb` | Group (EE only) | 18+ triggers |

#### ProjectHook Triggers (18)

`app/models/hooks/project_hook.rb` `AVAILABLE_HOOKS`:

confidential_issue, deployment, emoji, feature_flag, issue, job, member,
merge_request, milestone, note, pipeline, push, release, repository_update,
tag_push, wiki_page, resource_access_token, resource_deploy_token

#### SystemHook Triggers (4)

`app/models/hooks/system_hook.rb` `AVAILABLE_HOOKS`:

repository_update, push, tag_push, merge_request

### 4.2 Queue and Delivery

- **Worker**: `WebHookWorker` (`app/workers/web_hook_worker.rb`):
  - `sidekiq_options retry: 4, dead: false` (line 11)
  - `urgency :low`
  - `worker_has_external_dependencies!` (line 14)
  - `perform(hook_id, data, hook_name, params)` calls `WebHookService`

- **Sidekiq retry**: 4 retries with default intervals (4s, 6s, 30s, 60s, +/-15% jitter).
  **No dead letter queue**: `dead: false` means jobs are silently discarded after
  all retries are exhausted.

- **Service** (`app/services/web_hook_service.rb`):
  - `REQUEST_BODY_SIZE_LIMIT = 25.megabytes` (line 32)
  - `RESPONSE_BODY_SIZE_LIMIT = 8.kilobytes` (line 35)
  - `RESPONSE_HEADERS_COUNT_LIMIT = 50` (line 37)
  - Timeout: `Gitlab.config.gitlab.webhook_timeout` (default **10s**)
  - Always POST (line 163: `Gitlab::HTTP.post`)
  - Supports Basic Auth via URL userinfo (lines 172-178)
  - `allow_local_requests?` per-hook flag for SSRF control (line 60)

### 4.3 Auto-Disabling (Backoff)

`app/models/concerns/web_hooks/auto_disabling.rb` (full file, 170 lines):

**Constants**:
- `ENABLED_HOOK_TYPES = %w[ProjectHook]` (line 8) -- only project hooks
- `TEMPORARILY_DISABLED_FAILURE_THRESHOLD = 3` (line 10)
- `PERMANENTLY_DISABLED_FAILURE_THRESHOLD = 39` (line 15)
- `INITIAL_BACKOFF = 1.minute` (line 17)
- `MAX_BACKOFF = 1.day` (line 18)
- `BACKOFF_GROWTH_FACTOR = 2.0` (line 19)

**Behavior**:
1. First 3 failures: webhook remains executable (grace period).
2. Failure #4+: webhook is **temporarily disabled** for a backoff period:
   - `backoff = INITIAL_BACKOFF * (2 ^ (recent_failures - 3))`, clamped [1min, 1day]
   - Example: failure 4 -> 1min, 5 -> 2min, 6 -> 4min, ... 16+ -> 1day
3. Failure #40+: webhook is **permanently disabled** (`recent_failures > 39`).
4. On successful delivery: `enable!` resets `recent_failures = 0`, `disabled_until = nil`.
5. **Feature-flagged**: `auto_disabling_web_hooks` (type: :ops) -- off by default in
   self-managed, on by default in GitLab.com.

**Key insight**: The auto-disable mechanism is **separate from Sidekiq retries**. A
single "failure" that triggers `backoff!` has already exhausted all 4 Sidekiq retries.
Effective: 4 Sidekiq retries per trigger event, and auto-disable kicks in after 3+
such fully-exhausted triggers.

**Redis caching** (`app/models/concerns/web_hooks/has_web_hooks.rb`): webhook
disabled/enabled state is cached in Redis with 1-hour TTL to avoid DB hits on every
event dispatch.

### 4.4 Signing

`app/services/web_hook_service.rb:252-257` (`build_signature`):

```ruby
raw_key = Base64.strict_decode64(hook.signing_token.delete_prefix("whsec_"))
data = "#{message_id}.#{timestamp}.#{encoded_request_body}"
digest = OpenSSL::Digest.new('SHA256')
"v1,#{Base64.strict_encode64(OpenSSL::HMAC.digest(digest, raw_key, data))}"
```

- **Token format**: `whsec_` + 44 base64 characters (32 raw bytes)
- **Signed data**: `{idempotency_key}.{unix_timestamp}.{json_body}`
- **Output**: `"v1," + base64(HMAC-SHA256(raw_key, data))`
- **Versioned**: the `v1,` prefix allows future algorithm upgrades.
- **Header**: `webhook-signature`

**This is the only system in this comparison that includes a timestamp in the signed
data**, enabling receivers to reject stale replays based on the signed timestamp.

### 4.5 Idempotency and Replay Protection

- **`Idempotency-Key` header** (line 234): a UUID generated per delivery attempt
  (`SecureRandom.uuid`). Same value used as `webhook-id` header and as the
  `message_id` component of the signature.
- **`webhook-timestamp` header** (line 238): Unix epoch seconds at time of signing.
- Together, the signature binds `id + timestamp + body`. A replayed request with
  the same body but different timestamp would fail verification. However, GitLab
  does NOT implement server-side nonce tracking -- it relies on the receiver to
  check freshness.

### 4.6 Delivery Log

`app/models/hooks/web_hook_log.rb` (full file, 140 lines):

- **Table**: `web_hook_logs_daily`
- **Partitioning**: daily by `created_at`, retained for **7 days**, detached
  partitions kept for 2 more days (line 16).
- **Fields**: `trigger`, `url` (sanitized), `url_hash`, `execution_duration`,
  `request_headers`, `request_data`, `response_headers`, `response_body`,
  `response_status`, `internal_error_message`.
- **Success check**: `response_status =~ /^2/` (line 74).
- **Oversize handling**: if `request_data` exceeds Sidekiq message size limit,
  replaced with `{'oversize' => true}` (line 9, lines 209-215 in service).
- **Redaction**: Basic Auth in URL masked, user emails in `request_data` replaced
  with `[REDACTED]` (lines 119-127). `X-Gitlab-Token` always redacted in read path.
- **Access**: `recent(days)` scope limited to 7 days max (line 42).

### 4.7 Rate Limiting

`lib/gitlab/web_hooks/rate_limiter.rb`:
- Limit name: `:web_hook_calls`
- Scoped per **root namespace** (top-level project group)
- `SystemHook` and `ServiceHook` (external integrations) are **excluded**
- Feature-flagged: `no_webhook_rate_limit` (can disable)

### 4.8 Recursion Detection

`lib/gitlab/web_hooks/recursion_detection.rb`:
- `COUNT_LIMIT = 100`: max 100 webhooks can be triggered by a single request chain
- `TOUCH_CACHE_TTL = 30.minutes`: Redis cache for seen webhook IDs
- Prevents infinite loops: A -> B -> A -> B -> ...
- Header: `X-Gitlab-Recursion-Detection` (UUID per request chain)
- `register!` called before each delivery; `block?` checks the count.

### 4.9 Request Headers (Full Set)

From `build_headers` (lines 227-249) and `lib/gitlab/web_hooks.rb`:

```
Content-Type: application/json
User-Agent: GitLab/{version}
Idempotency-Key: {uuid}
X-Gitlab-Event: {trigger name, titleized}
X-Gitlab-Webhook-UUID: {uuid}
X-Gitlab-Instance: {base_url}
webhook-timestamp: {unix_epoch}
webhook-id: {idempotency_key}
X-Gitlab-Token: {hook.token}            (if set, legacy)
webhook-signature: v1,{base64_hmac}     (if signing_token set)
X-Gitlab-Recursion-Detection: {uuid}    (recursion detection)
+ custom_headers (if configured)
```

### 4.10 Branch Filtering

`app/models/concerns/web_hooks/hook.rb`:
- `branch_filter_strategy`: enum (`wildcard`, `regex`, `all_branches`)
- `branch_filter_value`: the pattern (e.g., `main*` or `^release/`)
- Applied in `triggerable_hooks.rb` before queuing the webhook.

### 4.11 Encryption at Rest

`app/models/concerns/web_hooks/hook.rb`:
- `url`, `token`, `url_variables` columns encrypted using **AES-256-GCM**
  via GitLab's `Gitlab::CryptoHelper`.
- Encryption key derived from the instance's secret key base.
- Token reset: changing the URL triggers `reset_token` (generates new random token).

### 4.12 Push Payload Example

`lib/gitlab/data_builder/push.rb` `SAMPLE_DATA`:

```json
{
  "object_kind": "push",
  "event_name": "push",
  "before": "95790bf891e76fee5e1747ab589903a6a1f80f22",
  "after": "11830c7423827ca1d1c6c9ac00e65bb508b3b307",
  "ref": "refs/heads/main",
  "checkout_sha": "11830c7423827ca1d1c6c9ac00e65bb508b3b307",
  "user_id": 4,
  "user_name": "John Smith",
  "user_username": "jsmith",
  "user_email": "john@example.com",
  "project_id": 15,
  "project": {
    "id": 15, "name": "Diaspora",
    "web_url": "http://example.com/gitlab-path/project/diaspora",
    "namespace": { "id": 2, "name": "GitLab Project", "path": "gitlab-project" },
    "visibility_level": 0, "default_branch": "main"
  },
  "repository": {
    "name": "Diaspora",
    "url": "git@example.com:gitlab-path/project/diaspora.git",
    "git_http_url": "http://example.com/gitlab-path/project/diaspora.git"
  },
  "commits": [
    {
      "id": "b65d419dd6bf9c5f15d3fa1d7eb2f6fe30f05976",
      "message": "Add changelog link",
      "timestamp": "2011-01-14T12:54:42Z",
      "url": "http://example.com/.../commit/b65d419...",
      "author": { "name": "Jordi Mallach", "email": "jordi@softcatala.org" }
    }
  ],
  "total_commits_count": 41
}
```

---

## 5. Sourcehut

**Architecture note**: Sourcehut's webhook system is split across two implementations:
- **Go services** (git.sr.ht, todo.sr.ht, lists.sr.ht, etc.) use `core-go/webhooks`
  with the `dowork` task queue.
- **Python services** (older) use `srht.webhook` (synchronous delivery).
- **hub.sr.ht** is the **consumer** of inter-service webhooks, not a producer of
  user-facing webhooks. It verifies incoming Ed25519 signatures and dispatches to
  service-specific handlers.

**Clones**: `openforge-research/core-go/`, `openforge-research/dowork/`,
`openforge-research/hub.sr.ht/`, `openforge-research/git.sr.ht/`,
`openforge-research/apks/py3-srht/`

### 5.1 Go Webhook System (core-go)

**Package**: `git.sr.ht/~sircmpwn/core-go/webhooks` (v0.0.0-20260901083148)

#### 5.1.1 Queue Architecture

`webhooks/queue.go` (full file, 275 lines):

- **`WebhookQueue`** struct (line 26-29): wraps a `dowork.Queue` and a GraphQL schema.
- **`NewQueue`** (line 46-49): creates queue with configurable size
  (`[webhooks] queue-size` in INI, default from `config.DefaultQueueSize`).
- **`Schedule`** (line 66-72): entry point. Called by the application after an event.
  1. Fetches all matching subscriptions from PostgreSQL (line 86).
  2. Filters by event type (`? = ANY(sub.events)`) and expiry (line 141, 157).
  3. For each subscription, creates a delivery record in `gql_<name>_wh_delivery`
     table (lines 183-194).
  4. Creates a `dowork.Task` with `.Retries(5)` (line 198).
  5. Enqueues all tasks (line 117-119).

#### 5.1.2 Delivery

`deliverPayload` (lines 210-275):

- **HTTP client timeout**: 30 seconds (hardcoded, line 215).
- **Method**: POST only (line 219).
- **Headers**:
  - `Content-Type: application/json`
  - `User-Agent: SourceHut core-go (...) webhook queue`
  - `X-Webhook-Event: {event_name}`
  - `X-Webhook-Delivery: {payload_uuid}`
  - `X-Payload-Nonce: {nonce}` (from `crypto.SignWebhook`)
  - `X-Payload-Signature: {signature}` (from `crypto.SignWebhook`)
- **Response body**: capped at 256 KiB (line 242: `io.LimitReader(resp.Body, 262144)`).
- **Delivery record update**: stores `response_body`, `response_status`,
  `response_headers` in the `gql_<name>_wh_delivery` table (lines 249-264).
- **Retry condition**: only 502, 503, 504 trigger a retry (lines 266-271). Any other
  status code (including 500, 4xx, connection errors) is **terminal** -- the delivery
  is recorded but not retried.

#### 5.1.3 Retry / Backoff (dowork)

`dowork/task.go`:

- **`NewTask`**: default `baseDuration = 1min`, `jitter = true`, `maxAttempts = 1`.
- **`.Retries(n)`**: sets `maxAttempts = n` (here: 5).
- **Backoff formula**: exponential with jitter:
  - `delay = baseDuration * 2^(attempt-1)` with random jitter
  - `baseDuration` = `maxTimeout / 10` (default `maxTimeout = 30min`, so base = 3min)
  - **Effective backoff schedule** (with base 3min): ~3min, ~6min, ~12min, ~24min
  - **Cap**: `maxTimeout = 30min` per attempt.
- **Total worst-case time**: 5 attempts x 30min timeout + backoff delays = ~2+ hours.

#### 5.1.4 Signing (Ed25519)

`core-go/crypto/` (referenced from `webhooks/queue.go:232`):

```go
nonce, sig := crypto.SignWebhook(payload)
req.Header.Add("X-Payload-Nonce", nonce)
req.Header.Add("X-Payload-Signature", sig)
```

From `apks/py3-srht/.../srht/crypto.py` (the Python equivalent, which documents
the protocol):

- **Key type**: Ed25519 keypair (one per service).
- **Nonce**: 8 random bytes, hex-encoded (16 hex chars).
- **Signature**: Ed25519 signature over `payload || nonce` (concatenation).
- **Headers**:
  - `X-Payload-Nonce`: hex string of 8 random bytes
  - `X-Payload-Signature`: base64-encoded Ed25519 signature
- **Replay protection** (consumer side, `verify_request_signature`):
  - Nonce is checked against Redis with **90-day TTL**.
  - If nonce already seen -> reject as replay.
  - This is **server-side nonce tracking** (unique among the 5 platforms).

#### 5.1.5 Delivery Record

Table: `gql_<name>_wh_delivery` (e.g., `gql_git_wh_delivery`, `gql_profile_wh_delivery`).

Fields (from `git.sr.ht/api/graph/model/webhooks.go`):
- `id` (PK)
- `uuid` (payload UUID, shared across all deliveries for the same event)
- `date` (timestamp, UTC)
- `event` (event name string)
- `subscription_id` (FK to `gql_<name>_wh_sub`)
- `request_body` (JSON, truncated to 65536 chars in Python impl)
- `response_body` (capped 256 KiB in Go impl)
- `response_headers` (raw HTTP header text)
- `response_status` (int)

#### 5.1.6 Event Types (git.sr.ht)

From `git.sr.ht/api/webhooks/webhooks.go` and GraphQL queries in `hub.sr.ht`:

- `GIT_POST_RECEIVE` (push)
- `REPO_UPDATE` (repository metadata change)
- `REPO_DELETED`

Other services have their own event sets (e.g., `TODO_CREATED`, `LISTS_RECEIVED`).

#### 5.1.7 Redeliver (Operator Action)

From `apks/py3-srht/.../srht/webhook/webhook.py` (Python implementation):

- API endpoint: `POST /api/vN/<service>/webhooks/<sub_id>/deliveries/<delivery_id>/redeliver`
- Re-sends the stored `request_body` to the subscription URL.
- Creates a new delivery record for the re-delivery.

The Go implementation (core-go) does not appear to have a redeliver endpoint in the
cloned code. This may be in service-specific code rather than core.

### 5.2 Python Webhook System (srht.webhook)

**Package**: `srht.webhook` (from `py3-srht` Alpine package, Python 3.12)

`webhook/webhook.py`:

- **`Webhook`** base class with metaclass `WebhookMeta`.
- **`deliver`**: synchronous, inline (no queue). Queries subscriptions, iterates, sends.
- **`prepare_headers`**: sets `X-Webhook-Event`, `X-Webhook-Delivery` (UUID),
  plus Ed25519 signature headers.
- **`notify`**: creates a `Delivery` row, truncates payload to 65536 chars.
- **`process_delivery`**: `requests.post(url, data=payload, timeout=5)` --
  **5s timeout**, **no retry**.
- **API**: CRUD for subscriptions + `POST .../deliveries/<id>/redeliver`.

This is the **older/simpler** implementation. The Go `core-go/webhooks` is the
modern replacement with queueing, retries, and PostgreSQL delivery records.

### 5.3 hub.sr.ht (Consumer Side)

`hub.sr.ht/api/graph/webhooks.go`:

- **Versioned protocol**: each service's webhook has a version number:
  - `GIT_WEBHOOK_VERSION = 4`
  - `HG_WEBHOOK_VERSION = 3`
  - `LISTS_WEBHOOK_VERSION = 7`
  - `TODO_WEBHOOK_VERSION = 3`
- **`GetWebhookURL`**: constructs the internal webhook endpoint URL
  (`https://hub.sr.ht/api/webhooks/<service>/`).
- **`dedupeEvent`** (`hub.sr.ht/api/webhooks/webhooks.go`): deduplicates incoming
  events by `(event_type, source, url, user)` -- prevents double-processing.

`hub.sr.ht/hubsrht/blueprints/webhooks.py`:

- Flask Blueprint handling incoming webhook POSTs.
- Verifies signature via `verify_request_signature` (Ed25519 + nonce check).
- Dispatches to service-specific handlers.

### 5.4 Subscription Model

`git.sr.ht/api/graph/model/webhooks.go`:

- **`UserWebhookSubscription`** (`gql_user_wh_sub`): per-user, per-service
  (git, hg, lists, todo) webhook subscription with URL, events, auth config.
- **`GitWebhookSubscription`** (`gql_git_wh_sub`): per-repository subscription
  (overrides user-level for specific repos).
- **Auth methods**: none, token (hashed), OAuth (client_id + grants + expires).

### 5.5 No Rate Limiting, No Recursion Detection, No Auto-Disabling

None of these mechanisms exist in the Sourcehut webhook system.

---

## 6. Cross-Platform Observations

### 6.1 Retry Strategies

| Platform | Retries | Backoff | Retry Trigger | Dead Letter |
|---|---|---|---|---|
| Gitea | 0 | N/A | N/A | None |
| Forgejo | 0 | N/A | N/A | None |
| OneDev | 0 | N/A | N/A | None (app log only) |
| GitLab CE | 4 (Sidekiq) | 4s/6s/30s/60s + jitter | All non-2xx/3xx | None (`dead: false`) |
| Sourcehut (Go) | 5 | 3min/6min/12min/24min (exp, jitter) | 502/503/504 only | None (logged) |

**Key insight**: GitLab retries aggressively on ANY failure (including 4xx client errors),
while Sourcehut retries conservatively only on transient gateway errors (502/503/504).
Gitea/Forgejo/OneDev do not retry at all -- a failed delivery is terminal.

### 6.2 Replay Protection

| Platform | Mechanism | Server-side tracking? |
|---|---|---|
| Gitea | None | No |
| Forgejo | None | No |
| OneDev | None | No |
| GitLab CE | Timestamp in signature + `Idempotency-Key` | No (receiver must check) |
| Sourcehut | Ed25519 nonce + Redis 90-day TTL | **Yes** (server tracks nonces) |

**Key insight**: Sourcehut is the only platform with true server-side replay protection.
GitLab's approach is "cryptographically possible but receiver's responsibility."
Gitea/Forgejo/OneDev offer no replay protection whatsoever.

### 6.3 Delivery Log Retention

| Platform | Retention | Storage |
|---|---|---|
| Gitea | Configurable (time or count) | PostgreSQL `hook_task` |
| Forgejo | Configurable (time or count) | PostgreSQL `hook_task` |
| OneDev | None | N/A |
| GitLab CE | 7 days (auto-partition) | PostgreSQL `web_hook_logs_daily` |
| Sourcehut | Unbounded | PostgreSQL `gql_<name>_wh_delivery` |

### 6.4 Ordering Guarantees

**None of the five platforms provide ordering guarantees** for webhook deliveries.
All use at-least-once or at-most-once semantics with no sequence numbers or ordering
within an event stream. Events for the same repository/project can be delivered out of
order or concurrently.

### 6.5 Event Type Taxonomy Comparison

| Category | Gitea | Forgejo | OneDev | GitLab CE | Sourcehut |
|---|---|---|---|---|---|
| Push | push | push | CODE_PUSH | push | GIT_POST_RECEIVE |
| Tag | (in push) | (in push) | (in push) | tag_push | (in REPO_UPDATE) |
| Issues | issues, issue_* (4) | issues, issue_* (4) | ISSUE | issue, confidential_issue | N/A |
| PR/MR | pull_request, pr_* (7) | pull_request, pr_* (7) | PULL_REQUEST | merge_request | N/A |
| Release | release | release | N/A | release | N/A |
| Wiki | wiki | wiki | N/A | wiki_page | N/A |
| Pipeline/CI | workflow_run, workflow_job | workflow_* (17) | BUILD | pipeline, job | N/A |
| Package | package | package | PACKAGE | N/A | N/A |
| Repository | create, delete, fork, repository | same | N/A | repository_update, project, subgroup | REPO_UPDATE, REPO_DELETED |
| Membership | N/A | N/A | N/A | member | N/A |
| Other | status, package | + action_run_* | WORKSPACE | emoji, feature_flag, deployment, vulnerability, resource_* | N/A |
| **Total** | **28** | **42** | **7** | **25** | **3** (git) |

### 6.6 Payload Envelope

| Platform | Envelope? | Fields |
|---|---|---|
| Gitea | No (raw event JSON) | N/A |
| Forgejo | No (raw event JSON) | N/A |
| OneDev | No (raw event JSON) | N/A |
| GitLab CE | No (raw event JSON) | N/A |
| Sourcehut | No (raw event JSON via GraphQL resolver) | N/A |

**None of the platforms use a CloudEvents or similar standard envelope.** All send the
raw event JSON directly. Event identification is via HTTP headers (`X-Gitea-Event`,
`X-Gitlab-Event`, `X-Webhook-Event`).

### 6.7 Implications for OpenForge

1. **Retry**: If OpenForge wants at-least-once delivery, it must implement its own
   retry queue. GitLab's Sidekiq approach (4 retries, short backoff) is the most
   battle-tested open-source pattern. Sourcehut's conservative approach (only 502/503/504)
   avoids hammering permanently broken receivers.

2. **Replay protection**: Sourcehut's Ed25519 + server-side nonce is the strongest.
   GitLab's timestamp-in-signature is practical but requires receiver cooperation.
   Gitea/Forgejo/OneDev offer nothing.

3. **Delivery log**: GitLab's 7-day partitioned log is a good balance of utility vs.
   storage cost. Gitea's unbounded log with configurable cleanup is simpler but riskier.

4. **Event taxonomy**: Forgejo's 42-event taxonomy (especially the workflow lifecycle
   events) is the most granular. If OpenForge supports CI/CD, this is the model to follow.

5. **No standard envelope**: All five platforms use ad-hoc JSON with HTTP headers for
   event identification. If OpenForge adopts CloudEvents or a similar standard, it would
   be differentiated from all five.

6. **Ordering**: No platform provides ordering. If OpenForge needs ordering (e.g., for
   sequential pipeline events), it must implement sequence numbers per subscription.

7. **Auto-disabling**: GitLab's backoff-based auto-disabling is the only production-
   tested mechanism to prevent hammering dead endpoints. If OpenForge has retries,
   this is a critical companion feature.

---

## 7. Source References

| Platform | Primary Source Files |
|---|---|
| Gitea | `services/webhook/deliver.go`, `services/webhook/webhook.go`, `models/webhook/webhook.go`, `models/webhook/hooktask.go`, `modules/webhook/type.go`, `modules/setting/webhook.go`, `modules/structs/hook.go` |
| Forgejo | `services/webhook/deliver.go`, `services/webhook/shared/payloader.go`, `services/webhook/webhook.go`, `services/webhook/sourcehut/builds.go`, `services/webhook/git_pages.go`, `modules/webhook/type.go`, `modules/setting/webhook.go` |
| OneDev | `server-core/src/main/java/io/onedev/server/notification/WebHookManager.java`, `server-core/src/main/java/io/onedev/server/model/support/WebHook.java`, `server-core/src/main/java/io/onedev/server/event/project/RefUpdated.java` |
| GitLab CE | `app/workers/web_hook_worker.rb`, `app/services/web_hook_service.rb`, `app/models/concerns/web_hooks/auto_disabling.rb`, `app/models/concerns/web_hooks/hook.rb`, `app/models/concerns/web_hooks/has_web_hooks.rb`, `app/models/concerns/triggerable_hooks.rb`, `app/models/hooks/project_hook.rb`, `app/models/hooks/system_hook.rb`, `app/models/hooks/web_hook_log.rb`, `app/services/web_hooks/log_execution_service.rb`, `lib/gitlab/web_hooks.rb`, `lib/gitlab/web_hooks/rate_limiter.rb`, `lib/gitlab/web_hooks/recursion_detection.rb`, `lib/gitlab/data_builder/push.rb`, `config/initializers/1_settings.rb` |
| Sourcehut | `core-go/webhooks/queue.go`, `core-go/webhooks/middleware.go`, `core-go/webhooks/config.go`, `dowork/task.go`, `dowork/queue.go`, `git.sr.ht/api/graph/model/webhooks.go`, `git.sr.ht/api/webhooks/webhooks.go`, `hub.sr.ht/api/graph/webhooks.go`, `hub.sr.ht/api/webhooks/webhooks.go`, `hub.sr.ht/hubsrht/blueprints/webhooks.py`, `apks/py3-srht/.../srht/crypto.py`, `apks/py3-srht/.../srht/webhook/webhook.py` |

---

*Report generated 2026-11-03. All source references are to the cloned trees in*
*`C:\Users\JUWEN_~1\AppData\Local\Temp\opencode\openforge-research\`.*
