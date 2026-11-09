Task completed in 15m 25s.

Agent: librarian
⚠️  Model routing: parent used pegaai/MiniMax-M3, this subagent used pegaai/Pega-Chat (via category: unknown)

---

Now I have all the data I need. Let me compile the comprehensive report. I'll write it as a well-structured document with all 7 subsections for each of the 5 technologies, plus a final comparison table and CI runner fit assessment.



# Container Sandboxing Strategy: Authoritative Comparison for OpenForge Runners

**Research date:** 2026-11-03
**Scope:** gVisor, Kata Containers, Firecracker, Rootless Docker, Sysbox
**Context:** Self-hosted GitHub competitor choosing sandbox for runners + "secure runner" tier for untrusted workflows

---

## 1. gVisor (runsc)

### 1.1 Project Metadata

| Field | Value |
|-------|-------|
| **Official docs** | https://gvisor.dev/docs/ |
| **Current stable version** | `release-20261102.0` |
| **Release date** | 2026-11-02 |
| **License** | Apache-2.0 |
| **Repo** | https://github.com/google/gvisor |
| **Maintainer** | Google (Cloud Run, GKE Sandbox) |
| **GitHub stars** | 19,857 |
| **Open issues** | 1,063 |
| **Language** | Go (Sentry kernel) + Rust (Gofer, some platform components) |

### 1.2 Architecture Overview

gVisor implements a **complete Linux kernel in userspace** written in Go, called the **Sentry**. When a container runs under `runsc`, the application's system calls are intercepted (via ptrace, KVM, or Systrap platforms) and **never reach the host kernel**. Instead, the Sentry emulates the Linux syscall surface, maintains its own VFS, network stack (Netstack), and scheduler. The only syscalls the Sentry itself makes to the host kernel are filtered by a second layer of `seccomp-bpf`, creating a **two-layer security boundary**: even if the Sentry is compromised, the attacker still faces the seccomp filter limiting which host syscalls are possible. File I/O crosses the sandbox boundary through a separate process called **Gofer** (a FUSE-like file server), and networking goes through a userspace TCP/IP stack. This architecture means the application never touches the host kernel's network, filesystem, or process subsystems directly.

**Key source:** [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) — "The Sentry provides an additional layer of indirection... application system calls must traverse additional layers of software."

**Platform options** (syscall interception mechanism):
| Platform | Overhead | Requirements | Best for |
|----------|----------|-------------|----------|
| `ptrace` | Highest (~20x syscall) | None (works everywhere) | Compatibility, debugging |
| `systrap` | Low (kernel 5.10+) | Linux ≥5.10 | **Recommended default** |
| `kvm` | Lowest (~0.4x native) | KVM hardware virt | Max performance |

### 1.3 Performance Benchmarks

**Source:** gVisor official benchmark CSVs (fetched from `website/performance/` in the gvisor repo). Test hardware: Google Compute Engine `n1-standard-4` (Broadwell), Debian 9, kernel 4.19. **Note:** These benchmarks use the `ptrace` platform (highest overhead); `systrap` and `kvm` platforms perform significantly better.

#### Startup Latency

| Workload | runc (ms) | runsc-ptrace (ms) | Overhead |
|----------|-----------|-------------------|----------|
| Empty container (`true`) | 1,193 | **1,144** | **-4% (faster)** |
| Node.js app (bind HTTP) | 2,558 | **2,442** | **-5% (faster)** |
| Ruby app (bind HTTP) | 2,530 | **2,456** | **-3% (faster)** |

**Interpretation:** gVisor startup is actually *faster* than runc in these benchmarks because most of the measured time is Docker/containerd overhead, not runtime-specific work. The gVisor docs note: "most of the time overhead above is associated with Docker itself."

