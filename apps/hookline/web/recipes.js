/*
 * Hookline presets and curated recipes.
 *
 * Presets are plain-language requests: they go through the same request parser a
 * user's own words do, so there is one source of truth for "what sped up means".
 * Curated recipes pin exact values and an arrangement, and declare "slots" that
 * are matched to the user's uploaded files by filename.
 */
(function (root) {
  'use strict';
  const H = root.Hookline;

  const presets = [
    { id: 'sped-up', name: 'Sped Up', request: 'sped up, higher pitch, crisp, 25 seconds' },
    { id: 'nightcore', name: 'Nightcore', request: 'nightcore, very fast and high, 20 seconds' },
    { id: 'slowed-reverb', name: 'Slowed + Reverb', request: 'slowed + reverb, dreamy, 30 seconds' },
    { id: 'bass-boosted', name: 'Bass Boosted', request: 'bass boosted and punchy, a bit faster' },
    { id: '8d', name: '8D Audio', request: '8d audio for headphones with dreamy reverb' },
    { id: 'lofi', name: 'Lo-fi Throwback', request: 'lofi vintage cassette vibe, a bit slower' },
    { id: 'mashup', name: 'Nostalgia Mashup', request: 'nostalgic mashup of all my songs, sped up and high' },
  ];

  // The user's test request, kept verbatim, and the remix decisions behind it.
  const paramore = {
    id: 'paramore-twyg-nostalgia',
    name: "That's What You Get — Nostalgia Sped Up",
    request: "remix paramore that's what you get, high, faster tempo, pitch up, with other nostalgic related songs remixed into it",
    why: [
      'Tempo 131 → 164 BPM (×1.25): the sped-up sweet spot, and within 5 % of both pop-punk layers so they barely stretch.',
      'Pitch +4 semitones: lands Ab major exactly on C major — "high" without the off-key wobble of a raw ×1.25 speed-up (+3.86 st).',
      'Layers key-matched to C: Misery Business (Db, −1 st) and Sugar, We\'re Goin Down (D, −2 st) — tiny shifts keep the vocals natural.',
      'Opens on the Misery Business riff (instant 2007 recognition), hits the TWYG chorus by 3 s, riser into Fall Out Boy, back to TWYG and loops.',
      '18 bars = 26.3 s: inside the 12–35 s short-form window, ends on a bar line and folds into the start for a seamless loop.',
    ],
    slots: [
      { id: 'main', role: 'main', label: "Paramore — That's What You Get", match: ['that', 'what you get', 'twyg'], refBpm: 131, refKey: 'Ab major' },
      { id: 'nostalgia1', role: 'layer', label: 'Paramore — Misery Business', match: ['misery'], refBpm: 173, refKey: 'Db major' },
      { id: 'nostalgia2', role: 'layer', label: "Fall Out Boy — Sugar, We're Goin Down", match: ['sugar', 'goin down', 'going down', 'fall out'], refBpm: 162, refKey: 'D major' },
    ],
    recipe: {
      targetBpm: 164,
      semitones: 4,
      mode: 'independent',
      keyMatch: true,
      mashup: true,
      lengthSec: 26,
      xfadeBeats: 1,
      loop: true,
      style: 'sped',
      fx: { reverb: 0.12, bass: 3, air: 2, lofi: 0, eightD: 0 },
      segments: [
        { track: 'nostalgia1', from: 'hook', offsetBars: 0, bars: 2, filterIn: true },
        { track: 'main', from: 'hook', offsetBars: 0, bars: 8 },
        { track: 'nostalgia2', from: 'hook', offsetBars: 0, bars: 4, riserBefore: true },
        { track: 'main', from: 'hook', offsetBars: 4, bars: 4 },
      ],
    },
  };

  // Map recipe slots to uploaded track ids: filename keywords first, then upload order.
  function assignSlots(recipeDef, tracks) {
    const available = tracks.slice();
    const mapping = {};
    recipeDef.slots.forEach(function (slot) {
      const index = available.findIndex(function (t) {
        const name = (t.name || '').toLowerCase();
        return slot.match.some(function (word) {
          return name.indexOf(word) >= 0;
        });
      });
      if (index >= 0) {
        mapping[slot.id] = available[index].id;
        available.splice(index, 1);
      }
    });
    recipeDef.slots.forEach(function (slot) {
      if (!mapping[slot.id] && available.length) {
        mapping[slot.id] = available.shift().id;
      }
    });
    return mapping;
  }

  // Rewrite slot ids in a curated recipe to concrete track ids.
  function bindRecipe(recipeDef, mapping) {
    const recipe = JSON.parse(JSON.stringify(recipeDef.recipe));
    recipe.mainId = mapping.main;
    recipe.segments = recipe.segments.filter(function (seg) {
      return mapping[seg.track];
    }).map(function (seg) {
      return Object.assign({}, seg, { track: mapping[seg.track] });
    });
    return recipe;
  }

  // Detected tempo that disagrees with the reference (beyond octave folding) is
  // probably a 2/3 or 3/2 mis-detection: fall back to the reference value.
  function tempoOverride(detectedBpm, refBpm) {
    if (!refBpm || !detectedBpm) {
      return null;
    }
    const folded = H.foldedTempoRatio(refBpm, detectedBpm);
    return Math.abs(folded - 1) > 0.04 ? refBpm : null;
  }

  H.recipes = {
    presets: presets,
    curated: { paramore: paramore },
    assignSlots: assignSlots,
    bindRecipe: bindRecipe,
    tempoOverride: tempoOverride,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
