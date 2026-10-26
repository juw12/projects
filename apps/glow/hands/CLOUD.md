# Glow Hands without your PC

Two ways to run browser missions from your phone while your PC is off. Both use the same encrypted
phone link (WebRTC through PeerJS) as "Use from your phone".

| | Cloud browser (GitHub) | Always-on server (Oracle free VM) |
|---|---|---|
| Start | Tap **Start cloud browser** on the phone, ready in about 1 minute | Always on |
| Lasts | Up to 20 minutes, or 8 minutes without use | Until you turn it off |
| Saved logins | None (fresh browser every time) | Kept between missions |
| Cost | Free on this public repository | Free tier; card needed to sign up |
| Watch out | GitHub allows only light, occasional use | Free VMs idle for 7 days can be reclaimed (see below) |

Both browsers are hidden. You can't "take over" to type a password, and some sites show more CAPTCHAs to
cloud machines. GlowLead still asks you before submitting, buying, sending, posting or deleting.

## No setup at all: Android app or instant cloud browser (v0.15)

**Android phone:** install Glow for Android (the `Glow-android.apk` asset of the
[`glow-android` release](https://github.com/juw12/projects/releases/tag/glow-android); allow "install unknown
apps" for your browser when asked). The app has its own browser built in, so missions run on the phone with
no PC and no cloud. The browser opens as a panel over GlowLead; tap **Bigger** to watch or type yourself,
**Hide** to put it away. Signing in to Puter inside the app may not work on every phone; guest use works.
Updates are installed the same way (same signing key, so your data stays).

**Instant cloud browser (any phone, including iPhone):** GlowLead → Connect browser control → **Start instant
cloud browser**. It runs on Cloudflare's free plan (`apps/glow/cloud/`), needs no account or token from you,
and starts in a few seconds. Live at `https://glow-cloud.juw12.workers.dev`; every deploy runs a real mission check (`apps/glow/cloud/test/live_check.py`). Limits of the free plan, shared by everyone using it: 10 browser-minutes a day
and 3 browsers at once; a session ends after 10 minutes without use. Fresh browser every time, no saved
logins. Only GlowLead's own pages (and the app) may use the service.

Deploying the service (maintainer, once): create a free Cloudflare account (no card), make an API token
with the **Edit Cloudflare Workers** template plus **Account → Browser Run → Edit** (Browser Run was called Browser Rendering), and add repository
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The workflow
`.github/workflows/glow-cloud-worker.yml` then deploys on every change to `apps/glow/cloud/`, and the
service address goes into `CLOUD_SERVICE_URL` in `web/lead/lead.js`.

## Cloud browser on GitHub (option 4)

One-time setup, about 3 minutes:

1. **Cloud key.** A repository secret named `GLOW_CLOUD_KEY` (random, 32+ characters) is already set
   on `juw12/projects`. Open the setup link you were given once on your phone:
   `https://juw12.github.io/projects/glow/lead/#cloud=<key>`. It stores the key on that phone only.
   To make a new key, set a new `GLOW_CLOUD_KEY` secret and open the new setup link.
2. **GitHub token.** On github.com go to **Settings → Developer settings → Fine-grained tokens →
   Generate new token**:
   - Repository access: **Only select repositories → juw12/projects**
   - Permissions: **Actions → Read and write** (nothing else)
   - Choose an expiry you're comfortable with.

   Paste it into GlowLead on the phone: **Connect browser control → No PC? Use a cloud browser →
   Set up once on this device**.
3. Tap **Start cloud browser**. When it says ready, start a mission with "Let Glow Hands use my browser".
   **Stop** ends it early. **Use my PC again** switches back to your PC link.

How the secrets stay private on a public repository: the phone picks a random session id and only that
id goes to GitHub. The job and the phone each derive the private link from the session id plus the cloud
key, using HMAC-SHA256. The job prints no token, link or page content, and run logs only
show start/stop lines. The token and key live in this phone's browser storage, on the shared
`juw12.github.io` origin. Use **Forget** on a device you no longer use, and revoke the token on GitHub
if a phone is lost.

The workflow is `.github/workflows/glow-cloud-hands.yml`. Each run is capped at 30 minutes and only one
runs at a time.

## Always-on server on Oracle Cloud (option 3)

1. Sign up at <https://www.oracle.com/cloud/free/>. A card is needed for verification; Always Free
   resources aren't charged.
2. **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04** (or 22.04)
   - Shape: **Ampere (VM.Standard.A1.Flex)**, 1 OCPU and 6 GB memory is plenty. (The 1 GB AMD micro
     shape also works; the installer adds swap.)
   - Networking: defaults are fine. No ports need opening, because the phone link connects outward.
3. When it's running, click **Connect → Cloud Shell connection** (or SSH), then run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/install-glow-hands-linux.sh | bash
   ```

   It installs Glow Hands with a hidden Chromium, starts it now and after every reboot, and prints a
   **QR code + link**. Scan it with your phone once; GlowLead then shows **CONNECTED · SERVER**.
4. Later: `~/.local/bin/glow-hands-link` shows the link again; `~/.local/bin/glow-hands-link --new` turns off
   old phone links; `sudo journalctl -u glow-hands -f` shows logs. Run the install line again to update.

**Idle reclaim:** Oracle may reclaim Always Free VMs that stay mostly idle (CPU, network and, for Arm,
memory all under 20%) for 7 days. A browser that waits for missions is usually idle. To avoid this,
upgrade the account to **Pay As You Go**: Always Free resources stay free, but set a budget alert in
case you create something billable.

The same installer works on any Ubuntu/Debian machine that stays on: a Raspberry Pi, an old laptop, or
another cloud VM.
