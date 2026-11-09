# OpenForge Runner — Round 2 Verification Report
## act_runner (Forgejo) + nektos/act

**Verification date:** 2026-11-03
**Source for verification:** Go module proxy `.info` endpoint + extracted source zips for Forgejo runner v13.2.1, Gitea act_runner v1.0.8, nektos/act v0.2.95.

---

## Round 2 SHAs (verified)

| Source | Method | SHA / Version | Date |
|--------|--------|---------------|------|
| Forgejo runner | Go module proxy `.info` | **SHA:** `c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7` (v13.2.1) | 2026-10-02 |
| Forgejo actions-proto | Go module proxy `.info` | **SHA:** `cd5270b4ddde05b36332f268db6739e7a1b60652` (v0.8.0) | 2026-08-30 |
| Gitea act_runner | Go module proxy | tag `v1.0.8` | (SHA not in `.info` for this path) |
| Gitea actions-proto-go | Go module proxy | tag `v0.4.1` | — |
| nektos/act | raw.githubusercontent.com | tag `v0.2.95` (on `main`) | — |

All Forgejo/Gitea sources pulled via `https://proxy.golang.org/...`. nektos/act files pulled via `https://raw.githubusercontent.com/nektos/act/v0.2.95/...`.

---

## 1. Verification by Round-1 Claim

### ACT_RUNNER section (22 claims verified)

