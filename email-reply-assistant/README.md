# Email Reply Assistant

A personal email-reply assistant for Juwen Lie's Outlook account. The agent
reads your Inbox, drafts replies in your authentic voice (learned from
6,400+ past sent items), and saves them to your Outlook **Drafts** folder.
**Nothing sends without your approval.**

## How you use it

Just ask in OpenCode. Examples:

> "process my inbox — generate replies for the last 7 days"

> "draft a reply to the email from Leo哥 about the Lory issue"

> "give me a draft for the email I just forwarded"

The agent will:
1. Read the email(s) from your Outlook
2. Draft a reply using your voice profile (sign-off, greetings, length, tone, bilingual rules)
3. Show you the proposed draft (To / CC / Subject / Body)
4. Wait for your approval
5. On approval → save to **Outlook Drafts** (not sent)
6. You open Outlook desktop → review the draft → edit if needed → tap Send

That final tap on Send in Outlook is your human gate.

## Voice profile (the captured skill)

`~/.config/opencode/skills/outlook-reply-style/SKILL.md` (10 KB) auto-loads whenever you ask for email help. Encodes:

- Greetings: `Hi All,` / `Hi <Name>,` / `Hi <Name>哥，` (peer-honorific)
- Closings: `謝謝 / BR / Juwen` (Chinese recipients) or `Best Regards, / Juwen` (English)
- Openings: `如下匯整…`, `更新…進度`, `附檔…`, `FYI`
- Body structure: numbered lists for action items, `*` bullets for features, `A./B.` sections for vendor requests
- Length: 100–800 chars for status, 2,000–5,000 chars for vendor formal requests
- Bilingual: Chinese for status/descriptions, English for names/products
- Anti-patterns: no "Hope this finds you well", no padding, never one-line sign-off

## Architecture

| File | Purpose |
|---|---|
| `~/.config/opencode/skills/outlook-reply-style/SKILL.md` | The voice profile (auto-loaded by agent) |
| `email-reply-assistant/data/sent_items_slim.json` | 6,416-message corpus used to build the profile (27 MB) |
| `email-reply-assistant/scripts/export_sent_items.py` | Re-export corpus when voice feels stale |
| `email-reply-assistant/scripts/generate_icons.py` | PWA icons generator (PIL) — only needed if you set up the iPhone PWA |
| `email-reply-assistant/backend/app.py` | Stdlib HTTP server with 7 endpoints — for iPhone PWA (currently unused; see "Optional iPhone PWA" below) |
| `email-reply-assistant/templates/` + `static/` | PWA frontend — only needed if you set up the iPhone PWA |

## Why no iPhone PWA in the default flow

You originally asked for an iPhone approval UI. We built one (537-line vanilla JS + 433-line CSS, installable, dark-mode, service worker). The corporate proxy (Forcepoint) at your office blocks every public tunnel service (Cloudflare, ngrok, localhost.run, bore.pub), so the PWA is reachable only from the same Wi-Fi as your PC. You decided that's not useful — the Outlook desktop workflow above covers the same need with zero extra setup. **The PWA code is kept in the repo** in case you later set up a tunnel (e.g., Tailscale after admin approval, or ngrok from your home network).

### Optional iPhone PWA (if you ever get a tunnel)

If you set up a tunnel to your PC's port 8000 (e.g., from a non-corp network or via admin-approved Tailscale), you can run the PWA:

```bat
run.bat
```

Then point the tunnel at `http://localhost:8000` and open the public URL on your iPhone Safari → Add to Home Screen.

## Re-running the voice profile

After several months of new emails, you can re-capture the profile:

```bat
python scripts\export_sent_items.py --output data\sent_items_full.json
```

Then ask me to re-analyze and update the skill.

## Security notes

- The agent runs only on your PC (COM access requires Outlook to be installed and signed in locally).
- Drafts are saved via COM to your Outlook Drafts folder — standard Outlook behavior, no special permissions.
- No external API calls are made. No email leaves your machine until you tap Send in Outlook desktop.
- The PWA backend (if used) only listens on your local network. If you expose it via tunnel, anyone with the tunnel URL can see your inbox. Don't share tunnel URLs.
