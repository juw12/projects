# OpenForge Round 2 — Verification of the Round-1 CI-Engine Comparison

**Date of verification:** 2026-11-03 (Asia/Bangkok)
**Subject:** `openforge-research-ci-engines.md` (Round-1, dated 2026-11-03, ~737 lines)
**Method:** every cited SHA re-resolved against the live GitHub API today; every
schema claim re-checked against current source (raw file fetches at cited SHAs
and at HEAD) or current official docs; omitted-engine gap scan via repo-status
API. All "verified" statements below carry a permalink or an API observation
from today.

**Note on the Round-1 artifact:** the saved Round-1 file is a raw session dump
(lines 1–144 contain the subagent's planning/thinking trace and a
`task_metadata` block at lines 733–737). The actual report body begins at line
148 ("# Pipeline Definition Surface: Self-Hosted CI Engines"). Verification
below targets that body.

**Headline results:**
- 5 of 7 pinned SHAs are **still exact HEAD** (or exact tag commit) today — zero
  drift, because Round-1 was produced the same day (2026-11-03).
- **4 material errors/out-of-date claims** found in Round-1:
  1. The Buildkite `script` step type **does not exist** (hallucination).
  2. **Tekton Hub is dead** — public hub shut down 2026-01-08, repo archived
     2026-02-10; Round-1 presents it as a live marketplace.
  3. **Woodpecker's secret model is stale** — Round-1 describes the Drone-1.x
     era (secret *types* `environment`/`encrypt`/`file` + named vault/k8s/aws
     extensions); the 3.20 model is a scoped central store + `from_secret` + a
     **generic HTTP secret extension** whose official 3rd-party list is empty.
  4. **"Drone 2.x frozen, now 3.x" is wrong** — v2.28.2 shipped **2026-04-20**,
     *after* v3.3.0 (2025-08-14); both lines are released in parallel, and the
     newest GitHub *release* is v2.28.2, not a 3.x.
- **1 big scope omission:** **Jenkins** (MIT, 26.7k stars, pushed today) — the
  default self-hosted CI — was entirely absent from Round-1.
- No Round-3-blocking contradictions; a few genuine open questions are listed
  in §6.

---

## 1. SHA / version re-verification

All values below re-fetched from the GitHub API on **2026-11-03** (authenticated
`gh api`, account `juw12`). "Round-1 pin" is what the Round-1 report cited.

| # | Repo | Round-1 pin | Current HEAD (2026-11-03) | Tag/commit check | Verdict |
|---|------|-------------|---------------------------|------------------|---------|
| 1 | `woodpecker-ci/woodpecker` | `02f61d5563812d68cb27cbe6ecd1889ad85f4b02` ("v3.20.1") | `02f61d5563812d68cb27cbe6ecd1889ad85f4b02` (pushed 2026-11-03T01:35Z) | tag `v3.20.1` → commit `3f1bb0bd0db28e410ad797034d75780116122c91` (2026-10-29); release published 2026-10-29T19:39Z | ✅ SHA still HEAD. ⚠️ Minor: `02f61d55` is **main HEAD**, not the v3.20.1 tag commit — Round-1 conflated "current version" with "this SHA". Version+date claims correct. |
| 2 | `buildkite/agent` | `v4.9.0` (2026-10-30) | `fb25363c9ea8dd81c02936e32b5ce5f8d38269d5` (pushed 2026-11-03T02:44Z) | tag `v4.9.0` → `735f98f3de5a29a9b3b60a36bbcef4f4e1d9ba17` (commit 2026-10-30); release published 2026-10-30T05:57Z | ✅ Version + date exact. HEAD has since moved past the tag (normal). |
| 3 | `buildkite/go-pipeline` | `f8926e94645dccb79803eabf1c40ecfc71a977df` | `f8926e94645dccb79803eabf1c40ecfc71a977df` (pushed 2026-10-26) | latest GitHub release `v0.18.1` (2026-09-28) — older than HEAD | ✅ Still HEAD. Round-1 correctly used HEAD rather than a release tag. |
| 4 | `concourse/concourse` | `v8.3.2 @ 352512db1243de2e2e4e6e06e73ce1c9cc0cd235` | `352512db1243de2e2e4e6e06e73ce1c9cc0cd235` (pushed 2026-11-03T07:06Z) | tag `v8.3.2` → commit `b188e99f7aa0f7247c37e80a0efb5c77e8bc67c2` (2026-09-25); release published 2026-10-23T01:31Z | ⚠️ SHA still HEAD, but it is **~5 weeks past the v8.3.2 tag**. "v8.3.2 @ 352512db" is a misattribution: the tag lives at `b188e99f`. Release date (2026-10-23) is correct. |
| 5 | `tektoncd/pipeline` | `v1.18.0 @ d55f53a622c2bd82e89ce7c1b6cd59d52b24849c` | `d55f53a622c2bd82e89ce7c1b6cd59d52b24849c` (pushed 2026-11-02T18:26Z) | tag `v1.18.0` → same SHA (commit 2026-10-26); release published 2026-10-29T19:38Z | ✅ **Exact** — tag commit == cited SHA == HEAD. Cleanest pin of the six. |
| 6 | `kubernetes-sigs/prow` | `43ed234002b9` (12-char) | `43ed234002b9831fc0b8100c3c467f2146dbc8e3` (pushed 2026-11-03T06:49Z) | n/a — **no GitHub releases exist** (`/releases/latest` → 404 today) | ✅ 12-char prefix of current HEAD; still HEAD. Round-1's "no semver releases" claim **confirmed** by the 404. |
| 7 | `harness/harness` | `v3.3.0` (Drone successor) | `1852fedc41b8c1fabd96208f4b09264717004314` (pushed 2026-11-02T17:46Z) | tag `v3.3.0` → `c7470a71a698fe91f07dc0a6630e594db3354ad3` (**2025-08-14**); **latest GitHub release = `v2.28.2` (published 2026-04-20T11:19Z**, tag commit `477dc7709cf3d3a6471285e83ed33e712e35c7c9`, 2026-04-20) | ⚠️ v3.3.0 tag exists but is **not the newest release**. The 2.x line was released *after* 3.3.0 (v2.28.2, 2026-04-20). Round-1's "2.x frozen / now 3.x" framing is wrong — see §3.4. |