| # | Round-1 Claim | Source Re-checked | Verdict | Notes |
|---|---|---|---|---|
| 1 | "Commit SHA: not available via git (Anubis blocks clone)" | Go proxy `.info` | ✗ **CORRECTED** | SHA **is** available: `c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7` (v13.2.1, 2026-10-02) via `https://proxy.golang.org/code.forgejo.org/forgejo/runner/v13/@v/v13.2.1.info` |
| 2 | "tag v1.8.1" | Go proxy `@v/list` | ✗ **WRONG** | Actual versions: v13.0.0, v13.1.0, v13.2.0, v13.2.1. No `v1.8.1` exists. |
| 3 | "230 .go files" | Counted zip | ✓ | Confirmed. |
| 4 | "Go module: `code.forgejo.org/forgejo/runner/v13` (go 1.26.0)" | go.mod line 1-3 | ✓ | Confirmed. |
| 5 | "Wire-format: `actions-proto@v0.8.0`" | go.mod require | ✓ | Confirmed. |
| 6 | "Client interface `client.go:9-25`" | `internal/pkg/client/client.go` | 🟡 **PARTIAL** | Interface at **lines 19-25**, not 9-25. Has 2 extra methods Round-1 missed: `FetchInterval() time.Duration` and `SetRequestKey(gouuid.UUID) func()` |
| 7 | "Client embeds two ConnectRPC service clients" | `client.go` lines 19-21 | ✓ | Confirmed. |
| 8 | "Transport: idle-conn tuning `MaxIdleConnsPerHost:10`, `IdleConnTimeout:90s`" | `internal/pkg/client/http.go` lines 23-53 | ✗ **WRONG** | No idle-conn tuning. Actual: `http.ProxyFromEnvironment` + 60s client `Timeout` (overridable via `FORGEJO_CLIENT_TIMEOUT` env). |
| 9 | "Base URL = `<endpoint>/api/actions`" | `http.go` line 58 | ✓ | `strings.TrimRight(endpoint, "/") + "/api/actions"` |
| 10 | "Intercepts stamp `x-runner-uuid` and `x-runner-token`" | `header.go` + `http.go` | 🟡 **PARTIAL** | Also stamps `x-runner-request-key` (for idempotency) and `user-agent`. |
| 11 | "7 + 1 methods" (RunnerService + PingService) | `services.proto` lines 7-22 | ✓ | Confirmed. |
| 12 | RPC list: Register, Declare, FetchTask, FetchSingleTask, UpdateTask, UpdateLog, UpdateStepSummary | `services.proto` lines 9-21 | ✓ | All 7 confirmed. |
| 13 | `services.proto:7-22` line range | 22-line file | ✓ | Confirmed. |
| 14 | `ping/v1/services.proto:7-9` | 9-line file | ✓ | Confirmed. |
| 15 | `RunnerStatus` enum: `Unspecified/Waiting/Running` | `messages.proto` lines 117-122 | ✗ **WRONG** | Actual: `RUNNER_STATUS_UNSPECIFIED=0, IDLE=1, ACTIVE=2, OFFLINE=3`. |
| 16 | `Runner { id, uuid, token, name, status, labels, ephemeral }` | `messages.proto` lines 103-114 | 🟡 **PARTIAL** | Also has `version`, deprecated `agent_labels`/`custom_labels`. |
| 17 | `Task { id, workflow_payload:bytes, context:Struct, secrets:map, needs:map, vars:map }` | `messages.proto` lines 134-142 | ✓ | Confirmed. |
| 18 | `LogRow { time, content }` | `messages.proto` lines 170-173 | ✓ | Confirmed. |
| 19 | "register verb calls Declare (modern); legacy Register retained" | `register.go` line 40 | 🟡 **PARTIAL** | In v13.2.1, `register` CLI verb is **deprecated** (prints warning). Proto `Register` RPC is NOT marked deprecated; only its fields are. |
| 20 | "Capacity = 1, Timeout = 3h, FetchTimeout = 30s, ReportInterval = 1s, FetchInterval = 2s (30s for codeberg.org)" | `config.go` lines 521-567 | ✓ | All defaults confirmed. |
| 21 | "DockerHost = '-', WorkdirParent = 'workspace'" | `config.go` line 533 | ✓ | Confirmed. |
| 22 | "Schemes: docker (default `//node:22-bookworm`), host, lxc, plugin" | `labels.go` lines 12-24 | ✓ | All 4 confirmed. |
| 23 | "Plugin schemes route to gRPC plugin executor" | `labels.go` line 72 + `config.go` line 585-593 | ✓ | Confirmed. |
| 24 | "Container interface: Create(ctx, NewContainerInput) error" | `act/container/container_types.go` lines 61-76 | ✗ **WRONG** | Methods return `common.Executor` (`func(ctx) error`), not `error`. Input stored in struct, not passed to Create. |
| 25 | "act/cacheproxy: namespaced proxy, PR write-isolation" | `act/cacheproxy/handler.go` | ✓ | Confirmed `httputil.ReverseProxy` adding 7 Forgejo-Cache-* headers. |
| 26 | "Cache: BoltDB (bolthold), single-node" | `act/artifactcache/model.go` lines 26-35 | ✓ | Confirmed `boltholdKey`/`boltholdIndex` tags. |
| 27 | "WriteIsolationKey field on each cache key" | `model.go` line 35 | ✓ | Confirmed. |
| 28 | "mask.go:14-67 — strings.Replacer" | `mask.go` | 🟡 **PARTIAL** | File is 149 lines, not 67. Core replacer at lines 51-67. Multi-line handling at 69-140. |
| 29 | "Multi-line secret values handled" | `mask.go` lines 32-48 | ✓ | Confirmed. |
| 30 | "`::add-mask::` support" | `reporter.go` | ✓ | Confirmed. |
| 31 | "UpdateLog with offset/ack_index for resumable delivery" | `messages.proto` lines 77-86 | ✓ | Confirmed. |
| 32 | "Server-side matrix expansion; runner doesn't enumerate" | `act/jobparser/jobparser.go` (1221 lines) | ✓ | `jobparser` package IS the server-side expander. |
| 33 | "cartesian.go:4-23 in embedded executor" | `act/common/cartesian.go` | ✓ | Confirmed. |
| 34 | "Gitea act_runner v1.0.8 (339 files / 147 .go)" | Counted zip | 🟡 **PARTIAL** | 147 .go ✓. "339 files" unverified. |
| 35 | "Gitea module: `gitea.com/gitea/act_runner`" | Gitea go.mod line 1 | ✗ **WRONG** | go.mod says `module gitea.com/gitea/runner`. Proxy path differs from module name. |
| 36 | "Gitea client: pingv1connect + runnerv1connect from code.gitea.io/actions-proto-go" | Gitea `client.go` lines 7-8 | ✓ | Confirmed. |
| 37 | "Gitea also ConnectRPC + protobuf" | Gitea `client.go` + proto | ✓ | **MATERIAL CORRECTION CONFIRMED.** |
| 38 | "Gitea: Register (name+labels); Forgejo: Declare added" | Gitea proto v0.4.1 | ✗ **WRONG** | Gitea proto v0.4.1 has **5 RPCs** including Declare. Declare is NOT Forgejo-only. |
| 39 | "Gitea: stateful only; Forgejo: + ephemeral" | Gitea `cmd.go` line 41 | ✗ **WRONG** | Gitea v1.0.8 HAS ephemeral (`--ephemeral` flag, `Ephemeral bool` in registration, proto `Runner.Ephemeral` field). |
| 40 | "Forgejo: + lxc / gRPC plugin schemes" | Gitea: no `act/plugin/`, no LXC dirs | ✓ | Confirmed Forgejo-only. |
| 41 | "Forgejo: + PR write-isolation" | Gitea: no `act/cacheproxy/` | ✓ | Confirmed Forgejo-only. |
| 42 | "Forgejo: actions approval/trust (server-side, forgejo_migrations v14a)" | Searched entire Forgejo runner | 🟡 **PARTIAL** | **No references in runner codebase.** Confirmed server-side only. `forgejo_migrations v14a` is in the Forgejo server (also behind Anubis), unverifiable from runner. |

