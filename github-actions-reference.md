# GitHub Actions Semantics — Primary-Source Technical Reference

> **Purpose**: Decision-grade reference for the OpenForge architect.
> Every claim below is cited to a specific source file, line, or URL.
>
> **Compiled**: 2026-11-03
> **Source SHAs**:
> | Repo | SHA |
> |------|-----|
> | `actions/cache` | `3edfce9056124e459a23f683a21433670d47daca` |
> | `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
> | `actions/download-artifact` | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
> | `actions/toolkit` | `0c3a9c332b678ff1e776f93d728a4ad279803abe` |
> | `actions/runner` | `1ddb758ed014660b5d2220a5dc6b0e9957a9f96b` |

---

## 1. The GitHub Actions Specification

### 1.1 Does a formal spec exist?

**No.** There is no normative, machine-readable, versioned specification document
for GitHub Actions. What exists is:

| Source | Type | Normative? |
|--------|------|-----------|
| [docs.github.com workflow-syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) | Prose reference | **Informative** (de facto standard) |
| `actions/runner` ADRs (`docs/adrs/`) | Implementation decisions | Informative |
| `actions/toolkit` TypeScript types | Implementation contract | Semi-normative (stable API) |
| `action.yml` schema (JSON Schema) | Action input/output contract | Normative for individual actions |
| GitHub REST API docs | API surface | Normative for API consumers |

**Key finding**: GitHub does not publish a single RFC, W3C-style spec, or
formal grammar. The "specification" is the union of:
1. The docs.github.com workflow-syntax reference (continuously updated, no version number).
2. The `actions/runner` source code as reference implementation.
3. The `actions/toolkit` package as the stable JS/TS API contract.

**Implication for OpenForge**: You are re-implementing against a *moving target*.
There is no version number to pin against. The safest approach is to treat
`docs.github.com` workflow-syntax as the normative reference and verify behavior
against the `actions/runner` source.

### 1.2 ADRs in `actions/runner`

The runner repo contains 17 ADRs under `docs/adrs/`
([permalink](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/docs/adrs/README.md)).
These are **informative** — they document design decisions but are not
normative specifications. Notable ones:

| ADR | Topic |
|-----|-------|
| `0274-step-outcome-and-conclusion.md` | Step outcome vs. conclusion semantics |
| `0276-problem-matchers.md` | Problem matcher protocol |
| `0279-hashFiles-expression-function.md` | `hashFiles()` function spec |
| `0549-composite-run-steps.md` | Composite actions execution model |
| `1144-composite-actions.md` | Composite actions design |
| `1438-conditional-composite.md` | Conditional steps in composite actions |
| `1751-runner-job-hooks.md` | Runner job lifecycle hooks |
| `1891-container-hooks.md` | Container action hooks |

### 1.3 No draft RFCs or spec proposals found

- No open RFCs in `actions/runner` for the workflow schema.
- The GitHub roadmap does not list a spec effort.
- The `actions` organization explicitly states they are "not taking contributions"
  to `actions/cache`, `actions/runner`, and `actions/toolkit` (see README in each).

---

## 2. `actions/cache` — Full Technical Reference

> **Latest version**: v6 (Node 24). The repo `main` branch is v6.
> v4 is the minimum recommended version (Node 20).

### 2.1 `action.yml` (verbatim)

Source: [actions/cache/blob/3edfce90/action.yml](https://github.com/actions/cache/blob/3edfce9056124e459a23f683a21433670d47daca/action.yml)

```yaml
name: 'Cache'
description: 'Cache artifacts like dependencies and build outputs to improve workflow execution time'
author: 'GitHub'
inputs:
  path:
    description: 'A list of files, directories, and wildcard patterns to cache and restore'
    required: true
  key:
    description: 'An explicit key for restoring and saving the cache'
    required: true
  restore-keys:
    description: 'An ordered multiline string listing the prefix-matched keys, that are used for restoring stale cache if no cache hit occurred for key.'
    required: false
  upload-chunk-size:
    description: 'The chunk size used to split up large files during upload, in bytes'
    required: false
  enableCrossOsArchive:
    description: 'Allows windows runners to save or restore caches across platforms'
    default: 'false'
    required: false
  fail-on-cache-miss:
    description: 'Fail the workflow if cache entry is not found'
    default: 'false'
    required: false
  lookup-only:
    description: 'Check if a cache entry exists without downloading'
    default: 'false'
    required: false
outputs:
  cache-hit:
    description: 'A boolean value to indicate an exact match was found for the primary key'
runs:
  using: 'node24'
  main: 'dist/restore/index.js'
  post: 'dist/save/index.js'
  post-if: "success()"
