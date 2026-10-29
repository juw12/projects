/* Sweep native bridge — one web app, every device.
 *
 * The Windows/Mac apps (apps/sweep/desktop, a pywebview window) and the Android/iPhone apps
 * (apps/sweep/mobile, Capacitor) are thin shells around this live site, so every push to the web
 * app reaches them without a reinstall. This file adds what a browser tab cannot do:
 *
 *  - Exports: WebViews ignore <a download>. Every blob/data download is routed to a native Save
 *    dialog (desktop) or the share sheet (phones: save to Files / Drive, send to an app).
 *  - Android Back closes the open sheet or dialog, then steps back to the catalog, then leaves.
 *  - Light haptics on primary actions (phones); external links open in the system browser (desktop).
 *  - Shell updates: compares the installed app with shell.json and offers the new download once.
 *  - Everywhere: offline indicator, "What's new" after a web release, launch shortcuts (?action=brief),
 *    and an "Apps & updates" panel in Settings.
 *
 * Window.SweepNative.platform() → 'desktop' | 'android' | 'ios' | 'pwa' | 'web'.
 * Network use: only shell.json from this site, only inside the native apps.
 */
(function () {
  'use strict';

  const WEB_RELEASE = {
    version: 21,
    notes: [
      'Sweep is now an app for Windows, Mac, Android and iPhone: same projects, updates itself.',
      'Exports open a real Save dialog on desktop and the share sheet on phones.',
      'Cleaner, calmer interface: modern type, tighter header, safe areas on notched phones.',
      'Offline indicator, launch shortcuts and an Apps & updates panel in Settings.'
    ]
  };
  const GET_PAGE = 'app.html';
  const SEEN_KEY = 'sweep_whats_new_seen';
  const DISMISSED_KEY = 'sweep_shell_update_dismissed';
  const LAUNCH_SECTIONS = { brief: 'brief', operator: 'operator', catalog: 'catalog', guide: 'guide' };

  // ---------------------------------------------------------------- platform
  function capacitor() {
    const bridge = window.Capacitor;
    return bridge && typeof bridge.isNativePlatform === 'function' && bridge.isNativePlatform() ? bridge : null;
  }

  function desktopApi() {
    return window.pywebview && window.pywebview.api ? window.pywebview.api : null;
  }

  function platform() {
    const bridge = capacitor();
    if (bridge) return bridge.getPlatform() === 'ios' ? 'ios' : 'android';
    if (window.pywebview) return 'desktop';
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    return standalone ? 'pwa' : 'web';
  }

  function isNativeShell() {
    const current = platform();
    return current === 'desktop' || current === 'android' || current === 'ios';
  }

  function markPlatform() {
    const root = document.documentElement;
    const current = platform();
    ['desktop', 'android', 'ios', 'pwa', 'web'].forEach(function (name) {
      root.classList.toggle('native-' + name, name === current);
    });
    root.classList.toggle('native-app', isNativeShell());
  }

  function plugin(name, method, options) {
    const bridge = capacitor();
    if (!bridge) return Promise.reject(new Error('Not in the phone app'));
    const plugins = bridge.Plugins || {};
    if (plugins[name] && typeof plugins[name][method] === 'function') {
      return Promise.resolve(plugins[name][method](options || {}));
    }
    if (typeof bridge.nativePromise === 'function') return bridge.nativePromise(name, method, options || {});
    return Promise.reject(new Error(name + ' is not available'));
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  // ---------------------------------------------------------------- exports
  // Remember which Blob each object URL points at, so a download can be re-read and handed to the
  // native side. Revocation is delayed inside the apps because the native save runs after click().
  const blobsByUrl = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (object) {
    const url = createObjectURL(object);
    if (object instanceof Blob && isNativeShell()) blobsByUrl.set(url, object);
    return url;
  };

  URL.revokeObjectURL = function (url) {
    if (!isNativeShell()) {
      blobsByUrl.delete(url);
      revokeObjectURL(url);
      return;
    }
    setTimeout(function () {
      blobsByUrl.delete(url);
      revokeObjectURL(url);
    }, 60000);
  };

  function blobFor(href) {
    if (blobsByUrl.has(href)) return Promise.resolve(blobsByUrl.get(href));
    if (/^data:/i.test(href)) return window.fetch(href).then(function (response) { return response.blob(); });
    return null;
  }

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || '');
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('Could not read the file')); };
      reader.readAsDataURL(blob);
    });
  }

  function safeFileName(name) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim();
    return cleaned || 'sweep-export.txt';
  }

  function saveOnDesktop(name, data) {
    return Promise.resolve(desktopApi().save_file(name, data)).then(function (result) {
      if (result && result.ok) {
        toast('Saved ' + name);
      } else if (result && !result.cancelled) {
        toast('Could not save: ' + (result.error || 'unknown error'));
      }
      return result;
    });
  }

  function shareOnPhone(name, data) {
    return plugin('Filesystem', 'writeFile', { path: name, data: data, directory: 'CACHE' })
      .then(function (written) {
        return plugin('Share', 'share', { title: name, files: [written.uri], dialogTitle: 'Save or share ' + name });
      })
      .catch(function (error) {
        const message = String((error && error.message) || error || '');
        if (!/cancel/i.test(message)) toast('Could not share: ' + message);
      });
  }

  function saveDownload(anchor) {
    if (!isNativeShell() || !anchor || !anchor.hasAttribute('download')) return false;
    const pending = blobFor(anchor.href);
    if (!pending) return false;
    const name = safeFileName(anchor.getAttribute('download') || anchor.href.split('/').pop());
    pending
      .then(base64Of)
      .then(function (data) {
        return platform() === 'desktop' ? saveOnDesktop(name, data) : shareOnPhone(name, data);
      })
      .catch(function (error) { toast('Could not export: ' + error.message); });
    return true;
  }

  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (saveDownload(this)) return undefined;
    return anchorClick.call(this);
  };

  document.addEventListener('click', function (event) {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a') : null;
    if (!anchor) return;
    if (anchor.hasAttribute('download')) {
      if (saveDownload(anchor)) event.preventDefault();
      return;
    }
    // Desktop window: other sites open in the default browser, never inside the app window.
    if (platform() === 'desktop' && /^https?:/i.test(anchor.href) && anchor.origin !== location.origin) {
      event.preventDefault();
      desktopApi().open_external(anchor.href);
    }
  }, true);

  const windowOpen = window.open;
  window.open = function (url) {
    if (platform() === 'desktop' && url && /^https?:/i.test(String(url))) {
      const absolute = new URL(String(url), location.href);
      if (absolute.origin !== location.origin) {
        desktopApi().open_external(absolute.href);
        return null;
      }
    }
    return windowOpen.apply(window, arguments);
  };

  // ---------------------------------------------------------------- phones: back button + haptics
  function visibleDialogs() {
    return Array.prototype.filter.call(
      document.querySelectorAll('[role="dialog"][aria-modal="true"], .sweep-sheet'),
      function (dialog) { return dialog.getClientRects().length > 0; }
    );
  }

  function closeTopDialog() {
    const dialogs = visibleDialogs();
    const top = dialogs[dialogs.length - 1];
    if (!top) return false;
    const close = top.querySelector('.studio-modal-close, [data-pro="close"], [data-sheet-close], [aria-label="Close"]');
    if (close) {
      close.click();
    } else {
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    return true;
  }

  function activeSection() {
    const section = document.querySelector('.section.active, .section[style*="block"]');
    return section ? section.id.replace(/^section-/, '') : '';
  }

  function handleBack() {
    if (closeTopDialog()) return;
    const current = activeSection();
    if (current && current !== 'catalog' && current !== 'gate' && typeof window.navigateTo === 'function') {
      window.navigateTo('catalog');
      return;
    }
    plugin('App', 'minimizeApp').catch(function () { /* iOS has no Back */ });
  }

  function listenForBack() {
    const bridge = capacitor();
    if (!bridge || bridge.getPlatform() !== 'android') return;
    const app = bridge.Plugins && bridge.Plugins.App;
    if (app && typeof app.addListener === 'function') {
      app.addListener('backButton', handleBack);
    } else if (typeof bridge.addListener === 'function') {
      bridge.addListener('App', 'backButton', handleBack);
    }
  }

  document.addEventListener('click', function (event) {
    if (!capacitor()) return;
    const button = event.target && event.target.closest ? event.target.closest('.btn-primary, .mobile-bottom-nav a') : null;
    if (button) plugin('Haptics', 'impact', { style: 'LIGHT' }).catch(function () {});
  }, true);

  // ---------------------------------------------------------------- banners and sheets
  function banner(id, html, actions) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.id = id;
    node.className = 'sweep-banner';
    node.setAttribute('role', 'status');
    node.innerHTML = html;
    node.addEventListener('click', function (event) {
      const action = event.target && event.target.getAttribute('data-banner');
      if (!action) return;
      if (actions[action]) actions[action]();
      node.remove();
    });
    document.body.appendChild(node);
    return node;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showWhatsNew() {
    const existing = document.getElementById('sweep-whats-new');
    if (existing) existing.remove();
    const sheet = document.createElement('div');
    sheet.id = 'sweep-whats-new';
    sheet.className = 'sweep-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'sweep-whats-new-title');
    sheet.innerHTML =
      '<div class="sweep-sheet-card">' +
        '<img class="sweep-sheet-icon" src="icons/app-icon.svg" alt="" width="48" height="48">' +
        '<h2 id="sweep-whats-new-title">What\u2019s new in Sweep</h2>' +
        '<ul>' + WEB_RELEASE.notes.map(function (note) { return '<li>' + esc(note) + '</li>'; }).join('') + '</ul>' +
        '<div class="sweep-sheet-actions">' +
          (isNativeShell() ? '' : '<a class="btn btn-secondary" href="' + GET_PAGE + '">Get the apps</a>') +
          '<button type="button" class="btn btn-primary" data-sheet-close>Got it</button>' +
        '</div>' +
      '</div>';
    function close() {
      sheet.remove();
      try { localStorage.setItem(SEEN_KEY, String(WEB_RELEASE.version)); } catch (error) { /* private mode */ }
    }
    sheet.addEventListener('click', function (event) {
      if (event.target === sheet || (event.target.closest && event.target.closest('[data-sheet-close]'))) close();
    });
    sheet.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    document.body.appendChild(sheet);
    const button = sheet.querySelector('[data-sheet-close]');
    if (button) button.focus();
  }

  function maybeShowWhatsNew() {
    let seen = null;
    let returning = false;
    try {
      seen = localStorage.getItem(SEEN_KEY);
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index) || '';
        if (/^sweep_/.test(key) && key !== SEEN_KEY && key !== 'sweep_theme_v1') returning = true;
      }
      if (!returning || Number(seen) >= WEB_RELEASE.version) {
        // First visit: nothing changed for this person. Remember the version silently.
        localStorage.setItem(SEEN_KEY, String(WEB_RELEASE.version));
        return;
      }
    } catch (error) {
      return;
    }
    setTimeout(showWhatsNew, 1200);
  }

  // ---------------------------------------------------------------- offline indicator
  function updateOnline() {
    const offline = navigator.onLine === false;
    let pill = document.getElementById('sweep-offline');
    if (offline && !pill) {
      pill = document.createElement('div');
      pill.id = 'sweep-offline';
      pill.className = 'sweep-offline';
      pill.setAttribute('role', 'status');
      pill.textContent = 'Offline \u00b7 your work is saved on this device';
      document.body.appendChild(pill);
    } else if (!offline && pill) {
      pill.textContent = 'Back online';
      pill.classList.add('is-online');
      setTimeout(function () { pill.remove(); }, 1800);
    }
  }

  // ---------------------------------------------------------------- shell updates
  function compareVersions(a, b) {
    const left = String(a || '0').split('.').map(Number);
    const right = String(b || '0').split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function installedVersion() {
    const current = platform();
    if (current === 'desktop') {
      return Promise.resolve(desktopApi().info()).then(function (info) { return info && info.version; });
    }
    if (current === 'android' || current === 'ios') {
      return plugin('App', 'getInfo').then(function (info) { return info && info.version; });
    }
    return Promise.resolve(null);
  }

  function shellManifest() {
    return window.fetch('shell.json', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('shell.json ' + response.status);
      return response.json();
    });
  }

  function downloadFor(manifest) {
    const current = platform();
    if (current === 'desktop') {
      if (/Mac/i.test(navigator.platform || navigator.userAgent)) return manifest.getPage || manifest.release;
      return manifest.desktop && manifest.desktop.windows;
    }
    if (current === 'android') return manifest.android && manifest.android.url;
    if (current === 'ios') return manifest.ios && manifest.ios.url;
    return manifest.getPage;
  }

  function openOutside(url) {
    if (!url) return;
    if (platform() === 'desktop') {
      desktopApi().open_external(url);
    } else {
      windowOpen.call(window, url, '_system');
    }
  }

  const updateState = { installed: null, latest: null, url: null, checked: false };

  function checkForShellUpdate(manual) {
    if (!isNativeShell()) return Promise.resolve(updateState);
    return Promise.all([installedVersion(), shellManifest()])
      .then(function (results) {
        const manifest = results[1] || {};
        const section = platform() === 'desktop' ? manifest.desktop : manifest[platform()];
        updateState.installed = results[0];
        updateState.latest = section && section.version;
        updateState.url = downloadFor(manifest);
        updateState.checked = true;
        const newer = updateState.latest && compareVersions(updateState.latest, updateState.installed) > 0;
        let dismissed = null;
        try { dismissed = localStorage.getItem(DISMISSED_KEY); } catch (error) { /* ignore */ }
        if (newer && (manual || dismissed !== updateState.latest)) {
          banner('sweep-shell-update',
            '<span><strong>Sweep ' + esc(updateState.latest) + '</strong> is available for this device.</span>' +
            '<button type="button" class="btn btn-sm btn-primary" data-banner="update">Update</button>' +
            '<button type="button" class="sweep-banner-close" aria-label="Later" data-banner="later">\u00d7</button>',
            {
              update: function () { openOutside(updateState.url); },
              later: function () {
                try { localStorage.setItem(DISMISSED_KEY, updateState.latest); } catch (error) { /* ignore */ }
              }
            });
        } else if (manual) {
          toast('Sweep is up to date');
        }
        return updateState;
      })
      .catch(function (error) {
        if (manual) toast('Could not check for updates: ' + error.message);
        return updateState;
      });
  }

  // ---------------------------------------------------------------- Settings → Apps & updates
  function platformLabel() {
    return {
      desktop: /Mac/i.test(navigator.platform || navigator.userAgent) ? 'Mac app' : 'Windows app',
      android: 'Android app',
      ios: 'iPhone app',
      pwa: 'Installed web app',
      web: 'Web browser'
    }[platform()];
  }

  function appsPanelHtml() {
    const shellLine = isNativeShell()
      ? (updateState.installed ? ' \u00b7 app ' + esc(updateState.installed) : '')
      : '';
    return '<h3>Apps &amp; updates</h3>' +
      '<p class="sweep-apps-meta">' + esc(platformLabel()) + ' \u00b7 Sweep web v' + WEB_RELEASE.version + shellLine + '</p>' +
      '<p class="sweep-apps-copy">Features and fixes arrive automatically on every device. ' +
        'Your projects stay on this device unless you turn on Sync.</p>' +
      '<div class="sweep-apps-actions">' +
        (isNativeShell()
          ? '<button type="button" class="btn btn-sm btn-secondary" data-native="check">Check for updates</button>'
          : '<a class="btn btn-sm btn-primary" href="' + GET_PAGE + '">Get Sweep for desktop &amp; phone</a>') +
        '<button type="button" class="btn btn-sm btn-ghost" data-native="whats-new">What\u2019s new</button>' +
      '</div>';
  }

  function decorateSettings(modal) {
    const card = modal.querySelector('.settings-card') || modal.firstElementChild;
    if (!card || card.querySelector('.sweep-apps-panel')) return;
    const panel = document.createElement('section');
    panel.className = 'sweep-apps-panel';
    panel.innerHTML = appsPanelHtml();
    panel.addEventListener('click', function (event) {
      const action = event.target && event.target.getAttribute('data-native');
      if (action === 'check') {
        checkForShellUpdate(true).then(function () { panel.innerHTML = appsPanelHtml(); });
      } else if (action === 'whats-new') {
        showWhatsNew();
      }
    });
    card.appendChild(panel);
  }

  function watchSettings() {
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, function (node) {
          if (node.id === 'settings-modal') decorateSettings(node);
        });
      });
    });
    observer.observe(document.body, { childList: true });
  }

  function extendPalette() {
    const pro = window.SweepPro;
    if (!pro || typeof pro.paletteCommands !== 'function' || pro.paletteCommands.sweepNative) return;
    const original = pro.paletteCommands;
    pro.paletteCommands = function () {
      const commands = original.apply(this, arguments) || [];
      commands.push({ group: 'Actions', label: 'What\u2019s new in Sweep', hint: '', run: showWhatsNew });
      if (isNativeShell()) {
        commands.push({ group: 'Actions', label: 'Check for app updates', hint: '', run: function () { checkForShellUpdate(true); } });
      } else {
        commands.push({ group: 'Actions', label: 'Get Sweep for Windows, Mac, Android & iPhone', hint: '', run: function () { location.href = GET_PAGE; } });
      }
      return commands;
    };
    pro.paletteCommands.sweepNative = true;
  }

  // ---------------------------------------------------------------- launch shortcuts (?action=brief)
  function applyLaunchAction() {
    let action = null;
    try { action = new URLSearchParams(location.search).get('action'); } catch (error) { return; }
    const section = action && LAUNCH_SECTIONS[action];
    if (!section) return;
    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      const nav = document.getElementById('main-nav');
      const inApp = document.body.classList.contains('sweep-in-app') || (nav && nav.style.display !== 'none');
      if (inApp && typeof window.navigateTo === 'function') {
        clearInterval(timer);
        window.navigateTo(section);
        try { history.replaceState(null, '', location.pathname); } catch (error) { /* ignore */ }
      } else if (attempts > 1200) {
        clearInterval(timer);
      }
    }, 500);
  }

  // ---------------------------------------------------------------- start
  function start() {
    markPlatform();
    window.addEventListener('pywebviewready', function () {
      markPlatform();
      checkForShellUpdate(false);
    });
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();
    listenForBack();
    watchSettings();
    extendPalette();
    maybeShowWhatsNew();
    applyLaunchAction();
    if (capacitor()) checkForShellUpdate(false);
    if (window.pywebview && window.pywebview.api && window.pywebview.api.info) checkForShellUpdate(false);
  }

  window.SweepNative = {
    platform: platform,
    isNativeShell: isNativeShell,
    webVersion: WEB_RELEASE.version,
    checkForUpdates: function () { return checkForShellUpdate(true); },
    showWhatsNew: showWhatsNew,
    saveDownload: saveDownload
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
