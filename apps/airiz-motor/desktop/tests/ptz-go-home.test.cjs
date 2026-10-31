'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ptzPath = path.join(__dirname, '..', '..', 'web', 'ptz.js');
const ptz = fs.readFileSync(ptzPath, 'utf8');

test('Go home click handler goes through askHost / goHome and is exception-safe', () => {
  const start = ptz.indexOf("$('ptz-go-home').addEventListener('click'");
  const end = ptz.indexOf("function setLimitHere(", start);
  assert.ok(start > 0 && end > start, 'go home click handler found');
  const block = ptz.slice(start, end);
  assert.ok(block.includes("askHost('go-home')"), 'click checks askHost so remote controllers route to the host');
  assert.ok(block.includes('stopScan()'), 'click stops any auto scan before going home');
  assert.ok(block.includes('await goHome()'), 'click runs the full goHome path (pan + rising + bottom switch)');
  assert.ok(block.includes('try {'), 'click is wrapped in try so a thrown goHome shows in the status bar, not as a silent no-op');
  assert.ok(block.includes("status('Go home failed:"), 'caught error becomes a visible status message');
  assert.ok(block.includes('OLD_HOST_NOTE'), 'older-host note still fires for controllers without shared camera state');
});

test('Home key on the Camera tab triggers goHome; it stays quiet outside the tab, fields, dialogs and the side nav', () => {
  const start = ptz.indexOf("document.addEventListener('keydown', event => {");
  const end = ptz.indexOf("overlay.addEventListener('pointermove', event => {", start);
  assert.ok(start > 0 && end > start, 'ptz keydown listener found');
  const block = ptz.slice(start, end);
  assert.ok(block.includes("event.key === 'Home'"), 'Home key is handled');
  assert.ok(block.includes('!event.ctrlKey'), 'Home key respects modifier gates (no Ctrl/Meta/Alt + no key repeat)');
  assert.ok(block.includes('!event.metaKey'), 'Meta+Home is left to the browser');
  assert.ok(block.includes('!event.altKey'), 'Alt+Home is left to the browser');
  assert.ok(block.includes('!event.repeat'), 'held Home does not fire repeatedly');
  assert.ok(block.includes("!$('view-camera').hidden"), 'Home only fires while the Camera tab is active');
  assert.ok(block.includes("!document.querySelector('dialog[open]')"), 'Home does not fire while a dialog is open');
  assert.ok(block.includes("input, textarea, select, [contenteditable=\"true\"], .side-nav"), 'Home does not fire when focus is on an editable field or the side nav');
  assert.ok(block.includes("askHost('go-home')"), 'Home routes through askHost so a remote controller asks the host');
  assert.ok(block.includes('stopScan()'), 'Home stops any auto scan before going home');
  assert.ok(block.includes('goHome()'), 'Home calls goHome so the bottom-switch confirm still runs');
  assert.ok(block.includes('.catch('), 'Home key catch surfaces failures in the status bar');
});
