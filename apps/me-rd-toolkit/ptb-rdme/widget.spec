# PyInstaller spec for PTB RDME Widget single-file .exe
#
# Build with:  pyinstaller --clean widget.spec
#
# Result: dist/PTB-RDME-Widget.exe (~30 MB)

# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

block_cipher = None

# We bundle:
#   app_launcher.py     - entry point
#   server/             - all server modules
#   web/                - PWA assets (templates, static, manifest, sw, icons)
# We do NOT bundle:
#   data/               - writable runtime data, created at first run
#   logs/               - created at first run

ROOT = Path('.').resolve()
WEB = ROOT / "web"

a = Analysis(
    ['app_launcher.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # (source_path_on_disk, destination_in_bundle)
        (str(WEB), 'web'),
    ],
    hiddenimports=[
        'win32com', 'win32com.client', 'pythoncom',
        'sqlite3', 'http.server', 'urllib.parse', 'urllib.request',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'numpy', 'pandas', 'pytest', 'setuptools',
        'unittest', 'xmlrpc',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PTB-RDME-Widget',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,           # no console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(WEB / 'icons' / 'icon-512.png') if (WEB / 'icons' / 'icon-512.png').exists() else None,
)
