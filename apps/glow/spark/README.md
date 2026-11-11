# GlowSpark training code

Everything that produced the model shipped in `apps/glow/web/spark/`. Nothing here is pretrained: the
tokenizer, the transformer, the training loop and the browser engine are written from scratch, and the
weights start from random numbers. PyTorch is used only as the tensor and autograd library.

No data, checkpoints or virtual environment are stored in the repo. The steps below rebuild them.

## What is here

| File | What it does |
|---|---|
| `corpus.py` | Downloads public-domain fairy-tale and children's books from Project Gutenberg, strips the licence boilerplate, holds out every 12th book for testing, and writes the book list that ships with the app. |
| `tokenizer.py` | Trains a byte-level BPE tokenizer on the training books. |
| `model.py` | The transformer (the reference the browser engine is checked against). |
| `train.py` | The training loop. Time-boxed: you give it minutes, not steps. Can continue from a checkpoint with `--init`. |
| `fast.py` | Raises the process priority and turns off Windows power throttling, so a timed run is not starved. |
| `pick.py` | Chooses which candidate to continue (`plan`) and which checkpoint to ship (`ship`) from the logged held-out loss. |
| `export.py` | Writes the int8 weights, tokenizer and parity fixtures the browser loads. |
| `bench.py` | Measures held-out bits per byte for the model and for standard compressors, and writes `bench.json`. |
| `finish_bench.py` | Adds download size, total training minutes and the browser timings to `bench.json`. |
| `browser_check.py` | Opens the page in a real browser: parity self-test, user flows, 4 languages, 5 widths, offline, and that every figure on the page equals `bench.json`. Also takes the cold-start and speed timings. |
| `corpus2.py` | Run 2. Builds a second corpus in `data2`: the simplest public-domain children's books, ranked by the share of their words that are among the 1,500 most frequent words of the candidate pool. Books of the first corpus keep their side of the split; every 12th new book is held out. |
| `encode.py` | Run 2. Encodes a corpus with the first run's tokenizer, so a model can continue from an earlier checkpoint and both runs share one vocabulary. |
| `cross.py` | Run 2. Scores both models on both held-out sets and writes `cross.json`. |
| `sample_node.js` | Run 2. Writes tales in Node with the page's own engine, settings and write loop, so two sets of weights can be compared on the same starters and seeds. `--guard` adds the sampler guard described below. |

## Reproduce

Windows, Python 3.13, CPU only. Run from this folder.

```
python -m venv venv
venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cpu
venv\Scripts\python corpus.py
venv\Scripts\python tokenizer.py
venv\Scripts\python train.py --name base --dim 128 --layers 4 --minutes 3 --lr 2e-3 --batch 16
venv\Scripts\python train.py --name r1a --dim 128 --layers 4 --minutes 8 --lr 2e-3 --batch 16
venv\Scripts\python train.py --name r2a --dim 128 --layers 4 --minutes 12 --lr 1e-3 --batch 16 --init runs\r1a\best.pt
venv\Scripts\python train.py --name r3 --dim 128 --layers 4 --minutes 30 --eval-minutes 5 --lr 1e-3 --batch 16 --init runs\r2a\best.pt
venv\Scripts\python pick.py ship
venv\Scripts\python export.py --run <run from ship.json> --out ..\web\spark
venv\Scripts\python bench.py --run <run from ship.json> --baseline base --threads 4 --out ..\web\spark\bench.json
pip install playwright
python browser_check.py measure
python finish_bench.py --web ..\web\spark --runs r1a r2a <run from ship.json> --baseline base --browser browser.json
python browser_check.py check
```

`base` is the 3-minute baseline the shipped model has to beat. The wider and deeper candidates that were
tried and dropped (dim 192, dim 256 with 6 layers, batch 4) use the same `train.py` with other flags.

Training is time-boxed, so a faster or slower machine reaches a different loss in the same minutes. The
numbers on the page come from one laptop and are stored in `apps/glow/web/spark/bench.json` together with
the hardware they were measured on.

## Run 2: a bigger model on simpler books (measured, not shipped)

The weak point of the first run is the writing itself. Run 2 pulled two levers at once: a model about twice
the size (dim 192 instead of 128; 2,557,632 parameters instead of 1,311,872) and a second corpus of simpler
books (`corpus2.py`: 271 training books, 41,579,736 bytes, with 24 books held out). It did not earn its
place, and the page still ships the first model. This is what was measured.

