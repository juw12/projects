# Deploying Respark without owning a domain

You don't need a domain to go live. Three $0 paths, fastest first.

---

## Path 1 - Cloudflare quick tunnel (instant, on your laptop)

**Time: 2 minutes.** Public HTTPS URL pointing at `localhost:8000`. No signup, no account.

The `start-with-tunnel.ps1` script does this automatically - it installs cloudflared via winget if needed, starts the tunnel, captures the public URL, writes it into `.env`.

If you want to do it manually:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8000
```

You'll see something like:
```
Your quick Tunnel has been created! Visit it at:
https://xxxx-xxxx-xxxx.trycloudflare.com
```

**That URL is your live Respark app.** Use it as `RESPARK_BASE_URL`.

**Works for:**
- Demos to prospects (send them the link)
- Cold email tracking pixels (resolve over the public URL)
- Stripe webhooks (HTTPS, valid SSL)
- Outreach unsubscribe links

**Limits of the free tier:**
- URL changes every time you restart cloudflared
- Laptop must stay on while serving
- No persistent URL (paid tier = $5/mo for a fixed subdomain)

**When to upgrade:** as soon as you close your first paying client ($497 covers years of cloudflared paid).

---

## Path 2 - Render free tier (permanent, in the cloud)

**Time: 15 minutes.** Permanent URL `respark.onrender.com`. No credit card needed.

### Steps

1. **Push to GitHub**
   ```bash
   cd "%USERPROFILE%\Documents\Default Project"
   git init
   git add respark/
   git commit -m "Initial Respark deployment"
   gh repo create respark --public --source=respark --push
   ```

2. **Sign up at [render.com](https://render.com)** (free, GitHub login)

3. **New - Blueprint** - point at your repo - it auto-detects `render.yaml`

4. **Set secrets** in the Render dashboard:
   - `RESPARK_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` (use Gmail App Password or SendGrid free tier)
   - `RESPARK_STRIPE_SECRET_KEY` / `_PUBLISHABLE_KEY` (from Stripe test mode to start)

5. **Deploy.** Render builds the Docker image, starts the service, gives you a URL.

### Render free tier limits
- Sleeps after 15 min of no traffic (wakes on next request, ~30s delay)
- 750 hrs/month compute
- 1 GB persistent disk (for SQLite)

**Sleep workaround:** set up [UptimeRobot](https://uptimerobot.com) (free) to ping your URL every 14 min - keeps it awake.

---

## Path 3 - Fly.io free tier (permanent, always-on, requires card)

**Time: 10 minutes.** Permanent URL `respark.fly.dev`. Always-on, no sleep.

```bash
# 1. Install flyctl
iwr https://fly.io/install.ps1 -useb | iex

# 2. Sign up (requires credit card but no charge for free tier)
fly auth signup

# 3. In respark/:
cd "%USERPROFILE%\Documents\Default Project\respark"
fly launch              # uses fly.toml, creates the app
fly secrets set RESPARK_SECRET=$(python -c "import secrets;print(secrets.token_urlsafe(48))")
fly secrets set RESPARK_SMTP_HOST=... RESPARK_SMTP_USER=... RESPARK_SMTP_PASS=...
fly deploy
```

**Free tier:**
- 3 shared VMs with 256MB RAM each
- Always-on, no sleep
- 3 GB persistent volume (for SQLite)
- Requires credit card on file (no charge unless you exceed free allowance)

**Best option if you have a card** - Render is equivalent but sleeps.

---

## What I recommend

**Tonight:** Path 1 (cloudflared via `start-with-tunnel.ps1`). 2 minutes, you're live.

**This week:** Path 2 or 3. Push to GitHub, deploy, get a permanent URL.

**When you make $497:** buy a $5 domain from Cloudflare Registrar, point it at your Render/Fly app.

Don't buy a domain yet - wait until you're making money.
