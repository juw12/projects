#!/usr/bin/env python3
"""Generate web/data/seed.json — the official starter catalogue — from web/js/core.js.

Runs the real JS core (node if available, otherwise macOS `osascript -l JavaScript`)
so the server seed and the browser demo are built from the same blueprints.
Usage: python apps/sheetmint/tools/build_seed.py
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
CORE = APP / "web" / "js" / "core.js"
OUT = APP / "web" / "data" / "seed.json"

# blueprint id -> (price USD, commission %, tags)
PLAN = {
    "budget": (0, 0, ["budget", "personal finance", "free"]),
    "invoice": (7, 30, ["freelance", "invoices", "cash flow"]),
    "inventory": (9, 25, ["inventory", "small business", "reorder"]),
    "project": (0, 0, ["tasks", "project management", "free"]),
    "crm": (12, 30, ["sales", "crm", "pipeline"]),
    "habit": (4, 30, ["habits", "self care", "aesthetic"]),
    "content": (6, 35, ["content creator", "social media", "calendar"]),
    "meal": (4, 25, ["meal prep", "grocery", "health"]),
    "workout": (0, 0, ["fitness", "gym", "free"]),
    "rental": (14, 25, ["airbnb", "property", "host"]),
    "pricing": (9, 30, ["etsy", "shopee", "pricing"]),
    "travel": (5, 25, ["travel", "itinerary", "budget"]),
    "study": (3, 25, ["students", "study", "grades"]),
    "event": (8, 30, ["wedding", "rsvp", "events"]),
}

SCRIPT = """
var plan = %s;
var out = SheetmintCore.BLUEPRINTS.map(function (bp, i) {
  var p = plan[bp.id] || [5, 25, []];
  var spec = SheetmintCore.specFromBlueprint(bp, {currency: "USD"});
  return {id: "seed-" + bp.id, title: bp.title, description: bp.description, category: bp.category,
          tags: p[2], price: p[0], currency: "USD", commissionPct: p[1], spec: spec};
});
OUT(JSON.stringify({version: 1, listings: out}));
"""


def run_js(source):
    if shutil.which("node"):
        cmd = ["node", "-e", source.replace("OUT(", "console.log(")]
    elif shutil.which("osascript"):
        cmd = ["osascript", "-l", "JavaScript", "-e", source.replace("OUT(", "(")]
    else:
        sys.exit("Need node or macOS osascript to run the JS core")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, check=True)
    return result.stdout.strip()


def main():
    source = CORE.read_text(encoding="utf-8") + "\n" + SCRIPT % json.dumps(PLAN)
    data = json.loads(run_js(source))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(data['listings'])} listings)")


if __name__ == "__main__":
    main()
