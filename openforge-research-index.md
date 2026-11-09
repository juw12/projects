# OpenForge Runner Architecture Research — Final Index

**Date:** 2026-11-03
**Status:** ✅ Complete (Round 1 + Round 2 verification)
**Scope:** Exhaustive research across 8 topics to inform OpenForge's CI runner architecture decision (TypeScript monorepo: Next.js + Hono + Postgres + S3 + smart-HTTP git, greenfield).

---

## Topic coverage

| # | Topic | Round 1 | Round 2 |
|---|---|---|---|
| 1 | `act_runner` (Forgejo) + `act` (nektosact) source map | `openforge-research-act-runner-act.md` (~470 lines) | `openforge-research-act-runner-act-round2.md` (~440 lines) |
| 2 | Six self-hosted CI engines compared (Woodpecker, Drone, Buildkite, Concourse, Tekton, Prow) | `openforge-research-ci-engines.md` (737 lines) | `openforge-verify-ci-engines-round2.md` (637 lines) |
| 3 | Top 10 hardest CI runner trust problems | `ci-runner-threat-surface.md` (existing, 626 lines) | (verified via Round-2 cross-reference; no separate verification file) |
| 4 | Container sandboxing 2026 deep dive (gVisor, kata, Firecracker, rootless Docker, Sysbox) | `openforge-research-sandboxing.md` (1,254 lines; Sysbox §5.6 truncated at tool cap) | `openforge-research-sandboxing-round2.md` (590 lines; completed Sysbox §5.6/§5.7) |
| 5 | CI vendor postmortems since 2022 (GitHub Actions, GitLab, CircleCI, Travis) | `openforge-research-postmortems.md` (540 lines) | `openforge-research-postmortems-round2.md` (~380 lines) |
| 6 | Six architectural topics × 200 words each (queue, cache, OIDC, egress, ephemeral/persistent, fork PR) | `openforge-runner-reference.md` (existing, 629 lines) | (verified via Round-2 cross-reference; no separate verification file) |
| 7 | GitHub Actions spec + actions/cache + actions/upload-artifact minimum-viable subset | `openforge-research-actions-spec.md` (784 lines) | `openforge-research-actions-spec-round2-verification.md` (687 lines) |
| 8 | Non-YAML CI models survey (OneDev, Gitea, Phabricator, Sourcehut, Bamboo, etc.) | `openforge-research-non-yaml-ci.md` (~330 lines) | `openforge-research-non-yaml-ci-round2.md` (542 lines) |

### Cross-reference
| File | Purpose |
|---|---|
| `openforge-round1-vs-round2-cross-reference.md` | Round 1 vs Round 2 delta + decision-ready synthesis |

---

## Round 2 status — no Round 3 required

Per the user spec ("a third pass if the first two disagree"), Round 3 is **not required**.

- Round 1 and Round 2 agree on all 8 architectural conclusions.
- Round 2 found **citation-level corrections** (line numbers, package names, mechanism descriptions, CVE severities) and **gaps** (xz-utils 2024-03, `$GITHUB_ARTIFACTS`, Kuasar, Jenkins advisories, etc.), but no architectural contradictions.

---

## Decision-ready synthesis

### Q1: Fork act_runner, adopt act, or build from scratch?

**Hybrid — own TypeScript controller speaking a forked ConnectRPC task queue + act's executor either ported or run as a Go sidecar.**

- **Protocol core is small and forkable.** Gitea baseline = 5+1 RPCs. Forgejo = 7+1. Trivially reproducible in TS/Postgres (connect-web).
- **Executor is the hard 80%** (step lifecycle, expression evaluator via actionlint, action cache, container backends, reusables/composites).
- **Plugin gRPC contract is MIT-licensed** (deliberately so) — borrow the 7-RPC `BackendPlugin` interface without inheriting GPL-3.0.
- **Forgejo runner v13.2.1 SHA** is now confirmed: `c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7` (via Go module proxy `.info` endpoint).

### Q2: Container sandboxing tiering?

- **Default runner:** Rootless Docker / crun / Podman with AppArmor.
- **Untrusted-PR tier:** gVisor (95% kernel CVE defense, zero CPU overhead).
- **High-security tier:** Firecracker microVM (125ms boot, 5MiB overhead, only 2 CVEs in 2026).
- **Avoid:** Kata + Dragonball (5+ critical virtio-fs CVEs in 2026). Sysbox for non-CI system-container use only.

### Q3: YAML or non-YAML CI format?

**Ship YAML, GitHub Actions-compatible (`.github/workflows/*.yml`).**

- Every successful self-hosted Git platform uses file-based YAML. The two non-file systems (Phabricator Harbormaster, Bamboo) both died.
- Dagger 1.0 (Oct 2026) proves non-YAML works only as standalone CI, not embedded in a forge.

