/* ==========================================================================
   Orbis Plus — interaction layer for app.html
   --------------------------------------------------------------------------
   Loaded right after the main inline script. It builds on the app's globals
   (state, persist, navigateTo, render*, showToast …) instead of replacing
   the app, so the original logic and data model keep working unchanged.

   Adds:
     • Command palette (Ctrl/⌘ K) with fuzzy search over views, actions & data
     • Keyboard shortcuts (G-then-key navigation, J/K triage on Today, ? sheet)
     • Undo for dismiss / snooze / confirm / status changes / deletes
     • Today dashboard: greeting, KPI cards, progress ring, filters, empty state
     • Commitments: working filters with counts, search, sorting, bulk actions,
       Kanban board with drag & drop, quick-add dialog, delete
     • Sidebar: grouped sections, live count badges, collapsible icon rail
     • Appearance: light/dark/system theme, accent colours, density, motion
     • Focus timer (Pomodoro) in the top bar
   ========================================================================== */
(function () {
  'use strict';

  if (typeof state === 'undefined' || !document.getElementById('app')) {
    return; // Not the desktop app shell.
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD_LABEL = isMac ? '⌘' : 'Ctrl';
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const ICON = {
    today: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>',
    list: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
    draft: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    rows: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    board: '<rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
    doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    chevron: '<polyline points="15 18 9 12 15 6"/>',
    party: '<path d="M5.8 11.3L2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="M22 2l-2.24.75a2.9 2.9 0 00-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="M11 13c-1.93-1.93-4.06-2.97-4.75-2.28-.69.69.35 2.82 2.28 4.75 1.93 1.93 4.06 2.97 4.75 2.28.69-.69-.35-2.82-2.28-4.75z"/>',
    snooze: '<path d="M12 22a10 10 0 100-20 10 10 0 000 20z"/><path d="M9 9h6l-6 6h6"/>'
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

  // ---------------------------------------------------------------------------
  // UI preferences (local to this device)
  // ---------------------------------------------------------------------------
  const PREF_KEY = 'orbis-ui';
  const prefs = Object.assign({
    themeMode: localStorage.getItem('orbis-theme') || 'light', // light | dark | system
    accent: 'indigo',
    density: 'comfortable',
    reduceMotion: false,
    sidebarCollapsed: false,
    commitView: 'list',
    focusMinutes: 25
  }, safeParse(localStorage.getItem(PREF_KEY)));

  function safeParse(raw) {
    try {
      return JSON.parse(raw || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function savePrefs() {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }

  const ui = {
    todayFilter: 'all',
    todaySelected: null,
    commitFilter: 'all',
    commitQuery: '',
    commitSort: { key: null, dir: 1 },
    commitSelected: new Set(),
    undoNext: null
  };

  const VIEW_LABELS = {};
  qsa('.nav-item').forEach((item) => {
    const label = item.querySelector('span');
    VIEW_LABELS[item.dataset.view] = label ? label.textContent.trim() : item.dataset.view;
  });

  const GO_KEYS = {
    t: 'today', c: 'commitments', s: 'search', u: 'summaries', d: 'drafts',
    a: 'aura', k: 'culture', r: 'growth', p: 'privacy', w: 'work', l: 'learn', h: 'guide'
  };
  const VIEW_GO_KEY = Object.fromEntries(Object.entries(GO_KEYS).map(([key, view]) => [view, key]));

  // ---------------------------------------------------------------------------
  // Toasts with undo + progress
  // ---------------------------------------------------------------------------
  function toast(message, options = {}) {
    const container = qs('#toastContainer');
    if (!container) {
      return;
    }
    const undo = options.undo || null;
    const duration = options.duration || (undo ? 6000 : 3800);
    const element = document.createElement('div');
    element.className = 'toast op-toast';
    element.innerHTML = `
      <span class="op-toast-msg"></span>
      ${undo ? '<button class="op-toast-undo" type="button">Undo</button>' : ''}
      <button class="op-toast-x" type="button" aria-label="Dismiss notification">×</button>
      <span class="op-toast-bar" style="animation-duration:${duration}ms"></span>`;
    element.querySelector('.op-toast-msg').textContent = message;
    const remove = () => {
      element.style.transition = 'opacity .2s, transform .2s';
      element.style.opacity = '0';
      element.style.transform = 'translateY(6px)';
      setTimeout(() => element.remove(), 200);
    };
    const timer = setTimeout(remove, duration);
    element.querySelector('.op-toast-x').addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
    if (undo) {
      element.querySelector('.op-toast-undo').addEventListener('click', () => {
        clearTimeout(timer);
        undo();
        remove();
        toast('Undone');
      });
    }
    while (container.children.length >= 4) {
      container.firstElementChild.remove();
    }
    container.appendChild(element);
  }

  // Every existing showToast() call now gets the richer toast, and picks up
  // an undo action when one was registered by withUndo() below.
  window.showToast = function (message) {
    toast(message, { undo: ui.undoNext });
    ui.undoNext = null;
  };

  const COLLECTION_FOR = { todayItems: 'queue', commitments: 'commitments', drafts: 'drafts' };

  function snapshot(keys) {
    const snap = {};
    keys.forEach((key) => {
      snap[key] = clone(state[key]);
    });
    return snap;
  }

  function restore(snap) {
    Object.keys(snap).forEach((key) => {
      state[key] = snap[key];
      persist(COLLECTION_FOR[key]);
    });
    rerenderAll();
  }

  function withUndo(fnName, keys) {
    const original = window[fnName];
    if (typeof original !== 'function') {
      return;
    }
    window[fnName] = function (...args) {
      const snap = snapshot(keys);
      ui.undoNext = () => restore(snap);
      try {
        return original.apply(this, args);
      } finally {
        ui.undoNext = null;
      }
    };
  }

  withUndo('confirmToday', ['todayItems']);
  withUndo('snoozeToday', ['todayItems']);
  withUndo('dismissToday', ['todayItems']);
  withUndo('discardDraft', ['drafts']);
  withUndo('updateCommitmentStatus', ['commitments']);

  function rerenderAll() {
    const view = state.currentView;
    if (view === 'today') {
      renderToday();
    }
    if (view === 'commitments') {
      renderCommitments();
    }
    if (view === 'drafts') {
      renderDrafts();
    }
    updateBadges();
  }

  // Keep badges fresh whenever the app saves anything.
  const originalPersist = window.persist;
  window.persist = function (collection) {
    originalPersist(collection);
    updateBadges();
  };

  // ---------------------------------------------------------------------------
  // Sidebar: sections, badges, collapse
  // ---------------------------------------------------------------------------
  function enhanceSidebar() {
    const nav = qs('.sidebar .nav');
    if (!nav) {
      return;
    }
    const sections = [
      ['today', 'Workspace'],
      ['aura', 'You'],
      ['work', 'Explore']
    ];
    sections.forEach(([view, label]) => {
      const item = qs(`.nav-item[data-view="${view}"]`, nav);
      if (item) {
        const heading = document.createElement('div');
        heading.className = 'op-nav-section';
        heading.textContent = label;
        nav.insertBefore(heading, item);
      }
    });
    qsa('.nav-item', nav).forEach((item) => {
      item.dataset.label = VIEW_LABELS[item.dataset.view];
      const key = VIEW_GO_KEY[item.dataset.view];
      item.title = key ? `${VIEW_LABELS[item.dataset.view]}  (G then ${key.toUpperCase()})` : VIEW_LABELS[item.dataset.view];
      if (['today', 'commitments', 'drafts'].includes(item.dataset.view)) {
        const badge = document.createElement('span');
        badge.className = 'op-badge';
        badge.dataset.badge = item.dataset.view;
        badge.hidden = true;
        item.appendChild(badge);
      }
    });

    const footer = qs('.sidebar-footer');
    if (footer) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'op-collapse-btn';
      button.innerHTML = `${svg('chevron', 16)}<span>Collapse sidebar</span><span class="op-spacer"></span><span class="op-kbd">[</span>`;
      button.addEventListener('click', toggleSidebar);
      footer.appendChild(button);
    }
    applySidebar();
  }

  function applySidebar() {
    qs('#app').classList.toggle('op-collapsed', !!prefs.sidebarCollapsed);
  }

  function toggleSidebar() {
    prefs.sidebarCollapsed = !prefs.sidebarCollapsed;
    savePrefs();
    applySidebar();
  }

  function activeTodayItems() {
    return state.todayItems.filter((item) => !item.dismissed && !item.snoozed && !item.committed);
  }

  function updateBadges() {
    const setBadge = (view, count, tone) => {
      const badge = qs(`.op-badge[data-badge="${view}"]`);
      if (!badge) {
        return;
      }
      badge.hidden = !count;
      badge.textContent = count;
      badge.className = 'op-badge' + (tone ? ` ${tone}` : '');
    };
    setBadge('today', state.aiPaused ? 0 : activeTodayItems().length, 'hot');
    const overdue = state.commitments.filter((c) => c.status === 'overdue').length;
    const open = state.commitments.filter((c) => c.status === 'open').length;
    setBadge('commitments', overdue || open, overdue ? 'warn' : '');
    setBadge('drafts', state.aiPaused ? 0 : (state.drafts || []).length, '');
  }

  // ---------------------------------------------------------------------------
  // Top bar: palette trigger, focus timer, appearance
  // ---------------------------------------------------------------------------
  function enhanceTopBar() {
    const left = qs('.top-bar-left');
    const right = qs('.top-bar-right');
    if (!left || !right) {
      return;
    }
    const topSearch = qs('#topSearch');
    if (topSearch) {
      topSearch.placeholder = 'Search messages, commitments…  ( / )';
    }

    const cmdk = document.createElement('button');
    cmdk.type = 'button';
    cmdk.className = 'op-cmdk-btn';
    cmdk.setAttribute('aria-label', 'Open command palette');
    cmdk.innerHTML = `${svg('bolt', 15)}<span class="op-cmdk-label">Commands</span><span class="op-kbd">${MOD_LABEL}</span><span class="op-kbd">K</span>`;
    cmdk.addEventListener('click', () => openPalette());
    left.appendChild(cmdk);

    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'op-focus-chip';
    focus.id = 'opFocusChip';
    focus.title = 'Focus session (F)';
    focus.addEventListener('click', toggleFocus);
    right.insertBefore(focus, right.firstChild);

    const appearance = document.createElement('button');
    appearance.type = 'button';
    appearance.className = 'op-icon-btn';
    appearance.id = 'opAppearanceBtn';
    appearance.setAttribute('aria-label', 'Appearance settings');
    appearance.setAttribute('aria-expanded', 'false');
    appearance.title = 'Appearance';
    appearance.innerHTML = svg('palette', 18);
    appearance.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleAppearance();
    });
    const themeToggle = qs('#themeToggle');
    right.insertBefore(appearance, themeToggle ? themeToggle.nextSibling : null);

    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'op-icon-btn op-help-btn';
    help.setAttribute('aria-label', 'Keyboard shortcuts');
    help.title = 'Keyboard shortcuts (?)';
    help.innerHTML = svg('keyboard', 18);
    help.addEventListener('click', openShortcuts);
    right.insertBefore(help, appearance.nextSibling);

    renderFocusChip();
  }

  // ---------------------------------------------------------------------------
  // Appearance: theme mode, accent, density, motion
  // ---------------------------------------------------------------------------
  const ACCENTS = [
    ['indigo', '#4F46E5'], ['violet', '#7C3AED'], ['sky', '#0284C7'], ['teal', '#0D9488'],
    ['emerald', '#059669'], ['amber', '#D97706'], ['rose', '#E11D48']
  ];
  const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let settingThemeProgrammatically = false;

  function wantDark() {
    if (prefs.themeMode === 'system') {
      return !!(systemDark && systemDark.matches);
    }
    return prefs.themeMode === 'dark';
  }

  function syncTheme() {
    const toggle = qs('#themeToggle');
    if (toggle && wantDark() !== !!state.darkMode) {
      settingThemeProgrammatically = true;
      toggle.click(); // reuse the app's own theme logic + persistence
      settingThemeProgrammatically = false;
    }
  }

  function applyAppearance() {
    const root = document.documentElement;
    if (prefs.accent && prefs.accent !== 'indigo') {
      root.setAttribute('data-accent', prefs.accent);
    } else {
      root.removeAttribute('data-accent');
    }
    root.setAttribute('data-density', prefs.density);
    root.setAttribute('data-motion', prefs.reduceMotion ? 'reduced' : 'full');
    const meta = qs('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--brand-600').trim() || '#4F46E5');
    }
  }

  function buildAppearancePopover() {
    const pop = document.createElement('div');
    pop.className = 'op-popover';
    pop.id = 'opAppearance';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Appearance');
    pop.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(pop);
    document.addEventListener('click', () => {
      if (!settingThemeProgrammatically) {
        closeAppearance();
      }
    });
    renderAppearance();
  }

  function renderAppearance() {
    const pop = qs('#opAppearance');
    if (!pop) {
      return;
    }
    const seg = (name, value, label) =>
      `<button type="button" data-op-${name}="${value}" aria-pressed="${prefs[name === 'theme' ? 'themeMode' : name] === value}">${label}</button>`;
    pop.innerHTML = `
      <div class="op-pop-section">
        <div class="op-pop-title">Theme</div>
        <div class="op-segmented full">
          ${seg('theme', 'light', 'Light')}${seg('theme', 'dark', 'Dark')}${seg('theme', 'system', 'System')}
        </div>
      </div>
      <div class="op-pop-section">
        <div class="op-pop-title">Accent</div>
        <div class="op-swatches">
          ${ACCENTS.map(([name, colour]) => `<button type="button" class="op-swatch" data-op-accent="${name}" style="background:${colour}" aria-label="${name} accent" aria-pressed="${prefs.accent === name}" title="${name[0].toUpperCase() + name.slice(1)}"></button>`).join('')}
        </div>
      </div>
      <div class="op-pop-section">
        <div class="op-pop-title">Density</div>
        <div class="op-segmented full">
          ${seg('density', 'comfortable', 'Comfortable')}${seg('density', 'compact', 'Compact')}
        </div>
      </div>
      <div class="op-pop-section">
        <div class="op-switch-row">
          <span>Reduce motion</span>
          <button type="button" class="op-switch" role="switch" data-op-motion aria-checked="${!!prefs.reduceMotion}" aria-label="Reduce motion"></button>
        </div>
        <div class="op-switch-row">
          <span>Collapsed sidebar</span>
          <button type="button" class="op-switch" role="switch" data-op-collapse aria-checked="${!!prefs.sidebarCollapsed}" aria-label="Collapsed sidebar"></button>
        </div>
      </div>`;
    qsa('[data-op-theme]', pop).forEach((button) => button.addEventListener('click', () => setThemeMode(button.dataset.opTheme)));
    qsa('[data-op-accent]', pop).forEach((button) => button.addEventListener('click', () => setAccent(button.dataset.opAccent)));
    qsa('[data-op-density]', pop).forEach((button) => button.addEventListener('click', () => setDensity(button.dataset.opDensity)));
    qs('[data-op-motion]', pop).addEventListener('click', () => {
      prefs.reduceMotion = !prefs.reduceMotion;
      savePrefs();
      applyAppearance();
      renderAppearance();
    });
    qs('[data-op-collapse]', pop).addEventListener('click', () => {
      toggleSidebar();
      renderAppearance();
    });
  }

  function setThemeMode(mode) {
    prefs.themeMode = mode;
    savePrefs();
    syncTheme();
    renderAppearance();
  }

  function setAccent(name) {
    prefs.accent = name;
    savePrefs();
    applyAppearance();
    renderAppearance();
  }

  function setDensity(value) {
    prefs.density = value;
    savePrefs();
    applyAppearance();
    renderAppearance();
  }

  function toggleAppearance() {
    const pop = qs('#opAppearance');
    if (pop.classList.contains('show')) {
      closeAppearance();
      return;
    }
    renderAppearance();
    const anchor = qs('#opAppearanceBtn').getBoundingClientRect();
    pop.style.top = `${anchor.bottom + 8}px`;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - 312, anchor.right - 300))}px`;
    pop.classList.add('show');
    qs('#opAppearanceBtn').setAttribute('aria-expanded', 'true');
  }

  function closeAppearance() {
    const pop = qs('#opAppearance');
    if (pop && pop.classList.contains('show')) {
      pop.classList.remove('show');
      qs('#opAppearanceBtn').setAttribute('aria-expanded', 'false');
    }
  }

  // ---------------------------------------------------------------------------
  // Focus timer (Pomodoro)
  // ---------------------------------------------------------------------------
  const FOCUS_KEY = 'orbis-focus-end';
  let focusTick = null;
  let baseTitle = document.title;

  function focusRemaining() {
    const end = Number(localStorage.getItem(FOCUS_KEY) || 0);
    return end ? Math.max(0, end - Date.now()) : 0;
  }

  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderFocusChip() {
    const chip = qs('#opFocusChip');
    if (!chip) {
      return;
    }
    const remaining = focusRemaining();
    const running = remaining > 0;
    const totalMs = prefs.focusMinutes * 60000;
    const circumference = 2 * Math.PI * 7;
    const fraction = running ? remaining / totalMs : 1;
    chip.classList.toggle('running', running);
    chip.setAttribute('aria-label', running ? `Focus session running, ${formatClock(remaining)} left. Click to stop.` : 'Start a focus session');
    chip.innerHTML = `
      <svg class="op-focus-ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle class="track" cx="9" cy="9" r="7"/>
        <circle class="bar" cx="9" cy="9" r="7" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - fraction)}"/>
      </svg>
      <span class="op-focus-label">${running ? 'Focus' : 'Focus'}</span>
      <span>${running ? formatClock(remaining) : `${prefs.focusMinutes}:00`}</span>`;
    document.title = running ? `⏱ ${formatClock(remaining)} · ${baseTitle}` : baseTitle;
  }

  function startFocusLoop() {
    clearInterval(focusTick);
    focusTick = setInterval(() => {
      if (!localStorage.getItem(FOCUS_KEY)) {
        clearInterval(focusTick);
        renderFocusChip();
        return;
      }
      if (focusRemaining() <= 0) {
        localStorage.removeItem(FOCUS_KEY);
        clearInterval(focusTick);
        renderFocusChip();
        chime();
        toast('Focus session complete — take a 5-minute break.', { duration: 8000 });
        return;
      }
      renderFocusChip();
    }, 1000);
  }

  function toggleFocus() {
    if (focusRemaining() > 0) {
      localStorage.removeItem(FOCUS_KEY);
      renderFocusChip();
      toast('Focus session stopped');
      return;
    }
    localStorage.setItem(FOCUS_KEY, String(Date.now() + prefs.focusMinutes * 60000));
    renderFocusChip();
    startFocusLoop();
    toast(`Focus session started — ${prefs.focusMinutes} minutes. Notifications stay quiet.`);
  }

  function chime() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(context.destination);
        const start = context.currentTime + index * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        oscillator.start(start);
        oscillator.stop(start + 0.4);
      });
    } catch (error) {
      // Audio is optional.
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation: titles, scroll reset
  // ---------------------------------------------------------------------------
  const originalNavigateTo = window.navigateTo;
  window.navigateTo = function (view) {
    originalNavigateTo(view);
    baseTitle = `${VIEW_LABELS[view] || 'Orbis'} · Orbis`;
    renderFocusChip();
    const content = qs('.content');
    if (content) {
      content.scrollTop = 0;
    }
    if (view === 'commitments') {
      renderCommitments();
    }
    updateBadges();
  };

  // ---------------------------------------------------------------------------
  // Today dashboard
  // ---------------------------------------------------------------------------
  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) {
      return 'Working late';
    }
    if (hour < 12) {
      return 'Good morning';
    }
    if (hour < 18) {
      return 'Good afternoon';
    }
    return 'Good evening';
  }

  function firstName() {
    try {
      const session = getSession();
      if (!session || session.guest || !session.name) {
        return '';
      }
      return session.name.trim().split(/\s+/)[0];
    } catch (error) {
      return '';
    }
  }

  function enhanceTodayHeader() {
    const header = qs('#today .view-header');
    if (!header || qs('.op-hero', header)) {
      return;
    }
    header.classList.add('op-hero');
    header.innerHTML = `
      <div>
        <div class="op-hero-eyebrow" id="opTodayDate"></div>
        <h1 class="view-title" id="today-title">Today</h1>
        <p class="view-intro" id="opTodayIntro">Messages that may need a reply, with reason and source.</p>
      </div>
      <div class="op-progress" id="opTodayProgress" role="img" aria-label="Triage progress"></div>`;
    const toolbar = document.createElement('div');
    toolbar.className = 'op-toolbar';
    toolbar.id = 'opTodayToolbar';
    qs('#todaySummary').after(toolbar);
  }

  function todayCounts() {
    const items = state.todayItems;
    const visible = items.filter((item) => !item.dismissed);
    return {
      all: visible.filter((item) => !item.committed).length,
      reply: visible.filter((item) => item.type === 'reply' && !item.committed && !item.snoozed).length,
      commitment: visible.filter((item) => item.type === 'commitment' && !item.committed && !item.snoozed).length,
      snoozed: visible.filter((item) => item.snoozed && !item.committed).length,
      done: visible.filter((item) => item.committed).length,
      handled: items.filter((item) => item.committed || item.dismissed).length,
      total: items.length
    };
  }

  function todayFiltered() {
    const filter = ui.todayFilter;
    return state.todayItems.filter((item) => {
      if (item.dismissed) {
        return false;
      }
      if (filter === 'done') {
        return item.committed;
      }
      if (item.committed) {
        return false;
      }
      if (filter === 'snoozed') {
        return item.snoozed;
      }
      if (filter === 'reply' || filter === 'commitment') {
        return item.type === filter && !item.snoozed;
      }
      return true;
    }).sort((a, b) => Number(!!a.snoozed) - Number(!!b.snoozed));
  }

  function renderTodayChrome() {
    const counts = todayCounts();
    const name = firstName();
    const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    qs('#opTodayDate').textContent = dateLabel;
    qs('#today-title').textContent = `${greeting()}${name ? ', ' + name : ''}`;
    const pending = counts.reply + counts.commitment;
    qs('#opTodayIntro').textContent = state.aiPaused
      ? 'AI suggestions are paused. Resume AI to see follow-ups.'
      : pending
        ? `You have ${pending} item${pending === 1 ? '' : 's'} to triage. Reasons and sources are always shown.`
        : 'You are all caught up. Nothing needs a reply right now.';

    const percent = counts.total ? Math.round((counts.handled / counts.total) * 100) : 100;
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    qs('#opTodayProgress').innerHTML = `
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle class="track" cx="22" cy="22" r="${radius}"/>
        <circle class="bar" cx="22" cy="22" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - percent / 100)}"/>
      </svg>
      <div class="op-progress-text"><strong>${percent}% triaged</strong><span>${counts.handled} of ${counts.total} handled</span></div>`;
    qs('#opTodayProgress').setAttribute('aria-label', `${percent}% triaged, ${counts.handled} of ${counts.total} handled`);

    const overdue = state.commitments.filter((c) => c.status === 'overdue').length;
    const drafts = (state.drafts || []).length;
    const strip = qs('#todaySummary');
    strip.classList.add('op-kpis');
    const kpi = (icon, tone, value, label, action) => `
      <button type="button" class="op-kpi" data-kpi="${action}">
        <span class="op-kpi-icon ${tone}">${svg(icon, 18)}</span>
        <span><span class="op-kpi-value">${value}</span><span class="op-kpi-label">${label}</span></span>
      </button>`;
    strip.innerHTML =
      kpi('reply', '', counts.reply, 'Need a reply', 'reply') +
      kpi('list', 'teal', counts.commitment, 'Commitments due', 'commitment') +
      kpi('draft', 'amber', drafts, 'Drafts ready', 'drafts') +
      kpi('alert', 'red', overdue, 'Overdue', 'overdue');
    qsa('[data-kpi]', strip).forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.kpi;
        if (action === 'drafts') {
          navigateTo('drafts');
        } else if (action === 'overdue') {
          ui.commitFilter = 'overdue';
          navigateTo('commitments');
        } else {
          ui.todayFilter = action;
          renderToday();
        }
      });
    });

    const segment = (key, label) =>
      `<button type="button" data-tf="${key}" aria-pressed="${ui.todayFilter === key}">${label}<span class="op-count">${counts[key]}</span></button>`;
    qs('#opTodayToolbar').innerHTML = `
      <div class="op-segmented" role="group" aria-label="Filter today">
        ${segment('all', 'All')}${segment('reply', 'Replies')}${segment('commitment', 'Commitments')}${segment('snoozed', 'Snoozed')}${segment('done', 'Done')}
      </div>
      <span class="op-hint"><span class="op-kbd">J</span><span class="op-kbd">K</span> move
        <span class="op-kbd">E</span> confirm <span class="op-kbd">S</span> snooze <span class="op-kbd">X</span> dismiss</span>`;
    qsa('[data-tf]', qs('#opTodayToolbar')).forEach((button) => {
      button.addEventListener('click', () => {
        ui.todayFilter = button.dataset.tf;
        ui.todaySelected = null;
        renderToday();
      });
    });
    qs('#opTodayToolbar').style.display = state.aiPaused ? 'none' : '';
  }

  function confidenceBadgeClass(confidence) {
    if (confidence.includes('Committed')) {
      return 'badge-established';
    }
    return confidence.includes('explicit') ? 'badge-proposed' : 'badge-validation';
  }

  window.renderToday = function () {
    const container = qs('#todayContent');
    renderTodayChrome();
    if (state.aiPaused) {
      container.innerHTML = `
        <div class="ai-paused-state card">
          ${svg('alert', 40)}
          <p><strong>AI paused</strong></p>
          <p style="font-size: 13px; margin-top: 8px;">AI-powered suggestions are disabled. Enable the AI kill switch to see follow-up recommendations.</p>
        </div>`;
      updateBadges();
      return;
    }
    const items = todayFiltered();
    if (!items.length) {
      const allClear = ui.todayFilter === 'all' || ui.todayFilter === 'reply' || ui.todayFilter === 'commitment';
      container.innerHTML = `
        <div class="op-empty">
          <div class="op-empty-icon">${svg(allClear ? 'party' : 'check', 28)}</div>
          <h3>${allClear ? 'Inbox zero — nice work' : 'Nothing here'}</h3>
          <p>${allClear ? 'Everything that needed a reply has been handled.' : 'No items match this filter.'}</p>
          ${ui.todayFilter !== 'all' ? '<button class="btn btn-secondary btn-sm" data-op-reset-filter>Show all</button>' : '<button class="btn btn-secondary btn-sm" data-op-go="commitments">Review commitments</button>'}
        </div>`;
      const reset = qs('[data-op-reset-filter]', container);
      if (reset) {
        reset.addEventListener('click', () => {
          ui.todayFilter = 'all';
          renderToday();
        });
      }
      const go = qs('[data-op-go]', container);
      if (go) {
        go.addEventListener('click', () => navigateTo(go.dataset.opGo));
      }
      updateBadges();
      return;
    }
    if (!items.some((item) => item.id === ui.todaySelected)) {
      ui.todaySelected = null;
    }
    container.innerHTML = items.map((item) => {
      const typeLabel = item.type === 'commitment' ? 'Commitment' : 'Reply';
      let actions;
      if (item.committed) {
        actions = `<div class="suggestion-actions"><span class="op-status done">Done</span>
          <button class="btn btn-ghost btn-sm" data-op-reopen="${item.id}">Reopen</button></div>`;
      } else if (item.snoozed) {
        actions = `<div class="suggestion-actions"><span class="op-status">Snoozed</span>
          <button class="btn btn-secondary btn-sm" data-op-unsnooze="${item.id}">Unsnooze</button>
          <button class="btn btn-ghost btn-sm" onclick="dismissToday(${item.id})">Dismiss</button></div>`;
      } else {
        actions = `<div class="suggestion-actions">
          <button class="btn btn-primary btn-sm" onclick="confirmToday(${item.id})" title="Confirm (E)">${svg('check', 14)}Confirm</button>
          <button class="btn btn-secondary btn-sm" onclick="openDraftModal(${item.id})" title="Reply (R)">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="snoozeToday(${item.id})" title="Snooze (S)">Snooze</button>
          <button class="btn btn-ghost btn-sm" data-op-dismiss="${item.id}" title="Dismiss (X)">Dismiss</button>
        </div>`;
      }
      return `
        <div class="card suggestion-card ${item.type === 'commitment' ? 'committed' : ''} ${item.snoozed ? 'snoozed' : ''} ${ui.todaySelected === item.id ? 'op-selected' : ''}" data-id="${item.id}" tabindex="-1">
          <div class="card-header">
            <div>
              <div class="card-title ${item.committed ? 'op-done-text' : ''}">${esc(item.subject)}</div>
              <div class="card-subtitle op-card-meta"><span class="op-type-pill">${typeLabel}</span>${item.hasDate ? 'Date stated in message' : 'No date stated'}</div>
            </div>
            <span class="badge ${confidenceBadgeClass(item.confidence)}">${esc(item.confidence)}</span>
          </div>
          <div style="font-size: 14px; margin-bottom: 8px;">${esc(item.reason)}</div>
          <span class="source-chip">${svg('doc', 14)}${esc(item.source)}</span>
          <div class="why-section">
            <button class="why-toggle" onclick="toggleWhy(${item.id})">${svg('alert', 14)}Why this?</button>
            <div class="why-content" id="why-${item.id}">
              <div class="reason-line"><strong>Reason:</strong> ${esc(item.reason)}</div>
              <div><strong>Source:</strong> ${esc(item.source)}</div>
            </div>
          </div>
          ${actions}
        </div>`;
    }).join('');

    qsa('[data-op-dismiss]', container).forEach((button) => {
      button.addEventListener('click', () => animateOut(Number(button.dataset.opDismiss), () => dismissToday(Number(button.dataset.opDismiss))));
    });
    qsa('[data-op-unsnooze]', container).forEach((button) => {
      button.addEventListener('click', () => setTodayFlag(Number(button.dataset.opUnsnooze), 'snoozed', false, 'Back in your queue'));
    });
    qsa('[data-op-reopen]', container).forEach((button) => {
      button.addEventListener('click', () => setTodayFlag(Number(button.dataset.opReopen), 'committed', false, 'Reopened'));
    });
    qsa('.suggestion-card', container).forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('button')) {
          return;
        }
        selectTodayCard(Number(card.dataset.id));
      });
    });
    updateBadges();
  };

  function setTodayFlag(id, flag, value, message) {
    const item = state.todayItems.find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    const snap = snapshot(['todayItems']);
    item[flag] = value;
    renderToday();
    persist('queue');
    toast(message, { undo: () => restore(snap) });
  }

  function animateOut(id, done) {
    const card = qs(`#todayContent .suggestion-card[data-id="${id}"]`);
    if (!card || prefs.reduceMotion) {
      done();
      return;
    }
    card.classList.add('op-leaving');
    setTimeout(done, 240);
  }

  function selectTodayCard(id) {
    ui.todaySelected = id;
    qsa('#todayContent .suggestion-card').forEach((card) => {
      card.classList.toggle('op-selected', Number(card.dataset.id) === id);
    });
    const card = qs(`#todayContent .suggestion-card[data-id="${id}"]`);
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: prefs.reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function moveTodaySelection(step) {
    const ids = qsa('#todayContent .suggestion-card').map((card) => Number(card.dataset.id));
    if (!ids.length) {
      return;
    }
    const index = ids.indexOf(ui.todaySelected);
    const next = index === -1 ? (step > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, index + step));
    selectTodayCard(ids[next]);
  }

  function actOnSelectedToday(action) {
    const id = ui.todaySelected;
    const item = state.todayItems.find((entry) => entry.id === id);
    if (!item) {
      moveTodaySelection(1);
      return;
    }
    const ids = qsa('#todayContent .suggestion-card').map((card) => Number(card.dataset.id));
    const nextId = ids[ids.indexOf(id) + 1] || ids[ids.indexOf(id) - 1] || null;
    const advance = () => {
      if (!qs(`#todayContent .suggestion-card[data-id="${id}"]`) && nextId) {
        selectTodayCard(nextId);
      }
    };
    if (action === 'confirm' && !item.committed && !item.snoozed) {
      confirmToday(id);
      advance();
    } else if (action === 'snooze' && !item.snoozed && !item.committed) {
      snoozeToday(id);
      advance();
    } else if (action === 'dismiss') {
      animateOut(id, () => {
        dismissToday(id);
        if (nextId) {
          selectTodayCard(nextId);
        }
      });
    } else if (action === 'why') {
      toggleWhy(id);
    } else if (action === 'reply' && !item.committed) {
      openDraftModal(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Commitments: toolbar, filters, sort, bulk, board, quick add
  // ---------------------------------------------------------------------------
  const STATUS_ORDER = { overdue: 0, open: 1, done: 2 };
  const CONFIDENCE_ORDER = { established: 0, proposed: 1, validation: 2 };

  function enhanceCommitments() {
    const section = qs('#commitments');
    const chips = qs('#commitments .filter-chips');
    const table = qs('#commitments .commitments-table');
    if (!section || !chips || !table || qs('.op-commit-toolbar', section)) {
      return;
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'op-commit-toolbar';
    chips.before(toolbar);
    toolbar.appendChild(chips);
    toolbar.insertAdjacentHTML('beforeend', `
      <input type="search" class="op-input" id="opCommitSearch" placeholder="Filter commitments…" aria-label="Filter commitments">
      <span class="op-spacer"></span>
      <div class="op-segmented" role="group" aria-label="Layout">
        <button type="button" data-cv="list" title="List view (V)">${svg('rows', 15)}List</button>
        <button type="button" data-cv="board" title="Board view (V)">${svg('board', 15)}Board</button>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="opNewCommitment" title="New commitment (N)">${svg('plus', 15)}New</button>`);

    qsa('.filter-chip', chips).forEach((chip) => {
      chip.addEventListener('click', () => {
        ui.commitFilter = chip.dataset.filter;
        ui.commitSelected.clear();
        renderCommitments();
      });
    });
    qs('#opCommitSearch').addEventListener('input', (event) => {
      ui.commitQuery = event.target.value;
      renderCommitments();
    });
    qsa('[data-cv]', toolbar).forEach((button) => {
      button.addEventListener('click', () => {
        prefs.commitView = button.dataset.cv;
        savePrefs();
        renderCommitments();
      });
    });
    qs('#opNewCommitment').addEventListener('click', openNewCommitment);

    const columns = [
      ['check', ''], ['text', 'Commitment'], ['with', 'With'], ['date', 'Stated date'],
      ['status', 'Status'], ['confidence', 'Confidence'], ['actions', '']
    ];
    qs('thead', table).innerHTML = `<tr>${columns.map(([key, label]) => {
      if (key === 'check') {
        return '<th class="op-check"><input type="checkbox" class="op-checkbox" id="opCheckAll" aria-label="Select all"></th>';
      }
      if (key === 'actions') {
        return '<th style="text-align:right">Source</th>';
      }
      return `<th class="op-sortable" data-sort="${key}" scope="col" tabindex="0">${label}<span class="op-sort">▲▼</span></th>`;
    }).join('')}</tr>`;
    qsa('th[data-sort]', table).forEach((th) => {
      const sort = () => {
        const key = th.dataset.sort;
        ui.commitSort = ui.commitSort.key === key
          ? { key, dir: -ui.commitSort.dir }
          : { key, dir: 1 };
        renderCommitments();
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          sort();
        }
      });
    });
    qs('#opCheckAll').addEventListener('change', (event) => {
      const visible = filteredCommitments();
      if (event.target.checked) {
        visible.forEach((c) => ui.commitSelected.add(c.id));
      } else {
        ui.commitSelected.clear();
      }
      renderCommitments();
    });

    const board = document.createElement('div');
    board.className = 'op-board';
    board.id = 'opBoard';
    board.hidden = true;
    table.after(board);

    const tbody = qs('#commitmentsBody');
    tbody.addEventListener('change', (event) => {
      const box = event.target.closest('[data-select]');
      if (!box) {
        return;
      }
      const id = Number(box.dataset.select);
      if (box.checked) {
        ui.commitSelected.add(id);
      } else {
        ui.commitSelected.delete(id);
      }
      renderCommitments();
    });
    section.addEventListener('click', (event) => {
      const sourceButton = event.target.closest('[data-source]');
      if (sourceButton) {
        const c = state.commitments.find((entry) => entry.id === Number(sourceButton.dataset.source));
        if (c) {
          openSourceDrawer(c.source, c.text);
        }
      }
      const deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        deleteCommitments([Number(deleteButton.dataset.delete)]);
      }
    });

    buildBulkBar();
  }

  function filteredCommitments() {
    const query = ui.commitQuery.trim().toLowerCase();
    let list = state.commitments.filter((c) => {
      if (ui.commitFilter !== 'all' && c.status !== ui.commitFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [c.text, c.with, c.source, c.status, c.confidence].join(' ').toLowerCase().includes(query);
    });
    const { key, dir } = ui.commitSort;
    if (key) {
      const value = (c) => {
        if (key === 'status') {
          return STATUS_ORDER[c.status] ?? 9;
        }
        if (key === 'confidence') {
          return CONFIDENCE_ORDER[c.confidence] ?? 9;
        }
        if (key === 'date') {
          return /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date : '9999';
        }
        return String(c[key] || '').toLowerCase();
      };
      list = list.slice().sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * dir);
    }
    return list;
  }

  function statusMenu(c) {
    return `
      <div class="status-menu">
        <button class="status-menu-btn op-status ${esc(c.status)}" onclick="toggleStatusDropdown(${c.id})" aria-haspopup="menu">${esc(c.status)} ▾</button>
        <div class="status-dropdown" id="status-${c.id}" role="menu">
          <button role="menuitem" onclick="updateCommitmentStatus(${c.id}, 'open')">Open</button>
          <button role="menuitem" onclick="updateCommitmentStatus(${c.id}, 'done')">Done</button>
          <button role="menuitem" onclick="updateCommitmentStatus(${c.id}, 'overdue')">Overdue</button>
        </div>
      </div>`;
  }

  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `<span style="color:var(--muted)">${esc(value)}</span><br><span style="font-size: 11px; color: var(--muted);">Dates are used only when stated.</span>`;
    }
    const date = new Date(value + 'T00:00:00');
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  window.renderCommitments = function (filter) {
    if (typeof filter === 'string' && filter) {
      ui.commitFilter = filter;
    }
    const tbody = qs('#commitmentsBody');
    if (!tbody) {
      return;
    }
    if (!qs('.op-commit-toolbar')) {
      enhanceCommitments();
    }
    const counts = { all: state.commitments.length, open: 0, done: 0, overdue: 0 };
    state.commitments.forEach((c) => {
      counts[c.status] = (counts[c.status] || 0) + 1;
    });
    qsa('#commitments .filter-chip').forEach((chip) => {
      const key = chip.dataset.filter;
      const label = { all: 'All', open: 'Open', done: 'Done', overdue: 'Overdue' }[key] || key;
      chip.classList.toggle('active', key === ui.commitFilter);
      chip.setAttribute('aria-pressed', String(key === ui.commitFilter));
      chip.innerHTML = `${label}<span class="op-count">${counts[key] || 0}</span>`;
    });
    qsa('#commitments [data-cv]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.cv === prefs.commitView));
    });
    qsa('#commitments th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === ui.commitSort.key;
      th.classList.toggle('op-sorted', active);
      th.setAttribute('aria-sort', active ? (ui.commitSort.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.op-sort').textContent = active ? (ui.commitSort.dir > 0 ? '▲' : '▼') : '▲▼';
    });
    const search = qs('#opCommitSearch');
    if (search && search.value !== ui.commitQuery) {
      search.value = ui.commitQuery;
    }

    const list = filteredCommitments();
    const table = qs('#commitments .commitments-table');
    const board = qs('#opBoard');
    const isBoard = prefs.commitView === 'board';
    table.hidden = isBoard;
    board.hidden = !isBoard;

    // Drop selections that are no longer visible.
    const visibleIds = new Set(list.map((c) => c.id));
    Array.from(ui.commitSelected).forEach((id) => {
      if (!visibleIds.has(id)) {
        ui.commitSelected.delete(id);
      }
    });

    if (isBoard) {
      renderBoard(list);
    } else if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="op-empty" style="border:0">
        <div class="op-empty-icon">${svg('search', 26)}</div><h3>No commitments found</h3>
        <p>Try another filter, or add one with <span class="op-kbd">N</span>.</p></div></td></tr>`;
    } else {
      tbody.innerHTML = list.map((c) => `
        <tr class="${ui.commitSelected.has(c.id) ? 'op-row-selected' : ''}">
          <td class="op-check"><input type="checkbox" class="op-checkbox" data-select="${c.id}" ${ui.commitSelected.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.text)}"></td>
          <td class="${c.status === 'done' ? 'op-done-text' : ''}" style="font-weight:500">${esc(c.text)}</td>
          <td>${esc(c.with)}</td>
          <td>${formatDate(c.date)}</td>
          <td>${statusMenu(c)}</td>
          <td><span class="badge badge-${esc(c.confidence)}">${esc(c.confidence)}</span></td>
          <td style="text-align:right; white-space:nowrap">
            <button class="btn btn-ghost btn-sm" data-source="${c.id}">View source →</button>
            <button class="btn btn-ghost btn-sm" data-delete="${c.id}" aria-label="Delete commitment" title="Delete">${svg('trash', 15)}</button>
          </td>
        </tr>`).join('');
    }
    const checkAll = qs('#opCheckAll');
    if (checkAll) {
      checkAll.checked = list.length > 0 && list.every((c) => ui.commitSelected.has(c.id));
      checkAll.indeterminate = !checkAll.checked && list.some((c) => ui.commitSelected.has(c.id));
    }
    renderBulkBar();
    updateBadges();
  };

  function renderBoard(list) {
    const board = qs('#opBoard');
    const columns = [['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Done']];
    board.innerHTML = columns.map(([status, label]) => {
      const cards = list.filter((c) => c.status === status);
      return `
        <div class="op-col" data-col="${status}" aria-label="${label} column">
          <div class="op-col-head"><span class="op-status ${status}">${label}</span><span class="op-badge">${cards.length}</span></div>
          ${cards.map((c) => `
            <div class="op-board-card" draggable="true" data-card="${c.id}">
              <div class="op-board-card-title ${c.status === 'done' ? 'op-done-text' : ''}">${esc(c.text)}</div>
              <div class="op-board-card-meta">
                <span>${esc(c.with)}</span>
                <span>· ${/^\d{4}-\d{2}-\d{2}$/.test(c.date) ? esc(c.date) : 'no date'}</span>
                <span class="badge badge-${esc(c.confidence)}" style="margin-left:auto">${esc(c.confidence)}</span>
              </div>
              <div class="op-board-card-meta" style="margin-top:8px">
                <label class="visually-hidden" for="opMove${c.id}">Move to</label>
                <select id="opMove${c.id}" data-move="${c.id}" class="op-status" style="border:1px solid var(--line);cursor:pointer">
                  ${columns.map(([value, text]) => `<option value="${value}" ${value === c.status ? 'selected' : ''}>${text}</option>`).join('')}
                </select>
                <button class="btn btn-ghost btn-sm" data-source="${c.id}" style="margin-left:auto">Source</button>
              </div>
            </div>`).join('') || '<div class="op-board-card-meta" style="padding:12px 6px">Drop here</div>'}
        </div>`;
    }).join('');

    qsa('.op-board-card', board).forEach((card) => {
      card.addEventListener('dragstart', (event) => {
        card.classList.add('op-dragging');
        event.dataTransfer.setData('text/plain', card.dataset.card);
        event.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => card.classList.remove('op-dragging'));
    });
    qsa('.op-col', board).forEach((column) => {
      column.addEventListener('dragover', (event) => {
        event.preventDefault();
        column.classList.add('op-drop');
      });
      column.addEventListener('dragleave', () => column.classList.remove('op-drop'));
      column.addEventListener('drop', (event) => {
        event.preventDefault();
        column.classList.remove('op-drop');
        const id = Number(event.dataTransfer.getData('text/plain'));
        const c = state.commitments.find((entry) => entry.id === id);
        if (c && c.status !== column.dataset.col) {
          updateCommitmentStatus(id, column.dataset.col);
        }
      });
    });
    qsa('[data-move]', board).forEach((select) => {
      select.addEventListener('change', () => updateCommitmentStatus(Number(select.dataset.move), select.value));
    });
  }

  function buildBulkBar() {
    const bar = document.createElement('div');
    bar.className = 'op-bulkbar';
    bar.id = 'opBulkBar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Bulk actions');
    bar.innerHTML = `
      <span id="opBulkCount"></span>
      <button type="button" data-bulk="done">Mark done</button>
      <button type="button" data-bulk="open">Mark open</button>
      <button type="button" data-bulk="delete" class="danger">Delete</button>
      <button type="button" data-bulk="clear" aria-label="Clear selection">✕</button>`;
    document.body.appendChild(bar);
    qsa('[data-bulk]', bar).forEach((button) => {
      button.addEventListener('click', () => {
        const ids = Array.from(ui.commitSelected);
        const action = button.dataset.bulk;
        if (action === 'clear') {
          ui.commitSelected.clear();
          renderCommitments();
          return;
        }
        if (action === 'delete') {
          deleteCommitments(ids);
          return;
        }
        const snap = snapshot(['commitments']);
        state.commitments.forEach((c) => {
          if (ui.commitSelected.has(c.id)) {
            c.status = action;
          }
        });
        ui.commitSelected.clear();
        renderCommitments();
        persist('commitments');
        toast(`${ids.length} commitment${ids.length === 1 ? '' : 's'} marked ${action}`, { undo: () => restore(snap) });
      });
    });
  }

  function renderBulkBar() {
    const bar = qs('#opBulkBar');
    if (!bar) {
      return;
    }
    const count = ui.commitSelected.size;
    const show = count > 0 && state.currentView === 'commitments' && prefs.commitView === 'list';
    bar.classList.toggle('show', show);
    qs('#opBulkCount').textContent = `${count} selected`;
  }

  function deleteCommitments(ids) {
    if (!ids.length) {
      return;
    }
    const snap = snapshot(['commitments']);
    state.commitments = state.commitments.filter((c) => !ids.includes(c.id));
    ids.forEach((id) => ui.commitSelected.delete(id));
    renderCommitments();
    persist('commitments');
    toast(`${ids.length === 1 ? 'Commitment' : ids.length + ' commitments'} deleted`, { undo: () => restore(snap) });
  }

  // Quick-add dialog
  function buildNewCommitmentDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'op-overlay';
    overlay.id = 'opNewCommit';
    overlay.innerHTML = `
      <form class="op-panel" style="max-width:520px" role="dialog" aria-modal="true" aria-labelledby="opNewCommitTitle" novalidate>
        <div class="op-sheet-head">
          <h2 id="opNewCommitTitle">New commitment</h2>
          <button type="button" class="op-close" data-close aria-label="Close">×</button>
        </div>
        <div class="op-sheet-body">
          <div class="op-field">
            <label for="opNcText">What did you commit to?</label>
            <input id="opNcText" required maxlength="200" placeholder="e.g. Send the signed contract to Northwind" autocomplete="off">
          </div>
          <div class="op-field-row">
            <div class="op-field">
              <label for="opNcWith">With</label>
              <input id="opNcWith" maxlength="120" placeholder="Person, team or client" autocomplete="off">
            </div>
            <div class="op-field">
              <label for="opNcDate">Stated date <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
              <input id="opNcDate" type="date">
            </div>
          </div>
          <div class="op-field-row">
            <div class="op-field">
              <label for="opNcConfidence">Confidence</label>
              <select id="opNcConfidence">
                <option value="established">Established</option>
                <option value="proposed">Proposed</option>
                <option value="validation">Needs validation</option>
              </select>
            </div>
            <div class="op-field">
              <label for="opNcStatus">Status</label>
              <select id="opNcStatus">
                <option value="open">Open</option>
                <option value="overdue">Overdue</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>
          <p class="op-field-help">Dates are only stored when you state one — Orbis never guesses deadlines.</p>
        </div>
        <div class="op-sheet-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${svg('plus', 15)}Add commitment <span class="op-kbd" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.4)">${MOD_LABEL}↵</span></button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-close]')) {
        closeOverlay(overlay);
      }
    });
    const form = qs('form', overlay);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveNewCommitment();
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveNewCommitment();
      }
    });
  }

  function openNewCommitment() {
    const overlay = qs('#opNewCommit');
    qs('#opNcText').value = '';
    qs('#opNcWith').value = '';
    qs('#opNcDate').value = '';
    qs('#opNcConfidence').value = 'established';
    qs('#opNcStatus').value = 'open';
    qs('#opNcText').style.borderColor = '';
    openOverlay(overlay);
    setTimeout(() => qs('#opNcText').focus(), 30);
  }

  function saveNewCommitment() {
    const textInput = qs('#opNcText');
    const text = textInput.value.trim();
    if (!text) {
      textInput.style.borderColor = 'var(--danger)';
      textInput.focus();
      return;
    }
    const nextId = state.commitments.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const snap = snapshot(['commitments']);
    state.commitments.unshift({
      id: nextId,
      text,
      with: qs('#opNcWith').value.trim() || '—',
      date: qs('#opNcDate').value || '— not stated',
      status: qs('#opNcStatus').value,
      confidence: qs('#opNcConfidence').value,
      source: `Added manually · ${today}`
    });
    closeOverlay(qs('#opNewCommit'));
    persist('commitments');
    if (state.currentView !== 'commitments') {
      navigateTo('commitments');
    } else {
      renderCommitments();
    }
    toast('Commitment added', { undo: () => restore(snap) });
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers (focus return + Escape)
  // ---------------------------------------------------------------------------
  let lastFocus = null;

  function openOverlay(overlay) {
    lastFocus = document.activeElement;
    overlay.classList.add('show');
  }

  function closeOverlay(overlay) {
    overlay.classList.remove('show');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  function anyOverlayOpen() {
    return !!qs('.op-overlay.show');
  }

  // ---------------------------------------------------------------------------
  // Command palette
  // ---------------------------------------------------------------------------
  let paletteItems = [];
  let paletteActive = 0;

  function buildPalette() {
    const overlay = document.createElement('div');
    overlay.className = 'op-overlay';
    overlay.id = 'opPalette';
    overlay.innerHTML = `
      <div class="op-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="op-palette-input-wrap">
          ${svg('search', 18)}
          <input class="op-palette-input" id="opPaletteInput" placeholder="Search views, actions, commitments, drafts…" autocomplete="off" spellcheck="false"
                 role="combobox" aria-expanded="true" aria-controls="opPaletteList" aria-autocomplete="list">
          <span class="op-kbd">Esc</span>
        </div>
        <div class="op-palette-list" id="opPaletteList" role="listbox"></div>
        <div class="op-palette-foot">
          <span><span class="op-kbd">↑</span><span class="op-kbd">↓</span> navigate</span>
          <span><span class="op-kbd">↵</span> open</span>
          <span><span class="op-kbd">?</span> all shortcuts</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeOverlay(overlay);
      }
    });
    const input = qs('#opPaletteInput');
    input.addEventListener('input', () => renderPalette(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        paletteActive = (paletteActive + step + paletteItems.length) % Math.max(1, paletteItems.length);
        highlightPalette();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runPaletteItem(paletteItems[paletteActive]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeOverlay(overlay);
      }
    });
  }

  function paletteSource() {
    const items = [];
    Object.keys(VIEW_LABELS).forEach((view) => {
      const key = VIEW_GO_KEY[view];
      items.push({
        group: 'Go to',
        icon: 'compass',
        title: VIEW_LABELS[view],
        sub: '',
        keywords: `go open view ${view}`,
        keys: key ? ['G', key.toUpperCase()] : [],
        run: () => navigateTo(view)
      });
    });
    const focusRunning = focusRemaining() > 0;
    items.push(
      { group: 'Actions', icon: 'plus', title: 'New commitment', keywords: 'add create task promise', keys: ['N'], run: openNewCommitment },
      { group: 'Actions', icon: 'moon', title: state.darkMode ? 'Switch to light mode' : 'Switch to dark mode', keywords: 'theme dark light appearance', keys: [], run: () => setThemeMode(state.darkMode ? 'light' : 'dark') },
      { group: 'Actions', icon: 'bolt', title: state.aiPaused ? 'Resume AI suggestions' : 'Pause AI (kill switch)', keywords: 'ai kill switch pause resume privacy', keys: [], run: () => qs('#killSwitch') && qs('#killSwitch').click() },
      { group: 'Actions', icon: 'bell', title: state.quietHours ? 'Turn quiet hours off' : 'Turn quiet hours on', keywords: 'notifications quiet do not disturb', keys: [], run: () => qs('#quietHoursToggle') && qs('#quietHoursToggle').click() },
      { group: 'Actions', icon: 'timer', title: focusRunning ? 'Stop focus session' : `Start ${prefs.focusMinutes}-minute focus session`, keywords: 'pomodoro focus timer deep work', keys: ['F'], run: toggleFocus },
      { group: 'Actions', icon: 'sidebar', title: prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', keywords: 'sidebar navigation rail', keys: ['['], run: toggleSidebar },
      { group: 'Actions', icon: 'rows', title: prefs.density === 'compact' ? 'Comfortable density' : 'Compact density', keywords: 'density compact spacing', keys: [], run: () => setDensity(prefs.density === 'compact' ? 'comfortable' : 'compact') },
      { group: 'Actions', icon: 'palette', title: 'Appearance settings…', keywords: 'theme accent colour color density motion', keys: [], run: () => setTimeout(toggleAppearance, 0) },
      { group: 'Actions', icon: 'keyboard', title: 'Keyboard shortcuts', keywords: 'help keys hotkeys', keys: ['?'], run: openShortcuts },
      { group: 'Actions', icon: 'compass', title: 'Take the product tour', keywords: 'onboarding tour help guide', keys: [], run: () => typeof openTour === 'function' && openTour(false) },
      { group: 'Actions', icon: 'download', title: 'Export my data (JSON)', keywords: 'export download backup privacy', keys: [], run: exportData },
      { group: 'Actions', icon: 'logout', title: 'Sign out', keywords: 'logout account', keys: [], run: () => typeof signOut === 'function' && signOut() }
    );
    ACCENTS.forEach(([name]) => {
      items.push({
        group: 'Actions', icon: 'palette', title: `Accent colour: ${name[0].toUpperCase() + name.slice(1)}`,
        keywords: 'accent colour color theme brand', keys: [], hidden: true, run: () => setAccent(name)
      });
    });
    state.todayItems.filter((item) => !item.dismissed).forEach((item) => {
      items.push({
        group: 'Today', icon: item.type === 'commitment' ? 'list' : 'reply', title: item.subject, sub: item.reason,
        keywords: `${item.source} ${item.confidence}`, keys: [], hidden: true,
        run: () => {
          ui.todayFilter = item.committed ? 'done' : item.snoozed ? 'snoozed' : 'all';
          navigateTo('today');
          renderToday();
          selectTodayCard(item.id);
        }
      });
    });
    state.commitments.forEach((c) => {
      items.push({
        group: 'Commitments', icon: 'list', title: c.text, sub: `${c.with} · ${c.status}${/^\d{4}/.test(c.date) ? ' · ' + c.date : ''}`,
        keywords: `${c.source} ${c.confidence}`, keys: [], hidden: true,
        run: () => {
          ui.commitFilter = 'all';
          ui.commitQuery = c.text;
          navigateTo('commitments');
        }
      });
    });
    (state.drafts || []).forEach((d) => {
      items.push({
        group: 'Drafts', icon: 'draft', title: `To ${d.recipient}`, sub: d.subject,
        keywords: d.text, keys: [], hidden: true,
        run: () => {
          navigateTo('drafts');
          setTimeout(() => {
            const card = qs(`#draftsContent .draft-card[data-id="${d.id}"]`);
            if (card) {
              card.scrollIntoView({ block: 'center', behavior: 'smooth' });
              card.classList.add('op-selected');
              card.style.boxShadow = 'var(--ring), var(--shadow)';
              setTimeout(() => {
                card.style.boxShadow = '';
              }, 1600);
            }
          }, 60);
        }
      });
    });
    (state.summaries || []).forEach((s) => {
      items.push({
        group: 'Summaries', icon: 'doc', title: s.title, sub: `${s.participants || ''} · ${s.date || ''}`,
        keywords: s.mainTopic || '', keys: [], hidden: true, run: () => navigateTo('summaries')
      });
    });
    return items;
  }

  // Fuzzy matcher: substring matches score highest, then in-order subsequences.
  function fuzzy(text, query) {
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    const index = haystack.indexOf(needle);
    if (index !== -1) {
      return { score: 100 - index + (index === 0 ? 50 : 0), ranges: [[index, index + needle.length]] };
    }
    const ranges = [];
    let position = 0;
    let gaps = 0;
    for (const char of needle) {
      if (char === ' ') {
        continue;
      }
      const found = haystack.indexOf(char, position);
      if (found === -1) {
        return null;
      }
      gaps += found - position;
      ranges.push([found, found + 1]);
      position = found + 1;
    }
    return { score: Math.max(1, 40 - gaps), ranges };
  }

  function highlight(text, ranges) {
    if (!ranges || !ranges.length) {
      return esc(text);
    }
    let output = '';
    let cursor = 0;
    ranges.forEach(([start, end]) => {
      output += esc(text.slice(cursor, start)) + '<mark>' + esc(text.slice(start, end)) + '</mark>';
      cursor = end;
    });
    return output + esc(text.slice(cursor));
  }

  function renderPalette(query) {
    const list = qs('#opPaletteList');
    const source = paletteSource();
    const trimmed = query.trim();
    let results;
    if (!trimmed) {
      results = source.filter((item) => !item.hidden).map((item) => ({ item, score: 0, ranges: null }));
    } else {
      results = source.map((item) => {
        const titleMatch = fuzzy(item.title, trimmed);
        if (titleMatch) {
          return { item, score: titleMatch.score + (item.group === 'Go to' ? 15 : 0), ranges: titleMatch.ranges };
        }
        const extra = fuzzy(`${item.sub || ''} ${item.keywords || ''}`, trimmed);
        if (extra && extra.score > 20) {
          return { item, score: extra.score / 3, ranges: null };
        }
        return null;
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 40);
    }
    const groupOrder = ['Go to', 'Actions', 'Today', 'Commitments', 'Drafts', 'Summaries'];
    if (trimmed) {
      // Keep the best match first but still group visually.
      const firstGroup = results.length ? results[0].item.group : null;
      groupOrder.sort((a, b) => (a === firstGroup ? -1 : b === firstGroup ? 1 : 0));
    }
    paletteItems = [];
    let html = '';
    groupOrder.forEach((group) => {
      const inGroup = results.filter((result) => result.item.group === group);
      if (!inGroup.length) {
        return;
      }
      html += `<div class="op-palette-group">${group}</div>`;
      inGroup.forEach((result) => {
        const index = paletteItems.length;
        paletteItems.push(result.item);
        html += `
          <button type="button" class="op-palette-item" role="option" data-index="${index}" id="opPi${index}">
            <span class="op-pi-icon">${svg(result.item.icon, 16)}</span>
            <span class="op-pi-text">
              <div class="op-pi-title">${highlight(result.item.title, result.ranges)}</div>
              ${result.item.sub ? `<div class="op-pi-sub">${esc(result.item.sub)}</div>` : ''}
            </span>
            ${(result.item.keys || []).map((key) => `<span class="op-kbd">${esc(key)}</span>`).join('')}
          </button>`;
      });
    });
    list.innerHTML = html || `<div class="op-palette-empty">No results for “${esc(trimmed)}”</div>`;
    paletteActive = 0;
    highlightPalette();
    qsa('.op-palette-item', list).forEach((button) => {
      button.addEventListener('mousemove', () => {
        if (paletteActive !== Number(button.dataset.index)) {
          paletteActive = Number(button.dataset.index);
          highlightPalette(false);
        }
      });
      button.addEventListener('click', () => runPaletteItem(paletteItems[Number(button.dataset.index)]));
    });
  }

  function highlightPalette(scroll = true) {
    qsa('#opPaletteList .op-palette-item').forEach((button) => {
      const active = Number(button.dataset.index) === paletteActive;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      if (active && scroll) {
        button.scrollIntoView({ block: 'nearest' });
      }
    });
    qs('#opPaletteInput').setAttribute('aria-activedescendant', `opPi${paletteActive}`);
  }

  function runPaletteItem(item) {
    if (!item) {
      return;
    }
    const overlay = qs('#opPalette');
    overlay.classList.remove('show');
    lastFocus = null;
    item.run();
  }

  function openPalette(initial = '') {
    const overlay = qs('#opPalette');
    closeAppearance();
    openOverlay(overlay);
    const input = qs('#opPaletteInput');
    input.value = initial;
    renderPalette(initial);
    setTimeout(() => input.focus(), 20);
  }

  function exportData() {
    const data = typeof buildStateSnapshot === 'function' ? buildStateSnapshot() : state;
    if (typeof downloadJson === 'function') {
      downloadJson(data, 'orbis-export.json');
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'orbis-export.json';
      link.click();
      URL.revokeObjectURL(link.href);
    }
    toast('Export downloaded');
  }

  // ---------------------------------------------------------------------------
  // Shortcut sheet
  // ---------------------------------------------------------------------------
  function buildShortcuts() {
    const overlay = document.createElement('div');
    overlay.className = 'op-overlay';
    overlay.id = 'opShortcuts';
    const row = (label, keys) => `<div class="op-shortcut-row"><span>${label}</span><span>${keys.map((key) => `<span class="op-kbd">${key}</span>`).join('')}</span></div>`;
    overlay.innerHTML = `
      <div class="op-panel" style="max-width:720px" role="dialog" aria-modal="true" aria-labelledby="opShortcutsTitle">
        <div class="op-sheet-head">
          <h2 id="opShortcutsTitle">Keyboard shortcuts</h2>
          <button type="button" class="op-close" data-close aria-label="Close">×</button>
        </div>
        <div class="op-sheet-body">
          <div class="op-shortcuts">
            <h3>General</h3>
            ${row('Command palette', [MOD_LABEL, 'K'])}
            ${row('Search', ['/'])}
            ${row('New commitment', ['N'])}
            ${row('Focus session', ['F'])}
            ${row('Toggle sidebar', ['['])}
            ${row('This help', ['?'])}
            <h3>Go to</h3>
            ${Object.entries(GO_KEYS).map(([key, view]) => row(VIEW_LABELS[view] || view, ['G', key.toUpperCase()])).join('')}
            <h3>Today triage</h3>
            ${row('Next / previous item', ['J', 'K'])}
            ${row('Confirm', ['E'])}
            ${row('Snooze', ['S'])}
            ${row('Dismiss', ['X'])}
            ${row('Reply / edit', ['R'])}
            ${row('Why this?', ['W'])}
            <h3>Commitments</h3>
            ${row('Switch list / board', ['V'])}
            ${row('Save new commitment', [MOD_LABEL, '↵'])}
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-close]')) {
        closeOverlay(overlay);
      }
    });
  }

  function openShortcuts() {
    const overlay = qs('#opShortcuts');
    openOverlay(overlay);
    setTimeout(() => qs('[data-close]', overlay).focus(), 20);
  }

  // ---------------------------------------------------------------------------
  // Global keyboard handling
  // ---------------------------------------------------------------------------
  let goPending = false;
  let goTimer = null;

  function isTyping(target) {
    if (!target) {
      return false;
    }
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function appBlocked() {
    const gate = qs('#authGate');
    if (gate && gate.classList.contains('show')) {
      return true;
    }
    if (typeof tourState !== 'undefined' && tourState.isOpen) {
      return true;
    }
    return !!qs('.modal-overlay.show') || !!qs('.drawer.show');
  }

  document.addEventListener('keydown', (event) => {
    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'k') {
      const gate = qs('#authGate');
      if (gate && gate.classList.contains('show')) {
        return;
      }
      event.preventDefault();
      const palette = qs('#opPalette');
      if (palette.classList.contains('show')) {
        closeOverlay(palette);
      } else {
        qsa('.op-overlay.show').forEach((overlay) => overlay.classList.remove('show'));
        openPalette();
      }
      return;
    }

    if (key === 'Escape') {
      const open = qsa('.op-overlay.show');
      if (open.length) {
        event.preventDefault();
        closeOverlay(open[open.length - 1]);
        return;
      }
      closeAppearance();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isTyping(event.target) || anyOverlayOpen() || appBlocked()) {
      return;
    }

    if (goPending) {
      goPending = false;
      clearTimeout(goTimer);
      const view = GO_KEYS[key.toLowerCase()];
      if (view) {
        event.preventDefault();
        navigateTo(view);
      }
      return;
    }

    switch (key) {
      case 'g':
      case 'G':
        goPending = true;
        goTimer = setTimeout(() => {
          goPending = false;
        }, 1200);
        return;
      case '?':
        event.preventDefault();
        openShortcuts();
        return;
      case 'n':
      case 'N':
        event.preventDefault();
        openNewCommitment();
        return;
      case '[':
        event.preventDefault();
        toggleSidebar();
        return;
      case 'f':
      case 'F':
        event.preventDefault();
        toggleFocus();
        return;
      default:
        break;
    }

    if (state.currentView === 'today' && !state.aiPaused) {
      const todayKeys = {
        j: () => moveTodaySelection(1),
        ArrowDown: () => moveTodaySelection(1),
        k: () => moveTodaySelection(-1),
        ArrowUp: () => moveTodaySelection(-1),
        e: () => actOnSelectedToday('confirm'),
        Enter: () => actOnSelectedToday('confirm'),
        s: () => actOnSelectedToday('snooze'),
        x: () => actOnSelectedToday('dismiss'),
        Delete: () => actOnSelectedToday('dismiss'),
        w: () => actOnSelectedToday('why'),
        r: () => actOnSelectedToday('reply')
      };
      const handler = todayKeys[key];
      if (handler && (ui.todaySelected !== null || ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(key))) {
        if (key === 'Enter' && event.target.closest && event.target.closest('button, a')) {
          return;
        }
        event.preventDefault();
        handler();
      }
      return;
    }

    if (state.currentView === 'commitments' && (key === 'v' || key === 'V')) {
      event.preventDefault();
      prefs.commitView = prefs.commitView === 'board' ? 'list' : 'board';
      savePrefs();
      renderCommitments();
    }
  });

  // Close status dropdowns when clicking elsewhere (small UX fix).
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.status-menu')) {
      qsa('.status-dropdown.show').forEach((dropdown) => dropdown.classList.remove('show'));
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  applyAppearance();
  enhanceSidebar();
  enhanceTopBar();
  enhanceTodayHeader();
  enhanceCommitments();
  buildPalette();
  buildShortcuts();
  buildNewCommitmentDialog();
  buildAppearancePopover();
  if (focusRemaining() > 0) {
    startFocusLoop();
  }

  // The app hydrates asynchronously; once its init has finished, apply the
  // theme mode and refresh everything this layer renders.
  const themeToggle = qs('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      if (!settingThemeProgrammatically) {
        prefs.themeMode = state.darkMode ? 'dark' : 'light';
        savePrefs();
        renderAppearance();
      }
    });
  }
  if (systemDark && systemDark.addEventListener) {
    systemDark.addEventListener('change', () => {
      if (prefs.themeMode === 'system') {
        syncTheme();
      }
    });
  }
  // Re-render Today whenever the AI kill switch or quiet hours change.
  ['#killSwitch', '#privacyKillSwitch'].forEach((selector) => {
    const element = qs(selector);
    if (element) {
      element.addEventListener('click', () => setTimeout(() => {
        renderToday();
        updateBadges();
      }, 0));
    }
  });

  let bootChecks = 0;
  const bootTimer = setInterval(() => {
    bootChecks += 1;
    const badge = qs('#connectionBadge');
    const hydrated = badge && !/Connecting/.test(badge.textContent);
    if (hydrated || bootChecks > 50) {
      clearInterval(bootTimer);
      setTimeout(() => {
        syncTheme();
        baseTitle = `${VIEW_LABELS[state.currentView] || 'Orbis'} · Orbis`;
        renderToday();
        renderCommitments();
        renderFocusChip();
        updateBadges();
      }, 0);
    }
  }, 100);

  // Small public surface for debugging / future features.
  window.OrbisPlus = { openPalette, openNewCommitment, openShortcuts, toggleSidebar, toggleFocus, prefs, ui };
})();
