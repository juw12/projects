#!/usr/bin/env python3
"""Glow Hands: lets GlowLead use a real browser on your PC.

GlowLead (a static web page) cannot control other websites by itself. This small local program
opens a separate Chromium/Edge window and performs one action at a time when GlowLead asks:
open a page, click, type, choose an option, press a key, scroll or go back.

Safety model
- Listens only on 127.0.0.1. Every request except /status needs the pairing token.
- Only the Glow web app origins (and localhost for development) may call it from a browser.
- The Host header must be 127.0.0.1/localhost, which blocks DNS-rebinding attacks.
- Risky clicks/keys (submit, buy, pay, send, delete, post, sign up, Enter inside a form...) are
  refused until GlowLead re-sends them with your explicit approval.
- It never types into password, card-number or one-time-code fields: you do that yourself in the
  visible window. Navigation to file:, private network and loopback addresses is blocked by default.
- It uses its own browser profile, not your everyday browser, so it only has the logins you give it.

Requires: Python 3.10+ and `pip install playwright`. Use `--channel msedge` (Windows) or
`--channel chrome` to reuse an installed browser, or run `python -m playwright install chromium`.
"""
import argparse
import hmac
import http.server
import ipaddress
import json
import os
import re
import secrets
import socket
import sys
import urllib.parse
from pathlib import Path

VERSION = "0.1.0"
DEFAULT_PORT = 8765
ALLOWED_ORIGINS = {"https://juw12.github.io", "https://juwpegatron.github.io"}
LOCAL_ORIGIN = re.compile(r"^http://(127\.0\.0\.1|localhost)(:\d{1,5})?$")
MAX_BODY = 64 * 1024
MAX_ELEMENTS = 120
RISKY_WORDS = re.compile(
    r"\b(submit|send|buy|pay|purchase|order|checkout|check out|place|confirm|delete|remove|transfer|post|publish|"
    r"book|reserve|subscribe|sign ?up|register|apply|donate|unsubscribe|cancel|withdraw|accept|agree|log ?out)\b",
    re.IGNORECASE,
)
SECRET_AUTOCOMPLETE = re.compile(r"(cc-|one-time-code|current-password|new-password)", re.IGNORECASE)

OBSERVE_SCRIPT = r"""
() => {
  document.querySelectorAll('[data-glow-ref]').forEach((node) => node.removeAttribute('data-glow-ref'));
  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],' +
    '[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[contenteditable=true]';
  const elements = [];
  for (const node of document.querySelectorAll(selector)) {
    if (elements.length >= MAX) break;
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    const ref = elements.length + 1;
    node.setAttribute('data-glow-ref', String(ref));
    const tag = node.tagName.toLowerCase();
    const type = (node.getAttribute('type') || '').toLowerCase();
    const label = node.labels && node.labels[0] ? node.labels[0].innerText : '';
    const name = (node.getAttribute('aria-label') || label || node.innerText ||
      (tag === 'input' && ['submit', 'button'].includes(type) ? node.value : '') ||
      node.getAttribute('placeholder') || node.getAttribute('title') || node.getAttribute('name') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
    const secret = type === 'password' || /(cc-|one-time-code|password)/i.test(node.getAttribute('autocomplete') || '');
    elements.push({
      ref, tag, type, role: node.getAttribute('role') || '', name,
      value: secret ? '' : String(node.value || '').slice(0, 60),
      secret, inForm: !!node.closest('form'),
      href: tag === 'a' ? String(node.href || '').slice(0, 140) : '',
      options: tag === 'select' ? [...node.options].slice(0, 20).map((o) => o.text.trim().slice(0, 40)) : undefined,
    });
  }
  const text = document.body ? document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 5000) : '';
  return { elements, text, hasPassword: !!document.querySelector('input[type=password]') };
}
""".replace("MAX", str(MAX_ELEMENTS))

ELEMENT_INFO = r"""
(node) => {
  const tag = node.tagName.toLowerCase();
  const type = (node.getAttribute('type') || '').toLowerCase();
  const form = node.closest('form');
  const label = node.labels && node.labels[0] ? node.labels[0].innerText : '';
  const name = (node.getAttribute('aria-label') || label || node.innerText || node.value ||
    node.getAttribute('title') || node.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const submits = tag === 'input' ? ['submit', 'image'].includes(type)
    : tag === 'button' ? (type === '' || type === 'submit') && !!form : false;
  return { tag, type, name, inForm: !!form, submits, autocomplete: node.getAttribute('autocomplete') || '',
    editable: node.isContentEditable || ['input', 'textarea', 'select'].includes(tag) };
}
"""


class HandsError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.status = status
        self.extra = extra


