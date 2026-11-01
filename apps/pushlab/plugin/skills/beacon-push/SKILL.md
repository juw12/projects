---
name: beacon-push
description: Send and inspect push notifications with a self-hosted Beacon server - Web Push, Firebase (FCM), ntfy, Bark (iPhone), Gotify, Apprise (Slack, Telegram, email, ...) and in-app inbox - and check delivery status and stats. Use when asked to send a notification, test a push campaign, or debug why a push was not delivered.
---

# Beacon push

Beacon is a self-hosted push service. `scripts/pushlab_cli.py` (standard
library only) talks to its sender API with the app secret (`sk_...`).

## Configure

`python scripts/pushlab_cli.py status` shows what is configured. The CLI reads
`BEACON_URL` and `BEACON_KEY` from the environment, or the Push Lab file
`apps/pushlab/.pushlab/lab.json` written by `python apps/pushlab/pushlab.py`.
Never print or commit the secret.

## Send and confirm delivery

```
python scripts/pushlab_cli.py push --title "Order shipped" --body "Arrives Tuesday" \
    --url https://example.com/orders/42 --tag beta
```

- Targets: `--tag` (repeatable) reaches subscribers with any of those tags.
  Without a tag the message goes to every subscriber of the app.
- Channels: `--channel webpush|fcm|ntfy|bark|gotify|apprise|inapp` (repeatable) limits the
  transports; default is all.
- The command waits until Beacon finishes and exits 1 unless the message is
  `sent` with `delivered > 0`. Read `failed` and `pruned` (dead subscriptions
  removed) in the JSON.

## Batch bursts and escalate unread messages

- Digest: `--digest-key post-42 --digest-window 600` folds every send with that
  key in the next 10 minutes into one notification ("3 new notifications",
  newest items in the body). Use it for chatty events (comments, likes, alerts).
- Fallback: `--channel inapp --fallback-channel ntfy --fallback-after 3600`
  sends in-app first and re-sends on ntfy if nobody clicked within an hour
  (`--fallback-unless shown|delivered` changes the condition). The check is per
  message, not per recipient.

## Diagnose

- `beacon-messages --limit 20` shows recent messages with status and counts.
- `beacon-stats --days 7` gives sent, delivered, failed, opened and clicked totals.
- `delivered == 0` with `targeted == 0`: nobody matches the tags. Subscribe a
  device first (see the push-qa-e2e skill) or drop `--tag`.
- `failed > 0` on webpush: the browser subscription expired or the VAPID keys
  changed; the subscriber resubscribes on its next visit.
- Payload errors (400 "notification too large"): shorten title, body or data
  (Web Push allows about 4 KB).

## Good notification copy

Keep titles under about 50 characters and bodies under about 120 so they are
not truncated on Android. Put the action in the title, the detail in the body,
and always set `--url` to the screen the user should land on.
