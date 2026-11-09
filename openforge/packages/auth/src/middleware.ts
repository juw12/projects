// Hono middleware: resolve the Better Auth session from the incoming request
// and stash it on the context so downstream handlers can read `c.get('user')`
// and `c.get('session')` without re-parsing cookies / hitting the DB.

import type { MiddlewareHandler } from 'hono';
import { auth } from './config.js';

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', result?.user ?? null);
  c.set('session', result?.session ?? null);
  await next();
};
