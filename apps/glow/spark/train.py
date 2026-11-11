"""Time-budgeted training loop for GlowSpark (CPU). The schedule follows wall-clock progress so runs with
the same --minutes are comparable whatever the model size."""
import fast  # noqa: F401  (full-speed process settings; must come before torch)

import argparse
import json
import os
import math
import time
from pathlib import Path

import numpy as np
import torch

from model import Spark

HERE = Path(__file__).parent
DATA = HERE / os.environ.get("SPARK_DATA", "data")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--dim", type=int, default=192)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--heads", type=int, default=4)
    parser.add_argument("--context", type=int, default=256)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--minutes", type=float, default=5)
    parser.add_argument("--eval-minutes", type=float, default=2)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--vocab", type=int, default=4096)
    parser.add_argument("--init", default="")
    args = parser.parse_args()

    torch.set_num_threads(args.threads)
    torch.manual_seed(1234)
    rng = np.random.default_rng(1234)
    train = np.memmap(DATA / "train.bin", dtype=np.uint16, mode="r")
    val = np.fromfile(DATA / "val.bin", dtype=np.uint16)
    val_rows = (len(val) - 1) // args.context
    val_pick = np.linspace(0, val_rows - 1, min(val_rows, 256)).astype(int)
    val_x = torch.from_numpy(
        np.stack([val[row * args.context: row * args.context + args.context] for row in val_pick]).astype(np.int64)
    )
    val_y = torch.from_numpy(
        np.stack([val[row * args.context + 1: row * args.context + args.context + 1] for row in val_pick]).astype(np.int64)
    )

    model = Spark(args.vocab, args.dim, args.layers, args.heads, args.context)
    if args.init:
        model.load_state_dict(torch.load(args.init)["state"])
    decay = [parameter for parameter in model.parameters() if parameter.dim() == 2]
    plain = [parameter for parameter in model.parameters() if parameter.dim() < 2]
    optimizer = torch.optim.AdamW(
        [{"params": decay, "weight_decay": 0.1}, {"params": plain, "weight_decay": 0.0}],
        lr=args.lr,
        betas=(0.9, 0.95),
    )
    out = HERE / "runs" / args.name
    out.mkdir(parents=True, exist_ok=True)
    log = open(out / "log.jsonl", "a", encoding="utf-8")
    print("params", model.parameter_count(), flush=True)

    def evaluate():
        model.eval()
        losses = []
        with torch.no_grad():
            for start in range(0, len(val_x), 64):
                losses.append(model(val_x[start:start + 64], val_y[start:start + 64]).item())
        model.train()
        return float(np.mean(losses))

    budget = args.minutes * 60
    started = time.time()
    next_eval = args.eval_minutes * 60
    step, tokens_seen, best = 0, 0, float("inf")
    smooth = None
    while True:
        elapsed = time.time() - started
        progress = min(1.0, elapsed / budget)
        if progress < 0.03:
            rate = args.lr * progress / 0.03
        else:
            rate = args.lr * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * (progress - 0.03) / 0.97)))
        for group in optimizer.param_groups:
            group["lr"] = max(rate, 1e-6)
        offsets = rng.integers(0, len(train) - args.context - 1, size=args.batch)
        batch = np.stack([train[offset: offset + args.context + 1] for offset in offsets]).astype(np.int64)
        batch = torch.from_numpy(batch)
        loss = model(batch[:, :-1], batch[:, 1:])
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        step += 1
        tokens_seen += args.batch * args.context
        smooth = loss.item() if smooth is None else 0.98 * smooth + 0.02 * loss.item()
        done = elapsed >= budget
        if elapsed >= next_eval or done:
            next_eval += args.eval_minutes * 60
            val_loss = evaluate()
            record = {
                "step": step,
                "minutes": round(elapsed / 60, 2),
                "tokens_seen": tokens_seen,
                "tokens_per_second": round(tokens_seen / elapsed),
                "train_loss": round(smooth, 4),
                "val_loss": round(val_loss, 4),
                "lr": rate,
            }
            log.write(json.dumps(record) + "\n")
            log.flush()
            print(record, flush=True)
            if val_loss < best:
                best = val_loss
                torch.save({"state": model.state_dict(), "config": model.config, "val_loss": val_loss}, out / "best.pt")
        if done:
            break
    (out / "done.json").write_text(json.dumps({"best_val_loss": best, "args": vars(args), "params": model.parameter_count()}))


if __name__ == "__main__":
    main()
