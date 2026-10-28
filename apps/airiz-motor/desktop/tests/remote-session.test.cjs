'use strict';

// 1.9.0: several phones, remembered devices, reconnect after sleep, keep awake while sharing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const session = require('../../web/remote-session.js');
const { createPowerKeeper } = require('../power-keeper.cjs');

const WEB = path.join(__dirname, '..', '..', 'web');

test('a phone keeps one random identity per browser', () => {
  const storage = session.memoryStorage();
  const first = session.loadIdentity(storage);
  assert.match(first.id, /^[0-9a-f]{16}$/);
  assert.match(first.key, /^[0-9a-f]{32}$/);
  assert.deepEqual(session.loadIdentity(storage), first, 'the same identity comes back');
  const other = session.loadIdentity(session.memoryStorage());
  assert.notEqual(other.id, first.id, 'another browser gets another identity');
  storage.setItem(session.IDENTITY_KEY, '{broken');
  const repaired = session.loadIdentity(storage);
  assert.match(repaired.id, /^[0-9a-f]{16}$/, 'a damaged identity is replaced');
  assert.equal(session.validIdentity(first.id, first.key), true);
  assert.equal(session.validIdentity('xyz', first.key), false);
  assert.equal(session.validIdentity(first.id, ''), false);
});

test('the PC remembers devices by a hash of their key and can forget them', async () => {
  const storage = session.memoryStorage();
  let now = 1000;
  const store = session.createTrustStore(storage, () => now);
  const phone = session.loadIdentity(session.memoryStorage());
  assert.equal(store.autoAllow, true, 'remembered devices are let in automatically by default');
  assert.deepEqual(await store.check(phone.id, phone.key), { status: 'unknown' });

  assert.equal(await store.remember(phone.id, phone.key, 'Android (Chrome)'), true);
  const saved = storage.getItem(session.TRUST_KEY);
  assert.ok(!saved.includes(phone.key), 'the device key itself is never stored');
  assert.ok(saved.includes(await session.hashKey(phone.key)));
  const remembered = await store.check(phone.id, phone.key);
  assert.equal(remembered.status, 'remembered');
  assert.equal(remembered.device.name, 'Android (Chrome)');

  // Same id with another key (copied id, reset phone): not trusted.
  const stranger = session.loadIdentity(session.memoryStorage());
  assert.equal((await store.check(phone.id, stranger.key)).status, 'mismatch');
  assert.equal((await store.check('zz', phone.key)).status, 'unknown');

  now = 5000;
  store.touch(phone.id, 'Android <script>');
  assert.equal(store.list()[0].lastSeen, 5000);
  assert.equal(store.list()[0].name, 'Android script', 'names are cleaned');

  store.setAutoAllow(false);
  assert.equal(store.autoAllow, false);
  assert.equal(store.forget(phone.id), true);
  assert.equal((await store.check(phone.id, phone.key)).status, 'unknown');
  assert.equal(store.forget(phone.id), false);
});

test('the remembered list keeps the most recent devices only', async () => {
  let now = 0;
  const store = session.createTrustStore(session.memoryStorage(), () => now);
  const ids = [];
  for (let index = 0; index < session.MAX_DEVICES + 5; index++) {
    now = index + 1;
    const device = session.loadIdentity(session.memoryStorage());
    ids.push(device.id);
    assert.equal(await store.remember(device.id, device.key, 'Phone ' + index), true);
  }
  const list = store.list();
  assert.equal(list.length, session.MAX_DEVICES);
  assert.equal(list[0].id, ids[ids.length - 1], 'newest first');
  assert.ok(!list.some(item => item.id === ids[0]), 'the oldest ones drop off');
  store.forgetAll();
  assert.equal(store.list().length, 0);
});

