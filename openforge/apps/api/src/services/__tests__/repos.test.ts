import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('drizzle-orm', () => {
  return {
    eq: (column: { name: string }, value: unknown) => ({
      __op: 'eq',
      column,
      value,
    }),
    and: (...clauses: unknown[]) => ({ __op: 'and', clauses }),
    or: (...clauses: unknown[]) => ({ __op: 'or', clauses }),
    isNull: (column: { name: string }) => ({ __op: 'isNull', column }),
    asc: (column: { name: string }) => ({ __op: 'asc', column }),
    desc: (column: { name: string }) => ({ __op: 'desc', column }),
    inArray: (column: { name: string }, list: unknown[]) => ({
      __op: 'inArray',
      column,
      list,
    }),
    sql: (() => {
      const tag = (strings: TemplateStringsArray, ...params: unknown[]) => ({
        __op: 'sql',
        query: { sql: strings.join('?'), params },
      });
      return tag;
    })(),
  };
});

vi.mock('@openforge/s3', () => ({
  r2Client: { send: vi.fn().mockResolvedValue({}) },
  PRIMARY_BUCKET: 'test-bucket',
  S3_DR_BUCKET: 'test-bucket-dr',
  s3DrClient: { send: vi.fn().mockResolvedValue({}) },
  objectKey: {
    packfile: (org: string, repo: string, sha: string) =>
      `repos/${org}/${repo}/objects/pack/${sha}.pack`,
    idx: (org: string, repo: string, sha: string) =>
      `repos/${org}/${repo}/objects/pack/${sha}.idx`,
    midx: (org: string, repo: string) =>
      `repos/${org}/${repo}/objects/pack/multi-pack-index`,
    lfs: () => '',
    webhookPayload: () => '',
    jobLog: () => '',
  },
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  presignPutDr: vi.fn(),
  presignGetDr: vi.fn(),
  replicateToDr: vi.fn(),
}));

