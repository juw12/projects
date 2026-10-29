# Hazel Sped 1.5 — shorts studio for sped-up, slowed & mashup edits

*Formerly **Sped** (and before that **Hookline**). One of the three [Hazel](../README.md) apps, next to Hazel Shorts and Hazel Long.
Old `/projects/sped/` and `/projects/hookline/` links redirect here, saved looks keep loading, and recipe files saved under the old names still load.*

[Open app](https://juw12.github.io/projects/hazel/sped/) ·
[Web](https://juw12.github.io/projects/hazel/sped/web.html) ·
[Mobile](https://juw12.github.io/projects/hazel/sped/mobile.html)

Upload your audio, describe a direction such as “higher, faster, no reverb,
20 seconds,” audition the result, and export a WAV. Processing happens in your
browser; there is no audio-upload server, account, or external AI service.

## New in 1.5 (Hazel)

- Sped is now **Hazel Sped**, part of the unified Hazel app at `/projects/hazel/`. The Hazel chip in the header switches to Hazel Shorts, Hazel Long or Hazel home.
- The offline cache is now `hazel-sped-v1.5.0`; the old worker at `/projects/sped/` is retired and only its own `sped-v…` caches are cleared.

## Built for posting (since 1.4)

TikTok, Instagram Reels and YouTube Shorts accept video, not audio-only files, so
Sped now turns the edit into a ready-to-post **9:16 MP4**:

- **Editor layout like the popular mobile editors:** a live 9:16 preview in the
  centre, a multi-lane timeline (text, visual, audio segments, bar grid; click to
  jump), one-tap **Styles** tiles, quick speed chips (0.8×–1.5×) and an inspector
  with Edit / Mix / Text & look / Post tabs. On phones it becomes preview-on-top
  with a fixed bottom toolbar (Media, Styles, Edit, Mix, Text, Post).
- **Platform switch (TikTok / Reels / Shorts / All):** drives approximate
  UI safe zones (toggle the overlay), caption limits and the pre-post checklist.
- **Text & look:** title, subtitle, text position, five themes, bars/wave/ring
  beat-reactive visualizer, speed/BPM badge, progress bar, optional background
  image (stays on the device).
- **Export:** 1080×1920, 30 fps MP4 (H.264 + AAC) where the browser supports it,
  WebM otherwise; recorded in real time from the same renderer as the preview.
  Optional **silent export** so you can add the official sound inside the app —
  usually the safest route for commercial songs. Also a 1080×1920 cover PNG.
- **Caption helper:** title + credits you entered + hashtags that describe the
  edit (#spedup, #slowed, #nightcore, #mashup…), capped per platform
  (Instagram: 5 hashtags; Shorts: 100-character title). Copy, or Share on phones.
- **Post:** Share opens the system share sheet (installed apps such as TikTok or
  Instagram appear if the OS offers them); otherwise download and use
  “Open upload”. Sped cannot post on your behalf — that needs each platform's
  approved developer integration.

See [posting guide](docs/posting-shorts.md) for specs, safe zones and limits.

## Real songs and publishing (since 1.2)

Copyright is not an automatic technical block on editing an uploaded song. The
separate question is whether the intended remix/publication is permitted. A
local-only editor does not grant rights or create a blanket private-use exception.
See [music and publishing guidance](docs/music-and-publishing.md) for official
CapCut, TikTok and YouTube references and practical options.

The **Real songs & publishing notes** panel records your declarations, license
reference, required credit, restrictions, destination and commercial-use intent.
It supplies guidance and an optional JSON checklist—not a clearance certificate.
No title/copyright gate, song downloading, DRM bypass or Content ID evasion was
added. “Save current session recipe” includes current notes; “Save rendered
recipe” keeps the earlier render's snapshot. Source names and notes are included
in these optional JSON files; review them before sharing.

Version 1.2 also corrects coupled-pitch readouts, unlocks duration after switching
to automatic arrangement, exposes source pitch nudges on main tracks, rejects
invalid explicit BPM input instead of silently choosing auto, and preserves
manual source-start times exactly. Ordinary v1.1 portable recipes remain readable;
missing permission notes are treated as unknown, never inferred as licensed.

## Capabilities and honest limits

- **Requests:** a rule-based keyword/number parser, not an AI music model.
  Supports faster/slower, higher/lower, nightcore, reverb, bass, lo-fi, auto-pan,
  simple negations and explicit tempo/pitch/duration values. Review its notes
  and controls: arbitrary natural-language arrangements are not understood.
- **Tempo/pitch:** independent WSOLA stretch and resampling, or coupled classic
  speed change. No formant preservation or stem separation; extreme settings
  can smear transients or sound artificial.
- **Analysis:** approximate BPM, key and energetic/repeated hook candidates.
  They are not guaranteed choruses, downbeats or reliable harmonic matches.
  Half/double-time is common; manual corrections and hook previews are available.
- **Mashups:** bar-length sequencing and crossfading of complete recordings,
  tempo/key matching, optional filter-in and risers. Not clean vocal-over-
  instrumental mashups. Upload the source recordings yourself.
- **Master:** EQ, optional FX, compression, an editable approximate loudness
  target (default −14 LUFS), and a −1 dBFS **sample-peak** ceiling. This is not a
  certified BS.1770 meter or a true-peak limiter; no platform compliance claim.
- **Loops:** optional tail blending; audition the seam. A blended waveform does
  not guarantee a seamless musical phrase. Non-loop endings get a short declick.
- **Editing checklist:** onset energy, boundary continuity, length, style tempo,
  dynamic contrast and loudness. It is unvalidated and cannot predict virality,
  recognition, taste or reach. “Compare 3 edits” ranks these heuristics only.
- **Video:** real-time MediaRecorder capture (keep the tab visible while it
  records). Safe zones are approximations of each app's overlays and vary by
  device. Platform limits change; the destination's upload screen wins.
- **Exports:** 9:16 MP4/WebM video, cover PNG, 16-bit stereo WAV and versioned portable recipe JSON. Recipes
  contain source names/checksums and corrections, not audio. Share them only if
  you are comfortable sharing source names; the recipe does not confer rights.

## Safer workflow in 1.1

1. Upload up to **4 mono/stereo tracks**, **40 MB each**, **1–360 seconds each**,
   **900 seconds total**. Metadata is checked before decode and decoded audio is
   checked again. Format support depends on the browser. Limits reduce memory
   pressure but long sessions can still be demanding on phones.
2. Preview and correct estimated BPM, key and hook. State explicit numbers when
   possible. Unsupported/extreme values fail with a readable error.
3. Render or compare edits. Controls stay locked during processing. Cancel a
   worker task without losing the loaded tracks; after a worker failure, retry
   Render to restore its audio store. Worker tasks have a 90-second timeout.
   Direct file opening uses a main-thread fallback, which can pause the UI;
   use HTTP/HTTPS for cancellation and offline support.
4. Changing settings marks the playback/download as the **previous render**.
   Render again to apply changes. Saving that output saves its own recipe,
   not unrelated current controls.
5. Load a portable recipe only after re-uploading the unchanged original files.
   Matching uses normalized names, duration and a sampled PCM checksum, not
   upload order. Missing, changed or ambiguous files are rejected. Checksums are
   for accidental mismatches, not cryptographic identity. Older v1.0 recipes
   used temporary IDs; recreate/save them in 1.1 rather than silently remapping.

The offline service worker deletes **only Hazel Sped caches**, caches local assets
only, and stages new versions until you choose to reload. Reloading clears
loaded audio; export it first. Audio itself is never persisted in the cache.

## Paramore concept recipe

The built-in recipe targets **164 BPM, +4 semitones, 18 bars (about 26.3 s)** for
“That’s What You Get,” with “Misery Business” and “Sugar, We’re Goin Down.”
Choose each recording explicitly. Unique title matches can prefill the choices;
unrelated filenames are never assigned by order. A full recipe needs all three.

It uses your measured/manual keys rather than forcing catalogue keys. It only
normalizes tempo octave convention when reasonably close to reference metadata.
Catalogue data is inconsistent, so verify by ear. See [the test note](docs/paramore-test.md).
The real recordings have **not** been tested or bundled. The in-app demo uses
original synthetic stand-ins, not Paramore/Fall Out Boy audio.

Only remix and publish material you have permission to use. Platform licensing,
Content ID, territorial restrictions and commercial-use rights need separate
review; this app neither clears rights nor bypasses platform restrictions.

## Development and tests

No build dependencies. Serve the web directory using Python's HTTP server.
The App/Web/Mobile entry points share the same engine and UI.

- `apps/hazel/tests/test_sped.py`: static asset/cache checks and 44 engine regressions
  under Node or macOS JavaScriptCore. CI supplies Node; local absence is reported
  as a skip rather than a fabricated test pass.
- `apps/hazel/sped/tools/browser_smoke.py`: 21 isolated headless-Chrome checks with real workers,
  uploads, recipe roundtrip, failure/timeout/cancel recovery, mobile and offline
  behavior. Supply `--chrome` and `--artifacts`; no personal browser profile is used.
- `tools/render_standin_demo.js`: generates a synthetic test render, never a real
  commercial-song remix.

This is a working browser prototype, not a validated music-production service
or an engagement-prediction system. Safari/iOS hardware, real commercial audio,
professional listening quality and real-world audience performance remain unverified.
