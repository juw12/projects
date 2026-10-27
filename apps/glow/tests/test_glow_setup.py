"""Static checks for the Glow master installer and the setup guide."""
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
WEB = APP / "web"
INSTALLER_URL = "https://raw.githubusercontent.com/juw12/projects/main/apps/glow/install-glow.ps1"


class GlowSetupTests(unittest.TestCase):
    def test_installer_is_plain_ascii_without_bom(self):
        # 'irm | iex' runs the text as-is: a BOM or non-ASCII byte breaks Windows PowerShell 5.1.
        for script in (APP / "install-glow.ps1", APP / "hands" / "install-glow-hands.ps1"):
            data = script.read_bytes()
            self.assertFalse(data.startswith(b"\xef\xbb\xbf"), f"{script.name} starts with a BOM")
            self.assertTrue(all(byte < 128 for byte in data), f"{script.name} has non-ASCII bytes")

    def test_installer_covers_every_app_and_glow_hands(self):
        script = (APP / "install-glow.ps1").read_text(encoding="ascii")
        for name, page in (("Glow", "''"), ("GlowLead", "'lead/'"), ("GlowChat", "'chat/'"), ("GlowRoom", "'room/'")):
            self.assertRegex(script, rf"Name = '{name}'; Page = {re.escape(page)}")
        self.assertIn("hands/install-glow-hands.ps1", script)
        self.assertIn("GLOW_HANDS_NO_BROWSER", script)
        for option in ("GLOW_SKIP_HANDS", "GLOW_NO_DESKTOP", "GLOW_NO_BROWSER", "GLOW_UNINSTALL", "GLOW_SOURCE"):
            self.assertIn(option, script)
        self.assertNotRegex(script, r"(?m)^\s*exit\b", "exit would close the user's PowerShell window under iex")
        for icon in re.findall(r"Icon = '([^']+)'", script):
            self.assertTrue((WEB / icon).is_file(), f"missing icon {icon}")

    def test_taskbar_pins_keep_the_glow_icon(self):
        # A pinned Edge --app window keeps its icon only when a Start-menu shortcut carries the same
        # AppUserModelID Edge gives the window (host_path, cut in the middle to 31 chars on the Default profile).
        script = (APP / "install-glow.ps1").read_text(encoding="ascii")
        for needle in ("function Get-EdgeAppId", "function Set-ShortcutAppId", "function Repair-TaskbarPins",
                       "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", "--profile-directory=", "$limit = 31", "'MSEdge.'"):
            self.assertIn(needle, script)
        self.assertIn("@(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)", script, "icon must hold every taskbar size")
        self.assertNotIn('"--app=$guide"', script, "the guide must not open as a pinnable app window")

        def edge_app_id(host, path, limit=31):
            name = host + "_" + path
            if len(name) > limit:
                head = limit // 2
                name = name[:head] + name[len(name) - (limit - head):]
            return "MSEdge." + name

        # Values read from real Edge app windows on Windows 11 (Default profile).
        self.assertEqual(edge_app_id("juw12.github.io", "/projects/glow/"), "MSEdge.juw12.github.io_/projects/glow/")
        self.assertEqual(edge_app_id("juw12.github.io", "/projects/glow/lead/"), "MSEdge.juw12.github.iojects/glow/lead/")
        self.assertEqual(edge_app_id("juw12.github.io", "/projects/glow/setup/"), "MSEdge.juw12.github.ioects/glow/setup/")

    def test_setup_guide(self):
        page = (WEB / "setup" / "index.html").read_text(encoding="utf-8")
        self.assertIn(INSTALLER_URL, page)
        self.assertIn("GLOW_UNINSTALL", page)
        self.assertIn("releases/download/glow-android/Glow-android.apk", page)
        self.assertIn("install-glow-hands-linux.sh", page)
        self.assertIn('id="how"', page)
        for target in ("../lead/", "../chat/", "../room/"):
            self.assertIn(f'href="{target}"', page)
        for asset in ("../home.css", "./setup.css", "../shared/glow-apps.js", "../shared/qrcode.js", "./setup.js"):
            self.assertIn(asset, page)
            self.assertTrue((WEB / "setup" / asset).resolve().is_file(), asset)

    def test_home_links_to_setup(self):
        home = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="./setup/"', home)


if __name__ == "__main__":
    unittest.main()
