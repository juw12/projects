/**
 * HMAC-SHA256 webhook payload signing.
 *
 * Wire format: X-OpenForge-Signature: sha256=<hex>
 * Receivers verify by recomputing sha256 over the raw request body using their stored secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-openforge-signature'
export const SIGNATURE_PREFIX = 'sha256='

export function signPayload(body: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return SIGNATURE_PREFIX + hex
}

/**
 * Timing-safe signature verification. Use this on the receiver side.
 */
export function verifySignature(body: string, secret: string, signature: string): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false
  const expected = signPayload(body, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verify with a timestamp tolerance to defeat replay attacks.
 * Recommended for receiver-side validation: window of ±5 minutes.
 */
export function verifySignatureWithTimestamp(
  body: string,
  secret: string,
  signature: string,
  timestamp: string | null,
  toleranceMs = 5 * 60 * 1000,
): boolean {
  if (!timestamp) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() - ts) > toleranceMs) return false
  return verifySignature(body, secret, signature)
}
