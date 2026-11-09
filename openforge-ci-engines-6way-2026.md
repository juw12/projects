# OpenForge CI/CD Engine Survey — 6-way comparison

Scope: six self-hosted-friendly CI/CD engines evaluated as the engine
layer for OpenForge (a self-hosted Git platform). The candidate currently
in play is a fork of Forgejo's `act_runner`. This document asks: is any
of these six a better foundation than `act_runner` for OpenForge's CI
layer, and if so, what YAML shape does the user see?

Evaluation axes (per the request):

1. Pipeline DSL (YAML shape + a real lifted example)
2. Trigger model (webhook / polling / API / SCM-specific)
3. Step/job abstraction (composition, plugins vs containers)
4. Plugin/step marketplace
5. Runner model (ephemeral vs persistent, registration, labels)
6. Secret model (scope, masking, rotation)
7. Cache model (keys, scope, backend options)
8. Artifact model (upload/download, retention, cross-job sharing)
9. Matrix / parallelism (how fan-out is expressed)
10. Self-hosted posture (first-class / afterthought / SaaS-first)
11. License (SPDX) and maturity (release, cadence, contributors, users)
12. Killer tradeoff (one paragraph)

All claims are cited to a doc URL or to a primary source. Citations are
inline as `file_path:section` style URLs into official docs sites.

---

## 1. Woodpecker CI

Woodpecker is a container-native CI originally forked from Drone 0.x.
It is the most direct competitor to the `act_runner` model OpenForge
would otherwise inherit.

### Pipeline DSL

