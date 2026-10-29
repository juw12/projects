# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe for Fade on Windows (and macOS). Build with  python apps/fade/desktop/build.py
#   Windows  dist/Fade/Fade.exe (+ _internal/)  - no console; window = Edge WebView2 (pywebview)
#   macOS    dist/Fade.app                      - window = WKWebView (pywebview)
# The program carries Fade's web/ (the live app: it talks to the Fade Network itself) and server/devnet.py
# (a local copy of the network for  Fade --devnet ), loaded at run time, so devnet's imports are added here.
import ast
import os
import sys

DESKTOP = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (provided by PyInstaller)
FADE = os.path.dirname(DESKTOP)
VERSION = os.environ.get("FADE_SHELL_VERSION", "1.0.0")
VERSION_FILE = os.environ.get("FADE_VERSION_FILE") or None
ICON = os.environ.get("FADE_ICON") or None
IS_WIN = sys.platform == "win32"
DEVNET = os.path.join(FADE, "server", "devnet.py")
SKIP_DIRS = {"data", "__pycache__", ".pytest_cache", "node_modules"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".db", ".db-journal", ".db-wal", ".db-shm"}


def fade_files():
    """(source, folder in the bundle) for web/ and server/devnet.py, under fade/."""
    pairs = []
    for current, dirs, files in os.walk(os.path.join(FADE, "web")):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        target = os.path.join("fade", os.path.relpath(current, FADE))
        for name in sorted(files):
            if os.path.splitext(name)[1].lower() not in SKIP_SUFFIXES:
                pairs.append((os.path.join(current, name), target))
    pairs.append((DEVNET, os.path.join("fade", "server")))
    return pairs


def devnet_imports():
    """Top-level modules devnet.py imports (it is plain source PyInstaller does not analyse)."""
    found = set()
    with open(DEVNET, encoding="utf-8") as handle:
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
    [os.path.join(DESKTOP, "fade_app.py")],
    pathex=[DESKTOP],
    datas=fade_files(),
    hiddenimports=HIDDEN + devnet_imports(),
    excludes=EXCLUDES,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Fade",
    console=False,
    disable_windowed_traceback=True,
    icon=ICON,
    version=VERSION_FILE if IS_WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Fade", upx=False)  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="Fade.app",
        icon=ICON,
        bundle_identifier="io.github.juw12.fade.desktop",
        version=VERSION,
        info_plist={
            "CFBundleName": "Fade",
            "CFBundleDisplayName": "Fade",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.lifestyle",
            "NSHumanReadableCopyright": "Open source - github.com/juw12/projects",
        },
    )
