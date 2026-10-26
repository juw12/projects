#!/usr/bin/env python3
"""Refresh TwinAgent's bundled point-in-time fundamentals for the offline web demo.

Reads quarterly figures the companies filed with the SEC (XBRL company facts) through the
MIT-licensed trader-analyst tool, keeping each quarter's *filing date* so TwinAgent can
ignore anything filed after its analysis date. Funds/ETFs are skipped (no company facts).

    python apps/twin/scripts/twinagent_snapshot.py --user-agent "Your Name you@example.com"
    python apps/twin/scripts/twinagent_snapshot.py --check

SEC asks every client to identify itself; the User-Agent is used for requests only and is
never written into the snapshot.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
FACTS = APP / "vendor" / "day-trader-skill" / "trader-analyst" / "facts.py"
DEMO = APP / "web" / "demo"
OUT = DEMO / "fundamentals.json"
FUNDS = {"SPY", "QQQ", "VTI", "AGG", "GLD", "IWM", "DIA"}
FIELDS = ("end", "start", "fiscal", "filed", "form", "revenue_yoy", "eps_yoy", "net_income_yoy",
          "gross_margin", "operating_margin", "net_margin", "revenue", "net_income", "eps_diluted")


def fetch(ticker, user_agent):
    command = [sys.executable, str(FACTS), ticker, "--no-filings", "--json", "--quarters", "8",
               "--user-agent", user_agent]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "facts.py failed")
    entry = json.loads(result.stdout)[0]["result"]
    rows = [{key: row.get(key) for key in FIELDS} for row in entry.get("rows", []) if row.get("filed")]
    if not rows:
        raise RuntimeError("no filed quarterly rows")
    return {"entity": entry.get("entity"), "cik": entry.get("cik"), "rows": rows}


def check(document):
    problems = []
    for ticker, company in document.get("companies", {}).items():
        rows = company.get("rows") or []
        if not rows:
            problems.append(f"{ticker}: no rows")
        for row in rows:
            if not row.get("filed") or not row.get("end"):
                problems.append(f"{ticker}: row without filed/end date")
            elif row["filed"] < row["end"]:
                problems.append(f"{ticker}: filed {row['filed']} before period end {row['end']}")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--user-agent", help='SEC contact, e.g. "Your Name you@example.com"')
    parser.add_argument("--check", action="store_true", help="validate the existing snapshot only")
    args = parser.parse_args()
    if args.check:
        problems = check(json.loads(OUT.read_text(encoding="utf-8")))
        print("\n".join(problems) if problems else f"OK: {OUT.relative_to(APP)}")
        return 1 if problems else 0
    if not args.user_agent or "@" not in args.user_agent:
        parser.error("--user-agent with a real name and email is required by SEC")
    market = json.loads((DEMO / "market.json").read_text(encoding="utf-8"))
    companies, skipped = {}, {}
    for ticker in sorted(market["charts"]):
        if ticker in FUNDS:
            skipped[ticker] = "fund/ETF: no company facts"
            continue
        try:
            companies[ticker] = fetch(ticker, args.user_agent)
            print(f"{ticker}: {len(companies[ticker]['rows'])} quarters, latest filed {companies[ticker]['rows'][0]['filed']}")
        except Exception as error:  # keep going; record why a ticker is missing
            skipped[ticker] = str(error)[:200]
            print(f"{ticker}: skipped ({skipped[ticker]})")
    document = {
        "taken": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "SEC XBRL company facts via trader-analyst (filed figures, quarterly)",
        "availability": "each quarter is usable from its SEC filing date",
        "companies": companies, "skipped": skipped,
    }
    problems = check(document)
    if problems:
        print("\n".join(problems))
        return 1
    OUT.write_text(json.dumps(document, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(APP)} ({len(companies)} companies)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