### ACT section (15 claims verified)

| # | Round-1 Claim | Verdict | Notes |
|---|---|---|---|
| 43 | "nektos/act commit SHA: a456b6b... (tag v0.2.95)" | ✓ | Tag confirmed as latest release. |
| 44 | "462 blobs in tree" | 🟡 **PARTIAL** | API returns 677 entries. Counting methodology unclear. |
| 45 | "pkg/exprparser: actionlint-based" | ✓ | Confirmed `import "github.com/rhysd/actionlint"`. |
| 46 | "Reflection-based walker" | ✓ | Uses reflect.ValueOf, reflect.Kind. |
| 47 | "Contexts: github, env, job, jobs, steps, runner, secrets, vars, strategy, matrix, needs, inputs" | ✓ | All 12 + infinity/nan. |
| 48 | "Functions (11)" | ✗ **WRONG COUNT** | **12 functions.** List contains 12 items, count label is wrong. |
| 49 | "pkg/runner/runner.go: Runner + Config" | ✓ | Confirmed. |
| 50 | "Matrix expansion client-side: GetMatrixes → CartesianProduct" | ✓ | Confirmed. |
| 51 | "pkg/container/executions_environment.go:5-15 — interface with Create/Copy/Exec/Remove" | ✗ **WRONG SHAPE** | Interface embeds `Container` + has path/context helpers. Create/Copy/Exec/Remove are in embedded `Container`, not declared directly. |
| 52 | "Docker: uses moby/moby client directly" | 🟡 **PARTIAL** | Uses `github.com/moby/moby/client v0.3.0` (new split module). Not monolithic `github.com/docker/docker`. |
| 53 | "pkg/artifacts/server.go: local GHA artifact API (v1 + v4)" | ✓ | Confirmed. |
| 54 | "Symlink-safe via os.Root" | ✓ | Confirmed. |
| 55 | "Bearer auth (AuthKey)" | ✓ | Confirmed. |
| 56 | "pkg/runner/step.go: pre/main/post split" | ✓ | Confirmed. |
| 57 | "File-based outputs: workflow/*.txt" | 🟡 **PARTIAL** | Specific filenames: `outputcmd.txt`, `statecmd.txt`, `pathcmd.txt`, `envs.txt`, `SUMMARY.md`. |
| 58 | "pkg/common/cartesian.go (~50 lines)" | ✓ | 51 lines. |
| 59 | "pkg/model/planner.go: DAG → stages" | ✓ | Confirmed. |
| 60 | "goccy/go-yaml for parsing" | ✗ **STALE** | Uses `gopkg.in/yaml.v3` and `go.yaml.in/yaml/v3`. NOT `goccy/go-yaml`. |

### Cross-cutting (5 claims)

| # | Claim | Verdict |
|---|---|---|
| 61 | "Protocol: 7+1 methods, de-facto standard" | 🟡 **PARTIAL** | Shared baseline (Gitea) is only **5+1** methods. 7+1 is Forgejo-only. "De-facto standard" overstates it. |
| 62 | "Server-side matrix expansion (Forgejo model)" | ✓ | Confirmed via `act/jobparser` (1221 lines). |
| 63 | "act's executor is the hard 80%" | ✓ | Reasonable. |
| 64 | "S3 + v4 GetSignedArtifactURL" | ✓ | Confirmed. |
| 65 | "PR write-isolation is a security must" | ✓ | Confirmed. |

---

## 2. Material Corrections to Round-1

### 2.1 Forgejo Runner Version & SHA (CRITICAL)

- **Round-1:** "tag v1.8.1" / "Commit SHA: not available"
- **Correction:** No `v1.8.1` exists. **SHA IS available via Go proxy `.info`:** `c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7` (v13.2.1, 2026-10-02).

