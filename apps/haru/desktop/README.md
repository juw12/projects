# Haru for Windows and macOS

The web app in `../web/app/` wrapped with Electron and served from a private `app://haru/`
origin, so the diary (IndexedDB) stays on this computer and everything works offline. Walks are not
recorded on desktop (no GPS); photos and screenshots come from files.

CI (`.github/workflows/haru-apps.yml`) builds `Haru-Setup-x64.exe` and
`Haru-Portable-x64.exe` on Windows and a universal `Haru-mac.dmg` on macOS, launches each
packaged app for screenshots (`scripts/smoke.cjs`) and publishes them to the `haru-latest`
release. The builds are unsigned: Windows SmartScreen asks once (More info → Run anyway); on macOS
right-click the app → Open the first time (or run `xattr -dr com.apple.quarantine /Applications/Haru.app`).

Locally: `npm install`, `npm start`, `npm run dist:win` (or `dist:mac` on a Mac).
