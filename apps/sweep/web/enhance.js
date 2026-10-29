// Sweep — interaction layer (v10)
// Loaded after app.js. Adds: persistent plan progress, editable briefs,
// catalog search/filter/sort + duplicate/delete/import, command palette,
// keyboard shortcuts, brief readiness meter + autosave, nicer Generate viewer.
// Offline, zero-dependency, and defensive: every hook checks its DOM exists so
// the same file works on index.html and mobile.html.

(function () {
  'use strict';

  const PREFS_KEY = 'sweep_prefs_v1';
  const DRAFT_KEY = 'sweep_brief_draft_v1';
  const PHASES = ['M0', 'M1', 'M2', 'M3'];
  // Project pages that share the flow bar (v20).
  const PROJECT_SECTIONS = ['plan', 'studio', 'verify', 'generate'];
  const FLOW_STEPS = [
    { key: 'plan', label: 'Plan' },
    { key: 'studio', label: 'Studio' },
    { key: 'verify', label: 'Verify' },
    { key: 'generate', label: 'Generate' }
  ];
  const fileCounts = {};
  const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'spec-complete', label: 'Spec complete' },
    { key: 'verified', label: 'Verified' }
  ];
  const EXAMPLE_IDEAS = [
    'a habit tracker with streaks and reminders for busy people',
    'a recipe planner that builds a weekly grocery list for families',
    'a tiny CRM for freelance designers to track leads and invoices',
    'a study timer with spaced-repetition flashcards for students'
  ];

  const ui = {
    editingId: null,
    paletteIndex: 0,
    paletteItems: [],
    draftTimer: null,
    toastTimer: null,
    prefs: loadPrefs()
  };

  // ---------- small helpers ----------

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value)) : String(value);
  }

  function loadPrefs() {
    try {
      return Object.assign({ filter: 'all', sort: 'newest' }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    } catch (e) {
      return { filter: 'all', sort: 'newest' };
    }
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: ui.prefs.filter, sort: ui.prefs.sort }));
  }

  function isDemo(project) {
    return !project || project.id === DEMO_PROJECT.id;
  }

  function persist(project) {
    if (project && !isDemo(project)) saveState();
  }

  function inApp() {
    const gate = document.getElementById('section-gate');
    return !!(state.workspace && gate && gate.style.display === 'none');
  }

  function isTyping(target) {
    if (!target) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
  }

  function wrap(name, after) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function () {
      const result = original.apply(this, arguments);
      after.apply(this, arguments);
      return result;
    };
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Toast with an optional action button (e.g. Undo).
  function actionToast(message, actionLabel, onAction, duration) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(ui.toastTimer);
    toast.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    if (actionLabel && onAction) {
      const button = document.createElement('button');
      button.className = 'toast-action';
      button.type = 'button';
      button.textContent = actionLabel;
      button.addEventListener('click', function () {
        toast.classList.remove('show');
        onAction();
      });
      toast.appendChild(button);
    }
    toast.classList.add('show', 'has-action');
    ui.toastTimer = setTimeout(function () {
      toast.classList.remove('show', 'has-action');
    }, duration || 5000);
  }

  // Route the app's plain toasts through the same timer so an older toast's
  // timeout can never hide a newer one (e.g. an Undo toast).
  window.showToast = function (message) {
    actionToast(message, null, null, 3000);
  };

  // ---------- progress model ----------

  function planChecks(project) {
    if (!project.planChecks) project.planChecks = {};
    return project.planChecks;
  }

  function verifyGateState(project) {
    if (project.verifyGates) return project.verifyGates;
    if (project === state.currentProject) return state.verifyGates || {};
    return {};
  }

  function projectProgress(project) {
    const checks = project.planChecks || {};
    const phasesDone = project.phasesDone || {};
    const successChecks = project.successChecks || [];
    const growPlan = generateGrowPlan(project);
    const earnPlan = generateEarnPlan(project);
    const gates = project.capabilityMatrix ? getVerifyGates(project) : [];
    const gateState = verifyGateState(project);
    const items = [];

    successChecks.forEach(function (text, i) {
      items.push({ track: 'build', id: 'dod-' + i, label: text, done: !!checks['dod-' + i] });
    });
    PHASES.forEach(function (phase, i) {
      const titles = ['Specification', 'Scaffold + design system', 'Verification', 'Memory + deploy'];
      items.push({ track: 'build', id: 'phase-' + phase, label: phase + ' · ' + titles[i], done: !!phasesDone[phase] });
    });
    gates.forEach(function (gate, i) {
      items.push({ track: 'verify', id: 'gate-' + i, label: gate.title, done: !!gateState['gate-' + i] });
    });
    growPlan.forEach(function (item, i) {
      items.push({ track: 'grow', id: 'grow-' + i, label: item.title, done: !!checks['grow-' + i] });
    });
    earnPlan.forEach(function (item, i) {
      items.push({ track: 'earn', id: 'earn-' + i, label: item.title, done: !!checks['earn-' + i] });
    });

    const tracks = {};
    ['build', 'verify', 'grow', 'earn'].forEach(function (key) {
      const trackItems = items.filter(function (item) { return item.track === key; });
      const done = trackItems.filter(function (item) { return item.done; }).length;
      tracks[key] = { done: done, total: trackItems.length };
    });
    const doneTotal = items.filter(function (item) { return item.done; }).length;
    return {
      tracks: tracks,
      done: doneTotal,
      total: items.length,
      percent: items.length ? Math.round((doneTotal / items.length) * 100) : 0,
      next: items.find(function (item) { return !item.done; }) || null
    };
  }

  // ---------- plan view ----------

  const TRACK_META = {
    build: { label: 'Build', target: 'dod-list' },
    verify: { label: 'Verify', target: null },
    grow: { label: 'Grow', target: 'grow-list' },
    earn: { label: 'Earn', target: 'earn-list' }
  };

  function ensurePlanChrome(project) {
    const section = document.getElementById('section-plan');
    if (!section) return;

    // Progress panel under the plan header.
    if (!document.getElementById('plan-progress')) {
      const header = $('.plan-header', section);
      const panel = document.createElement('div');
      panel.className = 'plan-progress';
      panel.id = 'plan-progress';
      panel.setAttribute('aria-live', 'polite');
      if (header) header.insertAdjacentElement('afterend', panel);
    }

    // Edit / copy button in the plan action bar.
    const actions = $('.section-actions', section);
    if (actions && !document.getElementById('plan-edit-btn')) {
      const button = document.createElement('button');
      button.className = 'btn btn-secondary btn-sm';
      button.id = 'plan-edit-btn';
      button.type = 'button';
      button.addEventListener('click', function () {
        const current = state.currentProject;
        if (!current) return;
        if (isDemo(current)) {
          const copy = duplicateProject(current, { name: current.name, quiet: true });
          openProject(copy.id);
          showToast('Demo copied to your projects — it is yours to edit');
        } else {
          startEditProject(current.id);
        }
      });
      actions.insertBefore(button, actions.firstChild);
    }
    const editButton = document.getElementById('plan-edit-btn');
    if (editButton) {
      editButton.innerHTML = isDemo(project)
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy to my projects'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Edit brief';
    }
  }

  function renderPlanProgress(project) {
    const panel = document.getElementById('plan-progress');
    if (!panel || !project) return;
    const progress = projectProgress(project);
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - progress.percent / 100);

    const tracksHtml = Object.keys(TRACK_META).map(function (key) {
      const track = progress.tracks[key];
      const pct = track.total ? Math.round((track.done / track.total) * 100) : 0;
      const complete = track.total && track.done === track.total;
      return '<button type="button" class="pp-track' + (complete ? ' is-complete' : '') + '" data-track="' + key + '">' +
        '<span class="pp-track-label">' + TRACK_META[key].label + '</span>' +
        '<span class="pp-bar"><span style="width:' + pct + '%"></span></span>' +
        '<span class="pp-count">' + track.done + '/' + track.total + '</span>' +
        '</button>';
    }).join('');

    const nextHtml = progress.next
      ? '<span class="pp-next-label">Next up</span><button type="button" class="pp-next-btn" data-item="' + esc(progress.next.id) + '">' + esc(progress.next.label) + ' <span aria-hidden="true">→</span></button>'
      : '<span class="pp-next-label">All done</span><span class="pp-done-msg">Every Build, Verify, Grow and Earn item is checked.</span>';

    panel.classList.toggle('is-complete', progress.percent === 100);
    panel.innerHTML =
      '<div class="pp-ring" role="img" aria-label="' + progress.percent + '% of the plan complete">' +
        '<svg viewBox="0 0 72 72" width="72" height="72">' +
          '<circle class="pp-ring-bg" cx="36" cy="36" r="' + radius + '"/>' +
          '<circle class="pp-ring-fg" cx="36" cy="36" r="' + radius + '" stroke-dasharray="' + circumference.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
        '</svg>' +
        '<span class="pp-ring-value">' + progress.percent + '<small>%</small></span>' +
      '</div>' +
      '<div class="pp-tracks">' + tracksHtml + '</div>' +
      '<div class="pp-next">' + nextHtml + '</div>';

    $all('.pp-track', panel).forEach(function (button) {
      button.addEventListener('click', function () {
        const key = button.dataset.track;
        if (key === 'verify') {
          navigateTo('verify');
          return;
        }
        scrollToAndFlash(document.getElementById(TRACK_META[key].target));
      });
    });
    const nextButton = $('.pp-next-btn', panel);
    if (nextButton) {
      nextButton.addEventListener('click', function () {
        jumpToItem(nextButton.dataset.item);
      });
    }
    renderFlowbar('plan');
  }

  function jumpToItem(itemId) {
    if (itemId.indexOf('gate-') === 0) {
      navigateTo('verify');
      setTimeout(function () {
        const box = document.getElementById(itemId);
        scrollToAndFlash(box && box.closest('.verify-gate'));
      }, 320);
      return;
    }
    if (itemId.indexOf('phase-') === 0) {
      scrollToAndFlash($('.phase[data-phase="' + itemId.slice(6) + '"]'));
      return;
    }
    const box = document.getElementById(itemId);
    scrollToAndFlash(box && box.closest('.dod-item'));
  }

  function scrollToAndFlash(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    element.classList.remove('flash');
    void element.offsetWidth;
    element.classList.add('flash');
  }

  function enhancePlanLists(project) {
    const checks = planChecks(project);
    const hints = {
      grow: generateGrowPlan(project).map(function (item) { return item.hint; }),
      earn: generateEarnPlan(project).map(function (item) { return item.hint; })
    };

    ['dod-list', 'grow-list', 'earn-list'].forEach(function (listId) {
      const list = document.getElementById(listId);
      if (!list) return;
      $all('.dod-checkbox', list).forEach(function (box) {
        const item = box.closest('.dod-item');
        box.checked = !!checks[box.id];
        item.classList.toggle('is-done', box.checked);

        const [prefix, index] = box.id.split('-');
        if (hints[prefix] && hints[prefix][index] && !$('.dod-hint', item)) {
          const label = $('label', item);
          const hint = document.createElement('span');
          hint.className = 'dod-hint';
          hint.textContent = hints[prefix][index];
          if (label) label.appendChild(hint);
        }

        box.addEventListener('change', function () {
          checks[box.id] = box.checked;
          item.classList.toggle('is-done', box.checked);
          persist(project);
          const progress = projectProgress(project);
          renderPlanProgress(project);
          const trackKey = prefix === 'dod' ? 'build' : prefix;
          const track = progress.tracks[trackKey];
          if (box.checked && track.total && track.done === track.total) {
            showToast(TRACK_META[trackKey].label + ' track complete');
          }
        });
      });
    });

    // Phases become a clickable stepper.
    const phasesDone = project.phasesDone || (project.phasesDone = {});
    $all('#phases-timeline .phase').forEach(function (phase, i) {
      const key = PHASES[i];
      if (!key) return;
      phase.dataset.phase = key;
      phase.setAttribute('role', 'button');
      phase.setAttribute('tabindex', '0');
      phase.setAttribute('aria-pressed', phasesDone[key] ? 'true' : 'false');
      phase.title = 'Click to mark ' + key + (phasesDone[key] ? ' as not done' : ' as done');
      phase.classList.toggle('is-done', !!phasesDone[key]);
      if (phase.dataset.bound) return;
      phase.dataset.bound = '1';
      const toggle = function () {
        const current = state.currentProject;
        if (!current) return;
        const done = current.phasesDone || (current.phasesDone = {});
        done[key] = !done[key];
        phase.classList.toggle('is-done', done[key]);
        phase.setAttribute('aria-pressed', done[key] ? 'true' : 'false');
        phase.title = 'Click to mark ' + key + (done[key] ? ' as not done' : ' as done');
        persist(current);
        renderPlanProgress(current);
      };
      phase.addEventListener('click', toggle);
      phase.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
    });
  }

  wrap('renderPlanView', function (project) {
    if (!project) return;
    ensurePlanChrome(project);
    enhancePlanLists(project);
    renderPlanProgress(project);
  });

  // ---------- verify view ----------

  wrap('renderVerifyView', function (project) {
    $all('.verify-gate').forEach(function (gate) {
      const box = $('.verify-gate-checkbox', gate);
      if (!box) return;
      gate.classList.toggle('is-passed', box.checked);
      gate.addEventListener('click', function (event) {
        if (event.target === box || event.target.closest('code')) return;
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
      });
    });
    const button = document.getElementById('verify-complete-btn');
    if (button && button.lastChild && button.lastChild.nodeType === 3) {
      const verified = !!(project && project.status === 'verified');
      if (verified) button.disabled = true;
      button.classList.toggle('is-verified', verified);
      button.lastChild.textContent = verified ? ' Verified' : ' Mark as Verified';
    }
  });

  wrap('toggleVerifyGate', function () {
    const project = state.currentProject;
    if (!project) return;
    persist(project);
    renderPlanProgress(project);
    renderFlowbar('verify');
    const gates = getVerifyGates(project);
    const passed = gates.filter(function (gate, i) { return state.verifyGates['gate-' + i]; }).length;
    if (passed === gates.length && project.status !== 'verified') {
      actionToast('All gates passed', 'Mark verified', function () {
        markVerified();
      });
    }
  });

  wrap('markVerified', function () {
    const project = state.currentProject;
    if (!project) return;
    renderVerifyView(project);
    renderPlanProgress(project);
    celebrate(document.getElementById('verify-complete-btn'));
  });

  function celebrate(anchor) {
    if (!anchor || prefersReducedMotion()) return;
    const rect = anchor.getBoundingClientRect();
    const burst = document.createElement('div');
    burst.className = 'sweep-burst';
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top = (rect.top + rect.height / 2) + 'px';
    const colors = ['var(--color-accent)', 'var(--color-productive)', 'var(--color-neutral)'];
    for (let i = 0; i < 18; i++) {
      const piece = document.createElement('span');
      const angle = (Math.PI * 2 * i) / 18;
      const distance = 50 + (i % 3) * 22;
      piece.style.setProperty('--dx', Math.cos(angle) * distance + 'px');
      piece.style.setProperty('--dy', Math.sin(angle) * distance + 'px');
      piece.style.background = colors[i % colors.length];
      burst.appendChild(piece);
    }
    document.body.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 900);
  }

  // ---------- catalog ----------

  function ensureCatalogToolbar() {
    const grid = document.getElementById('catalog-grid');
    if (!grid || document.getElementById('catalog-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'catalog-toolbar';
    toolbar.id = 'catalog-toolbar';
    toolbar.innerHTML =
      '<div class="catalog-stats" id="catalog-stats"></div>' +
      '<div class="catalog-controls">' +
        '<label class="search-field">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<input type="search" id="catalog-search" placeholder="Search projects" aria-label="Search projects" autocomplete="off">' +
          '<kbd>/</kbd>' +
        '</label>' +
        '<div class="chip-group" id="catalog-filters" role="group" aria-label="Filter by status">' +
          STATUS_FILTERS.map(function (f) {
            return '<button type="button" class="chip" data-filter="' + f.key + '">' + f.label + '</button>';
          }).join('') +
        '</div>' +
        '<select id="catalog-sort" class="catalog-sort" aria-label="Sort projects">' +
          '<option value="newest">Newest</option>' +
          '<option value="oldest">Oldest</option>' +
          '<option value="name">Name A–Z</option>' +
          '<option value="progress">Most progress</option>' +
        '</select>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="catalog-import-btn" title="Import a project JSON exported from Sweep">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import' +
        '</button>' +
        '<input type="file" id="catalog-import-input" accept="application/json,.json" hidden>' +
      '</div>' +
      '<p class="catalog-nomatch" id="catalog-nomatch" hidden>No projects match. <button type="button" class="link-btn" id="catalog-clear">Clear filters</button></p>';
    grid.parentNode.insertBefore(toolbar, grid);

    const search = document.getElementById('catalog-search');
    search.addEventListener('input', applyCatalogFilters);
    search.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        search.value = '';
        applyCatalogFilters();
        search.blur();
      }
    });
    $all('.chip', toolbar).forEach(function (chip) {
      chip.addEventListener('click', function () {
        ui.prefs.filter = chip.dataset.filter;
        savePrefs();
        applyCatalogFilters();
      });
    });
    const sort = document.getElementById('catalog-sort');
    sort.value = ui.prefs.sort;
    sort.addEventListener('change', function () {
      ui.prefs.sort = sort.value;
      savePrefs();
      applyCatalogFilters();
    });
    const importInput = document.getElementById('catalog-import-input');
    document.getElementById('catalog-import-btn').addEventListener('click', function () {
      importInput.click();
    });
    importInput.addEventListener('change', function () {
      if (importInput.files && importInput.files[0]) importProjectFile(importInput.files[0]);
      importInput.value = '';
    });
    document.getElementById('catalog-clear').addEventListener('click', function () {
      search.value = '';
      ui.prefs.filter = 'all';
      savePrefs();
      applyCatalogFilters();
    });
  }

  function renderCatalogStats() {
    const stats = document.getElementById('catalog-stats');
    if (!stats) return;
    const projects = state.projects || [];
    const verified = projects.filter(function (p) { return p.status === 'verified' || p.status === 'shipped'; }).length;
    const average = projects.length
      ? Math.round(projects.reduce(function (sum, p) { return sum + projectProgress(p).percent; }, 0) / projects.length)
      : 0;
    stats.innerHTML =
      '<div class="stat"><span class="stat-value">' + projects.length + '</span><span class="stat-label">Projects</span></div>' +
      '<div class="stat"><span class="stat-value">' + verified + '</span><span class="stat-label">Verified</span></div>' +
      '<div class="stat"><span class="stat-value">' + average + '<small>%</small></span><span class="stat-label">Avg. progress</span></div>';
  }

  function applyCatalogFilters() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    const searchInput = document.getElementById('catalog-search');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const filter = ui.prefs.filter;

    $all('.chip', document.getElementById('catalog-filters') || document).forEach(function (chip) {
      const active = chip.dataset.filter === filter;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Sort user cards in place (new-card first, demo last).
    const cards = $all('.project-card[data-project-id]', grid);
    const byId = {};
    (state.projects || []).forEach(function (p) { byId[p.id] = p; });
    const sorters = {
      newest: function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); },
      oldest: function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); },
      name: function (a, b) { return (a.name || '').localeCompare(b.name || ''); },
      progress: function (a, b) { return projectProgress(b).percent - projectProgress(a).percent; }
    };
    const sorter = sorters[ui.prefs.sort] || sorters.newest;
    cards.sort(function (x, y) {
      return sorter(byId[x.dataset.projectId], byId[y.dataset.projectId]);
    });
    const demoCard = $('.demo-card', grid);
    cards.forEach(function (card) { grid.insertBefore(card, demoCard); });

    let visible = 0;
    const matchCard = function (card, project) {
      const haystack = [project.name, project.oneLiner, project.targetUser, project.problem].join(' ').toLowerCase();
      const statusOk = filter === 'all' || project.status === filter;
      const queryOk = !query || haystack.indexOf(query) !== -1;
      card.hidden = !(statusOk && queryOk);
      if (!card.hidden) visible++;
    };
    cards.forEach(function (card) { matchCard(card, byId[card.dataset.projectId]); });
    if (demoCard) matchCard(demoCard, Object.assign({}, DEMO_PROJECT, { name: DEMO_PROJECT.name + ' demo example' }));

    const newCard = $('.new-card', grid);
    if (newCard) newCard.hidden = !!query || filter !== 'all';

    const noMatch = document.getElementById('catalog-nomatch');
    if (noMatch) noMatch.hidden = visible > 0 || (!query && filter === 'all');
  }

  const originalCreateProjectCard = window.createProjectCard;
  window.createProjectCard = function (project) {
    const card = originalCreateProjectCard(project);
    const progress = projectProgress(project);
    card.dataset.projectId = project.id;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Open ' + project.name + ', ' + progress.percent + '% complete');
    card.addEventListener('keydown', function (event) {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openProject(project.id);
      }
    });

    const meta = $('.project-card-meta', card);
    const progressEl = document.createElement('div');
    progressEl.className = 'card-progress';
    progressEl.innerHTML =
      '<div class="card-progress-bar"><span style="width:' + progress.percent + '%"></span></div>' +
      '<div class="card-progress-text"><strong>' + progress.percent + '%</strong>' +
      (progress.next ? ' · next: ' + esc(progress.next.label) : ' · all items done') + '</div>';
    card.insertBefore(progressEl, meta);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.innerHTML =
      '<button type="button" class="card-action" data-act="edit" title="Edit brief" aria-label="Edit brief"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' +
      '<button type="button" class="card-action" data-act="duplicate" title="Duplicate" aria-label="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button type="button" class="card-action" data-act="export" title="Export JSON" aria-label="Export JSON"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>' +
      '<button type="button" class="card-action danger" data-act="delete" title="Delete" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>';
    actions.addEventListener('click', function (event) {
      const button = event.target.closest('.card-action');
      if (!button) return;
      event.stopPropagation();
      const act = button.dataset.act;
      if (act === 'edit') startEditProject(project.id);
      if (act === 'duplicate') duplicateProject(project);
      if (act === 'export') exportProject(project);
      if (act === 'delete') deleteProject(project.id);
    });
    actions.addEventListener('keydown', function (event) {
      event.stopPropagation();
    });
    card.appendChild(actions);
    return card;
  };

  wrap('renderCatalog', function () {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    ensureCatalogToolbar();

    // A "new project" card replaces the separate empty-state block.
    const emptyState = document.getElementById('catalog-empty');
    if (emptyState) emptyState.style.display = 'none';
    const actions = $('.catalog-actions');
    if (actions) actions.style.display = 'none';

    const newCard = document.createElement('button');
    newCard.type = 'button';
    newCard.className = 'project-card new-card';
    newCard.innerHTML =
      '<span class="new-card-icon" aria-hidden="true">+</span>' +
      '<span class="new-card-title">New project</span>' +
      '<span class="new-card-desc">' + ((state.projects || []).length ? 'Turn another idea into a checkable plan' : 'Describe your first idea in plain words — Sweep drafts the brief offline') + '</span>';
    newCard.addEventListener('click', function () {
      navigateTo('brief');
    });
    grid.insertBefore(newCard, grid.firstChild);

    const demoCard = $('.demo-card', grid);
    if (demoCard && !demoCard.dataset.enhanced) {
      demoCard.dataset.enhanced = '1';
      demoCard.setAttribute('tabindex', '0');
      demoCard.setAttribute('role', 'button');
      demoCard.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDemoProject();
        }
      });
    }

    renderCatalogStats();
    applyCatalogFilters();
  });

  function newProjectId() {
    return 'proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  }

  function duplicateProject(project, options) {
    const opts = options || {};
    const copy = JSON.parse(JSON.stringify(project));
    copy.id = newProjectId();
    copy.name = opts.name || (project.name + ' (copy)');
    copy.createdAt = new Date().toISOString();
    copy.status = 'draft';
    copy.planChecks = {};
    copy.phasesDone = {};
    copy.verifyGates = {};
    delete copy.operator;
    state.projects.push(copy);
    saveState();
    renderCatalog();
    if (!opts.quiet) showToast('Duplicated as "' + copy.name + '"');
    return copy;
  }

  function exportProject(project) {
    downloadText(toKebabCase(project.name || 'project') + '-plan.json', JSON.stringify(project, null, 2), 'application/json');
    showToast('Exported ' + project.name);
  }

  function deleteProject(id) {
    const index = state.projects.findIndex(function (p) { return p.id === id; });
    if (index === -1) return;
    const removed = state.projects.splice(index, 1)[0];
    if (state.currentProject && state.currentProject.id === id) {
      state.currentProject = null;
      updateNavForProject(null);
    }
    saveState();
    renderCatalog();
    actionToast('Deleted "' + removed.name + '"', 'Undo', function () {
      state.projects.splice(Math.min(index, state.projects.length), 0, removed);
      saveState();
      renderCatalog();
      showToast('Restored "' + removed.name + '"');
    }, 7000);
  }

  function normaliseImported(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    const project = {
      id: raw.id && !state.projects.some(function (p) { return p.id === raw.id; }) && raw.id !== DEMO_PROJECT.id ? String(raw.id) : newProjectId(),
      name: raw.name.trim().slice(0, 120),
      oneLiner: String(raw.oneLiner || ''),
      problem: String(raw.problem || ''),
      targetUser: String(raw.targetUser || ''),
      jtbd: String(raw.jtbd || ''),
      successChecks: Array.isArray(raw.successChecks) ? raw.successChecks.map(String).filter(Boolean) : [],
      nonGoals: String(raw.nonGoals || ''),
      overlap: String(raw.overlap || ''),
      status: ['draft', 'spec-complete', 'building', 'verified', 'shipped'].indexOf(raw.status) !== -1 ? raw.status : 'draft',
      createdAt: raw.createdAt && !isNaN(new Date(raw.createdAt)) ? raw.createdAt : new Date().toISOString(),
      verifyGates: raw.verifyGates && typeof raw.verifyGates === 'object' ? raw.verifyGates : {},
      planChecks: raw.planChecks && typeof raw.planChecks === 'object' ? raw.planChecks : {},
      phasesDone: raw.phasesDone && typeof raw.phasesDone === 'object' ? raw.phasesDone : {}
    };
    if (!project.successChecks.length) project.successChecks = ['Boots with 0 console errors'];
    const matrix = raw.capabilityMatrix;
    project.capabilityMatrix = matrix && matrix.backend && matrix.auth && matrix.mobile ? matrix : generateCapabilityMatrix(project);
    if (raw.operator && typeof raw.operator === 'object') project.operator = raw.operator;
    return project;
  }

  function importProjectFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        showToast('That file is not valid JSON');
        return;
      }
      let candidates = [];
      if (Array.isArray(parsed)) candidates = parsed;
      else if (parsed && Array.isArray(parsed.projects)) candidates = parsed.projects;
      else if (parsed && parsed.project) candidates = [parsed.project];
      else candidates = [parsed];
      const imported = candidates.map(normaliseImported).filter(Boolean);
      if (!imported.length) {
        showToast('No Sweep projects found in that file');
        return;
      }
      imported.forEach(function (p) { state.projects.push(p); });
      saveState();
      renderCatalog();
      showToast('Imported ' + imported.length + ' project' + (imported.length === 1 ? '' : 's'));
    };
    reader.readAsText(file);
  }

  // ---------- brief: edit mode, readiness meter, autosave, examples ----------

  const BRIEF_FIELDS = [
    { id: 'brief-app-name', key: 'name', label: 'App name' },
    { id: 'brief-one-liner', key: 'oneLiner', label: 'One-liner' },
    { id: 'brief-problem', key: 'problem', label: 'Problem' },
    { id: 'brief-target-user', key: 'targetUser', label: 'Target user' },
    { id: 'brief-jtbd', key: 'jtbd', label: 'Job-to-be-done' },
    { id: 'brief-non-goals', key: 'nonGoals', label: 'Non-goals' }
  ];

  function fieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  function successCheckRow(value) {
    return '<div class="success-check-row">' +
      '<input type="text" class="success-check-input" placeholder="e.g., Passes all smoke tests" required value="' + esc(value || '') + '">' +
      '<button type="button" class="btn-icon" onclick="removeSuccessCheck(this)" aria-label="Remove">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div>';
  }

  function readBriefForm() {
    const data = { idea: fieldValue('operator-input'), overlap: fieldValue('brief-overlap') };
    BRIEF_FIELDS.forEach(function (f) { data[f.key] = fieldValue(f.id); });
    data.successChecks = $all('.success-check-input').map(function (el) { return el.value.trim(); });
    return data;
  }

  function fillBriefForm(data) {
    BRIEF_FIELDS.forEach(function (f) {
      const field = document.getElementById(f.id);
      if (field) field.value = data[f.key] || '';
    });
    const overlap = document.getElementById('brief-overlap');
    if (overlap) overlap.value = data.overlap || '';
    const idea = document.getElementById('operator-input');
    if (idea && data.idea !== undefined) idea.value = data.idea || '';
    const container = document.getElementById('success-checks-container');
    const checks = (data.successChecks && data.successChecks.length) ? data.successChecks : [''];
    if (container) container.innerHTML = checks.map(successCheckRow).join('');
    if (typeof suggestKebabCase === 'function') suggestKebabCase();
    updateBriefMeter();
  }

  function briefIsEmpty() {
    const data = readBriefForm();
    return !data.idea && BRIEF_FIELDS.every(function (f) { return !data[f.key]; }) &&
      data.successChecks.every(function (c) { return !c; });
  }

  function draftStore() {
    return state.workspace && state.workspace.guestMode ? localStorage : sessionStorage;
  }

  function saveDraftSoon() {
    if (ui.editingId) return;
    clearTimeout(ui.draftTimer);
    ui.draftTimer = setTimeout(function () {
      try {
        if (briefIsEmpty()) draftStore().removeItem(DRAFT_KEY);
        else draftStore().setItem(DRAFT_KEY, JSON.stringify(readBriefForm()));
      } catch (e) { /* storage full or blocked — draft is best-effort */ }
    }, 400);
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* ignore */ }
  }

  function maybeRestoreDraft() {
    if (ui.editingId || !briefIsEmpty()) return;
    let draft = null;
    try {
      draft = JSON.parse(draftStore().getItem(DRAFT_KEY) || 'null');
    } catch (e) {
      draft = null;
    }
    if (!draft) return;
    fillBriefForm(draft);
    actionToast('Restored your unsaved draft', 'Discard', function () {
      clearDraft();
      fillBriefForm({ idea: '', successChecks: [''] });
    }, 6000);
  }

  function ensureBriefChrome() {
    const section = document.getElementById('section-brief');
    const form = document.getElementById('brief-form');
    if (!section || !form || document.getElementById('brief-meter')) return;

    const header = $('.section-header', section);
    const meter = document.createElement('div');
    meter.className = 'brief-meter';
    meter.id = 'brief-meter';
    meter.innerHTML =
      '<div class="brief-meter-top"><span class="brief-meter-label">Brief readiness</span><span class="brief-meter-value" id="brief-meter-value">0%</span></div>' +
      '<div class="brief-meter-bar"><span id="brief-meter-fill"></span></div>' +
      '<div class="brief-meter-missing" id="brief-meter-missing"></div>';
    if (header) header.insertAdjacentElement('afterend', meter);

    const banner = document.createElement('div');
    banner.className = 'brief-edit-banner';
    banner.id = 'brief-edit-banner';
    banner.hidden = true;
    meter.insertAdjacentElement('beforebegin', banner);

    // Example ideas under the guided intake.
    const intake = document.getElementById('operator-input');
    if (intake) {
      const chips = document.createElement('div');
      chips.className = 'idea-chips';
      chips.innerHTML = '<span class="idea-chips-label">Try:</span>' + EXAMPLE_IDEAS.map(function (idea) {
        return '<button type="button" class="chip idea-chip">' + esc(idea) + '</button>';
      }).join('');
      intake.closest('.form-group').appendChild(chips);
      chips.addEventListener('click', function (event) {
        const chip = event.target.closest('.idea-chip');
        if (!chip) return;
        intake.value = chip.textContent;
        draftBriefFromIdea();
      });
      intake.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          draftBriefFromIdea();
        }
      });
      intake.setAttribute('aria-describedby', 'intake-hint');
      const hint = document.createElement('span');
      hint.className = 'form-hint';
      hint.id = 'intake-hint';
      hint.textContent = 'Tip: press Ctrl/⌘ + Enter to draft.';
      intake.insertAdjacentElement('afterend', hint);
    }

    form.addEventListener('input', function () {
      updateBriefMeter();
      saveDraftSoon();
    });
    form.addEventListener('click', function (event) {
      if (event.target.closest('.btn-icon, .btn-secondary')) {
        setTimeout(function () {
          updateBriefMeter();
          saveDraftSoon();
        }, 0);
      }
    });
    updateBriefMeter();
  }

  function updateBriefMeter() {
    const fill = document.getElementById('brief-meter-fill');
    if (!fill) return;
    const data = readBriefForm();
    const checksFilled = data.successChecks.filter(Boolean).length;
    const items = BRIEF_FIELDS.map(function (f) {
      return { label: f.label, id: f.id, ok: !!data[f.key] };
    });
    items.push({
      label: checksFilled >= 2 ? 'Success checks' : 'At least 2 success checks',
      id: null,
      ok: checksFilled >= 2
    });
    const done = items.filter(function (item) { return item.ok; }).length;
    const pct = Math.round((done / items.length) * 100);
    fill.style.width = pct + '%';
    fill.parentElement.parentElement.classList.toggle('is-ready', pct === 100);
    document.getElementById('brief-meter-value').textContent = pct + '%';
    const missing = items.filter(function (item) { return !item.ok; });
    const missingEl = document.getElementById('brief-meter-missing');
    missingEl.innerHTML = missing.length
      ? '<span>Still needed:</span> ' + missing.map(function (item) {
          return '<button type="button" class="link-btn" data-focus="' + (item.id || '') + '">' + esc(item.label) + '</button>';
        }).join('')
      : '<span>Ready — generate your plan.</span>';
    $all('[data-focus]', missingEl).forEach(function (button) {
      button.addEventListener('click', function () {
        const target = button.dataset.focus
          ? document.getElementById(button.dataset.focus)
          : $all('.success-check-input').find(function (el) { return !el.value.trim(); });
        if (target) {
          target.focus();
          scrollToAndFlash(target);
        } else if (typeof addSuccessCheck === 'function') {
          addSuccessCheck();
          const inputs = $all('.success-check-input');
          inputs[inputs.length - 1].focus();
        }
      });
    });
  }

  function setEditMode(project) {
    ui.editingId = project ? project.id : null;
    const banner = document.getElementById('brief-edit-banner');
    const submit = $('#brief-form button[type="submit"]');
    const title = $('#section-brief .section-title');
    if (project) {
      if (banner) {
        banner.hidden = false;
        banner.innerHTML = 'Editing <strong>' + esc(project.name) + '</strong> — saving updates the existing plan and keeps your progress. <button type="button" class="link-btn" id="brief-cancel-edit">Cancel edit</button>';
        document.getElementById('brief-cancel-edit').addEventListener('click', function () {
          navigateTo('plan');
        });
      }
      if (submit) submit.firstChild.textContent = 'Save changes ';
      if (title) title.textContent = 'Edit Brief';
    } else {
      if (banner) banner.hidden = true;
      if (submit) submit.firstChild.textContent = '\n          Generate Plan\n          ';
      if (title) title.textContent = 'Idea Brief';
    }
  }

  function startEditProject(id) {
    const project = state.projects.find(function (p) { return p.id === id; });
    if (!project) return;
    state.currentProject = project;
    state.verifyGates = project.verifyGates || (project.verifyGates = {});
    updateNavForProject(project);
    ui.editingId = project.id;
    navigateTo('brief');
    setEditMode(project);
    fillBriefForm(Object.assign({}, project, { idea: '' }));
  }
  window.startEditProject = startEditProject;

  function remapByText(oldList, newList) {
    // Returns map newIndex -> oldIndex for success checks whose text is unchanged.
    const used = {};
    const map = {};
    newList.forEach(function (text, i) {
      const j = oldList.findIndex(function (old, k) { return old === text && !used[k]; });
      if (j !== -1) {
        used[j] = true;
        map[i] = j;
      }
    });
    return map;
  }

  const originalBriefSubmit = window.handleBriefSubmit;
  window.handleBriefSubmit = function (event) {
    if (!ui.editingId) {
      originalBriefSubmit(event);
      clearDraft();
      updateBriefMeter();
      return;
    }
    event.preventDefault();
    const project = state.projects.find(function (p) { return p.id === ui.editingId; });
    if (!project) {
      setEditMode(null);
      return;
    }
    const data = readBriefForm();
    const oldChecks = project.successChecks.slice();
    const newChecks = data.successChecks.filter(Boolean);
    const indexMap = remapByText(oldChecks, newChecks);

    // Carry Definition-of-Done ticks across edits.
    const oldPlan = project.planChecks || {};
    const nextPlan = {};
    Object.keys(oldPlan).forEach(function (key) {
      if (key.indexOf('dod-') !== 0) nextPlan[key] = oldPlan[key];
    });
    Object.keys(indexMap).forEach(function (i) {
      if (oldPlan['dod-' + indexMap[i]]) nextPlan['dod-' + i] = true;
    });

    // Verify gates: [smoke, visual, ...acceptance, repo, secret].
    const oldGates = project.verifyGates || {};
    const nextGates = {};
    nextGates['gate-0'] = !!oldGates['gate-0'];
    nextGates['gate-1'] = !!oldGates['gate-1'];
    Object.keys(indexMap).forEach(function (i) {
      nextGates['gate-' + (2 + Number(i))] = !!oldGates['gate-' + (2 + indexMap[i])];
    });
    nextGates['gate-' + (2 + newChecks.length)] = !!oldGates['gate-' + (2 + oldChecks.length)];
    nextGates['gate-' + (3 + newChecks.length)] = !!oldGates['gate-' + (3 + oldChecks.length)];

    BRIEF_FIELDS.forEach(function (f) { project[f.key] = data[f.key]; });
    project.overlap = data.overlap;
    project.successChecks = newChecks;
    project.planChecks = nextPlan;
    project.verifyGates = nextGates;
    project.capabilityMatrix = generateCapabilityMatrix(project);
    project.updatedAt = new Date().toISOString();
    if (project.status === 'verified' && newChecks.join('\n') !== oldChecks.join('\n')) {
      project.status = 'spec-complete';
    }
    state.currentProject = project;
    state.verifyGates = project.verifyGates;
    saveState();
    setEditMode(null);
    fillBriefForm({ idea: '', successChecks: [''] });
    renderPlanView(project);
    updateNavForProject(project);
    navigateTo('plan');
    showToast('Brief updated — progress kept');
  };

  // Smarter local drafting: better name + target-user extraction.
  wrap('draftBriefFromIdea', function () {
    const input = document.getElementById('operator-input');
    const idea = input ? input.value.trim() : '';
    if (!idea) return;
    const core = idea.replace(/^(an?|the|my)\s+/i, '').split(/\s+(?:with|for|that|which|to|so|where|using)\s+/i)[0];
    const words = core.split(/\s+/).filter(Boolean).slice(0, 3);
    const nameField = document.getElementById('brief-app-name');
    if (nameField && words.length) {
      nameField.value = words.map(function (w) {
        if (w.length > 1 && w === w.toUpperCase()) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }).join(' ');
    }
    const forMatch = idea.match(/\bfor\s+([^,.;]+?)(?:\s+(?:who|that|to|with)\b|[,.;]|$)/i);
    const userField = document.getElementById('brief-target-user');
    if (userField && forMatch) {
      const who = forMatch[1].trim();
      userField.value = who.charAt(0).toUpperCase() + who.slice(1);
    }
    if (typeof suggestKebabCase === 'function') suggestKebabCase();
    updateBriefMeter();
    saveDraftSoon();
  });

  // ---------- generate view ----------

  const FILE_KINDS = {
    html: 'HTML', css: 'CSS', js: 'JS', py: 'PY', md: 'MD', sh: 'SH', ps1: 'PS', json: 'JSON', gitignore: 'GIT'
  };

  function fileKind(name) {
    const base = name.split('/').pop();
    const ext = base.indexOf('.') === 0 ? base.slice(1) : base.split('.').pop();
    return FILE_KINDS[ext] || 'TXT';
  }

  wrap('renderGenerateView', function () {
    const list = document.getElementById('generate-file-list');
    if (!list) return;
    const items = $all('.file-list-item', list);
    items.forEach(function (item, i) {
      const name = item.textContent;
      const content = state.generatedFiles[name] || '';
      const lines = content.split('\n').length;
      item.dataset.file = name;
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'option');
      item.innerHTML =
        '<span class="file-kind kind-' + fileKind(name).toLowerCase() + '">' + fileKind(name) + '</span>' +
        '<span class="file-name">' + esc(name) + '</span>' +
        '<span class="file-lines">' + lines + '</span>';
      item.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = items[i + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) {
            next.focus();
            selectFile(next.dataset.file);
          }
        } else if (event.key === 'Enter') {
          selectFile(name);
        }
      });
    });
    list.setAttribute('role', 'listbox');
    const first = items.find(function (item) { return item.dataset.file === 'README.md'; }) || items[0];
    if (first) selectFile(first.dataset.file);
  });

  wrap('selectFile', function (filename) {
    $all('.file-list-item').forEach(function (item) {
      const active = item.dataset.file === filename;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const content = state.generatedFiles[filename] || '';
    const code = document.getElementById('generate-code');
    if (code) {
      code.classList.add('with-lines');
      code.innerHTML = content.split('\n').map(function (line) {
        return '<span class="ln">' + (esc(line) || ' ') + '</span>';
      }).join('');
    }
    const label = document.getElementById('generate-filename');
    if (label) {
      const size = new Blob([content]).size;
      const sizeText = size > 1024 ? (size / 1024).toFixed(1) + ' KB' : size + ' B';
      label.innerHTML = esc(filename) + ' <span class="file-meta">' + content.split('\n').length + ' lines · ' + sizeText + '</span>';
    }
  });

  // ---------- command palette ----------

  function ensurePalette() {
    if (document.getElementById('palette')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    backdrop.id = 'palette';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="palette-input-row">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<input id="palette-input" type="text" placeholder="Jump to a project, page or action…" autocomplete="off" aria-controls="palette-list" aria-label="Command">' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<ul class="palette-list" id="palette-list" role="listbox"></ul>' +
        '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>?</kbd> shortcuts</span></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop) closePalette();
    });
    const input = document.getElementById('palette-input');
    input.addEventListener('input', function () {
      ui.paletteIndex = 0;
      renderPalette();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = ui.paletteItems.length;
        if (!count) return;
        ui.paletteIndex = (ui.paletteIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        renderPalette(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runPaletteItem(ui.paletteItems[ui.paletteIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      }
    });
  }

  function paletteCommands() {
    const commands = [];
    const current = state.currentProject;
    const go = function (label, section, hint) {
      commands.push({ group: 'Go to', label: label, hint: hint || '', run: function () { navigateTo(section); } });
    };
    go('Catalog', 'catalog', 'G C');
    go('New brief', 'brief', 'N');
    go('Operator — Otto', 'operator', 'G O');
    go('Guide', 'guide', 'G H');
    if (current) {
      go('Plan · ' + current.name, 'plan', 'G P');
      go('Verify · ' + current.name, 'verify', 'G V');
      go('Generate · ' + current.name, 'generate', 'G G');
    }
    (state.projects || []).slice().reverse().forEach(function (project) {
      const pct = projectProgress(project).percent;
      commands.push({
        group: 'Projects',
        label: project.name,
        hint: pct + '% · ' + formatStatus(project.status),
        run: function () { openProject(project.id); }
      });
    });
    commands.push({ group: 'Projects', label: DEMO_PROJECT.name + ' (demo)', hint: 'Example', run: openDemoProject });
    commands.push({ group: 'Actions', label: 'Toggle Night Edition (dark mode)', hint: 'T', run: toggleTheme });
    if (current && !isDemo(current)) {
      commands.push({ group: 'Actions', label: 'Edit brief · ' + current.name, hint: 'E', run: function () { startEditProject(current.id); } });
      commands.push({ group: 'Actions', label: 'Duplicate · ' + current.name, hint: '', run: function () { duplicateProject(current); navigateTo('catalog'); } });
      commands.push({ group: 'Actions', label: 'Export JSON · ' + current.name, hint: '', run: function () { exportProject(current); } });
    }
    commands.push({
      group: 'Actions',
      label: 'Import project from JSON…',
      hint: '',
      run: function () {
        navigateTo('catalog');
        setTimeout(function () {
          const input = document.getElementById('catalog-import-input');
          if (input) input.click();
        }, 50);
      }
    });
    commands.push({ group: 'Actions', label: 'Keyboard shortcuts', hint: '?', run: openShortcuts });
    if (window.SweepStudio && typeof window.SweepStudio.paletteCommands === 'function') {
      Array.prototype.push.apply(commands, window.SweepStudio.paletteCommands());
    }
    return commands;
  }

  function fuzzyScore(text, query) {
    if (!query) return 1;
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    const direct = haystack.indexOf(needle);
    if (direct !== -1) return 100 - direct;
    let position = 0;
    for (let i = 0; i < needle.length; i++) {
      position = haystack.indexOf(needle[i], position);
      if (position === -1) return 0;
      position++;
    }
    return 10;
  }

  function renderPalette(keepScroll) {
    const input = document.getElementById('palette-input');
    const list = document.getElementById('palette-list');
    const query = input.value.trim();
    const scored = paletteCommands()
      .map(function (command) {
        return { command: command, score: fuzzyScore(command.label + ' ' + command.group, query) };
      })
      .filter(function (entry) { return entry.score > 0; });
    if (query) scored.sort(function (a, b) { return b.score - a.score; });
    ui.paletteItems = scored.map(function (entry) { return entry.command; });
    if (ui.paletteIndex >= ui.paletteItems.length) ui.paletteIndex = 0;

    let lastGroup = null;
    list.innerHTML = ui.paletteItems.length ? ui.paletteItems.map(function (command, i) {
      const heading = !query && command.group !== lastGroup
        ? '<li class="palette-group" role="presentation">' + command.group + '</li>'
        : '';
      lastGroup = command.group;
      return heading +
        '<li class="palette-item' + (i === ui.paletteIndex ? ' active' : '') + '" role="option" data-index="' + i + '" aria-selected="' + (i === ui.paletteIndex) + '">' +
          '<span class="palette-label">' + esc(command.label) + '</span>' +
          (command.hint ? '<span class="palette-hint">' + esc(command.hint) + '</span>' : '') +
        '</li>';
    }).join('') : '<li class="palette-empty">No matches</li>';

    $all('.palette-item', list).forEach(function (item) {
      item.addEventListener('mousemove', function () {
        const index = Number(item.dataset.index);
        if (index !== ui.paletteIndex) {
          ui.paletteIndex = index;
          $all('.palette-item', list).forEach(function (el) {
            el.classList.toggle('active', Number(el.dataset.index) === index);
          });
        }
      });
      item.addEventListener('click', function () {
        runPaletteItem(ui.paletteItems[Number(item.dataset.index)]);
      });
    });
    if (keepScroll) {
      const active = $('.palette-item.active', list);
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }

  function runPaletteItem(command) {
    if (!command) return;
    closePalette();
    command.run();
  }

  function openPalette() {
    if (!inApp()) return;
    ensurePalette();
    const backdrop = document.getElementById('palette');
    const input = document.getElementById('palette-input');
    ui.lastFocus = document.activeElement;
    backdrop.hidden = false;
    input.value = '';
    ui.paletteIndex = 0;
    renderPalette();
    requestAnimationFrame(function () { input.focus(); });
  }

  function closePalette() {
    const backdrop = document.getElementById('palette');
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus();
  }

  // ---------- shortcuts overlay ----------

  function openShortcuts() {
    if (document.getElementById('shortcuts')) return;
    const rows = [
      ['Ctrl/⌘ K', 'Command palette'],
      ['/', 'Search projects'],
      ['N', 'New brief'],
      ['G then C / O / H', 'Catalog / Operator / Guide'],
      ['G then P / V / G', 'Plan / Verify / Generate'],
      ['E', 'Edit current brief'],
      ['T', 'Toggle dark mode'],
      ['Ctrl/⌘ Enter', 'Draft brief from idea'],
      ['Esc', 'Close dialogs']
    ];
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    backdrop.id = 'shortcuts';
    backdrop.innerHTML =
      '<div class="palette shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">' +
        '<h3 id="shortcuts-title">Keyboard shortcuts</h3>' +
        '<dl>' + rows.map(function (row) {
          const keys = row[0] === '/' ? ['/'] : row[0].split(' ');
          return '<dt>' + keys.map(function (k) {
            const separator = row[0] !== '/' && (k === 'then' || k === '/');
            return separator ? '<span>' + k + '</span>' : '<kbd>' + esc(k) + '</kbd>';
          }).join(' ') + '</dt><dd>' + row[1] + '</dd>';
        }).join('') + '</dl>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="shortcuts-close">Close</button>' +
      '</div>';
    document.body.appendChild(backdrop);
    const close = function () { backdrop.remove(); };
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop) close();
    });
    document.getElementById('shortcuts-close').addEventListener('click', close);
    document.getElementById('shortcuts-close').focus();
  }

  // ---------- global keyboard ----------

  let pendingG = 0;
  document.addEventListener('keydown', function (event) {
    const paletteOpen = document.getElementById('palette') && !document.getElementById('palette').hidden;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (!inApp()) return;
      event.preventDefault();
      if (paletteOpen) closePalette();
      else openPalette();
      return;
    }
    if (event.key === 'Escape') {
      const shortcuts = document.getElementById('shortcuts');
      if (shortcuts) shortcuts.remove();
      if (paletteOpen) closePalette();
      return;
    }
    if (paletteOpen || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey || !inApp()) return;
    if (document.querySelector('.operator-modal-backdrop')) return;

    const key = event.key.toLowerCase();
    if (pendingG && Date.now() - pendingG < 1200) {
      pendingG = 0;
      const map = { c: 'catalog', o: 'operator', h: 'guide', b: 'brief' };
      const projectMap = { p: 'plan', v: 'verify', g: 'generate' };
      if (map[key]) navigateTo(map[key]);
      else if (projectMap[key] && state.currentProject) navigateTo(projectMap[key]);
      event.preventDefault();
      return;
    }
    if (key === 'g') {
      pendingG = Date.now();
      return;
    }
    if (event.key === '?') {
      event.preventDefault();
      openShortcuts();
    } else if (key === '/') {
      event.preventDefault();
      navigateTo('catalog');
      setTimeout(function () {
        const search = document.getElementById('catalog-search');
        if (search) search.focus();
      }, 60);
    } else if (key === 'n') {
      event.preventDefault();
      navigateTo('brief');
      setTimeout(function () {
        const intake = document.getElementById('operator-input');
        if (intake) intake.focus();
      }, 60);
    } else if (key === 't') {
      toggleTheme();
    } else if (key === 'e' && state.currentProject && !isDemo(state.currentProject)) {
      startEditProject(state.currentProject.id);
    }
  });

  // ---------- navigation + shell ----------

  const originalNavigateTo = window.navigateTo;
  window.navigateTo = function (section) {
    // Project pages need a project; without one (stale link, shortcut, back button) show the catalog.
    if (PROJECT_SECTIONS.indexOf(section) !== -1 && !state.currentProject) section = 'catalog';
    if (section !== 'brief' && ui.editingId) {
      setEditMode(null);
      fillBriefForm({ idea: '', successChecks: [''] });
    }
    const result = originalNavigateTo.call(this, section);
    if (inApp()) {
      ui.section = section;
      rememberSection(section);
    }
    if (section === 'brief') {
      ensureBriefChrome();
      setTimeout(maybeRestoreDraft, 0);
      updateBriefMeter();
    }
    syncShell();
    if (PROJECT_SECTIONS.indexOf(section) !== -1) renderFlowbar(section);
    return result;
  };

  function ensurePaletteButton() {
    const actions = $('.masthead-actions');
    if (!actions || document.getElementById('palette-btn')) return;
    const button = document.createElement('button');
    button.className = 'palette-trigger';
    button.id = 'palette-btn';
    button.type = 'button';
    button.title = 'Command palette (Ctrl/⌘ K)';
    button.setAttribute('aria-label', 'Open command palette');
    button.style.display = 'none';
    button.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<span class="palette-trigger-text">Jump to…</span><kbd>⌘K</kbd>';
    button.addEventListener('click', openPalette);
    actions.insertBefore(button, actions.firstChild);
  }

  function syncShell() {
    const button = document.getElementById('palette-btn');
    if (button) button.style.display = inApp() ? 'inline-flex' : 'none';
    document.body.classList.toggle('sweep-in-app', inApp());
    syncBottomNav();
  }

  // ---------- visual chrome: brand mark + login hero ----------

  function ensureBrandMark() {
    const brand = $('.masthead-brand');
    if (!brand || $('.brand-mark', brand)) return;
    const text = document.createElement('div');
    text.className = 'brand-text';
    while (brand.firstChild) text.appendChild(brand.firstChild);
    const mark = document.createElement('span');
    mark.className = 'brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 16c3.5-1 6-3.6 8-7.5" opacity=".55"/>' +
        '<path d="M8 19c4.5-1.2 8-5 10.5-11"/>' +
        '<polyline points="14.5 7.5 18.5 7.5 18.5 11.5"/>' +
      '</svg>';
    brand.appendChild(mark);
    brand.appendChild(text);
  }

  function ensureGateHero() {
    const section = document.getElementById('section-gate');
    const card = section && $('.gate-card', section);
    if (!card || $('.gate-layout', section)) return;
    const layout = document.createElement('div');
    layout.className = 'gate-layout';
    const hero = document.createElement('div');
    hero.className = 'gate-hero';
    const check = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9.5"/></svg>';
    hero.innerHTML =
      '<span class="gate-hero-kicker"><i></i>Offline · Encrypted · No AI calls</span>' +
      '<h1>Turn a rough idea into a plan you can <em>check off</em>.</h1>' +
      '<p class="gate-hero-lead">Describe your app in plain words. Sweep drafts the brief, builds a Build → Grow → Earn plan and the gates that prove it is done — all in your browser.</p>' +
      '<div class="gate-flow" aria-hidden="true">' +
        '<div class="flow-card"><div class="flow-step">Step 1</div><div class="flow-title">Idea</div>' +
          '<div class="flow-idea">“a habit tracker with streaks for busy people”</div></div>' +
        '<div class="flow-card"><div class="flow-step">Step 2</div><div class="flow-title">Plan</div>' +
          '<div class="flow-bars"><span style="--w:72%"></span><span style="--w:45%"></span><span style="--w:28%"></span></div></div>' +
        '<div class="flow-card"><div class="flow-step">Step 3</div><div class="flow-title">Verify</div>' +
          '<ul class="flow-checks"><li class="on">Smoke gate</li><li class="on">Mobile layout</li><li>Ship it</li></ul></div>' +
      '</div>' +
      '<ul class="gate-features">' +
        '<li>' + check + 'Capability matrix &amp; Definition of Done</li>' +
        '<li>' + check + 'Spec Score grades your brief A–D with fixes</li>' +
        '<li>' + check + 'Kiro-style requirements, design &amp; task board</li>' +
        '<li>' + check + 'One-click handoff to Lovable, v0, Cursor, Claude Code</li>' +
      '</ul>';
    section.insertBefore(layout, card);
    layout.appendChild(hero);
    layout.appendChild(card);
  }

  wrap('enterApp', syncShell);
  wrap('signOut', function () {
    setEditMode(null);
    closePalette();
    syncShell();
  });

  window.addEventListener('scroll', function () {
    document.body.classList.toggle('is-scrolled', window.scrollY > 8);
  }, { passive: true });


  // ---------- v20: project flow bar · phone bottom nav · back button ----------

  function generatedFileCount(project) {
    const cacheKey = project.id + ':' + (project.capabilityMatrix && project.capabilityMatrix.backend.on ? 'b' : 's') + ':' + (window.SweepStudio ? 'st' : '');
    if (!(cacheKey in fileCounts)) {
      try {
        fileCounts[cacheKey] = Object.keys(generateProjectFiles(project)).length;
      } catch (error) {
        fileCounts[cacheKey] = 0;
      }
    }
    return fileCounts[cacheKey];
  }

  // Status shown under each step; null hides the step (e.g. Studio when studio.js is removed).
  function flowStatus(project, key) {
    if (key === 'plan') {
      const progress = projectProgress(project);
      return { meta: progress.percent + '%', done: progress.percent === 100 };
    }
    if (key === 'studio') {
      const studio = window.SweepStudio;
      if (!document.getElementById('section-studio') || !studio || typeof studio.scoreSpec !== 'function') return null;
      const score = studio.scoreSpec(project);
      return { meta: 'Spec ' + score.grade + ' · ' + score.score, done: score.grade === 'A' };
    }
    if (key === 'verify') {
      const gates = project.capabilityMatrix ? getVerifyGates(project) : [];
      const gateState = verifyGateState(project);
      const passed = gates.filter(function (gate, i) { return gateState['gate-' + i]; }).length;
      return { meta: passed + '/' + gates.length + ' gates', done: project.status === 'verified' || (gates.length > 0 && passed === gates.length) };
    }
    return { meta: generatedFileCount(project) + ' files', done: false };
  }

  function renderFlowbar(sectionKey) {
    const section = document.getElementById('section-' + sectionKey);
    if (!section) return;
    const project = state.currentProject;
    let bar = $('.flowbar', section);
    if (!project || !project.capabilityMatrix || !inApp()) {
      if (bar) bar.hidden = true;
      return;
    }
    if (!bar) {
      bar = document.createElement('nav');
      bar.className = 'flowbar';
      bar.setAttribute('aria-label', 'Project steps');
      const header = $('.section-header', section);
      if (header) header.insertAdjacentElement('afterend', bar);
      else section.insertBefore(bar, section.firstChild);
      bar.addEventListener('click', function (event) {
        const step = event.target.closest('[data-flow]');
        if (step && step.getAttribute('aria-current') !== 'step') navigateTo(step.getAttribute('data-flow'));
      });
      section.classList.add('has-flowbar');
    }
    // The flow bar replaces the plan header's Studio / Verify / Generate buttons.
    if (sectionKey === 'plan') {
      $all('.section-actions button', section).forEach(function (button) {
        const onclick = button.getAttribute('onclick') || '';
        if (button.id === 'plan-studio-btn' || /navigateTo\('(verify|generate)'\)/.test(onclick)) button.classList.add('flow-dup');
      });
    }
    let index = 0;
    const steps = FLOW_STEPS.map(function (step) {
      const status = flowStatus(project, step.key);
      if (!status) return '';
      index += 1;
      const current = step.key === sectionKey;
      return '<li><button type="button" class="flowbar-step' + (current ? ' is-current' : '') + (status.done ? ' is-done' : '') + '" data-flow="' + step.key + '"' + (current ? ' aria-current="step"' : '') + '>' +
        '<span class="flowbar-dot" aria-hidden="true">' + (status.done ? '✓' : index) + '</span>' +
        '<span class="flowbar-text"><span class="flowbar-label">' + step.label + '</span><span class="flowbar-meta">' + esc(status.meta) + '</span></span>' +
        '</button></li>';
    }).join('');
    bar.hidden = false;
    bar.innerHTML =
      '<div class="flowbar-project"><span class="flowbar-name">' + esc(project.name) + '</span>' +
        (isDemo(project) ? '<span class="flowbar-tag">Demo</span>' : '') + '</div>' +
      '<ol class="flowbar-steps">' + steps + '</ol>';
  }

  // mobile.html: bottom tab bar driven by state (works for returning sessions and sign-out too).
  function syncBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    nav.hidden = !inApp();
    const projectTab = $('[data-section="plan"]', nav);
    if (projectTab) projectTab.hidden = !state.currentProject;
    const activeKey = PROJECT_SECTIONS.indexOf(ui.section) !== -1 ? 'plan' : ui.section;
    $all('[data-section]', nav).forEach(function (link) {
      const active = link.dataset.section === activeKey;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function bindBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav || nav.dataset.bound) return;
    nav.dataset.bound = '1';
    nav.addEventListener('click', function (event) {
      const link = event.target.closest('[data-section]');
      if (!link) return;
      event.preventDefault();
      navigateTo(link.dataset.section);
    });
  }

  // Back button / swipe-back moves between sections instead of leaving the app; with a dialog
  // open, it closes the dialog first.
  let restoringHistory = false;

  function rememberSection(section) {
    if (restoringHistory || !window.history || typeof history.pushState !== 'function') return;
    const current = history.state && history.state.sweepSection;
    if (current === section) return;
    try {
      if (current) history.pushState({ sweepSection: section }, '');
      else history.replaceState({ sweepSection: section }, '');
    } catch (error) {
      /* history unavailable (sandboxed frame) */
    }
  }

  function closeTopDialog() {
    const dialogs = $all('[role="dialog"][aria-modal="true"]').filter(function (dialog) {
      return dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden';
    });
    const top = dialogs[dialogs.length - 1];
    if (!top) return false;
    top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }

  window.addEventListener('popstate', function (event) {
    const target = event.state && event.state.sweepSection;
    if (!target || !inApp()) return;
    if (closeTopDialog()) {
      try {
        history.pushState({ sweepSection: ui.section || target }, '');
      } catch (error) {
        /* ignore */
      }
      return;
    }
    restoringHistory = true;
    try {
      navigateTo(PROJECT_SECTIONS.indexOf(target) !== -1 && !state.currentProject ? 'catalog' : target);
    } finally {
      restoringHistory = false;
    }
  });

  wrap('updateNavForProject', syncBottomNav);
  wrap('markVerified', function () {
    renderFlowbar('verify');
  });

  // Boot: app.js already ran init(); re-render what is on screen so the
  // enhancements apply to the first paint as well.
  ensureBrandMark();
  ensureGateHero();
  ensurePaletteButton();
  ensureBriefChrome();
  bindBottomNav();
  if (inApp()) {
    const visible = $all('main .section').find(function (section) {
      return section.id !== 'section-gate' && section.style.display !== 'none';
    });
    ui.section = visible ? visible.id.replace('section-', '') : 'catalog';
    rememberSection(ui.section);
  }
  syncShell();
  if (inApp()) {
    renderCatalog();
    const active = $('.section.active');
    if (active && active.id === 'section-plan' && state.currentProject) renderPlanView(state.currentProject);
  }

  window.SweepEnhance = {
    renderFlowbar: renderFlowbar,
    projectProgress: projectProgress,
    openPalette: openPalette,
    duplicateProject: duplicateProject,
    deleteProject: deleteProject
  };
})();
