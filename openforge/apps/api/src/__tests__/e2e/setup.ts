// SPDX-License-Identifier: MIT
//
// E2E test harness for the OpenForge API.
//
// Boots the Hono app in-process and provides a minimal HTTP client
// wrapper. Database is configurable: pass DATABASE_URL to use a real
// Postgres, or leave it unset to use the in-memory mock (only covers
// routes that don't touch the DB).
//
// Usage:
//   DATABASE_URL=postgres://... pnpm vitest run e2e

import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { healthRouter } from '../routes/health.js'
import { authRouter } from '../routes/auth.js'
import { gitRouter } from '../routes/git.js'
import { reposRouter } from '../routes/repos.js'
import { runnerRouter } from '../routes/runner.js'
import { errorHandler } from '../middleware/error.js'
import { requestIdMiddleware } from '../middleware/request-id.js'
import { authMiddleware } from '../middleware/auth.js'
import type { AppEnv } from '../../index.js'

export interface TestApp {
  app: Hono<AppEnv>
  baseUrl: string
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  close: () => Promise<void>
}

export interface TestAppOptions {
  oidcIssuer: string
  oidcSigningSecret: string
}

export async function createTestApp(opts: TestAppOptions): Promise<TestApp> {
  process.env['OIDC_ISSUER'] = opts.oidcIssuer
  process.env['OIDC_SIGNING_SECRET'] = opts.oidcSigningSecret

  const app = new Hono<AppEnv>()
  app.use('*', requestIdMiddleware)
  app.use('*', logger())
  app.use('*', secureHeaders())
  app.use('*', cors({ origin: ['*'], credentials: true }))
  app.use('*', errorHandler)
  app.use('*', authMiddleware)
  app.route('/healthz', healthRouter)
  app.route('/api/auth', authRouter)
  app.route('/api/repos', reposRouter)
  app.route('/api/v1/runner', runnerRouter)
  app.route('/', gitRouter)

  return {
    app,
    baseUrl: 'http://test.local',
    fetch: (path, init) => app.request(`http://test.local${path}`, init),
    close: async () => {
      delete process.env['OIDC_ISSUER']
      delete process.env['OIDC_SIGNING_SECRET']
    },
  }
}
