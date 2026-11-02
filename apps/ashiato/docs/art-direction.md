# Ashiato — art direction: "slow, cozy, JP/KR indie"

The feeling: a Sunday afternoon in a Kyoto side street or a Seoul villa alley —
washi paper, a vending machine humming, laundry on a balcony, a cat asleep on a step.
Nothing hurries. Every day becomes a small keepsake card you can hold and tilt.

Reference prototype: `prototypes/cozy3d/index.html` (run `python -m http.server` inside
`prototypes/cozy3d`, open http://localhost:8000). iOS implementation:
`ios/Ashiato/Theme.swift`, `ios/Ashiato/Views/SwipeDeckView.swift`.

## 1. Palette

| Token | Hex | Use |
|---|---|---|
| paper (washi) | `#F6EFE2` | app background, always with paper grain |
| paperDeep | `#EFE4D0` | grouped surfaces, placeholders |
| card | `#FFFAF1` | card stock |
| ink (sumi plum) | `#3A3240` | text — never pure black |
| muted | `#9A8F93` | secondary text |
| sakura | `#F4B9C6` | washi tape, "new road" pill, spring |
| matcha | `#9DBF8E` | walk pill, prompts |
| hojicha | `#B07A5A` | shadows (warm, never grey), paper fibres |
| persimmon | `#E8875A` | accent / tint, selection |
| yuzu | `#F2C14E` | lamplight, sun, season pill |
| indigo (ai-iro) | `#4F5D7E` | night, memory ribbon |
| hanko | `#D2493F` | mood stamp only |

Rules: shadows are tinted hojicha at 15–30 % opacity; no pure black or pure white text;
at most one saturated accent per card besides the hanko.

## 2. Typography (all SIL OFL, bundled in `ios/Resources/Fonts`)

| Role | Font | PostScript name |
|---|---|---|
| UI, rounded | Zen Maru Gothic Regular / Bold | `ZenMaruGothic-Regular`, `ZenMaruGothic-Bold` |
| Handwritten JA/EN notes | Klee One | `KleeOne-Regular` |
| Handwritten KO notes | Nanum Pen Script (×1.35 size) | `NanumPen-Regular` |
| Soft Korean UI | Gowun Dodum | `GowunDodum-Regular` |

Notes pick their hand font by script (`String.containsHangul`). Dates are big rounded
numerals (`11/02`), with the weekday in both languages underneath: `日曜日 · 일요일`.

Font files add ~27 MB. Before shipping, subset Klee One / Gowun Dodum to the JIS level-1 +
KS X 1001 sets (pyftsubset) — expected < 8 MB total.

## 3. Copy voice

- Four language modes (`ios/Shared/Language.swift`, web `prototypes/cozy3d/i18n.js`):
  **duo** (Japanese · Korean side by side — the signature look), **English**, **日本語**, **한국어**.
  Default: duo on Japanese/Korean phones, English everywhere else. Switch in Today → gear (web: header pill or `?lang=en`).
- Short, lowercase-feeling. Japanese mostly hiragana; English stays soft and small ("a little walk?", "keep", "let go").
- Weather: はれ · 맑음 / clear, あめ · 비 / rain, ゆき · 눈 / snow … (`CozyLabel` in `Language.swift`).
- Never "streak", "goal", "you missed". Prefer invitations: さんぽに行こう · 산책 갈까요 · "a little walk?".
- Memories: 1年前 · 1년 전 / "1 year ago" on an indigo bookmark ribbon.
- The hanko seal keeps its kanji in every mode (it is art, not text); its accessibility label is localized.
- User notes are never machine-translated.

## 4. Paper objects

- **Card**: 28 pt continuous corners, card stock + fibre grain (`PaperGrain`), 1 pt hojicha hairline.
- **Diorama window**: 20 pt corners, 3 pt white inner frame, weather chip in ultra-thin material.
- **Polaroid**: white frame, washi tape across the top (sakura, torn ends, dot print), rotated −5°.
- **Hanko**: one kanji in a red ring, rotated −12°, 85 % opacity, multiply blend.
  Mood → 休 rest, 静 quiet, 和 calm, 良 good, 嬉 happy.
- **Pills**: tint at 35 % fill + 60 % hairline, rounded font 12 pt.

## 5. Motion — slow and soft

| Motion | Spec |
|---|---|
| Card throw / page change | spring 0.9 s, bounce 0.1 (≈ `cubic-bezier(.22,1,.36,1)`) |
| Cancelled swipe | spring 0.6 s, bounce 0.22 |
| Drag | card follows finger; rotates up to 14° about its bottom edge; 3D Y-turn up to 28°; perspective 0.55 |
| Deck at rest | cards below are 5 % smaller per level, 16 pt lower, alternately −2.8° / +2.2° |
| Device tilt | ±6° Y / ±5° X on the top card; scene layer moves −6 pt, polaroid +9 pt, hanko +3 pt (fake depth) |
| Haptic | one soft impact (0.55) when a card lands — never on drag |
| Ambient loops | ≥ 4 s per cycle (cat breathing, sheen) |
| Reduce Motion | no tilt, no throw animation; cards cross-fade |

Swipe left = an older day, right = back toward today. Ends of the deck rubber-band at 25 %.

**Tidy deck (片付け · 정리)**: → しまう (green stamp), ← てばなす (hanko red), ↑ あとで (indigo).
Kept cards shrink into their drawer in the wooden chest (0.9 s spring) and the drawer bumps
6 pt; let-go cards fall into the pink てばなす drawer — never a trash can, never "delete" in copy.

## 6. Diorama scenes (`prototypes/cozy3d/diorama.js`)

- One chunky rounded street-corner tile, seen from a fixed ¾ camera (distance 22.5, height 12.6).
- Fixed cast so every day feels like *the same neighbourhood*: gable-roof house with noren,
  Korean villa with balconies / laundry / AC units, café kiosk with striped awning,
  glowing vending machine, utility poles + sagging wires, street lamp, red post box,
  bicycle, bench, sleeping cat.
- Seasons: sakura → green + sunflowers → ginkgo / maple → bare branches + snow caps.
- Weather adds particles (rain lines, snow, petals, leaves), lightning, fog (19–36 units).
- Time of day changes sky gradient, sun/moon, window glow and lamp light.
- 8 weather × 6 times × 4 seasons = 192 renders, 512 px JPEG q86 (5.3 MB) in
  `ios/Resources/Scenes`. Regenerate with `prototypes/cozy3d/render.html` + `shoot.py`.

This is still procedural art. An illustrator should repaint the hero assets (or texture
the models) in this palette before launch; the structure and names stay the same.
