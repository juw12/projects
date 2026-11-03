// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest'
import {
  decideEgress,
  DEFAULT_EGRESS_ALLOWLIST,
  type EgressAllowlistEntry,
} from './egress-policy.js'

describe('decideEgress', () => {
  describe('deny-all mode', () => {
    it.each([
      ['registry.npmjs.org'],
      ['pypi.org'],
      ['anything.example.com'],
    ])('denies %s', (destination) => {
      const decision = decideEgress({
        mode: 'deny-all',
        destination,
        allowlist: [],
      })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toContain('deny-all')
    })
  })

  describe('allow-all mode', () => {
    it('allows any destination', () => {
      const decision = decideEgress({
        mode: 'allow-all',
        destination: 'attacker.example.com',
        allowlist: [],
      })
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toContain('allow-all')
    })
  })

  describe('allowlist mode', () => {
    const allowlist: EgressAllowlistEntry[] = [
      { pattern: 'registry.npmjs.org', kind: 'host', note: 'npm' },
      { pattern: '.github.com', kind: 'wildcard', note: 'GitHub' },
      { pattern: '10.0.0.0/8', kind: 'cidr', note: 'internal VPC' },
    ]

    it('allows exact host match', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: 'registry.npmjs.org',
        allowlist,
      })
      expect(decision.allowed).toBe(true)
      expect(decision.matchedEntry?.pattern).toBe('registry.npmjs.org')
    })

    it('rejects different host even on same TLD', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: 'evil.com',
        allowlist,
      })
      expect(decision.allowed).toBe(false)
    })

    it('allows wildcard suffix match', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: 'api.github.com',
        allowlist,
      })
      expect(decision.allowed).toBe(true)
      expect(decision.matchedEntry?.kind).toBe('wildcard')
    })

    it('allows CIDR match for IP in range', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '10.0.5.7',
        allowlist,
      })
      expect(decision.allowed).toBe(true)
      expect(decision.matchedEntry?.kind).toBe('cidr')
    })

    it('rejects CIDR match for IP outside range', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '192.168.1.1',
        allowlist,
      })
      expect(decision.allowed).toBe(false)
    })

    it('rejects when allowlist is empty', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: 'registry.npmjs.org',
        allowlist: [],
      })
      expect(decision.allowed).toBe(false)
    })
  })

  describe('CIDR edge cases', () => {
    it('rejects malformed CIDR (no slash)', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '10.0.0.1',
        allowlist: [{ pattern: '10.0.0.0', kind: 'cidr', note: 'bad' }],
      })
      expect(decision.allowed).toBe(false)
    })

    it('rejects malformed CIDR (out-of-range prefix)', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '10.0.0.1',
        allowlist: [{ pattern: '10.0.0.0/99', kind: 'cidr', note: 'bad' }],
      })
      expect(decision.allowed).toBe(false)
    })

    it('rejects malformed IPv4 destination', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '999.999.999.999',
        allowlist: [{ pattern: '10.0.0.0/8', kind: 'cidr', note: 'cidr' }],
      })
      expect(decision.allowed).toBe(false)
    })

    it('handles /0 (match-all)', () => {
      const decision = decideEgress({
        mode: 'allowlist',
        destination: '8.8.8.8',
        allowlist: [{ pattern: '0.0.0.0/0', kind: 'cidr', note: 'all' }],
      })
      expect(decision.allowed).toBe(true)
    })
  })

  describe('default allowlist', () => {
    it('includes common destinations', () => {
      const destinations = DEFAULT_EGRESS_ALLOWLIST.map(e => e.pattern)
      expect(destinations).toContain('registry.npmjs.org')
      expect(destinations).toContain('pypi.org')
    })

    it('all entries are typed', () => {
      for (const entry of DEFAULT_EGRESS_ALLOWLIST) {
        expect(['host', 'wildcard', 'cidr']).toContain(entry.kind)
      }
    })
  })
})
