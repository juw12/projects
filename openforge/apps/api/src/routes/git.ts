import { Hono, type Context } from 'hono'
import {
  extractAuth,
  getInfoRefs,
  postUploadPack,
  sendError,
  runGitCommand,
  webStreamToNode,
  writeFlushPacket,
  writePacketLine,
  type ExtractedAuth,
  type GitService,
} from '@openforge/git-transport'
import { resolveBareRepoPath } from '../lib/repo-path.js'
import { getRepoVisibility } from '../lib/visibility.js'
import { userCanWriteRepo } from '../lib/permissions.js'
import { resolveAuthUserId } from '../lib/auth-user.js'
import { parseRefUpdateLines } from '../lib/git-refs.js'
import {
  withRepoLock,
  readRefs,
  updateRefs,
  RefConflictError,
} from '../services/refs.js'
import { db, repositories, users, RepoLockedError } from '@openforge/db'
import { and, eq } from 'drizzle-orm'
import { logger } from '../lib/logger.js'

const PATH_PATTERN = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-(?:upload|receive)-pack)\/?$/

type Visibility = 'public' | 'private' | 'internal' | null

interface ParsedPath {
  owner: string
  repo: string
  endpoint: 'info-refs' | 'upload-pack' | 'receive-pack'
}

function parseOwnerRepo(pathname: string): ParsedPath | null {
  const match = pathname.match(PATH_PATTERN)
  if (!match) return null
  const [, owner, repo, suffix] = match
  if (!owner || !repo || !suffix) return null
  const endpoint: ParsedPath['endpoint'] =
    suffix === 'info-refs'
      ? 'info-refs'
      : suffix === 'git-upload-pack'
        ? 'upload-pack'
        : 'receive-pack'
  return { owner, repo, endpoint }
}

function extractRequestAuth(c: Context): ExtractedAuth {
  const params = new URLSearchParams()
  for (const [key, values] of Object.entries(c.req.queries())) {
    const first = values[0]
    if (first !== undefined) params.set(key, first)
  }
  return extractAuth({
    headers: c.req.raw.headers,
    query: params,
    ip: c.req.header('x-forwarded-for') ?? '',
  })
}

