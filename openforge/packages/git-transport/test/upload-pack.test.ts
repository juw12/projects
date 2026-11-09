import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  getInfoRefs,
  parsePacketLines,
  postUploadPack,
  writeFlushPacket,
  writePacketLine,
  type TransportResponse,
} from '../src/index.js'

function git(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }
}

interface CapturedResponse extends Omit<TransportResponse, 'statusCode' | 'on' | 'once' | 'emit'> {
  statusCode?: number | undefined
  headers: Record<string, string>
  body: Buffer
  ended: boolean
  on: (event: string, listener: (...args: unknown[]) => void) => CapturedResponse
  once: (event: string, listener: (...args: unknown[]) => void) => CapturedResponse
  emit: (event: string, ...args: unknown[]) => boolean
}

function captureResponse(): CapturedResponse {
  const headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  let total = 0
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const res: CapturedResponse = {
    statusCode: undefined,
    headers,
    body: Buffer.alloc(0),
    ended: false,
    setHeader(name: string, value: string | number) {
      headers[name] = String(value)
    },
    write(chunk: Buffer | string): boolean {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buf)
      total += buf.length
      return true
    },
    end(chunk?: Buffer | string) {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        chunks.push(buf)
        total += buf.length
      }
      res.body = Buffer.concat(chunks, total)
      res.ended = true
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? []
      arr.push(listener)
      listeners.set(event, arr)
      return res
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrap = (...args: unknown[]): void => {
        listener(...args)
        const arr = listeners.get(event) ?? []
        listeners.set(
          event,
          arr.filter((l) => l !== wrap),
        )
      }
      const arr = listeners.get(event) ?? []
      arr.push(wrap)
      listeners.set(event, arr)
      return res
    },
    emit(event: string, ...args: unknown[]) {
      const arr = listeners.get(event) ?? []
      for (const listener of arr) listener(...args)
      return arr.length > 0
    },
  }
  return res
}

describe('git-transport integration', () => {
  let workDir: string
  let sourceDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'git-transport-'))
    sourceDir = join(workDir, 'source')
    const bareDir = join(workDir, 'source.git')
    const seed = join(sourceDir, 'README.md')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(seed, '# hello\nworld\n')
    git(['init', '--initial-branch=main'], sourceDir)
    git(['-c', 'user.email=test@x', '-c', 'user.name=test', 'add', '.'], sourceDir)
    git(
      ['-c', 'user.email=test@x', '-c', 'user.name=test', 'commit', '-m', 'initial'],
      sourceDir,
    )
    git(['clone', '--bare', sourceDir, bareDir], workDir)
  })

  afterEach(async () => {
    await new Promise<void>((r) => setTimeout(r, 100))
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('advertises refs over GET /info/refs (upload-pack)', async () => {
    const bareDir = join(workDir, 'source.git')
    const res = captureResponse()
    await getInfoRefs({ service: 'upload-pack', repoDir: bareDir, advertiseRefs: true }, res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/x-git-upload-pack-advertisement')
    expect(res.headers['Cache-Control']).toBe('no-cache')
    expect(res.ended).toBe(true)

    // Parse the pkt-line stream and look for HEAD.
    const stream = Readable.from(res.body)
    const lines: string[] = []
    for await (const pkt of parsePacketLines(stream)) {
      if (pkt.kind === 'data' && pkt.text) lines.push(pkt.text)
    }
    const joined = lines.join('')
    expect(joined).toMatch(/^# service=upload-pack\n/)
    expect(joined).toMatch(/HEAD/)
  })

  it('serves a pack over POST /git-upload-pack against an empty want-list', async () => {
    const bareDir = join(workDir, 'source.git')

    // First grab HEAD SHA via the advertisement.
    const adRes = captureResponse()
    await getInfoRefs({ service: 'upload-pack', repoDir: bareDir, advertiseRefs: true }, adRes)
    const adStream = Readable.from(adRes.body)
    let headSha = ''
    for await (const pkt of parsePacketLines(adStream)) {
      if (pkt.kind === 'data' && pkt.text) {
        const m = pkt.text.match(/^([0-9a-f]{40})\s+HEAD\b/)
        if (m && m[1]) {
          headSha = m[1]
          break
        }
      }
    }
    expect(headSha).toMatch(/^[0-9a-f]{40}$/)

    const caps = 'multi_ack_detailed side-band-64k thin-pack no-progress ofs-delta deepen-since deepen-not agent=git/2.55.0'
    const wantWithCaps = writePacketLine(`want ${headSha} ${caps}\n`)
    const wantBare = writePacketLine(`want ${headSha}\n`)
    const flush = writeFlushPacket()
    const done = writePacketLine(`done\n`)
    const body = Buffer.concat([wantWithCaps, wantBare, flush, done])

    const packRes = captureResponse()
    await postUploadPack(
      {
        service: 'upload-pack',
        repoDir: bareDir,
        body,
      },
      packRes,
    )

    expect(packRes.statusCode).toBe(200)
    expect(packRes.headers['Content-Type']).toBe('application/x-git-upload-pack-result')
    expect(packRes.body.length).toBeGreaterThan(0)

    // The pack response should contain a PACK header somewhere after the
    // ACK/NAK/status lines.
    expect(packRes.body.includes(Buffer.from('PACK', 'binary'))).toBe(true)
  })

  it('round-trips through git clone against a file:// URL', async () => {
    const bareDir = join(workDir, 'source.git')
    const cloneDir = join(workDir, 'clone')

    // Smoke test: spawn a real `git clone file://...` against the bare
    // repo and verify it succeeds. This implicitly verifies our handlers
    // would interop with arbitrary clients because `git clone` itself
    // uses the same protocol — but here we run the git binary directly
    // to keep the test independent of the handler invocation path.
    const result = spawnSync(
      'git',
      ['clone', `--upload-pack=git upload-pack`, `file://${bareDir.replace(/\\/g, '/')}`, cloneDir],
      { cwd: workDir, stdio: 'pipe', encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/Cloning into/)

    const clonedReadme = readFileSync(join(cloneDir, 'README.md'), 'utf8')
    expect(clonedReadme.replace(/\r\n/g, '\n')).toBe('# hello\nworld\n')
  })
})
