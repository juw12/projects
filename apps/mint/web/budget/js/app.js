/* Mint Budget (formerly Kitty): shell, views, interactions. Depends on core.js, sync.js, ui-kit.js, quiz.js.
 * Internal names (window.Kitty, kitty.* storage keys, the relay topic prefix) keep the old name so budgets carry over. */
(function () {
  'use strict';
  const K = window.Kitty;
  const ui = K.ui;
  const esc = ui.esc;
  const icon = ui.icon;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ================================================================ storage
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        toast({ tone: 'bad', title: 'Could not save on this device', body: 'Storage is full or blocked. Export a backup from Settings.' });
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        /* ignore */
      }
    },
  };

  const TAB = K.uid(8);
  const params = new URLSearchParams(location.search);

  const VIEWS = [
    { id: 'home', label: 'Overview', icon: 'home' },
    { id: 'sheet', label: 'Sheet', icon: 'sheet' },
    { id: 'budget', label: 'Budget', icon: 'wallet' },
    { id: 'goals', label: 'Goals', icon: 'target' },
    { id: 'invest', label: 'Invest', icon: 'chart' },
    { id: 'you', label: 'You', icon: 'user' },
    { id: 'share', label: 'Share', icon: 'users' },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ];
  // Phone tab bar: the two daily views, a big Add button, Budget, and More for everything else.
  const MOBILE_NAV = ['home', 'sheet', 'add', 'budget', 'more'];
  const MORE_VIEWS = ['goals', 'invest', 'you', 'share', 'settings'];
  // The Mint mark (the same icon as the home screen and Templates): sidebar, phone header,
  // welcome page and update card.
  const LOGO =
    '<span class="logo mark" aria-hidden="true"><img src="../icons/app-icon.svg" alt="" width="30" height="30" decoding="async"></span>';
  // Mint Templates (the spreadsheet template studio and marketplace) lives next door in the same app.
  const TEMPLATES_URL = '../app.html';
  const BRAND = '<div class="brand">' + LOGO + '<b>Mint</b></div>';
  const T = K.t;
  function langSelect(extraClass) {
    return (
      '<label class="lang-select' + (extraClass ? ' ' + extraClass : '') + '" title="Language">' + icon('globe', 16) +
      '<select data-act-change="set-lang" aria-label="Language" translate="no">' +
      K.LANGS.map((l) => '<option value="' + l.code + '"' + (K.i18n.lang === l.code ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') +
      '</select></label>'
    );
  }
  const MONTH_VIEWS = { home: 1, sheet: 1, budget: 1 };

  const S = {
    profile: store.get('kitty.profile', null),
    books: store.get('kitty.books', []),
    book: null,
    view: 'home',
    month: K.monthKey(K.today()),
    room: null,
    status: 'local',
    statusDetail: '',
    activity: [],
    flash: {},
    notes: [],
    sheet: { q: '', cat: '', who: '', type: '', sort: 'date', dir: -1 },
    proj: null,
    tipIndex: 0,
    baseline: null,
    pendingJoin: null,
    lastTipToast: 0,
  };

  const me = () => (S.profile ? S.profile.memberId : '');
  const cur = () => (S.book ? S.book.meta.currency : 'IDR');
  const fmt = (n, short) => K.fmt(n, cur(), short);
  const put = (c, rec) => K.put(S.book, c, rec, me());

  // ================================================================ persistence
  function loadBook(id) {
    return store.get('kitty.book.' + id, null);
  }
  let saveTimer = null;
  function saveBook() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBookNow, 250);
  }
  function saveBookNow() {
    clearTimeout(saveTimer);
    if (!S.book) return;
    store.set('kitty.book.' + S.book.id, S.book);
    const entry = S.books.find((b) => b.id === S.book.id);
    if (!entry) S.books.push({ id: S.book.id, name: S.book.meta.name });
    else entry.name = S.book.meta.name;
    store.set('kitty.books', S.books);
  }
  function saveProfile() {
    store.set('kitty.profile', S.profile);
  }
  window.addEventListener('pagehide', saveBookNow);
  window.addEventListener('beforeunload', saveBookNow);

  function openBook(id) {
    disconnectRoom();
    const b = loadBook(id);
    if (!b) return false;
    S.book = b;
    store.set('kitty.current', id);
    S.baseline = null;
    S.activity = store.get('kitty.activity.' + id, []);
    S.month = K.monthKey(K.today());
    S.proj = null;
    ensureMember();
    connectRoom();
    setupChannel();
    return true;
  }

  function ensureMember() {
    if (!S.book || !S.profile) return;
    const m = S.book.members[me()];
    if (!m || m._del || m.name !== S.profile.name || m.color !== S.profile.color) {
      commit(put('members', { id: me(), name: S.profile.name, color: S.profile.color, _del: false }), true);
    }
  }

  // ================================================================ mutations
  function commit(ops, quiet) {
    const list = (Array.isArray(ops) ? ops : [ops]).filter(Boolean);
    if (!list.length) return;
    saveBook();
    if (S.room) S.room.push(list);
    if (S.bc) {
      try {
        S.bc.postMessage({ tab: TAB, bookId: S.book.id, ops: list });
      } catch (e) {
        /* ignore */
      }
    }
    if (!quiet) {
      describeOps(list, me()).forEach(logActivity);
    }
    scheduleRender();
  }

  // ================================================================ sync glue
  function setStatus(status, detail) {
    S.status = status;
    S.statusDetail = detail || '';
    const pill = $('#syncPill');
    if (pill) pill.outerHTML = syncPill();
  }

  function connectRoom() {
    const b = S.book;
    if (!b || !b.room || !b.room.key) {
      S.status = 'local';
      return;
    }
    if (!window.EventSource || !(window.crypto && crypto.subtle)) {
      S.status = 'error';
      S.statusDetail = 'This browser cannot sync (needs HTTPS and a modern browser).';
      return;
    }
    S.room = new K.Room({
      bookId: b.id,
      key: b.room.key,
      relay: b.room.relay,
      me: { id: me(), name: S.profile.name, color: S.profile.color },
      getBook: () => S.book,
      onRemote: handleRemote,
      onStatus: setStatus,
      onPeer: (peer, live) => {
        if (live && peer) {
          logActivity({ who: peer.id, icon: '👋', text: 'opened the budget' });
          scheduleRender();
        }
      },
    });
    S.room.start().catch((e) => setStatus('error', e.message));
  }

  function disconnectRoom() {
    if (S.room) {
      S.room.stop();
      S.room = null;
    }
  }

  function handleRemote(changed, info) {
    saveBook();
    if (info.kind === 'live') {
      const color = memberColor(info.from);
      changed.forEach((op) => {
        if (op.c === 'txns' || op.c === 'categories' || op.c === 'holdings' || op.c === 'goals') {
          S.flash[op.id] = { color: color, until: Date.now() + 2600 };
        }
      });
      const entries = info.t === 'snap' ? [{ who: info.from, icon: '🔄', text: 'synced ' + changed.length + ' change' + (changed.length > 1 ? 's' : '') }] : describeOps(changed, info.from);
      entries.forEach(logActivity);
      if (document.hidden && entries.length) notify(memberName(info.from) + ' ' + entries[0].text, S.book.meta.name);
    }
    scheduleRender();
  }

  function setupChannel() {
    if (S.bc || !('BroadcastChannel' in window)) return;
    S.bc = new BroadcastChannel('kitty');
    S.bc.onmessage = (e) => {
      const d = e.data || {};
      if (d.tab === TAB || !S.book || d.bookId !== S.book.id) return;
      const changed = K.applyOps(S.book, d.ops || []);
      if (changed.length) scheduleRender();
    };
  }

  function memberName(id) {
    if (id === me()) return 'You';
    const m = S.book && S.book.members[id];
    if (m && m.name) return m.name;
    const p = S.room && S.room.peers[id];
    return (p && p.name) || 'Someone';
  }
  function memberColor(id) {
    const m = S.book && S.book.members[id];
    if (m && m.color) return m.color;
    const p = S.room && S.room.peers[id];
    return (p && p.color) || '#8a8fa8';
  }
  function memberOnline(id) {
    if (id === me()) return true;
    const p = S.room && S.room.peers[id];
    return !!(p && p.lastSeen && Date.now() - p.lastSeen < 5 * 60 * 1000);
  }

  // ================================================================ activity
  function logActivity(entry) {
    if (!S.book || !entry) return;
    entry.at = entry.at || Date.now();
    const top = S.activity[0];
    if (top && top.who === entry.who && top.text === entry.text && entry.at - top.at < 120000) {
      top.at = entry.at;
    } else {
      S.activity.unshift(entry);
    }
    S.activity = S.activity.slice(0, 80);
    store.set('kitty.activity.' + S.book.id, S.activity);
  }

  function describeOps(ops, from) {
    const out = [];
    ops.forEach((op) => {
      const r = op.r || {};
      if (op.c === 'txns') {
        const cat = S.book.categories[r.cat];
        const fresh = r.createdAt && r._u - r.createdAt < 5000;
        const verb = r._del ? 'deleted' : fresh ? 'added' : 'edited';
        out.push({
          who: from,
          icon: r.type === 'income' ? '💰' : (cat && cat.emoji) || '🧾',
          text: verb + ' “' + String(r.desc || 'transaction').slice(0, 40) + '” ' + fmt(r.amount) + (cat && !r._del ? ' · ' + cat.name : ''),
        });
      } else if (op.c === 'categories') {
        out.push({ who: from, icon: r.emoji || '🗂️', text: (r._del ? 'removed the ' : 'updated the ') + String(r.name || '').slice(0, 30) + ' budget' + (r._del ? '' : ' (' + fmt(r.limit) + ')') });
      } else if (op.c === 'goals') {
        out.push({ who: from, icon: r.emoji || '🎯', text: (r._del ? 'removed goal ' : 'updated goal ') + String(r.name || '').slice(0, 30) + (r._del ? '' : ' · ' + fmt(r.saved) + ' saved') });
      } else if (op.c === 'holdings') {
        out.push({ who: from, icon: '📈', text: (r._del ? 'removed ' : 'updated ') + String(r.symbol || r.name || 'a holding').slice(0, 20) + ' in the portfolio' });
      } else if (op.c === 'incomes') {
        out.push({ who: from, icon: '💼', text: (r._del ? 'removed income ' : 'updated income ') + String(r.name || '').slice(0, 30) });
      } else if (op.c === 'meta') {
        out.push({ who: from, icon: '⚙️', text: 'changed budget settings' });
      }
    });
    return out.slice(0, 6);
  }

  // ================================================================ toasts & notifications
  function toast(o) {
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    const life = o.timeout || (o.tone === 'bad' || o.tone === 'warn' ? 9000 : 5000);
    el.className = 'toast tone-' + (o.tone || 'info');
    el.style.setProperty('--life', life + 'ms');
    el.setAttribute('role', o.tone === 'bad' || o.tone === 'warn' ? 'alert' : 'status');
    el.innerHTML =
      '<span class="toast-icon">' + (o.icon ? esc(o.icon) : o.tone === 'bad' ? '🚨' : o.tone === 'warn' ? '⚠️' : o.tone === 'good' ? '✅' : '🌿') + '</span>' +
      '<div class="toast-body"><b>' + esc(o.title || '') + '</b>' + (o.body ? '<p>' + esc(o.body) + '</p>' : '') + '</div>' +
      (o.action ? '<button class="toast-action">' + esc(o.action.label) + '</button>' : '') +
      '<button class="toast-x" aria-label="Dismiss">' + icon('x', 16) + '</button>';
    host.appendChild(el);
    let timer = null;
    let remaining = life;
    let startedAt = Date.now();
    const kill = () => {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
    };
    const hold = () => {
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
      el.classList.add('is-held');
    };
    const release = () => {
      clearTimeout(timer);
      startedAt = Date.now();
      timer = setTimeout(kill, Math.max(1200, remaining));
      el.classList.remove('is-held');
    };
    el.querySelector('.toast-x').onclick = kill;
    if (o.action) {
      el.querySelector('.toast-action').onclick = () => {
        o.action.fn();
        kill();
      };
    }
    // A mouse over the toast holds it; on touch screens a sideways swipe dismisses it.
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') hold();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') release();
    });
    let swipeFrom = null;
    let swipeBy = 0;
    el.addEventListener(
      'touchstart',
      (e) => {
        swipeFrom = e.touches[0].clientX;
        swipeBy = 0;
        hold();
        el.style.transition = 'none';
      },
      { passive: true }
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (swipeFrom == null) return;
        swipeBy = e.touches[0].clientX - swipeFrom;
        el.style.transform = 'translateX(' + swipeBy + 'px)';
        el.style.opacity = String(Math.max(0.2, 1 - Math.abs(swipeBy) / 220));
      },
      { passive: true }
    );
    el.addEventListener('touchend', () => {
      if (swipeFrom == null) return;
      swipeFrom = null;
      el.style.transition = '';
      if (Math.abs(swipeBy) > 70) {
        el.style.transform = 'translateX(' + (swipeBy > 0 ? 120 : -120) + '%)';
        el.style.opacity = '0';
        kill();
        return;
      }
      el.style.transform = '';
      el.style.opacity = '';
      release();
    });
    timer = setTimeout(kill, life);
    while (host.children.length > 4) host.firstChild.remove();
  }

  function notify(title, body) {
    if (!S.profile || !S.profile.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    title = K.i18n.tr(title);
    body = K.i18n.tr(body);
    try {
      new Notification(title, { body: body, icon: '../icons/icon-192.png', tag: 'mint-' + title.slice(0, 20) });
    } catch (e) {
      /* some browsers require a service worker for notifications */
    }
  }

  // ================================================================ native app shell (Capacitor: Android / iPhone)
  // The Mint apps load this same site; Capacitor injects window.Capacitor before our scripts run.
  const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const NATIVE_PLATFORM = NATIVE ? window.Capacitor.getPlatform() : 'web';
  const PUBLIC_URL = 'https://juw12.github.io/projects/mint/budget/';
  const GET_APP_URL = 'get.html';

  function nativeCall(plugin, method, options) {
    if (!NATIVE || typeof window.Capacitor.nativePromise !== 'function') {
      return Promise.reject(new Error('Not running in the Mint app'));
    }
    return window.Capacitor.nativePromise(plugin, method, options || {});
  }

  function nativeListen(plugin, eventName, callback) {
    if (NATIVE && typeof window.Capacitor.addListener === 'function') {
      try {
        const handle = window.Capacitor.addListener(plugin, eventName, callback);
        if (handle && typeof handle.catch === 'function') handle.catch(() => {});
      } catch (e) {
        /* plugin not in this shell */
      }
    }
  }

  function haptic(kind) {
    if (!NATIVE) return;
    const call = kind === 'warn'
      ? nativeCall('Haptics', 'notification', { type: 'WARNING' })
      : kind === 'success'
        ? nativeCall('Haptics', 'notification', { type: 'SUCCESS' })
        : nativeCall('Haptics', 'impact', { style: 'LIGHT' });
    call.catch(() => {});
  }

  function canShare() {
    return NATIVE || !!navigator.share;
  }

  function shareSheet(title, text, url) {
    title = K.i18n.tr(title);
    text = K.i18n.tr(text);
    if (NATIVE) {
      return nativeCall('Share', 'share', { title: title, text: text, url: url, dialogTitle: title });
    }
    return navigator.share({ title: title, text: text, url: url });
  }

  // ================================================================ shareable result card
  function wrapLines(ctx, text, maxWidth) {
    const words = String(text).split(/(\s+)/);
    const lines = [];
    let line = '';
    const pushChars = (chunk) => {
      // CJK text has no spaces: break by character when a word is too wide.
      for (const ch of chunk) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch.trim() ? ch : '';
        } else {
          line += ch;
        }
      }
    };
    words.forEach((word) => {
      if (ctx.measureText(line + word).width <= maxWidth) {
        line += word;
      } else if (ctx.measureText(word).width > maxWidth) {
        pushChars(word);
      } else {
        lines.push(line.trim());
        line = word.trim() ? word : '';
      }
    });
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function makeResultCard(personaId) {
    const p = K.PERSONAS[personaId];
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const sans = '"Inter", -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", Roboto, sans-serif';
    const tr = (s) => K.i18n.tr(s);

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, p.color);
    bg.addColorStop(1, '#0b0b12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(W - 120, 180, 360, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 44px ' + sans;
    ctx.fillText('🌿 Mint', 80, 130);

    ctx.textAlign = 'center';
    ctx.font = '300px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText(p.emoji, W / 2, 460);

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 36px ' + sans;
    ctx.fillText(tr('My money animal').toUpperCase(), W / 2, 580);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 104px ' + sans;
    let y = 695;
    const nameLines = wrapLines(ctx, tr(p.name), W - 160);
    nameLines.forEach((ln) => {
      ctx.fillText(ln, W / 2, y);
      y += 110;
    });
    ctx.font = '500 48px ' + sans;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(tr(p.tagline), W / 2, y - 20);

    ctx.font = '600 34px ' + sans;
    const chips = p.strengths.slice(0, nameLines.length > 1 ? 2 : 3).map(tr);
    let cy = y + 70;
    chips.forEach((chip) => {
      const label = '✓  ' + chip;
      const width = ctx.measureText(label).width + 64;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(W / 2 - width / 2, cy - 44, width, 64, 32);
      } else {
        ctx.rect(W / 2 - width / 2, cy - 44, width, 64);
      }
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, W / 2, cy);
      cy += 84;
    });

    const fitText = (text, weight, size, yPos) => {
      let px = size;
      ctx.font = weight + ' ' + px + 'px ' + sans;
      while (ctx.measureText(text).width > W - 140 && px > 20) {
        px -= 2;
        ctx.font = weight + ' ' + px + 'px ' + sans;
      }
      ctx.fillText(text, W / 2, yPos);
    };
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    fitText(tr('What kind of money animal are you?'), '700', 40, H - 160);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    fitText(tr('Find yours in 2 minutes, free.'), '500', 32, H - 108);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    fitText('juw12.github.io/projects/mint', '600', 28, H - 62);
    return canvas;
  }
  K.makeResultCard = makeResultCard;

  async function shareResult() {
    const p = K.PERSONAS[S.profile.persona];
    if (!p) return startQuiz();
    const text = K.t("I'm {name} on Mint. What's your money animal?", { name: K.i18n.tr(p.name) + ' ' + p.emoji });
    const url = PUBLIC_URL;
    if (NATIVE) {
      try {
        await shareSheet('My money animal', text, url);
      } catch (err) {
        /* cancelled */
      }
      return;
    }
    const canvas = makeResultCard(S.profile.persona);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const fileName = 'mint-money-animal-' + S.profile.persona + '.png';
    const file = typeof File === 'function' && blob ? new File([blob], fileName, { type: 'image/png' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: K.i18n.tr('My money animal'), text: text + ' ' + url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
    } catch (err) {
      /* clipboard may be blocked */
    }
    toast({ icon: p.emoji, tone: 'good', title: 'Result card saved', body: 'Find yours in 2 minutes, free.' });
  }

  function handleBackButton() {
    if (document.querySelector('.modal-wrap')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const quiz = document.querySelector('.quiz-overlay');
    if (quiz) {
      const back = quiz.querySelector('[data-act="back"]') || quiz.querySelector('[data-act="cancel"]');
      if (back) back.click();
      return;
    }
    if (S.book && S.view !== 'home') {
      go('home');
      return;
    }
    nativeCall('App', 'minimizeApp').catch(() => nativeCall('App', 'exitApp').catch(() => {}));
  }

  function setupNative() {
    if (!NATIVE) return;
    document.documentElement.classList.add('native-app', 'native-' + NATIVE_PLATFORM);
    nativeListen('App', 'backButton', handleBackButton);
    nativeListen('App', 'appUrlOpen', (event) => {
      // Invite links (https://juw12.github.io/projects/mint/budget/#join=..., or the old /projects/kitty/ ones) opened from chat apps.
      const url = event && event.url ? String(event.url) : '';
      const at = url.indexOf('#join=');
      if (at >= 0) location.hash = url.slice(at);
    });
  }

  function raiseAlert(a) {
    S.notes.unshift({ at: Date.now(), level: a.level, title: a.title, body: a.body });
    S.notes = S.notes.slice(0, 30);
    toast({ tone: a.level === 'over' ? 'bad' : 'warn', title: a.title, body: a.body, action: { label: 'View', fn: () => go('budget') } });
    haptic('warn');
    notify(a.title, a.body);
  }

  function checkAlerts(stats) {
    const key = S.book.id + ':' + stats.mk;
    if (S.baseline && S.baseline.key === key) {
      const crossed = K.crossings(S.baseline.stats, stats);
      if (crossed.length) {
        const alerts = K.alertsFor(stats, cur());
        crossed.forEach((id) => {
          const a = alerts.find((x) => x.catId === id);
          if (a) raiseAlert(a);
        });
      }
    }
    S.baseline = { key: key, stats: stats };
  }

  function currentTips(stats) {
    return K.tipsFor({ book: S.book, stats: stats, profile: S.profile, portfolio: K.portfolio(S.book) });
  }

  function maybeTipToast(stats, force) {
    if (!S.profile || S.profile.tips === false) return;
    const today = K.today();
    if (!force && store.get('kitty.tipDay', '') === today) return;
    // Never drop a tip on top of an open dialog or the quiz; try again once it is closed.
    if (document.querySelector('.modal-wrap, .quiz-overlay')) {
      setTimeout(() => S.book && maybeTipToast(K.monthStats(S.book, S.month), force), 4000);
      return;
    }
    const tips = currentTips(stats);
    if (!tips.length) return;
    const tip = force ? tips[Math.floor(Math.random() * tips.length)] : tips[0];
    store.set('kitty.tipDay', today);
    S.lastTipToast = Date.now();
    toast({ icon: tip.icon, title: tip.title, body: tip.body, timeout: 9000 });
  }

  // ================================================================ rendering
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function captureFocus() {
    const el = document.activeElement;
    if (!el || !el.dataset) return null;
    // The sheet search re-renders the page on every keystroke; keep the caret in the box.
    if (el.dataset.filter === 'q') return { filter: 'q', start: el.selectionStart, end: el.selectionEnd };
    if (!(el.dataset.k || el.dataset.nk)) return null;
    return {
      k: el.dataset.k,
      nk: el.dataset.nk,
      value: el.value,
      dirty: el.dataset.dirty === '1',
      start: el.selectionStart,
      end: el.selectionEnd,
    };
  }
  function restoreFocus(f) {
    if (!f) return;
    const sel = f.filter ? '[data-filter="' + f.filter + '"]' : f.k ? '[data-k="' + CSS.escape(f.k) + '"]' : '[data-nk="' + CSS.escape(f.nk) + '"]';
    const el = $(sel);
    if (!el) return;
    if (!f.filter && (f.dirty || f.nk)) {
      el.value = f.value;
      if (f.dirty) el.dataset.dirty = '1';
    }
    el.focus({ preventScroll: true });
    try {
      if (f.start != null && el.setSelectionRange) el.setSelectionRange(f.start, f.end);
    } catch (e) {
      /* not a text input */
    }
  }

  // ---------------------------------------------------------------- theme: light / dark / system
  const SHARED_THEME = 'mint.theme';
  function sharedTheme() {
    try {
      return localStorage.getItem(SHARED_THEME);
    } catch (e) {
      return null;
    }
  }
  function themeMode() {
    const t = sharedTheme() || (S.profile && S.profile.theme) || params.get('theme') || 'system';
    return t === 'light' || t === 'dark' ? t : 'system';
  }
  function systemDark() {
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function reducedMotion() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function applyTheme() {
    const t = themeMode();
    const dark = t === 'dark' || (t === 'system' && systemDark());
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090b' : '#f6f6f7');
  }
  window.addEventListener('storage', (e) => {
    if (e.key === SHARED_THEME) applyTheme();
  });
  function themeIcon() {
    return icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  }
  /** Switch and remember the theme. The new look grows out of the pressed button (View Transitions) or cross-fades. */
  function setTheme(mode, origin) {
    const next = mode === 'light' || mode === 'dark' ? mode : 'system';
    const root = document.documentElement;
    const before = root.dataset.theme;
    const save = () => {
      try {
        localStorage.setItem(SHARED_THEME, next);
      } catch (e) {
        /* storage blocked: this page still switches */
      }
      if (S.profile) {
        S.profile.theme = next;
        saveProfile();
      } else {
        params.set('theme', next);
        const u = new URL(location.href);
        u.searchParams.set('theme', next);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
      applyTheme();
      // Theme pickers that live outside the re-rendered page (the phone "More" sheet) update in place.
      $$('[data-act="set-theme"]').forEach((b) => {
        const on = b.dataset.theme === next;
        b.classList.toggle('is-on', on);
        if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      render();
    };
    const after = next === 'dark' || (next === 'system' && systemDark()) ? 'dark' : 'light';
    if (after === before || reducedMotion()) return save();
    root.classList.add('theme-flip');
    setTimeout(() => root.classList.remove('theme-flip'), 600);
    if (document.startViewTransition && origin && origin.getBoundingClientRect) {
      const r = origin.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      try {
        const transition = document.startViewTransition(save);
        transition.ready
          .then(() => {
            root.animate(
              { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
              { duration: 480, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' }
            );
          })
          .catch(() => {});
        return;
      } catch (e) {
        /* fall back to the cross-fade below */
      }
    }
    root.classList.add('theme-fade');
    save();
    setTimeout(() => root.classList.remove('theme-fade'), 450);
  }
  function toggleTheme(origin) {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', origin);
  }

  function render() {
    applyTheme();
    const root = $('#app');
    if (!S.profile || !S.book) {
      renderWelcome(root);
      return;
    }
    if (!$('.shell', root)) root.innerHTML = shellHTML();
    const focus = captureFocus();
    const stats = K.monthStats(S.book, S.month);
    renderChrome(stats);
    const view = $('#view');
    const changedView = view.dataset.view !== S.view;
    // Entrance motion only when a page or month opens. Live re-renders (edits, sync, clock ticks) stay still;
    // a re-render within 300 ms of an entrance (boot, quick commits) simply restarts it.
    const animate = changedView || S.animateNext || Date.now() - (S.enterAt || 0) < 300;
    S.animateNext = false;
    view.classList.remove('enter');
    view.innerHTML = renderView(stats);
    view.dataset.view = S.view;
    if (animate) {
      if (changedView || !S.enterAt || Date.now() - S.enterAt >= 300) S.enterAt = Date.now();
      void view.offsetWidth;
      view.classList.add('enter');
      countUp(view);
    }
    if (changedView) window.scrollTo({ top: 0 });
    restoreFocus(focus);
    applyFlash();
    checkAlerts(stats);
  }

  /** Money figures count up from zero when a page opens (data-count = number, data-short="1" for 1,2 jt style). */
  function countUp(rootEl) {
    if (reducedMotion()) return;
    const els = $$('[data-count]', rootEl).filter((el) => isFinite(Number(el.dataset.count)));
    if (!els.length) return;
    els.forEach((el) => {
      el.textContent = fmt(0, el.dataset.short === '1');
    });
    const start = performance.now();
    const duration = 650;
    const frame = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      let alive = false;
      els.forEach((el) => {
        if (!el.isConnected) return;
        alive = true;
        const target = Number(el.dataset.count);
        el.textContent = fmt(p < 1 ? target * eased : target, el.dataset.short === '1');
      });
      if (alive && p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function applyFlash() {
    const now = Date.now();
    Object.keys(S.flash).forEach((id) => {
      const f = S.flash[id];
      if (f.until < now) {
        delete S.flash[id];
        return;
      }
      $$('[data-row="' + CSS.escape(id) + '"]').forEach((el) => {
        el.style.setProperty('--flash', f.color);
        el.classList.add('flash');
      });
    });
  }

  function shellHTML() {
    return (
      '<div class="shell">' +
      '<aside class="side">' +
      BRAND +
      '<div id="bookSwitch"></div>' +
      '<nav class="nav" id="nav" aria-label="Main"></nav>' +
      '<div class="side-apps"><p class="side-label">Also in Mint</p>' +
      '<a class="nav-item nav-templates" href="' + TEMPLATES_URL + '" data-templates>' + icon('template') + '<span>Templates</span></a></div>' +
      '<div class="side-foot" id="sideFoot"></div>' +
      '</aside>' +
      '<div class="main"><header class="top" id="top"></header><main id="view" class="view"></main></div>' +
      '<nav class="bottom-nav" id="bottomNav" aria-label="Main"></nav>' +
      '</div>'
    );
  }

  function syncInfo() {
    const st = S.status;
    const members = K.list(S.book, 'members');
    const online = members.filter((m) => memberOnline(m.id)).length;
    const map = {
      local: ['pill-local', icon('lock', 14), 'Private'],
      connecting: ['pill-sync', '<i class="pulse"></i>', 'Connecting…'],
      syncing: ['pill-sync', '<i class="pulse"></i>', 'Syncing…'],
      reconnecting: ['pill-sync', '<i class="pulse"></i>', 'Reconnecting…'],
      live: ['pill-live', '<i class="dot"></i>', 'Live' + (online > 1 ? ' · ' + online + ' online' : '')],
      offline: ['pill-off', '<i class="dot"></i>', 'Offline · saved'],
      error: ['pill-off', '<i class="dot"></i>', 'Sync error'],
      idle: ['pill-local', icon('lock', 14), 'Private'],
    };
    return map[st] || map.local;
  }
  function syncPill() {
    const m = syncInfo();
    return '<button id="syncPill" class="pill ' + m[0] + '" data-act="go" data-view="share" title="' + esc(S.statusDetail || 'Sharing & sync') + '">' + m[1] + '<span>' + m[2] + '</span></button>';
  }

  function renderChrome(stats) {
    const book = S.book;
    const members = K.list(book, 'members');
    $('#bookSwitch').innerHTML =
      '<label class="book-switch"><span class="sr">Budget</span><select data-act-change="switch-book" aria-label="Switch budget">' +
      S.books.map((b) => '<option value="' + esc(b.id) + '"' + (b.id === book.id ? ' selected' : '') + '>' + esc(b.id === book.id ? book.meta.name : b.name) + '</option>').join('') +
      '<option value="__new">＋ New budget…</option></select></label>';
    $('#nav').innerHTML = VIEWS.map(
      (v) =>
        '<button class="nav-item' + (S.view === v.id ? ' is-on' : '') + '" data-act="go" data-view="' + v.id + '"' + (S.view === v.id ? ' aria-current="page"' : '') + '>' + icon(v.icon) + '<span>' + v.label + '</span>' +
        (v.id === 'share' && book.room ? '<em class="nav-badge">' + members.length + '</em>' : '') + '</button>'
    ).join('');
    const p = K.PERSONAS[S.profile.persona];
    $('#sideFoot').innerHTML = p
      ? '<button class="persona-mini" data-act="go" data-view="you" style="--pc:' + p.color + '"><span>' + p.emoji + '</span><div><b>' + esc(p.name) + '</b><small>' + esc(p.tagline) + '</small></div></button>'
      : '<button class="persona-mini" data-act="quiz"><span>🌿</span><div><b>Find your money animal</b><small>2-minute quiz</small></div></button>';
    const alerts = K.alertsFor(stats, cur());
    const urgent = alerts.filter((a) => a.level !== 'pace').length;
    const viewMeta = VIEWS.find((v) => v.id === S.view) || VIEWS[0];
    const avatars = members
      .slice(0, 4)
      .map((m) => '<span class="av-wrap' + (memberOnline(m.id) && book.room ? ' online' : '') + '">' + ui.avatar(m, 30) + '</span>')
      .join('');
    const top = $('#top');
    top.classList.toggle('has-month', !!MONTH_VIEWS[S.view]);
    top.innerHTML =
      '<div class="top-left">' +
      LOGO.replace('class="logo"', 'class="logo only-mobile"') +
      '<div class="top-titles"><p class="top-book" translate="no">' + esc(book.meta.name) + '</p><h1 class="top-title">' + esc(viewMeta.label) + '</h1></div>' +
      (MONTH_VIEWS[S.view]
        ? '<div class="month-switch"><button class="icon-btn" data-act="month" data-d="-1" aria-label="Previous month" title="Previous month">' + icon('left') + '</button>' +
          '<span>' + esc(K.monthLabel(S.month, true)) + '</span>' +
          '<button class="icon-btn" data-act="month" data-d="1" aria-label="Next month" title="Next month">' + icon('right') + '</button></div>'
        : '') +
      '</div>' +
      '<div class="top-right">' +
      syncPill() +
      '<div class="av-stack hide-sm">' + avatars + '</div>' +
      '<button class="btn btn-share hide-sm" data-act="go" data-view="share">' + icon(book.room ? 'users' : 'share', 18) + '<span>' + (book.room ? 'Shared' : 'Share') + '</span></button>' +
      '<button class="icon-btn theme-btn" data-act="theme" aria-label="Toggle theme" title="Toggle theme">' + themeIcon() + '</button>' +
      '<div class="bell-wrap"><button class="icon-btn" data-act="bell" aria-label="Alerts" title="Alerts">' + icon('bell') + (urgent + (U.available ? 1 : 0) ? '<em class="badge">' + (urgent + (U.available ? 1 : 0)) + '</em>' : '') + '</button>' +
      '<div class="bell-panel" id="bellPanel" hidden></div></div>' +
      '<button class="btn btn-primary hide-sm" data-act="quick-add">' + icon('plus', 18) + '<span>Add</span></button>' +
      '</div>';
    const moreOn = MORE_VIEWS.indexOf(S.view) >= 0;
    $('#bottomNav').innerHTML = MOBILE_NAV.map((id) => {
      if (id === 'add') {
        return '<button class="bn-add" data-act="quick-add" aria-label="Add transaction" title="Add transaction">' + icon('plus', 26) + '</button>';
      }
      if (id === 'more') {
        return '<button class="bn-item' + (moreOn ? ' is-on' : '') + '" data-act="more" aria-haspopup="dialog"' + (moreOn ? ' aria-current="page"' : '') + '>' + icon('grid', 22) + '<span>More</span></button>';
      }
      const v = VIEWS.find((x) => x.id === id);
      const on = S.view === id;
      return '<button class="bn-item' + (on ? ' is-on' : '') + '" data-act="go" data-view="' + id + '"' + (on ? ' aria-current="page"' : '') + '>' + icon(v.icon, 22) + '<span>' + v.label + '</span></button>';
    }).join('');
  }

  function renderView(stats) {
    switch (S.view) {
      case 'sheet':
        return viewSheet(stats);
      case 'budget':
        return viewBudget(stats);
      case 'goals':
        return viewGoals();
      case 'invest':
        return viewInvest(stats);
      case 'you':
        return viewYou(stats);
      case 'share':
        return viewShare();
      case 'settings':
        return viewSettings();
      default:
        return viewHome(stats);
    }
  }

  function go(view) {
    S.view = VIEWS.some((v) => v.id === view) ? view : 'home';
    if (S.view === 'budget' && S.profile && !(S.profile.seen || {}).budget) {
      S.profile.seen = Object.assign({}, S.profile.seen, { budget: true });
      saveProfile();
    }
    const url = new URL(location.href);
    url.searchParams.set('view', S.view);
    url.searchParams.delete('demo');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    render();
  }

  // ================================================================ getting-started checklist
  function setupSteps() {
    const b = S.book;
    return [
      { id: 'create', done: true, title: 'Create your budget' },
      { id: 'expense', done: K.list(b, 'txns').length > 0, title: 'Add your first expense', body: 'Tap + whenever you spend. It takes five seconds.', act: 'quick-add' },
      { id: 'plan', done: !!(S.profile.seen || {}).budget, title: 'Check your monthly plan', body: 'See how Mint split your income. Change any limit with a tap.', act: 'go', view: 'budget' },
      { id: 'share', done: !!b.room, title: 'Invite your partner or housemates', body: 'Optional. Everyone edits the same budget, live.', act: 'go', view: 'share' },
      { id: 'quiz', done: !!S.profile.persona, title: 'Find your money animal', body: 'Optional 2-minute quiz for tips that fit you.', act: 'quiz' },
    ];
  }

  function checklistVisible() {
    if (!S.book || !S.profile || S.profile.demo || String(S.book.id).indexOf('demo-') === 0) return false;
    if ((S.profile.hideSetup || {})[S.book.id]) return false;
    return setupSteps().some((s) => !s.done);
  }

  function checklistCard() {
    if (!checklistVisible()) return '';
    const steps = setupSteps();
    const done = steps.filter((s) => s.done).length;
    const next = steps.find((s) => !s.done);
    return (
      '<div class="card setup-card">' +
      '<div class="card-head"><div><p class="eyebrow">Getting started</p><h3>' + done + ' of ' + steps.length + ' done</h3></div>' +
      '<button class="link" data-act="hide-setup">Hide</button></div>' +
      '<div class="setup-progress" aria-hidden="true"><span style="width:' + Math.round((done / steps.length) * 100) + '%"></span></div>' +
      '<ol class="setup-steps">' +
      steps
        .map((s) => {
          const isNext = s === next;
          return (
            '<li class="' + (s.done ? 'is-done' : isNext ? 'is-next' : '') + '">' +
            '<span class="setup-check">' + (s.done ? icon('check', 14) : '') + '</span>' +
            '<div class="setup-text"><b>' + esc(s.title) + '</b>' + (isNext && s.body ? '<small>' + esc(s.body) + '</small>' : '') + '</div>' +
            (s.done
              ? ''
              : '<button class="btn btn-sm ' + (isNext ? 'btn-primary' : 'btn-soft') + '" data-act="' + s.act + '"' + (s.view ? ' data-view="' + s.view + '"' : '') + '>' + (isNext ? 'Start' : 'Open') + '</button>') +
            '</li>'
          );
        })
        .join('') +
      '</ol></div>'
    );
  }

  // ================================================================ helpers for views
  function catList() {
    return K.list(S.book, 'categories').sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  function catOptions(selected, withNone) {
    const cats = catList();
    let html = withNone !== false ? '<option value="">— Uncategorized</option>' : '';
    Object.keys(K.GROUPS).forEach((g) => {
      const inG = cats.filter((c) => c.group === g);
      if (!inG.length) return;
      html += '<optgroup label="' + esc(K.GROUPS[g].label) + '">';
      inG.forEach((c) => {
        html += '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc((c.emoji ? c.emoji + ' ' : '') + c.name) + '</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }
  function memberOptions(selected) {
    return K.list(S.book, 'members')
      .map((m) => '<option value="' + esc(m.id) + '"' + (m.id === selected ? ' selected' : '') + '>' + esc(m.id === me() ? m.name + ' (you)' : m.name) + '</option>')
      .join('');
  }
  function pctText(p) {
    return isFinite(p) ? Math.round(p * 100) + '%' : '—';
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night';
  }
  function emptyState(emoji, title, body, actions) {
    return '<div class="empty"><div class="empty-emoji">' + emoji + '</div><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p><div class="row-gap">' + (actions || '') + '</div></div>';
  }
  function activityList(limit) {
    const items = S.activity.slice(0, limit || 8);
    if (!items.length) return '<p class="muted small">Changes from you and your collaborators show up here, live.</p>';
    return (
      '<ul class="feed">' +
      items
        .map(
          (a) =>
            '<li>' + ui.avatar({ name: memberName(a.who), color: memberColor(a.who) }, 26) +
            '<div><p><b>' + esc(memberName(a.who)) + '</b> ' + esc(a.text) + '</p><small>' + esc(a.icon || '') + ' ' + esc(ui.timeAgo(a.at)) + '</small></div></li>'
        )
        .join('') +
      '</ul>'
    );
  }

  // ================================================================ view: overview
  function viewHome(st) {
    const cats = catList();
    if (!cats.length && !K.list(S.book, 'txns').length) {
      return (
        '<div class="card">' +
        emptyState(
          '🧺',
          'This budget is empty',
          S.book.room && S.status !== 'live' ? 'Waiting for data from your collaborators…' : 'Let Mint build envelopes from your income and personality, or start from scratch.',
          '<button class="btn btn-primary" data-act="apply-plan">' + icon('sparkle', 18) + ' Use Mint\'s plan</button><button class="btn btn-soft" data-act="go" data-view="budget">Set up manually</button>'
        ) +
        '</div>'
      );
    }
    const p = K.PERSONAS[S.profile.persona];
    const tips = currentTips(st);
    const tip = tips.length ? tips[S.tipIndex % tips.length] : null;
    const spentPct = st.spendLimit > 0 ? st.spent / st.spendLimit : 0;
    const leftToSpend = st.spendLimit - st.spent;
    const alerts = K.alertsFor(st, cur());
    const ringColor = spentPct >= 1 ? 'var(--bad)' : spentPct >= (S.book.meta.alertAt || 80) / 100 ? 'var(--warn)' : 'var(--accent)';
    const hero =
      '<div class="card hero-card">' +
      '<div class="hero-text"><p class="eyebrow">' + esc(greeting()) + ', ' + esc(S.profile.name) + ' 👋</p>' +
      '<h2 class="hero-amount' + (leftToSpend < 0 ? ' neg' : '') + '" data-count="' + leftToSpend + '">' + esc(fmt(leftToSpend)) + '</h2>' +
      '<p class="muted">' + (leftToSpend < 0 ? 'over your spending limits' : 'left to spend') + ' in ' + esc(K.monthLabel(st.mk, true)) + ' · ' + esc(fmt(st.spent)) + ' of ' + esc(fmt(st.spendLimit)) + ' spent</p>' +
      '<div class="row-gap"><button class="btn btn-primary" data-act="quick-add">' + icon('plus', 18) + ' Add expense</button><button class="btn btn-soft" data-act="go" data-view="sheet">' + icon('sheet', 18) + ' Open sheet</button></div></div>' +
      '<div class="hero-ring">' + ui.ring(spentPct, { size: 150, thickness: 14, color: ringColor, label: pctText(spentPct) }) + '<small>of limits used</small></div>' +
      '</div>';
    const tipCard = tip
      ? '<div class="card tip-card"' + (p ? ' style="--pc:' + p.color + '"' : '') + '>' +
        '<div class="tip-head"><span class="tip-icon">' + esc(tip.icon) + '</span><div><p class="eyebrow">' + (tip.kind === 'persona' ? 'Tip for ' + esc(p ? p.name : 'you') : 'Mint noticed') + '</p><h3>' + esc(tip.title) + '</h3></div></div>' +
        '<p>' + esc(tip.body) + '</p>' +
        '<div class="tip-foot"><span class="muted small">' + (S.tipIndex % tips.length + 1) + ' / ' + tips.length + '</span><button class="btn btn-ghost btn-sm" data-act="next-tip">Next tip ' + icon('right', 16) + '</button></div></div>'
      : '';
    // Each figure doubles as a shortcut: Income and Safe to spend open the budget, Spent the sheet, Saved the goals.
    const kpi = (label, value, sub, tone, view) =>
      '<button class="card kpi kpi-link' + (tone ? ' kpi-' + tone : '') + '" data-act="go" data-view="' + view + '">' +
      '<span class="kpi-label">' + esc(label) + '</span>' +
      '<span class="kpi-value" data-count="' + (Number(value) || 0) + '">' + esc(fmt(value)) + '</span>' +
      '<span class="kpi-sub">' + sub + '</span>' + icon('right', 16) + '</button>';
    const kpis =
      '<div class="kpis">' +
      kpi('Income', st.income, st.actualIncome > 0 ? esc(fmt(st.actualIncome)) + ' received' : esc(fmt(st.plannedIncome)) + ' planned', '', 'budget') +
      kpi('Spent', st.spent, st.txnCount + ' transactions', st.spent > st.spendLimit && st.spendLimit > 0 ? 'bad' : '', 'sheet') +
      kpi('Saved & invested', st.saved, 'Savings rate <b>' + Math.round(Math.max(0, st.savingsRate) * 100) + '%</b>', st.savingsRate >= 0.2 ? 'good' : '', 'goals') +
      (st.isCurrent
        ? kpi('Safe to spend today', st.safeDaily || 0, st.daysLeft + ' days left this month', 'accent', 'budget')
        : kpi('Left over', st.left, st.left >= 0 ? 'unspent this month' : 'overspent', st.left < 0 ? 'bad' : 'good', 'budget')) +
      '</div>';

    const spendRows = st.rows.filter((r) => !r.isSaving && r.spent > 0).sort((a, b) => b.spent - a.spent);
    const segs = spendRows.map((r) => ({ value: r.spent, color: ui.catColor(r.cat), label: r.cat.name + ': ' + fmt(r.spent) }));
    if (st.byCat._none) segs.push({ value: st.byCat._none, color: '#9aa0b5', label: 'Uncategorized: ' + fmt(st.byCat._none) });
    const donutCard =
      '<div class="card"><div class="card-head"><h3>Where it went</h3><span class="muted small">' + esc(K.monthLabel(st.mk)) + '</span></div>' +
      '<div class="donut-wrap">' + ui.donut(segs, { size: 190, thickness: 24, center: fmt(st.spent, true), sub: 'spent', label: 'Spending by category' }) +
      '<ul class="legend">' +
      spendRows
        .slice(0, 6)
        .map((r) => '<li><i style="background:' + ui.catColor(r.cat) + '"></i><span>' + esc(r.cat.emoji || '') + ' ' + esc(r.cat.name) + '</span><b>' + esc(fmt(r.spent, true)) + '</b></li>')
        .join('') +
      (spendRows.length ? '' : '<li class="muted">No spending yet</li>') +
      '</ul></div></div>';
    const paceCard =
      '<div class="card"><div class="card-head"><h3>Spending pace</h3><span class="legend-inline"><i class="sw sw-spend"></i>Actual <i class="sw sw-pace"></i>Even pace</span></div>' +
      ui.paceChart({ cumulative: st.cumulative, dim: st.dim, day: st.day, budget: st.spendLimit, cur: cur() }) +
      '<p class="muted small">' +
      (st.isCurrent && st.day > 0 && st.spendLimit > 0
        ? (st.cumulative[st.day - 1] > (st.spendLimit * st.day) / st.dim
            ? '⚡ You are ' + esc(fmt(st.cumulative[st.day - 1] - (st.spendLimit * st.day) / st.dim)) + ' ahead of an even pace.'
            : '🌿 You are ' + esc(fmt((st.spendLimit * st.day) / st.dim - st.cumulative[st.day - 1])) + ' under an even pace. Nice.')
        : 'Spending across all non-savings categories.') +
      '</p></div>';

    const envRows = st.rows
      .filter((r) => !r.isSaving)
      .sort((a, b) => K.STATUS_RANK[b.status] - K.STATUS_RANK[a.status] || (isFinite(b.pct) ? b.pct : 9) - (isFinite(a.pct) ? a.pct : 9))
      .slice(0, 7);
    const envCard =
      '<div class="card"><div class="card-head"><h3>Budgets</h3><button class="link" data-act="go" data-view="budget">See all</button></div>' +
      envRows
        .map(
          (r) =>
            '<div class="env-mini" data-row="' + esc(r.id) + '"><div class="env-mini-top"><span>' + esc(r.cat.emoji || '') + ' ' + esc(r.cat.name) + '</span><span class="' + (r.status !== 'ok' ? 'st-' + r.status : 'muted') + '">' +
            esc(fmt(r.spent, true)) + ' / ' + esc(fmt(r.limit, true)) + '</span></div>' + ui.bar(r.pct, r.status, ui.catColor(r.cat)) + '</div>'
        )
        .join('') +
      '</div>';
    const alertCard =
      '<div class="card"><div class="card-head"><h3>Warnings</h3>' + (alerts.length ? '<span class="chip chip-warn">' + alerts.length + '</span>' : '') + '</div>' +
      (alerts.length
        ? '<ul class="alerts">' + alerts.slice(0, 5).map((a) => '<li class="al-' + a.level + '"><span>' + (a.level === 'over' ? '🚨' : a.level === 'warn' ? '⚠️' : '⚡') + '</span><div><b>' + esc(a.title) + '</b><p>' + esc(a.body) + '</p></div></li>').join('') + '</ul>'
        : '<div class="all-good">✨ Every budget is on track.</div>') +
      '</div>';
    const members = K.list(S.book, 'members');
    const memberCard =
      members.length > 1
        ? '<div class="card"><div class="card-head"><h3>Who spent what</h3><span class="muted small">' + members.length + ' people</span></div>' +
          members
            .map((m) => {
              const v = st.byMember[m.id] || 0;
              return '<div class="member-row">' + ui.avatar(m, 28) + '<div class="grow"><div class="env-mini-top"><span>' + esc(m.id === me() ? m.name + ' (you)' : m.name) + '</span><b>' + esc(fmt(v, true)) + '</b></div>' + ui.bar(st.spent ? v / st.spent : 0, 'ok', m.color) + '</div></div>';
            })
            .join('') +
          '</div>'
        : '<div class="card share-nudge"><h3>' + icon('users', 20) + ' Budget together</h3><p class="muted">Invite a partner, family or housemates. Everyone edits the same sheet live, end-to-end encrypted.</p><button class="btn btn-soft" data-act="go" data-view="share">Invite people</button></div>';
    const feedCard = '<div class="card"><div class="card-head"><h3>Live activity</h3>' + (S.book.room ? '<span class="chip chip-live">● live</span>' : '') + '</div>' + activityList(6) + '</div>';
    const goals = K.list(S.book, 'goals').slice(0, 3);
    const goalsCard = goals.length
      ? '<div class="card"><div class="card-head"><h3>Goals</h3><button class="link" data-act="go" data-view="goals">All goals</button></div>' +
        goals
          .map((g) => {
            const gp = K.goalPlan(g);
            return '<div class="goal-mini">' + ui.ring(gp.pct, { size: 46, thickness: 6, color: 'var(--good)' }) + '<div><b>' + esc((g.emoji || '🎯') + ' ' + g.name) + '</b><small class="muted">' + esc(fmt(g.saved, true)) + ' of ' + esc(fmt(g.target, true)) + (gp.perMonth ? ' · ' + esc(fmt(gp.perMonth, true)) + ' / mo' : '') + '</small></div></div>';
          })
          .join('') +
        '</div>'
      : '';
    return (
      checklistCard() +
      '<div class="grid-hero">' + hero + tipCard + '</div>' +
      kpis +
      '<div class="grid-2">' + paceCard + donutCard + '</div>' +
      '<div class="grid-3">' + envCard + alertCard + memberCard + '</div>' +
      '<div class="grid-2">' + feedCard + (goalsCard || '<div class="card"><div class="card-head"><h3>Goals</h3></div>' + emptyState('🎯', 'No goals yet', 'A goal turns saving into something you can see.', '<button class="btn btn-soft" data-act="go" data-view="goals">Add a goal</button>') + '</div>') + '</div>'
    );
  }

  // ================================================================ view: sheet
  function sheetRows() {
    const f = S.sheet;
    const q = f.q.trim().toLowerCase();
    const cats = S.book.categories;
    let rows = K.list(S.book, 'txns').filter((t) => typeof t.date === 'string' && t.date.slice(0, 7) === S.month);
    if (q) rows = rows.filter((t) => (String(t.desc || '') + ' ' + ((cats[t.cat] && cats[t.cat].name) || '')).toLowerCase().indexOf(q) >= 0);
    if (f.cat) rows = rows.filter((t) => (f.cat === '_none' ? !cats[t.cat] : t.cat === f.cat));
    if (f.type) rows = rows.filter((t) => (t.type || 'expense') === f.type);
    if (f.who) rows = rows.filter((t) => (t.who || t._by) === f.who);
    const key = f.sort;
    rows.sort((a, b) => {
      let x;
      let y;
      if (key === 'amount') {
        x = Number(a.amount) || 0;
        y = Number(b.amount) || 0;
      } else if (key === 'cat') {
        x = (cats[a.cat] && cats[a.cat].name) || '';
        y = (cats[b.cat] && cats[b.cat].name) || '';
      } else if (key === 'who') {
        x = memberName(a.who || a._by);
        y = memberName(b.who || b._by);
      } else if (key === 'desc') {
        x = String(a.desc || '').toLowerCase();
        y = String(b.desc || '').toLowerCase();
      } else {
        x = a.date + (a.createdAt || 0);
        y = b.date + (b.createdAt || 0);
      }
      return (x < y ? -1 : x > y ? 1 : 0) * f.dir;
    });
    return rows;
  }

  function viewSheet() {
    const rows = sheetRows();
    const f = S.sheet;
    const th = (key, label, cls) =>
      '<th class="' + (cls || '') + (key ? ' sortable' : '') + '"' + (key ? ' data-act="sort" data-sort="' + key + '"' : '') + '>' + label + (f.sort === key ? '<span class="sort">' + (f.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
    let income = 0;
    let expense = 0;
    rows.forEach((t) => {
      if (t.type === 'income') income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    });
    const defaultDate = K.monthKey(K.today()) === S.month ? K.today() : S.month + '-01';
    const body = rows
      .map((t) => {
        const c = S.book.categories[t.cat];
        const by = t._by;
        return (
          '<tr data-row="' + esc(t.id) + '" class="' + (t.type === 'income' ? 'is-income' : '') + '">' +
          '<td><input type="date" data-k="txns:' + esc(t.id) + ':date" value="' + esc(t.date) + '" aria-label="Date"></td>' +
          '<td><input data-k="txns:' + esc(t.id) + ':desc" value="' + esc(t.desc || '') + '" maxlength="80" placeholder="Description" aria-label="Description"></td>' +
          '<td class="cat-cell"><i class="cat-dot" style="background:' + (c ? ui.catColor(c) : 'transparent') + '"></i><select data-k="txns:' + esc(t.id) + ':cat" aria-label="Category">' + catOptions(t.cat) + '</select></td>' +
          '<td><select data-k="txns:' + esc(t.id) + ':who" aria-label="Who">' + memberOptions(t.who || by) + '</select></td>' +
          '<td><select data-k="txns:' + esc(t.id) + ':type" class="type-sel" aria-label="Type"><option value="expense"' + (t.type !== 'income' ? ' selected' : '') + '>Expense</option><option value="income"' + (t.type === 'income' ? ' selected' : '') + '>Income</option></select></td>' +
          '<td class="num"><input data-k="txns:' + esc(t.id) + ':amount" inputmode="decimal" value="' + esc(K.fmtPlain(t.amount, cur())) + '" aria-label="Amount"></td>' +
          '<td class="by-cell" title="Last edited by ' + esc(memberName(by)) + '">' + ui.avatar({ name: memberName(by), color: memberColor(by) }, 22) + '<small>' + esc(ui.timeAgo(t._u)) + '</small></td>' +
          '<td><button class="icon-btn icon-sm" data-act="del-txn" data-id="' + esc(t.id) + '" aria-label="Delete row">' + icon('trash', 16) + '</button></td>' +
          '</tr>'
        );
      })
      .join('');
    const newRow =
      '<tr class="new-row">' +
      '<td><input type="date" data-nk="date" value="' + esc(defaultDate) + '" aria-label="New date"></td>' +
      '<td><input data-nk="desc" maxlength="80" placeholder="＋ Type to add a row…" aria-label="New description"></td>' +
      '<td class="cat-cell"><i class="cat-dot"></i><select data-nk="cat" aria-label="New category">' + catOptions('') + '</select></td>' +
      '<td><select data-nk="who" aria-label="New who">' + memberOptions(me()) + '</select></td>' +
      '<td><select data-nk="type" class="type-sel" aria-label="New type"><option value="expense">Expense</option><option value="income">Income</option></select></td>' +
      '<td class="num"><input data-nk="amount" inputmode="decimal" placeholder="0" aria-label="New amount"></td>' +
      '<td colspan="2"><button class="btn btn-primary btn-sm" data-act="add-row">Add ↵</button></td></tr>';
    const cats = catList();
    return (
      '<div class="card sheet-card">' +
      '<div class="sheet-tools">' +
      '<label class="search">' + icon('search', 18) + '<input data-filter="q" value="' + esc(f.q) + '" placeholder="Search this month…" aria-label="Search"></label>' +
      '<select data-filter="cat" aria-label="Filter category"><option value="">All categories</option><option value="_none"' + (f.cat === '_none' ? ' selected' : '') + '>Uncategorized</option>' +
      cats.map((c) => '<option value="' + esc(c.id) + '"' + (f.cat === c.id ? ' selected' : '') + '>' + esc((c.emoji || '') + ' ' + c.name) + '</option>').join('') + '</select>' +
      '<select data-filter="type" aria-label="Filter type"><option value="">All types</option><option value="expense"' + (f.type === 'expense' ? ' selected' : '') + '>Expenses</option><option value="income"' + (f.type === 'income' ? ' selected' : '') + '>Income</option></select>' +
      '<select data-filter="who" aria-label="Filter person"><option value="">Everyone</option>' + memberOptions(f.who).replace(' selected', f.who ? ' selected' : '') + '</select>' +
      '<span class="grow"></span>' +
      '<button class="btn btn-ghost btn-sm" data-act="import-csv">' + icon('upload', 16) + ' Import CSV</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="export-csv">' + icon('download', 16) + ' Export</button>' +
      '</div>' +
      '<div class="sheet-scroll"><table class="grid-table">' +
      '<thead><tr>' + th('date', 'Date') + th('desc', 'Description') + th('cat', 'Category') + th('who', 'Who') + th('', 'Type') + th('amount', 'Amount', 'num') + th('', 'Edited') + th('', '') + '</tr></thead>' +
      '<tbody>' + body + newRow + '</tbody>' +
      '<tfoot><tr><td colspan="3"><b>' + rows.length + '</b> rows' + (f.q || f.cat || f.type || f.who ? ' (filtered)' : '') + '</td><td colspan="2" class="muted">Income <b class="pos">' + esc(fmt(income)) + '</b></td><td class="num"><b>' + esc(fmt(expense)) + '</b></td><td colspan="2" class="muted">Net <b class="' + (income - expense >= 0 ? 'pos' : 'neg') + '">' + esc(fmt(income - expense)) + '</b></td></tr></tfoot>' +
      '</table></div>' +
      '<p class="muted small sheet-hint">Tip: edit any cell like a spreadsheet. <kbd>Enter</kbd> moves down, <kbd>Tab</kbd> moves right. Amounts understand <code>25k</code>, <code>1.5jt</code>, <code>25.000</code>. ' + (S.book.room ? 'Edits sync live to everyone in this budget.' : '') + '</p>' +
      '</div>'
    );
  }

  function addRowFromInputs() {
    const get = (k) => $('[data-nk="' + k + '"]');
    const amountEl = get('amount');
    const descEl = get('desc');
    if (!amountEl) return;
    const amount = K.parseAmount(amountEl.value, cur());
    if (!(amount > 0)) {
      amountEl.classList.add('shake');
      amountEl.focus();
      setTimeout(() => amountEl.classList.remove('shake'), 500);
      return;
    }
    const txn = {
      date: get('date').value || K.today(),
      desc: descEl.value.trim().slice(0, 80),
      cat: get('cat').value,
      who: get('who').value || me(),
      type: get('type').value,
      amount: amount,
      createdAt: Date.now(),
    };
    amountEl.value = '';
    descEl.value = '';
    commit(put('txns', txn));
    setTimeout(() => {
      const d = $('[data-nk="desc"]');
      if (d) d.focus();
    }, 30);
  }

  // ================================================================ view: budget
  function currentPlan() {
    const income = K.monthlyIncome(S.book) || (S.profile.facts && S.profile.facts.income) || 0;
    const persona = S.profile.persona || 'owl';
    const facts = Object.assign({ ef: 1, debt: 0, goals: [], household: 'solo', housing: 0 }, S.profile.facts || {}, { income: income });
    return K.suggestPlan({ persona: persona, facts: facts, currency: cur() }, cur());
  }

  function viewBudget(st) {
    const incomes = K.list(S.book, 'incomes');
    const plan = currentPlan();
    const groupTotals = {};
    Object.keys(K.GROUPS).forEach((g) => (groupTotals[g] = 0));
    st.rows.forEach((r) => (groupTotals[r.cat.group] = (groupTotals[r.cat.group] || 0) + r.limit));
    const balanced = st.income > 0 && Math.abs(st.unassigned) < Math.max(1, st.income * 0.005);
    const banner =
      '<div class="card assign-banner ' + (balanced ? 'is-good' : st.unassigned < 0 ? 'is-bad' : 'is-warn') + '">' +
      '<div><p class="eyebrow">Left to assign</p><h2>' + esc(fmt(st.unassigned)) + '</h2>' +
      '<p class="muted">' + (balanced ? 'Every unit of income has a job. Zero-based budget achieved ✨' : st.unassigned < 0 ? 'Your limits add up to more than your income. Trim a few envelopes.' : 'Give this money a job: savings, a goal, or an envelope.') + '</p></div>' +
      '<div class="assign-stats"><div><small>Income / month</small><b>' + esc(fmt(st.income)) + '</b></div><div><small>Budgeted</small><b>' + esc(fmt(st.budgeted)) + '</b></div></div>' +
      '</div>';
    const incomeCard =
      '<div class="card"><div class="card-head"><h3>💼 Income</h3><button class="btn btn-ghost btn-sm" data-act="add-income">' + icon('plus', 16) + ' Add</button></div>' +
      (incomes.length
        ? incomes
            .map(
              (inc) =>
                '<div class="inc-row" data-row="' + esc(inc.id) + '">' +
                '<input data-k="incomes:' + esc(inc.id) + ':name" value="' + esc(inc.name || '') + '" maxlength="40" aria-label="Income name">' +
                '<input class="num" data-k="incomes:' + esc(inc.id) + ':amount" inputmode="decimal" value="' + esc(K.fmtPlain(inc.amount, cur())) + '" aria-label="Amount">' +
                '<select data-k="incomes:' + esc(inc.id) + ':freq" aria-label="Frequency">' + Object.keys(K.FREQ).map((f) => '<option value="' + f + '"' + (inc.freq === f ? ' selected' : '') + '>' + K.FREQ[f].label + '</option>').join('') + '</select>' +
                '<button class="icon-btn icon-sm" data-act="del" data-c="incomes" data-id="' + esc(inc.id) + '" aria-label="Remove income">' + icon('trash', 16) + '</button></div>'
            )
            .join('')
        : '<p class="muted">Add your take-home pay to unlock Mint\'s plan.</p>') +
      '<div class="inc-total"><span>Monthly total</span><b>' + esc(fmt(st.plannedIncome)) + '</b></div></div>';
    const persona = K.PERSONAS[S.profile.persona];
    const planCard =
      '<div class="card plan-card"><div class="card-head"><h3>' + icon('sparkle', 18) + ' Mint\'s plan' + (persona ? ' for ' + esc(persona.name) : '') + '</h3></div>' +
      '<div class="alloc">' +
      Object.keys(K.GROUPS)
        .map((g) => {
          const actualPct = st.income > 0 ? (groupTotals[g] / st.income) * 100 : 0;
          return (
            '<div class="alloc-row"><div class="alloc-label"><i style="background:' + K.GROUPS[g].color + '"></i>' + esc(K.GROUPS[g].label) + '</div>' +
            '<div class="alloc-bars"><div class="alloc-bar"><span style="width:' + Math.min(100, actualPct).toFixed(1) + '%;background:' + K.GROUPS[g].color + '"></span></div>' +
            '<div class="alloc-bar ghost"><span style="width:' + plan.pct[g] + '%"></span></div></div>' +
            '<div class="alloc-num"><b>' + Math.round(actualPct) + '%</b><small>plan ' + plan.pct[g] + '%</small></div></div>'
          );
        })
        .join('') +
      '</div>' +
      (plan.notes.length ? '<ul class="plan-notes">' + plan.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      '<div class="row-gap"><button class="btn btn-primary" data-act="apply-plan"' + (plan.income > 0 ? '' : ' disabled') + '>Apply plan to envelopes</button>' +
      (!persona ? '<button class="btn btn-ghost" data-act="quiz">Personalise with the quiz</button>' : '') + '</div></div>';
    const groups = Object.keys(K.GROUPS)
      .map((g) => {
        const rows = st.rows.filter((r) => r.cat.group === g);
        const spent = rows.reduce((s, r) => s + r.spent, 0);
        return (
          '<div class="card env-group" style="--g:' + K.GROUPS[g].color + '">' +
          '<div class="card-head"><div><h3>' + esc(K.GROUPS[g].label) + '</h3><p class="muted small">' + esc(K.GROUPS[g].hint) + '</p></div>' +
          '<div class="env-group-sum"><b>' + esc(fmt(groupTotals[g])) + '</b><small>' + (st.income > 0 ? Math.round((groupTotals[g] / st.income) * 100) + '% of income · ' : '') + esc(fmt(spent, true)) + ' used</small></div></div>' +
          rows
            .map((r) => {
              const c = r.cat;
              return (
                '<div class="env-row" data-row="' + esc(c.id) + '">' +
                '<input class="env-emoji" data-k="categories:' + esc(c.id) + ':emoji" value="' + esc(c.emoji || '') + '" maxlength="4" aria-label="Emoji">' +
                '<div class="env-main"><div class="env-line">' +
                '<input class="env-name" data-k="categories:' + esc(c.id) + ':name" value="' + esc(c.name) + '" maxlength="40" aria-label="Category name">' +
                (r.isSaving ? '' : '<select class="env-kind" data-k="categories:' + esc(c.id) + ':kind" aria-label="Kind"><option value="flex"' + (c.kind !== 'fixed' ? ' selected' : '') + '>Flexible</option><option value="fixed"' + (c.kind === 'fixed' ? ' selected' : '') + '>Fixed bill</option></select>') +
                '<input class="env-limit num" data-k="categories:' + esc(c.id) + ':limit" inputmode="decimal" value="' + esc(K.fmtPlain(c.limit, cur())) + '" aria-label="Monthly limit">' +
                '</div>' + ui.bar(r.pct, r.status, ui.catColor(c)) +
                '<div class="env-meta"><span>' + esc(fmt(r.spent)) + (r.isSaving ? ' moved' : ' spent') + '</span><span class="' + (r.status !== 'ok' ? 'st-' + r.status : '') + '">' +
                (r.isSaving ? pctText(r.pct) + ' of target' : r.left >= 0 ? esc(fmt(r.left)) + ' left' : esc(fmt(-r.left)) + ' over') + (r.status === 'pace' ? ' · on pace for ' + esc(fmt(r.projected, true)) : '') + '</span></div></div>' +
                '<button class="icon-btn icon-sm" data-act="del" data-c="categories" data-id="' + esc(c.id) + '" aria-label="Delete category">' + icon('trash', 16) + '</button></div>'
              );
            })
            .join('') +
          '<button class="btn btn-ghost btn-sm add-env" data-act="add-cat" data-group="' + g + '">' + icon('plus', 16) + ' Add ' + esc(K.GROUPS[g].label.toLowerCase()) + ' envelope</button></div>'
        );
      })
      .join('');
    return banner + '<div class="grid-2">' + incomeCard + planCard + '</div><div class="grid-2 env-grid">' + groups + '</div>';
  }

  // ================================================================ view: goals
  function viewGoals() {
    const goals = K.list(S.book, 'goals');
    const cards = goals
      .map((g) => {
        const gp = K.goalPlan(g);
        return (
          '<div class="card goal-card' + (gp.done ? ' is-done' : '') + '" data-row="' + esc(g.id) + '">' +
          '<div class="goal-top"><div class="goal-ring">' + ui.ring(gp.pct, { size: 76, thickness: 8, color: gp.done ? 'var(--good)' : 'var(--accent)' }) + '<span>' + esc(g.emoji || '🎯') + '</span></div>' +
          '<div class="grow"><input class="goal-name" data-k="goals:' + esc(g.id) + ':name" value="' + esc(g.name) + '" title="' + esc(g.name) + '" maxlength="40" aria-label="Goal name">' +
          '<p class="goal-pct">' + Math.round(gp.pct * 100) + '% · ' + esc(fmt(g.saved)) + ' of ' + esc(fmt(g.target)) + '</p>' +
          '<p class="muted small">' + (gp.done ? '🎉 Goal reached!' : gp.perMonth ? 'Save ' + esc(fmt(gp.perMonth)) + ' / month for ' + gp.months + ' months' : 'Set a date to get a monthly target') + '</p></div>' +
          '<button class="icon-btn icon-sm" data-act="del" data-c="goals" data-id="' + esc(g.id) + '" aria-label="Delete goal">' + icon('trash', 16) + '</button></div>' +
          '<div class="goal-fields"><label>Emoji<input data-k="goals:' + esc(g.id) + ':emoji" value="' + esc(g.emoji || '') + '" maxlength="4"></label>' +
          '<label>Target<input data-k="goals:' + esc(g.id) + ':target" inputmode="decimal" value="' + esc(K.fmtPlain(g.target, cur())) + '"></label>' +
          '<label>Saved<input data-k="goals:' + esc(g.id) + ':saved" inputmode="decimal" value="' + esc(K.fmtPlain(g.saved, cur())) + '"></label>' +
          '<label class="span-all">Target date<input type="month" data-k="goals:' + esc(g.id) + ':due" value="' + esc(String(g.due || '').slice(0, 7)) + '"></label></div>' +
          '<div class="goal-add"><input data-goal-add="' + esc(g.id) + '" inputmode="decimal" placeholder="Amount to add" aria-label="Amount to add"><button class="btn btn-soft btn-sm" data-act="goal-add" data-id="' + esc(g.id) + '">＋ Add money</button></div>' +
          '</div>'
        );
      })
      .join('');
    const newCard =
      '<div class="card goal-card goal-new"><h3>New goal</h3>' +
      '<div class="goal-fields"><label class="span-all">Name<input data-ng="name" placeholder="e.g. Bali trip" maxlength="40"></label><label>Emoji<input data-ng="emoji" value="🎯" maxlength="4"></label>' +
      '<label>Target<input data-ng="target" inputmode="decimal" placeholder="' + (cur() === 'IDR' ? '15jt' : '5,000') + '"></label><label>Saved<input data-ng="saved" inputmode="decimal" placeholder="0"></label>' +
      '<label class="span-all">Target date<input type="month" data-ng="due"></label></div>' +
      '<button class="btn btn-primary" data-act="add-goal">' + icon('plus', 18) + ' Create goal</button></div>';
    return '<div class="goal-grid">' + cards + newCard + '</div>';
  }

  // ================================================================ view: invest
  function viewInvest(st) {
    const pf = K.portfolio(S.book);
    const target = S.book.meta.target || K.targetFor(S.profile.traits ? S.profile.traits.risk : 50);
    const suggested = K.targetFor(S.profile.traits ? S.profile.traits.risk : NaN);
    const investCat = st.rows.find((r) => r.cat.group === 'invest');
    if (!S.proj) S.proj = { monthly: investCat ? investCat.limit : Math.round((st.income || 0) * 0.1), rate: 7, years: 15 };
    const kpi = (label, value, sub, tone) => '<div class="card kpi' + (tone ? ' kpi-' + tone : '') + '"><p class="kpi-label">' + esc(label) + '</p><p class="kpi-value">' + esc(value) + '</p><p class="kpi-sub">' + sub + '</p></div>';
    const kpis =
      '<div class="kpis">' +
      kpi('Portfolio value', fmt(pf.total), pf.rows.length + ' holdings') +
      kpi('Total gain / loss', (pf.pl >= 0 ? '+' : '') + fmt(pf.pl), '<b class="' + (pf.pl >= 0 ? 'pos' : 'neg') + '">' + (pf.plPct * 100).toFixed(1) + '%</b> on ' + esc(fmt(pf.basis, true)) + ' invested', pf.pl >= 0 ? 'good' : 'bad') +
      kpi('Target mix', target.label || 'Custom', 'Mint suggests <b>' + esc(suggested.label) + '</b>' + (S.profile.traits ? ' (risk ' + S.profile.traits.risk + '/100)' : '')) +
      kpi('Largest drift', pf.maxDrift.toFixed(1) + '%', pf.maxDrift > 5 ? 'Time to rebalance' : 'Within ±5%, no action', pf.maxDrift > 5 ? 'warn' : 'good') +
      '</div>';
    const classOpts = (sel) => Object.keys(K.ASSET_CLASSES).map((k) => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + esc(K.ASSET_CLASSES[k].label) + '</option>').join('');
    const holdings =
      '<div class="card"><div class="card-head"><h3>Holdings</h3><span class="muted small">Prices are entered by you; update them any time.</span></div>' +
      '<div class="sheet-scroll"><table class="grid-table holdings">' +
      '<thead><tr><th>Symbol</th><th>Name</th><th>Class</th><th class="num">Qty</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain</th><th></th></tr></thead><tbody>' +
      pf.rows
        .map(
          (h) =>
            '<tr data-row="' + esc(h.id) + '">' +
            '<td><input data-k="holdings:' + esc(h.id) + ':symbol" value="' + esc(h.symbol || '') + '" maxlength="12" class="sym" aria-label="Symbol"></td>' +
            '<td><input data-k="holdings:' + esc(h.id) + ':name" value="' + esc(h.name || '') + '" maxlength="60" aria-label="Name"></td>' +
            '<td><select data-k="holdings:' + esc(h.id) + ':cls" aria-label="Asset class">' + classOpts(h.cls) + '</select></td>' +
            '<td class="num"><input data-k="holdings:' + esc(h.id) + ':qty" inputmode="decimal" value="' + esc(h.qty) + '" aria-label="Quantity"></td>' +
            '<td class="num"><input data-k="holdings:' + esc(h.id) + ':cost" inputmode="decimal" value="' + esc(K.fmtPlain(h.cost, cur())) + '" aria-label="Average cost"></td>' +
            '<td class="num"><input data-k="holdings:' + esc(h.id) + ':price" inputmode="decimal" value="' + esc(K.fmtPlain(h.price, cur())) + '" aria-label="Price"></td>' +
            '<td class="num"><b>' + esc(fmt(h.value)) + '</b></td>' +
            '<td class="num ' + (h.pl >= 0 ? 'pos' : 'neg') + '">' + (h.pl >= 0 ? '+' : '') + esc(fmt(h.pl, true)) + '<small> ' + (h.plPct * 100).toFixed(1) + '%</small></td>' +
            '<td><button class="icon-btn icon-sm" data-act="del" data-c="holdings" data-id="' + esc(h.id) + '" aria-label="Remove holding">' + icon('trash', 16) + '</button></td></tr>'
        )
        .join('') +
      '<tr class="new-row"><td><input data-nh="symbol" placeholder="＋ Symbol" maxlength="12" class="sym"></td><td><input data-nh="name" placeholder="Name" maxlength="60"></td><td><select data-nh="cls">' + classOpts('stocks') + '</select></td>' +
      '<td class="num"><input data-nh="qty" inputmode="decimal" placeholder="0"></td><td class="num"><input data-nh="cost" inputmode="decimal" placeholder="0"></td><td class="num"><input data-nh="price" inputmode="decimal" placeholder="same as cost"></td>' +
      '<td colspan="3"><button class="btn btn-primary btn-sm" data-act="add-holding">Add ↵</button></td></tr>' +
      '</tbody></table></div></div>';
    const segs = Object.keys(pf.byClass).map((k) => ({ value: pf.byClass[k], color: (K.ASSET_CLASSES[k] || K.ASSET_CLASSES.other).color, label: (K.ASSET_CLASSES[k] || K.ASSET_CLASSES.other).label }));
    const alloc =
      '<div class="card"><div class="card-head"><h3>Allocation vs target</h3></div>' +
      '<div class="presets">' + ['Conservative', 'Balanced', 'Growth', 'Aggressive'].map((l, i) => '<button class="chip-btn' + (target.label === l ? ' is-on' : '') + '" data-act="preset" data-risk="' + [10, 40, 60, 90][i] + '">' + l + '</button>').join('') + '</div>' +
      '<div class="alloc-wrap">' + ui.donut(segs, { size: 170, thickness: 22, center: fmt(pf.total, true), sub: 'total', label: 'Asset allocation' }) +
      '<table class="drift"><thead><tr><th>Class</th><th class="num">Target</th><th class="num">Now</th><th>Drift</th><th class="num">To rebalance</th></tr></thead><tbody>' +
      pf.drift
        .map((d) => {
          const meta = K.ASSET_CLASSES[d.cls] || K.ASSET_CLASSES.other;
          const w = Math.min(50, Math.abs(d.diff) * 2);
          return (
            '<tr><td><i class="cat-dot" style="background:' + meta.color + '"></i>' + esc(meta.label) + '</td>' +
            '<td class="num"><input class="pct-in" data-target="' + esc(d.cls) + '" inputmode="decimal" value="' + d.targetPct + '" aria-label="Target percent">%</td>' +
            '<td class="num">' + d.actualPct.toFixed(1) + '%</td>' +
            '<td><div class="drift-bar"><span class="' + (d.diff > 0 ? 'over' : 'under') + (Math.abs(d.diff) > 5 ? ' big' : '') + '" style="width:' + w + '%"></span></div></td>' +
            '<td class="num ' + (Math.abs(d.diff) > 5 ? (d.trade > 0 ? 'pos' : 'neg') : 'muted') + '">' + (Math.abs(d.trade) < 1 ? '—' : (d.trade > 0 ? 'Buy ' : 'Sell ') + esc(fmt(Math.abs(d.trade), true))) + '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>' +
      '<p class="muted small">Targets are educational starting points from your quiz risk score, not financial advice.</p></div>';
    const proj =
      '<div class="card" id="projCard"><div class="card-head"><h3>Growth projection</h3><span class="muted small">Monthly compounding</span></div>' +
      '<div class="proj-controls">' +
      '<label>Monthly contribution <b data-proj-label="monthly">' + esc(fmt(S.proj.monthly)) + '</b><input type="range" data-proj="monthly" min="0" max="' + Math.max(100, Math.round(Math.max(st.income, S.proj.monthly * 2) * 0.5)) + '" step="' + (cur() === 'IDR' ? 50000 : 10) + '" value="' + S.proj.monthly + '"></label>' +
      '<label>Expected return / year <b data-proj-label="rate">' + S.proj.rate + '%</b><input type="range" data-proj="rate" min="0" max="15" step="0.5" value="' + S.proj.rate + '"></label>' +
      '<label>Years <b data-proj-label="years">' + S.proj.years + '</b><input type="range" data-proj="years" min="1" max="40" step="1" value="' + S.proj.years + '"></label>' +
      '</div><div id="projOut">' + projOut(pf.total) + '</div></div>';
    return kpis + holdings + '<div class="grid-2">' + alloc + proj + '</div>';
  }

  function projOut(start) {
    const series = K.projectFV(start, S.proj.monthly, S.proj.rate, S.proj.years);
    const last = series[series.length - 1];
    const labels = [{ i: 0, t: 'Now' }, { i: Math.round(S.proj.years / 2), t: Math.round(S.proj.years / 2) + 'y' }, { i: S.proj.years, t: S.proj.years + 'y' }];
    return (
      ui.lineChart(
        [
          { values: series.map((p) => p.value), color: 'var(--accent)', fill: true },
          { values: series.map((p) => p.contributed), color: '#9aa0b5', dash: true, width: 2 },
        ],
        { xLabels: labels, label: 'Projected portfolio value' }
      ) +
      '<div class="proj-sum"><div><small>In ' + S.proj.years + ' years</small><b>' + esc(fmt(last.value)) + '</b></div><div><small>You put in</small><b>' + esc(fmt(last.contributed)) + '</b></div><div><small>Growth</small><b class="pos">+' + esc(fmt(last.value - last.contributed)) + '</b></div></div>'
    );
  }

  // ================================================================ view: you
  function viewYou(st) {
    if (!S.profile.persona) {
      return '<div class="card">' + emptyState('🌿', 'Discover your money personality', 'Answer 14 quick questions. Mint assigns your money animal, builds a plan around your income and sends tips that fit how you actually behave.', '<button class="btn btn-primary btn-lg" data-act="quiz">Take the quiz</button>') + '</div>' + profileCard();
    }
    const result = { persona: S.profile.persona, traits: S.profile.traits, ranking: S.profile.ranking, facts: Object.assign({}, S.profile.facts, { income: K.monthlyIncome(S.book) || S.profile.facts.income }) };
    const tips = currentTips(st);
    return (
      '<div class="grid-you"><div>' + K.quizUI.personaCard(result, cur()) +
      '<div class="row-gap center mt"><button class="btn btn-primary" data-act="share-result">' + icon('share', 16) + ' Share your result</button><button class="btn btn-soft" data-act="quiz">Retake the quiz</button><button class="btn btn-ghost" data-act="tip-now">Give me a tip</button></div></div>' +
      '<div><div class="card"><div class="card-head"><h3>Tips for you right now</h3></div><ul class="tips">' +
      tips.slice(0, 8).map((t) => '<li class="tip-' + t.kind + '"><span>' + esc(t.icon) + '</span><div><b>' + esc(t.title) + '</b><p>' + esc(t.body) + '</p></div></li>').join('') +
      '</ul></div>' + profileCard() + '</div></div>'
    );
  }

  function profileCard() {
    return (
      '<div class="card"><div class="card-head"><h3>Your profile</h3></div>' +
      '<div class="form-grid"><label>Display name<input data-profile="name" value="' + esc(S.profile.name) + '" maxlength="40"></label>' +
      '<label>Colour<div class="swatches">' + ui.MEMBER_COLORS.map((c) => '<button class="swatch' + (S.profile.color === c ? ' is-on' : '') + '" data-act="color" data-color="' + c + '" style="background:' + c + '" aria-label="Colour ' + c + '"></button>').join('') + '</div></label></div>' +
      '<p class="muted small">Your name and colour show next to your edits for everyone in shared budgets.</p></div>'
    );
  }

  // ================================================================ view: share
  function viewShare() {
    const b = S.book;
    const members = K.list(b, 'members');
    if (!b.room) {
      return (
        '<div class="grid-2"><div class="card share-hero">' +
        '<div class="share-art"><span class="bub b1">' + ui.avatar({ name: S.profile.name, color: S.profile.color }, 54) + '</span><span class="bub b2">' + ui.avatar({ name: 'Partner', color: '#e84393' }, 46) + '</span><span class="bub b3">' + ui.avatar({ name: 'House mate', color: '#00b8a9' }, 40) + '</span><span class="lock">' + icon('lock', 26) + '</span></div>' +
        '<h2>Budget together, live.</h2>' +
        '<ul class="checks"><li>' + icon('check', 18) + 'Everyone edits the same sheet in real time, like Google Sheets</li>' +
        '<li>' + icon('check', 18) + 'End-to-end encrypted: the relay only ever sees gibberish</li>' +
        '<li>' + icon('check', 18) + 'No accounts. Works offline and syncs when you are back</li>' +
        '<li>' + icon('check', 18) + 'Warnings reach everyone when a shared limit is close</li></ul>' +
        '<button class="btn btn-primary btn-lg" data-act="start-share">' + icon('share', 18) + ' Create share link</button></div>' +
        '<div class="card"><div class="card-head"><h3>Advanced</h3></div>' +
        '<label class="field">Relay server<input data-relay value="' + esc(K.DEFAULT_RELAY) + '" spellcheck="false"></label>' +
        '<p class="muted small">Default: the free public <b>ntfy.sh</b> relay, which keeps messages for 12 hours. For always-on sync, run the tiny Mint relay (<code>apps/mint/budget/server/relay.py</code>) on any server and paste its URL here. Either way, data is encrypted in your browser before it leaves.</p></div></div>'
      );
    }
    const link = K.shareLink(location.href.split('?')[0], b.id, b.room.key, b.room.relay, b.meta.name);
    const statusText = { live: 'Connected. Changes sync instantly.', syncing: 'Catching up on recent changes…', connecting: 'Connecting to the relay…', reconnecting: 'Reconnecting…', offline: 'Offline. Your edits are saved here and will sync when the connection returns.', error: S.statusDetail || 'Sync error' }[S.status] || '';
    return (
      '<div class="grid-2"><div class="card">' +
      '<div class="card-head"><h3>' + icon('users', 20) + ' Shared budget</h3>' + syncPill() + '</div>' +
      '<p class="muted">' + esc(statusText) + '</p>' +
      '<label class="field">Invite link<div class="link-box"><input readonly value="' + esc(link) + '" id="shareLink" aria-label="Invite link"><button class="btn btn-primary" data-act="copy-link">' + icon('copy', 16) + ' Copy</button>' +
      (canShare() ? '<button class="btn btn-soft" data-act="native-share">' + icon('share', 16) + '</button>' : '') + '</div></label>' +
      '<p class="warn-note">' + icon('lock', 14) + ' Anyone with this link can view and edit this budget. Share it only with people you trust.</p>' +
      '<h4>People</h4><ul class="people">' +
      members
        .map((m) => {
          const p = S.room && S.room.peers[m.id];
          return '<li>' + '<span class="av-wrap' + (memberOnline(m.id) ? ' online' : '') + '">' + ui.avatar(m, 36) + '</span><div><b>' + esc(m.name) + (m.id === me() ? ' (you)' : '') + '</b><small class="muted">' + (m.id === me() ? 'This device' : memberOnline(m.id) ? 'Online now' : p && p.lastSeen ? 'Active ' + ui.timeAgo(p.lastSeen) : 'Member') + '</small></div></li>';
        })
        .join('') +
      '</ul>' +
      '<p class="muted small">Relay: <code>' + esc(b.room.relay) + '</code></p>' +
      '<button class="btn btn-ghost btn-sm" data-act="stop-share">Stop syncing on this device</button></div>' +
      '<div class="card"><div class="card-head"><h3>Live activity</h3></div>' + activityList(20) + '</div></div>'
    );
  }

  // ================================================================ view: settings
  function appearanceCard() {
    const mode = themeMode();
    const preview = (id) =>
      '<span class="tt-preview tt-' + id + '" aria-hidden="true"><i class="tt-bar"></i><i class="tt-card"><b></b><b></b></i><i class="tt-dot"></i></span>';
    const tile = (id, label, iconName) =>
      '<button class="theme-tile' + (mode === id ? ' is-on' : '') + '" role="radio" aria-checked="' + (mode === id) + '" data-act="set-theme" data-theme="' + id + '">' +
      (id === 'system' ? '<span class="tt-split">' + preview('light') + preview('dark') + '</span>' : preview(id)) +
      '<span class="tt-check" aria-hidden="true">' + icon('check', 12) + '</span>' +
      '<span class="tt-label">' + icon(iconName, 16) + '<span>' + label + '</span></span></button>';
    return (
      '<div class="card appearance-card"><div class="card-head"><h3>Appearance</h3></div>' +
      '<div class="theme-tiles" role="radiogroup" aria-label="Theme">' + tile('light', 'Light', 'sun') + tile('dark', 'Dark', 'moon') + tile('system', 'System', 'monitor') + '</div>' +
      '<p class="muted small">Choose how Mint looks. System follows your device.</p></div>'
    );
  }

  function updatesCard() {
    const info = U.available;
    let status = '';
    if (info) {
      status = '<p class="update-status is-ready">' + icon('sparkle', 16) + '<span>Mint ' + esc(info.version) + ' is ready</span><button class="link-btn" data-act="whats-new">What\'s new</button></p>';
    } else if (U.checking) {
      status = '<p class="update-status">Checking for updates…</p>';
    } else if (U.result === 'current') {
      status = '<p class="update-status">' + icon('check', 16) + '<span>You have the latest version</span></p>';
    } else if (U.result === 'failed') {
      status = '<p class="update-status">Could not check right now</p>';
    }
    return (
      '<div class="card updates-card"><div class="card-head"><h3>Updates</h3></div>' +
      '<div class="update-row"><span>Version <b translate="no">' + esc(K.VERSION) + '</b></span>' +
      (info
        ? '<button class="btn btn-primary btn-sm" data-act="update-now">' + icon('download', 16) + '<span>Update now</span></button>'
        : '<button class="btn btn-soft btn-sm" data-act="check-update"' + (U.checking ? ' disabled' : '') + '>' + icon('refresh', 16) + '<span>Check for updates</span></button>') +
      '</div>' +
      status +
      '<label class="toggle"><input type="checkbox" data-act-change="toggle-autoupdate"' + (autoUpdates() ? ' checked' : '') + '><span></span>Install updates automatically</label>' +
      '<p class="muted small">Mint checks for new versions in the background and updates in place. Your budgets stay on this device.</p></div>'
    );
  }

  function viewSettings() {
    const b = S.book;
    const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
    return (
      '<div class="grid-2">' +
      appearanceCard() +
      '<div class="card"><div class="card-head"><h3>This budget</h3></div><div class="form-grid">' +
      '<label>Name<input data-k="meta::name" value="' + esc(b.meta.name) + '" maxlength="40"></label>' +
      '<label>Currency<select data-k="meta::currency">' + Object.keys(K.CURRENCIES).map((c) => '<option value="' + c + '"' + (b.meta.currency === c ? ' selected' : '') + '>' + c + ' · ' + esc(K.CURRENCIES[c].label) + '</option>').join('') + '</select></label>' +
      '<label class="span2">Warn me when a category reaches <b>' + (b.meta.alertAt || 80) + '%</b><input type="range" min="50" max="100" step="5" data-k="meta::alertAt" value="' + (b.meta.alertAt || 80) + '"></label>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><h3>Preferences</h3></div>' +
      '<div class="pref-row"><span>Language</span>' + langSelect('lang-field') + '</div>' +
      '<label class="toggle"><input type="checkbox" data-act-change="toggle-tips"' + (S.profile.tips !== false ? ' checked' : '') + '><span></span>Occasional tips from Mint</label>' +
      '<label class="toggle"><input type="checkbox" data-act-change="toggle-notify"' + (S.profile.notify && notifState === 'granted' ? ' checked' : '') + (notifState === 'unsupported' ? ' disabled' : '') + '><span></span>Browser notifications for warnings & collaborator edits</label>' +
      (notifState === 'denied' ? '<p class="muted small">Notifications are blocked in your browser settings.</p>' : '') +
      (NATIVE && notifState === 'unsupported' ? '<p class="muted small">In the app, warnings show as in-app alerts with a gentle vibration.</p>' : '') +
      '<button class="pref-link hide-sm" data-act="shortcuts">' + icon('keyboard', 18) + '<span>Keyboard shortcuts</span><kbd translate="no">?</kbd></button>' +
      '</div>' +
      updatesCard() +
      '<div class="card"><div class="card-head"><h3>Your data</h3></div><p class="muted small">Everything lives in this browser. Export a backup any time.</p><div class="row-gap">' +
      '<button class="btn btn-soft" data-act="export-json">' + icon('download', 16) + ' Backup (JSON)</button>' +
      '<button class="btn btn-soft" data-act="import-json">' + icon('upload', 16) + ' Restore backup</button>' +
      '<button class="btn btn-soft" data-act="export-csv-all">' + icon('download', 16) + ' All transactions (CSV)</button>' +
      '<button class="btn btn-soft" data-act="import-csv">' + icon('upload', 16) + ' Import bank CSV</button></div></div>' +
      '<div class="card"><div class="card-head"><h3>Budgets on this device</h3></div><ul class="book-list">' +
      S.books.map((x) => '<li><span>' + esc(x.id === b.id ? b.meta.name : x.name) + (x.id === b.id ? ' <em class="chip">open</em>' : '') + '</span>' + (x.id !== b.id ? '<button class="btn btn-ghost btn-sm" data-act="open-book" data-id="' + esc(x.id) + '">Open</button>' : '') + '</li>').join('') +
      '</ul><div class="row-gap"><button class="btn btn-soft" data-act="new-book">' + icon('plus', 16) + ' New budget</button><button class="btn btn-soft" data-act="demo">Load demo budget</button></div></div>' +
      '<div class="card danger"><div class="card-head"><h3>Danger zone</h3></div><div class="row-gap">' +
      '<button class="btn btn-danger" data-act="delete-book">Delete this budget from this device</button>' +
      '<button class="btn btn-ghost" data-act="reset-all">Reset Mint</button></div></div>' +
      (NATIVE ? '' : '<div class="card get-app-card"><div class="card-head"><h3>Get the app</h3></div><p class="muted small">Mint is free on the web, iPhone and Android. Your budgets sync between them with the same invite link.</p><div class="row-gap"><a class="btn btn-soft" href="' + GET_APP_URL + '#iphone">' + icon('download', 16) + ' iPhone</a><a class="btn btn-soft" href="' + GET_APP_URL + '#android">' + icon('download', 16) + ' Android</a></div></div>') +
      '<div class="card"><div class="card-head"><h3>About</h3></div><p class="muted small">Mint ' + esc(K.VERSION) + ' · local-first budgeting with end-to-end encrypted sharing. Investment targets and tips are educational, not financial advice. Source: <a href="https://github.com/juw12/projects/tree/main/apps/mint" target="_blank" rel="noopener">github.com/juw12/projects</a></p></div>' +
      '</div>'
    );
  }

  // ================================================================ welcome / onboarding
  function renderWelcome(root) {
    const join = S.pendingJoin;
    const hasProfile = !!S.profile;
    const features = [
      ['sheet', 'A live shared sheet', 'Edit transactions together like a spreadsheet. Cell-level merging means nobody overwrites anybody.'],
      ['sparkle', 'Your money personality', 'A 2-minute quiz finds your money animal and how you really behave with money.'],
      ['wallet', 'A plan from your income', 'Mint turns take-home pay into needs, wants, savings and investing envelopes that fit you.'],
      ['alert', 'Warnings before it hurts', 'Alerts at 80%, at 100% and when your pace says you will overspend, for everyone in the budget.'],
      ['chart', 'Investing portfolio', 'Track holdings, allocation versus target, rebalancing moves and long-term growth.'],
      ['shield', 'Private by design', 'No account, local-first, end-to-end encrypted sync. The server never sees your numbers.'],
    ];
    root.innerHTML =
      '<div class="welcome">' +
      '<header class="w-top">' + BRAND + '<div class="w-top-right">' +
      '<a class="btn btn-ghost btn-sm w-templates" href="' + TEMPLATES_URL + '" data-templates>' + icon('template', 16) + '<span>Templates</span></a>' + langSelect() +
      '<button class="icon-btn theme-btn" data-act="theme-welcome" aria-label="Toggle theme" title="Toggle theme">' + themeIcon() + '</button></div></header>' +
      (join
        ? '<section class="card join-card"><p class="eyebrow">' + icon('users', 16) + ' You are invited</p><h2>Join “' + esc(join.name || 'a shared budget') + '”</h2>' +
          '<p class="muted">Edit it together, live. Your edits are encrypted on this device before they are sent.</p>' +
          '<div class="join-row">' + (hasProfile ? '' : '<input id="joinName" placeholder="Your name" maxlength="40" autocomplete="given-name">') +
          '<button class="btn btn-primary btn-lg" data-act="join">Join budget ' + icon('right', 18) + '</button></div></section>'
        : '') +
      '<section class="w-hero"><div class="w-copy">' +
      '<p class="eyebrow">Free on web, iPhone and Android</p>' +
      '<h1>The shared budget that works the way you do.</h1>' +
      '<p class="lead">Plan from your income, track every expense together in real time, get warned before a limit breaks, and grow your investments. Private and end-to-end encrypted.</p>' +
      '<div class="row-gap">' +
      (hasProfile
        ? '<button class="btn btn-primary btn-lg" data-act="new-book">' + icon('plus', 18) + ' Create a budget</button>'
        : '<button class="btn btn-primary btn-lg" data-act="setup">Get started free ' + icon('right', 18) + '</button>') +
      '<button class="btn btn-ghost btn-lg" data-act="demo">See a live example</button></div>' +
      (hasProfile ? '' : '<p class="w-setup-note">3 quick questions · about 30 seconds</p>') +
      '<ul class="trust"><li>' + icon('lock', 14) + '<span>No sign-up, no ads</span></li><li>' + icon('shield', 14) + '<span>End-to-end encrypted</span></li><li>' + icon('users', 14) + '<span>Share with anyone</span></li></ul></div>' +
      '<div class="w-mock" aria-hidden="true">' + welcomeMock() + '</div></section>' +
      '<section class="w-features">' + features.map((f, i) => '<div class="card feat" style="--i:' + i + '"><span class="feat-icon">' + icon(f[0], 18) + '</span><h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>').join('') + '</section>' +
      '<section class="w-animals"><h2>Six money animals. Which one are you?</h2><p class="w-sub">Take the optional 2-minute quiz after setup and Mint tunes your budget and tips to you.</p><div class="animals">' +
      Object.keys(K.PERSONAS).map((k) => '<div class="animal" style="--pc:' + K.PERSONAS[k].color + '"><span>' + K.PERSONAS[k].emoji + '</span><b>' + esc(K.PERSONAS[k].name) + '</b><small>' + esc(K.PERSONAS[k].tagline) + '</small></div>').join('') +
      '</div></section>' +
      '<section class="w-cta"><div><h2>Set up your budget in 30 seconds.</h2><p>Free forever on web, iPhone and Android. No account needed.</p></div>' +
      (hasProfile
        ? '<button class="btn btn-primary btn-lg" data-act="new-book">' + icon('plus', 18) + ' Create a budget</button>'
        : '<button class="btn btn-primary btn-lg" data-act="setup">Get started free ' + icon('right', 18) + '</button>') +
      '</section>' +
      '<section class="card w-templates-band"><span class="feat-icon">' + icon('template', 18) + '</span><div><h3>Also in Mint: spreadsheet templates</h3>' +
      '<p class="muted">Describe a sheet in plain words and get a ready Excel or Google Sheets file, or sell your own templates in the marketplace.</p></div>' +
      '<a class="btn btn-soft" href="' + TEMPLATES_URL + '" data-templates>Open Templates ' + icon('right', 16) + '</a></section>' +
      '<footer class="w-foot">' + (NATIVE ? '' : '<a class="get-app-link" href="' + GET_APP_URL + '">' + icon('download', 14) + '<span>Get Mint for iPhone & Android</span></a>') + '<span>© Mint ' + esc(K.VERSION) + '</span><span>Tips are educational, not financial advice.</span></footer>' +
      '</div>';
  }

  function welcomeMock() {
    const rows = [
      ['🛒', 'Groceries', 0.72, '#00b8a9'],
      ['🍜', 'Dining out', 0.93, '#f39c12'],
      ['🛵', 'Transport', 0.41, '#6c5ce7'],
      ['🛍️', 'Shopping', 1.08, '#e84393'],
    ];
    return (
      '<div class="mock"><div class="mock-top"><span></span><span></span><span></span><b>Our home · October</b><em class="pill pill-live"><i class="dot"></i>Live · 2 online</em></div>' +
      '<div class="mock-hero"><div><small>Left to spend</small><b>Rp 4.820.000</b></div>' + ui.ring(0.68, { size: 84, thickness: 9, label: '68%' }) + '</div>' +
      rows.map((r) => '<div class="mock-row"><span>' + r[0] + ' ' + r[1] + '</span>' + ui.bar(r[2], r[2] >= 1 ? 'over' : r[2] >= 0.8 ? 'warn' : 'ok', r[3]) + '</div>').join('') +
      '<div class="mock-toast"><span>⚠️</span><div><b>Dining out is at 93%</b><small>Ayu just added Rp 180.000 · 6 days to go</small></div></div>' +
      '<div class="mock-cursor" style="--c:#e84393"><i></i><span>Ayu</span></div></div>'
    );
  }

  function newProfile(name) {
    return {
      memberId: K.uid(10),
      name: String(name || 'You').trim().slice(0, 40) || 'You',
      color: ui.MEMBER_COLORS[Math.floor(Math.random() * ui.MEMBER_COLORS.length)],
      persona: null,
      theme: 'system',
      notify: false,
      tips: true,
      createdAt: Date.now(),
    };
  }

  function defaultCurrency() {
    if (S.book) return cur();
    if (S.profile && S.profile.currency) return S.profile.currency;
    const deviceLangs = navigator.languages && navigator.languages.length ? Array.from(navigator.languages) : [navigator.language];
    // A chosen non-English UI language is a stronger hint than the browser default (e.g. 中文 -> CNY).
    return K.guessCurrency(K.i18n.lang === 'en' ? deviceLangs : [K.i18n.locale].concat(deviceLangs));
  }

  // Three questions (name, take-home pay, who it is for), then a ready-made budget. The quiz stays optional.
  function startSetup() {
    const hadProfile = !!S.profile;
    const known = hadProfile && S.profile.facts ? S.profile.facts : {};
    K.quizUI.open({
      only: ['name', 'income', 'household'],
      skipName: hadProfile,
      skipIntro: true,
      quick: true,
      initial: { income: known.income || undefined, household: known.household || undefined },
      currency: defaultCurrency(),
      onCancel: () => {},
      onDone: (answers, result, currency) => {
        const base = hadProfile ? S.profile : newProfile(result.facts.name);
        // Unknowns get neutral defaults so the plan does not assume debt or a missing safety net.
        const facts = Object.assign({ goals: [], ef: 2, debt: 0, housing: 0 }, known, {
          income: result.facts.income,
          household: result.facts.household || 'solo',
        });
        S.profile = Object.assign({}, base, {
          name: result.facts.name || base.name,
          facts: facts,
          currency: currency,
          setupAt: Date.now(),
        });
        if (S.profile.tips == null) S.profile.tips = true;
        saveProfile();
        createBookFromProfile(currency);
        S.view = 'home';
        render();
        toast({ icon: '🎉', title: 'Your budget is ready', body: 'Mint split your income into simple envelopes. Add your first expense with the + button.', tone: 'good' });
      },
    });
  }

  function startQuiz(opts) {
    const o = opts || {};
    K.quizUI.open({
      initial: S.profile && S.profile.answers ? S.profile.answers : {},
      currency: defaultCurrency(),
      onCancel: o.cancellable === false ? null : () => {},
      finishLabel: S.book ? 'Save my personality' : 'Build my budget',
      onDone: (answers, result, currency) => {
        const prev = S.profile || newProfile(result.facts.name);
        S.profile = Object.assign({}, prev, {
          name: result.facts.name || prev.name,
          answers: answers,
          traits: result.traits,
          persona: result.persona,
          ranking: result.ranking,
          facts: result.facts,
          currency: currency,
          quizAt: Date.now(),
        });
        if (S.profile.tips == null) S.profile.tips = true;
        saveProfile();
        if (!S.book) {
          createBookFromProfile(currency);
          toast({ icon: K.PERSONAS[result.persona].emoji, title: 'Welcome, ' + S.profile.name + '!', body: 'Your budget is ready. Add your first expense with the + button.', tone: 'good' });
        } else {
          ensureMember();
          if (S.book.meta.target == null || !S.book.meta.target.label) commit(put('meta', { target: K.targetFor(result.traits.risk) }), true);
          toast({ icon: K.PERSONAS[result.persona].emoji, title: 'You are ' + K.PERSONAS[result.persona].name, body: 'Tips and plan suggestions now follow your personality.', tone: 'good' });
        }
        S.view = 'home';
        render();
      },
    });
  }

  const HOUSEHOLD_NAMES = { solo: 'My budget', couple: 'Our home', family: 'Family budget', shared: 'House share' };

  function createBookFromProfile(currency) {
    const p = S.profile;
    const facts = p.facts || { income: 0, goals: [], ef: 1, debt: 0, household: 'solo' };
    const book = K.newBook({ name: K.i18n.tr(HOUSEHOLD_NAMES[facts.household] || 'My budget'), currency: currency || 'IDR', target: K.targetFor(p.traits ? p.traits.risk : 50), by: p.memberId });
    const by = p.memberId;
    K.put(book, 'members', { id: by, name: p.name, color: p.color }, by);
    if (facts.income > 0) K.put(book, 'incomes', { name: 'Take-home pay', amount: facts.income, freq: 'monthly', owner: by }, by);
    if (facts.income > 0) {
      const plan = K.suggestPlan(p, currency);
      plan.categories.forEach((c, i) => K.put(book, 'categories', { name: c.name, emoji: c.emoji, group: c.group, limit: c.limit, kind: c.kind, order: i }, by));
      if (facts.ef < 2) {
        const monthly = plan.amounts.needs + plan.amounts.wants;
        K.put(book, 'goals', { name: 'Emergency fund', emoji: '🛟', target: K.niceRound(monthly * 6, currency), saved: 0, due: K.shiftMonth(K.monthKey(K.today()), 18) }, by);
      }
      if ((facts.goals || []).indexOf('travel') >= 0) K.put(book, 'goals', { name: 'Dream trip', emoji: '✈️', target: K.niceRound(facts.income * 1.5, currency), saved: 0, due: K.shiftMonth(K.monthKey(K.today()), 10) }, by);
      if ((facts.goals || []).indexOf('home') >= 0) K.put(book, 'goals', { name: 'Home deposit', emoji: '🏡', target: K.niceRound(facts.income * 24, currency), saved: 0, due: K.shiftMonth(K.monthKey(K.today()), 48) }, by);
    }
    store.set('kitty.book.' + book.id, book);
    S.books.push({ id: book.id, name: book.meta.name });
    store.set('kitty.books', S.books);
    openBook(book.id);
  }

  function createBlankBook(name) {
    const book = K.newBook({ name: name || 'New budget', currency: (S.book && cur()) || (S.profile && S.profile.currency) || 'IDR', by: me() });
    K.put(book, 'members', { id: me(), name: S.profile.name, color: S.profile.color }, me());
    store.set('kitty.book.' + book.id, book);
    S.books.push({ id: book.id, name: book.meta.name });
    store.set('kitty.books', S.books);
    openBook(book.id);
    S.view = 'budget';
    render();
  }

  function loadDemo() {
    if (!S.profile) {
      const sample = { name: 'Guest', income: 18500000, household: 'couple', housing: 7500000, goals: ['emergency', 'home', 'invest', 'travel'], payday: 'plan', impulse: 'check', balance: 'weekly', windfall: 'split', drop: 'hold', social: 'suggest', emergency: 2, debt: 1, experience: 2 };
      const result = K.scoreQuiz(sample);
      S.profile = Object.assign(newProfile('Guest'), { answers: sample, traits: result.traits, persona: result.persona, ranking: result.ranking, facts: result.facts, currency: 'IDR', demo: true, color: '#6c5ce7' });
      saveProfile();
    }
    const book = K.demoBook(K.today(), me());
    book.members[me()].name = S.profile.name;
    book.members[me()].color = S.profile.color;
    store.set('kitty.book.' + book.id, book);
    S.books.push({ id: book.id, name: book.meta.name });
    store.set('kitty.books', S.books);
    openBook(book.id);
    S.activity = [
      { who: 'demo-ayu', icon: '🛍️', text: 'added “Sneakers (sale!)” ' + fmt(1150000) + ' · Shopping', at: Date.now() - 1000 * 60 * 26 },
      { who: me(), icon: '🍜', text: 'added “Weekend brunch” ' + fmt(420000) + ' · Dining out', at: Date.now() - 1000 * 60 * 60 * 5 },
      { who: 'demo-ayu', icon: '🗾', text: 'updated goal Japan trip · ' + fmt(21800000) + ' saved', at: Date.now() - 1000 * 60 * 60 * 20 },
    ];
    store.set('kitty.activity.' + book.id, S.activity);
    S.view = params.get('view') && VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'home';
    render();
  }

  function joinFromLink(join, name) {
    if (!S.profile) {
      S.profile = newProfile(name);
      saveProfile();
    }
    let b = loadBook(join.bookId);
    if (!b) b = K.newBook({ id: join.bookId, name: join.name || 'Shared budget', unstamped: true });
    b.room = { key: join.key, relay: join.relay };
    store.set('kitty.book.' + b.id, b);
    if (!S.books.some((x) => x.id === b.id)) S.books.push({ id: b.id, name: b.meta.name });
    store.set('kitty.books', S.books);
    S.pendingJoin = null;
    history.replaceState(null, '', location.pathname + location.search);
    openBook(b.id);
    S.view = 'home';
    render();
    toast({ icon: '🤝', title: 'Joined ' + (join.name || 'the budget'), body: 'Fetching the latest data from your collaborators…', tone: 'good' });
    if (!S.profile.persona && !checklistVisible()) {
      setTimeout(() => toast({ icon: '🌿', title: 'Want personal tips?', body: 'Take the 2-minute quiz to get your money personality.', action: { label: 'Take quiz', fn: () => startQuiz() }, timeout: 12000 }), 4000);
    }
  }

  // ================================================================ modals
  const openModals = [];
  function modal(html, opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML =
      '<div class="modal' + (o.cls ? ' ' + o.cls : '') + '" role="dialog" aria-modal="true">' +
      '<span class="sheet-grip" aria-hidden="true"></span>' +
      '<button class="icon-btn modal-x" data-modal-close aria-label="Close">' + icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    const box = wrap.querySelector('.modal');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      wrap.classList.add('out');
      const at = openModals.indexOf(handle);
      if (at >= 0) openModals.splice(at, 1);
      if (!openModals.length) document.body.classList.remove('no-scroll');
      setTimeout(() => wrap.remove(), 220);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-modal-close]')) close();
    });
    // On phones every modal is a bottom sheet: drag its top edge down to dismiss.
    let dragFrom = null;
    let dragBy = 0;
    box.addEventListener(
      'touchstart',
      (e) => {
        if (!matchMedia('(max-width: 560px)').matches || box.scrollTop > 0) return;
        const y = e.touches[0].clientY;
        if (y - box.getBoundingClientRect().top > 56) return;
        dragFrom = y;
        dragBy = 0;
        box.style.transition = 'none';
      },
      { passive: true }
    );
    box.addEventListener(
      'touchmove',
      (e) => {
        if (dragFrom == null) return;
        dragBy = Math.max(0, e.touches[0].clientY - dragFrom);
        box.style.transform = 'translateY(' + dragBy + 'px)';
      },
      { passive: true }
    );
    const endDrag = () => {
      if (dragFrom == null) return;
      dragFrom = null;
      box.style.transition = 'transform .22s ease';
      if (dragBy > 90) {
        box.style.transform = 'translateY(100%)';
        close();
      } else {
        box.style.transform = '';
      }
    };
    box.addEventListener('touchend', endDrag);
    box.addEventListener('touchcancel', endDrag);
    const first = wrap.querySelector('[autofocus]') || wrap.querySelector('input,select,button:not(.modal-x)');
    if (first && !o.noFocus) setTimeout(() => first.focus({ preventScroll: true }), 40);
    const handle = { el: wrap, close: close };
    openModals.push(handle);
    return handle;
  }

  function confirmModal(o) {
    return new Promise((resolve) => {
      const m = modal('<h2>' + esc(o.title) + '</h2><p class="muted">' + esc(o.body || '') + '</p><div class="row-gap end"><button class="btn btn-ghost" data-no>Cancel</button><button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-yes>' + esc(o.ok || 'OK') + '</button></div>', { cls: 'modal-sm' });
      m.el.querySelector('[data-yes]').onclick = () => {
        m.close();
        resolve(true);
      };
      m.el.querySelector('[data-no]').onclick = () => {
        m.close();
        resolve(false);
      };
    });
  }

  function recentDescriptions() {
    const seen = new Set();
    const out = [];
    K.list(S.book, 'txns')
      .filter((t) => t.type !== 'income' && t.desc)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0))
      .forEach((t) => {
        const d = String(t.desc).trim();
        if (d && !seen.has(d.toLowerCase()) && out.length < 12) {
          seen.add(d.toLowerCase());
          out.push(d);
        }
      });
    return out;
  }

  function openQuickAdd() {
    const stats = K.monthStats(S.book, K.monthKey(K.today()));
    const cats = catList();
    const chip = (r) =>
      '<button type="button" class="qa-cat" data-cat="' + esc(r.cat.id) + '" style="--cc:' + ui.catColor(r.cat) + '"><span>' + esc(r.cat.emoji || '•') + '</span><b>' + esc(r.cat.name) + '</b>' +
      (r.limit > 0 && !r.isSaving ? '<small class="' + (r.status !== 'ok' ? 'st-' + r.status : '') + '">' + esc(fmt(Math.max(0, r.left), true)) + ' left</small>' : '<small>&nbsp;</small>') + '</button>';
    const rows = stats.rows.length ? stats.rows : cats.map((c) => ({ cat: c, limit: 0, left: 0, status: 'ok', isSaving: false }));
    const m = modal(
      '<form class="qa" autocomplete="off">' +
      '<h2>Add transaction</h2>' +
      '<div class="seg qa-type" role="group"><button type="button" class="is-on" data-type="expense">Expense</button><button type="button" data-type="income">Income</button></div>' +
      '<label class="qa-amount"><span>' + esc(cur()) + '</span><input name="amount" inputmode="decimal" placeholder="0" autofocus aria-label="Amount"></label>' +
      '<p class="qa-preview muted small" aria-live="polite">&nbsp;</p>' +
      '<input name="desc" placeholder="What was it? (optional)" maxlength="80" aria-label="Description" list="qaRecent">' +
      '<datalist id="qaRecent">' + recentDescriptions().map((d) => '<option value="' + esc(d) + '"></option>').join('') + '</datalist>' +
      '<p class="qa-auto muted small" hidden></p>' +
      '<div class="qa-cats">' + rows.map(chip).join('') + '</div>' +
      '<div class="qa-row"><input type="date" name="date" value="' + K.today() + '" aria-label="Date"><select name="who" aria-label="Who">' + memberOptions(me()) + '</select></div>' +
      '<p class="qa-warn" hidden></p>' +
      '<button class="btn btn-primary btn-block btn-lg" type="submit">Add</button></form>',
      { cls: 'modal-qa' }
    );
    const form = m.el.querySelector('form');
    let type = 'expense';
    let catId = '';
    let pickedByHand = false;
    const amountEl = form.amount;
    const autoNote = form.querySelector('.qa-auto');
    const preview = form.querySelector('.qa-preview');
    const warn = form.querySelector('.qa-warn');
    function updatePreview() {
      const v = K.parseAmount(amountEl.value, cur());
      preview.textContent = isFinite(v) && v > 0 ? '= ' + fmt(v) : '\u00a0';
      const r = stats.rows.find((x) => x.id === catId);
      if (r && type === 'expense' && v > 0 && r.limit > 0 && !r.isSaving) {
        const after = (r.spent + v) / r.limit;
        const at = (S.book.meta.alertAt || 80) / 100;
        if (after >= at) {
          warn.hidden = false;
          warn.className = 'qa-warn ' + (after >= 1 ? 'is-over' : 'is-warn');
          warn.textContent = (after >= 1 ? '🚨 This puts ' : '⚠️ This brings ') + r.cat.name + ' to ' + Math.round(after * 100) + '% of its limit' + (after >= 1 ? ' (' + fmt(r.spent + v - r.limit) + ' over).' : '.');
        } else {
          warn.hidden = true;
        }
      } else {
        warn.hidden = true;
      }
    }
    amountEl.addEventListener('input', updatePreview);
    form.desc.addEventListener('input', () => {
      if (pickedByHand || type !== 'expense') return;
      const guess = K.guessCategory(S.book, form.desc.value);
      if (guess === catId) return;
      catId = guess;
      $$('[data-cat]', form).forEach((b) => b.classList.toggle('is-on', b.dataset.cat === catId));
      const chipEl = catId && form.querySelector('[data-cat="' + catId + '"]');
      if (chipEl && chipEl.scrollIntoView) chipEl.scrollIntoView({ block: 'nearest' });
      const cat = guess && S.book.categories[guess];
      autoNote.hidden = !cat;
      if (cat) autoNote.textContent = K.t('Category: {name}', { name: (cat.emoji ? cat.emoji + ' ' : '') + K.i18n.tr(cat.name) });
      updatePreview();
    });
    form.addEventListener('click', (e) => {
      const t = e.target.closest('[data-type]');
      if (t) {
        type = t.dataset.type;
        $$('[data-type]', form).forEach((b) => b.classList.toggle('is-on', b === t));
        form.querySelector('.qa-cats').style.display = type === 'income' ? 'none' : '';
        updatePreview();
      }
      const c = e.target.closest('[data-cat]');
      if (c) {
        pickedByHand = true;
        autoNote.hidden = true;
        catId = catId === c.dataset.cat ? '' : c.dataset.cat;
        $$('[data-cat]', form).forEach((b) => b.classList.toggle('is-on', b.dataset.cat === catId));
        updatePreview();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = K.parseAmount(amountEl.value, cur());
      if (!(amount > 0)) {
        amountEl.classList.add('shake');
        setTimeout(() => amountEl.classList.remove('shake'), 500);
        amountEl.focus();
        return;
      }
      const txn = { date: form.date.value || K.today(), desc: form.desc.value.trim().slice(0, 80) || (type === 'income' ? 'Income' : (S.book.categories[catId] || {}).name || 'Expense'), amount: amount, type: type, cat: type === 'income' ? '' : catId, who: form.who.value || me(), createdAt: Date.now() };
      const op = put('txns', txn);
      commit(op);
      m.close();
      const r = stats.rows.find((x) => x.id === catId);
      haptic('tap');
      toast({
        tone: 'good',
        title: (type === 'income' ? 'Income added: ' : 'Added ') + fmt(amount),
        body: r && r.limit > 0 && !r.isSaving ? r.cat.name + ' is now at ' + Math.round(((r.spent + amount) / r.limit) * 100) + '% of its limit.' : '',
        action: { label: 'Undo', fn: () => commit(K.remove(S.book, 'txns', op.id, me())) },
      });
      if (S.profile.tips !== false && Date.now() - S.lastTipToast > 10 * 60 * 1000 && Math.random() < 0.3) {
        setTimeout(() => maybeTipToast(K.monthStats(S.book, S.month), true), 1800);
      }
    });
  }

  function toggleBell() {
    const panel = $('#bellPanel');
    if (!panel) return;
    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }
    const stats = K.monthStats(S.book, S.month);
    const alerts = K.alertsFor(stats, cur());
    const update = U.available
      ? '<div class="update-card"><span class="update-mark" aria-hidden="true">' + icon('sparkle', 18) + '</span>' +
        '<div class="update-text"><b>Mint ' + esc(U.available.version) + ' is ready</b><button class="link-btn" data-act="whats-new">What\'s new</button></div>' +
        '<button class="btn btn-primary btn-sm" data-act="update-now">Update</button></div>'
      : '';
    panel.innerHTML =
      update +
      '<h4>Warnings · ' + esc(K.monthLabel(S.month)) + '</h4>' +
      (alerts.length ? '<ul class="alerts compact">' + alerts.map((a) => '<li class="al-' + a.level + '"><span>' + (a.level === 'over' ? '🚨' : a.level === 'warn' ? '⚠️' : '⚡') + '</span><div><b>' + esc(a.title) + '</b><p>' + esc(a.body) + '</p></div></li>').join('') + '</ul>' : '<p class="muted small">✨ Nothing to worry about.</p>') +
      (S.notes.length ? '<h4>Earlier</h4><ul class="notes">' + S.notes.slice(0, 6).map((n) => '<li><b>' + esc(n.title) + '</b><small>' + esc(ui.timeAgo(n.at)) + '</small></li>').join('') + '</ul>' : '') +
      (!S.profile.notify && 'Notification' in window && Notification.permission !== 'denied' ? '<button class="btn btn-soft btn-sm btn-block" data-act="enable-notify">' + icon('bell', 16) + ' Notify me in the browser</button>' : '');
    panel.hidden = false;
  }

  // ================================================================ phone "More" sheet + keyboard help
  function openMore() {
    const mode = themeMode();
    const persona = K.PERSONAS[S.profile.persona];
    const themes = [
      ['light', 'sun', 'Light'],
      ['dark', 'moon', 'Dark'],
      ['system', 'monitor', 'System'],
    ];
    const rows = [
      ['goals', 'target', 'Goals', ''],
      ['invest', 'chart', 'Invest', ''],
      ['you', 'user', 'You', persona ? persona.emoji + ' ' + persona.name : 'Find your money animal'],
      ['share', 'users', 'Share', syncInfo()[2]],
      ['settings', 'gear', 'Settings', ''],
    ];
    modal(
      '<h2>More</h2><p class="more-book muted small" translate="no">' + esc(S.book.meta.name) + '</p>' +
        '<div class="more-prefs">' +
        '<div class="pref-row"><span>Theme</span><div class="seg seg-theme" role="radiogroup" aria-label="Theme">' +
        themes
          .map((t) => '<button class="' + (mode === t[0] ? 'is-on' : '') + '" role="radio" aria-checked="' + (mode === t[0]) + '" data-act="set-theme" data-theme="' + t[0] + '">' + icon(t[1], 16) + '<span>' + t[2] + '</span></button>')
          .join('') +
        '</div></div>' +
        '<div class="pref-row"><span>Language</span>' + langSelect('lang-field') + '</div></div>' +
        '<nav class="more-list" aria-label="More">' +
        (U.available
          ? '<button class="more-item more-update" data-act="update-now" data-modal-close><span class="more-icon">' + icon('sparkle', 20) + '</span>' +
            '<span class="more-text"><b>Update Mint</b><small translate="no">' + esc(K.VERSION) + ' → ' + esc(U.available.version) + '</small></span>' + icon('right', 18) + '</button>'
          : '') +
        rows
          .map(
            (r) =>
              '<button class="more-item' + (S.view === r[0] ? ' is-on' : '') + '" data-act="go" data-view="' + r[0] + '" data-modal-close>' +
              '<span class="more-icon">' + icon(r[1], 20) + '</span>' +
              '<span class="more-text"><b>' + esc(r[2]) + '</b>' + (r[3] ? '<small>' + esc(r[3]) + '</small>' : '') + '</span>' + icon('right', 18) + '</button>'
          )
          .join('') +
        '<a class="more-item more-templates" href="' + TEMPLATES_URL + '" data-templates><span class="more-icon">' + icon('template', 20) + '</span>' +
        '<span class="more-text"><b>Templates</b><small>Create, buy and sell spreadsheet templates</small></span>' + icon('right', 18) + '</a>' +
        '</nav>',
      { cls: 'modal-more', noFocus: true }
    );
  }

  function openShortcuts() {
    const keys = [
      ['N', 'Add transaction'],
      ['T', 'Toggle theme'],
      ['1 – 8', 'Go to a page'],
      ['/', 'Search the sheet'],
      ['?', 'Show shortcuts'],
      ['Esc', 'Close'],
    ];
    modal(
      '<h2>Keyboard shortcuts</h2><ul class="keys">' +
        keys.map((k) => '<li><span>' + esc(k[1]) + '</span><kbd translate="no">' + esc(k[0]) + '</kbd></li>').join('') +
        '</ul>',
      { cls: 'modal-sm', noFocus: true }
    );
  }

  // ================================================================ import / export
  function download(name, text, type) {
    const blob = new Blob([text], { type: type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
  }
  function pickFile(accept, cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => cb(String(reader.result || ''), f.name);
      reader.readAsText(f);
    };
    input.click();
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV(all) {
    const cats = S.book.categories;
    const rows = K.list(S.book, 'txns')
      .filter((t) => all || String(t.date).slice(0, 7) === S.month)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const lines = [['date', 'description', 'category', 'group', 'type', 'amount', 'currency', 'who']];
    rows.forEach((t) => {
      const c = cats[t.cat];
      lines.push([t.date, t.desc || '', c ? c.name : '', c ? c.group : '', t.type || 'expense', t.amount, cur(), memberName(t.who || t._by)]);
    });
    download('mint-' + S.book.meta.name.replace(/[^\w-]+/g, '-').toLowerCase() + '-' + (all ? 'all' : S.month) + '.csv', lines.map((l) => l.map(csvCell).join(',')).join('\n'), 'text/csv');
  }
  function parseCSV(text) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function normDate(s) {
    const v = String(s || '').trim();
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      let d = Number(m[1]);
      let mo = Number(m[2]);
      if (mo > 12 && d <= 12) {
        const t = d;
        d = mo;
        mo = t;
      }
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    return '';
  }
  function importCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) return toast({ tone: 'bad', title: 'No rows found in that CSV' });
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    const iDate = find(/date|tanggal|tgl/);
    const iDesc = find(/desc|note|memo|keterangan|payee|merchant|name|uraian/);
    const iCat = find(/categ|kategori/);
    const iAmt = find(/^amount|jumlah|nominal|value|^amt/);
    const iType = find(/^type|jenis/);
    const iDebit = find(/debit|out|keluar/);
    const iCredit = find(/credit|kredit|in$|masuk/);
    if (iDate < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) return toast({ tone: 'bad', title: 'Could not find date and amount columns', body: 'Expected headers like date, description, category, amount.' });
    const byName = {};
    catList().forEach((c) => (byName[c.name.toLowerCase()] = c.id));
    const ops = [];
    let order = catList().length;
    rows.slice(1).forEach((r) => {
      const date = normDate(r[iDate]);
      if (!date) return;
      let amount;
      let type = 'expense';
      if (iAmt >= 0) {
        const raw = String(r[iAmt] || '').trim();
        const neg = /^-|\(.*\)|^\s*-/.test(raw);
        amount = Math.abs(K.parseAmount(raw.replace(/[()\-\s]/g, ''), cur()));
        if (iType >= 0) type = /inc|masuk|credit|kredit/i.test(r[iType]) ? 'income' : 'expense';
        else if (!neg && rows.slice(1).some((x) => /^\s*-/.test(String(x[iAmt] || '')))) type = 'income';
      } else {
        const d = K.parseAmount(String(r[iDebit] || '').replace(/[^\d.,]/g, ''), cur());
        const c = K.parseAmount(String(r[iCredit] || '').replace(/[^\d.,]/g, ''), cur());
        if (c > 0) {
          amount = c;
          type = 'income';
        } else amount = d;
      }
      if (!(amount > 0)) return;
      let cat = '';
      const catName = iCat >= 0 ? String(r[iCat] || '').trim() : '';
      if (catName && type === 'expense') {
        if (!byName[catName.toLowerCase()]) {
          const op = put('categories', { name: catName.slice(0, 40), emoji: '🏷️', group: 'wants', kind: 'flex', limit: 0, order: order++ });
          ops.push(op);
          byName[catName.toLowerCase()] = op.id;
        }
        cat = byName[catName.toLowerCase()];
      }
      ops.push(put('txns', { date: date, desc: iDesc >= 0 ? String(r[iDesc] || '').trim().slice(0, 80) : '', amount: amount, type: type, cat: cat, who: me(), createdAt: Date.now() }));
    });
    const n = ops.filter((o) => o.c === 'txns').length;
    commit(ops, true);
    logActivity({ who: me(), icon: '📥', text: 'imported ' + n + ' transactions' });
    toast({ tone: 'good', title: 'Imported ' + n + ' transactions', body: 'New categories were added to Wants with no limit; set limits in Budget.' });
  }
  function exportJSON() {
    const copy = JSON.parse(JSON.stringify(S.book));
    delete copy.room;
    download('mint-backup-' + S.book.meta.name.replace(/[^\w-]+/g, '-').toLowerCase() + '-' + K.today() + '.json', JSON.stringify({ kitty: 1, exportedAt: new Date().toISOString(), book: copy }, null, 1), 'application/json');
  }
  function importJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return toast({ tone: 'bad', title: 'That file is not valid JSON' });
    }
    const src = data && data.book ? data.book : data;
    if (!src || !src.meta || !src.txns) return toast({ tone: 'bad', title: 'Not a Mint backup' });
    const book = K.newBook({ name: (src.meta.name || 'Restored') + ' (restored)', currency: src.meta.currency, by: me() });
    K.applyOps(book, K.snapshotOps(Object.assign(K.newBook({ unstamped: true }), src)).filter((op) => op.c !== 'meta'));
    book.meta = Object.assign({}, src.meta, { name: (src.meta.name || 'Restored') + ' (restored)', _u: K.tick(), _by: me(), _f: undefined });
    delete book.meta._f;
    book.id = K.uid(18);
    store.set('kitty.book.' + book.id, book);
    S.books.push({ id: book.id, name: book.meta.name });
    store.set('kitty.books', S.books);
    openBook(book.id);
    render();
    toast({ tone: 'good', title: 'Backup restored', body: 'Opened as a new budget.' });
  }

  // ================================================================ field editing
  const MONEY_FIELDS = { amount: 1, limit: 1, target: 1, saved: 1, cost: 1, price: 1 };
  const NUM_FIELDS = { qty: 1, alertAt: 1 };

  function editField(el) {
    const parts = el.dataset.k.split(':');
    const coll = parts[0];
    const id = parts[1];
    const field = parts[2];
    let v = el.type === 'checkbox' ? el.checked : el.value;
    const curRec = coll === 'meta' ? S.book.meta : S.book[coll] && S.book[coll][id];
    if (!curRec) return;
    const shake = () => {
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 500);
    };
    if (MONEY_FIELDS[field]) {
      v = K.parseAmount(v, cur());
      if (!isFinite(v) || v < 0) {
        shake();
        el.value = K.fmtPlain(curRec[field], cur());
        return;
      }
    } else if (NUM_FIELDS[field]) {
      v = parseFloat(String(v).replace(',', '.'));
      if (!isFinite(v) || v < 0) {
        shake();
        el.value = curRec[field];
        return;
      }
    } else if (typeof v === 'string') {
      v = v.trim().slice(0, field === 'emoji' ? 8 : 120);
      if (field === 'name' && !v) {
        shake();
        el.value = curRec[field] || '';
        return;
      }
    }
    el.dataset.dirty = '';
    if (curRec[field] === v) return;
    if (coll === 'meta') {
      const patch = {};
      patch[field] = v;
      commit(put('meta', patch));
      if (field === 'currency') S.proj = null;
      return;
    }
    const rec = { id: id };
    rec[field] = v;
    commit(put(coll, rec));
  }

  // ================================================================ events
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.k && t.type !== 'range') t.dataset.dirty = '1';
    if (t.dataset && t.dataset.filter === 'q' && !e.isComposing) {
      S.sheet.q = t.value;
      scheduleRender();
    }
    if (t.dataset && t.dataset.proj) {
      S.proj[t.dataset.proj] = Number(t.value);
      const label = $('[data-proj-label="' + t.dataset.proj + '"]');
      if (label) label.textContent = t.dataset.proj === 'monthly' ? fmt(S.proj.monthly) : t.dataset.proj === 'rate' ? S.proj.rate + '%' : String(S.proj.years);
      const out = $('#projOut');
      if (out) out.innerHTML = projOut(K.portfolio(S.book).total);
    }
    if (t.dataset && t.dataset.k === 'meta::alertAt') {
      const b = t.closest('label') && t.closest('label').querySelector('b');
      if (b) b.textContent = t.value + '%';
    }
  });

  // Chinese/Japanese input methods: filter once the word is composed, not on every keystroke.
  document.addEventListener('compositionend', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.filter === 'q') {
      S.sheet.q = t.value;
      scheduleRender();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.k) return editField(t);
    if (t.dataset.filter && t.dataset.filter !== 'q') {
      S.sheet[t.dataset.filter] = t.value;
      return render();
    }
    if (t.dataset.target) {
      const v = parseFloat(String(t.value).replace(',', '.'));
      if (!isFinite(v) || v < 0 || v > 100) {
        t.value = (S.book.meta.target && S.book.meta.target.mix[t.dataset.target]) || 0;
        return;
      }
      const base = S.book.meta.target || K.targetFor(50);
      const mix = Object.assign({}, base.mix);
      mix[t.dataset.target] = v;
      return commit(put('meta', { target: { label: 'Custom', mix: mix } }));
    }
    if (t.dataset.profile === 'name') {
      const v = t.value.trim().slice(0, 40);
      if (!v) return;
      S.profile.name = v;
      saveProfile();
      ensureMember();
      if (S.room) S.room.me.name = v;
      return render();
    }
    const act = t.dataset.actChange;
    if (act === 'set-lang') {
      K.i18n.setLang(t.value);
      return;
    }
    if (act === 'switch-book') {
      if (t.value === '__new') {
        t.value = S.book.id;
        return promptNewBook();
      }
      openBook(t.value);
      return render();
    }
    if (act === 'toggle-tips') {
      S.profile.tips = t.checked;
      saveProfile();
      return;
    }
    if (act === 'toggle-autoupdate') {
      S.profile.autoUpdate = t.checked;
      saveProfile();
      return;
    }
    if (act === 'toggle-notify') {
      if (t.checked && 'Notification' in window) {
        Notification.requestPermission().then((perm) => {
          S.profile.notify = perm === 'granted';
          saveProfile();
          if (perm === 'granted') toast({ tone: 'good', title: 'Notifications on', body: 'You will hear about warnings and collaborator edits when Mint is in the background.' });
          render();
        });
      } else {
        S.profile.notify = false;
        saveProfile();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t.dataset && t.dataset.k && t.tagName === 'INPUT' && t.closest('.grid-table')) {
      e.preventDefault();
      const row = t.closest('tr');
      const field = t.dataset.k.split(':')[2];
      const rows = $$('tbody tr', t.closest('table'));
      const next = rows[rows.indexOf(row) + (e.shiftKey ? -1 : 1)];
      const target = next && (next.querySelector('[data-k$=":' + field + '"]') || next.querySelector('[data-nk="' + field + '"]'));
      if (target) target.focus();
      else t.blur();
      return;
    }
    if (e.key === 'Enter' && t.dataset && t.dataset.k && t.tagName === 'INPUT') {
      e.preventDefault();
      t.blur();
      return;
    }
    if (e.key === 'Enter' && t.dataset && t.dataset.nk) {
      e.preventDefault();
      return addRowFromInputs();
    }
    if (e.key === 'Enter' && t.dataset && t.dataset.nh) {
      e.preventDefault();
      return addHolding();
    }
    if (e.key === 'Enter' && t.dataset && t.dataset.goalAdd) {
      e.preventDefault();
      return goalAdd(t.dataset.goalAdd);
    }
    if (e.key === 'Escape' && t.dataset && t.dataset.k && t.dataset.dirty === '1') {
      t.dataset.dirty = '';
      scheduleRender();
      t.blur();
    }
    const typing = /INPUT|SELECT|TEXTAREA/.test(t.tagName) || t.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !S.book || document.querySelector('.modal-wrap,.quiz-overlay')) return;
    const key = String(e.key || '').toLowerCase();
    if (key === 'n' || key === 'a') {
      e.preventDefault();
      openQuickAdd();
    } else if (key === 't') {
      e.preventDefault();
      toggleTheme($('.theme-btn'));
    } else if (/^[1-8]$/.test(key)) {
      e.preventDefault();
      go(VIEWS[Number(key) - 1].id);
    } else if (key === '/') {
      e.preventDefault();
      if (S.view !== 'sheet') go('sheet');
      const search = $('[data-filter="q"]');
      if (search) search.focus();
    } else if (key === '?') {
      e.preventDefault();
      openShortcuts();
    }
  });

  function addHolding() {
    const get = (k) => $('[data-nh="' + k + '"]');
    const symbol = get('symbol').value.trim().toUpperCase().slice(0, 12);
    const qty = parseFloat(String(get('qty').value).replace(',', '.'));
    const cost = K.parseAmount(get('cost').value, cur());
    const priceRaw = get('price').value.trim();
    const price = priceRaw ? K.parseAmount(priceRaw, cur()) : cost;
    if (!symbol || !(qty > 0) || !(cost >= 0)) {
      toast({ tone: 'warn', title: 'Add a symbol, quantity and cost' });
      return;
    }
    commit(put('holdings', { symbol: symbol, name: get('name').value.trim().slice(0, 60), cls: get('cls').value, qty: qty, cost: cost, price: isFinite(price) ? price : cost }));
    setTimeout(() => {
      const s = $('[data-nh="symbol"]');
      if (s) s.focus();
    }, 30);
  }

  function goalAdd(id) {
    const input = $('[data-goal-add="' + CSS.escape(id) + '"]');
    const g = S.book.goals[id];
    if (!input || !g) return;
    const v = K.parseAmount(input.value, cur());
    if (!(v > 0)) {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 500);
      return;
    }
    const saved = (Number(g.saved) || 0) + v;
    commit(put('goals', { id: id, saved: saved }));
    if (Number(g.target) > 0 && saved >= Number(g.target) && Number(g.saved) < Number(g.target)) {
      ui.confetti();
      toast({ tone: 'good', icon: '🎉', title: 'Goal reached: ' + g.name, body: 'Amazing work. Time to set the next one?' });
    }
  }

  function promptNewBook() {
    const m = modal(
      '<h2>New budget</h2><p class="muted">One for you, one with your partner, one for a trip with friends…</p>' +
      '<label class="field">Name<input id="nbName" placeholder="e.g. Bali trip 2027" maxlength="40" autofocus></label>' +
      '<div class="row-gap end"><button class="btn btn-ghost" data-modal-close>Cancel</button>' +
      (S.profile.persona ? '<button class="btn btn-soft" id="nbPlan">From my plan</button>' : '') +
      '<button class="btn btn-primary" id="nbBlank">Create</button></div>',
      { cls: 'modal-sm' }
    );
    m.el.querySelector('#nbBlank').onclick = () => {
      const name = m.el.querySelector('#nbName').value.trim();
      m.close();
      createBlankBook(name || 'New budget');
    };
    const planBtn = m.el.querySelector('#nbPlan');
    if (planBtn) {
      planBtn.onclick = () => {
        const name = m.el.querySelector('#nbName').value.trim();
        m.close();
        createBookFromProfile(cur());
        if (name) commit(put('meta', { name: name }), true);
        S.view = 'home';
        render();
      };
    }
  }

  async function applyPlan() {
    const plan = currentPlan();
    if (!(plan.income > 0)) {
      go('budget');
      return toast({ tone: 'warn', title: 'Add your income first', body: 'Mint needs your take-home pay to size the envelopes.' });
    }
    const ok = await confirmModal({
      title: 'Apply Mint\'s plan?',
      body: 'Needs ' + plan.pct.needs + '% · Wants ' + plan.pct.wants + '% · Savings ' + plan.pct.savings + '% · Investing ' + plan.pct.invest + '% of ' + fmt(plan.income) + '. Matching envelopes get new limits; missing ones are created. Your transactions are untouched.',
      ok: 'Apply plan',
    });
    if (!ok) return;
    const byName = {};
    catList().forEach((c) => (byName[c.name.toLowerCase()] = c));
    const ops = [];
    let order = catList().length;
    plan.categories.forEach((pc) => {
      const ex = byName[pc.name.toLowerCase()];
      if (ex) ops.push(put('categories', { id: ex.id, limit: pc.limit, group: pc.group }));
      else ops.push(put('categories', { name: pc.name, emoji: pc.emoji, group: pc.group, limit: pc.limit, kind: pc.kind, order: order++ }));
    });
    commit(ops, true);
    logActivity({ who: me(), icon: '✨', text: 'applied Mint\'s plan to the envelopes' });
    toast({ tone: 'good', title: 'Plan applied', body: plan.categories.length + ' envelopes sized to your income.' });
  }

  document.addEventListener('click', async (e) => {
    const bellPanel = $('#bellPanel');
    if (bellPanel && !bellPanel.hidden && !e.target.closest('.bell-wrap')) bellPanel.hidden = true;
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'button')) return;
    const act = el.dataset.act;
    switch (act) {
      case 'go':
        return go(el.dataset.view);
      case 'quiz':
        return startQuiz();
      case 'setup':
        return startSetup();
      case 'hide-setup':
        S.profile.hideSetup = Object.assign({}, S.profile.hideSetup, { [S.book.id]: true });
        saveProfile();
        return render();
      case 'share-result':
        return shareResult();
      case 'demo':
        return loadDemo();
      case 'join': {
        const nameEl = $('#joinName');
        const name = nameEl ? nameEl.value.trim() : '';
        if (nameEl && !name) {
          nameEl.classList.add('shake');
          setTimeout(() => nameEl.classList.remove('shake'), 500);
          return nameEl.focus();
        }
        return joinFromLink(S.pendingJoin, name);
      }
      case 'theme':
      case 'theme-welcome':
        return toggleTheme(el);
      case 'set-theme':
        return setTheme(el.dataset.theme, el);
      case 'more':
        return openMore();
      case 'shortcuts':
        return openShortcuts();
      case 'update-now':
        return applyUpdate();
      case 'check-update':
        return checkForUpdate({ force: true, render: true });
      case 'whats-new':
        return openWhatsNew(U.available || U.current || { version: K.VERSION, notes: {} }, !!U.available);
      case 'month':
        S.month = K.shiftMonth(S.month, Number(el.dataset.d));
        S.animateNext = true;
        return render();
      case 'quick-add':
        return openQuickAdd();
      case 'bell':
        return toggleBell();
      case 'enable-notify':
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          S.profile.notify = perm === 'granted';
          saveProfile();
          $('#bellPanel').hidden = true;
          if (perm === 'granted') toast({ tone: 'good', title: 'Notifications on' });
        }
        return;
      case 'next-tip':
        S.tipIndex++;
        return render();
      case 'tip-now':
        return maybeTipToast(K.monthStats(S.book, S.month), true);
      case 'sort': {
        const k = el.dataset.sort;
        if (S.sheet.sort === k) S.sheet.dir *= -1;
        else {
          S.sheet.sort = k;
          S.sheet.dir = k === 'date' || k === 'amount' ? -1 : 1;
        }
        return render();
      }
      case 'add-row':
        return addRowFromInputs();
      case 'del-txn': {
        const id = el.dataset.id;
        const t = S.book.txns[id];
        commit(K.remove(S.book, 'txns', id, me()));
        return toast({ title: 'Row deleted', body: t ? (t.desc || '') + ' · ' + fmt(t.amount) : '', action: { label: 'Undo', fn: () => commit(K.restore(S.book, 'txns', id, me())) } });
      }
      case 'del': {
        const c = el.dataset.c;
        const id = el.dataset.id;
        const rec = S.book[c][id];
        if (c === 'categories') {
          const used = K.list(S.book, 'txns').filter((t) => t.cat === id).length;
          if (used) {
            const ok = await confirmModal({ title: 'Delete “' + rec.name + '”?', body: used + ' transactions use it and will become uncategorized.', ok: 'Delete', danger: true });
            if (!ok) return;
          }
        }
        commit(K.remove(S.book, c, id, me()));
        return toast({ title: 'Deleted', body: (rec && (rec.name || rec.symbol)) || '', action: { label: 'Undo', fn: () => commit(K.restore(S.book, c, id, me())) } });
      }
      case 'add-income':
        return commit(put('incomes', { name: 'Income', amount: 0, freq: 'monthly', owner: me() }));
      case 'add-cat': {
        const order = catList().length;
        commit(put('categories', { name: 'New envelope', emoji: '✨', group: el.dataset.group, kind: el.dataset.group === 'needs' || el.dataset.group === 'wants' ? 'flex' : 'fixed', limit: 0, order: order }));
        return setTimeout(() => {
          const inputs = $$('.env-name');
          const last = inputs[inputs.length - 1];
          const target = $$('[data-group="' + el.dataset.group + '"]').length ? $$('.env-group').find((g) => g.querySelector('[data-group="' + el.dataset.group + '"]')) : null;
          const name = target ? $$('.env-name', target).pop() : last;
          if (name) {
            name.focus();
            name.select();
          }
        }, 60);
      }
      case 'apply-plan':
        return applyPlan();
      case 'add-goal': {
        const get = (k) => $('[data-ng="' + k + '"]');
        const name = get('name').value.trim();
        const target = K.parseAmount(get('target').value, cur());
        if (!name || !(target > 0)) return toast({ tone: 'warn', title: 'Give the goal a name and a target' });
        const saved = K.parseAmount(get('saved').value || '0', cur()) || 0;
        return commit(put('goals', { name: name.slice(0, 40), emoji: get('emoji').value || '🎯', target: target, saved: saved, due: get('due').value || '' }));
      }
      case 'goal-add':
        return goalAdd(el.dataset.id);
      case 'add-holding':
        return addHolding();
      case 'preset': {
        const t = K.targetFor(Number(el.dataset.risk));
        return commit(put('meta', { target: t }));
      }
      case 'color':
        S.profile.color = el.dataset.color;
        saveProfile();
        ensureMember();
        if (S.room) S.room.me.color = el.dataset.color;
        return render();
      case 'start-share': {
        const relayEl = $('[data-relay]');
        let relay = relayEl ? relayEl.value.trim().replace(/\/+$/, '') : K.DEFAULT_RELAY;
        if (!/^https?:\/\/[^\s]+$/.test(relay)) relay = K.DEFAULT_RELAY;
        if (!window.EventSource || !(window.crypto && crypto.subtle)) return toast({ tone: 'bad', title: 'Sharing needs HTTPS', body: 'Open Mint from its https:// address to share.' });
        S.book.room = { key: K.newRoomKey(), relay: relay };
        if (!S.book.meta._u) commit(put('meta', { name: S.book.meta.name }), true);
        saveBookNow();
        connectRoom();
        logActivity({ who: me(), icon: '🔗', text: 'started sharing this budget' });
        render();
        return toast({ tone: 'good', icon: '🔗', title: 'Share link ready', body: 'Copy it and send it to the people you budget with.' });
      }
      case 'copy-link': {
        const input = $('#shareLink');
        try {
          await navigator.clipboard.writeText(input.value);
        } catch (err) {
          input.select();
          document.execCommand('copy');
        }
        return toast({ tone: 'good', title: 'Link copied', body: 'Anyone with it can edit this budget.' });
      }
      case 'native-share':
        try {
          await shareSheet('Join my Mint budget', 'Let\'s budget “' + S.book.meta.name + '” together on Mint', $('#shareLink').value);
        } catch (err) {
          /* cancelled */
        }
        return;
      case 'stop-share': {
        const ok = await confirmModal({ title: 'Stop syncing on this device?', body: 'Your local copy stays here. Others keep their copies and can keep editing.', ok: 'Stop syncing' });
        if (!ok) return;
        disconnectRoom();
        delete S.book.room;
        S.status = 'local';
        saveBookNow();
        return render();
      }
      case 'export-csv':
        return exportCSV(false);
      case 'export-csv-all':
        return exportCSV(true);
      case 'import-csv':
        return pickFile('.csv,text/csv', importCSV);
      case 'export-json':
        return exportJSON();
      case 'import-json':
        return pickFile('.json,application/json', importJSON);
      case 'open-book':
        openBook(el.dataset.id);
        return render();
      case 'new-book':
        if (!S.profile) return startSetup();
        return promptNewBook();
      case 'delete-book': {
        const ok = await confirmModal({ title: 'Delete “' + S.book.meta.name + '” from this device?', body: 'If it is shared, other people keep their copies. This cannot be undone here.', ok: 'Delete', danger: true });
        if (!ok) return;
        const id = S.book.id;
        disconnectRoom();
        store.del('kitty.book.' + id);
        store.del('kitty.activity.' + id);
        store.del('kitty.sync.' + id);
        S.books = S.books.filter((b) => b.id !== id);
        store.set('kitty.books', S.books);
        S.book = null;
        if (S.books.length) openBook(S.books[0].id);
        else store.del('kitty.current');
        S.view = 'home';
        return render();
      }
      case 'reset-all': {
        const ok = await confirmModal({ title: 'Reset Mint on this device?', body: 'Deletes every budget, your profile and quiz results from this browser.', ok: 'Reset everything', danger: true });
        if (!ok) return;
        disconnectRoom();
        Object.keys(localStorage)
          .filter((k) => k.indexOf('kitty.') === 0)
          .forEach((k) => localStorage.removeItem(k));
        location.href = location.pathname;
        return;
      }
      default:
        return;
    }
  });

  // live clocks in the sheet ("2m ago") and presence pills refresh every 30 s
  setInterval(() => {
    if (S.book && (S.view === 'sheet' || S.view === 'share' || S.view === 'home') && !document.querySelector('[data-dirty="1"]') && !document.hidden) scheduleRender();
  }, 30000);
  if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode() !== 'system') return;
      document.documentElement.classList.add('theme-fade');
      render();
      setTimeout(() => document.documentElement.classList.remove('theme-fade'), 450);
    });
  }
  // Language switch: rebuild every screen so English source text is re-translated (or restored).
  window.addEventListener('kitty:lang', () => {
    const root = $('#app');
    if (root) root.innerHTML = '';
    openModals.slice().forEach((m) => m.close());
    $$('.modal-wrap, .toast').forEach((el) => el.remove());
    document.body.classList.remove('no-scroll');
    render();
  });
  window.addEventListener('hashchange', () => {
    const j = K.parseJoin(location.hash);
    if (j) {
      S.pendingJoin = j;
      if (S.profile) joinFromLink(j, S.profile.name);
      else render();
    }
  });

  // ================================================================ updates: notice a new version and update in place
  // Every release publishes version.json next to index.html. Mint reads it at start, every 30 minutes, when you come
  // back to the app and when the connection returns. A newer version shows a toast, a bell entry and Update buttons.
  // With "Install updates automatically" on (the default) it also installs itself the next time you switch away,
  // unless you are in the middle of something. Budgets, the open page, the month and the scroll position survive.
  const UPDATE_EVERY = 30 * 60 * 1000;
  const UPDATE_GAP = 5 * 60 * 1000;
  const UPDATE_QUIET = 10 * 60 * 1000;
  const U = {
    available: null, // { version, notes } of a newer release
    current: null, // version.json when it describes this build (for "What's new")
    checking: false,
    lastCheck: 0,
    result: '', // '' | 'current' | 'available' | 'failed'
    announced: '',
    applying: false,
    quietUntil: 0,
    registration: null,
  };

  function autoUpdates() {
    return !S.profile || S.profile.autoUpdate !== false;
  }
  function releaseNotes(info) {
    const notes = (info && info.notes) || {};
    const list = notes[K.i18n.lang] && notes[K.i18n.lang].length ? notes[K.i18n.lang] : notes.en;
    return Array.isArray(list) ? list.slice(0, 5) : [];
  }
  function releaseNotesHTML(info) {
    const list = releaseNotes(info);
    return list.length ? '<ul class="release-notes" translate="no">' + list.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  }
  function fetchRelease() {
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null));
  }

  function checkForUpdate(opts) {
    const o = opts || {};
    if (!window.fetch || U.checking || U.applying) return Promise.resolve(U.available);
    if (!o.force && Date.now() - U.lastCheck < UPDATE_GAP) return Promise.resolve(U.available);
    U.checking = true;
    U.lastCheck = Date.now();
    if (o.render) scheduleRender();
    return fetchRelease()
      .then((info) => {
        if (!info || !info.version) {
          U.result = 'failed';
        } else if (K.compareVersions(info.version, K.VERSION) > 0) {
          U.result = 'available';
          foundUpdate(info);
        } else {
          U.result = 'current';
          U.available = null;
          if (String(info.version) === K.VERSION) U.current = info;
        }
      })
      .catch(() => {
        U.result = 'failed';
      })
      .then(() => {
        U.checking = false;
        // Settings shows the result live; elsewhere only an explicit check re-renders.
        if (o.render || (S.book && S.view === 'settings')) scheduleRender();
        return U.available;
      });
  }

  function foundUpdate(info) {
    const version = String(info.version);
    const fresh = !U.available || U.available.version !== version;
    U.available = { version: version, notes: info.notes || {} };
    if (!fresh) return;
    // We just tried to install this version and the old files came back (a cache still catching up):
    // keep the Update buttons, but skip the toast and the automatic install for a few minutes.
    const tried = store.get('kitty.updateTry', null);
    if (tried && tried.version === version && Date.now() - tried.at < UPDATE_QUIET) U.quietUntil = tried.at + UPDATE_QUIET;
    if (S.book) scheduleRender();
    if (Date.now() >= U.quietUntil) announceUpdate();
  }

  function announceUpdate() {
    const info = U.available;
    if (!info || !S.book || U.announced === info.version) return;
    U.announced = info.version;
    toast({
      icon: '✨',
      title: 'Mint ' + info.version + ' is ready',
      body: autoUpdates() ? 'Tap Update, or it installs itself the next time you switch away.' : 'Tap Update to get the newest version.',
      action: { label: 'Update', fn: () => applyUpdate() },
      timeout: 15000,
    });
  }

  /** Automatic installs never interrupt: no open sheet, quiz, half-typed field or focused input. */
  function safeToUpdate() {
    if (U.applying || !U.available || Date.now() < U.quietUntil) return false;
    if (document.querySelector('.modal-wrap, .quiz-overlay, [data-dirty="1"]')) return false;
    const a = document.activeElement;
    return !(a && a !== document.body && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  function refreshAppFiles() {
    // Download every file this page runs, past the browser cache, so the reload below starts the new version.
    const sameOrigin = (u) => {
      try {
        return new URL(u, location.href).origin === location.origin;
      } catch (e) {
        return false;
      }
    };
    const files = [location.href.split('#')[0]]
      .concat(
        $$('script[src]').map((s) => s.src),
        $$('link[rel="stylesheet"]').map((l) => l.href)
      )
      .filter(sameOrigin);
    const all = Promise.all(files.map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
    return Promise.race([all, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }

  function applyUpdate(opts) {
    const o = opts || {};
    if (U.applying) return;
    U.applying = true;
    saveBookNow();
    try {
      sessionStorage.setItem('kitty.resume', JSON.stringify({ view: S.view, month: S.month, y: Math.round(window.scrollY), at: Date.now() }));
    } catch (e) {
      /* private mode: the app simply opens on Overview */
    }
    if (U.available) store.set('kitty.updateTry', { version: U.available.version, at: Date.now() });
    if (!o.quiet) showUpdating();
    refreshAppFiles().then(() => {
      const waiting = U.registration && U.registration.waiting;
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      location.reload();
    });
  }

  function showUpdating() {
    const el = document.createElement('div');
    el.className = 'updating';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="updating-card">' + LOGO + '<b>Updating Mint…</b><i class="updating-bar" aria-hidden="true"></i></div>';
    document.body.appendChild(el);
  }

  function takeResume() {
    try {
      const raw = sessionStorage.getItem('kitty.resume');
      sessionStorage.removeItem('kitty.resume');
      const r = raw ? JSON.parse(raw) : null;
      return r && Date.now() - r.at < 2 * 60 * 1000 ? r : null;
    } catch (e) {
      return null;
    }
  }
  function restoreResume(r) {
    if (!r || !S.book) return;
    if (VIEWS.some((v) => v.id === r.view)) S.view = r.view;
    if (/^\d{4}-\d{2}$/.test(r.month || '')) S.month = r.month;
  }

  /** After an update, say so once (with the release notes). Returns true when that notice is shown.
   *  `returning` = this device already had a profile and budgets before this page load (the demo creates them on the fly). */
  function noticeAfterUpdate(returning) {
    const last = store.get('kitty.lastVersion', '');
    store.set('kitty.lastVersion', K.VERSION);
    const tried = store.get('kitty.updateTry', null);
    if (tried && K.compareVersions(K.VERSION, tried.version) >= 0) store.del('kitty.updateTry');
    // People who used Mint before 1.5 have budgets but no stored version yet: they just updated too.
    const upgraded = last ? K.compareVersions(K.VERSION, last) > 0 : returning;
    if (!upgraded || !S.book) return false;
    fetchRelease()
      .catch(() => null)
      .then((info) => {
        if (info && String(info.version) === K.VERSION) U.current = info;
        if (info && K.compareVersions(info.version, K.VERSION) > 0) foundUpdate(info);
        const mine = U.current || { version: K.VERSION, notes: {} };
        const notes = releaseNotes(mine);
        toast({
          icon: '🎉',
          title: 'Updated to Mint ' + K.VERSION,
          body: notes[0] || 'Everything you had is still here.',
          action: notes.length ? { label: "What's new", fn: () => openWhatsNew(mine, false) } : null,
          timeout: 9000,
        });
      });
    return true;
  }

  function openWhatsNew(info, pending) {
    modal(
      '<h2>What\'s new</h2><p class="muted small whats-version">Mint <b translate="no">' + esc(info.version) + '</b></p>' +
        (releaseNotesHTML(info) || '<p class="muted">Small fixes and improvements.</p>') +
        '<div class="row-gap end">' +
        (pending
          ? '<button class="btn btn-ghost" data-modal-close>Later</button><button class="btn btn-primary" data-act="update-now" data-modal-close>Update now</button>'
          : '<button class="btn btn-primary" data-modal-close>Got it</button>') +
        '</div>',
      { cls: 'modal-sm', noFocus: true }
    );
  }

  function setupUpdates(returning) {
    const noticed = noticeAfterUpdate(returning);
    setTimeout(() => checkForUpdate({ force: true }), noticed ? 8000 : 4000);
    setInterval(() => {
      if (!document.hidden) checkForUpdate();
    }, UPDATE_EVERY);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkForUpdate();
      } else if (autoUpdates() && safeToUpdate()) {
        applyUpdate({ quiet: true });
      }
    });
    window.addEventListener('online', () => checkForUpdate({ force: true }));
    return noticed;
  }

  // ================================================================ boot
  function boot() {
    const returning = !!(S.profile && S.books.length);
    const join = K.parseJoin(location.hash);
    if (join) S.pendingJoin = join;
    const wanted = params.get('view');
    if (S.profile) {
      const curId = store.get('kitty.current', null);
      const id = (curId && S.books.some((b) => b.id === curId) && curId) || (S.books[0] && S.books[0].id);
      if (id) openBook(id);
    }
    if (wanted && VIEWS.some((v) => v.id === wanted)) S.view = wanted;
    const resume = takeResume();
    restoreResume(resume);
    if (params.get('demo') === '1' && !join) {
      const existingDemo = S.books.find((b) => /^demo-/.test(b.id));
      if (existingDemo) {
        openBook(existingDemo.id);
        restoreResume(resume);
        render();
      } else {
        loadDemo();
      }
    } else if (join && S.profile) {
      const existing = loadBook(join.bookId);
      if (existing && existing.room) {
        history.replaceState(null, '', location.pathname + location.search);
        S.pendingJoin = null;
        openBook(existing.id);
        render();
      } else {
        render();
        joinFromLink(join, S.profile.name);
      }
    } else {
      render();
    }
    if (resume && resume.y) requestAnimationFrame(() => window.scrollTo(0, resume.y));
    const justUpdated = setupUpdates(returning);
    if (S.book && !justUpdated) setTimeout(() => maybeTipToast(K.monthStats(S.book, S.month)), 2500);
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker
        .register('sw.js')
        .then((reg) => {
          U.registration = reg;
        })
        .catch(() => {});
    }
    if (params.get('add') === '1' && S.book) setTimeout(openQuickAdd, 400);
    setupNative();
    window.__kittyNative = { native: NATIVE, platform: NATIVE_PLATFORM };
    window.__kittyReady = true;
  }

  window.KittyApp = { state: S, render: render, commit: commit, put: put, openBook: openBook, startQuiz: startQuiz, loadDemo: loadDemo };
  boot();
})();
