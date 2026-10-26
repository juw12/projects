/* On-device video optimisation for shorts (free "transcoding" without a server).
 *
 * Large or high-resolution clips are re-encoded in the browser before upload:
 * max 720×1280 (portrait or landscape), ~2.5 Mbit/s, first 60 seconds, audio kept.
 * Output is MP4 (H.264/AAC) where the browser's MediaRecorder supports it, otherwise WebM.
 * Encoding runs in real time (a 30 s clip takes ~30 s) and reports progress.
 */
(function () {
  'use strict';

  const LIMITS = { long: 1280, short: 720, seconds: 60, bitrate: 2500000, skipBelowBytes: 12 * 1024 * 1024 };
  const MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  function supported() {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    return !!(pickMime() && (video.captureStream || video.mozCaptureStream) && canvas.captureStream);
  }

  function loadMeta(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const timer = setTimeout(() => reject(new Error('Could not read this video')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(video);
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('This video format can’t be played in your browser'));
      };
      video.src = url;
    });
  }

  function targetSize(width, height) {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    const scale = Math.min(1, LIMITS.long / longSide, LIMITS.short / shortSide);
    const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
    return { width: even(width), height: even(height), scale };
  }

  function needsWork(file, video) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const { scale } = targetSize(video.videoWidth || 720, video.videoHeight || 1280);
    const friendlyType = ['video/mp4', 'video/webm'].includes(file.type);
    return scale < 1 || duration > LIMITS.seconds + 0.5 || file.size > LIMITS.skipBelowBytes || !friendlyType;
  }

  async function optimize(file, onProgress) {
    if (!file || !file.type.startsWith('video/') || !supported()) return null;
    const url = URL.createObjectURL(file);
    try {
      const probe = await loadMeta(url);
      if (!needsWork(file, probe)) return null;
      const mime = pickMime();
      const size = targetSize(probe.videoWidth || 720, probe.videoHeight || 1280);
      const total = Math.min(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : LIMITS.seconds, LIMITS.seconds);

      const video = document.createElement('video');
      video.src = url;
      video.muted = false;
      video.volume = 0;
      video.playsInline = true;
      video.preload = 'auto';
      await new Promise((resolve, reject) => {
        video.oncanplay = resolve;
        video.onerror = () => reject(new Error('Could not decode this video'));
      });

      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const capture = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      capture.getAudioTracks().forEach((track) => stream.addTrack(track));

      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: LIMITS.bitrate, audioBitsPerSecond: 128000 });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });

      let raf = 0;
      const draw = () => {
        ctx.drawImage(video, 0, 0, size.width, size.height);
        if (onProgress) onProgress(Math.min(0.99, video.currentTime / total));
        if (video.currentTime >= total || video.ended) {
          if (recorder.state === 'recording') recorder.stop();
          video.pause();
          return;
        }
        raf = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
      };
      recorder.start(500);
      await video.play();
      draw();
      video.onended = () => {
        if (recorder.state === 'recording') recorder.stop();
      };
      await stopped;
      if (video.cancelVideoFrameCallback && raf) video.cancelVideoFrameCallback(raf);
      stream.getTracks().forEach((track) => track.stop());
      const type = mime.split(';')[0];
      const blob = new Blob(chunks, { type });
      if (onProgress) onProgress(1);
      if (!blob.size || blob.size >= file.size) return null;
      return { blob, type, width: size.width, height: size.height, duration: Math.round(total * 10) / 10, savedBytes: file.size - blob.size };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.FadeTranscode = { supported, optimize, limits: LIMITS, pickMime };
})();