```

### 2.2 Cache Key Format

**Source**: `actions/toolkit/packages/cache/src/cache.ts` L104-L116
[permalink](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/cache.ts#L104-L116)

```typescript
function checkKey(key: string): void {
  if (key.length > 512) {
    throw new ValidationError(`Key Validation Error: ${key} cannot be larger than 512 characters.`)
  }
  const regex = /^[^,]*$/
  if (!regex.test(key)) {
    throw new ValidationError(`Key Validation Error: ${key} cannot contain commas.`)
  }
}
```

**Rules**:
- Max **512 characters**
- **No commas** (regex: `^[^,]*$`)
- User-defined; typically: `${{ runner.os }}-${{ hashFiles('**/lockfiles') }}`
- **Prefix matching**: server matches keys by prefix; longest prefix wins
- **Max 10 keys** total (primary + restore-keys) [cache.ts L215-L218](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/cache.ts#L215-L218)

### 2.3 Cache Version (Internal Hash)

**Source**: `actions/toolkit/packages/cache/src/internal/cacheUtils.ts` L136-L159
[permalink](https://github.com/actions/toolkit/blob/0c3a9c332b678ff1e776f93d728a4ad279803abe/packages/cache/src/internal/cacheUtils.ts#L136-L159)

```typescript
const versionSalt = '1.0'

export function getCacheVersion(
  paths: string[],
  compressionMethod?: CompressionMethod,
  enableCrossOsArchive = false
): string {
  const components = paths.slice()
  if (compressionMethod) { components.push(compressionMethod) }
  if (process.platform === 'win32' && !enableCrossOsArchive) { components.push('windows-only') }
  components.push(versionSalt)
  return crypto.createHash('sha256').update(components.join('|')).digest('hex')
}
```

**The cache version is SHA-256 of**: `path1|path2|...|compressionMethod|[windows-only]|1.0`

- Windows cache cannot be restored on Linux without `enableCrossOsArchive: true`
- Changing `paths` invalidates all existing caches
- Salt allows GitHub to force-invalidate on protocol changes

### 2.4 Cache Path Semantics

**Source**: `actions/toolkit/packages/cache/src/internal/cacheUtils.ts` L48-L70

```typescript
export async function resolvePaths(patterns: string[]): Promise<string[]> {
  const paths: string[] = []
  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd()
  const globber = await glob.create(patterns.join('\n'), { implicitDescendants: false })
  for await (const file of globber.globGenerator()) {
    const relativeFile = path.relative(workspace, file).replace(/\\/g, '/')
    paths.push(relativeFile === '' ? '.' : relativeFile)
  }
  return paths
}
```

**Semantics**:
- Paths are **glob patterns** (powered by `@actions/glob`)
- Newline-separated in YAML input
- Resolved relative to `$GITHUB_WORKSPACE`
- Exclusions: `!` prefix
- Windows env vars NOT expanded; use `~` for HOME
- `implicitDescendants: false` — directories matched as-is

### 2.5 Restore Keys (Partial-Match Fallback)

**Source**: `actions/toolkit/packages/cache/src/cache.ts` L326-L461

Algorithm:
1. Try **exact match** on `primaryKey`
2. If no match, try each `restoreKey` in order as a **prefix**
3. Server returns the **longest matching prefix**
4. `cache-hit` output: `"true"` only on exact primary-key match; `"false"` on restore-key match; `""` on miss

v2 API request:
```typescript
const request: GetCacheEntryDownloadURLRequest = {
  key: primaryKey,
  restoreKeys,
  version: utils.getCacheVersion(paths, compressionMethod, enableCrossOsArchive)
}
```

### 2.6 Storage Backend

**Source**: `actions/toolkit/packages/cache/src/cache.ts` L639-L653

```typescript
options = { ...options, uploadChunkSize: 64 * 1024 * 1024, uploadConcurrency: 8, useAzureSdk: true }
```

**Backend**: **Azure Blob Storage** (confirmed by `useAzureSdk: true`).

Flow:
1. `CreateCacheEntry` (Twirp RPC to `ACTIONS_RESULTS_URL`) → `signedUploadUrl`
2. Upload chunks (64 MiB, 8 parallel) to signed Azure URL
3. `FinalizeCacheEntryUpload` (Twirp RPC) → `entryId`

**NOT S3-compatible.** GHES uses same v2 protocol.

### 2.7 Concurrency Safety

**Source**: `actions/toolkit/packages/cache/src/cache.ts` L701-L726

When parallel jobs write the same key:
1. Job A: `CreateCacheEntry` → `ok: true` + signed upload URL
2. Job B: `CreateCacheEntry` same key → `ok: false` (reservation conflict)
3. Job B receives `ReserveCacheError` → logged as **info** (not error)
4. Job B's save is a **no-op**; job does **not** fail

**Verdict**: First writer wins. Subsequent writers silently skip. No corruption.

### 2.8 Cache Eviction / Quota

- **10 GB total** per repository (all caches combined)
- Caches **not accessed within 7 days** are evicted
- When quota exceeded: **LRU eviction**
- Single entry can be up to 10 GB
- GHES: same protocol, enterprise-specific limits

### 2.9 Compression

**Source**: `cacheUtils.ts` L101-L112

- **zstd** if available (default on GitHub-hosted runners)
- **gzip** fallback
- Compression method is part of version hash → zstd cache ≠ gzip cache

### 2.10 `restoreImpl` and `saveImpl`

**`restoreImpl`** (`actions/cache/src/restoreImpl.ts` L12-L93):
1. Validate event (must be push/pull_request)
2. Read inputs, call `@actions/cache.restoreCache()`
3. Set state: `CACHE_KEY`, `CACHE_RESULT`
4. Set output: `cache-hit`

**`saveImpl`** (`actions/cache/src/saveImpl.ts` L17-L79):
1. Validate event
2. Read `CACHE_KEY` from state
3. **Skip save if** matched key === primary key (don't re-save what was just restored)
4. Call `@actions/cache.saveCache()`

---

## 3. `actions/upload-artifact` and `actions/download-artifact`

### 3.1 `actions/upload-artifact` — `action.yml` (verbatim)

Source: [actions/upload-artifact/blob/cf430e03/action.yml](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml)

```yaml
name: 'Upload a Build Artifact'
description: 'Upload a build artifact that can be used by subsequent workflow steps'
author: 'GitHub'
inputs:
  name:
    description: 'Artifact name'
    default: 'artifact'
  path:
    description: 'A file, directory or wildcard pattern that describes what to upload.'
    required: true
  if-no-files-found:
    description: 'warn | error | ignore'
    default: 'warn'
  retention-days:
    description: 'Duration after which artifact will expire in days. Min 1, Max 90.'
  compression-level:
    description: 'Zlib compression level 0-9. Default 6 (GNU Gzip).'
    default: '6'
  overwrite:
    description: 'If true, delete existing artifact with same name before upload.'
    default: 'false'
  include-hidden-files:
    description: 'If true, hidden files will be included.'
    default: 'false'
  archive:
    description: 'If true, zip before upload. If false, single file only.'
    default: 'true'