### 1.1 `drone/drone` → `harness/harness` redirect

- **Verified today:** `GET /repos/drone/drone` resolves to
  `full_name: harness/harness`, description *"Harness Open Source is an
  end-to-end developer platform with Source Control Management, CI/CD
  Pipelines, Hosted Developer Environments, and Artifact Registries."*
- **Correction (minor):** the API returns `archived: false` — the old Drone
  repo was **transferred/renamed** to `harness/harness`, not archived.
  Round-1 said "archived and redirects"; the redirect is real, "archived" is
  not.

### 1.2 Activity check (the "Active (last push)" column)

| Repo | pushed_at (2026-11-03) | stars (today) | Round-1 star claim |
|------|------------------------|---------------|--------------------|
| woodpecker-ci/woodpecker | 2026-11-03T01:35Z | 8,099 | "~8.1k" ✅ |
| buildkite/agent | 2026-11-03T02:44Z | 1,101 | — |
| buildkite/go-pipeline | 2026-10-26T20:53Z | 13 | — |
| concourse/concourse | 2026-11-03T07:06Z | 7,939 | — |
| tektoncd/pipeline | 2026-11-02T18:26Z | 9,092 | — |
| kubernetes-sigs/prow | 2026-11-03T06:49Z | 333 | "~333" ✅ |
| harness/harness | 2026-11-02T17:46Z | 38,802 | — |

Round-1's conclusion — **all six actively maintained as of 2026-11-03** — is
confirmed. No release in any of the six postdates the Round-1 pins (latest
releases are exactly the ones cited: v3.20.1 / v4.9.0 / v8.3.2 / v1.18.0;
Prow and go-pipeline have no newer release than noted).

---

## 2. Per-engine schema verification

### 2.1 Buildkite (`buildkite/go-pipeline` @ `f8926e94`, == HEAD)

All files below were fetched **byte-identical at the Round-1 cited SHA and at
HEAD** (verified for `pipeline.go`; spot-verified for the rest — repo last
pushed 2026-10-26, so zero drift is expected and confirmed).

**`Pipeline` struct — VERIFIED, matches Round-1 exactly.**
[`pipeline.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/pipeline.go)
```go
type Pipeline struct {
    Steps    Steps          `yaml:"steps"`
    Env      *ordered.MapSS `yaml:"env,omitempty"`
    Secrets  Secrets        `yaml:"secrets,omitempty"`
    Checkout *Checkout      `yaml:"checkout,omitempty"`
    RemainingFields map[string]any `yaml:",inline"`
}
```
`UnmarshalOrdered` accepts both a mapping and a **legacy bare sequence of
steps** — Round-1's "mapping OR bare sequence" claim verified.

**`CommandStep` — VERIFIED.**
[`step_command.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command.go):
`Key` (aliases `id`,`identifier`), `Label` (alias `name`), `Command`
(single string; a `commands:` list is accepted and joined with `\n` in
`UnmarshalOrdered` via `aliases:"command"`), `Plugins`, `Secrets`, `Env`,
`Signature`, `Matrix`, `Cache`, `Checkout`, `RemainingFields`. Every field
Round-1 listed is present.

