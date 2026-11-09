import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@openforge/db'
import { users } from '@openforge/db'
import type { AppEnv } from '../index.js'
import { requireRepoAccess } from '../middleware/authorize.js'
import {
  createRepo,
  forkRepo,
  listRepos,
  softDeleteRepo,
  updateRepo,
  RepoError,
  type OwnerRef,
  type Repository,
} from '../services/repos.js'

type Ctx = Context<{ Variables: AppEnv['Variables'] & { repo: Repository } }>

const createSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  visibility: z.enum(['public', 'private', 'internal']).default('private'),
  defaultBranch: z.string().min(1).max(100).optional(),
})

const updateSchema = z.object({
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  defaultBranch: z.string().min(1).max(100).optional(),
})

const forkSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
})

async function userOwnerFromDisplayName(displayName: string): Promise<OwnerRef | null> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.displayName, displayName))
    .limit(1)
  if (!row[0]) return null
  return { type: 'user', id: row[0].id, displayName }
}

function actorIp(c: Context): string | undefined {
  const xff = c.req.header('x-forwarded-for')
  return xff?.split(',')[0]?.trim() || undefined
}

export const reposRouter = new Hono<{ Variables: AppEnv['Variables'] & { repo: Repository } }>()
  .post('/', zValidator('json', createSchema), async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'authentication required' }, 401)
    const body = c.req.valid('json')
    const ownerDisplay = user.email.split('@')[0] ?? user.id
    try {
      const repo = await createRepo(
        { type: 'user', id: user.id, displayName: ownerDisplay },
        body,
        user.id,
        actorIp(c),
      )
      return c.json(repo, 201)
    } catch (err) {
      if (err instanceof RepoError) {
        return c.json({ error: err.message, code: err.code }, err.status as 400 | 404 | 409)
      }
      throw err
    }
  })
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'authentication required' }, 401)
    const limit = Number(c.req.query('limit') ?? '50')
    const cursor = c.req.query('cursor') ?? undefined
    const visibility = c.req.query('visibility') as 'public' | 'private' | 'internal' | undefined
    const repos = await listRepos(user.id, { limit, cursor, visibility })
    return c.json({ repos })
  })
  .get('/:owner/:repo', requireRepoAccess(), async (c: Ctx) => {
    return c.json(c.get('repo'))
  })
  .patch(
    '/:owner/:repo',
    requireRepoAccess(),
    zValidator('json', updateSchema),
    async (c: Ctx) => {
      const user = c.get('user')
      const repo = c.get('repo')
      if (!user) return c.json({ error: 'authentication required' }, 401)
      const body = c.req.valid('json')
      const ownerParam = c.req.param('owner')
      if (!ownerParam) return c.json({ error: 'not found' }, 404)
      const owner = await userOwnerFromDisplayName(ownerParam)
      if (!owner) return c.json({ error: 'not found' }, 404)
      try {
        const updated = await updateRepo(owner, repo.name, body, user.id, actorIp(c))
        return c.json(updated)
      } catch (err) {
        if (err instanceof RepoError) {
          return c.json({ error: err.message, code: err.code }, err.status as 400 | 404)
        }
        throw err
      }
    },
  )
  .delete('/:owner/:repo', requireRepoAccess(), async (c: Ctx) => {
    const user = c.get('user')
    const repo = c.get('repo')
    if (!user) return c.json({ error: 'authentication required' }, 401)
    if (c.req.query('hard') === 'true') {
      return c.json({ error: 'hard delete not allowed' }, 400)
    }
    const ownerParam = c.req.param('owner')
    if (!ownerParam) return c.json({ error: 'not found' }, 404)
    const owner = await userOwnerFromDisplayName(ownerParam)
    if (!owner) return c.json({ error: 'not found' }, 404)
    try {
      await softDeleteRepo(owner, repo.name, user.id, actorIp(c))
      return c.json({ deleted: true })
    } catch (err) {
      if (err instanceof RepoError) {
        return c.json({ error: err.message, code: err.code }, err.status as 400 | 404)
      }
      throw err
    }
  })
  .post(
    '/:owner/:repo/fork',
    requireRepoAccess(),
    zValidator('json', forkSchema),
    async (c: Ctx) => {
      const user = c.get('user')
      const sourceRepo = c.get('repo')
      if (!user) return c.json({ error: 'authentication required' }, 401)
      const body = c.req.valid('json')
      const ownerDisplay = user.email.split('@')[0] ?? user.id
      try {
        const fork = await forkRepo(
          sourceRepo,
          { type: 'user', id: user.id, displayName: ownerDisplay },
          body.name,
          user.id,
          actorIp(c),
        )
        return c.json(fork, 201)
      } catch (err) {
        if (err instanceof RepoError) {
          return c.json({ error: err.message, code: err.code }, err.status as 400 | 404 | 409)
        }
        throw err
      }
    },
  )
