# Setup Checklist - Respark

5 things you must do yourself (and how).

I automated everything I can. The 5 things below all require **your** hands on the keyboard - credentials, account creation, verification. Each takes 1-5 minutes.

Once done, the system runs itself.

---

## 1. (Optional) Install a tunnel tool - only if you want a public URL right now

The `start-with-tunnel.ps1` script auto-installs **cloudflared** via winget if neither cloudflared nor ngrok is present. No signup, no account.

If you want to do it manually:

```
winget install Cloudflare.cloudflared
```

That's it. No account, no authtoken, no signup. `cloudflared tunnel --url http://localhost:8000` gives you a `https://xxx.trycloudflare.com` URL.

If you'd rather use ngrok:

```
1. Download:  https://ngrok.com/download
2. Sign up:   https://dashboard.ngrok.com/signup   (free, no card)
3. Copy your "Authtoken" from the dashboard
4. Run in PowerShell:  ngrok config add-authtoken YOUR_TOKEN_HERE
```

---

## 2. Gmail SMTP setup (3 min) - for sending real emails

**Why:** so Respark can actually send cold emails and reactivation campaigns (otherwise it logs them to a file).

### Easiest path: Gmail

```
1. Enable 2-Step Verification on your Google account
   https://myaccount.google.com/security
2. Create an App Password
   https://myaccount.google.com/apppasswords
   - App: "Mail", Device: "Other (Respark)" - name it "Respark"
   - Google shows you a 16-character password
3. Put these in your .env:
   RESPARK_SMTP_HOST=smtp.gmail.com
   RESPARK_SMTP_PORT=587
   RESPARK_SMTP_USER=your.email@gmail.com
   RESPARK_SMTP_PASS=the-16-char-app-password
   RESPARK_SMTP_FROM="Respark <your.email@gmail.com>"
```

Free tier: 500 emails/day, plenty for cold outreach + first few clients.

### Alternative: SendGrid (better for high volume)

```
1. Sign up at https://sendgrid.com (free, 100 emails/day forever)
2. Settings - API Keys - Create - "Respark"
3. Settings - Sender Authentication - verify a sender
4. Put in .env:
   RESPARK_SMTP_HOST=smtp.sendgrid.net
   RESPARK_SMTP_PORT=587
   RESPARK_SMTP_USER=apikey
   RESPARK_SMTP_PASS=SG.your-api-key-here
   RESPARK_SMTP_FROM="Respark <hello@yourdomain.com>"
```

---

## 3. Stripe setup (5 min) - for collecting payments

**Why:** so clients can pay you $497 + $97/mo via the checkout flow.

```
1. Sign up at https://dashboard.stripe.com/register (free, no card to start)
2. Switch to Test mode (top-right toggle) for development
3. Get your API keys:
   Developers - API keys
   - Publishable key: pk_test_xxxx
   - Secret key:      sk_test_xxxx
4. Create 2 products:
   Products - Add product
   - "Respark Starter" - One-time - $497 USD
   - "Respark Growth" - Recurring - $97 USD / monthly
5. Copy each product's Price ID (price_xxxx)
6. Put in .env:
   RESPARK_STRIPE_SECRET_KEY=sk_test_xxxx
   RESPARK_STRIPE_PUBLISHABLE_KEY=pk_test_xxxx
   RESPARK_STRIPE_PRICE_STARTER=price_xxxx
   RESPARK_STRIPE_PRICE_GROWTH=price_xxxx
7. Set up webhook (only after you deploy):
   Developers - Webhooks - Add endpoint
   URL: https://your-public-url/webhooks/stripe
   Events: checkout.session.completed, customer.subscription.created,
           customer.subscription.updated, customer.subscription.deleted
   Copy the signing secret - RESPARK_STRIPE_WEBHOOK_SECRET=whsec_xxxx
```

When you switch to Live mode, repeat steps 3, 6, 7 with `sk_live_*` keys.

---

## 4. Run it (1 min)

After steps 2-3, launch:

```powershell
cd "%USERPROFILE%\Documents\Default Project\respark"
.\start-with-tunnel.ps1
```

The script auto-installs cloudflared if needed, starts the tunnel, captures the public URL, writes it into `.env`, then launches the server.

Open it in your browser. Sign up. You're inside.

---

## 5. (Optional) Cloud deploy for permanent URL - when ready

Once you've sent your first 10 cold emails and want a URL that doesn't depend on your laptop:

```
1. Push code to GitHub:
   cd "%USERPROFILE%\Documents\Default Project"
   git add respark/
   git commit -m "respark: initial build"
   gh repo create respark --public --source=respark --push

2. Sign up at https://render.com (free, GitHub login, no card)

3. New - Blueprint - point at the repo - it reads render.yaml - deploys

4. Add your .env secrets to the Render dashboard

5. You get respark.onrender.com - permanent URL
```

---

## What I automated for you (no action needed)

- Server code (server.py): all backend logic, 43 tests passing
- Static UI: landing page, client dashboard, outreach pipeline
- Database schema: SQLite, auto-created on first run
- Cold email templates: 7 industries, 3-step sequences
- Customer reactivation templates: 7 industries, 5-step sequences
- Stripe checkout: wired and tested
- Background scheduler: sends + tracks everything automatically
- Tracking pixels: opens auto-update lead status
- Unsubscribe links: TCPA/CAN-SPAM compliant
- Docker config: ready for Render/Fly.io
- One-click launchers: `start.bat` + `start-with-tunnel.ps1`

## What's NOT automated (and why)

- **Account creation** (cloudflared/ngrok, Stripe, Gmail, Render): need email verification + your identity
- **Credit card on file** (Fly.io): some platforms require it; cloudflared and Render don't
- **Domain DNS config**: but you don't need a domain until you're making money

---

## Order of operations - fastest path to first dollar

1. **Today (15 min):** install cloudflared, do Gmail setup, launch via `start-with-tunnel.ps1`
2. **Today (15 min):** sign up for Stripe, get test API keys, put in .env
3. **Today (15 min):** find 25 prospects on Google Maps, paste CSV into `/outreach`, start sending
4. **This week:** when first prospect replies, mark them "Interested" in dashboard, call them
5. **This week:** when they say yes, click "Close + onboard" - they pay you via Stripe Checkout
6. **When you have $497:** buy a $5 domain, deploy to Render, switch Stripe to live mode

That's the whole plan. The system does 95% of the work. You do 5% (account setup + sales calls).
