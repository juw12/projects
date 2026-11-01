---
name: push-qa-e2e
description: End-to-end push notification QA on a real Android device - subscribe the phone to Beacon through Tether, send a push, assert it appears in the notification shade, tap it and verify the app or page it opens, with screen recording as evidence. Use when asked to verify that push notifications actually reach and work on a phone.
---

# Push QA end to end

Combines Tether (device control) and Beacon (sending) through
`scripts/pushlab_cli.py`. Run everything from the repository root or set
`TETHER_URL`/`TETHER_TOKEN`/`BEACON_URL`/`BEACON_KEY`.

## 1. Preconditions

1. `python scripts/pushlab_cli.py status` - Tether and Beacon both reachable,
   one device with `state: "device"`, and `beacon.app` present. If not, ask the
   user to run `python apps/pushlab/pushlab.py` and plug in a phone.
2. The phone must be subscribed once: in Tether open the Push tab and click
   "Connect this phone to Beacon" (it opens Beacon's subscribe page in Chrome via
   `adb reverse` and taps Enable + Allow). Ask the user if this has not been done.

## 2. Run the check

```
python scripts/pushlab_cli.py record start
python scripts/pushlab_cli.py push-check --title "QA ping 1234" --body "hello" --tap --timeout 45
python scripts/pushlab_cli.py record stop --out push-qa.mp4
```

Use a unique title (add a number or timestamp) so an old notification cannot
produce a false pass. `push-check` exits 0 only when a notification whose title
contains the text shows up on the device; the JSON includes Beacon's delivery
counts, the notification as the phone shows it and the seconds it took.

## 3. Verify what the tap opened

After `--tap`, run `python scripts/pushlab_cli.py ui` (or `screenshot`) and check
that the expected page or app screen is in front. `apps` shows the foreground
activity.

## 4. Report

State pass or fail for each stage - sent by Beacon, delivered to the push
service, shown on the device, opened the right place - with the latency and
attach the MP4. Typical failures:

- Sent but never shown: the phone's browser lost its subscription (resubscribe),
  notifications are blocked for Chrome in Android settings, or Do Not Disturb is on.
- `targeted == 0`: the phone was subscribed with other tags; the default tag is
  `qa:device`.
- Shown but the tap opens the wrong page: check the `--url` sent with the push.
