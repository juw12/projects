#!/bin/sh
# Vitals one-step installer for macOS and Linux.
#
#   curl -fsSL https://juw12.github.io/projects/vitals/install.sh | sh
#
# What it does (nothing needs admin rights; everything lives in your home folder):
#   1. Checks for Python 3.8+ (macOS: offers Apple's free developer tools if missing).
#   2. Downloads Vitals into ~/.vitals/app (about 250 KB).
#   3. Adds a "Vitals" app (macOS: ~/Applications, Linux: app menu).
#   4. Starts Vitals quietly at login, then opens the dashboard.
#
# Re-run the same command to update. Uninstall:
#   curl -fsSL https://juw12.github.io/projects/vitals/install.sh | sh -s -- --uninstall
# Your history and Undo Vault in ~/.vitals are kept unless you delete them.
#
# Test/dev overrides: VITALS_SOURCE=<local apps/vitals dir>, VITALS_RAW=<base URL>,
# VITALS_NO_AUTOSTART=1 (skip login item), VITALS_NO_START=1 (don't launch).
set -eu

RAW="${VITALS_RAW:-https://raw.githubusercontent.com/juw12/projects/main/apps/vitals}"
ROOT="$HOME/.vitals"
APP="$ROOT/app"
PORT=8765
LABEL="io.github.juw12.vitals"
OS="$(uname -s)"

say() { printf '\033[1;32m›\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

stop_running() {
  # Ask a running Vitals to exit so updated files take effect.
  token=$(curl -fs -m 2 "http://127.0.0.1:$PORT/api/session" 2>/dev/null | sed -n 's/.*"token": *"\([^"]*\)".*/\1/p') || true
  if [ -n "${token:-}" ]; then
    curl -fs -m 2 -X POST -H "X-Vitals-Token: $token" "http://127.0.0.1:$PORT/api/shutdown" >/dev/null 2>&1 || true
    sleep 1
  fi
}

uninstall() {
  say "Removing Vitals…"
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
    rm -rf "$HOME/Applications/Vitals.app"
  else
    rm -f "$HOME/.config/autostart/vitals.desktop" "$HOME/.local/share/applications/vitals.desktop"
  fi
  stop_running
  rm -rf "$APP"
  say "Done. Your history and Undo Vault are still in $ROOT — delete that folder to remove everything."
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

# ------------------------------------------------------------------ Python
find_python() {
  for candidate in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
      "$candidate" -c 'import sys; print(sys.executable)'
      return 0
    fi
  done
  return 1
}

PY="$(find_python || true)"
if [ -z "$PY" ]; then
  if [ "$OS" = "Darwin" ]; then
    warn "Vitals needs Apple's free Command Line Tools (they include Python)."
    xcode-select --install >/dev/null 2>&1 || true
    fail "A window just opened — click Install, wait for it to finish, then run this same command again."
  else
    fail "Python 3.8+ is needed. Install it (e.g. 'sudo apt install python3') and run this command again."
  fi
fi
say "Using Python: $PY"

# ---------------------------------------------------------------- download
TMP="$(mktemp -d "${TMPDIR:-/tmp}/vitals.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  # fetch <relative path> <destination>
  mkdir -p "$(dirname "$2")"
  if [ -n "${VITALS_SOURCE:-}" ]; then
    cp "$VITALS_SOURCE/$1" "$2"
  else
    curl -fsSL --retry 2 "$RAW/$1" -o "$2"
  fi
}

say "Downloading Vitals…"
fetch "web/files.txt" "$TMP/files.txt"
count=0
while IFS= read -r path; do
  case "$path" in ''|'#'*) continue ;; esac
  fetch "$path" "$TMP/app/$path"
  count=$((count + 1))
done < "$TMP/files.txt"
[ -f "$TMP/app/server/server.py" ] || fail "Download incomplete — check your connection and try again."

stop_running
mkdir -p "$ROOT"
rm -rf "$APP.old"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$TMP/app" "$APP"
rm -rf "$APP.old"
say "Installed $count files in $APP"

# ------------------------------------------------------------ app + login
if [ "$OS" = "Darwin" ]; then
  BUNDLE="$HOME/Applications/Vitals.app"
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
  cat > "$BUNDLE/Contents/MacOS/Vitals" <<EOF
#!/bin/sh
# Opens the Vitals dashboard, starting the agent first if needed.
nohup "$PY" "$APP/server/server.py" --open >/dev/null 2>&1 &
EOF
  chmod +x "$BUNDLE/Contents/MacOS/Vitals"
  cat > "$BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Vitals</string>
  <key>CFBundleDisplayName</key><string>Vitals</string>
  <key>CFBundleIdentifier</key><string>$LABEL.app</string>
  <key>CFBundleExecutable</key><string>Vitals</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
  sips -s format icns "$APP/web/icons/icon-512.png" --out "$BUNDLE/Contents/Resources/AppIcon.icns" >/dev/null 2>&1 || true
  touch "$BUNDLE"
  say "Added Vitals to $BUNDLE (find it with Spotlight: ⌘ Space, type Vitals)"

  if [ -z "${VITALS_NO_AUTOSTART:-}" ]; then
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$APP/server/server.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT/agent.log</string>
  <key>StandardErrorPath</key><string>$ROOT/agent.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null || true
    say "Vitals will start quietly when you log in"
  fi
else
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/vitals.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Vitals
Comment=Device health copilot
Exec="$PY" "$APP/server/server.py" --open
Icon=$APP/web/icons/icon-512.png
Terminal=false
Categories=System;Utility;
EOF
  if [ -z "${VITALS_NO_AUTOSTART:-}" ]; then
    mkdir -p "$HOME/.config/autostart"
    sed 's/ --open//' "$HOME/.local/share/applications/vitals.desktop" > "$HOME/.config/autostart/vitals.desktop"
    say "Vitals will start quietly when you log in"
  fi
  say "Added Vitals to your app menu"
fi

# ------------------------------------------------------------------- start
if [ -z "${VITALS_NO_START:-}" ]; then
  nohup "$PY" "$APP/server/server.py" --open >>"$ROOT/agent.log" 2>&1 &
  i=0
  while [ $i -lt 20 ]; do
    if curl -fs -m 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      say "Vitals is running — your browser is opening http://127.0.0.1:$PORT/"
      exit 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  warn "Vitals is starting… if the browser doesn't open, visit http://127.0.0.1:$PORT/"
fi
say "All set."
