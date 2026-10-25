"""Clone the owner's voice (ElevenLabs Instant Voice Clone) and synthesise narration with it.

    python voice_clone.py create            # upload secrets/voice/sample.wav -> voice id
    python voice_clone.py say "Halo!" out.mp3
    python voice_clone.py status

Key lookup order: env ELEVENLABS_API_KEY, then secrets/elevenlabs_key (chmod 600).
Voice id lookup: env ELEVENLABS_VOICE_ID, then secrets/voice/voice.json.
Only standard library is used, so it also runs unchanged in GitHub Actions.

Only clone a voice you own. YouTube does not require an AI disclosure for a clone of
your own voice used as narration, but the scripts must still be accurate.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
SECRETS = HERE / "secrets"
KEY_FILE = SECRETS / "elevenlabs_key"
VOICE_DIR = SECRETS / "voice"
VOICE_FILE = VOICE_DIR / "voice.json"
SAMPLE = VOICE_DIR / "sample.wav"
API = __import__("os").environ.get("ELEVENLABS_API_BASE", "https://api.elevenlabs.io/v1")

DEFAULT_SETTINGS = {
    "model": "eleven_multilingual_v2",
    "language": "id",
    "stability": 0.45,
    "similarity_boost": 0.85,
    "style": 0.25,
    "speed": 1.08,
}


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        raise SystemExit("No ElevenLabs key: set ELEVENLABS_API_KEY or save it via voice_recorder.py")
    return key


def voice_id():
    found = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
    if not found and VOICE_FILE.exists():
        found = json.loads(VOICE_FILE.read_text()).get("voice_id", "")
    if not found:
        raise SystemExit("No cloned voice yet: run `python voice_clone.py create`")
    return found


def request(method, path, body=None, headers=None, retries=3):
    all_headers = {"xi-api-key": api_key(), **(headers or {})}
    for attempt in range(retries):
        req = urllib.request.Request(API + path, data=body, headers=all_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:400]
            if error.code in (429, 500, 502, 503) and attempt < retries - 1:
                time.sleep(4 * (attempt + 1))
                continue
            raise RuntimeError(f"ElevenLabs {error.code}: {detail}") from None
    raise RuntimeError("ElevenLabs: retries exhausted")


def multipart(fields, files):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for name, path in files:
        header = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
            "Content-Type: audio/wav\r\n\r\n"
        ).encode()
        parts.append(header + path.read_bytes() + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def create(name="Galau Checkout narrator", sample=SAMPLE):
    if not sample.exists():
        raise SystemExit(f"Missing {sample}: record it first with voice_recorder.py")
    body, content_type = multipart(
        {
            "name": name,
            "description": "Owner's own voice, Indonesian, casual explainer narration",
            "remove_background_noise": "true",
        },
        [("files", sample)],
    )
    if VOICE_FILE.exists():  # replace the previous clone instead of piling up voice slots
        previous = json.loads(VOICE_FILE.read_text()).get("voice_id")
        if previous:
            try:
                request("DELETE", f"/voices/{previous}")
            except RuntimeError:
                pass
    result = json.loads(request("POST", "/voices/add", body, {"Content-Type": content_type}))
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    record = {"voice_id": result["voice_id"], "name": name, "created": time.strftime("%Y-%m-%d %H:%M")}
    VOICE_FILE.write_text(json.dumps(record, indent=2))
    if result.get("requires_verification"):
        print("NOTE: ElevenLabs asks to verify this voice in the web app before use.")
    return record


def synthesize(text, out_path, settings=None):
    """Write an MP3 of `text` in the cloned voice. `settings` overrides DEFAULT_SETTINGS."""
    config = {**DEFAULT_SETTINGS, **(settings or {})}
    payload = {
        "text": text,
        "model_id": config["model"],
        "language_code": config["language"],
        "voice_settings": {
            "stability": config["stability"],
            "similarity_boost": config["similarity_boost"],
            "style": config["style"],
            "use_speaker_boost": True,
            "speed": config["speed"],
        },
    }
    path = f"/text-to-speech/{config.get('voice_id') or voice_id()}?output_format=mp3_44100_128"
    headers = {"Content-Type": "application/json", "Accept": "audio/mpeg"}
    try:
        audio = request("POST", path, json.dumps(payload).encode(), headers)
    except RuntimeError as error:
        if "language" not in str(error).lower():
            raise
        payload.pop("language_code")  # model without language enforcement: let it auto-detect
        audio = request("POST", path, json.dumps(payload).encode(), headers)
    Path(out_path).write_bytes(audio)
    return Path(out_path)


def status():
    user = json.loads(request("GET", "/user/subscription"))
    used = user.get("character_count")
    limit = user.get("character_limit")
    print(f"plan={user.get('tier')}  credits used {used}/{limit}  voice clone allowed={user.get('can_use_instant_voice_cloning')}")
    if VOICE_FILE.exists():
        print("voice:", VOICE_FILE.read_text().strip())


def main(argv):
    if not argv or argv[0] not in ("create", "say", "status"):
        raise SystemExit(__doc__)
    if argv[0] == "create":
        print(json.dumps(create(), indent=2))
    elif argv[0] == "say":
        text = argv[1] if len(argv) > 1 else "Halo! Ini suara aku, versi clone. Gimana, mirip nggak?"
        out = argv[2] if len(argv) > 2 else str(VOICE_DIR / "clone_test.mp3")
        print(synthesize(text, out))
    else:
        status()


if __name__ == "__main__":
    main(sys.argv[1:])
