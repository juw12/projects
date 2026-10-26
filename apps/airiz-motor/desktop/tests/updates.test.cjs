'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController, installerUrl, validateUpdate, busyReason, FEED } = require('../update-controller.cjs');

const info = () => ({
  version: '1.3.0',
  files: [{ url: installerUrl('1.3.0'), sha512: Buffer.alloc(64, 1).toString('base64'), size: 12345 }],
  path: installerUrl('1.3.0')
});

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.downloads = 0;
    this.installs = [];
  }
  setFeedURL(feed) {
    this.feed = feed;
  }
  async checkForUpdates() {
    this.emit('checking-for-update');
    this.emit('update-available', info());
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit('download-progress', { percent: 50 });
    this.emit('update-downloaded', info());
  }
  quitAndInstall(...arguments_) {
    this.installs.push(arguments_);
  }
}

function fixture(overrides = {}) {
  const updater = new FakeUpdater();
  const portableLinks = [];
  const confirmations = [];
  let device = { connected: false, demoMode: false };
  let approveInstall = true;
  let approveSchedule = true;
  let preparations = 0;
  const controller = createUpdateController({
    updater,
    currentVersion: '1.2.0',
    packaged: true,
    pollIntervalMs: 5,
    getDeviceState: async () => device,
    confirmInstall: async (version, connected) => {
      confirmations.push({ type: 'install', connected });
      return approveInstall;
    },
    confirmSchedule: async (version, reason) => {
      confirmations.push({ type: 'schedule', reason });
      return approveSchedule;
    },
    prepareForInstall: async () => {
      preparations++;
      return true;
    },
    abortInstall: async () => {},
    publish: () => {},
    openPortable: async url => portableLinks.push(url),
    ...overrides
  });
  return {
    updater, controller, portableLinks, confirmations,
    setDevice(value) { device = value; },
    declineInstall() { approveInstall = false; },
    declineSchedule() { approveSchedule = false; },
    prepared: () => preparations
  };
}

async function ready(fixtureData) {
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('checks the AIRIZ HTTPS channel without auto-downloading or installing on quit', async () => {
  const { updater, controller } = fixture();
  assert.equal(updater.feed.url, FEED);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(updater.downloads, 0);
  assert.equal(updater.installs.length, 0);
});

test('foreign or malformed update metadata is rejected', () => {
  assert.equal(validateUpdate(info()).version, '1.3.0');
  for (const url of ['https://example.com/installer.exe', installerUrl('1.4.0')]) {
    const invalid = info();
    invalid.files[0].url = url;
    assert.throws(() => validateUpdate(invalid));
  }
  const invalid = info();
  invalid.files[0].sha512 = 'invalid';
  assert.throws(() => validateUpdate(invalid));
});

test('an idle connected device no longer blocks installation', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  fixtureData.setDevice({ connected: true, demoMode: false });
  await fixtureData.controller.install();
  assert.deepEqual(fixtureData.confirmations, [{ type: 'install', connected: true }]);
  assert.equal(fixtureData.prepared(), 1);
  assert.deepEqual(fixtureData.updater.installs, [[true, true]]);
});

test('declining the install prompt leaves the update ready', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  fixtureData.declineInstall();
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
});

for (const busy of [
  { connected: true, demoMode: false, macroRunning: true },
  { connected: false, cameraRecording: true },
  { connected: false, sessionActive: true },
  { connected: true, demoMode: false, audioCaptureActive: true }
]) {
  test('busy work schedules the install and runs it after the work ends ' + JSON.stringify(busy), async () => {
    const fixtureData = fixture();
    await ready(fixtureData);
    fixtureData.setDevice(busy);
    await fixtureData.controller.install();
    assert.equal(fixtureData.controller.snapshot().status, 'scheduled');
    assert.equal(fixtureData.confirmations[0].type, 'schedule');
    await sleep(25);
    assert.equal(fixtureData.updater.installs.length, 0);
    fixtureData.setDevice({ connected: true, demoMode: false });
    await sleep(40);
    assert.equal(fixtureData.prepared(), 1);
    assert.deepEqual(fixtureData.updater.installs, [[true, true]]);
  });
}

test('a scheduled install can be cancelled', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  fixtureData.setDevice({ connected: true, demoMode: false, macroRunning: true });
  await fixtureData.controller.install();
  fixtureData.controller.cancelScheduled();
  fixtureData.setDevice({ connected: true, demoMode: false });
  await sleep(30);
  assert.equal(fixtureData.updater.installs.length, 0);
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
});

test('declining to schedule installs nothing', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  fixtureData.declineSchedule();
  fixtureData.setDevice({ connected: false, cameraRecording: true });
  await fixtureData.controller.install();
  await sleep(20);
  assert.equal(fixtureData.updater.installs.length, 0);
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
});

test('unknown console state never installs', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  fixtureData.setDevice(null);
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
  assert.equal(fixtureData.confirmations.length, 0);
});

test('a console that becomes busy during preparation vetoes the restart', async () => {
  const fixtureData = fixture({ prepareForInstall: async () => false });
  await ready(fixtureData);
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
});

test('portable builds open the portable download instead of installing', async () => {
  const fixtureData = fixture({ portable: true });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.deepEqual(fixtureData.portableLinks, [installerUrl('1.3.0', true)]);
  assert.equal(fixtureData.updater.installs.length, 0);
});

test('busy reasons describe only work a restart would interrupt', () => {
  assert.equal(busyReason({ connected: true, demoMode: false }), null);
  assert.equal(busyReason({ connected: true, demoMode: true }), null);
  assert.equal(busyReason({ connected: false, macroRunning: true }), 'a macro is running');
  assert.equal(busyReason(null), 'the console state is unknown');
});
