# OpenForge Git Transport & CLI Architecture Map

## 1. GIT TRANSPORTS

### 1.1 Smart HTTP (git-http-backend)

**Source**: https://git-scm.com/docs/http-protocol

The smart HTTP protocol is the primary transport GitHub, GitLab, Gitea, and Forgejo all use. It consists of two services:

**Ref Discovery (initial request):**
```
GET $GIT_URL/info/refs?service=git-upload-pack HTTP/1.0
```

The smart server responds:
```
200 OK
Content-Type: application/x-git-upload-pack-advertisement
Cache-Control: no-cache

001e# service=git-upload-pack\n
0000
0048<oid> refs/heads/main\0<capabilities>\n
003f<oid> refs/heads/develop\n
...
0000
```

Key points:
- The `Content-Type` MUST be `application/x-$servicename-advertisement`
- The first pkt-line MUST be `# service=$servicename`
- Capabilities are NUL-separated on the FIRST ref only
- The response MUST end with a `0000` flush-pkt
- Clients MUST validate the first 5 bytes match `^[0-9a-f]{4}#`
- If the server returns a dumb response (text/plain), clients fall back to dumb protocol

**Fetch (git-upload-pack):**
```
POST $GIT_URL/git-upload-pack HTTP/1.0
Content-Type: application/x-git-upload-pack-request

0032want <oid>\n
0032have <oid>\n
0000
```

Response: `Content-Type: application/x-git-upload-pack-result` (side-band-64k stream)

**Push (git-receive-pack):**
```
POST $GIT_URL/git-receive-pack HTTP/1.0
Content-Type: application/x-git-receive-pack-request

<old-oid> <new-oid> refs/heads/main\0report-status\n
0000
PACK <binary data>
```

Response: `Content-Type: application/x-git-receive-pack-result`

**Authentication (from git-scm.com):**
- Standard HTTP Basic auth (RFC 2617)
- "Clients SHOULD support Basic authentication"
- "Servers SHOULD support Basic authentication by relying upon the HTTP server placed in front"
- "Servers SHOULD NOT require HTTP cookies for the purposes of authentication"
- **Yes, OpenForge can accept a PAT via HTTP Basic auth.** This is the canonical pattern used by Gitea, GitLab, and GitHub.

**Session State:**
- The protocol is stateless from the server's perspective
- All state is managed by the client
- "Servers MUST NOT require HTTP cookies in order to function correctly"
- This permits simple round-robin load-balancing

**Protocol version 2 (extra parameter):**
- Clients can send `Git-Protocol: version=2` header
- Server responds with `version 1` pkt-line before ref list if it supports v2
- v2 uses a stateless RPC model (multiple POSTs to `/git-upload-pack` with `command=ls-refs`, `command=fetch`, etc.)

---

### 1.2 Dumb HTTP

**Source**: https://git-scm.com/docs/http-protocol

Dumb HTTP requires only a standard static file server. The repository must be "dumb-able" (loose objects accessible via HTTP).

**Ref discovery:**
```
GET $GIT_URL/info/refs HTTP/1.0
```

Response (text/plain):
```
95dcfa3633004da0049d3d0fa03f80589cbcaf31	refs/heads/maint
d049f6c27a2244e12041955e262a404c7faba355	refs/heads/master
```

**Object fetch:**
```
GET $GIT_URL/objects/d0/49f6c27a2244e12041955e262a404c7faba355 HTTP/1.0
```

**Authentication:** Same HTTP Basic auth. Directory-based permissions on the HTTP server.

**Status:** Deprecated but still works. Smart clients auto-upgrade: if `?service=git-upload-pack` returns a dumb response, the client falls back. OpenForge should NOT need to support dumb HTTP — all modern forges have dropped it.

---

### 1.3 SSH

**Protocol:**
- `ssh://git@host/repo.git` or `git@host:repo.git`
- Runs `git-upload-pack` (fetch) or `git-receive-pack` (push) as a subprocess over SSH
- The remote command is literally `git-upload-pack '/path/to/repo.git'`

**Authentication:**
- SSH key-based (authorized_keys)
- Pattern in authorized_keys:
  ```
  command="git-shell",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-rsa AAAA...
  ```
- Or: `command="/usr/bin/git-shell -c \"git-receive-pack '/path/to/repo.git'\""`