**`Matrix` — VERIFIED, first-class.**
[`step_command_matrix.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command_matrix.go):
`Setup MatrixSetup` (map dim→[]values, or a bare list = one anonymous
dimension) + `Adjustments []*MatrixAdjustment` (`With`, `Skip any` — truthy
scalars count as skip; **`soft_fail` is deliberately carried in
`RemainingFields`**). `validatePermutation` enforces dimension/value
consistency. Round-1's "setup + adjustments (skip/soft_fail)" claim is
**confirmed**; note the `soft_fail` implementation detail (inline remaining
field, not a typed struct member).

**`Cache` — VERIFIED, still first-class.**
[`step_command_cache.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command_cache.go):
`Disabled bool`, `Name string`, `Paths []string`, `Size string` +
`RemainingFields`. `UnmarshalOrdered` also accepts `cache: false`,
`cache: "path"` and `cache: [paths]` — more flexible than Round-1 stated
(Round-1's struct sketch was otherwise exact).

**`Trigger` — VERIFIED, still first-class (cross-repo).**
[`step_trigger.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_trigger.go):
`TriggerStep { Contents map[string]any yaml:",inline" }` — an opaque inline
map, exactly as Round-1 described (`provider`/`label`/`build`/`from_branch`
are server-side conventions, not typed here).

**`InputStep` (block/input) — VERIFIED.**
[`step_input.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_input.go):
"InputStep models a block or input step" — matches Round-1.

**Step-type registry — MATERIAL CORRECTION.**
[`step.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step.go)
defines the `Step` interface with exactly five implementers via the
`stepTag()` marker: **`CommandStep`, `WaitStep`, `InputStep`, `TriggerStep`,
`GroupStep`**. There is **no `script` step type**:
`step_script.go` returns **404** at HEAD
(`https://raw.githubusercontent.com/buildkite/go-pipeline/HEAD/step_script.go`).
Round-1 §3.4's bullet "`script` — references an artifact containing the shell
script" is **false** — no such step exists in the open schema source.

**Plugin canonical resolution — VERIFIED.**
[`plugin.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/plugin.go)
`FullSource()`: 1 segment `thing` → `github.com/buildkite-plugins/thing-buildkite-plugin`;
2 segments `owner/repo` → `github.com/owner/repo-buildkite-plugin`; `#ref`
fragments preserved; >2 segments or paths/URLs pass through untouched.
Matches Round-1's claim.

**Deprecation scan (since Round-1):** code search for `deprecat` in the repo
finds only: (a) a deprecated `ordered.Map` iteration helper, (b) a note about
older signature field sets, (c) `step_scalar.go`'s "deprecated variations" of
the scalar step names (`wait`/`block`/`input`). **No schema field
(`cache`, `trigger`, `matrix`, `artifacts`, …) has been deprecated** since
Round-1 — and the code is unchanged, since the pin *is* HEAD.

**`artifacts:` / `if_changed` / `searchForSecrets` (agent side):** not
re-verified this round (agent HEAD moved past the Round-1 context); Round-1
cited `clicommand/pipeline_upload.go` — still plausible, flag as
not-re-verified.

### 2.2 Drone 2.0 / Harness Open Source (`harness/harness`)

Re-verified against the **current** docs site (docs.drone.io, which now links
to `community.harness.io` — itself evidence of the rebrand) and the repo API.

- **`kind:` object model — VERIFIED, unchanged.** The Configuration page
  (https://docs.drone.io/pipeline/configuration/) documents exactly three
  object kinds per YAML document: **`pipeline`**, **`signature`** (HMAC
  integrity), **`secret`** (client-side-encrypted, linked from
  `/secret/encrypted/`). Nothing new added to the kind model.
- **Runtimes — VERIFIED, exact match.** Current docs nav lists precisely:
  **Docker, Kubernetes, Exec, SSH, AWS, Digital Ocean, MacStadium** — the same
  seven as Round-1, with per-runtime syntax sections.
- **DAG — VERIFIED.** Multiple `kind: pipeline` docs + `depends_on`
  fan-out/fan-in, as documented on the Configuration page ("Graph Execution").
- **Scripting — VERIFIED + one nuance.** Starlark and Jsonnet are documented;
  the page additionally says "You can also create your own language
  extension" — a Round-1 miss (minor).
- **Cross-repo trigger:** no first-class `trigger:` step appears anywhere in
  the current docs structure. Round-1's inference (API/plugin, flagged as
  inference) **stands**.
- **Version line — see §3.4.** Tags: `v3.3.0` (2025-08-14, newest tag) down
  through `v3.0.0-beta.5`…; releases: `v2.28.2` (2026-04-20) is the latest
  GitHub release. Both lines coexist.

### 2.3 Woodpecker CI (v3.20.x docs + code @ `02f61d55`)

Re-verified against the **versioned 3.20.x docs** (the exact docs line for
Round-1's pinned release) and code.

**Workflow/step keys — VERIFIED.**
https://woodpecker-ci.org/docs/usage/workflow-syntax (3.20.x):
- Workflow-level: `steps`, `services`, `workspace` (`base`/`path`, default
  `/woodpecker/src/…`), `matrix`, `labels`, `clone`, `skip_clone`, `when`
  (global), `depends_on` (with `optional: true`), `concurrency`, `variables`
  (YAML anchors/aliases — **Round-1 missed this**).
- Step-level: `image`, `pull`, `commands`, `entrypoint`, `environment`,
  `failure` (`fail|ignore|cancel`), `when`, `depends_on`, `volumes`, `detach`,
  `directory`, `backend_options`, `privileged`, `dns` (+ `dns_search` under
  trusted-network) — all present as Round-1 claimed.

**Event list — VERIFIED, exact.** `push`, `pull_request`,
`pull_request_closed`, `pull_request_metadata`, `tag`, `release`,
`deployment`, `cron`, `manual`.

**Matrix — VERIFIED, first-class.** "Woodpecker executes a separate build
task for each combination in the matrix" (3.20 docs, `matrix` section +
/matrix-workflows page). Per-step `when: { matrix: {…} }` targeting a single
permutation confirmed in the workflow-syntax page.

**Secrets — MATERIAL CORRECTION (Round-1 is stale).**
https://woodpecker-ci.org/docs/usage/secrets (3.20.x) describes a **different
model** from Round-1 §1.5:
- Secrets live in a **central secret store** with **three scopes**:
  **repository > organization > global** (org and global scopes are new vs.
  Round-1's "declared per-repo" framing).
- Referenced via **`from_secret:`** in `environment:` or plugin `settings:`
  — not "injected as env vars with a `CI_SECRET_` prefix" (that 1.x-era
  mechanism is not part of the 3.20 docs).
- **Event filter:** secrets are **not exposed to `pull_request` by default**
  (explicit opt-in required) — an important security detail Round-1 missed.
- **Plugin/image filter:** secrets can be restricted to specific plugin
  images — Round-1 missed.
- **`$$` escaping** for secrets inside `evaluate`/parameter expressions —
  Woodpecker has the *same* `$`/`$$` duality Round-1 attributed only to
  Buildkite.
- The **secret types** `environment` / `encrypt` (HMAC) / `file` that
  Round-1 listed are **Drone-1.x-era** concepts; the 3.20 docs define no
  secret "type" field.
- **Secret extensions:** the 3.20 mechanism is a **generic signed-HTTP
  endpoint** (per-repo settings or global
  `WOODPECKER_SECRET_EXTENSION_ENDPOINT`), where your service receives
  `{repo, pipeline, netrc?}` and returns `{secrets: [{name, value, images?,
  events?}]}`
  (https://woodpecker-ci.org/docs/usage/extensions/secret-extension).
  The official **"3rd Party Extensions" list is empty** ("*Add your extension
  here!*"). Consequently Round-1's "plus secret extensions for external
  stores: `kubernetes`, `vault`, `aws-secrets-manager`" is **unsupported**:
  there are no bundled K8s/Vault/AWS secret extensions in 3.20.
- **OIDC verdict:** "achievable via a secret extension" is directionally
  correct only in the sense that you would **write and host your own** HTTP
  service that returns an OIDC token. There is no first-class OIDC and no
  off-the-shelf extension. Round-1's phrasing overstated this.

**Plugin model — VERIFIED with note.** Image+settings plugins, services,
marketplace (woodpecker-ci.org/plugins) — unchanged. The pipeline-definition
types live in [`server/model/pipeline.go`](https://github.com/woodpecker-ci/woodpecker/blob/02f61d5563812d68cb27cbe6ecd1889ad85f4b02/server/model/pipeline.go)
and the builder under `pipeline/frontend/builder/` (note: Round-1's implied
`src/pipeline/` path does not exist in 3.x — repo layout is `server/` +
`pipeline/`).

**Cross-repo trigger:** Round-1 said "via plugin `woodpeckerci/plugin-trigger`".
Not re-verified this round (plugin marketplace not crawled) — flagged.

**New since Round-1's coverage (same-day, i.e., Round-1 misses):**
- `when: { status: [failure] }` — **run-on-failure step filter**
  (documented on the workflow-syntax page; lets you attach failure handlers).
- Full `when` filter set is **11 filters** (`repo`, `branch`, `event`, `cron`,
  `ref`, `status`, `platform`, `matrix`, `instance`, `path`, `evaluate`);
  Round-1 named only 5.
- **Autoscaler** — a new first-class component ("server + agent + optional
  autoscaler" — administration/general page) that spins cloud VMs for pending
  builds; Round-1's component list was "Docker/Kubernetes/Local/Custom
  backends" only.
- **SQLite is the default database** (no external DB for small installs;
  Postgres/MariaDB recommended for larger) — relevant to the resource-
  requirements comparison (§4.6).
- **Trusted repositories / security boundaries** doc area (privileged steps,
  trusted networks) — a real governance surface Round-1 didn't mention.
- Legacy `.drone.yml`: **dropped as default** in 2.0 (CHANGELOG: 'Drop
  ".drone.yml" as default pipeline config (#1795)'); pipeline path is now
  per-repo configurable. Round-1's Drone-fork provenance claim is fine, but
  the format boundary is cleaner than Round-1 implied.

### 2.4 Concourse CI (`concourse/concourse` @ HEAD `352512db`)

Code-level verification (GitHub code search + file confirmation at HEAD):

- **`IDToken` credential manager — VERIFIED, first-class.**
  [`atc/creds/idtoken/`](https://github.com/concourse/concourse/tree/352512db1243de2e2e4e6e06e73ce1c9cc0cd235/atc/creds/idtoken)
  contains `idtoken.go` (`var _ creds.Secrets = (*IDToken)(nil)`),
  `manager.go` (audience validation), `lifecycle.go` (signing-key rotation),
  and [`manager_factory.go`](https://github.com/concourse/concourse/blob/352512db1243de2e2e4e6e06e73ce1c9cc0cd235/atc/creds/idtoken/manager_factory.go)
  with `creds.Register("idtoken", NewManagerFactory())` — a registered,
  first-class credential manager, exactly as Round-1 claimed.
- **`set_pipeline` — VERIFIED.**
  [`atc/exec/set_pipeline_step.go`](https://github.com/concourse/concourse/blob/352512db1243de2e2e4e6e06e73ce1c9cc0cd235/atc/exec/set_pipeline_step.go)
  (tracing span `set_pipeline`; archival of replaced pipelines).
- **`across` (matrix) — VERIFIED, first-class step modifier.**
  `atc/exec/across_step.go` (`func Across(… plan atc.AcrossPlan …)`),
  `atc/plan.go` (`Across *AcrossPlan json:"across,omitempty"`), `atc/steps.go`
  (`Key: "across"`, `Vars []AcrossVarConfig`). Cross-repo use is gated by
  team permissions as Round-1 stated (permission mechanics not re-verified
  line-by-line; flagged).
- **Not re-verified this round** (Round-1 claims carried as-is, flagged):
  `var_sources` manager list beyond idtoken (Vault/SSM/Conjur/CredHub/K8s),
  resource-type plugin ABI (`check`/`in`/`out`), GC/retention semantics,
  Windows worker.

### 2.5 Tekton (`tektoncd/pipeline` @ `d55f53a6` == v1.18.0 == HEAD)

Verified by listing the **v1 API package at the pinned tag**
(`GET /repos/tektoncd/pipeline/contents/pkg/apis/pipeline/v1?ref=d55f53a6…`):

- **`Artifact` CRD — VERIFIED.** `artifact_types.go` is present in
  `pkg/apis/pipeline/v1/` → the `Artifact` resource is **v1**, not
  experimental. Round-1's "Artifact resource (newer, `tekton.dev/v1`)"
  confirmed.
- **Matrix — VERIFIED.** `matrix_types.go` in v1 (matrix on PipelineTasks,
  incl. `finally` per docs).
- **CRD core — VERIFIED by file presence:** `pipeline_types.go`,
  `task_types.go`, `pipelinerun_types.go`, `taskrun_types.go`,
  `workspace_types.go`, `when_types.go`, `result_types.go`,
  `resolver_types.go` (resolvers), `param_types.go`, `container_types.go`.
- **Secrets/identity:** K8s Secrets + `serviceAccountName` model — docs
  consistent with Round-1 (not re-crawled; flagged).
- **Tekton Triggers — VERIFIED active.** `tektoncd/triggers` pushed
  2026-10-28, not archived. EventListener/TriggerBinding/TriggerTemplate/
  Interceptor architecture unchanged in Round-1's framing.
- **Tekton Hub — MATERIAL CORRECTION.** The public catalog is **gone**:
  - `hub.tekton.dev` **shut down 2026-01-08**;
  - [`tektoncd/hub`](https://github.com/tektoncd/hub) **archived 2026-02-10**
    (README: "This repository is archived and no longer maintained.");
  - maintained fork for self-hosted instances:
    [`openshift-pipelines/hub`](https://github.com/openshift-pipelines/hub).
  Round-1 §5.4's "Marketplace: Tekton Hub (task/cluster-task catalog)" is
  **stale** — as of today there is no public first-party catalog; the unit of
  reuse is still the Custom Task, but discovery now happens via self-hosted
  hub forks or bundles.

### 2.6 Prow (`kubernetes-sigs/prow` @ HEAD `43ed2340…`)

Code-level verification at the cited (still-HEAD) SHA:

- **Agent types — VERIFIED, exactly three.**
  [`pkg/apis/prowjobs/v1/types.go`](https://github.com/kubernetes-sigs/prow/blob/43ed234002b9831fc0b8100c3c467f2146dbc8e3/pkg/apis/prowjobs/v1/types.go)
  defines `TektonAgent = "tekton-pipeline"`; the deck API surface declares
  `type ProwJobAgent = "kubernetes" | "jenkins" | "tekton-pipeline"`.
  Round-1's list (kubernetes / jenkins / tekton-pipeline) is **exact**.
- **In-repo config — VERIFIED, filename confirmed.**
  [`pkg/config/inrepoconfig.go`](https://github.com/kubernetes-sigs/prow/blob/43ed234002b9831fc0b8100c3c467f2146dbc8e3/pkg/config/inrepoconfig.go)
  sets `inRepoConfigFileName = ".prow.yaml"`; docs at
  `site/content/en/docs/inrepoconfig.md` ("a `.prow.yaml` file, akin to a
  `.travis.yaml` file"). Round-1's `.prow.yaml` claim confirmed.
- **Decoration secrets — VERIFIED (sampled).** `GCSCredentialsSecret
  json:"gcs_credentials_secret"` and `OauthTokenSecret json:"oauth_token_secret"`
  confirmed in `pkg/apis/prowjobs/v1/types.go`; Round-1's remaining fields
  (`s3_credentials_secret`, `ssh_key_secrets`, `cookiefile_secret`,
  `github_app_private_key_secret`) not individually re-checked — flagged.
- **Matrix:** no matrix key in job config — Round-1's "no first-class
  matrix" stands (config schema unchanged at this HEAD).
- **"Plugins = Go webhook/comment plugins" framing — VERIFIED conceptually**
  (pkg/plugins package family present in repo; not re-crawled this round).

---

## 3. Material corrections to Round-1

Ranked by impact on the OpenForge pipeline-format decision:

### 3.1 [ERROR] Buildkite `script` step does not exist
Round-1 §3.4 listed a `script` step type ("references an artifact containing
the shell script"). **False.** The `Step` interface in
[`step.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step.go)
allows exactly `CommandStep | WaitStep | InputStep | TriggerStep | GroupStep`,
and `step_script.go` is 404 at HEAD. Remove the bullet; keep the rest of
§3.4 as-is.

### 3.2 [STALE] Tekton Hub is dead
Round-1 presents Tekton Hub as the live task marketplace. The public instance
shut down **2026-01-08** and the repo was archived **2026-02-10** (maintained
fork: `openshift-pipelines/hub`). For OpenForge: "borrow Tekton's Custom Task
idea" is still valid, but "inherit a plugin ecosystem" is **not** — there is
no public first-party catalog to inherit.

### 3.3 [STALE] Woodpecker secret model
Round-1 §1.5 describes Drone-1.x-era secret types (`environment`/`encrypt`/
`file`) and named `kubernetes`/`vault`/`aws-secrets-manager` extensions.
The 3.20 model is: **central store with repo/org/global scopes**,
`from_secret:` references, **pull_request hidden by default**, plugin/image
filters, `$$` escaping, and a **generic signed-HTTP secret extension** whose
official 3rd-party list is **empty**. OIDC is "DIY via your own HTTP
service", not a shipped extension. This changes the "secrets" cell in the
final table (see §5) and weakens Woodpecker's OIDC story relative to
Concourse's IDToken.

### 3.4 [WRONG FRAMING] Drone "2.x frozen, now 3.x"
Timeline (verified): `v3.0.0` … `v3.3.0` tags land **2025** (v3.3.0 commit
2025-08-14, newest tag), while the **2.x line kept shipping**: `v2.28.2`
published **2026-04-20** — the newest GitHub release on `harness/harness`.
The 2.x format is **not frozen**; both lines were maintained in parallel
through at least April 2026. The strategic caveat (stewardship now
commercial, brand is Harness Open Source) still stands — it's just that the
`.drone.yml` line is more alive than Round-1 suggested, which *reduces* the
"vendor froze the format" risk and *adds* the "two divergent lines"
complexity. Also: `drone/drone` is a **transfer**, not an archive
(`archived: false`).

### 3.5 [MINOR] SHA↔version conflation (Concourse, Woodpecker)
- Concourse: `352512db` is main HEAD; the v8.3.2 tag commit is `b188e99f`
  (2026-09-25). Cite as "v8.3.2 (tag `b188e99f`); verified against main HEAD
  `352512db`".
- Woodpecker: `02f61d55` is main HEAD; the v3.20.1 tag commit is `3f1bb0bd`.
- Tekton: pin is exact (tag == HEAD) — no change needed.
- Prow/go-pipeline/agent: pins fine as-is (agent: v4.9.0 tag `735f98f3`,
  HEAD moved on; go-pipeline pin is HEAD).

### 3.6 [MINOR] Under-coverage (no contradictions)
- Woodpecker `when` filters: 11 exist, Round-1 named 5; `status: [failure]`
  run-on-failure steps are a real differentiator it missed.
- Woodpecker `$$` escape (same duality as Buildkite), `variables:` anchors,
  autoscaler, SQLite default, trusted-repo boundaries, org/global secret
  scopes — all new facts for the decision doc.
- Drone: custom scripting-language extensions beyond Starlark/Jsonnet.
- Round-1's "Drone cross-repo = API/plugin (inference)" remains unrefuted but
  unproven — keep the flag.

---

## 4. Gaps Round-1 missed

### 4.1 Omitted engines (gap scan run 2026-11-03)

| Engine | Repo | Status today | Why it matters for OpenForge |
|--------|------|--------------|------------------------------|
| **Jenkins** | `jenkinsci/jenkins` | **Active** (pushed 2026-11-03), MIT, 26,723★ | **The elephant Round-1 skipped.** The de-facto standard self-hosted CI; Groovy/Declarative pipeline model; huge plugin ecosystem; the "legacy incumbent" any self-hosted GitHub competitor's CI must be compared against. Omission is the single biggest scope hole. |
| **Gitea Actions** | runner code formerly `gitea/act_runner` (now **404** at that path — implementation has moved into the `gitea/gitea` monorepo; exact location not re-verified this round, **flagged**) | Active (Gitea ships Actions in 1.22+) | **Most directly relevant to a self-hosted GitHub competitor:** Gitea proves the "forge + GHA-compatible runner" architecture. If OpenForge wants GHA-compat as a migration story, Gitea Actions is the reference design, not any of Round-1's six. |
| **nektos/act** | `nektos/act` | Active (pushed 2026-11-03), MIT, 72,525★ | Not a server; runs GHA workflows in Docker locally. Relevant as a dev/QA tool and as evidence of the GHA-format ecosystem's gravity. |
| **Screwdriver CD** | `screwdriver-cd/screwdriver` | Active (pushed 2026-10-25), license file reports **NOASSERTION** (non-standard — needs review before commercial-use claims), 1,048★ | Red Hat-lineage YAML pipeline CI (`.pipeline/screwdriver.yaml`). A legitimate 7th candidate; license must be checked. |
| **Spinnaker** | `spinnaker/spinnaker` | Active, Apache-2.0, 9,816★ | CD orchestration platform (not step-level CI). Round-1's CI scope can exclude it, but one line of justification should exist. |
| **Argo Workflows** | `argoproj/argo-workflows` | Active (pushed 2026-11-03), Apache-2.0, 17,079★ | K8s-native workflow engine — the same "CRD-native" category as Tekton, arguably a stronger 7th candidate than several others. Excluding it while including Tekton deserves a stated reason. |
| **Flagger** | `fluxcd/flagger` | Active (pushed 2026-09-21), Apache-2.0, 5,428★ | Progressive/canary delivery, **not** a CI engine. Exclusion is correct; note it. |
| **keptn** | `keptn/keptn` | **ARCHIVED** (last push 2023-12-21) | The concrete "dead engine" example in this space (SLO-driven delivery). Not one of the six; cited here because the task asked for maintenance-mode deaths. |
| TeamCity / CircleCI self-hosted / Buddy | closed-source (JetBrains / CircleCI / Buddy Inc.) | Commercial | Not adoptable as an OSS "semantic"; out of scope for Round-1's framing, but a one-line exclusion table belongs in the final doc. |

**"Project Enterrr" (maintenance-mode probe):** no project by this name was
found — GitHub repo search returns only unrelated user repos (`enterrry`,
`wHACKiest2021_enterrr`), and the web-search backend was rate-limited at
verification time. **Treat "Project Enterrr" as unverifiable / likely
nonexistent; do not cite it.** The real adjacent deaths are keptn (archived
2023) and tektoncd/hub (archived 2026-02), both documented above with
evidence.

### 4.2 Feature drift since Round-1
Round-1 was produced **the same day** (2026-11-03); all six pins are still
HEAD, so **zero feature drift** exists. The "new features" bucket therefore
contains only Round-1 *omissions* (listed per engine in §2.3–2.5), notably:
Woodpecker autoscaler + `status: [failure]` + scoped secrets + `$$`;
Drone custom scripting languages; none elsewhere.

### 4.3 Maintenance-mode status of the six
**None of the six is in maintenance mode** (all pushed 2026-11-02/03; all
release lines current within ~5 weeks). Stewardship risks, restated accurately:
- **Drone 2.0 format** → under Harness Open Source (commercial steward;
  parallel 2.x/3.x releases through 2026-04).
- **Buildkite** → SaaS control plane; open agent only (unchanged from
  Round-1; still the architectural odd-one-out).
- **Tekton** → CNCF-graduated ecosystem, but the **Hub** (discovery layer)
  died in 2026-Q1 — an ecosystem-health data point Round-1 lacked.

### 4.4 License compatibility with commercial use (Round-1 missing column)

| Engine | Core license | Commercial-use notes |
|--------|--------------|----------------------|
| Woodpecker | Apache-2.0 (verified via API: `spdx_id=Apache-2.0`) | Permissive; no EE tier in the OSS core. |
| Drone / Harness OSS | Apache-2.0 | Permissive core; **commercial Harness platform is separate** — the OSS line is the free path; no copyleft risk. |
| Buildkite | Agent **MIT**; **server closed-source SaaS** | Using the agent MIT-licensed; but you cannot self-host the control plane — commercial lock-in by architecture, not license. |
| Concourse | Apache-2.0 | Permissive. |
| Tekton | Apache-2.0 | Permissive. |
| Prow | Apache-2.0 | Permissive. |
| (Jenkins, if added) | MIT | Permissive. |
| (Screwdriver, if added) | **NOASSERTION** | **Unverified — must be checked before any commercial-use claim.** |

On **Sysbox**: it does not appear anywhere in Round-1 and is not one of the
six (it's a container *runtime* with a proprietary EE tier). Its EE license
does **not** affect any of the six engines' core codebases. If a runner uses
Sysbox, that's a separate, additive dependency to license-review — flagging
so nobody inherits an unexamined claim. (Sysbox's current license terms not
re-verified this round.)

### 4.5 Migration path from GitHub Actions (Round-1 missing column)

Repo search (2026-11-03) found **no `github-actions-importer`-style tool for
any of the six** (queries: "woodpecker github actions", "drone github
actions", "concourse github actions" — zero importer results; one unrelated
repo). The realistic GHA escape hatches are **outside** the six:
- **Gitea Actions** — GHA-compatible workflow runner; the only true
  "keep your `.github/workflows`" self-hosted path (see §4.1).
- **nektos/act** — run GHA workflows in Docker locally (dev/QA, not a
  hosted service).
- **Jenkins** — plugin ecosystem with GitHub integration (not a converter;
  flagged as not re-verified this round).
- **Woodpecker** — legacy **Drone 1.x** `.drone.yml` compatibility (dropped
  as default in 2.0, per-repo path configurable) — a migration path from
  *Drone 1.x*, not from GHA.

**Decision impact:** if "cheap migration for GHA users" is a decision input,
**none of Round-1's six offers it today** — that is a greenfield opportunity
(and Gitea's existence is the competitive benchmark for it).

### 4.6 Single-node resource requirements (Round-1 missing column)

Only verified-where-cited; the rest are structural facts with confidence
flags (docs sizing pages for Concourse/Drone were 404 on the URLs tried this
round — **not re-verified, flagged**):

| Engine | Single-node footprint | Verified? |
|--------|----------------------|-----------|
| Woodpecker | **server + agent containers, SQLite by default** (no external DB for small installs; Postgres/MariaDB optional) — lightest of the six | ✅ administration/general (3.20) |
| Buildkite | **agent only** (single static binary, runs anywhere); control plane is SaaS — N/A for full self-hosting | structural (agent-only model, §3.1 of Round-1) |
| Drone | server binary + **PostgreSQL + Redis** per install docs | ⚠️ not re-verified this round |
| Concourse | web + ATC + Postgres + garden worker, all on one host (dev-mode documented) | ⚠️ sizing numbers not re-verified this round |
| Tekton | **requires a Kubernetes cluster** (1-node kind/minikube viable for dev) | structural (K8s-native, §5.3 of Round-1) |
| Prow | **heaviest**: full K8s cluster + component suite (deck, hook, plank, …) | structural |
| (Jenkins) | single Java WAR + JDK; famously runs on 2 GB | ⚠️ not re-verified this round |

**Ordering for the decision doc (lightest → heaviest self-hosted):**
Buildkite-agent-only (no server) < Woodpecker ≈ Drone < Jenkins < Concourse
< Tekton ≈ Prow (cluster-bound).

---

## 5. Final cross-engine table (Round-2 update)

Legend (kept from Round-1): **✓** first-class primitive in the definition;
**~** via extension/plugin/resource (not a core keyword); **✗** effectively
absent. New cells: **License (core)**, **GHA migration path**, **Stewardship
risk**. Corrections vs. Round-1 marked with **†**.

| Engine (pin verified 2026-11-03) | YAML path | Executors | Plugin model | Secrets (Round-2) | Matrix | Cache | Artifacts | Trigger | Cross-repo trigger | License (core) | GHA migration | Stewardship risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Woodpecker** v3.20.1 @ `02f61d55` (HEAD) | `.woodpecker.yaml` (repo root; legacy `.drone.yml` path dropped as default in 2.0) | Docker, Kubernetes, Local, Custom (agent-side) + **autoscaler** | ~ image+settings (marketplace) | †~ **central store, repo/org/global scopes; `from_secret`; PR hidden by default; generic signed-HTTP secret extension (no bundled Vault/K8s/AWS; OIDC = DIY)** | ✓ `matrix:` | ~ volume/plugin | ~ plugin | push/PR(+closed/metadata)/tag/release/deployment/cron/manual + 11 `when` filters incl. **`status: [failure]`** | ~ plugin (`plugin-trigger`; not re-verified) | Apache-2.0 | ✗ (Drone-1.x compat only) | Low — community (OpenCollective), actively maintained |
| **Drone 2.0 / Harness OSS** (tags `v3.3.0` 2025-08 / releases `v2.28.2` 2026-04 — parallel lines) | `.drone.yml` (repo root) | Docker, K8s, Exec, SSH, AWS, DO, MacStadium (per-pipeline `type:`) | ~ image+settings (largest marketplace) + Starlark/Jsonnet + custom languages | ✓ client-encrypted `kind: secret` + OIDC (docs) | ✓ `matrix:` | ~ plugin | ~ plugin | push/PR/tag/delete/custom/cron/manual + conditions | ✗ API/plugin (inference, unrefuted) | Apache-2.0 | ✗ | **Medium** — commercial vendor stewardship (Harness); format not frozen (2.28.2, 2026-04) |
| **Buildkite** (agent v4.9.0 `735f98f3`; go-pipeline `f8926e94` == HEAD) | `buildkite.yml` / `.buildkite/pipeline.yml` (uploaded) | Agent runs anywhere (host/Docker/K8s/EC2) — no server self-host | ~ GitHub-repo plugins (marketplace); step types: **command/group/input/block/wait/trigger only** † (no `script`) | ~ env + AWS/GCP/Vault sources; `$`/`$$` duality; uploader rejects leaked secrets | ✓ `matrix:` + adjustments (skip/**soft_fail**) | ✓ `cache:` (name/paths/size; also `false`/list forms) | ✓ `artifacts:` | SaaS server (push/PR/cron/API/webhook) + `if_changed` | ✓ `trigger:` step | MIT (agent) / **closed SaaS server** | ✗ | **High for full self-host** — control plane is the product |
| **Concourse** v8.3.2 (tag `b188e99f`; verified vs HEAD `352512db`) | any `.yml`, pushed via `fly set-pipeline` | Workers (garden; Linux/K8s/Windows) | ~ **resource types** (check/in/out) | ✓ vars + credential managers incl. **IDToken (OIDC)** — code-verified | ✓ `across` (code-verified) | ~ image/version cache (S3 emulate) | ~ `get`/`put` versions + GC | resource check/`trigger`, time, manual, `set_pipeline` | ✓ `set_pipeline` (code-verified) | Apache-2.0 | ✗ | Low — vendor-backed (Pivotal/VM lineage), active |
| **Tekton** v1.18.0 `d55f53a6` (tag == HEAD) | none (K8s CRDs; PAC for repo) | Kubernetes (Pod) only | ~ **Custom Tasks**; **Hub dead** (hub.tekton.dev shut 2026-01-08; repo archived 2026-02-10; fork `openshift-pipelines/hub`) † | ~ K8s Secrets/SA; OIDC via identity | ✓ `matrix:` (v1 `matrix_types.go`) | ~ workspaces (PVC/remote) | ✓ **`Artifact` (v1)** + Results API | Tekton Triggers (active) / PAC / `tkn` | ✗ (K8s-scoped) | Apache-2.0 | ✗ | Low-medium — CNCF-graduated, but discovery layer (Hub) died 2026-Q1 |
| **Prow** @ HEAD `43ed2340…` (no releases) | none (central cfg; in-repo `.prow.yaml` code-verified) | Pod (k8s), Jenkins, Tekton — exactly 3 agents (code-verified) | ✗ Go **event** plugins (not steps) | ~ K8s Secrets + GitHub App; censor | ✗ (multi-job / `extra_refs`) | ~ GCS/S3 caches | ✓ GCS/S3 + lifecycle TTL | presubmit/postsubmit/periodic + comments | ✗ (repo-scoped) | Apache-2.0 | ✗ | Low — k8s-sigs, runs all of k8s CI |
| **(gap) Jenkins** (pushed 2026-11-03) | `Jenkinsfile` (repo) or shared libs | master/agent JVM; any OS | ✓ plugins (largest ecosystem in the space) | ~ credentials plugin + vault plugins | ~ (declarative `matrix`-like patterns / plugins) | ✓ (plugins; built-in in some setups) | ✓ (plugins + built-in) | push/PR/tag/cron/manual + SCM poll | ~ (multibranch / plugins) | MIT | ~ (integration plugins, not a converter) | Low — Code for SF / community, 26.7k★ |

**Unchanged Round-1 conclusions that survive verification:**
1. Only **Woodpecker** and **Drone** are true "drop-a-file-in-repo"
   self-hosted semantics.
2. **Buildkite's step vocabulary** remains the most complete step-level
   feature set to borrow — *minus* the phantom `script` step.
3. **Concourse** (`across`, IDToken, `set_pipeline`) and **Tekton**
   (`finally`, typed params, workspaces, `Artifact`) ideas remain the
   strongest borrowable primitives.
4. For a fully self-hosted, no-SaaS control plane: **Woodpecker** is the
   safest; **Drone** is the richest but under commercial stewardship;
   **Tekton** only if K8s-manifest-native.
5. **New for the decision:** GHA-migration story exists for **none** of the
   six (§4.5) — Gitea Actions is the benchmark; and **Jenkins** must enter
   Round-3 as the incumbent baseline (§4.1).

---

## 6. Open questions for Round-3

Only substantive items (no blocking contradictions were found — §3's errors
are local to their bullets, not structural):

1. **Gitea Actions as 7th baseline.** OpenForge is a self-hosted GitHub
   competitor; Gitea's "forge + GHA-compatible runner" architecture is the
   most direct prior art in the space and was absent from Round-1. Should
   Round-3 verify where the runner code now lives (the `gitea/act_runner`
   repo 404s today) and compare its workflow-compat surface as a formal
   candidate?
2. **Woodpecker secret-extensions ecosystem.** The official 3rd-party list is
   empty. Is there an accepted community Vault/K8s/OIDC secret-extension
   implementation (or should OpenForge treat "external secrets" as an
   OpenForge-first feature, since none of the six ships it first-class)?
3. **Buildkite "private mode".** Round-1 (and this report) treat the
   control plane as SaaS-only. If Buildkite has since offered a
   self-hostable control plane, the "SaaS lock-in" row changes materially.
   Needs a docs re-check (docs site is JS-gated; use changelog/releases).
4. **Jenkins baseline doc.** Round-3 should produce a 10-subsection Jenkins
   entry (Declarative/Pipeline syntax, credential store, matrix via
   `matrix`/`axes`, artifact manager, branch sources) so the final table has
   a real incumbent row instead of a flagged placeholder.
5. **Screwdriver license.** `NOASSERTION` from the API — pull the LICENSE
   file and state the actual terms before it appears in any table.
6. **Resource-requirement numbers.** Concourse/Drone/Jenkins sizing pages
   were 404 on the URLs tried (docs moved); get the canonical current URLs
   for the single-node minimums so §4.6's ⚠️ cells become cited numbers.
7. **Drone two-line divergence.** Are the 2.x (`.drone.yml`) and 3.x
   (Harness platform) lines converging or diverging? If diverging, the
   "adopt `.drone.yml`" option carries format-fragmentation risk that
   Round-1's single-line framing missed.

---

## Appendix A — Evidence log (commands/URLs used, 2026-11-03)

- `gh api repos/<r>` (metadata/pushed_at/stars/license/archived) for:
  woodpecker-ci/woodpecker, buildkite/agent, buildkite/go-pipeline,
  concourse/concourse, tektoncd/pipeline, kubernetes-sigs/prow,
  harness/harness, drone/drone, jenkinsci/jenkins, nektos/act,
  screwdriver-cd/screwdriver, spinnaker/spinnaker,
  argoproj/argo-workflows, fluxcd/flagger, keptn/keptn,
  tektoncd/triggers, tektoncd/hub.
- `gh api repos/<r>/commits/HEAD`, `.../commits/<tag>`,
  `.../git/refs/tags/<tag>`, `.../releases/latest` for the seven pinned
  repos (Prow releases → 404, as expected).
- Raw file fetches (cited SHA vs HEAD, byte-identical):
  `buildkite/go-pipeline` `pipeline.go`, `step_command.go`,
  `step_command_matrix.go`, `step_command_cache.go`, `step_trigger.go`,
  `step_input.go`, `step.go`, `plugin.go`; `step_script.go` → **404**.
- `gh api repos/tektoncd/pipeline/contents/pkg/apis/pipeline/v1?ref=d55f53a6…`
  (file listing proving `artifact_types.go`, `matrix_types.go`, etc.).
- `gh search code` (at cited/HEAD): concourse `idtoken` / `set_pipeline` /
  `across`; prow `tekton-pipeline` / `inrepoconfig` / `.prow.yaml` /
  `gcs_credentials_secret` / `oauth_token_secret`; woodpecker `type Workflow
  struct` / `oidc` / `.drone.yml`; go-pipeline `deprecat`;
  `gh search repos` (gap scan + migration-tool scan + "enterrr").
- Docs fetched (versioned where possible): woodpecker-ci.org 3.20.x
  (`/docs/usage/workflow-syntax`, `/docs/usage/secrets`,
  `/docs/usage/extensions/secret-extension`,
  `/docs/administration/general`); docs.drone.io
  (`/pipeline/configuration/`); tektoncd/hub README (archived notice).
- Web search ("Project Enterrr"): **rate-limited at verification time**;
  GitHub repo search performed instead (no match).

### Confidence key used in this report
- **✅ / verified** — checked against live API or source/docs today.
- **†** — correction to a Round-1 claim.
- **⚠️ / not re-verified** — carried from Round-1; URL or crawl failed this
  round; must be closed before the final decision doc ships.

*End of Round-2 verification report.*
