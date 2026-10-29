/* Mint Budget sync: end-to-end encrypted live collaboration over a tiny pub/sub relay.
 *
 * Transport: any ntfy-compatible relay (public https://ntfy.sh by default, or the
 * self-hostable apps/mint/budget/server/relay.py). The relay only ever sees ciphertext:
 * the AES-GCM key lives in the share link's #fragment, which browsers never send
 * to a server.
 *
 * Wire format (one relay message each):
 *   k1.<iv>.<ciphertext>          sealed JSON
 *   k2.<iv>.<ciphertext>          sealed, deflate-compressed JSON
 *   ks.<sid>.<i>.<n>.<slice>      one slice of a large sealed payload (snapshots)
 * Payloads: {t:'ops', from, ops:[...]} | {t:'snap', from, ops:[...]} | {t:'hello', from, name, color, n}
 */
(function (root) {
  'use strict';
  const K = root.MintBudget;
  const te = new TextEncoder();
  const td = new TextDecoder();

  K.DEFAULT_RELAY = 'https://ntfy.sh';
  const MAX_MSG = 3800; // ntfy.sh turns bodies > 4 KB into attachments
  const CHUNK = 3000;
  const SNAP_REFRESH_MS = 6 * 3600 * 1000; // ntfy.sh caches messages for 12 h

  // ---------------------------------------------------------------- encoding
  function b64u(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  K.b64u = b64u;
  K.unb64u = unb64u;

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function deflate(bytes) {
    if (!root.CompressionStream) return null;
    try {
      return await pipe(bytes, new CompressionStream('deflate-raw'));
    } catch (e) {
      return null;
    }
  }
  async function inflate(bytes) {
    return pipe(bytes, new DecompressionStream('deflate-raw'));
  }

  // ---------------------------------------------------------------- crypto
  K.newRoomKey = function () {
    const raw = new Uint8Array(32);
    root.crypto.getRandomValues(raw);
    return b64u(raw);
  };
  K.importRoomKey = function (keyStr) {
    const raw = unb64u(keyStr);
    if (raw.length !== 32) throw new Error('Invalid share key');
    return root.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  };
  K.seal = async function (key, obj) {
    let bytes = te.encode(JSON.stringify(obj));
    let tag = 'k1';
    if (bytes.length > 600) {
      const z = await deflate(bytes);
      if (z && z.length < bytes.length) {
        bytes = z;
        tag = 'k2';
      }
    }
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
    return tag + '.' + b64u(iv) + '.' + b64u(ct);
  };
  K.unseal = async function (key, str) {
    const parts = String(str).split('.');
    if (parts.length !== 3 || (parts[0] !== 'k1' && parts[0] !== 'k2')) throw new Error('Not a Mint message');
    const pt = new Uint8Array(
      await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(parts[1]) }, key, unb64u(parts[2]))
    );
    const bytes = parts[0] === 'k2' ? await inflate(pt) : pt;
    return JSON.parse(td.decode(bytes));
  };

  // ---------------------------------------------------------------- links
  K.shareLink = function (base, bookId, key, relay, name) {
    let frag = 'join=' + bookId + '.' + key;
    if (relay && relay !== K.DEFAULT_RELAY) frag += '&relay=' + encodeURIComponent(relay);
    if (name) frag += '&n=' + encodeURIComponent(name);
    return base.split('#')[0] + '#' + frag;
  };
  K.parseJoin = function (hash) {
    const h = String(hash || '').replace(/^#/, '');
    const params = {};
    h.split('&').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (!params.join) return null;
    const m = params.join.match(/^([A-Za-z0-9_-]{8,40})\.([A-Za-z0-9_-]{43})$/);
    if (!m) return null;
    return { bookId: m[1], key: m[2], relay: params.relay || K.DEFAULT_RELAY, name: params.n || '' };
  };

  // ---------------------------------------------------------------- room
  function syncState(bookId) {
    try {
      return JSON.parse(localStorage.getItem('mint.budget.sync.' + bookId) || '{}');
    } catch (e) {
      return {};
    }
  }
  function saveSyncState(bookId, st) {
    try {
      localStorage.setItem('mint.budget.sync.' + bookId, JSON.stringify(st));
    } catch (e) {
      /* storage full or blocked: sync still works for this session */
    }
  }

  function dedupeOps(ops) {
    const latest = new Map();
    ops.forEach((op) => {
      const k = op.c + ':' + (op.id || '');
      const prev = latest.get(k);
      if (!prev || K.isNewer(op.r, prev.r)) latest.set(k, op);
    });
    return Array.from(latest.values());
  }

  class Room {
    constructor(opts) {
      this.bookId = opts.bookId;
      this.keyStr = opts.key;
      this.relay = String(opts.relay || K.DEFAULT_RELAY).replace(/\/+$/, '');
      this.me = opts.me;
      this.getBook = opts.getBook;
      this.onRemote = opts.onRemote || function () {};
      this.onStatus = opts.onStatus || function () {};
      this.onPeer = opts.onPeer || function () {};
      this.queue = [];
      this.snaps = {};
      this.seen = new Set();
      this.peers = {};
      this.chain = Promise.resolve();
      this.replayDone = false;
      this.stopped = false;
      this.backoff = 0;
      this.status = 'idle';
      this.lastId = null;
      const st = syncState(this.bookId);
      this.sentClock = Number(st.sentClock) || 0;
      this.lastSnapAt = 0;
    }

    get topic() {
      // Since 3.1 every budget syncs on "mint-<id>". Devices coming from an older version carry the whole budget
      // locally and post a full snapshot after their first replay here (lastSnapAt starts at 0), so nothing is lost.
      return 'mint-' + this.bookId;
    }
    endpoint(suffix) {
      return [this.relay, this.topic].concat(suffix ? [suffix] : []).join('/');
    }
    setStatus(status, detail) {
      this.status = status;
      this.onStatus(status, detail || '');
    }

    async start() {
      this.key = await K.importRoomKey(this.keyStr);
      this.connect();
      return this;
    }

    stop() {
      this.stopped = true;
      if (this.es) this.es.close();
      clearTimeout(this.retryTimer);
      clearTimeout(this.quietTimer);
      clearTimeout(this.flushTimer);
      clearTimeout(this.snapTimer);
      this.setStatus('idle');
    }

    connect() {
      if (this.stopped) return;
      this.setStatus(this.replayDone ? 'reconnecting' : 'connecting');
      const url = this.endpoint('sse') + '?since=' + encodeURIComponent(this.lastId || 'all');
      const es = new EventSource(url);
      this.es = es;
      es.onopen = () => {
        this.backoff = 0;
        this.setStatus(this.replayDone ? 'live' : 'syncing');
        this.armReplay();
        if (this.replayDone) this.scheduleFlush(200);
      };
      es.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (err) {
          return;
        }
        if (msg.event && msg.event !== 'message') return;
        if (!msg.id || this.seen.has(msg.id)) return;
        this.seen.add(msg.id);
        this.lastId = msg.id;
        this.armReplay();
        this.chain = this.chain.then(() => this.process(msg)).catch(() => {});
      };
      es.onerror = () => {
        es.close();
        if (this.stopped) return;
        this.setStatus('offline', 'Relay unreachable, retrying…');
        const wait = Math.min(30000, 1000 * Math.pow(2, this.backoff++));
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.connect(), wait);
      };
    }

    armReplay() {
      if (this.replayDone) return;
      clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => this.finishReplay(), 1500);
    }

    finishReplay() {
      if (this.replayDone) return;
      this.chain = this.chain.then(async () => {
        this.replayDone = true;
        this.setStatus('live');
        const book = this.getBook();
        const unsent = K.snapshotOps(book).filter((op) => op.r && op.r._by === this.me.id && (op.r._u || 0) > this.sentClock);
        const records = K.snapshotOps(book).length;
        try {
          await this.send({ t: 'hello', from: this.me.id, name: this.me.name, color: this.me.color, n: records });
          if ((this.sentClock === 0 && records > 3) || unsent.length > 40) {
            // first time this device shares the book (or a big offline backlog): send everything once
            await this.publishSnapshot();
          } else if (unsent.length) {
            this.queue = this.queue.concat(unsent);
          }
          if (Date.now() - this.lastSnapAt > SNAP_REFRESH_MS && records > 3) {
            this.scheduleSnapshot(1500 + Math.random() * 2500);
          }
        } catch (e) {
          this.setStatus('offline', String(e.message || e));
        }
        this.scheduleFlush(100);
      });
    }

    async process(msg) {
      const body = String(msg.message || '');
      if (body.indexOf('ks.') === 0) {
        const m = body.match(/^ks\.([A-Za-z0-9]{4,16})\.(\d{1,4})\.(\d{1,4})\.([\s\S]*)$/);
        if (!m) return;
        const sid = m[1];
        const i = Number(m[2]);
        const n = Number(m[3]);
        if (n < 1 || n > 2000 || i >= n) return;
        const entry = this.snaps[sid] || (this.snaps[sid] = { n: n, parts: new Array(n), got: 0 });
        if (entry.parts[i] == null) {
          entry.parts[i] = m[4];
          entry.got++;
        }
        if (entry.got === entry.n) {
          delete this.snaps[sid];
          try {
            const data = await K.unseal(this.key, entry.parts.join(''));
            this.dispatch(data, msg);
          } catch (e) {
            /* wrong key or corrupted: ignore */
          }
        }
        return;
      }
      if (body.indexOf('k1.') !== 0 && body.indexOf('k2.') !== 0) return;
      let data;
      try {
        data = await K.unseal(this.key, body);
      } catch (e) {
        return;
      }
      this.dispatch(data, msg);
    }

    dispatch(data, msg) {
      if (!data || typeof data !== 'object') return;
      const fromMe = data.from === this.me.id;
      const live = this.replayDone;
      const when = (Number(msg.time) || Date.now() / 1000) * 1000;
      if (!fromMe && data.from) {
        const p = this.peers[data.from] || (this.peers[data.from] = { id: data.from });
        p.lastSeen = Math.max(p.lastSeen || 0, when);
        if (data.name) p.name = String(data.name).slice(0, 40);
        if (data.color) p.color = String(data.color).slice(0, 16);
      }
      if (data.t === 'ops' || data.t === 'snap') {
        if (data.t === 'snap') {
          this.lastSnapAt = Math.max(this.lastSnapAt, when);
          if (!fromMe && this.snapTimer && when > Date.now() - 60000) {
            clearTimeout(this.snapTimer);
            this.snapTimer = null;
          }
        }
        const ops = Array.isArray(data.ops) ? data.ops.slice(0, 50000) : [];
        const changed = K.applyOps(this.getBook(), ops);
        if (changed.length) this.onRemote(changed, { from: data.from, kind: live && !fromMe ? 'live' : 'replay', t: data.t });
      } else if (data.t === 'hello' && !fromMe) {
        this.onPeer(this.peers[data.from], live && when > Date.now() - 120000);
        const freshJoiner = (Number(data.n) || 0) <= 3;
        if (live && when > Date.now() - 120000 && (freshJoiner || Date.now() - this.lastSnapAt > 10 * 3600 * 1000)) {
          this.scheduleSnapshot(600 + Math.random() * 2400);
        }
      }
    }

    push(ops) {
      if (!ops || !ops.length) return;
      this.queue = this.queue.concat(ops);
      this.scheduleFlush(700);
    }

    scheduleFlush(delay) {
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), delay == null ? 700 : delay);
    }

    async flush() {
      if (this.stopped || this.flushing || !this.queue.length || !this.replayDone) return;
      this.flushing = true;
      const batch = dedupeOps(this.queue);
      this.queue = [];
      try {
        await this.send({ t: 'ops', from: this.me.id, ops: batch });
        this.markSent(batch);
        if (this.status !== 'live') this.setStatus('live');
      } catch (e) {
        this.queue = batch.concat(this.queue);
        this.setStatus('offline', 'Saved locally; will sync when the relay is reachable.');
        this.flushing = false;
        this.scheduleFlush(5000);
        return;
      }
      this.flushing = false;
      if (this.queue.length) this.scheduleFlush(300);
    }

    markSent(ops) {
      let max = this.sentClock;
      ops.forEach((op) => {
        if (op.r && op.r._by === this.me.id && op.r._u > max) max = op.r._u;
      });
      if (max !== this.sentClock) {
        this.sentClock = max;
        saveSyncState(this.bookId, { sentClock: max });
      }
    }

    scheduleSnapshot(delay) {
      if (this.snapTimer || this.stopped) return;
      this.snapTimer = setTimeout(() => {
        this.snapTimer = null;
        this.publishSnapshot().catch(() => {});
      }, delay);
    }

    async publishSnapshot() {
      const ops = K.snapshotOps(this.getBook());
      await this.send({ t: 'snap', from: this.me.id, name: this.me.name, color: this.me.color, ops: ops });
      this.lastSnapAt = Date.now();
      this.markSent(ops);
    }

    async send(obj) {
      const sealed = await K.seal(this.key, obj);
      if (sealed.length <= MAX_MSG) {
        await this.post(sealed);
        return;
      }
      if (obj.t === 'ops' && obj.ops.length > 1) {
        const mid = Math.ceil(obj.ops.length / 2);
        await this.send(Object.assign({}, obj, { ops: obj.ops.slice(0, mid) }));
        await this.send(Object.assign({}, obj, { ops: obj.ops.slice(mid) }));
        return;
      }
      const sid = K.uid(8);
      const n = Math.ceil(sealed.length / CHUNK);
      for (let i = 0; i < n; i++) {
        await this.post('ks.' + sid + '.' + i + '.' + n + '.' + sealed.slice(i * CHUNK, (i + 1) * CHUNK));
      }
    }

    async post(body, attempt) {
      const res = await fetch(this.endpoint(), { method: 'POST', body: body });
      if (res.status === 429 && (attempt || 0) < 4) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt || 0)));
        return this.post(body, (attempt || 0) + 1);
      }
      if (!res.ok) throw new Error('Relay returned ' + res.status);
    }
  }

  K.Room = Room;
})(typeof window !== 'undefined' ? window : globalThis);
