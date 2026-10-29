/* Sped UI — uploads, request parsing, fine-tuning, rendering, scoring, export. */
(function () {
  'use strict';
  const H = window.Sped;
  const S = H.shorts;
  const V = H.video;
  const root = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const TABS = [
    { id: 'media', label: 'Media', icon: '♪' },
    { id: 'templates', label: 'Styles', icon: '✦' },
    { id: 'edit', label: 'Edit', icon: '⏱' },
    { id: 'mix', label: 'Mix', icon: '≋' },
    { id: 'look', label: 'Text', icon: 'T' },
    { id: 'post', label: 'Post', icon: '⇪' },
  ];
  const INSPECTOR = ['edit', 'mix', 'look', 'post'];
  const LOOK_KEY = 'sped-look';

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
    tab: 'media',
    inspector: 'edit',
    look: loadLook(),
    image: null,
    imageUrl: null,
    imageName: '',
    showSafe: true,
    previewTime: 0,
    includeAudio: true,
    quality: 'high',
    caption: { text: '', edited: false, tags: null },
    exporting: null,
    exportResult: null,
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
      cancel.textContent = state.exporting ? 'Cancel export' : 'Cancel audio task';
    }
    root.querySelectorAll('[data-needs-idle]').forEach(function (el) {
      el.disabled = busy;
    });
  }

  // ---------------------------------------------------------------- layout

  function loadLook() {
    try {
      return V.normaliseLook(JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'));
    } catch (err) {
      return V.normaliseLook({});
    }
  }

  function saveLook() {
    const look = state.look;
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify({
        theme: look.theme, visualizer: look.visualizer, position: look.position, badge: look.badge, progress: look.progress,
      }));
    } catch (err) {
      /* private mode: keep the look for this session only */
    }
  }

  function platformPills() {
    return Object.keys(S.platforms).map(function (id) {
      const on = state.publication.platform === id;
      return '<button type="button" class="pill-btn' + (on ? ' on' : '') + '" data-platform="' + id + '" aria-pressed="' + on + '" title="' +
        escapeHtml(S.platforms[id].name) + '">' + escapeHtml(S.platforms[id].short) + '</button>';
    }).join('');
  }

  function shell() {
    root.innerHTML = [
      '<header class="topbar">',
      '  <div class="brand"><span class="logo" aria-hidden="true">',
      '    <svg viewBox="0 0 32 32" width="30" height="30"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#ff3d7f"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M7 19c3 0 3-7 6-7s3 10 6 10 3-12 6-12" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>',
      '  </span><div><h1>Sped</h1><p class="tagline">Sped-up, slowed & mashup shorts from your songs</p></div></div>',
      '  <div class="platform-switch" role="group" aria-label="Posting to"><span class="muted small">Posting to</span><span class="pills" id="top-platforms">' + platformPills() + '</span></div>',
      '  <div class="top-actions"><span class="pill" title="Decoding, analysis, rendering and video export run in your browser">🔒 On-device</span>',
      '  <button class="btn primary" data-action="export-open">Export ⇪</button></div>',
      '</header>',
      '<p id="status" class="status" role="status" aria-live="polite"></p>',
      '<button id="cancel-task" class="btn" hidden>Cancel</button>',
      '<main><fieldset id="workspace" class="editor">',
      '  <aside class="pane pane-left">',
      '    <section class="card panel" data-panel="media" id="songs-card"></section>',
      '    <section class="card panel" data-panel="templates" id="request-card"></section>',
      '  </aside>',
      '  <section class="stage" id="output-card" aria-label="Preview"></section>',
      '  <aside class="pane pane-right">',
      '    <div class="inspector-tabs" role="tablist" aria-label="Editor panels">' + INSPECTOR.map(function (id) {
        const tab = TABS.find(function (t) { return t.id === id; });
        return '<div role="tab" tabindex="0" data-tab="' + id + '">' + escapeHtml(tab.label === 'Text' ? 'Text & look' : tab.label) + '</div>';
      }).join('') + '</div>',
      '    <section class="card panel" data-panel="edit" id="tune-card"></section>',
      '    <div class="panel" data-panel="mix"><section class="card" id="arrange-card"></section><section class="card" id="variants-card" hidden></section></div>',
      '    <section class="card panel" data-panel="look" id="look-card"></section>',
      '    <div class="panel" data-panel="post"><section class="card" id="post-card"></section><section class="card" id="rights-card"></section></div>',
      '  </aside>',
      '</fieldset></main>',
      '<nav class="toolbar" aria-label="Editor tools">' + TABS.map(function (tab) {
        return '<button type="button" data-tab="' + tab.id + '"><span class="ico" aria-hidden="true">' + tab.icon + '</span>' + escapeHtml(tab.label) + '</button>';
      }).join('') + '</nav>',
      '<footer class="footer">',
      '  <p>Use songs you have the rights to post. Sped supplies no music license; commercial songs are usually safest added from each platform’s own sound library. Checklists are editing heuristics, not reach predictions.</p>',
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
    renderLook();
    renderPost();
    setTab(state.tab);
    setStatus(state.status);
  }

  function setTab(tab) {
    if (!TABS.some(function (t) { return t.id === tab; })) {
      return;
    }
    state.tab = tab;
    if (INSPECTOR.indexOf(tab) >= 0) {
      state.inspector = tab;
    }
    document.body.dataset.activeTab = tab;
    document.body.dataset.activeInspector = state.inspector;
    root.querySelectorAll('.panel[data-panel]').forEach(function (panel) {
      panel.classList.toggle('is-tab', panel.dataset.panel === tab);
      panel.classList.toggle('is-inspector', panel.dataset.panel === state.inspector);
    });
    root.querySelectorAll('[data-tab]').forEach(function (el) {
      const inInspector = !!el.closest('.inspector-tabs');
      const on = inInspector ? el.dataset.tab === state.inspector : el.dataset.tab === tab;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function setPlatform(id) {
    if (!S.platforms[id]) {
      return;
    }
    state.publication = H.rights.publication(Object.assign({}, state.publication, { platform: id }));
    state.caption.tags = null;
    state.caption.edited = false;
    root.querySelectorAll('[data-platform]').forEach(function (el) {
      const on = el.dataset.platform === id;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const select = root.querySelector('[data-publication=platform]');
    if (select) {
      select.value = id;
    }
    renderRightsSummary();
    renderOutputHead();
    renderLook();
    renderPost();
    refreshVisuals();
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
      '<h2>Media <span class="muted small">songs you’re allowed to use</span></h2>',
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
    renderPost();
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

  const TILE_COLORS = [
    ['#ff3d7f', '#ff9f43'], ['#7c3aed', '#22d3ee'], ['#0ea5e9', '#1e1b4b'], ['#f43f5e', '#111827'],
    ['#10b981', '#312e81'], ['#a16207', '#3f3f46'], ['#ec4899', '#6366f1'],
  ];

  function presetMeta(preset) {
    const patch = H.parseRequest(preset.request, { trackCount: Math.max(1, activeTracks().length) }).patch;
    const parts = [];
    const tempo = typeof patch.tempo === 'number' ? patch.tempo : 1;
    parts.push('×' + tempo.toFixed(2).replace(/0$/, ''));
    if (patch.mode === 'coupled') {
      parts.push('pitch follows');
    } else if (patch.semitones) {
      parts.push((patch.semitones > 0 ? '+' : '') + patch.semitones + ' st');
    }
    if (patch.lengthSec) {
      parts.push(patch.lengthSec + ' s');
    }
    return parts.join(' · ');
  }

  function renderRequest() {
    const card = document.getElementById('request-card');
    const curated = H.recipes.curated.paramore;
    card.innerHTML = [
      '<h2>Styles <span class="muted small">one tap renders it</span></h2>',
      '<div class="templates" role="list">',
      H.recipes.presets.map(function (p, i) {
        const colors = TILE_COLORS[i % TILE_COLORS.length];
        return '<button class="tile" role="listitem" data-preset="' + p.id + '" title="' + escapeHtml(p.request) + '" style="--a:' + colors[0] + ';--b:' + colors[1] + '">' +
          '<span class="tile-name">' + escapeHtml(p.name) + '</span><span class="tile-meta">' + escapeHtml(presetMeta(p)) + '</span></button>';
      }).join(''),
      '</div>',
      '<h3>Describe your edit</h3>',
      '<textarea id="request" aria-label="Remix request" maxlength="2000" rows="3" placeholder="e.g. make it higher and faster, add a nostalgic 2000s mashup, 25 seconds">' + escapeHtml(state.request || '') + '</textarea>',
      '<p class="small muted">Rule-based parser, not an AI music model. Layering uses crossfades, not separated vocals/instruments.</p>',
      '<div class="row">',
      '  <button class="btn primary" data-action="remix" data-needs-idle>Remix it</button>',
      '  <button class="btn" data-action="variants" data-needs-idle>Compare 3 edits</button>',
      '  <label class="btn ghost file-btn">Load recipe<input type="file" accept="application/json,.json" data-action="load-recipe" aria-label="Load portable recipe"></label>',
      '</div>',
      '<div class="curated">',
      '  <div><span class="badge">Test recipe</span> <strong>' + escapeHtml(curated.name) + '</strong></div>',
      '  <p class="muted small">Paramore at 164 BPM, +4 st into C major, with Misery Business and Sugar, We\'re Goin Down mashed in. Select each recording, verify its metadata, or try the synthetic demo.</p>',
      renderSlots(curated),
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
      '<h2>Edit <span class="muted small">speed, pitch, length, FX</span></h2>',
      '<div class="quick" role="group" aria-label="Quick speed"><span class="muted small">Speed</span>' + [0.8, 0.9, 1.1, 1.2, 1.25, 1.35, 1.5].map(function (v) {
        const on = !r.targetBpm && Math.abs(r.tempo - v) < 0.001;
        return '<button class="chip' + (on ? ' on' : '') + '" data-speed="' + v + '">' + v + '×</button>';
      }).join('') + '</div>',
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
    const speedBtn = event.target.closest('[data-speed]');
    if (speedBtn) {
      state.recipe.tempo = parseFloat(speedBtn.dataset.speed);
      state.recipe.targetBpm = null;
      markStale();
      renderTune();
      return;
    }
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
      state.previewTime = 0;
      state.caption.tags = null;
      renderOutput();
      renderArrangement();
      renderLook();
      renderPost();
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

  // ---------------------------------------------------------------- stage: preview, transport, timeline

  function cleanTitle(name) {
    const match = /^Synth stand-in \((.+?) tempo\/key\)$/.exec(name || '');
    return match ? match[1] : String(name || '');
  }

  function displayTitle() {
    if (state.look.title) {
      return state.look.title;
    }
    const out = state.output;
    const main = out ? out.plan.tracks[out.plan.mainId] : state.tracks.find(function (t) { return t.ready && t.role === 'main'; });
    return main ? cleanTitle(main.name) : '';
  }

  function visualAnalysis(out) {
    if (!out.visual) {
      out.visual = S.frameBands(out.channels, out.sampleRate, S.CANVAS.fps, 32);
    }
    return out.visual;
  }

  function previewScene(forExport) {
    const out = state.output;
    return {
      look: Object.assign({}, state.look, { title: displayTitle() }),
      platformId: state.publication.platform,
      plan: out ? out.plan : null,
      analysis: out ? visualAnalysis(out) : null,
      image: state.image,
      duration: out ? out.plan.durationSec : 0,
      segments: out ? out.plan.segments.map(function (seg) {
        return { start: seg.outStartSec, length: seg.outLengthSec, color: trackColor(seg.track) };
      }) : [],
      showSafe: !forExport && state.showSafe,
      placeholder: !out,
    };
  }

  function drawPreview(timeSec) {
    const canvas = document.getElementById('preview');
    if (!canvas) {
      return;
    }
    const g = canvas.getContext('2d');
    g.setTransform(canvas.width / S.CANVAS.width, 0, 0, canvas.height / S.CANVAS.height, 0, 0);
    V.drawFrame(g, previewScene(false), timeSec || 0);
  }

  function refreshVisuals() {
    drawPreview(state.previewTime);
    drawOutputWave(state.previewTime);
    updateTimeReadout(state.previewTime);
  }

  function updateTimeReadout(timeSec) {
    const el = document.getElementById('time-readout');
    if (el && state.output) {
      el.textContent = formatTime(timeSec || 0) + ' / ' + formatTime(state.output.plan.durationSec);
    }
  }

  function renderOutputHead() {
    const head = document.getElementById('stage-head');
    if (!head) {
      return;
    }
    const p = S.platform(state.publication.platform);
    head.innerHTML = '<span class="stage-title">' + escapeHtml(state.output ? displayTitle() || 'Untitled edit' : 'New short') + '</span>' +
      '<span class="muted small">' + escapeHtml(p.name) + ' · 9:16 · 1080×1920</span>' +
      '<label class="switch small"><input type="checkbox" data-action="safe-toggle"' + (state.showSafe ? ' checked' : '') + '> Safe zone</label>';
  }

  function renderOutput() {
    const card = document.getElementById('output-card');
    const out = state.output;
    card.innerHTML = [
      '<div class="stage-head" id="stage-head"></div>',
      '<div class="phone">',
      '  <canvas id="preview" width="540" height="960" aria-label="9:16 video preview"></canvas>',
      out ? '' : '  <div class="phone-empty"><p><strong>Start with a song</strong><span class="muted small">Upload audio you’re allowed to use, then tap a style.</span></p>' +
        '<button class="btn primary" data-action="upload-open">Upload songs</button><button class="btn ghost" data-action="demo" data-needs-idle>Try demo audio</button></div>',
      '</div>',
      state.stale ? '<p class="warn stale">Settings changed. This playback/download is the PREVIOUS render; render again to apply edits. <button class="chip" data-action="render-now" data-needs-idle>Apply changes</button></p>' : '',
      out ? [
        '<div class="transport">',
        '  <button class="btn primary play-btn" data-action="play">▶ Play</button>',
        '  <span id="time-readout" class="time">0:00.0 / ' + formatTime(out.plan.durationSec) + '</span>',
        '  <label class="small"><input type="checkbox" data-action="loop-toggle"' + (state.loopPlayback ? ' checked' : '') + '> Loop</label>',
        '  <span class="spacer"></span>',
        '  <span class="muted small">' + out.plan.targetBpm.toFixed(0) + ' BPM · ' + escapeHtml(out.plan.targetKey) + '</span>',
        '</div>',
        '<canvas id="out-wave" class="timeline" width="1200" height="172" aria-label="Timeline. Click to jump to a moment."></canvas>',
        '<div class="legend">' + Object.keys(out.plan.tracks).map(function (id) {
          return '<span><i style="background:' + trackColor(id) + '"></i>' + escapeHtml(out.plan.tracks[id].name) + '</span>';
        }).join('') + '</div>',
      ].join('\n') : '',
    ].join('\n');
    renderOutputHead();
    updatePlayButton();
    refreshVisuals();
  }

  function lanePill(g, x, y, w, h, fill, label) {
    const r = Math.min(8, h / 2);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.fill();
    if (label) {
      g.fillStyle = 'rgba(11,11,18,0.85)';
      g.font = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif';
      g.fillText(label, x + 8, y + h / 2 + 4);
    }
  }

  function drawOutputWave(playheadSec) {
    const out = state.output;
    const el = document.getElementById('out-wave');
    if (!out || !el) {
      return;
    }
    // Match the canvas to its on-screen size so labels stay crisp at any width.
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = el.clientWidth || 600;
    const cssHeight = el.clientHeight || 124;
    const targetW = Math.max(200, Math.round(cssWidth * ratio));
    const targetH = Math.max(80, Math.round(cssHeight * ratio));
    if (el.width !== targetW || el.height !== targetH) {
      el.width = targetW;
      el.height = targetH;
    }
    const g = el.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = cssWidth;
    const h = cssHeight;
    const peakBuckets = Math.round(w);
    if (!out.peaks || out.peaksWidth !== peakBuckets) {
      out.peaks = H.waveformPeaks(out.channels, peakBuckets);
      out.peaksWidth = peakBuckets;
    }
    const total = out.plan.durationSec;
    const ruler = 16;
    const textTop = ruler + 4;
    const textH = 18;
    const visualTop = textTop + textH + 4;
    const visualH = 18;
    const audioTop = visualTop + visualH + 6;
    const audioH = h - audioTop - 4;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0b0b12';
    g.fillRect(0, 0, w, h);
    // Ruler and bar grid.
    g.fillStyle = '#9a9ab3';
    g.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
    const step = total > 40 ? 10 : total > 15 ? 5 : 2;
    for (let s = 0; s <= total + 0.001; s += step) {
      const x = Math.round((s / total) * (w - 1));
      g.fillRect(x, 0, 1, 7);
      g.fillText(Math.round(s) + 's', Math.min(x + 3, w - 24), 12);
    }
    const barSec = 240 / out.plan.targetBpm;
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let b = 1; b * barSec < total; b++) {
      g.fillRect(Math.round(((b * barSec) / total) * w), ruler, 1, h - ruler);
    }
    // Text and visual lanes.
    const theme = V.themes[state.look.theme];
    lanePill(g, 0, textTop, w, textH, 'rgba(250, 204, 21, 0.9)', 'T  ' + (displayTitle() || 'Title'));
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.accent);
    lanePill(g, 0, visualTop, w, visualH, grad, '▣  ' + theme.name + ' · ' + V.visualizers[state.look.visualizer] + (state.image ? ' · image' : ''));
    // Audio lane: waveform coloured per segment.
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, audioTop, w, audioH);
    out.plan.segments.forEach(function (seg) {
      const x0 = Math.floor((seg.outStartSec / total) * w);
      const x1 = Math.floor(((seg.outStartSec + seg.outLengthSec) / total) * w);
      g.fillStyle = trackColor(seg.track);
      for (let x = x0; x < x1 && x < w; x++) {
        const min = out.peaks[x * 2];
        const max = out.peaks[x * 2 + 1];
        const mid = audioTop + audioH / 2;
        g.fillRect(x, mid - max * audioH / 2, 1, Math.max(1, (max - min) * audioH / 2));
      }
      if (x1 - x0 > 60) {
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.font = '600 10px -apple-system, "Segoe UI", Roboto, sans-serif';
        g.fillText(cleanTitle(seg.name || ''), x0 + 6, audioTop + 12, x1 - x0 - 10);
      }
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(x0, audioTop, 2, audioH);
    });
    // Playhead.
    const px = Math.min(w - 2, Math.max(0, ((playheadSec || 0) / total) * w));
    g.fillStyle = '#ffffff';
    g.fillRect(px, 0, 2, h);
    g.beginPath();
    g.arc(px + 1, 4, 5, 0, Math.PI * 2);
    g.fill();
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
    state.playing = { source: source, started: audio.currentTime, offset: offset || 0, buffer: buffer, isOutput: buffer === (state.output && state.output.buffer) };
    source.onended = function () {
      if (state.playing && state.playing.source === source) {
        state.playing = null;
        updatePlayButton();
        if (buffer === (state.output && state.output.buffer)) {
          state.previewTime = 0;
          refreshVisuals();
        }
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
    const duration = state.playing.buffer.duration;
    const elapsed = ctx().currentTime - state.playing.started + state.playing.offset;
    const t = state.playing.source.loop ? elapsed % duration : Math.min(elapsed, duration);
    state.previewTime = t;
    refreshVisuals();
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

  function seekFromEvent(event) {
    const el = event.target;
    const out = state.output;
    if (!out) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(out.plan.durationSec - 0.01, ((event.clientX - rect.left) / rect.width) * out.plan.durationSec));
    state.previewTime = t;
    if (state.playing && state.playing.isOutput) {
      playBuffer(outputBuffer(out), t, 0, state.loopPlayback);
    } else {
      refreshVisuals();
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

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function download(result, label) {
    saveBlob(new Blob([H.encodeWav(result.channels, result.sampleRate)], { type: 'audio/wav' }),
      'sped-' + slug(label) + '-' + Math.round(result.plan.targetBpm) + 'bpm.wav');
  }

  function syncSafeToggles() {
    root.querySelectorAll('[data-action="safe-toggle"]').forEach(function (el) {
      el.checked = state.showSafe;
    });
  }

  function onOutputEvent(event) {
    if (event.target.id === 'out-wave') {
      return seekFromEvent(event);
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }
    const action = actionEl.dataset.action;
    if (action === 'upload-open') {
      setTab('media');
      document.getElementById('file-input').click();
      return;
    }
    if (action === 'demo') {
      return addDemoTracks();
    }
    if (action === 'render-now') {
      return renderRemix();
    }
    if (action === 'safe-toggle') {
      state.showSafe = actionEl.checked;
      syncSafeToggles();
      refreshVisuals();
      return;
    }
    if (!state.output) {
      return;
    }
    if (action === 'play') {
      if (state.playing && state.playing.isOutput) {
        stopPlayback();
      } else {
        playBuffer(outputBuffer(state.output), state.previewTime || 0, 0, state.loopPlayback);
      }
    } else if (action === 'loop-toggle') {
      state.loopPlayback = actionEl.checked;
      if (state.playing && state.playing.isOutput) {
        state.playing.source.loop = state.loopPlayback;
      }
    }
  }

  // ---------------------------------------------------------------- text & look

  function renderLook() {
    const card = document.getElementById('look-card');
    if (!card) {
      return;
    }
    const look = state.look;
    const p = S.platform(state.publication.platform);
    card.innerHTML = [
      '<h2>Text & look</h2>',
      '<label class="stack">Title on video<input type="text" maxlength="120" data-look="title" placeholder="' + escapeHtml(displayTitle() || 'Song title') + '" value="' + escapeHtml(look.title) + '"></label>',
      '<label class="stack">Subtitle<input type="text" maxlength="120" data-look="subtitle" placeholder="e.g. sped up version" value="' + escapeHtml(look.subtitle) + '"></label>',
      '<div class="field-label">Text position</div>',
      '<div class="segmented" role="group" aria-label="Text position">' + S.POSITIONS.map(function (pos) {
        return '<button type="button" data-look-position="' + pos + '" class="' + (look.position === pos ? 'on' : '') + '">' + pos[0].toUpperCase() + pos.slice(1) + '</button>';
      }).join('') + '</div>',
      '<div class="field-label">Theme</div>',
      '<div class="swatches">' + Object.keys(V.themes).map(function (id) {
        const t = V.themes[id];
        return '<button type="button" class="swatch' + (look.theme === id ? ' on' : '') + '" data-theme="' + id + '" style="background:linear-gradient(135deg,' + t.bg[0] + ',' + t.accent + ')" aria-pressed="' + (look.theme === id) + '"><span>' + escapeHtml(t.name) + '</span></button>';
      }).join('') + '</div>',
      '<div class="field-label">Visualizer</div>',
      '<div class="segmented" role="group" aria-label="Visualizer">' + Object.keys(V.visualizers).map(function (id) {
        return '<button type="button" data-visualizer="' + id + '" class="' + (look.visualizer === id ? 'on' : '') + '">' + V.visualizers[id] + '</button>';
      }).join('') + '</div>',
      '<div class="field-label">Background image</div>',
      '<div class="row tight"><label class="btn ghost file-btn">' + (state.image ? 'Replace image' : 'Choose image') + '<input type="file" accept="image/*" data-action="bg-image" aria-label="Background image"></label>' +
        (state.image ? '<span class="small ellipsis">' + escapeHtml(state.imageName) + '</span><button type="button" class="chip" data-action="bg-clear">Remove</button>' : '<span class="muted small">Optional · stays on this device</span>') + '</div>',
      '<div class="toggles">',
      '  <label><input type="checkbox" data-look="badge"' + (look.badge ? ' checked' : '') + '> Speed/BPM badge</label>',
      '  <label><input type="checkbox" data-look="progress"' + (look.progress ? ' checked' : '') + '> Progress bar</label>',
      '  <label><input type="checkbox" data-action="safe-toggle"' + (state.showSafe ? ' checked' : '') + '> Show ' + escapeHtml(p.short) + ' safe zone</label>',
      '</div>',
      '<p class="muted small">Text and visualizer stay inside the approximate ' + escapeHtml(p.name) + ' safe zone. Use images you have the right to post.</p>',
    ].join('\n');
  }

  async function loadBackground(file) {
    if (!/^image\//.test(file.type)) {
      throw new Error('Choose an image file (JPG, PNG, WebP…).');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Background images must be smaller than 15 MB.');
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise(function (resolve, reject) {
        img.onload = resolve;
        img.onerror = function () {
          reject(new Error('This browser could not read that image.'));
        };
        img.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    if (state.imageUrl) {
      URL.revokeObjectURL(state.imageUrl);
    }
    state.image = img;
    state.imageUrl = url;
    state.imageName = file.name;
    renderLook();
    refreshVisuals();
  }

  function onLookClick(event) {
    const el = event.target;
    const position = el.closest('[data-look-position]');
    const theme = el.closest('[data-theme]');
    const visualizer = el.closest('[data-visualizer]');
    const action = el.closest('[data-action]');
    if (position) {
      state.look.position = position.dataset.lookPosition;
    } else if (theme) {
      state.look.theme = theme.dataset.theme;
    } else if (visualizer) {
      state.look.visualizer = visualizer.dataset.visualizer;
    } else if (action && action.dataset.action === 'bg-clear') {
      if (state.imageUrl) {
        URL.revokeObjectURL(state.imageUrl);
      }
      state.image = null;
      state.imageUrl = null;
      state.imageName = '';
    } else if (action && action.dataset.action === 'safe-toggle') {
      state.showSafe = action.checked;
      syncSafeToggles();
      refreshVisuals();
      return;
    } else {
      return;
    }
    state.look = V.normaliseLook(state.look);
    saveLook();
    renderLook();
    refreshVisuals();
  }

  function onLookInput(event) {
    const key = event.target.dataset.look;
    if (event.target.dataset.action === 'bg-image' && event.type === 'change' && event.target.files[0]) {
      const file = event.target.files[0];
      event.target.value = '';
      return loadBackground(file);
    }
    if (!key) {
      return;
    }
    if (key === 'badge' || key === 'progress') {
      state.look[key] = event.target.checked;
    } else {
      state.look[key] = event.target.value;
    }
    state.look = V.normaliseLook(state.look);
    saveLook();
    renderOutputHead();
    refreshVisuals();
    if (key === 'title') {
      updateCaption();
    }
  }

  // ---------------------------------------------------------------- post: checklist, caption, export, share

  function currentCaption() {
    const out = state.output;
    const pid = state.publication.platform;
    const tags = state.caption.tags || (out ? S.suggestHashtags(out.plan, pid) : []);
    const credits = activeTracks().map(function (t) {
      return t.rights && t.rights.credit;
    }).filter(Boolean);
    return S.buildCaption({ platformId: pid, title: displayTitle(), credits: credits, hashtags: tags });
  }

  function recorderFormat() {
    if (!V.canRecord()) {
      return null;
    }
    return S.pickMimeType(function (type) { return MediaRecorder.isTypeSupported(type); }, state.includeAudio);
  }

  function canShareFiles() {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'sped.mp4', { type: 'video/mp4' })] }));
    } catch (err) {
      return false;
    }
  }

  function updateCaption() {
    const textarea = document.getElementById('caption');
    if (!textarea) {
      return;
    }
    const caption = currentCaption();
    if (!state.caption.edited) {
      state.caption.text = caption.text;
      textarea.value = caption.text;
    }
    const title = document.getElementById('video-title');
    if (title) {
      title.textContent = caption.title || '';
    }
    updateCaptionCount();
  }

  function updateCaptionCount() {
    const count = document.getElementById('caption-count');
    if (count) {
      const p = S.platform(state.publication.platform);
      const length = state.caption.text.length;
      count.textContent = length + ' / ' + p.captionLimit;
      count.classList.toggle('over', length > p.captionLimit);
    }
  }

  function scoreHtml(out) {
    const s = out.score;
    return [
      '<div class="score">',
      '  <div class="ring" style="--deg:' + Math.round(s.score * 3.6) + 'deg"><span>' + s.score + '</span></div>',
      '  <div><strong>' + escapeHtml(s.grade) + '</strong><p class="muted small">Unvalidated editing checklist — not a virality or audience prediction.</p></div>',
      '</div>',
      '<ul class="factors">' + s.factors.map(function (f) {
        return '<li><span class="f-label">' + escapeHtml(f.label) + '</span><span class="bar"><i style="width:' + Math.round(f.score * 100) + '%"></i></span><span class="f-value">' + escapeHtml(f.value) + '</span></li>';
      }).join('') + '</ul>',
      s.tips.length ? '<ul class="tips">' + s.tips.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul>' : '',
      out.plan.warnings && out.plan.warnings.length ? '<ul class="warn">' + out.plan.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>' : '',
      '<ul class="plan">' + H.describePlan(out.plan).map(function (line) { return '<li>' + escapeHtml(line) + '</li>'; }).join('') + '</ul>',
    ].join('\n');
  }

  function exportResultHtml() {
    const r = state.exportResult;
    if (!r) {
      return '';
    }
    const p = S.platform(r.platformId);
    const sizeMb = (r.blob.size / 1048576).toFixed(1);
    return [
      '<div class="export-result">',
      '  <video id="export-video" src="' + r.url + '" controls playsinline loop></video>',
      '  <div class="export-info">',
      '    <strong class="ellipsis">' + escapeHtml(r.name) + '</strong>',
      '    <span class="muted small">' + r.extension.toUpperCase() + ' · ' + sizeMb + ' MB · ' + r.seconds.toFixed(1) + ' s · ' + (r.includeAudio ? 'with audio' : 'silent') + ' · for ' + escapeHtml(p.name) + '</span>',
      '    <div class="row tight">',
      canShareFiles() ? '      <button class="btn primary" data-action="share">Share…</button>' : '',
      '      <button class="btn" data-action="download-video">Download video</button>',
      p.uploadUrl ? '      <a class="btn ghost" href="' + p.uploadUrl + '" target="_blank" rel="noopener noreferrer">Open ' + escapeHtml(p.short) + ' upload ↗</a>' : '',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function renderPost() {
    const card = document.getElementById('post-card');
    if (!card) {
      return;
    }
    const out = state.output;
    const pid = state.publication.platform;
    const p = S.platform(pid);
    const caption = currentCaption();
    if (!state.caption.edited) {
      state.caption.text = caption.text;
    }
    const format = recorderFormat();
    const report = S.readiness({
      platformId: pid,
      output: out,
      stale: state.stale,
      tracks: activeTracks(),
      includeAudio: state.includeAudio,
      caption: caption,
      formatWarnings: S.formatWarnings(pid, format && format.extension),
    });
    const suggestions = out ? S.suggestHashtags(out.plan, pid) : [];
    const selected = state.caption.tags || suggestions;
    const allTags = suggestions.concat(selected.filter(function (t) { return suggestions.indexOf(t) < 0; }));
    const icons = { ok: '✓', warn: '!', info: 'i', todo: '•' };
    const exporting = state.exporting;
    card.innerHTML = [
      '<h2>Post to ' + escapeHtml(p.name) + '</h2>',
      '<div class="pills wide" role="group" aria-label="Destination">' + platformPills() + '</div>',
      '<ul class="checklist">' + report.items.map(function (item) {
        return '<li class="lvl-' + item.level + '" data-check="' + item.id + '"><span class="ico" aria-hidden="true">' + icons[item.level] + '</span><div><strong>' + escapeHtml(item.label) + '</strong>' +
          (item.detail ? '<span class="muted small">' + escapeHtml(item.detail) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul>',
      '<p class="muted small">A checklist, not a promise of reach, monetisation or rights clearance.</p>',
      '<h3>Caption</h3>',
      p.titleLimit !== null ? '<p class="small">Video title: <strong id="video-title">' + escapeHtml(caption.title || '') + '</strong></p>' : '',
      '<textarea id="caption" rows="5" maxlength="5000" aria-label="Caption">' + escapeHtml(state.caption.text) + '</textarea>',
      '<div class="caption-meta small muted"><span id="caption-count"></span>' + (p.hashtagLimit !== null ? '<span>up to ' + p.hashtagLimit + ' hashtags</span>' : '') + '</div>',
      allTags.length ? '<div class="chips" aria-label="Hashtags">' + allTags.map(function (tag) {
        return '<button type="button" class="chip tag' + (selected.indexOf(tag) >= 0 ? ' on' : '') + '" data-tag="' + escapeHtml(tag) + '" aria-pressed="' + (selected.indexOf(tag) >= 0) + '">' + escapeHtml(tag) + '</button>';
      }).join('') + '</div>' : '',
      '<div class="row tight"><button type="button" class="btn" data-action="copy-caption">Copy caption</button>' +
        (state.caption.edited ? '<button type="button" class="btn ghost" data-action="reset-caption">Regenerate</button>' : '') + '</div>',
      '<h3>Export video</h3>',
      '<label class="toggle-line"><input type="checkbox" data-action="include-audio"' + (state.includeAudio ? ' checked' : '') + '> Include song audio</label>',
      '<p class="muted small">Untick for a silent video, then add the official sound inside ' + escapeHtml(p.short) + ' — usually the safest route for commercial songs.</p>',
      '<label class="stack small">Quality<select data-action="quality">' +
        '<option value="standard"' + (state.quality === 'standard' ? ' selected' : '') + '>Standard · 6 Mbps</option>' +
        '<option value="high"' + (state.quality === 'high' ? ' selected' : '') + '>High · 10 Mbps</option></select></label>',
      '<div class="row tight">',
      '  <button type="button" class="btn primary big" data-action="export-video" data-needs-idle>Export ' + (format ? format.extension.toUpperCase() : 'video') + '</button>',
      '  <button type="button" class="btn" data-action="cover" data-needs-idle>Cover image</button>',
      '</div>',
      '<div class="progress" id="export-progress"' + (exporting ? '' : ' hidden') + '><i style="width:0%"></i><span>Recording…</span></div>',
      '<p class="muted small">Exports in real time (a 26 s edit takes about 26 s) at 1080×1920, 30 fps. Keep this tab visible while it records.</p>',
      exportResultHtml(),
      '<div class="row tight"><button type="button" class="btn ghost" data-action="download" title="Export rendered audio; this does not grant publishing rights">⬇ WAV audio</button>',
      '<button type="button" class="btn ghost" data-action="save-recipe">Save rendered recipe</button></div>',
      '<p class="muted small">Sped can’t post for you — direct posting needs each platform’s approved developer integration. On phones, Share opens the system sheet with your installed apps; otherwise download and upload.</p>',
      out ? '<details class="edit-checks"><summary>Edit checklist details (unvalidated)</summary>' + scoreHtml(out) + '</details>' : '',
    ].join('\n');
    updateCaptionCount();
  }

  function updateExportProgress(timeSec, duration) {
    const bar = document.getElementById('export-progress');
    if (!bar) {
      return;
    }
    bar.hidden = false;
    const pct = Math.round(Math.min(1, timeSec / duration) * 100);
    bar.querySelector('i').style.width = pct + '%';
    bar.querySelector('span').textContent = 'Recording ' + formatTime(timeSec) + ' / ' + formatTime(duration) + ' — keep this tab visible';
  }

  async function exportVideo() {
    const out = state.output;
    if (!out) {
      throw new Error('Render an edit before exporting a video.');
    }
    stopPlayback();
    const scene = previewScene(true);
    scene.look = Object.assign({}, scene.look);
    const job = V.record({
      audioContext: ctx(),
      audioBuffer: outputBuffer(out),
      scene: scene,
      includeAudio: state.includeAudio,
      bitrate: state.quality === 'standard' ? 6000000 : 10000000,
      onProgress: updateExportProgress,
    });
    state.exporting = job;
    state.cancelled = false;
    setBusy(true, 'Exporting ' + job.format.extension.toUpperCase() + ' video in real time — keep this tab visible…');
    updateExportProgress(0, out.plan.durationSec);
    try {
      const result = await job.promise;
      if (state.exportResult) {
        URL.revokeObjectURL(state.exportResult.url);
      }
      state.exportResult = {
        blob: result.blob,
        url: URL.createObjectURL(result.blob),
        extension: result.extension,
        mimeType: result.mimeType,
        seconds: result.seconds,
        includeAudio: state.includeAudio,
        platformId: state.publication.platform,
        name: S.fileName(displayTitle() || out.label, state.publication.platform, result.extension),
      };
      setStatus('Video ready: ' + state.exportResult.name + ' (' + (result.blob.size / 1048576).toFixed(1) + ' MB). Share it or download and upload.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      state.exporting = null;
      setBusy(false);
      renderPost();
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const area = document.getElementById('caption');
      if (area) {
        area.focus();
        area.select();
        try {
          return document.execCommand('copy');
        } catch (inner) {
          return false;
        }
      }
      return false;
    }
  }

  async function shareExport() {
    const r = state.exportResult;
    if (!r) {
      throw new Error('Export a video first.');
    }
    const file = new File([r.blob], r.name, { type: r.blob.type || 'video/mp4' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      throw new Error('This browser cannot share video files. Download the video and upload it in the app.');
    }
    const copied = await copyText(state.caption.text);
    try {
      await navigator.share({ files: [file], title: displayTitle() || 'Sped edit', text: state.caption.text });
      setStatus(copied ? 'Shared. The caption is also on your clipboard — paste it if the app drops it.' : 'Shared.');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setStatus('Share cancelled.');
        return;
      }
      throw err;
    }
  }

  async function onPostEvent(event) {
    const tag = event.target.closest('[data-tag]');
    const actionEl = event.target.closest('[data-action]');
    if (tag) {
      const out = state.output;
      const current = (state.caption.tags || (out ? S.suggestHashtags(out.plan, state.publication.platform) : [])).slice();
      const index = current.indexOf(tag.dataset.tag);
      if (index >= 0) {
        current.splice(index, 1);
      } else {
        current.push(tag.dataset.tag);
      }
      state.caption.tags = current;
      state.caption.edited = false;
      renderPost();
      return;
    }
    if (!actionEl) {
      return;
    }
    const action = actionEl.dataset.action;
    if (action === 'copy-caption') {
      const ok = await copyText(state.caption.text);
      setStatus(ok ? 'Caption copied.' : 'Copy failed — select the caption text and copy it manually.');
    } else if (action === 'reset-caption') {
      state.caption.edited = false;
      renderPost();
    } else if (action === 'export-video') {
      return exportVideo();
    } else if (action === 'cover') {
      if (!state.output) {
        throw new Error('Render an edit before making a cover.');
      }
      const hook = Math.min(state.output.plan.durationSec, Math.max(0.2, state.output.score.hookTime || 0.5));
      const blob = await V.coverBlob(previewScene(true), hook);
      saveBlob(blob, S.fileName(displayTitle() || state.output.label, state.publication.platform, 'png').replace(/\.png$/, '-cover.png'));
      setStatus('Cover image saved (1080×1920 PNG).');
    } else if (action === 'share') {
      return shareExport();
    } else if (action === 'download-video') {
      if (!state.exportResult) {
        throw new Error('Export a video first.');
      }
      saveBlob(state.exportResult.blob, state.exportResult.name);
    } else if (action === 'download') {
      if (!state.output) {
        throw new Error('Render an edit first.');
      }
      download(state.output, state.output.label);
    } else if (action === 'save-recipe') {
      const project = state.output && state.output.savedProject;
      if (!project) {
        throw new Error('Render again before saving a portable recipe.');
      }
      saveBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'sped-recipe-' + slug(state.output.label) + '.json');
    }
  }

  function onPostChange(event) {
    const action = event.target.dataset.action;
    if (action === 'include-audio') {
      state.includeAudio = event.target.checked;
      renderPost();
    } else if (action === 'quality') {
      state.quality = event.target.value === 'standard' ? 'standard' : 'high';
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
    if (event.target.dataset.publication === 'platform') {
      setPlatform(event.target.value);
      return;
    } else if (event.target.dataset.publication) {
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
    if (event.type === 'change') {
      renderPost();
    } else {
      updateCaption();
    }
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
      state.previewTime = 0;
      state.caption.tags = null;
      renderRequest();
      renderTune();
      renderOutput();
      renderArrangement();
      renderPost();
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
      renderPost();
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
      if (state.exporting) {
        state.exporting.cancel();
        setStatus('Cancelling video export…');
        return;
      }
      engine.cancel();
      setStatus('Cancelling… loaded tracks will be kept.');
    });
    root.addEventListener('click', function (event) {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        setTab(tab.dataset.tab);
        if (window.matchMedia('(max-width: 900px)').matches || document.body.classList.contains('layout-mobile')) {
          const panel = root.querySelector('.panel[data-panel="' + tab.dataset.tab + '"]');
          if (panel) {
            panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
        }
        return;
      }
      if (state.busy) { return; }
      const platformBtn = event.target.closest('[data-platform]');
      if (platformBtn) {
        setPlatform(platformBtn.dataset.platform);
        return;
      }
      if (event.target.closest('[data-action="export-open"]')) {
        setTab('post');
        document.getElementById('post-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      safe(function () {
        if (event.target.closest('#songs-card')) { return onSongsEvent(event); }
        if (event.target.closest('#request-card')) { return onRequestEvent(event); }
        if (event.target.closest('#tune-card')) { return onTuneClick(event); }
        if (event.target.closest('#output-card')) { return onOutputEvent(event); }
        if (event.target.closest('#variants-card')) { return onVariantsEvent(event); }
        if (event.target.closest('#arrange-card')) { return onArrangeEvent(event); }
        if (event.target.closest('#look-card')) { return onLookClick(event); }
        if (event.target.closest('#post-card')) { return onPostEvent(event); }
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
        if (event.target.closest('#look-card')) { return onLookInput(event); }
        if (event.target.closest('#post-card')) { return onPostChange(event); }
      });
    });
    root.addEventListener('input', function (event) {
      if (state.busy) { return; }
      if (event.target.closest('#tune-card') && event.target.type === 'range') { onTuneInput(event); }
      if (event.target.id === 'request') { state.request = event.target.value; }
      if (event.target.id === 'caption') {
        state.caption.text = event.target.value;
        state.caption.edited = true;
        updateCaptionCount();
      }
      if (event.target.closest('#look-card') && event.target.type === 'text') { safe(function () { return onLookInput(event); }); }
      if (event.target.closest('#rights-card')) { safe(function () { return onRightsInput(event); }); }
    });
    root.addEventListener('keydown', function (event) {
      const tab = event.target.closest && event.target.closest('[role="tab"][data-tab]');
      if (tab && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setTab(tab.dataset.tab);
        return;
      }
      if (!state.busy && event.target.id === 'request' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.request = event.target.value;
        safe(remixFromRequest);
      }
      if (!state.busy && event.key === ' ' && state.output && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)) {
        event.preventDefault();
        if (state.playing && state.playing.isOutput) {
          stopPlayback();
        } else {
          playBuffer(outputBuffer(state.output), state.previewTime || 0, 0, state.loopPlayback);
        }
      }
    });
    ['dragenter', 'dragover', 'drop'].forEach(function (type) {
      root.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === 'drop' && !state.busy && event.target.closest('#dropzone, #output-card')) {
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
  window.SpedApp = {
    state: state,
    engine: engine,
    applyCurated: applyCurated,
    renderRemix: renderRemix,
    exportVideo: exportVideo,
    setTab: setTab,
    setPlatform: setPlatform,
  };
})();
