/*
 * Hookline engine — dependency-free audio DSP for short-form "short-form" remixes.
 *
 * Runs unchanged in browsers, Web Workers, Node and JavaScriptCore and exposes a
 * single global `Hookline`. Audio is always an array of Float32Array channels at
 * one shared sample rate.
 *
 * Pipeline: analyse (tempo, beat grid, key, hook) -> plan (tempo/key matching,
 * arrangement) -> render (WSOLA time-stretch + resample pitch shift, crossfades,
 * transitions, master FX, loop fold, loudness) -> score (unvalidated edit heuristics).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.Hookline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.2.0';
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Krumhansl–Kessler key profiles.
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const ANALYSIS_RATE = 11025;

  const DEFAULT_RECIPE = {
    tempo: 1,              // tempo multiplier for the main track (ignored when targetBpm is set)
    targetBpm: null,       // absolute output tempo; overrides `tempo`
    semitones: 0,          // pitch shift of the main track (independent mode)
    mode: 'independent',   // 'independent' (tempo and pitch separate) | 'coupled' (classic speed-up, pitch follows tempo)
    keyMatch: true,        // shift layer tracks into the main track's (shifted) key
    mashup: false,         // use every track with role "layer"
    lengthSec: 30,
    xfadeBeats: 1,
    loop: true,            // fold the tail into the start so the sound loops seamlessly
    snapToBeats: true,
    style: 'remix',        // 'sped' | 'slowed' | 'remix' (used for the style-tempo heuristic)
    fx: { reverb: 0, bass: 0, air: 0, lofi: 0, eightD: 0 },
    mainId: null,
    targetLufs: -14,       // conservative starting target, not a platform specification
    segments: null,        // null = auto arrangement
  };

  // ------------------------------------------------------------------ utils

  function clamp(value, lo, hi) {
    return value < lo ? lo : value > hi ? hi : value;
  }

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  function gainToDb(gain) {
    return 20 * Math.log10(Math.max(gain, 1e-9));
  }

  function ratioFromSemitones(semitones) {
    return Math.pow(2, semitones / 12);
  }

  function wrapSemitones(semitones) {
    let wrapped = ((semitones % 12) + 12) % 12;
    if (wrapped >= 6) {
      wrapped -= 12;
    }
    return wrapped;
  }

  function seededRandom(seed) {
    let state = (seed >>> 0) || 1;
    return function next() {
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch) {
      return out;
    }
    Object.keys(patch).forEach(function (key) {
      if (['__proto__', 'prototype', 'constructor'].indexOf(key) >= 0) {
        throw new Error('Unsafe object key: ' + key);
      }
      const value = patch[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
        out[key] = deepMerge(base[key], value);
      } else {
        out[key] = value;
      }
    });
    return out;
  }

  const LIMITS = Object.freeze({
    maxTracks: 4,
    maxFileBytes: 40 * 1024 * 1024,
    maxTrackSeconds: 360,
    maxTotalSeconds: 900,
    maxOutputSeconds: 90,
    maxSegments: 16,
  });

  function finiteNumber(value, lo, hi, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
      throw new Error(label + ' must be a finite number between ' + lo + ' and ' + hi + '.');
    }
    return value;
  }

  function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(label + ' must be an object.');
    }
    Object.keys(value).forEach(function (key) {
      if (['__proto__', 'constructor', 'prototype'].indexOf(key) >= 0) {
        throw new Error('Unsafe object key: ' + key);
      }
    });
    return value;
  }

  function makeRecipe(patch) {
    const input = patch == null ? {} : plainObject(patch, 'Recipe');
    const freshDefaults = Object.assign({}, DEFAULT_RECIPE, {
      fx: Object.assign({}, DEFAULT_RECIPE.fx),
    });
    const r = deepMerge(freshDefaults, input);
    Object.keys(input).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_RECIPE, key)) {
        throw new Error('Unknown recipe setting: ' + key);
      }
    });
    finiteNumber(r.tempo, 0.5, 2, 'Tempo ratio');
    if (r.targetBpm !== null) {
      finiteNumber(r.targetBpm, 40, 240, 'Target BPM');
    }
    finiteNumber(r.semitones, -12, 12, 'Pitch');
    finiteNumber(r.lengthSec, 6, 60, 'Length');
    finiteNumber(r.xfadeBeats, 0, 2, 'Crossfade');
    finiteNumber(r.targetLufs, -24, -9, 'Loudness target');
    if (!['independent', 'coupled'].includes(r.mode) || !['sped', 'slowed', 'remix'].includes(r.style)) {
      throw new Error('Unsupported speed mode or style.');
    }
    ['loop', 'mashup', 'keyMatch', 'snapToBeats'].forEach(function (key) {
      if (typeof r[key] !== 'boolean') {
        throw new Error(key + ' must be true or false.');
      }
    });
    if (r.mainId !== null && (typeof r.mainId !== 'string' || r.mainId.length > 100)) {
      throw new Error('Invalid main track identifier.');
    }
    plainObject(r.fx, 'Effects');
    const effects = { reverb: [0, 0.8], bass: [0, 9], air: [0, 6], lofi: [0, 1], eightD: [0, 1], room: [0, 1] };
    Object.keys(r.fx).forEach(function (key) {
      if (!effects[key]) {
        throw new Error('Unknown effect: ' + key);
      }
      finiteNumber(r.fx[key], effects[key][0], effects[key][1], key);
    });
    if (r.segments !== null) {
      if (!Array.isArray(r.segments) || !r.segments.length || r.segments.length > LIMITS.maxSegments) {
        throw new Error('Arrangement must have 1–' + LIMITS.maxSegments + ' segments.');
      }
      r.segments = r.segments.map(function (seg) {
        plainObject(seg, 'Segment');
        if (typeof seg.track !== 'string' || !seg.track || seg.track.length > 100) {
          throw new Error('Segment needs a track identifier.');
        }
        const s = Object.assign({ from: 'hook', offsetBars: 0, gainDb: 0, filterIn: false, riserBefore: false }, seg);
        finiteNumber(s.bars, 1, 32, 'Segment bars');
        finiteNumber(s.offsetBars, 0, 64, 'Hook offset');
        if (!Number.isInteger(s.bars) || !Number.isInteger(s.offsetBars)) {
          throw new Error('Bars and offsets must be whole numbers.');
        }
        finiteNumber(s.gainDb, -24, 6, 'Segment gain');
        if (!['hook', 'time'].includes(s.from)) {
          throw new Error('Segment source must be hook or time.');
        }
        if (s.from === 'time') {
          finiteNumber(s.startSec, 0, LIMITS.maxTrackSeconds, 'Source start');
        }
        if (typeof s.filterIn !== 'boolean' || typeof s.riserBefore !== 'boolean') {
          throw new Error('Segment effects must be true or false.');
        }
        return s;
      });
    }
    return r;
  }

  function validateAudio(channels, sampleRate) {
    finiteNumber(sampleRate, 8000, 96000, 'Sample rate');
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
      throw new Error('Use mono or stereo audio.');
    }
    const length = channels[0].length;
    if (length < sampleRate || length > sampleRate * LIMITS.maxTrackSeconds ||
        channels.some(function (c) { return !(c instanceof Float32Array) || c.length !== length; })) {
      throw new Error('Use 1–360 second mono/stereo tracks with equal-length channels.');
    }
    if (hasInvalidSamples(channels)) {
      throw new Error('Audio contains non-finite samples.');
    }
    if (peakOf(channels) < 0.00001) {
      throw new Error('This track is silent. Choose audible audio.');
    }
  }

  function toMono(channels) {
    if (channels.length === 1) {
      return channels[0];
    }
    const length = channels[0].length;
    const mono = new Float32Array(length);
    const scale = 1 / channels.length;
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c];
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] * scale;
      }
    }
    return mono;
  }

  function ensureStereo(channels) {
    if (channels.length >= 2) {
      return [channels[0], channels[1]];
    }
    return [channels[0], new Float32Array(channels[0])];
  }

  function sliceChannels(channels, start, end) {
    const length = Math.max(0, end - start);
    return channels.map(function (data) {
      const out = new Float32Array(length);
      const from = Math.max(0, start);
      const to = Math.min(data.length, end);
      if (to > from) {
        out.set(data.subarray(from, to), from - start);
      }
      return out;
    });
  }

  function peakOf(channels) {
    let peak = 0;
    channels.forEach(function (data) {
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) {
          peak = v;
        }
      }
    });
    return peak;
  }

  function hasInvalidSamples(channels) {
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c];
      for (let i = 0; i < data.length; i++) {
        if (!isFinite(data[i])) {
          return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ keys

  function keyName(key) {
    if (!key) {
      return '—';
    }
    const names = key.mode === 'minor' ? SHARP_NAMES : FLAT_NAMES;
    return names[((Math.round(key.pc) % 12) + 12) % 12] + ' ' + key.mode;
  }

  function parseKey(text) {
    if (!text) {
      return null;
    }
    const match = String(text).trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(major|minor|maj|min|m)?$/);
    if (!match) {
      return null;
    }
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    let pc = base;
    if (match[2] === '#' || match[2] === '♯') {
      pc += 1;
    }
    if (match[2] === 'b' || match[2] === '♭') {
      pc -= 1;
    }
    const modeText = (match[3] || 'major').toLowerCase();
    const mode = modeText === 'minor' || modeText === 'min' || modeText === 'm' ? 'minor' : 'major';
    return { pc: ((pc % 12) + 12) % 12, mode: mode };
  }

  // Pitch class of the relative major: tracks in relative keys share notes,
  // so they can be layered after the same shift.
  function majorEquivalent(key) {
    return key.mode === 'minor' ? (key.pc + 3) % 12 : key.pc;
  }

  // ------------------------------------------------------------------ FFT

  const windowCache = {};

  function hannWindow(size) {
    if (!windowCache[size]) {
      const w = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      }
      windowCache[size] = w;
    }
    return windowCache[size];
  }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) {
        j ^= bit;
      }
      j ^= bit;
      if (i < j) {
        let tmp = re[i];
        re[i] = re[j];
        re[j] = tmp;
        tmp = im[i];
        im[i] = im[j];
        im[j] = tmp;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (-2 * Math.PI) / len;
      const stepRe = Math.cos(angle);
      const stepIm = Math.sin(angle);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k;
          const b = a + half;
          const tRe = re[b] * wRe - im[b] * wIm;
          const tIm = re[b] * wIm + im[b] * wRe;
          re[b] = re[a] - tRe;
          im[b] = im[a] - tIm;
          re[a] += tRe;
          im[a] += tIm;
          const nextRe = wRe * stepRe - wIm * stepIm;
          wIm = wRe * stepIm + wIm * stepRe;
          wRe = nextRe;
        }
      }
    }
  }

  // ------------------------------------------------------------------ analysis

  function decimate(mono, sampleRate, targetRate) {
    const factor = Math.max(1, Math.round(sampleRate / targetRate));
    const length = Math.floor(mono.length / factor);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      const base = i * factor;
      for (let k = 0; k < factor; k++) {
        sum += mono[base + k];
      }
      out[i] = sum / factor;
    }
    return { data: out, rate: sampleRate / factor };
  }

  // Spectral-flux onset strength (log magnitude, half-wave rectified, detrended).
  function onsetEnvelope(signal, rate, startSample, endSample) {
    const size = 1024;
    const hop = 128;
    const win = hannWindow(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const bins = size >> 1;
    let previous = new Float32Array(bins);
    let current = new Float32Array(bins);
    const start = Math.max(0, startSample | 0);
    const end = Math.min(signal.length, endSample | 0);
    const frames = Math.max(0, Math.floor((end - start - size) / hop));
    const raw = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const offset = start + f * hop;
      for (let i = 0; i < size; i++) {
        re[i] = signal[offset + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      let flux = 0;
      for (let b = 1; b < bins; b++) {
        const magnitude = Math.log(1 + 100 * Math.sqrt(re[b] * re[b] + im[b] * im[b]));
        current[b] = magnitude;
        const delta = magnitude - previous[b];
        if (delta > 0) {
          flux += delta;
        }
      }
      raw[f] = f === 0 ? 0 : flux;
      const swap = previous;
      previous = current;
      current = swap;
    }
    const frameRate = rate / hop;
    const radius = Math.max(1, Math.round(0.4 * frameRate));
    const prefix = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) {
      prefix[f + 1] = prefix[f] + raw[f];
    }
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const lo = Math.max(0, f - radius);
      const hi = Math.min(frames, f + radius + 1);
      const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
      env[f] = Math.max(0, raw[f] - mean);
    }
    return { env: env, frameRate: frameRate, hop: hop, size: size, start: start, rate: rate };
  }

  function onsetTime(onset, frame) {
    return (onset.start + frame * onset.hop + onset.size / 2) / onset.rate;
  }

  function sampleEnv(env, position) {
    const i = Math.floor(position);
    if (i < 0 || i >= env.length - 1) {
      return 0;
    }
    const frac = position - i;
    return env[i] * (1 - frac) + env[i + 1] * frac;
  }

  function estimateTempo(onset, options) {
    const opts = options || {};
    const env = onset.env;
    const frameRate = onset.frameRate;
    const minBpm = opts.minBpm || 70;
    const maxBpm = opts.maxBpm || 190;
    const n = env.length;
    const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
    const maxLag = Math.min(n - 2, Math.ceil((60 * frameRate) / minBpm));
    if (n < maxLag * 3) {
      return { bpm: 120, periodFrames: (60 * frameRate) / 120, phaseFrames: 0, confidence: 0 };
    }
    let mean = 0;
    for (let i = 0; i < n; i++) {
      mean += env[i];
    }
    mean /= n;
    const centered = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      centered[i] = env[i] - mean;
    }
    const ac = new Float64Array(maxLag + 2);
    let zeroLag = 0;
    for (let i = 0; i < n; i++) {
      zeroLag += centered[i] * centered[i];
    }
    zeroLag /= n;
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) {
        sum += centered[i] * centered[i + lag];
      }
      ac[lag] = sum / (n - lag);
    }
    let bestLag = minLag;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * frameRate) / lag;
      const octaves = Math.log2(bpm / 125) / 0.8;
      const prior = Math.exp(-0.5 * octaves * octaves);
      const score = ac[lag] * prior;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    // Parabolic interpolation around the autocorrelation peak.
    const a = ac[bestLag - 1];
    const b = ac[bestLag];
    const c = ac[bestLag + 1];
    const denominator = a - 2 * b + c;
    let refinedLag = bestLag;
    if (denominator < 0) {
      refinedLag = bestLag + clamp((0.5 * (a - c)) / denominator, -0.5, 0.5);
    }
    // Comb search: fine period and beat phase.
    let bestPeriod = refinedLag;
    let bestPhase = 0;
    let bestComb = -Infinity;
    for (let period = refinedLag * 0.985; period <= refinedLag * 1.015; period += refinedLag * 0.0008) {
      for (let phase = 0; phase < period; phase += 0.5) {
        let sum = 0;
        let count = 0;
        for (let t = phase; t < n - 1; t += period) {
          sum += sampleEnv(env, t);
          count++;
        }
        const score = sum / Math.max(1, count);
        if (score > bestComb) {
          bestComb = score;
          bestPeriod = period;
          bestPhase = phase;
        }
      }
    }
    return {
      bpm: (60 * frameRate) / bestPeriod,
      periodFrames: bestPeriod,
      phaseFrames: bestPhase,
      confidence: zeroLag > 0 ? clamp(ac[bestLag] / zeroLag, 0, 1) : 0,
    };
  }

  function chromaFrames(signal, rate) {
    const size = 4096;
    const hop = 2048;
    const win = hannWindow(size);
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    const bins = size >> 1;
    const pitchClassOfBin = new Int8Array(bins).fill(-1);
    for (let b = 1; b < bins; b++) {
      const freq = (b * rate) / size;
      if (freq >= 80 && freq <= 2500) {
        const midi = Math.round(12 * Math.log2(freq / 440) + 69);
        pitchClassOfBin[b] = ((midi % 12) + 12) % 12;
      }
    }
    const frames = Math.max(0, Math.floor((signal.length - size) / hop));
    const chroma = new Float32Array(frames * 12);
    const times = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const offset = f * hop;
      for (let i = 0; i < size; i++) {
        re[i] = signal[offset + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let b = 1; b < bins; b++) {
        const pc = pitchClassOfBin[b];
        if (pc >= 0) {
          chroma[f * 12 + pc] += Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        }
      }
      times[f] = (offset + size / 2) / rate;
    }
    return { chroma: chroma, times: times, count: frames };
  }

  function correlation(x, y) {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 12; i++) {
      mx += x[i];
      my += y[i];
    }
    mx /= 12;
    my /= 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      num += (x[i] - mx) * (y[i] - my);
      dx += (x[i] - mx) * (x[i] - mx);
      dy += (y[i] - my) * (y[i] - my);
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
  }

  function estimateKey(chromaSum) {
    let best = { pc: 0, mode: 'major', score: -Infinity };
    let second = -Infinity;
    for (let tonic = 0; tonic < 12; tonic++) {
      [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]].forEach(function (entry) {
        const rotated = new Array(12);
        for (let i = 0; i < 12; i++) {
          rotated[(i + tonic) % 12] = entry[1][i];
        }
        const score = correlation(chromaSum, rotated);
        if (score > best.score) {
          second = best.score;
          best = { pc: tonic, mode: entry[0], score: score };
        } else if (score > second) {
          second = score;
        }
      });
    }
    return {
      pc: best.pc,
      mode: best.mode,
      name: keyName(best),
      confidence: clamp((best.score - second) * 4 + best.score * 0.5, 0, 1),
    };
  }

  // Chorus/hook finder at beat resolution. The window is measured in seconds so a
  // half- or double-time tempo estimate does not change what counts as a hook.
  // Score = loudness of the window + how often its harmony repeats elsewhere +
  // the energy jump into it (choruses start with a lift).
  function findHooks(decimated, chroma, detectedBeatSec, firstBeat, duration, windowSec) {
    // Half-beat grid: a half-time tempo estimate still resolves the real beats.
    const beatSec = detectedBeatSec / 2;
    const beats = [];
    for (let t = firstBeat; t + beatSec <= duration; t += beatSec) {
      beats.push(t);
    }
    const W = Math.max(4, Math.round((windowSec || 8) / beatSec));
    const lead = Math.max(2, Math.round(2.5 / beatSec));
    if (beats.length < W + lead + 2) {
      return [{ start: beats.length ? beats[0] : 0, score: 0 }];
    }
    const signal = decimated.data;
    const rate = decimated.rate;
    const energy = new Float64Array(beats.length);
    const beatChroma = beats.map(function () {
      return new Float64Array(12);
    });
    beats.forEach(function (start, index) {
      const s0 = Math.floor(start * rate);
      const s1 = Math.min(signal.length, Math.floor((start + beatSec) * rate));
      let sum = 0;
      for (let i = s0; i < s1; i++) {
        sum += signal[i] * signal[i];
      }
      energy[index] = Math.sqrt(sum / Math.max(1, s1 - s0));
    });
    let frame = 0;
    for (let index = 0; index < beats.length; index++) {
      const end = beats[index] + beatSec;
      while (frame < chroma.count && chroma.times[frame] < beats[index]) {
        frame++;
      }
      let f = frame;
      while (f < chroma.count && chroma.times[f] < end) {
        for (let k = 0; k < 12; k++) {
          beatChroma[index][k] += chroma.chroma[f * 12 + k];
        }
        f++;
      }
      let norm = 0;
      for (let k = 0; k < 12; k++) {
        norm += beatChroma[index][k] * beatChroma[index][k];
      }
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < 12; k++) {
        beatChroma[index][k] /= norm;
      }
    }
    const prefix = new Float64Array(beats.length + 1);
    for (let i = 0; i < beats.length; i++) {
      prefix[i + 1] = prefix[i] + energy[i];
    }
    function meanEnergy(from, to) {
      const a = Math.max(0, from);
      const b = Math.min(beats.length, to);
      return b > a ? (prefix[b] - prefix[a]) / (b - a) : 0;
    }
    const first = lead;
    const last = beats.length - W;
    const starts = [];
    const energyScore = [];
    const repeatScore = [];
    const jumpScore = [];
    for (let s = first; s <= last; s++) {
      starts.push(s);
      const inside = meanEnergy(s, s + W);
      energyScore.push(inside);
      jumpScore.push(inside - meanEnergy(s - lead, s));
      let bestRepeat = 0;
      for (let t = 0; t + W <= beats.length; t += 2) {
        if (Math.abs(t - s) < W) {
          continue;
        }
        let similarity = 0;
        for (let i = 0; i < W; i += 2) {
          let dot = 0;
          const a = beatChroma[s + i];
          const b = beatChroma[t + i];
          for (let k = 0; k < 12; k++) {
            dot += a[k] * b[k];
          }
          similarity += dot;
        }
        similarity /= Math.ceil(W / 2);
        if (similarity > bestRepeat) {
          bestRepeat = similarity;
        }
      }
      repeatScore.push(bestRepeat);
    }
    function zscores(values) {
      let mean = 0;
      for (let i = 0; i < values.length; i++) {
        mean += values[i];
      }
      mean /= values.length;
      let variance = 0;
      for (let i = 0; i < values.length; i++) {
        variance += (values[i] - mean) * (values[i] - mean);
      }
      const sd = Math.sqrt(variance / values.length) || 1;
      return values.map(function (v) {
        return (v - mean) / sd;
      });
    }
    const zE = zscores(energyScore);
    const zR = zscores(repeatScore);
    const zJ = zscores(jumpScore);
    const scored = starts.map(function (s, i) {
      const position = beats[s] / duration;
      let penalty = 0;
      if (position < 0.05) {
        penalty += 0.6;
      }
      if (position > 0.92) {
        penalty += 0.6;
      }
      return { start: beats[s], beat: s, score: zE[i] + 0.5 * zR[i] + 0.8 * zJ[i] - penalty };
    });
    scored.sort(function (x, y) {
      return y.score - x.score;
    });
    const picked = [];
    for (let i = 0; i < scored.length && picked.length < 3; i++) {
      const candidate = scored[i];
      const tooClose = picked.some(function (p) {
        return Math.abs(p.beat - candidate.beat) < W;
      });
      if (!tooClose) {
        picked.push(candidate);
      }
    }
    // Fine-tune each pick to the sharpest local energy step (the chorus downbeat).
    const reach = Math.max(2, Math.round(1.2 / beatSec));
    const local = Math.max(2, Math.round(1.5 / beatSec));
    picked.forEach(function (p) {
      let best = p.beat;
      let bestStep = -Infinity;
      for (let s = p.beat - reach; s <= p.beat + reach; s++) {
        if (s - local < 0 || s + local > beats.length) {
          continue;
        }
        const step = meanEnergy(s, s + local) - meanEnergy(s - local, s);
        if (step > bestStep) {
          bestStep = step;
          best = s;
        }
      }
      p.start = beats[best];
    });
    return picked.map(function (p) {
      return { start: Math.round(p.start * 1000) / 1000, score: Math.round(p.score * 100) / 100 };
    });
  }

  function prepareTrack(channels, sampleRate) {
    validateAudio(channels, sampleRate);
    const stereo = ensureStereo(channels);
    const mono = toMono(stereo);
    return {
      channels: stereo,
      sampleRate: sampleRate,
      duration: mono.length / sampleRate,
      decimated: decimate(mono, sampleRate, ANALYSIS_RATE),
    };
  }

  function analyzeTrack(track) {
    const dec = track.decimated;
    const duration = track.duration;
    const excerptLength = Math.min(dec.data.length, Math.floor(60 * dec.rate));
    const excerptStart = clamp(Math.round(dec.data.length * 0.45 - excerptLength / 2), 0, Math.max(0, dec.data.length - excerptLength));
    const onset = onsetEnvelope(dec.data, dec.rate, excerptStart, excerptStart + excerptLength);
    const tempo = estimateTempo(onset);
    const beatSec = 60 / tempo.bpm;
    const anchor = onsetTime(onset, tempo.phaseFrames);
    const firstBeat = ((anchor % beatSec) + beatSec) % beatSec;
    const chroma = chromaFrames(dec.data, dec.rate);
    const chromaSum = new Array(12).fill(0);
    for (let f = 0; f < chroma.count; f++) {
      for (let k = 0; k < 12; k++) {
        chromaSum[k] += chroma.chroma[f * 12 + k];
      }
    }
    const key = estimateKey(chromaSum);
    const hooks = findHooks(dec, chroma, beatSec, firstBeat, duration, 8);
    return {
      duration: Math.round(duration * 1000) / 1000,
      bpm: Math.round(tempo.bpm * 100) / 100,
      tempoConfidence: Math.round(tempo.confidence * 100) / 100,
      beatSec: beatSec,
      firstBeat: Math.round(firstBeat * 10000) / 10000,
      key: key,
      hooks: hooks,
      loudness: Math.round(integratedLoudness(track.channels, track.sampleRate) * 10) / 10,
    };
  }

  // Re-align a grid time to the strongest local beat phase (cancels drift from a
  // global tempo estimate on long songs and live-played drums).
  function refineBeatNear(track, timeSec, beatSec) {
    const dec = track.decimated;
    const radius = Math.max(3, beatSec * 6);
    const start = Math.max(0, Math.floor((timeSec - radius) * dec.rate));
    const end = Math.min(dec.data.length, Math.floor((timeSec + radius) * dec.rate));
    if (end - start < dec.rate * 2) {
      return timeSec;
    }
    const onset = onsetEnvelope(dec.data, dec.rate, start, end);
    const period = beatSec * onset.frameRate;
    let bestOffset = 0;
    let bestScore = -Infinity;
    for (let offset = -beatSec / 2; offset <= beatSec / 2; offset += 1 / onset.frameRate) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) {
        const t = timeSec + offset + k * beatSec;
        const frame = (t * onset.rate - onset.start - onset.size / 2) / onset.hop;
        sum += sampleEnv(onset.env, frame);
      }
      const score = sum - Math.abs(offset) * 0.02 * period;
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return Math.max(0, timeSec + bestOffset);
  }

  // ------------------------------------------------------------------ time & pitch

  function wsolaPlan(mono, speed, sampleRate) {
    const frameSize = sampleRate > 60000 ? 4096 : 2048;
    const synthesisHop = frameSize >> 1;
    const tolerance = frameSize >> 2;
    const overlap = frameSize >> 1;
    const outLength = Math.floor(mono.length / speed);
    const frames = Math.ceil(outLength / synthesisHop) + 1;
    const positions = new Int32Array(frames);
    const maxStart = Math.max(0, mono.length - frameSize);
    let previous = 0;
    function similarity(template, candidate, step) {
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < overlap; i += step) {
        const v = mono[candidate + i];
        dot += mono[template + i] * v;
        energy += v * v;
      }
      return dot / Math.sqrt(energy);
    }
    for (let k = 0; k < frames; k++) {
      const nominal = Math.round(k * synthesisHop * speed);
      if (k === 0) {
        positions[k] = 0;
        previous = 0;
        continue;
      }
      const natural = previous + synthesisHop;
      const lo = Math.max(0, nominal - tolerance);
      const hi = Math.min(maxStart, nominal + tolerance);
      if (natural + overlap >= mono.length || hi <= lo) {
        positions[k] = clamp(nominal, 0, maxStart);
        previous = positions[k];
        continue;
      }
      let best = clamp(nominal, lo, hi);
      let bestScore = -Infinity;
      for (let candidate = lo; candidate <= hi; candidate += 8) {
        const score = similarity(natural, candidate, 4);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      const refineLo = Math.max(lo, best - 8);
      const refineHi = Math.min(hi, best + 8);
      bestScore = -Infinity;
      for (let candidate = refineLo; candidate <= refineHi; candidate++) {
        const score = similarity(natural, candidate, 1);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      positions[k] = best;
      previous = best;
    }
    return { positions: positions, frameSize: frameSize, synthesisHop: synthesisHop, outLength: outLength };
  }

  function wsolaApply(data, plan) {
    const size = plan.frameSize;
    const hop = plan.synthesisHop;
    const win = hannWindow(size);
    const out = new Float32Array(plan.outLength + size);
    const weight = new Float32Array(plan.outLength + size);
    for (let k = 0; k < plan.positions.length; k++) {
      const src = plan.positions[k];
      const dst = k * hop;
      if (dst >= plan.outLength) {
        break;
      }
      for (let i = 0; i < size; i++) {
        const s = src + i;
        const v = s < data.length ? data[s] : 0;
        out[dst + i] += v * win[i];
        weight[dst + i] += win[i];
      }
    }
    for (let i = 0; i < plan.outLength; i++) {
      if (weight[i] > 1e-3) {
        out[i] /= weight[i];
      }
    }
    return out.subarray(0, plan.outLength);
  }

  function timeStretch(channels, speed, sampleRate) {
    if (Math.abs(speed - 1) < 1e-3) {
      return channels.map(function (c) {
        return new Float32Array(c);
      });
    }
    const plan = wsolaPlan(toMono(channels), speed, sampleRate);
    return channels.map(function (c) {
      return new Float32Array(wsolaApply(c, plan));
    });
  }

  function resample(data, ratio) {
    const outLength = Math.max(0, Math.floor((data.length - 1) / ratio));
    const out = new Float32Array(outLength);
    const last = data.length - 1;
    for (let i = 0; i < outLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const t = position - index;
      const y0 = data[index > 0 ? index - 1 : 0];
      const y1 = data[index];
      const y2 = data[index + 1 <= last ? index + 1 : last];
      const y3 = data[index + 2 <= last ? index + 2 : last];
      // 4-point, 3rd-order Hermite interpolation.
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      out[i] = ((c3 * t + c2) * t + c1) * t + y1;
    }
    return out;
  }

  /**
   * Change tempo and pitch independently.
   * tempoRatio > 1 = faster (output length = input / tempoRatio).
   * semitones > 0 = higher.
   */
  function transform(channels, sampleRate, tempoRatio, semitones) {
    const pitchRatio = ratioFromSemitones(semitones || 0);
    const speed = tempoRatio / pitchRatio;
    let out = timeStretch(channels, speed, sampleRate);
    if (Math.abs(pitchRatio - 1) > 1e-4) {
      out = out.map(function (data) {
        let source = data;
        if (pitchRatio > 1) {
          // Anti-alias before reading the signal faster.
          const cutoff = (0.45 * sampleRate) / pitchRatio;
          source = biquad(biquad(data, coefficients('lowpass', cutoff, sampleRate, 0.5412)), coefficients('lowpass', cutoff, sampleRate, 1.3066));
        }
        return resample(source, pitchRatio);
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ filters & FX

  function coefficients(type, frequency, sampleRate, q, gainDb) {
    const f = clamp(frequency, 10, sampleRate * 0.49);
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const Q = q || 0.7071;
    const alpha = sin / (2 * Q);
    const A = Math.pow(10, (gainDb || 0) / 40);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'lowshelf' || type === 'highshelf') {
      const sqrtA = Math.sqrt(A);
      const shelfAlpha = (sin / 2) * Math.sqrt(2);
      const sign = type === 'lowshelf' ? 1 : -1;
      b0 = A * ((A + 1) - sign * (A - 1) * cos + 2 * sqrtA * shelfAlpha);
      b1 = sign * 2 * A * ((A - 1) - sign * (A + 1) * cos);
      b2 = A * ((A + 1) - sign * (A - 1) * cos - 2 * sqrtA * shelfAlpha);
      a0 = (A + 1) + sign * (A - 1) * cos + 2 * sqrtA * shelfAlpha;
      a1 = -sign * 2 * ((A - 1) + sign * (A + 1) * cos);
      a2 = (A + 1) + sign * (A - 1) * cos - 2 * sqrtA * shelfAlpha;
    } else {
      throw new Error('Unknown filter type ' + type);
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function biquad(data, c, inPlace) {
    const out = inPlace ? data : new Float32Array(data.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      out[i] = y0;
    }
    return out;
  }

  // Time-varying filter (coefficients updated every 64 samples).
  function sweepFilter(data, sampleRate, type, fromHz, toHz, sweepSamples, q) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let c = coefficients(type, fromHz, sampleRate, q);
    const total = Math.min(data.length, sweepSamples);
    for (let i = 0; i < data.length; i++) {
      if (i < total && i % 64 === 0) {
        const t = i / total;
        c = coefficients(type, fromHz * Math.pow(toHz / fromHz, t), sampleRate, q);
      }
      if (i === total) {
        // Sweep finished: leave the remainder untouched.
        break;
      }
      const x0 = data[i];
      const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      // Blend back to dry over the last 10 % to avoid a click at the hand-off.
      const blend = t10(i, total);
      data[i] = y0 * (1 - blend) + x0 * blend;
    }
    return data;
  }

  function t10(i, total) {
    const start = total * 0.9;
    return i < start ? 0 : (i - start) / Math.max(1, total - start);
  }

  function reverb(channels, sampleRate, amount, roomSize) {
    if (!amount || amount <= 0) {
      return channels;
    }
    const scale = sampleRate / 44100;
    const combTuning = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const allpassTuning = [556, 441, 341, 225];
    const spread = 23;
    const feedback = (roomSize || 0.82) * 0.28 + 0.7;
    const damp = 0.35 * 0.4;
    const predelay = Math.round(0.02 * sampleRate);
    const length = channels[0].length;
    const input = new Float32Array(length);
    for (let i = predelay; i < length; i++) {
      input[i] = (channels[0][i - predelay] + channels[1][i - predelay]) * 0.015;
    }
    const wetGain = clamp(amount, 0, 1) * 3;
    const dryGain = 1 - clamp(amount, 0, 1) * 0.35;
    return channels.map(function (dry, channelIndex) {
      const offset = channelIndex === 0 ? 0 : spread;
      const combs = combTuning.map(function (t) {
        return { buffer: new Float32Array(Math.round((t + offset) * scale)), index: 0, store: 0 };
      });
      const allpasses = allpassTuning.map(function (t) {
        return { buffer: new Float32Array(Math.round((t + offset) * scale)), index: 0 };
      });
      const out = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        const x = input[i];
        let wet = 0;
        for (let k = 0; k < 8; k++) {
          const comb = combs[k];
          const y = comb.buffer[comb.index];
          comb.store = y * (1 - damp) + comb.store * damp;
          comb.buffer[comb.index] = x + comb.store * feedback;
          comb.index = comb.index + 1 === comb.buffer.length ? 0 : comb.index + 1;
          wet += y;
        }
        for (let k = 0; k < 4; k++) {
          const ap = allpasses[k];
          const buffered = ap.buffer[ap.index];
          const y = -wet + buffered;
          ap.buffer[ap.index] = wet + buffered * 0.5;
          ap.index = ap.index + 1 === ap.buffer.length ? 0 : ap.index + 1;
          wet = y;
        }
        out[i] = dry[i] * dryGain + wet * wetGain;
      }
      return out;
    });
  }

  function eightD(channels, sampleRate, amount) {
    if (!amount || amount <= 0) {
      return channels;
    }
    const rate = 0.11;
    const depth = clamp(amount, 0, 1);
    const length = channels[0].length;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const mid = (channels[0][i] + channels[1][i]) * 0.5;
      const side = (channels[0][i] - channels[1][i]) * 0.5 * (1 - depth * 0.6);
      const angle = Math.PI / 4 + depth * (Math.PI / 4) * 0.92 * Math.sin((2 * Math.PI * rate * i) / sampleRate);
      left[i] = mid * Math.cos(angle) * Math.SQRT2 + side;
      right[i] = mid * Math.sin(angle) * Math.SQRT2 - side;
    }
    return [left, right];
  }

  function lofi(channels, sampleRate, amount) {
    if (!amount || amount <= 0) {
      return channels;
    }
    const a = clamp(amount, 0, 1);
    const cutoff = 3800 + (1 - a) * 12000;
    const drive = 1 + 2 * a;
    const norm = Math.tanh(drive);
    const random = seededRandom(1977);
    const crackleRate = 6 * a / sampleRate;
    const length = channels[0].length;
    const crackle = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      if (random() < crackleRate) {
        crackle[i] = (random() * 2 - 1) * 0.12 * a;
      }
      crackle[i] += (random() * 2 - 1) * 0.002 * a;
    }
    return channels.map(function (data) {
      const filtered = biquad(biquad(data, coefficients('lowpass', cutoff, sampleRate, 0.7071)), coefficients('highpass', 60 + 120 * a, sampleRate, 0.7071));
      const levels = a > 0.6 ? Math.pow(2, 13 - Math.round(4 * (a - 0.6) / 0.4)) : 0;
      for (let i = 0; i < length; i++) {
        let v = Math.tanh(filtered[i] * drive) / norm + crackle[i];
        if (levels) {
          v = Math.round(v * levels) / levels;
        }
        filtered[i] = v;
      }
      return filtered;
    });
  }

  function compressor(channels, sampleRate, thresholdDb, ratio, attackMs, releaseMs) {
    const attack = Math.exp(-1 / (sampleRate * attackMs / 1000));
    const release = Math.exp(-1 / (sampleRate * releaseMs / 1000));
    const length = channels[0].length;
    let envelope = 0;
    const out = channels.map(function () {
      return new Float32Array(length);
    });
    for (let i = 0; i < length; i++) {
      let level = 0;
      for (let c = 0; c < channels.length; c++) {
        const v = Math.abs(channels[c][i]);
        if (v > level) {
          level = v;
        }
      }
      const coeff = level > envelope ? attack : release;
      envelope = coeff * envelope + (1 - coeff) * level;
      const over = gainToDb(envelope) - thresholdDb;
      const gain = over > 0 ? dbToGain(-over * (1 - 1 / ratio)) : 1;
      for (let c = 0; c < channels.length; c++) {
        out[c][i] = channels[c][i] * gain;
      }
    }
    return out;
  }

  // Look-ahead peak limiter: sliding-minimum gain, box-smoothed, slow release.
  function limiter(channels, sampleRate, ceiling) {
    const length = channels[0].length;
    const lookahead = Math.max(1, Math.round(0.005 * sampleRate));
    const required = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let level = 0;
      for (let c = 0; c < channels.length; c++) {
        const v = Math.abs(channels[c][i]);
        if (v > level) {
          level = v;
        }
      }
      required[i] = level > ceiling ? ceiling / level : 1;
    }
    // Sliding minimum over [i - lookahead, i + lookahead] (monotonic deque).
    const minimum = new Float32Array(length);
    const deque = new Int32Array(length);
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let i = 0; i < length; i++) {
      const reach = Math.min(length - 1, i + lookahead);
      while (next <= reach) {
        while (tail > head && required[deque[tail - 1]] >= required[next]) {
          tail--;
        }
        deque[tail++] = next;
        next++;
      }
      while (deque[head] < i - lookahead) {
        head++;
      }
      minimum[i] = required[deque[head]];
    }
    // Box smoothing keeps the gain at or below what each sample requires.
    const smooth = new Float32Array(length);
    let acc = 0;
    const width = lookahead + 1;
    for (let i = 0; i < length + width; i++) {
      if (i < length) {
        acc += minimum[i];
      }
      if (i - width >= 0 && i - width < length) {
        acc -= minimum[i - width];
      }
      const center = i - Math.floor(width / 2);
      if (center >= 0 && center < length) {
        const count = Math.min(i, length - 1) - Math.max(0, i - width + 1) + 1;
        smooth[center] = Math.min(minimum[center], acc / count);
      }
    }
    const releaseCoeff = 1 - Math.exp(-1 / (sampleRate * 0.08));
    let gain = 1;
    const out = channels.map(function () {
      return new Float32Array(length);
    });
    for (let i = 0; i < length; i++) {
      gain = Math.min(smooth[i], gain + (1 - gain) * releaseCoeff);
      for (let c = 0; c < channels.length; c++) {
        out[c][i] = clamp(channels[c][i] * gain, -ceiling, ceiling);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ loudness (BS.1770-style approximation)

  function kWeighted(data, sampleRate) {
    const shelf = coefficients('highshelf', 1681.97, sampleRate, 0.7072, 3.9998);
    const highpass = coefficients('highpass', 38.135, sampleRate, 0.5003);
    return biquad(biquad(data, shelf), highpass, true);
  }

  function blockPowers(channels, sampleRate, blockSec, hopSec) {
    const weighted = channels.map(function (data) {
      return kWeighted(data, sampleRate);
    });
    const block = Math.round(blockSec * sampleRate);
    const hop = Math.round(hopSec * sampleRate);
    const length = channels[0].length;
    const powers = [];
    for (let start = 0; start + block <= length; start += hop) {
      let total = 0;
      for (let c = 0; c < weighted.length; c++) {
        let sum = 0;
        const data = weighted[c];
        for (let i = start; i < start + block; i++) {
          sum += data[i] * data[i];
        }
        total += sum / block;
      }
      powers.push(total);
    }
    return powers;
  }

  function powerToLufs(power) {
    return -0.691 + 10 * Math.log10(Math.max(power, 1e-12));
  }

  function integratedLoudness(channels, sampleRate) {
    const powers = blockPowers(channels, sampleRate, 0.4, 0.1);
    const absolute = powers.filter(function (p) {
      return powerToLufs(p) > -70;
    });
    if (!absolute.length) {
      return -70;
    }
    const mean = absolute.reduce(function (s, p) {
      return s + p;
    }, 0) / absolute.length;
    const relativeGate = powerToLufs(mean) - 10;
    const gated = absolute.filter(function (p) {
      return powerToLufs(p) > relativeGate;
    });
    const gatedMean = gated.reduce(function (s, p) {
      return s + p;
    }, 0) / Math.max(1, gated.length);
    return powerToLufs(gatedMean);
  }

  // ------------------------------------------------------------------ planning

  function trackTempo(track) {
    return (track.overrides && track.overrides.bpm) || track.analysis.bpm;
  }

  function trackKey(track) {
    return (track.overrides && track.overrides.key) || track.analysis.key;
  }

  function trackHook(track) {
    if (track.overrides && typeof track.overrides.hookSec === 'number') {
      return track.overrides.hookSec;
    }
    return track.analysis.hooks.length ? track.analysis.hooks[0].start : 0;
  }

  // Tempo ratio folded by octaves into [0.707, 1.414] so half/double-time
  // estimates never force an extreme stretch.
  function foldedTempoRatio(targetBpm, sourceBpm) {
    const raw = targetBpm / sourceBpm;
    return raw / Math.pow(2, Math.round(Math.log2(raw)));
  }

  function autoArrange(trackIds, mainId, layerIds, recipe, targetBpm) {
    const barSec = 240 / targetBpm;
    // Round to the nearest bar, not a four-bar minimum: short uploaded clips
    // must not be stretched into a much longer edit just by requesting 6–10 s.
    const totalBars = Math.max(1, Math.round(recipe.lengthSec / barSec));
    if (!recipe.mashup || !layerIds.length) {
      return [{ track: mainId, from: 'hook', offsetBars: 0, bars: totalBars }];
    }
    const segments = [];
    let used = 0;
    if (totalBars >= 12) {
      segments.push({ track: layerIds[0], from: 'hook', offsetBars: 0, bars: 2, filterIn: true });
      used += 2;
    }
    const mainFirst = Math.min(8, totalBars - used);
    segments.push({ track: mainId, from: 'hook', offsetBars: 0, bars: mainFirst });
    used += mainFirst;
    let layerIndex = totalBars >= 12 ? (layerIds.length > 1 ? 1 : 0) : 0;
    while (used < totalBars) {
      const remaining = totalBars - used;
      const layerBars = Math.min(4, remaining);
      segments.push({ track: layerIds[layerIndex % layerIds.length], from: 'hook', offsetBars: 0, bars: layerBars, riserBefore: true });
      used += layerBars;
      layerIndex++;
      if (used >= totalBars) {
        break;
      }
      const mainBars = Math.min(4, totalBars - used);
      // Returns to the main track pick up the second half of its hook.
      segments.push({ track: mainId, from: 'hook', offsetBars: 4, bars: mainBars });
      used += mainBars;
    }
    return segments;
  }

  function planRemix(tracks, recipeInput) {
    const recipe = makeRecipe(recipeInput);
    const warnings = [];
    const ids = Object.keys(tracks).filter(function (id) {
      return (tracks[id].role || 'layer') !== 'off';
    });
    if (!ids.length) {
      throw new Error('Add at least one track.');
    }
    if (ids.length > LIMITS.maxTracks) {
      throw new Error('Use at most ' + LIMITS.maxTracks + ' active tracks.');
    }
    ids.forEach(function (id) {
      const t = tracks[id];
      finiteNumber(trackTempo(t), 30, 300, 'Track BPM');
      const key = trackKey(t);
      if (!key || !Number.isInteger(key.pc) || key.pc < 0 || key.pc > 11 || !['major', 'minor'].includes(key.mode)) {
        throw new Error('Invalid key for ' + t.name);
      }
      finiteNumber(trackHook(t), 0, t.duration, 'Hook start');
      if (t.overrides && t.overrides.semitones !== undefined) {
        finiteNumber(t.overrides.semitones, -6, 6, 'Pitch nudge');
      }
    });
    if (recipe.mainId && !ids.includes(recipe.mainId)) {
      throw new Error('The recipe main track is missing or switched off.');
    }
    let mainId = recipe.mainId;
    if (!mainId) {
      mainId = ids.filter(function (id) {
        return tracks[id].role === 'main';
      })[0] || ids[0];
    }
    const layerIds = ids.filter(function (id) {
      return id !== mainId && tracks[id].role !== 'off';
    });
    const main = tracks[mainId];
    const mainBpm = trackTempo(main);
    const targetBpm = recipe.targetBpm || mainBpm * recipe.tempo;
    const mainRatio = targetBpm / mainBpm;
    finiteNumber(targetBpm, 40, 240, 'Output BPM');
    finiteNumber(mainRatio, 0.5, 2, 'Main tempo ratio');
    ids.forEach(function (id) {
      if (tracks[id].sampleRate !== main.sampleRate) {
        throw new Error('All tracks must share one sample rate. Re-import them in the same session.');
      }
    });
    if (recipe.mashup && !layerIds.length) {
      warnings.push('No mash-in tracks are active; rendering the main track only.');
    }
    const mainSemis = (recipe.mode === 'coupled' ? 12 * Math.log2(mainRatio) : recipe.semitones) + ((main.overrides || {}).semitones || 0);
    const mainKey = trackKey(main);
    const targetPc = majorEquivalent(mainKey) + mainSemis;
    const segmentsInput = recipe.segments && recipe.segments.length ? recipe.segments : autoArrange(ids, mainId, layerIds, recipe, targetBpm);

    const trackPlans = {};
    function planFor(id) {
      if (trackPlans[id]) {
        return trackPlans[id];
      }
      const track = tracks[id];
      const bpm = trackTempo(track);
      const isMain = id === mainId;
      // The main track keeps its exact ratio; layers fold half/double time.
      const ratio = isMain ? mainRatio : foldedTempoRatio(targetBpm, bpm);
      let semis;
      if (isMain) {
        semis = mainSemis;
      } else if (recipe.keyMatch) {
        semis = wrapSemitones(targetPc - majorEquivalent(trackKey(track)));
      } else {
        semis = mainSemis;
      }
      if (!isMain && track.overrides && typeof track.overrides.semitones === 'number') {
        semis += track.overrides.semitones;
      }
      trackPlans[id] = {
        id: id,
        name: track.name || id,
        sourceBpm: bpm,
        effectiveSourceBpm: targetBpm / ratio,
        tempoRatio: ratio,
        semitones: Math.round(semis * 100) / 100,
        key: keyName(trackKey(track)),
        hookSec: trackHook(track),
      };
      return trackPlans[id];
    }

    const barSec = 240 / targetBpm;
    let barCursor = 0;
    const plannedSeconds = segmentsInput.reduce(function (sum, s) { return sum + s.bars * barSec; }, 0);
    finiteNumber(plannedSeconds, 1, LIMITS.maxOutputSeconds, 'Rendered duration');
    planFor(mainId);
    const segments = segmentsInput.map(function (seg, index) {
      if (!ids.includes(seg.track)) {
        throw new Error('Segment ' + (index + 1) + ' references a missing or disabled track.');
      }
      const tp = planFor(seg.track);
      const sourceBarSec = 240 / tp.effectiveSourceBpm;
      const base = seg.from === 'time' && typeof seg.startSec === 'number' ? seg.startSec : tp.hookSec;
      let sourceStart = base + (seg.offsetBars || 0) * sourceBarSec;
      if (recipe.snapToBeats && seg.from !== 'time') {
        sourceStart = refineBeatNear(tracks[seg.track], sourceStart, sourceBarSec / 4);
      }
      const sourceDuration = tracks[seg.track].duration;
      const preSeconds = index ? recipe.xfadeBeats * 30 / targetBpm : 0;
      const postSeconds = index === segmentsInput.length - 1 ? (recipe.loop ? 30 / targetBpm : 0) : recipe.xfadeBeats * 30 / targetBpm;
      const requiredSource = (seg.bars * barSec + postSeconds) * tp.tempoRatio;
      const minimum = preSeconds * tp.tempoRatio;
      const latest = sourceDuration - requiredSource - 0.1;
      if (latest < minimum) {
        throw new Error(tp.name + ' is too short for segment ' + (index + 1) + '. Use fewer bars or a longer recording.');
      }
      if (sourceStart < minimum || sourceStart > latest) {
        if (seg.from === 'time') {
          throw new Error('Segment ' + (index + 1) + ' exceeds the available audio. Move its start or reduce its bars.');
        }
        const adjusted = clamp(sourceStart, minimum, latest);
        sourceStart = adjusted;
        warnings.push('Segment ' + (index + 1) + ': hook moved to ' + adjusted.toFixed(1) + ' s to fit the audio; listen before export.');
      }
      const planned = {
        track: seg.track,
        name: tp.name,
        bars: seg.bars,
        startBar: barCursor,
        outStartSec: barCursor * barSec,
        outLengthSec: seg.bars * barSec,
        sourceStartSec: seg.from === 'time' ? sourceStart : Math.round(sourceStart * 1000) / 1000,
        tempoRatio: tp.tempoRatio,
        semitones: tp.semitones,
        gainDb: seg.gainDb || 0,
        filterIn: !!seg.filterIn,
        riserBefore: !!seg.riserBefore,
      };
      barCursor += seg.bars;
      return planned;
    });
    if (!segments.length) {
      throw new Error('The arrangement is empty.');
    }
    const finalKey = { pc: ((Math.round(targetPc) % 12) + 12) % 12, mode: 'major' };
    return {
      recipe: recipe,
      warnings: warnings,
      mainId: mainId,
      targetBpm: Math.round(targetBpm * 100) / 100,
      targetKey: keyName(mainKey.mode === 'minor' ? { pc: (finalKey.pc + 9) % 12, mode: 'minor' } : finalKey) + (Math.abs(targetPc - Math.round(targetPc)) >= 0.05 ? ' (detuned)' : ''),
      barSec: barSec,
      totalBars: barCursor,
      durationSec: barCursor * barSec,
      tracks: trackPlans,
      segments: segments,
    };
  }

  // ------------------------------------------------------------------ rendering

  function riser(length, sampleRate, peak) {
    const random = seededRandom(4242);
    const noise = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      noise[i] = random() * 2 - 1;
    }
    sweepFilter(noise, sampleRate, 'bandpass', 300, 7000, length + 1, 2.5);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      noise[i] *= peak * t * t;
    }
    return noise;
  }

  function master(channels, sampleRate, fx) {
    let out = channels.map(function (data) {
      return biquad(data, coefficients('highpass', 30, sampleRate, 0.7071));
    });
    if (fx.bass) {
      out = out.map(function (data) {
        return biquad(data, coefficients('lowshelf', 105, sampleRate, 0.7071, fx.bass), true);
      });
    }
    if (fx.air) {
      out = out.map(function (data) {
        return biquad(data, coefficients('highshelf', 9000, sampleRate, 0.7071, fx.air), true);
      });
    }
    out = lofi(out, sampleRate, fx.lofi);
    out = eightD(out, sampleRate, fx.eightD);
    out = reverb(out, sampleRate, fx.reverb, fx.room);
    out = compressor(out, sampleRate, -18, 2.2, 12, 140);
    return out;
  }

  function renderRemix(tracks, recipeInput, onProgress) {
    const progress = typeof onProgress === 'function' ? onProgress : function () {};
    const plan = planRemix(tracks, recipeInput);
    const recipe = plan.recipe;
    const sampleRate = tracks[plan.mainId].sampleRate;
    const beatSamples = (60 / plan.targetBpm) * sampleRate;
    const crossfade = Math.round(recipe.xfadeBeats * beatSamples);
    const half = crossfade >> 1;
    const loopTail = recipe.loop ? Math.max(64, Math.round(beatSamples * 0.5)) : 0;
    const totalLength = Math.round(plan.durationSec * sampleRate);
    const bufferLength = totalLength + Math.max(half, loopTail) + 16;
    const mix = [new Float32Array(bufferLength), new Float32Array(bufferLength)];
    const count = plan.segments.length;

    plan.segments.forEach(function (seg, index) {
      progress({ stage: 'segment', index: index, count: count });
      const track = tracks[seg.track];
      const isFirst = index === 0;
      const isLast = index === count - 1;
      const pre = isFirst ? 0 : half;
      let post = isLast ? loopTail : half;
      const outStart = Math.round(seg.outStartSec * sampleRate);
      const outLength = Math.round(seg.outLengthSec * sampleRate);
      const needOut = pre + outLength + post;
      const sourceStart = Math.round((seg.sourceStartSec - (pre / sampleRate) * seg.tempoRatio) * sampleRate);
      const sourceLength = Math.ceil(needOut * seg.tempoRatio) + 4096;
      const raw = sliceChannels(track.channels, sourceStart, sourceStart + sourceLength);
      let processed = transform(raw, sampleRate, seg.tempoRatio, seg.semitones);
      processed = processed.map(function (data) {
        if (data.length >= needOut) {
          return data.subarray(0, needOut);
        }
        const padded = new Float32Array(needOut);
        padded.set(data);
        return padded;
      });
      const gain = dbToGain(seg.gainDb);
      if (seg.filterIn) {
        processed = processed.map(function (data) {
          return sweepFilter(new Float32Array(data), sampleRate, 'highpass', 650, 25, Math.round(plan.barSec * sampleRate) + pre, 0.7071);
        });
      }
      const fadeIn = isFirst ? (recipe.loop ? loopTail : 64) : 2 * pre;
      const fadeOut = isLast ? (recipe.loop ? post : Math.round(beatSamples)) : 2 * post;
      if (isLast && !recipe.loop) {
        post = 0;
      }
      for (let c = 0; c < 2; c++) {
        const data = processed[c];
        const target = mix[c];
        for (let i = 0; i < needOut; i++) {
          let g = gain;
          if (i < fadeIn) {
            g *= Math.sin((0.5 * Math.PI * (i + 0.5)) / fadeIn);
          }
          const fromEnd = needOut - i;
          if (fromEnd <= fadeOut) {
            g *= Math.sin((0.5 * Math.PI * (fromEnd - 0.5)) / fadeOut);
          }
          const at = outStart - pre + i;
          if (at >= 0 && at < bufferLength) {
            target[at] += data[i] * g;
          }
        }
      }
      if (seg.riserBefore && !isFirst) {
        const riseLength = Math.round(plan.barSec * sampleRate);
        const swell = riser(riseLength, sampleRate, 0.14);
        const riseStart = outStart - riseLength;
        for (let i = 0; i < riseLength; i++) {
          const at = riseStart + i;
          if (at >= 0) {
            mix[0][at] += swell[i];
            mix[1][at] += swell[i];
          }
        }
      }
    });

    progress({ stage: 'master' });
    let out = master(mix, sampleRate, recipe.fx || {});
    if (recipe.loop && loopTail > 0) {
      // Fold the faded-out tail over the faded-in start: seamless platform loop.
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < loopTail; i++) {
          out[c][i] += out[c][totalLength + i];
        }
      }
    }
    out = out.map(function (data) {
      return new Float32Array(data.subarray(0, totalLength));
    });
    progress({ stage: 'loudness' });
    if (peakOf(out) < 0.00001 || hasInvalidSamples(out)) {
      throw new Error('Selected segments are silent or invalid. Pick audible source regions.');
    }
    const loudness = integratedLoudness(out, sampleRate);
    const targetLufs = recipe.targetLufs;
    const makeup = dbToGain(clamp(targetLufs - loudness, -24, 24));
    out.forEach(function (data) {
      for (let i = 0; i < data.length; i++) {
        data[i] *= makeup;
      }
    });
    out = limiter(out, sampleRate, dbToGain(-1));
    if (!recipe.loop) {
      const fade = Math.min(out[0].length, Math.round(sampleRate * 0.015));
      out.forEach(function (c) {
        for (let i = 0; i < fade; i++) {
          c[c.length - fade + i] *= (fade - 1 - i) / Math.max(1, fade - 1);
        }
      });
    }
    const score = editScore(out, sampleRate, plan);
    return { channels: out, sampleRate: sampleRate, plan: plan, score: score };
  }

  // ------------------------------------------------------------------ editing checklist (unvalidated)

  function editScore(channels, sampleRate, plan) {
    const duration = channels[0].length / sampleRate;
    const blocks = blockPowers(channels, sampleRate, 0.4, 0.1).map(powerToLufs);
    const loudness = integratedLoudness(channels, sampleRate);
    const loudest = blocks.length ? Math.max.apply(null, blocks) : -70;
    let hookTime = duration;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] >= loudest - 6) {
        hookTime = i * 0.1;
        break;
      }
    }
    const style = plan.recipe.style || 'remix';
    const bpm = plan.targetBpm;
    function band(value, idealLo, idealHi, zeroLo, zeroHi) {
      if (value >= idealLo && value <= idealHi) {
        return 1;
      }
      if (value < idealLo) {
        return clamp((value - zeroLo) / (idealLo - zeroLo), 0, 1);
      }
      return clamp((zeroHi - value) / (zeroHi - idealHi), 0, 1);
    }
    // Trend fit is judged on both the absolute tempo and the change versus the
    // original: a ×0.85 slowed edit reads as "slowed" even when the song is fast.
    const mainPlan = plan.tracks[plan.mainId];
    const ratio = mainPlan ? mainPlan.tempoRatio : 1;
    let tempoScore;
    if (style === 'slowed') {
      tempoScore = Math.max(band(bpm, 62, 95, 45, 125), band(ratio, 0.75, 0.9, 0.6, 1));
    } else if (style === 'sped') {
      tempoScore = Math.max(band(bpm, 125, 180, 95, 210), band(ratio, 1.15, 1.4, 1, 1.7));
    } else {
      tempoScore = Math.max(band(bpm, 110, 175, 80, 205), band(bpm, 65, 92, 50, 105) * 0.85);
    }
    // Loop seam: compare loudness and samples either side of the wrap point.
    // Short windows: a seamless loop means no click or bump at the wrap instant;
    // a deliberately filtered intro bar a second later is musical, not a seam.
    const seamWindow = Math.round(0.15 * sampleRate);
    function rmsOf(data, start, end) {
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += data[i] * data[i];
      }
      return Math.sqrt(sum / Math.max(1, end - start));
    }
    const mono = toMono(channels);
    const headRms = rmsOf(mono, 0, Math.min(mono.length, seamWindow));
    const tailRms = rmsOf(mono, Math.max(0, mono.length - seamWindow), mono.length);
    const levelJump = Math.abs(gainToDb(headRms + 1e-6) - gainToDb(tailRms + 1e-6));
    const sampleJump = Math.abs(mono[0] - mono[mono.length - 1]);
    const loopScore = plan.recipe.loop ? clamp(1 - levelJump / 12 - sampleJump * 2, 0, 1) : clamp(0.5 - levelJump / 24, 0, 0.5);
    const sorted = blocks.slice().sort(function (a, b) {
      return a - b;
    });
    const quiet = sorted.length ? sorted[Math.floor(sorted.length * 0.05)] : -70;
    const loud = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : -70;
    const contrast = loud - quiet;
    const factors = [
      {
        key: 'hook', label: 'Hook in first seconds', weight: 0.22,
        value: hookTime.toFixed(1) + ' s', score: band(hookTime, 0, 1.2, -1, 4.5),
        tip: 'Start on the chorus or drop — viewers decide in the first 1–2 seconds.',
      },
      {
        key: 'loop', label: 'Loop seam check', weight: 0.18,
        value: plan.recipe.loop ? 'folded, Δ ' + levelJump.toFixed(1) + ' dB' : 'off', score: loopScore,
        tip: plan.recipe.loop ? 'The start and end differ in level — drop the filter-in on bar 1 or start straight on the hook for a smoother replay.' : 'Turn on loop folding so the sound replays without a bump.',
      },
      {
        key: 'length', label: 'Short-form length', weight: 0.15,
        value: duration.toFixed(1) + ' s', score: band(duration, 12, 35, 5, 62),
        tip: 'Aim for 12–35 s: long enough for a trend, short enough to loop.',
      },
      {
        key: 'tempo', label: 'Style tempo fit', weight: 0.15,
        value: Math.round(bpm) + ' BPM (' + style + ')', score: tempoScore,
        tip: style === 'slowed' ? 'Slowed edits land best around ×0.75–0.9 of the original (or 65–95 BPM).' : 'Sped-up edits usually sit at ×1.15–1.4 of the original (125–180 BPM).',
      },
      {
        key: 'energy', label: 'Energy lift', weight: 0.12,
        value: contrast.toFixed(1) + ' LU range', score: band(contrast, 3, 9, 0.5, 16),
        tip: 'Give it a lift: a quieter intro bar or a riser into the chorus creates a payoff.',
      },
      {
        key: 'loudness', label: 'Loudness', weight: 0.10,
        value: loudness.toFixed(1) + ' LUFS (approx)', score: clamp(1 - Math.abs(loudness - plan.recipe.targetLufs) / 8, 0, 1),
        tip: 'Measured loudness differs from your target; lower FX or source gain and listen. This is not a certified LUFS/true-peak meter.',
      },

    ];
    let total = 0;
    const totalWeight = factors.reduce(function (sum, f) { return sum + f.weight; }, 0);
    factors.forEach(function (f) {
      f.score = Math.round(f.score * 100) / 100;
      total += f.score * f.weight;
    });
    const score = Math.round(total / totalWeight * 100);
    const grade = score >= 85 ? 'Most edit checks met' : score >= 70 ? 'Some edit checks met' : 'Review this edit';
    const tips = factors.filter(function (f) {
      return f.score < 0.7;
    }).map(function (f) {
      return f.tip;
    });
    return { score: score, grade: grade, factors: factors, tips: tips, loudness: Math.round(loudness * 10) / 10, hookTime: hookTime };
  }

  // ------------------------------------------------------------------ request parsing

  function parseRequest(text, context) {
    const ctx = context || {};
    const input = String(text || '').slice(0, 2000);
    let lower = input.toLowerCase();
    const disabled = [];
    const negatives = /\b(?:no|without|skip|avoid|don['’]?t(?: add| use)?)\s+(reverb|echo|bass(?: boost(?:ed)?)?|8d|lo-?fi|mashup|mash-up|loop(?:ing)?|pitch(?: shift)?|speed(?: change)?)\b/g;
    lower = lower.replace(negatives, function (match, effect) {
      disabled.push(effect.replace(/[- ]/g, ''));
      return ' ';
    });
    const patch = { fx: {} };
    const notes = [];
    const has = function (re) {
      return re.test(lower);
    };
    let intensity = 1;
    if (has(/\b(a bit|a little|slightly|little|subtle|lightly|kinda)\b/)) {
      intensity = 0.6;
    }
    if (has(/\b(very|super|extra|really|max|maximum|way|insanely|crazy)\b/)) {
      intensity = 1.5;
    }
    const slowedReverb = has(/slowed\s*(\+|and|&|n)?\s*reverb/);
    const nightcore = has(/\bnightcore\b/);
    const daycore = has(/\bdaycore\b/);
    const keepPitch = has(/\b(keep|same|original|natural)\s+(the\s+)?(pitch|key|vocals?)\b|\bno chipmunk\b/);
    const faster = has(/\b(fast|faster|sped\s*up|speed\s*(it\s*)?up|speedup|quicker|hype|hyper|energetic|upbeat|tempo up)\b/) || nightcore;
    const slower = has(/\b(slow|slower|slowed|chill|calm|sad|tempo down)\b/) || daycore || slowedReverb;
    const higher = has(/\b(high|higher|pitch(ed)?\s*up|chipmunk|helium|squeaky|nightcore|cute)\b|high notes?|higher notes?/);
    const lower_ = has(/\b(low|lower|deep|deeper|pitch(ed)?\s*down|daycore|darker)\b|low notes?|lower notes?/);

    if (faster && !slower) {
      patch.tempo = Math.round(clamp(1 + 0.2 * intensity, 1.05, 1.5) * 100) / 100;
      patch.style = 'sped';
      notes.push('Faster: tempo ×' + patch.tempo.toFixed(2));
    } else if (slower && !faster) {
      patch.tempo = Math.round(clamp(1 - 0.15 * intensity, 0.6, 0.95) * 100) / 100;
      patch.style = 'slowed';
      notes.push('Slower: tempo ×' + patch.tempo.toFixed(2));
    }
    if (nightcore || daycore || slowedReverb) {
      patch.mode = 'coupled';
      notes.push('Classic speed change: pitch follows tempo');
      if (nightcore && !patch.tempo) {
        patch.tempo = 1.25;
      }
      if (slowedReverb) {
        patch.tempo = Math.min(patch.tempo || 1, 0.85);
      }
    } else if (higher && !lower_ && !keepPitch) {
      patch.semitones = Math.round(clamp(3 * intensity, 1, 7) * 2) / 2;
      notes.push('Higher: +' + patch.semitones + ' semitones');
    } else if (lower_ && !higher && !keepPitch) {
      patch.semitones = -Math.round(clamp(3 * intensity, 1, 7) * 2) / 2;
      notes.push('Lower: ' + patch.semitones + ' semitones');
    }
    if (keepPitch) {
      patch.mode = 'independent';
      patch.semitones = 0;
      notes.push('Keeps the original pitch');
    }
    // Explicit numbers win over adjectives.
    let m = lower.match(/(?:^|[^\w.])([+-]?\d+(?:\.\d+)?)\s*(semitones?|semis?|st)\b/);
    if (m) {
      patch.semitones = finiteNumber(parseFloat(m[1]), -12, 12, 'Requested pitch');
      if (m[1][0] !== '-' && /\b(?:down|lower|deeper)\b/.test(lower)) {
        patch.semitones = -Math.abs(patch.semitones);
      }
      patch.mode = 'independent';
      notes.push('Pitch ' + (patch.semitones > 0 ? '+' : '') + patch.semitones + ' st');
    }
    m = lower.match(/\b(\d+(?:\.\d+)?)\s*x\b/);
    if (m) {
      patch.tempo = finiteNumber(parseFloat(m[1]), 0.5, 2, 'Requested tempo');
      notes.push('Tempo ×' + patch.tempo);
    }
    m = lower.match(/(\d+)\s*%\s*(faster|quicker|speed)/);
    if (m) {
      patch.tempo = 1 + parseInt(m[1], 10) / 100;
      notes.push('Tempo +' + m[1] + '%');
    }
    m = lower.match(/(\d+)\s*%\s*(slower)/);
    if (m) {
      patch.tempo = 1 - parseInt(m[1], 10) / 100;
      notes.push('Tempo −' + m[1] + '%');
    }
    m = lower.match(/\b(\d{2,3}(?:\.\d+)?)\s*bpm/);
    if (m) {
      patch.targetBpm = parseFloat(m[1]);
      notes.push('Target ' + patch.targetBpm + ' BPM');
    }
    m = lower.match(/\b(\d{1,4})\s+(sec|secs|seconds?)\b|\b(\d{1,2})\s*s\b/);
    if (m) {
      patch.lengthSec = finiteNumber(parseInt(m[1] || m[3], 10), 6, 60, 'Requested length');
      notes.push('Length ' + patch.lengthSec + ' s');
    }
    if (has(/\b(reverb|dreamy|ethereal|echo|spacey|spacious|atmospheric)\b/) || slowedReverb) {
      patch.fx.reverb = Math.round(clamp((slowedReverb ? 0.45 : 0.3) * intensity, 0.1, 0.8) * 100) / 100;
      notes.push('Reverb ' + Math.round(patch.fx.reverb * 100) + '%');
    }
    if (has(/\b(bass|boosted|phonk|thump|thumping|punchy|808)\b/)) {
      patch.fx.bass = Math.round(clamp(5 * intensity, 2, 9));
      notes.push('Bass +' + patch.fx.bass + ' dB');
    }
    if (has(/\b8\s*d\b|\b(spatial|surround|headphones?)\b/)) {
      patch.fx.eightD = 0.8;
      notes.push('8D panning');
    }
    if (has(/\b(lo-?fi|vintage|cassette|vinyl|tape|retro|old school|old-school)\b/)) {
      patch.fx.lofi = Math.round(clamp(0.4 * intensity, 0.2, 0.8) * 100) / 100;
      notes.push('Lo-fi ' + Math.round(patch.fx.lofi * 100) + '%');
    }
    if (has(/\b(bright|crisp|sparkle|airy|clear)\b/) || patch.style === 'sped') {
      patch.fx.air = has(/\b(bright|crisp|sparkle|airy|clear)\b/) ? 3 : 1.5;
    }
    const wantsMashup = has(/\b(nostalgi\w*|throwback|mashup|mash-up|mash up|medley|blend|mix (it )?with|remix (it )?into|other songs|related songs|2000s|00s|90s|emo|pop[- ]punk)\b/);
    if (wantsMashup) {
      if ((ctx.trackCount || 0) > 1) {
        patch.mashup = true;
        notes.push('Mashup: blends ' + (ctx.trackCount - 1) + ' more song' + (ctx.trackCount > 2 ? 's' : '') + ', tempo- and key-matched');
      } else {
        patch.mashup = true;
        notes.push('Mashup requested — upload the nostalgic songs to blend in');
      }
    }
    if (has(/\b(no loop|don't loop|dont loop)\b/)) {
      patch.loop = false;
    }
    if (has(/\b(tiktok|reels?|shorts?)\b/) && !patch.lengthSec) {
      patch.lengthSec = has(/\bshorts?\b/) ? 30 : 25;
    }
    disabled.forEach(function (effect) {
      if (effect === 'reverb' || effect === 'echo') { patch.fx.reverb = 0; }
      if (effect.startsWith('bass')) { patch.fx.bass = 0; }
      if (effect === '8d') { patch.fx.eightD = 0; }
      if (effect === 'lofi') { patch.fx.lofi = 0; }
      if (effect === 'mashup') { patch.mashup = false; }
      if (effect.startsWith('loop')) { patch.loop = false; }
      if (effect.startsWith('pitch')) { patch.mode = 'independent'; patch.semitones = 0; }
      if (effect.startsWith('speed')) { patch.tempo = 1; patch.targetBpm = null; }
      notes.push('Explicitly disabled: ' + effect);
    });
    // Reject impossible explicit requests before they reach DSP allocations.
    makeRecipe(patch);
    if (!notes.length) {
      notes.push('No specific style found — making a clean, loop-ready hook edit');
    }
    return { patch: patch, notes: notes };
  }

  // ------------------------------------------------------------------ export helpers

  function encodeWav(channels, sampleRate) {
    const channelCount = channels.length;
    const length = channels[0].length;
    const dataBytes = length * channelCount * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    function writeString(offset, text) {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataBytes, true);
    const random = seededRandom(7);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < channelCount; c++) {
        const dither = (random() - random()) / 32768;
        const v = clamp(channels[c][i] + dither, -1, 1);
        view.setInt16(offset, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
        offset += 2;
      }
    }
    return buffer;
  }

  function base64FromBuffer(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = new Uint8Array(buffer);
    const parts = [];
    let chunk = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const triple = (b0 << 16) | (b1 << 8) | b2;
      chunk += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63];
      chunk += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
      chunk += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
      if (chunk.length > 65536) {
        parts.push(chunk);
        chunk = '';
      }
    }
    parts.push(chunk);
    return parts.join('');
  }

  function waveformPeaks(channels, buckets) {
    const mono = toMono(channels);
    const size = Math.max(1, Math.floor(mono.length / buckets));
    const peaks = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) {
      let min = 0;
      let max = 0;
      const start = b * size;
      const end = Math.min(mono.length, start + size);
      for (let i = start; i < end; i++) {
        const v = mono[i];
        if (v < min) {
          min = v;
        }
        if (v > max) {
          max = v;
        }
      }
      peaks[b * 2] = min;
      peaks[b * 2 + 1] = max;
    }
    return peaks;
  }

  function describePlan(plan) {
    const lines = [];
    lines.push('Output: ' + plan.targetBpm.toFixed(1) + ' BPM, ' + plan.targetKey + ', ' + plan.totalBars + ' bars = ' + plan.durationSec.toFixed(1) + ' s');
    Object.keys(plan.tracks).forEach(function (id) {
      const t = plan.tracks[id];
      const st = (t.semitones > 0 ? '+' : '') + t.semitones.toFixed(2).replace(/\.00$/, '') + ' st';
      lines.push((id === plan.mainId ? 'Main' : 'Layer') + ' — ' + t.name + ': ' + t.sourceBpm.toFixed(1) + ' BPM ×' + t.tempoRatio.toFixed(3) + ', ' + t.key + ' ' + st);
    });
    return lines;
  }

  // ------------------------------------------------------------------ session (shared by worker and main-thread fallback)

  function createSession() {
    const store = Object.create(null);
    return {
      addTrack: function (id, channels, sampleRate, name) {
        const track = prepareTrack(channels, sampleRate);
        track.name = name || id;
        track.analysis = analyzeTrack(track);
        store[id] = track;
        return track.analysis;
      },
      restoreTrack: function (id, channels, sampleRate, name, analysis) {
        const track = prepareTrack(channels, sampleRate);
        track.name = name;
        track.analysis = analysis || analyzeTrack(track);
        store[id] = track;
        return track.analysis;
      },
      removeTrack: function (id) {
        delete store[id];
        return true;
      },
      render: function (settings, recipe) {
        const tracks = {};
        Object.keys(settings).forEach(function (id) {
          if (!store[id]) {
            throw new Error('Track data unavailable. Re-import the missing audio.');
          }
          const s = settings[id];
          tracks[id] = {
            channels: store[id].channels,
            sampleRate: store[id].sampleRate,
            duration: store[id].duration,
            decimated: store[id].decimated,
            analysis: store[id].analysis,
            name: s.name || store[id].name,
            role: s.role || 'layer',
            overrides: s.overrides || {},
          };
        });
        return renderRemix(tracks, recipe);
      },
      has: function (id) {
        return !!store[id];
      },
    };
  }

  return {
    VERSION: VERSION,
    LIMITS: LIMITS,
    validateAudio: validateAudio,
    DEFAULT_RECIPE: DEFAULT_RECIPE,
    makeRecipe: makeRecipe,
    deepMerge: deepMerge,
    keyName: keyName,
    parseKey: parseKey,
    majorEquivalent: majorEquivalent,
    wrapSemitones: wrapSemitones,
    ratioFromSemitones: ratioFromSemitones,
    seededRandom: seededRandom,
    toMono: toMono,
    peakOf: peakOf,
    hasInvalidSamples: hasInvalidSamples,
    fft: fft,
    decimate: decimate,
    onsetEnvelope: onsetEnvelope,
    estimateTempo: estimateTempo,
    estimateKey: estimateKey,
    prepareTrack: prepareTrack,
    analyzeTrack: analyzeTrack,
    refineBeatNear: refineBeatNear,
    timeStretch: timeStretch,
    resample: resample,
    transform: transform,
    coefficients: coefficients,
    biquad: biquad,
    reverb: reverb,
    eightD: eightD,
    lofi: lofi,
    limiter: limiter,
    integratedLoudness: integratedLoudness,
    foldedTempoRatio: foldedTempoRatio,
    autoArrange: autoArrange,
    planRemix: planRemix,
    renderRemix: renderRemix,
    editScore: editScore,
    parseRequest: parseRequest,
    encodeWav: encodeWav,
    base64FromBuffer: base64FromBuffer,
    waveformPeaks: waveformPeaks,
    describePlan: describePlan,
    createSession: createSession,
  };
});
