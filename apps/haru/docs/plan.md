# Haru — Full Product Plan (complete version)

> Name: **Haru** (chosen 2026-11-03; formerly the working name *Ashiato* (足跡), dropped because the App Store already has many "Ashiato" diary and walking apps).

Inspired by: One Good Thing, DOOD, DayCity, Kiroku, PlainWalk, Footnotes, echor.


## Name and store-launch check (2026-11-03)

**Decision:** keep **Haru** for the web app, the GitHub downloads and the portfolio. Before an App Store / Play launch, pick a distinctive store name.

Why (quick web check, not a legal clearance search):
- Ashiato (old working name): ~8 App Store apps already called Ashiato / あしあと, several of them place diaries and walking photo maps.
- Haru: the "Haru" diary space is crowded: **Harukong 하루콩** (BlueSignum, 10M+ downloads, Korea), Mongle Haru, Haru — Daily Journal, Haru Diary, Haru - Gratitude Diary, Happy Haru.
- Trademarks: Japan, **HARU class 9 held by Furyu Corporation** (photo-sticker / photo apps; closest risk). UK, HARU class 42 (Spring Technology Services). US, old HARU marks (sushi restaurant group) are dead. Korea not checked directly (KIPRIS).

Store-name candidates (no matches found in a quick search): **Dayrama** (day + diorama; デイラマ / 데이라마) first choice, then *Hibitown*, *Townote*. Before launch: search J-PlatPat, KIPRIS and USPTO (class 9 / 42), reserve the store name and a domain.

---

## 1. Vision

**"Your life, drawn as a map you walk through."**

Every day becomes a small illustrated scene: your photo turned into a doodle, your notes, the real weather that day,
and the streets you walked — all placed on a personal map that only grows where you have actually been.
Over months and years it becomes a living, beautiful atlas of your own life that resurfaces memories on its own.

### Design principles
1. **One tap to capture.** Anything that needs more than 5 seconds is optional.
2. **Passive by default.** Walk, weather and place are recorded automatically.
3. **One art style everywhere.** Doodles, map, weather scenes, widgets and share cards look like one world.
4. **Calm, not compulsive.** No streak shame, no social feed, no folders.
5. **Private first.** Data lives on device + the user's iCloud. No account required.
6. **Rediscovery over organization.** The app brings the past back to you.

### Target users
- Primary: 18–35, aesthetic-minded, already uses widgets, journaling or walking apps; active on Threads/X/Instagram.
- Secondary: walkers/explorers in cities, travellers, people trying to build a gentle journaling habit.
- Launch markets: Japan, Korea, Taiwan, US, Indonesia/SEA (these app types do well there). Localize JA/KO/ZH-Hant/ID/EN from v1.

---

## 2. Feature map (what comes from where)

| Layer | Inspired by | In Daymap |
|---|---|---|
| Capture | DOOD, Kiroku, Footnotes | Photo / text / voice / mood moment, auto-doodled |
| Timeline | Kiroku, Footnotes | Endless day-by-day scroll + calendar |
| Place | PlainWalk | Blank map that draws only the roads you walk; moments pinned on it |
| Atmosphere | DayCity | Each day card rendered with that day's real weather, light and season |
| Prompts | One Good Thing | One gentle idea/question per day, keep-or-let-go |
| Fragments | echor | Ultra-short notes (≤70 chars) with no structure |
| Resurfacing | echor, Footnotes | Random/anniversary/place-based memories |
| Ambient | DayCity, DOOD | Home & lock screen widgets, Live Activity for walks, Watch |
| Tidy-up | Clutter | Swipe-review screenshots into drawers (しまう / てばなす / あとで), on-device OCR, copy text, duplicates, ticket expiry; each screenshot filed under the day it was taken |

---

## 3. Core loops

**Daily loop (≈30 seconds):**
widget shows today's empty scene → user snaps a photo or writes one line → it becomes a doodle in today's scene
→ weather + place fill in automatically → widget updates → done.

**Walk loop (passive):**
user walks → roads get drawn on the blank map → new roads = "pioneered" → moments taken on the walk pin to the map
→ end-of-walk card (route + doodles + weather) ready to share.

**Return loop (weekly/monthly):**
notification "one year ago on this street…" → user opens memory → adds a new note → past and present connect.
Monthly "atlas page" recap (map + best doodles) — main share moment.

