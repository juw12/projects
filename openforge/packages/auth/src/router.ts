// Hono sub-router that forwards every request under the auth basePath to
// Better Auth's universal handler. Mount in apps/api as:
//
//     app.route('/api/auth', authRouter);
//
// Better Auth validates the HTTP method and the route inside `auth.handler`,
// so we register both GET and POST on a wildcard.

import { Hono } from 'hono';
import { auth } from './config.js';

export const authRouter = new Hono().on(['GET', 'POST'], '*', (c) =>
  auth.handler(c.req.raw),
);
