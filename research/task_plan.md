# Task: Primary-source documentation for 9 auto-update ecosystems

## Context
Owner of AIRIZ Motor Console is selecting a unified release architecture.
Need protocol-level detail for each ecosystem so we can map compatibility,
pick a stack, and reimplement the minimum viable subset if needed.

## Ecosystems (all 9, no skipping)
1. Squirrel.Windows — C# nuspec, RELEASES file, full vs delta packages
2. Sparkle — macOS appcast XML, DSA/EdDSA signatures, delta updates
3. electron-updater — provider abstraction (generic, github, s3, bintray)
4. @tauri-apps/updater — Tauri 2.x protocol, ed25519 signatures, signed JSON
5. Capacitor Live Update — @capawesome/capacitor-live-update + deprecated @capacitor/live-update
6. Expo Updates — manifest + rollouts + EAS Update
7. CodePush / App Center — deprecated 2025, migration to Expo
8. PWA service worker — Workbox vs native, update lifecycle, skipWaiting, clients.claim
9. Microsoft.AutoUpdater — MSIX, AppInstaller schema

## Required output structure (per ecosystem)
- Spec version + repo URL
- Manifest schema (quoted, not paraphrased)
- Signature algorithm + key format
- Provider/endpoint configuration
- Configuration surface (constructor args, CLI flags, env vars)
- Minimum viable subset to reimplement
- Version comparison rules (semver, monotonic, etc.)
- Cross-references to other ecosystems

## Required tools
- webfetch (primary)
- GitHub CLI / REST API
- websearch (fallback)
- Context7 (bonus, resolve-library-id → query-docs)

## Rules
- Cite exact spec version/tag/commit
- Quote actual schema fragments in fenced code blocks
- Distinguish Tauri 2.x from 1.x (different updater crate paths)
- Cover deprecated ecosystems with full migration path
- Identify shared lineage (electron-updater + Tauri both derive from Squirrel.Windows)

## Output deliverable
Single file: `research/auto-update-ecosystems.md`
Target: ≥500 lines, 9 sections, no preamble.

## Phases
- [x] Phase 1: Set up plan
- [x] Phase 2: Parallel research (9 librarian subagents + direct webfetch)
- [x] Phase 3: Aggregate + write final markdown (`research/auto-update-ecosystems.md`, 2,682 lines)
- [x] Phase 4: Verify ≥500 lines ✓, schemas quoted verbatim ✓, all 9 present ✓, 102 unique URLs cited

## Errors log
- Background agent spawn failed for 3/9 first batch (electron-updater, CodePush, MSIX) — `Failed to launch background agent task: Subagent spawn blocked: failed to resolve session lineage for ses_e591f6f37ffeKvRZz80G4NgAYS, so background_task.maxDepth cannot be enforced safely. fetch failed`. Workaround: re-dispatched successfully after the initial burst. No impact on final deliverable.
- Two background tasks (`bg_bd115566` Capacitor and `bg_0a4ea400` PWA) returned `No text output` on first read. Recovered by re-dispatching in second round.
- Task agents had limited webfetch capability; primary research was completed via direct `webfetch`/`gh api` from the main agent in parallel batches.
