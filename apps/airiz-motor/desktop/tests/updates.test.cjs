'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createUpdateController, installerUrl, validateUpdate, busyReason, autoBusyReason, AUTO_IDLE_MS, FEED
} = require('../update-controller.cjs');

const info = () => ({
  version: '1.3.0',
  files: [{ url: installerUrl('1.3.0'), sha512: Buffer.alloc(64, 1).toString('base64'), size: 12345 }],
  path: installerUrl('1.3.0')
});

const IDLE = AUTO_IDLE_MS + 1000;

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
  let device = { connected: false, demoMode: false, idleMs: IDLE };
  let approveInstall = true;
  let approveSchedule = true;
  let preparations = 0;
  const controller = createUpdateController({
    updater,
    currentVersion: '1.2.0',
    packaged: true,
    pollIntervalMs: 5,
    autoUpdate: false,
    autoInstallDelayMs: 10,
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

async function readyWithCheck(fixtureData) {
  await fixtureData.controller.check();
  // check() with autoUpdate on will auto-download, so the status is already 'downloaded'
  // by the time check() returns; for autoUpdate-off it stops at 'available'.
  const status = fixtureData.controller.snapshot().status;
  assert.ok(['available', 'downloaded'].includes(status), 'unexpected status after check(): ' + status);
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

test('auto-update off keeps the existing manual flow (auto-download disabled)', async () => {
  const { controller, updater } = fixture({ autoUpdate: false });
  await controller.check();
  assert.equal(controller.snapshot().status, 'available');
  assert.equal(updater.downloads, 0, 'no auto-download when preference is off');
  assert.equal(controller.snapshot().autoUpdate, false);
});

test('auto-update on auto-downloads the next release as soon as it appears', async () => {
  const { controller, updater, confirmations } = fixture({ autoUpdate: true });
  await controller.check();
  // check() itself kicks off the download once autoUpdate is on and the update
  // has been validated; the fake updater fires update-downloaded synchronously.
  assert.equal(updater.downloads, 1, 'check should drive a download when autoUpdate is on');
  assert.equal(controller.snapshot().status, 'downloaded');
  assert.equal(confirmations.length, 0, 'no confirm dialog when auto-update is downloading');
  assert.equal(controller.snapshot().autoUpdate, true);
});

test('auto-update on a portable build does not auto-download (portable apps still need manual replacement)', async () => {
  const { controller, updater, portableLinks } = fixture({ autoUpdate: true, portable: true });
  await controller.check();
  assert.equal(updater.downloads, 0);
  await controller.download();
  assert.deepEqual(portableLinks, [installerUrl('1.3.0', true)]);
});

test('auto-update arms a short install window after the download finishes (idle device)', async () => {
  const { controller, updater } = fixture({ autoUpdate: true });
  await readyWithCheck({ controller });
  assert.equal(updater.installs.length, 0, 'no immediate install');
  // Fast-forward just past the install window (the test fixture overrides the
  // production 10-second delay down to 10 ms so this stays quick).
  await sleep(50);
  assert.equal(updater.installs.length, 1, 'install fires after the cancel window');
  assert.deepEqual(updater.installs, [[true, true]]);
});

test('auto-update cancels cleanly when the user opens the dialog within the window', async () => {
  const { controller, updater } = fixture({ autoUpdate: true });
  await readyWithCheck({ controller });
  assert.equal(controller.snapshot().status, 'downloaded');
  controller.cancelAutoInstall();
  await sleep(50);
  assert.equal(updater.installs.length, 0, 'cancelAutoInstall should abort the scheduled install');
  assert.equal(controller.snapshot().status, 'downloaded', 'cancel leaves the update verified and ready');
});

test('auto-update on a busy device schedules the install instead of forcing it', async () => {
  const fixtureData = fixture({ autoUpdate: true });
  const { controller, updater, confirmations } = fixtureData;
  fixtureData.setDevice({ connected: true, demoMode: false, macroRunning: true });
  await readyWithCheck(fixtureData);
  // The auto-install timer resolves into a "scheduled" state.
  await sleep(50);
  assert.equal(controller.snapshot().status, 'scheduled');
  assert.equal(updater.installs.length, 0, 'no install while busy');
  assert.equal(confirmations.length, 0, 'auto-update does not ask the schedule prompt');
  // When the device becomes idle, the schedule timer installs.
  fixtureData.setDevice({ connected: true, demoMode: false, idleMs: IDLE });
  await sleep(40);
  assert.equal(updater.installs.length, 1, 'scheduled install fires once the work ends');
});

test('turning auto-update off cancels a pending auto-install', async () => {
  const { controller, updater } = fixture({ autoUpdate: true });
  await readyWithCheck({ controller });
  controller.setAutoUpdate(false);
  assert.equal(controller.snapshot().autoUpdate, false);
  await sleep(50);
  assert.equal(updater.installs.length, 0, 'turning off stops the auto-install');
});

test('turning auto-update on mid-flight starts the auto-install window for a downloaded update', async () => {
  const { controller, updater } = fixture({ autoUpdate: false });
  await ready({ controller });
  // Update is downloaded. The manual user clicks "Install" would prompt - but auto
  // is still off, so just flip the preference. The auto-install timer arms.
  controller.setAutoUpdate(true);
  await sleep(50);
  assert.equal(updater.installs.length, 1);
});

test('auto-update waits while the console was used recently, then installs once idle', async () => {
  const fixtureData = fixture({ autoUpdate: true });
  const { controller, updater } = fixtureData;
  fixtureData.setDevice({ connected: true, demoMode: false, idleMs: 20 * 1000 });
  await readyWithCheck(fixtureData);
  await sleep(40);
  assert.equal(controller.snapshot().status, 'scheduled');
  assert.match(controller.snapshot().message, /idle for 5 minutes/);
  assert.equal(updater.installs.length, 0, 'a jog 20 s ago must block an unattended restart');
  fixtureData.setDevice({ connected: true, demoMode: false, idleMs: IDLE });
  await sleep(40);
  assert.equal(updater.installs.length, 1);
});

test('auto-update treats a missing idle time and a voice message as busy', () => {
  assert.match(autoBusyReason({ connected: true, demoMode: false }), /idle/);
  assert.equal(autoBusyReason({ connected: true, voiceBusy: true, idleMs: IDLE }), 'a voice message is playing');
  assert.equal(autoBusyReason({ connected: true, macroRunning: true, idleMs: IDLE }), 'a macro is running');
  assert.equal(autoBusyReason({ connected: false, idleMs: IDLE }), null);
});

test('a manual Install still asks for confirmation (motion warning) when auto-update is on', async () => {
  const { controller, updater, confirmations } = fixture({ autoUpdate: true, autoInstallDelayMs: 10000 });
  await controller.check();
  assert.equal(controller.snapshot().status, 'downloaded');
  await controller.install();
  assert.deepEqual(confirmations.map(item => item.type), ['install']);
  assert.equal(updater.installs.length, 1);
  assert.equal(controller.snapshot().autoInstallAt, null, 'the countdown stops when a person takes over');
});

test('the countdown is published with a deadline and cleared on cancel', async () => {
  const published = [];
  const { controller, updater } = fixture({ autoUpdate: true, autoInstallDelayMs: 10000, publish: state => published.push(state) });
  await controller.check();
  const armed = controller.snapshot();
  assert.equal(armed.status, 'downloaded');
  assert.ok(armed.autoInstallAt > Date.now(), 'deadline lies in the future');
  assert.equal(published.filter(state => state.status === 'downloaded').length, 1, 'one downloaded publish, not two');
  controller.cancelAutoInstall();
  assert.equal(controller.snapshot().autoInstallAt, null);
  assert.equal(updater.installs.length, 0);
});

test('turning auto-update off cancels an install that auto-update was waiting to run', async () => {
  const fixtureData = fixture({ autoUpdate: true });
  const { controller, updater } = fixtureData;
  fixtureData.setDevice({ connected: true, demoMode: false, idleMs: 0 });
  await readyWithCheck(fixtureData);
  await sleep(40);
  assert.equal(controller.snapshot().status, 'scheduled');
  controller.setAutoUpdate(false);
  assert.equal(controller.snapshot().status, 'downloaded');
  fixtureData.setDevice({ connected: true, demoMode: false, idleMs: IDLE });
  await sleep(40);
  assert.equal(updater.installs.length, 0);
});

test('a manual schedule is not cancelled by turning auto-update off', async () => {
  const fixtureData = fixture({ autoUpdate: false });
  const { controller } = fixtureData;
  await ready(fixtureData);
  fixtureData.setDevice({ connected: true, demoMode: false, macroRunning: true });
  await controller.install();
  assert.equal(controller.snapshot().status, 'scheduled');
  assert.match(controller.snapshot().message, /when the macro finishes\./);
  controller.setAutoUpdate(false);
  assert.equal(controller.snapshot().status, 'scheduled');
  controller.cancelScheduled();
});


test('the auto path hands the idle rule to the renderer before the port is closed', async () => {
  const idleRequirements = [];
  const fixtureData = fixture({
    autoUpdate: true,
    prepareForInstall: async requireIdleMs => { idleRequirements.push(requireIdleMs); return true; }
  });
  await readyWithCheck(fixtureData);
  await sleep(50);
  assert.deepEqual(idleRequirements, [AUTO_IDLE_MS]);
  assert.equal(fixtureData.updater.installs.length, 1);
});

test('a manual install does not impose the auto idle rule on the renderer', async () => {
  const idleRequirements = [];
  const fixtureData = fixture({
    prepareForInstall: async requireIdleMs => { idleRequirements.push(requireIdleMs); return true; }
  });
  await ready(fixtureData);
  await fixtureData.controller.install();
  assert.deepEqual(idleRequirements, [0]);
  assert.equal(fixtureData.updater.installs.length, 1);
});

test('an auto-install that cannot prepare keeps waiting instead of giving up', async () => {
  let prepared = false;
  const fixtureData = fixture({ autoUpdate: true, prepareForInstall: async () => prepared });
  await readyWithCheck(fixtureData);
  await sleep(50);
  assert.equal(fixtureData.updater.installs.length, 0, 'no install while preparation fails');
  prepared = true;
  await sleep(40);
  assert.equal(fixtureData.updater.installs.length, 1, 'the auto path retries until the console is ready');
});

test('a manual install that cannot prepare never turns into an unattended auto-install', async () => {
  const fixtureData = fixture({
    autoUpdate: true, autoInstallDelayMs: 10000, prepareForInstall: async () => false
  });
  await fixtureData.controller.check();
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
  await fixtureData.controller.install();
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
  assert.match(fixtureData.controller.snapshot().message, /was not installed/);
  await sleep(40);
  assert.equal(fixtureData.updater.installs.length, 0, 'no silent unattended restart');
});

test('a double-click on Install and restart runs the installer once', async () => {
  const fixtureData = fixture();
  await ready(fixtureData);
  await Promise.all([fixtureData.controller.install(), fixtureData.controller.install()]);
  assert.equal(fixtureData.confirmations.length, 1, 'only one confirmation dialog');
  assert.equal(fixtureData.updater.installs.length, 1, 'only one install');
});

test('cancelling a scheduled install while the poll is reading the console still cancels it', async () => {
  let device = { connected: true, demoMode: false, macroRunning: true };
  let release = null;
  const fixtureData = fixture({
    getDeviceState: async () => {
      if (release) { const wait = release; release = null; await wait; }
      return device;
    }
  });
  await ready(fixtureData);
  await fixtureData.controller.install();
  assert.equal(fixtureData.controller.snapshot().status, 'scheduled');
  let unblock;
  release = new Promise(resolve => { unblock = resolve; });
  await sleep(20);
  fixtureData.controller.cancelScheduled();
  device = { connected: true, demoMode: false };
  unblock();
  await sleep(30);
  assert.equal(fixtureData.updater.installs.length, 0, 'a cancelled schedule must never install');
});

test('Cancel auto-install pressed while the countdown is reading the console still cancels it', async () => {
  let release = null;
  const fixtureData = fixture({
    autoUpdate: true,
    getDeviceState: async () => {
      if (release) {
        const wait = release;
        release = null;
        await wait;
      }
      return { connected: true, demoMode: false, idleMs: IDLE };
    }
  });
  let unblock;
  release = new Promise(resolve => { unblock = resolve; });
  await fixtureData.controller.check();
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
  await sleep(25); // the 10 ms countdown has fired and is waiting for the console state
  fixtureData.controller.cancelAutoInstall();
  unblock();
  await sleep(30);
  assert.equal(fixtureData.updater.installs.length, 0, 'a cancelled countdown must never install');
  assert.equal(fixtureData.controller.snapshot().status, 'downloaded');
  assert.equal(fixtureData.controller.snapshot().autoInstallAt, null);
});

test('turning auto-update off and on during the console read does not let the stale countdown install early', async () => {
  let release = null;
  const fixtureData = fixture({
    autoUpdate: true,
    autoInstallDelayMs: 10,
    getDeviceState: async () => {
      if (release) {
        const wait = release;
        release = null;
        await wait;
      }
      return { connected: true, demoMode: false, idleMs: IDLE };
    }
  });
  let unblock;
  release = new Promise(resolve => { unblock = resolve; });
  await fixtureData.controller.check();
  await sleep(25);
  fixtureData.controller.setAutoUpdate(false);
  fixtureData.controller.setAutoUpdate(true); // re-arms a fresh countdown
  unblock();
  await sleep(2);
  assert.equal(fixtureData.updater.installs.length, 0, 'the stale run must not install');
  await sleep(40);
  assert.equal(fixtureData.updater.installs.length, 1, 'the fresh countdown installs exactly once');
});
