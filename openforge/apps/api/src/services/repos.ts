import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@openforge/db'
import {
  auditLog,
  repositories,
  users,
  type Repository,
  type NewRepository,
} from '@openforge/db'
import { r2Client, PRIMARY_BUCKET } from '@openforge/s3'
import { logger } from '../lib/logger.js'
import { grantPermission } from './permissions.js'
import type { Role } from '../types.js'

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/var/lib/openforge/repos'
const GIT_BIN = process.env['GIT_BINARY_PATH'] ?? 'git'
const S3_KEY_PREFIX = 'repos'

export type OwnerRef = { type: 'user' | 'org'; id: string; displayName?: string }

export interface CreateRepoInput {
  name: string
  visibility?: 'public' | 'private' | 'internal'
  defaultBranch?: string
  description?: string
}

export interface ListReposOptions {
  ownerId?: string
  ownerType?: 'user' | 'org'
  visibility?: 'public' | 'private' | 'internal'
  limit?: number
  cursor?: string
  includeDeleted?: boolean
}

export interface UpdateRepoPatch {
  visibility?: 'public' | 'private' | 'internal'
  defaultBranch?: string
}

function ownerDisplayName(owner: OwnerRef): string {
  return owner.displayName ?? owner.id
}

function bareRepoDir(owner: OwnerRef, slug: string): string {
  return path.join(REPO_ROOT, ownerDisplayName(owner), `${slug}.git`)
}

