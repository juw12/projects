# Shortcraft autopost — plan → render → review → post

Runs on **your** computer and posts with **your** accounts through each platform's official API.
Nothing here creates accounts. Every platform requires a real person to sign up and verify, and
automated sign-up breaks their terms. Use the [Channel Kit](../../web/channel.html) to get names,
bios, avatar and banner, then create the accounts yourself (about 5 minutes each).

```text
topics.txt ──plan──▶ queue/<channel>/<NNN-slug>/project.json + post.json ("approved": false)
                     │  review facts and wording in the studio (Import JSON), then set "approved": true
           ──render─▶ video.mp4  (neural voice → headless Chrome export → 30 fps, −14 LUFS)
           ──run────▶ YouTube / TikTok / Instagram at the channel's time slots  → result.json
```

## 1. Install (once)

```bash
cd apps/shortcraft/pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # edge-tts, imageio-ffmpeg, websocket-client, numpy, pillow
cd autopost && cp config.example.json config.json
```

Google Chrome must be installed (it renders the video headlessly). `config.json`, `secrets/`,
`tokens/` and `queue/` are git-ignored. Keep them that way.

## 2. Connect the platforms

### YouTube (works for public posting today)

1. Go to <https://console.cloud.google.com/>, create a project and enable **YouTube Data API v3**.
2. Under **OAuth consent screen**, choose External and add yourself as a test user.
3. Under **Credentials**, create an OAuth client ID:
   - **Desktop app** for this CLI. Download the JSON to `autopost/secrets/google_client_secret.json`.
   - (Optional) **Web application** for the browser Publish panel. Add your site origin
     (e.g. `https://juw12.github.io`) as an authorised JavaScript origin, then paste the client ID
     into Studio → Publish.
4. Run `python autopost.py auth youtube --channel en`. A browser opens; pick the **brand channel**
   you want to post to. Repeat with `--channel id` for the second channel.

Limits that matter:
- `videos.insert` allows 100 calls per day per project.
- Uploads from unverified API projects are **not** forced to private.
- While the consent screen is in **Testing**, refresh tokens expire after **7 days**, so you would
  have to re-run `auth` weekly. Switching the app to **In production** removes that limit; for a
  personal app, expect Google's unverified-app warning.

### TikTok (private only until audited)

1. Go to <https://developers.tiktok.com/>, create an app and add **Login Kit** and **Content Posting API**
   (Direct Post), with scopes `user.info.basic` and `video.publish`.
2. Register the redirect URI `http://127.0.0.1:8723/callback`. Put the client key and secret in `config.json`.
3. Run `python autopost.py auth tiktok --channel en`.

Before TikTok audits your app, posts are **SELF_ONLY** (visible only to you), at most 5 users can
post in 24 h, and the account must be private. Submit the app for audit before setting
`privacy_level` to `PUBLIC_TO_EVERYONE`. Until then, use the studio's **Share / Save** button and post
from the TikTok app; that is allowed, and you can add trending sounds there.

### Instagram Reels

1. Switch the Instagram account to **Creator** or **Business** (Settings → Account type).
2. Go to <https://developers.facebook.com/>, create an app, add **Instagram API with Instagram Login**,
   and generate a long-lived token with `instagram_business_basic` and `instagram_business_content_publish`.
3. Fill in `ig_user_id` and `access_token`. Run `python autopost.py auth instagram --channel en`
   from time to time to refresh the token; long-lived tokens last about 60 days.
4. Instagram fetches the video from a **public URL**. Set `mode: "url"` and point `public_base_url` at
   a folder you sync `video.mp4` files to (S3, R2, your own server). Alternatively, use
   `mode: "resumable"` with a Facebook-Login app token.

## 2b. Stay on trend (automatic)

`python trends.py --out trends.json` builds a brief of what Indonesia is searching and reading right now:
Google Trends daily searches for Indonesia plus tech-section RSS from CNN Indonesia and Antara. Each lead is
scored for this channel's angle (prices, launches, discounts, paylater, gadgets). Feed the brief into
`plan --llm` so scripts are built on current, real examples. Headlines are **leads, not facts**: every
number in a script must link back to its source article, shown as the on-screen footnote (`scene.source`).

The **Pop** template (`"template": "pop"`) has 7 animated layouts. Pick one per scene with `scene.layout`:
`hook`, `price` (rolling price counter + stamp), `bars` (comparison bars), `chat` (excuse bubbles),
`math` (typed calculation), `stamp` and `poll` (A/B + "komen A atau B"). It adds word-by-word captions,
a progress bar and a source footnote. Voice per project: `"voiceConfig": {"name": "id-ID-GadisNeural",
"rate": "+12%"}`. Keep Shorts under 60 s (`"scenePad": 0.35` tightens the gap between scenes).

## 3. Daily use

```bash
python autopost.py plan --channel en --topics topics_en.txt      # one topic per line
python autopost.py plan --channel id --topics topics_id.txt --llm # or let an LLM draft the scripts
#   → open each queue/<channel>/<item>/project.json in the studio (Import JSON), fix facts,
#     then set "approved": true in post.json
python autopost.py render
python autopost.py run --dry-run      # shows what would post now
python autopost.py status
```

