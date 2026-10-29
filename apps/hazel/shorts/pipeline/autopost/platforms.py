"""Platform clients for Shortcraft autopost (standard library only).

YouTube  — Data API v3 resumable upload, OAuth installed-app flow (refresh token).
TikTok   — Content Posting API, Direct Post with FILE_UPLOAD. Unaudited API clients can only
           post SELF_ONLY (private) and the account must be private; public posting needs TikTok's audit.
Instagram— Instagram Graph API Reels: container -> status poll -> media_publish.
           mode "url": video must be reachable at a public URL (public_base_url + file name).
           mode "resumable": local upload via rupload.facebook.com (Facebook Login apps).
Endpoints follow the official docs as of Oct 2026; API versions are configurable.
"""

import base64
import hashlib
import json
import os
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


class PlatformError(RuntimeError):
    pass


def http(method, url, data=None, headers=None, timeout=300):
    body = data
    if isinstance(data, dict):
        body = json.dumps(data).encode("utf-8")
        headers = dict(headers or {}, **{"Content-Type": "application/json; charset=UTF-8"})
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, dict(resp.headers), raw
    except urllib.error.HTTPError as err:
        raise PlatformError(f"{method} {url.split('?')[0]} -> {err.code}: {err.read()[:400]!r}") from None


def form(url, fields):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    _, _, raw = http("POST", url, data, {"Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(raw)


def load_json(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass


def loopback_code(auth_url_builder, port):
    """Open the browser for consent and capture ?code= on a loopback redirect."""
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in query.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<h2>Shortcraft: authorised. You can close this tab.</h2>")

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    redirect = f"http://127.0.0.1:{port}/callback"
    url = auth_url_builder(redirect)
    print("Opening browser for consent:\n" + url)
    webbrowser.open(url)
    thread.join(timeout=300)
    server.server_close()
    if "code" not in result:
        raise PlatformError(f"No authorisation code received ({result.get('error', 'timeout')})")
    return result["code"], redirect


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def pkce_pair():
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


# ----------------------------------------------------------------------------- YouTube
class YouTube:
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    SCOPE = "https://www.googleapis.com/auth/youtube.upload"

    def __init__(self, cfg, token_path):
        secrets_file = load_json(cfg["client_secrets"])
        info = secrets_file.get("installed") or secrets_file.get("web")
        self.client_id = info["client_id"]
        self.client_secret = info["client_secret"]
        self.cfg = cfg
        self.token_path = token_path

    def authorize(self):
        verifier, challenge = pkce_pair()

        def build(redirect):
            return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
                "client_id": self.client_id, "redirect_uri": redirect, "response_type": "code",
                "scope": self.SCOPE, "access_type": "offline", "prompt": "consent",
                "code_challenge": challenge, "code_challenge_method": "S256",
            })

        code, redirect = loopback_code(build, free_port())
        tok = form(self.TOKEN_URL, {
            "code": code, "client_id": self.client_id, "client_secret": self.client_secret,
            "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier,
        })
        if "refresh_token" not in tok:
            raise PlatformError("Google did not return a refresh token")
        save_json(self.token_path, {"refresh_token": tok["refresh_token"]})
        print(f"YouTube authorised -> {self.token_path}")

    def access_token(self):
        stored = load_json(self.token_path)
        if not stored:
            raise PlatformError(f"Not authorised. Run: autopost.py auth youtube --channel <name>")
        tok = form(self.TOKEN_URL, {
            "refresh_token": stored["refresh_token"], "client_id": self.client_id,
            "client_secret": self.client_secret, "grant_type": "refresh_token",
        })
        return tok["access_token"]

    def post(self, video_path, meta, dry_run=False):
        body = {
            "snippet": {
                "title": (meta["title"] + " #Shorts")[:100],
                "description": meta["description"][:4900],
                "tags": meta.get("tags", [])[:15],
                "categoryId": str(self.cfg.get("category_id", "27")),
                "defaultLanguage": meta.get("lang", "en"),
                "defaultAudioLanguage": meta.get("lang", "en"),
            },
            "status": {
                "privacyStatus": self.cfg.get("privacy", "public"),
                "selfDeclaredMadeForKids": False,
            },
        }
        if dry_run:
            return {"dry_run": True, "request": body}
        token = self.access_token()
        size = os.path.getsize(video_path)
        _, headers, _ = http(
            "POST",
            "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
            body,
            {"Authorization": f"Bearer {token}", "X-Upload-Content-Type": "video/mp4",
             "X-Upload-Content-Length": str(size)},
        )
        location = headers.get("Location") or headers.get("location")
        if not location:
            raise PlatformError("YouTube: no resumable upload URL returned")
        data = Path(video_path).read_bytes()
        _, _, raw = http("PUT", location, data, {"Authorization": f"Bearer {token}",
                                                 "Content-Type": "video/mp4"}, timeout=1800)
        video = json.loads(raw)
        return {"id": video["id"], "url": f"https://youtube.com/shorts/{video['id']}"}


# ----------------------------------------------------------------------------- TikTok
class TikTok:
    AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
    TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
    API = "https://open.tiktokapis.com/v2"

    def __init__(self, cfg, token_path):
        self.cfg = cfg
        self.token_path = token_path

    def authorize(self):
        verifier, challenge = pkce_pair()
        state = secrets.token_urlsafe(16)
        port = int(self.cfg.get("redirect_port", 8723))

        def build(redirect):
            return self.AUTH_URL + "?" + urllib.parse.urlencode({
                "client_key": self.cfg["client_key"], "scope": "user.info.basic,video.publish",
                "response_type": "code", "redirect_uri": redirect, "state": state,
                "code_challenge": challenge, "code_challenge_method": "S256",
            })

        code, redirect = loopback_code(build, port)
        tok = form(self.TOKEN_URL, {
            "client_key": self.cfg["client_key"], "client_secret": self.cfg["client_secret"],
            "code": code, "grant_type": "authorization_code", "redirect_uri": redirect,
            "code_verifier": verifier,
        })
        if "refresh_token" not in tok:
            raise PlatformError(f"TikTok token error: {tok}")
        save_json(self.token_path, tok)
        print(f"TikTok authorised -> {self.token_path} (redirect URI registered must be {redirect})")

    def access_token(self):
        stored = load_json(self.token_path)
        if not stored:
            raise PlatformError("Not authorised. Run: autopost.py auth tiktok --channel <name>")
        tok = form(self.TOKEN_URL, {
            "client_key": self.cfg["client_key"], "client_secret": self.cfg["client_secret"],
            "grant_type": "refresh_token", "refresh_token": stored["refresh_token"],
        })
        if "access_token" not in tok:
            raise PlatformError(f"TikTok refresh failed: {tok}")
        save_json(self.token_path, tok)
        return tok["access_token"]

    def post(self, video_path, meta, dry_run=False):
        size = os.path.getsize(video_path)
        chunk = size if size <= 64 * 1024 * 1024 else 10 * 1024 * 1024
        chunks = max(1, size // chunk)
        privacy = self.cfg.get("privacy_level", "SELF_ONLY")
        body = {
            "post_info": {"title": meta["caption"][:2200], "privacy_level": privacy,
                          "disable_duet": False, "disable_comment": False, "disable_stitch": False},
            "source_info": {"source": "FILE_UPLOAD", "video_size": size,
                            "chunk_size": chunk, "total_chunk_count": chunks},
        }
        if dry_run:
            return {"dry_run": True, "request": body}
        token = self.access_token()
        auth = {"Authorization": f"Bearer {token}"}
        _, _, raw = http("POST", f"{self.API}/post/publish/creator_info/query/", {}, auth)
        options = json.loads(raw).get("data", {}).get("privacy_level_options", [])
        if options and privacy not in options:
            raise PlatformError(f"TikTok privacy {privacy} not allowed; options: {options}")
        _, _, raw = http("POST", f"{self.API}/post/publish/video/init/", body, auth)
        data = json.loads(raw)["data"]
        upload_url, publish_id = data["upload_url"], data["publish_id"]
        blob = Path(video_path).read_bytes()
        for i in range(chunks):
            start = i * chunk
            end = size - 1 if i == chunks - 1 else start + chunk - 1
            http("PUT", upload_url, blob[start:end + 1], {
                "Content-Type": "video/mp4", "Content-Length": str(end - start + 1),
                "Content-Range": f"bytes {start}-{end}/{size}",
            }, timeout=900)
        for _ in range(60):
            _, _, raw = http("POST", f"{self.API}/post/publish/status/fetch/", {"publish_id": publish_id}, auth)
            st = json.loads(raw).get("data", {})
            if st.get("status") in ("PUBLISH_COMPLETE", "FAILED"):
                break
            time.sleep(5)
        if st.get("status") == "FAILED":
            raise PlatformError(f"TikTok publish failed: {st}")
        return {"publish_id": publish_id, "status": st.get("status"), "privacy": privacy}


# ----------------------------------------------------------------------------- Instagram
class Instagram:
    def __init__(self, cfg, token_path):
        self.cfg = cfg
        self.token_path = token_path
        self.version = cfg.get("api_version", "v23.0")

    def token(self):
        stored = load_json(self.token_path) or {}
        return stored.get("access_token") or self.cfg.get("access_token")

    def refresh(self):
        """Extend a long-lived Instagram-Login token (valid 60 days) — run weekly."""
        url = "https://graph.instagram.com/refresh_access_token?" + urllib.parse.urlencode(
            {"grant_type": "ig_refresh_token", "access_token": self.token()})
        _, _, raw = http("GET", url)
        save_json(self.token_path, json.loads(raw))

    def post(self, video_path, meta, dry_run=False):
        mode = self.cfg.get("mode", "url")
        host = "graph.facebook.com" if mode == "resumable" else "graph.instagram.com"
        base = f"https://{host}/{self.version}/{self.cfg['ig_user_id']}"
        params = {"media_type": "REELS", "caption": meta["caption"][:2200], "share_to_feed": "true"}
        if mode == "url":
            params["video_url"] = self.cfg["public_base_url"].rstrip("/") + "/" + Path(video_path).name
        else:
            params["upload_type"] = "resumable"
        if dry_run:
            return {"dry_run": True, "endpoint": base + "/media", "params": params}
        token = self.token()
        params["access_token"] = token
        _, _, raw = http("POST", base + "/media?" + urllib.parse.urlencode(params))
        container = json.loads(raw)
        cid = container["id"]
        if mode == "resumable":
            data = Path(video_path).read_bytes()
            http("POST", container["uri"], data, {
                "Authorization": f"OAuth {token}", "offset": "0", "file_size": str(len(data)),
            }, timeout=900)
        status_url = f"https://{host}/{self.version}/{cid}?" + urllib.parse.urlencode(
            {"fields": "status_code,status", "access_token": token})
        for _ in range(60):
            _, _, raw = http("GET", status_url)
            st = json.loads(raw)
            if st.get("status_code") in ("FINISHED", "ERROR", "EXPIRED"):
                break
            time.sleep(5)
        if st.get("status_code") != "FINISHED":
            raise PlatformError(f"Instagram container not ready: {st}")
        _, _, raw = http("POST", base + "/media_publish?" + urllib.parse.urlencode(
            {"creation_id": cid, "access_token": token}))
        return {"id": json.loads(raw).get("id")}


CLIENTS = {"youtube": YouTube, "tiktok": TikTok, "instagram": Instagram}
