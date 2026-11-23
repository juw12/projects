#!/bin/sh
# Runs TradeBot's Indodax sender on a Mac. PRACTICE BY DEFAULT: no order reaches Indodax.
#
#   ./run-mac.sh             keep copying, one cycle a minute (in this Terminal window)
#   ./run-mac.sh show        what it would do right now: no orders, no report
#   ./run-mac.sh once        one cycle, then stop
#   ./run-mac.sh check       does the Indodax API key work? prints the free rupiah, orders nothing
#   ./run-mac.sh clear       clear the safety stop, after you have looked at Indodax
#   ./run-mac.sh test        the sender's own tests (a pretend exchange, no network)
#
#   ./run-mac.sh background on     keep the sender running with no window: macOS starts it when you
#                                  sign in and again within a minute if it ever ends
#   ./run-mac.sh background off    stop that, and stop the sender
#   ./run-mac.sh background        is it running in the background?
#
# The Python to use: $INDODAX_PYTHON, then .venv next to this script, then the first python3 that is
# 3.10 or newer.
# A proxy: HTTPS_PROXY in the environment, or in .env.
#
# It is off until .env next to this script holds INDODAX_BRIDGE_KEY: without the key it says so and
# stops. Real money needs more than that, on purpose. See README.md before switching anything on.
#
# In the background the sender runs under `caffeinate -i`, so the Mac does not fall asleep by itself
# while it runs. A closed lid without a screen attached, an empty battery or signing out still stop
# it, and then nothing is watched and nothing is sold. The same sender must not run on two computers.
#
# Nothing to install: the sender uses only what comes with Python.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

label="dev.juw12.tradebot-sender"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$here/desk_sender.log"

# The first Python that is 3.10 or newer: the sender's tests pass on 3.10 and up, three of them fail on 3.9
# (the one Apple ships as /usr/bin/python3).
python=""
older=""
for candidate in "${INDODAX_PYTHON:-}" "$here/.venv/bin/python" "$(command -v python3 || true)" \
    /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
    if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
        continue
    fi
    if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
        python=$candidate
        break
    fi
    older=${older:-$candidate}
done
if [ -z "$python" ] && [ -n "$older" ]; then
    python=$older
    echo "Only an older Python was found ($python). The sender is tested on Python 3.10 and newer." >&2
fi
if [ -z "$python" ]; then
    echo "Python not found. Install Python 3.10 or newer, then run this again." >&2
    exit 1
fi

# A Python from python.org comes without the list of certificate authorities until its "Install
# Certificates" step is run, and then every call to TradeBot and to Indodax fails. macOS has that list.
if [ -z "${SSL_CERT_FILE:-}" ] && [ -f /etc/ssl/cert.pem ]; then
    SSL_CERT_FILE=/etc/ssl/cert.pem
    export SSL_CERT_FILE
fi

background_running() {
    launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1
}

background_on() {
    if [ ! -f "$here/.env" ]; then
        echo "No .env: nothing was started. Copy .env.example to .env and fill in INDODAX_BRIDGE_KEY." >&2
        exit 1
    fi
    mkdir -p "$(dirname "$plist")"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-i</string>
        <string>$python</string>
        <string>$here/bridge.py</string>
        <string>--log</string>
        <string>$log</string>
    </array>
    <key>WorkingDirectory</key><string>$here</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SSL_CERT_FILE</key><string>${SSL_CERT_FILE:-}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>60</integer>
    <key>ProcessType</key><string>Standard</string>
    <key>StandardOutPath</key><string>$here/background.out</string>
    <key>StandardErrorPath</key><string>$here/background.out</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "The sender now runs in the background, with no window. macOS starts it at sign-in and looks after it."
    echo "Its lines: $log"
}

background_off() {
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "The sender no longer runs in the background."
}

case "${1:-}" in
    "")     exec "$python" bridge.py ;;
    show)   exec "$python" bridge.py --show ;;
    once)   exec "$python" bridge.py --once ;;
    check)  exec "$python" bridge.py --check ;;
    clear)  exec "$python" bridge.py --clear ;;
    test)   exec "$python" -m unittest ;;
    background)
        case "${2:-}" in
            on)  background_on ;;
            off) background_off ;;
            "")
                if background_running; then
                    echo "The sender runs in the background. Its lines: $log"
                else
                    echo "The sender does not run in the background."
                fi
                ;;
            *)
                echo "background takes on or off." >&2
                exit 2
                ;;
        esac
        ;;
    *)
        sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
