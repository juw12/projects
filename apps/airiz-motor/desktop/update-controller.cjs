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

// Auto-update has no confirmation dialog, so nobody sees the "finish any motion
// first" warning. It therefore also waits for a voice message and for the console
// to sit untouched (no command, click or key) for autoIdleMs: closing the port does
// not stop a move that was already sent. An unknown idle time counts as busy.
const AUTO_IDLE_MS = 5 * 60 * 1000;
function autoBusyReason(status, idleMs = AUTO_IDLE_MS) {
  const reason = busyReason(status);
  if (reason) return reason;
  if (status.voiceBusy) return 'a voice message is playing';
  if (typeof status.idleMs !== 'number' || !(status.idleMs >= idleMs)) {
    return 'the console has been idle for ' + Math.round(idleMs / 60000) + ' minutes';
  }
  return null;
}

// Turns a busy reason into the condition being waited for, e.g.
// "a macro is running" -> "the macro finishes" (was "the macro is running finishes").
function waitPhrase(reason) {
  if (/^the console has been idle/.test(reason)) return reason;
  if (reason === 'the console state is unknown') return 'the console reports its state again';
  if (reason === 'a camera session is open') return 'the camera session is closed';
  return reason.replace(/^an? /, 'the ').replace(/ is (running|playing)$/, '') + ' finishes';
}