| Model (int8) | Download | First held-out set (16 books, 4,399,989 bytes) | Second held-out set (24 books, 3,595,069 bytes) |
|---|---|---|---|
| r3, shipped | 1,407,480 bytes | 1.7526 bits per byte | 1.5528 bits per byte |
| r4, run 2 | 2,664,194 bytes | 1.8956 bits per byte | 1.3463 bits per byte |

- r4 is a specialist, not a better model. It is 0.2065 bits per byte better on the simple books it was
  tuned for, 0.1430 worse on the first set, and 1.9 times the download.
- Leakage check: no held-out book of either set is in the other run's training split (compared by book
  number and by normalised title). Both runs use one tokenizer, so the token files are interchangeable.
- Run 2 did not get the training time it was given. `train.py` was asked for 120 minutes. Its log shows
  4,014 steps in the first 50 minutes and only 282 more in the 77 minutes after that. The likely cause,
  not proven, is that the laptop was busy with other work and each held-out evaluation took longer than
  the 10 minutes between evaluations, so the loop did little except evaluate. This run therefore does not
  show that more training cannot help. It shows that this attempt did not get it.

Both models then wrote the same 36 tales (6 starters, 2 lengths, 3 seeds) with the page's own engine and
settings (`sample_node.js`: temperature 0.8, top-k 40).

| Variant | Repeated three-word phrases | Distinct words, share of all words | Tales with a broken character |
|---|---|---|---|
| r3 as shipped | 2.33% | 0.4636 | 0 of 36 |
| r4, same sampler | 3.77% | 0.4648 | 1 of 36 |
| r3 with the guard | 1.66% | 0.4743 | 0 of 36 |
| r4 with the guard | 1.61% | 0.4880 | 0 of 36 |

The guard (`--guard`) is one fixed setting, chosen before looking at its output. A token that is not a
whole UTF-8 character on its own is never written (128 of the 4,096 tokens). A token that would repeat a
three-token phrase from the last 64 tokens loses 1.5 from its score for each earlier occurrence. In these
samples the first rule changed nothing: all 72 guarded tales are identical with it on or off. The
repetition rule did the work, including for the one tale with broken characters.

Three AI judges (language models, not people) then scored the page with each variant's tales, in one
session and against the same rubric: shipped 6.90, shipped with the guard 6.65, r4 with the guard 6.90.
Sample quality stayed at 5.0 of 10 for all three. Side by side and blind, r4 with the guard got 1 vote
against the shipped page and 2 ties, and so did the guard alone. The rule for this project is to keep a
change only when the score rises by at least 0.3 and the blind comparison prefers it, so neither the
bigger model nor the guard shipped.

Left to try: a corpus with a far smaller vocabulary, much more real training time, and a training loop
whose evaluation cannot starve the training steps.

`tokenizer.py`, `train.py`, `export.py` and `bench.py` read the corpus folder from the `SPARK_DATA`
environment variable (default `data`), so the same scripts run on the second corpus. Run 2, as it was run
(the first two lines train on the first corpus):

```
venv\Scripts\python train.py --name r1b --dim 192 --layers 4 --minutes 8 --eval-minutes 2
venv\Scripts\python train.py --name r2b --dim 192 --layers 4 --minutes 12 --eval-minutes 3 --lr 1e-3 --init runs\r1b\best.pt
set SPARK_DATA=data2
venv\Scripts\python corpus2.py
venv\Scripts\python encode.py
venv\Scripts\python train.py --name r4 --dim 192 --layers 4 --minutes 120 --eval-minutes 10 --lr 1e-3 --batch 16 --init runs\r2b\best.pt
venv\Scripts\python export.py --run r4 --out stage_r4
venv\Scripts\python bench.py --run r4 --baseline base --threads 4 --out stage_r4\bench.json
set SPARK_DATA=
venv\Scripts\python cross.py
node sample_node.js ..\web\spark\engine.js ..\web\spark tales_r3.json
node sample_node.js ..\web\spark\engine.js stage_r4 tales_r4_guard.json --guard
```

## What the numbers mean

- Bits per byte: how many bits the model needs, on average, to predict each byte of books it never saw.
  Lower is better. The same held-out books are given to gzip, bzip2 and xz for comparison, including xz
  that is first shown the whole training corpus.
- Parity: the browser engine must pick the same tokens as `model.py` on fixed prompts, and its scores must
  agree to within 0.01. Open the page with `?selftest=1` to run this check on your own device.
