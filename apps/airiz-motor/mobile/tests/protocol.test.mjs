import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUuid, discoverProfiles, customProfile, firmwareVersion, chunks, VerifiedSerialPort, FIRMWARE_QUERY } from '../src/protocol.mjs';

const nus = {
  uuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  characteristics: [
    { uuid: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E', properties: { write: true } },
    { uuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E', properties: { notify: true } }
  ]
};
function fakeLink(response) {
  const link = {
    label: 'Test BLE', writes: [], closed: 0,
    async subscribe(onData, onDisconnect) { link.receive = onData; link.lost = onDisconnect; },
    async write(bytes) {
      link.writes.push(new TextDecoder().decode(bytes));
      if (response && link.writes.length === 1) for (const text of response) link.receive(new TextEncoder().encode(text));
    },
    async close() { link.closed++; }
  };
  return link;
}

test('UUID normalization and recognized UART discovery require real write/notify properties', () => {
  assert.equal(normalizeUuid('FFE1'), '0000ffe1-0000-1000-8000-00805f9b34fb');
  assert.equal(discoverProfiles([nus])[0].name, 'Nordic UART');
  const invalid = structuredClone(nus);
  invalid.characteristics[1].properties.notify = false;
  assert.equal(discoverProfiles([invalid]).length, 0);
  assert.throws(() => normalizeUuid('not a UUID'));
});

test('generic status codes and unframed version text do not unlock controls', () => {
  assert.equal(firmwareVersion('#INFO#0#END#'), null);
  assert.equal(firmwareVersion('version 0.0.0.9'), null);
  assert.equal(firmwareVersion('#INFO#0#END# version 1.2.3 #INFO#Done#END#'), null);
  assert.equal(firmwareVersion('#INFO#0.0.0.9#END#'), '0.0.0.9');
  assert.equal(firmwareVersion('#INFO#Software version: 1.2.3#END#'), '1.2.3');
});

test('standard/DFU services cannot be selected as custom motor channels', () => {
  assert.throws(() => customProfile([], '180f', '2a19', '2a19'));
  assert.throws(() => customProfile([], '00001530-1212-efde-1523-785feabcd123', nus.characteristics[0].uuid, nus.characteristics[1].uuid));
  const profile = customProfile([nus], nus.uuid, nus.characteristics[0].uuid, nus.characteristics[1].uuid);
  assert.equal(profile.withoutResponse, false);
});

test('BLE packet chunking preserves all bytes in order', () => {
  const bytes = new TextEncoder().encode('diag motor rising forward 30 99999\r\n');
  const packets = chunks(bytes, 20);
  assert(packets.every(packet => packet.length <= 20));
  assert.deepEqual(Uint8Array.from(packets.flatMap(packet => [...packet])), bytes);
});

test('only firmware query is written before a valid framed reply; then the stream carries commands', async () => {
  const link = fakeLink(['echo\r\n#IN', 'FO#0.0.', '0.9#END#\r\n~ #']);
  const port = new VerifiedSerialPort(link, null, 100);
  assert.equal(port.writable, null);
  await port.open();
  assert.deepEqual(link.writes, [FIRMWARE_QUERY]);
  assert.equal(port.firmwareVersion, '0.0.0.9');
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode('diag motor pan forward 2 1\r\n'));
  writer.releaseLock();
  assert.equal(link.writes[1], 'diag motor pan forward 2 1\r\n');
  await port.close();
  assert.equal(port.writable, null);
});

test('unverified Bluetooth connection times out without any motor command', async () => {
  const link = fakeLink(['#INFO#0#END#']);
  const port = new VerifiedSerialPort(link, null, 20);
  await assert.rejects(port.open(), /not confirmed/);
  assert.deepEqual(link.writes, [FIRMWARE_QUERY]);
  assert.equal(port.writable, null);
  assert.equal(link.closed, 1);
});

test('transport write failure closes the link without an unhandled verification rejection', async () => {
  const link = fakeLink();
  link.write = async () => { throw new Error('Write denied'); };
  const port = new VerifiedSerialPort(link, null, 20);
  await assert.rejects(port.open(), /Write denied/);
  assert.equal(port.closed, true);
});

test('connection loss makes the stream unavailable and emits one disconnect', async () => {
  const link = fakeLink(['#INFO#1.2.3#END#']);
  let lost = 0;
  const port = new VerifiedSerialPort(link, () => lost++, 100);
  await port.open();
  link.lost(new Error('Device gone'));
  assert.equal(port.readable, null);
  assert.equal(port.writable, null);
  assert.equal(lost, 1);
  await port.close();
  assert.equal(lost, 1);
});

test('real AIRIZ firmware reply with a status prefix is accepted', () => {
  assert.equal(firmwareVersion('diag ver sw\r\n#INFO#0:0.0.0.3#END#\r\n~ # '), '0.0.0.3');
  assert.equal(firmwareVersion('#INFO#0#END#'), null);
});
