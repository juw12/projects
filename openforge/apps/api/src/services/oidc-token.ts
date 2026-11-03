// SPDX-License-Identifier: MIT
//
// OpenForge server-side OIDC token issuer.
//
// Spec: see openforge/runner/INTEGRATION.md § "OIDC token injection".
//
// This service mints short-lived (~5min) OIDC tokens that the runner can
// exchange for cloud workload identity (AWS STS, GCP, Azure OIDC, K8s).
// The runner NEVER holds long-lived cloud credentials — every job asks
// the OpenForge server for a fresh token at execution time.
//
// Design choices (verified 2026-11-03):
//   - Lifetime: 5 minutes (300s). Matches GitHub's canonical
//     ACTIONS_ID_TOKEN_REQUEST_TOKEN example.
//   - Audience restriction: caller MUST specify audience in the request;
//     we echo it back so the runner can detect server misconfiguration.
//   - Issuer: the OpenForge server's canonical host. The runner verifies
//     iss matches what it expects.
//   - Algorithm: HS256 with a server-side secret. Production should
//     migrate to RS256 with a per-recipient JWKS (out of scope here).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const OIDC_TOKEN_LIFETIME_SECONDS = 5 * 60 // 5 minutes

export type CacheMode = 'read' | 'write' | 'write-only' | 'none'

const VALID_CACHE_MODES = new Set<CacheMode>(['read', 'write', 'write-only', 'none'])

export interface OidcTokenRequest {
  jobId: number
  audience: string
  lifetimeSec?: number
  cacheMode?: CacheMode
  permissions?: 'none' | 'reviewer' | 'full'
}

export interface OidcTokenResponse {
  value: string // signed JWT
  expiresAt: string // ISO-8601
  audience: string
  jobId: number
  notBefore: string
  issuer: string
  cacheMode?: CacheMode
  permissions?: 'none' | 'reviewer' | 'full'
}

export interface OidcIssuerConfig {
  /** Server host that will appear in the `iss` claim. */
  issuer: string
  /** HS256 signing secret. Must be at least 32 bytes. */
  signingSecret: string
  /** Optional override of the token lifetime (defaults to 5 min). */
  defaultLifetimeSec?: number
}

export class OidcIssuerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcIssuerConfigError'
  }
}

/**
 * Validate the issuer config at construction. Fails fast on misconfig.
 */
export function validateConfig(config: OidcIssuerConfig): void {
  if (!config.issuer || config.issuer.length === 0) {
    throw new OidcIssuerConfigError('issuer must be a non-empty string')
  }
  if (!config.signingSecret || config.signingSecret.length < 32) {
    throw new OidcIssuerConfigError(
      'signingSecret must be at least 32 bytes (recommend 64 random bytes)',
    )
  }
}

/**
 * Issue an OIDC token. Pure function: same inputs → same output, modulo
 * the random `jti` claim and the time-derived `iat`/`nbf`/`exp` claims.
 */
export function issueOidcToken(
  config: OidcIssuerConfig,
  request: OidcTokenRequest,
  now: Date = new Date(),
): OidcTokenResponse {
  validateConfig(config)
  if (!Number.isInteger(request.jobId) || request.jobId <= 0) {
    throw new Error(`jobId must be a positive integer, got ${request.jobId}`)
  }
  if (!request.audience || request.audience.trim().length === 0) {
    throw new Error('audience must be a non-empty string')
  }
  if (request.cacheMode !== undefined && !VALID_CACHE_MODES.has(request.cacheMode)) {
    throw new Error(
      `cacheMode must be one of: read, write, write-only, none; got ${request.cacheMode}`,
    )
  }
  if (request.permissions !== undefined &&
      request.permissions !== 'none' &&
      request.permissions !== 'reviewer' &&
      request.permissions !== 'full') {
    throw new Error(
      `permissions must be one of: none, reviewer, full; got ${request.permissions}`,
    )
  }

  const lifetimeSec = clampLifetime(request.lifetimeSec ?? config.defaultLifetimeSec)
  const expiresAt = new Date(now.getTime() + lifetimeSec * 1000)
  const jti = randomBytes(16).toString('hex')

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  const payload: Record<string, unknown> = {
    iss: config.issuer,
    aud: request.audience,
    sub: `job:${request.jobId}`,
    iat: Math.floor(now.getTime() / 1000),
    nbf: Math.floor(now.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
    jti,
  }
  if (request.cacheMode !== undefined) {
    payload['cache_mode'] = request.cacheMode
  }
  if (request.permissions !== undefined) {
    payload['permissions'] = request.permissions
  }

  const value = signHs256(header, payload, config.signingSecret)

  return {
    value,
    expiresAt: expiresAt.toISOString(),
    audience: request.audience,
    jobId: request.jobId,
    notBefore: now.toISOString(),
    issuer: config.issuer,
    ...(request.cacheMode !== undefined && { cacheMode: request.cacheMode }),
    ...(request.permissions !== undefined && { permissions: request.permissions }),
  }
}

function clampLifetime(requested: number | undefined): number {
  if (requested === undefined) return OIDC_TOKEN_LIFETIME_SECONDS
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error(`lifetimeSec must be a positive number, got ${requested}`)
  }
  // Hard upper bound: 15 minutes. Anything longer is suspicious.
  const MAX = 15 * 60
  if (requested > MAX) {
    throw new Error(`lifetimeSec ${requested}s exceeds maximum ${MAX}s`)
  }
  return Math.floor(requested)
}

function signHs256(
  header: Record<string, string>,
  payload: Record<string, unknown>,
  secret: string,
): string {
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const sig = createHmac('sha256', secret).update(signingInput).digest()
  return `${signingInput}.${base64urlEncodeBytes(sig)}`
}

function base64urlEncode(input: string): string {
  return base64urlEncodeBytes(Buffer.from(input, 'utf8'))
}

function base64urlEncodeBytes(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Verify a token's signature with constant-time comparison. Returns true
 * if the signature matches and the token is not expired. Used by the
 * runner-side verification helper.
 */
export function verifyOidcToken(
  token: string,
  config: OidcIssuerConfig,
  now: Date = new Date(),
): { valid: boolean; reason?: string; payload?: Record<string, unknown> } {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed: expected 3 segments' }
  }
  const [headerB64, payloadB64, sigB64] = parts

  const expectedSig = createHmac('sha256', config.signingSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest()
  let providedSig: Buffer
  try {
    providedSig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } catch {
    return { valid: false, reason: 'malformed: invalid base64 in signature' }
  }
  if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
    return { valid: false, reason: 'signature mismatch' }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed: invalid JSON in payload' }
  }

  const exp = Number(payload['exp'])
  if (!Number.isFinite(exp)) return { valid: false, reason: 'malformed: missing exp' }
  if (Math.floor(now.getTime() / 1000) >= exp) return { valid: false, reason: 'expired' }

  if (payload['iss'] !== config.issuer) {
    return { valid: false, reason: 'issuer mismatch' }
  }

  return { valid: true, payload }
}
