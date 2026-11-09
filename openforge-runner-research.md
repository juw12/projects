# OpenForge — GitHub Actions Runner Contract Research

**Date**: 2026-11-04
**Scope**: Minimum viable runner for OpenForge (`juw12/openforge`, TS monorepo, greenfield)
**Method**: Source code analysis of `actions/runner` (C#), `nektos/act` (Go), `forgejo/act_runner` (Go), `actions/cache`, `actions/upload-artifact`, `actions/toolkit`, plus the reverse-engineered protocol in `quinck-io/chimera`.

**Commit SHAs used for permalinks**:

| Repo | SHA | Version |
|------|-----|---------|
| `actions/runner` | `1ddb758ed014660b5d2220a5dc6b0e9957a9f96b` | ~v2.338.2 (Oct 2026) |
| `actions/cache` | `3edfce9056124e459a23f683a21433670d47daca` | v4.x (main) |
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | v4.x (main) |
| `nektos/act` | `a456b6b560db74fc0c59fcde385c0d29ff4f4517` | main |
| `forgejo/act_runner` | `f2fbd679625cd65c286c24939004b2093a68884e` | main |

---

## SECTION 1: GitHub Actions Specification — Version History

### 1.1 There Is No Published Spec

**The GitHub Actions runner protocol is not officially published as a specification document.** This is confirmed by the open feature request:

- **Issue**: [actions/runner#1099 — "Make runner protocol documentation publicly available"](https://github.com/actions/runner/issues/1099)
  > "I'm opening an issue to track a suggestion made by @davidchisnall: Make documentation about the protocol runners use available to the public. This way, third party initiatives to extend support to other platforms or rewriting the runner in a more portable language can happen."
  - Status: **Open**. No response from GitHub.

The "specification" is effectively:
1. The **C# source code** of `actions/runner` (the reference implementation)
2. The **GitHub changelog** (breaking changes announced ad-hoc)
3. The **reverse-engineered protocol** in [quinck-io/chimera `docs/gh-protocol.md`](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md)
4. The **`actions/toolkit`** TypeScript packages (the client-side contract)

### 1.2 Runner Version History (Major Milestones)

The runner uses semantic versioning `v2.MAJOR.MINOR`. The current version is **v2.338.2** (Oct 2026). Below are the architecturally significant releases, reconstructed from the [actions/runner releases](https://github.com/actions/runner/releases):

| Version | Date | Breaking Change / Milestone | Source |
|---------|------|---------------------------|--------|
| v2.166.x | 2020 | Initial public open-source release of the runner | [v2.166.0 release](https://github.com/actions/runner/releases/tag/v2.166.0) |
| v2.290.0 | 2023-08 | **Broker migration**: New `RunnerJobRequest` message type replaces legacy VSS job acquisition. Runner must now talk to `broker.actions.githubusercontent.com` for polling. | [actions/runner#2500](https://github.com/actions/runner/pull/2500), [actions/runner#2487](https://github.com/actions/runner/pull/2487) |
| v2.291.0+ | 2023-09 | **Results service (Twirp)**: New Twirp-based API for logs and step status. Runner detects `system.github.results_endpoint` variable per-job to decide legacy vs. modern. | [actions/runner#2301](https://github.com/actions/runner/pull/2301), [actions/runner#2422](https://github.com/actions/runner/pull/2422) |
| v2.292.0+ | 2023-10 | **Run service**: Job acquisition moves to a separate Go-based run service. `/acquirejob`, `/renewjob`, `/completejob` endpoints. | [actions/runner#2461](https://github.com/actions/runner/pull/2461) |
| v2.315.0+ | 2024-04 | **Artifact v4**: `actions/upload-artifact` v4 ships. Uses `@actions/artifact` package with Twirp + Azure Blob storage. v3 deprecated. | [changelog 2024-04-16](https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/) |
| v2.320.0+ | 2024-09 | **Cache v4**: `actions/cache` v4 ships. v1-v2 deprecated (Feb 2025), fully retired (Mar 2025). New cache architecture. | [changelog 2024-09-16](https://github.blog/changelog/2024-09-16-notice-of-upcoming-deprecations-and-changes-in-github-actions-services/) |
| v2.325.0+ | 2024-11 | **Immutable Actions**: Actions stored as packages in GHCR. Network allow list updated for `pkg.actions.githubusercontent.com` and `ghcr.io`. | [changelog 2024-11-05](https://github.blog/changelog/2024-11-05-notice-of-breaking-changes-for-github-actions/) |
| v2.330.0+ | 2025-02 | **Check run status lock**: Workflows lose ability to modify check run conclusion/status via `GITHUB_TOKEN`. | [changelog 2025-02-12](https://github.blog/changelog/2025-02-12-notice-of-upcoming-deprecations-and-breaking-changes-for-github-actions/) |
| v2.334.0+ | 2026-04 | **DAP debugger**: Debug Adapter Protocol support. Self-repository action reference syntax. Bearer token for action archive downloads. | [v2.334.0 release](https://github.com/actions/runner/releases/tag/v2.334.0) |
| v2.336.0+ | 2026-07 | **$GITHUB_ARTIFACTS env file**: New environment file for artifact-related variables. Cache-mode exposed via `ACTIONS_CACHE_MODE`. | [v2.336.0 release](https://github.com/actions/runner/releases/tag/v2.336.0), [PR #4527](https://github.com/actions/runner/pull/4527) |
| v2.337.0+ | 2026-08 | **VSock secret notifier**: New secret delivery mechanism. WebSocket client retry fix. | [v2.337.0 release](https://github.com/actions/runner/releases/tag/v2.337.0) |
| v2.338.0+ | 2026-10 | **Current**: Docker 29.8.0, Buildx 0.37.0. Node.js 20 removal date set to Sep 23 2026. | [v2.338.0 release](https://github.com/actions/runner/releases/tag/v2.338.0) |

### 1.3 Protocol Versioning

The protocol itself has a **separate version** from the runner binary:

- **Broker protocol version**: `3.0.0` (sent as `runnerVersion=3.0.0` query param on `/message` and `/acknowledge` endpoints)
- **Runner version**: `2.338.x` (reported during registration and in user-agent)
- The broker **rejects** runners with outdated versions.

**Source**: [chimera gh-protocol.md §1](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#1-overview--key-concepts)

This means: even if you implement the protocol correctly, GitHub can break you by bumping the broker protocol version. The chimera project has to track these changes reactively.

### 1.4 Service Architecture (5+ Backend Services)

From [chimera gh-protocol.md §1](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#1-overview--key-concepts):

| Service | Base URL | Purpose |
|---------|----------|---------|
| **GitHub API** | `https://api.github.com` | Registration only |
| **Pipelines (VSS)** | `https://pipelines.actions.githubusercontent.com/{account_id}` | Legacy: logs, timeline, job completion |
| **Broker** | `https://broker.actions.githubusercontent.com` | V2: session management, job polling |
| **Results (Twirp)** | Varies per job (from manifest variable) | Modern: logs, step status, artifacts |
| **Run Service** | From job message body | Job acquisition, renewal, completion |
| **Feed (WebSocket)** | `wss://feed.actions.githubusercontent.com/{account_id}` | Live console streaming |

**Key insight**: A self-hosted runner for a *different* platform (like OpenForge) does NOT need to implement the GitHub backend services. It needs to implement the **runner side** of this protocol, talking to whatever backend OpenForge provides. The backend can be simplified dramatically — the runner is the complex part.

---

## SECTION 2: Runner Contract — What the Runner Must Provide

This section documents every contract surface, with the source file that defines it.

### 2.1 Workspace Management

**What GHA requires**: Each job gets a workspace directory (`GITHUB_WORKSPACE`) where the repository is checked out. The runner manages the directory lifecycle.

**Contract surface**:
- `GITHUB_WORKSPACE` env var set to the repo checkout path
- `GITHUB_PATH` env var for prepending to `PATH`
- Working directory resolution: step `workingDirectory` input overrides `defaults.run.working-directory`

**Source**:
- Workspace dir: [actions/runner/src/Runner.Worker/Handlers/ScriptHandler.cs#L167-L168](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs#L167-L168)
  ```csharp
  var workspaceDir = githubContext["workspace"] as StringContextData;
  workingDirectory = Path.Combine(workspaceDir, workingDirectory ?? string.Empty);
  ```
- Path prepend: [actions/runner/src/Runner.Worker/Handlers/Handler.cs#L205-L233](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/Handler.cs#L205-L233)
  ```csharp
  protected void AddPrependPathToEnvironment()
  {
      string prepend = string.Join(Path.PathSeparator.ToString(),
          ExecutionContext.Global.PrependPath.Reverse<string>());
      // ... prepend to PATH
  }
  ```
- nektos/act equivalent: [nektos/act/pkg/runner/run_context.go#L42-L43](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/run_context.go#L42-L43)

**OpenForge note**: Trivial. Create the directory, set the env var, resolve working directories. No infrastructure needed.

### 2.2 Environment Variable Injection (GITHUB_ENV, GITHUB_PATH, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, GITHUB_STATE)

**What GHA requires**: The runner must create 5 special files in a temp directory, expose their paths as env vars, and process them after each step:

| Env Var | File Purpose | When Processed |
|---------|-------------|---------------|
| `GITHUB_ENV` | Append `KEY=VALUE` lines to env for subsequent steps | After each step completes |
| `GITHUB_PATH` | Prepend directories to `PATH` for subsequent steps | After each step completes |
| `GITHUB_OUTPUT` | Write `KEY=VALUE` lines to set step outputs | After each step completes |
| `GITHUB_STEP_SUMMARY` | Write markdown for the job summary | After each step completes |
| `GITHUB_STATE` | Write `KEY=VALUE` lines persisted across pre/main/post | After each step completes |

**Source**:
- [actions/runner/src/Runner.Worker/ExecutionContext.cs#L106-L110](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/ExecutionContext.cs#L106-L110) — interface methods `SetEnvContext`, `SetRunnerContext`, `SetOutput`
- [actions/runner/src/Runner.Worker/TempDirectoryManager.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/TempDirectoryManager.cs)
- nektos/act: [nektos/act/pkg/runner/step.go#L95-L100](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/step.go#L95-L100)
- Legacy `::set-env::` / `::add-path::` (disabled by default): [nektos/act/pkg/runner/command.go#L53-L70](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/command.go#L53-L70)

**OpenForge note**: MUST implement the 5 file-based env vars. The legacy `::set-env::` and `::add-path::` commands can be skipped (disabled by default on GitHub since 2021, CVE-2020-15228).

### 2.3 Action Download (`uses: foo/bar@ref`)

**What GHA requires**: When a step uses `uses: owner/repo@ref` or `uses: owner/repo/path@ref`, the runner must:
1. Resolve the reference (tag, branch, or SHA)
2. Download the action archive (tar.gz) from the registry
3. Extract it to a local directory
4. Read `action.yml`/`action.yaml` to determine the action type

**Source**:
- [actions/runner/src/Runner.Worker/ActionManager.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/ActionManager.cs) — download, cache, extract
- [actions/runner/src/Runner.Worker/ActionManifestManager.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/ActionManifestManager.cs) — type resolution
- nektos/act: [nektos/act/pkg/runner/action.go#L43-L100](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/action.go#L43-L100)

- **Immutable Actions** (2024+): Actions can now be stored as packages in GHCR. Download from `pkg.actions.githubusercontent.com` instead of git clone. [changelog 2024-12-05](https://github.blog/changelog/2024-12-05-notice-of-upcoming-releases-and-breaking-changes-for-github-actions/)

**OpenForge note**: Simple archive download + extract. Skip immutable actions (GHCR) for v1. Git-based download covers 95% of cases.

### 2.4 Action Types

| Type | `runs.using` | Handler | Source |
|------|-------------|---------|--------|
| **Script** (`run:` step) | N/A | `ScriptHandler` | [ScriptHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs) |
| **JavaScript** (Node) | `node12`, `node16`, `node20` | `NodeScriptActionHandler` | [NodeScriptActionHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs) |
| **Docker** | `docker`, `docker://image`, `Dockerfile` | `ContainerActionHandler` | [ContainerActionHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ContainerActionHandler.cs) |
| **Composite** | `composite` | `CompositeActionHandler` | [CompositeActionHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/CompositeActionHandler.cs) |

#### 2.4.1 JavaScript Actions

The runner bundles Node.js and executes the action's entry point. Key env vars injected:

[actions/runner/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L55-L92](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L55-L92)
```csharp
Environment["ACTIONS_RUNTIME_URL"] = systemConnection.Url.AbsoluteUri;
Environment["ACTIONS_RUNTIME_TOKEN"] = systemConnection.Authorization.Parameters[...];
Environment["ACTIONS_CACHE_URL"] = cacheUrl;         // if available
Environment["ACTIONS_RESULTS_URL"] = resultsUrl;     // if available
Environment["ACTIONS_ID_TOKEN_REQUEST_URL"] = ...;  // if available
Environment["ACTIONS_ORCHESTRATION_ID"] = ...;      // if available
```

The runner ships with Node.js 20 (default) and Node.js 24 (upgrading). The `main.js` (or `dist/index.js`) is executed with `node`.

#### 2.4.2 Docker Actions

[actions/runner/src/Runner.Worker/Handlers/ContainerActionHandler.cs#L35-L36](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ContainerActionHandler.cs#L35-L36)
```csharp
#if OS_WINDOWS || OS_OSX
    throw new NotSupportedException($"Container action is only supported on Linux");
#endif
```

The runner pulls the Docker image (or builds from `Dockerfile`), runs `docker run` with inputs as `INPUT_<NAME>` env vars, mounts the workspace, captures stdout/stderr.

nektos/act: [nektos/act/pkg/runner/step_docker.go](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/step_docker.go)

#### 2.4.3 Composite Actions

[nektos/act/pkg/runner/action_composite.go#L13-L80](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/action_composite.go#L13-L80)

Composite actions: read `action.yml` with `runs.using: composite`, extract `steps:`, create child execution context with `INPUT_*` env vars, run sub-steps recursively. The composite context inherits the parent's job container, env, and masks.

```go
for inputID, input := range step.getActionModel().Inputs {
    envKey := fmt.Sprintf("INPUT_%s", strings.ToUpper(envKey))
    if value, ok := stepEnv[envKey]; defined && ok {
        env[envKey] = value
    } else {
        env[envKey] = ee.Interpolate(ctx, input.Default)
    }
}
```

#### 2.4.4 Reusable Workflows

Reusable workflows are **server-side**. The service expands them into separate jobs before sending to the runner. The runner sees regular jobs.

[chimera §7.2](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#72-pipelinecontextdata-types): "An action's inputs (`with:`): `INPUT_<NAME>` env vars. A reusable workflow's own inputs (`workflow_call`): `contextData.inputs`."

**OpenForge note**: Reusable workflow expansion is a **backend concern**. No runner-side work needed.

### 2.5 Service Containers

The `services:` block starts Docker containers alongside the job. Connected via shared Docker network, reachable by service key as hostname.

- Manifest: `serviceContainers` array — [chimera §7.3](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#73-normalized-manifest-structure)
- nektos/act: [nektos/act/pkg/runner/run_context.go#L49](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/run_context.go#L49)

**OpenForge note**: Requires Docker. Defer to v2.

### 2.6 Matrix Expansion

**Server-side.** The service expands `strategy.matrix` into individual jobs. The runner receives one job per combination with `matrix` values in `contextData`.

[chimera §7.2](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#72-pipelinecontextdata-types): "Every key under `contextData` is an expression context in its own right. So `needs`, `matrix`, `strategy` and, for a job of a reusable workflow, `inputs` all come from here."

**OpenForge note**: Backend concern. No runner-side work needed.

### 2.7 Job/Container Model

Each job runs in an isolated environment. Self-hosted: host directly or Docker container (if `container:` specified).

- Manifest: `jobContainer` field (image, environment, options, volumes, ports, credentials)
- [actions/runner/src/Runner.Worker/JobRunner.cs#L36-L100](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/JobRunner.cs#L36-L100)

**OpenForge note**: For v1, run steps on the host (no container isolation).

### 2.8 Artifact Upload/Download

Runner must set: `ACTIONS_RUNTIME_URL`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_RESULTS_URL`.

[NodeScriptActionHandler.cs#L55-L74](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L55-L74)

See Section 4 for full protocol.

### 2.9 Cache

Runner must set: `ACTIONS_CACHE_URL`, optionally `ACTIONS_CACHE_SERVICE_V2=true`.

[NodeScriptActionHandler.cs#L58-L79](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L58-L79)

See Section 3 for full protocol.

### 2.10 Job Status, Step Status, Log Streaming

Two API generations:

**Legacy VSS**: `POST .../logs`, `POST .../logs/{id}`, `PATCH .../timelines/{tid}/records`

**Modern Results Twirp**: `GetStepLogsSignedBlobURL` → `PUT` (create blob) → `PUT&comp=appendblock` → `PUT&comp=seal` → `CreateStepLogsMetadata`

Source: [chimera §8-9](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#8-timeline-updates-step-status)

Log format: `2024-01-15T10:30:00.0000000Z Hello world` (RFC3339, 7 decimal places). Flush every 1s or 64 KB.

**Live console feed** (optional): WebSocket, 100 lines per 500ms batch, 1024 char limit.

**OpenForge note**: Define your own simpler protocol. HTTP POST for logs, no WebSocket needed for v1.

### 2.11 Secrets and OIDC Tokens

- Secrets: `variables` with `isSecret: true` → `SECRETS_<NAME>` env vars
- `GITHUB_TOKEN`: job-level secret with workflow `permissions:` scopes
- OIDC: `ACTIONS_ID_TOKEN_REQUEST_URL` + `ACTIONS_ID_TOKEN_REQUEST_TOKEN`

[ScriptHandler.cs#L315-L319](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs#L315-L319)

Secret masking: manifest `mask` array, redact from all log output.
[nektos/act/pkg/runner/log_sanitize.go](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/log_sanitize.go)

**OpenForge note**: Secrets as env vars is trivial. OIDC defer. Masking: implement.

### 2.12 Exit Code / Failure Handling

[ScriptHandler.cs#L352-L356](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs#L352-L356)
```csharp
if (exitCode != 0)
{
    ExecutionContext.Error($"Process completed with exit code {exitCode}.");
    ExecutionContext.Result = TaskResult.Failed;
}
```

Conditions: `condition` field is an expression string (`${{ success() }}`).
`continueOnError`, `if:`, `timeout-minutes` all evaluated by the runner.

**OpenForge note**: MUST implement. Core execution loop.

### 2.13 Workflow Commands (stdout parsing)

Format: `::command-name param=value,param2=value2::message`

| Command | Effect |
|---------|--------|
| `::set-output name=X::Y` | Sets step output (deprecated) |
| `::set-env name=X::Y` | Sets env var (disabled by default) |
| `::add-path::X` | Prepend to PATH (disabled by default) |
| `::stop-commands::TOKEN` | Ignore commands until `::TOKEN::` |
| `::add-mask::X` | Redact from logs |
| `::debug::X` / `::warning::X` / `::error::X` | Annotations |
| `::group::X` / `::endgroup::` | Collapsible groups |
| `::save-state name=X::Y` | State for pre/post lifecycle |

[OutputManager.cs#L77-L91](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/OutputManager.cs#L77-L91)
[nektos/act/pkg/runner/command.go#L16-L34](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/command.go#L16-L34)

**OpenForge note**: MUST implement `::error::`, `::warning::`, `::add-mask::`, `::group::`/`::endgroup::`, `::save-state::`.

### 2.14 Permissions Model

`GITHUB_TOKEN` scopes from workflow `permissions:` block. Short-lived (1hr) JWT.

**OpenForge note**: Platform-specific. Runner injects token as env var.

---

## SECTION 3: The `actions/cache` Deep Dive

### 3.1 What `actions/cache` v4 Does

Two modes:
1. **REST API mode** (`ACTIONS_CACHE_URL`): talks to a cache server via `_apis/artifactcache/*` endpoints. Used by self-hosted runners and `nektos/act`/`forgejo/act_runner`.
2. **Twirp mode** (`ACTIONS_CACHE_SERVICE_V2`): talks to GitHub's cache service. Used on hosted runners.

Source: [chimera §14](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#14-cache-api-actionscache)

### 3.2 How It Talks to the Runner

The action does NOT talk to the runner directly. It talks to a **cache server** whose URL is in `ACTIONS_CACHE_URL`. The runner's job:
1. Set `ACTIONS_CACHE_URL` in the step environment
2. The cache server implements the REST API
3. The `@actions/cache` npm package makes HTTP requests to that server

Runner integration point:
[NodeScriptActionHandler.cs#L58-L61](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L58-L61)
```csharp
if (systemConnection.Data.TryGetValue("CacheServerUrl", out var cacheUrl)
    && !string.IsNullOrEmpty(cacheUrl))
{
    Environment["ACTIONS_CACHE_URL"] = cacheUrl;
}
```

### 3.3 The REST API Endpoints

All relative to `ACTIONS_CACHE_URL`:

| Operation | Method | Path |
|-----------|--------|------|
| **Lookup** | `GET` | `/_apis/artifactcache/cache?keys={k1},{k2}&version={v}` |
| **Reserve** | `POST` | `/_apis/artifactcache/caches` |
| **Upload chunk** | `PATCH` | `/_apis/artifactcache/caches/{id}` |
| **Commit** | `POST` | `/_apis/artifactcache/caches/{id}` |
| **Download** | `GET` | `/download/{hash}` |

Source: [chimera §14.3](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#143-rest-api-endpoints)

### 3.4 What `actions/cache` v4 Source Does

State management via `@actions/core` `saveState`/`getState` for pre/main/post:

[actions/cache/src/stateProvider.ts](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/src/stateProvider.ts)
```typescript
export class StateProvider extends StateProviderBase {
    setState = core.saveState;
    getState = core.getState;
}
```

State keys: `CACHE_KEY` (primary key for saving), `CACHE_RESULT` (matched key from restore).

[actions/cache/src/constants.ts](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/src/constants.ts)

Action flow:
1. **Main**: Compute key hash → lookup via REST → hit? download+extract : set state for post
2. **Post**: If no hit, save cache (tar.gz paths, upload via REST)

### 3.5 What the Runner Must Implement for Cache

1. **Run a cache server** (or point `ACTIONS_CACHE_URL` at external)
2. **Set `ACTIONS_CACHE_URL`** in step env
3. **Scope cache** by repo + ref

forgejo/act_runner built-in cache server:
[forgejo/act_runner/internal/app/run/runner.go#L101-L121](https://github.com/forgejo/act_runner/blob/f2fbd679625cd65c286c24939004b2093a68884e/internal/app/run/runner.go#L101-L121)
```go
handler, err := artifactcache.StartHandler(artifactcache.Options{
    Dir: cfg.Cache.Dir, Port: cfg.Cache.Port,
    S3: cacheS3(cfg), Policy: CachePolicy(cfg),
})
envs["ACTIONS_CACHE_URL"] = handler.ExternalURL() + "/"
```

Cache server source: [nektos/act/pkg/artifactcache/](https://github.com/nektos/act/tree/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/artifactcache) — `handler.go`, `storage.go`, `model.go`

**OpenForge note**: Port the `artifactcache` package from nektos/act to TS. ~500 lines. Core logic: lookup (exact + prefix match), reserve, chunked upload, commit, download.

---

## SECTION 4: The `actions/upload-artifact` Deep Dive

### 4.1 What `actions/upload-artifact` v4 Does

Uses `@actions/artifact` npm package (from `actions/toolkit`). 3-step protocol:
1. **CreateArtifact** (Twirp) → get signed blob upload URL
2. **Upload to Blob Storage** (Azure SDK, chunked)
3. **FinalizeArtifact** (Twirp) → register metadata

### 4.2 The Protocol in Detail

**Step 1: CreateArtifact**

[actions/toolkit/packages/artifact/src/internal/upload/upload-artifact.ts#L72-L98](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/upload/upload-artifact.ts#L72-L98)
```typescript
const backendIds = getBackendIdsFromToken()  // from ACTIONS_RUNTIME_TOKEN JWT
const artifactClient = internalArtifactTwirpClient()

const createArtifactReq: CreateArtifactRequest = {
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name, mimeType: StringValue.create({value: contentType}), version: 7
}
const createArtifactResp = await artifactClient.CreateArtifact(createArtifactReq)
// Response: { ok, signedUploadUrl }
```

`internalArtifactTwirpClient` uses `ACTIONS_RESULTS_URL`:
[config.ts#L18-L25](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/shared/config.ts#L18-L25)
```typescript
export function getResultsServiceUrl(): string {
    const resultsUrl = process.env['ACTIONS_RESULTS_URL']
    if (!resultsUrl) throw new Error('Unable to get the ACTIONS_RESULTS_URL env variable')
    return new URL(resultsUrl).origin
}
```

**Step 2: Upload to Blob Storage**

[blob-upload.ts#L26-L98](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/upload/blob-upload.ts#L26-L98)
```typescript
const blobClient = new BlobClient(authenticatedUploadURL)
const blockBlobClient = blobClient.getBlockBlobClient()
// @azure/storage-blob uploadStream, 8MB chunks, concurrency 5
```

- Chunk size: 8 MB ([config.ts#L6-L8](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/shared/config.ts#L6-L8))
- Concurrency: 5 default, max 300 ([config.ts#L50-L83](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/shared/config.ts#L50-L83))
- SHA-256 hash computed during upload

**Step 3: FinalizeArtifact**
```typescript
const finalizeArtifactReq: FinalizeArtifactRequest = {
    workflowRunBackendId, workflowJobRunBackendId, name,
    size: uploadResult.uploadSize.toString(),
    hash: StringValue.create({value: `sha256:${uploadResult.sha256Hash}`})
}
```

### 4.3 What the Runner Must Implement for Artifacts

1. **Set `ACTIONS_RUNTIME_TOKEN`** — JWT with `workflowRunBackendId` + `workflowJobRunBackendId` claims
2. **Set `ACTIONS_RESULTS_URL`** — base URL for Twirp artifact service
3. **Implement Twirp endpoints**: `CreateArtifact`, `FinalizeArtifact`, `GetArtifact`, `ListArtifacts`
4. **Provide blob storage** — `signedUploadUrl` must accept Azure Blob protocol

forgejo/act_runner:
[runner.go#L124-L125](https://github.com/forgejo/act_runner/blob/f2fbd679625cd65c286c24939004b2093a68884e/internal/app/run/runner.go#L124-L125)
```go
envs["ACTIONS_RUNTIME_URL"] = strings.TrimSuffix(cli.Address(), "/") + "/api/actions_pipeline/"
envs["ACTIONS_RESULTS_URL"] = strings.TrimSuffix(cli.Address(), "/")
```

**OpenForge note**: The Azure Blob protocol is the hard part. Options:

| Option | Effort | Compatibility |
|--------|--------|--------------|
| **(a)** Minimal Azure Blob API (`PUT`, `GET`, `DELETE`) | Medium | Full `@actions/artifact` v2+ |
| **(b)** Azurite (Azure Storage emulator) sidecar | Low | Full compatibility |
| **(c)** Fork `@actions/artifact` for raw HTTP | High | Forked dependency |

**Recommendation**: Option (a). The Azure Blob API for block blobs is simple: `PUT /{container}/{blob}` with body. The SDK sends `x-ms-*` headers but a permissive server that stores the body works.

---

## SECTION 5: Open-Source Actions Implementations — What Can We Reuse?

### 5.1 `actions/runner` (C#) — The Official Reference

**Repo**: [actions/runner](https://github.com/actions/runner) — 6,375 stars, C#, MIT
**SHA**: `1ddb758ed014660b5d2220a5dc6b0e9957a9f96b`

| Surface | Implemented | File |
|---------|:---:|------|
| Broker session + polling | Yes | `src/Runner.Listener/BrokerMessageListener.cs` |
| Job acquisition (run service) | Yes | `src/Runner.Listener/Runner.cs`, `src/Sdk/RSWebApi/RunServiceHttpClient.cs` |
| Results Twirp (logs, steps) | Yes | `src/Runner.Common/ResultsServer.cs` |
| VSS legacy (logs, timeline) | Yes | `src/Runner.Common/JobServer.cs` |
| WebSocket live feed | Yes | `src/Runner.Common/JobServer.cs` |
| Script steps | Yes | `src/Runner.Worker/Handlers/ScriptHandler.cs` |
| JS actions (node12/16/20) | Yes | `src/Runner.Worker/Handlers/NodeScriptActionHandler.cs` |
| Docker actions (Linux only) | Yes | `src/Runner.Worker/Handlers/ContainerActionHandler.cs` |
| Composite actions | Yes | `src/Runner.Worker/Handlers/CompositeActionHandler.cs` |
| Workflow commands | Yes | `src/Runner.Worker/Handlers/OutputManager.cs` |
| GITHUB_ENV/PATH/OUTPUT/STATE/SUMMARY | Yes | `src/Runner.Worker/ExecutionContext.cs` |
| Secret masking | Yes | `src/Runner.Worker/ExecutionContext.cs` |
| Action download + cache | Yes | `src/Runner.Worker/ActionManager.cs` |
| Service containers | Yes | `src/Runner.Worker/JobRunner.cs` |
| DAP debugger (v2.334+) | Yes | `src/Runner.Worker/Dap/` |
| Workflow parsing | No | Server-side |
| Matrix expansion | No | Server-side |
| Reusable workflow expansion | No | Server-side |
| Artifact storage | No | Server-side |
| Cache storage | No | Server-side |

**Reuse value**: **Read-only reference**. C# code is ground truth for protocol details, but cannot be directly reused in TS. Use to understand the exact contract.

### 5.2 `nektos/act` (Go) — Local Emulator

**Repo**: [nektos/act](https://github.com/nektos/act) — 70K+ stars, Go, MIT
**SHA**: `a456b6b560db74fc0c59fcde385c0d29ff4f4517`

| Surface | Implemented | File |
|---------|:---:|------|
| Workflow parsing | Yes | `pkg/model/` |
| Matrix expansion | Yes | `pkg/runner/runner.go` |
| Reusable workflows | Yes | `pkg/runner/reusable_workflow.go` |
| Expression evaluation | Yes | `pkg/exprparser/` |
| Script steps | Yes | `pkg/runner/step_run.go` |
| JS actions | Yes | `pkg/runner/action.go` (trampoline.js) |
| Docker actions | Yes | `pkg/runner/step_docker.go` |
| Composite actions | Yes | `pkg/runner/action_composite.go` |
| Workflow commands | Yes | `pkg/runner/command.go` |
| GITHUB_ENV/PATH/OUTPUT/STATE/SUMMARY | Yes | `pkg/runner/step.go` |
| Secret masking | Yes | `pkg/runner/log_sanitize.go` |
| Action download + cache | Yes | `pkg/runner/action.go`, `pkg/runner/action_cache.go` |
| Service containers | Yes | `pkg/runner/run_context.go` |
| Cache server | Yes | `pkg/artifactcache/` |
| Artifact server | Yes | `pkg/artifacts/` |
| Docker isolation | Yes | `pkg/container/` |
| Host mode (no Docker) | Yes | `pkg/runner/run_context.go` |
| GitHub protocol | No | Emulates locally |
| GitHub token / permissions | No | N/A |
| Live log streaming | No | Local output |
| OIDC tokens | No | N/A |

**Reuse value**: **High**. Complete reference for runner-side logic. Key files to port to TS:
- `pkg/exprparser/` → TS expression evaluator
- `pkg/model/` → TS workflow/job/step types
- `pkg/runner/step_run.go` → TS script step executor
- `pkg/runner/command.go` → TS workflow command parser
- `pkg/artifactcache/` → TS cache server

### 5.3 `forgejo/act_runner` (Go) — Forgejo's Runner

**Repo**: [forgejo/act_runner](https://github.com/forgejo/act_runner) — Go, MIT
**SHA**: `f2fbd679625cd65c286c286c24939004b2093a68884e`

Extends nektos/act with:

| Surface | File |
|---------|------|
| Forgejo/Gitea protocol (ConnectRPC) | `internal/pkg/client/` |
| Cache server (built-in + S3 + external) | `act/artifactcache/` |
| Job reporting (heartbeat) | `internal/pkg/report/` |
| Telemetry | `internal/pkg/telemetry/` |
| Metrics (Prometheus) | `internal/pkg/metrics/` |
| Kubernetes backend | `act/container/` |
| Health checks + disk monitoring | `internal/app/run/runner.go` |
| Orphan resource cleanup | `internal/app/run/runner.go` |
| OIDC token injection | `internal/app/run/runner.go` |

**Reuse value**: **Medium**. Good architectural model for production runner (separate protocol layer from execution layer). Production features (health checks, metrics, orphan cleanup) that nektos/act lacks. Go code not directly reusable in TS.

### 5.4 Comparison Matrix

| Surface | actions/runner | nektos/act | forgejo/act_runner |
|---------|:---:|:---:|:---:|
| GitHub protocol | Yes | No | No |
| Forgejo/Gitea protocol | No | No | Yes |
| Workflow parsing | No | Yes | Yes |
| Matrix expansion | No | Yes | Yes |
| Reusable workflows | No | Yes | Yes |
| Expression eval | Yes | Yes | Yes |
| Script steps | Yes | Yes | Yes |
| JS actions | Yes | Yes | Yes |
| Docker actions | Yes (Linux) | Yes | Yes |
| Composite actions | Yes | Yes | Yes |
| Workflow commands | Yes | Yes | Yes |
| Env files (GITHUB_*) | Yes | Yes | Yes |
| Secret masking | Yes | Yes | Yes |
| Action download | Yes | Yes | Yes |
| Cache server | No | Yes | Yes (+S3) |
| Artifact server | No | Yes | Yes |
| Service containers | Yes | Yes | Yes |
| Job container | Yes | Yes | Yes |
| Log streaming | Yes (VSS+Twirp+WS) | No | Yes |
| Live console feed | Yes (WS) | No | No |
| DAP debugger | Yes | No | No |
| Kubernetes backend | No | No | Yes |
| Health checks | No | No | Yes |
| Metrics | No | No | Yes |
| OIDC | Yes | No | Yes |

---

## SECTION 6: The Minimum Viable Subset for OpenForge

### 6.1 Decision Framework

The question: what must the runner implement on day 1 so the top actions (`actions/checkout`, `actions/setup-node`, `actions/setup-python`, `actions/cache`, `actions/upload-artifact`) work **without modification**?

The answer depends on what the *actions* need from the runner, not what GitHub's backend needs. The runner's job:
1. Receive a job (steps + env + secrets)
2. Execute the steps in order
3. Report results back

Everything else is infrastructure.

### 6.2 MUST Implement (Day 1) — The 80%

| # | Surface | Why | Evidence |
|---|---------|-----|----------|
| 1 | **Script steps** (`run:`) | Every workflow has `run:` steps. Core execution loop. | [ScriptHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs) |
| 2 | **JS actions** (node20) | `actions/checkout`, `actions/setup-node`, `actions/setup-python`, `actions/cache`, `actions/upload-artifact` are ALL JavaScript. Without this, none work. | [NodeScriptActionHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs) |
| 3 | **Composite actions** | Many popular actions use composite internally. | [CompositeActionHandler.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/CompositeActionHandler.cs) |
| 4 | **GITHUB_ENV/PATH/OUTPUT/STATE/SUMMARY** | The modern way to pass data between steps. `actions/setup-*` use `GITHUB_PATH`. `actions/checkout` uses `GITHUB_OUTPUT`. | [ExecutionContext.cs#L106-L110](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/ExecutionContext.cs#L106-L110) |
| 5 | **Workflow commands** | `@actions/core` (used by every action) emits `::error::`, `::warning::`, `::add-mask::`, `::group::`. Without these, actions can't set outputs or masks. | [OutputManager.cs#L77-L91](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/OutputManager.cs#L77-L91) |
| 6 | **Action download** | Without this, can't use any remote action. | [ActionManager.cs](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/ActionManager.cs) |
| 7 | **Expression evaluation** | `if:`, `with:`, `env:`, `run:` all use `${{ }}`. Without this, conditional steps and dynamic values fail. | [nektos/act/pkg/exprparser/](https://github.com/nektos/act/tree/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/exprparser) |
| 8 | **Secrets as env vars** | `GITHUB_TOKEN` + user secrets. Without this, `actions/checkout` can't clone private repos. | [chimera §7.3](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#73-normalized-manifest-structure) |
| 9 | **Secret masking** | Security. Without this, secrets leak in logs. | [nektos/act/pkg/runner/log_sanitize.go](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/log_sanitize.go) |
| 10 | **Cache server** | `actions/cache` v4 requires `ACTIONS_CACHE_URL`. Without it, dependency caching doesn't work. | [chimera §14](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#14-cache-api-actionscache) |
| 11 | **Artifact API** | `actions/upload-artifact` v4 + `actions/download-artifact` v4 require `ACTIONS_RESULTS_URL` + blob storage. | [actions/toolkit config.ts](https://github.com/actions/toolkit/blob/main/packages/artifact/src/internal/shared/config.ts) |
| 12 | **Log streaming** | UI needs logs. Even if just to a file, the backend needs them. | [chimera §9](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#9-log-streaming) |
| 13 | **Step status reporting** | UI needs to know which step is running/succeeded/failed. | [chimera §8](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#8-timeline-updates-step-status) |
| 14 | **Workspace management** | `GITHUB_WORKSPACE`, working directory resolution. `actions/checkout` needs to know where to clone. | [ScriptHandler.cs#L167-L168](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ScriptHandler.cs#L167-L168) |

### 6.3 SHOULD Implement (v1.1) — The Next 15%

| # | Surface | Why | Effort |
|---|---------|-----|--------|
| 15 | **Docker actions** | Some popular actions use Docker. Without this, those workflows fail. | High |
| 16 | **Service containers** | Workflows needing a database during testing. | High |
| 17 | **Job container** | Jobs specifying `container:` in workflow. | Medium |
| 18 | **Pre/post action lifecycle** | Some actions register cleanup in `post:`. Without this, resources leak. | Medium |
| 19 | **`continueOnError`** | Workflows that continue after a failed step. | Low |
| 20 | **Timeout handling** | `timeout-minutes` on jobs and steps. | Low |
| 21 | **OIDC tokens** | `ACTIONS_ID_TOKEN_REQUEST_URL` for cloud provider auth. | Medium |

### 6.4 CAN Defer (v2+) — The Last 5%

| # | Surface | Deferral Justification |
|---|---------|----------------------|
| 22 | **Docker actions** (if not v1.1) | [ContainerActionHandler.cs#L35-L36](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/Handlers/ContainerActionHandler.cs#L35-L36): "Container action is only supported on Linux" — even GitHub restricts this. Rare in practice. |
| 23 | **Live console WebSocket feed** | [chimera §10](https://github.com/quinck-io/chimera/blob/main/docs/gh-protocol.md#10-live-console-feed-websocket): "Optional real-time log streaming." HTTP polling sufficient. |
| 24 | **DAP debugger** | Developer experience. Not needed for CI. Added v2.334 (2026-04), very new. |
| 25 | **Immutable actions (GHCR)** | Optimization. Git-based download works. [changelog 2024-12-05](https://github.blog/changelog/2024-12-05-notice-of-upcoming-releases-and-breaking-changes-for-github-actions/): "will default to traditional actions resolution where none exist" |
| 26 | **Kubernetes backend** | Scale feature. Docker or host mode sufficient for v1. |
| 27 | **Telemetry / metrics** | Operational. Not needed for correctness. |
| 28 | **VSock secret notifier** | GitHub-internal. Not relevant for OpenForge. [v2.337.0](https://github.com/actions/runner/releases/tag/v2.337.0) |

### 6.5 What to Delegate to Existing OSS

| Component | Source | How |
|-----------|--------|-----|
| **Expression evaluator** | Port from [nektos/act/pkg/exprparser/](https://github.com/nektos/act/tree/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/exprparser) | ~2000 lines Go → ~1500 lines TS. Well-defined language. |
| **Workflow model** | Port from [nektos/act/pkg/model/](https://github.com/nektos/act/tree/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/model) | YAML schema in [action_yaml.json](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Worker/action_yaml.json) |
| **Cache server** | Port from [nektos/act/pkg/artifactcache/](https://github.com/nektos/act/tree/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/artifactcache) | ~500 lines Go → TS. REST API well-defined. |
| **Command parser** | Port from [nektos/act/pkg/runner/command.go](https://github.com/nektos/act/blob/a456b6b560db74fc0c59fcde385c0d29ff4f4517/pkg/runner/command.go) | 202 lines Go. Regex + dispatch. |
| **`@actions/core`** | Use as-is (npm) | Client-side library actions depend on. No reimplementation needed. |
| **`@actions/artifact`** | Use as-is (npm) | Upload/download logic. OpenForge provides backend endpoints. |
| **Node.js runtime** | Bundle via `node` binary | Runner needs Node for JS actions. Trivial in TS monorepo. |

### 6.6 Architectural Recommendation

```
openforge/
├── packages/
│   ├── runner/           # Runner daemon (TS)
│   │   └── src/
│   │       ├── index.ts          # Entry: register, poll, execute
│   │       ├── job/
│   │       │   ├── runner.ts     # Job execution loop
│   │       │   ├── context.ts    # ExecutionContext: env, outputs, state, masks
│   │       │   ├── step.ts       # Step executor (script, js, composite)
│   │       │   ├── command.ts    # Workflow command parser
│   │       │   └── env-file.ts   # GITHUB_ENV/PATH/OUTPUT/STATE/SUMMARY
│   │       ├── action/
│   │       │   ├── download.ts   # Action download + cache
│   │       │   ├── manifest.ts   # action.yml parser
│   │       │   └── types.ts      # Type dispatch
│   │       ├── expression/
│   │       │   ├── parser.ts     # Expression parser
│   │       │   └── evaluator.ts  # Expression evaluator
│   │       ├── report/
│   │       │   ├── logs.ts       # Log streaming (HTTP POST)
│   │       │   └── status.ts     # Step/job status updates
│   │       └── model/
│   │           └── types.ts      # Workflow, Job, Step types
│   ├── cache-server/     # Cache server (TS)
│   │   └── src/
│   │       ├── index.ts          # HTTP server
│   │       ├── handler.ts        # REST: lookup, reserve, upload, commit, download
│   │       └── storage.ts        # Local disk storage
│   ├── artifact-server/  # Artifact server (TS)
│   │   └── src/
│   │       ├── index.ts          # HTTP server
│   │       ├── twirp.ts          # Twirp: CreateArtifact, FinalizeArtifact
│   │       ├── blob.ts           # Minimal Azure Blob API
│   │       └- storage.ts        # Local disk or S3
│   └── protocol/         # Shared types
│       └── src/
│           ├── job.ts            # Job manifest types
│           ├── report.ts         # Log/status types
│           └- auth.ts           # Token types
└── backend/              # OpenForge API server
    └── src/
        ├── routes/
        │   ├── jobs.ts           # Polling, acquisition, completion
        │   ├── logs.ts           # Log ingestion
        │   ├── status.ts         # Step/job status
        │   └- runners.ts        # Registration
        └- index.ts
```

**Key design decisions**:

1. **Runner is a daemon** polling the backend. HTTP long-polling, no WebSocket for v1.
2. **Cache + artifact servers** are separate packages (sidecars or embedded).
3. **Expression evaluator** is the most complex port. Reference: nektos/act `exprparser`.
4. **Job protocol is OpenForge-specific**. Do NOT implement GitHub's broker/run-service/results protocol. Define:
   - `POST /api/runners/register`
   - `GET /api/runners/{id}/jobs` (long-poll)
   - `POST /api/jobs/{id}/steps/{stepId}/start`
   - `POST /api/jobs/{id}/steps/{stepId}/logs`
   - `POST /api/jobs/{id}/steps/{stepId}/complete`
   - `POST /api/jobs/{id}/complete`
5. **Job manifest** is plain JSON (not GitHub's TemplateToken encoding).

### 6.7 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `@actions/artifact` requires exact Azure Blob protocol | Medium | High | Test with actual package early. Azure SDK is permissive. |
| Expression evaluator edge cases | Medium | Medium | Port nektos/act test suite. Language is stable. |
| GitHub API rate limits on action download | Low | Medium | Cache locally. Same strategy as official runner. |
| Node.js version mismatch | Low | Medium | Bundle Node.js 20 (current default). |
| Secret leakage in logs | Low | High | Masking from day 1. Test with known values. |

### 6.8 Summary: The Credibility Checklist

For OpenForge to be credible as a GitHub Actions-compatible runner, these must work **without modification**:

- [ ] `actions/checkout@v4` — needs: script, JS actions, GITHUB_OUTPUT, secrets, workspace
- [ ] `actions/setup-node@v4` — needs: JS actions, GITHUB_PATH, composite
- [ ] `actions/setup-python@v5` — needs: JS actions, GITHUB_PATH
- [ ] `actions/cache@v4` — needs: JS actions, cache server, GITHUB_STATE
- [ ] `actions/upload-artifact@v4` — needs: JS actions, artifact API + blob storage
- [ ] `actions/download-artifact@v4` — needs: JS actions, artifact API
- [ ] `run: echo hello` — needs: script steps
- [ ] `if: ${{ success() }}` — needs: expression evaluation
- [ ] `env: MY_VAR: ${{ secrets.MY_SECRET }}` — needs: secrets
- [ ] `::error::Something failed` — needs: workflow commands
- [ ] `continueOnError: true` — needs: condition evaluation
- [ ] `timeout-minutes: 10` — needs: timeout handling

**If all of these work, the runner is credible. Everything else is enhancement.**
