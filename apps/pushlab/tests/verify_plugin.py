"""Checks the Push Lab agent plugin: manifests, SKILL.md files and the CLI end to end.

  python apps/pushlab/tests/verify_plugin.py

The end-to-end part starts a real Beacon and a real Tether (with the fake adb
from apps/pushlab/tether/tests) and drives them only through the skills' CLI, the way an
agent would: status, ui, tap, flow (Maestro YAML), record, push, push-check.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUSHLAB = HERE.parent
APPS = PUSHLAB.parent
REPO = APPS.parent
PLUGIN = PUSHLAB / "plugin"
TETHER_TESTS = PUSHLAB / "tether" / "tests"
FLAGS = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0
ADMIN = "adm_plugin_test"
TOKEN = "plugin-test-token"
PASSES = 0
FAILURES: list[str] = []


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def frontmatter(text: str) -> dict:
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def static_checks() -> list[Path]:
    print("manifests + skills")
    marketplace = json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))
    check(marketplace.get("name") and marketplace.get("owner", {}).get("name") and marketplace.get("plugins"),
          "marketplace.json has name, owner, plugins")
    entry = marketplace["plugins"][0]
    source = (REPO / entry["source"]).resolve()
    check(entry["source"].startswith("./") and source == PLUGIN.resolve(), "plugin source is a ./relative path to the plugin")
    manifest = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    check(manifest["name"] == entry["name"] and re.fullmatch(r"[a-z0-9-]+", manifest["name"]),
          "plugin.json name matches the marketplace entry (kebab-case)")
    check(re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")) is not None, "plugin.json has a semver version")
    skill_dirs = [(PLUGIN / path).resolve() for path in manifest["skills"]]
    check(all(d.is_dir() and PLUGIN.resolve() in d.parents for d in skill_dirs),
          f"all {len(skill_dirs)} skill paths exist inside the plugin (plugins are copied to a cache)")
    clis = []
    for folder in skill_dirs:
        text = (folder / "SKILL.md").read_text(encoding="utf-8")
        meta = frontmatter(text)
        name_ok = meta.get("name") == folder.name and re.fullmatch(r"[a-z0-9-]{1,64}", meta.get("name", ""))
        description = meta.get("description", "")
        check(name_ok and 40 <= len(description) <= 1024 and "Use when" in description,
              f"{folder.name}: frontmatter name matches folder, description says when to use it")
        referenced = set(re.findall(r"scripts/[\w.\-]+", text))
        check(referenced and all((folder / ref).is_file() for ref in referenced),
              f"{folder.name}: every scripts/ file it mentions exists ({', '.join(sorted(referenced))})")
        clis.append(folder / "scripts" / "pushlab_cli.py")
    sources = {cli.read_bytes() for cli in clis}
    check(len(sources) == 1, "each skill carries an identical copy of pushlab_cli.py")
    return clis


def run_cli(cli: Path, cwd: Path, env: dict, *args: str) -> tuple[int, object]:
    proc = subprocess.run([sys.executable, str(cli), *args], cwd=cwd, env=env, capture_output=True,
                          text=True, encoding="utf-8", timeout=120, creationflags=FLAGS)
    try:
        payload = json.loads(proc.stdout) if proc.stdout.strip() else None
    except ValueError:
        payload = proc.stdout + proc.stderr
    return proc.returncode, payload


def e2e(cli: Path) -> None:
    print("CLI against real Beacon + Tether (fake adb)")
    sys.path.insert(0, str(TETHER_TESTS))
    import verify_beacon_link as link  # PhonePushService: a fake push service feeding the fake phone

    with tempfile.TemporaryDirectory(prefix="pushlab-plugin-") as tmp_name:
        tmp = Path(tmp_name)
        notifications = tmp / "notifications.json"
        fake_log = tmp / "adb.log"
        phone = link.PhonePushService(notifications)
        env = dict(os.environ)
        env.update({
            "BEACON_TEST_HOSTS": "127.0.0.1",
            "BEACON_QUIET": "1",
            "BEACON_PROXY": "none",
            "TETHER_ADB": str(TETHER_TESTS / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(fake_log),
            "TETHER_FAKE_NOTIFS": str(notifications),
            "TETHER_FAKE_SHADE": str(tmp / "shade.flag"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_RECORDINGS_DIR": str(tmp / "recordings"),
            "TETHER_REPORTS_DIR": str(tmp / "reports"),
            "TETHER_QUIET": "1",
        })
        for key in ("BEACON_URL", "BEACON_KEY", "BEACON_APP_ID", "TETHER_URL", "TETHER_TOKEN", "PUSHLAB_CONFIG"):
            env.pop(key, None)
        processes = []
        try:
            beacon_port = link.free_port()
            processes.append(subprocess.Popen(
                [sys.executable, str(PUSHLAB / "beacon" / "server" / "server.py"), "--port", str(beacon_port),
                 "--data", str(tmp / "beacon.db"), "--admin-token", ADMIN],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=FLAGS))
            link.wait_port(beacon_port)
            beacon = f"http://127.0.0.1:{beacon_port}"
            _status, created = link.call(beacon, "POST", "/v1/apps", {"name": "Plugin QA"},
                                         {"Authorization": f"Bearer {ADMIN}"})
            secret = created["secret_key"]
            link.call(beacon, "POST", "/v1/subscribe", {"app_key": created["app"]["app_key"],
                                                         "subscription": phone.subscription("phone"),
                                                         "tags": ["qa:device"]})
            tether_port = link.free_port()
            processes.append(subprocess.Popen(
                [sys.executable, str(PUSHLAB / "tether" / "server" / "server.py"), "--port", str(tether_port),
                 "--token", TOKEN, "--no-browser", "--beacon-url", beacon, "--beacon-key", secret],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=FLAGS))
            link.wait_port(tether_port)

            # what `python apps/pushlab/pushlab.py` writes; the CLI must find it by walking up from cwd
            lab_dir = tmp / "repo" / "apps" / "pushlab" / ".pushlab"
            lab_dir.mkdir(parents=True)
            (lab_dir / "lab.json").write_text(json.dumps({
                "admin_token": ADMIN, "tether_token": TOKEN, "secret": secret, "app_id": created["app"]["id"],
                "beacon_url": beacon, "tether_url": f"http://127.0.0.1:{tether_port}",
            }), encoding="utf-8")
            work = tmp / "repo" / "some" / "subfolder"
            work.mkdir(parents=True)

            code, status = run_cli(cli, work, env, "status")
            check(code == 0 and status["lab_config"].endswith("lab.json") and status["tether"].get("devices")
                  and status["beacon"].get("app", {}).get("name") == "Plugin QA",
                  "status: finds lab.json by walking up, sees Tether devices and the Beacon app")

            code, ui = run_cli(cli, work, env, "ui")
            texts = [e.get("text") for e in ui["elements"]] if code == 0 else []
            check("Sign in" in texts and "Welcome to Demo" in texts, "ui: lists labelled elements")

            code, _ = run_cli(cli, work, env, "tap-text", "Sign in")
            log_lines = fake_log.read_text(encoding="utf-8").splitlines()
            check(code == 0 and "input tap 540 1880" in log_lines, "tap-text taps the element centre")
            code, missing = run_cli(cli, work, env, "tap-text", "Nope")
            check(code == 2 and "error" in missing, "tap-text on a missing element exits 2 with the reason")

            code, shot = run_cli(cli, work, env, "screenshot", "--out", str(tmp / "s.png"))
            check(code == 0 and (tmp / "s.png").read_bytes()[:4] == b"\x89PNG", "screenshot saves a PNG")

            flow_file = tmp / "login.yaml"
            flow_file.write_text("appId: com.demo.app\n---\n- launchApp\n- tapOn: \"Email\"\n"
                                 "- inputText: \"qa@example.com\"\n- assertVisible: \"Welcome to Demo\"\n",
                                 encoding="utf-8")
            code, report = run_cli(cli, work, env, "flow", str(flow_file))
            check(code == 0 and report.get("passed") is True, "flow: Maestro YAML converted and passed")
            flow_file.write_text("appId: com.demo.app\n---\n- assertVisible: \"Not on screen\"\n", encoding="utf-8")
            code, report = run_cli(cli, work, env, "flow", str(flow_file))
            check(code == 1 and report.get("passed") is False, "flow: a failing assertion exits 1")

            code, _ = run_cli(cli, work, env, "record", "start")
            time.sleep(0.5)
            code2, video = run_cli(cli, work, env, "record", "stop", "--out", str(tmp / "rec.mp4"))
            check(code == 0 and code2 == 0 and (tmp / "rec.mp4").read_bytes()[4:8] == b"ftyp",
                  "record start/stop downloads the MP4")

            code, message = run_cli(cli, work, env, "push", "--title", "Direct push", "--tag", "qa:device")
            check(code == 0 and message["status"] == "sent" and message["delivered"] == 1,
                  "push: Beacon sent it and the push service accepted it")

            title = f"QA ping {int(time.time())}"
            code, result = run_cli(cli, work, env, "push-check", "--title", title, "--tap", "--timeout", "20")
            check(code == 0 and result["on_device"]["title"] == title and result.get("tapped") is True,
                  f"push-check: delivered to the fake phone, found and tapped ({result.get('seconds') if code == 0 else result})")
            code, result = run_cli(cli, work, env, "push-check", "--title", "never sent", "--tag", "qa:nobody",
                                   "--timeout", "2")
            check(code != 0, "push-check fails when nothing arrives")

            first = run_cli(cli, work, env, "push", "--title", "c1", "--digest-key", "k1", "--digest-window", "60")
            second = run_cli(cli, work, env, "push", "--title", "c2", "--digest-key", "k1", "--digest-window", "60")
            check(first[0] == 0 and second[0] == 0 and first[1]["digested"] is False and second[1]["digested"] is True
                  and first[1]["message"]["id"] == second[1]["message"]["id"], "push --digest-key folds sends together")

            code, messages = run_cli(cli, work, env, "beacon-messages")
            check(code == 0 and len(messages) >= 2, "beacon-messages lists the sends")

            midscene_file = tmp / "smoke.yaml"
            midscene_file.write_text("android:\n  launch: com.demo.app\ntasks:\n  - name: smoke\n    flow:\n"
                                     "      - sleep: 100\n      - recordToReport: home\n", encoding="utf-8")
            code, report = run_cli(cli, work, env, "flow", str(midscene_file))
            check(code == 0 and report.get("passed") is True and report["steps"][0]["action"] == "launch",
                  "flow: Midscene YAML converted and passed")
            code, matrix = run_cli(cli, work, env, "flow", str(midscene_file), "--all-devices")
            check(code == 0 and matrix.get("devices") == 1 and matrix.get("passed") is True
                  and "png_base64" not in json.dumps(matrix), "flow --all-devices: one report per device, no image blobs")

            code, started = run_cli(cli, work, env, "trace", "start", "--package", "com.demo.app")
            code2, trace = run_cli(cli, work, env, "trace", "stop", "--out", str(tmp / "t.pftrace"))
            check(code == 0 and code2 == 0 and (tmp / "t.pftrace").stat().st_size == trace.get("bytes", -1),
                  "trace start/stop downloads the Perfetto trace")
            code, leaks = run_cli(cli, work, env, "leaks", "--max", "0")
            check(code == 0 and leaks.get("application_leaks") == 0, "leaks --max 0 passes with no LeakCanary report")

            code, saved = run_cli(cli, work, env, "template", "save", "hello", "--title", "Hello {{name}}",
                                  "--channel", "webpush")
            check(code == 0 and saved.get("variables") == ["name"], "template save lists its variables")
            code, message = run_cli(cli, work, env, "push", "--template", "hello", "--var", "name=Ana",
                                    "--tag", "qa:device")
            check(code == 0 and message.get("title") == "Hello Ana" and message.get("delivered") == 1,
                  "push --template --var renders and delivers")
            code, prefs = run_cli(cli, work, env, "prefs", "--user", "ana", "--category", "marketing", "--off")
            marketing = {c["category"]: c for c in prefs.get("categories", [])}.get("marketing", {}) if code == 0 else {}
            check(marketing.get("enabled") is False, "prefs --off stores an opt-out")

            bad_env = dict(env, TETHER_URL="http://127.0.0.1:9")
            code, error = run_cli(cli, work, bad_env, "devices")
            check(code == 2 and "cannot reach" in error["error"], "unreachable Tether -> exit 2 with a hint")
        finally:
            for process in processes:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            phone.server.shutdown()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    clis = static_checks()
    e2e(clis[0])
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
