'use strict';

// 1.9.0: several phones, remembered devices, reconnect after sleep, keep awake while sharing.
// 1.9.1: no retry time limit, same code after a reload or an update, sleep timers and lid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const session = require('../../web/remote-session.js');
const { createPowerKeeper } = require('../power-keeper.cjs');
const powerPlanModule = require('../power-plan.cjs');

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
  for (const reason of ['lost', 'pc-gone', 'pc-silent', 'restart']) assert.equal(session.canStartRetry(reason), true, reason);
  for (const reason of ['denied', 'revoked', 'stopped', 'cancelled', 'busy', 'no-pc', 'timeout', undefined]) {
    assert.equal(session.canStartRetry(reason), false, String(reason));
  }
  for (const reason of ['no-pc', 'timeout', 'approval-timeout', 'network', 'verify', 'lost', 'restart']) {
    assert.equal(session.canContinueRetry(reason), true, reason);
  }
  for (const reason of ['denied', 'revoked', 'stopped', 'cancelled', 'busy-here', 'input', undefined]) {
    assert.equal(session.canContinueRetry(reason), false, String(reason));
  }
  assert.equal(session.RETRY_WINDOW_MS, undefined, '1.9.1: no 30-minute limit any more');
});

test('retries are quick at first, then once a minute for as long as the page is open', () => {
  assert.deepEqual([0, 1, 2, 3, 7, 8, 37].map(session.retryDelay), [3000, 3000, 3000, 8000, 8000, 20000, 20000]);
  assert.equal(session.RETRY_SLOW_MS, 60000);
  for (const attempt of [38, 100, 1000, 100000]) assert.equal(session.retryDelay(attempt), session.RETRY_SLOW_MS, String(attempt));
  let total = 0;
  for (let attempt = 0; attempt < 38; attempt++) total += session.retryDelay(attempt);
  assert.ok(total <= 11 * 60 * 1000, 'the quick phase lasts about 11 minutes: ' + total);
  // A whole working day away is still covered: about one attempt per minute after that.
  let attempts = 38;
  while (total < 10 * 60 * 60 * 1000) total += session.retryDelay(attempts++);
  assert.ok(attempts > 600 && attempts < 640, 'about 620 attempts in 10 hours: ' + attempts);
});

test('a reloaded phone page reconnects to the same code (this tab only, 12 hours)', () => {
  const storage = session.memoryStorage();
  const now = 1_000_000;
  assert.equal(session.loadPhoneResume(storage, now), null);
  assert.equal(session.savePhoneResume(storage, '12345', now), false, 'only 6-digit codes');
  assert.equal(session.savePhoneResume(storage, '654321', now), true);
  assert.deepEqual(session.loadPhoneResume(storage, now + 60000), { code: '654321', at: now });
  assert.equal(session.loadPhoneResume(storage, now + session.PHONE_RESUME_MAX_MS + 1), null, 'too old');
  storage.setItem(session.PHONE_RESUME_KEY, '{"code":"<script>","at":1}');
  assert.equal(session.loadPhoneResume(storage, now), null, 'damaged records are ignored');
  session.savePhoneResume(storage, '654321', now);
  session.clearPhoneResume(storage);
  assert.equal(session.loadPhoneResume(storage, now), null, 'Stop and Disconnect forget the code');
  assert.equal(session.savePhoneResume(null, '654321', now), false, 'no storage: nothing to keep');
});

