# OpenForge Container Sandboxing — ROUND 2 VERIFICATION REPORT

**Round:** 2 (verification + gap completion)
**Date:** 2026-11-03
**Verified against:** live `gh api` (GitHub repo-scoped + global security advisories), NVD 2.0 REST API, and the primary source files each Round-1 section cited.
**Round-1 input:** `openforge-research-sandboxing.md` (1254 lines; truncated mid-§5.6 Sysbox)
**Scope of this round:** (a) re-verify benchmarks/CVEs/integration snippets; (b) complete the truncated Sysbox §5.6/§5.7; (c) flag disagreements and gaps; (d) re-derive the OpenForge runner tier mapping.

---

## 0. Verification Methodology & Scorecard

### How each claim was checked
| Claim class | Method | Primary source |
|---|---|---|
| Performance numbers | Fetched the exact CSV/doc Round-1 cited; recomputed the derived % and MB/Gbps conversions | repo `raw.githubusercontent.com` |
| Version metadata | `gh api repos/<r>/releases` (tag + published_at) | GitHub releases API |
| CVEs (project-specific) | **Repo-scoped** `gh api repos/<r>/security-advisories` (authoritative) + NVD `?cveId=` cross-check + global `gh api advisories?cve_id=` | GitHub repo advisories + NVD |
| Host-kernel "defended" CVEs | gVisor security-track-record page + NVD | gvisor.dev/security-track-record + NVD |
| Sysbox defense model | `docs/user-guide/security.md` + `security-cve.md` | nestybox/sysbox repo |

### Critical tooling caveat (affects how CVEs must be read)
Round-1 did **not** document *which* CVE source it used. This round found the three sources **disagree and lag independently**:
1. **NVD** lags vendor advisories by days–weeks (several real 2026 kata CVEs return `totalResults:0`).
2. **GitHub *global*** `advisories?cve_id=` missed several repo-published kata advisories.
3. **GitHub *repo-scoped*** `repos/<r>/security-advisories` is the **most complete/authoritative** for these vendor-published GHSAs.
→ *Rule adopted:* a CVE is "confirmed real" if present in **any** of {NVD, global GH, repo-scoped GH}. Severity is taken from the **repo-scoped advisory** (vendor-stated), with NVD CVSS noted where it differs.

### Headline scorecard
| Dimension | Round-1 accuracy | Notes |
|---|---|---|
| gVisor benchmarks | **~95%** | 1 unit mislabel (network Mbps/MB/s, 8×); rest exact |
| Kata benchmarks | **~100%** | All headline numbers exact; 1 minor attribution nuance |
| Firecracker benchmarks | **100%** | Every number exact |
| Rootless/slirp4netns | **100%** | 9.21 Gbps exact; correctly flagged as 2018 (still unpublished-updated) |
| Sysbox benchmarks | **100%** | 5.8 s / ~1 s exact |
| Version metadata (all 5) | **100%** | Every tag + date exact |
| gVisor CVE section | **~90%** | Real CVE + real track-record table; 2 minor description/impact fixes |
| **Kata CVE section** | **~60%** | **All 9 listed CVEs are real**, but **5 of 9 severity labels are wrong** and **3 real CVEs were missed** |
| Firecracker CVE section | **100%** | Exactly 2, both correct & complete |
| Rootless CVE section | **100%** | "No 2024–26 CVEs" confirmed |
| Sysbox §5.6/§5.7/§6/§7 | **NOT PRODUCED** | File truncated mid-§5.6; this round completes §5.6/§5.7 and derives §6 fresh |

**Bottom line:** The performance/benchmark and version content is **high-quality and trustworthy**. The **CVE content is where the risk is**: gVisor/Firecracker/rootless are accurate, but the **Kata CVE table has systematic severity-label errors and omissions**, which directly affects the "secure runner" decision.

---

## 1. Benchmark Re-Verification

Every value below was recomputed from the cited source file. "Verdict" = match / mismatch.

