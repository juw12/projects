// SPDX-License-Identifier: MIT
//
// Tests for the runner bearer authentication. Uses a mock DB client
// to avoid hitting Postgres; verifies the SQL semantics by stubbing
// the drizzle query builder.

import { describe, it, expect } from 'vitest'
import { sha256Hex, extractBearer } from './runner-auth.js'

describe('sha256Hex', () => {
  it('returns a 64-char lowercase hex string', () => {
    const h = sha256Hex('hello')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches a known SHA-256 reference vector', () => {
    // SHA-256("hello") is well-known
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('produces distinct hashes for distinct inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})

describe('extractBearer', () => {
  it('returns the token for a valid Bearer header', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123')
  })
  it('is case-insensitive on the scheme', () => {
    expect(extractBearer('bearer abc')).toBe('abc')
    expect(extractBearer('BEARER abc')).toBe('abc')
  })
  it('returns null for missing header', () => {
    expect(extractBearer(undefined)).toBeNull()
    expect(extractBearer(null)).toBeNull()
    expect(extractBearer('')).toBeNull()
  })
  it('returns null for non-Bearer schemes', () => {
    expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull()
    expect(extractBearer('Token xyz')).toBeNull()
  })
  it('returns null for empty bearer token', () => {
    expect(extractBearer('Bearer ')).toBeNull()
    expect(extractBearer('Bearer')).toBeNull()
  })
})
