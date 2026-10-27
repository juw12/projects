import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def find_shell():
    """A POSIX shell to run the bridge functions (Git Bash on Windows)."""
    for candidate in (shutil.which("bash"), shutil.which("sh"),
                      os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin\bash.exe"),
                      r"C:\Program Files\Git\bin\bash.exe"):
        if candidate and Path(candidate).exists() and "System32" not in candidate:
            return candidate
    return None


# Runs the real handler/bookkeeping functions of bridge.sh with stubbed Bluetooth.
SCENARIO = r'''
set -u
D="$1"
A="$1"
PIN=123456
MOTOR="$1/motor"
mkdir -p "$MOTOR"
. "$1/functions.sh"
notify_text() { printf '%s' "$1" >> "$D/notified"; }
diag() { echo "#INFO#0.0.0.3#END#"; }
echo "AA:BB:CC:00:11:22" > "$D/self"
: > "$D/clients"
mark() { echo "=== $1" >> "$D/notified"; }
link_event "[CHG] Device 5C:11:22:33:44:55 Connected: yes"
mark hello1
handle "hello iPhone (Bluefy)"
mark auth
handle "auth 123456"
link_event "[CHG] Device 70:AA:BB:CC:DD:EE Connected: yes"
mark hello2
handle "hello Windows PC|evil;rm -rf /"
mark who1
handle "who"
link_event "[CHG] Device 5C:11:22:33:44:55 Connected: no"
mark who2
handle "who"
mark version
handle "diag ver sw"
cat "$D/clients" > "$D/clients.final"
'''


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

    def test_bridge_tracks_connected_clients(self):
        shell = find_shell()
        if not shell:
            self.skipTest("no POSIX shell available")
        bridge = (ROOT / "bluetooth-bridge" / "bridge.sh").read_text(encoding="utf-8")
        functions = bridge[bridge.index("log() {"):bridge.index("stop_bridge() {")]
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "functions.sh").write_text(functions, encoding="utf-8", newline="\n")
            Path(folder, "scenario.sh").write_text(SCENARIO, encoding="utf-8", newline="\n")
            posix_folder = folder.replace("\\", "/")
            if len(posix_folder) > 1 and posix_folder[1] == ":":
                posix_folder = "/" + posix_folder[0].lower() + posix_folder[2:]
            subprocess.run([shell, posix_folder + "/scenario.sh", posix_folder], check=True, timeout=60)
            notified = Path(folder, "notified").read_text(encoding="utf-8")
            clients = Path(folder, "clients.final").read_text(encoding="utf-8").strip().splitlines()
        sections = dict(part.split("\n", 1) for part in notified.split("=== ")[1:])
        self.assertIn("#HELLO#5C:11:22:33:44:55#END#", sections["hello1"])
        self.assertIn("#AUTH#ok#END#", sections["auth"])
        # Labels are sanitised: no field separators or shell characters survive.
        self.assertIn("#HELLO#70:AA:BB:CC:DD:EE#END#", sections["hello2"])
        who1 = sections["who1"]
        self.assertTrue(who1.startswith("#WHO#AA:BB:CC:00:11:22#"), who1)
        entries = who1.split("#")[3].split(";")
        self.assertEqual(len(entries), 2, who1)
        first, second = (entry.split("|") for entry in entries)
        self.assertEqual((first[0], first[1], first[3]), ("5C:11:22:33:44:55", "iPhone (Bluefy)", "1"))
        self.assertEqual((second[0], second[1], second[3]), ("70:AA:BB:CC:DD:EE", "Windows PCevilrm -rf ", "0"))
        self.assertNotIn(";rm", sections["who1"].split("#")[3].replace(";70:", ""))
        self.assertIn("#WHO#AA:BB:CC:00:11:22#70:AA:BB:CC:DD:EE|", sections["who2"])
        self.assertNotIn("5C:11", sections["who2"])
        self.assertIn("#BRIDGE#3#END#", sections["version"])
        self.assertEqual(len(clients), 1)

    def test_web_console_loads_remote_scripts(self):
        html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        for script in ("ble-protocol.js", "remote-ui.js", "data/bridge-files.js"):
            self.assertIn(f'src="{script}"', html)
        worker = (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
        for script in ("./ble-protocol.js", "./remote-ui.js", "./data/bridge-files.js"):
            self.assertIn(script, worker)


if __name__ == "__main__":
    unittest.main()
