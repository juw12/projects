#!/bin/bash
# Opens one Glow page in its own app window, like the Windows Start menu shortcuts do.
# build-mac.sh writes the page address into glow-page.txt next to this script.
#   1. Your default browser, if it is Chrome, Edge, Brave, Chromium or Vivaldi (keeps your Glow account).
#   2. Otherwise the first of those that is installed.
#   3. Otherwise the default browser (Safari): there, File > Add to Dock makes a Glow app window.
# GLOW_DRY_RUN=1 prints what would be opened instead of opening it (used by the CI test).
set -u

here="$(cd "$(dirname "$0")" && pwd)"
url="$(tr -d '\r\n' < "$here/glow-page.txt" 2>/dev/null)"
[ -n "$url" ] || url="https://juw12.github.io/projects/glow/"

app_window_browsers=("Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium" "Vivaldi")

default_browser() {
    /usr/bin/osascript -l JavaScript -e '
        ObjC.import("AppKit");
        var app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://example.com"));
        app.isNil() ? "" : ObjC.unwrap(app.path);' 2>/dev/null
}

supports_app_window() {
    local name
    name="$(basename "$1" .app)"
    for browser in "${app_window_browsers[@]}"; do
        [ "$name" = "$browser" ] && return 0
    done
    return 1
}

pick_browser() {
    local preferred
    preferred="$(default_browser)"
    if [ -n "$preferred" ] && [ -d "$preferred" ] && supports_app_window "$preferred"; then
        printf '%s\n' "$preferred"
        return 0
    fi
    for browser in "${app_window_browsers[@]}"; do
        for folder in "/Applications" "$HOME/Applications"; do
            if [ -d "$folder/$browser.app" ]; then
                printf '%s\n' "$folder/$browser.app"
                return 0
            fi
        done
    done
    return 1
}

if browser="$(pick_browser)"; then
    if [ -n "${GLOW_DRY_RUN:-}" ]; then
        echo "app-window|$browser|$url"
        exit 0
    fi
    # -n passes --app even when the browser is already running; it hands the window to that browser.
    exec /usr/bin/open -na "$browser" --args "--app=$url"
fi

if [ -n "${GLOW_DRY_RUN:-}" ]; then
    echo "default-browser||$url"
    exit 0
fi
exec /usr/bin/open "$url"