def host_is_private(hostname):
    """True when a hostname resolves to loopback, private, link-local or otherwise internal addresses."""
    if not hostname:
        return True
    if hostname.lower() in {"localhost", "localhost.localdomain"}:
        return True
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False  # Unresolvable: the browser will fail on its own.
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%")[0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
            return True
    return False


def check_url(url, allow_private):
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise HandsError("Only http and https pages can be opened.")
    if parsed.username or parsed.password:
        raise HandsError("Links with embedded usernames or passwords are refused.")
    if not allow_private and host_is_private(parsed.hostname):
        raise HandsError("Private network and local addresses are blocked. Start Glow Hands with --allow-private to permit them.")
    return parsed.geturl()


class Browser:
    """One visible browser window driven from the server thread (Playwright's sync API is single-threaded)."""

    def __init__(self, profile_dir, headless=False, channel=None, allow_private=False):
        self.profile_dir = Path(profile_dir)
        self.headless = headless
        self.channel = channel
        self.allow_private = allow_private
        self._playwright = None
        self._context = None
        self.page = None

    def ensure(self):
        if self.page and not self.page.is_closed():
            return self.page
        if self._context is None:
            from playwright.sync_api import sync_playwright
            self._playwright = sync_playwright().start()
            options = {"headless": self.headless, "viewport": {"width": 1280, "height": 860}}
            if self.channel:
                options["channel"] = self.channel
            self.profile_dir.mkdir(parents=True, exist_ok=True)
            self._context = self._playwright.chromium.launch_persistent_context(str(self.profile_dir / "browser"), **options)
            self._context.route("**/*", self._guard_navigation)
        pages = [page for page in self._context.pages if not page.is_closed()]
        self.page = pages[0] if pages else self._context.new_page()
        return self.page

    def _guard_navigation(self, route):
        request = route.request
        if request.is_navigation_request():
            parsed = urllib.parse.urlparse(request.url)
            if parsed.scheme in {"http", "https"} and not self.allow_private and host_is_private(parsed.hostname):
                return route.abort("blockedbyclient")
            if parsed.scheme == "file":
                return route.abort("blockedbyclient")
        return route.continue_()

    def settle(self):
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:
            pass
        self.page.wait_for_timeout(250)

    def observe(self):
        page = self.ensure()
        try:
            snapshot = page.evaluate(OBSERVE_SCRIPT)
        except Exception:
            self.settle()
            snapshot = page.evaluate(OBSERVE_SCRIPT)
        return {"url": page.url, "title": page.title(), **snapshot}

    def element(self, ref):
        try:
            ref = int(ref)
        except (TypeError, ValueError):
            raise HandsError("This action needs a numeric element ref from the latest observation.")
        locator = self.page.locator(f'[data-glow-ref="{ref}"]')
        if locator.count() != 1:
            raise HandsError(f"Element [{ref}] is no longer on the page. Observe again.", status=409, stale=True)
        return locator, locator.evaluate(ELEMENT_INFO)

    def act(self, action, approved=False):
        page = self.ensure()
        kind = str(action.get("action") or "")
        if kind == "goto":
            url = check_url(action.get("url"), self.allow_private)
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
        elif kind == "back":
            page.go_back(wait_until="domcontentloaded", timeout=15000)
        elif kind == "scroll":
            delta = -700 if str(action.get("direction")) == "up" else 700
            page.mouse.wheel(0, delta)
        elif kind == "click":
            locator, info = self.element(action.get("ref"))
            if not approved and (info["submits"] or RISKY_WORDS.search(info["name"] or "")):
                raise HandsError(f"Clicking “{info['name'] or info['tag']}” may submit, send or change something.",
                                 status=409, needsApproval=True, target=info["name"] or info["tag"])
            locator.click(timeout=8000)
        elif kind in {"type", "select"}:
            locator, info = self.element(action.get("ref"))
            text = str(action.get("text") or "")[:500]
            if info["type"] == "password" or SECRET_AUTOCOMPLETE.search(info["autocomplete"]):
                raise HandsError("Glow Hands never types passwords, card numbers or one-time codes. Type it yourself in the Glow Hands window.",
                                 status=403, secret=True)
            if not info["editable"]:
                raise HandsError(f"Element [{action.get('ref')}] is not a text field or list.")
            if kind == "select":
                locator.select_option(label=text, timeout=8000)
            else:
                locator.fill(text, timeout=8000)
        elif kind == "press":
            key = str(action.get("key") or "")
            if key not in {"Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp"}:
                raise HandsError("Only Enter, Tab, Escape, arrow and page keys are allowed.")
            in_form = page.evaluate("() => !!(document.activeElement && document.activeElement.closest('form'))")
            if key == "Enter" and in_form and not approved:
                raise HandsError("Pressing Enter here may submit the form.", status=409, needsApproval=True, target="Enter in a form")
            page.keyboard.press(key)
        else:
            raise HandsError("Unknown action. Use goto, click, type, select, press, scroll or back.")
        self.settle()
        return {"url": page.url, "title": page.title()}

    def close(self):
        if self._context is not None:
            try:
                self._context.close()
            finally:
                self._context = None
                self.page = None
        if self._playwright is not None:
            self._playwright.stop()
            self._playwright = None


