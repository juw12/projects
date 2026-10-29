'use strict';

// 1.11.8: Smart detection alerts, own siren sound, background detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');
const read = name => fs.readFileSync(path.join(WEB, name), 'utf8');

test('detection keeps running while the window is hidden or minimized', () => {
  const ptz = read('ptz.js');
  assert.ok(!/if \(!liveStream \|\| !video\.videoWidth \|\| document\.hidden\) return;/.test(ptz), 'no skip when hidden');
  assert.ok(ptz.includes("new Worker('ptz-clock.js')"), 'worker clock');
  assert.ok(read('ptz-clock.js').includes('postMessage'));
  assert.ok(read('sw.js').includes("'./ptz-clock.js'"));
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.ok(main.includes("ipcMain.handle('airiz:background-work'") && preload.includes("'airiz:background-work'"));
  assert.ok(ptz.includes('window.airizDesktop.setBackgroundWork(detection.armed)'));
});

test('alerts report back and can be tested', () => {
  const ptz = read('ptz.js');
  const html = read('index.html');
  assert.ok(html.includes('id="ptz-test-alerts"') && html.includes('id="ptz-alert-status"'));
  assert.ok(ptz.includes('function showDesktopAlert') && ptz.includes('event.alerts.push'));
  assert.ok(ptz.includes("entry.note = 'Join Ziris PTB on the Team page first.'"), 'non-members are told');
});

test('own siren sound and plainer height / calibration controls', () => {
  const ptz = read('ptz.js');
  const html = read('index.html');
  assert.ok(html.includes('id="ptz-siren-file"') && html.includes('id="ptz-siren-sound"'));
  assert.ok(ptz.includes("'diag audio play ' + TALK_FILE") && ptz.includes('window.AirizVoice.send(message)'));
  assert.ok(html.includes('Lower to bottom &amp; reset height') && html.includes('Is the camera at the bottom?'));
  assert.ok(html.includes('Calibration (once per camera)') && html.includes('id="ptz-cal-reset"'));
});
