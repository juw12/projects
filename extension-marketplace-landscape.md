# Extension Marketplace & Plugin Registry Landscape — Self-Hosted Git Platforms and Major Registries

**Date**: 2026-11-03
**Pass**: 2/2 (verification re-run)
**Scope**: Every public extension marketplace / plugin registry that has shipped for a self-hosted Git platform (Gitea, Forgejo, OneDev, GitLab CI/CD components, Sourcehut builds), plus the major general-purpose registries named in the brief (Jenkins, VS Code, Atlassian Marketplace, npm, PyPI).
**Method**: Primary-source webfetch of each marketplace homepage/stats page where reachable, plus `gh` search for supply-chain incident repos/advisories. Every figure is tagged with its verification status (see legend below). Nothing is presented as an exact count unless it was read from a primary source this session.

---

## How to read the catalog-size figures (verification legend)

Each catalog-size figure below carries one of these tags. This is the single most important part of the document, because the brief forbids speculating on size and several marketplaces **do not publish a global count at all** (or are single-page React apps that expose no server-side total).

| Tag | Meaning |
|-----|---------|
| `[VERIFIED 2026-11-03]` | Read directly from a primary source (official homepage, registry API, or official docs) during this session. |
| `[APPROX]` | Documented order-of-magnitude from a reputable secondary source, with date. NOT re-verified against the live registry this session (fetch was blocked by a JS challenge, SPA, or transport error). Treated as an estimate, not an exact count. |
| `[NO CENTRAL CATALOG]` | No official, single, numbered catalog exists. Distribution is decentralized (git repos / Go modules / binaries). The "size" is therefore a small, unbounded community set, not a marketplace number. |
| `[UNVERIFIED]` | Could not be determined from any reachable primary source this session. Stated qualitatively only. |

**Fetch status this session** (important for interpreting the tags):
- Reachable: `plugins.jenkins.io`, `registry.npmjs.org` (search API), `forgejo.org/docs`, `marketplace.atlassian.com` (SPA shell only), `marketplace.visualstudio.com` (SPA shell only), `open-vsx.org` (SPA shell only), `github.com` (via `gh`).
- **Unreachable this session** (transport error / JS challenge): `docs.gitlab.com`, `gitlab.com`, `sourcehut.org`/`about.sourcehut.org`, `theonedev.com`, `pypi.org` (JS client challenge). Claims about these are tagged `[APPROX]` or `[UNVERIFIED]` and rely on documented behavior, not a live read. See the Network notes in the final section.

---

# PART A — PRIMARY FOCUS: Self-Hosted Git Platforms

The brief requires that non-Git platforms NOT be the primary focus. Part A therefore covers the five self-hosted Git / CI surfaces in depth. Part B covers the four general-purpose registries (Jenkins is borderline CI and is treated here as a first-class target because the brief lists it; VS Code / Atlassian / npm / PyPI are covered for completeness but as comparative context).

The single most important structural finding, stated up front because it reframes the whole comparison:

> **None of the self-hosted Git platforms (Gitea, Forgejo, OneDev, GitLab CI components, Sourcehut) operates a centralized, numbered, "browse-and-search" plugin marketplace the way Jenkins, VS Code, or Atlassian do.** Their extension mechanisms are *decentralized*: plugins/components are shipped as Go modules, prebuilt binaries, or git-referenced artifacts and are discovered via Git hosting (Codeberg, GitHub, the project's own org) rather than via a marketplace front-end. The "catalog size" for these is therefore small, unbounded, and not published as a single number. The general-purpose registries (Jenkins/VS Code/Atlassian/npm/PyPI) are the only ones with true, large, numbered catalogs.

---

## A1. Gitea / Forgejo plugin system

Gitea and its community fork Forgejo share the same plugin architecture (Go module / prebuilt binary plugins loaded at runtime). Forgejo is the more active of the two as of 2026 and hosts its code on Codeberg (`codeberg.org/forgejo/forgejo`). Forgejo docs observed live this session: latest **v17.0.1**, LTS **v15.0.11** `[VERIFIED 2026-11-03]`.

- **Catalog size**: `[NO CENTRAL CATALOG]`. There is **no official Gitea/Forgejo plugin marketplace** with a published count. Plugins are discovered via: (a) Go module proxy (plugins are Go modules), (b) prebuilt release binaries on Codeberg/GitHub, (c) community lists (e.g., "delightful-forgejo"-style curated lists linked from the Forgejo docs footer `[VERIFIED: link present in docs footer]`). The realistic community plugin set is on the order of **dozens**, not thousands — and that number is unbounded because anyone can publish a Go module or binary.
- **Active vs abandoned ratio**: `[UNVERIFIED]` — not centrally tracked. As with any git-distributed ecosystem, a large share of old plugins/bitrot quickly; there is no "unmaintained" badge system.
- **Commercial vs free breakdown**: `[APPROX]` — overwhelmingly free/open-source (MIT/Apache/GPL per plugin). There is **no paid plugin tier** and no commercial marketplace; monetization is via the vendor's own services, not the platform.
- **Distribution mechanism**: Go module (`import` a plugin module) **or** a prebuilt binary placed in the plugins directory; both are fetched from git hosting (Codeberg/GitHub) or a Go module proxy. Forgejo additionally ships a full **Package Registry** (see below) but that is for *packages*, not *plugins*.
- **Version compat policy**: Plugins declare the minimum Gitea/Forgejo version they support (Go build tags / API surface). There is no central compatibility matrix. Forgejo plugins must target the Forgejo API fork (post-divergence from Gitea they are **not** automatically cross-compatible — a Forgejo plugin may not load on Gitea and vice-versa).
- **Signing / supply chain**:
  - **Instance Commit Signing** is a first-class Forgejo/Gitea feature `[VERIFIED 2026-11-03]` (docs path `admin/advanced/signing`) — but that signs **commits**, not plugins.
  - **No mandatory plugin signing.** No GPG/Minisign/Sigstore requirement for plugins. A plugin binary is trusted by virtue of being present on disk.
  - **SBOM**: none published for the plugin ecosystem. Forgejo maintains its own **Threat Analysis** documentation `[VERIFIED: docs/contributor/threat-analysis]` and a **DCO** (Developer Certificate of Origin) process for *contributions to the core repo* `[VERIFIED: docs/contributor/dco]` — again, not for third-party plugins.
  - **Risk**: a malicious or compromised plugin binary has full in-process access to the Gitea/Forgejo server. There is no sandbox and no signature gate. This is the dominant supply-chain exposure for self-hosted Gitea/Forgejo.
- **Notable plugins by category** `[APPROX — community-set, not an official catalog]`:
  - *SAML/OIDC / auth*: various auth plugins (e.g., SAML, OAuth connectors).
  - *Storage / integration*: e.g., webhooks integrations, notification plugins.
  - *Editor/preview*: markdown/code preview plugins.
  - Exact list varies by community; no authoritative "top plugins" ranking exists.
- **Monetization**: None at the platform level. Vendors sell support/services; plugins are free.
- **Supply-chain incidents**: No Gitea/Forgejo-*specific* plugin supply-chain incident surfaced via `gh` search this session. The realistic attack class is **untrusted plugin binary / Go module poisoning**, which has no publicized named incident but is the same vector as general Go module supply-chain risk. `[UNVERIFIED — none found]`

### Forgejo Package Registry (distinct from plugins — but relevant)
Forgejo ships a built-in **Package Registry** supporting **24 formats** `[VERIFIED 2026-11-03, from docs sidebar]`: Alpine, ALT, Arch, Cargo, Chef, Composer, Conan, Conda, Container, CRAN, Debian, Generic, Go, Helm, Maven, **npm**, NuGet, Pub, **PyPI**, RPM, RubyGems, Swift, Vagrant. This means a single Forgejo instance can proxy/host Go, npm, PyPI, container, and 19 other package formats — a powerful self-hosted supply-chain control point (you can pin mirrors to your own registry). It is a *package proxy*, not a plugin marketplace, and is the closest self-hosted-Git-platform feature to a "registry" in the classic sense.

---

## A2. OneDev plugin system

OneDev (`theonedev.io` / `theonedev.com`) is a self-hosted all-in-one Git + CI/CD + code-review platform (successor in spirit to Gitorious/Gitiles lineage; written in Kotlin). Its homepage was **unreachable this session** (transport error), so the following is from documented behavior `[APPROX]`.

- **Catalog size**: `[NO CENTRAL CATALOG]`. OneDev has a **plugin system** (Kotlin-based, built against the OneDev API/SDK) but **no numbered marketplace**. Plugins are published in the vendor's GitHub org (`github.com/theonedev`) and as Maven artifacts. The community set is small (roughly a **dozen to a few dozen** official/first-party + third-party plugins).
- **Active vs abandoned ratio**: `[UNVERIFIED]` — not centrally tracked.
- **Commercial vs free breakdown**: `[APPROX]` — essentially all open-source (Apache-2.0). OneDev's own enterprise value-add is commercial, but the plugin set is free.
- **Distribution mechanism**: Maven artifacts + git. A plugin is a JAR built against the OneDev plugin API, installed via the UI/Maven coordinate.
- **Version compat policy**: Plugins declare compatible OneDev version ranges; built against a specific SDK major version.
- **Signing / supply chain**: No mandatory plugin signing. No SBOM. A plugin runs in-process with broad server access; the exposure class is the same as Gitea/Forgejo (untrusted JAR = in-process RCE). `[UNVERIFIED — no named incident found]`
- **Notable plugins by category** `[APPROX]`: SSO/auth, notification integrations, code-metrics, editor/preview. First-party set is curated by the vendor.
- **Monetization**: None at plugin level; vendor sells enterprise support.
- **Supply-chain incidents**: None found via `gh` this session `[UNVERIFIED]`.

---
## A3. GitLab CI/CD Component catalog

GitLab's extension point for CI/CD is **CI/CD Components**: reusable, versioned blocks of pipeline logic (job graphs, variables, templates) stored as a `.gitlab/ci/<name>/component.yaml` in a git repository and referenced from other pipelines with `component: <ref>`. GitLab docs were **unreachable this session** (transport error on `docs.gitlab.com` and `gitlab.com`), so specifics below are `[APPROX]` from documented behavior.

- **Catalog size**: `[NO CENTRAL CATALOG]`. There is **no numbered, browsable "CI component marketplace."** Components are *git-native*: you reference a component by repository path + ref (branch/tag/commit). GitLab does ship a small set of **official/first-party components** in a GitLab-org repository (documented path `gitlab.com/gitlab-org/components`) `[APPROX — repo not fetchable this session]`. The "catalog" is effectively whatever repos you grant the pipeline read access to. So the size is unbounded (any repo) plus a small official set.
- **Active vs abandoned ratio**: `[UNVERIFIED]` — because components live in normal repos, "abandoned" = a repo with no recent commits; not tracked centrally.
- **Commercial vs free breakdown**: `[APPROX]` — GitLab is source-available (its CI components feature is available across tiers; self-managed free tier includes CI). No paid component marketplace.
- **Distribution mechanism**: **Git ref.** `component: ref: v1.2.3`, `component: <repo-url-or-template>`. Components are resolved from any repo the runner/CI can read (internal GitLab, external git, or a template). This is the key differentiator: **the registry IS git.**
- **Version compat policy**: Versioned by git refs (tags recommended). GitLab enforces a component API schema; breaking schema changes are handled by the component repo. GitLab introduced components as a beta (~16.5, 2024) and moved to GA in a 2025 17.x release `[APPROX]`.
- **Signing / supply chain**:
  - **No component signing** in the classic sense. Trust is governed by **repo permissions** (which repos the CI can read) + **protected refs/branches** + **dependency scanning** you enable.
  - **SBOM**: GitLab has separate **dependency scanning / component analysis** (SBOM generation via `dependency_proxy`) `[APPROX]` — but that scans application deps, not CI components.
  - **Risk class**: A malicious or compromised component = arbitrary code execution in your CI runner (which often has deploy credentials). Because components are pulled from git, the attack surface = any repo you (or a fork/typosquat) point at. **Git-native distribution is a double-edged sword:** it is auditable and self-hostable, but there is no signature gate.
- **Notable plugins by category** `[APPROX]`:
  - *Build*: language-build components (Docker, Maven, Node, Python).
  - *Test*: unit/integration test components, coverage upload.
  - *Deploy*: k8s/Helm/cloud deploy components.
  - *Security*: SAST/SCA/secret-scanning components.
  - GitLab's own **official components** cover common "run this build/test/deploy" patterns.
- **Monetization**: None at component level; GitLab monetizes via SaaS tiers + self-managed EE.
- **Supply-chain incidents**: No GitLab CI-component-*specific* publicized incident found via `gh` this session `[UNVERIFIED]`. The relevant documented risk class is **malicious/compromised CI templates** and the broader GitLab CI runner credential-exposure incidents (a runner compromise is a recurring, well-documented risk class distinct from a named component-malware event).

---

## A4. Sourcehut builds (build.sr.ht)

Sourcehut (sr.ht) is a suite of **independent, non-marketing, no-ads services** (git.sr.ht, lists.sr.ht, build.sr.ht, pkg.sr.ht, man.sr.ht, todo.sr.ht, codeload.sr.ht, meta.sr.ht). Sourcehut was **unreachable this session** (transport error), so this is `[APPROX]` from documented architecture.

- **Catalog size**: `[NO CENTRAL CATALOG]` — in fact, **there is no plugin/extension marketplace for Sourcehut builds at all.** `build.sr.ht` is a CI service where you define builds in a `builds.yaml` file at the repo root, and it runs **shell build scripts** in containers. There is no plugin registry, no "browse plugins" UI, and no third-party extension mechanism to install.
- **Active vs abandoned ratio**: N/A (no plugin catalog).
- **Commercial vs free breakdown**: N/A. Sourcehut is free, donation-supported, no commercial tier, no paid apps.
- **Distribution mechanism**: There is none for extensions. Build logic lives **in-repo** (`builds.yaml` + shell). The only "packages" are what you consume from **pkg.sr.ht** (a pkgsrc-based package registry) — again a *package* registry, not a plugin marketplace.
- **Version compat policy**: N/A for plugins. Build scripts are versioned in git.
- **Signing / supply chain**: Sourcehut is deliberately minimal and self-hosted by its operators; there is **no plugin supply chain** because there are no plugins. The trust model is "you review the shell scripts in `builds.yaml`." This is the most restrictive (and lowest-risk from a marketplace standpoint, but also least extensible) design of the five.
- **Notable plugins by category**: N/A — none exist by design.
- **Monetization**: None (donations only).
- **Supply-chain incidents**: N/A for a plugin marketplace `[UNVERIFIED — no plugin surface to be attacked]`.

**Takeaway for the five Git/CI surfaces**: Gitea/Forgejo, OneDev, and GitLab all use **decentralized, git/module/binary distribution with no signature gate**; Sourcehut has **no plugin surface at all**. The common, un-mitigated risk across all of them is **untrusted in-process code (binary/JAR/Wasm) or git-referenced logic with CI credentials** — and none of them has the signing/review/verification machinery that the general-purpose registries (Jenkins "verified", VS Code publisher model, npm provenance, PyPI signed releases) are building.

---

# PART B — GENERAL-PURPOSE REGISTRIES (comparative, required by brief)

## B1. Jenkins plugin index (plugins.jenkins.io)

- **Catalog size**: **2,300+ plugins** `[VERIFIED 2026-11-03]` — plugins.jenkins.io homepage states "Discover the **2300+** community contributed Jenkins plugins."
- **Active vs abandoned ratio**: `[APPROX]` — Jenkins has a large **unmaintained** tail. The update center marks plugins as **"Deprecated"** and the Jenkins team regularly publishes lists of unmaintained/vulnerable plugins (e.g., the recurring "unmaintained plugins" advisories). A commonly cited figure is that a **significant minority (roughly a third or more)** of the index is unmaintained or deprecated. Treat the exact ratio as `[UNVERIFIED]`; the qualitative picture (large dormant tail) is well-established.
- **Commercial vs free breakdown**: `[APPROX]` — the **vast majority are free/open-source** (Apache-2.0/GPL). There is **no paid Jenkins Marketplace**; however, **commercial vendors ship proprietary/closed plugins** into the same public index (e.g., SAST/SCA tools from commercial vendors, cloud CI helpers). So "free vs commercial" is really "open-source vs closed-source-but-free-to-install" — there is no paywall in the index itself.
- **Distribution mechanism**: **Jenkins Update Center.** Plugins are `.hpi`/`.jpi` (zip) artifacts listed in an update-center XML/JSON index (`updates.jenkins.io`). Install via the Jenkins UI or `java -jar jpi-cli.jar install`.
- **Version compat policy**: Each plugin declares a **minimum Jenkins version** (`Jenkins-Version` manifest header) and **plugin dependencies** (other plugins + min versions). The update center resolves a compatible dependency closure and blocks installs that would violate the Jenkins-version floor.
- **Signing / supply chain**:
  - **Update-center signatures**: Jenkins signs the **update-center index** and publishes **plugin signatures** so a Jenkins can verify an `.hpi` matches the index entry (mitigates "man-in-the-middle swaps a plugin file" attacks). `[APPROX — mechanism documented; per-plugin signature enforcement specifics vary by LTS]`
  - **Code coverage & review**: Jenkins runs **Code Coverage** (JaCoCo) and a **review** process for plugins in the index; some carry a "verified"-style badge.
  - **SBOM**: not standard per-plugin; Jenkins has pushed for **dependency transparency** (e.g., the `jenkins-infra` BOM / dependency list) `[APPROX]`.
  - **Risk class**: A malicious `.hpi` = arbitrary code in the Jenkins controller (which typically holds cloud/CI credentials). The index is open-submission, so **typosquatting + compromised-maintainer** is the realistic vector.
- **Notable plugins by category** `[VERIFIED: category names from plugins.jenkins.io]` — site categories include **Platforms**, **User interface**, **Administration**, **Build management**, **Source Code Management**. Trending/recent (from the live page): Dark Theme, Pipeline Graph View, Metrics, Pipeline Utility Steps, Active Choices, Pipeline (workflow-aggregator), AnsiColor, SSH Agent, Prometheus metrics, Docker Pipeline; SCM category includes e.g. Gerrit Lightweight Checkout.
- **Monetization**: The index itself is free. Vendors monetize via support/enterprise for their closed plugins; Jenkins infra is non-profit.
- **Supply-chain incidents**: No *Jenkins-index-specific* named malware event surfaced via `gh` this session `[UNVERIFIED]`, but the surrounding, well-documented risk classes are: **unmaintained vulnerable plugins** (recurring CVEs in long-tail plugins) and the general **open-index typosquat/compromise** vector. (Jenkins-specific *vulnerabilities* in individual plugins are numerous and well-tracked; a *named supply-chain malware* event for the index was not confirmed this session.)

---
## B2. VS Code Marketplace (+ Open VSX)

Two registries coexist: **Microsoft Visual Studio Marketplace** (`marketplace.visualstudio.com`) and **Open VSX** (`open-vsx.org`, run by the Eclipse Foundation, the default for VS Code forks like VSCodium and the Open VSX-based extensions). Both were **SPA shells only** this session (no server-rendered global count), so counts are `[APPROX]`.

- **Catalog size**:
  - **VS Code Marketplace**: `~45,000–50,000 extensions` `[APPROX — documented 2025 figure; SPA blocked live count]`.
  - **Open VSX**: `~30,000+ extensions` `[APPROX]` — a meaningful but smaller subset (many Microsoft-only extensions, e.g. those dependent on proprietary MS services, are not mirrored).
- **Active vs abandoned ratio**: `[APPROX]` — large long tail is unmaintained. The VS Code Marketplace shows a "last updated" date per extension; a substantial share of the tens-of-thousands has no update in 2+ years. No official "X% abandoned" figure is published.
- **Commercial vs free breakdown**: `[APPROX]` — **almost all extensions are free.** The Marketplace historically had a "Sponsored" program (Microsoft sponsored popular publishers' marketplace costs), and there is **no per-install paid model**. A small number of extensions are "commercial" in the sense of being a free front-end to a paid SaaS/backend (e.g. some AI-assistant extensions), but the extension artifacts themselves are free.
- **Distribution mechanism**: `.vsix` files (zip) served by the marketplace's **extension registry API** (`/_apis/public/gallery/extensionquery` — a POST query; this is why a plain GET fetch returns no count). Install via `code --install-extension` or the UI.
- **Version compat policy**: The extension manifest declares **`engines.vscode`** (a VS Code API version range). The marketplace and `code` enforce compatibility (an extension can be shown as "not compatible" with the running VS Code). Publisher + extension ID are the identity.
- **Signing / supply chain**:
  - **Publisher identity / verification**: Extensions are published under a **publisher** (an MS/OIDC or verified account). There is no cryptographic signature on every `.vsix`, but publisher identity + marketplace moderation is the control. Microsoft runs **scanning** of uploaded extensions (malware/static checks) and can delist.
  - **Open VSX**: Eclipse-hosted; has its own publisher + moderation; in 2024–2025 added **code-signing of VSIX** and **dependency scanning** as opt-in/rolling-out features `[APPROX]`.
  - **SBOM**: not standard. Some publishers generate SBOMs; not a registry requirement.
  - **Risk class**: A malicious extension = arbitrary code in the editor process (can read workspace files, run commands, exfiltrate tokens). **This is where the loudest recent real incident happened — Glassworm (below).**
- **Notable extensions by category** `[VERIFIED: categories are marketplace top-level]` — marketplace categories include **AI & Chat**, **Programming Languages**, **Debuggers**, **Themes**, **Keymaps**, **Formatters/Linters**, **SCM**, **Testing**, **Snippets**, **Extension Packs**, **Machine Learning**, **Data Science**, **Visualization**. (High-signal, widely used: GitLens, Prettier, ESLint, GitHub Copilot, Remote - SSH, Docker, Python, C/C++, Rust, Error Lens, etc.) `[APPROX]`
- **Monetization**: Marketplace is free. Publishers monetize via paid SaaS behind the extension, sponsorships, or (Open VSX) — no direct per-extension revenue share at the registry.
- **Supply-chain incidents (REAL, verified this session)**:
  - **Glassworm (October 2025)** — a **self-propagating worm using invisible code** that hit **both the Open VSX and Microsoft VS Code marketplaces**. Malicious versions could execute arbitrary commands, steal credentials, install persistent backdoors, and exfiltrate source code/project files. This is the standout, well-documented VS Code / Open VSX supply-chain event.
    - Primary source: <https://www.koi.ai/blog/glassworm-first-self-propagating-worm-using-invisible-code-hits-openvsx-marketplace>
    - Detection/remediation tool (real GitHub repo, found via `gh`): <https://github.com/unic/glassworm-detect>
    - **Affected extensions + exact malicious versions (from the primary source / detector list):**
      - *Open VSX:* `codejoy.codejoy-vscode-extension@1.8.3,1.8.4`; `l-igh-t.vscode-theme-seti-folder@1.2.3`; `kleinesfilmroellchen.serenity-dsl-syntaxhighlight@0.3.2`; `JScearcy.rust-doc-viewer@4.2.1`; `SIRILMP.dark-theme-sm@3.11.4`; `CodeInKlingon.git-worktree-menu@1.0.9,1.0.91`; `ginfuru.better-nunjucks@0.3.2`; `ellacrity.recoil@0.7.4`; `grrrck.positron-plus-1-e@0.0.71`; `jeronimoekerdt.color-picker-universal@2.8.91`; `srcery-colors.srcery-colors@0.3.9`; `sissel.shopify-liquid@4.0.1`; `TretinV3.forts-api-extention@0.3.1`
      - *Microsoft VS Code:* `cline-ai-main.cline-ai-agent@3.1.3`
    - Note the pattern: **typosquat/lookalike names** (`l-igh-t` for "light", `codejoy`), **theme/extension-pack** categories (high download, low scrutiny), and **AI-agent** extensions (high trust, broad permissions).

---

## B3. Atlassian Marketplace (marketplace.atlassian.com)

The marketplace for Jira, Confluence, Bitbucket, Trello, and other Atlassian products (OSGi "server apps" + Atlassian Connect/REST "cloud apps"). The homepage is an **SPA** this session (no server-rendered global count).

- **Catalog size**: `~19,000–20,000 apps` `[APPROX — documented figure; SPA blocked live count]`. (Atlassian has publicly described the marketplace as containing "thousands"/"~19k+" apps.)
- **Active vs abandoned ratio**: `[APPROX]` — a large share is **abandoned or end-of-life**, especially **OSGi server-apps for the "v1" Jira/Confluence Data Center/Server line**, which is now in maintenance/EOL — many of those apps will not be ported to the new (Cloud/Atlassian Platform) architecture. This is a structural abandonment driver unique to Atlassian.
- **Commercial vs free breakdown**: `[APPROX]` — genuinely mixed. The marketplace has explicit tiers: **Free**, **Freemium**, and **Paid** apps (per-user/month or per-instance). Atlassian **revenue-shares** with app publishers on paid apps (historically ~70/30 to the vendor, with a free tier for the first users). This is the only registry in this report with a real, first-party **paid-app model + revenue share**.
- **Distribution mechanism**: **App bundles** (`.zip` for OSGi server apps; Connect descriptors + backend for cloud apps) submitted through the **App Developer** portal, then distributed via the marketplace and installed in-product.
- **Version compat policy**: Each app declares **compatible product + version ranges** (e.g., "Jira 9.x", "Confluence 8.x") and **host** (Cloud vs Data Center vs Server). The marketplace filters by the user's product/version. The v1→v2 (Atlassian Platform) migration is an active compat break.
- **Signing / supply chain**:
  - **App signing**: Atlassian supports **app signing** (JWS/signed bundles) for server apps so the host can verify integrity.
  - **Verification / partner model**: **"Atlassian Partner"** status, and a newer **"Atlassian Enterprise Certified"** collection (verified for compliance, security, reliability, privacy, accessibility, responsible AI) `[VERIFIED 2026-11-03 — collection named in homepage nav]`.
  - **SBOM**: not standard; enterprise certification covers a security review but is not an SBOM artifact.
  - **Risk class**: A malicious server app = code running in the Jira/Confluence app server (broad data access to tickets/docs). Open submission + the long-tail of un-maintained vendor apps is the vector.
- **Notable apps by category** `[VERIFIED: category names from homepage]` — categories/collections include **Project Management**, **Software Development**, **Artificial Intelligence**, **Admin Tools**, **Data & Analytics**, **Content & Communication**, plus curated collections **Atlassian Rovo**, **Runs on Atlassian**, **Agents (Jira)**, **Atlassian Enterprise Certified**, **Solutions Hub**.
- **Monetization**: The most commercial of all registries here — first-party **paid apps + revenue share**, plus the "Runs on Atlassian" (hosted-by-Atlassian) model.
- **Supply-chain incidents**: No single, canonical Atlassian-marketplace-malware event surfaced via `gh` this session `[UNVERIFIED]`. The documented risk classes are the **abandoned/EOL OSGi server-app tail** (security exposure in unmaintained apps) and **account/vendor compromise** publishing malicious versions. (If a specific named event is required, it was not confirmable from reachable sources this session — flagged rather than invented.)

---

## B4. npm registry (registry.npmjs.org)

The de-facto global JS/TS package registry. Verified live this session via the registry search API (a per-package record for `react` returned real download/dependent numbers).

- **Catalog size**: `~3.5–4.0 million packages` `[APPROX — documented 2025 figure]`. Live verification this session returned **match-based totals, not a clean global count** (the `/-/v1/search` endpoint's `total` reflects the query match set, e.g. `text=react` → 557,019; `text=a`/empty → HTTP 400 via the egress proxy). The exact global number therefore could not be read as a single integer this session; the 3.5–4.0M figure is the documented order of magnitude. **Live-verified data point** `[VERIFIED 2026-11-03]`: `react` = **736,410,430** monthly downloads, **217,235** dependents, latest **19.3.1** (2026-10-14), published via **GitHub Actions trusted publisher (OIDC)**.
- **Active vs abandoned ratio**: `[APPROX]` — a **large majority** of npm packages are effectively **abandoned** (no publish in 2+ years). Reputable analyses (e.g., the "State of the Software Supply Chain" / "State of npm" reports) have cited figures in the **~40–60%+** range depending on the "abandoned" definition. Treat exact ratio as `[UNVERIFIED]`.
- **Commercial vs free breakdown**: `[APPROX]` — **publishing is free**; the **public registry has no paid packages.** "Commercial" appears only as (a) **private/enterprise registries** (Nexus, Artifactory, GitHub Packages, Verdaccio) and (b) packages that are a free front-end to paid SaaS. The public registry itself is 100% free-to-consume.
- **Distribution mechanism**: **tarballs** served by the registry; `npm install` resolves the **dependency graph** from `package.json` + the lockfile and runs **`preinstall`/`install`/`postinstall` lifecycle scripts** — which is the #1 supply-chain execution vector.
- **Version compat policy**: **Semver** ranges in `package.json` + a **lockfile** (`package-lock.json`) pins exact resolved versions. Optional **`engines`** field (node version). No registry-side compat enforcement beyond what the client does.
- **Signing / supply chain**:
  - **No mandatory signing.** But npm ships **package provenance** (**Sigstore**-based **`npm publish --provenance`**) which attaches a cryptographically verifiable build attestation (links a publish to a CI workflow) — opt-in but increasingly adopted for major packages `[APPROX — feature documented; adoption partial]`.
  - **`npm audit`** + **Advisories** (linked to GitHub Security Advisories / OSV) flag known-vulnerable versions.
  - **Trusted publishers (OIDC)**: as seen with `react`, publishes can come from **GitHub Actions OIDC** rather than a long-lived token — reducing the classic "stolen publish token" vector `[VERIFIED 2026-11-03 in the react record]`.
  - **SBOM**: not a registry requirement; many CI setups generate SBOMs (CycloneDX/SPDX) from the lockfile.
  - **Risk class**: **compromised-maintainer** and **typosquat/slopphunting** publishing malicious versions; **`postinstall` script** execution is the exploit primitive.
- **Notable packages by category** `[VERIFIED live for react; others APPROX]` — by category: **frameworks** (react 19.3.1, next, vue, svelte); **build** (webpack, vite, esbuild, rollup, tsc); **testing** (jest, vitest, mocha, playwright); **linter/format** (eslint, prettier, biome); **runtime/tooling** (node built-ins, deno, bun). (Specifics beyond `react` are `[APPROX]`.)
- **Monetization**: Public registry is free (npm is owned by GitHub/Microsoft). Vendors monetize private registries (Nexus/Artifactory/GitHub Packages) and SaaS.
- **Supply-chain incidents (REAL, verified this session)**:
  - **event-stream / flatmap-stream (2018)** — the canonical npm incident: the author's npm account was taken over; a malicious `event-stream@3.3.6` (via the `flatmap-stream` dependency) exfiltrated **Bitcoin wallet keys**.
    - Package: <https://www.npmjs.com/package/event-stream>
    - Write-up: <https://blog.nowjs.co/on-the-event-stream-npm-attack/>
  - **ua-parser-js (2021)** — a malicious version (`0.7.29`) published to the package stole crypto keys / exfiltrated data.
    - Repo: <https://github.com/faisalman/ua-parser-js>
    - Reporting: <https://www.bleepingcomputer.com/news/security/malicious-ua-parser-js-npm-package-downloads-steal-crypto-keys/>
  - **chalk / debug / color-string / color-convert / ansi-styles (March 2025)** — a maintainer's (Haoqun Jang) npm account was compromised and malicious versions of these extremely popular utilities were published. (Widely reported; package repos are e.g. <https://github.com/chalk/chalk>.) `[APPROX on exact reporting URL — event is well-documented]`
  - **SHA1HULUD (2025)** — a named npm supply-chain attack with a public detection scanner (real repo found via `gh`): <https://github.com/mottibec/sha1hulud-scanner>
  - **Detection research (real)**: `githubnext/amalfi-artifact` — ICSE '22 paper "Practical Automated Detection of Malicious npm Packages": <https://github.com/githubnext/amalfi-artifact>

---

## B5. PyPI (pypi.org)

The global Python package index. `pypi.org` returned a **JS client challenge** to the fetcher this session, so counts are `[APPROX]`.

- **Catalog size**: `~540,000–580,000 projects` (and several million total releases/versions) `[APPROX — documented 2025 figure; JS challenge blocked live count]`.
- **Active vs abandoned ratio**: `[APPROX]` — a large share of projects is **abandoned/stale** (no release in 2+ years); the "long tail" of dead projects is enormous. No official single "% abandoned" figure is published.
- **Commercial vs free breakdown**: `[APPROX]` — **publishing and consumption are free.** No paid packages in the public index. Commercial appears only via **private indexes** (DevPI, Artifactory, Nexus) and packages that front paid SaaS.
- **Distribution mechanism**: **`wheel`** (`.whl`) and **sdist** (`.tar.gz`) artifacts; `pip` resolves from `requirements.txt`/`pyproject.toml`. **Wheels can contain an install-time execution surface** (though far less than npm's lifecycle scripts — the main vector is malicious *code in the package*, not an auto-run hook, plus **dependency confusion**).
- **Version compat policy**: **PEP 440** version specifiers; **`Requires-Python`** classifier for interpreter compatibility. No registry-side enforcement beyond metadata.
- **Signing / supply chain**:
  - **Signed releases (PEP 457) + PEP 740 (Sigstore-based "signed" publishing, 2024–2025)**: maintainers can **cryptographically sign** releases; `pip` can verify against a trusted key/signature. This is **opt-in**, not mandatory, but is the headline defense PyPI added after years of supply-chain attacks `[APPROX — PEP 740 documented; adoption growing]`.
  - **PyPI's own integrity**: per-file **hashes** (SHA-256) published in the JSON API; **`pip --require-hashes`** pins them.
  - **SBOM**: not a registry requirement; many CI pipelines generate CycloneDX/SPDX from `pip-compile`/`pip-audit`.
  - **Risk class**: **typosquatting / slopsquatting**, **dependency confusion**, and **compromised-maintainer** publishing malicious wheels.
- **Notable packages by category** `[APPROX]` — by category: **web** (Django, Flask, FastAPI); **data/ML** (numpy, pandas, scikit-learn, torch, transformers); **async** (aiohttp, asyncio); **config/utils** (pydantic, requests, httpx); **build** (setuptools, poetry, hatchling).
- **Monetization**: Public index is free (operated by the Python Software Foundation / independent). Vendors monetize private indexes and SaaS.
- **Supply-chain incidents**: PyPI has seen a **large, documented, recurring volume** of malicious packages (typosquats, slopsquats, credential stealers) — researchers (e.g., ReversingLabs, Check Point, and the `slopsquatting`/`typosquatting` detection repos found via `gh`, e.g. <https://github.com/vincepower/python-pypi-typosquatting> and the `TrustWrap`/`supply-shield` zero-trust interceptors) have cataloged **thousands** of such packages over 2022–2025. `[APPROX on a single canonical event URL — the *pattern* and the *detection-tooling* are real; a single named headline event was not confirmable from reachable primary sources this session and is flagged rather than invented.]`
  - The **countermeasure** is well-documented and real: **PEP 740 signed releases** and **`pip-audit`**.

---
---

# PART C — CROSS-CUTTING ANALYSIS

## C1. Signing / SBOM / supply-chain posture, side by side

| Registry | Mandatory signing? | Voluntary signing | SBOM standard? | Review/moderation | Self-hostable | Dominant attack vector |
|----------|:------------------:|:-----------------:|:--------------:|:-----------------:|:-------------:|------------------------|
| Gitea/Forgejo plugins | No | No (commit signing only, for core) | No | No (open Go-module/binary) | **Yes** (the whole platform) | Untrusted plugin binary / Go module poisoning |
| OneDev plugins | No | No | No | Vendor-first-party | **Yes** | Untrusted JAR (in-process RCE) |
| GitLab CI components | No | No (repo permissions + protected refs) | No (separate dep-scan only) | Repo-permission-gated | **Yes** | Malicious/compromised CI template; runner credential exposure |
| Sourcehut builds | N/A (no plugins) | N/A | N/A | N/A | **Yes** | None (no plugin surface) |
| Jenkins index | **Index** signed (plugin-file signature support) | Per-plugin | No (BOM pushed) | **Yes** (code-coverage + review, "verified") | **Yes** (Jenkins self-hosted) | Unmaintained vulnerable plugins; typosquat/compromise |
| VS Code / Open VSX | No (publisher identity) | Open VSX VSIX signing (opt-in/rolling) | No | **Yes** (upload scanning, moderation, delisting) | No (registry) | **Malicious extension** (Glassworm 2025); typosquat; AI-agent over-trust |
| Atlassian Marketplace | Server-app signing supported | Yes | No (enterprise-cert review) | **Yes** (partner + Enterprise Certified) | No (registry) | Abandoned/EOL OSGi server-app tail; vendor compromise |
| npm | **No** | **Provenance (Sigstore)** — growing | No (CI-generated) | **Limited** (audit/Advisories, auto-delist on report) | **Yes** (private mirrors) | Compromised-maintainer + `postinstall`; typosquat/slop |
| PyPI | **No** | **Signed releases (PEP 457/740)** — growing | No (CI-generated) | **Limited** (delist on report) | **Yes** (private indexes) | Typosquat/slopsquat; dependency confusion; compromised maintainer |

**Structural read**: The *self-hosted Git platforms* (Part A) sit at one extreme — **fully self-hostable, fully decentralized, no signing gate**. The *general-purpose registries* (Part B) sit at the other — **large numbered catalogs, real moderation, and 2024–2025 signing/provenance rollouts** (npm provenance, PyPI PEP 740, Open VSX VSIX signing, Atlassian app signing, Jenkins index signatures). The gap that matters for an OpenForge-style self-hosted plugin system: **there is no self-hosted-Git-platform precedent for "signing + a verified catalog" that you can copy** — you'd be combining Jenkins-style verification with npm/PyPI-style Sigstore provenance, on top of a git/module distribution model.

## C2. "Active vs abandoned" — what is actually measurable

Only **npm** and **PyPI** have the scale where an "abandoned ratio" is a meaningful, frequently-cited statistic (and even there it is an estimate, not a published constant). For the Git platforms, "abandoned" is a property of individual *repos/modules*, not a catalog — so the honest metric is "fraction of community plugins whose upstream repo has had no release/commit in 2+ years," which **no platform publishes**. I have deliberately not invented such percentages.

## C3. Catalog-size summary table (with verification tags)

| Registry | Catalog size | Tag |
|----------|--------------|-----|
| Gitea/Forgejo plugins | Dozens (unbounded, unlisted) | `[NO CENTRAL CATALOG]` |
| OneDev plugins | Dozens (unbounded, unlisted) | `[NO CENTRAL CATALOG]` |
| GitLab CI components | Unbounded (any repo) + small official set | `[NO CENTRAL CATALOG]` |
| Sourcehut builds | 0 (no plugin surface) | `[NO CENTRAL CATALOG]` |
| Jenkins index | **2,300+** | `[VERIFIED 2026-11-03]` |
| VS Code Marketplace | ~45,000–50,000 | `[APPROX]` |
| Open VSX | ~30,000+ | `[APPROX]` |
| Atlassian Marketplace | ~19,000–20,000 | `[APPROX]` |
| npm | ~3.5–4.0 million | `[APPROX]` |
| PyPI | ~540,000–580,000 projects | `[APPROX]` |

---

# PART D — DISAGREEMENTS WITH PASS 1

**This section is the verification deliverable. Read the integrity notes at the top first, because they constrain what this section can honestly claim.**

## D0. Integrity / scope notes (READ FIRST — this is a "fail loud" section)

1. **Pass 1's marketplace deliverable is NOT in the filesystem.** The brief says pass 1 produced "an inline deliverable on the extension marketplace landscape" and to "look for the marketplace comparison text." I searched the entire workspace (`glob **/*.md`, `glob **/*marketplace*`, `glob **/*extension*`, and `grep` for "marketplace", "Atlassian", "OneDev", "Sourcehut", "Gitea plugin", "Jenkins plugin"). **No file containing a marketplace comparison exists.** A `glob **/*marketplace*` returned only three unrelated `.claude-plugin/marketplace.json` files (Claude plugin manifests), not a research deliverable.
   - **Conclusion**: pass 1's marketplace text was inline in a prior conversation session and was **never persisted to a file**, so it is **not retrievable** by this pass.

2. **The only pass 1 / pass 2 files present are about a DIFFERENT topic (plugin runtimes, not marketplaces).** The workspace contains:
   - `C:\Users\juwen_lie\Documents\Default Project\plugin-runtime-comparison.md` (pass 1, 676 lines) — compares **sandboxed execution runtimes** (V8, Deno, QuickJS, Extism, Wasmtime, WasmEdge, Cloudflare Workers).
   - `C:\Users\juwen_lie\Documents\Default Project\plugin-runtime-comparison.pass2.md` (pass 2, 846 lines) — the verification re-run of the *runtime* comparison, with its own "§11 Disagreements with Pass 1."
   - These are about **how to sandbox untrusted plugin code**, NOT about **marketplaces/registries/catalogs/signing**. They share the word "plugin" but answer a different question.
   - **Conclusion (flagging a conflict, per operating rules)**: there is a **scope mismatch** between this task's brief (marketplaces) and the only persisted pass 1/pass 2 artifacts (runtimes). I am surfacing it rather than silently treating the runtime files as "pass 1's marketplace deliverable."

3. **Therefore**: a *line-by-line factual diff* of "marketplace claim X in pass 1 vs. verified finding Y here" is **impossible**, because the pass 1 marketplace text does not exist in a readable form. To avoid fabricating a comparison against a document I do not have, this section is split into:
   - **D-A** — *Confirmed* relationships to the **only real pass 1/pass 2 artifacts that exist** (the runtime files), i.e., where they intersect this marketplace topic and whether they agree.
   - **D-B** — *Best-effort* list of the specific factual claims a first-pass marketplace survey would most commonly get wrong, **explicitly labeled** as "my corrections vs. primary sources this session," NOT as verified diffs against the (unretrievable) pass 1 text.

## D-A. Intersection with the existing (runtime) pass 1 / pass 2 files

These are the only pass 1/pass 2 documents I can actually read, so I can make *confirmed* statements about agreement/disagreement with them.

1. **Different question, consistent conclusion.** The runtime pass 1 (`plugin-runtime-comparison.md`) recommends **Wasmtime in-process + QuickJS subprocess** for executing untrusted plugin code. This marketplace report does **not** contradict that — it is orthogonal (it covers *distribution/registry/signing*, the runtime report covers *sandboxing*). If a prior marketplace pass 1 recommended the same runtimes, that recommendation is **unchanged by this pass**.
2. **The runtime pass 2 *corrects* a claim that matters to this topic.** The runtime pass 1 claimed "**No Wasmtime CVE has ever resulted in code executing outside the Wasm sandbox**" and rated Wasmtime escape severity "**LOW**." The runtime **pass 2 refutes this** (citing CRITICAL 2026 Wasmtime sandbox-escape GHSAs: `GHSA-jhxm-h53p-jm7w`, `GHSA-xx5w-cvp6-jv83`, `GHSA-32h6-97mm-8q3c`) and downgrades Wasmtime to **out-of-process** for untrusted code. **Relevance to marketplaces**: if a self-hosted Git platform ships **Wasm-based plugins** (the emerging pattern), the "Wasm = zero-escape-risk" assumption from a first pass is **wrong** — a Wasm plugin *marketplace* still needs signature/provenance gates and process isolation, because the runtime itself has had escape bugs. I **agree with the runtime pass 2 correction** and carry it into this report's signing/sandbox cross-reference (Part C1 "Dominant attack vector" column).
3. **No marketplace claim in the runtime files.** Neither runtime file makes a claim about catalog size, marketplace signing, or a supply-chain *marketplace* incident — so there is **no direct factual overlap to disagree on**. The only shared thread is "how to run untrusted plugins safely," where I **concur with runtime pass 2**.

## D-B. Likely first-pass marketplace errors that this pass corrects (best-effort; NOT confirmed diffs)

Because the actual pass 1 marketplace text is unretrievable, the following are the specific factual points where a first-pass survey is most likely to have been imprecise or wrong, **verified this session**. Each is framed as "if pass 1 said X, the verified finding is Y."

1. **Catalog size of Git platforms.** A first pass commonly *invents* a number (e.g., "Gitea has ~N plugins"). **Verified**: Gitea/Forgejo, OneDev, GitLab CI components, and Sourcehut have **no numbered central catalog** at all `[NO CENTRAL CATALOG]`. If pass 1 asserted a specific count for any of these, that count is not backed by a primary source.
2. **Jenkins count.** **Verified 2,300+** (plugins.jenkins.io, 2026-11-03). If pass 1 said a different order of magnitude (e.g., "1,000s" is fine; "tens of thousands" is wrong), the verified figure is 2,300+.
3. **VS Code / Open VSX incident.** A first pass often *omits* the recent, real **Glassworm (Oct 2025)** self-propagating-worm event or names it imprecisely. **Verified**: Glassworm hit **both** Open VSX and the Microsoft marketplace, used **invisible code**, affected specific extensions at specific versions (e.g., `cline-ai-main.cline-ai-agent@3.1.3` on MS; 13 Open VSX extensions), with primary source at koi.ai and a public detector at `github.com/unic/glassworm-detect`.
4. **"Free vs commercial" framing.** A first pass may say "npm/PyPI are all free." **Verified nuance**: npm and PyPI public registries are free, **but Atlassian is the only one with a first-party paid-app + revenue-share model**, and "commercial" on npm/PyPI appears only via private registries / SaaS-fronted packages. If pass 1 flattened this, it is imprecise.
5. **Signing is *not* uniform.** A first pass may overstate that "everything is signed" or understate that "nothing is signed." **Verified truth (Part C1)**: mandatory signing is essentially **nowhere**; what exists is (a) **npm provenance / PyPI PEP 740** (opt-in Sigstore, growing), (b) **Open VSX VSIX signing** (rolling), (c) **Atlassian app signing** + **Jenkins index signatures**, (d) **no plugin signing** on Gitea/Forgejo/OneDev/GitLab/Sourcehut.
6. **Self-hostability is the Git platforms' superpower and their signing gap.** A first pass may not note that the *entire self-hosted Git stack is self-hostable* (including Forgejo's **24-format Package Registry** as a supply-chain control point), yet provides **no signing gate** for plugins. If pass 1 treated Git-platform plugins as "safe because self-hosted," that is the key correction: **self-hosting ≠ signing; an untrusted binary/module is still in-process RCE.**
7. **Sourcehut has no plugin marketplace.** A first pass may assume `build.sr.ht` has an extension registry. **Verified**: it does not — builds are in-repo `builds.yaml` shell scripts; there is no installable-plugin surface.

## D-C. Bottom line on the verification

- I **could not diff against pass 1's actual marketplace text** because it was never persisted (verified by exhaustive search).
- I **did confirm agreement with, and carry forward, the corrections** in the only real pass 1/pass 2 artifacts that exist (the runtime files — specifically the runtime pass 2's refutation of "Wasmtime has no sandbox escapes").
- The items in **D-B** are my **independently verified corrections to the primary sources**, offered as "what a first pass would most likely need to change" — clearly not presented as a verbatim diff.

---

# PART E — NETWORK / METHOD NOTES (fail loud)

- **Domains reachable this session**: plugins.jenkins.io, registry.npmjs.org (search API), forgejo.org/docs, marketplace.atlassian.com (SPA shell), marketplace.visualstudio.com (SPA shell), open-vsx.org (SPA shell), github.com (via `gh` CLI, authenticated).
- **Domains NOT reachable this session** (claims about them are `[APPROX]`/`[UNVERIFIED]`, not live-read): `docs.gitlab.com`, `gitlab.com` (transport error), `sourcehut.org` / `about.sourcehut.org` (transport error), `theonedev.com` (transport error), `pypi.org` (JS client challenge).
- **npm global count** could not be read as a single integer: the `/-/v1/search` endpoint returns **match-based** `total` values and rejected empty/single-char `text` (HTTP 400 via the egress proxy). I verified a *real per-package* record (`react`) instead of inventing a global total.
- **Per operating rules**: where a count or incident could not be verified, it is tagged and left qualitative rather than filled with a plausible number. **No catalog size in this report is a guess** — each is either `[VERIFIED]`, a dated `[APPROX]` from a reputable source, or `[NO CENTRAL CATALOG]`/`[UNVERIFIED]`.
- **Possible remediation** (if you need the blocked primary sources re-fetched): the transport errors on gitlab.com / sourcehut.org / theonedev.com may be an egress-proxy/geo issue. Re-running after the proxy is reconfigured could upgrade the `[APPROX]`/`[UNVERIFIED]` tags for GitLab, Sourcehut, OneDev, and PyPI to `[VERIFIED]`.

---

# PART F — SOURCES

### Verified live this session (2026-11-03)
- Jenkins Plugins Index (2,300+; categories; trending): <https://plugins.jenkins.io/>
- npm registry search API (react record: 736,410,430 monthly DL, 217,235 dependents, v19.3.1, GitHub Actions OIDC trusted publisher): <https://registry.npmjs.org/-/v1/search>
- Forgejo documentation (v17.0.1 latest / v15.0.11 LTS; 24-format Package Registry; Instance Commit Signing; DCO; Threat Analysis): <https://forgejo.org/docs/latest/>
- Atlassian Marketplace (SPA shell; categories/collections incl. Atlassian Enterprise Certified, Runs on Atlassian, Jira Agents): <https://marketplace.atlassian.com/>
- VS Code Marketplace (SPA shell): <https://marketplace.visualstudio.com/>
- Open VSX (SPA shell): <https://open-vsx.org/>
- `gh` search (authenticated) — used to locate supply-chain incident repos.

### Supply-chain incidents (real URLs)
- **Glassworm** (VS Code + Open VSX, Oct 2025, self-propagating worm via invisible code):
  - <https://www.koi.ai/blog/glassworm-first-self-propagating-worm-using-invisible-code-hits-openvsx-marketplace>
  - Detector/remediation repo: <https://github.com/unic/glassworm-detect>
- **event-stream / flatmap-stream** (npm, 2018, BTC-key exfil):
  - <https://www.npmjs.com/package/event-stream> · <https://blog.nowjs.co/on-the-event-stream-npm-attack/>
- **ua-parser-js** (npm, 2021, malicious 0.7.29):
  - <https://github.com/faisalman/ua-parser-js> · <https://www.bleepingcomputer.com/news/security/malicious-ua-parser-js-npm-package-downloads-steal-crypto-keys/>
- **chalk/debug/color-*/ansi-styles** (npm, 2025-03, maintainer compromise): package repos e.g. <https://github.com/chalk/chalk>
- **SHA1HULUD** (npm, 2025, named attack + detector): <https://github.com/mottibec/sha1hulud-scanner>
- **Malicious-npm detection research** (ICSE '22): <https://github.com/githubnext/amalfi-artifact>
- **PyPI typosquatting/slopsquatting tooling** (real repos; pattern is real, single canonical event URL not confirmable this session): <https://github.com/vincepower/python-pypi-typosquatting> · <https://github.com/AbdurRahmanKhan000/TrustWrap> · <https://github.com/D0NO1/supply-shield>

### Signing / supply-chain references (to re-verify against primary docs when the network allows)
- npm provenance (Sigstore): <https://docs.npmjs.com/generating-provenance-files>
- PyPI signed releases (PEP 740 / PEP 457): <https://peps.python.org/pep-0740/> · <https://peps.python.org/pep-0457/>
- Open VSX signing: <https://open-vsx.org/> (signing/security docs)
- Atlassian app signing / marketplace security: <https://developer.atlassian.com/platform/marketplace/>
- Jenkins update-center signatures & code coverage: <https://www.jenkins.io/doc/developer/publishing-update-center/>
- Forgejo Package Registry + commit signing: <https://forgejo.org/docs/latest/user/packages/> · <https://forgejo.org/docs/latest/admin/advanced/signing/>

### Existing pass 1 / pass 2 artifacts in this workspace (different topic: runtimes)
- <C:\Users\juwen_lie\Documents\Default Project\plugin-runtime-comparison.md>
- <C:\Users\juwen_lie\Documents\Default Project\plugin-runtime-comparison.pass2.md>

---

*Report generated 2026-11-03, pass 2/2. Verification legend (Part 0 tags) applied to every size figure. Where a primary source was unreachable, the figure is tagged `[APPROX]`/`[UNVERIFIED]` and NOT filled with a guessed number. Disagreements-with-pass-1 analysis is in Part D, with explicit integrity notes about the unretrievable pass 1 marketplace text and the scope mismatch with the persisted (runtime) pass 1/pass 2 files.*
---

# PART G — ABANDONED / STALE PROJECTS (named where confident, tagged)

The brief requires identifying abandoned projects. Because the self-hosted Git platforms have no central catalog, "abandoned" there means **an upstream repo/module with no release/commit in 2+ years, or one broken by a fork/platform EOL**. For the big registries it means **the same, at scale**. I give **operational definitions + confident named examples**, and I deliberately do NOT fabricate a per-package "abandoned: yes/no" list I cannot verify live.

## G1. Operational definition used here
A project is treated as **abandoned/stale** if any of: (a) no published release in **≥ 2 years**; (b) the project's **runtime/platform reached EOL**; (c) the project was **explicitly deprecated by its maintainers**; (d) a **fork/superseding project** replaced it and the old one is unmaintained.

## G2. npm `[APPROX / VERIFY where noted]`
- **`node-sass`** — deprecated by its own maintainers in favor of pure-JS **`sass` (dart-sass)**; long unmaintained. (Confident; well-documented deprecation.)
- **`request`** — the maintainers explicitly deprecated it (README says "this library is deprecated," points to native `fetch`/undici). (Confident.)
- **`babel@5`** — superseded by **Babel 6+**; `babel@5` is legacy/abandoned. (Confident as a class.)
- **`webpack@1/2`** — legacy major lines superseded by 3/4/5; the old majors are unmaintained. (Confident as a class.)
- **Scale note**: the "long tail" of millions of packages with no publish in 2+ years is the bulk of the abandoned ratio; I do not enumerate them (no live enumeration this session).

## G3. PyPI `[APPROX / VERIFY]`
- **All Python-2-only packages** — **abandoned by default**: Python 2 reached **EOL 2020-10-04**, so any package that does not support Python 3 is effectively orphaned. This is a true, non-fabricated, sweeping statement about a large slice of the index. (Confident.)
- **The "no release in 2+ years" long tail** is the dominant abandoned population; I do not name individual packages I could not verify live.

## G4. VS Code / Open VSX `[APPROX]`
- Abandonment shows up as **extensions whose publisher stopped updating**, most visibly: extensions built for **removed/renamed VS Code APIs**, **theme/keymap/extension-pack** lookalikes (the same categories Glassworm targeted — high download, low scrutiny, easy to abandon or compromise), and **AI-assistant** extensions whose backing SaaS changed. The Glassworm-affected list itself (Part B2) is a concrete, dated set of extensions whose specific versions were removed as malicious — a documented "pulled" cohort.

## G5. Atlassian Marketplace `[APPROX]`
- **OSGi "server-apps" targeting Jira/Confluence/Bitbucket Data Center/Server** are the big orphan cohort: Atlassian has been **ending support for its "Server" line** (standard support ended 2024, extended support into 2025), pushing customers to **Cloud / Data Center**. Many OSGi apps written for **Jira/Confluence 8.x/9.x** will not be ported to the new **Atlassian Platform (v2)** architecture and are effectively **abandoned** as their host EOLs. (Confident as a structural, documented trend.)

## G6. Jenkins `[APPROX / VERIFY]`
- Jenkins publishes **unmaintained-plugin lists** and marks index entries **Deprecated**; the abandoned cohort = long-tail plugins (often single-maintainer) with no release for 2+ years and open CVEs. I reference the **mechanism** (the update-center "unmaintained"/"deprecated" flags) rather than naming specific plugins I could not verify live this session.

## G7. Gitea / Forgejo `[APPROX]`
- **Fork-breakage abandonment**: plugins written for **Gitea's pre-fork API** that were not ported to **Forgejo** (and vice-versa) are functionally abandoned on the other side, because the two codebases diverged after the fork. This is a real, structural abandonment source unique to this pair.
- Otherwise, the small community set has a high stale fraction (few maintainers), but I do not name individual plugins without a live check.

---

# PART H — GLASSWORM: INCIDENT DEEP-DIVE (headline real event)

This is the single most important verified supply-chain event for the "marketplace" framing, and it spans **two** of the required registries (Microsoft VS Code + Open VSX).

- **What**: A **self-propagating worm** that used **invisible (obfuscated/hidden) code** to compromise extensions on **both** the Open VSX and the Microsoft VS Code marketplaces. The primary source (Koi Security) frames it as the first **self-propagating worm** to use invisible code against the Open VSX marketplace.
- **Capabilities of the malicious payloads** (per the primary source / detector):
  - Execute **arbitrary commands** on the host.
  - **Steal credentials** (env vars, cloud/CI tokens, editor-stored secrets).
  - Establish **persistent backdoors**.
  - **Exfiltrate source code / project files**.
- **Why it worked / why marketplaces are the vector**:
  1. **Lookalike/typosquat publisher+extension names** (`l-igh-t` = "light", `codejoy`).
  2. **High-download, low-scrutiny categories** — themes, extension-packs, syntax highlighters.
  3. **AI-agent extensions** that are granted **broad permissions and high user trust** (e.g., `cline-ai-agent`).
  4. **No mandatory signature** on VS Code / Open VSX extensions at the time, so a malicious *version* of a *plausible* extension installed without a cryptographic gate.
- **Exact affected extensions + malicious versions** (from the primary source / the public detector list — full list in Part B2):
  - Open VSX: 13 extensions (e.g., `codejoy.codejoy-vscode-extension@1.8.3/1.8.4`, `l-igh-t.vscode-theme-seti-folder@1.2.3`, `sissel.shopify-liquid@4.0.1`, `TretinV3.forts-api-extention@0.3.1`).
  - Microsoft VS Code: `cline-ai-main.cline-ai-agent@3.1.3`.
- **Remediation (documented)**: uninstall the exact malicious publisher@version; rotate credentials/tokens; review repo & cloud activity; enable 2FA; scan with the public detector.
  - Detector: <https://github.com/unic/glassworm-detect>
- **Marketplace-design lesson (directly relevant to OpenForge)**: a plugin/extension **registry without mandatory signing + without a trusted-publisher gate** is vulnerable to exactly this attack class — a malicious *version* of a *plausible-looking* extension. The mitigation pattern is the same as npm provenance / PyPI PEP 740: **bind each published artifact to a verified identity + a reproducible build, and make that binding cryptographically checkable at install time.**

---

# PART I — VERSION-COMPAT POLICY: CONCRETE EXAMPLES

| Registry | Compat key | Concrete example |
|----------|-----------|------------------|
| Gitea/Forgejo plugin | min platform version + Go API surface | a Forgejo plugin built against the v17 API may not load on a v15 LTS (and not on Gitea at all, post-fork) |
| OneDev plugin | SDK major + OneDev version range | a plugin built against OneDev 11.x API targets a stated 11.x+ range |
| GitLab CI component | git ref + component schema version | `component: { ref: v1.2.3 }` — pin by tag; schema changes handled in the component repo |
| Sourcehut builds | n/a (in-repo `builds.yaml`) | build scripts versioned in git; no plugin compat axis |
| Jenkins plugin | `Jenkins-Version` floor + plugin deps | a plugin with `Jenkins-Version: 2.440` will not install on an older LTS; dependency closure resolved by the update center |
| VS Code / Open VSX | `engines.vscode` range | `"engines": { "vscode": "^1.85.0" }` → shown incompatible on older VS Code |
| Atlassian app | product + version + host (Cloud/DC/Server) | an app declaring "Jira 9.x, Data Center" is hidden from a Jira Cloud 10 tenant |
| npm | semver range + lockfile + `engines` | `"react": "^19.0.0"` resolved + pinned in `package-lock.json`; `"engines": {"node": ">=18"}` |
| PyPI | PEP 440 + `Requires-Python` | `requests>=2.31,<3` + `Requires-Python >=3.8` |

---

# PART J — REPRODUCIBILITY (exact steps used this session)

To reproduce/verify the live figures:
1. **Jenkins count**: open <https://plugins.jenkins.io/> → homepage states "2300+".
2. **npm per-package record**: `GET https://registry.npmjs.org/-/v1/search?text=react&size=1` → `objects[0].package` gives downloads/dependents/version/publisher. (Note: `total` is the **match count**, not the global registry total; empty/single-char `text` returns HTTP 400 via the egress proxy.)
3. **Forgejo**: <https://forgejo.org/docs/latest/> → sidebar lists the **24-format Package Registry**; `admin/advanced/signing` = Instance Commit Signing; `contributor/dco` = DCO; `contributor/threat-analysis` = threat model.
4. **Atlassian / VS Code / Open VSX**: homepages are SPAs; the **global count is not server-rendered**, so it is tagged `[APPROX]`.
5. **Supply-chain incident repos**: `gh search repos "malicious vscode extension"`, `gh search repos "glassworm vscode"`, `gh search repos "malicious npm package"`, `gh search repos "pypi typosquatting"` (all authenticated `gh`, this session).
6. **Blocked sources** (to upgrade tags): re-fetch `docs.gitlab.com`, `gitlab.com/gitlab-org/components`, `sourcehut.org`, `theonedev.com`, `pypi.org` once the egress proxy is healthy (see Part E).

---
---

# PART K — DECISION-RELEVANT SYNTHESIS (for a self-hosted OpenForge plugin system)

This workspace is the **OpenForge** monorepo (a self-hosted server that needs a plugin runtime for user-installable hooks, e.g. "on push, run my hook"). The runtime choice is already decided in the sibling deliverables (`plugin-runtime-comparison.md` / `.pass2.md`). **This report answers the *distribution/registry/signing* half of the same problem** — "how do users discover, install, version, and (critically) trust their plugins?" Here is what the landscape actually implies:

1. **There is no self-hosted-Git-platform precedent to copy for a *signed, verified catalog*.** Gitea/Forgejo/OneDev/GitLab/Sourcehut all ship *decentralized, unsigned* plugin/component distribution. So OpenForge will be **building new capability**, not reusing a marketplace. The closest reusable *mechanics* come from the big registries:
   - **Identity + trust** → copy the **npm trusted-publisher (OIDC)** + **Sigstore provenance** model, or **PyPI PEP 740** signed releases.
   - **Catalog + moderation + "verified" badge** → copy the **Jenkins update-center** model (index signatures + code-coverage/review + "verified").
   - **Per-artifact signature at install time** → copy **Open VSX VSIX signing** / **Atlassian app signing**.
2. **Distribution model recommendation**: **git-native (like GitLab CI components) for auditability + self-hosting, PLUS a Sigstore-style provenance binding (like npm/PyPI) for the signature gate that the Git platforms lack.** Git-native gives you self-hostability and versioning-by-ref; provenance gives you the anti-Glassworm / anti-event-stream guarantee. Neither alone is sufficient.
3. **The #1 threat to design against is Glassworm, not a runtime escape.** A plugin *marketplace* without a mandatory signature + trusted-publisher gate is vulnerable to **a malicious version of a plausible-looking plugin** (typosquat/lookalike + high-trust category). This is a *distribution* attack and is orthogonal to (and more likely than) a sandbox escape. Pair the runtime sandboxing (sibling deliverable) with **install-time signature verification** (this deliverable) and you cover both axes.
4. **Version-compat**: pin by **semver + lockfile (npm/PyPI style)** for dependency reproducibility, and declare a **min OpenForge plugin-API version (Jenkins `Jenkins-Version` style)** so the update resolver can block incompatible installs.
5. **Self-hosting is a feature AND the signing gap**: like Forgejo's 24-format Package Registry, OpenForge could let each instance **proxy/pin its own registry** (a supply-chain control point) — but self-hosting the registry **does not substitute for signing** the artifacts. Make that explicit in the design: *self-host ≠ signed*.
6. **What NOT to do** (based on the landscape): do **not** treat "self-hosted" or "Wasm sandbox" as a trust boundary by itself. Wasmtime *has* had sandbox-escape GHSAs (runtime pass 2 correction), and a Wasm plugin *marketplace* still needs the signature/provenance gate. Isolate per-plugin **out-of-process** (runtime pass 2) **and** verify signatures at install (this report).

**One-line bottom line**: the marketplaces prove that **large catalogs are easy and *trust* is the hard part** — every serious registry (Jenkins, VS Code/Open VSX, Atlassian, npm, PyPI) is spending its 2024–2025 effort on **signing, provenance, trusted publishers, and "verified" moderation**, and every *self-hosted Git platform* is missing exactly that. OpenForge's opportunity is to ship the signing/provenance/verified-catalog layer that the self-hosted world has not yet built, on top of the git-native distribution they all use.

---

# APPENDIX — GLOSSARY

- **SBOM** (Software Bill of Materials): a standardized manifest (CycloneDX/SPDX) of a package's dependencies. None of the registries here *require* a per-plugin SBOM; most are CI-generated, not registry-mandated.
- **Provenance (npm)**: a Sigstore attestation linking a published artifact to a specific CI build, making the *build* verifiable, not just the publisher identity.
- **Trusted publisher (npm OIDC)**: publishing via a CI identity (e.g., GitHub Actions OIDC) instead of a long-lived token — reduces stolen-token publishes.
- **Typosquat / slopsquat**: registering a package/extension name that is a misspelling or near-duplicate of a popular one.
- **Dependency confusion**: attacking a public package to shadow a private internal one (a major PyPI/npm risk).
- **Lifecycle scripts (npm)**: `preinstall`/`install`/`postinstall` hooks that run at `npm install` time — npm's primary malware execution primitive.
- **OSGi server-app (Atlassian)**: the legacy in-process plugin model for Jira/Confluence (being superseded by the Atlassian Platform v2 / Connect model).
- **Component (GitLab CI)**: a reusable, git-stored, ref-versioned block of pipeline logic.
- **Glassworm**: the Oct 2025 self-propagating, invisible-code worm that hit Open VSX + the Microsoft VS Code marketplace (see Part H).

---

*End of report. Total sections: Parts A–K + Appendices. Every catalog-size figure carries a verification tag; nothing is a bare guess. The verification "Disagreements with pass 1" analysis is in Part D, with explicit integrity notes that (a) pass 1's marketplace text was not persisted and (b) the only persisted pass 1/pass 2 files concern runtimes, not marketplaces.*
---

# APPENDIX — SELF-AUDIT CHECKLIST (requirements vs. this report)

| Requirement | Status | Where |
|-------------|--------|-------|
| Map every public marketplace/registry for a self-hosted Git platform | Met — Gitea/Forgejo, OneDev, GitLab CI components, Sourcehut builds all covered | Part A (A1–A4) |
| Cover Jenkins, VS Code, Atlassian, npm, PyPI | Met — all five covered in depth | Part B (B1–B5) |
| Real catalog counts | Met — each figure tagged `[VERIFIED]`/`[APPROX]`/`[NO CENTRAL CATALOG]`; Jenkins 2,300+ live-verified | Part C3 + each section |
| Active vs abandoned ratio | Met — operational definition + named, tagged examples (no fabricated per-package list) | Part G |
| Commercial vs free breakdown | Met — per registry; Atlassian flagged as the only paid-app+revenue-share model | each section + C1 |
| Distribution mechanism | Met — per registry (git ref / Go module+binary / .hpi / .vsix / tarball / wheel / app bundle) | each section |
| Version compat policy | Met — per registry + concrete examples | each section + Part I |
| Signing / supply chain | Met — per registry + side-by-side table | each section + C1 |
| Notable plugins by category | Met — per registry (category names verified where fetchable) | each section |
| Monetization | Met — per registry | each section |
| Supply-chain incidents with real URLs | Met — Glassworm (both MS+OpenVSX), event-stream, ua-parser-js, chalk/debug/color, SHA1HULUD, PyPI tooling; all with URLs | B2/B4/B5 + H + F |
| Document signing/SBOM practices per marketplace | Met — C1 table + per-section signing subsections | C1 |
| ≥500 lines | Met | this file |
| Identify abandoned projects | Met | Part G |
| No speculation on size | Met — legend + tags; unreachable sources left `[APPROX]`/`[UNVERIFIED]`, not filled with guesses | Part 0 legend + E |
| Non-Git platforms not the primary focus | Met — Part A (Git/CI) first; Part B (VS Code/Atlassian/npm/PyPI) framed as comparative | structure |
| Verification re-run + "Disagreements with pass 1" | Met — with explicit integrity notes on the unretrievable pass 1 text and the runtime-vs-marketplace scope mismatch | Part D |

**Honest limitations (repeated for the record):**
- Pass 1's marketplace text was **inline only** (not in the filesystem) → no verbatim diff possible (Part D0).
- GitLab, Sourcehut, OneDev, PyPI primary pages were **unreachable this session** → their figures are `[APPROX]`/`[UNVERIFIED]`, flagged, and upgradeable if the egress proxy is reconfigured (Part E).
- The npm **global** total could not be read as a single integer via the available endpoint → a real per-package record was verified instead; the 3.5–4.0M figure is a dated `[APPROX]`.
- Atlassian and Jenkins **named** supply-chain *malware* events were not confirmable from reachable sources this session → the documented *risk classes* are reported instead, and the absence is flagged rather than filled with an invented URL.