async function ensureOwnerDir(owner: OwnerRef): Promise<void> {
  await mkdir(path.join(REPO_ROOT, ownerDisplayName(owner)), { recursive: true })
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(GIT_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`))
    })
  })
}

async function ensureS3Prefix(owner: OwnerRef, slug: string): Promise<void> {
  const key = `${S3_KEY_PREFIX}/${ownerDisplayName(owner)}/${slug}/.keep`
  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: PRIMARY_BUCKET,
        Key: key,
        Body: '',
        ContentLength: 0,
      }),
    )
  } catch (err) {
    // S3 prefix creation is best-effort during Phase 1; the actual packfile
    // uploads happen on first push. Log and continue so dev still works
    // without R2 credentials.
    logger.warn({ err, key }, '[repos] S3 prefix placeholder failed (non-fatal)')
  }
}

async function writeAudit(
  actorUserId: string | null,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
  actorIp?: string,
): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId,
    actorIp: actorIp ?? null,
    action,
    targetType: 'repo',
    targetId,
    metadata: metadata as never,
  })
}

export async function createRepo(
  owner: OwnerRef,
  input: CreateRepoInput,
  actorUserId: string,
  actorIp?: string,
): Promise<Repository> {
  if (input.name.length === 0 || input.name.length > 100) {
    throw new RepoError('invalid_name', 'name must be 1-100 chars', 400)
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(input.name)) {
    throw new RepoError('invalid_name', 'name must match [a-zA-Z0-9._-]+', 400)
  }

  const visibility = input.visibility ?? 'private'
  const defaultBranch = input.defaultBranch ?? 'main'

  // Ensure owner directory + insert DB row first so the unique index
  // surfaces name collisions as a typed error instead of a git ENOENT.
  await ensureOwnerDir(owner)

  let row: Repository
  try {
    const inserted = await db
      .insert(repositories)
      .values({
        ownerType: owner.type,
        ownerId: owner.id,
        name: input.name,
        visibility,
        defaultBranch,
      } satisfies NewRepository)
      .returning()
    row = inserted[0]!
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new RepoError('already_exists', 'repository name already in use', 409)
    }
    throw err
  }

  const repoDir = bareRepoDir(owner, input.name)
  try {
    await runGit(['init', '--bare', repoDir])
    await runGit(['config', 'receive.denyCurrentBranch', 'ignore'], repoDir)
  } catch (err) {
    // Roll back the DB row so we don't end up with metadata for a missing repo.
    await db.delete(repositories).where(eq(repositories.id, row.id))
    throw err
  }

  await ensureS3Prefix(owner, input.name)
  await grantPermission(row.id, owner.id, 'owner', 'direct', null)
  await writeAudit(actorUserId, 'repo.create', row.id, {
    name: input.name,
    visibility,
    ownerType: owner.type,
    ownerId: owner.id,
  }, actorIp)

  return row
}

export async function getRepo(
  owner: OwnerRef,
  slug: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Repository | null> {
  const conds = [
    eq(repositories.ownerType, owner.type),
    eq(repositories.ownerId, owner.id),
    eq(repositories.name, slug),
  ]
  if (!opts.includeDeleted) conds.push(isNull(repositories.deletedAt))
  const rows = await db
    .select()
    .from(repositories)
    .where(and(...conds))
    .limit(1)
  return rows[0] ?? null
}

export async function getRepoByDisplayName(
  ownerDisplay: string,
  slug: string,
): Promise<Repository | null> {
  // Phase 1 keeps 'org' as a users row; both owner types resolve via the users
  // table for now. Future orgs table will add a UNION.
  const rows = await db
    .select({ repo: repositories, ownerId: users.id })
    .from(repositories)
    .innerJoin(users, eq(users.id, repositories.ownerId))
    .where(
      and(
        eq(repositories.ownerType, 'user'),
        eq(users.displayName, ownerDisplay),
        eq(repositories.name, slug),
        isNull(repositories.deletedAt),
      ),
    )
    .limit(1)
  return rows[0]?.repo ?? null
}

export async function listRepos(
  userId: string,
  opts: ListReposOptions = {},
): Promise<Repository[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const conds: ReturnType<typeof eq>[] = []
  if (opts.ownerId) conds.push(eq(repositories.ownerId, opts.ownerId))
  if (opts.ownerType) conds.push(eq(repositories.ownerType, opts.ownerType))
  if (opts.visibility) conds.push(eq(repositories.visibility, opts.visibility))
  if (!opts.includeDeleted) conds.push(isNull(repositories.deletedAt))

  // Visibility-aware filter: public repos are visible to everyone; private
  // / internal are visible only if the user has a permissions row.
  const condsWithAccess = [
    ...conds,
    sql`(
      ${repositories.visibility} = 'public'
      OR ${repositories.visibility} = 'internal'
      OR ${repositories.ownerId} = ${userId}
      OR EXISTS (
        SELECT 1 FROM ${sql.identifier('permissions')} p
        WHERE p.repo_id = ${repositories.id} AND p.user_id = ${userId}
      )
    )`,
  ]

  const order = opts.cursor === 'next' ? asc(repositories.createdAt) : desc(repositories.createdAt)

  return db
    .select()
    .from(repositories)
    .where(and(...condsWithAccess))
    .orderBy(order)
    .limit(limit)
}

export async function updateRepo(
  owner: OwnerRef,
  slug: string,
  patch: UpdateRepoPatch,
  actorUserId: string,
  actorIp?: string,
): Promise<Repository> {
  const existing = await getRepo(owner, slug)
  if (!existing) throw new RepoError('not_found', 'repository not found', 404)

  const update: Partial<NewRepository> = {}
  if (patch.visibility) update.visibility = patch.visibility
  if (patch.defaultBranch) update.defaultBranch = patch.defaultBranch

  let updated: Repository
  try {
    const rows = await db
      .update(repositories)
      .set(update)
      .where(eq(repositories.id, existing.id))
      .returning()
    updated = rows[0]!
  } catch (err) {
    throw err
  }

  await writeAudit(actorUserId, 'repo.update', existing.id, {
    before: {
      visibility: existing.visibility,
      defaultBranch: existing.defaultBranch,
    },
    after: {
      visibility: updated.visibility,
      defaultBranch: updated.defaultBranch,
    },
  }, actorIp)

  return updated
}

export async function softDeleteRepo(
  owner: OwnerRef,
  slug: string,
  actorUserId: string,
  actorIp?: string,
): Promise<void> {
  const existing = await getRepo(owner, slug)
  if (!existing) throw new RepoError('not_found', 'repository not found', 404)

  await db
    .update(repositories)
    .set({ deletedAt: new Date() })
    .where(eq(repositories.id, existing.id))

  await writeAudit(actorUserId, 'repo.delete', existing.id, {
    name: existing.name,
    ownerType: existing.ownerType,
    ownerId: existing.ownerId,
  }, actorIp)
}

export async function forkRepo(
  sourceRepo: Repository,
  forker: OwnerRef,
  newName: string,
  actorUserId: string,
  actorIp?: string,
): Promise<Repository> {
  if (newName.length === 0 || newName.length > 100) {
    throw new RepoError('invalid_name', 'name must be 1-100 chars', 400)
  }

  await ensureOwnerDir(forker)

  const forkRow = await db
    .insert(repositories)
    .values({
      ownerType: forker.type,
      ownerId: forker.id,
      name: newName,
      visibility: sourceRepo.visibility === 'public' ? 'private' : sourceRepo.visibility,
      defaultBranch: sourceRepo.defaultBranch,
      forkedFromId: sourceRepo.id,
    } satisfies NewRepository)
    .returning()
    .catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new RepoError('already_exists', 'repository name already in use', 409)
      }
      throw err
    })
  const fork = forkRow[0]!

  const forkDir = bareRepoDir(forker, newName)
  const sourceDir = path.join(REPO_ROOT, await resolveSourceOwner(sourceRepo), `${sourceRepo.name}.git`)

  try {
    // Cross-disk safe clone — git copies all objects, then we redirect
    // the fork's objects dir to alternates pointing at the source's
    // objects dir so disk usage is shared. We strip the cloned objects
    // so alternates becomes the source of truth.
    await runGit(['clone', '--bare', '--no-local', '--no-hardlinks', sourceDir, forkDir])
    await rm(path.join(forkDir, 'objects'), { recursive: true, force: true })
    await mkdir(path.join(forkDir, 'objects', 'info'), { recursive: true })
    const relativeAlt = path.relative(
      path.join(forkDir, 'objects'),
      path.join(sourceDir, 'objects'),
    )
    await writeFile(path.join(forkDir, 'objects', 'info', 'alternates'), `${relativeAlt}\n`)
    await runGit(['config', 'receive.denyCurrentBranch', 'ignore'], forkDir)
    await runGit(['update-server-info'], forkDir)
  } catch (err) {
    await db.delete(repositories).where(eq(repositories.id, fork.id))
    throw err
  }

  await ensureS3Prefix(forker, newName)
  await grantPermission(fork.id, forker.id, 'owner', 'direct', null)
  await writeAudit(actorUserId, 'repo.fork', fork.id, {
    sourceRepoId: sourceRepo.id,
    name: newName,
    ownerType: forker.type,
    ownerId: forker.id,
  }, actorIp)

  return fork
}

async function resolveSourceOwner(repo: Repository): Promise<string> {
  if (repo.ownerType === 'user') {
    const row = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, repo.ownerId))
      .limit(1)
    return row[0]?.displayName ?? repo.ownerId
  }
  // Phase 1: org owners are users rows; future orgs table needs its own lookup.
  const row = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, repo.ownerId))
    .limit(1)
  return row[0]?.displayName ?? repo.ownerId
}

export class RepoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'RepoError'
  }
}

// Touch stat to keep it import-clean (used in tests / future GC).
export const __repoInternals = { stat }
