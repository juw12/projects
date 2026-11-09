# OpenForge Runner Architecture — Source Map
## act_runner + nektos/act

> **Scope:** Two Go reference implementations mapped at source level to inform OpenForge's
> runner decision: (a) fork act_runner + ship its protocol, (b) adopt nektos/act as a local
> executor + build our own controller, (c) build from scratch.
>
> **Method:** Source pulled via Go module proxy + raw GitHub (no git clone into workspace —
> `code.forgejo.org` is behind Anubis anti-scraping and blocks direct clone). All citations are
> `path/to/file.go:LINE` relative to each repo root. Line numbers verified against the pulled
> snapshot.
>
> **Verification note (material correction):** An earlier hypothesis stated "Gitea act_runner =
> REST/JSON, Forgejo = ConnectRPC." That is **incorrect**. Gitea act_runner v1.0.8 is *also*
> ConnectRPC + protobuf (via `code.gitea.io/actions-proto-go`). The real Gitea↔Forgejo split is
> module path + newer Forgejo RPCs/features, detailed in §ACT_RUNNER.10.

---

# ACT_RUNNER

> **Repo:** `code.forgejo.org/forgejo/runner` (binary `forgejo-runner`)
> **Go module:** `code.forgejo.org/forgejo/runner/v13` (go 1.26.0)
> **Wire-format dependency:** `code.forgejo.org/forgejo/actions-proto@v0.8.0` (separate module,
> holds all `.proto`; the runner imports it, so the `.proto` files are NOT in the runner tree —
> the only in-tree `.proto` is `act/plugin/proto/v1alpha/plugin.proto`, the plugin-executor contract).
> **Commit SHA:** not available via git (Anubis blocks clone); source snapshot pulled via Go proxy
> tag `v1.8.1` whose **content** is v13-era (import paths `code.forgejo.org/forgejo/runner/v13`,
> Copyright 2026, references Forgejo 14/15). Treat `v13` / actions-proto `v0.8.0` as the effective revision.
> **File count:** 230 `.go` files (full list = §ACT_RUNNER.1).

## ACT_RUNNER.1 — File tree (by responsibility)

The runner is a **thin controller-client**: it registers, polls a versioned task queue, and
delegates actual job execution to an embedded copy of a GHA-compatible executor (the `act/` tree,
itself derived from nektos/act). Split:

- `main.go` — entry; cobra root.
- `internal/app/cmd/` — CLI verbs.
  - `cmd.go` — root command wiring.
  - `register.go` — registration (Register/Declare) — see §2.
  - `daemon.go` — long-running poll→run loop supervisor.
  - `job.go`, `exec.go` — one-shot local execution (no controller).
  - `create-runner-file.go`, `cache-server.go`, `validate.go`, `args.go` — helpers.
- `internal/app/poll/` — the job-fetch loop — see §3.
  - `poller.go`, `single.go` (+ `mocks/`).
- `internal/app/run/` — per-task execution assembly.
  - `runner.go` — builds executor, wires cache, secrets, env — see §5/§6.
  - `workflow.go` — expands/loads the received workflow payload.
  - `logging.go` — reporter hookup.
- `internal/pkg/client/` — the controller RPC client — see §2.
  - `client.go`, `http.go`, `header.go`, `backward.go` (+ `mocks/`).
- `internal/pkg/config/` — config + persisted registration.
  - `config.go`, `registration.go`, `label_config.go`, `embed.go`.
- `internal/pkg/labels/` — label→backend scheme selection — see §4.
  - `labels.go`.
- `internal/pkg/report/` — log/state/secret reporting + redaction — see §6/§9.
  - `reporter.go`, `mask.go`, `step_summary_collector.go`.
- `internal/pkg/envcheck/docker.go`, `internal/pkg/ver/version.go` — env/ver.
- `act/` — the **embedded GHA executor** (derived from nektos/act; ~same shape, diverged):
  - `act/runner/` — step/job execution, expression wiring, actions, composites, reusables.
  - `act/container/` — container backends: `docker/`, `host_environment.go`, `executions_environment.go`.
  - `act/exprparser/` — `${{ }}` evaluator.
  - `act/model/` — workflow AST + planner.
  - `act/artifactcache/` — cache storage (BoltDB).
  - `act/cacheproxy/` — namespaced cache proxy (PR write-isolation).
  - `act/plugin/` — **gRPC plugin backend** (Forgejo-specific) — see §4.
  - `act/jobparser/`, `act/common/`, `act/lookpath/`, `act/schema/`, `act/workflowpattern/`, `act/filecollector/`.

## ACT_RUNNER.2 — Registration protocol

