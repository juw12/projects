"""Measure GlowSpark on books it never saw, against general-purpose compressors.

A language model is a compressor: its cross-entropy on held-out text is the size an arithmetic coder driven
by it would produce. So bits per byte on the held-out books is compared with gzip, bzip2 and xz on the same
bytes. "xz primed" also hands xz the whole training corpus as a dictionary: compress(train + val) minus
compress(train). Nothing here is estimated; every figure is computed and written to bench.json.
"""
import fast  # noqa: F401  (first import: process priority, before torch starts its threads)

import argparse
import bz2
import gzip
import json
import os
import lzma
import math
import time
from pathlib import Path

import numpy as np
import torch

from model import Spark

HERE = Path(__file__).parent
DATA = HERE / os.environ.get("SPARK_DATA", "data")


def held_out_bits(model, tokens, context):
    """Total bits to encode `tokens`: sliding window, each token scored once with up to `context` of history."""
    stride = context // 2
    total_nats = math.log(model.config["vocab"])  # the very first token has no history: uniform cost
    scored = 1
    windows = []
    start = 0
    while start + 1 < len(tokens):
        end = min(start + context, len(tokens) - 1)
        first_new = 0 if start == 0 else context - stride
        windows.append((start, end, first_new))
        if end == len(tokens) - 1:
            break
        start += stride
    with torch.no_grad():
        for batch_start in range(0, len(windows), 64):
            batch = windows[batch_start: batch_start + 64]
            full = [window for window in batch if window[1] - window[0] == context]
            partial = [window for window in batch if window[1] - window[0] != context]
            groups = [full] if full else []
            groups += [[window] for window in partial]
            for group in groups:
                inputs = torch.from_numpy(np.stack([tokens[a:b] for a, b, _ in group]).astype(np.int64))
                targets = torch.from_numpy(np.stack([tokens[a + 1:b + 1] for a, b, _ in group]).astype(np.int64))
                log_probs = torch.log_softmax(model(inputs), dim=-1)
                picked = -log_probs.gather(-1, targets.unsqueeze(-1)).squeeze(-1)
                for row, (_, _, first_new) in enumerate(group):
                    total_nats += float(picked[row, first_new:].sum())
                    scored += picked.shape[1] - first_new
    assert scored == len(tokens), (scored, len(tokens))
    return total_nats / math.log(2)


def load(path):
    checkpoint = torch.load(path)
    model = Spark(**checkpoint["config"])
    model.load_state_dict(checkpoint["state"])
    model.eval()
    return model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--baseline", default="")
    parser.add_argument("--out", required=True)
    parser.add_argument("--threads", type=int, default=6)
    parser.add_argument("--skip-compressors", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(args.threads)
    run = HERE / "runs" / args.run

    val_text = (DATA / "val.txt").read_bytes()
    train_text = (DATA / "train.txt").read_bytes()
    val_tokens = np.fromfile(DATA / "val.bin", dtype=np.uint16)
    val_bytes = len(val_text)
    result = {
        "held_out": {
            "bytes": val_bytes,
            "tokens": int(len(val_tokens)),
            "books": sum(1 for book in json.loads((DATA / "books.json").read_text(encoding="utf-8")) if book["split"] == "val"),
        },
        "train": {
            "bytes": len(train_text),
            "books": sum(1 for book in json.loads((DATA / "books.json").read_text(encoding="utf-8")) if book["split"] == "train"),
        },
        "bits_per_byte": {},
    }

    started = time.time()
    trained = load(run / "best.pt")
    context = trained.config["context"]
    result["bits_per_byte"]["spark_float32"] = round(held_out_bits(trained, val_tokens, context) / val_bytes, 4)
    print("float32", result["bits_per_byte"]["spark_float32"], round(time.time() - started), "s", flush=True)
    shipped = load(run / "shipped.pt")
    shipped_bits = held_out_bits(shipped, val_tokens, context)
    result["bits_per_byte"]["spark_shipped_int8"] = round(shipped_bits / val_bytes, 4)
    result["held_out"]["perplexity_per_token"] = round(2 ** (shipped_bits / len(val_tokens)), 2)
    print("int8", result["bits_per_byte"]["spark_shipped_int8"], flush=True)
    if args.baseline:
        baseline = load(HERE / "runs" / args.baseline / "best.pt")
        result["bits_per_byte"]["spark_v0_baseline"] = round(
            held_out_bits(baseline, val_tokens, baseline.config["context"]) / val_bytes, 4
        )
        print("baseline", result["bits_per_byte"]["spark_v0_baseline"], flush=True)

    if not args.skip_compressors:
        result["bits_per_byte"]["gzip_9"] = round(8 * len(gzip.compress(val_text, 9)) / val_bytes, 4)
        result["bits_per_byte"]["bzip2_9"] = round(8 * len(bz2.compress(val_text, 9)) / val_bytes, 4)
        preset = 9 | lzma.PRESET_EXTREME
        result["bits_per_byte"]["xz_9e"] = round(8 * len(lzma.compress(val_text, preset=preset)) / val_bytes, 4)
        print("plain compressors done", flush=True)
        # A dictionary big enough to hold the whole training corpus, so xz can copy from any of it.
        filters = [{"id": lzma.FILTER_LZMA2, "preset": preset, "dict_size": 1 << 27}]
        train_only = len(lzma.compress(train_text, format=lzma.FORMAT_XZ, filters=filters))
        together = len(lzma.compress(train_text + val_text, format=lzma.FORMAT_XZ, filters=filters))
        result["bits_per_byte"]["xz_9e_primed_with_training_corpus"] = round(8 * (together - train_only) / val_bytes, 4)
        print("primed xz done", flush=True)

    result["config"] = trained.config
    result["parameters"] = trained.parameter_count()
    result["training"] = json.loads((run / "done.json").read_text(encoding="utf-8"))
    Path(args.out).write_text(json.dumps(result, indent=1), encoding="utf-8", newline="\n")
    print("DONE", json.dumps(result["bits_per_byte"]), flush=True)


if __name__ == "__main__":
    main()