---

## 4. Complete feature specification

### 4.1 Capture
- Moment types: photo (1–4), short text fragment (≤70 chars), long note (no limit), voice note (≤60 s, on-device transcription), mood (5-level + optional emoji), place check-in.
- Quick capture from: widget, lock screen control, Action Button / Back Tap shortcut, Share Sheet, Siri/App Intents, Apple Watch.
- Auto-attach: time, location (fuzzed option), weather, steps, current walk.
- Doodle conversion: photo → crayon/pencil/watercolor style; toggle original/doodle; re-roll.
- Edit: crop, caption, draw over doodle with finger/Pencil (iPad).

### 4.2 Timeline & calendar
- Infinite vertical timeline; each day = a "day card" (scene + moments).
- Calendar month grid with doodle thumbnails (DOOD-style).
- Year view: 365-tile mosaic colored by mood or weather.
- Search: full text, transcripts, place, weather ("rainy days in Tokyo"), mood, on-device image tags (Vision framework).
- Multiple notebooks/"threads" optional (travel, a person, a project) — hidden by default.

### 4.3 Personal map (PlainWalk layer)
- Blank-canvas map; only walked road segments drawn. Frequently walked = thicker/darker.
- "Pioneered distance" stats, explorer ranks, neighborhoods "completed %".
- Real-map overlay toggle.
- Moments and spots pinned with doodle markers; tap to open.
- Map styles (paper, night, blueprint, seasonal) — premium.
- Recording modes: manual start, auto-detect walking (CoreMotion), always-on low power.
- Walk summary card + Live Activity + Watch workout; optional HealthKit write.
- Privacy zones (home/work hidden radius).

### 4.4 Day atmosphere (DayCity layer)
- Every day card shows a small isometric scene in the app style, reflecting that day's weather (clear, cloud, rain, snow, fog, storm, heat), time-of-day light and season.
- Home city + up to N "followed cities" (friends/family abroad) as living widgets — premium extra slots.
- "Craft" (premium/tickets): generate a custom scene from a prompt or from a memory.
- Past scenes gallery (last 24 h for followed cities).

### 4.5 Daily prompt (One Good Thing layer)
- One prompt/idea per day: reflection question, small observation challenge ("find something blue"), or a curated idea.
- Keep (becomes a moment) or let go. Never nags.
- Prompt packs (seasonal, travel, gratitude, creativity) — some premium.

### 4.6 Fragments box (echor layer)
- Separate fast-entry space for thoughts, quotes, overheard lines. No tags, no folders.
- Daily random fragment resurfaced; shareable as a styled image card.

### 4.11 Screenshot tidy-up (Clutter layer) — 片付け · 정리
Screenshots are the accidental diary of a day (a café address, a recipe, a train ticket, a message
from mum). Instead of a separate cleaner app, Haru files them *into the day* and into drawers.
- **Review deck**: the same 3D swipe card as the day deck. → しまう 넣기 (file into the suggested
  drawer), ← てばなす 보내기 (let go), ↑ あとで 나중에 (comes back next session). Tap a drawer in the
  wooden chest to override the destination.
- **Drawers**: かいもの shopping · おでかけ places · ごはん food · チケット tickets · やりとり chats ·
  ことば words · そのほか other. Suggestions come from on-device Vision OCR (ja/ko/en) + a shared keyword
  lexicon (`ios/Resources/clip_lexicon.json`, identical in the Python prototype and Swift; parity test).
- **Smart bits**: ticket/coupon dates → "let go after 11/14" suggestion; near-duplicate screenshots
  (Vision feature print) flagged "そっくり"; short quotes also become echor fragments that resurface;
  copy OCR text; notes and #tags; search across screenshot text in the Days search.
- **Safety**: nothing is uploaded; images stay in Photos (we store only identifier + OCR text);
  deletions are queued and committed in ONE system confirmation at the end; iOS keeps them 30 days
  in Recently Deleted. First scan only looks back 30 days so the first session stays small and calm.
- **Entry points**: a gentle Today card when ≥ 3 screenshots wait (never a badge or streak);
  drawers live in the Memories tab; each day's screenshots appear in Day detail.
