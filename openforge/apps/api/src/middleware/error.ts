import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from '../lib/logger.js'

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown'
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, requestId }, err.status)
  }
  logger.error({ requestId, err }, '[api] unhandled error')
  return c.json({ error: 'Internal server error', requestId }, 500)
}