test('a reloaded or updated PC console shares again with the same code', () => {
  const storage = session.memoryStorage();
  const now = 5_000_000;
  const phone = session.loadIdentity(session.memoryStorage());
  const hash = 'a'.repeat(64);
  assert.equal(session.saveShareResume(storage, { code: 'abc', reason: 'running' }, now), false);
  assert.equal(session.saveShareResume(storage, {
    code: '246810',
    reason: 'running',
    approved: [[phone.id, hash], ['bad id', hash], [phone.id, 'not-a-hash']],
  }, now), true);
  const record = session.loadShareResume(storage);
  assert.deepEqual(record, { code: '246810', at: now, reason: 'running', approved: [[phone.id, hash]] },
    'only well-formed device hashes are kept, never keys');
  assert.ok(!storage.getItem(session.SHARE_RESUME_KEY).includes(phone.key));

  // A running share comes back after a reload, not after the app was closed and opened again.
  assert.equal(session.shouldResumeShare(record, { now: now + 1000, navigation: 'reload' }), true);
  assert.equal(session.shouldResumeShare(record, { now: now + 1000, navigation: 'navigate' }), false);
  // A restart for an update comes back after the restart (a new navigation).
  session.saveShareResume(storage, { code: '246810', reason: 'update', approved: [] }, now);
  const update = session.loadShareResume(storage);
  assert.equal(update.reason, 'update');
  assert.equal(session.shouldResumeShare(update, { now: now + 120000, navigation: 'navigate' }), true);
  assert.equal(session.shouldResumeShare(update, { now: now + session.SHARE_RESUME_MAX_MS + 1, navigation: 'reload' }), false,
    'not after 15 minutes');
  assert.equal(session.shouldResumeShare(null, { now }), false);
  session.clearShareResume(storage);
  assert.equal(session.loadShareResume(storage), null, 'Stop sharing forgets the code');
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

test('1.9.1: the screen is only held on where an idle screen can end in standby', () => {
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
  let modernStandby = false;
  const keeper = createPowerKeeper(blocker, { display: () => modernStandby });
  assert.equal(keeper.set(true), true);
  assert.deepEqual([...started.values()], ['prevent-app-suspension'], 'classic sleep: the screen may turn off');
  assert.equal(keeper.displayHeld, false);
  modernStandby = true;
  assert.equal(keeper.set(true), true, 're-armed when the screen decision changes');
  assert.deepEqual([...started.values()].sort(), ['prevent-app-suspension', 'prevent-display-sleep']);
  assert.equal(keeper.displayHeld, true);
  keeper.stop();
  assert.equal(started.size, 0);
});

// A powercfg.exe stand-in: one power scheme with the three settings the share changes.
function fakePowercfg(initial, options = {}) {
  const scheme = '381b4222-f694-41f0-9685-ff5bb260df2e';
  const values = new Map(Object.entries(initial).map(([setting, value]) => [setting, { ...value }]));
  const calls = [];
  const failSet = new Set(options.failSet || []);
  const hex = number => '0x' + number.toString(16).padStart(8, '0');
  function handle(args) {
    calls.push(args.join(' '));
    const verb = args[0];
    if (verb === '/getactivescheme') return { code: 0, stdout: 'Power Scheme GUID: ' + scheme.toUpperCase() + '  (Balanced)\r\n' };
    if (verb === '/qh' || verb === '/q') {
      const value = values.get(args[3]);
      if (!value || args[1] !== scheme) return { code: 1, stdout: '' };
      return {
        code: 0,
        stdout: 'Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da\r\n'
          + '  Minimum Possible Setting: 0x00000000\r\n  Maximum Possible Setting: 0xffffffff\r\n'
          + '  Current AC Power Setting Index: ' + hex(value.ac) + '\r\n'
          + '  Current DC Power Setting Index: ' + hex(value.dc) + '\r\n',
      };
    }
    if (verb === '/setacvalueindex' || verb === '/setdcvalueindex') {
      const value = values.get(args[3]);
      if (!value || failSet.has(args[3])) return { code: 1, stdout: '' };
      value[verb === '/setacvalueindex' ? 'ac' : 'dc'] = Number(args[4]);
      return { code: 0, stdout: '' };
    }
    if (verb === '/setactive') return { code: 0, stdout: '' };
    if (verb === '/a') {
      return options.standby === undefined ? { code: 1, stdout: '' } : { code: 0, stdout: options.standby };
    }
    return { code: 1, stdout: '' };
  }
  return { scheme, values, calls, run: async args => handle(args), runSync: args => handle(args) };
}

function memoryStore() {
  let data = null;
  return {
    load: () => (data ? JSON.parse(data) : []),
    save: entries => {
      data = JSON.stringify(entries);
    },
    clear: () => {
      data = null;
    },
    get raw() {
      return data;
    },
  };
}

const OWNER_SETTINGS = {
  STANDBYIDLE: { ac: 3600, dc: 3600 },
  HIBERNATEIDLE: { ac: 0, dc: 2147483647 },
  LIDACTION: { ac: 1, dc: 1 },
};

test('power plan: parses powercfg output in any Windows language', () => {
  const { parseScheme, parseValues, parseStandby } = powerPlanModule;
  assert.equal(parseScheme('電源配置 GUID: 381B4222-F694-41F0-9685-FF5BB260DF2E  (平衡)'), '381b4222-f694-41f0-9685-ff5bb260df2e');
  assert.equal(parseScheme('nothing here'), null);
  assert.deepEqual(parseValues('最小值: 0x00000000\n目前的 AC 電源設定索引: 0x00000e10\n目前的 DC 電源設定索引: 0x00000708'),
    { ac: 3600, dc: 1800 });
  assert.equal(parseValues('only 0x00000001'), null);
  const modern = 'The following sleep states are available on this system:\r\n    Standby (S0 Low Power Idle) Network Connected\r\n    Hibernate\r\n\r\n'
    + 'The following sleep states are not available on this system:\r\n    Standby (S1)\r\n    Standby (S3)\r\n';
  const classic = 'The following sleep states are available on this system:\n    Standby (S3)\n    Hibernate\n\n'
    + 'The following sleep states are not available on this system:\n    Standby (S0 Low Power Idle)\n';
  assert.equal(parseStandby(modern), 'modern');
  assert.equal(parseStandby(classic), 'classic');
  assert.equal(parseStandby(''), 'unknown');
});

test('power plan: sleep timers and lid are switched off while sharing and put back after', async () => {
  const powercfg = fakePowercfg(OWNER_SETTINGS, { standby: 'Standby (S0 Low Power Idle)\n\nnot available:\n Standby (S3)' });
  const store = memoryStore();
  const plan = powerPlanModule.createPowerPlan({ run: powercfg.run, runSync: powercfg.runSync, store });
  assert.equal(await plan.detectStandby(), 'modern');

  let status = await plan.update({ sleep: true });
  assert.equal(status.sleep, 'on');
  assert.equal(status.lid, 'off');
  assert.deepEqual(powercfg.values.get('STANDBYIDLE'), { ac: 0, dc: 0 });
  assert.deepEqual(powercfg.values.get('HIBERNATEIDLE'), { ac: 0, dc: 0 });
  assert.deepEqual(powercfg.values.get('LIDACTION'), { ac: 1, dc: 1 }, 'lid untouched until asked');
  const savedFirst = JSON.parse(store.raw);
  assert.deepEqual(savedFirst.map(entry => [entry.setting, entry.ac, entry.dc]),
    [['STANDBYIDLE', 3600, 3600], ['HIBERNATEIDLE', 0, 2147483647]], 'the owner values are saved before the change');

  // Both requests at once (keep awake + lid) run one after the other.
  const [, lidStatus] = await Promise.all([plan.update({ sleep: true }), plan.update({ lid: true })]);
  assert.equal(lidStatus.lid, 'on');
  assert.deepEqual(powercfg.values.get('LIDACTION'), { ac: 0, dc: 0 });
  assert.equal(JSON.parse(store.raw).length, 3, 'asking twice never saves "off" as the owner value');
  assert.ok(powercfg.calls.includes('/setactive ' + powercfg.scheme), 'the changed plan is applied');

  status = await plan.update({ sleep: false, lid: false });
  assert.deepEqual([status.sleep, status.lid], ['off', 'off']);
  for (const [setting, value] of Object.entries(OWNER_SETTINGS)) {
    assert.deepEqual(powercfg.values.get(setting), value, setting + ' is back');
  }
  assert.equal(store.raw, null, 'nothing left to restore');
  assert.equal(plan.pending, 0);
});

test('power plan: a killed app puts the owner settings back at the next start', async () => {
  const powercfg = fakePowercfg(OWNER_SETTINGS);
  const store = memoryStore();
  const first = powerPlanModule.createPowerPlan({ run: powercfg.run, runSync: powercfg.runSync, store });
  await first.update({ sleep: true, lid: true });
  assert.deepEqual(powercfg.values.get('LIDACTION'), { ac: 0, dc: 0 });
  // The process dies here: no release. A new start reads the saved values.
  const second = powerPlanModule.createPowerPlan({ run: powercfg.run, runSync: powercfg.runSync, store });
  assert.equal(second.pending, 3);
  await second.recover();
  for (const [setting, value] of Object.entries(OWNER_SETTINGS)) {
    assert.deepEqual(powercfg.values.get(setting), value, setting + ' recovered');
  }
  assert.equal(store.raw, null);

  // Quitting while sharing restores synchronously.
  const third = powerPlanModule.createPowerPlan({ run: powercfg.run, runSync: powercfg.runSync, store });
  await third.update({ sleep: true, lid: true });
  assert.equal(third.releaseAllSync(), true);
  for (const [setting, value] of Object.entries(OWNER_SETTINGS)) {
    assert.deepEqual(powercfg.values.get(setting), value, setting + ' restored on quit');
  }
  assert.deepEqual([third.status.sleep, third.status.lid], ['off', 'off']);
  assert.equal(store.raw, null);
});

test('power plan: IT-managed settings are left alone, failures are undone', async () => {
  const lidGuid = powerPlanModule.GROUPS.lid[0].guid;
  const managed = fakePowercfg(OWNER_SETTINGS);
  const managedPlan = powerPlanModule.createPowerPlan({
    run: managed.run,
    runSync: managed.runSync,
    store: memoryStore(),
    policyManaged: async guid => guid === lidGuid,
  });
  const managedStatus = await managedPlan.update({ lid: true });
  assert.equal(managedStatus.lid, 'managed');
  assert.deepEqual(managed.values.get('LIDACTION'), { ac: 1, dc: 1 });
  assert.equal(managedPlan.pending, 0);

  const failing = fakePowercfg(OWNER_SETTINGS, { failSet: ['STANDBYIDLE'] });
  const store = memoryStore();
  const failingPlan = powerPlanModule.createPowerPlan({ run: failing.run, runSync: failing.runSync, store });
  const failedStatus = await failingPlan.update({ sleep: true });
  assert.equal(failedStatus.sleep, 'failed');
  assert.deepEqual(failing.values.get('HIBERNATEIDLE'), OWNER_SETTINGS.HIBERNATEIDLE, 'half a change is undone');
  assert.deepEqual(failing.values.get('STANDBYIDLE'), OWNER_SETTINGS.STANDBYIDLE);
  assert.equal(failingPlan.pending, 0);
  assert.equal(store.raw, null);

  const broken = powerPlanModule.createPowerPlan({
    run: async () => ({ code: 1, stdout: '' }),
    runSync: () => ({ code: 1, stdout: '' }),
    store: memoryStore(),
  });
  assert.equal((await broken.update({ sleep: true })).sleep, 'failed', 'no powercfg: reported, nothing changed');
  assert.equal(await broken.detectStandby(), 'unknown');
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
  assert.ok(main.includes("ipcMain.handle('airiz:sharing'") && main.includes('backgroundWork.sharing = flag === true')
    && main.includes('setBackgroundThrottling(!(backgroundWork.sharing || backgroundWork.detection))'),
    'a minimized window keeps its timers while sharing (1.11.8: also while Smart detection is armed)');
  assert.ok(preload.includes("'airiz:sharing'"));
  assert.ok(remote.includes('desktop.setSharing(!!host.code)'),
    'the console turns background throttling off while a share code is open');
  assert.ok(main.includes("powerMonitor.on(state"));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('power-keeper.cjs'), 'packaged with the app');

  // 1.9.1: lid and sleep timers, same code after a reload or an update, no retry limit.
  assert.ok(pkg.build.files.includes('power-plan.cjs'), 'power-plan.cjs is packaged too');
  assert.ok(main.includes("ipcMain.handle('airiz:lid-awake'") && main.includes("ipcMain.handle('airiz:power-status'"));
  assert.ok(preload.includes("'airiz:lid-awake'") && preload.includes("'airiz:power-status'"));
  assert.ok(main.includes('releaseAllSync()'), 'quitting puts the power settings back');
  assert.ok(main.includes('.recover()'), 'a killed app is repaired at the next start');
  assert.ok(remote.includes("reason: 'restart'") && remote.includes("'airiz:update-restart'"),
    'an update restart keeps the code and tells phones to keep trying');
  assert.ok(remote.includes('phoneResumeAfterReload()') && remote.includes('session.savePhoneResume(PHONE_STORE, code)'));
  assert.ok(remote.includes('Still trying once a minute'));
  assert.ok(!remote.includes('RETRY_WINDOW_MS') && !remote.includes('after 30 minutes'), 'no 30-minute limit left');
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.ok(app.includes('updating: !!state.updatePending'));
  assert.ok(app.includes("new CustomEvent('airiz:update-restart')") && app.includes("new CustomEvent('airiz:update-cancelled')"));
  const relay = fs.readFileSync(path.join(__dirname, '..', '..', 'relay', 'src', 'index.js'), 'utf8');
  assert.match(relay, /const MAX_CONTROLLERS = 20;/, 'up to 20 phones control through the relay');
});


// 1.11.4: the owner's own code, Allow remembers by default, a request is never only a toast.
test('the owner can keep an own 6-digit code; easy codes are refused', () => {
  for (const good of ['482913', '905172', '246810', '135790', '070809']) {
    assert.deepEqual(session.checkOwnCode(good), { ok: true, code: good }, good);
  }
  for (const easy of ['000000', '111111', '123456', '654321', '890123', '121212', '123123', '123321', '112233', '332211']) {
    assert.deepEqual(session.checkOwnCode(easy), { ok: false, reason: 'easy' }, easy);
  }
  for (const bad of ['', '12345', '1234567', 'abcdef', '12a456', null, undefined]) {
    assert.equal(session.checkOwnCode(bad).reason, 'format', String(bad));
  }
  assert.deepEqual(session.checkOwnCode(' 482 913 '), { ok: true, code: '482913' }, 'spaces are ignored');

  const storage = session.memoryStorage();
  assert.equal(session.loadOwnCode(storage), null, 'random codes until the owner sets one');
  assert.equal(session.saveOwnCode(storage, '123456').ok, false);
  assert.equal(session.loadOwnCode(storage), null, 'a refused code is not stored');
  assert.deepEqual(session.saveOwnCode(storage, '482913'), { ok: true, code: '482913' });
  assert.equal(session.loadOwnCode(storage), '482913');
  assert.deepEqual(session.saveOwnCode(storage, '905172'), { ok: true, code: '905172' }, 'changed any time');
  assert.equal(session.loadOwnCode(storage), '905172');
  storage.setItem(session.OWN_CODE_KEY, JSON.stringify({ code: '111111' }));
  assert.equal(session.loadOwnCode(storage), null, 'a stored easy code is ignored');
  session.saveOwnCode(storage, '482913');
  session.clearOwnCode(storage);
  assert.equal(session.loadOwnCode(storage), null, 'back to random codes');
  assert.equal(session.saveOwnCode(null, '482913').reason, 'storage');
});

test('Allow remembers a device by default; the owner can turn that off', () => {
  const storage = session.memoryStorage();
  const trust = session.createTrustStore(storage);
  assert.equal(trust.autoRemember, true, 'on by default');
  assert.equal(trust.autoAllow, true);
  trust.setAutoRemember(false);
  assert.equal(trust.autoRemember, false);
  assert.equal(session.createTrustStore(storage).autoRemember, false, 'kept in storage');
  assert.equal(trust.autoAllow, true, 'the other switch is untouched');
  trust.setAutoAllow(false);
  assert.equal(trust.autoRemember, false, 'and the other way round');
  trust.setAutoRemember(true);
  assert.equal(trust.autoRemember, true);
  // 1.9.x stores (no autoRemember field) get the new default.
  storage.setItem(session.TRUST_KEY, JSON.stringify({ autoAllow: true, devices: [] }));
  assert.equal(session.createTrustStore(storage).autoRemember, true);
});

test('1.11.4 wiring: request prompt, own code, code change, taskbar flash', () => {
  const remote = fs.readFileSync(path.join(WEB, 'remote-control.js'), 'utf8');
  assert.ok(remote.includes("dialog.id = 'share-ask-dialog'") && remote.includes('hostShowRequest(controller)'),
    'a new request opens the Allow prompt (not only a toast)');
  assert.ok(!remote.includes('Allow it in Share control.'), 'the old toast-only hint is gone');
  assert.ok(remote.includes("'Allow & remember'") && remote.includes("'Allow once'") && remote.includes('trustStore.autoRemember'));
  assert.ok(remote.includes('session.loadOwnCode(SHARE_STORE)') && remote.includes('givenCode || ownCode || randomDigits()'),
    'Start sharing uses the owner code when there is one');
  assert.ok(remote.includes('!host.resumed && !host.ownCode'), 'a busy PeerJS id never swaps the owner code for a random one');
  assert.ok(remote.includes("hostBroadcast({ type: 'ended', reason: 'code-changed' })"));
  assert.ok(remote.includes("linkError('code-changed'"), 'phones are told the code changed');
  assert.ok(!session.canStartRetry('code-changed') && !session.canContinueRetry('code-changed'),
    'phones do not keep retrying an old code');
  assert.ok(remote.includes('event.code === 4000 && host.ownCode') && remote.includes('hostCodeTaken(code)'),
    'two consoles on one own code: the older one stops instead of taking turns');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.ok(preload.includes("requestAttention: flag => ipcRenderer.invoke('airiz:attention', flag === true)"));
  assert.ok(main.includes("ipcMain.handle('airiz:attention'") && main.includes('mainWindow.flashFrame(wanted)'));
  assert.ok(remote.includes('desktop.requestAttention(waiting)'));
  // 1.11.15: clicking an "asks to join" notification restores the window.
  assert.ok(preload.includes("showWindow: () => ipcRenderer.invoke('airiz:show-window')"));
  assert.ok(main.includes("ipcMain.handle('airiz:show-window'") && main.includes('mainWindow.restore()'));
  assert.ok(remote.includes('desktop.showWindow()') && remote.includes("hostNotifyJoin(controller, 'joined')"));
});
