#!/usr/bin/env python3
"""Real isolated Chromium checks; skips explicitly if Chrome is not installed.

No third-party test dependencies. Only an ephemeral local server and fresh browser
profile are used; does not touch the user's normal browser profile.
"""
import functools
import html
import http.server
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

APP = Path(__file__).resolve().parent.parent


def main():
    browser = next((path for path in [
        shutil.which('google-chrome'), shutil.which('chromium'), shutil.which('chromium-browser'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ] if path and Path(path).is_file()), None)
    if not browser:
        print('SKIPPED: Chrome/Chromium not installed; browser checks were not run.')
        return

    finished = threading.Event()
    latest = {"done": False, "checks": []}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_POST(self):
            if self.path != '/__result':
                self.send_error(404)
                return
            report = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
            latest.update(report)
            if report.get('done'):
                finished.set()
            self.send_response(204)
            self.end_headers()

        def do_GET(self):
            if self.path == '/__checks.html':
                body = (APP / 'tests/browser_checks.html').read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def log_message(self, *args):
            pass

    handler = functools.partial(Handler, directory=str(APP / 'web'))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='trade-twin-browser-') as profile:
            args = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                    '--disable-extensions', '--disable-background-networking',
                    '--user-data-dir=' + profile,
                    'http://127.0.0.1:%d/__checks.html' % server.server_port]
            if os.environ.get('CI') or (hasattr(os, 'geteuid') and os.geteuid() == 0):
                args.insert(1, '--no-sandbox')
            process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                finished.wait(45)
                report = dict(latest)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            failures = []
            for check in report['checks']:
                print(('PASS ' if check['pass'] else 'FAIL ') + check['name'])
                if not check['pass']:
                    failures.append(check['name'])
            if not report.get('done'):
                failures.append('Browser stopped before completion')
                print('FAIL Browser stopped before completion')
            if failures:
                raise SystemExit('FAILED: %d browser checks' % len(failures))
            print('PASSED: %d real-browser checks' % len(report['checks']))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
