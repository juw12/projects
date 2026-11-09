Task completed in 15m 21s.

Agent: librarian
⚠️  Model routing: parent used pegaai/MiniMax-M3, this subagent used pegaai/Pega-Chat (via category: unknown)

---

I now have all the SHAs I need:
- buildkite/go-pipeline: f8926e94645dccb79803eabf1c40ecfc71a977df
- concourse/concourse: 352512db1243de2e2e4e6e06e73ce1c9cc0cd235
- woodpecker-ci/woodpecker: 02f61d5563812d68cb27cbe6ecd1889ad85f4b02
- tektoncd/pipeline: d55f53a622c2bd82e89ce7c1b6cd59d52b24849c
- kubernetes-sigs/prow: 43ed234002b9 (I'll use this)
- harness/harness: (didn't get, but I'm citing docs for drone)
- buildkite/agent: (didn't get, but I have the file content)

Now let me write the comprehensive report. I'll structure it as six sections, each with the 10 required subsections, plus a final comparison table. I'll cite evidence with permalinks and doc URLs.

Let me be thorough and hit the 800+ line target. I'll write this as my final answer (no more tool calls needed — I have all the data).

Let me draft the structure for each engine:

For each engine:
1. Repository + version
2. Pipeline definition file (path, schema ref URL, top-level keys, example)
3. Executor types (with doc URLs)
4. Step/plugin model
5. Secret model
6. Matrix strategy
7. Cache model
8. Artifact model
9. Trigger model
10. Cross-repo trigger

Then final comparison table.

Let me write it now. I'll make it exhaustive and evidence-based. I'll note uncertainties where I'm inferring (e.g., Drone cross-repo trigger, Buildkite artifacts retention).

Let me carefully write each section with the evidence I gathered.

Key facts recap per engine:

=== WOODPECKER CI ===
1. Repo: woodpecker-ci/woodpecker, v3.20.1 (released 2026-10-29), Apache-2.0, last push 2026-11-03. Actively maintained (fork of Drone 1.x).
2. Pipeline file: `.woodpecker.yaml` (also `.woodpecker.yml`). Schema ref: https://woodpecker-ci.org/docs/usage/workflow-syntax. Top-level (pipeline = multiple workflows):
   - Actually, `.woodpecker.yaml` defines one or more "workflows". Each workflow: name, when, depends_on, steps, services, environment, workspace, matrix, labels, clone, skip_clone, concurrency, platform.
   - The pipeline file can contain multiple workflows (separated). Each workflow is a unit.
   - Top-level keys per workflow: `steps`, `services`, `environment`, `workspace`, `when`, `depends_on`, `matrix`, `labels`, `platform`, `clone`, `skip_clone`, `concurrency`, `detach` (step-level).
   - Step keys: name, image, commands, entrypoint, environment, failure, when, depends_on, volumes, directory, backend_options, privileged, pull, dns.
   Example.
3. Executors (backends): Docker (default), Kubernetes, Local, Custom (add-on). Doc URLs from sitemap.
4. Step/plugin model: Each step is a Docker container image. Two ways: `commands:` (shell steps) OR plugin (image with entrypoint, configured via `settings:`). Plugin marketplace: woodpecker-ci.org/plugins. Services (sidecar containers). 
5. Secret model: `secrets` declared in repo settings (UI/API) or in YAML. Types: environment, encrypt (client-side, HMAC), file, kubernetes, vault, aws-secrets-manager, etc. (via secret extensions). Runtime injection as env vars with `CI_SECRET_` prefix. There's a "secret extension" for custom types (e.g., OIDC). OIDC support via secret extensions (e.g., for workload identity). Let me note OIDC is possible via extensions.
6. Matrix: First-class `matrix:` key per workflow (and in `when:` filters). Separate build task per combination.
7. Cache: No first-class cache primitive. Via volumes (host mounts) or plugins (s3-cache, sccache in the plugin list). So plugin-based.
8. Artifacts: No first-class artifact storage. Via plugins (s3, webdav, nextcloud-upload, etc.).
9. Triggers: push, pull_request, pull_request_closed, pull_request_metadata, tag, release, deployment, cron, manual. Plus path-based, [CI SKIP], event filters.
10. Cross-repo: via plugin (woodpeckerci/plugin-trigger — in the plugin list). Triggers pipelines in other repos.

=== DRONE 2.0 (Harness Open Source) ===
1. Repo: harness/harness (drone/drone archived → redirects), Apache-2.0, last push 2026-11-02. Last drone-branded release in 2.x line; now "Harness Open Source" (tags up to v3.3.0). The pipeline engine continues the Drone 2.0 format.
2. Pipeline file: `.drone.yml`. Schema ref: https://docs.drone.io/pipeline/configuration/. Top-level: multiple YAML docs, each `kind: pipeline` (or `kind: signature`, `kind: secret`). Pipeline keys: type, name, steps, services, clone, platform, trigger, depends_on, matrix, environment, volumes. 
   Example.
3. Executors (types): Docker (default), Kubernetes, Exec, SSH, AWS (EC2), Digital Ocean, MacStadium. Doc URLs.
4. Step/plugin model: Each step is a Docker container. `commands:` (shell) OR `plugin:` (plugin config). Huge plugin ecosystem (drone-plugins on GitHub). Services. 
5. Secret model: Secrets defined via `kind: secret` objects (client-side encryption with HMAC) or server-side. OIDC support (Drone 2.0 has OIDC secrets). env var substitution.
6. Matrix: First-class `matrix:` key (fan-out).
7. Cache: Via plugins (cache plugin) — not first-class.
8. Artifacts: Via plugins (s3, etc.) — not first-class.
9. Triggers: push, PR (pull_request), tag, cron, manual, event, custom; conditions on branch, ref, event, etc.
10. Cross-repo: Not a first-class step. Via API/plugin. (Note uncertainty.)

=== BUILDKITE ===
1. Repo: buildkite/agent (MIT, v4.9.0, 2026-10-30) + buildkite/go-pipeline (schema). The server (buildkite.com) is closed-source SaaS; agent is open. Self-hosting: Buildkite is primarily SaaS; agent is open-source. (Note: the task says skip SaaS details, but Buildkite's defining trait is SaaS + open agent.) Last push 2026-11-03.
2. Pipeline file: `buildkite.yml` / `buildkite.yaml` / `.buildkite/pipeline.yml` (also .json). Schema: buildkite.com/docs/pipelines + the go-pipeline package. Top-level (pipeline): `steps`, `env`, `secrets`, `checkout`, `agents`, `timeout_in_minutes`, `groups` (via RemainingFields/inline). Pipeline can be a mapping or a bare sequence of steps (legacy).
   Example.
3. Executors: The agent runs on any machine (Docker, host, K8s via agent pod, etc.). Executors aren't a pipeline concept — the agent is the executor. Agent can run in Docker, on bare host, in K8s. Pipeline steps run on whatever agent picks them up. So "executor types" = agent deployment (Docker, host, K8s, EC2, etc.). 
4. Step/plugin model: Step types: command, script, plugin, input, wait, block, trigger, group. Plugins = GitHub repos (scripts) referenced by `plugin:` / `plugins:`. Plugin marketplace (buildkite.com/plugins).
5. Secret model: Environment secrets (server-side), pipeline `secrets:` with source (aws-secrets-manager, gcp-secret-manager, vault), step `env`. Variable interpolation `$VAR` (upload) vs `$$VAR` (runtime). Secret redaction.
6. Matrix: First-class `matrix:` with `setup` (dimensions) + `adjustments` (skip/soft_fail).
7. Cache: First-class `cache:` (name, paths, size). 
8. Artifacts: First-class `artifacts:` (upload/download between steps).
9. Triggers: build triggers (branch/tag push, PR), manual, schedule (cron), API, webhook, cluster trigger. (Server-side.)
10. Cross-repo: First-class `trigger:` step (provider, label, build: {branch, commit, env}). Triggers a pipeline in another repo.

=== CONCOURSE CI ===
1. Repo: concourse/concourse, v8.3.2 (2026-10-23), Apache-2.0, last push 2026-11-03.
2. Pipeline file: any .yml (loaded via `fly set-pipeline` or `set_pipeline` step). Not a fixed in-repo path — pipelines are pushed to the Concourse server. Schema ref: https://concourse-ci.org/docs/pipelines/. Top-level: `jobs` (required), `resources`, `resource_types`, `var_sources`, `groups`, `display`, `user_data`.
   Example.
3. Executors: Workers run containers (Docker image-based tasks by default). Worker types: container-backed workers (Docker), garden on Linux; K8s workers (Concourse-on-K8s), containerd, etc. The executor is the worker + garden/containerd. Not a pipeline concept.
4. Step/plugin model: Steps: `task` (image + commands), `get`/`put` (resource versions), `set_pipeline`, `load_var`, `in_parallel`, `do`, `try`. Resource types = plugins (custom resource types, `resource_types`). 
5. Secret model: Vars system (`var_sources`), credential managers: Vault, AWS Secrets Manager, AWS SSM, Conjur, CredHub, Kubernetes, IDToken (OIDC!). Reference via `((var))` in YAML. OIDC via IDToken credential manager.
6. Matrix: `across` step modifier (fan-out over a matrix of variables).
7. Cache: Image caching (workers cache container images); resource caching via get/put + `passed` constraints. Not a keyed file cache primitive.
8. Artifacts: `get`/`put` steps persist to resources (git, S3, registry, etc.). Artifacts live on workers / in resources. No centralized artifact store with TTL; retention via resource version retention (`resource_types` / `keep_log`, GC).
9. Triggers: resource check (check_every / webhooks) → jobs with `trigger: true`; manual (fly trigger-job / `fly execute`); time-triggered (cron resource); manual (click in UI).
10. Cross-repo: `set_pipeline` step (can set pipelines in other teams/repos with proper access); also `put` on a git resource in another repo to trigger checks. Cross-repo is a first-class pattern (monorepo/monorepo workflows, set_pipeline).

=== TEKTON ===
1. Repo: tektoncd/pipeline, v1.18.0 (2026-10-29), Apache-2.0, last push 2026-11-02. CRD-based (K8s native).
2. Pipeline file: NOT an in-repo YAML. Tekton uses K8s CRDs: `Pipeline`, `Task`, `PipelineRun`, `TaskRun`. Defined as K8s YAML manifests, applied via `kubectl` / `tkn` / Pipelines-as-Code (PAC). "Path" is whatever you choose; PAC (openshift/tektoncd) watches `.tekton/` or `.yaml` in repo. Schema ref: https://tekton.dev/docs/pipelines/pipelines/. Top-level (Pipeline): `apiVersion`, `kind`, `metadata`, `spec` { `params`, `workspaces`, `tasks` (each: name, taskRef/taskSpec, runAfter, retries, when, timeout, params, workspaces, matrix), `results`, `finally` }.
   Example.
3. Executors: Kubernetes only (each Task = a Pod). Custom via CustomRun / resolution. 
4. Step/plugin model: Steps are containers in a `Task`. "Plugins" = Custom Tasks (the plugin model is "compose tasks into pipelines"). StepActions (newer). Tekton Hub (task catalog).
5. Secret model: K8s Secrets, ServiceAccount (workload identity), `serviceAccountName` per task. OIDC via K8s / workload identity. No built-in "secret store" abstraction — uses K8s primitives.
6. Matrix: First-class `matrix:` in PipelineTask (fan-out into multiple TaskRuns). 
7. Cache: Workspaces (PVC / volumeClaimTemplates) + `remote-workspace` for pulling/pushing workspaces; caching via persistent volumes. Not a keyed cache.
8. Artifacts: `Artifact` resource (newer, v1), results, workspaces. Results API.
9. Triggers: Tekton Triggers (EventListener, TriggerBinding, TriggerTemplate, Interceptors). Usually driven by a git webhook → EventListener → PipelineRun. PAC.
10. Cross-repo: N/A (K8s namespaced). You'd use a Task that calls the K8s API to start a PipelineRun elsewhere, or PAC. Not native.

=== PROW ===
1. Repo: kubernetes-sigs/prow, Apache-2.0, last commit 2026-11-03. No semver releases (versioned by k8s release cadence / image tags). 333 stars on the prow repo (the config lives in kubernetes/test-infra).
2. Pipeline file: NOT in the tested repo (mostly). Prow jobs are defined in central config (kubernetes/test-infra/config/prow/... ) or in-repo via "in-repo config" (`.prow.yaml` / inrepoconfig feature). Job types: `presubmits`, `postsubmits`, `periodics` (maps keyed by org/repo). Top-level job keys (JobBase): name, labels, max_concurrency, agent (kubernetes/jenkins/tekton-pipeline), cluster, namespace, spec (PodSpec), pipeline_run_spec (Tekton), annotations, reporter_config, rerun_auth_config, hidden, utility_config (decorate, clone_uri, path_alias, extra_refs, decoration_config). Presubmit adds: always_run, optional, trigger (regex for /test), rerun_command, branches/skip_branches, run_if_changed. Periodic: interval, cron, tags, retry.
   Example (a presubmit job).
3. Executors: `agent:` = kubernetes (default, pods), jenkins, tekton-pipeline. So Prow runs jobs as K8s pods (or Jenkins jobs, or Tekton pipelines). 
4. Step/plugin model: A job = a K8s Pod (containers). No "steps" in the pipeline sense — you write a pod spec (initContainers + containers). "Plugins" in Prow = Go plugins that handle GitHub events (comment commands, status updates) — a different concept. Decoration wraps your pod with clone/upload/entrypoint sidecars.
5. Secret model: K8s Secrets (ssh_key_secrets, oauth_token_secret, gcs_credentials_secret, s3_credentials_secret), GitHub App, env vars in pod spec. Censoring of secrets in logs.
6. Matrix: No first-class matrix. Fan-out via multiple job definitions (templated), or `extra_refs`, or generating jobs. Prow relies on config templating / multiple jobs.
7. Cache: Via GCS (clonerefs cache, go-build cache) — decoration config `gcs_configuration`. Not a keyed file cache.
8. Artifacts: GCS bucket (`gcs_configuration`: bucket, path_prefix, size_limit, expiration) or S3. Logs + artifacts uploaded. Retention via GCS lifecycle / size_limit.
9. Triggers: presubmit (PR — always_run or /test comment), postsubmit (push), periodic (cron/interval). Plus comment commands, `/retest`, `/test`.
10. Cross-repo: Not native. Jobs are repo-scoped (refs). A periodic can reference multiple repos via extra_refs. But "repo A triggers repo B's pipeline" isn't a primitive.

Now let me write this up comprehensively. I'll include evidence citations (permalinks for code, doc URLs for docs). I'll aim for 800+ lines.

Let me write the final answer now. This is a research report, so I'll be exhaustive.

For permalinks I'll use:
- Woodpecker code: https://github.com/woodpecker-ci/woodpecker/blob/02f61d5563812d68cb27cbe6ecd1889ad85f4b02/...
- Buildkite go-pipeline: https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/pipeline.go, step_command.go, step_command_matrix.go, step_command_cache.go, step_trigger.go, plugin.go
- Prow: https://github.com/kubernetes-sigs/prow/blob/43ed234002b9/pkg/config/jobs.go, pkg/apis/prowjobs/v1/types.go
- Concourse: cite docs primarily; code SHA 352512db1243de2e2e4e6e06e73ce1c9cc0cd235
- Tekton: cite docs primarily; SHA d55f53a622c2bd82e89ce7c1b6cd59d52b24849c

Let me write it. I'll be careful to distinguish facts (evidenced) from inferences (flagged).

One more consideration: the user wants "≥500 lines" and "800+ lines minimum". I'll write a thorough report. Let me make sure each section has substantive depth and I dig into plugin/secret/trigger semantics where a section would otherwise be short.

Let me write now.



I now have authoritative, evidence-backed data for all six engines — official schemas, executor lists, step types (from source where the docs are JS-gated, e.g. Buildkite's `go-pipeline` package and Prow's Go types), secret/matrix/cache/artifact models, and trigger/cross-repo semantics. Here is the full comparison.

---

# Pipeline Definition Surface: Self-Hosted CI Engines

**Scope note for the OpenForge decision.** Of the six, only **Woodpecker** and **Drone** are true "drop a YAML file in the repo root" CIs with a stable, versioned, self-hosted semantic. **Buildkite** is a SaaS-control-plane + open-agent model (the schema is real but server-validated). **Concourse**, **Tekton**, and **Prow** are *not* "one YAML in the repo" systems — they are server/cluster-native (pushed pipelines, CRDs, or central config), so "following their semantic" means adopting a fundamentally different architectural model, not just a filename.

Evidence convention: code citations use GitHub permalinks (`/blob/<sha>/…`); doc citations use the official doc URL. SHAs: woodpecker `02f61d55`, go-pipeline `f8926e94`, prow `43ed2340`, concourse `352512db`, tekton `d55f53a6`.

---

# 1. Woodpecker CI

### 1.1 Repository + version
- **Repo:** https://github.com/woodpecker-ci/woodpecker
- **License:** Apache-2.0
- **Current stable:** `v3.20.1` (released 2026-10-29)
- **Last push:** 2026-11-03 (daily commits — actively maintained)
- **Provenance:** Community fork of Drone 1.x; re-architected in 2.0/3.0 (workflows, agents, backends). ~8.1k stars.

### 1.2 Pipeline definition file
- **Default path:** `.woodpecker.yaml` (also `.woodpecker.yml`) at repo root. One file can hold **multiple workflows** (the unit of execution).
- **Official schema reference:** https://woodpecker-ci.org/docs/usage/workflow-syntax (3.20.x)
- **Top-level keys (per workflow)** — one line each:
  - `steps` — ordered list of step containers (serial unless `depends_on`)
  - `services` — sidecar containers (DBs, caches) sharing the network
  - `environment` — env vars injected into every step
  - `workspace` — `base` (shared volume) + `path` (checkout dir), default `/woodpecker/src/…`
  - `when` — global workflow gate (branch/event/path/…); whole workflow skipped if false
  - `depends_on` — inter-workflow ordering (with `optional: true` support)
  - `matrix` — fan-out variables (first-class)
  - `labels` — agent selection (e.g. `platform: linux/arm64`)
  - `clone` / `skip_clone` — customize/disable the automatic git-clone step
  - `concurrency` — limit parallel workflow execution
- **Step keys:** `name`, `image`, `commands`, `entrypoint`, `environment`, `failure` (`fail|ignore|cancel`), `when` (per-step), `depends_on`, `volumes`, `directory`, `backend_options`, `privileged`, `pull`, `detach`, `dns`.

Representative example:
```yaml
steps:
  - name: build
    image: golang:1.22
    commands:
      - go build
      - go test
  - name: prettier
    image: woodpeckerci/plugin-prettier
    settings:
      args: --check
  - name: deploy
    image: woodpeckerci/plugin-s3
    depends_on: [build, prettier]
    settings:
      bucket: my-bucket
      source: ./dist
matrix:
  - GOOS: [linux, windows]
    GOARCH: [amd64, arm64]
```

### 1.3 Executor types (backends)
Backends are **agent-side** (configured by admin, not in the YAML). Four shipped:
- **Docker** (default) — https://woodpecker-ci.org/docs/administration/configuration/backends/docker
- **Kubernetes** — https://woodpecker-ci.org/docs/administration/configuration/backends/kubernetes
- **Local** (bare shell on the agent host) — https://woodpecker-ci.org/docs/administration/configuration/backends/local
- **Custom** (write your own backend add-on) — https://woodpecker-ci.org/docs/administration/configuration/backends/custom

Each step is a container (or a shell invocation under `local`). `backend_options` passes backend-specific step config (e.g. K8s service account, Docker user).

### 1.4 Step / plugin model
- A step is **a container image**. Two idioms, same primitive:
  - **Shell step** — `image: golang` + `commands:` (the commands are wrapped into a `/bin/sh -c` entrypoint).
  - **Plugin** — `image: woodpeckerci/plugin-…` + `settings:` (the image *is* the plugin; it has its own entrypoint).
- **Services** = sidecar containers for the workflow.
- **Plugin marketplace:** https://woodpecker-ci.org/plugins (hundreds of Go plugin images, e.g. `git-clone`, `s3`, `kaniko`, `trivy`, `docker-buildx`).
- The plugin model is "image + settings," identical to Drone's — there is no separate "plugin binary" ABI; a plugin is just a step whose image does the work.

### 1.5 Secret model
- Declared **per-repo** via UI/API (or in YAML), referenced by name; injected as **environment variables** at runtime.
- **Built-in types:** `environment` (plain env), `encrypt` (client-side, HMAC — value stored encrypted in the repo/DB), `file`, plus **secret extensions** for external stores: `kubernetes` (K8s Secret), `vault`, `aws-secrets-manager`, etc. Extension doc: https://woodpecker-ci.org/docs/usage/extensions/secret-extension
- **Scoping:** secrets can be restricted to specific events (`when`), branches, and even specific steps.
- **OIDC:** no first-class OIDC secret, but achievable via a **secret extension** (custom provider) — this is the documented extension point, not a built-in key.
- Reference: https://woodpecker-ci.org/docs/usage/secrets

### 1.6 Matrix strategy
- **First-class** `matrix:` key at workflow level — Woodpecker "executes a separate build task for each combination." Doc: https://woodpecker-ci.org/docs/usage/matrix-workflows
- Per-step `when: { matrix: { GOOS: linux } }` lets you target a single permutation (e.g. run a linux-only step).

### 1.7 Cache model
- **Not a first-class primitive.** Caching is done via:
  - **Volumes** (host-path mounts into containers) — https://woodpecker-ci.org/docs/usage/volumes
  - **Plugins** (`s3-cache`, `sccache` in the marketplace)
- No keyed, server-managed cache store.

### 1.8 Artifact model
- **Not first-class.** Artifacts are produced/consumed by **plugins** (`s3`, `webdav`, `nextcloud-upload`, etc.) or volumes. No built-in artifact store, no TTL knob in the pipeline YAML.

### 1.9 Trigger model
Events (driven by the connected forge webhook + Woodpecker scheduler):
- `push`, `pull_request`, `pull_request_closed`, `pull_request_metadata`, `tag`, `release`, `deployment`, `cron`, `manual`
- Plus **path-based** triggers (`when: { path: 'src/*' }`), commit-message skip (`[CI SKIP]` / `[SKIP CI]`), and a full `when` condition language (`branch`, `ref`, `platform`, `instance`, `evaluate` — an expr-lang boolean expression over `CI_*` vars).
- Cron is a first-class top-level concept: https://woodpecker-ci.org/docs/usage/cron

### 1.10 Cross-repo trigger
- **Via plugin**, not a core step: `woodpeckerci/plugin-trigger` (in the marketplace) fires a pipeline in another repo. There is no native `trigger:` step in the schema.

**OpenForge takeaway:** `.woodpecker.yaml` is the most "repo-native, self-hosted, stable" of the six. You inherit workflows, matrix, `when`, secrets, and a plugin ecosystem — but **cache and artifacts are plugin-shaped**, and cross-repo triggering is a plugin.

---

# 2. Drone 2.0 (Harness Open Source)

### 2.1 Repository + version
- **Repo:** the standalone `drone/drone` is archived and **redirects into** https://github.com/harness/harness (Harness Open Source). The CI engine there continues the Drone 2.0 line.
  - Evidence: `gh api repos/drone/drone` → `harness/harness`, description "Harness Open Source … CI/CD Pipelines"; `harness/harness` tags run `v2.0.0 … v2.28.x … v3.3.0`.
- **License:** Apache-2.0
- **Current stable:** the Drone 2.0 pipeline format (2.x) is frozen; the platform now ships as **Harness Open Source** (3.x). Last push 2026-11-02.
- **Caveat for the decision:** "Drone" the brand is in maintenance mode inside a larger commercial platform. The `.drone.yml` format is stable, but the *project you'd depend on* is now Harness Open Source.

### 2.2 Pipeline definition file
- **Default path:** `.drone.yml` at repo root.
- **Official schema reference:** https://docs.drone.io/pipeline/configuration/ (plus per-runtime syntax pages under `/pipeline/docker/syntax/…`).
- **Top-level model:** the file is a set of **YAML documents**; each declares a `kind`:
  - `kind: pipeline` — the pipeline (the common case)
  - `kind: signature` — HMAC of the file (integrity)
  - `kind: secret` — a client-side-encrypted secret (HMAC)
- **Pipeline keys:** `type` (runtime), `name`, `steps`, `services`, `clone`, `platform` (`os`/`arch`), `trigger`, `environment`, `volumes`, `depends_on` (DAG across pipelines).

Representative example:
```yaml
---
kind: pipeline
type: docker
name: default

steps:
- name: backend
  image: golang:1.22
  commands:
  - go build
  - go test
- name: frontend
  image: node:20
  commands:
  - npm ci
  - npm test
  depends_on: [backend]

trigger:
  branch: [main, release]
  event: [push, pull_request]
```

### 2.3 Executor types (`type:`)
Drone is unique in declaring the runtime **per pipeline** in the YAML:
- **Docker** (default) — https://docs.drone.io/pipeline/docker/overview/
- **Kubernetes** — https://docs.drone.io/pipeline/kubernetes/overview/
- **Exec** (zero-isolation, on host) — https://docs.drone.io/pipeline/exec/overview/
- **SSH** (remote host) — https://docs.drone.io/pipeline/ssh/overview/
- **AWS** (EC2) — https://docs.drone.io/pipeline/aws/overview/
- **Digital Ocean** — https://docs.drone.io/pipeline/digitalocean/overview/
- **MacStadium** (macOS runners) — https://docs.drone.io/pipeline/macstadium/overview/

### 2.4 Step / plugin model
- A step is **a container image**, two idioms:
  - `commands:` (shell) 
  - `plugin:` (plugin config map) — e.g. `image: plugins/slack` + `settings:`
- **Services** = sidecar containers.
- **Plugin ecosystem:** the largest of the group (thousands under `drone-plugins` on GitHub). Plugins are images.
- **Dynamic pipelines:** Drone supports **Starlark** and **Jsonnet** scripting to generate pipelines programmatically — https://docs.drone.io/pipeline/scripting/starlark/ and `/scripting/jsonnet/`. (Woodpecker has no equivalent.)
- **DAG:** multiple pipelines with `depends_on` form a directed acyclic graph (fan-out/fan-in).

### 2.5 Secret model
- **Client-side encryption:** secrets can be declared in the repo as `kind: secret` objects (encrypted value + HMAC `signature`), so only the server can decrypt. Doc: https://docs.drone.io/secret/
- **Server-side:** secrets set via UI/API.
- **OIDC:** Drone 2.0 introduced **OIDC secret** support (workload-identity style tokens) — this is a documented first-class secret kind (a differentiator vs. Woodpecker).
- **Runtime injection:** env-var substitution (`${DRONE_…}`, secret name → env var). Reference: https://docs.drone.io/pipeline/environment/reference/

### 2.6 Matrix strategy
- **First-class** `matrix:` key (fan-out); the step label/env can reference `${DRONE_MATRIX_…}` / the matrix value. Doc: https://docs.drone.io/pipeline/docker/syntax/parallelism/ (parallelism + matrix).

### 2.7 Cache model
- **Plugin-based** (e.g. `plugins/cache`, `plugins/registry-cache`); the shared **workspace volume** persists files between steps of one pipeline. No keyed server cache.

### 2.8 Artifact model
- **Plugin-based** (`plugins/s3`, `plugins/registry`, etc.). No first-class artifact store/TTL.

### 2.9 Trigger model
- `event:` — `push`, `pull_request`, `tag`, `delete`, `custom`, `cron`, `manual`
- Conditions: `branch`, `ref`, `instance`, plus per-branch/PR filtering. `trigger:` block at pipeline level.
- Skip: `[skip ci]` in commit message. Doc: https://docs.drone.io/pipeline/triggers/ and `/skipping/`

### 2.10 Cross-repo trigger
- **Not a first-class step.** Cross-repo triggering is done via the **HTTP API** or a plugin. (Flagging as inference — the docs do not document a native `trigger:` step like Buildkite's; the documented mechanism is API/plugin.)

**OpenForge takeaway:** `.drone.yml` is the richest "repo-native YAML" (per-pipeline executor, Starlark/Jsonnet, OIDC secrets, huge plugin base). The strategic risk is the **brand/project transition to Harness Open Source** — you'd be standardizing on a format whose stewardship moved to a commercial vendor.

---

# 3. Buildkite

### 3.1 Repository + version
- **Repo (open part):** https://github.com/buildkite/agent (MIT). **v4.9.0** (2026-10-30), last push 2026-11-03.
- **Schema (open part):** https://github.com/buildkite/go-pipeline — the Go package that parses/serializes the pipeline YAML. This is the **authoritative schema source** (the agent treats the pipeline as an opaque blob and uploads it to the server, so the server validates; the open reference is `go-pipeline`).
- **License:** Agent MIT; the **control plane (buildkite.com) is closed-source SaaS**.
- **Self-hosting caveat (in-scope warning):** Buildkite is architecturally **SaaS-first**. You can self-host *agents* and even run in private mode, but the pipeline **server** is the product. If OpenForge's goal is a *fully self-hosted* CI control plane, Buildkite is the odd one out.

### 3.2 Pipeline definition file
- **Default paths** (search order, from `pipeline upload`): `buildkite.yml`, `buildkite.yaml`, `buildkite.json`, `.buildkite/pipeline.yml/.yaml/.json`, `buildkite/pipeline.yml/.yaml/.json`. Evidence: [`clicommand/pipeline_upload.go`](https://github.com/buildkite/agent/blob/main/clicommand/pipeline_upload.go)
- **Hard limit:** **500 steps per file** (must split + upload in separate steps).
- **Official schema reference:** https://buildkite.com/docs/pipelines (steps reference at `/docs/pipelines/steps/step-reference`). *(Note: the docs site is JS-rendered; the open `go-pipeline` structs below are the verifiable surface.)*
- **Top-level keys** — evidence [`pipeline.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/pipeline.go):
```go
type Pipeline struct {
    Steps    Steps          `yaml:"steps"`
    Env      *ordered.MapSS `yaml:"env,omitempty"`
    Secrets  Secrets        `yaml:"secrets,omitempty"`
    Checkout *Checkout      `yaml:"checkout,omitempty"`
    RemainingFields map[string]any `yaml:",inline"` // agents, timeout_in_minutes, groups, …
}
```
  - `steps` — the step list
  - `env` — pipeline-wide env vars
  - `secrets` — secret sources (see 3.5)
  - `checkout` — git checkout behavior (shared by all steps)
  - inline remaining fields carry `agents` (targeting), `timeout_in_minutes`, `groups`, etc.
  - **A pipeline can be a mapping OR a bare sequence of steps** (legacy list form).

Representative example:
```yaml
steps:
  - label: ":go: Build"
    command: go build ./...
    plugins:
      - docker-compose#v2.0.0: {}
  - label: ":test: Matrix"
    matrix:
      setup:
        go: ["1.22", "1.23"]
        os: ["ubuntu", "macos"]
    commands: go test ./...
  - label: ":ship: Deploy"
    trigger:
      provider: github
      label: deploy-prod
    block: "Confirm prod deploy"
```

### 3.3 Executor types
- "Executor" is **not a pipeline concept** — it's the **agent**. `buildkite-agent` runs on any device (bare host, Docker container, K8s pod, EC2, etc.). The pipeline steps execute on whichever agent (matched by `agents:` tags) picks the job. So the executor matrix is "where you point the agent," not a YAML keyword.

### 3.4 Step / plugin model (authoritative, from source)
Step types (one struct each in `go-pipeline`):
- **`command`** — [`step_command.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command.go): `key` (aliases `id`,`identifier`), `label` (alias `name`), `command`/`commands`, `plugins`, `secrets`, `env`, `matrix`, `cache`, `checkout`, `signature`.
- **`group`** — [`step_group.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_group.go): nests `steps:` under a `group:` label (UI + parallelism scoping).
- **`input`** / **`block`** — [`step_input.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_input.go): "models a block or input step" (manual approval / free-text input).
- **`wait`** — [`step_wait.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_wait.go): dependency sync (waits for prior steps, optional `depends_on`).
- **`trigger`** — [`step_trigger.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_trigger.go): cross-pipeline trigger (opaque inline map: `provider`, `label`, `build`, `from_branch`, …).
- **`plugin`** — a step *is* a plugin when it has a single `plugin:` key; also `plugins:` list on a command step.
- **`script`** — references an **artifact** containing the shell script (keeps long scripts out of YAML).
- **Plugin model:** plugins are **GitHub repos** (scripts), referenced by short name with **canonical source resolution** — evidence [`plugin.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/plugin.go): `thing` → `github.com/buildkite-plugins/thing-buildkite-plugin#<default-branch>`, `owner/repo` → `github.com/owner/repo-buildkite-plugin#<ref>`. **Marketplace:** https://buildkite.com/plugins.

### 3.5 Secret model
- **Environment secrets** (server-side) + **`secrets:`** block binding a source to a name. Sources include **AWS Secrets Manager**, **GCP Secret Manager**, **Vault** (via the secrets source plugins). Step-level `env` can reference them.
- **Interpolation duality (important):** `$VAR` is interpolated **at upload** (the value bakes into the pipeline), while `$$VAR` is interpolated **at runtime** (value never appears in the stored pipeline). The uploader even **rejects pipelines that leak redacted secret values** unless `--allow-secrets`. Evidence: `searchForSecrets` in [`pipeline_upload.go`](https://github.com/buildkite/agent/blob/main/clicommand/pipeline_upload.go).
- **OIDC:** no first-class OIDC secret in the YAML; achieved via cloud workload identity at the **agent** (the agent holds the credentials) or a secret-source plugin.

### 3.6 Matrix strategy (first-class, most expressive of the six)
Evidence [`step_command_matrix.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command_matrix.go):
```go
type Matrix struct {
    Setup       MatrixSetup       `yaml:"setup"`       // map[dim] -> []values  (or a bare list = 1 anon dim)
    Adjustments MatrixAdjustments `yaml:"adjustments,omitempty"` // { with, skip, soft_fail }
}
```
- `setup` = cross-product of dimensions; `adjustments` add arbitrary tuples with `skip` and `soft_fail` (a Buildkite differentiator — you can mark specific permutations to skip or not fail the build).

### 3.7 Cache model (first-class)
Evidence [`step_command_cache.go`](https://github.com/buildkite/go-pipeline/blob/f8926e94645dccb79803eabf1c40ecfc71a977df/step_command_cache.go):
```go
type Cache struct {
    Disabled bool     `yaml:",omitempty"`
    Name     string   `yaml:"name,omitempty"`
    Paths    []string `yaml:"paths,omitempty"`
    Size     string   `yaml:"size,omitempty"`
}
```
- First-class `cache:` per step (name = key, paths, optional size). Restored/uploaded around the step.

### 3.8 Artifact model (first-class)
- `artifacts:` per step — **upload** globs (e.g. `dist/**`) and **download** with build-targeting (e.g. `other-step: path from:to`). Artifacts live in the Buildkite artifact store (S3-backed), downloadable between steps/builds. No user-facing TTL knob in YAML (storage-side retention).

### 3.9 Trigger model
Server-side (not in YAML): **branch/tag push**, **PR**, **manual** (UI), **scheduled/cron**, **API**, **webhook**, and **cluster triggers** (one build fans out to many). The YAML expresses *conditions*, not *starts* — except `if_changed` (glob-based step skip; evidence in `pipeline_upload.go`).

### 3.10 Cross-repo trigger (first-class)
- The **`trigger:` step** (see 3.4) starts a pipeline in **another repo/build**: `provider` (e.g. `github`), `label` (target pipeline), `build: { branch, commit, env }`. This is the cleanest cross-repo primitive in the group.

**OpenForge takeaway:** Buildkite has the most complete *step* feature set (first-class matrix w/ adjustments, cache, artifacts, groups, inputs/blocks, cross-repo trigger). But it is **not a drop-a-file-in-repo self-hosted semantic** — it's an upload-to-SaaS model, and the validating server is closed. Copying its *step vocabulary* is easy; copying its *architecture* is not self-hosting.

---

# 4. Concourse CI

### 4.1 Repository + version
- **Repo:** https://github.com/concourse/concourse
- **License:** Apache-2.0
- **Current stable:** `v8.3.2` (2026-10-23), last push 2026-11-03 (active)
- **Model:** server + workers; pipelines are **pushed to the server** (`fly set-pipeline`) — **not** a fixed file in the tested repo.

### 4.2 Pipeline definition file
- **Default path:** none fixed — you keep any `.yml` in your repo and push it via `fly set-pipeline -c pipeline.yml` or a `set_pipeline` step. (This is the key architectural difference vs. Woodpecker/Drone.)
- **Official schema reference:** https://concourse-ci.org/docs/pipelines/
- **Top-level keys** (evidence from the schema page):
  - `jobs` — **[job] (required)** — continuously-scheduled jobs
  - `resources` — [resource] — things to check (git, S3, registry, time, …)
  - `resource_types` — [resource_type] — custom resource types (the "plugin" unit)
  - `var_sources` — [var_source] — where variables/secrets come from
  - `groups` — UI grouping (globs allowed)
  - `display` — `background_image` / `background_filter`
  - `user_data` — arbitrary metadata that survives `get-pipeline`/`set-pipeline`

Representative example:
```yaml
resources:
  - name: src
    type: git
    source: { uri: https://github.com/octocat/hello.git, branch: main }

jobs:
  - name: test
    plan:
      - get: src
        trigger: true
      - task: run-tests
        image: docker://golang:1.22
        file: src/ci/test.yml
```

### 4.3 Executor types
- Execution is on **workers** running a container engine (**garden**). Worker/containerd backends:
  - **Container-backed workers (Linux)** — Docker/containerd images (the default model)
  - **Concourse on Kubernetes** — K8s-backed workers
  - **garden on Linux / macOS / Windows** workers (the Windows worker is a differentiator)
- There is no per-pipeline "executor" keyword; you select **worker `tags`** per step to place it.

### 4.4 Step / plugin model
Step types (from the docs nav — evidence: the Steps section of https://concourse-ci.org/docs/pipelines/):
- **`task`** — a container with `image` + `commands` or a `file:` (the "shell step")
- **`get`** / **`put`** — fetch/publish **resource versions** (the core data-flow primitive)
- **`set_pipeline`** — deploy another pipeline (cross-repo/monorepo)
- **`load_var`** — read a value from a resource
- **`in_parallel`**, **`do`**, **`try`** — composition
- **Modifiers:** `across` (matrix), `timeout`, `attempts`, `tags`
- **Hooks:** `on_success`, `on_failure`, `on_abort`, `on_error`, `ensure`
- **Plugin model = resource types.** A **custom resource type** (`resource_types:`) is an image implementing `check`/`in`/`out` — this is how Concourse extends (S3, registry, vault-as-resource, …). There is **no "command plugin" marketplace** like Drone's; the extension point is the *resource*.

### 4.5 Secret model (vars + credential managers)
- **Vars system:** `((var_name))` substitution in pipeline YAML; `var_sources` bind a name to a **credential manager**:
  - **Vault**, **AWS Secrets Manager**, **AWS SSM**, **Conjur**, **CredHub**, **Kubernetes** (K8s Secrets), and **IDToken**.
  - Evidence: the "Credential Management" subsections under https://concourse-ci.org/docs/pipelines/ → Operation.
- **OIDC:** first-class via the **IDToken credential manager** (short-lived identity tokens from Vault/AWS/Azure/GCP) — a genuine OIDC/workload-identity path.
- Caching + redaction of credentials are built in.

### 4.6 Matrix strategy
- **First-class `across` step modifier** — runs a step for each combination of a variable matrix, with per-combination `in_parallel`. This is Concourse's native fan-out (no separate "matrix" object; it's a step modifier).

### 4.7 Cache model
- **Image caching** (workers cache container images) and **resource-version caching** (the `get`/`put` + `passed` constraints create a content-addressed cache of resource versions on workers). There is **no keyed file-cache primitive** in the pipeline; you emulate it with an S3 `get`/`put`.

### 4.8 Artifact model
- Artifacts are **resource versions** passed between steps via `get`/`put` (local to the job, or published to a git/S3/registry resource). **Retention** is governed by resource/GC settings (`keep_log`, version retention, the **Garbage Collector**), not a per-step TTL. No centralized "artifact store" the way Buildkite/CI-SaaS have.

### 4.9 Trigger model
- **Resource-driven:** a `get` with `trigger: true` starts the job when the resource checker sees a new version (via `check_every`, webhooks).
- **Manual:** UI click / `fly trigger-job` / `fly execute`.
- **Time-based:** the `time` resource (cron) triggers a job.
- **Pipeline-driven:** `set_pipeline` + a job in the new pipeline (bootstrap).
- No "push/PR/tag" keywords in the YAML — those are modeled as **resource checks** on a git resource (branch/tag patterns).

### 4.10 Cross-repo trigger (first-class, idiomatic)
- **`set_pipeline`** can deploy a pipeline into **another team/repo** (given permissions + resource access) — the canonical Concourse pattern for monorepo and cross-repo orchestration. Combined with `put` on a git resource in another repo, one repo's pipeline can drive another's. This is a **first-class, designed-for** capability (Concourse's whole "monorepo" example set is built on it).

**OpenForge takeaway:** Concourse is a fundamentally different model (resource/graph-driven, pushed pipelines, `get`/`put` data flow, resource-type plugins, vars+credential managers, first-class OIDC via IDToken, strong cross-repo via `set_pipeline`). "Following Concourse's semantic" = adopting its **pipeline-as-a-pushed-graph** architecture, which is powerful but a large lift and not repo-file-native.

---

# 5. Tekton

### 5.1 Repository + version
- **Repo:** https://github.com/tektoncd/pipeline
- **License:** Apache-2.0
- **Current stable:** `v1.18.0` (2026-10-29), last push 2026-11-02 (active, CNCF-graduated)
- **Model:** **Kubernetes-native CRDs**. Pipelines are K8s objects, not a repo file.

### 5.2 Pipeline definition file
- **Default path:** none — Tekton has **no in-repo YAML convention**. Definitions are K8s manifests (`Pipeline`, `Task`) applied via `kubectl`/`tkn`, or pulled in via **resolvers** (git/bundle/cluster) or **Pipelines-as-Code (PAC)**. If you want a repo-file model you must adopt **PAC** (openshift/tektoncd), which watches repo paths and turns them into PipelineRuns.
- **Official schema reference:** https://tekton.dev/docs/pipelines/pipelines/
- **Top-level (a `Pipeline`)** — evidence from that page:
  - `apiVersion` / `kind` / `metadata` (K8s envelope)
  - `spec.params` — typed params (`string`/`array`, optional `enum`)
  - `spec.workspaces` — shared volumes
  - `spec.tasks[]` — each: `name`, `taskRef`/`taskSpec`, `runAfter`, `retries`, `when`, `timeout`, `params`, `workspaces`, **`matrix`**
  - `spec.results` — pipeline-level results
  - `spec.finally[]` — tasks that always run (like a `finally` block), each also supporting `matrix`/`when`/`params`

Representative example:
```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata: { name: build-test }
spec:
  workspaces:
    - name: src
  params:
    - name: revision
      type: string
      default: main
  tasks:
    - name: clone
      taskRef: { name: git-clone }
      params:
        - { name: url, value: "$(params.url)" }
      workspaces: [{ name: output, workspace: src }]
    - name: test
      runAfter: [clone]
      matrix:
        params:
          - name: version
            value: ["1.22", "1.23"]
      taskRef: { name: go-test }
      workspaces: [{ name: source, workspace: src }]
```

### 5.3 Executor types
- **Kubernetes only** — "Each `Task` … executes as a `Pod` on your Kubernetes cluster." (Evidence: Pipelines overview.) Extension is via **CustomRun** / **resolvers**, not a different executor. No Docker/VM/SSH/local executors.

### 5.4 Step / plugin model
- A **`Task`** = a Pod with **`steps`** (containers) + optional `sidecars`. A **`Pipeline`** = DAG of Tasks.
- **"Plugin" model = Custom Tasks.** The idiom is *composition*: you build reusable `Task`s (from **Tekton Hub**, the catalog) and wire them into Pipelines. There is also the newer **StepActions** concept (attach logic to a step). So "first-class plugin" = a Custom Task / catalog Task — the unit of reuse is the Task, not an image-with-settings.
- **Marketplace:** **Tekton Hub** (task/cluster-task catalog).

### 5.5 Secret model
- **Kubernetes primitives:** K8s **Secrets** mounted/referenced, plus **`serviceAccountName`** per Task (workload identity). There is **no Tekton-native secret store** — you bring K8s Secrets / an external secret operator (External Secrets, Vault Operator).
- **OIDC:** via **workload identity** (ServiceAccount → cloud IAM) or the **Chains** SLSA/signing integration; not a pipeline-YAML keyword.
- **Secrets-as-params:** passing a secret into a Task is done by referencing a K8s Secret in a param/workspace — no built-in "secret reference" token like Drone/Concourse.

### 5.6 Matrix strategy (first-class)
- **`matrix`** on a `PipelineTask` fans one task out into multiple `TaskRun`s (param sets). Evidence: "Specifying `Matrix` in `PipelineTasks`" in the Pipelines doc. Also available on `finally` tasks.

### 5.7 Cache model
- **Workspaces** are the persistence primitive: backed by `emptyDir`, `PersistentVolumeClaim`, or **`volumeClaimTemplates`**, and the **`remote-workspace`** Task can pull/push a workspace from a registry. There is **no keyed file-cache**; caching = reuse a PVC / remote workspace.

### 5.8 Artifact model
- **`Artifact`** resource (newer, `tekton.dev/v1` `Artifact`) + **Results** API + workspaces. Results store small outputs; large artifacts go to workspaces/remote storage. Retention is K8s/GC-driven (PVC lifetime, **Tekton Results** retention, **Pruner** for Runs) — not a per-artifact TTL in the pipeline.

### 5.9 Trigger model
- **Tekton Triggers** (separate component): **EventListener** (an HTTP service) + **TriggerBinding** + **TriggerTemplate** + **Interceptors** (CEL-based, incl. auth/OIDC) turn an event (git webhook, etc.) into a `PipelineRun`. Plus **Pipelines-as-Code** for repo-driven runs. Manual via `tkn`.
- So triggers are **eventing-as-a-service**, not keywords in the pipeline.

### 5.10 Cross-repo trigger
- **Not native** at the pipeline level (namespaced K8s objects). You'd write a Task that calls the K8s/CI API to start a `PipelineRun` in another namespace/repo, or use PAC. No first-class "trigger another repo's pipeline" step.

**OpenForge takeaway:** Tekton is the most **composable and K8s-idiomatic** of the six (DAG of Tasks, matrix, workspaces, first-class OIDC-ish identity, custom tasks), but it is **not a repo-file semantic at all** — it's a CRD runtime. Adopting "Tekton's semantic" means your CI config becomes **Kubernetes manifests**, which is a strong fit *only if* OpenForge is K8s-native and self-hosted-on-K8s.

---

# 6. Prow

### 6.1 Repository + version
- **Repo:** https://github.com/kubernetes-sigs/prow (the engine); **job config** lives centrally in https://github.com/kubernetes/test-infra (`config/prow/…`) and, increasingly, **in-repo** via the "in-repo config" feature.
- **License:** Apache-2.0
- **Versioning:** no semver GitHub releases; versioned by **image tags aligned with Kubernetes releases**. Last commit 2026-11-03 (very active — it runs all of k8s's CI). ~333 stars on the engine repo.
- **Model:** Prow is **GitHub-webhook-driven K8s job orchestration**. A "pipeline" is really a set of **jobs** (Pods).

### 6.2 Pipeline definition file
- **Default path:** **not in the tested repo** (mostly). Jobs are defined in **central YAML** (e.g. `config/prow/…`) or **in-repo config** (`.prow.yaml` / inrepoconfig). The unit is a **job**, grouped under maps keyed by `org/repo`:
  - `presubmits:` — run on PRs
  - `postsubmits:` — run on pushes
  - `periodics:` — run on a timer
- **Official reference:** the in-repo annotated config [`pkg/config/prow-config-documented.yaml`](https://github.com/kubernetes-sigs/prow/blob/main/pkg/config/prow-config-documented.yaml) + the type definitions.
- **Top-level job keys** — evidence [`pkg/config/jobs.go`](https://github.com/kubernetes-sigs/prow/blob/43ed234002b9/pkg/config/jobs.go):
```go
type JobBase struct {
    Name           string            `json:"name"`
    Labels         map[string]string `json:"labels,omitempty"`
    MaxConcurrency int               `json:"max_concurrency,omitempty"`
    Agent          string            `json:"agent,omitempty"`     // kubernetes | jenkins | tekton-pipeline
    Cluster        string            `json:"cluster,omitempty"`
    Namespace      *string           `json:"namespace,omitempty"`
    Spec           *v1.PodSpec       `json:"spec,omitempty"`          // the actual job = a Pod
    PipelineRunSpec *pipelinev1.PipelineRunSpec `json:"pipeline_run_spec,omitempty"` // if agent=tekton-pipeline
    ReporterConfig *prowapi.ReporterConfig `json:"reporter_config,omitempty"`
    UtilityConfig                       // decorate, clone_uri, path_alias, extra_refs, decoration_config
}
```
  - `Presubmit` adds: `always_run`, `optional`, `trigger` (regex for `/test` comment), `rerun_command`, `run_before_merge`, `branches`/`skip_branches`, `run_if_changed`/`skip_if_only_changed`, `context` (GitHub status).
  - `Periodic` adds: `interval`/`minimum_interval`, `cron`, `tags`, `retry`.
  - `Preset` reuses `env`/`volumes`/`volumeMounts`/`tolerations` across jobs.

Representative example (a presubmit job):
```yaml
presubmits:
  octocat/hello:
    - name: pull-hello-unit
      always_run: true
      decorate: true
      clone_uri: https://github.com/octocat/hello.git
      spec:
        containers:
        - image: golang:1.22
          command: [go, test, ./...]
      run_if_changed: '^pkg/'
```

### 6.3 Executor types (`agent:`)
- **`kubernetes`** (default) — the job runs as a **Pod**.
- **`jenkins`** — delegates to a Jenkins job.
- **`tekton-pipeline`** — runs a **Tekton `PipelineRun`** (note: Prow *embeds* Tekton as an agent — evidence: `PipelineRunSpec` field importing `tektoncd/pipeline`).
- So a Prow "executor" is a **Pod (or Jenkins job, or Tekton run)** — K8s-native.

### 6.4 Step / plugin model
- A job is **a Pod spec** (`initContainers` + `containers`) — there are **no "steps"** in the Woodpecker/Drone sense; you write the container(s) directly.
- **Decoration** wraps your Pod with **init containers / sidecars** that handle `clone` (clonerefs), `entrypoint`, **`upload`** (logs+artifacts), and **`grab-provenance`** — configured via `decoration_config`.
- **"Plugins" in Prow = Go plugins** that react to **GitHub events** (comment commands like `/test`, `/retest`, status updates, label syncing). This is a *different* concept from a build-step plugin — it's the webhook/comment layer, not the job body.
- No step-plugin marketplace.

### 6.5 Secret model
- **Kubernetes Secrets** are the substrate. Evidence [`pkg/apis/prowjobs/v1/types.go` → `DecorationConfig`](https://github.com/kubernetes-sigs/prow/blob/43ed234002b9/pkg/apis/prowjobs/v1/types.go): `gcs_credentials_secret`, `s3_credentials_secret`, `ssh_key_secrets`, `cookiefile_secret`, `oauth_token_secret` (K8s secret), `github_app_private_key_secret`.
- Env vars in the Pod spec; **`censor_secrets`** redacts secret values from logs/artifacts.
- **OIDC:** via workload identity (the Pod's ServiceAccount → cloud IAM) and **GitHub App** auth — not a pipeline-YAML secret token.

### 6.6 Matrix strategy
- **No first-class matrix.** Fan-out is done by **defining multiple jobs** (often via config templating/generation) or via **`extra_refs`** (test the same change against multiple base repos). There is no `matrix:` key.

### 6.7 Cache model
- **GCS/S3-backed** via decoration: `gcs_configuration` (bucket, path_prefix, size_limit, expiration). Caching is the **clonerefs cache** and tool caches (e.g. go-build cache) stored in the bucket — **not** a keyed pipeline cache primitive.

### 6.8 Artifact model
- **First-class (cloud-blob):** `gcs_configuration` (or S3) uploads **logs + artifacts** automatically under a predictable `path_prefix`; `size_limit` caps size. **Retention** is via **GCS lifecycle / `expiration`** — this is the closest to a TTL-based artifact model in the group (but cloud-blob, not a CI-managed store).

### 6.9 Trigger model
- **`presubmits`** — on PR (`always_run` or via `/test <job>` comment / `run_if_changed`).
- **`postsubmits`** — on push to matching branches.
- **`periodics`** — on `cron` or `interval`.
- Plus **comment commands** (`/test`, `/retest`, `/cancel`), **`/hold`**, and **Tide** (auto-merge batching). Triggers are **webhook/comment-driven**, not pipeline keywords.

### 6.10 Cross-repo trigger
- **Not native.** Jobs are **repo-scoped** (`presubmits: org/repo:`). A **`periodic`** can reference multiple repos via **`extra_refs`**, but "repo A's pipeline triggers repo B's pipeline" is not a primitive — you'd orchestrate it externally (or via a custom plugin).

**OpenForge takeaway:** Prow is a **GitHub-CI workhorse** (excellent for PR-gating + status contexts + comment commands + GCS artifacts), but it is **central-config / K8s-Pod-native**, with no repo-file semantic, no matrix, no step-plugin model, and cross-repo triggering that's not a first-class primitive. It's the least "drop-a-file" of the six.

---

# Final comparison table

Legend for **Plugins / Cache / Artifacts**: **✓** = first-class primitive in the definition; **~** = via extension/plugin/resource (not a core keyword); **✗** = effectively absent.

| Engine | YAML path | Executors | Plugin model | Secrets | Matrix | Cache | Artifacts | Trigger | Cross-repo trigger | Active (last push) | License |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Woodpecker** | `.woodpecker.yaml` (repo root) | Docker, Kubernetes, Local, Custom | ~ image+settings (marketplace) | ~ env/encrypt + extensions; OIDC via ext | ✓ `matrix:` | ~ volume/plugin | ~ plugin | push/PR/tag/release/cron/manual/path | ~ plugin (`trigger`) | 2026-11-03 | Apache-2.0 |
| **Drone 2.0 / Harness OSS** | `.drone.yml` (repo root) | Docker, K8s, Exec, SSH, AWS, DO, MacStadium | ~ image+settings (largest marketplace) + Starlark/Jsonnet | ✓ client-encr. + **OIDC first-class** | ✓ `matrix:` | ~ plugin | ~ plugin | push/PR/tag/cron/manual/custom | ✗ API/plugin | 2026-11-02 | Apache-2.0 |
| **Buildkite** | `buildkite.yml` / `.buildkite/pipeline.yml` | Agent runs anywhere (host/Docker/K8s/EC2) | ~ GitHub-repo plugins (marketplace) | ~ env + AWS/GCP/Vault sources; `$`/`$$` duality | ✓ `matrix:` + **adjustments** | ✓ `cache:` | ✓ `artifacts:` | SaaS server (push/PR/cron/API/webhook) + `if_changed` | ✓ **`trigger:` step** | 2026-11-03 | MIT (agent) / SaaS (server) |
| **Concourse** | any `.yml`, pushed via `fly set-pipeline` | Workers (garden; Linux/K8s/Windows) | ~ **resource types** (check/in/out) | ✓ **vars + cred managers**; **OIDC via IDToken** | ✓ **`across`** | ~ image/version cache (S3 emulate) | ~ `get`/`put` versions + GC | resource check/`trigger`, time (cron), manual, `set_pipeline` | ✓ **`set_pipeline`** (first-class) | 2026-11-03 | Apache-2.0 |
| **Tekton** | none (K8s CRDs; PAC for repo) | Kubernetes (Pod) only | ✓ **Custom Tasks** (Tekton Hub) | ~ K8s Secrets/SA; OIDC via identity | ✓ `matrix:` | ~ workspaces (PVC/remote) | ✓ `Artifact` + Results API | Tekton Triggers (EventListener) / PAC / `tkn` | ✗ (K8s-scoped) | 2026-11-02 | Apache-2.0 |
| **Prow** | none (central cfg / in-repo `.prow.yaml`) | Pod (k8s), Jenkins, Tekton | ✗ Go **event** plugins (not steps) | ~ K8s Secrets + GitHub App; censor | ✗ (multi-job / `extra_refs`) | ~ GCS/S3 caches | ✓ **GCS/S3** + lifecycle TTL | presubmit(PR)/postsubmit(push)/periodic(cron) + comments | ✗ (repo-scoped; `extra_refs`) | 2026-11-03 | Apache-2.0 |

### Read for the OpenForge decision

1. **Only two are "adopt the file" candidates:** `.woodpecker.yaml` and `.drone.yml`. Everything else is an architecture, not a filename.
   - **`.woodpecker.yaml`** = cleanest self-hosted, fully open, actively maintained, repo-native; first-class matrix + `when`; but **cache/artifacts/cross-repo are plugin-shaped** and OIDC is an extension.
   - **`.drone.yml`** = richest repo-native surface (per-pipeline executor, Starlark/Jsonnet, **first-class OIDC secrets**, biggest plugin base) but the **project moved into Harness Open Source** (vendor stewardship risk; 2.x format frozen).

2. **Best single-engine feature set to *borrow* (even if you don't adopt its architecture):**
   - **Buildkite's step vocabulary** (first-class `matrix`+adjustments, `cache`, `artifacts`, `group`, `input`/`block`, and the **`trigger:` cross-repo step**) is the most complete and least exotic — the strongest template for a new semantic.
   - **Concourse's** `across` (matrix-as-modifier) + **credential-manager/OIDC (IDToken)** + **`set_pipeline`** (cross-repo) are the ideas worth lifting.
   - **Tekton's** `finally`, typed `params`, and **workspaces** are clean K8s-idiomatic primitives if OpenForge targets K8s.

3. **If OpenForge is self-hosted + K8s-native and wants no SaaS dependency:** the realistic "follow an existing semantic" choices are **Woodpecker** (safest, most maintained, fully OSS) or **Drone** (most expressive, vendor risk). **Tekton** is the right pick only if you're already committing to a K8s-manifest CI model. **Concourse** and **Prow** are powerful but represent different products (pushed-graph / GitHub-CI-workhorse) rather than a repo-file convention.

---

### Verification notes / stated uncertainty
- **Buildkite docs** are JS-rendered, so `webfetch` returned empty; I verified the Buildkite schema **from source** (`buildkite/go-pipeline` structs + `buildkite/agent` `pipeline_upload.go`), which is the authoritative open reference. Step types, matrix, cache, plugin source-resolution, and the `$`/`$$` interpolation + secret-rejection behavior are all **code-verified** (permalinks above). Buildkite `artifacts:` and `script:` are long-standing documented fields; I did not capture a typed struct for `artifacts` (it's carried in the step's inline fields), so I treat its retention/TTL as **server-side, not YAML-exposed** (flagged).
- **Drone cross-repo trigger** is stated as **API/plugin, not a first-class step** — this is my inference from the docs structure (no native `trigger:` step documented); flagged as such.
- **Woodpecker OIDC** is **via a secret extension**, not a built-in key — flagged.
- **Drone versioning:** `drone/drone` → `harness/harness` redirect is code/API-verified; the "2.x frozen, now 3.x under Harness Open Source" framing reflects the tag history I observed (`v2.0.0…v2.28.x`, then `v3.0.0…v3.3.0`) — treat the exact freeze boundary as **interpretation**.
- All six repos show **last pushes on 2026-11-02/03**, i.e., all are **actively maintained** as of this research date (2026-11-03).

<task_metadata>
session_id: ses_e5efd90fdffeL5trIc85011JxD
task_id: ses_e5efd90fdffeL5trIc85011JxD
subagent: librarian
</task_metadata>