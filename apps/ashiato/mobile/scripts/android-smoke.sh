#!/usr/bin/env bash
# Installs the debug APK on the CI emulator, opens Ashiato and saves screenshots of a few screens.
set -euo pipefail
APK="$1"
OUT="$2"
mkdir -p "$OUT"
adb install -r "$APK"
adb shell pm grant io.github.juw12.ashiato android.permission.ACCESS_FINE_LOCATION || true
adb shell pm grant io.github.juw12.ashiato android.permission.ACCESS_COARSE_LOCATION || true
adb shell am start -W -n io.github.juw12.ashiato/.MainActivity
sleep 25
adb exec-out screencap -p > "$OUT/android-01-launch.png"
# Onboarding: "Next" twice and start with the sample days (taps are in % of the screen).
read -r WIDTH HEIGHT < <(adb shell wm size | tail -n 1 | sed -E 's/.*: ([0-9]+)x([0-9]+).*/\1 \2/')
tap() { adb shell input tap $((WIDTH * $1 / 100)) $((HEIGHT * $2 / 100)); sleep "${3:-3}"; }
tap 50 94
tap 50 94
adb exec-out screencap -p > "$OUT/android-02-onboarding.png"
tap 50 94 6
adb exec-out screencap -p > "$OUT/android-03-after-onboarding.png"
adb logcat -d -s Capacitor:* Capacitor/Console:* chromium:* > "$OUT/android-logcat.txt" || true
if grep -qiE "Uncaught|SyntaxError|TypeError|ReferenceError" "$OUT/android-logcat.txt"; then
  echo "::warning::JavaScript errors in logcat"
  grep -iE "Uncaught|SyntaxError|TypeError|ReferenceError" "$OUT/android-logcat.txt" | head -n 20
fi
adb shell pidof io.github.juw12.ashiato > /dev/null || { echo "::error::Ashiato is not running after launch"; exit 1; }
ls -la "$OUT"
