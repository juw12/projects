#!/usr/bin/env python3
"""Run GlowLead missions on a schedule, for free, on GitHub Actions (or any PC).

It opens the real GlowLead page in a hidden Chromium browser, starts each mission with the same
planning, delegation, research and review as the app, and saves each report as Markdown.

Missions come from (first match wins):
  1. GLOW_GOAL          one goal for a manual run
  2. GLOW_MISSIONS      JSON, ideally a private GitHub secret
  3. missions.json      next to this script (public in a public repository!)

Mission format: {"missions": [{"name": "Morning fares", "goal": "...", "days": ["mon", "thu"], "enabled": true}]}
"days" is optional (UTC weekdays). Browser control (Glow Hands) and code execution are never used here:
nobody is present to approve risky actions.
"""
import argparse
import datetime as dt
import functools
import http.server
import json
import os
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MAX_MISSIONS = 10


def parse_missions(raw, today=None):
    today = today or DAYS[dt.datetime.now(dt.timezone.utc).weekday()]
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as error:
        raise SystemExit(f"Mission list is not valid JSON: {error}")
    items = data.get("missions", []) if isinstance(data, dict) else data
    missions = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("goal"), str) or not item["goal"].strip():
            continue
        if item.get("enabled", True) is False:
            continue
        days = [str(day).lower()[:3] for day in item.get("days", []) if str(day).lower()[:3] in DAYS]
        if days and today not in days:
            continue
        name = str(item.get("name") or item["goal"].splitlines()[0])[:60]
        missions.append({"name": name, "goal": item["goal"].strip()[:2000]})
    return missions[:MAX_MISSIONS]


def load_missions(env=None, file_path=None, today=None):
    env = os.environ if env is None else env
    goal = (env.get("GLOW_GOAL") or "").strip()
    if goal:
        return [{"name": goal.splitlines()[0][:60], "goal": goal[:2000]}]
    if (env.get("GLOW_MISSIONS") or "").strip():
        return parse_missions(env["GLOW_MISSIONS"], today)
    path = Path(file_path or HERE / "missions.json")
    return parse_missions(path.read_text(encoding="utf-8"), today) if path.exists() else []


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:50] or "mission"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def serve_web():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(WEB)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_missions(missions, out_dir, timeout_minutes=25, engine_stub=None):
    from playwright.sync_api import sync_playwright

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    server = serve_web()
    base = f"http://127.0.0.1:{server.server_port}"
    results = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context()
            if engine_stub:
                body = Path(engine_stub).read_text(encoding="utf-8")
                context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=body))
            page = context.new_page()
            page.on("console", lambda message: message.type == "error" and print("  [page]", message.text[:200], flush=True))
            page.goto(base + "/lead/")
            page.wait_for_function("!!window.GlowLead", timeout=30000)
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
            for index, mission in enumerate(missions, 1):
                print(f"[{index}/{len(missions)}] {mission['name']}", flush=True)
                started = time.time()
                page.evaluate("goal => { window.__run = GlowLead.start(goal, false, { allowCode: false, allowHands: false, useMemory: false }); }",
                              mission["goal"])
                try:
                    page.wait_for_function(
                        "() => window.__run && ['done', 'error', 'stopped'].includes(window.__run.lead.status)",
                        timeout=timeout_minutes * 60000, polling=2000)
                except Exception:
                    page.evaluate("() => window.__run && GlowLead.stop(window.__run.lead)")
                    page.wait_for_timeout(2000)
                lead = page.evaluate("() => window.__run.lead")
                markdown = page.evaluate("() => GlowLead.missionMarkdown(window.__run.lead)")
                minutes = (time.time() - started) / 60
                path = out_dir / f"{stamp}-{index:02d}-{slug(mission['name'])}.md"
                path.write_text(markdown, encoding="utf-8")
                verdict = ("not checked live" if lead.get("unverified") else
                           "all criteria met (AI review)" if lead.get("checked") and lead.get("met") and all(m is True for m in lead["met"]) else
                           "review incomplete")
                results.append({"name": mission["name"], "status": lead["status"], "verdict": verdict,
                                "minutes": round(minutes, 1), "file": path.name, "report": lead.get("report", "")})
                print(f"    → {lead['status']} · {verdict} · {minutes:.1f} min · {path.name}", flush=True)
                page.wait_for_timeout(1500)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    return results


def write_summary(results, summary_path):
    if not summary_path:
        return
    lines = ["# GlowLead scheduled missions", "", "| Mission | Status | Review | Minutes |", "|---|---|---|---|"]
    for item in results:
        lines.append(f"| {item['name'].replace('|', '/')} | {item['status']} | {item['verdict']} | {item['minutes']} |")
    lines += ["", "Full reports are attached to this run as the **glow-reports** artifact.",
              "AI review is a second look, not independent verification."]
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def post_issue(results, repository, token, title="GlowLead scheduled reports"):
    """Optional: comment each report on one issue (public in a public repo). Uses the workflow token."""
    api = f"https://api.github.com/repos/{repository}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "glow-runner"}

    def request(url, data=None, method=None):
        req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    issues = request(f"{api}/issues?state=open&labels=glow-reports&per_page=5")
    issue = issues[0] if issues else request(f"{api}/issues", {"title": title, "labels": ["glow-reports"],
                                                               "body": "GlowLead posts scheduled mission reports here."}, "POST")
    for item in results:
        body = f"### {item['name']}\n_{item['status']} · {item['verdict']} · {item['minutes']} min_\n\n{item['report'][:60000]}"
        request(f"{api}/issues/{issue['number']}/comments", {"body": body}, "POST")
    return issue["number"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run GlowLead missions headlessly.")
    parser.add_argument("--out", default="glow-reports")
    parser.add_argument("--missions", default=None, help="Path to a missions JSON file")
    parser.add_argument("--list", action="store_true", help="Only print how many missions are due (for workflows)")
    parser.add_argument("--timeout-minutes", type=float, default=25)
    parser.add_argument("--engine-stub", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    missions = load_missions(file_path=args.missions)
    if args.list:
        print(len(missions))
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
                handle.write(f"count={len(missions)}\n")
        return 0
    if not missions:
        print("No missions are due today. Add them to the GLOW_MISSIONS secret or missions.json.")
        return 0
    results = run_missions(missions, args.out, args.timeout_minutes, args.engine_stub)
    write_summary(results, os.environ.get("GITHUB_STEP_SUMMARY"))
    if os.environ.get("GLOW_REPORT_ISSUE", "").lower() == "true" and os.environ.get("GITHUB_TOKEN"):
        number = post_issue(results, os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
        print(f"Posted reports to issue #{number}.")
    return 0 if any(item["status"] == "done" for item in results) else 1


if __name__ == "__main__":
    sys.exit(main())
