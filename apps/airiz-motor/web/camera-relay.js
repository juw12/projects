/* AIRIZ phone camera viewer.
 *
 * The AIRIZ camera reaches the PC as a USB webcam. A phone (Bluefy/iPhone or Android)
 * cannot open it directly, so the PC relays it:
 *   PC  : Camera → Start Preview (AIRIZ camera) → "Share to phone" → shows a 6-digit code
 *   Phone: Camera → enter the code → "Watch"
 * Video goes PC → phone over WebRTC (direct, or via the PeerJS TURN relay when networks
 * block direct links). The free PeerJS cloud server only introduces the two peers.
 * When a network blocks WebRTC completely (company firewalls), the AIRIZ frame relay
 * (camera-frame-relay.js, Cloudflare Worker over HTTPS) carries JPEG snapshots instead.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const PeerLib = window.Peer;
  const FrameRelay = window.AirizFrameRelay;
  const $ = id => document.getElementById(id);
  const PEER_PREFIX = 'airiz-cam-';
  const MAX_SEND_HEIGHT = 720;
  const MAX_SEND_BITRATE = 1500000;
  const CONNECT_TIMEOUT_MS = 20000;
  const PUBLIC_WATCH_URL = 'https://juw12.github.io/projects/airiz-motor/watch.html';

  const els = {
    section: $('camera-relay'),
    share: $('btn-relay-share'),
    stopShare: $('btn-relay-stop'),
    code: $('relay-share-code'),
    viewers: $('relay-viewers'),
    viewCode: $('relay-view-code'),
    watch: $('btn-relay-view'),
    stopWatch: $('btn-relay-view-stop'),
    video: $('relay-remote-video'),
    relayImage: $('relay-remote-image'),
    linkRow: $('relay-link-row'),
    link: $('relay-share-link'),
    copy: $('btn-relay-copy'),
    nativeShare: $('btn-relay-native-share'),
    status: $('relay-status')
  };
  if (!els.section) return;

  const setStatus = text => {
    els.status.textContent = text;
  };

  if (!PeerLib || !api || typeof api.getCameraStream !== 'function') {
    setStatus('Phone viewer is unavailable in this browser.');
    els.share.disabled = true;
    els.watch.disabled = true;
    return;
  }

  // ------------------------------------------------------------------ PC: share
  const sharer = { peer: null, code: null, calls: new Set(), connections: new Set(), relay: null, relayViewers: 0 };

  function randomCode() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return String(value[0] % 1000000).padStart(6, '0');
  }

  // Link people can open to watch (view only). The desktop app runs from airiz://,
  // so it always hands out the public website address.
  function watchLink(code) {
    const base = /^https?:$/.test(location.protocol) ? new URL('watch.html', location.href).href : PUBLIC_WATCH_URL;
    return base + '#' + code;
  }

  async function copyLink() {
    const text = els.link.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      els.link.select();
      document.execCommand('copy');
    }
    setStatus('Link copied. Anyone with it can watch while sharing is on (view only).');
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: 'AIRIZ camera (live)', text: 'Live AIRIZ camera view', url: els.link.value });
    } catch (error) { /* User closed the share sheet */ }
  }

  function updateViewerCount() {
    const count = sharer.calls.size + sharer.relayViewers;
    els.viewers.textContent = sharer.code && els.code.textContent
      ? (count ? `${count} watching` : 'Waiting for viewers…')
      : '';
  }

  // Code is live: show it, the link, and start the HTTPS frame relay for phones whose
  // WebRTC path is blocked. The relay only encodes frames while someone watches through it.
  function publishCode(code) {
    els.code.textContent = code;
    els.link.value = watchLink(code);
    els.linkRow.hidden = false;
    els.nativeShare.hidden = typeof navigator.share !== 'function';
    els.stopShare.disabled = false;
    if (FrameRelay && !sharer.relay) {
      sharer.relay = FrameRelay.startSender(code, api.getCameraStream, count => {
        sharer.relayViewers = count;
        updateViewerCount();
      });
    }
    updateViewerCount();
  }

  async function limitSender(call) {
    const pc = call.peerConnection;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      const height = sender.track.getSettings().height || MAX_SEND_HEIGHT;
      const params = sender.getParameters();
      params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = MAX_SEND_BITRATE;
      params.encodings[0].scaleResolutionDownBy = Math.max(1, height / MAX_SEND_HEIGHT);
      try {
        await sender.setParameters(params);
      } catch (error) { /* Some browsers refuse before negotiation finishes */ }
    }
  }

  function startSharing(attempt = 0) {
    const stream = api.getCameraStream();
    if (!stream) {
      setStatus('Start Preview with the AIRIZ camera first, then Share to phone.');
      return;
    }
    stopSharing(true);
    const code = randomCode();
    const peer = new PeerLib(PEER_PREFIX + code, { debug: 0 });
    sharer.peer = peer;
    sharer.code = code;
    els.share.disabled = true;
    setStatus('Creating share code…');

    peer.on('open', () => {
      publishCode(code);
      setStatus('Send the link, or enter the code on the phone (Camera → Watch). Keep this window open while sharing.');
    });
    peer.on('connection', connection => {
      sharer.connections.add(connection);
      connection.on('open', () => {
        const current = api.getCameraStream();
        if (!current) {
          connection.send({ type: 'error', message: 'The PC camera preview is stopped.' });
          return;
        }
        const call = peer.call(connection.peer, current);
        sharer.calls.add(call);
        updateViewerCount();
        call.on('stream', () => {});
        setTimeout(() => limitSender(call), 1500);
        const drop = () => {
          sharer.calls.delete(call);
          updateViewerCount();
        };
        call.on('close', drop);
        call.on('error', drop);
      });
      connection.on('close', () => sharer.connections.delete(connection));
    });
    peer.on('error', error => {
      if (sharer.peer !== peer) return;
      if (error.type === 'unavailable-id' && attempt < 3) {
        startSharing(attempt + 1);
        return;
      }
      const reason = error.type || error.message || error;
      if (sharer.relay) return; // already sharing; the relay keeps phones served
      if (FrameRelay && error.type !== 'unavailable-id') {
        // The PeerJS server is unreachable or a call failed: keep sharing through the AIRIZ relay.
        publishCode(code);
        setStatus('Sharing through the AIRIZ relay (direct path unavailable: ' + reason + '). '
          + 'Send the link, or enter the code on the phone. Keep this window open while sharing.');
        return;
      }
      setStatus('Share failed: ' + reason);
      stopSharing(true);
    });
    peer.on('disconnected', () => {
      if (sharer.peer === peer && !peer.destroyed) peer.reconnect();
    });
  }

  function stopSharing(quiet) {
    for (const call of sharer.calls) call.close();
    for (const connection of sharer.connections) connection.close();
    sharer.calls.clear();
    sharer.connections.clear();
    if (sharer.peer) sharer.peer.destroy();
    if (sharer.relay) sharer.relay.stop();
    sharer.peer = null;
    sharer.relay = null;
    sharer.relayViewers = 0;
    sharer.code = null;
    els.code.textContent = '';
    els.link.value = '';
    els.linkRow.hidden = true;
    els.share.disabled = false;
    els.stopShare.disabled = true;
    updateViewerCount();
    if (!quiet) setStatus('Sharing stopped.');
  }

  // Stop sharing when the PC preview stops.
  setInterval(() => {
    if (sharer.code && !api.getCameraStream()) {
      stopSharing(true);
      setStatus('Sharing stopped because the camera preview stopped.');
    }
  }, 2000);

  // --------------------------------------------------------------- phone: watch
  // WebRTC (full video) and the AIRIZ frame relay (JPEG snapshots over HTTPS) start
  // together; relay frames are shown until WebRTC video arrives, or for the whole session
  // when a firewall blocks WebRTC.
  const viewer = { peer: null, call: null, relay: null, timer: null, session: 0 };
  const RELAY_STATUS_GRACE_MS = 4000;

  const NETWORK_HINT = 'The PC’s network is blocking the video (company firewall). Update the AIRIZ console on the PC to the latest version, or put the phone and the PC on the same Wi-Fi, then try again.';

  function showRemote(mode) {
    els.video.hidden = mode !== 'video';
    if (els.relayImage) els.relayImage.hidden = mode !== 'relay';
  }

  function closeViewerRelay() {
    if (viewer.relay) viewer.relay.close();
    viewer.relay = null;
    if (els.relayImage) els.relayImage.removeAttribute('src');
  }

  function startWatching() {
    const code = (els.viewCode.value || '').replace(/\D/g, '');
    if (code.length !== 6) {
      setStatus('Enter the 6-digit code shown on the PC.');
      return;
    }
    stopWatching(true);
    const session = viewer.session;
    const isCurrent = () => viewer.session === session;
    els.watch.disabled = true;
    els.stopWatch.disabled = false;
    setStatus('Connecting to the PC…');

    let reachedPc = false;
    let relayFrames = 0;
    let relayPc = null; // null = not known yet
    let peerUnavailable = false;
    const live = () => !!els.video.srcObject || relayFrames > 0;
    const fail = message => {
      if (!isCurrent()) return;
      stopWatching(true);
      setStatus(message);
    };
    const checkNotActive = () => {
      if (!isCurrent() || live()) return;
      const relayGone = relayPc === false || !FrameRelay || !els.relayImage;
      if (peerUnavailable && relayGone) fail('No PC is sharing with that code.');
    };

    viewer.timer = setTimeout(() => {
      if (!isCurrent() || live()) return;
      setStatus(reachedPc || relayPc
        ? 'Found the PC, but no video gets through. ' + NETWORK_HINT
        : 'No video yet. Check the code and that the PC is still sharing. ' + NETWORK_HINT);
    }, CONNECT_TIMEOUT_MS);

    if (FrameRelay && els.relayImage) {
      viewer.relay = FrameRelay.watch(code, {
        onFrame(url) {
          if (!isCurrent() || els.video.srcObject) return;
          relayFrames += 1;
          els.relayImage.src = url;
          if (relayFrames === 1) {
            clearTimeout(viewer.timer);
            showRemote('relay');
            setStatus('Showing the AIRIZ camera from the PC through the AIRIZ relay.');
          }
        },
        onStatus(pcPresent) {
          relayPc = pcPresent;
          if (pcPresent && !live()) setStatus('PC found. Starting video…');
          checkNotActive();
        },
        onEnded() {
          fail('The PC stopped sharing.');
        },
        onClose() {
          if (!isCurrent()) return;
          viewer.relay = null;
          if (relayFrames > 0 && !els.video.srcObject) fail('The connection to the PC was lost.');
        },
      });
    }

    // A WebRTC path could not be opened (typically a company firewall).
    const watchIce = pc => {
      if (!pc) return;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState !== 'failed' || !isCurrent() || live() || relayPc) return;
        clearTimeout(viewer.timer);
        setStatus('Could not open a video connection to the PC. ' + NETWORK_HINT);
      });
    };

    const peer = new PeerLib({ debug: 0 });
    viewer.peer = peer;
    peer.on('open', () => {
      const connection = peer.connect(PEER_PREFIX + code, { reliable: true });
      connection.on('data', message => {
        if (message && message.type === 'error' && isCurrent()) setStatus(message.message);
      });
      watchIce(connection.peerConnection);
    });
    peer.on('call', call => {
      viewer.call = call;
      reachedPc = true; // the PC answered through the signalling server
      if (!live()) setStatus('PC found. Starting video…');
      call.answer();
      watchIce(call.peerConnection);
      call.on('stream', remote => {
        if (!isCurrent()) return;
        els.video.srcObject = remote;
        closeViewerRelay(); // full-quality video is here; stop pulling JPEG frames
        showRemote('video');
        els.video.play().catch(() => {});
        clearTimeout(viewer.timer);
        setStatus('Showing the AIRIZ camera from the PC.');
      });
      call.on('close', () => {
        if (isCurrent() && els.video.srcObject) fail('The PC stopped sharing.');
      });
    });
    peer.on('error', error => {
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
      if (viewer.relay) return; // keep the relay path running
      fail('Viewer error: ' + (error.type || error.message || error));
    });
  }

  function stopWatching(quiet) {
    viewer.session += 1;
    clearTimeout(viewer.timer);
    if (viewer.call) viewer.call.close();
    if (viewer.peer) viewer.peer.destroy();
    closeViewerRelay();
    viewer.call = null;
    viewer.peer = null;
    els.video.srcObject = null;
    showRemote(null);
    els.watch.disabled = false;
    els.stopWatch.disabled = true;
    if (!quiet) setStatus('Stopped watching.');
  }

  els.share.addEventListener('click', () => startSharing());
  els.copy.addEventListener('click', copyLink);
  els.nativeShare.addEventListener('click', nativeShare);
  els.stopShare.addEventListener('click', () => stopSharing(false));
  els.watch.addEventListener('click', startWatching);
  els.stopWatch.addEventListener('click', () => stopWatching(false));
  els.viewCode.addEventListener('keydown', event => {
    if (event.key === 'Enter') startWatching();
  });
  window.addEventListener('pagehide', () => {
    stopSharing(true);
    stopWatching(true);
  });

  // On phones the local camera list only shows the phone's own cameras, so the viewer
  // goes straight under the page title (above the download banners and the connection
  // card) whenever the Camera workspace is open, and the PC-only share controls are hidden.
  const userAgent = navigator.userAgent;
  const touchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1; // iPad "desktop" mode
  const smallTouchScreen = window.matchMedia
    && window.matchMedia('(pointer: coarse)').matches
    && Math.min(window.screen.width, window.screen.height) < 900;
  const phone = /iPhone|iPad|iPod|Android/i.test(userAgent) || touchMac || smallTouchScreen || !!window.airizMobile;
  if (phone && !window.airizDesktop) {
    els.section.classList.add('camera-relay-phone');
    const shareRow = els.share.closest('.camera-relay-row');
    if (shareRow) shareRow.hidden = true;
    els.linkRow.hidden = true;
    const hint = els.section.querySelector('.camera-relay-hint');
    if (hint) {
      hint.textContent = 'Watch the AIRIZ camera here. On the PC: Camera \u2192 Start Preview \u2192 Share to phone, '
        + 'then enter the 6-digit code below (or just open the link the PC shares).';
    }
    const intro = document.querySelector('.page-intro');
    const cameraView = $('view-camera');
    if (intro && cameraView) {
      intro.after(els.section);
      const syncVisibility = () => {
        els.section.hidden = cameraView.hidden;
      };
      syncVisibility();
      new MutationObserver(syncVisibility).observe(cameraView, { attributes: true, attributeFilter: ['hidden'] });
    } else {
      const panel = $('camera-panel-content');
      if (panel) panel.prepend(els.section);
    }
    setStatus('');
  }
})();
