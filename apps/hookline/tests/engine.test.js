/*
 * Hookline engine tests. Runtime-agnostic: `node engine.test.js <webDir>` or
 * `jsc engine.test.js -- <webDir>` (macOS JavaScriptCore). Exits non-zero on failure.
 */
(function () {
  'use strict';
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  const log = isNode ? console.log : print;
  const args = isNode ? process.argv.slice(2) : (globalThis.arguments ? Array.prototype.slice.call(globalThis.arguments) : []);
  const webDir = (args[0] || 'apps/hookline/web').replace(/\/$/, '') + '/';
  const only = args[1] || '';

  function loadScript(path) {
    if (isNode) {
      const fs = require('fs');
      const vm = require('vm');
      vm.runInThisContext(fs.readFileSync(path, 'utf8'), { filename: path });
    } else {
      load(path);
    }
  }

  loadScript(webDir + 'engine.js');
  loadScript(webDir + 'demo.js');
  loadScript(webDir + 'recipes.js');
  const H = globalThis.Hookline;

  let failures = 0;
  let passes = 0;
  const now = function () {
    return Date.now();
  };

  function check(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function test(name, fn) {
    if (only && name.indexOf(only) < 0) {
      return;
    }
    const started = now();
    try {
      fn();
      passes++;
      log('ok   - ' + name + ' (' + (now() - started) + ' ms)');
    } catch (err) {
      failures++;
      log('FAIL - ' + name + ': ' + (err && err.message ? err.message : err));
    }
  }

  function sine(freq, seconds, sampleRate) {
    const out = new Float32Array(Math.round(seconds * sampleRate));
    for (let i = 0; i < out.length; i++) {
      out[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sampleRate);
    }
    return out;
  }

  // Frequency from zero crossings over the steady middle of the signal.
  function dominantFrequency(data, sampleRate) {
    const start = Math.floor(data.length * 0.2);
    const end = Math.floor(data.length * 0.8);
    let crossings = 0;
    for (let i = start + 1; i < end; i++) {
      if (data[i - 1] < 0 && data[i] >= 0) {
        crossings++;
      }
    }
    return crossings / ((end - start) / sampleRate);
  }

  function octaveError(detected, truth) {
    const folded = H.foldedTempoRatio(truth, detected);
    return Math.abs(folded - 1);
  }

  const SR = 44100;
  const fixtures = {};
  function fixture(name, bpm, key, seed) {
    if (!fixtures[name]) {
      const demo = H.demo.demoTrack({ bpm: bpm, key: key, bars: 32, sampleRate: SR, seed: seed });
      const track = H.prepareTrack(demo.channels, SR);
      track.name = name;
      track.analysis = H.analyzeTrack(track);
      track.truth = demo.truth;
      fixtures[name] = track;
    }
    return fixtures[name];
  }

  test('pitch shift +12 st keeps length and doubles frequency', function () {
    const input = [sine(440, 2, SR), sine(440, 2, SR)];
    const out = H.transform(input, SR, 1, 12);
    const f = dominantFrequency(out[0], SR);
    check(Math.abs(out[0].length - input[0].length) < SR * 0.01, 'length changed: ' + out[0].length);
    check(Math.abs(f - 880) < 880 * 0.01, 'frequency ' + f.toFixed(1));
  });

  test('time stretch ×1.25 shortens by 1/1.25 and keeps pitch', function () {
    const input = [sine(440, 4, SR), sine(440, 4, SR)];
    const out = H.transform(input, SR, 1.25, 0);
    const f = dominantFrequency(out[0], SR);
    check(Math.abs(out[0].length - input[0].length / 1.25) < SR * 0.01, 'length ' + out[0].length);
    check(Math.abs(f - 440) < 440 * 0.01, 'frequency ' + f.toFixed(1));
  });

  test('coupled (nightcore) ×1.25 raises pitch by 1.25', function () {
    const input = [sine(440, 4, SR), sine(440, 4, SR)];
    const out = H.transform(input, SR, 1.25, 12 * Math.log2(1.25));
    const f = dominantFrequency(out[0], SR);
    check(Math.abs(f - 550) < 550 * 0.01, 'frequency ' + f.toFixed(1));
    check(Math.abs(out[0].length - input[0].length / 1.25) < SR * 0.01, 'length ' + out[0].length);
  });

  test('independent: faster AND higher (+4 st, ×1.25)', function () {
    const input = [sine(440, 4, SR), sine(440, 4, SR)];
    const out = H.transform(input, SR, 1.25, 4);
    const f = dominantFrequency(out[0], SR);
    const expected = 440 * Math.pow(2, 4 / 12);
    check(Math.abs(f - expected) < expected * 0.01, 'frequency ' + f.toFixed(1) + ' vs ' + expected.toFixed(1));
    check(Math.abs(out[0].length - input[0].length / 1.25) < SR * 0.01, 'length');
  });

  [['A', 131, 'Ab major', 11], ['B', 173, 'Db major', 12], ['C', 162, 'D major', 13], ['D', 92, 'A minor', 14]].forEach(function (spec) {
    test('tempo detection ' + spec[1] + ' BPM (octave-agnostic, ±1.5 %)', function () {
      const t = fixture(spec[0], spec[1], spec[2], spec[3]);
      const err = octaveError(t.analysis.bpm, spec[1]);
      check(err < 0.015, 'detected ' + t.analysis.bpm + ' for ' + spec[1]);
    });
    test('key detection ' + spec[2] + ' (relative-key equivalent)', function () {
      const t = fixture(spec[0], spec[1], spec[2], spec[3]);
      const truth = H.parseKey(spec[2]);
      check(H.majorEquivalent(t.analysis.key) === H.majorEquivalent(truth), 'detected ' + t.analysis.key.name + ' for ' + spec[2]);
    });
    test('hook detection lands on a chorus downbeat (' + spec[0] + ')', function () {
      const t = fixture(spec[0], spec[1], spec[2], spec[3]);
      const hook = t.analysis.hooks[0].start;
      const bar = t.truth.bar;
      const inChorus = t.truth.chorusStarts.some(function (start) {
        return Math.abs(hook - start) <= bar * 0.15;
      });
      check(inChorus, 'hook at ' + hook.toFixed(2) + ' s; choruses ' + t.truth.chorusStarts.map(function (s) {
        return s.toFixed(2);
      }).join(', '));
    });
  });

  test('request parser: the Paramore test request', function () {
    const parsed = H.parseRequest("remix paramore thats what you get high faster tempo pitch with other nostalgic related songs remix into it", { trackCount: 3 });
    check(parsed.patch.semitones > 0, 'pitch not raised');
    check(parsed.patch.tempo > 1, 'tempo not raised');
    check(parsed.patch.mashup === true, 'mashup not enabled');
    check(parsed.patch.style === 'sped', 'style ' + parsed.patch.style);
  });

  test('request parser: slowed + reverb, explicit numbers, 2000s is not a length', function () {
    const a = H.parseRequest('slowed + reverb please', { trackCount: 1 });
    check(a.patch.mode === 'coupled' && a.patch.tempo <= 0.85 && a.patch.fx.reverb > 0.3, JSON.stringify(a.patch));
    const b = H.parseRequest('+2 semitones, 140 bpm, 15 seconds, 2000s throwback', { trackCount: 2 });
    check(b.patch.semitones === 2 && b.patch.targetBpm === 140 && b.patch.lengthSec === 15 && b.patch.mashup, JSON.stringify(b.patch));
    const c = H.parseRequest('make it deeper and slower, bass boosted 8d', { trackCount: 1 });
    check(c.patch.semitones < 0 && c.patch.tempo < 1 && c.patch.fx.bass > 0 && c.patch.fx.eightD > 0, JSON.stringify(c.patch));
  });

  test('curated recipe: slot assignment by filename then order', function () {
    const recipeDef = H.recipes.curated.paramore;
    const mapping = H.recipes.assignSlots(recipeDef, [
      { id: 't1', name: 'Fall Out Boy - Sugar Were Goin Down.mp3' },
      { id: 't2', name: "Paramore - That's What You Get.m4a" },
      { id: 't3', name: 'Paramore - Misery Business.mp3' },
    ]);
    check(mapping.main === 't2' && mapping.nostalgia1 === 't3' && mapping.nostalgia2 === 't1', JSON.stringify(mapping));
    check(H.recipes.tempoOverride(87.3, 131) === 131, '2/3 mis-detection should fall back to reference');
    check(H.recipes.tempoOverride(65.6, 131) === null, 'octave error should be accepted (folded)');
  });

  let rendered = null;
  test('Paramore recipe end-to-end with synthetic stand-ins', function () {
    const recipeDef = H.recipes.curated.paramore;
    const main = fixture('A', 131, 'Ab major', 11);
    const misery = fixture('B', 173, 'Db major', 12);
    const sugar = fixture('C', 162, 'D major', 13);
    const tracks = {
      main: Object.assign({}, main, { role: 'main', name: 'Stand-in for TWYG' }),
      misery: Object.assign({}, misery, { role: 'layer', name: 'Stand-in for Misery Business' }),
      sugar: Object.assign({}, sugar, { role: 'layer', name: "Stand-in for Sugar, We're Goin Down" }),
    };
    const recipe = H.recipes.bindRecipe(recipeDef, { main: 'main', nostalgia1: 'misery', nostalgia2: 'sugar' });
    const result = H.renderRemix(tracks, recipe);
    rendered = result;
    const plan = result.plan;
    const seconds = result.channels[0].length / SR;
    check(plan.totalBars === 18, 'bars ' + plan.totalBars);
    check(Math.abs(seconds - 18 * 240 / 164) < 0.01, 'duration ' + seconds);
    check(plan.targetKey.indexOf('C major') === 0, 'target key ' + plan.targetKey);
    check(Math.abs(plan.tracks.misery.semitones + 1) < 1e-6, 'misery shift ' + plan.tracks.misery.semitones);
    check(Math.abs(plan.tracks.sugar.semitones + 2) < 1e-6, 'sugar shift ' + plan.tracks.sugar.semitones);
    check(Math.abs(plan.tracks.main.tempoRatio - 164 / 131) < 0.02, 'main ratio ' + plan.tracks.main.tempoRatio);
    check(!H.hasInvalidSamples(result.channels), 'NaN/Infinity in output');
    check(H.peakOf(result.channels) <= Math.pow(10, -1 / 20) + 1e-4, 'peak ' + H.peakOf(result.channels));
    check(Math.abs(result.score.loudness + 10) < 1.5, 'loudness ' + result.score.loudness);
    check(result.score.score >= 0 && result.score.score <= 100, 'score ' + result.score.score);
    H.describePlan(plan).forEach(function (line) {
      log('       ' + line);
    });
    log('       viral score ' + result.score.score + ' — ' + result.score.grade);
  });

  test('rendered remix re-analyses at the target tempo', function () {
    check(rendered, 'render failed earlier');
    const track = H.prepareTrack(rendered.channels, SR);
    const analysis = H.analyzeTrack(track);
    check(octaveError(analysis.bpm, 164) < 0.02, 'output tempo ' + analysis.bpm);
  });

  test('single-track sped-up preset renders loop-ready at requested length', function () {
    const main = fixture('A', 131, 'Ab major', 11);
    const parsed = H.parseRequest('sped up, higher pitch, crisp, 25 seconds', { trackCount: 1 });
    const result = H.renderRemix({ main: Object.assign({}, main, { role: 'main' }) }, parsed.patch);
    const seconds = result.channels[0].length / SR;
    check(Math.abs(seconds - 25) < 240 / result.plan.targetBpm + 0.01, 'duration ' + seconds);
    check(result.plan.segments.length === 1, 'segments');
    check(!H.hasInvalidSamples(result.channels), 'NaN');
  });

  test('WAV encoder writes a valid 16-bit stereo header', function () {
    const wav = H.encodeWav([new Float32Array(100), new Float32Array(100)], SR);
    const view = new DataView(wav);
    check(wav.byteLength === 44 + 400, 'size ' + wav.byteLength);
    check(view.getUint32(24, true) === SR && view.getUint16(22, true) === 2 && view.getUint16(34, true) === 16, 'header');
  });

  log('');
  log(passes + ' passed, ' + failures + ' failed');
  if (failures) {
    if (isNode) {
      process.exit(1);
    } else {
      throw new Error(failures + ' test(s) failed');
    }
  }
})();
