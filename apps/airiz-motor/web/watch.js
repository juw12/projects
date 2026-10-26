/* AIRIZ shared camera viewer (watch.html#123456).
 * Opens the live AIRIZ camera that a PC console is sharing (see camera-relay.js).
 * View only: this page cannot send any device command.
 */
(function () {
  'use strict';

  const PEER_PREFIX = 'airiz-cam-';
  const NO_VIDEO_MS = 20000;
  const $ = id => document.getElementById(id);
  const video = $('video');
  const form = $('code-form');
  const codeInput = $('code');
  const retry = $('btn-retry');
  const fullscreen = $('btn-fullscreen');
  const badge = $('live-badge');
  let peer = null;
  let timer = null;

  const status = text => {
    $('status').textContent = text;
  };

  function codeFromUrl() {
    const raw = (location.hash || '').replace('#', '') || new URLSearchParams(location.search).get('code') || '';
    const code = raw.replace(/\D/g, '');
    return code.length === 6 ? code : null;
  }

  function showVideo(on) {
    video.hidden = !on;
    badge.classList.toggle('on', on);
    fullscreen.hidden = !on;
  }

  function stop() {
    clearTimeout(timer);
    if (peer) peer.destroy();
    peer = null;
    video.srcObject = null;
    showVideo(false);
  }

  function watch(code) {
    stop();
    form.hidden = true;
    retry.hidden = true;
    if (!window.Peer) {
      status('This browser cannot open the live view.');
      return;
    }
    status('Connecting to the AIRIZ console…');
    peer = new window.Peer({ debug: 0 });
    const current = peer;
    timer = setTimeout(() => {
      if (!video.srcObject) {
        status('No video yet. The PC may have stopped sharing, or the network blocks the stream.');
        retry.hidden = false;
      }
    }, NO_VIDEO_MS);

    current.on('open', () => {
      const connection = current.connect(PEER_PREFIX + code, { reliable: true });
      connection.on('data', message => {
        if (message && message.type === 'error') status(message.message);
      });
    });
    current.on('call', call => {
      call.answer();
      call.on('stream', remote => {
        video.srcObject = remote;
        showVideo(true);
        video.play().catch(() => {});
        clearTimeout(timer);
        status('Live from the AIRIZ console (view only).');
      });
      call.on('close', () => {
        if (peer !== current) return;
        stop();
        status('The PC stopped sharing.');
        retry.hidden = false;
      });
    });
    current.on('error', error => {
      if (peer !== current) return;
      stop();
      status(error.type === 'peer-unavailable'
        ? 'This share link is not active. Ask for a new link.'
        : 'Could not connect (' + (error.type || error.message || error) + ').');
      retry.hidden = false;
    });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const code = codeInput.value.replace(/\D/g, '');
    if (code.length !== 6) {
      status('Enter the 6-digit code.');
      return;
    }
    history.replaceState(null, '', '#' + code);
    watch(code);
  });
  retry.addEventListener('click', () => {
    const code = codeFromUrl();
    if (code) watch(code);
  });
  fullscreen.addEventListener('click', () => {
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
  window.addEventListener('hashchange', () => {
    const code = codeFromUrl();
    if (code) watch(code);
  });
  window.addEventListener('pagehide', stop);

  const initial = codeFromUrl();
  if (initial) {
    watch(initial);
  } else {
    status('Enter the share code.');
    form.hidden = false;
    codeInput.focus();
  }
})();
