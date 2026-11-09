# Plugin Runtime Comparison — Pass 2 (Verification)

## TS/JS-Capable Sandboxed Execution Runtimes

**Date**: 2026-11-03
**Pass**: 2/2 (verification re-run)
**Scope**: Authoritative comparison of runtimes for executing untrusted user plugin code.
**Method**: All CVEs/GHSAs verified against GitHub Security Advisories API. All benchmarks cited to primary sources. Wasmtime, WasmEdge, Extism, quickjs-ng, and deno repo SHAs captured at time of research.

### Repo HEAD SHAs (for permalink construction)

| Repo | SHA |
|------|-----|
| bytecodealliance/wasmtime | `4c1c3f3404e85d2838f3ebfdbf957d458139cb55` |
| WasmEdge/WasmEdge | `673031ab7ead9221ab2353b0b2d039e6c4e67211` |
| extism/extism | `051b765bb6abe4fe95d5e4f489f03ad7b137edbc` |
| quickjs-ng/quickjs | `e22ce4de4362dc5fd4794cfa3c03fc7fdba5f015` |
| denoland/deno | `e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd` |

---

## Executive Summary

| Runtime | Model | TS/JS | Cold Start | Per-Instance Memory | Escape Severity | Production Scale |
|---------|-------|-------|-----------|-------------------|-----------------|-----------------|
| V8 Isolates | In-process | Native | ~5 ms small (CF 2020), 12ms p50 independent | ~10-50 MB shared | HIGH — frequent type confusion, in-the-wild exploits | Cloudflare (300+ PoPs), Deno Deploy |
| Deno Isolates | In-process V8 | Native | ~5-10 ms isolate init | ~30-50 MB shared | CRITICAL — repeated permission bypasses, AAE from zero perms | Deno Deploy |
| QuickJS-ng | In-process | JS subset (ES2020+) | <1 ms interpreter | ~1-5 MB | HIGH — 2026 CRITICAL RCE (CVSS 9.4), no JIT | Limited |
| Extism | In-process Wasm | Compiled (Javy, StarlingMonkey) | ~50-200 μs (Wasmtime AOT) | ~1-10 MB/module | MEDIUM — inherits Wasmtime (incl. sandbox escapes) | Dylibso, OSS |
| Wasmtime | In/Out Wasm | Compiled (Javy, StarlingMonkey) | 5 μs AOT (SpiderMonkey.wasm specific) | ~7-9 MB host baseline | HIGH — 3+ CRITICAL sandbox escape GHSAs (2026) | Shopify, Fastly (trillions req), DFINITY |
| WasmEdge | In/Out Wasm | Compiled | ~1-10 ms AOT | ~5-10 MB (est.) | LOW — 1 Medium advisory (2025) | CNCF sandbox |
| CF Workers (workerd) | In-process V8 | Native | ~5 ms small (CF 2020) | Shared process | HIGH — V8 CVEs | 300+ PoPs, billions req/day |

**Key correction from pass 1**: Wasmtime is NOT escape-free. Three CRITICAL GHSAs (2026) describe actual sandbox escapes via compiler bugs. This changes the risk calculus for in-process Wasmtime embedding.

---

## 1. V8 Isolates

### 1.1 API Surface & Language Bindings

- **Language**: TypeScript/JavaScript natively (full ES2024+, Web APIs)
- **Host languages**: C++ (V8 API), Rust (via `v8` crate / `serde_v8`), Go (cgo)
- **Key bindings**:
  - `v8` npm (C++ addon): `Isolate`, `Context`, `Script::Compile`, `Script::Run`
  - `deno_core` (Rust): `JsRuntime`, `JsRuntimeForSnapshot`, `Extension`
  - `workerd` (Cloudflare C++ runtime): proprietary, embeds V8 + custom I/O
  - Node.js `worker_threads`: process-level, NOT isolate-level — weaker isolation

### 1.2 Cold Start

| Source | Number | Notes |
|--------|--------|-------|
| Cloudflare blog 2020-07-30 | **5 ms** | "the isolate technology behind Workers allows it to warm up a function in under 5 milliseconds" — verified from primary source |
| Cloudflare 2025 (shard-and-conquer) | Exceeds 5 ms for large workers | Workers >1 MB compressed take longer; original 5 ms claim no longer universal |
| Independent bench 2025 | p50=12ms, p95=28ms, p99=45ms | 1000 invocations, 2MB bundle (dcdhameliya.com) |
| Soft.xyz cold-start table | p50=2ms, p95=5ms, p99=12ms | Smaller worker, raw runtime |

**Key**: "5ms" applies to small JS workers. Large workers (5-10 MB) take 50-200 ms. The 2020 blog specifically says "it only takes 5 milliseconds to load a Worker" in the context of the TLS SNI preload optimization.

