import { writeDelimiterPacket, writeFlushPacket, writePacketLine } from './packet-line.js'
import type { GitService, TransportResponse } from './types.js'

const ADVERTISEMENT_CONTENT_TYPE = (svc: GitService) =>
  svc === 'upload-pack'
    ? 'application/x-git-upload-pack-advertisement'
    : 'application/x-git-receive-pack-advertisement'

const PACK_RESULT_CONTENT_TYPE = (svc: GitService) =>
  svc === 'upload-pack'
    ? 'application/x-git-upload-pack-result'
    : 'application/x-git-receive-pack-result'

/**
 * Phase 1 response: a `# service=<svc>\n` pkt-line, a flush, then the raw
 * ref-advertisement bytes emitted by `git <svc> --advertise-refs`.
 *
 * The leading pkt-line is required by every client — it is how cgit,
 * libgit2, and JGit detect protocol version v2 vs v1 and which service
 * they just negotiated.
 */
export function sendAdvertisement(
  res: TransportResponse,
  service: GitService,
  body: Buffer,
): void {
  res.statusCode = 200
  res.setHeader('Content-Type', ADVERTISEMENT_CONTENT_TYPE(service))
  res.setHeader('Cache-Control', 'no-cache')

  const serviceLine = writePacketLine(`# service=${service}\n`)
  const flush = writeFlushPacket()
  res.write(serviceLine)
  res.write(flush)
  res.write(body)
  res.end()
}

/**
 * Phase 2 response: pipe the bytes produced by `git <svc>
 * --stateless-rpc` straight back to the HTTP client. No leading
 * service announcement (that was phase 1).
 */
export function sendPackResult(
  res: TransportResponse,
  service: GitService,
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
): void {
  res.statusCode = 200
  res.setHeader('Content-Type', PACK_RESULT_CONTENT_TYPE(service))
  res.setHeader('Cache-Control', 'no-cache')

  const nodeStream = body as unknown as NodeJS.ReadableStream & {
    pipe?: (target: TransportResponse) => void
  }
  if (typeof nodeStream.pipe === 'function') {
    nodeStream.pipe(res)
    return
  }
  // Fallback: drain the Web stream into chunks and write them.
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const pump = async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        res.end()
        return
      }
      if (value) {
        const flushed = res.write(Buffer.from(value))
        if (!flushed) {
          await new Promise<void>((resolve) => {
            res.once?.('drain', () => resolve())
          })
        }
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  pump()
}

/**
 * Server-side error reply — emit an ERR pkt-line followed by a flush so
 * the client surfaces the message in its UI (as opposed to treating the
 * truncated stream as a network error).
 */
export function sendError(
  res: TransportResponse,
  message: string,
  status: 401 | 403 | 404 | 415 | 500,
): void {
  res.statusCode = status
  res.setHeader('Content-Type', PACK_RESULT_CONTENT_TYPE('receive-pack'))
  res.setHeader('Cache-Control', 'no-cache')
  res.write(writePacketLine(`ERR ${message}\n`))
  res.write(writeDelimiterPacket())
  res.write(writeFlushPacket())
  res.end()
}
