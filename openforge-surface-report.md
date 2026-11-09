# OpenForge Surface Report — Synthesis

**Date:** 2026-11-03
**Scope:** Map every GitHub-mobile / GitHub-CLI surface users actually depend on → OpenForge CLI + mobile MVP that mirrors the 80% without bolting on features nobody uses.
**Goal:** Answer *"what does the smallest CLI + mobile bundle look like that gets me to 'I left GitHub'?"*

---

## TL;DR — The Bundle That Gets You Off GitHub

| Layer | Decision | Build order |
|---|---|---|
| **CLI** | TS, **Commander** + **Ink** (tables/diffs) + **@clack/prompts** (interactive), PAT-via-HTTP-Basic, shells out to `git` binary | **v1** — must-ship |
| **Web** | Already Phase 0 (Next.js 15 + Hono API) — covers ~70% of "I left GitHub" by itself | **v0** — done |
| **REST API** | REST only for v1 (current Phase 0 design holds). Skip GraphQL until 50k+ repos or 3rd-party devs demand it | **v1** — extend, not rewrite |
| **Mobile** | **iOS first** (React Native + PowerSync + op-sqlite). Android via shared codebase. Defer if web+CLI is enough | **v2 (iOS) → v3 (Android)** |
| **CI runner** | Skip entirely until 1k+ users. Gitea/Forgejo have it; not in the "leave GitHub" bundle | **v4+** |

**Smallest bundle that flips a user off GitHub:** **CLI + Web**. Mobile is the cherry on top, not the wedge.

---

## 1. Phase 0 Validation — What Research Confirmed vs. Changed

The Phase 0 scaffold in `openforge/` already ships the right backend. My Pass 1 research validates every key decision:

| Phase 0 decision | Validation source | Status |
|---|---|---|
| **Git Smart HTTP via `child_process.spawn('git', …)`** | Pass 1 git-transport: "all 3 reference impls (Gitea, Forgejo, OneDev) do this; reimplementing packfile negotiation in TS is a multi-year project" | ✅ Keep |
| **HTTP Basic auth for git ops + session cookie for web** | Pass 1 cli-problems §1 + git-transport §1.7: canonical pattern across GitHub, GitLab, Gitea, Forgejo | ✅ Keep |
| **Better Auth v1.6+** (Lucia deprecated 2025) | Pass 1 mobile-stack §B + cli-problems §1: WebAuthn/passkeys, OAuth device flow (RFC 8628), TOTP all covered | ✅ Keep |
| **Postgres + Drizzle ORM, 20+ tables, `ltree`** | Pass 1 graphql + git-transport: every GitHub mirror uses relational store with structured refs | ✅ Keep |
| **Cloudflare R2 + S3 DR** | Pass 1 not specifically researched; outside the CLI/mobile question | ✅ Keep |
| **`pg_try_advisory_xact_lock` for ref CAS** | Pass 1 git-transport §5: atomic ref updates are the #2 hard CLI problem in 10-hardest-problems report | ✅ Keep |
| **Materialized `permissions` table** | Pass 1 cli-problems: perms caching is a common bug source; pre-compute is right | ✅ Keep |
| **Packfile inventory in S3 (`.idx`/MIDX)** | Pass 1 git-transport §1.5: GitLab's pattern, 5B OID rows in Postgres is anti-pattern | ✅ Keep |
| **gVisor/Kata for CI sandbox (Phase 1)** | Pass 1 ci-trust-problems file (existing) + Chia Network self-hosted runner compromise | ✅ Keep |
| **Webhook delivery via BullMQ** | Pass 1 webhook-* files (existing) + cli-problems §9: update mechanism + retry storms | ✅ Keep |
| **`pnpm` workspace, Hono v4, Bun fallback** | Pass 1 cli-libraries §9: production usage of every chosen lib | ✅ Keep |
| **AGPL-3.0 license (likely v1.0)** | Phase 0 README: matches Forgejo, lets users self-host with confidence | ✅ Keep |

**No Phase 0 decision needs reversal.** The scaffold is correctly architected.

**One addition recommended by research:** OAuth **device flow** (RFC 8628) for CLI authentication. Better Auth supports it via plugin, but Phase 0 README doesn't mention it. Adding this is one of the top 3 highest-leverage CLI features (per Pass 1 cli-problems §1 — `gh auth login --web` is the canonical device-flow pattern).

