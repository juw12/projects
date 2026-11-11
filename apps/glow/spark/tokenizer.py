"""Byte-level BPE tokenizer written from scratch (no tokenizer library).

Text is split into chunks by PATTERN, each chunk starts as raw UTF-8 bytes, and merges are learned on
chunk types weighted by frequency. The JavaScript engine implements the same pattern and merge loop.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

PATTERN_SOURCE = r" ?[A-Za-z']+| ?[0-9]+|[ \t\n\r]+| ?[^ \t\n\rA-Za-z0-9']+"
PATTERN = re.compile(PATTERN_SOURCE)
EOT_TEXT = "<|endoftext|>"
DATA = Path(__file__).parent / os.environ.get("SPARK_DATA", "data")


def train_bpe(chunk_counts, vocab_size):
    words = [list(chunk.encode("utf-8")) for chunk in chunk_counts]
    freqs = list(chunk_counts.values())
    pair_counts = defaultdict(int)
    pair_words = defaultdict(set)
    for index, word in enumerate(words):
        for pair in zip(word, word[1:]):
            pair_counts[pair] += freqs[index]
            pair_words[pair].add(index)
    merges = []
    for new_id in range(256, vocab_size - 1):
        if not pair_counts:
            break
        best = max(pair_counts, key=lambda pair: (pair_counts[pair], pair))
        merges.append(best)
        for index in list(pair_words.pop(best, ())):
            word = words[index]
            freq = freqs[index]
            merged = []
            position = 0
            while position < len(word):
                if position + 1 < len(word) and (word[position], word[position + 1]) == best:
                    merged.append(new_id)
                    position += 2
                else:
                    merged.append(word[position])
                    position += 1
            if len(merged) == len(word):
                continue
            for pair in zip(word, word[1:]):
                pair_counts[pair] -= freq
                if pair_counts[pair] <= 0:
                    del pair_counts[pair]
            for pair in zip(merged, merged[1:]):
                pair_counts[pair] += freq
                pair_words[pair].add(index)
            words[index] = merged
        pair_counts.pop(best, None)
        if new_id % 500 == 0:
            print("merge", new_id, flush=True)
    return merges


class Tokenizer:
    def __init__(self, merges, vocab_size):
        self.merges = [tuple(pair) for pair in merges]
        self.rank = {pair: index for index, pair in enumerate(self.merges)}
        self.vocab_size = vocab_size
        self.eot = vocab_size - 1
        self.token_bytes = [bytes([value]) for value in range(256)]
        for left, right in self.merges:
            self.token_bytes.append(self.token_bytes[left] + self.token_bytes[right])
        self.cache = {}

    def encode_chunk(self, chunk):
        cached = self.cache.get(chunk)
        if cached is not None:
            return cached
        symbols = list(chunk.encode("utf-8"))
        while len(symbols) > 1:
            best_rank, best_pair = None, None
            for pair in zip(symbols, symbols[1:]):
                rank = self.rank.get(pair)
                if rank is not None and (best_rank is None or rank < best_rank):
                    best_rank, best_pair = rank, pair
            if best_pair is None:
                break
            new_id = 256 + best_rank
            merged = []
            position = 0
            while position < len(symbols):
                if position + 1 < len(symbols) and (symbols[position], symbols[position + 1]) == best_pair:
                    merged.append(new_id)
                    position += 2
                else:
                    merged.append(symbols[position])
                    position += 1
            symbols = merged
        self.cache[chunk] = symbols
        return symbols

    def encode(self, text):
        ids = []
        for part_index, part in enumerate(text.split(EOT_TEXT)):
            if part_index:
                ids.append(self.eot)
            for match in PATTERN.finditer(part):
                ids.extend(self.encode_chunk(match.group()))
        return ids

    def decode(self, ids):
        data = b"".join(self.token_bytes[token] for token in ids if token != self.eot)
        return data.decode("utf-8", errors="replace")

    @classmethod
    def load(cls, path=DATA / "tokenizer.json"):
        spec = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(spec["merges"], spec["vocab_size"])


def main(vocab_size):
    train_text = (DATA / "train.txt").read_text(encoding="utf-8")
    chunk_counts = Counter()
    for part in train_text.split(EOT_TEXT):
        chunk_counts.update(match.group() for match in PATTERN.finditer(part))
    print("chunk types", len(chunk_counts), flush=True)
    merges = train_bpe(chunk_counts, vocab_size)
    spec = {"vocab_size": vocab_size, "pattern": PATTERN_SOURCE, "merges": merges}
    (DATA / "tokenizer.json").write_text(json.dumps(spec), encoding="utf-8")
    tokenizer = Tokenizer(merges, vocab_size)
    stats = {}
    for split in ("train", "val"):
        text = train_text if split == "train" else (DATA / "val.txt").read_text(encoding="utf-8")
        ids = np.array(tokenizer.encode(text), dtype=np.uint16)
        ids.tofile(DATA / f"{split}.bin")
        stats[split] = {"tokens": int(len(ids)), "bytes": len(text.replace(EOT_TEXT, "").encode("utf-8"))}
        assert tokenizer.decode(ids[:5000].tolist()) == tokenizer.decode(tokenizer.encode(text[:200000])[:5000])
    sample = "The little fox said, \"Don't go!\" -- and 42 birds flew away.\n caf\u00e9 \u4f60\u597d"
    assert tokenizer.decode(tokenizer.encode(sample)) == sample
    (DATA / "token_stats.json").write_text(json.dumps(stats), encoding="utf-8")
    print("DONE", stats, flush=True)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 4096)
