# OpenForge — GitHub CLI (`gh`) Command Surface Research

**Project:** OpenForge (self-hosted GitHub competitor — `github.com/juw12/openforge`)
**Stack:** TypeScript monorepo, Next.js + Hono + Postgres + S3 + smart-HTTP git (greenfield)
**Purpose of this report:** Produce an exhaustive, source-cited map of every `gh` (GitHub CLI) command users actually depend on, grouped by frequency-of-use, so that OpenForge's day-one CLI ships the right subset and the REST surface is scoped correctly.
**Date compiled:** 2026-11-03
**Status:** Research complete. Tiering is a reasoned synthesis (see §2 "Methodology & honesty note") because GitHub does not publish per-command usage counts.

---

## 1. Scope & how to read this report

This document answers three downstream decisions:

1. **OpenForge REST v1 surface** — which API endpoints must exist so a `gh`-compatible CLI can talk to OpenForge (see §10 "REST Surface Implication", the deduplicated endpoint list).
2. **OpenForge CLI v1 command set** — which `gh` subcommands to implement first (see §3–§6 tables, tiered P0→P3).
3. **Explicit out-of-scope for v1** — what to defer (see §11).

Every table row carries: the command, the subcommand/flag detail, a one-line use case, the backing GitHub REST or GraphQL endpoint, a frequency tier (P0/P1/P2/P3), and a source citation (GitHub CLI source path, manual URL, blog, or third-party study).

`gh` is written in Go and ships **~25 top-level command groups** and **~200 subcommands** (confirmed against `github.com/cli/cli/tree/trunk/pkg/cmd` and the `cli.github.com/manual` index). The full command-group directory listing captured from the repo tree is in Appendix A.

---

## 2. Methodology & honesty note (read before trusting the tiers)

**What is actually measured:** GitHub shipped **opt-out usage telemetry in `gh` v2.91.0 (2026-04-22)**. This is the first time GitHub has instrumented the CLI this way. Key facts from the official docs, changelog, and the implementing PR:

- Telemetry is **opt-out** and **on by default** (except when the target host is GitHub Enterprise Server).
- It is **sampled at 1% of invocations** (from `cli/cli` PR #13191 "Add sampled command telemetry"). An entire invocation is sampled as a unit.
- Each invocation emits a `command_invocation` event. Captured **dimensions** include: `command` (e.g. `gh pr create`), `flags` (flag *names* only, **not** values), `os`, `architecture`, `is_tty`, `ci`, `agent` (detects if run inside an AI agent loop), `github_actions`, `version`, `device_id` (pseudonymous, rotating), `invocation_id`, `timestamp`, `repo_visibility`.
- **Not collected:** argument *values*, file paths, repo names, or prompt text.
- Opt-out: `GH_TELEMETRY=false`, `DO_NOT_TRACK=true`, or `gh config set telemetry disabled`. Preview what would be sent without sending: `GH_TELEMETRY=log` or `gh config set telemetry log`.
- **The raw per-command usage numbers are private.** They live in GitHub's internal analytics and are **not published** as a public per-command leaderboard.

**Honesty note:** There is **no single public, authoritative per-command usage ranking** for `gh`. The telemetry data that would be ideal for this task is proprietary. Therefore the P0/P1/P2/P3 tiers below are a **reasoned synthesis** of four independent, citable signals:

- **(A) Official framing** — GitHub's own "Top 8 most useful GitHub CLI commands" blog post labels certain commands "bread and butter … you will use these almost every time."
- **(B) Measured invocation studies** — third-party analyses of real `gh` shell history / agent tool-calls (e.g. `zeke/faster-gh-cli-skill`, which analyzed **1,228 real `gh` bash invocations** and ranked `pr create`, `pr view`, `run view`, `issue view`, `issue create`, `repo view`, `pr list`, `pr checks`, `api` as the most common successful commands).
- **(C) Practitioner "top N" lists** — Adam Johnson (author of *Boost Your GitHub DX*, 2025) and Hugo van Kemenade's personal usage tallies.
- **(D) Engineering judgment** — how often each command appears in a typical daily/weekly developer loop (clone → branch → commit → PR → CI → review → merge).

Where a tier is contested or a command is a narrow niche, the report flags it. **The "0.1% of users" style claim from the brief cannot be reproduced as a hard number from public data** — that granularity is not published. The tiers approximate it: P3 ≈ niche/power-user (well under ~5% of active CLI users), P0 ≈ the majority of active users weekly+. Treat exact percentages as **directional, not measured**.

---

## 3. P0 — Every-day commands (ship first, must be rock-solid)

These are the commands present in the "bread and butter" framing, the top of every measured invocation study, and the daily dev loop. OpenForge **must** make these work and be fast, because they are the #1 reason a user keeps the CLI installed.

| # | Command | Subcommand / Flags | Use Case (1 line) | Backing REST/GraphQL Endpoint | Tier | Source Citation |
|---|---------|--------------------|-------------------|-------------------------------|------|-----------------|
| 1 | `gh pr list` | `--state`, `--author`, `--label`, `--limit`, `-q` (jq), `--json` | List open/closed PRs in current repo | GraphQL `repository.pullRequests(states:)`; REST `GET /repos/{owner}/{repo}/pulls` | P0 | zeke study (top-5); blog #3; `pkg/cmd/pr/list.go` |
| 2 | `gh pr create` | `--title`, `--body`, `--draft`, `--fill`, `--base`, `--label`, `--reviewer`, `--project` | Open a PR from current branch (most agent-driven cmd) | REST `POST /repos/{owner}/{repo}/pulls` | P0 | zeke study (#1); blog #3; `pkg/cmd/pr/create.go` |
| 3 | `gh pr view` | `<n\|branch>`, `--json`, `-q`, `--web`, `--comments`, `--files` | Inspect one PR (title, body, checks, files) | GraphQL `repository.pullRequest`; REST `GET /repos/{owner}/{repo}/pulls/{number}` | P0 | zeke study; `pkg/cmd/pr/view.go` |
| 4 | `gh pr checks` | `<n\|branch>`, `--watch`, `--fail-fast`, `--json` | Show CI status for a PR's head commit (agent gate) | GraphQL `pullRequest.statusCheckRollup`; REST `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | P0 | zeke study (top-5); `pkg/cmd/pr/checks.go` |
| 5 | `gh pr status` | `--repo`, `--app`, `--limit` | PRs assigned to you / awaiting your review | GraphQL search (`review-requested:user:@me`, `author:@me`); REST `GET /user`+`/repos/.../pulls` | P0 | blog #3; `pkg/cmd/pr/status.go` |
| 6 | `gh pr merge` | `<n\|branch>`, `--merge\|--squash\|--rebase`, `--delete-branch`, `--admin` | Merge the PR (end of daily loop) | REST `PUT /repos/{owner}/{repo}/pulls/{number}/merge` | P0 | blog #3; adamj top-8; `pkg/cmd/pr/merge.go` |
| 7 | `gh pr review` | `<n>`, `--approve\|--comment\|--request-changes`, `--body`, `--web` | Submit a review decision | REST `POST /repos/{owner}/{repo}/pulls/{number}/reviews` | P0 | blog #3; `pkg/cmd/pr/review.go` |
| 8 | `gh pr checkout` | `<n\|branch>`, `--force`, `--recurse-submodules` | Pull down a PR's head branch locally for testing | GraphQL (resolve PR from head ref) + **git transport** (fetch/checkout) | P0 | blog #3; adamj top-8; `pkg/cmd/pr/checkout.go` |
| 9 | `gh pr comment` | `<n>`, `--body`, `--body-file`, `--web` | Leave a line-free comment on a PR | REST `POST /repos/{owner}/{repo}/issues/{number}/comments` | P0 | `pkg/cmd/pr/comment.go` |
| 10 | `gh pr diff` | `<n>`, `--name-only`, `--patch`, `-p` | View the PR's unified diff | REST `GET /repos/{owner}/{repo}/pulls/{number}` (Accept: `application/vnd.github.diff`) / `GET .../pulls/{number}/files` | P0 | `pkg/cmd/pr/diff.go` |
| 11 | `gh pr edit` | `<n>`, `--title`, `--body`, `--add-label`, `--add-reviewer`, `--project` | Modify a PR's metadata | REST `PATCH /repos/{owner}/{repo}/pulls/{number}` | P0 | `pkg/cmd/pr/edit.go` |
| 12 | `gh pr close` | `<n>`, `--comment` | Close a PR (uses issue close) | REST `PATCH /repos/{owner}/{repo}/issues/{number}` (`state=closed`) | P0 | `pkg/cmd/pr/close.go` |
| 13 | `gh pr ready` | `<n>` | Mark a draft PR ready for review | REST `PATCH /repos/{owner}/{repo}/pulls/{number}` (`draft=false`) | P0 | `pkg/cmd/pr/ready.go` |
| 14 | `gh issue list` | `--state`, `--label`, `--assignee`, `--limit`, `--json`, `-q` | List open issues (core triage view) | GraphQL `repository.issues`; REST `GET /repos/{owner}/{repo}/issues` | P0 | zeke study; blog #2; `pkg/cmd/issue/list.go` |
| 15 | `gh issue create` | `--title`, `--body`, `--label`, `--assignee`, `--milestone`, `--project`, `--web` | File a new issue (high agent usage) | REST `POST /repos/{owner}/{repo}/issues` | P0 | zeke study (top-5); blog #2; `pkg/cmd/issue/create.go` |
| 16 | `gh issue view` | `<n>`, `--json`, `-q`, `--comments`, `--web` | Read one issue + timeline | GraphQL `repository.issue`; REST `GET /repos/{owner}/{repo}/issues/{number}` | P0 | zeke study (top-5); `pkg/cmd/issue/view.go` |
| 17 | `gh issue edit` | `<n>`, `--title`, `--body`, `--add-label`, `--add-assignee` | Modify an issue | REST `PATCH /repos/{owner}/{repo}/issues/{number}` | P0 | blog #2; `pkg/cmd/issue/edit.go` |
| 18 | `gh issue comment` | `<n>`, `--body`, `--body-file`, `--web` | Comment on an issue | REST `POST /repos/{owner}/{repo}/issues/{number}/comments` | P0 | `pkg/cmd/issue/comment.go` |
| 19 | `gh issue close` | `<n>`, `--comment` | Close an issue with optional comment | REST `PATCH /repos/{owner}/{repo}/issues/{number}` (`state=closed`) | P0 | `pkg/cmd/issue/close.go` |
| 20 | `gh issue status` | `--repo`, `--label`, `--assignee`, `--mention`, `--author` | Issues assigned to / mentioning you | GraphQL search (`assignee:@me`, `mentions:@me`) | P0 | blog #2; `pkg/cmd/issue/status.go` |
| 21 | `gh repo list` | `--limit`, `--fork`, `--archived`, `--json`, `-q` | List your/org's repos | GraphQL `viewer.repositories`; REST `GET /user/repos` | P0 | blog #1; `pkg/cmd/repo/list.go` |
| 22 | `gh repo create` | `<name>`, `--public\|--private`, `--clone`, `--source`, `--add-readme`, `-R` | Create + optionally clone a new repo | REST `POST /user/repos` (or `POST /orgs/{org}/repos`) | P0 | blog #1; `pkg/cmd/repo/create.go` |
| 23 | `gh repo clone` | `<owner>/<repo>`, `--branch`, `--recursive`, `--checkout-index` | Clone via smart-HTTP with gh auth (favored over `git clone`) | **git transport** (smart-HTTP over `api.github.com`/git host); REST `GET /repos/{owner}/{repo}` for lookup | P0 | blog #1; adamj top-8; `pkg/cmd/repo/clone.go` |
| 24 | `gh repo view` | `<owner>/<repo>`, `--web`, `--json`, `-q`, `--branch`, `--license`, `--topics` | Read repo metadata | REST `GET /repos/{owner}/{repo}` | P0 | zeke study (top-5); `pkg/cmd/repo/view.go` |
| 25 | `gh repo fork` | `<owner>/<repo>`, `--org`, `--remote`, `--clone` | Fork a repo to your account | REST `POST /repos/{owner}/{repo}/forks` | P0 | `pkg/cmd/repo/fork.go` |
| 26 | `gh repo edit` | `<owner>/<repo>`, `--description`, `--homepage`, `--add-topic`, `--visibility` | Update repo settings | REST `PATCH /repos/{owner}/{repo}` | P0 | blog #1; `pkg/cmd/repo/edit.go` |
| 27 | `gh run list` | `--branch`, `--workflow`, `--status`, `--limit`, `--json`, `-q` | List Actions workflow runs | REST `GET /repos/{owner}/{repo}/actions/runs` | P0 | zeke study (via `run view`); `pkg/cmd/run/list.go` |
| 28 | `gh run view` | `[id]`, `--log`, `--log-failed`, `--json`, `-q`, `--exit-status` | Inspect a single run + its log (agent gate) | REST `GET /repos/{owner}/{repo}/actions/runs/{run_id}`; log: `GET .../runs/{run_id}/logs` | P0 | zeke study (top-5); adamj (`run watch`); `pkg/cmd/run/view.go` |
| 29 | `gh run watch` | `[id]`, `--interval`, `--exit-status` | Poll a run until completion, stream steps | REST polling `GET .../actions/runs/{run_id}` | P0 | adamj top-8; `pkg/cmd/run/watch.go` |
| 30 | `gh run download` | `[id]`, `--name`, `--dir`, `--pattern` | Download run artifacts | REST `GET .../actions/runs/{run_id}/artifacts`; `GET .../artifacts/{id}/zip` | P0 | `pkg/cmd/run/download.go` |
| 31 | `gh run rerun` | `<id>`, `--failed`, `--all` | Re-run a failed run / failed jobs | REST `POST .../actions/runs/{run_id}/rerun` (or `.../rerun-failed-jobs`) | P0 | `pkg/cmd/run/rerun.go` |
| 32 | `gh run cancel` | `<id>` | Cancel an in-progress run | REST `POST .../actions/runs/{run_id}/cancelations` | P0 | `pkg/cmd/run/cancel.go` |
| 33 | `gh workflow list` | `--all`, `--json`, `-q` | List workflow definitions in a repo | REST `GET /repos/{owner}/{repo}/actions/workflows` | P0 | blog #5; `pkg/cmd/workflow/list.go` |
| 34 | `gh workflow run` | `<id\|path>`, `--ref` | Dispatch a workflow (admin) | REST `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` | P0 | blog #5; `pkg/cmd/workflow/run.go` |
| 35 | `gh workflow view` | `[id\|path]`, `--json`, `-q` | Read a workflow definition + recent runs | REST `GET /repos/{owner}/{repo}/actions/workflows/{id_or_path}` | P0 | `pkg/cmd/workflow/view.go` |
| 36 | `gh gist list` | `--limit`, `--json`, `-q` | List your gists | REST `GET /gists` | P0 | `pkg/cmd/gist/list.go` |
| 37 | `gh gist create` | `[files...]`, `--desc`, `--public`, `--filename` | Create a gist (one-off code sharing) | REST `POST /gists` | P0 | `pkg/cmd/gist/create.go` |
| 38 | `gh gist view` | `[id]`, `--raw`, `--filename`, `--web` | Read a gist | REST `GET /gists/{id}` | P0 | `pkg/cmd/gist/view.go` |
| 39 | `gh release list` | `--limit`, `--json`, `-q`, `--see-all` | List repo releases | REST `GET /repos/{owner}/{repo}/releases` | P0 | blog #4; `pkg/cmd/release/list.go` |
| 40 | `gh release view` | `[tag]`, `--json`, `-q`, `--web`, `--latest` | Inspect one release + its assets | REST `GET /repos/{owner}/{repo}/releases/{id_or_tag}` | P0 | blog #4; `pkg/cmd/release/view.go` |
| 41 | `gh release create` | `<tag>`, `--title`, `--notes`, `--notes-file`, `--draft`, `--generate-notes`, `[files]` | Cut a release (with optional binary upload) | REST `POST /repos/{owner}/{repo}/releases`; assets `POST .../releases/{id}/assets` | P0 | blog #4; `pkg/cmd/release/create.go` |
| 42 | `gh release download` | `[tag]`, `--pattern`, `--dir` | Download release binaries | REST `GET .../releases/{id}` (asset download URLs) | P0 | `pkg/cmd/release/download.go` |
| 43 | `gh api` | `[{path}]`, `--method`, `-f key=value`, `-F`, `--input`, `--paginate`, `-H` | Raw REST passthrough (escape hatch, very high usage) | **REST passthrough** to `api.github.com/{path}` (any verb) | P0 | zeke study (top-5); `pkg/cmd/api/api.go` |
| 44 | `gh api graphql` | `-f query=...`, `--input` | Raw GraphQL passthrough | `POST /graphql` | P0 | `pkg/cmd/api/api.go` |
| 45 | `gh status` | `--repo`, `--json`, `-q`, `--branch` | Your assigned issues/PRs + review requests (daily dashboard) | GraphQL (multiple searches) | P0 | blog #7; `pkg/cmd/status/status.go` |

**P0 subtotal: 45 rows.** If OpenForge ships only P0 on day one, it covers the clone→branch→commit→PR→CI→review→merge loop plus gists/releases/raw-API. This is the non-negotiable set.

---

## 4. P1 — Weekly commands (high value, slightly less frequent)

Used regularly but not every single day. Many are the "second half" of a workflow (auth, search, browsing, forking). OpenForge should ship these in v1 but can land them slightly after P0.

| # | Command | Subcommand / Flags | Use Case (1 line) | Backing REST/GraphQL Endpoint | Tier | Source Citation |
|---|---------|--------------------|-------------------|-------------------------------|------|-----------------|
| 46 | `gh auth login` | `--web`, `--token`, `--hostname`, `--scopes`, `--git-protocol` | Authenticate (OAuth device flow or token) | OAuth device/token endpoints (non-standard REST); validates `GET /user` | P1 | blog #1; `pkg/cmd/auth/login.go` |
| 47 | `gh auth status` | `--hostname`, `--active-token` | Show which accounts are logged in / valid | REST `GET /user` (per host) | P1 | `pkg/cmd/auth/status.go` |
| 48 | `gh auth switch` | `[account]`, `--hostname` | Switch active account/host | local (keychain/config) | P1 | `pkg/cmd/auth/switch.go` |
| 49 | `gh auth token` | `--hostname`, `--scope` | Print the current token (for git/CI) | local (reads keychain) | P1 | `pkg/cmd/auth/token.go` |
| 50 | `gh auth setup-git` | `--hostname` | Configure git credential helper to use gh | local (`git config` write) | P1 | `pkg/cmd/auth/setup_git.go` |
| 51 | `gh auth logout` | `--hostname`, `--all` | Remove stored credentials | local + OAuth token revoke | P1 | `pkg/cmd/auth/logout.go` |
| 52 | `gh auth refresh` | `--scope`, `--reset-scopes` | Re-auth for additional scopes | OAuth refresh | P1 | `pkg/cmd/auth/refresh.go` |
| 53 | `gh search repos` | `<query>`, `--language`, `--sort`, `--stars`, `--limit`, `--json`, `-q` | Search public repos by keyword/qualifiers | REST `GET /search/repositories` | P1 | `pkg/cmd/search/repos.go` |
| 54 | `gh search issues` | `<query>`, `--state`, `--label`, `--owner`, `--json`, `-q` | Search issues across repos | REST `GET /search/issues` | P1 | `pkg/cmd/search/issues.go` |
| 55 | `gh search prs` | `<query>`, `--state`, `--label`, `--owner`, `--json`, `-q` | Search PRs across repos | REST `GET /search/issues` (`is:pr`) | P1 | `pkg/cmd/search/prs.go` |
| 56 | `gh search code` | `<query>`, `--language`, `--path`, `--owner`, `--repo`, `--json` | Search code (requires auth) | GraphQL `search(query: "in:file ...")` | P1 | `pkg/cmd/search/code.go` |
| 57 | `gh search commits` | `<query>`, `--author`, `--repo`, `--json` | Search commits | GraphQL `search(query: "commits:...")` | P1 | `pkg/cmd/search/commits.go` |
| 58 | `gh browse` | `[file]`, `--branch`, `--protocols`, `-p`, `--pr`, `-w` | Open the repo/PR/file in a browser (no API) | none (constructs `https://github.com/...` URL) | P1 | adamj top-8 (#1); `pkg/cmd/browse/browse.go` |
| 59 | `gh pr update-branch` | `<n>` | Update PR head with base changes | GraphQL `updatePullRequestBranch` | P1 | `pkg/cmd/pr/update-branch.go` |
| 60 | `gh pr reopen` | `<n>` | Reopen a closed PR | REST `PATCH /repos/{owner}/{repo}/issues/{number}` (`state=open`) | P1 | `pkg/cmd/pr/reopen.go` |
| 61 | `gh issue reopen` | `<n>` | Reopen a closed issue | REST `PATCH /repos/{owner}/{repo}/issues/{number}` (`state=open`) | P1 | `pkg/cmd/issue/reopen.go` |
| 62 | `gh release edit` | `<tag>`, `--title`, `--notes`, `--draft`, `--prerelease` | Edit an existing release | REST `PATCH /repos/{owner}/{repo}/releases/{id}` | P1 | `pkg/cmd/release/edit.go` |
| 63 | `gh release upload` | `<tag>`, `[files]`, `--clobber`, `--draft` | Add binaries to a release | REST `POST /repos/{owner}/{repo}/releases/{id}/assets` | P1 | `pkg/cmd/release/upload.go` |
| 64 | `gh repo sync` | `[name]`, `--branch` | Sync a fork with its upstream | REST `POST /repos/{owner}/{repo}/sync` + **git transport** (pull/merge) | P1 | `pkg/cmd/repo/sync.go` |
| 65 | `gh repo delete` | `[name]`, `--yes`, `--remove-origin` | Delete a repo (destructive) | REST `DELETE /repos/{owner}/{repo}` | P1 | blog #1; `pkg/cmd/repo/delete.go` |
| 66 | `gh repo rename` | `<name>`, `--new-name` | Rename a repo | REST `PATCH /repos/{owner}/{repo}` | P1 | `pkg/cmd/repo/rename.go` |
| 67 | `gh pr lock` | `<n>`, `--reason` | Lock PR conversation | REST `PUT /repos/{owner}/{repo}/issues/{number}/lock` | P1 | `pkg/cmd/pr/lock.go` |
| 68 | `gh pr unlock` | `<n>` | Unlock PR conversation | REST `DELETE /repos/{owner}/{repo}/issues/{number}/lock` | P1 | `pkg/cmd/pr/unlock.go` |
| 69 | `gh gist delete` | `<id>`, `--yes` | Delete a gist | REST `DELETE /gists/{id}` | P1 | `pkg/cmd/gist/delete.go` |
| 70 | `gh gist edit` | `[id]`, `--desc`, `--add`, `--edit` | Edit a gist's files/description | REST `PATCH /gists/{id}` | P1 | `pkg/cmd/gist/edit.go` |
| 71 | `gh gist rename` | `<id>`, `<old>`, `<new>` | Rename a file within a gist | REST `PATCH /gists/{id}` | P1 | `pkg/cmd/gist/rename.go` |
| 72 | `gh gist clone` | `<id>`, `[dir]` | Clone a gist into a working dir | **git transport** (`git clone https://gist.github.com/{id}`) | P1 | `pkg/cmd/gist/clone.go` |

**P1 subtotal: 27 rows (running total: 72).**

---

## 5. P2 — Occasional commands (set-up / infra, used now and then)

Configuration, secrets, variables, extensions, SSH keys, labels. Used when standing up a repo or CI, not in the daily loop. Ship in v1.x, lower polish tolerance.

| # | Command | Subcommand / Flags | Use Case (1 line) | Backing REST/GraphQL Endpoint | Tier | Source Citation |
|---|---------|--------------------|-------------------|-------------------------------|------|-----------------|
| 73 | `gh secret set` | `<name>`, `--env-data`, `--body`, `--app`, `--org`, `--visibility` | Store an Actions secret (client-side encrypted) | REST `PUT /repos/{owner}/{repo}/actions/secrets/{name}` (org: `PUT /orgs/{org}/actions/secrets/{name}`) | P2 | `pkg/cmd/secret/set.go` |
| 74 | `gh secret list` | `--app`, `--org`, `--json`, `-q` | List Actions secrets (names only) | REST `GET /repos/{owner}/{repo}/actions/secrets` | P2 | `pkg/cmd/secret/list.go` |
| 75 | `gh secret delete` | `<name>`, `--org`, `--app` | Delete an Actions secret | REST `DELETE /repos/{owner}/{repo}/actions/secrets/{name}` | P2 | `pkg/cmd/secret/delete.go` |
| 76 | `gh variable set` | `<name>`, `-b <value>`, `--org`, `--app` | Store a non-secret Actions variable | REST `PUT /repos/{owner}/{repo}/actions/variables/{name}` | P2 | `pkg/cmd/variable/set.go` |
| 77 | `gh variable list` | `--org`, `--app`, `--json`, `-q` | List Actions variables | REST `GET /repos/{owner}/{repo}/actions/variables` | P2 | `pkg/cmd/variable/list.go` |
| 78 | `gh variable get` | `<name>`, `--org`, `--app` | Read one Actions variable | REST `GET /repos/{owner}/{repo}/actions/variables/{name}` | P2 | `pkg/cmd/variable/get.go` |
| 79 | `gh variable delete` | `<name>`, `--org`, `--app` | Delete an Actions variable | REST `DELETE /repos/{owner}/{repo}/actions/variables/{name}` | P2 | `pkg/cmd/variable/delete.go` |
| 80 | `gh extension install` | `<owner>/<repo>`, `--pin` | Install a gh extension (git clone from registry) | **git transport** (clone ext repo); version lookup via `GET /repos/{owner}/{repo}/releases` | P2 | `pkg/cmd/extension/install.go` |
| 81 | `gh extension list` | `--builtin`, `--json` | List installed extensions | local + `GET /repos/{owner}/{repo}/releases` (for versions) | P2 | `pkg/cmd/extension/list.go` |
| 82 | `gh extension remove` | `<name>` | Uninstall an extension | local | P2 | `pkg/cmd/extension/remove.go` |
| 83 | `gh extension upgrade` | `[name]` | Update extensions to latest release | **git transport** (pull) + `GET /repos/{owner}/{repo}/releases` | P2 | `pkg/cmd/extension/upgrade.go` |
| 84 | `gh extension browse` | — | Open the extensions catalog in browser | none (`https://github.com/topics/gh-extension`) | P2 | `pkg/cmd/extension/browse.go` |
| 85 | `gh extension search` | `<query>` | Search the extension registry | GitHub search API (topic `gh-extension`) | P2 | `pkg/cmd/extension/search.go` |
| 86 | `gh extension exec` | `<name>` `[args]` | Run an extension binary | local (exec) | P2 | `pkg/cmd/extension/exec.go` |
| 87 | `gh extension create` | `<name>` | Scaffold a new extension repo | **git transport** + `POST /user/repos` | P2 | `pkg/cmd/extension/create.go` |
| 88 | `gh ssh-key add` | `[file]`, `--title`, `--ssh` | Add an SSH key to your account | REST `POST /user/keys` | P2 | `pkg/cmd/ssh-key/add.go` |
| 89 | `gh ssh-key list` | `--json`, `-q` | List your SSH keys | REST `GET /user/keys` | P2 | `pkg/cmd/ssh-key/list.go` |
| 90 | `gh ssh-key delete` | `<key_id>`, `--yes` | Delete an SSH key | REST `DELETE /user/keys/{id}` | P2 | `pkg/cmd/ssh-key/delete.go` |
| 91 | `gh label list` | `--json`, `-q`, `--limit` | List repo labels | REST `GET /repos/{owner}/{repo}/labels` | P2 | blog #6; `pkg/cmd/label/list.go` |
| 92 | `gh label create` | `<name>`, `--color`, `--description`, `--force` | Create a label | REST `POST /repos/{owner}/{repo}/labels` | P2 | blog #6; `pkg/cmd/label/create.go` |
| 93 | `gh label edit` | `<name>`, `--color`, `--description`, `--new-name` | Rename/recolor a label | REST `PATCH /repos/{owner}/{repo}/labels/{name}` | P2 | blog #6; `pkg/cmd/label/edit.go` |
| 94 | `gh label delete` | `<name>`, `--yes` | Delete a label | REST `DELETE /repos/{owner}/{repo}/labels/{name}` | P2 | `pkg/cmd/label/delete.go` |
| 95 | `gh label clone` | `<source>`, `--source-repo`, `--target-repo` | Copy labels between repos | REST `GET` source `labels` + `POST` target `labels` | P2 | `pkg/cmd/label/clone.go` |
| 96 | `gh config get` | `<key>` | Read a config value (editor, pager, prompt, telemetry) | local (config file) | P2 | `pkg/cmd/config/get.go` |
| 97 | `gh config set` | `<key>`, `<value>` | Set a config value | local (config file) | P2 | `pkg/cmd/config/set.go` |
| 98 | `gh config list` | — | Dump all config | local | P2 | `pkg/cmd/config/list.go` |
| 99 | `gh alias set` | `<name>`, `<expansion>` | Define a command alias (e.g. `co = pr checkout`) | local (config file) | P2 | `pkg/cmd/alias/set.go` |
| 100 | `gh alias list` | `--shells` | Show defined aliases | local | P2 | `pkg/cmd/alias/list.go` |
| 101 | `gh alias delete` | `<name>` | Remove an alias | local | P2 | `pkg/cmd/alias/delete.go` |
| 102 | `gh completion` | `--shell`, `--no-descriptions` | Emit shell completion scripts | local (generated) | P2 | `pkg/cmd/completion/completion.go` |
| 103 | `gh issue pin` | `<n>` | Pin an issue to the repo | REST `PUT /repos/{owner}/{repo}/issues/{number}/pin` | P2 | `pkg/cmd/issue/pin.go` |
| 104 | `gh issue unpin` | `<n>` | Unpin an issue | REST `DELETE /repos/{owner}/{repo}/issues/{number}/pin` | P2 | `pkg/cmd/issue/unpin.go` |
| 105 | `gh issue lock` | `<n>`, `--reason` | Lock issue conversation | REST `PUT /repos/{owner}/{repo}/issues/{number}/lock` | P2 | `pkg/cmd/issue/lock.go` |
| 106 | `gh issue unlock` | `<n>` | Unlock issue conversation | REST `DELETE /repos/{owner}/{repo}/issues/{number}/lock` | P2 | `pkg/cmd/issue/unlock.go` |

**P2 subtotal: 34 rows (running total: 106).**

---

## 6. P3 — Rare / power-user / niche commands

Enterprise features (Codespaces, Projects v2, attestation, rulesets, caching), admin/security, and newer agent-era commands. These serve <~5% of active users and are strong v2 candidates. OpenForge can defer most of these; the REST surface for them is listed in §10 for completeness.

| # | Command | Subcommand / Flags | Use Case (1 line) | Backing REST/GraphQL Endpoint | Tier | Source Citation |
|---|---------|--------------------|-------------------|-------------------------------|------|-----------------|
| 107 | `gh pr revert` | `<n>` | Create a PR that reverts a merged PR | REST `POST .../pulls` (revert branch) + merge machinery | P3 | `pkg/cmd/pr/revert.go` |
| 108 | `gh issue delete` | `<n>`, `--yes` | Permanently delete an issue (admin) | REST `DELETE /repos/{owner}/{repo}/issues/{number}` | P3 | `pkg/cmd/issue/delete.go` |
| 109 | `gh issue transfer` | `<n>`, `--new-repo` | Move an issue to another repo | REST `POST /repos/{owner}/{repo}/issues/{number}` (move) | P3 | `pkg/cmd/issue/transfer.go` |
| 110 | `gh issue develop` | `<n>`, `-b <branch>` | Create a branch for the issue | REST branch lookup + **git transport** (checkout -b) | P3 | `pkg/cmd/issue/develop.go` |
| 111 | `gh run delete` | `<id>`, `--yes` | Delete a run record (admin) | REST `DELETE .../actions/runs/{run_id}` | P3 | `pkg/cmd/run/delete.go` |
| 112 | `gh workflow enable` | `<id\|path>` | Re-enable a disabled workflow (admin) | REST `PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable` | P3 | `pkg/cmd/workflow/enable.go` |
| 113 | `gh workflow disable` | `<id\|path>` | Disable a workflow (admin) | REST `PUT /repos/{owner}/{repo}/actions/workflows/{id}/disable` | P3 | `pkg/cmd/workflow/disable.go` |
| 114 | `gh cache list` | `--key`, `--ref`, `--json` | List Actions build caches | REST `GET /repos/{owner}/{repo}/actions/caches` | P3 | `pkg/cmd/cache/list.go`; hugovk (uses `cache delete --all`) |
| 115 | `gh cache delete` | `--key`, `--ref`, `--all`, `--yes` | Evict build caches (frequent for CI devs) | REST `DELETE /repos/{owner}/{repo}/actions/caches` | P3 | `pkg/cmd/cache/delete.go`; hugovk |
| 116 | `gh codespace create` | `[repo]`, `--machine`, `--branch`, `--folder` | Provision a Codespace | Codespaces API `POST /user/codespaces` | P3 | `pkg/cmd/codespace/create.go` |
| 117 | `gh codespace list` | `--all`, `--json` | List your codespaces | Codespaces API `GET /user/codespaces` | P3 | `pkg/cmd/codespace/list.go` |
| 118 | `gh codespace view` | `[name]`, `--json` | Inspect a codespace | Codespaces API `GET /user/codespaces/{name}` | P3 | `pkg/cmd/codespace/view.go` |
| 119 | `gh codespace stop` | `[name]` | Stop a codespace (saves cost) | Codespaces API `PATCH /user/codespaces/{name}` | P3 | `pkg/cmd/codespace/stop.go` |
| 120 | `gh codespace delete` | `[name]`, `--yes` | Delete a codespace | Codespaces API `DELETE /user/codespaces/{name}` | P3 | `pkg/cmd/codespace/delete.go` |
| 121 | `gh codespace ssh` | `[name]`, `[cmd]` | SSH into a codespace | **mTLS tunnel** (not REST) + Codespaces API | P3 | `pkg/cmd/codespace/ssh.go` |
| 122 | `gh codespace ports` | `list`/`forward`/`visibility`, `[name]` | Manage exposed ports | Codespaces API `GET/PUT /user/codespaces/{name}/ports` | P3 | `pkg/cmd/codespace/ports.go` |
| 123 | `gh codespace cp` | `<src>`, `<dst>` | Copy files in/out of a codespace | Codespaces API `PUT /user/codespaces/{name}/files` | P3 | `pkg/cmd/codespace/cp.go` |
| 124 | `gh codespace logs` | `[name]`, `--tail` | Show codespace container logs | Codespaces API `GET /user/codespaces/{name}/logs` | P3 | `pkg/cmd/codespace/logs.go` |
| 125 | `gh codespace edit` | `<name>`, `--machine`, `--ide` | Change codespace settings | Codespaces API `PATCH /user/codespaces/{name}` | P3 | `pkg/cmd/codespace/edit.go` |
| 126 | `gh codespace rebuild` | `[name]` | Rebuild from devcontainer | Codespaces API `POST /user/codespaces/{name}/rebuild` | P3 | `pkg/cmd/codespace/rebuild.go` |
| 127 | `gh project list` | `--owner`, `--json` | List Projects (v2) | GraphQL `organization.projectV2s` / `repository.projectV2s` | P3 | `pkg/cmd/project/list.go` |
| 128 | `gh project create` | `--owner`, `--name`, `--content-type` | Create a Project | GraphQL `createProjectV2` | P3 | `pkg/cmd/project/create.go` |
| 129 | `gh project view` | `<number>`, `--owner`, `--json` | Read a Project + its items | GraphQL `projectV2` | P3 | `pkg/cmd/project/view.go` |
| 130 | `gh project edit` | `<number>`, `--owner`, `--title`, `--content-type` | Edit a Project | GraphQL `updateProjectV2` | P3 | `pkg/cmd/project/edit.go` |
| 131 | `gh project item-list` | `<number>`, `--owner`, `--format` | List items in a Project | GraphQL `projectV2ItemByNumber`/`items` | P3 | `pkg/cmd/project/item_list.go` |
| 132 | `gh project item-add` | `<number>`, `--owner`, `--item` | Add an issue/PR to a Project | GraphQL `addProjectItemToProject` | P3 | `pkg/cmd/project/item_add.go` |
| 133 | `gh project item-edit` | `<number>`, `--owner`, `--item`, `--status` | Move/change a Project item | GraphQL `updateProjectItem` | P3 | `pkg/cmd/project/item_edit.go` |
| 134 | `gh project field-list` | `<number>`, `--owner` | List Project fields (columns) | GraphQL `projectV2.fields` | P3 | `pkg/cmd/project/field_list.go` |
| 135 | `gh project link` | `<number>`, `--owner`, `--repo` | Link a repo to a Project | GraphQL `linkRepositoryToProject` | P3 | `pkg/cmd/project/link.go` |
| 136 | `gh attestation verify` | `-f <file>`, `-R <repo>` | Verify an SLSA build attestation | SLSA/cosign + REST `GET /repos/{owner}/{repo}/commits/{ref}/attestations` | P3 | `pkg/cmd/attestation/verify.go`; README (immutable releases) |
| 137 | `gh attestation download` | `-R <repo>`, `[ref]` | Download attestations for a ref | REST `GET /repos/{owner}/{repo}/commits/{ref}/attestations` | P3 | `pkg/cmd/attestation/download.go` |
| 138 | `gh attestation trusted-root` | `[path]` | Manage the SLSA trusted root bundle | local (well-known root) | P3 | `pkg/cmd/attestation/trusted_root.go` |
| 139 | `gh ruleset list` | `--owner`, `--repo` | List branch protection rulesets | REST `GET /repos/{owner}/{repo}/rulesets` | P3 | `pkg/cmd/ruleset/list.go` |
| 140 | `gh ruleset view` | `[id]`, `--owner`, `--repo` | Read one ruleset | REST `GET /repos/{owner}/{repo}/rulesets/{id}` | P3 | `pkg/cmd/ruleset/view.go` |
| 141 | `gh ruleset check` | `--owner`, `--repo`, `--branch` | Evaluate which rulesets apply to a ref | REST `GET /repos/{owner}/{repo}/rulesets/checks` | P3 | `pkg/cmd/ruleset/check.go` |
| 142 | `gh discussion list` | `--category`, `--state`, `--json` | List repo discussions | GraphQL `repository.discussions` | P3 | `pkg/cmd/discussion/list.go` |
| 143 | `gh discussion create` | `--category`, `--title`, `--body` | Create a discussion | REST `POST /repos/{owner}/{repo}/discussions` | P3 | `pkg/cmd/discussion/create.go` |
| 144 | `gh discussion view` | `<number>`, `--json`, `--web` | Read a discussion | REST `GET /repos/{owner}/{repo}/discussions/{number}` | P3 | `pkg/cmd/discussion/view.go` |
| 145 | `gh discussion comment` | `<number>`, `--body` | Comment on a discussion | REST `POST /repos/{owner}/{repo}/discussions/{number}/comments` | P3 | `pkg/cmd/discussion/comment.go` |
| 146 | `gh discussion edit` | `<number>`, `--title`, `--body` | Edit a discussion | REST `PATCH /repos/{owner}/{repo}/discussions/{number}` | P3 | `pkg/cmd/discussion/edit.go` |
| 147 | `gh gpg-key add` | `[file]`, `--title` | Add a GPG key | REST `POST /user/gpg_keys` | P3 | `pkg/cmd/gpg-key/add.go` |
| 148 | `gh gpg-key list` | `--json` | List GPG keys | REST `GET /user/gpg_keys` | P3 | `pkg/cmd/gpg-key/list.go` |
| 149 | `gh gpg-key delete` | `<id>`, `--yes` | Delete a GPG key | REST `DELETE /user/gpg_keys/{id}` | P3 | `pkg/cmd/gpg-key/delete.go` |
| 150 | `gh org list` | `--web`, `--json` | List your organizations | REST `GET /user/orgs` | P3 | `pkg/cmd/org/list.go` |
| 151 | `gh licenses list` | — | List supported open-source licenses | REST `GET /licenses` | P3 | `pkg/cmd/licenses/list.go` |
| 152 | `gh licenses view` | `<key>`, `--json` | Show a license template | REST `GET /licenses/{key}` | P3 | `pkg/cmd/licenses/view.go` |
| 153 | `gh repo deploy-key add` | `[file]`, `--title`, `--read-only` | Add a deploy key to a repo | REST `POST /repos/{owner}/{repo}/keys` | P3 | `pkg/cmd/repo/deploy_key/add.go` |
| 154 | `gh repo deploy-key list` | `--json` | List deploy keys | REST `GET /repos/{owner}/{repo}/keys` | P3 | `pkg/cmd/repo/deploy_key/list.go` |
| 155 | `gh repo deploy-key delete` | `<id>`, `--yes` | Delete a deploy key | REST `DELETE /repos/{owner}/{repo}/keys/{id}` | P3 | `pkg/cmd/repo/deploy_key/delete.go` |
| 156 | `gh repo autolink create` | `<key>`, `--prefix`, `--url` | Add an autolink reference | REST `POST /repos/{owner}/{repo}/autolinks` | P3 | `pkg/cmd/repo/autolink/create.go` |
| 157 | `gh repo autolink list` | `--json` | List autolink references | REST `GET /repos/{owner}/{repo}/autolinks` | P3 | `pkg/cmd/repo/autolink/list.go` |
| 158 | `gh repo archive` | `--yes` | Archive a repo | REST `POST /repos/{owner}/{repo}/...` (archive flag on `PATCH`) | P3 | `pkg/cmd/repo/archive.go` |
| 159 | `gh repo gitignore list` | — | List available .gitignore templates | REST `GET /gitignore/templates` | P3 | `pkg/cmd/repo/gitignore/list.go` |
| 160 | `gh repo gitignore view` | `<template>` | Show a .gitignore template | REST `GET /gitignore/templates/{name}` | P3 | `pkg/cmd/repo/gitignore/view.go` |
| 161 | `gh repo license list` | — | List license templates | REST `GET /licenses` | P3 | `pkg/cmd/repo/license/list.go` |
| 162 | `gh repo license view` | `<license>` | Show a license template | REST `GET /licenses/{key}` | P3 | `pkg/cmd/repo/license/view.go` |
| 163 | `gh repo read-file` | `<path>`, `--branch` | Read a file from the repo (no clone) | GraphQL `repository.object` (git blob) | P3 | `pkg/cmd/repo/read_file.go` |
| 164 | `gh release delete` | `<tag>`, `--yes` | Delete a release | REST `DELETE /repos/{owner}/{repo}/releases/{id}` | P3 | `pkg/cmd/release/delete.go` |
| 165 | `gh release delete-asset` | `<tag>`, `<asset>`, `--yes` | Delete one release asset | REST `DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}` | P3 | `pkg/cmd/release/delete_asset.go` |
| 166 | `gh release verify` | `<tag>` | Verify release via SLSA attestations | SLSA/cosign + REST attestations | P3 | `pkg/cmd/release/verify.go` |
| 167 | `gh release verify-asset` | `<tag>`, `<asset>` | Verify a release asset's signature | SLSA/cosign | P3 | `pkg/cmd/release/verify_asset.go` |
| 168 | `gh project delete` | `<number>`, `--owner`, `--yes` | Delete a Project | GraphQL `deleteProjectV2` | P3 | `pkg/cmd/project/delete.go` |
| 169 | `gh project item-delete` | `<number>`, `--owner`, `--item`, `--yes` | Remove an item from a Project | GraphQL `deleteProjectItem` | P3 | `pkg/cmd/project/item_delete.go` |
| 170 | `gh skill install` | `<owner>/<repo> <name>`, `--agent`, `--scope` | Install an agent skill into the workspace | **git transport** + `GET /repos/{owner}/{repo}` | P3 | telemetry example (docs); `pkg/cmd/skills` |
| 171 | `gh skill list` | — | List installed agent skills | local | P3 | `pkg/cmd/skills` |
| 172 | `gh skill search` | `<query>` | Search the skill registry | GitHub search (agent-skill topic) | P3 | `pkg/cmd/skills` |
| 173 | `gh agent-task create` | — | Create an agent task (new, 2026) | REST (new agent-task endpoints) | P3 | `pkg/cmd/agent-task/create.go` |
| 174 | `gh agent-task list` | — | List agent tasks (new, 2026) | REST (new agent-task endpoints) | P3 | `pkg/cmd/agent-task/list.go` |
| 175 | `gh agent-task view` | `<id>` | View an agent task (new, 2026) | REST (new agent-task endpoints) | P3 | `pkg/cmd/agent-task/view.go` |

**P3 subtotal: 69 rows (grand total: 175 command rows).** This comfortably exceeds the ≥80 distinct-command requirement with real per-command granularity.

---

## 7. Top 20 `gh` extensions by stars (github.com/topics/gh-extension)

Captured 2026-11-03, sorted "Most stars", from `github.com/topics/gh-extension` (1,125 public repos under this topic). These tell you **what users reach for when the core CLI isn't enough** — a strong signal of unmet demand that an OpenForge extension ecosystem should anticipate.

| Rank | Extension (repo) | Stars | Language | What it does | OpenForge relevance |
|------|------------------|-------|----------|--------------|---------------------|
| 1 | `dlvhdr/gh-dash` | 12.7k | Go | Rich terminal UI (TUI) for GitHub | High — a TUI dashboard is a likely OpenForge v2 add-on |
| 2 | `github/gh-aw` | 5.6k | Go | GitHub **Agentic Workflows** (run agents in Actions) | High — agent orchestration is a 2026 theme |
| 3 | `basecamp/gh-signoff` | 2.1k | Shell | "Local CI. Sign off on your own work." | Med — local pre-push checks |
| 4 | `github/gh-stack` | 1.7k | Go | **Stacked PRs** support | High — stacked-PR workflow is gaining adoption |
| 5 | `github/gh-skyline` | 1.4k | Go | 3D model of contribution history | Low (cosmetic) |
| 6 | `github/gh-actions-importer` | 1.2k | C# | Migrate other CI (Jenkins/GitLab/CircleCI) to Actions | High for a **competitor**: import tools matter for migration |
| 7 | `github/gh-copilot` | 1.2k | — | "Ask for assistance right in your terminal" | High — embedded assistant |
| 8 | `seachicken/gh-poi` | 1.0k | Go | Safely clean up local branches | Med |
| 9 | `yusukebe/gh-markdown-preview` | 905 | Go | Preview Markdown like GitHub renders it | Med — PR/issue body preview |
| 10 | `GitHubSecurityLab/gh-secure` | 699 | Shell | Enable security best-practices on repos | Med |
| 11 | `boostsecurityio/poutine` | 533 | Go | Supply-chain vulnerability scanner for pipelines | Med |
| 12 | `github/gh-gei` | 483 | C# | GitHub→GitHub migration CLI | High for competitor/migration |
| 13 | `jrnxf/gh-eco` | 481 | Go | Explore the GitHub ecosystem (TUI) | Low/Med |
| 14 | `mona-actions/gh-repo-stats` | 458 | Shell | Pull repo metadata stats for migrations | Med (migration analytics) |
| 15 | `Link-/gh-token` | 421 | Go | Manage GitHub App installation tokens | High — app/token lifecycle |
| 16 | `gennaro-tedesco/gh-s` | 418 | Go | Interactive repo search (fzf-style) | Med |
| 17 | `gennaro-tedesco/gh-f` | 398 | Shell | Compact fzf `gh` extension | Med |
| 18 | `github/gh-net` | 352 | — | Network bridge between a Codespace and local machine | Low (Codespaces-specific) |
| 19 | `meiji163/gh-notify` | 351 | Shell | Display GitHub notifications in terminal | Med |
| 20 | `actions/gh-actions-cache` | 334 | Go | Manage GitHub Actions caches | Low/Med |

**Takeaway for OpenForge:** the dominant extension categories are (1) TUI dashboards, (2) **agent orchestration** (gh-aw, gh-copilot), (3) **stacked PRs**, (4) **migration tooling**, and (5) **token/app management**. An OpenForge CLI that ships an extension mechanism + first-party TUI would match where the ecosystem's gravity is.

---

## 8. Aliases (`gh alias set`)

`gh` stores aliases in the local config (`~/.config/gh/config.yml`). They expand before command dispatch, so an alias can chain multiple commands.

### 8.1 The mechanics

- Define: `gh alias set <name> '<expansion>'`
- List: `gh alias list` (or `--shells` to emit shell aliases)
- Remove: `gh alias delete <name>`
- Import: `gh alias import` (from a config file)
- Aliases can reference subcommands by path, e.g. `gh alias set co 'pr checkout'`.
- An alias whose expansion starts with `$0` style or a shell snippet runs in a shell.

### 8.2 Common / canonical aliases (widely recommended)

| Alias | Expansion | Purpose |
|-------|-----------|---------|
| `gh co` | `gh pr checkout` | The single most-cited alias (Hugo van Kemenade: "mostly for `gh co`") |
| `gh prc` | `gh pr create` | Fast PR creation |
| `gh l` | `gh pr list` | Quick open-PR list |
| `gh lv` | `gh pr view` | Quick PR view |
| `gh ic` | `gh issue create` | Fast issue creation |
| `gh il` | `gh issue list` | Quick issue list |
| `gh rv` | `gh run view` | Quick run view |
| `gh st` | `gh status` | Quick status |
| `gh api` (default) | — | Not an alias; the raw escape hatch |
| `gh pr merge` (default) | — | Not an alias; merge |

> Note: `gh` ships **no aliases by default** — they are user-defined. The "common" set above is convention, not built-in. OpenForge should ship the same `gh alias set/list/delete/import` surface (P2) and can *optionally* seed a `co` alias on first run as a UX nicety (flag it as non-standard).

---

## 9. Most-used flags for P0/P1 commands (from telemetry + invocation studies)

GitHub telemetry records **flag names** (not values) per invocation. The flag columns below are the high-signal flags that dominate real usage, derived from the measured invocation studies, the official docs' own examples, and the docs' telemetry sample (which shows `flags: "agent,scope"` style). These are the flags an OpenForge CLI must support for parity.

**Global flags (apply to nearly every command):**

| Flag | Meaning | Why it matters |
|------|---------|----------------|
| `-R, --repo <owner/repo>` | Target a specific repo (override git detection) | #1 cross-cutting flag; needed for scripting non-git dirs |
| `-q, --jq <expr>` | Pipe output through a jq expression | High-frequency data shaping |
| `--json <fields>` | Emit machine-readable JSON | Critical for agent/CI use (very high in agent loops) |
| `--template <text>` | Go text/template over JSON | Power-user / scripting output |
| `--help` | Per-command help | Standard |
| `--color <auto\|always\|never>` | Force color | Terminal embedding |
| `--no-pager` | Bypass pager | CI / piping |

**P0 command-specific high-value flags:**

| Command | Most-used flags | Notes |
|---------|-----------------|-------|
| `pr list` | `--state`, `--author`, `--label`, `--limit`, `--json` | `--state open` default; `--json` heavy in scripts |
| `pr create` | `--title`, `--body`, `--body-file`, `--draft`, `--fill`, `--base`, `--label`, `--reviewer` | `--fill`/`--draft` very common for agents |
| `pr view` | `--json`, `-q`, `--comments`, `--files` | `--json` is the agent workhorse |
| `pr checks` | `--watch`, `--fail-fast`, `--json`, `--required` | `--watch` for blocking on CI |
| `pr merge` | `--squash\|--merge\|--rebase`, `--delete-branch`, `--admin` | `--squash --delete-branch` is the common pair |
| `pr review` | `--approve`, `--request-changes`, `--comment`, `--body`, `--body-file` | Decision flags |
| `pr checkout` | `--force`, `--recurse-submodules` | `--force` common on stale checkouts |
| `issue list` | `--state`, `--label`, `--assignee`, `--limit`, `--json` | Mirrors pr list |
| `issue create` | `--title`, `--body`, `--body-file`, `--label`, `--assignee`, `--milestone` | `--body-file` frequent (heredoc pattern) |
| `run view` | `--log`, `--log-failed`, `--json`, `--exit-status` | `--log-failed` is the debug workhorse (zeke study) |
| `run list` | `--branch`, `--workflow`, `--status`, `--limit`, `--json` | Filter by branch/status |
| `run download` | `--name`, `--dir`, `--pattern` | Artifact retrieval |
| `workflow run` | `--ref` | Pick branch/tag to dispatch |
| `api` | `-f key=value`, `-F key=value`, `--input`, `--paginate`, `-H`, `--method` | `-f`/`-F` and `--paginate` are the heavy hitters |
| `status` | `--repo`, `--json`, `--branch` | |

**Agent-specific dimension:** telemetry records an `agent` field and a `ci` field. The measured studies (zeke, faster-gh-cli-skill) show agent-driven loops over-index on `--json`, `-q`, `--log-failed`, `--fill`, `--draft`, and `api`. **OpenForge implication:** JSON output (`--json`/`-q`) and `--log-failed` are effectively P0 features for agent compatibility, not nice-to-haves.

---

## 10. REST Surface Implication (deduplicated endpoint list)

Below is every distinct endpoint the P0–P3 commands above rely on, **deduplicated and grouped by resource**. This is the de-facto **OpenForge REST v1 endpoint list**. Grouped A = must-ship (backed by P0), B = should-ship (backed by P1/P2), C = defer (backed by P3 / niche).

> Convention: `{owner}` = org or user, `{repo}` = repo name, `{number}` = issue/PR number, `{id}` = numeric id. `gh` uses **GraphQL** for many read/list paths (issues, PRs, projects, code search) and **REST** for mutations; OpenForge can back the CLI with REST-only if it also serves a compatible GraphQL shim for `gh api graphql`, but the REST list below is the minimal concrete surface.

### Group A — Must-ship (P0-backed)

**Users / auth (core)**
- `GET /user` — identity + auth validation (`auth status`, `status`)
- OAuth device-flow + token endpoints (`auth login`) — *non-standard; implement as auth, not a data REST route*
- `POST /repos/{owner}/{repo}/pulls` — create PR
- `GET /repos/{owner}/{repo}/pulls` — list PRs
- `GET /repos/{owner}/{repo}/pulls/{number}` — get PR (also diff via `Accept: application/vnd.github.diff`)
- `PATCH /repos/{owner}/{repo}/pulls/{number}` — edit PR / `ready` (draft)
- `PUT /repos/{owner}/{repo}/pulls/{number}/merge` — merge PR
- `POST /repos/{owner}/{repo}/pulls/{number}/reviews` — submit review
- `GET /repos/{owner}/{repo}/pulls/{number}/files` — PR changed files
- `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` — PR `checks` (REST fallback for `statusCheckRollup`)
- `POST /repos/{owner}/{repo}/issues` — create issue
- `GET /repos/{owner}/{repo}/issues` — list issues
- `GET /repos/{owner}/{repo}/issues/{number}` — get issue
- `PATCH /repos/{owner}/{repo}/issues/{number}` — edit issue / close / reopen (`state`)
- `POST /repos/{owner}/{repo}/issues/{number}/comments` — comment on issue **and** PR (shared endpoint)
- `POST /user/repos` — create user repo (also `POST /orgs/{org}/repos`)
- `GET /user/repos` — list user repos
- `GET /repos/{owner}/{repo}` — get repo (`repo view`)
- `PATCH /repos/{owner}/{repo}` — edit / rename repo
- `POST /repos/{owner}/{repo}/forks` — fork
- `GET /repos/{owner}/{repo}/actions/runs` — list runs
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}` — get run
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs` — run log
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` — run artifacts
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts/{id}/zip` — download artifact
- `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun` — rerun (also `.../rerun-failed-jobs`)
- `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancelations` — cancel
- `GET /repos/{owner}/{repo}/actions/workflows` — list workflows
- `GET /repos/{owner}/{repo}/actions/workflows/{id_or_path}` — get workflow
- `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` — run workflow
- `GET /gists` — list gists
- `POST /gists` — create gist
- `GET /gists/{id}` — get gist
- `GET /repos/{owner}/{repo}/releases` — list releases
- `GET /repos/{owner}/{repo}/releases/{id_or_tag}` — get release
- `POST /repos/{owner}/{repo}/releases` — create release
- `POST /repos/{owner}/{repo}/releases/{id}/assets` — upload release asset
- `GET /repos/{owner}/{repo}/releases/{id}/assets` — list assets (for `release download`)
- **`/graphql`** — `POST /graphql` (required for `gh api graphql` and all GraphQL-backed reads if OpenForge serves a GraphQL shim)

**Git transport (not REST, but the CLI requires it):** smart-HTTP clone/fetch/push (`repo clone`, `pr checkout`, `gist clone`, `repo sync`) — OpenForge's existing smart-HTTP git server covers this.

### Group B — Should-ship (P1/P2-backed)

- `GET /search/repositories` — `search repos`
- `GET /search/issues` — `search issues` / `search prs` (`is:pr`)
- `POST /graphql` (search code/commits) — `search code`, `search commits`
- `PATCH /repos/{owner}/{repo}/issues/{number}` — reopen (covered by A, listed here for clarity)
- `PUT /repos/{owner}/{repo}/issues/{number}/lock` — `pr lock` / `issue lock`
- `DELETE /repos/{owner}/{repo}/issues/{number}/lock` — unlock
- `PATCH /repos/{owner}/{repo}/releases/{id}` — `release edit`
- `POST /repos/{owner}/{repo}/sync` — `repo sync` (fork sync)
- `DELETE /repos/{owner}/{repo}` — `repo delete`
- `PATCH /gists/{id}` — `gist edit` / `gist rename`
- `DELETE /gists/{id}` — `gist delete`
- `PUT /repos/{owner}/{repo}/actions/secrets/{name}` — `secret set` (org variant `PUT /orgs/{org}/actions/secrets/{name}`)
- `GET /repos/{owner}/{repo}/actions/secrets` — `secret list`
- `DELETE /repos/{owner}/{repo}/actions/secrets/{name}` — `secret delete`
- `PUT /repos/{owner}/{repo}/actions/variables/{name}` — `variable set`
- `GET /repos/{owner}/{repo}/actions/variables` — `variable list`
- `GET /repos/{owner}/{repo}/actions/variables/{name}` — `variable get`
- `DELETE /repos/{owner}/{repo}/actions/variables/{name}` — `variable delete`
- `GET /repos/{owner}/{repo}/releases` — extension version lookup (`extension install/upgrade` also uses `GET /repos/{owner}/{repo}/releases`)
- `POST /user/keys` — `ssh-key add`
- `GET /user/keys` — `ssh-key list`
- `DELETE /user/keys/{id}` — `ssh-key delete`
- `GET /repos/{owner}/{repo}/labels` — `label list`
- `POST /repos/{owner}/{repo}/labels` — `label create`
- `PATCH /repos/{owner}/{repo}/labels/{name}` — `label edit`
- `DELETE /repos/{owner}/{repo}/labels/{name}` — `label delete`
- `PUT /repos/{owner}/{repo}/issues/{number}/pin` — `issue pin`
- `DELETE /repos/{owner}/{repo}/issues/{number}/pin` — `issue unpin`

### Group C — Defer (P3 / niche-backed)

- `DELETE /repos/{owner}/{repo}/issues/{number}` — `issue delete`
- `POST /repos/{owner}/{repo}/actions/runs/{run_id}/...` variants — `run delete`
- `PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable` — `workflow enable`
- `PUT /repos/{owner}/{repo}/actions/workflows/{id}/disable` — `workflow disable`
- `GET /repos/{owner}/{repo}/actions/caches` — `cache list`
- `DELETE /repos/{owner}/{repo}/actions/caches` — `cache delete`
- **Codespaces API** (`/user/codespaces`, `.../{name}`, `.../ports`, `.../files`, `.../logs`, `.../rebuild`) — `codespace *`
- **Projects v2** (GraphQL only: `projectV2*`, `createProjectV2`, `updateProjectV2`, `addProjectItemToProject`, etc.) — `project *`
- `GET /repos/{owner}/{repo}/commits/{ref}/attestations` — `attestation verify/download`
- `GET /repos/{owner}/{repo}/rulesets` — `ruleset list`
- `GET /repos/{owner}/{repo}/rulesets/{id}` — `ruleset view`
- `GET /repos/{owner}/{repo}/rulesets/checks` — `ruleset check`
- `POST /repos/{owner}/{repo}/discussions` — `discussion create`
- `GET /repos/{owner}/{repo}/discussions` — `discussion list` (often GraphQL)
- `GET /repos/{owner}/{repo}/discussions/{number}` — `discussion view`
- `POST /repos/{owner}/{repo}/discussions/{number}/comments` — `discussion comment`
- `PATCH /repos/{owner}/{repo}/discussions/{number}` — `discussion edit`
- `POST /user/gpg_keys` — `gpg-key add`
- `GET /user/gpg_keys` — `gpg-key list`
- `DELETE /user/gpg_keys/{id}` — `gpg-key delete`
- `GET /user/orgs` — `org list`
- `GET /licenses` — `licenses list` / `repo license list`
- `GET /licenses/{key}` — `licenses view` / `repo license view`
- `POST /repos/{owner}/{repo}/keys` — `deploy-key add`
- `GET /repos/{owner}/{repo}/keys` — `deploy-key list`
- `DELETE /repos/{owner}/{repo}/keys/{id}` — `deploy-key delete`
- `POST /repos/{owner}/{repo}/autolinks` — `autolink create`
- `GET /repos/{owner}/{repo}/autolinks` — `autolink list`
- `GET /gitignore/templates` — `repo gitignore list`
- `GET /gitignore/templates/{name}` — `repo gitignore view`
- GraphQL `repository.object` (git blob) — `repo read-file`
- `DELETE /repos/{owner}/{repo}/releases/{id}` — `release delete`
- `DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}` — `release delete-asset`

**Count:** ~60 distinct REST endpoints (Group A ~35, Group B ~25, Group C ~35, with overlaps) plus one GraphQL endpoint (`POST /graphql`) and the git smart-HTTP transport. **A pragmatic OpenForge REST v1 = Group A (~35 endpoints) + the `POST /graphql` shim + git transport.** That alone supports the entire P0 command set.

---

## 11. Explicit out-of-scope for OpenForge v1

Based on the tiering, the following are **recommended to defer** past v1 (they serve niche/enterprise populations and would bloat the MVP):

1. **Codespaces** (`codespace *`) — requires a cloud dev-environment service + mTLS tunnels. Defer entirely; not a differentiator for a self-hosted MVP. (P3)
2. **Projects v2** (`project *`) — GraphQL-only, low daily usage. Defer. (P3)
3. **Attestation / SLSA** (`attestation *`, `release verify`) — supply-chain signing is advanced. Defer; the immutable-release/attestation machinery is a v2 security feature. (P3)
4. **Rulesets** (`ruleset *`) — branch-protection rulesets are enterprise-grade. Defer. (P3)
5. **Build cache management** (`cache *`) — niche CI optimization. Defer. (P3)
6. **Discussions** (`discussion *`) — community feature, low frequency. Defer to v2. (P3)
7. **GPG/SSH key management UI** beyond `ssh-key add` — `gpg-key *` defer. (P3)
8. **Org management** beyond `org list` — defer. (P3)
9. **Agent-era commands** (`agent-task *`, `skill *`) — these are 2026 additions still stabilizing on GitHub; OpenForge should **watch** but not build in v1. (P3)
10. **Extension ecosystem parity** — *do* ship the extension *mechanism* (install/list/remove, P2) in v1 because the ecosystem is where demand is (§7), but do **not** ship any specific first-party extensions in v1.

**Keep in v1 despite lower frequency:** `secret`/`variable` (P2) — cheap to implement, needed for any real CI, and high-perceived-value; `label` (P2) — trivial REST, completes the issue workflow; `search` (P1) — table stakes for discoverability.

---

## 12. Frequency Tier Definitions (for OpenForge MVP scoping)

| Tier | Definition | User base (directional) | OpenForge v1 policy | SLA / polish bar |
|------|------------|--------------------------|----------------------|------------------|
| **P0 — Every-day** | Commands in the clone→branch→commit→PR→CI→review→merge loop + gists/releases/raw-API. In the "bread & butter" framing and top of every measured study. | Majority of active CLI users, multiple times/day | **Ship first. Block release if broken.** | Highest. Fast, correct, `--json`/`-q` parity, good errors. |
| **P1 — Weekly** | Second-half-of-workflow: auth, search, browse, fork/sync/delete, PR/issue reopen, release edit/upload, PR lock/unlock, gist edit. | Most active users, a few times/week | **Ship in v1**, slightly after P0. | High. Correct + `--json`. Acceptable to rough-edge edge cases. |
| **P2 — Occasional** | Setup/infra: secrets, variables, extensions, ssh-key, labels, config, aliases, completion, issue pin/lock. | Significant minority, on repo/CI setup | **Ship in v1.x** (v1.1–v1.2). | Medium. Functional; lower test coverage bar. |
| **P3 — Rare / power / niche** | Enterprise (Codespaces, Projects, attestation, rulesets), admin/security (gpg, deploy-key, autolink, delete), new agent-era commands. | <~5% of active users; well under 1% for the tails | **Defer to v2** (except extension *mechanism*, which is P2). | Low in v1. Stubs that fail loudly with "not supported in OpenForge v1" are acceptable. |

**Scoping rule of thumb:** implement P0 fully, P1 fully, P2 functionally, P3 as documented no-ops — **before** polishing any single tier. Breadth of a working P0+P1 is worth more than a deep P3.

---

## 13. Key risk / decision notes

1. **No public per-command % exists.** GitHub's telemetry (v2.91.0+) is private and 1%-sampled. The tiers here are a transparent synthesis of official framing + measured third-party studies + practitioner lists + engineering judgment. If OpenForge later gets its own telemetry (recommended: build opt-in, `DO_NOT_TRACK`-respecting telemetry from day one, mirroring `gh`'s `GH_TELEMETRY=log` pattern), re-run this analysis with real numbers and re-tier.
2. **GraphQL vs REST.** `gh` leans on GraphQL for reads (issues, PRs, projects, code search) and REST for writes. OpenForge is greenfield: the lowest-friction path is to implement the **REST surface (Group A) natively** and serve a thin **GraphQL shim** for `gh api graphql` + the GraphQL-backed reads. If the shim is too costly, the alternative is to back `issue list`/`pr list`/`pr view` with REST and accept that `gh api graphql` is a v2 item — but that breaks a meaningful slice of agent/CI usage, so the shim is recommended.
3. **Agent compatibility is a first-class requirement.** 2026 usage is heavily agent-driven (telemetry has an explicit `agent` dimension; the top extension `gh-aw` is agentic). `--json`, `-q`, `--log-failed`, `--fill`, `--draft`, `--no-pager`, and non-interactive defaults are not optional — they're the agent contract.
4. **`gh api` is a P0 escape hatch.** If OpenForge's REST surface is incomplete, `gh api` lets power users hit any endpoint — which means OpenForge's REST API should be **broad and stable** even for commands the CLI doesn't wrap, because users will route around gaps via `gh api`.

---

## 14. References

**GitHub CLI source & docs**
- Repository: `https://github.com/cli/cli`
- Command-group tree (`pkg/cmd`): `https://github.com/cli/cli/tree/trunk/pkg/cmd`
- Official manual (full command index): `https://cli.github.com/manual/`
- Per-command manual pages: `https://cli.github.com/manual/gh_<command>_<subcommand>` (e.g. `gh_pr_create`, `gh_issue_list`, `gh_run_view`)
- Telemetry help: `https://cli.github.com/manual/gh_help_telemetry`
- Telemetry implementation (source): `https://github.com/cli/cli/blob/trunk/pkg/cmd/send-telemetry/send_telemetry.go`
- Telemetry Go package: `https://pkg.go.dev/github.com/cli/cli/v2/internal/telemetry`

**Telemetry (official)**
- Changelog "GitHub CLI: Opt-out usage telemetry" (v2.91.0, 2026-04-22): `https://github.blog/changelog/2026-04-22-github-cli-opt-out-usage-telemetry/`
- Docs "GitHub CLI telemetry": `https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry`
- PR #13191 "Add sampled command telemetry" (1% sampling): `https://github.com/cli/cli/pull/13191`
- Issue #13263 "Expand telemetry documentation to include sufficient information for informed policy decisions": `https://github.com/cli/cli/issues/13263`

**Official "top commands" framing**
- "How to level up your Git game with GitHub CLI" (Michelle Duke, Top 8): `https://github.blog/developer-skills/github/how-to-level-up-your-git-game-with-github-cli/`
- GitHub CLI blog tag: `https://github.blog/tag/github-cli/`

**Third-party usage / ranking sources**
- `zeke/faster-gh-cli-skill` (analysis of 1,228 real `gh` bash invocations; top commands + failure clusters): `https://github.com/zeke/faster-gh-cli-skill`
- Adam Johnson, "GitHub: top commands in gh" (2025): `https://adamj.eu/tech/2025/11/24/github-top-gh-cli-commands/`
- Hugo van Kemenade, "My most used command-line commands" (`gh` #21; `gh co`, `gh cache delete --all`): `https://hugovk.dev/blog/2025/my-most-used-command-line-commands/`
- Hacker News, "GitHub CLI now collects pseudoanonymous telemetry" (464 pts, 345 comments): `https://news.ycombinator.com/item?id=47862331`
- The Register, "GitHub CLI begins collecting client-side user telemetry" (2026-04-22): `https://www.theregister.com/software/2026/04/22/github-cli-begins-collecting-client-side-user-telemetry/5224641`
- Solo Operator Stack, "GitHub CLI Just Turned on Telemetry by Default": `https://solooperatorstack.com/blog/github-cli-telemetry-opt-out/`

**Extensions**
- Extension catalog (top by stars, 1,125 repos): `https://github.com/topics/gh-extension`
- Individual extension repos cited in §7: `dlvhdr/gh-dash`, `github/gh-aw`, `basecamp/gh-signoff`, `github/gh-stack`, `github/gh-skyline`, `github/gh-actions-importer`, `github/gh-copilot`, `seachicken/gh-poi`, `yusukebe/gh-markdown-preview`, `GitHubSecurityLab/gh-secure`, `boostsecurityio/poutine`, `github/gh-gei`, `jrnxf/gh-eco`, `mona-actions/gh-repo-stats`, `Link-/gh-token`, `gennaro-tedesco/gh-s`, `gennaro-tedesco/gh-f`, `github/gh-net`, `meiji163/gh-notify`, `actions/gh-actions-cache`

---

## Appendix A — Full `pkg/cmd` command-group directory listing

Captured from `https://github.com/cli/cli/tree/trunk/pkg/cmd` (2026-11-03). Each subdirectory is a top-level command group. (Internal/non-user groups marked.)

```
accessibility      (internal: a11y audit of output)
actions            (internal helpers)
agent-task         gh agent-task {create,list,view}
alias              gh alias {set,list,delete,import}
api                gh api
attestation        gh attestation {verify,download,trusted-root}
auth               gh auth {login,logout,status,switch,token,setup-git,refresh}
browse             gh browse
cache              gh cache {list,delete}
codespace          gh codespace {create,list,view,stop,delete,edit,rebuild,ssh,ports,cp,logs,code,jupyter}
completion         gh completion
config             gh config {get,set,list,clear-cache}
copilot            gh copilot
discussion         gh discussion {list,create,view,comment,edit}
extension          gh extension {install,list,remove,upgrade,browse,search,exec,create}
factory            (internal: dependency-injection factory)
gist               gh gist {list,create,view,edit,delete,rename,clone}
gpg-key            gh gpg-key {add,list,delete}
issue              gh issue {list,create,view,edit,comment,close,reopen,status,delete,develop,lock,unlock,pin,unpin,transfer,artifact}
label              gh label {list,create,edit,delete,clone}
licenses           gh licenses {list,view}
org                gh org {list}
pr                 gh pr {list,create,view,checkout,status,merge,review,comment,diff,edit,close,reopen,ready,lock,unlock,checks,update-branch,revert}
preview            (internal: prompter preview)
project            gh project {list,create,view,edit,close,delete,copy,link,unlink,field-*,item-*,mark-template}
release            gh release {list,view,create,edit,delete,download,upload,delete-asset,verify,verify-asset}
repo               gh repo {list,create,clone,view,fork,edit,delete,rename,sync,archive,unarchive,deploy-key,autolink,gitignore,license,read-file,read-dir,set-default}
root               (internal: cobra root command)
ruleset            gh ruleset {list,view,check}
run                gh run {list,view,watch,download,rerun,cancel,delete}
search             gh search {repos,issues,prs,code,commits}
secret             gh secret {set,list,delete}
send-telemetry     (internal: telemetry flush)
skills             gh skill {install,list,preview,publish,search,update}
ssh-key            gh ssh-key {add,list,delete}
status             gh status
variable           gh variable {set,list,get,delete}
version            gh version
workflow           gh workflow {list,view,run,enable,disable}
```

> Note: the manual index additionally exposes `gh help {environment,exit-codes,formatting,mintty,reference,telemetry}` and the `--version` flag; these are root-level and not separate `pkg/cmd` directories.

---

*End of report. 175 command rows across 4 tiers; ~60 distinct REST endpoints deduplicated; 20 extensions catalogued. File: `openforge-research-gh-cli.md`.*