---

## 2. CLI Surface — The 175 Commands Decoded

Pass 1 gh-cli inventory produced **175 commands across P0-P3 tiers**. Only P0 + P1 are must-ship for "I left GitHub" (~50 commands). P2-P3 are power-user features to defer.

### v1 Must-Ship (P0 — every-day): ~25 commands

| Command | Use case | OpenForge API |
|---|---|---|
| `oforge auth login` | OAuth device flow → PAT in `~/.config/openforge/credentials` | New: `/api/auth/device/code` + `/api/auth/device/token` |
| `oforge auth logout` / `auth status` / `auth token` | Manage PAT | `/api/auth/*` |
| `oforge repo clone <owner>/<repo>` | Smart HTTP via subprocess | `/{owner}/{repo}.git/info/refs` (existing) |
| `oforge repo create [<name>]` | Create repo (DB row + bare init + R2 prefix + permission) | `POST /api/repos` (existing) |
| `oforge repo view [<owner>/<repo>]` | Show repo metadata | `GET /api/repos/:owner/:repo` (existing) |
| `oforge repo list` | List user's repos + public/internal | `GET /api/repos` (existing) |
| `oforge repo fork <owner>/<repo>` | Fork into caller's namespace | `POST /api/repos/:owner/:repo/fork` (existing) |
| `oforge pr list` | List PRs (filter: state, author, base, label) | New: `GET /api/repos/:owner/:repo/pulls` |
| `oforge pr create` | Create PR via `--fill`, `--web`, `--template` | New: `POST /api/repos/:owner/:repo/pulls` |
| `oforge pr view <number>` | PR detail + diff stats + review status | New: `GET /api/repos/:owner/:repo/pulls/:n` |
| `oforge pr checkout <number>` | `git fetch && git checkout pr/<n>` | subprocess `git` |
| `oforge pr review <number>` | Approve / request changes / comment | New: `POST /api/repos/:owner/:repo/pulls/:n/reviews` |
| `oforge pr merge <number>` | Merge via merge/squash/rebase | New: `PUT /api/repos/:owner/:repo/pulls/:n/merge` |
| `oforge issue list` | List issues with filters | New: `GET /api/repos/:owner/:repo/issues` |
| `oforge issue create` | Create issue from flags or `--web` | New: `POST /api/repos/:owner/:repo/issues` |
| `oforge issue view <number>` | Issue detail + comments | New: `GET /api/repos/:owner/:repo/issues/:n` |
| `oforge issue close <number>` / `reopen` | State transition | New: `PATCH /api/repos/:owner/:repo/issues/:n` |
| `oforge run list` / `run view <id>` | List/view CI runs | New (defer to Phase 1 CI) |
| `oforge workflow list` / `workflow view` | Workflow files | New (defer) |
| `oforge release list` / `release create` | Releases + assets | New: `GET/POST /api/repos/:owner/:repo/releases` |
| `oforge gist list` / `gist create` | Gists | New: defer to v2 |
| `oforge api <endpoint>` | Raw API passthrough (matches `gh api`) | Proxy to local API |
| `oforge status` | Auth check + current remote + token validity | Composite |
| `oforge browse [<path>]` | Open repo in web UI | subprocess `xdg-open` / `open` |
| `oforge secret set/list/delete` | Repo/org secrets | New (defer to Phase 1) |

### v1 Should-Ship (P1 — weekly): ~25 commands

- `repo edit`, `repo delete`, `repo archive`, `repo rename`
- `pr diff`, `pr checks`, `pr ready`, `pr close`, `pr reopen`
- `issue comment`, `issue edit`, `issue transfer`, `issue delete`
- `release edit`, `release delete`, `release download`
- `workflow enable/disable`, `workflow run`
- `run watch`, `run rerun`, `run cancel`, `run logs`
- `extension install/list/remove` (gh extension model — important for community)
- `alias set/list/delete` (`gh co = pr checkout` pattern)
- `config set/get/list` (`~/.config/openforge/config.yml`)

### v2+ Defer (P2/P3): ~125 commands

- `codespace` (full codespace surface)
- `attestation`, `cache` (Actions artifacts/cache)
- `ruleset`, `label`, `milestone`, `project` (project mgmt)
- `search commits/issues/repos/code/prs`
- `ssh-key add/list/remove`, `gpg-key add/list`
- `org create/list/members/teams`
- All `gh extension` sub-commands for managing extensions

