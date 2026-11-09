import type { MiddlewareHandler } from 'hono';
import { auth } from '@openforge/auth';

/**
 * Resolve the Better Auth session from the incoming request and stash the
 * resulting user / session on the Hono context. Anonymous requests (no
 * cookie or expired cookie) get `user = null` and `session = null`; route
 * handlers MUST treat that as "anonymous caller" and gate privileged work
 * on `c.get('user')?.id`.
 *
 * `auth.api.getSession()` validates the session cookie signature and reads
 * the user record from the database — see @openforge/auth/src/middleware.ts
 * for the upstream implementation. This wrapper exists so apps/api owns the
 * mount-point name and can swap implementations later (e.g. PAT-only routes
 * that resolve user via Authorization header) without churn at the call site.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', result?.user ?? null);
  c.set('session', result?.session ?? null);
  await next();
};
