'use strict';

// 1.11.5: the camera Mode list only offers what the selected camera can deliver.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');

test('no 4K mode in the camera Mode list; modes above the camera maximum are hidden', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const select = html.slice(html.indexOf('id="camera-mode-select"'), html.indexOf('</select>', html.indexOf('id="camera-mode-select"')));
  assert.ok(!select.includes('3840x2160'), '3840x2160 is not offered');
  assert.ok(select.includes('value="auto"') && select.includes('value="1920x1080x30"'));
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.ok(app.includes("const CAMERA_CAPS_KEY = 'airiz.camera.caps.v1';"));
  assert.ok(app.includes('saveCameraCaps(deviceId || track.getSettings().deviceId'), 'the maximum is learned from the running preview');
  assert.ok(app.includes("elements.cameraDeviceSelect.addEventListener('change', filterCameraModes)"), 'switching camera re-filters');
  assert.ok(app.includes("select.value = 'auto'"), 'a hidden selection falls back to Auto');
});
