// SPDX-License-Identifier: MIT
import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '@openforge/db'
import { runnerJobs } from '@openforge/db'
import type { AppEnv } from '../index.js'
import { appLogger } from '../lib/logger.js'
import {
  issueOidcToken,
  validateConfig,
  type OidcIssuerConfig,
} from '../services/oidc-token.js'
import {
  authenticateRunnerByBearer,
  extractBearer,
} from '../services/runner-auth.js'

type Ctx = Context<{ Variables: AppEnv['Variables'] & { runner: { id: string; name: string } } }>

const requestSchema = z.object({
  jobId: z.number().int().positive(),
  audience: z.string().trim().min(1).max(512),
  lifetimeSec: z.number().int().positive().max(15 * 60).optional(),
  cacheMode: z.enum(['read', 'write', 'write-only', 'none']).optional(),
  permissions: z.enum(['none', 'reviewer', 'full']).optional(),
})

let cachedConfig: OidcIssuerConfig | null = null

function getConfig(): OidcIssuerConfig {
  if (cachedConfig) return cachedConfig
  const issuer = process.env['OIDC_ISSUER']
  const secret = process.env['OIDC_SIGNING_SECRET']
  if (!issuer || !secret) {
    throw new Error(
      'OIDC_ISSUER and OIDC_SIGNING_SECRET must be set (signing secret >= 32 bytes)',
    )
  }
  cachedConfig = validateConfig({ issuer, signingSecret: secret })
  return cachedConfig
}

async function authenticateRunner(c: Context): Promise<{ id: string; name: string } | null> {
  const bearer = extractBearer(c.req.header('authorization'))
  if (!bearer) return null
  const runner = await authenticateRunnerByBearer(bearer)
  if (!runner) return null
  return { id: runner.id, name: runner.name }
}

async function runnerOwnsJob(runnerId: string, jobId: number): Promise<boolean> {
  const rows = await db
    .select({ exists: sql<number>`1` })
    .from(runnerJobs)
    .where(
      and(
        eq(runnerJobs.runnerId, runnerId),
        eq(runnerJobs.jobId, jobId),
        isNotNull(runnerJobs.pickedUpAt),
      ),
    )
    .limit(1)
  return rows.length > 0
}

const router = new Hono<AppEnv>()

router.post('/oidc-token', zValidator('json', requestSchema), async c => {
  const runner = await authenticateRunner(c)
  if (!runner) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const body = c.req.valid('json')

  const owns = await runnerOwnsJob(runner.id, body.jobId)
  if (!owns) {
    return c.json({ error: 'runner does not own this job' }, 403)
  }

  try {
    const token = issueOidcToken(getConfig(), {
      jobId: body.jobId,
      audience: body.audience,
      lifetimeSec: body.lifetimeSec,
      cacheMode: body.cacheMode,
      permissions: body.permissions,
    })
    appLogger.info(
      {
        runnerId: runner.id,
        jobId: body.jobId,
        audience: body.audience,
        cacheMode: body.cacheMode,
        permissions: body.permissions,
      },
      'issued oidc token',
    )
    return c.json(token, 200)
  } catch (err) {
    appLogger.error({ err, runnerId: runner.id, jobId: body.jobId }, 'failed to issue oidc token')
    return c.json({ error: 'token issuance failed' }, 500)
  }
})

export const runnerRouter = router
