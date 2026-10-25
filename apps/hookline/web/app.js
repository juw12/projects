/* Hookline UI — uploads, request parsing, fine-tuning, rendering, scoring, export. */
(function () {
  'use strict';
  const H = window.Hookline;
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
    status: 'Drop songs to start — or try the demo stand-ins.',
    playing: null,
    loopPlayback: true,
  };
  let trackCounter = 0;
  let audioContext = null;

  // ---------------------------------------------------------------- engine client (worker with main-thread fallback)

  const engine = (function () {
    let worker = null;
    let local = null;
    let sequence = 0;
    const pending = {};
    function localSession() {
      if (!local) {
        local = H.createSession();
      }
      return local;
    }
    if (window.Worker && /^https?:$/.test(location.protocol)) {
      try {
        worker = new Worker('worker.js');
        worker.onmessage = function (event) {
          const message = event.data;
          const entry = pending[message.id];
          if (!entry) {
            return;
          }
          delete pending[message.id];
          if (message.ok) {
            entry.resolve(message.result);
          } else {
            entry.reject(new Error(message.error));
          }
        };
        worker.onerror = function (event) {
          console.warn('Hookline worker failed, using main thread', event.message);
          worker = null;
          Object.keys(pending).forEach(function (id) {
            pending[id].reject(new Error('worker-failed'));
            delete pending[id];
          });
        };
      } catch (err) {
        worker = null;
      }
    }
    function runLocal(cmd, payload) {
      const session = localSession();
      if (cmd === 'addTrack') {
        return session.addTrack(payload.id, payload.channels, payload.sampleRate, payload.name);
      }
      if (cmd === 'removeTrack') {
        return session.removeTrack(payload.id);
      }
      if (cmd === 'render') {
        return session.render(payload.settings, payload.recipe);
      }
      throw new Error('Unknown command ' + cmd);
    }
    return {
      mode: function () {
        return worker ? 'worker' : 'main thread';
      },
      call: function (cmd, payload, transfer) {
        if (!worker) {
          return new Promise(function (resolve, reject) {
            setTimeout(function () {
              try {
                resolve(runLocal(cmd, payload));
              } catch (err) {
                reject(err);
              }
            }, 30);
          });
        }
        const id = ++sequence;
        return new Promise(function (resolve, reject) {
          pending[id] = { resolve: resolve, reject: reject };
          worker.postMessage({ id: id, cmd: cmd, payload: payload }, transfer || []);
        });
      },
      // Re-run a command on the main thread (used when the worker dies mid-session).
      local: function (cmd, payload) {
        return runLocal(cmd, payload);
      },
    };
  })();

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
      '  </span><div><h1>Hookline</h1><p class="tagline">Turn songs into viral short-form sounds</p></div></div>',
      '  <span class="pill" title="Decoding, analysis and rendering run in your browser">🔒 Songs never leave your device</span>',
      '</header>',
      '<p id="status" class="status" role="status" aria-live="polite"></p>',
      '<main class="layout">',
      '  <div class="col col-left">',
      '    <section class="card" id="songs-card"></section>',
      '    <section class="card" id="request-card"></section>',
      '    <section class="card" id="tune-card"></section>',
      '  </div>',
      '  <div class="col col-right">',
      '    <section class="card output-card" id="output-card"></section>',
      '    <section class="card" id="variants-card" hidden></section>',
      '    <section class="card" id="arrange-card"></section>',
      '  </div>',
      '</main>',
      '<footer class="footer">',
      '  <p>Use songs you have the rights to remix. Posting remixes of commercial music may need the platform\'s licensed library or the rights holder\'s permission. The viral score is a heuristic built from common short-form patterns — not a prediction.</p>',
      '  <p>Hookline v' + H.VERSION + ' · engine: <span id="engine-mode"></span> · <a href="index.html">App</a> · <a href="web.html">Web</a> · <a href="mobile.html">Mobile</a></p>',
      '</footer>',
    ].join('\n');
    document.getElementById('engine-mode').textContent = engine.mode();
    renderSongs();
    renderRequest();
    renderTune();
    renderOutput();
    renderArrangement();
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
        '  <canvas class="mini-wave" width="600" height="56" aria-hidden="true"></canvas>',
        '  <div class="track-fields">',
        '    <label>BPM <input type="number" step="0.1" min="40" max="240" data-field="bpm" value="' + bpm.toFixed(1) + '"></label>',
        '    <button class="chip" data-action="double" title="Detected half-time? Double it">×2</button>',
        '    <button class="chip" data-action="half" title="Detected double-time? Halve it">÷2</button>',
        '    <label>Key <select data-field="key">' + keyOptions + '</select></label>',
        '    <label>Hook <select data-field="hook">' + hookOptions + '<option value="custom"' + (a.hooks.some(function (h) {
          return Math.abs(h.start - hook) < 0.01;
        }) ? '' : ' selected') + '>custom…</option></select></label>',
        '    <label class="narrow">at <input type="number" step="0.1" min="0" data-field="hookSec" value="' + hook.toFixed(1) + '">s</label>',
        t.role === 'layer' ? '    <label class="narrow">nudge <input type="number" step="1" min="-6" max="6" data-field="semitones" value="' + (t.overrides.semitones || 0) + '">st</label>' : '',
        '  </div>',
        t.warning ? '  <p class="warn">' + escapeHtml(t.warning) + '</p>' : '',
        '</div>',
      ].join('\n');
    }).join('\n');
    card.innerHTML = [
      '<h2><span class="step">1</span> Songs</h2>',
      '<label class="dropzone" id="dropzone">',
      '  <input type="file" id="file-input" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" multiple>',
      '  <strong>Drop songs here</strong> or click to upload',
      '  <span class="muted">MP3, M4A, WAV, OGG, FLAC · first song = main, the rest mash in</span>',
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

  async function addFiles(files) {
    const list = Array.prototype.slice.call(files).filter(function (f) {
      return /^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|flac|aac|opus|webm)$/i.test(f.name);
    });
    if (!list.length) {
      setStatus('Those files do not look like audio.');
      return;
    }
    for (const file of list) {
      const id = 't' + (++trackCounter);
      const track = { id: id, name: file.name.replace(/\.[^.]+$/, ''), role: state.tracks.some(function (t) {
        return t.role === 'main';
      }) ? 'layer' : 'main', overrides: {}, ready: false };
      state.tracks.push(track);
      renderSongs();
      try {
        setBusy(true, 'Decoding ' + file.name + '…');
        const data = await file.arrayBuffer();
        const buffer = await ctx().decodeAudioData(data);
        await registerTrack(track, buffer);
      } catch (err) {
        console.error(err);
        state.tracks = state.tracks.filter(function (t) {
          return t.id !== id;
        });
        setStatus('Could not decode ' + file.name + ' (' + err.message + ').');
      }
    }
    setBusy(false);
    renderSongs();
    renderArrangement();
  }

  async function registerTrack(track, buffer) {
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
      channels.push(new Float32Array(buffer.getChannelData(c)));
    }
    track.buffer = buffer;
    track.channels = channels.length === 1 ? [channels[0], channels[0]] : channels;
    track.sampleRate = buffer.sampleRate;
    setBusy(true, 'Analysing ' + track.name + ' (tempo, key, hook)…');
    const copies = track.channels.map(function (c) {
      return new Float32Array(c);
    });
    let analysis;
    try {
      analysis = await engine.call('addTrack', { id: track.id, channels: copies, sampleRate: track.sampleRate, name: track.name }, copies.map(function (c) {
        return c.buffer;
      }));
    } catch (err) {
      if (err.message !== 'worker-failed') {
        throw err;
      }
      analysis = engine.local('addTrack', { id: track.id, channels: track.channels, sampleRate: track.sampleRate, name: track.name });
    }
    track.analysis = analysis;
    track.ready = true;
    setStatus(track.name + ': ' + analysis.bpm.toFixed(1) + ' BPM, ' + analysis.key.name + ', hook at ' + formatTime(analysis.hooks[0].start) + '.');
  }

  async function addDemoTracks() {
    const specs = [
      { name: "Synth stand-in (That's What You Get tempo/key)", bpm: 131, key: 'Ab major', seed: 11 },
      { name: 'Synth stand-in (Misery Business tempo/key)', bpm: 173, key: 'Db major', seed: 12 },
      { name: "Synth stand-in (Sugar, We're Goin Down tempo/key)", bpm: 162, key: 'D major', seed: 13 },
    ];
    setBusy(true, 'Synthesising demo stand-ins…');
    for (const spec of specs) {
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
      await registerTrack(track, buffer);
      renderSongs();
    }
    setBusy(false);
    await applyCurated('paramore');
  }

  function onSongsEvent(event) {
    const trackEl = event.target.closest('.track');
    const actionEl = event.target.closest('[data-action]');
    const action = actionEl && actionEl.dataset.action;
    if (action === 'demo') {
      addDemoTracks();
      return;
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
      engine.call('removeTrack', { id: track.id }).catch(function () {});
      state.tracks = state.tracks.filter(function (t) {
        return t.id !== track.id;
      });
      if (track.role === 'main' && state.tracks.length) {
        state.tracks[0].role = 'main';
      }
      renderSongs();
      renderArrangement();
    } else if (action === 'double') {
      track.overrides.bpm = Math.round(bpm * 2 * 10) / 10;
      renderSongs();
    } else if (action === 'half') {
      track.overrides.bpm = Math.round(bpm / 2 * 10) / 10;
      renderSongs();
    } else if (action === 'preview') {
      const hook = typeof track.overrides.hookSec === 'number' ? track.overrides.hookSec : track.analysis.hooks[0].start;
      playBuffer(track.buffer, hook, 8, false);
    }
  }

  function onSongsChange(event) {
    const field = event.target.dataset.field;
    if (event.target.id === 'file-input') {
      addFiles(event.target.files);
      event.target.value = '';
      return;
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
    } else if (field === 'bpm') {
      const v = parseFloat(value);
      track.overrides.bpm = isFinite(v) && v > 30 ? v : undefined;
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
      track.overrides.semitones = parseFloat(value) || 0;
    }
    renderSongs();
  }

  // ---------------------------------------------------------------- request

  function renderRequest() {
    const card = document.getElementById('request-card');
    const curated = H.recipes.curated.paramore;
    card.innerHTML = [
      '<h2><span class="step">2</span> Your request</h2>',
      '<textarea id="request" rows="3" placeholder="e.g. make it higher and faster, add a nostalgic 2000s mashup, 25 seconds">' + escapeHtml(state.request || '') + '</textarea>',
      '<div class="chips" role="list">',
      H.recipes.presets.map(function (p) {
        return '<button class="chip" role="listitem" data-preset="' + p.id + '" title="' + escapeHtml(p.request) + '">' + escapeHtml(p.name) + '</button>';
      }).join(''),
      '</div>',
      '<div class="row">',
      '  <button class="btn primary" data-action="remix" data-needs-idle>Remix it</button>',
      '  <button class="btn" data-action="variants" data-needs-idle>3 viral variants</button>',
      '</div>',
      '<div class="curated">',
      '  <div><span class="badge">Test recipe</span> <strong>' + escapeHtml(curated.name) + '</strong></div>',
      '  <p class="muted small">Paramore at 164 BPM, +4 st into C major, with Misery Business and Sugar, We\'re Goin Down mashed in. Upload those three songs (any order) or use the demo stand-ins.</p>',
      '  <button class="btn ghost" data-action="curated" data-needs-idle>Apply test recipe</button>',
      '</div>',
      state.notes.length ? '<ul class="notes">' + state.notes.map(function (n) {
        return '<li>' + escapeHtml(n) + '</li>';
      }).join('') + '</ul>' : '',
    ].join('\n');
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
    const mapping = H.recipes.assignSlots(def, ready);
    const used = {};
    def.slots.forEach(function (slot) {
      const id = mapping[slot.id];
      if (!id) {
        return;
      }
      used[id] = true;
      const track = ready.find(function (t) {
        return t.id === id;
      });
      track.role = slot.role;
      const override = H.recipes.tempoOverride(track.overrides.bpm || track.analysis.bpm, slot.refBpm);
      track.warning = '';
      if (override) {
        track.overrides.bpm = override;
        track.warning = 'Detected ' + track.analysis.bpm.toFixed(1) + ' BPM; using the reference ' + override + ' BPM for “' + slot.label + '”. Fix it above if needed.';
      }
    });
    ready.forEach(function (t) {
      if (!used[t.id]) {
        t.role = 'off';
      }
    });
    state.recipe = H.makeRecipe(H.recipes.bindRecipe(def, mapping));
    state.request = def.request;
    const missing = def.slots.filter(function (s) {
      return !mapping[s.id];
    }).map(function (s) {
      return s.label;
    });
    state.notes = def.why.concat(missing.length ? ['Missing: ' + missing.join(', ') + ' — upload for the full mashup.'] : []);
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
      slider('tempo', r.targetBpm ? 'Tempo (overridden by target BPM)' : 'Tempo', 0.6, 1.6, 0.01, r.tempo, function (v) {
        return '×' + Number(v).toFixed(2);
      }),
      '<label class="field">Target BPM <input type="number" id="targetBpm" data-tune="targetBpm" min="50" max="220" step="0.5" placeholder="auto" value="' + (r.targetBpm || '') + '"></label>',
      slider('semitones', r.mode === 'coupled' ? 'Pitch (follows tempo)' : 'Pitch', -12, 12, 0.5, r.semitones, function (v) {
        return (v > 0 ? '+' : '') + v + ' st';
      }),
      slider('lengthSec', 'Length', 8, 60, 1, r.lengthSec, function (v) {
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
      '  <label><input type="checkbox" data-tune="loop"' + (r.loop ? ' checked' : '') + '> Seamless loop</label>',
      '  <label>Style <select data-tune="style">' + ['sped', 'slowed', 'remix'].map(function (s) {
        return '<option' + (r.style === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') + '</select></label>',
      '</div>',
      '<div class="row"><button class="btn primary" data-action="render" data-needs-idle>Render</button>',
      '<button class="btn ghost" data-action="auto-arrange" data-needs-idle title="Discard the custom arrangement">Auto-arrange</button></div>',
    ].join('\n');
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
      r.targetBpm = isFinite(num) && num > 0 ? num : null;
    } else if (key === 'mashup' || key === 'keyMatch' || key === 'loop') {
      r[key] = el.checked;
      if (key === 'mashup') {
        r.segments = null;
      }
    } else if (key === 'style') {
      r.style = el.value;
    } else {
      r[key] = num;
      if (key === 'lengthSec' && !state.curated) {
        r.segments = null;
      }
    }
    const out = document.getElementById(key + '-out');
    if (out && el.type === 'range') {
      const v = num;
      out.textContent = { tempo: '×' + v.toFixed(2), semitones: (v > 0 ? '+' : '') + v + ' st', lengthSec: v + ' s', bass: '+' + v + ' dB', air: '+' + v + ' dB' }[key] || Math.round(v * 100) + '%';
    }
  }

  function onTuneClick(event) {
    const modeBtn = event.target.closest('[data-mode]');
    if (modeBtn) {
      state.recipe.mode = modeBtn.dataset.mode;
      renderTune();
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }
    if (actionEl.dataset.action === 'render') {
      renderRemix();
    } else if (actionEl.dataset.action === 'auto-arrange') {
      state.recipe.segments = null;
      state.curated = null;
      renderRemix();
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
    stopPlayback();
    setBusy(true, 'Rendering: time-stretch, pitch, mashup, FX, loudness…');
    const started = performance.now();
    try {
      let result;
      try {
        result = await engine.call('render', { settings: trackSettings(), recipe: recipe });
      } catch (err) {
        if (err.message !== 'worker-failed') {
          throw err;
        }
        result = engine.local('render', { settings: trackSettings(), recipe: recipe });
      }
      if (recipeOverride) {
        return result;
      }
      state.output = result;
      state.output.label = state.curated ? H.recipes.curated[state.curated].name : (state.request || 'remix');
      setStatus('Rendered ' + result.plan.durationSec.toFixed(1) + ' s at ' + result.plan.targetBpm.toFixed(1) + ' BPM in ' + ((performance.now() - started) / 1000).toFixed(1) + ' s · viral score ' + result.score.score + ' of 100.');
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
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- output

  function renderOutput() {
    const card = document.getElementById('output-card');
    const out = state.output;
    if (!out) {
      card.innerHTML = '<h2><span class="step">4</span> Your sound</h2><div class="empty"><p>Your remix appears here with a waveform, a viral-potential score and a WAV download.</p></div>';
      return;
    }
    const s = out.score;
    const ring = Math.round(s.score * 3.6);
    card.innerHTML = [
      '<h2><span class="step">4</span> Your sound</h2>',
      '<canvas id="out-wave" class="out-wave" width="1200" height="180" aria-label="Waveform of the remix"></canvas>',
      '<div class="legend">' + Object.keys(out.plan.tracks).map(function (id) {
        return '<span><i style="background:' + trackColor(id) + '"></i>' + escapeHtml(out.plan.tracks[id].name) + '</span>';
      }).join('') + '</div>',
      '<div class="transport">',
      '  <button class="btn primary" data-action="play">▶ Play</button>',
      '  <label><input type="checkbox" data-action="loop-toggle"' + (state.loopPlayback ? ' checked' : '') + '> Loop</label>',
      '  <button class="btn" data-action="download">⬇ WAV</button>',
      '  <button class="btn ghost" data-action="save-recipe">Save recipe</button>',
      '  <label class="btn ghost file-btn">Load recipe<input type="file" accept="application/json,.json" data-action="load-recipe"></label>',
      '</div>',
      '<div class="score">',
      '  <div class="ring" style="--deg:' + ring + 'deg"><span>' + s.score + '</span></div>',
      '  <div><strong>' + escapeHtml(s.grade) + '</strong><p class="muted small">Heuristic viral-potential score (not a prediction).</p></div>',
      '</div>',
      '<ul class="factors">' + s.factors.map(function (f) {
        return '<li><span class="f-label">' + escapeHtml(f.label) + '</span><span class="bar"><i style="width:' + Math.round(f.score * 100) + '%"></i></span><span class="f-value">' + escapeHtml(f.value) + '</span></li>';
      }).join('') + '</ul>',
      s.tips.length ? '<ul class="tips">' + s.tips.map(function (t) {
        return '<li>' + escapeHtml(t) + '</li>';
      }).join('') + '</ul>' : '',
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
    a.download = 'hookline-' + slug(label) + '-' + Math.round(result.plan.targetBpm) + 'bpm.wav';
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
      const blob = new Blob([JSON.stringify({ hookline: H.VERSION, request: state.request || '', recipe: state.output.plan.recipe }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hookline-recipe-' + slug(state.output.label) + '.json';
      a.click();
    }
  }

  function onOutputChange(event) {
    if (event.target.dataset.action !== 'load-recipe' || !event.target.files[0]) {
      return;
    }
    event.target.files[0].text().then(function (text) {
      const data = JSON.parse(text);
      state.recipe = H.makeRecipe(data.recipe || data);
      if (state.recipe.segments) {
        const ids = state.tracks.map(function (t) {
          return t.id;
        });
        state.recipe.segments = state.recipe.segments.filter(function (s) {
          return ids.indexOf(s.track) >= 0;
        });
        if (!state.recipe.segments.length) {
          state.recipe.segments = null;
        }
      }
      state.request = data.request || '';
      renderRequest();
      renderTune();
      renderRemix();
    }).catch(function (err) {
      setStatus('Could not load recipe: ' + err.message);
    });
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
    for (let i = 0; i < requests.length; i++) {
      setBusy(true, 'Rendering variant ' + (i + 1) + '/3: ' + requests[i][0] + '…');
      const recipe = H.makeRecipe(H.parseRequest(requests[i][1], ctxInfo).patch);
      const result = await renderRemix(recipe);
      if (result) {
        result.label = requests[i][0];
        result.request = requests[i][1];
        state.variants.push(result);
      }
    }
    setBusy(false);
    state.variants.sort(function (a, b) {
      return b.score.score - a.score.score;
    });
    setStatus('Variants ranked by viral score. Best: ' + (state.variants[0] ? state.variants[0].label + ' (' + state.variants[0].score.score + ')' : '–') + '.');
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
      return state.tracks.filter(function (t) {
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
            '<td>' + (s.from === 'time' ? '<input type="number" step="0.1" min="0" data-seg="startSec" value="' + (s.startSec || 0) + '">s' : '+<input type="number" step="1" min="0" data-seg="offsetBars" value="' + (s.offsetBars || 0) + '"> bars') + '</td>' +
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
    renderArrangement();
  }

  function onArrangeChange(event) {
    const field = event.target.dataset.seg;
    const row = event.target.closest('tr');
    if (!field || !row) {
      return;
    }
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

  function wire() {
    root.addEventListener('click', function (event) {
      if (event.target.closest('#songs-card')) {
        onSongsEvent(event);
      } else if (event.target.closest('#request-card')) {
        onRequestEvent(event);
      } else if (event.target.closest('#tune-card')) {
        onTuneClick(event);
      } else if (event.target.closest('#output-card')) {
        onOutputEvent(event);
      } else if (event.target.closest('#variants-card')) {
        onVariantsEvent(event);
      } else if (event.target.closest('#arrange-card')) {
        onArrangeEvent(event);
      }
    });
    root.addEventListener('change', function (event) {
      if (event.target.closest('#songs-card')) {
        onSongsChange(event);
      } else if (event.target.closest('#tune-card')) {
        onTuneInput(event);
      } else if (event.target.closest('#output-card')) {
        onOutputChange(event);
      } else if (event.target.closest('#arrange-card')) {
        onArrangeChange(event);
      }
    });
    root.addEventListener('input', function (event) {
      if (event.target.closest('#tune-card') && event.target.type === 'range') {
        onTuneInput(event);
      }
      if (event.target.id === 'request') {
        state.request = event.target.value;
      }
    });
    root.addEventListener('keydown', function (event) {
      if (event.target.id === 'request' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        state.request = event.target.value;
        remixFromRequest();
      }
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      root.addEventListener(type, function (event) {
        if (event.target.closest('#dropzone')) {
          event.preventDefault();
          event.target.closest('#dropzone').classList.add('over');
        }
      });
    });
    root.addEventListener('dragleave', function (event) {
      const zone = event.target.closest('#dropzone');
      if (zone) {
        zone.classList.remove('over');
      }
    });
    root.addEventListener('drop', function (event) {
      const zone = event.target.closest('#dropzone');
      if (zone) {
        event.preventDefault();
        zone.classList.remove('over');
        addFiles(event.dataTransfer.files);
      }
    });
  }

  shell();
  wire();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  if (params.get('demo') === '1') {
    addDemoTracks();
  }
  window.HooklineApp = { state: state, applyCurated: applyCurated, renderRemix: renderRemix };
})();
