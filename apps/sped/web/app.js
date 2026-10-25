/* Sped UI — uploads, request parsing, fine-tuning, rendering, scoring, export. */
(function () {
  'use strict';
  const H = window.Sped;
  const root = document.getElementById('app');
  const params = new URLSearchParams(location.search);

  const state = {
    tracks: [],
    recipe: H.makeRecipe(),
    notes: [],
    curated: null,
    output: null,
    variants: [],
    busy: false,
    status: 'Drop songs to start — or try synthetic demo audio.',
    playing: null,
    loopPlayback: true,
    cancelled: false,
    stale: false,
    slotMapping: {},
    publication: H.rights.publication(),
  };
  let trackCounter = 0;
  let audioContext = null;

  // ---------------------------------------------------------------- engine client (worker with main-thread fallback)

  const engine = H.createEngineClient(function () { return state.tracks; }, function (mode) {
    const label = document.getElementById('engine-mode');
    if (label) {
      label.textContent = mode;
    }
  });

  // ---------------------------------------------------------------- helpers

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) {
      return '–';
    }
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'remix';
  }

  function ctx() {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      } catch (err) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
    }
    return audioContext;
  }

  function activeTracks() {
    return state.tracks.filter(function (t) {
      return t.ready && t.role !== 'off';
    });
  }

  const KEY_OPTIONS = (function () {
    const out = [];
    for (let pc = 0; pc < 12; pc++) {
      out.push({ pc: pc, mode: 'major' });
    }
    for (let pc = 0; pc < 12; pc++) {
      out.push({ pc: pc, mode: 'minor' });
    }
    return out;
  })();

  const TRACK_COLORS = ['#ff3d7f', '#22d3ee', '#a78bfa', '#facc15', '#34d399', '#fb923c'];

  function trackColor(id) {
    const index = state.tracks.findIndex(function (t) {
      return t.id === id;
    });
    return TRACK_COLORS[(index < 0 ? 0 : index) % TRACK_COLORS.length];
  }

  function setStatus(text) {
    state.status = text;
    const el = document.getElementById('status');
    if (el) {
      el.textContent = text;
    }
  }

  function setBusy(busy, text) {
    state.busy = busy;
    if (text) {
      setStatus(text);
    }
    document.body.classList.toggle('is-busy', busy);
    const workspace = document.getElementById('workspace');
    if (workspace) {
      workspace.disabled = busy;
    }
    const cancel = document.getElementById('cancel-task');
    if (cancel) {
      cancel.hidden = !busy || !/^https?:$/.test(location.protocol);
    }
    root.querySelectorAll('[data-needs-idle]').forEach(function (el) {
      el.disabled = busy;
    });
  }

  // ---------------------------------------------------------------- layout

  function shell() {
    root.innerHTML = [
      '<header class="topbar">',
      '  <div class="brand"><span class="logo" aria-hidden="true">',
      '    <svg viewBox="0 0 32 32" width="28" height="28"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#ff3d7f"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M7 19c3 0 3-7 6-7s3 10 6 10 3-12 6-12" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>',
      '  </span><div><h1>Sped</h1><p class="tagline">Make short-form edits from your songs</p></div></div>',
      '  <span class="pill" title="Decoding, analysis and rendering run in your browser">🔒 Songs never leave your device</span>',
      '</header>',
      '<p id="status" class="status" role="status" aria-live="polite"></p>',
      '<button id="cancel-task" class="btn" hidden>Cancel audio task</button>',
      '<main><fieldset id="workspace" class="layout">',
      '  <div class="col col-left">',
      '    <section class="card" id="songs-card"></section>',
      '    <section class="card" id="request-card"></section>',
      '    <section class="card" id="tune-card"></section>',
      '  </div>',
      '  <div class="col col-right">',
      '    <section class="card output-card" id="output-card"></section>',
      '    <section class="card" id="variants-card" hidden></section>',
      '    <section class="card" id="arrange-card"></section>',
      '    <section class="card" id="rights-card"></section>',
      '  </div>',
      '</fieldset></main>',
      '<footer class="footer">',
      '  <p>Use songs you have the rights to remix. Posting remixes of commercial music may need the platform\'s licensed library or the rights holder\'s permission. The edit score is a heuristic built from common short-form patterns — not a prediction.</p>',
      '  <p>Sped v' + H.VERSION + ' · engine: <span id="engine-mode"></span> · <a href="index.html">App</a> · <a href="web.html">Web</a> · <a href="mobile.html">Mobile</a></p>',
      '</footer>',
    ].join('\n');
    document.getElementById('engine-mode').textContent = engine.mode();
    renderSongs();
    renderRequest();
    renderTune();
    renderOutput();
    renderArrangement();
    renderRights();
    setStatus(state.status);
  }

  // ---------------------------------------------------------------- songs

  function renderSongs() {
    const card = document.getElementById('songs-card');
    const cards = state.tracks.map(function (t) {
      if (!t.ready) {
        return '<div class="track loading" data-id="' + t.id + '"><div class="track-head"><strong>' + escapeHtml(t.name) + '</strong><span class="muted">analysing…</span></div></div>';
      }
      const a = t.analysis;
      const bpm = t.overrides.bpm || a.bpm;
      const key = t.overrides.key || a.key;
      const hook = typeof t.overrides.hookSec === 'number' ? t.overrides.hookSec : a.hooks[0].start;
      const keyOptions = KEY_OPTIONS.map(function (k) {
        const selected = k.pc === key.pc && k.mode === key.mode ? ' selected' : '';
        return '<option value="' + k.pc + ':' + k.mode + '"' + selected + '>' + H.keyName(k) + '</option>';
      }).join('');
      const hookOptions = a.hooks.map(function (h, i) {
        const selected = Math.abs(h.start - hook) < 0.01 ? ' selected' : '';
        return '<option value="' + h.start + '"' + selected + '>' + formatTime(h.start) + (i === 0 ? ' (best)' : '') + '</option>';
      }).join('');
      return [
        '<div class="track" data-id="' + t.id + '" style="--track:' + trackColor(t.id) + '">',
        '  <div class="track-head">',
        '    <button class="icon-btn" data-action="preview" title="Preview hook" aria-label="Preview hook of ' + escapeHtml(t.name) + '">▶</button>',
        '    <strong class="track-name" title="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</strong>',
        '    <span class="muted">' + formatTime(a.duration) + '</span>',
        '    <select data-field="role" aria-label="Role">',
        ['main', 'layer', 'off'].map(function (r) {
          return '<option value="' + r + '"' + (t.role === r ? ' selected' : '') + '>' + { main: 'Main', layer: 'Mash-in', off: 'Off' }[r] + '</option>';
        }).join(''),
        '    </select>',
        '    <button class="icon-btn" data-action="remove" title="Remove" aria-label="Remove ' + escapeHtml(t.name) + '">✕</button>',
        '  </div>',
        '  <p class="small muted">Tempo and key are estimates; preview the hook and correct them if needed.</p>',
        '  <canvas class="mini-wave" width="600" height="56" aria-hidden="true"></canvas>',
        '  <div class="track-fields">',
        '    <label>BPM <input type="number" step="0.1" min="30" max="300" data-field="bpm" value="' + bpm.toFixed(1) + '"></label>',
        '    <button class="chip" data-action="double" title="Detected half-time? Double it">×2</button>',
        '    <button class="chip" data-action="half" title="Detected double-time? Halve it">÷2</button>',
        '    <label>Key <select data-field="key">' + keyOptions + '</select></label>',
        '    <label>Hook <select data-field="hook">' + hookOptions + '<option value="custom"' + (a.hooks.some(function (h) {
          return Math.abs(h.start - hook) < 0.01;
        }) ? '' : ' selected') + '>custom…</option></select></label>',
        '    <label class="narrow">at <input type="number" step="0.1" min="0" data-field="hookSec" value="' + hook.toFixed(1) + '">s</label>',
        '    <label class="narrow">nudge <input type="number" step="1" min="-6" max="6" data-field="semitones" value="' + (t.overrides.semitones || 0) + '">st</label>',
        '  </div>',
        t.warning ? '  <p class="warn">' + escapeHtml(t.warning) + '</p>' : '',
        '</div>',
      ].join('\n');
    }).join('\n');
    card.innerHTML = [
      '<h2><span class="step">1</span> Songs</h2>',
      '<label class="dropzone" id="dropzone">',
      '  <input type="file" id="file-input" aria-label="Upload audio files" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" multiple>',
      '  <strong>Drop songs here</strong> or click to upload',
      '  <span class="muted">Up to 4 tracks · 40 MB/file · 6 minutes/track · 15 minutes total. Format support depends on your browser.</span>',
      '</label>',
      '<div class="row">',
      '  <button class="btn ghost" data-action="demo" data-needs-idle>Try demo stand-ins</button>',
      '  <span class="muted small">Synthesised tracks at the Paramore test tempos/keys — not the real songs.</span>',
      '</div>',
      '<div class="tracks">' + cards + '</div>',
    ].join('\n');
    state.tracks.forEach(function (t) {
      if (t.ready) {
        drawMiniWave(t);
      }
    });
    renderRights();
    refreshTuneReadouts();
  }

  function drawMiniWave(track) {
    const el = root.querySelector('.track[data-id="' + track.id + '"] canvas');
    if (!el) {
      return;
    }
    const g = el.getContext('2d');
    const w = el.width;
    const h = el.height;
    if (!track.peaks) {
      track.peaks = H.waveformPeaks(track.channels, w);
    }
    g.clearRect(0, 0, w, h);
    const hook = typeof track.overrides.hookSec === 'number' ? track.overrides.hookSec : track.analysis.hooks[0].start;
    const x0 = (hook / track.analysis.duration) * w;
    const x1 = ((hook + 8 * 240 / (track.overrides.bpm || track.analysis.bpm)) / track.analysis.duration) * w;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    g.fillStyle = trackColor(track.id);
    for (let x = 0; x < w; x++) {
      const min = track.peaks[x * 2];
      const max = track.peaks[x * 2 + 1];
      g.fillRect(x, h / 2 - max * h / 2, 1, Math.max(1, (max - min) * h / 2));
    }
    g.fillStyle = '#fff';
    g.fillRect(x0, 0, 2, h);
  }

  async function checkFile(file) {
    if (file.size > H.LIMITS.maxFileBytes) {
      throw new Error('File exceeds the 40 MB limit. Trim or compress it first.');
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    try {
      const duration = await new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          reject(new Error('Could not read audio duration; use a WAV/MP3 file supported by this browser.'));
        }, 15000);
        audio.preload = 'metadata';
        audio.onloadedmetadata = function () {
          clearTimeout(timer);
          resolve(audio.duration);
        };
        audio.onerror = function () {
          clearTimeout(timer);
          reject(new Error('This browser cannot read this audio format. Try WAV or MP3.'));
        };
        audio.src = url;
      });
      const used = state.tracks.reduce(function (sum, t) { return sum + (t.ready ? t.analysis.duration : 0); }, 0);
      if (!Number.isFinite(duration) || duration < 1 || duration > H.LIMITS.maxTrackSeconds || duration + used > H.LIMITS.maxTotalSeconds) {
        throw new Error('Use 1–360 second tracks; the session limit is 900 seconds.');
      }
    } finally {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    }
  }

  async function addFiles(files) {
    if (state.busy) {
      return;
    }
    const list = Array.from(files);
    if (!list.length) {
      return;
    }
    if (state.tracks.length + list.length > H.LIMITS.maxTracks) {
      throw new Error('At most 4 tracks per session. Remove unused tracks first.');
    }
    state.cancelled = false;
    setBusy(true, 'Checking files…');
    const errors = [];
    try {
      for (const file of list) {
        if (state.cancelled) {
          break;
        }
        let track = null;
        try {
          if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|wav|ogg|flac|aac|opus|webm)$/i.test(file.name)) {
            throw new Error('Not a supported audio file.');
          }
          setStatus('Checking ' + file.name + '…');
          await checkFile(file);
          if (state.cancelled) { break; }
          const data = await file.arrayBuffer();
          const buffer = await ctx().decodeAudioData(data);
          if (state.cancelled) { break; }
          track = { id: 't' + (++trackCounter), name: file.name.replace(/\.[^.]+$/, ''), role: state.tracks.some(function (t) {
            return t.role === 'main';
          }) ? 'layer' : 'main', overrides: {}, ready: false };
          state.tracks.push(track);
          renderSongs();
          await registerTrack(track, buffer);
          markStale();
        } catch (err) {
          if (track) {
            state.tracks = state.tracks.filter(function (t) { return t.id !== track.id; });
          }
          errors.push(file.name + ': ' + err.message);
        }
      }
    } finally {
      setBusy(false);
      renderSongs();
      renderRequest();
      renderArrangement();
      if (errors.length) {
        setStatus(errors.join(' • '));
      }
    }
  }

  async function registerTrack(track, buffer) {
    if (buffer.numberOfChannels > 2) {
      throw new Error('Use mono or stereo audio, not multichannel.');
    }
    const used = state.tracks.reduce(function (sum, t) { return sum + (t.ready ? t.analysis.duration : 0); }, 0);
    if (buffer.duration > H.LIMITS.maxTrackSeconds || used + buffer.duration > H.LIMITS.maxTotalSeconds) {
      throw new Error('Decoded audio exceeds the session limit.');
    }
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
      channels.push(buffer.getChannelData(c));
    }
    track.buffer = buffer;
    track.channels = channels.length === 1 ? [channels[0], channels[0]] : channels;
    track.sampleRate = buffer.sampleRate;
    setBusy(true, 'Analysing ' + track.name + ' (tempo, key, hook)…');
    const copies = track.channels.map(function (c) {
      return new Float32Array(c);
    });
    const analysis = await engine.call('addTrack', {
      id: track.id, channels: copies, sampleRate: track.sampleRate, name: track.name,
    }, copies.map(function (c) { return c.buffer; }));
    track.analysis = analysis;
    track.ready = true;
    setStatus(track.name + ': ' + analysis.bpm.toFixed(1) + ' BPM, ' + analysis.key.name + ', hook at ' + formatTime(analysis.hooks[0].start) + '.');
  }

  async function addDemoTracks() {
    if (state.tracks.length + 3 > H.LIMITS.maxTracks) {
      throw new Error('The demo needs three free track slots. Remove tracks first.');
    }
    state.cancelled = false;
    const specs = [
      { name: "Synth stand-in (That's What You Get tempo/key)", bpm: 131, key: 'Ab major', seed: 11 },
      { name: 'Synth stand-in (Misery Business tempo/key)', bpm: 173, key: 'Db major', seed: 12 },
      { name: "Synth stand-in (Sugar, We're Goin Down tempo/key)", bpm: 162, key: 'D major', seed: 13 },
    ];
    setBusy(true, 'Synthesising demo stand-ins…');
    for (const spec of specs) {
      if (state.cancelled) { break; }
      await new Promise(function (r) {
        setTimeout(r, 20);
      });
      const demo = H.demo.demoTrack({ bpm: spec.bpm, key: spec.key, bars: 32, sampleRate: ctx().sampleRate, seed: spec.seed });
      const buffer = ctx().createBuffer(2, demo.channels[0].length, demo.sampleRate);
      buffer.copyToChannel(demo.channels[0], 0);
      buffer.copyToChannel(demo.channels[1], 1);
      const track = { id: 't' + (++trackCounter), name: spec.name, role: state.tracks.length ? 'layer' : 'main', overrides: {}, ready: false };
      state.tracks.push(track);
      renderSongs();
      try {
        await registerTrack(track, buffer);
      } catch (err) {
        state.tracks = state.tracks.filter(function (t) { return t.id !== track.id; });
        renderSongs();
        throw err;
      }
      renderSongs();
    }
    setBusy(false);
    renderRequest();
    if (!state.cancelled) {
      await applyCurated('paramore');
    }
  }

  function onSongsEvent(event) {
    const trackEl = event.target.closest('.track');
    const actionEl = event.target.closest('[data-action]');
    const action = actionEl && actionEl.dataset.action;
    if (action === 'demo') {
      return addDemoTracks();
    }
    if (!trackEl) {
      return;
    }
    const track = state.tracks.find(function (t) {
      return t.id === trackEl.dataset.id;
    });
    if (!track || !track.ready) {
      return;
    }
    const bpm = track.overrides.bpm || track.analysis.bpm;
    if (action === 'remove') {
      stopPlayback();
      engine.call('removeTrack', { id: track.id }).catch(function () {});
      state.tracks = state.tracks.filter(function (t) {
        return t.id !== track.id;
      });
      if (track.role === 'main') {
        const replacement = state.tracks.find(function (t) { return t.ready && t.role !== 'off'; });
        if (replacement) {
          replacement.role = 'main';
        }
        state.recipe.mainId = replacement ? replacement.id : null;
      }
      markStale();
      renderSongs();
      renderRequest();
      renderArrangement();
    } else if (action === 'double') {
      track.overrides.bpm = Math.min(300, Math.round(bpm * 2 * 10) / 10);
      markStale();
      renderSongs();
    } else if (action === 'half') {
      track.overrides.bpm = Math.max(30, Math.round(bpm / 2 * 10) / 10);
      markStale();
      renderSongs();
    } else if (action === 'preview') {
      const hook = typeof track.overrides.hookSec === 'number' ? track.overrides.hookSec : track.analysis.hooks[0].start;
      playBuffer(track.buffer, hook, Math.min(8, track.buffer.duration - hook), false);
    }
  }

  function onSongsChange(event) {
    const field = event.target.dataset.field;
    if (event.target.id === 'file-input') {
      const files = Array.from(event.target.files);
      event.target.value = '';
      return addFiles(files);
    }
    const trackEl = event.target.closest('.track');
    if (!field || !trackEl) {
      return;
    }
    const track = state.tracks.find(function (t) {
      return t.id === trackEl.dataset.id;
    });
    const value = event.target.value;
    if (field === 'role') {
      if (value === 'main') {
        state.tracks.forEach(function (t) {
          if (t.role === 'main') {
            t.role = 'layer';
          }
        });
      }
      track.role = value;
      if (value === 'main') { state.recipe.mainId = track.id; }
    } else if (field === 'bpm') {
      const v = parseFloat(value);
      if (!Number.isFinite(v) || v < 30 || v > 300) {
        renderSongs();
        throw new Error('Source BPM must be 30–300. The previous value was kept.');
      }
      track.overrides.bpm = v;
    } else if (field === 'key') {
      const parts = value.split(':');
      track.overrides.key = { pc: parseInt(parts[0], 10), mode: parts[1], name: H.keyName({ pc: parseInt(parts[0], 10), mode: parts[1] }) };
    } else if (field === 'hook') {
      if (value !== 'custom') {
        track.overrides.hookSec = parseFloat(value);
      }
    } else if (field === 'hookSec') {
      const v = parseFloat(value);
      if (isFinite(v)) {
        track.overrides.hookSec = Math.max(0, Math.min(track.analysis.duration - 1, v));
      }
    } else if (field === 'semitones') {
      const nudge = parseFloat(value);
      if (!Number.isFinite(nudge) || nudge < -6 || nudge > 6) {
        renderSongs();
        throw new Error('Source pitch nudge must be −6 to +6 semitones.');
      }
      track.overrides.semitones = nudge;
    }
    if (!state.tracks.some(function (t) { return t.role === 'main'; })) {
      const candidate = state.tracks.find(function (t) { return t.ready && t.role !== 'off'; });
      if (candidate) { candidate.role = 'main'; }
    }
    const main = state.tracks.find(function (t) { return t.role === 'main'; });
    state.recipe.mainId = main ? main.id : null;
    markStale();
    renderSongs();
    renderRequest();
  }

  // ---------------------------------------------------------------- request

  function renderRequest() {
    const card = document.getElementById('request-card');
    const curated = H.recipes.curated.paramore;
    card.innerHTML = [
      '<h2><span class="step">2</span> Your request</h2>',
      '<textarea id="request" aria-label="Remix request" maxlength="2000" rows="3" placeholder="e.g. make it higher and faster, add a nostalgic 2000s mashup, 25 seconds">' + escapeHtml(state.request || '') + '</textarea>',
      '<div class="chips" role="list">',
      H.recipes.presets.map(function (p) {
        return '<button class="chip" role="listitem" data-preset="' + p.id + '" title="' + escapeHtml(p.request) + '">' + escapeHtml(p.name) + '</button>';
      }).join(''),
      '</div>',
      '<p class="small muted">Rule-based request parser, not an AI music model. Review the interpreted controls. Layering uses crossfades, not separated vocals/instruments.</p>',
      '<label class="btn ghost file-btn">Load portable recipe<input type="file" accept="application/json,.json" data-action="load-recipe" aria-label="Load portable recipe"></label>',
      '<div class="row">',
      '  <button class="btn primary" data-action="remix" data-needs-idle>Remix it</button>',
      '  <button class="btn" data-action="variants" data-needs-idle>Compare 3 edits</button>',
      '</div>',
      '<div class="curated">',
      renderSlots(curated),
      '  <div><span class="badge">Test recipe</span> <strong>' + escapeHtml(curated.name) + '</strong></div>',
      '  <p class="muted small">Paramore at 164 BPM, +4 st into C major, with Misery Business and Sugar, We\'re Goin Down mashed in. Select each recording below, verify its metadata, or try the synthetic demo.</p>',
      '  <button class="btn ghost" data-action="curated" data-needs-idle>Apply test recipe</button>',
      '</div>',
      state.notes.length ? '<ul class="notes">' + state.notes.map(function (n) {
        return '<li>' + escapeHtml(n) + '</li>';
      }).join('') + '</ul>' : '',
    ].join('\n');
  }

  function renderSlots(def) {
    const suggestions = H.recipes.assignSlots(def, state.tracks.filter(function (t) { return t.ready; }));
    return '<div class="slot-picker">' + def.slots.map(function (slot) {
      const selected = state.slotMapping[slot.id] || suggestions[slot.id] || '';
      return '<label>' + escapeHtml(slot.label) + '<select data-slot="' + slot.id + '">' +
        '<option value="">Choose recording…</option>' + state.tracks.filter(function (t) { return t.ready; }).map(function (t) {
          return '<option value="' + t.id + '"' + (selected === t.id ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>';
        }).join('') + '</select></label>';
    }).join('') + '</div>';
  }

  async function onRequestEvent(event) {
    const preset = event.target.closest('[data-preset]');
    const actionEl = event.target.closest('[data-action]');
    const textarea = document.getElementById('request');
    if (preset) {
      const p = H.recipes.presets.find(function (x) {
        return x.id === preset.dataset.preset;
      });
      textarea.value = p.request;
      state.request = p.request;
      return remixFromRequest();
    }
    if (!actionEl) {
      return;
    }
    state.request = textarea.value;
    if (actionEl.dataset.action === 'remix') {
      return remixFromRequest();
    }
    if (actionEl.dataset.action === 'variants') {
      return makeVariants();
    }
    if (actionEl.dataset.action === 'curated') {
      return applyCurated('paramore');
    }
  }

  async function remixFromRequest() {
    if (!activeTracks().length) {
      setStatus('Upload a song first (or try the demo stand-ins).');
      return;
    }
    const parsed = H.parseRequest(state.request || '', { trackCount: activeTracks().length });
    state.recipe = H.makeRecipe(parsed.patch);
    markStale();
    state.notes = parsed.notes;
    state.curated = null;
    renderRequest();
    renderTune();
    await renderRemix();
  }

  async function applyCurated(name) {
    const def = H.recipes.curated[name];
    const ready = state.tracks.filter(function (t) {
      return t.ready;
    });
    if (!ready.length) {
      setStatus('Upload the songs for the test recipe first (or try the demo stand-ins).');
      return;
    }
    const mapping = {};
    root.querySelectorAll('[data-slot]').forEach(function (el) {
      mapping[el.dataset.slot] = el.value;
    });
    const recipe = H.recipes.bindRecipe(def, mapping);
    const used = new Set(Object.values(mapping));
    def.slots.forEach(function (slot) {
      const track = ready.find(function (t) { return t.id === mapping[slot.id]; });
      if (!track) { throw new Error('A selected recording was removed. Select the slots again.'); }
      track.role = slot.role;
      // Resolve octave convention only; never force catalogue BPM or key.
      const current = track.overrides.bpm || track.analysis.bpm;
      const adjusted = current * Math.pow(2, Math.round(Math.log2(slot.refBpm / current)));
      if (Math.abs(adjusted / slot.refBpm - 1) < 0.04) {
        track.overrides.bpm = adjusted;
        track.warning = 'Tempo octave aligned to this recipe. Verify BPM, key and hook by ear.';
      } else {
        track.warning = 'Detected tempo differs from catalogue metadata. No catalogue value was forced; verify before using this edit.';
      }
    });
    ready.forEach(function (t) {
      if (!used.has(t.id)) { t.role = 'off'; }
    });
    state.slotMapping = mapping;
    state.recipe = recipe;
    state.request = def.request;
    state.notes = def.why;
    state.curated = name;
    renderSongs();
    renderRequest();
    renderTune();
    await renderRemix();
  }

  // ---------------------------------------------------------------- fine-tune

  function slider(id, label, min, max, step, value, format) {
    return '<label class="slider"><span>' + label + ' <output id="' + id + '-out">' + format(value) + '</output></span>' +
      '<input type="range" id="' + id + '" data-tune="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }

  function effectiveSpeed() {
    const main = state.tracks.find(function (t) { return t.ready && t.role === 'main'; });
    const bpm = main ? (main.overrides.bpm || main.analysis.bpm) : null;
    return state.recipe.targetBpm && bpm ? state.recipe.targetBpm / bpm : state.recipe.tempo;
  }

  function refreshTuneReadouts() {
    const r = state.recipe;
    const tempo = document.getElementById('tempo');
    const pitch = document.getElementById('semitones');
    const length = document.getElementById('lengthSec');
    if (!tempo || !pitch || !length) {
      return;
    }
    const ratio = effectiveSpeed();
    const main = state.tracks.find(function (t) { return t.ready && t.role === 'main'; });
    const nudge = main && main.overrides ? (main.overrides.semitones || 0) : 0;
    tempo.parentNode.querySelector('span').firstChild.textContent = r.targetBpm ? 'Tempo (target BPM takes priority) ' : 'Tempo ';
    document.getElementById('tempo-out').textContent = '×' + ratio.toFixed(3);
    pitch.disabled = r.mode === 'coupled';
    if (r.mode === 'coupled') {
      const semitones = 12 * Math.log2(ratio) + nudge;
      pitch.value = Math.max(-12, Math.min(12, semitones));
      document.getElementById('semitones-out').textContent = (semitones >= 0 ? '+' : '') + semitones.toFixed(2) + ' st';
    } else {
      pitch.value = r.semitones;
      document.getElementById('semitones-out').textContent = (r.semitones >= 0 ? '+' : '') + r.semitones + ' st' + (nudge ? ' · source nudge ' + (nudge > 0 ? '+' : '') + nudge : '');
    }
    length.disabled = !!r.segments;
    length.parentNode.querySelector('span').firstChild.textContent = r.segments ? 'Length (custom bars take priority) ' : 'Length (rounded to bars) ';
  }

  function renderTune() {
    const r = state.recipe;
    const fx = r.fx || {};
    const card = document.getElementById('tune-card');
    const pct = function (v) {
      return Math.round(v * 100) + '%';
    };
    card.innerHTML = [
      '<h2><span class="step">3</span> Fine-tune</h2>',
      '<div class="segmented" role="group" aria-label="Speed mode">',
      '  <button data-mode="independent" class="' + (r.mode !== 'coupled' ? 'on' : '') + '">Tempo & pitch separate</button>',
      '  <button data-mode="coupled" class="' + (r.mode === 'coupled' ? 'on' : '') + '">Classic speed (nightcore)</button>',
      '</div>',
      '<div class="tune-grid">',
      slider('targetLufs', 'Loudness target (approx)', -24, -9, 1, r.targetLufs, function (v) { return v + ' LUFS'; }),
      slider('tempo', r.targetBpm ? 'Tempo (target BPM takes priority)' : 'Tempo', 0.5, 2, 0.01, r.tempo, function (v) {
        return '×' + Number(v).toFixed(2);
      }),
      '<label class="field">Target BPM <input type="number" id="targetBpm" data-tune="targetBpm" min="40" max="240" step="0.5" placeholder="auto" value="' + (r.targetBpm || '') + '"></label>',
      slider('semitones', r.mode === 'coupled' ? 'Pitch (follows tempo)' : 'Pitch', -12, 12, 0.5, r.semitones, function (v) {
        return (v > 0 ? '+' : '') + v + ' st';
      }),
      slider('lengthSec', r.segments ? 'Length (custom bars override this)' : 'Length (rounded to bars)', 6, 60, 1, r.lengthSec, function (v) {
        return v + ' s';
      }),
      slider('reverb', 'Reverb', 0, 0.8, 0.01, fx.reverb || 0, pct),
      slider('bass', 'Bass', 0, 9, 0.5, fx.bass || 0, function (v) {
        return '+' + v + ' dB';
      }),
      slider('air', 'Air / sparkle', 0, 6, 0.5, fx.air || 0, function (v) {
        return '+' + v + ' dB';
      }),
      slider('lofi', 'Lo-fi', 0, 1, 0.01, fx.lofi || 0, pct),
      slider('eightD', '8D pan', 0, 1, 0.01, fx.eightD || 0, pct),
      '</div>',
      '<div class="toggles">',
      '  <label><input type="checkbox" data-tune="mashup"' + (r.mashup ? ' checked' : '') + '> Mash in other songs</label>',
      '  <label><input type="checkbox" data-tune="keyMatch"' + (r.keyMatch ? ' checked' : '') + '> Key-match layers</label>',
      '  <label><input type="checkbox" data-tune="loop"' + (r.loop ? ' checked' : '') + '> Blend loop boundary (audition it)</label>',
      '  <label>Style <select data-tune="style">' + ['sped', 'slowed', 'remix'].map(function (s) {
        return '<option' + (r.style === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') + '</select></label>',
      '</div>',
      '<div class="row"><button class="btn primary" data-action="render" data-needs-idle>Render</button>',
      '<button class="btn ghost" data-action="auto-arrange" data-needs-idle title="Discard the custom arrangement">Auto-arrange</button></div>',
    ].join('\n');
    refreshTuneReadouts();
  }

  function onTuneInput(event) {
    const key = event.target.dataset.tune;
    if (!key) {
      return;
    }
    const r = state.recipe;
    r.fx = r.fx || {};
    const el = event.target;
    const num = parseFloat(el.value);
    if (['reverb', 'bass', 'air', 'lofi', 'eightD'].indexOf(key) >= 0) {
      r.fx[key] = num;
    } else if (key === 'targetBpm') {
      if (el.value.trim() && (!Number.isFinite(num) || num < 40 || num > 240)) {
        el.value = r.targetBpm === null ? '' : r.targetBpm;
        throw new Error('Target BPM must be 40–240; clear the field for automatic tempo.');
      }
      r.targetBpm = el.value.trim() ? num : null;
    } else if (key === 'mashup' || key === 'keyMatch' || key === 'loop') {
      r[key] = el.checked;
      if (key === 'mashup') {
        r.segments = null;
      }
    } else if (key === 'style') {
      r.style = el.value;
    } else {
      r[key] = num;
      if (key === 'tempo') {
        r.targetBpm = null;
        document.getElementById('targetBpm').value = '';
      }
      if (key === 'lengthSec') {
        r.segments = null;
      }
    }
    markStale();
    const out = document.getElementById(key + '-out');
    if (out && el.type === 'range') {
      const v = num;
      out.textContent = { tempo: '×' + v.toFixed(2), semitones: (v > 0 ? '+' : '') + v + ' st', lengthSec: v + ' s', targetLufs: v + ' LUFS', bass: '+' + v + ' dB', air: '+' + v + ' dB' }[key] || Math.round(v * 100) + '%';
    }
    refreshTuneReadouts();
  }

  function onTuneClick(event) {
    const modeBtn = event.target.closest('[data-mode]');
    if (modeBtn) {
      state.recipe.mode = modeBtn.dataset.mode;
      markStale();
      renderTune();
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }
    if (actionEl.dataset.action === 'render') {
      return renderRemix();
    } else if (actionEl.dataset.action === 'auto-arrange') {
      state.recipe.segments = null;
      state.curated = null;
      renderTune();
      return renderRemix();
    }
  }

  // ---------------------------------------------------------------- render

  function trackSettings() {
    const settings = {};
    state.tracks.forEach(function (t) {
      if (t.ready) {
        settings[t.id] = { role: t.role, name: t.name, overrides: JSON.parse(JSON.stringify(t.overrides)) };
      }
    });
    return settings;
  }

  async function renderRemix(recipeOverride) {
    if (!activeTracks().length) {
      setStatus('Upload a song first (or try the demo stand-ins).');
      return null;
    }
    const recipe = recipeOverride || state.recipe;
    if (!recipeOverride) {
      markStale();
    }
    stopPlayback();
    setBusy(true, 'Rendering: time-stretch, pitch, mashup, FX, loudness…');
    const started = performance.now();
    try {
      const result = await engine.call('render', { settings: trackSettings(), recipe: H.makeRecipe(recipe) });
      if (recipeOverride) {
        return result;
      }
      state.output = result;
      state.stale = false;
      state.output.savedProject = H.recipes.saveProject(state.tracks, result.plan.recipe, state.request, state.publication);
      state.output.label = state.curated ? H.recipes.curated[state.curated].name : (state.request || 'remix');
      setStatus('Rendered ' + result.plan.durationSec.toFixed(1) + ' s at ' + result.plan.targetBpm.toFixed(1) + ' BPM in ' + ((performance.now() - started) / 1000).toFixed(1) + ' s · edit score ' + result.score.score + ' of 100.');
      document.body.dataset.state = 'rendered';
      document.body.dataset.score = result.score.score;
      renderOutput();
      renderArrangement();
      return result;
    } catch (err) {
      console.error(err);
      setStatus('Render failed: ' + err.message);
      return null;
    } finally {
      if (!recipeOverride) {
        setBusy(false);
      }
    }
  }

  // ---------------------------------------------------------------- output

  function renderOutput() {
    const card = document.getElementById('output-card');
    const out = state.output;
    if (!out) {
      card.innerHTML = '<h2><span class="step">4</span> Your sound</h2><div class="empty"><p>Your remix appears here with a waveform, an editing checklist and a WAV download.</p></div>';
      return;
    }
    const s = out.score;
    const ring = Math.round(s.score * 3.6);
    card.innerHTML = [
      '<h2><span class="step">4</span> Your sound</h2>',
      state.stale ? '<p class="warn">Settings changed. This playback/download is the PREVIOUS render; render again to apply edits.</p>' : '',
      '<canvas id="out-wave" class="out-wave" width="1200" height="180" aria-label="Waveform of the remix"></canvas>',
      '<div class="legend">' + Object.keys(out.plan.tracks).map(function (id) {
        return '<span><i style="background:' + trackColor(id) + '"></i>' + escapeHtml(out.plan.tracks[id].name) + '</span>';
      }).join('') + '</div>',
      '<div class="transport">',
      '  <button class="btn primary" data-action="play">▶ Play</button>',
      '  <label><input type="checkbox" data-action="loop-toggle"' + (state.loopPlayback ? ' checked' : '') + '> Loop</label>',
      '  <button class="btn" data-action="download" title="Export rendered audio; this does not grant publishing rights">⬇ WAV</button>',
      '  <button class="btn ghost" data-action="save-recipe">Save rendered recipe</button>',
      '  <label class="btn ghost file-btn">Load recipe<input type="file" accept="application/json,.json" data-action="load-recipe"></label>',
      '</div>',
      '<p class="muted small">WAV export is local editing, not rights clearance. The rendered recipe is a snapshot. Use Publishing notes below to save current source/permission notes.</p>',
      '<div class="score">',
      '  <div class="ring" style="--deg:' + ring + 'deg"><span>' + s.score + '</span></div>',
      '  <div><strong>' + escapeHtml(s.grade) + '</strong><p class="muted small">Unvalidated editing checklist — not a virality or audience prediction.</p></div>',
      '</div>',
      '<ul class="factors">' + s.factors.map(function (f) {
        return '<li><span class="f-label">' + escapeHtml(f.label) + '</span><span class="bar"><i style="width:' + Math.round(f.score * 100) + '%"></i></span><span class="f-value">' + escapeHtml(f.value) + '</span></li>';
      }).join('') + '</ul>',
      s.tips.length ? '<ul class="tips">' + s.tips.map(function (t) {
        return '<li>' + escapeHtml(t) + '</li>';
      }).join('') + '</ul>' : '',
      out.plan.warnings && out.plan.warnings.length ? '<ul class="warn">' + out.plan.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>' : '',
      '<ul class="plan">' + H.describePlan(out.plan).map(function (line) {
        return '<li>' + escapeHtml(line) + '</li>';
      }).join('') + '</ul>',
    ].join('\n');
    drawOutputWave(0);
  }

  function drawOutputWave(playheadSec) {
    const out = state.output;
    const el = document.getElementById('out-wave');
    if (!out || !el) {
      return;
    }
    const g = el.getContext('2d');
    const w = el.width;
    const h = el.height;
    if (!out.peaks) {
      out.peaks = H.waveformPeaks(out.channels, w);
    }
    g.clearRect(0, 0, w, h);
    const total = out.plan.durationSec;
    out.plan.segments.forEach(function (seg) {
      const x0 = Math.floor((seg.outStartSec / total) * w);
      const x1 = Math.floor(((seg.outStartSec + seg.outLengthSec) / total) * w);
      g.fillStyle = trackColor(seg.track);
      for (let x = x0; x < x1 && x < w; x++) {
        const min = out.peaks[x * 2];
        const max = out.peaks[x * 2 + 1];
        g.fillRect(x, h / 2 - max * h / 2, 1, Math.max(1, (max - min) * h / 2));
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x0, 0, 1, h);
    });
    if (playheadSec > 0) {
      g.fillStyle = '#fff';
      g.fillRect(Math.floor((playheadSec / total) * w), 0, 2, h);
    }
  }

  function playBuffer(buffer, offset, duration, loop) {
    stopPlayback();
    const audio = ctx();
    if (audio.state === 'suspended') {
      audio.resume();
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = !!loop;
    source.connect(audio.destination);
    if (duration && !loop) {
      source.start(0, offset || 0, duration);
    } else {
      source.start(0, offset || 0);
    }
    state.playing = { source: source, started: audio.currentTime, buffer: buffer, isOutput: buffer === (state.output && state.output.buffer) };
    source.onended = function () {
      if (state.playing && state.playing.source === source) {
        state.playing = null;
        updatePlayButton();
        drawOutputWave(0);
      }
    };
    updatePlayButton();
    if (state.playing.isOutput) {
      requestAnimationFrame(tick);
    }
  }

  function tick() {
    if (!state.playing || !state.playing.isOutput) {
      return;
    }
    const elapsed = ctx().currentTime - state.playing.started;
    const duration = state.playing.buffer.duration;
    drawOutputWave(elapsed % duration);
    requestAnimationFrame(tick);
  }

  function stopPlayback() {
    if (state.playing) {
      try {
        state.playing.source.stop();
      } catch (err) {
        /* already stopped */
      }
      state.playing = null;
    }
    updatePlayButton();
  }

  function updatePlayButton() {
    const btn = root.querySelector('[data-action="play"]');
    if (btn) {
      btn.textContent = state.playing && state.playing.isOutput ? '■ Stop' : '▶ Play';
    }
  }

  function outputBuffer(result) {
    if (!result.buffer) {
      const buffer = ctx().createBuffer(2, result.channels[0].length, result.sampleRate);
      buffer.copyToChannel(result.channels[0], 0);
      buffer.copyToChannel(result.channels[1], 1);
      result.buffer = buffer;
    }
    return result.buffer;
  }

  function download(result, label) {
    const blob = new Blob([H.encodeWav(result.channels, result.sampleRate)], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sped-' + slug(label) + '-' + Math.round(result.plan.targetBpm) + 'bpm.wav';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function onOutputEvent(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !state.output) {
      return;
    }
    const action = actionEl.dataset.action;
    if (action === 'play') {
      if (state.playing && state.playing.isOutput) {
        stopPlayback();
      } else {
        playBuffer(outputBuffer(state.output), 0, 0, state.loopPlayback);
      }
    } else if (action === 'loop-toggle') {
      state.loopPlayback = actionEl.checked;
      if (state.playing && state.playing.isOutput) {
        state.playing.source.loop = state.loopPlayback;
      }
    } else if (action === 'download') {
      download(state.output, state.output.label);
    } else if (action === 'save-recipe') {
      const project = state.output.savedProject;
      if (!project) { throw new Error('Render again before saving a portable recipe.'); }
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'sped-recipe-' + slug(state.output.label) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
  }

  async function onOutputChange(event) {
    if (event.target.dataset.action !== 'load-recipe' || !event.target.files[0]) {
      return;
    }
    const file = event.target.files[0];
    setBusy(true, 'Checking portable recipe…');
    if (file.size > 256 * 1024) {
      throw new Error('Recipe files must be smaller than 256 KB.');
    }
    const project = H.recipes.loadProject(JSON.parse(await file.text()), state.tracks);
    // Apply only after every reference and override has passed validation.
    state.tracks.forEach(function (t) {
      const saved = project.assignments.find(function (a) { return a.id === t.id; });
      t.role = saved ? saved.role : 'off';
      if (saved) {
        t.overrides = saved.overrides;
        t.rights = saved.rights;
      }
    });
    state.recipe = project.recipe;
    state.publication = project.publication;
    state.request = project.request;
    state.curated = null;
    markStale();
    renderSongs();
    renderRequest();
    renderTune();
    await renderRemix();
  }

  // ---------------------------------------------------------------- publishing notes

  function renderRightsSummary() {
    const summary = document.getElementById('rights-summary');
    if (!summary) {
      return;
    }
    const report = H.rights.review(activeTracks(), state.publication);
    summary.innerHTML = '<p>' + escapeHtml(report.guidance) + '</p>' +
      '<ul class="small">' + report.warnings.map(function (w) {
        return '<li>' + escapeHtml(w) + '</li>';
      }).join('') + '</ul><p class="muted small">' + escapeHtml(report.reminder) + '</p>';
  }

  function renderRights() {
    const card = document.getElementById('rights-card');
    if (!card) {
      return;
    }
    const options = function (entries, selected) {
      return Object.keys(entries).map(function (key) {
        return '<option value="' + key + '"' + (selected === key ? ' selected' : '') + '>' + escapeHtml(entries[key]) + '</option>';
      }).join('');
    };
    card.innerHTML = [
      '<h2>Real songs & publishing notes</h2>',
      '<p class="small">You can edit local song files here. Sped supplies no music license and does not verify permission. Editing capability and permission to publish are different questions; local-only use is not a blanket legal exception.</p>',
      '<p class="muted small">These notes cover the current active session sources, not necessarily an older rendered WAV. They are user declarations, never a “copyright-safe” badge.</p>',
      '<div class="row"><label>Destination <select data-publication="platform">' + options(H.rights.platforms, state.publication.platform) + '</select></label>',
      '<label><input type="checkbox" data-publication="commercial"' + (state.publication.commercial ? ' checked' : '') + '> Commercial / branded use</label></div>',
      activeTracks().map(function (t) {
        const d = H.rights.declaration(t.rights);
        return '<details class="rights-source" data-source="' + t.id + '"><summary>' + escapeHtml(t.name) + '</summary>' +
          '<label>Permission basis <select data-rights="basis">' + options(H.rights.bases, d.basis) + '</select></label>' +
          '<label>License link / reference <input type="text" maxlength="500" data-rights="reference" value="' + escapeHtml(d.reference) + '"></label>' +
          '<label>Required credit <input type="text" maxlength="500" data-rights="credit" value="' + escapeHtml(d.credit) + '"></label>' +
          '<label>Restrictions / territories / expiry <textarea maxlength="1000" data-rights="restrictions" rows="2">' + escapeHtml(d.restrictions) + '</textarea></label></details>';
      }).join(''),
      '<div id="rights-summary"></div>',
      '<div class="row"><button class="btn" data-rights-action="report">Download publishing notes</button>',
      '<button class="btn ghost" data-rights-action="session">Save current session recipe</button></div>',
      '<p class="muted small">JSON exports include source names and the notes you enter. Review before sharing. No audio or permissions are supplied with the notes.</p>',
      '<details><summary>Official platform guidance</summary><ul>' + H.rights.links.map(function (link) {
        return '<li><a href="' + link.url + '" target="_blank" rel="noopener noreferrer">' + link.label + '</a></li>';
      }).join('') + '</ul><p class="small">For cross-platform remixes, use your own cleared material or a license expressly allowing that output. For a platform-specific video, add music in the destination platform’s permitted library workflow instead of extracting it into Sped.</p></details>',
    ].join('');
    renderRightsSummary();
  }

  function onRightsInput(event) {
    if (event.target.dataset.publication) {
      const key = event.target.dataset.publication;
      state.publication[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      state.publication = H.rights.publication(state.publication);
    } else if (event.target.dataset.rights) {
      const row = event.target.closest('[data-source]');
      const track = state.tracks.find(function (t) { return t.id === row.dataset.source; });
      const d = H.rights.declaration(track.rights);
      d[event.target.dataset.rights] = event.target.value;
      track.rights = H.rights.declaration(d);
    } else {
      return;
    }
    renderRightsSummary();
  }

  function downloadJson(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function onRightsClick(event) {
    const button = event.target.closest('[data-rights-action]');
    if (!button) {
      return;
    }
    if (!activeTracks().length) {
      throw new Error('Add audio sources before saving session notes.');
    }
    if (button.dataset.rightsAction === 'report') {
      downloadJson(H.rights.review(activeTracks(), state.publication), 'sped-publishing-notes.json');
    } else {
      downloadJson(H.recipes.saveProject(state.tracks, state.recipe, state.request, state.publication), 'sped-current-session.json');
    }
  }

  // ---------------------------------------------------------------- variants

  async function makeVariants() {
    const tracks = activeTracks();
    if (!tracks.length) {
      setStatus('Upload a song first (or try the demo stand-ins).');
      return;
    }
    const ctxInfo = { trackCount: tracks.length };
    const requests = [
      ['Sped Up', 'sped up, higher pitch, crisp, 25 seconds'],
      ['Slowed + Reverb', 'slowed + reverb, dreamy, 30 seconds'],
      tracks.length > 1 ? ['Nostalgia Mashup', 'nostalgic mashup, sped up and high, 26 seconds'] : ['Bass Boosted 8D', 'bass boosted 8d, a bit faster, 25 seconds'],
    ];
    state.variants = [];
    state.cancelled = false;
    for (let i = 0; i < requests.length; i++) {
      if (state.cancelled) { break; }
      setBusy(true, 'Rendering variant ' + (i + 1) + '/3: ' + requests[i][0] + '…');
      const recipe = H.makeRecipe(H.parseRequest(requests[i][1], ctxInfo).patch);
      const result = await renderRemix(recipe);
      if (result) {
        result.label = requests[i][0];
        result.request = requests[i][1];
        result.savedProject = H.recipes.saveProject(state.tracks, result.plan.recipe, result.request, state.publication);
        state.variants.push(result);
      }
    }
    setBusy(false);
    state.variants.sort(function (a, b) {
      return b.score.score - a.score.score;
    });
    setStatus((state.cancelled ? 'Comparison cancelled. Completed edits only. First: ' : 'Edits sorted by checklist score, not predicted reach. First: ') + (state.variants[0] ? state.variants[0].label + ' (' + state.variants[0].score.score + ')' : '–') + '.');
    renderVariants();
  }

  function renderVariants() {
    const card = document.getElementById('variants-card');
    card.hidden = !state.variants.length;
    card.innerHTML = '<h2>Variants</h2><ol class="variants">' + state.variants.map(function (v, i) {
      return '<li data-index="' + i + '"><span class="v-score">' + v.score.score + '</span><div><strong>' + escapeHtml(v.label) + '</strong><span class="muted small">' +
        v.plan.targetBpm.toFixed(0) + ' BPM · ' + escapeHtml(v.plan.targetKey) + ' · ' + v.plan.durationSec.toFixed(1) + ' s</span></div>' +
        '<button class="icon-btn" data-variant="play" aria-label="Play ' + escapeHtml(v.label) + '">▶</button>' +
        '<button class="chip" data-variant="use">Use</button><button class="chip" data-variant="download">WAV</button></li>';
    }).join('') + '</ol>';
  }

  function onVariantsEvent(event) {
    const btn = event.target.closest('[data-variant]');
    if (!btn) {
      return;
    }
    const variant = state.variants[parseInt(btn.closest('li').dataset.index, 10)];
    if (btn.dataset.variant === 'play') {
      playBuffer(outputBuffer(variant), 0, 0, false);
    } else if (btn.dataset.variant === 'download') {
      download(variant, variant.label);
    } else if (btn.dataset.variant === 'use') {
      stopPlayback();
      state.stale = false;
      state.output = variant;
      state.recipe = H.makeRecipe(variant.plan.recipe);
      state.request = variant.request;
      state.curated = null;
      renderRequest();
      renderTune();
      renderOutput();
      renderArrangement();
    }
  }

  // ---------------------------------------------------------------- arrangement

  function renderArrangement() {
    const card = document.getElementById('arrange-card');
    const custom = state.recipe.segments && state.recipe.segments.length;
    const out = state.output;
    const options = function (selected) {
      const missing = state.tracks.some(function (t) { return t.id === selected && t.ready; }) ? '' : '<option value="" selected>Missing track — select replacement</option>';
      return missing + state.tracks.filter(function (t) {
        return t.ready;
      }).map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === selected ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>';
      }).join('');
    };
    let body;
    if (custom) {
      body = '<table class="arr"><thead><tr><th>#</th><th>Song</th><th>From</th><th>Start</th><th>Bars</th><th title="High-pass sweep in">Filter</th><th title="Noise riser before">Riser</th><th>dB</th><th></th></tr></thead><tbody>' +
        state.recipe.segments.map(function (s, i) {
          return '<tr data-index="' + i + '"><td>' + (i + 1) + '</td><td><select data-seg="track">' + options(s.track) + '</select></td>' +
            '<td><select data-seg="from"><option value="hook"' + (s.from !== 'time' ? ' selected' : '') + '>hook</option><option value="time"' + (s.from === 'time' ? ' selected' : '') + '>time</option></select></td>' +
            '<td>' + (s.from === 'time' ? '<input type="number" step="0.001" min="0" data-seg="startSec" value="' + (s.startSec || 0) + '">s' : '+<input type="number" step="1" min="0" data-seg="offsetBars" value="' + (s.offsetBars || 0) + '"> bars') + '</td>' +
            '<td><input type="number" min="1" max="32" step="1" data-seg="bars" value="' + s.bars + '"></td>' +
            '<td><input type="checkbox" data-seg="filterIn"' + (s.filterIn ? ' checked' : '') + '></td>' +
            '<td><input type="checkbox" data-seg="riserBefore"' + (s.riserBefore ? ' checked' : '') + '></td>' +
            '<td><input type="number" step="1" min="-12" max="6" data-seg="gainDb" value="' + (s.gainDb || 0) + '"></td>' +
            '<td><button class="icon-btn" data-seg-action="delete" aria-label="Delete segment">✕</button></td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="row"><button class="btn ghost" data-seg-action="add">+ Segment</button><button class="btn primary" data-action-arr="render" data-needs-idle>Render arrangement</button></div>';
    } else if (out) {
      body = '<p class="muted small">Auto arrangement (from your request). Click Edit to customise.</p><table class="arr"><thead><tr><th>#</th><th>Song</th><th>Source</th><th>Bars</th><th>Tempo</th><th>Pitch</th></tr></thead><tbody>' +
        out.plan.segments.map(function (s, i) {
          return '<tr><td>' + (i + 1) + '</td><td><i class="dot" style="background:' + trackColor(s.track) + '"></i>' + escapeHtml(s.name) + '</td><td>' + formatTime(s.sourceStartSec) + '</td><td>' + s.bars + '</td><td>×' + s.tempoRatio.toFixed(3) + '</td><td>' + (s.semitones > 0 ? '+' : '') + s.semitones + ' st</td></tr>';
        }).join('') + '</tbody></table><div class="row"><button class="btn ghost" data-seg-action="edit">Edit arrangement</button></div>';
    } else {
      body = '<p class="muted small">The bar-by-bar plan shows up after the first render.</p>';
    }
    card.innerHTML = '<h2>Arrangement</h2>' + body;
  }

  function onArrangeEvent(event) {
    const action = event.target.closest('[data-seg-action]');
    const renderBtn = event.target.closest('[data-action-arr]');
    if (renderBtn) {
      renderRemix();
      return;
    }
    if (!action) {
      return;
    }
    const kind = action.dataset.segAction;
    if (kind === 'edit' && state.output) {
      state.recipe.segments = state.output.plan.segments.map(function (s) {
        return { track: s.track, from: 'time', startSec: s.sourceStartSec, bars: s.bars, filterIn: s.filterIn, riserBefore: s.riserBefore, gainDb: s.gainDb };
      });
      state.recipe.mainId = state.output.plan.mainId;
    } else if (kind === 'add') {
      const main = activeTracks()[0];
      state.recipe.segments.push({ track: main ? main.id : '', from: 'hook', offsetBars: 0, bars: 4 });
    } else if (kind === 'delete') {
      state.recipe.segments.splice(parseInt(action.closest('tr').dataset.index, 10), 1);
      if (!state.recipe.segments.length) {
        state.recipe.segments = null;
      }
    }
    markStale();
    renderTune();
    renderArrangement();
  }

  function onArrangeChange(event) {
    const field = event.target.dataset.seg;
    const row = event.target.closest('tr');
    if (!field || !row) {
      return;
    }
    markStale();
    const seg = state.recipe.segments[parseInt(row.dataset.index, 10)];
    if (event.target.type === 'checkbox') {
      seg[field] = event.target.checked;
    } else if (field === 'track' || field === 'from') {
      seg[field] = event.target.value;
      renderArrangement();
    } else {
      seg[field] = parseFloat(event.target.value) || 0;
    }
  }

  // ---------------------------------------------------------------- wiring

  function markStale() {
    state.stale = !!state.output;
    state.variants = [];
    renderVariants();
    if (state.output) {
      renderOutput();
    }
  }

  function safe(action) {
    return Promise.resolve().then(action).catch(function (err) {
      setBusy(false);
      setStatus(err.message || String(err));
    });
  }

  function wire() {
    document.getElementById('cancel-task').addEventListener('click', function () {
      state.cancelled = true;
      engine.cancel();
      setStatus('Cancelling… loaded tracks will be kept.');
    });
    root.addEventListener('click', function (event) {
      if (state.busy) { return; }
      safe(function () {
        if (event.target.closest('#songs-card')) { return onSongsEvent(event); }
        if (event.target.closest('#request-card')) { return onRequestEvent(event); }
        if (event.target.closest('#tune-card')) { return onTuneClick(event); }
        if (event.target.closest('#output-card')) { return onOutputEvent(event); }
        if (event.target.closest('#variants-card')) { return onVariantsEvent(event); }
        if (event.target.closest('#arrange-card')) { return onArrangeEvent(event); }
        if (event.target.closest('#rights-card')) { return onRightsClick(event); }
      });
    });
    root.addEventListener('change', function (event) {
      if (state.busy) { return; }
      safe(function () {
        if (event.target.dataset.action === 'load-recipe') { return onOutputChange(event); }
        if (event.target.closest('#rights-card')) { return onRightsInput(event); }
        if (event.target.dataset.slot) { state.slotMapping[event.target.dataset.slot] = event.target.value; return; }
        if (event.target.closest('#songs-card')) { return onSongsChange(event); }
        if (event.target.closest('#tune-card')) { return onTuneInput(event); }
        if (event.target.closest('#arrange-card')) { return onArrangeChange(event); }
      });
    });
    root.addEventListener('input', function (event) {
      if (state.busy) { return; }
      if (event.target.closest('#tune-card') && event.target.type === 'range') { onTuneInput(event); }
      if (event.target.id === 'request') { state.request = event.target.value; }
      if (event.target.closest('#rights-card')) { safe(function () { return onRightsInput(event); }); }
    });
    root.addEventListener('keydown', function (event) {
      if (!state.busy && event.target.id === 'request' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.request = event.target.value;
        safe(remixFromRequest);
      }
    });
    ['dragenter', 'dragover', 'drop'].forEach(function (type) {
      root.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === 'drop' && !state.busy && event.target.closest('#dropzone')) {
          safe(function () { return addFiles(event.dataTransfer.files); });
        }
      });
    });
  }

  shell();
  wire();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      function offerUpdate() {
        if (!registration.waiting || !navigator.serviceWorker.controller || document.getElementById('app-update')) {
          return;
        }
        const button = document.createElement('button');
        button.id = 'app-update';
        button.className = 'btn';
        button.textContent = 'Update available — reload when ready';
        button.addEventListener('click', function () {
          if (state.busy) {
            setStatus('Finish or cancel the audio task before updating.');
            return;
          }
          if (confirm('Reload to update? Export your audio/recipe first; loaded tracks will be cleared.')) {
            navigator.serviceWorker.addEventListener('controllerchange', function () { location.reload(); }, { once: true });
            registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
          }
        });
        document.querySelector('.topbar').appendChild(button);
      }
      offerUpdate();
      registration.addEventListener('updatefound', function () {
        const installing = registration.installing;
        if (installing) {
          installing.addEventListener('statechange', offerUpdate);
        }
      });
    }).catch(function () {});
  }
  if (params.get('demo') === '1') {
    safe(addDemoTracks);
  }
  window.SpedApp = { state: state, engine: engine, applyCurated: applyCurated, renderRemix: renderRemix };
})();
