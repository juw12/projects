import { Hono } from 'hono'
import { db } from '@openforge/db'
import { sql } from 'drizzle-orm'
import { logger } from '../lib/logger.js'

export const healthRouter = new Hono().get('/', async (c) => {
  const startedAt = Date.now()
  let dbOk = false
  try {
    await db.execute(sql`SELECT 1`)
    dbOk = true
  } catch (e) {
    logger.error({ err: e }, '[healthz] db ping failed')
  }
  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
    uptimeSeconds: Math.floor(process.uptime()),
    latencyMs: Date.now() - startedAt,
  })
})
