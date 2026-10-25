# Hookline v1.1.0 — reliability and claim audit

## Findings and fixes

| Finding | Correction |
| --- | --- |
| Unvalidated “viral potential” and fabricated recognition bonus based on source count | Replaced with an explicitly unvalidated editing checklist. Removed recognition/source-count scoring and all reach predictions. |
| Request parser could enable negated effects | Common “no/without/skip/avoid/don't” effect requests now disable those controls; downward semitone values and invalid explicit numbers are tested. Still a rule parser, not an LLM. |
| Extreme values or malformed imported objects could allocate unbounded output | Strict finite numeric, enum, boolean, segment-count and duration validation before planning/DSP. Prototype keys rejected; recipe JSON limited to 256 KB. |
| Unbounded uploads and silent/malformed buffers | 4 tracks, 40 MB/file, 1–360 s/track, 900 s total, mono/stereo. Duration checked before decode and again afterward; sample rate, finite samples, channel lengths and silence checked. |
| Worker failure lost its audio store and left pending promises | Bounded RPC, postMessage/message/onerror handling, 90-second timeout, explicit cancellation, termination and rehydration from retained PCM on retry. |
| Controls could change while a render/variant batch was still running | A native disabled fieldset locks all controls, including dynamically recreated ones. Cancel remains available outside it. |
| Playback/download could look like the new settings even when still an old render | Changed controls flag the previous render; saved output recipes snapshot that render's settings and sources. |
| Saved recipes relied on temporary upload-order IDs | Versioned source manifest maps by name, duration and a sampled PCM checksum, preserving roles/BPM/key/hook/nudges. Ambiguous or changed sources are rejected. Old files are rejected instead of guessed. |
| Paramore preset could assign unrelated songs and force catalogue BPM | Explicit slot selectors, unique title suggestions only, three distinct sources required. No arbitrary assignment or forced catalogue keys/tempo; only compatible octave normalization. |
| Out-of-source segments became silent padding | Manual source bounds fail clearly; automatic hook starts can move to fit with a visible warning. Too-short recordings fail rather than output long silence. |
| Four-bar minimum overrode short duration requests | Automatic duration now rounds to the nearest bar, with a one-bar minimum. |
| Coarse master target and “seamless” loop claims | Editable approximate −14 LUFS default; sample-peak/true-peak limitation disclosed. Loop blending is explicitly audition-required. Non-loop tails are declicked after effects/mastering. |
| Offline cache cleanup deleted caches belonging to other apps | Only Hookline-prefixed caches are cleaned; local shell caching supports query-string routes; updates wait for user approval and loopback registration works. |

## Checks completed

- **38 engine regressions** plus static shell/asset/cache checks, under macOS JavaScriptCore.
- **15 isolated Chrome browser checks**: real worker demo, stale-output indicators,
  negative requests, cancellation, worker crash recovery, RPC timeout, portable
  recipe file import after reordered identifiers, variant batch completion,
  actual synthetic-WAV upload/decode/render, loopback offline worker, cache
  isolation, offline mobile rendering, mobile overflow and unhandled exceptions.
- Browser tests use an isolated temporary profile and a local server; no personal
  browser cookies or private audio are accessed.
- Test fixtures are synthetic. This does not establish perceptual quality on
  real songs or statistical validity of the editing checklist.

## Deliberate limitations

No AI song recommendation/retrieval, stem separation, rights clearance, formant
preservation, engagement-data model, or social-media auto-posting. Catalogue
metadata and automatic analysis remain fallible. Whole recordings are sequenced
and crossfaded; this is not a clean vocal/instrumental mashup engine. Safari/iOS
hardware, real commercial recordings and professional listening quality are not
validated. The sample-peak limiter and approximate loudness meter are not a
certified platform-delivery workflow. Heavy sessions may still exceed low-memory
phone limits.

## Migration

Export any current audio before updating. A v1.1 session shows an update button
when a later build is ready; it does not silently reload. Coming from v1.0,
close all open Hookline tabs/PWA windows and reopen so the waiting worker can
activate. Re-upload originals to load v1.1 portable recipes. Recreate legacy
v1.0 recipes because their temporary source IDs cannot be safely recovered.