function createUpdateController(options) {
  const {
    updater, getDeviceState, confirmInstall, confirmSchedule, prepareForInstall, abortInstall,
    publish, currentVersion, portable = false, packaged = true, openPortable,
    pollIntervalMs = 3000, autoInstallDelayMs = 10000, autoIdleMs = AUTO_IDLE_MS
  } = options;
  let autoUpdate = options.autoUpdate === true;
  let candidate = null;
  let downloaded = false;
  let checking = false;
  let scheduleTimer = null;
  let autoInstallTimer = null;
  let scheduledByAuto = false;
  let installInFlight = false;
  const autoSeconds = Math.round(autoInstallDelayMs / 1000);
  let state = {
    status: packaged ? 'idle' : 'development', currentVersion, availableVersion: null,
    portable, percent: 0, autoUpdate, autoInstallAt: null,
    message: packaged
      ? 'Updates are checked on startup and every six hours. You can install while connected; the device reconnects after restart.'
      : 'Updates are available in the packaged Windows app.'
  };
  const snapshot = () => ({ ...state });
  function change(status, message, extra = {}) {
    state = { ...state, status, message, autoInstallAt: autoInstallTimer ? state.autoInstallAt : null, ...extra };
    publish(snapshot());
  }
  function stopSchedule() {
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = null;
    scheduledByAuto = false;
  }
  function stopAutoInstall() {
    if (autoInstallTimer) clearTimeout(autoInstallTimer);
    autoInstallTimer = null;
    state = { ...state, autoInstallAt: null };
  }
  // One polling loop for both the manual "install when finished" and the auto path.
  function startSchedule(isBusy, byAuto) {
    stopSchedule();
    scheduledByAuto = byAuto;
    const timer = setInterval(async () => {
      try {
        const status = await getDeviceState();
        // The user may have cancelled (or re-made) the schedule while the console state
        // was being read: only this still-current schedule may install.
        if (state.status !== 'scheduled' || scheduleTimer !== timer) return;
        if (!isBusy(status)) await runInstall(scheduledByAuto);
      } catch (error) {
        fail(error);
      }
    }, pollIntervalMs);
    scheduleTimer = timer;
  }
  function fail(error) {
    stopSchedule();
    stopAutoInstall();
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
        : (autoUpdate
            ? 'A newer AIRIZ Console is available. Downloading it now (auto-update is on); the device stays connected.'
            : 'An update is available. You can download it while the device stays connected.'),
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
      state = { ...state, availableVersion: info.version, percent: 100 };
      if (autoUpdate && !portable) armAutoInstall();
      else change('downloaded', 'Update verified and ready. Install now; a connected device reconnects automatically after restart.');
    } catch (error) {
      downloaded = false;
      fail(error);
    }
  });
  updater.on('error', fail);

  // Auto-update: after a verified download, show a visible countdown (the Updates
  // dialog opens itself) so a person at the PC can cancel. When it runs out, install
  // only if the console is idle by the stricter auto rule; otherwise wait for that.
  function armAutoInstall() {
    stopAutoInstall();
    const autoInstallAt = Date.now() + autoInstallDelayMs;
    autoInstallTimer = setTimeout(autoInstallNow, autoInstallDelayMs);
    change('downloaded', 'Update verified and ready. Auto-update installs it in ' + autoSeconds
      + ' seconds if the console is idle. Press Cancel auto-install to keep working.', { autoInstallAt });
  }

  async function autoInstallNow() {
    // Keep the fired timer as this run's token until the decision: Cancel auto-install,
    // a manual Install or a re-arm replaces/clears it, and a stale run must then stop.
    const token = autoInstallTimer;
    if (!autoUpdate || state.status !== 'downloaded') return;
    try {
      const status = await getDeviceState();
      if (autoInstallTimer !== token || !autoUpdate || state.status !== 'downloaded') return;
      stopAutoInstall();
      const reason = autoBusyReason(status, autoIdleMs);
      if (reason) {
        change('scheduled', 'Auto-update is waiting until ' + waitPhrase(reason)
          + ', then installs and restarts. The device reconnects after restart.');
        startSchedule(status => autoBusyReason(status, autoIdleMs), true);
        return;
      }
      await runInstall(true);
    } catch (error) {
      fail(error);
    }
  }

  async function check() {
    if (!packaged || checking || ['downloading', 'downloaded', 'scheduled', 'installing'].includes(state.status)) return snapshot();
    checking = true;
    try {
      await updater.checkForUpdates();
      // Auto-update path: if a fresh update became available and the user opted in,
      // kick off the download straight away. The 'update-available' handler has
      // already validated the manifest and updated the snapshot.
      if (autoUpdate && !portable && state.status === 'available') await download();
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

  // One install at a time: a double-click on "Install and restart", or a schedule
  // timer firing while a dialog is open, must never run the installer twice.
  async function runInstall(byAuto = false) {
    if (installInFlight) return snapshot();
    installInFlight = true;
    try {
      return await installNow(byAuto);
    } finally {
      installInFlight = false;
    }
  }
  async function installNow(byAuto) {
    stopSchedule();
    stopAutoInstall();
    change('installing', 'Closing the device connection safely and installing the update…');
    // The auto path has no dialog, so the renderer re-checks the untouched-for-five-
    // minutes rule itself, right before it closes the port.
    const prepared = await prepareForInstall(byAuto ? autoIdleMs : 0);
    if (!prepared) {
      if (byAuto && autoUpdate) {
        change('scheduled', 'The console became busy, so auto-update is waiting until it is idle again.');
        startSchedule(status => autoBusyReason(status, autoIdleMs), true);
        return snapshot();
      }
      change('downloaded', 'The console became busy, so the update was not installed. Try again when the macro or recording finishes.');
      return snapshot();
    }
    // Silent install keeps the user's chosen folder and relaunches the app.
    updater.quitAndInstall(true, true);
    return snapshot();
  }

  async function install() {
    if (portable || !downloaded || installInFlight || !['downloaded', 'scheduled'].includes(state.status)) return snapshot();
    // A person pressed Install: stop any countdown and use the normal confirmed flow.
    installInFlight = true;
    stopAutoInstall();
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
        change('scheduled', 'Update scheduled: it installs automatically when ' + waitPhrase(reason) + '. The device reconnects after restart.');
        startSchedule(busyReason, false);
        return snapshot();
      }
      if (!await confirmInstall(candidate.version, connected)) return snapshot();
      if (busyReason(await getDeviceState())) {
        change('downloaded', 'The console became busy during confirmation. Use Install again to schedule it.');
        return snapshot();
      }
      return await installNow(false);
    } catch (error) {
      await Promise.resolve(abortInstall()).catch(() => {});
      fail(error);
    } finally {
      installInFlight = false;
    }
    return snapshot();
  }

  function cancelScheduled() {
    if (state.status !== 'scheduled') return snapshot();
    stopSchedule();
    change('downloaded', 'Scheduled installation cancelled. The verified update remains ready.');
    return snapshot();
  }

  function cancelAutoInstall() {
    if (state.status === 'scheduled' && scheduledByAuto) {
      stopSchedule();
      change('downloaded', 'Auto-install cancelled. The verified update remains ready; press Install when it suits you.');
      return snapshot();
    }
    if (state.status !== 'downloaded' || !autoInstallTimer) return snapshot();
    stopAutoInstall();
    change('downloaded', 'Auto-install cancelled. The verified update remains ready; press Install when it suits you.');
    return snapshot();
  }

  function setAutoUpdate(enabled) {
    autoUpdate = enabled === true;
    if (!autoUpdate) {
      stopAutoInstall();
      if (state.status === 'scheduled' && scheduledByAuto) {
        stopSchedule();
        change('downloaded', 'Auto-update turned off. The verified update remains ready; press Install when it suits you.', { autoUpdate });
        return snapshot();
      }
    }
    change(state.status, state.message, { autoUpdate });
    if (autoUpdate && !portable && state.status === 'available') download();
    else if (autoUpdate && !portable && state.status === 'downloaded') armAutoInstall();
    return snapshot();
  }

  return { snapshot, check, download, install, cancelScheduled, cancelAutoInstall, setAutoUpdate };
}

module.exports = { FEED, AUTO_IDLE_MS, installerUrl, validateUpdate, busyReason, autoBusyReason, createUpdateController };