### Q4: Threat model?

10 trust problems, 3 invariants:
1. Low-trust code never executes in a high-trust context (problems 1, 4, 6)
2. No high-value state outlives the job that needed it (problems 3, 10, credential half of 8)
3. No mutable reference is ever the unit of trust (problems 2, 5, 9)

**OpenForge differentiator:** log cache writes, token mints, and run deletions as **auditable events** (creating run + actor + commit). GitHub doesn't expose this. Self-hosted can.

### Q5: GitHub Actions compatibility contract?

**Must reimplement faithfully:**
- Workflow schema (`workflow-v1.0`) — all keywords + `workflow_call` reusables
- Expression grammar with precedence + JS-Number() coercion
- All 12 contexts + per-keyword context-availability matrix
- Runtime env contract: `GITHUB_*`, `RUNNER_*`, `ACTIONS_*`
- Workflow-command files: `$GITHUB_OUTPUT`, `$GITHUB_ENV`, `$GITHUB_PATH`, `$GITHUB_STATE`, `$GITHUB_STEP_SUMMARY`, **`$GITHUB_ARTIFACTS`** (NEW, Round-2), legacy `::set-output`
- **`ACTIONS_CACHE_MODE`** env var (NEW, Round-2)
- `actions/checkout` (incl. PR merge-ref), `actions/cache`, `actions/upload-artifact` v4 + merge, `actions/download-artifact`, `actions/setup-*` via RUNNER_TOOL_CACHE, `actions/github-script` via Octokit-compatible API

**Can deliberately diverge:**
- Cache backend wire format (v1 REST or v2 Twirp)
- Cache version hash
- Eviction policy
- GitHub-specific supply-chain/OIDC/SLSA/attestation features

**Highest-risk compat items to validate first:**
1. PR merge-ref checkout
2. Context-availability enforcement (security)
3. `cache-hit` exact-match + benign-race semantics
4. Artifact immutability + merge
5. `workflow_run` cross-run artifact path

---

## Open gaps (if user wants Round 3)

These are the candidates if you want to do a third pass for **gap-filling** rather than contradiction-resolution:

1. **Jenkins security advisories 2022-2026** (gap from topics 2 and 5)
2. **Buildkite / Drone / Harness / Tekton security advisories 2024-2026** (gap from topic 5)
3. **xz-utils 2024-03 deep-dive** (gap from topic 5; CVE-2024-3094)
4. **Codeberg-Woodpecker rationale** (gap from topic 8)
5. **The 4 Round-2 still-unverified flagged items:**
   - GitLab 2022-2026 incident-report dates (about.gitlab.com unreachable)
   - Travis CI 2023/2024 (traviscistatus.com unreachable)
   - Grafana `pull_request_target` 2025-04 (no primary source)
   - Gheist campaign 2026-10 (no primary source)

---

## File manifest (workspace)

### Round 1 outputs (8 topics)
- `openforge-research-act-runner-act.md`
- `openforge-research-ci-engines.md`
- `ci-runner-threat-surface.md` (existing)
- `openforge-research-sandboxing.md`
- `openforge-research-postmortems.md`
- `openforge-runner-reference.md` (existing)
- `openforge-research-actions-spec.md`
- `openforge-research-non-yaml-ci.md`

### Round 2 verification outputs (6 topics)
- `openforge-research-act-runner-act-round2.md`
- `openforge-verify-ci-engines-round2.md`
- `openforge-research-sandboxing-round2.md`
- `openforge-research-postmortems-round2.md`
- `openforge-research-actions-spec-round2-verification.md`
- `openforge-research-non-yaml-ci-round2.md`

### Index + cross-reference
- `openforge-research-index.md` (this file)
- `openforge-round1-vs-round2-cross-reference.md` (companion with decision inputs)

### Prior research in workspace (separate files, not part of this research pass)
- `openforge-architecture.md`
- `openforge-subsystem-architecture.md` (§4 CI Runners, §10 Actions/Workflows)
- `openforge-ci-runner-trust-top10.md`
- `openforge-ci-trust-problems.md`
- `openforge-container-sandboxing.md`
- `openforge-hard-problems-risk-register.md`
- `openforge-surface-report.md`
- `openforge-webhook-prior-art.md`
- `openforge-runner-reference.pass2.md`
- `openforge-mobile-stack-research.md`, `openforge-research-gh-cli.md`, `openforge-research-git-transport.md`, `openforge-research-graphql.md`, `openforge-research-graphql-pass2.md`, `openforge-research-cli-libraries.md`, `openforge-research-cli-problems.md`, `openforge-research-mobile-clients.md`, `openforge-research-terminal-ui.md`
