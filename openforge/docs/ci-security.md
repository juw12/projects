# CI Sandbox Security

> OpenForge's CI runner security model. This document is the **source of
> truth** for why we sandbox the way we do. Every Phase that touches the
> runner MUST update this document if the threat model changes.

**Status:** Phase 1 — initial deployment, gVisor default.
**Owners:** Platform team.
**Review cadence:** quarterly, plus on every CVE in the runner stack.

---

## 1. Threat model

### What we defend against

| Adversary | Capability | Attack they might try |
|---|---|---|
| **Malicious PR author (fork)** | Pushes code that runs in a job | Read the runner host filesystem; pivot to other tenants; exfiltrate `RUNNER_TOKEN`; persist a backdoor in the runner image |
| **Malicious dependency** (npm postinstall, pip wheel) | Runs arbitrary code at install time | Same as above |
| **Compromised workflow definition** | Defines custom build steps | Read other jobs' env vars; persist across jobs |
| **Co-tenant on shared infra** | Runs jobs in the same pool | Side-channel through `/proc`, shared kernel state, network |
| **Network adversary on the host network** | Sniffs, spoofs | Hijack package downloads; MITM API callbacks |

### What we explicitly do NOT (yet) defend against

These are accepted risks for Phase 1; mitigations are Phase 2 work.

1. **Malicious dependencies in the user's own repo.** That's npm-audit /
   pip-audit's job. We sandbox the *runtime*, not the *supply chain*.
2. **Secrets in cleartext inside workflow files.** Static detection lands
   in Phase 2 (regex + entropy scoring on commit contents).
3. **DNS-based exfiltration** from `--network=restricted` jobs. Phase 2
   enforces the egress allowlist at the iptables level (not just
   `--network=none`).
4. **A kernel 0-day in the host running runsc.** Out of scope — patch fast,
   eat the exposure. runsc reduces the attack surface ~10× but cannot
   eliminate kernel bugs.
5. **Side-channels via CPU caches, Spectre/Meltdown class.** Mitigated
   by host kernel config (separate concern).

---

## 2. Why gVisor (and not Docker / Kata / Firecracker)

The reference incident is **Chia Network's self-hosted runner compromise
(March 2023)**: a malicious workflow definition escaped a vanilla Docker
container and obtained a shell on the runner host. Chia used GitHub
Actions-style runners with no userspace sandbox.

### Comparison

| Option | Isolation mechanism | Startup | Attack surface | Verdict |
|---|---|---|---|---|
| **Plain Docker** | Namespaces + cgroups | <100 ms | **Full host kernel** — any kernel CVE = container root = host root | **REJECTED** |
| **gVisor (`runsc`)** | Intercepts ~70% of syscalls in userspace; only ~20 reach the host kernel | ~10 ms | Small (rewritten syscall layer) | **DEFAULT** |
| **Kata Containers** | Separate lightweight VM (QEMU/cloud-hypervisor) | ~1 s | Full guest kernel, but isolated | High-security tenants (Phase 2) |
| **Firecracker** | microVM (KVM-backed) | ~125 ms | Smallest (minimal guest kernel) | Reserved for untrusted-multi-tenant SaaS (not our shape) |

### Why gVisor wins for us

1. **Startup latency.** ~10 ms vs ~1 s for Kata. CI jobs are latency-
   sensitive; the per-job overhead matters at thousands of jobs/day.
2. **No KVM requirement.** Runs in any Docker host. Kata/Firecracker need
   nested virtualization in cloud VMs (Azure Dv5, AWS metal).
3. **Sufficient for our threat model.** We are not defending against a
   nation-state; we are defending against a fork PR author. gVisor
   blocks the realistic escapes (CLONE_NEWUSER, ptrace, bpf, mount) by
   *never passing those syscalls to the host kernel at all*.
4. **Phase 2 escape hatch.** For high-security tenants (regulated
   industries), we can swap in Kata per-pool — same Docker CLI, just a
   different `--runtime`.

### When we WOULD switch to Kata

- Compliance mandate (SOC2 Type II auditor requires VM-level isolation)
- Defense against a kernel 0-day disclosed in runsc's syscall whitelist
- Tenant opts in to "high security" tier with the corresponding pricing

---

## 3. Sandbox configuration

Every job container is launched with:

