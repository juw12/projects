import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BridgeFilesTest(unittest.TestCase):
    def test_embedded_bridge_files_match_sources(self):
        spec = importlib.util.spec_from_file_location("gen_bridge_files", ROOT / "tools" / "gen_bridge_files.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        embedded = (ROOT / "web" / "data" / "bridge-files.js").read_text(encoding="utf-8")
        self.assertEqual(embedded, module.build(), "Run tools/gen_bridge_files.py after editing bluetooth-bridge/")

    def test_bridge_requires_pin_and_offers_stop(self):
        bridge = (ROOT / "bluetooth-bridge" / "bridge.sh").read_text(encoding="utf-8")
        self.assertIn("#AUTH#required#END#", bridge)
        self.assertIn('"stop"|"diag motor stop"', bridge)
        self.assertIn("echo 0 > $MOTOR/status", bridge)
        self.assertNotIn("reboot", bridge.split("allowed() {")[1].split("}")[0])

    def test_web_console_loads_remote_scripts(self):
        html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        for script in ("ble-protocol.js", "remote-ui.js", "data/bridge-files.js"):
            self.assertIn(f'src="{script}"', html)
        worker = (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
        for script in ("./ble-protocol.js", "./remote-ui.js", "./data/bridge-files.js"):
            self.assertIn(script, worker)


if __name__ == "__main__":
    unittest.main()
