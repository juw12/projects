# Container Sandboxing for OpenForge's CI Runner - Evidence-Based Landscape Brief (2026)

**Project:** OpenForge (github.com/juw12/openforge) - self-hosted Git platform, TypeScript.
**Decision in scope:** which execution primitive the CI runner spawns per job/step to contain *untrusted user-supplied code*.
**Date of evidence:** 2026-11-03. All version tags, CVE IDs, and licenses retrieved live from the GitHub API and project primary docs on this date.
**Evidence standard:** every benchmark carries a URL; every CVE carries a GHSA-/CVE- ID. Where no public number exists, this brief says *"no public benchmark found"* rather than inventing one. No single primitive is mandated - Section 9 maps the evidence to OpenForge's concrete constraints so the owner decides.

---

## The five primitives at a glance

| # | Primitive | Vendor / home | Family | One-line |
|---|-----------|---------------|--------|----------|
| 1 | **gVisor** | Google | Userspace application kernel (`runsc`) | Linux-compatible syscall interception in Go, no VM |
| 2 | **Kata Containers** | OpenInfra Foundation (Intel/IBM origin) | Lightweight VM (`containerd` shimv2) | Real guest kernel + hypervisor, container UX |
| 3 | **Firecracker** | AWS | Minimal KVM VMM | microVM, hardware-virt boundary, <=125 ms boot |
| 4 | **Rootless Docker / Podman** | Linux Foundation / Red Hat | Native `runc`/`crun` in user-namespace | Unprivileged standard container, no VM |
| 5 | **Sysbox** | Nestybox (acquired by Docker 05/2022) | Hardened `runc` fork (`sysbox-runc`) | User-namespace + VM-like workloads (DinD/systemd) |

**Why these five:** gVisor, Kata, and Firecracker are the three dominant "stronger-than-runc" isolation families (userspace kernel / light VM / minimal VMM). Rootless and Sysbox represent the two ways to harden a *native* container without a hypervisor (unprivileged user-namespace, and user-namespace + VM-like shim respectively). Together they span the realistic option space for a CI runner that must run code it does not trust.

---

## 1. gVisor (Google)

### 1.1 What it is and the threat model it claims to solve

gVisor is an **application kernel written in Go** that intercepts the container's system calls in userspace and services them itself, instead of forwarding them to the host kernel. The project is explicit that it is *neither* a syscall filter (seccomp-bpf) *nor* a hardware VM: it "takes a distinct third approach ... providing many security benefits of VMs while maintaining the lower resource footprint, fast startup, and flexibility of regular userspace applications." Each sandbox is composed of a **Sentry** (the per-sandbox kernel that implements syscalls, memory management, signals, threading) plus one **Gofer** per container (a host process that mediates all filesystem access over the 9P protocol).

The trust model rests on three facts: (1) the Sentry is written in a memory-safe language (Go - no use-after-free, no uninitialized memory, built-in race detector); (2) the Sentry runs inside a restricted seccomp container with no direct filesystem access; and (3) crucially, *"the Sentry does not pass system calls through to the host kernel"* - the user process never talks to the host kernel directly. That removes the entire class of kernel LPE / container-escape bugs (the netfilter, io_uring, TLS, and qdisc CVEs) from the reachable attack surface. gVisor then layers rule-based execution (seccomp) on top for defense-in-depth.

