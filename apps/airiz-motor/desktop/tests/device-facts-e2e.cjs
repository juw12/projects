'use strict';
/*
 * 1.11.17 end-to-end check (demo device, fake webcam): the dashboard shows real device facts
 * instead of decoration.
 *   - Firmware strip: "not connected", then the version the (demo) AIRIZ reports via diag ver sw
 *   - Header / sidebar / clock: link state, last reply, bytes per second, connected-for timer
 *   - Bluetooth test reads the result (#INFO#0 + controller address)
 *   - Move check line under the jog stage
 *   - Hardware check dialog runs and builds a report
 *   - Siren: the generated wail tone is the default; automatic calibration buttons answer
 *
 * Usage: node tests/device-facts-e2e.cjs [webRoot]
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const webRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'web'));
const browserPath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(candidate => fs.existsSync(candidate));
const SETTINGS = JSON.stringify({ language: 'en', region: 'ID' });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
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

const text = (page, selector) => page.locator(selector).innerText();

(async () => {
  const server = await serve(webRoot);
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({
    executablePath: browserPath,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => {
      localStorage.setItem('airiz.i18n.v1', value);
      localStorage.setItem('airiz.installGate.dismissed', '1');
      // a console that used the old "built-in loud tone" setting
      localStorage.setItem('airiz.ptz.v1', JSON.stringify({ sirenSound: 'builtin' }));
    }, SETTINGS);
    await page.goto(url);
    await page.waitForFunction(() => window.AirizConsole && window.AirizPtzCore);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      for (const dialog of document.querySelectorAll('dialog')) {
        if (dialog.open) dialog.close();
      }
    });

    check('firmware strip before connecting', (await text(page, '#fw-version')) === 'not connected'
      && (await text(page, '#data-source')) === '0.0.0.9', await text(page, '#reference-strip'));
    check('header shows the link state', (await text(page, '#header-link-text')) === 'NOT CONNECTED');
    check('clock is idle before connecting', (await text(page, '#session-clock')) === '--:--:--');
    check('PC playback volume label', (await text(page, 'label[for="voice-volume"]')) === 'PC playback volume');
    check('old built-in siren setting becomes the wail tone', (await page.locator('#ptz-siren-sound').inputValue()) === 'tone'
      && !(await page.locator('#ptz-siren-preview').isDisabled()));

    await page.locator('#btn-demo').click();
    await page.waitForFunction(() => document.getElementById('fw-version').textContent.includes('0.0.0.3'), null, { timeout: 8000 });
    check('firmware reported by the AIRIZ', (await text(page, '#fw-version')) === '0.0.0.3 (demo)',
      await page.locator('#fw-version').getAttribute('data-state'));
    await page.waitForTimeout(2200);
    check('header in demo', (await text(page, '#header-link-text')) === 'DEMO · SIMULATED');
    check('connected-for timer runs', /^00:00:0[1-9]$/.test(await text(page, '#session-clock')), await text(page, '#session-clock'));

    await page.locator('#btn-bluetooth-on').click();
    await page.waitForFunction(() => /OK|failed|no result/.test(document.getElementById('ble-test-result').textContent), null, { timeout: 8000 });
    check('Bluetooth test reads the result', (await text(page, '#ble-test-result')) === 'OK · 00:1A:7D:DA:71:13', await text(page, '#ble-test-result'));
    await page.waitForTimeout(1100);
    check('sidebar counts real bytes', /RX [1-9]/.test(await text(page, '#link-rate')) || /RX [1-9]/.test(await text(page, '#link-rate')),
      await text(page, '#link-rate'));
    const barHeights = await page.locator('#link-wave i').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.height)));
    check('activity bars follow the traffic', barHeights.some(height => height > 6), barHeights.join(','));

    await page.locator('[data-jog="pan-fwd"]').click();
    await page.waitForTimeout(400);
    check('move check line under the stage', /demo/.test(await text(page, '#jog-verify')), await text(page, '#jog-verify'));

    await page.locator('#btn-hardware-check').click();
    await page.locator('#hwcheck-dialog').waitFor({ state: 'visible' });
    await page.locator('#hwcheck-run').click();
    await page.waitForFunction(() => /Done|Stopped/.test(document.getElementById('hwcheck-status').textContent), null, { timeout: 120000 });
    const report = await text(page, '#hwcheck-report');
    check('hardware check report', /Firmware: 0\.0\.0\.3/.test(report) && /DEMO MODE/.test(report) && /\$ diag acc attr/.test(report)
      && /Motor driver files/.test(report), report.split('\n').slice(0, 12).join(' | '));
    check('report can be saved', !(await page.locator('#hwcheck-save').isDisabled()));
    await page.locator('#hwcheck-close').click();

    // camera on: the automatic aim calibration measures (the fake webcam animates, so it may refuse)
    await page.evaluate(() => window.AirizConsole.startCamera());
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById('ptz-cal-auto').click());
    await page.waitForFunction(() => /Done|Could not|too little|Not enough|cancelled/.test(document.getElementById('ptz-cal-status').textContent), null, { timeout: 20000 });
    check('automatic aim calibration answers', true, await text(page, '#ptz-cal-status'));
    await page.locator('#tab-controller').click();
    await page.locator('[data-jog="rising-fwd"]').click();
    await page.waitForTimeout(400);
    check('move check with the camera on (demo)', /demo/.test(await text(page, '#jog-verify')));

    await page.screenshot({ path: path.join(process.cwd(), 'device-facts-e2e.png') });
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(result => !result.ok);
  console.log(failed.length ? failed.length + ' check(s) failed' : 'All ' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