def make_handler(browser, token, port, extra_origins):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    origins = ALLOWED_ORIGINS | set(extra_origins)

    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "GlowHands/" + VERSION

        def log_message(self, fmt, *args):
            sys.stderr.write("[glow-hands] " + (fmt % args) + "\n")

        def origin_allowed(self):
            origin = self.headers.get("Origin")
            return origin is None or origin in origins or bool(LOCAL_ORIGIN.match(origin))

        def send_json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin and self.origin_allowed():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def guard(self, need_token=True):
            if self.headers.get("Host") not in allowed_hosts:
                self.send_json(403, {"error": "Unexpected Host header."})
                return False
            if not self.origin_allowed():
                self.send_json(403, {"error": "This website is not allowed to use Glow Hands."})
                return False
            if need_token and not hmac.compare_digest(self.headers.get("X-Glow-Token", ""), token):
                self.send_json(401, {"error": "Wrong or missing pairing token."})
                return False
            return True

        def do_OPTIONS(self):
            if self.headers.get("Host") not in allowed_hosts or not self.origin_allowed() or not self.headers.get("Origin"):
                self.send_response(403)
                self.end_headers()
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Glow-Token")
            self.send_header("Access-Control-Max-Age", "600")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise HandsError("Request too large.", status=413)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                raise HandsError("Invalid JSON.")
            if not isinstance(data, dict):
                raise HandsError("Expected a JSON object.")
            return data

        def do_GET(self):
            if self.path == "/status":
                if not self.guard(need_token=False):
                    return
                paired = hmac.compare_digest(self.headers.get("X-Glow-Token", ""), token)
                self.send_json(200, {"ok": True, "app": "glow-hands", "version": VERSION, "paired": paired})
                return
            if self.path == "/observe":
                if self.guard():
                    self.run(lambda: browser.observe())
                return
            self.send_json(404, {"error": "Not found."})

        def do_POST(self):
            if not self.guard():
                return
            if self.path == "/act":
                def act():
                    data = self.read_json()
                    return browser.act(data.get("action") or {}, approved=data.get("approved") is True)
                self.run(act)
            elif self.path == "/close":
                self.run(lambda: (browser.close(), {"closed": True})[1])
            else:
                self.send_json(404, {"error": "Not found."})

        def run(self, work):
            try:
                self.send_json(200, work())
            except HandsError as error:
                self.send_json(error.status, {"error": str(error), **error.extra})
            except Exception as error:  # Playwright timeouts, closed windows, navigation failures...
                self.send_json(502, {"error": type(error).__name__ + ": " + str(error).splitlines()[0][:300]})

    return Handler


def load_token(profile_dir, explicit):
    if explicit:
        return explicit
    path = Path(profile_dir) / "pairing-token.txt"
    if path.exists() and len(path.read_text(encoding="utf-8").strip()) >= 16:
        return path.read_text(encoding="utf-8").strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(18)
    path.write_text(token, encoding="utf-8")
    return token


def default_profile():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(Path.home(), ".local", "share")
    return os.path.join(base, "GlowHands")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Glow Hands: browser control for GlowLead, on your PC.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--profile", default=default_profile(), help="Folder for the separate browser profile and pairing token")
    parser.add_argument("--channel", default=None, help="Use an installed browser: msedge or chrome")
    parser.add_argument("--headless", action="store_true", help="Hide the browser window (you cannot take over)")
    parser.add_argument("--allow-private", action="store_true", help="Allow localhost and private-network pages")
    parser.add_argument("--token", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--allow-origin", action="append", default=[], help="Extra web origin allowed to connect")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # Never crash on consoles that cannot show a character.
        except (AttributeError, ValueError):
            pass

    token = load_token(args.profile, args.token)
    browser = Browser(args.profile, headless=args.headless, channel=args.channel, allow_private=args.allow_private)
    server = http.server.HTTPServer(("127.0.0.1", args.port), make_handler(browser, token, args.port, args.allow_origin))
    print(f"Glow Hands {VERSION} is ready on http://127.0.0.1:{args.port}", flush=True)
    print(f"Pairing token: {token}", flush=True)
    print("In GlowLead open Glow Hands > Connect browser control, and paste the token. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        browser.close()


if __name__ == "__main__":
    main()
