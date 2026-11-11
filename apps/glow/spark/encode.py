"""Encode train.txt and val.txt of the data folder with the tokenizer of the first run (no retraining),
so a model can continue from an earlier checkpoint on a new corpus."""
import json
import shutil
from pathlib import Path

import numpy as np

import tokenizer as tk

first = Path(__file__).parent / "data" / "tokenizer.json"
if not (tk.DATA / "tokenizer.json").exists():
    shutil.copyfile(first, tk.DATA / "tokenizer.json")
tokenizer = tk.Tokenizer.load(tk.DATA / "tokenizer.json")
stats = {}
for split in ("train", "val"):
    text = (tk.DATA / f"{split}.txt").read_text(encoding="utf-8")
    ids = np.array(tokenizer.encode(text), dtype=np.uint16)
    ids.tofile(tk.DATA / f"{split}.bin")
    stats[split] = {"tokens": int(len(ids)), "bytes": len(text.replace(tk.EOT_TEXT, "").encode("utf-8"))}
(tk.DATA / "token_stats.json").write_text(json.dumps(stats), encoding="utf-8")
print("DONE", stats, flush=True)
