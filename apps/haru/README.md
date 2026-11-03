# Haru

"Your life, drawn as a map you walk through."
A calm photo diary + walking map + weather town, combining ideas from
One Good Thing, DOOD, DayCity, Kiroku, PlainWalk, Footnotes and echor.

Full product plan: `docs/plan.md`. Formerly the working name *Ashiato*; old `/projects/ashiato/` links redirect here.

## Use it now (no developer account needed)

- **Any phone or computer, in the browser:** https://juw12.github.io/projects/haru/app/
  — starts with sample days; switch to your own diary in Settings. On iPhone: Safari → Share →
  *Add to Home Screen* and it opens full-screen like an app (works offline after the first visit).
- **Android, Windows, Mac downloads:** https://github.com/juw12/projects/releases/tag/haru-latest
  (`Haru-android.apk`, `Haru-Setup-x64.exe` / `Haru-Portable-x64.exe`, `Haru-mac.dmg`).
  The builds are unsigned: Android asks to allow installs from your browser/files app; Windows
  SmartScreen → *More info* → *Run anyway*; macOS → right-click the app → *Open* the first time.
- Each device keeps its own diary (stored on the device). Move it with Settings → *Backup*.
- Walks are recorded while the app is open (web/Android); desktop has no GPS, so no walk recording.

One app, every platform: `web/app/` is the app itself (plain ES modules, no build step).
`mobile/` wraps it for Android with Capacitor, `desktop/` wraps it for Windows/macOS with Electron;
the monorepo workflow `.github/workflows/haru-apps.yml` checks it in Chromium
(`tools/test_web_app.py`), builds the APK/exe/dmg, launches each one for screenshots and publishes
them to the `haru-latest` release. The native SwiftUI app in `ios/` is the long-term iPhone
version (needs an Apple Developer account to install on a device / TestFlight).

## Earlier web prototypes

- 3D swipe diary deck: https://juw12.github.io/projects/haru/ (`?lang=en`, `?lang=ja`, `?lang=ko`, `?lang=duo`)
- Screenshot tidy-up deck: https://juw12.github.io/projects/haru/tidy.html
- Source: https://github.com/juw12/projects/tree/main/apps/haru

`web/` (apart from `web/app/`) is the published copy of `prototypes/cozy3d`; refresh it with `python tools/sync_web.py`.
The iOS app in `ios/` builds, passes its unit tests and is screenshotted on every push by the GitHub Actions macOS runner (`.github/workflows/haru-ios.yml` in the monorepo) — no local Mac needed.

## Status

| Phase | Item | Status |
|---|---|---|
| 0 | Name check | "DayMap" is taken (task planner app). Renamed to **Haru**; no app found under that name. Trademark not yet checked. |
| 0 | Doodle prototype (`prototypes/doodle`) | ✅ 3 styles; ~0.6 s/image in desktop Python at 512 px |
| 0 | Walk-map prototype (`prototypes/walkmap`) | ✅ map matching with coverage filter + gap fill; 100 % precision, 98 % recall at 6 m GPS noise (simulated) |
| 0 | Scene library (`prototypes/scenes`) | ✅ all 192 scenes, 4.2 MB total, bundled into the iOS app |
| 0 | Day card (`prototypes/daycard.py`) | ✅ scene + doodle + note + mood + walk + memory, 1080×1920 share format |
| 0 | Cozy JP/KR 3D art direction (`prototypes/cozy3d`, `docs/art-direction.md`) | ✅ three.js street-corner diorama, 192 scenes re-rendered, 3D swipe-card deck prototype |
| 0 | Screenshot tidy-up (Clutter layer, `prototypes/tidy`) | ✅ shared JA/KO/EN lexicon classifier: 40/40 tuning, 18/20 hold-out before fixes; ticket-date + dHash duplicate detection; swipe deck prototype `prototypes/cozy3d/tidy.html` |
| 0 | Fonts subset (`tools/subset_fonts.py`) | ✅ 26.8 MB → 9.3 MB; all UI strings covered |
| 0 | Art style with a real illustrator | ⏳ diorama is procedural; an illustrator should repaint/texture it in the same palette |
| 0 | Battery test on a real iPhone | ⏳ needs a device |
| 1 | iOS app code (`ios/`) | 🟡 26 Swift files incl. language modes (duo JA·KO / EN / JA / KO, `SettingsView`), 3D swipe deck, screenshot tidy (`TidyView`, `ScreenshotInbox`, `ClipClassifier` + parity tests), (`SwipeDeckView.swift`), cozy theme + bundled OFL fonts, onboarding with permission priming, `-demo` sample data; ✅ builds with 0 warnings + simulator screenshots on CI; ⏳ not yet run on a real iPhone |
| 1 | Landing page (`landing/`) | ✅ static page; plug in a waitlist form endpoint |

## Run the prototypes (Windows/macOS/Linux)