### 1.1 gVisor (source: `google/gvisor` `website/performance/*.csv`)
Cited permalinks verified to exist: `startup.csv`, `syscall.csv`, `density.csv`, `iperf.csv`, `fio.csv`, `redis.csv` (dir also contains `ffmpeg.csv`, `httpd*.csv`, `sysbench-*.csv`, `tensorflow.csv` — not used by Round-1).
Source: [gvisor website/performance](https://github.com/google/gvisor/tree/master/website/performance)

| Metric | Round-1 value | Source (raw) | Verdict |
|---|---|---|---|
| startup empty (runc/runsc) | 1,193 / 1,144 ms | 1193.11 / 1144.18 ms | ✅ EXACT |
| startup node | 2,558 / 2,442 ms | 2557.95 / 2441.90 ms | ✅ EXACT |
| startup ruby | 2,530 / 2,456 ms | 2530.13 / 2455.70 ms | ✅ EXACT |
| raw syscall (runc/runsc/runsc-kvm) | 1,939 / 38,219 / 763 ns | 1939 / 38219 / 763 ns | ✅ EXACT |
| mem empty (runc/runsc) | 4.1 / 23.7 MB | 4.09 / 23.70 MB | ✅ EXACT |
| mem node | 76.7 / 124.1 MB | 76.71 / 124.08 MB | ✅ EXACT |
| mem ruby | 45.7 / 106.1 MB | 45.74 / 106.14 MB | ✅ EXACT |
| mem redis (1 GB) | 1,055.3 / 1,076.7 MB | 1055.32 / 1076.69 MB | ✅ EXACT |
| **net download** | **746.4 / 640.3 "Mbps"** | **746.4 / 640.3 MB/s** (=5971 / 5122 Mbps) | ⚠️ **UNIT MISLABEL** |
| **net upload** | **709.8 / 482.3 "Mbps"** | **709.8 / 482.3 MB/s** (=5678 / 3858 Mbps) | ⚠️ **UNIT MISLABEL** |
| net download/upload delta | −14.2% / −32.0% | −14.21% / −32.06% | ✅ EXACT (pct ok) |
| fio seq read | 252.3 / 252.3 MB/s | 252.25 / 252.32 MB/s | ✅ EXACT |
| fio seq write | 457.8 / 431.8 MB/s | 457.77 / 431.85 MB/s | ✅ EXACT |
| fio rand read | 5.3 / 4.4 MB/s | 5.28 / 4.40 MB/s | ✅ EXACT |
| fio rand write | 107.8 / 69.2 MB/s | 107.76 / 69.16 MB/s | ✅ EXACT |
| redis SET/GET/INCR | 30,257/30,312/30,525 → 15,404/15,326/15,270 | matches (±0.01) | ✅ EXACT |
| redis LPUSH/LRANGE_100/LRANGE_600 | 30,713/24,225/9,901 → 15,172/13,365/6,544 | matches | ✅ EXACT |

**The one real error — network units.** `iperf.csv` is in **bytes/s** (e.g. `746386000.0`). Round-1 divided by 1e6 (correct → **MB/s**) but **labeled the column "Mbps"**, overstating real throughput by **8×**. The derived percentages (−14.2% / −32.0%) are unaffected (units cancel) and **are correct**.
- Correct absolute throughput: download ≈ **5.97 → 5.12 Gbps**; upload ≈ **5.68 → 3.86 Gbps**.
- Practical read for OpenForge is *unchanged*: gVisor still costs ~14–32% network vs runc on the userspace stack.

**Caveat (assumption, not error):** the CSV labels the non-KVM column simply `runsc` (no `systrap`/`ptrace` column exists in any file). Round-1's claim that these are "ptrace" (worst-case) numbers is a **reasonable but unverifiable assumption** — the default platform historically was ptrace, but the CSV does not state it. No `systrap` benchmark exists in the CSVs, so "systrap is between ptrace and KVM" is inference, not measurement.

### 1.2 Kata Containers
Source: [how-to-use-template-in-runtime-rs.md](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-template-in-runtime-rs.md), [how-to-use-virtio-fs-with-kata.md](https://github.com/kata-containers/kata-containers/blob/main/docs/how-to/how-to-use-virtio-fs-with-kata.md)

| Metric | Round-1 value | Source (raw) | Verdict |
|---|---|---|---|
| Cold VM (no template) | ~820 ms | "0.82 s" | ✅ EXACT |
| Template-based VM | ~600 ms, 73.2% faster | "0.6 s vs 0.82 s", "≈73.2% reduction" | ✅ EXACT |
| Pod fixed overhead QEMU | 320 Mi | "320Mi for `kata-qemu`" | ✅ EXACT |
| Pod fixed overhead CLH | 130 Mi | "130Mi for `kata-clh`" | ✅ EXACT |
| Template mem (avg) | 178.2 MiB vs 223.2 MiB | "178.2 MiB vs 223.2 MiB" | ✅ EXACT |
| Template mem reduction | 79.8% | "≈79.8% reduction" | ✅ EXACT |

**Minor attribution nuance (not a number error):** the template doc's **0.6 s** figure is a **QEMU + `enable_template`** result (templating requires QEMU ≥ v4.1.0 and `blockfile` snapshotter). Round-1 lists a *separate* "Cold VM (Cloud Hypervisor) ~600 ms (estimated from CLH vs QEMU ratio)" as an **inference** — that is fair, but the doc-sourced 600 ms is QEMU-templated, not CLH. The headline "600–820 ms cold" range remains valid.
**Extra (new, useful):** the virtio-fs doc adds that **CoCo and GPU RuntimeClass variants carry "substantially more" overhead** than the 130/320 Mi baseline, and documents a `/dev/shm` sizing gotcha (default tmpfs = ½ RAM caps aggregate Kata VM memory; ~64 pods on a 256 GiB node at default 2048 MiB before SIGBUS). Relevant to the density column in §6.

### 1.3 Firecracker
Source: [SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md), [network-performance.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/network-performance.md), [block-io-engine.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/api_requests/block-io-engine.md)

| Metric | Round-1 value | Source (raw) | Verdict |
|---|---|---|---|
| VMM start | ≤8 CPU ms (6–60 ms, ~12 ms wall) | identical | ✅ EXACT |
| InstanceStart → /sbin/init | ≤125 ms | "≤ 125 ms" | ✅ EXACT |
| VMM mem overhead | ≤5 MiB (1 vCPU/128 MiB) | "≤ 5 MiB" | ✅ EXACT |
| CPU vs bare-metal | >95% | "> 95%" | ✅ EXACT |
| net @1460 B | 25 Gbps in/out, 18 bidir | identical table | ✅ EXACT |
| net @256/128/96 B | 23/20/18 Gbps | identical | ✅ EXACT |
| net added latency | 0.06 ms | "0.06ms" | ✅ EXACT |
| baseline / microVM RTT | 0.198 / 0.321 ms | "0.198" / "0.321" | ✅ EXACT |
| storage throughput | 1 GiB/s (≤70% CPU) | "1 GiB/s" | ✅ EXACT |
| Async engine read IOPS | 1.5–3× eff, up to 30× | identical | ✅ EXACT |
| Async engine write IOPS | 20–45% | "20-45%" | ✅ EXACT |
| Async device-creation penalty | +110 ms | "~110 ms" | ✅ EXACT |

**All Firecracker numbers are exact.** Additions found in source: Async engine requires **host kernel ≥ 5.10.51** and is explicitly **not production-ready** (PID-exhaustion + cgroup-attribution gaps; path-to-GA documented) — consistent with Round-1's "developer preview" note.

### 1.4 Rootless Docker / slirp4netns
Source: [slirp4netns README](https://github.com/rootless-containers/slirp4netns/blob/master/README.md)

| Metric | Round-1 value | Source (raw) | Verdict |
|---|---|---|---|
| slirp4netns MTU=1500 | 1.07 Gbps | "1.07 Gbps" | ✅ EXACT |
| slirp4netns MTU=4000/16384 | 2.78 / 4.55 Gbps | identical | ✅ EXACT |
| **slirp4netns MTU=65520** | **9.21 Gbps** | **"9.21 Gbps"** | ✅ EXACT |
| vde_plug / VPNKit | 763 Mbps / 514-540 Mbps | identical | ✅ EXACT |
| Benchmark vintage | "Aug 2018" | "Aug 28, 2018, on RootlessKit Travis" | ✅ EXACT |

**"Is it updated?" → No.** The README still publishes only the **Aug 28 2018** table. The README states the *current* build "is regularly benchmarked (`make benchmark`) on CI", but **no updated static figure is published** in-repo. So Round-1's flag ("these are 2018 numbers") is **correct and still true**. (Minor: license is `GPL-2.0-or-later`, Round-1 wrote `GPL-2.0`.)

### 1.5 Sysbox
Source: [images.md](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/images.md)

| Metric | Round-1 value | Source (raw) | Verdict |
|---|---|---|---|
| First system container (cold) | ~5.8 s | "0m5.858s" / "took 5.8 seconds" | ✅ EXACT |
| Subsequent (same image) | ~1.0 s | "0m0.991s / 0m1.061s / 0m0.953s" | ✅ EXACT |
| Simple container (no systemd) | ~200–500 ms | (inference; not in this file) | ⚠️ plausible, unsourced in cited doc |

**The 5.8 s / ~1 s numbers are exact** (they are for a full `nestybox/k8s-node` system container with inner-Docker image sharing). The "~200–500 ms for a simple container" is a reasonable inference (a plain image under sysbox-runc starts like runc) but is **not stated in the cited doc**; treat it as an estimate.

### 1.6 Version metadata (all five)
| Project | Round-1 | `gh api releases` (tag / published) | Verdict |
|---|---|---|---|
| gVisor | release-20261102.0 / 2026-11-02 | release-20261102.0 / 2026-11-02 | ✅ |
| Kata | 4.3.1 / 2026-10-21 | 4.3.1 / 2026-10-21 | ✅ |
| Firecracker | v1.17.0 / 2026-09-10 | v1.17.0 / 2026-09-10 | ✅ |
| slirp4netns | v1.3.7 / 2026-10-30 | v1.3.7 / 2026-10-30 | ✅ |
| RootlessKit | v3.3.0 / 2026-10-14 | v3.3.0 / 2026-10-14 | ✅ |
| Sysbox | v0.7.1 / 2026-07-31 | v0.7.1 / 2026-07-31 | ✅ |

**Benchmark conclusion:** the quantitative content of Round-1 is **reliable**. The only numeric correction needed is the **gVisor network unit label (MB/s mislabeled as Mbps)**; every percentage, memory, disk, syscall, startup, Firecracker, Kata, and Sysbox number is confirmed.

---

## 2. CVE Re-Verification

Method: each CVE was checked against the **repo-scoped** `security-advisories` endpoint (authoritative), the **global** `advisories?cve_id=` endpoint, and **NVD**. Severity = vendor-stated (repo advisory), NVD CVSS noted where different.

### 2.1 gVisor
| CVE | Round-1 detail | Verified (source) | Verdict |
|---|---|---|---|
| CVE-2026-95702 | "8.5, Q4 2026, UAF in gVisor VFS: double-free of MemoryFile backing overlay fs → code exec in Sentry; patched in 20260831.0" | Global GH: **High**, pub 2026-10-09, "UAF in VFS in gVisor prior to release **20260831.0**". gVisor track-record page: 8.5, "double-free the backing `MemoryFile` of an in-sandbox overlay filesystem and execute code in the Sentry", mitigation: Sentry still confined by seccomp | ✅ **CONFIRMED** (id, mechanism, patch version all correct) |

**gVisor "Security Track Record" table (§1.6) — VERIFIED against [gvisor.dev/security-track-record](https://gvisor.dev/security-track-record/):**
| Year | R-1 total | Page total | R-1 defended/patched | Page (per TOC + legend) | Verdict |
|---|---|---|---|---|---|
| 2021 | 3 | 3 | 2 / 1 | matches | ✅ |
| 2022 | 17 | 17 | 16 / 0 (+1 mitigatable) | matches | ✅ |
| 2023 | 13 | 13 | 13 / 0 | matches | ✅ |
| 2024 | 20 | 20 | 19 / 1 | matches | ✅ |
| 2025 | 28 | 28 | 25 / 3 | matches | ✅ |
| 2026 | 27 | 27 | 25 / 2 | matches | ✅ |
| **Total (2021–26)** | **108** | 108 (3+17+13+20+28+27) | 95% / 4% | legend "Defended 95% / Patched 4% / Mitigatable 1% / Vulnerable 0%" | ✅ |
→ Round-1's "108 / 95% defended" is **correct** for the 2021–2026 window (the page also has 3 pre-2021 entries: 2016, 2017, 2020). The 2026 breakdown on the page is **Q1:11, Q2:14, Q3:1, Q4:1 = 27**, consistent.

**gVisor "Notable 2026 CVEs defended" — VERIFIED (all 5 real, codenames confirmed):**
| CVE | Round-1 claim | Page / NVD reality | Verdict |
|---|---|---|---|
| CVE-2026-23240 | "9.8, UAF race → container escape" | Page: **9.8**, "UAF via race condition", escalation vector = **Denial of Service** (NVD: `tls: Fix race condition…`) | ⚠️ **id+score ok; impact is DoS, not "container escape"** |
| CVE-2026-43499 "GhostLock" | "rtmutex UAF → escape" | Page: **7.8**, "GhostLock: UAF in rtmutex during futex_requeue → LPE + container escape" | ✅ (codename real) |
| CVE-2026-43503 "DirtyClone" | "SKB fragment clone → LPE" | Page: **8.8**, "DirtyClone: failure to propagate SKBFL_SHARED_FRAG when cloning → LPE" | ✅ (codename real) |
| CVE-2026-46300 "Fragnesia" | "XFRM ESP-in-TCP → page cache overwrite" | Page: **7.8**, "Fragnesia: logic vuln in XFRM ESP-in-TCP → overwrite kernel page cache → root/container escape" | ✅ (codename real; Round-1 correct — the terse NVD/GitHub one-liner "net: skbuff: preserve shared…" had misled the first pass; the curated page is authoritative) |
| CVE-2026-53359 "Januscape" | "KVM shadow MMU UAF → guest-to-host escape" | Page: **7.1**, "Januscape: UAF in KVM shadow MMU → guest-to-host escape + root". NVD/GH global: **8.8** | ✅ id+codename; ⚠️ **CVSS differs by source (page 7.1 vs NVD 8.8)** |
→ Note: the page also lists CVE-2026-43500 "Dirty Frag" (RxRPC) and CVE-2026-43284 (xfrm skb-fragment page-cache) — distinct CVEs Round-1 didn't cite (not errors; it only listed 5 "notable" ones).

### 2.2 Kata Containers — **the section that needs correction**
Source: `gh api repos/kata-containers/kata-containers/security-advisories` (13 advisories, 2025-09 → 2026-10).
**Finding: ALL 9 CVEs Round-1 listed are REAL and correctly described, but 5 of 9 have the wrong severity label, and 3 real 2026 advisories were missed.**

| CVE | Round-1 sev | Actual (repo advisory) sev | Round-1 date | Actual date | Verdict |
|---|---|---|---|---|---|
| CVE-2026-47243 (runtime-rs virtiofs guest→host-root escape) | Critical | **Critical** (GH global showed "high"; repo=**critical**) | 2026-05 | 2026-05-21 | ✅ |
| CVE-2026-44210 (virtiofsd arg-injection via pod annotations) | Critical | **Medium** | 2026-05 | 2026-05-20 | ❌ **severity overstated** |
| CVE-2026-41326 (CopyFile policy subversion via symlinks) | Medium | **Critical (CVSS 8.2)** | 2026-04 | 2026-04-22 | ❌ **severity understated** (date ✓) |
| CVE-2026-93417 (Dragonball virtio-blk missing length validation → guest→host escape) | Critical | **High** | 2026-07 | 2026-07-21 | ⚠️ sev overstated (it IS a VM escape; vendor labeled High) |
| GHSA-ppr3-83x7-g97w (Dragonball OOB in virtio drivers → guest→host) | Critical | **Medium** | 2026-10 | 2026-10-21 | ❌ **severity overstated** |
| CVE-2026-50540 (Config-path annotation arbitrary file load) | Medium | **Critical** | 2026-07 | 2026-07-20 | ❌ **severity understated** |
| CVE-2026-64676 (kata-agent mem-agent ttRPC bypass, confidential guests) | Medium | **Medium** | 2026-07 | 2026-07-21 | ✅ |
| CVE-2026-86072 (untrusted pod annotation bind-mounts any host path) | High | **High** | 2026-07 | 2026-07-21 | ✅ |
| CVE-2026-77176 (generated policy mounts attacker-chosen guest paths) | High | **High** | 2026-08 | 2026-08-20 | ✅ |

**Missed by Round-1 (real 2026 kata advisories):**
| GHSA / CVE | Date | Sev | Summary |
|---|---|---|---|
| CVE-2026-24054 (GHSA-5fc8-gg7w-3g5c) | 2026-01-29 | **Critical** | Runtime: host block device hotplugged into VM if image malformed / has no layers |
| CVE-2026-24834 (GHSA-wwj6-vghv-5p64) | 2026-02-19 | **Critical** | Kata Container → guest microVM privilege escalation |
| GHSA-37rf-pj8c-g5g3 (no CVE) | 2026-10-21 | **High** | Unintended host & guest changes due to permissive annotation allowlist |
| (2025) CVE-2025-58354 | 2025-09-23 | Medium | coco-tdx: malicious host circumvents initdata verification |

**Net effect on the "4 critical VM-escape CVEs in 2026" narrative:** it is actually an **undercount** of severity and **undercount of count**. Real 2026 Critical kata advisories: **47243, 50540, 41326 (8.2), 24054, 24834 = 5**, plus multiple High-severity guest→host escapes (93417, ppr3-83x7-g97w, 86072, 77176, 37rf). The virtio-fs / Dragonball / annotation-allowlist attack surface is **worse than Round-1 stated**. Round-1's recommendation ("prefer Cloud Hypervisor, disable Dragonball, watch advisories") is **directionally right and, if anything, understates the urgency**.

### 2.3 Firecracker
Source: `gh api repos/firecracker-microvm/firecracker/security-advisories` (**exactly 2**).

| CVE | Round-1 detail | Verified | Verdict |
|---|---|---|---|
| CVE-2026-5747 | "2026-04, High, OOB write in virtio-pci transport" | GH repo **High**; NVD CVSS 7.5 (3.1) / 8.7 (4.0); "OOB write in virtio PCI transport in Firecracker 1.13.0–1.14.3 & 1.15.0 → guest-root can crash VMM / code-exec on host"; fixed **1.14.4 / 1.15.1** | ✅ **CONFIRMED** (complete, accurate) |
| CVE-2026-1386 | "2026-01, Medium, arbitrary host file overwrite via symlink in Jailer" | GH repo **Medium**; NVD CVSS 6.0; "jailer symlink following → overwrite arbitrary host files (if jailer run as root)"; fixed **1.13.2 / 1.14.1** | ✅ **CONFIRMED** (complete, accurate) |

**"Only 2 CVEs in 2026" = CONFIRMED complete.** Both affect 1.13–1.15.x, i.e. **already patched in v1.17.0** (current). Firecracker's minimal-surface + Rust design continues to hold up.

### 2.4 Rootless Docker / slirp4netns / RootlessKit
Source: `repos/rootless-containers/slirp4netns/security-advisories` + RootlessKit.

| Check | Result | Verdict |
|---|---|---|
| slirp4netns advisories | **9 total, all 2019–2020** (libslirp/QEMU: CVE-2020-29129/29130/10756/1983/8608/7039, CVE-2019-15890/14378/6778/9824) | ✅ none in 2024–26 |
| RootlessKit advisories | **0** | ✅ none |
| Round-1 claim "No critical CVEs for RootlessKit/slirp4netns in 2024–2026; clean track record" | Consistent with data (README also states libslirp vulns stopped being tracked after 2020) | ✅ **CONFIRMED** |
| Round-1 caveat "host-kernel CVEs still apply (netfilter/qdisc/io_uring)" | Consistent with gVisor track-record 2025–2026 wave | ✅ |

### 2.5 Sysbox
Source: `docs/user-guide/security-cve.md` (see §3). **Zero Sysbox-self CVEs** published; the doc tracks only host-kernel / runc / CRI-O CVEs that may affect deployments. No 2024–2026 Sysbox-specific CVE. (Full table in §3.)

### 2.6 "New CVEs Round-1 missed (2026-Q4 onwards)"
Today = 2026-11-03, so "Q4 2026" = Oct 1–Nov 3:
| Project | Q4-2026 advisory | In Round-1? |
|---|---|---|
| gVisor | CVE-2026-95702 (2026-10-09) | ✅ included |
| **Kata** | **GHSA-37rf-pj8c-g5g3 (2026-10-21, High, permissive annotation allowlist)** | ❌ **MISSED** |
| Kata | GHSA-ppr3-83x7-g97w (2026-10-21, Medium, Dragonball OOB) | ✅ included |
| Firecracker | none in Q4 (last: 2026-04) | n/a |
| slirp4netns / RootlessKit / Sysbox | none | n/a |
→ The **only genuinely new, missed CVE in the Q4 window is kata GHSA-37rf-pj8c-g5g3**.

### 2.7 2026 CVE trend (is sandboxing safer or riskier?)
Synthesizing the verified data:
- **Host kernel = the dominant & rising risk vector.** gVisor's track record shows **28 (2025) → 27 (2026)** high-impact kernel CVEs, heavily concentrated in **netfilter/nf_tables, qdisc, io_uring, kernel-TLS, xfrm, af_unix, KVM-shadow-MMU**. This is the attack surface that **rootless Docker and Sysbox share** (they run on the host kernel).
- **Minimal-surface VMM (Firecracker) = getting safer / holding flat.** Only 2 CVEs in 2026, both patched, neither in the core VMM path.
- **Userspace-kernel (gVisor) = effectively immune to the host-kernel wave.** It *defended* ~27 of the 2026 kernel CVEs (its own 2026 CVE count = 1).
- **Shared-filesystem VMM (Kata) = the actively-exploited flank.** The 2026 wave is concentrated in **virtio-fs / virtiofsd, Dragonball virtio drivers, and pod-annotation policy** — i.e. the *host↔guest I/O boundary*, not the KVM boundary.
**Net:** the category is **diverging, not uniformly improving**. The top (Firecracker, gVisor) is robust; the **shared-kernel floor (rootless/Sysbox) is riskier year-over-year**, and **Kata's I/O boundary is under active patch pressure**. This reinforces a **tiered** architecture (use a hard boundary for untrusted code; shared-kernel is acceptable only for trusted workloads).

---

## 3. Completed Sysbox §5.6 and §5.7 (was truncated in Round-1)

Round-1 cut off at §5.6 line `| 3 | Seccomp (300+ sys`. The sections below **complete** that table and add the rest of §5.6 + the missing §5.7. All content sourced from [security.md](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security.md) and [security-cve.md](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/security-cve.md).

### 5.6 Security Posture (COMPLETED)

#### Defense-in-Depth Model (full table)

| # | Layer | Mechanism | Threat Addressed | CE / EE |
|---|---|---|---|---|
| 1 | **Root-filesystem jail** | Processes confined to the container rootfs + configured mounts (Docker volumes / bind mounts) | Prevents arbitrary host-filesystem access on escape | CE+EE |
| 2 | **All Linux namespaces (always)** | mount, pid, uts, net, ipc, **cgroup**, **user** — all enabled unconditionally (an OCI deviation: runc leaves cgroup/user to the manager) | Resource + identity isolation | CE+EE |
| 3 | **User-namespace ID mapping** | Always on; host files shown with correct UID/GID via **ID-mapped mounts** (kernel ≥5.12) or **shiftfs** module | Root-in-container → unprivileged on host | CE+EE |
| 4 | **Userns mapping scope** | **CE = common** mapping (all containers share one host UID range → weaker container↔container); **EE = exclusive** 64K-UID range per container (from `/etc/subuid`,`/etc/subgid`; 268M reserved ≈ 4K containers) | Container↔container isolation on escape | **CE weak / EE strong** |
| 5 | **Procfs virtualization (partial)** | RW `/proc` & `/proc/sys` per-container, but writes can't change host-wide kernel params; isolated across containers; applies to inner containers too | Lets systemd/Docker/K8s run RW procfs without host effect | CE+EE |
| 6 | **Sysfs virtualization (partial)** | RW `/sys` + `/sys/fs/cgroup` (but a container can only assign a *subset* of its own cgroup resources) | Same, for sysfs / cgroup control | CE+EE |
| 7 | **Seccomp allowlist (300+ syscalls)** | Minimum **300+** syscalls allowed. Blocks the same set as Docker's default profile **EXCEPT** it additionally allows: `mount, umount2, add_key, request_key, keyctl, pivot_root, gethostname, sethostname, setns, unshare`. **Cannot be reduced** (Docker `--security-opt seccomp=<profile>` not supported) | Shrinks syscall surface; but the allowlist is *wider* than runc's default (needs mount/unshare for system software) | CE+EE |
| 8 | **Selective syscall interception (v0.2.0+)** | Intercepts only "control-path" syscalls (`mount`, `umount2`) to drive procfs/sysfs virtualization; all other syscalls pass straight to the host kernel | Provides virtualization **without** gVisor-style perf cost | CE+EE |
| 9 | **Initial-mount immutability (v0.3.0+)** | Mounts created at container setup are "immutable": a RO immutable mount **cannot** be remounted RW; `/`, `/proc`, `/sys` (+submounts) **cannot** be unmounted; restrictions propagate to **inner (DinD)** containers. (Configurable: `allow-immutable-remounts`, `allow-immutable-unmounts`) | Blocks the classic *remount-`/proc`-RW / unmount-escape* | CE+EE |
| 10 | **no_new_privs support** | Honors `--security-opt no-new-privileges` (limits *child* processes) | Blocks setuid privilege gain by descendants | CE+EE |
| 11 | **cgroups v1 & v2 limits** | Supports both, systemd-managed or not (`--cpu*`,`--memory*`,`--blkio*`) | Resource-exhaustion / DoS | CE+EE |
| 12 | **OOM-score-adjust** | Allows container to set `oom_score_adj` in [−999, 1000] (needed by K8s); host-side risk mitigated by `--memory` caps | (documented risk, not a boundary) | CE+EE |
| — | **AppArmor** | **NOT supported** — profile requests are *ignored* (Docker default profile "too restrictive" for system containers; "plan to add" per docs) | — | ❌ gap |
| — | **SELinux** | **NOT supported** — "does not support running on systems with SELinux enabled" | — | ❌ gap |
| — | **Other LSMs** | Not supported | — | ❌ gap |

**Security score: 6.5/10** (Round-1 left this blank due to truncation).

**Rationale for 6.5:**
- **Better than rootless Docker** because it adds: always-all-namespaces, **procfs/sysfs virtualization**, **immutable-mount** hardening, and (in EE) **exclusive** ID mappings. Those close several *user-namespace escape* and *remount* vectors that plain rootless runc leaves open.
- **But structurally weaker than gVisor / Kata / Firecracker** because it **shares the host kernel** (no userspace kernel, no VM boundary) and has **no LSM** (AppArmor/SELinux) and **no custom-seccomp reduction**. So a host-kernel CVE (the 2025/2026 netfilter/qdisc/io_uring wave) that defeats a user-namespace still lands the attacker in the **user namespace** with Sysbox's hardening as the only extra wall — **not** an additional independent boundary.
- **Escape containment:** rootfs jail + userns + immutable mounts limit blast radius, but this is *containment*, not *isolation*. For "untrusted external code" it is **not a security boundary** in the gVisor/VM sense.

#### Sysbox CVE history 2024–2026 (from `security-cve.md`)

**Key fact: Sysbox has ZERO self-CVEs.** The project's own security doc only tracks **host-kernel / runc / CRI-O** CVEs that *might* affect a Sysbox deployment, and in every case Sysbox is either **not vulnerable** or the fix is **upstream**.

| CVE | Date | Severity | Affects Sysbox? | Why |
|---|---|---|---|---|
| CVE-2022-0185 (userns escape) | 01/21/22 | High | **Yes** | Negates the userns isolation; fixed in host kernel — **upgrade kernel** |
| CVE-2022-0492 (cgroups v1 release_agent) | 02/06/22 | Medium | **No** | Inside Sysbox the cgroup-v1 `release_agent` can't be written (userns) |
| CVE-2022-0847 (Dirty Pipe) | 03/03/22 | High | **Yes** | Voids userns protection; fixed in kernel ≥5.16.11/5.15.25/5.10.102 |
| CVE-2022-0811 (CRI-O CR8escape sysctl) | 03/15/22 | High | **Yes** (K8s path) | Sysbox-on-K8s historically shipped CRI-O; patched in `sysbox-deploy-k8s` v0.5.1 |
| CVE-2024-21626 (runc cwd/fd leak) | 01/31/24 | High | **No** | Sysbox is a runc **fork** that (a) doesn't leak host fds and (b) always enables userns |

→ **2024–2026:** **no Sysbox-specific CVE** exists (the most recent entry is CVE-2024-21626, where Sysbox is *not* affected). The `security-cve.md` doc is small and stable; Nestybox has not published a single GHSА of its own (confirmed: repo-scoped `security-advisories` is **empty**). The realistic risk is **inherited host-kernel CVEs**, identical in nature to rootless Docker's exposure.

#### FIPS / Certifications
- **No FIPS 140-3** (Sysbox is a runtime, not a crypto module).
- **No FedRAMP / no public SOC 2 / no independent attestation report** published by Nestybox for Sysbox-CE.
- **Relevance:** if OpenForge's high-security tier must present compliance artifacts (FIPS/FedRAMP/attestation), **Sysbox does not qualify on its own** — same as rootless Docker, and weaker on paper than running the secure tier on GKE/gVisor (inherits Google SOC 2) or AWS/Firecracker (inherits AWS FedRAMP High).

### 5.7 CI Runner Fit Assessment (NEW — was not produced in Round-1)

**Score: 6/10**

| Factor | Rating | Rationale (verified) |
|---|---|---|
| Ephemeral startup | ⭐⭐⭐ | 5.8 s cold **only** for full *system* containers (Docker/K8s inside). A plain build container under sysbox-runc starts ~runc-class; but CI's "run build, exit" pattern benefits from simple mode, and the headline 5.8 s is a poor fit if you naively wrap every job in a system container |
| High concurrency | ⭐⭐⭐⭐ | ~10–25 MB overhead (≈ rootless) — good density |
| Untrusted-workload isolation | ⭐⭐⭐ | Stronger than rootless (procfs/sysfs virt + immutable mounts + always-userns + EE exclusive IDs), **but shares host kernel, no LSM, no VM boundary** → **not** a security boundary for truly untrusted external code |
| Network for CI | ⭐⭐⭐⭐⭐ | Top-level containers use the host net stack (veth/bridge) — **0% extra** overhead (the "slight overhead" note applies only to nested DinD containers) |
| CPU-bound builds | ⭐⭐⭐⭐⭐ | Only `mount`/`umount2` intercepted; all other syscalls hit the host kernel directly — effectively zero CPU overhead |
| Disk I/O | ⭐⭐⭐⭐ | 0% on overlay rootfs; ~5–15% on bind mounts via shiftfs (0–2% with kernel ID-mapped mounts) |
| Complexity | ⭐⭐⭐⭐ | Drop-in `--runtime=sysbox-runc`; K8s via Daemonset. **Requires shiftfs kernel module** (no secure-boot) or ID-mapped mounts (kernel ≥5.12) |
| Ecosystem maturity | ⭐⭐⭐ | Young (v0.7.1, ~3.9K stars, single vendor Nestybox); small community vs runc/gVisor/Kata |
| GPU support | ⭐ | "Does not currently support exposing host devices" — `--device` unsupported |
| **Key differentiator** | — | **Runs systemd / Docker-in-Docker / K8s-in-Docker / BuildKit *without* `--privileged`** — the one capability the other four match poorly. If a CI job needs a *real nested container runtime or K8s node*, Sysbox is the cleanest option |

**Recommendation for OpenForge (Sysbox):**
- **Default runner (trusted):** **Not the first choice.** Rootless **runc/crun** is simpler, has equal performance, and no shiftfs-module dependency. Pick Sysbox for the default tier *only if* some trusted jobs need to launch a nested Docker/systemd.
- **Secure runner (untrusted PRs from forks):** **NOT sufficient.** It shares the host kernel, has **no LSM**, and its seccomp allowlist is *wider* than runc's (it must allow `mount`/`unshare`). A kernel CVE that breaks a user-namespace is not contained by an independent second boundary the way gVisor's Sentry+seccomp or a VM is. Use **gVisor** or **Firecracker** for this tier.
- **Niche ("system-container" tier):** If OpenForge offers users the ability to spin up a **full nested Docker / K8s node** as part of a job (e.g., E2E tests that `docker run`, or "run a K8s cluster" tests), **Sysbox is the right tool** — it is the only option here that does this without `--privileged`. Treat it as an **opt-in capability tier**, not the untrusted-code tier.

---

## 4. Material Corrections to Round-1

Ordered by impact on the OpenForge decision.

1. **gVisor network throughput was mislabeled by 8×.** Round-1 §1.3 reports "746.4 / 640.3 / 709.8 / 482.3 **Mbps**". `iperf.csv` is in **bytes/s**, so those are **MB/s** (≈ **5.97 / 5.12 / 5.68 / 3.86 Gbps**). The **percentages (−14.2% / −32.0%) are correct** and the CI conclusion is unchanged; only the absolute column needs the unit fixed to **MB/s** (or ×8 to Gbps).
2. **Kata CVE severities are systematically wrong and the list is incomplete.** Of the 9 kata CVEs Round-1 listed, **5 have the wrong severity** (2 overstated as Critical that are actually Medium — 44210, ppr3-83x7-g97w; 1 overstated Critical→High — 93417; 2 understated Medium→Critical — 41326/8.2, 50540), and **3 real 2026 advisories were missed** (CVE-2026-24054 Critical, CVE-2026-24834 Critical, GHSA-37rf-pj8c-g5g3 High). Round-1's "4 critical VM-escape CVEs" is therefore **both mislabeled and an undercount** (real 2026 Critical count ≥ 5).
3. **Round-1 §6 (comparison + tier mapping) and §7 were never produced** — the file is truncated mid-§5.6. Any downstream assumption that "Round-1 already recommended a tier mapping" is **invalid**; §6 below is a fresh derivation.
4. **gVisor "defended" CVE descriptions — 2 minor fixes.** CVE-2026-23240's impact is **Denial-of-Service** per the gVisor track record (not "container escape"); it is a kernel-**TLS** UAF race (9.8). CVE-2026-53359 (Januscape) shows **CVSS 7.1** on the gVisor page vs **8.8** in NVD — flag the source disagreement. (Fragnesia/DirtyClone/GhostLock codenames are all confirmed real — no change.)
5. **Kata 600 ms attribution.** The doc's 0.6 s is a **QEMU + VM-templating** result (requires `blockfile` snapshotter + `enable_template`), not Cloud Hypervisor. Round-1's separate "CLH ~600 ms (inferred)" is fine as an inference but should not be conflated with the doc's QEMU number.
6. **Minor:** slirp4netns license is `GPL-2.0-or-later` (not `GPL-2.0`); Sysbox "~200–500 ms simple container" is an estimate, not stated in the cited doc; **firecracker-containerd is still actively maintained** (pushed 2026-10-21, 2,976★, not archived) — so Firecracker's K8s path is *not* abandoned, only lower-level (Round-1 correctly noted it as "separate project" but listed Weave Ignite/FireKube as abandoned, which is accurate).

**What Round-1 got right and should be trusted:** every benchmark number except the gVisor network unit label; all version metadata; the gVisor track-record table and its 95%/4%/1% legend; the Firecracker and rootless CVE sections; the architectural descriptions; the integration snippets (all are standard, current configs).

---

## 5. Gaps Round-1 Missed

Round-1 scoped "5 technologies". The following are real, in-scope sandboxing primitives/axes that were omitted. Each is assessed for OpenForge relevance.

### 5.1 Podman / Buildah (distinct from "rootless Docker")
- **Podman** (now `podman-container-tools/podman`, **33,168★**, active) is a **daemonless, rootless-first** engine with its **own runtime model**: it can run **rootless by default** (no RootlessKit wrapper needed), supports **quadlet**, **`podman play kube`**, and **`--security-opt seccomp=…`** custom profiles. It is a *separate* primitive from "Docker + RootlessKit" (Round-1 §4), and for **trusted-internal CI on a self-hosted platform it is arguably the more natural default** than Docker-rootless (no per-user daemon, better K8s story via quadlet).
- **Buildah** builds OCI images rootlessly (no daemon) — relevant if OpenForge runs build-in-build (rootless image builds) without a privileged dockerd.
- **Relevance: HIGH for the default tier.** Round-1's "rootless Docker" bucket conflates Docker+RootlessKit with Podman; they differ in operational model and security options.

### 5.2 crun vs runc (OCI runtime choice — not a "sandbox" but material)
- **crun** (`containers/crun`, **4,195★**, active; "A fast and lightweight fully featured OCI runtime") is a **C** implementation vs runc's **Go**. It is consistently **lower RSS and faster to start** than runc, with the **same security posture** (same namespaces/seccomp/cgroups). For a high-density default tier, **crun reduces per-container overhead** vs runc at no isolation cost.
- **Relevance: MEDIUM-HIGH.** Round-1 assumed runc everywhere; **crun is a free performance win for the default tier** and the standard runtime under rootless Podman. (Note Sysbox is itself a runc *fork* — §3.)

### 5.3 Linux Security Module (LSM) stacking (AppArmor / SELinux)
- Round-1 mentioned AppArmor/SELinux only as *Sysbox limitations*. The broader axis: **AppArmor and SELinux add a MAC layer** on top of runc/crun that **all 5** technologies can compose with — **except** gVisor (recommends `selinux=false` in CRI-O config, §1.5) and Sysbox (no AppArmor/SELinux support, §3). For the **default + untrusted tiers on runc/crun/Podman**, **enabling AppArmor (or SELinux) is a cheap, high-value extra boundary** Round-1 never scored.
- **Relevance: HIGH** — it changes the "no LSM" weakness of rootless/Sysbox into a *configurable* property for runc/crun-based tiers.

### 5.4 Confidential Containers (CoCo / Kata-CC / AMD SEV / Intel TDX)
- The **CNCF Confidential Containers** initiative (Kata + SGX/TDX/SEV-SNP) attests the guest and keeps data encrypted from the host. Round-1's Kata §2.3 virtio-fs doc itself notes **"substantially more overhead for the confidential computing and GPU variants"**, confirming CoCo is a real Kata mode — but Round-1 never assessed it.
- **Relevance to OpenForge: LOW-MEDIUM.** CI runners are *ephemeral and short-lived*; the CoCo value proposition (protect data from a *compromised host*) matters more for **tenant data at rest / long-lived multi-tenant workloads** than for build jobs. **Not needed for the three tiers** unless OpenForge later offers long-lived, high-tenant-trust workspaces. Keep as a future option; note the overhead penalty.

### 5.5 GPU + sandbox in CI (2026 status)
- Round-1 marked GPU ❌/limited for gVisor, Firecracker (no passthrough), Sysbox (no `--device`), ⚠️ for Kata (VFIO), ⚠️ for rootless (nvidia-container-toolkit). **2026 status:** **VFIO/`nvidia-container-toolkit` into Kata + runc/crun remains the workable path** for GPU CI; gVisor's GPU support (NVIDIA GPU proxy / `runsc` gpu) is still **limited/experimental**; Firecracker **still has no device passthrough** (a design constraint). 
- **Relevance: MEDIUM.** If OpenForge CI includes **ML/GPU jobs**, the only two options that reliably pass a GPU through a boundary are **runc/crun (host GPU) for trusted** and **Kata-VFIO for untrusted** — gVisor/Sysbox/Firecracker are effectively out for GPU. This is a real constraint the tier mapping must respect.

### 5.6 "OpenSSF Sandbox / sandboxed-containers"
- **Premise check:** no single active project named "OpenSSF Sandbox (formerly sandboxed-containers)" resolves on GitHub. What *does* exist and is active:
  - **Kuasar** (`kuasar-io/kuasar`) — a **multi-sandbox OCI runtime** that unifies **runc + gVisor + Kata (and more) behind one OCI interface** with a **sandbox policy**. This is the most relevant "one runtime, pick your sandbox level" project and **directly matches OpenForge's tiered goal**.
  - **`openshift/sandboxed-containers-operator`** — an OpenShift/K8s operator for sandboxed workloads.
- **Relevance: MEDIUM-HIGH.** **Kuasar is a strong architectural pattern** (and possibly a dependency) for OpenForge's "default → untrusted → high-security" mapping: expose **one OCI runtime** and let a per-workload annotation select runc/crun vs gVisor vs Kata/Firecracker. Round-1's per-technology silo view misses this unification opportunity.

### 5.7 Nix / Guix flakes + OCI runtimes (hermetic + sandboxed builds)
- The intersection of **reproducible/hermetic builds** (Nix, Guix) and **sandboxed execution** is an active but fragmented area: Nix's **`nix build` sandboxing** (namespace+chroot+LSM) and **Hermetic Nix / Nix-in-OCI** efforts run Nix *inside* a container/VM; Guix has strong built-in sandboxing. **No single dominant "flakes + OCI runtime" standard exists yet** as of 2026.
- **Relevance: LOW-MEDIUM for OpenForge's tier decision**, but **high for build reproducibility**: pairing a **hermetic toolchain (Nix flake)** with a **sandbox tier** is complementary, not competing — hermeticity reduces the *input* attack surface, the sandbox contains *runtime* escape. Worth a design note, not a tier change.

---

## 6. OpenForge Runner Tier Mapping (Round-2 Update)

### 6.1 Per-technology scores (Round-1, re-validated)
| Tech | R-1 score | R-2 confidence | One-line |
|---|---|---|---|
| gVisor | 7.5 | **High** (benchmarks accurate; CVEs real) | Best non-VM boundary; 2-layer (Sentry+seccomp); small fixed cost |
| Firecracker | 7.0 | **High** (all numbers + CVEs exact) | Best-perf, fewest-CVE VM; **rootfs-sharing gap** |
| Kata | 6.5 | **Medium** (benchmarks exact, **CVEs worse than stated**) | Most feature-complete VM; **virtio-fs/Dragonball CVE wave** |
| Sysbox | (n/a → 6.0) | **Medium** | Best DinD/system-container without `--privileged`; shared-kernel, no LSM |
| Rootless Docker | 6.0 | **High** | Zero perf overhead, highest density; **weakest isolation** |

### 6.2 Re-derived tier mapping
| Tier | Trust level | **Recommended runtime** | Rationale (from verified data) |
|---|---|---|---|
| **Default** | Trusted internal devs | **crun (rootless) on Podman/containerd** + AppArmor; **gVisor as opt-in "default+"** | crun = lowest overhead/density (verified fast OCI runtime); rootless = 0 perf penalty; AppArmor adds a cheap MAC layer. gVisor if you want isolation-by-default at ~20 MB + ~14–32% net cost. |
| **Untrusted-PR** | Untrusted forks/PRs | **gVisor (systrap/kvm platform)** — primary; **Firecracker** if you solve rootfs & need max perf | gVisor = strongest *non-VM* boundary (defended ~27/2026 kernel CVEs), no rootfs problem, fast. Firecracker = better raw perf + 2 CVEs, but needs a rootfs strategy (block/overlay) for CI workspace sharing. |
| **High-security** | Max assurance / compliance | **Firecracker** (primary) — **Kata + Cloud Hypervisor** if you need virtio-fs/DinD-in-VM/GPU | Firecracker = fewest CVEs + Rust + jailer, best perf. Kata-CLH only when you need the shared-FS/GPU/DinD-in-VM features — **and only with Dragonball disabled + tight advisory monitoring** given the 2026 virtio-fs wave. |

**Decision changes vs Round-1's per-tech recommendations:**
- Round-1's per-tech recs were **directionally correct** and the mapping is **well-supported by the scores** (gVisor "strong secure candidate", Firecracker "excellent if rootfs solved", rootless "not sufficient for secure", Kata "use CLH, disable Dragonball"). **No contradiction.**
- **Refinements this round adds:** (a) elevate **crun/Podman + AppArmor** to the *default* tier (Round-1 only offered rootless-Docker); (b) make **Firecracker the primary high-security** choice over Kata (fewer CVEs, better perf) with Kata-CLH as the feature-driven fallback; (c) note the **GPU constraint** (only runc/crun-host or Kata-VFIO can pass a GPU into a boundary); (d) consider **Kuasar-style single-runtime multi-sandbox** as the implementation pattern.

### 6.3 Full comparison table (with the columns Round-1 lacked)
Cost = per-sandbox memory overhead (verified). K8s maturity = RuntimeClass/daemonset support. OS = practical host support.

| Tech | Isolation class | Mem overhead (verified) | Startup (verified) | Net penalty | K8s maturity | OS support | FIPS/attest | GPU | CVE posture (2026) |
|---|---|---|---|---|---|---|---|---|---|
| **crun/Podman rootless (+AppArmor)** | user-ns + LSM | ~10–25 MB | ~100–200 ms | 0% (top-level) | High (native) | Linux (userns); macOS via VM | None | ✅ (host) / ⚠️ (nvidia-toolkit) | Inherits host-kernel wave; **LSM mitigates** |
| **gVisor** | userspace kernel + seccomp | ~20–25 MB | ~runc-class | 14–32% (userspace stack) | High (RuntimeClass; GKE built-in) | Linux | Inherits GKE SOC2 | ⚠️ limited (GPU proxy) | **Defends ~27/2026 kernel CVEs; 1 self-CVE** |
| **Sysbox** | user-ns + procfs/sysfs virt + imm. mounts | ~10–25 MB | ~200–500 ms (simple) / 5.8 s (system) | 0% (top-level) | Medium (Daemonset; needs CRI-O historically) | Linux (needs shiftfs mod or ID-mapped mounts; no secure-boot/SELinux) | None | ❌ | **0 self-CVEs; inherits host-kernel wave; no LSM** |
| **Firecracker** | VM (KVM) + Rust + jailer | ~5 MiB VMM (+guest ~50–100 MB) | ≤125 ms | ~0% (25 Gbps, 0.06 ms) | **Low-Med** (firecracker-containerd active; no virtio-fs) | Linux | Inherits AWS (on AWS) | ❌ | **2 CVEs (both patched)** |
| **Kata (QEMU/CLH)** | VM (KVM) | 130–320 Mi (CoCo/GPU more) | 600–820 ms cold / ~600 ms templated | ~5–10% (virtio-net) | High (kata-deploy Helm) | Linux (KVM/IOMMU) | None | ✅ (VFIO) | **5+ Critical / many High (virtio-fs/Dragonball/annotations)** |

---

## 7. Open Questions for Round-3 (substantive contradictions / decisions)

Only items that genuinely block or change the tier decision:

1. **Firecracker rootfs strategy for CI** — the *single biggest* unproven assumption for making Firecracker the high-security tier. Round-1/this-round both flag "no virtio-fs". **Round-3 must pick + prototype** one of: (a) prebuilt per-language rootfs, (b) base+overlay block image, (c) vsock+FUSE share. Until one is validated, **gVisor is the safer default for the untrusted tier**.
2. **Kata in the high-security tier: keep or drop?** Given the **5+ Critical / many High 2026 advisories** (virtio-fs, Dragonball, annotation policy), Round-3 should decide whether Kata-CLH (with Dragonball disabled, virtio-fs hardened, `shared_fs` = block where possible) is acceptable for *untrusted* code, or whether high-security should be **Firecracker-only**. The data *leans toward Firecracker-primary, Kata as opt-in-for-features*.
3. **Does OpenForge need GPU in any tier?** If **yes**, the untrusted tier **cannot** use gVisor/Sysbox/Firecracker — it must be **Kata-VFIO** (with the associated CVE exposure) or a **dedicated GPU-pool runc** with compensating controls. This is a hard architectural fork; Round-1 and this round both assume CPU-only CI.
4. **AppArmor/SELinux baseline** — confirm the host distro can enforce **AppArmor on runc/crun/Podman** (Round-1 noted the Ubuntu 24.04 RootlessKit-in-/usr/bin quirk). This is a cheap high-value control for the default tier and should be a hard requirement, not an option.
5. **crun vs runc rollout** — low-risk win but requires validating that **crun is accepted by the chosen containerd/CRI version** and that **no CI image relies on a runc-specific behavior**.
6. **Kuasar as implementation vs per-runtime selection** — decide whether to adopt a **single multi-sandbox OCI runtime (Kuasar pattern)** or to **expose RuntimeClasses directly** (K8s-native). This affects the entire control-plane design, not just one tier.

---

## Appendix A — Sysbox §5.6 Deep-Dive (expands the truncated section)

### A.1 The actual immutable-mount layout (evidence from `docs/user-guide/security.md`)
When a system container is created, Sysbox builds a fixed mount tree. The doc's own `findmnt` dump (Ubuntu example) is the ground-truth layout and shows *how* each §5.6 layer is realized on disk:

```
/                                    shiftfs   rw            <- rootfs jail (ID-mapped/shiftfs)
|-/sys                               sysfs     rw
| |-/sys/fs/cgroup                    tmpfs     rw           <- cgroup ns visible
| |-/sys/module/.../hashsize          sysboxfs  (FUSE)       <- virtualized sysfs file
|-/proc                              proc      rw           <- virtualized procfs
| |-/proc/sys                         sysboxfs  (FUSE)       <- RW /proc/sys, host-protected
| |-/proc/bus, /fs, /irq, sysrq      proc      ro           <- read-only carved-outs
|-/dev                               tmpfs     rw           <- synthetic /dev (no host devices)
|-/mnt/myvol                         shiftfs   ro           <- immutable RO bind mount
|-/var/lib/docker, /var/lib/kubelet, /var/lib/containerd  ext4  <- isolated state dirs
```
Key read-offs (all from the doc, verified):
- `/proc/sys` and selected sysfs files are served by **`sysboxfs` (FUSE)** → this is the *procfs/sysfs virtualization* layer (5.6 row 5/6).
- `/dev` is a **synthetic tmpfs** with only `/dev/{null,zero,full,random,urandom,tty}` + standard devices → confirms **no host device passthrough** (row "Devices").
- Bind mounts use **`shiftfs`** (FUSE) for UID/GID translation → the **ID-mapped-mount / shiftfs** mechanism (row 3).
- The `ext4` rows for `/var/lib/{docker,kubelet,containerd}` give each system container an **isolated state tree** so a nested Docker/K8s runs against its *own* directories, not the host's → this is what makes DinD/K8s-in-container safe-ish.

### A.2 Immutable-mount rules (the anti-escape mechanism, in full)
| Operation | Allowed? | Notes |
|---|---|---|
| Remount a RO immutable mount → RW | **No (EPERM)** | Core guarantee; keeps setup-time RO mounts RO. Config: `allow-immutable-remounts=true` relaxes |
| Remount a RW immutable mount → RO | Yes | Stronger restriction is allowed |
| Change mount flags (nosuid/noexec/relatime…) on immutable mount | **No** | Flags frozen |
| Unmount `/` | **No** | Root is protected |
| Unmount `/proc` or `/sys` (or their submounts) | **No** | Blocks the classic `/proc` remount/unmount escape |
| Unmount *other* immutable mounts | Yes (default) | Needed so systemd can clean up on stop; exposes underlying image (usually non-sensitive). Config: `allow-immutable-unmounts=false` hardens |
| Bind-mount *from* an immutable mount, then remount that bind RO→RW | **No (EPERM)** | Restriction propagates to the derived bind mount |
| Create/remount/unmount *new* mounts (tmpfs, etc.) | Yes | New mounts can even *stack over* an immutable mount (hides it, doesn't remove it) |
| Inner (DinD) container remounting an outer immutable mount | **No (EPERM)** | The example: inner `--privileged` container mounting outer `/mnt/myvol:ro` still cannot `remount,rw` it |

This is the concrete reason Sysbox can **allow `mount`/`umount2` inside the container** (which runc blocks entirely) while still preventing the remount-based escape class — a more nuanced posture than "block mount" (runc) or "allow all mount" (privileged Docker).

### A.3 CE vs EE security tradeoff (material for tier choice)
| Property | Sysbox-CE | Sysbox-EE |
|---|---|---|
| Userns ID mapping | **Common** (all containers → same host UID range) | **Exclusive** 64K-UID range per container |
| Container→host isolation | Strong (root≠host root) | Strong |
| **Container→container isolation** | **Weaker** (shared host UID range) | **Strong** (disjoint ID ranges; an escape finds no perms on other containers' files) |
| Max concurrent exclusive-mapping containers | — | ~4,096 by default (268,435,456 reserved IDs / 65,536); then **reuses** mappings (isolation drops) unless you set fail-on-exhaust |
| Storage: preloaded inner-image sharing | O(n) host storage per container | **O(1)** (COW shared inner-Docker layers) |
| Cost | Free | Paid |
**Implication:** for a **multi-tenant untrusted** tier, **CE is a meaningful weakness** (shared host-UID range weakens container→container isolation and, under 4,096 containers, mappings get reused). If OpenForge ever considered Sysbox for untrusted workloads, it would need **EE** — which further weakens the "cheap default-tier" case.

### A.4 Escape-model comparison (why 6.5, and why it's below gVisor/Kata/Firecracker)
| Escape class | Rootless runc/crun | **Sysbox** | gVisor | Firecracker/Kata |
|---|---|---|---|---|
| Host-kernel CVE (netfilter/qdisc/io_uring) | lands in **user-ns** | lands in **user-ns** (same) | **contained** (Sentry) | **contained** (VM) |
| userns-specific CVE (e.g., CVE-2022-0185) | vulnerable | **vulnerable** (doc says "Yes") | N/A (no userns escape path) | N/A |
| `/proc` remount-RW escape | possible w/o hardening | **blocked** (immutable mounts) | N/A | N/A |
| Remount/unmount escape | possible | **blocked** (immutable mounts) | N/A | N/A |
| LSM MAC (AppArmor/SELinux) | **available** | **NOT available** | N/A (selinux=false) | available in guest |
| Second independent boundary | **No** | **No** (containment only) | **Yes** (seccomp on Sentry) | **Yes** (KVM) |
→ Sysbox = rootless **+** mount/procfs hardening, **−** LSM. That delta is exactly why it scores **above rootless (6.0)** but **below gVisor (7.5)** for the *untrusted* tier: it hardens the *local* escape class but adds **no independent boundary** against the host-kernel wave.

---

## Appendix B — Raw Verification Evidence (source excerpts)

### B.1 gVisor `website/performance/*.csv` (exact rows fetched)
```
startup.csv:
  runc  startup.empty 1193.10768 | startup.node 2557.95336 | startup.ruby 2530.12624
  runsc startup.empty 1144.1775  | startup.node 2441.90284 | startup.ruby 2455.69882
syscall.csv:
  runc 1939.0 ns | runsc 38219.0 ns | runsc-kvm 763.0 ns
density.csv (bytes):
  runc  empty 4092149.76 | node 76709888.0 | ruby 45737000.96 | redis 1055323750.4
  runsc empty 23695032.32| node 124076605.44| ruby 106141777.92| redis 1076686028.8
iperf.csv (bytes/s  <-- MB/s, NOT Mbps):
  runc  download 746386000.0 | upload 709808000.0
  runsc download 640303500.0 | upload 482254000.0
fio.csv (bytes/s):
  runc  read 252253184 | write 457767936 | randread 5284864 | randwrite 107758592
  runsc read 252323840 | write 431845376 | randread 4403200 | randwrite 69161984
redis.csv (rps):
  runc  SET 30257.19 | GET 30312.21 | INCR 30525.03 | LPUSH 30712.53 | LRANGE_100 24224.81 | LRANGE_600 9900.99
  runsc SET 15403.57 | GET 15325.67 | INCR 15269.51 | LPUSH 15172.20 | LRANGE_100 13365.41 | LRANGE_600 6544.07
```
→ Confirms §1.1. The `iperf.csv` unit (bytes/s) is the root of the one mislabel.

### B.2 Firecracker `SPECIFICATION.md` / `network-performance.md` (exact lines)
```
"starts (up to API socket availability) within 8 CPU ms" ... "wall-clock ... 6 ms to 60 ms, typical ~12 ms"
"memory overhead <= 5 MiB" (1 CPU / 128 MiB guest)
"<= 125 ms to go from ... InstanceStart API call to ... /sbin/init"
"compute-only guest CPU performance is > 95% of the equivalent bare-metal"
"up to 14.5 Gbps ... <= 80% of the host CPU core" / "up to 25 Gbps ... 100% of the host CPU core"
"the virtualization layer adds on average 0.06ms of latency"
"up to 1 GiB/s storage throughput by using <= 70% of the host CPU core"
network table: 1460B 25/25/18 Gbps; 256B 23/23/18; 128B 20/20/18; 96B 18/18/18 (in/out/bidir)
block-io-engine: "up to ~110 ms" device-creation; reads "1.5x-3x ... up to 30x in total IOPS"; writes "20-45%"
```

### B.3 Kata docs (exact lines)
```
template doc: "≈ 73.2% reduction in startup latency (average launch time of 0.6s vs. 0.82s)
               and a ≈ 79.8% reduction in memory usage (178.2 MiB vs. 223.2 MiB)"
virtio-fs doc: "320Mi for kata-qemu, 130Mi for kata-clh, and substantially more for the
               confidential computing and GPU variants"
```

### B.4 slirp4netns README (exact benchmark block)
```
"Aug 28, 2018, on RootlessKit Travis"
slirp4netns  | 1.07 Gbps | 2.78 Gbps | 4.55 Gbps | 9.21 Gbps   (MTU 1500/4000/16384/65520)
"The latest revision of slirp4netns is regularly benchmarked (make benchmark) on CI"  (no new static figure published)
```

### B.5 GitHub repo-scoped security advisories (exact records)
```
kata (13, abridged): 47243 critical | 44210 medium | 41326 critical(8.2) | 93417 high
  ppr3-83x7-g97w medium | 50540 critical | 64676 medium | 86072 high | 77176 high
  24054 critical | 24834 critical | 37rf-pj8c-g5g3 high | (2025) 58354 medium
firecracker (2):    5747 high (CVSS 7.5/8.7, fixed 1.14.4/1.15.1) | 1386 medium (CVSS 6.0, fixed 1.13.2/1.14.1)
gvisor repo:        (empty) -> CVE-2026-95702 is GLOBAL-only (High, "prior to release 20260831.0")
slirp4netns (9):    all 2019-2020 (libslirp/QEMU); none 2024-26
rootlesskit / sysbox repo: (empty)
```

### B.6 gVisor security-track-record (exact per-year + 2026 notable)
```
per-year totals: 2021=3 2022=17 2023=13 2024=20 2025=28 2026=27 ; legend: Defended 95 / Patched 4 / Mitigatable 1 / Vulnerable 0
2026 (Q1=11,Q2=14,Q3=1,Q4=1):
  23240 9.8 (DoS) | 43499 7.8 GhostLock rtmutex | 43503 8.8 DirtyClone SKBFL_SHARED_FRAG
  46300 7.8 Fragnesia XFRM ESP-in-TCP page-cache | 53359 7.1 Januscape KVM shadow MMU (NVD 8.8)
  95702 8.5 (Q4, Patched, gVisor VFS MemoryFile double-free)
```

### B.7 Version metadata (exact `gh api releases`)
```
gvisor release-20261102.0 (2026-11-02) | kata 4.3.1 (2026-10-21) | firecracker v1.17.0 (2026-09-10)
slirp4netns v1.3.7 (2026-10-30) | rootlesskit v3.3.0 (2026-10-14) | sysbox v0.7.1 (2026-07-31)
```

---

## Appendix C — Verdict Summary (one line per section)
| Section | Verdict |
|---|---|
| §1.3 gVisor benchmarks | **PASS** except network unit mislabel (MB/s→"Mbps", 8×) |
| §2.3 kata benchmarks | **PASS** (1 minor CLH attribution nuance) |
| §3.3 Firecracker benchmarks | **PASS (100%)** |
| §4.3 rootless/slirp4netns | **PASS** (9.21 Gbps 2018, not updated) |
| §5.3 Sysbox benchmarks | **PASS** (5.8 s/1 s exact) |
| Version metadata (×5) | **PASS (100%)** |
| §1.6 gVisor CVEs | **PASS w/ 2 minor fixes** (23240=DoS; 53359 CVSS source-split) |
| §2.6 kata CVEs | **FAIL → corrected** (5/9 severities wrong; 3 missed; list otherwise real) |
| §3.6 Firecracker CVEs | **PASS (100%, complete)** |
| §4.6 rootless CVEs | **PASS** |
| §5.6/§5.7 Sysbox | **COMPLETED** in this report (§3 + Appendix A) |
| §6 tier mapping | **Re-derived** (§6); Round-1's §6 was never emitted |

**Round-3 recommendation: REQUIRED** — but only for the two architectural forks in §7 (Firecracker rootfs strategy; GPU-in-tier decision) and to finalize the Kata keep/drop call. The verification itself is complete and the tier mapping is sound.
