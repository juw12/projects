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
venv\Scripts\python bench.py --run <run from ship.json> --baseline base --threads 4 --out ..\web\spark
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

## What the numbers mean

- Bits per byte: how many bits the model needs, on average, to predict each byte of books it never saw.
  Lower is better. The same held-out books are given to gzip, bzip2 and xz for comparison, including xz
  that is first shown the whole training corpus.
- Parity: the browser engine must pick the same tokens as `model.py` on fixed prompts, and its scores must
  agree to within 0.01. Open the page with `?selftest=1` to run this check on your own device.
