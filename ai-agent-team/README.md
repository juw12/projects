# AI Agent Team — your daily vibe-coding crew

A small group of AI agents that run by themselves every day and ship a fresh,
ready-to-build product spec to your GitHub. **$0/month, forever.** No server
to babysit.

You read the spec once a day, paste the included *vibe-coding prompt* into
[Lovable](https://lovable.dev), [Bolt.new](https://bolt.new), or
[v0.dev](https://v0.dev), and you have a real working app by lunch.

```
9 AM (every day, automatic)
        |
        v
+---+---+---+---+
|   |   |   |   |   AI agents (Gemini, free tier)
+---+---+---+---+
  Idea -> Spec -> Saved -> Notified -> You build
```

---

## Quickstart — 5 steps, ~30 minutes total

You only do this **once**. After that the team runs by itself.

### Step 1 — Create a free GitHub account (if you don't have one)

Go to <https://github.com/signup>. Free forever, no card.

### Step 2 — Create a new repository

1. Go to <https://github.com/new>
2. **Repository name:** `ai-agent-team` (or anything you like)
3. **Important:** choose **Public** (not Private). GitHub gives unlimited
   free Actions minutes to public repos. Private repos cap at 2,000 minutes/month.
4. Leave everything else as default. Click **Create repository**.
5. On the next screen, copy the URL — it looks like
   `https://github.com/<your-username>/ai-agent-team.git`

### Step 3 — Push this folder to your new repo

Open PowerShell in this `ai-agent-team` folder and run:

```powershell
cd "C:\Users\juwen_lie\Documents\Default Project\ai-agent-team"

git init
git add .
git commit -m "initial agent team setup"
git branch -M main
git remote add origin https://github.com/<your-username>/ai-agent-team.git
git push -u origin main
```

(Replace `<your-username>` with your actual GitHub username. GitHub will ask
you to log in the first time.)

### Step 4 — Get a free Gemini API key

1. Go to <https://aistudio.google.com/app/apikey>
2. Sign in with any Google account
3. Click **Create API key** → **Create API key in new project**
4. Copy the long string it gives you (starts with `AIza...`)

### Step 5 — Add the key as a GitHub secret

1. In your GitHub repo, click **Settings** (top tab)
2. In the left sidebar: **Secrets and variables → Actions**
3. Click **New repository secret**
4. Fill in:
   - **Name:** `GEMINI_API_KEY`
   - **Secret:** paste the `AIza...` key
5. Click **Add secret**

That's it. Your agents are now permanent-alive.

---

## Run it for the first time (to verify it works)

1. In your GitHub repo, click the **Actions** tab
2. In the left sidebar click **Daily AI Agent Team**
3. On the right, click **Run workflow → Run workflow** (green button)
4. Wait ~30 seconds
5. Click into the running workflow to see logs
6. When it finishes, go to the **`specs/`** folder in your repo — you'll see
   a new `YYYY-MM-DD.md` file with today's product spec 🎉

---

## What you get every morning

You'll find today's spec in two places:

1. **`specs/YYYY-MM-DD.md`** — the human-readable product spec, ready to
   paste into a vibe-coding tool
2. **`specs/YYYY-MM-DD.json`** — the same data in JSON, in case you want
   to build automations on top later

The bottom of every spec has a **Vibe-coding prompt** section. Copy that
paragraph, paste it into Lovable / Bolt / v0, and a working app appears.

---

## (Optional) Get email notifications too

By default, you'll only see the spec when you open GitHub. To get an email
every morning:

1. In Gmail, turn on 2-Step Verification
   (<https://myaccount.google.com/security>)
2. Create an App Password
   (<https://myaccount.google.com/apppasswords> — name it `ai-agent-team`)
3. Back in your GitHub repo → **Settings → Secrets and variables → Actions**,
   add these four secrets:

| Secret name         | Value                              |
|---------------------|------------------------------------|
| `SMTP_USER`         | your Gmail address                 |
| `SMTP_APP_PASSWORD` | the 16-char App Password           |
| `SMTP_HOST`         | `smtp.gmail.com`                   |
| `SMTP_PORT`         | `465`                              |
| `NOTIFY_EMAIL`      | the address that should receive it |

The next morning you'll have an email titled
`[AI Agent Team] YYYY-MM-DD — <Idea Title>` waiting for you.

---

## Customizing what gets built

### Change the kinds of products

Open `agents/idea_agent.py` and edit the **`PRODUCT_CATEGORIES`** list.
Add or remove anything you want. Examples:

```python
PRODUCT_CATEGORIES = [
    "a tiny SaaS tool for Etsy sellers",
    "a personal budget tracker for couples",
    "a daily writing prompt generator for fiction authors",
    "an Airbnb host's guest-message template builder",
]
```

The agent will pick a random category each day and generate an idea in that space.

### Change the schedule

Open `.github/workflows/daily-agent.yml` and edit the `cron:` line. Examples:

| Cron           | When it runs (UTC)            |
|----------------|-------------------------------|
| `"0 9 * * *"`  | 9 AM UTC (5 PM Taiwan)        |
| `"0 0 * * *"`  | midnight UTC (8 AM Taiwan)    |
| `"0 14 * * *"` | 2 PM UTC (10 PM Taiwan)       |

GitHub Actions can be a few minutes late. If you need exact timing, this is
fine for "morning review" workflows.

### Change the AI model

Default is `gemini-2.5-flash` (fast, free, good). To use a different one, add
a GitHub variable:

1. Repo → **Settings → Secrets and variables → Actions → Variables tab**
2. **New variable:** name `GEMINI_MODEL`, value e.g. `gemini-2.5-pro`

---

## Running it locally (for testing)

```powershell
cd "C:\Users\juwen_lie\Documents\Default Project\ai-agent-team"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Open .env in Notepad and paste your GEMINI_API_KEY, then save
python run_daily.py --dry-run    # just prints an idea, no save/commit/email
python run_daily.py              # full run, saves to specs/, commits to git
```

---

## Troubleshooting

**"GEMINI_API_KEY is not set"**
→ The secret isn't in GitHub yet, or you used a typo name. Go back to Step 5.

**Workflow shows red X in Actions tab**
→ Click into the failing run, scroll to the red step, read the error. The
log line includes a `FATAL:` prefix from our agents that explains what failed.

**I get an email saying "daily: ..." but specs/ folder is empty**
→ The commit step needs `permissions: contents: write` (already set). If
you forked from somewhere, double-check the workflow file wasn't modified.

**Email isn't arriving**
→ Test locally first (`python run_daily.py` with SMTP secrets in `.env`).
If it works locally but not on GitHub, the secrets probably have a typo.

**Rate limit hit**
→ Gemini free tier = 60 requests/minute. We're well under that, but if
you trigger the workflow manually many times in a row you may hit it. Wait
60 seconds and try again.

---

## What's next (when you're ready)

Once the daily spec loop is humming, here are easy upgrades:

| Upgrade                            | Effort  | What it adds                              |
|------------------------------------|---------|-------------------------------------------|
| **Auto-deploy specs to Vercel**    | 10 min  | Every spec becomes a live landing page    |
| **Add a Builder agent**            | 30 min  | Agent writes the actual app code, not just a spec |
| **ntfy.sh push notifications**     | 5 min   | Free phone push, no Gmail setup           |
| **Oracle Cloud free VM + Ollama**  | 1 hour  | Run a private LLM locally, zero API cost  |
| **Telegram/Discord bot for review**| 30 min  | Approve / reject ideas from your phone    |

Just ask and we'll wire any of these in.

---

## File layout

```
ai-agent-team/
├── .github/workflows/daily-agent.yml   # The cron schedule that runs everything
├── agents/
│   ├── idea_agent.py                   # "What should we build today?"
│   └── pm_agent.py                     # "Write the build spec for that idea."
├── specs/                              # Output: one .md + one .json per day
├── logs/daily.log                      # What happened on each run
├── run_daily.py                        # Orchestrator: runs both agents, saves, notifies
├── requirements.txt                    # Python dependencies
├── .env.example                        # Template for local secrets
├── .gitignore                          # Don't commit .env or cache files
└── README.md                           # You are here
```

---

## License

MIT — do whatever you want with this.
