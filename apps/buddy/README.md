# Buddy

A desktop app for focus-with-a-friend that fuses three things into one
premium experience:

1. **Live Pomodoro co-working** — pair with a buddy, both see each other's
   focus state in real time, share a daily streak.
2. **Clicky counter** — Farza-style visit counter. Each clicky (manual +
   auto on every message and every focus completion) bumps the buddy's
   `clicky_received_count`. Lonely-Twitter vibe, but applied to your
   focus sessions.
3. **System-wide mech keyboard sound** — every key you press, anywhere on
   your computer, plays a synthesized switch sound (Cherry MX Blue /
   Brown / Topre / Buckling Spring) with a particle burst.

## Stack

- **Desktop**: Electron + React + TypeScript + Vite
- **Storage**: IndexedDB (in-app, zero-config)
- **Audio**: Web Audio API with `latencyHint: 'interactive'`
- **Visuals**: Canvas 2D particle system
- **Keyboard hook**: OS subprocess (PowerShell + .NET on Windows,
  Swift on macOS, Python on Linux) — no native modules needed

## Local-only — zero setup

Buddy stores everything in your browser's IndexedDB. No accounts, no cloud,
no env files, no migrations. First launch seeds 3 fake buddies (Alex,
Jordan, Sam) with chat history and focus logs so the UI is immediately
populated. Just open the app.

## Layout

```
apps/buddy/
├── shared/                  Types used by both Electron + renderer
├── electron/
│   ├── main.ts              App lifecycle, tray, IPC bridge, keyboard hook spawn
│   ├── preload.ts           contextBridge → window.buddy API
│   └── hooks/
│       └── spawn.ts         OS subprocess manager
├── scripts/
│   ├── keyboard-hook.ps1    Windows implementation (SetWindowsHookEx)
│   ├── keyboard-hook.swift  macOS stub
│   └── keyboard-hook.py     Linux stub
├── src/
│   ├── db/
│   │   ├── local.ts         IndexedDB-backed drop-in for supabase-js
│   │   └── seed.ts          Demo data seeded on first launch
│   ├── domain/
│   │   ├── clicky.ts        giveClicky() + sources
│   │   ├── chat/            1:1 messages
│   │   ├── focus/           Pomodoro sessions + auto-clicky
│   │   ├── friends/         Friend graph
│   │   ├── leaderboard.ts   Weekly hours + clickies
│   │   └── streak/          Daily streak read
│   ├── realtime/            In-process pub/sub via onChange()
│   ├── audio/               Web Audio engine + switch profiles
│   ├── themes/              Theme palette
│   ├── components/          React UI
│   ├── state/               Zustand store
│   └── styles/
└── docs/
```

## Setup

```bash
cd apps/buddy
npm install --ignore-scripts
# Manual Electron binary fetch if behind the OA proxy (see below)
npm run dev                # Vite + Electron with HMR
npm run build              # Production bundle
npm run package:win        # NSIS installer → release/Buddy Setup 0.1.0.exe
```

### Installing Electron (workaround for OA proxy)

If `npm install` fails with `RequestError: read ECONNRESET` during
electron postinstall:

```powershell
Invoke-WebRequest `
  -Uri "https://npmmirror.com/mirrors/electron/33.4.11/electron-v33.4.11-win32-x64.zip" `
  -OutFile electron-binary.zip
Expand-Archive electron-binary.zip -DestinationPath node_modules/electron/dist -Force
Remove-Item electron-binary.zip
"electron.exe" | Out-File -Encoding ascii node_modules/electron/path.txt
```

## Build installers

```bash
npm run package:win       # NSIS .exe
npm run package:mac       # DMG (run on macOS for code signing)
npm run package:linux     # AppImage + .deb
```

Output: `release/`.

## Features (v1)

- **System-wide keyboard sound** with 4 synthesized switch profiles
  (Cherry MX Blue / Brown, Topre, Buckling Spring). Tray icon pauses.
- **Premium particle burst** on every keypress, themed to the active palette.
- **3 fake buddies** seeded on first launch (Alex / Jordan / Sam) so the
  UI is immediately populated. Add more by editing `src/db/seed.ts`.
- **Live focus events** — when you start a focus block, the chat panel
  picks it up via in-process pub/sub.
- **Clicky counter** — manual clicky button on each buddy + auto-clicky on
  every message sent and every focus block completed.
- **1:1 chat** with each buddy, persisted to IndexedDB, real-time within
  the app session.
- **Daily streak** — incremented on every focus completion, longest streak
  tracked separately.
- **Friends-only leaderboard** — weekly focus hours + clicky counts.
- **3 themes** (Minimal / Neon / Synthwave), all colors drive both UI and
  particle palette.
- **System tray** — pause/resume keyboard sound, open Buddy, quit.

## Roadmap

- v1.0 — current (local-only, single-user, seeded demo data)
- v1.1 — Mac / Linux keyboard hook implementations
- v1.2 — Drag-and-drop sound packs (real WAV recordings layer over synth)
- v1.3 — Export / import your data as JSON (so two devices can sync)
- v2.0 — Real network pairing (LAN discovery or lightweight signaling server)

## Caveats

- **Single device, single user.** No cloud sync, no real friend pairing
  across machines. The 3 fake buddies are demo content; replace the
  seed or extend it with whatever you want.
- **macOS and Linux keyboard hooks are stubs** — the Windows PowerShell
  implementation works end-to-end. Filling in the Swift / Python hooks
  is on the v1.x roadmap.
- **Sound is synthesized**, not real recordings — convincing but not
  Cherry MX-true. Sound-pack support is v1.2.
- **App icon and code signing are not configured** — Windows SmartScreen
  will warn on first launch.

## License

MIT.
