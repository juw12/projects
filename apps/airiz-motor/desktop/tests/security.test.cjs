'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { isAppUrl, resolveAsset, canOpenExternal, publicPort } = require('../security.cjs');
const { createSerialChooser } = require('../serial-chooser.cjs');

test('only the packaged local origin is trusted', () => {
  assert.equal(isAppUrl('airiz://app/'), true);
  for (const url of ['https://example.com', 'file:///secret', 'airiz://other/', 'airiz://user@app/', 'javascript:alert(1)']) {
    assert.equal(isAppUrl(url), false, url);
  }
});

test('asset paths stay inside the bundled web root', () => {
  const root = path.resolve('fixture-web');
  assert.equal(resolveAsset(root, 'airiz://app/'), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, 'airiz://app/data/commands.js'), path.join(root, 'data', 'commands.js'));
  for (const url of [
    'airiz://app/..%2f..%2fsecret.js', 'airiz://app/%00.js',
    'airiz://app/%5c..%5cmain.cjs', 'airiz://app/main.cjs', 'https://example.com/index.html'
  ]) assert.equal(resolveAsset(root, url), null, url);
});

test('external navigation is restricted to the app website and repository', () => {
  assert.equal(canOpenExternal('https://github.com/juwpegatron/projects/releases'), true);
  assert.equal(canOpenExternal('https://juwpegatron.github.io/projects/airiz-motor/'), true);
  for (const url of ['file:///C:/Windows', 'http://github.com/juwpegatron/projects/', 'https://github.com/another/repo', 'https://example.com/']) {
    assert.equal(canOpenExternal(url), false, url);
  }
});

test('serial port display data excludes device serial numbers', () => {
  const port = publicPort({ portId: 'id1', portName: 'COM7', displayName: 'AIRIZ', serialNumber: 'private' });
  assert.equal(port.name, 'AIRIZ');
  assert.equal(port.port, 'COM7');
  assert.equal(port.serialNumber, undefined);
});

function fixture() {
  const session = new EventEmitter();
  const messages = [];
  const selected = [];
  const owner = { getURL: () => 'airiz://app/', isDestroyed: () => false, send: (name, data) => messages.push({ name, data }) };
  const chooser = createSerialChooser(session, () => ({ webContents: owner }));
  const event = { preventDefault() {} };
  return { session, owner, chooser, messages, selected, event };
}

test('serial request requires an explicit selection and rejects invented IDs or owners', () => {
  const fixtureData = fixture();
  const { session, owner, chooser, messages, selected, event } = fixtureData;
  session.emit('select-serial-port', event, [{ portId: 'p1', portName: 'COM3' }], owner, id => selected.push(id));
  assert.equal(selected.length, 0);
  assert.equal(messages[0].data.ports[0].id, 'p1');
  assert.equal(chooser.choose({}, 'p1'), false);
  assert.equal(chooser.choose(owner, 'invented'), false);
  assert.equal(chooser.choose(owner, 'p1'), true);
  assert.deepEqual(selected, ['p1']);
  assert.equal(chooser.hasPending(), false);
});

test('serial hotplug, removal and cancellation update only the pending chooser', () => {
  const { session, owner, chooser, messages, selected, event } = fixture();
  session.emit('select-serial-port', event, [], owner, id => selected.push(id));
  session.emit('serial-port-added', event, { portId: 'p2', portName: 'COM8' }, owner);
  assert.equal(messages.at(-1).data.ports.length, 1);
  session.emit('serial-port-removed', event, { portId: 'p2' }, owner);
  assert.equal(messages.at(-1).data.ports.length, 0);
  assert.equal(chooser.choose(owner, 'p2'), false);
  chooser.cancel();
  assert.deepEqual(selected, ['']);
  session.emit('serial-port-added', event, { portId: 'p3', portName: 'COM9' }, owner);
  assert.equal(messages.at(-1).data.ports.length, 0);
});

test('untrusted serial request is denied instead of auto-selecting a device', () => {
  const { session, chooser, selected, event } = fixture();
  const untrusted = { getURL: () => 'https://example.com' };
  session.emit('select-serial-port', event, [{ portId: 'p1' }], untrusted, id => selected.push(id));
  assert.deepEqual(selected, ['']);
  assert.equal(chooser.hasPending(), false);
});
