'use strict';

// 1.11.6: the AIRIZ camera on its own, in a separate window (Camera > Open in new window).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');
const read = name => fs.readFileSync(path.join(WEB, name), 'utf8');

test('the console opens camera-view.html and lends it its camera stream', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="btn-camera-popout"'), 'Camera tab button');
  assert.ok(html.includes('id="ptz-popout"'), 'PTZ toolbar button');
  const app = read('app.js');
  assert.ok(app.includes("window.open('camera-view.html', 'airiz-camera-view'"));
  assert.ok(app.includes('startCamera()') && app.includes('openCameraWindow()'), 'AirizConsole adapter');
  assert.ok(app.includes("localStorage.setItem('airiz.camera.lastDevice'"), 'last camera remembered');
});

test('camera-view.html has no inline script (desktop CSP) and follows the console', () => {
  const page = read('camera-view.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(page), 'no inline scripts');
  assert.ok(page.includes('src="camera-view.js"') && page.includes('src="i18n-strings.js"'));
  const script = read('camera-view.js');
  assert.ok(script.includes('opener.AirizConsole'));
  assert.ok(script.includes('getUserMedia'), 'standalone fallback');
});

test('the service worker caches the camera window', () => {
  const sw = read('sw.js');
  for (const name of ['camera-view.html', 'camera-view.js', 'camera-view.css']) {
    assert.ok(sw.includes("'./" + name + "'"), name);
  }
});

test('the desktop app only allows its own camera page as a new window', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.ok(main.includes("parsed.pathname === '/camera-view.html'"));
  assert.ok(main.includes("parsed.protocol === 'airiz:' && parsed.host === 'app'"));
  assert.ok(main.includes("action: 'allow'"));
  const allowBlock = main.slice(main.indexOf("action: 'allow'"), main.indexOf("if (canOpenExternal(url))", main.indexOf("action: 'allow'")));
  assert.ok(allowBlock.includes('nodeIntegration: false, contextIsolation: true, sandbox: true'), 'sandboxed camera window');
  assert.ok(main.includes("on('did-create-window'"), 'child window locked down');
  assert.ok(main.includes('cameraWindows'), 'closes with the console');
});
