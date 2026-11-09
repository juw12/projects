import { runGitCommand } from '../process.js'
import { sendAdvertisement, sendError } from '../responses.js'
import type { GitService, InfoRefsRequest, TransportResponse } from '../types.js'

const VALID_SERVICES: readonly GitService[] = ['upload-pack', 'receive-pack']

export function isValidService(value: string | null | undefined): value is GitService {
  return typeof value === 'string' && (VALID_SERVICES as readonly string[]).includes(value)
}

/**
 * GET /info/refs?service=<svc>
 *
 * Phase 1 of the Smart HTTP protocol. We ask git to print the current
 * ref set in pkt-line format, then prepend the required `# service=<svc>\n`
 * announcement + flush packet that clients use to detect the protocol
 * version and the service being served.
 *
 * Authorization (e.g. blocking anonymous fetches of a private repo, or
 * blocking receive-pack entirely for read-only deploys) is the route
 * layer's responsibility — by the time we get here, `repoDir` is trusted.
 */
export async function getInfoRefs(
  req: InfoRefsRequest,
  res: TransportResponse,
): Promise<void> {
  const svc = req.service
  if (!isValidService(svc)) {
    sendError(res, `unknown service "${svc}"`, 404)
    return
  }

  const { stdout, stderr, wait } = runGitCommand({
    args: [svc, '--stateless-rpc', '--advertise-refs', '.'],
    repoDir: req.repoDir,
    stdin: null,
  })

  // Buffer stdout; the advertisement is small (one line per ref + cap
  // list — typically < 64 KB even for repos with 100k refs) so we don't
  // need to stream it. If a deployment genuinely has a pathological ref
  // count, switch this to a streaming sendAdvertisement().
  const chunks: Buffer[] = []
  let total = 0
  stdout.on('data', (c: Buffer) => {
    chunks.push(c)
    total += c.length
  })

  const { exitCode, signal } = await wait

  if (exitCode !== 0) {
    let stderrText = ''
    stderr.on('data', (c: Buffer) => {
      stderrText += c.toString('utf8')
    })
    stderr.on('end', () => {
      // eslint-disable-next-line no-console
      console.error(
        `[git-transport] git ${svc} --advertise-refs exited ${exitCode} signal=${signal}\n${stderrText}`,
      )
    })
    sendError(res, `git ${svc} --advertise-refs failed`, 500)
    return
  }

  const body = Buffer.concat(chunks, total)
  sendAdvertisement(res, svc, body)
}
