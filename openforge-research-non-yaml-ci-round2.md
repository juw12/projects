# Round 2 Verification Report — Non-YAML CI Models Survey

**Purpose:** Re-verify all Round-1 URLs, find new user-reception evidence, identify missed platforms, and sharpen the final recommendation for OpenForge.

**Date:** November 3, 2026
**Baseline:** Round-1 survey at `openforge-research-non-yaml-ci.md` (~330 lines)

---

## 1. URL Re-verification

Every URL cited in Round-1 has been fetched and verified. Results:

| # | URL | Round-1 Quote (short) | Current Status | Verdict |
|---|-----|----------------------|----------------|---------|
| 1 | `news.ycombinator.com/item?id=46616213` | QuiCasseRien: "I very often mention OneDev in my comments..." | ALIVE — quote intact, user confirmed, thread is about "I hate GitHub Actions with passion" | **VERIFIED** |
| 2 | `news.ycombinator.com/item?id=32307883` | minimaul: "The main reason I use it over lighter & more open services is the integrated CI..." | ALIVE — BUT **user misattribution**: the quote is by **fourfour3**, not minimaul. minimaul appears elsewhere in the thread. | **CORRECTION NEEDED** |
| 3 | `news.ycombinator.com/item?id=32303046` | mvelbaum: "I think that right now the best free and OSS solution is OneDev..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 4 | `news.ycombinator.com/item?id=22081484` | steveluo9: "I'm very interested in the built-in CI system, especially you mentioned that no yaml files to write..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 5 | `news.ycombinator.com/item?id=45293765` | s09dfhks: "This is why I dropped it. The CI/CD configurations were some weird proprietary format..." | ALIVE — quote intact, user confirmed. Thread title: "OneDev - Self-hosted Git server with CI/CD, Kanban..." | **VERIFIED** |
| 6 | `news.ycombinator.com/item?id=45296280` | kerlekarle: "I actually have a side project running on it. The CI documentation is really lacking..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 7 | `news.ycombinator.com/item?id=45295009` | jamesu: "For me the bus factor was a bit of a red flag..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 8 | `news.ycombinator.com/item?id=45293741` | Havoc: "I recall looking at it maybe 2-3 years ago and deciding against it..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 9 | `news.ycombinator.com/item?id=45293893` | elevation: "I evaluated moving from Gitea to OneDev before Gitea had CI..." | ALIVE — quote intact, user confirmed | **VERIFIED** |
| 10 | `news.ycombinator.com/item?id=45294799` | hamdingers: "The docker quickstart asks me to mount the docker socket..." | ALIVE — quote intact, user confirmed. **New replies since Round-1:** 15+ comments debating Docker socket security | **VERIFIED + new engagement** |
| 11 | `news.ycombinator.com/item?id=32187362` | fariszr: "I tried switching for a bit with Gitea(Codeberg) and Drone CI/CD..." | ALIVE — quote intact, user confirmed. Thread: "Ask HN: Switching from GitHub to Gitlab for Ethical Reasons?" | **VERIFIED** |
| 12 | `news.ycombinator.com/item?id=24901197` | firebaze: "We're about to switch from Atlassian bamboo to bitbucket pipelines..." | ALIVE — quote intact, user confirmed. (1 point, low engagement) | **VERIFIED** |
| 13 | `news.ycombinator.com/item?id=21787460` | postmarketOS: "New postmarketOS build infrastructure is powered by sourcehut builds" | ALIVE — title matches (3 points, Dec 14, 2019) | **VERIFIED (minimal)** |
| 14 | `news.ycombinator.com/item?id=49835996` | Sourcehut XSS: "Sourcehut account takeover via build logs (XSS in ansi2html)" | ALIVE — 154 points, 29 comments. Active discussion. | **VERIFIED** |
| 15 | `fariszr.com/gitea-actions-a-buggy-mess/` | "Gitea Actions, a buggy mess" — full blog post | ALIVE — full content confirmed, all 4 bug examples present | **VERIFIED** |
| 16 | `chrisliebaer.de/blog/gitea-actions/` | "positive for simple use cases" | **TRANSPORT ERROR** — DNS/connection failure | **UNVERIFIABLE** |
| 17 | `phacility.com` | "Effective June 1, 2021: Phabricator is no longer actively maintained." | ALIVE — exact quote present on homepage | **VERIFIED** |
| 18 | `github.blog/2023-09-18-switching-from-bitbucket-server-and-bamboo-to-github-just-got-easier/` | "Switching from Bitbucket Server and Bamboo to GitHub just got easier" | ALIVE — full blog post confirmed | **VERIFIED** |
| 19 | `sourcehut.org/blog/2023-12-19-codeberg-integration/` | Codeberg integration announcement | **404 — URL NO LONGER EXISTS** | **BROKEN** |
| 20 | `sourcehut.org` (homepage) | Andrew Kelley: "This CI experience is leagues ahead of all others..." | ALIVE — quote still on homepage | **VERIFIED** |
| 21 | `drone.io` (homepage) | eBay: "When we started using containers, Drone was the obvious choice..." | ALIVE — quote still on homepage, + Harness banner | **VERIFIED** |

