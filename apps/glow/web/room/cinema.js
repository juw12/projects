// GlowRoom cinematic layer for the 3D office.
//  - Command bar ("CEO seat") to give the crew a mission from inside the office
//  - Live speech bubbles projected above each 3D bot, streaming what it's really doing
//  - Event FX (✅ ❗ 🔎 …) popping above bots
//  - Mission pipeline strip with follow-cam, stop and open-result
//  - Cinema layout (office fills the screen) + first-visit welcome
(function () {
  'use strict';

  const CINEMA_KEY = 'crew-cinema';
  const WELCOME_KEY = 'crew-welcomed-v1';

  const IDEAS = [
    { label: 'Compare budget 3D printers', goal: 'What are the 3 best budget 3D printers right now? Compare price and build volume.', bots: ['explore'] },
    { label: 'Loan calculator', goal: 'Calculate the monthly payment and total interest for a $25,000 loan at 6.5% APR over 5 years, with the balance at the end of each year.', bots: ['coder'] },
    { label: 'Design a logo', goal: 'Design a minimalist SVG logo for a coffee shop called "Orbit Brew".', bots: ['media'] },
    { label: 'Plan a trip (whole crew)', goal: 'Plan a 3-day trip to Singapore on a mid-range budget: daily itinerary and estimated total cost in SGD.', bots: [] },
    { label: 'Launch tweet thread', goal: 'Write a 5-tweet launch thread for a new AI note-taking app, punchy and specific.', bots: ['media'] }
  ];

  const FX = {
    start: '⚡', end: '✅', error: '❗', web_search: '🔎', read_url: '📖', run_js: '⚙️', run_tests: '🧪',
    write_tests: '🧪', file_write: '⌨️', image_gen: '🎨', plan: '🧭', delegate: '📋', report: '📝', llm: '💭'
  };

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let office = null;
  let Engine = null;
  const ui = {
    picked: [],            // [] = whole crew (Nova plans)
    follow: true,
    missionId: null,
    camLook: null,
    bubbles: {},           // key -> { el, text, kind, until, typing }
    lastShownDone: 0
  };

  // ==================================================================
  // Layout: cinema mode + crew rail header
  // ==================================================================
  function setCinema(on) {
    document.body.classList.toggle('cr-cinema', on);
    localStorage.setItem(CINEMA_KEY, on ? '1' : '0');
    const btn = document.getElementById('cn-cinema-btn');
    if (btn) btn.classList.toggle('on', on);
    // Let the renderers re-measure the canvas.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
  }

  function addHeaderButtons() {
    const right = document.querySelector('.header .header-right');
    if (!right) return;
    const btn = document.createElement('button');
    btn.id = 'cn-cinema-btn';
    btn.className = 'cr-kbd-btn';
    btn.type = 'button';
    btn.title = 'Toggle side panels (cinema mode)';
    btn.textContent = 'Panels';
    btn.addEventListener('click', () => setCinema(!document.body.classList.contains('cr-cinema')));
    right.insertBefore(btn, right.firstChild);
  }

  function railHeader() {
    const dock = document.getElementById('cr-dock');
    if (!dock || dock.querySelector('.cr-rail-head')) return;
    const head = document.createElement('div');
    head.className = 'cr-rail-head';
    head.innerHTML = '<span>Crew</span><span id="cn-rail-count"></span>';
    dock.prepend(head);
  }

  // The enhance layer re-renders the dock every second; keep our header on top.
  function keepRailHeader() {
    const dock = document.getElementById('cr-dock');
    if (!dock) return;
    new MutationObserver(() => {
      if (!dock.querySelector('.cr-rail-head')) railHeader();
      const working = Object.keys(office.BOT_CONFIG).filter(k => office.state.bots[k]?.state === 'working').length;
      const c = document.getElementById('cn-rail-count');
      if (c) c.textContent = working ? working + ' busy' : 'idle';
    }).observe(dock, { childList: true });
    railHeader();
  }

  // ==================================================================
  // Command bar
  // ==================================================================
  function buildCommandBar() {
    const viewport = document.getElementById('viewport');
    const bar = document.createElement('div');
    bar.className = 'cn-command';
    bar.id = 'cn-command';
    const crew = ['leader', 'explore', 'coder', 'tester', 'checker', 'media'].filter(k => office.BOT_CONFIG[k]);
    bar.innerHTML = `
      <div class="cn-crew" id="cn-crew">
        <button class="cn-pick on" data-pick="" style="--c:#8b5cf6"><i>✦</i>Whole crew</button>
        ${crew.filter(k => k !== 'leader').map(k => {
          const c = office.BOT_CONFIG[k];
          return `<button class="cn-pick" data-pick="${k}" style="--c:${c.color}" title="${esc(c.roleName)}"><i>${esc(c.name[0])}</i>${esc(c.name)}</button>`;
        }).join('')}
      </div>
      <div class="cn-row">
        <textarea class="cn-input" id="cn-input" rows="1" placeholder="Give your crew a mission…" aria-label="Mission"></textarea>
        <button class="cn-send" id="cn-send" disabled aria-label="Send mission">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="cn-ideas" id="cn-ideas">${IDEAS.map((idea, i) => `<button class="cn-idea" data-idea="${i}">${esc(idea.label)}</button>`).join('')}</div>
      <div class="cn-meta"><span id="cn-ai"></span><span class="grow"></span><span><kbd>↵</kbd> send · <kbd>⇧↵</kbd> new line · <kbd>/</kbd> focus</span></div>`;
    viewport.appendChild(bar);

    const input = bar.querySelector('#cn-input');
    const send = bar.querySelector('#cn-send');
    const autosize = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
      send.disabled = !input.value.trim();
    };
    input.addEventListener('input', autosize);
    input.addEventListener('focus', () => bar.classList.add('focus'));
    input.addEventListener('blur', () => bar.classList.remove('focus'));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
      e.stopPropagation(); // keep office shortcuts (space, 1/2, a) from firing while typing
    });
    send.addEventListener('click', submit);

    bar.querySelector('#cn-crew').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const key = b.dataset.pick;
      if (!key) {
        ui.picked = [];
      } else if (ui.picked.includes(key)) {
        ui.picked = ui.picked.filter(k => k !== key);
      } else {
        ui.picked = [...ui.picked, key];
      }
      renderPicks();
      input.focus();
    });
    bar.querySelector('#cn-ideas').addEventListener('click', e => {
      const b = e.target.closest('[data-idea]');
      if (!b) return;
      const idea = IDEAS[Number(b.dataset.idea)];
      ui.picked = idea.bots.slice();
      renderPicks();
      input.value = idea.goal;
      autosize();
      input.focus();
    });
    bar.querySelector('.cn-meta').addEventListener('click', e => {
      if (e.target.closest('button')) Engine.openSettings();
    });

    // "/" focuses the bar from anywhere (overrides the old console shortcut).
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault();
        e.stopImmediatePropagation();
        input.focus();
      }
    }, true);

    renderPicks();
    renderAiLabel();
  }

  function renderPicks() {
    document.querySelectorAll('#cn-crew .cn-pick').forEach(b => {
      const key = b.dataset.pick;
      b.classList.toggle('on', key ? ui.picked.includes(key) : ui.picked.length === 0);
    });
    const input = document.getElementById('cn-input');
    if (!input) return;
    if (!ui.picked.length) {
      input.placeholder = 'Give your crew a mission… Nova will plan who does what';
    } else if (ui.picked.length === 1) {
      const c = office.BOT_CONFIG[ui.picked[0]];
      input.placeholder = `Ask ${c.name} (${c.roleName})…`;
    } else {
      input.placeholder = `Mission for ${ui.picked.map(k => office.BOT_CONFIG[k].name).join(', ')}…`;
    }
  }

  function renderAiLabel() {
    const el = document.getElementById('cn-ai');
    if (!el) return;
    const s = Engine.getSettings();
    const glowInfo = s.provider === 'glow' && Engine.glow ? Engine.glow.status() : null;
    if (!s.realMode) {
      el.innerHTML = '<span style="color:#f59e0b">●</span> Demo mode · <button>turn on real AI</button>';
    } else if (glowInfo) {
      el.innerHTML = glowInfo.signedIn
        ? `<span class="cn-glow-dot">✦</span> Powered by Glow · ${esc(glowInfo.model)} · <button>change</button>`
        : `<span class="cn-glow-dot">✦</span> Powered by Glow Free · <button>sign in for stronger models</button>`;
    } else {
      el.innerHTML = `<span style="color:#10b981">●</span> Real AI · ${esc(Engine.providerLabel())} · <button>change</button>`;
    }
  }

  function submit() {
    const input = document.getElementById('cn-input');
    const goal = input.value.trim();
    if (!goal) return;
    if (!Engine.getSettings().realMode) {
      Engine.openSettings();
      return;
    }
    const run = Engine.start(goal, { bots: ui.picked.slice(), meta: { autoOpen: true, source: 'command-bar' } });
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.blur();
    ui.missionId = run.id;
    document.getElementById('cn-command').classList.add('busy');
    renderMission();
  }

  // ==================================================================
  // Mission pipeline strip
  // ==================================================================
  function buildMission() {
    const el = document.createElement('div');
    el.className = 'cn-mission';
    el.id = 'cn-mission';
    document.getElementById('viewport').appendChild(el);
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-m]')?.dataset.m;
      if (!act || !ui.missionId) return;
      if (act === 'open') Engine.openRun(ui.missionId);
      if (act === 'stop') Engine.stop(ui.missionId);
      if (act === 'follow') {
        ui.follow = !ui.follow;
        if (!ui.follow) flyHome();
        renderMission();
      }
      if (act === 'close') {
        ui.missionId = null;
        renderMission();
      }
    });
    setInterval(() => {
      const run = ui.missionId && Engine.getRun(ui.missionId);
      if (run && run.status === 'running') renderMission();
    }, 1000);
  }

  function stepChip(bot, status, label) {
    const c = office.BOT_CONFIG[bot] || Engine.BOTS[bot] || { name: '?', color: '#64748b' };
    return `<span class="cn-step ${status}" style="--c:${c.color}"><i>${esc(c.name[0])}</i>${esc(label || c.name)}</span>`;
  }

  function renderMission() {
    const el = document.getElementById('cn-mission');
    const run = ui.missionId && Engine.getRun(ui.missionId);
    if (!el) return;
    if (!run) {
      el.classList.remove('show');
      document.getElementById('cn-command')?.classList.remove('busy');
      return;
    }
    const secs = Math.round(((run.finishedAt || Date.now()) - run.createdAt) / 1000);
    const chips = [];
    if (run.mode === 'team') {
      chips.push(stepChip('leader', run.planning ? 'running' : 'done', 'Plan'));
    }
    run.steps.forEach(s => chips.push(stepChip(s.bot, s.status === 'queued' ? '' : s.status)));
    if (run.mode === 'team' && (run.steps.length || run.final)) {
      chips.push(stepChip('leader', run.writingFinal ? 'running' : (run.final && run.status !== 'running' ? 'done' : ''), 'Final'));
    }
    const running = run.status === 'running';
    el.innerHTML = `
      <span class="cn-goal" title="${esc(run.goal.slice(0, 600))}">${esc(Engine.goalTitle ? Engine.goalTitle(run.goal) : run.goal)}</span>
      <span class="cn-steps">${chips.join('<span class="cn-arrow">›</span>')}</span>
      <span class="cn-time">${running ? secs + 's' : (run.status === 'done' ? '✓ ' + secs + 's' : run.status)}</span>
      ${running ? `<button class="cn-mbtn ${ui.follow ? 'on' : ''}" data-m="follow" title="Camera follows the active bot">🎥 Follow</button><button class="cn-mbtn stop" data-m="stop">■ Stop</button>` : ''}
      <button class="cn-mbtn ${running ? '' : 'primary'}" data-m="open">${running ? 'Live result' : 'Open result'}</button>
      ${running ? '' : '<button class="cn-mbtn" data-m="close" aria-label="Dismiss">×</button>'}`;
    el.classList.add('show');
    document.getElementById('cn-command')?.classList.toggle('busy', running);
  }

  // ==================================================================
  // Follow camera
  // ==================================================================
  function renderer3d() {
    const r = office.app && office.app.currentRenderer;
    return (office.state.mode === '3d' && r && r.camera) ? r : null;
  }

  let camAnim = null;
  function flyCamera(toPos, toLook, ms = 1200) {
    const r = renderer3d();
    if (!r || typeof THREE === 'undefined') return;
    const cam = r.camera;
    const fromPos = cam.position.clone();
    const fromLook = ui.camLook ? ui.camLook.clone() : new THREE.Vector3(0, 1, 0);
    const targetPos = new THREE.Vector3(toPos.x, toPos.y, toPos.z);
    const targetLook = new THREE.Vector3(toLook.x, toLook.y, toLook.z);
    const started = performance.now();
    cancelAnimationFrame(camAnim);
    const step = now => {
      const t = Math.min(1, (now - started) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cam.position.lerpVectors(fromPos, targetPos, e);
      const look = fromLook.clone().lerp(targetLook, e);
      cam.lookAt(look);
      ui.camLook = look;
      if (t < 1) camAnim = requestAnimationFrame(step);
    };
    camAnim = requestAnimationFrame(step);
  }

  function flyToBot(key) {
    if (!ui.follow) return;
    const bs = office.state.bots[key];
    const p = (bs && bs.position) || office.BOT_CONFIG[key]?.desk;
    if (!p) return;
    flyCamera({ x: p.x + 6.5, y: 6.5, z: p.z + 7.5 }, { x: p.x, y: 1.4, z: p.z });
  }

  function flyHome() {
    // Matches the default orbit (radius 12, theta=phi=π/4).
    flyCamera({ x: 6, y: 8.49, z: 6 }, { x: 0, y: 1, z: 0 }, 1400);
  }

  // ==================================================================
  // Speech bubbles + FX projected from 3D
  // ==================================================================
  let layer = null;

  function buildLayer() {
    layer = document.createElement('div');
    layer.className = 'cn-layer';
    document.getElementById('viewport').appendChild(layer);
    requestAnimationFrame(tickBubbles);
  }

  function project(key, yOffset) {
    const r = renderer3d();
    if (!r || typeof THREE === 'undefined') return null;
    const bs = office.state.bots[key];
    const p = (bs && bs.position) || office.BOT_CONFIG[key]?.desk;
    if (!p) return null;
    const v = new THREE.Vector3(p.x, yOffset, p.z).project(r.camera);
    if (v.z > 1 || v.z < -1) return null;
    const canvas = r.canvas || document.getElementById('scene-canvas-3d');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, depth: v.z };
  }

  function say(key, text, opts = {}) {
    if (!layer || !office.BOT_CONFIG[key]) return;
    let b = ui.bubbles[key];
    if (!b) {
      const el = document.createElement('div');
      el.className = 'cn-bubble';
      el.style.setProperty('--c', office.BOT_CONFIG[key].color);
      el.innerHTML = `<b>${esc(office.BOT_CONFIG[key].name)} <em></em></b><div class="t"></div>`;
      layer.appendChild(el);
      b = ui.bubbles[key] = { el };
    }
    b.el.querySelector('em').textContent = opts.label || '';
    b.el.querySelector('.t').textContent = text;
    b.el.classList.toggle('typing', !!opts.typing);
    b.el.classList.toggle('code', !!opts.code);
    b.until = performance.now() + (opts.ms || 6000);
  }

  function popFx(key, emoji) {
    if (!layer || !emoji) return;
    const pos = project(key, 3.6);
    if (!pos) return;
    const el = document.createElement('div');
    el.className = 'cn-fx';
    el.textContent = emoji;
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function tickBubbles(now) {
    const has3d = !!renderer3d();
    layer.style.display = has3d ? '' : 'none';
    if (has3d) {
      Object.entries(ui.bubbles).forEach(([key, b]) => {
        const visible = now < b.until;
        const pos = visible ? project(key, 4.4) : null;
        if (!pos) {
          b.el.classList.remove('show');
          return;
        }
        const scale = Math.max(0.78, Math.min(1, 1.25 - pos.depth * 0.3));
        // Keep bubbles below the mission strip / top edge so they never get clipped.
        const minTop = document.getElementById('cn-mission')?.classList.contains('show') ? 84 : 12;
        const top = Math.max(minTop, pos.y - b.el.offsetHeight);
        b.el.style.transform = `translate(${Math.round(pos.x - 14)}px, ${Math.round(top)}px) scale(${scale.toFixed(2)})`;
        b.el.style.zIndex = String(1000 - Math.round(pos.depth * 1000));
        b.el.classList.add('show');
      });
    }
    requestAnimationFrame(tickBubbles);
  }

  // Strip markdown/code fences into a readable live "tail" for the bubble.
  function liveTail(text, max = 150) {
    let t = String(text || '');
    const inCode = (t.match(/```/g) || []).length % 2 === 1;
    t = t.replace(/```[\w-]*\n?/g, '').replace(/[#*_>|`]/g, '').replace(/\[(\d+)\]/g, '').replace(/\s+/g, ' ').trim();
    return { text: t.length > max ? '…' + t.slice(-max) : t, code: inCode };
  }

  // ==================================================================
  // Wiring to the engine + office feed
  // ==================================================================
  const TOOL_LABEL = {
    web_search: 'searching', read_url: 'reading', run_js: 'running code', run_tests: 'testing', write_tests: 'writing tests',
    file_write: 'coding', image_gen: 'designing', plan: 'planning', delegate: 'assigning', report: 'writing', llm: 'thinking'
  };

  function wire() {
    // Real engine events → bubbles, FX, camera.
    Engine.on('bot', ev => {
      const label = ev.phase === 'start' ? 'on it' : ev.phase === 'end' ? 'done' : ev.phase === 'error' ? 'problem' : (TOOL_LABEL[ev.tool] || ev.tool || '');
      say(ev.agent, ev.detail, { label, ms: ev.phase === 'end' ? 4000 : 9000 });
      popFx(ev.agent, ev.phase === 'tool' ? FX[ev.tool] : FX[ev.phase]);
      if (ev.runId === ui.missionId && (ev.phase === 'start' || ev.tool === 'plan')) flyToBot(ev.agent);
      if (ev.runId === ui.missionId) renderMission();
    });

    // Streaming text → live typing bubble for the active bot.
    let pending = false;
    Engine.on('run', run => {
      if (!run || pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (run.status !== 'running') return;
        const active = run.steps.find(s => s.status === 'running');
        if (run.writingFinal && run.final) {
          const tail = liveTail(run.final);
          say('leader', tail.text, { label: 'writing the answer', typing: true, code: tail.code, ms: 4000 });
        } else if (active && active.output) {
          const tail = liveTail(active.output);
          say(active.bot, tail.text, { label: tail.code ? 'coding' : 'writing', typing: true, code: tail.code, ms: 4000 });
        }
        if (run.id === ui.missionId) renderMission();
      });
    });

    Engine.on('finished', run => {
      if (run.id !== ui.missionId) return;
      renderMission();
      if (run.status === 'done') {
        popFx('leader', '🎉');
        say(run.mode === 'team' ? 'leader' : run.steps[0]?.bot || 'leader', 'Mission complete — result is ready.', { label: 'done', ms: 5000 });
      }
      if (ui.follow) setTimeout(flyHome, 900);
      if (run.meta && run.meta.autoOpen && run.status !== 'stopped') {
        setTimeout(() => Engine.openRun(run.id), 700);
      }
    });

    Engine.on('settings', renderAiLabel);

    // Ambient demo feed → light bubbles + FX so the office feels alive.
    window.addEventListener('office-event', e => {
      const ev = e.detail || {};
      if (!office.BOT_CONFIG[ev.agent] || ev.session_id && Engine.getRun(ev.session_id)) return;
      if (ev.phase === 'start' || ev.phase === 'end' || ev.phase === 'error') {
        say(ev.agent, ev.detail || ev.tool || '', { label: ev.phase === 'end' ? 'done' : ev.phase === 'error' ? 'problem' : 'on it', ms: 3500 });
      }
      popFx(ev.agent, FX[ev.phase === 'tool' ? ev.tool : ev.phase]);
    });
  }

  // ==================================================================
  // Welcome
  // ==================================================================
  function showWelcome() {
    if (localStorage.getItem(WELCOME_KEY)) return;
    const faces = ['leader', 'explore', 'coder', 'tester', 'checker', 'media'].filter(k => office.BOT_CONFIG[k]);
    const blurbs = { leader: 'plans', explore: 'researches the web', coder: 'writes & runs code', tester: 'tests it', checker: 'reviews', media: 'writes & designs' };
    const el = document.createElement('div');
    el.className = 'cn-welcome';
    el.innerHTML = `
      <div class="cn-wcard" role="dialog" aria-label="Welcome">
        <h2>Meet your <span>AI crew</span></h2>
        <p>Give a mission and watch it happen in the office: Nova splits the work, the crew searches the live web, runs real code and designs graphics — then hands you the result.</p>
        <div class="cn-faces">${faces.map(k => {
          const c = office.BOT_CONFIG[k];
          return `<div class="cn-face" style="--c:${c.color}"><i>${esc(c.name[0])}</i><b>${esc(c.name)}</b>${esc(blurbs[k] || c.roleName)}</div>`;
        }).join('')}</div>
        <div class="cn-missions">
          <button class="cn-mission-btn" data-w="3"><span class="ic">🧭</span><span>Plan a 3-day Singapore trip<small>Whole crew · research, budget maths, review</small></span></button>
          <button class="cn-mission-btn" data-w="0"><span class="ic">🔎</span><span>Compare budget 3D printers<small>Scout reads live reviews and cites them</small></span></button>
          <button class="cn-mission-btn" data-w="1"><span class="ic">⚙️</span><span>Loan calculator<small>Byte writes code and actually runs it</small></span></button>
        </div>
        <div class="cn-wfoot"><span>✦ Powered by Glow AI · free, no sign-up</span><button data-w="skip">Explore the office →</button></div>
      </div>`;
    document.getElementById('viewport').appendChild(el);
    el.addEventListener('click', e => {
      const w = e.target.closest('[data-w]')?.dataset.w;
      if (w === undefined) return;
      localStorage.setItem(WELCOME_KEY, '1');
      el.remove();
      if (w !== 'skip') {
        const idea = IDEAS[Number(w)];
        ui.picked = idea.bots.slice();
        renderPicks();
        const input = document.getElementById('cn-input');
        input.value = idea.goal;
        input.dispatchEvent(new Event('input'));
        submit();
      } else {
        document.getElementById('cn-input')?.focus();
      }
    });
  }

  // ==================================================================
  // Boot
  // ==================================================================
  function init() {
    office = window.__office;
    Engine = window.CrewEngine;
    if (!office || !Engine || !document.getElementById('viewport')) return;
    addHeaderButtons();
    setCinema(localStorage.getItem(CINEMA_KEY) !== '0');
    buildLayer();
    buildMission();
    buildCommandBar();
    wire();
    setTimeout(keepRailHeader, 300);
    const launch = new URLSearchParams(location.search);
    const sharedGoal = launch.get('goal');
    if (sharedGoal) {
      localStorage.setItem(WELCOME_KEY, '1');
      const input = document.getElementById('cn-input');
      if (input) {
        input.value = sharedGoal.slice(0, 2000);
        input.dispatchEvent(new Event('input'));
        input.focus();
        input.setSelectionRange(0, 0);
        input.scrollTop = 0;
      }
      // Coming from Glow home or GlowChat with "go": the user already chose to hand it over, so start right away.
      if (launch.get('go') === '1') {
        setTimeout(() => document.getElementById('cn-send')?.click(), 700);
      }
      history.replaceState(null, '', location.pathname + location.hash);
    } else {
      setTimeout(showWelcome, 600);
    }
  }

  if (window.__office) {
    setTimeout(init, 0);
  } else {
    window.addEventListener('office-ready', () => setTimeout(init, 0), { once: true });
  }
})();
