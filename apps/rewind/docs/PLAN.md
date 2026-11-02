# Rewind v1.1 — "complete app" plan

## Goals
Make Rewind feel like a finished product: user preferences, light/dark mode,
proper navigation, and app-level housekeeping. No change to the data model.

## 1. Appearance
- **Theme:** System / Light / Dark. "System" follows the device setting and updates live.
- **Quick toggle:** a sun/moon button in the top bar.
- **No flash on load:** the saved theme is applied before the page draws.
- **Accent colour:** Gold, Rose, Teal or Blue, each tuned separately for light and dark.
- **Text size:** Default or Large.
- **Card density:** Comfortable or Compact.
- **Reduce motion:** a switch, which also respects the operating-system setting.

## 2. Settings page (new tab; gear icon on desktop, 4th bottom tab on phone)
- **Appearance:** the options above.
- **Profile:** display name (local mode) or account email plus sign-out (online mode).
- **Browsing:** start page, default sort, and "hide series already streaming".
- **Data:** export/import a backup and reset the archive (local mode). Moved here from the footer.
- **About:** version, storage mode, availability disclaimer, and reset settings.

## 3. Navigation
- Each page and each open series gets its own web address
  (`#/browse`, `#/shelf`, `#/feed`, `#/settings`, `#/show/<id>`).
- The browser and phone back buttons close the series panel.
- Links to a specific series can be shared.
- **Share** button on each series: uses the phone's share sheet, or copies the link.

## 4. Small touches
- Pressing `/` jumps to search.
- An on-screen message when the device goes offline or reconnects.
- The light theme gets its own colours, shadows and browser theme colour.

## 5. Verification
- Re-run the existing 21 checks, plus new ones for: theme switch and persistence, accent,
  settings saving, hide-streaming filter, routing and back button, reset settings, and display name.
- Screenshots: desktop light and dark, the Settings page, and phone light mode.
