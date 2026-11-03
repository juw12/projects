// SPDX-License-Identifier: MIT
//
// Tests for the OIDC token issuer. Pure unit tests, no DB, no HTTP.

import { describe, it, expect } from 'vitest'
import {
  issueOidcToken,
  validateConfig,
  verifyOidcToken,
  OIDC_TOKEN_LIFETIME_SECONDS,
  OidcIssuerConfigError,
} from './oidc-token.js'

const baseConfig = {
  issuer: 'forge.example.com',
  signingSecret: 'a'.repeat(64), // 64 random bytes (here just 'a's for test)
}

describe('validateConfig', () => {
  it('rejects empty issuer', () => {
    expect(() => validateConfig({ issuer: '', signingSecret: baseConfig.signingSecret })).toThrow(
      OidcIssuerConfigError,
    )
  })

  it('rejects short signing secret', () => {
    expect(() => validateConfig({ issuer: 'x', signingSecret: 'short' })).toThrow(
      OidcIssuerConfigError,
    )
  })

  it('accepts a valid config', () => {
    expect(() => validateConfig(baseConfig)).not.toThrow()
  })
})

describe('issueOidcToken', () => {
  const fixedNow = new Date('2026-11-03T12:00:00Z')

  it('issues a token with the default 5-minute lifetime', () => {
    const resp = issueOidcToken(baseConfig, { jobId: 42, audience: 'sts.amazonaws.com' }, fixedNow)
    expect(resp.audience).toBe('sts.amazonaws.com')
    expect(resp.jobId).toBe(42)
    expect(resp.issuer).toBe('forge.example.com')
    expect(resp.value.split('.').length).toBe(3)
    // expiry is 5 minutes after now
    const expectedExpiry = new Date(fixedNow.getTime() + OIDC_TOKEN_LIFETIME_SECONDS * 1000)
    expect(new Date(resp.expiresAt).getTime()).toBe(expectedExpiry.getTime())
  })

  it('honors a custom lifetime within bounds', () => {
    const resp = issueOidcToken(
      baseConfig,
      { jobId: 1, audience: 'k8s.default', lifetimeSec: 120 },
      fixedNow,
    )
    const expectedExpiry = new Date(fixedNow.getTime() + 120 * 1000)
    expect(new Date(resp.expiresAt).getTime()).toBe(expectedExpiry.getTime())
  })

  it('rejects lifetimeSec > 15 minutes', () => {
    expect(() =>
      issueOidcToken(baseConfig, { jobId: 1, audience: 'k8s.default', lifetimeSec: 16 * 60 }, fixedNow),
    ).toThrow(/exceeds maximum/)
  })

  it('rejects non-positive jobId', () => {
    expect(() => issueOidcToken(baseConfig, { jobId: 0, audience: 'x' }, fixedNow)).toThrow(
      /positive integer/,
    )
    expect(() => issueOidcToken(baseConfig, { jobId: -1, audience: 'x' }, fixedNow)).toThrow(
      /positive integer/,
    )
  })

  it('rejects empty audience', () => {
    expect(() => issueOidcToken(baseConfig, { jobId: 1, audience: '' }, fixedNow)).toThrow(
      /non-empty/,
    )
    expect(() =>
      issueOidcToken(baseConfig, { jobId: 1, audience: '   ' }, fixedNow),
    ).toThrow(/non-empty/)
  })

  it('produces distinct jti claims across calls', () => {
    const a = issueOidcToken(baseConfig, { jobId: 1, audience: 'x' }, fixedNow)
    const b = issueOidcToken(baseConfig, { jobId: 1, audience: 'x' }, fixedNow)
    expect(a.value).not.toBe(b.value)
  })
})

describe('verifyOidcToken round-trip', () => {
  const fixedNow = new Date('2026-11-03T12:00:00Z')

  it('verifies a freshly issued token', () => {
    const resp = issueOidcToken(baseConfig, { jobId: 42, audience: 'sts.amazonaws.com' }, fixedNow)
    const result = verifyOidcToken(resp.value, baseConfig, fixedNow)
    expect(result.valid).toBe(true)
    expect(result.payload?.['iss']).toBe('forge.example.com')
    expect(result.payload?.['aud']).toBe('sts.amazonaws.com')
    expect(result.payload?.['sub']).toBe('job:42')
  })

  it('rejects an expired token', () => {
    const past = new Date('2026-01-01T00:00:00Z')
    const resp = issueOidcToken(baseConfig, { jobId: 1, audience: 'x' }, past)
    const result = verifyOidcToken(resp.value, baseConfig, fixedNow)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('rejects a token signed with a different secret', () => {
    const resp = issueOidcToken(baseConfig, { jobId: 1, audience: 'x' }, fixedNow)
    const tamperedConfig = { ...baseConfig, signingSecret: 'b'.repeat(64) }
    const result = verifyOidcToken(resp.value, tamperedConfig, fixedNow)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature mismatch')
  })

  it('rejects a malformed token', () => {
    const result = verifyOidcToken('not.a.jwt', baseConfig, fixedNow)
    expect(result.valid).toBe(false)
  })
})
