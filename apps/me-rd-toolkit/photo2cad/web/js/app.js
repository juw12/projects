/* ============================================================================
   photo2cad — front-end controller
   Plain ES module. No build step, no npm deps. three.js is loaded lazily by
   js/viewer.js (CDN import map) only when a model actually exists.
   Posts the exact contract to POST /api/generate (JSON, data-URL images).
   ========================================================================== */

const VIEWS = [
  { key: 'front',  label: 'Front' },
  { key: 'back',   label: 'Back' },
  { key: 'left',   label: 'Left' },
  { key: 'right',  label: 'Right' },
  { key: 'top',    label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
];

const STEPS = [
  { key: 'llm',      label: 'Draft program', sub: 'LLM' },
  { key: 'build',    label: 'Build solid',   sub: 'CadQuery' },
  { key: 'validate', label: 'Validate',      sub: 'STEP' },
];

const state = { images: {}, generating: false };
let currentViewer = null;   // handle returned by viewer.mountViewer (has .dispose)
let stepperTimer = null;    // interval id while loading

const rootEl = () => (typeof window !== "undefined" && window.__DATUM_CAD_ROOT__) || document;

/* ---------- tiny helpers ---------- */
const $ = (sel, root) => (root || rootEl()).querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function attr(s) { return esc(s); } // escape for an HTML attribute (href); '/' must be preserved
function fmtN(n) {
  if (n == null || isNaN(n)) return '—';
  const x = Number(n);
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}
function fmtVol(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}:${String(ss).padStart(2, '0')}` : `${ss}s`;
}
function stageInfo(stage) {
  const k = String(stage || '').toLowerCase();
  const map = {
    llm:      { idx: 0, badge: 'LLM drafting' },
    cadgen:   { idx: 0, badge: 'Program drafting' },
    exec:     { idx: 1, badge: 'CAD build' },
    sandbox:  { idx: 1, badge: 'CAD build' },
    validate: { idx: 2, badge: 'Validation' },
  };
  if (k === 'network') return { idx: -1, badge: null };
  return map[k] || { idx: -1, badge: stage || null };
}

/* ---------- inline icons ---------- */
const IC = {
  camera: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  x:      '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check:  '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7"/></svg>',
  cube:   '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  step:   '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 14h6M9 17h4"/></svg>',
  stl:    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9M8 19.5l4-7 4 7"/></svg>',
  code:   '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>',
  log:    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h10M5 17h14"/></svg>',
  chev:   '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  shield: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  warn:   '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

/* ---------- theme (only a non-sensitive pref is persisted) ---------- */
function initTheme() {
  if (typeof window !== "undefined" && window.__DATUM_CAD_EMBED__) return;
  const btn = $('#theme-btn');
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#090e16' : '#eaeef4';
    if (btn) btn.setAttribute('aria-label', 'Switch to ' + (t === 'dark' ? 'light' : 'dark') + ' theme');
  };
  apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('photo2cad.theme', next); } catch (e) {}
  });
}

/* ---------- server health ---------- */
function setPill(kind, text) {
  const p = $('#status-pill');
  if (!p) return;
  p.className = 'pill status ' + kind;
  p.innerHTML = '<span class="dot"></span><span class="status-txt">' + esc(text) + '</span>';
}
async function pingHealth() {
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch (_) {}
    if (j && j.ok) setPill('online', j.llm_configured === false ? 'online · no LLM key' : 'online');
    else setPill('degraded', 'degraded');
  } catch (e) {
    setPill('offline', 'API offline');
  }
}

/* ---------- image processing (downscale + JPEG, keeps payload small) ---------- */
function processImage(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const raw = reader.result;
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) { resolve(raw); return; }
          const scale = Math.min(1, maxDim / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const out = c.toDataURL('image/jpeg', quality);
          resolve(out && out.length > 200 ? out : raw);
        } catch (e) { resolve(raw); }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- photo slots ---------- */
function buildSlots() {
  const wrap = $('#slots');
  wrap.innerHTML = '';
  VIEWS.forEach((v) => {
    const fig = document.createElement('figure');
    fig.className = 'slot';
    fig.dataset.view = v.key;
    fig.setAttribute('role', 'group');
    fig.setAttribute('aria-label', v.label + ' photo');
    fig.innerHTML =
      '<label class="slot-drop">' +
        '<input class="slot-input sr-only" type="file" accept="image/*" aria-label="' + esc(v.label) + ' photo">' +
        '<span class="slot-ph" aria-hidden="true">' + IC.camera +
          '<span class="slot-ph-text">drop or <b>browse</b></span>' +
        '</span>' +
        '<img class="slot-thumb" alt="' + esc(v.label) + ' preview" hidden>' +
        '<span class="slot-busy" hidden><span class="spin"></span></span>' +
      '</label>' +
      '<figcaption class="slot-cap">' +
        '<span class="slot-key">' + v.label.toUpperCase() + '</span>' +
        '<span class="slot-state">empty</span>' +
      '</figcaption>' +
      '<button type="button" class="slot-remove" aria-label="Remove ' + esc(v.label) + ' photo" hidden>' + IC.x + '</button>';
    wrap.appendChild(fig);
    wireSlot(fig, v);
  });
}

function wireSlot(fig, v) {
  const drop = fig.querySelector('.slot-drop');
  const input = fig.querySelector('.slot-input');
  const thumb = fig.querySelector('.slot-thumb');
  const ph = fig.querySelector('.slot-ph');
  const busy = fig.querySelector('.slot-busy');
  const stateEl = fig.querySelector('.slot-state');
  const remove = fig.querySelector('.slot-remove');
  let depth = 0;

  const readFile = async (file) => {
    if (!file || !/^image\//.test(file.type || '')) { flashError(fig, 'not an image'); return; }
    busy.hidden = false;
    const dataUrl = await processImage(file);
    busy.hidden = true;
    if (!dataUrl) { flashError(fig, 'could not read'); return; }
    state.images[v.key] = { dataUrl, name: file.name };
    thumb.src = dataUrl;
    thumb.hidden = false;
    ph.hidden = true;
    remove.hidden = false;
    stateEl.textContent = 'set';
    fig.classList.add('filled');
    updatePhotoUI();
  };

  input.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) readFile(f);
    input.value = '';
  });

  drop.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; fig.classList.add('drag'); });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) fig.classList.remove('drag'); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; fig.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  remove.addEventListener('click', () => removeImage(fig, v.key));
}

function removeImage(fig, key) {
  delete state.images[key];
  const thumb = fig.querySelector('.slot-thumb');
  const input = fig.querySelector('.slot-input');
  thumb.hidden = true; thumb.removeAttribute('src');
  input.value = '';
  fig.querySelector('.slot-ph').hidden = false;
  fig.querySelector('.slot-remove').hidden = true;
  fig.querySelector('.slot-state').textContent = 'empty';
  fig.classList.remove('filled');
  updatePhotoUI();
}

function flashError(fig, msg) {
  fig.classList.add('flash-err');
  const s = fig.querySelector('.slot-state');
  s.textContent = msg;
  setTimeout(() => { fig.classList.remove('flash-err'); if (s.textContent === msg) s.textContent = state.images[fig.dataset.view] ? 'set' : 'empty'; }, 1600);
}

function updatePhotoUI() {
  const n = Object.keys(state.images).length;
  const c = $('#photo-count');
  if (c) c.textContent = n + ' / ' + VIEWS.length;
  updateHint();
}

function updateHint() {
  const n = Object.keys(state.images).length;
  const on = $('#use-vision') && $('#use-vision').checked;
  const hint = $('#actions-hint');
  if (!hint) return;
  hint.textContent = on ? (n ? n + ' photo' + (n > 1 ? 's' : '') + ' → vision model' : 'no photos — PRD only')
                        : 'photos hidden from model';
}

/* ---------- stepper (indicative feedback during the long request) ---------- */
function startStepper() {
  const stages = Array.from(rootEl().querySelectorAll('#results .step'));
  const elapsedEl = rootEl().querySelector('#results .elapsed');
  const marks = [0, 7000, 20000];
  const t0 = Date.now();
  let idx = 0;
  const set = () => {
    stages.forEach((s, i) => {
      s.classList.remove('active', 'done');
      if (i < idx) s.classList.add('done');
      else if (i === idx) s.classList.add('active');
    });
  };
  stepperTimer = setInterval(() => {
    const el = Date.now() - t0;
    if (elapsedEl) elapsedEl.textContent = fmtElapsed(el);
    let target = 0;
    for (let i = 0; i < marks.length; i++) if (el >= marks[i]) target = i;
    idx = Math.min(target, stages.length - 1);
    set();
  }, 400);
  set();
  return () => { if (stepperTimer) { clearInterval(stepperTimer); stepperTimer = null; } };
}

function stepNode(i, cls) {
  const inner = cls === 'done' ? IC.check : cls === 'failed' ? IC.x : String(i + 1);
  return '<span class="node">' + inner + '</span>';
}
function stepperHTML(kind, failIdx) {
  return '<ol class="stepper" aria-hidden="true">' + STEPS.map((s, i) => {
    let cls = '';
    if (kind === 'loading') cls = i === 0 ? 'active' : '';
    else if (kind === 'done') cls = 'done';
    else if (kind === 'error') cls = (failIdx == null || failIdx < 0) ? '' : (i < failIdx ? 'done' : i === failIdx ? 'failed' : '');
    return '<li class="step ' + cls + '">' + stepNode(i, cls === 'done' || cls === 'failed' ? cls : '') +
           '<span class="step-lbl">' + s.label + '</span><span class="step-key">' + s.sub + '</span></li>';
  }).join('') + '</ol>';
}

/* ---------- viewer lifecycle ---------- */
function disposeViewer() {
  if (currentViewer) { try { currentViewer.dispose(); } catch (e) {} currentViewer = null; }
}
function vpReady() {
  const frame = $('#results .vp-frame');
  const load = $('#results .vp-loading');
  if (load) load.remove();
  if (frame) frame.classList.add('has-model');
}
function showVpFallback(msg) {
  const load = $('#results .vp-loading');
  if (load) load.remove();
  const fb = $('#results .vp-fallback');
  const msgEl = $('#results .vp-fallback small');
  if (msgEl && msg) msgEl.textContent = msg;
  if (fb) fb.classList.remove('hidden');
  const frame = $('#results .vp-frame');
  if (frame) frame.classList.remove('has-model');
}
function mountViewerFor(stlUrl) {
  const vpEl = $('#results .viewport');
  if (!stlUrl || !vpEl) { showVpFallback('No STL preview was returned by the server.'); return; }
  import('./viewer.js')
    .then((m) => {
      currentViewer = m.mountViewer(vpEl, stlUrl, {
        onReady: vpReady,
        onFail: showVpFallback,
      });
    })
    .catch(() => showVpFallback('The 3D engine could not be loaded (CDN unreachable). The downloads below still work.'));
}

/* ---------- results states ---------- */
function setPanelStatus(cls, text) {
  const el = $('#panel-status');
  if (!el) return;
  el.className = 'panel-status mono' + (cls ? ' ' + cls : '');
  el.textContent = text || '';
}

function renderIdle() {
  disposeViewer();
  setPanelStatus('', '');
  $('#results').innerHTML =
    '<div class="result idle">' +
      '<div class="idle-icon">' +
        '<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="width:100%;height:100%;color:var(--line-2)">' +
          '<path d="M40 12l24 13v26L40 64 16 51V25z" stroke="var(--accent)" opacity=".55"/>' +
          '<path d="M16 25l24 13 24-13M40 38v26" stroke="var(--accent)" opacity=".55"/>' +
          '<circle cx="40" cy="40" r="34" stroke="currentColor"/>' +
        '</svg>' +
      '</div>' +
      '<h3>No model yet</h3>' +
      '<p>Write a PRD, drop up to six reference photos, and hit <b>Generate</b>. The live 3D preview, validation report, CadQuery source and STEP/STL downloads appear here.</p>' +
      '<ol class="howto">' +
        '<li>Describe the part &amp; dimensions (mm) in the PRD</li>' +
        '<li>Drop reference photos — any subset of the 6 views</li>' +
        '<li>Generate &rarr; orbit the preview, then download <span class="mono">.stp</span></li>' +
      '</ol>' +
    '</div>';
}

function renderLoading() {
  disposeViewer();
  setPanelStatus('is-busy', 'generating…');
  $('#results').innerHTML =
    '<div class="result loading">' +
      '<div class="load-top">' +
        '<span class="spin" aria-hidden="true"></span>' +
        '<div><div class="load-title">Generating model</div>' +
        '<div class="load-sub">This can take 30&ndash;90&nbsp;s when the vision model reads your photos.</div></div>' +
        '<span class="elapsed mono" aria-hidden="true">0s</span>' +
      '</div>' +
      stepperHTML('loading', 0) +
    '</div>';
}

function renderSuccess(d) {
  disposeViewer();
  const rep = d.report || {};
  const stepUrl = d.step_url || '', stlUrl = d.stl_url || '';
  const program = d.program || '', logs = d.logs || '';
  const programUrl = (stlUrl || stepUrl).replace(/model\.st[lp]$/, 'program.py');
  const bbox = Array.isArray(rep.bbox_mm) ? rep.bbox_mm : null;
  const isValid = rep.valid === true;
  setPanelStatus(isValid ? 'is-done' : 'is-err', (isValid ? 'valid' : 'issues') + (d.job_id ? ' · ' + d.job_id : ''));

  const warns = Array.isArray(rep.warnings) && rep.warnings.length
    ? '<ul class="warns">' + rep.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>'
    : '';

  $('#results').innerHTML =
    '<div class="result success">' +
      '<div class="result-head">' +
        '<span class="badge ' + (isValid ? 'ok' : 'warn') + '">' + (isValid ? 'valid model' : 'valid · warnings') + '</span>' +
        '<h3>Generated solid</h3>' +
        (d.job_id ? '<span class="job mono">job ' + esc(d.job_id) + '</span>' : '') +
      '</div>' +

      '<div class="vp-wrap">' +
        '<div class="vp-frame" role="img" aria-label="3D preview of the generated model">' +
          '<span class="vp-corner tl"></span><span class="vp-corner tr"></span><span class="vp-corner bl"></span><span class="vp-corner br"></span>' +
          '<div class="viewport"></div>' +
          '<div class="vp-loading"><div style="display:flex;flex-direction:column;align-items:center;gap:8px"><span class="spin"></span><span>loading preview…</span></div></div>' +
          '<div class="vp-hint">drag to orbit &middot; scroll to zoom</div>' +
          '<div class="vp-fallback hidden">' +
            '<svg class="vp-fb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>' +
            '<p>3D preview unavailable</p><small>The 3D engine could not load. The downloads below still work.</small>' +
          '</div>' +
        '</div>' +
        '<div class="vp-actions">' +
          (stepUrl ? '<a class="btn download primary" href="' + attr(stepUrl) + '" download="model.stp">' + IC.step + ' STEP <b>.stp</b></a>' : '') +
          (stlUrl ? '<a class="btn download" href="' + attr(stlUrl) + '" download="model.stl">' + IC.stl + ' STL <b>.stl</b></a>' : '') +
          (programUrl ? '<a class="link" href="' + attr(programUrl) + '" download="program.py">program.py</a>' : '') +
        '</div>' +
      '</div>' +

      '<div class="report">' +
        '<h3>' + IC.shield + ' Validation report</h3>' +
        '<div class="kpis">' +
          '<div class="kpi"><span class="kpi-v ' + (rep.solids === 1 ? 'ok' : 'ng') + '">' + (rep.solids != null ? esc(fmtN(rep.solids)) : '—') + '</span><span class="kpi-l">solids (want 1)</span></div>' +
          '<div class="kpi bbox"><span class="kpi-v">' + (bbox ? esc(fmtN(bbox[0])) + ' &times; ' + esc(fmtN(bbox[1])) + ' &times; ' + esc(fmtN(bbox[2])) : '—') + '</span><span class="kpi-l">bounding box · mm</span></div>' +
          '<div class="kpi"><span class="kpi-v">' + (rep.volume_mm3 != null ? esc(fmtVol(rep.volume_mm3)) : '—') + '</span><span class="kpi-l">volume · mm&sup3;</span></div>' +
        '</div>' +
        warns +
      '</div>' +

      (program ? '<details class="code-block-wrap"><summary>' + IC.code + ' CadQuery source ' + IC.chev + '</summary><pre><code>' + esc(program) + '</code></pre></details>' : '') +
      (logs ? '<details class="code-block-wrap"><summary>' + IC.log + ' Build log ' + IC.chev + '</summary><pre><code>' + esc(logs) + '</code></pre></details>' : '') +
    '</div>';

  mountViewerFor(stlUrl);
}

function renderError(d) {
  disposeViewer();
  const info = stageInfo(d && d.stage);
  const msg = (d && d.error) || 'Generation failed.';
  setPanelStatus('is-err', 'failed');

  $('#results').innerHTML =
    '<div class="result err-result">' +
      '<div class="result-head">' +
        '<span class="badge ng">failed</span>' +
        '<h3>Generation failed</h3>' +
      '</div>' +
      (info.badge ? '<div class="err-stage">' + IC.warn + ' Stopped at the <b>' + esc(info.badge) + '</b> stage</div>' : '') +
      '<p class="err-msg">' + esc(msg) + '</p>' +
      (d && d.hint ? '<p class="err-hint">' + esc(d.hint) + '</p>' : '') +
      stepperHTML('error', info.idx) +
      (d && d.program ? '<details class="code-block-wrap" open="open"><summary>' + IC.code + ' CadQuery source ' + IC.chev + '</summary><pre><code>' + esc(d.program) + '</code></pre></details>' : '') +
      (d && d.logs ? '<details class="code-block-wrap"><summary>' + IC.log + ' Build log ' + IC.chev + '</summary><pre><code>' + esc(d.logs) + '</code></pre></details>' : '') +
      '<p class="err-hint" style="margin-top:14px">Tip: re-run <b>Generate</b> — LLM output can be flaky on the first attempt.</p>' +
    '</div>';
}

/* ---------- generate ---------- */
function setBusy(b) {
  const btn = $('#generate-btn');
  btn.disabled = b;
  btn.setAttribute('aria-busy', b ? 'true' : 'false');
  btn.querySelector('.btn-spin').hidden = !b;
  btn.querySelector('.ic').style.display = b ? 'none' : '';
  btn.querySelector('.btn-label').textContent = b ? 'Generating…' : 'Generate model';
}
function markPrdInvalid() {
  const prd = $('#prd');
  prd.classList.add('invalid');
  $('#prd-err').hidden = false;
  prd.focus();
}
function clearPrdInvalid() {
  const prd = $('#prd');
  if (prd.classList.contains('invalid')) {
    prd.classList.remove('invalid');
    $('#prd-err').hidden = true;
  }
}

async function generate() {
  const prdEl = $('#prd');
  const prd = prdEl.value.trim();
  if (!prd) { markPrdInvalid(); return; }
  if (state.generating) return;
  clearPrdInvalid();

  state.generating = true;
  setBusy(true);
  const results = $('#results');
  results.setAttribute('aria-busy', 'true');
  renderLoading();
  const stopStepper = startStepper();
  const t0 = Date.now();

  // Build the exact contract payload.
  const payload = {
    prd: prdEl.value,
    units: 'mm',
    use_vision: $('#use-vision').checked,
    images: {},
  };
  Object.keys(state.images).forEach((k) => { payload.images[k] = state.images[k].dataUrl; });
  const model = $('#model-input').value.trim();
  if (model) payload.model = model;

  let data = null, netError = null;
  try {
    const res = await fetch('api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch (_) {}
    if (res.ok && parsed) {
      data = parsed;
    } else {
      data = (parsed && (parsed.ok === false || parsed.error))
        ? parsed
        : { ok: false, error: 'Server returned HTTP ' + res.status, stage: parsed && parsed.stage };
    }
    setPill('online', 'online');
  } catch (e) {
    netError = e;
    setPill('offline', 'API offline');
  }

  stopStepper();
  const secs = Math.round((Date.now() - t0) / 1000);

  if (netError) {
    renderError({
      error: 'Could not reach the photo2cad server.',
      stage: 'network',
      hint: 'Start the backend (python server/server.py) and retry. On the static GitHub Pages copy the API is not available — use the running server.',
    });
  } else if (data && data.ok) {
    renderSuccess(data);
  } else {
    renderError(data || { error: 'Unknown error' });
  }

  state.generating = false;
  setBusy(false);
  results.setAttribute('aria-busy', 'false');
  const hint = $('#actions-hint');
  if (hint && !netError) hint.textContent = 'done in ' + secs + 's';
}

/* ---------- reset ---------- */
function resetAll() {
  $('#prd').value = '';
  clearPrdInvalid();
  Object.keys(state.images).forEach((k) => {
    const fig = rootEl().querySelector('.slot[data-view="' + k + '"]');
    if (fig) removeImage(fig, k);
  });
  $('#use-vision').checked = true;
  $('#model-input').value = '';
  renderIdle();
  updatePhotoUI();
  setPill('online', 'online');
  pingHealth();
}

/* ---------- init ---------- */
function wireExamples() {
  rootEl().querySelectorAll(".example-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      const prd = $("#prd");
      if (!prd) return;
      prd.value = chip.getAttribute("data-prd") || "";
      prd.dispatchEvent(new Event("input", { bubbles: true }));
      prd.focus();
      if (prd.scrollIntoView) prd.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
}

function init() {
  initTheme();
  buildSlots();
  wireExamples();
  renderIdle();
  updatePhotoUI();

  $('#generate-btn').addEventListener('click', generate);
  $('#reset-btn').addEventListener('click', resetAll);
  $('#prd').addEventListener('input', clearPrdInvalid);
  $('#use-vision').addEventListener('change', updateHint);
  if ($('#model-input')) $('#model-input').addEventListener('input', updateHint);

  // Allow "drop on the whole input panel" to fill the first empty slot.
  const panel = $('.input-panel');
  if (panel) {
    let pd = 0;
    panel.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); pd++; panel.classList.add('drag-any'); }
    });
    panel.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    panel.addEventListener('dragleave', () => { pd = Math.max(0, pd - 1); if (!pd) panel.classList.remove('drag-any'); });
    panel.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); pd = 0; panel.classList.remove('drag-any');
      const file = e.dataTransfer.files[0];
      const target = rootEl().querySelector('.slot:not(.filled)') || rootEl().querySelector('.slot');
      if (target) {
        try {
          const input = target.querySelector('.slot-input');
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change'));
        } catch (err) { /* DataTransfer unsupported — per-slot drop still works */ }
      }
    });
  }

  pingHealth();
}

if (typeof window !== "undefined") {
  window.__datumCadInit = init;
  window.__datumCadTeardown = disposeViewer;
}
if (!(typeof window !== "undefined" && window.__DATUM_CAD_EMBED__)) init();
