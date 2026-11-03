// SPDX-License-Identifier: MIT
export type EgressMode = 'allow-all' | 'deny-all' | 'allowlist'

export interface EgressAllowlistEntry {
  readonly pattern: string
  readonly kind: 'host' | 'wildcard' | 'cidr'
  readonly note: string
}

export interface EgressDecision {
  allowed: boolean
  reason: string
  matchedEntry?: EgressAllowlistEntry
}

export interface EgressRequest {
  mode: EgressMode
  destination: string
  allowlist: ReadonlyArray<EgressAllowlistEntry>
}

export function decideEgress(req: EgressRequest): EgressDecision {
  if (req.mode === 'deny-all') {
    return {
      allowed: false,
      reason: 'egress is deny-all by default; workflow must declare an allowlist',
    }
  }
  if (req.mode === 'allow-all') {
    return {
      allowed: true,
      reason: 'egress is allow-all (insecure default; not recommended)',
    }
  }
  for (const entry of req.allowlist) {
    if (matches(entry, req.destination)) {
      return {
        allowed: true,
        reason: `matched allowlist entry: ${entry.pattern}`,
        matchedEntry: entry,
      }
    }
  }
  return {
    allowed: false,
    reason: `destination ${req.destination} is not in the workflow's egress allowlist`,
  }
}

function matches(entry: EgressAllowlistEntry, dest: string): boolean {
  switch (entry.kind) {
    case 'host':
      return entry.pattern === dest
    case 'wildcard':
      return dest === entry.pattern.slice(1) || dest.endsWith(entry.pattern)
    case 'cidr':
      return matchCIDR(entry.pattern, dest)
  }
}

function matchCIDR(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf('/')
  if (slash < 0) return false
  const net = cidr.slice(0, slash)
  const prefix = Number(cidr.slice(slash + 1))
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const netNum = ipv4ToNumber(net)
  const ipNum = ipv4ToNumber(ip)
  if (netNum === null || ipNum === null) return false
  return (netNum & mask) === (ipNum & mask)
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = (n * 256) + v
  }
  return n >>> 0
}

export const DEFAULT_EGRESS_ALLOWLIST: ReadonlyArray<EgressAllowlistEntry> = [
  { pattern: 'registry.npmjs.org', kind: 'host', note: 'npm registry' },
  { pattern: 'pypi.org', kind: 'host', note: 'PyPI registry' },
  { pattern: '.githubusercontent.com', kind: 'wildcard', note: 'GitHub Actions CDN' },
  { pattern: '.openforge.example', kind: 'wildcard', note: 'OpenForge server (replace)' },
]
