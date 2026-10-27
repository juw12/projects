/* AIRIZ camera frame relay (fallback for networks that block WebRTC, e.g. company Wi-Fi).
 *
 * The PC sends JPEG snapshots of the camera preview over an HTTPS WebSocket to the
 * AIRIZ relay worker (apps/airiz-motor/relay); phones receive them the same way.
 * Only runs while at least one phone is watching through the relay.
 */
(function () {
  'use strict';

  const RELAY_ORIGIN = 'wss://airiz-relay.juw12.workers.dev';
  const FRAME_INTERVAL_MS = 200; // about 5 frames per second
  const MAX_WIDTH = 640;
  const JPEG_QUALITY = 0.6;
  const MAX_BUFFERED_BYTES = 1024 * 1024;

  function roomUrl(code, role) {
    return RELAY_ORIGIN + '/v1/room/' + code + '?role=' + role;
  }

  // ----------------------------------------------------------------- PC side
  function startSender(code, getStream, onViewers) {
    let socket = null;
    let viewers = 0;
    let stopped = false;
    let timer = null;
    let reconnectTimer = null;
    let encoding = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    function report(count, list) {
      viewers = count;
      if (typeof onViewers === 'function') onViewers(count, list || []);
      if (count > 0 && !timer) timer = setInterval(sendFrame, FRAME_INTERVAL_MS);
      if (count === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function sendFrame() {
      if (encoding || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return; // slow link: skip this frame
      const stream = getStream();
      if (!stream) return;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
      if (!video.videoWidth) return;
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      encoding = true;
      canvas.toBlob(blob => {
        encoding = false;
        if (blob && socket && socket.readyState === WebSocket.OPEN) socket.send(blob);
      }, 'image/jpeg', JPEG_QUALITY);
    }

    function connect() {
      if (stopped) return;
      try {
        socket = new WebSocket(roomUrl(code, 'pc'));
      } catch (error) {
        return;
      }
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'viewers') {
            // list: [{label, since}] with since converted to this PC's clock.
            const offset = message.now ? Date.now() - message.now : 0;
            const list = (message.list || []).map(item => ({
              label: item.label || '',
              since: item.since ? item.since + offset : Date.now(),
            }));
            report(message.count || 0, list);
          }
        } catch (ignored) { /* not JSON */ }
      });
      socket.addEventListener('close', () => {
        report(0);
        if (!stopped) reconnectTimer = setTimeout(connect, 3000);
      });
    }

    connect();
    return {
      get viewers() {
        return viewers;
      },
      stop() {
        stopped = true;
        clearTimeout(reconnectTimer);
        if (timer) clearInterval(timer);
        timer = null;
        if (socket && socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: 'ended' }));
          } catch (ignored) { /* closing */ }
        }
        if (socket) socket.close();
        socket = null;
        video.srcObject = null;
      },
    };
  }

  // -------------------------------------------------------------- phone side
  // handlers: onFrame(objectUrl), onStatus(pcPresent), onNoPc(), onEnded(), onError(), onClose()
  function watch(code, handlers) {
    let socket = null;
    let closed = false;
    let lastUrl = null;
    try {
      socket = new WebSocket(roomUrl(code, 'viewer'));
    } catch (error) {
      if (handlers.onError) handlers.onError(error);
      return { close() {} };
    }
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      const label = typeof window.AirizDeviceLabel === 'function' ? window.AirizDeviceLabel() : '';
      try {
        socket.send(JSON.stringify({ type: 'hello', label }));
      } catch (ignored) { /* closing */ }
    });
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'status' && handlers.onStatus) handlers.onStatus(!!message.pc);
          if (message.type === 'status' && !message.pc && handlers.onNoPc) handlers.onNoPc();
          if (message.type === 'ended' && handlers.onEnded) handlers.onEnded();
        } catch (ignored) { /* not JSON */ }
        return;
      }
      const url = URL.createObjectURL(new Blob([event.data], { type: 'image/jpeg' }));
      if (handlers.onFrame) handlers.onFrame(url);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
    });
    socket.addEventListener('error', () => {
      if (!closed && handlers.onError) handlers.onError(new Error('relay error'));
    });
    socket.addEventListener('close', () => {
      if (!closed && handlers.onClose) handlers.onClose();
    });
    return {
      close() {
        closed = true;
        if (socket) socket.close();
        socket = null;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = null;
      },
    };
  }

  window.AirizFrameRelay = Object.freeze({ RELAY_ORIGIN, startSender, watch });
})();
