/* ============================================================================
   photo2cad — gallery controller
   ES module, zero dependencies, no build step. Fetches gallery.json and renders
   the cards client-side; degrades to a clear inline notice if the fetch fails.
   Data-derived text is written with textContent / setAttribute only. innerHTML
   is used solely for fixed, allow-listed SVG (icons + per-shape blueprints) that
   contain NO user data, so nothing from gallery.json is ever injected as markup.
   ========================================================================== */

const $ = (sel, root = document) => (root || document).querySelector(sel);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* fixed inline icons (no data) */
const ICON = {
  camera: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>',
  step: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 14h6M9 17h4"/></svg>',
  stl: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9M8 19.5l4-7 4 7"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

const SHAPES = ['box', 'bracket', 'lid', 'gear', 'heatsink', 'flange'];
const FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/* allow-listed, data-free stylized isometric line art (viewBox 0 0 160 120) */
function gearBody() {
  let s = '';
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    s += '<path d="M' + (80 + 30 * Math.cos(a)).toFixed(1) + ' ' + (56 + 30 * Math.sin(a)).toFixed(1) +
         ' L' + (80 + 40 * Math.cos(a)).toFixed(1) + ' ' + (56 + 40 * Math.sin(a)).toFixed(1) + '"/>';
  }
  s += '<circle cx="80" cy="56" r="30"/>';
  s += '<circle class="gh" cx="80" cy="56" r="35"/>';
  s += '<circle cx="80" cy="56" r="8"/>';
  return s;
}
function heatsinkBody() {
  let s = '<path class="gt" d="M80 26 L120 46 L80 66 L40 46 Z"/>';
  s += '<path class="gf" d="M40 46 L80 66 L80 96 L40 76 Z"/>';
  s += '<path class="gf" d="M120 46 L80 66 L80 96 L120 76 Z"/>';
  s += '<path class="gh" d="M80 26 L80 56 M80 56 L40 76 M80 56 L120 76"/>';
  for (let k = 1; k <= 7; k++) {
    const x = 80 - 5 * k;
    const ty = (66 - 2.5 * k).toFixed(1);
    const ry = (46 - 2.5 * k).toFixed(1);
    const fy = (96 - 2.5 * k).toFixed(1);
    s += '<path d="M' + x + ' ' + ty + ' L' + (x + 40) + ' ' + ry + '"/>';
    s += '<path d="M' + x + ' ' + ty + ' L' + x + ' ' + fy + '"/>';
  }
  return s;
}
const SHAPE_BODY = {
  box:
    '<path class="gt" d="M80 20 L124 42 L80 64 L36 42 Z"/>' +
    '<path class="gf" d="M36 42 L80 64 L80 102 L36 80 Z"/>' +
    '<path class="gf" d="M124 42 L80 64 L80 102 L124 80 Z"/>' +
    '<path class="gh" d="M80 20 L80 58 M80 58 L36 80 M80 58 L124 80"/>' +
    '<ellipse cx="58" cy="72" rx="9" ry="7"/>',
  bracket:
    '<path class="gt" d="M34 34 L56 34 L74 25 L52 25 Z"/>' +
    '<path class="gt" d="M56 74 L110 74 L128 65 L74 65 Z"/>' +
    '<path class="gf" d="M34 34 L56 34 L56 74 L110 74 L110 96 L34 96 Z"/>' +
    '<path class="gf" d="M110 74 L110 96 L128 87 L128 65 Z"/>' +
    '<path d="M56 44 L56 74 L84 74 Z"/>' +
    '<path class="gh" d="M34 96 L52 87 M52 87 L52 25"/>',
  lid:
    '<path class="gt" d="M80 34 L128 52 L80 70 L32 52 Z"/>' +
    '<path class="gf" d="M32 52 L80 70 L80 90 L32 72 Z"/>' +
    '<path class="gf" d="M128 52 L80 70 L80 90 L128 72 Z"/>' +
    '<path class="gh" d="M80 34 L80 54 M80 54 L32 72 M80 54 L128 72"/>' +
    '<path d="M80 40 L120 52 L80 64 L40 52 Z"/>',
  flange:
    '<circle cx="80" cy="56" r="34"/>' +
    '<circle class="gh" cx="80" cy="56" r="24"/>' +
    '<circle cx="80" cy="56" r="7"/>' +
    '<circle cx="104" cy="56" r="3"/><circle cx="92" cy="76.8" r="3"/><circle cx="68" cy="76.8" r="3"/>' +
    '<circle cx="56" cy="56" r="3"/><circle cx="68" cy="35.2" r="3"/><circle cx="92" cy="35.2" r="3"/>' +
    '<path class="gc" d="M68 56 L92 56 M80 44 L80 68"/>',
};
SHAPE_BODY.gear = gearBody();
SHAPE_BODY.heatsink = heatsinkBody();

function blueprintSvg(shape) {
  const body = SHAPE_BODY[SHAPES.includes(shape) ? shape : 'box'];
  return '<svg viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false">' + body + '</svg>';
}

/* only accept relative or full http(s) URLs — drop schemes + absolute-root */
function safeUrl(u) {
  if (typeof u !== 'string') return '';
  const t = u.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return '';
  if (t.startsWith('/')) return '';
  return t;
}
function cap(s) { return String(s == null ? '' : s).replace(/\S/, (c) => c.toUpperCase()); }

