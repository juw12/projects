# Glow Hands

Lets GlowLead use a real browser on your PC: open sites, click, type, choose options and fill
forms, one action at a time, in its own window that you can watch and take over.

## Install on any Windows PC (one step, no admin)

Press **Win + R**, paste this, press Enter:

```
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/install-glow-hands.ps1 | iex"
```

It finds or installs Python, installs Glow Hands into `%LOCALAPPDATA%\GlowHands`, picks a free port
(8765-8770), starts it now and at every login, then opens GlowLead. Windows asks
**"Glow Hands: allow this browser?"**. Click **Yes**, and that browser is connected for good:
no address or code to type. Running the same command again updates Glow Hands and keeps the pairing.

Already installed? In GlowLead click **Connect browser control**; it finds Glow Hands and asks the same Yes/No.

Why one Yes click remains: every app on `juw12.github.io` shares one web origin, including third-party
games. The Windows prompt makes sure only you, at this PC, can let a page control the Glow Hands browser.
Declining sets a 20-second cooldown so a page cannot spam prompts.

Manual option: run `python glow_hands.py --channel msedge` and paste the printed pairing code under
"Connect manually with a pairing code".

Phones cannot use Glow Hands: it runs on a PC, and phones cannot reach a program on your PC this way.

## Safety

- Listens only on `127.0.0.1`; every action needs the pairing token (stored in
  `%LOCALAPPDATA%/GlowHands/pairing-token.txt`). Only the Glow web app and localhost may call it.
- **Always asks you first** before clicks that may submit, buy, pay, send, post, book, sign up or
  delete, and before Enter inside a form. GlowLead shows Approve / Decline; Stop cancels.
- **Never types passwords, card numbers or one-time codes.** When needed, GlowLead asks you to
  type them in the Glow Hands window, then continue.
- Separate browser profile: it only has logins you give it. Blocks `file:`, local-network and
  loopback pages unless started with `--allow-private`.
- Page content is treated as untrusted; the AI is told not to follow instructions on web pages.
  The approval gate is the real protection, so read each request before approving.

## Limits

Up to 15 actions per step. Free AI models are weaker at multi-page tasks than paid agents; complex
sites, captchas and heavy JavaScript apps can fail. It controls the browser only, not desktop apps.
It runs while your PC and the program are on; it is not an always-on cloud service.
