# -*- mode: python ; coding: utf-8 -*-
# PyInstaller recipe for the Vitals desktop app (Windows, macOS, Linux).
#
# Build with  python apps/vitals/desktop/build.py  (it stages the dashboard files listed in
# web/files.txt and sets the version from server.py). Output in apps/vitals/desktop/dist/:
#   Windows  Vitals/Vitals.exe (+ _internal/)   - no console; its window uses Edge WebView2 (pywebview)
#   macOS    Vitals.app                          - a normal Dock app; its window uses WKWebView (pywebview)
#   Linux    Vitals/vitals (+ _internal/)        - its window runs linux_window.py with the system Python
# A folder build (not one file) so the long-running agent never depends on files unpacked in /tmp.
import os
import sys

DESKTOP = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (provided by PyInstaller)
APP = os.path.dirname(DESKTOP)
WEB = os.environ.get("VITALS_STAGE_WEB") or os.path.join(APP, "web")
VERSION = os.environ.get("VITALS_VERSION", "1.2.1")
VERSION_FILE = os.environ.get("VITALS_VERSION_FILE") or None
IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
ICON = os.path.join(APP, "web", "icons", "icon.ico" if IS_WIN else "icon-512.png")

HIDDEN = ["history", "metrics", "storage", "vault", "app_window"]
EXCLUDES = ["tkinter", "unittest", "test", "idlelib", "lib2to3"]
DATAS = [(WEB, "web")]
# pywebview: bundle only the backend this system uses (the others would drag in Qt, GTK or CEF).
OTHER_BACKENDS = ["webview.platforms.qt", "webview.platforms.gtk", "webview.platforms.cef",
                  "webview.platforms.android", "PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "gi"]
if IS_WIN:
    HIDDEN += ["webview", "webview.platforms.winforms", "webview.platforms.edgechromium", "clr"]
    EXCLUDES += OTHER_BACKENDS + ["webview.platforms.cocoa"]
elif IS_MAC:
    HIDDEN += ["webview", "webview.platforms.cocoa"]
    EXCLUDES += OTHER_BACKENDS + ["webview.platforms.winforms", "webview.platforms.edgechromium",
                                  "webview.platforms.mshtml", "webview.platforms.win32"]
else:
    # Linux: the window runs with the system Python and its GTK bindings (see linux_window.py).
    EXCLUDES += ["webview"]
    DATAS += [(os.path.join(DESKTOP, "linux_window.py"), ".")]

a = Analysis(  # noqa: F821
    [os.path.join(DESKTOP, "vitals_app.py")],
    pathex=[os.path.join(APP, "server"), DESKTOP],
    datas=DATAS,
    hiddenimports=HIDDEN,
    excludes=EXCLUDES,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Vitals" if (IS_WIN or IS_MAC) else "vitals",
    console=not (IS_WIN or IS_MAC),
    icon=ICON if (IS_WIN or IS_MAC) else None,
    version=VERSION_FILE if IS_WIN else None,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Vitals", upx=False)  # noqa: F821

if IS_MAC:
    app = BUNDLE(  # noqa: F821
        coll,
        name="Vitals.app",
        icon=ICON,
        bundle_identifier="io.github.juw12.vitals.app",
        version=VERSION,
        info_plist={
            "CFBundleName": "Vitals",
            "CFBundleDisplayName": "Vitals",
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
            "LSApplicationCategoryType": "public.app-category.utilities",
            "NSHumanReadableCopyright": "Open source - github.com/juw12/projects",
        },
    )