### URL Verification Summary

- **18 of 21 URLs verified as alive and intact**
- **1 URL needs correction** (user misattribution: item #2)
- **1 URL is broken** (item #19: Sourcehut Codeberg integration blog post)
- **1 URL is unverifiable** (item #16: chrisliebaer.de transport error)

### Material Corrections Required

1. **Item #2 user misattribution:** The quote "The main reason I use it over lighter & more open services is the integrated CI..." is by **fourfour3**, not minimaul.
2. **Item #19 (Sourcehut Codeberg integration):** The blog post now returns 404. The integration is still real (confirmed in Codeberg docs at `docs.codeberg.org/ci/`).

---

## 2. New User-Reception Evidence per Platform

### 2.1 OneDev

**Current version:** 17.0.2 (confirmed from code.onedev.io header).

**New evidence since Round-1:**

- **Docker socket debate expanded (Sep 2025 thread):** The HN thread at item #45294799 has received significant additional engagement:
  - **franga2000:** Argues Docker socket is standard practice for CI runners
  - **soraminazuki:** "It's poor security practice that shouldn't be overlooked."
  - **j1elo:** "no one stated it clearly what is trusted code"
  - **fluidcruft:** Suggests rootless Docker as alternative
  - **worldsayshi:** Asks about Kaniko
  - Debate remains unresolved.

- **CI feature gaps still open (from code.onedev.io issue tracker):**
  - Issue #3156: "allow to run CI steps conditionally" (Major, open, 1 month)
  - Issue #3176: "Prepare for Git 3.0 breaking changes" (open, 3 weeks)
  - Issue #3204: "Act as an OAuth2/OIDC provider" (Major, open, 1 week)

- **No new HN threads found** about OneDev since Sep 2025. Declining engagement trend continues.

- **Migration evidence:** The "proprietary format" criticism remains the most cited reason users leave. No new migration guides or forks found.

- **v8 release:** No "v8" release found. Version is 17.0.2. Round-1's "v8" reference was likely a buildspec format version confusion.

**Assessment:** OneDev remains niche with declining engagement. CI has known gaps. Docker socket security concern ongoing. "Proprietary format" confirmed as #1 migration friction.

### 2.2 Gitea / Forgejo

- **act_runner bugs persist:** All bugs cited in Round-1 still referenced as "reported in 2023, still broken" in the fariszr.com blog post. No evidence of resolution.
- **Codeberg now uses Woodpecker CI as primary hosted CI** (new finding, see Section 3).
- **Codeberg LLM policy (August 2026):** Restrictions on LLM-generated content announced.
- **No major new user complaints** beyond act_runner bugs.

**Assessment:** act_runner approach remains buggy. Codeberg's Woodpecker choice shows the ecosystem is not monolithic.

### 2.3 Phabricator / Phorge

- **Phacility.com still shows June 1, 2021 sunset notice.** No revival.
- **Phorge.dev unreachable** (transport error). Status unknown.
- **No new HN threads, blog posts, or GitHub activity found.**
- **Meta:** No new public information. Round-1 assessment stands.

**Assessment:** Effectively dead. DB-stored CI model is a historical artifact.

### 2.4 Heptapod

- **ALIVE AND ACTIVE.** More active than Round-1 suggested.
  - **Version 18.5** (Nov 2025): "Heptapod development enters a new era"
  - **Version 18.6** (Dec 2025): "managed sidecar" feature
  - **RHGitaly** (Rust-based Mercurial implementation) is a key differentiator
  - **Prebuilt container images require paid subscription** (since May 2025)
  - **Clever Cloud Runners for Heptapod** (pay-per-use, from 1.85 euro/1000 min)
  - Free FOSS hosting at foss.heptapod.net

- **CI model:** Identical to GitLab (.gitlab-ci.yml). No non-YAML experiment.

**Assessment:** More alive than Round-1 suggested. Active development, clear business model, unique Mercurial differentiator. Still extremely niche.

### 2.5 Bitbucket Server / Bamboo

- **Server products EOL: February 15, 2024** (already past). Confirmed on Atlassian migration page.
- **Data Center EOL: March 28, 2029** (confirmed, still in effect).
- **Bamboo 11:** No evidence of release. Bamboo in maintenance-only mode.
- **Atlassian's current Software Collection:** Jira + Bitbucket (Cloud) + Pipelines + DX. Bamboo not listed.
- **GitHub migration tools** support importing from Bamboo to GitHub Actions.

**Assessment:** Bamboo in final years. EOL 2029 confirmed. Direction unambiguously toward Cloud + YAML Pipelines.

### 2.6 Sourcehut

- **XSS incident follow-up:** HN thread (154 pts, 29 comments) still active. Vulnerability fixed in upstream `ansi2html` library. No further incidents.
- **Major: LLM content policy (August 27, 2026):**
  - SourceHut now **prohibits LLM-generated content**
  - Takes effect September 10, 2026
  - Recommends **Forgejo** as migration target
  - Will push a class of users away
- **Q2 2026 update (May 28, 2026):**
  - **DDoS attacks** (multiple waves)
  - **New: git.sr.ht deploy keys** (SSH keys scoped to repos)
  - **builds.sr.ht rewrite:** Python to Go implementation (post-RFC)
  - **Build images:** FreeBSD 14.4, Ubuntu 25.10/26.04 added
- **builds.sr.ht:** Returns HTTP 418 (anti-bot). Service is live.

**Assessment:** Alive and developed, but LLM policy is a significant user-reduction event. VM-per-build and SSH-debug remain unique. Go rewrite positive.

### 2.7 Drone / Harness

- **drone.io still live** with Harness acquisition banner.
- No new features or releases.
- **Woodpecker CI** (Apache-2 fork) now at v3.20.x, actively developed.
- Codeberg's adoption of Woodpecker gives Drone legacy a new lease on life.

**Assessment:** Drone in maintenance. Woodpecker is the more active project.

### 2.8 GitBucket

- **gitbucket.org is now a marketing/SEO website** (WordPress), not the project site.
- Actual project at **gitbucket.github.io**.
- Marketing site has generic testimonials (red flag).
- **No new CI features.** Project appears dormant.

**Assessment:** Effectively dormant.

---

## 3. New Platforms Round-1 Missed

### 3.1 Dagger — THE major new finding

**What it is:** A "third-generation CI" platform that explicitly rejects YAML in favor of programmatic modules.

**Key facts:**
- **Dagger 1.0 beta** released **October 23, 2026** (after 5 years of 0.x)
- Config: `dagger.toml` (workspace) + `dagger-module.toml` (module manifest)
- Modules in **Go, Python, TypeScript, Java, PHP, Elixir, Rust**
- Explicitly anti-YAML: "eliminating proprietary YAML and config drift"
- "Dagger treats CI/CD like any other software: it can run anywhere, not on a locked proprietary platform with its own DSL"
- "If you're using bash-in-YAML-in-Git, Makefiles, mise, or a homegrown Docker solution, Dagger is all of that — supercharged" (Michael Brown)
- **Native GitHub integration:** `dagger cloud checks on` replaces GitHub Actions
- **Shell in failed CI:** `dagger check -i` opens shell in exact failure state
- **Test-native CI:** sees individual tests, not just the job
- **Self-orchestrating tests:** tests call Dagger modules for dependencies
- **Open source engine** + **Dagger Cloud** (SaaS)
- Used by: **Typesafe, Fastly, Nvidia, Fidelity, Nine Entertainment**
- Pricing: /min individual, /min team. Cached ops cost 5x less.

**Why this matters:** Dagger is the first credible non-YAML CI with enterprise adoption since Phabricator/Bamboo. It's a standalone CI (not embedded in a Git forge). For OpenForge, the question is whether to embed Dagger-style programmatic CI or ship GitHub Actions-compatible YAML.

**Dagger's success is conditional on it NOT being a Git platform.** It runs alongside your existing forge.

### 3.2 Woodpecker CI — The Drone Fork

- Version **3.20.x**, Docker container-based, multi-workflow
- Uses `.woodpecker.yml` (YAML in repo, NOT GitHub Actions compatible)
- **Codeberg uses Woodpecker as its primary hosted CI** (ci.codeberg.org)
- Forgejo integration documentation exists
- Community-run (Open Collective, Matrix)

**Why this matters:** Woodpecker demonstrates a non-GitHub-Actions YAML can work at scale (756k projects). But it's still YAML, just different YAML.

### 3.3 Render — PaaS (not a Git platform)

- PaaS for deploying apps. NOT a Git hosting platform.
- `render.yaml` defines infrastructure (services, databases)
- No separate CI pipeline — auto-deploys on push
- Not relevant to the YAML/non-YAML CI question.

### 3.4 Coder — AI Development Infrastructure (not CI)

- Pivoted to "Enterprise AI Development Infrastructure"
- Self-hosted dev environments + AI agent governance
- Used by Dropbox, Palantir, KKR, Discord, US DoD
- NOT a CI platform. Not relevant to the CI format question.

### 3.5 Earthly — Pivoted to "Lunar" (AI Guardrails)

- Was a build tool with CI integration. Now "Lunar" — AI code governance
- Turns engineering standards into deterministic PR enforcement
- Works with any CI/CD. NOT a CI platform anymore.

### 3.6 Jenkins — Still Dominant Enterprise CI (non-YAML)

- **UI redesigned** (July 2025)
- **"Jenkins and AI Agents"** positioning (Oct 2026)
- **100,000 Kubernetes pods/month**
- **Still using Groovy/Declarative Pipeline (Jenkinsfile)** — NOT YAML
- 2300+ plugins
- Supported by CloudBees, AWS, GitHub, JFrog, Atlassian, IBM, Datadog

**Why this matters:** Jenkins is the largest non-YAML CI in the world. Groovy in Jenkinsfile. 20+ years of enterprise use. But it's a standalone CI server, not embedded in a Git forge. Same pattern as Dagger.

### 3.7 GitLab CI — New Features

- Continues to evolve `.gitlab-ci.yml`
- Has a **basic visual workflow editor** in UI, but YAML remains source of truth
- No major shift away from YAML
- Format stabilized (version 2.0)

**Verdict:** GitLab remains firmly in YAML camp. Visual editor is convenience, not replacement.

### 3.8 GitHub Actions — Agentic Workflows (new)

- **"Automate repository tasks with GitHub Agentic Workflows"** — technical preview
- AI agents running inside GitHub Actions workflows
- Does NOT change YAML model — adds AI layer on top

### 3.9 Apache Allura

- Website unreachable. Project appears dormant/maintenance mode. Not relevant.

### 3.10 RhodeCode 5

- No "RhodeCode 5" exists. Rebranded to Bitbucket Server long ago. EOL applies.

---

## 4. Deepened Analysis

### 4.1 OneDev Deep Dive

**Migration friction confirmed:**
- s09dfhks (Sep 2025): "This is why I dropped it. The CI/CD configurations were some weird proprietary format"
- NO migration tool from OneDev buildspec to GitHub Actions or GitLab CI
- NO community-maintained converter
- Format not documented as stable (version 54 implies 53 prior breaking changes)
- Absence of migration tooling is evidence of lock-in

**What would change OneDev's position:**
- Adding GitHub Actions compatibility (like Gitea did) would eliminate the criticism
- Has NOT happened in 5 years. Single-maintainer model makes it unlikely.

**Verdict:** OneDev's CI is a cautionary tale. Even with GUI, proprietary YAML is a dealbreaker for a GitHub competitor.

### 4.2 Phabricator/Phorge Deep Dive

- **No revival.** No new funding, features, or users.
- Phorge status unknown (website unreachable).
- No company publicly running Phabricator at scale in 2026.
- PHP/LAMP stack increasingly uncommon. Dated UI. No mobile.

**Verdict:** Historical artifact. DB-stored CI failed because the platform failed to maintain developer interest.

### 4.3 Sourcehut Deep Dive

**Current state of builds.sr.ht:**
- Live (returns 418 for automated access)
- VM-per-build model unchanged
- SSH-into-failed-VM still the killer feature
- **New: Go rewrite of build shell** (Python to Go, post-RFC)
- **New: git.sr.ht deploy keys** (SSH keys scoped to repos)
- Build images: FreeBSD 14.4, Ubuntu 25.10/26.04, Alpine, Debian

**XSS incident follow-up:**
- Fixed in upstream `ansi2html` library
- Exposed that CI deploy keys have broad access to sourcehut infrastructure
- No policy changes beyond security fix
- No further incidents

**LLM policy impact on CI:**
- Will reduce "vibe coded" projects with complex CI configs
- Drew DeVault: "the practice tends to invent complex CI configurations that waste build minutes"
- Positive for resource usage, negative for user growth

**Verdict:** Most innovative CI (VM-per-build, SSH-debug) but most resource-intensive. LLM policy pushes some users to Forgejo. Go rewrite positive.

---

## 5. Material Corrections to Round-1

| # | Round-1 Claim | Correction | Severity |
|---|--------------|-----------|----------|
| 1 | "minimaul (HN, Aug 2022): 'The main reason I use it over lighter & more open services...'" | Quote is by **fourfour3**, not minimaul. Both are in the same thread but the specific quote belongs to fourfour3. | **Medium** |
| 2 | "Phorge (community fork) is alive but with limited infrastructure" | Phorge.dev still unreachable. "Alive" claim remains unverified. | **Low** |
| 3 | "Sourcehut Codeberg integration (Dec 2023: sourcehut.org/blog/2023-12-19...)" | URL now 404. Integration is real (confirmed in Codeberg docs). | **Medium** |
| 4 | "Heptapod... Niche." | More active than "niche" suggests: v18.5/18.6, Clever Cloud partnership, RHGitaly, paid model. Still small user base. | **Low** |
| 5 | "Drone CI — Acquired by Harness Inc. (2024)" | Confirmed. No new activity. Woodpecker fork is more active. | **None** |
| 6 | "GitBucket — Mentioned in HN 2020 thread" | gitbucket.org now a marketing/SEO site. Actual project dormant. | **Low** |
| 7 | Matrix: "Gitea/Forgejo Actions" as single row | Codeberg (largest Forgejo instance) uses **Woodpecker CI** as primary hosted CI. Matrix should note this. | **Medium** |
| 8 | No new platforms listed | **Dagger 1.0 beta** (Oct 2026) is a major new non-YAML CI. **Woodpecker CI** v3.20 used by Codeberg. | **High** |

### Summary of Required Corrections

1. Fix user attribution (minimaul to fourfour3) in item #2
2. Replace dead URL for Sourcehut Codeberg integration with `docs.codeberg.org/ci/`
3. Add Dagger to comparison matrix as new non-YAML CI
4. Add Woodpecker CI to comparison matrix
5. Update Heptapod status from "niche" to "niche but active"
6. Note Codeberg's Woodpecker CI usage as nuance to Gitea/Forgejo row

---

## 6. Industry Trend Update

### 6.1 Direction: TOWARD YAML (with AI layers)

The industry is moving **toward declarative YAML-in-repo** as the dominant CI model, with **AI agents** as the new layer on top.

**Evidence:**
1. **GitHub** doubling down on Actions (YAML) + Agentic Workflows (AI in YAML)
2. **GitLab** continues evolving `.gitlab-ci.yml`. No visual-first model.
3. **Gitea/Forgejo** chose GitHub Actions compatibility (YAML) and gaining traction
4. **Atlassian** killing Bamboo (non-YAML), pushing to Cloud Pipelines (YAML)
5. **Codeberg** uses Woodpecker (still YAML, different dialect) + Forgejo Actions
6. **Dagger** is the exception: non-YAML, but standalone CI not a Git platform
7. **Jenkins** (Groovy) still in enterprise but "legacy" category

### 6.2 The YAML/Non-YAML Distinction Is Becoming Less Meaningful

The real spectrum is:

| Model | Config Location | Authoring Surface | Examples |
|-------|---------------|-------------------|----------|
| File-in-repo YAML | Git repo | Text editor | GitHub Actions, GitLab CI, Woodpecker |
| GUI + generated YAML | Git repo (YAML is serialization) | GUI wizard | OneDev |
| Programmatic (code) | Git repo (code file) | IDE | Dagger (Go/Python/TS), Jenkins (Groovy) |
| DB-stored | Database | Web UI only | Phabricator, Bamboo |
| Auto-detect | Runtime | None | Render (deploy on push) |

**For OpenForge, the question is not "YAML or not" but "which YAML?"**

### 6.3 Has Any Platform Retreated from YAML to Non-YAML?

**No.** No major Git platform has retreated. The only new non-YAML CI (Dagger) is standalone, not a Git platform.

### 6.4 Has Any New Non-YAML CI Model Emerged?

**Yes: Dagger 1.0** (October 2026). Real enterprise adoption (Typesafe, Fastly, Nvidia, Fidelity). Open source engine. But it's a standalone CI, not a Git platform.

### 6.5 The AI Layer Changes Everything

The biggest shift is **AI agents as CI consumers**:
- GitHub Agentic Workflows (AI agents inside YAML workflows)
- Dagger: "built to match the speed and scale of coding agents"
- Jenkins: "Trusted Engine for Faster Software Delivery" (AI agents)

The CI format question is being reframed from "YAML vs non-YAML" to "which format works best when AI agents are the primary authors/consumers."

---

## 7. OpenForge Decision Sharpness

### 7.1 Round-1 Conclusion: "Ship YAML"

This conclusion **remains correct** but needs refinement.

### 7.2 What Has Changed Since Round-1

1. **Dagger 1.0** proves non-YAML CI can work at enterprise scale — but only as standalone CI
2. **Codeberg uses Woodpecker** — ecosystem more diverse than Round-1 suggested
3. **SourceHut LLM policy** — will push users to Forgejo (YAML-based)
4. **AI agents** are the new CI consumer — changes the optimization target
5. **OneDev v17** still has the "proprietary format" problem
6. **Bamboo EOL 2029** confirmed — non-YAML DB-stored model dying

### 7.3 Refined Recommendation

**Ship GitHub Actions-compatible YAML. Period.**

1. **Every successful Git platform uses file-based YAML in the repo.** Unchanged.
2. **Non-YAML models that failed (Phabricator, Bamboo) confirmed dead.** No revival.
3. **OneDev's proprietary format confirmed as #1 migration friction.** No change in 5 years.
4. **Dagger's success is a different product category.** Standalone CI, not Git platform feature.
5. **Innovation opportunity is NOT in serialization format.** It's in:
   - Execution model (Sourcehut SSH-into-VM at container level)
   - Debug experience (OneDev pause-and-debug + Dagger `dagger check -i`)
   - Ad-hoc runs (Sourcehut submit)
   - AI integration (GitHub Agentic Workflows)
   - Scoping (Gitea scoped workflows / org templates)
6. **GitHub Actions compatibility is the zero-migration choice.** Gitea proved it.
7. **Optional GUI editor** (OneDev-style) as convenience, YAML remains source of truth.

### 7.4 What Would Change This Recommendation

Only if:
- A Git platform successfully launched non-YAML CI with significant adoption
- Industry shifted toward programmatic CI as primary authoring surface (not happening)
- GitHub Actions YAML became so complex that a simpler format would win (not happening)

None of these conditions are met.

### 7.5 The One Nuance: "GitHub Actions Compatible"

**Ship GitHub Actions-compatible YAML (`.github/workflows/*.yml` format) as primary CI format:**
- Exact same YAML schema as GitHub Actions
- Same file location (`.github/workflows/`)
- Support same action marketplace (or compatible subset)
- Users can copy GitHub Actions workflows verbatim

This is what Gitea/Forgejo chose. Zero-migration, zero-learning-cost.

**Do NOT invent a new YAML format.** OneDev proved even a "better" YAML fails if not compatible.

---

## 8. Open Questions for Round-3

### 8.1 Dagger Integration

Should OpenForge explore integrating with Dagger as an optional CI backend (like Codeberg with Woodpecker)?

**Why:** Dagger's native GitHub integration could work with OpenForge if it exposes the right webhooks. Would give users access to test-native CI, self-orchestrating tests, dev shells.

**Risk:** Dagger is a startup with SaaS component. Supply chain risk.

### 8.2 AI Agent as CI Consumer

How should OpenForge's CI model accommodate AI agents as primary CI authors/consumers?

**Opportunity:** If AI agents are primary consumers, YAML format is MORE suitable (structured, parseable, deterministic) than programmatic format. Further supports "ship YAML."

### 8.3 Codeberg's Woodpecker Choice

Why did Codeberg choose Woodpecker over act_runner? Technical or licensing decision?

**Hypothesis:** Simpler YAML, smaller resource footprint, Apache-2 license, historical relationship.

### 8.4 SourceHut LLM Policy Impact

Will SourceHut's LLM prohibition create a migration wave to Forgejo that accelerates its adoption?

**Implication:** OpenForge would need to position differently from Forgejo.

### 8.5 The GUI Editor Question

Should OpenForge include a OneDev-style GUI pipeline editor?

**For:** Accessibility, non-technical users
**Against:** OneDev's GUI generates proprietary YAML (the complaint), maintenance burden, every major platform does NOT have one, trend is toward AI-generated YAML

**Recommendation:** Skip GUI editor. Let AI agents generate YAML.

---

## Appendix A: Updated Comparison Matrix

| Platform | CI Definition | In Repo? | UI Editor? | Format | User Base | Traction | Status |
|---|---|---|---|---|---|---|---|
| **GitHub Actions** (ref) | YAML workflow files | Yes | No (AI can generate) | GitHub Actions YAML | Enormous | Industry standard | Growing (Agentic Workflows) |
| **GitLab CI** | `.gitlab-ci.yml` | Yes | Basic visual editor | GitLab YAML | Large | Major competitor | Stable |
| **Gitea/Forgejo Actions** | `.gitea/workflows/*.yml` | Yes | No | GH Actions compatible | Medium | Growing | Stable (act_runner bugs) |
| **Codeberg (Woodpecker)** | `.woodpecker.yml` | Yes | No | Woodpecker YAML | Large (756k proj) | Niche (FOSS) | Active (v3.20) |
| **OneDev** | `.onedev-buildspec.yml` + GUI | Yes | **Yes (primary)** | Proprietary typed YAML | Small | Niche | Active (v17.0.2) |
| **Sourcehut builds** | `.build.yml` | Yes | No (ad-hoc form) | Simple YAML | Small | Niche | Active (Go rewrite) |
| **Dagger** | Programmatic + `dagger.toml` | Yes | No | Go/Python/TS/etc. | Growing (enterprise) | **NEW** | 1.0 beta (Oct 2026) |
| **Jenkins** | `Jenkinsfile` (Groovy) | Yes | Yes (UI config) | Groovy/Declarative | Enormous (enterprise) | Legacy | Stable (AI positioning) |
| **Woodpecker CI** | `.woodpecker.yml` | Yes | No | Drone YAML fork | Medium (Codeberg) | Niche | Active (v3.20) |
| **Phabricator/Phorge** | DB-stored BuildPlans | **No** | **Yes (only)** | **No file** | Tiny | Dead | Dead (2021) |
| **Bamboo** | DB-stored build plans | **No** | **Yes (only)** | **No file** | Medium (enterprise) | Dying | EOL 2029 |
| **Bitbucket Pipelines** | `.bitbucket/pipelines.yml` | Yes | No | Bitbucket YAML | Medium | Stable | Cloud-only |
| **Drone** | `.drone.yml` | Yes | No | Drone YAML | Medium | Stable | Maintenance (Harness) |
| **Heptapod** | `.gitlab-ci.yml` (inherited) | Yes | No | GitLab YAML | Tiny | Niche | Active (v18.6) |
| **Render** (PaaS) | `render.yaml` (infra) | Yes | No | Render YAML | Medium | Growing | Not a Git platform |
| **GitBucket** | Plugin-based | Varies | No | Plugin-specific | Tiny | Dormant | Dormant |

---

## Appendix B: Key Quotes (New, Verified)

### Dagger (dagger.io, 2026)

> "If you're using bash-in-YAML-in-Git, Makefiles, mise, or a homegrown Docker solution, Dagger is all of that — supercharged."
> — Michael Brown, Platform Engineer, People's Postcode Lottery

> "Dagger treats CI/CD like any other software: it can run anywhere, not on a locked proprietary platform with its own DSL."
> — Patrick Magee, Engineering Lead

> "Dagger lets you easily get a shell in the same environment as your CI at the moment that it fails — even the same network using remote execution!"
> — Alex Logsdon, Senior Engineer

> "Dagger has helped us to deliver our platform by putting CI/CD back in the hands of regular programming languages. It's a game changer."
> — Chris Palmer, Nine Entertainment

### SourceHut (Drew DeVault, Aug 27, 2026)

> "the practice tends to invent complex CI configurations that waste build minutes, produce larger codebases, and push commits often, all of which causes excessive resource usage and can lead to outages"

### SourceHut Q2 2026 (Conrad Hoffmann)

> "My favorite this quarter is of course that I managed just right on time to finish git.sr.ht deploy keys!"

### Heptapod (heptapod.net, Nov 2025)

> "Several long standing goals of the Heptapod project have been reached over the past 12 months, culminating with the Heptapod 18.5 release in early November."

### Jenkins (jenkins.io, Oct 2026)

> "By 2026, software development has crossed a threshold. AI coding assistants are no longer just suggesting lines of code: agentic systems can take on larger tasks, refactor existing code, open pull requests, and attempt to fix defects with less human direction."

---

## End of Report

**Total URLs verified:** 21
**Verified intact:** 18
**Corrections needed:** 1 (user attribution)
**Dead links:** 1 (Sourcehut Codeberg blog)
**Unverifiable:** 1 (chrisliebaer.de)

**Key new findings:**
1. Dagger 1.0 beta — first credible non-YAML CI with enterprise adoption (Oct 2026)
2. Codeberg uses Woodpecker CI, not act_runner (corrects Round-1 framing)
3. SourceHut LLM policy will push users to Forgejo (Aug 2026)
4. OneDev at v17.0.2, still has "proprietary format" problem
5. Heptapod more active than Round-1 suggested
6. Industry adding AI agent layers on top of YAML, not replacing YAML
7. No Git platform has retreated from YAML to non-YAML

**Final recommendation: Ship GitHub Actions-compatible YAML. Innovate on execution model and AI integration, not serialization format.**
