# Glow — From a spark to something real

**Glow** is a small ecosystem of free browser AI apps that share one account:

| App | What it is | Link |
|---|---|---|
| **Glow** (home) | Start here: one box to ask or delegate, recent chats and missions, all apps | https://juw12.github.io/projects/glow/ |
| **GlowChat** | Chat, Council with a Judge, and Arena comparisons to explore ideas and review plans | https://juw12.github.io/projects/glow/chat/ |
| **GlowRoom** | A virtual office of AI agents (formerly Crewroom) that research, write code and make media for a mission | https://juw12.github.io/projects/glow/room/ |
| **Profile & settings** 👤 | Your name, avatar, Puter account, persona, usage and data, shared by every Glow app (avatar at the top right) | https://juw12.github.io/projects/glow/account/ |
| **GlowLead** 👑 | The AI lead (orchestrator) and owner of GlowRoom: plans a goal, delegates the steps to GlowChat and the GlowRoom crew, checks the work and reports | https://juw12.github.io/projects/glow/lead/ |

GlowChat installable app: `glow/chat/app.html`, mobile: `glow/chat/mobile.html`. GlowRoom: `glow/room/app.html`, `glow/room/mobile.html`.
AI-suggested resources in GlowChat are not automatically browsed or verified; GlowChat does no autonomous building or execution (that is GlowRoom's job, and its results should still be reviewed).

## What's new

- **1.22.0** – **Glow everywhere, even offline.**
  - **Glow Offline (on-device AI)**: GlowChat → Settings → *Offline AI on this device* downloads a small open model once (Glow Offline Mini ≈ 0.3 GB, Standard ≈ 0.9 GB, Plus ≈ 1.7 GB; Qwen2.5 Instruct via WebLLM 0.2.86, vendored in `web/shared/vendor/`), then GlowChat keeps answering with no internet: with no connection a chat set to a cloud model is answered by Glow Offline and labelled as such, and the model can also be picked directly. Runs on the GPU in a worker (WebGPU: recent Chrome/Edge on PC and Android, Safari 26 on iPhone/iPad). The model comes from Hugging Face, or ModelScope when that is unreachable (mainland China tries ModelScope first), and is stored in the browser, never on a Glow server. Code: `web/shared/glow-offline-ai.js`, `glow-offline-engine.js`, `glow-offline-worker.js`.
  - **Free iPhone/iPad app**: Glow installs from Safari to the Home Screen with its own icon, launch screens and offline storage (no App Store, no fee); the Glow apps menu shows a step-by-step *Add to Home Screen* sheet on iOS.
  - **Every Glow app opens offline** after one visit (Glow, GlowChat, GlowRoom, GlowLead, Profile, Setup, Download); pages are network-first and fall back to the saved copy after 4 s on a slow connection. Caches: `glowhome-v6`, `glowchat-v12`, `glowroom-v14`, `glowlead-v22`.
  - **Download page** `glow/download/` picks the right install for the visitor's device (Windows `Glow-Setup.exe`, Android APK, iPhone/iPad, Mac, Linux) and explains offline use.
  - **Findable by search engines**: titles, descriptions, Open Graph image, `SoftwareApplication` structured data, `sitemap.xml`, and IndexNow pings (Bing, Yandex, Seznam, Naver…) after each Pages deploy (`tools/indexnow.py`, `.github/workflows/glow-indexnow.yml`). Google needs a one-time Search Console verification by the owner.
  - **Limits**: Glow Offline needs WebGPU and enough GPU memory (WebLLM's figures: Mini ≈ 1 GB, Standard ≈ 1.6–1.9 GB, Plus ≈ 2.5–2.9 GB); the first answer after opening can take a minute or more while the model loads onto the GPU (GlowChat starts loading it when you click the message box); small models are less capable than the cloud ones; the one-time download is blocked on networks that block Hugging Face and ModelScope; GlowRoom crews, web research and image generation still need the internet. Test: `tests/test_glow_offline.py` (static, offline browser checks, and an on-device GPU check with `GLOW_OFFLINE_MODEL_DIR`).
- **1.21.0** – **Language & region.** On first open every Glow app asks for your language (English, Bahasa Indonesia, 简体中文, 繁體中文) and where you are (suggested from the device's language and time zone; change it any time from 🌐 in the menus, Profile & settings or the home footer).
  - **Whole UI translated**: GlowChat, GlowRoom, GlowLead, Profile and Setup (846 phrases + number patterns). A small runtime translator swaps UI text and never touches chat messages, chat titles, mission results or what you type. Phrase lists: `tools/i18n/*.txt` (English || Indonesian || Simplified Chinese); `python apps/glow/tools/build_i18n.py` builds `web/shared/i18n/ui.<lang>.js` and generates Traditional Chinese (Taiwan wording) with OpenCC.
  - **Models per region**: mainland China shows only providers that serve China (DeepSeek, Qwen, GLM, Kimi, MiniMax, Seedream) plus open-weight GPT-OSS/Llama; Hong Kong & Macau hide OpenAI, Claude and Gemini; Taiwan, US, EU and Australia mark DeepSeek ⚠. **Work or government device** mode hides DeepSeek instead. Rules: `REGIONS` in `web/shared/glow-locale.js`.
  - **China**: PIPL cross-border consent before first use, Chinese privacy notice, DeepSeek/Qwen/Kimi/GLM key presets in GlowChat Settings (data stays with the Chinese provider), mainland naming for mainland readers, and a configurable China-reachable cloud endpoint. What still needs a company/lawyer (ICP, CAC filing, labelling) is in `docs/CHINA.md`.
  - **Also**: EU GDPR notice and confirmation, per-region privacy notes (`privacy.html#cn`, `#eu`, `#id`, `#tw`…), Glow Pro price in your currency (≈, rates of 28 Oct 2026), answers use your language and local context, voice input uses your language, flags hidden on Windows (it can't draw them). Test: `tests/test_glow_locale.py`.
- **1.20.2** – GlowChat shows a "Thinking…" indicator with an elapsed timer while a model works (also in Arena and fused answers), so slow models like Glow Free no longer look stuck.
- **1.20.1** – An expired Puter session now shows as signed out in every app (grey avatar, "Sign in again") instead of looking signed in; Profile & settings keeps your account name.
- **1.20.0** – **Profile & settings** for every Glow app: the avatar at the top right (GlowChat: sidebar) opens your name and avatar colour, Puter sign in/switch/out, persona, token usage and monthly allowance, settings, data export/delete and updates (`glow/account/`). GlowRoom got one Glow-style top bar and the warm **Glow Studio** office.
- **1.19.x** – Models ranked by category (Best, Quick, Code, Research, Writing, Images, Free & local), your own persona from a short quiz (Orbis AI Type), token usage meter (cached input counted), image generation, temporary chats, auto-delete and a privacy page.

## Versions and in-app updates

Every Glow app shows its version in the **Glow apps** menu (the grid button). `web/version.json` is the
published version; when it is newer than the version built into `web/shared/glow-apps.js`, the apps show
**Glow x.y.z is ready → Update now**, which clears the Glow caches, refreshes the page files and reloads.
The Android app shows **Download update** (the new APK). To release: bump `version` in `web/version.json`
and `GLOW_VERSION` in `web/shared/glow-apps.js` together (a test checks they match), plus `mobile/package.json`.

GlowRoom always opens inside the current app (a panel in GlowChat, GlowLead and the Glow menu) and keeps
working while the panel is closed; links between Glow apps stay in the same window.

## Install every Glow app (master installer and setup guide)

Guide with all platforms and a diagram of how the apps connect: https://juw12.github.io/projects/glow/setup/

- **Windows PC, one click:** download [Glow-Setup.exe](https://github.com/juw12/projects/releases/download/glow-windows/Glow-Setup.exe), open it and press **Install** (no admin). It adds every app to the Start menu and desktop, installs Glow Hands, and appears in Settings > Apps for uninstalling. Source: `windows/GlowSetup.cs` (built and published to the `glow-windows` release by `.github/workflows/glow-windows.yml`; it runs the latest `install-glow.ps1`).
- **Windows PC, one command** (Win+R, no admin): `powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/juw12/projects/main/apps/glow/install-glow.ps1 | iex"`
  adds Glow, GlowLead, GlowChat and GlowRoom to the Start menu (folder "Glow") and the desktop as Edge/Chrome app
  windows on your normal browser profile (so they share one account, chats and missions), installs or updates
  Glow Hands (auto-starts at login, GlowLead pairs by itself) and opens the guide. Options: `GLOW_SKIP_HANDS=1`,
  `GLOW_NO_DESKTOP=1`, `GLOW_NO_BROWSER=1`, `GLOW_UNINSTALL=1` (removes shortcuts and Glow Hands; chats stay in the browser).
- **Android:** the Glow app APK (GlowLead with its own browser). **iPhone/iPad:** Add to Home Screen; browser missions
  through the instant cloud browser or your PC's Glow Hands (GlowLead -> Glow Hands -> Use from your phone).
- **Linux:** always-on Glow Hands with `hands/install-glow-hands-linux.sh`; apps install from the browser.
- How they connect: one site = one shared browser storage (account, chats, missions, plan); GlowLead delegates to
  GlowChat, the GlowRoom crew and browser control (Glow Hands on a PC at 127.0.0.1, the Android app's browser, or the
  instant cloud browser); phone to PC is a direct WebRTC link. Nothing syncs between different browsers or devices.

## v0.16.0 — Glow plans: Glow Free stays free, Glow Pro for bigger work

- **Glow Free (Rp 0)** keeps everything that worked before: GlowChat, GlowRoom, GlowLead, Glow Free AI, missions
  up to 4 steps, browser missions up to 15 actions, 10 automations, 12 playbooks.
- **Glow Pro** (monthly subscription, price set in Lemon Squeezy): missions up to 8 steps, browser missions up to 40
  actions, 50 automations, 60 playbooks. Open **✦ Plans** in GlowLead (or `glow/lead/#plans`, linked from Glow home).
- **Costs nothing to run.** Payments, tax and invoices: Lemon Squeezy (no monthly fee; it takes a share of each
  sale). License keys are checked by the existing free Cloudflare Worker (`cloud/src/license.js`, `POST /v1/license`)
  through Lemon Squeezy's License API, which needs no secret key. Nothing is stored on a server; the key stays in
  the buyer's browser, is re-checked once a day, and Pro keeps working for 7 days if the check can't be reached.
  The AI itself is free for Glow (Glow Free, or the user's own Puter account).
- **To start selling:** create the Glow Pro subscription in Lemon Squeezy with license keys on, then set
  `PRO_STORE_ID`, `PRO_PRODUCT_ID`, `PRO_CHECKOUT_URL` (and `PRO_PRICE_LABEL`) in `cloud/wrangler.toml`. Until then
  the plans card says "coming soon" and nothing else changes.
- **Fix:** GlowLead now closes the instant cloud browser as soon as a browser mission ends. Before, each mission
  left it open 5 more minutes, using up the shared 10 free browser-minutes a day after about two missions.
- Tests: `cloud/test/license.test.js` (5 checks, fake Lemon Squeezy, runs in the worker workflow); GlowLead
  self-test 26 checks. Cache: `glowlead-v18`.

## v0.15.6 — website goals use the browser, or say plainly that they can't

Found in a real GlowLead run on the live site with the instant cloud browser connected: "Use the browser to open
httpbin.org/forms/post, fill in my name and submit the order" started from Glow home ran without browser control
(only the GlowLead checkbox turns it on), so the GlowRoom crew **invented** the form's confirmation page and the
mission ended "done".
- A goal that must act on a website (use the browser, open/click/log in/fill in/submit/register/order on a site or
  URL; also Indonesian: *pakai browser*, *isi formulir*, *daftar*…) now **turns on browser control automatically when
  it is connected** (instant cloud browser, the Glow app's own browser, or Glow Hands on a PC). Submitting still needs
  your tap. Unattended automations and an explicit "off" are left alone. In GlowLead the checkbox ticks itself
  as you type such a goal.
- When browser control is not connected, the planner is told no worker can open websites and must not imitate a
  website result, and the mission shows how to connect it (Connect browser control → Start instant cloud browser).
- Self-test: 24 checks. Cache: `glowlead-v17`.

## v0.15.5 — prices and budgets are looked up, not guessed

Found in a real GlowLead run: for "used Honda Vario or new Yamaha Gear, budget Rp 18 juta" the planner used only
a Council debate, and the answer stated invented prices, warranty terms and a 4% loan rate that the check
passed as "up to date". Now a goal that mentions prices, budgets or money amounts (Rp, juta, USD…) or
latest/current facts always gets a **🏢 GlowRoom "Check current facts and prices" step first**, and the check
treats numbers without live sources as estimates (criteria that need current facts can't pass on guesses).
Self-test: 23 checks. Cache: `glowlead-v16`.

## v0.15.4 — finished work is never lost to a flaky connection

Found in real GlowLead runs on Glow Free:
- **The final check can fail without losing the mission.** If the last AI call (the check against your
  done-criteria) fails, GlowLead now delivers the team's finished work marked *Result (not fully checked)*
  with a note, instead of ending with "network error" and an empty report.
- **Dropped connections are retried** in the GlowRoom engine (used by GlowLead and GlowRoom): a request that
  fails with "Failed to fetch" is sent again, and a stream cut off mid-answer ("network error") is asked again.
- **No endless "writing…"**: a streamed answer that only sends keep-alive pings is dropped after 45 s without
  new text (4 minutes at most) and retried without streaming.
- **GlowChat no longer spins forever**: each reply has a 75 s answer limit, 45 s without new text while
  streaming, and 4 minutes in total; a stuck or dropped request is sent again once (a long partial answer is
  kept), then a clear "press ↻ Regenerate" message. ■ Stop still cancels at once.
- Self-test: 22 checks. Caches: `glowlead-v15`, `glowroom-v8`, `glowchat-v4`.

## v0.15.0 — Glow Android app and instant cloud browser

- **Glow for Android** (`mobile/`): GlowLead as an app with its own built-in browser, so browser missions run
  on the phone itself with no PC, no cloud and no setup. The browser opens as a panel over GlowLead
  (**Bigger** / **Hide**); you can watch, scroll and type passwords yourself. Same safety rules as Glow Hands:
  web pages only, no local-network addresses, password fields left to you, and a tap to approve before
  submitting, buying, sending, posting or deleting. Download: the `Glow-android.apk` asset of the
  [`glow-android` release](https://github.com/juw12/projects/releases/tag/glow-android). iPhone: not available
  (Apple requires a paid developer account); use the cloud browser instead.
- **Instant cloud browser** (`cloud/`): a hidden browser on Cloudflare's free plan that GlowLead starts with one
  tap, without a GitHub token or any setup. Shared free limit of 10 browser-minutes a day and 3 browsers at
  once; fresh browser every time (no saved logins). Live since 0.15.1, so iPhone users can run browser missions from Safari.
- Shared Glow Hands core (`web/shared/hands-core.js`) so the app, the cloud service and Glow Hands on a PC use
  the same page reading, actions and safety checks. The GitHub cloud browser moved under **Advanced**.
- Guide: [hands/CLOUD.md](hands/CLOUD.md).

## v0.14.0 — Glow Hands without your PC

- **Cloud browser:** on your phone, GlowLead → Connect browser control → **Start cloud browser**. A hidden
  Glow Hands starts on GitHub Actions (`.github/workflows/glow-cloud-hands.yml`) in about a minute and stops
  after 20 minutes, or 8 minutes without use. The private link is derived on both sides from the
  `GLOW_CLOUD_KEY` secret, so nothing secret appears in the public run. It needs a fine-grained GitHub
  token with Actions read/write (stored only on that phone).
- **Always-on server:** `apps/glow/hands/install-glow-hands-linux.sh` sets up Glow Hands on a free Oracle Cloud VM,
  a Raspberry Pi or any Ubuntu machine, starts it at boot and prints a phone QR code. Status shows
  **CONNECTED · SERVER**.
- Glow Hands 0.4.0: `--max-minutes`, `--idle-minutes`, `--quiet`, `--show-phone-link`; headless by default
  on Linux machines without a screen.
- Guide: [hands/CLOUD.md](hands/CLOUD.md).

## v0.13.0 — connect inside the app, and use Glow Hands from your phone

- **No Windows prompt:** Connect browser control connects in one click inside GlowLead, and the installer
  hand-off connects with no click. `--confirm-pairing` brings the Windows Yes/No prompt back.
- **Phone control:** GlowLead on the PC shows a QR code; the phone opens it once and stays linked. Browser steps
  from phone missions run in Glow Hands on the PC over an encrypted WebRTC link (PeerJS signalling and relay),
  after an HMAC challenge proves the phone knows the QR secret. Old links can be revoked in one click.
- Glow Hands 0.3: hidden phone-bridge page, `/phone-link`, `/phone-link/reset`, heartbeat; `--no-phone` option.
- Tests: a phone-sized browser linked from the PC's QR code ran a real browser mission on the PC through the
  public PeerJS service, with the submit approved on the phone; wrong and revoked links were refused.
- Trade-off: all apps on `juw12.github.io` share one origin and storage; see `hands/README.md`.

## v0.12.0 — one-step install and one-click connect for Glow Hands

- **Install on any Windows PC with one command** (Win+R): `hands/install-glow-hands.ps1` installs Python if
  needed, Glow Hands, auto-start at login, and opens GlowLead to connect. Re-running updates in place and keeps
  the pairing.
- **No code to type:** GlowLead finds Glow Hands on ports 8765-8770 and asks it to pair; Glow Hands shows a
  Windows "Allow this browser?" prompt and only shares its code after Yes. Declines cool down for 20 s.
  Discovery only runs after you click Connect (or arrive from the installer), so other visitors never get
  local-network prompts. An older Glow Hands is detected and you are told to update it.
- Fixed: Glow Hands crashed at startup on Windows consoles that cannot print the arrow character.
- Tests: 7 new pairing checks (approve, decline, wrong site/host, cooldown, installer hand-off, outdated
  companion) plus a real run of the installer upgrading an existing install on Windows.

## v0.11.0 — free scheduled missions on GitHub Actions

`runner/run_missions.py` and `.github/workflows/glow-scheduled.yml` run GlowLead missions every day
for free on this public repository: the real GlowLead page in a hidden browser, using Glow Free (no key).
Missions live in the private `GLOW_MISSIONS` secret; reports are a run artifact (kept 30 days) with an
optional issue comment for phone notifications. No browser control or code execution in scheduled runs.
Verified with a live Glow Free run (plan → GlowChat → AI review, about 1.2 minutes) and 5 runner tests.
Setup and privacy notes: `runner/README.md`.

## v0.10.0 — Glow Hands: browser control

GlowLead can now act on websites through **Glow Hands** (`hands/`), a small program on your PC:
open pages, click, type, choose options and fill forms in its own visible browser window.

- New **🖱 Glow Hands** worker, offered to the planner only when a mission ticks *Let Glow Hands use
  my browser* and the companion is connected. Off by default; never enabled by automations.
- One action per turn from a numbered list of the page's controls; up to 15 actions per step.
- **Approval gate enforced by the companion itself:** risky clicks (submit, buy, pay, send, post,
  delete, sign up...) and Enter in forms are refused until you press Approve in GlowLead. Decline
  and Stop work at any point. It never types passwords, card numbers or one-time codes.
- Pairing token, localhost-only listener, origin and Host checks, separate browser profile, and
  local-network pages blocked by default. See `hands/README.md`.
- Tests: 14 new checks with a real browser, including GlowLead's page driving the real companion
  to fill a real form, submitting only after the UI approval, a declined submit never being sent,
  refusal of passwords, Stop during approval, and token/origin/Host/scheme/private-network checks.
  Real websites and free-model reliability on multi-page tasks were not tested.

## v0.9.0 — memory, skills, automations and follow-ups

Closes the most practical gaps with always-on agents that a browser-first app can honestly close.

- **Memory:** tell GlowLead about yourself once (role, location, budget, tone, notes). It is
  snapshotted into each mission's plan and worker briefs when *Use my memory* is on, and shown as
  a badge and in exports. Stored only in this browser; it is sent to your AI provider when used.
- **Skills:** *Save as skill* on a finished mission stores its approved plan. Reusing the skill
  skips re-planning (no planner call) but still shows the plan for review by default.
- **Automations:** repeat any brief or skill daily, on weekdays, or weekly at a set time. Plan
  approval stays on by default and code execution stays off unless ticked. A Web Lock ensures a
  due run starts in only one tab. Missed runs catch up **once** when Glow is next open, never as
  a burst. Optional browser notifications for approvals, results and problems.
  **Limit:** automations run only while a Glow tab is open on that device; this is not a cloud
  scheduler, and nothing runs while the browser or PC is off.
- **Follow-ups:** ask a follow-up under any report; GlowLead plans a new mission with the earlier
  goal and result as context, linked back to it.
- Invalid stored memory or automation entries are ignored rather than breaking the page.

Checks: the hermetic Playwright suite grows to 31 tests (memory on/off reaching planner and
workers, follow-up context, skill reuse without re-planning, schedule maths across daily/weekday/
weekly, single catch-up with approval and notification, one-tab-only runs, create/pause/resume/
delete, invalid storage, mobile layout). Live provider behaviour remains untested.

## v0.8.0 — GlowLead mission control

GlowLead's existing orchestrator is upgraded, not replaced by a fork of Dots.
[invisible_dots](https://github.com/feder-cr/invisible_dots) informed the ideas of visible
work state, approvals and persistent work. No Dots source, branding or VM runtime is included.

- **Task-oriented UI:** responsive mission dashboard, progress counts, searchable/filterable
  history, active mission highlighting, light/dark themes, keyboard focus and reduced-motion styles.
- **Editable approval:** plan review is on by default, including goals handed over from Glow
  home. Edit step titles, instructions, worker assignments and done-criteria before approving.
  Planning itself still sends the brief to the configured AI provider.
- **Permission-aware delegation:** research/drafting mode excludes the crew's `coder` and
  `tester` workers. Generated code execution requires explicit opt-in for each new mission.
  Reusing a mission or playbook resets this permission to off. This is not a VM sandbox or
  per-tool approval system; allowed code still runs in the existing network-capable browser worker.
- **Recovery:** checkpoints at planning, delegation, retry, review and completion; interrupted
  runs offer an explicit resume. Completed steps are retained. Unfinished requests may repeat
  after recovery, so no exactly-once guarantee is claimed. Browser Web Locks prevent two
  GlowLead execution loops from running at once across same-origin tabs. Use HTTPS or localhost
  in a modern browser. Direct GlowChat/GlowRoom runs are separate from this lock.
- **Reusable work:** up to 12 locally saved playbooks, fresh planning on reuse, and full Markdown
  mission exports containing criteria, worker output, source records and an activity trail.
  The newest 50 missions and last 80 activity entries per mission are retained. Export important
  work before older history rotates out or clearing browser storage.
- **Honest results:** omitted, malformed or non-boolean review fields no longer pass criteria.
  Empty responses are failures. A successful unrelated crew step cannot hide failed research,
  including a failed researcher inside an otherwise completed crew mission. Source cards come
  from recorded tool artifacts, not URLs invented in a final report. Collected sources and AI
  review are not independent verification.
- **Storage transparency:** quota failures show a persistent warning and preserve in-memory
  work for export, rather than silently discarding most history. Browser-local storage is still
  not a cross-device sync service. Keep the tab open for execution; background scheduling,
  autonomous computer control and VM isolation are not provided.

### Upgrade checks

The optional Playwright suite (`tests/test_mission_control_browser.py`) blocks external requests
and uses deterministic provider stubs; it also runs the original 21 browser self-checks with the
real crew engine loaded. It covers approvals, edits, interruption/reload, duplicate tabs,
permission routing, malformed reviews, failed research, exports, playbooks, storage failures,
and responsive layouts. This verifies orchestration and UI behavior, not live provider quality,
free-tier availability, or real-world research accuracy.

```bash
python -m pip install playwright==1.55.0
python -m playwright install chromium
python -X utf8 apps/glow/tests/test_mission_control_browser.py
```

Glow itself still has no new runtime dependencies or build step. The scoped Glow workflow
runs static regressions, browser tests, and the existing Pages build/validation on changes.

## v0.7.2 — no made-up answers when research fails
Found in a real GlowLead run: Glow Free sent an empty reply while Nova was planning, the whole GlowRoom mission failed, GlowLead moved on, and GlowChat then invented products and review links that the check passed. Now:
- **GlowRoom keeps going**: an empty AI reply is retried after a short wait (12 s, then 30 s); if Nova's planner still can't answer, the crew uses its standard plan, and if Nova can't write the summary, you get the team's own work instead of an error.
- **GlowLead sends a failed crew mission again once** before giving up on that step.
- **No invented facts**: when live research failed, later steps are told so and must not make up names, prices, ratings or links; the check is told too, and its fix-up round redoes the research with the crew instead of asking GlowChat to guess.
- **Honest report**: if the research never succeeded, the report is marked *⚠ Not checked live* (also in GlowChat) and no criterion is shown as met.
- Self-test: 21 checks (4 new for failed research). Caches: `glowroom-v5`, `glowlead-v3`.

## v0.7.1 — no more endless waiting
Found in a real GlowLead run: a Glow Free request was accepted but never answered, so Nova (and GlowLead) waited forever. Every AI request from GlowRoom/GlowLead now has a 75 s answer timeout and a 45 s stall timeout while streaming; a stuck request is sent again (with a notice) and finally fails with a clear message instead of hanging. GlowLead also scrolls to its progress when a goal arrives from Glow home. Caches: `glowroom-v4`, `glowlead-v2`.

## v0.7.0 — GlowLead, the lead of the Glow apps
A "boss bot" orchestrator, like using one bot to direct Claude Code and Codex, but for the Glow apps (`web/lead/`):
- **Plan → delegate → check → report.** GlowLead turns one goal into 1–4 steps plus 2–4 concrete *done-criteria*, then hands each step to the right worker: **💬 GlowChat** (one model writes/explains), **⚖ GlowChat Council** (Builder, Critic, Judge) or the **🏢 GlowRoom crew** (live web research, code, sources). It never does the work itself.
- **It checks the work.** A review compares the team's output with the done-criteria (✓/✗ per criterion). If something is missing it runs one fix-up round, then checks again, and writes the final report.
- **You stay in charge**: tick *Show me the plan first* to approve the plan before anything runs; ■ Stop at any time; ↻ Try again for failed steps.
- **It controls GlowChat**: every lead becomes one 👑 chat in GlowChat (plan, each worker's output and the checked report), so you can keep asking there. GlowChat's sidebar has *👑 GlowLead: let it lead the job* (what you typed becomes the goal).
- **It owns GlowRoom**: crew missions it starts are saved in GlowRoom's own results with a 👑, GlowRoom shows *👑 Owner: GlowLead* in its header (desktop and phone), and the engine now merges missions saved by another page instead of overwriting them.
- Glow home has a third start button (*👑 Let GlowLead run it*) and a GlowLead card; the app switcher lists GlowLead.
- Works for guests on Glow Free (each AI call may wait ~30 s for the shared limit, so a 3-step lead takes a few minutes); signed-in Glow AI is much faster.
- Self-test: `web/lead/index.html#selftest` (17 checks at v0.7.0, 21 since v0.7.2, with a stubbed AI: planning, routing, Council, GlowRoom hand-off, fix-up round, approval, stop, GlowChat hand-off, escaping). Static tests: `tests/test_glowlead.py`.

## v0.6.1 — fixes from a real end-to-end run
Tested as a first-time visitor on the live site (portfolio → Glow home → GlowChat → GlowRoom → back) with the real free AI:
- **GlowRoom missions no longer fail on Glow Free.** The shared free AI allows about one reply every 30 s and answered the crew's back-to-back calls with "402 Free limit… Retry after N s", which ended the mission. GlowRoom now sends Glow Free calls one at a time and waits out the stated time (with a notice); GlowChat does the same, so Council and quick follow-ups work for guests too.
- **Asking from Glow home answers right away**: no sign-in wall or 15-step tour first; first-timers are answered as guests (sign in any time).
- **Hand-offs start by themselves**: "Give it to GlowRoom" and "🏢 Ask GlowRoom" start the crew immediately; the mission box shows the start of the question.
- **GlowRoom on phones accepts hand-offs** (it ignored `?goal=` and cut missions at 240 characters).
- **Short mission titles** (first line of the goal) in results, toasts, history and Glow home, instead of the whole pasted answer.
- Crew members that hit an error no longer stay "working".
- Portfolio card links are named Glow home / GlowChat / GlowRoom. Caches: `glowhome-v2`, `glowchat-v2`, `glowroom-v2`.

## v0.6.0 — the Glow ecosystem
- **Glow home** (`web/index.html`): a quick-start box (💬 *Ask GlowChat* or 🏢 *Give it to GlowRoom*, with a hint when the request sounds like a job for the crew), **Jump back in** (recent GlowChat chats and GlowRoom missions), app cards with Open / Mobile / Install, and your account.
- **GlowChat** (`web/chat/`) is the former Glow chat app. New launch links: `chat/?q=text` pre-fills the box, `chat/?open=<chat id>` reopens a chat.
- **GlowRoom** (`web/room/`) is Crewroom, **moved** here (not copied) from `apps/virtual-bots`. Its saved crews, missions and settings keep the same browser storage keys.
- **One switcher**: the ✦ Glow apps menu (`web/shared/glow-apps.js`) appears in GlowChat and GlowRoom on desktop and phone, and shows who is signed in.
- **One account**: the Glow AI (Puter) sign-in is shared; GlowChat ↔ GlowRoom hand-offs work as in v0.5.1.
- **Old links keep working**: `/virtual-bots/…` → `/glow/room/…`, `/glow/app.html` and `/glow/mobile.html` → GlowChat, `/mufakat/…` → GlowChat (query and hash kept).
- **Cache fix**: Crewroom's service worker used to delete *every* cache on the site when it updated (including other apps' offline caches). GlowRoom now only removes its own (`glowroom-`/`crewroom-`). Each Glow app has its own cache (`glowhome-v1`, `glowchat-v1`, `glowroom-v1`).

## What it does that single-model chat apps don't
| Mode | What happens |
|---|---|
| **Council** ⚖ | 2–3 agents with different roles (and different models) take turns building, critiquing and revising until they reach **consensus**. Then an impartial **Judge** writes the final answer with what was agreed, what's still open, and a confidence level. Presets: Builder + Critic, Expert panel (Engineer/Designer/Skeptic), Debate, Teacher + Student, Brainstorm. |
| **Arena** ⚔ | One prompt, 2–3 models answering **side by side in parallel**. Vote for the best; your personal **leaderboard** tracks which models actually win for *your* questions. |
| **Chat** | Streaming chat plus one-click **Second opinion** (a different model reviews the answer), regenerate, edit & resend, file attachments (text/code), visible reasoning. |

Plus: sign in or continue as guest, a guided tour, starter prompts, per-reply copy, chat rename
(double-click), chat search, Markdown export, full backup/restore, light/dark/system theme, keyboard
shortcuts (`Ctrl/⌘ K`, `Esc`, `/`, `?`), installable PWA, offline app shell.

## Free by design
Static site, no backend, so hosting is free (GitHub Pages). Everything runs in the browser:

| Provider | Cost | Setup |
|---|---|---|
| Glow Free (default for guests) | Free | None: works right away via Pollinations' anonymous tier (GPT-OSS 20B, shared, rate-limited) |
| Glow AI (sign in) | Free for you and for Glow | Click **Sign in**: a free [Puter](https://puter.com) account; GPT, Claude, Gemini, DeepSeek… with no key |
| Demo | Free | None: offline canned replies to show every mode |
| OpenRouter | Free models available | Paste a free key from openrouter.ai/keys in Settings |
| Ollama | Free, private | `OLLAMA_ORIGINS=https://juw12.github.io ollama serve` |
| Any OpenAI-compatible API | Varies | Base URL + key in Settings |

Chats, settings and votes are stored in browser localStorage. API keys are stored there too and sent to the selected provider to authenticate requests. Prompts and attached text are sent to that provider; there is no hosted app backend in this prototype.

## Layout
- `web/index.html`: Glow home; `web/shared/`: the app switcher used by every Glow app
- `web/chat/`: GlowChat, the free static chat app (deployed to Pages)
- `web/room/`: GlowRoom, the AI agent office (formerly Crewroom, `apps/virtual-bots`)
- `web/lead/`: GlowLead, the lead/orchestrator that plans, delegates to GlowChat and GlowRoom, and checks
- `server/`: optional hosted tier with accounts, Free/Pro plans, Stripe subscriptions,
  per-user cost budgets and synced chats (`python apps/glow/server/app.py`). Its
  front-end currently ships Chat + 2-agent Council; Arena and Judge are web-app features
  to port next. Deploy via `server/render.yaml`.
- `tests/test_static_integrity.py`: static checks for the web app
- `tests/verify_api.py`: end-to-end server test (mock LLM + signed Stripe webhooks, 36 checks)
- `docs/BRIEF.md`: product brief

## Test
```bash
python apps/glow/tests/test_static_integrity.py
python apps/glow/tests/verify_api.py
```
In-browser self-test: open `web/chat/index.html#selftest` (94 checks covering chat, council,
judge, arena, voting, export, search, the v0.2.1 fixes, v0.4 sign-in, guest mode, tour,
theme, sync and UI, and the v0.5 model picker, personas, checklists, Fuse, share links and Markdown, and the Crewroom link, using a Puter test double so no real account is touched). Demos: `#demo-council`, `#demo-arena`.

## v0.2.1 fixes
- Demo and self-test links (`#selftest`, `#demo-*`) run in a sandbox and never touch a visitor's saved chats or keys.
- Rate limits (HTTP 429/5xx) are retried automatically with backoff (honours `Retry-After`), which matters on free models.
- Long conversations are trimmed to the most recent ~24k characters so small models don't overflow.
- Consensus only counts when an agent *ends* with `CONSENSUS` (not "no consensus yet").
- Second opinion never falls back to the demo bot when a real model is connected.
- Default models prefer strong general chat models over alphabetical order.

## Honest limits
Glow doesn't train its own model, so answer quality comes from the models you connect.
Deliberation helps catch mistakes but costs more calls (and time) than a single answer.
Free OpenRouter models are rate-limited. Working prototype, not a production service.

## v0.3.0 — renamed Glow
- Formerly Mufakat. Existing browser storage and hosted databases are retained.
- Old web, installed-app and mobile links redirect to the matching Glow page.
- Demo/self-test links still use isolated storage.
- Glow cache cleanup is restricted to Glow, preserving other apps on the same origin.
- Glow is a prototype brand chosen by the owner, not a unique or trademark-cleared name.

## v0.5.1 — connected to Crewroom (now GlowRoom)
- **Glow → Crewroom**: the 🏢 Crewroom button in the sidebar hands whatever you typed to Crewroom's AI crew (web research, code, media) as their mission; **🏢 Ask the crew** under any reply sends the question plus Glow's answer so the crew can check and extend it.
- **Crewroom → Glow**: finished crew results arrive in Glow as a chat marked 🏢, so you can keep asking about them. Both apps share one Glow account and the same Glow AI models.
- Works because both apps live on the same site (shared browser storage); nothing goes through a server.

## v0.5.0 — choose your model, personas, checklists
- **Model picker**: searchable dropdown grouped by provider with badges (Free, Fast, Reasoning, Smart, Local), ★ favourites, keyboard navigation. Guests see Glow AI models with a 🔒; picking one opens sign-in and selects it afterwards. Signed-in users can show every Glow AI model.
- **Personas per chat**: Default, Planner, Tutor, Coder, Writer, Critic, Translator, plus your own **custom instructions** (Settings) applied to every mode.
- **Interactive checklists**: `- [ ]` tasks in replies become tickable checkboxes with a progress bar; ticks are saved and included in exports. The *Make a plan* starter uses the Planner.
- **Follow-up chips**: 2–3 suggested next questions under each reply (can be turned off).
- **Arena Fuse**: merge the side-by-side answers into one best answer.
- **Improve prompt** (with undo), **voice input** and **Listen** (read aloud) where the browser supports it.
- **Share by link**: a chat is compressed into the link itself; no server stores it. Imports are sanitized.
- **Fixes**: Markdown tables, safe links, nested/numbered lists, blockquotes; autoscroll no longer yanks you down while reading (↓ Latest button); pinned chats; character/token counter; print layout.

## v0.4.0 — sign in, guest mode, guided tour, themes
- **Welcome screen**: *Sign in* (free real AI) or *Continue as guest* (demo, own keys, Ollama). Existing chats and keys are kept; switch any time from the sidebar or Settings.
- **Glow AI**: signed-in users get curated models (GPT-5 mini, Gemini 2.5 Flash, Claude Haiku 4.5, DeepSeek, Grok and more), streamed through [Puter.js](https://docs.puter.com). Puter's User-Pays model runs them on each person's own free Puter allowance, so there is no API key and no bill for Glow. The model list is filtered against Puter's live catalogue.
- **Chat sync**: when signed in, chats, votes and deletions sync to the user's Puter key-value storage (split into parts under the 400 KB value limit). API keys are never synced. Can be turned off in Settings.
- **Guided tour**: 11 spotlight steps (model picker, composer, Council, Arena, search, export, theme, account, settings), Next/Back/Skip, arrow keys and Esc; replay with `?` or Settings. Works on mobile by opening the sidebar for sidebar steps.
- **Theme**: follows the device by default; toggle in the top bar, welcome screen or sidebar, or choose System/Light/Dark in Settings.
- **UI**: starter prompt cards, per-reply Copy, toast feedback, chat rename, glow accents, focus rings, message animations (reduced-motion respected). Chat error notices no longer disappear right after they appear.
- **Honest limits**: Puter is a third-party service and needs a person to sign in (a popup); its free allowance is limited and set by Puter. If Puter can't be reached, guest mode keeps working.

## v0.4.1 — real AI for guests, no sign-up
- Guests now get real answers immediately: **Glow Free** (GPT-OSS 20B via Pollinations' anonymous tier, no key, no account) is the default model, so typing and pressing Enter works like a normal AI chat. Demo stays available.
- Your own strong models (OpenRouter key, signed-in Glow AI, local Ollama) still take priority when connected.
- Friendly messages when the free service is busy (it's shared and rate-limited; requests are retried automatically) or the network is down.

## v0.4.2 — visible rate-limit notice
- When the free guest AI (or any provider) throttles a reply, a clear notice appears above the message box on desktop and mobile: why it's waiting, a live retry countdown and the attempt number. It disappears as soon as the reply starts.
- If retries run out, the notice stays (with a "Sign in for faster AI" shortcut for guests) until the user dismisses it or tries again. Throttling reported inside the stream is caught too.