**Server-side requirements:**
- SSH daemon running
- git-shell wrapper (or restricted shell)
- Repository accessible to the SSH user
- No HTTP involved

**OpenForge relevance:** Lower priority for MVP. Smart HTTP is the canonical web-era transport. SSH adds operational complexity (key management, port 22, firewalls).

---

### 1.4 Bundle URI (Server-Side Bundle Advertisement)

**Source**: https://git-scm.com/docs/gitformat-bundle, https://git-scm.com/docs/git-bundle

The bundle format (v3) supports capabilities:
```
# v3 git bundle
@object-format=sha1
@filter=blob:none
- <prerequisite-oid> comment
<oid> refs/heads/main
<pack data>
```

**Bundle URI in smart HTTP:**
- The server can advertise bundle URIs in the ref advertisement via the `bundle-uri` capability (added in Git 2.41+)
- The client then downloads `.bundle` files from the advertised URIs instead of doing a full pack negotiation
- This is an optimization: pre-built bundles can be much faster than on-the-fly pack negotiation

**Git version requirement:**
- `git-bundle` command: available since Git 2.8.6
- Bundle v3 format: Git 2.34+
- Bundle URI advertisement over smart HTTP: Git 2.41+ (2023)
- `--filter` in bundles: Git 2.36+

**OpenForge relevance:** This is a future optimization. Not needed for MVP. The key insight is that bundles are just `.pack` files with a text header — OpenForge could serve pre-built bundles at well-known URLs.

---

### 1.5 Partial Clone (Promisor Packs)

**Source**: https://git-scm.com/docs/protocol-capabilities (the `filter` capability)

**Mechanism:**
- Server advertises the `filter` capability in the ref advertisement
- Client sends a `filter` command in the upload-pack request:
  ```
  filter=blob:none\n
  ```
  or `filter=tree:0`
- Server sends a "promisor pack" — a pack missing certain objects
- The pack is stored as `.promisor` pack file locally
- When a missing object is needed, the client fetches it on-demand from the promisor remote

**Filter types:**
| Filter | Meaning |
|--------|---------|
| `blob:none` | Omit all blobs (get commits + trees only) |
| `tree:0` | Omit all trees AND blobs (get commits only) |
| `blob:limit=<n>` | Omit blobs larger than n bytes |
| `object:type=tag` | Omit objects of a specific type |

**Server-side requirements:**
- `uploadpack.filter` must be enabled (default in modern git)
- Server must mark the pack as `.promisor`
- Client must set `remote.<name>.promisor=true` and `remote.<name>.partialclonefilter`

**Authentication:** Same as regular smart HTTP (Basic auth with PAT).

**OpenForge relevance:** Implement the `filter` capability on the server side. This is what makes `git clone --filter=blob:none` work. Moderate complexity — requires the server to filter the pack object list before sending.

---

### 1.6 Sparse Checkout

**Source**: https://git-scm.com/docs/git-sparse-checkout (inferred from protocol docs)

**Mechanism:**
- **Client-side only.** Sparse checkout is a working-tree mechanism, not a transport feature.
- `core.sparseCheckout = true` + `core.sparseCheckoutCone = true` (cone mode)
- `.git/info/sparse-checkout` file lists patterns
- Combined with partial clone: `git clone --filter=blob:none --sparse` then `git sparse-checkout set <dirs>`

**Transport implication:**
- Sparse checkout itself requires NO server-side support
- The optimization comes from combining it with partial clone (server-side `filter` capability)
- Without partial clone, sparse checkout just avoids checking out files you don't need (still downloads everything)

**OpenForge relevance:** No server-side work needed. Just ensure the `filter` capability works (see 1.5), and sparse checkout "just works" with any conformant client.

---

### 1.7 Auth Summary Table

| Transport | Auth Method | PAT Works? | Notes |
|-----------|------------|------------|-------|
| Smart HTTP | HTTP Basic (`Authorization: Basic base64(user:token)`) | **Yes** | Canonical pattern. Gitea, GitLab, GitHub all use this. Username can be anything (often "git" or the actual username). |
| Dumb HTTP | HTTP Basic | Yes | Same mechanism, different endpoints |
| SSH | SSH keys (authorized_keys) | No (keys only) | Could add token-based SSH (GitLab does this) |
| Bundle URI | Same as the transport serving the bundle | Yes | HTTP Basic if served over HTTP |
| Partial Clone | Same as parent transport | Yes | No extra auth |
| Sparse Checkout | N/A (client-side) | N/A | No auth needed |