`run` posts at most one item per due slot per channel. It records `result.json` and never posts the
same item to the same platform twice. If one platform fails, the item is retried on the next run
for that platform only.

## 4. Run it on a schedule (macOS)

Copy `launchd/com.shortcraft.autopost.plist`, replace the two `/ABSOLUTE/PATH/...` values, then:

```bash
cp launchd/com.shortcraft.autopost.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.shortcraft.autopost.plist      # runs every 15 min
tail -f /tmp/shortcraft-autopost.log
```

Or use cron (Linux, or macOS with Full Disk Access for cron):

```cron
*/15 * * * * cd /ABSOLUTE/PATH/apps/shortcraft/pipeline/autopost && ../.venv/bin/python autopost.py run >> /tmp/shortcraft-autopost.log 2>&1
```

The computer must be awake at slot time. Missed slots are posted at the next run that day.

## 5. How much to post

Start with **one slot per day per channel** (the default in `config.example.json`), and keep the
review step (`auto_approve: false`). Add slots only when every video is still worth watching.
YouTube's policies on repetitive and mass-produced content, and on inauthentic content, apply to
automated channels. Posting three near-identical videos a day is the fastest way to lose
monetization eligibility.

## 2c. Narrate in your own voice (voice clone)

1. `python voice_recorder.py` opens a teleprompter page. Press **Mulai rekam**, read ~80 s, press **Selesai**.
   The take is checked instantly (length, loudness, clipping, background noise) and saved to
   `secrets/voice/sample.wav` (git-ignored).
2. On the same page paste an ElevenLabs API key (Starter plan or higher: Instant Voice Clone + commercial
   licence) and press **Buat clone**. A test line plays back in your cloned voice.
3. Use it in a project: `"voiceConfig": {"provider": "elevenlabs", "speed": 1.08}`.
   In GitHub Actions set the secrets `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.

Only clone your own voice. YouTube does not require an AI label for narration made with a clone of your own voice.

**Free alternative ($0, no account):** `"voiceConfig": {"provider": "openvoice", "name": "id-ID-ArdiNeural"}`.
The free edge-tts voice is re-coloured to your timbre with OpenVoice V2 (MIT) on CPU, using the same
`secrets/voice/sample.wav`. One-time: `pip install torch librosa soundfile huggingface_hub` and
`python voice_convert.py setup`. It sounds closer to you (timbre, pitch) but keeps the base voice's
rhythm and accent; ElevenLabs is the more faithful clone.

## 2d. Automatic polish and QC (pop template)

`render_headless.py` now does these on every render and writes `<out>.qc.json` next to the MP4:

- **Sound effects** (`sfx.py`, synthesized with numpy, no sample files): whoosh just before each cut,
  pops on chat bubbles and poll options, ticks + ding on bars and math, thump on stamps.
  `"sfx": false` turns them off, and `"sfxGain"` (default 0.5) sets their level.
- **Reading time:** every scene stays on screen long enough to read (about 15 characters/s + 1 s, capped at 6 s).
- **Narration check** (`asr_check.py`): faster-whisper "small" listens to each voice clip and compares it
  letter-by-letter with the script (numbers are normalized: 63% = "enam puluh tiga persen"). The render fails below 0.82
  unless `"asrCheck": "warn"`. Needs `pip install faster-whisper` in the Python set via `ASR_PYTHON`.
  If it's missing, the check is skipped; `ASR_REQUIRED=1` makes that fatal.
- **Loudness:** two-pass loudnorm to −14 LUFS / −1.5 dBTP, plus black-frame detection.

The SFX timing and QC ideas were borrowed from [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) (MIT),
re-implemented here from scratch; no code was copied.

## 2e. Script gate (/yt-script)

Before any voice is generated, `render_headless.py` runs `script_check.py`, the /yt-script rules from
[youtube-agent-skill](https://github.com/Jakeschincariol/youtube-agent-skill) (MIT, vendored unchanged in
`vendor/yt_script/`). Its `hookscore.py` word lists are English, so `script_check.py` adds Indonesian and
Jakarta-slang words plus Indonesian patterns for all 21 hook formulas (English scores stay identical to upstream).

```bash
python script_check.py project.json            # hook panel + gates, exit 1 if a blocking gate fails
python script_check.py --hooks hooks.txt       # rank hook options, one per line
python autopost.py check queue/mending/*/project.json
```

| gate | blocks the render? | rule |
|---|---|---|
| hook | warn (`strict`: fail) | hook score ≥ 55; a low score means "look again", never a promise |
| title | warn (`strict`: fail) | the first spoken sentence echoes the title |
| no_intro | fail | no greeting, channel intro or subscribe pitch in the first two scenes |
| on_screen | fail | every scene shows something |
| payoff | warn | a question in the hook gets an answer beat before the close |
| one_ask | fail | one ask (comment OR subscribe OR share…), not three |
| sourced | fail | every scene that speaks a statistic carries `source` |
| runtime | warn | about 60 s or less at 150 wpm |

`"scriptCheck": "gate" | "strict" | "warn" | false` sets the mode. `"hookOptions": [...]` holds alternative hooks,
which are all scored, and the top two are reported. `autopost.py plan --llm` asks for five hook options and prints the best two.