- Prototype: `prototypes/tidy/` (classifier 100 % on 40 tuning samples; 90 % on a 20-sample hold-out
  *before* fixing its two misses — expect lower on real OCR; collect opt-in corrections to tune).

### 4.7 Resurfacing engine
- Sources: on this day (1 mo/1 yr/N yrs), random fragment, same place ("you were here 8 months ago"), same weather ("first snow last year"), mood bridges.
- Delivery: 1 gentle notification/day max (user-set time), widget slot, "Memory" tab card.
- Add-a-reply to a past moment (links past ↔ present).

### 4.8 Ambient surfaces
- Widgets: today's scene (S/M/L), map snippet, random memory, followed city, fragment, streak-free day counter.
- Lock screen widgets + Control Center controls (iOS 18+).
- Live Activity / Dynamic Island during walks.
- Apple Watch: quick mood/voice, walk recording, complication.
- iPad & Mac (Catalyst/SwiftUI) for browsing the atlas — later phase.

### 4.9 Recaps & sharing
- Weekly scene strip, monthly atlas page, yearly "Year in Days" book.
- Share cards (9:16 story, 1:1, 4:5) with consistent branding watermark (removable premium).
- Print: export monthly/yearly book as PDF; partner print-on-demand (phase 4).
- Optional private sharing: share a single day or a walk link with a friend (no feed).

### 4.10 Settings, data & trust
- No account required; iCloud (CloudKit private DB) sync; optional Face ID lock.
- Full export (JSON + media ZIP, GPX for walks) and import from Day One / Apple Journal (where possible) / GPX.
- Location precision control, privacy zones, delete-everything button.
- Accessibility: Dynamic Type, VoiceOver labels on scenes (auto alt text), reduced motion.

---

## 5. Screens (information architecture)

Tab bar (4 tabs + capture button):
1. **Today** — today's scene, capture button, prompt card, memory card, today's walk.
2. **Timeline** — infinite day cards / calendar / year toggle, search.
3. **Map** — personal blank map, stats, pinned moments.
4. **Memories** — resurfaced items, fragments box, screenshot drawers (引き出し), recaps.
5. Center **+** — capture sheet (photo / fragment / note / voice / mood).

Other screens: onboarding (3 screens + permission priming), day detail, moment detail, walk summary,
city scenes, Craft, settings, paywall, export, widget gallery.

Total ≈ 25–30 distinct screens/sheets.

---

## 6. Technical architecture

### 6.1 Platform choice
- **iOS first, native SwiftUI** (widgets, Live Activities, Watch, App Intents, HealthKit, CoreMotion need native anyway).
- Android later (Kotlin + Jetpack Compose) once iOS proves retention. Avoid cross-platform frameworks — this app lives on native surfaces.

### 6.2 Client stack (iOS)
- SwiftUI + Observation; SwiftData (or GRDB/SQLite for heavy map data).
- CloudKit private database for sync (CKSyncEngine).
- MapKit (overlay rendering) or MapLibre with custom blank style + Metal for path rendering.
- CoreLocation (significant-change + visits + region monitoring; precise GPS only during walks) and CoreMotion activity detection.
- WidgetKit, ActivityKit, App Intents, WatchKit, HealthKit.
- Speech framework (on-device transcription), Vision (image tags), Core ML (doodle style).
- WeatherKit (500k calls/month included with dev membership; beyond that paid).

### 6.3 Doodle / art pipeline (key cost decision)
| Option | Quality | Cost per image | Use |
|---|---|---|---|
| On-device Core ML style-transfer / edge+fill model | Good, consistent | ~$0 | Default for everyone |
| Server image-to-image (diffusion) | Best | ~$0.01–0.04 | Premium "HD doodle" / re-roll |
| Apple Image Playground / on-device gen (where available) | Variable | $0 | Optional |

Plan: train/fine-tune a small style model on a commissioned art set (hire one illustrator to define the style — this is the brand).

### 6.4 Weather scene pipeline (keeps DayCity-like visuals cheap)
- Don't generate per user. Pre-render a **shared scene library**: weather states (8) × light (6: dawn, morning, noon, dusk, night, late night) × season (4) = 192 base scenes per city archetype/style.
- Compose per user on device: base scene + city landmark layer + user doodle stickers → unique-looking day card at ~zero marginal cost.
- Real per-city generated scenes (DayCity-style) only for premium followed cities, generated once per city per hour server-side and shared across all users following that city.