Sources: [What is gVisor?](https://gvisor.dev/docs/) - [Security Model](https://gvisor.dev/docs/architecture_guide/security/)

### 1.2 Cold-start latency

gVisor does **not boot a guest kernel** (there is no VM), so its added startup cost is only initializing the Sentry + Gofer processes. The project's own [Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) runs a `perf.py startup` benchmark (alpine `true`, node, ruby) comparing `runc` vs `runsc` and states the key finding verbatim:

> "most of the time overhead above is associated Docker itself. This is evident with the empty `runc` benchmark. To avoid these costs with `runsc`, you may also consider using `runsc do` mode or invoking the OCI runtime directly."

So gVisor's *incremental* cold-start penalty over a bare OCI runtime is small; the dominant cost is the container manager + image layer. In production framing, Cloudflare (Pages builds) reports: "It takes just a few seconds for a new gVisor container to start up and begin executing meaningful work in a secure sandbox with near native performance" ([Cloudflare blog](https://blog.cloudflare.com/cloudflare-pages-build-improvements/), linked from [gvisor.dev/users](https://gvisor.dev/users/)). **No single authoritative "runsc adds X ms" figure is published** - the guide presents it as relative charts, so none is stated here.

### 1.3 Memory overhead per sandbox

The [Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) measures density (50 concurrent instances, 5 for redis) and states the sandbox "is responsible for a small, mostly fixed amount of memory overhead" - a fixed component (Sentry state) plus a variable component (open fds/sockets). **No single per-sandbox MB number is published in the current docs.** Characterization: structurally lower than a full guest VM, higher than plain `runc`; the Go runtime of the Sentry is the main fixed cost.

### 1.4 Compatibility: arbitrary binaries, Docker images, docker run / build / compose, syscall limits

- Runs ordinary Linux binaries inside an OCI bundle; **accepts a vanilla Docker image**.
- It is an **OCI runtime** (`runsc`), so it plugs into **`docker run --runtime=runsc`**, Kubernetes (`runtimeClassName: gvisor`), `containerd`, and CRI-O. `runsc` implements the OCI runtime spec.
- `docker build` / `docker-compose` are owned by Docker, not gVisor; you run the *step* with the gVisor runtime.
- **Syscall / feature limits (the main trade-off):** "gVisor does not presently implement every system call, `/proc` file, or `/sys` file so some incompatibilities may occur" ([compatibility page](https://gvisor.dev/docs/user_guide/compatibility/)). The perf guide adds that syscall-heavy and some I/O-bound workloads (e.g. Redis small ops, static file serving) show the largest overhead. GPU support exists but is special-cased ([GPU support doc](https://gvisor.dev/docs/user_guide/gpu/)).

### 1.5 Kernel requirements

**None for the default deployment.** The `ptrace` platform "works everywhere and does not require hardware virtualization or kernel modifications" but has the highest structural costs; `systrap` (seccomp-unotify) is recommended for most cases; the `KVM` platform gives low syscall-interception overhead but "runs poorly with nested virtualization." **Takeaway for OpenForge: gVisor runs on a commodity cloud VM with no nested-virt dependency** - a major ops advantage over the VM-based options.

### 1.6 Operator story

Install `runsc`, register it as a Docker/K8s runtime. There is a dedicated [Production guide](https://gvisor.dev/docs/user_guide/production/), [Observability](https://gvisor.dev/docs/user_guide/observability/) (Prometheus metrics), [Checkpoint/Restore](https://gvisor.dev/docs/user_guide/checkpoint_restore/) (used by adopters such as Tines 3B for fresh single-use sandboxes), and a [Rootless](https://gvisor.dev/docs/user_guide/rootless/) mode. Updates are release-by-release (dated tags). Relatively low ops complexity vs a VM hypervisor stack.

### 1.7 CVE / vulnerability history (since 2023)

gVisor publishes its security record on [gvisor.dev/security-track-record](https://gvisor.dev/security-track-record/) rather than as GitHub repo advisories (the repo shows **0** repo-published GHSAs). Three data points:

1. **gVisor's own CVE in the window:** **CVE-2026-95702** (8.5) - "A use-after-free in the gVisor VFS layer allows a local attacker to double-free the backing `MemoryFile` of an in-sandbox overlay filesystem and execute code in the Sentry." Fixed in release **20260831.0**; the compromised Sentry "remains confined by host seccomp filters and namespaces." This is the single gVisor-specific escape-adjacent bug in the 2023+ window.
2. **Kernel-CVE defense track record** (what gVisor is *for*): it reports defending/mitigating the large majority of high-impact Linux kernel CVEs - 2022 **16/17**, 2023 **13/13**, 2024 **19/20**, 2025 **28/28**, 2026 **25/27** ("Defended 95% / Patched 4% / Mitigatable 1% / Vulnerable 0%").
3. Historical gaps it had to patch itself: **CVE-2021-30465** (runc/runsc symlink-exchange rootfs breakout - "Patched") and **CVE-2024-0132** (bad symlink handling in a malicious image on GPU containers - "VM Runtime Prevented: Yes").

**Read:** the security model is strong *by construction* (userspace kernel); its own CVE surface in 2023+ is a single 2026 UAF (fixed); and it neutralizes the stream of kernel escapes that directly threaten `runc`-style runtimes.

### 1.8 Production deployments (named)

From the official [Who's Using gVisor](https://gvisor.dev/users/):
- **Google** - GKE Sandbox, Cloud Run, App Engine; "millions of gVisor sandbox instances running daily."
- **Anthropic** - contains code execution in claude.ai ([engineering post](https://www.anthropic.com/engineering/how-we-contain-claude)).
- **OpenAI** - "some higher-risk tasks such as code execution."
- **Modal** - "Compute jobs at Modal are containerized and virtualized using gVisor."
- **Snowflake** - Snowpark execution sandbox (runs untrusted user code, multi-tenant).
- **Cloudflare** - Pages builds. **DigitalOcean** - App Platform. **Ant Group** - production at scale.
- **Docker** - Docker Desktop netstack + gVisor-as-runtime on Linux. **Tailscale** - userspace netstack. **Grist**, **Beam**, **Tines 3B**, **Deductive**, **Northflank**, **Blink**, **Freedom of the Press Foundation (Dangerzone)**.

This is the **deepest anchor set in the untrusted-code-execution space** - directly the OpenForge use case.

### 1.9 License and latest version

- **License:** Apache-2.0 (verified via `gh api` -> `license.spdx_id`).
- **Latest stable:** `release-20261102.0`, published **2026-11-02** (dated release scheme; the CVE-2026-95702 fix landed in 20260831.0, already behind HEAD).

---

## 2. Kata Containers

### 2.1 What it is and the threat model it claims to solve

Kata builds a **real lightweight virtual machine per container/pod**: a guest kernel plus a `kata-agent` inside the VM, fronted by a `containerd` shimv2 runtime. The tagline is "The speed of containers, the security of VMs" ([katacontainers.io](https://katacontainers.io/)). The threat model is the **hardware-virtualization boundary (KVM)**: "Runs in a dedicated kernel, providing isolation of network, I/O and memory and can utilize hardware-enforced isolation with virtualization VT extensions." Since Dec 2017 it merges Intel Clear Containers + Hyper.sh RunV.

In 4.0 the runtime was rewritten in **Rust** (`runtime-rs` / "RunD"), made asynchronous (Tokio), with the **Dragonball** VMM built in as the default (single-process, no IPC). The 4.0 architecture doc is explicit: "the security boundary remains established by the hypervisor (hardware virtualization). The shift to a monolithic process model does not compromise isolation; rather, it improves the integrity of the control plane."

Sources: [README](https://github.com/kata-containers/kata-containers/blob/main/README.md) - [4.0 architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture_4.0/architecture.md)

### 2.2 Cold-start latency

Kata boots a **guest OS**, so it is structurally slower than gVisor/runc. The current docs are **qualitative, not numeric**: the [Dragonball README](https://github.com/kata-containers/kata-containers/blob/main/src/dragonball/README.md) lists "minimal startup time" and "optimized concurrent startup speed," and the 4.0 doc says the single-binary Rust runtime with built-in Dragonball achieves "significantly reduced startup times" (eliminating cross-process RPC; `dbs-upcall` replaces heavy ACPI hotplug). **No single public "Kata boots in X ms" figure is found in the current primary docs** - none is stated here. Directionally: VM boot >> gVisor, with the 4.0/Dragonball work narrowing the gap toward Firecracker-class startup.

### 2.3 Memory overhead per sandbox

A **full guest kernel + kata-agent + guest rootfs** per VM, so overhead is higher than gVisor or `runc`. The 4.0 doc quantifies the *thread* overhead win, not MB: sync runtime scales `4 + 12*M` OS threads vs **async `2 + N`**, "significantly lowering memory consumption for high-density pod deployments." Dragonball advertises "low CPU and memory overhead." **No single per-VM MB figure is published** in the docs located.

### 2.4 Compatibility

- **Full Linux compatibility** (it is a real guest kernel) - runs arbitrary binaries; this is its strength over gVisor's syscall subset.
- **OCI image support** + **Kubernetes CRI**; drop-in `containerd-shim-v2` (`io.containerd.kata.v2`), plus QEMU / Cloud-Hypervisor / Firecracker as pluggable external VMMs.
- You do not `docker run` Kata directly - you point `containerd`/CRI-O at the Kata shim and select it via a Kubernetes **RuntimeClass**. (Single-host `docker run` is not the native path.)

### 2.5 Kernel requirements

**Requires hardware virtualization.** Supported hosts (from the [README](https://github.com/kata-containers/kata-containers/blob/main/README.md)): x86_64 (Intel VT-x / AMD SVM), aarch64 (ARM Hyp), ppc64le (IBM Power), s390x (IBM Z). `kata-runtime check` validates host capability. **Consequence for OpenForge:** runner hosts must expose nested/virtualization (bare-metal, or VMs with HW-virt passthrough) - a hard dependency that gVisor/Podman/Sysbox do not have.

### 2.6 Operator story

More moving parts: runtime + agent + hypervisor + guest kernel + rootfs (built via `osbuilder`), one config file, `kata-deploy` Helm chart for Kubernetes, multiple hypervisor backends to keep current, `kata-debug` for cluster forensics. Heavier to operate and keep patched than a userspace runtime.

### 2.7 CVE / vulnerability history (since 2023) - verified per-advisory

Kata publishes **repo security advisories**. I pulled the live list from GitHub (`/repos/kata-containers/kata-containers/security-advisories`, 13 entries). The **2026 cluster is concentrated in the guest<->host boundary (VMM virtio path + virtiofs) and in annotation/config -> mount policy**, with several **critical** items:

| CVE | Sev | Date | Theme |
|-----|-----|------|-------|
| **CVE-2026-47243** | critical | 2026-05-21 | `runtime-rs`: **guest-root -> host-root escape via virtiofs** |
| **CVE-2026-50540** | critical | 2026-07-20 | Config-Path Annotation **Arbitrary File Loading** |
| **CVE-2026-41326** | critical | 2026-04-22 | **CopyFile policy subversion via symlinks** |
| **CVE-2026-24054** | critical | 2026-01-29 | Malformed/no-layer image -> **host block device hotplugged to VM** |
| **CVE-2026-24834** | critical | 2026-02-19 | Kata **container -> guest microVM privilege escalation** |
| CVE-2026-86072 | high | 2026-07-21 | Untrusted **pod annotation bind-mounts any host path** into guest, bypassing allowlist |
| CVE-2026-77176 | high | 2026-08-20 | Generated policy allows mounting **attacker-chosen guest paths** |
| CVE-2026-93417 | high | 2026-07-21 | **Dragonball**: missing length validation in **virtio-blk** -> **guest-to-host VM escape** |
| CVE-2026-44210 | medium | 2026-05-20 | **VM escape via virtiofsd** / argument injection through default-enabled pod annotations |
| CVE-2026-64676 | medium | 2026-07-21 | `kata-agent` mem-agent ttRPC not policy-enforced -> untrusted host tampers with **confidential-guest memory** |
| CVE-2025-58354 | medium | 2025-09-23 | **coco-tdx**: malicious host circumvents **initdata verification** |
| (no CVE) | high | 2026-10-21 | Unintended host+guest changes via **permissive annotation allowlist** |
| (no CVE) | medium | 2026-10-21 | **Dragonball**: guest-to-host escape via OOB in several **virtio drivers** |

**Read:** Kata delivers the strongest isolation *boundary* (hardware virt) but in 2023+ accumulated the **most published escape-relevant CVEs of the five**, mostly in the VMM/virtio and virtiofs data path and in annotation-driven host-path mounting. Choosing Kata means inheriting a fast-moving CVE surface in exactly the code that contains your untrusted jobs - you must track `kata-containers` advisories tightly.

### 2.8 Production deployments (named)

- **Baidu** - "running Kata Containers in production to support Function Computing, Cloud Container Instances, and Edge Computing" ([katacontainers.io -> PDF](https://katacontainers.io/collateral/ApplicationOfKataContainersInBaiduAICloud.pdf)).
- Stewarded by the **Open Infrastructure Foundation**; integrates with **OpenStack / containerd / Kubernetes RuntimeClass**. Fewer high-profile *untrusted-code* anchors than gVisor/Firecracker; anchor strength is in cloud IaaS + confidential-computing.

### 2.9 License and latest version

- **License:** Apache-2.0 (verified).
- **Latest stable:** **4.3.1**, published **2026-10-21**.

---

## 3. Firecracker (AWS)

### 3.1 What it is and the threat model it claims to solve

Firecracker is a **minimal KVM-based VMM** (Rust) that runs workloads in **microVMs**, purpose-built for "secure, multi-tenant, minimal-overhead execution of container and function workloads." Its security posture is explicit in the [design doc](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md): "all vCPU threads are considered to be running malicious code as soon as they have been started." Containment is layered: **KVM hardware boundary** + per-thread **seccomp** (default, bare-minimum syscall set) + **cgroups/namespaces** + the **jailer** (sets up chroot/cgroup, drops privileges, then `exec`s Firecracker as unprivileged). The minimalist device model (only virtio-net/block/vsock/serial + MMDS) is a deliberate attack-surface reduction.

### 3.2 Cold-start latency - hard, CI-enforced numbers

From the [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) (enforced by integration tests on M5D.metal / M6G.metal), for a 1-vCPU / 128 MiB microVM:
- **VMM process up (to API socket): <= 8 CPU ms** (wall 6-60 ms, typical ~12 ms).
- **Boot: <= 125 ms** from `InstanceStart` to guest `/sbin/init` (minimal kernel + rootfs, serial disabled).

From the [design doc](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md): steady **mutation rate of 5 microVMs per host core per second** (~180/s on a 36-core host). Guest CPU perf **> 95%** of bare metal; network adds **~0.06 ms** latency, up to 14.5-25 Gbps. These are the **only hard cold-start + throughput numbers in this brief** - self-published and CI-enforced. (Historical AWS context: the [NSDI'20 paper](https://www.usenix.org/conference/nsdi20/presentation/agache) reports the original ~800 ms / 500 microVMs-per-host-per-second figures; the current spec is tighter.)

### 3.3 Memory overhead per sandbox

SPECIFICATION.md: **VMM threads <= 5 MiB** (1 vCPU / 128 MiB microVM, Firecracker-tuned kernel), tested in CI with a "memory cop." Add the **guest kernel + guest rootfs RAM** (you choose the microVM size, default 128 MiB). So the *virtualization* overhead is ~5 MiB; the *guest* footprint is whatever you provision.

### 3.4 Compatibility

- Runs any Linux binary **inside the guest kernel**.
- **It is a VMM, not a container runtime** - you do **not** `docker run` Firecracker directly. You use it through an integration: **Kata Containers** (as an external VMM), **firecracker-containerd**, **Flintlock**, or AWS Lambda/Fargate. Docker images work when converted to a guest rootfs (the integrations handle OCI). **No native `docker build` / `docker-compose` story** - those belong to the layering runtime.
- Device model is minimal: **no easy GPU / arbitrary device passthrough** (a real constraint vs Kata/gVisor for GPU steps).

### 3.5 Kernel requirements

**Requires KVM (hardware virtualization).** Tested on **bare-metal** AWS instances (m5n/m6i/m7i/m8i metal, m6a/m7a, Graviton m6g-m9g) with host kernels **5.10 / 6.1 / 6.18** ([README](https://github.com/firecracker-microvm/firecracker/blob/main/README.md)). Nested virt is not the target. **OpenForge runner hosts need HW-virt exposure.**

### 3.6 Operator story

Single static binary + **jailer** for production; OpenAPI control plane; per-VM logs + metrics over named pipes (with `lost-logs`/`lost-metrics` counters); releases **every 2-3 months**; a [prod host setup doc](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md) is provided. Lighter than Kata's multi-component stack, but you must build (or adopt) the containerd/OCI layer yourself for CI.

### 3.7 CVE / vulnerability history (since 2023)

Firecracker publishes **repo advisories** - the **fewest of the five** (consistent with the minimal device model). Live list:

| CVE | Sev | Date | Theme |
|-----|-----|------|-------|
| **CVE-2026-5747** | high | 2026-04-07 | **Out-of-bounds write in virtio-pci transport** |
| **CVE-2026-1386** | medium | 2026-01-23 | **Arbitrary host file overwrite via symlink in the Jailer** |

Both are 2026, both boundary-adjacent (virtio-pci, jailer). **No guest-to-host escapes published in the 2023+ window** in the repo advisories retrieved - materially cleaner than Kata's 2026 cluster.

### 3.8 Production deployments (named)

- **AWS Lambda** and **AWS Fargate** - "deployed ... where it supports millions of production workloads, and trillions of requests per month" ([NSDI'20 paper](https://www.usenix.org/conference/nsdi20/presentation/agache); confirmed in the [README](https://github.com/firecracker-microvm/firecracker/blob/main/README.md)).
- Also used as an external VMM by **Kata Containers** and by **Flintlock** (LiquidMetal).

### 3.9 License and latest version

- **License:** Apache-2.0 (verified).
- **Latest stable:** **v1.17.0**, published **2026-09-10**.

---

## 4. Rootless Docker / Podman

### 4.1 What it is and the threat model it claims to solve

This is a **standard OCI container** (`runc`/`crun`) run **without root**, via **Linux user namespaces**. Podman's [README](https://github.com/containers/podman/blob/main/README.md) states the model precisely:

> "When run without root, Podman containers use user namespaces to set root in the container to the user running Podman. Rootless Podman runs locked-down containers with no privileges that the user running the container does not have ... rootless containers will never have more privileges than the user that launched them."

Threat model: the container's root maps to an **unprivileged host user**, and there is **no daemon** ("No manager daemon, for improved security and lower resource utilization at idle"). It is the *weakest* isolation of the five - the **host kernel is still shared**, so a kernel LPE or a runtime escape still reaches the host (bounded to what the launching user can do).

### 4.2 Cold-start latency

**Identical to plain `runc`/`crun`** (tens of ms) - there is no extra sandbox layer (no guest kernel, no userspace kernel). Rootless adds user-namespace setup + (typically) a `slirp4netns`/`pasta` networking process, a minor constant. **No separate "rootless overhead" benchmark is published** - it *is* the container runtime.

### 4.3 Memory overhead per sandbox

**= the container process** (runc/crun + conmon). **No VM, no Sentry.** Lowest fixed overhead of the five. (Storage via `fuse-overlayfs`/`vfs` in rootless mode can add some CPU, not resident memory.)

### 4.4 Compatibility (best-in-class)

- **Vanilla `docker run` semantics:** Podman is a **Docker-compatible CLI** (`podman run` ~ `docker run`), runs **OCI + Docker images**.
- **`docker build`** -> **Buildah** (Podman uses Buildah's API; builds run without root). **`docker-compose`** -> **podman-compose** / Compose spec.
- Rootless **networking** goes through **`pasta`** (passt) - slower than kernel bridges, and **ports < 1024 need host forwarding** (a CI gotcha). Storage via `fuse-overlayfs`/`vfs`.
- **Syscall coverage: full** (native kernel) - but the container can only do what the **unprivileged user** can (that is the model).

### 4.5 Kernel requirements

**None of the heavy kind:** no HW virt, no KVM, no nested virt, no custom kernel. Needs **user namespaces enabled** (default on modern distro kernels). Easiest kernel story of the five.

### 4.6 Operator story

**Simplest.** Package-manager install, `podman` or a rootless `dockerd` (rootless Docker via rootlesskit). No daemon to run (Podman). Fedora/RHEL default. The main ops care is keeping **`runc`/`crun`, the host kernel, and Podman** patched.

### 4.7 CVE / vulnerability history (since 2023)

Podman publishes **repo advisories**. Live list (critical/high highlighted):

| CVE | Sev | Date | Theme |
|-----|-----|------|-------|
| **CVE-2026-94603** | **critical** | 2026-09-29 | **`podman run` can be instructed to disable almost all sandboxing - including user-requested sandboxing - by an image annotation** |
| **CVE-2026-57231** | high | 2026-06-24 | Malformed image tricks `podman run` into **leaking host env vars** into the container |
| CVE-2025-9566 | high | 2025-09-04 | `podman kube play` **symlink traversal** |
| CVE-2025-6032 | high | 2025-06-24 | `podman machine` missing **TLS verification** |
| **CVE-2024-1753** | high | 2024-03-18 | **Container escape at build time** |
| CVE-2026-19730 | medium | 2026-08-13 | `quadlet install --replace` does not fully replace the old file |
| CVE-2026-55686 | medium | 2026-06-17 | `WORKDIR` **symlink traversal** |
| CVE-2026-33414 | low | 2026-04-14 | PowerShell command injection in Podman HyperV Machine |
| CVE-2022-27649 | low | 2022-04-01 | Default inheritable capabilities should be empty |

**Plus the runtime it uses:** because rootless Podman/Docker run **`runc`/`crun`**, you also inherit **runc** CVEs - e.g. **CVE-2024-21626** (runc breakout via `process.cwd` + leaked fds, fixed runc 1.1.12) and historically **CVE-2019-5736**.

**Read:** the isolation is only as strong as (a) the host kernel's user-namespace and (b) the runtime binary. **CVE-2026-94603 is the one to note for a CI runner: an attacker-controlled *image annotation* can disable sandboxing** - you must pin/validate image sources and Podman version.

### 4.8 Production deployments (named)

- **Podman is the default container tool on Fedora and RHEL** (Red Hat); a **CNCF / Linux Foundation** project, ubiquitous in **CI** (rootless runners, buildx-style workflows).
- **Rootless Docker** (rootlesskit) is widely used for unprivileged CI/CD.

### 4.9 License and latest version

- **License:** **Apache-2.0** for Podman (and for the Moby engine Docker is built on). Note **Docker Desktop is proprietary** - relevant only if you ship a desktop, not for a Linux CI runner.
- **Latest stable:** **Podman v6.1.4**, published **2026-10-12** (4 major/minor releases/yr: Feb/May/Aug/Nov; patches more often, all PGP-signed).

---

## 5. Sysbox (Nestybox / Docker)

### 5.1 What it is and the threat model it claims to solve

Sysbox is an **open-source, free container runtime - a specialized "runc" forked from OCI runc in early 2019** (written in Go: `sysbox-runc`, `sysbox-fs`, `sysbox-mgr`). Per the [README](https://github.com/nestybox/sysbox/blob/master/README.md) it does two things:

1. **Hardens isolation** - "Linux user-namespace on all containers (i.e., root user in the container has zero privileges on the host)," virtualizes parts of procfs/sysfs, hides host info, locks initial mounts.
2. **Enables containers to run VM-like workloads** - "systemd, Docker, Kubernetes, K3s, buildx ... seamlessly & securely" (i.e. **Docker-in-Docker / Kubernetes-in-Docker without privileged containers or host-socket mounts**).

It **does not use VMs or hardware virtualization**. Its own framing of isolation: "stronger than regular Docker containers ... but weaker than VMs (by sharing the Linux kernel)." Nestybox was **acquired by Docker (05/2022)**; Sysbox Enterprise was folded into **Docker Desktop "Hardened Desktop."**

### 5.2 Cold-start latency

The README: "The containers created by Sysbox have similar performance to those created by the OCI runc." **No public single-number cold-start benchmark is found** - treat as **runc-equivalent** (tens of ms), with a light user-space OS-shim cost. (Its headline efficiency claim is **2x the density of VMs** for system-containers - [Nestybox perf blog](https://blog.nestybox.com/2020/09/23/perf-comparison.html).)

### 5.3 Memory overhead per sandbox

**runc-equivalent** (no guest kernel, no userspace kernel). The same blog claims a system-container uses "a fraction of the memory and storage" of a VM. **No single per-sandbox MB figure is published.**

### 5.4 Compatibility (the differentiator)

- **Vanilla `docker run --runtime=sysbox-runc <any_image>`** - a **drop-in OCI runtime**; also CRI-O / K8s `runtimeClassName: sysbox-runc`. Places **no requirements on the image.**
- **Best-in-class for CI:** lets a job run **Docker-in-Docker / buildx multi-arch / systemd / inner Kubernetes** **without `--privileged` and without mounting the host Docker socket** - the classic secure-CI problem. This is the one primitive where "run a container that itself runs containers" is a first-class, non-privileged feature.
- Full syscall coverage (it is runc-based) but with **procfs/sysfs virtualization** and **selective syscall trapping**.

### 5.5 Kernel requirements

**No HW virt, no KVM, no nested virt, no custom kernel.** **But** - and this is the key caveat - its isolation **depends on the host kernel's user-namespace being secure.** Sysbox's own [Security & CVE doc](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security-cve.md) is explicit that **kernel user-namespace / pipe CVEs "can negate the extra isolation of containers deployed with Sysbox."** So you must run a **patched kernel** (see CVE table below).

### 5.6 Operator story

Install via package or `sysbox-deploy-k8s` daemonset; **lives side-by-side with runc/Kata** on the same host (pick per-pod via runtime class). Best-effort support (community; Docker subscriptions do not include it). Simpler than Kata's hypervisor stack; comparable to adding a second OCI runtime.

### 5.7 CVE / vulnerability history (since 2023)

Sysbox publishes **no repo GHSA advisories** (0); its security model is documented in the [security-cve.md](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security-cve.md) doc, which is unusually honest that **its isolation is bounded by the host kernel**:

| CVE | Affects Sysbox? | Why / note |
|-----|-----------------|-----------|
| **CVE-2022-0185** (user-namespace escape) | **Yes** | "can negate the extra isolation ... as they always use the Linux user-namespace." Fixed in kernel (01/2022). |
| **CVE-2022-0847** (Dirty Pipe) | **Yes** | Voids the user-namespace protection; fixed in 5.16.11 / 5.15.25 / 5.10.102. |
| CVE-2022-0492 (cgroups v1) | **No** | Sysbox blocks `release_agent` writes via user-namespace. |
| CVE-2022-0811 (CRI-O "CR8" sysctl escape) | Cluster (via CRI-O) | Fixed in `sysbox-deploy-k8s` v0.5.1+. |
| **CVE-2024-21626** (runc breakout) | **No** | Sysbox does not leak host fds + always uses user-namespace. |

**Read:** Sysbox has essentially **no standalone CVEs in this window** - its risk is **inherited from the host kernel** (user-namespace class) and, on Kubernetes, from the bundled CRI-O. For an untrusted-code runner that is a real consideration: you are only as safe as your kernel's userns.

### 5.8 Production deployments (named)

- **Docker** - acquired Nestybox (05/2022); Sysbox underpins **Docker Desktop "Hardened Desktop."** ([Docker blog](https://www.docker.com/blog/docker-advances-container-isolation-and-workloads-with-acquisition-of-nestybox/))
- Community/best-effort otherwise; fewer large *public* untrusted-code anchors than gVisor/Firecracker.

### 5.9 License and latest version

- **License:** **Apache-2.0** - verified from the actual [LICENSE file](https://github.com/nestybox/sysbox/blob/master/LICENSE): "Copyright 2020 Nestybox, Inc. Licensed under the Apache License, Version 2.0." (Matters for OpenForge's MIT/Apache stance: it is clean permissive, **not** GPL.)
- **Latest stable:** **v0.7.1**, published **2026-07-31**.

---

## 6. Comparison Table

| Primitive | Cold-start | Mem overhead | Syscall coverage | Kernel req | Best for | Worst for | Notable CVEs (2023+) | Anchor deployments | License | Latest version (date) |
|-----------|-----------|--------------|------------------|-----------|----------|-----------|----------------------|--------------------|---------|-----------------------|
| **gVisor** | Fast; no guest boot; project says most measured startup is Docker's, not runsc's; "few seconds" incl. image work (Cloudflare). *No single ms figure published* | Small, mostly fixed (Sentry+Gofer). *No single MB figure published* | **Subset** - "does not implement every syscall//proc//sys"; syscall-heavy & some I/O slower | **None** (ptrace runs anywhere; KVM optional, worse w/ nested virt) | Untrusted code on commodity VMs; high-density AI/CI sandboxes | Max syscall compat; syscall-bound workloads; strongest hypervisor-grade isolation | **CVE-2026-95702** (own, VFS UAF->Sentry code exec); CVE-2024-0132; CVE-2021-30465 (older) | Google (GKE Sandbox/Cloud Run/App Engine), Anthropic, OpenAI, Modal, Snowflake, Cloudflare, Docker, DigitalOcean | Apache-2.0 | `release-20261102.0` (2026-11-02) |
| **Kata Containers** | Guest-OS boot -> structurally slowest; 4.0 Rust + built-in Dragonball "reduced startup times"; *no single ms figure published* | Guest kernel+agent+rootfs per VM (highest); async runtime `2+N` threads | **Full** (real guest kernel) | **HW virt required** (VT-x/SVM/ARM Hyp); x86_64/arm64/ppc64le/s390x | Strong isolation + full Linux compat; K8s RuntimeClass; confidential guests (SGX/TDX) | Max density/lowest latency; hosts w/o HW virt; ops simplicity | **CVE-2026-47243** (crit, virtiofs guest-root->host-root), **CVE-2026-93417** (Dragonball virtio-blk guest->host), **CVE-2026-50540/41326/24054/24834** (crit), CVE-2026-86072/77176 (annotation host-path mount) | Baidu (Function Computing, CCI, Edge); OpenInfra Foundation; OpenStack/containerd/K8s | Apache-2.0 | `4.3.1` (2026-10-21) |
| **Firecracker** | **<=125 ms** boot->init; VMM up **<=8 CPU ms**; **5 microVMs/core/s** (CI-enforced) | VMM **<=5 MiB** + guest kernel/rootfs | **Full** in guest; **minimal device model** (no easy GPU/passthrough) | **KVM required**; bare-metal tested (kernels 5.10/6.1/6.18) | Serverless/function density + strong isolation; wrap via Kata/containerd/Flintlock | Direct `docker run` (it is a VMM); GPU/privileged; hosts w/o KVM | **CVE-2026-5747** (high, virtio-pci OOB write), CVE-2026-1386 (jailer symlink) | **AWS Lambda + Fargate** ("trillions of requests/month"); Kata/Flintlock VMM | Apache-2.0 | `v1.17.0` (2026-09-10) |
| **Rootless Docker/Podman** | = `runc`/`crun` (tens of ms); no sandbox penalty | = the container process (lowest fixed) | **Full** (native kernel), bounded to unprivileged user; rootless net via `pasta` (<1024 fwd) | **None** (no HW virt/KVM); needs user namespaces | Simplest ops; dev/CI; docker-compat; run-as-non-root | Max isolation (shares kernel; userns CVEs; runc build-time escapes) | **CVE-2026-94603** (CRIT, image annotation disables sandboxing), **CVE-2024-1753** (build-time escape), CVE-2025-9566/6032; +runc CVE-2024-21626 | Fedora/RHEL default (Red Hat); CNCF/Linux Foundation; ubiquitous in CI | Apache-2.0 (Podman/Moby); Docker Desktop proprietary | `v6.1.4` (2026-10-12) |
| **Sysbox** | "Similar to OCI runc"; *no single ms figure published* | runc-equivalent; "2x density vs VMs" claim | **Full + VM-like** (systemd, DinD, KinD); procfs/sysfs virtualized; root=unprivileged via userns | **None** (no HW virt) - but isolation **depends on patched host-kernel userns** | **DinD/KinD CI without privileged containers or host socket**; dev sandboxes | Highest isolation (shares kernel; weaker than VM/gVisor per project); kernel-CVE dependency | Sysbox: none in window; **bounded by kernel**: CVE-2022-0185 (userns) & CVE-2022-0847 (Dirty Pipe) affect; CVE-2022-0492 & CVE-2024-21626 do **not**; CRI-O CVE-2022-0811 (K8s) | Docker (acquired Nestybox 2022; "Hardened Desktop") | Apache-2.0 (Nestybox 2020) | `v0.7.1` (2026-07-31) |

---

## 7. Consolidated CVE timeline (since 2023)

| Year | Primitive | ID(s) | Sev | What |
|------|-----------|-------|-----|------|
| 2024 | Rootless (runc) | CVE-2024-21626 | High | runc breakout via cwd + leaked fds (fix 1.1.12) |
| 2024 | Rootless (podman/build) | CVE-2024-1753 | High | Container escape at build time |
| 2024 | gVisor (image/GPU) | CVE-2024-0132 | - | Bad symlink in malicious image (outside sandbox) |
| 2025 | Kata | CVE-2025-58354 | Med | coco-tdx host circumvents initdata verification |
| 2025 | Rootless (podman) | CVE-2025-9566, CVE-2025-6032 | High | `kube play` symlink traversal; machine missing TLS |
| 2026 | Firecracker | CVE-2026-5747, CVE-2026-1386 | High/Med | virtio-pci OOB write; jailer symlink host-file overwrite |
| 2026 | gVisor (own) | CVE-2026-95702 | 8.5 | VFS UAF -> double-free -> code exec in Sentry (fix 20260831.0) |
| 2026 | Kata | CVE-2026-24054/-24834/-41326/-47243/-50540 | Critical | host block-device hotplug; container->guest privesc; copyfile symlink; virtiofs guest-root->host-root; config-path arbitrary file load |
| 2026 | Kata | CVE-2026-86072/-77176/-93417/-44210/-64676 | High/Med | annotation host-path bind-mount; attacker guest-path mount; Dragonball virtio-blk guest->host; virtiofsd escape; mem-agent tamper |
| 2026 | Rootless (podman) | CVE-2026-94603, CVE-2026-57231, CVE-2026-55686, CVE-2026-19730, CVE-2026-33414 | Crit/High/Med/Low | image annotation disables sandboxing; host env-var leak; WORKDIR symlink; quadlet replace; HyperV PS-injection |

**Pattern:** VM/hypervisor primitives (Kata, Firecracker) get CVEs in the **guest<->host data path** (virtio/virtiofs). Userspace-native primitives (rootless/Sysbox) get CVEs from the **host kernel + runtime**, and an **image-supply-chain** vector (Podman's annotation-disables-sandboxing, and gVisor's image-symlink). gVisor's own CVE surface in the window is a single 2026 UAF.

---

## 8. 2025-2026 changes that matter for this decision

- **Kata 4.0 -> 4.3.x:** full **Rust rewrite of the runtime** (async, single binary, `2+N` threads) + **built-in Dragonball VMM** (no IPC, `dbs-upcall` replaces ACPI hotplug), Wasm container support, pluggable QEMU/Cloud-Hypervisor/Firecracker. Net: faster startup + higher density, but a **large 2026 CVE cluster in the VMM/virtiofs path** (Section 7).
- **gVisor:** continuous dated releases; **CVE-2026-95702 fixed in 20260831.0**; expanding **checkpoint/restore** (adopters use it for fresh single-use sandboxes), **rootless mode**, and a **bubblewrap (bwrap) personality**; its netstack now powers Docker Desktop + Tailscale userspace routing.
- **Firecracker:** **v1.17.0**; ongoing **snapshot/restore + device hotplug (Developer Preview: virtio-PCI hot-plug/unplug)**, memory hotplugging, vsock/entropy/pmem devices; the 2026 CVEs are virtio-pci + jailer.
- **Podman:** **v6.x**; rootless networking standardized on **`pasta` (passt)**; **netavark/aardvark** for networking; 4x/yr release cadence; 2026 focus on the **image-annotation supply-chain** hardening (CVE-2026-94603).
- **Sysbox:** **v0.7.x**; community/best-effort post-acquisition; Enterprise features being trickled into Community + **Docker Desktop Hardened Desktop**.

---

## 9. Decision analysis for OpenForge's runner (evidence-based, not a mandate)

OpenForge spawns **one sandbox per job/step** to run **untrusted user code**. Map the five against the constraints you named:

**Constraint -> what the evidence says:**

- **"Does the host need a special kernel / nested virt?"**
  - **No:** gVisor (ptrace/systrap), Rootless, Sysbox.
  - **Yes (HW virt / nested virt):** Kata, Firecracker.
  - -> If your runner fleet is **commodity cloud VMs without nested virt**, gVisor / Rootless / Sysbox are the only zero-special-hardware options. This is often the deciding factor.

- **"Cold-start latency per step" (short-lived, many steps):**
  - **Fastest with hard numbers:** Firecracker (<=125 ms, <=5 MiB VMM) - *if you can wrap it and have KVM*.
  - **Fast, no guest boot, no HW virt:** gVisor (Sentry init only; project notes most startup is the container manager, not runsc).
  - **runc-equivalent (tens of ms):** Rootless, Sysbox.
  - **Slowest (guest OS boot):** Kata.

- **"Memory overhead / density":**
  - Lowest: Rootless ~ Sysbox (~ runc).
  - Low + fixed: gVisor (Sentry+Gofer).
  - ~5 MiB VMM + guest RAM: Firecracker.
  - Highest: Kata (guest kernel+agent).

- **"Security posture for *untrusted* code":**
  - **Strongest boundary:** Firecracker / Kata (hardware virt) - but Firecracker has the cleanest 2026 CVE record; Kata has a large 2026 escape-CVE cluster in virtio/virtiofs.
  - **Strong by construction, no guest kernel:** gVisor - the one with the deepest *untrusted-code* production anchors (Anthropic, OpenAI, Modal, Snowflake, Cloudflare).
  - **Weaker (shared kernel):** Rootless (and Sysbox, which the vendor itself says is "weaker than VMs"), both bounded by host-kernel userns + runtime CVEs.

- **"OCI / Docker compatibility for a CI runner":**
  - **Best:** Rootless (native `docker`-compatible, Buildah build, compose) and **Sysbox** (`docker run --runtime=sysbox-runc`, **DinD without privileged/host-socket** - the cleanest secure-CI story if jobs themselves run Docker).
  - **Good (OCI runtime):** gVisor (`docker run --runtime=runsc`), Kata (via containerd/K8s RuntimeClass).
  - **Not a container runtime:** Firecracker (VMM; needs Kata/containerd/Flintlock layer).

- **"License vs. MIT/Apache-2.0 stance":** **All five are Apache-2.0** (Sysbox confirmed via its LICENSE file; Docker *Desktop* is the only proprietary item, irrelevant to a Linux runner). **No licensing blocker for any of them.**

**Evidence-based shortlist (your call):**
- **If hosts lack nested-virt + you want strong isolation + the deepest untrusted-code track record -> gVisor.** Best fit for "run arbitrary user code safely on commodity VMs," with the strongest production precedent for exactly this job.
- **If jobs run Docker themselves (DinD/buildx) and you must avoid `--privileged`/host-socket -> Sysbox.** The only first-class, non-privileged DinD option - but accept that its isolation is bounded by your host kernel's userns.
- **If you have KVM-capable hosts and want the hardest boundary + the cleanest 2026 CVE record + sub-150 ms starts -> Firecracker** (wrapped via Kata/containerd/Flintlock).
- **If you want the strongest isolation *and* full Linux compat + confidential guests, and can own the CVE treadmill -> Kata** (accept the 2026 virtio/virtiofs CVE cluster and HW-virt dependency).
- **If isolation can be the weakest and you want trivial ops / max docker compat -> Rootless Podman**, with the explicit caveats of shared-kernel risk and **CVE-2026-94603** (image-annotation can disable sandboxing) -> you would need to pin image sources + runtime version.

---

## 10. What I could NOT verify (do not treat as settled)

- Single per-sandbox **memory MB** figures for gVisor, Kata, Sysbox (docs are qualitative).
- Single cold-start **ms** figures for gVisor, Kata, Sysbox (only Firecracker publishes CI-enforced numbers).
- A current (2026) measured **Kata boot-time** number.
- gVisor's per-sandbox memory: the project characterizes it as "small, mostly fixed" but does not publish a single MB number in the current docs.

**Recommended next step (cheap, decisive):** on your actual runner host image, run the same micro-suite (`perf.py startup`/`density` from gVisor's [test/benchmarks](https://github.com/google/gvisor/tree/master/test/benchmarks), a Firecracker `test_boottime.py` run, a Kata `ctr run` timeit, and a `time podman run alpine true`) - 30 minutes, and it removes every "no public number found" gap in Section 6 for *your* hardware.

---

## 11. Appendix A - How each primitive plugs into OpenForge's runner

Concrete wiring per primitive (illustrative; pin real versions). The runner spawns one of these per step.

### 11.1 gVisor (`runsc`) via Docker
Register as a Docker runtime, then select it per step:
```
# /etc/docker/daemon.json
{
  "runtimes": {
    "runsc": { "path": "/usr/bin/runsc" }
  }
}
```
```
docker run --runtime=runsc <job-image> <step-cmd>
```
K8s: `runtimeClassName: gvisor` on the runner pod. No host kernel change required.

### 11.2 Kata via containerd / Kubernetes RuntimeClass
Kata is a `containerd` shimv2 (`io.containerd.kata.v2`), not a `docker run` target:
```
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata
handler: kata
```
Verify host capability first: `kata-runtime check` (needs VT-x/SVM/ARM Hyp). Pick the Dragonball built-in VMM (4.0 default) for the best startup/density.

### 11.3 Firecracker - wrap it (it is a VMM)
There is no `docker run`. Use an integration: **Kata with Firecracker as the external VMM**, **firecracker-containerd**, or **Flintlock**. Production always launches through the **jailer**:
```
jailer --id <vm> --exec-file /usr/bin/firecracker -- ...
# then drive via the host API socket: InstanceStart, etc.
```
Expect <=125 ms boot to guest init; provision the microVM size (default 1 vCPU / 128 MiB).

### 11.4 Rootless Podman (simplest)
No daemon, runs as the unprivileged CI user:
```
podman run --rm <job-image> <step-cmd>          # docker run equivalent
podman build -t app .                             # docker build equivalent (Buildah)
podman-compose up                                 # docker-compose equivalent
```
Network via `pasta`; forward any port < 1024 to the host. Pin the Podman + runc/crun versions (see CVE-2026-94603).

### 11.5 Sysbox - non-privileged DinD
Drop-in OCI runtime; the differentiator is Docker-in-Docker without `--privileged`/host-socket:
```
docker run --runtime=sysbox-runc --rm <job-image> <step-cmd>
# inside the job, `docker` / `systemd` work because sysbox virtualizes procfs/sysfs
```
K8s: `runtimeClassName: sysbox-runc` (via `sysbox-deploy-k8s`). Keep the host kernel patched (userns class CVEs).

### 11.6 OCI / docker run / build / compose verdict matrix

| Primitive | Vanilla `docker run`? | `docker build`? | `docker-compose`? | Image = stock Docker image? |
|-----------|----------------------|-----------------|-------------------|------------------------------|
| gVisor | yes, `--runtime=runsc` | via Docker (step runs under runsc) | yes (runtime swap) | yes |
| Kata | not directly (containerd/K8s shim) | via containerd/buildah | via K8s/compose | yes (OCI) |
| Firecracker | no (VMM; wrap via Kata/containerd/Flintlock) | no native | no native | converted to guest rootfs |
| Rootless Podman | yes (`podman run`) | yes (Buildah) | yes (podman-compose) | yes (OCI + Docker) |
| Sysbox | yes, `--runtime=sysbox-runc` | yes (incl. multi-arch buildx) | yes | yes (no image requirements) |

---

## 12. Appendix B - Risk register for an untrusted-code runner

| Risk | Primitives most exposed | Mitigation |
|------|-------------------------|------------|
| Guest-to-host VM escape via VMM/virtio bug | Kata (2026 cluster), Firecracker | Pin + auto-track advisories; prefer the primitive with the cleanest 2026 record for the same isolation class |
| Host kernel LPE defeats "container-only" isolation | Rootless, Sysbox, (also gVisor host) | Patch host kernel aggressively; userns-class CVEs negate Sysbox/rootless |
| Image-supply-chain disables sandboxing | Rootless (CVE-2026-94603), gVisor (image symlink) | Pin/validate image sources; deny untrusted annotations; pin runtime version |
| Build-time escape | Rootless (CVE-2024-1753, runc CVE-2024-21626) | Pin runc/crun >= 1.1.12; build in a sandbox too |
| Annotation/config driven host-path mount | Kata (CVE-2026-86072/-77176) | Lock down pod-annotation allowlists; run newest patched runtime |
| No nested virt on runner hosts | Kata, Firecracker (blocked) | Choose gVisor/Rootless/Sysbox, or provision HW-virt hosts |
| GPU / privileged workloads | Firecracker (no easy passthrough) | Use gVisor (GPU support) or Kata (device model) for those steps |
| Highest possible isolation required | Rootless, Sysbox (weaker by design) | Use gVisor / Kata / Firecracker |

**Cross-cutting:** regardless of primitive, (1) run the runner itself as an unprivileged service, (2) egress-filter at the host (Firecracker explicitly does not filter guest egress), (3) treat the image as untrusted input, (4) pin versions and subscribe to the upstream security-advisory feed.

---

## References (primary sources cited above)

- gVisor: [What is gVisor?](https://gvisor.dev/docs/) - [Performance Guide](https://gvisor.dev/docs/architecture_guide/performance/) - [Security Track Record](https://gvisor.dev/security-track-record/) - [Who's Using gVisor](https://gvisor.dev/users/) - [Compatibility](https://gvisor.dev/docs/user_guide/compatibility/) - releases: `github.com/google/gvisor/releases` (Apache-2.0)
- Kata: [README](https://github.com/kata-containers/kata-containers/blob/main/README.md) - [4.0 architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture_4.0/architecture.md) - [Dragonball README](https://github.com/kata-containers/kata-containers/blob/main/src/dragonball/README.md) - [katacontainers.io](https://katacontainers.io/) - [security advisories](https://github.com/kata-containers/kata-containers/security/advisories) (Apache-2.0)
- Firecracker: [README](https://github.com/firecracker-microvm/firecracker/blob/main/README.md) - [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md) - [design.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md) - [NSDI'20 paper (USENIX)](https://www.usenix.org/conference/nsdi20/presentation/agache) - [security advisories](https://github.com/firecracker-microvm/firecracker/security/advisories) (Apache-2.0)
- Podman: [README (rootless model)](https://github.com/containers/podman/blob/main/README.md) - [security advisories](https://github.com/containers/podman/security/advisories) - [rootless tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md) (Apache-2.0)
- Sysbox: [README](https://github.com/nestybox/sysbox/blob/master/README.md) - [LICENSE (Apache-2.0)](https://github.com/nestybox/sysbox/blob/master/LICENSE) - [Security & CVE doc](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security-cve.md) - [Docker acquisition blog](https://www.docker.com/blog/docker-advances-container-isolation-and-workloads-with-acquisition-of-nestybox/)
- gVisor benchmark tooling: [test/benchmarks](https://github.com/google/gvisor/tree/master/test/benchmarks)

*Every version tag, CVE ID, and license in this brief was retrieved live on 2026-11-03 via the GitHub API and project primary docs. Where a number did not exist publicly, it is flagged as such instead of estimated.*
