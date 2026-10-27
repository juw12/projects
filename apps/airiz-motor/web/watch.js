/* AIRIZ shared camera viewer (watch.html#123456).
 * Opens the live AIRIZ camera that a PC console is sharing (see camera-relay.js).
 * Two paths run side by side:
 *   - WebRTC (PeerJS): full-quality video, works on most home/mobile networks.
 *   - AIRIZ frame relay (camera-frame-relay.js): JPEG snapshots over HTTPS for
 *     networks that block WebRTC (company firewalls). Shown until WebRTC video arrives.
 * View only: this page cannot send any device command.
 */
(function () {
  'use strict';

  const PEER_PREFIX = 'airiz-cam-';
  const NO_VIDEO_MS = 20000;
  const RELAY_STATUS_GRACE_MS = 4000;
  const $ = id => document.getElementById(id);
  const video = $('video');
  const relayImage = $('relay-image');
  const form = $('code-form');
  const codeInput = $('code');
  const retry = $('btn-retry');
  const fullscreen = $('btn-fullscreen');
  const badge = $('live-badge');
  const FrameRelay = window.AirizFrameRelay;
  let peer = null;
  let relay = null;
  let timer = null;
  let session = 0;

  const status = text => {
    $('status').textContent = text;
  };

  function codeFromUrl() {
    const raw = (location.hash || '').replace('#', '') || new URLSearchParams(location.search).get('code') || '';
    const code = raw.replace(/\D/g, '');
    return code.length === 6 ? code : null;
  }

  // mode: 'video' (WebRTC), 'relay' (JPEG frames) or null (nothing to show)
  function show(mode) {
    video.hidden = mode !== 'video';
    relayImage.hidden = mode !== 'relay';
    badge.classList.toggle('on', !!mode);
    fullscreen.hidden = !mode;
  }

  function closeRelay() {
    if (relay) relay.close();
    relay = null;
    relayImage.removeAttribute('src');
  }

  function stop() {
    session += 1;
    clearTimeout(timer);
    if (peer) peer.destroy();
    peer = null;
    closeRelay();
    video.srcObject = null;
    show(null);
  }

  const NETWORK_HINT = 'The PC’s network is blocking the video (company firewall). Update the AIRIZ console on the PC to the latest version, or put the phone and the PC on the same Wi-Fi, then try again.';

  function watch(code) {
    stop();
    const current = session;
    const isCurrent = () => session === current;
    form.hidden = true;
    retry.hidden = true;
    if (!window.Peer && !FrameRelay) {
      status('This browser cannot open the live view.');
      return;
    }
    status('Connecting to the AIRIZ console…');

    let reachedPc = false;
    let relayFrames = 0;
    let relayPc = null; // null = not known yet
    let peerUnavailable = false;
    const live = () => !!video.srcObject || relayFrames > 0;

    const fail = message => {
      if (!isCurrent()) return;
      stop();
      status(message);
      retry.hidden = false;
    };

    // "Not active" only when neither path can find the PC.
    const checkNotActive = () => {
      if (!isCurrent() || live()) return;
      const peerGone = peerUnavailable || !window.Peer;
      const relayGone = relayPc === false || !FrameRelay;
      if (peerGone && relayGone) fail('This share link is not active. Ask for a new link.');
    };

    timer = setTimeout(() => {
      if (!isCurrent() || live()) return;
      status((reachedPc || relayPc ? 'Found the PC, but no video gets through. ' : 'No video yet. The PC may have stopped sharing. ')
        + NETWORK_HINT);
      retry.hidden = false;
    }, NO_VIDEO_MS);

    // ---- relay path
    if (FrameRelay) {
      relay = FrameRelay.watch(code, {
        onFrame(url) {
          if (!isCurrent() || video.srcObject) return;
          relayFrames += 1;
          relayImage.src = url;
          if (relayFrames === 1) {
            clearTimeout(timer);
            retry.hidden = true;
            show('relay');
            status('Live from the AIRIZ console through the AIRIZ relay (view only).');
          }
        },
        onStatus(pcPresent) {
          relayPc = pcPresent;
          if (pcPresent && !live()) {
            status('PC found. Starting video…');
          }
          checkNotActive();
        },
        onEnded() {
          fail('The PC stopped sharing.');
        },
        onClose() {
          if (!isCurrent()) return;
          relay = null;
          if (relayFrames > 0 && !video.srcObject) fail('The connection to the PC was lost.');
        },
      });
    }

    // ---- WebRTC path
    if (!window.Peer) return;
    peer = new window.Peer({ debug: 0 });
    const currentPeer = peer;
    const watchIce = pc => {
      if (!pc) return;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState !== 'failed' || !isCurrent() || live()) return;
        // The relay may still deliver; only report when it cannot.
        if (relayPc) return;
        clearTimeout(timer);
        status('Could not open a video connection to the PC. ' + NETWORK_HINT);
        retry.hidden = false;
      });
    };
    currentPeer.on('open', () => {
      const connection = currentPeer.connect(PEER_PREFIX + code, { reliable: true });
      connection.on('data', message => {
        if (message && message.type === 'error' && isCurrent()) status(message.message);
      });
      watchIce(connection.peerConnection);
    });
    currentPeer.on('call', call => {
      reachedPc = true;
      if (!live()) status('PC found. Starting video…');
      call.answer();
      watchIce(call.peerConnection);
      call.on('stream', remote => {
        if (!isCurrent()) return;
        video.srcObject = remote;
        closeRelay(); // full-quality video is here; stop pulling JPEG frames
        show('video');
        video.play().catch(() => {});
        clearTimeout(timer);
        retry.hidden = true;
        status('Live from the AIRIZ console (view only).');
      });
      call.on('close', () => {
        if (!isCurrent()) return;
        // Only treat this as "stopped" when the WebRTC video was what we were showing.
        if (video.srcObject) fail('The PC stopped sharing.');
      });
    });
    currentPeer.on('error', error => {
      if (!isCurrent()) return;
      if (error.type === 'peer-unavailable') {
        peerUnavailable = true;
        checkNotActive();
        setTimeout(() => {
          if (relayPc === null) relayPc = false;
          checkNotActive();
        }, RELAY_STATUS_GRACE_MS);
        return;
      }
      if (relay) return; // keep the relay path running
      fail('Could not connect (' + (error.type || error.message || error) + ').');
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
    if (!relayImage.hidden) {
      const target = document.querySelector('main');
      if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
      else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
      return;
    }
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
