/* AIRIZ shared camera (PC with the AIRIZ on USB -> phones and other PCs).
 *
 * The AIRIZ camera reaches the PC as a USB webcam. A phone or another PC cannot open it
 * directly, so the PC relays it under the Remote by code / Share control code
 * (quick-connect.js calls AirizCameraRelay.shareWithCode; one code = motor + camera).
 * The device that connects by code watches automatically (quick-connect.js floating window).
 * Video goes PC -> viewer over WebRTC (direct, or via the PeerJS TURN relay when networks
 * block direct links). The free PeerJS cloud server only introduces the two peers.
 * When a network blocks WebRTC completely (company firewalls), the AIRIZ frame relay
 * (camera-frame-relay.js, Cloudflare Worker over HTTPS) carries JPEG snapshots instead.
 *
 * 1.11.16:
 *  - The Camera tab no longer has its own "Phone viewer" card (Remote by code and Share
 *    control already do everything), so this module keeps its video / picture elements
 *    off-screen and quick-connect.js mirrors them.
 *  - PC: the camera is registered under the code for the whole share, also when the preview
 *    is not running yet. Viewers get the picture as soon as Camera -> Start Preview runs, a
 *    restarted preview (new mode, new camera) is swapped into the running calls, and a
 *    stopped preview no longer ends the camera share for good.
 *  - Viewer: keeps reconnecting while it is connected by code (PC not sharing the camera
 *    yet, preview restarted, network drop), instead of giving up after the first try.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const PeerLib = window.Peer;
  const FrameRelay = window.AirizFrameRelay;
  const PEER_PREFIX = 'airiz-cam-';
  const MAX_SEND_HEIGHT = 720;
  const MAX_SEND_BITRATE = 1500000;
  const CONNECT_TIMEOUT_MS = 20000;
  const PEER_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000];
  const HOST_CHECK_MS = 1000;
  const VIEWER_CHECK_MS = 2000;
  const PEER_UNAVAILABLE_RETRY_MS = 5000;
  const RELAY_FRAME_FRESH_MS = 4000;
  const RETRY_WITHOUT_PICTURE_MS = 25000;  // never had a picture in this attempt
  const RETRY_WAITING_PREVIEW_MS = 30000;  // the PC said its preview is stopped
  const RETRY_PICTURE_LOST_MS = 8000;      // had a picture, then it stopped
  const PUBLIC_WATCH_URL = 'https://juw12.github.io/projects/airiz-motor/watch.html';
  const WAITING_FOR_PREVIEW = 'Connected to the AIRIZ PC. Its camera preview is not running yet: '
    + 'the picture appears as soon as Camera \u2192 Start Preview runs on that PC.';
  const NETWORK_HINT = 'The PC\u2019s network is blocking the video (company firewall). Update the AIRIZ console '
    + 'on the PC to the latest version, or put both devices on the same Wi-Fi.';

  if (!PeerLib || !api || typeof api.getCameraStream !== 'function') return;

  // Off-screen viewer elements; quick-connect.js shows them in its floating camera window.
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  const relayImage = document.createElement('img');
  relayImage.alt = 'Live AIRIZ camera from the PC';

  let statusText = '';
  const setStatus = text => {
    statusText = text;
  };

  const deviceLabel = () => (typeof window.AirizDeviceLabel === 'function' ? window.AirizDeviceLabel() : '');
  const cleanLabel = value => String(value || '').replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 40);

  // ------------------------------------------------------------------ PC: share
  const sharer = {
    code: null,
    peer: null,
    peerAttempt: 0,
    peerRetry: null,
    stream: null,              // the preview stream the running calls carry
    connections: new Set(),    // PeerJS data connections from viewers
    calls: new Map(),          // connection -> media call
    labels: new Map(),         // viewer peer id -> device label (sent by the viewer)
    callSince: new Map(),      // media call -> time it started
    relay: null,
    relayViewers: 0,
    relayList: [],             // [{label, since}] from the AIRIZ relay
  };

  function viewerRows() {
    const rows = [];
    for (const [connection, call] of sharer.calls) {
      rows.push({
        label: sharer.labels.get(connection.peer) || 'Viewer',
        path: 'direct video',
        since: sharer.callSince.get(call) || Date.now(),
      });
    }
    for (const item of sharer.relayList) {
      rows.push({ label: cleanLabel(item.label) || 'Viewer', path: 'via AIRIZ relay', since: item.since || Date.now() });
    }
    return rows;
  }

  // Share control (quick-connect.js) shows this in the Motor page share window.
  function hostState() {
    const rows = viewerRows();
    return {
      code: sharer.code,
      preview: !!api.getCameraStream(),
      direct: !!(sharer.peer && sharer.peer.open),
      watching: rows.length,
      viewers: rows,
    };
  }

  let lastHostSignature = '';
  function announceHost(force) {
    const state = hostState();
    const signature = JSON.stringify([state.code, state.preview, state.direct,
      state.viewers.map(row => row.label + row.path)]);
    if (!force && signature === lastHostSignature) return;
    lastHostSignature = signature;
    document.dispatchEvent(new CustomEvent('airiz:camera-share', { detail: state }));
  }

  // Link people can open to watch (view only). The desktop app runs from airiz://,
  // so it always hands out the public website address.
  function watchLink(code) {
    const base = /^https?:$/.test(location.protocol) ? new URL('watch.html', location.href).href : PUBLIC_WATCH_URL;
    return base + '#' + code;
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

  // Send the preview to one viewer. Without a preview the viewer is told to wait and is
  // called by the host check as soon as the preview runs.
  function callViewer(connection) {
    if (!sharer.peer || sharer.peer.destroyed || !connection.open || sharer.calls.has(connection)) return;
    const stream = api.getCameraStream();
    if (!stream) {
      if (!connection.airizToldWaiting) {
        connection.airizToldWaiting = true;
        try {
          connection.send({ type: 'waiting', message: WAITING_FOR_PREVIEW });
        } catch (ignored) { /* closing */ }
      }
      return;
    }
    let call;
    try {
      call = sharer.peer.call(connection.peer, stream);
    } catch (error) {
      return;
    }
    if (!call) return;
    connection.airizToldWaiting = false;
    sharer.calls.set(connection, call);
    sharer.callSince.set(call, Date.now());
    call.on('stream', () => {});
    setTimeout(() => limitSender(call), 1500);
    const drop = () => {
      if (sharer.calls.get(connection) === call) sharer.calls.delete(connection);
      sharer.callSince.delete(call);
      announceHost();
    };
    call.on('close', drop);
    call.on('error', drop);
    announceHost();
  }

  function videoTransceiver(pc) {
    if (!pc || typeof pc.getTransceivers !== 'function') return null;
    return pc.getTransceivers().find(item => {
      if (!item.sender) return false;
      if (item.sender.track) return item.sender.track.kind === 'video';
      return !!(item.receiver && item.receiver.track && item.receiver.track.kind === 'video');
    }) || null;
  }

  // The preview was restarted (new mode or camera): put the new picture into every running
  // call without a new connection; fall back to calling the viewer again.
  async function switchStream(stream) {
    const track = stream.getVideoTracks()[0];
    for (const [connection, call] of [...sharer.calls]) {
      let replaced = false;
      const transceiver = videoTransceiver(call.peerConnection);
      if (transceiver && track) {
        try {
          await transceiver.sender.replaceTrack(track);
          replaced = true;
          limitSender(call);
        } catch (error) { /* call it again below */ }
      }
      if (!replaced) {
        sharer.calls.delete(connection);
        sharer.callSince.delete(call);
        try {
          call.close();
        } catch (ignored) { /* already closed */ }
        callViewer(connection);
      }
    }
  }

  function startRelay(code) {
    if (!FrameRelay || sharer.relay) return;
    sharer.relay = FrameRelay.startSender(code, api.getCameraStream, (count, list) => {
      sharer.relayViewers = count;
      sharer.relayList = list || [];
      announceHost();
    });
  }

  function openPeer() {
    const code = sharer.code;
    if (!code) return;
    clearTimeout(sharer.peerRetry);
    const peer = new PeerLib(PEER_PREFIX + code, { debug: 0 });
    sharer.peer = peer;

    peer.on('open', () => {
      if (sharer.peer !== peer) return;
      sharer.peerAttempt = 0;
      setStatus(api.getCameraStream()
        ? 'The camera is shared with code ' + code + '.'
        : 'The camera is shared with code ' + code + ' as soon as the preview runs.');
      announceHost(true);
    });
    peer.on('connection', connection => {
      sharer.connections.add(connection);
      connection.on('data', message => {
        if (message && message.type === 'hello') {
          sharer.labels.set(connection.peer, cleanLabel(message.label));
          announceHost();
        }
      });
      connection.on('open', () => callViewer(connection));
      connection.on('close', () => {
        sharer.connections.delete(connection);
        const call = sharer.calls.get(connection);
        if (call) {
          sharer.calls.delete(connection);
          sharer.callSince.delete(call);
          try {
            call.close();
          } catch (ignored) { /* already closed */ }
        }
        announceHost();
      });
    });
    peer.on('error', error => {
      if (sharer.peer !== peer) return;
      const type = error && error.type;
      // A call to a viewer that already left: nothing to do.
      if (type === 'peer-unavailable') return;
      // The code is still held by our previous registration (released within seconds), or the
      // PeerJS server is unreachable: retry later. The AIRIZ relay keeps serving meanwhile.
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) {
        schedulePeerRetry(peer, type);
        return;
      }
      setStatus('Camera share problem: ' + (type || error.message || error) + '. Retrying\u2026');
      schedulePeerRetry(peer, type);
    });
    peer.on('disconnected', () => {
      if (sharer.peer !== peer || peer.destroyed) return;
      // 1.9.0: re-register the same code after a short pause (no tight loop while offline).
      clearTimeout(sharer.peerRetry);
      sharer.peerRetry = setTimeout(() => {
        if (sharer.peer === peer && !peer.destroyed && peer.disconnected) {
          try {
            peer.reconnect();
          } catch (ignored) { /* the next wake-up or disconnect tries again */ }
        }
      }, 2000);
      announceHost();
    });
  }

  function schedulePeerRetry(peer, reason) {
    if (sharer.peer !== peer) return;
    sharer.peer = null;
    try {
      peer.destroy();
    } catch (ignored) { /* already gone */ }
    const delay = PEER_RETRY_DELAYS_MS[Math.min(sharer.peerAttempt, PEER_RETRY_DELAYS_MS.length - 1)];
    sharer.peerAttempt += 1;
    if (sharer.relay) {
      setStatus('Sharing the camera through the AIRIZ relay (direct video retrying: ' + (reason || 'unavailable') + ').');
    }
    clearTimeout(sharer.peerRetry);
    sharer.peerRetry = setTimeout(() => {
      if (sharer.code && !sharer.peer) openPeer();
    }, delay);
    announceHost();
  }

  // Register the camera under the share code. Works without a preview: viewers are called
  // as soon as it runs.
  function startSharing(code) {
    stopSharing(true);
    sharer.code = code;
    sharer.stream = api.getCameraStream();
    sharer.peerAttempt = 0;
    setStatus('Sharing the camera with code ' + code + '\u2026');
    // ziris-team.js skips this when it is the Remote by code code (already posted as motor + camera).
    document.dispatchEvent(new CustomEvent('airiz:share-code', { detail: { kind: 'camera', code, link: watchLink(code) } }));
    startRelay(code);
    openPeer();
    announceHost(true);
  }

  function stopSharing(quiet) {
    for (const call of sharer.calls.values()) {
      try {
        call.close();
      } catch (ignored) { /* already closed */ }
    }
    for (const connection of sharer.connections) {
      try {
        connection.close();
      } catch (ignored) { /* already closed */ }
    }
    sharer.calls.clear();
    sharer.connections.clear();
    clearTimeout(sharer.peerRetry);
    if (sharer.peer) sharer.peer.destroy();
    if (sharer.relay) sharer.relay.stop();
    sharer.peer = null;
    sharer.relay = null;
    sharer.relayViewers = 0;
    sharer.relayList = [];
    sharer.labels.clear();
    sharer.callSince.clear();
    sharer.stream = null;
    const endedCode = sharer.code;
    sharer.code = null;
    if (endedCode) document.dispatchEvent(new CustomEvent('airiz:share-code', { detail: { kind: 'camera', code: null } }));
    if (!quiet) setStatus('Camera sharing stopped.');
    announceHost(true);
  }

  // 1.9.0: after sleep or a network change keep sharing with the same code: re-register the
  // PeerJS code and open a fresh relay socket (the old one may be dead but look open).
  function recoverSharing() {
    if (!sharer.code) return;
    if (sharer.relay && typeof sharer.relay.refresh === 'function') sharer.relay.refresh();
    const peer = sharer.peer;
    if (peer && !peer.destroyed && peer.disconnected) {
      clearTimeout(sharer.peerRetry);
      try {
        peer.reconnect();
      } catch (ignored) { /* retried on the next disconnect */ }
    } else if (!peer) {
      openPeer();
    }
  }
  if (window.AirizRemoteSession) window.AirizRemoteSession.onWake(recoverSharing);

  // Follow the preview: new stream -> swap it into the calls; viewers that waited for the
  // preview get called now.
  setInterval(() => {
    if (!sharer.code) return;
    const stream = api.getCameraStream();
    if (stream && stream !== sharer.stream) {
      const hadStream = !!sharer.stream;
      sharer.stream = stream;
      if (hadStream || sharer.calls.size) switchStream(stream);
    } else if (!stream && sharer.stream) {
      sharer.stream = null;
    }
    if (stream) {
      for (const connection of sharer.connections) callViewer(connection);
    }
    announceHost();
  }, HOST_CHECK_MS);

  // --------------------------------------------------------------- viewer: watch
  // WebRTC (full video) and the AIRIZ frame relay (JPEG snapshots over HTTPS) start
  // together; relay frames are shown until WebRTC video arrives, or for the whole session
  // when a firewall blocks WebRTC. While a code is wanted the viewer keeps reconnecting.
  const viewer = {
    code: null,
    session: 0,
    peer: null,
    call: null,
    relay: null,
    timer: null,
    attempts: 0,
    startedAt: 0,
    lastPicture: 0,
    lastRelayFrame: 0,
    hadPicture: false,
    waitingForPreview: false,
  };

  function videoLive() {
    const stream = video.srcObject;
    if (!stream || typeof stream.getVideoTracks !== 'function') return false;
    return stream.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);
  }

  function pictureLive() {
    return videoLive() || (Date.now() - viewer.lastRelayFrame < RELAY_FRAME_FRESH_MS && !!relayImage.getAttribute('src'));
  }

  function closeViewerRelay() {
    if (viewer.relay) viewer.relay.close();
    viewer.relay = null;
    relayImage.removeAttribute('src');
  }

  function closeSession() {
    viewer.session += 1;
    clearTimeout(viewer.timer);
    if (viewer.call) {
      try {
        viewer.call.close();
      } catch (ignored) { /* already closed */ }
    }
    if (viewer.peer) viewer.peer.destroy();
    closeViewerRelay();
    viewer.call = null;
    viewer.peer = null;
    video.srcObject = null;
  }

  function openSession() {
    const code = viewer.code;
    if (!code) return;
    closeSession();
    const session = viewer.session;
    const isCurrent = () => viewer.session === session && viewer.code === code;
    viewer.attempts += 1;
    viewer.startedAt = Date.now();
    viewer.hadPicture = false;
    viewer.waitingForPreview = false;
    if (viewer.attempts === 1) setStatus('Connecting to the camera\u2026');

    let reachedPc = false;
    let relayPc = null; // null = not known yet

    viewer.timer = setTimeout(() => {
      if (!isCurrent() || pictureLive() || viewer.waitingForPreview) return;
      setStatus(reachedPc || relayPc
        ? 'Found the PC, but no video gets through yet. ' + NETWORK_HINT
        : 'Waiting for the AIRIZ PC to share the camera. Check that the PC still shares with this code.');
    }, CONNECT_TIMEOUT_MS);

    if (FrameRelay) {
      viewer.relay = FrameRelay.watch(code, {
        onFrame(url) {
          if (!isCurrent() || videoLive()) return;
          viewer.lastRelayFrame = Date.now();
          const first = !relayImage.getAttribute('src');
          relayImage.src = url;
          if (first) setStatus('Showing the AIRIZ camera through the AIRIZ relay.');
        },
        onStatus(pcPresent) {
          if (!isCurrent()) return;
          relayPc = pcPresent;
          if (pcPresent && !pictureLive() && !viewer.waitingForPreview) setStatus('PC found. Starting video\u2026');
        },
        onEnded() {
          if (!isCurrent()) return;
          setStatus('The PC stopped sharing the camera. Waiting for it to share again\u2026');
        },
        onClose() {
          if (!isCurrent()) return;
          viewer.relay = null;
        },
      });
    }

    // A WebRTC path could not be opened (typically a company firewall).
    const watchIce = pc => {
      if (!pc) return;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState !== 'failed' || !isCurrent() || pictureLive()) return;
        setStatus('Could not open a direct video connection to the PC. ' + NETWORK_HINT);
      });
    };

    const peer = new PeerLib({ debug: 0 });
    viewer.peer = peer;
    let connectRetry = null;
    const connectToPc = () => {
      if (!isCurrent() || peer.destroyed || !peer.open) return;
      const connection = peer.connect(PEER_PREFIX + code, { reliable: true });
      if (!connection) return;
      connection.on('open', () => connection.send({ type: 'hello', label: deviceLabel() }));
      connection.on('data', message => {
        if (!message || !isCurrent()) return;
        if (message.type === 'waiting') {
          reachedPc = true;
          viewer.waitingForPreview = true;
          if (!pictureLive()) setStatus(String(message.message || WAITING_FOR_PREVIEW));
        } else if (message.type === 'error') {
          setStatus(String(message.message || 'The PC could not share the camera.'));
        }
      });
      watchIce(connection.peerConnection);
    };
    peer.on('open', connectToPc);
    peer.on('call', call => {
      if (!isCurrent()) {
        call.close();
        return;
      }
      if (viewer.call && viewer.call !== call) {
        try {
          viewer.call.close();
        } catch (ignored) { /* already closed */ }
      }
      viewer.call = call;
      reachedPc = true; // the PC answered through the signalling server
      viewer.waitingForPreview = false;
      if (!pictureLive()) setStatus('PC found. Starting video\u2026');
      call.answer();
      watchIce(call.peerConnection);
      call.on('stream', remote => {
        if (!isCurrent() || viewer.call !== call) return;
        video.srcObject = remote;
        closeViewerRelay(); // full-quality video is here; stop pulling JPEG frames
        video.play().catch(() => {});
        clearTimeout(viewer.timer);
        setStatus('Showing the AIRIZ camera from the PC.');
      });
      call.on('close', () => {
        if (!isCurrent() || viewer.call !== call) return;
        viewer.call = null;
        video.srcObject = null;
        setStatus('The camera picture stopped on the PC. Reconnecting\u2026');
      });
    });
    peer.on('error', error => {
      if (!isCurrent()) return;
      const type = error && error.type;
      if (type === 'peer-unavailable') {
        // The PC has not registered the camera (yet): ask again in a few seconds.
        if (!pictureLive() && relayPc !== true) {
          setStatus('Waiting for the AIRIZ PC to share the camera\u2026');
        }
        clearTimeout(connectRetry);
        connectRetry = setTimeout(() => {
          if (isCurrent() && !viewer.call) connectToPc();
        }, PEER_UNAVAILABLE_RETRY_MS);
        return;
      }
      if (!viewer.relay && !pictureLive()) {
        setStatus('Camera connection problem (' + (type || error.message || error) + '). Retrying\u2026');
      }
    });
  }

  // Reconnect while a code is wanted and no picture comes through.
  setInterval(() => {
    if (!viewer.code) return;
    const now = Date.now();
    if (pictureLive()) {
      viewer.lastPicture = now;
      viewer.hadPicture = true;
      return;
    }
    let limit = RETRY_WITHOUT_PICTURE_MS;
    if (viewer.waitingForPreview) limit = RETRY_WAITING_PREVIEW_MS;
    if (viewer.hadPicture) limit = RETRY_PICTURE_LOST_MS;
    const since = now - Math.max(viewer.startedAt, viewer.hadPicture ? viewer.lastPicture : 0);
    if (since > limit) openSession();
  }, VIEWER_CHECK_MS);

  function startWatching(code) {
    const digits = String(code || '').replace(/\D/g, '');
    if (digits.length !== 6) {
      setStatus('Enter the 6-digit code shown on the PC.');
      return false;
    }
    if (viewer.code === digits && viewer.peer) return true;
    viewer.code = digits;
    viewer.attempts = 0;
    viewer.lastPicture = 0;
    viewer.lastRelayFrame = 0;
    openSession();
    return true;
  }

  function stopWatching() {
    viewer.code = null;
    closeSession();
    setStatus('');
  }

  // Used by quick-connect.js (one code for motor + camera).
  window.AirizCameraRelay = Object.freeze({
    shareWithCode(code) {
      const digits = String(code || '').replace(/\D/g, '');
      if (digits.length !== 6) return false;
      if (sharer.code === digits) return true;
      startSharing(digits);
      return true;
    },
    stopShare() {
      if (sharer.code) stopSharing(true);
    },
    get shareCode() {
      return sharer.code;
    },
    get hostState() {
      return hostState();
    },
    watch(code) {
      return startWatching(code);
    },
    stopWatch() {
      stopWatching();
    },
    get watching() {
      return !!viewer.code;
    },
    get live() {
      return pictureLive();
    },
    get waitingForPreview() {
      return viewer.waitingForPreview;
    },
    get video() {
      return video;
    },
    get image() {
      return relayImage;
    },
    get status() {
      return statusText;
    },
  });

  window.addEventListener('pagehide', () => {
    stopSharing(true);
    stopWatching();
  });
})();
