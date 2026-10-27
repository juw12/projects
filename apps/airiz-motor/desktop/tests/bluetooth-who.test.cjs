// "Who is connected" over the AIRIZ Bluetooth bridge (ble-protocol.js + bridge v3),
// checked against a simulated bridge so it runs without hardware.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ble = require(path.join(__dirname, '..', '..', 'web', 'ble-protocol.js'));
const { deviceLabel } = require(path.join(__dirname, '..', '..', 'web', 'device-label.js'));

const CONTROLLER = 'AA:BB:CC:00:11:22';
const PHONE = '5C:11:22:33:44:55';
const ME = '70:AA:BB:CC:DD:EE';

// Simulated AIRIZ-BT bridge: answers the text protocol line by line.
function fakeBridge(version) {
  const sent = [];
  let notify = null;
  const reply = text => setTimeout(() => notify(new TextEncoder().encode(text)), 5);
  return {
    sent,
    link: {
      label: 'Bluetooth (test)',
      async subscribe(onBytes) {
        notify = onBytes;
      },
      async write(bytes) {
        const line = new TextDecoder().decode(bytes).trim();
        sent.push(line);
        if (line === 'diag ver sw') {
          reply('#INFO#0.0.0.3#END#\n' + (version >= 3 ? '#BRIDGE#3#END#\n' : '') + '#AUTH#required#END#\n');
        } else if (line === 'auth 123456') {
          reply('#AUTH#ok#END#\n');
        } else if (line.startsWith('hello ')) {
          reply(version >= 3 ? `#HELLO#${ME}#END#\n` : '#ERR#not allowed over Bluetooth: ' + line + '#END#\n');
        } else if (line === 'who') {
          reply(`#WHO#${CONTROLLER}#${PHONE}|iPhone (Bluefy)|185|1;${ME}|Device|0|1#END#\n`);
        }
      },
      async close() {},
    },
  };
}

test('parseWho reads the bridge list and ignores junk', () => {
  const info = ble.parseWho(`noise #WHO#${CONTROLLER.toLowerCase()}#${PHONE}|iPhone (Bluefy)|61|1;bad|x|1|1;${ME}|-|5|0#END#`);
  assert.strictEqual(info.controller, CONTROLLER);
  assert.deepStrictEqual(info.clients, [
    { address: PHONE, label: 'iPhone (Bluefy)', seconds: 61, pinOk: true },
    { address: ME, label: '', seconds: 5, pinOk: false },
  ]);
  assert.strictEqual(ble.parseWho('#AUTH#ok#END#'), null);
  assert.strictEqual(ble.describeClient(info.clients[0]), 'iPhone (Bluefy) (PIN ok), 1 min');
  assert.strictEqual(ble.describeClient(info.clients[1]), 'Unnamed device (no PIN yet), just now');
});

test('bridge v3: introduces itself and lists the other connected devices', async () => {
  const bridge = fakeBridge(3);
  const port = new ble.VerifiedSerialPort(bridge.link, null, 2000, { savedPin: '123456' });
  await port.open();
  assert.strictEqual(port.bridgeVersion, 3);
  assert.ok(port.authenticated);
  assert.deepStrictEqual(bridge.sent, ['diag ver sw', 'auth 123456', 'hello Device', 'who']);
  assert.strictEqual(port.myAddress, ME);
  assert.deepStrictEqual(port.otherClients.map(client => client.label), ['iPhone (Bluefy)']);
  await port.close();
});

test('bridge v2: no hello/who is sent (older bridges would answer with an error)', async () => {
  const bridge = fakeBridge(2);
  const port = new ble.VerifiedSerialPort(bridge.link, null, 2000, { savedPin: '123456' });
  await port.open();
  assert.strictEqual(port.bridgeVersion, 0);
  assert.deepStrictEqual(bridge.sent, ['diag ver sw', 'auth 123456']);
  assert.deepStrictEqual(port.otherClients, []);
  await port.close();
});

test('device labels are short and use only characters the bridge accepts', () => {
  const cases = [
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1 Bluefy/3.5' }, 'iPhone (Bluefy)'],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' }, 'iPhone (Safari)'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', maxTouchPoints: 5 }, 'iPad (Safari)'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' }, 'Android (Chrome)'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', mobileApp: true }, 'Android (AIRIZ app)'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', desktopApp: true }, 'Windows PC (AIRIZ app)'],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0' }, 'Windows PC (Edge)'],
  ];
  for (const [env, expected] of cases) {
    const label = deviceLabel(Object.assign({ maxTouchPoints: 0, desktopApp: false, mobileApp: false }, env));
    assert.strictEqual(label, expected);
    assert.match(label, /^[A-Za-z0-9 ._()-]{1,40}$/);
  }
});