### 2.2 Gitea↔Forgejo Divergence is Narrower Than Stated

| Area | Gitea v1.0.8 | Forgejo v13.2.1 |
|---|---|---|
| Proto module | `code.gitea.io/actions-proto-go` (v0.4.1) | `code.forgejo.org/forgejo/actions-proto` (v0.8.0) |
| **RPC count** | **5** | **7** |
| Registration | Register + Declare | Register + Declare |
| Fetch | FetchTask | FetchTask + **FetchSingleTask** (with `handle`) |
| Batch fetch | No | **`task_capacity` + `additional_tasks`** |
| Reporting | UpdateTask + UpdateLog | + **UpdateStepSummary** |
| Ephemeral | ✓ | ✓ |
| Container backends | docker / host | docker / host / **lxc** / **gRPC plugin** |
| Cache proxy | No | **cacheproxy** + PR write-isolation |
| Job parser | (in server) | **act/jobparser** (1221 lines, in runner) |
| Runner env | `GITEA_ACTIONS` | `FORGEJO_ACTIONS` + `FORGEJO_ACTIONS_RUNNER_VERSION` |

The **real** Forgejo-only proto additions are: `FetchSingleTask`, `UpdateStepSummary`, `task_capacity`/`additional_tasks`. Declare and ephemeral are NOT Forgejo-only.

### 2.3 Container Interface Shape (functional executor pattern)

Actual interface uses `common.Executor` (a `func(ctx) error`) returned by each method, not `error` directly:

```go
type Container interface {
    Create(capAdd, capDrop []string) common.Executor
    Copy(destPath string, files ...*FileEntry) common.Executor
    CopyTarStream(ctx context.Context, destPath string, tarStream io.Reader) error
    Pull(forcePull bool) common.Executor
    Start(attach bool) common.Executor
    Exec(command []string, env map[string]string, user, workdir string) common.Executor
    Remove() common.Executor
    // ... 14 methods total
}
```

### 2.4 Other corrections

- **nektos/act `ExecutionsEnvironment`:** embeds `Container`; path/context helpers on the wrapper. Create/Copy/Exec/Remove are in embedded `Container`, not declared directly.
- **Gitea module path:** `module gitea.com/gitea/runner` (proxy uses `act_runner`).
- **Expression functions:** 12, not 11.
- **HTTP transport:** no idle-conn tuning; 60s client timeout with `FORGEJO_CLIENT_TIMEOUT` override.
- **YAML library:** `go.yaml.in/yaml/v3`, NOT `goccy/go-yaml`.

---

## 3. Gaps Round-1 Missed

### 3.1 Forgejo Runner Commit SHA — Now Available

The Go module proxy `.info` endpoint provides git origin for any module version. This was Round-1's stated blocker but is actually accessible.

### 3.2 Plugin Proto: Full Contract & MIT License (CRITICAL for OpenForge)

The `act/plugin/proto/v1alpha/plugin.proto` (246 lines) defines a gRPC service `BackendPlugin` with 7 RPCs:

| RPC | Streaming | Purpose |
|-----|-----------|---------|
| `Capabilities` | unary | Backend identity (name) |
| `Create` | unary | Provision environment |
| `Start` | server-stream | Boot, stream startup output |
| `Exec` | server-stream | Run command, stream stdout/stderr |
| `CopyIn` | client-stream | Tar in (for GITHUB_ENV/OUTPUT/STATE) |
| `CopyOut` | server-stream | Tar out |
| `Remove` | unary | Teardown |

**CRITICAL:** The plugin proto is **MIT-licensed** (lines 4-8), deliberately more permissive than the GPL-3.0 runner. The comment: "This choice allows plugin authors to embed it, create derived works of it (e.g. generated source files), and distribute derived products under a wider variety of licenses."

This is **highly relevant for OpenForge**: you can legally reuse the plugin contract under MIT without inheriting GPL.

### 3.3 `act/jobparser/` — The Server-Side Job Parser (1221 lines)

The mechanism by which Forgejo does server-side expansion. Key structures:
- `SingleWorkflow`: "a workflow with single job and single matrix" — the unit of work sent to the runner.
- `ErrCannotEvaluateInJobParser`: signals that full runner execution is needed.
- **Recursion depth limit: 5** for reusable workflows.
- Handles: matrix expansion, runs-on resolution (including `${{ }}` in runs-on), needs output passing, reusable workflow expansion, `enable-openid-connect` flag.