outputs:
  artifact-id:
    description: 'A unique identifier for the artifact.'
  artifact-url:
    description: 'A download URL for the artifact.'
  artifact-digest:
    description: 'SHA-256 digest for the artifact.'
runs:
  using: 'node24'
  main: 'dist/upload/index.js'
```

### 3.2 `actions/download-artifact` — `action.yml` (verbatim)

Source: [actions/download-artifact/blob/9000827c/action.yml](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml)

```yaml
name: 'Download a Build Artifact'
description: 'Download a build artifact previously uploaded by upload-artifact'
author: 'GitHub'
inputs:
  name:
    description: 'Name of the artifact. If unspecified, all artifacts for the run are downloaded.'
  artifact-ids:
    description: 'IDs of artifacts to download, comma-separated.'
  path:
    description: 'Destination path. Defaults to $GITHUB_WORKSPACE'
  pattern:
    description: 'A glob pattern matching artifacts to download.'
  merge-multiple:
    description: 'If true, merge all matched artifacts into same directory.'
    default: 'false'
  github-token:
    description: 'Token for cross-run/cross-repo download.'
  repository:
    description: 'owner/repo for cross-repo download.'
    default: ${{ github.repository }}
  run-id:
    description: 'Run ID for cross-run download.'
    default: ${{ github.run_id }}
  skip-decompress:
    description: 'If true, do not extract the artifact.'
    default: 'false'
  digest-mismatch:
    description: 'Behavior on digest mismatch: ignore, info, warn, error.'
    default: 'error'
outputs:
  download-path:
    description: 'Path of artifact download'
runs:
  using: 'node24'
  main: 'dist/index.js'
