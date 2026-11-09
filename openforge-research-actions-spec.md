Task completed in 18m 37s.

Agent: librarian
⚠️  Model routing: parent used pegaai/MiniMax-M3, this subagent used pegaai/Pega-Chat (via category: unknown)

---

I now have everything I need. Let me confirm the checkout input contract:
- `repository` (default from github.server_url + event), `path` (default '.'), `ref` (default = event's commit SHA / merge ref), `clean` (default true), `filter` (partial clone), `sparse-checkout-cone-mode` (default true), `fetch-depth` (default 1), `fetch-tags` (default false), `show-progress` (default true), `lfs` (default false), `submodules` (default '', also 'true'/'recursive'/'false'), `token` (required, default GITHUB_TOKEN), `ssh-key`, `ssh-known-hosts`, `ssh-strict`, `ssh-user`, `persist-credentials` (default false), `set-safe-directory` (default true), `github-server-url`, `allow-unsafe-pr-checkout`.

And the RUNNER_TOOL_CACHE resolution in HostContext.cs: `RUNNER_TOOL_CACHE` → fallback to `RUNNER_TOOLSDIRECTORY` → `AGENT_TOOLSDIRECTORY` → `Constants.Variables.Agent.ToolsDirectory`. So the runner sets RUNNER_TOOL_CACHE. On hosted images it's the platform path.

I have all the evidence I need. Let me also grab the commit SHAs I need for permalinks. I already have:
- runner HEAD: 1ddb758ed014660b5d2220a5dc6b0e9957a9f96b
- cache HEAD: 3edfce9056124e459a23f683a21433670d47daca
- upload HEAD: cf430e030ddbb5b0abf93d22962f4752f3646cd9
- checkout HEAD: f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a
- github-script HEAD: 3a2844b7e9c422d3c10d287c895573f7108da1b3
- toolkit HEAD: 0c3a9c332b678ff1e776f93d728a4ad279803abe

Wait — the clone was depth 1, so the HEAD SHA from `git rev-parse HEAD` in the clone equals the remote HEAD. But I got the toolkit HEAD from the clone (0c3a9c...) and the others from the `gh api commits/HEAD` call. Let me make sure these match. The gh api calls returned:
- runner: 1ddb758ed014660b5d2220a5dc6b0e9957a9f96b
- cache: 3edfce9056124e459a23f683a21433670d47daca
- upload: cf430e030ddbb5b0abf93d22962f4752f3646cd9
- checkout: f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a
- github-script: 3a2844b7e9c422d3c10d287c895573f7108da1b3

And toolkit from clone: 0c3a9c332b678ff1e776f93d728a4ad279803abe. Good.

I have everything. Now let me construct the permalinks properly. The permalink format is:
https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end>

Let me now write the comprehensive report. I'll aim for 800+ lines with concrete evidence and permalinks.

Let me organize the permalinks I'll cite:

Section 1 (Spec):
- Schema: https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/WorkflowParser/workflow-v1.0.json
- WorkflowTemplateConstants.cs: .../src/Sdk/WorkflowParser/Conversion/WorkflowTemplateConstants.cs
- ExpressionParser.cs: .../src/Sdk/Expressions/ExpressionParser.cs
- ExpressionConstants.cs (functions): .../src/Sdk/Expressions/ExpressionConstants.cs#L11-L21
- Token.cs (precedence): .../src/Sdk/Expressions/Tokens/Token.cs#L77-L117
- Contexts doc: https://docs.github.com/en/actions/learn-github-actions/contexts

Section 2 (cache):
- constants.ts (inputs/outputs): .../src/constants.ts#L1-L28
- restoreImpl.ts: .../src/restoreImpl.ts#L32-L86
- saveImpl.ts (NO-OP on exact match): .../src/saveImpl.ts#L46-L55
- toolkit cacheHttpClient.ts (API + version): .../packages/cache/src/internal/cacheHttpClient.ts#L41-L50 (getCacheApiUrl), #L77-L125 (getCacheEntry)
- toolkit cacheUtils.ts (getCacheVersion): .../packages/cache/src/internal/cacheUtils.ts#L136-L159
- toolkit tar.ts (compression): .../packages/cache/src/internal/tar.ts#L180-L252
- toolkit constants.ts (10GB, filenames): .../packages/cache/src/internal/constants.ts#L1-L12
- toolkit cache.ts (restore/save, prefix, lookupOnly): .../packages/cache/src/cache.ts#L148-L189, #L202-L314 (v1), #L326-L461 (v2), #L472-L501, #L512-L790
- cache README: https://github.com/actions/cache/blob/main/README.md (limits, version)

Section 3 (upload-artifact):
- action.yml: .../action.yml#L4-L73
- merge/action.yml: .../merge/action.yml#L4-L43
- merge-artifacts.ts: .../src/merge/merge-artifacts.ts#L19-L96
- constants.ts: .../src/upload/constants.ts
- upload README

Section 4 (checkout, setup, github-script):
- checkout git-auth-helper.ts: .../src/git-auth-helper.ts#L48-L74 (auth header construction), #L326-L410 (token config)
- checkout input-helper.ts: .../src/input-helper.ts (inputs)
- runner HostContext.cs (RUNNER_TOOL_CACHE): .../src/Runner.Common/HostContext.cs#L410
- toolkit tool-cache.ts (_getCacheDirectory): .../packages/tool-cache/src/tool-cache.ts#L743-L747
- github-script action.yml: .../action.yml#L7-L40

Now let me also double check the line numbers for the function list in ExpressionConstants.cs: lines 11-21 (the static constructor with AddFunction calls). Yes.

Token.cs precedence: lines 77-117 (Precedence property). Yes.

Let me write the report now. I need to be thorough but also accurate. Let me make sure I cite correctly.

One thing to double-check: the user asked for "The full list of well-known runtime contexts" and "the full expression grammar". I have both. Let me also mention the "context availability" table which I got from the docs fetch — that's a strong primary-source detail.

For the spec version, it's `workflow-v1.0`. There's no higher version number in the schema. I should note that the "version" field is `workflow-v1.0`.

Let me also address "Reference parser repo (if any)". There's no separate parser repo — the parser is compiled into the runner (ExpressionParser.cs). The closest "reference implementation" is the runner itself. I'll note that.

For "Open draft PRs on the spec repo" — I'll present the notable open PRs from actions/runner (which IS the de-facto spec repo). I have a list of 30 open PRs. Let me highlight the behavior-relevant ones:
- #4761 "Align string-to-number coercion with JavaScript Number()" — behavior change in type coercion
- #4662 "feat: report token permissions via env var" — new env var for token permissions
- #4736 "Expose GHA environment name to job hooks"
- #4710 "Add RISC-V architecture support"
- #4757 "Upgrade runner to .NET 10"
- #4831 "Fix/include docker container hooks"
- The hashFiles ADR (0279) — I saw docs/adrs/0279-hashFiles-expression-function.md

Let me note the ADRs directory exists and documents spec decisions. That's a good find — the runner has `docs/adrs/` with architecture decision records.

Now, I'm confident I have enough. Let me write the final report. I'll make it 800+ lines.

Let me be careful to:
1. Use permalinks with the correct SHAs
2. Distinguish facts from assumptions
3. End with the "Minimum viable subset" section
4. Be concrete about cache and upload-artifact behavior

Let me write it now. This will be a long document. Let me structure it well.

Actually, let me reconsider the "spec version" question once more. The workflow schema file has `"version": "workflow-v1.0"`. But is there a separate "Actions spec" with its own versioning? The user hypothesized `github.com/github/actions-spec`. That doesn't exist. The reality:
- The workflow YAML schema = `workflow-v1.0.json` (in runner), version `workflow-v1.0`
- The expression grammar = documented in docs.github.com "Expressions" + implemented in the runner's ExpressionParser
- The runner protocol (how runner talks to server) is a separate thing (the runner's `_apis/pipelines` etc.)

So the "spec" is split across: (a) the workflow schema DSL, (b) the expression grammar, (c) the contexts (documented in docs), (d) the runner protocol (in the runner code). I'll make this clear.

For the "draft PRs / what's being added", I'll use the open PRs on the runner + the ADRs. Let me also mention the notable recent behavior changes (node24, ESM migration, .NET 10).

Let me write the report now.

I want to make sure about one more detail for the minimum-viable-subset: the key insight is that GHA's "Actions surface" has these layers:
1. Workflow YAML schema (what users write)
2. Expression grammar + contexts (how they express logic)
3. The runtime environment contract (default env vars, $GITHUB_OUTPUT, $GITHUB_ENV, $GITHUB_PATH, workflow commands `echo "::set-output"`, the action runner protocol)
4. The built-in actions (checkout, cache, upload-artifact, setup-*, github-script)
5. The server-side services (cache service, artifact service, secrets, OIDC)

For a credible GHA-compatible runner, the minimum subset is really about 1+2+3 (the runner + workflow engine), and 4 (compatibility with the most-used built-in actions, which mostly just need the right env vars + the cache/artifact backends). 5 is the backend.

The most important "must reimplement" items for credibility:
- The workflow schema (v1.0) — the full keyword set
- The expression grammar (operators, functions, contexts) with correct precedence + type coercion
- All 12 contexts + the context-availability matrix
- The default environment variables (GITHUB_*, RUNNER_*)
- Workflow commands ($GITHUB_OUTPUT, $GITHUB_ENV, $GITHUB_PATH, $GITHUB_STATE, $GITHUB_STEP_SUMMARY, $GITHUB_WORKFLOW_ENV, and the legacy ::set-output::)
- The runner protocol (job message, the long-poll, the _apis endpoints)
- The cache service API (or at least the actions/cache behavior)
- The artifact service API (or at least the upload/download-artifact v4 behavior)
- actions/checkout auth flow (merge ref for PRs is the hard part)
- The tool cache convention (RUNNER_TOOL_CACHE) so setup-* works

Deliberate divergences candidates:
- The exact cache version hash (SHA-256 with salt "1.0") — a self-hosted can use its own scheme
- zstd vs gzip default
- The specific backend (S3/Azure/GCS) — GHA uses Azure Blob; a self-hosted can use anything
- OIDC / GitHub Apps specifics
- The exact eviction policy (10GB, LRU, 1 week)

OK, I have a clear picture. Let me write the report.

Let me write it in a well-structured, evidence-heavy markdown format. I'll aim for 800+ lines.

I need to be careful with the line numbers in permalinks. Let me use the ranges I actually read:
- ExpressionConstants functions: L13-L20 (the AddFunction calls are lines 13-20)
- Token.cs Precedence: L77-L117
- workflow-v1.0.json: various
- cache constants.ts: L1-L28
- restoreImpl.ts: L32-L86
- saveImpl.ts: L46-L70
- cacheHttpClient.ts getCacheApiUrl: L41-L50; getCacheEntry: L77-L125; reserveCache: L185-L209; uploadFile: L258-L318; commitCache: L320-L332
- cacheUtils.ts getCacheVersion: L136-L159
- tar.ts: getCompressionProgram L220-L252; getDecompressionProgram L180-L212
- toolkit constants.ts: L1-L12 (CacheFilename, CompressionMethod), L40 (CacheFileSizeLimit)
- cache.ts: restoreCache L148-L190; restoreCacheV1 L202-L314; restoreCacheV2 L326-L461; saveCache L472-L501; saveCacheV1 L512-L628; saveCacheV2 L639-L790
- upload action.yml: L4-L73
- merge action.yml: L4-L43
- merge-artifacts.ts: L19-L96
- checkout git-auth-helper.ts: L48-L74 (ctor), L326-L410 (configureToken)
- checkout input-helper.ts: L23-L192
- runner HostContext.cs: L410
- tool-cache.ts: L743-L747
- github-script action.yml: L7-L40

Great. Let me write it.

Actually, I realize I should double check the runner SHA for the HostContext.cs permalink — yes, runner HEAD is 1ddb758ed014660b5d2220a5dc6b0e9957a9f96b.

Let me write the final report now.



I now have complete primary-source evidence across all four areas. Let me clean up the background task state and write the report.

I have everything I need. Here is the research report.

---

# GitHub Actions: Minimum Viable Compatibility Subset for OpenForge

> **Method note.** All code claims cite permalinks into the canonical GitHub-owned repositories at the `main`-branch HEAD captured during this research pass (2026-11-03). The single most important structural finding is in §1: **there is no standalone `github.com/github/actions-spec` repository** (verified 404). The canonical, machine-readable workflow schema is `workflow-v1.0.json` embedded inside the **`actions/runner`** repository, and the expression parser/evaluator is compiled C# in the same repo. So "the spec" is not one artifact — it is split across (a) the schema DSL, (b) the expression grammar, (c) the contexts (documented on docs.github.com), and (d) the runner↔server protocol.

**SHAs used for permalinks:**
| Repo | HEAD SHA |
|---|---|
| `actions/runner` | `1ddb758ed014660b5d2220a5dc6b0e9957a9f96b` |
| `actions/toolkit` | `0c3a9c332b678ff1e776f93d728a4ad279803abe` |
| `actions/cache` | `3edfce9056124e459a23f683a21433670d47daca` |
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `actions/checkout` | `f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a` |
| `actions/github-script` | `3a2844b7e9c422d3c10d287c895573f7108da1b3` |

---

## 1. Official GitHub Actions Specification

### 1.1 Which repo is canonical

**Finding: the canonical schema lives in `actions/runner`, not a dedicated spec repo.**

- `github.com/github/actions-spec` → **HTTP 404** (verified via `gh api repos/github/actions-spec`).
- The de-facto spec is `src/Sdk/WorkflowParser/workflow-v1.0.json`:

**Evidence** ([workflow-v1.0.json](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/WorkflowParser/workflow-v1.0.json#L1-L3)):
```json
{
  "version": "workflow-v1.0",
  "definitions": {
    "workflow-root": {
```

This file is a **custom pipeline-definition DSL** (Azure DevOps-style `mapping`/`sequence`/`one-of`/`allowed-values`), *not* standard JSON Schema. The runner's own C# `WorkflowParser` (`WorkflowTemplateConverter`, `MatrixBuilder`, `Job.cs`, `WorkflowTemplateEvaluator.cs`) interprets it. Each keyword node can declare `"context": [...]` — this is how the **context-availability matrix** is encoded (see §1.4).

### 1.2 Spec version

- **Workflow schema version: `workflow-v1.0`** — declared in the schema file itself and as the constant `Workflow_1_0 = "workflow-v1.0"` in the parser constants.

**Evidence** ([WorkflowTemplateConstants.cs#L112](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/WorkflowParser/Conversion/WorkflowTemplateConstants.cs#L112)):
```csharp
public const String Workflow_1_0 = "workflow-v1.0";
```

There is **no** `workflow-v2.0` or higher in the tree. The schema *evolves in place* under the `workflow-v1.0` version string (GitHub adds keywords/allowed-values without bumping the version). There are three root variants in the schema — `workflow-root`, `workflow-root-new`, and `workflow-root-strict` — which encode the loose/strict validation modes the server applies ([schema L23-L63](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/WorkflowParser/workflow-v1.0.json#L23-L63)).

### 1.3 Open draft PRs on the de-facto spec repo (actions/runner)

There is no formal "draft PR against a spec"; the relevant signal is **open PRs on `actions/runner`** that change workflow/expression behavior. Open PRs observed at HEAD (30 shown; the ones that affect the compatibility contract are bolded):

| PR | Title | Compatibility relevance |
|---|---|---|
| **#4761** | **Align string-to-number coercion with JavaScript `Number()`** | Changes expression type-coercion semantics — directly affects what `${{ }}` expressions evaluate to. A divergent runner must decide whether to match JS `Number()`. |
| **#4662** | **feat: report token permissions via env var** | Adds a new env var exposing `GITHUB_TOKEN` permission scopes — a new "default variable" a compatible runner should surface. |
| **#4736** | **Expose GHA environment name to job hooks** | New env surface for the `environment` keyword. |
| **#4710** | Add RISC-V architecture support | New `runner.arch` value — a new label/dimension for `runs-on`. |
| **#4757** | Upgrade runner to .NET 10 | Runtime-only, not a contract change. |
| #4831 | Fix/include docker container hooks | Container/service behavior. |
| #4809 | Retry container/service health more frequently | `services` robustness. |
| #4794 | Kill entire process tree on Linux/macOS | `run` step teardown semantics. |

**ADR trail:** the runner keeps Architecture Decision Records under `docs/adrs/`. One directly concerns the expression surface:
- [`docs/adrs/0279-hashFiles-expression-function.md`](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/docs/adrs/0279-hashFiles-expression-function.md) — documents how/why `hashFiles` is implemented (it is an *extension* function the worker registers, not a core grammar function — see §1.6).

> **Interpretation for OpenForge:** the spec is a *living, in-place-evolving* schema. Pinning "compatibility" means pinning the keyword + context + expression surface as of a given runner release, then tracking the ADR/PR deltas above as the divergence ledger.

### 1.4 The canonical list of well-known runtime contexts

**Twelve contexts** are the canonical set, confirmed both by the schema's `"context"` annotations and by the official contexts reference.

**Evidence** (official reference, [docs.github.com → Contexts reference](https://docs.github.com/en/actions/learn-github-actions/contexts)):

| Context | Type | Description (abridged) |
|---|---|---|
| `github` | object | Information about the workflow run + event payload |
| `env` | object | Variables set in workflow/job/step |
| `vars` | object | Repository/org/environment-level variables |
| `job` | object | Info about the currently running job |
| `jobs` | object | Reusable-workflow-only; outputs of the called workflow's jobs |
| `steps` | object | Info about steps run in the current job |
| `runner` | object | Info about the runner (`os`, `arch`, `name`, `temp`, `toolcache`, `workspace`, `environment`) |
| `secrets` | object | Names + values of secrets (restricted availability) |
| `strategy` | object | Matrix strategy info for the current job |
| `matrix` | object | Matrix properties for the current job |
| `needs` | object | Outputs/results of dependency jobs |
| `inputs` | object | Inputs of a reusable or manually-triggered workflow |

In addition, five **special functions** are treated as context-like and appear in the availability matrix: `always()`, `success()`, `failure()`, `cancelled()`, and `hashFiles()`.

The schema encodes *which* contexts are legal per keyword. For example, the `steps.if` node allows `github, inputs, vars, needs, strategy, matrix, steps, job, runner, env` plus the conditionals `always/success/failure/cancelled` and `hashFiles(1,255)`:

**Evidence** ([workflow-v1.0.json `step-if` L2459-L2481](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/WorkflowParser/workflow-v1.0.json#L2459-L2481)):
```json
"step-if": {
  "context": [
    "github","inputs","vars","needs","strategy","matrix",
    "steps","job","runner","env",
    "always(0,0)","failure(0,0)","cancelled(0,0)","success(0,0)","hashFiles(1,255)"
  ],
  "string": { "is-expression": true }
}
```

The full per-keyword availability matrix is reproduced in the official docs (fetched during this pass) and is authoritative for which contexts may appear in which key. Highlights that constrain a runner:
- `run-name`, `concurrency` (workflow-level): `github, inputs, vars` only.
- `env` (workflow/job/step): `secrets` is allowed.
- `jobs.<id>.if`: `github, needs, vars, inputs` + `always/cancelled/success/failure` — **no `secrets`, no `strategy/matrix`** (a job's `if` is evaluated before the matrix expands).
- `on.workflow_call.outputs.<id>.value`: `github, jobs, vars, inputs`.

### 1.5 The `github.*` property list (canonical)

The `github` context is the largest. From the official contexts reference (primary source), the `github.*` properties include (each `string` unless noted):

- `github` (object), `github.action`, `github.action_path` (composite only), `github.action_ref`, `github.action_repository`, `github.action_status` (composite), `github.actor`, `github.actor_id`, `github.api_url`, `github.artifacts`, `github.artifacts_list`, `github.base_ref`, `github.env`, `github.event` (object — the full webhook payload), `github.event_name`, `github.event_path`, `github.graphql_url`, `github.head_ref`, `github.job`, `github.ref`, `github.ref_name`, `github.ref_protected`, `github.ref_type`, `github.repository`, `github.repository_id`, `github.repository_owner`, `github.run_attempt`, `github.run_id`, `github.run_number`, `github.run_path`, `github.run_url`, `github.server_url`, `github.sha`, `github.token`, `github.triggering_actor`, `github.workflow`, `github.workflow_id`, `github.workflow_run`, `github.workflow_url`, `github.workspace`.

> **Note / uncertainty flag:** the top of this list (through `github.graphql_url`) is verbatim from the fetched reference page; the remainder is the stable, long-standing set on the same page. For an exact, byte-for-byte property contract, treat the live [contexts reference](https://docs.github.com/en/actions/learn-github-actions/contexts#github-context) as authoritative — this list is a decision-grade superset, not a frozen spec artifact (GitHub does not publish a machine-readable `github.*` property list; it is assembled server-side per event).

**Key runner-relevant detail:** the `github` context is *populated by the server* in the job message, not by the runner. The runner merely receives `github.context` (and `github.event`, `github.eventPath`, `github.actionPath`, etc.) and exposes them as default env vars. So a compatible server must produce the correct `github` object; a compatible runner must forward it faithfully.

### 1.6 The full expression grammar (`${{ }}`)

The grammar is implemented by a **precedence-climbing parser** in the runner. There is **no separate "reference parser repo"** — the parser *is* the runner.

**Evidence** ([ExpressionParser.cs L14-L103](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionParser.cs#L14-L103)) — `CreateTree` tokenizes, pushes operators/operands, flushes, and enforces a max depth.

**Limits:**
- **Max depth = 50**, **Max length = 21000 chars** (the length cap is deliberately under the .NET 85,000-char "large object heap" threshold, even under UTF-32).

**Evidence** ([ExpressionConstants.cs L29-L37](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionConstants.cs#L29-L37)):
```csharp
internal static readonly Int32 MaxDepth = 50;
internal static readonly Int32 MaxLength = 21000; // Under 85,000 large object heap threshold, even if .NET switches to UTF-32
```

#### Operators (with precedence)

Precedence is numeric; **higher binds tighter**. `!` is right-associative; all others are left-associative.

**Evidence** ([Token.cs L77-L117](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/Tokens/Token.cs#L77-L117)):

| Precedence | Token(s) | Meaning |
|---|---|---|
| 20 | `(` | logical grouping (start) |
| 19 | `[` , `.` , `(` (function-call) | index / dereference / call |
| 16 | `!` | not (right-assoc) |
| 11 | `>` `>=` `<` `<=` | comparison |
| 10 | `==` `!=` | equality |
| 6 | `&&` | and |
| 5 | `\|\|` | or |
| 1 | `)` `]` `,` | terminators / separator |

Operators are declared in [ExpressionConstants.cs L52-L61](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionConstants.cs#L52-L61). Punctuation: `.` dereference, `*` wildcard, `,` separator, `[]` index.

#### Built-in (well-known) functions

Registered in the static constructor:

**Evidence** ([ExpressionConstants.cs L11-L21](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionConstants.cs#L11-L21)):

| Function | Min args | Max args |
|---|---|---|
| `case` | 3 | 255 |
| `contains` | 2 | 2 |
| `endsWith` | 2 | 2 |
| `format` | 1 | 255 |
| `join` | 1 | 2 |
| `startsWith` | 2 | 2 |
| `toJson` | 1 | 1 |
| `fromJson` | 1 | 1 |

- `case` is a ternary-chain function and **requires an odd argument count** (the parser throws `EvenParameters` if it's even) — [ExpressionParser.cs L352-L355](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionParser.cs#L352-L355).
- `hashFiles(1, 255)` and the conditionals `always/success/failure/cancelled` are **extension functions** the worker injects at parse time (`context.ExtensionFunctions` / `ExtensionNamedValues`), not part of the core well-known set — [ExpressionParser.cs L113-L154](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionParser.cs#L113-L154). `hashFiles` reads file contents on the runner and returns a SHA-256 (see ADR 0279).
- `And`/`Or` nodes **flatten** nested same-type operators during parse — [ExpressionParser.cs L226-L251](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Sdk/Expressions/ExpressionParser.cs#L226-L251).

#### Coercion & equality semantics

- Type system: `null`, `boolean`, `number`, `string`, `array`, `object` (`ExpressionDataType`), with `ExpressionData` value wrapper.
- **`==` is a deep, type-aware comparison** with numeric/string coercion; the open PR **#4761** is specifically tightening **string→number coercion to match JavaScript `Number()`**, which tells you the current coercion is a known divergence point. A compatible runner should adopt JS `Number()` semantics.
- The `if:` keyword auto-evaluates as an expression *without* requiring `${{ }}` (the schema marks these nodes `"is-expression": true`).

---

## 2. `actions/cache`

> **Architecture finding:** `actions/cache` is a **thin orchestration wrapper** (restore → build → save) over the **`@actions/cache` toolkit package** in `actions/toolkit`. All of the *interesting* behavior — key versioning, prefix matching, compression, and the backend protocol — lives in the toolkit. So a faithful reimplementation must reproduce the **toolkit contract**, not just the action.

### 2.1 Input / output contract

**Inputs** (the canonical set):

**Evidence** ([actions/cache `src/constants.ts` L1-L20](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/src/constants.ts#L1-L20)):
```ts
export enum Inputs {
    Key = "key",                    // key
    Path = "path",                  // path
    RestoreKeys = "restore-keys",   // restore-keys
    UploadChunkSize = "upload-chunk-size",
    EnableCrossOsArchive = "enableCrossOsArchive",
    FailOnCacheMiss = "fail-on-cache-miss",
    LookupOnly = "lookup-only"
}
export enum Outputs {
    CacheHit = "cache-hit",
    CachePrimaryKey = "cache-primary-key",
    CacheMatchedKey = "cache-matched-key"
}
```

| Input | Default | Meaning |
|---|---|---|
| `key` | *(required)* | Exact cache key to restore/save |
| `path` | *(required)* | Newline-separated files/dirs/`@actions/glob` patterns |
| `restore-keys` | *(none)* | **Ordered** list of **prefix** fallbacks |
| `enableCrossOsArchive` | `false` | Let Windows restore/save cross-OS archives (needs GNU tar + zstd) |
| `fail-on-cache-miss` | `false` | Fail the step if nothing is restored |
| `lookup-only` | `false` | Check existence, skip the download |

Outputs: `cache-hit` (`"true"`/`"false"`/`""`), `cache-primary-key`, `cache-matched-key`.

### 2.2 The `cache-hit` semantic (a commonly-misread detail)

`cache-hit` is **`"true"` only on an *exact* primary-key match**, and **empty string on a miss** (not `"false"`). A restore-key (prefix) match sets it to `"false"`. This is deliberate, to preserve legacy behavior:

**Evidence** ([actions/cache `src/restoreImpl.ts` L53-L79](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/src/restoreImpl.ts#L53-L79)):
```ts
if (!cacheKey) {
    // `cache-hit` is intentionally not set to `false` here to preserve existing behavior
    // See https://github.com/actions/cache/issues/1466
    if (failOnCacheMiss) { throw new Error(...); }
    return;                       // <- miss => no output (empty)
}
...
const isExactKeyMatch = utils.isExactKeyMatch(core.getInput(Inputs.Key, { required: true }), cacheKey);
core.setOutput(Outputs.CacheHit, isExactKeyMatch.toString());   // true only if matched === primary
```

### 2.3 Cache key semantics: key, restore-keys, and prefix matching

- The **primary key** is tried first; if it misses, each `restore-keys` entry is tried **in order** and matched **by prefix** (longest/first matching prefix wins, server-side). The **version** must also match (see §2.4) — so a prefix match only succeeds against entries with the *same version and scope*.
- Key constraints (validated client-side):
  - **≤ 512 characters** per key, **no commas** (commas are the multi-key delimiter).
  - **≤ 10 keys total** (primary + restore-keys).

**Evidence** ([toolkit `cache.ts` `checkKey` L104-L116](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/cache.ts#L104-L116) and the 10-key cap in both `restoreCacheV1` L215-L219 and `restoreCacheV2` L344-L348):
```ts
function checkKey(key: string): void {
  if (key.length > 512) { throw new ValidationError(`...cannot be larger than 512 characters.`); }
  const regex = /^[^,]*$/;
  if (!regex.test(key)) { throw new ValidationError(`...cannot contain commas.`); }
}
```

### 2.4 Cache **version** / content-addressing (the cross-OS gotcha)

The cache is **scoped to (key, version, branch)**. The **version** is a **SHA-256** over `paths + compressionMethod + ("windows-only" if win32 & !crossOs) + salt "1.0"`, joined by `|`. This is why a cache written on `windows-latest` is *invisible* to `ubuntu-latest` even with an identical key — the version differs (different compression tool, and the `windows-only` marker).

**Evidence** ([toolkit `cacheUtils.ts` `getCacheVersion` L136-L159](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/cacheUtils.ts#L136-L159)):
```ts
const versionSalt = '1.0';
...
export function getCacheVersion(paths, compressionMethod?, enableCrossOsArchive = false): string {
  const components = paths.slice();
  if (compressionMethod) components.push(compressionMethod);
  if (process.platform === 'win32' && !enableCrossOsArchive) components.push('windows-only');
  components.push(versionSalt);
  return crypto.createHash('sha256').update(components.join('|')).digest('hex');
}
```

The README confirms this is why cross-OS restore fails by default ([actions/cache README → "Cache Version"](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/README.md)). **Branch scoping** (default-branch cache visible to feature branches) is enforced server-side, not in the client.

### 2.5 Compression & archive format (tar + gzip / zstd)

The cache is **`tar` + a compressor** (not a zip). Compression is chosen at runtime by probing for `zstd`:

**Evidence** ([toolkit `cacheUtils.ts` `getCompressionMethod` L102-L112](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/cacheUtils.ts#L102-L112)):
```ts
export async function getCompressionMethod(): Promise<CompressionMethod> {
  const versionOutput = await getVersion('zstd', ['--quiet']);
  const version = semver.clean(versionOutput);
  if (versionOutput === '') return CompressionMethod.Gzip;
  else return CompressionMethod.ZstdWithoutLong;
}
```

- **Filenames:** gzip → `cache.tgz`; zstd → `cache.tzst` ([toolkit `constants.ts` L1-L12](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/constants.ts#L1-L12)).
- **Compression args:** gzip uses `tar -z`; zstd uses `tar --use-compress-program "zstd -T0 --long=30"` (or `zstdmt` on non-Windows) with **long-distance matching `--long=30`** (1 GiB window, chosen to also work on 32-bit self-hosted runners). Decompression is the mirror.
- **tar dialect:** GNU tar is preferred (Windows uses the Git-for-Windows `tar.exe` if present, else falls back to the BSD `bsdtar` with a special two-stage zstd workaround); macOS prefers `gtar` to avoid permission bugs.
- **Path handling:** files are matched by `@actions/glob` **relative to `GITHUB_WORKSPACE`**, written into a `manifest.txt`, and archived with `tar --files-from manifest.txt` so entries are workspace-relative. (This is why Windows `%LocalAppData%` env vars are *not* expanded — only `~`/relative paths work.)

**Evidence** ([toolkit `tar.ts` `getCompressionProgram`/`getDecompressionProgram` L180-L252](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/tar.ts#L180-L252) and `createTar` L319-L331):
```ts
case CompressionMethod.Zstd:
  return [... '--use-compress-program', IS_WINDOWS ? '"zstd -T0 --long=30"' : 'zstdmt --long=30']
...
default: return ['-z']     // gzip
```

### 2.6 Backend store & protocol

**The cache is NOT a content-addressable blob store you point at S3/GCS directly.** The client talks to a **GitHub-owned cache service** over HTTP (auth via `ACTIONS_RUNTIME_TOKEN`, Bearer). There are **two generations** of the backend, selected by `getCacheServiceVersion()`:

- **v1 (legacy):** the `_apis/artifactcache` REST surface.
- **v2 (current, since the Feb 1 2025 rewrite):** a **Twirp** service reached via `ACTIONS_RESULTS_URL`, with **signed upload/download URLs to Azure Blob** behind it.

**v1 endpoints** (constructed in [toolkit `cacheHttpClient.ts` `getCacheApiUrl` L41-L50](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/cacheHttpClient.ts#L41-L50)):

| Op | Method | Resource |
|---|---|---|
| Look up | `GET` | `cache?keys=<comma-joined>&version=<sha256>` → `204` on miss, else `archiveLocation` |
| Reserve | `POST` | `caches` (body `{key, version, cacheSize}`) → `{cacheId}` |
| Upload chunk | `PATCH` | `caches/{id}` with `Content-Range: bytes start-end/*` |
| Commit | `POST` | `caches/{id}` (body `{size}`) |
| List (diag) | `GET` | `caches?key=<primary>` |

**Evidence** — reserve + chunk + commit ([toolkit `cacheHttpClient.ts` `reserveCache` L185-L209, `uploadChunk` L220-L256, `commitCache` L320-L332](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/cacheHttpClient.ts#L185-L209)):
```ts
export async function reserveCache(key, paths, options?) {
  const version = utils.getCacheVersion(paths, options?.compressionMethod, options?.enableCrossOsArchive);
  const reserveCacheRequest = { key, version, cacheSize: options?.cacheSize };
  return httpClient.postJson<ReserveCacheResponse>(getCacheApiUrl('caches'), reserveCacheRequest);
}
```

**v2 flow** (Twirp, [toolkit `cache.ts` `restoreCacheV2` L326-L461 and `saveCacheV2` L639-L790]): `GetCacheEntryDownloadURL{key, restoreKeys, version}` → signed download URL → download → extract; and `CreateCacheEntry{key, version}` → signed upload URL → chunked upload (64 MiB chunks, 8 concurrent) → `FinalizeCacheEntryUpload{key, version, sizeBytes}` → `entryId`.

**Backend abstraction implication for OpenForge:** the only thing the *client* cares about is (a) the lookup/reserve/upload/commit (or Twirp) **protocol** and (b) an `archiveLocation`/signed URL that returns a **tar+gzip or tar+zstd** stream. You can back it with **any** object store (S3, Azure, GCS, MinIO) as long as you present the same HTTP/Twirp endpoints and produce compatible tarballs + version hashes. **If you want byte-level drop-in `actions/cache@v4+` compatibility, you must implement the v2 Twirp surface + signed Azure-style URLs; for a "behavior-compatible but not wire-compatible" path, you can serve v1-style `_apis/artifactcache` (which `actions/cache@v3` still uses).**

### 2.7 Save-on-miss / "save-always" vs "lookup-only" behavior

- **Save is a NO-OP when the restore already matched the *primary* key exactly** (avoids re-writing an identical cache). A restore-key (prefix) hit *does* trigger a save under the primary key.

**Evidence** ([actions/cache `src/saveImpl.ts` L46-L55](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/src/saveImpl.ts#L46-L55)):
```ts
const restoredKey = stateProvider.getCacheState();
if (utils.isExactKeyMatch(primaryKey, restoredKey)) {
    core.info(`Cache hit occurred on the primary key ${primaryKey}, not saving cache.`);
    return;   // NO-OP
}
```

- **`lookup-only`** returns the matched key **without downloading** (both v1 L252-L255 and v2 L398-L401 short-circuit before `downloadCache`). It "does not change save behavior" per the README.
- **Concurrency:** a *reserving* save that loses the race (another job already created the key) is a **benign warning, not a failure** (`ReserveCacheError` → `core.info`). This is the "two matrix legs race to save the same key" pattern.
- **Read-only / fork PRs:** if the run's token is read-only, **restore works but save is denied** — surfaced as a **warning** (`cache read denied:` / `cache write denied:` prefixes), the step does **not** fail. ([toolkit `cache.ts` L40-L86, and `cacheHttpClient.ts` L104-L112](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/cache.ts#L40-L86))

### 2.8 Eviction / TTL / limits

These are **server-side policy**, not client code, but they are part of the contract users rely on (documented in the action README):
- **10 GiB per repository** total cache (`CacheFileSizeLimit = 10 * 1024^3` in [toolkit `constants.ts` L40](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/constants.ts#L40)).
- Eviction is **LRU by last access**; caches **not accessed within the last week** are evicted; when the 10 GiB cap is hit, the **least-recently-used** entries are evicted first.
- Restore/download: **128 MiB segments**, **10-minute** per-segment timeout (configurable via `SEGMENT_DOWNLOAD_TIMEOUT_MINS`).

> **Decision-grade summary for cache:** to be *credible*, a runner must reproduce (1) the exact `cache-hit` exact-match semantic, (2) prefix + version + branch scoping, (3) the SHA-256 version formula (or a documented divergence), (4) tar+gzip/zstd archives with workspace-relative paths, (5) reserve/upload/commit (v1) **or** Twirp+signed-URL (v2), (6) the benign-race + read-only-denial-as-warning behavior, and (7) the 10 GiB / LRU / 1-week eviction policy.

---

## 3. `actions/upload-artifact`

> **Big v3→v4 architectural break:** v3 artifacts were **mutable** (append across steps/jobs) and stored as **tar+gzip**. **v4+ artifacts are *immutable***, stored as a **ZIP (zlib/deflate)** via the `@actions/artifact` toolkit, and **you cannot append to the same artifact name from multiple jobs/steps** — the recommended pattern is *one artifact per producer* + an explicit **`merge`** sub-action. This is the single most important behavior a migrating user will hit.

### 3.1 Input / output contract (v4+ / v7)

**Evidence** ([actions/upload-artifact `action.yml` L4-L73](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml#L4-L73)):

| Input | Default | Meaning |
|---|---|---|
| `name` | `artifact` | Artifact name (ignored when `archive: false`) |
| `path` | *(required)* | File/dir/`@actions/glob` pattern(s), supports `!` excludes |
| `if-no-files-found` | `warn` | `warn` \| `error` \| `ignore` |
| `retention-days` | *(repo default)* | 1–90; `0` = default |
| `compression-level` | `6` | **zlib** level 0–9 (6 = GNU-gzip-equivalent) |
| `overwrite` | `false` | `true` deletes a same-named artifact first (→ new ID) |
| `include-hidden-files` | `false` | Include dotfiles |
| `archive` | `true` | `false` = upload a single file as-is, no zip |

Outputs: `artifact-id`, `artifact-url` (login-gated download URL), `artifact-digest` (**SHA-256** of the archive).

### 3.2 Compression: **ZIP + zlib** (not tar)

Unlike cache (tar+gzip/zstd), v4+ artifacts are a **ZIP** compressed with **zlib deflate** at the `compression-level` (default **6**, matching GNU Gzip's default; 0 disables compression for incompressible data).

**Evidence** ([actions/upload-artifact `action.yml` `compression-level` L26-L36](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml#L26-L36)):
```yaml
compression-level:
  description: >
    The level of compression for Zlib to be applied to the artifact archive.
    ... 6: Default compression (same as GNU Gzip) ...
  default: '6'
```
The archiving itself is delegated to `@actions/artifact` (`artifactClient.uploadArtifact`), which builds the ZIP in-stream. **Consequence:** **file permissions are not preserved** for zipped artifacts (all dirs → `755`, files → `644`); to preserve exec bits you must `tar` yourself and upload with `archive: false` (documented in the README "Permission Loss" section).

### 3.3 Artifact "manifest" / layout

- The archive's root is the **least common ancestor (LCA)** of all matched paths. With multiple paths, the LCA becomes the zip root; exclude patterns do *not* affect the resulting directory structure.
- **Wildcard flattening:** when a wildcard is used, the path hierarchy **after the first wildcard** is preserved, and matches are flattened under that point (e.g. `path/to/*/directory/foo?.txt` → `some/directory/foo1.txt`, `other/directory/foo1.txt`).
- The server keeps a per-artifact manifest of **{entry path, size}** plus the artifact `id`, `digest` (SHA-256), `size`, and `retentionExpiresAt`. The `artifact-digest` output is the SHA-256 of the uploaded zip.

### 3.4 Retention semantics

- **Default = 90 days** (repo default), configurable per-upload via `retention-days` (**1–90 inclusive**; `0` = use repo default). Beyond 90 requires a repo-settings change.
- Artifacts are **deleted when the retention period elapses**, when the **workflow run is deleted**, or when the repo is deleted. The `artifact-url` dies with the artifact/run/repo.

### 3.5 Immutability + the v4 "merge-artifacts" pattern (matrix)

- **You cannot append to the same artifact name from multiple jobs/steps in v4+** — each created artifact is **idempotent/immutable**. Re-uploading the same name **fails** unless `overwrite: true` (which deletes + re-creates, giving a **new ID**).
- The sanctioned matrix pattern is: each leg uploads a **uniquely-named** artifact, then a downstream `needs:` job runs **`actions/upload-artifact/merge`** to combine them.

**Merge sub-action contract** ([actions/upload-artifact `merge/action.yml` L4-L43](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/merge/action.yml#L4-L43)):

| Input | Default | Meaning |
|---|---|---|
| `name` | `merged-artifacts` | Output artifact name |
| `pattern` | `*` | Glob over artifact **names** to merge |
| `separate-directories` | `false` | `true` = each source artifact goes into its own named subdir (avoids name collisions) |
| `delete-merged` | `false` | Delete the source artifacts after merging |
| `retention-days` / `compression-level` / `include-hidden-files` | as upload | same semantics |

**The merge is *client-side*** — it is literally **list → minimatch-filter → download all (5 in parallel) into a temp dir → re-upload as one zip**. It is *not* a server-side concat.

**Evidence** ([actions/upload-artifact `src/merge/merge-artifacts.ts` L19-L88](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/src/merge/merge-artifacts.ts#L19-L88)):
```ts
const listArtifactResponse = await artifactClient.listArtifacts({ latest: true });
const matcher = new Minimatch(inputs.pattern);
const artifacts = listArtifactResponse.artifacts.filter(a => matcher.match(a.name));
...
const downloadPromises = artifacts.map(artifact =>
  artifactClient.downloadArtifact(artifact.id, { path: inputs.separateDirectories ? path.join(tmpDir, artifact.name) : tmpDir }));
// chunked PARALLEL_DOWNLOADS = 5
...
await uploadArtifact(inputs.name, searchResult.filesToUpload, searchResult.rootDirectory, options);
if (inputs.deleteMerged) { /* artifactClient.deleteArtifact(name) for each */ }
```

### 3.6 The download counterpart (symmetry)

`actions/download-artifact` is the mirror: inputs `name` (or `pattern`), `path`, `merge-multiple`, `github-token`, `run-id`. It uses the same `@actions/artifact` client (`listArtifacts` / `downloadArtifact`) and the same artifact service. **Symmetry point for OpenForge:** if you implement upload as "list + single-download-URL + zip," the download side is the inverse of the same protocol — you don't need a separate mechanism.

### 3.7 Cross-workflow artifact access

Artifacts are **scoped to a workflow run** by default. To consume an artifact **from a different workflow run**, the supported pattern is:
1. Trigger a downstream workflow on the **`workflow_run`** event.
2. Reference the triggering run via **`github.event.workflow_run.id`**.
3. In the downstream workflow, use **`actions/download-artifact`** with **`run-id: ${{ github.event.workflow_run.id }}`** (and the **`actions: read`** permission on `GITHUB_TOKEN`) to pull that run's artifacts.

This is the canonical "privileged follow-on workflow" pattern (the `workflow_run` event grants the downstream run write/artifact access even when the upstream run didn't). **For OpenForge:** cross-run artifact access requires (a) the `workflow_run` event, (b) a `run-id`-scoped artifact listing API, and (c) a token that is scoped to read another run's artifacts — a meaningful chunk of server-side work.

### 3.8 Limits

- **500 artifacts per job** (client-enforced limit), plus the shared **storage quota**.
- Not supported on GHES for v4+ (must stay on v3.2.2 there).

> **Decision-grade summary for artifacts:** the minimum credible set is the **v4 immutable model** (ZIP+zlib level 6, LCA-root layout, wildcard flattening, `artifact-id/url/digest` outputs, 90-day/1-90 retention, 500/job), the **merge sub-action** (client-side list→download→reupload), and the **cross-run `run-id` download** pattern. The v3 mutable-append model is a *deliberate non-goal* — do not reimplement it; instead, document the merge pattern as the migration path.

---

## 4. Other Critical Actions

### 4.1 `actions/checkout` — auth, LFS, submodules, fetch semantics

**Input contract** ([actions/checkout `src/input-helper.ts` L23-L192](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/src/input-helper.ts#L23-L192)): `repository`, `path` (default `.`), `ref`, `clean` (`true`), `filter` (partial-clone), `sparse-checkout-cone-mode` (`true`), `fetch-depth` (default **1** → shallow), `fetch-tags` (`false`), `show-progress` (`true`), **`lfs`** (`false`), **`submodules`** (`''` | `true` | `recursive`), `token` (**required**, defaults to `GITHUB_TOKEN`), `ssh-key`, `ssh-known-hosts`, `ssh-strict`, `ssh-user`, `persist-credentials` (`false`), `set-safe-directory` (`true`), `github-server-url`, `allow-unsafe-pr-checkout`.

**Auth flow (the part that is hard to clone):**

- **HTTPS + `GITHUB_TOKEN`:** the action does *not* put the token in the URL. It writes a **scoped git credential** as a **`http.<origin>/.extraheader`** = `AUTHORIZATION: basic base64("x-access-token:<token>")`, isolated in a temp credentials file under `RUNNER_TEMP` and wired in via **`includeIf.gitdir:<path>.path`** (plus worktree + container-path variants) so the secret never lands in the repo's `.git/config` or in process-creation audit logs.

**Evidence** ([actions/checkout `src/git-auth-helper.ts` ctor L56-L73](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/src/git-auth-helper.ts#L56-L73)):
```ts
const serverUrl = urlHelper.getServerUrl(this.settings.githubServerUrl);
this.tokenConfigKey = `http.${serverUrl.origin}/.extraheader`;
const basicCredential = Buffer.from(`x-access-token:${this.settings.authToken}`, 'utf8').toString('base64');
this.tokenConfigValue = `AUTHORIZATION: basic ${basicCredential}`;
this.insteadOfKey = `url.${serverUrl.origin}/.insteadOf`;
this.insteadOfValues.push(`git@${serverUrl.hostname}:`);
```

- **SSH:** if `ssh-key` is provided, it writes the key + a `known_hosts` (implicitly adding the **github.com** host key) and sets **`GIT_SSH_COMMAND`** with `StrictHostKeyChecking` per `ssh-strict`.
- **`url.<origin>/.insteadOf`** rewrites `git@host:` → `https://host/` so SSH remotes also use the token.
- **`persist-credentials: false`** (default) means auth is **removed after the checkout** (`removeAuth`) — secrets don't linger in the repo config.

**The PR "merge ref" gotcha (the real compatibility wall):** for `pull_request` / `pull_request_target`, the action checks out the **merge commit** (`refs/pull/<n>/merge` on github.com) — a ref **only the run's `GITHUB_TOKEN` can fetch**, which is how GitHub builds untrusted PR heads *as a merge with the base* without giving the PR write access. A faithful self-hosted reimplementation must (a) synthesize an equivalent **merge commit** (or use `git merge-tree` / a server-provided merge ref) and (b) gate it to the run token. This is the single highest-fidelity item in `checkout`; `pull_request_target` (checkout the *base* with a privileged token) is the related security-critical variant.

**LFS:** `lfs: true` runs `git lfs install` + `git lfs fetch`/`pull` after checkout (requires `git-lfs` on the runner). **Submodules:** `submodules: recursive` runs `git submodule update --init --recursive`, with per-submodule auth wired via `includeIf` (see `configureSubmoduleAuth`, [L157-L231](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/src/git-auth-helper.ts#L157-L231)).

### 4.2 `actions/setup-*` and the **runner tool cache**

**How setup-node / setup-python / setup-go decide where a tool lives:**

1. Every setup action calls into the shared **`@actions/tool-cache`** toolkit. It resolves the cache root from the **`RUNNER_TOOL_CACHE`** env var.
2. The **runner sets `RUNNER_TOOL_CACHE`** to a platform-specific default at job start (with fallbacks to the older Azure-Pipelines-style vars).

**Evidence** ([actions/runner `src/Runner.Common/HostContext.cs` L410](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/src/Runner.Common/HostContext.cs#L410)):
```csharp
path = Environment.GetEnvironmentVariable("RUNNER_TOOL_CACHE")
     ?? Environment.GetEnvironmentVariable("RUNNER_TOOLSDIRECTORY")
     ?? Environment.GetEnvironmentVariable("AGENT_TOOLSDIRECTORY")
     ?? Environment.GetEnvironmentVariable(Constants.Variables.Agent.ToolsDirectory);
```
and the toolkit hard-requires it:

**Evidence** ([actions/toolkit `tool-cache.ts` `_getCacheDirectory` L743-L747](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/tool-cache/src/tool-cache.ts#L743-L747)):
```ts
function _getCacheDirectory(): string {
  const cacheDirectory = process.env['RUNNER_TOOL_CACHE'] || '';
  ok(cacheDirectory, 'Expected RUNNER_TOOL_CACHE to be defined');
  ...
}
```

**Tool-cache path conventions** (the layout every setup action reads/writes; `<tool>` = node/python/go, `<version>` = the requested/installed version):
- **Linux:** `/opt/hostedtoolcache/<tool>/<version>/<arch>/`
- **macOS:** `/Users/runner/hostedtoolcache/<tool>/<version>/<arch>/`
- **Windows:** `C:\hostedtoolcache\<tool>\<version>\<arch>\`

Each installed tool dir contains a **`<tool>-<version>-<arch>.x`** marker file and a **manifest** (`manifest.json`) recording the tool, version, arch, and file hashes. A setup action:
1. Checks the cache for a **matching version + arch**; if present, it's **instant** (no download).
2. If absent, it **downloads from the vendor** (nodejs.org / python.org / go.dev), verifies, extracts into the cache, and writes the manifest.
3. Adds the tool's `bin`/`Scripts` to **`PATH` via `$GITHUB_PATH`** (the workflow command), and sets tool-specific env (e.g. `NODE_VERSION`, `PYENV`-like vars).

**Why this matters for OpenForge:** on GitHub's **hosted** runners the tool cache is **pre-provisioned** (that's why `setup-node` is fast). On a **self-hosted** runner the cache is **empty**, so the first `setup-*` downloads on demand (slow, needs outbound internet to the vendor). A credible self-hosted OpenForge runner should (a) **set `RUNNER_TOOL_CACHE`** to the conventional path, (b) **pre-populate** the cache for common tool versions to match hosted-runner speed, and (c) honor the `manifest.json`/marker-file layout so stock `setup-*` actions work unmodified.

### 4.3 `actions/github-script` — the `script:` keyword

**It is not a workflow keyword** — it's a **JavaScript action** whose primary input is named **`script`**. The `script` value is the **body of an async function** that is executed with a set of **injected globals**.

**Evidence** ([actions/github-script `action.yml` L7-L40](https://github.com/actions/github-script/blob/3a2844b7e9c422d3c10d287c895573f7108da1b3/action.yml#L7-L40)): inputs `script` (required), `github-token` (default `${{ github.token }}`), `debug`, `user-agent`, `previews`, `result-encoding` (`json` default), `retries`, `retry-exempt-status-codes`, `base-url`; output `result`.

Injected globals (from the README): `github` (pre-authenticated **Octokit** REST client with pagination), `context` (workflow-run context), `core`, `glob`, `io`, `exec`, `getOctokit(token, opts)` (v9+ factory for extra clients), and a proxied `require`.

- **`github.rest.*`** — Octokit REST endpoint methods (v5+ moved them under `.rest`; `github.issues.createComment` → `github.rest.issues.createComment`).
- **`github.graphql(query, vars)`** and **`github.paginate(...)`** unchanged across versions.
- **`context`** mirrors the `github` context (`context.repo.owner/repo`, `context.issue.number`, `context.payload` = the event payload, `context.sha`, etc.).
- **Result:** the function's **return value** becomes the step output **`result`** (JSON-encoded by default; `result-encoding: string` for raw).
- **Versioning:** v9 = `@actions/github` v9 + Node 24 (requires runner ≥ 2.327.1); `require('@actions/github')` no longer works (ESM-only) — use the injected `getOctokit` instead.
- **Security note:** expressions in `script` are evaluated *before* execution and become JS source, so the documented best practice is to pass data via `env`/`process.env`, not by inlining `${{ }}` (script-injection hardening).

> **For OpenForge:** `github-script` is cheap to support *if* you provide (a) a real Octokit-compatible **REST + GraphQL** API, (b) the `context` object, and (c) Node 24 on the runner. It is effectively "the Actions API surface expressed as a library."

---

## 5. Minimum Viable Subset (MVS) for a Credible OpenForge Runner

The compatibility surface decomposes into **five layers**. A runner that "promises full Actions compatibility" must cover **L1–L3 faithfully** and **L4 for the top actions**, and can **deliberately diverge** on the enumerated L5 backend internals.

### MUST reimplement (to claim "GHA-compatible" without asterisks)

**Layer 1 — Workflow schema (`workflow-v1.0`)**
- The full keyword set: `on` (all events + `types`/`branches(-ignore)`/`tags(-ignore)`/`paths(-ignore)` filters, `schedule`, `workflow_dispatch`, `workflow_call` with `inputs/secrets/outputs`), `jobs` (`needs`, `if`, `strategy.matrix` with `include/exclude`, `runs-on` incl. `group`+`labels`, `container`, `services`, `env`, `permissions`, `concurrency` with `cancel-in-progress`, `timeout-minutes`, `defaults.run`, `environment`, `outputs`), `steps` (`uses`/`run`, `with`, `id`, `if`, `env`, `timeout-minutes`, `continue-on-error`, `shell`, `working-directory`), `defaults`, `permissions`, `concurrency`, `run-name`.
- `workflow_call` (reusable workflows) and `jobs.<id>.uses` — **high migration value**.

**Layer 2 — Expression grammar + contexts**
- Operators with the exact **precedence table** (§1.6) and JS-`Number()` **type coercion** (adopt PR #4761 semantics).
- All **12 contexts** + `always/success/failure/cancelled/hashFiles`, and the **per-keyword context-availability matrix** (a runner that lets `secrets` leak into a job `if` is a security regression).
- `github.*` property completeness (server-produced), `hashFiles` (SHA-256, extension function).

**Layer 3 — Runtime environment contract** (the unglamorous 90% of day-2 compat)
- **Default env vars:** `GITHUB_*`, `RUNNER_*` (`RUNNER_TOOL_CACHE`, `RUNNER_TEMP`, `RUNNER_OS`, `RUNNER_ARCH`, `RUNNER_NAME`, `RUNNER_WORKSPACE`, `RUNNER_ENVIRONMENT`), `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL`/`ACTIONS_RESULTS_URL`.
- **Workflow-command files:** `$GITHUB_OUTPUT`, `$GITHUB_ENV`, `$GITHUB_PATH`, `$GITHUB_STATE`, `$GITHUB_STEP_SUMMARY`, `$GITHUB_WORKFLOW_ENV`, and the **legacy `echo "::set-output name=x::v"`** protocol (still widely used by older actions).
- **Job-message / runner protocol:** the long-poll + `_apis/pipelines`/`_apis/distributedtask` message schema the server sends (steps, env, `github` context, secrets) — this is the runner's wire format and must match for any stock action to run.

**Layer 4 — Top built-in actions** (what users `uses:` by name)
- `actions/checkout` — **including the PR merge-ref checkout** and `lfs`/`submodules` (the merge-ref is the hard part; without it, PR workflows silently build the wrong commit).
- `actions/cache` — the full contract in §2 (exact `cache-hit`, prefix+version+branch scoping, tar+gzip/zstd, benign-race + read-only-denial-as-warning).
- `actions/upload-artifact` **v4 model** + `actions/upload-artifact/merge` + `actions/download-artifact` (§3).
- `actions/setup-{node,python,go}` — by honoring the **`RUNNER_TOOL_CACHE`** convention + pre-populating the cache (stock actions then work unmodified).
- `actions/github-script` — by exposing an Octokit-compatible REST+GraphQL API + `context` + Node 24.

### SHOULD implement (strongly expected, "full parity" territory)
- `concurrency` (workflow + job level) with `cancel-in-progress`.
- `environment` + environment protection rules (gates job dispatch).
- `permissions` token scoping (least-privilege `GITHUB_TOKEN`) + **OIDC / `id-token`** for cloud auth (a top-3 "why can't I deploy" question).
- `services` containers + `container` actions (sidecar DBs) — needed for a large slice of real workflows.
- `strategy.max-parallel`, `cancel-timeout-minutes`, `re-run` semantics, artifact **cross-run** access via `workflow_run` + `run-id`.
- `pull_request_target` (base-context privileged run) — the security-critical PR variant.

### CAN deliberately DIVERGE (document, don't hide)
- **Cache backend wire format:** you may serve the **v1 `_apis/artifactcache`** protocol (drop-in for `actions/cache@v3`) *or* the **v2 Twirp + signed-URL** protocol (drop-in for `@v4+`); the underlying blob store (S3/Azure/GCS/MinIO) is invisible to the client. **But** if you want `actions/cache@v4+` to work *unmodified*, you must implement v2 Twirp.
- **Cache version hash:** you may keep the SHA-256 formula for cross-compat, or use your own (but then caches won't be byte-compatible with GitHub's — document it).
- **Eviction policy:** 10 GiB / LRU / 1-week is GitHub's; you can expose the same knobs with a different cap — surface it in settings, don't pretend it's identical.
- **`github.*` event-payload fidelity:** for events you don't fully model, you can return a faithful-enough payload; document coverage per event.
- **Compression default (zstd vs gzip):** GitHub auto-detects; you may fix one — cosmetic, but changes cache sizes.
- **GHES parity / OIDC specifics / `models` permission / `attestations` / supply-chain features (SLSA, artifact attestations):** these are **GitHub-specific and low migration-credibility-per-effort** — a deliberate non-goal for v1 is defensible *if* documented.
- **The v3 mutable-artifact model:** do **not** reimplement; route users to the merge pattern.

### The one-liner positioning
> OpenForge should promise **"full compatibility with the `workflow-v1.0` workflow schema, the `${{ }}` expression grammar + all 12 contexts, and the default runtime environment; drop-in compatibility with `actions/checkout` (incl. PR merge-ref), `actions/cache`, `actions/upload-artifact` v4 + `merge`, `actions/download-artifact`, `actions/setup-*` (via the standard tool cache), and `actions/github-script`"** — and **explicitly diverge (with a published divergence table)** on the cache/artifact *backend wire format + blob store*, the *eviction policy knobs*, and *GitHub-specific supply-chain/OIDC/attestation features*.

**Highest-risk items to validate before shipping the promise:** (1) the **PR merge-ref checkout**, (2) the **per-keyword context-availability enforcement** (security), (3) the **`cache-hit` exact-match** + **benign-race** semantics, (4) the **artifact immutability + merge** model, and (5) the **`workflow_run` cross-run artifact** path. These five are where a "compatible" claim most often turns out to be "compatish."

---

### Source ledger (primary, GitHub-owned only)
- **Spec/schema/grammar:** `actions/runner` @ `1ddb758` — `workflow-v1.0.json`, `WorkflowTemplateConstants.cs`, `ExpressionParser.cs`, `ExpressionConstants.cs`, `Tokens/Token.cs`, `docs/adrs/0279-hashFiles-expression-function.md`; open PRs #4761/#4662/#4736/#4710.
- **Contexts reference:** docs.github.com → "Contexts reference" (fetched).
- **Cache:** `actions/cache` @ `3edfce9` (`constants.ts`, `restoreImpl.ts`, `saveImpl.ts`, README) + `actions/toolkit` @ `0c3a9c3` (`packages/cache/src/cache.ts`, `internal/{cacheHttpClient,cacheUtils,tar,constants}.ts`).
- **Artifacts:** `actions/upload-artifact` @ `cf430e0` (`action.yml`, `merge/action.yml`, `src/merge/merge-artifacts.ts`, `src/upload/constants.ts`, README).
- **Checkout / tool-cache / github-script:** `actions/checkout` @ `f548e57` (`src/input-helper.ts`, `src/git-auth-helper.ts`); `actions/runner` @ `1ddb758` (`Runner.Common/HostContext.cs`); `actions/toolkit` @ `0c3a9c3` (`packages/tool-cache/src/tool-cache.ts`); `actions/github-script` @ `3a2844b` (`action.yml`, README).

**Uncertainty flags:** (a) `github.*` property list is a decision-grade superset of the live doc, not a frozen artifact; (b) the exact **v2 cache Twirp** message shapes were inferred from the generated client wrappers (`generated/results/api/v1/cache.ts`) rather than a published IDL — verify against `cacheTwirpClient.ts` if you implement v2; (c) GHES artifact/cache support boundaries shift between releases.

<task_metadata>
session_id: ses_e5efd90e7ffe9Nc6mIz81ar7z7
task_id: ses_e5efd90e7ffe9Nc6mIz81ar7z7
subagent: librarian
</task_metadata>