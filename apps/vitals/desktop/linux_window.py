#!/usr/bin/env python3
"""The Vitals app window on Linux: the dashboard in a WebKitGTK window.

The Vitals app starts this with the *system* Python, which has the GTK bindings the bundled Python
lacks (Debian/Ubuntu: python3-gi and gir1.2-webkit2-4.1, which the .deb package recommends).
It exits with status 3 when they are missing, so the app can open a browser window instead.

Speaks the same loopback protocol as the Windows and Mac window (app_window.py): a second launch
brings this window to the front and `vitals --stop` closes it. Standard library + GTK only, and kept
compatible with older system Pythons (3.6+).
"""

import argparse
import hmac
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

MISSING_TOOLKIT = 3
MIN_SIZE = (420, 560)
CONTROL_FILE = "window.json"
SIZE_FILE = "window-size.json"
LIVE_SCRIPT = "(document.querySelector('.mode-pill') || {}).textContent || ''"
PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, userAgent: navigator.userAgent,"
    " width: window.innerWidth, height: window.innerHeight})"
)
TEST_TIMEOUT = 60


def load_toolkit():
    """GTK 3 + WebKit2 (4.1, else 4.0) from the system's GObject introspection, or None."""
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        for version in ("4.1", "4.0"):
            try:
                gi.require_version("WebKit2", version)
                break
            except ValueError:
                continue
        else:
            return None
        from gi.repository import Gdk, GLib, Gtk, WebKit2
    except (ImportError, ValueError) as error:
        print("GTK/WebKit not available: %s" % error, flush=True)
        return None
    return Gdk, GLib, Gtk, WebKit2


def origin(url):
    parts = urlsplit(url)
    return parts.scheme, parts.hostname, parts.port


