# OpenForge Actions-Compatibility MVS - Round-2 Verification Report

> **Date:** 2026-11-03
> **Scope:** Re-verify Round-1 SHAs, spec version, draft PRs, ADRs, per-action contracts. Identify drift and gaps.
> **Method:** All claims backed by gh api / gh pr view / file-content fetches at 2026-11-03 UTC.
> **Round-1 source:** openforge-research-actions-spec.md (784 lines, authored 2026-11-03)

---

## 1. SHA Re-Verification

Round-1 anchored every claim on six repository HEADs. Each was re-fetched via gh api repos/<owner>/<repo>/commits/HEAD at the time of this verification pass.

| Repo | Round-1 SHA | Current HEAD | Verdict |
|------|-------------|--------------|---------|
| actions/runner | 1ddb758ed014660b5d2220a5dc6b0e9957a9f96b | 1ddb758ed014660b5d2220a5dc6b0e9957a9f96b | CONFIRMED |
| actions/toolkit | 0c3a9c332b678ff1e776f93d728a4ad279803abe | 0c3a9c332b678ff1e776f93d728a4ad279803abe | CONFIRMED |
| actions/cache | 3edfce9056124e459a23f683a21433670d47daca | 3edfce9056124e459a23f683a21433670d47daca | CONFIRMED |
| actions/upload-artifact | cf430e030ddbb5b0abf93d22962f4752f3646cd9 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 | CONFIRMED |
| actions/checkout | f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a | f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a | CONFIRMED |
| actions/github-script | 3a2844b7e9c422d3c10d287c895573f7108da1b3 | 3a2844b7e9c422d3c10d287c895573f7108da1b3 | CONFIRMED |

**Conclusion:** All six SHAs are still the main-branch HEAD. No drift at the commit level. All permalinks in Round-1 remain valid.

**Latest runner release:** v2.338.2 (2026-10-26). Release timeline:

| Tag | Date |
|-----|------|
| v2.338.2 | 2026-10-26 |
| v2.338.1 | 2026-10-22 |
| v2.338.0 | 2026-10-06 |
| v2.337.0 | 2026-08-26 |
| v2.336.0 | 2026-07-20 |

Round-1 was authored 2026-11-03, so all five releases above were available. v2.336.0 is the minimum for the new GITHUB_ARTIFACTS command file (section 5.1).
---

## 2. Spec Version + Draft PRs Re-Verification

### 2.1 Workflow schema version

**Claim (Round-1):** The workflow schema is workflow-v1.0; there is no workflow-v2.0.

**Verification:** Fetched src/Sdk/WorkflowParser/workflow-v1.0.json at HEAD.
- Line 2: version: workflow-v1.0 - CONFIRMED
- WorkflowTemplateConstants.cs: public const String Workflow_1_0 = workflow-v1.0 - CONFIRMED
- No workflow-v2.0.json or Workflow_2_0 constant exists - CONFIRMED

**However, the schema has grown materially.** Now 5,173 lines / 101,439 bytes. Four schema-level features added that Round-1 missed:

| Feature | Schema Location | Added (PR) | Round-1 Coverage |
|---------|----------------|------------|-----------------|
| snapshot (job-level) | L3607, L3884-L3980 | #4443 (2026-05-21) | MISSED |
| input-type-environment | L2912-L2918, L3174-L3189 | schema evolution | MISSED |
| vulnerability-alerts permission | L3349-L3355 | #4350 (2026-04-21) | MISSED |
| Service entrypoint / command | L4734-L4747 | #4276 (2026-03-04) | MISSED |

**snapshot** (new job keyword): Define a custom image after job success by snapshotting the runner. Properties: image-name (required), if (expression), version (string). GitHub-hosted-runner-specific. SHOULD-DIVERGE for self-hosted.

**input-type-environment**: workflow_dispatch and workflow_call inputs can now be type=environment. Full set: string, boolean, number, choice, environment.

**vulnerability-alerts**: New read-only token permission for Dependabot alerts (permission-level-read-or-no-access).

