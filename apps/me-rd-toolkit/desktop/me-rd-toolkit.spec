# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe for ME R&D Toolkit on Windows (and macOS). Build with  python apps/me-rd-toolkit/desktop/build.py
#   Windows  dist/ME-RD-Toolkit/ME-RD-Toolkit.exe (+ _internal/)  - no console; window = Edge WebView2 (pywebview)
#   macOS    dist/ME-RD-Toolkit.app                               - window = WKWebView (pywebview)
# The program carries the toolkit's web/ and server/vault_server.py (the file vault, loaded at run time when a
# vault_config.json is in the data folder), so the vault's imports are added here. Private data never ships.
import ast
import os
import sys

DESKTOP = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (provided by PyInstaller)
TOOLKIT = os.path.dirname(DESKTOP)
VERSION = os.environ.get("MERD_SHELL_VERSION", "1.0.0")
VERSION_FILE = os.environ.get("MERD_VERSION_FILE") or None
ICON = os.environ.get("MERD_ICON") or None
IS_WIN = sys.platform == "win32"
VAULT = os.path.join(TOOLKIT, "server", "vault_server.py")
VAULT_EXAMPLE = os.path.join(TOOLKIT, "server", "vault_config.example.json")
SKIP_DIRS = {"data", "__pycache__", ".pytest_cache", "node_modules"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".db", ".db-journal", ".db-wal", ".db-shm"}


def toolkit_files():
    """(source, folder in the bundle) for web/ and the vault server, under me-rd-toolkit/ (never private/)."""
    pairs = []
    for current, dirs, files in os.walk(os.path.join(TOOLKIT, "web")):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        target = os.path.join("me-rd-toolkit", os.path.relpath(current, TOOLKIT))
        for name in sorted(files):
            if os.path.splitext(name)[1].lower() not in SKIP_SUFFIXES:
                pairs.append((os.path.join(current, name), target))
    pairs.append((VAULT, os.path.join("me-rd-toolkit", "server")))
    pairs.append((VAULT_EXAMPLE, os.path.join("me-rd-toolkit", "server")))
    return pairs


def vault_imports():
    """Top-level modules vault_server.py imports (it is plain source PyInstaller does not analyse)."""
    found = set()
    with open(VAULT, encoding="utf-8") as handle:
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
    [os.path.join(DESKTOP, "merd_app.py")],
    pathex=[DESKTOP],
    datas=toolkit_files(),
    hiddenimports=HIDDEN + vault_imports(),
    excludes=EXCLUDES,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ME-RD-Toolkit",
    console=False,
    disable_windowed_traceback=True,
    icon=ICON,
    version=VERSION_FILE if IS_WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="ME-RD-Toolkit", upx=False)  # noqa: F821

if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="ME-RD-Toolkit.app",
        icon=ICON,
        bundle_identifier="io.github.juw12.me-rd-toolkit.desktop",
        version=VERSION,
        info_plist={
            "CFBundleName": "ME R&D Toolkit",
            "CFBundleDisplayName": "ME R&D Toolkit",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.productivity",
            "NSHumanReadableCopyright": "Open source - github.com/juw12/projects",
        },
    )
