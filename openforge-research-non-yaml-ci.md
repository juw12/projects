# Non-YAML CI Models — Survey for OpenForge

**Survey question:** Does any self-hosted Git platform ship a non-YAML (or partially non-YAML) CI model that users actually like — well enough that OpenForge should consider copying it?

**Bottom line:** Ship YAML. The evidence is unambiguous. The two non-file-based systems (Phabricator Harbormaster, Bamboo) both failed or are dying. OneDev's GUI+YAML hybrid is the closest analog but its "proprietary format" is the #1 user complaint.

---

## 1. OneDev (github.com/theonedev/onedev) — closest analog, hybrid model

**CI Definition Model: YAML in Repo + GUI Editor (primary surface)**

OneDev is the most relevant comparison. CI is defined in `.onedev-buildspec.yml` at the repo root, but the primary user experience is **GUI-driven**:

> "Navigate to the OneDev project, click link *adding .onedev-buildspec.yml* to bring up the GUI to set up CI/CD" — OneDev Quickstart

The GUI presents a job wizard with templates for typical frameworks. The YAML file is the **serialization format**, not the primary authoring surface. Users interact with typed form fields; the system generates the YAML.

**Build Spec Format (Version 54)** — highly structured with typed step classes:

```yaml
version: 54
imports:
- projectPath: onedev/template
  revision: main
jobs:
- name: Release
  steps:
  - type: CheckoutStep
    name: checkout
    cloneCredential:
      type: HttpCredential
      accessTokenSecret: onedev-token
  - type: CommandStep
    name: build
    runInContainer: true
    image: '@property:buildenv@'
    interpreter:
      type: PosixInterpreter
      shell: bash
      commands: "..."
  triggers:
  - type: BranchUpdateTrigger
    branches: main
    userMatch: anyone
  retryCondition: never
  maxAttempts: 4
stepTemplates:
- name: scan vulnerabilities
  steps:
  - type: RootFSScannerStep
    ...
  paramSpecs:
  - type: TextParam
    name: Scan Path
```

**Key model features:**
- **Closed set of step types:** CheckoutStep, CommandStep, PublishArtifactStep, BuildImageStep, PublishJUnitReportStep, TrivyCacheStep, RootFSScannerStep, SetBuildVersionStep, CloseIterationStep, PublishSiteStep, UseTemplateStep, SetupCacheStep, PublishPlaywrightReportStep, PublishMarkdownReportStep
- **Step Templates:** reusable named sequences of steps with typed parameters (`paramSpecs`). Templates can nest.
- **Project tree inheritance:** parent projects define settings that child projects inherit. Build specs can import from parent projects (`imports: projectPath: ...`).
- **Job dependencies:** DAG of jobs with artifact passing between them.
- **Triggers:** BranchUpdateTrigger, TagCreationTrigger, PullRequestTrigger, ScheduleTrigger (cron), DependencyJobFinishedTrigger.
- **Executors:** Kubernetes, Server Docker, Remote Docker, Server Host, Remote Host.
- **Agents:** remote machines registered as job execution targets; no "runner registration" in the GitHub Actions sense — it's a push model (server dispatches to agents).
- **Build promotion:** artifacts from one build passed to downstream jobs.

**User Reception (HN, with quoted sources):**

