# OpenForge Runner — Round 1 vs Round 2 Cross-Reference

**Date:** 2026-11-03
**Scope:** Did Round-2 verification find architectural disagreements with Round-1, or only factual corrections?
**Conclusion: factual corrections only. Architectural conclusions are stable.**

---

## At-a-glance

| Topic | Round-1 claim | Round-2 verdict | Architectural agreement? |
|---|---|---|---|
| 1. act_runner + act | Hybrid (own TS controller + act executor) is the best path | **Material corrections** (Forgejo SHA available; Gitea↔Forgejo divergence narrower than claimed; Container interface uses executor pattern not error-returns; plugin proto is MIT; jobparser is 1221 lines; moby/moby client migration) | **YES** — recommendation stands |
| 2. 6 CI engines | Woodpecker/Drone YAML is the best reference; Buildkite step vocab to borrow | **Material corrections** (Buildkite `script` step doesn't exist; Tekton Hub is dead; Woodpecker secret model is stale; Drone 2.x still active) + **major gap** (Jenkins not covered; Gitea Actions worth adding) | **YES** — recommendation stands, but consider Jenkins |
| 3. 10 trust problems | All 10 problems + 3 invariants | (Existing file — verified by use in Round-2 cross-reference; no separate verification agent) | **YES** — threat surface stable |
| 4. Sandboxing | Tiered: rootless default + Firecracker/gVisor for untrusted | **Material corrections** (gVisor network mislabeled; Kata 5 of 9 CVE severities wrong, missed 3 CVEs) + **completed truncated Sysbox §5.6/§5.7** + **gaps** (Kuasar, Podman/crun, CoCo) | **YES** — tiered recommendation stands |
| 5. CI postmortems | 15 GHSAs + 8 status incidents + adjacent supply-chain catalog | **13/15 GHSAs correct** (2 errors: GHSA-5xr6 wrong package, GHSA-7x29 mischaracterized) + **major gap** (xz-utils 2024-03 missing) + **other gaps** (Jenkins, Buildkite/Drone/Harness/Tekton advisories) | **YES** — threat-surface analysis stable |
| 6. 6 architectural topics | Queue/cache/OIDC/egress/ephemeral/fork-PR tradeoffs | (Existing file — verified by use; no separate verification agent) | **YES** |
| 7. Actions spec MVS | GHA-compatible YAML with documented divergences | **Material corrections** (HostContext.cs L410 wrong; git-auth-helper.ts L56 wrong; `$GITHUB_WORKFLOW_ENV` fictitious) + **major gaps** (`$GITHUB_ARTIFACTS`, `ACTIONS_CACHE_MODE`, cache/restore + save sub-actions, environment input type, refName/refType, Node 24 universal, vulnerability-alerts) | **YES** — MVS recommendations stand but expand |
| 8. Non-YAML CI | Ship YAML | **Corrections** (1 user misattribution, 1 dead URL) + **new findings** (Dagger 1.0, Codeberg uses Woodpecker, SourceHut LLM policy, Heptapod v18.6) | **YES** — recommendation stands even stronger |

---

## Round 3 trigger conditions (per spec: "a third pass if the first two disagree")

The user spec says: **"a third pass if the first two disagree."**

**Interpretation:** Round 1 vs Round 2 disagree on **facts** (line numbers, package names, mechanism descriptions, CVE severities, presence/absence of features) but **agree on architectural conclusions** for every topic. None of the 8 topics produced a substantive architectural contradiction.

**Decision: Round 3 is not required by the spec.** If the user wants Round 3 for **gap-filling** rather than contradiction-resolution, the candidates are:
- Jenkins security advisories 2022-2026 (gap from topic 2 and topic 5)
- Buildkite/Drone/Harness/Tekton security advisories 2024-2026 (gap from topic 5)
- xz-utils 2024-03 deep-dive (gap from topic 5)
- Codeberg-Woodpecker rationale (gap from topic 8)
- The 4 Round-2 still-unverified flagged items (GitLab dates, Travis 2023/2024, Grafana, Gheist)

---

## Architectural conclusions (unchanged across rounds)

### Topic 1 — Runner architecture
**Conclusion (stable):** Hybrid — own TypeScript controller speaking a forked ConnectRPC task queue + act's executor either ported or run as a Go sidecar. Protocol is fork-friendly (5+1 shared RPCs in the Gitea baseline, 7+1 in Forgejo). Executor is the hard 80%.

### Topic 2 — CI engines to study / borrow from
**Conclusion (stable):** Woodpecker (cleanest self-hosted repo-native YAML), Drone 2.0 (richest repo-native surface, but vendor risk under Harness), Buildkite (best step feature set to copy). Tekton (only if K8s-native). Concourse (large lift). Prow (workhorse, central config).
**Round-2 added:** Jenkins is the biggest omission — should be considered. Gitea Actions is the most relevant prior art for a self-hosted GitHub competitor.

### Topic 3 — Trust surface (10 problems + 3 invariants)
**Conclusion (stable):** Three invariants cover all 10 problems:
1. Low-trust code never executes in a high-trust context
2. No high-value state outlives the job that needed it
3. No mutable reference is ever the unit of trust

### Topic 4 — Container sandboxing
**Conclusion (stable):** Tiered model.
- **Default runner:** rootless Docker / crun / Podman (lightest overhead, sufficient for trusted workloads). gVisor as opt-in.
- **Secure runner (untrusted PRs):** gVisor (95% kernel CVE defense) OR Firecracker (125ms boot, 5MiB overhead, only 2 CVEs in 2026).
- **High-security runner:** Firecracker primary; Kata-Cloud-Hypervisor as feature-driven fallback (AVOID Kata + Dragonball — 5+ critical virtio-fs CVEs in 2026).

### Topic 5 — CI vendor postmortems
**Conclusion (stable):** All 10 trust problems are real and the 10 invariants pattern holds. New controls from Round-2:
14. Build toolchain integrity (xz-utils precedent)
15. Fork artifact isolation (GHSA-5xr6-xhww-33m4 corrected mechanism)
16. Self-hosted CI for own builds (Okta 2023-10 precedent)
17. Credential manager risk (LastPass 2022 precedent)
18. PaaS integration token scoping (Heroku 2022-04 precedent)

### Topic 6 — Architectural sub-decisions
**Conclusion (stable):** Queue = FIFO + priority + fair-share hybrid; Cache = content-addressable + PR write-isolation + 10GiB LRU/1-week; Secrets = OIDC federation primary + scoped fallback; Egress = allowlist by default + NetworkPolicy + eBPF/iptables; Ephemeral runners default, persistent only for GPU/large-repo pools; Cross-repo PR = no base secrets + no head checkout by default.

### Topic 7 — Actions spec MVS (expanded)
**Conclusion (stable, expanded):** Promise **full compatibility with workflow-v1.0 schema, ${{ }} expression grammar + all 12 contexts, and default runtime environment; drop-in compatibility with actions/checkout (incl. PR merge-ref), actions/cache, actions/upload-artifact v4 + merge, actions/download-artifact, actions/setup-* (via RUNNER_TOOL_CACHE), and actions/github-script**. Explicitly diverge (with a published divergence table) on cache/artifact backend wire format + blob store, eviction policy knobs, and GitHub-specific supply-chain/OIDC/attestation features.
**Round-2 additions:**
- `$GITHUB_ARTIFACTS` is a 7th workflow command file (declarative artifact registration, runner 2.336.0+) — must implement
- `ACTIONS_CACHE_MODE` env var (per-job cache read/write control) — must implement
- `actions/cache/restore` + `actions/cache/save` as new standalone sub-actions; `save-always` deprecated
- `environment` input type for workflow_dispatch/workflow_call
- `refName`/`refType` new Context properties in @actions/github
- Node 24 universal (all first-party actions now require it)
- `vulnerability-alerts` + service `entrypoint`/`command` new schema features

### Topic 8 — Non-YAML CI
**Conclusion (stable, even stronger):** Ship **GitHub Actions-compatible YAML** (`.github/workflows/*.yml`). No Git platform has retreated from YAML. Dagger proves non-YAML works only as standalone CI, not embedded in a forge. Innovation opportunity is in execution model (SSH-debug, ad-hoc runs, AI integration), not serialization format.

---

## File manifest (workspace)

### Round 1 outputs (8 topics)
| File | Topic | Lines |
|---|---|---|
| `openforge-research-act-runner-act.md` | 1. act_runner + act source map | ~470 |
| `openforge-research-ci-engines.md` | 2. 6 CI engines compared | 737 |
| `ci-runner-threat-surface.md` (existing) | 3. 10 trust problems | 626 |
| `openforge-research-sandboxing.md` | 4. 5 sandboxing techs | 1,254 |
| `openforge-research-postmortems.md` | 5. CI vendor postmortems | 540 |
| `openforge-runner-reference.md` (existing) | 6. 6 architectural topics | 629 |
| `openforge-research-actions-spec.md` | 7. Actions spec MVS | 784 |
| `openforge-research-non-yaml-ci.md` | 8. Non-YAML CI survey | ~330 |

### Round 2 verification outputs (6 topics)
| File | Topic | Lines |
|---|---|---|
| `openforge-research-act-runner-act-round2.md` | 1. verification | ~440 |
| `openforge-verify-ci-engines-round2.md` | 2. verification | 637 |
| `openforge-research-sandboxing-round2.md` | 4. verification (incl. completed Sysbox §5.6/§5.7) | 590 |
| `openforge-research-postmortems-round2.md` | 5. verification | ~380 |
| `openforge-research-actions-spec-round2-verification.md` | 7. verification | 687 |
| `openforge-research-non-yaml-ci-round2.md` | 8. verification | 542 |

### Index
| File | Purpose |
|---|---|
| `openforge-research-index.md` | Round-1 index with decision-ready synthesis |
| `openforge-round1-vs-round2-cross-reference.md` | This file — Round 1 vs Round 2 delta |

---

## Decision inputs (consolidated, ready to ship)

### Q1: Do we fork act_runner, adopt act, or build from scratch?

**Answer: Hybrid — own TypeScript controller speaking a forked ConnectRPC task queue + act's executor either ported or run as a Go sidecar.**

**Why:**
- The protocol core (ConnectRPC + protobuf) is small and stable. The **Gitea baseline is only 5+1 RPCs** (Register, Declare, FetchTask, UpdateTask, UpdateLog, Ping). Forgejo added 2 (FetchSingleTask, UpdateStepSummary) plus `task_capacity`/`additional_tasks` for batch fetch.
- The executor (act's step lifecycle, expression evaluator via actionlint, action cache, container backends, reusables/composites) is the hard 80%.
- Running act as a Go sidecar behind a TS controller is the lowest-cost, highest-leverage path.
- The runner's repo-side fork (Forgejo v13.2.1 at SHA `c4a92ffa5e3a400ae7e9c40a2914e649eb338ad7`) is itself a workable starting point — but you must re-implement the controller in TS (Postgres + connect-web) because Go is not your stack.
- **Plugin gRPC contract is MIT-licensed** (deliberately so). You can borrow the 7-RPC `BackendPlugin` interface (Capabilities/Create/Start/Exec/CopyIn/CopyOut/Remove) without inheriting GPL-3.0.

### Q2: What's the container sandboxing tiering?

**Answer:**
- **Default:** Rootless Docker / crun / Podman with AppArmor. Sufficient for trusted internal workloads.
- **Untrusted-PR tier:** gVisor (95% kernel CVE defense, zero CPU overhead, 20-25MB fixed cost). Strongest non-VM isolation available.
- **High-security tier:** Firecracker microVM (125ms boot, 5MiB overhead, 25 Gbps network, only 2 CVEs in 2026). Solve rootfs management via overlay/OCI-style base images + per-job overlay.
- **Avoid:** Kata + Dragonball (5+ critical virtio-fs CVEs in 2026). Sysbox for non-CI system-container use only.

### Q3: YAML or non-YAML CI format?

**Answer: Ship YAML, GitHub Actions-compatible. (`.github/workflows/*.yml`).**

**Why:** Every successful self-hosted Git platform uses file-based YAML. The two non-file systems (Phabricator Harbormaster, Bamboo) both died. OneDev's GUI+YAML hybrid is the closest analog but its "proprietary format" is its #1 user complaint. Dagger 1.0 (Oct 2026) proves non-YAML works only as standalone CI, not embedded in a forge.

### Q4: What's the threat model?

**Answer:** 10 trust problems covered by 3 invariants:
1. Low-trust code never executes in a high-trust context (problems 1, 4, 6)
2. No high-value state outlives the job that needed it (problems 3, 10, credential half of 8)
3. No mutable reference is ever the unit of trust (problems 2, 5, 9)

**Differentiation vs GitHub:** log cache writes, token mints, and run deletions as **auditable events** (creating run + actor + commit). GitHub doesn't expose this. Self-hosted can.

### Q5: What's the GitHub Actions compatibility contract?

**Answer (Round-2 expanded):**

**Must reimplement faithfully:**
- Workflow schema (`workflow-v1.0`) — all keywords + `workflow_call` reusables + matrix `include`/`exclude`
- Expression grammar with precedence + JS-Number() type coercion
- All 12 contexts + per-keyword context-availability matrix (security)
- Runtime env contract: `GITHUB_*`, `RUNNER_*`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL`, `ACTIONS_RESULTS_URL`
- Workflow-command files: `$GITHUB_OUTPUT`, `$GITHUB_ENV`, `$GITHUB_PATH`, `$GITHUB_STATE`, `$GITHUB_STEP_SUMMARY`, **`$GITHUB_ARTIFACTS` (NEW, Round-2)**, plus legacy `echo "::set-output"`
- `$ACTIONS_CACHE_MODE` env var (NEW, Round-2)
- actions/checkout (incl. PR merge-ref, lfs, submodules)
- actions/cache (exact `cache-hit` semantics, prefix+version+branch scoping, tar+gzip/zstd)
- actions/upload-artifact v4 (ZIP+zlib level 6, immutable, 90-day retention) + merge sub-action
- actions/download-artifact + cross-run `run-id` download
- actions/setup-* via RUNNER_TOOL_CACHE convention
- actions/github-script via Octokit-compatible REST+GraphQL API + context

**Can deliberately diverge (document, don't hide):**
- Cache backend wire format (v1 `_apis/artifactcache` for compat with actions/cache@v3, or v2 Twirp+signed-URL for v4+)
- Cache version hash (your own scheme if you don't want byte-compat with GHA)
- Eviction policy (your caps, not GitHub's 10GiB/1-week)
- GitHub-specific supply-chain / OIDC / SLSA provenance / attestation features

**Highest-risk compat items to validate before shipping:**
1. PR merge-ref checkout
2. Context-availability enforcement (security)
3. `cache-hit` exact-match + benign-race semantics
4. Artifact immutability + merge
5. `workflow_run` cross-run artifact path