function renderCard(part) {
  const article = el('article', 'panel g-card');

  const head = el('header', 'g-head');
  const headMain = el('div', 'g-head-main');
  headMain.append(el('span', 'g-cat', part.category || 'part'));
  headMain.append(el('h3', 'g-name', part.name || 'Untitled part'));
  head.append(headMain);
  if (part.sample) head.append(el('span', 'g-samp', 'sample'));
  article.append(head);

  article.append(el('p', 'hint g-prd', part.prd || ''));

  const faces = el('div', 'g-faces');
  faces.setAttribute('role', 'group');
  faces.setAttribute('aria-label', 'Six reference faces');
  const faceList = Array.isArray(part.faces) && part.faces.length
    ? part.faces
    : FACES.map((k) => ({ key: k, label: cap(k) }));
  faceList.forEach((f) => {
    const cell = el('div', 'g-face');
    cell.innerHTML = ICON.camera; /* fixed glyph, no data */
    cell.append(el('span', 'g-face-lbl', f && f.label ? f.label : f && f.key ? cap(f.key) : ''));
    faces.append(cell);
  });
  article.append(faces);

  const preview = el('figure', 'g-preview');
  const renderUrl = safeUrl(part.render);
  if (renderUrl) {
    const img = document.createElement('img');
    img.src = renderUrl;
    img.alt = 'Render of ' + (part.name || 'part');
    img.loading = 'lazy';
    preview.append(img, el('figcaption', 'g-preview-cap', 'render'));
  } else {
    preview.innerHTML = blueprintSvg(part.shape); /* fixed geometry, no data */
    preview.append(el('figcaption', 'g-preview-cap', 'blueprint preview'));
    preview.setAttribute('aria-label', 'Stylized blueprint of ' + (part.name || 'part'));
  }
  article.append(preview);

  const meta = el('div', 'g-meta');
  const badges = el('div', 'g-badges');
  const stepUrl = safeUrl(part.step);
  const stlUrl = safeUrl(part.stl);
  if (stepUrl) {
    const a = el('a', 'badge ok');
    a.href = stepUrl; a.download = 'model.stp';
    a.setAttribute('aria-label', 'Download STEP file');
    a.innerHTML = ICON.step; a.append(el('span', null, 'STEP'));
    badges.append(a);
  } else {
    badges.append(el('span', 'badge samp', 'STEP · n/a'));
  }
  if (stlUrl) {
    const a = el('a', 'badge warn');
    a.href = stlUrl; a.download = 'model.stl';
    a.setAttribute('aria-label', 'Download STL file');
    a.innerHTML = ICON.stl; a.append(el('span', null, 'STL'));
    badges.append(a);
    // TODO: wire 3D preview via js/viewer.js when real STLs exist
  } else {
    badges.append(el('span', 'badge samp', 'STL · n/a'));
  }
  meta.append(badges);
  meta.append(el('span', 'g-units', [part.units || '', part.created].filter(Boolean).join(' · ')));
  article.append(meta);

  return article;
}

function clearGrid(grid) { grid.innerHTML = ''; }

function renderEmpty(grid, msg) {
  clearGrid(grid);
  const box = el('div', 'panel g-empty');
  box.append(el('h3', null, 'Empty gallery'), el('p', 'hint', msg || 'No parts to show yet.'));
  grid.append(box);
}

function renderError(grid, err) {
  clearGrid(grid);
  const box = el('div', 'panel g-empty');
  box.setAttribute('role', 'alert');
  const icon = el('div', null);
  icon.innerHTML = ICON.warn;
  icon.style.color = 'var(--warn)';
  icon.style.width = '22px'; icon.style.height = '22px';
  const h = el('h3', null, 'Could not load the gallery');
  h.style.margin = '12px 0 6px'; h.style.fontSize = '15px';
  const msg = 'The gallery data (gallery.json) could not be loaded' +
    (err && err.message ? ' (' + err.message + ')' : '') +
    '. On the deployed site it loads automatically; if you opened this file straight from disk (file://), serve the folder over a local web server (for example: python -m http.server) and reload.';
  box.append(icon, h, el('p', 'hint', msg));
  grid.append(box);
}

function setNote(data) {
  const t = $('#note-text'), u = $('#note-updated');
  if (t && data.note) t.textContent = data.note;
  if (u && data.updated) u.textContent = '· updated ' + data.updated;
}

async function load() {
  const grid = $('#gallery-grid');
  if (!grid) return;
  try {
    const res = await fetch('gallery.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const parts = Array.isArray(data.parts) ? data.parts : [];
    grid.setAttribute('aria-busy', 'false');
    if (!parts.length) { renderEmpty(grid); return; }
    clearGrid(grid);
    parts.forEach((p) => grid.append(renderCard(p)));
    setNote(data);
  } catch (err) {
    grid.setAttribute('aria-busy', 'false');
    renderError(grid, err);
  }
}

function initTheme() {
  const btn = $('#theme-btn');
  if (!btn) return;
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#090e16' : '#eaeef4';
    btn.setAttribute('aria-label', 'Switch to ' + (t === 'dark' ? 'light' : 'dark') + ' theme');
  };
  apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('photo2cad.theme', next); } catch (e) {}
  });
}

function init() {
  initTheme();
  load();
}
init();
