# Defense-in-depth hardening for CI runners

Even with gVisor deployed, layered defenses are non-negotiable. Each layer mitigates a different threat:

| Layer | Mitigates |
|---|---|
| **gVisor (`runsc`)** | Kernel exploits from inside container |
| **seccomp profile** | Syscalls gVisor doesn't intercept |
| **AppArmor / SELinux** | File access beyond seccomp's reach |
| **cgroup v2 limits** | Resource exhaustion (OOM, CPU starvation) |
| **Network policy** | Egress to internal services, exfiltration |
| **Read-only fs** | Persistence of malicious binaries between jobs |
| **Non-root UID** | Privilege escalation within container |
| **No-new-privileges** | setuid binaries gaining caps |
| **Auditd** | Forensic trail if something gets through |

## cgroup v2 limits

OpenForge runners set these defaults; override per-job via JobSpec.

```yaml
# /etc/systemd/system/openforge-runner.slice (systemd-based limits)
[Unit]
Description=OpenForge runner slice

[Slice]
CPUQuota=200%           # 2 cores max
MemoryMax=4G           # 4 GB hard limit (OOM kills)
MemorySwapMax=4G       # No swap (prevents swap-based leaks)
IOWeight=100
TasksMax=256
```

Docker automatically applies cgroup v2 limits when you pass `--memory=4g --cpus=2.0 --pids-limit=256`. Verify with:

```bash
docker run --rm --memory=4g --cpus=2.0 alpine sh -c 'cat /sys/fs/cgroup/memory.max'
# Should print: 4294967296
```

## seccomp profile

`runsc` enforces its own seccomp profile (more restrictive than Docker's default). You should ALSO supply a custom profile for additional defense:

```bash
docker run --security-opt seccomp=/path/to/seccomp-runsc.json ...
```

Reference: <https://docs.docker.com/engine/security/seccomp/>

The OpenForge `infra/runner/configs/seccomp-runsc.json` is a tightened version of Docker's default profile. Key changes:

- **Deny `ptrace`** — debug other processes
- **Deny `kexec_load`, `kexec_file_load`** — load arbitrary kernel
- **Deny `reboot`** — don't let containers reboot the host
- **Deny `mount`, `umount2`** — no filesystem manipulation (read-only fs is the primary control, this is backup)
- **Deny `clone` with `CLONE_NEWUSER`** — can't create new user namespaces
- **Deny `personality`** — can't change process execution domain

## AppArmor / SELinux

AppArmor (Debian/Ubuntu) profile:

```
#include <tunables/global>

/var/lib/openforge/runner/** rwk,
/dev/null rw,
/dev/zero rw,
/dev/random r,
/dev/urandom r,
/proc/self/status r,
/proc/self/maps r,
deny /etc/passwd r,
deny /etc/shadow r,
deny /root/** rwx,
deny /home/** rwx,
deny /var/log/** rwx,
deny /sys/** rwx,
```

SELinux (RHEL/Fedora): use the `container_t` type with MCS labels. Each container gets a unique label; lateral movement between containers is blocked.

## Network policy

### Egress allowlist (recommended)

The runner has NO internet egress by default. If a job needs to clone a repo, the orchestrator (api) fetches the repo and bundles it into the job payload — the runner container never makes outbound network calls.

For jobs that explicitly need egress (e.g., downloading dependencies), the orchestrator opens an iptables-managed egress allowlist:

```bash
# Allow egress to specific hosts only
iptables -A OUTPUT -d github.com -j ACCEPT
iptables -A OUTPUT -d registry.npmjs.org -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -j DROP   # default deny
```

This is NOT done at the runner level. It's done by the orchestrator's networking layer.

### Kubernetes NetworkPolicy (if applicable)

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: runner-egress
spec:
  podSelector:
    matchLabels:
      app: openforge-runner
  policyTypes:
    - Egress
  egress:
    # DNS only
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
    # API server (heartbeats, log streaming)
    - to:
        - podSelector:
            matchLabels:
              app: openforge-api
      ports:
        - port: 443
          protocol: TCP
```

## Read-only filesystem + tmpfs

The runner container runs with `--read-only --tmpfs /tmp:size=100M,uid=0,gid=0,mode=1777`. The only writable mount is `/tmp`. The repo source is copied in, not bind-mounted.

Why this matters: a malicious job can't drop a backdoor in `/usr/local/bin` and persist it for the next job. The container is destroyed on completion; even if a backdoor lands in `/tmp`, it's gone when the container exits.

## Non-root UID

Runner daemon: UID 65532 (`runner` user).

Jobs within the runner: even less privileged if possible. UID 65534 (`nobody`) for untrusted code execution.

## no-new-privileges

`--security-opt=no-new-privileges:true` prevents setuid binaries from gaining capabilities. This blocks a class of privilege escalation attacks where a low-priv process exploits a setuid binary.

## auditd rules

```bash
# /etc/audit/rules.d/openforge-runner.rules

# Watch the docker/containerd binaries
-w /usr/bin/docker -p wa -k openforge-runner
-w /usr/bin/containerd -p wa -k openforge-runner

# Watch the git binary (used in jobs)
-w /usr/bin/git -p wa -k openforge-runner

# Watch runner config and credentials
-w /etc/openforge/ -p wa -k openforge-runner
-w /var/lib/openforge/runner/ -p wa -k openforge-runner

# Watch sensitive host directories
-w /etc/passwd -p wa -k openforge-runner
-w /etc/shadow -p wa -k openforge-runner
-w /etc/sudoers -p wa -k openforge-runner
```

Audit log volume: ~10 MB/day for a moderately busy runner. Rotate daily.

## What we DON'T defend against (yet)

- **Malicious dependencies in the user's repo** — that's the user's problem (npm audit, dependabot, etc.)
- **Secrets in cleartext in workflow YAML** — Phase 2 adds detection (`${{ secrets.X }}` should never appear in logs)
- **DNS-based exfiltration** — Phase 2 adds DNS monitoring
- **Side-channel attacks** (Spectre, Rowhammer) — outside scope; assume the host kernel has mitigations

## Verification: the security audit checklist

Run this before going to production:

```bash
#!/bin/bash
# infra/runner/security-audit.sh

set -e

echo "=== OpenForge runner security audit ==="
echo

echo "[1] gVisor runtime registered"
docker info 2>/dev/null | grep -q "runsc" || (echo "FAIL: runsc not registered"; exit 1)
echo "OK"

echo "[2] No-new-privileges enforced by default"
docker info 2>/dev/null | grep -q "no-new-privileges" || echo "WARN: no-new-privileges not default; require explicit flag"
echo "OK"

echo "[3] Default runtime is runsc"
docker info 2>/dev/null | grep "Default Runtime" | grep -q "runsc" || (echo "FAIL: default runtime is not runsc"; exit 1)
echo "OK"

echo "[4] seccomp profile loaded"
test -f /etc/docker/seccomp-runsc.json || echo "WARN: no custom seccomp profile"
echo "OK"

echo "[5] auditd rules active"
auditctl -l | grep -q openforge-runner || echo "WARN: auditd rules not loaded"
echo "OK"

echo "=== Audit complete ==="
```

Add to CI; block deployments that fail any of these checks.

## References

- Docker security: <https://docs.docker.com/engine/security/>
- gVisor threat model: <https://gvisor.dev/docs/architecture/>
- Chia Network postmortem: <https://github.com/Chia-Network/post-mortem/blob/main/2023-08/2023-08-04-compromised-self-hosted-runners.md>
- Kubernetes NetworkPolicy: <https://kubernetes.io/docs/concepts/services-networking/network-policies/>
