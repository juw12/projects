# Posting Sped edits to TikTok, Reels and YouTube Shorts

Checked October 2026. Platforms change limits often; their upload screens are
authoritative.

## Why video

None of the three platforms accepts an audio-only file as a post. Sped renders
the sound, then records a vertical video of the same preview you see in the app.

| | TikTok | Instagram Reels | YouTube Shorts |
| --- | --- | --- | --- |
| Canvas Sped exports | 1080×1920, 9:16, 30 fps | same | same |
| Length check in Sped | ≤ 10 min | ≤ 3 min | ≤ 3 min |
| Formats listed by platform | MP4, MOV, WebM | MP4, MOV | MP4, MOV, WebM |
| Caption checks in Sped | 2,200 characters | 2,200 characters, **5 hashtags** | 100-character title, 5,000-character description |
| Approx. safe margins (top / bottom / right px) | 160 / 480 / 150 | 220 / 420 / 130 | 180 / 400 / 140 |

“All platforms” uses the strictest value of each field.

## Music rights

A sped-up or mashed-up commercial song is still that song. The checklist warns
when no permission basis is recorded. Options, from safest:

1. Use audio you own or have a license for that covers this remix and platform.
2. Export a **silent** video in Sped and add the official sound (often including
   official sped-up versions) from the platform's own library inside the app.
3. Externally added commercial music may be muted, claimed or removed — e.g.
   YouTube notes that externally added music in Shorts may get Content ID claims.

Sped's notes are your declarations, not clearance. See
[music and publishing guidance](music-and-publishing.md).

## Getting the file into the app

- **Phone:** Export → Share… opens the system share sheet; pick TikTok,
  Instagram or YouTube if listed. The caption is also copied to the clipboard
  because many apps ignore shared text.
- **Desktop:** Download video, then “Open upload” (TikTok Studio, YouTube
  upload, Instagram web) and paste the caption.

Sped does not log in to or post on your accounts. Direct posting would need each
platform's approved developer integration and OAuth review.

## Known limits

- Recording is real time; switching tabs can throttle frames.
- MP4 depends on the browser (current Chrome/Edge/Safari). Firefox records WebM,
  which Instagram does not list.
- Safe zones are approximate and vary by device and app version.
- Tested in headless Chrome with synthetic audio; not yet on iPhone/Android hardware.
