'use strict';
/*
 * 1.11.16 end-to-end check: "one PC shares, the other types the code but sees no camera".
 *
 * Two isolated browser profiles run the real console from a local server (fake webcam):
 *   host   = PC with the AIRIZ (demo device), shares with Remote by code BEFORE its camera
 *            preview can start (the failing case in the field);
 *   viewer = the other PC, connects by code.
 * Checks that the viewer gets the camera once the host preview starts, again after the host
 * restarts the preview, that the Camera tab has no Phone viewer card, and that Share control
 * shows who is watching. Uses the public PeerJS server and the AIRIZ relay (network needed).
 *
 * Usage: node tests/camera-share-e2e.cjs [hostWebRoot] [viewerWebRoot]   (default: ../web for both;
 *        a second root checks mixed versions, e.g. an older console on the viewer PC)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const webRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'web'));
const viewerRoot = path.resolve(process.argv[3] || webRoot);
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(candidate => fs.existsSync(candidate));
const SETTINGS = JSON.stringify({ language: 'en', region: 'ID' });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const results = [];
function stamp(text) {
  console.log(new Date().toISOString().slice(11, 19) + ' ' + text);
}
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  stamp((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
}

function serve(root) {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openConsole(context, url) {
  const page = await context.newPage();
  page.on('pageerror', error => stamp('page error: ' + error.message));
  await page.addInitScript(value => {
    localStorage.setItem('airiz.i18n.v1', value);
    localStorage.setItem('airiz.installGate.dismissed', '1');
  }, SETTINGS);
  await page.goto(url);
  await page.waitForFunction(() => window.AirizConsole && window.AirizRemoteControl);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialog.open) dialog.close();
    }
  });
  return page;
}

// Any picture in the viewer's floating camera window (WebRTC video or relay snapshot).
const viewerHasPicture = () => {
  const video = document.getElementById('qc-camera-video');
  const image = document.getElementById('qc-camera-image');
  const relay = window.AirizCameraRelay;
  const videoOk = !!(video && video.srcObject && video.videoWidth > 0
    && video.srcObject.getVideoTracks().some(track => track.readyState === 'live' && !track.muted));
  const imageOk = !!(image && !image.hidden && image.getAttribute('src') && image.naturalWidth > 0);
  if (relay && 'live' in relay) return relay.live && (videoOk || imageOk);
  return videoOk || imageOk;
};

async function waitForPicture(page, timeoutMs) {
  const started = Date.now();
  const ok = await page.waitForFunction(viewerHasPicture, null, { timeout: timeoutMs, polling: 500 })
    .then(() => true, () => false);
  return { ok, seconds: Math.round((Date.now() - started) / 1000) };
}

(async () => {
  if (!browserPath) throw new Error('Edge or Chrome is needed');
  const server = await serve(webRoot);
  const viewerServer = viewerRoot === webRoot ? server : await serve(viewerRoot);
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const viewerUrl = 'http://127.0.0.1:' + viewerServer.address().port + '/index.html';
  stamp('host ' + webRoot + (viewerRoot === webRoot ? '' : ' / viewer ' + viewerRoot));
  const browser = await chromium.launch({
    executablePath: browserPath,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const hostContext = await browser.newContext({ permissions: ['camera', 'notifications'] });
    const viewerContext = await browser.newContext();
    const host = await openConsole(hostContext, url);
    const viewer = await openConsole(viewerContext, viewerUrl);

    check('Camera tab has no Phone viewer card', await host.evaluate(() => !document.getElementById('camera-relay')
      && !document.getElementById('relay-view-code') && !document.getElementById('btn-relay-view')));

    // Host: demo device, camera preview NOT available when sharing starts.
    await host.click('#btn-demo');
    await host.waitForFunction(() => window.AirizConsole.getStatus().connected, null, { timeout: 15000 });
    await host.evaluate(() => {
      document.getElementById('btn-camera-start').disabled = true;
    });
    await host.evaluate(() => window.AirizQuickConnect.open());
    await host.click('#qc-share');
    await host.waitForFunction(() => /^\d{6}$/.test(window.AirizRemoteControl.hostCode || ''), null, { timeout: 20000 });
    const code = await host.evaluate(() => window.AirizRemoteControl.hostCode);
    stamp('host shares with code ' + code + ' (preview not running)');

    // Viewer: connect by code; host allows.
    await viewer.fill('#remote-code-inline', code);
    await viewer.click('#remote-code-go').catch(() => {});
    const allow = host.locator('.share-allow-once:visible, .share-allow:visible').first();
    await allow.waitFor({ state: 'visible', timeout: 40000 });
    await allow.click();
    await viewer.waitForFunction(() => /^Remote control \(code \d{6}\)/.test(window.AirizConsole.getStatus().transportLabel || ''),
      null, { timeout: 30000 });
    check('viewer controls the AIRIZ by code', true);
    await viewer.waitForTimeout(12000);
    const waiting = await viewer.evaluate(() => ({
      label: document.getElementById('qc-camera-live')?.textContent,
      note: document.getElementById('qc-camera-note')?.textContent,
    }));
    stamp('viewer while host preview is off: ' + JSON.stringify(waiting));

    // Host starts the preview later: the viewer must get the picture by itself.
    await host.evaluate(() => {
      const start = document.getElementById('btn-camera-start');
      start.disabled = false;
      start.click();
    });
    await host.waitForFunction(() => !!window.AirizConsole.getCameraStream(), null, { timeout: 15000 });
    let picture = await waitForPicture(viewer, 60000);
    check('viewer sees the camera after the host starts the preview late', picture.ok, picture.seconds + ' s');

    if (picture.ok) {
      // Host restarts the preview (e.g. another mode): the picture must come back.
      await host.evaluate(() => document.getElementById('btn-camera-stop').click());
      await host.waitForFunction(() => !window.AirizConsole.getCameraStream(), null, { timeout: 10000 });
      await host.waitForTimeout(3000);
      await host.evaluate(() => document.getElementById('btn-camera-start').click());
      await host.waitForFunction(() => !!window.AirizConsole.getCameraStream(), null, { timeout: 15000 });
      await viewer.waitForTimeout(1500);
      picture = await waitForPicture(viewer, 45000);
      check('viewer sees the camera again after the host restarts the preview', picture.ok, picture.seconds + ' s');
    }

    await host.evaluate(() => window.AirizRemoteControl.openShareDialog());
    await host.waitForTimeout(2500);
    const line = await host.evaluate(() => document.getElementById('share-control-camera-text')?.textContent || '');
    check('Share control shows the camera state and the viewer', /Camera: shared with code \d{6} · 1 watching/.test(line), line);
  } finally {
    await browser.close();
    server.close();
    if (viewerServer !== server) viewerServer.close();
  }
  const failed = results.filter(item => !item.ok).length;
  stamp(failed ? failed + ' check(s) failed' : 'all ' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(2);
});
