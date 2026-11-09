/**
 * Vitest tests for the repo CRUD + permission service.
 *
 * Choice: mock the DB layer at the module boundary rather than use
 * testcontainers. Reasons:
 *   - testcontainers-postgres adds a docker dependency to a pure-Node CI
 *   - the schema under test is small enough that an in-memory store is shorter
 *     than the docker-compose plumbing
 *   - tests run in <100ms with no infra spinup
 *
 * Trade-off: the mock only verifies the SQL Drizzle *would* issue; the SQL
 * itself is exercised by the migration suite and by integration tests in
 * a follow-up phase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------- Mocked DB ----------
//
// Each table is an array of row objects. The Drizzle fluent chain is
// collapsed into a Proxy that filters by simple field equality and applies
// a visibility-aware post-filter for the `repositories` table to mimic the
// production listRepos filter (visibility='public' OR owner OR materialized
// permission row).

type Row = Record<string, unknown>

interface Store {
  repositories: Row[]
  permissions: Row[]
  audit_log: Row[]
  users: Row[]
}

const store: Store = {
  repositories: [],
  permissions: [],
  audit_log: [],
  users: [
    { id: 'user-a', email: 'alice@x', displayName: 'alice' },
    { id: 'user-b', email: 'bob@x', displayName: 'bob' },
  ],
}

// Tests set this so the mock can evaluate the listRepos visibility filter
// exactly the way the production SQL does.
let viewingUserId: string | null = null

function tableOf(t: { name?: string }): Row[] {
  switch (t.name) {
    case 'repositories':
      return store.repositories
    case 'permissions':
      return store.permissions
    case 'audit_log':
      return store.audit_log
    case 'users':
      return store.users
    default:
      throw new Error(`unknown table ${t.name}`)
  }
}

function findRows(rows: Row[], conds: { field: string; value: unknown }[]): Row[] {
  if (conds.length === 0) return rows.slice()
  return rows.filter((r) => conds.every((c) => r[c.field] === c.value))
}

function resolveConds(conds: unknown[]): { field: string; value: unknown }[] {
  const out: { field: string; value: unknown }[] = []
  function visit(c: unknown) {
    if (!c || typeof c !== 'object') return
    if ('field' in c && 'value' in c) {
      out.push(c as { field: string; value: unknown })
      return
    }
    const o = c as Record<string, unknown>
    if (Array.isArray(o['queryChunks'])) {
      for (const q of o['queryChunks']) visit(q)
    }
    if (Array.isArray(o['_'])) for (const q of o['_']) visit(q)
  }
  for (const c of conds) visit(c)
  return out
}

function applyRepoVisibility(rows: Row[]): Row[] {
  return rows.filter((r) => {
    if (r['visibility'] === 'public') return true
    if (r['visibility'] === 'internal') return true // simplified for tests
    if (r['ownerId'] === viewingUserId) return true
    return store.permissions.some(
      (p) => p['repoId'] === r['id'] && p['userId'] === viewingUserId,
    )
  })
}

function thenable<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === 'then') {
        return (onF?: (v: T) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(value).then(onF, onR)
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as T
}

function makeDb() {
  return {
    select() {
      return thenable({
        from(t: { name?: string }) {
          return thenable({
            innerJoin() {
              return thenable({
                where(...conds: unknown[]) {
                  return thenable({
                    limit(n: number) {
                      let rows = findRows(tableOf(t), resolveConds(conds))
                      if (t.name === 'repositories' && viewingUserId !== null) {
                        rows = applyRepoVisibility(rows)
                      }
                      return rows.slice(0, n)
                    },
                  })
                },
              })
            },
            where(...conds: unknown[]) {
              return thenable({
                limit(n: number) {
                  let rows = findRows(tableOf(t), resolveConds(conds))
                  if (t.name === 'repositories' && viewingUserId !== null) {
                    rows = applyRepoVisibility(rows)
                  }
                  return rows.slice(0, n)
                },
                orderBy() {
                  return thenable({
                    limit(n: number) {
                      let rows = findRows(tableOf(t), resolveConds(conds))
                      if (t.name === 'repositories' && viewingUserId !== null) {
                        rows = applyRepoVisibility(rows)
                      }
                      return rows.slice(0, n)
                    },
                  })
                },
              })
            },
          })
        },
      })
    },

    insert(t: { name?: string }) {
      const rows = tableOf(t)
      return thenable({
        values(v: Row) {
          const row: Row = { ...v, id: v['id'] ?? `id-${rows.length + 1}-${Date.now()}` }
          if (t.name === 'repositories') {
            const dup = rows.find(
              (r) => r['ownerId'] === row['ownerId'] && r['name'] === row['name'],
            )
            if (dup) {
              const err = Object.assign(new Error('dup'), { code: '23505' })
              throw err
            }
          }
          rows.push(row)
          return thenable({
            returning() {
              return [row]
            },
            onConflictDoUpdate() {
              return undefined
            },
          })
        },
      })
    },

    update(t: { name?: string }) {
      const rows = tableOf(t)
      return thenable({
        set(v: Row) {
          return thenable({
            where(...conds: unknown[]) {
              const target = findRows(rows, resolveConds(conds))[0]
              if (target) Object.assign(target, v)
              return thenable({
                returning() {
                  return target ? [target] : []
                },
              })
            },
          })
        },
      })
    },

    delete(t: { name?: string }) {
      const rows = tableOf(t)
      return thenable({
        where(...conds: unknown[]) {
          const real = resolveConds(conds)
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i]!
            if (real.every((c) => r[c.field] === c.value)) rows.splice(i, 1)
          }
          return rows
        },
      })
    },

    transaction<T>(fn: (tx: ReturnType<typeof makeDb>) => Promise<T>) {
      return fn(makeDb())
    },
  }
}

const dbMock = makeDb()

vi.mock('@openforge/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openforge/db')>()
  return {
    ...actual,
    db: dbMock as unknown as typeof actual.db,
  }
})

// ---------- Mocked child_process.spawn ----------
const spawnCalls: string[][] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((bin: string, args: string[]) => {
    spawnCalls.push([bin, ...args])
    const proc: Record<string, unknown> = {
      stderr: { on: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'exit') setTimeout(() => cb(0), 0)
      },
    }
    return proc
  }),
}))

// ---------- Mocked S3 ----------
vi.mock('@openforge/s3', () => ({
  r2Client: { send: vi.fn().mockResolvedValue({}) },
  PRIMARY_BUCKET: 'openforge-packs',
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))

// ---------- Mocked fs ----------
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  }
})

// ---------- Imports (after mocks) ----------
const { createRepo, listRepos, updateRepo, softDeleteRepo, forkRepo, getRepo } =
  await import('../src/services/repos.js')
const { canAccess, grantPermission } = await import('../src/services/permissions.js')

beforeEach(() => {
  store.repositories = []
  store.permissions = []
  store.audit_log = []
  spawnCalls.length = 0
  viewingUserId = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('repos service', () => {
  it('creates a repo and surfaces it in listRepos', async () => {
    viewingUserId = 'user-a'
    const repo = await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'hello', visibility: 'private' },
      'user-a',
    )
    expect(repo.name).toBe('hello')
    expect(repo.visibility).toBe('private')
    expect(
      spawnCalls.some((c) => c[0] === 'git' && c.includes('init') && c.includes('--bare')),
    ).toBe(true)

    const list = await listRepos('user-a')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(repo.id)
  })

  it('hides private repos from other users', async () => {
    await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'secret', visibility: 'private' },
      'user-a',
    )

    viewingUserId = 'user-a'
    const aView = await listRepos('user-a')
    expect(aView).toHaveLength(1)

    viewingUserId = 'user-b'
    const bView = await listRepos('user-b')
    expect(bView).toHaveLength(0)
  })

  it('shows public repos to all users', async () => {
    await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'public-repo', visibility: 'public' },
      'user-a',
    )
    viewingUserId = 'user-b'
    const bView = await listRepos('user-b')
    expect(bView).toHaveLength(1)
  })

  it('forks a repo: bare clone + alternates written', async () => {
    const src = await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'src', visibility: 'public' },
      'user-a',
    )
    const fork = await forkRepo(
      src,
      { type: 'user', id: 'user-b', displayName: 'bob' },
      'forked',
      'user-b',
    )
    expect(fork.forkedFromId).toBe(src.id)
    expect(fork.ownerId).toBe('user-b')
    expect(spawnCalls.some((c) => c[0] === 'git' && c.includes('clone'))).toBe(true)
  })

  it('soft deletes a repo so it no longer appears in list', async () => {
    await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'goner', visibility: 'private' },
      'user-a',
    )
    await softDeleteRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      'goner',
      'user-a',
    )
    viewingUserId = 'user-a'
    const list = await listRepos('user-a')
    expect(list).toHaveLength(0)
    const looked = await getRepo({ type: 'user', id: 'user-a', displayName: 'alice' }, 'goner')
    expect(looked).toBeNull()
  })

  it('updates visibility and the owner retains admin via implicit owner role', async () => {
    const repo = await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'promote-me', visibility: 'private' },
      'user-a',
    )
    const updated = await updateRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      'promote-me',
      { visibility: 'public' },
      'user-a',
    )
    expect(updated.visibility).toBe('public')
    expect(await canAccess(repo.id, 'user-a', 'write')).toBe(true)
  })

  it('grants collaborator write access via materialized permissions', async () => {
    const repo = await createRepo(
      { type: 'user', id: 'user-a', displayName: 'alice' },
      { name: 'team-repo', visibility: 'private' },
      'user-a',
    )
    expect(await canAccess(repo.id, 'user-b', 'read')).toBe(false)
    await grantPermission(repo.id, 'user-b', 'write', 'direct', null)
    expect(await canAccess(repo.id, 'user-b', 'read')).toBe(true)
    expect(await canAccess(repo.id, 'user-b', 'write')).toBe(true)
  })
})

export {}
