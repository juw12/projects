# Self-Hosted CI/CD Pipeline Engines - Primary-Source Reference for OpenForge Architect

> **Method & provenance.** Every claim is anchored to a file path + line range at a specific commit. All 6 repos were cloned at known SHAs and the schema/agent source was read directly; metadata cross-checked via the GitHub API (2026-11-03). **Tooling note:** `context7` was quota-limited at runtime, so doc lookups fell back to official docs + the vendored source itself (stronger primary evidence for an architect).

**Commit SHAs used for permalinks:**

| Engine | Repo | SHA |
|---|---|---|
| Woodpecker | `woodpecker-ci/woodpecker` | `02f61d5563812d68cb27cbe6ecd1889ad85f4b02` |
| Drone 2.0 | `harness/drone` -> **`harness/harness`** | `1852fedc41b8c1fabd96208f4b09264717004314` |
| Drone spec | `drone/spec` | `36d0519211d7abfcd003d97f02e940c6c65be976` |
| Drone runner | `drone-runners/drone-runner-docker` | `58f896ddd9292ecc8eb03ed93d1e1cdb23002c25` |
| Buildkite agent | `buildkite/agent` | `fb25363c9ea8dd81c02936e32b5ce5f8d38269d5` |
| Concourse | `concourse/concourse` | `352512db1243de2e2e4e6e06e73ce1c9cc0cd235` |
| Tekton | `tektoncd/pipeline` | `d55f53a622c2bd82e89ce7c1b6cd59d52b24849c` |
| Prow | `kubernetes-sigs/prow` (moved from `k8s/test-infra`) | `43ed234002b9831fc0b8100c3c467f2146dbc8e3` |
| test-infra (tombstone) | `kubernetes/test-infra` | `937e7006c214b85c8451b06917e855e0282c6d1f` |

**Two headline architectural facts (both verified from source, not marketing):**
1. **`harness/drone` no longer exists as a standalone CI.** The URL redirects to **`harness/harness`**, whose `go.mod` declares `module github.com/harness/gitness` - i.e. Drone is now the CI component inside **Gitness**, Harness's combined Git-server + CI/CD + CDE + registry platform. The classic `.drone.yml` schema was extracted to a separate **`drone/spec`** module, and a **redesigned "spec v2"** (stages + typed steps) is in active development. (`harness/harness/go.mod:1`, `drone/spec/samples/kitchensink.yaml:1-230`)
2. **Prow left `kubernetes/test-infra` on April 9, 2024** and now lives in **`kubernetes-sigs/prow`**. The `test-infra/prow/` dir is a one-file README tombstone. (`kubernetes/test-infra@937e700 prow/README.md`)

---

# 1. Woodpecker CI

## A. Pipeline definition surface

- **File format / default filename:** YAML. `.woodpecker.yml` at repo root, **or** a `.woodpecker/` directory holding multiple `*.yaml` pipeline files (each file = one "workflow"). The project's own dogfooding config is a directory of files.
  - Evidence: `.woodpecker/` contains `test.yaml`, `docker.yaml`, `release-helper.yaml`, `docs.yaml`, `social.yaml`, `static.yaml`, etc. (`.woodpecker/test.yaml:1-187`)
- **Top-level schema.** A `.woodpecker.yml` is a single `Workflow`. The user-facing struct is `Workflow` (`pipeline/frontend/yaml/types/workflow.go:23-35`):

```go
// pipeline/frontend/yaml/types/workflow.go:23-35
type Workflow struct {
    When        constraint.When      `yaml:"when,omitempty"`
    Workspace   Workspace            `yaml:"workspace,omitempty"`
    Clone       ContainerList        `yaml:"clone,omitempty"`
    Steps       ContainerList        `yaml:"steps,omitempty"`
    Services    ContainerList        `yaml:"services,omitempty"`
    Labels      map[string]string    `yaml:"labels,omitempty"`
    DependsOn   constraint.DependsOn `yaml:"depends_on,omitempty"`
    Concurrency Concurrency          `yaml:"concurrency,omitempty"`
    SkipClone   bool                 `yaml:"skip_clone,omitempty"`
    RunsOn      []string             `yaml:"runs_on,omitempty"` // deprecated -> when
}
```

  - **Compile path:** `Compiler.Compile(conf *yaml_types.Workflow) (*backend_types.Config, error)` (`pipeline/frontend/yaml/compiler/compiler.go:121-287`). It (a) evaluates `when`, (b) auto-injects a `clone` step unless `skip_clone`, (c) builds a services stage, (d) compiles `steps` into a DAG via `depends_on` (`newDAGCompiler(...).compile()`, `compiler.go:271`). Output IR is `backend_types.Config{Stages, Network, Volume, Secrets}` (`pipeline/backend/types/config.go:18-23`).
  - **Step/Container fields** (the runtime step): `Name, Image, Pull, Detached, Privileged, WorkingDir, WorkspaceBase, Environment, SecretMapping, Entrypoint, Commands, ExtraHosts, Volumes, Tmpfs, Devices, Networks, DNS, DependsOn, OnFailure, OnSuccess, Failure, AuthConfig, NetworkMode, Ports, BackendOptions` (`pipeline/backend/types/step.go:18-49`). Step types: `clone | service | plugin | commands | cache` (`step.go:54-60`).
  - **Secrets reference:** a plugin step pulls a secret with `from_secret:` (example below, `test.yaml:166-167`). Server-side secrets are matched per-event and per-image (plugin allowlist) in `compiler.go:42-79` (`Secret.Available` / `Secret.Match`).
  - **DB models** (what gets persisted per run): `Workflow` has `PipelineID, PID, Name, State, AgentID, Platform, Environ, DependsOn, AxisID, Children []*Step` (`server/model/workflow.go:19-34`); `Step` has `UUID, PipelineID, PID, PPPID, State, ExitCode, Type, DependsOn` (`server/model/step.go:26-41`). `AxisID` on the workflow is the matrix-axis discriminator.
  - **Linter/schema:** a JSON-schema-backed linter validates pipeline files (`pipeline/frontend/yaml/linter/`, with fixture schemas under `pipeline/frontend/yaml/linter/schema/.woodpecker/`).

**Verbatim - Woodpecker's own `.woodpecker/test.yaml` (abridged; full file is 187 lines):**

```yaml
# .woodpecker/test.yaml:1-46  (YAML anchors for shared when/path)
variables:
  - &golang_image 'docker.io/golang:1.27'
  - &when
    - path: &when_path
        - '.woodpecker/test.yaml'
        - '**/*.go'
      event: pull_request

when:
  - event: pull_request
  - event: push
    branch: ${CI_REPO_DEFAULT_BRANCH}
    path: *when_path

steps:
  vendor:
    image: *golang_image
    commands: [ go mod vendor ]
    when:
      path: [ <<: *when_path, '.woodpecker/**' ]

  lint:
    depends_on: [ vendor ]          # DAG ordering
    image: golangci/golangci-lint:v2.15.0
    commands: [ make lint ]
    when: *when

  codecov:                          # plugin step + secret injection
    depends_on: [ test, sqlite ]
    pull: true
    image: docker.io/woodpeckerci/plugin-codecov:2.3.3
    settings:
      files: [ agent-coverage.out, coverage.out ]
      token:
        from_secret: codecov_token  # <-- secret ref (server-stored, env-injected)
    when:
      path: *when_path
    failure: ignore                 # ignore|fail|cancel

services:
  postgres:
    image: docker.io/postgres:18
    ports: ['5432']                 # reachable by name from steps on shared net
    environment:
      POSTGRES_USER: postgres
      POSTGRES_HOST_AUTH_METHOD: trust
    when: *when
```

- **GHA-equivalent features:**
  - **matrix:** YES. The compiler fans a workflow into per-axis executions (`Workflow.AxisID`, `server/model/workflow.go:32`; backend emits one `Config` per axis). Supports `include`/`exclude` per the v3 schema.
  - **`when` filters** (event/branch/tag/path/ref) - richer than GHA `if` for path scoping (`pipeline/frontend/yaml/constraint/`).
  - **services with networking:** YES - `services:` share a network with steps (`compiler.go:209-227` builds a services stage; default network `<prefix>_default`, `compiler.go:140`).
  - **`depends_on` DAG:** YES (steps can be a map or a list).
