import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { gitRouter } from './routes/git.js'
import { reposRouter } from './routes/repos.js'
import { runnerRouter } from './routes/runner.js'
import { errorHandler } from './middleware/error.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import { authMiddleware } from './middleware/auth.js'
import { logger as appLogger } from './lib/logger.js'

export type AppEnv = {
  Variables: {
    user: { id: string; email: string } | null
    session: { id: string; userId: string; expiresAt: Date } | null
    requestId: string
  }
}

const app = new Hono<AppEnv>()

app.use('*', requestIdMiddleware)
app.use('*', logger())
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: process.env['TRUSTED_ORIGINS']?.split(',') ?? [],
    credentials: true,
  }),
)
app.use('*', errorHandler)
app.use('*', authMiddleware)

app.route('/healthz', healthRouter)
app.route('/api/auth', authRouter)
app.route('/api/repos', reposRouter)
app.route('/api/v1/runner', runnerRouter)
app.route('/', gitRouter)

const port = Number(process.env['API_PORT'] ?? 8787)
export default { port, fetch: app.fetch }

const entry = process.argv[1]
const isMain =
  !!entry &&
  (import.meta.url === `file://${entry}` ||
    import.meta.url.endsWith(entry.replace(/\\/g, '/')))

if (isMain) {
  if (typeof Bun !== 'undefined') {
    Bun.serve({ port, fetch: app.fetch })
  } else {
    const { serve } = await import('@hono/node-server')
    serve({ port, fetch: app.fetch })
  }
  appLogger.info({ port }, `[openforge-api] listening on http://localhost:${port}`)
  console.log(`[openforge-api] listening on http://localhost:${port}`)
}
