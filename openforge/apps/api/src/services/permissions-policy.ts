// SPDX-License-Identifier: MIT
//
// Server-side enforcement of fork-PR permissions. The server — not the
// workflow YAML — decides what permissions a job receives. Workflows can
// REQUEST higher permissions but cannot GRANT them.
//
// Verified threat model (2026-11-03):
//   - Pwn request (Grafana Apr 2025): fork PR + pull_request_target with
//     base secrets. We kill the class by always denying fork PRs.
//   - pull_request_target default block (GitHub effective Dec 2 2026).
//
// Permission levels:
//   'none'    — no base repo secrets, no head checkout from fork
//   'reviewer' — base repo secrets only after explicit reviewer approval
//   'full'    — base repo secrets + head checkout (trusted triggers only)

export type PermissionLevel = 'none' | 'reviewer' | 'full'

export type TriggerSource =
  | 'push'
  | 'pull_request'
  | 'pull_request_target'
  | 'workflow_dispatch'
  | 'schedule'
  | 'workflow_run'
  | 'repository_dispatch'

export interface ResolvedPermissions {
  level: PermissionLevel
  reason: string
  reviewerGated: boolean
}

const FORK_DENY: ReadonlySet<TriggerSource> = new Set<TriggerSource>([
  'pull_request',
  'pull_request_target',
])

const TRUSTED: ReadonlySet<TriggerSource> = new Set<TriggerSource>([
  'push',
  'workflow_dispatch',
  'schedule',
  'workflow_run',
  'repository_dispatch',
])

export function resolvePermissions(
  triggerSource: TriggerSource,
  isForkPr: boolean,
  workflowRequested: PermissionLevel = 'full',
): ResolvedPermissions {
  if (isForkPr) {
    return {
      level: 'none',
      reason: `fork PR with trigger '${triggerSource}': base secrets and head checkout denied by server policy`,
      reviewerGated: false,
    }
  }
  if (FORK_DENY.has(triggerSource) && !isForkPr) {
    return {
      level: 'reviewer',
      reason: `same-repo '${triggerSource}' requires explicit reviewer approval for secret access`,
      reviewerGated: true,
    }
  }
  if (TRUSTED.has(triggerSource)) {
    if (workflowRequested === 'none') {
      return {
        level: 'none',
        reason: `trusted trigger '${triggerSource}' with workflow-requested 'none' (workflow opted out)`,
        reviewerGated: false,
      }
    }
    return {
      level: 'full',
      reason: `trusted trigger '${triggerSource}': full permissions granted`,
      reviewerGated: false,
    }
  }
  return {
    level: 'none',
    reason: `unknown trigger '${triggerSource}': denied by default (closed-by-default policy)`,
    reviewerGated: false,
  }
}