**For OpenForge CLI auth flow:**
- The CLI stores a PAT
- When `git fetch`/`git push` runs, git sends `Authorization: Basic base64("anything:<PAT>")` 
- OpenForge's HTTP layer validates the PAT and maps it to a user
- This is exactly how Gitea and GitLab work

---

## 2. PROTOCOL CAPABILITIES OpenForge MUST Advertise

**Source**: https://git-scm.com/docs/protocol-capabilities

The full list of capabilities and what OpenForge should support:

### Upload-pack (fetch) capabilities:

| Capability | Priority | Description |
|-----------|----------|-------------|
| `multi_ack` | **Required** | Server sends early ACKs to prevent client from walking further |
| `multi_ack_detailed` | **Required** | Extension of multi_ack with detailed state |
| `no-done` | **Required** | Smart HTTP: allows server to send pack without waiting for "done" |
| `thin-pack` | **Required** | Send thin packs (deltas referencing client-known objects) |
| `side-band-64k` | **Required** | Multiplexed progress + pack data (64KB packets) |
| `ofs-delta` | **Required** | Position-based deltas in PACKv2 |
| `agent=openforge/x.y.z` | Recommended | Informative server identification |
| `object-format=sha1` | **Required** | Declare supported hash algorithm |
| `symref=HEAD:refs/heads/main` | **Required** | Tell client where HEAD points |
| `shallow` | **Required** | Support shallow clones |
| `deepen-since` | Recommended | Time-based shallow boundary |
| `deepen-not` | Recommended | Revision-based shallow boundary |
| `deepen-relative` | Recommended | Relative deepen |
| `no-progress` | Optional | Suppress progress messages |
| `include-tag` | Recommended | Send annotated tags with their targets |
| `allow-tip-sha1-in-want` | Optional | Allow want of non-advertised tips |
| `allow-reachable-sha1-in-want` | Optional | Allow want of reachable non-advertised objects |
| `filter` | Recommended | Enable partial clone |
| `session-id=<id>` | Optional | Process tracking across requests |

### Receive-pack (push) capabilities:

| Capability | Priority | Description |
|-----------|----------|-------------|
| `report-status` | **Required** | Client gets success/failure per ref |
| `report-status-v2` | Recommended | Extended status for proc-receive hook |
| `delete-refs` | **Required** | Allow ref deletion on push |
| `quiet` | Optional | Suppress server-side progress |
| `atomic` | Recommended | All-or-nothing multi-ref updates |
| `push-options` | Recommended | Pass options to hooks |
| `push-cert=<nonce>` | Optional | Signed push certificates |
| `side-band-64k` | **Required** | Multiplexed response |
| `ofs-delta` | **Required** | Accept position-based deltas |

### Protocol v2 (stateless-rpc):

If OpenForge implements protocol v2 (recommended for new servers):
- `command=ls-refs` (replaces info/refs)
- `command=fetch` (replaces upload-pack POST)
- `command=index` (batched negotiation)
- `command=want` (request specific pack)
- `command=filter` (partial clone in v2)

**Source for v2**: https://git-scm.com/docs/protocol-v2

---

## 3. GIT LIBRARY OPTIONS (In-Process Git)

### 3.1 libgit2

**Source**: https://github.com/libgit2/libgit2, https://libgit2.org

| Property | Value |
|----------|-------|
| Language | C (C90) |
| License | GPL2 **with linking exception** (you can link from proprietary code) |
| Stars | 10.6k |
| Status | Actively maintained (v1.9 branch, CI green) |
| Used by | GitHub.com, Plastic SCM, Azure DevOps |
| Node.js binding | nodegit (see below), WASM-git (wasm-git) |
| HTTPS support | OpenSSL, mbedTLS, Schannel (Windows), WinHTTP, SecureTransport (macOS) |
| SSH support | libssh2 or exec (OpenSSH) |
| Smart HTTP | **Yes** — full client support |
| Partial clone | **Yes** — via `filter` in fetch options |

