"""Cross-evaluate the shipped model (r3) and the candidate (r4) on both held-out sets.

Both runs share one tokenizer, so each held-out token file is valid for both models. No book of either
held-out set is in the other run's training split (checked from the two books.json files before this ran).
Every figure is measured here and written to cross.json.
"""
import fast  # noqa: F401  (process priority before torch starts its threads)

import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

from bench import held_out_bits, load

HERE = Path(__file__).parent
SETS = {"old": HERE / "data", "new": HERE / "data2"}
RUNS = {"r3": "shipped", "r4": "candidate"}


def main():
    torch.set_num_threads(4)
    tokenizer_hashes = {
        name: hashlib.sha256((folder / "tokenizer.json").read_bytes()).hexdigest()[:16]
        for name, folder in SETS.items()
    }
    print("tokenizer sha256:", tokenizer_hashes, flush=True)
    assert tokenizer_hashes["old"] == tokenizer_hashes["new"], "tokenizers differ: token files are not interchangeable"

    result = {"tokenizer_sha256_16": tokenizer_hashes["old"], "sets": {}, "bits_per_byte": {}, "perplexity_per_token": {}}
    data = {}
    for name, folder in SETS.items():
        tokens = np.fromfile(folder / "val.bin", dtype=np.uint16)
        byte_count = len((folder / "val.txt").read_bytes())
        data[name] = (tokens, byte_count)
        result["sets"][name] = {"tokens": int(len(tokens)), "bytes": byte_count}
        print("set", name, result["sets"][name], flush=True)

    for run in RUNS:
        model = load(HERE / "runs" / run / "shipped.pt")
        context = model.config["context"]
        for name, (tokens, byte_count) in data.items():
            started = time.time()
            bits = held_out_bits(model, tokens, context)
            key = f"{run}_on_{name}"
            result["bits_per_byte"][key] = round(bits / byte_count, 4)
            result["perplexity_per_token"][key] = round(2 ** (bits / len(tokens)), 2)
            print(key, result["bits_per_byte"][key], "ppl", result["perplexity_per_token"][key],
                  round(time.time() - started), "s", flush=True)
            (HERE / "cross.json").write_text(json.dumps(result, indent=1), encoding="utf-8", newline="\n")
    print("CROSS DONE", json.dumps(result["bits_per_byte"]), flush=True)


if __name__ == "__main__":
    main()