### 6.5 Backend (minimal)
- Serverless (Cloudflare Workers or Supabase Edge Functions) for: premium image generation, shared city-scene cache, prompt-of-the-day feed, remote config.
- RevenueCat for subscriptions; TelemetryDeck (privacy-friendly) for analytics; Sentry/Crashlytics for crashes.
- No user content stored server-side except transient image-gen requests (deleted after processing).

### 6.6 Data model (core entities)
- `Day` (date, weatherSnapshot, sceneID, moodSummary)
- `Moment` (id, dayID, type, text, mediaRefs, doodleRef, location?, weather, createdAt, notebookID?)
- `Fragment` (id, text ≤70, createdAt, lastSurfacedAt)
- `Walk` (id, start/end, polyline (encoded), distance, pioneeredDistance, steps)
- `RoadSegment` (geohash/tileID, segmentID, visitCount, firstVisited) — tile-based for fast rendering
- `Spot` (id, name, coordinate, momentIDs)
- `Prompt` (id, text, category, date, kept?)
- `Surfacing` (itemID, type, surfacedAt, reacted?)
- `Clip` (assetIdentifier, cloudIdentifier, capturedAt, ocrText, suggestedDrawer, drawer, status inbox/kept/later/letGo, note, tags, expiresAt?, duplicateOf?, dayID)

### 6.7 Hard technical problems (budget extra time)
1. Map-matching GPS to road segments + efficient "walked roads" rendering at all zoom levels.
2. Battery: walking detection without draining (target < 3–5 %/day passive).
3. Background capture of weather/location for days the user doesn't open the app.
4. CloudKit sync of large media + conflict handling.
5. Consistent art style across doodles, scenes, map and widgets.
6. Widget memory/time limits (render scene images ahead of time).

---

## 7. Monetization

**Free (generous core):** unlimited moments & on-device doodles, timeline, basic map, 1 home city scene,
daily prompt, fragments, resurfacing, basic widgets, export.

**Daymap Plus** — ~$3.99/mo, ~$29.99/yr, ~$79–99 lifetime (match market: Kiroku $29.99/yr, DayCity $19.99/yr, One Good Thing $24.99/yr):
- HD/AI doodles & re-rolls, extra doodle styles
- Map styles, neighborhood completion, advanced stats, auto walk recording, HealthKit
- Extra followed cities + city scene widgets
- Prompt packs, recap books (PDF), watermark removal, app icons/themes
- Unlimited photo per moment, voice notes > 60 s
- Tidy-up: free = review deck + 7 drawers; Plus = custom drawers, duplicate sweep, expiry reminders, share extension

**Consumables:** Craft tickets (custom scene generation).
**Later:** printed yearly book (partner print-on-demand, margin per order).

