/* AIRIZ Console 1.10.0 - voice link core: talk to the AIRIZ speaker, listen to its microphone.
 *
 * The AIRIZ is reached over a 115200-baud USB serial console (about 11.5 kB/s each way) and a
 * BusyBox shell. Its own sound format (16 kHz, 16-bit, stereo = 64 kB/s) is far too big for that
 * link, so both directions use 8 kHz mono IMA ADPCM (4 kB/s) as text:
 *   Talk:   phone / PC microphone -> 8 kHz -> ADPCM -> base64 -> PC -> serial ("head -c") ->
 *           AIRIZ: base64 -d, md5 check, awk decoder (talk.awk) -> WAV -> diag audio play.
 *           A message is sent first and then played (a few seconds after it was recorded).
 *   Listen: AIRIZ: back-to-back clips with diag audio record; awk (enc.awk) turns each
 *           clip into text lines "@AU1,..." (about 50 % of the serial link) -> PC -> phones.
 *           Each clip is heard after it has been recorded (clip length + about 2 s behind),
 *           with a short gap between clips. The clip length is a setting (1.11.2: any length).
 * The device scripts below only use + - * / int() substr() in awk (no bit operations, no
 * binary output), so any BusyBox awk can run them. Everything here is plain computation:
 * no DOM, no serial port. Loaded as a plain script (window.AirizAudioLink) and by Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AirizAudioLink = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const VERSION = '1.10.0';
  const PROTOCOL = 1;                 // audio messages between phone and PC (remote-control v3)
  const LINK_BYTES_PER_SECOND = 11520; // 115200 baud, 8N1
  const RATE = 8000;                  // talk and listen sample rate on the wire
  const BLOCK_SAMPLES = 504;          // listen frame size (63 ms)
  const MAX_TALK_SECONDS = 15;
  // 1.11.2: Listen clips can be as long as you like (each clip is heard after it has been
  // recorded); listen.sh refuses a clip that does not fit in the AIRIZ /tmp.
  const MIN_LISTEN_SECONDS = 1;
  const MAX_LISTEN_SECONDS = 3600;
  const MIN_TALK_SECONDS = 0.4;
  const DEVICE_DIR = '/tmp/airiz';
  const LISTEN_DIR = DEVICE_DIR + '/listen';
  const TALK_B64 = DEVICE_DIR + '/talk.b64';
  const TALK_ADPCM = DEVICE_DIR + '/talk.adp';
  const TALK_WAV = DEVICE_DIR + '/talk.wav';
  const RECORDER_OUTPUT = '/tmp/dmic_record_output.wav';
  const DEFAULT_RECORD_COMMAND = 'diag audio record -p -t {s} -v {gain}';
  const DEFAULT_PLAY_COMMAND = 'diag audio play {file}';
  const TALK_CHUNK_CHARS = 6000;      // phone -> PC message size (the relay allows 8 kB)
  const UPLOAD_LINE_CHARS = 1000;     // one line of base64 for "head -c" (the tty allows 4095)
  const FALLBACK_LINE_CHARS = 512;    // "echo ... >> file" lines (same size as the Bluetooth installer)
  const FORMATS = Object.freeze({
    'stereo16': Object.freeze({ rate: 16000, channels: 2, label: '16 kHz stereo (like the test WAV)' }),
    'mono16': Object.freeze({ rate: 16000, channels: 1, label: '16 kHz mono (faster)' }),
    'mono8': Object.freeze({ rate: 8000, channels: 1, label: '8 kHz mono (fastest)' }),
  });

  const STEP_TABLE = Object.freeze([
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
    11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
  ]);
  const INDEX_ADJUST = Object.freeze([-1, -1, -1, -1, 2, 4, 6, 8]);

  // ------------------------------------------------------------------ IMA ADPCM
  function encodeSample(state, sample) {
    const step = STEP_TABLE[state.index];
    let diff = sample - state.pred;
    let code = 0;
    if (diff < 0) {
      code = 8;
      diff = -diff;
    }
    let vpdiff = step >> 3;
    if (diff >= step) {
      code |= 4;
      diff -= step;
      vpdiff += step;
    }
    const half = step >> 1;
    if (diff >= half) {
      code |= 2;
      diff -= half;
      vpdiff += half;
    }
    const quarter = step >> 2;
    if (diff >= quarter) {
      code |= 1;
      vpdiff += quarter;
    }
    let pred = (code & 8) ? state.pred - vpdiff : state.pred + vpdiff;
    if (pred > 32767) pred = 32767;
    else if (pred < -32768) pred = -32768;
    let index = state.index + INDEX_ADJUST[code & 7];
    if (index < 0) index = 0;
    else if (index > 88) index = 88;
    state.pred = pred;
    state.index = index;
    return code;
  }

  function decodeSample(state, code) {
    const step = STEP_TABLE[state.index];
    let vpdiff = step >> 3;
    if (code & 4) vpdiff += step;
    if (code & 2) vpdiff += step >> 1;
    if (code & 1) vpdiff += step >> 2;
    let pred = (code & 8) ? state.pred - vpdiff : state.pred + vpdiff;
    if (pred > 32767) pred = 32767;
    else if (pred < -32768) pred = -32768;
    let index = state.index + INDEX_ADJUST[code & 7];
    if (index < 0) index = 0;
    else if (index > 88) index = 88;
    state.pred = pred;
    state.index = index;
    return pred;
  }

  // Int16 samples -> bytes, low nibble first. An odd count gets a 0 nibble the decoder ignores.
  function encodeAdpcm(samples, state) {
    const coder = state || { pred: 0, index: 0 };
    const bytes = new Uint8Array(Math.ceil(samples.length / 2));
    for (let i = 0; i < samples.length; i += 2) {
      const low = encodeSample(coder, samples[i]);
      const high = i + 1 < samples.length ? encodeSample(coder, samples[i + 1]) : 0;
      bytes[i >> 1] = low | (high << 4);
    }
    return bytes;
  }

  function decodeAdpcm(bytes, count, state) {
    const coder = state || { pred: 0, index: 0 };
    const total = Math.min(count == null ? bytes.length * 2 : count, bytes.length * 2);
    const samples = new Int16Array(total);
    for (let i = 0; i < total; i++) {
      const byte = bytes[i >> 1];
      samples[i] = decodeSample(coder, (i & 1) ? byte >> 4 : byte & 15);
    }
    return samples;
  }

  // ------------------------------------------------------------------ base64, text
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_INDEX = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
    return table;
  })();

  function bytesToBase64(bytes) {
    const parts = [];
    let chunk = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chunk += B64[value >> 18] + B64[(value >> 12) & 63] + B64[(value >> 6) & 63] + B64[value & 63];
      if (chunk.length >= 8192) {
        parts.push(chunk);
        chunk = '';
      }
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const value = bytes[i] << 16;
      chunk += B64[value >> 18] + B64[(value >> 12) & 63] + '==';
    } else if (rest === 2) {
      const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
      chunk += B64[value >> 18] + B64[(value >> 12) & 63] + B64[(value >> 6) & 63] + '=';
    }
    parts.push(chunk);
    return parts.join('');
  }

  // Strict: only the base64 alphabet (whitespace ignored). Returns null for anything else.
  function base64ToBytes(text) {
    const clean = String(text || '').replace(/[\s]/g, '');
    if (clean.length % 4 !== 0) return null;
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    const length = (clean.length / 4) * 3 - padding;
    const bytes = new Uint8Array(length);
    let out = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const values = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) {
        const code = clean.charCodeAt(i + j);
        if (code === 61 && i + j >= clean.length - padding) {
          values[j] = 0;
          continue;
        }
        const value = code < 128 ? B64_INDEX[code] : -1;
        if (value < 0) return null;
        values[j] = value;
      }
      const triple = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
      if (out < length) bytes[out++] = (triple >> 16) & 255;
      if (out < length) bytes[out++] = (triple >> 8) & 255;
      if (out < length) bytes[out++] = triple & 255;
    }
    return bytes;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text));
    return Uint8Array.from(Buffer.from(String(text), 'utf8'));
  }

  // ------------------------------------------------------------------ MD5 (RFC 1321)
  const MD5_SHIFT = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const MD5_K = (() => {
    const table = new Int32Array(64);
    for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    return table;
  })();

  function md5Hex(input) {
    const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
    const length = bytes.length;
    const total = (((length + 8) >> 6) + 1) * 64;
    const buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[length] = 0x80;
    const bits = length * 8;
    for (let i = 0; i < 8; i++) buffer[total - 8 + i] = Math.floor(bits / Math.pow(2, 8 * i)) & 255;
    let a0 = 0x67452301;
    let b0 = 0xefcdab89 | 0;
    let c0 = 0x98badcfe | 0;
    let d0 = 0x10325476;
    const words = new Int32Array(16);
    for (let offset = 0; offset < total; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        words[i] = buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16) | (buffer[p + 3] << 24);
      }
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let i = 0; i < 64; i++) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) & 15;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) & 15;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) & 15;
        }
        const temp = d;
        d = c;
        c = b;
        const sum = (a + f + MD5_K[i] + words[g]) | 0;
        b = (b + ((sum << MD5_SHIFT[i]) | (sum >>> (32 - MD5_SHIFT[i])))) | 0;
        a = temp;
      }
      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }
    let hex = '';
    for (const word of [a0, b0, c0, d0]) {
      for (let i = 0; i < 4; i++) hex += ((word >>> (8 * i)) & 255).toString(16).padStart(2, '0');
    }
    return hex;
  }

  // ------------------------------------------------------------------ resampling
  // Windowed-sinc (Blackman) low-pass at 90 % of the lower Nyquist, from a lookup table.
  const KERNEL_ZEROS = 8;
  const KERNEL_STEPS = 64;

  function kernelFor(fromRate, toRate) {
    const cutoff = 0.45 * Math.min(fromRate, toRate) / fromRate; // cycles per input sample
    const half = KERNEL_ZEROS / (2 * cutoff);                    // input samples each side
    const size = Math.ceil(half * KERNEL_STEPS) + 2;
    const table = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const t = i / KERNEL_STEPS;
      if (t > half) break;
      const x = 2 * cutoff * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const window = 0.42 + 0.5 * Math.cos(Math.PI * t / half) + 0.08 * Math.cos(2 * Math.PI * t / half);
      table[i] = 2 * cutoff * sinc * window;
    }
    return { table, half, ratio: fromRate / toRate };
  }

  function sampleAt(input, position, kernel) {
    const { table, half } = kernel;
    const start = Math.max(0, Math.ceil(position - half));
    const end = Math.min(input.length - 1, Math.floor(position + half));
    let acc = 0;
    for (let k = start; k <= end; k++) {
      const t = Math.abs(k - position) * KERNEL_STEPS;
      const i = t | 0;
      const frac = t - i;
      const h = table[i] + (table[i + 1] - table[i]) * frac;
      acc += input[k] * h;
    }
    return acc;
  }

  function resample(input, fromRate, toRate) {
    if (fromRate === toRate) return Float32Array.from(input);
    const kernel = kernelFor(fromRate, toRate);
    const length = Math.floor(input.length / kernel.ratio);
    const output = new Float32Array(length);
    for (let n = 0; n < length; n++) output[n] = sampleAt(input, n * kernel.ratio, kernel);
    return output;
  }

  // Streaming version for playback: feed contiguous chunks, get resampled chunks back.
  function createStreamResampler(fromRate, toRate) {
    const kernel = kernelFor(fromRate, toRate);
    let buffer = new Float32Array(0);
    let position = 0;
    function run(final) {
      const out = [];
      // final: every position inside the input (same count as the one-shot resample)
      const limit = final ? buffer.length : buffer.length - 1 - kernel.half;
      while (final ? position < limit : position <= limit) {
        out.push(sampleAt(buffer, position, kernel));
        position += kernel.ratio;
      }
      const drop = Math.max(0, Math.floor(position - kernel.half) - 1);
      if (drop > 0) {
        buffer = buffer.slice(Math.min(drop, buffer.length));
        position -= Math.min(drop, position);
      }
      return Float32Array.from(out);
    }
    return {
      process(chunk) {
        const merged = new Float32Array(buffer.length + chunk.length);
        merged.set(buffer);
        merged.set(chunk, buffer.length);
        buffer = merged;
        return run(false);
      },
      flush() {
        const out = run(true);
        buffer = new Float32Array(0);
        position = 0;
        return out;
      },
      reset() {
        buffer = new Float32Array(0);
        position = 0;
      },
    };
  }

  // ------------------------------------------------------------------ voice preparation
  // 8 kHz float samples (-1..1) -> clean Int16 voice: 150 Hz high-pass, silence trimmed,
  // level evened out (at most +24 dB), soft limiter, short fades.
  function prepareVoice(samples, options) {
    const settings = options || {};
    const rate = settings.rate || RATE;
    const n = samples.length;
    const out = new Float32Array(n);
    // 4th-order Butterworth high-pass: two RBJ biquads (small speakers cannot play the
    // rumble and mains hum anyway, and removing it leaves more room for the voice)
    out.set(samples);
    const w0 = 2 * Math.PI * (settings.highPass || 150) / rate;
    const cos = Math.cos(w0);
    for (const q of [0.5412, 1.3066]) {
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      const b0 = (1 + cos) / 2 / a0;
      const b1 = -(1 + cos) / a0;
      const a1 = -2 * cos / a0;
      const a2 = (1 - alpha) / a0;
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < n; i++) {
        const x = out[i];
        const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] = y;
      }
    }
    // 20 ms windows: loudness and speech span
    const win = Math.max(1, Math.round(rate * 0.02));
    const levels = [];
    for (let i = 0; i < n; i += win) {
      let sum = 0;
      const end = Math.min(n, i + win);
      for (let j = i; j < end; j++) sum += out[j] * out[j];
      levels.push(Math.sqrt(sum / Math.max(1, end - i)));
    }
    const loudest = levels.reduce((max, value) => Math.max(max, value), 0);
    if (loudest < 1e-4) {
      return { samples: new Int16Array(0), silent: true, gainDb: 0, seconds: 0 };
    }
    const threshold = Math.max(loudest * 0.08, 0.002);
    let first = levels.findIndex(value => value >= threshold);
    let last = levels.length - 1;
    while (last > 0 && levels[last] < threshold) last--;
    const margin = 6; // windows (120 ms)
    first = Math.max(0, first - margin);
    last = Math.min(levels.length - 1, last + margin);
    const start = first * win;
    const end = Math.min(n, (last + 1) * win);
    const voiced = levels.slice(first, last + 1).filter(value => value >= threshold);
    const rms = Math.sqrt(voiced.reduce((sum, value) => sum + value * value, 0) / Math.max(1, voiced.length));
    const target = settings.targetRms || 0.2;
    const gain = Math.min(target / Math.max(rms, 1e-6), settings.maxGain || 16);
    const length = end - start;
    const result = new Int16Array(length);
    const fade = Math.min(Math.round(rate * 0.015), Math.floor(length / 2));
    for (let i = 0; i < length; i++) {
      let value = out[start + i] * gain;
      const magnitude = Math.abs(value);
      if (magnitude > 0.7) value = Math.sign(value) * (0.7 + 0.29 * Math.tanh((magnitude - 0.7) / 0.29));
      if (i < fade) value *= i / fade;
      else if (i >= length - fade) value *= (length - 1 - i) / fade;
      result[i] = Math.max(-32767, Math.min(32767, Math.round(value * 32767)));
    }
    return { samples: result, silent: false, gainDb: 20 * Math.log10(gain), seconds: length / rate };
  }

  function toFloat(samples) {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
    return out;
  }

  // ------------------------------------------------------------------ listen frames
  function frameChecksum(bytes, pred, index, blk, count) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i];
    return (sum + pred + 32768 + index * 7 + blk * 13 + count) % 65536;
  }

  function frameLine(seg, blk, pred, index, codes, count) {
    const bytes = new Uint8Array(codes.length / 2);
    for (let i = 0; i < codes.length; i += 2) bytes[i >> 1] = codes[i] | (codes[i + 1] << 4);
    return '@AU1,' + seg + ',' + blk + ',' + pred + ',' + index + ',' + count + ','
      + bytesToBase64(bytes) + ',' + frameChecksum(bytes, pred, index, blk, count);
  }

  // Same output as enc.awk for 8 kHz mono input (used by the demo device and the tests).
  function createListenEncoder(seg) {
    const state = { pred: 0, index: 0 };
    let blk = 0;
    let codes = [];
    let start = null;
    let last = 0;
    return {
      push(sample, lines) {
        if (!codes.length) start = { pred: state.pred, index: state.index };
        codes.push(encodeSample(state, sample));
        last = sample;
        if (codes.length === BLOCK_SAMPLES) {
          lines.push(frameLine(seg, blk++, start.pred, start.index, codes, BLOCK_SAMPLES));
          codes = [];
        }
      },
      end(lines) {
        if (codes.length) {
          const count = codes.length;
          while (codes.length % 6) codes.push(encodeSample(state, last));
          lines.push(frameLine(seg, blk++, start.pred, start.index, codes, count));
          codes = [];
        }
        lines.push('@AS1,' + seg + ',end,' + blk);
        return lines;
      },
    };
  }

  function encodeListenMono(samples, seg) {
    const encoder = createListenEncoder(seg);
    const lines = [];
    for (let i = 0; i < samples.length; i++) encoder.push(samples[i], lines);
    return encoder.end(lines);
  }

  // Exact port of enc.awk: interleaved 16 kHz stereo Int16 -> frame lines.
  function encodeListenStereo(interleaved, seg) {
    const encoder = createListenEncoder(seg);
    const lines = [];
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    let v4 = 0;
    let v6 = 0;
    for (let f = 0; f + 3 < interleaved.length; f += 4) {
      v6 = v4;
      v4 = v2;
      v3 = v1;
      v2 = v0;
      v1 = interleaved[f] + interleaved[f + 1];
      v0 = interleaved[f + 2] + interleaved[f + 3];
      let y = Math.trunc((16 * v3 + 9 * (v2 + v4) - v0 - v6) / 64);
      if (y > 32767) y = 32767;
      else if (y < -32768) y = -32768;
      encoder.push(y, lines);
    }
    return encoder.end(lines);
  }

  // "@AU1,..." -> { seg, blk, pred, index, count, bytes } or null when damaged.
  function parseFrameLine(line) {
    const parts = String(line).trim().split(',');
    if (parts.length !== 8 || parts[0] !== '@AU1') return null;
    const numbers = parts.slice(1, 6).map(Number);
    if (!numbers.every(Number.isInteger)) return null;
    const [seg, blk, pred, index, count] = numbers;
    if (pred < -32768 || pred > 32767 || index < 0 || index > 88 || count < 1 || count > BLOCK_SAMPLES) return null;
    const bytes = base64ToBytes(parts[6]);
    if (!bytes || bytes.length * 2 < count) return null;
    if (frameChecksum(bytes, pred, index, blk, count) !== Number(parts[7])) return null;
    return { seg, blk, pred, index, count, bytes };
  }

  function decodeFrame(frame) {
    return decodeAdpcm(frame.bytes, frame.count, { pred: frame.pred, index: frame.index });
  }

  // "@AS1,<seg>,<event>,..." -> { seg, event, args }
  function parseStatusLine(line) {
    const parts = String(line).trim().split(',');
    if (parts.length < 3 || parts[0] !== '@AS1' || !/^\d+$/.test(parts[1])) return null;
    return { seg: Number(parts[1]), event: parts[2], args: parts.slice(3) };
  }

  // ------------------------------------------------------------------ serial stream filter
  // Takes the text that comes from the AIRIZ console and removes the voice lines from it, also
  // when they are mixed into other output (they are always written as one whole line). Partial
  // lines wait for the next chunk. Everything else passes through unchanged.
  const MARKERS = ['@AU1,', '@AS1,', '__AZPLAYED__'];
  const MAX_PENDING = 4096;

  function createStreamFilter(handlers) {
    const on = handlers || {};
    let pending = '';
    function heldTail(text) {
      // longest suffix that is the start of a marker
      let hold = 0;
      for (const marker of MARKERS) {
        for (let size = Math.min(marker.length - 1, text.length); size > hold; size--) {
          if (text.endsWith(marker.slice(0, size))) {
            hold = size;
            break;
          }
        }
      }
      return hold;
    }
    function handle(line) {
      const clean = line.replace(/\r/g, '');
      if (clean.startsWith('@AU1,')) {
        const frame = parseFrameLine(clean);
        if (frame && on.frame) on.frame(frame, clean);
        else if (!frame && on.damaged) on.damaged(clean);
      } else if (clean.startsWith('@AS1,')) {
        const status = parseStatusLine(clean);
        if (status && on.status) on.status(status, clean);
      } else if (on.marker) {
        on.marker(clean.slice(4, clean.indexOf('__', 4)));
      }
    }
    return {
      feed(text) {
        let data = pending + String(text || '');
        pending = '';
        let out = '';
        let pos = 0;
        while (pos < data.length) {
          let next = -1;
          for (const marker of MARKERS) {
            const found = data.indexOf(marker, pos);
            if (found !== -1 && (next === -1 || found < next)) next = found;
          }
          if (next === -1) {
            const rest = data.slice(pos);
            const hold = heldTail(rest);
            out += rest.slice(0, rest.length - hold);
            pending = rest.slice(rest.length - hold);
            break;
          }
          out += data.slice(pos, next);
          const newline = data.indexOf('\n', next);
          if (newline === -1) {
            pending = data.slice(next);
            if (pending.length > MAX_PENDING) {
              // not a real voice line (no end in sight): give it back as console text
              out += pending;
              pending = '';
            }
            break;
          }
          handle(data.slice(next, newline));
          pos = newline + 1;
        }
        return out;
      },
      reset() {
        pending = '';
      },
      get pending() {
        return pending;
      },
    };
  }

  // ------------------------------------------------------------------ device scripts
  const ENC_AWK = "# AIRIZ Console 1.10.0 - listen encoder (runs on the AIRIZ, BusyBox awk).\n# stdin : od -An -v -td2 of 16 kHz 16-bit stereo PCM (WAV body without its 44-byte header)\n# stdout: one text line per 504 samples of 8 kHz mono IMA ADPCM:\n#   @AU1,<seg>,<blk>,<pred>,<index>,<count>,<base64>,<checksum>\n# and \"@AS1,<seg>,end,<blocks>\" after the last block.\n# Mono = L+R, 7-tap half-band low-pass, every 2nd sample kept. Only + - * / int() substr()\n# are used: no bit operations and no binary output, so any BusyBox awk can run it.\nBEGIN {\n  split(\"7 8 9 10 11 12 13 14 16 17 19 21 23 25 28 31 34 37 41 45 50 55 60 66 73 80 88 97 107 118 130 143 157 173 190 209 230 253 279 307 337 371 408 449 494 544 598 658 724 796 876 963 1060 1166 1282 1411 1552 1707 1878 2066 2272 2499 2749 3024 3327 3660 4026 4428 4871 5358 5894 6484 7132 7845 8630 9493 10442 11487 12635 13899 15289 16818 18500 20350 22385 24623 27086 29794 32767\", st, \" \")\n  split(\"-1 -1 -1 -1 2 4 6 8\", ia, \" \")\n  for (i = 0; i <= 88; i++) {\n    S[i] = st[i + 1]; S8[i] = int(S[i] / 8); S2[i] = int(S[i] / 2); S4[i] = int(S[i] / 4)\n  }\n  for (c = 0; c < 16; c++) IA[c] = ia[c % 8 + 1]\n  A = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\"\n  for (i = 0; i < 4096; i++) P[i] = substr(A, int(i / 64) + 1, 1) substr(A, i % 64 + 1, 1)\n  BS = 504\n  v0 = v1 = v2 = v3 = v4 = v6 = 0\n  pred = 0; idx = 0; blk = 0; ns = 0; nb = 0; sum = 0; acc = 0; line = \"\"; lo = -1; y = 0\n}\n# Encode one sample (only used for the padding at the very end; the main loop has the same code inline).\nfunction enc(x,   d, c, s, vp) {\n  if (ns == 0) { p0 = pred; i0 = idx; line = \"\"; sum = 0; nb = 0; acc = 0 }\n  s = S[idx]; d = x - pred; c = 0; vp = S8[idx]\n  if (d < 0) { c = 8; d = -d }\n  if (d >= s) { c += 4; d -= s; vp += s }\n  if (d >= S2[idx]) { c += 2; d -= S2[idx]; vp += S2[idx] }\n  if (d >= S4[idx]) { c += 1; vp += S4[idx] }\n  if (c >= 8) { pred -= vp; if (pred < -32768) pred = -32768 } else { pred += vp; if (pred > 32767) pred = 32767 }\n  idx += IA[c]; if (idx < 0) idx = 0; else if (idx > 88) idx = 88\n  ns++\n  if (lo < 0) { lo = c } else {\n    c = lo + c * 16; lo = -1; sum += c; acc = acc * 256 + c; nb++\n    if (nb == 3) { line = line P[int(acc / 4096)] P[acc % 4096]; acc = 0; nb = 0 }\n  }\n}\nfunction flush(count) {\n  printf \"@AU1,%d,%d,%d,%d,%d,%s,%d\\n\", seg, blk, p0, i0, count, line, (sum + p0 + 32768 + i0 * 7 + blk * 13 + count) % 65536\n  blk++; ns = 0\n}\n{\n  for (f = 1; f < NF; f += 4) {\n    v6 = v4; v4 = v2; v3 = v1; v2 = v0\n    v1 = $f + $(f + 1); v0 = $(f + 2) + $(f + 3)\n    y = int((16 * v3 + 9 * (v2 + v4) - v0 - v6) / 64)\n    if (y > 32767) y = 32767; else if (y < -32768) y = -32768\n    if (ns == 0) { p0 = pred; i0 = idx; line = \"\"; sum = 0; nb = 0; acc = 0 }\n    s = S[idx]; d = y - pred; c = 0; vp = S8[idx]\n    if (d < 0) { c = 8; d = -d }\n    if (d >= s) { c += 4; d -= s; vp += s }\n    if (d >= S2[idx]) { c += 2; d -= S2[idx]; vp += S2[idx] }\n    if (d >= S4[idx]) { c += 1; vp += S4[idx] }\n    if (c >= 8) { pred -= vp; if (pred < -32768) pred = -32768 } else { pred += vp; if (pred > 32767) pred = 32767 }\n    idx += IA[c]; if (idx < 0) idx = 0; else if (idx > 88) idx = 88\n    ns++\n    if (lo < 0) { lo = c } else {\n      c = lo + c * 16; lo = -1; sum += c; acc = acc * 256 + c; nb++\n      if (nb == 3) { line = line P[int(acc / 4096)] P[acc % 4096]; acc = 0; nb = 0 }\n    }\n    if (ns == BS) flush(BS)\n  }\n}\nEND {\n  if (ns > 0) {\n    count = ns\n    while (ns % 6) enc(y)\n    flush(count)\n  }\n  printf \"@AS1,%d,end,%d\\n\", seg, blk\n}\n";
  const TALK_AWK = "# AIRIZ Console 1.10.0 - voice message decoder (runs on the AIRIZ, BusyBox awk).\n# stdin : od -An -v -tu1 of 8 kHz mono IMA ADPCM (starts at predictor 0 / index 0, low nibble first)\n# -v n=<samples>   number of 8 kHz samples in the message\n# -v rate=16000    output rate: 16000 (each sample doubled by linear interpolation) or 8000\n# -v ch=2          output channels: 2 (same sound on both) or 1\n# stdout: base64 text of a 16-bit PCM WAV file - pipe it into \"base64 -d\".\n# Only + - * / int() substr() are used: no bit operations and no binary output.\nBEGIN {\n  split(\"7 8 9 10 11 12 13 14 16 17 19 21 23 25 28 31 34 37 41 45 50 55 60 66 73 80 88 97 107 118 130 143 157 173 190 209 230 253 279 307 337 371 408 449 494 544 598 658 724 796 876 963 1060 1166 1282 1411 1552 1707 1878 2066 2272 2499 2749 3024 3327 3660 4026 4428 4871 5358 5894 6484 7132 7845 8630 9493 10442 11487 12635 13899 15289 16818 18500 20350 22385 24623 27086 29794 32767\", st, \" \")\n  split(\"-1 -1 -1 -1 2 4 6 8\", ia, \" \")\n  for (i = 0; i <= 88; i++) {\n    s = st[i + 1]\n    for (c = 0; c < 16; c++) {\n      m = c % 8; d = int(s / 8)\n      if (m >= 4) d += s\n      if (m % 4 >= 2) d += int(s / 2)\n      if (m % 2 == 1) d += int(s / 4)\n      D[i * 16 + c] = (c >= 8) ? -d : d\n      j = i + ia[m + 1]; if (j < 0) j = 0; else if (j > 88) j = 88\n      N[i * 16 + c] = j * 16\n    }\n  }\n  A = \"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\"\n  for (i = 0; i < 4096; i++) P[i] = substr(A, int(i / 64) + 1, 1) substr(A, i % 64 + 1, 1)\n  n += 0; rate += 0; ch += 0\n  if (rate != 8000) rate = 16000\n  if (ch != 1) ch = 2\n  up = rate / 8000\n  pred = 0; k = 0; prev = 0; left = n; line = \"\"; nl = 0; na = 0; acc = 0; qn = 0\n  data = n * up * ch * 2\n  hb(82); hb(73); hb(70); hb(70); h32(36 + data); hb(87); hb(65); hb(86); hb(69)\n  hb(102); hb(109); hb(116); hb(32); h32(16); h16(1); h16(ch); h32(rate); h32(rate * ch * 2); h16(ch * 2); h16(16)\n  hb(100); hb(97); hb(116); hb(97); h32(data)\n  # The 44-byte header leaves 2 bytes waiting: frames go the slow way until the byte count is a\n  # multiple of 3 again (1 stereo frame or 2 mono frames), then 3 frames at a time (fast path).\n  slow = (ch == 2) ? 1 : 2\n}\nfunction hb(b) {\n  acc = acc * 256 + b\n  if (++na == 3) { line = line P[int(acc / 4096)] P[acc % 4096]; acc = 0; na = 0 }\n}\nfunction h16(v) { hb(v % 256); hb(int(v / 256) % 256) }\nfunction h32(v) { h16(v % 65536); h16(int(v / 65536)) }\nfunction one(v) {\n  if (v < 0) v += 65536\n  hb(v % 256); hb(int(v / 256))\n  if (ch == 2) { hb(v % 256); hb(int(v / 256)) }\n}\n# three stereo frames (12 bytes, L = R) -> 16 base64 characters\nfunction o3s(a, b, c) {\n  if (a < 0) a += 65536; if (b < 0) b += 65536; if (c < 0) c += 65536\n  Ah = int(a / 256); Al = a - Ah * 256; Bh = int(b / 256); Bl = b - Bh * 256; Ch = int(c / 256); Cl = c - Ch * 256\n  G1 = (Al * 256 + Ah) * 256 + Al; G2 = Ah * 65536 + Bl * 256 + Bh\n  G3 = (Bl * 256 + Bh) * 256 + Cl; G4 = Ch * 65536 + Cl * 256 + Ch\n  line = line P[int(G1 / 4096)] P[G1 % 4096] P[int(G2 / 4096)] P[G2 % 4096] P[int(G3 / 4096)] P[G3 % 4096] P[int(G4 / 4096)] P[G4 % 4096]\n  if (++nl == 5) { print line; line = \"\"; nl = 0 }\n}\n# three mono frames (6 bytes) -> 8 base64 characters\nfunction o3m(a, b, c) {\n  if (a < 0) a += 65536; if (b < 0) b += 65536; if (c < 0) c += 65536\n  Ah = int(a / 256); Al = a - Ah * 256; Bh = int(b / 256); Bl = b - Bh * 256; Ch = int(c / 256); Cl = c - Ch * 256\n  G1 = (Al * 256 + Ah) * 256 + Bl; G2 = (Bh * 256 + Cl) * 256 + Ch\n  line = line P[int(G1 / 4096)] P[G1 % 4096] P[int(G2 / 4096)] P[G2 % 4096]\n  if (++nl == 10) { print line; line = \"\"; nl = 0 }\n}\nfunction put(v) {\n  if (slow > 0) { one(v); slow--; return }\n  if (qn == 0) { qa = v; qn = 1 }\n  else if (qn == 1) { qb = v; qn = 2 }\n  else { if (ch == 2) o3s(qa, qb, v); else o3m(qa, qb, v); qn = 0 }\n}\n{\n  for (f = 1; f <= NF && left > 0; f++) {\n    b = $f; c = b % 16\n    pred += D[k + c]; if (pred > 32767) pred = 32767; else if (pred < -32768) pred = -32768\n    k = N[k + c]\n    if (up == 2) put(int((prev + pred) / 2))\n    put(pred); prev = pred\n    if (--left <= 0) break\n    c = int(b / 16)\n    pred += D[k + c]; if (pred > 32767) pred = 32767; else if (pred < -32768) pred = -32768\n    k = N[k + c]\n    if (up == 2) put(int((prev + pred) / 2))\n    put(pred); prev = pred\n    left--\n  }\n}\nEND {\n  if (qn >= 1) one(qa)\n  if (qn == 2) one(qb)\n  if (na == 1) line = line P[acc * 16] \"==\"\n  else if (na == 2) line = line P[int(acc / 16)] substr(A, (acc * 4) % 64 + 1, 1) \"=\"\n  if (line != \"\") print line\n}\n";
  const LISTEN_SH = "# AIRIZ Console 1.11.2 - listen helper (runs on the AIRIZ).\n# sh listen.sh <gain> <seconds> [record command] [recorder output file]\n# Records clips of <seconds> with the DMIC and prints each one as text frames (enc.awk) on the\n# console, while the next clip is being recorded. It stops when /tmp/airiz/listen/on is\n# removed or the deadline written in it (seconds since 1970, renewed by the PC) has passed,\n# so a PC that goes away does not leave it running. A newer run takes over from an older one\n# (pid file): the older one stops encoding at once and ends after its current recording, and\n# the newer one waits for that before it records. Before each clip it checks that /tmp has\n# room for it (about 63 kB per second of 16 kHz stereo).\nA=${AIRIZ_DIR:-/tmp/airiz}\nD=$A/listen\nG=${1:-80}\nT=${2:-2}\nR=${3:-diag audio record -p -t %T -v %G}\nO=${4:-/tmp/dmic_record_output.wav}\nDF=${AIRIZ_DF:-df}\nmkdir -p $D || exit 1\n[ -f $D/on ] || echo $(( $(date +%s) + 90 )) > $D/on\nold=$(cat $D/pid 2>/dev/null)\necho $$ > $D/pid\nmine() {\n  [ \"$(cat $D/pid 2>/dev/null)\" = \"$$\" ]\n}\nalive() {\n  [ -f $D/on ] || return 1\n  mine || return 1\n  t=$(cat $D/on 2>/dev/null)\n  [ -n \"$t\" ] && [ \"$(date +%s)\" -le \"$t\" ]\n}\nrunning() {\n  [ -n \"$1\" ] || return 1\n  if [ -d /proc/$$ ]; then\n    grep -q listen.sh /proc/$1/cmdline 2>/dev/null\n  else\n    kill -0 \"$1\" 2>/dev/null\n  fi\n}\nstopenc() {\n  e=$(cat $D/enc 2>/dev/null)\n  [ -n \"$e\" ] || return 0\n  if [ -d /proc/$$ ]; then\n    grep -q awk /proc/$e/cmdline 2>/dev/null || return 0\n  fi\n  kill \"$e\" 2>/dev/null\n}\nstopenc\nif [ -n \"$old\" ] && [ \"$old\" != \"$$\" ] && running \"$old\"; then\n  echo \"@AS1,0,wait,$old\"\n  while running \"$old\" && alive; do usleep 200000; done\nfi\nrm -f $D/s*.wav $D/s*.ok $D/enc\nneed=$(( T * 63 + 1024 ))\nroom() {\n  a=$($DF -Pk \"${O%/*}\" 2>/dev/null | awk 'NR == 2 { print $4 }')\n  case \"$a\" in\n    ''|*[!0-9]*) return 0 ;;\n  esac\n  [ \"$a\" -ge \"$need\" ]\n}\ncmd=$(echo \"$R\" | sed \"s/%T/$T/g; s/%G/$G/g\")\necho \"@AS1,0,start,$G,$T,$$\"\n(\n  k=1\n  while alive; do\n    if [ -f $D/s$k.ok ]; then\n      n=$((k + 2))\n      if [ -f $D/s$n.ok ]; then\n        echo \"@AS1,$k,skip\"\n      else\n        tail -c +45 $D/s$k.wav | od -An -v -td2 | awk -v seg=$k -f $A/enc.awk &\n        echo $! > $D/enc\n        wait $! 2>/dev/null\n        rm -f $D/enc\n      fi\n      rm -f $D/s$k.wav $D/s$k.ok\n      k=$((k + 1))\n    else\n      usleep 100000\n    fi\n  done\n) &\ns=0\nf=0\nwhile alive; do\n  s=$((s + 1))\n  w=0\n  while alive && ! room && [ -f $D/s$((s - 1)).ok ] && [ $w -lt $((T * 2 + 10)) ]; do\n    sleep 1\n    w=$((w + 1))\n  done\n  alive || break\n  if ! room; then\n    echo \"@AS1,$s,nospace,$a,$need\"\n    break\n  fi\n  rm -f \"$O\"\n  $cmd > $D/rec.log 2>&1\n  if [ -s \"$O\" ]; then\n    mv \"$O\" $D/s$s.wav && touch $D/s$s.ok\n    f=0\n  else\n    f=$((f + 1))\n    echo \"@AS1,$s,norec,$(head -c 60 $D/rec.log 2>/dev/null | tr -d '\\r\\n,')\"\n    [ $f -ge 3 ] && break\n    sleep 1\n  fi\ndone\nif mine; then\n  rm -f $D/on\n  wait\n  rm -f $D/s*.wav $D/s*.ok\nelse\n  wait\nfi\necho \"@AS1,$s,stopped,$$\"\n";
  let scriptCache = null;

  function deviceScripts() {
    if (!scriptCache) {
      scriptCache = Object.freeze([
        { name: 'enc.awk', text: ENC_AWK },
        { name: 'talk.awk', text: TALK_AWK },
        { name: 'listen.sh', text: LISTEN_SH },
      ].map(script => Object.freeze(Object.assign(script, {
        path: DEVICE_DIR + '/' + script.name,
        md5: md5Hex(script.text),
        base64: bytesToBase64(utf8Bytes(script.text)),
      }))));
    }
    return scriptCache;
  }

  // Lines for "head -c <byteCount>": every line ends with \n and only \n.
  function uploadPlan(base64Text, lineChars) {
    const size = lineChars || UPLOAD_LINE_CHARS;
    const lines = [];
    for (let i = 0; i < base64Text.length; i += size) lines.push(base64Text.slice(i, i + size) + '\n');
    const byteCount = lines.reduce((sum, line) => sum + line.length, 0);
    return { lines, byteCount, chars: base64Text.length };
  }

  function formatFor(name) {
    return FORMATS[name] || FORMATS.stereo16;
  }

  function talkWavSize(samples, formatName) {
    const format = formatFor(formatName);
    return 44 + samples * (format.rate / RATE) * format.channels * 2;
  }

  // Safe device command templates: letters, digits, space and . _ / - { } only.
  function cleanTemplate(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text && /^[A-Za-z0-9 ._\/{}-]+$/.test(text) ? text : fallback;
  }

  function recordTemplate(value) {
    const text = cleanTemplate(value, DEFAULT_RECORD_COMMAND);
    return /\{s\}/.test(text) ? text : DEFAULT_RECORD_COMMAND;
  }

  function playCommand(template, file) {
    const text = cleanTemplate(template, DEFAULT_PLAY_COMMAND);
    return /\{file\}/.test(text) ? text.replace(/\{file\}/g, file) : text + ' ' + file;
  }

  function clampInt(value, low, high, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(low, Math.min(high, number));
  }

  const commands = Object.freeze({
    // all quiet: the PC swallows their output while the voice job holds the console
    sums() {
      return 'mkdir -p ' + DEVICE_DIR + ' && md5sum ' + deviceScripts().map(s => s.path).join(' ')
        + ' 2>/dev/null; echo __AZ""SUMS__';
    },
    // "head -c" waits for exactly byteCount bytes; the markers show when it starts and ends.
    receive(path, byteCount) {
      return 'echo __AZ""RDY__; head -c ' + byteCount + ' > ' + path + '.b64; echo __AZ""HD_$?__';
    },
    appendLine(path, chunk) {
      return 'echo ' + chunk + ' >> ' + path + '.b64';
    },
    clear(path) {
      return 'rm -f ' + path + '.b64';
    },
    decodeCheck(path) {
      return 'base64 -d ' + path + '.b64 > ' + path + ' && md5sum ' + path + '; echo __AZ""M5__';
    },
    buildWav(samples, formatName) {
      const format = formatFor(formatName);
      return 'od -An -v -tu1 ' + TALK_ADPCM + ' | awk -v n=' + clampInt(samples, 0, 10000000, 0)
        + ' -v rate=' + format.rate + ' -v ch=' + format.channels + ' -f ' + DEVICE_DIR + '/talk.awk | base64 -d > '
        + TALK_WAV + '; wc -c < ' + TALK_WAV + '; echo __AZ""WV__';
    },
    // Played in the background (the console stays free); prints __AZPLAYED__ when it ends.
    play(volume, template) {
      const level = clampInt(volume, 0, 100, 80);
      return 'diag audio init > ' + DEVICE_DIR + '/talk.log 2>&1; diag audio volume ' + level + ' >> '
        + DEVICE_DIR + '/talk.log 2>&1; sh -c \'(' + playCommand(template, TALK_WAV) + ' >> '
        + DEVICE_DIR + '/talk.log 2>&1; echo __AZ""PLAYED__) &\'; echo __AZ""GO__';
    },
    listenStart(gain, seconds, template) {
      const record = recordTemplate(template).replace(/\{s\}/g, '%T').replace(/\{gain\}/g, '%G');
      return 'mkdir -p ' + LISTEN_DIR + '; echo $(( $(date +%s) + 180 )) > ' + LISTEN_DIR + '/on; '
        + 'sh -c \'sh ' + DEVICE_DIR + '/listen.sh ' + clampInt(gain, 1, 100, 80) + ' ' + clampInt(seconds, MIN_LISTEN_SECONDS, MAX_LISTEN_SECONDS, 2)
        + ' "' + record + '" ' + RECORDER_OUTPUT + ' < /dev/null &\'; echo __AZ""LS__';
    },
    listenRenew() {
      return 'echo $(( $(date +%s) + 180 )) > ' + LISTEN_DIR + '/on 2>/dev/null; echo __AZ""LR__';
    },
    // Also ends the encoder of the clip being sent (a long clip would keep the console busy).
    listenStop() {
      return 'rm -f ' + LISTEN_DIR + '/on; e=$(cat ' + LISTEN_DIR + '/enc 2>/dev/null); [ -n "$e" ] && { [ ! -d /proc/$$ ]'
        + ' || grep -q awk /proc/$e/cmdline 2>/dev/null; } && kill $e 2>/dev/null; echo __AZ""LX__';
    },
  });

  // ------------------------------------------------------------------ estimates
  // Rough seconds for a talk message of `seconds` length (upload at line speed, decode on the
  // AIRIZ assumed about 1 s per 1 s of 16 kHz stereo sound - not measured on an AIRIZ yet).
  function estimateTalk(seconds, formatName) {
    const format = formatFor(formatName);
    const chars = Math.ceil(seconds * RATE / 2 / 3) * 4;
    const upload = chars * 1.02 / LINK_BYTES_PER_SECOND + 0.6;
    const work = seconds * (format.rate / 16000) * (format.channels / 2) * 1.0 + 0.4;
    return { upload, decode: work, total: upload + work + 0.8, chars };
  }

  function chunkText(text, size) {
    const chunks = [];
    const step = size || TALK_CHUNK_CHARS;
    for (let i = 0; i < text.length; i += step) chunks.push(text.slice(i, i + step));
    return chunks;
  }

  return Object.freeze({
    VERSION,
    PROTOCOL,
    LINK_BYTES_PER_SECOND,
    RATE,
    BLOCK_SAMPLES,
    MAX_TALK_SECONDS,
    MIN_TALK_SECONDS,
    MIN_LISTEN_SECONDS,
    MAX_LISTEN_SECONDS,
    DEVICE_DIR,
    LISTEN_DIR,
    TALK_B64,
    TALK_ADPCM,
    TALK_WAV,
    RECORDER_OUTPUT,
    DEFAULT_RECORD_COMMAND,
    DEFAULT_PLAY_COMMAND,
    TALK_CHUNK_CHARS,
    UPLOAD_LINE_CHARS,
    FALLBACK_LINE_CHARS,
    FORMATS,
    STEP_TABLE,
    encodeSample,
    decodeSample,
    encodeAdpcm,
    decodeAdpcm,
    bytesToBase64,
    base64ToBytes,
    utf8Bytes,
    md5Hex,
    resample,
    createStreamResampler,
    prepareVoice,
    toFloat,
    frameChecksum,
    createListenEncoder,
    encodeListenMono,
    encodeListenStereo,
    parseFrameLine,
    decodeFrame,
    parseStatusLine,
    createStreamFilter,
    deviceScripts,
    uploadPlan,
    formatFor,
    talkWavSize,
    recordTemplate,
    playCommand,
    commands,
    estimateTalk,
    chunkText,
    ENC_AWK,
    TALK_AWK,
    LISTEN_SH,
  });
});
