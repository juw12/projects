"""
E — E-coder CLI entrypoint (M1).

Run a read-only coding agent against a repo:

    python coder.py "<task>" [--repo PATH] [--max-steps N]
                          [--provider P] [--model M] [--verbose]

The default repo is the current directory. Provider/model fall back to the
ECODER_PROVIDER / ECODER_MODEL environment variables (see llm.py).
"""
from __future__ import annotations

import argparse

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
        description="E-coder: a stdlib-only, read-only repo coding agent (M1)."
    )
    parser.add_argument("task", help="The task to perform, in plain language.")
    parser.add_argument("--repo", default=".", help="Repo root to operate within (default: current dir).")
    parser.add_argument("--max-steps", type=int, default=12, help="Max agent steps before stopping (default 12).")
    parser.add_argument("--provider", default=None, help="Model provider: 'ollama' or 'openai' (default: env or ollama).")
    parser.add_argument("--model", default=None, help="Model name (default: env or qwen3:8b).")
    parser.add_argument("--verbose", action="store_true", help="Print each step (tool, args, result preview).")
    args = parser.parse_args()

    answer = run_agent(
        args.task,
        args.repo,
        max_steps=args.max_steps,
        provider=args.provider,
        model=args.model,
        on_step=_on_step_verbose if args.verbose else None,
    )
    print(answer)


if __name__ == "__main__":
    main()
