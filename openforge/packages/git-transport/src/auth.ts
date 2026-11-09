import type { ExtractedAuth, TransportRequestLike } from './types.js'

/**
 * Pull authentication material out of an incoming Smart-HTTP request
 * without doing any user lookup. Authorization (mapping credentials to a
 * user, checking repo ACLs) lives in the route layer — this package only
 * carries the credentials forward.
 *
 * Order matches what Gitea/Forgejo honor:
 *   1. `Authorization: Basic ...` header — interactive HTTPS clones,
 *      pushed from a credential helper.
 *   2. `?token=<token>` query param — used by unauthenticated SSH-key
 *      paths where a reverse proxy terminates SSH and forwards the key
 *      fingerprint as a token in the URL.
 *
 * Anonymous traffic (public mirror clones, public-repo fetches) returns
 * {type: 'none'} and is the caller's signal to apply public-read ACLs.
 */
export function extractAuth(req: TransportRequestLike): ExtractedAuth {
  const authHeader = req.headers.get('authorization')
  if (authHeader) {
    const trimmed = authHeader.trim()
    if (trimmed.toLowerCase().startsWith('basic ')) {
      const decoded = decodeBasic(trimmed.slice('basic '.length).trim())
      if (decoded) {
        return { type: 'basic', username: decoded.username, password: decoded.password }
      }
    }
  }

  const token = req.query.get('token') ?? req.query.get('access_token')
  if (token && token.length > 0) {
    return { type: 'token', token }
  }

  return { type: 'none' }
}

function decodeBasic(payload: string): { username: string; password: string } | null {
  let raw: string
  try {
    raw = Buffer.from(payload, 'base64').toString('utf8')
  } catch {
    return null
  }
  const colon = raw.indexOf(':')
  if (colon < 0) {
    return null
  }
  const username = raw.slice(0, colon)
  const password = raw.slice(colon + 1)
  if (username.length === 0) {
    return null
  }
  return { username, password }
}
