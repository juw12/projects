'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGrantStore, RECONNECT_WINDOW_MS } = require('../device-grants.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-grants-'));
}

const airiz = { portId: 'p1', portName: 'COM4', vendorId: '7529', productId: '257', serialNumber: 'A1', deviceInstanceId: 'USB\\VID_1D69&PID_0101\\A1' };

test('only explicitly chosen serial devices are remembered, across restarts', () => {
  const directory = temporaryDirectory();
  const store = createGrantStore(directory);
  assert.equal(store.allows(airiz), false);
  store.remember(airiz);
  assert.equal(store.allows(airiz), true);
  const restarted = createGrantStore(directory);
  assert.equal(restarted.allows(airiz), true);
  assert.equal(restarted.allows({ ...airiz, deviceInstanceId: 'USB\\OTHER' }), false);
  assert.equal(restarted.allows({ vendorId: '1', productId: '2' }), false);
});

test('identity-less ports are never remembered', () => {
  const store = createGrantStore(temporaryDirectory());
  store.remember({ portId: 'x', portName: 'COM9' });
  assert.equal(store.allows({ portId: 'x', portName: 'COM9' }), false);
});

test('pending reconnect is single-use and expires', () => {
  const directory = temporaryDirectory();
  const store = createGrantStore(directory);
  assert.equal(store.savePendingReconnect({ baudRate: 115200, usbVendorId: 7529, usbProductId: 257 }, 1000), true);
  assert.deepEqual(store.takePendingReconnect(2000), { baudRate: 115200, usbVendorId: 7529, usbProductId: 257 });
  assert.equal(store.takePendingReconnect(2000), null);
  store.savePendingReconnect({ baudRate: 115200 }, 1000);
  assert.equal(store.takePendingReconnect(1000 + RECONNECT_WINDOW_MS + 1), null);
});

test('invalid reconnect requests are refused', () => {
  const store = createGrantStore(temporaryDirectory());
  assert.equal(store.savePendingReconnect({ baudRate: 'fast' }), false);
  assert.equal(store.savePendingReconnect({ baudRate: 12 }), false);
  assert.equal(store.takePendingReconnect(), null);
});
