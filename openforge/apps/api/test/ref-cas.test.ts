/**
 * CAS contract tests for the smart-HTTP push hot path.
 *
 * Verifies the four guarantees from the Phase 1 spec (memo Risk #2):
 *   1. A successful CAS bumps the row's `version` column.
 *   2. A second CAS with the original expectedVersion fails and reports
 *      the actual (post-first-push) version.
 *   3. Two concurrent CAS attempts serialize on the advisory lock — one
 *      wins, the other observes the bumped version.
 *   4. The advisory lock is xact-scoped: it auto-releases on COMMIT, so
 *      a fresh transaction can re-acquire it without deadlock.
 *
 * Requires DATABASE_URL pointing at a Postgres that has had
 *   pnpm --filter @openforge/db migrate
 * run against it. Tests skip cleanly if the env var is missing so CI can
 * still execute the suite in environments without a DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { acquireRefLock, type Database } from '@openforge/db'
import { repositories } from '@openforge/db'
import { casUpdateRefs, updateRef } from '../src/services/refs.js'

const DATABASE_URL = process.env['DATABASE_URL']

const skip = !DATABASE_URL

const sqlClient = DATABASE_URL
  ? postgres(DATABASE_URL, { max: 4, prepare: false })
  : null

const db: Database | null = sqlClient
  ? drizzle(sqlClient, { logger: false })
  : null

const FIXTURE_OWNER_ID = randomUUID()
const FIXTURE_USER_ID = randomUUID()
const REFS = ['refs/heads/main', 'refs/heads/feature-a', 'refs/tags/v1']

describe.skipIf(skip)('refs CAS hot path', () => {
  let repoId: string

  beforeAll(async () => {
    if (!db || !sqlClient) return
    await sqlClient`
      INSERT INTO users (id, display_name, email)
      VALUES (${FIXTURE_OWNER_ID}, ${'cas-test-owner-' + FIXTURE_OWNER_ID}, ${FIXTURE_OWNER_ID + '@test.local'})
      ON CONFLICT (id) DO NOTHING
    `
    await sqlClient`
      INSERT INTO users (id, display_name, email)
      VALUES (${FIXTURE_USER_ID}, ${'cas-test-actor-' + FIXTURE_USER_ID}, ${FIXTURE_USER_ID + '@test.local'})
      ON CONFLICT (id) DO NOTHING
    `
    const inserted = await db
      .insert(repositories)
      .values({
        ownerType: 'user',
        ownerId: FIXTURE_OWNER_ID,
        name: `cas-test-${randomUUID().slice(0, 8)}`,
        visibility: 'private',
      })
      .returning({ id: repositories.id })
    repoId = inserted[0]!.id

    await sqlClient`DELETE FROM refs WHERE repo_id = ${repoId}::uuid`
  })

  afterAll(async () => {
    if (!sqlClient || !repoId) return
    await sqlClient`DELETE FROM refs WHERE repo_id = ${repoId}::uuid`
    await sqlClient`DELETE FROM repositories WHERE id = ${repoId}::uuid`
    await sqlClient.end({ timeout: 1 })
  })

  it('updates version on successful CAS and reports current version on stale CAS', async () => {
    if (!db) return
    const newSha = 'a'.repeat(40)
    const otherSha = 'b'.repeat(40)

    const ok = await updateRef(db, repoId, REFS[0]!, newSha, 0)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.newVersion).toBe(1)

    const stale = await updateRef(db, repoId, REFS[0]!, otherSha, 0)
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.currentVersion).toBe(1)

    const fresh = await updateRef(db, repoId, REFS[0]!, otherSha, 1)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.newVersion).toBe(2)
  })

  it('serializes concurrent CAS attempts — exactly one wins', async () => {
    if (!db) return
    const refName = REFS[1]!
    const shaA = '1'.repeat(40)
    const shaB = '2'.repeat(40)

    const seed = await updateRef(db, repoId, refName, shaA, 0)
    expect(seed.ok).toBe(true)
    if (!seed.ok) return
    const startingVersion = seed.newVersion

    const [a, b] = await Promise.all([
      updateRef(db, repoId, refName, shaA, startingVersion),
      updateRef(db, repoId, refName, shaB, startingVersion),
    ])

    const winners = [a, b].filter((r) => r.ok)
    const losers = [a, b].filter((r) => !r.ok)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    const loser = losers[0]!
    expect(loser.ok).toBe(false)
    if (!loser.ok) {
      expect(loser.currentVersion).toBe(startingVersion + 1)
    }

    const final = await db.execute<{ sha: string; version: number }>(sql`
      SELECT sha, version FROM refs WHERE repo_id = ${repoId}::uuid AND ref_name = ${refName}
    `)
    expect(final[0]?.version).toBe(startingVersion + 1)
    expect([shaA, shaB]).toContain(final[0]?.sha)
  })

  it('multi-ref CAS is all-or-nothing: one stale entry aborts the whole transaction', async () => {
    if (!db) return
    const tagRef = REFS[2]!
    const freshSha = 'c'.repeat(40)
    const staleSha = 'd'.repeat(40)

    const seed = await updateRef(db, repoId, tagRef, freshSha, 0)
    expect(seed.ok).toBe(true)
    if (!seed.ok) return

    const shaMain = 'e'.repeat(40)
    const shaOther = 'f'.repeat(40)
    const mainBefore = await db.execute<{ version: number }>(sql`
      SELECT version FROM refs WHERE repo_id = ${repoId}::uuid AND ref_name = 'refs/heads/main'
    `)
    const mainVersion = mainBefore[0]?.version ?? 0

    const result = await casUpdateRefs(db, repoId, [
      { refName: 'refs/heads/main', newSha: shaMain, expectedVersion: mainVersion },
      { refName: tagRef, newSha: staleSha, expectedVersion: 999 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflict.refName).toBe(tagRef)
    }

    const mainAfter = await db.execute<{ sha: string }>(sql`
      SELECT sha FROM refs WHERE repo_id = ${repoId}::uuid AND ref_name = 'refs/heads/main'
    `)
    expect(mainAfter[0]?.sha).not.toBe(shaMain)

    const tagAfter = await db.execute<{ sha: string }>(sql`
      SELECT sha FROM refs WHERE repo_id = ${repoId}::uuid AND ref_name = ${tagRef}
    `)
    expect(tagAfter[0]?.sha).toBe(freshSha)
  })

  it('xact-scoped advisory lock auto-releases on COMMIT (no deadlock on re-acquire)', async () => {
    if (!db) return
    const refName = REFS[0]!
    const held = await db.transaction(async (tx) => {
      const ok = await acquireRefLock(tx, repoId, refName)
      return ok
    })
    expect(held).toBe(true)

    const reacquired = await db.transaction(async (tx) => {
      return acquireRefLock(tx, repoId, refName)
    })
    expect(reacquired).toBe(true)
  })
})