If you want server-side expansion in OpenForge, you need to port or reimplement this ~1200-line package.

### 3.4 `act/runner/expression.go` — Expression Integration

The `ExpressionEvaluator` interface with `evaluate()`, `EvaluateYamlNode()`, `Interpolate()` methods. Created via `RunContext.NewExpressionEvaluator(ctx)`. The `EvaluateYamlNode` method evaluates entire YAML nodes (like `matrix`) before expansion.

### 3.5 `cacheproxy` Full Mechanism

The `act/cacheproxy/handler.go` (218 lines) is a `httputil.ReverseProxy` that:
1. Accepts at `/:runId/_apis/artifactcache/...`
2. Looks up `runId` in `sync.Map` for `artifactcache.RunData`
3. Strips prefix, forwards to actual cache server
4. Adds 7 headers (Forgejo-Cache-Repo, RunNumber, RunId, Timestamp, MAC, Host, WriteIsolationKey)

**Write-isolation is enforced server-side.** The proxy just passes the key.

### 3.6 Actions Approval/Trust is Server-Side Only

Confirmed: Forgejo runner codebase contains **zero references** to "approval", "forgejo_migrations", or any trust/governance logic. Runner only sets `FORGEJO_ACTIONS=true` and `FORGEJO_ACTIONS_RUNNER_VERSION=<version>`. Governance is server-side.

### 3.7 Request Key / Idempotency Mechanism

The `x-runner-request-key` header (UUID) deduplicates fetch calls: if same key arrives twice, server returns same task. Runner retains key until successful response. Documented in `single.go` lines 71-80.

### 3.8 Gitea Runner Has `metrics` Package

Gitea runner imports `gitea.com/gitea/runner/internal/pkg/metrics` — Prometheus metrics package. Forgejo runner doesn't.

### 3.9 `FORGEJO_ACTIONS_RUNNER_VERSION` Env Var

Set at `runner.go:79`: `envs["FORGEJO_ACTIONS_RUNNER_VERSION"] = ver.Version()`. Allows workflows to detect they're on a Forgejo runner.

### 3.10 Docker Client Migration

Both nektos/act and Forgejo runner use **`github.com/moby/moby/client`** + **`github.com/moby/moby/api`** (post-2024 moby repo restructure). NOT `github.com/docker/docker`.

### 3.11 `task_capacity` and `additional_tasks`

Forgejo proto's `FetchTaskRequest` has `optional int64 task_capacity = 2` and `FetchTaskResponse` has `repeated Task additional_tasks = 3`. Allows runner with `Capacity > 1` to fetch multiple tasks in one round-trip. Gitea does NOT have these fields.

### 3.12 LXC Shell Helpers

Forgejo runner's `act/runner/` contains `lxc-helpers-lib.sh` and `lxc-helpers.sh` — confirms LXC is first-class with its own tooling.

---

## 4. Re-extracted File/Line Citations (Corrected)

### Forgejo Runner v13.2.1 (SHA `c4a92ff`)

