#!/bin/zsh
# macOS: starts Twin for this Mac and your iPhone (same Wi-Fi).
cd "$(dirname "$0")"
exec /usr/bin/env python3 server.py --lan "$@"
