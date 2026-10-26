'use strict';

const FEED = 'https://juwpegatron.github.io/projects/airiz-motor/updates/windows/';
const RELEASE_BASE = 'https://github.com/juwpegatron/projects/releases/download/';

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

function activeSession(status) {
  if (!status || typeof status.connected !== 'boolean') return true;
  return !!((status.connected && !status.demoMode) || status.macroRunning
    || status.cameraRecording || status.sessionActive || status.audioCaptureActive);
}

function createUpdateController(options) {
  const { updater, getDeviceState, confirmInstall, prepareForInstall, abortInstall, publish,
    currentVersion, portable = false, packaged = true, openPortable } = options;
  let candidate = null;
  let downloaded = false;
  let checking = false;
  let state = {
    status: packaged ? 'idle' : 'development', currentVersion, availableVersion: null,
    portable, percent: 0,
    message: packaged ? 'Updates are checked on startup and every six hours. Installation is always your choice.'
      : 'Updates are available in the packaged Windows app.'
  };
  const snapshot = () => ({ ...state });
  function change(status, message, extra = {}) {
    state = { ...state, status, message, ...extra };
    publish(snapshot());
  }
  function fail(error) {
    if (state.status === 'installing') Promise.resolve(abortInstall()).catch(() => {});
    change('error', error?.message || String(error));
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  if ('autoInstallEvent' in updater) updater.autoInstallEvent = 'manual';
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  updater.setFeedURL({ provider: 'generic', url: FEED, channel: 'latest' });
  // Keep electron-updater's checksum/signature verification enabled. No custom
  // signature bypass is installed. The current unsigned build has no publisherName.
  updater.on('checking-for-update', () => change('checking', 'Checking the AIRIZ desktop release channel…'));
  updater.on('update-available', info => {
    try {
      candidate = validateUpdate(info);
      downloaded = false;
      change('available', portable
        ? 'A newer portable app is available. Download it and replace your portable executable manually.'
        : 'An update is available. Download it now, then install when your device session is finished.',
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
      change('downloaded', 'Update verified and ready. Finish device, macro and recording sessions before installing.',
        { availableVersion: info.version, percent: 100 });
    } catch (error) {
      downloaded = false;
      fail(error);
    }
  });
  updater.on('error', fail);

  async function check() {
    if (!packaged || checking || ['downloading', 'downloaded', 'installing'].includes(state.status)) return snapshot();
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

  async function install() {
    if (portable || !downloaded || state.status !== 'downloaded') return snapshot();
    try {
      if (activeSession(await getDeviceState())) {
        change('downloaded', 'Installation blocked: disconnect the device and finish macros, recordings and sessions first.');
        return snapshot();
      }
      if (!await confirmInstall(candidate.version)) return snapshot();
      if (activeSession(await getDeviceState()) || !await prepareForInstall()) {
        change('downloaded', 'The console became busy. Finish the active session before installing.');
        return snapshot();
      }
      change('installing', 'Closing AIRIZ to run the verified update installer…');
      updater.quitAndInstall(false, true);
    } catch (error) {
      await Promise.resolve(abortInstall()).catch(() => {});
      fail(error);
    }
    return snapshot();
  }

  return { snapshot, check, download, install };
}

module.exports = { FEED, installerUrl, validateUpdate, activeSession, createUpdateController };
