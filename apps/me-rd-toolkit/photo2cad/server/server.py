#!/usr/bin/env python3
"""photo2cad HTTP server (stdlib only).

Routes:
    GET  /                         serves ``apps/photo2cad/web/index.html``
    GET  /<asset>                  any other file under ``web/`` (path-traversal safe)
    GET  /api/health               ``{ok, llm_configured}``
    POST /api/generate             JSON body -> full pipeline -> success/fail dict
    GET  /api/artifacts/<job>/<f>  serves STEP/STL/program/report from the
                                   artifact root (path-traversal safe)

CLI:
    --port <int>   default 8000
    --lan          bind 0.0.0.0 (LAN access) instead of 127.0.0.1

Cadquery is never imported at module level — only inside the child-process
harness spawned by :mod:`sandbox` — so this file boots cleanly on a plain
Python 3.13 without the BREP kernel.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

# Project imports — keep these at module top because they are themselves
# stdlib-only at the module level (cadquery is loaded lazily inside them).
import config as _config
import pipeline


# ---------------------------------------------------------------------------
# Filesystem layout
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
APP_DIR = BASE_DIR.parent
WEB_DIR = APP_DIR / "web"

MAX_BODY_BYTES = 25 * 1024 * 1024  # 25 MB JSON request cap
MAX_IMAGE_FIELD_BYTES = 20 * 1024 * 1024  # each data:image/png;base64 is the bulk

# Static-file content types (supplement mimetypes for the unusual ones).
_EXTRA_TYPES = {
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".stp": "application/step",
    ".stl": "application/sla",
    ".json": "application/json; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
}


def _content_type(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in _EXTRA_TYPES:
        return _EXTRA_TYPES[ext]
    guess, _ = mimetypes.guess_type(str(path))
    return guess or "application/octet-stream"


# ---------------------------------------------------------------------------
# Path-traversal-safe resolvers
# ---------------------------------------------------------------------------


def _safe_resolve(root: Path, rel: str) -> Path | None:
    """Resolve ``rel`` under ``root``; reject anything that escapes.

    Returns ``None`` when the request tries to climb out of the root via
    ``..`` segments, absolute paths, symlinks that point outside, or NUL
    bytes. The returned path is guaranteed to be a child of ``root`` only
    after symlink resolution.
    """
    if not isinstance(rel, str) or not rel:
        return None
    if "\x00" in rel:
        return None
    rel = rel.replace("\\", "/").lstrip("/")
    if rel.startswith("/") or rel.startswith("\\"):
        return None
    parts = [p for p in rel.split("/") if p not in ("",)]
    if any(p == ".." for p in parts):
        return None
    try:
        candidate = (root / Path(*parts)).resolve(strict=False)
        root_resolved = root.resolve(strict=False)
        try:
            candidate.relative_to(root_resolved)
        except ValueError:
            return None
        return candidate
    except OSError:
        return None


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------


def _read_json_body(handler: BaseHTTPRequestHandler,
                    max_bytes: int = MAX_BODY_BYTES) -> tuple[object | None, str | None]:
    """Read a JSON body from ``handler.rfile`` and decode it.

    ``BaseHTTPRequestHandler`` has already parsed headers by the time
    ``do_POST`` runs, so ``self.rfile`` is positioned at the start of the
    body. We honour ``Content-Length`` (rejecting anything that exceeds
    ``max_bytes``) and reject chunked transfer-encoding (the spec is JSON
    only, which never uses chunked).
    """
    te = (handler.headers.get("Transfer-Encoding") or "").lower().strip()
    if te and te != "identity":
        return None, "chunked transfer-encoding is not supported"
    cl_raw = handler.headers.get("Content-Length")
    if cl_raw is None:
        return None, "missing Content-Length header"
    try:
        length = int(cl_raw)
    except ValueError:
        return None, "invalid Content-Length: %r" % cl_raw
    if length < 0:
        return None, "negative Content-Length"
    if length > max_bytes:
        return None, "request body exceeds %d bytes" % max_bytes
    try:
        raw = b""
        while len(raw) < length:
            chunk = handler.rfile.read(min(65536, length - len(raw)))
            if not chunk:
                break
            raw += chunk
    except OSError as exc:
        return None, "could not read body: %s" % exc
    if len(raw) > max_bytes:
        return None, "request body exceeds %d bytes" % max_bytes
    try:
        return json.loads(raw.decode("utf-8")), None
    except (UnicodeDecodeError, ValueError) as exc:
        return None, "invalid JSON: %s" % exc


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    server_version = "photo2cad/0.1"

    # Loaded once per process via :class:`_Handler` setup.
    cfg: _config.Config = None  # type: ignore[assignment]
    log_lock: threading.Lock = None  # type: ignore[assignment]

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        try:
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            line = "[%s] %s - %s\n" % (ts, self.address_string(), format % args)
            if _Handler.log_lock:
                with _Handler.log_lock:
                    sys.stderr.write(line)
                    sys.stderr.flush()
            else:
                sys.stderr.write(line)
                sys.stderr.flush()
        except Exception:
            pass

    # -- verb dispatch -------------------------------------------------------
    def do_OPTIONS(self):  # noqa: N802 - stdlib
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802 - stdlib
        try:
            self._handle_get()
        except Exception as exc:  # never let the server die on a request
            self.log_message("GET handler crashed: %s", exc)
            _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"ok": False, "error": "internal error: %s" % exc})

    def do_POST(self):  # noqa: N802 - stdlib
        try:
            self._handle_post()
        except Exception as exc:
            self.log_message("POST handler crashed: %s", exc)
            _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR,
                           {"ok": False, "error": "internal error: %s" % exc})

    # -- GET -----------------------------------------------------------------
    def _handle_get(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path or "/")
        if path == "/api/health":
            return self._api_health()
        if path.startswith("/api/artifacts/"):
            return self._api_artifacts(path[len("/api/artifacts/"):])
        if path == "/api/" or path == "/api":
            return _json_response(self, HTTPStatus.NOT_FOUND,
                                  {"ok": False, "error": "unknown api path"})
        return self._serve_static(path)

    def _api_health(self) -> None:
        cfg = _Handler.cfg
        from maas import available
        _json_response(self, HTTPStatus.OK, {
            "ok": True,
            "llm_configured": bool(available(cfg)),
            "fake_llm": bool(getattr(cfg, "fake_llm", False)),
            "model": cfg.model,
            "artifacts_root": str(cfg.artifacts_root),
            "ts": datetime.now(timezone.utc).isoformat(),
        })

    def _api_artifacts(self, rest: str) -> None:
        cfg = _Handler.cfg
        # ``rest`` is "<job_id>/" — both pieces are validated.
        if "/" not in rest:
            return _json_response(self, HTTPStatus.BAD_REQUEST,
                                  {"ok": False, "error": "expected <job_id>/"})
        job_id, _, filename = rest.partition("/")
        if not job_id or not filename or "/" in filename:
            return _json_response(self, HTTPStatus.BAD_REQUEST,
                                  {"ok": False, "error": "malformed artifact path"})
        if filename not in _config.ALLOWED_ARTIFACT_NAMES:
            return _json_response(self, HTTPStatus.NOT_FOUND,
                                  {"ok": False, "error": "file not available"})

        job_dir = _safe_resolve(cfg.artifacts_root, job_id)
        if job_dir is None or not job_dir.is_dir():
            return _json_response(self, HTTPStatus.NOT_FOUND,
                                  {"ok": False, "error": "unknown job_id"})
        file_path = job_dir / filename
        if not file_path.is_file():
            return _json_response(self, HTTPStatus.NOT_FOUND,
                                  {"ok": False, "error": "file not found"})
        self._serve_file(file_path)

    def _serve_static(self, path: str) -> None:
        # Default document
        if path == "/" or path == "":
            path = "/index.html"
        rel = path.lstrip("/")
        resolved = _safe_resolve(WEB_DIR, rel)
        if resolved is None or not resolved.is_file():
            return _json_response(self, HTTPStatus.NOT_FOUND,
                                  {"ok": False, "error": "not found"})
        self._serve_file(resolved)

    def _serve_file(self, file_path: Path) -> None:
        try:
            data = file_path.read_bytes()
        except OSError as exc:
            return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR,
                                  {"ok": False, "error": "could not read file: %s" % exc})
        ctype = _content_type(file_path)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    # -- POST ----------------------------------------------------------------
    def _handle_post(self) -> None:
        parsed = urlparse(self.path)
        path = (parsed.path or "").rstrip("/")
        if path == "/api/generate":
            return self._api_generate()
        return _json_response(self, HTTPStatus.NOT_FOUND,
                              {"ok": False, "error": "unknown endpoint"})

    def _api_generate(self) -> None:
        cfg = _Handler.cfg
        # 1. Reject huge bodies early (cheap).
        cl = self.headers.get("Content-Length", "0")
        try:
            cl_int = int(cl) if cl else 0
        except ValueError:
            cl_int = 0
        if cl_int > MAX_BODY_BYTES:
            return _json_response(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "ok": False, "error": "request body exceeds %d bytes" % MAX_BODY_BYTES,
            })

        # 2. Parse JSON.
        body, err = _read_json_body(self, MAX_BODY_BYTES)
        if err is not None:
            return _json_response(self, HTTPStatus.BAD_REQUEST,
                                  {"ok": False, "error": err})
        if not isinstance(body, dict):
            return _json_response(self, HTTPStatus.BAD_REQUEST, {
                "ok": False, "error": "request body must be a JSON object",
            })

        prd = body.get("prd", "")
        if not isinstance(prd, str) or not prd.strip():
            return _json_response(self, HTTPStatus.BAD_REQUEST, {
                "ok": False, "error": "'prd' is required (non-empty string)",
            })

        images = body.get("images") or {}
        if not isinstance(images, dict):
            return _json_response(self, HTTPStatus.BAD_REQUEST, {
                "ok": False, "error": "'images' must be an object",
            })
        # Coerce image fields to strings (defensive) and cap their length.
        clean_images = {}
        for view, url in images.items():
            if not isinstance(view, str):
                continue
            if not isinstance(url, str):
                continue
            if len(url) > MAX_IMAGE_FIELD_BYTES:
                return _json_response(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                    "ok": False,
                    "error": "image '%s' exceeds %d bytes" % (view, MAX_IMAGE_FIELD_BYTES),
                })
            clean_images[view] = url
        # Cap the total number of views.
        if len(clean_images) > cfg.max_images:
            return _json_response(self, HTTPStatus.BAD_REQUEST, {
                "ok": False, "error": "more than %d image views supplied" % cfg.max_images,
            })

        use_vision = body.get("use_vision", True)
        if not isinstance(use_vision, bool):
            use_vision = True

        model_override = body.get("model")
        if model_override is not None and not isinstance(model_override, str):
            model_override = None

        # 3. Drive the pipeline (runs cadquery inside a child process).
        started = time.time()
        try:
            result = pipeline.generate(
                cfg=cfg,
                prd=prd,
                images=clean_images,
                workdir_root=cfg.artifacts_root,
                use_vision=use_vision,
                model=model_override,
            )
        except Exception as exc:
            self.log_message("pipeline crashed: %s", exc)
            return _json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {
                "ok": False,
                "stage": "exec",
                "error": "pipeline crashed: %s" % exc,
            })

        result.setdefault("seconds", round(time.time() - started, 3))

        # 4. Translate to HTTP. Bad-request failures are 4xx; everything else
        # is 200 with ``ok=False`` so the browser can render the message
        # inline (matches the API contract's success/failure shape).
        status = HTTPStatus.OK
        if result.get("ok") is False:
            stage = result.get("stage")
            if stage == "cadgen" and "required" in (result.get("error") or ""):
                status = HTTPStatus.BAD_REQUEST
        _json_response(self, status, result)


# ---------------------------------------------------------------------------
# Server bootstrap
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="server.py",
        description="photo2cad HTTP server (PRD + photos -> STEP).",
    )
    parser.add_argument("--port", type=int, default=8000,
                        help="TCP port to bind (default: 8000).")
    parser.add_argument("--lan", action="store_true",
                        help="Bind to 0.0.0.0 so other devices on the LAN can connect.")
    parser.add_argument("--host", default=None,
                        help="Explicit host override (e.g. 127.0.0.1 or 0.0.0.0).")
    return parser.parse_args(argv)


def _host(args: argparse.Namespace) -> str:
    if args.host:
        return args.host
    return "0.0.0.0" if args.lan else "127.0.0.1"


def start(host: str, port: int) -> ThreadingHTTPServer:
    """Build (but do not serve) the HTTP server bound to ``host:port``.

    Used by ``main()`` and by the ME R&D Toolkit desktop host, which runs this
    sub-app in-process on its own loopback port.
    """
    _Handler.cfg = _config.load_config()
    _Handler.log_lock = threading.Lock()
    return ThreadingHTTPServer((host, port), _Handler)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    if not WEB_DIR.is_dir():
        print("[photo2cad] warning: web/ directory not found at %s" % WEB_DIR, file=sys.stderr)

    host = _host(args)
    httpd = start(host, args.port)
    cfg = _Handler.cfg
    sa = httpd.socket.getsockname()
    print("[photo2cad] serving %s on http://%s:%d/" % (
        WEB_DIR, sa[0], sa[1]), flush=True)
    print("[photo2cad] artifacts root: %s" % cfg.artifacts_root, flush=True)
    print("[photo2cad] llm_configured=%s fake_llm=%s model=%s" % (
        cfg.llm_configured, cfg.fake_llm, cfg.model), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[photo2cad] shutting down", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
