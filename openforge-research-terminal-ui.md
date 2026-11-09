# OpenForge CLI — Terminal UI Library Deep Comparison

## Research Date: 2026-11-03
## Libraries Compared: Ink, Blessed, OpenTUI, Clack, **@inquirer/prompts** (recommended 5th)

---

## 1. Executive Summary

| Criterion | Ink 7/8 | Blessed 0.1.81 | OpenTUI 0.8.x | Clack 1.x | @inquirer/prompts 8.x |
|---|---|---|---|---|---|
| **Architecture** | React + Yoga WASM | Imperative ncurses reimpl | Zig native + TS bindings | Imperative prompts | Imperative prompts |
| **Runtime** | Node 22+ | Node 12+ (stale) | Bun 1.3+ / Node 26.4+ FFI | Node 18+ ESM | Node 18+ ESM |
| **Cold start** | ~248 ms | ~15 ms (est.) | ~5–9 ms (native) | <5 ms | <5 ms |
| **Render fps** | 30 fps default | Unbounded (damage buffer) | 60+ fps target | N/A (one-shot) | N/A (one-shot) |
| **Peak memory** | ~160 MB | ~77–300 MB | ~200 MB (React) / ~100 MB (Core) | <50 MB | <50 MB |
| **Bundle (unpacked)** | 605 KB + React | 110 KB (contrib) | 17.8 MB (native) | 92 KB | 25 KB |
| **Production** | Claude Code, Gemini, Wrangler, Prisma, Linear | polyv-live-cli, a3m-router, MUSUHI | OpenCode (millions) | create-vite, create-vue, Clerk | 1000s of CLIs |
| **Accessibility** | Screen reader mode + ARIA | None | Open issue #423 | `accessible` flag | Basic |
| **RTL** | Broken (Claude Code issue) | None | No (PR closed, needs V2) | None | None |

**Recommendation for OpenForge CLI**: Use **Ink** as the primary rendering layer (tables, diffs, progress, stateful UI) + **@clack/prompts** for one-shot interactive prompts (select, confirm, text, password). This is the exact pattern used by Claude Code, Gemini CLI, and Cloudflare Wrangler. @inquirer/prompts is the fallback if you want a single-library solution without React.

---

## 2. Benchmarks (Published Data)

### 2.1 Cold Start & Frame Delivery

