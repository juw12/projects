'use strict';

// 1.11.7: the PTZ hold arrows act at once (like the Motor control jog pad).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hold arrows do not wait for the time model and always stop on release', () => {
  const ptz = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'ptz.js'), 'utf8');
  const start = ptz.indexOf('async function startHold');
  const end = ptz.indexOf("document.querySelectorAll('[data-hold]')", start);
  const block = ptz.slice(start, end);
  assert.ok(start > 0 && end > start, 'hold code found');
  assert.ok(!block.includes('waitIdle('), 'a press no longer waits for the previous move');
  assert.ok(block.includes('if (Date.now() < tracker.busyUntil()) await api.stopMotor();'), 'a running move is stopped first');
  assert.ok(block.includes('if (current.sent) api.stopMotor();'), 'every release of a sent move stops the motor');
  assert.ok(block.includes('if (current.released) api.stopMotor();'), 'released while writing: stopped after the write');
});
