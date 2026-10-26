"""Tests for the scheduled GlowLead runner: mission loading and a full headless run with a stub AI."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "runner"))
import run_missions  # noqa: E402

try:
    import playwright  # noqa: F401
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False

STUB_ENGINE = r"""
window.CrewEngine = {
  BOTS: {},
  tools: {
    chat: async (options) => {
      if (options.system.startsWith("You are GlowLead, the lead of a team")) {
        return JSON.stringify({ summary: "Tips", criteria: ["Three tips", "Each has an action"],
          steps: [{ worker: "chat", title: "Write tips", task: "Write three tips" }] });
      }
      if (options.system.includes("CHECK:")) return '## Three desk tips\n1. Coil cables.\nCHECK: {"met":[true,true],"missing":""}';
      return "1. Coil cables. 2. Use a bin. 3. Label filament.";
    }
  },
  start: () => ({ id: "x", status: "done", final: "", steps: [] }),
  getRun: () => null, stop: () => {}, on: () => {}, openSettings: () => {},
  glow: { status: () => ({ signedIn: false }), signIn: async () => {} }
};
"""


class MissionLoadingTests(unittest.TestCase):
    def test_goal_beats_secret_beats_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "missions.json"
            path.write_text(json.dumps({"missions": [{"name": "File", "goal": "from file"}]}), encoding="utf-8")
            self.assertEqual(run_missions.load_missions({}, path)[0]["goal"], "from file")
            secret = json.dumps({"missions": [{"goal": "from secret"}]})
            self.assertEqual(run_missions.load_missions({"GLOW_MISSIONS": secret}, path)[0]["goal"], "from secret")
            self.assertEqual(run_missions.load_missions({"GLOW_MISSIONS": secret, "GLOW_GOAL": " manual "}, path)[0]["goal"], "manual")

    def test_days_enabled_and_invalid_entries(self):
        raw = json.dumps({"missions": [
            {"goal": "every day"},
            {"goal": "mondays", "days": ["Monday"]},
            {"goal": "paused", "enabled": False},
            {"goal": "   "}, {"name": "no goal"}, "junk", {"goal": 5},
        ]})
        self.assertEqual([m["goal"] for m in run_missions.parse_missions(raw, today="mon")], ["every day", "mondays"])
        self.assertEqual([m["goal"] for m in run_missions.parse_missions(raw, today="tue")], ["every day"])

    def test_limits_and_bad_json(self):
        raw = json.dumps([{"goal": f"g{i}"} for i in range(20)])
        self.assertEqual(len(run_missions.parse_missions(raw, today="mon")), run_missions.MAX_MISSIONS)
        with self.assertRaises(SystemExit):
            run_missions.parse_missions("{not json", today="mon")

    def test_default_file_is_empty_and_list_mode(self):
        self.assertEqual(run_missions.load_missions({}, run_missions.HERE / "missions.json"), [])
        env = {key: value for key, value in os.environ.items() if not key.startswith("GLOW_")}
        result = subprocess.run([sys.executable, str(APP / "runner" / "run_missions.py"), "--list"],
                                capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(result.stdout.strip(), "0")


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run the headless runner")
class HeadlessRunTests(unittest.TestCase):
    def test_runs_real_glowlead_page_and_writes_report_and_summary(self):
        with tempfile.TemporaryDirectory() as folder:
            stub = Path(folder) / "stub.js"
            stub.write_text(STUB_ENGINE, encoding="utf-8")
            summary = Path(folder) / "summary.md"
            out = Path(folder) / "reports"
            env = {key: value for key, value in os.environ.items() if not key.startswith("GLOW_")}
            env.update({"GLOW_GOAL": "Write three desk tips", "GITHUB_STEP_SUMMARY": str(summary)})
            result = subprocess.run([sys.executable, "-X", "utf8", str(APP / "runner" / "run_missions.py"),
                                     "--out", str(out), "--engine-stub", str(stub), "--timeout-minutes", "2"],
                                    capture_output=True, text=True, env=env, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            reports = list(out.glob("*.md"))
            self.assertEqual(len(reports), 1)
            text = reports[0].read_text(encoding="utf-8")
            for expected in ("# Write three desk tips", "Three desk tips", "## Done-criteria", "- [x] Three tips",
                             "Browser control (Glow Hands): not allowed", "Crew code execution: not allowed", "## Activity"):
                self.assertIn(expected, text)
            table = summary.read_text(encoding="utf-8")
            self.assertIn("| Write three desk tips | done | all criteria met (AI review) |", table)


if __name__ == "__main__":
    unittest.main(verbosity=2)