```
docker run \
  --runtime=runsc \
  --read-only \
  --tmpfs /tmp:size=512m \
  --tmpfs /workspace:size=<derived>m \
  --network=none \                      # default; 'restricted'/'open' require repo policy
  --memory=<job.memoryLimitMb>m \       # default 2048, max 8192
  --cpus=<job.cpuLimit> \               # default 1.0, max 4.0
  --pids-limit=256 \
  --security-opt seccomp=/etc/openforge/seccomp-runsc.json \
  --security-opt no-new-privileges \
  --cap-drop=ALL \
  --user 1000:1000 \
  --env <explicitly requested secrets only> \
  openforge/runner-job:latest
```

### Why each flag matters

| Flag | Why |
|---|---|
| `--runtime=runsc` | The whole point. Without this we are raw Docker. |
| `--read-only` | Container rootfs is immutable. No `wget ... && chmod +x` to escape. |
| `--tmpfs /tmp:512m` | Two writable surfaces only; both in RAM, both bounded. |
| `--tmpfs /workspace:<N>m` | Source code is *copied* into this; never bind-mounted. |
| `--network=none` | Default. No `curl evil.com`. `restricted`/`open` add explicit allowlists (Phase 2). |
| `--memory=...` | OOM is a known-bad outcome; bound it. |
| `--cpus=...` | CPU starvation of co-tenants is a DoS vector. |
| `--pids-limit=256` | Fork bomb mitigation. |
| `--security-opt seccomp=...` | Belt-and-suspenders on top of runsc. |
| `--security-opt no-new-privileges` | Disallow suid binaries from acquiring new privs. |
| `--cap-drop=ALL` | Linux capabilities are unused; drop everything. |
| `--user 1000:1000` | Job code never runs as root, even inside the sandbox. |

### Secret handling

- Secrets are passed **only as environment variables** to the job
  container. Never as files. Never as bind mounts.
- The runner daemon receives the secret value from the API over the
  `--secret` channel (which is a separate request authenticated by the
  job-scoped `requestToken`, not the long-lived runner token).
- The secret exists in the runner daemon's process memory for the
  duration of the job (typically seconds to minutes) and is then
  dropped when the container exits and the daemon's env is reset.
- The secret is **never logged**. The runner's pino redact list MUST
  include any env-var name the API returns under `job.requestedSecrets`.

### Filesystem rules

- **No host bind mounts inside the job container.** The runner copies
  the source tree into the tmpfs workspace; it does not mount the host
  path.
- **The only writable mounts** are `/workspace` and `/tmp`, both tmpfs.
- The runner daemon's own filesystem is NOT visible to the job
  container — they are separate containers, separate filesystems.

### Network rules

- Default is `--network=none`. The job cannot reach the internet,
  cannot reach other jobs, cannot reach the API.
- A job may request `requestedNetwork: 'restricted' | 'open'`. The API
  verifies the *repo's* policy allows this before assigning the job to
  a runner. The runner, in turn, applies an iptables egress allowlist
  inside the runsc netns (Phase 2 work; Phase 1 logs and rejects any
  non-`none` request as a configuration error).
- DNS resolution is disabled by default. `restricted` jobs get the
  resolver IP and a `--dns-search` allowlist (Phase 2).

---

## 4. Runner daemon security

The runner daemon is the *control plane*; the job container is the
*untrusted workload*. They have different security postures.

| Aspect | Runner daemon | Job container |
|---|---|---|
| Runs as | root (must — needs Docker socket) | UID 1000 (non-root) |
| Sandbox | none (privileged container) | gVisor (runsc) |
| Network | API only | none (or restricted) |
| Long-lived secrets | `RUNNER_TOKEN` (1h TTL, rotated) | none |
| Filesystem | persistent | ephemeral (tmpfs) |
| Trust level | **trusted** | **untrusted** |

The runner daemon runs in a Docker-in-Docker setup:

```
┌─────────────────────────────────────────┐
│ Host kernel (Linux)                     │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │ Runner container (privileged)   │   │
│  │ ┌──────────────────────────────┐ │   │
│  │ │ Inner dockerd (root)         │ │   │
│  │ │   └── runsc runtime          │ │   │
│  │ │       └── JOB CONTAINER      │ │   │
│  │ │           (runsc sandbox)    │ │   │
│  │ │           UID 1000           │ │   │
│  │ │           /workspace (tmpfs) │ │   │
│  │ │           no network         │ │   │
│  │ └──────────────────────────────┘ │   │
│  │ Runner daemon (UID 1001)        │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

The job's escape has to climb **two boundaries** to reach the host:
1. Escape runsc's userspace kernel (very small attack surface).
2. Escape the inner dockerd (requires root inside the inner dockerd,
   which job containers do NOT have).

---

## 5. Token lifecycle

```
   ┌─────────────────────────────────────────────────────────┐
   │              Bootstrap (long-lived, 30d TTL)            │
   │              RUNNER_TOKEN env var, generated at         │
   │              deployment time: `openssl rand -hex 32`     │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Registration                               │
   │   POST /api/runners/register                            │
   │     Bearer: <RUNNER_TOKEN>                              │
   │     → { runnerId, token (1h TTL), tokenExpiresAt }      │
   └─────────────────────────────────────────────────────────┘
                              │
                              ▼ (every 30s)
   ┌─────────────────────────────────────────────────────────┐
   │              Heartbeat                                  │
   │   POST /api/runners/{id}/heartbeat                      │
   │     Bearer: <current token>                             │
   │     → { token (fresh 1h TTL) }                          │
   └─────────────────────────────────────────────────────────┘
```

- The bootstrap token is **only** used for the first registration.
  After that, the daemon never sees it again.
- The short-lived token expires 1 hour after issuance. Heartbeats every
  30s keep it fresh.
- A leaked short-lived token gives an attacker ≤ 30s of usable access
  before the next heartbeat rotates it out, plus ≤ 1h absolute TTL.
- A leaked bootstrap token gives ≤ 30 days of access — rotate
  immediately on suspected compromise; the API supports
  `POST /api/runners/{id}/rotate-token` for emergency rotation.

---

## 6. Audit trail

Every action is logged to **stdout** (the runner container's docker
log) and mirrored to S3 in Phase 2 for immutable retention.

| Event | Log line |
|---|---|
| Runner start | `[audit] runner_start name=... labels=...` |
| Runner stop | `[audit] runner_stop signal=...` |
| Job start | `[audit] job_start jobId=... repoId=... commit=... limits=...` |
| Job finish | `[audit] job_finish jobId=... exitCode=... oomKilled=... wallClockMs=...` |
| OOM kill | `[audit] oom_kill jobId=... memoryLimitMb=...` |
| Heartbeat failure | `[runner] heartbeat error ...` (warn-level, not audit) |
| Secret access | `[audit] secret_access jobId=... name=... scope=...` (name only, NEVER value) |

The pino redact list MUST include: `token`, `secret`, `password`,
`authorization`, `cookie`, `requestToken`, `apiKey`, `bearer`.

---

## 7. Compliance notes

### SOC2 (Type II — planned target)

- **CC6.1** Logical access controls: token rotation, secret scoping.
- **CC6.6** Network controls: `--network=none` default, egress allowlist.
- **CC7.2** Detection of security events: audit log to S3 (Phase 2).
- **CC8.1** Change management: pinned versions in the runner Dockerfile
  (RUNSC_VERSION, BUN_VERSION, DOCKER_VERSION).

### ISO 27001

- **A.12.1.3** Capacity management: per-job resource limits.
- **A.14.2.1** Secure development: ephemeral sandboxes, no shared state.
- **A.18.1.3** Records protection: audit trail in S3 with object lock
  (Phase 2).

### What a SOC2 auditor will ask, and the answer

- "How do you isolate untrusted code?" → gVisor (runsc) userspace kernel.
- "How do you ensure secrets aren't persisted?" → env vars only, no file
  mounts, tmpfs workspace, container destroyed at job end.
- "How do you detect sandbox bypass attempts?" → runsc logs every
  blocked syscall; mirrored to S3 (Phase 2).
- "How do you rotate credentials?" → 1h TTL tokens, 30s heartbeat.
- "What's your blast radius if a runner host is compromised?" → the
  inner dockerd is a single tenant; the host sees only the runner
  container, which has only one persistent secret (RUNNER_TOKEN).
  Pivot requires breaching the host kernel.

---

## 8. Operational checks

```bash
# From repo root
make -C infra security-audit        # runsc registered?
make -C infra security-audit-full   # runsc + seccomp + oom policy present?
make -C infra runner-logs           # tail the runner log
```

If `security-audit` fails, **do not run jobs** until it passes. The
daemon refuses to launch job containers when runsc is missing (see
`entrypoint.sh:verify_gvisor`).

---

## 9. References

- gVisor: <https://gvisor.dev/docs/>
- Docker seccomp profiles: <https://docs.docker.com/engine/security/seccomp/>
- Chia Network runner compromise post-mortem (March 2023) — internal
- NIST SP 800-190 (Application Container Security)
- CIS Docker Benchmark v1.6