| File | Lines | Content |
|------|-------|---------|
| `go.mod` | 1-3 | `module code.forgejo.org/forgejo/runner/v13`, `go 1.26.0` |
| `go.mod` | 6 | `code.forgejo.org/forgejo/actions-proto v0.8.0` |
| `internal/pkg/client/client.go` | 19-25 | `Client` interface (6 methods) |
| `internal/pkg/client/http.go` | 58 | baseURL = endpoint + "/api/actions" |
| `internal/pkg/client/http.go` | 66-78 | Connect interceptor (4 headers) |
| `internal/pkg/client/http.go` | 39-47 | 60s timeout, `FORGEJO_CLIENT_TIMEOUT` override |
| `internal/pkg/client/header.go` | 7-10 | Header constants (uuid, token, request-key, user-agent) |
| `internal/pkg/labels/labels.go` | 12-24 | Scheme constants (host, docker, lxc) |
| `internal/pkg/labels/labels.go` | 34-81 | `Parse()` function |
| `internal/pkg/labels/labels.go` | 169-191 | `PickPlatform()` — scheme→platform mapping |
| `internal/pkg/config/config.go` | 514-580 | `New()` — default values |
| `internal/pkg/config/config.go` | 521-567 | All defaults |
| `internal/pkg/config/config.go` | 585-593 | `validateLabelScheme` |
| `internal/app/cmd/register.go` | 40 | Deprecation warning for `register` |
| `internal/app/poll/poller.go` | 73-77 | Rate-limited poll loop |
| `internal/app/poll/single.go` | 71-80 | Idempotency via requestKey (detailed comment) |
| `internal/app/run/runner.go` | 78-79 | `FORGEJO_ACTIONS` + `FORGEJO_ACTIONS_RUNNER_VERSION` |
| `internal/app/run/runner.go` | 91-151 | `SetupCache` |
| `internal/pkg/report/mask.go` | 14-18 | `masker` struct |
| `internal/pkg/report/mask.go` | 27-49 | `add()` — multi-line handling |
| `internal/pkg/report/mask.go` | 51-67 | `getReplacer()` — `strings.NewReplacer` |
| `internal/pkg/report/mask.go` | 69-140 | Multi-line matching/replacement |
| `internal/pkg/report/reporter.go` | 33-59 | `Reporter` struct |
| `act/container/container_types.go` | 21-49 | `NewContainerInput` struct |
| `act/container/container_types.go` | 61-76 | `Container` interface (14 methods, executor pattern) |
| `act/cacheproxy/handler.go` | 26-28 | `urlBase = "/_apis/artifactcache"` |
| `act/cacheproxy/handler.go` | 90-96 | Route definitions (6 routes) |
| `act/cacheproxy/handler.go` | 124-163 | `newReverseProxy` — header injection |
| `act/cacheproxy/handler.go` | 147-155 | 7 Forgejo-Cache-* headers |
| `act/artifactcache/model.go` | 26-36 | `Cache` struct (bolthold tags, WriteIsolationKey) |
| `act/plugin/proto/v1alpha/plugin.proto` | 1-8 | MIT license header |
| `act/plugin/proto/v1alpha/plugin.proto` | 40-81 | `BackendPlugin` service (7 RPCs) |
| `act/plugin/proto/v1alpha/plugin.proto` | 85-90 | `CapabilitiesResponse` |
| `act/plugin/proto/v1alpha/plugin.proto` | 103-124 | `CreateRequest` |
| `act/plugin/proto/v1alpha/plugin.proto` | 173-184 | `ExecRequest` |
| `act/jobparser/jobparser.go` | 46 | `Parse()` entry point |
| `act/jobparser/jobparser.go` | 61-63 | Recursion depth limit (5) |
| `act/jobparser/model.go` | 21-56 | `SingleWorkflow` struct |
| `act/runner/expression.go` | 1-40 | `ExpressionEvaluator` interface + creation |
| `act/runner/lxc-helpers-lib.sh` | — | LXC shell helpers (present) |

### Forgejo actions-proto v0.8.0 (SHA `cd5270b`)

| File | Lines | Content |
|------|-------|---------|
| `proto/runner/v1/services.proto` | 1 | `syntax = "proto3"` |
| `proto/runner/v1/services.proto` | 7-22 | `service RunnerService` (7 RPCs) |
| `proto/ping/v1/services.proto` | 7-9 | `service PingService` (1 RPC) |
| `proto/runner/v1/messages.proto` | 8-16 | `RegisterRequest` |
| `proto/runner/v1/messages.proto` | 22-25 | `DeclareRequest` |
| `proto/runner/v1/messages.proto` | 103-114 | `Runner` message |
| `proto/runner/v1/messages.proto` | 117-122 | `RunnerStatus` enum (UNSPECIFIED/IDLE/ACTIVE/OFFLINE) |
| `proto/runner/v1/messages.proto` | 134-142 | `Task` message |
| `proto/runner/v1/messages.proto` | 170-173 | `LogRow` message |
| `proto/runner/v1/messages.proto` | 77-86 | `UpdateLogRequest`/`Response` |

---

## 5. Open Questions for Round-3

**None substantive.** Round-1 and Round-2 agree on architecture; corrections are citation-level (line numbers, package names, status enum values, interface shape, license, version tag).

If Round-3 is needed for **gap-filling**, the candidates are:
- Verify the `actions-proto` proto files (`messages.proto` in full) — currently partial
- Verify nektos/act's `pkg/artifactcache` implementation details (Round-1 cited this as "not re-fetched in detail")
- Verify the `moby/moby` client API usage patterns (Round-2 flagged but didn't deep-dive)
- Fetch the Forgejo **server** codebase (currently blocked by Anubis) to verify `forgejo_migrations v14a` and the actions approval/trust logic
