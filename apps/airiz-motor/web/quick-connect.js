/* AIRIZ one-button remote (v1.7.0).
 *
 * One code carries everything:
 *   PC with the AIRIZ on USB : "Share this AIRIZ" -> shares motor control (remote-control.js)
 *                              AND the camera (camera-relay.js) under the SAME 6-digit code.
 *   Phone / other PC        : "Connect" + the code -> motor, LEDs, commands, macros, and the
 *                              live camera opens by itself in a floating window.
 * The launcher opens every time the console starts (after the first-run language box),
 * and a large "Remote by code" button stays in the header.
 * The PC operator still presses Allow for every controller (unchanged safety rule).
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const remote = window.AirizRemoteControl;
  const camera = window.AirizCameraRelay;
  if (!api || !remote) return;

  const $ = id => document.getElementById(id);
  const I18N_KEY = 'airiz.i18n.v1';
  const CAMERA_START_TIMEOUT_MS = 12000;
  const NO_VIDEO_HINT_MS = 25000;
  const isDesktopApp = !!window.airizDesktop;
  const phoneLayout = () => document.documentElement.classList.contains('phone-layout');
  const remoteCode = status => {
    const match = /^Remote control \(code (\d{6})\)/.exec(String(status.transportLabel || ''));
    return match ? match[1] : null;
  };
  const toast = text => {
    const notice = $('ui-toast');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      notice.hidden = true;
    }, 9000);
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ------------------------------------------------------------------ header button
  function buildHeaderButton() {
    const host = document.querySelector('.header-meta');
    if (!host || $('qc-open')) return;
    const button = document.createElement('button');
    button.id = 'qc-open';
    button.type = 'button';
    button.className = 'qc-open';
    button.title = 'One code for motor, camera and everything else. No Bluetooth.';
    button.innerHTML = '<span aria-hidden="true" class="qc-open-icon">📱</span><span class="qc-open-text">Remote by code</span>';
    button.addEventListener('click', () => openLauncher(true));
    host.insertBefore(button, host.firstChild);
  }

  // ------------------------------------------------------------------ launcher dialog
  let dialog = null;

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.id = 'qc-dialog';
    dialog.className = 'help-dialog qc-dialog';
    dialog.setAttribute('aria-labelledby', 'qc-title');
    dialog.innerHTML = ''
      + '<h2 id="qc-title">Remote control by code</h2>'
      + '<p class="qc-sub">One code connects everything: motor, LEDs, commands, macros and the live camera. No Bluetooth.</p>'
      + '<section class="qc-option qc-join">'
      + '<h3><span aria-hidden="true">📱</span> Connect to an AIRIZ</h3>'
      + '<p>Type the 6-digit code shown on the AIRIZ PC.</p>'
      + '<div class="qc-row"><input aria-label="6-digit code" autocomplete="one-time-code" class="input qc-code" enterkeyhint="go" '
      + 'id="qc-code" inputmode="numeric" maxlength="6" pattern="[0-9]*" placeholder="123456">'
      + '<button class="btn btn-primary qc-big" id="qc-join" type="button">Connect</button></div>'
      + '<p class="qc-status" id="qc-join-status" role="status"></p>'
      + '</section>'
      + '<section class="qc-option qc-host" id="qc-host">'
      + '<h3><span aria-hidden="true">💻</span> This PC has the AIRIZ (USB)</h3>'
      + '<p>Share the motor and the camera with one code. You press Allow for each phone.</p>'
      + '<button class="btn btn-secondary qc-big" id="qc-share" type="button">Share this AIRIZ</button>'
      + '<p class="qc-status" id="qc-share-status" role="status"></p>'
      + '</section>'
      + '<div class="qc-foot"><button class="btn btn-secondary" id="qc-close" type="button">Not now</button></div>';
    document.body.append(dialog);

    const input = $('qc-code');
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value !== digits) input.value = digits;
      if (digits.length === 6) join();
      else joinStatus('');
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') join();
    });
    $('qc-join').addEventListener('click', join);
    $('qc-share').addEventListener('click', share);
    $('qc-close').addEventListener('click', () => dialog.close());
    return dialog;
  }

  function joinStatus(text) {
    $('qc-join-status').textContent = text;
  }

  function shareStatus(text) {
    $('qc-share-status').textContent = text;
  }

  function openLauncher(fromButton) {
    const box = dialog || buildDialog();
    const status = api.getStatus();
    const hostSection = $('qc-host');
    // Phones cannot hold the AIRIZ on USB; they only connect.
    hostSection.hidden = phoneLayout() && !isDesktopApp;
    const code = remoteCode(status);
    if (code) {
      $('qc-code').value = code;
      joinStatus('Connected. You are controlling the AIRIZ (motor + camera).');
      $('qc-join').textContent = 'Disconnect';
    } else {
      $('qc-join').textContent = 'Connect';
      if (!fromButton) joinStatus('');
    }
    if (remote.hostCode) shareStatus('Sharing with code ' + remote.hostCode + '.');
    if (!box.open) box.showModal();
    if (!code) setTimeout(() => $('qc-code').focus(), 50);
  }

  // ------------------------------------------------------------------ phone: connect
  async function join() {
    const status = api.getStatus();
    if (remoteCode(status)) {
      const disconnect = $('btn-disconnect');
      if (disconnect && !disconnect.disabled) disconnect.click();
      $('qc-join').textContent = 'Connect';
      joinStatus('Disconnected.');
      return;
    }
    const code = $('qc-code').value.replace(/\D/g, '');
    const connected = await remote.connectWithCode(code, {
      status: joinStatus,
      busy: flag => {
        $('qc-join').disabled = flag;
        $('qc-code').disabled = flag;
      },
    });
    if (!connected) return;
    joinStatus('Connected: motor, LEDs, commands and macros. Opening the camera…');
    startCameraFor(code);
    setTimeout(() => {
      if (dialog && dialog.open) dialog.close();
    }, 1400);
  }

  // ------------------------------------------------------------------ PC: share everything
  async function waitFor(check, timeoutMs, stepMs = 300) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (check()) return true;
      await sleep(stepMs);
    }
    return check();
  }

  async function ensureCameraStream() {
    if (api.getCameraStream()) return true;
    const start = $('btn-camera-start');
    if (!start || start.disabled) return false;
    start.click();
    return waitFor(() => !!api.getCameraStream(), CAMERA_START_TIMEOUT_MS);
  }

  let cameraSharedByUs = null; // code we shared the camera with

  async function shareCameraWith(code) {
    if (!camera || !code) return false;
    if (camera.shareCode && camera.shareCode !== code && cameraSharedByUs !== camera.shareCode) {
      return true; // the operator shares the camera separately; leave it alone
    }
    if (!(await ensureCameraStream())) return false;
    if (remote.hostCode !== code) return false; // sharing stopped meanwhile
    const ok = camera.shareWithCode(code);
    if (ok) cameraSharedByUs = code;
    return ok;
  }

  async function share() {
    const button = $('qc-share');
    button.disabled = true;
    try {
      let status = api.getStatus();
      if (remoteCode(status)) {
        shareStatus('This console is itself remote-controlled. Share from the PC that has the USB cable.');
        return;
      }
      if (!status.connected) {
        shareStatus('Choose the AIRIZ port…');
        const connect = $('btn-connect');
        if (connect && !connect.disabled) connect.click();
        const ok = await waitFor(() => api.getStatus().connected, 90000, 400);
        if (!ok) {
          shareStatus('Connect the AIRIZ by USB first (or press Try demo to test), then press Share again.');
          return;
        }
      }
      status = api.getStatus();
      const code = remote.hostCode || remote.shareStart();
      if (!code) {
        shareStatus('Could not start sharing. Use Share control in Device connection.');
        return;
      }
      shareStatus('Sharing motor control with code ' + code + '. Starting the camera…');
      const cameraOk = await shareCameraWith(code);
      shareStatus(cameraOk
        ? 'Sharing motor + camera with code ' + code + '.'
        : 'Sharing motor control with code ' + code + '. No AIRIZ camera preview, so the camera is not shared.');
      dialog.close();
      remote.openShareDialog(); // shows the big code, the link and the Allow requests
    } finally {
      button.disabled = false;
    }
  }

  // Share control from anywhere (also the old Share control button) shares the camera too.
  document.addEventListener('airiz:share-code', event => {
    const detail = event.detail || {};
    if (detail.kind !== 'control') return;
    if (detail.code) {
      shareCameraWith(detail.code).then(ok => {
        if (ok) toast('The camera is shared with the same code ' + detail.code + '.');
      });
    } else if (camera && cameraSharedByUs && camera.shareCode === cameraSharedByUs) {
      camera.stopShare();
      cameraSharedByUs = null;
    }
  });

  // ------------------------------------------------------------------ floating camera window
  const panel = { root: null, video: null, image: null, note: null, code: null, since: 0, hidden: false };

  function buildPanel() {
    const root = document.createElement('aside');
    root.id = 'qc-camera';
    root.className = 'qc-camera';
    root.hidden = true;
    root.setAttribute('aria-label', 'AIRIZ camera');
    root.innerHTML = ''
      + '<div class="qc-camera-bar"><strong>AIRIZ camera</strong>'
      + '<span class="qc-camera-live" id="qc-camera-live">connecting…</span>'
      + '<button aria-label="Bigger or smaller" class="qc-camera-btn" id="qc-camera-size" type="button">⤢</button>'
      + '<button aria-label="Hide camera" class="qc-camera-btn" id="qc-camera-hide" type="button">✕</button></div>'
      + '<div class="qc-camera-view"><video autoplay id="qc-camera-video" muted playsinline></video>'
      + '<img alt="AIRIZ camera" hidden id="qc-camera-image"><p class="qc-camera-note" id="qc-camera-note"></p></div>';
    document.body.append(root);
    const pill = document.createElement('button');
    pill.id = 'qc-camera-pill';
    pill.type = 'button';
    pill.className = 'qc-camera-pill';
    pill.hidden = true;
    pill.textContent = '📷 Show camera';
    document.body.append(pill);
    panel.root = root;
    panel.pill = pill;
    panel.video = $('qc-camera-video');
    panel.image = $('qc-camera-image');
    panel.note = $('qc-camera-note');
    $('qc-camera-size').addEventListener('click', () => root.classList.toggle('is-large'));
    $('qc-camera-hide').addEventListener('click', () => {
      panel.hidden = true;
      root.hidden = true;
      pill.hidden = false;
    });
    pill.addEventListener('click', () => {
      panel.hidden = false;
      root.hidden = false;
      pill.hidden = true;
    });
  }

  function startCameraFor(code) {
    if (!camera) return;
    if (!panel.root) buildPanel();
    if (panel.code === code && camera.watching) return;
    panel.code = code;
    panel.since = Date.now();
    panel.hidden = false;
    panel.root.hidden = false;
    panel.pill.hidden = true;
    panel.note.textContent = 'Connecting to the camera…';
    camera.watch(code);
  }

  function stopCamera() {
    if (!panel.root || !panel.code) return;
    panel.code = null;
    if (camera) camera.stopWatch();
    panel.video.srcObject = null;
    panel.image.removeAttribute('src');
    panel.root.hidden = true;
    panel.pill.hidden = true;
  }

  // Mirror the camera-relay viewer (full WebRTC video, or relay JPEG frames) into the window.
  function mirror() {
    if (!panel.root || !panel.code || !camera) return;
    const source = camera.video;
    const frames = camera.image;
    const live = document.getElementById('qc-camera-live');
    if (source && source.srcObject) {
      if (panel.video.srcObject !== source.srcObject) {
        panel.video.srcObject = source.srcObject;
        panel.video.play().catch(() => {});
      }
      panel.video.hidden = false;
      panel.image.hidden = true;
      panel.note.textContent = '';
      live.textContent = 'live';
      live.classList.add('is-live');
    } else if (frames && frames.getAttribute('src')) {
      if (panel.image.getAttribute('src') !== frames.getAttribute('src')) panel.image.src = frames.getAttribute('src');
      panel.image.hidden = false;
      panel.video.hidden = true;
      panel.note.textContent = '';
      live.textContent = 'live (relay)';
      live.classList.add('is-live');
    } else {
      live.textContent = 'connecting…';
      live.classList.remove('is-live');
      if (Date.now() - panel.since > NO_VIDEO_HINT_MS) {
        panel.note.textContent = 'No camera picture yet. On the AIRIZ PC open Camera → Start Preview; '
          + 'it is shared automatically with the same code.';
      } else {
        panel.note.textContent = camera.status || 'Connecting to the camera…';
      }
    }
  }

  // Any remote-control connection (launcher, Control by code box, old dialog, link) opens the camera.
  let lastRemoteCode = null;
  function watchConnection() {
    const code = remoteCode(api.getStatus());
    if (code && code !== lastRemoteCode) startCameraFor(code);
    if (!code && lastRemoteCode) stopCamera();
    lastRemoteCode = code;
    mirror();
  }

  // ------------------------------------------------------------------ start-up
  function anyDialogOpen() {
    return [...document.querySelectorAll('dialog')].some(item => item.open);
  }

  function languageSettled() {
    try {
      return !!localStorage.getItem(I18N_KEY);
    } catch (error) {
      return true;
    }
  }

  function showAtStartup() {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.AirizDeepLink) { // opened from a share link: it connects by itself
        clearInterval(timer);
        return;
      }
      if (api.getStatus().connected) { // e.g. reconnected after an update restart
        clearInterval(timer);
        return;
      }
      if (Date.now() - started > 10 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      if (!languageSettled() || anyDialogOpen()) return;
      clearInterval(timer);
      openLauncher(false);
    }, 300);
  }

  buildHeaderButton();
  setInterval(watchConnection, 700);
  setTimeout(showAtStartup, 900);

  window.AirizQuickConnect = Object.freeze({ open: () => openLauncher(true) });
})();
