# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe for Twin on Windows and macOS. Build with  python apps/twin/desktop/build.py
#   Windows  dist/Twin/Twin.exe (+ _internal/)  - no console; window = Edge WebView2 (pywebview)
#   macOS    dist/Twin.app                      - a normal Dock app; window = WKWebView (pywebview)
# The program carries the whole Twin folder (server.py, web/, vendor/ tools - not tests/, data/ or desktop/)
# and the full Python standard library, because it is also the Python that runs Twin's server and tools.
import os
import sys

from PyInstaller.utils.hooks import collect_submodules

DESKTOP = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (provided by PyInstaller)
TWIN = os.path.dirname(DESKTOP)
VERSION = os.environ.get("TWIN_SHELL_VERSION", "1.0.0")
VERSION_FILE = os.environ.get("TWIN_VERSION_FILE") or None
ICON = os.environ.get("TWIN_ICON") or None
IS_WIN = sys.platform == "win32"

SKIP_DIRS = {"tests", "data", "desktop", "__pycache__", ".pytest_cache", "node_modules", ".git"}
SKIP_SUFFIXES = {".pyc", ".pyo"}


def twin_files():
    """(source, folder in the bundle) for every file Twin needs, under twin/."""
    pairs = []
    for current, dirs, files in os.walk(TWIN):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        rel = os.path.relpath(current, TWIN)
        target = "twin" if rel == "." else os.path.join("twin", rel)
        for name in sorted(files):
            if os.path.splitext(name)[1] not in SKIP_SUFFIXES:
                pairs.append((os.path.join(current, name), target))
    return pairs


# Twin's server and tools are plain scripts PyInstaller can't see: ship the whole standard library.
NOT_NEEDED = {"tkinter", "turtle", "turtledemo", "idlelib", "test", "lib2to3", "ensurepip", "venv",
              "pydoc_data", "antigravity", "this", "xxlimited", "xxlimited_35", "xxsubtype", "_tkinter",
              "curses", "_curses", "_curses_panel", "readline", "dbm", "sqlite3", "_sqlite3"}
STDLIB = []
for name in sorted(getattr(sys, "stdlib_module_names", ())):
    if name in NOT_NEEDED or name.startswith("_test"):
        continue
    try:
        __import__(name)
    except Exception:
        continue  # another platform's module
    STDLIB.append(name)
    module = sys.modules.get(name)
    if module is not None and hasattr(module, "__path__"):
        STDLIB += [sub for sub in collect_submodules(name) if ".test" not in sub and "idlelib" not in sub]

EXCLUDES = sorted(NOT_NEEDED)
# pywebview: bundle only the backend this system uses (the others would drag in Qt, GTK or CEF).
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
    [os.path.join(DESKTOP, "twin_app.py")],
    pathex=[DESKTOP],
    datas=twin_files(),
    hiddenimports=HIDDEN + sorted(set(STDLIB)),
    excludes=EXCLUDES,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Twin",
    console=False,
    disable_windowed_traceback=True,  # a failing tool must not pop up a dialog; errors go to logs/
    icon=ICON,
    version=VERSION_FILE if IS_WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Twin", upx=False)  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="Twin.app",
        icon=ICON,
        bundle_identifier="io.github.juw12.twin.desktop",
        version=VERSION,
        info_plist={
            "CFBundleName": "Twin",
            "CFBundleDisplayName": "Twin",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
            "LSApplicationCategoryType": "public.app-category.finance",
            "NSHumanReadableCopyright": "Open source - github.com/juw12/projects",
        },
    )
