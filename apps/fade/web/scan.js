/* On-device automatic content check (all modes: Fade Network, Fade server, offline demo).
 *
 * Before a short is uploaded, Fade classifies the photo or 3 frames of the video in the browser
 * with NSFWJS (MobileNetV2, ~2.6 MB, vendored under vendor/nsfw/ and loaded only when needed).
 *   porn + hentai >= 0.85            -> blocked, never uploaded
 *   >= 0.5, or "sexy" >= 0.9         -> uploaded but held for a moderator
 * It also computes a 64-bit perceptual hash (dHash) so moderators' removals can block re-uploads.
 * Nothing leaves the device for the check itself.
 */
(function () {
  'use strict';

  const THRESHOLDS = { block: 0.85, review: 0.5, reviewSexy: 0.9 };
  const MODEL_NAME = 'nsfwjs-mobilenetv2';
  const script = document.currentScript;
  const BASE = script && script.src ? new URL('vendor/nsfw/', script.src).href : 'vendor/nsfw/';
  let modelPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error('Could not load the safety check'));
      document.head.appendChild(tag);
    });
  }

  function model() {
    if (!modelPromise) {
      modelPromise = (async () => {
        if (!window.nsfwjs) await loadScript(`${BASE}nsfwjs.min.js`);
        if (window.tf && window.tf.enableProdMode) window.tf.enableProdMode();
        return window.nsfwjs.load(`${BASE}model/`, { size: 224 });
      })().catch((err) => {
        modelPromise = null;
        throw err;
      });
    }
    return modelPromise;
  }

  function scores(predictions) {
    const p = {};
    predictions.forEach((item) => {
      p[item.className] = item.probability;
    });
    return { nsfw: (p.Porn || 0) + (p.Hentai || 0), sexy: p.Sexy || 0, top: predictions[0] ? predictions[0].className : '' };
  }

  async function classify(source) {
    const net = await model();
    return scores(await net.classify(source, 5));
  }

  // Inference runs in a Web Worker when possible so a phone without WebGL doesn't freeze while it works.
  let worker = null;
  let workerBroken = false;
  let nextJob = 1;
  const jobs = new Map();

  function getWorker() {
    if (worker || workerBroken || typeof Worker === 'undefined') return worker;
    try {
      worker = new Worker(new URL('scan-worker.js', BASE.replace(/vendor\/nsfw\/$/, '')).href);
      worker.onmessage = (event) => {
        const job = jobs.get(event.data.id);
        if (!job) return;
        jobs.delete(event.data.id);
        if (event.data.error) job.reject(new Error(event.data.error));
        else job.resolve(event.data.results);
      };
      worker.onerror = () => {
        workerBroken = true;
        jobs.forEach((job) => job.reject(new Error('worker failed')));
        jobs.clear();
        worker = null;
      };
    } catch (err) {
      workerBroken = true;
      worker = null;
    }
    return worker;
  }

  function toImageData(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  async function classifyFrames(canvases) {
    const w = getWorker();
    if (w) {
      try {
        const frames = canvases.map(toImageData);
        const results = await new Promise((resolve, reject) => {
          const id = nextJob++;
          jobs.set(id, { resolve, reject });
          w.postMessage({ id, frames }, frames.map((f) => f.data.buffer));
        });
        return results.map(scores);
      } catch (err) {
        workerBroken = true; // fall back to the main thread below
      }
    }
    const out = [];
    for (const canvas of canvases) out.push(await classify(canvas));
    return out;
  }

  // 64-bit difference hash (9x8 grayscale), same layout as server.py dhash_bits()
  function dhash(source) {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, 9, 8);
    const { data } = g.getImageData(0, 0, 9, 8);
    const gray = [];
    for (let i = 0; i < data.length; i += 4) gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    let hex = '';
    for (let row = 0; row < 8; row++) {
      let nibbleBits = 0;
      for (let col = 0; col < 8; col++) {
        nibbleBits = (nibbleBits << 1) | (gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1 : 0);
      }
      hex += nibbleBits.toString(16).padStart(2, '0');
    }
    return hex;
  }

  function verdict(scan) {
    if (!scan) return 'unscanned';
    if (scan.nsfw >= THRESHOLDS.block) return 'block';
    if (scan.nsfw >= THRESHOLDS.review || scan.sexy >= THRESHOLDS.reviewSexy) return 'review';
    return 'ok';
  }

  function frameCanvas(source, width, height) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 448 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read this image'));
      img.src = url;
    });
  }

  function videoFrames(url, count = 3) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const frames = [];
      let times = [];
      const timer = setTimeout(() => (frames.length ? resolve(frames) : reject(new Error('Could not read this video'))), 20000);
      const grab = () => {
        frames.push(frameCanvas(video, video.videoWidth, video.videoHeight));
        if (frames.length >= times.length) {
          clearTimeout(timer);
          resolve(frames);
        } else {
          video.currentTime = times[frames.length];
        }
      };
      video.onloadeddata = () => {
        const length = Math.min(isFinite(video.duration) ? video.duration : 1, 60);
        times = Array.from({ length: count }, (_, i) => Math.max(0.1, (length * (i + 1)) / (count + 1)));
        video.onseeked = grab;
        video.currentTime = times[0];
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not read this video'));
      };
      video.src = url;
    });
  }

  // Scan a File/Blob. Returns { nsfw, sexy, frames, model, phash, verdict }.
  async function scanFile(file) {
    const url = URL.createObjectURL(file);
    try {
      let frames;
      if ((file.type || '').startsWith('image/')) {
        const img = await loadImage(url);
        frames = [frameCanvas(img, img.naturalWidth, img.naturalHeight)];
      } else {
        frames = await videoFrames(url);
      }
      const phash = dhash(frames[0]);
      let worst = { nsfw: 0, sexy: 0 };
      for (const result of await classifyFrames(frames)) {
        if (result.nsfw > worst.nsfw) worst = { ...worst, nsfw: result.nsfw };
        if (result.sexy > worst.sexy) worst = { ...worst, sexy: result.sexy };
      }
      const scan = {
        nsfw: Math.round(worst.nsfw * 10000) / 10000,
        sexy: Math.round(worst.sexy * 10000) / 10000,
        frames: frames.length,
        model: MODEL_NAME,
        phash,
      };
      scan.verdict = verdict(scan);
      return scan;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Scan something already on screen or at a URL (moderator console, viewer-side checks).
  async function scanUrl(url, kind) {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    const typed = blob.type ? blob : new Blob([blob], { type: kind === 'image' ? 'image/jpeg' : 'video/mp4' });
    return scanFile(typed);
  }

  window.FadeScan = {
    THRESHOLDS,
    MODEL_NAME,
    scanFile,
    scanUrl,
    classify,
    dhash,
    verdict,
    warmUp: () => model().then(() => true),
    usingWorker: () => !!worker && !workerBroken,
  };
})();
