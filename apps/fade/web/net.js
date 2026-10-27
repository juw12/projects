/* Fade Network: the serverless backend that runs inside every Fade client.
 *
 * Fade's UI talks to an HTTP-style API (`/api/...`). In network mode this file answers those
 * calls in the browser, using signed Nostr events on public relays as the shared database:
 *
 *   public docs   kind 30078, d = "<ns>:<type>:<id>", t = <ns>, k = <type>
 *                 user, barber, place, product, short, follows, act (likes/views/shares),
 *                 review, comment, msg (community), group, tagok, busy, receipts, mod
 *   shared docs   kind 30078, t = "<ns>-p", p = every participant; content encrypted per
 *                 participant with NIP-44. Each participant signs its own side of the record
 *                 (booking, order, cm = commission, rent), and a reducer merges the sides
 *                 trusting each field only from the party allowed to set it.
 *   DMs           NIP-17 gift wraps (kind 1059)
 *   reports       NIP-56 (kind 1984), moderation list = "mod" doc signed by an admin key
 *
 * Identity is a secp256k1 key. "Email + password" sign-in derives that key with PBKDF2, so the
 * same credentials work on any device; nothing about the email is published.
 */
(function () {
  'use strict';

  const NT = window.NostrTools;
  if (!NT) {
    window.FadeNet = null;
    return;
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const BASE = window.FADE_CONFIG || {};
  const PARAMS = new URLSearchParams(location.search);
  const CFG = {
    ns: BASE.ns || 'fade3',
    relays: (BASE.relays || []).slice(),
    blossom: (BASE.blossom || []).slice(),
    ntfy: BASE.ntfy || 'https://ntfy.sh',
    admins: (BASE.admins || []).filter((pk) => /^[0-9a-f]{64}$/.test(pk)),
    maxUploadMb: BASE.maxUploadMb || 50,
  };
  if (PARAMS.has('devnet')) {
    const wsOrigin = location.origin.replace(/^http/, 'ws');
    CFG.relays = [`${wsOrigin}/`];
    CFG.blossom = [location.origin];
    CFG.ntfy = `${location.origin}/ntfy`;
    CFG.ns = 'fade3dev';
  }
  if (PARAMS.get('relays')) CFG.relays = PARAMS.get('relays').split(',').filter(Boolean);
  if (PARAMS.get('blossom')) CFG.blossom = PARAMS.get('blossom').split(',').filter(Boolean);
  if (PARAMS.get('ntfy')) CFG.ntfy = PARAMS.get('ntfy');
  if (PARAMS.get('ns')) CFG.ns = PARAMS.get('ns').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || CFG.ns;
  if (PARAMS.get('admins')) CFG.admins = PARAMS.get('admins').split(',').filter((pk) => /^[0-9a-f]{64}$/.test(pk));

  const NS = CFG.ns;
  const PRIVATE_TAG = `${NS}-p`;
  // ?profile=name keeps separate keys/caches per profile (several test users in one browser).
  const PROFILE = (PARAMS.get('profile') || '').replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const SCOPE = PROFILE ? `${NS}.${PROFILE}` : NS;
  const KEY_STORE = `fade.netkey.${SCOPE}`;
  const OUTBOX_STORE = `fade.outbox.${SCOPE}`;
  const LOCAL_STORE = `fade.netlocal.${SCOPE}`;

  // ---------------------------------------------------------------------------
  // Business rules (kept in line with app.js / server.py; Fade itself charges nothing)
  // ---------------------------------------------------------------------------
  const TIERS = { standard: 3, premium: 6, luxe: 10 };
  const COMMISSION_RATES = { featured: 0.05, sponsored: 0.1 };
  const DEPOSIT_PCT = 0.2;
  const BOOKING_WINDOW_DAYS = 30;
  const CANCEL_FREE_HOURS = 24;
  const MAX_TIP = 500;
  const AUTO_EARN_HOURS = 48;
  const AUTO_REPORT_HIDE = 3;
  const SHORT_CATEGORIES = ['Cut reveal', 'Before / after', 'Tutorial', 'Shop tour', 'Products', 'Behind the chair'];
  const CHALLENGES = {
    c_month3: { goal: 3, pts: 300 },
    c_new: { goal: 4, pts: 250 },
    c_review: { goal: 5, pts: 200 },
    c_tip: { goal: 3, pts: 150 },
    c_shop: { goal: 1, pts: 100 },
    c_comm: { goal: 4, pts: 100 },
    c_ref: { goal: 1, pts: 500 },
  };
  const PAY_RAILS = ['paypal', 'venmo', 'cashapp', 'revolut', 'wise', 'lightning', 'stripe', 'bank', 'qris', 'ewallet', 'cash'];
  const BLOCKED_WORDS = ['nigger', 'faggot', 'kill yourself', 'kys', 'child porn', 'cp link'];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const nowSec = () => Math.floor(Date.now() / 1000);
  const round2 = (n) => Math.round(n * 100) / 100;
  const pk16 = (pk) => pk.slice(0, 16);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function randomHex(bytes = 6) {
    const data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    return [...data].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function fnvHue(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h % 360;
  }

  // Synchronous SHA-256 (via the event hash function) for opaque receipt tokens.
  function syncHash(...parts) {
    return NT.getEventHash({
      pubkey: '0'.repeat(64),
      created_at: 0,
      kind: 0,
      tags: [],
      content: parts.join('|'),
    });
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function fail(status, message) {
    throw new ApiError(status, message);
  }

  function text(body, name, max = 200, required = true) {
    let value = body[name];
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string') fail(400, `${name} must be text`);
    value = value.trim();
    if (required && !value) fail(400, `${name} is required`);
    if (value.length > max) fail(400, `${name} is too long (max ${max})`);
    return value;
  }

  function num(body, name, low, high, required = true, fallback) {
    const value = body[name];
    if ((value === undefined || value === null) && !required) return fallback;
    if (typeof value !== 'number' || Number.isNaN(value)) fail(400, `${name} must be a number`);
    if (value < low || value > high) fail(400, `${name} must be between ${low} and ${high}`);
    return value;
  }

  // Same matcher as server.py blocked_phrase(): letters may repeat or be split by spaces/dots, leetspeak
  // and accents are undone, and short words must stand alone (so "sky" and "Niger" are fine).
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };
  const BLOCKED_PATTERNS = BLOCKED_WORDS.map((phrase) => {
    const letters = phrase.replace(/ /g, '');
    const body = [...letters].map((ch) => `${ch}+`).join('[\\W_]*');
    return new RegExp(`(?:^|[^a-z])${body}${letters.length <= 4 ? '(?![a-z])' : ''}`);
  });

  function cleanText(value) {
    const raw = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const leet = raw.replace(/[013457@$!|]/g, (ch) => LEET[ch]);
    const digits = raw.replace(/[013457]/g, (ch) => LEET[ch]);
    const ones = raw.replace(/[1|]/g, 'l').replace(/[013457@$!|]/g, (ch) => LEET[ch]);
    return !BLOCKED_PATTERNS.some((pattern) => [leet, digits, ones].some((text) => pattern.test(text)));
  }

  // On-device scan results (web/scan.js) travel with each short; clients enforce the same thresholds.
  const SCAN = { block: 0.85, review: 0.5, reviewSexy: 0.9 };

  function cleanScan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const nsfw = Number(raw.nsfw);
    const sexy = Number(raw.sexy);
    if (!(nsfw >= 0 && nsfw <= 1 && sexy >= 0 && sexy <= 1)) return null;
    return { nsfw: Math.round(nsfw * 10000) / 10000, sexy: Math.round(sexy * 10000) / 10000, model: String(raw.model || 'nsfwjs').slice(0, 40) };
  }

  const PHASH_MATCH_BITS = 10; // same threshold as server.py

  function hamming16(a, b) {
    if (!/^[0-9a-f]{16}$/.test(a || '') || !/^[0-9a-f]{16}$/.test(b || '')) return 64;
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let bits = 0;
    while (x) {
      bits += Number(x & 1n);
      x >>= 1n;
    }
    return bits;
  }

  // Removed media whose perceptual hash is within PHASH_MATCH_BITS of `hash` (not counting `ownId` itself).
  function blockedMatch(hash, ownId, db) {
    if (!/^[0-9a-f]{16}$/.test(hash || '')) return null;
    for (const [blocked, target] of (db || derive()).mod.phash) {
      if (target !== ownId && hamming16(hash, blocked) <= PHASH_MATCH_BITS) return target || 'removed media';
    }
    return null;
  }

  function scanVerdict(scan) {
    if (!scan) return 'unscanned';
    if (scan.nsfw >= SCAN.block) return 'block';
    if (scan.nsfw >= SCAN.review || scan.sexy >= SCAN.reviewSexy) return 'review';
    return 'ok';
  }

  function ensureClean(value, what = 'text') {
    if (!cleanText(value)) fail(400, `That ${what} breaks the community guidelines`);
  }

  // ----- time zones -----
  function safeTz(tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch (err) {
      return 'UTC';
    }
  }

  function tzParts(tz, date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz(tz), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
    return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
  }

  function tzOffsetMin(tz, date) {
    const p = tzParts(tz, date);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    const floored = Math.floor(date.getTime() / 60000) * 60000;
    return Math.round((asUtc - floored) / 60000);
  }

  function startUtcMs(key, time, tz) {
    const [y, m, d] = key.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d) + Math.round(time * 60) * 60000;
    const first = tzOffsetMin(tz, new Date(guess));
    let ts = guess - first * 60000;
    const second = tzOffsetMin(tz, new Date(ts));
    if (second !== first) ts = guess - second * 60000;
    return ts;
  }

  function placeNow(place) {
    const p = tzParts(place.tz || 'UTC', new Date());
    const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    return { key, hour: p.h + p.min / 60 };
  }

  function addDaysKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
  }

  function dowOf(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function overlaps(aStart, aMins, bStart, bMins) {
    return aStart < bStart + bMins / 60 && bStart < aStart + aMins / 60;
  }

  function isoWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------
  const CURVE_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

  function validKey(bytes) {
    const value = BigInt(`0x${NT.utils.bytesToHex(bytes)}`);
    return value > 0n && value < CURVE_N;
  }

  async function deriveKey(email, password) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    let salt = `fade-v3|${email.trim().toLowerCase()}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 310000, hash: 'SHA-256' },
        material,
        256,
      );
      const bytes = new Uint8Array(bits);
      if (validKey(bytes)) return bytes;
      salt += '|again';
    }
    throw new Error('Could not derive a key, choose another password');
  }

  const ME = { sk: null, pk: null };

  function loadKey() {
    const stored = localStorage.getItem(KEY_STORE);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) setKey(NT.utils.hexToBytes(stored), false);
  }

  function setKey(bytes, persist = true) {
    ME.sk = bytes;
    ME.pk = NT.getPublicKey(bytes);
    if (persist) localStorage.setItem(KEY_STORE, NT.utils.bytesToHex(bytes));
  }

  function clearKey() {
    ME.sk = null;
    ME.pk = null;
    localStorage.removeItem(KEY_STORE);
  }

  function parseSecret(input) {
    const value = String(input || '').trim();
    if (/^[0-9a-f]{64}$/i.test(value)) return NT.utils.hexToBytes(value.toLowerCase());
    if (value.startsWith('nsec1')) {
      const decoded = NT.nip19.decode(value);
      if (decoded.type === 'nsec') return decoded.data;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------
  const CONV_KEYS = new Map();

  function convKey(pk) {
    if (!CONV_KEYS.has(pk)) CONV_KEYS.set(pk, NT.nip44.getConversationKey(ME.sk, pk));
    return CONV_KEYS.get(pk);
  }

  function seal(data, recipients) {
    const json = JSON.stringify(data);
    const enc = {};
    [...new Set([ME.pk, ...recipients])].forEach((pk) => {
      enc[pk] = NT.nip44.encrypt(json, convKey(pk));
    });
    return JSON.stringify({ enc });
  }

  function unseal(event) {
    if (!ME.sk) return null;
    try {
      const envelope = JSON.parse(event.content);
      const payload = envelope.enc && envelope.enc[ME.pk];
      if (!payload) return null;
      return JSON.parse(NT.nip44.decrypt(payload, convKey(event.pubkey)));
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event store (in memory, cached in IndexedDB)
  // ---------------------------------------------------------------------------
  let DB = null;

  const STORE = {
    byId: new Map(),
    byAddr: new Map(),
    deletedIds: new Set(),
    deletedAddr: new Map(),
    dirty: false,
  };

  function addressOf(event) {
    if (event.kind >= 30000 && event.kind < 40000) {
      const d = (event.tags.find((t) => t[0] === 'd') || [])[1] || '';
      return `${event.kind}:${event.pubkey}:${d}`;
    }
    return null;
  }

  function tagValue(event, name) {
    const tag = event.tags.find((t) => t[0] === name);
    return tag ? tag[1] : undefined;
  }

  function ingest(event) {
    if (!event || !event.id || STORE.byId.has(event.id) || STORE.deletedIds.has(event.id)) return false;
    if (event.kind === 5) {
      STORE.byId.set(event.id, event);
      event.tags.forEach((tag) => {
        if (tag[0] === 'e') {
          const target = STORE.byId.get(tag[1]);
          if (!target || target.pubkey === event.pubkey) {
            STORE.deletedIds.add(tag[1]);
            if (target) dropEvent(target);
          }
        }
        if (tag[0] === 'a' && tag[1] && tag[1].split(':')[1] === event.pubkey) {
          const prev = STORE.deletedAddr.get(tag[1]) || 0;
          STORE.deletedAddr.set(tag[1], Math.max(prev, event.created_at));
          const current = STORE.byAddr.get(tag[1]);
          if (current && current.created_at <= event.created_at) dropEvent(current);
        }
      });
      STORE.dirty = true;
      DB = null;
      return true;
    }
    const addr = addressOf(event);
    if (addr) {
      if ((STORE.deletedAddr.get(addr) || 0) >= event.created_at) return false;
      const current = STORE.byAddr.get(addr);
      if (current) {
        if (current.created_at > event.created_at || (current.created_at === event.created_at && current.id > event.id)) return false;
        dropEvent(current);
      }
      STORE.byAddr.set(addr, event);
    }
    STORE.byId.set(event.id, event);
    STORE.dirty = true;
    DB = null;
    return true;
  }

  function dropEvent(event) {
    STORE.byId.delete(event.id);
    const addr = addressOf(event);
    if (addr && STORE.byAddr.get(addr) === event) STORE.byAddr.delete(addr);
  }

  const Cache = {
    db: null,
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(`fade-net-${SCOPE}`, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('events');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this.db;
    },
    async load() {
      try {
        const db = await this.open();
        const events = await new Promise((resolve, reject) => {
          const tx = db.transaction('events', 'readonly');
          const request = tx.objectStore('events').get('all');
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        events.forEach(ingest);
      } catch (err) {
        // cache is optional
      }
    },
    async save() {
      if (!STORE.dirty) return;
      STORE.dirty = false;
      try {
        const db = await this.open();
        const events = [...STORE.byId.values()]
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 6000);
        await new Promise((resolve, reject) => {
          const tx = db.transaction('events', 'readwrite');
          tx.objectStore('events').put(events, 'all');
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (err) {
        STORE.dirty = true;
      }
    },
    async clear() {
      try {
        const db = await this.open();
        await new Promise((resolve) => {
          const tx = db.transaction('events', 'readwrite');
          tx.objectStore('events').delete('all');
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      } catch (err) {
        // ignore
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Relay connection, subscriptions and the outbox
  // ---------------------------------------------------------------------------
  const pool = new NT.SimplePool({ enableReconnect: true });
  const listeners = new Set();
  let subscription = null;
  let changeTimer = null;
  let lastEventAt = 0;
  let synced = false;
  const status = { connected: 0, relays: CFG.relays.length, lastSync: 0, outbox: 0 };

  function emitChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      DB = null;
      afterDerive();
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.error(err);
        }
      });
    }, 120);
  }

  function onEvent(event) {
    lastEventAt = Date.now();
    if (ingest(event)) emitChange();
  }

  function filters() {
    const list = [
      { kinds: [30078], '#t': [NS], '#k': ['user', 'barber', 'place', 'product', 'mod', 'group', 'busy', 'receipts', 'tagok'], limit: 3000 },
      { kinds: [30078], '#t': [NS], '#k': ['short'], limit: 600 },
      { kinds: [30078], '#t': [NS], '#k': ['act', 'follows'], limit: 3000 },
      { kinds: [30078], '#t': [NS], '#k': ['review', 'comment'], limit: 2000 },
      { kinds: [30078], '#t': [NS], '#k': ['msg'], limit: 1500 },
      { kinds: [1984], '#t': [NS], limit: 1000 },
      { kinds: [5], '#t': [NS], limit: 3000 },
    ];
    if (ME.pk) {
      list.push({ kinds: [30078], '#p': [ME.pk], limit: 2000 });
      list.push({ kinds: [30078], authors: [ME.pk], limit: 2000 });
      list.push({ kinds: [1059], '#p': [ME.pk], limit: 1000 });
    }
    return list;
  }

  function subscribe() {
    if (subscription) {
      try {
        subscription.close();
      } catch (err) {
        // ignore
      }
    }
    const requests = [];
    CFG.relays.forEach((url) => filters().forEach((filter) => requests.push({ url, filter })));
    subscription = pool.subscribeMap(requests, {
      onevent: onEvent,
      oneose: () => {
        synced = true;
        status.lastSync = Date.now();
        emitChange();
      },
    });
  }

  function refreshStatus() {
    try {
      const map = pool.listConnectionStatus();
      status.connected = [...map.values()].filter(Boolean).length;
    } catch (err) {
      status.connected = 0;
    }
    status.outbox = loadOutbox().length;
  }

  function loadOutbox() {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_STORE) || '[]');
    } catch (err) {
      return [];
    }
  }

  function saveOutbox(list) {
    localStorage.setItem(OUTBOX_STORE, JSON.stringify(list.slice(-300)));
  }

  async function sendToRelays(event, timeoutMs = 9000) {
    const attempts = pool.publish(CFG.relays, event).map((promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]));
    const results = await Promise.allSettled(attempts);
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  async function publish(event, { wait = true } = {}) {
    ingest(event);
    emitChange();
    const job = sendToRelays(event).then((accepted) => {
      if (!accepted) {
        const outbox = loadOutbox();
        if (!outbox.find((e) => e.id === event.id)) outbox.push(event);
        saveOutbox(outbox);
      }
      return accepted;
    });
    if (wait) await job;
    return event;
  }

  async function flushOutbox() {
    const outbox = loadOutbox();
    if (!outbox.length) return;
    const remaining = [];
    for (const event of outbox) {
      const accepted = await sendToRelays(event, 6000).catch(() => 0);
      if (!accepted) remaining.push(event);
    }
    saveOutbox(remaining);
  }

  function sign(kind, tags, content) {
    if (!ME.sk) fail(401, 'Sign in first');
    return NT.finalizeEvent({ kind, created_at: Math.max(nowSec(), lastSignedAt + 1), tags, content }, ME.sk);
  }

  let lastSignedAt = 0;

  function signTracked(kind, tags, content) {
    const event = sign(kind, tags, content);
    lastSignedAt = event.created_at;
    return event;
  }

  // Public replaceable doc.
  function putDoc(type, id, data, extraTags = [], opts = {}) {
    const tags = [['d', `${NS}:${type}:${id}`], ['t', NS], ['k', type], ...extraTags];
    return publish(signTracked(30078, tags, JSON.stringify(data)), opts);
  }

  // Shared encrypted doc: my side of a multi-party record.
  function putShared(type, id, data, recipients, opts = {}) {
    const people = [...new Set(recipients.filter((pk) => pk && pk !== ME.pk))];
    const tags = [['d', `${NS}:${type}:${id}`], ['t', PRIVATE_TAG], ['k', type], ...people.map((pk) => ['p', pk])];
    return publish(signTracked(30078, tags, seal(data, people)), opts);
  }

  function deleteDoc(type, id) {
    const addr = `30078:${ME.pk}:${NS}:${type}:${id}`;
    return publish(signTracked(5, [['a', addr], ['t', NS]], 'deleted'), { wait: false });
  }

  function myDocEvent(type, id) {
    return ME.pk ? STORE.byAddr.get(`30078:${ME.pk}:${NS}:${type}:${id}`) : null;
  }

  function myDoc(type, id) {
    const event = myDocEvent(type, id);
    if (!event) return null;
    try {
      return event.tags.some((t) => t[0] === 't' && t[1] === PRIVATE_TAG) ? unseal(event) : JSON.parse(event.content);
    } catch (err) {
      return null;
    }
  }

  // Query helper with a deadline (used for sign-in lookups).
  async function queryOnce(filter, maxWait = 5000) {
    try {
      const events = await pool.querySync(CFG.relays, filter, { maxWait });
      events.forEach(ingest);
      return events;
    } catch (err) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Derivation: events -> database
  // ---------------------------------------------------------------------------

  function memo(key, compute) {
    const db = derive();
    if (!db.memo.has(key)) db.memo.set(key, compute());
    return db.memo.get(key);
  }

  function docType(event) {
    return tagValue(event, 'k');
  }

  function docId(event) {
    const d = tagValue(event, 'd') || '';
    const prefix = `${NS}:${docType(event)}:`;
    return d.startsWith(prefix) ? d.slice(prefix.length) : null;
  }

  function parseJson(event) {
    try {
      const value = JSON.parse(event.content);
      return value && typeof value === 'object' ? value : null;
    } catch (err) {
      return null;
    }
  }

  function derive() {
    if (DB) return DB;
    const db = {
      users: new Map(),
      barbers: new Map(),
      places: new Map(),
      products: new Map(),
      shorts: new Map(),
      follows: new Map(),
      acts: new Map(),
      reviews: [],
      comments: new Map(),
      tagok: new Map(),
      groups: new Map(),
      msgs: new Map(),
      busy: new Map(),
      receipts: new Map(),
      reports: [],
      mod: { hidden: new Set(), banned: new Set(), verified: new Set(), kept: new Set(), dismissed: new Set(), featured: new Set(), phash: new Map() },
      shared: new Map(),
      dms: new Map(),
      memo: new Map(),
    };

    // Moderation first (admins only).
    for (const event of STORE.byId.values()) {
      if (event.kind === 30078 && docType(event) === 'mod' && CFG.admins.includes(event.pubkey)) {
        const data = parseJson(event) || {};
        ['hidden', 'banned', 'verified', 'kept', 'dismissed', 'featured'].forEach((key) => {
          (data[key] || []).forEach((value) => db.mod[key].add(value));
        });
        (data.phash || []).forEach((entry) => {  // "<16-hex dHash>@<removed target>"
          const [hash, target] = String(entry).split('@');
          if (/^[0-9a-f]{16}$/.test(hash)) db.mod.phash.set(hash, target || '');
        });
      }
    }

    for (const event of STORE.byId.values()) {
      if (db.mod.banned.has(event.pubkey) && !CFG.admins.includes(event.pubkey)) continue;
      if (event.kind === 1984) {
        db.reports.push({
          id: event.id,
          by: event.pubkey,
          target: tagValue(event, 'o') || tagValue(event, 'e') || tagValue(event, 'p'),
          targetPk: tagValue(event, 'p'),
          reason: (event.tags.find((t) => t[0] === 'p') || [])[2] || tagValue(event, 'l') || 'other',
          note: event.content.slice(0, 300),
          at: event.created_at,
          offline: event.tags.some((t) => t[0] === 'client' && t[1] === 'fade-offline'),
          auto: event.tags.some((t) => t[0] === 'client' && t[1] === 'fade-autoscan'),
          preview: String(tagValue(event, 'preview') || '').slice(0, 140),
        });
        continue;
      }
      if (event.kind === 1059) {
        if (ME.sk) collectDm(db, event);
        continue;
      }
      if (event.kind !== 30078) continue;
      const type = docType(event);
      const id = docId(event);
      if (!type || id === null) continue;
      const isPrivate = event.tags.some((t) => t[0] === 't' && t[1] === PRIVATE_TAG);
      if (isPrivate) {
        const data = unseal(event);
        if (!data) continue;
        const key = `${type}:${id}`;
        if (!db.shared.has(key)) db.shared.set(key, { type, id, sides: new Map() });
        db.shared.get(key).sides.set(event.pubkey, { data, at: event.created_at });
        continue;
      }
      const data = parseJson(event);
      if (!data) continue;
      const pk = event.pubkey;
      switch (type) {
        case 'user':
          if (id === 'me') db.users.set(pk, { ...data, pk, id: `u${pk16(pk)}`, updatedAt: event.created_at });
          break;
        case 'barber':
          if (id === 'me' && !data.deleted) db.barbers.set(`b${pk16(pk)}`, { ...data, id: `b${pk16(pk)}`, ownerPk: pk });
          break;
        case 'place':
          if (id === 'me' && !data.deleted) db.places.set(`p${pk16(pk)}`, { ...data, id: `p${pk16(pk)}`, ownerPk: pk });
          break;
        case 'product': {
          const owned = [`b${pk16(pk)}`, `p${pk16(pk)}`].includes(data.sellerId);
          if (owned && !data.deleted) db.products.set(id, { ...data, id, ownerPk: pk });
          break;
        }
        case 'short': {
          const owned = [`u${pk16(pk)}`, `b${pk16(pk)}`, `p${pk16(pk)}`].includes(data.authorId);
          if (owned && !data.deleted) db.shorts.set(id, { ...data, id, ownerPk: pk, createdAt: data.createdAt || event.created_at });
          break;
        }
        case 'follows':
          if (id === 'me') db.follows.set(pk, (data.following || []).filter((key) => typeof key === 'string').slice(0, 3000));
          break;
        case 'act':
          if (id === 'me') db.acts.set(pk, data);
          break;
        case 'review':
          db.reviews.push({ ...data, id, by: pk, at: event.created_at });
          break;
        case 'comment':
          if (data.shortId && cleanText(data.text)) {
            if (!db.comments.has(data.shortId)) db.comments.set(data.shortId, []);
            db.comments.get(data.shortId).push({ id, by: pk, text: String(data.text).slice(0, 500), at: event.created_at, eventId: event.id });
          }
          break;
        case 'tagok':
          if (id === 'me') db.tagok.set(pk, data.decisions || {});
          break;
        case 'group':
          if (!data.deleted) db.groups.set(id, { ...data, id, ownerPk: pk, official: CFG.admins.includes(pk), createdAt: event.created_at });
          break;
        case 'msg':
          if (data.groupId && cleanText(data.text)) {
            if (!db.msgs.has(data.groupId)) db.msgs.set(data.groupId, []);
            db.msgs.get(data.groupId).push({ id, by: pk, text: String(data.text).slice(0, 1000), t: event.created_at * 1000, eventId: event.id });
          }
          break;
        case 'busy':
          if (id === 'me') db.busy.set(`b${pk16(pk)}`, data.slots || []);
          break;
        case 'receipts':
          if (id === 'me') db.receipts.set(`b${pk16(pk)}`, data.items || []);
          break;
        default:
          break;
      }
    }

    // Drop users who deleted their account.
    for (const [pk, user] of db.users) {
      if (user.deleted) {
        db.users.delete(pk);
        db.barbers.delete(`b${pk16(pk)}`);
        db.places.delete(`p${pk16(pk)}`);
      }
    }

    // Reports -> auto-hide (3 distinct reporters) unless a moderator kept it.
    const reportCounts = new Map();
    db.reports.forEach((report) => {
      if (!report.target || db.mod.dismissed.has(report.id)) return;
      if (!reportCounts.has(report.target)) reportCounts.set(report.target, new Set());
      reportCounts.get(report.target).add(report.by);
    });
    db.autoHidden = new Set();
    reportCounts.forEach((reporters, target) => {
      if (reporters.size >= AUTO_REPORT_HIDE && !db.mod.kept.has(target)) db.autoHidden.add(target);
    });
    db.shorts.forEach((short, id) => {
      const verdict = scanVerdict(cleanScan((short.media || {}).scan));
      if ((verdict === 'review' || verdict === 'block') && !db.mod.kept.has(id)) db.autoHidden.add(id);
      // honest re-uploads of removed media (the declared hash); viewers' own hashes catch dishonest ones
      if (!db.mod.kept.has(id) && blockedMatch((short.media || {}).phash, id, db)) db.autoHidden.add(id);
    });
    db.isHidden = (target) => db.mod.hidden.has(target) || db.autoHidden.has(target);

    DB = db;
    return db;
  }

  function collectDm(db, wrap) {
    let rumor;
    try {
      rumor = NT.nip17.unwrapEvent(wrap, ME.sk);
    } catch (err) {
      return;
    }
    if (!rumor || !rumor.pubkey) return;
    if (db.mod.banned.has(rumor.pubkey)) return;
    const recipients = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    const counterpart = rumor.pubkey === ME.pk ? recipients.find((pk) => pk !== ME.pk) : rumor.pubkey;
    if (!counterpart) return;
    if (!db.dms.has(counterpart)) db.dms.set(counterpart, new Map());
    const key = rumor.id || `${rumor.created_at}:${rumor.content}`;
    db.dms.get(counterpart).set(key, {
      from: rumor.pubkey,
      text: String(rumor.content).slice(0, 2000),
      t: rumor.created_at * 1000,
    });
  }

  // ---------------------------------------------------------------------------
  // Lookups on the derived database
  // ---------------------------------------------------------------------------
  function userIdOf(pk) {
    return `u${pk16(pk)}`;
  }

  function pkOfId(id) {
    const db = derive();
    if (!id) return null;
    const prefix = id.slice(1);
    for (const pk of db.users.keys()) {
      if (pk.startsWith(prefix)) return pk;
    }
    const barber = db.barbers.get(id) || db.places.get(id);
    return barber ? barber.ownerPk : null;
  }

  function me() {
    return ME.pk ? derive().users.get(ME.pk) || null : null;
  }

  function barberDoc(id) {
    const barber = derive().barbers.get(id);
    if (!barber) fail(404, 'barber not found');
    return barber;
  }

  function placeDoc(id) {
    const place = derive().places.get(id);
    if (!place) fail(404, 'place not found');
    return place;
  }

  function placeApproves(place, barber) {
    return place.ownerPk === barber.ownerPk || (place.barbers || []).includes(barber.id);
  }

  function approvedSchedule(barber) {
    const db = derive();
    return (barber.schedule || []).filter((shift) => {
      const place = db.places.get(shift.placeId);
      return place && placeApproves(place, barber);
    });
  }

  function followerCounts() {
    return memo('followerCounts', computeFollowerCounts);
  }

  function computeFollowerCounts() {
    const counts = {};
    derive().follows.forEach((keys) => {
      keys.forEach((key) => {
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }

  function verifiedReviews() {
    return memo('verifiedReviews', computeVerifiedReviews);
  }

  function computeVerifiedReviews() {
    const db = derive();
    return db.reviews.filter((review) => {
      if (!review.bookingId || !review.barberId) return false;
      if (db.isHidden(review.id)) return false;
      const receipts = db.receipts.get(review.barberId) || [];
      const token = syncHash(review.bookingId, review.by);
      return receipts.some((item) => item.h === token);
    });
  }

  // ---------------------------------------------------------------------------
  // Shared records: bookings, orders, commissions, rent statements
  // ---------------------------------------------------------------------------
  function sharedRecords(type) {
    return [...derive().shared.values()].filter((record) => record.type === type);
  }

  function bookingParties(record) {
    let customer = null;
    record.sides.forEach((side, pk) => {
      if (side.data.role === 'customer') customer = { pk, ...side };
    });
    if (!customer) return null;
    const db = derive();
    const barber = db.barbers.get(customer.data.barberId);
    if (!barber) return null;
    const barberSide = record.sides.get(barber.ownerPk);
    return { customer, barber, barberSide: barberSide && barberSide.data.role === 'barber' ? barberSide : null };
  }

  function bookingFrom(record) {
    const parties = bookingParties(record);
    if (!parties) return null;
    const { customer, barber, barberSide } = parties;
    const c = customer.data;
    const b = barberSide ? barberSide.data : {};
    const db = derive();
    const place = db.places.get(c.placeId);
    const tz = place ? place.tz : 'UTC';
    const startMs = startUtcMs(c.date, c.time, tz || 'UTC');
    const endMs = startMs + (c.mins || 30) * 60000;
    const decidedRev = b.rev === undefined ? -1 : b.rev;
    const currentRev = c.rev || 0;
    const confirmed = (b.status === 'confirmed' || b.status === 'completed') && decidedRev >= currentRev;
    const declined = b.status === 'declined' && decidedRev >= currentRev;
    const noShow = b.status === 'noshow';
    let status = 'upcoming';
    if (c.cancelled || declined) status = 'cancelled';
    else if (b.status === 'completed' || noShow) status = 'completed';
    else if (confirmed && Date.now() > endMs + 2 * 3600 * 1000) status = 'completed';
    const received = new Set(b.received || []);
    const payments = (c.payments || []).map((p) => ({ ...p, received: received.has(p.id) }));
    const paidReceived = round2(payments.filter((p) => p.kind !== 'tip' && p.received).reduce((sum, p) => sum + p.amount, 0));
    const paidClaimed = round2(payments.filter((p) => p.kind !== 'tip').reduce((sum, p) => sum + p.amount, 0));
    const total = c.quote ? c.quote.total : c.price;
    const rating = c.rating || null;
    return {
      id: record.id,
      userId: userIdOf(customer.pk),
      customerPk: customer.pk,
      customerName: c.customerName || 'Client',
      customerHue: c.customerHue,
      barberId: c.barberId,
      barberPk: barber.ownerPk,
      placeId: c.placeId,
      serviceId: c.serviceId,
      serviceName: c.serviceName,
      mins: c.mins,
      date: c.date,
      time: c.time,
      status,
      confirmed: confirmed && !c.cancelled,
      declined,
      declineReason: declined ? b.reason || '' : '',
      noShow,
      barberCompleted: b.status === 'completed',
      rev: currentRev,
      quote: c.quote,
      payMode: c.payMode,
      paidNow: paidClaimed,
      paidReceived,
      payLater: round2(Math.max(0, total - paidClaimed)),
      payments,
      refunds: b.refunds || [],
      method: (payments[0] || {}).rail || (c.payMode === 'shop' ? 'cash' : 'none'),
      methodLabel: payments.length ? payments.map((p) => railLabel(p.rail)).join(' + ') : c.payMode === 'shop' ? 'Pay at the shop' : 'Not paid yet',
      rated: !!rating,
      rB: rating ? rating.rB : undefined,
      rP: rating ? rating.rP : undefined,
      tip: rating ? rating.tip || 0 : 0,
      review: rating ? rating.review || '' : '',
      notes: c.notes || '',
      style: c.style || 'fade',
      refShortId: c.refShortId || null,
      createdAt: c.createdAt || customer.at,
      startMs,
      endMs,
      cancelledAt: c.cancelled ? c.cancelled.at : null,
      refundDue: c.cancelled && c.cancelled.refundDue ? c.cancelled.refundDue : 0,
    };
  }

  function allBookings() {
    return memo('bookings', () => sharedRecords('booking').map(bookingFrom).filter(Boolean));
  }

  function orderFrom(record) {
    let buyer = null;
    record.sides.forEach((side, pk) => {
      if (side.data.role === 'buyer') buyer = { pk, ...side };
    });
    if (!buyer) return null;
    const o = buyer.data;
    const sellerSide = record.sides.get(o.sellerPk);
    const s = sellerSide && sellerSide.data.role === 'seller' ? sellerSide.data : {};
    const received = new Set(s.received || []);
    const payments = (o.payments || []).map((p) => ({ ...p, received: received.has(p.id) }));
    return {
      id: record.id,
      userId: userIdOf(buyer.pk),
      buyerPk: buyer.pk,
      buyerName: o.buyerName,
      sellerPk: o.sellerPk,
      sellerType: o.sellerType,
      sellerId: o.sellerId,
      items: o.items || [],
      total: o.total,
      delivery: o.delivery,
      address: o.address || '',
      date: new Date((o.createdAt || buyer.at) * 1000).toISOString(),
      refShortId: o.refShortId || null,
      status: o.cancelled ? 'cancelled' : s.status || 'placed',
      payments,
      paid: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
    };
  }

  function allOrders() {
    return memo('orders', () => sharedRecords('order').map(orderFrom).filter(Boolean));
  }

  function commissionFrom(record) {
    let payer = null;
    let creatorSide = null;
    record.sides.forEach((side, pk) => {
      if (side.data.role === 'payer') payer = { pk, ...side };
      if (side.data.role === 'creator') creatorSide = { pk, ...side };
    });
    if (!payer) return null;
    const c = payer.data;
    const db = derive();
    const payerDoc = c.payerType === 'barber' ? db.barbers.get(c.payerId) : db.places.get(c.payerId);
    if (!payerDoc || payerDoc.ownerPk !== payer.pk) return null;
    const received = creatorSide && creatorSide.pk === c.creatorPk ? !!creatorSide.data.received : false;
    let statusValue = c.status;
    if (statusValue === 'earned' && c.paid) statusValue = 'paid';
    return {
      id: record.id,
      creatorId: userIdOf(c.creatorPk),
      creatorPk: c.creatorPk,
      shortId: c.shortId,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      payerType: c.payerType,
      payerId: c.payerId,
      payerPk: payer.pk,
      kind: c.kind,
      rate: c.rate,
      base: c.base,
      amount: c.amount,
      status: statusValue,
      paid: c.paid || null,
      received,
      createdAt: c.createdAt || payer.at,
    };
  }

  function allCommissions() {
    return memo('commissions', () => sharedRecords('cm').map(commissionFrom).filter(Boolean));
  }

  function rentFrom(record) {
    let barberSide = null;
    record.sides.forEach((side, pk) => {
      if (side.data.role === 'renter') barberSide = { pk, ...side };
    });
    if (!barberSide) return null;
    const r = barberSide.data;
    const db = derive();
    const place = db.places.get(r.placeId);
    const ownerSide = place ? record.sides.get(place.ownerPk) : null;
    return {
      id: record.id,
      week: r.week,
      placeId: r.placeId,
      barberId: r.barberId,
      barberPk: barberSide.pk,
      amount: r.amount,
      lines: r.lines || [],
      payment: r.payment || null,
      confirmed: !!(ownerSide && ownerSide.data.role === 'landlord' && ownerSide.data.received),
      createdAt: r.createdAt || barberSide.at,
    };
  }

  function allRent() {
    return memo('rent', () => sharedRecords('rent').map(rentFrom).filter(Boolean));
  }

  // ---------------------------------------------------------------------------
  // Pricing and slots
  // ---------------------------------------------------------------------------
  function quote(price, place, payMode) {
    const service = round2(price);
    const facility = round2(service * (place.fee || 0) / 100);
    const gross = round2(service + facility);
    const deposit = round2(facility + service * DEPOSIT_PCT);
    let dueNow = payMode === 'full' ? gross : deposit;
    if (payMode === 'shop') dueNow = 0;
    return {
      price, discount: 0, service, facility, facilityPct: place.fee || 0, bookingFee: 0, gross, deposit,
      pointsUsed: 0, pointsValue: 0, total: gross, dueNow, payLater: round2(gross - dueNow), payMode,
      toBarber: service, toPlace: facility, toPlatform: 0,
    };
  }

  function slots(barber, key, mins, excludeId) {
    const db = derive();
    const busy = (db.busy.get(barber.id) || []).filter((slot) => slot.date === key && slot.id !== syncHash(excludeId || '-', 'busy'));
    const mine = allBookings().filter((b) => b.barberId === barber.id && b.date === key && b.status === 'upcoming' && b.id !== excludeId);
    const groups = [];
    approvedSchedule(barber)
      .filter((shift) => shift.dow === dowOf(key))
      .sort((a, b) => a.from - b.from)
      .forEach((shift) => {
        const place = db.places.get(shift.placeId);
        const now = placeNow(place);
        const list = [];
        for (let t = shift.from; t + mins / 60 <= shift.to + 1e-9; t += 0.5) {
          let taken = busy.some((slot) => overlaps(slot.time, slot.mins, t, mins));
          if (mine.some((b) => overlaps(b.time, b.mins, t, mins))) taken = true;
          if (key < now.key || (key === now.key && t <= now.hour + 0.25)) taken = true;
          list.push({ t, taken });
        }
        groups.push({ placeId: place.id, from: shift.from, to: shift.to, slots: list, live: true });
      });
    return groups;
  }

  function validateSlot(barber, service, key, t, placeId, excludeId) {
    const groups = slots(barber, key, service.mins, excludeId);
    const group = groups.find((g) => g.placeId === placeId);
    if (!group) fail(409, `${barber.name} is not working there on ${key}`);
    const slot = group.slots.find((s) => Math.abs(s.t - t) < 1e-9);
    if (!slot) fail(409, 'That time is outside the barber’s shift');
    if (slot.taken) fail(409, 'Sorry — that slot was just taken. Pick another time.');
    const place = placeDoc(placeId);
    const lastKey = addDaysKey(placeNow(place).key, BOOKING_WINDOW_DAYS);
    if (key > lastKey) fail(400, `Bookings open ${BOOKING_WINDOW_DAYS} days ahead`);
    const clash = allBookings().find((b) => b.customerPk === ME.pk && b.status === 'upcoming' && b.date === key
      && b.id !== excludeId && overlaps(b.time, b.mins, t, service.mins));
    if (clash) fail(409, 'You already have a booking at that time');
  }

  // ---------------------------------------------------------------------------
  // Payments (money moves directly between people; Fade only records it)
  // ---------------------------------------------------------------------------
  function railLabel(rail) {
    return {
      paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', revolut: 'Revolut', wise: 'Wise',
      lightning: 'Lightning ⚡', stripe: 'Card (Stripe link)', bank: 'Bank transfer', qris: 'QRIS',
      ewallet: 'E-wallet', cash: 'Cash at the shop', none: 'Not paid',
    }[rail] || rail;
  }

  function cleanPay(raw) {
    const pay = {};
    if (!raw || typeof raw !== 'object') return pay;
    const handle = (value, pattern, max = 60) => {
      const v = String(value || '').trim().replace(/^@/, '').replace(/^\$/, '');
      return v && pattern.test(v) && v.length <= max ? v : '';
    };
    pay.paypal = handle(raw.paypal, /^[A-Za-z0-9._-]+$/);
    pay.venmo = handle(raw.venmo, /^[A-Za-z0-9._-]+$/);
    pay.cashapp = handle(raw.cashapp, /^[A-Za-z0-9._-]+$/);
    pay.revolut = handle(raw.revolut, /^[A-Za-z0-9._-]+$/);
    pay.wise = handle(raw.wise, /^[A-Za-z0-9._-]+$/);
    const ln = String(raw.lightning || '').trim().toLowerCase();
    pay.lightning = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(ln) ? ln : '';
    const stripe = String(raw.stripe || '').trim();
    pay.stripe = /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com|donate\.stripe\.com)\/[A-Za-z0-9_/-]+$/.test(stripe) ? stripe : '';
    pay.bank = String(raw.bank || '').trim().slice(0, 200);
    pay.ewallet = String(raw.ewallet || '').trim().slice(0, 120);
    const qris = String(raw.qris || '').trim();
    pay.qris = /^https?:\/\//.test(qris) ? qris.slice(0, 400) : '';
    pay.cash = raw.cash !== false;
    pay.currency = /^[A-Z]{3}$/.test(raw.currency || '') ? raw.currency : 'USD';
    Object.keys(pay).forEach((key) => {
      if (pay[key] === '') delete pay[key];
    });
    return pay;
  }

  function payOptionsFor(pk, amount, note) {
    const user = derive().users.get(pk);
    const pay = (user && user.pay) || {};
    const amt = round2(amount || 0);
    const enc = encodeURIComponent;
    const options = [];
    if (pay.lightning) options.push({ rail: 'lightning', label: railLabel('lightning'), handle: pay.lightning, auto: true });
    if (pay.paypal) options.push({ rail: 'paypal', label: 'PayPal', handle: pay.paypal, url: `https://paypal.me/${enc(pay.paypal)}/${amt}${pay.currency || 'USD'}` });
    if (pay.venmo) options.push({ rail: 'venmo', label: 'Venmo', handle: `@${pay.venmo}`, url: `https://venmo.com/${enc(pay.venmo)}?txn=pay&amount=${amt}&note=${enc(note || 'Fade')}` });
    if (pay.cashapp) options.push({ rail: 'cashapp', label: 'Cash App', handle: `$${pay.cashapp}`, url: `https://cash.app/$${enc(pay.cashapp)}/${amt}` });
    if (pay.revolut) options.push({ rail: 'revolut', label: 'Revolut', handle: pay.revolut, url: `https://revolut.me/${enc(pay.revolut)}` });
    if (pay.wise) options.push({ rail: 'wise', label: 'Wise', handle: pay.wise, url: `https://wise.com/pay/me/${enc(pay.wise)}` });
    if (pay.stripe) options.push({ rail: 'stripe', label: 'Card (Stripe link)', handle: 'Secure card checkout', url: pay.stripe });
    if (pay.qris) options.push({ rail: 'qris', label: 'QRIS', handle: 'Scan the QR code', image: pay.qris });
    if (pay.bank) options.push({ rail: 'bank', label: 'Bank transfer', handle: pay.bank });
    if (pay.ewallet) options.push({ rail: 'ewallet', label: 'E-wallet', handle: pay.ewallet });
    return { options, currency: pay.currency || 'USD', acceptsCash: pay.cash !== false };
  }

  async function btcUsd() {
    const cached = JSON.parse(sessionStorage.getItem('fade.btcusd') || 'null');
    if (cached && Date.now() - cached.at < 5 * 60000) return cached.price;
    const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    const data = await res.json();
    const price = Number(data.data.amount);
    if (!(price > 0)) throw new Error('No BTC price');
    sessionStorage.setItem('fade.btcusd', JSON.stringify({ at: Date.now(), price }));
    return price;
  }

  async function lnInvoice(address, usd, comment) {
    const [name, domain] = address.split('@');
    const meta = await (await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`)).json();
    if (meta.tag !== 'payRequest' || !meta.callback) throw new Error('That Lightning address can’t receive payments');
    const sats = Math.max(1, Math.round((usd / (await btcUsd())) * 1e8));
    const msats = sats * 1000;
    if (msats < meta.minSendable || msats > meta.maxSendable) throw new Error('Amount is outside what this wallet accepts');
    const url = new URL(meta.callback);
    url.searchParams.set('amount', String(msats));
    if (comment && meta.commentAllowed) url.searchParams.set('comment', comment.slice(0, meta.commentAllowed));
    const invoice = await (await fetch(url)).json();
    if (!invoice.pr) throw new Error(invoice.reason || 'No invoice returned');
    return { pr: invoice.pr, verify: invoice.verify || null, sats, domain };
  }

  async function lnCheck(verifyUrl) {
    const res = await fetch(verifyUrl, { cache: 'no-store' });
    const data = await res.json();
    return { settled: !!data.settled, preimage: data.preimage || null };
  }

  // ---------------------------------------------------------------------------
  // Push notifications (ntfy)
  // ---------------------------------------------------------------------------
  function topicOf(pk) {
    const user = derive().users.get(pk);
    return user && /^[A-Za-z0-9_-]{8,64}$/.test(user.notify || '') ? user.notify : null;
  }

  function appLink(path) {
    const base = location.href.split('#')[0];
    return `${base}#${path}`;
  }

  // Publish as JSON (UTF-8 safe: titles may contain emoji, which HTTP headers can't carry).
  // `seq` is an ntfy sequence id: a later push with the same id replaces the earlier one on the phone
  // (or the scheduled one on the server), and recallPush() deletes it from every device.
  function seqId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || null;
  }

  // ntfy keeps message text in its cache (~12 h on ntfy.sh) even after a recall, and has no end-to-end
  // encryption, so pushes say only what kind of thing happened unless the recipient opted into full previews.
  const PRIVATE_LABELS = {
    bk: 'Booking update', rm: 'Appointment reminder', dm: 'New message', cm: 'New comment',
    rp: 'New report to review', tg: 'New tag request', pay: 'Payment update',
  };

  function privateLabel(seq) {
    return PRIVATE_LABELS[String(seq || '').split('-')[0]] || 'New notification';
  }

  async function push(pk, title, body, path, at, seq) {
    const topic = pk ? topicOf(pk) : null;
    if (!topic) return false;
    const recipient = derive().users.get(pk) || {};
    const privatePreview = recipient.pushPreview !== 'full'; // full previews are an explicit opt-in
    const payload = {
      topic,
      title: privatePreview ? 'Fade' : String(title).slice(0, 120),
      message: privatePreview ? `${privateLabel(seq)} — open Fade to see it` : String(body || '').slice(0, 400),
      tags: ['scissors'],
    };
    if (path) payload.click = appLink(path);
    if (at) payload.delay = String(Math.floor(at / 1000));
    if (seqId(seq)) payload.sequence_id = seqId(seq);
    try {
      const res = await fetch(CFG.ntfy.replace(/\/+$/, ''), { method: 'POST', body: JSON.stringify(payload) });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  async function recallPush(pk, seq) {
    const topic = pk ? topicOf(pk) : null;
    if (!topic || !seqId(seq)) return false;
    try {
      const res = await fetch(`${CFG.ntfy.replace(/\/+$/, '')}/${topic}/${seqId(seq)}`, { method: 'DELETE' });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  let notifySource = null;
  const notifyListeners = new Set();

  function listenNotifications() {
    if (notifySource) notifySource.close();
    notifySource = null;
    const topic = ME.pk ? topicOf(ME.pk) : null;
    if (!topic || typeof EventSource === 'undefined' || PARAMS.get('sse') === '0') return;
    notifySource = new EventSource(`${CFG.ntfy}/${topic}/sse`);
    notifySource.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data);
        if (data.event !== 'message') return;
        notifyListeners.forEach((fn) => fn(data));
      } catch (err) {
        // ignore
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Local (per-device) memory: processed decisions, scheduled reminders
  // ---------------------------------------------------------------------------
  function local() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_STORE) || '{}');
    } catch (err) {
      return {};
    }
  }

  function setLocal(patch) {
    localStorage.setItem(LOCAL_STORE, JSON.stringify({ ...local(), ...patch }));
  }

  // ---------------------------------------------------------------------------
  // Background duties after each sync (barber auto-confirm, commissions, receipts, reminders)
  // ---------------------------------------------------------------------------
  let duties = false;
  let dutiesAgain = false;

  function afterDerive() {
    if (!ME.pk || !synced) return;
    if (duties) {
      dutiesAgain = true;
      return;
    }
    duties = true;
    dutiesAgain = false;
    Promise.resolve()
      .then(runDuties)
      .catch((err) => console.warn('Fade duties', err))
      .finally(() => {
        duties = false;
        if (dutiesAgain) setTimeout(afterDerive, 500);
      });
  }

  const LN_CHECKED = new Map();

  async function verifyLightning(bookings) {
    const myUser = me() || {};
    const domain = ((myUser.pay || {}).lightning || '').split('@')[1];
    if (!domain) return;
    for (const booking of bookings) {
      const unconfirmed = booking.payments.filter((p) => p.rail === 'lightning' && p.verify && !p.received);
      for (const payment of unconfirmed) {
        let host = '';
        try {
          host = new URL(payment.verify).hostname;
        } catch (err) {
          continue;
        }
        if (host !== domain && !host.endsWith(`.${domain}`)) continue;
        if (Date.now() - (LN_CHECKED.get(payment.id) || 0) < 20000) continue;
        LN_CHECKED.set(payment.id, Date.now());
        const result = await lnCheck(payment.verify).catch(() => ({ settled: false }));
        if (result.settled) await confirmReceived(booking.id, { paymentId: payment.id });
      }
    }
  }

  async function runDuties() {
    const db = derive();
    const myBarberId = `b${pk16(ME.pk)}`;
    const myPlaceId = `p${pk16(ME.pk)}`;
    const barber = db.barbers.get(myBarberId);
    const place = db.places.get(myPlaceId);
    const bookings = allBookings();

    if (barber) {
      const settings = barber.settings || {};
      const records = sharedRecords('booking');
      const mineAsBarber = bookings.filter((b) => b.barberPk === ME.pk);
      // 1. auto-confirm or decline new / rescheduled requests (oldest first)
      const pending = mineAsBarber
        .filter((b) => b.status === 'upcoming' && !b.confirmed && !b.declined)
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const booking of pending) {
        if (settings.autoAccept === false) continue;
        const record = records.find((r) => r.id === booking.id);
        const side = record.sides.get(ME.pk);
        if (side && side.data.rev >= booking.rev) continue;
        const verdict = checkBookingForBarber(barber, booking, mineAsBarber);
        await putShared('booking', booking.id, {
          role: 'barber', status: verdict.ok ? 'confirmed' : 'declined', rev: booking.rev,
          reason: verdict.reason || '', received: side ? side.data.received || [] : [], at: nowSec(),
        }, [booking.customerPk, placeOwner(booking.placeId)], { wait: false });
        push(booking.customerPk, verdict.ok ? 'Booking confirmed ✂️' : 'Booking declined',
          verdict.ok ? `${barber.name} confirmed ${booking.serviceName} on ${booking.date}` : verdict.reason, '/bookings', null, `bk-${booking.id}-c`);
      }
      // 1b. confirm Lightning payments straight from my wallet provider (LUD-21 verify)
      await verifyLightning(mineAsBarber);
      // 2. public busy slots (opaque) and receipts for completed cuts
      const busySlots = mineAsBarber
        .filter((b) => b.status === 'upcoming' && b.confirmed)
        .map((b) => ({ id: syncHash(b.id, 'busy'), date: b.date, time: b.time, mins: b.mins }))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const currentBusy = JSON.stringify(db.busy.get(myBarberId) || []);
      if (JSON.stringify(busySlots) !== currentBusy) await putDoc('busy', 'me', { slots: busySlots }, [], { wait: false });
      const receiptItems = mineAsBarber
        .filter((b) => b.status === 'completed' && !b.noShow)
        .map((b) => ({ h: syncHash(b.id, b.customerPk), d: b.date }))
        .sort((a, b) => a.h.localeCompare(b.h));
      const currentReceipts = JSON.stringify(db.receipts.get(myBarberId) || []);
      if (JSON.stringify(receiptItems) !== currentReceipts) await putDoc('receipts', 'me', { items: receiptItems }, [], { wait: false });
    }

    // 3. commissions I owe as a tagged barber or shop
    await syncCommissions(bookings, barber, place);

    // 4. reminders for my confirmed bookings (scheduled push, up to 3 days ahead). Each is scheduled with
    //    sequence id rm-<booking>: a reschedule replaces it, a cancellation/decline deletes it on the server.
    const reminded = local().reminded || {};
    let changed = false;
    const live = new Map(bookings.filter((b) => b.customerPk === ME.pk && b.status === 'upcoming' && b.confirmed).map((b) => [b.id, b]));
    for (const key of Object.keys(reminded)) {
      const [bookingId, rev] = key.split(':');
      const current = live.get(bookingId);
      if (!current || String(current.rev) !== rev) {
        if (!current) await recallPush(ME.pk, `rm-${bookingId}`);
        delete reminded[key];
        changed = true;
      }
    }
    for (const booking of live.values()) {
      const key = `${booking.id}:${booking.rev}`;
      const at = booking.startMs - 2 * 3600 * 1000;
      if (reminded[key] || at < Date.now() || at > Date.now() + 70 * 3600 * 1000) continue;
      const b = db.barbers.get(booking.barberId);
      const ok = await push(ME.pk, 'Your cut is in 2 hours', `${booking.serviceName} with ${b ? b.name : 'your barber'}`, '/bookings', at, `rm-${booking.id}`);
      if (ok) {
        reminded[key] = true;
        changed = true;
      }
    }
    if (changed) setLocal({ reminded });
  }

  function placeOwner(placeId) {
    const place = derive().places.get(placeId);
    return place ? place.ownerPk : null;
  }

  function checkBookingForBarber(barber, booking, all) {
    const db = derive();
    const service = (barber.services || []).find((s) => s.id === booking.serviceId);
    if (!service) return { ok: false, reason: 'That service is no longer offered' };
    const place = db.places.get(booking.placeId);
    if (!place) return { ok: false, reason: 'That shop is no longer on Fade' };
    const shift = approvedSchedule(barber).find((s) => s.placeId === booking.placeId && s.dow === dowOf(booking.date)
      && booking.time >= s.from - 1e-9 && booking.time + booking.mins / 60 <= s.to + 1e-9);
    if (!shift) return { ok: false, reason: `${barber.name} isn’t working at ${place.name} then anymore` };
    if (booking.startMs < Date.now()) return { ok: false, reason: 'That time has already passed' };
    const clash = all.find((other) => other.id !== booking.id && other.status === 'upcoming' && other.confirmed
      && other.date === booking.date && overlaps(other.time, other.mins, booking.time, booking.mins));
    if (clash) return { ok: false, reason: 'Someone booked that slot first — please pick another time' };
    return { ok: true };
  }

  async function syncCommissions(bookings, barber, place) {
    const db = derive();
    const existing = new Map(allCommissions().filter((c) => c.payerPk === ME.pk).map((c) => [c.id, c]));
    const targets = [];
    if (barber) targets.push({ type: 'barber', id: barber.id });
    if (place) targets.push({ type: 'place', id: place.id });
    if (!targets.length) return;
    for (const booking of bookings) {
      if (!booking.refShortId) continue;
      const short = db.shorts.get(booking.refShortId);
      if (!short || short.authorType !== 'user' || short.ownerPk === booking.customerPk) continue;
      for (const target of targets) {
        const relevant = (target.type === 'barber' && booking.barberId === target.id) || (target.type === 'place' && booking.placeId === target.id);
        if (!relevant) continue;
        const tag = approvedTag(short, target.type, target.id);
        if (!tag) continue;
        const id = `${booking.id}-${target.type}`;
        let statusValue = 'pending';
        if (booking.status === 'cancelled' || booking.noShow) statusValue = 'void';
        else if (booking.barberCompleted || (booking.confirmed && Date.now() > booking.endMs + AUTO_EARN_HOURS * 3600 * 1000)) statusValue = 'earned';
        const rate = COMMISSION_RATES[tag.kind];
        const base = booking.quote ? booking.quote.service : 0;
        const prev = existing.get(id);
        if (prev && prev.status === statusValue && prev.amount === round2(base * rate)) continue;
        if (prev && prev.status === 'paid') continue;
        await putShared('cm', id, {
          role: 'payer', creatorPk: short.ownerPk, shortId: short.id, sourceType: 'booking', sourceId: booking.id,
          payerType: target.type, payerId: target.id, kind: tag.kind, rate, base, amount: round2(base * rate),
          status: statusValue, paid: prev ? prev.paid : null, createdAt: prev ? prev.createdAt : nowSec(),
        }, [short.ownerPk], { wait: false });
        if (!prev) push(short.ownerPk, 'New commission 💸', `Someone booked from your short (${tag.kind})`, '/creator');
      }
    }
  }

  function approvedTag(short, type, id) {
    return shortTags(short).find((t) => t.type === type && t.id === id && t.status === 'approved') || null;
  }

  function shortTags(short) {
    const db = derive();
    return (short.tags || []).slice(0, 4).map((tag) => {
      const target = tag.type === 'barber' ? db.barbers.get(tag.id) : db.places.get(tag.id);
      let statusValue = 'pending';
      if (!target) statusValue = 'declined';
      else if (target.ownerPk === short.ownerPk) statusValue = 'approved';
      else {
        const decision = (db.tagok.get(target.ownerPk) || {})[`${short.id}|${tag.type}|${tag.id}`];
        if (decision) statusValue = decision;
      }
      return { type: tag.type, id: tag.id, kind: COMMISSION_RATES[tag.kind] ? tag.kind : 'featured', status: statusValue };
    });
  }

  // ---------------------------------------------------------------------------
  // Snapshot in the same shape as server.py's GET /api/state
  // ---------------------------------------------------------------------------
  function statsFor(barberId) {
    const db = derive();
    const receipts = db.receipts.get(barberId) || [];
    const reviews = verifiedReviews().filter((r) => r.barberId === barberId);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const period = (fromKey, fromSec) => {
      const list = reviews.filter((r) => !fromSec || r.at >= fromSec);
      const avg = list.length ? round2(list.reduce((s, r) => s + r.rB, 0) / list.length) : 5;
      return {
        cuts: receipts.filter((item) => !fromKey || item.d >= fromKey).length,
        tips: round2(list.reduce((s, r) => s + (r.tip || 0), 0)),
        rating: avg,
        reviews: list.length,
      };
    };
    return {
      week: period(weekAgo, nowSec() - 7 * 86400),
      month: period(monthAgo, nowSec() - 30 * 86400),
      all: period(null, 0),
    };
  }

  function placeStats(placeId) {
    const reviews = verifiedReviews().filter((r) => r.placeId === placeId);
    const avg = (list) => (list.length ? round2(list.reduce((s, r) => s + r.rP, 0) / list.length) : 5);
    const since = (days) => reviews.filter((r) => r.at >= nowSec() - days * 86400);
    return {
      week: { visits: since(7).length, rating: avg(since(7)) },
      month: { visits: since(30).length, rating: avg(since(30)) },
      all: { visits: reviews.length, rating: avg(reviews) },
      rating: avg(reviews),
      reviews: reviews.length,
    };
  }

  function publicBarber(barber, counts) {
    const db = derive();
    const stats = statsFor(barber.id);
    const owner = db.users.get(barber.ownerPk) || {};
    const approved = approvedSchedule(barber);
    return {
      id: barber.id,
      ownerId: userIdOf(barber.ownerPk),
      ownerPk: barber.ownerPk,
      name: barber.name || owner.name || 'Barber',
      handle: barber.handle || owner.handle || barber.id,
      title: barber.title || 'Barber',
      city: barber.city || '',
      hue: barber.hue !== undefined ? barber.hue : fnvHue(barber.id),
      verified: db.mod.verified.has(barber.id),
      years: barber.years || 0,
      followers: counts[`barber:${barber.id}`] || 0,
      langs: barber.langs || ['EN'],
      rating: stats.all.rating,
      reviews: stats.all.reviews,
      bio: barber.bio || '',
      tags: (barber.tags || []).slice(0, 8),
      // The owner sees every shift (pending ones flagged); everyone else only bookable shifts.
      schedule: barber.ownerPk === ME.pk ? (barber.schedule || []).map((s) => ({ ...s, pending: !approved.includes(s) })) : approved,
      schedulePending: (barber.schedule || []).filter((s) => !approved.includes(s)),
      services: (barber.services || []).slice(0, 20),
      portfolio: (barber.portfolio || []).slice(0, 40),
      stats,
      settings: barber.settings || {},
      network: true,
    };
  }

  function publicPlace(place, counts) {
    const stats = placeStats(place.id);
    return {
      id: place.id,
      ownerId: userIdOf(place.ownerPk),
      ownerPk: place.ownerPk,
      name: place.name || 'Barbershop',
      short: place.short || (place.name || 'Shop').split(' ')[0].slice(0, 12),
      area: place.area || '',
      city: place.city || '',
      address: place.address || '',
      lat: Number(place.lat) || 0,
      lng: Number(place.lng) || 0,
      tz: safeTz(place.tz || 'UTC'),
      tier: TIERS[place.tier] ? place.tier : 'standard',
      fee: Number.isFinite(place.fee) ? place.fee : TIERS[place.tier] || 3,
      chairs: place.chairs || 1,
      rent: place.rent || 0,
      kitFee: place.kitFee || 0,
      rating: stats.rating,
      reviews: stats.reviews,
      hue: place.hue !== undefined ? place.hue : fnvHue(place.id),
      hours: place.hours || '',
      amenities: (place.amenities || []).slice(0, 10),
      stats: { week: stats.week, month: stats.month, all: stats.all },
      followers: counts[`place:${place.id}`] || 0,
      barbers: place.barbers || [],
      requests: [],
      personal: !!place.personal,
      verified: derive().mod.verified.has(place.id),
      network: true,
    };
  }

  function publicShort(short) {
    const db = derive();
    let likes = 0;
    let views = 0;
    let shares = 0;
    let likedByMe = false;
    db.acts.forEach((act, pk) => {
      if ((act.liked || []).includes(short.id)) {
        likes++;
        if (pk === ME.pk) likedByMe = true;
      }
      if ((act.viewed || []).includes(short.id)) views++;
      if ((act.shared || []).includes(short.id)) shares++;
    });
    const conversions = memo('conversions', () => {
      const counts = new Map();
      allCommissions().forEach((c) => counts.set(c.shortId, (counts.get(c.shortId) || 0) + 1));
      return counts;
    }).get(short.id) || 0;
    const comments = (db.comments.get(short.id) || []).filter((c) => !db.isHidden(c.id));
    return {
      id: short.id,
      authorType: short.authorType,
      authorId: short.authorId,
      userId: userIdOf(short.ownerPk),
      ownerPk: short.ownerPk,
      caption: String(short.caption || '').slice(0, 300),
      category: short.category,
      tags: shortTags(short),
      sponsored: !!short.sponsored,
      media: short.media || {},
      likes,
      views,
      shares,
      conversions,
      comments: comments.length,
      likedByMe,
      createdAt: short.createdAt,
      hidden: db.isHidden(short.id),
    };
  }

  function threadsFor(user) {
    const db = derive();
    const threads = [];
    const myBarberId = `b${pk16(ME.pk)}`;
    db.dms.forEach((messages, counterpart) => {
      const list = [...messages.values()].sort((a, b) => a.t - b.t).slice(-300);
      const theirBarber = db.barbers.get(`b${pk16(counterpart)}`);
      const them = db.users.get(counterpart) || {};
      const iAmBarberHere = !!db.barbers.get(myBarberId) && !theirBarber;
      threads.push({
        id: `dm_${pk16(counterpart)}`,
        type: 'dm',
        counterpartPk: counterpart,
        userId: iAmBarberHere ? userIdOf(counterpart) : user.id,
        customerName: iAmBarberHere ? them.name || 'Client' : user.name,
        customerHue: iAmBarberHere ? them.hue : user.hue,
        barberId: iAmBarberHere ? myBarberId : theirBarber ? theirBarber.id : null,
        peerName: them.name || 'Fade user',
        peerHue: them.hue,
        messages: list.map((m) => ({
          from: m.from === ME.pk ? `u:${user.id}` : iAmBarberHere ? `u:${userIdOf(m.from)}` : theirBarber ? theirBarber.id : `u:${userIdOf(m.from)}`,
          name: m.from === ME.pk ? user.name : them.name || 'Fade user',
          text: m.text,
          t: m.t,
        })),
      });
    });
    const joined = new Set(user.joined || []);
    db.groups.forEach((group) => {
      if (db.isHidden(group.id)) return;
      const messages = (db.msgs.get(group.id) || [])
        .filter((m) => !db.isHidden(m.id))
        .sort((a, b) => a.t - b.t)
        .slice(-150)
        .map((m) => {
          const author = db.users.get(m.by) || {};
          return { from: `u:${userIdOf(m.by)}`, name: author.name || 'Fade user', text: m.text, t: m.t, id: m.id };
        });
      const members = [...db.users.values()].filter((u) => (u.joined || []).includes(group.id)).length;
      threads.push({
        id: group.id,
        type: 'group',
        title: String(group.title || 'Community').slice(0, 60),
        desc: String(group.desc || '').slice(0, 200),
        hue: group.hue !== undefined ? group.hue : fnvHue(group.id),
        members,
        official: group.official,
        ownerId: userIdOf(group.ownerPk),
        joined: joined.has(group.id),
        messages,
      });
    });
    return threads;
  }

  function progressFor(user, bookings, orders) {
    const mine = bookings.filter((b) => b.customerPk === ME.pk && b.status !== 'cancelled');
    const month = new Date().toISOString().slice(0, 7);
    return {
      c_month3: mine.filter((b) => b.date.slice(0, 7) === month).length,
      c_new: new Set(mine.map((b) => b.barberId)).size,
      c_review: mine.filter((b) => b.rated).length,
      c_tip: mine.filter((b) => b.tip > 0).length,
      c_shop: orders.filter((o) => o.buyerPk === ME.pk).length,
      c_comm: (user.joined || []).length,
      c_ref: [...derive().users.values()].filter((u) => u.referredBy && u.referredBy === user.handle).length,
    };
  }

  function state() {
    const db = derive();
    const user = me();
    if (!user) fail(401, 'Your profile hasn’t loaded yet — check your connection');
    const counts = followerCounts();
    const myBarberId = db.barbers.has(`b${pk16(ME.pk)}`) ? `b${pk16(ME.pk)}` : null;
    const myPlaceId = db.places.has(`p${pk16(ME.pk)}`) ? `p${pk16(ME.pk)}` : null;
    const bookings = allBookings().filter((b) => b.customerPk === ME.pk || b.barberPk === ME.pk || (myPlaceId && b.placeId === myPlaceId));
    const orders = allOrders().filter((o) => o.buyerPk === ME.pk || o.sellerPk === ME.pk);
    const commissions = allCommissions();
    const mineAsCreator = commissions.filter((c) => c.creatorPk === ME.pk);
    const owed = commissions.filter((c) => c.payerPk === ME.pk);
    const claimed = user.claimed || {};
    const progress = progressFor(user, bookings, orders);
    let points = Object.keys(claimed).reduce((sum, key) => sum + (CHALLENGES[key] ? CHALLENGES[key].pts : 0), 0);
    bookings.filter((b) => b.customerPk === ME.pk && b.status === 'completed' && !b.noShow).forEach((b) => {
      points += Math.floor((b.quote ? b.quote.total : 0) * 10) + (b.rated ? 50 : 0);
    });
    const followingKeys = db.follows.get(ME.pk) || [];
    const week = isoWeek();
    const rent = allRent();
    const txns = [];
    bookings.filter((b) => b.customerPk === ME.pk).forEach((b) => {
      (b.payments || []).forEach((p) => txns.push({
        id: p.id, label: `${p.kind === 'tip' ? 'Tip' : 'Booking'} · ${(db.barbers.get(b.barberId) || {}).name || 'Barber'}`,
        amount: -p.amount, method: railLabel(p.rail) + (p.received ? ' ✓' : ' · awaiting confirmation'), date: new Date(p.at * 1000).toISOString(),
      }));
    });
    orders.filter((o) => o.buyerPk === ME.pk).forEach((o) => {
      (o.payments || []).forEach((p) => txns.push({ id: p.id, label: 'Shop order', amount: -p.amount, method: railLabel(p.rail), date: new Date(p.at * 1000).toISOString() }));
    });
    mineAsCreator.filter((c) => c.paid).forEach((c) => txns.push({
      id: `cm-${c.id}`, label: 'Creator commission', amount: c.amount, method: railLabel(c.paid.rail), date: new Date(c.paid.at * 1000).toISOString(),
    }));
    txns.sort((a, b) => b.date.localeCompare(a.date));
    const creators = [...db.users.values()]
      .filter((u) => u.pk !== ME.pk && !db.isHidden(u.id))
      .map((u) => ({
        id: u.id, pk: u.pk, name: u.name || 'Fade user', handle: u.handle || u.id, hue: u.hue !== undefined ? u.hue : fnvHue(u.pk),
        bio: u.bio || '', followers: counts[`user:${u.id}`] || 0, following: (db.follows.get(u.pk) || []).length, seed: false,
      }));
    const shorts = [...db.shorts.values()]
      .filter((s) => !db.isHidden(s.id) || s.ownerPk === ME.pk)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 400)
      .map(publicShort);
    return {
      server: { app: 'fade', version: 'net', time: nowSec(), network: true },
      user: {
        id: user.id,
        pk: ME.pk,
        npub: NT.nip19.npubEncode(ME.pk),
        name: user.name || 'You',
        handle: user.handle || user.id,
        hue: user.hue !== undefined ? user.hue : fnvHue(ME.pk),
        email: '',
        bio: user.bio || '',
        role: user.role || 'customer',
        points,
        lifetime: points,
        wallet: 0,
        plan: 'free',
        method: 'direct',
        cards: [],
        following: followingKeys,
        followers: counts[`user:${user.id}`] || 0,
        claimed,
        referrals: progress.c_ref,
        barberId: myBarberId,
        placeId: myPlaceId,
        joined: user.joined || [],
        pay: user.pay || {},
        notify: user.notify || null,
        location: user.location || null,
        admin: CFG.admins.includes(ME.pk),
      },
      barbers: [...db.barbers.values()].filter((b) => !db.isHidden(b.id)).map((b) => publicBarber(b, counts)),
      places: [...db.places.values()].filter((p) => !db.isHidden(p.id)).map((p) => publicPlace(p, counts)),
      products: [...db.products.values()].filter((p) => !db.isHidden(p.id)).map((p) => ({
        id: p.id, name: p.name, price: p.price, emoji: p.emoji || '🫙', cat: p.cat || 'Styling', sellerType: p.sellerType,
        sellerId: p.sellerId, placeId: p.placeId, rating: 5, hue: p.hue !== undefined ? p.hue : fnvHue(p.id), desc: p.desc || '', img: p.img || null,
        sold: memo('sold', () => {
          const counts = new Map();
          allOrders().filter((o) => o.status !== 'cancelled').forEach((o) => o.items.forEach((i) => counts.set(i.id, (counts.get(i.id) || 0) + i.qty)));
          return counts;
        }).get(p.id) || 0,
      })),
      creators,
      bookings,
      txns: txns.slice(0, 100),
      orders,
      threads: threadsFor(user),
      shorts,
      commissions: mineAsCreator,
      commissionsOwed: owed,
      creator: {
        pending: round2(mineAsCreator.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0)),
        available: round2(mineAsCreator.filter((c) => c.status === 'earned').reduce((s, c) => s + c.amount, 0)),
        paid: round2(mineAsCreator.filter((c) => c.status === 'paid').reduce((s, c) => s + c.amount, 0)),
      },
      boosts: {},
      progress,
      rentPaidThisWeek: rent.filter((r) => r.barberPk === ME.pk && r.week === week).map((r) => r.placeId),
      rent: rent.filter((r) => r.barberPk === ME.pk || placeOwner(r.placeId) === ME.pk),
      reviews: (() => {
        const verified = new Set(verifiedReviews());
        return db.reviews.filter((r) => !db.isHidden(r.id)).map((r) => ({ ...r, verified: verified.has(r) }));
      })(),
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  function profileData(patch = {}) {
    const current = myDoc('user', 'me') || {};
    return { ...current, ...patch, v: 3 };
  }

  async function saveProfile(patch) {
    await putDoc('user', 'me', profileData(patch));
  }

  function uniqueHandle(base) {
    const db = derive();
    const taken = new Set([...db.users.values()].filter((u) => u.pk !== ME.pk).map((u) => u.handle));
    let handle = base.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9_.]/g, '').slice(0, 24) || `fade${randomHex(2)}`;
    const root = handle;
    let counter = 1;
    while (taken.has(handle)) {
      counter++;
      handle = `${root}${counter}`;
    }
    return handle;
  }

  async function connectedRelays(timeoutMs = 6000) {
    const results = await Promise.allSettled(CFG.relays.map((url) => Promise.race([
      pool.ensureRelay(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])));
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  async function register(body) {
    const name = text(body, 'name', 60);
    const email = text(body, 'email', 120).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const role = ['customer', 'barber', 'owner'].includes(body.role) ? body.role : 'customer';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email');
    if (password.length < 10) fail(400, 'Use at least 10 characters — your password protects your account key');
    if (/^(.)\1+$/.test(password) || ['1234567890', 'password12', 'qwertyuiop'].includes(password.toLowerCase())) fail(400, 'That password is too easy to guess');
    ensureClean(name, 'name');
    if (!(await connectedRelays())) fail(503, 'Can’t reach the Fade network — check your connection and try again');
    const sk = await deriveKey(email, password);
    const pk = NT.getPublicKey(sk);
    const existing = await queryOnce({ kinds: [30078], authors: [pk], '#d': [`${NS}:user:me`] }, 5000);
    if (existing.length && !(parseJson(existing[0]) || {}).deleted) fail(409, 'You already have an account — log in instead');
    setKey(sk);
    DB = null;
    const handle = uniqueHandle(body.handle || name);
    const location = body.location && typeof body.location === 'object' ? {
      lat: Number(body.location.lat) || 0, lng: Number(body.location.lng) || 0, label: String(body.location.label || '').slice(0, 60),
    } : null;
    await putDoc('user', 'me', {
      v: 3, name, handle, role, bio: '', hue: fnvHue(pk), joined: [], claimed: {},
      notify: `fade-${randomHex(10)}`, pay: { cash: true, currency: 'USD' }, location,
      referredBy: body.referredBy ? String(body.referredBy).slice(0, 40) : undefined, createdAt: nowSec(),
    });
    if (role === 'barber') await createBarber(body.barber || {}, name, handle, location);
    if (role === 'owner') await createPlace(body.place || {}, name, location);
    subscribe();
    listenNotifications();
    return { token: 'nostr' };
  }

  async function createBarber(info, name, handle, location) {
    const price = num(info, 'price', 1, 5000, false, 15);
    const city = text(info, 'city', 40, false) || (location && location.label) || '';
    const tags = String(info.tags || '').split(',').map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 6);
    await putDoc('barber', 'me', {
      name, handle, title: tags.slice(0, 2).join(' & ') || 'Barber', city, hue: fnvHue(ME.pk), years: 0, langs: ['EN'],
      bio: text(info, 'bio', 400, false) || 'New on Fade — book me!', tags: tags.length ? tags : ['Haircut'],
      schedule: [], services: [{ id: 's1', name: text(info, 'service', 60, false) || 'Signature Cut', mins: 45, price }],
      portfolio: [], settings: { autoAccept: true, allowShopPay: true },
    });
    // Bookable from minute one: work from a personal studio (0% facility fee) with default hours the barber can edit.
    const placeId = `p${pk16(ME.pk)}`;
    if (!derive().places.has(placeId) && !rawDoc('place').name) {
      await createPlace({ name: `${name}’s Studio`, city, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, name, location, true);
    }
    const barber = rawDoc('barber');
    barber.schedule = [2, 3, 4, 5, 6].map((dow) => ({ dow, placeId, from: 10, to: 18 }));
    await putDoc('barber', 'me', barber);
  }

  async function createPlace(info, ownerName, location, personal = false) {
    const tier = TIERS[info.tier] ? info.tier : 'standard';
    const name = text(info, 'name', 60, false) || `${ownerName}’s Barbershop`;
    ensureClean(name, 'shop name');
    const loc = info.lat !== undefined ? { lat: Number(info.lat), lng: Number(info.lng) } : location || { lat: 0, lng: 0 };
    await putDoc('place', 'me', {
      name, short: name.split(' ')[0].slice(0, 12), area: text(info, 'area', 40, false), city: text(info, 'city', 40, false),
      address: text(info, 'address', 160, false), tz: safeTz(info.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
      lat: Number(loc.lat) || 0, lng: Number(loc.lng) || 0, tier, fee: personal ? 0 : TIERS[tier], chairs: personal ? 1 : 4,
      rent: personal ? 0 : 20, kitFee: personal ? 0 : 3, hue: fnvHue(`p${ME.pk}`), hours: '10:00–21:00', amenities: [],
      barbers: [], personal,
    });
  }

  async function login(body) {
    const email = text(body, 'email', 120).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await connectedRelays())) fail(503, 'Can’t reach the Fade network — check your connection and try again');
    const sk = await deriveKey(email, password);
    const pk = NT.getPublicKey(sk);
    const found = await queryOnce({ kinds: [30078], authors: [pk], '#d': [`${NS}:user:me`] }, 6000);
    if (!found.length || (parseJson(found[0]) || {}).deleted) fail(401, 'No account found for that email and password');
    setKey(sk);
    DB = null;
    subscribe();
    await queryOnce({ kinds: [30078], authors: [pk] }, 4000);
    listenNotifications();
    return { token: 'nostr' };
  }

  async function loginWithKey(secret) {
    const sk = parseSecret(secret);
    if (!sk) fail(400, 'Paste a valid nsec… or 64-character hex key');
    const pk = NT.getPublicKey(sk);
    await connectedRelays();
    const found = await queryOnce({ kinds: [30078], authors: [pk], '#d': [`${NS}:user:me`] }, 6000);
    setKey(sk);
    DB = null;
    subscribe();
    if (!found.length) {
      await putDoc('user', 'me', {
        v: 3, name: 'New Fade user', handle: uniqueHandle(`user${pk.slice(0, 4)}`), role: 'customer', hue: fnvHue(pk),
        joined: [], claimed: {}, notify: `fade-${randomHex(10)}`, pay: { cash: true, currency: 'USD' }, createdAt: nowSec(),
      });
    }
    listenNotifications();
    return { token: 'nostr' };
  }

  function myBarber() {
    const barber = derive().barbers.get(`b${pk16(ME.pk)}`);
    if (!barber) fail(403, 'Create a barber profile first');
    return barber;
  }

  function myPlace() {
    const place = derive().places.get(`p${pk16(ME.pk)}`);
    if (!place) fail(403, 'Create a shop first');
    return place;
  }

  function rawDoc(type) {
    return clone(myDoc(type, 'me') || {});
  }

  async function createBooking(body) {
    const barber = barberDoc(text(body, 'barberId', 40));
    const pub = publicBarber(barber, {});
    const service = pub.services.find((s) => s.id === body.serviceId);
    if (!service) fail(400, 'unknown service');
    if (barber.ownerPk === ME.pk) fail(400, 'You can’t book yourself');
    const key = text(body, 'date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) fail(400, 'date must be YYYY-MM-DD');
    const t = num(body, 'time', 0, 24);
    const place = placeDoc(text(body, 'placeId', 40));
    validateSlot(barber, service, key, t, place.id);
    const settings = barber.settings || {};
    let payMode = ['full', 'deposit', 'shop'].includes(body.payMode) ? body.payMode : 'deposit';
    if (payMode === 'shop' && settings.allowShopPay === false) payMode = 'deposit';
    const q = quote(service.price, publicPlace(place, {}), payMode);
    const user = me();
    const id = `bk${randomHex(6)}`;
    const ref = body.refShortId && derive().shorts.has(body.refShortId) ? body.refShortId : null;
    const data = {
      role: 'customer', barberId: barber.id, placeId: place.id, serviceId: service.id, serviceName: service.name,
      mins: service.mins, price: service.price, date: key, time: t, payMode, quote: q,
      notes: text(body, 'notes', 200, false), style: text(body, 'style', 20, false) || 'fade', refShortId: ref,
      customerName: user.name, customerHue: user.hue, rev: 0, payments: [], createdAt: nowSec(),
    };
    await putShared('booking', id, data, [barber.ownerPk, place.ownerPk]);
    push(barber.ownerPk, 'New booking request ✂️', `${user.name} · ${service.name} on ${key}`, '/pro', null, `bk-${id}-b`);
    const booking = bookingFrom(derive().shared.get(`booking:${id}`));
    return { booking, earned: 0 };
  }

  function myCustomerSide(id) {
    const record = derive().shared.get(`booking:${id}`);
    if (!record) fail(404, 'booking not found');
    const side = record.sides.get(ME.pk);
    if (!side || side.data.role !== 'customer') fail(403, 'Not your booking');
    return { record, data: clone(side.data), booking: bookingFrom(record) };
  }

  function myBarberSide(id) {
    const record = derive().shared.get(`booking:${id}`);
    if (!record) fail(404, 'booking not found');
    const booking = bookingFrom(record);
    if (!booking || booking.barberPk !== ME.pk) fail(403, 'Only the barber can do that');
    const side = record.sides.get(ME.pk);
    return { record, booking, data: side ? clone(side.data) : { role: 'barber', received: [], rev: -1 } };
  }

  function recipientsOf(booking) {
    return [booking.customerPk, booking.barberPk, placeOwner(booking.placeId)];
  }

  async function cancelBooking(id) {
    const { data, booking } = myCustomerSide(id);
    if (booking.status !== 'upcoming') fail(400, 'Only upcoming bookings can be cancelled');
    const hoursAway = (booking.startMs - Date.now()) / 3600000;
    const free = hoursAway >= CANCEL_FREE_HOURS;
    const refundDue = free ? booking.paidNow : 0;
    data.cancelled = { at: nowSec(), refundDue };
    await putShared('booking', id, data, recipientsOf(booking));
    push(booking.barberPk, 'Booking cancelled', `${data.customerName} cancelled ${booking.serviceName} on ${booking.date}${refundDue ? ` — refund $${refundDue.toFixed(2)} due` : ''}`, '/pro', null, `bk-${id}-b`);
    recallPush(ME.pk, `rm-${id}`); // the scheduled 2 h reminder is cancelled on the ntfy server
    return { refunded: 0, refundDue, free };
  }

  async function rescheduleBooking(id, body) {
    const { data, booking } = myCustomerSide(id);
    if (booking.status !== 'upcoming') fail(400, 'Only upcoming bookings can be moved');
    const barber = barberDoc(booking.barberId);
    const service = (barber.services || []).find((s) => s.id === booking.serviceId);
    const key = text(body, 'date', 10);
    const t = num(body, 'time', 0, 24);
    const placeId = text(body, 'placeId', 40);
    validateSlot(barber, service, key, t, placeId, id);
    Object.assign(data, { date: key, time: t, placeId, rev: (data.rev || 0) + 1 });
    await putShared('booking', id, data, [booking.customerPk, booking.barberPk, placeOwner(placeId)]);
    push(booking.barberPk, 'Booking moved', `${data.customerName} moved to ${key}`, '/pro', null, `bk-${id}-b`);
    recallPush(ME.pk, `rm-${id}`); // a fresh reminder for the new time is scheduled by runDuties()
    return { booking: bookingFrom(derive().shared.get(`booking:${id}`)) };
  }

  async function barberDecision(id, statusValue, extra = {}) {
    const { data, booking } = myBarberSide(id);
    if (statusValue === 'completed' && booking.status === 'cancelled') fail(400, 'That booking was cancelled');
    Object.assign(data, { role: 'barber', status: statusValue, rev: booking.rev, at: nowSec() }, extra);
    await putShared('booking', id, data, recipientsOf(booking));
    const messages = {
      confirmed: ['Booking confirmed ✂️', `Your ${booking.serviceName} on ${booking.date} is confirmed`],
      declined: ['Booking declined', extra.reason || 'Your barber can’t make that time'],
      completed: ['Thanks for the visit', 'Rate your cut and leave a tip if you loved it'],
      noshow: ['Marked as no-show', `You missed ${booking.serviceName} on ${booking.date}`],
    };
    if (messages[statusValue]) push(booking.customerPk, messages[statusValue][0], messages[statusValue][1], '/bookings', null, `bk-${id}-c`);
    return { booking: bookingFrom(derive().shared.get(`booking:${id}`)) };
  }

  async function addPayment(id, body) {
    const amount = round2(num(body, 'amount', 0.01, 10000));
    const rail = PAY_RAILS.includes(body.rail) ? body.rail : fail(400, 'Choose how you paid');
    const kind = ['deposit', 'full', 'balance', 'tip'].includes(body.kind) ? body.kind : 'deposit';
    const { data, booking } = myCustomerSide(id);
    const payment = {
      id: `py${randomHex(5)}`, amount, rail, kind, ref: text(body, 'ref', 80, false), at: nowSec(),
      hash: body.hash ? String(body.hash).slice(0, 80) : undefined,
      verify: body.verify ? String(body.verify).slice(0, 300) : undefined,
      verified: !!body.verified,
      preimage: body.preimage ? String(body.preimage).slice(0, 80) : undefined,
    };
    data.payments = [...(data.payments || []), payment].slice(-20);
    await putShared('booking', id, data, recipientsOf(booking));
    push(booking.barberPk, `Payment sent: $${amount.toFixed(2)}`, `${data.customerName} paid via ${railLabel(rail)} — confirm when you see it`, '/pro');
    return { payment };
  }

  async function confirmReceived(id, body) {
    const { data, booking } = myBarberSide(id);
    const ids = body.all ? booking.payments.map((p) => p.id) : [String(body.paymentId || '')];
    data.received = [...new Set([...(data.received || []), ...ids.filter(Boolean)])];
    if (data.status === undefined) data.status = booking.confirmed ? 'confirmed' : undefined;
    if (data.rev === undefined || data.rev < 0) data.rev = booking.rev;
    await putShared('booking', id, data, recipientsOf(booking));
    return { ok: true };
  }

  async function markRefunded(id, body) {
    const { data, booking } = myBarberSide(id);
    const amount = round2(num(body, 'amount', 0.01, 10000));
    data.refunds = [...(data.refunds || []), { amount, rail: PAY_RAILS.includes(body.rail) ? body.rail : 'bank', at: nowSec() }];
    await putShared('booking', id, data, recipientsOf(booking));
    push(booking.customerPk, 'Refund sent', `$${amount.toFixed(2)} refunded for ${booking.serviceName}`, '/bookings');
    return { ok: true };
  }

  async function rateBooking(id, body) {
    const rB = Math.round(num(body, 'rB', 1, 5));
    const rP = Math.round(num(body, 'rP', 1, 5));
    const tip = round2(num(body, 'tip', 0, MAX_TIP, false, 0));
    const review = text(body, 'review', 500, false);
    ensureClean(review, 'review');
    const { data, booking } = myCustomerSide(id);
    if (booking.status !== 'completed') fail(400, 'You can rate after the appointment');
    if (booking.noShow) fail(400, 'This booking was marked as a no-show');
    if (booking.rated) fail(400, 'Already rated');
    data.rating = { rB, rP, tip, review, at: nowSec() };
    await putShared('booking', id, data, recipientsOf(booking));
    await putDoc('review', id, { bookingId: id, barberId: booking.barberId, placeId: booking.placeId, rB, rP, text: review, tip, service: booking.serviceName });
    push(booking.barberPk, `New ${rB}★ review`, review || 'A client rated your cut', '/pro');
    return { earned: 50 + Math.floor(tip * 10) };
  }

  async function follow(body) {
    const type = body.type;
    const id = text(body, 'id', 40);
    if (!['barber', 'place', 'user'].includes(type)) fail(400, 'type must be barber, place or user');
    if (type === 'user' && id === userIdOf(ME.pk)) fail(400, 'You can’t follow yourself');
    const key = `${type}:${id}`;
    const list = (derive().follows.get(ME.pk) || []).slice();
    const index = list.indexOf(key);
    let following;
    if (index >= 0) {
      list.splice(index, 1);
      following = false;
    } else {
      list.push(key);
      following = true;
      const pk = type === 'user' ? pkOfId(id) : (derive()[type === 'barber' ? 'barbers' : 'places'].get(id) || {}).ownerPk;
      if (pk && pk !== ME.pk) push(pk, 'New follower', `${me().name} followed you on Fade`, '/me');
    }
    await putDoc('follows', 'me', { following: list });
    return { following };
  }

  const ACT = { timer: null, pending: null };

  function activity() {
    if (!ACT.pending) {
      const current = derive().acts.get(ME.pk) || {};
      ACT.pending = { liked: (current.liked || []).slice(), viewed: (current.viewed || []).slice(), shared: (current.shared || []).slice() };
    }
    return ACT.pending;
  }

  function flushActivity(immediate) {
    clearTimeout(ACT.timer);
    const run = () => {
      if (!ACT.pending) return;
      const data = {
        liked: ACT.pending.liked.slice(-2000),
        viewed: ACT.pending.viewed.slice(-800),
        shared: ACT.pending.shared.slice(-500),
      };
      ACT.pending = null;
      putDoc('act', 'me', data, [], { wait: false });
    };
    if (immediate) run();
    else ACT.timer = setTimeout(run, 4000);
  }

  function shortAction(id, action) {
    const short = derive().shorts.get(id);
    if (!short) fail(404, 'short not found');
    const act = activity();
    const list = action === 'like' ? act.liked : action === 'view' ? act.viewed : act.shared;
    const index = list.indexOf(id);
    if (action === 'like' && index >= 0) list.splice(index, 1);
    else if (index < 0) list.push(id);
    flushActivity(action === 'like' || action === 'share');
    const result = publicShort(short);
    if (action === 'like' && index < 0 && short.ownerPk !== ME.pk) {
      push(short.ownerPk, 'Someone liked your short', String(short.caption || '').slice(0, 80), '/creator');
    }
    return { short: result };
  }

  async function reviewTag(shortId, index, body) {
    const short = derive().shorts.get(shortId);
    const tag = short && (short.tags || [])[index];
    if (!tag) fail(404, 'tag not found');
    const target = tag.type === 'barber' ? derive().barbers.get(tag.id) : derive().places.get(tag.id);
    if (!target || target.ownerPk !== ME.pk) fail(403, 'Only the tagged barber or shop can approve');
    const decisions = { ...(derive().tagok.get(ME.pk) || {}) };
    const decision = body.approve ? 'approved' : 'declined';
    decisions[`${shortId}|${tag.type}|${tag.id}`] = decision;
    await putDoc('tagok', 'me', { decisions });
    push(short.ownerPk, body.approve ? 'Tag approved ✅' : 'Tag declined', `${target.name} ${decision} your ${tag.kind} tag`, '/creator');
    return { tag: { ...tag, status: decision } };
  }

  async function deleteShort(id) {
    const short = derive().shorts.get(id);
    if (!short || short.ownerPk !== ME.pk) fail(403, 'You can only delete your own shorts');
    await putDoc('short', id, { deleted: true, authorId: short.authorId });
    deleteDoc('short', id);
    return { ok: true };
  }

  async function uploadBlob(blob, onProgress) {
    if (!blob || !blob.size) fail(400, 'empty upload');
    if (blob.size > CFG.maxUploadMb * 1024 * 1024) fail(413, `File too large (max ${CFG.maxUploadMb} MB)`);
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const auth = NT.finalizeEvent({
      kind: 24242, created_at: nowSec(), content: 'Upload to Fade',
      tags: [['t', 'upload'], ['x', hash], ['expiration', String(nowSec() + 900)]],
    }, ME.sk);
    const header = `Nostr ${btoa(JSON.stringify(auth))}`;
    let lastError = null;
    const urls = [];
    for (const server of CFG.blossom) {
      try {
        const result = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `${server.replace(/\/+$/, '')}/upload`);
          xhr.setRequestHeader('Authorization', header);
          xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
          xhr.setRequestHeader('X-SHA-256', hash);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress && !urls.length) onProgress(event.loaded / event.total);
          };
          xhr.onload = () => {
            let data = {};
            try {
              data = JSON.parse(xhr.responseText);
            } catch (err) {
              data = {};
            }
            if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve(data);
            else reject(new Error(data.message || `Upload failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Upload failed — network error'));
          xhr.send(blob);
        });
        urls.push(result.url);
        if (urls.length >= 2) break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!urls.length) fail(502, (lastError && lastError.message) || 'Upload failed');
    return { url: urls[0], mirrors: urls.slice(1), sha256: hash, size: blob.size, type: blob.type };
  }

  async function uploadShort(meta, blob, contentType, onProgress) {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(contentType)) fail(415, 'Upload an MP4, WebM, MOV, JPG, PNG or WebP');
    const caption = text(meta, 'caption', 300);
    ensureClean(caption, 'caption');
    if (!SHORT_CATEGORIES.includes(meta.category)) fail(400, 'Pick what the short is about (haircut-related categories only)');
    const db = derive();
    const tags = [];
    let sponsored = false;
    for (const raw of (meta.tags || []).slice(0, 4)) {
      if (!['barber', 'place'].includes(raw.type) || !COMMISSION_RATES[raw.kind]) fail(400, 'invalid tag');
      const target = raw.type === 'barber' ? db.barbers.get(raw.id) : db.places.get(raw.id);
      if (!target) fail(404, 'tagged profile not found');
      if (raw.kind === 'sponsored') {
        if (!meta.sponsoredAgreement) fail(400, 'Sponsored tags need a confirmed paid partnership');
        sponsored = true;
      }
      tags.push({ type: raw.type, id: raw.id, kind: raw.kind });
    }
    let authorType = 'user';
    let authorId = userIdOf(ME.pk);
    if (meta.as === 'barber' && db.barbers.has(`b${pk16(ME.pk)}`)) {
      authorType = 'barber';
      authorId = `b${pk16(ME.pk)}`;
    }
    if (meta.as === 'place' && db.places.has(`p${pk16(ME.pk)}`)) {
      authorType = 'place';
      authorId = `p${pk16(ME.pk)}`;
    }
    const scan = cleanScan(meta.scan);
    const verdict = scanVerdict(scan);
    if (verdict === 'block') fail(422, 'This looks like nudity or sexual content, which isn’t allowed on Fade');
    const uploaded = await uploadBlob(blob, (fraction) => onProgress && onProgress(fraction * 0.9));
    let poster = null;
    if (typeof meta.poster === 'string' && meta.poster.startsWith('data:image/')) {
      try {
        const posterBlob = await (await fetch(meta.poster)).blob();
        poster = (await uploadBlob(posterBlob)).url;
      } catch (err) {
        poster = null;
      }
    }
    if (onProgress) onProgress(0.97);
    const id = `sh${randomHex(6)}`;
    const short = {
      authorType, authorId, caption, category: meta.category, tags, sponsored,
      media: {
        kind: contentType.startsWith('video/') ? 'video' : 'image', url: uploaded.url, mirrors: uploaded.mirrors,
        type: contentType, poster, duration: Number(meta.duration) || null, sha256: uploaded.sha256, optimized: !!meta.optimized,
        scan, scanVerdict: verdict, phash: /^[0-9a-f]{16}$/.test(meta.phash || '') ? meta.phash : null,
      },
      createdAt: nowSec(),
    };
    await putDoc('short', id, short, tags.map((t) => ['o', t.id]));
    tags.forEach((tag) => {
      const target = tag.type === 'barber' ? db.barbers.get(tag.id) : db.places.get(tag.id);
      if (target && target.ownerPk !== ME.pk) push(target.ownerPk, 'You were tagged in a short', `${me().name} tagged you as ${tag.kind} — approve it in Fade`, '/pro');
    });
    if (onProgress) onProgress(1);
    return { short: publicShort({ ...short, id, ownerPk: ME.pk }), scan: verdict };
  }

  async function addPortfolio(blob, contentType, title) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) fail(415, 'Upload a JPG, PNG or WebP photo');
    const barber = rawDoc('barber');
    if (!barber.name) fail(403, 'Create a barber profile first');
    const uploaded = await uploadBlob(blob);
    barber.portfolio = [{ id: `f${randomHex(4)}`, title: String(title || 'New cut').slice(0, 60), style: 'fade', hue: barber.hue, likes: 0, img: uploaded.url }, ...(barber.portfolio || [])].slice(0, 40);
    await putDoc('barber', 'me', barber);
    return { barber: publicBarber({ ...barber, id: `b${pk16(ME.pk)}`, ownerPk: ME.pk }, followerCounts()) };
  }

  async function openDm(body) {
    const barber = barberDoc(text(body, 'barberId', 40));
    if (barber.ownerPk === ME.pk) fail(400, 'That’s you');
    return { threadId: `dm_${pk16(barber.ownerPk)}` };
  }

  async function sendDm(counterpartPk, message) {
    const wraps = NT.nip17.wrapManyEvents(ME.sk, [{ publicKey: counterpartPk }], message);
    await Promise.all(wraps.map((wrap) => publish(wrap, { wait: false })));
    push(counterpartPk, `Message from ${me().name}`, message.slice(0, 120), '/chat');
  }

  async function postMessage(threadId, body) {
    const message = text(body, 'text', 1000);
    ensureClean(message, 'message');
    const db = derive();
    if (threadId.startsWith('dm_')) {
      const prefix = threadId.slice(3);
      let counterpart = [...db.users.keys()].find((pk) => pk.startsWith(prefix));
      if (!counterpart) {
        const barber = [...db.barbers.values()].find((b) => b.ownerPk.startsWith(prefix));
        counterpart = barber && barber.ownerPk;
      }
      if (!counterpart) fail(404, 'conversation not found');
      if (db.mod.banned.has(counterpart)) fail(403, 'This account was removed');
      await sendDm(counterpart, message);
      return { ok: true };
    }
    const group = db.groups.get(threadId);
    if (!group) fail(404, 'conversation not found');
    if (!(me().joined || []).includes(threadId)) fail(403, 'Join the community to post');
    await putDoc('msg', `m${randomHex(6)}`, { groupId: threadId, text: message }, [['o', threadId]]);
    return { ok: true };
  }

  async function membership(threadId, join) {
    const group = derive().groups.get(threadId);
    if (!group) fail(404, 'community not found');
    const joined = new Set(me().joined || []);
    if (join) joined.add(threadId);
    else joined.delete(threadId);
    await saveProfile({ joined: [...joined].slice(0, 100) });
    return { joined: join };
  }

  async function createGroup(body) {
    const title = text(body, 'title', 60);
    const desc = text(body, 'desc', 200, false);
    ensureClean(title + desc, 'community name');
    const id = `g${randomHex(6)}`;
    await putDoc('group', id, { title, desc, hue: fnvHue(title) });
    await putDoc('msg', `m${randomHex(6)}`, { groupId: id, text: `Welcome to ${title} 👋` }, [['o', id]]);
    const joined = new Set(me().joined || []);
    joined.add(id);
    await saveProfile({ joined: [...joined] });
    return { threadId: id };
  }

  async function createOrder(body) {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 30) fail(400, 'Your bag is empty');
    const delivery = body.delivery === 'delivery' ? 'delivery' : 'pickup';
    const address = text(body, 'address', 200, false);
    if (delivery === 'delivery' && !address) fail(400, 'Add a delivery address');
    const db = derive();
    const bySeller = new Map();
    for (const item of items) {
      const product = db.products.get(item.id);
      const qty = Math.round(num(item, 'qty', 1, 20));
      if (!product) fail(404, 'product not found');
      if (product.ownerPk === ME.pk) fail(400, 'You can’t buy your own product');
      if (!bySeller.has(product.ownerPk)) bySeller.set(product.ownerPk, []);
      bySeller.get(product.ownerPk).push({ product, qty });
    }
    const user = me();
    const created = [];
    for (const [sellerPk, lines] of bySeller) {
      const subtotal = round2(lines.reduce((sum, l) => sum + l.product.price * l.qty, 0));
      const id = `o${randomHex(6)}`;
      const first = lines[0].product;
      await putShared('order', id, {
        role: 'buyer', sellerPk, sellerType: first.sellerType, sellerId: first.sellerId, buyerName: user.name,
        items: lines.map((l) => ({ id: l.product.id, name: l.product.name, price: l.product.price, qty: l.qty })),
        total: subtotal, delivery, address, refShortId: body.refShortId || null, payments: [], createdAt: nowSec(),
      }, [sellerPk]);
      push(sellerPk, 'New order 🛍️', `${user.name} ordered ${lines.length} item${lines.length > 1 ? 's' : ''} ($${subtotal.toFixed(2)})`, '/pro');
      created.push(orderFrom(derive().shared.get(`order:${id}`)));
    }
    return { order: created[0], orders: created, earned: 0 };
  }

  async function orderPayment(id, body) {
    const record = derive().shared.get(`order:${id}`);
    const side = record && record.sides.get(ME.pk);
    if (!side || side.data.role !== 'buyer') fail(403, 'Not your order');
    const data = clone(side.data);
    const payment = {
      id: `py${randomHex(5)}`, amount: round2(num(body, 'amount', 0.01, 10000)),
      rail: PAY_RAILS.includes(body.rail) ? body.rail : 'bank', ref: text(body, 'ref', 80, false), at: nowSec(), verified: !!body.verified,
    };
    data.payments = [...(data.payments || []), payment];
    await putShared('order', id, data, [data.sellerPk]);
    push(data.sellerPk, `Order paid: $${payment.amount.toFixed(2)}`, `via ${railLabel(payment.rail)}`, '/pro');
    return { payment };
  }

  async function orderStatus(id, body) {
    const record = derive().shared.get(`order:${id}`);
    const order = record && orderFrom(record);
    if (!order) fail(404, 'order not found');
    if (order.sellerPk === ME.pk) {
      const statusValue = ['accepted', 'ready', 'shipped', 'completed', 'cancelled'].includes(body.status) ? body.status : 'accepted';
      const side = record.sides.get(ME.pk);
      const data = side ? clone(side.data) : { role: 'seller', received: [] };
      data.role = 'seller';
      data.status = statusValue;
      if (body.received) data.received = order.payments.map((p) => p.id);
      await putShared('order', id, data, [order.buyerPk]);
      push(order.buyerPk, `Order ${statusValue}`, `Your order is ${statusValue}`, '/shop');
      // Product commissions become earned as soon as the seller confirms the sale.
      if (['accepted', 'completed', 'ready', 'shipped'].includes(statusValue) && order.refShortId) await productCommission(order);
      return { ok: true };
    }
    if (order.buyerPk === ME.pk && body.status === 'cancelled') {
      const data = clone(record.sides.get(ME.pk).data);
      data.cancelled = { at: nowSec() };
      await putShared('order', id, data, [order.sellerPk]);
      return { ok: true };
    }
    fail(403, 'Not your order');
    return null;
  }

  async function productCommission(order) {
    const db = derive();
    const short = db.shorts.get(order.refShortId);
    if (!short || short.authorType !== 'user' || short.ownerPk === order.buyerPk) return;
    const tag = approvedTag(short, order.sellerType, order.sellerId);
    if (!tag) return;
    const id = `${order.id}-${order.sellerType}`;
    if (allCommissions().find((c) => c.id === id)) return;
    const base = round2(order.items.reduce((s, i) => s + i.price * i.qty, 0));
    const rate = COMMISSION_RATES[tag.kind];
    await putShared('cm', id, {
      role: 'payer', creatorPk: short.ownerPk, shortId: short.id, sourceType: 'order', sourceId: order.id,
      payerType: order.sellerType, payerId: order.sellerId, kind: tag.kind, rate, base, amount: round2(base * rate),
      status: 'earned', paid: null, createdAt: nowSec(),
    }, [short.ownerPk]);
  }

  async function payCommission(id, body) {
    const record = derive().shared.get(`cm:${id}`);
    const commission = record && commissionFrom(record);
    if (!commission || commission.payerPk !== ME.pk) fail(403, 'Only the payer can mark this paid');
    if (commission.status === 'pending' || commission.status === 'void') fail(400, 'This commission isn’t earned yet');
    const data = clone(record.sides.get(ME.pk).data);
    data.paid = { at: nowSec(), rail: PAY_RAILS.includes(body.rail) ? body.rail : 'bank', ref: text(body, 'ref', 80, false) };
    await putShared('cm', id, data, [commission.creatorPk]);
    push(commission.creatorPk, `Commission paid: $${commission.amount.toFixed(2)}`, `via ${railLabel(data.paid.rail)} — confirm when it arrives`, '/creator');
    return { ok: true };
  }

  async function confirmCommission(id) {
    const record = derive().shared.get(`cm:${id}`);
    const commission = record && commissionFrom(record);
    if (!commission || commission.creatorPk !== ME.pk) fail(403, 'Not your commission');
    await putShared('cm', id, { role: 'creator', received: true, at: nowSec() }, [commission.payerPk]);
    return { ok: true };
  }

  async function payRent(body) {
    const barber = myBarber();
    const place = placeDoc(body.placeId);
    if (place.ownerPk === ME.pk) fail(400, 'That’s your own place — no rent');
    const shifts = approvedSchedule(barber).filter((s) => s.placeId === place.id);
    if (!shifts.length) fail(400, 'You have no approved shifts at this place');
    const week = isoWeek();
    if (allRent().find((r) => r.barberPk === ME.pk && r.placeId === place.id && r.week === week)) fail(400, 'Rent already recorded this week');
    const facility = round2(allBookings()
      .filter((b) => b.barberPk === ME.pk && b.placeId === place.id && b.status === 'completed' && !b.noShow && isoWeek(new Date(b.startMs)) === week)
      .reduce((sum, b) => sum + (b.quote ? b.quote.facility : 0), 0));
    const lines = [
      { label: `Chair rent × ${shifts.length} shift${shifts.length > 1 ? 's' : ''}`, amount: round2(shifts.length * (place.rent || 0)) },
      { label: 'Product / kit fee', amount: round2(shifts.length * (place.kitFee || 0)) },
      { label: 'Facility fees collected from clients', amount: facility },
    ];
    const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
    const rail = PAY_RAILS.includes(body.rail) ? body.rail : 'cash';
    await putShared('rent', `${week}-${place.id}`, {
      role: 'renter', week, placeId: place.id, barberId: barber.id, amount, lines,
      payment: { rail, ref: text(body, 'ref', 80, false), at: nowSec() }, createdAt: nowSec(),
    }, [place.ownerPk]);
    push(place.ownerPk, `Rent paid: $${amount.toFixed(2)}`, `${barber.name} paid the week ${week} statement via ${railLabel(rail)}`, '/owner');
    return { amount, lines };
  }

  async function confirmRent(id) {
    const record = derive().shared.get(`rent:${id}`);
    const rent = record && rentFrom(record);
    if (!rent || placeOwner(rent.placeId) !== ME.pk) fail(403, 'Only the shop owner can confirm');
    await putShared('rent', id, { role: 'landlord', received: true, at: nowSec() }, [rent.barberPk]);
    return { ok: true };
  }

  async function addProduct(body) {
    const name = text(body, 'name', 80);
    ensureClean(name, 'product name');
    const price = num(body, 'price', 1, 5000);
    const cat = ['Styling', 'Beard', 'Care', 'Tools', 'Merch'].includes(body.cat) ? body.cat : 'Styling';
    const db = derive();
    let sellerType;
    let sellerId;
    let placeId;
    if (db.barbers.has(`b${pk16(ME.pk)}`) && body.as !== 'place') {
      sellerType = 'barber';
      sellerId = `b${pk16(ME.pk)}`;
      placeId = (approvedSchedule(db.barbers.get(sellerId))[0] || {}).placeId || null;
    } else if (db.places.has(`p${pk16(ME.pk)}`)) {
      sellerType = 'place';
      sellerId = `p${pk16(ME.pk)}`;
      placeId = sellerId;
    } else {
      fail(403, 'Only barbers and shops can sell');
    }
    const emoji = { Styling: '🫙', Beard: '🧴', Care: '🫧', Tools: '🪮', Merch: '🧢' }[cat];
    const id = `pr${randomHex(5)}`;
    const product = { name, price, emoji, cat, sellerType, sellerId, placeId, hue: fnvHue(id), desc: text(body, 'desc', 300, false) || `New from ${name}.` };
    await putDoc('product', id, product);
    return { product: { ...product, id, rating: 5, sold: 0 } };
  }

  async function saveBarber(body) {
    const barber = rawDoc('barber');
    if (!barber.name) fail(403, 'Create a barber profile first');
    const db = derive();
    if ('schedule' in body) {
      const schedule = [];
      for (const shift of (body.schedule || []).slice(0, 21)) {
        const dow = Math.round(num(shift, 'dow', 0, 6));
        const from = num(shift, 'from', 0, 23.5);
        const to = num(shift, 'to', 0.5, 24);
        if (!db.places.has(shift.placeId)) fail(404, 'place not found');
        if (to - from < 1) fail(400, 'Shifts must be at least 1 hour');
        if (schedule.some((o) => o.dow === dow && overlaps(o.from, (o.to - o.from) * 60, from, (to - from) * 60))) fail(400, 'Shifts overlap on the same day');
        schedule.push({ dow, placeId: shift.placeId, from, to });
      }
      barber.schedule = schedule;
      const newPlaces = [...new Set(schedule.map((s) => s.placeId))].filter((pid) => {
        const place = db.places.get(pid);
        return place && place.ownerPk !== ME.pk && !(place.barbers || []).includes(`b${pk16(ME.pk)}`);
      });
      newPlaces.forEach((pid) => push(db.places.get(pid).ownerPk, 'Chair request', `${barber.name} wants to work at your shop — approve in Fade`, '/owner'));
    }
    if ('services' in body) {
      const services = (body.services || []).slice(0, 20).map((s) => ({
        id: text(s, 'id', 20), name: text(s, 'name', 60), mins: Math.round(num(s, 'mins', 10, 300)), price: num(s, 'price', 1, 5000),
      }));
      if (!services.length) fail(400, 'Keep at least one service');
      barber.services = services;
    }
    ['bio', 'title', 'city'].forEach((field) => {
      if (field in body) barber[field] = text(body, field, field === 'bio' ? 400 : 60, false);
    });
    if ('tags' in body) barber.tags = String(body.tags).split(',').map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8);
    if ('portfolio' in body) {
      const keep = new Set((body.portfolio || []).map((item) => item.id));
      barber.portfolio = (barber.portfolio || []).filter((item) => keep.has(item.id));
    }
    if ('settings' in body && body.settings && typeof body.settings === 'object') {
      barber.settings = { ...(barber.settings || {}), autoAccept: body.settings.autoAccept !== false, allowShopPay: body.settings.allowShopPay !== false };
    }
    await putDoc('barber', 'me', barber);
    return { barber: publicBarber({ ...barber, id: `b${pk16(ME.pk)}`, ownerPk: ME.pk }, followerCounts()) };
  }

  async function savePlace(body) {
    const place = rawDoc('place');
    if (!place.name) fail(403, 'Only shop owners can edit a place');
    if ('tier' in body) {
      if (!TIERS[body.tier]) fail(400, 'unknown tier');
      place.tier = body.tier;
      place.fee = TIERS[body.tier];
    }
    if ('fee' in body) place.fee = Math.round(num(body, 'fee', 0, 15));
    if ('rent' in body) place.rent = num(body, 'rent', 0, 1000);
    if ('kitFee' in body) place.kitFee = num(body, 'kitFee', 0, 200);
    if ('chairs' in body) place.chairs = Math.round(num(body, 'chairs', 1, 60));
    ['name', 'area', 'city', 'address', 'hours'].forEach((field) => {
      if (field in body) place[field] = text(body, field, field === 'address' ? 160 : 60, false);
    });
    if ('amenities' in body) place.amenities = String(body.amenities).split(',').map((a) => a.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
    if ('tz' in body) place.tz = safeTz(String(body.tz));
    if ('lat' in body && 'lng' in body) {
      place.lat = num(body, 'lat', -90, 90);
      place.lng = num(body, 'lng', -180, 180);
    }
    if ('approve' in body) place.barbers = [...new Set([...(place.barbers || []), String(body.approve)])];
    if ('remove' in body) place.barbers = (place.barbers || []).filter((id) => id !== body.remove);
    if (place.name) place.short = place.name.split(' ')[0].slice(0, 12);
    await putDoc('place', 'me', place);
    if (body.approve) {
      const barber = derive().barbers.get(body.approve);
      if (barber) push(barber.ownerPk, 'Chair approved ✅', `${place.name} approved you — clients can book you there now`, '/pro');
    }
    return { place: publicPlace({ ...place, id: `p${pk16(ME.pk)}`, ownerPk: ME.pk }, followerCounts()) };
  }

  async function claimChallenge(body) {
    const id = body.id;
    if (!CHALLENGES[id]) fail(400, 'unknown challenge');
    const user = me();
    const claimed = { ...(user.claimed || {}) };
    if (claimed[id]) fail(400, 'Already claimed');
    const snapshot = state();
    if (snapshot.progress[id] < CHALLENGES[id].goal) fail(400, 'Challenge not finished yet');
    claimed[id] = true;
    await saveProfile({ claimed });
    return { points: snapshot.user.points + CHALLENGES[id].pts };
  }

  // ----- moderation -----
  async function report(body) {
    const target = text(body, 'target', 80);
    const reason = ['spam', 'nudity', 'violence', 'harassment', 'hate', 'scam', 'impersonation', 'not-haircut', 'other'].includes(body.reason) ? body.reason : 'other';
    const tags = [['t', NS], ['o', target]];
    if (body.auto) tags.push(['client', 'fade-autoscan']);
    if (body.pk && /^[0-9a-f]{64}$/.test(body.pk)) tags.push(['p', body.pk, reason]);
    else tags.push(['l', reason]);
    if (body.eventId && /^[0-9a-f]{64}$/.test(body.eventId)) tags.push(['e', body.eventId, reason]);
    await publish(signTracked(1984, tags, text(body, 'note', 300, false)));
    return { ok: true };
  }

  // perceptual hash this device computed when it checked a short (netui.js viewer checks, fade.viewscan)
  function viewerHash(shortId) {
    try {
      const entry = JSON.parse(localStorage.getItem('fade.viewscan') || '{}')[shortId];
      return (entry && entry.h) || '';
    } catch (err) {
      return '';
    }
  }

  async function modUpdate(body) {
    if (!CFG.admins.includes(ME.pk)) fail(403, 'Moderators only');
    const current = myDoc('mod', 'list') || {};
    const lists = {};
    ['hidden', 'banned', 'verified', 'kept', 'dismissed', 'featured', 'phash'].forEach((key) => {
      lists[key] = new Set(current[key] || []);
    });
    const { action, target } = body;
    const value = String(target || '');
    if (!value) fail(400, 'target required');
    const forgetHashes = () => [...lists.phash].filter((entry) => entry.endsWith(`@${value}`)).forEach((entry) => lists.phash.delete(entry));
    const toggles = {
      hide: () => {
        lists.hidden.add(value);
        lists.kept.delete(value);
        // block re-uploads everywhere: the hash the uploader declared + what this moderator's device computed
        const short = derive().shorts.get(value);
        const hashes = new Set([...(body.phash || []), (short && short.media && short.media.phash) || '', viewerHash(value)]);
        hashes.forEach((hash) => {
          if (/^[0-9a-f]{16}$/.test(hash || '')) lists.phash.add(`${hash}@${value}`);
        });
      },
      unhide: () => {
        lists.hidden.delete(value);
        forgetHashes();
      },
      keep: () => {
        lists.kept.add(value);
        lists.hidden.delete(value);
        forgetHashes();
      },
      ban: () => lists.banned.add(value),
      unban: () => lists.banned.delete(value),
      verify: () => lists.verified.add(value),
      unverify: () => lists.verified.delete(value),
      dismiss: () => lists.dismissed.add(value),
      feature: () => lists.featured.add(value),
      unfeature: () => lists.featured.delete(value),
    };
    if (!toggles[action]) fail(400, 'unknown action');
    toggles[action]();
    const data = {};
    Object.keys(lists).forEach((key) => {
      data[key] = [...lists[key]].slice(-5000);
    });
    await putDoc('mod', 'list', data);
    return { ok: true };
  }

  function modQueue() {
    const db = derive();
    const groups = new Map();
    db.reports.forEach((report) => {
      if (db.mod.dismissed.has(report.id)) return;
      if (!groups.has(report.target)) groups.set(report.target, { target: report.target, targetPk: report.targetPk, reports: [] });
      groups.get(report.target).reports.push(report);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        reporters: new Set(group.reports.map((r) => r.by)).size,
        hidden: db.isHidden(group.target),
        kept: db.mod.kept.has(group.target),
        banned: group.targetPk ? db.mod.banned.has(group.targetPk) : false,
        preview: describeTarget(group.target),
      }))
      .sort((a, b) => b.reporters - a.reporters);
  }

  function describeTarget(target) {
    const db = derive();
    if (String(target).startsWith('demo:')) {
      const sample = db.reports.find((r) => r.target === target && r.preview);
      return { type: 'offline demo', text: sample ? sample.preview : target.slice(5) };
    }
    if (db.shorts.has(target)) return { type: 'short', text: db.shorts.get(target).caption, media: db.shorts.get(target).media };
    if (db.barbers.has(target)) return { type: 'barber', text: db.barbers.get(target).name };
    if (db.places.has(target)) return { type: 'place', text: db.places.get(target).name };
    for (const list of db.comments.values()) {
      const found = list.find((c) => c.id === target);
      if (found) return { type: 'comment', text: found.text };
    }
    for (const list of db.msgs.values()) {
      const found = list.find((m) => m.id === target);
      if (found) return { type: 'message', text: found.text };
    }
    const user = [...db.users.values()].find((u) => u.id === target);
    if (user) return { type: 'user', text: user.name };
    return { type: 'unknown', text: target };
  }

  async function addComment(body) {
    const shortId = text(body, 'shortId', 40);
    const message = text(body, 'text', 500);
    ensureClean(message, 'comment');
    const short = derive().shorts.get(shortId);
    if (!short) fail(404, 'short not found');
    const id = `c${randomHex(6)}`;
    await putDoc('comment', id, { shortId, text: message }, [['o', shortId]]);
    if (short.ownerPk !== ME.pk) push(short.ownerPk, `${me().name} commented`, message.slice(0, 120), '/feed', null, `cm-${id}`);
    return { id };
  }

  async function deleteComment(id) {
    const db = derive();
    for (const [shortId, list] of db.comments) {
      if (list.some((c) => c.id === id)) {
        const short = db.shorts.get(shortId);
        if (short && short.ownerPk !== ME.pk) recallPush(short.ownerPk, `cm-${id}`);
      }
    }
    await putDoc('comment', id, { deleted: true, shortId: null });
    deleteDoc('comment', id);
    return { ok: true };
  }

  function commentsFor(shortId) {
    const db = derive();
    return (db.comments.get(shortId) || [])
      .filter((c) => !db.isHidden(c.id))
      .sort((a, b) => a.at - b.at)
      .map((c) => {
        const author = db.users.get(c.by) || {};
        return { id: c.id, by: c.by, mine: c.by === ME.pk, userId: userIdOf(c.by), name: author.name || 'Fade user', hue: author.hue, text: c.text, at: c.at };
      });
  }

  async function deleteAccount() {
    const mine = [...STORE.byAddr.values()].filter((e) => e.pubkey === ME.pk && e.kind === 30078);
    await putDoc('user', 'me', { deleted: true, v: 3 });
    if (derive().barbers.has(`b${pk16(ME.pk)}`)) await putDoc('barber', 'me', { deleted: true });
    if (derive().places.has(`p${pk16(ME.pk)}`)) await putDoc('place', 'me', { deleted: true });
    const addrs = mine.map(addressOf).filter((a) => a && !a.endsWith(`${NS}:user:me`));
    for (let i = 0; i < addrs.length; i += 50) {
      const chunk = addrs.slice(i, i + 50);
      await publish(signTracked(5, [...chunk.map((a) => ['a', a]), ['t', NS]], 'account deleted'));
    }
    clearKey();
    await Cache.clear();
    return { ok: true };
  }

  function exportData() {
    const mine = [...STORE.byId.values()].filter((e) => e.pubkey === ME.pk || e.tags.some((t) => t[0] === 'p' && t[1] === ME.pk));
    return {
      exportedAt: new Date().toISOString(),
      npub: NT.nip19.npubEncode(ME.pk),
      profile: myDoc('user', 'me'),
      events: mine.map((e) => {
        const isPrivate = e.tags.some((t) => t[0] === 't' && t[1] === PRIVATE_TAG);
        return { id: e.id, kind: e.kind, created_at: e.created_at, tags: e.tags, data: isPrivate ? unseal(e) : e.kind === 30078 ? parseJson(e) : undefined };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Router: emulate the Fade HTTP API
  // ---------------------------------------------------------------------------
  const NOT_HERE = 'Not needed on Fade Network — Fade is free and you pay your barber directly';

  async function handle(method, path, body = {}) {
    const url = new URL(path, 'https://fade.local');
    const p = url.pathname;
    let m;
    if (method === 'POST' && p === '/api/auth/register') return register(body);
    if (method === 'POST' && p === '/api/auth/login') return login(body);
    if (method === 'POST' && p === '/api/auth/logout') {
      clearKey();
      if (notifySource) notifySource.close();
      return { ok: true };
    }
    if (!ME.sk) fail(401, 'Sign in first');
    if (method === 'GET' && p === '/api/state') return state();
    if (method === 'GET' && p === '/api/slots') {
      const barber = barberDoc(url.searchParams.get('barber'));
      const mins = Number(url.searchParams.get('mins')) || 30;
      return { groups: slots(barber, url.searchParams.get('date'), mins, url.searchParams.get('exclude') || null) };
    }
    if (method === 'POST' && p === '/api/bookings') return createBooking(body);
    if ((m = p.match(/^\/api\/bookings\/([\w-]+)\/(cancel|reschedule|complete|rate|accept|decline|noshow|pay|received|refunded)$/))) {
      const [, id, action] = m;
      if (action === 'cancel') return cancelBooking(id);
      if (action === 'reschedule') return rescheduleBooking(id, body);
      if (action === 'complete') return barberDecision(id, 'completed');
      if (action === 'accept') return barberDecision(id, 'confirmed');
      if (action === 'decline') return barberDecision(id, 'declined', { reason: text(body, 'reason', 200, false) || 'The barber can’t make that time' });
      if (action === 'noshow') return barberDecision(id, 'noshow');
      if (action === 'rate') return rateBooking(id, body);
      if (action === 'pay') return addPayment(id, body);
      if (action === 'received') return confirmReceived(id, body);
      if (action === 'refunded') return markRefunded(id, body);
    }
    if (['/api/wallet/topup', '/api/cards', '/api/me/method', '/api/plan', '/api/rewards/redeem'].includes(p) || p.startsWith('/api/cards/')) fail(400, NOT_HERE);
    if (method === 'POST' && p === '/api/creator/withdraw') fail(400, 'Commissions are paid to you directly by the barber or shop — see each one below');
    if (method === 'POST' && p === '/api/follow') return follow(body);
    if ((m = p.match(/^\/api\/shorts\/([\w-]+)\/(like|view|share)$/))) return shortAction(m[1], m[2]);
    if ((m = p.match(/^\/api\/shorts\/([\w-]+)\/tags\/(\d+)$/))) return reviewTag(m[1], Number(m[2]), body);
    if (method === 'DELETE' && (m = p.match(/^\/api\/shorts\/([\w-]+)$/))) return deleteShort(m[1]);
    if (method === 'POST' && p === '/api/dm') return openDm(body);
    if (method === 'POST' && p === '/api/threads') return createGroup(body);
    if ((m = p.match(/^\/api\/threads\/([\w-]+)\/messages$/))) return postMessage(m[1], body);
    if ((m = p.match(/^\/api\/threads\/([\w-]+)\/(join|leave)$/))) return membership(m[1], m[2] === 'join');
    if (method === 'POST' && p === '/api/orders') return createOrder(body);
    if ((m = p.match(/^\/api\/orders\/([\w-]+)\/(pay|status)$/))) return m[2] === 'pay' ? orderPayment(m[1], body) : orderStatus(m[1], body);
    if (method === 'POST' && p === '/api/rewards/claim') return claimChallenge(body);
    if (method === 'POST' && p === '/api/rewards/referral') return { referrals: state().user.referrals };
    if (method === 'POST' && p === '/api/products') return addProduct(body);
    if (method === 'POST' && p === '/api/studio/rent') return payRent(body);
    if ((m = p.match(/^\/api\/rent\/([\w-]+)\/confirm$/))) return confirmRent(m[1]);
    if (method === 'PUT' && p === '/api/studio/barber') return saveBarber(body);
    if (method === 'PUT' && p === '/api/owner/place') return savePlace(body);
    if ((m = p.match(/^\/api\/commissions\/([\w-]+)\/(paid|received)$/))) return m[2] === 'paid' ? payCommission(m[1], body) : confirmCommission(m[1]);
    if (method === 'PUT' && p === '/api/me') {
      const patch = {};
      if ('name' in body) {
        patch.name = text(body, 'name', 60);
        ensureClean(patch.name, 'name');
      }
      if ('bio' in body) {
        patch.bio = text(body, 'bio', 300, false);
        ensureClean(patch.bio, 'bio');
      }
      if ('pay' in body) patch.pay = cleanPay(body.pay);
      if ('location' in body && body.location) patch.location = { lat: Number(body.location.lat) || 0, lng: Number(body.location.lng) || 0, label: String(body.location.label || '').slice(0, 60) };
      if (body.rotateNotify) patch.notify = `fade-${randomHex(10)}`;
      if (['full', 'private'].includes(body.pushPreview)) patch.pushPreview = body.pushPreview;
      await saveProfile(patch);
      if (patch.notify) setTimeout(listenNotifications, 300);
      return { ok: true };
    }
    if (method === 'POST' && p === '/api/me/barber') {
      if (derive().barbers.has(`b${pk16(ME.pk)}`)) fail(400, 'You already have a barber profile');
      const user = me();
      await createBarber(body, user.name, user.handle, user.location);
      return { barberId: `b${pk16(ME.pk)}` };
    }
    if (method === 'POST' && p === '/api/me/place') {
      const existing = derive().places.get(`p${pk16(ME.pk)}`);
      // A barber's personal studio can be upgraded to a full shop in place (same id keeps shifts and bookings valid).
      if (existing && !(existing.personal && !body.personal)) fail(400, 'You already have a shop');
      await createPlace(body, me().name, me().location, !!body.personal);
      return { placeId: `p${pk16(ME.pk)}` };
    }
    if (method === 'POST' && p === '/api/report') return report(body);
    if (method === 'POST' && p === '/api/mod') return modUpdate(body);
    if (method === 'POST' && p === '/api/comments') return addComment(body);
    if (method === 'DELETE' && (m = p.match(/^\/api\/comments\/([\w-]+)$/))) return deleteComment(m[1]);
    fail(404, `Not available on Fade Network: ${method} ${p}`);
    return null;
  }

  async function upload(path, blob, contentType, headers = {}, onProgress) {
    if (!ME.sk) fail(401, 'Sign in first');
    if (path === '/api/shorts') {
      const meta = JSON.parse(decodeURIComponent(escape(atob(headers['X-Fade-Meta'] || 'e30='))));
      return uploadShort(meta, blob, contentType, onProgress);
    }
    if (path === '/api/studio/portfolio') return addPortfolio(blob, contentType, decodeURIComponent(headers['X-Title'] || ''));
    if (path === '/api/media') return uploadBlob(blob, onProgress);
    fail(404, 'unknown upload');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  let started = false;

  async function start() {
    if (started) return;
    started = true;
    loadKey();
    await Cache.load();
    subscribe();
    setInterval(() => Cache.save(), 5000);
    setInterval(() => {
      refreshStatus();
      flushOutbox();
    }, 15000);
    setInterval(() => {
      if (Date.now() - lastEventAt > 120000) subscribe();
    }, 60000);
    window.addEventListener('online', () => {
      subscribe();
      flushOutbox();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastEventAt > 30000) subscribe();
    });
    window.addEventListener('pagehide', () => {
      flushActivity(true);
      Cache.save();
    });
    if (ME.pk) listenNotifications();
  }

  async function waitForSync(maxMs = 6000) {
    const started = Date.now();
    while (!synced && Date.now() - started < maxMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return synced;
  }

  async function waitForProfile(maxMs = 8000) {
    const begin = Date.now();
    while (Date.now() - begin < maxMs) {
      if (me()) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (ME.pk) await queryOnce({ kinds: [30078], authors: [ME.pk], '#d': [`${NS}:user:me`] }, 4000);
    DB = null;
    return !!me();
  }

  // ---------------------------------------------------------------------------
  // Offline demo bridge: reports made offline reach Fade's moderators on the relays, and their
  // decisions about demo content come back to every offline device. Uses a throwaway device key.
  // ---------------------------------------------------------------------------
  const OFFLINE_KEY_STORE = `fade.offlinekey.${NS}`;

  function offlineKey() {
    let hex = localStorage.getItem(OFFLINE_KEY_STORE);
    if (!/^[0-9a-f]{64}$/.test(hex || '')) {
      hex = [...NT.generateSecretKey()].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(OFFLINE_KEY_STORE, hex);
    }
    return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
  }

  async function sendOfflineReport({ target, reason, note, preview }) {
    if (!CFG.relays.length) return null;
    const event = NT.finalizeEvent({
      kind: 1984,
      created_at: nowSec(),
      tags: [['t', NS], ['o', `demo:${String(target).slice(0, 60)}`], ['l', String(reason || 'other').slice(0, 20)],
        ['client', 'fade-offline'], ['preview', String(preview || '').slice(0, 140)]],
      content: String(note || '').slice(0, 300),
    }, offlineKey());
    const accepted = await sendToRelays(event, 8000);
    return accepted ? event.id : null;
  }

  async function fetchOfflineDecisions() {
    if (!CFG.admins.length || !CFG.relays.length) return null;
    let events = [];
    try {
      events = await pool.querySync(CFG.relays, { kinds: [30078], authors: CFG.admins, '#d': [`${NS}:mod:list`] }, { maxWait: 6000 });
    } catch (err) {
      return null;
    }
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return { hidden: [], kept: [] };
    try {
      const doc = JSON.parse(latest.content);
      const demo = (list) => (list || []).filter((t) => String(t).startsWith('demo:')).map((t) => t.slice(5));
      return { hidden: demo(doc.hidden), kept: demo(doc.kept), at: latest.created_at };
    } catch (err) {
      return null;
    }
  }

  window.FadeNet = {
    config: CFG,
    offline: { sendReport: sendOfflineReport, fetchDecisions: fetchOfflineDecisions },
    recallPush,
    cleanText,
    scanVerdict: (scan) => scanVerdict(cleanScan(scan)),
    blockedMatch: (hash, ownId) => blockedMatch(hash, ownId),
    hamming: hamming16,
    start,
    handle,
    upload,
    waitForSync,
    waitForProfile,
    onChange: (fn) => listeners.add(fn),
    onNotify: (fn) => notifyListeners.add(fn),
    hasKey: () => !!ME.sk,
    pubkey: () => ME.pk,
    npub: () => (ME.pk ? NT.nip19.npubEncode(ME.pk) : null),
    nsec: () => (ME.sk ? NT.nip19.nsecEncode(ME.sk) : null),
    loginWithKey,
    status: () => {
      refreshStatus();
      return { ...status, synced, events: STORE.byId.size, ns: NS };
    },
    payOptions: payOptionsFor,
    railLabel,
    lnInvoice,
    lnCheck,
    btcUsd,
    commentsFor,
    modQueue,
    describeTarget,
    exportData,
    deleteAccount,
    topic: () => (ME.pk ? topicOf(ME.pk) : null),
    ntfyBase: () => CFG.ntfy,
    isAdmin: () => !!ME.pk && CFG.admins.includes(ME.pk),
    flushActivity: () => flushActivity(true),
    // test hooks
    _debug: { STORE, derive: () => derive(), allBookings, allCommissions, allOrders, allRent, syncHash, startUtcMs, quote },
  };
})();
