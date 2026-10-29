/* AIRIZ camera window (1.11.6).
 *
 * Shows only the AIRIZ camera, in its own window or browser tab, so it can sit on another screen,
 * go full screen or stay on top while the motor console stays where it is.
 *
 * Opened from the console (Camera > Open in new window): it shows the console's own live camera
 * stream - the camera is opened once, the console keeps recording, snapshots and detection - and
 * follows it when the preview is stopped, restarted or switched to another camera.
 * Opened on its own (bookmark, or the console was closed): "Use the camera here" opens the camera
 * directly (the camera the console used last).
 */
(function () {
  'use strict';

  const POLL_MS = 500;
  const IDLE_MS = 2500;
  const LAST_DEVICE_KEY = 'airiz.camera.lastDevice';
  const $ = id => document.getElementById(id);
  const stage = $('cv-stage');
  const video = $('cv-video');
  const message = $('cv-message-text');
  const startConsole = $('cv-start-console');
  const startHere = $('cv-start-here');
  const info = $('cv-info');
  const fitButton = $('cv-fit');
  const pipButton = $('cv-pip');
  const fullButton = $('cv-fullscreen');

  // ------------------------------------------------------------------ language (same setting as the console)
  const dictionary = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('airiz.i18n.v1') || '{}');
      const strings = window.AIRIZ_I18N_STRINGS || {};
      return (strings[saved.language] && strings[saved.language].text) || null;
    } catch (ignored) {
      return null;
    }
  })();
  const t = text => (dictionary && dictionary[text]) || text;
  if (dictionary) {
    document.documentElement.lang = 'zh';
    for (const element of document.querySelectorAll('button, p')) {
      if (element.children.length === 0) element.textContent = t(element.textContent.trim());
      if (element.title) element.title = t(element.title);
    }
    document.title = t(document.title);
    const toolbar = $('cv-toolbar');
    toolbar.setAttribute('aria-label', t(toolbar.getAttribute('aria-label')));
  }

  // ------------------------------------------------------------------ where the picture comes from
  let shown = null;        // the MediaStream on screen
  let own = null;          // a stream this window opened itself (no console)

  function consoleApi() {
    try {
      const opener = window.opener;
      if (!opener || opener.closed) return null;
      return opener.AirizConsole || null;
    } catch (ignored) {
      return null;   // not the console's window
    }
  }

  function show(stream) {
    if (stream === shown) return;
    shown = stream;
    video.srcObject = stream || null;
    stage.classList.toggle('cv-live', !!stream);
    if (stream) video.play().catch(() => {});
    updateInfo();
  }

  function say(text, canStartConsole, canStartHere, detail) {
    message.textContent = t(text) + (detail ? ' (' + detail + ')' : '');
    startConsole.hidden = !canStartConsole;
    startHere.hidden = !canStartHere;
  }

  function stopOwn() {
    if (!own) return;
    for (const track of own.getTracks()) track.stop();
    own = null;
  }

  function tick() {
    const api = consoleApi();
    const fromConsole = api && typeof api.getCameraStream === 'function' ? api.getCameraStream() : null;
    if (fromConsole) {
      stopOwn();   // the console has the camera: one stream for both windows
      show(fromConsole);
      return;
    }
    if (own && own.active) {
      show(own);
      return;
    }
    show(null);
    if (api) {
      say('The camera preview is off in the AIRIZ Console.', typeof api.startCamera === 'function', false);
    } else {
      say('This window is not connected to an AIRIZ Console. Open it from the console (Camera > Open in new window), or use the camera directly here.', false, true);
    }
  }

  startConsole.addEventListener('click', () => {
    const api = consoleApi();
    if (api && typeof api.startCamera === 'function') {
      say('Starting the camera in the AIRIZ Console…', false, false);
      Promise.resolve(api.startCamera()).catch(() => {});
    }
  });

  startHere.addEventListener('click', async () => {
    say('Opening the camera…', false, false);
    let deviceId = '';
    try {
      deviceId = localStorage.getItem(LAST_DEVICE_KEY) || '';
    } catch (ignored) { /* storage blocked */ }
    try {
      own = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { ideal: deviceId } } : true,
        audio: false,
      });
      tick();
    } catch (error) {
      const busy = error && error.name === 'NotReadableError';
      if (busy) {
        say('The camera is busy in another program. Close it there, or open this window from the AIRIZ Console.', false, true);
      } else {
        say('The camera could not be opened here.', false, true, (error && error.name) || 'error');
      }
    }
  });

  // ------------------------------------------------------------------ tools
  function updateInfo() {
    info.textContent = shown && video.videoWidth ? video.videoWidth + '×' + video.videoHeight : '';
  }
  video.addEventListener('loadedmetadata', updateInfo);
  video.addEventListener('resize', updateInfo);

  fitButton.addEventListener('click', () => {
    const fill = !stage.classList.contains('cv-fill');
    stage.classList.toggle('cv-fill', fill);
    fitButton.textContent = t(fill ? 'Fit' : 'Fill');
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  fullButton.addEventListener('click', toggleFullscreen);
  video.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullButton.textContent = t(document.fullscreenElement ? 'Exit full screen' : 'Full screen');
  });

  // "Always on top": the browser's picture-in-picture window floats above every other window.
  pipButton.hidden = !(document.pictureInPictureEnabled && video.requestPictureInPicture);
  pipButton.addEventListener('click', () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else if (shown) video.requestPictureInPicture().catch(() => {});
  });

  // The tools fade out while the mouse rests, like a video player.
  let idleTimer = null;
  function wake() {
    stage.classList.remove('cv-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (shown) stage.classList.add('cv-idle');
    }, IDLE_MS);
  }
  for (const name of ['mousemove', 'mousedown', 'keydown', 'touchstart']) document.addEventListener(name, wake, { passive: true });
  wake();

  window.addEventListener('beforeunload', stopOwn);
  setInterval(tick, POLL_MS);
  tick();

  // Release tests
  window.AirizCameraView = Object.freeze({
    get source() {
      if (!shown) return null;
      return shown === own ? 'own' : 'console';
    },
    get stream() {
      return shown;
    },
  });
})();
