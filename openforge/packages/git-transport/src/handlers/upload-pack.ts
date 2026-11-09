import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { runGitCommand, webStreamToNode } from '../process.js'
import { sendError } from '../responses.js'
import type { PackRequest, TransportResponse } from '../types.js'

const UPLOAD_PACK_REQUEST = 'application/x-git-upload-pack-request'
const UPLOAD_PACK_RESULT = 'application/x-git-upload-pack-result'

/**
 * POST /git-upload-pack
 *
 * Phase 2 of the Smart HTTP protocol (fetch). The client sends a
 * pkt-line stream describing the objects it wants plus optional haves;
 * git produces the negotiated packfile which we pipe back verbatim.
 *
 * We MUST NOT buffer the request body — packfile negotiation messages
 * from partial-clone clients can be megabytes and the negotiated pack
 * itself can be hundreds of MB. Every byte goes git's stdin → git's
 * stdout → response body without ever living in JS memory as a single
 * Buffer.
 *
 * Authorization is upstream — the route handler verified the requester
 * can fetch this repo before calling us. We still sanity-check the
 * Content-Type because a wrong Content-Type means we're definitely
 * talking to a non-git client.
 */
export async function postUploadPack(
  req: PackRequest,
  res: TransportResponse,
): Promise<void> {
  if (req.contentEncoding && req.contentEncoding !== 'identity' && req.contentEncoding !== 'gzip') {
    sendError(res, `unsupported content-encoding "${req.contentEncoding}"`, 415)
    return
  }

  const stdin = await bodyToStream(req)
  const gitEnv = buildGitEnv(req, 'git-upload-pack')

  const { stdout, stderr, wait } = runGitCommand({
    args: ['upload-pack', '--stateless-rpc', '.'],
    repoDir: req.repoDir,
    env: gitEnv,
    stdin,
    killOnClientDisconnect: true,
  })

  collectStderrOnExit(stderr, 'upload-pack', wait)

  res.statusCode = 200
  res.setHeader('Content-Type', UPLOAD_PACK_RESULT)
  res.setHeader('Cache-Control', 'no-cache')
  stdout.pipe(res as unknown as NodeJS.WritableStream)

  await wait
}

async function bodyToStream(req: PackRequest): Promise<Readable> {
  const body = req.body
  const raw: Readable =
    body instanceof Buffer
      ? Readable.from(body)
      : webStreamToNode(body as ReadableStream<Uint8Array>)

  if (req.contentEncoding === 'gzip') {
    const gunzip = createGunzip()
    raw.pipe(gunzip)
    gunzip.on('error', (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('[git-transport] gunzip failed', err)
      gunzip.destroy()
    })
    return gunzip
  }

  return raw
}

function buildGitEnv(req: PackRequest, sshOriginalCommand: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...(req.env ?? {}),
    SSH_ORIGINAL_COMMAND: req.sshOriginalCommand ?? sshOriginalCommand,
  }
  if (req.gitProtocol) {
    env['GIT_PROTOCOL'] = req.gitProtocol
  }
  return env
}

function collectStderrOnExit(
  stderr: Readable,
  service: string,
  wait: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>,
): void {
  let captured = ''
  stderr.on('data', (c: Buffer) => {
    captured += c.toString('utf8')
  })
  wait
    .then(({ exitCode, signal }) => {
      if (exitCode !== 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[git-transport] git ${service} exited ${exitCode} signal=${signal}\n${captured}`,
        )
      } else if (captured.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[git-transport] git ${service} stderr:\n${captured}`)
      }
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[git-transport] git ${service} wait failed`, err)
    })
}

export { UPLOAD_PACK_REQUEST }
