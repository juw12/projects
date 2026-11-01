/* Mint Budget: log expenses from WhatsApp.
 *
 * People chat "coffee 25k" to Mint's WhatsApp number. The Mint API seals each message to this account's
 * inbox key the moment it arrives and keeps only ciphertext (cloud/src/whatsapp.js). Here, on a signed-in
 * device, Mint opens the sealed items, files them into the chosen budget with the same parser and category
 * history as Quick add, then acknowledges them (which deletes them on the server).
 *
 * The inbox key is a P-256 ECDH pair made on the device. Its private half is uploaded only sealed with the
 * account's sync key (MintCloud.seal), so every signed-in device can open the inbox and the server never can.
 *
 * Every entry gets a stable id (K.chatTxnId of the WhatsApp message id), so two devices filing the same
 * message write the same record and the budget merge keeps one copy.
 */
(function (root) {
  'use strict';
  const K = root.MintBudget;
  const STATE_KEY = 'mint.budget.wa';
  const SEALED_ITEM = 'wa-inbox-key';
  const POLL_MS = 20000;
  const STATUS_EVERY = 5 * 60 * 1000;
  const te = new TextEncoder();
  const INFO = te.encode('mint-wa-inbox-v1');
  const AAD = te.encode('mint-wa-inbox');

  function unb64u(text) {
    const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Open one sealed inbox item ("e1.<epk>.<iv>.<ct>") with the inbox private key (a CryptoKey). */
  K.openInboxItem = async function (privateKey, blob) {
    const parts = String(blob || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'e1') throw new Error('Unknown inbox item format');
    const subtle = root.crypto.subtle;
    const epkRaw = unb64u(parts[1]);
    const epk = await subtle.importKey('raw', epkRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await subtle.deriveBits({ name: 'ECDH', public: epk }, privateKey, 256);
    const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epkRaw, info: INFO }, ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(parts[2]), additionalData: AAD }, key, unb64u(parts[3]));
    return JSON.parse(new TextDecoder().decode(plain));
  };

  /**
   * File one opened inbox item into a book (in place). Pure apart from the book, so tests can call it.
   * item: {k: 'txt', text, mid, at} or {k: 'undo', at}; `at` is the WhatsApp timestamp in seconds.
   * Returns {ops, added: [txn], removed: [txn]}.
   */
  K.applyChatItem = function (book, item, me) {
    const out = { ops: [], added: [], removed: [] };
    if (!book || !item || !item.k) return out;
    const sentAt = (Number(item.at) || Math.floor(Date.now() / 1000)) * 1000;
    if (item.k === 'undo') {
      const last = K.list(book, 'txns')
        .filter((t) => t.src === 'wa' && (t.createdAt || 0) <= sentAt + 1000)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      if (last) {
        const op = K.remove(book, 'txns', last.id, me);
        if (op) {
          out.ops.push(op);
          out.removed.push(last);
        }
      }
      return out;
    }
    if (item.k !== 'txt' || !item.mid) return out;
    const base = book.meta.currency;
    // WhatsApp timestamps are whole seconds, so keep WhatsApp entries strictly in arrival order
    // (that is what "undo" means by the last one).
    let lastFiled = 0;
    K.list(book, 'txns').forEach((t) => {
      if (t.src === 'wa' && (t.createdAt || 0) > lastFiled) lastFiled = t.createdAt;
    });
    K.parseQuickLines(item.text).forEach((line, index) => {
      const p = line.parsed;
      if (!p) return;
      const id = K.chatTxnId(item.mid, index);
      // Filed before (by this or another device), or filed and then deleted/undone: leave it alone.
      if (book.txns && Object.prototype.hasOwnProperty.call(book.txns, id)) return;
      const desc = p.desc || (p.type === 'income' ? 'Income' : 'Expense');
      const txn = {
        id: id,
        date: K.isoDate(new Date(sentAt + p.dayOffset * 86400000)),
        desc: desc.slice(0, 80),
        type: p.type,
        cat: p.type === 'income' ? '' : K.guessCategory(book, desc),
        who: me,
        createdAt: Math.max(sentAt + index, lastFiled + 1),
        src: 'wa',
        amount: p.amount,
      };
      if (p.cur && p.cur !== base) {
        const rate = K.rate(p.cur, base);
        if (isFinite(rate) && rate > 0) {
          txn.amount = K.roundMoney(p.amount * rate, base);
          txn.fx = { cur: p.cur, amt: p.amount, rate: rate };
        } else {
          txn.desc = (desc + ' (' + p.amount + ' ' + p.cur + ')').slice(0, 80);
        }
      }
      lastFiled = txn.createdAt;
      out.ops.push(K.put(book, 'txns', txn, me));
      out.added.push(txn);
    });
    return out;
  };

  /**
   * adapter: { bookIds(), currentBookId(), loadBook(id), fileOps(bookId, book, ops), me(),
   *            currency(bookId), onFiled({bookId, added, removed}), onStatus(status) }
   */
  K.createWhatsApp = function (adapter) {
    const MC = root.MintCloud;
    let prefs = load();
    let status = null;
    let statusAt = 0;
    let privateKey = null;
    let keyFor = '';
    let busy = null;
    let timer = null;
    let started = false;

    function load() {
      try {
        const s = JSON.parse(root.localStorage.getItem(STATE_KEY) || 'null');
        if (s && typeof s === 'object') return Object.assign({ bookId: '', linked: false }, s);
      } catch (e) {
        /* fall through */
      }
      return { bookId: '', linked: false };
    }
    function save() {
      try {
        root.localStorage.setItem(STATE_KEY, JSON.stringify(prefs));
      } catch (e) {
        /* storage full: the setting resets to the open budget */
      }
    }
    function ready() {
      return !!(MC && MC.signedIn() && MC.unlocked() && root.crypto && root.crypto.subtle);
    }
    function targetBookId() {
      const ids = adapter.bookIds().filter((id) => !/^demo-/.test(id));
      if (prefs.bookId && ids.indexOf(prefs.bookId) >= 0) return prefs.bookId;
      const cur = adapter.currentBookId();
      return cur && ids.indexOf(cur) >= 0 ? cur : ids[0] || '';
    }
    function emit() {
      if (adapter.onStatus) adapter.onStatus(status);
    }

    async function refresh() {
      status = await MC.call('GET', 'whatsapp');
      statusAt = Date.now();
      prefs.linked = !!(status && status.phones && status.phones.length);
      save();
      emit();
      return status;
    }

    async function unlockKey() {
      if (!status || !status.key) return null;
      if (privateKey && keyFor === status.key.publicKey.x) return privateKey;
      const opened = await MC.open(SEALED_ITEM, status.key.sealed);
      privateKey = await root.crypto.subtle.importKey('jwk', opened.jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      keyFor = status.key.publicKey.x;
      return privateKey;
    }

    /** Make sure the account has an inbox key this device can open, and that it carries the budget currency. */
    async function ensureKey(bookId) {
      await refresh();
      const currency = adapter.currency(bookId) || '';
      if (status.key) {
        try {
          await unlockKey();
          if (currency && status.key.currency !== currency) {
            status = await MC.call('POST', 'whatsapp/key', { publicKey: status.key.publicKey, sealed: status.key.sealed, currency: currency });
            emit();
          }
          return status;
        } catch (e) {
          // Sealed with an older sync key: make a new inbox key (items for the old one are unreadable anyway).
        }
      }
      const pair = await root.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const publicJwk = await root.crypto.subtle.exportKey('jwk', pair.publicKey);
      const privateJwk = await root.crypto.subtle.exportKey('jwk', pair.privateKey);
      const sealed = await MC.seal(SEALED_ITEM, { v: 1, jwk: privateJwk });
      status = await MC.call('POST', 'whatsapp/key', { publicKey: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y }, sealed: sealed, currency: currency });
      privateKey = pair.privateKey;
      keyFor = publicJwk.x;
      emit();
      return status;
    }

    /** Fetch, open and file everything waiting. Returns the number of entries added. */
    async function pull() {
      if (!ready()) return 0;
      if (!status || Date.now() - statusAt > STATUS_EVERY) await refresh();
      if (!status.key) return 0;
      let added = 0;
      let more = true;
      while (more) {
        const res = await MC.call('GET', 'whatsapp/inbox');
        more = !!res.more;
        if (!res.items.length) break;
        const key = await unlockKey();
        const opened = [];
        for (const item of res.items) {
          try {
            opened.push({ id: item.id, value: await K.openInboxItem(key, item.data) });
          } catch (e) {
            opened.push({ id: item.id, value: null }); // sealed to a key nobody has any more: drop it
          }
        }
        opened.sort((a, b) => ((a.value && a.value.at) || 0) - ((b.value && b.value.at) || 0));
        const bookId = targetBookId();
        const book = bookId ? adapter.loadBook(bookId) : null;
        if (!book) return added; // no budget yet: leave the items waiting
        const ops = [];
        const summary = { bookId: bookId, added: [], removed: [] };
        opened.forEach((o) => {
          if (!o.value) return;
          const r = K.applyChatItem(book, o.value, adapter.me());
          ops.push.apply(ops, r.ops);
          summary.added.push.apply(summary.added, r.added);
          summary.removed.push.apply(summary.removed, r.removed);
        });
        if (ops.length) adapter.fileOps(bookId, book, ops);
        await MC.call('POST', 'whatsapp/inbox/ack', { ids: opened.map((o) => o.id) });
        if (summary.added.length || summary.removed.length) adapter.onFiled(summary);
        added += summary.added.length;
      }
      if (status) status.pending = 0;
      return added;
    }

    function run() {
      if (busy) return busy;
      busy = pull()
        .catch((e) => {
          if (e && e.status === 401) status = null;
          return 0;
        })
        .then((n) => {
          busy = null;
          return n;
        });
      return busy;
    }

    function start() {
      if (started) return;
      started = true;
      const tick = () => {
        if (prefs.linked && ready() && !root.document.hidden) run();
      };
      timer = setInterval(tick, POLL_MS);
      root.addEventListener('focus', tick);
      root.addEventListener('online', tick);
      root.document.addEventListener('visibilitychange', tick);
      if (MC) MC.onChange(tick);
      setTimeout(tick, 1500);
    }

    return {
      start: start,
      run: run,
      ready: ready,
      status: () => status,
      bookId: targetBookId,
      refresh: () => (ready() ? refresh() : Promise.resolve(null)),
      /** Returns {code, message, url, number, expires} to show the user. */
      connect: async function (bookId) {
        if (bookId) {
          prefs.bookId = bookId;
          save();
        }
        await ensureKey(targetBookId());
        return MC.call('POST', 'whatsapp/link', {});
      },
      setBook: async function (bookId) {
        prefs.bookId = bookId;
        save();
        if (status && status.key) await ensureKey(bookId);
        return run();
      },
      removePhone: async function (id) {
        status = await MC.call('DELETE', 'whatsapp/phones/' + encodeURIComponent(id));
        prefs.linked = !!status.phones.length;
        save();
        emit();
        return status;
      },
      disconnect: async function () {
        await MC.call('DELETE', 'whatsapp');
        prefs = { bookId: '', linked: false };
        save();
        status = null;
        privateKey = null;
        keyFor = '';
        emit();
      },
      /** Forget local state (sign out). */
      reset: function () {
        prefs = { bookId: '', linked: false };
        save();
        status = null;
        privateKey = null;
        keyFor = '';
        clearInterval(timer);
        started = false;
      },
    };
  };
})(window);
