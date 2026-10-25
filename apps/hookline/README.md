# Hookline — viral sound remixer

Upload real songs, say what you want ("higher, faster, mash in some 2000s
nostalgia, 25 seconds"), and Hookline renders a loop-ready short-form sound for
TikTok, Reels and Shorts — with a heuristic **viral-potential score** that tells
you what to fix.

Everything runs in the browser: songs are decoded, analysed and rendered on your
device and are never uploaded. No dependencies, no build step.

**Live:** [App](https://juwpegatron.github.io/projects/hookline/) ·
[Web](https://juwpegatron.github.io/projects/hookline/web.html) ·
[Mobile](https://juwpegatron.github.io/projects/hookline/mobile.html)

## What it does

| Step | How |
| --- | --- |
| **Analyse** each upload | Tempo + beat grid (spectral-flux onsets, autocorrelation, comb phase search), key (chroma × Krumhansl profiles), hook/chorus finder (loudness + harmonic repetition + energy jump, half-beat resolution), loudness (BS.1770-style K-weighted LUFS approximation). |
| **Understand the request** | Plain-language parser: *high/low*, *faster/slower*, *nightcore*, *slowed + reverb*, *bass boosted*, *8D*, *lo-fi*, *nostalgic/mashup*, intensity words (*a bit*, *very*) and explicit numbers (`+3 semitones`, `1.25x`, `140 bpm`, `20 seconds`). |
| **Change tempo and pitch** | Independent mode: WSOLA time-stretch + anti-aliased Hermite resampling (faster *and* higher, each by its own amount). Classic mode: pure resample — pitch follows tempo, the true nightcore/daycore sound. |
| **Mash up** | Layers are tempo-matched to the main track (half/double time folded so nothing is stretched more than ±41 %) and key-matched to its shifted key (relative keys respected, shifts ≤ ±6 st), then arranged bar-by-bar with equal-power crossfades, filter-in intros and noise risers. Segments re-snap to the local beat phase so long songs don't drift. |
| **Master** | Low cut, bass and air shelves, lo-fi, 8D auto-pan, Freeverb-style reverb, glue compressor, loudness normalisation to ≈ −10 LUFS, look-ahead limiter at −1 dBFS. |
| **Loop** | The tail is rendered past the last bar line and folded over the faded-in start, so the platform's auto-loop is seamless. |
| **Score** | Hook in the first seconds, seamless loop, short-form length, trend tempo fit (absolute and relative), energy lift, loudness, recognition. A heuristic, not a prediction. |
| **Export** | 16-bit WAV with TPDF dither, plus a JSON recipe you can reload. *3 viral variants* renders and ranks three directions in one click. |

## The Paramore test recipe

`web/recipes.js` ships the curated test the app was built for:
**"That's What You Get" — Nostalgia Sped Up.** See
[docs/paramore-test.md](docs/paramore-test.md) for the decisions and the
verification. Upload the three songs (any order — slots are matched by file
name) and press **Apply test recipe**. Without the songs, **Try demo stand-ins**
runs the identical pipeline on synthesised tracks at the same tempos and keys.

> Use songs you have the rights to remix. Posting remixes of commercial music
> may need the platform's licensed sound library or the rights holder's
> permission. No copyrighted audio is stored in this repository.

## Files

```
web/
  index.html  web.html  mobile.html   App / Web / Mobile shells
  engine.js     DSP engine (analysis, stretch, pitch, mashup, FX, loudness, score, WAV)
  worker.js     runs the engine off the UI thread (main-thread fallback for file://)
  recipes.js    presets + the curated Paramore recipe and slot matching
  demo.js       synthesised stand-in tracks (demo + test fixtures)
  app.js  styles.css  manifest.webmanifest  sw.js  icons/
tests/
  engine.test.js    23 engine tests (node or JavaScriptCore)
  test_hookline.py  static checks + runs the engine tests (CI)
tools/
  render_standin_demo.js   renders the Paramore recipe with stand-ins to WAV (base64)
docs/
  paramore-test.md
```

## Run locally

```
cd apps/hookline/web && python3 -m http.server 8000
# open http://localhost:8000/?demo=1
```

Tests: `python3 apps/hookline/tests/test_hookline.py`

## Limits

- Tempo detection can land on half/double time (use ×2 / ÷2) and, rarely, on a
  2/3 relationship; curated recipes carry a reference BPM and fall back to it.
- Constant-tempo assumption per song; local beat re-snapping handles drift but
  not deliberate tempo changes.
- WSOLA is clean for ±25 % but adds some smearing on extreme stretches; vocals
  shifted more than ~5 semitones start to sound processed (that's the point of
  nightcore, less so for natural edits).
- The viral score encodes common short-form patterns; it has not been
  validated against real engagement data.
