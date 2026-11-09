import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { runGitCommand, webStreamToNode } from '../process.js'
import { sendError } from '../responses.js'
import type { PackRequest, TransportResponse } from '../types.js'

const RECEIVE_PACK_REQUEST = 'application/x-git-receive-pack-request'
const RECEIVE_PACK_RESULT = 'application/x-git-receive-pack-result'

/**
 * POST /git-receive-pack
 *
 * Phase 2 of the Smart HTTP protocol (push). Symmetrical to
 * postUploadPack: stream the request body into `git receive-pack
 * --stateless-rpc` and stream git's stdout (status report + optional
 * progress) back to the client.
 *
 * We MUST set SSH_ORIGINAL_COMMAND=git-receive-pack so that any
 * pre-receive / update / post-receive / post-update hooks attached to
 * the repo fire correctly — most hook templates key off that env var
 * to detect push-vs-clone origin.
 *
 * The route handler verifies the user has write access BEFORE calling
 * us. We do not re-authorize here — if you reach this function with
 * read-only credentials, push-side damage is the route layer's fault.
 */
export async function postReceivePack(
  req: PackRequest,
  res: TransportResponse,
): Promise<void> {
  if (req.contentEncoding && req.contentEncoding !== 'identity' && req.contentEncoding !== 'gzip') {
    sendError(res, `unsupported content-encoding "${req.contentEncoding}"`, 415)
    return
  }

  const stdin = await bodyToStream(req)
  const gitEnv = buildGitEnv(req, 'git-receive-pack')

  const { stdout, stderr, wait } = runGitCommand({
    args: ['receive-pack', '--stateless-rpc', '.'],
    repoDir: req.repoDir,
    env: gitEnv,
    stdin,
    killOnClientDisconnect: true,
  })

  collectStderrOnExit(stderr, 'receive-pack', wait)

  res.statusCode = 200
  res.setHeader('Content-Type', RECEIVE_PACK_RESULT)
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

export { RECEIVE_PACK_REQUEST }
