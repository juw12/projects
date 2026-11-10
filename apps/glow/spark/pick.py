"""Keep-best bookkeeping for the training rounds (no torch needed).

  python pick.py plan   read round 2, choose size and batch for the long run, write final.cmd + plan.json
  python pick.py ship   keep whichever of (long run, its starting point) has the lower held-out loss,
                        write ship.cmd (export + benchmark) and ship.json (the runs behind the weights)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
LINEAGE = {"r2a": ["r1a", "r2a"], "r2b": ["r1b", "r2b"], "r2c": ["r1a", "r2c"]}
LONG_RUN_MINUTES = 30


def done(name):
    return json.loads((HERE / "runs" / name / "done.json").read_text(encoding="utf-8"))


def plan():
    loss = {name: done(name)["best_val_loss"] for name in ("r2a", "r2b", "r2c")}
    small_batch_wins = loss["r2c"] < loss["r2a"]
    wide_wins = loss["r2b"] < loss["r2a"]
    if wide_wins:
        start = "r2b"
    else:
        start = "r2c" if small_batch_wins else "r2a"
    config = done(start)["args"]
    batch = 4 if small_batch_wins else 16
    command = (
        "venv\\Scripts\\python.exe -u train.py --name r3"
        f" --dim {config['dim']} --layers {config['layers']} --minutes {LONG_RUN_MINUTES} --eval-minutes 5"
        f" --lr 1e-3 --batch {batch} --init runs\\{start}\\best.pt"
    )
    (HERE / "final.cmd").write_text("@echo off\r\n" + command + "\r\n", encoding="ascii")
    decision = {"round2_val_loss": loss, "start": start, "batch": batch, "dim": config["dim"], "command": command}
    (HERE / "plan.json").write_text(json.dumps(decision, indent=1), encoding="utf-8")
    print("PLAN", json.dumps(decision), flush=True)


def ship():
    decision = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))
    start = decision["start"]
    start_loss = done(start)["best_val_loss"]
    long_loss = done("r3")["best_val_loss"]
    if long_loss < start_loss:
        run, runs = "r3", LINEAGE[start] + ["r3"]
    else:
        run, runs = start, LINEAGE[start]
    out = "..\\repo\\apps\\glow\\web\\spark"
    lines = [
        "@echo off",
        f"venv\\Scripts\\python.exe -u export.py --run {run} --out {out}",
        f"venv\\Scripts\\python.exe -u bench.py --run {run} --baseline base --threads 4 --out {out}\\bench.json",
    ]
    (HERE / "ship.cmd").write_text("\r\n".join(lines) + "\r\n", encoding="ascii")
    chosen = {"run": run, "runs": runs, "val_loss": min(long_loss, start_loss), "start": start, "start_val_loss": start_loss, "long_val_loss": long_loss}
    (HERE / "ship.json").write_text(json.dumps(chosen, indent=1), encoding="utf-8")
    print("SHIP", json.dumps(chosen), flush=True)


if __name__ == "__main__":
    {"plan": plan, "ship": ship}[sys.argv[1]]()
