/*
 * Render the curated Paramore recipe with synthetic stand-in tracks (same tempo
 * and key as the real songs) and print a JSON report plus a base64 WAV.
 *
 *   jsc tools/render_standin_demo.js -- <webDir>   (or: node tools/render_standin_demo.js <webDir>)
 *
 * Output lines:  REPORT {json}   and   WAV <base64>
 */
(function () {
  'use strict';
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  const log = isNode ? console.log : print;
  const args = isNode ? process.argv.slice(2) : (globalThis.arguments ? Array.prototype.slice.call(globalThis.arguments) : []);
  const webDir = (args[0] || 'apps/hookline/web').replace(/\/$/, '') + '/';
  function loadScript(path) {
    if (isNode) {
      require('vm').runInThisContext(require('fs').readFileSync(path, 'utf8'), { filename: path });
    } else {
      load(path);
    }
  }
  loadScript(webDir + 'engine.js');
  loadScript(webDir + 'demo.js');
  loadScript(webDir + 'recipes.js');
  const H = globalThis.Hookline;
  const recipeDef = H.recipes.curated.paramore;
  const specs = { main: [131, 'Ab major', 11], nostalgia1: [173, 'Db major', 12], nostalgia2: [162, 'D major', 13] };
  const session = H.createSession();
  const settings = {};
  const analyses = {};
  recipeDef.slots.forEach(function (slot) {
    const spec = specs[slot.id];
    const demo = H.demo.demoTrack({ bpm: spec[0], key: spec[1], bars: 32, seed: spec[2] });
    const analysis = session.addTrack(slot.id, demo.channels, demo.sampleRate, 'Stand-in for ' + slot.label);
    analyses[slot.id] = { bpm: analysis.bpm, key: analysis.key.name, hook: analysis.hooks[0].start };
    const override = H.recipes.tempoOverride(analysis.bpm, slot.refBpm);
    settings[slot.id] = { role: slot.role, name: 'Stand-in for ' + slot.label, overrides: override ? { bpm: override } : {} };
  });
  const mapping = { main: 'main', nostalgia1: 'nostalgia1', nostalgia2: 'nostalgia2' };
  const result = session.render(settings, H.recipes.bindRecipe(recipeDef, mapping));
  log('REPORT ' + JSON.stringify({
    analyses: analyses,
    plan: H.describePlan(result.plan),
    segments: result.plan.segments.map(function (s) {
      return { track: s.track, bars: s.bars, startBar: s.startBar, sourceStartSec: s.sourceStartSec, tempoRatio: s.tempoRatio, semitones: s.semitones };
    }),
    targetBpm: result.plan.targetBpm,
    targetKey: result.plan.targetKey,
    durationSec: result.channels[0].length / result.sampleRate,
    score: result.score,
  }));
  log('WAV ' + H.base64FromBuffer(H.encodeWav(result.channels, result.sampleRate)));
})();
