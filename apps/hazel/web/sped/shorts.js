/*
 * Hazel Sped shorts toolkit — pure logic for posting to TikTok, Instagram Reels and
 * YouTube Shorts: platform presets, approximate UI safe zones, caption and
 * hashtag building, export-format choice, a pre-post checklist and
 * visualizer analysis. No DOM or network access, so it runs in JavaScriptCore
 * tests as well as the browser.
 *
 * Platform limits change often. Values here were checked in October 2026 and
 * are guidance, not guarantees; the destination app's own upload screen wins.
 */
(function (root) {
  'use strict';
  const H = root.Sped;

  const CANVAS = { width: 1080, height: 1920, fps: 30 };

  // Safe zones are approximate pixel margins on a 1080×1920 canvas where the
  // platform's own buttons, captions and progress bars tend to cover video.
  const platforms = {
    tiktok: {
      id: 'tiktok',
      name: 'TikTok',
      short: 'TikTok',
      maxSec: 600,
      captionLimit: 2200,
      hashtagLimit: null,
      titleLimit: null,
      formats: ['mp4', 'webm', 'mov'],
      safe: { top: 160, bottom: 480, left: 60, right: 150 },
      uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload',
      platformTag: null,
      soundTip: 'For a commercial song, you can post this video without audio and add the official sound from TikTok’s own library in the app.',
    },
    instagram: {
      id: 'instagram',
      name: 'Instagram Reels',
      short: 'Reels',
      maxSec: 180,
      captionLimit: 2200,
      hashtagLimit: 5,
      titleLimit: null,
      formats: ['mp4', 'mov'],
      safe: { top: 220, bottom: 420, left: 60, right: 130 },
      uploadUrl: 'https://www.instagram.com/',
      platformTag: '#reels',
      soundTip: 'For a commercial song, you can post this video without audio and pick the track from Instagram’s music library while creating the Reel.',
    },
    youtube: {
      id: 'youtube',
      name: 'YouTube Shorts',
      short: 'Shorts',
      maxSec: 180,
      captionLimit: 5000,
      hashtagLimit: 15,
      titleLimit: 100,
      formats: ['mp4', 'webm', 'mov'],
      safe: { top: 180, bottom: 400, left: 60, right: 140 },
      uploadUrl: 'https://www.youtube.com/upload',
      platformTag: '#shorts',
      soundTip: 'YouTube says externally added music in Shorts may receive Content ID claims; its Shorts audio library is the in-app alternative.',
    },
  };

  // "Other / multiple platforms" uses the strictest value of every field.
  platforms.other = {
    id: 'other',
    name: 'All platforms',
    short: 'All',
    maxSec: 180,
    captionLimit: 2200,
    hashtagLimit: 5,
    titleLimit: 100,
    formats: ['mp4', 'mov'],
    safe: {
      top: Math.max(platforms.tiktok.safe.top, platforms.instagram.safe.top, platforms.youtube.safe.top),
      bottom: Math.max(platforms.tiktok.safe.bottom, platforms.instagram.safe.bottom, platforms.youtube.safe.bottom),
      left: 60,
      right: Math.max(platforms.tiktok.safe.right, platforms.instagram.safe.right, platforms.youtube.safe.right),
    },
    uploadUrl: null,
    platformTag: null,
    soundTip: 'Each platform has its own licensed sound library; a remix of a commercial song is safest when you add the official sound inside each app.',
  };

  function platform(id) {
    return platforms[id] || platforms.other;
  }

  // ------------------------------------------------------------------ export format

  const MIME_CANDIDATES = [
    { type: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4', audio: true },
    { type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', audio: true },
    { type: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4', audio: true },
    { type: 'video/mp4', ext: 'mp4', audio: true },
    { type: 'video/webm;codecs=vp9,opus', ext: 'webm', audio: true },
    { type: 'video/webm;codecs=vp8,opus', ext: 'webm', audio: true },
    { type: 'video/webm', ext: 'webm', audio: true },
    { type: 'video/mp4;codecs=avc1.640028', ext: 'mp4', audio: false },
    { type: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', audio: false },
    { type: 'video/webm;codecs=vp9', ext: 'webm', audio: false },
    { type: 'video/webm;codecs=vp8', ext: 'webm', audio: false },
  ];

  /** Pick the best recorder format: MP4 (H.264) first, WebM as a fallback. */
  function pickMimeType(isTypeSupported, includeAudio) {
    const supported = typeof isTypeSupported === 'function' ? isTypeSupported : function () { return false; };
    const wantAudio = includeAudio !== false;
    const ordered = MIME_CANDIDATES.filter(function (c) {
      return wantAudio ? c.audio : true;
    }).sort(function (a, b) {
      // For silent exports prefer a video-only codec string, then any container.
      if (!wantAudio && a.audio !== b.audio) {
        return a.audio ? 1 : -1;
      }
      return 0;
    });
    for (let i = 0; i < ordered.length; i++) {
      try {
        if (supported(ordered[i].type)) {
          return { mimeType: ordered[i].type, extension: ordered[i].ext };
        }
      } catch (err) {
        /* treat as unsupported */
      }
    }
    return null;
  }

  function formatWarnings(platformId, extension) {
    const p = platform(platformId);
    if (!extension) {
      return ['This browser cannot record video. Use a current Chrome, Edge or Safari, or download the WAV and add visuals in another editor.'];
    }
    if (p.formats.indexOf(extension) < 0) {
      return [p.name + ' lists MP4/MOV uploads; this browser recorded ' + extension.toUpperCase() + '. Use Chrome, Edge or Safari for MP4, or convert before posting.'];
    }
    return [];
  }

  // ------------------------------------------------------------------ captions

  function uniqueTags(tags) {
    const seen = {};
    return tags.filter(function (tag) {
      const key = tag.toLowerCase();
      if (!tag || seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  function normaliseTag(text) {
    const cleaned = String(text || '').replace(/^#+/, '').replace(/[^\p{L}\p{N}_]+/gu, '');
    return cleaned ? '#' + cleaned.slice(0, 60) : '';
  }

  /** Descriptive hashtags derived from what the edit actually does. */
  function suggestHashtags(plan, platformId) {
    const p = platform(platformId);
    const recipe = (plan && plan.recipe) || {};
    const fx = recipe.fx || {};
    const main = plan && plan.tracks && plan.tracks[plan.mainId];
    const ratio = main ? main.tempoRatio : (recipe.tempo || 1);
    const tags = [];
    if (recipe.mode === 'coupled' && ratio > 1.1) {
      tags.push('#nightcore');
    }
    if (ratio > 1.03 || recipe.style === 'sped') {
      tags.push('#spedup');
    }
    if (ratio < 0.97 || recipe.style === 'slowed') {
      tags.push('#slowed');
      if ((fx.reverb || 0) >= 0.2) {
        tags.push('#slowedandreverb');
      }
    }
    const layered = plan && plan.segments ? plan.segments.some(function (s) { return s.track !== plan.mainId; }) : false;
    if (recipe.mashup || layered) {
      tags.push('#mashup');
    }
    if ((fx.eightD || 0) >= 0.3) {
      tags.push('#8daudio');
    }
    if ((fx.lofi || 0) >= 0.3) {
      tags.push('#lofi');
    }
    if ((fx.bass || 0) >= 4) {
      tags.push('#bassboosted');
    }
    tags.push('#remix');
    if (p.platformTag) {
      tags.push(p.platformTag);
    }
    return uniqueTags(tags);
  }

  /**
   * Build a caption for one platform. Returns the text plus any limit warnings.
   * Credits are copied from the user's own publishing notes, never invented.
   */
  function buildCaption(options) {
    const opts = options || {};
    const p = platform(opts.platformId);
    const warnings = [];
    const title = String(opts.title || '').trim();
    let tags = uniqueTags((opts.hashtags || []).map(normaliseTag));
    if (p.hashtagLimit !== null && tags.length > p.hashtagLimit) {
      warnings.push(p.name + ' allows ' + p.hashtagLimit + ' hashtags; kept the first ' + p.hashtagLimit + '.');
      tags = tags.slice(0, p.hashtagLimit);
    }
    const credits = (opts.credits || []).map(function (c) { return String(c || '').trim(); }).filter(Boolean);
    const lines = [];
    if (title) {
      lines.push(title);
    }
    if (credits.length) {
      lines.push(credits.map(function (c) { return 'Credit: ' + c; }).join('\n'));
    }
    if (tags.length) {
      lines.push(tags.join(' '));
    }
    let text = lines.join('\n\n');
    if (text.length > p.captionLimit) {
      warnings.push('Caption is longer than ' + p.name + '’s ' + p.captionLimit + '-character limit; it was shortened.');
      text = text.slice(0, p.captionLimit);
    }
    let videoTitle = null;
    if (p.titleLimit !== null) {
      videoTitle = title || 'Hazel Sped edit';
      if (videoTitle.length > p.titleLimit) {
        warnings.push('Title is longer than ' + p.titleLimit + ' characters; it was shortened.');
        videoTitle = videoTitle.slice(0, p.titleLimit - 1) + '…';
      }
    }
    return { text: text, title: videoTitle, hashtags: tags, warnings: warnings };
  }

  // ------------------------------------------------------------------ layout

  const POSITIONS = ['top', 'center', 'bottom'];

  /** Place title, badge, visualizer and progress bar inside the safe zone. */
  function layout(platformId, look) {
    const p = platform(platformId);
    const s = p.safe;
    const position = POSITIONS.indexOf(look && look.position) >= 0 ? look.position : 'center';
    const left = s.left;
    const right = CANVAS.width - s.right;
    const top = s.top;
    const bottom = CANVAS.height - s.bottom;
    const width = right - left;
    const height = bottom - top;
    const titleHeight = 300;
    const vizHeight = Math.round(Math.min(560, height * 0.42));
    let titleY;
    let vizY;
    if (position === 'top') {
      titleY = top + 40;
      vizY = bottom - vizHeight - 90;
    } else if (position === 'bottom') {
      vizY = top + 90;
      titleY = bottom - titleHeight - 70;
    } else {
      const block = titleHeight + 40 + vizHeight;
      titleY = Math.round(top + (height - block) / 2);
      vizY = titleY + titleHeight + 40;
    }
    return {
      canvas: { width: CANVAS.width, height: CANVAS.height },
      safe: { x: left, y: top, w: width, h: height },
      title: { x: left + 20, y: titleY, w: width - 40, h: titleHeight },
      visualizer: { x: left + 20, y: vizY, w: width - 40, h: vizHeight },
      progress: { x: left + 20, y: bottom - 36, w: width - 40, h: 10 },
    };
  }

  function insideSafe(box, safe) {
    return box.x >= safe.x && box.y >= safe.y && box.x + box.w <= safe.x + safe.w && box.y + box.h <= safe.y + safe.h;
  }

  // ------------------------------------------------------------------ visualizer analysis

  /**
   * Per-frame log-spaced band energies (0..1) for a beat-reactive visualizer.
   * Computed once per render; frames × bands Float32Array plus a level curve.
   */
  function frameBands(channels, sampleRate, fps, bandCount) {
    const rate = fps || CANVAS.fps;
    const bands = bandCount || 32;
    const mono = H.toMono(channels);
    const frames = Math.max(1, Math.ceil((mono.length / sampleRate) * rate));
    const size = 1024;
    const out = new Float32Array(frames * bands);
    const level = new Float32Array(frames);
    const re = new Float32Array(size);
    const im = new Float32Array(size);
    const minHz = 40;
    const maxHz = Math.min(14000, sampleRate / 2 - 1);
    const edges = [];
    for (let b = 0; b <= bands; b++) {
      const hz = minHz * Math.pow(maxHz / minHz, b / bands);
      edges.push(Math.max(1, Math.min(size / 2, Math.round((hz / sampleRate) * size))));
    }
    let peak = 1e-9;
    let peakLevel = 1e-9;
    for (let f = 0; f < frames; f++) {
      const center = Math.round((f / rate) * sampleRate);
      const start = center - size / 2;
      let sum = 0;
      for (let i = 0; i < size; i++) {
        const index = start + i;
        const sample = index >= 0 && index < mono.length ? mono[index] : 0;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
        re[i] = sample * w;
        im[i] = 0;
        sum += sample * sample;
      }
      level[f] = Math.sqrt(sum / size);
      peakLevel = Math.max(peakLevel, level[f]);
      H.fft(re, im);
      for (let b = 0; b < bands; b++) {
        const lo = edges[b];
        const hi = Math.max(lo + 1, edges[b + 1]);
        let energy = 0;
        for (let k = lo; k < hi; k++) {
          energy += re[k] * re[k] + im[k] * im[k];
        }
        const value = Math.sqrt(energy / (hi - lo));
        out[f * bands + b] = value;
        peak = Math.max(peak, value);
      }
    }
    // Perceptual scaling over a 48 dB range. Each band is mostly judged against
    // its own loudest moment so quiet treble bands still move, blended with the
    // global peak so overall balance is not flattened.
    const bandPeak = new Float32Array(bands);
    for (let f = 0; f < frames; f++) {
      for (let b = 0; b < bands; b++) {
        bandPeak[b] = Math.max(bandPeak[b], out[f * bands + b]);
      }
    }
    for (let f = 0; f < frames; f++) {
      for (let b = 0; b < bands; b++) {
        const index = f * bands + b;
        const own = (20 * Math.log10(out[index] / (bandPeak[b] + 1e-12) + 1e-9) + 48) / 48;
        const global = (20 * Math.log10(out[index] / peak + 1e-9) + 48) / 48;
        out[index] = Math.max(0, Math.min(1, 0.65 * Math.max(0, own) + 0.35 * Math.max(0, global)));
      }
    }
    for (let f = 0; f < frames; f++) {
      level[f] = Math.min(1, level[f] / peakLevel);
    }
    return { fps: rate, bands: bands, frames: frames, data: out, level: level };
  }

  function bandsAt(analysis, timeSec) {
    if (!analysis) {
      return null;
    }
    const frame = Math.max(0, Math.min(analysis.frames - 1, Math.floor(timeSec * analysis.fps)));
    return {
      values: analysis.data.subarray(frame * analysis.bands, (frame + 1) * analysis.bands),
      level: analysis.level[frame],
    };
  }

  /** 1 on each beat, decaying to 0 before the next (output is beat-aligned). */
  function beatPulse(timeSec, bpm) {
    if (!(bpm > 0) || !(timeSec >= 0)) {
      return 0;
    }
    const beat = 60 / bpm;
    const phase = (timeSec % beat) / beat;
    return Math.exp(-phase * 5);
  }

  // ------------------------------------------------------------------ checklist

  /**
   * Pre-post checklist for one platform. Informational: it never blocks export
   * and never claims a post is licensed, monetisable or likely to perform.
   */
  function readiness(input) {
    const opts = input || {};
    const p = platform(opts.platformId);
    const output = opts.output;
    const items = [];
    function add(id, level, label, detail) {
      items.push({ id: id, level: level, label: label, detail: detail || '' });
    }
    if (!output) {
      add('render', 'todo', 'Render an edit first', 'Pick a style or press Render.');
      return { platform: p.name, items: items, ready: false };
    }
    const duration = output.plan.durationSec;
    if (opts.stale) {
      add('stale', 'warn', 'Settings changed since the last render', 'Render again so the video matches your edits.');
    }
    add('format', 'ok', 'Vertical 9:16 video, 1080×1920', 'Platforms need a video; an audio-only WAV cannot be posted directly.');
    if (duration > p.maxSec) {
      add('length', 'warn', 'Longer than ' + p.name + ' allows (' + Math.round(p.maxSec) + ' s)', 'Shorten the edit in Edit → Length.');
    } else {
      add('length', duration >= 7 && duration <= 60 ? 'ok' : 'info', 'Length ' + duration.toFixed(1) + ' s', duration > 60 ? 'Over a minute is allowed but long for a looping sound.' : duration < 7 ? 'Very short clips can feel abrupt.' : 'Within ' + p.name + ' limits.');
    }
    const hook = output.score && typeof output.score.hookTime === 'number' ? output.score.hookTime : null;
    if (hook !== null) {
      add('hook', hook <= 1.5 ? 'ok' : 'warn', hook <= 1.5 ? 'Loud part starts within 1.5 s' : 'Loud part starts at ' + hook.toFixed(1) + ' s', hook <= 1.5 ? 'Viewers hear the hook straight away.' : 'Start on the chorus or drop so the first second carries the sound.');
    }
    const loudness = output.score && typeof output.score.loudness === 'number' ? output.score.loudness : null;
    if (loudness !== null) {
      const near = Math.abs(loudness - -14) <= 2.5;
      add('loudness', near ? 'ok' : 'info', 'Loudness about ' + loudness.toFixed(1) + ' LUFS (approx)', near ? 'Close to the level platforms commonly normalise to.' : 'Platforms normalise playback; very loud masters just get turned down.');
    }
    if (opts.includeAudio === false) {
      add('audio', 'info', 'Silent video export', 'Add the sound inside the app. ' + p.soundTip);
    }
    const tracks = opts.tracks || [];
    const undocumented = tracks.filter(function (t) {
      return !t.rights || !t.rights.basis || t.rights.basis === 'unknown';
    });
    if (opts.includeAudio !== false && undocumented.length) {
      add('rights', 'warn', 'Permission not recorded for ' + undocumented.length + ' source' + (undocumented.length > 1 ? 's' : ''), 'Externally added commercial music can be muted, claimed or removed. ' + p.soundTip);
    } else if (tracks.length) {
      add('rights', 'info', 'Permission notes recorded', 'Notes are your own declarations; Hazel Sped does not verify licenses.');
    }
    const missingCredit = tracks.filter(function (t) { return t.rights && t.rights.basis !== 'owned' && !t.rights.credit; });
    if (tracks.length && missingCredit.length) {
      add('credit', 'info', 'Add credits if your license requires them', 'Credits entered in Post → Publishing notes go straight into the caption.');
    }
    if (opts.caption && opts.caption.warnings && opts.caption.warnings.length) {
      add('caption', 'warn', 'Caption adjusted for ' + p.name, opts.caption.warnings.join(' '));
    }
    (opts.formatWarnings || []).forEach(function (w, i) {
      add('format-' + i, 'warn', 'Video format', w);
    });
    const ready = !items.some(function (item) { return item.level === 'warn' || item.level === 'todo'; });
    return { platform: p.name, items: items, ready: ready };
  }

  function fileName(label, platformId, extension) {
    const base = String(label || 'edit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'edit';
    return 'sped-' + base + '-' + platform(platformId).short.toLowerCase() + '.' + (extension || 'mp4');
  }

  H.shorts = {
    CANVAS: CANVAS,
    platforms: platforms,
    platform: platform,
    pickMimeType: pickMimeType,
    formatWarnings: formatWarnings,
    normaliseTag: normaliseTag,
    suggestHashtags: suggestHashtags,
    buildCaption: buildCaption,
    POSITIONS: POSITIONS,
    layout: layout,
    insideSafe: insideSafe,
    frameBands: frameBands,
    bandsAt: bandsAt,
    beatPulse: beatPulse,
    readiness: readiness,
    fileName: fileName,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