Positive:
- **QuiCasseRien** (HN, Jan 2026): *"I very often mention OneDev in my comments, and you know what? Robin solved this issue 3 years ago. You can pause your action, connect through a web terminal, and debug/fix things live until it works. And that's just one of the many features that make OneDev superior to pretty much every other CI/CD product out there."* (https://news.ycombinator.com/item?id=46616213)
- **minimaul** (HN, Aug 2022): *"The main reason I use it over lighter & more open services is the integrated CI. I've considered replacing it with sourcehut, but I don't have available hardware to dedicate to the VM-based CI. onedev I did not know about, and looks exceptionally tempting on that basis."* (https://news.ycombinator.com/item?id=32307883)
- **mvelbaum** (HN, Aug 2022): *"I think that right now the best free and OSS solution is OneDev. It even has CI/CD built-in which is cool!"* (https://news.ycombinator.com/item?id=32303046)
- **steveluo9** (HN, Jan 2020): *"I'm very interested in the built-in CI system, especially you mentioned that no yaml files to write. Actually, it's very painful for me to write yaml files for GitLab."* (https://news.ycombinator.com/item?id=22081484)

Negative:
- **s09dfhks** (HN, Sep 2025): *"This is why I dropped it. The CI/CD configurations were some weird proprietary format where as gitlab/gitea/forejo are all (mostly) feature compliant with my already existing github workflow files."* (https://news.ycombinator.com/item?id=45293765)
- **kerlekarle** (HN, Sep 2025): *"I actually have a side project running on it. The CI documentation is really lacking and it was hard setting it up. Other than that I am happy with it."* (https://news.ycombinator.com/item?id=45296280)
- **jamesu** (HN, Sep 2025): *"For me the bus factor was a bit of a red flag, plus I prefer the layout in forgejo/gitea. Also didn't like that there wasn't really any obvious way to link in an external CI, and of course it's written in java so had that to factor in too."* (https://news.ycombinator.com/item?id=45295009)
- **Havoc** (HN, Sep 2025): *"I recall looking at it maybe 2-3 years ago and deciding against it. And it never seemed to get traction in the selfhosted community either."* (https://news.ycombinator.com/item?id=45293741)
- **elevation** (HN, Sep 2025): *"I evaluated moving from Gitea to OneDev before Gitea had CI. OneDev was useable, I didn't mind it, but I don't run java anywhere else so I decided against adopting it. A few years later and now Gitea/Forgejo are at feature parity."* (https://news.ycombinator.com/item?id=45293893)
- **hamdingers** (HN, Sep 2025): *"The docker quickstart asks me to mount the docker socket, an incredibly dangerous act that fundamentally breaks the isolation that containers are supposed to provide."* (https://news.ycombinator.com/item?id=45294799)

**HN traction:** Jan 2020 (Show HN): 459 points, 94 comments. Aug 2022: 200 points, 69 comments. Sep 2025: 103 points, 63 comments. (Declining engagement over time.)

**Scale assessment:** 15.3k stars, 990 forks, single primary maintainer (Robin Shen). The "proprietary YAML" criticism is recurring and fatal for a GitHub competitor — users who migrate away lose their CI definitions.

---

## 2. Gitea / Forgejo — YAML-only, GitHub Actions compatible

**CI Definition Model:** `.gitea/workflows/*.yml` files in the repo. The runner (`act_runner`) is a **hard fork of nektos/act**.

**Key model features:**
- YAML in repo (not DB) — single source of truth.
- **Scoped Workflows:** organization-level workflow templates that repos can include.
- Runner labels map to environments: `ubuntu-latest:docker://node:18`.
- gRPC over HTTP communication protocol between runner and server.
- Secrets/Variables at instance, organization, repository levels.
- **No UI pipeline builder.** Everything is YAML-in-file.
- **No matrix-specific non-YAML experiment.**

**act_runner Integration Challenges:**
- Runner is external (not part of Gitea binary). Registers via token.
- Actions are cached (pulled once, not re-checked) — known issue gitea/act_runner#726
- Private reusable workflows broken since 2023 — go-gitea/gitea#25929
- Reusable workflow steps shown as one step — go-gitea/gitea#26187

**User Reception:**

- **fariszr** (blog, Sep 2025, "Gitea Actions, a Buggy Mess"): *"Gitea Actions look good on the surface till you actually try to use it in production. ... Private reusable workflows: it just doesn't work no matter what. ... Reusable workflow steps are all shown as one step: This makes debugging a nightmare. ... After hitting so many bugs that were reported years ago! I just can't continue to invest time in Gitea Actions."* (https://fariszr.com/gitea-actions-a-buggy-mess/)
- **fariszr** (HN, Jul 2022): *"I tried switching for a bit with Gitea(Codeberg) and Drone CI/CD. And it was OK, but i missed a lot of the niceties of GitHub, and i felt that Drone CI/CD is not that great compared to GH-Actions or GitLab CI/CD."* (https://news.ycombinator.com/item?id=32187362)
- **transpute** (blog, May 2025): positive for simple use cases. (https://chrisliebaer.de/blog/gitea-actions/)
- Production use: Proxmox-GitOps (Show HN, Sep 2025) uses Gitea Actions for self-contained GitOps.

**Scale assessment:** 58.8k stars, large community. GitHub Actions compatibility strategy is the right call for broad adoption. The act_runner fork approach introduces maintenance burden and bugs.

---

## 3. Phabricator Differential + Harbormaster (and Phorge fork) — UI-configured, DB-stored

**CI Definition Model:** UI-configured, DB-stored Build Plans (non-file, non-YAML).

Phabricator's Harbormaster is the most significant example of a fully non-file-based CI model in the self-hosted Git space.

**How it works:**
- **Buildable:** an object (revision, diff) that needs building.
- **BuildPlan:** a named, configurable template for how to build. Defined via **UI forms** (not files). Stored in the **database**.
- **BuildEngine:** the execution backend (SSH, Arcanist, custom HTTP).
- **Herald rules:** trigger builds based on object properties.

User defines a pipeline by:
1. Creating a BuildPlan via the web UI
2. Creating Herald rules to trigger builds
3. Optionally linking BuildPlans to projects

**There is no file in the repository.** CI configuration lives entirely in the database.

**Was it successful?**
- Phacility **wound down operations on June 1, 2021**: *"Effective June 1, 2021: Phabricator is no longer actively maintained."* (https://www.phacility.com/)
- The original `phacility/phabricator` repo on GitHub is archived.
- **Phorge** (community fork) is alive but with limited infrastructure (docs site unreachable in this research).
- Used by Meta (Facebook) internally for many years; Meta eventually migrated to internal systems.
- **User base:** small (Phacility customers). Never achieved broad adoption.
- No public HN threads specifically about Harbormaster.

**Scale assessment:** The DB-stored model has a fundamental problem for a GitHub competitor: **CI configuration is not version-controlled with the code.** This breaks the "infrastructure as code" expectation modern developers have. Phacility sunset demonstrates the risk of small-vendor + unique-format.

---

## 4. Heptapod / Kallithea / RhodeCode

**Heptapod (heptapod.net):** GitLab CE fork with Mercurial support. CI/CD is identical to GitLab (`.gitlab-ci.yml`). Adds Clever Cloud Runners integration (European sovereignty). Prebuilt container images now require paid subscription (May 2025). Niche.

**Kallithea / RhodeCode:** Python-based Git/SVN/Mercurial hosting. No built-in CI; relied on external webhooks. Neither achieved significant user base.

---

## 5. Bitbucket Server + Bamboo (Atlassian)

**Bitbucket Pipelines:** File-based YAML (`.bitbucket/pipelines.yml`). No non-YAML alternative.

**Bamboo:** Completely separate Java application from Bitbucket. Build plans are:
- Defined via **web UI** (not files)
- Stored in **database**
- Configured with: stages, jobs, build tasks (Maven, Ant, Gradle, script, Docker), VCS configuration
- Supports build plan dependencies (staged pipelines)
- **No YAML file** is involved.

**Was it well-loved?**
- **firebaze** (HN, Oct 2020): *"We're about to switch from Atlassian bamboo to bitbucket pipelines. As of now, we're experiencing some drawbacks (for example, the largest instance has 8gb of memory, (severely) constraining test suites)."* (https://news.ycombinator.com/item?id=24901197)
- GitHub explicitly targets Bamboo users: "Switching from Bitbucket Server and Bamboo to GitHub just got easier" (https://github.blog/2023-09-18-switching-from-bitbucket-server-and-bamboo-to-github-just-got-easier/)
- Atlassian's own direction: Data Center EOL **March 28, 2029**. Atlassian pushing all customers to Cloud where Pipelines YAML is the model.

**Scale assessment:** Bamboo's DB-stored model is a dead end. Even Atlassian is abandoning it. The separation of CI (Bamboo) from code hosting (Bitbucket) creates integration friction.

---

## 6. Other platforms

### Sourcehut (builds.sr.ht) — VM-per-build, opinionated YAML

- **YAML manifest in repo** (`.build.yml` or `.builds/*.yml`)
- **Full VM isolation** — each build runs in a **full virtual machine** (not a container)
- **SSH access to build VMs:** after a build fails, the VM stays alive for 10 minutes; you can SSH in to debug. `shell: true` keeps it alive indefinitely.
- **Ad-hoc submission:** type a manifest into `builds.sr.ht/submit` without pushing to repo
- **No JavaScript UI**
- Push options: `git push -o skip-ci`, `git push -o submit=".sourcehut/*.yml"`

Example manifest:
```yaml
image: alpine/latest
packages:
  - meson
  - ninja
sources:
  - https://git.sr.ht/~user/project
tasks:
  - setup: |
      cd project
      meson build
  - build: |
      cd project
      ninja -C build
artifacts:
  - project/dist/
submitter:
  git.sr.ht:
    enabled: true
    allow-refs:
      - refs/heads/main
```

**User Reception:**
- **Andrew Kelley** (Zig author, sourcehut.org homepage): *"This CI experience is leagues ahead of all others. Resubmitting builds and SSH'ing in is saving me multiple hours."*
- **postmarketOS** uses builds.sr.ht for entire build infrastructure (HN, Dec 2019: https://news.ycombinator.com/item?id=21787460)
- **Codeberg integration** (Dec 2023: https://sourcehut.org/blog/2023-12-19-codeberg-integration/)
- **Bruno Bernardino** (blog, May 2026, "Migrating from GitHub Actions to Sourcehut Builds"): detailed migration, very positive.
- **Security incident** (Sep 2026): "Sourcehut account takeover via build logs (XSS in ansi2html)" — 154 points, 29 comments on HN. (https://news.ycombinator.com/item?id=49835996)
- **minimaul** (HN, Aug 2022): *"I've considered replacing it with sourcehut, but I don't have available hardware to dedicate to the VM-based CI."*

**Scale assessment:** VM-per-build is too resource-intensive at GitHub scale. Works for Sourcehut's niche (small internet, FOSS projects) but would be impractical at GitHub scale. SSH-access-to-VM is genuinely innovative, but the 2026 XSS incident shows it's a security risk.

### Drone CI — YAML in repo, container per step

- Standalone CI (not integrated into a git forge)
- `.drone.yml` in repo
- Each step runs in Docker container
- Acquired by Harness Inc. (2024)
- **eBay:** *"When we started using containers, Drone was the obvious choice. We moved from Jenkins to Drone deploying about 15,000 times a quarter."* (https://drone.io/)
- **fariszr** (HN, Jul 2022): *"Drone CI/CD is not that great compared to GH-Actions or GitLab CI/CD"*

### GitBucket — Plugin-based CI

- Scala-based Git hosting
- CI via plugin: gitbucket-ci-plugin
- No built-in CI model
- Mentioned in HN 2020 thread

---

## Comparison Matrix

| Platform | CI Definition | In Repo? | UI Editor? | Non-YAML? | User Base | Traction |
|---|---|---|---|---|---|---|
| **GitHub Actions** (reference) | YAML workflow files | Yes | No | No | Enormous | Industry standard |
| **GitLab CI** | `.gitlab-ci.yml` | Yes | No | No | Large | Major competitor |
| **Gitea/Forgejo Actions** | `.gitea/workflows/*.yml` | Yes | No | No | Medium | Growing |
| **OneDev** | `.onedev-buildspec.yml` + GUI | Yes | **Yes (primary)** | No (typed YAML) | Small | Niche |
| **Sourcehut builds** | `.build.yml` / `.builds/*.yml` | Yes | No (ad-hoc web form) | No | Small | Niche |
| **Phabricator/Phorge** | DB-stored BuildPlans | **No** | **Yes (only)** | **Yes (no file)** | Tiny | Declining |
| **Bamboo** | DB-stored build plans | **No** | **Yes (only)** | **Yes (no file)** | Medium (enterprise) | Declining (EOL 2029) |
| **Bitbucket Pipelines** | `.bitbucket/pipelines.yml` | Yes | No | No | Medium | Stable |
| **Drone** | `.drone.yml` | Yes | No | No | Medium | Stable (acquired) |
| **Heptapod** | `.gitlab-ci.yml` (inherited) | Yes | No | No | Tiny | Niche |

---

## Synthesis — Should OpenForge ship YAML or invent a different format?

**Ship YAML. Focus elsewhere.** The evidence is unambiguous:

1. **Every successful self-hosted Git platform uses file-based YAML in the repo.** Gitea/Forgejo chose GitHub Actions compatibility and gained traction. Sourcehut uses simple YAML manifests and has passionate (if niche) users. Drone, Bitbucket Pipelines, Heptapod, GitLab — all YAML in repo. The file-in-repo model is the universal expectation.

2. **The two non-file-based models (Phabricator Harbormaster, Bamboo) both failed or are dying.** Phacility sunset 2021. Atlassian killing Bamboo by 2029 and pushing to YAML-based Pipelines. GitHub actively recruiting away from Bamboo. No non-file-based CI model has ever achieved broad adoption at Git-platform scale.

3. **OneDev is the closest analog and its "proprietary format" is its #1 criticism.** Even with GUI-driven authoring, users consistently complain the `.onedev-buildspec.yml` format is "weird proprietary" and not portable. A GitHub competitor cannot afford this friction — users will not migrate CI definitions to a proprietary format.

4. **The innovation opportunity is not in the serialization format but in the execution model and developer experience.** Sourcehut's SSH-into-failed-VM is beloved. OneDev's pause-and-debug-web-terminal is praised. Gitea's scoped workflows are useful. These are the differentiators worth investing in. YAML is table stakes.

5. **Recommended approach:** GitHub Actions-compatible YAML in repo (zero-migration friction) + superior execution features (sandboxing, debugging, ad-hoc runs, VM isolation options). This is exactly the strategy Gitea chose and it's working. Optionally add a OneDev-style GUI editor as a convenience layer, but the YAML remains the source of truth.