**Key API surface (175+ calls):**
- Repository management (open, init, clone)
- Reference management (create, delete, iterate, packed refs)
- ODB (object database) — read/write objects
- Index manipulation
- Tree traversal
- Revision walking
- Config management
- Network (fetch, push) with pluggable HTTP/SSH backends

**Node.js bindings:**
- **nodegit** (see 3.4 below)
- **WASM-git** (https://github.com/petersalomonsen/wasm-git) — WebAssembly build of libgit2, runs in browser and Node.js

**Verdict for OpenForge:** Best choice for server-side in-process git. GPL-with-linking-exception means OpenForge can be proprietary if desired. Full transport support. Used in production by GitHub itself.

---

### 3.2 isomorphic-git

**Source**: https://github.com/isomorphic-git/isomorphic-git

| Property | Value |
|----------|-------|
| Language | Pure JavaScript (no native deps) |
| License | MIT |
| Stars | 8.4k |
| Status | Community-maintained (2 volunteers: @jcubic, @mojavelinux) |
| Environments | Node.js 10+, Chrome, Edge, Firefox, Safari, Android, iOS |
| Smart HTTP | **Yes** — fetch and push work |
| Partial clone | **No** — not in the supported commands list |
| Sparse checkout | **No** |
| Bundle URI | **No** |

**Supported commands (from README):**
- clone, fetch, push, pull
- init, add, commit, checkout, branch, tag, merge, rebase, cherryPick
- log, status, stash, walk
- listBranches, listRefs, listTags, listRemotes
- readBlob, readCommit, readTree, readObject
- writeBlob, writeCommit, writeTree, writeObject
- And many more (full list in README)

**Architecture:**
- Bring-your-own filesystem (`fs` parameter)
- Bring-your-own HTTP client (`http` parameter)
- In Node: use native `fs` + provided node HTTP client
- In browser: use LightningFS + fetch-based HTTP client
- CORS is a known limitation in browser (needs proxy)

**CORS support status (from README):**
| Service | CORS |
|---------|------|
| Gogs (self-hosted) | Yes |
| Gitea (self-hosted) | Yes |
| Azure DevOps | Yes (with auth) |
| GitLab | No (PR rejected) |
| Bitbucket | No |
| GitHub | No |

**Verdict for OpenForge:** Good for browser-based clients (if OpenForge has a web UI that does git operations client-side). NOT suitable for server-side (too limited — no partial clone, no sparse checkout, community-maintained with low activity). For a CLI, shelling out to native git is far better.

---

### 3.3 simple-git

**Source**: https://github.com/steveukx/git-js (the package `simple-git`)

| Property | Value |
|----------|-------|
| Language | JavaScript (Node.js) |
| License | MIT |
| Mechanism | **Shells out to native `git` binary** |
| Smart HTTP | Whatever the system git supports |
| Partial clone | Whatever the system git supports |

**Verdict for OpenForge CLI:** This is the pattern. If OpenForge CLI is a Node.js app, `simple-git` (or direct `child_process.spawn('git', [...])`) gives you full git functionality by delegating to the system git binary. This is what `gh` does.

---

### 3.4 nodegit

**Source**: https://github.com/nodegit/nodegit

| Property | Value |
|----------|-------|
| Language | C++ (native Node bindings to libgit2) |
| License | MIT |
| Stars | 5.8k |
| Status | **Abandoned** (last release pinned to libgit2 v0.28.3, ~2018) |
| Native deps | Requires libssl-dev, libpcre, kerberos on Linux |
| Smart HTTP | Yes (via libgit2) |
| Partial clone | Limited (libgit2 v0.28 predates full partial clone) |

**Verdict for OpenForge:** Do NOT use. Abandoned, pinned to ancient libgit2, native build issues. If you want libgit2 in Node, use WASM-git or build your own N-API binding against current libgit2.

---

### 3.5 GitPython (Python, for parity comparison)

**Source**: https://github.com/gitpython-developers/GitPython

| Property | Value |
|----------|-------|
| Language | Python |
| License | GPL v2 |
| Mechanism | **Shells out to native `git` binary** |
| Smart HTTP | Whatever the system git supports |

**Verdict:** Not relevant for OpenForge unless it's Python-based. Included for completeness.

---

### 3.6 Library Decision Matrix for OpenForge

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Shell out to native `git`** | Full feature support, zero maintenance, all transports work, partial clone, sparse checkout, bundle-uri all free | Requires git installed on client, can't run in browser | **Best for CLI** |
| **libgit2 (C, via N-API)** | In-process, full transport support, no external binary needed | Native compilation, GPL-linking-exception, more work | **Best for server** |
| **isomorphic-git (pure JS)** | No native deps, browser-compatible, MIT | Limited features, no partial clone, community-maintained | **Only for browser** |
| **nodegit** | libgit2 in Node | Abandoned, ancient, native build pain | **Do not use** |
| **simple-git** | Easy API, full git features | Still shells out (just nicer API) | **Good CLI wrapper** |

---

## 4. EXISTING "GH ALTERNATIVES" — CANONICAL PATTERNS

### 4.1 glab (GitLab CLI)

**Source**: https://github.com/profclems/glab (ARCHIVED), https://gitlab.com/gitlab-org/cli (current)

| Property | Value |
|----------|-------|
| Language | Go |
| Stars | 2.1k (archived repo) |
| Status | Archived Nov 2022, now officially maintained by GitLab at gitlab.com/gitlab-org/cli |
| Git integration | **Shells out to native `git`** for all git operations |
| API integration | Uses GitLab REST API (v4) |
| Auth | PAT (Personal Access Token) or OAuth |
| Multi-instance | Yes — auto-detects hostname from git remotes |
| Config | XDG Base Directory Spec, `~/.config/glab-cli` |

**Architecture pattern:**
- `glab` has two concerns:
  1. **Git operations**: delegates to native `git` binary (clone, push, pull, etc.)
  2. **Platform operations**: calls GitLab REST API (issues, MRs, pipelines, CI traces)
- Auth flow: `glab auth login` → stores PAT in config → uses `GITLAB_TOKEN` env var or stored token
- The CLI does NOT implement any git protocol itself
- Inspired by `gh` (GitHub CLI)

**Key insight for OpenForge:** glab confirms the pattern: **CLI shells out to `git` for git operations, uses REST API for platform operations.** No in-process git library needed in the CLI.

---

### 4.2 tea (Gitea CLI) → now `gt`

**Source**: https://gitea.com/gitea/tea (ARCHIVED 2026-10-29), https://gitea.com/gitea/cli (new `gt`)

| Property | Value |
|----------|-------|
| Language | Go (98.8%) |
| Stars | 279 |
| Status | **Archived 2026-10-29**, replaced by `gt` at https://gitea.com/gitea/cli |
| Git integration | **Shells out to native `git`** for clone, push, pull |
| API integration | Uses `gitea.dev/sdk` (Gitea REST API SDK) |
| Auth | Application token (PAT) or OAuth (Gitea 1.18+) |
| Multi-instance | Yes — `tea login add` for multiple Gitea instances |
| Config | `$XDG_CONFIG_HOME/tea` |

**Command structure (from tea's help output):**
```
ENTITIES: issues, pulls, labels, milestones, releases, times, organizations, repos, branches, actions, comment, webhooks
HELPERS: open, notifications, clone
SETUP: logins, logout
MISCELLANEOUS: whoami, admin
```

**Auth flow:**
1. `tea login add` → prompts for instance URL, username, auth method
2. Options: "application token" (paste PAT) or "OAuth" (browser-based)
3. Token stored in `$XDG_CONFIG_HOME/tea`
4. For git operations: token used as HTTP Basic auth password

**Key insight for OpenForge:** tea confirms the same pattern: **Go CLI, shells out to git, uses REST API for platform features, PAT via HTTP Basic auth.**

**The new `gt` CLI** (gitea.com/gitea/cli) is the replacement. The migration guide is at https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md

---

### 4.3 hub (Original GitHub CLI, by mislav)

**Source**: https://github.com/github/hub (redirects to https://github.com/mislav/hub)

| Property | Value |
|----------|-------|
| Language | Go |
| Stars | 23k |
| Status | Actively maintained (3,337 commits) |
| Git integration | **"wraps git in order to extend it with extra features"** |
| Architecture | Has a `git/` package (git wrapper) and a `github/` package (API client) |
| Auth | GITHUB_TOKEN env var, or `.netrc`, or `git config` credentials |
| Aliasing | Can be aliased as `git` (all normal git commands pass through) |

**Key architectural detail:**
- `hub` can be **aliased as `git`** — it intercepts git commands, adds GitHub-specific features, and passes through everything else
- `hub clone rtomayko/tilt` → expands to `git clone https://github.com/rtomayko/tilt.git`
- `hub pr create` → calls GitHub API + `git push` + opens browser
- The `git/` directory in the repo contains code that shells out to the git binary
- Protocol support: `hub.protocol ssh` or `hub.protocol https` (default https)

**Key insight for OpenForge:** hub demonstrates the "git wrapper" pattern — the CLI intercepts git commands, translates shorthand (e.g., `openforge/user/repo` → full URL), and delegates to native git. This is the most user-friendly pattern.

---

### 4.4 gh (Official GitHub CLI)

**Source**: https://github.com/cli/cli (inferred from hub's comparison doc reference)

| Property | Value |
|----------|-------|
| Language | Go |
| Git integration | **Shells out to native `git`** |
| API | GitHub REST API + GraphQL API |
| Auth | OAuth device flow (browser), PAT, GITHUB_TOKEN |
| Pattern | `gh` for platform ops, `git` for git ops |

**The `gh-vs-hub` comparison** (referenced at https://github.com/cli/cli/blob/trunk/docs/gh-vs-hub.md) confirms:
- `gh` does NOT wrap git commands
- `gh` is a separate tool that calls git when needed
- `gh pr create` does: git push → API call to create PR → open browser

---

### 4.5 Forgejo CLI

**Source**: https://codeberg.org/forgejo/forgejo

| Property | Value |
|----------|-------|
| No dedicated CLI found | The forgejo/forgejo repo has a `cmd/` directory (server commands) |
| Language | Go 81.7% |
| Git integration | Server uses internal git handling (Go's `gitea.com/gitea/modules/git` package) |
| CLI status | **No official Forgejo CLI exists** |

**Key insight:** Forgejo (Gitea's community fork) does NOT have a dedicated CLI. The `tea` CLI works with Forgejo instances since Forgejo is API-compatible with Gitea. This is a gap in the ecosystem that OpenForge could fill.

---

### 4.6 bitbucket-cli

**Source**: Could not find an active `bitbucket-cli` project. Atlassian's tooling is the `atlassian` CLI (https://github.com/Atlassian/atlassian-cli) which is a general-purpose Atlassian API client, not a git wrapper.

**Key insight:** No canonical Bitbucket CLI exists. Bitbucket's git operations are handled by native git + their cloud API.

---

### 4.7 Pattern Summary

| CLI | Platform | Language | Git Ops | Platform Ops | Auth |
|-----|----------|----------|---------|--------------|------|
| `gh` | GitHub | Go | Shell out to `git` | REST + GraphQL API | OAuth / PAT |
| `hub` | GitHub | Go | Shell out to `git` (wraps) | REST API | PAT / .netrc |
| `glab` | GitLab | Go | Shell out to `git` | REST API | PAT / OAuth |
| `tea`/`gt` | Gitea | Go | Shell out to `git` | REST API (gitea.dev/sdk) | PAT / OAuth |
| `lab` | GitLab | Go | Shell out to `git` | REST API | PAT |
| **OpenForge CLI** | OpenForge | **TBD** | **Shell out to `git`** | **REST API** | **PAT via HTTP Basic** |

**The universal pattern is clear:**
1. CLI is written in Go (or could be Node.js/Rust)
2. Git operations: **always shell out to native `git`**
3. Platform operations: **call the forge's REST API**
4. Auth: **PAT stored locally, sent as HTTP Basic auth** (for git) and `Authorization: Bearer <token>` or `PRIVATE-TOKEN: <token>` (for API)
5. Multi-instance: detect instance from git remote URL

---

## 5. OPENFORGE-SPECIFIC FINDINGS

### 5.1 Repo Status

**Confirmed: `github.com/juw12/openforge` does NOT exist.**
- Direct URL returns 404
- Search for "openforge" in juw12's repos returns 0 results
- The current working directory is `juw12/projects` (a different repo)
- **OpenForge is truly greenfield — no scaffolded code exists**

### 5.2 Recommended Architecture (Based on Research)

```
┌─────────────────────────────────────────────────────────┐
│                    OpenForge Server                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐  │
│  │  Git Smart HTTP   │    │  REST API (v1)           │  │
│  │  (Node.js or Go)  │    │  (issues, PRs, repos,    │  │
│  │                    │    │   users, auth, etc.)     │  │
│  │  Endpoints:        │    │                          │  │
│  │  /info/refs        │    │  Auth: Bearer <PAT>      │  │
│  │  /git-upload-pack  │    │  or Basic (user:token)   │  │
│  │  /git-receive-pack │    │                          │  │
│  │                    │    └──────────────────────────┘  │
│  │  Auth: HTTP Basic  │                                  │
│  │  (user: PAT)       │    ┌──────────────────────────┐  │
│  │                    │    │  Git Object Storage       │  │
│  │  Uses libgit2      │    │  (bare repos on disk)     │  │
│  │  (or shells out    │    │                          │  │
│  │   to git binary)   │    └──────────────────────────┘  │
│  └──────────────────┘                                   │
│                                                          │
│  Capabilities to advertise:                              │
│  multi_ack, multi_ack_detailed, no-done, thin-pack,     │
│  side-band-64k, ofs-delta, symref, shallow,             │
│  deepen-since, deepen-not, include-tag, filter,         │
│  report-status, delete-refs, atomic, push-options       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    OpenForge CLI                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Language: Go (recommended, matches all other CLIs)      │
│           or Node.js (if team prefers)                   │
│                                                          │
│  Git operations:  Shell out to native `git`              │
│                   (git clone, push, pull, fetch)         │
│                   Auth: PAT in HTTP Basic header         │
│                   (via git credential helper or URL)     │
│                                                          │
│  Platform ops:    Call OpenForge REST API                │
│                   (issues, PRs, repos, users)            │
│                   Auth: Bearer <PAT> header              │
│                                                          │
│  Config:          ~/.config/openforge/ (XDG)             │
│  Multi-instance:  Detect from git remote URL             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Auth Flow Design (for OpenForge)

**Option A: HTTP Basic with PAT (RECOMMENDED — matches all existing forges)**
```
git clone https://openforge.example.com/user/repo.git
# git prompts for credentials
# Username: anything (e.g., "git" or actual username)
# Password: <PAT>
# git sends: Authorization: Basic base64("anything:<PAT>")
```

**Option B: Token in URL (convenience, less secure)**
```
git clone https://<PAT>@openforge.example.com/user/repo.git
```

**Option C: Git credential helper (BEST UX)**
```
# OpenForge CLI installs a credential helper:
git config --global credential."https://openforge.example.com".helper \
  "openforge-credential"

# The helper reads PAT from ~/.config/openforge/ and returns it
# No more password prompts
```

**How Gitea does it (from tea docs):**
1. User generates an "application token" in web UI
2. `tea login add` → stores token
3. For git: token used as password in HTTP Basic
4. For API: token sent as `Authorization: Bearer <token>`

### 5.4 Server-Side Implementation Options

| Option | Effort | Pros | Cons |
|--------|--------|------|------|
| **Shell out to `git http-backend`** | Low | Zero protocol implementation, battle-tested | Less control, harder to add custom auth |
| **Implement smart HTTP in-process (Go: go-git)** | Medium | Full control, clean architecture | Must implement protocol correctly |
| **Implement smart HTTP in-process (Node: libgit2 via N-API)** | Medium-High | Full control, JS ecosystem | Native compilation |
| **Use Gitea/Forgejo as the git backend** | Low | Proven, full feature set | Fork/maintain a large codebase |

**Recommendation for OpenForge:**
- **Server**: Use `go-git` (https://github.com/go-git/go-git) if going Go, or shell out to `git http-backend` initially for fastest MVP
- **CLI**: Shell out to native `git` for all git operations (universal pattern)
- **Auth**: HTTP Basic with PAT (matches Gitea, GitLab, GitHub)

---

## 6. PKT-LINE FORMAT (Wire Protocol Basics)

**Source**: https://git-scm.com/docs/gitprotocol-common

Every git protocol message uses pkt-line encoding:
```
pkt-line = data-pkt / flush-pkt
data-pkt = pkt-len pkt-payload
pkt-len  = 4*(HEXDIG)          ; 4 hex chars, total length including itself
pkt-payload = (pkt-len - 4)*(OCTET)
flush-pkt = "0000"             ; signals end of a sequence
```

Examples:
```
"0006a\n"  → payload: "a\n"
"0005a"    → payload: "a"
"000bfoobar\n" → payload: "foobar\n"
"0004"     → payload: "" (empty)
"0000"     → flush (end of sequence)
```

Maximum pkt-line payload: 65516 bytes.

**OpenForge MUST implement pkt-line encoding/decoding** if it implements smart HTTP in-process.

---

## 7. COMPLETE SOURCE LIST

| Source | URL | Used For |
|--------|-----|----------|
| Git HTTP Protocol | https://git-scm.com/docs/http-protocol | Smart/dumb HTTP, auth, ref discovery |
| Git Protocol Capabilities | https://git-scm.com/docs/protocol-capabilities | All capabilities list |
| Git Protocol Common (pkt-line) | https://git-scm.com/docs/gitprotocol-common | Wire format |
| Git Bundle Format | https://git-scm.com/docs/gitformat-bundle | Bundle v3, capabilities |
| Git Bundle Command | https://git-scm.com/docs/git-bundle | Bundle CLI |
| Git Config (remote) | https://git-scm.com/docs/git-config | remote.<name>.url, etc. |
| libgit2 | https://github.com/libgit2/libgit2 | C library, bindings list |
| isomorphic-git | https://github.com/isomorphic-git/isomorphic-git | Pure JS git, supported commands |
| nodegit | https://github.com/nodegit/nodegit | Abandoned libgit2 Node binding |
| glab (GitLab CLI) | https://github.com/profclems/glab | GitLab CLI pattern (archived) |
| glab (new home) | https://gitlab.com/gitlab-org/cli | Current GitLab CLI |
| hub (GitHub CLI) | https://github.com/mislav/hub | Original GitHub CLI, git wrapper |
| tea (Gitea CLI) | https://gitea.com/gitea/tea | Gitea CLI pattern (archived) |
| gt (new Gitea CLI) | https://gitea.com/gitea/cli | Current Gitea CLI |
| Forgejo | https://codeberg.org/forgejo/forgejo | Forgejo server (no CLI) |
| OpenForge | https://github.com/juw12/openforge | **404 — does not exist** |

---

## 8. DECISION RECOMMENDATIONS FOR DOWNSTREAM QUESTIONS

### (a) Does OpenForge CLI shell out to native `git` or use isomorphic-git / libgit2?

**Answer: Shell out to native `git`.**

Every single existing CLI (gh, hub, glab, tea/gt, lab) shells out to native git. This is the universal pattern. In-process git libraries are only needed if:
- You need git to work in a browser (isomorphic-git)
- You need git in a server that can't install the git binary (libgit2)
- You need to avoid the user having git installed (rare, bad UX anyway)

For the **server side**, OpenForge needs to either:
1. Shell out to `git http-backend` (simplest, fastest MVP)
2. Use `go-git` (https://github.com/go-git/go-git) for in-process smart HTTP (Go)
3. Use libgit2 via N-API (Node.js, more work)

### (b) Auth flow on smart-HTTP

**Answer: HTTP Basic with PAT. This is the canonical pattern.**

- Git sends: `Authorization: Basic base64("<anything>:<PAT>")`
- OpenForge validates the PAT from the password field
- Username can be anything (convention: the actual username or "git")
- This is how Gitea, GitLab, and GitHub all work
- The CLI stores the PAT and either:
  - Puts it in the URL: `https://<PAT>@openforge.example.com/...`
  - Uses a git credential helper
  - Sets `GIT_ASKPASS` / `GIT_CREDENTIAL_HELPER`

### (c) Does the CLI own push/fetch or delegate to a daemon?

**Answer: The CLI delegates to native `git` which handles push/fetch directly over the wire. No daemon needed.**

- `git push` / `git fetch` / `git clone` are self-contained operations
- They open an HTTP connection, negotiate, transfer data, close
- No persistent daemon or background process
- The CLI's role is:
  1. Detect the OpenForge instance from the remote URL
  2. Look up the stored PAT for that instance
  3. Configure git to use the PAT (credential helper or URL)
  4. Execute `git push` / `git fetch` etc.
  5. Report results
