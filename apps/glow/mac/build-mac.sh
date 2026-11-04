#!/bin/bash
# Builds Glow-mac.dmg: Glow, GlowLead, GlowChat and GlowRoom as Mac apps (Apple chip and Intel in one).
# Each app opens its Glow page in its own window of Chrome, Edge, Brave or Chromium with your normal
# browser profile, so all four share one Glow account, your chats and missions (same as the Windows setup).
# Needs a Mac with the Xcode command line tools (clang, sips, iconutil, codesign, hdiutil).
#
#   bash apps/glow/mac/build-mac.sh [output folder, default apps/glow/mac/dist]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
glow="$(dirname "$here")"
web="$glow/web"
out="${1:-$here/dist}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

site="https://juw12.github.io/projects/glow/"
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$web/version.json" | head -n 1)"
[ -n "$version" ] || { echo "Could not read the Glow version from web/version.json" >&2; exit 1; }
echo "Building Glow $version for Mac"

# Name | page under the Glow site | icon (512 px PNG under web/) | bundle id suffix
apps=(
    "Glow||icons/icon-512.png|glow"
    "GlowLead|lead/|icons/icon-512.png|lead"
    "GlowChat|chat/|chat/icons/icon-512.png|chat"
    "GlowRoom|room/|room/assets/icon-512.png|room"
)

# One universal launcher program, shared by every app.
clang -Os -Wall -Werror -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 \
    -o "$work/launcher" "$here/launcher.c"

make_icns() {
    local png="$1" icns="$2"
    local iconset="$work/AppIcon.iconset"
    rm -rf "$iconset"
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
        sips -z "$size" "$size" "$png" --out "$iconset/icon_${size}x${size}.png" > /dev/null
        local double=$((size * 2))
        if [ "$double" -le 512 ]; then
            sips -z "$double" "$double" "$png" --out "$iconset/icon_${size}x${size}@2x.png" > /dev/null
        else
            cp "$png" "$iconset/icon_${size}x${size}@2x.png"
        fi
    done
    iconutil -c icns "$iconset" -o "$icns"
}

stage="$work/stage"
mkdir -p "$stage/Glow"
for entry in "${apps[@]}"; do
    IFS='|' read -r name page icon id <<< "$entry"
    bundle="$stage/Glow/$name.app"
    mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
    cp "$work/launcher" "$bundle/Contents/MacOS/$name"
    cp "$here/open-glow.sh" "$bundle/Contents/Resources/open-glow.sh"
    chmod 755 "$bundle/Contents/MacOS/$name" "$bundle/Contents/Resources/open-glow.sh"
    printf '%s\n' "$site$page" > "$bundle/Contents/Resources/glow-page.txt"
    make_icns "$web/$icon" "$bundle/Contents/Resources/AppIcon.icns"
    cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>$name</string>
    <key>CFBundleExecutable</key><string>$name</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>io.github.juw12.glow.$id</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>$name</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$version</string>
    <key>CFBundleVersion</key><string>$version</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSHumanReadableCopyright</key><string>Glow by juw12, MIT license</string>
</dict>
</plist>
PLIST
    plutil -lint "$bundle/Contents/Info.plist" > /dev/null
    # Ad-hoc signature (no Apple developer account): macOS asks once, see the note in the disk image.
    codesign --force --sign - --timestamp=none "$bundle"
    echo "  $name.app -> $site$page"
done

cat > "$stage/If macOS blocks Glow.txt" <<'NOTE'
Glow for Mac

1. Drag the Glow folder onto Applications.
2. Open Applications > Glow > Glow (or GlowLead, GlowChat, GlowRoom).

The first time, macOS says it can't check Glow for malicious software, because Glow isn't notarized
by Apple (that needs a paid Apple developer account). To open it anyway:
  System Settings > Privacy & Security > scroll down > "Glow was blocked..." > Open Anyway.
Or do it for all four apps at once in Terminal:
  xattr -dr com.apple.quarantine /Applications/Glow

Each app opens Glow in its own window of Google Chrome, Microsoft Edge, Brave or Chromium (your default
browser if it is one of those), with your normal browser profile, so they share your Glow account and
chats. With only Safari, Glow opens in Safari: choose File > Add to Dock there for an app window.
Uninstall: drag the Glow folder to the Bin. Your chats stay in your browser.
Web: https://juw12.github.io/projects/glow/
NOTE
ln -s /Applications "$stage/Applications"

dmg="$out/Glow-mac.dmg"
rm -f "$dmg"
# hdiutil sometimes fails with "Resource busy" while macOS scans the new files: try again.
for attempt in 1 2 3 4 5; do
    if hdiutil create -volname "Glow" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg" > /dev/null; then
        break
    fi
    [ "$attempt" -lt 5 ] || { echo "hdiutil create failed" >&2; exit 1; }
    sleep 5
done
echo "Built $dmg ($(du -h "$dmg" | cut -f1))"