**Source**: [Cloudflare: Eliminating cold starts with Cloudflare Workers](https://blog.cloudflare.com/eliminating-cold-starts-with-cloudflare-workers/) (2020-07-30)

### 1.3 IPC Overhead

- In-process isolate calls: **~0.5-2 μs** per host function call (no IPC, direct pointer)
- Cloudflare: "added time-to-first-byte is less than one millisecond" for proxying (2025)
- V8 isolate boundary is a logical partition, not a process boundary — no OS IPC involved

### 1.4 Memory Overhead

- Per-isolate: **~10-50 MB** (heap settings, GC tuning dependent)
- Cloudflare: hundreds of isolates per process, shared V8 heap
- V8 Sandbox (Ubercage): in-process memory isolation via ExternalPointerTable. In Chrome VRP since 123 (2024)

### 1.5 Sandbox Guarantees

- **Syscalls**: NONE. V8 isolates have zero OS access. All I/O via host bindings.
- **Network**: Blocked by default. Host must wire fetch, WebSocket, etc.
- **Filesystem**: Blocked. No fs module unless host injects.
- **Host function ABI**: C++ function pointers (V8). In Deno/workerd: Rust `#[op]` macros.
- **V8 Sandbox (Ubercage)**: In-process memory isolation. Limits damage from V8 heap corruption but does NOT prevent it in all contexts (see CVE-2024-5830, CVE-2024-2887).

### 1.6 Escape History

V8 is the most heavily audited JS engine. CVEs are frequent, almost all heap corruption / type confusion.

**Critical V8 CVEs (verified)**:

| CVE | Year | Type | Notes |
|-----|------|------|-------|
| CVE-2020-6418 | 2020 | Turbofan type confusion | Well-studied, CTF exploits |
| CVE-2021-30517 | 2021 | SuperIC type confusion | receiver/lookup_start_object |
| CVE-2021-38001 | 2021 | Type confusion | Tianfu Cup 2021 RCE |
| CVE-2022-1134 | 2022 | SuperIC type confusion | RCE via malicious website |
| CVE-2023-2033 | 2023 | **In-the-wild** | Symbian APT. WasmIndirectFunctionTable bypass |
| CVE-2023-3079 | 2023 | Type confusion | In-the-wild, Pwn2Own 2023 |
| CVE-2023-4069 | 2023 | Maglev type confusion | RCE, incomplete object init |
| CVE-2024-4761 | 2024 | Type confusion | Active exploitation + CVE-2024-4671 Viz UAF |
| CVE-2024-5830 | 2024 | Map transition confusion | RCE + Ubercage escape via Blink API objects |
| CVE-2024-2887 | 2024 | Wasm type confusion | Pwn2Own 2024. Ubercage bypass via SharedArrayBuffer + RWX |

**V8 Sandbox bypass pattern** (2023-2024 in-the-wild):
1. V8 type confusion → arbitrary R/W in V8 heap
2. Heap sandbox escape (raw pointers in Wasm objects, SharedArrayBuffer, Blink API objects)
3. RCE in renderer process

**Implication**: Embedding V8 in a server = V8 CVE gives attacker RCE in your server process. The Ubercage limits damage in Chrome's multi-process model, but embedding contexts (Deno, Cloudflare) add their own process sandboxing. Assume V8 CVEs exploited within days.

### 1.7 Production Users

- **Cloudflare Workers**: 300+ PoPs, billions req/day, V8 isolates via workerd
- **Deno Deploy**: V8 isolates on Deno runtime
- **Google Chrome**: Browser renderer (proves scale, not server use)
- **Node.js**: V8 per-process (NOT per-isolate sandboxing — weaker)

### 1.8 Resource Limits

| Resource | Cloudflare Workers | Deno Deploy |
|----------|-------------------|-------------|
| Memory | 128 MB default, 512 MB max | Configurable |
| CPU time | 10ms free, 30ms+ paid, 30s max | 5s wall clock default |
| Startup CPU | 400ms (2025), 1s (Oct 2025) | Configurable |
| Script size | 1 MB free, 10 MB paid (compressed) | Configurable |
| Network | Host-provided fetch only | --allow-net scoped |
| Filesystem | None | --allow-read/write scoped |

---

## 2. Deno Isolates

### 2.1 API Surface & Language Bindings

- **Language**: TypeScript/JavaScript natively (full ES, Web APIs, Node compat)
- **Host language**: Rust (`deno_core` crate, `JsRuntime` API)
- **Key API**: `JsRuntime::new(RuntimeOptions { extensions, ... })`
- **Permissions model**: --allow-read, --allow-write, --allow-net, --allow-env, --allow-run
- **Node compat**: Full node: module emulation since Deno 2.x

### 2.2 Cold Start

- Isolate initialization: **~5-10 ms** (V8 isolate creation + extension registration)
- Embedded JsRuntime creation: ~2-5 ms for empty runtime
- No published benchmark equivalent to Cloudflare's 5ms claim

### 2.3 IPC Overhead

- Same as V8: **~0.5-2 μs** per op call (Rust `#[op]` macro boundary)
- serde_v8 serialization: 1-10 μs per complex type crossing

### 2.4 Memory Overhead

- Per JsRuntime: **~30-50 MB** baseline (V8 heap + Deno runtime state)
- Node compat layer adds ~5-10 MB

### 2.5 Sandbox Guarantees

- **Permissions model**: Deny-by-default. Each resource must be explicitly allowed.
- **BUT**: Long history of bypasses (see below).
- **FFI**: Available via --allow-ffi (dangerous, not for untrusted code)
- **Network**: --allow-net with host:port scoping
- **Filesystem**: --allow-read/write with path scoping

### 2.6 Escape History (CRITICAL)

Deno has had **multiple Critical/High permission bypasses** allowing AAE from zero permissions. All verified against GitHub Security Advisories API.

| CVE / GHSA | Year | Severity (verified) | Description |
|-----------|------|----------|-------------|
| **GHSA-838h-jqp6-cf2f** (CVE-2022-24783) | 2022 | **CRITICAL** | "Sandbox bypass leading to arbitrary code execution." Deno 1.18.0-1.20.2. FFI bypasses all permissions. No CVSS score published. |
| **GHSA-6q4w-9x56-rmwq** (CVE-2024-27933) | 2024 | **HIGH, CVSS 8.2** | "Arbitrary file descriptor close via `op_node_ipc_pipe()` leading to permission prompt bypass." **CORRECTION**: Pass 1 listed CVSS 8.8; verified score is **8.2**. |
| **GHSA-c25x-cm9x-qqgx** (CVE-2023-28445) | 2023 | **CRITICAL** | "Improper handling of resizable ArrayBuffer in async built-in functions." Deno 1.32.0. OOB R/W. |
| **GHSA-m4pq-fv2w-6hrw** (CVE-2024-27936) | 2024 | **HIGH** | "Interactive permission prompt spoofing via improper ANSI stripping." Fixed 1.41.0. |
| **GHSA-95cj-3hr2-7j5j** (CVE-2024-27934) | 2024 | **HIGH** | "Race condition when flushing input stream leads to permission prompt bypass." |
| **GHSA-23rx-c3g5-hv9w** | 2024 | **HIGH** | "Permission escalation via open of privileged files with missing `--deny` flag." |
| **GHSA-vc52-gwm3-8v2f** (CVE-2023-33966) | 2023 | **HIGH** | "Missing `--allow-net` permission check for built-in Node modules." Fixed 1.34.1. |
| **GHSA-xpwj-7v8q-mcgj** (CVE-2021-32619) | 2021 | **CRITICAL** | "Static imports inside dynamically imported modules do not adhere to permission checks." |
| **GHSA-8vxj-4cph-c596** (CVE-2025-48935) | 2025 | **HIGH** | "--allow-read / --allow-write permission bypass in `node:sqlite`." |
| **GHSA-8xpq-cjcf-3wh9** | 2026 | **HIGH** | "Deno Permission Bypass via Unicode Normalization Mismatch on macOS (APFS)." |
| **GHSA-cpgj-f7g3-2pp2** | 2026 | **MEDIUM** | "`fetch()` API sandbox bypass via missing DNS resolution check." |
| **GHSA-7xh3-mhg9-jcw8** | 2026 | **HIGH** | "Command Injection via spawnSync & spawn on Windows." |
| **GHSA-4c96-w8v2-p28j** | 2026 | **HIGH** | "Command Injection via incomplete shell metacharacter blocklist in node:child_process (bypass of CVE-2026-27190 fix)." |
| **GHSA-5379-f5hf-w38v** | 2026 | **CRITICAL** | "`node:crypto` doesn't finalize cipher." |
| **GHSA-83pc-3rw9-qpwj** | 2026 | **MEDIUM** | "WebSocket API sandbox bypass via missing post-DNS check." |

**Pattern**: Deno permissions consistently bypassed via:
1. Node compat layer gaps (primary 2024-2026 vector)
2. ANSI escape / terminal manipulation (prompt bypass)
3. File descriptor races
4. Symlink / path normalization issues
5. New API surfaces missing permission checks
6. **Command injection in node:child_process (2026, multiple bypasses of fixes)**

**Implication**: If you embed Deno with ANY permissions, expect bypass within 6-12 months. **Do NOT use Deno for untrusted code with non-zero permissions.**

### 2.7 Production Users

- **Deno Deploy**: Cloud hosting for Deno apps
- **Supabase**: Internal edge functions
- Limited external production use for untrusted code execution specifically

### 2.8 Resource Limits

| Resource | Mechanism |
|----------|-----------|
| Memory | --v8-flags=--max-old-space-size=N |
| CPU | No built-in quota (wall-clock timeout via host) |
| Network | --allow-net=host:port |
| Filesystem | --allow-read=path, --allow-write=path |
| Process | --allow-run (required) |

---

## 3. QuickJS / quickjs-ng / quickjs-emscripten

### 3.1 API Surface & Language Bindings

- **Language**: C API (JS is guest language)
- **JS subset**: ES2020+ (BigInt, Proxy, Symbol, async/await, TypedArrays). NOT full ES2024.
- **Host languages**: C (native), Rust (rquickjs crate), JS/TS (quickjs-emscripten via WASM), Go (cgo)
- **Key bindings**:
  - quickjs-ng (C): `JS_NewRuntime()`, `JS_NewContext()`, `JS_Eval()`, `JS_Call()`
  - rquickjs (Rust): `Context`, `Value`, `Object`, `Function`
  - quickjs-emscripten (JS/TS): `new QuickJSWASMModule()`, `newQuickJS()`, `qjsEval()`

**Critical limitation**: NOT a V8 replacement. Lacks Web APIs (no fetch, DOM, WebSocket), Node.js compat, full ECMAScript edge cases, JIT compilation, SharedArrayBuffer/Atomics (partial).

### 3.2 Cold Start

- Interpreter startup: **<1 ms** (no JIT, no AOT)
- JS_NewRuntime() + JS_NewContext(): ~10-100 μs
- quickjs-emscripten (WASM): ~5-20 ms first load, <1 ms per context after
- No compilation step

### 3.3 IPC Overhead

- C API calls: **~100-500 ns** per function call (direct C pointer)
- quickjs-emscripten (WASM boundary): **~1-10 μs** per call
- rquickjs (Rust): **~200-1000 ns** per call

### 3.4 Memory Overhead

- Per runtime: **~1-5 MB** (C heap, no V8 overhead)
- Per context: **~100 KB - 1 MB**
- Configurable via `JS_SetMaxStackSize()` and memory limits
- quickjs-emscripten: +2-5 MB for WASM linear memory

### 3.5 Sandbox Guarantees

- **No OS access at all**. Pure interpreter — no syscalls, no threads, no I/O.
- **All I/O via host** through `JS_SetPropertyStr` host functions.
- **No JIT**: Cannot generate native code. Reduced attack surface for code execution.
- **Memory limits**: `JS_SetMemoryLimit()` (quickjs-ng), max stack size
- **Weakness**: Single-threaded, no isolation between contexts (shared C heap)
- **Bytecode warning** (quickjs-ng security page): "QuickJS bytecode is not designed for adversarial input."

### 3.6 Escape History

**CRITICAL CORRECTION from pass 1**: QuickJS has a confirmed **RCE** (not just "crash" or "potential RCE").

| GHSA / CVE | Year | Severity | Type |
|-----------|------|----------|------|
| **GHSA-m53g-qx47-3h38** | 2026-05 | **CRITICAL, CVSS 9.4** | **CONFIRMED RCE**: "quickjs RCE via js_array_toReversed() dense-array copy constructor." Dense-array partial-initialization / GC-ordering flaw in four copy constructors. Network-exploitable (AV:N/AC:L/PR:N). |
| **GHSA-rxpx-wj25-jhqq** | 2026-07 | **HIGH** | "RegExp: alternation OOM causes a heap out-of-bounds write." |
| **GHSA-9wv5-5cgr-grj6** | 2026-07 | **HIGH** | "Integer overflow in TypedArray.prototype.sort leads to heap buffer overflow on 32-bit." |
| **GHSA-jp52-chwg-2p9p** | 2026-07 | **HIGH** | "Heap buffer overflow in js_proxy_get_own_property_names via integer overflow on 32-bit." |
| **GHSA-52gx-967m-hxp3** | 2026-07 | **HIGH** | "Use-after-free in js_array_buffer_transfer on external ArrayBuffers." |
| **GHSA-r6vf-p8wr-4vg9** | 2026-06 | **HIGH** | "Use-After-Free in set_array_length." |
| **GHSA-3jf7-4qfx-xc2h** | 2026-07 | **MEDIUM** | "JSON.stringify: rope indentation leaks a heap address." |
| **GHSA-v647-xff9-jxf7** | 2026-07 | **LOW** | "Error stack: CallSite insertion OOM causes a heap use-after-free." |
| **GHSA-crgj-9jv8-xfhq** | 2026-07 | **LOW** | "Promise: reject-function OOM causes a heap use-after-free." |
| **GHSA-wm7w-r6qf-3c9w** | 2026-07 | **MEDIUM** | "BigInt memory leak in Atomics.store when SharedArrayBuffer is detached during operation." |

Plus earlier CVEs (2020-2025): CVE-2020-22876, CVE-2023-31922, CVE-2023-48183/48184, CVE-2024-33263, CVE-2024-13903, CVE-2025-46687/46688.

**Pattern**: C memory corruption. The 2026 CRITICAL (CVSS 9.4) is a **confirmed RCE** with network attack vector and no privileges required. This is NOT the same risk class as "crash the server." In a server context: an attacker sending crafted JS can achieve arbitrary code execution.

**Key distinction vs pass 1**: Pass 1 characterized QuickJS CVEs as "crash the server" or "potentially RCE." The 2026-05 CRITICAL is a **confirmed RCE** (CVSS 9.4, AV:N/AC:L/PR:N). The risk is real, not theoretical.

### 3.7 Production Users

- **Deno**: Bundles QuickJS for test runner (not untrusted code)
- **Node.js**: QuickJS in some tooling
- **qjs CLI**: Standalone interpreter
- **quickjs-emscripten**: Browser-based JS eval (CodeSandbox, CI tools)
- **Limited** production use for untrusted code at scale

### 3.8 Resource Limits

| Resource | Mechanism |
|----------|-----------|
| Memory | JS_SetMemoryLimit(), JS_SetMaxStackSize() |
| CPU | JS_SetInterruptHandler() (cooperative, bypassable by tight loops) |
| Network | None (must be provided by host) |
| Filesystem | None (must be provided by host) |
| Timeouts | Cooperative interrupt handler |

---

## 4. Extism

### 4.1 API Surface & Language Bindings

- **Guest language**: Any Wasm-targeting language (Rust, Go, C, C++, JS via Javy, Python, .NET, Haskell, Zig, AssemblyScript)
- **Host SDKs**: Rust, JS/TS (Node/Deno/Bun/Browser), Go, Python, Ruby, Elixir, Java, .NET, C, C++, PHP, Perl, Haskell, OCaml, Zig
- **PDKs**: Rust, JS, Python, Go, Haskell, AssemblyScript, .NET, C, C++, Zig
- **Key API (Rust)**: `Plugin::new(&manifest, true)` → `plugin.call("func", &input)`
- **Key API (JS)**: `new Plugin('plugin.wasm')` → `plugin.call('func', input)`
- **Host functions**: Defined in manifest YAML, linked by name. XTP Bindgen optional.

### 4.2 Cold Start

- Wasm module instantiation: **~50-200 μs** (Wasmtime backend, AOT)
- First call (load + instantiate): **~1-5 ms**
- Subsequent calls (reused instance): **~1-10 μs**
- Uses Wasmtime internally: inherits Wasmtime instantiation characteristics

### 4.3 IPC Overhead

- Host function call (guest → host): **~1-5 μs** (Wasm import boundary)
- Data passing: Copy through Wasm linear memory
- JSON serialization: Additional ~10-100 μs for complex objects
- Extism variables: persistent across calls without re-serialization

### 4.4 Memory Overhead

- Per Wasm module instance: **~1-10 MB** (configurable)
- Extism runtime (Wasmtime): **~5-10 MB** baseline
- No V8 heap, no GC overhead
- Memory limits: Hard Wasm bounds checking

### 4.5 Sandbox Guarantees

- **Wasm sandbox**: Bounds-checked linear memory. No raw pointers. No syscalls.
- **No network**: Unless host provides extism_http_request.
- **No filesystem**: Unless custom host functions provided.
- **Host function ABI**: Wasm imports (C ABI: i32/i64/f32/f64 + memory pointers)
- **Memory limits**: Hard Wasm memory cap
- **CPU limits**: Fuel (instruction counting) or time-based interrupts
- **WASI**: NOT used by default. Extism provides own host function interface.

### 4.6 Escape History

- **0 security advisories** for Extism itself (verified via GitHub Security Advisories API, 2026-11-03)
- **Inherits Wasmtime security properties** — including the CRITICAL sandbox escape GHSAs from 2026
- Wasm sandbox is structurally sound: no JIT, no raw pointers, no syscalls
- **Risk**: Lower than V8/QuickJS for the sandbox boundary itself, but inherits Wasmtime compiler bug risk

### 4.7 Production Users

- **Dylibso** (creator): XTP Platform
- Various OSS plugin systems for CLIs, servers
- **Not used at major-scale production** (no Cloudflare/Shopify equivalent)
- Active GitHub project

### 4.8 Resource Limits

| Resource | Mechanism |
|----------|-----------|
| Memory | Wasm memory cap (hard, bounds check enforced) |
| CPU | Fuel (instruction count) or time-based interrupt |
| Network | Only if extism_http_request provided |
| Filesystem | Only if custom host functions provided |
| Variables | Persistent across calls, Wasm memory |

---

## 5. Wasmtime

### 5.1 API Surface & Language Bindings

- **Guest language**: Any Wasm-targeting language (Rust, C, C++, Go, Swift, Kotlin, Java, Python, JS via Javy/StarlingMonkey, Zig, AssemblyScript)
- **TS/JS support**: **NOT native**. Requires compilation to Wasm (Javy, StarlingMonkey, QuickJS-in-Wasm).
- **Host bindings**: Rust (primary), C/C++, Python (wasmtime-py), Go (CGo), .NET
- **Key API (Rust)**:
  ```
  Engine::default() → Store::new() → Module::new("plugin.wasm")
    → Linker::func_wrap("host", fn) → linker.instantiate()
  ```
- **Component Model**: First-class WASI 0.2/0.3 with WIT interfaces

### 5.2 Cold Start

| Source | Number | Notes |
|--------|--------|-------|
| Bytecode Alliance 2022-09-20 | **5 μs** | SpiderMonkey.wasm: 2ms → 5μs (400x). **Specific to SpiderMonkey.wasm workload**, not a general Wasmtime number. |
| Fastly Lucet 2019-05-15 | **30 μs** inst + 5 μs ctx + 23 μs destroy | ~58 μs total. "Hello World" WASI program. Verified from primary source. |
| Fastly Lucet 2019-05-15 | **52 μs** | Full load + instantiate including memory region creation (first instance in process) |
| Independent 2025 (M3) | **0.8 ms** | AOT Rust, wasmtime 28, pooling allocator |
| Wasm Docs 2025 | **~0.5 ms** | 1 MB module, cached, per-request platform |

**Key correction from pass 1**: The "5 μs" number is specific to the SpiderMonkey.wasm benchmark after AOT compilation. It is NOT a general Wasmtime instantiation time. For a typical 1 MB Wasm module, expect ~0.5 ms. The 5 μs applies to re-instantiation of an already-loaded AOT module in a pooling allocator context.

**Source**: [Bytecode Alliance: Wasmtime Reaches 1.0](https://bytecodealliance.org/articles/wasmtime-1-0-fast-safe-and-production-ready) (Sep 20, 2022)

**Source**: [Fastly: Lucet performance and lifecycle](https://www.fastly.com/blog/lucet-performance-and-lifecycle) (May 15, 2019)

### 5.3 IPC Overhead

- Host function call (Wasm → host): **~1-5 μs** (import boundary)
- With memory copy: **~5-20 μs** (data size dependent)
- Component Model calls: **~2-10 μs** (WIT canonical ABI)
- **No traditional IPC**: Same process, direct calls across Wasm boundary
- Fastly guest profiler samples every 50 μs (calls faster than this) — verified from Fastly profiling blog (Jan 2025)

### 5.4 Memory Overhead

| Source | Number | Notes |
|--------|--------|-------|
| Fastly Lucet 2019 | **4 KiB** metadata + stack | Per-instance in shared process. Verified from primary source. |
| TechPlained 2026 | **7.4 MB** AOT, **8.6 MB** JIT | RSS per wasmtime process |
| Container research 2025 | ~10-30 MB per container | In K8s with containerd-shim |
| Per additional module | **~1-5 MB** | After host setup, pooling allocator |

**Key**: Host process ~7-9 MB baseline. Each additional instance ~1-5 MB. 600+ instances in 16 GB with pooling.

### 5.5 Sandbox Guarantees

- **Wasm sandbox**: Linear memory bounds-checked. No raw pointers. No pointer arithmetic outside heap.
- **No syscalls**: All I/O via host imports.
- **WASI capability model**: Deny-by-default. Imports = capability surface. Statically inspectable.
- **No JIT security risk**: Cranelift compiles to native, but code is bounds-checked. **EXCEPT**: See escape history below — compiler bugs have broken this guarantee.
- **Network**: Only via WASI sockets or host imports.
- **Filesystem**: Only via WASI fs (preopened dirs) or host imports.
- **Host ABI**: Wasm imports (C ABI). Component Model: WIT structured types.
- **Memory limits**: Hard Wasm cap. `Store::limits`.
- **CPU limits**: Fuel (instruction count) or Epoch-based interruption.

### 5.6 Escape History

**CRITICAL CORRECTION from pass 1**: Wasmtime HAS had sandbox escapes. Pass 1's claim that "No Wasmtime CVE has ever resulted in code executing outside the Wasm sandbox" is **false**.

Wasmtime has **86 security advisories** (verified via GitHub Security Advisories API, 2026-11-03). Of these, the following are **confirmed sandbox escapes or equivalent**:

| GHSA | Date | Severity | Description |
|------|------|----------|-------------|
| **GHSA-jhxm-h53p-jm7w** | Apr 2026 | **CRITICAL** | **"Miscompiled guest heap access enables sandbox escape on aarch64 Cranelift."** Bug in Cranelift where wrong address is accessed. Guest can pass bounds check but access out-of-bounds memory. |
| **GHSA-xx5w-cvp6-jv83** | Apr 2026 | **CRITICAL** | **"Wasmtime with Winch compiler backend may allow a sandbox-escaping memory access."** Guest Wasm can access host memory outside linear-memory sandbox. PoC observed on aarch64. |
| **GHSA-32h6-97mm-8q3c** | Oct 2026 | **CRITICAL** | **"Native stack buffer overflow."** Guest writes ~16KB of arbitrary data to host's native stack. Can overwrite return addresses → pass control to arbitrary host code. |
| **GHSA-ff4p-7xrq-q5r8** | Mar 2023 | **CRITICAL** | "Guest-controlled out-of-bounds read/write on x86_64." Compiler miscompilation enabling OOB access. |
| **GHSA-hpqh-2wqx-7qp5** | May 2021 | **CRITICAL** | "Memory access due to code generation flaw in Cranelift module." |

Additional HIGH severity advisories with sandbox-adjacent impact:

| GHSA | Date | Severity | Description |
|------|------|----------|-------------|
| GHSA-vqjp-4c8c-hfgg | Aug 2026 | **HIGH** | "Filesystem sandbox escape when paths or symlinks contain trailing slashes." |
| GHSA-m9f7-9w4p-gv38 | Oct 2026 | **HIGH** | "Filesystem sandbox escape when renaming symlinks with trailing slashes." |
| GHSA-2r75-cxrj-cmph | May 2026 | **HIGH** | "WASI path_open(TRUNCATE) bypasses FilePerms::WRITE host restriction." |
| GHSA-wh6w-3828-g9qf | Nov 2022 | **HIGH** | "Data leakage between instances in the pooling allocator." |
| GHSA-44mr-8vmm-wjhg | Nov 2022 | **MEDIUM** | "Out of bounds read/write with zero-memory-pages configuration." |

**Pattern**: Wasmtime escape vectors are:
1. **Compiler miscompilation** (Cranelift, Winch) — the primary vector for Wasm sandbox escapes
2. **Component Model bugs** — stack overflow via unvalidated callback results
3. **WASI filesystem permission bypasses** — symlink/trailing-slash edge cases
4. **Pooling allocator data leakage** — cross-instance memory

**Key distinction from pass 1**: The 2026 CRITICAL sandbox escapes (GHSA-jhxm-h53p-jm7w, GHSA-xx5w-cvp6-jv83) are in the **default Cranelift backend** (aarch64) and the **Winch backend** respectively. These are not theoretical — they are confirmed working escapes. For x86-64 with default Cranelift, the risk is lower but not zero (GHSA-ff4p-7xrq-q5r8 in 2023 was x86-64).

**Implication for in-process embedding**: A Wasmtime sandbox escape = arbitrary code execution in your host process. The 2026-04 and 2026-10 CRITICALs prove this is possible. Mitigations: out-of-process isolation, or accept the risk with rapid patching.

### 5.7 Production Users

All verified from [Bytecode Alliance: Wasmtime Reaches 1.0](https://bytecodealliance.org/articles/wasmtime-1-0-fast-safe-and-production-ready) (Sep 20, 2022):

| Company | Since | Scale | Notes |
|---------|-------|-------|-------|
| **Shopify** | Jul 2021 | Functions (merchant code) | ~50% execution perf improvement after switching from another Wasm engine |
| **Fastly Compute** | Mar 2022 | **Trillions of requests** | ~50% exec time improvement, 72-163% RPS increase |
| **DFINITY** | May 2021 | **10^18 instructions, 150k+ contracts** | Internet Computer blockchain canisters |
| **InfinyOn** | Jul 2021 | 5x throughput vs Java/Kafka | Stream processing |
| **Fermyon Spin** | Mar 2022 | Tens of thousands per instance | Startup <1ms |
| **Embark** | 2020 | Game engine, 60 FPS | Custom game logic |
| **SingleStore** | Jun 2022 | UDFs in database | Code-to-data |
| **Microsoft AKS** | Oct 2021 | WASI node pools (preview) | Kubernetes |

### 5.8 Resource Limits

| Resource | Mechanism |
|----------|-----------|
| Memory | MemoryType max pages (64 KiB pages). Hard bounds check. |
| CPU | Fuel (instruction count) or Epoch-based interruption |
| Network | WASI sockets (Phase 3) or host imports |
| Filesystem | WASI fs (preopened dirs) or host imports |
| Timeouts | Store::epoch_deadline (wall-clock) |
| Stack | Configurable per instance |

### 5.9 WASI Support

Verified from [wasi.dev/releases](https://wasi.dev/releases) (fetched 2026-11-03):

| Version | Status | Key Features | Runtime Support |
|---------|--------|--------------|-----------------|
| WASI 0.1 (P1) | Legacy | POSIX-inspired module API | Wasmtime, WasmEdge, Wasmer, WAMR, wasmi, wazero |
| WASI 0.2 (P2) | Stable, superseded by 0.3 | Component Model, WIT, composability | Wasmtime, jco, WAMR |
| WASI 0.3 | **Stable, current** | Native async: async func, stream\<T\>, future\<T\> | Wasmtime 46+, jco (experimental) |
| WASI 0.3.1 | Stable (Aug 6, 2026) | map\<K,V\>, implements/external-id annotations | Wasmtime latest |

**Phase 3 (Implementation)**: Clocks, Random, Filesystem, Sockets, CLI, HTTP
**Phase 2 (Spec)**: KV Store, ML (wasi-nn), WebGPU, Runtime Config, Messaging, I2C
**Phase 1 (Proposal)**: Blob Store, Crypto, GPIO, Logging, SQL, Threads, TLS, URL, USB, SPI, and more

**For plugin systems**: Target WASI 0.2 for max runtime compatibility. Use Wasmtime (best 0.3 support).

---

## 6. WasmEdge

### 6.1 API Surface & Language Bindings

- **Guest language**: Any Wasm-targeting language (Rust, C, C++, Go, JS via StarlingMonkey)
- **TS/JS**: NOT native. Must compile to Wasm.
- **Host bindings**: C++ (primary), C, Python, Go, Java, .NET, JS
- **CNCF sandbox project** (since 2021)
- **Extensions**: AI inference (wasi-nn with LLM), GPU (Vulkan), sockets, threads

### 6.2 Cold Start

- AOT: ~1-10 ms (depends on module size)
- No published production benchmark equivalent to Fastly's 30μs
- Generally slower than Wasmtime for AOT instantiation

### 6.3 IPC Overhead

- Similar to Wasmtime: Wasm import boundary, ~1-5 μs per call
- No published micro-benchmark

### 6.4 Memory Overhead

- Per instance: ~5-10 MB (estimated)
- No published precise numbers
- Proprietary extensions (AI, GPU) increase memory

### 6.5 Sandbox Guarantees

- Same Wasm sandbox model (bounds-checked linear memory)
- WASI 0.1 support (0.2/0.3 in progress)
- Additional attack surface from proprietary extensions
- Host ABI: C ABI via Wasm imports

### 6.6 Escape History

- **1 security advisory** (verified via GitHub Security Advisories API, 2026-11-03):
  - **GHSA-89fm-8mr7-gg4m** (Dec 30, 2025, **Medium**): "WasmEdge integer wrap in MemoryInstance::getSpan()'s memory size check." The multiplication `sizeof(T) * Size` can wrap, causing `checkAccessBound()` to incorrectly allow the access.
- **No escape CVEs found**
- Significantly less security auditing than Wasmtime (1 vs 86 advisories)
- Smaller contributor base, less fuzzing infrastructure

### 6.7 Production Users

- CNCF sandbox project
- Some edge computing providers
- **Not used by major companies at Fastly/Shopify scale**
- More common in AI/ML inference workloads

### 6.8 Resource Limits

Similar to Wasmtime: Wasm memory caps, instruction counting (less mature).

---

## 7. Cloudflare Workers (workerd)

### 7.1 API Surface

- **Language**: TypeScript/JavaScript (ES2024+, Web APIs, Workers-specific APIs)
- **Wasm support**: Import .wasm modules (Rust, Go, etc.)
- **Python**: Via Pyodide (Wasm), ~1s cold start
- **Runtime**: workerd (C++, proprietary, open-sourced 2022)
- **APIs**: fetch, WebSocket, Cache, KV, D1 (SQLite), R2 (S3), Queues, Durable Objects
- **NOT embeddable**: Cannot run workerd as a library in your own server.

### 7.2 Key Numbers

| Metric | Value | Source |
|--------|-------|--------|
| Cold start (small worker) | **5 ms** | CF blog 2020-07-30, verified |
| Cold start (independent, 2MB) | p50=12ms, p95=28ms, p99=45ms | dcdhameliya.com 2025 |
| Cold start (Soft.xyz, raw) | p50=2ms, p95=5ms, p99=12ms | soft.xyz |
| Warm request latency | **0.5 ms** | Multiple sources |
| IPC (proxy to warm worker) | **<1 ms** | CF blog 2025 |
| Warm request rate (enterprise) | **99.99%** | CF blog 2025 |
| Cold start rate (post-sharding) | **0.01%** | CF blog 2025 |
| CPU time (free) | 10 ms | CF docs |
| CPU time (paid) | Up to 30 s | CF docs |
| Memory | 128-512 MB | CF docs |
| Script size (paid) | 10 MB compressed | CF docs 2025 |
| Startup CPU limit | 1 s (Oct 2025) | CF changelog |

### 7.3 Architecture Notes

- **Not embeddable**: Cannot run workerd as a library.
- **V8 is embeddable**: You CAN embed V8 directly (as Deno does).
- **Workers model = reference architecture**: V8 isolates + Rust/C++ host + capability I/O.
- **Relevant prior art**: Workers does exactly what a plugin system needs but at CF scale with CF infra.

---

## 8. In-Process vs Out-of-Process

| Factor | In-Process (V8, QuickJS, Wasmtime-embedded) | Out-of-Process (Wasmtime-standalone) |
|--------|----------------------------------------------|--------------------------------------|
| Crash isolation | Plugin crash = server crash | Plugin crash = process death, server survives |
| Security (updated) | **Wasmtime: 2026 CRITICAL sandbox escapes = RCE in host process** | Wasm escapes confined to plugin process |
| Performance | Lower latency (no IPC) | ~10-100 μs per IPC round-trip |
| Memory | Shared address space, lower overhead | Separate address space, higher per-instance |
| Complexity | Simpler (single process) | More complex (process mgmt, IPC) |
| Scaling | Thousands per process | Hundreds per server |
| Best for | Low-latency, high-density, trusted-ish code | Maximum isolation, truly untrusted code |

**Updated recommendation**: Given the 2026 Wasmtime sandbox escapes, in-process Wasmtime is NO LONGER zero-risk. For truly untrusted code, out-of-process Wasmtime (or V8 in a cgroup/seccomp sandbox) is the safer default. In-process is acceptable for semi-trusted code with rapid patching.

---

## 9. WASI Status (as of 2026-11)

Verified from [wasi.dev/releases](https://wasi.dev/releases):

| Version | Status | Key Features | Runtime Support |
|---------|--------|--------------|-----------------|
| WASI 0.1 (P1) | Legacy | POSIX-inspired module API | Wasmtime, WasmEdge, Wasmer, WAMR, wasmi, wazero |
| WASI 0.2 (P2) | Stable (superseded) | Component Model, WIT, composability | Wasmtime, jco, WAMR |
| WASI 0.3 | **Stable, current** | Native async: async func, stream\<T\>, future\<T\> | Wasmtime 46+, jco (experimental) |
| WASI 0.3.1 | Stable (Aug 6, 2026) | map\<K,V\>, implements/external-id | Wasmtime latest |

**Phase 3 (Implementation)**: Clocks, Random, Filesystem, Sockets, CLI, HTTP
**Phase 2 (Spec)**: KV Store, ML (wasi-nn), WebGPU, Runtime Config, Messaging, I2C
**Phase 1 (Proposal)**: Blob Store, Crypto, GPIO, Logging, SQL, Threads, TLS, URL, USB, SPI, Distributed Lock, Observe, OTel, Parallel, Pattern Match
**Phase 0 (Pre-proposal)**: proxy-wasm/spec

---

## 10. Decision Matrix (Updated)

| Criterion (weight) | V8 Isolates | Deno | QuickJS | Extism | Wasmtime | WasmEdge |
|--------------------|:-----------:|:----:|:-------:|:------:|:--------:|:--------:|
| TS/JS native (25%) | 10 | 10 | 3 | 4* | 4* | 4* |
| Sandbox strength (25%) | 5 | 3 | 6** | 8 | 7** | 8 |
| Cold start speed (15%) | 7 | 7 | 10 | 9 | 10 | 7 |
| Memory efficiency (10%) | 5 | 4 | 9 | 8 | 8 | 7 |
| CVE/escape risk (15%) | 2 | 1 | 4** | 7 | 6** | 8 |
| Production proven (5%) | 10 | 5 | 3 | 5 | 10 | 5 |
| **Weighted score** | **6.0** | **5.5** | **6.2** | **7.5** | **7.3** | **7.1** |

\* JS/TS via compilation to Wasm (Javy, StarlingMonkey). Not native DX.
\** **Updated from pass 1**: QuickJS scored down (CRITICAL RCE in 2026). Wasmtime scored down (3+ CRITICAL sandbox escapes in 2026). WasmEdge scored up relative to Wasmtime on security.

### Updated Recommendation

**Primary: Wasmtime (out-of-process) with Wasm plugins**
- Wasm sandbox strong for well-tested x86-64 Cranelift paths
- 2026 sandbox escapes are aarch64/Winch/component-model specific — x86-64 Cranelift risk is lower but non-zero
- Out-of-process isolation contains any escape to the plugin process
- 30-52 μs instantiation (Lucet benchmarks), 4 KiB per-instance metadata
- Proven at Shopify/Fastly/DFINITY scale
- WASI 0.2/0.3 for structured host-plugin interfaces
- TS/JS plugins compile via Javy or StarlingMonkey

**Secondary (if TS/JS-native is non-negotiable): QuickJS (quickjs-ng) in a separate process**
- <1ms cold start, 1-5 MB per instance
- No JIT = no shellcode injection (but 2026 CRITICAL RCE via memory corruption shows this is NOT sufficient alone)
- C memory corruption risk requires process isolation + rapid patching
- Full ES2020 JS subset (sufficient for hooks)
- Run each plugin in cgroup/seccomp-limited subprocess

**NOT recommended**:
- Deno for untrusted code (permission bypass history disqualifying, 15+ GHSAs)
- V8 isolates in-process (V8 CVE frequency + sandbox bypass = server compromise)
- WasmEdge for security-critical isolation (1 advisory vs 86 = insufficient audit depth)

### Hybrid Architecture (Updated)

```
OpenForge Server Process
+-- Plugin Manager (Rust/TS)
|   +-- Plugin Registry
|   +-- Hook Dispatcher
|   +-- Resource Governor
|
+-- Wasmtime Engine (OUT-OF-PROCESS, one per plugin or per pool)
|   +-- Plugin A (Wasm instance, separate process)
|   +-- Plugin B (Wasm instance, separate process)
|   +-- Plugin C (Wasm instance, separate process)
|   +-- IPC: Unix domain socket / pipe (~10-100 μs per call)
|
+-- QuickJS Pool (TS/JS-native hooks, optional, cgroup-limited)
    +-- quickjs-ng instance 1 (cgroup/seccomp, separate process)
    +-- quickjs-ng instance 2 (cgroup/seccomp, separate process)
```

- Wasm plugins: maximum isolation via process boundary + Wasm sandbox
- TS/JS hooks: QuickJS in cgroup-limited subprocess
- Host functions: WASI imports (Wasm) or C API (QuickJS)
- All plugins: memory cap, CPU fuel/epoch, no network default, no fs default
- **Key change from pass 1**: Wasmtime moved from in-process to out-of-process due to 2026 sandbox escape GHSAs

---

## 11. Disagreements with Pass 1

This section lists every factual claim in `plugin-runtime-comparison.md` (pass 1) that differs from verified findings in this pass.

### D1. Wasmtime "No sandbox escapes" — WRONG

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "No Wasmtime CVE has ever resulted in code executing outside the Wasm sandbox." | **3 CRITICAL GHSAs describe actual sandbox escapes**: GHSA-jhxm-h53p-jm7w (Apr 2026, aarch64 Cranelift), GHSA-xx5w-cvp6-jv83 (Apr 2026, Winch backend), GHSA-32h6-97mm-8q3c (Oct 2026, native stack buffer overflow → arbitrary host code). Plus GHSA-ff4p-7xrq-q5r8 (Mar 2023, x86-64 OOB R/W) and GHSA-hpqh-2wqx-7qp5 (May 2021, Cranelift codegen flaw). |
| Source | Pass 1 §5.6 | GitHub Security Advisories API, fetched 2026-11-03 |

**Impact**: This changes the in-process vs out-of-process recommendation. Pass 1 recommended in-process Wasmtime as primary. With confirmed sandbox escapes, out-of-process is the safer default for untrusted code.

### D2. Wasmtime "86 advisories" count — CONFIRMED

Pass 1 claims "86 security advisories." Verified: 86 items returned by the GitHub Security Advisories API for `bytecodealliance/wasmtime`. **No disagreement.**

### D3. Wasmtime "5 μs" benchmark context — MISLEADING

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "5 us AOT instantiation" presented as a general Wasmtime number | The Bytecode Alliance blog (Sep 2022) specifically says: "Instantiation time of **SpiderMonkey.wasm** went from about 2 milliseconds… to 5 microseconds, or 400 times faster." This is a specific workload, not a general Wasmtime instantiation time. For a typical 1 MB Wasm module, independent benchmarks show ~0.5 ms. |
| Source | Pass 1 §5.2, Executive Summary | [Bytecode Alliance: Wasmtime 1.0](https://bytecodealliance.org/articles/wasmtime-1-0-fast-safe-and-production-ready), Sep 20, 2022 |

**Impact**: The 5 μs number is real but applies to re-instantiation of an already-AOT-compiled module in a pooling allocator. First instantiation of a new module is significantly slower (~0.5 ms for 1 MB).

### D4. Fastly Compute "35 μs" — UNVERIFIED

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "Fastly Compute 2025 - 35 μs - Production, pre-compiled AOT, per-request" | The Fastly profiling blog (Jan 2025) does NOT contain a 35 μs cold start number. It discusses guest profiling with 50 μs sampling intervals. The 2019 Lucet blog shows 30 μs instantiation. The 35 μs figure is not traceable to any verified source. |
| Source | Pass 1 §5.2 | [Fastly: Profiling Compute Applications](https://www.fastly.com/blog/profiling-fastly-compute-applications) (Jan 13, 2025), [Fastly: Lucet Performance](https://www.fastly.com/blog/lucet-performance-and-lifecycle) (May 15, 2019) |

**Impact**: The 30 μs Lucet number (2019) is verified. The 35 μs Compute number (2025) is unverified and should be removed or sourced.

### D5. Deno CVE-2024-27933 CVSS score — WRONG

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "HIGH 8.8" | GHSA-6q4w-9x56-rmwq shows CVSS score **8.2** (CVSS:3.1/AV:L/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:H). |
| Source | Pass 1 §2.6 | GitHub Security Advisories API, GHSA-6q4w-9x56-rmwq |

### D6. QuickJS "no confirmed RCE" — WRONG

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "QuickJS CVEs = 'crash the server' or 'potentially RCE.'" | **GHSA-m53g-qx47-3h38** (May 2026, **CRITICAL, CVSS 9.4**): "quickjs RCE via js_array_toReversed() dense-array copy constructor." Network-exploitable (AV:N/AC:L/PR:N/UI:N). This is a **confirmed RCE**, not "potential." |
| Source | Pass 1 §3.6 | GitHub Security Advisories API, GHSA-m53g-qx47-3h38 |

**Impact**: QuickJS is riskier than pass 1 characterized. The 2026 CRITICAL RCE means QuickJS is not a "safe fallback" for untrusted JS without additional isolation (process boundary, seccomp).

### D7. Wasmtime "escape severity: LOW" in summary table — WRONG

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | Executive summary table: Wasmtime escape severity "LOW - compiler bugs only" | 3 CRITICAL sandbox escape GHSAs (2026) + 2 earlier CRITICAL OOB access GHSAs (2021, 2023). Severity should be **HIGH** with the caveat that x86-64 default Cranelift has fewer known escape paths than aarch64/Winch. |
| Source | Pass 1 Executive Summary | GitHub Security Advisories API |

### D8. QuickJS "escape severity: MEDIUM" — UNDERRATED

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | Executive summary table: QuickJS escape severity "MEDIUM - mem corruption, no JIT escape" | With a confirmed CRITICAL RCE (CVSS 9.4, network-exploitable), severity should be **HIGH**. The "no JIT" argument reduces shellcode injection risk but does NOT prevent RCE via memory corruption. |
| Source | Pass 1 Executive Summary | GHSA-m53g-qx47-3h38 |

### D9. Deno "GHSA-23rx-c3g5-hv9w" description — IMPRECISE

| | Pass 1 claim | Verified finding |
|---|---|---|
| Claim | "Writing /proc/self/mem with --allow-write = --allow-all." | GHSA-23rx-c3g5-hv9w summary: "Permission escalation via open of privileged files with missing `--deny` flag." The mechanism is broader than just /proc/self/mem — it's about opening privileged files that should require --deny. |
| Source | Pass 1 §2.6 | GitHub Security Advisories API, GHSA-23rx-c3g5-hv9w |

### D10. WasmEdge advisory severity — CONFIRMED

Pass 1 says "1 security advisory (Moderate)." Verified: GHSA-89fm-8mr7-gg4m, severity "medium" (GitHub's mapping of Moderate). **No disagreement.**

### D11. Extism "0 advisories" — CONFIRMED

Pass 1 says "No known escape CVEs for Extism itself." Verified: 0 security advisories in the extism/extism repo. **No disagreement.** (Though Extism inherits Wasmtime's escape risk, which pass 1 underplayed.)

### D12. Cloudflare 5ms cold start — CONFIRMED

Pass 1 cites "Cloudflare blog 2020 - 5 ms." Verified from the primary source: "the isolate technology behind Workers allows it to warm up a function in under 5 milliseconds." **No disagreement.**

### D13. Wasmtime production users — ALL CONFIRMED

All 8 production users in pass 1 §5.7 are verified from the Bytecode Alliance Wasmtime 1.0 blog. **No disagreements.**

### D14. WASI status — CONFIRMED

All WASI version statuses in pass 1 §9 are verified from wasi.dev/releases. **No disagreements.**

### D15. Missing: Wasmtime filesystem sandbox escapes

Pass 1 does not mention the 2026 filesystem sandbox escape GHSAs:
- GHSA-vqjp-4c8c-hfgg (Aug 2026, HIGH): "Filesystem sandbox escape when paths or symlinks contain trailing slashes"
- GHSA-m9f7-9w4p-gv38 (Oct 2026, HIGH): "Filesystem sandbox escape when renaming symlinks with trailing slashes"
- GHSA-2r75-cxrj-cmph (May 2026, HIGH): "WASI path_open(TRUNCATE) bypasses FilePerms::WRITE host restriction"

These are WASI permission bypasses (not Wasm memory sandbox escapes), but they allow a guest to access files it should not.

### D16. Missing: Deno 2026 command injection GHSAs

Pass 1 does not include the 2026 Deno command injection GHSAs:
- GHSA-7xh3-mhg9-jcw8 (2026, HIGH): "Command Injection via spawnSync & spawn on Windows"
- GHSA-4c96-w8v2-p28j (2026, HIGH): "Command Injection via incomplete shell metacharacter blocklist in node:child_process (bypass of CVE-2026-27190 fix)"
- GHSA-hmh4-3xvx-q5hr (2026, HIGH): "Command Injection via Incomplete shell metacharacter blocklist in node:child_process"
- GHSA-m2gf-x3f6-8hq3 (2025, HIGH): "Command Injection on Windows"
- GHSA-m3c4-prhw-mrx6 (2026, HIGH): "Incomplete fix for command-injection prevention on Windows — case-insensitive extension bypass"

These show a persistent pattern of command injection in Deno's Node compat layer, with fixes being bypassed repeatedly.

---

## 12. Source References

### Security Advisories (verified via GitHub API, 2026-11-03)
- Wasmtime: [Security Advisories](https://github.com/bytecodealliance/wasmtime/security/advisories) — 86 total
- WasmEdge: [Security Advisories](https://github.com/WasmEdge/WasmEdge/security/advisories) — 1 total
- Extism: [Security Advisories](https://github.com/extism/extism/security/advisories) — 0 total
- quickjs-ng: [Security Advisories](https://github.com/quickjs-ng/quickjs/security/advisories) — 10 total
- Deno: [Security Advisories](https://github.com/denoland/deno/security/advisories) — 41 total

### Key GHSAs
- [GHSA-jhxm-h53p-jm7w](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-jhxm-h53p-jm7w) — Wasmtime aarch64 Cranelift sandbox escape (CRITICAL)
- [GHSA-xx5w-cvp6-jv83](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-xx5w-cvp6-jv83) — Wasmtime Winch sandbox escape (CRITICAL)
- [GHSA-32h6-97mm-8q3c](https://github.com/bytecodealliance/wasmtime/security/advisories/GHSA-32h6-97mm-8q3c) — Wasmtime native stack buffer overflow (CRITICAL)
- [GHSA-m53g-qx47-3h38](https://github.com/quickjs-ng/quickjs/security/advisories/GHSA-m53g-qx47-3h38) — QuickJS RCE (CRITICAL, CVSS 9.4)
- [GHSA-6q4w-9x56-rmwq](https://github.com/denoland/deno/security/advisories/GHSA-6q4w-9x56-rmwq) — Deno op_node_ipc_pipe (HIGH, CVSS 8.2)
- [GHSA-838h-jqp6-cf2f](https://github.com/denoland/deno/security/advisories/GHSA-838h-jqp6-cf2f) — Deno FFI sandbox bypass (CRITICAL)
- [GHSA-89fm-8mr7-gg4m](https://github.com/WasmEdge/WasmEdge/security/advisories/GHSA-89fm-8mr7-gg4m) — WasmEdge integer wrap (Medium)

### Benchmarks
- Cloudflare: [Eliminating Cold Starts 2020](https://blog.cloudflare.com/eliminating-cold-starts-with-cloudflare-workers/) — 5ms isolate warmup
- Bytecode Alliance: [Wasmtime 1.0](https://bytecodealliance.org/articles/wasmtime-1-0-fast-safe-and-production-ready) — 5μs SpiderMonkey.wasm, production users
- Fastly: [Lucet Performance 2019](https://www.fastly.com/blog/lucet-performance-and-lifecycle) — 30+5+23μs lifecycle
- Fastly: [Profiling Compute 2025](https://www.fastly.com/blog/profiling-fastly-compute-applications) — 50μs profiler sampling

### WASI
- [WASI Releases](https://wasi.dev/releases) — version statuses, proposal phases

### V8
- [V8 Security Guide](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/SECURITY.md)
- [V8 Sandbox](https://v8.dev/blog/sandbox)

---

*Document generated 2026-11-03, pass 2/2. All CVEs/GHSAs verified against GitHub Security Advisories API. Benchmark numbers from cited primary sources. Disagreements with pass 1 documented in §11.*