**Client interface** `internal/pkg/client/client.go:9-25`
```go
type Client interface {
    pingv1connect.PingServiceClient
    runnerv1connect.RunnerServiceClient
    Address() string
    Insecure() bool
}
```
The client is **not** a hand-rolled REST client. It embeds two ConnectRPC service clients generated
from `actions-proto`. Transport (`internal/pkg/client/http.go`): an `*http.Client` with a custom
`http.Transport` (idle-conn tuning: `MaxIdleConnsPerHost:10`, `IdleConnTimeout:90s`), optional
`InsecureSkipVerify`, and a Connect `UnaryInterceptor` that stamps **`x-runner-uuid`** and
**`x-runner-token`** headers on every request (`header.go`: `UUIDHeader`, `TokenHeader`). Base URL =
`<endpoint>/api/actions`.

**Wire contract** `code.forgejo.org/forgejo/actions-proto@v0.8.0/proto/runner/v1/services.proto:7-22`
```
service RunnerService {
  rpc Register(RegisterRequest) returns (RegisterResponse);      // deprecated path
  rpc Declare(DeclareRequest)   returns (DeclareResponse);       // modern, config-driven
  rpc FetchTask(FetchTaskRequest) returns (FetchTaskResponse);
  rpc FetchSingleTask(FetchSingleTaskRequest) returns (FetchTaskResponse);  // Forgejo 15
  rpc UpdateTask(UpdateTaskRequest) returns (UpdateTaskResponse);
  rpc UpdateLog(UpdateLogRequest) returns (UpdateLogResponse);
  rpc UpdateStepSummary(UpdateStepSummaryRequest) returns (UpdateStepSummaryResponse);
}
```
`proto/ping/v1/services.proto:7-9` defines `Ping(PingRequest) returns (PingResponse)` for liveness.

**Registration flow** `internal/app/cmd/register.go:30-40,305-360`
- `register` verb: reads token + endpoint, calls **`Declare`** (modern) — sends the full desired
  runner config (labels, container options, ephemeral flag) and receives an assigned
  `Runner{id, uuid, token, name, status, labels, ephemeral}`. Legacy **`Register`** (name+labels
  only) is retained for back-compat (`client/backward.go`).
- Result persisted via `config.SaveRegistration` → `internal/pkg/config/registration.go`
  (the `registration` file the daemon reads on next start; contains `uuid`, `token`, `host`,
  labels, container defaults).
- The runner is **ephemeral-capable** (`Runner.ephemeral`): the controller can flag a runner to
  self-terminate after its tasks drain.

**Message shapes** `proto/runner/v1/messages.proto`
- `Runner { id, uuid, token, name, status:RunnerStatus, labels:repeated Label, ephemeral }`
- `Label { name, scheme }` — `scheme` is the container-backend selector (§4).
- `RunnerStatus` enum: `Unspecified/Waiting/Running` (+ error states).
- `Task { id, workflow_payload:bytes, context:google.protobuf.Struct, secrets:map<string,string>,
  needs:map<string,...>, vars:map<string,string> }` — the **unit of work** (see §3).
- `TaskState`, `StepState` — reported back via UpdateTask.
- `LogRow { time, content }` — streaming log batch element (§9).

**OpenForge takeaway:** the protocol is a small, well-scoped ConnectRPC surface (7 + 1 methods)
over HTTP, header-authenticated, with a protobuf task envelope. This is trivially reproducible in
a TypeScript/Postgres controller (connect-web / connect-es clients exist) — low cost to fork.

## ACT_RUNNER.3 — Job-fetch loop

**`internal/app/poll/poller.go`** — the outer loop. A rate-limited poller (one fetch per
`FetchInterval`, default 2s) against the **versioned task queue**. Key mechanics:
- Each fetch carries an **idempotent request-key (UUID)** so a retried/resent `FetchTask` after a
  network blip does not double-claim a task.
- `ErrNoTaskReceived` is the normal empty result (not an error path).
- Backoff/idle maintenance: on idle, the poller extends its interval and performs housekeeping
  (reconnect, re-register if token rotated).

**`internal/app/poll/single.go`** — the single-task fetch used by the daemon. It calls
`FetchSingleTask` (Forgejo 15) or `FetchTask` (earlier) depending on server capability. On a
`Task`, it hands the `workflow_payload` bytes to the run layer (§5/§6). The **controller
pre-expands** the workflow + matrix: what arrives is already **one job per task** (the payload is
the "expanded workflow yaml"), so the runner does **not** run the planner/cartesian expansion that
nektos/act does client-side — a deliberate control-plane simplification (see §ACT_RUNNER.8 and
§ACT.9 contrast).

**Defaults** `internal/pkg/config/config.go:34-99,521-567`:
- `Capacity = 1` (concurrent tasks per runner process)
- `Timeout = 3h` (per-task hard timeout)
- `FetchTimeout = 30s` (per-fetch RPC deadline)
- `ReportInterval = 1s` (log batch cadence)
- `FetchInterval = 2s` (poll cadence; **30s** when endpoint is `codeberg.org`)
- `DockerHost = "-"` (auto-detect), `WorkdirParent = "workspace"`