test('who gets in without pressing Allow', () => {
  assert.equal(session.decide({ trust: 'unknown', autoAllow: true, sessionApproved: false }), 'ask');
  assert.equal(session.decide({ trust: 'remembered', autoAllow: true, sessionApproved: false }), 'auto-remembered');
  assert.equal(session.decide({ trust: 'remembered', autoAllow: false, sessionApproved: false }), 'ask',
    'with the setting off a remembered device still waits for Allow');
  assert.equal(session.decide({ trust: 'unknown', autoAllow: false, sessionApproved: true }), 'auto-session',
    'a device allowed earlier while sharing this code comes back by itself (after sleep)');
  assert.equal(session.decide({ trust: 'mismatch', autoAllow: true, sessionApproved: true }), 'ask-warning');
});

test('phones retry the same code after an unexpected drop, never after a no', () => {
  for (const reason of ['lost', 'pc-gone', 'pc-silent']) assert.equal(session.canStartRetry(reason), true, reason);
  for (const reason of ['denied', 'revoked', 'stopped', 'cancelled', 'busy', 'no-pc', 'timeout', undefined]) {
    assert.equal(session.canStartRetry(reason), false, String(reason));
  }
  const start = 1000;
  for (const reason of ['no-pc', 'timeout', 'approval-timeout', 'network', 'verify', 'lost']) {
    assert.equal(session.canContinueRetry(reason, start, start + 60000), true, reason);
  }
  for (const reason of ['denied', 'revoked', 'stopped', 'cancelled', 'busy-here', 'input']) {
    assert.equal(session.canContinueRetry(reason, start, start + 1000), false, reason);
  }
  assert.equal(session.canContinueRetry('no-pc', start, start + session.RETRY_WINDOW_MS + 1), false, 'gives up after 30 min');
  assert.deepEqual([0, 1, 2, 3, 7, 8, 50].map(session.retryDelay), [3000, 3000, 3000, 8000, 8000, 20000, 20000]);
  let total = 0;
  let attempts = 0;
  while (total < session.RETRY_WINDOW_MS) total += session.retryDelay(attempts++);
  assert.ok(attempts > 80 && attempts < 100, 'about 90 attempts in 30 minutes: ' + attempts);
});

test('the phone notices a silent PC but not its own sleep', () => {
  let now = 0;
  const live = session.createLiveness({ timeout: 30000, pingEvery: 10000, suspendGap: 15000, now: () => now });
  assert.equal(live.tick(), 'ping');
  now += 5000;
  assert.equal(live.tick(), 'wait');
  now += 5000;
  assert.equal(live.tick(), 'ping');
  live.heard();
  for (let step = 0; step < 6; step++) {
    now += 5000;
    live.tick();
  }
  assert.equal(live.tick(), 'wait', '30 s after the last answer is still alive');
  now += 5000;
  assert.equal(live.tick(), 'dead', 'no answer for 35 s: reconnect');

  // This phone slept for 10 minutes: give the PC a fresh chance.
  now = 0;
  const sleepy = session.createLiveness({ now: () => now });
  sleepy.tick();
  now += 10 * 60 * 1000;
  assert.equal(sleepy.tick(), 'ping');
  now += 5000;
  assert.equal(sleepy.tick(), 'wait');
});

test('a long timer gap is reported as a wake-up, background throttling is not', () => {
  let now = 0;
  let tick = null;
  const wakes = [];
  const detector = session.createWakeDetector(gap => wakes.push(gap), {
    interval: 5000,
    threshold: 90000,
    now: () => now,
    setInterval: callback => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  });
  now += 5000;
  tick();
  now += 60000; // Chrome's one-minute background throttling
  tick();
  assert.deepEqual(wakes, []);
  now += 15 * 60 * 1000; // laptop slept
  tick();
  assert.equal(wakes.length, 1);
  assert.ok(wakes[0] >= 15 * 60 * 1000);
  detector.stop();
  assert.equal(tick, null);
});

