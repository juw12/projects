// SPDX-License-Identifier: MIT
//
// Runner API routes. Mounted at /api/v1/runner.
//
// Auth: each request carries a Bearer JWT issued at runner registration.
// The token identifies the runner and is verified against the
// `runners` table (TODO: schema not yet defined). Until the schema is
// in place, this route uses a static shared secret in dev for testing.
//
// Spec: see openforge/runner/INTEGRATION.md § "OIDC token injection".

import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@openforge/db'
import { runners } from '@openforge/db' // assumed schema; see @openforge/db
import type { AppEnv } from '../index.js'
import { appLogger } from '../lib/logger.js'
import {
  issueOidcToken,
  validateConfig,
  type OidcIssuerConfig,
} from '../services/oidc-token.js'

type Ctx = Context<{ Variables: AppEnv['Variables'] & { runner: { id: string; name: string } } }>

const requestSchema = z.object({
  jobId: z.number().int().positive(),
  audience: z.string().trim().min(1).max(512),
  lifetimeSec: z.number().int().positive().max(15 * 60).optional(),
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

/**
 * Resolve the runner from the Authorization Bearer header. This is a
 * stub: it looks up by `name` (runners register with a unique name) and
 * assumes the shared secret is sufficient for now. Once the runner
 * registration flow is implemented, this becomes a JWT verification.
 */
async function authenticateRunner(c: Context): Promise<{ id: string; name: string } | null> {
  const auth = c.req.header('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length).trim()
  if (!token) return null

  // TODO: replace with proper JWT verification once registration is wired.
  // For now we accept a bearer that matches a runner's registration_token.
  const row = await db
    .select({ id: runners.id, name: runners.name })
    .from(runners)
    .where(eq(runners.registrationToken, token))
    .limit(1)
  if (!row[0]) return null
  return { id: row[0].id, name: row[0].name }
}

const router = new Hono<AppEnv>()

router.post('/oidc-token', zValidator('json', requestSchema), async c => {
  const runner = await authenticateRunner(c)
  if (!runner) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const body = c.req.valid('json')

  // Authorization: the runner may only mint tokens for jobs it owns.
  // TODO: join runners -> jobs to verify ownership once the schema is
  // in place. For now we accept the request and rely on caller honesty.
  // This MUST be enforced before production.
  if (!body.jobId || !body.audience) {
    return c.json({ error: 'missing jobId or audience' }, 400)
  }

  try {
    const token = issueOidcToken(getConfig(), {
      jobId: body.jobId,
      audience: body.audience,
      lifetimeSec: body.lifetimeSec,
    })
    appLogger.info(
      { runnerId: runner.id, jobId: body.jobId, audience: body.audience },
      'issued oidc token',
    )
    return c.json(token, 200)
  } catch (err) {
    appLogger.error({ err, runnerId: runner.id, jobId: body.jobId }, 'failed to issue oidc token')
    return c.json({ error: 'token issuance failed' }, 500)
  }
})

export const runnerRouter = router
