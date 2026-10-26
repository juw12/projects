'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController, installerUrl, validateUpdate, activeSession, blockingWork, FEED } = require('../update-controller.cjs');

const info = () => ({
  version: '1.2.0',
  files: [{ url: installerUrl('1.2.0'), sha512: Buffer.alloc(64, 1).toString('base64'), size: 12345 }],
  path: installerUrl('1.2.0')
});
class FakeUpdater extends EventEmitter {
  constructor() { super(); this.downloads = 0; this.installs = []; }
  setFeedURL(feed) { this.feed = feed; }
  async checkForUpdates() { this.emit('checking-for-update'); this.emit('update-available', info()); }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 50 }); this.emit('update-downloaded', info()); }
  quitAndInstall(...arguments_) { this.installs.push(arguments_); }
}
function fixture(overrides = {}) {
  const updater = new FakeUpdater();
  const events = [];
  const portableLinks = [];
  let device = { connected: false, demoMode: false };
  let approved = false;
  let preparations = 0;
  let aborts = 0;
  const controller = createUpdateController({
    updater, currentVersion: '1.1.0', packaged: true,
    getDeviceState: async () => device,
    confirmInstall: async () => approved,
    prepareForInstall: async () => { preparations++; return true; },
    abortInstall: async () => { aborts++; },
    publish: state => events.push(state),
    openPortable: async url => portableLinks.push(url),
    ...overrides
  });
  return { updater, controller, events, portableLinks,
    setDevice(value) { device = value; },
    approve() { approved = true; },
    prepared: () => preparations, aborted: () => aborts };
}

test('checks use the AIRIZ-only HTTPS channel and never auto-download/install on quit', async () => {
  const { updater, controller } = fixture();
  assert.equal(updater.feed.url, FEED);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableDifferentialDownload, true);
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(updater.downloads, 0);
  assert.equal(updater.installs.length, 0);
});

test('foreign repository, wrong version filename and invalid checksums are rejected', () => {
  assert.equal(validateUpdate(info()).version, '1.2.0');
  for (const url of ['https://example.com/installer.exe', installerUrl('1.3.0')]) {
    const invalid = info();
    invalid.files[0].url = url;
    assert.throws(() => validateUpdate(invalid));
  }
  const invalid = info();
  invalid.files[0].sha512 = 'invalid';
  assert.throws(() => validateUpdate(invalid));
  assert.throws(() => installerUrl('../../other'));
});

test('bad channel metadata cannot reach a download', async () => {
  const { updater, controller } = fixture();
  updater.emit('update-available', { version: '1.2.0', files: [] });
  assert.equal(controller.snapshot().status, 'error');
  await controller.download();
  assert.equal(updater.downloads, 0);
});

for (const status of [
  { connected: true, demoMode: false, macroRunning: true },
  { connected: false, macroRunning: true },
  { connected: false, cameraRecording: true },
  { connected: false, sessionActive: true },
  { connected: false, audioCaptureActive: true },
  null
]) {
  test('installation is blocked for busy/unknown state ' + JSON.stringify(status), async () => {
    const fixtureData = fixture();
    await fixtureData.controller.check();
    await fixtureData.controller.download();
    fixtureData.approve();
    fixtureData.setDevice(status);
    await fixtureData.controller.install();
    assert.equal(fixtureData.updater.installs.length, 0);
    assert.equal(fixtureData.prepared(), 0);
  });
}

test('ready update waits for consent, then installs only when idle', async () => {
  const fixtureData = fixture();
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
  fixtureData.approve();
  await fixtureData.controller.install();
  assert.deepEqual(fixtureData.updater.installs, [[false, true]]);
  assert.equal(fixtureData.prepared(), 1);
});

test('a session that becomes busy during confirmation is rechecked', async () => {
  let reads = 0;
  const fixtureData = fixture({
    getDeviceState: async () => (++reads === 1 ? { connected: false } : { connected: false, macroRunning: true }),
    confirmInstall: async () => true
  });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
});

test('atomic console preparation can veto installation', async () => {
  const fixtureData = fixture({ prepareForInstall: async () => false, confirmInstall: async () => true });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.equal(fixtureData.updater.installs.length, 0);
});

test('portable update offers the scoped portable download, never an installer', async () => {
  const fixtureData = fixture({ portable: true });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.deepEqual(fixtureData.portableLinks, [installerUrl('1.2.0', true)]);
  assert.equal(fixtureData.updater.downloads, 0);
  assert.equal(fixtureData.updater.installs.length, 0);
});

test('offline check becomes a nonfatal status; demo connection alone is not hardware activity', async () => {
  const fixtureData = fixture();
  fixtureData.updater.checkForUpdates = async () => { throw new Error('Offline'); };
  await fixtureData.controller.check();
  assert.equal(fixtureData.controller.snapshot().status, 'error');
  assert.equal(activeSession({ connected: true, demoMode: true }), false);
});

test('an idle connected device is disconnected safely, then the update installs', async () => {
  const confirmations = [];
  const fixtureData = fixture({
    confirmInstall: async (version, options) => {
      confirmations.push({ version, ...options });
      return true;
    }
  });
  fixtureData.setDevice({ connected: true, demoMode: false });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.deepEqual(confirmations, [{ version: '1.2.0', connected: true }]);
  assert.equal(fixtureData.prepared(), 1);
  assert.deepEqual(fixtureData.updater.installs, [[false, true]]);
});

test('declining while connected keeps the connection and installs nothing', async () => {
  const fixtureData = fixture({ confirmInstall: async () => false });
  fixtureData.setDevice({ connected: true, demoMode: false });
  await fixtureData.controller.check();
  await fixtureData.controller.download();
  await fixtureData.controller.install();
  assert.equal(fixtureData.prepared(), 0);
  assert.equal(fixtureData.updater.installs.length, 0);
});

test('only running work blocks installation; an idle connection does not', () => {
  assert.equal(blockingWork({ connected: true, demoMode: false }), false);
  assert.equal(blockingWork({ connected: true, macroRunning: true }), true);
  assert.equal(blockingWork({ connected: false, audioCaptureActive: true }), true);
  assert.equal(blockingWork(null), true);
});
