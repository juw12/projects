#!/bin/bash
# Checks a built Glow-mac.dmg on a Mac: disk image, apps, signatures, both chip types, the page each app
# opens, and (with --launch) that GlowChat really opens an app window in Google Chrome.
#   bash apps/glow/mac/test-mac.sh dist/Glow-mac.dmg [--launch]
set -euo pipefail

dmg="$1"
launch="${2:-}"
site="https://juw12.github.io/projects/glow/"
fail() { echo "FAIL: $*" >&2; exit 1; }

hdiutil verify "$dmg" > /dev/null || fail "disk image does not verify"
mount_point="$(mktemp -d)"
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_point" > /dev/null
trap 'hdiutil detach "$mount_point" -force > /dev/null 2>&1 || true' EXIT

[ -L "$mount_point/Applications" ] || fail "no Applications shortcut in the disk image"
[ -f "$mount_point/If macOS blocks Glow.txt" ] || fail "missing install note"

check_app() {
    local name="$1" page="$2"
    local bundle="$mount_point/Glow/$name.app"
    [ -d "$bundle" ] || fail "$name.app is missing"
    plutil -lint "$bundle/Contents/Info.plist" > /dev/null || fail "$name Info.plist is invalid"
    [ "$(defaults read "$bundle/Contents/Info" CFBundleExecutable)" = "$name" ] || fail "$name: wrong executable name"
    [ -f "$bundle/Contents/Resources/AppIcon.icns" ] || fail "$name: no icon"
    codesign --verify --strict --verbose=1 "$bundle" || fail "$name: signature does not verify"
    local archs
    archs="$(lipo -archs "$bundle/Contents/MacOS/$name")"
    [[ "$archs" == *arm64* && "$archs" == *x86_64* ]] || fail "$name: not universal ($archs)"
    local result
    result="$(GLOW_DRY_RUN=1 "$bundle/Contents/MacOS/$name")"
    echo "  $name: $result"
    [ "${result##*|}" = "$site$page" ] || fail "$name opens ${result##*|}, expected $site$page"
    if [ -d "/Applications/Google Chrome.app" ]; then
        [[ "$result" == app-window\|* ]] || fail "$name did not pick an app-window browser although Chrome is installed"
    fi
}

check_app Glow ""
check_app GlowLead "lead/"
check_app GlowChat "chat/"
check_app GlowRoom "room/"

if [ "$launch" = "--launch" ]; then
    [ -d "/Applications/Google Chrome.app" ] || fail "--launch needs Google Chrome"
    open "$mount_point/Glow/GlowChat.app"
    for attempt in $(seq 1 30); do
        if pgrep -f -- "--app=${site}chat/" > /dev/null; then
            echo "  GlowChat opened an app window in Google Chrome"
            pkill -f -- "--app=${site}chat/" || true
            echo "OK"
            exit 0
        fi
        sleep 1
    done
    # Chrome may hand the window to an already running copy; then the window title shows the page.
    if osascript -e 'tell application "Google Chrome" to get URL of active tab of every window' 2>/dev/null | grep -q "glow/chat"; then
        echo "  GlowChat opened in the running Google Chrome"
        echo "OK"
        exit 0
    fi
    fail "GlowChat did not open a Chrome app window within 30 s"
fi
echo "OK"
