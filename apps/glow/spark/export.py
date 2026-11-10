"""Export a trained GlowSpark checkpoint for the browser engine.

Writes into --out:
  spark.bin    int8 weights, one float32 scale per matrix row (norm gains stay float32)
  spark.json   config, tensor table, tokenizer merges, checksum
  parity.json  reference logits and greedy continuations from PyTorch on the *shipped* (dequantised) weights
  books.json   the public-domain books the model was trained and tested on
Also saves runs/<name>/shipped.pt: the dequantised weights, for bench.py.
"""
import fast  # noqa: F401  (first import: process priority, before torch starts its threads)

import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from model import Spark
from tokenizer import Tokenizer

HERE = Path(__file__).parent
DATA = HERE / "data"
PARITY_PROMPTS = [
    "Once upon a time there was a little fox",
    "The old king had three daughters, and",
    "\"Where are you going?\" asked the rabbit.",
    "In the middle of the dark forest stood",
    "The moon rose over the sea, and the fisherman",
]
GREEDY_TOKENS = 24


def tensor_name(key):
    """model.py parameter name -> browser tensor name."""
    return key.replace(".weight", "")


def quantise_rows(matrix):
    peak = np.abs(matrix).max(axis=1)
    scale = np.where(peak > 0, peak / 127.0, 1.0).astype(np.float32)
    values = np.clip(np.rint(matrix / scale[:, None]), -127, 127).astype(np.int8)
    return scale, values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    run = HERE / "runs" / args.run
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    checkpoint = torch.load(run / "best.pt")
    config = checkpoint["config"]
    state = checkpoint["state"]
    blob = bytearray()
    tensors = []
    shipped_state = {}
    for key, value in state.items():
        array = value.numpy().astype(np.float32)
        while len(blob) % 4:
            blob.append(0)
        if array.ndim == 2:
            scale, values = quantise_rows(array)
            tensors.append({"name": tensor_name(key), "rows": array.shape[0], "cols": array.shape[1], "offset": len(blob)})
            blob += scale.tobytes()
            blob += values.tobytes()
            shipped_state[key] = torch.from_numpy(values.astype(np.float32) * scale[:, None])
        else:
            tensors.append({"name": tensor_name(key), "rows": array.shape[0], "cols": 0, "offset": len(blob)})
            blob += array.tobytes()
            shipped_state[key] = torch.from_numpy(array.copy())
    (out / "spark.bin").write_bytes(bytes(blob))

    tokenizer = Tokenizer.load()
    flat_merges = [value for pair in tokenizer.merges for value in pair]
    parameters = int(sum(value.numel() for value in state.values()))
    meta = {
        "format": 1,
        "name": "GlowSpark",
        "config": config,
        "parameters": parameters,
        "weights": {"file": "spark.bin", "bytes": len(blob), "sha256": hashlib.sha256(bytes(blob)).hexdigest()},
        "tensors": tensors,
        "tokenizer": {"vocab_size": tokenizer.vocab_size, "merges": flat_merges},
    }
    (out / "spark.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8", newline="\n")

    model = Spark(**config)
    model.load_state_dict(shipped_state)
    model.eval()
    torch.save({"state": shipped_state, "config": config}, run / "shipped.pt")

    cases = []
    with torch.no_grad():
        for prompt in PARITY_PROMPTS:
            tokens = tokenizer.encode("\n" + prompt)
            logits = model(torch.tensor([tokens]))[0, -1].numpy().astype("<f4")
            history = list(tokens)
            greedy = []
            for _ in range(GREEDY_TOKENS):
                following = int(model(torch.tensor([history]))[0, -1].argmax())
                greedy.append(following)
                history.append(following)
            cases.append({
                "prompt": prompt,
                "tokens": tokens,
                "logits_f32_base64": base64.b64encode(logits.tobytes()).decode("ascii"),
                "greedy": greedy,
                "greedy_text": tokenizer.decode(greedy),
            })
    parity = {"tolerance": 0.01, "weights_sha256": meta["weights"]["sha256"], "cases": cases}
    (out / "parity.json").write_text(json.dumps(parity, separators=(",", ":")), encoding="utf-8", newline="\n")

    books = json.loads((DATA / "books.json").read_text(encoding="utf-8"))
    listing = [
        {"id": book["id"], "title": book["title"], "authors": book["authors"], "split": book["split"]}
        for book in books
    ]
    (out / "books.json").write_text(json.dumps(listing, separators=(",", ":"), ensure_ascii=False), encoding="utf-8", newline="\n")
    print("DONE", {"parameters": parameters, "weights_bytes": len(blob), "books": len(listing)}, flush=True)
    for case in cases:
        print(repr(case["prompt"]), "->", repr(case["greedy_text"]), flush=True)


if __name__ == "__main__":
    main()
