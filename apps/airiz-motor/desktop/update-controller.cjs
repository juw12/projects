'use strict';

const FEED = 'https://juw12.github.io/projects/airiz-motor/updates/windows/';
const RELEASE_BASE = 'https://github.com/juw12/projects/releases/download/';

function installerUrl(version, portable = false) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unsupported update version.');
  return RELEASE_BASE + 'airiz-desktop-v' + version + '/AIRIZ-Console-'
    + (portable ? 'Portable-' : 'Setup-') + version + '-x64.exe';
}

function validateUpdate(info) {
  const expected = installerUrl(info.version);
  if (!Array.isArray(info.files) || info.files.length !== 1) throw new Error('Unexpected update files.');
  const file = info.files[0];
  if (String(file.url) !== expected || (info.path && info.path !== expected)) {
    throw new Error('Update is not an official AIRIZ Windows installer.');
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '') || !Number.isSafeInteger(file.size)
      || file.size < 1 || file.size > 1024 * 1024 * 1024) {
    throw new Error('Invalid update checksum or size.');
  }
  return info;
}

// Work that a restart would interrupt. A plain idle device connection is NOT
// busy: the console closes the port, installs, restarts and reconnects.
function busyReason(status) {
  if (!status || typeof status.connected !== 'boolean') return 'the console state is unknown';
  if (status.macroRunning) return 'a macro is running';
  if (status.cameraRecording) return 'a camera recording is running';
  if (status.audioCaptureActive) return 'a device audio transfer is running';
  if (status.sessionActive) return 'a camera session is open';
  return null;
}

function createUpdateController(options) {
  const {
    updater, getDeviceState, confirmInstall, confirmSchedule, prepareForInstall, abortInstall,
    publish, currentVersion, portable = false, packaged = true, openPortable,
    pollIntervalMs = 3000
  } = options;
  let candidate = null;
  let downloaded = false;
  let checking = false;
  let scheduleTimer = null;
  let state = {
    status: packaged ? 'idle' : 'development', currentVersion, availableVersion: null,
    portable, percent: 0,
    message: packaged
      ? 'Updates are checked on startup and every six hours. You can install while connected; the device reconnects after restart.'
      : 'Updates are available in the packaged Windows app.'
  };
  const snapshot = () => ({ ...state });
  function change(status, message, extra = {}) {
    state = { ...state, status, message, ...extra };
    publish(snapshot());
  }
  function stopSchedule() {
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  function fail(error) {
    stopSchedule();
    if (state.status === 'installing') Promise.resolve(abortInstall()).catch(() => {});
    change('error', error?.message || String(error));
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  if ('autoInstallEvent' in updater) updater.autoInstallEvent = 'manual';
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.setFeedURL({ provider: 'generic', url: FEED, channel: 'latest' });
  updater.on('checking-for-update', () => change('checking', 'Checking the AIRIZ desktop release channel…'));
  updater.on('update-available', info => {
    try {
      candidate = validateUpdate(info);
      downloaded = false;
      change('available', portable
        ? 'A newer portable app is available. Download it and replace your portable executable manually.'
        : 'An update is available. You can download it while the device stays connected.',
      { availableVersion: info.version, percent: 0 });
    } catch (error) {
      candidate = null;
      fail(error);
    }
  });
  updater.on('update-not-available', () => {
    candidate = null;
    downloaded = false;
    change('current', 'You have the latest published AIRIZ desktop version.', { availableVersion: null, percent: 0 });
  });
  updater.on('download-progress', progress => {
    change('downloading', 'Downloading and verifying the installer. Device controls remain available.',
      { percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)) });
  });
  updater.on('update-downloaded', info => {
    try {
      candidate = validateUpdate(info);
      downloaded = true;
      change('downloaded', 'Update verified and ready. Install now; a connected device reconnects automatically after restart.',
        { availableVersion: info.version, percent: 100 });
    } catch (error) {
      downloaded = false;
      fail(error);
    }
  });
  updater.on('error', fail);

  async function check() {
    if (!packaged || checking || ['downloading', 'downloaded', 'scheduled', 'installing'].includes(state.status)) return snapshot();
    checking = true;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      fail(error);
    } finally {
      checking = false;
    }
    return snapshot();
  }

  async function download() {
    if (!candidate || state.status !== 'available') return snapshot();
    try {
      validateUpdate(candidate);
      if (portable) {
        await openPortable(installerUrl(candidate.version, true));
        return snapshot();
      }
      change('downloading', 'Downloading the AIRIZ installer…', { percent: 0 });
      await updater.downloadUpdate();
    } catch (error) {
      fail(error);
    }
    return snapshot();
  }

  async function runInstall() {
    stopSchedule();
    change('installing', 'Closing the device connection safely and installing the update…');
    const prepared = await prepareForInstall();
    if (!prepared) {
      change('downloaded', 'The console became busy, so the update was not installed. Try again when the macro or recording finishes.');
      return snapshot();
    }
    // Silent install keeps the user's chosen folder and relaunches the app.
    updater.quitAndInstall(true, true);
    return snapshot();
  }

  async function install() {
    if (portable || !downloaded || !['downloaded', 'scheduled'].includes(state.status)) return snapshot();
    try {
      const status = await getDeviceState();
      const reason = busyReason(status);
      if (reason === 'the console state is unknown') {
        change('downloaded', 'Installation paused: ' + reason + '. Reopen the Updates panel and try again.');
        return snapshot();
      }
      const connected = Boolean(status.connected && !status.demoMode);
      if (reason) {
        if (state.status === 'scheduled') return snapshot();
        if (!await confirmSchedule(candidate.version, reason)) return snapshot();
        change('scheduled', 'Update scheduled: it installs automatically when ' + reason.replace(/^an? /, 'the ') + ' finishes. The device reconnects after restart.');
        scheduleTimer = setInterval(async () => {
          try {
            const current = await getDeviceState();
            if (!busyReason(current)) await runInstall();
          } catch (error) {
            fail(error);
          }
        }, pollIntervalMs);
        return snapshot();
      }
      if (!await confirmInstall(candidate.version, connected)) return snapshot();
      if (busyReason(await getDeviceState())) {
        change('downloaded', 'The console became busy during confirmation. Use Install again to schedule it.');
        return snapshot();
      }
      return await runInstall();
    } catch (error) {
      await Promise.resolve(abortInstall()).catch(() => {});
      fail(error);
    }
    return snapshot();
  }

  function cancelScheduled() {
    if (state.status !== 'scheduled') return snapshot();
    stopSchedule();
    change('downloaded', 'Scheduled installation cancelled. The verified update remains ready.');
    return snapshot();
  }

  return { snapshot, check, download, install, cancelScheduled };
}

module.exports = { FEED, installerUrl, validateUpdate, busyReason, createUpdateController };
