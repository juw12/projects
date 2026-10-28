#!/usr/bin/env python3
"""Static checks for the Kitty iPhone/Android shells (apps/kitty/mobile). Stdlib only.

- Capacitor config loads the live HTTPS site (needed for crypto.subtle / E2E sharing)
- the mobile package version matches the web app's K.VERSION
- icons exist with the expected pixel sizes (read from the PNG header)
- the release workflow publishes the asset names that get.html links to
"""

import json
import re
import struct
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
MOBILE = APP_DIR / "mobile"
WEB = APP_DIR / "web"
REPO = APP_DIR.parents[1]
# The workflow ships as a template in mobile/ci/ and is activated by copying it to .github/workflows/
# (pushing workflow files needs a token with the "workflow" scope). Check whichever copy exists.
ACTIVE_WORKFLOW = REPO / ".github" / "workflows" / "kitty-mobile.yml"
TEMPLATE_WORKFLOW = MOBILE / "ci" / "kitty-mobile.yml"
WORKFLOW = ACTIVE_WORKFLOW if ACTIVE_WORKFLOW.is_file() else TEMPLATE_WORKFLOW

REQUIRED = [
    "package.json",
    "capacitor.config.json",
    "README.md",
    "shell/index.html",
    "shell/offline.html",
    "scripts/prepare-native.mjs",
    "scripts/android-e2e.py",
]

ICON_SIZES = {
    "assets/app-icon-1024.png": 1024,
    "assets/icon-mdpi.png": 48,
    "assets/icon-hdpi.png": 72,
    "assets/icon-xhdpi.png": 96,
    "assets/icon-xxhdpi.png": 144,
    "assets/icon-xxxhdpi.png": 192,
    "assets/foreground-mdpi.png": 108,
    "assets/foreground-hdpi.png": 162,
    "assets/foreground-xhdpi.png": 216,
    "assets/foreground-xxhdpi.png": 324,
    "assets/foreground-xxxhdpi.png": 432,
}

WEB_ICON_SIZES = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon-maskable-512.png": 512,
}


def png_size(path):
    with open(path, "rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("%s is not a PNG" % path)
    return struct.unpack(">II", header[16:24])


class MobileStaticTests(unittest.TestCase):
    def test_required_files_exist(self):
        missing = [name for name in REQUIRED if not (MOBILE / name).is_file()]
        self.assertEqual(missing, [], "missing files: %s" % missing)

    def test_capacitor_loads_live_https_site(self):
        config = json.loads((MOBILE / "capacitor.config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["appId"], "io.github.juw12.kitty")
        self.assertEqual(config["appName"], "Kitty")
        url = config["server"]["url"]
        self.assertTrue(url.startswith("https://"), "must be HTTPS so crypto.subtle exists")
        self.assertTrue(url.endswith("/projects/kitty/"), url)
        self.assertNotIn("cleartext", config["server"])
        error_page = config["server"].get("errorPath")
        self.assertTrue(error_page and (MOBILE / config["webDir"] / error_page).is_file())

    def test_versions_match_web_app(self):
        package = json.loads((MOBILE / "package.json").read_text(encoding="utf-8"))
        core = (WEB / "js" / "core.js").read_text(encoding="utf-8")
        match = re.search(r"K\.VERSION\s*=\s*['\"]([\d.]+)['\"]", core)
        self.assertIsNotNone(match, "K.VERSION not found in core.js")
        self.assertEqual(package["version"], match.group(1))

    def test_capacitor_packages_share_major_version(self):
        package = json.loads((MOBILE / "package.json").read_text(encoding="utf-8"))
        deps = dict(package["dependencies"], **package.get("devDependencies", {}))
        core_major = deps["@capacitor/core"].split(".")[0]
        for name in ("@capacitor/android", "@capacitor/ios", "@capacitor/cli", "@capacitor/app",
                     "@capacitor/haptics", "@capacitor/share"):
            self.assertIn(name, deps)
            self.assertEqual(deps[name].split(".")[0], core_major, name)

    def test_native_icons_have_expected_sizes(self):
        for name, size in ICON_SIZES.items():
            self.assertEqual(png_size(MOBILE / name), (size, size), name)

    def test_web_icons_have_expected_sizes(self):
        for name, size in WEB_ICON_SIZES.items():
            self.assertEqual(png_size(WEB / name), (size, size), name)

    def test_workflow_publishes_assets_linked_from_get_page(self):
        self.assertTrue(WORKFLOW.is_file(), "missing %s" % WORKFLOW)
        workflow = WORKFLOW.read_text(encoding="utf-8")
        get_page = (WEB / "get.html").read_text(encoding="utf-8")
        links = re.findall(r"releases/download/([\w.-]+)/([\w.-]+)", get_page)
        self.assertTrue(links, "get.html links to no release assets")
        for tag, asset in links:
            self.assertIn(tag, workflow, "workflow never publishes tag %s" % tag)
            self.assertIn(asset, workflow, "workflow never builds %s" % asset)
        self.assertIn("apps/kitty/mobile/**", workflow)

    def test_template_matches_active_workflow(self):
        if ACTIVE_WORKFLOW.is_file() and TEMPLATE_WORKFLOW.is_file():
            self.assertEqual(ACTIVE_WORKFLOW.read_text(encoding="utf-8"),
                             TEMPLATE_WORKFLOW.read_text(encoding="utf-8"),
                             "mobile/ci/kitty-mobile.yml drifted from .github/workflows/kitty-mobile.yml")

    def test_get_page_handles_unpublished_builds(self):
        get_page = (WEB / "get.html").read_text(encoding="utf-8")
        self.assertIn("api.github.com/repos/juw12/projects/releases/tags/kitty-mobile", get_page)
        self.assertEqual(get_page.count("data-asset="), 2)

    def test_prepare_script_wires_deep_links_and_signing(self):
        script = (MOBILE / "scripts" / "prepare-native.mjs").read_text(encoding="utf-8")
        for needle in ("juw12.github.io", "KITTY_ANDROID_KEYSTORE_PATH", "VIBRATE"):
            self.assertIn(needle, script)


if __name__ == "__main__":
    unittest.main(verbosity=2)
