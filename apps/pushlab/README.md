# Push Lab — Beacon + Tether

**Send push notifications from your own server, and prove they work on a real phone.** It's zero-dependency (Python standard library only), self-hosted and free.

| | |
| --- | --- |
| **[Beacon](../beacon)** | Your own push service (like OneSignal / PushNotif). Web Push for every PWA, FCM for Capacitor Android apps, in-app banners, targeting, scheduling, stats, a console and MCP. |
| **[Tether](../tether)** | Your phone in the browser (like TapFlow, for Android on Windows). Live screen, record and replay QA flows, notification checks, CI, MCP. |
| **Push Lab** | Both, already linked, in one double-click. |

## Start (2 minutes)

1. Double-click `start-push-lab.bat` (or run `python apps/pushlab/pushlab.py`). The Beacon console and Tether open in your browser, already signed in.
2. In Tether, click **Install it for me** if it asks for adb. That's a one-time ~7 MB download from Google.
3. Connect a phone. Either plug it in with USB debugging on, or click **📶 Wi-Fi** (Android 11+, no cable).
4. In Tether, go to the **Push** tab and click **📲 Connect this phone to Beacon**. Tether opens Beacon on the phone and taps *Enable* and *Allow* for you.
5. Click **Send now**, or **+ full push QA steps**, then **Run**.

There's no HTTPS or deployment needed for testing. Tether forwards your local Beacon to the phone as `localhost` (`adb reverse`), and browsers treat that as secure.

## Ship it to real users

Deploy Beacon on HTTPS. It takes about 10 minutes with a Cloudflare Tunnel or Docker + Caddy: see [beacon/docs/DEPLOY.md](../beacon/docs/DEPLOY.md). Then add two lines to any of your apps (see the console's **Setup** tab). Keep Tether pointed at the deployed Beacon to test production pushes on your phone.

## Built on open source

| Project | Used for |
|---|---|
| [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) | Tether HD: 30 fps H.264 + instant input |
| [Maestro](https://github.com/mobile-dev-inc/maestro) (Apache-2.0) | Tether imports/exports Maestro YAML flows |
| [cloudflared](https://github.com/cloudflare/cloudflared) (Apache-2.0) | Beacon "Go live": public HTTPS in one click |
| [ntfy](https://github.com/binwiederhier/ntfy) (Apache-2.0) | Beacon channel: ntfy app topics |
| [Apprise](https://github.com/caronc/apprise) (BSD-2) | Beacon channel: Telegram/Slack/Discord/email… |
| [android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner) (Apache-2.0) | CI template |

All are optional downloads or optional pip installs — Beacon and Tether stay zero-dependency Python.

## What's verified

- **Automated:** about 165 checks — Beacon 70, Tether 65, Beacon×Tether integration 30. They cover the RFC 8291/8292 crypto known-answer vectors, decrypt-what-we-sent, FCM RS256, failure modes and the installer.
- **Live on this PC:**
  - **Push:** real pushes went through Microsoft's push service to Edge and appeared on screen, sent from Tether and delivered by Beacon.
  - **adb:** the one-click adb install worked through a corporate proxy.
- **Not yet verified:** a physical Android phone (none was attached) and FCM against a real Firebase project.