Source: [duong.page — Bubble Tea vs Ink vs Ratatui](https://duong.page/post/2026-10-03-bubble-tea-vs-ink-vs-ratatui/), measured on the same app (30/10000 rows, 300 updates at 16ms):

| Metric | Ink default | Ink tuned (60fps + incremental) | OpenTUI Core | OpenTUI React |
|---|---|---|---|---|
| **Startup to first frame** | **248 ms** | **232 ms** | ~5 ms (est. from Rezi bench) | ~9 ms (est. from Rezi bench) |
| **Peak memory (animating)** | **159.8 MB** | **166.4 MB** | ~100–190 MB | ~200 MB – 15 GB (OOM risk) |
| **Idle memory** | **99.5 MB** | **99.0 MB** | ~80 MB | ~100 MB |
| **CPU per delivered frame** | **5.16 ms** | **8.41 ms** | N/A (native) | N/A (native) |
| **Frames delivered of 300** | **105 / 300** | **172 / 300** | 300 / 300 (target) | 300 / 300 (target) |
| **Bytes written to terminal** | **293.3 KB** | **370.3 KB** | N/A | N/A |

> **Key insight**: Ink's 30fps default cap means only 105 of 300 updates are rendered. Even "tuned" (60fps + incremental), it delivers only 172/300. The 99MB idle memory floor is the React + Node runtime overhead.
> Source: [OpenReplay blog](https://blog.openreplay.com/opentui-alternative-ink/) confirms: "Ink throttles rendering to 30 frames per second by default... every state update beyond that budget waits for the next frame."

### 2.2 Frame Latency (Single Cell Update + Streaming)

Source: [nathan-cannon/tui-benchmarks](https://github.com/nathan-cannon/tui-benchmarks), Apple M4 Max, 120x40, 100 iterations:

**Single cell update** (counter increment at bottom of chat UI):

| Messages | Content | Ink latency | Bytes/frame (Ink) |
|---|---|---|---|
| 10 | 1.4 KB | 21.65 ms | 2,003 |
| 100 | 13.3 KB | 26.53 ms | 16,855 |
| 500 | 66.0 KB | 63.05 ms | **83,795** |

**Streaming append** (LLM token simulation):

| Messages | Content | Ink latency | Bytes/frame (Ink) |
|---|---|---|---|
| 10 | 1.4 KB | 23.94 ms | 2,448 |
| 100 | 13.3 KB | 27.71 ms | 17,271 |
| 500 | 66.0 KB | 62.83 ms | **84,211** |

> **Critical finding**: Ink rewrites every line on every frame regardless of what changed. For a single-character change at 500 messages, it writes 84KB to stdout. Cell-level diffing libraries write 34 bytes for the same change.
> Source: [nathan-cannon/tui-benchmarks](https://github.com/nathan-cannon/tui-benchmarks): "Ink clears and rewrites every line on every frame regardless of what changed, which is why bytes scale linearly with content."

### 2.3 Relative Performance (Rezi Benchmark Suite)

Source: [Rezi BENCHMARKS.md](https://github.com/RtlZeroMemory/Rezi/blob/main/BENCHMARKS.md), WSL, 2026-02-22:

| Scenario | Ink | OpenTUI React | OpenTUI Core | Blessed | terminal-kit |
|---|---|---|---|---|---|
| **Startup** | 5.62 ms | 8.68 ms | 4.92 ms | — | — |
| **Tree construction (100)** | 26 ms | 36 ms | 2.15 ms | — | — |
| **Rerender** | 17.7 ms | 2.70 ms | 1.16 ms | 2–19x faster than Rezi | 1–13x faster than Rezi |
| **Layout stress** | 28 ms | 33 ms | 1.93 ms | — | — |
| **Virtual list (100K)** | 22.6 ms | 28.5 ms | 1.28 ms | — | — |
| **Terminal full UI** | 25.6 ms | 5.07 ms | 1.31 ms | — | — |
| **Memory (peak RSS)** | 120–980 MB | 200 MB – 15 GB | 100–190 MB | 77–300 MB | 69–83 MB |

> Blessed and terminal-kit are faster on primitive workloads because they don't compute layout. They write directly to terminal buffers. On complex UI composition, the gap narrows or reverses.
> **OpenTUI React OOMs** on tree-construction at 1000 items. OpenTUI Core is more memory-stable.

### 2.4 Compiled Executable Size (Bun)

Source: [Stele blog — OpenTUI vs Ink](https://stele-ai.dev/blog/opentui-vs-ink):

| Prototype | Executable size | Gzip | Added over baseline |
|---|---|---|---|
| Shared backend (no TUI) | 77.92 MiB | 35.71 MiB | baseline |
| **+ Ink** | 78.54 MiB | 35.92 MiB | **+0.63 MiB** |
| **+ OpenTUI** | 88.50 MiB | 38.27 MiB | **+10.59 MiB** |

> Ink wins the compiled binary size column decisively. The 10 MiB OpenTUI cost comes from the native Zig binary.

### 2.5 Bundle Size (npm unpacked, verified 2026-11-03)

| Package | Version | Unpacked Size | Dependencies | Notes |
|---|---|---|---|---|
| `ink` | 8.0.0 | **605.3 KB** | 23 | + React 172 KB = ~777 KB total |
| `blessed` | 0.1.81 | **~1.58 MB** | 0 | Legacy, no deps |
| `blessed-contrib` | 4.11.0 | **110 KB** | 14 | Requires blessed as peer |
| `@clack/prompts` | 1.8.1 | **91.5 KB** | 4 | ESM-only |
| `@inquirer/prompts` | 8.7.5 | **24.9 KB** | 10 | ESM, lightest prompt suite |
| `chalk` | 6.0.1 | **54.9 KB** | 0 | Zero-dep styling |
| `listr2` | 11.4.0 | **135.5 KB** | 3 | 56.7M weekly downloads |
| `cli-table3` | 0.6.5 | **45.1 KB** | 1 | Zero-dep (almost) |
| `terminal-kit` | 3.1.4 | **4,015.2 KB** | 8 | Low-level buffer |
| `@opentui/core` | 0.8.1 | **17,851.6 KB** | 4 | Includes native Zig binary |
| `@opentui/react` | 0.8.1 | **90 KB** | 2 | Thin React wrapper |

> **Min+gzip estimates** (from [PkgPulse guide](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026)):
> - @clack/prompts: ~2 KB gzipped
> - Enquirer: ~100 KB gzipped
> - Ink: ~150 KB + React gzipped
> - Silvery (Ink alternative): 114.9 KB gzipped (runtime + Flexily) vs Ink 116.6 KB (Ink + Yoga WASM)
> Source: [silvery.dev](https://silvery.dev/guide/silvery-vs-ink.html)

---

## 3. Terminal Compatibility Matrix

### 3.1 Per-Library Compatibility

| Terminal / Environment | Ink 7/8 | Blessed | OpenTUI 0.8 | Clack | @inquirer/prompts |
|---|---|---|---|---|---|
| **Windows Terminal (Win 11)** | ✅ Full (VT + ConPTY) | ⚠️ No mouse/resize on Windows | ✅ Full (detected via `WT_SESSION`) | ✅ | ✅ |
| **iTerm2 (macOS)** | ✅ Full | ✅ | ✅ Full (hyperlinks, images, notifications) | ✅ | ✅ |
| **tmux (any version)** | ✅ Works (skips DEC 2026 sync) | ✅ (terminfo) | ✅ Detects via `TMUX`, `XTVERSION`; disables Kitty/Sixel, wraps notifications in DCS passthrough | ✅ | ✅ |
| **GNU Screen (legacy)** | ✅ Works | ✅ (terminfo) | ✅ Detects via `STY`; disables graphics queries, conservative width | ✅ | ✅ |
| **VS Code integrated terminal** | ✅ Full | ✅ | ✅ Full (detected via `TERM_PROGRAM=vscode`) | ✅ | ✅ |
| **Plain TTY / CI logs** | ✅ Auto-detects `CI` env; renders only final frame, no ANSI | ✅ (degrades gracefully) | ✅ Non-interactive mode | ✅ Falls back to plain text | ✅ Falls back to plain text |
| **SSH sessions** | ✅ | ✅ | ✅ (direct-terminal policy) | ✅ | ✅ |
| **Legacy conhost (Win 7/8)** | ⚠️ Limited (no VT) | ⚠️ Limited | ⚠️ Limited (16 colors) | ⚠️ Basic | ⚠️ Basic |

### 3.2 Feature Availability by Terminal

Source: [FrankenTUI Terminal Compatibility Matrix](https://docs.frankentui.com/reference/terminal-compatibility), [OpenTUI terminal capabilities](https://opentui.com/docs/reference/terminal-capabilities/), [SuperLightTUI compatibility](https://github.com/subinium/SuperLightTUI/blob/main/docs/guide/11-terminal-compatibility.md):

| Feature | Windows Terminal | iTerm2 | tmux | GNU Screen | VS Code | Kitty |
|---|---|---|---|---|---|---|
| True color (24-bit) | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ |
| Synchronized output (DEC 2026) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| OSC 8 hyperlinks | ❌ | ✅ | ⚠️ passthrough | ⚠️ unreliable | ✅ | ✅ |
| Kitty keyboard protocol | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| Kitty graphics / images | ❌ | ✅ (iTerm2 protocol) | ❌ | ❌ | ⚠️ | ✅ |
| Focus events | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bracketed paste | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> *tmux requires `set -g default-terminal "tmux-256color"` and `set -ga terminal-overrides ",*:Tc"` for true-color passthrough.

### 3.3 Ink-Specific Terminal Handling

Source: [Ink README](https://github.com/vadimdemedes/ink) + [codeline.co review](https://www.codeline.co/thoughts/repo-review/2025/ink-react-for-cli-apps):

- **CI detection**: When `CI` env var is set, Ink renders only the last frame on exit, disables resize listening, and skips ANSI erase sequences.
- **Non-interactive mode**: `interactive: false` disables ANSI erase, cursor manipulation, synchronized output, resize handling, and kitty auto-detection. Writes only the final frame at unmount.
- **DEC 2026 sync output**: Skipped inside tmux (tmux parses but doesn't implement DEC 2026, breaking atomicity). Supported on iTerm2, WezTerm, Ghostty, VS Code, Alacritty, Kitty, Windows Terminal.
- **Kitty keyboard protocol**: Enabled when detected, provides modifier key disambiguation.

### 3.4 OpenTUI-Specific Terminal Handling

Source: [OpenTUI terminal capabilities docs](https://opentui.com/docs/reference/terminal-capabilities/), [OpenTUI notifications docs](https://opentui.com/docs/core-concepts/notifications/):

- **Multiplexer detection**: tmux from `XTVERSION`/`TMUX`/`TERM_PROGRAM=tmux`; Zellij from `XTVERSION`; GNU Screen from `STY`/`TERM` prefix.
- **tmux policy**: Unwrapped probes, skips Kitty/Sixel detection, enables focus tracking, wraps notifications in DCS passthrough (requires `set -g allow-passthrough on`).
- **GNU Screen policy**: Disables graphics queries, selects conservative width behavior.
- **Notification protocols**: OSC 99 (Kitty, foot), OSC 777 (Ghostty, WezTerm, Windows Terminal, etc.), OSC 9 (iTerm, Apple Terminal, ConEmu).

---

## 4. Real Production Usage (Cited)

### 4.1 Ink

Source: [Ink README "Who's Using Ink?"](https://github.com/vadimdemedes/ink), [OpenReplay blog](https://blog.openreplay.com/opentui-alternative-ink/), [Gerald Chen blog](https://chenguangliang.com/en/posts/blog196_cli-second-spring-ai-era-three-structural-reasons/):

| Product | Company | Details |
|---|---|---|
| **Claude Code** | Anthropic | Custom Ink fork, 200+ React components, full Vim mode. Source leaked Mar 2026 (59.8 MB / 510K lines / 1,900 files). [Architecture analysis](https://github.com/lai3d/claude-code-architecture) |
| **Gemini CLI** | Google | "The default UI layer for AI coding tools" |
| **GitHub Copilot CLI** | GitHub | "Just say what you want the shell to do" |
| **Cloudflare Wrangler** | Cloudflare | CLI for Cloudflare Workers |
| **Prisma CLI** | Prisma | "The unified data layer for modern applications" |
| **Linear CLI** | Linear | Internal CLI for deployments, configs, housekeeping |
| **Gatsby** | Gatsby | "A modern web framework for blazing-fast websites" |
| **Shopify CLI** | Shopify | "Build apps, themes, and storefronts" |
| **Terraform CDK** | HashiCorp | Cloud Development Kit for Terraform |
| **Canva CLI** | Canva | CLI for creating and managing Canva Apps |
| **assistant-ui** | assistant-ui | Terminal chat: `@assistant-ui/react-ink` with DiffView, ToolFallback, Markdown |
| **Neox CLI** | Neox | Moved back to Ink after 3 weeks: "8,830 lines down to 1,868" |
| **codie** | Community | Agentic coding CLI for llama.cpp |
| **twikcc** | Community | Customize Claude Code styling |
| **Nanocoder** | Community | Local-first AI coding agent |

> "Vadim Demedes' Ink (React for CLI) has become the default UI layer for AI coding tools — Claude Code, Gemini CLI, and Qwen Code all render on top of Ink + Yoga." — [Gerald Chen, June 2026](https://chenguangliang.com/en/posts/blog196_cli-second-spring-ai-era-three-structural-reasons/)

### 4.2 Blessed / Blessed-Contrib

Source: [blessed-contrib GitHub](https://github.com/yaronn/blessed-contrib), [awesome-blessed](https://github.com/rajasegar/awesome-blessed), [Silvery vs Blessed](https://silvery.dev/guide/silvery-vs-blessed.html):

| Product | Details |
|---|---|
| **polyv-live-cli** | Live streaming management CLI, uses blessed + blessed-contrib + cli-table3. Active (v1.6.0, Oct 2026). [npm](https://www.npmjs.com/package/polyv-live-cli) |
| **a3m-router** | LLM router TUI dashboard with provider health, cost gauge, live logs. Built with blessed + blessed-contrib. [Commit](https://github.com/Das-rebel/a3m-router/commit/ea58b315d1866ef173795cc7ae00f79d3f7fff51) |
| **MUSUHI dashboard** | TUI dashboard for 8-stage SDD workflow, active agents, P-wave execution. blessed-contrib. [npm](https://registry.npmjs.org/@musuhi-ng/dashboard) |
| **Valkyrie** | Distributed load testing C2 dashboard. blessed-contrib + Redis. [GitHub](https://github.com/phantekzy/valkyrie) |
| **Infernet Protocol** | GPU compute marketplace CLI tooling. [Issue #250](https://github.com/yaronn/blessed-contrib/issues/250) |
| **b1dz** | Crypto trading dashboard. [Issue #250](https://github.com/yaronn/blessed-contrib/issues/250) |
| **slap** | Text editor (original blessed use case) |
| **kubebox** | Terminal console for Kubernetes |
| **webpack-dashboard** | CLI dashboard for webpack dev server |

> **Maintenance status**: Blessed last release was **2015** (v0.1.81). blessed-contrib last commit was **2022-02-17**. 97 open issues, 0/10 maintenance score. [deps.dev](https://deps.dev/npm/blessed-contrib). The de-facto active fork is [neo-blessed](https://github.com/tyzahn/neo-blessed) (v2.0.2, early 2026).
>
> "Despite being unmaintained, Blessed still sees ~1M+ npm weekly downloads — a testament to how many production CLIs depend on it." — [Silvery docs](https://silvery.dev/guide/silvery-vs-blessed.html)

### 4.3 OpenTUI

Source: [OpenTUI GitHub](https://github.com/anomalyco/opentui), [OpenTUI website](https://opentui.com/), [OpenReplay blog](https://blog.openreplay.com/opentui-alternative-ink/), [OpenCode v1.0.0 release](https://github.com/anomalyco/opencode/releases/tag/v1.0.0):

| Product | Details |
|---|---|
| **OpenCode** | "OpenCode uses OpenTUI in production for millions of users." Complete TUI rewrite from Go+Bubble Tea to Zig+SolidJS. [v1.0.0 release notes](https://github.com/anomalyco/opencode/releases/tag/v1.0.0) |
| **terminal.shop** | "It will also power terminal.shop." (mentioned in [README](https://github.com/anomalyco/opentui)) |
| **Roo Code** | Evaluating OpenTUI as alternative to Ink. [Issue #11705](https://github.com/RooCodeInc/Roo-Code/issues/11705) |
| **termcn** | Terminal UI components for shadcn/ui, built on both Ink and OpenTUI. [GitHub](https://github.com/shadcn-labs/termcn) |

> "OpenTUI renders OpenCode's terminal interface in production through its Solid reconciler, replacing a Go and Bubble Tea implementation." — [OpenReplay](https://blog.openreplay.com/opentui-alternative-ink/)
>
> **Distribution constraint**: "An OpenTUI CLI requires every end user to run Bun 1.3+ or Node.js 26.4+ with the experimental `--experimental-ffi` flag." — [OpenReplay](https://blog.openreplay.com/opentui-alternative-ink/)

### 4.4 Clack

Source: [Clack GitHub](https://github.com/bombshell-dev/clack), [PkgPulse guide](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026):

| Product | Details |
|---|---|
| **create-vite** | Vite's project scaffolder migrated to @clack/prompts in [PR #19445](https://github.com/vitejs/vite/pull/19445) (merged Feb 2025). Bundle size: 60.4→53.0 KB |
| **create-vue** | Vue's recommended scaffolder uses @clack/prompts ^1.8.1. [npm](https://www.npmjs.com/package/create-vue), [source](https://github.com/vuejs/create-vue/blob/main/index.ts) |
| **Clerk CLI** | Migrated from Inquirer to @clack/prompts in [PR #305](https://github.com/clerk/cli/pull/305) (merged Jun 2026). +2162 -1374 lines across 66 files |
| **Template-NEXT** | Next.js scaffolder using Clack + Commander + Chalk + Ora. [thilina.dev](https://thilina.dev/work/template-next) |
| **Vercel AI SDK examples** | Used in [Telerik tutorial](https://www.telerik.com/blogs/build-first-ai-app-30-minutes-typescript-ai-sdk-gemini) for CLI chatbot |
| **Pattern scaffolder** | Astro pattern library CLI. [Blog post](https://leannerenard.co.uk/blog/building-a-simple-cli-to-scaffold-pattern-templates-with-clack/) |

> "~500K weekly downloads — beautiful defaults, ESM, TypeScript-native, 2KB" — [PkgPulse](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026)

### 4.5 @inquirer/prompts

| Product | Details |
|---|---|
| **Clerk CLI** (pre-migration) | Was the primary prompt library before migrating to Clack in 2026 |
| **1000s of CLIs** | Inquirer.js ecosystem: ~5M weekly downloads across @inquirer/* packages |
| **npm-check-extras** | Uses Inquirer for interactive dependency updates |

---

## 5. Layout Engine Comparison

| Feature | Ink | Blessed | OpenTUI | Clack | @inquirer/prompts |
|---|---|---|---|---|---|
| **Layout model** | Yoga Flexbox (WASM) | Manual box model (top/left/width/height) | Yoga Flexbox (native Zig) | None (prompt-only) | None (prompt-only) |
| **Flex properties** | `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `gap`, `padding`, `margin`, `border` | `top`, `left`, `width`, `height`, `padding` (manual) | Same as Ink: `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `gap`, `padding`, `margin`, `border` | N/A | N/A |
| **Percent sizes** | ✅ `"50%"` | ✅ `'30%'` | ✅ `"50%"` | N/A | N/A |
| **Border styles** | `single`, `round`, `double`, `bold`, `blessed`, `classic`, `harp`, `big` | `line`, `blessed`, `round`, `harp`, `square` | `single`, `round`, `double`, `bold`, `classic`, `blessed`, `harp`, `big` | N/A | N/A |
| **Box drawing chars** | Unicode `─│┌┐└┘├┤┬┴┼` | Unicode (same set) | Unicode (same set) | N/A | N/A |
| **Rounded corners** | ✅ `borderStyle="round"` | ✅ `border: {type: "round"}` | ✅ `borderStyle: "rounded"` | N/A | N/A |
| **OpenType ligatures** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **RTL (Arabic/Hebrew)** | ❌ Broken (logical order only) | ❌ | ❌ (PR #48587 closed, needs V2 port) | ❌ | ❌ |
| **Grapheme awareness** | ✅ (Ink 7+ handles grapheme boundaries in incremental rendering) | ⚠️ (`fullUnicode` option) | ✅ (native Zig handles grapheme clusters) | ⚠️ | ⚠️ |

### 5.1 Yoga Layout (Ink + OpenTUI)

Both Ink and OpenTUI use **Yoga** (Meta's Flexbox engine) for layout. In Ink, Yoga runs as WASM (~45 KB, async init). In OpenTUI, Yoga is compiled into the native Zig core.

Source: [OpenTUI layout docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/layout.mdx):

```typescript
// OpenTUI RenderableOptions (identical to Ink Box props)
{
  flexDirection: "column" | "column-reverse" | "row" | "row-reverse"  // default: "column"
  flexWrap: "no-wrap" | "wrap" | "wrap-reverse"                        // default: "no-wrap"
  justifyContent: "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly"
  alignItems: "flex-start" | "center" | "flex-end" | "stretch" | "baseline"
  alignSelf: "auto" | /* same values */
  flexGrow: number       // default: 0
  flexShrink: number     // default: 0 (numeric dim) or 1
  flexBasis: number | "auto"
  gap: number            // Box-specific
  rowGap: number
  columnGap: number
  overflow: "visible" | "hidden" | "scroll"
  position: "relative" | "absolute"
}
```

### 5.2 Blessed Manual Layout

Blessed uses a **painter's algorithm** with a **screen damage buffer**. No constraint solver — you position everything manually:

Source: [Blessed README](https://github.com/chjj/blessed/blob/master/README.md):

```javascript
var screen = blessed.screen();

// Manual positioning
var box1 = blessed.box({
  parent: screen,
  top: 0, left: 0,
  width: '50%', height: '50%',
  border: { type: 'line', fg: 'blue' },
  content: 'Top-left'
});

var box2 = blessed.box({
  parent: screen,
  top: '50%', left: '50%',
  width: '50%', height: '50%',
  border: { type: 'round', fg: 'green' },
  content: 'Bottom-right'
});

// Grid layout (blessed-contrib)
var grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });
grid.set(0, 0, 4, 4, contrib.map, { label: 'World Map' });
grid.set(4, 4, 4, 4, blessed.box, { content: 'My Box' });

screen.render();
```

> "The blessed renderer makes use of CSR (change-scroll-region), and BCE (back-color-erase). It draws the screen using the painter's algorithm and is sped up with smart cursor movements and a screen damage buffer. This means rendering of your application will be extremely efficient: blessed only draws the changes (damage) to the screen." — [Blessed README](https://github.com/chjj/blessed/blob/master/README.md)

### 5.3 RTL Support — Detailed Findings

**No library in this comparison has working RTL support.** This is a known gap across the entire Node.js TUI ecosystem:

- **Ink**: [Claude Code issue #34446](https://github.com/anthropics/claude-code/issues/34446) — "Hebrew text displays reversed/broken in Claude Code's terminal UI. The text renders left-to-right instead of right-to-left." The Ink-based renderer forces LTR layout.
- **OpenTUI**: [PR #48587](https://github.com/anomalyco/opencode/pull/48587) added Arabic/RTL support via `bidi-js` wrapper, subclassing OpenTUI's renderables. **Closed** — "We're no longer taking PRs for V1. If you think this is still relevant, please port it over and open for V2."
- **Blessed**: No RTL support in the codebase.
- **Clack / @inquirer/prompts**: No RTL support.

**Terminal-level RTL** (the correct layer for bidi):
- VTE 0.76+ has BiDi support (GNOME Terminal)
- Otty 1.2.0+ has BiDi support
- xterm.js has `@bidiscope/xterm` addon (first BiDi addon, Apr 2026)
- Windows Terminal: No BiDi support
- Alacritty: [Issue #663](https://github.com/alacritty/alacritty/issues/663) open since 2017
- Warp: [Issue #10355](https://github.com/warpdotdev/warp/issues/10355) open since May 2026

> **OpenForge implication**: If RTL support is a requirement, it must be handled at the application layer using a bidi library (e.g., `bidi-js`) that wraps the text before passing it to the TUI renderer. No TUI library in this comparison solves this.

---

## 6. Accessibility

### 6.1 Screen Reader Support

| Feature | Ink | Blessed | OpenTUI | Clack | @inquirer/prompts |
|---|---|---|---|---|---|
| **Screen reader mode** | ✅ `isScreenReaderEnabled: true` or `INK_SCREEN_READER=true` | ❌ | ❌ (issue #423 open) | ⚠️ `accessible: true` option | ⚠️ Basic |
| **ARIA attributes** | ✅ `aria-label`, `aria-hidden`, `aria-role`, `ariaState` on `<Box>` and `<Text>` | ❌ | ❌ | ❌ | ❌ |
| **Semantic output** | ✅ Linear text representation with roles: `(checked) checkbox: Accept terms` | ❌ | ❌ | ❌ | ❌ |
| **useIsScreenReaderEnabled()** | ✅ React hook for conditional rendering | ❌ | ❌ | ❌ | ❌ |
| **NVDA support** | ⚠️ Via terminal (Wintty, pty-speak) | ❌ | ❌ | ❌ | ❌ |
| **VoiceOver support** | ⚠️ Via terminal (pty-speak macOS) | ❌ | ❌ | ❌ | ❌ |
| **High contrast mode** | ⚠️ Via terminal theme | ⚠️ Via terminal theme | ⚠️ Via terminal theme | ⚠️ Via terminal theme | ⚠️ Via terminal theme |

### 6.2 Ink Screen Reader Implementation

Source: [Ink PR #746](https://github.com/vadimdemedes/ink/pull/746) (merged Aug 2025 by chrstnb, reviewed by sindresorhus):

```tsx
// Ink component with ARIA attributes
<Box aria-role="checkbox" aria-state={{ checked: true }}>
  Accept terms and conditions
</Box>
// Screen reader output: "(checked) checkbox: Accept terms and conditions"

<Box aria-role="listitem" aria-state={{ selected: true }}>
  TypeScript
</Box>
// Screen reader output: "(selected) listitem: TypeScript"
```

> "When screen reader mode is active, Ink traverses the component tree and generates a linear, text-based representation of the UI, guided by the ARIA attributes." — [PR #746](https://github.com/vadimdemedes/ink/pull/746)

> "I didn't expect that level of attention in a CLI library." — [Florian Narr, codeline.co](https://www.codeline.co/thoughts/repo-review/2025/ink-react-for-cli-apps)

**External screen reader tools for Ink TUIs**:
- [accessible-claude-code](https://github.com/digitalby/accessible-claude-code) — PTY wrapper that linearizes Ink output for screen readers (macOS/Linux)
- [pty-speak](https://github.com/KyleKeane/pty-speak) — Windows terminal built for NVDA/JAWS/Narrator, specifically targets Claude Code (Ink-based)
- [Wintty](https://wintty.io/docs/features/accessibility/) — Exposes terminal grid over UI Automation for NVDA/Narrator

### 6.3 OpenTUI Accessibility

Source: [OpenTUI issue #423](https://github.com/anomalyco/opentui/issues/423):

> "Currently screen readers have a hard time with TUIs. My experience making TUIs accessible is limited. I know that some terminal emulators handle it better than others. But OpenTUI should be able to help out here, by leveraging accessibility APIs on the platform it is running and let Renderables/Elements take aria-labels and other hints that are communicated to the accessibility APIs."

**Status**: Open, no implementation. The [Ratatui discussion #2190](https://github.com/ratatui/ratatui/discussions/2190) explores AccessKit integration but concludes "I'm honestly not aware of any TUI application that communicates with accessibility APIs."

### 6.4 Keyboard Navigation

| Feature | Ink | Blessed | OpenTUI | Clack | @inquirer/prompts |
|---|---|---|---|---|---|
| **Arrow keys** | ✅ `useInput` hook | ✅ `screen.key()` | ✅ Built-in | ✅ Built-in | ✅ Built-in |
| **Tab / Shift+Tab** | ✅ Focus traversal (Ink 7+) | ✅ Focus system | ✅ `@opentui/keymap` | ❌ | ⚠️ |
| **Vim hjkl** | ❌ (community: `ink-vim`) | ❌ | ❌ | ❌ | ❌ |
| **Enter / Space** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Escape** | ✅ | ✅ | ✅ | ✅ (cancel) | ✅ (cancel) |
| **Home / End** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Page Up / Down** | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Kitty keyboard protocol** | ✅ (modifier disambiguation) | ❌ | ❌ | ❌ | ❌ |

---

## 7. Interactive Prompts Comparison

### 7.1 Prompt Type Matrix

| Prompt Type | Clack | @inquirer/prompts | Ink (community) | Blessed |
|---|---|---|---|---|
| **Single-select** | ✅ `select()` | ✅ `select()` | ✅ `ink-select-input` | ✅ `blessed.list()` |
| **Multi-select** | ✅ `multiselect()` | ✅ `checkbox()` | ✅ `ink-select-input` | ✅ `blessed.list({checkbox:true})` |
| **Confirm (Y/N)** | ✅ `confirm()` | ✅ `confirm()` | ✅ custom | ✅ `blessed.button()` |
| **Text input** | ✅ `text()` | ✅ `input()` | ✅ `ink-text-input` | ✅ `blessed.textbox()` |
| **Password** | ✅ `password()` | ✅ `password()` | ✅ `ink-text-input` (mask) | ⚠️ `blessed.textbox({inputType:'hidden'})` |
| **Autocomplete** | ✅ `autocomplete()` | ✅ `search()` / `rawlist()` | ✅ `ink-autocomplete` | ❌ |
| **Fuzzy search** | ✅ `autocomplete()` with filter | ✅ `search()` | ✅ `ink-fuzzy` | ❌ |
| **Number input** | ❌ (validate in text) | ✅ `number()` | ✅ custom | ✅ `blessed.textbox({validator:/^\d+$/})` |
| **Date picker** | ❌ | ❌ | ❌ | ❌ |
| **Scale / Rating** | ❌ | ❌ | ❌ | ❌ |
| **Editor (external)** | ❌ | ✅ `editor()` | ❌ | ❌ |
| **Group (batch)** | ✅ `group()` | ❌ | ❌ | ❌ |
| **Select key** | ✅ `selectKey()` | ❌ | ❌ | ❌ |
| **Multiline text** | ✅ `multiline()` | ✅ `editor()` | ✅ `ink-text-input` | ⚠️ `blessed.textbox()` |

### 7.2 Validation & Filter Hooks

| Feature | Clack | @inquirer/prompts | Inquirer.js (legacy) |
|---|---|---|---|
| **Sync validation** | ✅ `validate: (v) => string \| undefined` | ✅ `validate: (v) => string \| boolean \| Promise<...>` | ✅ `validate: function(input) { ... }` |
| **Async validation** | ✅ (v1.8.0+) `validate: async (v) => ...` | ✅ `validate: async (v) => ...` | ✅ `this.async()` pattern |
| **Filter callback** | ✅ `filter: (v) => transformed` | ✅ `filter: (v) => transformed` | ✅ `filter: function(input) { ... }` |
| **Clear on error** | ✅ `clearOnError: true` (password) | ❌ | ❌ |
| **Standard Schema** | ✅ (accepts Zod/Yup schemas) | ❌ | ❌ |

### 7.3 Code Snippets: Basic Prompt

**Clack** — [source](https://github.com/bombshell-dev/clack/blob/main/_autodocs/api-reference/prompts-select.md):

```typescript
import { select, confirm, text, password, isCancel } from '@clack/prompts';

// Single-select
const projectType = await select({
  message: 'Pick a project type.',
  initialValue: 'ts',
  options: [
    { value: 'ts', label: 'TypeScript' },
    { value: 'js', label: 'JavaScript', disabled: true },
    { value: 'coffee', label: 'CoffeeScript', hint: 'oh no' },
  ],
});
if (isCancel(projectType)) process.exit(0);

// Confirm
const shouldContinue = await confirm({
  message: 'Do you want to continue?',
  active: 'Yep',
  inactive: 'Nope',
  initialValue: false,
});

// Text with validation
const name = await text({
  message: 'Project name:',
  validate: (v) => {
    if (!v) return 'Name is required!';
    if (v.length > 50) return 'Max 50 characters.';
  },
});

// Password with mask
const secret = await password({
  message: 'Set a password.',
  mask: '*',
  clearOnError: true,
  validate: (v) => {
    if (!v || v.length < 8) return 'Min 8 characters.';
  },
});

// Autocomplete
const fruit = await autocomplete({
  message: 'Pick a fruit:',
  options: [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'Cherry' },
  ],
  filter: (input, option) =>
    option.label.toLowerCase().includes(input.toLowerCase()),
});
```

**@inquirer/prompts** — [source](https://github.com/sboudrias/inquirer.js/blob/main/packages/inquirer/README.md):

```typescript
import { select, confirm, input, password, search, number, editor } from '@inquirer/prompts';

// Single-select
const framework = await select({
  message: 'Select your framework',
  choices: [
    { name: 'Next.js', value: 'nextjs' },
    { name: 'React', value: 'react' },
    { name: 'Vue', value: 'vue' },
  ],
});

// Confirm
const proceed = await confirm({
  message: 'Continue?',
  default: true,
});

// Input with async validation
const email = await input({
  message: 'Email:',
  validate: async (v) => {
    if (!v.includes('@')) return 'Invalid email';
    // Async check against API
    const available = await checkAvailability(v);
    return available ? true : 'Already taken';
  },
  filter: (v) => v.toLowerCase().trim(),
});

// Password
const pwd = await password({
  message: 'Password:',
  mask: '*',
});

// Search / autocomplete
const city = await search({
  message: 'Search cities:',
  source: async (term) => {
    const res = await fetch(`/api/cities?q=${term}`);
    return res.json(); // [{ name: 'Berlin', value: 'berlin' }, ...]
  },
});
```

**Ink** (community packages):

```tsx
import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';

function PromptDemo() {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (input === '\r') {
      console.log('Submitted:', value);
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Project name: </Text>
      <TextInput value={value} onChange={setValue} />
      <SelectInput
        items={['TypeScript', 'JavaScript', 'CoffeeScript']}
      />
    </Box>
  );
}

render(<PromptDemo />);
```

**Blessed**:

```javascript
var blessed = require('blessed');

var screen = blessed.screen();

var input = blessed.textbox({
  parent: screen,
  label: 'Project name: ',
  top: 2,
  left: 2,
  width: 40,
  height: 1,
  inputType: 'text',
  style: { fg: 'white' },
});

input.on('submit', function(line) {
  console.log('Submitted:', line);
  process.exit(0);
});

input.focus();
screen.render();
```

---

## 8. Tables, Diffs & Progress Bars

### 8.1 Table Rendering

| Library | Built-in Table | API | Code Snippet |
|---|---|---|---|
| **Ink** | ❌ (use `cli-table3` or custom `<Box>`/`<Text>`) | Compose `<Box>` + `<Text>` | See below |
| **Blessed-Contrib** | ✅ `contrib.table()` | `table.setData({headers, data})` | See below |
| **OpenTUI** | ✅ `TextTableRenderable` | `new TextTableRenderable(renderer, {content})` | See below |
| **cli-table3** | ✅ Standalone | `new Table().push()` | See below |

**Ink + cli-table3** (compositional):

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import Table from 'cli-table3';

function DataTable() {
  const table = new Table({
    head: ['Service', 'Status', 'Latency'],
    style: { head: ['green'], border: ['grey'] },
  });
  table.push(['api', 'OK', '28ms']);
  table.push(['worker', 'DEGRADED', '124ms']);

  return (
    <Box flexDirection="column">
      <Text>{table.toString()}</Text>
    </Box>
  );
}

render(<DataTable />);
```

**Blessed-Contrib** — [source](https://github.com/yaronn/blessed-contrib/blob/master/README.md):

```javascript
var blessed = require('blessed');
var contrib = require('blessed-contrib');

var screen = blessed.screen();

var table = contrib.table({
  keys: true,
  fg: 'white',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: true,
  label: 'Active Processes',
  width: '30%',
  height: '30%',
  border: { type: "line", fg: "cyan" },
  columnSpacing: 10,
  columnWidth: [16, 12, 12],
});

table.setData({
  headers: ['Service', 'Status', 'Latency'],
  data: [
    ['api', 'OK', '28ms'],
    ['worker', 'DEGRADED', '124ms'],
  ]
});

table.focus();
screen.append(table);
screen.render();
```

**OpenTUI** — [source](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/text-table.mdx):

```typescript
import { TextTableRenderable, bold, fg, createCliRenderer, type TextChunk, type TextTableContent } from "@opentui/core";

const renderer = await createCliRenderer();

const cell = (text: string): TextChunk[] => [{ __isChunk: true, text }];

const content: TextTableContent = [
  [[bold("Service")], [bold("Status")], [bold("Notes")]],
  [cell("api"), [fg("#00d4aa")("OK")], cell("latency 28ms")],
  [cell("worker"), [fg("#b8a0ff")("DEGRADED")], cell("queue depth: 124")],
];

const table = new TextTableRenderable(renderer, {
  width: "100%",
  wrapMode: "word",
  columnWidthMode: "content",
  borderStyle: "rounded",
  content,
});

renderer.root.add(table);
renderer.start();
```

Output:
```
╭───────┬────────┬────────────────╮
│Service│Status  │Notes           │
├───────┼────────┼────────────────┤
│api    │OK      │latency 28ms    │
├───────┼────────┼────────────────┤
│worker │DEGRADED│queue depth: 124│
╰───────┴────────┴────────────────╯
```

**cli-table3** (standalone, no TUI framework):

```javascript
const Table = require('cli-table3');

const table = new Table({
  head: ['Service', 'Status', 'Latency'],
  style: { head: ['cyan'], border: ['grey'] },
});
table.push(['api', 'OK', '28ms']);
table.push(['worker', 'DEGRADED', '124ms']);

console.log(table.toString());
```

## 8.2 Diff Rendering (continued)

| Library | Built-in Diff | Quality | Syntax Highlighting |
|---|---|---|---|
| **Ink** | ❌ No built-in | Compose with `<Text>` + `chalk` | ❌ (use `ink-markdown` or `cli-highlight`) |
| **Blessed** | ❌ No built-in | Manual with `<Text>` / `blessed.box` | ❌ |
| **OpenTUI** | ✅ `DiffRenderable` | **Excellent** — unified + split, word-level highlights, line numbers, conceal mode | ✅ Tree-sitter, 20+ languages, 5+ themes |
| **clack** | ❌ (prompt-only) | N/A | N/A |
| **@inquirer/prompts** | ❌ (prompt-only) | N/A | N/A |
| **cli-table3** | ❌ (tables only) | N/A | N/A |

### OpenTUI DiffRenderable — Best-in-Class

Source: [OpenTUI diff docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/diff.mdx), [diff-demo.ts](https://github.com/anomalyco/opentui/blob/main/packages/examples/src/diff-demo.ts):

```typescript
import { DiffRenderable, SyntaxStyle, RGBA, createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer()

const syntaxStyle = SyntaxStyle.fromStyles(
  {
    default: { fg: RGBA.fromHex("#E6EDF3") },
    string: { fg: RGBA.fromHex("#A5D6FF") },
    keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
  },
  renderer.nativeScene,
)

const patch = `diff --git a/app.ts b/app.ts
index 1111111..2222222 100644
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
 setup()
-const a = 1
+const a = 2
 ready(a)
`

const diff = new DiffRenderable(renderer, {
  id: "diff",
  width: "100%",
  height: 16,
  diff: patch,
  view: "split",          // "unified" | "split"
  filetype: "typescript",
  syntaxStyle,
  showLineNumbers: true,
  wrapMode: "word",       // "none" | "word"
  conceal: true,           // hide/show markup
  addedBg: RGBA.fromHex("#033a16"),
  removedBg: RGBA.fromHex("#3d1214"),
  addedSignColor: RGBA.fromHex("#3fb950"),
  removedSignColor: RGBA.fromHex("#f85149"),
})

renderer.root.add(diff)
renderer.start()
```

**DiffRenderable features** (from [API index](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/reference/api-index.mdx)):
- Unified and split (side-by-side) views
- Word-level diff highlighting
- Tree-sitter syntax highlighting (20+ languages)
- Line numbers with add/remove coloring
- 5+ built-in themes (GitHub Dark, Dracula, Monokai, One Dark, Nord, Tokyo Night)
- `conceal` mode to hide/show markup
- Malformed diff tolerance
- Multi-file navigation (in [differential](https://github.com/avgvstvs96/differential) wrapper)

### Ink Diff (Manual Composition)

```tsx
import React from 'react';
import { render, Box, Text } from 'ink';
import chalk from 'chalk';

// Parse diff lines and color them
function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>
          {line.startsWith('+')
            ? <Text color="green">{line}</Text>
            : line.startsWith('-')
            ? <Text color="red">{line}</Text>
            : line.startsWith('@')
            ? <Text color="cyan">{line}</Text>
            : <Text dimColor>{line}</Text>}
        </Text>
      ))}
    </Box>
  );
}

render(<DiffView patch={gitDiffOutput} />);
```

### assistant-ui DiffView (Ink-based, production)

Source: [assistant-ui launch](https://www.assistant-ui.com/blog/2026-03-launch-week):

> "Code diff rendering. Built-in `DiffView` component and composable `DiffPrimitive` components for displaying code diffs with syntax highlighting, line numbers, and context folding."

```tsx
// @assistant-ui/react-ink
import { DiffView } from '@assistant-ui/react-ink';

function MyChat() {
  return (
    <ThreadRoot>
      <DiffView /* ... */ />
    </ThreadRoot>
  );
}
```

---

## 8.3 Progress Bars

| Library | Built-in | API | Ecosystem |
|---|---|---|---|
| **Ink** | ❌ No built-in | Compose with `<Box>` + `<Text>` + state | `ink-spinner`, custom, `cli-progress` (external) |
| **Blessed-Contrib** | ✅ `contrib.bar` | `bar.setPercentage(n)` | Built-in |
| **OpenTUI** | ⚠️ Manual (FrameBuffer) | `drawProgressBar()` with `setCell` | No standalone component |
| **clack** | ⚠️ `spinner()` | `const spinner = p.spinner()` | Built-in spinner only |
| **@inquirer/prompts** | ❌ | N/A | Use `ora` or `listr2` |
| **cli-progress** | ✅ Standalone | `bar.start()`, `bar.update()`, `bar.stop()` | Framework-agnostic |
| **listr2** | ✅ Standalone | Task list with per-task spinners | Framework-agnostic, 56.7M weekly downloads |
| **ora** | ✅ Standalone | `ora('msg').start()`, `ora.succeed()` | Framework-agnostic spinner |

### Code Snippets: Progress Bar

**cli-progress** (framework-agnostic) — [source](https://github.com/npkgz/cli-progress):

```javascript
const cliProgress = require('cli-progress');

const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
bar.start(200, 0);

// Simulate work
for (let i = 0; i <= 200; i += 10) {
  setTimeout(() => bar.update(i), 100);
}

// Or with custom format:
const bar2 = new cliProgress.SingleBar({
  format: '{file} {bar} {percentage}% | ETA: {eta}s | {value}/{total}',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  fps: 10,
});
bar2.start(100, 0);
```

**listr2** (task list with progress) — [source](https://www.npmjs.com/package/listr2):

```javascript
import { Listr } from 'listr2';

const tasks = new Listr([
  {
    title: 'Building project',
    task: () => buildProject(),
  },
  {
    title: 'Running tests',
    task: (ctx, task) => {
      const subTasks = new Listr([
        { title: 'Unit tests', task: () => runUnitTests() },
        { title: 'Integration tests', task: () => runIntegrationTests() },
      ]);
      return subTasks.run();
    },
  },
  {
    title: 'Deploying',
    task: () => deploy(),
    skip: (ctx) => ctx.skipDeploy,
  },
]);

await tasks.run();
```

**Ink** (custom progress bar component):

```tsx
import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';

function ProgressBar({ total, label = 'Progress' }) {
  const [current, setCurrent] = useState(0);
  const width = 40;
  const filled = Math.round((current / total) * width);
  const pct = Math.round((current / total) * 100);

  useEffect(() => {
    const id = setInterval(() => {
      setCurrent((c) => (c < total ? c + Math.ceil(total / 50) : c));
    }, 100);
    return () => clearInterval(id);
  }, [total]);

  return (
    <Box>
      <Text>{label}: </Text>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
      <Text> {pct}%</Text>
    </Box>
  );
}

render(<ProgressBar total={100} label="Uploading" />);
```

**OpenTUI** (FrameBuffer progress bar) — [source](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/frame-buffer.mdx):

```typescript
const EMPTY_BG = RGBA.fromHex("#222222");

function drawProgressBar(fb, x, y, width, progress, color) {
  const filled = Math.floor(width * progress);
  for (let i = 0; i < filled; i++) {
    fb.setCell(x + i, y, "█", color, EMPTY_BG);
  }
  for (let i = filled; i < width; i++) {
    fb.setCell(x + i, y, "░", RGBA.fromHex("#333333"), EMPTY_BG);
  }
}

// Usage: 75% progress, green, 30 cells wide
drawProgressBar(canvas.frameBuffer, 5, 10, 30, 0.75, RGBA.fromHex("#00FF00"));
```

**Blessed-Contrib**:

```javascript
var contrib = require('blessed-contrib');
var screen = blessed.screen();

var bar = contrib.bar({
  label: 'Progress',
  bar: { fg: 'green' },
  height: 3,
});
screen.append(bar);
bar.setPercentage(75);
screen.render();
```

**Clack** (spinner only, no progress bar):

```typescript
import * as p from '@clack/prompts';

const spinner = p.spinner();
spinner.start('Installing dependencies...');

await installDependencies();

spinner.stop('Dependencies installed ✓');
```

---

## 9. Recommended 5th Option: @inquirer/prompts

### Why @inquirer/prompts

| Criterion | @inquirer/prompts | Clack | Inquirer.js (legacy) |
|---|---|---|---|
| **Bundle size (unpacked)** | **24.9 KB** | 91.5 KB | ~49 KB (inquirer) |
| **Weekly downloads** | ~5M (inquirer ecosystem) | ~500K | ~5M |
| **TypeScript** | ✅ Native | ✅ Native | ⚠️ @types |
| **ESM** | ✅ | ✅ | ⚠️ CJS |
| **Prompt types** | 10+ (select, checkbox, confirm, input, password, number, search, editor, spinner, rawlist) | 8 core | 12+ |
| **Async validation** | ✅ | ✅ (v1.8+) | ✅ (this.async) |
| **Filter callbacks** | ✅ | ✅ | ✅ |
| **Search/autocomplete** | ✅ `search()` | ✅ `autocomplete()` | ❌ |
| **Number input** | ✅ `number()` | ❌ | ✅ |
| **Editor (external)** | ✅ `editor()` | ❌ | ✅ |
| **Spinner** | ✅ `spinner()` | ✅ `spinner()` | ❌ |
| **Group/batch** | ❌ | ✅ `group()` | ❌ |
| **Standard Schema (Zod)** | ❌ | ✅ | ❌ |
| **Maintenance** | ✅ Active (v8.7.5) | ✅ Active (v1.8.1) | ⚠️ In transition to @inquirer/* |
| **Runtime requirement** | Node 18+ | Node 18+ ESM | Node 12+ |

### When to Use @inquirer/prompts vs Clack

**Choose @inquirer/prompts when**:
- You want the lightest prompt dependency (25 KB vs 92 KB)
- You need `number()`, `search()`, `editor()`, `spinner()` prompt types
- You want the most battle-tested prompt library (Inquirer.js lineage, 10+ years)
- You don't need `group()` batching or Standard Schema validation
- You want a single dependency that covers all prompt types without community packages

**Choose Clack when**:
- You want the most beautiful default styling
- You need `group()` for batched prompt flows
- You need Standard Schema (Zod) validation
- You want `selectKey()` for vim-style key selection
- Your team is already using Clack (create-vite pattern)

**For OpenForge CLI**: Use **both**. Clack for the primary prompt UX (beautiful defaults, group flows) and @inquirer/prompts as a fallback for environments where Clack's ESM requirement is a problem, or for specific prompt types Clack lacks (number, editor).

### @inquirer/prompts Code Snippet

```typescript
import { select, input, confirm, password, search, number, spinner } from '@inquirer/prompts';

// All prompt types in one import
const framework = await select({
  message: 'Framework:',
  choices: [
    { name: 'React', value: 'react' },
    { name: 'Vue', value: 'vue' },
    { name: 'Svelte', value: 'svelte' },
  ],
});

const port = await number({
  message: 'Port:',
  default: 3000,
  min: 1024,
  max: 65535,
});

const token = await password({
  message: 'API token:',
  mask: '*',
});

const env = await search({
  message: 'Search environments:',
  source: async (term) => {
    return fetchEnvironments(term); // [{ name: 'staging', value: 'staging' }, ...]
  },
});

const s = spinner().start('Deploying...');
await deploy();
s.succeed('Deployed ✓');
```

---

## 10. Final Recommendation for OpenForge CLI

### Architecture: Layered Stack

```
┌─────────────────────────────────────────────────────────┐
│                    OpenForge CLI                         │
├─────────────────────────────────────────────────────────┤
│  PROMPT LAYER (one-shot interactions)                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ @clack/prompts (primary)                          │  │
│  │   select, confirm, text, password, autocomplete   │  │
│  │   spinner, intro, outro, group                    │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ @inquirer/prompts (fallback / complement)         │  │
│  │   number, search, editor, spinner                 │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  RENDER LAYER (stateful, live-updating UI)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Ink 7/8 + React 19                               │  │
│  │   Tables (Box + Text + cli-table3)                │  │
│  │   Progress bars (custom component)                │  │
│  │   Status dashboards, spinners                     │  │
│  │   Diffs (manual composition + chalk)              │  │
│  │   Screen reader mode (INK_SCREEN_READER)          │  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  UTILITY LAYER                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ chalk (styling)                                    │  │
│  │ cli-table3 (tables)                                │  │
│  │ ora (spinners, if not using clack spinner)         │  │
│  │ listr2 (task pipelines)                            │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Why Ink + Clack (Not the Alternatives)

| Decision Factor | Ink + Clack | OpenTUI | Blessed | Pure Clack |
|---|---|---|---|---|
| **Node 20+ compatible** | ✅ | ❌ Needs Bun 1.3+ or Node 26.4+ FFI | ✅ | ✅ |
| **npm install -g friendly** | ✅ (605 KB + React) | ⚠️ 17.8 MB native binary | ✅ | ✅ |
| **Compiled binary size** | +0.63 MiB over baseline | +10.59 MiB over baseline | ~0 | ~0 |
| **Ecosystem** | Largest (ink-spinner, ink-text-input, ink-select-input, ink-markdown, etc.) | Growing but small (OpenCode only) | Stale (2015) | Prompts only |
| **Live updating UI** | ✅ React state | ✅ Native 60fps | ✅ Damage buffer | ❌ One-shot only |
| **Table rendering** | ✅ Compose or cli-table3 | ✅ TextTableRenderable | ✅ contrib.table | ❌ |
| **Diff rendering** | ⚠️ Manual | ✅✅ Best-in-class | ❌ | ❌ |
| **Progress bars** | ✅ Custom component | ⚠️ FrameBuffer | ✅ contrib.bar | ⚠️ Spinner only |
| **Screen reader** | ✅ ARIA + linear output | ❌ Open issue | ❌ | ⚠️ Basic |
| **Production proof** | Claude Code, Gemini, Wrangler, Prisma, Linear | OpenCode | polyv-live-cli | create-vite, create-vue |
| **CI / non-interactive** | ✅ Auto-detect | ✅ | ✅ | ✅ |
| **Windows Terminal** | ✅ | ✅ | ⚠️ No mouse/resize | ✅ |
| **RTL** | ❌ (all libraries fail) | ❌ | ❌ | ❌ |

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ink 30fps cap causes jank on streaming output | Medium | Medium | Set `maxFps: 60` + `incrementalRendering: true`. Accept 99MB memory floor. If insufficient, OpenTUI is the upgrade path |
| Ink + React adds 777 KB to bundle | Low | Low | Acceptable for `npm install -g`. For compiled binaries, +0.63 MiB is negligible |
| No RTL support in any library | High | Medium | Handle at application layer with `bidi-js`. Accept that terminal-level RTL is a terminal emulator concern, not a TUI library concern |
| OpenTUI Bun/Node 26+ requirement blocks users | High | High | **Do not use OpenTUI for OpenForge.** Use Ink. Re-evaluate when OpenTUI drops the FFI requirement or when Node 26 is LTS |
| Blessed is unmaintained (2015) | High | High | **Do not use Blessed for new projects.** Only for legacy maintenance |
| Clack ESM-only breaks CJS consumers | Medium | Low | OpenForge is ESM (TypeScript monorepo, Node 20+). Not a problem |
| Screen reader support is incomplete ecosystem-wide | High | Medium | Use Ink's `isScreenReaderEnabled` mode. Document that full accessibility requires terminal-level support (Wintty, pty-speak) |

### Migration Path (If Performance Becomes a Bottleneck)

```
Phase 1 (now):  Ink + Clack
  - 99 MB memory, 30 fps cap, 605 KB bundle
  - Sufficient for: tables, prompts, progress, diffs, status displays

Phase 2 (if needed):  Ink + incrementalRendering + maxFps: 60
  - 166 MB memory, ~50 fps effective
  - Sufficient for: streaming output, large tables

Phase 3 (if still not enough):  OpenTUI Core (imperative, no React)
  - ~100-190 MB memory, 60+ fps
  - Requires: Bun 1.3+ or Node 26.4+ with --experimental-ffi
  - Bundle: +10.59 MiB to compiled binary
  - Only if OpenForge becomes a streaming-heavy tool (log viewer, live dashboard)
```

---

## 11. Complete Source Index

### Benchmarks
1. [Bubble Tea vs Ink vs Ratatui: TUI Benchmarks](https://duong.page/post/2026-10-03-bubble-tea-vs-ink-vs-ratatui/) — Duong Nguyen, 2026-10-03. Cold start, memory, fps, bytes. Same-app comparison.
2. [Rezi BENCHMARKS.md](https://github.com/RtlZeroMemory/Rezi/blob/main/BENCHMARKS.md) — Cross-framework benchmark suite (Rezi, Ink, OpenTUI, Bubble Tea, Ratatui, terminal-kit, blessed). 2026-02-22.
3. [tui-benchmarks](https://github.com/nathan-cannon/tui-benchmarks) — nathan-cannon. Frame latency for single cell update and streaming append. Apple M4 Max.
4. [Stele: OpenTUI vs Ink](https://stele-ai.dev/blog/opentui-vs-ink) — Compiled executable size comparison. 2026-10-09.
5. [Silvery vs Ink](https://silvery.dev/guide/silvery-vs-ink.html) — Bjørn Stabell. Cold render and mounted rerender comparison. 2026-04-09.
6. [OpenReplay: Is OpenTUI a Real Alternative to Ink?](https://blog.openreplay.com/opentui-alternative-ink/) — 2026-09-10. Architecture comparison, fps cap analysis, distribution constraints.
7. [Better Stack: OpenTUI React](https://betterstack.com/community/guides/scaling-nodejs/opentui-react/) — Stanley Ulili. Memory and fps comparison with Ink.

### Production Usage
8. [Ink README — Who's Using Ink?](https://github.com/vadimdemedes/ink) — Full list of 50+ production users.
9. [Claude Code Architecture](https://github.com/lai3d/claude-code-architecture) — Deep dive into Claude Code's Ink fork.
10. [OpenCode v1.0.0 Release](https://github.com/anomalyco/opencode/releases/tag/v1.0.0) — OpenTUI production deployment announcement.
11. [OpenTUI GitHub](https://github.com/anomalyco/opentui) — "OpenCode uses OpenTUI in production for millions of users."
12. [create-vite PR #19445](https://github.com/vitejs/vite/pull/19445) — Vite migration to @clack/prompts.
13. [create-vue source](https://github.com/vuejs/create-vue/blob/main/index.ts) — @clack/prompts usage.

### Production Usage (continued)

14. [Clerk CLI PR #305](https://github.com/clerk/cli/pull/305) — Migration from @inquirer/* to @clack/prompts. Merged Jun 2026.
15. [Neox CLI blog](https://neox-dev.com/blog/cli-renderer-ink-ansi-ink) — "Our CLI renderer changed twice in three weeks: off Ink and back again." 8,830 → 1,868 lines. 2026-01-03.
16. [Gerald Chen: CLI's Second Spring](https://chenguangliang.com/en/posts/blog196_cli-second-spring-ai-era-three-structural-reasons/) — Ink as default for AI coding tools. 2026-06-25.
17. [polyv-live-cli npm](https://www.npmjs.com/package/polyv-live-cli) — blessed + blessed-contrib production CLI. Active Oct 2026.
18. [a3m-router commit](https://github.com/Das-rebel/a3m-router/commit/ea58b315d1866ef173795cc7ae00f79d3f7fff51) — blessed TUI dashboard. 2026-05-26.
19. [MUSUHI dashboard](https://registry.npmjs.org/@musuhi-ng/dashboard) — blessed-contrib TUI dashboard. Nov 2025.
20. [awesome-blessed](https://github.com/rajasegar/awesome-blessed) — Curated list of blessed-based projects.
21. [assistant-ui launch](https://www.assistant-ui.com/blog/2026-03-launch-week) — `@assistant-ui/react-ink` with DiffView, ToolFallback. 2026-03-09.
22. [Roo Code Issue #11705](https://github.com/RooCodeInc/Roo-Code/issues/11705) — Evaluating OpenTUI as alternative to Ink.
23. [termcn](https://github.com/shadcn-labs/termcn) — Terminal UI components on Ink + OpenTUI for shadcn/ui.

### Terminal Compatibility
24. [OpenTUI terminal capabilities](https://opentui.com/docs/reference/terminal-capabilities/) — tmux, Zellij, GNU Screen detection and feature policy.
25. [OpenTUI notifications](https://opentui.com/docs/core-concepts/notifications/) — OSC 99/777/9 protocol selection per terminal.
26. [FrankenTUI Terminal Compatibility Matrix](https://docs.frankentui.com/reference/terminal-compatibility) — Feature matrix: true color, sync output, OSC 8, Kitty keyboard, images.
27. [SuperLightTUI terminal compatibility](https://github.com/subinium/SuperLightTUI/blob/main/docs/guide/11-terminal-compatibility.md) — Verified vs expected terminal support, multiplexer behavior.
28. [Ink terminal.ts (cybercode)](https://github.com/wk42worldworld/cybercode/blob/main/src/ink/terminal.ts) — DEC 2026 detection: tmux skip, iTerm2/WezTerm/Ghostty/VS Code/Alacritty/Kitty support.
29. [Blessed README — Windows notes](https://github.com/chjj/blessed/blob/master/README.md) — "No mouse or resize event support on Windows."
30. [termui COMPATIBILITY.md](https://github.com/Arindam200/termui/blob/main/COMPATIBILITY.md) — Terminal × OS × Feature matrix including tmux, WSL, Git Bash.

### Accessibility
31. [Ink PR #746: Screen Reader and ARIA support](https://github.com/vadimdemedes/ink/pull/746) — Merged Aug 2025. `isScreenReaderEnabled`, `aria-label`, `aria-role`, `aria-state`.
32. [Florian Narr: Ink review](https://www.codeline.co/thoughts/repo-review/2025/ink-react-for-cli-apps) — "I didn't expect that level of attention in a CLI library." Screen reader path, Yoga, input handling.
33. [OpenTUI issue #423: Accessibility](https://github.com/anomalyco/opentui/issues/423) — Open, no implementation.
34. [accessible-claude-code](https://github.com/digitalby/accessible-claude-code) — PTY wrapper making Ink TUIs usable with screen readers.
35. [pty-speak](https://github.com/KyleKeane/pty-speak) — Windows terminal for NVDA/JAWS/Narrator, targets Claude Code.
36. [Wintty accessibility](https://wintty.io/docs/features/accessibility/) — UIA exposure, NVDA/Narrator, high contrast.
37. [Ratatui discussion #2190: AccessKit](https://github.com/ratatui/ratatui/discussions/2190) — "I'm honestly not aware of any TUI application that communicates with accessibility APIs."
38. [FrankenTUI ACCESSIBILITY.md](https://github.com/Dicklesworthstone/frankentui/blob/main/ACCESSIBILITY.md) — A11y tree, focus management, keyboard nav reference.
39. [termcn accessibility changelog](https://www.termcn.dev/docs/changelog/2026-08-03-accessibility-improvements) — Ink accessibility pass: keyboard, focus, screen reader, reduced motion.

### RTL / Bidirectional
40. [Claude Code issue #34446](https://github.com/anthropics/claude-code/issues/34446) — Hebrew/RTL broken in Ink-based TUI.
41. [OpenCode PR #48587](https://github.com/anomalyco/opencode/pull/48587) — Arabic/RTL support for OpenTUI. Closed, needs V2 port.
42. [OpenClaw issue #21936](https://github.com/openclaw/openclaw/issues/21936) — Arabic/RTL reversed in TUI chat. Fixed with bidi isolation marks.
43. [Alacritty issue #663](https://github.com/alacritty/alacritty/issues/663) — BiDi support request, open since 2017.
44. [Warp issue #10355](https://github.com/warpdotdev/warp/issues/10355) — RTL text direction support. Open since May 2026.
45. [@bidiscope/xterm](https://github.com/DADiS0/bidiscope/commit/70ff6c52153e025c1aa7efd9ae6d177b65d65b2f) — First BiDi addon for xterm.js. Apr 2026.
46. [Otty BiDi docs](https://docs.otty.sh/terminal-features/bidi-rtl) — Terminal-level RTL rendering.
47. [SwiftTerm PR #589](https://github.com/migueldeicaza/SwiftTerm/pull/589) — BiDi support for macOS terminal. Jul 2026.
48. [FrankenTUI BiDi/RTL docs](https://docs.frankentui.com/a11y-i18n/bidi-rtl-support) — UAX #9 implementation in Rust TUI.

### Diffs & Progress
49. [OpenTUI diff docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/diff.mdx) — DiffRenderable API.
50. [OpenTUI diff demo](https://github.com/anomalyco/opentui/blob/main/packages/examples/src/diff-demo.ts) — Full interactive diff viewer.
51. [differential](https://github.com/avgvstvs96/differential) — Terminal diff viewer on OpenTUI DiffRenderable. Archived.
52. [cli-progress](https://github.com/npkgz/cli-progress) — Framework-agnostic progress bar. TTY and NOTTY modes.
53. [listr2 npm](https://www.npmjs.com/package/listr2) — Task list with nested subtasks. 56.7M weekly downloads.
54. [OpenTUI API index](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/reference/api-index.mdx) — Full component list. No standalone progress bar component.
55. [OpenTUI FrameBuffer docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/frame-buffer.mdx) — drawProgressBar example.

### Bundle Sizes
56. [PkgPulse: Ink vs Clack vs Enquirer](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026) — Bundle sizes, download trends, feature comparison. 2026-03-09.
57. [npm-compare: blessed vs ink](https://npm-compare.com/blessed,ink) — Size, downloads, stars comparison.
58. [KappaKit npm package size index](https://kappakit.com/research/npm-package-size-index.html) — Unpacked sizes from npm registry. 2026-04-10.
59. [npm registry API](https://registry.npmjs.org/) — Verified unpacked sizes for all 11 packages, 2026-11-03.

### Layout & Architecture
60. [Ink configuration docs](https://github.com/vadimdemedes/ink/blob/master/_autodocs/configuration.md) — RenderOptions: maxFps, incrementalRendering, isScreenReaderEnabled, alternateScreen, interactive.
61. [OpenTUI layout docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/layout.mdx) — RenderableOptions: Yoga flexbox properties.
62. [OpenTUI renderer docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/renderer.mdx) — targetFps, maxFps, getStats().
63. [Blessed configuration](https://github.com/chjj/blessed/blob/master/_autodocs/configuration.md) — Screen options: smartCSR, useBCE, fullUnicode, autoPadding.
64. [Blessed-contrib README](https://github.com/yaronn/blessed-contrib/blob/master/README.md) — Table, log, grid, chart widgets.
65. [Clack API reference](https://github.com/bombshell-dev/clack/blob/main/_autodocs/api-reference/prompts-select.md) — Select, confirm, password, text, autocomplete, multiselect, group.
66. [Clack types](https://github.com/bombshell-dev/clack/blob/main/_autodocs/types.md) — Option types for all prompt variants.
67. [Inquirer.js README](https://github.com/sboudrias/inquirer.js/blob/main/packages/inquirer/README.md) — Question object, async validation, filter, transformer.
68. [Inquirer.js types](https://github.com/sboudrias/inquirer.js/blob/main/packages/inquirer/src/types.ts) — Valid prompt type union.
69. [Silvery vs Blessed](https://silvery.dev/guide/silvery-vs-blessed.html) — Blessed maintenance status, fork landscape, terminal compatibility.
70. [blessed-contrib issue #250](https://github.com/yaronn/blessed-contrib/issues/250) — Maintenance status inquiry. Last commit 2022-02-17.
71. [deps.dev blessed-contrib](https://deps.dev/npm/blessed-contrib) — 0/10 maintenance score, 0 commits in 90 days.

### Miscellaneous
72. [OpenCode TUI plugin docs](https://opencode.ai/v2/docs/build/plugins/cli/) — TUI plugin API on OpenTUI.
73. [DeepWiki: OpenCode TUI](https://deepwiki.com/sst/opencode/6.2-terminal-user-interface-(tui)) — TUI architecture: SolidJS + @opentui.
74. [OpenTUI releases](https://github.com/anomalyco/opentui/releases) — v0.8.1: video, frame:dropped events, performance improvements.
75. [Clack best practices](https://bomb.sh/docs/clack/guides/best-practices/) — Error handling, validation, batch operations, progressive disclosure.
76. [Clack issue #533: Resumable prompts](https://github.com/bombshell-dev/clack/issues/533) — Agent-environment compatibility. posva (Vue core team) proposal.
77. [awesome-terminal-aesthetics](https://github.com/kud/awesome-terminal-aesthetics) — TUI frameworks, styling, CLI tools curation.
78. [SmartCLI works-tui](https://github.com/dwgx/SmartCLI/blob/main/knowledge/sources/works-tui.md) — Ratatui, Ink, blessed architecture notes.
79. [Ink npm](https://npmx.dev/package/ink) — v7.0.5, 25 deps, 537.3 kB install, Node >=22.
80. [@opentui/react npm](https://npmx.dev/package/@opentui/react) — 87.1 kB, 24.3 MB install (native binary included).

---

## 12. Verification Notes & Caveats

1. **Bundle sizes** (section 2.5) were verified live against the npm registry API on 2026-11-03. The `blessed` package reported 0 KB unpacked size, which appears to be a registry metadata issue — the actual tarball is ~1.58 MB per [opencode issue #27](https://github.cnmirror.space/randomm/opencode/issues/27).

2. **Benchmark numbers** are from different machines, dates, and methodologies. The duong.page numbers (Ink 248ms cold start, 160MB memory) are from a single machine, single scene. The Rezi numbers (Ink 5.62ms startup) measure a different metric (framework init, not full process cold start). **Do not mix numbers across sources.** The duong.page and nathan-cannon numbers are the most directly comparable for Ink.

3. **OpenTUI memory numbers** vary wildly by source: 100–190 MB (Rezi benchmark, Core) vs 200 MB – 15 GB (Rezi benchmark, React, OOMs at 1000 items) vs "over 50MB" (Better Stack). The React driver has significant memory scaling issues. The Core (imperative) driver is more stable.

4. **Ink's 30fps cap** is configurable via `maxFps` but the architectural limitation (JavaScript string diffing on the same event loop as app logic) remains. The "32 FPS" figure circulating online is a misreading of the 32ms throttle interval — the actual default is 30fps. Source: [OpenReplay](https://blog.openreplay.com/opentui-alternative-ink/).

5. **RTL support** is broken or absent in every library compared. This is an ecosystem-wide gap, not specific to any one library. The correct fix layer is the terminal emulator (VTE, Otty, xterm.js+bidiscope), not the TUI library.

6. **Accessibility** for terminal TUIs is an unsolved problem across the entire industry. No TUI library (Ink, OpenTUI, Ratatui, Blessed, Bubble Tea) currently communicates with platform accessibility APIs (AT-SPI, UIA, AccessKit). The [Ratatui discussion #2190](https://github.com/ratatui/ratatui/discussions/2190) conclusion — "I'm honestly not aware of any TUI application that communicates with accessibility APIs" — applies to all libraries in this comparison.

7. **Clack is ESM-only.** If OpenForge CLI must support CJS consumers (e.g., older Node 16 environments), Clack cannot be used. @inquirer/prompts supports both ESM and CJS.

8. **OpenTUI requires Bun 1.3+ or Node 26.4+ with `--experimental-ffi`.** This is a hard distribution constraint. Node 26 is not yet LTS. For a CLI that targets "Node 20+" (per the OpenForge spec), OpenTUI is not currently viable.

---

## 13. Action Items for OpenForge CLI

| # | Action | Priority | Effort |
|---|---|---|---|
| 1 | `npm install ink react @clack/prompts chalk cli-table3` | High | 5 min |
| 2 | Set up Ink with `maxFps: 60` + `incrementalRendering: true` | High | 30 min |
| 3 | Create table component wrapping `cli-table3` in Ink `<Box>` | High | 1 hr |
| 4 | Create progress bar component (Ink `<Box>` + state) | High | 1 hr |
| 5 | Create diff view component (chalk-colored `<Text>` lines) | Medium | 2 hr |
| 6 | Wire up Clack prompts for all interactive flows | High | 2 hr |
| 7 | Add CI detection: `if (process.env.CI) { nonInteractiveMode() }` | High | 30 min |
| 8 | Add screen reader mode: `isScreenReaderEnabled: process.env.INK_SCREEN_READER === 'true'` | Medium | 1 hr |
| 9 | Test on Windows Terminal, iTerm2, tmux, VS Code terminal | High | 2 hr |
| 10 | Benchmark cold start and memory with `process.memoryUsage()` | Medium | 1 hr |
| 11 | Add `listr2` for multi-step task pipelines (build, test, deploy) | Low | 1 hr |
| 12 | Evaluate `ora` for simple spinners outside of Clack flows | Low | 30 min |

**Total estimated setup effort: ~10 hours** for a production-ready terminal UI layer.
