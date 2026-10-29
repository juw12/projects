/* Mint Budget: account sync across devices.
 *
 * Every budget is one encrypted item ("book:<id>") and the profile/preferences another ("prefs"), stored by the
 * Mint API per account (see ../js/mint-cloud.js for the keys and sealing). Budgets are CRDTs (cell-level
 * last-writer-wins, core.js), so merging is just applying the other copy's records: two devices that edited
 * offline converge without losing either edit. Revisions make uploads safe: an upload based on an old revision
 * is refused, the device pulls, merges and tries again.
 *
 * The app passes an adapter: { bookIds(), loadBook(id), saveBook(book, changedOps), addBook(book), removeBook(id),
 * prefs(), applyPrefs(prefs), onStatus(status), onChange(kind) }.
 */
(function (root) {
  'use strict';
  const K = root.MintBudget;
  const STATE_KEY = 'mint.budget.cloud';
  const POLL_MS = 15000;
  const PUSH_DELAY = 1200;
  const MAX_BATCH_CHARS = 300000;

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }
  K.canonical = canonical;

  /** Merge a remote book into a local one (in place). Returns {changed: ops applied, localHasMore}. */
  K.mergeBooks = function (local, remote) {
    const changed = K.applyOps(local, K.snapshotOps(remote));
    if (remote.room && remote.room.key && !(local.room && local.room.key)) local.room = remote.room;
    const strip = (b) => {
      const out = {};
      ['meta'].concat(K.COLLECTIONS).forEach((k) => (out[k] = b[k] || {}));
      return out;
    };
    return { changed: changed, localHasMore: canonical(strip(local)) !== canonical(strip(remote)) };
  };

  K.createCloudSync = function (adapter) {
    const MC = root.MintCloud;
    let state = load();
    let status = 'off';
    let detail = '';
    let busy = null;
    let pushTimer = null;
    let pollTimer = null;
    let started = false;
    const versions = {};

    function load() {
      try {
        const s = JSON.parse(root.localStorage.getItem(STATE_KEY) || 'null');
        if (s && typeof s === 'object') return Object.assign({ rev: 0, revs: {}, dirty: {}, keyId: '', merged: false, lastSync: 0 }, s);
      } catch (e) {
        /* fall through */
      }
      return { rev: 0, revs: {}, dirty: {}, keyId: '', merged: false, lastSync: 0 };
    }
    function save() {
      try {
        root.localStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch (e) {
        /* storage full: the next sync redoes the work */
      }
    }
    function setStatus(s, d) {
      if (s === status && (d || '') === detail) return;
      status = s;
      detail = d || '';
      if (adapter.onStatus) adapter.onStatus(status, detail);
    }
    function ready() {
      return !!(MC && MC.signedIn() && MC.unlocked());
    }
    function syncable(id) {
      return id && !/^demo-/.test(id);
    }

    function markDirty(key) {
      if (!ready()) return;
      state.dirty[key] = 1;
      versions[key] = (versions[key] || 0) + 1;
      save();
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => run(), PUSH_DELAY);
    }

    async function pull() {
      let more = true;
      let changedAny = false;
      while (more) {
        const res = await MC.call('GET', 'sync?since=' + state.rev);
        if (res.keyId && res.keyId !== MC.keyId()) {
          const err = new Error('This account\u2019s sync key changed on another device. Sign in again to unlock it.');
          err.code = 'locked';
          throw err;
        }
        for (const item of res.items) {
          const id = item.key.indexOf('book:') === 0 ? item.key.slice(5) : '';
          if (item.deleted) {
            if (id && !state.dirty[item.key] && adapter.loadBook(id)) {
              adapter.removeBook(id);
              changedAny = true;
            }
            state.revs[item.key] = item.rev;
            continue;
          }
          let value;
          try {
            value = await MC.open(item.key, item.data);
          } catch (e) {
            const err = new Error('Could not unlock synced data on this device. Sign in again.');
            err.code = 'locked';
            throw err;
          }
          if (id && value && value.book && value.book.id === id) {
            const local = adapter.loadBook(id);
            if (!local) {
              adapter.addBook(value.book);
              changedAny = true;
            } else {
              const res2 = K.mergeBooks(local, value.book);
              if (res2.changed.length) {
                adapter.saveBook(local, res2.changed);
                changedAny = true;
              }
              if (res2.localHasMore) state.dirty[item.key] = 1;
            }
          } else if (item.key === 'prefs' && value) {
            if (adapter.applyPrefs(value)) changedAny = true;
          }
          state.revs[item.key] = item.rev;
        }
        state.rev = res.rev && !res.more ? Math.max(state.rev, res.rev) : Math.max(state.rev, res.items.length ? res.items[res.items.length - 1].rev : state.rev);
        more = !!res.more;
      }
      save();
      if (changedAny && adapter.onChange) adapter.onChange('pull');
      return changedAny;
    }

    async function payload(key) {
      if (key === 'prefs') return adapter.prefs();
      const id = key.slice(5);
      const book = adapter.loadBook(id);
      return book ? { v: 1, kind: 'book', book: book } : null;
    }

    async function push() {
      const keys = Object.keys(state.dirty);
      if (!keys.length) return { conflicts: 0 };
      let conflicts = 0;
      let i = 0;
      while (i < keys.length) {
        const batch = [];
        const sentVersion = {};
        let size = 0;
        while (i < keys.length && batch.length < 20) {
          const key = keys[i];
          const value = await payload(key);
          let item;
          if (!value) {
            item = { key: key, deleted: true, base: state.revs[key] || 0 };
          } else {
            item = { key: key, data: await MC.seal(key, value), base: state.revs[key] || 0 };
            if (item.data.length > 345000) {
              delete state.dirty[key];
              i++;
              setStatus('error', 'A budget is too large to sync. Archive old transactions to a backup.');
              continue;
            }
          }
          const len = (item.data || '').length + 80;
          if (batch.length && size + len > MAX_BATCH_CHARS) break;
          batch.push(item);
          sentVersion[key] = versions[key] || 0;
          size += len;
          i++;
        }
        if (!batch.length) continue;
        const res = await MC.call('POST', 'sync', { keyId: MC.keyId(), items: batch });
        const revs = [];
        res.results.forEach((r) => {
          if (r.conflict) {
            conflicts++;
            return;
          }
          state.revs[r.key] = r.rev;
          revs.push(r.rev);
          if ((versions[r.key] || 0) === sentVersion[r.key]) delete state.dirty[r.key];
        });
        // Our own uploads need not be downloaded again when nobody else wrote in between.
        revs.sort((a, b) => a - b);
        if (revs.length && revs[0] === state.rev + 1 && revs[revs.length - 1] === state.rev + revs.length) state.rev = revs[revs.length - 1];
        save();
      }
      return { conflicts: conflicts };
    }

    async function cycle() {
      if (!ready()) {
        setStatus(MC && MC.signedIn() ? 'locked' : 'off');
        return;
      }
      if (!root.navigator.onLine) {
        setStatus('offline');
        return;
      }
      setStatus('syncing');
      try {
        if (state.keyId && state.keyId !== MC.keyId()) {
          // A different account (or a new key) on this device: start the bookkeeping fresh.
          state = { rev: 0, revs: {}, dirty: {}, keyId: MC.keyId(), merged: state.merged, lastSync: 0 };
          markAll();
        }
        state.keyId = MC.keyId();
        await pull();
        for (let round = 0; round < 3; round++) {
          const out = await push();
          if (!out.conflicts) break;
          await pull();
        }
        state.lastSync = Date.now();
        save();
        setStatus(Object.keys(state.dirty).length ? 'pending' : 'synced');
      } catch (e) {
        if (e.code === 'locked' || (e.status === 409 && e.data && e.data.keyChanged)) {
          MC.lock();
          setStatus('locked', e.message);
        } else if (e.status === 401) {
          setStatus('off', e.message);
        } else if (e.status === 0) {
          setStatus('offline', e.message);
        } else {
          setStatus('error', e.message);
        }
      }
    }

    function run() {
      if (busy) {
        busy.again = true;
        return busy.promise;
      }
      const job = { again: false };
      job.promise = (async () => {
        do {
          job.again = false;
          await cycle();
        } while (job.again);
        busy = null;
      })();
      busy = job;
      return job.promise;
    }

    function markAll() {
      adapter.bookIds().filter(syncable).forEach((id) => (state.dirty['book:' + id] = 1));
      state.dirty.prefs = 1;
      save();
    }

    function start() {
      if (started) return;
      started = true;
      const tick = () => {
        if (ready() && !root.document.hidden) run();
      };
      pollTimer = setInterval(tick, POLL_MS);
      root.addEventListener('focus', tick);
      root.addEventListener('online', tick);
      root.document.addEventListener('visibilitychange', tick);
      if (MC) MC.onChange(() => {
        if (!MC.signedIn()) {
          setStatus('off');
        } else if (!MC.unlocked()) {
          setStatus('locked');
        } else {
          tick();
        }
      });
      if (ready()) run();
      else setStatus(MC && MC.signedIn() ? 'locked' : 'off');
    }

    return {
      start: start,
      run: run,
      status: () => status,
      detail: () => detail,
      lastSync: () => state.lastSync,
      merged: () => state.merged,
      ready: ready,
      /** First sign-in on this device: upload what is here and merge it with the account. */
      adoptLocal: function () {
        state.merged = true;
        markAll();
        return run();
      },
      skipLocal: function () {
        state.merged = true;
        save();
        return run();
      },
      bookChanged: function (id) {
        if (syncable(id)) markDirty('book:' + id);
      },
      bookDeleted: function (id) {
        if (syncable(id) && (state.revs['book:' + id] || state.dirty['book:' + id])) markDirty('book:' + id);
      },
      prefsChanged: function () {
        markDirty('prefs');
      },
      /** Forget this device's sync bookkeeping (sign out); local budgets stay. */
      reset: function () {
        state = { rev: 0, revs: {}, dirty: {}, keyId: '', merged: false, lastSync: 0 };
        save();
        setStatus('off');
      },
    };
  };
})(window);