vi.mock('../permissions.js', () => ({
  grantPermission: vi.fn().mockResolvedValue(undefined),
  revokePermission: vi.fn().mockResolvedValue(undefined),
  canAccess: vi.fn().mockResolvedValue(false),
  materializeOrgPermissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

type TableName = 'repositories' | 'users' | 'audit_log' | 'permissions';

interface RepoRow {
  id: string;
  ownerId: string;
  ownerType: 'user' | 'org';
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  sizeBytes: number;
  objectCount: number;
  lfsSizeBytes: number;
  forkedFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface UserRow {
  id: string;
  displayName: string;
}

interface AuditRow {
  actorUserId: string;
  actorIp: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const state = {
  users: [
    { id: 'user-alice', displayName: 'alice' },
    { id: 'user-bob', displayName: 'bob' },
  ] as UserRow[],
  repos: [] as RepoRow[],
  audit: [] as AuditRow[],
  nextRepoId: 1,
};

interface Predicate {
  __op?: string;
  column?: { name: string };
  value?: unknown;
  clauses?: Predicate[];
  list?: unknown[];
  query?: { sql: string; params: unknown[] };
}

function matchPredicate(row: Record<string, unknown>, predicate: Predicate | undefined): boolean {
  if (!predicate || typeof predicate !== 'object') return true;
  switch (predicate.__op) {
    case 'eq':
      return row[predicate.column!.name] === predicate.value;
    case 'and':
      return (predicate.clauses ?? []).every((c) => matchPredicate(row, c));
    case 'or':
      return (predicate.clauses ?? []).some((c) => matchPredicate(row, c));
    case 'isNull':
      return row[predicate.column!.name] == null;
    case 'inArray':
      return (predicate.list ?? []).includes(row[predicate.column!.name]);
    case 'asc':
    case 'desc':
    case 'sql':
      return true;
    default:
      return true;
  }
}

class FakeQuery {
  private whereFilters: Predicate[] = [];
  private orderDir: Predicate | null = null;
  private limitN: number | null = null;
  private insertValues: Record<string, unknown> | undefined;
  private updateSet: Record<string, unknown> | undefined;
  private readonly tableName: TableName;

  constructor(tableName: TableName) {
    this.tableName = tableName;
  }

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(predicate: Predicate): this {
    this.whereFilters.push(predicate);
    return this;
  }

  orderBy(dir: Predicate): this {
    this.orderDir = dir;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  values(vals: Record<string, unknown>): this {
    this.insertValues = vals;
    return this;
  }

  set(vals: Record<string, unknown>): this {
    this.updateSet = vals;
    return this;
  }

  returning(): Promise<RepoRow[]> {
    return Promise.resolve(this.execute());
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onFulfilled?: (value: unknown[]) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute() as unknown[]).then(onFulfilled, onRejected);
  }

  private execute(): RepoRow[] {
    if (this.insertValues !== undefined) {
      return this.handleInsert();
    }
    if (this.updateSet !== undefined) {
      return this.handleUpdate();
    }
    return this.handleSelect();
  }

  private handleInsert(): RepoRow[] {
    if (this.tableName === 'repositories') {
      const vals = this.insertValues!;
      const dupe = state.repos.find(
        (r) =>
          r.ownerType === vals['ownerType'] &&
          r.ownerId === vals['ownerId'] &&
          r.name === vals['name'] &&
          r.deletedAt === null,
      );
      if (dupe) {
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code?: string;
        };
        err.code = '23505';
        throw err;
      }
      const row: RepoRow = {
        id: `repo-${state.nextRepoId++}`,
        ownerType: (vals['ownerType'] as 'user' | 'org') ?? 'user',
        ownerId: (vals['ownerId'] as string) ?? '',
        name: (vals['name'] as string) ?? '',
        defaultBranch: (vals['defaultBranch'] as string) ?? 'main',
        visibility: (vals['visibility'] as 'public' | 'private' | 'internal') ?? 'private',
        sizeBytes: 0,
        objectCount: 0,
        lfsSizeBytes: 0,
        forkedFromId: (vals['forkedFromId'] as string | null) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: (vals['deletedAt'] as Date | null) ?? null,
      };
      state.repos.push(row);
      return [row];
    }
    if (this.tableName === 'audit_log') {
      state.audit.push({
        actorUserId: (this.insertValues!['actorUserId'] as string | null) ?? '00000000-0000-0000-0000-000000000000',
        actorIp: (this.insertValues!['actorIp'] as string | null) ?? null,
        action: (this.insertValues!['action'] as string) ?? '',
        targetType: (this.insertValues!['targetType'] as string) ?? '',
        targetId: (this.insertValues!['targetId'] as string) ?? '',
        metadata: (this.insertValues!['metadata'] as Record<string, unknown>) ?? {},
        createdAt: new Date(),
      });
      return [];
    }
    return [];
  }

  private handleUpdate(): RepoRow[] {
    const updated: RepoRow[] = [];
    for (const row of state.repos) {
      if (this.whereFilters.every((p) => matchPredicate(row as unknown as Record<string, unknown>, p))) {
        Object.assign(row, this.updateSet);
        updated.push(row);
      }
    }
    return updated;
  }

  private handleSelect(): RepoRow[] {
    let rows: RepoRow[] = [];
    if (this.tableName === 'repositories') rows = state.repos;
    rows = rows.filter((r) =>
      this.whereFilters.every((p) => matchPredicate(r as unknown as Record<string, unknown>, p)),
    );
    if (this.orderDir !== null) {
      rows.sort((a, b) => {
        const av = a.createdAt.getTime();
        const bv = b.createdAt.getTime();
        return this.orderDir!.__op === 'asc' ? av - bv : bv - av;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }
}

vi.mock('@openforge/db', () => ({
  db: {
    select: (_cols?: unknown) => new FakeQuery('repositories'),
    insert: (table: { __table?: TableName }) =>
      new FakeQuery(table.__table ?? 'repositories'),
    update: (table: { __table?: TableName }) =>
      new FakeQuery(table.__table ?? 'repositories'),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  },
  auditLog: { __table: 'audit_log' },
  repositories: { __table: 'repositories' },
  users: { __table: 'users' },
  permissions: { __table: 'permissions' },
}));

const services = await import('../repos.js');
const {
  createRepo,
  softDeleteRepo,
  forkRepo,
  getRepo,
  listRepos,
  updateRepo,
  RepoError,
} = services;
const permissionsModule = await import('../permissions.js');

let tempRoot: string;
let originalRepoRoot: string | undefined;
let originalGitBin: string | undefined;

beforeEach(async () => {
  state.repos = [];
  state.audit = [];
  state.nextRepoId = 1;
  vi.clearAllMocks();

  tempRoot = await mkdtemp(path.join(tmpdir(), 'openforge-repos-test-'));
  originalRepoRoot = process.env['REPO_ROOT'];
  originalGitBin = process.env['GIT_BINARY_PATH'];
  process.env['REPO_ROOT'] = tempRoot;
});

afterEach(async () => {
  if (originalRepoRoot === undefined) delete process.env['REPO_ROOT'];
  else process.env['REPO_ROOT'] = originalRepoRoot;
  if (originalGitBin === undefined) delete process.env['GIT_BINARY_PATH'];
  else process.env['GIT_BINARY_PATH'] = originalGitBin;
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
});

const alice = { type: 'user' as const, id: 'user-alice', displayName: 'alice' };
const bob = { type: 'user' as const, id: 'user-bob', displayName: 'bob' };

describe('repos service', () => {
  it('createRepo persists metadata, creates a bare dir on disk, and grants the owner permission', async () => {
    const row = await createRepo(
      alice,
      { name: 'hello-world', visibility: 'public' },
      'user-alice',
    );

    expect(row.id).toMatch(/^repo-\d+$/);
    expect(row.name).toBe('hello-world');
    expect(row.ownerId).toBe('user-alice');
    expect(row.visibility).toBe('public');
    expect(row.defaultBranch).toBe('main');
    expect(row.forkedFromId).toBeNull();

    const barePath = path.join(tempRoot, 'alice', 'hello-world.git');
    const s = await stat(barePath);
    expect(s.isDirectory()).toBe(true);
    const config = await readFile(path.join(barePath, 'config'), 'utf8');
    expect(config).toMatch(/receive\.denyCurrentBranch\s*=\s*ignore/);

    expect(permissionsModule.grantPermission).toHaveBeenCalledWith(
      row.id,
      'user-alice',
      'owner',
      'direct',
      null,
    );

    expect(state.audit.find((a) => a.action === 'repo.create')).toBeDefined();

    const fetched = await getRepo(alice, 'hello-world');
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(row.id);
  });

  it('softDeleteRepo sets deleted_at, leaves bare dir on disk, and writes audit', async () => {
    const row = await createRepo(
      alice,
      { name: 'doomed', visibility: 'private' },
      'user-alice',
    );
    const barePath = path.join(tempRoot, 'alice', 'doomed.git');

    await softDeleteRepo(alice, 'doomed', 'user-alice');

    const updated = state.repos.find((r) => r.id === row.id);
    expect(updated).toBeDefined();
    expect(updated!.deletedAt).toBeInstanceOf(Date);

    // Bare directory intentionally left on disk for Phase 2's sweeper.
    const s = await stat(barePath);
    expect(s.isDirectory()).toBe(true);

    expect(state.audit.find((a) => a.action === 'repo.delete')).toBeDefined();

    const afterDelete = await getRepo(alice, 'doomed');
    expect(afterDelete).toBeNull();
  });

  it('forkRepo writes the alternates file and records forked_from_id', async () => {
    const source = await createRepo(
      alice,
      { name: 'parent', visibility: 'public' },
      'user-alice',
    );
    const sourceBarePath = path.join(tempRoot, 'alice', 'parent.git');

    const fork = await forkRepo(
      source,
      bob,
      'parent',
      'user-bob',
      '127.0.0.1',
    );

    expect(fork.id).not.toBe(source.id);
    expect(fork.ownerId).toBe('user-bob');
    expect(fork.forkedFromId).toBe(source.id);
    // Public source forks into private (matches the implementation's policy).
    expect(fork.visibility).toBe('private');

    const forkBarePath = path.join(tempRoot, 'bob', 'parent.git');
    const alternatesPath = path.join(forkBarePath, 'objects', 'info', 'alternates');
    const statResult = await stat(alternatesPath);
    expect(statResult.isFile()).toBe(true);

    const raw = await readFile(alternatesPath, 'utf8');
    const expectedRel = path.relative(
      path.join(forkBarePath, 'objects'),
      path.join(sourceBarePath, 'objects'),
    );
    expect(raw.replace(/\n$/, '')).toBe(expectedRel);

    expect(permissionsModule.grantPermission).toHaveBeenCalledWith(
      fork.id,
      'user-bob',
      'owner',
      'direct',
      null,
    );

    expect(state.audit.find((a) => a.action === 'repo.fork')).toBeDefined();
  });

  it('rejects names outside /^[a-zA-Z0-9._-]+$/ with RepoError 400', async () => {
    await expect(
      createRepo(alice, { name: 'has spaces' }, 'user-alice'),
    ).rejects.toMatchObject({ code: 'invalid_name', status: 400 });

    await expect(
      createRepo(alice, { name: 'with/slash' }, 'user-alice'),
    ).rejects.toMatchObject({ code: 'invalid_name', status: 400 });

    await expect(
      createRepo(alice, { name: '' }, 'user-alice'),
    ).rejects.toMatchObject({ code: 'invalid_name', status: 400 });

    await expect(
      createRepo(alice, { name: 'a'.repeat(101) }, 'user-alice'),
    ).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
  });

  it('throws RepoError already_exists (409) when the same (owner, name) already exists', async () => {
    await createRepo(alice, { name: 'taken', visibility: 'public' }, 'user-alice');

    await expect(
      createRepo(alice, { name: 'taken', visibility: 'public' }, 'user-alice'),
    ).rejects.toMatchObject({ code: 'already_exists', status: 409 });

    const bobCopy = await createRepo(
      bob,
      { name: 'taken', visibility: 'private' },
      'user-bob',
    );
    expect(bobCopy.name).toBe('taken');
    expect(bobCopy.ownerId).toBe('user-bob');
  });

  it('updateRepo applies visibility + defaultBranch changes and writes audit', async () => {
    await createRepo(
      alice,
      { name: 'tweakable', visibility: 'private', defaultBranch: 'main' },
      'user-alice',
    );

    const updated = await updateRepo(
      alice,
      'tweakable',
      { visibility: 'public', defaultBranch: 'trunk' },
      'user-alice',
    );

    expect(updated.visibility).toBe('public');
    expect(updated.defaultBranch).toBe('trunk');

    expect(state.audit.find((a) => a.action === 'repo.update')).toBeDefined();
  });

  it('listRepos returns the calling user\'s repos (visibility-aware)', async () => {
    await createRepo(alice, { name: 'alice-public', visibility: 'public' }, 'user-alice');
    await createRepo(alice, { name: 'alice-private', visibility: 'private' }, 'user-alice');
    await createRepo(bob, { name: 'bob-public', visibility: 'public' }, 'user-bob');

    const aliceRepos = await listRepos('user-alice');
    const names = aliceRepos.map((r) => r.name).sort();
    expect(names).toEqual(
      expect.arrayContaining(['alice-public', 'alice-private']),
    );
    expect(aliceRepos.length).toBeGreaterThanOrEqual(2);
  });

  it('RepoError carries code, message, and status for the route layer', () => {
    const e = new RepoError('invalid_name', 'bad', 400);
    expect(e.code).toBe('invalid_name');
    expect(e.message).toBe('bad');
    expect(e.status).toBe(400);
    expect(e.name).toBe('RepoError');
    expect(e).toBeInstanceOf(Error);
  });
});