```
pip install numpy scipy pillow networkx
python prototypes/doodle/doodle.py prototypes/doodle/input/cat.jpg out.png --style crayon
python prototypes/walkmap/walkmap.py --days 30 --out prototypes/walkmap/output
python prototypes/scenes/scenes.py --out prototypes/scenes/output
python prototypes/daycard.py
```

Cozy 3D swipe deck (needs a local server because it uses ES modules):

```
cd prototypes/cozy3d
python -m http.server 8000
# open http://localhost:8000  (drag / arrow keys to swipe; ?demo=tilt or ?demo=swipe; ?lang=en|ja|ko|duo)
# open http://localhost:8000/tidy.html  (screenshot tidy deck; ?demo=drag or ?demo=done)
```

Screenshot classifier:

```
python prototypes/tidy/tidy.py --eval            # tuning + hold-out accuracy
python prototypes/tidy/tidy.py --export-expected # regenerate the Swift parity golden file
python prototypes/tidy/make_shots.py             # mock screenshots for tidy.html
```

## Build the iOS app

**Without a Mac (CI):** push to the monorepo; the `Haru iOS` workflow runs `xcodegen generate`, builds app + widget + tests for the simulator, runs the tests, and uploads `haru-ios-results` (build log, warnings, test log, 10 screenshots) and `Haru-simulator-app`.

Launch arguments (simulator / screenshots): `-demo` (in-memory sample diary, no permission prompts), `-lang duo|english|japanese|korean`, `-tab today|days|map|memories`, `-sheet settings|tidy|capture|onboarding`.

**On a Mac:**


1. Install Xcode 15.3+ and `brew install xcodegen`.
2. `cd ios && xcodegen generate && open Haru.xcodeproj`
3. Set your team ID in `project.yml` (DEVELOPMENT_TEAM), then enable these capabilities in the developer portal:
   WeatherKit, iCloud (CloudKit container `iCloud.app.haru`), App Groups (`group.app.haru`).
4. Build to a real iPhone (WeatherKit and background location don't work well in the simulator).

### What the iOS code covers (Phase 1)
- `Shared/Models.swift`: SwiftData models (Day, Moment, Fragment, Walk, RoadSegment, PromptRecord), CloudKit-compatible.
- `Shared/SceneKey.swift`: maps weather + sunrise/sunset + hemisphere season to one of the 192 scene assets.
- `Haru/Services/DoodleRenderer.swift`: Core Image port of the doodle prototype (on device, free).
- `Haru/Services/WeatherProvider.swift`: WeatherKit → scene mapping, hourly cache, offline fallback.
- `Haru/Services/WalkRecorder.swift`: battery-aware GPS walks, accuracy filtering, optional motion auto-start.
- `Haru/Services/Resurfacer.swift`: on-this-day memories, weighted random fragments, daily prompts.
- `Haru/Views/*`: Today, Days (cards + timeline + calendar), Map, Memories, Capture sheet, Day card.
- `Haru/Views/SwipeDeckView.swift`: 3D swipe deck — slow springs, drag rotation3D, CoreMotion tilt parallax, haptics, washi tape / polaroid / hanko stamp cards, week strip.
- `Haru/Theme.swift` + `Shared/SceneArt.swift`: palette, fonts, paper grain, JA/KO labels, JPEG scene loader.
- `Shared/Language.swift` + `Haru/Views/SettingsView.swift`: language mode (duo/English/日本語/한국어, stored in the App Group so widgets follow), all UI copy in one `Copy` table.
- `Widgets/TodayWidget.swift`: home-screen widget whose light changes every hour.

### Fixed when the code was first compiled (CI)
- Resources were never bundled (XcodeGen has no target-level `resources:`), so scenes, fonts, the clip lexicon and test goldens were missing → listed as sources with `buildPhase: resources`.
- Widget bundle ID was not prefixed by the app's → install failed; explicit bundle IDs per target.
- `fatalError` when the iCloud/App Group store can't open → fallback chain down to an in-memory store.
- Location and Photos permission alerts on first launch / any PhotoKit fetch → onboarding primes location; PhotoKit is only touched after access is granted.
- Swift 6 concurrency warnings (main-actor isolation of statics and encoders).

### Known gaps / next steps
- Run on a real iPhone: needs an Apple Developer team ID for signing, WeatherKit / iCloud / App Group capabilities, and a battery test.
- Port the walk-map matcher to Swift using OpenStreetMap road tiles (Phase 2).
- Tune the Core Image doodle so it matches the Python look; compare side by side.
- Paywall (RevenueCat), more localizations (ZH-Hant/ID; EN/JA/KO done).
- Replace procedural diorama with illustrator-finished assets; regenerate the scene library in that style.
- Tune the screenshot classifier and the Vision duplicate threshold (0.35) on real, opt-in OCR samples.
- Share extension: "save this screenshot to a drawer" straight after capture.
