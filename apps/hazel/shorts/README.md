# Hazel Shorts

*Formerly **Shortcraft**. One of the three [Hazel](../README.md) apps, next to Hazel Sped and Hazel Long. Old `/projects/shortcraft/` links redirect here, and saved projects, voice clips and settings keep loading.*

Make **faceless 9:16 explainer shorts in the browser** — the "what's inside / how it's made" format
behind fast-growing explainer accounts — in English or Bahasa Indonesia.

- **Live:** https://juw12.github.io/projects/hazel/shorts/ (studio: `hazel/shorts/app.html`)
- **Stack:** static HTML + Canvas 2D + Web Audio + MediaRecorder. No dependencies, no server, no login.

## What it does

| | |
| --- | --- |
| Templates | **Editorial** (light, serif headline, numbered step tracker, card), **Teardown** (dark, media frame, amber callout cards), **Pop** and **Clean** (per-scene layouts: hook, price, bars, chat, math, stamp, poll — editable in the studio) |
| Scenes | Hook → steps → outro/CTA. Headline, sub-title, step label, emoji or image, big stat, narration, caption override, chip |
| Voice | Record per scene with the mic (silence auto-trimmed) or upload clips; timing follows the audio. Browser voice for timing previews (not capturable, so not exported) |
| Captions | Auto-chunked (≤ 3 words / ~20 chars), number/acronym highlight |
| Music | Generated soft pad + pluck (calm / bright / dark), copyright-free, faded out at the end |
| Export | Real-time capture to **MP4 (H.264/AAC)** where supported (Chrome/Edge/Safari), otherwise WebM |
| Helpers | Viral checklist (hook length, ≤ 60 s, numbers, CTA), post kit (title, caption, hashtags EN/ID), JSON save/load, autosave |
| Publish | **YouTube direct upload** from the browser (your Google OAuth client ID, privacy + scheduled publish), Share / Save to TikTok & Instagram via the system share sheet, copy caption |
| Channel Kit | `shorts/channel.html`: one prompt → name ideas, handles, platform-length bios (EN/ID), content pillars, 30-day hook plan, 800×800 avatar + 2560×1440 YouTube banner, Markdown export |

Samples: *5 gates every gadget passes* (EN/ID, editorial) and *What's inside an outdoor camera* (EN/ID, teardown).

## What's new

- **Layout editor for Pop / Clean** — every scene gets a *Layout* picker plus plain-text fields
  (e.g. bars as `Label | 4500 | 4,500 mAh *`, chat as `me: …` / `them: …`, poll options one per line).
  Before, these layouts were only reachable by hand-editing JSON.
- **Voice clips survive a reload** — recordings/uploads are kept in this browser (IndexedDB) by scene id,
  so they follow scenes when you reorder, duplicate or undo. (They are still not inside the JSON file.)
- **Undo instead of data loss** — deleting a scene, *New*, *Import* and loading a sample all show an *Undo* toast.
  Opening a `?sample=` link no longer silently overwrites your autosaved project, and reloading after it keeps your edits.
- **Safer export** — progress bar, *Cancel export*, the editor/sample/import controls are locked while recording,
  a warning if the tab was hidden mid-export, and a leave-page prompt while recording.
- **Robust autosave/import** — a corrupt or partial project is repaired instead of leaving a blank studio.
- **Faster editing** — duplicate scene, keyboard shortcuts (<kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> ±1 s,
  <kbd>,</kbd>/<kbd>.</kbd> previous/next scene), click the preview to play, long-scene warnings, checklist score,
  copy feedback.
- **Channel Kit** — copy buttons for handle and bios, live bio lengths, full 30-day plan toggle, *Make it →* links that
  open any hook as a studio draft (`app.html?hook=…&lang=…`), remembers your last prompt, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to generate.
- **Fixes** — checklist now finds numbers in the narration even when a word-only "Big stat" is set; YouTube titles stay
  within the 100-character limit (including ` #Shorts`); post-kit caption has no empty bullet line; keyboard-reachable
  *Upload audio*, visible focus ring, compact phone header and a preview that leaves room to edit on small screens.

## Run locally

```bash
python -m http.server 8000 --directory apps/hazel/web
# open http://localhost:8000/shorts/app.html   (mic recording needs http(s)/localhost)
```

## Tests

```bash
python apps/hazel/tests/test_shorts_static_integrity.py
```

The export path was verified end-to-end in headless Chrome (2-scene project + real voice clip →
1080×1920 H.264/AAC MP4 with voice and music on the audio track, scenes and captions in sync).

## Optional pipeline

`pipeline/` holds the Python tools: `voiceover.py` turns a saved project into natural neural voice
clips (edge-tts; EN `en-US-AndrewNeural`, ID `id-ID-ArdiNeural`), plus the two hand-animated reference
renderers (exploded-view CCTV teardown and the editorial NPI explainer). See `pipeline/README.md`.

`pipeline/autopost/` is a scheduled poster for your own channels: plan topics (or draft scripts with an
OpenAI-compatible LLM) → render headlessly with neural voice → **review and approve** → post to
YouTube (Data API v3), TikTok (Content Posting API) and Instagram Reels (Graph API) at set time slots
via launchd/cron. Setup for each platform is in `pipeline/autopost/README.md`.

## Limits (honest)

- Export runs in real time and needs the tab visible; frame rate depends on the machine.
- Browser speech can't be recorded — record or upload voice for the final file.
- No AI script writing or stock footage; bring your own idea, facts and images.
- It cannot create social accounts — platforms require a real person to sign up and verify. The Channel Kit
  makes that a 5-minute job.
- TikTok API posts are private (SELF_ONLY) until your developer app passes TikTok's audit; Instagram needs a
  Creator/Business account and a publicly reachable video URL.
- The publisher only talks to Google when you click Connect; the studio and Channel Kit stay offline.
- Nothing here guarantees views. It makes a proven format fast; the idea still has to be good.
