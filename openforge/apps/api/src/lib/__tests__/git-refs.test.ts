/**
 * Tests for apps/api/src/lib/git-refs.ts.
 *
 * `parseRefUpdateLines` is exercised purely with synthetic strings.
 * `readBareRepoRefs` needs a real bare repo on disk so it can verify
 * loose-vs-packed resolution matches git's own behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBareRepoRefs, parseRefUpdateLines } from '../git-refs.js'

function git(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${cwd}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }
}

function sha(seed: string): string {
  // Deterministic 40-char hex from a seed. Real SHAs are content-
  // addressed; for tests we only care that each value is a valid
  // looking SHA so isSha() accepts it.
  let h = 0
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  const base = h.toString(16).padStart(8, '0').repeat(5)
  return base.slice(0, 40)
}

describe('parseRefUpdateLines', () => {
  it('extracts ref updates from a plain text status report', () => {
    const status = [
      'unpack ok',
      `${'0'.repeat(40)} ${'a'.repeat(40)} refs/heads/main`,
      `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/dev`,
      'ok refs/heads/main',
      'ok refs/heads/dev',
      '0000',
    ].join('\n')

    const changes = parseRefUpdateLines(status)
    expect(changes).toEqual([
      { oldSha: '0'.repeat(40), newSha: 'a'.repeat(40), refName: 'refs/heads/main' },
      { oldSha: 'a'.repeat(40), newSha: 'b'.repeat(40), refName: 'refs/heads/dev' },
    ])
  })

  it('strips pkt-line framing (4 hex ASCII bytes + payload)', () => {
    // Each ref update line is preceded by a 4-char hex pkt-line length.
    // For "aaaa...aaaa bbbb...bbbb refs/heads/main\n" the length is
    // 40 + 1 + 40 + 1 + 15 + 1 = 98 bytes; the pkt-line header is
    // 4 bytes, so total = 102 → "0066".
    const line = `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/main\n`
    const expectedLength = 4 + line.length
    const hex = expectedLength.toString(16).padStart(4, '0')
    const framed = `${hex}${line}`
    const status = `000eunpack ok\n${framed}000aok refs/heads/main\n0000`

    const changes = parseRefUpdateLines(status)
    expect(changes).toEqual([
      { oldSha: 'a'.repeat(40), newSha: 'b'.repeat(40), refName: 'refs/heads/main' },
    ])
  })

  it('handles a delete (new-sha is all zeros)', () => {
    const status = `${'a'.repeat(40)} ${'0'.repeat(40)} refs/heads/gone\n`
    const changes = parseRefUpdateLines(status)
    expect(changes).toEqual([
      { oldSha: 'a'.repeat(40), newSha: '0'.repeat(40), refName: 'refs/heads/gone' },
    ])
  })

  it('skips ok/ng/unpack lines', () => {
    const status = [
      'unpack ok',
      'ok refs/heads/main',
      'ng refs/heads/dev rejected: non-fast-forward',
    ].join('\n')
    expect(parseRefUpdateLines(status)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(parseRefUpdateLines('')).toEqual([])
  })

  it('skips flush and delimiter packets', () => {
    expect(parseRefUpdateLines('0000')).toEqual([])
    expect(parseRefUpdateLines('0001')).toEqual([])
  })

  it('extracts multiple updates in one report', () => {
    const status = [
      'unpack ok',
      `${'0'.repeat(40)} ${'a'.repeat(40)} refs/heads/main`,
      `${'0'.repeat(40)} ${'b'.repeat(40)} refs/tags/v1.0`,
      `${'0'.repeat(40)} ${'c'.repeat(40)} refs/heads/feature/x`,
      'ok refs/heads/main',
      '0000',
    ].join('\n')
    const changes = parseRefUpdateLines(status)
    expect(changes).toHaveLength(3)
    expect(changes.map((c) => c.refName)).toEqual([
      'refs/heads/main',
      'refs/tags/v1.0',
      'refs/heads/feature/x',
    ])
  })
})

describe('readBareRepoRefs', () => {
  let workDir: string
  let bareDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'git-refs-'))
    bareDir = join(workDir, 'repo.git')
    mkdirSync(bareDir, { recursive: true })
    git(['init', '--bare', '--initial-branch=main'], bareDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns every ref in the bare repo', async () => {
    const main = sha('main')
    const dev = sha('dev')
    const v1 = sha('v1.0')
    git(['update-ref', 'refs/heads/main', main], bareDir)
    git(['update-ref', 'refs/heads/dev', dev], bareDir)
    git(['update-ref', 'refs/tags/v1.0', v1], bareDir)

    const refs = await readBareRepoRefs(bareDir)
    expect(refs.size).toBe(3)
    expect(refs.get('refs/heads/main')).toBe(main)
    expect(refs.get('refs/heads/dev')).toBe(dev)
    expect(refs.get('refs/tags/v1.0')).toBe(v1)
  })

  it('walks loose refs recursively (refs/heads/foo/bar works)', async () => {
    const deep = sha('deep')
    git(['update-ref', 'refs/heads/feature/deep', deep], bareDir)
    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/feature/deep')).toBe(deep)
  })

  it('reads refs from packed-refs when no loose ref exists', async () => {
    const main = sha('packed-main')
    // Write packed-refs directly with the canonical format.
    const packed = [
      '# pack-refs with: peeled fully-peeled sorted',
      `${main} refs/heads/main`,
      `${sha('packed-dev')} refs/heads/dev`,
      '',
    ].join('\n')
    writeFileSync(join(bareDir, 'packed-refs'), packed)

    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/main')).toBe(main)
    expect(refs.get('refs/heads/dev')).toBe(sha('packed-dev'))
  })

  it('loose refs override packed-refs (per git resolution order)', async () => {
    const packedSha = sha('packed')
    const looseSha = sha('loose')

    // packed-refs first
    writeFileSync(
      join(bareDir, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${packedSha} refs/heads/main\n`,
    )
    // loose ref created afterwards — must win
    git(['update-ref', 'refs/heads/main', looseSha], bareDir)

    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/main')).toBe(looseSha)
  })

  it('skips comments and peeled-tag ^ lines in packed-refs', async () => {
    const main = sha('main')
    const tagObj = sha('tag-obj')
    const peeledCommit = sha('peeled-commit')
    const packed = [
      '# pack-refs with: peeled fully-peeled sorted',
      '# a comment line',
      `${main} refs/heads/main`,
      `${tagObj} refs/tags/v1.0`,
      `^${peeledCommit}`,
      '',
    ].join('\n')
    writeFileSync(join(bareDir, 'packed-refs'), packed)

    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/main')).toBe(main)
    // The peeled ^ line is intentionally skipped — we only return the
    // tag object's SHA, the peeled commit is recoverable on demand.
    expect(refs.get('refs/tags/v1.0')).toBe(tagObj)
  })

  it('returns an empty Map for an empty bare repo', async () => {
    const refs = await readBareRepoRefs(bareDir)
    expect(refs.size).toBe(0)
  })

  it('skips refs/* entries with malformed SHA or refname', async () => {
    const packed = [
      '# pack-refs with: peeled fully-peeled sorted',
      'not-a-sha refs/heads/broken',
      `${'a'.repeat(40)} not/a/valid/refname/at/all`,
      `${'b'.repeat(40)} refs/heads/ok`,
      '',
    ].join('\n')
    writeFileSync(join(bareDir, 'packed-refs'), packed)

    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/ok')).toBe('b'.repeat(40))
    expect(refs.has('refs/heads/broken')).toBe(false)
  })

  it('handles a missing packed-refs file gracefully (loose refs only)', async () => {
    const main = sha('main-only-loose')
    git(['update-ref', 'refs/heads/main', main], bareDir)
    // No packed-refs file written — git deletes it when there are no
    // packed refs; readBareRepoRefs must not throw.
    const refs = await readBareRepoRefs(bareDir)
    expect(refs.get('refs/heads/main')).toBe(main)
  })
})
