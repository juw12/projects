# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe for Peers on Windows (and macOS). Build with  python apps/peers/desktop/build.py
#   Windows  dist/Peers/Peers.exe (+ _internal/)  - no console; window = Edge WebView2 (pywebview)
#   macOS    dist/Peers.app                       - window = WKWebView (pywebview)
# The program carries Peers' web/ (the single-file app) and server/ (its zero-dependency backend), and runs
# that server in-process, so the modules server.py imports are added here (it is loaded at run time).
import ast
import os
import sys

DESKTOP = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (provided by PyInstaller)
PEERS = os.path.dirname(DESKTOP)
VERSION = os.environ.get("PEERS_SHELL_VERSION", "1.0.0")
VERSION_FILE = os.environ.get("PEERS_VERSION_FILE") or None
ICON = os.environ.get("PEERS_ICON") or None
IS_WIN = sys.platform == "win32"
SHIPPED = ("web", "server")
SKIP_DIRS = {"data", "__pycache__", ".pytest_cache", "node_modules"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".db", ".db-journal", ".db-wal", ".db-shm"}


def peers_files():
    """(source, folder in the bundle) for web/ and server/, under peers/ (never a local database)."""
    pairs = []
    for top in SHIPPED:
        for current, dirs, files in os.walk(os.path.join(PEERS, top)):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            target = os.path.join("peers", os.path.relpath(current, PEERS))
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() not in SKIP_SUFFIXES:
                    pairs.append((os.path.join(current, name), target))
    return pairs


def server_imports():
    """Top-level modules the Peers server imports (it is plain source PyInstaller does not analyse)."""
    found = {"sqlite3", "http.server", "json", "hashlib", "hmac", "secrets"}
    for current, _dirs, files in os.walk(os.path.join(PEERS, "server")):
        for name in files:
            if name.endswith(".py"):
                with open(os.path.join(current, name), encoding="utf-8") as handle:
                    tree = ast.parse(handle.read())
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        found.update(alias.name for alias in node.names)
                    elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                        found.add(node.module)
    return sorted(name for name in found if name != "__future__")


EXCLUDES = ["tkinter", "unittest", "test", "idlelib", "lib2to3"]
OTHER_BACKENDS = ["webview.platforms.qt", "webview.platforms.gtk", "webview.platforms.cef",
                  "webview.platforms.android", "PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "gi"]
if IS_WIN:
    HIDDEN = ["webview", "webview.platforms.winforms", "webview.platforms.edgechromium", "clr"]
    EXCLUDES += OTHER_BACKENDS + ["webview.platforms.cocoa"]
else:
    HIDDEN = ["webview", "webview.platforms.cocoa"]
    EXCLUDES += OTHER_BACKENDS + ["webview.platforms.winforms", "webview.platforms.edgechromium",
                                  "webview.platforms.mshtml", "webview.platforms.win32"]

a = Analysis(  # noqa: F821
    [os.path.join(DESKTOP, "peers_app.py")],
    pathex=[DESKTOP],
    datas=peers_files(),
    hiddenimports=HIDDEN + server_imports(),
    excludes=EXCLUDES,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Peers",
    console=False,
    disable_windowed_traceback=True,
    icon=ICON,
    version=VERSION_FILE if IS_WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Peers", upx=False)  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="Peers.app",
        icon=ICON,
        bundle_identifier="io.github.juw12.peers.desktop",
        version=VERSION,
        info_plist={
            "CFBundleName": "Peers",
            "CFBundleDisplayName": "Peers",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.lifestyle",
            "NSHumanReadableCopyright": "Open source - github.com/juw12/projects",
        },
    )