def open_outside(url):
    """Links to other sites open in the default browser, not inside the app."""
    if not url.startswith(("http://", "https://", "mailto:")):
        return
    try:
        subprocess.Popen(["xdg-open", url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        pass


def write_json(path, data):
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    os.replace(temporary, path)


class WindowControl:
    """Loopback endpoint: 'show' brings the window to the front, 'quit' closes it (see app_window.py)."""

    def __init__(self, data_dir, on_show, on_quit):
        self.path = os.path.join(data_dir, CONTROL_FILE)
        self.token = secrets.token_hex(16)
        self.actions = {"show": on_show, "quit": on_quit}
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        os.makedirs(data_dir, exist_ok=True)
        write_json(self.path, {"pid": os.getpid(), "port": self.server.getsockname()[1], "token": self.token})
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                connection, _address = self.server.accept()
            except OSError:
                return
            with connection:
                try:
                    connection.settimeout(2)
                    line = connection.makefile("r", encoding="utf-8").readline().strip()
                except (OSError, UnicodeDecodeError):
                    continue
                token, _space, command = line.partition(" ")
                action = self.actions.get(command)
                if not action or not hmac.compare_digest(token, self.token):
                    continue
                try:
                    connection.sendall(b"ok\n")
                except OSError:
                    pass
            action()

    def close(self):
        try:
            self.server.close()
        except OSError:
            pass
        try:
            with open(self.path, encoding="utf-8") as handle:
                mine = json.load(handle).get("token") == self.token
            if mine:
                os.remove(self.path)
        except (OSError, ValueError):
            pass


def initial_size(requested, Gdk):
    width, height = requested
    try:
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() or display.get_monitor(0)
        area = monitor.get_workarea()
        width, height = min(width, area.width - 40), min(height, area.height - 40)
    except Exception:
        pass
    return max(width, MIN_SIZE[0]), max(height, MIN_SIZE[1])


def main():
    parser = argparse.ArgumentParser(description="Vitals window (Linux)")
    parser.add_argument("--url", required=True)
    parser.add_argument("--title", default="Vitals")
    parser.add_argument("--data", required=True, help="Vitals data folder (window.json, window-size.json)")
    parser.add_argument("--storage", required=True, help="folder for the page's local storage and cache")
    parser.add_argument("--size", default="1280x860")
    parser.add_argument("--background", default="#0a0e13")
    parser.add_argument("--icon")
    parser.add_argument("--test", help="write a report here once the dashboard is live, then close")
    parser.add_argument("--hold", type=float, default=0.0, help="--test: seconds to stay open after the report")
    args = parser.parse_args()

    toolkit = load_toolkit()
    if toolkit is None:
        sys.exit(MISSING_TOOLKIT)
    Gdk, GLib, Gtk, WebKit2 = toolkit
    GLib.set_prgname("vitals")  # the window class matches StartupWMClass in vitals.desktop
    GLib.set_application_name(args.title)

    try:
        requested = tuple(int(part) for part in args.size.lower().split("x", 1))
    except ValueError:
        requested = (1280, 860)
    window = Gtk.Window(title=args.title)
    window.set_default_size(*initial_size(requested, Gdk))
    window.set_size_request(*MIN_SIZE)
    window.set_position(Gtk.WindowPosition.CENTER)
    if args.icon and os.path.isfile(args.icon):
        try:
            window.set_icon_from_file(args.icon)
        except GLib.Error:
            pass

    manager = WebKit2.WebsiteDataManager(
        base_data_directory=os.path.join(args.storage, "data"),
        base_cache_directory=os.path.join(args.storage, "cache"),
    )
    context = WebKit2.WebContext.new_with_website_data_manager(manager)
    view = WebKit2.WebView.new_with_context(context)
    colour = Gdk.RGBA()
    if colour.parse(args.background):
        view.set_background_color(colour)
    settings = view.get_settings()
    settings.set_enable_developer_extras(False)
    settings.set_javascript_can_open_windows_automatically(False)
    home = origin(args.url)

    def decide_policy(_view, decision, kind):
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri() or ""
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and origin(uri) == home:
            return False
        open_outside(uri)
        decision.ignore()
        return True

    view.connect("decide-policy", decide_policy)
    window.add(view)

    def present():
        window.deiconify()
        window.present()
        return False

    control = WindowControl(args.data, on_show=lambda: GLib.idle_add(present),
                            on_quit=lambda: GLib.idle_add(window.destroy))

    def remember_size(*_args):
        if not window.is_maximized():
            width, height = window.get_size()
            try:
                os.makedirs(args.data, exist_ok=True)
                write_json(os.path.join(args.data, SIZE_FILE), {"width": width, "height": height})
            except OSError:
                pass
        return False

    window.connect("delete-event", remember_size)
    window.connect("destroy", lambda *_args: Gtk.main_quit())

    if args.test:
        state = {"started": time.time(), "pill": "", "done": False}

        def finish(page):
            write_json(args.test, dict(page, method="window", toolkit="webkitgtk-%d.%d" % (
                WebKit2.get_major_version(), WebKit2.get_minor_version()), pill=state["pill"].strip(),
                pid=os.getpid()))
            GLib.timeout_add(int(max(args.hold, 0) * 1000) + 10, lambda: window.destroy() or False)

        def evaluate(script, callback):
            def done(source, result, _data=None):
                try:
                    value = source.run_javascript_finish(result).get_js_value().to_string()
                except Exception as error:  # noqa: BLE001 - reported, not fatal
                    value = "ERROR: %s" % error
                callback(value)

            view.run_javascript(script, None, done, None)

        def got_page(text):
            try:
                page = json.loads(text)
            except ValueError:
                page = {"error": text}
            finish(page)

        def got_pill(text):
            state["pill"] = text or ""
            if "Live" in state["pill"] or time.time() - state["started"] > TEST_TIMEOUT:
                evaluate(PAGE_SCRIPT, got_page)
            else:
                GLib.timeout_add(500, poll)

        def poll():
            evaluate(LIVE_SCRIPT, got_pill)
            return False

        def loaded(_view, event):
            if event == WebKit2.LoadEvent.FINISHED and not state["done"]:
                state["done"] = True
                GLib.timeout_add(300, poll)

        view.connect("load-changed", loaded)

    view.load_uri(args.url)
    window.show_all()
    try:
        Gtk.main()
    finally:
        control.close()


if __name__ == "__main__":
    main()