- **NOT present (vs GHA):**
  - **composite actions / reusable workflows:** NO first-class equivalent. Multiple files in `.woodpecker/` are independent workflows; no cross-file `depends_on` or `uses: owner/repo@ref` callable.
  - **OIDC workload identity:** not built-in (no workload-token minting in the schema; auth is via `from_secret` / registry `AuthConfig`, `step.go:44`).
  - **matrix.exclude:** present in v3 but path/matrix interplay is less battle-tested than GHA.

## B. Runner / agent architecture

- **Agent is a separate binary** from the server. `cmd/` has distinct `agent`, `server`, `cli` dirs.
- **Protocol = gRPC long-poll, NOT websocket.** The agent `Runner` holds an `rpc.Peer` client and calls `r.client.Next(ctx, filter)` to pull the next workflow (`agent/runner.go:82-93`). The gRPC service is defined in `rpc/proto/woodpecker.proto:26-37`:

```proto
// rpc/proto/woodpecker.proto:26-37
service Woodpecker {
  rpc Next            (NextRequest)          returns (NextResponse) {}  // long-poll for work
  rpc Init            (InitRequest)          returns (Empty) {}
  rpc Wait            (WaitRequest)          returns (WaitResponse) {}
  rpc Done            (DoneRequest)          returns (Empty) {}
  rpc Update          (UpdateRequest)        returns (Empty) {}
  rpc Log             (LogRequest)           returns (Empty) {}
  rpc RegisterAgent   (RegisterAgentRequest) returns (RegisterAgentResponse) {}
  rpc UnregisterAgent (Empty)                returns (Empty) {}
  rpc ReportHealth    (ReportHealthRequest)  returns (Empty) {}
}
```
  - **Registration:** the agent authenticates via a separate `WoodpeckerAuth` service (`rpc/proto/woodpecker.proto:157-158`), then `RegisterAgent`. Work is dispatched by **label filter** (`rpc.Filter`, `agent/runner.go:42`) - agents advertise labels, the server routes matching workflows.
- **Container runtime (backends):** the agent is backend-agnostic via `backend_types.Backend` (`agent/runner.go:46,56`). Shipped backends: **docker** and **kubernetes** (`e2e/scenarios/agent_routing_test.go`; issue `#1447` "Specifying resources for kubernetes runners"). Each backend implements `Init/Wait/Done` against the gRPC lifecycle.
- **Concurrency model:** **N concurrent workflows per agent** - the agent spawns worker goroutines (one per CPU / configurable) and each independently blocks on `Next`. One agent = many jobs. (`agent/runner.go`, `agent/state.go`)

## C. Secret & artifact flow

- **Secrets:** stored **server-side in the DB** (encrypted), scoped by event + plugin-image allowlist (`compiler.go:42-79`). Injected into the container **as environment variables** resolved by `from_secret:` at compile time; a `SecretMapping` on the step (`step.go:30`) + `pipeline/shared/secrets_writer.go` write them to the runtime. Not K8s secrets, not Vault (unless you point the server datastore at one).
- **Artifacts between jobs:** Woodpecker has **no native S3 artifact bus in the core schema** - cross-step data is shared via the **workspace volume** (default volume `<prefix>_default`, `config.go:21`) on a single agent, or via **plugins** (e.g. the `codecov` plugin reading files, `test.yaml:158-165`). For cross-agent/cross-machine you use a plugin that pushes to object storage. This is a known weakness vs GHA `actions/upload-artifact`.

## D. Strengths & weaknesses (2026)

**Strengths**
- **Cleanest "bolt onto your Git server" model** of the six: thin server + stateless label-routed gRPC agents; trivial to run an agent anywhere (docker/k8s). (`agent/runner.go:82-93`)
- **Active & fast release cadence:** v3.20.1 published 2026-10-29, pushed 2026-11-03; ~698 contributors; 8,099 stars. A real e2e scenario suite (`e2e/scenarios/`).
- **Modern schema ergonomics:** `when` path filters, DAG `depends_on`, YAML anchors, `failure: ignore|fail|cancel` - closer to a GHA mental model than Drone/Concourse.

**Weaknesses**
- **No reusable/composite workflows and no OIDC workload identity** (see A). A gap for teams standardizing on GHA `uses:`.
- **Artifacts are second-class** (workspace/plugin-based, no built-in S3 bus) - friction for distributed runners.
- **Stability/edge bugs in the server & k8s backend** are visible in the tracker, e.g. `#6454` "woodpecker server panics & crashes at times" and the security-adjacent `#3924` (secret/privileged escalation via escalated plugins + workspace).

**Adoption signal:** 8,099 stars / ~698 contributors / 368 open issues / v3.20.1 (2026-10-29) / Apache-2.0 / Go.

## E. License, language, self-host complexity

- **License:** Apache-2.0. **Language:** Go.
- **DB:** **Postgres, MySQL, or SQLite** - driver is a flag, proven by its own CI: `WOODPECKER_DATABASE_DRIVER: sqlite3|postgres|mysql` (`.woodpecker/test.yaml:124,135,146`). xorm ORM (`server/model/*`).
- **Object store:** none required for core; only for artifact plugins.
- **Self-host complexity: LOW.** One server container + one DB + N agent containers. No K8s required (k8s is an optional backend). Easiest of the six to run.

---

# 2. Drone 2.0 (now "Harness Open Source / Gitness")

## A. Pipeline definition surface

- **File format / default filename:** YAML. Classic: `.drone.yml` (and multi-pipeline `.drone/` dir). **Critical 2024+ change:** the schema was **extracted to a standalone module** `github.com/drone/spec` (imported by the server: `harness/harness/go.mod` requires `github.com/drone/spec`, `github.com/drone/drone-yaml v1.2.3`, `github.com/drone/runner-go v1.12.0`, `github.com/drone-runners/drone-runner-docker v1.8.4`). The spec repo generates both a JSON schema and a Go parser (`drone/spec/README.md:1-20`, `drone/spec/schema/*.yaml`, `drone/spec/dist/go/parse/...`).
- **Two schemas coexist - this is the before/after you need:**
  - **Classic (what "Drone 2.0" means to most people):** `kind: pipeline`, `type: docker|kubernetes`, top-level `steps` (each = `image` + `commands`/`when`/`environment`), `services`, `clone` (depth/disable/auto/pull), `volumes`, `environment`, `secrets` (`from_secret`), `matrix` (axes), `platforms` (os/arch/variant), `depends_on`.
  - **New "spec v2" (in development, the direction of travel):** a `version: 1 / kind: pipeline / spec:` envelope with **`inputs`**, **`stages`**, and **typed steps**. The canonical full example is `drone/spec/samples/kitchensink.yaml:1-230`.
  - **Note on the DB models in the monorepo:** `harness/harness/types/pipeline.go:19-41` is the *persisted* Pipeline record (id, repo_id, config_path, seq), not the YAML schema - a reminder that the YAML contract now lives in `drone/spec`.

**Verbatim - the NEW spec v2 `kitchensink.yaml` (abridged; full is 230 lines):**

```yaml
# drone/spec/samples/kitchensink.yaml:1-96 (spec v2 - stages + typed steps)
version: 1
kind: pipeline
spec:
  inputs:
    username: { type: string, description: user identifier }
    abool:    { type: boolean }
  stages:
  - id: build
    type: ci
    spec:
      clone:  { disabled: false }
      cache:  { enabled: true, key: foo, paths: [path/foo, path/bar] }
      envs:   { foo: bar, baz: qux }
      platform: { os: linux, arch: arm64, variant: v7 }
      runtime:  { type: cloud, spec: { size: standard } }
      volumes:
        - name: foo
          type: host
          spec: { path: /path/on/host }
      steps:
        - id: go-build
          type: script
          spec:
            image: golang
            run: |
              go build
              go test
            shell: bash
            envs: { foo: bar }
            network: host
            pull: if-not-exists
            reports: [ { path: /path/to/report.xml, type: junit } ]
            failure:
              errors: [ all ]
              action: { type: retry, spec: { attempts: 3 } }
        - type: plugin
          spec:
            image: plugins/docker
            with: { repo: foo/bar }
        - type: background        # sidecar service
          spec: { image: redis, entrypoint: "/bin/redis", args: ["--foo"] }
        - type: parallel          # fan-out group
          timeout: 10m
          spec:
            steps:
              - { type: script, spec: { run: go build } }
              - { type: script, spec: { run: npm test } }
        - type: template          # reusable named template w/ inputs
          spec: { name: template1, inputs: { foo: bar } }
```

