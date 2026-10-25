/*
 * Sped demo stand-ins — procedurally synthesised pop-punk style tracks with a
 * known tempo, key and verse/chorus layout. Used for the in-app demo and as test
 * fixtures. They are NOT recordings of any real song.
 */
(function (root) {
  'use strict';
  const H = root.Sped;

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function addTone(buffer, sampleRate, startSec, durationSec, freq, amplitude, shape, pan, decay) {
    const start = Math.floor(startSec * sampleRate);
    const length = Math.floor(durationSec * sampleRate);
    const left = buffer[0];
    const right = buffer[1];
    const gl = Math.cos((pan + 1) * Math.PI / 4);
    const gr = Math.sin((pan + 1) * Math.PI / 4);
    const release = Math.min(length, Math.floor(0.02 * sampleRate));
    let phase = 0;
    const step = freq / sampleRate;
    for (let i = 0; i < length && start + i < left.length; i++) {
      phase += step;
      phase -= Math.floor(phase);
      let v;
      if (shape === 'saw') {
        v = 2 * phase - 1;
      } else if (shape === 'square') {
        v = phase < 0.5 ? 0.7 : -0.7;
      } else if (shape === 'triangle') {
        v = 4 * Math.abs(phase - 0.5) - 1;
      } else {
        v = Math.sin(2 * Math.PI * phase);
      }
      let env = decay ? Math.exp(-i / sampleRate * decay) : 1;
      if (i < 64) {
        env *= i / 64;
      }
      if (length - i < release) {
        env *= (length - i) / release;
      }
      const s = v * amplitude * env;
      left[start + i] += s * gl;
      right[start + i] += s * gr;
    }
  }

  function addKick(buffer, sampleRate, t, amp) {
    const start = Math.floor(t * sampleRate);
    const length = Math.floor(0.32 * sampleRate);
    let phase = 0;
    for (let i = 0; i < length && start + i < buffer[0].length; i++) {
      const time = i / sampleRate;
      const freq = 48 + 120 * Math.exp(-time * 32);
      phase += freq / sampleRate;
      const v = Math.sin(2 * Math.PI * phase) * Math.exp(-time * 9) * amp;
      buffer[0][start + i] += v;
      buffer[1][start + i] += v;
    }
  }

  function addNoiseHit(buffer, sampleRate, t, amp, decay, random, bright, toneHz) {
    const start = Math.floor(t * sampleRate);
    const length = Math.floor(Math.min(0.4, 6 / decay) * sampleRate);
    let previous = 0;
    for (let i = 0; i < length && start + i < buffer[0].length; i++) {
      const time = i / sampleRate;
      const white = random() * 2 - 1;
      const noise = bright ? white - previous : white;
      previous = white;
      let v = noise * Math.exp(-time * decay) * amp;
      if (toneHz) {
        v += Math.sin(2 * Math.PI * toneHz * time) * Math.exp(-time * 25) * amp * 0.8;
      }
      buffer[0][start + i] += v;
      buffer[1][start + i] += v;
    }
  }

  /**
   * opts: { bpm, key: 'Ab major', bars = 32, sampleRate = 44100, seed }
   * Layout: verse (8 bars) · chorus (8) · verse (8) · chorus (8), after a 1-bar count-in.
   */
  function demoTrack(opts) {
    const sampleRate = opts.sampleRate || 44100;
    const bpm = opts.bpm;
    const key = H.parseKey(opts.key || 'C major');
    const bars = opts.bars || 32;
    const random = H.seededRandom(opts.seed || 1);
    const beat = 60 / bpm;
    const bar = beat * 4;
    const lead = bar;
    const totalSec = lead + bars * bar + 1;
    const buffer = [new Float32Array(Math.ceil(totalSec * sampleRate)), new Float32Array(Math.ceil(totalSec * sampleRate))];
    const bassBuffer = [new Float32Array(buffer[0].length), new Float32Array(buffer[0].length)];
    const minor = key.mode === 'minor';
    const verseDegrees = minor ? [0, 5, 0, 7] : [0, 5, 0, 7];
    const chorusDegrees = minor ? [0, 8, 3, 10] : [0, 7, 9, 5];
    const rootMidi = 40 + ((key.pc - 4 + 12) % 12);
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

    // Count-in: hats only.
    for (let i = 0; i < 4; i++) {
      addNoiseHit(buffer, sampleRate, i * beat, 0.12, 60, random, true);
    }
    for (let b = 0; b < bars; b++) {
      const t0 = lead + b * bar;
      const chorus = Math.floor(b / 8) % 2 === 1;
      const degree = (chorus ? chorusDegrees : verseDegrees)[b % 4];
      const chordRoot = rootMidi + degree;
      const third = chordRoot + (scale.indexOf((degree + (minor ? 3 : 4)) % 12) >= 0 ? (minor ? 3 : 4) : (minor ? 4 : 3));
      // Drums.
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        if (q === 0 || q === 2) {
          addKick(buffer, sampleRate, t, chorus ? 0.9 : 0.7);
        }
        if (q === 1 || q === 3) {
          addNoiseHit(buffer, sampleRate, t, chorus ? 0.55 : 0.4, 16, random, false, 185);
        }
        addNoiseHit(buffer, sampleRate, t, chorus ? 0.16 : 0.1, chorus ? 25 : 60, random, true);
        addNoiseHit(buffer, sampleRate, t + beat / 2, chorus ? 0.12 : 0.07, 60, random, true);
      }
      if (chorus) {
        addKick(buffer, sampleRate, t0 + 2.5 * beat, 0.6);
      }
      // Bass: eighth notes on the chord root.
      for (let e = 0; e < 8; e++) {
        addTone(bassBuffer, sampleRate, t0 + e * beat / 2, beat / 2 * 0.92, midiToHz(chordRoot - 12), chorus ? 0.34 : 0.26, 'saw', 0, 0);
      }
      // Guitars: power chords (palm-muted eighths in the verse, sustained in the chorus).
      const voicing = [chordRoot, chordRoot + 7, chordRoot + 12];
      if (chorus) {
        voicing.forEach(function (note, i) {
          addTone(buffer, sampleRate, t0, bar * 0.98, midiToHz(note) * 1.003, 0.07, 'saw', -0.6, 0.4);
          addTone(buffer, sampleRate, t0, bar * 0.98, midiToHz(note) * 0.997, 0.07, 'saw', 0.6, 0.4);
          if (i === 0) {
            addTone(buffer, sampleRate, t0, bar * 0.98, midiToHz(third + 12), 0.05, 'saw', 0, 0.3);
          }
        });
      } else {
        for (let e = 0; e < 8; e++) {
          voicing.slice(0, 2).forEach(function (note) {
            addTone(buffer, sampleRate, t0 + e * beat / 2, beat / 2 * 0.6, midiToHz(note), 0.05, 'saw', e % 2 ? 0.5 : -0.5, 9);
          });
        }
      }
      // "Vocal" melody: chord tones, busier and higher in the chorus.
      const melody = chorus ? [third + 12, chordRoot + 19, third + 12, chordRoot + 12] : [chordRoot + 12, third + 12];
      const noteLength = bar / melody.length;
      melody.forEach(function (note, i) {
        addTone(buffer, sampleRate, t0 + i * noteLength, noteLength * 0.9, midiToHz(note), chorus ? 0.12 : 0.07, 'triangle', 0.1, 0.8);
      });
    }
    // Low-pass the bass with a one-pole filter, then mix.
    const alpha = 1 - Math.exp(-2 * Math.PI * 500 / sampleRate);
    for (let c = 0; c < 2; c++) {
      let state = 0;
      for (let i = 0; i < bassBuffer[c].length; i++) {
        state += alpha * (bassBuffer[c][i] - state);
        buffer[c][i] += state;
      }
    }
    const peak = H.peakOf(buffer) || 1;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < buffer[c].length; i++) {
        buffer[c][i] = Math.tanh(buffer[c][i] / peak * 1.4) * 0.8;
      }
    }
    return {
      channels: buffer,
      sampleRate: sampleRate,
      truth: {
        bpm: bpm,
        key: H.keyName(key),
        chorusStarts: [lead + 8 * bar, lead + 24 * bar],
        bar: bar,
      },
    };
  }

  H.demo = { demoTrack: demoTrack };
})(typeof globalThis !== 'undefined' ? globalThis : this);
