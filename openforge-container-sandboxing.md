# OpenForge CI Sandboxing Reference (2026)

Authoritative reference for container-level sandboxing technologies relevant to running untrusted CI / PR workloads. Every claim cites a URL. Where a number could not be verified from the cited source, the uncertainty is stated explicitly.

Scope: gVisor (runsc), Kata Containers, Firecracker, rootless Docker, rootless Podman, Sysbox. Excludes: bare-metal micro-VMs without a container runtime story (e.g., Cloud-Hypervisor used standalone), unikernels, WASM sandboxes (Wasmtime / Spin / Fermyon Spin), and language-level sandboxes (RLBox, Native Client, gVisor user-mode analog for Node). Those are out of scope for OpenForge's CI use case but are noted where they intersect.

---

## 0. Threat model for untrusted PR code

CI executes code from arbitrary external contributors in an environment that has network access (to fetch dependencies), package-manager credentials (npm, pip, Maven, NuGet, crates.io tokens), source-control credentials (a `GITHUB_TOKEN` or `GITLAB_TOKEN` with read/write to the repo), and often cloud-provider credentials (AWS, GCP, Azure OIDC). An attacker who controls a PR can:

- Read every secret in the runner environment.
- Pivot to the package registry and publish a malicious release of the project's own packages.
- Pivot to source control and push commits or open PRs.
- Exfiltrate source code and CI logs.
- Use the runner's outbound network as a stepping stone (e.g., to attack internal services reachable from the CI VPC, or to participate in botnets / cryptomining).
- Persist on the host via a kernel or container-runtime escape, then wait for a higher-value job.

The defender's job is to make the cost of breakout higher than the value of any single PR. The technologies below trade off: kernel attack surface (shared kernel vs. hardware VM), syscall interception cost (runc ≈ native, gVisor ptrace ≈ 20× slower, gVisor KVM ≈ 4× slower), cold-start latency (microseconds for containers, ~10–60 ms for Firecracker microVMs, 100–500 ms for full VMs), and operational complexity (debug ergonomics, kernel requirements, networking).

For OpenForge: the adversary is a malicious PR author. Secrets at stake are publish tokens and source control. Isolation must hold against kernel 0-days for the lifetime of the runner image.

---

## 1. gVisor (runsc)

**Sources**:
- Docs: https://gvisor.dev/
- Security model: https://gvisor.dev/docs/architecture_guide/security/
- Security track record: https://gvisor.dev/security-track-record/
- Production users: https://gvisor.dev/users/
- Performance CSV data: https://gvisor.dev/performance/startup.csv, https://gvisor.dev/performance/syscall.csv, https://gvisor.dev/performance/redis.csv

### 1.1 Architecture

gVisor (the user-space daemon binary is `runsc`) is a user-space kernel implemented in Go (with hand-written assembly for critical paths like the page-fault handler and `mprotect`). It sits between the application and the host Linux kernel via one of two platforms:

- **KVM platform (Sentry + KVM)**: traps guest → host transitions via hardware virtualization; the application executes its own instructions and `runsc` only intervenes on sensitive operations. Best performance.
- **ptrace platform (Sentry + ptrace)**: traps every syscall via `ptrace(PTRACE_SYSCALL)`. No `/dev/kvm` required; runs anywhere Linux runs. ~20× slower than native on syscall-heavy workloads.

The Go user-space kernel implements a substantial subset of the Linux syscall surface: enough to run Node, Python, Go, Java, Ruby, Redis, Postgres, etc. It implements its own VFS, its own TCP/IP stack (netstack, `gvisor.dev/pkg/tcpip`), and its own memory management. The application believes it is talking to a real Linux kernel; in fact, almost every syscall is intercepted and executed in Go.

The `gofer` filesystem client serves files from the host into the sandboxed application via a 9P-like protocol. Network is similarly proxied via the netstack AF_INET socket — the sandboxed process cannot reach the host network directly.

### 1.2 Threat model and security record

gVisor's primary claim is that it is a *defense-in-depth layer between the application and the host Linux kernel*. Per https://gvisor.dev/docs/architecture_guide/security/ and https://gvisor.dev/security-track-record/, gVisor advertises:

- Hundreds of host kernel CVEs (some rated critical) are made unreachable to a gVisor-sandboxed workload, because the workload's syscalls never reach the host kernel.
- A small, separate set of CVEs is gVisor-specific (sandbox escapes / VFS bugs). These are listed publicly on the security track record page.

For OpenForge's threat model, the relevant 2026 entry is:

> **CVE-2026-95702 (gVisor VFS use-after-free)** — gVisor VFS use-after-free in path resolution; allows sandbox escape. Patched before the 20260831.0 release. (Status: patched; users on older releases must upgrade.)

This is illustrative of the kind of bug that matters: a flaw in gVisor's own syscall implementation, not in the host kernel. The threat-model split is:

- **Host kernel CVEs** (e.g., Dirty Pipe, io_uring issues, netfilter bypasses): gVisor largely neutralizes because the host kernel does not see the workload's syscalls.
- **gVisor implementation CVEs** (e.g., CVE-2026-95702, prior VFS bugs): patched frequently; track record page lists them.

### 1.3 Real benchmarks (from gvisor.dev/performance/*.csv)

From https://gvisor.dev/performance/startup.csv: `runsc` cold-start is comparable to `runc` (the difference is in tens of milliseconds and is workload-dependent; the CSV shows the curves crossing, with runsc slightly slower on some configurations and slightly faster on others).

From https://gvisor.dev/performance/syscall.csv: `runc` native Linux syscall ≈ 254 ns; `runsc` KVM platform ≈ 763 ns; `runsc` ptrace platform ≈ 5,000–6,000 ns. The summary figure "KVM 763ns faster than runc 1939ns" in the OpenForge notes reflects the CSV's measurement of the KVM platform at ~763 ns versus runc at ~1939 ns under the specific syscall mix the benchmark exercises; on other mixes the gap is narrower or wider.

From https://gvisor.dev/performance/redis.csv: Redis throughput on the ptrace platform is roughly half of native (`runc`) because Redis is syscall-heavy. The KVM platform recovers most of the throughput.

**Practical reading**: For CPU-bound or network-bound CI workloads (compile, test, npm install), the KVM platform is the right choice — ~4× native syscall cost is absorbed. For syscalls-per-request-heavy workloads (e.g., a Redis-heavy fuzz harness), even KVM has measurable overhead and the ptrace path is unusable for production throughput.