**OpenForge takeaway:** the fetch model is a **server-authoritative, versioned, idempotent task
queue** — the runner is dumb. This is the strongest argument for building your own controller
(option b) if you want to keep the runner simple; the intelligence lives server-side where
Postgres fits naturally.

## ACT_RUNNER.4 — Container runtime abstraction

**Scheme selection** `internal/pkg/labels/labels.go:13-19,71,169`. Each runner `Label` carries a
`scheme`; the scheme string selects the backend:
- `docker` — **default**; default image `//node:22-bookworm` (docker-socket-v2 / moby).
- `host` — label `-self-hosted`; runs on the runner host, no container.
- `lxc` — `//debian:bookworm`; LXC microVM backend.
- **plugin schemes** — `//<...>` custom schemes route to a **gRPC plugin** executor
  (`act/plugin/`), a Forgejo-specific extension allowing out-of-process, out-of-band execution
  backends (e.g., a remote/k8s/k3s runner speaking the plugin contract).

**Container interface** `act/container/container_types.go:21-76`
```go
type NewContainerInput struct { /* image, entrypoint, env, host arch, network, ... */ }
type Container interface {
    Create(ctx, NewContainerInput) error
    Copy(src, dst) error
    CopyTarStream(reader, dst) error
    CopyDir(src, dst) error
    Exec(ctx, cmd) error
    Remove(ctx) error
    // ... log attach, file access, ...
}
```
Implementations live under `act/container/docker/` (`execution_environment.go`, `run.go`,
`pull.go`, `network.go`, `volume.go`, `images.go`, `endpoint.go` — the docker-socket-v2 client),
plus `act/container/host_environment.go` (the host backend).

**Plugin backend** `act/plugin/`:
- `proto/v1alpha/plugin.proto` — the plugin gRPC service (the ONLY in-tree `.proto`).
- `client.go` / `adapter.go` — the gRPC client + the `Container`/executor adapter that lets a
  remote executor impersonate a local container.
- `testplugin/` — a reference in-process plugin server (for tests / dev).

**OpenForge takeaway:** the backend is **plug-in by label-scheme** with a `Container` interface as
the seam. If you want k8s as a first-class backend, the Forgejo plugin contract is a working
pattern to copy (a gRPC adapter behind the same interface) — cleaner than the hardcoded
docker/host split in nektos/act.

## ACT_RUNNER.5 — Cache layer

**Storage model** `act/artifactcache/model.go:3-35`
- Metadata in **bolthold (BoltDB)** — on-disk, single-node, no external DB.
- `WriteIsolationKey` field on each cache key — the **PR write-isolation** mechanism (see below).
- `storage.go`, `caches.go`, `mac.go` (HMAC key signing), `handler.go` (HTTP handler for the
  standalone cache server).

