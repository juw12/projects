# Glow Hands

Lets GlowLead use a real browser on your PC: open sites, click, type, choose options and fill
forms, one action at a time, in its own window that you can watch and take over.

## Start it (Windows)

1. Install Python 3.10 or newer.
2. Double-click `start-glow-hands.cmd`. It installs Playwright on first run and uses Microsoft
   Edge, so no extra browser download is needed.
3. Copy the pairing token it prints. In GlowLead open **Glow Hands → Connect browser control**,
   paste it and press **Save & test**. If the browser asks to allow local-network access, allow it.
4. On a mission, tick **Let Glow Hands use my browser**.

Other systems: `pip install playwright`, then `python glow_hands.py --channel chrome`
(or `python -m playwright install chromium` and run without `--channel`).

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
