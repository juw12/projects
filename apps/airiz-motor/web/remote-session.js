/* AIRIZ remote sessions (v1.9.0): remembered devices, reconnect after sleep, keep awake.
 *
 * Phone / other device: a random device id + secret key kept in this browser. It goes
 * with every "Control by code" request so the PC can recognise the device next time.
 * PC (has the AIRIZ on USB): the devices its operator chose to remember. Only a SHA-256
 * hash of each device key is stored. Remembered devices can be let in automatically
 * (a setting the operator controls); any device can be forgotten at any time.
 *
 * Also shared by remote-control.js and camera-relay.js: the phone reconnect policy, a
 * liveness check, a sleep/wake hub and the keep-awake switch used while sharing.
 *
 * 1.11.4: the owner can keep one code of their own (like a password, changeable any time) and
 * devices the owner allows are remembered by default ("Remember every device I allow").
 *
 * 1.9.1: phones never stop reconnecting by themselves (every minute after the first ten),
 * a reloaded phone page carries on with the same code, and a PC console that reloads or
 * restarts for an update shares again with the SAME code (resume records below).
 * Loaded as a plain script (window.AirizRemoteSession) and by the Node unit tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AirizRemoteSession = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  const IDENTITY_KEY = 'airiz.remote.identity.v1';
  const TRUST_KEY = 'airiz.remote.trust.v1';
  const MAX_DEVICES = 50;
  const ID_PATTERN = /^[0-9a-f]{16}$/;
  const KEY_PATTERN = /^[0-9a-f]{32}$/;
  const HASH_PATTERN = /^[0-9a-f]{64}$/;

  // ------------------------------------------------------------------ storage helpers
  function memoryStorage() {
    const data = new Map();
    return {
      getItem: key => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => {
        data.set(key, String(value));
      },
      removeItem: key => {
        data.delete(key);
      },
    };
  }

  let fallbackStorage = null;
  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (ignored) { /* storage blocked (private mode) */ }
    fallbackStorage = fallbackStorage || memoryStorage();
    return fallbackStorage;
  }

  function readJson(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (ignored) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (ignored) {
      return false;
    }
  }

  function randomHex(byteCount) {
    const bytes = new Uint8Array(byteCount);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function cleanName(value) {
    return String(value || '').replace(/[^A-Za-z0-9 ._()-]/g, '').trim().slice(0, 40) || 'Remote device';
  }

  // ------------------------------------------------------------------ phone identity
  // The same id + key for every connection from this browser (until its data is cleared).
  function loadIdentity(storage) {
    const store = storage || defaultStorage();
    const saved = readJson(store, IDENTITY_KEY);
    if (saved && ID_PATTERN.test(saved.id) && KEY_PATTERN.test(saved.key)) return { id: saved.id, key: saved.key };
    const identity = { id: randomHex(8), key: randomHex(16) };
    writeJson(store, IDENTITY_KEY, identity);
    return identity;
  }

  function validIdentity(id, key) {
    return ID_PATTERN.test(String(id || '')) && KEY_PATTERN.test(String(key || ''));
  }

  async function hashKey(key) {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof subtle.digest !== 'function') throw new Error('SHA-256 is not available here.');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode('airiz-remote-v1:' + key));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------------ PC: remembered devices
  function createTrustStore(storage, clock) {
    const store = storage || defaultStorage();
    const now = clock || (() => Date.now());

    function load() {
      const saved = readJson(store, TRUST_KEY) || {};
      const devices = Array.isArray(saved.devices)
        ? saved.devices.filter(item => item && ID_PATTERN.test(item.id) && HASH_PATTERN.test(item.keyHash))
        : [];
      // 1.11.4: autoRemember (default on) = Allow also remembers the device.
      return { autoAllow: saved.autoAllow !== false, autoRemember: saved.autoRemember !== false, devices };
    }

    function save(data) {
      data.devices.sort((first, second) => (second.lastSeen || 0) - (first.lastSeen || 0));
      return writeJson(store, TRUST_KEY, {
        autoAllow: data.autoAllow,
        autoRemember: data.autoRemember,
        devices: data.devices.slice(0, MAX_DEVICES),
      });
    }

    return {
      get autoAllow() {
        return load().autoAllow;
      },
      setAutoAllow(flag) {
        const data = load();
        data.autoAllow = !!flag;
        return save(data);
      },
      get autoRemember() {
        return load().autoRemember;
      },
      setAutoRemember(flag) {
        const data = load();
        data.autoRemember = !!flag;
        return save(data);
      },
      list() {
        return load().devices
          .map(item => ({ id: item.id, name: cleanName(item.name), added: item.added || 0, lastSeen: item.lastSeen || 0 }))
          .sort((first, second) => second.lastSeen - first.lastSeen);
      },
      // { status: 'unknown' | 'remembered' | 'mismatch', device? }
      async check(id, key) {
        if (!validIdentity(id, key)) return { status: 'unknown' };
        const device = load().devices.find(item => item.id === id);
        if (!device) return { status: 'unknown' };
        let hash;
        try {
          hash = await hashKey(key);
        } catch (ignored) {
          return { status: 'unknown' };
        }
        const copy = { id: device.id, name: cleanName(device.name), added: device.added || 0, lastSeen: device.lastSeen || 0 };
        return hash === device.keyHash ? { status: 'remembered', device: copy } : { status: 'mismatch', device: copy };
      },
      async remember(id, key, name) {
        if (!validIdentity(id, key)) return false;
        let hash;
        try {
          hash = await hashKey(key);
        } catch (ignored) {
          return false;
        }
        const data = load();
        const time = now();
        const existing = data.devices.find(item => item.id === id);
        if (existing) {
          existing.keyHash = hash;
          existing.name = cleanName(name);
          existing.lastSeen = time;
        } else {
          data.devices.push({ id, keyHash: hash, name: cleanName(name), added: time, lastSeen: time });
        }
        return save(data);
      },
      touch(id, name) {
        const data = load();
        const device = data.devices.find(item => item.id === id);
        if (!device) return false;
        device.lastSeen = now();
        if (name) device.name = cleanName(name);
        return save(data);
      },
      forget(id) {
        const data = load();
        const before = data.devices.length;
        data.devices = data.devices.filter(item => item.id !== id);
        save(data);
        return data.devices.length !== before;
      },
      forgetAll() {
        const data = load();
        data.devices = [];
        return save(data);
      },
    };
  }

  // What the PC does with a control request.
  //   trust: 'unknown' | 'remembered' | 'mismatch'
  //   sessionApproved: this device (same id and key) was allowed earlier while sharing this code
  function decide(request) {
    const options = request || {};
    if (options.trust === 'mismatch') return 'ask-warning';
    if (options.sessionApproved) return 'auto-session';
    if (options.trust === 'remembered' && options.autoAllow) return 'auto-remembered';
    return 'ask';
  }

  // ------------------------------------------------------------------ phone: reconnect policy
  // Reasons a remote-control link ends (link.lastError.reason):
  //   lost       the transport to the PC dropped        pc-gone   the PC left without saying why
  //   pc-silent  the PC stopped answering pings         stopped   the PC operator stopped sharing
  //   denied / revoked / busy  the PC operator said no  cancelled the user on this device stopped
  //   no-pc / timeout / approval-timeout / network      a (re)connect attempt failed
  //   restart    the PC console restarts for an update and shares again with the same code
  const RETRY_START = ['lost', 'pc-gone', 'pc-silent', 'restart'];
  const RETRY_CONTINUE = RETRY_START.concat(['no-pc', 'timeout', 'approval-timeout', 'network', 'verify']);
  // 1.9.1: no time limit any more (it was 30 minutes). After the quick attempts the phone keeps
  // trying once a minute for as long as its page is open; waking up, coming back online or
  // showing the page again tries at once. Only a "no" from the PC or Stop on the phone ends it.
  const RETRY_SLOW_MS = 60 * 1000;

  function retryDelay(attempt) {
    if (attempt < 3) return 3000;
    if (attempt < 8) return 8000;
    if (attempt < 38) return 20000;
    return RETRY_SLOW_MS;
  }

  function canStartRetry(reason) {
    return RETRY_START.includes(reason);
  }

  function canContinueRetry(reason) {
    return RETRY_CONTINUE.includes(reason);
  }

  // ------------------------------------------------------------------ resume after a reload (1.9.1)
  // Phone: the code it controls with, kept in sessionStorage (this tab only). Mobile browsers
  // reload tabs that slept for a long time; the reloaded page then reconnects by itself.
  const PHONE_RESUME_KEY = 'airiz.remote.resume.v1';
  const PHONE_RESUME_MAX_MS = 12 * 60 * 60 * 1000;
  const CODE_PATTERN = /^\d{6}$/;

  function clock(now) {
    return now === undefined ? Date.now() : now;
  }

  function savePhoneResume(storage, code, now) {
    if (!storage || !CODE_PATTERN.test(String(code || ''))) return false;
    return writeJson(storage, PHONE_RESUME_KEY, { code: String(code), at: clock(now) });
  }

  function loadPhoneResume(storage, now) {
    if (!storage) return null;
    const saved = readJson(storage, PHONE_RESUME_KEY);
    if (!saved || !CODE_PATTERN.test(String(saved.code || ''))) return null;
    const age = clock(now) - Number(saved.at);
    if (!(age >= -60000 && age < PHONE_RESUME_MAX_MS)) return null;
    return { code: String(saved.code), at: Number(saved.at) };
  }

  function clearPhoneResume(storage) {
    try {
      if (storage) storage.removeItem(PHONE_RESUME_KEY);
    } catch (ignored) { /* storage blocked */ }
  }

  // PC: the share code and the devices allowed in this share (hashes of their keys), refreshed
  // while sharing. A console that reloads, or restarts to install an update, shares again with
  // the SAME code within 15 minutes and lets those devices straight back in. Not after it was
  // closed and opened again: Stop sharing and closing the Windows app clear the record.
  const SHARE_RESUME_KEY = 'airiz.share.resume.v1';
  const SHARE_RESUME_MAX_MS = 15 * 60 * 1000;
  const DEVICE_PATTERN = /^[0-9a-f]{16}$/;

  function cleanApproved(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(item => Array.isArray(item) && DEVICE_PATTERN.test(String(item[0])) && HASH_PATTERN.test(String(item[1])))
      .slice(0, MAX_DEVICES)
      .map(item => [String(item[0]), String(item[1])]);
  }

  function saveShareResume(storage, record, now) {
    if (!storage || !record || !CODE_PATTERN.test(String(record.code || ''))) return false;
    return writeJson(storage, SHARE_RESUME_KEY, {
      code: String(record.code),
      at: clock(now),
      reason: record.reason === 'update' ? 'update' : 'running',
      approved: cleanApproved(record.approved),
    });
  }

  function loadShareResume(storage) {
    if (!storage) return null;
    const saved = readJson(storage, SHARE_RESUME_KEY);
    if (!saved || !CODE_PATTERN.test(String(saved.code || '')) || !Number.isFinite(Number(saved.at))) return null;
    return {
      code: String(saved.code),
      at: Number(saved.at),
      reason: saved.reason === 'update' ? 'update' : 'running',
      approved: cleanApproved(saved.approved),
    };
  }

  function clearShareResume(storage) {
    try {
      if (storage) storage.removeItem(SHARE_RESUME_KEY);
    } catch (ignored) { /* storage blocked */ }
  }

  // navigation: performance navigation type of this page load ('reload', 'navigate', ...).
  function shouldResumeShare(record, context) {
    const settings = context || {};
    if (!record) return false;
    const age = clock(settings.now) - record.at;
    if (!(age >= -60000 && age < SHARE_RESUME_MAX_MS)) return false;
    return record.reason === 'update' || settings.navigation === 'reload';
  }

  // ------------------------------------------------------------------ PC: the owner's own code (1.11.4)
  // The share code is also the address phones look the PC up by (PeerJS id and relay room), so
  // it stays 6 digits. Codes anyone would try first are refused: another AIRIZ owner picking the
  // same code would take turns with this PC for the same address.
  const OWN_CODE_KEY = 'airiz.share.ownCode.v1';

  function easyCode(code) {
    const digits = Array.from(code, Number);
    const steps = digits.slice(1).map((digit, index) => (digit - digits[index] + 10) % 10);
    if (steps.every(step => step === 0)) return true;                       // 111111
    if (steps.every(step => step === 1) || steps.every(step => step === 9)) return true; // 123456, 654321, 890123
    if (code.slice(0, 2).repeat(3) === code) return true;                    // 121212
    if (code.slice(0, 3).repeat(2) === code) return true;                    // 123123
    if (code === code.split('').reverse().join('')) return true;             // 123321
    if (code[0] === code[1] && code[2] === code[3] && code[4] === code[5]) {
      const pairs = [digits[0], digits[2], digits[4]];
      const up = (pairs[1] - pairs[0] + 10) % 10;
      if (up === (pairs[2] - pairs[1] + 10) % 10) return true;              // 112233, 332211, 777777
    }
    return false;
  }

  // { ok: true, code } or { ok: false, reason: 'format' | 'easy' }
  function checkOwnCode(value) {
    const code = String(value == null ? '' : value).replace(/\s+/g, '');
    if (!CODE_PATTERN.test(code)) return { ok: false, reason: 'format' };
    if (easyCode(code)) return { ok: false, reason: 'easy' };
    return { ok: true, code };
  }

  function loadOwnCode(storage) {
    if (!storage) return null;
    const saved = readJson(storage, OWN_CODE_KEY);
    const check = checkOwnCode(saved && saved.code);
    return check.ok ? check.code : null;
  }

  function saveOwnCode(storage, value, now) {
    const check = checkOwnCode(value);
    if (!check.ok) return check;
    if (!storage || !writeJson(storage, OWN_CODE_KEY, { code: check.code, at: clock(now) })) {
      return { ok: false, reason: 'storage' };
    }
    return check;
  }

  function clearOwnCode(storage) {
    try {
      if (storage) storage.removeItem(OWN_CODE_KEY);
    } catch (ignored) { /* storage blocked */ }
  }

  // ------------------------------------------------------------------ liveness (phone side)
  // tick() every few seconds while connected: 'ping' = send a ping now, 'dead' = the PC has not
  // answered for too long, 'wait' = nothing to do. A long gap between ticks means THIS device
  // was asleep: the PC gets a fresh chance to answer instead of being declared dead.
  function createLiveness(options) {
    const settings = options || {};
    const timeout = settings.timeout || 30000;
    const pingEvery = settings.pingEvery || 10000;
    const suspendGap = settings.suspendGap || 15000;
    const clock = settings.now || (() => Date.now());
    let lastHeard = clock();
    let lastPing = -Infinity;
    let lastTick = clock();
    return {
      heard() {
        lastHeard = clock();
      },
      tick() {
        const time = clock();
        if (time - lastTick > suspendGap) {
          lastHeard = time;
          lastPing = -Infinity;
        }
        lastTick = time;
        if (time - lastHeard > timeout) return 'dead';
        if (time - lastPing >= pingEvery) {
          lastPing = time;
          return 'ping';
        }
        return 'wait';
      },
    };
  }

  // ------------------------------------------------------------------ sleep / wake
  // Timers stop while a PC sleeps; a gap far longer than the interval means it woke up.
  // The threshold is above Chrome's one-minute background throttling, so a hidden window
  // does not look like a wake-up.
  function createWakeDetector(onWake, options) {
    const settings = options || {};
    const interval = settings.interval || 5000;
    const threshold = settings.threshold || 90000;
    const clock = settings.now || (() => Date.now());
    const schedule = settings.setInterval || setInterval;
    const cancel = settings.clearInterval || clearInterval;
    let last = clock();
    function check() {
      const time = clock();
      const gap = time - last;
      last = time;
      if (gap > threshold) onWake(gap);
      return gap;
    }
    const timer = schedule(check, interval);
    return {
      check,
      stop() {
        cancel(timer);
      },
    };
  }

  const wakeListeners = new Set();
  const suspendListeners = new Set();
  let wakeHubStarted = false;
  let lastWakeAt = 0;

  function emitWake(reason) {
    const time = Date.now();
    // Power resume, the timer gap and "online" often report the same wake-up.
    if (time - lastWakeAt < 3000) return;
    lastWakeAt = time;
    for (const listener of [...wakeListeners]) {
      try {
        listener(reason);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function emitSuspend() {
    for (const listener of [...suspendListeners]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }

  function startWakeHub() {
    if (wakeHubStarted || !root) return;
    wakeHubStarted = true;
    createWakeDetector(() => emitWake('timer-gap'));
    if (typeof root.addEventListener === 'function') root.addEventListener('online', () => emitWake('online'));
    if (root.document) root.document.addEventListener('resume', () => emitWake('page-resume'));
    const desktop = root.airizDesktop;
    if (desktop && typeof desktop.onPowerChange === 'function') {
      desktop.onPowerChange(state => {
        if (state === 'resume') emitWake('power-resume');
        if (state === 'suspend') emitSuspend();
      });
    }
  }

  function onWake(listener) {
    startWakeHub();
    wakeListeners.add(listener);
    return () => wakeListeners.delete(listener);
  }

  function onSuspend(listener) {
    startWakeHub();
    suspendListeners.add(listener);
    return () => suspendListeners.delete(listener);
  }

  // ------------------------------------------------------------------ keep awake while sharing
  // Windows app: a power-save blocker in the main process (system stays on; the screen too on
  // Modern Standby PCs) and, 1.9.1, the power plan's sleep timers set to Never while sharing.
  // Browser: the Screen Wake Lock (only while the console tab is visible).
  function createKeepAwake(environment) {
    const env = environment || {};
    let wanted = false;
    let sentinel = null;
    let requesting = false;
    let desktopActive = false;

    function visible() {
      return !env.document || env.document.visibilityState === 'visible';
    }

    async function acquire() {
      if (!env.wakeLock || sentinel || requesting || !wanted || !visible()) return;
      requesting = true;
      try {
        const lock = await env.wakeLock.request('screen');
        if (!wanted) {
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch (ignored) {
        // Not allowed right now (hidden tab, battery saver); retried when the tab is visible.
      } finally {
        requesting = false;
      }
    }

    function release() {
      const lock = sentinel;
      sentinel = null;
      if (lock) lock.release().catch(() => {});
    }

    if (env.document && !env.desktop) {
      env.document.addEventListener('visibilitychange', () => {
        if (wanted) acquire();
      });
    }

    return {
      get wanted() {
        return wanted;
      },
      get active() {
        return env.desktop ? desktopActive : !!sentinel;
      },
      get mode() {
        if (env.desktop && typeof env.desktop.setKeepAwake === 'function') return 'desktop';
        return env.wakeLock ? 'screen' : 'none';
      },
      async set(flag) {
        wanted = !!flag;
        if (env.desktop && typeof env.desktop.setKeepAwake === 'function') {
          try {
            desktopActive = !!(await env.desktop.setKeepAwake(wanted));
          } catch (ignored) {
            desktopActive = false;
          }
          return desktopActive;
        }
        if (wanted) await acquire();
        else release();
        return !!sentinel;
      },
    };
  }

  return Object.freeze({
    IDENTITY_KEY,
    TRUST_KEY,
    MAX_DEVICES,
    RETRY_SLOW_MS,
    PHONE_RESUME_KEY,
    PHONE_RESUME_MAX_MS,
    SHARE_RESUME_KEY,
    SHARE_RESUME_MAX_MS,
    OWN_CODE_KEY,
    memoryStorage,
    loadIdentity,
    validIdentity,
    hashKey,
    createTrustStore,
    decide,
    retryDelay,
    canStartRetry,
    canContinueRetry,
    savePhoneResume,
    loadPhoneResume,
    clearPhoneResume,
    saveShareResume,
    loadShareResume,
    clearShareResume,
    shouldResumeShare,
    checkOwnCode,
    loadOwnCode,
    saveOwnCode,
    clearOwnCode,
    createLiveness,
    createWakeDetector,
    onWake,
    onSuspend,
    emitWake,
    createKeepAwake,
  });
});