- **GHA-equivalent features:**
  - **matrix:** classic has `matrix:` axes; the new spec has a `parse/expand/matrix` package (`drone/spec/dist/go/parse/expand/matrix/matrix.go`). **`matrix.exclude` is NOT a first-class classic feature** (a long-standing gap).
  - **services:** classic `services:`; new spec `type: background` step.
  - **secrets:** `from_secret` (env-injected).
  - **reusable:** new spec adds `type: template` (referencing named templates with inputs) - a partial GHA-composite analog. Classic had none.
- **NOT present:** **OIDC workload identity** (none), **matrix.exclude** (classic), first-class **artifact S3 bus** (plugins only), and the spec is **mid-migration** (see below) - a real adoption risk.

## B. Runner / agent architecture

- **Agent is separate from server.** The docker runner is now its **own module**: `github.com/drone-runners/drone-runner-docker` (required at `v1.8.4`, `harness/harness/go.mod`), with runner abstraction in `github.com/drone/runner-go v1.12.0`. `drone-runner-docker/main.go` is a standalone binary.
- **Protocol:** the server enqueues jobs; runners **poll/queue** for work (pubsub-backed queue in `harness/harness/pubsub/`, job dispatch in `harness/harness/job/`). Not websocket - a queue/long-poll model. The server also runs `livelog/`, `stream/`, `cache/` (S3/MinIO cache server), `secret/` packages (`harness/harness/{livelog,stream,cache,secret}`).
- **Container runtime:** **docker** (drone-runner-docker) and **kubernetes** (drone-runner-k8s). The new spec adds `runtime: {type: cloud}` (managed), `kitchensink.yaml:37-40`.
- **Concurrency:** runner process spawns N parallel jobs (drone-runner-docker `--capacity`). One runner = many jobs.

## C. Secret & artifact flow

- **Secrets:** server DB (encrypted at rest via `harness/harness/crypto/` + `secret/`), injected as **env vars** via `from_secret`. `harness/harness/types/secret.go` + `secret_ref.go`.
- **Artifacts/cache:** a **dedicated cache service** (`harness/harness/cache/`) backed by **S3/MinIO** (the `blob/` package wraps object storage). Cross-step sharing on one runner is via workspace volume; cross-machine via the cache server. No GHA-style `actions/artifact` upload/download primitive in the classic schema.

## D. Strengths & weaknesses (2026)

**Strengths**
- **Largest brand/install base** of the "bolt-on" group: 38,802 stars (inherited by the Gitness monorepo), 3,451 forks.
- **Modularization is architecturally honest:** splitting `spec`, `runner-go`, `runner-docker` into separate Go modules (`go.mod`) makes the runner independently versionable - a clean pattern to borrow.
- **The new spec v2 is genuinely more expressive** (typed steps, `failure` retry/manual-intervention actions, `reports`, `barrier`, `template`, `parallel/group`) - see `kitchensink.yaml`.

**Weaknesses**
- **It is no longer a standalone CI you can just `docker run`.** `harness/drone` -> `harness/harness` = the Gitness platform (Git + CI + CDE + registry). Forking "Drone 2.0" now means forking a much bigger, Git-coupled monorepo (`types/` imports `github.com/harness/gitness/types/enum`, e.g. `types/step.go:21`).
- **Schema mid-migration risk:** classic `.drone.yml` and spec v2 coexist; spec v2 is not final (the sample is full of `# need to finalize` / `# TODO` comments, `kitchensink.yaml:30,65,85`). Forking now means inheriting an unsettled contract.
- **Contributor base on the new repo is thin** (~95 on `harness/harness`) and the classic community largely migrated to Woodpecker (the Drone fork) - a momentum problem. v2.28.2 was published 2026-04-20 (slower cadence than Woodpecker/Concourse).

**Adoption signal:** 38,802 stars (monorepo) / ~95 contributors on `harness/harness` / 126 open issues / v2.28.2 (2026-04-20) / Apache-2.0 / Go.

## E. License, language, self-host complexity

- **License:** Apache-2.0. **Language:** Go.
- **DB:** **Postgres** (Gitness uses Postgres; MySQL support is limited). ORM via squirrel + `store/`.
- **Object store:** **S3/MinIO** required for the cache/artifact service (`blob/`, `cache/`).
- **Self-host complexity: MEDIUM-HIGH now.** You are standing up Gitness (Git + CI + CDE + registry + Postgres + S3), not a lean CI. If you only want the CI, the cleanest path is to consume the `drone/spec` + `runner-go` + `runner-docker` modules, not the monorepo.


---

# 3. Buildkite (agent + pipeline schema)

> Buildkite's **server is closed-source/commercial**; the **agent is open-source** (`buildkite/agent`, MIT). The pipeline schema is defined server-side, but the agent is the reference for what a step/job looks like, and the agent repo ships a real, rich dogfooding pipeline (`.buildkite/pipeline.yml`, 579 lines) - the best primary sample of the schema in open code.

## A. Pipeline definition surface

- **File format / default filename:** YAML (or JSON), typically `.buildkite/pipeline.yml`. Uploaded via `buildkite-agent pipeline upload` (`clicommand/pipeline_upload.go`) or the API (`api/pipelines.go`, GraphQL in `internal/bkgql/pipeline.graphql`).
- **Top-level schema (from the real dogfood pipeline, `agent/.buildkite/pipeline.yml:1-579`):** `env` (global), `agents` (queue routing), `steps` (list). Step keys observed in the wild:
  - `name`, `label`, `key` (stable id used by `depends_on`)
  - `command` (shell), `env`
  - `if:` / `if_changed:` (condition + path-scoping; e.g. `if: build.branch == "main"`, `pipeline.yml:560`)
  - `plugins` (versioned refs: `docker-compose#v4.14.0`, `aws-assume-role-with-web-identity#v1.4.0`, `tests#v1.0.0`, `pipeline.yml:28-46`)
  - `artifact_paths` (upload), `depends_on` (on `key`), `parallelism`
  - `retry: { automatic: [ {exit_status: 1, limit: 3} ] }` (`pipeline.yml:215-218`)
  - `soft_fail: true` (`pipeline.yml:93`), `allow_dependency_failure: true` (`pipeline.yml:329`)
  - `matrix: { setup: {...}, adjustments: [ {with:{...}, skip:"..."} ] }` (`pipeline.yml:362-391, 439-478`)
  - `group: { label, steps: [...] }` (`pipeline.yml:110-334`)
  - `trigger:` (downstream pipeline) + `async:` + `build: {message, commit, branch, env}` (`pipeline.yml:395-407`)
  - `agents: { queue: ... }` per-step routing (`pipeline.yml:160-161`)

**Verbatim - Buildkite dogfood pipeline (abridged from `agent/.buildkite/pipeline.yml`):**

```yaml
# buildkite/agent@fb25363 .buildkite/pipeline.yml (matrix + adjustments + trigger)
env:
  BUILDKITE_AGENT_CACHE_STORE_URL: "s3://bk-agent-cache-...?region=us-east-1"
agents:
  queue: "$AGENT_RUNNERS_LINUX_QUEUE"
steps:
  - name: ":go: Lint"
    key: check-code-committed
    command: .buildkite/steps/check-code-committed.sh
    if_changed: [ "go.{mod,sum}", "**.go" ]
    plugins:
      - aws-assume-role-with-web-identity#v1.4.0:   # OIDC workload identity
          role_arn: "arn:aws:iam::...:role/pipeline-buildkite-agent"
      - docker-compose#v4.14.0:
          config: .buildkite/docker-compose.yml
          run: lint
  - name: ":{{matrix.os}}: Build {{matrix.os}} {{matrix.arch}}"
    command: ".buildkite/steps/build-binary.sh {{matrix.os}} {{matrix.arch}}"
    key: build-binary
    artifact_paths: "pkg/*"
    matrix:
      setup:
        os:   [ darwin, freebsd, linux, openbsd, windows ]
        arch: [ "386", amd64, arm64 ]
      adjustments:                                   # == matrix.exclude equivalent
        - with: { os: darwin, arch: "386" }
          skip: "macOS no longer supports x86 binaries"
        - with: { os: linux, arch: ppc64le }
  - label: ":end: E2E Testing"
    key: e2e-tests
    depends_on: build-binary
    trigger: agent-e2e-tests                          # == reusable/downstream pipeline
    async: false
    build: { message: "${BUILDKITE_MESSAGE}", branch: "${BUILDKITE_BRANCH}" }
  - group: ":docker: Docker Image Builds"
    steps:
      - name: ":docker: {{matrix}} image build"
        key: build-docker
        matrix: { setup: [ alpine, alpine-k8s, ubuntu-24.04, sidecar ] }
        command: ".buildkite/steps/build-docker-image.sh {{matrix}}"
  - name: ":win: Windows AMD64 Tests"
    command: "bash .buildkite\\steps\\tests.sh"
    parallelism: 2
    retry:
      automatic:
        - exit_status: 1
          limit: 3
    agents: { queue: $AGENT_RUNNERS_WINDOWS_QUEUE }
```

