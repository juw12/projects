"""Ready-made external checker for Fade: Sightengine (violence, gore, weapons, hate symbols, nudity).

Fade's built-in classifier only knows nudity. This adapter gives a Fade server the rest through
Sightengine's hosted models (free tier: 2,000 checks / month, 500 / day — see sightengine.com/pricing):

    SIGHTENGINE_USER=... SIGHTENGINE_SECRET=... python3 server/server.py --scan-hook sightengine
or as a separate service any Fade server can call:
    SIGHTENGINE_USER=... SIGHTENGINE_SECRET=... python3 server/hook_sightengine.py --port 8955
    python3 server/server.py --scan-hook http://127.0.0.1:8955/check

Requests follow Sightengine's documented API: multipart POST of the file ("media") to
/1.0/check.json (images) or /1.0/video/check-sync.json (videos up to 1 minute) with `models`,
`api_user`, `api_secret`. Responses are mapped onto Fade's hook answer
{"action": "allow"|"review"|"block", "reason": "...", "labels": [...]}.

The parser is deliberately tolerant: a model score may arrive as a number, as {"prob": x}, or as
{"classes": {...}} depending on the model version, and every frame of a video is checked (worst wins).
Thresholds are conservative for a barbershop app: knives/razors are NOT flagged (barbers use them),
only firearms; a middle finger is ignored; gore, violence, hate symbols and sexual content are.

Not verified against the live API from this repo (it needs account keys); tests use a mock that
returns Sightengine's documented response shapes.
"""
import argparse
import json
import os
import uuid
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_BASE = os.environ.get("SIGHTENGINE_API", "https://api.sightengine.com/1.0")
MODELS = os.environ.get("SIGHTENGINE_MODELS", "nudity-2.1,gore-2.0,violence,weapon,offensive-2.0")
TIMEOUT_S = 60

# (label, how to read the score, review at, block at)
RULES = (
    ("sexual", ("nudity", ("sexual_activity", "sexual_display", "erotica")), 0.5, 0.85),
    ("gore", ("gore", ("prob",)), 0.5, 0.85),
    ("violence", ("violence", ("prob",)), 0.5, 0.85),
    ("firearm", ("weapon", ("firearm", "firearm_gesture")), 0.6, 0.95),
    ("hate-symbol", ("offensive", ("nazi", "supremacist", "confederate", "terrorist")), 0.6, 0.9),
)


def _numbers(value, keys):
    """Collect the scores named `keys` from a number / {"prob"} / {"classes"} / nested dict."""
    found = []
    if isinstance(value, (int, float)):
        return [float(value)] if "prob" in keys else []
    if not isinstance(value, dict):
        return found
    for key, item in value.items():
        if key in keys and isinstance(item, (int, float)):
            found.append(float(item))
        elif isinstance(item, dict) and key in ("classes", "prob", "weapon", "weapons_classes"):
            found.extend(_numbers(item, keys))
    return found


def score_frame(frame):
    """{label: score} for one image / video frame response."""
    scores = {}
    for label, (field, keys), _, _ in RULES:
        values = _numbers(frame.get(field), keys)
        if field == "weapon":
            values += _numbers(frame.get("weapons_classes"), keys)
        if values:
            scores[label] = max(values)
    return scores


def decide(response):
    """Map a Sightengine response (image or video) to Fade's hook answer."""
    if response.get("status") != "success":
        message = (response.get("error") or {}).get("message") or "Sightengine request failed"
        raise RuntimeError(message)
    frames = (response.get("data") or {}).get("frames") or [response]
    worst = {}
    for frame in frames:
        for label, value in score_frame(frame).items():
            worst[label] = max(worst.get(label, 0.0), value)
    action = "allow"
    labels = []
    for label, _, review_at, block_at in RULES:
        value = worst.get(label, 0.0)
        if value >= block_at:
            action = "block"
            labels.append(label)
        elif value >= review_at:
            if action == "allow":
                action = "review"
            labels.append(label)
    reason = ", ".join(f"{label} {round(worst[label] * 100)}%" for label in labels)
    return {"action": action, "reason": f"Sightengine: {reason}" if reason else "Sightengine: clean",
            "labels": labels, "scores": {k: round(v, 3) for k, v in worst.items()}}


def multipart(fields, file_bytes, content_type):
    boundary = f"fade{uuid.uuid4().hex}"
    lines = []
    for name, value in fields.items():
        lines.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    extension = {"image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm",
                 "video/quicktime": "mov"}.get(content_type, "jpg")
    lines.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"media\"; filename=\"upload.{extension}\"\r\n"
                 f"Content-Type: {content_type}\r\n\r\n".encode())
    lines.append(file_bytes)
    lines.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(lines), f"multipart/form-data; boundary={boundary}"


def check_media(data, content_type, user=None, secret=None, api_base=None, models=None):
    user = user or os.environ.get("SIGHTENGINE_USER")
    secret = secret or os.environ.get("SIGHTENGINE_SECRET")
    if not user or not secret:
        raise RuntimeError("set SIGHTENGINE_USER and SIGHTENGINE_SECRET (free keys at sightengine.com)")
    endpoint = "video/check-sync.json" if content_type.startswith("video/") else "check.json"
    body, header = multipart({"models": models or MODELS, "api_user": user, "api_secret": secret}, data, content_type)
    request = urllib.request.Request(f"{(api_base or API_BASE).rstrip('/')}/{endpoint}", data=body, method="POST",
                                     headers={"Content-Type": header, "User-Agent": "Fade-hook/1"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as err:  # Sightengine answers errors with a JSON body too
        payload = json.loads(err.read().decode("utf-8", "replace") or "{}")
    return decide(payload)


class HookHandler(BaseHTTPRequestHandler):
    """Fade hook protocol: POST raw file, Content-Type of the upload -> {"action", "reason", "labels"}."""

    def log_message(self, *args):
        pass

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            answer = check_media(data, self.headers.get("Content-Type") or "image/jpeg")
            status = 200
        except Exception as err:  # Fade keeps the upload hidden and retries when the checker fails
            answer = {"error": str(err)[:200]}
            status = 502
        body = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Sightengine adapter for Fade's --scan-hook")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8955)
    args = parser.parse_args()
    print(f"Fade Sightengine hook on http://{args.host}:{args.port}/check  (models: {MODELS})")
    ThreadingHTTPServer((args.host, args.port), HookHandler).serve_forever()


if __name__ == "__main__":
    main()