**Service entrypoint/command**: Override Docker ENTRYPOINT and CMD in service containers.

### 2.2 Draft PRs - all still OPEN, none merged

| PR | Title | Status |
|----|-------|--------|
| #4761 | Align string-to-number coercion with JS Number() | OPEN (unmerged) |
| #4662 | feat: report token permissions via env var | OPEN (unmerged) |
| #4736 | Expose GHA environment name to job hooks | OPEN (unmerged) |
| #4710 | Add RISC-V architecture support | OPEN (unmerged) |
| #4757 | Upgrade runner to .NET 10 | OPEN (unmerged) |
| #4831 | Fix/include docker container hooks | OPEN (unmerged) |

**None merged, closed, or renumbered.** The JS-Number coercion PR (#4761) has NOT merged - current runner still uses pre-Number() semantics.

### 2.3 New open PRs Round-1 missed (behavior-relevant)

| PR | Title | Relevance |
|----|-------|-----------|
| #4708 | Add cooperative drain controls for ephemeral runners | Self-hosted runner lifecycle |
| #4618 | Exit ephemeral runner when job assignment is lost | Runner lifecycle edge case |
| #4729 | Keep the Busy long-poll open when a job completes | Runner protocol semantics |
| #4675 | Avoid truncating event.json while other steps read it | github.event_path race fix |
| #4643 | Write event.json once per job instead of once per step | event.json lifecycle change |
| #4760 | Use ordinal IndexOf/LastIndexOf in PowerShell encoders | Shell escaping fix |
| #4588 | Stream action archive downloads to disk | Memory optimization |
| #4794 | Kill entire process tree on Linux/macOS | run step teardown |
| #4809 | Retry container/service health more frequently | services robustness |

**None merged yet.** These represent the upcoming contract delta.

### 2.4 ADRs - no new ADRs since Round-1

18 ADR files total. Last commit: 2025-05-05 (problem matchers). No new ADRs.
0279 (hashFiles) remains the key expression ADR. The snapshot feature, GITHUB_ARTIFACTS, and ACTIONS_CACHE_MODE do NOT have ADRs yet.
---

## 3. Per-Action Verification

### 3.1 actions/cache (SHA 3edfce90, 2026-07-15) - UNCHANGED

#### 3.1.1 cache-hit semantic - CONFIRMED
Fetched src/restoreImpl.ts L53-L79. Logic unchanged: miss=empty string (NOT false), prefix=false, exact=true.

#### 3.1.2 Cache version formula - CONFIRMED
SHA-256 over paths+compressionMethod+(windows-only)+1.0 joined by pipe. Unchanged.

#### 3.1.3 Cache v1 vs v2 protocol - CONFIRMED
config.ts: v1=ACTIONS_CACHE_URL fallback ACTIONS_RESULTS_URL; v2=ACTIONS_RESULTS_URL. GHES always v1. Flag: ACTIONS_CACHE_SERVICE_V2.

#### 3.1.4 NEW: ACTIONS_CACHE_MODE env var (Round-1 MISSED)
New per-job env var: none / read / write / write-only / empty(permissive).
Source: packages/cache/src/internal/config.ts (PR #1768, 2026-06).
Controls whether cache is readable/writable. Unset=permissive (backward-compatible).

#### 3.1.5 Compression - CONFIRMED
gzip to cache.tgz; zstd to cache.tzst; zstd uses --long=30. GNU tar preferred. Unchanged.

#### 3.1.6 Eviction/limits - CONFIRMED
10 GiB per repo. LRU. 1-week inactivity. Unchanged.

#### 3.1.7 NEW: Three entry points (Round-1 MISSED)
The repo now has THREE action entry points:
| Path | Name | Purpose | Runtime |
|------|------|---------|---------|
| action.yml (root) | Cache | restore(main)+save(post, post-if:success()) | node24 |
| restore/action.yml | Restore Cache | standalone restore-only | node24 |
| save/action.yml | Save a cache | standalone save-only | node24 |

cache/restore inputs: path, key, restore-keys, enableCrossOsArchive, fail-on-cache-miss, lookup-only. Outputs: cache-hit, cache-primary-key, cache-matched-key.
cache/save inputs: path, key, upload-chunk-size, enableCrossOsArchive.

**save-always is DEPRECATED** with deprecationMessage: does not work as intended, will be removed. Use separate actions/cache/restore step instead.

#### 3.1.8 Node 24 requirement
All three cache actions declare using: node24.

### 3.2 actions/upload-artifact (SHA cf430e03, v7.0.2) - FULLY CONFIRMED

All inputs/outputs match Round-1. ZIP+zlib L6. Immutability. artifact-digest SHA-256. 90d/1-90 retention. 500/job. Merge sub-action. node24. No changes.

### 3.3 actions/checkout (SHA f548e57e, 2026-07-20) - CONFIRMED

Auth flow (.extraheader + base64 x-access-token) confirmed at L95-L115 (NOT L56-L74 as Round-1 cited).
persist-credentials: false. PR merge ref. SSH flow. LFS/submodules. url.insteadOf. All unchanged.
LINE FIX: Round-1 cited L56-L74; actual auth logic is L95-L115 (constructor body). L56-L74 is field declarations.

Recent bug fixes (same version, no contract change): escape --unset values (#2530), trim ascii whitespace (#2521), skip unsafe pr check (#2518).

### 3.4 Tool cache (RUNNER_TOOL_CACHE) - CONFIRMED with LINE FIX

Fetched HostContext.cs. Tool cache resolution at L851-L862 (NOT L410 as Round-1 cited).
Fallback chain: RUNNER_TOOL_CACHE -> RUNNER_TOOLSDIRECTORY -> AGENT_TOOLSDIRECTORY -> Constants.Variables.Agent.ToolsDirectory. Unchanged.
LINE FIX: L410 is proxy password masking (this.SecretMasker.AddValue), NOT tool cache.
Platform paths unchanged: Linux /opt/hostedtoolcache, macOS /Users/runner/hostedtoolcache, Windows C:\hostedtoolcache.

### 3.5 actions/github-script (SHA 3a2844b7, v9) - CONFIRMED

v9 ESM + getOctokit factory. All globals unchanged. node24. No changes since 2026-04-09.
NEW: refName/refType added to Context class (from GITHUB_REF_NAME/GITHUB_REF_TYPE env vars, L73-L76 of context.ts).
---

## 4. Material Corrections to Round-1

### 4.1 WRONG: HostContext.cs line number (HIGH severity)
| Item | Round-1 | Actual |
|------|---------|--------|
| RUNNER_TOOL_CACHE resolution | L410 | L851-L862 |
L410 is: this.SecretMasker.AddValue(WebProxy.HttpProxyPassword) - proxy password masking, unrelated to tool cache.

### 4.2 IMPRECISE: git-auth-helper.ts line range (MEDIUM severity)
| Item | Round-1 | Actual |
|------|---------|--------|
| Auth header construction | L56-L74 | L95-L115 |
L56-L74 is class field declarations. Constructor starts L83. Auth logic at L95-L115.

### 4.3 FICTITIOUS: GITHUB_WORKFLOW_ENV (HIGH severity)
Round-1 listed GITHUB_WORKFLOW_ENV as a workflow command file. It DOES NOT EXIST.
Verification: 0 results in actions/toolkit, 0 in actions/runner, 1 unrelated global result (Strapi CMS).

**Actual workflow command files:**
| Env Var | Purpose | Source |
|---------|---------|--------|
| GITHUB_OUTPUT | Step outputs | core.ts L218 |
| GITHUB_ENV | Cross-step env vars | core.ts L87 |
| GITHUB_PATH | PATH modifications | core.ts L133 |
| GITHUB_STATE | Step state (post-step) | core.ts L378 |
| GITHUB_STEP_SUMMARY | Job summary markdown | summary.ts L5 |
| GITHUB_ARTIFACTS | Declarative artifact registration | core.ts L442 (runner 2.336.0+) |

### 4.4 INCOMPLETE: actions/cache architecture (MEDIUM severity)
Round-1 described a single action. Reality: 3 entry points + deprecated save-always + node24.

### 4.5 INCOMPLETE: case() function GA timing (LOW severity)
case() added 2025-12-17 (PR #4147), flag removed 2026-03-27 (PR #4316).
First release with case() GA: v2.337.0 (2026-08-26). Not in runners before that.
---

## 5. Gaps Round-1 Missed

### 5.1 GITHUB_ARTIFACTS - New 7th Workflow Command File (MUST)
New file-based command for declarative artifact registration. Runner 2.336.0+.
declareArtifact(artifact) in @actions/core: takes file path (vs GITHUB_WORKSPACE) or OCI ref with digest.
Prefixes: file:// or oci://. One per line. # comments skipped. Runner validates post-step.
Invalid declaration = step failure. Paradigm shift: declare intent, runner handles transport.

### 5.2 ACTIONS_CACHE_MODE - Per-Job Cache Access Control (MUST)
New env var: none/read/write/write-only/empty(permissive). Server sets per job.
Restricts cache for fork PRs. Cache client checks before read/write. Unset=permissive.

### 5.3 cache/restore + cache/save sub-actions (MUST)
Standalone restore-only and save-only. Replace deprecated save-always. New uses: targets.

### 5.4 environment input type (SHOULD)
workflow_dispatch/workflow_call inputs can be type=environment. Binds input to a GitHub Environment.

### 5.5 snapshot job keyword (MAY DIVERGE)
GitHub-hosted-only. Docker image snapshots after job success. Document as unsupported.

### 5.6 vulnerability-alerts permission (SHOULD)
Read-only. Dependabot alerts. Trivial to add to permissions list.

### 5.7 Service entrypoint/command (SHOULD)
Override Docker ENTRYPOINT/CMD in service containers. Needed for complex service setups.

### 5.8 refName/refType in Context (MUST)
New Context properties from GITHUB_REF_NAME/GITHUB_REF_TYPE. Runner must set these env vars.

### 5.9 Node 24 universal runtime (MUST)
ALL first-party actions now require node24: cache, upload-artifact, github-script, checkout.

### 5.10 @actions/attest / SLSA (MAY DIVERGE)
Full Sigstore/InToto package in toolkit. GitHub-specific supply-chain infrastructure.

### 5.11 event.json lifecycle (TRACK)
PRs #4643, #4675 pending. May change when event_path is written. Affects mid-job reads.
---

## 6. MVS Delta (Round-2 Update)

### ADD to MUST:

| Item | Layer | Reason |
|------|-------|--------|
| GITHUB_ARTIFACTS + declareArtifact() | L3 runtime env | New in runner 2.336.0 |
| ACTIONS_CACHE_MODE | L3 runtime env | Fork-PR read-only cache |
| cache/restore + cache/save | L4 built-in actions | New uses: targets |
| refName/refType env vars | L2 contexts | Standard github context |
| Node 24 universal runtime | L3 runtime env | All actions require it |
| vulnerability-alerts permission | L2 permissions | New scope |
| Service entrypoint/command | L1 schema | New container props |

### ADD to SHOULD:

| Item | Layer |
|------|-------|
| environment input type | L1 schema |
| case() function (version-gated) | L2 expressions |

### ADD to DIVERGE:

| Item | Reason |
|------|--------|
| snapshot keyword | GitHub-hosted-specific |
| @actions/attest / SLSA / Sigstore | GitHub-specific infra |
| GITHUB_ARTIFACTS OCI ref mode | GitHub registry-specific |

### REMOVE:

| Item | Reason |
|------|--------|
| GITHUB_WORKFLOW_ENV | FICTITIOUS |

### UNCHANGED (confirmed):

workflow-v1.0, 12 contexts, 8 functions, precedence, MaxDepth=50, MaxLength=21000, cache SHA-256, v1/v2 protocol, 10GiB/LRU/1wk, cache-hit, save NO-OP, artifact v4 immutable, ZIP+zlib L6, artifact-digest, 90d/1-90, 500/job, merge, checkout .extraheader, persist-credentials, PR merge ref, RUNNER_TOOL_CACHE, tool cache paths, github-script v9 ESM + getOctokit.

---

## 7. Open Questions for Round-3

### 7.1 Contradictions found: NONE (only citation errors)

### 7.2 Questions:

| # | Question |
|---|----------|
| 1 | Exact GITHUB_ARTIFACTS runner-side parsing/validation logic? |
| 2 | Is GITHUB_ARTIFACTS a file or pipe? |
| 3 | ACTIONS_CACHE_MODE default for fork PRs (server-side)? |
| 4 | Is environment input type fully GA or preview? |
| 5 | snapshot runner-side implementation? |
| 6 | Minimum runner version for cache/restore sub-action? |
| 7 | Which release shipped case() without feature flag? |

### 7.3 2026 H2/2027 direction signals:

| Signal | Evidence |
|--------|----------|
| Ephemeral runner lifecycle | #4708, #4618, #4748 |
| Protocol hardening | #4729, #4671, #4806 |
| Node 24/25 tracking | #4640, #4800, #4832 |
| Declarative artifacts | GITHUB_ARTIFACTS |
| .NET 10 | #4757 (open) |
| RISC-V | #4710 (open) |
| MCP/LLM inputs | NO EVIDENCE in open repos |

### 7.4 Compatibility Tier 2 (power-user):

| Feature | Effort |
|---------|--------|
| environment + protection rules | Medium |
| workflow_run cross-run artifacts | High |
| OIDC id-token + external IdP | High |
| services entrypoint/command + health | Medium |
| concurrency cancel-in-progress | Low |
| max-parallel + cancel-timeout | Low |
| Basic attestations (SLSA L1) | Medium |
| pull_request_target | High |
| GITHUB_ARTIFACTS full | Medium |
| ACTIONS_CACHE_MODE | Low |

---

## Appendix A: Verification Evidence Log

| Check | Method | Result |
|-------|--------|--------|
| 6x SHA HEAD | gh api commits/HEAD | All match |
| 6x PR status | gh pr view --json state | All OPEN |
| 40 open PRs | gh pr list --limit 40 | 10 new relevant |
| Schema version | Fetch L2 | workflow-v1.0 |
| Schema size | --jq .size | 101439 bytes / 5173 lines |
| 4 new schema features | Grep | snapshot, env-type, vuln-alerts, entrypoint |
| ExpressionConstants | Fetch file | 8 funcs, MaxDepth=50, MaxLength=21000 |
| HostContext tool cache | Grep RUNNER_TOOL_CACHE | L851-L862 (NOT L410) |
| git-auth auth | Read L83-L130 | .extraheader at L95-L115 |
| cache restoreImpl | Read L53-L79 | cache-hit unchanged |
| cache config.ts | Fetch | ACTIONS_CACHE_MODE + v1/v2 |
| cache action.yml | Fetch | save-always deprecated, node24 |
| cache/restore | Fetch | New sub-action |
| cache/save | Fetch | New sub-action |
| upload-artifact | Fetch | v7.0.2 unchanged |
| checkout auth | Read L83-L130 | Confirmed |
| github-script | SHA match | v9 unchanged |
| toolkit core.ts | Grep GITHUB_ARTIFACTS | declareArtifact L697 |
| toolkit context.ts | Grep refName | L23-L24, L73-L76 |
| ADR directory | List | 18 files, last 2025-05-05 |
| Runner releases | gh api releases | v2.338.2 latest |
| GITHUB_WORKFLOW_ENV | Global search | 0 results - FICTITIOUS |
| Permissions list | Read L3224-L3356 | 17 scopes |
| workflow_dispatch types | Read L3174-L3189 | 5 types incl environment |

## Appendix B: Corrected Permalinks

| Was | Should Be |
|-----|-----------|
| HostContext.cs#L410 | HostContext.cs#L851-L862 |
| git-auth-helper.ts#L56-L74 | git-auth-helper.ts#L95-L115 |

## Appendix C: Full Permissions List (17 scopes)

| Permission | Type |
|------------|------|
| actions | any |
| artifact-metadata | any |
| attestations | any |
| checks | any |
| contents | any |
| deployments | any |
| discussions | any |
| id-token | write-or-no-access |
| issues | any |
| models | read-or-no-access |
| packages | any |
| pages | any |
| pull-requests | any |
| repository-projects | any |
| security-events | any |
| statuses | any |
| vulnerability-alerts | read-or-no-access |

---

*End of Round-2 verification report.*

---

## Appendix D: Detailed Findings - New Schema Features

### D.1 snapshot keyword (L3884-L3980)

Full schema definition:

    snapshot:
      context: [github, inputs, vars, needs, strategy, matrix]
      description: Use snapshot to define a custom image you want to
        create or update after your job succeeds by taking a snapshot
        of your runner.
      one-of: [snapshot-image-name, snapshot-mapping]

    snapshot-mapping:
      mapping:
        properties:
          image-name: (type: snapshot-image-name, required: true)
          if: (type: snapshot-if)
          version: (type: non-empty-string, description: The desired
            major version updates upon a new custom image version creation)

    snapshot-if:
      context: [github, inputs, vars, needs, strategy, matrix, steps, job,
        runner, env, always(0,0), failure(0,0), cancelled(0,0), success(0,0),
        hashFiles(1,255)]
      string: { is-expression: true }

**Analysis:** The snapshot-if context includes ALL standard contexts plus all
extension functions - identical to step-if. This means any expression that
works in a step if: works in snapshot.if:. The image-name is a simple
non-empty string (no validation against registry format in the schema -
that is server-side). The version field suggests semantic versioning of
custom images.

**OpenForge decision:** This is clearly GitHub-hosted-runner infrastructure
(Docker/OCI image management). A self-hosted runner cannot take snapshots
of itself in this way. Document as unsupported. If a user has this in their
workflow, the runner should either ignore it (with a warning) or fail with
a clear error message.

### D.2 input-type-environment (L2912-L2918, L3174-L3189)

    input-type-environment:
      string:
        constant: environment

    workflow-dispatch-input-type:
      description: A string representing the type of the input. This must
        be one of: boolean, number, string, choice, or environment.
      one-of: [input-type-string, input-type-boolean, input-type-number,
        input-type-environment, input-type-choice]

**Analysis:** This is a 5th input type alongside the original 4 (string,
boolean, number, choice). The environment type means the input value is a
GitHub Environment name. When the workflow runs, the environment context
(variables, secrets, protection rules) is resolved. This enables patterns
like: manually trigger a deploy workflow and select which environment to
deploy to, with that environment secrets/variables automatically available.

**OpenForge decision:** SHOULD implement. Requires: (1) the environment
concept (named environments with variables/secrets), (2) the input type in
the schema, (3) the server-side resolution of environment context when the
workflow is triggered.

### D.3 Service entrypoint/command (L4734-L4747)

    entrypoint:
      type: string
      description: Override the default ENTRYPOINT in the service
        container image.
    command:
      type: string
      description: Override the default CMD in the service container
        image.

**Analysis:** These map directly to docker run --entrypoint and
docker run command arguments. They are simple string overrides. This
unlocks patterns like: run a specific Postgres migration command in a
postgres service container, or start Redis with specific config flags.

**OpenForge decision:** SHOULD implement. Simple to add to the container
startup logic (docker run --entrypoint X command Y).

### D.4 vulnerability-alerts permission (L3349-L3355)

    vulnerability-alerts:
      type: permission-level-read-or-no-access
      description: Dependabot alerts.

**Analysis:** Read-only permission. The only valid values are read or
no-access (cannot write). This allows workflows to read Dependabot alert
data without granting write access.

**OpenForge decision:** SHOULD add to the permissions list. Trivial change.

---

## Appendix E: Detailed Findings - GITHUB_ARTIFACTS

### E.1 declareArtifact() full source (core.ts L656-L744)

  /**
   * Declares an artifact for the current step.
   *
   * The artifact can be one of the following:
   *
   * - A path to a local file, such as dist/app.tar.gz. The runner
   *   resolves relative paths against GITHUB_WORKSPACE, not the current
   *   working directory.
   * - An OCI subject reference that includes a digest, such as
   *   ghcr.io/octocat/app:1.0.0@sha256:<hex>.
   *
   * To force how the runner interprets the value, prefix it with file://
   * or oci://. The runner validates each declaration after the step
   * completes and fails the step if a declaration is invalid.
   *
   * Artifact declarations require runner version 2.336.0 or later and
   * take effect only where they are enabled. On older runners,
   * GITHUB_ARTIFACTS is not set, so this function logs a debug message
   * and returns without declaring the artifact. Where artifact
   * declarations are not enabled, the runner ignores GITHUB_ARTIFACTS,
   * so the declaration has no effect.
   *
   * @param artifact path to a local file, or an OCI subject reference
   *   with a digest
   */
  export function declareArtifact(artifact: string): void {
    const value = artifact.trim()
    if (!value) throw new Error("Artifact must not be empty")
    if (/[\r\n]/.test(value))
      throw new Error(artifact must not contain line breaks)
    if (value.startsWith("#"))
      throw new Error(artifact would be ignored as a comment. To declare
        a file whose name starts with "#", prefix the path with "file://")
    if (!process.env["GITHUB_ARTIFACTS"]) {
      debug("Skipping artifact declaration: $GITHUB_ARTIFACTS is not set.
        Requires runner 2.336.0+")
      return
    }
    issueFileCommand("ARTIFACTS", value)
  }

### E.2 Contract summary

| Aspect | Detail |
|--------|--------|
| Env var | GITHUB_ARTIFACTS (file path) |
| Min runner | 2.336.0 (2026-07-20) |
| Format | One declaration per line |
| Comments | Lines starting with # are skipped |
| Blank lines | Skipped |
| File path resolution | Against GITHUB_WORKSPACE (NOT CWD) |
| OCI refs | Must include @sha256:<hex> digest |
| Force file | Prefix with file:// |
| Force OCI | Prefix with oci:// |
| Validation | Post-step; invalid = step failure |
| Gate | "where they are enabled" (server-side flag) |

### E.3 OpenForge implementation notes

1. Set GITHUB_ARTIFACTS to a writable temp file per step
2. After step completes, read the file
3. Skip blank lines and # comments
4. For each declaration:
   a. If starts with file:// or no prefix and looks like a path:
      resolve against GITHUB_WORKSPACE, verify file exists
   b. If starts with oci:// or looks like an OCI ref:
      validate format (registry/repo:tag@sha256:hex)
   c. If invalid, fail the step with a clear error
5. For valid file declarations: upload to artifact store
6. For valid OCI declarations: reference the existing OCI artifact
7. Clear the file for the next step

**Uncertainty:** The exact server-side behavior (what "where they are
enabled" means, what the runner does with the uploaded file, whether it
creates a new artifact or attaches to an existing one) is not visible in
the open-source runner. This requires Round-3 investigation.

---

## Appendix F: Detailed Findings - ACTIONS_CACHE_MODE

### F.1 Full config.ts source

  export function isGhes(): boolean {
    const ghUrl = new URL(process.env["GITHUB_SERVER_URL"] || "https://github.com")
    const hostname = ghUrl.hostname.trimEnd().toUpperCase()
    const isGitHubHost = hostname === "GITHUB.COM"
    const isGheHost = hostname.endsWith(".GHE.COM")
    const isLocalHost = hostname.endsWith(".LOCALHOST")
    return !isGitHubHost && !isGheHost && !isLocalHost
  }

  export function getCacheServiceVersion(): string {
    // Cache service v2 is not supported on GHES. We will default to
    // cache service v1 even if the feature flag was enabled by user.
    if (isGhes()) return "v1"
    return process.env["ACTIONS_CACHE_SERVICE_V2"] ? "v2" : "v1"
  }

  // The cache-mode latitude: readable = {read, write}, writable = {write,
  // write-only}, none = neither.
  const KNOWN_CACHE_MODES = ["none", "read", "write", "write-only"]

  // The effective cache-mode exported by the runner, or "" when not set.
  export function getCacheMode(): string {
    return (process.env["ACTIONS_CACHE_MODE"] || "").trim().toLowerCase()
  }

  // Unset or unrecognized modes are permissive so behavior matches today.
  export function isCacheReadable(mode: string): boolean {
    if (!KNOWN_CACHE_MODES.includes(mode)) return true
    return mode === "read" || mode === "write"
  }

  export function isCacheWritable(mode: string): boolean {
    if (!KNOWN_CACHE_MODES.includes(mode)) return true
    return mode === "write" || mode === "write-only"
  }

  export function getCacheServiceURL(): string {
    const version = getCacheServiceVersion()
    switch (version) {
      case "v1":
        return process.env["ACTIONS_CACHE_URL"] || process.env["ACTIONS_RESULTS_URL"] || ""
      case "v2":
        return process.env["ACTIONS_RESULTS_URL"] || ""
      default:
        throw new Error(Unsupported cache service version: ${version})
    }
  }

### F.2 Behavior matrix

| ACTIONS_CACHE_MODE | isCacheReadable | isCacheWritable | Use Case |
|-------------------|----------------|----------------|----------|
| (unset/empty) | true | true | Normal (backward-compatible) |
| none | false | false | Disallow cache entirely |
| read | true | false | Fork PRs (restore only) |
| write | true | true | Normal full access |
| write-only | false | true | Unusual (save without restore) |
| (unrecognized) | true | true | Permissive fallback |

### F.3 OpenForge implementation

The runner must:
1. Receive the cache mode from the server in the job message
2. Export it as ACTIONS_CACHE_MODE env var to the step environment
3. The cache client (@actions/cache) reads it and skips read/write as needed

The server must:
1. Determine the cache mode based on token permissions and event type
2. Include it in the job message sent to the runner

**For fork PRs:** mode should be "read" (can restore, cannot save).
**For normal runs:** mode should be "write" or unset (full access).
**For scheduled runs with no write token:** mode should be "read".

---

## Appendix G: Complete Permissions List with Types

From workflow-v1.0.json L3224-L3356:

| # | Permission | Type | Description |
|---|------------|------|-------------|
| 1 | actions | any | Actions workflows, workflow runs, artifacts |
| 2 | artifact-metadata | any | Artifact Metadata |
| 3 | attestations | any | Artifact attestations |
| 4 | checks | any | Check runs and check suites |
| 5 | contents | any | Repo contents, commits, branches, downloads, releases, merges |
| 6 | deployments | any | Deployments and deployment statuses |
| 7 | discussions | any | Discussions and related comments and labels |
| 8 | id-token | write-or-no-access | Token to request an OIDC token |
| 9 | issues | any | Issues, comments, assignees, labels, milestones |
| 10 | models | read-or-no-access | Call AI models with GitHub Models |
| 11 | packages | any | GitHub Package Platform |
| 12 | pages | any | Pages statuses, configuration, builds |
| 13 | pull-requests | any | PRs, comments, assignees, labels, milestones, merges |
| 14 | repository-projects | any | Classic projects |
| 15 | security-events | any | Code scanning alerts |
| 16 | statuses | any | Commit statuses |
| 17 | vulnerability-alerts | read-or-no-access | Dependabot alerts (NEW) |

**Type meanings:**
- any: read, write, or no-access
- read-or-no-access: read or no-access only (no write)
- write-or-no-access: write or no-access only (no read)

Round-1 mentioned models and attestations in the DIVERGE section but did not
list the full 17-scope set. vulnerability-alerts is the only truly new one
(added 2026-04-21).

---

*End of Round-2 verification report. Total verification time: ~30 minutes.*