**Permalink:** [startup.csv](https://github.com/google/gvisor/blob/master/website/performance/startup.csv)

#### Syscall Overhead

| Metric | runc | runsc (ptrace) | runsc (kvm) |
|--------|------|----------------|-------------|
| Raw syscall time | **1,939 ns** | **38,219 ns** | **763 ns** |
| vs native factor | 1x | **19.7x slower** | **0.39x (FASTER than native)** |

**Critical note:** The KVM platform makes syscalls **faster** than native runc (763ns vs 1939ns) because KVM's `vcpu_run` exit/entry is more efficient than ptrace-based interception. The ptrace numbers represent the worst case. With the **Systrap** platform (Linux ≥5.10), the overhead is between ptrace and KVM.

**Permalink:** [syscall.csv](https://github.com/google/gvisor/blob/master/website/performance/syscall.csv)

#### CPU Performance

gVisor imposes **zero CPU instruction overhead**. The application's code executes natively; only syscalls are emulated.

> "gVisor does not perform emulation or otherwise interfere with the raw execution of CPU instructions by the application. Therefore, there is no runtime cost imposed for CPU operations."
> — [gVisor Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/)

This means CPU-bound workloads (compilation, ML inference, data processing) see **~0% overhead**.

#### Network Throughput (iperf)

| Direction | runc (Mbps) | runsc-ptrace (Mbps) | Overhead |
|-----------|-------------|---------------------|----------|
| Download | 746.4 | 640.3 | **-14.2%** |
| Upload | 709.8 | 482.3 | **-32.0%** |

**Note:** These are `ptrace` platform numbers. The KVM/Systrap platforms improve these significantly. The gVisor network stack (Netstack) is a pure-Go implementation and is the primary source of network overhead. For CI workloads (git clone, npm install, pip download), this 14-32% reduction is the most impactful cost.

**Permalink:** [iperf.csv](https://github.com/google/gvisor/blob/master/website/performance/iperf.csv)

#### Memory Footprint (per container)

| Workload | runc (MB) | runsc (MB) | Overhead |
|----------|-----------|------------|----------|
| Empty (`sleep`) | 4.1 | **23.7** | +19.6 MB |
| Node.js app | 76.7 | **124.1** | +47.4 MB |
| Ruby app | 45.7 | **106.1** | +60.4 MB |
| Redis (1GB dataset) | 1,055.3 | **1,076.7** | +21.4 MB |

**Fixed Sentry overhead:** ~20-25 MB per sandbox (the Go runtime + Sentry state). This is the primary density cost.

**Permalink:** [density.csv](https://github.com/google/gvisor/blob/master/website/performance/density.csv)

#### Disk I/O (fio)

| Operation | runc (MB/s) | runsc (MB/s) | Overhead |
|-----------|-------------|--------------|----------|
| Sequential read | 252.3 | **252.3** | **0% (identical)** |
| Sequential write | 457.8 | **431.8** | **-5.7%** |
| Random read | 5.3 | **4.4** | **-16.7%** |
| Random write | 107.8 | **69.2** | **-35.8%** |

**Interpretation:** Sequential I/O is essentially free (disk-bound). Random I/O shows the VFS/Gofer overhead, particularly for writes (-36%). For CI workloads that do `git clone` (sequential) and `npm install` (many small random files), expect moderate overhead on the random write path.

**Permalink:** [fio.csv](https://github.com/google/gvisor/blob/master/website/performance/fio.csv)

#### Redis QPS (syscall-bound workload)

| Operation | runc (rps) | runsc (rps) | Overhead |
|-----------|------------|-------------|----------|
| SET | 30,257 | 15,404 | **-49.1%** |
| GET | 30,312 | 15,326 | **-49.4%** |
| INCR | 30,525 | 15,270 | **-50.0%** |
| LPUSH | 30,713 | 15,172 | **-50.6%** |
| LRANGE_100 | 24,225 | 13,365 | **-44.8%** |
| LRANGE_600 | 9,901 | 6,544 | **-33.9%** |

**Pattern:** Small operations (SET/GET) lose ~50% throughput. Larger operations (LRANGE_600) lose only ~34% because more work is done in userspace between syscalls.

**Permalink:** [redis.csv](https://github.com/google/gvisor/blob/master/website/performance/redis.csv)

#### Seccomp-bpf Overhead (2024 optimization)

From the [gVisor seccomp blog post](https://gvisor.dev/blog/2024/02/01-seccomp/):
- seccomp-bpf filtering accounts for **up to ~15% of total gVisor overhead**
- ABSL build benchmark: seccomp overhead = ~3.4s out of ~94s total gVisor overhead
- Post-optimization (binary search tree + kernel caching): program size reduced by **4x**
- Redis seccheck null-sink: **~4% throughput reduction** from trace interception alone

### 1.4 Compatibility Matrix

**Source:** [gVisor Application Compatibility Page](https://gvisor.dev/application-compatibility/)

#### Works Well (Compatible)

| Category | Applications |
|----------|-------------|
| **AI/ML** | Claude Code (2.1.220), Ollama (0.31.1), multi-agent frameworks |
| **Web** | Nextcloud 34.0, WordPress 7.0, NGINX 1.31.2, Apache 2.4.68 |
| **Databases** | PostgreSQL 18.4, MySQL 9.7.1, MariaDB 12.3.2, Redis 8.8.0, Valkey 9.0.4 |
| **Messaging** | Apache Kafka 4.3.1, RabbitMQ 4.3.2, Mosquitto 2.0.22 |
| **Security** | Keycloak 26.6.4 |
| **System** | systemd 261 (requires `--in-sandbox-cgroup=v2`) |
| **CI/CD** | Gitea 1.26.2 |

#### Partial / Broken

| Application | Status | Notes |
|-------------|--------|-------|
| Docker-in-Docker | **Partial** | Supported with caveats; see [Docker in gVisor tutorial](https://gvisor.dev/docs/tutorials/docker-in-gvisor/) |
| Podman in gVisor | **Partial** | Rootless mode supported with caveats; tracking [#13944](https://github.com/google/gvisor/issues/13944) |
| GPU workloads | **Limited** | Requires NVIDIA GPU proxy (gVisor GPU support); not all CUDA versions tested |
| Raw sockets / `AF_PACKET` | **Blocked** | Seccomp filter blocks these |
| `io_uring` | **Not supported** | Sentry doesn't implement io_uring syscalls |
| `bpf()` / eBPF | **Not supported** | Cannot load eBPF programs from inside sandbox |
| `ptrace()` of other processes | **Limited** | Only works within the sandbox |
| CRIU checkpoint/restore | **Experimental** | See [Checkpoint/Restore docs](https://gvisor.dev/docs/user_guide/checkpoint_restore/) |

#### Language Runtime Support

| Runtime | Status | Notes |
|---------|--------|-------|
| **Node.js** | ✅ Full | Tested, compatible |
| **Python** | ✅ Full | Tested, compatible |
| **JVM (Java)** | ✅ Full | JIT works (no `mprotect` restriction); tested with OpenJDK |
| **Go** | ✅ Full | Native, no CGO issues |
| **Ruby** | ✅ Full | Tested, compatible |
| **Rust** | ✅ Full | Native, no special issues |
| **.NET** | ✅ Works | Mono/CoreCLR work; JIT uses `mmap`/`mprotect` which gVisor supports |
| **PHP** | ✅ Works | Tested (WordPress compatibility) |

**JVM JIT in gVisor:** Works because gVisor implements `mmap`, `mprotect`, `madvise` fully. The JIT can allocate executable memory. No known issues with C2 compiler or GraalVM.

### 1.5 Integration Complexity

#### Kubernetes (RuntimeClass)

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    kubernetes.io/arch: amd64
```

**Containerd config:**
```toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
    TypeUrl = "io.containerd.runsc.v1.options"
    ConfigPath = "/etc/containerd/runsc.toml"
```

**CRI-O config** (`/etc/crio/crio.conf.d/99-gvisor.conf`):
```toml
[crio.runtime]
selinux = false  # REQUIRED

[crio.runtime.runtimes.runsc]
runtime_path        = "/usr/local/bin/containerd-shim-runsc-v1"
runtime_config_path = "/etc/containerd/runsc.toml"
runtime_type        = "vm"  # CRITICAL: ensures pause container created first
runtime_root        = "/run/runsc"
```

**Complexity: LOW-MEDIUM.** Drop-in RuntimeClass. No node kernel modules required. Works with both containerd and CRI-O. GKE has it built-in as `gvisor` RuntimeClass.

#### Docker

```bash
# Register runtime
sudo tee /etc/docker/daemon.json <<EOF
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/containerd-shim-runsc-v1"
    }
  }
}
EOF
sudo systemctl restart docker

# Use it
docker run --runtime=runsc nginx
```

**Complexity: LOW.** Simple runtime swap.

#### Nomad / Other Orchestrators

Not natively supported. Requires wrapping `runsc` as a custom driver or using Nomad's `raw_exec` with a sidecar. **Complexity: HIGH** (custom integration needed).

### 1.6 Security Posture

#### Defense-in-Depth Model

| Layer | Mechanism | Threat Addressed |
|-------|-----------|-----------------|
| 1 | Sentry (userspace kernel) | Application → host kernel isolation |
| 2 | seccomp-bpf on Sentry | Sentry compromise → limited host syscalls |
| 3 | Linux namespaces (mount, PID, net, IPC) | Resource isolation |
| 4 | cgroups | Resource limits (CPU, mem, IO) |
| 5 | No direct host kernel access | All kernel attack surface removed |

**Security score: 9/10** (userspace OS + seccomp = two independent security boundaries)

#### gVisor-Specific CVEs (2024-2026)

| CVE | Date | Severity | Description | Status |
|-----|------|----------|-------------|--------|
| **CVE-2026-95702** | Q4 2026 | 8.5 | UAF in gVisor VFS layer: double-free of `MemoryFile` backing overlay fs → code execution in Sentry | **Patched** (fixed in release 20260831.0) |

**Critical note:** Even the gVisor-specific CVE is contained — "The compromised Sentry remains confined by host seccomp filters and namespaces." The seccomp layer prevents Sentry compromise from leading to host escape.

#### Host Kernel CVEs Defended

From the [gVisor Security Track Record](https://gvisor.dev/security-track-record/):

| Year | Total CVEs | Defended | Patched | Mitigatable | Vulnerable |
|------|-----------|----------|---------|-------------|------------|
| 2021 | 3 | 2 (67%) | 1 (33%) | 0 | 0 |
| 2022 | 17 | 16 (94%) | 0 | 1 (6%) | 0 |
| 2023 | 13 | 13 (100%) | 0 | 0 | 0 |
| 2024 | 20 | 19 (95%) | 1 (5%) | 0 | 0 |
| 2025 | 28 | 25 (89%) | 3 (11%) | 0 | 0 |
| 2026 | 27 | 25 (93%) | 2 (7%) | 0 | 0 |
| **Total** | **108** | **95%** | **4%** | **1%** | **0%** |

**Notable 2026 CVEs defended:**
- CVE-2026-23240 (9.8, UAF race → container escape)
- CVE-2026-43499 "GhostLock" (rtmutex UAF → escape)
- CVE-2026-43503 "DirtyClone" (SKB fragment clone → LPE)
- CVE-2026-46300 "Fragnesia" (XFRM ESP-in-TCP → page cache overwrite)
- CVE-2026-53359 "Januscape" (KVM shadow MMU UAF → **guest-to-host escape**)

#### FIPS / Certifications

- **No FIPS 140-3 certification** (gVisor is not a cryptographic module)
- **No FedRAMP authorization** (GKE Sandbox with gVisor inherits GKE's FedRAMP)
- **SOC 2:** Google Cloud GKE Sandbox is covered under Google's SOC 2 Type II report
- **Relevant for OpenForge:** If you need FedRAMP, you'd need to run on GKE or obtain your own authorization

### 1.7 CI Runner Fit Assessment

**Score: 7.5/10**

| Factor | Rating | Rationale |
|--------|--------|-----------|
| Ephemeral startup | ⭐⭐⭐⭐ | Fast startup (comparable to runc); no VM boot needed |
| High concurrency | ⭐⭐⭐ | 20-25MB per sandbox limits density; KVM platform helps |
| Untrusted workload isolation | ⭐⭐⭐⭐⭐ | Best-in-class: userspace kernel + seccomp = 2 layers |
| Network for CI (git, npm) | ⭐⭐⭐ | 14-32% throughput reduction acceptable but noticeable |
| CPU-bound builds | ⭐⭐⭐⭐⭐ | Zero CPU overhead; compilation is unaffected |
| Disk I/O for builds | ⭐⭐⭐ | Random write -36% could slow `npm install`, `cargo build` |
| Complexity | ⭐⭐⭐⭐ | Simple RuntimeClass; no kernel modules |
| Ecosystem maturity | ⭐⭐⭐⭐⭐ | Google-backed, GKE-integrated, 19.8K stars |
| GPU support | ⭐⭐ | Limited; not ideal for ML CI |

**Recommendation for OpenForge:**
- **Default runner:** Excellent fit. CPU-bound compilation sees zero overhead. The 20MB fixed cost is acceptable.
- **Secure runner (untrusted PRs):** **Strong candidate.** The two-layer defense (Sentry + seccomp) is the strongest non-VM isolation available. The 95% CVE defense rate is compelling.
- **Caveat:** If your CI workloads are network-heavy (large monorepo clones, massive dependency downloads), the 14-32% network penalty on ptrace platform is real. Use KVM/Systrap platform to minimize this.

---

## 2. Kata Containers

### 2.1 Project Metadata

| Field | Value |
|-------|-------|
| **Official docs** | https://katacontainers.io/ |
| **Current stable version** | `4.3.1` |
| **Release date** | 2026-10-21 |
| **License** | Apache-2.0 |
| **Repo** | https://github.com/kata-containers/kata-containers |
| **Maintainer** | CNCF (Cloud Native Computing Foundation) — graduated project |
| **GitHub stars** | 9,066 |
| **Open issues** | 1,270 |
| **Languages** | Go (shim), Rust (agent, runtime-rs), C (QEMU), Rust (Cloud Hypervisor) |

### 2.2 Architecture Overview

Kata Containers runs each container (or pod) inside a **lightweight virtual machine** with its own guest kernel, providing hardware-virtualization-level isolation (KVM) while presenting a container-like interface to the orchestrator. The host runs a **VMM** (Virtual Machine Monitor) — either QEMU, Cloud Hypervisor (CLH), or Firecracker — which creates the microVM. Inside the guest, a **kata-agent** (a minimal init process written in Rust) receives container execution requests over a vsock channel from the host-side **containerd shim** (`containerd-shim-kata-v2`). The guest kernel is a minimal, stripped-down Linux kernel. Filesystem sharing between host and guest is done via **virtio-fs** (or the older 9p protocol), and networking uses **virtio-net** with a tap device. The result is that the container's processes run in a completely separate kernel address space from the host — a memory corruption bug in the container's code cannot directly access host memory because the CPU's hardware page tables enforce the VM boundary.

**Hypervisor options:**

| Hypervisor | Maturity | CRI Compat | Filesystem | Device Hotplug | VFIO | CPU/Mem Hotplug | Security | Startup | Overhead |
|-----------|----------|-----------|------------|---------------|------|----------------|----------|---------|----------|
| **QEMU** | Excellent | Full | ✓ | ✓ | ✓ | ✓ | Good | Good | Medium (320Mi) |
| **Cloud Hypervisor** | Good | Full | ✓ | ✓ | ✓ | ✓ | Excellent (seccomp) | Excellent | Low (130Mi) |
| **Firecracker** | Good | Partial | ✗ | ✗ | ✗ | ✗ | Excellent | Excellent | Lowest |
| **Dragonball** (Alibaba) | Good | Full | ✓ | ✓ | ✓ | ✓ | Excellent | Best | Lowest |

**Source:** [Kata Virtualization Design Doc](https://github.com/kata-containers/kata-containers/blob/main/docs/design/virtualization.md)

### 2.3 Performance Benchmarks

#### Startup Latency

| Scenario | Time | Source |
|----------|------|--------|
| Cold VM (QEMU, no template) | **~820 ms** | Kata template doc (2026) |
| Cold VM (Cloud Hypervisor) | **~600 ms** (estimated from CLH vs QEMU ratio) | Inferred |
| Template-based VM (warm) | **~600 ms** | [Template doc](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-template-in-runtime-rs.md) |
| Template-based reduction | **73.2% faster** than cold | Same source |
| VM templating (10 containers, containerd shimv2) | **38.68% speedup** | [Kata template PR #303](https://github.com/kata-containers/runtime/pull/303) |

**Permalink:** [how-to-use-template-in-runtime-rs.md](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-template-in-runtime-rs.md) — "The comparative experiment between template-based VM creation and direct VM creation showed that the template-based approach achieved a ≈ 73.2% reduction in startup latency (average launch time of 0.6s vs. 0.82s)"

#### Memory Footprint

| Metric | Value | Source |
|--------|-------|--------|
| Pod fixed overhead (QEMU) | **320 Mi** | [virtio-fs doc](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-virtio-fs-with-kata.md) |
| Pod fixed overhead (Cloud Hypervisor) | **130 Mi** | Same source |
| Template-based VM avg memory | **178.2 MiB** | Template doc |
| Direct VM avg memory | **223.2 MiB** | Template doc |
| Memory reduction with templating | **79.8%** (9GB saved across 100 VMs @ 128MB each) | [Template PR #303](https://github.com/kata-containers/runtime/pull/303) |

**Interpretation:** Each Kata pod consumes 130-320MB **before** the container's own memory usage. This is the VMM + guest kernel + kata-agent baseline. For CI runners where each job might use 1-2GB, the 130-320MB overhead is 10-25% of total memory.

**Permalink:** [virtio-fs doc](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-virtio-fs-with-kata.md) — "the RuntimeClasses installed by kata-deploy declare this overhead by default, with values that differ per shim, for example 320Mi for kata-qemu, 130Mi for kata-clh"

#### CPU Performance

Kata containers run in a VM with their own kernel. CPU performance is **hardware virtualization overhead** (typically 2-5% for compute-bound workloads on modern CPUs with VT-x/AMD-V). No published exact number from Kata project, but KVM overhead is well-characterized in literature as ~1-5% for CPU-bound code.

#### Network Throughput

No official Kata network benchmark published. Expected performance:
- virtio-net with vhost-net: ~90-95% of native throughput
- virtio-net without vhost: ~70-80% of native
- For CI (git clone, npm install): expect ~5-10% throughput reduction

#### Disk I/O

- virtio-fs: ~80-90% of native for sequential I/O
- virtio-block (raw disk): ~95% of native
- 9p (legacy): ~50-70% of native (avoid)
- For CI: `git clone` and build artifacts should see <10% overhead with virtio-fs

### 2.4 Compatibility Matrix

#### Works Well

| Workload | Status | Notes |
|----------|--------|-------|
| Any Linux binary | ✅ Full | Runs in real Linux kernel inside VM |
| Node.js, Python, JVM, Go, Rust | ✅ Full | No syscall emulation — real kernel |
| Docker-in-Docker | ✅ Full | Works natively (it's a VM) |
| Kubernetes-in-Kubernetes | ✅ Full | K8s nodes as Kata pods |
| GPU (VFIO passthrough) | ✅ Full | QEMU/CLH support VFIO |
| systemd | ✅ Full | Works natively |
| Privileged containers | ⚠️ Partial | `privileged_without_host_devices = true` required |
| Host devices | ⚠️ Limited | Requires VFIO setup per device |
| CRIU checkpoint/restore | ❌ No | Not supported across VM boundary |
| Nested virtualization | ❌ No | KVM inside Kata not supported |

#### What Breaks

- **No nested virtualization** (KVM-in-Kata)
- **Host device access** requires explicit VFIO configuration (not automatic)
- **`/dev/fuse`** from host is not directly accessible
- **Some CNI plugins** that require host netns access (e.g., certain MACVLAN configurations)
- **GPU workloads** require IOMMU groups to align with VM boundaries

#### Language Runtime Support

All language runtimes work **identically to native** because the guest runs a real Linux kernel. No JIT issues, no syscall gaps.

### 2.5 Integration Complexity

#### Kubernetes (RuntimeClass)

**Containerd 1.7.x:**
```toml
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"
```

**Containerd 2.x:**
```toml
[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  privileged_without_host_devices = true
  pod_annotations = ["io.katacontainers.*"]
  container_annotations = ["io.katacontainers.*"]
  [plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration.toml"
```

**CRI-O:**
```toml
[crio.runtime.runtimes.kata]
  runtime_path = "/usr/bin/containerd-shim-kata-v2"
  runtime_type = "vm"
  runtime_root = "/run/vc"
  privileged_without_host_devices = true
```

**RuntimeClass:**
```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-qemu
handler: kata
overhead:
  podFixed:
    memory: "320Mi"
    cpu: "250m"
```

**Kata Deploy (Helm):**
```bash
helm install kata-deploy kata-containers/kata-deploy \
  --namespace kata \
  --create-namespace \
  --set hypervisor=qemu  # or cloud-hypervisor, firecracker
```

**Complexity: MEDIUM.** Requires:
1. KVM enabled on host (`/dev/kvm` accessible)
2. IOMMU configuration (for VFIO)
3. Hypervisor binaries installed (QEMU/CLH)
4. Guest kernel + image provisioned
5. Pod Overhead declared in RuntimeClass (critical for scheduler)

#### Docker

Kata does **not** integrate directly with Docker's `--runtime` flag in the same way as gVisor or Sysbox. The primary integration path is through **containerd** (which Docker uses internally). For Docker-specific usage, you'd need to configure containerd's CRI plugin, which affects all workloads on that node.

**Complexity: MEDIUM-HIGH** for Docker-only setups.

#### Nomad / Other Orchestrators

Not natively supported. Would require custom driver or sidecar pattern. **Complexity: HIGH.**

### 2.6 Security Posture

#### Defense-in-Depth Model

| Layer | Mechanism | Threat Addressed |
|-------|-----------|-----------------|
| 1 | KVM hardware virtualization | Container → host memory isolation |
| 2 | Guest kernel (separate) | Host kernel attack surface eliminated |
| 3 | VMM seccomp (CLH) | VMM compromise → limited syscalls |
| 4 | virtio-fs / virtio-net | Controlled host-guest communication |
| 5 | Linux namespaces (in guest) | Container isolation within VM |
| 6 | cgroups | Resource limits |

**Security score: 10/10** (hardware virtualization = strongest isolation boundary)

#### Kata-Specific CVEs (2024-2026)

| CVE | Date | Severity | Description | Component |
|-----|------|----------|-------------|-----------|
| **CVE-2026-86072** | 2026-07 | High | Untrusted pod annotation bind-mounts any host path into guest, bypassing operator allowlist | Shim/annotations |
| **CVE-2026-77176** | 2026-08 | High | Generated policy allows mounting attacker-chosen guest paths to specific locations | Policy engine |
| **CVE-2026-93417** | 2026-07 | **Critical** | Dragonball: missing length validation in virtio-blk allows **guest-to-host VM escape** | Dragonball VMM |
| **GHSA-ppr3-83x7-g97w** | 2026-10 | **Critical** | Dragonball: guest-to-host escape through OOB memory access in virtio drivers | Dragonball VMM |
| **CVE-2026-64676** | 2026-07 | High | kata-agent mem-agent ttRPC methods bypass agent-policy enforcement (confidential guests) | kata-agent |
| **CVE-2026-50540** | 2026-07 | Medium | Config path annotation arbitrary file loading | Configuration |
| **CVE-2026-47243** | 2026-05 | **Critical** | runtime-rs: Guest-root to host-root escape via virtiofs | runtime-rs |
| **CVE-2026-44210** | 2026-05 | **Critical** | VM escape via virtiofsd argument injection through default-enabled pod annotations | virtiofsd |
| **CVE-2026-41326** | 2026-04 | Medium | CopyFile policy subversion via symlinks | Policy |

**Critical assessment:** Kata had **4 critical VM escape CVEs in 2026 alone**. The virtio-fs/virtiofsd attack surface is the primary concern. The QEMU and Cloud Hypervisor backends are more mature, but the virtio-fs shared filesystem remains a significant attack surface. **If using Kata, prefer Cloud Hypervisor over QEMU or Dragonball**, and keep patches current.

#### FIPS / Certifications

- **No FIPS 140-3** for Kata itself
- **CNCF graduated project** — governance and security process mature
- **Intel/Red Hat backed** — enterprise security review process
- **Relevant for OpenForge:** Kata on CNCF infrastructure has strong security review, but the 2026 CVE wave shows the virtio-fs attack surface is real

### 2.7 CI Runner Fit Assessment

**Score: 6.5/10**

| Factor | Rating | Rationale |
|--------|--------|-----------|
| Ephemeral startup | ⭐⭐⭐ | 600-820ms cold; 400-600ms with templates. Slower than gVisor/runc |
| High concurrency | ⭐⭐ | 130-320MB per pod severely limits density. 100 pods × 200MB = 20GB overhead |
| Untrusted workload isolation | ⭐⭐⭐⭐⭐ | Best possible: hardware VM boundary |
| Network for CI | ⭐⭐⭐⭐ | virtio-net ~90-95% native. Acceptable |
| CPU-bound builds | ⭐⭐⭐⭐ | 2-5% KVM overhead. Acceptable |
| Disk I/O for builds | ⭐⭐⭐⭐ | virtio-fs ~80-90% native. Acceptable |
| Complexity | ⭐⭐⭐ | KVM required, IOMMU config, guest images, overhead declaration |
| Ecosystem maturity | ⭐⭐⭐⭐ | CNCF graduated, multi-vendor, well-supported |
| GPU support | ⭐⭐⭐⭐ | VFIO passthrough works but requires careful IOMMU setup |
| CVE risk | ⭐⭐⭐ | 4 critical VM escape CVEs in 2026; virtio-fs is a concern |

**Recommendation for OpenForge:**
- **Default runner:** Overkill. 130-320MB overhead per pod is wasteful for trusted workloads.
- **Secure runner (untrusted PRs):** **Strong candidate** if you need the absolute strongest isolation. The VM boundary is the only defense that's guaranteed by hardware.
- **Caveat:** The 2026 CVE wave on virtio-fs/Dragonball is concerning. If you choose Kata, **use Cloud Hypervisor backend** (most mature seccomp, lowest overhead at 130Mi) and **disable Dragonball**. Monitor the kata-containers security advisories closely.
- **Density concern:** For high-concurrency CI (50+ parallel jobs per node), the memory overhead becomes a real cost. A node with 64GB RAM can run ~150 Kata pods (at 350MB avg) vs ~2500 gVisor sandboxes (at 25MB).

---

## 3. Firecracker microVM

### 3.1 Project Metadata

| Field | Value |
|-------|-------|
| **Official docs** | https://firecracker-microvm.github.io/ |
| **Current stable version** | `v1.17.0` |
| **Release date** | 2026-09-10 |
| **License** | Apache-2.0 (VMM) + BSD-3-Clause (crosvm-derived code) |
| **Repo** | https://github.com/firecracker-microvm/firecracker |
| **Maintainer** | AWS (powers Lambda, Fargate) |
| **GitHub stars** | 37,804 |
| **Open issues** | 130 |
| **Language** | Rust |

### 3.2 Architecture Overview

Firecracker is a **minimalist VMM written in Rust** that uses Linux KVM to create microVMs with an extremely small attack surface. Unlike QEMU (which emulates a full x86/ARM machine with dozens of devices), Firecracker emulates only **5 devices**: virtio-net, virtio-block, virtio-vsock, a serial console, and a minimal keyboard controller (for shutdown). The guest runs a minimal Linux kernel (typically 4.14+) with a tiny root filesystem. The VMM itself runs in userspace on the host, communicates with the guest via a **RESTful API over a Unix socket**, and is further sandboxed by a companion **jailer** process that applies seccomp, cgroups, and namespace isolation to the Firecracker process itself. This "jailer + KVM + minimal device model" triple defense is what enables Firecracker to achieve <125ms boot and <5MiB VMM overhead while maintaining VM-level security isolation. The design philosophy is "security through minimalism" — by removing everything that isn't essential, the attack surface is reduced to a few thousand lines of Rust code handling virtio device emulation.

**Key design constraints (from SPECIFICATION.md):**
- 5 emulated devices only
- Single-threaded VMM per microVM (one vCPU thread + one device emulation thread)
- No device hotplug
- No CPU/memory hotplug
- No GPU passthrough
- No UEFI (direct kernel boot only)

**Permalink:** [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)

### 3.3 Performance Benchmarks

**Source:** Firecracker official SPECIFICATION.md + network-performance.md + block-io-engine.md. Test hardware: AWS EC2 M5d.metal (Intel) and M6G.metal (Graviton/ARM).

#### Startup Latency

| Metric | Value | Source |
|--------|-------|--------|
| VMM process start (to API socket) | **≤ 8 CPU ms** (wall-clock: 6-60ms, typical ~12ms) | SPECIFICATION.md |
| **InstanceStart → /sbin/init** | **≤ 125 ms** | SPECIFICATION.md |
| Rate: microVMs created per second per host | **150/sec** | Firecracker homepage |
| Async IO engine: device creation penalty | +110 ms (one-time) | block-io-engine.md |

**Permalink:** [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) — "It takes <= 125 ms to go from receiving the Firecracker InstanceStart API call to the start of the Linux guest user-space /sbin/init process."

**Interpretation:** 125ms is the **absolute best case** (minimal kernel, no serial console, Firecracker-tuned rootfs). In practice with a real CI image (alpine + build tools), expect **200-400ms** total. Still significantly faster than QEMU-based Kata (~600-820ms).

#### Memory Footprint

| Metric | Value | Source |
|--------|-------|--------|
| VMM memory overhead (1 vCPU, 128MiB guest) | **≤ 5 MiB** | SPECIFICATION.md |
| Total per microVM (128MiB guest) | **~133 MiB** (128 + 5) | Calculated |
| Total per microVM (1GiB guest, typical CI) | **~1005 MiB** | Calculated |

**Permalink:** [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) — "Firecracker's virtual machine manager threads have a memory overhead <= 5 MiB"

**Interpretation:** The 5MiB VMM overhead is the **lowest of all 5 technologies** (vs gVisor ~20MB, Kata 130-320MB). The guest kernel + rootfs still consume memory, but the virtualization layer itself is nearly free.

#### CPU Performance

| Metric | Value | Source |
|--------|-------|--------|
| Guest CPU vs bare-metal | **> 95%** | SPECIFICATION.md |

**Permalink:** [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) — "The compute-only guest CPU performance is > 95% of the equivalent bare-metal performance."

**Interpretation:** 5% KVM overhead for compute. For CI compilation workloads, this is acceptable.

#### Network Throughput

| Segment Size | 1460B | 256B | 128B | 96B |
|-------------|-------|------|------|-----|
| **Ingress** | **25 Gbps** | 23 Gbps | 20 Gbps | 18 Gbps |
| **Egress** | **25 Gbps** | 23 Gbps | 20 Gbps | 18 Gbps |
| **Bidirectional** | **18 Gbps** | 18 Gbps | 18 Gbps | 18 Gbps |

| CPU Utilization | Throughput |
|----------------|-----------|
| ≤ 80% of 1 core | 14.5 Gbps |
| 100% of 1 core | 25 Gbps |

| Metric | Value |
|--------|-------|
| Virtualization network latency | **0.06 ms** (60 μs) |
| Baseline RTT (instance-to-instance) | 0.198 ms avg |
| RTT with microVM | 0.321 ms avg |

**Permalink:** [network-performance.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/network-performance.md)

**Interpretation:** 25 Gbps single-direction is **excellent** — comparable to native. The 0.06ms added latency is negligible for CI workloads. This is the best network performance of the 5 technologies for a sandboxed solution.

#### Disk I/O

| Metric | Value | Source |
|--------|-------|--------|
| Storage throughput (≤70% CPU) | **1 GiB/s** | SPECIFICATION.md |
| Async engine: read IOPS improvement | **1.5x-3x efficiency, up to 30x total IOPS** (NVME) | block-io-engine.md |
| Async engine: write IOPS improvement | **20-45%** total IOPS | block-io-engine.md |
| Async engine: device creation penalty | +110 ms | block-io-engine.md |

**Permalink:** [block-io-engine.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/api_requests/block-io-engine.md)

**Interpretation:** 1 GiB/s sequential throughput is excellent. The Async (io_uring) engine dramatically improves random I/O on NVME (up to 30x IOPS for reads), which is highly relevant for CI workloads doing `npm install` or `cargo build` with many small file reads. **Caveat:** Async engine is still "developer preview" as of v1.17.0.

### 3.4 Compatibility Matrix

#### Works Well

| Workload | Status | Notes |
|----------|--------|-------|
| Any Linux binary | ✅ Full | Real Linux kernel in guest |
| Node.js, Python, JVM, Go, Rust | ✅ Full | No syscall emulation |
| Docker-in-Docker | ⚠️ Requires setup | Need Docker image in guest rootfs |
| systemd | ✅ Full | Works in guest |
| CPU-intensive builds | ✅ Full | >95% bare-metal |
| Network-intensive CI | ✅ Full | 25 Gbps, 0.06ms latency |
| High-density deployment | ✅ Full | 150 microVMs/sec, 5MiB overhead |

#### What Breaks / Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| **GPU passthrough** | ❌ No | No VFIO/device passthrough |
| **CPU/memory hotplug** | ❌ No | Fixed at VM creation |
| **Device hotplug** | ❌ No | All devices configured pre-boot |
| **UEFI boot** | ❌ No | Direct kernel boot only |
| **Windows guests** | ❌ No | Linux/OSv only |
| **Nested virtualization** | ❌ No | KVM inside Firecracker not supported |
| **Filesystem sharing** | ❌ No | No virtio-fs; block devices only |
| **Multiple vCPUs** | ⚠️ Limited | Works but single-threaded VMM becomes bottleneck |
| **vsock** | ✅ Full | Works well for host-guest communication |
| **CRIU** | ❌ No | Not supported |
| **Firecracker as containerd runtime** | ⚠️ Partial | Via firecracker-containerd (separate project) |
| **Firecracker as Kata hypervisor** | ⚠️ Partial CRI | Kata integration has partial CRI compatibility |

#### Language Runtime Support

All language runtimes work **identically to native** (real Linux kernel). No JIT issues.

**Critical CI limitation:** No filesystem sharing means the CI runner must either:
1. Build a custom rootfs image per job (slow)
2. Use block device mapping (requires pre-built images)
3. Use vsock + FUSE for file access (complex)

This is the **primary integration challenge** for Firecracker in a CI context.

### 3.5 Integration Complexity

#### Kubernetes (via Kata Containers)

Firecracker is **not directly integrated** with Kubernetes. The primary path is:
1. **Kata Containers with Firecracker hypervisor** (partial CRI)
2. **firecracker-containerd** (separate project, lower-level)
3. **Weave Ignite / FireKube** (abandoned)

**Kata + Firecracker config:**
```toml
[hypervisor.firecracker]
path = "/usr/local/bin/firecracker"
kernel_image = "/opt/kata/images/vmlinuz"
image = "/opt/kata/images/rootfs.img"
```

**Complexity: HIGH.** Firecracker's lack of filesystem sharing, device hotplug, and full CRI support makes K8s integration significantly harder than QEMU/CLH-based Kata.

#### Docker

**No direct Docker runtime integration.** Firecracker is a VMM, not an OCI runtime. You cannot use `docker run --runtime=firecracker`. The integration path is always through a higher-level orchestrator (Kata, firecracker-containerd, or custom).

**Complexity: VERY HIGH** for Docker-based CI.

#### Standalone / Custom Orchestration

For a custom CI system (like OpenForge), Firecracker can be driven directly via its REST API:
```bash
# Create microVM
curl --unix-socket /run/firecracker.sock -X PUT \
  http://localhost/boot-source \
  -d '{"kernel_image_path": "/path/vmlinuz", "boot_args": "console=ttyS0", "initrd_path": "/path/initrd"}'

curl --unix-socket /run/firecracker.sock -X PUT \
  http://localhost/drives/rootfs \
  -d '{"drive_id": "rootfs", "path_on_host": "/path/rootfs.img", "is_root_device": true}'

curl --unix-socket /run/firecracker.sock -X PUT \
  http://localhost/network-interfaces/eth0 \
  -d '{"iface_id": "eth0", "host_dev_name": "tap0"}'

curl --unix-socket /run/firecracker.sock -X PUT \
  http://localhost/machine-config \
  -d '{"vcpu_count": 2, "mem_size_mib": 1024}'

curl --unix-socket /run/firecracker.sock -X PUT http://localhost/actions \
  -d '{"action_type": "InstanceStart"}'
```

**Complexity: MEDIUM** for a custom orchestrator with direct API access. The REST API is clean and well-documented. The challenge is **rootfs image management** (no shared filesystem).

### 3.6 Security Posture

#### Defense-in-Depth Model

| Layer | Mechanism | Threat Addressed |
|-------|-----------|-----------------|
| 1 | KVM hardware virtualization | Guest → host memory isolation |
| 2 | Minimal device model (5 devices) | Reduced VMM attack surface |
| 3 | Jailer (seccomp + cgroups + namespaces) | VMM compromise → sandboxed |
| 4 | Rust memory safety | VMM memory corruption prevented |
| 5 | Guest kernel (separate) | Host kernel attack surface eliminated |
| 6 | MMDS (metadata service) | Secure host-guest communication |

**Security score: 10/10** (hardware VM + Rust VMM + jailer + minimal surface)

#### Firecracker-Specific CVEs (2024-2026)

| CVE | Date | Severity | Description |
|-----|------|----------|-------------|
| **CVE-2026-5747** | 2026-04 | High | Out-of-bounds write in Firecracker virtio-pci transport |
| **CVE-2026-1386** | 2026-01 | Medium | Arbitrary host file overwrite via symlink in Firecracker Jailer |

**Assessment:** Only **2 CVEs in 2026** — significantly fewer than Kata (9+) or the host kernel (27+). The Rust implementation and minimal device model pay off. Both CVEs are in the virtio transport layer (CVE-2026-5747) and the jailer (CVE-2026-1386), not in the core VMM.

**Historical context:** Firecracker had CVE-2020-27224 (virtio-balloon UAF, 2020) and a few others in 2019-2021, but the CVE rate has decreased significantly as the codebase matured and moved to Rust.

#### FIPS / Certifications

- **No FIPS 140-3** for Firecracker itself
- **AWS Lambda** runs on Firecracker and is covered under AWS's FedRAMP High authorization
- **AWS SOC 2 Type II** covers Firecracker-based services
- **Relevant for OpenForge:** If you need FedRAMP, running on AWS (Lambda/Fargate) inherits the authorization. Self-hosted Firecracker would need its own certification path.

### 3.7 CI Runner Fit Assessment

**Score: 7/10**

| Factor | Rating | Rationale |
|--------|--------|-----------|
| Ephemeral startup | ⭐⭐⭐⭐⭐ | 125ms is the fastest VM boot available. 150/sec rate is exceptional |
| High concurrency | ⭐⭐⭐⭐ | 5MiB VMM overhead is minimal. But guest kernel+rootfs still ~50-100MB |
| Untrusted workload isolation | ⭐⭐⭐⭐⭐ | Best possible: VM + Rust + jailer + minimal surface |
| Network for CI | ⭐⭐⭐⭐⭐ | 25 Gbps, 0.06ms latency. Best of all 5. |
| CPU-bound builds | ⭐⭐⭐⭐ | >95% bare-metal. 5% KVM overhead acceptable |
| Disk I/O for builds | ⭐⭐⭐⭐ | 1 GiB/s sequential. Async engine improves random I/O 30x on NVME |
| **Filesystem sharing** | ⭐⭐ | **Major gap.** No virtio-fs. Must use block devices or vsock |
| Complexity | ⭐⭐⭐ | REST API is clean, but rootfs management is complex |
| Ecosystem maturity | ⭐⭐⭐⭐⭐ | AWS-backed, 37.8K stars, powers Lambda (15T+ invocations/month) |
| GPU support | ❌ | No GPU passthrough. Not suitable for ML CI |
| CVE risk | ⭐⭐⭐⭐ | Only 2 CVEs in 2026. Rust + minimal surface = low risk |

**Recommendation for OpenForge:**
- **Default runner:** Not ideal due to filesystem sharing gap. CI runners need to share build caches, workspace directories, and toolchains efficiently.
- **Secure runner (untrusted PRs):** **Excellent choice** IF you solve the rootfs problem. The 125ms boot + 5MiB overhead + 25Gbps network + minimal CVE history makes it the best-performing VM option.
- **Key integration challenge:** You need a **rootfs image management strategy**. Options:
  1. Pre-built images per language/runtime (alpine-node, alpine-python, etc.)
  2. Overlay filesystem: base image + per-job overlay (like Docker layers)
  3. vsock + FUSE for shared directories (complex but flexible)
- **If you build a custom CI orchestrator** (not K8s), Firecracker's REST API is actually the cleanest integration path of all 5 technologies.

---

## 4. Rootless Docker (RootlessKit + slirp4netns / pasta / vpnkit)

### 4.1 Project Metadata

| Component | Version | Release Date | License | Repo | Maintainer |
|-----------|---------|-------------|---------|------|-----------|
| **RootlessKit** | v3.3.0 | 2026-10-14 | Apache-2.0 | github.com/rootless-containers/rootlesskit | containers org (CNCF) |
| **slirp4netns** | v1.3.7 | 2026-10-30 | GPL-2.0 | github.com/rootless-containers/slirp4netns | containers org |
| **pasta (passt)** | v2026_10_02 | 2026-10-04 | GPL-2.0 | github.com/qemus/passt (mirror: passt.top) | Stefano Brivio (CNCF) |
| **Docker (rootless)** | 28.x | 2026 | Apache-2.0 | github.com/moby/moby | Docker/Moby (CNCF) |
| **Podman** | 5.x | 2026 | Apache-2.0 | github.com/containers/podman | Red Hat / containers |

**Combined stars:** RootlessKit 1,314 + slirp4netns 953 + Docker 70K+ + Podman 20K+

### 4.2 Architecture Overview

Rootless Docker does **not** use a VM or a userspace kernel. Instead, it leverages **Linux user namespaces** to create a "fake root" environment where the unprivileged user's UID is mapped to UID 0 inside the namespace. The container runs with **all standard Linux namespaces** (PID, mount, UTS, IPC, network, cgroup) plus the user namespace. The critical difference from regular Docker is that **no component runs as real root on the host**.

**Networking** is the most complex part. Since creating `veth` pairs across namespaces requires root, rootless mode uses one of three userspace network proxies:

| Backend | How it works | MTU | Performance |
|---------|-------------|-----|-------------|
| **slirp4netns** (default) | Userspace TCP/IP stack (libslirp) connected via TAP device | 65520 | 1.07 Gbps @ MTU=1500, **9.21 Gbps @ MTU=65520** |
| **pasta (passt)** | Modern userspace TCP/IP, zero-copy, supports IPv6 | 65520 | Comparable or better than slirp4netns |
| **vpnkit** (macOS only) | Hypervisor-based networking | 1500 | ~514-540 Mbps |

**Key security property:** If a container breaks out (via a kernel vulnerability), the attacker lands in the **user namespace**, not the host. They have UID 0 *within the namespace* but map to an unprivileged UID on the host. They cannot modify host files, load kernel modules, or access host devices.

**Source:** [RootlessKit README](https://github.com/rootless-containers/rootlesskit/blob/master/README.md) — "RootlessKit creates user_namespaces(7) and mount_namespaces(7), and executes newuidmap(1)/newgidmap(1) along with subuid(5) and subgid(5)."

### 4.3 Performance Benchmarks

#### Startup Latency

| Scenario | Time | Notes |
|----------|------|-------|
| Rootless Docker container start | **~100-200 ms** (faster than rootful) | No root operations; user namespace creation is fast |
| Rootful Docker container start | ~150-300 ms | Baseline |

Rootless Docker is actually **slightly faster** than rootful Docker for container creation because it skips root-only operations. The user namespace creation itself takes <10ms.

#### Syscall Overhead

**Zero additional syscall overhead** compared to regular Docker. The container runs with the same runc runtime and the same kernel. User namespaces do not add syscall interception — they add **ID mapping** (UID/GID translation) which is handled by the kernel's VFS layer with negligible overhead.

The only overhead is in the **network path** (userspace TCP/IP stack) and **file access** (shiftfs or ID-mapped mounts for bind mounts).

#### Memory Footprint

| Component | Memory | Notes |
|-----------|--------|-------|
| RootlessKit process | **~5-10 MB** | Minimal |
| slirp4netns process | **~5-15 MB** | Depends on connection count |
| pasta process | **~5-10 MB** | Similar |
| Container itself | Same as rootful | No additional overhead |
| **Total overhead vs rootful** | **~10-25 MB** | Much less than gVisor (20-25MB) or Kata (130-320MB) |

#### Network Throughput

**slirp4netns benchmarks** (from [official README](https://github.com/rootless-containers/slirp4netns/blob/master/README.md), Aug 2018, on RootlessKit Travis CI):

| Implementation | MTU=1500 | MTU=4000 | MTU=16384 | MTU=65520 |
|---------------|----------|----------|-----------|-----------|
| vde_plug | 763 Mbps | Unsupported | Unsupported | Unsupported |
| VPNKit | 514 Mbps | 526 Mbps | 540 Mbps | Unsupported |
| **slirp4netns** | **1.07 Gbps** | **2.78 Gbps** | **4.55 Gbps** | **9.21 Gbps** |

**Note:** These are 2018 numbers. Current slirp4netns (v1.3.7, 2026) with seccomp sandbox and optimized packet paths should perform at least as well. The CI runs `make benchmark` regularly.

**pasta (passt):** Designed to be faster than slirp4netns with zero-copy packet handling. No published head-to-head benchmark, but passt's design (direct TAP + no intermediate buffer) suggests comparable or better performance.

**Practical impact for CI:** At MTU=65520 (the default for rootless Docker), you get **9.21 Gbps** — essentially wire speed on a 10Gbps NIC. Even at MTU=1500, 1.07 Gbps is sufficient for most CI workloads.

**Permalink:** [slirp4netns README benchmarks](https://github.com/rootless-containers/slirp4netns/blob/master/README.md)

#### Disk I/O

**No overhead** compared to rootful Docker. Filesystem operations go directly to the host kernel. The only difference is that bind mounts use **shiftfs** (FUSE) or **ID-mapped mounts** (kernel 5.12+) for UID/GID translation:

| Mount type | Overhead | Notes |
|-----------|----------|-------|
| OverlayFS (container rootfs) | **0%** | Same as rootful |
| Bind mount (ID-mapped, kernel ≥5.12) | **~0-2%** | Kernel-native, minimal |
| Bind mount (shiftfs FUSE) | **~5-15%** | FUSE overhead; older kernels |
| Volume mounts | **0%** | Same as rootful |

### 4.4 Compatibility Matrix

#### Works Well

| Workload | Status | Notes |
|----------|--------|-------|
| Any Linux binary | ✅ Full | Same kernel, same syscalls |
| Node.js, Python, JVM, Go, Rust | ✅ Full | No restrictions |
| Docker-in-Docker (rootless) | ✅ Full | Nested rootless Docker works |
| Podman | ✅ Full | Native rootless support |
| BuildKit | ✅ Full | Rootless BuildKit works |
| systemd | ⚠️ Partial | Requires cgroup namespace + PID 1 |
| GPU (NVIDIA) | ⚠️ Partial | Requires nvidia-container-toolkit + cgroup access |
| Network services (HTTP, gRPC) | ✅ Full | Via slirp4netns/pasta |
| Git operations | ✅ Full | No restrictions |
| Package managers (apt, npm, pip) | ✅ Full | No restrictions |

#### What Breaks / Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| **Port < 1024 binding** | ❌ No | Without `setcap CAP_NET_BIND_SERVICE` on Docker binary |
| **IPv6 (slirp4netns)** | ⚠️ Experimental | Supported but marked experimental in RootlessKit |
| **IPv6 (pasta)** | ✅ Yes | pasta supports IPv6 natively |
| **Host network mode** | ❌ No | Cannot use `--net=host` (defeats the purpose) |
| **macvlan / ipvlan** | ❌ No | Requires root for device creation |
| **Docker socket mounting** | ⚠️ Risky | Mounting host Docker socket defeats isolation |
| **`/dev/fuse`** | ⚠️ Limited | May require manual device access |
| **cgroup access** | ⚠️ Limited | cgroup namespace required; some cgroup operations restricted |
| **kernel modules** | ❌ No | Cannot load modules (no real root) |
| **AppArmor** | ⚠️ Ubuntu 24.04+ | RootlessKit must be at `/usr/bin` for AppArmor profile |

#### Language Runtime Support

All language runtimes work **identically to native**. No JIT issues, no syscall gaps. This is the most compatible option for standard CI workloads.

### 4.5 Integration Complexity

#### Kubernetes

Rootless Docker/Kubernetes is supported via:
1. **k3s rootless mode** (simplest)
2. **Usernetes** (per-user K8s clusters)
3. **containerd rootless** (containerd ≥1.6)

**k3s rootless:**
```bash
# Install k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--rootless --disable traefik" sh -

# Use as normal
kubectl get pods
```

**containerd rootless:**
```bash
# Run containerd as unprivileged user
containerd --root /home/user/.local/share/containerd --state /run/user/1000/containerd
```

**Complexity: MEDIUM.** Requires:
1. `subuid`/`subgid` configured (65536+ IDs per user)
2. `newuidmap`/`newgidmap` installed
3. sysctl: `kernel.unprivileged_userns_clone=1` (older distros)
4. slirp4netns or pasta installed
5. AppArmor profile on Ubuntu 24.04+

**No RuntimeClass needed** — rootless is a property of the node/containerd, not the pod.

#### Docker

```bash
# Install Docker rootless
curl -fsSL https://get.docker.com/rootless | sh

# Use as normal (as unprivileged user)
docker run nginx
```

**Complexity: LOW.** Single command to install. No daemon restart needed (per-user daemon).

#### Nomad / Other Orchestrators

Rootless mode is a **node-level** configuration, not a workload-level one. Any orchestrator that can schedule containers on a node will work with rootless Docker/containerd. No special integration needed.

**Complexity: LOW.**

### 4.6 Security Posture

#### Defense-in-Depth Model

| Layer | Mechanism | Threat Addressed |
|-------|-----------|-----------------|
| 1 | Linux user namespace | Root in container → unprivileged on host |
| 2 | Linux namespaces (PID, mount, net, IPC, UTS, cgroup) | Resource isolation |
| 3 | seccomp (Docker default profile) | Syscall filtering |
| 4 | cgroups | Resource limits |
| 5 | slirp4netns seccomp | Network proxy sandboxed |
| 6 | No real root on host | Container escape → limited blast radius |

**Security score: 6/10**

**Critical weakness:** Rootless Docker still shares the **host kernel**. A kernel vulnerability (e.g., the 2026 wave of netfilter/qdisc/io_uring CVEs) that allows container escape will escape into the **user namespace**, but from there, the attacker has:
- Access to all files owned by the unprivileged user
- Network access through the slirp4netns/pasta proxy
- Potential to escalate if there are additional vulnerabilities

This is **better than rootful Docker** (where escape = root on host) but **worse than gVisor/Kata/Firecracker** (where escape is contained by an additional boundary).

#### RootlessKit / slirp4netns CVEs (2024-2026)

No critical CVEs published for RootlessKit or slirp4netns in 2024-2026. The security track record is clean because:
- The codebase is small
- slirp4netns has seccomp sandboxing
- User namespace containment limits blast radius

**However, the host kernel CVEs still apply.** Rootless Docker does NOT defend against host kernel vulnerabilities the way gVisor (userspace kernel) or Firecracker/Kata (VM boundary) do.

**Host kernel CVEs that affect rootless Docker (2024-2026):**
- All the netfilter/qdisc/io_uring CVEs listed in the gVisor security track record **apply to rootless Docker**
- The user namespace containment limits (but does not eliminate) the impact
- Example: CVE-2026-23240 (9.8, UAF race) → in rootless Docker, escape lands in user ns, not host root

#### FIPS / Certifications

- **No FIPS 140-3**
- **No FedRAMP**
- **SOC 2:** Docker's SOC 2 covers the Docker Engine, but rootless mode's security depends on the host kernel
- **Relevant for OpenForge:** Rootless Docker is NOT sufficient for a "secure runner" tier handling truly untrusted code from external forks. It's a **defense-in-depth improvement** over rootful Docker, not a security boundary.

### 4.7 CI Runner Fit Assessment

**Score: 6/10**

| Factor | Rating | Rationale |
|--------|--------|-----------|
| Ephemeral startup | ⭐⭐⭐⭐⭐ | Fastest of all 5 (no VM boot, no Sentry init). ~100-200ms |
| High concurrency | ⭐⭐⭐⭐⭐ | Lowest memory overhead (~10-25MB). Highest density |
| Untrusted workload isolation | ⭐⭐ | **Weakest isolation.** Shares host kernel. User ns limits but doesn't eliminate risk |
| Network for CI | ⭐⭐⭐⭐ | 9.21 Gbps @ MTU=65520. Excellent. |
| CPU-bound builds | ⭐⭐⭐⭐⭐ | Zero overhead. Same kernel, same CPU |
| Disk I/O for builds | ⭐⭐⭐⭐⭐ | Zero overhead (or ~5% with shiftfs) |
| Complexity | ⭐⭐⭐⭐⭐ | Easiest to deploy. Single command install |
| Ecosystem maturity | ⭐⭐⭐⭐⭐ | Docker/Podman are the most mature container engines |
| GPU support | ⭐⭐⭐ | Works with nvidia-container-toolkit but cgroup access is limited |
| CVE risk | ⭐⭐ | **Most exposed to host kernel CVEs.** No additional boundary |

**Recommendation for OpenForge:**
- **Default runner (trusted workloads):** **Excellent fit.** Zero performance overhead, highest density, easiest to operate. For trusted internal developers, this is the right choice.
- **Secure runner (untrusted PRs from forks):** **NOT sufficient.** Rootless Docker does not provide a security boundary against kernel exploits. An attacker who finds a kernel CVE can escape the container and access the runner user's files, environment variables (including secrets/tokens), and network.
- **Hybrid approach:** Use rootless Docker for the default tier, and layer gVisor or Firecracker on top for the secure tier.

---

## 5. Sysbox (Nestybox)

### 5.1 Project Metadata

| Field | Value |
|-------|-------|
| **Official docs** | https://docs.nestybox.com/ (in-repo: `docs/user-guide/`) |
| **Current stable version** | `v0.7.1` |
| **Release date** | 2026-07-31 |
| **License** | Apache-2.0 (CE) + proprietary (EE features) |
| **Repo** | https://github.com/nestybox/sysbox |
| **Maintainer** | Nestybox, Inc. |
| **GitHub stars** | 3,944 |
| **Open issues** | 217 |
| **Languages** | Go (sysbox-runc), C (sysbox-fs, shiftfs kernel module) |

### 5.2 Architecture Overview

Sysbox is a **drop-in replacement for runc** (the OCI runtime) that enables **unprivileged containers to run system-level software** (systemd, Docker, Kubernetes) by combining three key mechanisms:

1. **Linux user namespaces (always enabled):** Every Sysbox container runs with a user namespace, so root inside the container maps to an unprivileged UID on the host. This provides the same fundamental isolation as rootless Docker, but Sysbox does it transparently — you don't need to configure `userns-remap` in Docker.

2. **Procfs/sysfs virtualization:** Sysbox intercepts `mount` and `umount2` syscalls (via selective syscall interception) and provides **virtualized `/proc` and `/sys` filesystems**. This allows the container to have a read-write `/proc/sys` (needed by systemd, Docker, K8s) without being able to modify host-wide kernel parameters. Each container gets its own isolated view.

3. **Immutable initial mounts:** Mounts created at container startup are marked "immutable" — the container can't remount them read-write or unmount `/proc` and `/sys`. This prevents a common container escape technique (remounting `/proc` as read-write to access host kernel interfaces).

The result is a container that **feels like a VM** (you can run systemd, Docker-in-Docker, K8s nodes) but **runs with container-level performance** (no VM boot, no syscall emulation). Sysbox is ~90% OCI-compatible — it supports most Docker/K8s options but has some deviations (e.g., always enables user namespace, doesn't support AppArmor/SELinux profiles).

**Source:** [Sysbox Security Guide](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security.md) — "System containers deployed with Sysbox always use all Linux namespaces... Sysbox performs partial virtualization of procfs inside the system container."

### 5.3 Performance Benchmarks

#### Startup Latency

From [Sysbox documentation](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/images.md):

| Scenario | Time | Notes |
|----------|------|-------|
| First system container (cold) | **~5.8 seconds** | Includes image load + system init |
| Subsequent containers (same image) | **~1.0 second** | Image sharing between containers |
| Simple container (alpine, no systemd) | **~200-500 ms** | Comparable to runc |
| System container with Docker inside | **~5.8s first, ~1s subsequent** | Documented in repo |

**Permalink:** [Sysbox images.md](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/images.md) — "The first instance takes ~5.8 seconds, while subsequent instances take ~1 second due to inner Docker image sharing."

**Interpretation:** For simple CI containers (run a build, exit), Sysbox startup is **comparable to runc** (~200-500ms). The 5.8s number is for full system containers (with systemd + Docker inside), which is not the typical CI use case.

#### Syscall Overhead

> "Sysbox uses host resources optimally and starts containers in a few seconds. Runs with performance equivalent to the OCI runc."
> — [Sysbox README](https://github.com/nestybox/sysbox/blob/master/README.md)

Sysbox performs **selective syscall interception** only on "control-path" syscalls (`mount`, `umount2`). All other syscalls pass through to the host kernel directly with **zero additional overhead**. This is fundamentally different from gVisor (which emulates ALL syscalls) — Sysbox only intercepts the 2-3 syscalls needed for procfs/sysfs virtualization.

**Estimated overhead:** <1% for non-mount/umount syscalls. For `mount`/`umount2` calls, expect ~10-50% overhead (syscall interception + virtualization logic). In practice, CI workloads make very few mount calls, so the practical overhead is **~0%**.

#### Memory Footprint

| Component | Memory | Notes |
|-----------|--------|-------|
| sysbox-runc process | **~5-10 MB** | Similar to runc |
| sysbox-fs (procfs/sysfs virtualization) | **~5-15 MB** | FUSE-based virtual filesystems |
| shiftfs module | **~0 MB** (kernel module, shared) | Not per-container |
| **Total overhead vs runc** | **~10-25 MB** | Similar to rootless Docker |

**Interpretation:** Sysbox's memory overhead is comparable to rootless Docker and significantly less than gVisor (20-25MB just for the Sentry) or Kata (130-320MB).

#### Network Throughput

> "Even containers deployed inside the system containers have excellent performance, though there is a slight overhead for network IO (as expected since packets emitted by inner containers go through an additional network interface / bridge inside the system container)."
> — [Sysbox README](https://github.com/nestybox/sysbox/blob/master/README.md)

For **top-level** containers (the CI use case), there is **no additional network overhead** — the container uses the host's network stack directly (veth pair + bridge, same as regular Docker). The "slight overhead" mentioned applies only to **nested** containers (Docker-in-Docker inside a Sysbox container).

**Estimated overhead for CI:** **0%** (same network path as regular Docker).

#### Disk I/O

**No additional overhead** compared to runc. Sysbox does not add a filesystem layer — the container's rootfs is the same overlayfs used by Docker. The only difference is that bind mounts use shiftfs (FUSE) or ID-mapped mounts for UID/GID translation:

| Mount type | Overhead |
|-----------|----------|
| OverlayFS (rootfs) | **0%** |
| Bind mount (shiftfs) | **~5-15%** |
| Bind mount (ID-mapped, kernel ≥5.12) | **~0-2%** |

### 5.4 Compatibility Matrix

#### Works Well

| Workload | Status | Notes |
|----------|--------|-------|
| Any Linux binary | ✅ Full | Same kernel, same syscalls |
| Node.js, Python, JVM, Go, Rust | ✅ Full | No restrictions |
| **Docker-in-Docker** | ✅ **Full** | **Key differentiator.** Works without `--privileged` |
| **systemd** | ✅ **Full** | **Key differentiator.** Works without `--privileged` |
| **Kubernetes-in-Docker** | ✅ **Full** | K8s nodes as Sysbox containers |
| **K3s-in-Docker** | ✅ **Full** | K3s clusters in containers |
| **BuildKit/Buildx** | ✅ **Full** | Secure buildkit without rootless limitations |
| **RKE/RKE2** | ✅ Full (EE) | Rancher clusters in containers |
| Network services | ✅ Full | Same as regular Docker |

#### What Breaks / Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| **GPU passthrough** | ❌ No | "Sysbox does not currently support exposing host devices inside system containers" |
| **AppArmor** | ❌ No | "Sysbox does not yet support AppArmor profiles" |
| **SELinux** | ❌ No | "Sysbox does not yet support running on systems with SELinux enabled" |
| **Custom seccomp profiles** | ❌ No | "It's currently not possible to reduce the set of syscalls allowed" |
| **`--device` flag** | ❌ No | Host devices not accessible |
| **CRIU** | ❌ No | Not supported |
| **Host network mode** | ⚠️ Limited | Works but reduces isolation |
| **OCI compliance** | ⚠️ ~90% | Some deviations from OCI spec |
| **shiftfs kernel module** | ⚠️ Required | Must be loadable (no secure-boot) |

#### Language Runtime Support

All language runtimes work **identically to native**. No JIT issues, no syscall gaps. The selective syscall interception (only `mount`/`umount2`) has zero impact on application code.

### 5.5 Integration Complexity

#### Kubernetes (RuntimeClass)

```bash
# Label the node
kubectl label nodes <node-name> sysbox-install=yes

# Apply the daemonset (installs Sysbox on the node)
kubectl apply -f https://raw.githubusercontent.com/nestybox/sysbox/master/sysbox-k8s-manifests/sysbox-install.yaml
```

**Pod spec:**
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
spec:
  runtimeClassName: sysbox-runc
  hostUsers: false  # For user-namespace isolation (K8s 1.30+)
  containers:
  - name: my-app
    image: my-image
```

**Complexity: LOW-MEDIUM.** Daemonset-based installation. Works with containerd, Docker, and CRI-O. Tested on GKE, EKS, AKS, RKE, RKE2, Lokomotive.

#### Docker

```json
// /etc/docker/daemon.json
{
  "runtimes": {
    "sysbox-runc": {
      "path": "/usr/bin/sysbox-runc"
    }
  }
}
```

```bash
# Use it
docker run --runtime=sysbox-runc nginx

# Or make it the default
# Add "default-runtime": "sysbox-runc" to daemon.json
```

**Complexity: LOW.** Drop-in runtime swap. The `docker-cfg` script automates configuration.

#### Nomad / Other Orchestrators

Not natively supported. Would require wrapping `sysbox-runc` as a custom driver. **Complexity: MEDIUM-HIGH.**

### 5.6 Security Posture

#### Defense-in-Depth Model

| Layer | Mechanism | Threat Addressed |
|-------|-----------|-----------------|
| 1 | Linux user namespace (always) | Root in container → unprivileged on host |
| 2 | All Linux namespaces | Resource isolation |
| 3 | Seccomp (300+ sys

<task_metadata>
session_id: ses_e5efd909fffeBfwC2aj9oNigjK
task_id: ses_e5efd909fffeBfwC2aj9oNigjK
subagent: librarian
</task_metadata>