- **GHA-equivalent features:**
  - **matrix with `adjustments`/`skip`** = a direct **`matrix.exclude` equivalent** (and more, since adjustments can also *add* variants). Strongest matrix-exclude story of the six.
  - **`if:`** expressions (`build.branch == "main"`, `=~` regex) - GHA-`if`-like.
  - **reusable workflows:** YES, via **`trigger:`** (downstream pipeline) + **versioned `plugins`** (composite-action analog).
  - **OIDC workload identity:** YES - native. `aws-assume-role-with-web-identity` plugin + agent-minted OIDC tokens (`oidc-lifetime: 7200` in `tests#v1.0.0`, `pipeline.yml:135`).
  - **services:** via `docker-compose` plugin (sidecar services), not a top-level `services:` key.
- **NOT present (vs GHA):** no top-level `services:` key (plugin-mediated), no first-class `actions/` composite dir, and the **schema lives server-side** (closed) - you cannot fully pin/audit the schema from OSS.

## B. Runner / agent architecture

- **Agent is a separate binary** (`buildkite/agent`, MIT, v4.9.0, 2026-10-30). Module path `github.com/buildkite/agent/v4` (`agent/agent_worker.go:15`).
- **Protocol = gRPC streaming OR long-poll - it supports both.** `agent/agent_worker.go:24-30` defines `PingModeAuto | PingModeStreamOnly | PingModePollOnly`. Streaming uses `connectrpc.com/connect` (connect-gRPC) - `agent/agent_worker_streaming.go`; polling uses the REST API (`api.Client`, `agent_worker.go:73`). The agent registers and receives an `api.AgentRegisterResponse` (`agent_worker.go:85`). Heartbeat/ping watchdogs: `agent_worker_heartbeat.go`, `agent_worker_ping.go`, `agent_watchdog.go`, `agent_worker_debouncer.go`.
- **Container runtime:** the agent runs jobs on the host; **docker** (docker executor), **kubernetes** (`agent/kubernetes/` - agent can schedule pods; `k8s_tags.go`), **exec** (run the command directly), plus **ssh** (agent can target remote hosts) and **process** (bare). Cloud-aware metadata: `ec2_meta_data.go`, `gcp_metadata.go`, `ecs_meta_data.go`.
- **Concurrency:** **N workers per agent** - `SpawnIndex` (`agent_worker.go:48`) + `--max-in-flights`. One agent process = many concurrent jobs; scale by running more agents/containers. `core/job_controller.go` drives job lifecycle.

## C. Secret & artifact flow

- **Secrets:** stored **server-side** (closed), injected into the job as **env vars** (referenced in `env:`). The agent receives an access token (`BUILDKITE_AGENT_ACCESS_TOKEN`, `pipeline.yml:41`). **OIDC** is the modern path for cloud creds (no long-lived secrets).
- **Artifacts:** first-class. Steps declare `artifact_paths:` to **upload**; the `artifacts#v1.9.4: download:` plugin pulls them (`pipeline.yml:287-288, 303-304`). The bus is **S3-compatible object storage** (their own cache uses `s3://`, `pipeline.yml:4`). Mature, explicit artifact model.

## D. Strengths & weaknesses (2026)

**Strengths**
- **Best-in-class matrix + conditions + OIDC** (`matrix.adjustments/skip`, `if:`, `aws-assume-role-with-web-identity`) - closest to a "GHA superset" of the six (`pipeline.yml:362-391, 560`).
- **Agent is genuinely multi-transport & multi-runtime** (streaming + polling, docker/k8s/exec/ssh) and very production-hardened (579-line dogfood pipeline, `v4.9.0`).
- **Explicit, S3-backed artifact + cache model** is clean to reason about.

**Weaknesses**
- **Server is closed-source/commercial.** You cannot self-host the *server* from OSS; only the agent. For an architect wanting to fork the *engine*, this disqualifies Buildkite as a codebase to fork - it is only a schema/agent pattern to borrow.
- **Schema is not fully auditable from OSS** (server-side); the agent only reveals the job/step side.
- **Open agent repo has modest momentum** (~260 contributors, 1,101 stars, 112 open issues) relative to its commercial weight; OSS issues skew to edge cases (e.g. `#1024` "Run docker container as non-root" still open, `#4525` k8s plugin-filter bug, `#1929` job distribution across hosts).

**Adoption signal:** agent 1,101 stars / ~260 contributors / v4.9.0 (2026-10-30) / MIT / Go. (Server: closed, commercial.)

## E. License, language, self-host complexity

- **License:** Agent **MIT**; server **proprietary**. **Language:** Go.
- **DB:** server-side (closed); the agent needs none.
- **Object store:** **S3-compatible** for artifacts/cache.
- **Self-host complexity:** Agent = LOW (one binary, needs an access token + server URL). Full platform = N/A from OSS.

---

# 4. Concourse CI

## A. Pipeline definition surface

- **File format / default filename:** YAML, `pipeline.yml`, applied with `fly set-pipeline -c pipeline.yml` (CLI in `fly/`). Concourse's model is fundamentally **different**: a pipeline is a **resource graph**, not a list of jobs.
- **Top-level schema.** `Config` (`atc/config.go:20-29`):

```go
// atc/config.go:20-29
type Config struct {
    Groups        GroupConfigs     `json:"groups,omitempty"`
    VarSources    VarSourceConfigs `json:"var_sources,omitempty"`
    Resources     ResourceConfigs  `json:"resources,omitempty"`
    ResourceTypes ResourceTypes    `json:"resource_types,omitempty"`
    Prototypes    Prototypes       `json:"prototypes,omitempty"`
    Jobs          JobConfigs       `json:"jobs,omitempty"`
    Display       *DisplayConfig   `json:"display,omitempty"`
    UserData      any              `json:"user_data,omitempty"`
}
```

  - **`ResourceConfig`** (`atc/config.go:180-193`): `name, type, source, check_every, check_timeout, tags, version, public, webhook_token`. A resource is a *versioned external input* (git, registry-image, s3, time, custom) that the ATC **checks** on an interval (`check_every` supports `"never"` or a duration, `config.go:227-251`).
  - **`JobConfig`** (`atc/job_config.go:3-28`): `name, public, serial, interruptible, serial_groups, max_in_flight, tags, build_log_retention, on_success/on_failure/on_abort/on_error, ensure, plan`. **`plan` is a list of `Step`s** (`atc/job_config.go:27`). `MaxInFlight()` collapses `serial`/`serial_groups` to 1 (`job_config.go:83-93`).
  - **Step types** (`atc/steps.go:294-676`): `get` (fetch a resource version, `GetStep:294-303` - note `passed`, `trigger`, `version: every|latest|pinned`), `put` (publish, `PutStep:317-326` - note `inputs: all|detect|[...]`, `no_get`), `task` (run a container, `TaskStep:340-354` - `image`, `privileged`, `hermetic`, `input_mapping`, `output_mapping`, `container_limits`), `run`, `set_pipeline`, `load_var`, `try`, `do`, `in_parallel` (with `limit`/`fail_fast`, `:423-436`), **`across`** (matrix fan-out, `AcrossStep:486-490` with `max_in_flight: all|N`), `attempts` (retry, `:508-511`), `timeout` (`:525-531`), and hooks `on_success/on_failure/on_error/on_abort/ensure` (`:545-616`). Step parsing is a precedence-wrapped envelope: modifiers wrap core steps, one core step max (`atc/steps.go:47-108`, `StepPrecedence:223-292`).