test('keep awake uses the Windows app when present, the screen wake lock otherwise', async () => {
  const calls = [];
  const desktop = { setKeepAwake: async flag => { calls.push(flag); return flag; } };
  const inApp = session.createKeepAwake({ desktop });
  assert.equal(inApp.mode, 'desktop');
  assert.equal(await inApp.set(true), true);
  assert.equal(inApp.active, true);
  assert.equal(await inApp.set(false), false);
  assert.deepEqual(calls, [true, false]);

  let released = 0;
  const listeners = {};
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const wakeLock = {
    requests: 0,
    async request(type) {
      assert.equal(type, 'screen');
      this.requests++;
      const handlers = [];
      return {
        addEventListener: (name, callback) => handlers.push(callback),
        release: async () => {
          released++;
          handlers.forEach(callback => callback());
        },
      };
    },
  };
  const browser = session.createKeepAwake({ wakeLock, document: fakeDocument });
  assert.equal(browser.mode, 'screen');
  assert.equal(await browser.set(true), true);
  assert.equal(await browser.set(true), true);
  assert.equal(wakeLock.requests, 1, 'one lock at a time');
  assert.equal(await browser.set(false), false);
  assert.equal(released, 1);
  // Hidden tab: the browser refuses; it is taken again when the tab is visible.
  fakeDocument.visibilityState = 'hidden';
  await browser.set(true);
  assert.equal(browser.active, false);
  fakeDocument.visibilityState = 'visible';
  listeners.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(browser.active, true);
  assert.equal(session.createKeepAwake({}).mode, 'none');
});

test('the Windows app keeps the system and the screen awake only while sharing', () => {
  const started = new Map();
  let next = 1;
  const blocker = {
    start: type => {
      started.set(next, type);
      return next++;
    },
    stop: id => started.delete(id),
    isStarted: id => started.has(id),
  };
  const keeper = createPowerKeeper(blocker);
  assert.equal(keeper.active, false);
  assert.equal(keeper.set(true), true);
  assert.deepEqual([...started.values()].sort(), ['prevent-app-suspension', 'prevent-display-sleep']);
  assert.equal(keeper.set(true), true);
  assert.equal(started.size, 2, 'asking twice does not stack blockers');
  started.clear(); // Windows dropped them
  assert.equal(keeper.active, false);
  assert.equal(keeper.set(true), true, 're-armed');
  assert.equal(started.size, 2);
  assert.equal(keeper.set(false), false);
  assert.equal(started.size, 0);
  keeper.set(true);
  keeper.stop();
  assert.equal(started.size, 0);
});

test('the console wires the new session pieces together', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const order = ['remote-session.js', 'camera-frame-relay.js', 'camera-relay.js', 'remote-control.js', 'quick-connect.js'];
  const positions = order.map(name => html.indexOf('src="' + name + '"'));
  assert.ok(positions.every(position => position > 0), positions.join(','));
  assert.deepEqual([...positions].sort((first, second) => first - second), positions, 'load order');
  const worker = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  assert.ok(worker.includes("'./remote-session.js'"));
  const remote = fs.readFileSync(path.join(WEB, 'remote-control.js'), 'utf8');
  assert.ok(!remote.includes('Only one device can control at a time'), 'several devices may control');
  assert.ok(remote.includes("reason: 'stopped'"), 'Stop sharing tells phones not to reconnect');
  assert.ok(remote.includes('Allow & remember'));
  assert.ok(remote.includes("type: 'keepalive'"));
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.ok(preload.includes("'airiz:keep-awake'") && preload.includes("'airiz:power'"));
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.ok(main.includes("ipcMain.handle('airiz:keep-awake'"));
  assert.ok(main.includes("ipcMain.handle('airiz:sharing'") && main.includes('setBackgroundThrottling(flag !== true)'),
    'a minimized window keeps its timers while sharing');
  assert.ok(preload.includes("'airiz:sharing'"));
  assert.ok(remote.includes('desktop.setSharing(!!host.code)'),
    'the console turns background throttling off while a share code is open');
  assert.ok(main.includes("powerMonitor.on(state"));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('power-keeper.cjs'), 'packaged with the app');
});
