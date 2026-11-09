import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  c.set('requestId', c.req.header('x-request-id') ?? randomUUID())
  await next()
}