**Verbatim - Concourse's own smoke pipeline (`integration/ops/pipelines/smoke-pipeline.yml:1-22`):**

```yaml
# concourse@352512d integration/ops/pipelines/smoke-pipeline.yml
resources:
- name: mockery
  type: mock

jobs:
- name: say-hello
  plan:
  - get: mockery                       # fetch a resource version (input)
  - task: hello
    config:
      platform: linux
      image_resource:
        type: mock
        source: {mirror_self: true}
      run:
        path: echo
        args: ["Hello, world!"]
  - put: mockery                       # publish (output)
    params: {version: put-version}
```

A realistic job with matrix + passed-constraints (idiomatic shape per the structs above):

```yaml
resources:
- name: repo
  type: git
  source: {uri: https://example.com/repo.git}
  check_every: 1m
- name: tooling
  type: registry-image
  source: {repository: alpine}

jobs:
- name: test
  public: true
  serial_groups: [ci]
  plan:
  - get: repo
    trigger: true            # build when a new commit appears
    passed: [build]          # only versions that already passed 'build'
  - get: tooling
  - across:                  # == matrix
      var: os
      values: [linux, windows]
      max_in_flight: 2
      do:
      - task: run
        config:
          platform: linux
          image_resource: {type: registry-image, source: {repository: alpine}}
          inputs: [repo]
          run: {path: bash, args: [repo/ci/test]}
  on_failure:
    put: notify
    params: {text: "((pipeline_name)) failed"}
```

- **GHA-equivalent features:**
  - **matrix:** YES, via **`across`** (with `max_in_flight`) - `atc/steps.go:486-490`. No GHA-style `matrix.exclude` key, but `across` + `in_parallel.limit` covers fan-out + throttling.
  - **version constraints / input caching:** **`get` with `passed:` and `trigger:`** - a *unique* strength (inputs are content-addressed, versioned, deduped across jobs).
  - **secrets:** via **vars** (`((var))`), **`load_var`** step (`atc/steps.go:395-404`), **var_sources** (`config.go:79-85`), and a **credential manager** (vault/awssm/sops, `atc/creds/`) - NOT `from_secret`.
  - **reusable:** `resource_types` (custom resource types), `prototypes` (`atc/config.go:25,206-215`), `set_pipeline` (pipeline-as-code).
- **NOT present:** no `services:` key (sidecar = extra `task`/`get`), no composite actions, no first-class **OIDC workload identity** (OIDC/OAuth2 is for *user login* via `skymarshal/`, not workload tokens), and the **resource model has a steep learning curve** vs GHA.

## B. Runner / agent architecture

- **Architecture: ATC + Workers (no "agent you install per job").** `atc/` = "air traffic control" - scheduler + API + Web UI, horizontally scalable behind a load balancer (`atc/README.md`). **Workers** run **Garden** containers and register with the ATC over **gRPC**.
  - Worker components: `worker/baggageclaim/` (volume server / artifact store, `worker/baggageclaim/api/volume_server.go`), `worker/land/` (container lifecycle), `worker/runtime/` (Garden + lidar), `worker/workercmd/` (`worker/land/land_runner.go`).
  - Worker registers capacity/tags with ATC; ATC schedules `builds` to matching workers (`atc/worker/`, `atc/scheduler/`, `atc/auditor/`).
- **Container runtime:** **Garden** (Linux, drivers: containerd, cri-o, ...), **k8s** (container locators; the experimental k8s worker interface - issue `#5209`), Garden on Windows/macOS. Concourse is container-first: every `task`/`get`/`put` runs in a container.
- **Concurrency:** **many builds per worker** (Garden packs multiple containers per worker, bounded by BaggageClaim volume space + `container_limits`, `atc/container_limits.go`). One worker = many concurrent builds.

## C. Secret & artifact flow

- **Secrets:** via **vars** `((...))` set at `set-pipeline` time, **`load_var`** step, **`var_sources`**, or a **credential manager** (`atc/creds/` - Vault, AWS SM, SOPS). Injected into task env. Not a per-step `from_secret`.
- **Artifacts between jobs:** **first-class and unique.** A `put` in one job publishes a *version* of a resource; a `get ... passed: [that-job]` in another consumes it. Volumes are managed by **BaggageClaim** (`worker/baggageclaim/api/volume_server.go`) and streamed P2P between workers when possible (`integration/worker/pipelines/p2p_streaming_groups.yml`). A real artifact bus with versioning + dedup.

## D. Strengths & weaknesses (2026)

**Strengths**
- **The resource/`passed`-constraint model is the strongest artifact + cache story of the six** (content-addressed inputs, cross-job dedup, P2P volume streaming) - `atc/steps.go:294-303`, `worker/baggageclaim/`.
- **Very stable, mature, horizontally scalable** (ATC behind an LB; `atc/README.md`). 7,939 stars, ~616 contributors, v8.3.2 (2026-10-23), only 81 open issues (low for its age).
- **Rich step combinatorics:** `across`, `in_parallel`, `do`, `try`, `ensure`, `on_*` hooks give fine-grained control (`atc/steps.go:223-292`).

**Weaknesses**
- **Steep conceptual curve / different paradigm.** If OpenForge wants a GHA-like `steps:` model, Concourse's `resources` + `plan` is a big rewrite of user mental models and tooling.
- **Operational weight:** you run ATC + Postgres + one or more Garden workers (Linux daemons), not a single container. Heavier than Woodpecker/Drone.
- **No first-class OIDC workload identity or `matrix.exclude`**; secrets require an external credential manager for anything non-trivial (`atc/creds/`).

**Adoption signal:** 7,939 stars / ~616 contributors / 81 open issues / v8.3.2 (2026-10-23) / Apache-2.0 / Go.

## E. License, language, self-host complexity

- **License:** Apache-2.0. **Language:** Go.
- **DB:** **Postgres** (ATC metadata; `atc/db/`).
- **Object store:** optional - BaggageClaim uses local disk by default; S3/GCS backends exist for large deployments.
- **Self-host complexity: MEDIUM-HIGH.** Postgres + ATC + Garden worker(s). More moving parts than Woodpecker; less than a full K8s operator stack.


---

# 5. Tekton (Pipeline)

## A. Pipeline definition surface

- **File format / default filename:** YAML **Kubernetes CRDs** - no repo file by default; you `kubectl apply` a `Pipeline`/`PipelineRun` (or wire it to an EventListener/trigger). API group `tekton.dev/v1` (`pkg/apis/pipeline/v1/pipeline_types.go:92`).
- **Top-level schema.** `Pipeline` -> `PipelineSpec` (`pkg/apis/pipeline/v1/pipeline_types.go:104-134`):

```go
// pkg/apis/pipeline/v1/pipeline_types.go:104-134
type PipelineSpec struct {
    DisplayName string   `json:"displayName,omitempty"`
    Description string   `json:"description,omitempty"`
    Tasks       []PipelineTask `json:"tasks,omitempty"`     // the DAG
    Params      ParamSpecs     `json:"params,omitempty"`
    Workspaces  []PipelineWorkspaceDeclaration `json:"workspaces,omitempty"`
    Results     []PipelineResult `json:"results,omitempty"`
    Finally     []PipelineTask   `json:"finally,omitempty"`  // cleanup tasks
}
```

  - **`PipelineTask`** (`pipeline_types.go:184-240`): `name`, `taskRef` (reference a Task), `taskSpec` (inline `EmbeddedTask`), `when` (expressions), `retries`, `runAfter` (DAG edges), `params`, **`matrix`** (fan-out, `:231-233`), `workspaces`. Error behavior: `onError: stopAndFail | continue` (`pipeline_types.go:33-44`).
  - **`Task`/`TaskSpec`** (`pkg/apis/pipeline/v1/task_types.go:83-128`): `params`, `steps` (sequential `Step`s, source mounted at `/workspace`), `volumes`, `stepTemplate`, **`sidecars`** (run alongside, `:116-119` - "begin before the steps start and end after the steps complete"), `workspaces`, `results`.
  - **Execution model:** the CRD is the *template*; you create a **`PipelineRun`** (or `TaskRun`) as the *instance* (`pipelinerun_types.go`, `taskrun_types.go`). `Checksum()` on Pipeline/Task is used for change detection (`pipeline_types.go:88-102`, `task_types.go:63-77`).
  - **Resolvers:** `resolver_types.go` / `pipelineref_types.go` enable remote `taskRef`/`pipelineRef` resolution (e.g. Hub, git-based resolvers).

