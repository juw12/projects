#!/usr/bin/env bash
# Glow Hands for an always-on Linux machine (Oracle Cloud free VM, Raspberry Pi, old laptop...).
#
#   curl -fsSL https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/install-glow-hands-linux.sh | bash
#
# Installs Glow Hands with a hidden browser, starts it now and after every reboot (systemd), and prints
# a QR code + link: open it on your phone once and GlowLead on the phone uses this machine's browser.
# Tested on Ubuntu 22.04 / 24.04 (x86-64 and Arm). Safe to run again to update.
#
# Options (environment variables):
#   GLOW_HANDS_SOURCE=/path/or/url   use this glow_hands.py instead of the latest from GitHub
#   GLOW_HANDS_NO_SERVICE=1          only install; don't create or start the background service
#   GLOW_HANDS_PORT=8765             local port (only used on this machine)
set -euo pipefail

SOURCE="${GLOW_HANDS_SOURCE:-https://raw.githubusercontent.com/juw12/projects/main/apps/glow/hands/glow_hands.py}"
HOME_DIR="${HOME:?HOME is not set}"
BASE="$HOME_DIR/.local/share/GlowHands"
VENV="$BASE/venv"
APP="$BASE/app/glow_hands.py"
PORT="${GLOW_HANDS_PORT:-8765}"
PLAYWRIGHT_VERSION="1.55.0"

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nGlow Hands setup stopped: %s\n' "$*" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO="sudo"
  elif command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
    echo "Some steps need administrator rights; you may be asked for your password."
  fi
fi
can_admin() { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }

say "Checking Python"
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1 && can_admin; then
    $SUDO apt-get update -qq
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv python3-pip >/dev/null
  else
    fail "Python 3.10+ with venv is needed. On Ubuntu: sudo apt-get install python3-venv"
  fi
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail "Python 3.10 or newer is needed."

say "Installing Glow Hands into $BASE"
mkdir -p "$BASE/app"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet "playwright==$PLAYWRIGHT_VERSION" qrcode

case "$SOURCE" in
  http://*|https://*) curl -fsSL "$SOURCE" -o "$APP.download" ;;
  *) cp "$SOURCE" "$APP.download" ;;
esac
grep -q '^VERSION = ' "$APP.download" || fail "The downloaded Glow Hands file looks wrong."
mv "$APP.download" "$APP"
VERSION="$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$APP" | head -n 1)"

say "Installing the hidden browser (Chromium)"
if can_admin; then
  # --with-deps installs the system libraries Chromium needs (uses apt).
  $SUDO "$VENV/bin/python" -m playwright install-deps chromium >/dev/null
fi
"$VENV/bin/python" -m playwright install chromium >/dev/null

# Tiny VMs (1 GB) need some swap for a browser.
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
SWAP_KB="$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${GLOW_HANDS_NO_SERVICE:-0}" != "1" ] && [ "$MEM_KB" -lt 1800000 ] && [ "$SWAP_KB" -eq 0 ] && can_admin; then
  say "Adding 2 GB of swap (this machine has little memory)"
  $SUDO fallocate -l 2G /swapfile && $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile >/dev/null && $SUDO swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

mkdir -p "$HOME_DIR/.local/bin"
cat > "$HOME_DIR/.local/bin/glow-hands-link" <<EOF
#!/usr/bin/env bash
# Show the phone link again. Use --new to turn off old phone links and make a new one.
set -euo pipefail
if [ "\${1:-}" = "--new" ]; then
  rm -f "$BASE/phone-link.json"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files glow-hands.service >/dev/null 2>&1; then
    sudo systemctl restart glow-hands.service
    sleep 5
  fi
fi
exec "$VENV/bin/python" "$APP" --profile "$BASE" --show-phone-link
EOF
chmod +x "$HOME_DIR/.local/bin/glow-hands-link"

if [ "${GLOW_HANDS_NO_SERVICE:-0}" = "1" ]; then
  say "Glow Hands $VERSION installed (no background service)."
  exit 0
fi

command -v systemctl >/dev/null 2>&1 || fail "systemd was not found; start it yourself: $VENV/bin/python $APP --headless"
can_admin || fail "Administrator rights (sudo) are needed to start Glow Hands at boot."

say "Starting Glow Hands now and after every reboot"
$SUDO tee /etc/systemd/system/glow-hands.service >/dev/null <<EOF
[Unit]
Description=Glow Hands (browser control for GlowLead)
Wants=network-online.target
After=network-online.target

[Service]
User=$(id -un)
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python -X utf8 $APP --headless --port $PORT --profile $BASE
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable glow-hands.service >/dev/null 2>&1
$SUDO systemctl restart glow-hands.service

for _ in $(seq 1 30); do
  [ -s "$BASE/phone-link.json" ] && break
  sleep 2
done
[ -s "$BASE/phone-link.json" ] || fail "Glow Hands didn't start. Check: sudo journalctl -u glow-hands -n 50"

say "Glow Hands $VERSION is running. Scan this with your phone (or open the link on it):"
"$VENV/bin/python" "$APP" --profile "$BASE" --show-phone-link
echo
echo "Show the link again later:   ~/.local/bin/glow-hands-link"
echo "Turn off old phone links:    ~/.local/bin/glow-hands-link --new"
echo "Logs:                        sudo journalctl -u glow-hands -f"
