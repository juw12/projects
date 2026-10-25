# Paramore concept recipe — corrected verification scope (v1.1)

**Requested direction:** “That's What You Get,” higher/faster, with nostalgic songs mixed in.

## Proposed arrangement, not a verified commercial-audio remix

| Source | Catalogue reference only | Proposed use |
| --- | --- | --- |
| Paramore — That's What You Get | 131 BPM, Ab major | Main track; +4 semitones, 164 BPM target |
| Paramore — Misery Business | 173 BPM, Db major | 2-bar hook opening |
| Fall Out Boy — Sugar, We're Goin Down | 162 BPM, D major | 4-bar hook switch |

Sources disagree on these metadata. For example, 87 vs 131 BPM is **not** a
half/double-time relationship. Do not silently substitute either value. The app
now uses your detected/manually corrected tempo and key, warns about disagreement,
and only adjusts octave convention when close to the reference.

Reference links (not proof of the uploaded recording's key/tempo):
- https://tunebat.com/Info/That-s-What-You-Get-Paramore/1JdKrFyoU05abww0Zv0ayQ
- https://songdata.io/album/71rziY9eLo1tA2dBMxrwhc/Riot-by-Paramore
- https://www.mixgraph.io/tracks/paramore-thats-what-you-get

At those proposed values:
\[
\frac{164}{131} \approx 1.252,\quad
\frac{164}{173} \approx 0.948,\quad
\frac{164}{162} \approx 1.012.
\]
\[
18\times\frac{240}{164} \approx 26.341\text{ seconds}.
\]

The full sequence is 2 bars Misery Business, 8 bars TWYG, 4 bars Sugar,
4 bars TWYG. If the listed keys are correct, the main shift lands on C major,
and the two layers need −1 and −2 semitones respectively. These are editable
starting points, not promises of natural vocals or harmonic compatibility.

## What is actually tested

- Synthetic original stand-ins at the listed tempos and keys, not recordings of
  Paramore or Fall Out Boy. The source finder is checked against their known
  synthetic chorus boundaries.
- The recipe produces 18 bars, about 26.341 seconds; output tempo is re-analysed
  and pitch/length independence is separately tested using tones.
- Default approximate loudness target is now −14 LUFS, editable. The limiter
  controls sample peaks, not intersample true peaks. There is no standards or
  platform compliance certification.
- Tests cover parameter bounds, wrong/missing tracks, short source regions,
  malformed audio, portable recipe identity and restored worker sessions.
- Browser checks exercise Web Workers, actual synthetic-WAV upload/decoding,
  portable recipe import, cancellation/failure recovery, mobile and offline mode.

**Unverified:** the actual recordings, hook choices by ear, perceptual mashup
quality, real-device Safari/iOS behavior, licensing, and audience engagement.
The previous “viral potential” number was not a validated prediction; 1.1
replaces that label with an editing checklist and removes fabricated recognition
scoring. Adding more songs is not evidence that people will recognize the result.

## Using your recordings

Upload the three recordings you have permission to use, select their slots,
preview the estimated hooks, correct metadata and apply the recipe. Unique title
matches can prefill slots; missing or ambiguous matches never fall back to upload
order. Check the result before WAV export. A saved portable recipe contains
source identities and edits but not audio or publication rights.