**Verbatim - Tekton `Pipeline` + `PipelineRun` (v1 CRD shape, matching the types above):**

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata: {name: build-test-publish}
spec:
  params:
    - name: repo-url
      type: string
  workspaces:
    - name: shared-ws
  tasks:
    - name: clone
      taskRef: {name: git-clone}
      params: [{name: url, value: $(params.repo-url)}]
      workspaces: [{name: output, workspace: shared-ws}]
    - name: test
      runAfter: [clone]
      matrix:                          # fan-out (no GHA-style 'exclude' key)
        params:
          - name: arch
            value: [amd64, arm64]
      parallelism: 2
      retries: 1
      taskSpec:
        steps:
          - name: run
            image: golang:1.22
            script: |
              go test ./...
      workspaces: [{name: source, workspace: shared-ws}]
    - name: notify-skip-gate
      runAfter: [clone]
      when:
        - input: "$(params.repo-url)"
          operator: notin
          values: ["skip-notify"]
      taskSpec:
        steps: [{name: notify, image: alpine, script: "echo done"}]
  finally:                             # always runs (cleanup / notify)
    - name: cleanup
      taskSpec:
        steps: [{name: cleanup, image: alpine, script: "echo cleaned"}]
---
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata: {generateName: btp-}
spec:
  pipelineRef: {name: build-test-publish}
  params: [{name: repo-url, value: https://example.com/repo.git}]
  workspaces:
    - name: shared-ws
      persistentVolumeClaim: {claimName: ws-pvc}
```

- **GHA-equivalent features:**
  - **matrix:** YES, `matrix.params` + `parallelism` (`pipeline_types.go:231-233`, `matrix_types.go`). **No `exclude` key** - you cannot directly exclude a combination (model it with `when`).
  - **DAG:** via `runAfter` + implicit data deps (`pipeline_types.go:221-225`); DAG validation in `pkg/reconciler/pipeline/dag`.
  - **reusable workflows:** YES - **`taskRef`** (call a named Task), **`pipelineRef`** (`pipelineref_types.go`), plus **resolvers** for remote task sources. Cleanest "reusable" model of the six.
  - **services:** YES - **`sidecars`** are first-class (`task_types.go:116-119`).
  - **`when`** expressions (`when_types.go`), **`retries`**, **`finally`**, **`results`** (typed: string/array/object, `pipeline_types.go:137-154`).
- **NOT present:** **OIDC workload identity** is experimental (SPIFFE/Chains, not a core schema feature), **no `matrix.exclude`**, and the **CRD/K8s requirement** means it is not a "bolt onto a Git server" - it is a K8s-native controller.

## B. Runner / agent architecture

- **No agent at all.** Tekton is a **Kubernetes operator**: controllers reconcile `PipelineRun`/`TaskRun` into **Pods**. `pkg/reconciler/{pipeline,pipelinerun,taskrun}/` are the reconcilers; `pkg/pod/` builds the Pod spec; `pkg/entrypoint/` is the entrypoint binary that sequences steps inside one Pod.
  - **Registration protocol:** N/A - it is the K8s control loop (informer -> reconcile -> create Pod), not a poll/websocket.
- **Container runtime:** whatever the **K8s node** uses (containerd/CRI-O). Steps + sidecars are containers in a single Pod sharing `workspaces` (volumes).
- **Concurrency:** unbounded by Tekton itself - it is **K8s scheduler + cluster capacity + `parallelism`/`retries`** that bound it. One `PipelineRun` = one Pod per task (x matrix). "One runner = N jobs" does not apply; the *cluster* is the runner.

## C. Secret & artifact flow

- **Secrets:** **Kubernetes Secrets** (or any K8s auth) referenced from steps (env `secretKeyRef`, volume mounts). No engine-level secret store - it is the K8s model.
- **Artifacts between tasks:** via **`workspaces`** - a shared **PVC** (or emptyDir, or `volumeClaimTemplate`) mounted into multiple tasks in the same `PipelineRun` (`workspace_types.go`, `pipeline_types.go:124`). Cross-*run* artifacts need an external store (S3/GCS), because a PVC is per-run. `results` pass scalar/typed values between tasks.

## D. Strengths & weaknesses (2026)

**Strengths**
- **The cleanest "reusable + sidecar + workspace" model** of the six: `taskRef`/`pipelineRef` + resolvers, first-class `sidecars`, first-class `workspaces` (`task_types.go:116-123`, `pipelineref_types.go`).
- **K8s-native & CNCF-backed** - composes with the entire K8s ecosystem (RBAC, scheduling, operators). 9,092 stars, ~457 contributors, v1.18.0 (2026-10-29).
- **Declarative & GitOps-friendly** - pipelines are just YAML objects in the cluster, diffable/PR-able; `checksum` for change detection.

**Weaknesses**
- **Requires a Kubernetes cluster** - not a "bolt onto a Git server" option; heavy if you do not already run K8s.
- **No `matrix.exclude`, no OIDC workload identity in core, and cross-run artifacts need external storage** (per-run PVCs).
- **High API surface / many CRDs** (Pipeline, Task, PipelineRun, TaskRun, resolver types, conditions historically) - steep to adopt and to keep version-pinned. 585 open issues.

**Adoption signal:** 9,092 stars / ~457 contributors / 585 open issues / v1.18.0 (2026-10-29) / Apache-2.0 / Go.

## E. License, language, self-host complexity

- **License:** Apache-2.0. **Language:** Go.
- **DB:** none of its own - uses **K8s etcd** (via the API server).
- **Object store:** none required; workspaces are PVCs, external store optional.
- **Self-host complexity: HIGH (it IS your K8s cluster).** You must operate K8s + install the Tekton controller. Lowest "standalone" friction; highest platform prerequisite.

---

# 6. Prow

## A. Pipeline definition surface

- **File format / default filename:** YAML **job configs**, typically `config/jobs/**.yaml` (central) or **in-repo** `prow/job-configs/**` (the newer "inrepoconfig" model, `pkg/config/inrepoconfig.go`). There is no per-repo `.prow.yml`; jobs are defined in Prow's own config, keyed by repo.
- **Job model (the "pipeline" surface).** Jobs come in three kinds - **`Presubmit`** (on PRs), **`Postsubmit`** (on pushes), **`Periodic`** (cron) - all embedding **`JobBase`** (`pkg/config/jobs.go:104-155`):

```go
// pkg/config/jobs.go:104-155 (abridged)
type JobBase struct {
    Name            string            `json:"name"`
    Labels          map[string]string `json:"labels,omitempty"`
    MaxConcurrency  int               `json:"max_concurrency,omitempty"`
    Agent           string            `json:"agent,omitempty"`   // default "kubernetes"
    Cluster         string            `json:"cluster,omitempty"`
    Namespace       *string           `json:"namespace,omitempty"`
    ErrorOnEviction bool              `json:"error_on_eviction,omitempty"`
    Spec            *v1.PodSpec       `json:"spec,omitempty"`             // <-- a K8s PodSpec!
    PipelineRunSpec *pipelinev1.PipelineRunSpec `json:"pipeline_run_spec,omitempty"` // tekton agent
    TektonPipelineRunSpec *prowapi.TektonPipelineRunSpec `json:"tekton_pipeline_run_spec,omitempty"`
    ReporterConfig  *prowapi.ReporterConfig `json:"reporter_config,omitempty"`
    RerunAuthConfig *prowapi.RerunAuthConfig `json:"rerun_auth_config,omitempty"`
    Hidden          bool              `json:"hidden,omitempty"`
    JobQueueName    string            `json:"job_queue_name,omitempty"`
}

// pkg/config/jobs.go:196-232
type Presubmit struct {
    JobBase
    AlwaysRun      bool   `json:"always_run"`
    Optional       bool   `json:"optional,omitempty"`
    Trigger        string `json:"trigger,omitempty"`        // e.g. "@k8s-bot e2e test this"
    RerunCommand   string `json:"rerun_command,omitempty"`  // e.g. "/test <job>"
    RunBeforeMerge bool   `json:"run_before_merge,omitempty"`
    Brancher                    // branches / skip_branches
    RegexpChangeMatcher         // run_if_changed / skip_if_changed
    Reporter
    JenkinsSpec *JenkinsSpec `json:"jenkins_spec,omitempty"`
}
```

  - **Key insight:** a Prow job's body is **literally a Kubernetes `PodSpec`** (`spec.containers`), or a **Tekton `PipelineRunSpec`** when `agent: tekton-pipeline` (`jobs.go:130-134`). Prow is a *job orchestrator on top of K8s*, not a container-runtime of its own. `Postsubmit` mirrors this with a pointer `AlwaysRun` (default-true semantics, `jobs.go:260-270`).
  - **`Preset`** (`jobs.go:44-51`) reuses `labels/env/volumes/volumeMounts/tolerations` across jobs, matched by label (`mergePreset`, `jobs.go:53-100`).
  - **Controllers (the "pipeline" runtime):** `cmd/` ships `plank` (job runner), `hook` (webhook ingress), `tide` (merge queue), `crier` (comment/status fanning), `horologium` (periodics), `clonerefs`/`initupload`/`entrypoint`/`sidecar` (per-pod helpers), `deck` (UI), `sinker` (GC), `status-reconciler`, `jenkins-operator` (`cmd/` listing).

**Verbatim - Prow's own integration presubmits (`test/integration/config/prow/jobs/presubmits.yaml:1-28`):**

```yaml
# kubernetes-sigs/prow@43ed234 test/integration/config/prow/jobs/presubmits.yaml
presubmits:
  http://fakegerritserver/gerrit-test-infra-0:     # keyed by repo
    - name: hello-world-presubmit
      always_run: true
      labels:
        preset-dind-enabled: "true"                 # preset = injected sidecar/volume
        preset-kind-volume-mounts: "true"
      spec:                                          # <-- a K8s PodSpec
        containers:
        - command: [ echo ]
          args: [ "Hello World!" ]
          image: localhost:5001/alpine
    - name: bee-movie-presubmit
      run_if_changed: "bee-movie-script.txt"        # path-scoped trigger
      spec:
        containers:
        - command: [ echo ]
          args: [ "Hello World!" ]
          image: localhost:5001/alpine
```

- **GHA-equivalent features:**
  - **triggers:** chat-command driven (`/test`, `/retest`) + `always_run` + `run_if_changed`/`skip_if_changed` + `branches`/`skip_branches` (`Brancher`, `RegexpChangeMatcher`). This is the **"chat-ops" model** - the defining Prow trait.
  - **`max_concurrency`** + `job_queue_name` (throttling, minimal-of-both semantics, `jobs.go:149-152`).
  - **reusable:** `presets` (partial), in-repo config.
- **NOT present (vs GHA):** **no matrix**, **no composite actions**, **no reusable workflows** (presets only), **no OIDC workload identity** (K8s service accounts / GCP), **no `services:`** (sidecars = extra containers in the PodSpec). Prow is a different paradigm entirely.

## B. Runner / agent architecture

- **No agent.** Prow is a set of **K8s controllers** (`cmd/` has `plank`, `hook`, `tide`, `crier`, `horologium`, `clonerefs`, `entrypoint`, `sidecar`, `deck`, `sinker`, ...).
  - **`plank`** (`pkg/plank/reconciler.go`) is the core: it watches **`ProwJob`** CRs and, for the `kubernetes` agent, creates **Pods** via `pkg/pjutil` + `pkg/pod-utils`. For `agent: tekton-pipeline` it creates a **Tekton `PipelineRun`** (`jobs.go:131-134`).
  - **`hook`** receives GitHub/Gerrit webhooks and creates `ProwJob`s; **`tide`** is the merge-queue; **`clonerefs`/`initupload`/`entrypoint`/`sidecar`** are the init-container/entrypoint helpers every job Pod runs.
  - **Registration protocol:** N/A - it is the K8s reconcile loop (informer -> create Pod/PipelineRun).
- **Container runtime:** the **K8s node** CRI (containerd/CRI-O). Every job = a Pod (with a `clonerefs` init container that checks out the repo).
- **Concurrency:** bounded by `max_concurrency`, `job_queue_name`, and **K8s cluster capacity**. "One runner = N jobs" -> the *cluster* is the runner.

## C. Secret & artifact flow

- **Secrets:** **Kubernetes Secrets** / GCP / cloud IAM - injected into the PodSpec (env `secretKeyRef`, volumes). No engine-level secret store. `pkg/secretutil/` manages Prow's own config secrets. **Logs/artifacts:** the `gcsupload` sidecar (binary in `cmd/gcsupload`) uploads job logs/artifacts to **GCS** (or S3); downstream jobs re-fetch from the bucket. When using the Tekton agent, you inherit Tekton workspaces for cross-job data. There is **no built-in cross-job artifact bus** - jobs are independent Pods.

## D. Strengths & weaknesses (2026)

**Strengths**
- **Purpose-built for high-volume PR gatekeeping + merge-queue** (`tide`) at Kubernetes scale - the chat-ops trigger model (`/test`, `always_run`, `run_if_changed`) is unmatched for large OSS.
- **Extremely pluggable runner model:** `agent:` can be `kubernetes` (default), **`tekton-pipeline`**, `jenkins`, etc. (`jobs.go:113-134`) - Prow is a great *pattern* for "thin orchestrator, pluggable executor."
- **Mature & battle-tested** by the largest CI deployment in the world; ~651 contributors on the new repo.

**Weaknesses**
- **It is not a general-purpose "pipeline engine."** No matrix, no reusable workflows, no composite actions, no first-class artifacts - it is a *job trigger + Pod/PipelineRun launcher*. Borrowing it for OpenForge means borrowing the *orchestration/trigger* layer, not a step-runner.
- **K8s + GCS + a Git-provider webhook stack** is a heavy, opinionated deployment; the 2024 repo split (`test-infra` -> `kubernetes-sigs/prow`) added migration friction (`prow/README.md` in test-infra; import path `k8s.io/test-infra/prow` -> `sigs.k8s.io/prow/prow`).
- **Docs/config sprawl** (dozens of controllers in `cmd/`) - high cognitive load.

**Adoption signal:** `kubernetes-sigs/prow` 333 stars (new repo; history in `k8s/test-infra`) / ~651 contributors / Apache-2.0 / Go / no GitHub releases (versioned by image tags).

## E. License, language, self-host complexity

- **License:** Apache-2.0. **Language:** Go.
- **DB:** none of its own - state in **K8s** (ProwJob CRs) + **GCS** for results/logs.
- **Object store:** **GCS** (primary) / S3 for logs + artifacts.
- **Self-host complexity: HIGH.** K8s + GCS + GitHub App/Gerrit + multiple controllers. Highest operational burden of the six; justified only at OSS scale.


---

# Side-by-side pipeline schema comparison

| Dimension | **Woodpecker** | **Drone 2.0 / Gitness** | **Buildkite** | **Concourse** | **Tekton** | **Prow** |
|---|---|---|---|---|---|---|
| **Config unit** | `.woodpecker.yml` / dir | `.drone.yml` / `drone/spec` | `.buildkite/pipeline.yml` | `pipeline.yml` (fly) | K8s CRDs (`Pipeline`/`Run`) | `jobs/**.yaml` (Prow config) |
| **Top-level keys** | `when, workspace, clone, steps, services, labels, depends_on, concurrency, skip_clone` (`workflow.go:23-35`) | classic: `kind,type,steps,services,clone,volumes,environment,secrets,matrix,platforms`; v2: `version,kind,spec{inputs,stages,options}` | `env, agents, steps[]` | `groups, var_sources, resources, resource_types, prototypes, jobs` (`config.go:20-29`) | `spec{tasks, params, workspaces, results, finally}` (`pipeline_types.go:104-134`) | `presubmits/postsubmits/periodics` -> `JobBase` (`jobs.go:104-155`) |
| **Job/step body** | map-or-list `steps` (image+commands) | list `steps` (image+commands) / typed v2 steps | `command` + `plugins` + `env` | `plan[]` of get/put/task/do/across | `taskSpec.steps[]` / `taskRef` | **K8s `PodSpec`** or Tekton `PipelineRunSpec` |
| **DAG ordering** | `depends_on` (DAG) | `depends_on` | `depends_on` (on `key`) | resource graph + `plan` order | `runAfter` + data deps | implicit (independent jobs) |
| **matrix** | YES (axes, include/exclude) | classic axes (no exclude); v2 `expand/matrix` | **YES + `adjustments/skip`** (=exclude) | **`across`** (+`max_in_flight`) | **`matrix.params`** (+`parallelism`, no exclude) | **NO** |
| **matrix.exclude** | partial | NO (classic) | **YES** (`adjustments.skip`) | NO (model via `in_parallel.limit`) | NO (model via `when`) | N/A |
| **reusable workflows** | NO (multi-file only) | v2 `template` (partial) | **YES** (`trigger` + versioned plugins) | `resource_types`/`prototypes` (partial) | **YES** (`taskRef`/`pipelineRef` + resolvers) | presets (partial) |
| **composite actions** | NO (plugins=image) | NO / v2 typed steps | plugins (analog) | `resource_types` (analog) | N/A (everything is a Task) | NO |
| **services / sidecars** | `services:` (shared net) | `services:` / v2 `background` | `docker-compose` plugin | extra `task`/`get` | **`sidecars`** (first-class) | extra containers in PodSpec |
| **OIDC workload id** | NO | NO | **YES** (native + AWS plugin) | NO (login-only) | experimental | NO (K8s SA/GCP) |
| **secret ref syntax** | `from_secret:` | `from_secret:` | `env:` / OIDC | `((var))` / `load_var` / cred mgr | K8s Secret | K8s Secret |
| **conditionals** | `when` (event/branch/path) | `when` | `if:` / `if_changed:` | resource `trigger`/`passed` | `when` expressions | `always_run`/`run_if_changed`/`branches` |
| **artifacts bus** | workspace + plugins | cache svc (S3) | **S3 artifact_paths** | **`put`/`get passed` + BaggageClaim** | **workspaces (PVC)** | GCS/S3 (gcsupload) |

# Runner / agent architecture comparison

| Dimension | **Woodpecker** | **Drone/Gitness** | **Buildkite** | **Concourse** | **Tekton** | **Prow** |
|---|---|---|---|---|---|---|
| **Agent vs server** | separate binaries (`cmd/agent`, `cmd/server`) | separate (`runner-docker` module) | separate agent (server closed) | ATC + Garden workers | **no agent** (K8s operator) | **no agent** (K8s controllers) |
| **registration/protocol** | **gRPC long-poll** `Next` + `RegisterAgent` (`woodpecker.proto:26-37`) | queue/long-poll (pubsub) | **gRPC streaming OR poll** (`PingMode*`, `agent_worker.go:24-30`) | **worker<->ATC gRPC** | K8s reconcile loop | K8s reconcile loop |
| **container runtime** | docker, k8s | docker, k8s, cloud(v2) | docker, k8s, exec, ssh | Garden (containerd/cri-o), k8s | K8s node CRI | K8s node CRI |
| **concurrency** | N workflows/agent (label-routed) | N jobs/runner (`--capacity`) | N workers/agent (`--max-in-flights`) | many builds/worker | cluster capacity + `parallelism` | cluster + `max_concurrency` |
| **work unit** | workflow (DAG of steps) | pipeline (stages/steps) | build (steps) | build (plan of steps) | Pod per task | Pod per job |

# 2023->2026 architectural changes (before/after)

| Engine | Before (<=2023) | After (2024-2026) | Evidence |
|---|---|---|---|
| **Drone** | Standalone `harness/drone` CI (`.drone.yml`) | **Absorbed into `harness/harness` = Gitness platform** (Git+CI+CDE+registry); schema split to `drone/spec`; **new spec v2** (stages + typed steps) in dev | `go.mod:1` (`module github.com/harness/gitness`); `kitchensink.yaml:1-230`; `types/step.go:21` |
| **Prow** | Lived in `kubernetes/test-infra/prow/` | **Extracted to `kubernetes-sigs/prow`** (2024-04-09); import path `k8s.io/test-infra/prow` -> `sigs.k8s.io/prow/prow`; **in-repo job config** added | `test-infra@937e700 prow/README.md`; `pkg/config/inrepoconfig.go` |
| **Buildkite** | agent v3 | **agent v4** (`buildkite/agent/v4`), connect-gRPC streaming, OIDC workload identity, provenance attestations | `agent_worker.go:15`; `pipeline.yml:28-34,359` |
| **Tekton** | v1beta1 (`ClusterTask`, `Condition`) | **v1 stable** (storage version), `matrix`/`finally`/typed results in v1, resolvers | `pipeline_types.go` (`+kubebuilder:storageversion`) |
| **Concourse** | v7 | **v8** (`prototypes`, `across.max_in_flight`, build-log-retention), `concourse/v8` module path | `atc/config.go:25,206`; `import .../concourse/v8/vars` (`config.go:14`) |
| **Woodpecker** | v2 (drone-fork naming) | **v3** (`go.woodpecker-ci.org/woodpecker/v3`), `when` over `runs_on`, DAG `depends_on`, linter w/ JSON schema | `workflow.go:33-34` (deprecation); `import .../v3/...` (`compiler.go:20-28`) |

# Recommendation for OpenForge (which model to borrow)

Framed against the goal - **one runner model to fork/borrow**:

1. **If you want "bolt onto an existing Git server" with the least risk and best ergonomics -> fork Woodpecker's agent.**
   - The **label-routed gRPC long-poll agent** (`agent/runner.go:82-93` + `woodpecker.proto:26-37`) is the cleanest, smallest, most-forkable runner: separate binary, stateless, N-concurrent, backend-agnostic (`backend_types.Backend`), SQLite/Postgres/MySQL server, no K8s required. Its schema (`when` + DAG `depends_on` + `services`) is the closest to a GHA mental model of the six.
   - **Borrow selectively, do not inherit its gaps:** add (a) a real **artifact bus** (Concourse's `put`/`get passed` + BaggageClaim, or Buildkite's S3 `artifact_paths`), and (b) **reusable workflows + OIDC** (Tekton's `taskRef`/`pipelineRef` pattern + Buildkite's OIDC).

2. **If your platform is already Kubernetes-native -> borrow Tekton's executor, not a runner.**
   - Tekton's **`taskRef`/`pipelineRef` + `sidecars` + `workspaces`** (`task_types.go:116-123`) is the strongest *declarative* model, and **Prow already proves you can wrap it** (`agent: tekton-pipeline`, `jobs.go:131-134`). The "thin orchestrator + pluggable executor" pattern (Prow `plank` -> Pod *or* PipelineRun) is the most future-proof architecture to copy.

3. **If you need the best artifact/versioning semantics to steal -> Concourse's resource model** (`atc/steps.go:294-326`, `worker/baggageclaim/`) is the standout, but its `resources`+`plan` paradigm is a large user-facing rewrite - borrow the *artifact/`passed`-constraint* idea, not the whole schema.

4. **Avoid forking Drone 2.0 as a standalone** - it is now the Gitness monorepo with an unsettled spec v2; if you like Drone's shape, consume the **`drone/spec` + `runner-go` + `runner-docker`** modules instead of the platform. **Buildkite** is excellent to *pattern-match* (matrix `adjustments`, OIDC, S3 artifacts) but its server is closed, so it is a reference, not a fork.

**Bottom line:** **Woodpecker's gRPC label-routed agent is the single best runner model to fork** for a self-hosted, Git-server-bolting CI; **layer in Concourse's artifact/`passed` semantics and Tekton/Prow's reusable + pluggable-executor pattern** to close its two main gaps (artifacts, reusability/OIDC).

---

### Caveats & verification limits
- **context7** was unavailable (quota), so doc claims were sourced from the **vendored source + official docs**; all file/line citations above were read directly from the cloned repos at the SHAs listed.
- **Contributor counts** are approximate (GitHub API pagination `Link` header). `harness/harness` and `kubernetes-sigs/prow` show low counts **because they are new repos** (transfer/split) - treat those two numbers as *floors*, not the true community size.
- **Prow** has no GitHub "releases"; it is versioned by container-image tags, so no `latest` release exists (API 404) - expected, not an error.
- **Buildkite** server-side schema specifics (full step key list, artifact retention) are inferred from the OSS agent + its dogfood pipeline; the authoritative schema lives in the closed server.
