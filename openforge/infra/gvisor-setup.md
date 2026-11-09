# gVisor setup for OpenForge CI runners

This document covers installing and configuring gVisor's `runsc` runtime on Linux hosts that will run OpenForge CI runners. gVisor provides a userspace application kernel that intercepts syscalls before they reach the host kernel, dramatically reducing the attack surface for untrusted code execution.

## Why gVisor

From the architecture memo (Top Risk #1):

> Chia Network's self-hosted runner compromise (Aug 2023) was the canonical example. A forked PR ran arbitrary code on Chia's self-hosted runners, stole signing certificates, and persisted for 3+ days before detection. The mitigation: run untrusted code in ephemeral, sandboxed environments with no persistent state and short-lived job-scoped tokens injected only into the runner process — never baked into the image.

Raw Docker is **not** a security boundary. A kernel exploit from inside the container gives the attacker host root. gVisor sits between the container and the host kernel, intercepting every syscall and reimplementing a subset of Linux in Go. The attack surface to the real kernel is small and well-defined.

**Alternatives:**
- **Kata Containers** — heavier (separate VM per container), slower startup (~1s), strongest isolation. Choose for high-security tenants.
- **Firecracker** — microVM, lowest attack surface, requires KVM, slower startup (~125ms). Best for multi-tenant serverless but heavier than gVisor for steady-state CI.
- **gVisor (`runsc`)** — ~10ms startup, very small attack surface, single host kernel, no KVM requirement. **Default for OpenForge.**

## Installation

### Ubuntu / Debian

```bash
# Install prerequisites
apt-get update && apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg

# Add gVisor repository
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://gvisor.dev/apt stable main" > /etc/apt/sources.list.d/gvisor.list

# Install
apt-get update && apt-get install -y runsc
```

### Manual binary install (any distro)

```bash
# Get the latest release
RUNSC_VERSION=$(curl -fsSL https://api.github.com/repos/google/gvisor/releases/latest | grep tag_name | cut -d'"' -f4)
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -fsSL "https://github.com/google/gvisor/releases/download/${RUNSC_VERSION}/runsc-${RUNSC_VERSION}-linux-${ARCH}" \
  -o /usr/local/bin/runsc
chmod +x /usr/local/bin/runsc
runsc --version
```

## Configure Docker

Edit `/etc/docker/daemon.json`:

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  },
  "default-runtime": "runsc"
}
```

Restart Docker:

```bash
systemctl restart docker
```

**`default-runtime: "runsc"` is critical.** Without it, `--runtime=runsc` must be specified on every `docker run`. The OpenForge infra assumes the default runtime IS runsc.

## Configure containerd (if used directly)

For Kubernetes-based deployments, configure containerd:

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.runtime.v2.linux"]
  runtime_type = "io.containerd.runc.v2"

[plugins."io.containerd.runtime.v2.linux".runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
  pod_annotations = ["*"]
```

## Verification

Three tests to confirm gVisor is actually being used:

### Test 1: The basic invocation

```bash
docker run --rm --runtime=runsc alpine uname -a
# Should print: Linux <hash> 5.x.x ...
```

### Test 2: Confirm seccomp is enforced

```bash
docker run --rm --runtime=runsc alpine sh -c 'cat /proc/self/status | grep -E "^Seccomp"'
# Should print: Seccomp:	2    (means "filtered" — syscalls are intercepted)
```

If you see `Seccomp: 0` (disabled) or `Seccomp: 1` (strict — broken), something is wrong. Don't ship.

### Test 3: The can't-read-host-net test

```bash
docker run --rm --runtime=runsc --network=none alpine sh -c 'cat /proc/net/tcp'
# Should fail or return empty (runsc intercepts /proc)
```

If the host's network info leaks, runsc isn't properly intercepting. Re-check the daemon.json.

## Performance tuning

By default gVisor has higher syscall overhead than runc. For CI workloads, two tuning knobs help:

```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": [
        "--platform=systrap",     // faster than ptrace on modern kernels
        "--network=sandbox",      // use gVisor's network stack (more isolation)
        "--debug-log-dir=/var/log/runsc",
        "--debug=false"
      ]
    }
  }
}
```

`--platform=systrap` is ~5× faster than the default ptrace but requires kernel 4.11+ and KVM. Verify with `cat /proc/cpuinfo | grep -c vmx` or `grep -c svm` to confirm virtualization extensions.

## Operational notes

- **Disk pressure**: `runsc` does not log aggressively by default, but if you enable `--debug-log-dir`, rotate logs (1 GB max).
- **Memory accounting**: gVisor charges container memory against the host's cgroup limits correctly. Verify with `docker stats` after a CI job.
- **Image compatibility**: gVisor supports standard OCI images. Alpine, Debian, Ubuntu, Distroless all work. Don't use scratch images unless you know the binary's syscall footprint is in gVisor's allowed set.
- **Known escape CVEs**: gVisor has had real CVEs (CVE-2024-21626 was a containerd integration leak that bypassed the sandbox). Defense in depth matters — pair gVisor with seccomp + non-root + read-only fs + no-new-privileges.

## When to use Kata instead

If you're serving a regulated tenant (financial services, healthcare, government) and they require VM-level isolation, deploy Kata Containers alongside runsc and route those tenants to Kata. The infra config supports this via Docker runtime selection per-job (the runner reads the requested runtime from the job metadata).

## References

- gVisor docs: <https://gvisor.dev/docs/>
- runsc install: <https://gvisor.dev/docs/user_guide/install/>
- Performance tuning: <https://gvisor.dev/docs/user_guide/performance/>
- Chia Network postmortem (the why): <https://github.com/Chia-Network/post-mortem/blob/main/2023-08/2023-08-04-compromised-self-hosted-runners.md>