**Total must-ship P0+P1 for v1: ~50 commands** out of 175 = the 28% of total surface that covers the 80% of usage.

---

## 3. CLI Architecture Decisions (from Pass 1)

### CLI framework: **Commander** (with Inquirer prompts)
- **Pass 1 cli-libraries verdict:** Commander for argument parsing (745 lines report, validated GitHub/npm/eslint/TypeScript compiler production usage)
- **Pass 1 cli-libraries bundle/cold-start numbers:**
  - `commander` ~30KB min+gzip, cold start <10ms
  - `oclif` ~5MB with full plugin runtime — too heavy for "just leave GitHub"
  - `yargs` ~120KB — legacy, used by mocha/jest-cli but no momentum
  - `citty` ~1KB — used by Nuxt CLI, lightweight but smaller ecosystem
- **Recommended pairing:** `@clack/prompts` for interactive (`select`, `confirm`, `text`, `password`, `autocomplete`) — used by `create-vite` (vite.js), `create-vue` (Vue.js), Clerk CLI

### Output rendering: **Ink** for tables/diffs + plain text for CI
- Pass 1 terminal-ui verified Claude Code (Anthropic), Gemini CLI (Google), GitHub Copilot CLI, Cloudflare Wrangler, Prisma, Linear, Shopify, Terraform CDK, Canva all use Ink
- Bundle: ink 605KB + React 172KB = ~777KB unpacked. Acceptable for a CLI that ships with Node.
- Alternative: blessed-contrib for legacy dashboards, but 2015-maintained

### Auth flow: **OAuth device flow (RFC 8628)** for `auth login`
- Pass 1 cli-problems §1: device flow is the canonical pattern for headless/CI. Requires `https://openforge.example.com/login/device?code=XXXX` (8-char base-20 code).
- PAT-via-HTTP-Basic for git ops (credential helper or `https://<PAT>@openforge.example.com/...` URL)
- WebAuthn/passkeys optional (mobile use case in §4)
- **Don't** do `gh auth login --with-token` style PAT paste alone — device flow is the UX win

### Git ops: **shell out to native `git`** (universal pattern)
- Pass 1 git-transport §4: every CLI (gh, hub, glab, tea/gt, lab) does this
- Subprocess pattern: `child_process.spawn('git', ['clone', url, dir], { stdio: 'inherit' })`
- For HTTP Basic auth, install a git credential helper: `git config --global credential.<host>.helper oforge-credential` (which reads PAT from `~/.config/openforge/credentials`)

### Extension model: **`gh extension` git-clone pattern**
- `gh extension install owner/repo` clones into `~/.local/share/gh/extensions/`
- Extension is just an executable with a manifest
- Avoids npm supply-chain risk; matches GitHub's exact pattern

### Shell completion: **static generation at install time**
- `oforge completion bash|zsh|fish|powershell > /etc/bash_completion.d/oforge`
- Bake the full tree (50 commands × flags) at completion-generation time
- Avoids cobra-style dynamic completion (slower, more complex)

### Output format: **JSON + Table + Template**
- Default: human-readable table (Ink)
- `--json` flag for piping (stable key order)
- `--jq` flag for jq expressions (`oforge pr list --jq '.[] | {n: .number, t: .title}'`)
- `--template` flag (Go-template-like) for power users — defer to v2

### **Top 10 CLI pitfalls to avoid (from Pass 1 cli-problems):**
1. **Auth flow** — OAuth device flow (RFC 8628), not PAT paste alone. Bug: headless server device flow port conflict → use polling, not callback.
2. **Pagination** — cursor-based (Relay), not offset. `first: N, after: cursor`. Bug: insertion during scroll → cursors stay stable.
3. **Output formatting** — Unicode width (CJK + emoji), `NO_COLOR` env, terminal width detection. Bug: 80-col assumption breaks on narrow TTYs.
4. **JSON piping** — stable key order, NDJSON for streams, UTF-8 BOM strip. Bug: Windows PowerShell encoding breaks pipes.
5. **Extension model** — git-clone pattern (less supply-chain risk than npm). Bug: extension runs in user's shell context — no sandbox.
6. **Shell completion** — static generation at install. Bug: dynamic completion recursion loops.
7. **Telemetry** — opt-in only, default OFF. GDPR. Bug: telemetry leak via `--debug` flag.
8. **Exit codes** — 0 ok, 1 generic, 4 auth, 8 partial-success. Bug: missing exit code in error path → CI scripts break.
9. **Self-update** — opt-out via env (`OPENFORGE_NO_UPDATE_CHECK=1`), never break on minor version. Bug: auto-update corrupts install.
10. **Secrets** — Keychain (macOS), Credential Manager (Windows), secret-service (Linux). Bug: GH_TOKEN in env visible to `ps aux` → use `keyring` npm.

