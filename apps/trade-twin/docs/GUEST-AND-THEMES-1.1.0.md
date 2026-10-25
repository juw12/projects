# Trade Twin 1.1.0 — guest trial and appearance

## Requirements delivered

- **Continue as guest** is the primary welcome action. No username, password, email or assessment.
- Named demo profiles and local-server login remain optional, unchanged and separate.
- Guest state is sessionStorage-backed, with an in-memory fallback when browser storage is denied.
  Defaults are labelled *not assessed*, and the preferences quiz remains optional.
- No guest request creates a backend account or mutates a named profile. All guest financial actions
  use the dated bundled snapshot and practice cash, even if the page is served by the live server.
- Guest reset/exit require confirmation and remove only guest data. Theme preference is independent.
- Appearance supports **System / Light / Dark**, applied before the first paint, retained across reloads,
  and synchronized across same-origin tabs. System mode responds to device preference changes.
- Canvas charts, text, pills, errors, sheets, navigation, controls and the desktop overview use theme tokens.
  Changing theme does not change balances, holdings, simulation outputs or risk limits.
- Keyboard focus rings, reachable close buttons, Escape, dialog focus containment and reduced-motion styles.

## Additional tester friction fixed

- Guest Home offers useful trial actions instead of immediately asking visitors to install the app.
- Unsupported live-market controls are disabled in the snapshot trial. Stock detail links route to
  the actual bundled TSLA replay, not an impossible live trade. Replay ticker is read-only in demo mode.
- Snapshot copy mode previews unavailable quotes. The result states positions filled/skipped, amount
  used and cash left over. An empty copy is no longer described as successfully copying a portfolio.
- SEC email prompts are shown only for live server use; the guest research snapshot needs no email.
- Closed dialogs are inert so keyboard users do not tab into invisible offscreen controls.

## Test coverage

The existing API and calculation checks remain. The real Chromium harness now additionally exercises:
guest startup, account separation, practice trades, goal simulation, the entire replay pipeline,
partial copy, optional-quiz exit, session resume, reset/exit, storage-denied mode without password APIs,
light/dark rendering, chart redraw, saved/system appearance, sample contrast checks, narrow layouts
and keyboard dialog dismissal. Tests use a fresh browser profile, never real account data.

## Limits

Guest mode is a public snapshot trial, not free live brokerage access. Browser storage is not a secure
vault; no sensitive information is requested. Tabs opened with an opener can inherit an initial session
copy according to browser behaviour, but subsequent session writes are independent. No automatic
migration of guest trades into saved accounts is claimed. Appearance persistence requires browser
storage; otherwise it applies only to the current page. Chromium checks are not a Safari/iOS certification
or a complete accessibility conformance audit. No real orders are sent; not financial advice.

## Observed verification

- 46 existing API checks and 10 calculation/pipeline regressions passed.
- 88 real-browser checks passed, including the guest and theme cases above.
- Real Chromium device emulation confirmed both directions of System-theme changes without reload.
- Light and dark screenshots were reviewed at a 390px phone viewport with no horizontal overflow.
- Sample text/secondary-text/positive-text/median-line contrast checks met 4.5:1 in both palettes.
  This is targeted testing, not a claim that every screen meets all WCAG requirements.

## Cache-safe upgrades

The new entry point versions its JavaScript/CSS URLs. This prevents a previously installed worker
from serving old demo code to the new guest UI. The worker precaches those exact versioned assets
and both normal and versioned entry URLs for offline use. Existing accounts are not cleared on upgrade.

Latest integrated repository check: 20 suites passed, zero skipped, zero failed; 42 HTML pages passed link validation.
