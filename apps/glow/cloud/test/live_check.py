"""Live check of the deployed Glow cloud browser: start a session, fill a public test form,
confirm submitting needs approval, submit with approval, confirm private addresses are blocked, close.
Usage: python live_check.py https://glow-cloud.<subdomain>.workers.dev
"""
import json
import sys
import time
import urllib.error
import urllib.request

SERVICE = sys.argv[1].rstrip("/")
ORIGIN = "https://juw12.github.io"
FORM = "https://httpbin.org/forms/post"


def post(path, body, attempts=3):
    for attempt in range(attempts):
        request = urllib.request.Request(
            SERVICE + path,
            data=json.dumps(body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "Origin": ORIGIN, "User-Agent": "glow-live-check/1.0"},
        )
        started = time.time()
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.status, json.loads(response.read()), time.time() - started
        except urllib.error.HTTPError as error:
            raw = error.read() or b"{}"
            try:
                return error.code, json.loads(raw), time.time() - started
            except ValueError:
                return error.code, {"error": raw.decode("utf-8", "replace")[:300]}, time.time() - started
        except Exception as error:
            print(f"  {path}: attempt {attempt + 1} failed: {error!r}")
            time.sleep(3)
    raise AssertionError(f"{path} kept failing")


def main():
    code, started, seconds = post("/v1/sessions", {})
    assert code == 200, (code, started)
    print(f"session started in {seconds:.1f}s")
    session = started["session"]

    def call(path, body=None):
        code, data, seconds = post(f"/v1/sessions/{session}/call", {"path": path, "body": body})
        print(f"{path:8} {code} {seconds:5.1f}s {str({k: data.get(k) for k in ('title', 'url', 'error') if k in data})[:150]}")
        return code, data

    try:
        assert call("status")[0] == 200
        assert call("act", {"action": {"action": "goto", "url": FORM}})[0] == 200
        code, seen = call("observe")
        refs = {element["name"]: element["ref"] for element in seen["elements"]}
        name_ref = next(ref for name, ref in refs.items() if "Customer name" in name)
        submit_ref = next(ref for name, ref in refs.items() if "Submit order" in name)
        assert call("act", {"action": {"action": "type", "ref": name_ref, "text": "Glow Cloud"}})[0] == 200
        code, blocked = call("act", {"action": {"action": "click", "ref": submit_ref}})
        assert code == 409 and blocked.get("needsApproval"), blocked
        code, done = call("act", {"action": {"action": "click", "ref": submit_ref}, "approved": True})
        assert code == 200, done
        code, after = call("observe")
        assert "httpbin.org/post" in after.get("url", ""), after
        code, private = call("act", {"action": {"action": "goto", "url": "http://192.168.1.1/"}})
        assert code == 400, private
    finally:
        call("close")
    assert call("status")[0] == 410
    print("live check passed")


if __name__ == "__main__":
    main()