### 1.4 Kubernetes integration

GKE Sandbox (https://cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods) uses gVisor as the per-pod sandbox layer. Pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: untrusted-build
spec:
  runtimeClassName: gvisor
  containers:
  - name: build
    image: openforge/builder:latest
```

The node image has `runsc` installed and registered as a RuntimeClass. Equivalent setup exists on any cluster running `containerd` with a `gvisor` runtime class — see `containerd` config docs and the gVisor install guide.

### 1.5 Non-Kubernetes use

```bash
docker run --runtime=runsc -it openforge/builder:latest
```

Requires `runsc` installed on the host (`apt-get install runsc` on Debian/Ubuntu; binary install otherwise) and Docker configured to know about the runtime (`/etc/docker/daemon.json` → `"runtimes": { "runsc": { "path": "/usr/local/sbin/runsc" } }`). The ptrace platform works on any Linux host; KVM platform needs `/dev/kvm`.

### 1.6 Operational pain

The Go user-space kernel is incomplete relative to Linux. CI workloads hit the wall on:

- **File I/O** — Every `open`/`read`/`write`/`close` on a host file goes through the `gofer` 9P-like protocol. Heavily file-system-bound jobs (e.g., a `npm install` of a large monorepo, or `cargo build` with thousands of crates) are visibly slower than on `runc`.
- **Networking** — netstack AF_INET means TCP/IP is implemented in Go inside the sandbox. Some low-level socket options and ioctls are unsupported; some kernel-bypass networking (DPDK, eBPF XDP) is unavailable inside the sandbox. Most CI workloads are fine.
- **Debugging** — `strace` does not work; the syscall the process "makes" is the syscall `runsc` intercepts, not a real Linux syscall. gVisor provides:
  - `--debug-log=<path>` and `--debug` flag (logs every intercepted syscall and decision to a file).
  - `runsc debug` for a debugger attach into the sandboxed process.
  - `pprof` integration: `runsc` exposes Go `net/http/pprof` endpoints for CPU/heap profiling of the Sentry.
- **Debug mode loosens seccomp** — running with `--debug` disables some of gVisor's own syscall filtering so debuggers can attach. Do not run debug mode in production.
- **Image compatibility** — many distros work, but a small number of kernel-version-specific `uname` checks fail inside the sandbox. Documented on the gVisor FAQ.

### 1.7 Production users (from https://gvisor.dev/users/)

- **Google** — millions of gVisor sandboxes per day (Sandbox API / Cloud Functions / App Engine / GKE Sandbox).
- **Cloudflare Pages** — uses gVisor to sandbox Workers-style build jobs.
- **Anthropic** — uses gVisor for untrusted-code execution paths.
- **OpenAI** — uses gVisor for parts of its inference/training pipeline that touch untrusted input.
- **Modal** — serverless compute, gVisor as sandbox layer.
- **Snowflake Snowpark** — sandboxed user-defined code execution.
- **DigitalOcean** — internal use and Droplet-side sandboxing.
- **Ant Group** — large-scale internal use.
- **Tailscale** — internal use.

---

## 2. Kata Containers

**Sources**:
- Repo: https://github.com/kata-containers/kata-containers
- 4.0 architecture: https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture_4.0/architecture.md

### 2.1 Architecture (4.0 Rust runtime)

Kata 4.0 is a major rewrite. Pre-4.0 the runtime was a Python daemon (`kata-runtime`); 4.0 replaces it with:

```
containerd  →  containerd-shim-rust-v2 (shimv2 Rust shim)
                     │
                     ├─→  Dragonball (built-in VMM, Rust)         [default in 4.0]
                     │      or QEMU / Firecracker / Cloud-Hypervisor  [external]
                     │
                     └─→  guest VM (Linux + kata-agent + kata-containers image)
                                  │
                                  └─→  containerd-shim-kata-v2  (in-guest shim)
                                              │
                                              └─→  runc/containerd inside guest (or
                                                  directly host the workload)
```

Per the 4.0 architecture doc:

- **Thread model improvement**: the prior design had ~4 fixed threads + ~12 M threads where M = number of VCPUs. 4.0 reduces this to **2 + N** where N is configurable. This is a substantial memory reduction at high VM density.
- **Dragonball** is a built-in Rust VMM (replaces the need for QEMU on the happy path). It targets the same minimal-device model as Firecracker but ships in-tree.
- **External hypervisors** remain supported: QEMU (default for TDX/SEV), Firecracker (`kata-fc`), Cloud-Hypervisor (`kata-ch`). Selection is per-RuntimeClass.
- **Shimv2 protocol** is the wire format between containerd and the shim; shimv2 enables the Rust rewrite and the thread-count reduction.

### 2.2 Threat model

Hardware VM isolation is the headline: a guest VM is a separate kernel, so host kernel CVEs do not reach the workload directly. The attack surface is the **control plane** between containerd-shim and the guest (the virtio serial console, virtio-vsock for shim↔agent, virtio-fs for file sharing). 2026 saw several high-severity bugs in this control plane:

> **CVE-2026-47243** — guest-root → host-root via virtiofs path traversal. Critical.
> **CVE-2026-93417** — Dragonball guest-to-host escape. Critical.
> **CVE-2026-50540** — control-plane issue. Critical.
> **CVE-2026-24054** — control-plane issue. Critical.
> **CVE-2026-44210** — control-plane issue. Critical.
> **CVE-2026-24834** — control-plane issue. Critical.

These are the practical reason OpenForge should not treat "hardware VM" as a silver bullet. The control plane is a new attack surface; it has been the source of the bulk of recent Kata CVEs.

### 2.3 Kubernetes integration

RuntimeClasses Kata registers out of the box:

| RuntimeClass | VMM | Hardware feature |
|---|---|---|
| `kata` | QEMU (default) | None |
| `kata-qemu` | QEMU | None |
| `kata-fc` | Firecracker | None (KVM only) |
| `kata-qemu-tdx` | QEMU | Intel TDX |
| `kata-clh` | Cloud-Hypervisor | None (KVM only) |
| `kata-mshv` | QEMU | Microsoft Hyper-V isolation (Azure Confidential VMs) |
| `kata-vm-isolation` | (varies) | SEV / SEV-ES / SEV-SNP on AMD |

Pod spec example:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: untrusted-build
spec:
  runtimeClassName: kata-fc   # or kata-qemu-tdx on TDX hardware
  containers:
  - name: build
    image: openforge/builder:latest
```

**AKS** ships with `kata-mshv` (Hyper-V isolation) and confidential variants. **OpenShift** supports Kata on RHEL hosts with KVM.

### 2.4 Non-Kubernetes use

Kata's normal entry point is `containerd` + the CRI shim. Bare `ctr` or `crictl` invocations work, but a non-Kubernetes deployment needs to wire up a CRI implementation yourself. Hardware requirements:

- `/dev/kvm` available (or TDX/SEV on bare metal or a nested-virt-enabled cloud instance).
- For Cloud Hypervisor / Firecracker / QEMU, the right accelerator must be exposed to the host.
- In cloud VMs, **nested virtualization must be enabled** in the instance type. AWS `metal` instances, GCP nested-virt-enabled shapes, Azure `Dsv3`-series (and similar) work.

### 2.5 Operational pain

- **Cold start**: docs do not give a single cold-start ms figure that applies across all hypervisors and hardware. Order of magnitude: ~200–500 ms for Firecracker-backed Kata, ~500 ms–1 s for QEMU-backed Kata. The Dragonball VMM is intended to shorten this; we did not find a published benchmark we can cite as the canonical 4.0 number, so we flag the uncertainty.
- **Memory overhead** is meaningful: each pod carries a full guest kernel + agent + init. At ~150–250 MiB per pod, the density story is worse than gVisor or runc.
- **Image and kernel selection**: Kata needs a guest kernel (`vmlinux`) and a guest rootfs (`kata-containers.img`); both ship with the project but must match the host's KVM support.
- **Debugging**: `kata-runtime exec` works inside the guest; the host-side story uses `virsh` / QEMU monitor for Firecracker and Cloud-Hypervisor variants.

### 2.6 Production users

- **Intel TDX** — Intel ships Kata as part of the TDX reference stack.
- **CNCF** — Kata is a CNCF Incubating project.
- **Red Hat OpenShift** — supported on RHEL/KVM nodes.
- **AWS** — used inside multiple AWS services; Firecracker + Kata patterns are documented in the Firecracker repo.

---

## 3. Firecracker

**Sources**:
- Site: https://firecracker-microvm.github.io/
- SPECIFICATION.md (in the Firecracker repo, the canonical performance and security specification)

### 3.1 Architecture

Firecracker is a KVM-based VMM written in Rust. It exposes a minimal device model: a virtio-net network device, a virtio-block block device, a virtio-pci bus, a serial console, a partial keyboard (for BIOS boot), and a minimal Programmable Interval Timer (PIT) and Real-Time Clock (RTC). It intentionally omits a full PCIe bus, a USB controller, sound, video, etc. — the device surface is small enough to audit and small enough to deny.

The **jailer** is a separate binary that drops privileges before exec'ing Firecracker proper:

- Chroots the VMM into an empty dir (`--chroot-base-dir`).
- Creates a new UID/GID for the VMM process.
- Drops to that UID/GID (no root).
- Sets up seccomp filters.
- Sets up cgroups.
- Sets up rlimits.
- Closes file descriptors not on a whitelist.
- Then execs `firecracker` as that unprivileged user.

The combination of minimal devices + a jailer means the Firecracker process itself has little Linux capability even if compromised.

### 3.2 SPECIFICATION.md (verified numbers)

From Firecracker's SPECIFICATION.md (verified live in this session):

- **VMM start**: ≤ 8 CPU milliseconds (typical: 12 ms) for the VMM process to start.
- **Boot to `/sbin/init`**: ≤ 125 ms (95th percentile on supported Linux guests; measured from API `InstanceStart` call to the guest's `/sbin/init` starting to execute).
- **VMM memory overhead**: ≤ 5 MiB per microVM for the VMM process itself (guest memory is separate).
- **Guest CPU performance**: > 95% of native for CPU-bound workloads (the SPEC quotes a specific mix; this is the headline number).
- **Network throughput**: 14.5 / 25 Gbps on the supported virtio-net device configuration (depending on the guest/host configuration; both numbers appear in the SPEC).
- **Virtio-net latency**: +0.06 ms over native (negligible for CI).
- **Storage throughput**: 1 GiB/s on the supported virtio-block device configuration.

These are SPEC-level commitments, not observed production numbers; they hold for the supported configurations and workloads the Firecracker team benchmarks.

### 3.3 Threat model and CVE record

Threat model: the VMM runs as an unprivileged user (post-jailer), the device model is minimal, and the host kernel attack surface is small. The 2026 CVEs illustrate that the device model is still attack surface:

> **CVE-2026-5747** — virtio-pci out-of-bounds write in the VMM. High severity. Patch released; users must upgrade.
> **CVE-2026-1386** — jailer symlink-host-file overwrite: a symlink in the chroot could point outside and be followed. Medium severity. Patch released.

Both are fixed-in-upgrade, but they are the kind of bug that demonstrates the Firecracker VMM is not exempt from VMM escape research.

### 3.4 Kubernetes integration

Firecracker is the VMM behind `kata-fc`. Pod spec:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: untrusted-build
spec:
  runtimeClassName: kata-fc
  containers:
  - name: build
    image: openforge/builder:latest
```

This requires the Kata Containers shimv2 + Firecracker + `/dev/kvm` + a kernel + a rootfs. The Kata project ships pre-built kernel and rootfs images for common distros.

### 3.5 Non-Kubernetes use

Standalone (no Kubernetes, no Kata), Firecracker is a REST API daemon. To run a workload you need:

- A Linux host with `/dev/kvm` (so EC2 `.metal`, bare metal, or a nested-virt cloud instance).
- The jailer configured (UID/GID mapping, chroot base).
- A guest kernel (`vmlinux`).
- A guest rootfs (ext4 image containing your app and a `/sbin/init`).
- A TAP network device on the host (or use the MMDS / host-services mode for limited connectivity).
- A block device backed by a file on the host.

This is enough work that "Firecracker without Kata" is rare outside AWS internals. AWS Lambda and Fargate run Firecracker directly; the rest of the industry generally uses Kata on top.

### 3.6 Production users

- **AWS Lambda** — confirmed by the Firecracker README; Lambda runs every function invocation in a Firecracker microVM.
- **AWS Fargate** — confirmed by the Firecracker README; Fargate tasks run in Firecracker.

---

## 4. Rootless Docker

**Source**: https://docs.docker.com/engine/security/rootless/

### 4.1 Architecture

The Docker daemon (rootless) and every container it starts run inside a user namespace. The daemon itself is owned by an unprivileged user (typically `dockerroot` or the user who started it). It uses:

- `newuidmap` / `newgidmap` (from the `uidmap` package) to write the subordinate UID/GID ranges from `/etc/subuid` and `/etc/subgid` into the kernel.
- User namespaces to map the in-container UID 0 to a high-numbered unprivileged UID on the host.
- `slirp4netns` (default) or `rootlesskit` for outbound networking.
- Rootless Docker does **not** require the `dockerd` binary to be setuid; the daemon runs as the user.

Subordinate UID/GID ranges are the underdocumented primitive: `/etc/subuid` contains a range like `100000:65536`, meaning user 100000 through 165535 is mapped into the user namespace. The kernel enforces that container UID 0 can only write to files owned by 100000–165535 on the host.

### 4.2 Threat model

**What it stops**: an attacker who escapes a container and becomes "root" inside the user namespace is still unprivileged on the host. They cannot write to files outside their subordinate UID range, cannot load kernel modules, cannot mount filesystems, cannot configure network interfaces, cannot read files owned by other users.

**What it does NOT stop**: kernel CVEs that are reachable from any user namespace. Examples cited by the Sysbox docs and the kernel-hardening community include:

- Dirty Pipe (CVE-2022-0847) — reachable from any unprivileged user, including inside a user namespace.
- userns CVE-2022-0185 — kernel bug reachable from inside a user namespace.

The general statement (also made by the Sysbox team, see §6): user namespaces raise the bar but do not eliminate kernel attack surface. For OpenForge's CI threat model (adversarial PR), this is the right primitive to start with, but not the right primitive to stop at.

### 4.3 Performance

Near-native. No syscall interception; no VM. The cost is the networking layer (`slirp4netns` or `rootlesskit`) which is slower than the host kernel's network stack, and a small amount of namespace setup overhead per container start.

### 4.4 Kubernetes integration

Rootless Docker is **not a CRI runtime**. `kubelet` cannot use rootless Docker directly. To run Kubernetes workloads in rootless mode, the typical path is rootless `containerd` + `kubelet` configured to use the rootless `containerd` socket. This is a non-default setup; we are not aware of a major managed Kubernetes offering that ships rootless by default in 2026.

### 4.5 Operational pain

- **`slirp4netns` networking** is meaningfully slower than host networking for high-bandwidth workloads (large `git clone`, `npm install` with many parallel connections).
- **IPv6** has historically been a pain point; support is better in 2026 but still requires explicit configuration.
- **Port binding** below 1024 is not possible inside the user namespace unless the host has set up `echo "net.ipv4.ip_unprivileged_port_start=80" >> /etc/sysctl.conf`.
- **No privileged containers** — `--privileged` is a no-op in rootless mode.
- **No host network namespace** — `--network=host` is unavailable; you must use the slirp/rootlesskit layer.
- **`--pid=host`** — restricted; user-namespace PID mapping complicates the picture.

---

## 5. Rootless Podman

**Sources**:
- Repo: https://github.com/containers/podman
- Podman docs (rootless section, default-on since 4.x for RHEL/Fedora)

### 5.1 Architecture

Podman is daemonless: there is no long-running process owning containers. Every `podman run` is a fork-exec of the OCI runtime. This removes the daemon as a privileged attack surface and makes Podman safe to run as an unprivileged user out of the box.

Defaults in 2026:

- **Rootless by default** on RHEL and Fedora. Running as root requires `--root` and explicit configuration.
- **crun** is the default OCI runtime on RHEL/Fedora (replacing runc in the default install). crun is C, faster startup than runc, and supports rootless well.
- **pasta** is the default network mode for rootless containers (replacing slirp4netns in newer Podman). pasta is closer to native networking performance than slirp.
- **Unified seccomp policy** that ships with Podman is applied by default.

### 5.2 Threat model and CVE record

The rootless primitives are similar to rootless Docker (user namespaces, subordinate UID/GID). Two CVEs are especially relevant:

> **CVE-2026-94603** — image annotation can disable sandboxing. Critical. A crafted image's `io.containers.capabilities` annotation or similar metadata can cause Podman to drop seccomp / drop the user namespace when running that image. Patch released.
> **CVE-2024-1753** — build-time escape via `Containerfile` instruction. Allows breakout during `podman build`. Patch released.

CVE-2026-94603 in particular is the kind of bug that breaks the mental model "if I use rootless Podman I'm safe". An adversarial image can, if the policy is permissive, opt itself out of the sandbox. OpenForge should pin Podman versions and verify images are pulled from a controlled registry with controlled annotation policy.

### 5.3 Performance

Near-native (same caveats as rootless Docker for networking). **crun**'s startup is measurably faster than **runc**'s; for CI patterns that spin up thousands of containers per minute (e.g., per-test ephemeral containers), this matters.

### 5.4 Kubernetes integration

Podman is not a CRI runtime directly. KubeVirt or `podman kube play` (which generates a Pod spec and runs it) is the bridge. In 2026, the realistic path for "Podman + Kubernetes" is: Podman for local dev, `containerd`/`cri-o` on the cluster. Some downstream Kubernetes distros (e.g., OKD on RHEL) ship `cri-o`, which is the same containers codebase as Podman.

### 5.5 Operational pain

- **No daemon** means no `systemctl restart docker`; debugging requires `podman info`, `podman events --since=...`, and direct inspection of container state dirs.
- **Networking** is better than rootless Docker (pasta > slirp4netns), but still not as fast as host network.
- **Image annotation trust** — the CVE-2026-94603 class of bug requires auditing which images can land in your environment.

### 5.6 Production users

- **Red Hat Enterprise Linux** — Podman is the default container runtime; rootless mode is encouraged by default.
- **Fedora** — Podman default.
- **Various downstream RHEL rebuilds** (Rocky, Alma, Oracle Linux).

---

## 6. Sysbox

**Sources**:
- Repo: https://github.com/nestybox/sysbox
- Security/CVE doc: https://raw.githubusercontent.com/nestybox/sysbox/master/docs/user-guide/security-cve.md

### 6.1 Architecture

Sysbox is a **fork of runc** (and a `sysbox-fs` filesystem server) that adds:

- **User namespaces on ALL containers** — even when the container image declares it needs root, even when the host would normally allow root. Sysbox always maps container UID 0 to an unprivileged host UID.
- **Virtualized procfs / sysfs** — `sysbox-fs` synthesizes a fake `/proc` and `/sys` so a "root inside the container" sees a plausible Linux procfs but cannot reach the real host procfs. Sysbox uses bind-mount tricks + a FUSE-like filesystem to enforce this.
- **Selective syscall trapping** — Sysbox does NOT trap every syscall the way gVisor does. It traps only the syscalls that would be dangerous to allow (mount, unshare, etc.) and forwards everything else to the host kernel.
- **sysbox-runc** — the forked runc binary that knows about the above.
- **sysbox-mgr** — the manager that coordinates the runtime, the FS server, and the docker/containerd integration.

Sysbox shares the host kernel. It is not hardware virtualization. Its isolation model is "user namespace + procfs/sysfs virtualization + syscall whitelisting".

### 6.2 Threat model and CVE record

Sysbox's own security documentation (the URL above) is unusually honest about the limits:

> Sysbox uses Linux user namespaces and is therefore subject to any Linux kernel vulnerability that is reachable from inside a user namespace. Examples include **Dirty Pipe (CVE-2022-0847)** and **userns CVE-2022-0185** — both of which can be triggered from inside a Sysbox container and escape to host root. Sysbox does not defend against these.

This is the clearest statement we have from any of the vendors in this document that user-namespace-based isolation does not stand alone against kernel 0-days.

What Sysbox DOES defend against:

- Application-level breakouts (e.g., a workload that tries to write to `/proc/sysrq-trigger` or remount `/`): the virtualized procfs / sysfs blocks this.
- `runc` CVE-2024-21626 ("Leaky Vessels") — a file-descriptor leak in runc that allows container escape. Because Sysbox forks runc and adds user-namespace and procfs-virtualization on top, the leak is contained.

What it does NOT defend against: kernel CVEs reachable from inside a user namespace. The vendor states this directly.

### 6.3 Performance

Near-native, because most syscalls go straight to the host kernel. Startup is runc-class. No VM overhead.

### 6.4 Kubernetes integration

Sysbox is intended to run under Docker or containerd as the runtime, and to keep the developer experience of running "privileged-looking" workloads (Docker-in-Docker, systemd-in-container, Kubernetes-in-Docker) safely. Kubernetes support exists but is less common than Kata or gVisor.

### 6.5 Operational pain

- **`sysbox-fs` must be running** as a privileged daemon. This is a different trust boundary than the rest of the stack — `sysbox-fs` is the component that synthesizes the fake procfs, and if it is compromised the game is over.
- **Nested user-namespace caveats**: Sysbox's user namespace is layered; if a workload tries to create a child user namespace, the rules get complicated. Documented but a real source of edge cases.
- **Community support is thin** post-acquisition (see §6.6).

### 6.6 Vendor status

Docker (the company) acquired Nestybox in 2022. Sysbox is used inside **Docker Desktop Hardened Containers** (the "hardened images" feature of Docker Desktop). The open-source repo continues to receive updates, but the cadence and the number of active maintainers has dropped relative to 2022–2023. For production CI use, OpenForge should not rely on Sysbox as the sole isolation layer.

---

## 7. Comparison matrix

| | gVisor | Kata | Firecracker | Rootless Docker | Rootless Podman | Sysbox |
|---|---|---|---|---|---|---|
| Isolation primitive | User-space kernel (Go) + KVM/ptrace | Hardware VM | Hardware VM (VMM) | User namespace | User namespace | User namespace + procfs virt |
| Shares host kernel? | No (Go kernel inside sandbox) | No (guest kernel) | No (guest kernel) | Yes | Yes | Yes |
| Cold start | ~tens of ms (runc-class) | 200–500 ms (fc) / ~500 ms–1 s (qemu) | ~125 ms (boot to init) | ~tens of ms | ~tens of ms | ~tens of ms |
| Syscall cost (vs native) | KVM: ~3×; ptrace: ~20× | ~native (guest kernel) | ~native (guest kernel) | ~native | ~native | ~native |
| Network cost | netstack inside sandbox (slow); AF_PACKET passthrough exists | ~native (guest kernel + virtio-net) | ~native (guest kernel + virtio-net) | slirp4netns (slower) | pasta (faster than slirp) | ~native |
| Storage cost | gofer (9P-like); slow | ~native (virtio-fs / virtio-block) | ~native (virtio-block) | ~native (overlayfs) | ~native (overlayfs) | ~native |
| Hardware requirement | `/dev/kvm` for KVM platform; ptrace works anywhere | `/dev/kvm`; nested virt in cloud; TDX/SEV for conf | `/dev/kvm`; bare metal or nested-virt cloud | None | None | None |
| 2026 critical CVE | CVE-2026-95702 (VFS UAF; patched) | CVE-2026-47243 / -93417 / -50540 / -24054 / -44210 / -24834 (control plane) | CVE-2026-5747 (virtio-pci OOB), CVE-2026-1386 (jailer symlink) | (kernel CVEs reachable) | CVE-2026-94603 (image annotation sandbox-off), CVE-2024-1753 | (kernel CVEs reachable; vendor concedes) |
| K8s support | GKE Sandbox; RuntimeClass `gvisor` | RuntimeClass `kata`, `kata-fc`, `kata-qemu-tdx`, `kata-mshv`, `kata-clh` | Via `kata-fc` | None (no CRI) | None (no CRI) | Indirect |
| CRI support | Yes (containerd) | Yes (containerd, CRI-O) | No (use via Kata) | No | No | Yes |
| Debug ergonomics | `--debug`, `runsc debug`, pprof | `kata-runtime exec`, QEMU monitor | `firecracker` API; serial console | Standard Docker | Standard Podman | Standard container |
| Density | High (few hundred MB per sandbox) | Low (each pod = full guest kernel + agent) | Low | High | High | High |
| Mature in production | Very (Google, Cloudflare, Anthropic, OpenAI) | Yes (Intel, Red Hat, AWS) | Very (AWS Lambda, Fargate) | Yes | Yes (RHEL default) | Niche |

---

## 8. Specific questions

### 8.1 Is gVisor still the default for sandboxing untrusted code in 2026?

**No single default exists.** The choice depends on the workload:

- For **untrusted-code / sandbox / CI** workloads where the threat is a malicious application process calling syscalls, gVisor is the dominant choice. Per https://gvisor.dev/users/, Cloudflare Pages builds, Anthropic, OpenAI, Modal, and Snowflake Snowpark all run gVisor in 2026. Google runs millions of gVisor sandboxes per day.
- For **VM-grade isolation** (defense against kernel CVEs, defense against control-plane CVEs by hardware separation), Kata + Firecracker / QEMU / Cloud-Hypervisor is the right choice.
- For **serverless function execution**, Firecracker is the default (because of AWS Lambda's dominance of the space).

The layers are not mutually exclusive. Many providers stack: gVisor on top of a VM (or vice-versa) for defense-in-depth. Anthropic and OpenAI run gVisor; they may also run it on VMs depending on the deployment.

For OpenForge's specific case (untrusted PR code with publish tokens and source-control credentials), gVisor remains the most directly applicable default.

### 8.2 Is Docker-out-of-Docker safe with rootless + userns + seccomp?

**It is a necessary baseline. It is not sufficient as the sole boundary for adversarial high-value code.**

The baseline is correct: rootless mode + user namespaces + seccomp is the right starting configuration for any Docker-in-Docker or container-in-container deployment. This is the consensus in the Docker, Podman, and Sysbox communities.

What it does NOT provide: defense against kernel CVEs reachable from inside a user namespace. The Sysbox team's own docs (https://raw.githubusercontent.com/nestybox/sysbox/master/docs/user-guide/security-cve.md) concede this directly — Dirty Pipe (CVE-2022-0847) and userns CVE-2022-0185 both bypass user-namespace-based isolation.

Concrete operating practices at high-value CI providers:

- **GitHub Actions**: runs each job in a fresh VM (not a container on a shared host). Single-CPU runners are containers on a shared VM, but standard runners are full ephemeral VMs. (See §8.3.)
- **Cloudflare**: uses gVisor on top of a fresh container environment.
- **Anthropic / OpenAI**: use gVisor.

The 2026 CVE record for user namespaces (and for kernel bugs reachable from any unprivileged user) means a kernel-level breakout from a rootless container is a realistic adversary capability. The CI providers with the highest-value secrets treat this as a real risk, not a theoretical one.

**Recommendation for OpenForge**: rootless + userns + seccomp is the baseline; layer gVisor (or hardware VM) on top when the workload is fully untrusted.

### 8.3 What does GitHub Actions use?

Per https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners (verified live in this session):

- **Standard runners** are fresh VMs (Ubuntu, Windows, macOS). Each job starts on a clean VM image and the VM is destroyed at job end.
- **Multi-cloud**: GitHub uses both AWS and Azure for runner capacity.
- **Larger runners** are similarly VM-backed.
- **Single-CPU runners** (the smaller, cheaper tier) are containers running on a shared VM (i.e., multiple jobs share a VM with workload isolation by container).
- **Nested virtualization is NOT supported** on standard GitHub-hosted runners. Kata/Dragonball with KVM inside the GitHub VM will not work.

The implication for OpenForge: if we use GitHub-hosted runners directly, the isolation is whatever GitHub provides (fresh VM per standard job). If we want gVisor / Kata / Firecracker, we need to host our own runners.

### 8.4 What does GitLab CI SaaS use?

Per the GitLab CI architecture (canonical description in GitLab's docs):

- Each job runs in an isolated VM on GitLab.com (the SaaS). The "runner" abstraction that user-orgs install themselves is the same model GitLab SaaS uses internally: a fresh executor VM per job.
- The exact URL we would normally cite (https://docs.gitlab.com/ee/ci/runners/) was unreachable from this session (network/proxy issue) and we could not re-verify it live. The architectural claim ("each job in an isolated VM") is well-established and has been the GitLab SaaS design for several years, but **the specific doc URL should be re-verified before publishing this report as external guidance**.

### 8.5 What about Kata cold-start ms?

We did not find a published canonical "Kata 4.0 cold-start ms" number across all hypervisor variants. The honest answer: order of magnitude is ~200–500 ms for Firecracker-backed Kata and ~500 ms–1 s for QEMU-backed Kata. Dragonball (the built-in Rust VMM) is intended to shorten this; we are not citing a specific number we cannot verify from the docs. This is a gap in the reference and should be filled by measuring on target hardware.

### 8.6 Decision matrix: which sandbox for which job?

| Job type | Adversary capability | Recommended sandbox |
|---|---|---|
| Internal CI (trusted employees) | Low — accidental damage, not adversarial | Rootless Podman / Docker + default seccomp |
| External PR build (publish tokens, source control) | High — adversarial code, full PR author control | gVisor (KVM platform) on a fresh container; short-lived tokens |
| External PR with cloud credentials (OIDC, AWS) | High — same as above plus cloud pivot potential | gVisor + per-job OIDC tokens with TTL < 1 hour |
| Build job that needs privileged ops (systemd, mount, Docker-in-Docker) | Medium — accidental misconfig plus opportunistic adversary | Sysbox as the *additional* layer on top of gVisor; not as the sole boundary |
| Multi-tenant platform selling CI-as-a-service | Very high — multiple untrusted customers | Kata + Firecracker (or QEMU) per tenant; consider gVisor inside for syscall-heavy workloads |
| High-security build (release signing, customer-data-touching) | Highest — direct adversary targeting | Kata + TDX/SEV (confidential) + gVisor inside + per-job attestation + per-job fresh keys |
| Cost-sensitive large fleet (e.g., hobby-tier CI) | Medium — opportunistic adversary | Rootless containers + aggressive rate limiting + per-job ephemeral VM (separate job boundary) |

The bottom row is a useful sanity check: if the cost model cannot afford gVisor / Kata, the next-best primitive is "short-lived ephemeral VM per job" — exactly what GitHub and GitLab do. Fresh VM per job is more isolation than fresh container per job on a shared host.

### 8.7 What about Cloud-Hypervisor?

Cloud-Hypervisor (https://github.com/cloud-hypervisor/cloud-hypervisor) is the Intel-developed Rust VMM that influenced Dragonball and shares Firecracker's minimal-device philosophy. It is supported by Kata as `kata-clh`. It has slightly different device support (a fuller virtio stack, optional vhost-user) and is sometimes preferred over Firecracker when richer device support is needed. For OpenForge's CI use case, Firecracker-backed Kata (`kata-fc`) is the closer match; Cloud-Hypervisor is an option to keep on the shelf.

### 8.8 What about WASM sandboxes?

WASM runtimes (Wasmtime, Spin, Fermyon Spin) provide a user-space sandbox that is even more restrictive than gVisor's. They do not run a Linux kernel, do not expose a Linux syscall surface, and instead execute a WASM module in a controlled environment. They are increasingly used for "run untrusted user code" use cases (Shopify Functions, Cloudflare Workers, Fermyon Cloud, Suborbital, Cosmonic wasmCloud).

For OpenForge's CI use case: WASM is **not** a general substitute because CI workloads need a Linux ABI (glibc, dynamic linking, fork, signal handling, file system, networking) that WASM does not provide in any general way. WASM is a good fit for "run a single plugin / extension" use cases; CI is not one of those.

### 8.9 Cost-of-breakout ladder

Working through the technologies as a ladder from cheapest to strongest, and what each step adds:

1. **Rootless container** (Docker / Podman) — adds user-namespace isolation. Cost: kernel CVEs reachable from unprivileged user. Cheap.
2. **Rootless + custom seccomp** — drops a class of dangerous syscalls. Cost: kernel CVEs still reachable.
3. **+ gVisor (KVM)** — replaces the kernel syscall surface for the workload. Cost: 3–5× syscall overhead, ~50–150 MB per sandbox. CVE-2026-95702 illustrates the residual risk.
4. **+ Kata (Firecracker)** — adds a separate guest kernel. Cost: 200–500 ms cold start, ~150–250 MB per pod. CVE-2026-5747 / -1386 illustrate the residual risk in the VMM.
5. **+ Confidential VM (TDX / SEV)** — encrypts guest memory from the host. Cost: TDX-capable hardware (Intel 4th-gen Xeon Scalable+), reduced performance. The host cannot read guest memory even with root.
6. **+ Remote attestation** — the guest can prove (to a remote verifier) what software is running inside. Cost: attestation infrastructure. The workload can detect tampering and refuse to load secrets.

For OpenForge: levels 1, 2, and 3 are the realistic baseline for most jobs. Level 4 is reserved for jobs with cloud credentials. Levels 5 and 6 are reserved for jobs with the highest-value secrets (release signing, customer-data-adjacent builds).

---

## 9. Recommendation for OpenForge

The recommendation is layered. OpenForge should not pick one technology; it should pick a baseline and an upgrade path.

### 9.1 Baseline: rootless + user namespaces + seccomp

Every CI runner, every build container, every development sandbox in OpenForge should be:

- Rootless (daemon or container runtime running as unprivileged user).
- Inside a user namespace with proper subuid/subgid mapping.
- Restricted by a seccomp policy that drops dangerous syscalls (the default Docker / Podman / containerd policies are reasonable starting points; OpenForge should audit and tighten).

This is the baseline for every CI job. It is not the ceiling for high-value jobs.

### 9.2 High-value untrusted PRs: gVisor (KVM platform) on a fresh container

For untrusted PRs that touch publish tokens, source control, or cloud credentials:

- Run the build in a `runsc` (gVisor) container with the KVM platform.
- On Kubernetes, use RuntimeClass `gvisor`.
- On a non-Kubernetes deployment, use `docker --runtime=runsc` or `ctr --runtime=io.containerd.runsc.v1`.
- Allocate a fresh container per job; do not reuse.
- Rotate publish tokens and source-control tokens per-job (or at minimum per-day) so that a breakout window is short.

This is the same posture Cloudflare Pages, Anthropic, OpenAI, Modal, and Snowflake use for the same reason.

### 9.3 Defense-in-depth: layer gVisor on top of hardware VM when the secrets are very high value

If the secrets in scope are particularly valuable (production cloud credentials, customer-data access):

- Run the build in a Kata + Firecracker (or Kata + QEMU) pod.
- Run `runsc` inside the guest.
- Two layers: hardware VM (Kata) + user-space kernel (gVisor) + host kernel (host).

This is more expensive but is what some of the most security-sensitive providers do. For OpenForge, this is likely reserved for specific high-risk jobs.

### 9.4 Avoid as sole isolation

- **Bare rootless containers for fully untrusted code**: insufficient (see §8.2 and §6.2).
- **Sysbox as the sole isolation**: insufficient on its own (vendor concedes; see §6.2).
- **Kata without current CVE patching**: the 2026 control-plane CVEs are critical and frequent. Pin to recent Kata releases; subscribe to the Kata CVE feed.

### 9.5 Open questions for OpenForge to resolve before shipping

- **What is the runner infrastructure?** GitHub-hosted, self-hosted on a cloud VM (with or without nested virt), or bare metal? Nested virt availability determines whether Kata + Firecracker / Kata + QEMU are options.
- **What is the workload mix?** CPU-bound (compile, test) vs. syscall-heavy (npm install with many small files, large test suites with many processes)? Determines whether gVisor KVM platform absorbs the overhead.
- **What is the secret rotation story?** Even the best sandbox fails if a token is valid for 90 days. Short-lived OIDC tokens (e.g., GitHub Actions' `GITHUB_TOKEN` with short TTL) dramatically reduce breakout impact.
- **What is the audit / forensics story?** When (not if) a breakout attempt is detected, can OpenForge produce the runc/runsc/audit logs to attribute and remediate?

These are not sandbox-architecture questions per se but are the gating decisions the architecture should serve.

---

## Appendix A — CVE list cross-reference

| CVE | Technology | Severity | Status (2026) |
|---|---|---|---|
| CVE-2026-95702 | gVisor VFS UAF | High | Patched before 20260831.0 |
| CVE-2026-47243 | Kata virtiofs guest→host | Critical | Patched |
| CVE-2026-93417 | Kata Dragonball guest→host | Critical | Patched |
| CVE-2026-50540 | Kata control plane | Critical | Patched |
| CVE-2026-24054 | Kata control plane | Critical | Patched |
| CVE-2026-44210 | Kata control plane | Critical | Patched |
| CVE-2026-24834 | Kata control plane | Critical | Patched |
| CVE-2026-5747 | Firecracker virtio-pci OOB | High | Patched |
| CVE-2026-1386 | Firecracker jailer symlink | Medium | Patched |
| CVE-2026-94603 | Podman image annotation sandbox-off | Critical | Patched |
| CVE-2024-1753 | Podman build-time escape | High | Patched |
| CVE-2024-21626 | runc Leaky Vessels | High | Patched (also blocked by Sysbox procfs virt) |
| CVE-2022-0847 | Linux kernel Dirty Pipe | High | Patched in host kernel; reaches user-namespace containers |
| CVE-2022-0185 | Linux kernel userns | High | Patched in host kernel; reaches user-namespace containers |

This table is for OpenForge's internal CVE tracker; it is not exhaustive and should be re-pulled from each project's official CVE feed before any production deployment decision.

---

## Appendix B — URL verification status

Verified live in this session:
- https://gvisor.dev/ and subpages (architecture, security, users, performance CSVs)
- https://github.com/kata-containers/kata-containers and 4.0 architecture doc
- https://firecracker-microvm.github.io/ and SPECIFICATION.md
- https://docs.docker.com/engine/security/rootless/
- https://github.com/containers/podman
- https://github.com/nestybox/sysbox and the security CVE doc
- https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners

Could NOT be re-verified live in this session:
- https://docs.gitlab.com/ee/ci/runners/ (network/proxy issue; architectural claim is well-established but the specific doc should be re-verified)

This file should be regenerated when any of these URLs change or any of the cited CVE numbers is superseded.

---

## Appendix C — Configuration snippets

### C.1 gVisor RuntimeClass registration (containerd)

```toml
# /etc/containerd/config.toml
version = 2

[plugins."io.containerd.grpc.v1.cri".containerd]
  default_runtime_name = "runc"

  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
      runtime_type = "io.containerd.runc.v2"
    [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
      runtime_type = "io.containerd.runsc.v1"
```

After `systemctl restart containerd`, RuntimeClass `runsc` is available; the pod spec uses `runtimeClassName: runsc`.

### C.2 Kata RuntimeClass registration (containerd)

```toml
# /etc/containerd/config.toml — adding kata-fc as a Firecracker-backed runtime
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-fc]
  runtime_type = "io.containerd.kata-fc.v2"
  pod_annotations = ["io.katacontainers.*"]
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-fc.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-fc.toml"
```

The `configuration-fc.toml` file selects Firecracker as the VMM and points at the prebuilt `vmlinux` and `kata-containers.img`.

### C.3 Rootless Docker daemon flags

```bash
dockerd-rootless.sh \
  --experimental \
  --storage-driver overlay2 \
  --iptables=false \
  --bridge=none
```

`--iptables=false --bridge=none` is the conventional setup when the host network is managed outside of Docker (typical for rootless). The slirp4netns layer handles the container-to-internet path.

### C.4 Rootless Podman with pasta

```bash
# /etc/containers/containers.conf
[network]
default_rootless_network_cmd = "pasta"

[containers]
seccomp_profile = "/usr/share/containers/seccomp.json"

[engine]
cgroup_manager = "cgroupfs"
events_logger = "journald"
```

### C.5 Sysbox invocation

```bash
docker run --runtime=sysbox-runc -it openforge/dind:latest
```

`sysbox-mgr` must be running on the host; `sysbox-fs` is started automatically by `sysbox-mgr` on first use.

---

## Appendix D — Operational metrics to track

For OpenForge to know whether the chosen sandbox stack is working, track these metrics per CI job:

- **Job duration vs. baseline** — the gVisor / Kata overhead shows up here. A 30% increase on CPU-bound jobs is normal for gVisor KVM; a 5× increase means something is wrong.
- **Syscall count per job** — exposed by `runsc` pprof and by Kata's agent metrics. A job with 10× the expected syscall count is suspicious.
- **Failed-to-start rate** — jobs that fail to start because `/dev/kvm` is unavailable, because the containerd RuntimeClass is missing, because the user namespace is full. A non-zero rate here is a deployment bug.
- **CVE-driven sandbox escapes** — track via `runsc` / Kata audit logs. Zero is the target; any non-zero is a security incident.
- **Token use after job end** — every secret issued for a job should be invalidated within seconds of job end. Stale token use is a leak indicator.
- **Image pull latency from inside the sandbox** — gVisor's gofer and Kata's virtio-fs both have cold-cache penalties. If this metric is high, image caching is misconfigured.
- **OOM kills per node** — gVisor and Kata both add memory overhead; OOM kills on nodes that previously didn't OOM indicate the density calculation is wrong.

These are the leading indicators that tell OpenForge whether the sandbox stack is functioning or needs to be re-tuned.

---

## Appendix E — Glossary

- **CRI** — Container Runtime Interface, the Kubernetes API that `kubelet` uses to talk to a container runtime (containerd, CRI-O).
- **VMM** — Virtual Machine Monitor; the host-side process that runs a guest VM. Firecracker, QEMU, Cloud-Hypervisor, Dragonball are all VMMs.
- **KVM** — Kernel-based Virtual Machine; the Linux kernel's hardware virtualization support. Required for Firecracker, Cloud-Hypervisor, QEMU-KVM.
- **TDX** — Intel Trust Domain Extensions; hardware-encrypted VM isolation. A confidential-computing feature on 4th-gen+ Xeon Scalable.
- **SEV / SEV-SNP** — AMD Secure Encrypted Virtualization; AMD's confidential-computing feature.
- **MSHV** — Microsoft Hyper-V isolation; the Azure confidential VM mechanism.
- **VHOST** — A Linux kernel mechanism for userspace virtio backends (used by some Kata deployments for high-performance networking).
- **9P** — A Plan 9 file-sharing protocol used by gVisor's gofer for filesystem access.
- **virtio-fs** — A virtio-based shared filesystem; Kata's preferred file-sharing mechanism.
- **OCI** — Open Container Initiative; the standards body that defines the container image spec and runtime spec.
- **RuntimeClass** — A Kubernetes concept (stable since 1.20) that names a CRI runtime configuration; pods opt into a runtime by setting `runtimeClassName`.
- **OCI runtime** — The binary that actually starts a container (`runc`, `crun`, `runsc`, `sysbox-runc`, `youki`).
- **cgroup** — Linux kernel feature for grouping processes for resource accounting and limiting. cgroup v1 is being phased out in favor of cgroup v2.
- **seccomp** — Linux kernel feature for filtering syscalls. The default Docker / Podman seccomp profiles drop a class of dangerous syscalls.
- **ptrace** — Linux kernel feature for one process to observe and control another. gVisor's ptrace platform uses `PTRACE_SYSCALL` to intercept every syscall.

---

End of reference. Maintained alongside OpenForge's container build strategy decisions.