---

## 4. Mobile Surface — Table-Stakes vs. Differentiator

Pass 1 mobile-clients inventory: **9 Android + 10 iOS Gitea/Forgejo clients**. Critical finding: **no official Gitea/Forgejo mobile app exists**. The community apps are mostly abandoned (GitTouch last commit 2022-10-30, ~4 years stale; GitNex is the most maintained but has major gaps).

### What to ship in mobile v1 (iOS first)

| Feature | Why table-stakes | Source apps that have it well | Skip reason |
|---|---|---|---|
| **Auth: PAT + OAuth device flow** | Every app needs login | GitNex, GitTouch | None — must have |
| **Repo browse: list + search** | Core navigation | GitNex, GitTouch | None |
| **Code view: file tree + raw + syntax highlight** | Read code on phone | GitNex (best), GitTouch | None |
| **Issue list + create + comment** | 80% of "view my issue on phone" | All | None |
| **PR list + diff view (side-by-side + swipe)** | Code review on phone is the killer use case | GitNex (basic), GitLab mobile (best) | None |
| **Release list + download** | Less common but cheap to add | GitNex | None |
| **Notifications (in-app + push)** | Critical retention feature | GitNex has FCM, no UnifiedPush | None |
| **Markdown render** | Issue/PR bodies | GitNex (best) | None |
| **Dark mode** | iOS standard | All | None |

### What to defer (P2 — v2+)

| Feature | Defer reason |
|---|---|
| **Full PR review (submit approve/request-changes)** | GitNex can't do this — only comment. Hard UX on phone. Ship comment-only v1. |
| **CI job logs** | Requires Phase 1 CI runner. Defer entirely. |
| **Wiki edit** | Almost nobody uses wiki on mobile |
| **Packages / Container registry** | Not in GitHub-mobile's top features |
| **Projects v2** | Web-only feature for most users |
| **Code search (server-side)** | Slow on mobile, low value vs PR/Issue search |
| **Multi-account** | Defer until iOS v2 |

### Mobile stack (Pass 1 mobile-stack research):

