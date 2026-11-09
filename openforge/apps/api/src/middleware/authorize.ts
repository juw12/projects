import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../index.js'
import { getRepoByDisplayName } from '../services/repos.js'
import { canAccess } from '../services/permissions.js'
import type { Repository } from '../types.js'

type RepoCtx = { Variables: AppEnv['Variables'] & { repo: Repository } }

/**
 * requireRepoAccess — middleware that loads the repo from the URL path
 * (`/:owner/:repo/...`), checks the current user can see it, and stashes
 * the repo on the Hono context as `c.get('repo')` for downstream handlers.
 *
 * 404 is returned both for "repo does not exist" AND for "user can't see
 * this repo" — never leak existence of private repos to unauthorized users.
 */
export function requireRepoAccess(): MiddlewareHandler<RepoCtx> {
  return async (c, next) => {
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    if (!owner || !repo) throw new HTTPException(404, { message: 'not found' })

    const repoRow = await getRepoByDisplayName(owner, repo)
    if (!repoRow) throw new HTTPException(404, { message: 'not found' })

    const user = c.get('user')
    if (!user) {
      if (repoRow.visibility !== 'public') {
        throw new HTTPException(404, { message: 'not found' })
      }
    } else {
      const allowed =
        repoRow.visibility === 'public' ||
        repoRow.visibility === 'internal' ||
        repoRow.ownerId === user.id ||
        (await canAccess(repoRow.id, user.id, 'read'))
      if (!allowed) throw new HTTPException(404, { message: 'not found' })
    }

    c.set('repo', repoRow)
    await next()
  }
}

/**
 * requireRole — gate the route behind the user's role on the previously-
 * resolved repo (set by requireRepoAccess). 404 instead of 403 to avoid
 * leaking the repo's existence to under-privileged users.
 */
export function requireRole(role: Parameters<typeof canAccess>[2]): MiddlewareHandler<RepoCtx> {
  return async (c: Context<RepoCtx>, next) => {
    const user = c.get('user')
    const repo = c.get('repo')
    if (!user || !repo) throw new HTTPException(404, { message: 'not found' })
    const allowed = await canAccess(repo.id, user.id, role)
    if (!allowed) throw new HTTPException(404, { message: 'not found' })
    await next()
  }
}
