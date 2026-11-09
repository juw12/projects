# @openforge/web

Next.js 15 (App Router) frontend for OpenForge. Phase 0 skeleton.

## Run

From the monorepo root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then edit if needed
pnpm --filter @openforge/web dev
```

Visit http://localhost:3000.

`NEXT_PUBLIC_API_URL` must point at the API server (default `http://localhost:8787`).

## Phase 0 status

This is a skeleton. Real feature work lands in later phases:

| Concern             | Phase 0                                 | Later phases                |
| ------------------- | --------------------------------------- | --------------------------- |
| Auth                | Better Auth client SDK + login form     | SSO (Phase 2)               |
| Rate limiting       | In-memory token bucket in `middleware`  | Redis (`@upstash/ratelimit`) — Phase 2 |
| API auth route      | 404 stub (use API server directly)      | BFF proxy or local handler  |
| API health          | Proxy to `/healthz` on the API server   | —                           |

## Rate limit note

The middleware in `src/middleware.ts` is an **in-memory** token bucket keyed by IP.
It works for a single Node process and resets on restart. It is **not safe across
multiple instances** and will not survive a restart. Phase 2 replaces this with a
Redis-backed limiter (e.g. `@upstash/ratelimit`).

## Layout

```
src/
  app/
    layout.tsx            Root layout (server component)
    page.tsx              Landing page
    login/page.tsx        Sign-in form (client component, Better Auth)
    api/health/route.ts   Proxies API /healthz
    api/auth/[...all]/    Auth route stub (404 for now)
  middleware.ts           Rate limit + future auth gate
  lib/auth-client.ts      Better Auth React client
```
