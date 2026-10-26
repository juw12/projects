# Glow Hands

Lets GlowLead use a real browser on your PC: open sites, click, type, choose options and fill
forms, one action at a time, in its own window that you can watch and take over.

## Install on any Windows PC (one step, no admin)

Press **Win + R**, paste this, press Enter:

```
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/install-glow-hands.ps1 | iex"
```

It finds or installs Python, installs Glow Hands into `%LOCALAPPDATA%\GlowHands`, picks a free port
(8765-8770), starts it now and at every login, then opens GlowLead, which connects by itself. Nothing to
type or approve outside the app. Running the same command again updates Glow Hands and keeps the pairing.

Already installed? In GlowLead click **Connect browser control**; it finds Glow Hands and connects in one click.
(Your browser may ask once to allow local network access; that prompt comes from the browser, not Glow.)

## Use it from your phone

On the PC: GlowLead > **Connect browser control** > **Show QR code**. Scan it with the phone camera and
open the link. That phone is linked for good; missions you start on the phone that use the browser run in
Glow Hands on the PC. The PC must be on, online, and running Glow Hands (it starts at login).

How it works: Glow Hands runs a hidden helper page that waits for your phone on the free PeerJS service.
The phone and PC then talk over an encrypted WebRTC connection (direct, or through PeerJS's relay when a
network blocks direct links). The phone must prove it knows a secret from the QR code (HMAC challenge)
before any command is passed on, and only `status`, `observe` and `act` are allowed. **Turn off old phone
links** creates a new secret and disconnects every phone linked before.

## When your PC is off

- **Cloud browser:** tap **Start cloud browser** in GlowLead on your phone. It runs Glow Hands on GitHub
  Actions for up to 20 minutes, then stops by itself.
- **Always-on server:** run Glow Hands on a free Oracle Cloud VM (or any Linux box) with
  `install-glow-hands-linux.sh`, then scan the QR code it prints.

Setup and trade-offs: [CLOUD.md](CLOUD.md).

## Security trade-offs (please read)

- All apps on `juw12.github.io` share one web origin and one browser storage. A page there (including any
  third-party game in gamelib) could ask Glow Hands to connect or read a saved connection. Keep untrusted
  code off that address, or start Glow Hands with `--confirm-pairing` to bring back the Windows Yes/No prompt.
- Anyone who gets your phone link can control the Glow Hands browser. Share it only with your own phone;
  use **Turn off old phone links** if it leaks.
- Glow Hands still never types passwords, card numbers or one-time codes, uses its own browser profile, and
  blocks local-network pages. Use `--no-phone` to turn phone access off.

Manual option: run `python glow_hands.py --channel msedge` and paste the printed pairing code under
"Connect manually with a pairing code".

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
