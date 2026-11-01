"""Microsoft Teams Incoming Webhook poster (stdlib only)."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def post_to_teams(webhook_url: str, title: str, text: str, color: str = "DC3545") -> bool:
    """POST a simple MessageCard to the given Teams webhook. Returns True on success."""
    if not webhook_url:
        return False
    body = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": title,
        "themeColor": color,
        "title": title,
        "text": text,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        webhook_url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            ok = 200 <= r.getcode() < 300
            if not ok:
                print(f"[teams] non-2xx: {r.getcode()}", file=sys.stderr)
            return ok
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"[teams] post failed: {e}", file=sys.stderr)
        return False
