// Checks a running relay end to end (Node 22+): camera room, remote control room, USB mode reports.
//
//   npx wrangler dev --port 8799            then   node scripts/check-live.mjs http://127.0.0.1:8799
//   node scripts/check-live.mjs https://airiz-relay.juw12.workers.dev      (after a deploy)
//
// The report it sends has edition "test": it is stored, but left out of the per-mode numbers.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/check-live.mjs <relay url>');
  process.exit(2);
}
const wsBase = base.replace(/^http/, 'ws');
const code = String(100000 + Math.floor(Math.random() * 900000));

function open(path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsBase + path);
    socket.inbox = [];
    socket.waiters = [];
    socket.onmessage = event => {
      const waiter = socket.waiters.shift();
      if (waiter) waiter(event.data);
      else socket.inbox.push(event.data);
    };
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error('could not open ' + path));
  });
}

function next(socket, what) {
  if (socket.inbox.length) return Promise.resolve(socket.inbox.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message: ' + what)), 10000);
    socket.waiters.push(data => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function nextOfType(socket, type) {
  for (;;) {
    const data = JSON.parse(await next(socket, type));
    if (data.type === type) return data;
  }
}

async function getJson(path) {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json() };
}

async function sendReport(report) {
  const socket = await open('/v1/report');
  socket.send(typeof report === 'string' ? report : JSON.stringify(report));
  return JSON.parse(await next(socket, 'report answer'));
}

const status = await getJson('/v1/status');
assert.equal(status.body.version, '1.4.0');
assert.equal(status.body.reports, true);
console.log('status      ', JSON.stringify(status.body));

// Camera room: the viewer hears that the PC is there and gets what the PC sends.
const cameraPc = await open(`/v1/room/${code}?role=pc`);
const viewer = await open(`/v1/room/${code}?role=viewer`);
assert.equal((await nextOfType(viewer, 'status')).pc, true);
cameraPc.send(JSON.stringify({ type: 'hello-from-pc' }));
await nextOfType(viewer, 'hello-from-pc');
const frame = randomBytes(2048);
cameraPc.send(frame);
viewer.binaryType = 'arraybuffer';
let received;
do {
  received = await next(viewer, 'camera frame');
} while (typeof received === 'string');
const receivedBytes = Buffer.from(received instanceof Blob ? await received.arrayBuffer() : received);
assert.ok(receivedBytes.equals(frame), 'the frame arrives unchanged');
cameraPc.close();
viewer.close();
console.log('camera room  ok (status, text, 2 kB frame)');

// Remote control room: a controller's message reaches the PC with its id; the PC answers that id.
const controlPc = await open(`/v1/control/${code}?role=pc`);
const controller = await open(`/v1/control/${code}?role=ctl`);
assert.equal((await nextOfType(controller, 'status')).pc, true);
controller.send(JSON.stringify({ type: 'ask', line: 'diag motor pan 20' }));
const asked = await nextOfType(controlPc, 'ask');
assert.match(asked.from, /^[0-9a-f-]{8}$/);
controlPc.send(JSON.stringify({ type: 'answer', to: asked.from, text: 'ok' }));
assert.equal((await nextOfType(controller, 'answer')).text, 'ok');
controlPc.close();
controller.close();
console.log('control room ok (controller -> PC -> controller)');

// USB mode reports.
const before = await getJson('/v1/reports/usbmode');
assert.equal(before.status, 200);
const rid = randomBytes(6).toString('hex');
const report = {
  v: 1, rid, mode: 'eth', to: true, link: 'dropped', dropS: 2, back: false,
  reply: 'text', app: '1.11.28', edition: 'test', transport: 'usb', agoS: 0,
};
assert.deepEqual(await sendReport(report), { ok: true });
assert.deepEqual(await sendReport(report), { ok: true }, 'the same report again is accepted');
assert.deepEqual(await sendReport({ ...report, rid: randomBytes(6).toString('hex'), mode: 'hid' }), { ok: false });
assert.deepEqual(await sendReport('diag usbmode set to eth'), { ok: false });
const after = await getJson('/v1/reports/usbmode');
assert.equal(after.body.testReports, before.body.testReports + 1, 'stored once');
assert.equal(after.body.reports, before.body.reports, 'test reports do not count');
assert.deepEqual(after.body.byMode, before.body.byMode);
const latest = after.body.latest[0];
assert.equal(latest.command, 'diag usbmode set to eth');
assert.equal(latest.edition, 'test');
assert.deepEqual(Object.keys(latest).sort(), [
  'app', 'at', 'back', 'command', 'dropS', 'edition', 'link', 'mode', 'reply', 'transport',
]);
console.log('reports      ok', JSON.stringify({ reports: after.body.reports, testReports: after.body.testReports, byMode: after.body.byMode }));

// A page on another site may not send reports.
const refusedStatus = await new Promise((resolve, reject) => {
  const request = (base.startsWith('https') ? https : http).request(base + '/v1/report', {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'https://example.com',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' },
  });
  request.on('response', response => resolve(response.statusCode));
  request.on('upgrade', () => resolve(101));
  request.on('error', reject);
  request.end();
});
assert.equal(refusedStatus, 403, 'another origin is refused');
assert.equal((await fetch(base + '/v1/report')).status, 426);
assert.equal((await fetch(base + '/v1/reports/usbmode', { method: 'POST' })).status, 405);
console.log('guards       ok (other origin 403, no websocket 426, POST 405)');
process.exit(0);
