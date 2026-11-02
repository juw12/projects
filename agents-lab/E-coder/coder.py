"""
E — E-coder CLI entrypoint (M4).

Run a coding agent against a repo:

    python coder.py "<task>" [--repo PATH] [--max-steps N]
                          [--provider P] [--model M] [--verbose]
                          [--yolo] [--no-interactive]
                          [--no-context] [--context-budget N] [--context-only]

The default repo is the current directory. Provider/model fall back to the
ECODER_PROVIDER / ECODER_MODEL environment variables (see llm.py).

By default the agent is SAFE: it will not write files or run commands unless the
user confirms. `--yolo` skips confirmation (an explicit opt-in); `--no-interactive`
turns confirmation OFF entirely, so nothing mutating is ever approved.

A compact gitignore-aware repository context is built and injected by default
(`--no-context` to disable, `--context-budget N` to cap it in chars).
`--context-only` prints that context and exits without calling the model — a
model-free way to verify the setup.
"""
from __future__ import annotations

import argparse
import sys

import llm
import repo
from loop import run_agent


def _on_step_verbose(step: dict) -> None:
    """Print a one-line summary per step (used with --verbose)."""
    if step.get("final"):
        return
    for tc in step.get("tool_calls", []):
        preview = " ".join(tc["result"].split())  # collapse newlines/whitespace
        if len(preview) > 120:
            preview = preview[:120] + "..."
        print(f"  [step {step['step']}] {tc['name']}({tc['arguments']}) -> {preview}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="E-coder: a stdlib-only coding agent with read/write/run tools + repo context (M4)."
    )
    parser.add_argument("task", help="The task to perform, in plain language.")
    parser.add_argument("--repo", default=".", help="Repo root to operate within (default: current dir).")
    parser.add_argument("--max-steps", type=int, default=12, help="Max agent steps before stopping (default 12).")
    parser.add_argument("--provider", default=None, help="Model provider: 'ollama' or 'openai' (default: env or ollama).")
    parser.add_argument("--model", default=None, help="Model name (default: env or qwen3:8b).")
    parser.add_argument("--verbose", action="store_true", help="Print each step (tool, args, result preview).")
    parser.add_argument("--yolo", action="store_true",
                        help="Skip confirmation for writes/commands (NOT the default; use with care).")
    parser.add_argument("--no-interactive", action="store_true",
                        help="Never prompt; decline all writes/commands (safe default for scripts).")
    parser.add_argument("--no-context", action="store_true",
                        help="Disable the prebuilt repository context (default: on).")
    parser.add_argument("--context-budget", type=int, default=20000,
                        help="Max chars for the prebuilt repository context (default 20000).")
    parser.add_argument("--context-only", action="store_true",
                        help="Build and print the repository context, then exit (no model call).")
    args = parser.parse_args()

    # --context-only: show the context and stop, without touching the model.
    if args.context_only:
        print(repo.build_context(args.repo, args.task, budget_chars=args.context_budget))
        sys.exit(0)

    context = None
    if not args.no_context:
        context = repo.build_context(args.repo, args.task, budget_chars=args.context_budget)
        if args.verbose:
            print(f"  [context] {len(context)} chars")

    try:
        answer = run_agent(
            args.task,
            args.repo,
            max_steps=args.max_steps,
            provider=args.provider,
            model=args.model,
            yolo=args.yolo,
            interactive=not args.no_interactive,
            context=context,
            on_step=_on_step_verbose if args.verbose else None,
        )
    except llm.LLMError as e:
        # A model/provider failure is not a crash: report it cleanly and exit 2.
        print(f"[llm error] {e}")
        sys.exit(2)
    print(answer)


if __name__ == "__main__":
    main()
