"""Hermetic checks for ScopeGuard (stdlib only, no browser) - run by scripts/run_all_tests.py.

Checks what breaks a Pages deploy or the product promise:
  * every asset referenced by index.html exists and is relative (Pages serves /projects/scopeguard/)
  * scripts load in dependency order, the service worker only caches files that exist
  * the manifest is valid and its icons exist
  * user text is never inserted as HTML (XSS guard)
  * every policy template loads in the Python engine and behaves on its own samples
  * the web CAD policy matches the server policy the accuracy numbers were measured with
  * the self-hosted server's unittest suite passes

The browser suite (JS engine parity with Python, UI flows) lives in ui-tests/.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
SERVER = APP / "server"
sys.path.insert(0, str(SERVER))

from engine import Engine  # noqa: E402  (server engine, standard library only)

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


index_html = (WEB / "index.html").read_text(encoding="utf-8")

for ref in re.findall(r'(?:src|href)="([^"#]+)"', index_html):
    if ref.startswith(("http://", "https://")):
        continue
    check(not ref.startswith("/"), f"absolute path in index.html: {ref}")
    check((WEB / ref).is_file(), f"index.html references missing file: {ref}")

script_order = re.findall(r'<script src="([^"]+)"', index_html)
check(script_order == ["engine.js", "store.js", "app.js"], f"unexpected script order: {script_order}")

manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
check(manifest.get("start_url") == "./", "manifest start_url must be relative ./")
for icon in manifest.get("icons", []):
    check((WEB / icon["src"]).is_file(), f"manifest icon missing: {icon['src']}")

sw_source = (WEB / "sw.js").read_text(encoding="utf-8")
shell_block = re.search(r"SHELL_FILES = \[(.*?)\];", sw_source, re.S)
check(shell_block is not None, "sw.js has no SHELL_FILES list")
if shell_block:
    for entry in re.findall(r'"([^"]+)"', shell_block.group(1)):
        if entry != "./":
            check((WEB / entry).is_file(), f"sw.js caches a missing file: {entry}")

for script in ("app.js", "engine.js", "store.js"):
    code = re.sub(r"//.*", "", (WEB / script).read_text(encoding="utf-8"))
    dangerous = re.findall(r"\.(?:inner|outer)HTML\s*=|insertAdjacentHTML|document\.write|\beval\(", code)
    check(not dangerous, f"{script} inserts HTML or evals code: {dangerous}")

# No third-party requests: the app must work offline and send nothing anywhere.
# (Lines that build the Integrate page's code samples are display text, not requests.)
for script in ("app.js", "engine.js", "store.js", "index.html"):
    for line in (WEB / script).read_text(encoding="utf-8").splitlines():
        if "code(`" in line:
            continue
        for url in re.findall(r"fetch\(\s*[\"'`](https?://[^\"'`]+)", line):
            check(False, f"{script} fetches a third-party URL: {url}")

templates = {}
for path in sorted((WEB / "policies").glob("*.json")):
    if path.name.endswith(".eval.json"):
        continue
    policy = json.loads(path.read_text(encoding="utf-8"))
    templates[policy["id"]] = policy
    check(path.stem == policy["id"], f"{path.name}: id {policy['id']!r} does not match file name")
    try:
        engine = Engine(policy)
    except Exception as error:  # a broken template would break the app's start-up
        check(False, f"{path.name} does not load in the engine: {error}")
        continue
    for sample in policy.get("samples", []):
        check(bool(engine.check("sample", sample).action), f"{path.name}: sample produced no action: {sample}")
    for user, messages in policy.get("demo", {}).items():
        actions = [engine.check(user, message).action for message in messages]
        # Demo personas: jailbreakers are blocked, free-ChatGPT users are stopped, genuine users are
        # served. Mixed personas (topic creep, student) are intentionally a bit of both - not asserted.
        if "jailbreak" in user:
            check(all(action == "BLOCK" for action in actions), f"{path.name}: jailbreak demo not blocked: {actions}")
        elif "free-ChatGPT" in user:
            check(all(action in ("REDIRECT", "THROTTLE") for action in actions), f"{path.name}: off-topic demo served: {actions}")
        elif any(tag in user for tag in ("real user", "customer", "shopper")):
            check(all(action in ("ALLOW", "ADJACENT") for action in actions),
                  f"{path.name}: genuine user {user!r} was stopped: {actions}")

check(set(templates) == {"cad-copilot", "bank-support", "store-support"}, f"unexpected templates: {sorted(templates)}")

server_policy = json.loads((SERVER / "policy_cad_assistant.json").read_text(encoding="utf-8"))
web_policy = templates.get("cad-copilot", {})
for key in ("mission", "examples", "core_keywords", "adjacent_keywords", "out_of_scope_keywords", "thresholds"):
    check(web_policy.get(key) == server_policy.get(key), f"cad-copilot.json differs from the server policy in {key!r}")

eval_bundle = json.loads((WEB / "policies" / "cad-copilot.eval.json").read_text(encoding="utf-8"))
for eval_set in eval_bundle["sets"]:
    on_disk = json.loads((SERVER / f"{eval_set['id']}.json").read_text(encoding="utf-8"))["cases"]
    check(eval_set["cases"] == on_disk, f"web eval set {eval_set['id']} differs from server/{eval_set['id']}.json")

server_run = subprocess.run(
    [sys.executable, "tests.py"], cwd=SERVER, capture_output=True, text=True, timeout=50
)
check(server_run.returncode == 0, "server unittest suite failed:\n" + server_run.stderr[-2000:])

if failures:
    print("FAILED")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)

tests_ran = re.search(r"Ran (\d+) tests", server_run.stderr)
print(f"OK - web app checks passed, server suite: {tests_ran.group(1) if tests_ran else '?'} tests")
