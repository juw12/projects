// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest'
import { resolvePermissions, type PermissionLevel } from './permissions-policy.js'

describe('resolvePermissions', () => {
  describe('fork PRs — always denied', () => {
    it.each([
      ['pull_request'],
      ['pull_request_target'],
      ['push'],
      ['workflow_dispatch'],
      ['schedule'],
    ] as const)('fork PR with trigger %s → none', (trigger) => {
      const result = resolvePermissions(trigger, true, 'full')
      expect(result.level).toBe('none')
      expect(result.reviewerGated).toBe(false)
      expect(result.reason).toContain('fork PR')
    })
  })

  describe('same-repo trusted triggers — full by default', () => {
    it.each([
      ['push'],
      ['workflow_dispatch'],
      ['schedule'],
      ['workflow_run'],
      ['repository_dispatch'],
    ] as const)('same-repo trigger %s with workflow-requested full → full', (trigger) => {
      const result = resolvePermissions(trigger, false, 'full')
      expect(result.level).toBe('full')
      expect(result.reviewerGated).toBe(false)
    })
  })

  describe('same-repo PRs — reviewer-gated', () => {
    it('same-repo pull_request with workflow-requested full → reviewer', () => {
      const result = resolvePermissions('pull_request', false, 'full')
      expect(result.level).toBe('reviewer')
      expect(result.reviewerGated).toBe(true)
    })

    it('same-repo pull_request_target with workflow-requested full → reviewer', () => {
      const result = resolvePermissions('pull_request_target', false, 'full')
      expect(result.level).toBe('reviewer')
      expect(result.reviewerGated).toBe(true)
    })
  })

  describe('workflow opt-out', () => {
    it('trusted trigger with workflow-requested none → none', () => {
      const result = resolvePermissions('push', false, 'none')
      expect(result.level).toBe('none')
      expect(result.reason).toContain('opted out')
    })
  })

  describe('unknown triggers — closed by default', () => {
    it('returns none for an unrecognized trigger source', () => {
      const result = resolvePermissions('totally-unknown' as any, false, 'full')
      expect(result.level).toBe('none')
      expect(result.reason).toContain('unknown trigger')
    })
  })

  describe('fork PR override attempt', () => {
    it('workflow YAML requesting full on a fork PR is ignored', () => {
      const result = resolvePermissions('pull_request_target', true, 'full')
      expect(result.level).toBe('none')
      expect(result.reason).toContain('fork PR')
      expect(result.reason).toContain("'pull_request_target'")
    })
  })
})
