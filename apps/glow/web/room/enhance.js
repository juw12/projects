// GlowRoom desktop enhancements.
// Hooks into the dashboard via window.__office (set in index.html) and the
// 'office-event' CustomEvent fired for every processed bot event.
(function () {
  'use strict';

  const BRAND = 'GlowRoom';

  const TEMPLATES = {
    leader: ['Plan this week\'s sprint', 'Summarise team progress', 'Unblock stalled tasks'],
    media: ['Design a launch banner', 'Write a product tweet', 'Make a demo GIF'],
    coder: ['Fix the login bug', 'Add dark mode', 'Refactor the API client'],
    tester: ['Run regression tests', 'Write e2e tests for checkout', 'Check mobile layout'],
    checker: ['Review open pull requests', 'Security scan', 'Check code style'],
    explore: ['Compare 3 competitors', 'Find the best charting library', 'Summarise latest AI papers']
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  let office = null;
  const eventTimes = [];

  // ------------------------------------------------------------------
  // Branding
  // ------------------------------------------------------------------
  function applyBrand() {
    document.title = BRAND + ' — 3D Office';
    document.querySelectorAll('[data-i18n="app.title"]').forEach(el => { el.textContent = BRAND; });
    document.querySelectorAll('img[alt="Virtual Bots Office"]').forEach(img => { img.alt = BRAND; });
    const dict = office.I18N && office.I18N.translations;
    if (dict) {
      Object.values(dict).forEach(lang => {
        if (lang['app.title']) lang['app.title'] = BRAND;
        Object.keys(lang).forEach(key => {
          if (typeof lang[key] === 'string') {
            lang[key] = lang[key].replace(/Virtual Bots Office/g, BRAND);
          }
        });
      });
    }
  }

  // ------------------------------------------------------------------
  // KPI strip in the header
  // ------------------------------------------------------------------
  function buildKpis() {
    const left = document.querySelector('.header .header-left');
    if (!left) return;
    const wrap = document.createElement('div');
    wrap.className = 'cr-kpis';
    wrap.innerHTML = `
      <div class="cr-kpi"><b id="cr-working">0</b><span>Working</span></div>
      <div class="cr-load" title="Crew load"><i id="cr-load"></i></div>
      <div class="cr-kpi"><b id="cr-done">0</b><span>Results</span></div>
      <div class="cr-kpi"><b id="cr-epm">0</b><span>Events / min</span></div>
      <canvas class="cr-spark" id="cr-spark" width="280" height="64" aria-hidden="true"></canvas>`;
    left.appendChild(wrap);

    const right = document.querySelector('.header .header-right');
    if (right) {
      const btn = document.createElement('button');
      btn.className = 'cr-kbd-btn';
      btn.type = 'button';
      btn.title = 'Command palette';
      const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
      btn.innerHTML = `Search &amp; commands <kbd>${mod}</kbd><kbd>K</kbd>`;
      btn.addEventListener('click', openPalette);
      right.insertBefore(btn, right.firstChild);

      const results = document.createElement('button');
      results.className = 'cr-kbd-btn cr-results-btn';
      results.type = 'button';
      results.innerHTML = 'Results <span class="cr-count" id="cr-run-count"></span>';
      results.addEventListener('click', () => window.CrewEngine && CrewEngine.openHistory());
      right.insertBefore(results, btn);

      const ai = document.createElement('button');
      ai.className = 'cr-kbd-btn cr-ai-btn';
      ai.type = 'button';
      ai.id = 'cr-ai-btn';
      ai.title = 'AI settings';
      ai.addEventListener('click', () => window.CrewEngine && CrewEngine.openSettings());
      right.insertBefore(ai, results);

      // Glow app switcher (shared with Glow home and GlowChat): same account, same AI.
      const glowLink = document.createElement('button');
      glowLink.type = 'button';
      glowLink.className = 'cr-kbd-btn cr-glow-link';
      glowLink.id = 'glow-apps-btn';
      glowLink.title = 'Glow apps: Glow home, GlowChat and GlowRoom';
      glowLink.innerHTML = '<i class="cr-glow-mark">✦</i>Glow apps';
      right.insertBefore(glowLink, ai);
      if (window.GlowApps) window.GlowApps.mount(glowLink);
      updateAiButton();
    }
  }

  function updateAiButton() {
    const ai = document.getElementById('cr-ai-btn');
    if (!ai || !window.CrewEngine) return;
    const s = CrewEngine.getSettings();
    const isGlow = s.provider === 'glow';
    ai.classList.toggle('glow', s.realMode && isGlow);
    ai.innerHTML = s.realMode
      ? `${isGlow ? '<i class="cr-glow-mark">✦</i>' : '<i class="cr-ai-dot"></i>'}${esc(CrewEngine.providerLabel())}`
      : '<i class="cr-ai-dot off"></i>Demo mode';
    const running = CrewEngine.runs.filter(r => r.status === 'running').length;
    const count = document.getElementById('cr-run-count');
    if (count) count.textContent = running ? running + ' live' : (CrewEngine.runs.length || '');
  }

  let finishedCount = 0;

  function updateKpis() {
    const keys = crewKeys();
    const working = keys.filter(k => office.state.bots[k]?.state === 'working').length;
    const el = id => document.getElementById(id);
    if (!el('cr-working')) return;
    el('cr-working').innerHTML = `${working}<small>/${keys.length}</small>`;
    el('cr-load').style.width = (working / keys.length * 100).toFixed(0) + '%';
    el('cr-done').textContent = window.CrewEngine ? CrewEngine.runs.filter(r => r.status === 'done').length : finishedCount;

    const now = Date.now();
    while (eventTimes.length && now - eventTimes[0] > 120000) eventTimes.shift();
    el('cr-epm').textContent = eventTimes.filter(t => now - t <= 60000).length;
    drawSpark(now);
  }

  function drawSpark(now) {
    const canvas = document.getElementById('cr-spark');
    if (!canvas || !canvas.offsetWidth) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const buckets = 30;
    const counts = new Array(buckets).fill(0);
    eventTimes.forEach(t => {
      const idx = buckets - 1 - Math.floor((now - t) / (120000 / buckets));
      if (idx >= 0 && idx < buckets) counts[idx]++;
    });
    const max = Math.max(3, ...counts);
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#d97757');
    grad.addColorStop(1, '#e7b75d');
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(217,119,87,.32)');
    fill.addColorStop(1, 'rgba(217,119,87,0)');
    ctx.beginPath();
    counts.forEach((c, i) => {
      const x = i / (buckets - 1) * w;
      const y = h - 6 - c / max * (h - 14);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // ------------------------------------------------------------------
  // Bot dock
  // ------------------------------------------------------------------
  function buildDock() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    const dock = document.createElement('nav');
    dock.className = 'cr-dock';
    dock.id = 'cr-dock';
    dock.setAttribute('aria-label', 'Crew');
    viewport.appendChild(dock);

    const toasts = document.createElement('div');
    toasts.className = 'cr-toasts';
    toasts.id = 'cr-toasts';
    toasts.setAttribute('aria-live', 'polite');
    viewport.appendChild(toasts);

    dock.addEventListener('click', e => {
      const chip = e.target.closest('[data-bot]');
      if (!chip) return;
      focusBot(chip.dataset.bot);
    });
    renderDock();
  }

  function focusBot(key) {
    office.app.ui.selectAgent(key);
    const select = document.getElementById('command-agent');
    if (select && [...select.options].some(o => o.value === key)) {
      select.value = key;
      select.dispatchEvent(new Event('change'));
    }
    renderDock();
  }

  function renderDock() {
    const dock = document.getElementById('cr-dock');
    if (!dock) return;
    const r = 11;
    const circ = 2 * Math.PI * r;
    dock.innerHTML = crewKeys().map(key => [key, office.BOT_CONFIG[key]]).map(([key, cfg]) => {
      const bs = office.state.bots[key] || {};
      const status = bs.state || 'idle';
      const np = bs.nameplate || {};
      let pct = 0;
      if (status === 'working') {
        pct = np.progressPct != null ? np.progressPct : Math.min(0.9, (np.taskStepCount || 0) / 6 + 0.1);
      } else if (status === 'done') {
        pct = 1;
      }
      const toolLabels = {
        llm: 'Thinking…',
        search: 'Searching the web',
        web: 'Searching the web',
        fetch: 'Reading sources',
        js: 'Running code',
        code: 'Running code',
        test: 'Running tests',
      };
      const toolText = bs.tool ? (toolLabels[String(bs.tool).toLowerCase()] || bs.tool) : '';
      const sub = status === 'working'
        ? (bs.detail || toolText || 'Working')
        : (status === 'done' ? 'Just finished' : cfg.roleName);
      const selected = office.state.selectedAgent === key;
      return `
        <button class="cr-chip ${status} ${selected ? 'selected' : ''}" data-bot="${key}" style="--c:${cfg.color}"
                title="${esc(cfg.name)} — ${esc(cfg.roleName)}${bs.detail ? '\n' + esc(bs.detail) : ''}">
          <span class="cr-ava">
            <svg viewBox="0 0 30 30" width="30" height="30">
              <circle cx="15" cy="15" r="${r}" fill="none" stroke="rgba(148,163,184,.25)" stroke-width="2.5"/>
              <circle cx="15" cy="15" r="${r}" fill="none" stroke="${cfg.color}" stroke-width="2.5" stroke-linecap="round"
                stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(2)}"/>
            </svg>
            <span class="face">${esc(cfg.name[0])}</span>
            <span class="dot"></span>
          </span>
          <span class="cr-chip-text"><b>${esc(cfg.name)}</b><span>${esc(sub)}</span></span>
        </button>`;
    }).join('');
  }

  function pulseChip(key) {
    const chip = document.querySelector(`.cr-chip[data-bot="${key}"]`);
    if (!chip) return;
    chip.classList.remove('pulse');
    void chip.offsetWidth;
    chip.classList.add('pulse');
  }

  // ------------------------------------------------------------------
  // Toasts
  // ------------------------------------------------------------------
  let lastToastAt = 0;

  function toast(html, color, important) {
    const now = Date.now();
    if (!important && now - lastToastAt < 1800) return;
    lastToastAt = now;
    const box = document.getElementById('cr-toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'cr-toast';
    el.style.setProperty('--c', color);
    el.innerHTML = `<i></i><span>${html}</span>`;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, important ? 5000 : 3000);
  }

  function onOfficeEvent(e) {
    const ev = e.detail || {};
    eventTimes.push(Date.now());
    const cfg = office.BOT_CONFIG[ev.agent];
    if (cfg) {
      pulseChip(ev.agent);
      if (ev.phase === 'end') {
        finishedCount++;
        toast(`<b>${esc(cfg.name)}</b> finished · ${esc(ev.detail || ev.tool || 'task')}`, cfg.color, false);
      } else if (ev.phase === 'error') {
        toast(`<b>${esc(cfg.name)}</b> hit an error · ${esc(ev.detail || ev.tool || '')}`, '#ef4444', true);
      }
    }
    renderDock();
    updateKpis();
  }

  // ------------------------------------------------------------------
  // Console: goal templates, @mentions, Cmd/Ctrl+Enter
  // ------------------------------------------------------------------
  function enhanceConsole() {
    const goal = document.getElementById('command-goal');
    const agent = document.getElementById('command-agent');
    if (!goal || !agent) return;

    const row = goal.closest('.command-row');
    const tplBox = document.createElement('div');
    tplBox.className = 'cr-templates';
    row.appendChild(tplBox);
    goal.title = 'Start with @name to pick a bot · Ctrl/⌘+Enter to send';

    goal.placeholder = 'Describe the goal… e.g. @byte fix the login bug';

    function renderTemplates() {
      const list = TEMPLATES[agent.value] || TEMPLATES.leader;
      tplBox.innerHTML = list.map(t => `<button type="button" class="cr-tpl">${esc(t)}</button>`).join('');
    }
    tplBox.addEventListener('click', e => {
      const btn = e.target.closest('.cr-tpl');
      if (!btn) return;
      goal.value = btn.textContent;
      goal.focus();
    });
    agent.addEventListener('change', renderTemplates);
    renderTemplates();

    // @mention picks the agent by key or display name, then strips the mention on send.
    goal.addEventListener('input', () => {
      const match = goal.value.match(/^@(\w+)/);
      if (!match) return;
      const needle = match[1].toLowerCase();
      const key = Object.keys(office.BOT_CONFIG).find(k =>
        k === needle || office.BOT_CONFIG[k].name.toLowerCase() === needle);
      if (key && [...agent.options].some(o => o.value === key) && agent.value !== key) {
        agent.value = key;
        renderTemplates();
        pulseChip(key);
      }
    });
    goal.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        goal.value = goal.value.replace(/^@\w+\s*/, '');
        document.getElementById('command-send')?.click();
      }
    });
    document.getElementById('command-send')?.addEventListener('click', () => {
      goal.value = goal.value.replace(/^@\w+\s*/, '');
    }, true);
  }

  // ------------------------------------------------------------------
  // Real AI: console → CrewEngine, engine events → 3D office feed
  // ------------------------------------------------------------------
  let pausedMockFeed = false;
  let resumeTimer = null;

  function realModeOn() {
    return window.CrewEngine && CrewEngine.getSettings().realMode;
  }

  // The bots that do real work (the rest of the office is scenery).
  function crewKeys() {
    const all = Object.keys(office.BOT_CONFIG);
    if (!window.CrewEngine) return all;
    return all.filter(k => CrewEngine.BOTS[k]);
  }

  // With real AI on, the canned demo feed would show fake work as if it were real. Keep it off
  // unless the user explicitly turns the simulation on.
  function silenceDemoFeed() {
    const feed = office.app && office.app.feed;
    if (!feed || !realModeOn() || office.state.simulating) return;
    if (feed.constructor && feed.constructor.name === 'MockFeed' && feed.isPlaying) {
      feed.stop();
      Object.keys(office.BOT_CONFIG).forEach(key => {
        const bs = office.state.bots[key];
        if (bs && bs.state === 'working' && !CrewEngine.runs.some(r => r.status === 'running')) {
          office.app.ui.updateBotState(key, 'end', null, 'Ready', null);
        }
      });
    }
  }

  function startRealRun(goal, agent) {
    // Leader = whole crew (Nova plans); any other bot = that bot alone.
    const run = CrewEngine.start(goal, { bots: agent && agent !== 'leader' ? [agent] : [] });
    CrewEngine.openRun(run.id);
    office.app.ui.showCommandStatus?.(`✓ ${agent && agent !== 'leader' ? office.BOT_CONFIG[agent]?.name || agent : 'The crew'} is on it — watch the Results panel`, 'success');
    office.app.ui.addToCommandHistory?.(goal);
    updateAiButton();
    return run;
  }

  function interceptConsole() {
    const send = document.getElementById('command-send');
    const goalEl = document.getElementById('command-goal');
    const agentEl = document.getElementById('command-agent');
    if (!send || !goalEl || !agentEl) return;
    send.addEventListener('click', e => {
      if (!realModeOn()) return;
      const goal = goalEl.value.replace(/^@\w+\s*/, '').trim();
      if (!goal || /^simulate( office)?$/i.test(goal)) return; // let the original handler deal with these
      e.preventDefault();
      e.stopImmediatePropagation();
      goalEl.value = '';
      startRealRun(goal, agentEl.value);
    }, true);
    const label = send.querySelector('[data-i18n="console.send"]');
    if (label && realModeOn()) label.textContent = 'Run with AI';
  }

  function feedOffice(ev) {
    const feed = office.app.feed;
    if (!feed || !office.BOT_CONFIG[ev.agent]) return;
    // The demo feed loops canned events; pause it while real work is happening.
    if (!office.state.simulating && feed.constructor && feed.constructor.name === 'MockFeed' && feed.isPlaying) {
      feed.stop();
      pausedMockFeed = true;
    }
    clearTimeout(resumeTimer);
    const event = {
      ts: new Date().toISOString(),
      session_id: ev.runId,
      agent: ev.agent,
      phase: ev.phase === 'error' ? 'error' : ev.phase,
      tool: ev.tool,
      detail: ev.detail,
      goal_id: ev.runId
    };
    feed.subscribers.forEach(cb => {
      try {
        cb(event);
      } catch (err) {
        console.warn(err);
      }
    });
  }

  function wireEngine() {
    if (!window.CrewEngine) return;
    interceptConsole();
    CrewEngine.on('bot', feedOffice);
    CrewEngine.on('notice', message => toast(`<b style="--c:#f59e0b">✦ Glow</b> · ${esc(message)}`, '#f59e0b'));
    CrewEngine.on('settings', () => {
      updateAiButton();
      silenceDemoFeed();
      const label = document.querySelector('#command-send [data-i18n="console.send"]');
      if (label) label.textContent = realModeOn() ? 'Run with AI' : 'Send Command';
    });
    CrewEngine.on('finished', run => {
      updateAiButton();
      const drawerOpen = document.querySelector('.crx-drawer.open');
      if (run.status === 'done' && !drawerOpen && !(run.meta && run.meta.autoOpen)) {
        toast(`<b style="--c:#10b981">Result ready</b> · ${esc(CrewEngine.goalTitle(run.goal))} — <a href="#" data-open-run="${run.id}" style="color:#8b9cff">View</a>`, '#10b981', true);
      } else if (run.status === 'error') {
        toast(`<b>Couldn't finish</b> · ${esc(run.error || '')}`, '#ef4444', true);
      }
      // Only resume the canned demo feed when real AI is switched off.
      if (pausedMockFeed && !realModeOn() && !CrewEngine.runs.some(r => r.status === 'running')) {
        resumeTimer = setTimeout(() => {
          if (office.state.isPlaying && office.app.feed && !office.app.feed.isPlaying) office.app.feed.start();
          pausedMockFeed = false;
        }, 15000);
      }
    });
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-open-run]');
      if (a) {
        e.preventDefault();
        CrewEngine.openRun(a.dataset.openRun);
      }
    });
  }

  // ------------------------------------------------------------------
  // Command palette (Cmd/Ctrl+K)
  // ------------------------------------------------------------------
  let paletteEl = null;
  let paletteItems = [];
  let paletteIndex = 0;

  function clickMenu(action, value) {
    document.querySelector(`.menu-dropdown-item[data-action="${action}"][data-value="${value}"]`)?.click();
  }

  function commands() {
    const list = [];
    if (window.CrewEngine) {
      list.push(
        { label: 'AI settings (provider, API key, model)', group: 'AI', run: () => CrewEngine.openSettings() },
        { label: 'View results', group: 'AI', run: () => CrewEngine.openHistory() }
      );
    }
    Object.entries(office.BOT_CONFIG).forEach(([key, cfg]) => {
      list.push({ label: `Focus ${cfg.name} — ${cfg.roleName}`, group: 'Bots', color: cfg.color, run: () => focusBot(key) });
    });
    ['leader', 'media', 'coder', 'tester', 'checker', 'explore'].forEach(key => {
      const cfg = office.BOT_CONFIG[key];
      if (!cfg) return;
      list.push({
        label: `Give ${cfg.name} a goal…`, group: 'Dispatch', color: cfg.color,
        run: () => {
          const agent = document.getElementById('command-agent');
          agent.value = key;
          agent.dispatchEvent(new Event('change'));
          if (!office.state.panels.console) office.app.ui.togglePanel('console');
          document.getElementById('command-goal')?.focus();
        }
      });
    });
    list.push(
      { label: 'Start / stop simulation', group: 'Office', run: () => document.getElementById('command-simulate')?.click() },
      { label: 'Pause / resume live feed', group: 'Office', run: () => document.getElementById('play-pause')?.click() },
      { label: 'View: 3D office', group: 'View', run: () => setMode('3d') },
      { label: 'View: Isometric', group: 'View', run: () => setMode('isometric') }
    );
    [['modern', 'Modern'], ['loft', 'Loft'], ['nightcity', 'Night city'], ['space', 'Space station'], ['zen', 'Zen garden'], ['minimal', 'Minimal']]
      .forEach(([v, l]) => list.push({ label: `Environment: ${l}`, group: 'View', run: () => clickMenu('set-environment', v) }));
    [['midnight', 'Midnight'], ['dark', 'Dark'], ['slate', 'Slate'], ['light', 'Light']]
      .forEach(([v, l]) => list.push({ label: `Theme: ${l}`, group: 'Theme', run: () => office.app.ui.setTheme(v) }));
    [['roster', 'Roster'], ['inspector', 'Inspector'], ['console', 'Command console'], ['events', 'Event log'], ['job', 'Job / chat'], ['org', 'Org chart'], ['settings', 'Settings']]
      .forEach(([v, l]) => list.push({ label: `Toggle panel: ${l}`, group: 'Panels', run: () => office.app.ui.togglePanel(v) }));
    list.push(
      { label: 'Open mobile view', group: 'Go', run: () => { location.href = 'mobile.html'; } },
      { label: 'Install as app', group: 'Go', run: () => { location.href = 'app.html'; } },
      { label: 'Keyboard shortcuts', group: 'Help', run: () => document.querySelector('[data-action="open-help"]')?.click() }
    );
    return list;
  }

  function setMode(mode) {
    office.state.mode = mode;
    window.dispatchEvent(new CustomEvent('mode-change', { detail: { mode } }));
    document.querySelectorAll('#menu-view .menu-dropdown-item[data-action="set-mode"]').forEach(i => {
      i.classList.toggle('active', i.dataset.value === mode);
    });
  }

  // Subsequence fuzzy match; returns score (higher is better) or -1.
  function fuzzy(query, text) {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const direct = t.indexOf(q);
    if (direct >= 0) return 1000 - direct;
    let ti = 0;
    let score = 0;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return -1;
      score += found === ti ? 3 : 1;
      ti = found + 1;
    }
    return score;
  }

  function highlight(text, query) {
    const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + query.length)) + '</mark>' + esc(text.slice(i + query.length));
  }

  function buildPalette() {
    paletteEl = document.createElement('div');
    paletteEl.className = 'cr-palette-backdrop';
    paletteEl.innerHTML = `
      <div class="cr-palette" role="dialog" aria-label="Command palette">
        <input type="text" placeholder="Type a command, bot name, theme…" aria-label="Command">
        <ul role="listbox"></ul>
        <div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div>
      </div>`;
    document.body.appendChild(paletteEl);
    const input = paletteEl.querySelector('input');
    const ul = paletteEl.querySelector('ul');

    function render() {
      const q = input.value.trim();
      paletteItems = commands()
        .map(c => ({ ...c, score: fuzzy(q, c.label + ' ' + c.group) }))
        .filter(c => c.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
      // Anything that reads like a request becomes "Ask the crew".
      if (q.split(/\s+/).length >= 3 && realModeOn()) {
        paletteItems.unshift({
          label: `Ask the crew: “${q}”`,
          group: 'AI',
          color: '#8b5cf6',
          run: () => startRealRun(q, 'leader')
        });
      }
      paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
      ul.innerHTML = paletteItems.length
        ? paletteItems.map((c, i) => `
            <li class="${i === paletteIndex ? 'active' : ''}" data-i="${i}" role="option" style="--c:${c.color || '#6d7cff'}">
              <span class="sw"></span><span>${highlight(c.label, q)}</span><span class="grp">${esc(c.group)}</span>
            </li>`).join('')
        : '<div class="empty">No matching commands</div>';
      ul.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
    }

    function runAt(i) {
      const cmd = paletteItems[i];
      closePalette();
      if (cmd) cmd.run();
    }

    input.addEventListener('input', () => {
      paletteIndex = 0;
      render();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteIndex = (paletteIndex + 1) % Math.max(1, paletteItems.length);
        render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = (paletteIndex - 1 + paletteItems.length) % Math.max(1, paletteItems.length);
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runAt(paletteIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePalette();
      }
    });
    ul.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (li) runAt(Number(li.dataset.i));
    });
    paletteEl.addEventListener('click', e => {
      if (e.target === paletteEl) closePalette();
    });
    paletteEl._render = render;
  }

  function openPalette() {
    if (!paletteEl) buildPalette();
    const input = paletteEl.querySelector('input');
    input.value = '';
    paletteIndex = 0;
    paletteEl._render();
    paletteEl.classList.add('open');
    setTimeout(() => input.focus(), 0);
  }

  function closePalette() {
    paletteEl?.classList.remove('open');
  }

  function wireShortcuts() {
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteEl?.classList.contains('open')) {
          closePalette();
        } else {
          openPalette();
        }
      }
    }, true);
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function init() {
    office = window.__office;
    if (!office) return;
    applyBrand();
    buildKpis();
    buildDock();
    enhanceConsole();
    wireEngine();
    wireShortcuts();
    window.addEventListener('office-event', onOfficeEvent);
    // Keep dock/KPIs fresh for state changes that don't emit events (done → idle timers).
    setInterval(() => {
      silenceDemoFeed();
      renderDock();
      updateKpis();
    }, 1000);
    silenceDemoFeed();
    updateKpis();
  }

  if (window.__office) {
    init();
  } else {
    window.addEventListener('office-ready', init, { once: true });
  }
})();
