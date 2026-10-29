#!/usr/bin/env python3
"""End-to-end check of the Hookline -> Sped hand-off for returning visitors.

1. Serve the last Hookline build (from git) and let its offline worker install.
2. Swap the served files for the freshly built site (redirect stubs + retired worker).
3. Revisit the old address: the old worker must clear only Hookline caches and
   unregister, and the next visit must land on Sped.

Stdlib only; uses an isolated temporary Chrome profile. Run from the repo root:
  python3 apps/hazel/sped/tools/legacy_migration_check.py --chrome PATH --artifacts DIR [--old-ref REF]
"""
import argparse
import functools
import io
import json
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from devtools import DevTools

REPO = Path(__file__).resolve().parents[4]  # apps/hazel/sped/tools/ -> repo root


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def extract_old_build(ref, destination):
    archive = subprocess.run(
        ['git', '-C', str(REPO), 'archive', ref, 'apps/hookline/web'],
        capture_output=True, check=True,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(destination / 'extract')
    shutil.copytree(destination / 'extract/apps/hookline/web', destination / 'site/hookline')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--old-ref', default='HEAD')
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='sped-migration-', dir=args.artifacts) as temp:
        temp = Path(temp)
        site = temp / 'site'
        extract_old_build(args.old_ref, temp)
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(site)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'
        profile = temp / 'profile'
        chrome = subprocess.Popen([
            args.chrome, '--headless=new', '--disable-gpu', '--no-first-run',
            '--remote-debugging-port=0', f'--user-data-dir={profile}', 'about:blank',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            cdp = None
            for _ in range(100):
                try:
                    port = int((profile / 'DevToolsActivePort').read_text().splitlines()[0])
                    targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=2))
                    cdp = DevTools(next(t for t in targets if t['type'] == 'page')['webSocketDebuggerUrl'])
                    break
                except (OSError, ValueError, StopIteration):
                    time.sleep(0.1)
            if cdp is None:
                raise RuntimeError('Isolated Chrome did not start')
            cdp.sock.settimeout(60)
            cdp.call('Runtime.enable')
            cdp.call('Page.enable')

            def wait(expression, seconds=30):
                start = time.monotonic()
                while time.monotonic() - start < seconds:
                    try:
                        value = cdp.evaluate(expression)
                    except (RuntimeError, ConnectionError):
                        value = None
                    if value:
                        return value
                    time.sleep(0.2)
                raise TimeoutError(expression)

            def check(name, condition):
                if not condition:
                    raise AssertionError(name)
                results.append({'test': name, 'passed': True})
                print('PASS', name, flush=True)

            # Phase 1: a returning visitor who used Hookline v1.2 offline.
            cdp.call('Page.navigate', url=origin + '/hookline/index.html')
            wait('window.Hookline && Hookline.VERSION')
            wait("(async () => (await caches.keys()).some(k => k.startsWith('hookline-v')))()")
            cdp.evaluate("(async () => { const c = await caches.open('other-app-keep-me'); await c.put('x.txt', new Response('keep')); return true; })()")
            old_version = cdp.evaluate('Hookline.VERSION')
            check(f'old Hookline {old_version} installed with offline cache', True)

            # Phase 2: deploy the new site over the same origin.
            shutil.rmtree(site)
            shutil.copytree(REPO / '_site', site)
            cdp.call('Page.navigate', url=origin + '/hookline/index.html')
            # First revisit may still show the cached page; the retired worker clears up meanwhile.
            wait("(async () => (await navigator.serviceWorker.getRegistrations()).every(r => !r.scope.endsWith('/hookline/')))()", seconds=40)
            keys = cdp.evaluate('(async () => JSON.stringify(await caches.keys()))()')
            check('retired worker unregistered itself', True)
            check('Hookline caches deleted', not any(k.startswith('hookline-v') for k in json.loads(keys)))
            check("other apps' caches untouched", 'other-app-keep-me' in json.loads(keys))

            # Phase 3: the next visit to the old address reaches Sped, keeping query/hash.
            cdp.call('Page.navigate', url=origin + '/hookline/mobile.html?demo=0#top')
            landed = wait("location.pathname.includes('/sped/') && window.Sped && location.href")
            check('old link lands on Sped mobile with query and hash kept', landed.endswith('/sped/mobile.html?demo=0#top'))
            check('new app reports a current Sped version and branding', cdp.evaluate("/^1\\.(3|4)\\./.test(Sped.VERSION) && document.querySelector('h1').textContent === 'Sped'"))
            cdp.call('Browser.close')
        finally:
            if chrome.poll() is None:
                chrome.terminate()
                chrome.wait(timeout=10)
            server.shutdown()
    (args.artifacts / 'migration-results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'PASS {len(results)} migration checks')


if __name__ == '__main__':
    main()
