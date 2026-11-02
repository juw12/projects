# Ashiato (足跡) — working name

"Your life, drawn as a map you walk through."
A calm photo diary + walking map + weather town, combining ideas from
One Good Thing, DOOD, DayCity, Kiroku, PlainWalk, Footnotes and echor.

Full product plan: `docs/plan.md`.

## Try it (web prototype)

- 3D swipe diary deck: https://juw12.github.io/projects/ashiato/ (`?lang=en`, `?lang=ja`, `?lang=ko`, `?lang=duo`)
- Screenshot tidy-up deck: https://juw12.github.io/projects/ashiato/tidy.html
- Source: https://github.com/juw12/projects/tree/main/apps/ashiato

`web/` is the published copy of `prototypes/cozy3d`; refresh it with `python tools/sync_web.py`.
The iOS app in `ios/` is written but **not compiled yet** (needs a Mac + Xcode).

## Status

| Phase | Item | Status |
|---|---|---|
| 0 | Name check | "DayMap" is taken (task planner app). Renamed to **Ashiato**; no app found under that name. Trademark not yet checked. |
| 0 | Doodle prototype (`prototypes/doodle`) | ✅ 3 styles; ~0.6 s/image in desktop Python at 512 px |
| 0 | Walk-map prototype (`prototypes/walkmap`) | ✅ map matching with coverage filter + gap fill; 100 % precision, 98 % recall at 6 m GPS noise (simulated) |
| 0 | Scene library (`prototypes/scenes`) | ✅ all 192 scenes, 4.2 MB total, bundled into the iOS app |
| 0 | Day card (`prototypes/daycard.py`) | ✅ scene + doodle + note + mood + walk + memory, 1080×1920 share format |
| 0 | Cozy JP/KR 3D art direction (`prototypes/cozy3d`, `docs/art-direction.md`) | ✅ three.js street-corner diorama, 192 scenes re-rendered, 3D swipe-card deck prototype |
| 0 | Screenshot tidy-up (Clutter layer, `prototypes/tidy`) | ✅ shared JA/KO/EN lexicon classifier: 40/40 tuning, 18/20 hold-out before fixes; ticket-date + dHash duplicate detection; swipe deck prototype `prototypes/cozy3d/tidy.html` |
| 0 | Fonts subset (`tools/subset_fonts.py`) | ✅ 26.8 MB → 9.3 MB; all UI strings covered |
| 0 | Art style with a real illustrator | ⏳ diorama is procedural; an illustrator should repaint/texture it in the same palette |
| 0 | Battery test on a real iPhone | ⏳ needs a device |
| 1 | iOS app code (`ios/`) | 🟡 26 Swift files incl. language modes (duo JA·KO / EN / JA / KO, `SettingsView`), 3D swipe deck, screenshot tidy (`TidyView`, `ScreenshotInbox`, `ClipClassifier` + parity tests), (`SwipeDeckView.swift`), cozy theme + bundled OFL fonts; **not compiled yet** (needs a Mac + Xcode) |
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

## Build the iOS app (needs a Mac)

1. Install Xcode 15.3+ and `brew install xcodegen`.
2. `cd ios && xcodegen generate && open Ashiato.xcodeproj`
3. Set your team ID in `project.yml` (DEVELOPMENT_TEAM), then enable these capabilities in the developer portal:
   WeatherKit, iCloud (CloudKit container `iCloud.app.ashiato`), App Groups (`group.app.ashiato`).
4. Build to a real iPhone (WeatherKit and background location don't work well in the simulator).

### What the iOS code covers (Phase 1)
- `Shared/Models.swift`: SwiftData models (Day, Moment, Fragment, Walk, RoadSegment, PromptRecord), CloudKit-compatible.
- `Shared/SceneKey.swift`: maps weather + sunrise/sunset + hemisphere season to one of the 192 scene assets.
- `Ashiato/Services/DoodleRenderer.swift`: Core Image port of the doodle prototype (on device, free).
- `Ashiato/Services/WeatherProvider.swift`: WeatherKit → scene mapping, hourly cache, offline fallback.
- `Ashiato/Services/WalkRecorder.swift`: battery-aware GPS walks, accuracy filtering, optional motion auto-start.
- `Ashiato/Services/Resurfacer.swift`: on-this-day memories, weighted random fragments, daily prompts.
- `Ashiato/Views/*`: Today, Days (cards + timeline + calendar), Map, Memories, Capture sheet, Day card.
- `Ashiato/Views/SwipeDeckView.swift`: 3D swipe deck — slow springs, drag rotation3D, CoreMotion tilt parallax, haptics, washi tape / polaroid / hanko stamp cards, week strip.
- `Ashiato/Theme.swift` + `Shared/SceneArt.swift`: palette, fonts, paper grain, JA/KO labels, JPEG scene loader.
- `Shared/Language.swift` + `Ashiato/Views/SettingsView.swift`: language mode (duo/English/日本語/한국어, stored in the App Group so widgets follow), all UI copy in one `Copy` table.
- `Widgets/TodayWidget.swift`: home-screen widget whose light changes every hour.

### Known gaps / next steps
- Compile and fix on a Mac (code was written on Windows without a Swift compiler).
- Port the walk-map matcher to Swift using OpenStreetMap road tiles (Phase 2).
- Tune the Core Image doodle so it matches the Python look; compare side by side.
- Paywall (RevenueCat), onboarding, permission priming, more localizations (ZH-Hant/ID; EN/JA/KO done).
- Replace procedural diorama with illustrator-finished assets; regenerate the scene library in that style.
- Tune the screenshot classifier and the Vision duplicate threshold (0.35) on real, opt-in OCR samples.
- Share extension: "save this screenshot to a drawer" straight after capture.
