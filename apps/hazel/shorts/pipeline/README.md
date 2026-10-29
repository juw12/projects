# Hazel Shorts pipeline (optional)

The web studio (`../../web/shorts/`) needs nothing installed. This folder is for creators who want
**neural voiceovers** or **full-quality offline renders** with custom animation.

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 1. Natural voiceover for a studio project

1. In the studio, press **Save JSON**.
2. `python voiceover.py my-project.json` → writes `my-project_voice/scene_01.mp3 …`
   (English: `en-US-AndrewNeural`, Indonesian: `id-ID-ArdiNeural`; override with `--voice`).
3. Back in the studio, **Upload audio** on each scene, then **Export video**.

## 2. Full renders (Python, 1080×1920 @ 30 fps)

The two hand-animated reference episodes — an exploded-view CCTV teardown and the editorial
"5 gates" NPI explainer — live in `examples/`. Each script supports `--lang en|id` and `--preview`
(contact sheet before a full render):

```bash
python examples/teardown_cctv/make_video.py --lang id --preview
python examples/teardown_cctv/make_video.py --lang id
python common/loudnorm.py examples/teardown_cctv/teardown_ep01_cctv_id.mp4   # -14 LUFS for social
```

Music and sound effects are synthesized with numpy (copyright-free). Voices use edge-tts and fall back
to macOS `say` when offline.

## Notes

- edge-tts uses Microsoft's online voices through an unofficial client — fine for testing; review the
  terms (or switch to a licensed TTS / your own voice) before monetizing.
- Facts in the example scripts were checked (e.g. 4 MP × 1.5 B × 30 fps ≈ 166 MB/s raw; PoE 802.3af ≈ 13 W
  at the device; Ethernet ≤ 100 m), but they describe a generic camera, not a specific model.
