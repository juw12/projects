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
      'Concept target: 164 BPM and +4 semitones. Verify tempo/key and audition the uploaded recordings; catalogue metadata and automatic estimates can disagree.',
      'If the source is Ab major, +4 semitones lands on C major. Independent pitch avoids fractional-semitone tuning from a raw speed change.',
      'Key-match follows your detected or manually corrected keys, not the catalogue labels. This is full-track crossfading, not stem separation.',
      'Planned sequence: 2 bars Misery Business → 8 TWYG → 4 Sugar → 4 TWYG. Hook detection is approximate; it cannot guarantee a riff or chorus.',
      'The 18-bar arrangement lasts about 26.3 seconds. Loop blending reduces abrupt edges but does not guarantee a seamless musical loop or audience engagement.',
    ],
    slots: [
      { id: 'main', role: 'main', label: "Paramore — That's What You Get", match: ['thats what you get', 'what you get', 'twyg'], refBpm: 131, refKey: 'Ab major' },
      { id: 'nostalgia1', role: 'layer', label: 'Paramore — Misery Business', match: ['misery business'], refBpm: 173, refKey: 'Db major' },
      { id: 'nostalgia2', role: 'layer', label: "Fall Out Boy — Sugar, We're Goin Down", match: ['sugar were goin down', 'goin down', 'going down'], refBpm: 162, refKey: 'D major' },
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

  function normalizedName(name) {
    return String(name || '').normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Suggest only unique title matches. Never assign arbitrary uploads by order.
  function assignSlots(recipeDef, tracks) {
    const mapping = {};
    const used = new Set();
    recipeDef.slots.forEach(function (slot) {
      const matches = tracks.filter(function (track) {
        const name = ' ' + normalizedName(track.name) + ' ';
        return !used.has(track.id) && slot.match.some(function (word) {
          return name.includes(' ' + normalizedName(word) + ' ');
        });
      });
      if (matches.length === 1) {
        mapping[slot.id] = matches[0].id;
        used.add(matches[0].id);
      }
    });
    return mapping;
  }

  function bindRecipe(recipeDef, mapping) {
    const ids = recipeDef.slots.map(function (slot) {
      if (!mapping[slot.id]) {
        throw new Error('Select the recording for ' + slot.label + ' before applying this recipe.');
      }
      return mapping[slot.id];
    });
    if (new Set(ids).size !== ids.length) {
      throw new Error('Choose a different recording for each recipe slot.');
    }
    const recipe = JSON.parse(JSON.stringify(recipeDef.recipe));
    recipe.mainId = mapping.main;
    recipe.segments = recipe.segments.map(function (seg) {
      return Object.assign({}, seg, { track: mapping[seg.track] });
    });
    return H.makeRecipe(recipe);
  }

  // Portable recipe files contain stable source identities, never session ids.
  // This checksum detects accidental source substitutions; it is not cryptographic.
  function fingerprint(channels) {
    let hash = 2166136261;
    const count = Math.min(channels[0].length, 1024);
    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * (channels[0].length - 1) / Math.max(1, count - 1));
      let sample = 0;
      channels.forEach(function (c) { sample += c[index] / channels.length; });
      hash = Math.imul(hash ^ Math.round(sample * 32767), 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function saveProject(tracks, recipe, request, publication) {
    const validated = H.makeRecipe(recipe);
    const active = tracks.filter(function (t) { return t.ready && t.role !== 'off'; });
    const mapping = {};
    const sources = active.map(function (t, i) {
      const ref = 'source-' + (i + 1);
      mapping[t.id] = ref;
      return {
        ref: ref, name: t.name, duration: t.analysis.duration,
        fingerprint: fingerprint(t.channels), role: t.role,
        overrides: JSON.parse(JSON.stringify(t.overrides || {})),
        rights: H.rights.declaration(t.rights),
      };
    });
    if (validated.mainId) {
      if (!mapping[validated.mainId]) { throw new Error('Recipe main track is not active.'); }
      validated.mainId = mapping[validated.mainId];
    }
    if (validated.segments) {
      validated.segments.forEach(function (s) {
        if (!mapping[s.track]) { throw new Error('Recipe references an inactive track.'); }
        s.track = mapping[s.track];
      });
    }
    return { format: 'hookline-project', schema: 2, version: H.VERSION, request: String(request || '').slice(0, 2000), sources: sources, recipe: validated, publication: H.rights.publication(publication) };
  }

  function loadProject(data, tracks) {
    if (!data || data.format !== 'hookline-project' || data.schema !== 2) {
      throw new Error('Use a v1.1 or newer portable recipe. Older files use temporary track IDs; recreate and save them in this version.');
    }
    if (!Array.isArray(data.sources) || !data.sources.length || data.sources.length > H.LIMITS.maxTracks) {
      throw new Error('Invalid recipe source manifest.');
    }
    const recipe = H.makeRecipe(data.recipe);
    const mapping = Object.create(null);
    const assignments = [];
    const used = new Set();
    data.sources.forEach(function (src) {
      if (!src || typeof src.ref !== 'string' || !/^source-[1-4]$/.test(src.ref) || mapping[src.ref] ||
          typeof src.name !== 'string' || typeof src.fingerprint !== 'string' || !Number.isFinite(src.duration) ||
          !['main', 'layer'].includes(src.role)) {
        throw new Error('Invalid or duplicate source reference.');
      }
      const matches = tracks.filter(function (t) {
        return t.ready && normalizedName(t.name) === normalizedName(src.name) &&
          Math.abs(t.analysis.duration - src.duration) < 0.05 && fingerprint(t.channels) === src.fingerprint;
      });
      if (matches.length !== 1 || used.has(matches[0].id)) {
        throw new Error('Upload exactly one unchanged copy of “' + src.name + '” before loading this recipe.');
      }
      const overrides = src.overrides || {};
      if (typeof overrides !== 'object' || Array.isArray(overrides)) { throw new Error('Invalid source settings.'); }
      Object.keys(overrides).forEach(function (key) {
        if (!['bpm', 'key', 'hookSec', 'semitones'].includes(key)) { throw new Error('Unknown source setting.'); }
        const value = overrides[key];
        const limits = { bpm: [30, 300], hookSec: [0, src.duration], semitones: [-6, 6] };
        if (limits[key] && (typeof value !== 'number' || !Number.isFinite(value) || value < limits[key][0] || value > limits[key][1])) {
          throw new Error('Invalid source ' + key);
        }
        if (key === 'key' && (!value || !Number.isInteger(value.pc) || value.pc < 0 || value.pc > 11 || !['major', 'minor'].includes(value.mode))) {
          throw new Error('Invalid source key.');
        }
      });
      mapping[src.ref] = matches[0].id;
      used.add(matches[0].id);
      assignments.push({ id: matches[0].id, role: src.role, overrides: JSON.parse(JSON.stringify(overrides)), rights: H.rights.declaration(src.rights) });
    });
    if (assignments.filter(function (a) { return a.role === 'main'; }).length !== 1) {
      throw new Error('A portable recipe must have exactly one main track.');
    }
    if (recipe.mainId) {
      if (!mapping[recipe.mainId]) { throw new Error('Missing main source reference.'); }
      recipe.mainId = mapping[recipe.mainId];
    }
    if (recipe.segments) {
      recipe.segments.forEach(function (s) {
        if (!mapping[s.track]) { throw new Error('Missing segment source reference.'); }
        s.track = mapping[s.track];
      });
    }
    return { recipe: recipe, assignments: assignments, request: String(data.request || '').slice(0, 2000), publication: H.rights.publication(data.publication) };
  }

  H.recipes = {
    presets: presets,
    saveProject: saveProject,
    loadProject: loadProject,
    curated: { paramore: paramore },
    assignSlots: assignSlots,
    bindRecipe: bindRecipe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
