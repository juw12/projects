/* AIRIZ one-button remote (v1.7.0).
 *
 * One code carries everything:
 *   PC with the AIRIZ on USB : "Share this AIRIZ" -> shares motor control (remote-control.js)
 *                              AND the camera (camera-relay.js) under the SAME 6-digit code.
 *   Phone / other PC        : "Connect" + the code -> motor, LEDs, commands, macros, and the
 *                              live camera opens by itself in a floating window.
 * The launcher opens every time the console starts (after the first-run language box),
 * and a large "Remote by code" button stays in the header.
 * The PC operator decides who may control: Allow, or (1.9.0) devices they chose to remember;
 * several phones can control at the same time.
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
      + '<p>Share the motor and the camera with your own code. Several phones can connect; you press Allow or let remembered phones in.</p>'
      // 1.11.18: the owner sets the code like a password; there are no random codes.
      + '<div class="qc-own" id="qc-own">'
      + '<p class="qc-own-note" id="qc-own-note"></p>'
      + '<div class="qc-row" id="qc-own-row"><input aria-label="Your own 6-digit code" autocomplete="off" class="input qc-code" '
      + 'id="qc-own-input" inputmode="numeric" maxlength="6" pattern="[0-9]*" placeholder="Your 6 digits">'
      + '<button class="btn btn-secondary" id="qc-own-save" type="button">Save code</button></div>'
      + '<p class="qc-own-error" hidden id="qc-own-error" role="alert"></p>'
      + '</div>'
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
    const ownInput = $('qc-own-input');
    ownInput.addEventListener('input', () => {
      const digits = ownInput.value.replace(/\D/g, '').slice(0, 6);
      if (ownInput.value !== digits) ownInput.value = digits;
      ownError('');
    });
    ownInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveOwnCode();
      }
    });
    $('qc-own-save').addEventListener('click', saveOwnCode);
    document.addEventListener('airiz:own-code', renderOwnCode);
    return dialog;
  }

  // ------------------------------------------------------------------ the owner's own code
  let ownEditing = false;

  function ownError(text) {
    const error = $('qc-own-error');
    if (!error) return;
    error.textContent = text || '';
    error.hidden = !text;
  }

  function ownReasonText(reason) {
    if (reason === 'easy') {
      return 'That code is too easy to guess, and another AIRIZ owner may pick it too. Try less obvious digits.';
    }
    if (reason === 'storage') return 'This browser could not save the code (storage blocked).';
    return 'Use exactly 6 digits.';
  }

  function renderOwnCode() {
    const note = $('qc-own-note');
    if (!note) return;
    const own = remote.ownCode;
    const row = $('qc-own-row');
    note.replaceChildren();
    if (own && !ownEditing) {
      const value = document.createElement('strong');
      value.className = 'qc-own-value';
      value.textContent = own;
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'qc-own-change';
      change.textContent = 'Change';
      change.addEventListener('click', () => {
        ownEditing = true;
        renderOwnCode();
        $('qc-own-input').focus();
      });
      const label = document.createElement('span');
      label.textContent = 'Your code:';
      note.append(label, document.createTextNode(' '), value, document.createTextNode(' '), change);
      row.hidden = true;
    } else {
      const text = document.createElement('span');
      text.textContent = own
        ? 'Type a new 6-digit code. Phones on the old code are disconnected and need the new one.'
        : 'Choose your own 6-digit code, like a password. Phones type it to connect; it stays the same every time you share.';
      note.append(text);
      row.hidden = false;
      $('qc-own-save').textContent = own ? 'Save new code' : 'Save code';
    }
    const sharing = !!remote.hostCode;
    $('qc-share').textContent = sharing ? 'Manage sharing' : 'Share this AIRIZ';
  }

  function saveOwnCode() {
    const input = $('qc-own-input');
    const result = remote.setOwnCode(input.value);
    if (!result || !result.ok) {
      ownError(ownReasonText(result && result.reason));
      input.focus();
      return false;
    }
    ownError('');
    input.value = '';
    ownEditing = false;
    renderOwnCode();
    shareStatus(remote.hostCode
      ? 'Sharing now uses your new code ' + result.code + '.'
      : 'Saved. Your code ' + result.code + ' is used every time you share.');
    return true;
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
    // Phones usually only connect; an Android phone with the AIRIZ on USB can share too.
    const usbHere = status.connected && !remoteCode(status);
    hostSection.hidden = phoneLayout() && !isDesktopApp && !usbHere;
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
    ownEditing = false;
    ownError('');
    renderOwnCode();
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

  // 1.11.16: the camera is registered under the control code right away, also when the
  // preview cannot start yet; viewers get the picture as soon as Camera -> Start Preview runs.
  // Resolves to true when the preview is running (picture available now).
  function registerCamera(code) {
    if (!camera || !code || remote.hostCode !== code) return false;
    if (camera.shareCode === code) {
      cameraSharedByUs = code;
      return true;
    }
    const ok = camera.shareWithCode(code);
    if (ok) cameraSharedByUs = code;
    return ok;
  }

  async function shareCameraWith(code) {
    if (!registerCamera(code)) return false;
    const preview = await ensureCameraStream();
    return preview && remote.hostCode === code;
  }

  // Keep the camera share tied to the control share: also after a restart that restores
  // sharing, a new own code, or a camera share that ended for any other reason.
  function superviseCameraShare() {
    if (!camera) return;
    const code = remote.hostCode;
    if (code) {
      if (camera.shareCode !== code) registerCamera(code);
    } else if (cameraSharedByUs && camera.shareCode === cameraSharedByUs) {
      camera.stopShare();
      cameraSharedByUs = null;
    }
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
      if (remote.hostCode) {
        dialog.close();
        remote.openShareDialog(); // Allow requests, controllers, remembered devices
        return;
      }
      if (!remote.ownCode) {
        // Typed digits but did not press Save: save them now.
        if (!$('qc-own-input').value || !saveOwnCode()) {
          if (!$('qc-own-input').value) ownError('Set your own 6-digit code first.');
          return;
        }
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
        shareStatus('Could not start sharing. Check your code and that the AIRIZ is connected, then try again.');
        return;
      }
      shareStatus('Sharing motor control with code ' + code + '. Starting the camera…');
      const cameraOk = await shareCameraWith(code);
      shareStatus(cameraOk
        ? 'Sharing motor + camera with code ' + code + '.'
        : 'Sharing motor + camera with code ' + code + '. The camera preview is not running yet: '
          + 'the picture reaches the other devices as soon as Camera → Start Preview runs.');
      dialog.close();
      remote.openShareDialog(); // shows the big code, the link and the Allow requests
    } finally {
      button.disabled = false;
      renderOwnCode();
    }
  }

  // Share control from anywhere (also the old Share control button) shares the camera too.
  document.addEventListener('airiz:share-code', event => {
    const detail = event.detail || {};
    if (detail.kind !== 'control') return;
    if (detail.code) {
      shareCameraWith(detail.code).then(ok => {
        toast(ok
          ? 'The camera is shared with the same code ' + detail.code + '.'
          : 'Code ' + detail.code + ' also carries the camera once Camera → Start Preview runs on this PC.');
      });
    } else if (camera && cameraSharedByUs && camera.shareCode === cameraSharedByUs) {
      camera.stopShare();
      cameraSharedByUs = null;
    }
  });

  // ------------------------------------------------------------------ camera line in Share control
  function renderCameraShareLine() {
    const status = $('share-control-status');
    if (!status || !camera) return;
    let line = $('share-control-camera');
    if (!line) {
      line = document.createElement('div');
      line.id = 'share-control-camera';
      line.className = 'share-control-camera';
      line.setAttribute('aria-live', 'polite');
      line.innerHTML = '<span id="share-control-camera-text"></span>'
        + '<button class="btn btn-sm btn-primary" hidden id="share-control-camera-start" type="button">Start camera preview</button>';
      status.after(line);
      $('share-control-camera-start').addEventListener('click', () => {
        ensureCameraStream();
      });
    }
    const state = camera.hostState;
    const text = $('share-control-camera-text');
    const startButton = $('share-control-camera-start');
    if (!state.code) {
      text.textContent = 'Camera: shared together with the code while sharing is on.';
      startButton.hidden = true;
      return;
    }
    if (!state.preview) {
      text.textContent = 'Camera: shared with code ' + state.code + ', but the preview is not running, so '
        + 'nobody sees a picture yet.';
      startButton.hidden = false;
      return;
    }
    startButton.hidden = true;
    const names = state.viewers.map(row => row.label + ' (' + row.path + ')');
    text.textContent = 'Camera: shared with code ' + state.code + ' · '
      + (names.length ? names.length + ' watching: ' + names.join(', ') : 'nobody watching yet');
  }
  document.addEventListener('airiz:share-dialog', renderCameraShareLine);
  document.addEventListener('airiz:camera-share', renderCameraShareLine);

  // ------------------------------------------------------------------ floating camera window
  const panel = { root: null, video: null, image: null, note: null, code: null, since: 0, hidden: false, full: null };

  function buildPanel() {
    const root = document.createElement('aside');
    root.id = 'qc-camera';
    root.className = 'qc-camera';
    root.hidden = true;
    root.setAttribute('aria-label', 'AIRIZ camera');
    root.innerHTML = ''
      + '<div class="qc-camera-bar"><strong>AIRIZ camera</strong>'
      + '<span class="qc-camera-live" id="qc-camera-live">connecting…</span>'
      + '<button aria-label="Full screen" class="qc-camera-btn" id="qc-camera-full" title="Full screen" type="button">⛶</button>'
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
    // 1.11.14: full screen on phones too (double-tap the picture works as well).
    panel.full = window.AirizFullscreen
      ? window.AirizFullscreen.attach({ container: root.querySelector('.qc-camera-view'), button: $('qc-camera-full'),
        video: panel.video, image: panel.image, iconButton: true })
      : null;
    $('qc-camera-size').addEventListener('click', () => root.classList.toggle('is-large'));
    $('qc-camera-hide').addEventListener('click', () => {
      if (panel.full && panel.full.active) panel.full.exit();
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
    if (panel.full && panel.full.active) panel.full.exit();
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
      const flowing = camera.live;
      panel.note.textContent = flowing ? '' : (camera.status || 'The picture paused on the PC. Reconnecting…');
      live.textContent = flowing ? 'live' : 'paused';
      live.classList.toggle('is-live', flowing);
    } else if (frames && frames.getAttribute('src')) {
      if (panel.image.getAttribute('src') !== frames.getAttribute('src')) panel.image.src = frames.getAttribute('src');
      panel.image.hidden = false;
      panel.video.hidden = true;
      panel.note.textContent = '';
      live.textContent = 'live (relay)';
      live.classList.add('is-live');
    } else {
      panel.video.srcObject = null;
      panel.image.removeAttribute('src');
      live.textContent = camera.waitingForPreview ? 'waiting for PC' : 'connecting…';
      live.classList.remove('is-live');
      if (camera.waitingForPreview) {
        panel.note.textContent = camera.status;
      } else if (Date.now() - panel.since > NO_VIDEO_HINT_MS) {
        panel.note.textContent = (camera.status ? camera.status + ' ' : '')
          + 'On the AIRIZ PC, Camera → Start Preview must be running; it is shared automatically with the same code. '
          + 'This window keeps trying by itself.';
      } else {
        panel.note.textContent = camera.status || 'Connecting to the camera…';
      }
    }
  }

  // Any remote-control connection (launcher, Control by code box, old dialog, link) opens the camera.
  let lastRemoteCode = null;
  function watchConnection() {
    superviseCameraShare();
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

  window.AirizQuickConnect = Object.freeze({
    open: () => openLauncher(true),
    // The floating camera window (built on first use); used by the phone full-screen self-test.
    cameraWindow() {
      if (!panel.root) buildPanel();
      return panel.root;
    }
  });
})();
