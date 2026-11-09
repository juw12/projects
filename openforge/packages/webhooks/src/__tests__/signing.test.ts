import { describe, it, expect } from 'vitest'
import { signPayload, verifySignature, verifySignatureWithTimestamp, SIGNATURE_PREFIX } from '../signing.js'

describe('signing', () => {
  const secret = 'super-secret-token'
  const body = '{"event":"push","repo":"acme/widgets"}'

  it('signPayload produces stable sha256 hex', () => {
    const sig1 = signPayload(body, secret)
    const sig2 = signPayload(body, secret)
    expect(sig1).toBe(sig2)
    expect(sig1.startsWith(SIGNATURE_PREFIX)).toBe(true)
    expect(sig1.length).toBe(SIGNATURE_PREFIX.length + 64) // sha256 = 32 bytes = 64 hex
  })

  it('verifySignature accepts the correct signature', () => {
    const sig = signPayload(body, secret)
    expect(verifySignature(body, secret, sig)).toBe(true)
  })

  it('verifySignature rejects a tampered body', () => {
    const sig = signPayload(body, secret)
    expect(verifySignature(body + 'X', secret, sig)).toBe(false)
  })

  it('verifySignature rejects a different secret', () => {
    const sig = signPayload(body, secret)
    expect(verifySignature(body, 'wrong-secret', sig)).toBe(false)
  })

  it('verifySignature rejects a missing prefix', () => {
    expect(verifySignature(body, secret, 'abc123')).toBe(false)
  })

  it('verifySignatureWithTimestamp accepts a fresh signature', () => {
    const sig = signPayload(body, secret)
    const ts = String(Date.now())
    expect(verifySignatureWithTimestamp(body, secret, sig, ts)).toBe(true)
  })

  it('verifySignatureWithTimestamp rejects an old timestamp', () => {
    const sig = signPayload(body, secret)
    const ts = String(Date.now() - 10 * 60 * 1000) // 10 min ago, > 5min tolerance
    expect(verifySignatureWithTimestamp(body, secret, sig, ts)).toBe(false)
  })

  it('verifySignatureWithTimestamp rejects a missing timestamp', () => {
    const sig = signPayload(body, secret)
    expect(verifySignatureWithTimestamp(body, secret, sig, null)).toBe(false)
  })
})