**Proxy + PR write-isolation** `act/cacheproxy/handler.go`. The runner wraps the (internal or
external) cache server in a **proxy** that:
- namespaces every request by a **per-run ID** (so runs don't collide), and
- enforces **write isolation per pull-request** — a PR's job can *read* shared cache but only
  *write* to a PR-scoped namespace, preventing a malicious PR from poisoning the mainline cache.
  This is a **security** property, not a perf one.

**Wiring** `internal/app/run/runner.go:91-151,194-230` — the run layer decides cache backend
(internal BoltDB server vs. external `cache-server` endpoint), constructs the `cacheproxy`, and
passes it into the executor config. The standalone `cache-server` verb
(`internal/app/cmd/cache-server.go`) lets you run the cache as a separate service.

**OpenForge takeaway:** cache is **BoltDB-backed, single-node, with a namespaced proxy for
PR-scope write isolation**. For OpenForge (Postgres + S3), you'd likely replace BoltDB with S3 and
keep the proxy's two jobs (per-run namespacing + PR write isolation) — those are the load-bearing
ideas, and the write-isolation is a security must for multi-tenant/multi-PR correctness.

## ACT_RUNNER.6 — Secret injection flow

- Secrets arrive **inside the Task envelope** (`Task.secrets:map<string,string>`,
  `messages.proto`) — they are pushed from the controller per-task, not stored on the runner.
- The run layer (`internal/app/run/runner.go` + `workflow.go`) places them into the executor's
  `secrets` context and into the container env for each job.
- **Injection is env-var based** (GHA semantics): `${{ secrets.X }}` resolves from the secrets
  context; steps also receive them as environment variables so actions can read them directly.
- Secrets are **never persisted** by the runner and are **redacted on the way back out** (§9).

**OpenForge takeaway:** per-task secret push + env injection + egress redaction is the standard,
minimal, safe pattern. Keep secrets controller-side (Postgres, encrypted), deliver per-task, never
cache them runner-side.

## ACT_RUNNER.7 — Artifact flow

- Artifacts use the same **artifactcache** package as the cache (§5) — in this codebase the
  runner's artifact upload/download rides the `/_apis/artifactcache`-style surface
  (`act/artifactcache/handler.go`), namespaced per run.
- `internal/app/run/runner.go` wires the artifact/cache endpoint into the executor so
  `actions/upload-artifact` / `download-artifact` (when run against a Forgejo runner) hit the
  runner's local or configured artifact server rather than GitHub's.
- There is **no separate S3-style artifact service** in the runner — it is the cache server or an
  external endpoint. (Contrast with nektos/act's richer local artifact server, §ACT.7.)

**OpenForge takeaway:** For OpenForge, artifacts = **S3 + signed URLs**, decoupled from the cache.
The runner only needs a thin client to your artifact service. Don't conflate artifacts and cache
the way this codebase does.

## ACT_RUNNER.8 — Matrix strategy

- **Server-side expansion.** The controller expands the matrix and sends **one job per task**
  (the `workflow_payload` is already the expanded single-combination workflow). The runner does
  *not* enumerate combinations.
- The cartesian helper still exists in the embedded executor (`act/common/cartesian.go:4-23`,
  `CartesianProduct`) — it is used by the **one-shot local** paths (`job.go`/`exec.go`) and by
  `nektos/act` client-side, but **not** on the daemon's per-task path.

**OpenForge takeaway:** matrix expansion in the controller is the right call for a multi-runner
system (it's how you fan out jobs across a pool). Keep expansion server-side; the runner stays a
single-job executor.

## ACT_RUNNER.9 — Log redaction (secret masking on egress)

**`internal/pkg/report/mask.go:14-67`**
- A `masker` backed by **`strings.Replacer`** built from the task's secret values → `***`.
- Handles **multi-line** secret values and builds a fast replacement table.

**`internal/pkg/report/reporter.go:28-102,448-540`**
- Every log line passing through the reporter is run through the masker before leaving the runner.
- Supports **`::add-mask::<value>`** workflow commands (GHA-compatible) so a step can register a
  runtime secret to be masked from that point on.
- **Reporting RPCs** (the egress path):
  - `UpdateLog` — batches `LogRow{time, content}` with **offset/ack_index** for **resumable,
    at-least-once** delivery (the controller acks a cursor; the runner resumes after a blip).
  - `UpdateTask` — reports `TaskState`/`StepState` + step **outputs**; the controller can also
    use this channel to **force-cancel** a running task.
  - `UpdateStepSummary` — pushes step summaries (Forgejo 15).
- A **`RunDaemon`** periodic goroutine flushes the reporter on `ReportInterval` (1s).

**OpenForge takeaway:** the redaction design is exactly what you want: **replacer-table masking at
the single egress choke point (the reporter), driven by per-task secrets + `::add-mask::`, with
resumable batched log delivery.** Copy this shape. Do the masking in one place, not scattered.

## ACT_RUNNER.10 — Gitea vs. Forgejo divergence

**Gitea baseline:** `gitea.com/gitea/act_runner@v1.0.8` (339 files / 147 `.go`), module
`gitea.com/gitea/act_runner`. Its client (`internal/pkg/client/client.go:14-19`) is:
```go
type Client interface {
    pingv1connect.PingServiceClient
    runnerv1connect.RunnerServiceClient   // from code.gitea.io/actions-proto-go
    Address() string
    Insecure() bool
}
```
`http.go`: base URL `<endpoint>/api/actions`, same `x-runner-uuid`/`x-runner-token` interceptor
pattern. **So Gitea is ALSO ConnectRPC + protobuf** (via the Gitea fork `code.gitea.io/actions-proto-go`).

**The real divergence (Gitea → Forgejo):**

| Area | Gitea act_runner v1.0.8 | Forgejo runner v13 |
|---|---|---|
| Proto module | `code.gitea.io/actions-proto-go` | `code.forgejo.org/forgejo/actions-proto` (v0.8.0) |
| Registration | `Register` (name+labels) | `Declare` (config-driven) **added**; `Register` kept |
| Fetch | `FetchTask` | `FetchTask` + **`FetchSingleTask`** (F15) |
| Reporting | `UpdateTask`/`UpdateLog` | + **`UpdateStepSummary`** (step summaries) |
| Runner lifecycle | stateful only | + **ephemeral** runners |
| Container backends | docker / host | docker / host / **lxc** / **gRPC plugin** schemes |
| Cache | BoltDB, per-run namespacing | + **PR write-isolation** (security) |
| Actions governance | — | **actions approval / trust** (server-side, `forgejo_migrations` v14a) + `FORGEJO_ACTIONS` / `forgejo` expression context |
| Context | `github.*` | + **`forgejo.*`** context, `FORGEJO_ACTIONS` env |

**OpenForge takeaway:** the protocol core (ConnectRPC + protobuf task queue) is **stable and
shared** across Gitea/Forgejo — it's a de-facto open standard for "act-compatible" runners. The
value-adds worth adopting are: `Declare` (config-driven registration), ephemeral runners, the
plugin backend scheme, and **PR cache write-isolation**. Actions **approval/trust** is a
server-side governance feature you'll want for OpenForge too (allow-list + approval for
non-`@actions`/unpinned actions in fork/PR contexts).

---

# ACT

> **Repo:** `github.com/nektos/act`
> **Commit SHA:** `a456b6b560db74fc0c59fcde385c0d29ff4f4517` (tag `v0.2.95`)
> **Nature:** a **standalone, client-side** GHA emulator. No controller: it reads a local workflow
> file, expands the matrix, plans the DAG, and executes locally (Docker or host). It is the
> "executor brain" that Forgejo's runner embeds (diverged). 462 blobs in tree.
>
> **File access note:** key files pulled to `actsrc/` as `pkg__<pkg>__<file>.go` (double-underscore
> separators) to flatten the tree for offline reading.

## ACT.1 — File tree (by responsibility)

- `cmd/act/` — CLI.
- `pkg/model/` — **AST + planner** (workflow → DAG → stages).
  - `workflow.go` (Workflow/Job/Strategy/Step AST), `planner.go` (DAG → stages), `reusable.go`,
    `action.go`, `github_context.go`, `job_context.go`, `step_result.go`.
- `pkg/exprparser/` — **`${{ }}` expression evaluator** (actionlint-based).
  - `interpreter.go` (evaluator), `functions.go` (function registry), `mutator.go`,
    `rewrite_sub_expr.go`.
- `pkg/runner/` — **execution engine**.
  - `runner.go` (Runner/Config/plan executor), `run_context.go`, `step.go` + `step_run.go`
    (step lifecycle), `step_factory.go`, `step_docker.go`, `step_action_local.go`,
    `step_action_remote.go` (action download), `action.go`, `action_composite.go`,
    `reusable_workflow.go`, `action_cache.go` + `local_repository_cache.go` (action cache),
    `log_sanitize.go`, `expression.go`, `job_executor.go`, `logger.go`.
- `pkg/container/` — **container backends**.
  - `executions_environment.go` (interface), `docker_run.go` (moby), `host_environment.go` (host),
    `docker/` (sub: build, pull, network, volume, ...).
- `pkg/artifacts/` — **local artifact server** (emulates GHA artifact API).
  - `server.go` (v1), `artifacts_v4.go` (v4 signed-URL API).
- `pkg/artifactcache/` — **local cache server** (emulates GHA `/_apis/artifactcache`).
  - `handler.go`, `storage.go`.
- `pkg/jobparser/` — parses a controller-supplied "job" (the runner-side of a split execution;
  this is what Forgejo's runner uses to consume a pre-expanded job).
- `pkg/common/` — `cartesian.go` (matrix), `git/`, `logger.go`, `file.go`, `exitcode.go`, ...
- `pkg/lookup/` (action lookup), `pkg/structs/`, `pkg/tables/`, `pkg/telemetry/`.

## ACT.2 — Workflow YAML parser / AST

**`pkg/model/workflow.go:19,196,216,221,387-401,569,714`**
- `Workflow` — top doc: `on` triggers, `jobs`, `env`.
- `Job` — `needs`, `runs-on`, `container`/`services`, `strategy` (incl. `rawMatrix yaml.Node`),
  `steps`, `env`/`defaults`/`timeout`.
- `Step` — `id`, `name`, `if`, `uses`, `with`, `run`, `shell`, `working-directory`, `env`,
  `continue-on-error`, `timeout`, `outputs`.
- Parsing: `ReadWorkflow` (entry) uses `goccy/go-yaml` (not `gopkg.in/yaml`), so raw `yaml.Node`
  is preserved on the matrix (needed to evaluate `${{ }}` inside `matrix` before expansion).
- Validation: trigger/`runs-on`/step-shape checks; `reusable.go` models `workflow_call`/
  `workflow_dispatch` reusable contracts.

**`pkg/model/planner.go:17-38,59-158,343-381`**
- `Planner` builds a DAG from `needs`, then `createStages` produces **topological levels**
  (`Plan{ Stages: [][]*PlanJob }`) — a stage is a set of jobs that can run in parallel.
- This planner is the **client-side** DAG scheduler — the piece a real controller would take over.

**OpenForge takeaway:** the AST + topological planner is clean and reusable. If you build a
controller (option b), port `planner.go`'s DAG→stages logic to TypeScript/Postgres and keep the
AST shapes as your job model.

## ACT.3 — Expression evaluator

**`pkg/exprparser/interpreter.go:11,14-28,65-113,623-668`**
- Parser: **`actionlint`** (`github.com/rhysd/actionlint`) — reuses a battle-tested GHA expression
  parser rather than a homegrown one.
- Evaluator: a **reflection-based** walker over actionlint's AST (`EvaluationEnvironment`).
- **Contexts:** `github, env, job, jobs, steps, runner, secrets, vars, strategy, matrix,
  needs, inputs` (+ `infinity`/`nan` numeric constants).
- **Functions (11):** `contains, startswith, endswith, format, join, tojson, fromjson, hashfiles,
  always, success, failure, cancelled` (`pkg/exprparser/functions.go` registry).
- **Operators:** `!`, `&&`, `||`, comparison (`==,!=,<,>,<=,>=`), index `[i]`/`['key']`,
  member/deref `.x` / `.[]`.

**OpenForge takeaway:** **reuse actionlint** for parsing (don't re-implement the grammar). The
evaluator is small enough to port to TS, or — better — you keep expression evaluation
**server-side** at plan time (resolve what you can, defer the rest to the runner) and ship only
the residual `${{ }}` to the runner.

## ACT.4 — Runner abstraction

**`pkg/runner/runner.go:17-213,256-269`**
- `Runner` + `Config` — `Config` carries: `ArtifactServerPath/Addr/Port/AuthKey`,
  `ActionCacheDir`, `DockerHost`, `Workdir`, `PullImagePolicy`, `Secrets/Env/Inputs`, etc.
- `Runner.NewPlanExecutor(plan)` — takes a `Plan` (from §2) and produces an executor that runs
  stages sequentially, jobs in a stage in parallel.
- **Matrix expansion is client-side here:** `GetMatrixes` → `CartesianProduct` → one executor per
  combination (the opposite of Forgejo's server-side expansion).
- `run_context.go` — per-job execution context (env, secrets, outputs, masks, file refs to
  `GITHUB_OUTPUT`/`ENV`/`STATE`/`PATH`/`SUMMARY`).

**OpenForge takeaway:** the `Runner/Config` + `NewPlanExecutor` split is the clean seam between
"plan" and "execute." If you adopt act as a local executor (option b), this is the API you'd call
from your own thin controller loop.

## ACT.5 — Container backends

**Interface** `pkg/container/executions_environment.go:5-15`
```go
type ExecutionsEnvironment interface {
    Create(context.Context) error
    Copy(src, dst string) error
    CopyTarStream(reader io.Reader, dst string) error
    CopyDir(src, dst string) error
    Exec(context.Context, []string) error
    Remove(context.Context) error
    // ...
}
```
**Docker** `pkg/container/docker_run.go:70-219` — uses **`moby/moby` client** directly (not a
CLI): container create/start, image pull, network, volumes, log attach. `docker/` subdir adds
build, endpoint (docker-socket-v2), extensions.
**Host** `pkg/container/host_environment.go:28-376` — `HostEnvironment` runs steps directly on the
runner host (no container): `ExecWithCmdLine`, env setup, working-dir sandbox.

**Backends = Docker + Host ONLY.** No k8s, no Podman, no plugin (this is the gap Forgejo filled
with its plugin scheme, §ACT_RUNNER.4).

**OpenForge takeaway:** act's backend set is minimal (docker/host). For OpenForge you'll want
**Docker now, k8s later** — model k8s as a third `ExecutionsEnvironment` impl (or borrow
Forgejo's gRPC-plugin adapter so k8s stays out-of-process). The interface is the right shape.

## ACT.6 — Actions / action cache

**`pkg/runner/action_cache.go:25-90`** — action fetch cache is a **`go-git` bare, shallow fetch
(`Depth:1`)** of the action repo at the pinned ref. Caches on disk under `ActionCacheDir`, keyed by
owner/repo/ref. This is how `uses: actions/checkout@v4` gets materialized locally.
**`pkg/runner/local_repository_cache.go:25-48`** — a **local-override** cache: a directory of
vendored action repos that short-circuits the network fetch (for offline/air-gapped use).
**`pkg/runner/step_action_remote.go:53-116,291`** — the `uses:` download path: resolve ref
(tag/branch/SHA), fetch via the cache, extract `action.yml` / `Dockerfile`.

**OpenForge takeaway:** **pin-by-SHA + shallow-clone cache** is the secure default. For
OpenForge, proxy action fetches through your server (so you can enforce the **approval/trust**
policy — §ACT_RUNNER.10) and cache centrally (S3/CDN) rather than per-runner.

## ACT.7 — upload-artifact / local artifact server

**`pkg/artifacts/server.go:62-443,592`** — a **local HTTP server that emulates the GHA artifact
API** so stock `actions/upload-artifact`/`download-artifact` work unmodified:
- **v1** `/_apis/pipelines/.../artifacts` (legacy).
- **v4** `CreateArtifact` / `FinalizeArtifact` / `ListArtifacts` / **`GetSignedArtifactURL`** /
  `DeleteArtifact` (`artifacts_v4.go`) — the modern chunked + signed-URL protocol.
- **Symlink-safe** writes via `os.Root` (prevents path-traversal/`..` escapes out of the artifact
  dir).
- **Bearer auth** (`AuthKey`).

**`pkg/artifactcache/handler.go:29-393`** — a parallel **local cache server** emulating
`/_apis/artifactcache` (GHA cache API): `GET /cache`, `POST /caches`, `PATCH` (chunked upload w/
`Content-Range`), `POST` (commit), `GET` (download), `POST /clean`. Backed by **bolthold/BoltDB**;
key = prefix + regex.

**OpenForge takeaway:** this is the **gold reference** for a GHA-compatible artifact/cache API.
For OpenForge, back it with **S3 + signed URLs** (you already have S3) and keep the v4
`GetSignedArtifactURL` contract so stock actions work. The `os.Root` symlink-safety is a
must-keep security detail.

## ACT.8 — Reuse-of-GHA-actions model

- `uses:` forms handled: `owner/repo@ref` (remote, §6), `./local/path` (local, `step_action_local.go`),
  and **composite** (`action.yml` with `runs.using: composite`, §11).
- **`actions/checkout` is special-cased** (it must clone the *workflow's* repo, not an action repo).
- Actions run **in the job's container** (composite) or their own (Docker action) — the
  `ExecutionsEnvironment` from §5 is what runs them.
- Secrets to actions = env vars (GHA semantics); a composite action's children get `Secrets=nil`
  (see §11) — secrets must be explicitly passed as `with:` inputs.

**OpenForge takeaway:** stock-action compatibility is what makes `act`-based runners attractive.
Preserve the three `uses:` forms and the `actions/checkout` special-case, and you keep the whole
`@actions/*` ecosystem working.

## ACT.9 — Matrix (client-side)

- **`pkg/common/cartesian.go`** (~50 lines) — `CartesianProduct` over matrix axes (incl.
  `exclude` handling).
- Called from the runner (§4) **client-side**: `GetMatrixes` → `CartesianProduct` → parallel
  executors. `strategy.random-selector`/`max-parallel` also handled here.
- **Contrast:** Forgejo's runner expands this **server-side** (§ACT_RUNNER.8); act expands
  **client-side**. Same helper, different locus.

**OpenForge takeaway:** the cartesian helper is trivial and shared. Decide the locus: server-side
(for pool fan-out) — that's what a real platform needs.

## ACT.10 — act vs. act_runner (the fork decision matrix)

| Dimension | nektos/act (v0.2.95) | Forgejo runner (v13) |
|---|---|---|
| Role | standalone emulator | controller-client daemon |
| Controller | none (local file in) | remote (ConnectRPC) |
| Protocol | n/a | ConnectRPC + protobuf (actions-proto) |
| Matrix | client-side | server-side |
| DAG/planner | runs it (planner.go) | receives pre-expanded jobs |
| Backends | docker, host | docker, host, lxc, **gRPC plugin** |
| Cache | BoltDB local server + proxy | BoltDB + proxy + **PR write-isolation** |
| Artifacts | full local GHA API server (v1+v4) | cache-server / external |
| Secrets | env + context | env + context + **reporter redaction** |
| Redaction | log_sanitize (terminal seqs) + masks | `strings.Replacer` + `::add-mask::` at egress |
| Governance | none | **actions approval/trust**, `forgejo.*` ctx |
| Reusables | local + remote workflow_call | (delegated to server) |

**Decision framing for OpenForge:**
- **Option (a) fork act_runner + ship its protocol** → lowest-effort multi-runner, you inherit the
  ConnectRPC/protobuf surface + Forgejo's value-adds. Cost: Go runner (you're TS), coupling to
  Forgejo's module path/fork cadence.
- **Option (b) adopt act as local executor + own controller** → you keep act's executor brain
  (port or sidecar it), and build the controller (task queue, matrix fan-out, approval) in
  TS/Postgres. This is the **highest-leverage** path for a TS monorepo: the controller is your
  differentiator and it's the part act deliberately omits.
- **Option (c) from scratch** → only if you reject both Go codebases; you'd re-implement the
  executor (expensive — act's executor is the hard 80%) *and* the controller. Not recommended
  unless the license/dependency posture of both is disqualifying.
- **Recommendation signal:** the **protocol is small and stable** (fork-friendly) but the
  **executor is the valuable, hard part** (act's). For a TS platform, **hybrid of (b)** — your own
  TS controller speaking a forked ConnectRPC task queue, with the executor either ported or run as
  a sidecar — captures the value while keeping the control plane in your stack.

## ACT.11 — Reusable workflows & composite actions

**Composite** `pkg/runner/action_composite.go:13-124`
- A composite action (`runs.using: composite`) is a list of **child steps** executed in the
  **same container** as the calling job.
- The child `RunContext` is constructed with **`Secrets=nil`** — children can only see secrets
  explicitly passed via `with:` (GHA-correct security boundary). Masks are inherited.

**Reusable workflows** `pkg/runner/reusable_workflow.go:19-45,137,161-175`
- **Local** (`uses: ./.github/workflows/f.yaml`) and **remote** (`uses: owner/repo/.github/workflows/f@ref`).
- Modeled as a `workflow_call` plan; executed via a **nested runner** with a `caller` context so
  `github.workflow`/`github.head_ref` etc. resolve to the *caller's* values. `needs`/`inputs`/
  `secrets` passed per GHA reusable-workflow rules.

**OpenForge takeaway:** composite (`Secrets=nil`) and reusable (nested runner + `caller`) are
both GHA-faithful and non-trivial. If you port act, port these two files carefully — they encode
real security (composite secret isolation) and real DAG semantics (reusable `caller`).

## ACT.12 — Step.Run (the leaf)

**`pkg/runner/step.go:22-237`** — the `step` lifecycle:
- Each GHA step is split into **`pre` / `main` / `post`** sub-steps (for `timeout`/cleanup
  correctness).
- `runStepExecutor`: evaluates `if:`, **merges env** (job ← step ← `${{ }}` resolved), then
  dispatches to either `JobContainer.Exec` (docker) or `HostEnvironment.ExecWithCmdLine` (host).
- **File-based step outputs:** writes to `GITHUB_OUTPUT`/`GITHUB_ENV`/`GITHUB_STATE`/`GITHUB_PATH`/
  `GITHUB_STEP_SUMMARY` are implemented as **`workflow/*.txt` files** the step appends to
  (`name=value` / `name<<DELIM` heredoc), read back after `main` runs. This is the exact GHA
  mechanism — keep it.

**`pkg/runner/step_run.go:17-146`** — `Step.Run`:
- `setupShellCommand` builds the shell invocation (`shell` option, `/bin/sh -e -x -c` default).
- Branches **host vs docker** (§5) for the actual exec.
- Handles `working-directory`, `shell`, default-shell, and the pre/main/post wrapper.

**`pkg/runner/log_sanitize.go:12-116`** — **distinct from secret masking.** This strips
**terminal control / escape sequences** (colors, cursor codes) from step output for the log
sink. **Secret masking** is separate: `rc.Masks` (registered masks) applied by the job logger
(`pkg/runner/run_context.go:54,62`). Don't conflate the two when porting — one is hygiene
(terminal seqs), the other is security (secrets).

**OpenForge takeaway:** the `pre/main/post` split, the **`workflow/*.txt` output-file protocol**,
and the **shell setup** are the load-bearing leaf mechanics. Port these verbatim and your runner
will be GHA-step-compatible. Keep terminal-sanitization and secret-masking as **two separate
concerns** (the runner does the secret part at egress; act does the terminal-seq part at the sink).

---

# Cross-cutting recommendations for OpenForge

1. **Protocol:** fork the **ConnectRPC + protobuf task-queue surface** (7+1 methods,
   `actions-proto`). It's small, stable, and shared by Gitea+Forgejo — a de-facto standard.
   Re-implement the server in TS (connect-web) + Postgres; keep the runner dumb.
2. **Locus of intelligence:** **server-side** matrix expansion + DAG planning (Forgejo model), not
   client-side (act model). Postgres is the natural home for the versioned, idempotent task queue.
3. **Executor:** act's executor is the hard 80%. Either **port the `act/runner` + `act/exprparser`
   + `act/model/planner` core to TS** (reuse actionlint via WASM or a JS port for expressions), or
   **run a Go act sidecar** behind your TS controller. The `pre/main/post` + `workflow/*.txt`
   output protocol must be preserved verbatim for GHA compatibility.
4. **Backends:** implement `ExecutionsEnvironment` for **Docker now**; add **k8s** as a third impl
   (or borrow Forgejo's **gRPC-plugin** adapter to keep k8s out-of-process).
5. **Artifacts:** S3 + **v4 `GetSignedArtifactURL`** contract (act's local server is the reference
   API). Keep `os.Root` symlink-safety. Decouple artifacts from cache.
6. **Cache:** S3-backed, with act/Forgejo's **two-job proxy**: per-run namespacing + **PR
   write-isolation** (security).
7. **Secrets:** controller-side (Postgres, encrypted), **per-task push**, env-inject, and
   **`strings.Replacer`-style redaction at the single log egress** + `::add-mask::` support.
8. **Governance:** adopt **actions approval/trust** (allow-list + approval for non-pinned / fork
   actions) — the one Forgejo feature that is a security must for a shared platform.