| Component | Choice | Why |
|---|---|---|
| **Framework** | **React Native** (or Expo) | Cross-platform iOS+Android share 95% code; bigger ecosystem than Flutter for GitHub-API integrations |
| **Offline cache** | **PowerSync + op-sqlite** | Streams Postgres changes into on-device SQLite. PowerSync benchmarks op-sqlite as fastest RN SQLite (Jul 2024) |
| **Sync engine alternative** | ElectricSQL 1.0 GA (Mar 2025) — used by Google, Supabase, Trigger.dev | HTTP-based shape protocol, CDN-native, no persistent sockets |
| **Avoid** | WatermelonDB | Has known bugs ("Cannot update record with pending changes" #1948, record duplication #1881) |
| **Push transport** | **FCM (Android) + APNs (iOS)** + optional **UnifiedPush** for FOSS users | Pass 1 mobile-stack §A. ntfy.sh is canonical FOSS alternative. Chinese OEM battery optimization kills FCM — use foreground service for critical notifications |
| **Auth on mobile** | **OAuth device flow (RFC 8628) + WebAuthn/passkeys** | Pass 1 mobile-stack §B. 8-digit base-20 user code. react-native-passkey for FIDO2. assetlinks.json cached 24h on Android — known gotcha |
| **Conflict resolution** | **LWW for scalar fields + Yjs for concurrent text editing of comments** | Pass 1 mobile-stack §D. Use `defensestation/y-comments` pattern: anchor comments to Yjs `RelativePosition`, not integer offsets |
| **Image diff** | **Canvas 2D swipe divider** (GitHub mobile pattern) | Pass 1 mobile-stack §E. Avoid WebGL (overkill). Use `TextureView` not `glReadPixels` for TBDR GPU perf |
| **Deep links** | **Universal Links (iOS AASA) + App Links (Android autoVerify=true)** | Pass 1 mobile-stack §F. Custom scheme as dev fallback only. Critical OAuth hijack risk if `autoVerify=false` |

### Build order for mobile:
1. **iOS first** (validate UX before Android port)
2. **v1: Auth + Repo browse + Issues + PR list + Diff view + Notifications** (no review submit, no CI logs)
3. **v2: PR review (comment-only), Releases, Markdown editor, multiple accounts**
4. **v3: Android (shared RN codebase), Wiki, Projects**
5. **v4: CI job logs (requires Phase 1 CI runner)**

---

## 5. REST vs. GraphQL — Don't Switch Yet

Pass 2 GraphQL verification found **3 substantive gaps** in Pass 1 (token format change, audit log deprecation, 2026 changelog), but the **stable specs (rate limits, pagination, error envelope, fine-grained PATs) are 100% accurate**. Phase 0 already uses REST.

**Recommendation: Keep REST for v1.** Reasons:
1. **Phase 0 is already REST** (`/api/repos`, `/api/auth`, Smart HTTP). Switching is a multi-month migration.
2. **Mobile and CLI can use REST.** The 50 commands need ~30 REST endpoints — manageable surface.
3. **GraphQL's value is for 3rd-party developers** with complex queries. OpenForge is self-hosted; the user is the only dev.
4. **GitHub itself runs REST + GraphQL in parallel.** Both work.

**GraphQL migration trigger:** add GraphQL endpoint at `/api/graphql` when **either**:
- A second major client (e.g., open-source IDE plugin, Slack bot) needs complex queries
- 3rd-party developers need to build integrations
- Rate-limit cost optimization for mobile becomes urgent

**But adopt GraphQL schema conventions for REST:**
- Cursor-based pagination (Relay) — already in mobile-stack research
- Edge/node/PageInfo response shape — slightly non-standard for REST but well-understood
- `X-RateLimit-*` headers — standard
- Error envelope with `code`, `message`, `documentation_url`

This means when/if GraphQL is added, the REST endpoints already speak its dialect.

---

## 6. The 80% vs. 20% — Build vs. Defer Decision

GitHub has ~300+ user-facing features. The "leave GitHub" bundle needs maybe 30.

### MUST-HAVE (build in v1, before "I left GitHub" claim):

| Feature | Web | CLI | Mobile |
|---|---|---|---|
| **Auth** (email/password + WebAuthn + PAT + SSH key) | ✅ Phase 0 | ✅ v1 | ✅ v1 (device flow) |
| **Repo CRUD** (create, view, list, fork, delete) | ✅ Phase 0 | ✅ v1 | ✅ v1 (read-only) |
| **Git Smart HTTP clone/push** | ✅ Phase 0 | ✅ v1 (shell to git) | ❌ (mobile uses REST) |
| **Issues** (list, create, view, comment, close) | New route | ✅ v1 | ✅ v1 |
| **PRs** (list, create, view, diff, comment, merge) | New route | ✅ v1 | ✅ v1 (view+comment only) |
| **Notifications** (in-app) | New route | ✅ v1 | ✅ v1 (push via FCM/APNs) |
| **Search** (repo, issue, code) | New route | Defer | Defer |
| **Releases** (list, create, download) | New route | ✅ v1 | ✅ v1 |
| **Webhooks** | ✅ Phase 1 | New CLI commands | ❌ |
| **Markdown render** | ✅ Phase 0 | Ink render | ✅ v1 |

### DIFFERENTIATOR (build in v2/v3, after user base):

- CI/CD runner (Actions) — most expensive feature, defer to Phase 1+
- Pages (static site hosting) — defer
- Packages (container registry) — defer
- Wiki — defer
- Projects v2 — defer
- Codespaces — defer
- Discussions — defer
- Sponsors / Marketplace — defer

### SKIP ENTIRELY (not worth the maintenance):

- **Apps Marketplace** (GitHub's worst feature, no one uses it)
- **GraphQL API** (until 3rd-party demand)
- **GitHub Pages competitor** (Cloudflare Pages, Vercel exist)
- **Copilot-style AI features** (separate product, not "leave GitHub" wedge)
- **Mobile CI job logs** (low value, hard to render)

---

## 7. Verification Status

| Pass | Status | Files |
|---|---|---|
| **Pass 1** | ✅ Complete | `openforge-research-gh-cli.md` (617 lines, 65KB) · `openforge-research-graphql.md` (1,321 lines, 99KB) · `openforge-research-cli-problems.md` (843 lines, 62KB) · `openforge-research-cli-libraries.md` (745 lines, 64KB) · `openforge-research-mobile-clients.md` (831 lines, 67KB) · `openforge-mobile-stack-research.md` (~1,200 words) · `openforge-research-git-transport.md` (791 lines, 34KB) · `openforge-research-terminal-ui.md` (1,324 lines, 69KB). Total: ~471 KB across 8 files. |
| **Pass 2** | ⚠️ Partial (1/8) | `openforge-research-graphql-pass2.md` (508 lines, 82KB) — substantive verification found 3 gaps (stateless install-token format `ghs_<APPID>_<JWT>`, GraphQL audit log deprecation, 2026 changelog). All other 7 Pass 2 tasks silently failed (0s duration, no output) due to system queue unreliability. |
| **Pass 3** | ❌ Skipped | Insufficient Pass 2 coverage to identify disagreements |
| **Existing research** | ✅ Available | `plugin-runtime-comparison.md` + `.pass2.md`, `openforge-ci-trust-problems.md`, `openforge-webhook-prior-art.md`, `webhook-vendor-comparison.md`, `webhook-failure-modes.md`, `openforge-subsystem-architecture.md`, `openforge-runner-reference.md` |

**Known verification gaps** (not covered by Pass 2):
- gh CLI command inventory not re-verified (but Pass 1 itself cited GitHub manual, telemetry transparency page, 1,228 real invocation sample)
- CLI problems not re-verified (Pass 1 cited real bug URLs)
- CLI libraries not re-verified (Pass 1 cited Context7 docs and benchmark data)
- Mobile clients not re-verified (Pass 1 cited GitHub API star/commit data, F-Droid listings)
- Mobile stack not re-verified (Pass 1 cited specific library release dates and bug reports)
- Git transport not re-verified (Pass 1 cited git-scm.com official docs directly)
- Terminal UI not re-verified (Pass 1 cited duong.page benchmark data and OpenReplay blog)

**Recommendation:** Re-run Pass 2 manually (one at a time, not in parallel) when time permits. GraphQL Pass 2 was the highest-value verification (found real 2026 gaps); the others may surface 2026 library version bumps.

---

## 8. Recommended Next Actions (in priority order)

1. **Phase 0 / Phase 1: build the 50 P0+P1 CLI commands** above. Use Commander + Ink + @clack/prompts. Shells out to native git. PAT-via-HTTP-Basic via credential helper.
2. **Phase 0: add OAuth device flow** to `apps/api` (`/api/auth/device/code`, `/api/auth/device/token`). Update Better Auth config to register the device flow plugin. ~1 day of work.
3. **Phase 1: add `/api/repos/:owner/:repo/{issues,pulls,releases}`** REST endpoints with Relay-style cursor pagination. ~1 week.
4. **Phase 1: implement notifications table + REST endpoint** + BullMQ job to dispatch FCM/APNs. ~1 week.
5. **Phase 2: ship iOS app** with PowerSync + op-sqlite, React Native, FCM + APNs, OAuth device flow. 4-6 weeks.
6. **Phase 3: Android app** (shared RN codebase with iOS). 2-3 weeks.
7. **Defer:** CI runner, GraphQL, Wiki, Projects, Codespaces — until user demand proves the need.

**Time to "I left GitHub" with CLI + Web (Phase 0+Phase 1):** ~6-8 weeks of focused work.
**Time with mobile added:** ~10-14 weeks.

---

## 9. References

### Pass 1 research files (in `C:\Users\juwen_lie\Documents\Default Project\`)
- `openforge-research-gh-cli.md` — 175 gh commands, P0-P3 tiers, REST endpoints per command
- `openforge-research-graphql.md` — GitHub GraphQL schema surface, octokit patterns, rate limits, pagination, auth
- `openforge-research-cli-problems.md` — 10 hardest CLI problems with bug citations
- `openforge-research-cli-libraries.md` — Commander, Ink, Clack, Citty, Oclif production patterns
- `openforge-research-mobile-clients.md` — 9 Android + 10 iOS Gitea/Forgejo clients, feature matrix
- `openforge-mobile-stack-research.md` — Push, auth, offline, conflict, image diff, deep links
- `openforge-research-git-transport.md` — Smart HTTP, pkt-line, libgit2, glab/tea/hub/gh patterns
- `openforge-research-terminal-ui.md` — Ink/Clack/Blessed/OpenTUI benchmarks, compat matrix

### Pass 2 verification files
- `openforge-research-graphql-pass2.md` — 508 lines, found 3 substantive 2026 gaps

### Existing OpenForge scaffold (`openforge/`)
- `README.md` — Phase 0 architecture memo + 10 risks
- `apps/api/README.md` — Hono API routes (auth, repos, git Smart HTTP)
- `apps/web/README.md` — Next.js 15 frontend
- `packages/git-transport/README.md` — Smart HTTP via subprocess
- `packages/auth/README.md` — Better Auth + TOTP + WebAuthn + PAT + SSH keys
- `packages/db/README.md` — Drizzle schema (20+ tables)
- `packages/s3/README.md` — Cloudflare R2 + AWS S3 DR
- `docs/ci-security.md` — CI sandbox design

### Existing research files (prior sessions)
- `openforge-ci-trust-problems.md` · `openforge-webhook-prior-art.md` · `openforge-subsystem-architecture.md`
- `webhook-vendor-comparison.md` · `webhook-failure-modes.md`
- `plugin-runtime-comparison.md` + `.pass2.md` (V8 Isolates vs Wasmtime vs Deno vs QuickJS-ng vs Extism)

### External references cited by research
- GitHub CLI: github.com/cli/cli (pkg/cmd/ directory tree)
- GitHub GraphQL docs: docs.github.com/en/graphql
- Git protocol: git-scm.com/docs/http-protocol, git-scm.com/docs/protocol-capabilities
- Gitea reference: github.com/go-gitea/gitea/blob/main/routers/web/githttp.go
- Forgejo: codeberg.org/forgejo
- Better Auth: better-auth.com (Lucia deprecated 2025)
- Ink: github.com/vadimdemedes/ink (Claude Code, Gemini CLI, Cloudflare Wrangler, GitHub Copilot CLI, Prisma)
- Clack: github.com/bombshell-dev/clack (create-vite, create-vue, Clerk)
- PowerSync: powersync.com + github.com/powersync-ja
- op-sqlite: github.com/OP-Engineering/op-sqlite

---

## 10. The Honest Uncertainty Section

**Things I am confident about** (validated by multiple sources in research):
- Shell out to native `git` (5 reference implementations all do this)
- HTTP Basic + PAT for git ops (universal pattern)
- OAuth device flow for CLI auth (canonical pattern)
- Commander + Ink + Clack (battle-tested, used by Anthropic/Google/GitHub/Cloudflare)
- Postgres + materialized permissions (proven at GitHub/GitLab/Gitea scale)
- `pg_try_advisory_xact_lock` for ref CAS (Gitea's pattern)
- React Native + PowerSync for mobile offline (modern best practice)
- FCM/APNs for push (canonical; UnifiedPush as FOSS escape hatch)

**Things I am less confident about** (single-source claims that need Pass 2 to verify):
- Exact percentage of gh usage by command (Pass 1 noted GitHub doesn't publish per-command telemetry; P0-P3 tiers are directional, not hard numbers)
- Whether 50 commands or 80 commands is the right "80% of usage" target (depends on actual user telemetry we don't have)
- Whether iOS or Android should ship first (iOS bias is my recommendation, but Android users may disagree)
- Whether PowerSync or ElectricSQL is the better offline engine (both are 1.0+ in 2026; need user load testing)

**Things that could change my recommendations**:
- If GitHub publishes per-command telemetry in 2027, the P0/P1 boundaries may shift
- If mobile usage patterns diverge from web (e.g., 80% mobile usage is PR review not issue triage), mobile v1 scope changes
- If a new CLI framework emerges that's materially better than Commander (Citty is the candidate)

**What I would do differently if I were starting over**:
- I would not attempt Pass 2 with 8 parallel agents — the system's queue limit makes >3 parallel deep research tasks unreliable. Sequential, one-at-a-time is the only reliable path.
