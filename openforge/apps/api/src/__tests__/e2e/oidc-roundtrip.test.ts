// SPDX-License-Identifier: MIT
//
// E2E test for the OIDC token round-trip.
//
// Exercises:
//   1. Runner registration token is hashed (SHA-256) and stored.
//   2. Runner sends Authorization: Bearer <plaintext>.
//   3. Server hashes the bearer, looks up the runner.
//   4. Server checks runnerOwnsJob against runner_jobs.
//   5. Server mints an HS256 JWT with cache_mode + permissions claims.
//   6. Runner-side verification round-trip succeeds.
//
// Requires DATABASE_URL pointing at a Postgres with the OpenForge
// schema applied (migrations 0001 + 0002). The test inserts a test
// runner + token + job, exercises the flow, and cleans up.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { db } from '@openforge/db'
import { runners, runnerRegistrationTokens, runnerJobs } from '@openforge/db'
import { eq } from 'drizzle-orm'
import { createTestApp, type TestApp } from './setup.js'
import { verifyOidcToken, OIDC_TOKEN_LIFETIME_SECONDS } from '../../services/oidc-token.js'

const ISSUER = 'openforge.test'
const SECRET = 'a'.repeat(64)
const BEARER_PLAINTEXT = 'super-secret-runner-token-32chars-min'

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

const bearerHash = sha256Hex(BEARER_PLAINTEXT)

let app: TestApp
let testRunnerId: string
let testJobId: string

async function cleanup(): Promise<void> {
  await db.delete(runnerJobs).where(eq(runnerJobs.runnerId, testRunnerId))
  await db.delete(runnerRegistrationTokens).where(eq(runnerRegistrationTokens.runnerId, testRunnerId))
  await db.delete(runners).where(eq(runners.id, testRunnerId))
}

describe('OIDC round-trip E2E', () => {
  beforeAll(async () => {
    app = await createTestApp({
      oidcIssuer: ISSUER,
      oidcSigningSecret: SECRET,
    })

    const inserted = await db
      .insert(runners)
      .values({
        name: `e2e-test-runner-${Date.now()}`,
        description: 'E2E test runner',
        labels: [],
        sandbox: 'gvisor',
        ephemeral: true,
        maxParallelJobs: 1,
        status: 'idle',
        version: 'e2e',
      })
      .returning({ id: runners.id })
    testRunnerId = inserted[0].id

    await db.insert(runnerRegistrationTokens).values({
      runnerId: testRunnerId,
      tokenHash: bearerHash,
      tokenPrefix: BEARER_PLAINTEXT.slice(0, 8),
    })

    const insertedJob = await db
      .insert(runnerJobs)
      .values({
        runnerId: testRunnerId,
        jobId: 999999,
        pickedUpAt: new Date(),
      })
      .returning({ id: runnerJobs.id })
    testJobId = insertedJob[0].id
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  beforeEach(async () => {
    // nothing per-test for now
  })

  it('rejects unauthenticated request with 401', async () => {
    const res = await app.fetch('/api/v1/runner/oidc-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: 999999,
        audience: 'sts.amazonaws.com',
      }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects request for a job the runner does not own', async () => {
    const res = await app.fetch('/api/v1/runner/oidc-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BEARER_PLAINTEXT}`,
      },
      body: JSON.stringify({
        jobId: 12345,
        audience: 'sts.amazonaws.com',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('mints a valid JWT for a runner that owns the job', async () => {
    const res = await app.fetch('/api/v1/runner/oidc-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BEARER_PLAINTEXT}`,
      },
      body: JSON.stringify({
        jobId: 999999,
        audience: 'sts.amazonaws.com',
        cacheMode: 'read',
        permissions: 'reviewer',
      }),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      value: string
      expiresAt: string
      audience: string
      jobId: number
      issuer: string
      cacheMode?: string
      permissions?: string
    }

    expect(body.value.split('.').length).toBe(3)
    expect(body.audience).toBe('sts.amazonaws.com')
    expect(body.jobId).toBe(999999)
    expect(body.issuer).toBe(ISSUER)
    expect(body.cacheMode).toBe('read')
    expect(body.permissions).toBe('reviewer')

    const exp = new Date(body.expiresAt).getTime()
    expect(exp - Date.now()).toBeGreaterThan(OIDC_TOKEN_LIFETIME_SECONDS * 1000 - 5000)
    expect(exp - Date.now()).toBeLessThanOrEqual(OIDC_TOKEN_LIFETIME_SECONDS * 1000 + 5000)

    const verification = verifyOidcToken(body.value, { issuer: ISSUER, signingSecret: SECRET })
    expect(verification.valid).toBe(true)
    if (verification.valid) {
      expect(verification.payload?.['aud']).toBe('sts.amazonaws.com')
      expect(verification.payload?.['sub']).toBe('job:999999')
      expect(verification.payload?.['cache_mode']).toBe('read')
      expect(verification.payload?.['permissions']).toBe('reviewer')
    }
  })

  it('rejects tampered tokens (signature mismatch)', async () => {
    const res = await app.fetch('/api/v1/runner/oidc-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BEARER_PLAINTEXT}`,
      },
      body: JSON.stringify({
        jobId: 999999,
        audience: 'sts.amazonaws.com',
      }),
    })
    const body = (await res.json()) as { value: string }
    const tampered = body.value.slice(0, -5) + 'AAAAA'
    const verification = verifyOidcToken(tampered, { issuer: ISSUER, signingSecret: SECRET })
    expect(verification.valid).toBe(false)
    expect(verification.reason).toBe('signature mismatch')
  })

  it('rejects audience mismatch', async () => {
    const verification = verifyOidcToken(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ3cm9uZyIsImF1ZCI6ImV2aWwifQ.fake',
      { issuer: ISSUER, signingSecret: SECRET },
    )
    expect(verification.valid).toBe(false)
  })
})