async function authorize(
  c: Context,
  owner: string,
  repo: string,
  service: GitService,
  visibility: Visibility,
): Promise<{ auth: ExtractedAuth } | Response> {
  const auth = extractRequestAuth(c)
  if (service === 'upload-pack' && visibility === 'private' && auth.type === 'none') {
    c.header('WWW-Authenticate', 'Basic realm="OpenForge"')
    return sendError(c, 'authentication required', 401) as Response
  }
  if (service === 'receive-pack' && auth.type === 'none') {
    return sendError(c, 'authentication required', 401) as Response
  }
  return { auth }
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

async function loadRepoByOwnerName(
  owner: string,
  repo: string,
): Promise<{ id: string; ownerUserId: string } | null> {
  const rows = await db
    .select({ id: repositories.id, ownerUserId: repositories.ownerId })
    .from(repositories)
    .innerJoin(users, eq(users.id, repositories.ownerId))
    .where(
      and(
        eq(repositories.ownerType, 'user'),
        eq(users.displayName, owner),
        eq(repositories.name, repo),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

const RECEIVE_PACK_RESULT = 'application/x-git-receive-pack-result'

export const gitRouter = new Hono()
  .get('/info/refs', async (c) => {
    const service = c.req.query('service')
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      return sendError(c, 'invalid service', 400)
    }

    const parsed = parseOwnerRepo(c.req.path)
    if (!parsed) return sendError(c, 'invalid path', 400)

    const repoDir = await resolveBareRepoPath(parsed.owner, parsed.repo)
    if (!repoDir) return sendError(c, 'repository not found', 404)

    const visibility = await getRepoVisibility(parsed.owner, parsed.repo)
    const transportService: GitService =
      service === 'git-upload-pack' ? 'upload-pack' : 'receive-pack'

    const authz = await authorize(c, parsed.owner, parsed.repo, transportService, visibility)
    if (authz instanceof Response) return authz

    return getInfoRefs(c, {
      service: transportService,
      repoDir,
      advertiseRefs: true,
    })
  })
  .post('/git-upload-pack', async (c) => {
    const parsed = parseOwnerRepo(c.req.path)
    if (!parsed) return sendError(c, 'invalid path', 400)

    const repoDir = await resolveBareRepoPath(parsed.owner, parsed.repo)
    if (!repoDir) return sendError(c, 'repository not found', 404)

    const visibility = await getRepoVisibility(parsed.owner, parsed.repo)
    const authz = await authorize(c, parsed.owner, parsed.repo, 'upload-pack', visibility)
    if (authz instanceof Response) return authz

    return postUploadPack(c, {
      service: 'upload-pack',
      repoDir,
      body: c.req.raw.body ?? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
      gitProtocol: c.req.header('git-protocol') ?? undefined,
    })
  })
  .post('/git-receive-pack', async (c) => {
    const requestId = c.get('requestId') ?? 'unknown'
    const parsed = parseOwnerRepo(c.req.path)
    if (!parsed) return sendError(c, 'invalid path', 400)

    const repoDir = await resolveBareRepoPath(parsed.owner, parsed.repo)
    if (!repoDir) return sendError(c, 'repository not found', 404)

    const visibility = await getRepoVisibility(parsed.owner, parsed.repo)
    const authz = await authorize(c, parsed.owner, parsed.repo, 'receive-pack', visibility)
    if (authz instanceof Response) return authz
    const { auth } = authz

    // Resolve repo in DB. The bare repo directory already exists at
    // this point; the DB row carries `id` (advisory lock key) and
    // `owner_id` (write-permission default). Phase 1 keeps disk and
    // DB in lockstep — if no DB row, treat as 404.
    const repo = await loadRepoByOwnerName(parsed.owner, parsed.repo)
    if (!repo) return sendError(c, 'repository not found', 404)

    // Resolve credentials to a userId. Phase 1: basic auth matches
    // email or displayName; token resolution lands in Phase 2 with
    // Better Auth's PAT middleware.
    const resolvedUserId = await resolveAuthUserId(auth)
    // Fall back to the repo owner for `updated_by_user_id` attribution
    // when the credential couldn't be resolved. Better than NULL.
    const userId = resolvedUserId ?? repo.ownerUserId

    // Write permission check. Owner is implicitly admin; everyone else
    // needs a row in `permissions` with role >= 'write'.
    if (!(await userCanWriteRepo(userId, repo.id))) {
      return sendError(c, 'forbidden', 403) as Response
    }

    try {
      const statusReport = await withRepoLock(repo.id, async (tx) => {
        const pre = await readRefs(tx, repo.id)

        const env: Record<string, string> = {
          SSH_ORIGINAL_COMMAND: 'git-receive-pack',
          OPENFORGE_REPO_ID: repo.id,
        }
        const gitProtocol = c.req.header('git-protocol')
        if (gitProtocol) env['GIT_PROTOCOL'] = gitProtocol

        const bodyStream = c.req.raw.body ?? emptyStream()
        const stdin = webStreamToNode(bodyStream)

        const chunks: Buffer[] = []
        let total = 0
        const stderrChunks: Buffer[] = []

        const { stdout, stderr, wait } = runGitCommand({
          args: ['receive-pack', '--stateless-rpc', '.'],
          repoDir,
          env,
          stdin,
          killOnClientDisconnect: true,
        })

        stdout.on('data', (buf: Buffer) => {
          chunks.push(buf)
          total += buf.length
        })
        stderr.on('data', (buf: Buffer) => {
          stderrChunks.push(buf)
        })

        const { exitCode, signal } = await wait
        const statusReport = Buffer.concat(chunks, total)
        const stderrText = Buffer.concat(stderrChunks).toString('utf8')

        if (exitCode !== 0) {
          logger.warn(
            {
              requestId,
              repoId: repo.id,
              exitCode,
              signal,
              stderr: stderrText.slice(0, 4096),
            },
            '[git] receive-pack exited non-zero; rolling back transaction',
          )
          // Throw to roll back the transaction (and release the
          // advisory lock). The bare repo on disk may already have
          // partial state; the Phase 2 reconciler sweeps divergent
          // state. We still forward git's status report so the client
          // sees the actual failure.
          throw new GitReceivePackFailure(statusReport, exitCode, signal ?? null)
        }

        const statusText = statusReport.toString('utf8')
        const parsed = parseRefUpdateLines(statusText)

        if (parsed.length === 0) {
          // Push succeeded but no refs changed (e.g. delete-only or
          // no-op). Lock releases via transaction commit.
          return statusReport
        }

        await updateRefs(
          tx,
          repo.id,
          parsed.map(({ refName, newSha }) => ({ refName, newSha, userId })),
        )

        return statusReport
      })

      return new Response(new Uint8Array(statusReport), {
        status: 200,
        headers: {
          'Content-Type': RECEIVE_PACK_RESULT,
          'Cache-Control': 'no-cache',
        },
      })
    } catch (e) {
      if (e instanceof RepoLockedError) {
        logger.warn(
          { requestId, repoId: repo.id },
          '[git] repo locked; another push in flight',
        )
        return c.json(
          { error: 'repository is locked by another push; client should retry', requestId },
          409,
        )
      }
      if (e instanceof RefConflictError) {
        // Critical: bare repo on disk has the new refs; DB does not.
        // Audit row was written by applyPostReceiveChanges (or by the
        // inline updateRefs path). Treat as a critical incident.
        logger.error(
          {
            requestId,
            repoId: repo.id,
            refName: e.refName,
            expectedVersion: e.expectedVersion,
          },
          '[git] CRITICAL: bare repo and DB diverged — git succeeded but CAS failed',
        )
        return c.json(
          {
            error: 'ref conflict after push; bare repo and DB may have diverged',
            requestId,
          },
          500,
        )
      }
      if (e instanceof GitReceivePackFailure) {
        // Forward git's status report so the client sees the per-ref
        // failures. If git produced no output at all (crashed), fall
        // back to a synthetic ERR pkt-line.
        if (e.statusReport.length > 0) {
          return new Response(new Uint8Array(e.statusReport), {
            status: 200,
            headers: {
              'Content-Type': RECEIVE_PACK_RESULT,
              'Cache-Control': 'no-cache',
            },
          })
        }
        const errMessage = `ERR git receive-pack crashed (exit ${e.exitCode}${e.signal ? `, signal ${e.signal}` : ''})\n`
        const errBuf = Buffer.concat([writePacketLine(errMessage), writeFlushPacket()])
        return new Response(new Uint8Array(errBuf), {
          status: 500,
          headers: {
            'Content-Type': RECEIVE_PACK_RESULT,
            'Cache-Control': 'no-cache',
          },
        })
      }
      throw e
    }
  })

/**
 * Carries git's status report out of the lock-and-run callback so the
 * route can forward it to the client when git exited non-zero.
 */
class GitReceivePackFailure extends Error {
  readonly statusReport: Buffer
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  constructor(statusReport: Buffer, exitCode: number | null, signal: NodeJS.Signals | null) {
    super(`git receive-pack exited ${exitCode} signal=${signal}`)
    this.name = 'GitReceivePackFailure'
    this.statusReport = statusReport
    this.exitCode = exitCode
    this.signal = signal
  }
}
