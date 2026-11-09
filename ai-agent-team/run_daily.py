"""Daily orchestrator — runs both agents and persists output.

Usage:
    python run_daily.py            # full daily run (save + commit + email)
    python run_daily.py --dry-run  # generate but don't save/commit/email
    python run_daily.py --no-email # skip email notification
    python run_daily.py --no-commit # skip git commit step

Designed to run identically locally (with .env) and on GitHub Actions
(with secrets).
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import subprocess
import sys
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from agents.idea_agent import generate_idea  # noqa: E402
from agents.pm_agent import generate_spec  # noqa: E402

SPECS_DIR = PROJECT_ROOT / "specs"
LOG_DIR = PROJECT_ROOT / "logs"


def _today_slug() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _log_line(line: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / "daily.log"
    ts = datetime.now().isoformat(timespec="seconds")
    with log_file.open("a", encoding="utf-8") as f:
        f.write(f"[{ts}] {line}\n")
    print(line)


def _save_outputs(idea: dict, spec_md: str, slug: str) -> tuple[Path, Path]:
    SPECS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = SPECS_DIR / f"{slug}.json"
    md_path = SPECS_DIR / f"{slug}.md"

    payload = {"date": slug, "idea": idea, "spec_markdown": spec_md}
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    md_path.write_text(spec_md, encoding="utf-8")
    return json_path, md_path


def _send_email(subject: str, body: str) -> None:
    """Best-effort email via SMTP. Silently skips if not configured."""
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_APP_PASSWORD")
    to_addr = os.environ.get("NOTIFY_EMAIL")
    if not (user and password and to_addr):
        _log_line("Email skipped (SMTP_USER / SMTP_APP_PASSWORD / NOTIFY_EMAIL not set).")
        return

    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context()) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
        _log_line(f"Email sent to {to_addr}.")
    except Exception as exc:  # noqa: BLE001
        _log_line(f"Email FAILED: {exc}")


def _git_commit(slug: str) -> None:
    """Best-effort git commit so the workflow can push the spec."""
    try:
        subprocess.run(["git", "config", "user.email", "agent@local"], check=False)
        subprocess.run(["git", "config", "user.name", "AI Agent Team"], check=False)
        subprocess.run(["git", "add", "specs/", "logs/"], check=False)
        result = subprocess.run(
            ["git", "commit", "-m", f"daily: {slug}"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            _log_line("Git commit created.")
        else:
            _log_line("Git commit skipped (nothing to commit or not a git repo).")
    except Exception as exc:  # noqa: BLE001
        _log_line(f"Git step skipped: {exc}")


def run(send_email_flag: bool = True, commit_flag: bool = True) -> int:
    slug = _today_slug()
    _log_line(f"=== Daily run starting for {slug} ===")

    try:
        idea = generate_idea()
        _log_line(f"Idea generated: {idea.get('title', '?')}")
    except Exception as exc:
        _log_line(f"FATAL: idea agent failed: {exc}")
        return 1

    try:
        spec_md = generate_spec(idea)
        _log_line(f"Spec generated ({len(spec_md)} chars).")
    except Exception as exc:
        _log_line(f"FATAL: pm agent failed: {exc}")
        return 1

    json_path, md_path = _save_outputs(idea, spec_md, slug)
    _log_line(f"Saved {json_path.name} and {md_path.name}.")

    if send_email_flag:
        body = (
            f"Today's AI-built product idea: {idea.get('title', '?')}\n\n"
            f"{idea.get('one_liner', '')}\n\n"
            f"Full spec is in your GitHub repo at specs/{slug}.md\n"
            "To build it: copy the 'Vibe-coding prompt' section and paste "
            "it into Lovable, Bolt.new, or v0.dev.\n"
        )
        _send_email(
            subject=f"[AI Agent Team] {slug} — {idea.get('title', 'New idea')}",
            body=body,
        )

    if commit_flag:
        _git_commit(slug)

    _log_line("=== Done ===")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the daily AI agent team.")
    parser.add_argument("--no-email", action="store_true", help="Skip email step.")
    parser.add_argument("--no-commit", action="store_true", help="Skip git commit step.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the idea agent only and print JSON. Do not save/commit/email.",
    )
    args = parser.parse_args()

    if args.dry_run:
        idea = generate_idea()
        print(json.dumps(idea, indent=2))
        return 0

    return run(send_email_flag=not args.no_email, commit_flag=not args.no_commit)


if __name__ == "__main__":
    sys.exit(main())
