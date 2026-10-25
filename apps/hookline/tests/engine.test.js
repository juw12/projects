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

  test('curated recipe: slot assignment by unique filename match', function () {
    const recipeDef = H.recipes.curated.paramore;
    const mapping = H.recipes.assignSlots(recipeDef, [
      { id: 't1', name: 'Fall Out Boy - Sugar Were Goin Down.mp3' },
      { id: 't2', name: "Paramore - That's What You Get.m4a" },
      { id: 't3', name: 'Paramore - Misery Business.mp3' },
    ]);
    check(mapping.main === 't2' && mapping.nostalgia1 === 't3' && mapping.nostalgia2 === 't1', JSON.stringify(mapping));
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
    check(Math.abs(result.score.loudness + 14) < 1.5, 'loudness ' + result.score.loudness);
    check(result.score.score >= 0 && result.score.score <= 100, 'score ' + result.score.score);
    H.describePlan(plan).forEach(function (line) {
      log('       ' + line);
    });
    log('       edit score ' + result.score.score + ' — ' + result.score.grade);
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


  function rejects(fn, messagePart) {
    let message = '';
    try {
      fn();
    } catch (err) {
      message = err.message;
    }
    check(message && (!messagePart || message.includes(messagePart)), 'Expected rejection: ' + messagePart + '; got: ' + message);
  }

  test('recipe bounds reject non-finite numbers and malicious objects', function () {
    [NaN, Infinity, -Infinity, 0, -1, 99, '1.2', null].forEach(function (tempo) {
      rejects(function () { H.makeRecipe({ tempo: tempo }); });
    });
    rejects(function () { H.makeRecipe(JSON.parse('{"__proto__":{"polluted":true}}')); }, 'Unsafe');
    check(!{}.polluted, 'prototype polluted');
    rejects(function () { H.makeRecipe({ fx: { reverb: 300 } }); });
    rejects(function () { H.makeRecipe({ fx: null }); });
    rejects(function () { H.makeRecipe({ mystery: 1 }); }, 'Unknown');
    rejects(function () { H.makeRecipe({ mode: 'unknown' }); });
    rejects(function () { H.makeRecipe({ loop: 'yes' }); });
    rejects(function () { H.makeRecipe({ targetLufs: -1 }); });
  });

  test('segment bounds reject excessive counts, fractional bars and negative time', function () {
    rejects(function () { H.makeRecipe({ segments: [] }); });
    rejects(function () { H.makeRecipe({ segments: new Array(17).fill({ track: 'a', bars: 1 }) }); });
    rejects(function () { H.makeRecipe({ segments: [{ track: 'a', bars: 0.5 }] }); });
    rejects(function () { H.makeRecipe({ segments: [{ track: 'a', bars: 2, from: 'time', startSec: -1 }] }); });
  });

  test('requests respect negation rather than enable unwanted effects', function () {
    const p = H.parseRequest('faster, no reverb, without bass boost, no lofi, no mashup, no loop', { trackCount: 3 }).patch;
    check(p.tempo > 1, 'tempo');
    check(p.fx.reverb === 0 && p.fx.bass === 0 && p.fx.lofi === 0, JSON.stringify(p));
    check(p.mashup === false && p.loop === false, JSON.stringify(p));
    const q = H.parseRequest('nightcore, no pitch shift', {}).patch;
    check(q.mode === 'independent' && q.semitones === 0, 'negated pitch ignored');
  });

  test('requests interpret signed downward shifts and reject impossible numbers', function () {
    check(H.parseRequest('down 2 semitones').patch.semitones === -2, 'down not parsed');
    check(H.parseRequest('20 seconds').patch.lengthSec === 20, 'length');
    rejects(function () { H.parseRequest('99x'); }, 'tempo');
    rejects(function () { H.parseRequest('500 bpm'); }, 'BPM');
    rejects(function () { H.parseRequest('120 seconds'); }, 'length');
    rejects(function () { H.parseRequest('100% slower'); }, 'Tempo');
    check(H.parseRequest('2000s nostalgia').patch.lengthSec === undefined, 'decade parsed as duration');
  });

  test('audio validation rejects silence, malformed channels, NaN and unsupported rate', function () {
    rejects(function () { H.prepareTrack([new Float32Array(SR)], SR); }, 'silent');
    rejects(function () { H.prepareTrack([sine(440, 2, SR), new Float32Array(1)], SR); });
    const bad = sine(440, 2, SR);
    bad[100] = NaN;
    rejects(function () { H.prepareTrack([bad], SR); }, 'non-finite');
    rejects(function () { H.prepareTrack([sine(440, 2, SR)], 0); }, 'Sample rate');
    rejects(function () { H.prepareTrack([new Float32Array(2)], SR); });
  });

  function usableMain() {
    return Object.assign({}, fixture('A', 131, 'Ab major', 11), { role: 'main' });
  }

  test('render plan rejects missing/off sources, mixed rates and oversized outputs', function () {
    const main = usableMain();
    const off = Object.assign({}, main, { role: 'off' });
    rejects(function () { H.planRemix({ main: main }, { mainId: 'missing' }); }, 'main track');
    rejects(function () { H.planRemix({ main: main, off: off }, { segments: [{ track: 'off', bars: 2 }] }); }, 'disabled');
    rejects(function () { H.planRemix({ main: main }, { segments: [{ track: 'missing', bars: 2 }] }); }, 'missing');
    rejects(function () {
      H.planRemix({ main: main, second: Object.assign({}, main, { role: 'layer', sampleRate: 48000 }) }, {});
    }, 'sample rate');
    rejects(function () {
      H.planRemix({ main: main }, { targetBpm: 70, segments: [{ track: 'main', bars: 32 }] });
    }, 'duration');
    rejects(function () { H.planRemix({ main: main }, { targetBpm: 240, tempo: 3 }); });
  });

  test('short source and manual source bounds fail instead of padding seconds of silence', function () {
    const main = usableMain();
    rejects(function () {
      H.planRemix({ main: main }, { segments: [{ track: 'main', bars: 8, from: 'time', startSec: main.duration - 1 }] });
    }, 'available audio');
    const short = Object.assign({}, main, { duration: 2, overrides: { hookSec: 0 } });
    rejects(function () { H.planRemix({ main: short }, { lengthSec: 30 }); }, 'too short');
  });

  test('automatic source adjustment emits an explicit warning', function () {
    const main = usableMain();
    main.overrides = { hookSec: main.duration - 1 };
    const plan = H.planRemix({ main: main }, { lengthSec: 20 });
    check(plan.warnings.some(function (w) { return w.includes('hook moved'); }), 'missing adjustment warning');
    const seg = plan.segments[0];
    check(seg.sourceStartSec + seg.outLengthSec * seg.tempoRatio <= main.duration, 'out of bounds');
  });

  test('curated slots never guess arbitrary recordings or collapse missing segments', function () {
    const def = H.recipes.curated.paramore;
    check(Object.keys(H.recipes.assignSlots(def, [{ id: 'x', name: 'that random song' }])).length === 0, 'guessed a slot');
    check(!H.recipes.assignSlots(def, [{ id: 'a', name: 'Misery Business' }, { id: 'b', name: 'Misery Business' }]).nostalgia1, 'ambiguous match accepted');
    rejects(function () { H.recipes.bindRecipe(def, { nostalgia1: 'x' }); }, 'Select');
    rejects(function () { H.recipes.bindRecipe(def, { main: 'x', nostalgia1: 'x', nostalgia2: 'y' }); }, 'different');
  });

  test('portable recipe restores reordered uploads, corrected metadata and segment refs', function () {
    const a = Object.assign({}, usableMain(), { id: 't1', name: 'Song A', ready: true, overrides: { bpm: 132, hookSec: 8, key: { pc: 8, mode: 'major' } } });
    const b = Object.assign({}, fixture('B', 173, 'Db major', 12), { id: 't2', name: 'Song B', role: 'layer', ready: true, overrides: { semitones: -1 } });
    const saved = H.recipes.saveProject([a, b], { mainId: 't1', segments: [{ track: 't2', bars: 2 }, { track: 't1', bars: 8 }] }, 'higher');
    const restored = H.recipes.loadProject(JSON.parse(JSON.stringify(saved)), [Object.assign({}, b, { id: 'new1' }), Object.assign({}, a, { id: 'new2' })]);
    check(restored.recipe.mainId === 'new2', 'wrong main');
    check(restored.recipe.segments[0].track === 'new1', 'wrong segment');
    check(restored.assignments.find(function (v) { return v.id === 'new2'; }).overrides.bpm === 132, 'lost correction');
    check(saved.recipe.segments[0].track === 'source-2', 'mutation during load');
    rejects(function () { H.recipes.loadProject(saved, [a]); }, 'exactly one');
    rejects(function () { H.recipes.loadProject(saved, [a, a, b]); }, 'exactly one');
    rejects(function () { H.recipes.loadProject({ recipe: saved.recipe }, [a, b]); }, 'Older');
    const invalid = JSON.parse(JSON.stringify(saved));
    invalid.sources[0].overrides.bpm = '132';
    rejects(function () { H.recipes.loadProject(invalid, [a, b]); }, 'Invalid');
  });

  test('session restoration keeps loaded audio after worker recovery', function () {
    const main = usableMain();
    const session = H.createSession();
    session.restoreTrack('restored', main.channels, SR, 'Restored', main.analysis);
    const out = session.render({ restored: { role: 'main' } }, { lengthSec: 12 });
    check(out.channels[0].length > 0 && !H.hasInvalidSamples(out.channels), 'no recovered audio');
    rejects(function () { session.render({ absent: { role: 'main' } }, {}); }, 'unavailable');
  });

  test('editing score makes no virality claim and no fabricated recognition measurement', function () {
    check(rendered.score.factors.every(function (f) { return f.key !== 'recognition'; }), 'recognition metric remains');
    check(!/viral|potential/i.test(rendered.score.grade), 'unfounded grade');
    check(rendered.score.loudness < -12, 'new default should be less aggressive');
  });

  test('non-loop render ends at zero after effects and mastering', function () {
    const out = H.renderRemix({ main: usableMain() }, { lengthSec: 12, loop: false, fx: { reverb: 0.4 } });
    check(out.channels.every(function (c) { return c[c.length - 1] === 0; }), 'tail click');
  });

  test('short edits round to the nearest bar, without a four-bar minimum', function () {
    const r = H.makeRecipe({ lengthSec: 8 });
    const seg = H.autoArrange(['a'], 'a', [], r, 66)[0];
    check(seg.bars === 2, '8 seconds at 66 BPM must not become four bars');
  });

  test('recipe defaults and saved plans do not share mutable effects', function () {
    const first = H.makeRecipe();
    const second = H.makeRecipe();
    first.fx.bass = 9;
    check(second.fx.bass === 0 && H.DEFAULT_RECIPE.fx.bass === 0, 'effect leaked into defaults');
    const copied = H.makeRecipe(first);
    first.fx.bass = 3;
    check(copied.fx.bass === 9, 'effect leaked into saved copy');
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
