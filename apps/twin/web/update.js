// Twin in-app updates (1.14.0). Shared by Twin (index.html) and Twin Indonesia (id/).
//
// Installed web app: the service worker downloads a new version in the background and waits.
// This file shows "Update ready" with the release notes; one tap tells the waiting worker to take
// over and reloads into the new version. Nothing reloads by itself any more.
//
// Your own Twin server (python server.py): the server checks the published release. One tap asks it
// to back up its folder, install the new version and restart; the page waits for it, then reloads.
(function () {
  'use strict';

  const SNOOZE_KEY = 'twin_update_snooze_v1';
  const SNOOZE_MS = 12 * 60 * 60 * 1000;
  const CHECK_EVERY_MS = 30 * 60 * 1000;
  const ACTIVATE_TIMEOUT_MS = 10000;
  const RESTART_TIMEOUT_MS = 120000;
  const RESTART_POLL_MS = 1500;
  const BUSY = ['updating', 'installing', 'restarting'];

  function parseVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value == null ? '' : value).trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  // 1 when a is newer than b, -1 when it is older, 0 when equal or either is not a version.
  function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) {
      return 0;
    }
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) {
        return left[index] > right[index] ? 1 : -1;
      }
    }
    return 0;
  }

  function memoryStorage() {
    const data = {};
    return {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
      setItem: (key, value) => {
        data[key] = String(value);
      },
      removeItem: (key) => {
        delete data[key];
      },
    };
  }

  function defaultStorage() {
    try {
      const probe = '__twin_update_probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      return memoryStorage();
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Plain-language status line for the Me / settings rows of both apps.
  function describeStatus(state, appName) {
    const name = appName || 'Twin';
    const version = state && state.available && state.available.version;
    const server = (state && state.server) || {};
    switch (state && state.status) {
      case 'checking':
        return 'Checking for updates…';
      case 'downloading':
        return 'Downloading the new version…';
      case 'ready':
        if (state.kind === 'server') {
          if (server.can_install === false) {
            return `${name} ${version} is available. ${server.reason || ''}`.trim();
          }
          return `${name} ${version} is available for this computer.`;
        }
        if (state.message === 'elsewhere') {
          return 'A newer version was installed in another window. Reload to use it.';
        }
        return version ? `Version ${version} is ready to install.` : 'A new version is ready to install.';
      case 'updating':
        return 'Updating…';
      case 'installing':
        return `Installing ${name}${version ? ` ${version}` : ''} on this computer…`;
      case 'restarting':
        return `Restarting ${name}…`;
      case 'latest':
        return "You're on the latest version.";
      case 'offline':
        return "You're offline. Check again when you're connected.";
      case 'error':
        return (state && state.message) || "Couldn't check for updates right now.";
      case 'unsupported':
        return `${name} picks up new versions when you reopen it.`;
      default:
        return `${name} checks for updates automatically.`;
    }
  }

  const STYLE = `
#twin-update {
  position: fixed; left: 12px; right: 12px; z-index: 45;
  bottom: calc(var(--tu-offset, 76px) + env(safe-area-inset-bottom, 0px));
  max-width: 520px; margin: 0 auto; box-sizing: border-box;
  background: rgba(15, 23, 42, .97); color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, .3); border-radius: 16px;
  padding: 12px 14px; box-shadow: 0 14px 34px rgba(0, 0, 0, .38);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left;
}
#twin-update .tu-title { font-weight: 700; }
#twin-update .tu-text { color: #cbd5e1; font-size: 13px; margin-top: 2px; }
#twin-update ul { margin: 8px 0 0; padding-left: 18px; color: #cbd5e1; font-size: 13px; }
#twin-update li { margin: 2px 0; }
#twin-update .tu-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 10px; }
#twin-update button {
  border: 1px solid rgba(148, 163, 184, .4); background: transparent; color: #f8fafc;
  border-radius: 10px; padding: 7px 12px; font: inherit; font-weight: 600; cursor: pointer;
}
#twin-update button.tu-primary { background: var(--accent, #3b82f6); border-color: transparent; color: #fff; }
#twin-update .tu-spin {
  display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px;
  border: 2px solid rgba(248, 250, 252, .35); border-top-color: #f8fafc; border-radius: 50%;
  animation: tu-spin .8s linear infinite;
}
@keyframes tu-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: no-preference) {
  #twin-update { animation: tu-in .22s ease-out; }
  @keyframes tu-in { from { transform: translateY(10px); opacity: 0; } }
}
@media (prefers-reduced-motion: reduce) { #twin-update .tu-spin { animation: none; } }
`;

  function createController(options) {
    const hasWindow = typeof window !== 'undefined';
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const opts = Object.assign({
      version: '',
      appName: 'Twin',
      releaseUrl: 'release.json',
      apiBase: '',
      serverMode: () => false,
      isBusy: () => false,
      offset: 76,
      storage: null,
      now: () => Date.now(),
      reload: () => window.location.reload(),
      fetch: (url, init) => window.fetch(url, init),
      document: hasWindow ? window.document : null,
      serviceWorker: hasWindow && 'serviceWorker' in nav && window.isSecureContext ? nav.serviceWorker : null,
      online: () => nav.onLine !== false,
      render: true,
    }, options || {});
    const storage = opts.storage || defaultStorage();
    const listeners = new Set();
    const state = {
      current: opts.version,
      status: 'idle',
      kind: null,
      available: null,
      server: null,
      message: '',
      checkedAt: 0,
    };
    let registration = null;
    let hadController = Boolean(opts.serviceWorker && opts.serviceWorker.controller);
    let userInitiated = false;
    let silentActivation = false;
    let applyWhenReady = false;
    let expanded = false;
    let confirming = false;
    let lastServerCheck = 0;
    let started = false;

    function snapshot() {
      return JSON.parse(JSON.stringify(Object.assign({}, state, { confirming })));
    }

    function notify() {
      const copy = snapshot();
      for (const listener of listeners) {
        try {
          listener(copy);
        } catch (error) {
          // A broken listener must not stop updates.
        }
      }
    }

    function set(patch) {
      Object.assign(state, patch);
      render();
      notify();
    }

    function snoozed() {
      const version = (state.available && state.available.version) || '';
      try {
        const saved = JSON.parse(storage.getItem(SNOOZE_KEY) || 'null');
        return Boolean(saved && saved.version === version && saved.until > opts.now());
      } catch (error) {
        return false;
      }
    }

    function describe(version, release) {
      const notes = release && Array.isArray(release.notes) ? release.notes.slice(0, 6).map(String) : [];
      return {
        version: version || (release && release.version) || '',
        title: (release && release.title) || '',
        notes,
        date: (release && release.date) || '',
      };
    }

    // ------------------------------------------------------------ installed web app

    function askVersion(worker) {
      return new Promise((resolve) => {
        if (!worker || typeof MessageChannel === 'undefined') {
          resolve(null);
          return;
        }
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), 3000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          resolve((event.data && event.data.version) || null);
        };
        try {
          worker.postMessage({ type: 'TWIN_VERSION' }, [channel.port2]);
        } catch (error) {
          clearTimeout(timer);
          resolve(null);
        }
      });
    }

    async function releaseNotes(version) {
      try {
        const response = await opts.fetch(opts.releaseUrl, { cache: 'no-store' });
        if (response && response.ok) {
          const release = await response.json();
          if (release && typeof release === 'object' && (!version || release.version === version)) {
            return release;
          }
        }
      } catch (error) {
        // Notes are optional; the update itself works without them.
      }
      return null;
    }

    async function onWaiting(worker) {
      if (!worker) {
        return;
      }
      const version = await askVersion(worker);
      if (worker.state && worker.state !== 'installed') {
        return; // it already took over (another window) or failed
      }
      if (version && compareVersions(version, state.current) <= 0) {
        // This page is already that version (opened fresh while online): let its offline copy take over quietly.
        silentActivation = true;
        worker.postMessage({ type: 'TWIN_SKIP_WAITING' });
        return;
      }
      if (applyWhenReady) {
        applyWeb();
        return;
      }
      const release = await releaseNotes(version);
      set({ status: 'ready', kind: 'web', available: describe(version, release), message: '' });
    }

    async function onControllerChange() {
      if (!hadController) {
        hadController = true; // the first install took control of this page: nothing to reload
        return;
      }
      if (silentActivation) {
        silentActivation = false;
        return;
      }
      if (userInitiated) {
        opts.reload();
        return;
      }
      // A new worker took over without a tap here: another window updated, or this page opened fresh
      // while the worker installed. Only an older page needs a reload.
      const version = await askVersion(opts.serviceWorker && opts.serviceWorker.controller);
      if (version && compareVersions(version, state.current) <= 0) {
        return;
      }
      const release = version ? await releaseNotes(version) : null;
      set({
        status: 'ready',
        kind: 'web',
        message: 'elsewhere',
        available: version ? describe(version, release) : state.available || describe('', null),
      });
    }

    function watch(reg) {
      if (reg.waiting && hadController) {
        onWaiting(reg.waiting);
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) {
          return;
        }
        if (state.status === 'checking') {
          set({ status: 'downloading' });
        }
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && hadController) {
            onWaiting(worker);
          } else if (worker.state === 'redundant' && state.status === 'downloading') {
            set({ status: 'idle' });
          }
        });
      });
    }

    function applyWeb() {
      userInitiated = true;
      set({ status: 'updating', message: '' });
      const worker = registration && registration.waiting;
      if (!worker) {
        opts.reload();
        return;
      }
      worker.postMessage({ type: 'TWIN_SKIP_WAITING' });
      setTimeout(() => opts.reload(), ACTIVATE_TIMEOUT_MS);
    }

    // ------------------------------------------------------------ your own Twin server

    async function post(path, body) {
      const response = await opts.fetch(opts.apiBase + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      return data || { ok: false, error: `Twin answered ${response.status}.` };
    }

    async function checkServer(force) {
      if (!opts.serverMode()) {
        return null;
      }
      lastServerCheck = opts.now();
      let info = null;
      try {
        info = await post('api/update/status', { force: Boolean(force) });
      } catch (error) {
        return null;
      }
      if (!info || !info.ok) {
        return null;
      }
      state.server = info;
      if (info.available && state.kind !== 'web' && !BUSY.includes(state.status)) {
        set({ status: 'ready', kind: 'server', available: describe(info.latest, info), message: '' });
      } else {
        notify();
      }
      return info;
    }

    async function installServer() {
      const target = state.available && state.available.version;
      confirming = false;
      set({ status: 'installing', message: '' });
      let result = null;
      try {
        result = await post('api/update/install', { version: target });
      } catch (error) {
        set({ status: 'error', message: 'Could not reach your Twin server. Check that it is still running.' });
        return;
      }
      if (!result.ok) {
        const message = result.auth === false
          ? 'Sign in to Twin on this computer first, then try the update again.'
          : result.error || 'The update did not install. Nothing was changed.';
        set({ status: 'error', message });
        return;
      }
      set({ status: 'restarting', message: '' });
      const deadline = opts.now() + RESTART_TIMEOUT_MS;
      while (opts.now() < deadline) {
        await sleep(RESTART_POLL_MS);
        let health = null;
        try {
          const response = await opts.fetch(opts.apiBase + 'api/health', { cache: 'no-store' });
          health = await response.json();
        } catch (error) {
          health = null; // still restarting
        }
        if (health && health.version === result.version) {
          finishServerUpdate();
          return;
        }
      }
      set({
        status: 'error',
        message: `${opts.appName} ${result.version} is installed, but the server has not come back yet. Restart Twin on your computer.`,
      });
    }

    function finishServerUpdate() {
      userInitiated = true;
      if (!registration) {
        opts.reload();
        return;
      }
      // The restarted server now serves the new worker: take it as soon as it has downloaded.
      applyWhenReady = true;
      Promise.resolve()
        .then(() => registration.update())
        .catch(() => null)
        .then(() => {
          if (registration.waiting) {
            applyWeb();
          }
        });
      setTimeout(() => opts.reload(), 20000);
    }

    // ------------------------------------------------------------ actions

    async function check(manual) {
      if (BUSY.includes(state.status)) {
        return snapshot();
      }
      if (manual) {
        storage.removeItem(SNOOZE_KEY);
        if (state.status === 'ready') {
          render();
          notify();
          return snapshot();
        }
      }
      if (!opts.online()) {
        if (manual) {
          set({ status: 'offline', message: '' });
        }
        return snapshot();
      }
      if (manual) {
        set({ status: 'checking', message: '' });
      }
      if (registration) {
        try {
          await registration.update();
        } catch (error) {
          if (manual) {
            set({ status: 'error', kind: null, message: "Couldn't reach Twin to check for updates." });
            return snapshot();
          }
        }
      }
      if (manual || opts.now() - lastServerCheck > CHECK_EVERY_MS) {
        await checkServer(manual);
      }
      if (state.status === 'checking') {
        if (registration && registration.installing) {
          set({ status: 'downloading' });
        } else if (!(registration && registration.waiting)) {
          set({ status: 'latest', checkedAt: opts.now() });
        }
      }
      return snapshot();
    }

    function apply() {
      if (BUSY.includes(state.status)) {
        return;
      }
      if (state.kind === 'server') {
        if (state.server && state.server.can_install === false) {
          storage.removeItem(SNOOZE_KEY);
          render();
          return;
        }
        confirming = true;
        expanded = false;
        storage.removeItem(SNOOZE_KEY);
        if (state.status !== 'ready') {
          state.status = 'ready';
        }
        render();
        notify();
        return;
      }
      applyWeb();
    }

    function later() {
      const version = (state.available && state.available.version) || '';
      storage.setItem(SNOOZE_KEY, JSON.stringify({ version, until: opts.now() + SNOOZE_MS }));
      confirming = false;
      expanded = false;
      if (state.status === 'error') {
        set({ status: state.available ? 'ready' : 'idle', message: '' });
      } else {
        render();
        notify();
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    // ------------------------------------------------------------ banner

    function bannerView() {
      const name = opts.appName;
      const available = state.available || { version: '', title: '', notes: [] };
      const version = available.version ? ` ${available.version}` : '';
      const notesButton = available.notes.length ? [{ id: 'notes', label: expanded ? 'Hide notes' : "What's new" }] : [];
      switch (state.status) {
        case 'ready': {
          if ((snoozed() || opts.isBusy()) && !confirming) {
            return null;
          }
          if (state.kind === 'server') {
            const server = state.server || {};
            if (confirming) {
              return {
                title: `Install ${name}${version} on this computer?`,
                text: 'Twin backs up its folder first, installs the update and restarts (about a minute). '
                  + 'Accounts, practice portfolios and broker connections stay as they are.',
                actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'confirm', label: 'Install & restart', primary: true }],
              };
            }
            if (server.can_install === false) {
              return {
                title: `${name}${version} is available`,
                text: server.reason || 'Update this Twin folder yourself, then restart the server.',
                notes: expanded ? available.notes : [],
                actions: notesButton.concat([{ id: 'later', label: 'OK' }]),
              };
            }
            return {
              title: `${name}${version} is available`,
              text: available.title ? `${available.title}. Update Twin on this computer in one tap — it backs up first.`
                : 'Update Twin on this computer in one tap — it backs up first.',
              notes: expanded ? available.notes : [],
              actions: notesButton.concat([{ id: 'later', label: 'Later' }, { id: 'apply', label: 'Update', primary: true }]),
            };
          }
          if (state.message === 'elsewhere') {
            return {
              title: `${name} was updated`,
              text: 'A newer version was installed in another window. Reload to use it.',
              actions: [{ id: 'apply', label: 'Reload', primary: true }],
            };
          }
          return {
            title: `Update ready ·${version ? ` ${name}${version}` : ` ${name}`}`,
            text: available.title || 'A new version has downloaded and is ready to use.',
            notes: expanded ? available.notes : [],
            actions: notesButton.concat([{ id: 'later', label: 'Later' }, { id: 'apply', label: 'Update', primary: true }]),
          };
        }
        case 'updating':
          return { title: `Updating ${name}…`, text: 'One moment — the app reloads with the new version.', busy: true, actions: [] };
        case 'installing':
          return {
            title: `Installing ${name}${version}…`,
            text: 'Downloading and checking the update, then backing up your Twin folder.',
            busy: true,
            actions: [],
          };
        case 'restarting':
          return {
            title: `Restarting ${name}…`,
            text: 'Your Twin server is starting the new version. This page reloads by itself.',
            busy: true,
            actions: [],
          };
        case 'error':
          if (!state.kind) {
            return null; // check errors show on the Me screen, not as a banner
          }
          return {
            title: "The update didn't finish",
            text: state.message,
            actions: [{ id: 'later', label: 'Close' }, { id: 'retry', label: 'Try again', primary: true }],
          };
        default:
          return null;
      }
    }

    function renderHtml(view) {
      const notes = view.notes && view.notes.length
        ? `<ul>${view.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
      const actions = view.actions.length
        ? `<div class="tu-actions">${view.actions.map((action) => (
          `<button type="button" data-tu="${action.id}"${action.primary ? ' class="tu-primary"' : ''}>${escapeHtml(action.label)}</button>`
        )).join('')}</div>` : '';
      return `<div class="tu-title">${view.busy ? '<span class="tu-spin" aria-hidden="true"></span>' : ''}${escapeHtml(view.title)}</div>`
        + `<div class="tu-text">${escapeHtml(view.text)}</div>${notes}${actions}`;
    }

    function onBannerClick(event) {
      const button = event.target && event.target.closest ? event.target.closest('button[data-tu]') : null;
      if (!button) {
        return;
      }
      const action = button.getAttribute('data-tu');
      if (action === 'apply') {
        apply();
      } else if (action === 'later') {
        later();
      } else if (action === 'notes') {
        expanded = !expanded;
        render();
      } else if (action === 'confirm') {
        installServer();
      } else if (action === 'cancel') {
        confirming = false;
        render();
        notify();
      } else if (action === 'retry') {
        state.status = 'ready';
        state.message = '';
        apply();
      }
    }

    function render() {
      const doc = opts.document;
      if (!opts.render || !doc || !doc.body) {
        return;
      }
      if (!doc.getElementById('twin-update-style')) {
        const style = doc.createElement('style');
        style.id = 'twin-update-style';
        style.textContent = STYLE;
        (doc.head || doc.body).appendChild(style);
      }
      let root = doc.getElementById('twin-update');
      const view = bannerView();
      if (!view) {
        if (root) {
          root.remove();
        }
        return;
      }
      if (!root) {
        root = doc.createElement('div');
        root.id = 'twin-update';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.addEventListener('click', onBannerClick);
        doc.body.appendChild(root);
      }
      root.style.setProperty('--tu-offset', `${opts.offset}px`);
      root.setAttribute('data-status', state.status);
      root.setAttribute('data-kind', state.kind || '');
      const html = renderHtml(view);
      if (root.innerHTML !== html) {
        root.innerHTML = html;
      }
    }

    // ------------------------------------------------------------ start

    async function start(swUrl, scope) {
      if (started) {
        return;
      }
      started = true;
      const doc = opts.document;
      if (opts.render && hasWindow) {
        // Re-check every few seconds so the banner hides while a sheet or dialog is open.
        setInterval(() => {
          if (state.status === 'ready') {
            render();
          }
        }, 1500);
      }
      if (doc && doc.addEventListener) {
        doc.addEventListener('visibilitychange', () => {
          if (doc.visibilityState === 'visible') {
            check(false);
          }
        });
      }
      if (hasWindow) {
        window.addEventListener('online', () => check(false));
        setInterval(() => {
          if (!doc || doc.visibilityState !== 'hidden') {
            check(false);
          }
        }, CHECK_EVERY_MS);
      }
      const sw = opts.serviceWorker;
      if (sw && swUrl) {
        sw.addEventListener('controllerchange', onControllerChange);
        try {
          registration = await sw.register(swUrl, scope ? { scope } : undefined);
          watch(registration);
        } catch (error) {
          registration = null;
        }
      }
      if (!registration && state.status === 'idle') {
        set({ status: 'unsupported' });
      }
      await checkServer(false);
    }

    return {
      start,
      check,
      apply,
      later,
      subscribe,
      confirmInstall: installServer,
      get state() {
        return snapshot();
      },
      get registration() {
        return registration;
      },
    };
  }

  let active = null;

  const TwinUpdate = {
    init(options) {
      if (!active) {
        active = createController(options);
        active.start(options && options.swUrl, options && options.scope);
      }
      return active;
    },
    createController,
    compareVersions,
    parseVersion,
    describeStatus,
    check: (manual = true) => (active ? active.check(manual) : Promise.resolve(null)),
    apply: () => (active ? active.apply() : undefined),
    later: () => (active ? active.later() : undefined),
    subscribe: (listener) => (active ? active.subscribe(listener) : () => {}),
    get state() {
      return active ? active.state : null;
    },
  };

  if (typeof window !== 'undefined') {
    window.TwinUpdate = TwinUpdate;
  }
})();