Unit economics check: free users cost ≈ $0 (on-device art, shared scene cache, WeatherKit quota).
Paid AI usage capped per month so a $29.99/yr subscriber (≈ $25 net after Apple's 15% small-business cut) stays profitable.

---

## 8. Roadmap (solo developer + 1 contract illustrator; full-time)

| Phase | Duration | Scope | Exit criteria |
|---|---|---|---|
| **0. Foundation** | 4–6 wks | Name/trademark check, art style with illustrator, design system, prototypes of doodle model & map rendering, battery test | Style locked; doodle runs < 2 s on iPhone 12; walking map prototype < 5 % battery/day |
| **1. Core diary (v1.0)** | 10–12 wks | Capture (photo/text/mood), on-device doodle, timeline, calendar, day scene with weather library, widgets, iCloud sync, onboarding, paywall, language modes duo (JA·KO) / EN / JA / KO | TestFlight 100+ users, D7 retention ≥ 25 % |
| **2. Map (v1.5)** | 8–10 wks | Walk recording, blank map, pioneering, pinned moments, walk summary, Live Activity, Watch basics, privacy zones | Battery & accuracy OK; walks shared organically |
| **3. Memory (v2.0)** | 6–8 wks | Resurfacing engine, fragments box, daily prompts, voice notes, search, monthly recap cards | D30 retention ≥ 12 %; trial→paid ≥ 5 % |
| **3b. Tidy-up (v2.1)** | 3–4 wks | Screenshot review deck, drawers, OCR search/copy, duplicates, expiry hints, share-extension "save to drawer" | ≥ 30 % of users tidy weekly; classifier override rate < 25 % |
| **4. Atmosphere+ (v2.5)** | 6–8 wks | Followed cities, server city scenes, Craft tickets, extra map/doodle styles, iPad | Premium ARPU growth |
| **5. Expansion (v3.0)** | 3–6 mo | Android app, yearly book/print, Mac, more localizations, private day sharing | Cross-platform parity |

**Total to full feature set on iOS: ≈ 9–11 months; with Android ≈ 14–18 months.**
Public launch after Phase 1 (don't wait for everything — build in public on Threads the whole way).

---

## 9. Go-to-market

- **Build in public on Threads/X from week 1:** post doodle samples, map screenshots, scene timelapses (the art is the marketing — exactly how DOOD/DayCity/PlainWalk spread).
- Waitlist landing page with style demo (upload a photo → see doodle).
- TestFlight beta community (Discord or Threads group).
- Launch: Product Hunt, Japanese indie community (note.com, X JP), Korean Threads, r/iOSapps, App Store "Apps We Love" pitch via App Store Connect featuring nominations.
- Seasonal moments: first snow, cherry blossom, Halloween, New Year recap — timed feature drops.
- Share cards always carry a subtle Daymap mark → every share is an ad.
- ASO: localized keywords (photo diary, walking map, weather widget, journal).

---

## 10. Metrics

- North star: **days captured per active user per week**.
- Activation: first moment within 10 min of install; first widget added.
- Retention: D1 ≥ 40 %, D7 ≥ 25 %, D30 ≥ 12 % (journaling benchmarks are low — beating these is strong).
- Monetization: trial start rate, trial→paid ≥ 5–8 %, refund rate.
- Virality: share cards exported per 100 WAU.
- Health: crash-free ≥ 99.5 %, passive battery < 5 %/day.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Feature bloat kills the calm feel | Strict 4-tab IA; new layers off by default; user tests each phase |
| AI/image costs | On-device default, shared scene cache, capped premium generation |
| Battery/location complaints | Motion-gated GPS, low-power mode, clear permission priming |
| Privacy concerns (photos + location) | No account, iCloud-only, privacy zones, fuzzed location, no server storage |
| Copycats | Distinct commissioned art style + accumulated personal data (map/years) = switching cost |
| Name conflicts (common app names) | Trademark & App Store search before branding |
| App Review (background location justification) | Clear in-app purpose strings; location tied to visible walk feature |
| Solo-dev burnout / scope | Phase gates; ship v1 publicly before building phases 2–5 |

---

## 12. Budget estimate (first year, solo)

| Item | Estimate (USD) |
|---|---|
| Apple Developer Program | 99 |
| Illustrator (style + ~200 assets + scene library) | 3,000–8,000 |
| Backend/serverless + image-gen API | 20–200 / month (scales with premium users) |
| RevenueCat | free until $2.5k MTR, then 1 % |
| Domain, landing page, email | 100–200 |
| Devices for testing (older iPhone, Watch) | 300–800 (optional) |
| Localization review (native speakers) | 500–1,500 |
| **Total year 1** | **≈ $4.5k–12k** + your time |

---

## 13. Skills you'll need (or need to learn)

Swift/SwiftUI, WidgetKit/ActivityKit, CoreLocation/CoreMotion, MapKit or MapLibre + Metal basics, CloudKit,
Core ML (model conversion with coremltools), basic serverless backend, App Store/ASO, art direction.
AI coding assistants speed this up a lot, but map rendering, battery tuning and sync need hands-on testing on real devices.

---

## 14. Immediate next steps (first 2 weeks)

1. Pick the name; check App Store, domain, trademark (JP/US/KR).
2. Write a 1-page style brief; find an illustrator; make 5 sample doodles + 3 weather scenes.
3. Prototype A: photo → on-device doodle (Core ML) — measure speed/quality.
4. Prototype B: record a walk → draw roads on blank map — measure battery.
5. Figma: Today, Timeline, Map, Capture sheet, widget.
6. Set up landing page + waitlist; first "building this" post on Threads.
