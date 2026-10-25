#!/usr/bin/env python3
"""Isolated Chrome regressions; stdlib only, no personal browser profile.

Run with --chrome /absolute/path/to/chrome --artifacts /absolute/output/folder.
Chrome is optional and these tests are deliberately separate from unit CI.
"""
import argparse
import base64
import functools
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from devtools import DevTools


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    web = Path(__file__).resolve().parents[1] / 'web'
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(web)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    results = []
    chrome = None
    try:
        with tempfile.TemporaryDirectory(prefix='test-profile-', dir=args.artifacts) as profile:
            chrome = subprocess.Popen([
                args.chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                '--remote-debugging-port=0', f'--user-data-dir={profile}',
                '--autoplay-policy=no-user-gesture-required', 'about:blank',
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cdp = None
            for _ in range(100):
                try:
                    port = int((Path(profile) / 'DevToolsActivePort').read_text().splitlines()[0])
                    targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=2))
                    target = next(t for t in targets if t['type'] == 'page')
                    cdp = DevTools(target['webSocketDebuggerUrl'])
                    break
                except (OSError, ValueError, StopIteration):
                    time.sleep(0.1)
            if cdp is None:
                raise RuntimeError('Isolated Chrome did not start')
            cdp.sock.settimeout(100)
            cdp.call('Runtime.enable')
            cdp.call('Page.enable')
            cdp.call('Network.enable')
            cdp.call('DOM.enable')
            cdp.call('Browser.setDownloadBehavior', behavior='allow', downloadPath=str(args.artifacts.resolve()))
            cdp.call('Network.setCacheDisabled', cacheDisabled=True)

            def wait(expression, seconds=120):
                start = time.monotonic()
                while time.monotonic() - start < seconds:
                    value = cdp.evaluate(expression)
                    if value:
                        return value
                    time.sleep(0.15)
                raise TimeoutError(cdp.evaluate("document.getElementById('status')?.textContent"))

            def check(name, expression):
                wrapped = 'Promise.race([Promise.resolve().then(() => (' + expression + ')), new Promise((_, reject) => setTimeout(() => reject(new Error("Test timed out")), 90000))])'
                value = cdp.evaluate(wrapped)
                if not value:
                    raise AssertionError(name)
                results.append({'test': name, 'passed': True})
                print('PASS', name, flush=True)

            def visit(page, mobile=False):
                cdp.call('Emulation.setDeviceMetricsOverride', width=390 if mobile else 1440,
                         height=844 if mobile else 1000, deviceScaleFactor=1, mobile=mobile)
                cdp.call('Page.navigate', url=url + '/' + page)
                time.sleep(0.3)
                wait('window.HooklineApp && Hookline.VERSION === "1.2.0"')
                if 'demo=1' in page:
                    wait('HooklineApp.state.output && !HooklineApp.state.busy')

            def screenshot(name):
                data = base64.b64decode(cdp.call('Page.captureScreenshot', format='png')['data'])
                (args.artifacts / name).write_bytes(data)

            visit('index.html?demo=1')
            check('real worker demo and honest checklist', '''
                HooklineApp.state.output.plan.targetBpm === 164 &&
                HooklineApp.state.output.plan.targetKey === 'C major' &&
                !/potential|recognition/i.test(document.querySelector('.score').textContent)
            ''')
            screenshot('hookline-desktop.png')
            check('coupled pitch readout reflects actual speed instead of stored independent pitch', '''(async () => {
                document.querySelector('[data-mode=coupled]').click();
                await new Promise(resolve => setTimeout(resolve, 30));
                const source = HooklineApp.state.tracks.find(t => t.role === 'main');
                const expected = 12 * Math.log2(164 / (source.overrides.bpm || source.analysis.bpm));
                const displayed = parseFloat(document.getElementById('semitones-out').textContent);
                const okay = Math.abs(expected - displayed) < 0.02 && document.getElementById('semitones').disabled;
                document.querySelector('[data-mode=independent]').click();
                return okay;
            })()''')
            check('auto-arrange immediately unlocks the clip length control', '''(async () => {
                document.querySelector('[data-action=auto-arrange]').click();
                await new Promise(resolve => setTimeout(resolve, 20));
                while (HooklineApp.state.busy) await new Promise(resolve => setTimeout(resolve, 50));
                return !document.getElementById('lengthSec').disabled && !HooklineApp.state.recipe.segments;
            })()''')
            check('editing supports undocumented sources without asserting publication rights', '''
                HooklineApp.state.output && document.getElementById('rights-card').textContent.includes('does not verify permission') &&
                Hookline.rights.review(HooklineApp.state.tracks, HooklineApp.state.publication).verified === false
            ''')
            check('permission notes and destination persist in portable recipes', '''(async () => {
                const basis = document.querySelector('[data-rights=basis]');
                basis.value = 'platform-only';
                basis.dispatchEvent(new Event('change', {bubbles:true}));
                const destination = document.querySelector('[data-publication=platform]');
                destination.value = 'instagram';
                destination.dispatchEvent(new Event('change', {bubbles:true}));
                await new Promise(resolve => setTimeout(resolve, 30));
                const saved = Hookline.recipes.saveProject(HooklineApp.state.tracks, HooklineApp.state.recipe, '', HooklineApp.state.publication);
                const restored = Hookline.recipes.loadProject(saved, HooklineApp.state.tracks);
                return restored.assignments[0].rights.basis === 'platform-only' && restored.publication.platform === 'instagram' &&
                    document.getElementById('rights-summary').textContent.includes('do not automatically transfer');
            })()''')
            report_file = args.artifacts / 'hookline-publishing-notes.json'
            session_file = args.artifacts / 'hookline-current-session.json'
            report_file.unlink(missing_ok=True)
            session_file.unlink(missing_ok=True)
            cdp.evaluate("document.querySelector('[data-rights-action=report]').click(); document.querySelector('[data-rights-action=session]').click();")
            for _ in range(100):
                if report_file.exists() and session_file.exists():
                    break
                time.sleep(0.05)
            exported_report = json.loads(report_file.read_text())
            exported_session = json.loads(session_file.read_text())
            if exported_report.get('verified') is not False or exported_session['sources'][0]['rights']['basis'] != 'platform-only':
                raise AssertionError('Actual publishing/session downloads lost declarations or claimed clearance')
            results.append({'test': 'publishing notes and current-session recipe download through UI', 'passed': True})
            print('PASS publishing notes and current-session recipe download through UI', flush=True)
            check('invalid explicit target BPM is refused rather than silently becoming auto', '''(async () => {
                const previous = HooklineApp.state.recipe.targetBpm;
                const input = document.getElementById('targetBpm');
                input.value = '0';
                input.dispatchEvent(new Event('change', {bubbles:true}));
                await new Promise(resolve => setTimeout(resolve, 20));
                return HooklineApp.state.recipe.targetBpm === previous && /40.240/.test(document.getElementById('status').textContent);
            })()''')
            check('changed settings visibly mark previous render', '''(() => {
                const before = HooklineApp.state.output.savedProject.recipe.semitones;
                const el = document.getElementById('semitones');
                el.value = '6';
                el.dispatchEvent(new Event('input', {bubbles:true}));
                return HooklineApp.state.stale && document.querySelector('#output-card .warn').textContent.includes('PREVIOUS') &&
                    HooklineApp.state.output.savedProject.recipe.semitones === before;
            })()''')
            cdp.evaluate("document.getElementById('request').value = 'faster, no reverb, without bass, no loop, 12 seconds'; document.querySelector('[data-action=remix]').click();")
            wait("!HooklineApp.state.busy && HooklineApp.state.output.plan.recipe.lengthSec === 12")
            check('request negation through UI', "HooklineApp.state.recipe.fx.reverb === 0 && HooklineApp.state.recipe.fx.bass === 0 && !HooklineApp.state.recipe.loop")
            check('cancel locks UI and recovered worker keeps all sources', '''(async () => {
                const before = HooklineApp.state.tracks.length;
                const task = HooklineApp.renderRemix();
                const locked = document.getElementById('workspace').disabled;
                HooklineApp.engine.cancel();
                await task;
                const output = await HooklineApp.renderRemix();
                return locked && !!output && HooklineApp.state.tracks.length === before && !HooklineApp.state.busy;
            })()''')
            check('worker failure rejects task and next render rehydrates', '''(async () => {
                let worker;
                const client = Hookline.createEngineClient(() => HooklineApp.state.tracks, () => {}, () => {
                    worker = new Worker('worker.js'); return worker;
                });
                const settings = Object.fromEntries(HooklineApp.state.tracks.map(t => [t.id, {role:t.role, overrides:t.overrides, name:t.name}]));
                const recipe = HooklineApp.state.recipe;
                const first = await client.call('render', {settings, recipe});
                const task = client.call('render', {settings, recipe});
                worker.onerror({preventDefault() {}});
                let rejected = false;
                try { await task; } catch (e) { rejected = /stopped/.test(e.message); }
                const recovered = await client.call('render', {settings, recipe});
                client.cancel();
                return rejected && first.channels[0].length === recovered.channels[0].length;
            })()''')
            check('bounded timeout reports actionable error', '''(async () => {
                const original = window.setTimeout;
                window.setTimeout = (fn, delay, ...args) => original(fn, delay === 90000 ? 10 : delay, ...args);
                const client = Hookline.createEngineClient(() => [], () => {}, () => ({postMessage() {}, terminate() {}}));
                let message = '';
                try { await client.call('addTrack', {}); } catch (e) { message = e.message; }
                finally { window.setTimeout = original; client.cancel(); }
                return /timed out/.test(message);
            })()''')
            project = args.artifacts / 'portable-test.json'
            project.write_text(cdp.evaluate('JSON.stringify(HooklineApp.state.output.savedProject)'))
            cdp.evaluate("HooklineApp.state.tracks.reverse(); HooklineApp.state.tracks.forEach((t, i) => t.id = 'restored' + i); HooklineApp.engine.cancel();")
            doc = cdp.call('DOM.getDocument')['root']['nodeId']
            node = cdp.call('DOM.querySelector', nodeId=doc, selector='#request-card [data-action=load-recipe]')['nodeId']
            cdp.call('DOM.setFileInputFiles', nodeId=node, files=[str(project.resolve())])
            wait("!HooklineApp.state.busy && HooklineApp.state.output.plan.mainId.startsWith('restored')")
            check('portable recipe file maps reordered uploads correctly', "HooklineApp.state.output.plan.tracks[HooklineApp.state.output.plan.mainId].name.includes(\"That's What You Get\")")
            # Worker remains functional through three distinct presets.
            cdp.evaluate("document.querySelector('[data-action=variants]').click()")
            wait('HooklineApp.state.variants.length === 3 && !HooklineApp.state.busy', seconds=60)
            check('three variants complete without overlapping jobs', 'HooklineApp.state.variants.every(v => v.channels[0].length > 0)')
            # Save a genuine WAV from the browser renderer and re-upload it to exercise decodeAudioData.
            wav = args.artifacts / 'synthetic-upload.wav'
            wav.write_bytes(base64.b64decode(cdp.evaluate('Hookline.base64FromBuffer(Hookline.encodeWav(HooklineApp.state.output.channels, HooklineApp.state.output.sampleRate))')))
            visit('web.html')
            doc = cdp.call('DOM.getDocument')['root']['nodeId']
            node = cdp.call('DOM.querySelector', nodeId=doc, selector='#file-input')['nodeId']
            cdp.call('DOM.setFileInputFiles', nodeId=node, files=[str(wav.resolve())])
            wait('HooklineApp.state.tracks.length === 1 && HooklineApp.state.tracks[0].ready && !HooklineApp.state.busy')
            cdp.evaluate("document.getElementById('request').value = 'slower, 8 seconds'; document.querySelector('[data-action=remix]').click();")
            wait('HooklineApp.state.output && !HooklineApp.state.busy')
            check('actual WAV file upload, decode, analyse and render', 'HooklineApp.state.output.channels[0].length > 10000')
            check('offline worker ready on loopback', '(async () => !!(await navigator.serviceWorker.ready).active)()')
            check('cache activation retains foreign app data', '''(async () => {
                const foreign = await caches.open('other-app-test');
                await foreign.put('foreign.txt', new Response('keep'));
                await caches.open('hookline-v0-test');
                const registration = await navigator.serviceWorker.register('sw.js?test-update=1');
                await new Promise(resolve => {
                    if (registration.waiting) { resolve(); return; }
                    const w = registration.installing;
                    if (!w || w.state === 'installed') { resolve(); return; }
                    w.addEventListener('statechange', () => { if (w.state === 'installed') resolve(); });
                });
                for (let i = 0; i < 100 && !registration.waiting && !registration.active?.scriptURL.includes('test-update=1'); i++) {
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                if (registration.waiting) {
                    const activated = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
                    registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
                    await activated;
                }
                // controllerchange can precede completion of activate.waitUntil.
                for (let i = 0; i < 100 && registration.active?.state !== 'activated'; i++) {
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                const keys = await caches.keys();
                if (!keys.includes('other-app-test') || keys.includes('hookline-v0-test')) {
                    throw new Error(JSON.stringify({keys, active:registration.active?.scriptURL, waiting:registration.waiting?.scriptURL}));
                }
                return true;
            })()''')
            cdp.call('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
            visit('mobile.html?demo=1&offline=1', mobile=True)
            check('offline query-string demo renders on mobile', 'HooklineApp.state.output.plan.targetBpm === 164')
            check('mobile has no horizontal overflow', 'document.documentElement.scrollWidth === 390')
            cdp.evaluate("document.getElementById('output-card').scrollIntoView({behavior:'instant'})")
            screenshot('hookline-mobile.png')
            cdp.evaluate("document.getElementById('rights-card').scrollIntoView({behavior:'instant'})")
            screenshot('hookline-publishing-notes.png')
            cdp.evaluate("document.querySelector('.track [data-action=remove]').click()")
            wait("HooklineApp.state.tracks.length === 2")
            check('removed main is reassigned and missing arrangement source is visible', '''
                HooklineApp.state.tracks.some(t => t.role === 'main' && t.id === HooklineApp.state.recipe.mainId) &&
                document.getElementById('arrange-card').textContent.includes('Missing track')
            ''')
            errors = [e for e in cdp.events if e.get('method') == 'Runtime.exceptionThrown']
            if errors:
                raise AssertionError(errors)
            results.append({'test': 'no unhandled page exceptions', 'passed': True})
            print(f'PASS {len(results)} browser checks', flush=True)
            cdp.call('Browser.close')
            chrome.wait(timeout=10)
    finally:
        if chrome and chrome.poll() is None:
            chrome.terminate()
            chrome.wait(timeout=10)
        server.shutdown()
        (args.artifacts / 'browser-results.json').write_text(json.dumps(results, indent=2) + '\n')


if __name__ == '__main__':
    main()
