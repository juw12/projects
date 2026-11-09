import { spawn, type ChildProcess } from 'node:child_process'
import { Readable } from 'node:stream'

/**
 * Default `git` binary path. Override per-host via the GIT_BINARY_PATH
 * environment variable — useful for hardened CI containers that install
 * git at /usr/local/bin/git or for Linux hosts where /usr/bin/git is
 * missing on minimal images.
 */
export const DEFAULT_GIT_PATH =
  process.platform === 'win32' ? 'git' : '/usr/bin/git'

export function gitBinaryPath(): string {
  return process.env['GIT_BINARY_PATH'] ?? DEFAULT_GIT_PATH
}

export interface RunGitOptions {
  args: string[]
  repoDir: string
  env?: NodeJS.ProcessEnv
  stdin?: Readable | null
  /**
   * If true, watch the underlying ChildProcess stdout for EPIPE (the
   * downstream consumer disconnected) and SIGTERM the git process. Set
   * this for any RPC that streams stdout into an HTTP response.
   */
  killOnClientDisconnect?: boolean
  onClientDisconnect?: () => void
}

export interface RunGitResult {
  stdout: Readable
  stderr: Readable
  process: ChildProcess
  wait: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
}

/**
 * Spawn `git <args>` in `repoDir` and return a triple of (stdout stream,
 * stderr stream, exit promise). When `stdin` is provided, we pipe it in
 * and close git's stdin once the source ends.
 *
 * Why shell out instead of using libgit2/go-git: every reference
 * implementation (Gitea routers/web/githttp.go, Forgejo modules/git/
 * command.go, OneDev server/core/plugin/git/command.go) does the same.
 * git itself has decades of battle-tested packfile negotiation logic
 * (shallow, partial-clone, multi-ack, side-band-64k). Re-implementing
 * that in TypeScript is a multi-year project and would be the #1 source
 * of protocol bugs.
 */
export function runGitCommand(opts: RunGitOptions): RunGitResult {
  const env = { ...process.env, ...(opts.env ?? {}) } as NodeJS.ProcessEnv
  const child = spawn(gitBinaryPath(), opts.args, {
    cwd: opts.repoDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = child.stdout
  const stderr = child.stderr
  if (!stdout || !stderr) {
    throw new Error('runGitCommand: failed to acquire stdio pipes from child process')
  }

  if (opts.stdin) {
    opts.stdin.pipe(child.stdin)
    opts.stdin.on('error', (err) => {
      // Source stream (e.g. HTTP request body) errored — kill git.
      child.kill('SIGTERM')
      opts.onClientDisconnect?.()
      if (!isClientDisconnectError(err)) {
        // eslint-disable-next-line no-console
        console.error('[git-transport] stdin pipe error', err)
      }
    })
    opts.stdin.on('end', () => {
      child.stdin.end()
    })
  } else {
    child.stdin.end()
  }

  if (opts.killOnClientDisconnect) {
    stdout.on('error', (err) => {
      if (isClientDisconnectError(err)) {
        child.kill('SIGTERM')
        opts.onClientDisconnect?.()
        scheduleKillEscalation(child)
      } else {
        // eslint-disable-next-line no-console
        console.error('[git-transport] stdout pipe error', err)
      }
    })
  }

  const wait = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (exitCode, signal) => {
        resolve({ exitCode, signal: signal as NodeJS.Signals | null })
      })
    },
  )

  return { stdout, stderr, process: child, wait }
}

function isClientDisconnectError(err: NodeJS.ErrnoException): boolean {
  return (
    err.code === 'EPIPE' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ERR_STREAM_DESTROYED'
  )
}

let killEscalationTimer: NodeJS.Timeout | null = null
function scheduleKillEscalation(child: ChildProcess): void {
  if (killEscalationTimer) return
  killEscalationTimer = setTimeout(() => {
    killEscalationTimer = null
    if (!child.killed) {
      child.kill('SIGKILL')
    }
  }, 5_000)
  // Don't keep the event loop alive solely for escalation.
  killEscalationTimer.unref?.()
}

/**
 * Convert a Web ReadableStream<Uint8Array> (e.g. fetch Request body)
 * into a Node Readable so it can be piped through stream APIs.
 */
export function webStreamToNode(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0])
}
