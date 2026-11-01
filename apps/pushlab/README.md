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

## Agent skills (Claude Code, Codex, any SKILL.md agent)

[`plugin/`](plugin) packages three [Agent Skills](https://github.com/anthropics/skills) with a zero-dependency
CLI (`scripts/pushlab_cli.py`) that finds this lab's keys by itself:

| Skill | For |
| --- | --- |
| `tether-android-qa` | look → act → verify on a phone, Maestro/Tether flows, logcat, perf budgets, screen recording |
| `beacon-push` | send pushes, digest bursts, fallback to ntfy/Bark/Gotify/Apprise, delivery stats |
| `push-qa-e2e` | send via Beacon → assert it shows on the phone → tap → verify, with video evidence |

```text
# Claude Code
/plugin marketplace add juw12/projects
/plugin install push-lab@juw12-projects

# other agents: copy apps/pushlab/plugin/skills/* into the agent's skills folder
# (e.g. ~/.codex/skills/ or .claude/skills/), or use `npx skills add juw12/projects`
```

The marketplace file is [`/.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json). Tether's MCP
server additionally speaks [mobile-mcp](https://github.com/mobile-next/mobile-mcp)'s tool names, so mobile-mcp
prompts work against it too.

## Built on open source

| Project | Used for |
|---|---|
| [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) | Tether HD: 30 fps H.264 + instant input |
| [Maestro](https://github.com/mobile-dev-inc/maestro) (Apache-2.0) | Tether imports/exports Maestro YAML flows |
| [cloudflared](https://github.com/cloudflare/cloudflared) (Apache-2.0) | Beacon "Go live": public HTTPS in one click |
| [ntfy](https://github.com/binwiederhier/ntfy) (Apache-2.0) | Beacon channel: ntfy app topics |
| [Apprise](https://github.com/caronc/apprise) (BSD-2) | Beacon channel: Telegram/Slack/Discord/email… |
| [Bark](https://github.com/Finb/Bark) (MIT) | Beacon channel: native iPhone pushes (bark-server API v2) |
| [Gotify](https://github.com/gotify/server) (MIT) | Beacon channel: self-hosted push server + Android app |
| [Gatus](https://github.com/TwiN/gatus) (Apache-2.0) | uptime checks → Beacon alerts via `/v1/hooks/gatus` |
| [SoloPi](https://github.com/alipay/SoloPi) (Apache-2.0) | metric set for Tether's perf tools (startup, memory, jank, CPU) |
| [android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner) (Apache-2.0) | CI template |
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) (Apache-2.0) | tool names/arguments Tether's MCP server is compatible with |
| [Agent Skills](https://github.com/anthropics/skills) format | the `plugin/` skills pack |
| [Ollama](https://github.com/ollama/ollama) (MIT) or any OpenAI-compatible server | optional Tether AI steps |
| [ARTEMIS](https://github.com/google/artemis) (Apache-2.0) | optional engine for Tether AI steps (Flash/Pro agents); its "explore, then write deterministic tests" mindset in the QA skill |

All are optional downloads or optional pip installs — Beacon and Tether stay zero-dependency Python.

## What's verified

- **Automated (all hermetic, no phone needed):** 607 checks — Beacon 72 API + 40 channels + 36 Bark/Gotify + 28 Gatus hook + 22 tunnel
  + 25 crypto + 23 workflows; Tether 65 API + 30 Beacon link + 62 Maestro + 36 HD (+7 in headless Edge: WebCodecs
  decode, clicks, WebM and MP4 recording) + 52 mobile-mcp/recording/clipboard + 26 AI steps + 18 ARTEMIS engine
  + 39 perf; Push Lab plugin 26
  (manifests, SKILL.md and the CLI end to end against real Beacon + Tether).
- **Live on this PC:**
  - **Push:** real pushes went through Microsoft's push service to Edge and appeared on screen, sent from Tether and delivered by Beacon. ntfy.sh publish and Apprise 2.1.0 worked through the corporate proxy.
  - **adb:** the one-click adb install worked through a corporate proxy.
- **Not yet verified:** a physical Android phone (none was attached) — so HD, screen recording, clipboard and
  AI steps (built-in and ARTEMIS) ran only against the fake adb/scrcpy device, a fake model server and a fake ARTEMIS daemon; FCM against a real Firebase
  project; the plugin installed into a real Claude Code / Codex session.
