# OpenForge

> Self-hosted GitHub competitor. TypeScript monorepo. Next.js 15 frontend, Hono API, Postgres + Drizzle ORM, Cloudflare R2 + S3 DR, Git Smart HTTP via subprocess.

**Phase 0 scaffold.** See [Architecture Memo](#architecture-memo-summary) below for the design rationale and risk ranking that drove these choices.

---

## Quick start

```bash
# 1. Install deps (pnpm 9+, Node 22.10+)
pnpm install

# 2. Provision Postgres + Redis (local dev)
docker run -d --name openforge-pg -p 5432:5432 \
  -e POSTGRES_USER=openforge -e POSTGRES_PASSWORD=openforge \
  -e POSTGRES_DB=openforge postgres:16
docker run -d --name openforge-redis -p 6379:6379 redis:7-alpine

# 3. Generate secrets
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 4. Configure storage (R2 account, AWS IAM, etc.) — see .env.example
cp .env.example .env
# edit .env with real R2 + AWS values

# 5. Run migrations
pnpm db:migrate

# 6. Start dev servers (Next.js on :3000, Hono on :8787)
pnpm dev
```

End-to-end smoke test:
```bash
# Create a bare repo on disk
mkdir -p /tmp/openforge-test/alice/hello.git
cd /tmp/openforge-test/alice/hello.git && git init --bare
cd /tmp/openforge-test/alice/hello.git && git config receive.denyCurrentBranch ignore

# Clone it through OpenForge
git clone http://localhost:8787/alice/hello.git /tmp/cloned-hello
```

If the clone succeeds, the full Git Smart HTTP stack is working.

---

## Repository layout

```
openforge/
├── apps/
│   ├── api/                  # Hono v4 API server (port 8787)
│   │   ├── src/
│   │   │   ├── routes/       # healthz, auth, repos, git
│   │   │   ├── middleware/   # error handler, request-id
│   │   │   ├── lib/          # repo-path, visibility, can-push, logger
│   │   │   └── index.ts      # app bootstrap
│   │   └── README.md
│   └── web/                  # Next.js 15 App Router (port 3000)
│       ├── src/
│       │   ├── app/          # layout, page, login, api/auth, api/health
│       │   ├── lib/          # auth-client (Better Auth React)
│       │   └── middleware.ts # rate limiting stub
│       └── README.md
│
├── packages/
│   ├── db/                   # Drizzle ORM schema (Postgres)
│   │   ├── src/
│   │   │   ├── schema/       # 20+ tables (users, refs, permissions, etc.)
│   │   │   ├── helpers/      # ref-locking (pg_try_advisory_xact_lock)
│   │   │   └── client.ts     # postgres-js + drizzle wrapper
│   │   ├── migrations/0000_initial.sql
│   │   └── README.md
│   │
│   ├── auth/                 # Better Auth + TOTP + WebAuthn + PAT + SSH keys
│   │   ├── src/
│   │   │   ├── config.ts     # betterAuth() with Drizzle adapter
│   │   │   ├── password.ts   # argon2id (OWASP 2024 params)
│   │   │   ├── totp.ts       # speakeasy, encrypted-at-rest
│   │   │   ├── webauthn.ts   # @simplewebauthn/server v13
│   │   │   ├── ssh-keys.ts   # ssh2 + SHA-256 fingerprint
│   │   │   ├── pat.ts        # SHA-256 hashed at write
│   │   │   ├── crypto.ts     # AES-256-GCM for secret encryption
│   │   │   ├── middleware.ts # Hono session resolver
│   │   │   └── router.ts     # /api/auth/* mount
│   │   └── README.md
│   │
│   ├── git-transport/        # Git Smart HTTP (THE critical piece)
│   │   ├── src/
│   │   │   ├── packet-line.ts    # pkt-line parser/writer
│   │   │   ├── process.ts        # child_process.spawn('git', ...) with EPIPE handling
│   │   │   ├── capabilities.ts   # advertise: report-status, side-band-64k, etc.
│   │   │   ├── responses.ts      # Content-Type discipline
│   │   │   ├── auth.ts           # extract Basic / token from request
│   │   │   ├── handlers/
│   │   │   │   ├── info-refs.ts
│   │   │   │   ├── upload-pack.ts
│   │   │   │   └── receive-pack.ts
│   │   │   └── types.ts
│   │   ├── test/                # vitest, real git subprocess
│   │   └── README.md
│   │
│   └── s3/                   # Cloudflare R2 + AWS S3 DR
│       ├── src/
│       │   ├── clients.ts     # two S3Client instances (R2 primary, S3 DR)
│       │   ├── presign.ts     # 5-min PUT, 15-min GET
│       │   ├── multipart.ts   # 64 MiB threshold, abort-on-failure
│       │   ├── keys.ts        # path conventions (repos/o/r/objects/pack/<sha>.pack)
│       │   ├── replicate.ts   # cross-bucket copy
│       │   ├── integrity.ts   # SHA-1 verification (NOT ETag)
│       │   └── lifecycle.ts
│       ├── LIFECYCLE.md       # bucket lifecycle policy as code
│       └── README.md
│
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .prettierrc.json
├── .env.example              # every env var, with generation instructions
├── .gitignore
└── README.md                 # this file
```

---

## Architecture memo summary

The full research is in the prior session transcript. Key decisions baked into this scaffold:

| Layer | Decision | Why |
|---|---|---|
| **DB** | Postgres + Drizzle ORM, schema for 20+ tables, `ltree` extension | Functional decomposition before sharding; one DB until 50k+ repos |
| **Object storage** | Cloudflare R2 (primary, $0 egress) + AWS S3 (DR, with Compliance Object Lock) | Git is egress-heavy — R2 dominates TCO at scale |
| **Git transport** | Shell out to `git` binary via `child_process.spawn` with stdio piping | All 3 reference impls (Gitea, Forgejo, OneDev) do this; reimplementing packfile negotiation in TS is a multi-year project |
| **Auth** | Better Auth v1.6+ (Lucia was deprecated March 2025) + argon2id + TOTP + WebAuthn | Only mature 2026 option; matches GitHub's session cookie pattern (HttpOnly, Secure, SameSite=Lax, 14-day sliding refresh) |
| **Permissions** | Materialized `permissions` table, not derived on read | Recompute on membership event; hot path reads one row |
| **Refs** | `pg_try_advisory_xact_lock(repo_id)` + version column for atomic CAS | Gitea's pattern; matches Postgres semantics |
| **Packfile inventory** | Pack-index in S3 (`.idx`/MIDX), NOT per-OID rows in Postgres | GitLab's approach; 5B OID rows in Postgres is an anti-pattern |
| **CI sandbox (deferred to Phase 1)** | gVisor or Kata, NOT raw Docker | Chia Network self-hosted runner compromise was the lesson |

---

## Top 10 engineering risks (ranked)

| # | Risk | Mitigation |
|---|---|---|
| 1 | CI runner sandboxing + secret containment | gVisor/Kata, ephemeral VMs, short-lived job-scoped secrets |
| 2 | Atomic ref updates under concurrent push | `pg_try_advisory_lock` + `version` column + lockfile rename for packed-refs |
| 3 | 4-level permission inheritance | Single canonical `can(user, resource, action)`; never cache role; property-based tests |
| 4 | Smart-HTTP two-phase RPC edge cases | **All handled by shelling out to `git`**; we just stream correctly |
| 5 | Webhook delivery under retry storms | BullMQ + full-jitter backoff + per-destination concurrency (Phase 1) |
| 6 | Large monorepo clone/fetch performance | Partial clone (`--filter=blob:none`), MIDX, delta budget (Phase 2) |
| 7 | GC of unreachable objects | Cruft packs (Git 2.37+) with `.mtimes` (Phase 2) |
| 8 | Packfile delta application | Inherited from `git` binary |
| 9 | Git LFS pointer/object consistency | SHA-256 server-side verify + per-repo authorization (Phase 1) |
| 10 | 3-way merge correctness | Use `merge.algorithm = patience` on server-side merge buttons |

---

## Phase plan

**Phase 0 (this scaffold)** — monorepo + schema + auth + git transport + R2 client + skeletons. `pnpm dev` works end-to-end for `git clone http://localhost:8787/<owner>/<repo>.git`.

**Phase 1 (next)** — repo CRUD, push/fetch atomicity, webhook delivery with backoff, LFS pointer verification, CI runner sandbox with gVisor.

**Phase 2** — Rate limiting at ingress (move from in-memory stub to Redis), partial clone, cruft-pack GC, Stripe billing, Actions workflow runner.

**Phase 3** — Federation (study Forgejo's `models/forgefed/` if needed), Cells architecture if >100k repos, multi-region DR.

---

## Non-negotiable conventions

1. **Never call `await req.arrayBuffer()` on smart-HTTP endpoints.** Stream everything.
2. **Never trust S3 ETag as content hash.** Always SHA-1 verify the Git object.
3. **Never log secrets, PATs, or session tokens.** Pino redact list must include `password`, `token`, `secret`, `cookie`, `authorization`.
4. **Never derive permissions on read.** Materialize.
5. **Never cache SSH auth decisions across requests.** Go's `golang.org/x/crypto/ssh` callback misuse is CVE-2024-45337.
6. **Always validate Content-Type on smart-HTTP POST.** Wrong Content-Type → 415.
7. **Always pass `Git-Protocol` header → `GIT_PROTOCOL` env.** Without it, modern clients refuse to negotiate v2.
8. **Always abort multipart uploads on failure.** Orphan parts cost money.

---

## Where to learn more

- Architecture memo: `memo://architecture/openforge-2026-11-03` (in session history)
- Git Smart HTTP spec: <https://git-scm.com/docs/http-protocol>
- Gitea reference: <https://github.com/go-gitea/gitea/blob/main/routers/web/githttp.go>
- Forgejo federation: <https://codeberg.org/forgejo/forgejo/src/branch/forgejo/models/forgefed/>
- Drizzle ORM: <https://orm.drizzle.team/>
- Better Auth: <https://www.better-auth.com/>

---

## License

TBD. Phase 0 is private; AGPL-3.0 is the most likely choice at v1.0 (matches Forgejo, lets users self-host with confidence).
