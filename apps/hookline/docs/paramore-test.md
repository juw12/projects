# Test: Paramore — "That's What You Get", high + faster + nostalgic mashup

**Request (verbatim intent):** remix Paramore *That's What You Get* — high,
faster tempo, pitch up, with other nostalgic related songs remixed into it.

## Remix decisions

| Choice | Value | Why |
| --- | --- | --- |
| Main | Paramore — That's What You Get (Riot!, 2007) | Reference 131 BPM, Ab major (Tunebat/Songdata; Mixgraph lists 87 BPM / Eb, a 2/3 reading — the recipe falls back to 131 if detection disagrees). |
| Nostalgia layer 1 | Paramore — Misery Business (same album) | 173 BPM, Db major. Instantly recognisable riff → the intro. |
| Nostalgia layer 2 | Fall Out Boy — Sugar, We're Goin Down (2005) | 162 BPM, D major. Same pop-punk era, same crowd. |
| Tempo | 131 → **164 BPM** (×1.25) | Sped-up sweet spot; Misery Business (×0.95) and Sugar (×1.01) barely stretch, so they stay clean. |
| Pitch | **+4 st**, independent of tempo | Ab major → C major exactly. A raw ×1.25 speed-up would be +3.86 st — "high", but 14 cents off any key, which clashes with the layers. |
| Layer keys | Misery −1 st, Sugar −2 st | Key-matched to C; small shifts keep vocals natural. |
| Arrangement | 2 bars Misery Business riff (filter-in) → 8 bars TWYG chorus → riser → 4 bars Sugar chorus → 4 bars TWYG (2nd half of hook) | Recognition in second 1, the main hook by ~3 s, a payoff switch, then back to the main hook for the loop. |
| Length | 18 bars = 26.3 s | Inside the 12–35 s short-form window, ends on a bar line, tail folded into the start (seamless loop). |
| FX | reverb 12 %, bass +3 dB, air +2 dB, ≈ −10 LUFS, −1 dBFS ceiling | Bright and punchy like sped-up edits; not washed out. |

The tempo maths:
\[ \frac{164}{131} = 1.252,\qquad \frac{164}{173} = 0.948,\qquad \frac{164}{162} = 1.012 \]
\[ 12\log_2(1.252) = 3.89\ \text{st (raw speed-up)} \;\Rightarrow\; \text{use } +4\ \text{st with independent stretch} \]

## Verification (synthetic stand-ins)

The real recordings are copyrighted and not in this repo. The recipe was run
end-to-end on synthesised stand-ins with the same tempos and keys
(`tools/render_standin_demo.js`, test `Paramore recipe end-to-end`):

- Detection: 131.0 BPM / Ab major, 86.5 (= 173 half-time) / Db major, 81.0 (= 162 half-time) / D major; hooks within 0.02 bars of each chorus downbeat.
- Output: 18 bars, **26.341 s** (expected \(18 \times 240 / 164 = 26.341\)), C major, peak −1.00 dBFS, ≈ −10.9 LUFS.
- An independent numpy/scipy onset-autocorrelation check reads the rendered file at **164.1 BPM**.
- In-browser (headless Chrome, Web Worker path): demo → recipe → render in ~6 s total, render ~1.3 s; viral score 83/100 ("Good potential"; lowest factors: loop level-jump caused by the deliberate filtered intro, and energy lift).

## Run it on the real songs

1. Open Hookline and upload your copies of the three songs (MP3/M4A/WAV, any order — slots match on file names containing *that/what you get*, *misery*, *sugar/fall out*).
2. Press **Apply test recipe**. Check each card's BPM/key/hook; use ×2/÷2 or pick another hook if a detection looks off.
3. Listen, tweak (Fine-tune / Arrangement), **⬇ WAV**.

Posting: use rights you hold, or the platform's licensed library version of the songs.
