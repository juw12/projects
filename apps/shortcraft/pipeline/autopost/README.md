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
     (e.g. `https://juwpegatron.github.io`) as an authorised JavaScript origin, then paste the client ID
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
