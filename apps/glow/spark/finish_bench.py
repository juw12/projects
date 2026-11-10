"""Add the figures bench.py cannot know to bench.json: what the browser downloads, the total training
time behind the shipped weights, and the in-browser timings measured by browser_check.py.

Usage (system Python, from this folder):
  python finish_bench.py --web ../web/spark --runs r1a r2a r3 --baseline base --browser browser.json

Every value is read from a file written by another script in this folder; nothing is typed in by hand.
"""
import argparse
import datetime
import json
from pathlib import Path

HERE = Path(__file__).parent
DOWNLOAD_FILES = ["engine.js", "worker.js", "spark.json", "spark.bin"]
TEXT_FILES = {"engine.js", "worker.js", "spark.json"}


def served_bytes(path):
    """Size as GitHub Pages serves it: text files are committed with LF line endings."""
    data = path.read_bytes()
    if path.name in TEXT_FILES:
        data = data.replace(b"\r\n", b"\n")
    return len(data)


def run_minutes(name):
    done = json.loads((HERE / "runs" / name / "done.json").read_text(encoding="utf-8"))
    return float(done["args"]["minutes"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", required=True, help="folder holding bench.json and the shipped files")
    parser.add_argument("--runs", nargs="+", required=True, help="every training run that fed the shipped weights, in order")
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--browser", default="", help="JSON written by browser_check.py")
    args = parser.parse_args()
    web = Path(args.web)
    bench_path = web / "bench.json"
    bench = json.loads(bench_path.read_text(encoding="utf-8"))

    files = {name: served_bytes(web / name) for name in DOWNLOAD_FILES}
    bench["download"] = {"files": files, "total_bytes": sum(files.values())}

    stages = [{"run": name, "minutes": run_minutes(name)} for name in args.runs]
    last = json.loads((HERE / "runs" / args.runs[-1] / "done.json").read_text(encoding="utf-8"))
    bench["training"] = {
        "minutes": sum(stage["minutes"] for stage in stages),
        "stages": stages,
        "best_val_loss_nats_per_token": last["best_val_loss"],
        "threads": last["args"]["threads"],
        "batch": last["args"]["batch"],
        "context": last["args"]["context"],
    }
    bench["baseline_training_minutes"] = run_minutes(args.baseline)

    if args.browser:
        measured = json.loads(Path(args.browser).read_text(encoding="utf-8"))
        bench["browser"] = {
            "hardware": measured["hardware"],
            "cold_start_ms": measured["cold_start_ms"],
            "tokens_per_second": measured["tokens_per_second"],
            "words_per_second": measured["words_per_second"],
            "note": measured.get("note", ""),
        }
    bench["built"] = datetime.date.today().isoformat()
    bench_path.write_text(json.dumps(bench, indent=1), encoding="utf-8", newline="\n")
    print("DONE", json.dumps({key: bench[key] for key in ("download", "training", "baseline_training_minutes", "built")}))
    if "browser" in bench:
        print("browser", json.dumps(bench["browser"]))


if __name__ == "__main__":
    main()