`.woodpecker.yaml` lives in the repo root (or `.woodpecker/*.yaml`).
Lifted example from the workflow-syntax doc, showing two sequential
steps, a parallel DAG via `depends_on`, and a plugin reference
([woodpecker-ci.org/docs/usage/workflow-syntax](https://woodpecker-ci.org/docs/usage/workflow-syntax)):

```yaml
steps:
  - name: backend
    image: golang
    commands:
      - go build
      - go test

  - name: frontend
    image: node
    commands:
      - npm install
      - npm run test
      - npm run build
```

A DAG variant with `depends_on` from the same doc ([woodpecker-ci.org/docs/usage/workflow-syntax#depends_on](https://woodpecker-ci.org/docs/usage/workflow-syntax)):

```yaml
steps:
  - name: build
    image: golang
    commands: [go build]
  - name: deploy
    image: woodpeckerci/plugin-s3
    settings: {bucket: my-bucket, source: file, target: /target/file}
    depends_on: [build, test]
  - name: test
    image: golang
    commands: [go test]
```

The shape is shallow: a top-level `steps:` list, each step is a
container image + commands. DAG, services, secrets, matrix and `when`
blocks sit alongside.

### Trigger model

Webhook-driven. The server receives SCM webhooks (Gitea/Forgejo,
GitHub, GitLab, Bitbucket) on push / pull_request / tag / release /
deployment events, plus a `cron` scheduler and a `manual` UI trigger.
The complete event list is in the `when.event` enum
([woodpecker-ci.org/docs/usage/workflow-syntax#event](https://woodpecker-ci.org/docs/usage/workflow-syntax)).
No polling fallback is exposed.

### Step / job abstraction

Every step is a Docker container image with an entrypoint. Plugins
are a strict subset of steps: a plugin is an image that "does not have
`commands` or `entrypoint` set and is therefore constrained" and gets
secret filtering automatically
([woodpecker-ci.org/docs/usage/plugins/overview](https://woodpecker-ci.org/docs/usage/plugins/overview)).
`services:` is a sibling block that launches sidecar containers
(databases etc.) for the duration of the workflow.

### Plugin / step marketplace

Yes. The official index is at
[woodpecker-ci.org/plugins](https://woodpecker-ci.org/plugins) and the
docs link to it from the plugin overview page. Plugins are Docker
images distributed by registry (the `woodpeckerci/...` namespace on
Docker Hub). Woodpecker docs explicitly note that **Drone plugins
work with minimal adjustment** ([woodpecker-ci.org/docs/usage/plugins/overview](https://woodpecker-ci.org/docs/usage/plugins/overview)),
because Woodpecker preserved the `PLUGIN_*` env-var convention when
forking.

### Runner model

Woodpecker agents register with the server and **poll** for jobs.
Agents carry labels (`platform=linux/amd64`, `backend=docker`,
`hostname=...`, `repo=*`); workflows declare matching labels
([woodpecker-ci.org/docs/usage/workflow-syntax#labels](https://woodpecker-ci.org/docs/usage/workflow-syntax)).
Backends: `docker`, `local`, `kubernetes`, `exec` — each ships its own
agent binary (per the release artifact list at
[github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.1](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.1)).
Agents are **persistent**: a single agent executes many jobs. Admin
config can also pin which organizations or users are restricted to
specific agents (added in v3.20.0,
[github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.0](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.0)).

### Secret model

Three scopes, highest priority wins per name
([woodpecker-ci.org/docs/usage/secrets](https://woodpecker-ci.org/docs/usage/secrets)):

1. **Repository** secrets (per repo)
2. **Organization** secrets (per org)
3. **Global** secrets (admin-set, instance-wide)

Secrets are pulled into step env via `from_secret: name`. Masking is
applied to Woodpecker's own secret store (printed as `***`); secrets
fetched from external providers are **not** masked. Per-secret event
filter (`push`, `tag`, `pull_request`, `deployment`) and an
**image allow-list filter** limit which plugin images a given secret
is exposed to. PR events default to secret-less.

CLI management via `woodpecker-cli repo secret add ... --event
--image ...`. Secrets can be loaded from a file using the `@path`
syntax (intended for SSH keys).

### Cache model

Not a first-class concept. The recommended pattern is **plugins** that
restore/save to an external store: e.g.
`plugins/cache` or third-party S3/MinIO cache plugins. Caches are not
keyed by the engine; they live on whatever the plugin targets. Woodpecker
uses a single shared workspace volume across steps, so step-to-step
caching is "just `cp` into `/woodpecker/...`."

### Artifact model

Same story: artifacts live in the shared workspace (`workspace.base`,
default `/woodpecker/src/<repo-url>`,
[woodpecker-ci.org/docs/usage/workflow-syntax#workspace](https://woodpecker-ci.org/docs/usage/workflow-syntax)),
uploaded by plugins (`plugin-s3`, `plugin-artifactory`, etc.). There is
no native upload-API; cross-job artifact transfer requires either a
plugin or `services` volumes.

### Matrix / parallelism

Inline matrix block, two shapes
([woodpecker-ci.org/docs/usage/matrix-workflows](https://woodpecker-ci.org/docs/usage/matrix-workflows)):

```yaml
matrix:
  GO_VERSION: [1.4, 1.3]
  REDIS_VERSION: [2.6, 2.8, 3.0]
```

or an explicit `include:` list of `{GO_VERSION, REDIS_VERSION}` pairs.
Hard limits: **64 workflows per matrix, 10 variables per axis**, more
returns an error. Variables are interpolated into the YAML *before*
parsing, so `image: golang:${GO_VERSION}` works directly. Platform
matrices use the `matrix.platform` axis combined with a `labels.platform:
${platform}` selector so each instance fans out to the right arch agent.

DAG parallelism is via `depends_on:` on any step, not a matrix construct.

### Self-hosted posture

**First-class.** The whole product exists to be self-hosted. The
server is a single Go binary + SQLite/Postgres; agents are separately
distributable binaries per OS/arch. The doc says it "is lightweight
and even runs on a Raspberry Pi"
([woodpecker-ci.org/docs/intro](https://woodpecker-ci.org/docs/intro)).
The CI instance itself runs on Woodpecker (self-hosted)
([ci.woodpecker-ci.org/repos/3780](https://ci.woodpecker-ci.org/repos/3780)).

### License / maturity

- License: **Apache-2.0** ([github.com/woodpecker-ci/woodpecker/blob/main/LICENSE](https://github.com/woodpecker-ci/woodpecker/blob/main/LICENSE))
- Latest release: **v3.20.1 on 2026-10-29**
  ([github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.1](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.1))
- Cadence: ~monthly minor releases observed (3.14.0 → 3.20.1 over
  six months)
- Contributors: 30+ named contributors in the v3.20.0 release notes
  alone ([github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.0](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.20.0))
- Production users: the project CI is hosted on Woodpecker; widely
  used in Gitea/Forgejo and small-team self-hosting circles. No large
  SaaS dependency.

### Killer tradeoff

Woodpecker is the path-of-least-resistance if you want Drone-shaped
CI without depending on the post-Harness-acquisition Drone 2.x
maintainership story. The DSL is shallow, the plugin ecosystem
inherited from Drone mostly works, and the Gitea/Forgejo story is
explicitly first-class. Trade: it does not solve the harder problems
this survey cares about — no first-class cache, no first-class
artifacts, no first-class keying for matrix secrets — so anything
beyond "build, test, push" still becomes plugin orchestration. That is
acceptable for OpenForge's user base, but it puts the burden of
defining "what OpenForge ships" largely on whichever plugin set
OpenForge commits to maintaining.

---

## 2. Drone 2.0

Drone 2.x is the container-native CI Brad Rydzewski authored; the
original company was acquired by Harness in 2020. The OSS server and
runner still exist and are the canonical reference for this category.

### Pipeline DSL

`.drone.yml` in the repo root. Multiple `kind:` blocks (`pipeline`,
`trigger`, `secret`, etc.) can coexist in one file; each pipeline
declares a `type` (`docker`, `kubernetes`, `exec`, `ssh`, `aws`,
`digitalocean`, `macstadium`) which selects a runner family.
Lifted example
([docs.drone.io/pipeline/overview](https://docs.drone.io/pipeline/overview/)):

```yaml
kind: pipeline
type: docker
name: default

steps:
- name: backend
  image: golang
  commands:
  - go build
  - go test

- name: frontend
  image: node
  commands:
  - npm install
  - npm run test
```

A fan-in DAG from the parallelism doc
([docs.drone.io/pipeline/docker/syntax/parallelism](https://docs.drone.io/pipeline/docker/syntax/parallelism/)):

```yaml
kind: pipeline
type: docker
name: default

steps:
- name: backend
  image: golang
  commands: [go build, go test]
- name: frontend
  image: node
  commands: [npm install, npm test]
- name: notify
  image: plugins/slack
  settings:
    webhook:
      from_secret: webhook
  depends_on: [frontend, backend]
```

### Trigger model

Webhook from SCM (Gitea, Gitea Enterprise, GitHub, GitLab, Bitbucket,
Bitbucket Server). Triggers are configured **per-pipeline**, not
globally, with a `trigger:` block that can filter by `branch`, `event`,
`ref`, `repo`, `status`, `target`, `cron`, `action`
([docs.drone.io/pipeline/docker/syntax/trigger](https://docs.drone.io/pipeline/docker/syntax/trigger/)).
Events enumerated in the docs: `cron`, `custom`, `push`, `pull_request`,
`tag`, `promote`, `rollback`. `promote` and `rollback` are
deployment-style events unique to Drone.

### Step / job abstraction

Every step is a Docker container. Plugins are first-class and they are
**just Docker images in the `plugins/*` namespace**; their entrypoint
reads env vars of the form `PLUGIN_<SETTING>`
([docs.drone.io/pipeline/docker/syntax/plugins](https://docs.drone.io/pipeline/docker/syntax/plugins/)).
`services:` launches sidecar containers (e.g. databases).

### Plugin / step marketplace

Yes. The community-owned registry is at
[plugins.drone.io](http://plugins.drone.io). Distribution is Docker
images; the `plugins/` Docker Hub namespace is "collectively maintained
by the Drone community" per the docs.

### Runner model

Runners poll the server
([docs.drone.io/runner/overview](https://docs.drone.io/runner/overview/)).
Six runner types ship from the project: Docker, Exec, SSH, Digital
Ocean, VM (cloud-provider pluggable, currently AWS/Azure/Google/Anka
drivers), MacStadium. Same agent may run multiple types. Each runner
is persistent; jobs are dispatched to it. Labels are by runner type
("Docker runner", "Exec runner", ...) and per-runner OS attributes.

### Secret model

Secrets are managed at the repo or org level. The full secrets API is
documented at [docs.drone.io/manage/secrets](https://docs.drone.io/manage/secrets)
(referenced from the Plugins doc via `from_secret`). Secrets are
mounted into step settings via `from_secret: <name>`. Drone supports
external secret backends via runner extensions (AWS Secrets Manager,
Vault, Kubernetes Secrets, all listed at
[docs.drone.io/runner/overview](https://docs.drone.io/runner/overview/)).
Masking in logs is handled by the runner (regex-based), and Drone's
PR-event default is "no secrets," with an allow-list to opt in.

### Cache model

No first-class cache. Plugins restore/save to external backends
(`drone-s3-cache`, etc.). The shared workspace across steps is the
implicit scratch space.

### Artifact model

No first-class artifact store. Plugins upload to external storage
(`plugins/s3`, `plugins/artifactory`, `plugin-gcs`). Step-to-step
artifact sharing is via the workspace volume or a plugin.

### Matrix / parallelism

DAG only via `depends_on: [stepA, stepB]`. The runner "automatically
corrects the dependency graph for skipped steps." There is no native
`matrix:` block in Drone 2.x — fans-out must be done by duplicating
steps or by writing a script step that fans out itself. The plugins
ecosystem fills this gap partially (e.g. plugin-matrix).

### Self-hosted posture

**First-class.** Drone 2.x is designed to be self-hosted: a single Go
binary server + a runner binary, plus a Postgres database. The
product has not moved to a SaaS-first model; the Harness acquisition
has shifted most new investment to the Harness CI product (cloud +
enterprise), but Drone 2.x as OSS continues to ship.

### License / maturity

- License: **Apache-2.0** (drone-cli is Apache-2.0 per its repo
  badge, [github.com/harness/drone-cli](https://github.com/harness/drone-cli);
  the server and runners have used Apache-2.0 historically — confirmed
  via the project LICENSE files mirrored in the Drone docs repo
  [github.com/drone/docs](https://github.com/drone/docs))
- Latest release: the OSS Drone 2.x server/runner releases are
  published on
  [github.com/drone/drone/releases](https://github.com/drone/drone/releases);
  release cadence has slowed post-acquisition, with the bulk of
  engineering now flowing into the Harness CI Cloud product at
  [github.com/harness/harness/releases](https://github.com/harness/harness/releases)
  (which reached v2.28.2 on 2026-04-20). The Drone OSS line is in
  maintenance mode; the Harness CI code base absorbed it.
- Contributors: hundreds over the project's lifetime; recent Drone
  OSS releases show ~5-10 active maintainers.
- Production users: large install base predating the Harness
  acquisition; still in active use by self-hosters. The Harness CI
  Cloud product at v2.28.2 is the commercial successor.

### Killer tradeoff

Drone 2.x is the reference implementation of "container-native CI,"
and it has a decade of plugin ecosystem behind it. If OpenForge
shipped Drone 2.x as the engine, users would immediately have the
biggest plugin catalog in this category, the most documented trigger
DSL, and the smoothest Gitea integration. The hard trade is that
Drone 2.x OSS is in maintenance limbo: the original maintainer and
the rest of the core team moved into Harness CI, and the OSS repo's
velocity is low. Picking Drone 2.x in 2026 means picking a stable,
mature artifact but committing to fork-and-maintain the next time a
critical CVE or a Gitea API breaking change lands. That is a real
cost for OpenForge.

---

## 3. Buildkite

Buildkite is hybrid: a SaaS control plane, self-hosted **agents**.
This is structurally different from the others.

### Pipeline DSL

`.buildkite/pipeline.yml` is uploaded at build time by the agent
(`buildkite-agent pipeline upload`). YAML uses step types: `command`,
`wait`, `block`, `input`, `trigger`, `group`. Lifted example from
[buildkite.com/docs/pipelines/defining-steps](https://buildkite.com/docs/pipelines/defining-steps/):

```yml
steps:
  - label: ":hammer: Tests"
    command: scripts/tests.sh
    plugins:
      - docker-compose#v5.13.0:
          run: app

  - wait

  - label: ":package: Package"
    command: scripts/build-binaries.sh
    artifact_paths: "pkg/*"
    plugins:
      - docker-compose#v5.13.0:
          run: app

  - wait

  - label: ":debian: Publish"
    command: scripts/build-debian-packages.sh
    artifact_paths: "deb/**/*"
    branches: "main"
    agents:
      queue: "deploy"

  - block: ":shipit: Release"
    branches: "main"

  - label: ":github: Release"
    command: scripts/build-github-release.sh
    artifact_paths: "releases/**/*"
    branches: "main"
```

Step dependencies are **declared per-step via `depends_on`** (and
documented at the Buildkite docs), not via a top-level DAG.

### Trigger model

Hybrid. The control plane is SaaS; webhooks from GitHub (via the
Buildkite GitHub App) trigger builds. For non-GitHub SCMs, webhooks
must be configured manually via the Repository Providers page. There
is also a GraphQL/REST API to trigger builds programmatically
([buildkite.com/docs/apis/rest-api/pipelines](https://buildkite.com/docs/apis/rest-api/pipelines)).
No polling fallback is exposed; the SaaS control plane is the
authority.

### Step / job abstraction

Steps are **scripts on an agent**, not "containers in a pipeline."
A step's `command:` is a shell command (or script path) run by the
agent on its host. The plugin system hooks into the agent's hook
lifecycle (pre-checkout, checkout, post-checkout, pre-command, etc.),
not into the YAML pipeline. Containers are typically brought in via
plugins (e.g. `docker-compose`) or by running on an agent that already
has Docker installed.

### Plugin / step marketplace

Yes. Plugins are version-pinned in the YAML (`docker-compose#v5.13.0`).
The official index is at
[buildkite.com/docs/pipelines/integrations/plugins](https://buildkite.com/docs/pipelines/integrations/plugins)
and is centrally published by Buildkite. Plugins are Git repos with
a defined `plugin.yml` schema that the agent pulls at build time.

### Runner model

Self-hosted **agents** (`buildkite-agent`) register with the SaaS
control plane. Agents are persistent and tagged with arbitrary tags
(`os=linux`, `queue=deploy`, etc.); command steps match via the
`agents:` key in YAML
([buildkite.com/docs/agent/cli/reference/start](https://buildkite.com/docs/agent/cli/reference/start#agent-targeting)).
Agents can be Elastic Stack-based (ephemeral, on demand) or
long-lived. The agent itself is MIT-licensed Go.

### Secret model

Secrets are managed in the SaaS control plane (per-pipeline key-value
secrets plus OIDC tokens fetched at build time via `oidc request-token`).
Agents pull secrets at runtime; the agent has recently added
secret-redaction logic in build logs (the
`buildkite-agent secret get --format env` output is redacted even with
apostrophes per v4.7.0 release notes, see
[github.com/buildkite/agent/releases/tag/v4.7.0](https://github.com/buildkite/agent/releases/tag/v4.7.0)).
Per-pipeline secret scope; team-level secret scoping exists in the
control plane. OIDC short-lived credentials for AWS/GCP/Azure are a
first-class flow (Buildkite's `oidc` command).

### Cache model

Cache is implemented as commands (`buildkite-agent cache save`,
`cache restore`) the agent exposes. The agent stores caches by key on
whatever backend the user wires up — typically S3, with the keys
declared in YAML (`plugins: - cache#v1: ...`). Recent v4.9.0 added
`--download-timeout` to limit restore time
([github.com/buildkite/agent/releases/tag/v4.9.0](https://github.com/buildkite/agent/releases/tag/v4.9.0)).
This is one of the cleanest cache models in the comparison.

### Artifact model

**First-class.** Steps declare `artifact_paths: "pkg/*"` (globs) and
the agent uploads to the SaaS, where they can be downloaded by later
steps via `buildkite-agent artifact download`. Retention is
configurable per-pipeline. Cross-job artifact sharing works because
artifacts are stored centrally (in the SaaS), not on the agent's
local disk.

### Matrix / parallelism

**No first-class matrix block.** Fan-out is done by generating steps
dynamically in a `pipeline.yml` upload step (the upload itself can be
scripted; see "Dynamic pipelines" at
[buildkite.com/docs/pipelines/configure/dynamic_pipelines](https://buildkite.com/docs/pipelines/configure/dynamic_pipelines)).
Steps themselves run in parallel by default if more than one agent is
available; `wait:` and `depends_on:` control ordering.

### Self-hosted posture

**Mixed / SaaS-first.** Agents are fully self-hosted — you run them
wherever you want, including fully air-gapped. The control plane is
SaaS-only (there is no self-hosted Buildkite Server anymore; that
product was retired). "Self-hosted" in Buildkite-land means
self-hosted **execution** but SaaS **control**. If OpenForge wanted
the control plane in its own product, Buildkite is not viable without
a contract.

### License / maturity

- License: agent is **MIT** ([github.com/buildkite/agent](https://github.com/buildkite/agent));
  the SaaS control plane is proprietary.
- Latest agent release: **v4.9.0 on 2026-10-30**
  ([github.com/buildkite/agent/releases/tag/v4.9.0](https://github.com/buildkite/agent/releases/tag/v4.9.0));
  a long-lived v3.138.x LTS line runs in parallel (v3.138.2 on
  2026-10-20)
- Cadence: ~weekly-to-biweekly agent releases
- Contributors: a paid Buildkite engineering team plus external
  contributors (the v4.9.0 release notes show ~7 named committers)
- Production users: Shopify, Coinbase, Airbnb, Lyft, Pinterest,
  others (Buildkite's published customer list — verified via
  [buildkite.com/customers](https://buildkite.com/customers))

### Killer tradeoff

Buildkite has the best-in-class cache and artifact model in this
comparison, and the cleanest agent architecture. If OpenForge wanted
the **agent half** of Buildkite — the binary, the plugin system, the
cache, the artifact handling — and bolted it onto OpenForge's own
control plane, that would be a very competitive CI. The trade is
that Buildkite's YAML and trigger model are deeply coupled to the
SaaS API surface (the `buildkite-agent pipeline upload` step is the
load-bearing primitive). Standing up a Buildkite-compatible server
in OpenForge would mean re-implementing substantial portions of the
control plane. There is no longer a self-hosted Buildkite Server
product. So Buildkite is a "borrow ideas and a few files" pick, not
a "ship it" pick.

---

## 4. Concourse CI

Concourse is the "pipelines-as-resource-graphs" engine from the
Pivotal/Cloud Foundry lineage. It is the most opinionated engine in
this comparison.

### Pipeline DSL

Pipeline config is a YAML document with `jobs:`, `resources:`,
`resource_types:`, `var_sources:`, optional `groups:`. Lifted
example of a pipeline + job from the docs
([concourse-ci.org/docs/pipelines](https://concourse-ci.org/docs/pipelines/)
+ [concourse-ci.org/docs/jobs](https://concourse-ci.org/docs/jobs/)):

```yaml
jobs:
  - name: build
    plan:
      - get: my-repo
        resource: git-resource
        trigger: true
      - task: build-bin
        config:
          platform: linux
          image_resource:
            type: registry-image
            source: {repository: golang, tag: '1.21'}
          inputs:
            - name: my-repo
          outputs:
            - name: built-image
          run:
            path: my-repo/ci/build
            args: [.]
  - name: ship
    plan:
      - get: built-image
        passed: [build]
      - put: my-image
        params: {image: built-image/image.tar}

resources:
  - name: my-repo
    type: git
    source: {uri: https://github.com/octocat/hello-world.git}

resource_types:
  - name: git-resource
    type: registry-image
    source: {repository: concourse/git-resource}

groups:
  - name: main
    jobs: [build, ship]
```

A job's plan is a sequence of *steps* (`get`, `task`, `put`,
`set_pipeline`, `load_var`, `in_parallel`, `do`, `try`,
modifier+hooks) from
[concourse-ci.org/docs/steps](https://concourse-ci.org/docs/steps/).

### Trigger model

Concourse is **polling-based**, not webhook-based. Resources have a
`check` interval; the `resource checker` periodically calls into the
SCM and detects new versions; the scheduler queues a new build when
all inputs of a job have new versions
([concourse-ci.org/docs/jobs](https://concourse-ci.org/docs/jobs/)). A
`get` step can opt into `trigger: true` to enqueue a build when a new
version is available. `time` resource type gives cron-like triggers.
Manual triggering via UI / `fly trigger-job`.

### Step / job abstraction

Jobs are atomic units; each job's `plan` is a DAG of step types:
`get` (fetch a resource version), `task` (run a containerized
function with inputs → outputs), `put` (publish a new resource
version). Modifier steps (`in_parallel`, `do`, `try`, `across`,
`timeout`, `attempts`, `tags`) compose plans. Each `task` is a
container image with declared `inputs`/`outputs`/`params`/`caches`/
`container_limits`.

### Plugin / step marketplace

Not exactly a marketplace; Concourse has **resource types** (similar to
plugins for the `get`/`put` layer) and a registry for those at
[resource-types-list](https://concourse-ci.org/resource-types-list/).
They are Docker images exposing `/opt/resource/{check,in,out}` scripts
following a documented contract
([concourse-ci.org/docs/resource-types](https://concourse-ci.org/docs/resource-types/implementing/)).
The "bundled" resources ship with the release (git, registry-image,
s3, github-release, semver, time, etc., listed in every release notes;
[v8.3.0](https://github.com/concourse/concourse/releases/tag/v8.3.0)
shows 12).

### Runner model

**Workers** register with the ATC (web) node over a forward-only
SSH-style key exchange
([concourse-ci.org/docs/install/running-worker](https://concourse-ci.org/docs/install/running-worker/)).
Workers advertise `platform` (linux/darwin/windows) and arbitrary
`tags`; jobs declare their tags via `tags: [...]`
([concourse-ci.org/docs/jobs#tags](https://concourse-ci.org/docs/jobs/)).
A worker's Garden backend runs containers (houdini for Windows,
containerd for Linux). Workers are persistent.

### Secret model

Concourse has no native secret DB. Instead, it relies on an external
**credential manager** plugged into the ATC. The cred manager expands
`((var-name))` placeholders inside the pipeline YAML at runtime. Backends:
- AWS Secrets Manager, AWS SSM, CyberArk Conjur, CredHub, IDToken (OIDC),
  Kubernetes Secrets, HashiCorp Vault
  ([concourse-ci.org/docs/operation/creds](https://concourse-ci.org/docs/operation/creds/)).
For example `((myuser))` / `((mypass))` in a `registry-image` source
becomes a vault read at job start. Redaction and caching are built in
([concourse-ci.org/docs/operation/creds/redacting](https://concourse-ci.org/docs/operation/creds/redacting/)).

Per-job `params:` are the closest thing to a "built-in secret" — they
are local vars scoped to the task, not pulled from an external store.

### Cache model

First-class per-task. A task declares:

```yaml
caches:
  - path: project-src/node_modules
```

Caches are scoped to the **worker** the task ran on, plus the
`(job-name, step-name, cache-path)` tuple; cache hit requires the same
worker, same job, same step, same path
([concourse-ci.org/docs/tasks](https://concourse-ci.org/docs/tasks/)).
Workers can be cleared via `fly clear-task-cache`. Caches are
intentionally non-shared between workers, by design.

### Artifact model

First-class and central. Tasks declare `inputs:` and `outputs:` by
name; the same names show up as `get` steps in subsequent jobs.
Outputs are uploaded to the **ATC** (web node) and served to workers
on demand via the BaggageClaim volume driver. This means
artifact-pipeline-flow is built in: `task A → output → get → task B`.
There is no retention knob; artifacts are tied to the build that
produced them and GC'd with the build.

### Matrix / parallelism

`across` modifier runs a sub-plan in parallel over a list of values
(see [concourse-ci.org/docs/steps/modifier-and-hooks/across](https://concourse-ci.org/docs/steps/modifier-and-hooks/across/)).
`in_parallel` runs sibling steps in parallel. No `matrix:` block in
the GitHub-Actions sense; fan-out is explicit and tagged.

### Self-hosted posture

**First-class.** Concourse is one of the few CI engines that runs
**fully air-gapped** and was designed for that. Single-tenant binary
distribution with separate `concourse web` and `concourse worker`
processes. Multiple install guides including systemd and docker-compose
([concourse-ci.org/docs/install/guides/docker-compose](https://concourse-ci.org/docs/install/guides/docker-compose/)).
Kubernetes operator exists; `helm` chart is a third-party community
artifact, not a first-party install guide. There is no SaaS offering
from the project itself; commercial support is via a third party
(ConcourCI-the-company is no longer the canonical sponsor — see
release-naming).

### License / maturity

- License: **Apache-2.0** ([github.com/concourse/concourse/blob/main/LICENSE](https://github.com/concourse/concourse/blob/main/LICENSE);
  the docs footer carries "Copyright © 2026 The Linux Foundation")
- Latest release: **v8.3.2 on 2026-10-23**
  ([github.com/concourse/concourse/releases/tag/v8.3.2](https://github.com/concourse/concourse/releases/tag/v8.3.2))
- Cadence: ~monthly minor releases; active LTS branches maintained
  in parallel (v8.3.x is current, prior lines maintained for
  security backports)
- Contributors: ~13 named contributors in v8.3.0
  ([github.com/concourse/concourse/releases/tag/v8.3.0](https://github.com/concourse/concourse/releases/tag/v8.3.0));
  cumulative hundreds over the project's lifetime
- Production users: historically Pivotal/Cloud Foundry, Bloomberg,
  Comcast, IEX, the wider Cloud Foundry ecosystem; the public
  pipeline at [ci.concourse-ci.org](https://ci.concourse-ci.org/) runs
  Concourse CI on itself

### Killer tradeoff

Concourse is the only engine in this comparison that **rejects the
whole "plugins as opaque containers" abstraction** in favor of
resources, tasks, and a real artifact graph. The pipeline YAML is
verbose and the model has a steep learning curve, but in return you
get first-class cache, first-class artifact flow, fan-in/fan-out that
actually models data dependencies, and an external-credential-manager
model that lets secrets never live inside Concourse at all. The
trade is user-facing complexity: a user who wants "build a Docker
image and push to GHCR" writes ~30 lines of pipeline YAML where
Woodpecker or Drone would write 8. For OpenForge that may be
acceptable for power users and unacceptable for the long tail.

---

## 5. Tekton

Tekton is the Kubernetes-native CI/CD framework under the CD
Foundation. It is the most ambitious and most infra-shaped option.

### Pipeline DSL

Two-layer: **Task** (a Kubernetes Pod with steps) and **Pipeline**
(a DAG of Tasks). YAML manifests with `apiVersion: tekton.dev/v1`,
`kind: Task` or `kind: Pipeline`, applied via `kubectl`. Lifted
Pipeline + TaskRun example from the docs
([tekton.dev/docs/pipelines/pipelines](https://tekton.dev/docs/pipelines/pipelines/)):

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: pipeline-with-parameters
spec:
  params:
    - name: context
      type: string
      default: /some/where/or/other
    - name: flags
      type: array
  tasks:
    - name: build-skaffold-web
      taskRef:
        name: build-push
      params:
        - name: pathToDockerFile
          value: Dockerfile
        - name: pathToContext
          value: "$(params.context)"
        - name: flags
          value: ["$(params.flags[*])"]
```

Each TaskRun materializes a Pod; the Steps in the Task are containers
in that Pod, scheduled by Kubernetes
([tekton.dev/docs/pipelines/tasks](https://tekton.dev/docs/pipelines/tasks/)).

### Trigger model

Tekton does **not** ship a webhook/SCM listener. That role is filled
by **Tekton Triggers** (`EventListener`, `TriggerBinding`,
`TriggerTemplate`, `ClusterInterceptor`) — a separate CRD set
([tekton.dev/docs/triggers](https://tekton.dev/docs/triggers/)).
Interceptors can filter payloads (CEL expressions are now first-class).
Alternatively, the **Pipelines-as-Code** subproject
([pipelinesascode.com](https://pipelinesascode.com/)) integrates
directly with GitHub/GitLab webhooks and is what most modern Tekton
installs actually run. Pipelines-as-Code uses `.tekton/*.yaml` files
in the repo; the controller detects them.

### Step / job abstraction

**Steps** inside a Task are containers in a Pod, executed sequentially.
**Sidecars** run alongside (sidecar pattern).
**StepActions** (introduced in v1, replacing the older "step template"
hack) are reusable, addressable step fragments referenced by `ref:`.
**Custom Tasks** are CRD-backed extensibility points — Tekton itself
ships `ClusterResolver`, `GitResolver`, `HubResolver`, etc.
([tekton.dev/docs/pipelines/resolvers](https://tekton.dev/docs/pipelines/resolvers/))
that let a `taskRef:` point to a remote bundle, a git repo, or an OCI
artifact, fetched at run time.

### Plugin / step marketplace

Not a single marketplace. Tekton has the **Tekton Hub**
([hub.tekton.dev](https://hub.tekton.dev/)) for cataloged reusable
Tasks; Pipelines-as-Code has its own catalog; and **Tekton Bundles**
(OCI images containing task YAMLs) are the distribution primitive.
The Hub is curated; Bundles are self-hosted.

### Runner model

There is no "runner." A `TaskRun` is a Kubernetes Pod; `PipelineRun`
is a Kubernetes controller reconciling the resulting CRDs. Pods
schedule onto any node that matches the PodSpec; **Workspaces**
abstract the volume claim
([tekton.dev/docs/pipelines/workspaces](https://tekton.dev/docs/pipelines/workspaces/)).
Sources for workspaces: `emptyDir`, `persistentVolumeClaim`,
`volumeClaimTemplate` (created per PipelineRun), `configMap`,
`secret`, `projected`, `csi`. Sharing works between Tasks via PVC
backed workspaces; the Affinity Assistant pattern
([tekton.dev/docs/pipelines/affinityassistants](https://tekton.dev/docs/pipelines/affinityassistants/))
ensures co-location when needed.

### Secret model

Kubernetes-native. Secrets come from Kubernetes `Secret` objects:
mounted into Workspaces as read-only volumes
([tekton.dev/docs/pipelines/workspaces](https://tekton.dev/docs/pipelines/workspaces/#secret)),
projected into Pod env vars via `envFrom: secretRef` (standard
Kubernetes), or fetched via Service Account credentials. Tekton adds
the **IDToken** model: short-lived OIDC tokens issued to the TaskRun's
ServiceAccount, exchanged with an external IdP (Vault, AWS, GCP,
Azure, GitHub) for short-lived cloud credentials
([tekton.dev/docs/pipelines/auth](https://tekton.dev/docs/pipelines/auth/)).
The result is that long-lived cloud secrets are not stored in the
cluster at all.

### Cache model

No first-class cache object. Workarounds:

- Persistent Volume Claims per `PipelineRun` (via `volumeClaimTemplate`)
  work as caches that survive only one run
- `caching` containers in `sidecars:` for service-style caches
- The Tekton Results API + Object storage for cross-run cache:
  upload in one Task, download in next
  ([tekton.dev/docs/pipelines/artifacts](https://tekton.dev/docs/pipelines/artifacts/))

### Artifact model

Artifacts are produced by tasks writing to a Workspace, then consumed
by the next Task via the same Workspace. The `Artifacts` subsystem
handles upload/download to/from object storage (S3, GCS, OCI) using
a standard `ArtifactBucket` custom resource. There is an explicit
Artifacts doc at [tekton.dev/docs/pipelines/artifacts](https://tekton.dev/docs/pipelines/artifacts/).

### Matrix / parallelism

First-class. PipelineTask-level `matrix:` with `params:` (cross
product) and `include:` (explicit combinations), aggregating results
into an array
([tekton.dev/docs/pipelines/matrix](https://tekton.dev/docs/pipelines/matrix/)).
Default cap of 256 combinations per matrix (configurable via
`default-max-matrix-combinations-count` ConfigMap). Each combination
becomes a separate TaskRun. Conditional `when:` guards with CEL
expressions are beta.

### Self-hosted posture

**First-class**, but only on Kubernetes. There is no non-Kubernetes
deployment story. The Operator
([tekton.dev/docs/operator](https://tekton.dev/docs/operator/)) manages
the install; the Operator itself is Tekton-installed (bootstrapping
is the only slightly awkward bit). OpenShift ships
OpenShift Pipelines as a productized Tekton distribution.

### License / maturity

- License: **Apache-2.0** ([github.com/tektoncd/pipeline/blob/main/LICENSE](https://github.com/tektoncd/pipeline/blob/main/LICENSE))
- Latest release: **v1.18.0 "Ukrainian Levkoy Ultron" LTS on 2026-10-29**
  ([github.com/tektoncd/pipeline/releases/tag/v1.18.0](https://github.com/tektoncd/pipeline/releases/tag/v1.18.0))
- Cadence: ~quarterly minor releases; multiple parallel LTS branches
  (v1.18.x LTS, v1.15.x LTS, v1.12.x LTS, v1.9.x LTS, v1.6.x LTS all
  listed on the releases page)
- Contributors: cumulative ~700 across all tektoncd repos; the
  v1.18.0 release notes show ~7 named contributors, hundreds via
  dependabot/automation
- Production users: Red Hat OpenShift Pipelines (the commercial
  packaging); IBM Cloud, Google Cloud Tekton samples; countless
  internal Kubernetes-platform CI installs; the project itself runs
  on Prow + Tekton

### Killer tradeoff

Tekton is the only option here that **is Kubernetes all the way
down**, which is its biggest strength and biggest weakness. The
strength: artifacts, caches, secrets, fan-out, parallelism, and
isolation are all first-class Kubernetes primitives, which means
"scale my CI to 10,000 concurrent builds" is "scale my Kubernetes
cluster." The weakness: a user who wants to run CI on their laptop
to reproduce a failure is running Kubernetes on their laptop. The
mental model cost is high, and the YAML for a "build a Docker image"
task is meaningfully longer than Woodpecker or Drone. For OpenForge
specifically: Tekton is the best engine if OpenForge is **also**
shipping Kubernetes-native infrastructure and wants the CI to feel
like part of that platform. If OpenForge is targeting small-team
self-hosters on a single VM, Tekton is the wrong shape.

---

## 6. Prow

Prow is the Kubernetes project's own CI/CD system, designed by and
for SIG-Testing at scale. It is a GitHub-native system with an
opinionated approach to PR handling, merge automation, and chat-ops.

### Pipeline DSL

`ProwJobs` are configured in `config.yaml` in the
`kubernetes/test-infra` repo, organized under `presubmits:`,
`postsubmits:`, and `periodics:` keys. Each job entry has a raw
`spec:` that is a Kubernetes PodSpec. Lifted example from
[docs.prow.k8s.io/docs/jobs](https://docs.prow.k8s.io/docs/jobs/):

```yaml
presubmits:
  org/repo:
  - name: qux-job
    decorate: true
    always_run: true
    run_if_changed: "qux/.*"
    skip_report: true
    context: qux-job
    max_concurrency: 10
    spec: {}
    branches: []
    skip_branches: []
    trigger: "(?m)qux test this( please)?"
    rerun_command: "qux test this please"

periodics:
- name: foo-job
  decorate: true
  interval: 1h
  extra_refs:
  - org: org
    repo: repo
    base_ref: main
  spec: {}

postsubmits:
  org/repo:
  - name: bar-job
    decorate: true
    spec: {}
    max_concurrency: 10
    branches: ["^main$"]
    skip_branches: ["^release-.*$"]
```

The `decorate: true` flag is the key affordance: Prow injects
Pod Utility containers that handle clone, log capture, and artifact
upload (see [docs.prow.k8s.io/docs/components/pod-utilities](https://docs.prow.k8s.io/docs/components/pod-utilities/)).
Job specs are just `PodSpec`s, so users who write them are writing
Kubernetes manifests, not a CI DSL.

### Trigger model

Prow is **GitHub-native** (a Gerrit backend exists for non-GitHub
forks). The `hook` component listens to GitHub webhooks and creates
presubmit / postsubmit jobs. `Tide` manages merge queues and required
status contexts. `horologium` schedules periodics. The full lifecycle
is documented at [docs.prow.k8s.io/docs/life-of-a-prow-job](https://docs.prow.k8s.io/docs/life-of-a-prow-job/).

Trigger-by-comment (`/test job-name`, `/retest`, `/test all`,
`/skip`, `/override`) is a first-class interaction model; this is
where Prow is strongest and where most alternatives are weakest.

### Step / job abstraction

ProwJobs run **inside a Pod** as `containers[]`. The "steps" of a
ProwJob are the containers in the PodSpec. Sidecars (`Pod Utilities`)
are siblings that handle checkout (`clonerefs`), log/metadata upload
(`initupload`, `sidecar`), and the entrypoint logic (`entrypoint`).
There is no concept of a "plugin" — a plugin is just a container in
the spec that you wrote.

### Plugin / step marketplace

There is no third-party marketplace. Prow ships with a small set of
in-tree plugins: `approve`, `lgtm`, `hold`, `assign`, `triggers`,
`verify`, `cherrypick`, `branchcleaner`, `updateconfig`, etc. (full
list at [docs.prow.k8s.io/docs/components/plugins](https://docs.prow.k8s.io/docs/components/plugins/)).
These are **comment-driven bot behaviors**, not CI steps. CI steps
are whatever containers the user puts in the PodSpec.

### Runner model

ProwJobs run as Pods on Kubernetes clusters. Multiple build clusters
are supported — a job can target `cluster: cluster-a` via the
`cluster:` field
([docs.prow.k8s.io/docs/jobs/#running-a-prowjob-in-a-build-cluster](https://docs.prow.k8s.io/docs/jobs/#running-a-prowjob-in-a-build-cluster)).
Prow is not a runner system so much as a **ProwJob scheduler** that
schedules Kubernetes Pods. There are no labels or queues in the
Woodpecker/Drone sense; targeting is via the PodSpec's
`nodeSelector` / tolerations / affinity.

### Secret model

Prow secrets are managed by `hmac` (token signing) plus external
storage (see [docs.prow.k8s.io/docs/prow-secrets](https://docs.prow.k8s.io/docs/prow-secrets/)).
The component list includes `jenkins-operator` (an option to dispatch
to Jenkins), `branchprotector` (GitHub branch protection), and a
separate `Gangway` component for an HTTP API
([docs.prow.k8s.io/docs/components/optional/gangway](https://docs.prow.k8s.io/docs/components/optional/gangway/)).
Secrets injected into job env vars are documented per-component and
include `GITHUB_TOKEN`, cloud-provider creds, etc. Prow ships with
documented Kubernetes Secret formats, not a UI.

### Cache model

No first-class cache. The recommended pattern is to put a cache
container in the PodSpec or to use the **Spyglass** lens system to
visualize cache hits across runs. CI steps that need a warm cache
typically mount a PersistentVolume or pre-pull in an init container.

### Artifact model

Prow ships `gcsupload` as a separate component
([docs.prow.k8s.io/docs/components/optional/gcsupload](https://docs.prow.k8s.io/docs/components/optional/gcsupload/))
and `initupload` as a Pod Utility that uploads `ARTIFACTS/*` from
the job's container to GCS. Retention is whatever GCS lifecycle rules
the operator configures; Prow itself does not enforce retention.
Artifacts surface through **Spyglass**, which renders HTML "build
pages" combining logs, JUnit, coverage, and artifacts
([docs.prow.k8s.io/docs/spyglass](https://docs.prow.k8s.io/docs/spyglass/)).

### Matrix / parallelism

Prow has **no first-class matrix**. Fan-out is done by listing N jobs
in `presubmits:`/`postsubmits:`, or by scripting a script step that
emits many child jobs. Because everything is a Pod, scaling out is a
matter of listing more jobs in YAML.

### Self-hosted posture

**First-class, but Kubernetes-native and GitHub-centric.** There is
no non-Kubernetes install, and the GitHub backend is the canonical
integration. GitLab / Gerrit / Bitbucket backends exist but are
second-class. If OpenForge targets Gitea/Forgejo as the SCM, Prow's
GitHub-centricity is a serious fit problem.

### License / maturity

- License: **Apache-2.0** ([github.com/kubernetes-sigs/prow](https://github.com/kubernetes-sigs/prow))
- Latest release: Prow does not tag "releases" in the GitHub UI
  ([github.com/kubernetes-sigs/prow/releases](https://github.com/kubernetes-sigs/prow/releases)
  is empty); the project ships by tagging commits in
  `kubernetes/test-infra` and the `prow` image is rebuilt from
  `kubernetes-sigs/prow` master. Production version is whatever the
  Kubernetes project's `prow.k8s.io` instance runs, which is rebuilt
  from `kubernetes/test-infra` HEAD nightly.
- Cadence: continuous (rolling tag)
- Contributors: hundreds across SIG-Testing; the project is
  co-maintained by the Kubernetes org and a set of trusted
  approvers
- Production users: kubernetes/kubernetes (test-infra) at
  [prow.k8s.io](https://prow.k8s.io/); kubernetes-sigs/* (dozens of
  SIGs); a handful of large external users documented at
  [docs.prow.k8s.io/docs/scaling](https://docs.prow.k8s.io/docs/scaling/)

### Killer tradeoff

Prow is the only engine here whose **trigger model is PR-first**,
with `/test`, `/retest`, `/hold`, `/override`, `/lgtm`, `/approve` as
first-class GitHub-comment citizens, plus a merge-queue component
(Tide) that no other engine in this list has. If OpenForge wants
those interaction primitives, Prow is the reference. The trade is
that Prow is unapologetically Kubernetes + GitHub-shaped, with no
Gitea/Forgejo story and no first-class matrix/cache/artifacts. For
OpenForge, Prow would be the right pick only if the goal is "match
the Kubernetes CI workflow exactly" — which is unlikely to be the
goal for a self-hosted Git platform.

---

## 7. Comparison Matrix

| Attribute | Woodpecker CI | Drone 2.0 | Buildkite | Concourse CI | Tekton | Prow |
|---|---|---|---|---|---|---|
| **Pipeline DSL** | `.woodpecker.yaml`, top-level `steps:` list, DAG via `depends_on:`, matrix, services, plugins | `.drone.yml`, multi-block (`kind: pipeline / secret / trigger`), per-type runner | `.buildkite/pipeline.yml`, step-typed (command/wait/block/input/trigger/group), dynamic upload | Pipeline = `jobs[]` + `resources[]` + `resource_types[]`; each job's `plan:` is a DAG of `get`/`task`/`put`/modifiers | `Task` (Pod with steps) + `Pipeline` (DAG of Tasks), `PipelineRun` to instantiate, `tkn` CLI / PaC | `config.yaml` in test-infra, `presubmits[]/postsubmits[]/periodics[]`, raw `PodSpec` |
| **Trigger model** | Webhook (Gitea/Forgejo/GH/GL/BB) + cron + manual | Webhook + cron + promote/rollback + manual; per-pipeline `trigger:` filter | SaaS webhooks (GH via App, others manual); REST/GraphQL API for programmatic | **Polling** resources + `time` resource for cron + manual `fly trigger-job` | None in core; **Tekton Triggers** (separate) or **Pipelines-as-Code** for webhooks | GitHub webhooks via `hook` component, **comment triggers** (`/test`, `/retest`, `/override`), periodics via `horologium`, Tide merge queue |
| **Step / job abstraction** | Every step is a Docker container; plugins are a constrained subset of steps (no `commands`/`entrypoint`); `services:` for sidecars | Same — every step is a Docker container; plugins are images in `plugins/*` namespace reading `PLUGIN_*` env | Steps are **shell commands** on the agent host; containers brought in via plugins (e.g. `docker-compose`) | Jobs = atomic units, `plan:` = DAG of step types (`get`/`task`/`put`/`set_pipeline`/`load_var`/`in_parallel`/`do`/`try` + modifiers) | `Task` = Pod with sequential containers; `Sidecars`; **StepActions** (v1); **Custom Tasks** (CRD extension) for things like resolvers | `containers[]` of a PodSpec; **Pod Utilities** (`clonerefs`, `entrypoint`, `initupload`, `sidecar`) decorate jobs |
| **Plugin / step marketplace** | Yes — [woodpecker-ci.org/plugins](https://woodpecker-ci.org/plugins); Drone plugins largely compatible | Yes — [plugins.drone.io](http://plugins.drone.io), community-owned Docker namespace | Yes — Buildkite-curated plugin index, version-pinned in YAML (`docker-compose#v5.13.0`) | No; **resource types** registry at [resource-types-list](https://concourse-ci.org/resource-types-list/); 12 bundled in each release | No single marketplace; **Tekton Hub** ([hub.tekton.dev](https://hub.tekton.dev/)) + **Tekton Bundles** (OCI) + Pipelines-as-Code catalog | None; small in-tree **plugins** are comment-bot behaviors, not CI steps |
| **Runner model** | Agents **poll** server, labels (`platform`, `hostname`, `backend`, `repo`); backends: docker/local/kubernetes/exec; persistent | Runners poll server, 6 types (docker/exec/ssh/digitalocean/vm/macstadium); persistent; some ephemeral VM runners | `buildkite-agent` registers with SaaS, tags (`os`, `queue`), Elastic Stack for ephemeral; MIT agent | **Workers** register with ATC over forward-only SSH-key exchange; advertise `platform` + `tags`; persistent | None — TaskRun = Kubernetes Pod; cluster-side scheduling; multiple build clusters | None — ProwJob = Pod; multiple **build clusters** targeted via `cluster:` field |
| **Secret model** | 3 scopes (repo/org/global), `from_secret:`, **image allow-list** per secret, event filter, default-off for PRs; CLI + UI | Repo/org scope, `from_secret:`; **external backends** via runner extensions (AWS Secrets Manager, Vault, K8s); default-off for PRs | SaaS-stored secrets; **OIDC** short-lived tokens via `buildkite-agent oidc request-token`; agent-side redaction | **No native secret DB**; **credential manager** plugin (Vault, AWS SM, Conjur, CredHub, K8s secrets, IDToken/OIDC); `((var))` placeholder expanded at runtime | Kubernetes `Secret` objects + **IDToken** OIDC exchange with Vault/AWS/GCP/Azure/GitHub; long-lived cloud creds not in cluster | Kubernetes-native, no UI; per-component docs for `GITHUB_TOKEN`, HMAC tokens, cloud creds |
| **Cache model** | Not first-class; **plugins** (e.g. `plugin-cache`, S3/MinIO cache); shared workspace volume is the scratch space | Not first-class; **plugins** (`drone-s3-cache`, etc.) | **First-class** — `buildkite-agent cache save`/`restore`, key-based, plugin-configured backend (S3); v4.9.0 added `--download-timeout` | **First-class** — task-level `caches: - path: ...`, scoped to (worker, job, step, path); `fly clear-task-cache` to invalidate | Not first-class; workarounds: `volumeClaimTemplate` per PipelineRun, sidecar cache containers, artifact API | Not first-class; PV mounts, init-container pre-pull, or external cache container |
| **Artifact model** | Not first-class; plugins upload (`plugin-s3`, `plugin-artifactory`); workspace = step-to-step | Not first-class; plugins upload; workspace = step-to-step | **First-class** — `artifact_paths:` globs, agent uploads to SaaS, `buildkite-agent artifact download` for later steps, configurable retention | **First-class** — task `outputs:`, `get` to fetch; stored centrally on ATC; GC with build | **First-class** via Tekton Artifacts subsystem (`ArtifactBucket` CRD); upload/download to S3/GCS/OCI; also via shared Workspace | **First-class** via `gcsupload` component + `initupload` Pod Utility; retention = GCS lifecycle; visualized by Spyglass |
| **Matrix / parallelism** | **First-class** `matrix:` block (axis list or `include:`); limits 64 workflows / 10 vars; `depends_on:` for DAG | DAG via `depends_on:` only; no native matrix; plugins fill gap | No native matrix; fan-out via dynamic `pipeline.yml` upload; parallel by default; `wait:`/`depends_on:` for ordering | `across` modifier + `in_parallel`; explicit fan-out, tagged | **First-class** — `matrix.params[]` cross product + `matrix.include[]` for explicit combos; result aggregation via array results; default 256 combo cap | Not first-class; fan-out by listing N jobs in YAML |
| **Self-hosted posture** | **First-class** — server binary + agents; runs on Raspberry Pi | **First-class** — server binary + runners; OSS in maintenance under Harness | **Mixed** — agent self-hosted, **control plane SaaS-only** (no self-hosted Buildkite Server) | **First-class** — single-tenant binary distribution, designed for air-gap; no SaaS offering | **First-class** but **Kubernetes-only**; Operator manages install | **First-class** but **Kubernetes + GitHub-only**; no Gitea/Forgejo backend |
| **License (SPDX)** | Apache-2.0 | Apache-2.0 | Agent: MIT; control plane: proprietary | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| **Maturity** | v3.20.1 (2026-10-29); ~monthly; 30+ contributors/release; CI-on-Woodpecker | OSS in maintenance; Harness CI Cloud successor at v2.28.2 (2026-04-20); hundreds of contributors lifetime | Agent v4.9.0 (2026-10-30) + v3.138.x LTS; ~weekly; Shopify/Coinbase/Airbnb/Lyft/Pinterest | v8.3.2 (2026-10-23); ~monthly + parallel LTS branches; Pivotal/CF, Bloomberg, Comcast | v1.18.0 LTS (2026-10-29); ~quarterly + 4 parallel LTS branches; OpenShift Pipelines | No GitHub releases; continuous from `kubernetes-sigs/prow` master; runs `prow.k8s.io` itself |
| **Killer tradeoff** | Path-of-least-resistance for Drone-shaped self-hosted CI; Gitea/Forgejo first-class; but no native cache/artifacts → plugins must do the work | Biggest plugin catalog + the original reference impl, but post-acquisition OSS is in maintenance limbo; fork-and-maintain risk | Best-in-class cache + artifacts + agent, but the YAML and control plane are tightly coupled to the SaaS; no self-hosted control plane = not a "ship it" pick | Strongest data-flow model in this list (resources/tasks with first-class cache + artifacts + external cred managers); but verbose YAML and steep learning curve | Kubernetes all the way down → "scale CI = scale the cluster"; but YAML for a simple build is ~3× longer and the laptop-reproduce story is rough | PR-first with `/test`/`/retest`/`/override`/Tide merge queue that nothing else matches; but GitHub-centric and Kubernetes-only, with no Gitea/Forgejo backend |

---

## 8. Reading notes for the decision

A few cross-cutting observations the matrix doesn't capture, lifted
from the cited docs:

- **Trigger semantics differ in non-obvious ways.** Woodpecker and
  Drone are webhook-first, filter per-pipeline. Concourse is
  poll-first with resource version models. Tekton's core has no
  triggers at all — webhooks are a separate CRD. Prow's webhook is
  GitHub-shaped, with chat-ops primitives (`/test`, `/retest`)
  baked into the trigger model. Buildkite's webhook is the SaaS
  control plane's job. The user-facing trigger contract is a
  meaningful part of "what OpenForge ships."

- **Secret rotation posture varies.** Woodpecker and Drone assume
  secrets live in a DB the server manages. Concourse explicitly
  refuses to store secrets — they must live in an external cred
  manager. Tekton favors Kubernetes Secrets + IDToken. Buildkite
  has a managed secret store plus OIDC. Prow is Kubernetes Secret +
  ad-hoc. OpenForge's choice here is a security posture decision
  as much as a feature decision.

- **Artifact retention is rarely explicit.** Concourse GCs artifacts
  with the build. Buildkite has configurable retention. Tekton
  delegates to the storage backend's lifecycle rules. Woodpecker /
  Drone delegate to whatever the plugin uploads to. Prow delegates
  to GCS lifecycle. If OpenForge ships with hard retention
  defaults, it should pick an engine whose model matches the
  default, not bolt it on later.

- **Self-hosted posture is a one-way door.** Five of the six are
  first-class self-hosted. Buildkite is not, today. If OpenForge's
  sales pitch is "the self-hosted Git platform," a SaaS-coupled CI
  engine is a category error, regardless of how good the rest is.

- **Plugin ecosystems are non-overlapping.** Woodpecker inherits
  Drone's plugins (mostly). Buildkite plugins are Buildkite-shaped.
  Concourse resource types follow a `check/in/out` HTTP contract.
  Tekton tasks are CRDs. Prow steps are containers. There is no
  clean way to share plugins across these engines. The decision
  locks OpenForge into one plugin ecosystem.

---

## 9. Recommendations (out of scope but flagged)

The 12-attribute comparison gives the data; the recommendation is
deliberately deferred to a separate decision doc because the
OpenForge runner architecture decision needs to weigh these against
OpenForge's own constraints (the `act_runner` fork is already
familiar, Gitea/Forgejo is the target SCM, and the team already
has CI-on-Woodpecker experience per the file
[openforge-research-ci-engines.md](openforge-research-ci-engines.md)
in this repo).

Two concrete picks to investigate further, given the constraints:

1. **Woodpecker CI** as the engine — shallowest delta from the
   current `act_runner` candidate, Gitea/Forgejo first-class,
   Apache-2.0, active release cadence. Cost: cache/artifact work is
   plugin-orchestrated.

2. **Concourse CI** as the orchestration backbone — strongest
   data-flow model in the list, first-class cache/artifacts,
   external-only secrets. Cost: YAML verbosity and learning curve;
   no built-in matrix; opinionated user experience.

These two should be prototyped against a representative OpenForge
pipeline (a real `.forgejo/workflows/*.yml` translated into each)
before any runner architecture is committed.

---

## Sources

Primary documentation cited inline:

- Woodpecker CI: [woodpecker-ci.org/docs](https://woodpecker-ci.org/docs/),
  [github.com/woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker)
- Drone 2.0: [docs.drone.io](https://docs.drone.io/),
  [github.com/drone/drone](https://github.com/drone/drone),
  [github.com/harness/drone-cli](https://github.com/harness/drone-cli)
- Buildkite: [buildkite.com/docs](https://buildkite.com/docs/),
  [github.com/buildkite/agent](https://github.com/buildkite/agent)
- Concourse CI: [concourse-ci.org/docs](https://concourse-ci.org/docs/),
  [github.com/concourse/concourse](https://github.com/concourse/concourse)
- Tekton: [tekton.dev/docs](https://tekton.dev/docs/),
  [github.com/tektoncd/pipeline](https://github.com/tektoncd/pipeline),
  [pipelinesascode.com](https://pipelinesascode.com/)
- Prow: [docs.prow.k8s.io](https://docs.prow.k8s.io/),
  [github.com/kubernetes-sigs/prow](https://github.com/kubernetes-sigs/prow),
  [prow.k8s.io](https://prow.k8s.io/)

Where this document makes a claim without a direct citation, treat
it as needing a second source before it is load-bearing in the
decision.