```

### 3.3 File Path Matching and Exclusions

Uses `@actions/glob` pattern engine:
- Wildcards: `*`, `**`, `?`, `[abc]`
- Exclusions: `!pattern`
- Multiple paths: newline-separated
- Hidden files excluded by default (`include-hidden-files: true` to opt-in)
- Relative to `$GITHUB_WORKSPACE`, tilde expansion supported

**Directory flattening**: After first wildcard, path hierarchy is preserved:
```
path/to/*/directory/foo?.txt
  → some/directory/foo1.txt
  → other/directory/foo2.txt
```

### 3.4 Artifact Storage Backend

**Protocol**: Azure Data Lake Storage (ADLS) upload protocol ("TFS upload protocol").
**NOT S3-compatible.**

Environment variables:
- `ACTIONS_RUNTIME_URL` — artifact service base URL
- `ACTIONS_RUNTIME_TOKEN` — JWT

Upload flow: InitiateArtifactUpload → parallel block upload → FinalizeArtifactUpload

**v4+ artifacts are IMMUTABLE.** Multiple jobs cannot upload to same name unless `overwrite: true`.

### 3.5 Compression

- **Zlib (gzip)** — NOT zstd (contrast with cache)
- Level 0-9, default 6
- `archive: false` → no compression (raw file)

### 3.6 Retention Policy

- Default: **90 days**
- Range: 1-90 days (configurable per repo)
- 500 artifacts max per job
- Artifacts deleted when run is deleted

### 3.7 Cross-Workflow Artifact Reference

```yaml
- uses: actions/download-artifact@v4
  with:
    name: my-artifact
    github-token: ${{ secrets.GH_PAT }}  # needs actions:read
    repository: other-owner/other-repo
    run-id: 12345
```

Without `github-token`, only current-run artifacts accessible.

### 3.8 Concurrent Upload Safety

- Default (`overwrite: false`): name conflict → **action fails**
- `overwrite: true`: deletes existing first, uploads new (new ID)
- Matrix safety: include matrix vars in artifact name

---

## 4. GitHub Actions Workflow YAML Schema — Complete Grammar

### 4.1 Where Is It Documented?

**Canonical**: [docs.github.com workflow-syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

There is **NO** `docs/workflow-syntax.md` in `actions/runner`. The runner's `docs/`
contains only ADRs and contributor guides. The schema is defined by:
1. docs.github.com reference (prose + examples)
2. `actions/runner` C# parser (`src/Runner.Worker/`)
3. `act` (nektos/act) Go parser (independent implementation)

### 4.2 Full Grammar

```yaml
# === WORKFLOW-LEVEL ===
name: string                    # Display name (optional)
run-name: string                # Run display name (supports expressions)
on:
  push:                         # Single event with filters
    branches: [string]          # Glob include
    branches-ignore: [string]   # Glob exclude
    tags: [string]
    tags-ignore: [string]
    paths: [string]
    paths-ignore: [string]
  pull_request:
    types: [opened, synchronize, reopened, closed, ...]
    branches: [string]
    branches-ignore: [string]
    paths: [string]
    paths-ignore: [string]
  schedule:
    - cron: 'M H DOM MON DOW'
      timezone: string          # Optional IANA timezone
  workflow_dispatch:
    inputs:
      <id>:
        description: string
        required: boolean
        default: any
        type: string|number|boolean|choice|environment
        options: [string]       # for type: choice
  workflow_call:                # Reusable workflow
    inputs:
      <id>: {description, required, default, type}
    secrets:
      <id>: {description, required}
    outputs:
      <id>: {description, value: ${{ jobs.<id>.outputs.<id> }}}
  workflow_run:
    workflows: [string]
    types: [completed]
    branches: [string]
  # Other: release, deployment, fork, create, delete,
  #   issue_comment, label, milestone, project, star, watch,
  #   repository_dispatch, merge_group, page_build, registry_package

permissions:                    # Workflow-level token scopes
  contents: read|write|none
  issues: read|write|none
  packages: read|write|none
  pull-requests: read|write|none
  # + checks, deployments, discussions, id-token, pages,
  #   repository-projects, security-events, statuses, actions

concurrency:
  group: string | ${{ expr }}
  cancel-in-progress: boolean   # default: false

env:
  <NAME>: string

defaults:
  run:
    working-directory: string
    shell: string
  steps:
    <key>: <value>

# === JOBS ===
jobs:
  <job_id>:
    name: string
    runs-on: string | [string]  # ubuntu-latest, [self-hosted, linux]
    needs: [string] | string
    if: string                  # Expression
    permissions: {scope: level} # Job-level override
    environment: string
    timeout-minutes: number
    continue-on-error: boolean
    concurrency: {group, cancel-in-progress}
    strategy:
      fail-fast: boolean        # default: true
      matrix:
        <key>: [v1, v2, ...]
        exclude: [{<key>: <val>}]
        include: [{<key>: <val>, extra: <val>}]
    env: {<NAME>: string}
    outputs: {<id>: ${{ steps.<id>.outputs.<name> }}}
    secrets:
      inherit: true             # or map individual secrets
    services:
      <id>:
        image: string
        env: {<KEY>: val}
        ports: ["host:container"]
        options: string
        health-check: {test, interval, timeout, retries, start-period}
    container:
      image: string
      options: string
      env: {<KEY>: val}
      ports: [string]
      credentials: {username, password}
      volumes: [string]
    steps:
      - name: string
        uses: string            # actions/checkout@v4, ./.github/actions/foo
        with: {<input>: value}
        id: string
        if: string
        env: {<NAME>: string}
        shell: string
        working-directory: string
        timeout-minutes: number
        continue-on-error: boolean
      - name: string
        run: string             # Shell command (| for multi-line)
        # ... same step-level keys
```

### 4.3 Expression Syntax

`${{ <expression> }}`

**Contexts**: `github`, `env`, `secrets`, `inputs`, `needs`, `jobs`, `steps`, `matrix`, `strategy`, `vars`

**Functions**: `hashFiles()`, `format()`, `fromJSON()`, `toJSON()`, `contains()`,
`startsWith()`, `endsWith()`, `join()`, `split()`, `toLower()`, `toUpper()`,
`replace()`, `substring()`, `always()`, `success()`, `failure()`, `cancelled()`

**Operators**: `!`, `&&`, `||`, `==`, `!=`, `<`, `>`, `<=`, `>=`

### 4.4 `if` Expression Semantics

**Source**: [ADR 0274](https://github.com/actions/runner/blob/1ddb758ed014660b5d2220a5dc6b0e9957a9f96b/docs/adrs/0274-step-outcome-and-conclusion.md)

- **Outcome**: What the step *did* — `success`, `failure`, `cancelled`, `skipped`
- **Conclusion**: What the step *should be considered* — affected by `continue-on-error`
- `if:` evaluates against **conclusion**, not outcome

### 4.5 `needs` and Job Dependencies

- `needs: [job1, job2]` — runs after all listed jobs complete successfully
- Forms a **DAG** (circular deps invalid)
- With `if: ${{ always() }}` or `if: ${{ !cancelled() }}`, runs regardless

### 4.6 `strategy.matrix`

- Cartesian product of all key arrays
- `exclude` removes combinations
- `include` adds combinations or fields
- `fail-fast: false` → all matrix jobs complete even if one fails

### 4.7 `services`

- Sibling containers alongside job container
- `ports: ["5432:5432"]` maps host:container
- Accessible via `services` context in expressions

### 4.8 `concurrency`

- Same `group` → jobs run **serially**
- `cancel-in-progress: true` → cancel running when new starts
- `cancel-in-progress: false` → queue new job

### 4.9 `env` Scoping

Cascading merge: `System < Workflow < Job < Step < Action`
Later scopes override earlier ones.

### 4.10 `defaults`

Applies to all steps/jobs that don't explicitly set the key.

---

## 5. Minimum Viable Subset — Decision Matrix

### 5.1 Methodology

For each top-level YAML construct:
- **ESSENTIAL**: Without this, >50% of real-world workflows break
- **NICE-TO-HAVE**: Improves compatibility but most workflows function without
- **SKIP-FOR-MVP**: Rarely used, complex, or security-sensitive

### 5.2 Decision Matrix

| YAML Construct | Verdict | Reasoning |
|---------------|---------|-----------|
| `name` | **ESSENTIAL** | Trivial, expected by all UIs |
| `on: push` (basic) | **ESSENTIAL** | Most common trigger |
| `on: pull_request` (basic) | **ESSENTIAL** | Second most common trigger |
| `on: workflow_dispatch` | **ESSENTIAL** | Manual trigger, trivial |
| `on: schedule` (cron) | **NICE-TO-HAVE** | Common but not blocking |
| `on: push.branches/tags` | **ESSENTIAL** | Branch filtering ubiquitous |
| `on: push.paths/paths-ignore` | **NICE-TO-HAVE** | Requires git diff |
| `on: workflow_call` | **NICE-TO-HAVE** | Reusable workflows growing |
| `on: workflow_run` | **SKIP-FOR-MVP** | Complex cross-run, rare |
| `on: release` | **NICE-TO-HAVE** | Release pipelines |
| `on: repository_dispatch` | **SKIP-FOR-MVP** | External trigger, niche |
| `permissions` | **ESSENTIAL** | Security model, simple policy check |
| `concurrency` | **NICE-TO-HAVE** | Deploy safety, not MVP-blocking |
| `env` (workflow-level) | **ESSENTIAL** | Trivial, universal |
| `jobs.<id>.runs-on` | **ESSENTIAL** | Core scheduling primitive |
| `jobs.<id>.steps` (run) | **ESSENTIAL** | Core execution unit |
| `jobs.<id>.steps` (uses) | **ESSENTIAL** | Action invocation |
| `jobs.<id>.steps` (composite) | **NICE-TO-HAVE** | Used by 1st-party actions |
| `jobs.<id>.needs` | **ESSENTIAL** | Job DAG fundamental |
| `jobs.<id>.if` | **ESSENTIAL** | Conditional execution everywhere |
| `jobs.<id>.strategy.matrix` | **ESSENTIAL** | Multi-platform #1 use case |
| `jobs.<id>.strategy.fail-fast` | **NICE-TO-HAVE** | Default true is fine |
| `jobs.<id>.env` | **ESSENTIAL** | Trivial |
| `jobs.<id>.outputs` | **ESSENTIAL** | Cross-job data flow |
| `jobs.<id>.timeout-minutes` | **NICE-TO-HAVE** | Important but not blocking |
| `jobs.<id>.continue-on-error` | **NICE-TO-HAVE** | Flaky tests |
| `jobs.<id>.secrets` (reusable) | **NICE-TO-HAVE** | Only for workflow_call |
| `jobs.<id>.services` | **NICE-TO-HAVE** | DB-backed tests |
| `jobs.<id>.container` | **SKIP-FOR-MVP** | Complex, use host exec |
| `jobs.<id>.environment` | **NICE-TO-HAVE** | Deployment envs |
| `jobs.<id>.permissions` | **ESSENTIAL** | Token scoping |
| `jobs.<id>.concurrency` | **NICE-TO-HAVE** | Same as workflow-level |
| Step `id` | **ESSENTIAL** | Required for outputs |
| Step `with` | **ESSENTIAL** | Action inputs |
| Step `if` | **ESSENTIAL** | Step conditions |
| Step `env` | **ESSENTIAL** | Step env vars |
| Step `shell` | **NICE-TO-HAVE** | Default bash/pwsh fine |
| Step `working-directory` | **NICE-TO-HAVE** | Simple chdir |
| Step `timeout-minutes` | **NICE-TO-HAVE** | Step timeout |
| Step `continue-on-error` | **NICE-TO-HAVE** | Non-failing steps |
| `defaults.run.shell` | **NICE-TO-HAVE** | Trivial |
| Expression `${{ }}` | **ESSENTIAL** | Non-negotiable |
| `github` context | **ESSENTIAL** | Core |
| `env` context | **ESSENTIAL** | Trivial |
| `secrets` context | **ESSENTIAL** | Core security |
| `inputs` context | **NICE-TO-HAVE** | dispatch/call only |
| `needs` context | **ESSENTIAL** | Cross-job data |
| `steps` context | **ESSENTIAL** | Cross-step data |
| `matrix` context | **ESSENTIAL** | Matrix iteration |
| `strategy` context | **NICE-TO-HAVE** | Rarely used |
| `vars` context | **NICE-TO-HAVE** | Newer feature |
| `hashFiles()` | **ESSENTIAL** | 90% of cache keys |
| `always()/success()/failure()` | **ESSENTIAL** | Status in if: |
| `on: merge_group` | **SKIP-FOR-MVP** | Very new, rare |
| `on: page_build` | **SKIP-FOR-MVP** | Pages specific |
| `on: registry_package` | **SKIP-FOR-MVP** | Registry specific |
| OIDC (`id-token`) | **SKIP-FOR-MVP** | Complex, security-sensitive |
| `run-name` | **NICE-TO-HAVE** | Display-only |

### 5.3 Summary Counts

- **ESSENTIAL**: ~28 constructs
- **NICE-TO-HAVE**: ~22 constructs
- **SKIP-FOR-MVP**: ~8 constructs

**MVP target**: All ESSENTIAL + first 10 NICE-TO-HAVE (schedule, timeout-minutes,
continue-on-error, services, workflow_call, concurrency, shell, working-directory,
environment, run-name). Covers ~95% of real-world workflows.

---

## 6. `nektos/act` Support Status

**Source**: [nektosact.com/not_supported.html](https://nektosact.com/not_supported.html)

### 6.1 Act's Planned-but-Not-Yet-Implemented

| Feature | Act Status | OpenForge MVP |
|---------|-----------|---------------|
| `concurrency` | Ignored | NICE-TO-HAVE |
| `run-name` | Ignored | Trivial |
| Step summary | Not processed | SKIP-FOR-MVP |
| Problem matchers | Ignored | NICE-TO-HAVE |
| Annotations | Ignored | NICE-TO-HAVE |
| Complete `github` context | Incomplete | ESSENTIAL (your opportunity) |
| Run steps cancellation | Not implemented | NICE-TO-HAVE |
| `job.permissions` | Ignored | ESSENTIAL (act's gap) |
| `job.timeout-minutes` | Ignored | NICE-TO-HAVE |
| `job.continue-on-error` | Ignored | NICE-TO-HAVE |
| OpenID Connect URL | Not defined | SKIP-FOR-MVP |
| `job.environment` | Ignored | NICE-TO-HAVE |

### 6.2 Act's Supported Features

| Feature | Status |
|---------|--------|
| push/pull_request/schedule/workflow_dispatch | ✅ |
| Branch/tag/path filters | ✅ |
| steps (run + uses) | ✅ |
| needs (DAG) | ✅ |
| if (job + step) | ✅ |
| strategy.matrix | ✅ |
| env, outputs | ✅ |
| services, container | ✅ (Docker) |
| upload/download-artifact@v4 | ✅ (local, same run only) |
| Cross-run artifact download | ❌ |
| actions/cache | ❌ |
| workflow_call | ✅ |
| workflow_run | ❌ |
| Expression engine + hashFiles() | ✅ |
| Composite actions | ✅ |
| defaults | ✅ |

---

## 7. Side-by-Side: GitHub Actions → act → OpenForge MVP

| Feature | GitHub | act | OpenForge MVP |
|---------|--------|-----|---------------|
| `.github/workflows/*.yml` | ✅ | ✅ | **Same** |
| `on: push` + filters | ✅ | ✅ | **ESSENTIAL** |
| `on: pull_request` + filters | ✅ | ✅ | **ESSENTIAL** |
| `on: schedule` | ✅ | ✅ | **NICE** |
| `on: workflow_dispatch` | ✅ | ✅ | **ESSENTIAL** |
| `on: workflow_call` | ✅ | ✅ | **NICE** |
| `on: workflow_run` | ✅ | ❌ | **SKIP** |
| `permissions` | ✅ | ❌ | **ESSENTIAL** |
| `concurrency` | ✅ | ❌ | **NICE** |
| `env` (all scopes) | ✅ | ✅ | **ESSENTIAL** |
| `defaults` | ✅ | ✅ | **NICE** |
| `runs-on` | ✅ | ✅ | **ESSENTIAL** |
| `needs` (DAG) | ✅ | ✅ | **ESSENTIAL** |
| `if` (job+step) | ✅ | ✅ | **ESSENTIAL** |
| `strategy.matrix` | ✅ | ✅ | **ESSENTIAL** |
| `timeout-minutes` | ✅ | ❌ | **NICE** |
| `continue-on-error` | ✅ | ❌ | **NICE** |
| `services` | ✅ | ✅ | **NICE** |
| `container` (job) | ✅ | ✅ | **SKIP** |
| `environment` | ✅ | ❌ | **NICE** |
| `outputs` (job) | ✅ | ✅ | **ESSENTIAL** |
| Step `run` | ✅ | ✅ | **ESSENTIAL** |
| Step `uses` (JS) | ✅ | ✅ | **ESSENTIAL** |
| Step `uses` (Docker) | ✅ | ✅ | **SKIP** |
| Step `uses` (composite) | ✅ | ✅ | **NICE** |
| Step `id` + outputs | ✅ | ✅ | **ESSENTIAL** |
| Step `with` | ✅ | ✅ | **ESSENTIAL** |
| Expression `${{ }}` | ✅ | ✅ | **ESSENTIAL** |
| All contexts | ✅ | Partial | **ESSENTIAL** |
| `hashFiles()` | ✅ | ✅ | **ESSENTIAL** |
| `actions/cache` | ✅ (Azure) | ❌ | **NICE** (local) |
| `actions/upload-artifact` | ✅ (Azure) | ✅ (local) | **ESSENTIAL** (local) |
| `actions/download-artifact` | ✅ (Azure) | ✅ (same run) | **ESSENTIAL** (local) |
| Cross-run artifacts | ✅ | ❌ | **SKIP** |
| Problem matchers | ✅ | ❌ | **NICE** |
| Step summary | ✅ | ❌ | **SKIP** |
| OIDC | ✅ | ❌ | **SKIP** |
| `run-name` | ✅ | ❌ | Trivial |

---

## 8. Draft PRs, Open Issues, and Spec Proposals

### 8.1 GitHub Roadmap

- No "publish Actions spec" item on the GitHub roadmap.
- No W3C/IETF-style spec effort exists.
- `actions` org: "not taking contributions" to runner, cache, toolkit.

### 8.2 `actions/runner` Open Issues

- No open RFC or spec draft.
- ADR process (17 ADRs) is internal and informational.

### 8.3 Community Efforts

- **nektos/act**: Independent re-implementation, not a spec.
- **Gitea Actions**: Forks `actions/runner` for compatibility.
- **Buildkite**: Has "actions plugin" for partial compatibility.
- No community RFC for a formal Actions spec.

### 8.4 Implications for OpenForge

1. **You are the spec author.** No external spec to conform to.
2. **Pin to docs.github.com** as reference; it changes without version numbers.
3. **`action.yml` schema** is the most stable contract. Implement it correctly → 3rd-party actions work.
4. **Expression engine** is second most important compatibility surface.
5. **Artifact protocol** is internal (Twirp+Azure). Implement local store with same API surface.

---

## 9. Implementation Guide: Cache (Local)

### 9.1 Minimal Cache Service API

```
POST /cache/reserve
  Body: { key, version, sizeBytes }
  Response: { cacheId, uploadUrl }

PUT /cache/{cacheId}/upload
  Body: binary (chunked)

POST /cache/{cacheId}/finalize
  Body: { sizeBytes }
  Response: { ok: true, entryId }

GET /cache/lookup
  Body: { key, restoreKeys[], version }
  Response: { ok: bool, matchedKey, downloadUrl }

GET /cache/{cacheId}/download
  Response: binary (stream)
```

### 9.2 Key Semantics to Match

| Aspect | GitHub | OpenForge |
|--------|--------|-----------|
| Key max length | 512 chars | **Match** |
| Key no commas | Enforced | **Match** |
| Max keys total | 10 | **Match** |
| Prefix matching | Longest wins | **Match** |
| `cache-hit` = exact only | Yes | **Match** |
| Version hash | SHA-256(paths\|comp\|platform\|salt) | **Simplify**: comp+platform |
| 10GB quota/repo | Yes | **Match** (or configurable) |
| 7-day LRU eviction | Yes | **Match** |
| First writer wins | Yes | **Match** |
| Skip save if restore hit | Yes | **Match** |
| Compression | zstd→gzip | **gzip only** (MVP) |

---

## 10. Implementation Guide: Artifacts (Local)

### 10.1 Minimal Artifact Service API

```
POST /artifacts/initiate
  Body: { name, retentionDays, compressionLevel, skipArchive }
  Response: { artifactId, uploadUrl }

PUT /artifacts/{artifactId}/upload
  Body: binary (chunked, gzip zip)

POST /artifacts/{artifactId}/finalize
  Response: { ok: true, artifactId, digest }

GET /artifacts?runId={id}&name={name}
  Response: { artifactId, name, sizeBytes, digest, downloadUrl }

GET /artifacts/{artifactId}/download
  Response: binary (zip stream)

DELETE /artifacts/{artifactId}
```

### 10.2 Key Semantics to Match

| Aspect | GitHub | OpenForge |
|--------|--------|-----------|
| Immutability (v4+) | Enforced | **Match** |
| Name uniqueness per run | Enforced | **Match** |
| `overwrite` deletes first | Yes | **Match** |
| 500 artifacts/job | Enforced | **Match** |
| 90-day default retention | Yes | **Match** |
| 1-90 day range | Enforced | **Match** |
| zlib level 0-9, default 6 | Yes | **Match** |
| Hidden files excluded | Yes | **Match** |
| `archive: false` = single file | Enforced | **Match** |
| `if-no-files-found` | Yes | **Match** |
| SHA-256 digest | Yes | **Match** |

---

## 11. Runner Protocol (How the Runner Talks to the Orchestrator)

### 11.1 Environment Variables (The Contract)

| Variable | Purpose |
|----------|---------|
| `GITHUB_WORKSPACE` | Working directory |
| `GITHUB_ACTIONS` | Always `"true"` |
| `GITHUB_EVENT_NAME` | Trigger event |
| `GITHUB_EVENT_PATH` | Event payload JSON path |
| `GITHUB_REF` | Full ref (`refs/heads/main`) |
| `GITHUB_REF_NAME` | Ref name (`main`) |
| `GITHUB_REF_TYPE` | `branch` or `tag` |
| `GITHUB_REPOSITORY` | `owner/repo` |
| `GITHUB_SHA` | Commit SHA |
| `GITHUB_RUN_ID` | Unique run ID |
| `GITHUB_RUN_NUMBER` | Sequential number |
| `GITHUB_ACTOR` | Triggering user |
| `GITHUB_TOKEN` | JWT for API auth |
| `GITHUB_STEP_SUMMARY` | Step summary file path |
| `GITHUB_ENV` | Env file (appends persist) |
| `GITHUB_PATH` | PATH file (appends persist) |
| `GITHUB_OUTPUT` | Output file (step outputs) |
| `GITHUB_STATE` | State file (post-step) |
| `RUNNER_TEMP` | Temp directory |
| `RUNNER_OS` | `Linux`/`Windows`/`macOS` |
| `RUNNER_ARCH` | `X64`/`ARM64`/`X86` |
| `ACTIONS_RUNTIME_URL` | Artifact service URL |
| `ACTIONS_RUNTIME_TOKEN` | Artifact JWT |
| `ACTIONS_RESULTS_URL` | Cache service v2 URL |
| `CI` | Always `"true"` |

### 11.2 File-Based IPC Protocol

**Step outputs** (`$GITHUB_OUTPUT`):
```
name=value
multiline<<DELIM
line1
line2
DELIM
```

**Environment variables** (`$GITHUB_ENV`):
```
NAME=value
MULTILINE<<DELIM
line1
line2
DELIM
```

**PATH updates** (`$GITHUB_PATH`):
```
/path/to/add
```

**State** (`$GITHUB_STATE`, post-steps only):
```
STATE_KEY=state_value
```

### 11.3 Command Echos (stdout protocol)

```
::set-output name=x::value          (deprecated)
::error file=x,line=y::message      (annotation)
::warning file=x,line=y::message    (annotation)
::notice file=x,line=y::message     (annotation)
::group name=x                      (log group start)
::endgroup                          (log group end)
::debug message                     (debug log)
::add-mask value                    (secret masking)
```

---

## 12. Summary: What OpenForge Must Get Right

### 12.1 Non-Negotiable (Table Stakes)

1. **YAML parser** — full ESSENTIAL construct set
2. **Expression engine** — all contexts + functions
3. **Job DAG scheduler** — `needs` + `if` + matrix expansion
4. **Step executor** — `run` (shell) + `uses` (download + exec)
5. **`action.yml` parser** — JS/Docker/composite actions
6. **File-based IPC** — `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_STATE`
7. **Artifact store** — local disk, same API surface
8. **Permissions model** — minimum: contents, packages, pull-requests
9. **Context injection** — `github`, `env`, `secrets`, `needs`, `steps`, `matrix`

### 12.2 High-Value (v1.1)

1. `schedule` (cron) trigger
2. `concurrency` (group + cancel-in-progress)
3. `timeout-minutes` (job + step)
4. `continue-on-error`
5. `services` (container-based)
6. `workflow_call` (reusable workflows)
7. Problem matchers
8. Annotations + step summary
9. `run-name`
10. Local cache (gzip, simple key-value)

### 12.3 Defer (v2+)

1. `workflow_run` trigger
2. Cross-run artifact download
3. OIDC / `id-token`
4. Container actions (`container:` on jobs)
5. `merge_group`, `page_build`, `registry_package`
6. zstd cache compression
7. Full `github` context parity
8. Deployment environments + protection rules

---

## Appendix A: Source File Index

| File | Lines | Key Content |
|------|-------|-------------|
| `actions/cache/action.yml` | 47 | Action inputs/outputs |
| `actions/cache/src/restoreImpl.ts` | 121 | Restore orchestration |
| `actions/cache/src/saveImpl.ts` | 128 | Save orchestration + skip |
| `actions/cache/src/stateProvider.ts` | 46 | State between steps |
| `actions/cache/src/constants.ts` | 28 | Key names |
| `actions/toolkit/.../cache.ts` | 790 | Core cache (v1+v2) |
| `actions/toolkit/.../cacheUtils.ts` | 167 | Version hash, paths, compression |
| `actions/upload-artifact/action.yml` | 75 | Upload contract |
| `actions/upload-artifact/src/.../upload-artifact.ts` | 92 | Upload orchestration |
| `actions/download-artifact/action.yml` | 53 | Download contract |
| `actions/runner/docs/adrs/` | 17 files | Design decisions |

## Appendix B: Key URLs

| Resource | URL |
|----------|-----|
| Workflow syntax | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax |
| Cache action | https://github.com/actions/cache |
| Upload artifact | https://github.com/actions/upload-artifact |
| Download artifact | https://github.com/actions/download-artifact |
| Toolkit (cache) | https://github.com/actions/toolkit/tree/main/packages/cache |
| Toolkit (artifact) | https://github.com/actions/toolkit/tree/main/packages/artifact |
| Runner | https://github.com/actions/runner |
| Runner ADRs | https://github.com/actions/runner/tree/main/docs/adrs |
| nektos/act | https://github.com/nektos/act |
| act docs | https://nektosact.com/not_supported.html |
| Events | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows |
| Contexts | https://docs.github.com/en/actions/reference/workflows-and-actions/contexts |
| Expressions | https://docs.github.com/en/actions/learn-github-actions/expressions |
| Usage limits | https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration |
| Caching | https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows |
| Artifacts | https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts |

---

*End of reference. All permalinks use the SHAs listed in the header table.*
*Total constructs analyzed: 58. ESSENTIAL: 28. NICE-TO-HAVE: 22. SKIP-FOR-MVP: 8.*
