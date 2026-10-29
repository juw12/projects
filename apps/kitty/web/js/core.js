/* Kitty core: pure budgeting logic (no DOM). Shared by the app and tests.html.
 *
 * Data model: a "book" is a shared budget. Every record carries
 *   _u  (update clock, ms; Lamport-adjusted)   _by (member id)   _del (tombstone)
 * Merging is per-record last-writer-wins, so edits from several people (or
 * several tabs/devices) converge no matter the order they arrive in.
 */
(function (root) {
  'use strict';
  const K = (root.Kitty = root.Kitty || {});
  K.VERSION = '1.3.0';

  // ---------------------------------------------------------------- ids, clock
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  K.uid = function (len) {
    const n = len || 12;
    const bytes = new Uint8Array(n);
    root.crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < n; i++) out += B62[bytes[i] % 62];
    return out;
  };

  let lastTick = 0;
  K.tick = function () {
    const now = Date.now();
    lastTick = now > lastTick ? now : lastTick + 1;
    return lastTick;
  };
  K.observeTick = function (t) {
    if (typeof t === 'number' && t > lastTick && t < Date.now() + 864e5 * 365) lastTick = t;
  };

  // ---------------------------------------------------------------- book + merge
  K.COLLECTIONS = ['incomes', 'categories', 'txns', 'goals', 'holdings', 'members'];
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

  K.newBook = function (opts) {
    const o = opts || {};
    return {
      v: 1,
      id: o.id || K.uid(18),
      meta: {
        name: o.name || 'My budget',
        currency: o.currency || 'IDR',
        alertAt: 80,
        target: o.target || null,
        // A joiner's placeholder meta is unstamped (clock 0) so the shared meta always wins.
        _u: o.unstamped ? 0 : K.tick(),
        _by: o.by || '',
      },
      incomes: {},
      categories: {},
      txns: {},
      goals: {},
      holdings: {},
      members: {},
    };
  };

  function isNewer(a, b) {
    if (!b) return true;
    const au = Number(a._u) || 0;
    const bu = Number(b._u) || 0;
    if (au !== bu) return au > bu;
    return String(a._by || '') > String(b._by || '');
  }
  K.isNewer = isNewer;

  function plain(rec) {
    return rec && typeof rec === 'object' && !Array.isArray(rec);
  }

  // Cell-level last-writer-wins: every field carries its own clock in _f, so two
  // people editing different cells of the same row both keep their edit.
  const META_KEYS = { _u: 1, _by: 1, _f: 1, id: 1 };
  const UNSAFE_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function fieldClock(rec, k) {
    return rec._f && rec._f[k] != null ? Number(rec._f[k]) : Number(rec._u) || 0;
  }
  function sameVal(x, y) {
    if (x === y) return true;
    if (x && y && typeof x === 'object' && typeof y === 'object') return JSON.stringify(x) === JSON.stringify(y);
    return false;
  }

  /** Merge record b into a. Returns {rec, changed}. */
  K.mergeRecord = function (a, b) {
    if (!a) {
      const copy = {};
      Object.keys(b).forEach((k) => {
        if (!UNSAFE_KEYS[k]) copy[k] = b[k];
      });
      return { rec: copy, changed: true };
    }
    const out = {};
    const clocks = {};
    let changed = false;
    const keys = {};
    Object.keys(a).concat(Object.keys(b)).forEach((k) => (keys[k] = 1));
    Object.keys(keys).forEach((k) => {
      if (META_KEYS[k] || UNSAFE_KEYS[k]) return;
      const hasA = has(a, k);
      const hasB = has(b, k);
      const ca = hasA ? fieldClock(a, k) : -1;
      const cb = hasB ? fieldClock(b, k) : -1;
      const takeB = hasB && (cb > ca || (cb === ca && String(b._by || '') > String(a._by || '')));
      if (takeB) {
        out[k] = b[k];
        clocks[k] = cb;
        if (!hasA || !sameVal(a[k], b[k])) changed = true;
      } else {
        out[k] = a[k];
        clocks[k] = ca;
      }
    });
    out._u = Math.max(Number(a._u) || 0, Number(b._u) || 0);
    out._by = isNewer(b, a) ? b._by : a._by;
    out._f = clocks;
    return { rec: out, changed: changed };
  };

  /** Apply one op {c, id, r}. Returns true when visible data changed. */
  K.applyOp = function (book, op) {
    if (!op || !plain(op.r)) return false;
    if (op.c === 'meta') {
      const m = K.mergeRecord(book.meta, op.r);
      delete m.rec.id;
      book.meta = m.rec;
      K.observeTick(op.r._u);
      return m.changed;
    }
    if (K.COLLECTIONS.indexOf(op.c) < 0 || !ID_RE.test(String(op.id)) || UNSAFE_KEYS[op.id]) return false;
    const coll = book[op.c] || (book[op.c] = {});
    const cur = has(coll, op.id) ? coll[op.id] : null;
    const m = K.mergeRecord(cur, op.r);
    m.rec.id = op.id;
    coll[op.id] = m.rec;
    K.observeTick(op.r._u);
    return m.changed;
  };

  function buildRecord(cur, rec, t, by) {
    const out = Object.assign({}, cur || {});
    const clocks = {};
    if (cur) {
      Object.keys(cur).forEach((k) => {
        if (!META_KEYS[k]) clocks[k] = fieldClock(cur, k);
      });
    }
    Object.keys(rec).forEach((k) => {
      if (META_KEYS[k] || UNSAFE_KEYS[k]) return;
      if (!cur || !has(cur, k) || !sameVal(cur[k], rec[k])) clocks[k] = t;
      out[k] = rec[k];
    });
    out._u = t;
    out._by = by || '';
    out._f = clocks;
    return out;
  }

  /** Create or update a record locally (only changed fields get a new clock). Returns the op to broadcast. */
  K.put = function (book, c, rec, by) {
    const t = K.tick();
    if (c === 'meta') {
      const r = buildRecord(book.meta, rec, t, by);
      delete r.id;
      const op = { c: 'meta', r: r };
      K.applyOp(book, op);
      return op;
    }
    const id = rec.id && !UNSAFE_KEYS[rec.id] ? rec.id : K.uid(12);
    const coll = book[c] || (book[c] = {});
    const cur = has(coll, id) ? coll[id] : null;
    const r = buildRecord(cur, Object.assign({}, rec, { id: id }), t, by);
    r.id = id;
    const op = { c: c, id: id, r: r };
    K.applyOp(book, op);
    return op;
  };

  K.remove = function (book, c, id, by) {
    const cur = book[c] && book[c][id];
    if (!cur) return null;
    return K.put(book, c, { id: id, _del: true }, by);
  };

  K.restore = function (book, c, id, by) {
    const cur = book[c] && book[c][id];
    if (!cur) return null;
    return K.put(book, c, { id: id, _del: false }, by);
  };

  K.list = function (book, c) {
    const coll = (book && book[c]) || {};
    return Object.keys(coll)
      .map((k) => coll[k])
      .filter((r) => r && !r._del);
  };

  K.snapshotOps = function (book) {
    const ops = [{ c: 'meta', r: book.meta }];
    K.COLLECTIONS.forEach((c) => {
      Object.keys(book[c] || {}).forEach((id) => ops.push({ c: c, id: id, r: book[c][id] }));
    });
    return ops;
  };

  K.applyOps = function (book, ops) {
    const changed = [];
    (ops || []).forEach((op) => {
      if (K.applyOp(book, op)) changed.push(op);
    });
    return changed;
  };

  // ---------------------------------------------------------------- money
  // Best-guess currency from the device languages (e.g. 'id-ID' -> IDR, 'en-GB' -> GBP). Users can change it in setup.
  const REGION_CURRENCY = {
    ID: 'IDR', US: 'USD', SG: 'SGD', GB: 'GBP', MY: 'MYR', AU: 'AUD', JP: 'JPY', TW: 'TWD', CN: 'CNY', PH: 'PHP',
    TH: 'THB', VN: 'VND', IN: 'INR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
    AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR',
  };
  const LANG_CURRENCY = { id: 'IDR', ms: 'MYR', ja: 'JPY', th: 'THB', vi: 'VND', zh: 'CNY', de: 'EUR', fr: 'EUR', it: 'EUR', nl: 'EUR', pt: 'EUR', es: 'EUR' };
  K.guessCurrency = function (languages) {
    const list = Array.isArray(languages) ? languages : [languages];
    for (let i = 0; i < list.length; i++) {
      const m = /^([a-z]{2,3})(?:[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2}))?/i.exec(String(list[i] || ''));
      if (!m) continue;
      const region = m[2] ? m[2].toUpperCase() : '';
      if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
      const lang = m[1].toLowerCase();
      if (LANG_CURRENCY[lang]) return LANG_CURRENCY[lang];
    }
    return 'USD';
  };

  K.CURRENCIES = {
    IDR: { locale: 'id-ID', dec: 0, label: 'Indonesian rupiah' },
    USD: { locale: 'en-US', dec: 2, label: 'US dollar' },
    SGD: { locale: 'en-SG', dec: 2, label: 'Singapore dollar' },
    EUR: { locale: 'en-IE', dec: 2, label: 'Euro' },
    GBP: { locale: 'en-GB', dec: 2, label: 'British pound' },
    MYR: { locale: 'ms-MY', dec: 2, label: 'Malaysian ringgit' },
    AUD: { locale: 'en-AU', dec: 2, label: 'Australian dollar' },
    JPY: { locale: 'ja-JP', dec: 0, label: 'Japanese yen' },
    TWD: { locale: 'zh-TW', dec: 0, label: 'New Taiwan dollar' },
    CNY: { locale: 'zh-CN', dec: 2, label: 'Chinese yuan' },
    PHP: { locale: 'en-PH', dec: 2, label: 'Philippine peso' },
    THB: { locale: 'th-TH', dec: 2, label: 'Thai baht' },
    VND: { locale: 'vi-VN', dec: 0, label: 'Vietnamese dong' },
    INR: { locale: 'en-IN', dec: 2, label: 'Indian rupee' },
  };
  const fmtCache = {};
  function formatter(cur, short) {
    const key = cur + (short ? ':s' : '');
    if (!fmtCache[key]) {
      const info = K.CURRENCIES[cur] || K.CURRENCIES.USD;
      const opts = { style: 'currency', currency: K.CURRENCIES[cur] ? cur : 'USD' };
      if (short) {
        opts.notation = 'compact';
        opts.maximumFractionDigits = 1;
      } else {
        opts.minimumFractionDigits = info.dec;
        opts.maximumFractionDigits = info.dec;
      }
      fmtCache[key] = new Intl.NumberFormat(info.locale, opts);
    }
    return fmtCache[key];
  }
  K.fmt = function (n, cur, short) {
    const v = Number(n) || 0;
    return formatter(cur || 'IDR', !!short).format(v);
  };
  const plainCache = {};
  K.fmtPlain = function (n, cur) {
    const c = cur || 'IDR';
    if (!plainCache[c]) {
      const info = K.CURRENCIES[c] || K.CURRENCIES.USD;
      plainCache[c] = new Intl.NumberFormat(info.locale, { minimumFractionDigits: 0, maximumFractionDigits: info.dec });
    }
    const v = Number(n);
    return isFinite(v) && n !== '' && n != null ? plainCache[c].format(v) : '';
  };
  K.decimals = function (cur) {
    return (K.CURRENCIES[cur] || K.CURRENCIES.USD).dec;
  };

  /** Parse "25k", "1.5jt", "Rp 25.000", "1,250.50", "12,50" into a number. */
  K.parseAmount = function (input, cur) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    let s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return NaN;
    s = s.replace(/\s+/g, '').replace(/^(rp|idr|usd|sgd|s\$|us\$|eur|gbp|rm|myr|\$|€|£|¥|₱|฿|₫|₹)/, '');
    let mult = 1;
    const suffix = s.match(/(ribu|rb|k|juta|jt|mn|m|miliar|milyar|bn|b)$/);
    if (suffix) {
      const u = suffix[1];
      mult = /^(ribu|rb|k)$/.test(u) ? 1e3 : /^(juta|jt|mn|m)$/.test(u) ? 1e6 : 1e9;
      s = s.slice(0, -u.length);
    }
    if (!/^[-+]?[0-9.,]+$/.test(s)) return NaN;
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    let norm = s;
    if (dots && commas) {
      const decSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      const thouSep = decSep === '.' ? ',' : '.';
      norm = s.split(thouSep).join('').replace(decSep, '.');
    } else if (dots) {
      const thousands = dots > 1 || (mult === 1 && /\.\d{3}$/.test(s) && !/^0\./.test(s));
      norm = thousands ? s.split('.').join('') : s;
    } else if (commas) {
      const thousands = commas > 1 || /,\d{3}$/.test(s);
      norm = thousands ? s.split(',').join('') : s.replace(',', '.');
    }
    const v = parseFloat(norm) * mult;
    if (!isFinite(v)) return NaN;
    return Math.round(v * 100) / 100;
  };

  /** Round to a "nice" budget number: 2 significant-ish digits (3 for big values). */
  K.niceRound = function (x, cur) {
    const v = Math.max(0, Number(x) || 0);
    if (v === 0) return 0;
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 2);
    const step = Math.max(mag, K.decimals(cur) === 0 ? 1 : 0.01);
    return Math.round(v / step) * step;
  };

  // ---------------------------------------------------------------- dates
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  K.isoDate = function (d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  K.today = function () {
    return K.isoDate(new Date());
  };
  K.monthKey = function (dateStr) {
    return String(dateStr).slice(0, 7);
  };
  K.daysInMonth = function (mk) {
    const y = Number(mk.slice(0, 4));
    const m = Number(mk.slice(5, 7));
    return new Date(y, m, 0).getDate();
  };
  K.shiftMonth = function (mk, delta) {
    const y = Number(mk.slice(0, 4));
    const m = Number(mk.slice(5, 7)) - 1 + delta;
    const d = new Date(y, m, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };
  K.monthLabel = function (mk, long) {
    const d = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1);
    const locale = (K.i18n && K.i18n.locale) || 'en-US';
    return d.toLocaleDateString(locale, { month: long ? 'long' : 'short', year: 'numeric' });
  };

  // ---------------------------------------------------------------- budgeting math
  K.FREQ = {
    weekly: { label: 'Weekly', perMonth: 52 / 12 },
    biweekly: { label: 'Every 2 weeks', perMonth: 26 / 12 },
    monthly: { label: 'Monthly', perMonth: 1 },
    quarterly: { label: 'Quarterly', perMonth: 1 / 3 },
    yearly: { label: 'Yearly', perMonth: 1 / 12 },
  };
  K.monthlyIncome = function (book) {
    return K.list(book, 'incomes').reduce((s, inc) => {
      const f = K.FREQ[inc.freq] || K.FREQ.monthly;
      return s + (Number(inc.amount) || 0) * f.perMonth;
    }, 0);
  };

  K.GROUPS = {
    needs: { label: 'Needs', color: '#5b8def', hint: 'Bills and essentials' },
    wants: { label: 'Wants', color: '#f2994a', hint: 'Lifestyle and fun' },
    savings: { label: 'Savings', color: '#27ae60', hint: 'Emergency fund, goals, debt payoff' },
    invest: { label: 'Investing', color: '#9b51e0', hint: 'Long-term wealth' },
  };
  const SAVED_GROUPS = { savings: 1, invest: 1 };

  const STATUS_RANK = { ok: 0, pace: 1, warn: 2, over: 3 };
  K.STATUS_RANK = STATUS_RANK;

  K.monthStats = function (book, mk, todayStr) {
    const today = todayStr || K.today();
    const dim = K.daysInMonth(mk);
    const curMk = K.monthKey(today);
    const isCurrent = mk === curMk;
    const isPast = mk < curMk;
    const day = isCurrent ? Number(today.slice(8, 10)) : isPast ? dim : 0;
    const alertAt = (Number(book.meta.alertAt) || 80) / 100;

    const cats = K.list(book, 'categories').sort((a, b) => (a.order || 0) - (b.order || 0));
    const catById = {};
    cats.forEach((c) => (catById[c.id] = c));
    const txns = K.list(book, 'txns').filter((t) => typeof t.date === 'string' && t.date.slice(0, 7) === mk);

    const plannedIncome = K.monthlyIncome(book);
    let actualIncome = 0;
    let spent = 0;
    let saved = 0;
    let uncategorized = 0;
    const byCat = {};
    const daily = new Array(dim).fill(0);
    const byMember = {};
    txns.forEach((t) => {
      const amt = Math.abs(Number(t.amount) || 0);
      if (t.type === 'income') {
        actualIncome += amt;
        return;
      }
      const cat = catById[t.cat];
      byCat[t.cat || '_none'] = (byCat[t.cat || '_none'] || 0) + amt;
      if (!cat) uncategorized += 1;
      if (cat && SAVED_GROUPS[cat.group]) {
        saved += amt;
      } else {
        spent += amt;
        const d = Number(t.date.slice(8, 10));
        if (d >= 1 && d <= dim) daily[d - 1] += amt;
        if (t.who || t._by) {
          const w = t.who || t._by;
          byMember[w] = (byMember[w] || 0) + amt;
        }
      }
    });
    const income = Math.max(plannedIncome, actualIncome);

    let budgeted = 0;
    let flexLimit = 0;
    let flexSpent = 0;
    let spendLimit = 0;
    const rows = cats.map((c) => {
      const limit = Math.max(0, Number(c.limit) || 0);
      const s = byCat[c.id] || 0;
      budgeted += limit;
      const isSaving = !!SAVED_GROUPS[c.group];
      if (!isSaving) spendLimit += limit;
      const flex = c.kind !== 'fixed' && !isSaving;
      if (flex) {
        flexLimit += limit;
        flexSpent += s;
      }
      const pct = limit > 0 ? s / limit : s > 0 ? Infinity : 0;
      const projected = flex && isCurrent && day > 0 ? (s / day) * dim : s;
      let status = 'ok';
      if (!isSaving && limit > 0) {
        // A fixed bill paid exactly in full is expected; only overspending counts for fixed envelopes.
        if (s > limit + 0.005) status = 'over';
        else if (pct >= alertAt && c.kind !== 'fixed') status = 'warn';
        else if (flex && isCurrent && day >= 5 && projected > limit * 1.05) status = 'pace';
      } else if (!isSaving && limit === 0 && s > 0) {
        status = 'over';
      }
      return {
        id: c.id,
        cat: c,
        limit: limit,
        spent: s,
        left: limit - s,
        pct: pct,
        projected: projected,
        status: status,
        isSaving: isSaving,
        flex: flex,
      };
    });

    const cumulative = [];
    let run = 0;
    for (let i = 0; i < dim; i++) {
      run += daily[i];
      cumulative.push(run);
    }
    const daysLeft = isCurrent ? dim - day + 1 : 0;
    const safeDaily = isCurrent ? Math.max(0, flexLimit - flexSpent) / Math.max(1, daysLeft) : null;

    return {
      mk: mk,
      dim: dim,
      day: day,
      isCurrent: isCurrent,
      isPast: isPast,
      plannedIncome: plannedIncome,
      actualIncome: actualIncome,
      income: income,
      spent: spent,
      saved: saved,
      left: income - spent - saved,
      budgeted: budgeted,
      spendLimit: spendLimit,
      unassigned: income - budgeted,
      savingsRate: income > 0 ? (income - spent) / income : 0,
      flexLimit: flexLimit,
      flexSpent: flexSpent,
      safeDaily: safeDaily,
      daysLeft: daysLeft,
      rows: rows,
      byCat: byCat,
      byMember: byMember,
      daily: daily,
      cumulative: cumulative,
      uncategorized: uncategorized,
      txnCount: txns.length,
    };
  };

  /** Human alerts for categories that are close to / over their limit. */
  K.alertsFor = function (stats, cur) {
    const out = [];
    stats.rows.forEach((r) => {
      if (r.status === 'ok') return;
      const name = (r.cat.emoji ? r.cat.emoji + ' ' : '') + r.cat.name;
      if (r.status === 'over') {
        out.push({
          level: 'over',
          catId: r.id,
          title: name + ' is over budget',
          body:
            r.limit > 0
              ? 'Spent ' + K.fmt(r.spent, cur) + ' of ' + K.fmt(r.limit, cur) + ' (' + K.fmt(r.spent - r.limit, cur) + ' over).'
              : K.fmt(r.spent, cur) + ' spent with no limit set.',
        });
      } else if (r.status === 'warn') {
        const daysTxt = stats.isCurrent ? ' with ' + stats.daysLeft + ' day' + (stats.daysLeft === 1 ? '' : 's') + ' to go' : '';
        out.push({
          level: 'warn',
          catId: r.id,
          title: name + ' is at ' + Math.round(r.pct * 100) + '%',
          body: K.fmt(Math.max(0, r.left), cur) + ' left' + daysTxt + '.',
        });
      } else if (r.status === 'pace') {
        out.push({
          level: 'pace',
          catId: r.id,
          title: name + ' is spending fast',
          body: 'At this pace it reaches ' + K.fmt(r.projected, cur) + ' by month end (limit ' + K.fmt(r.limit, cur) + ').',
        });
      }
    });
    return out.sort((a, b) => STATUS_RANK[b.level] - STATUS_RANK[a.level]);
  };

  /** Which category got worse between two stats snapshots (for live warnings). */
  K.crossings = function (before, after) {
    const prev = {};
    before.rows.forEach((r) => (prev[r.id] = r.status));
    return after.rows.filter((r) => STATUS_RANK[r.status] > STATUS_RANK[prev[r.id] || 'ok']).map((r) => r.id);
  };

  // ---------------------------------------------------------------- onboarding quiz
  K.TRAITS = {
    save: { label: 'Saver', low: 'Spender', high: 'Saver' },
    plan: { label: 'Planner', low: 'Spontaneous', high: 'Planner' },
    risk: { label: 'Risk appetite', low: 'Cautious', high: 'Bold' },
    social: { label: 'Social spender', low: 'Independent', high: 'Generous' },
    avoid: { label: 'Money stress', low: 'Calm', high: 'Avoidant' },
  };

  K.QUIZ = [
    { id: 'name', type: 'text', q: "Hi! I'm Kitty. What should I call you?", placeholder: 'Your first name' },
    {
      id: 'income',
      type: 'money',
      q: 'Roughly how much do you take home each month?',
      hint: 'After tax, all jobs and side income. A rough number is fine; you can change it any time.',
    },
    {
      id: 'household',
      type: 'choice',
      q: 'Who is this budget for?',
      options: [
        { v: 'solo', emoji: '🙋', label: 'Just me' },
        { v: 'couple', emoji: '💑', label: 'Me and my partner' },
        { v: 'family', emoji: '👨‍👩‍👧', label: 'Our family with kids' },
        { v: 'shared', emoji: '🏠', label: 'Housemates or friends' },
      ],
    },
    {
      id: 'housing',
      type: 'money',
      optional: true,
      q: 'How much goes to rent, mortgage or kos each month?',
      hint: 'Skip if you live rent-free.',
    },
    {
      id: 'goals',
      type: 'multi',
      q: 'What do you want your money to do for you?',
      hint: 'Pick as many as you like.',
      options: [
        { v: 'emergency', emoji: '🛟', label: 'Build a safety net' },
        { v: 'debt', emoji: '⛓️', label: 'Get out of debt' },
        { v: 'home', emoji: '🏡', label: 'Buy a home' },
        { v: 'travel', emoji: '✈️', label: 'Travel more' },
        { v: 'invest', emoji: '📈', label: 'Grow my wealth' },
        { v: 'retire', emoji: '🌴', label: 'Retire early' },
        { v: 'education', emoji: '🎓', label: 'Education' },
        { v: 'family', emoji: '💝', label: 'Support family' },
      ],
    },
    {
      id: 'payday',
      type: 'choice',
      q: 'Payday arrives. What usually happens first?',
      options: [
        { v: 'save_first', emoji: '🏦', label: 'Savings move out automatically', fx: { save: 2, plan: 1 } },
        { v: 'plan', emoji: '🗺️', label: 'Every rupiah already has a job', fx: { plan: 2, save: 1 } },
        { v: 'treat', emoji: '🛍️', label: 'Treat-yourself time', fx: { save: -2, plan: -1 } },
        { v: 'bills', emoji: '🧾', label: 'Pay bills, then see what is left', fx: { avoid: 1, plan: -1 } },
      ],
    },
    {
      id: 'impulse',
      type: 'choice',
      q: "You spot something you love that you didn't plan to buy. You…",
      options: [
        { v: 'buy', emoji: '⚡', label: 'Buy it. Life is short', fx: { save: -2, plan: -1 } },
        { v: 'wait', emoji: '⏳', label: 'Wait 48 hours and see', fx: { save: 1, plan: 1 } },
        { v: 'check', emoji: '📊', label: 'Check my budget first', fx: { plan: 2 } },
        { v: 'gift', emoji: '🎁', label: 'Buy it as a gift for someone', fx: { social: 2, save: -1 } },
      ],
    },
    {
      id: 'balance',
      type: 'choice',
      q: 'How do you feel about checking your bank balance?',
      options: [
        { v: 'daily', emoji: '😌', label: 'I check it often, all calm', fx: { plan: 1, avoid: -2 } },
        { v: 'weekly', emoji: '🙂', label: 'Every week or so, fine', fx: { avoid: -1 } },
        { v: 'avoid', emoji: '🙈', label: "I'd rather not look", fx: { avoid: 2, plan: -1 } },
        { v: 'anxious', emoji: '😰', label: 'It makes me anxious', fx: { avoid: 2 } },
      ],
    },
    {
      id: 'windfall',
      type: 'choice',
      q: 'You get a surprise bonus. Your first move?',
      options: [
        { v: 'invest', emoji: '📈', label: 'Invest most of it', fx: { risk: 2, save: 1 } },
        { v: 'save', emoji: '🐷', label: 'Straight to savings', fx: { save: 2, risk: -1 } },
        { v: 'split', emoji: '⚖️', label: 'Split: some fun, some saved', fx: { plan: 1, save: 1 } },
        { v: 'share', emoji: '🥂', label: 'Celebrate with people I love', fx: { social: 2, save: -1 } },
      ],
    },
    {
      id: 'drop',
      type: 'choice',
      q: 'Your investments drop 20% in a month. You…',
      options: [
        { v: 'buy', emoji: '🛒', label: 'Buy more, it is on sale', fx: { risk: 2 } },
        { v: 'hold', emoji: '🧘', label: 'Hold and ignore the noise', fx: { risk: 1, plan: 1 } },
        { v: 'sell_some', emoji: '😬', label: 'Sell some to feel safer', fx: { risk: -1, avoid: 1 } },
        { v: 'never', emoji: '🚫', label: "I don't invest, too scary", fx: { risk: -2, avoid: 1 } },
      ],
    },
    {
      id: 'social',
      type: 'choice',
      q: "Friends invite you to a dinner you can't really afford. You…",
      options: [
        { v: 'go', emoji: '🍽️', label: "Go and pay, I'll figure it out", fx: { social: 2, save: -1 } },
        { v: 'suggest', emoji: '🍜', label: 'Suggest a cheaper place', fx: { plan: 1, social: 1 } },
        { v: 'skip', emoji: '🏡', label: 'Skip this one', fx: { save: 1, social: -1 } },
        { v: 'guilt', emoji: '😓', label: 'Go, then feel guilty after', fx: { social: 1, avoid: 1 } },
      ],
    },
    {
      id: 'emergency',
      type: 'choice',
      q: 'If your income stopped today, how long could you cover your bills?',
      options: [
        { v: 0, emoji: '🫠', label: 'Less than a month' },
        { v: 1, emoji: '🙂', label: '1–3 months' },
        { v: 2, emoji: '😎', label: '3–6 months' },
        { v: 3, emoji: '🏰', label: 'More than 6 months', fx: { save: 1 } },
      ],
    },
    {
      id: 'debt',
      type: 'choice',
      q: 'Any debt besides a mortgage (cards, paylater, cicilan, loans)?',
      options: [
        { v: 0, emoji: '✨', label: 'None' },
        { v: 1, emoji: '💳', label: 'A little, paid off monthly' },
        { v: 2, emoji: '📄', label: 'Some loans or instalments' },
        { v: 3, emoji: '🌧️', label: "A lot, and it's stressful", fx: { avoid: 1 } },
      ],
    },
    {
      id: 'experience',
      type: 'choice',
      q: 'How much investing experience do you have?',
      options: [
        { v: 0, emoji: '🌱', label: 'None yet', fx: { risk: -1 } },
        { v: 1, emoji: '🪴', label: 'Deposits or mutual funds' },
        { v: 2, emoji: '🌳', label: 'Stocks or ETFs regularly', fx: { risk: 1 } },
        { v: 3, emoji: '🚀', label: 'Stocks, crypto and more', fx: { risk: 2 } },
      ],
    },
  ];

  const TRAIT_RANGE = (function () {
    const range = {};
    Object.keys(K.TRAITS).forEach((t) => (range[t] = { min: 0, max: 0 }));
    K.QUIZ.forEach((q) => {
      if (!q.options) return;
      Object.keys(K.TRAITS).forEach((t) => {
        const vals = q.options.map((o) => (o.fx && o.fx[t]) || 0);
        range[t].min += Math.min.apply(null, vals);
        range[t].max += Math.max.apply(null, vals);
      });
    });
    return range;
  })();

  K.PERSONAS = {
    squirrel: {
      name: 'The Squirrel',
      emoji: '🐿️',
      tagline: 'Steady saver',
      color: '#c47f3c',
      w: { save: 1.2, risk: -0.5, plan: 0.3, avoid: -0.1 },
      rule: { needs: 50, wants: 20, savings: 20, invest: 10 },
      blurb:
        'You stash away for winter and rarely panic. Saving comes naturally; the risk is saving so hard that money never gets to work, or never gets enjoyed.',
      strengths: ['Consistent saver', 'Calm in emergencies', 'Low lifestyle creep'],
      watch: ['Cash sitting idle loses to inflation', 'Guilt about spending on yourself'],
      tips: [
        'Your emergency fund is the base. Money beyond 6 months of expenses should be invested, not parked.',
        'Give yourself a guilt-free "fun" envelope. Spending it is part of the plan.',
        'Automate a monthly transfer into a low-cost index fund so your savings grow without extra effort.',
        'Compare your savings account rate with deposits or money-market funds. A 2–3% gap adds up fast.',
        'Pick one experience this month and pay for it from the Wants bucket without second-guessing.',
        'Set a wealth goal (not just a safety goal) so saving has a destination.',
      ],
    },
    owl: {
      name: 'The Owl',
      emoji: '🦉',
      tagline: 'Strategic planner',
      color: '#5b6cff',
      w: { plan: 1.3, save: 0.3, avoid: -0.3 },
      rule: { needs: 50, wants: 25, savings: 15, invest: 10 },
      blurb:
        'You like a plan, and a spreadsheet does not scare you. Zero-based budgeting suits you: every unit of income gets a job before the month starts.',
      strengths: ['Detail oriented', 'Sees problems early', 'Great at shared budgets'],
      watch: ['Over-tracking can burn you out', 'Plans can feel rigid to partners'],
      tips: [
        'Try zero-based budgeting: assign every unit of income until "left to assign" hits zero.',
        'Do a 10-minute weekly money review instead of tracking every hour.',
        'Leave a small "oops" buffer category so one surprise does not break the plan.',
        'Plan sinking funds for yearly costs (insurance, gifts, taxes) and divide them by 12.',
        'Share the book with your partner and agree on 3 categories each of you owns.',
        'Review last month before planning the next. Adjust limits to reality, not wishes.',
      ],
    },
    butterfly: {
      name: 'The Butterfly',
      emoji: '🦋',
      tagline: 'Free spirit',
      color: '#e2559b',
      w: { save: -1.0, plan: -0.8, social: 0.3 },
      rule: { needs: 55, wants: 30, savings: 10, invest: 5 },
      blurb:
        'You live in the moment and make life fun. Willpower budgets will not work for you, so make saving automatic and invisible.',
      strengths: ['Enjoys life', 'Generous and spontaneous', 'Adapts quickly'],
      watch: ['Impulse buys add up', 'Money runs out before the month does'],
      tips: [
        'Automate savings on payday so it leaves before you see it.',
        'Use the 48-hour rule: add wants to a wishlist and buy only if you still want it 2 days later.',
        'Turn off saved cards and one-click checkout in shopping apps.',
        'Look at "Safe to spend today" before you buy. It is your daily allowance.',
        'Try a no-spend weekend once a month and treat it as a game.',
        'Unsubscribe from promo emails and sale notifications. Fewer triggers, fewer impulse buys.',
      ],
    },
    lion: {
      name: 'The Lion',
      emoji: '🦁',
      tagline: 'Wealth builder',
      color: '#e0a400',
      w: { risk: 1.3, save: 0.4, plan: 0.2 },
      rule: { needs: 50, wants: 20, savings: 10, invest: 20 },
      blurb:
        'You think in decades and are comfortable with volatility. Pay yourself first and let compounding do the heavy lifting. Just keep a solid base under the risk.',
      strengths: ['Long-term mindset', 'Comfortable with risk', 'Motivated by growth'],
      watch: ['Concentrated bets', 'Skipping the emergency fund'],
      tips: [
        'Keep 3–6 months of expenses in cash before taking bigger investment risks.',
        'Rebalance when any asset class drifts more than 5% from your target.',
        'Keep speculative bets (single stocks, crypto) under 10% of the portfolio.',
        'Raise your monthly investment by 1% of income every time you get a raise.',
        'Track fees: a 1% yearly fee can eat roughly a quarter of your returns over 30 years.',
        'Write down why you hold each position. If the reason is gone, so is the position.',
      ],
    },
    dolphin: {
      name: 'The Dolphin',
      emoji: '🐬',
      tagline: 'Generous connector',
      color: '#16a5b8',
      w: { social: 1.3, save: -0.2 },
      rule: { needs: 50, wants: 30, savings: 15, invest: 5 },
      blurb:
        'People come first for you: gifts, dinners, helping family. That is beautiful. Give it a budget so generosity never puts your own future at risk.',
      strengths: ['Generous', 'Great at shared money', 'Strong relationships'],
      watch: ['Saying yes to every invite', 'Lending money you need'],
      tips: [
        'Create a "Giving & gifts" envelope so generosity is planned, not guilt-driven.',
        'It is OK to suggest a cheaper plan with friends. Most people are relieved.',
        'Before lending money, decide how much you could afford to never get back.',
        'Split shared costs in a shared Kitty book so nobody keeps mental IOUs.',
        'Plan festive seasons (Lebaran, Christmas, CNY) as sinking funds, 1/12 each month.',
        'Pay yourself first too. Your future self is someone you care about.',
      ],
    },
    turtle: {
      name: 'The Turtle',
      emoji: '🐢',
      tagline: 'Cautious avoider',
      color: '#3aa76d',
      w: { avoid: 1.3, plan: -0.4, risk: -0.3 },
      rule: { needs: 55, wants: 25, savings: 15, invest: 5 },
      blurb:
        'Money talk can feel stressful, so it is easy to look away. Small, regular check-ins and a very simple plan will make you feel in control fast.',
      strengths: ['Careful with big decisions', 'Rarely overextends on risk', 'Improves fast with structure'],
      watch: ['Avoiding statements and bills', 'Surprises at month end'],
      tips: [
        'Start tiny: a 5-minute check-in every Sunday. Just look, no judging.',
        'Keep it to 3 buckets (needs, wants, savings) until it feels easy.',
        'Turn on Kitty warnings. They nudge you before a limit is hit, not after.',
        'Automate bill payments so nothing is late while you build the habit.',
        'Celebrate small wins: every week you stay on budget counts.',
        'If debt feels heavy, list every debt with its interest rate. Seeing it makes it smaller.',
      ],
    },
  };

  K.scoreQuiz = function (answers) {
    const a = answers || {};
    const raw = {};
    Object.keys(K.TRAITS).forEach((t) => (raw[t] = 0));
    K.QUIZ.forEach((q) => {
      if (!q.options || q.type === 'multi') return;
      const opt = q.options.find((o) => String(o.v) === String(a[q.id]));
      if (opt && opt.fx) Object.keys(opt.fx).forEach((t) => (raw[t] += opt.fx[t]));
    });
    const traits = {};
    Object.keys(raw).forEach((t) => {
      const r = TRAIT_RANGE[t];
      traits[t] = r.max > r.min ? Math.round(((raw[t] - r.min) / (r.max - r.min)) * 100) : 50;
    });
    const centred = {};
    Object.keys(traits).forEach((t) => (centred[t] = (traits[t] - 50) / 50));
    const ranking = Object.keys(K.PERSONAS)
      .map((key) => {
        const w = K.PERSONAS[key].w;
        let score = 0;
        Object.keys(w).forEach((t) => (score += w[t] * (centred[t] || 0)));
        return { key: key, score: Math.round(score * 1000) / 1000 };
      })
      .sort((x, y) => y.score - x.score);
    const facts = {
      name: String(a.name || '').trim().slice(0, 40),
      income: Number(a.income) || 0,
      housing: Number(a.housing) || 0,
      household: a.household || 'solo',
      goals: Array.isArray(a.goals) ? a.goals.slice(0, 8) : [],
      ef: Number(a.emergency) || 0,
      debt: Number(a.debt) || 0,
      experience: Number(a.experience) || 0,
    };
    return { raw: raw, traits: traits, persona: ranking[0].key, ranking: ranking, facts: facts };
  };

  // ---------------------------------------------------------------- planner
  const HOUSEHOLD_GROCERY = { solo: 0.3, couple: 0.38, family: 0.45, shared: 0.32 };

  // Pick a category from what the user typed: first from their own history, then from common words
  // (English, Indonesian, Chinese, Spanish) mapped to Kitty's default envelopes, then by category name.
  const CATEGORY_HINTS = [
    ['Dining out', /coffee|kopi|caf[eé]|lunch|dinner|breakfast|brunch|makan|resto|restaurant|food|boba|bakso|nasi|咖啡|午饭|午餐|晚饭|晚餐|早餐|外卖|餐|奶茶|comida|cena|almuerzo|desayuno|restaurante/i],
    ['Groceries', /grocer|supermarket|indomaret|alfamart|sayur|\bpasar\b|超市|买菜|菜市场|supermercado|\bmercado\b/i],
    ['Transport', /\bgrab\b|gojek|uber|taxi|taksi|bensin|fuel|petrol|parkir|parking|\btol\b|toll|train|\bkrl\b|\bmrt\b|\bbus\b|ojek|地铁|打车|出租车|加油|公交|gasolina|\bmetro\b|autob[uú]s/i],
    ['Bills & utilities', /listrik|electric|\bpln\b|water bill|pdam|internet|wifi|indihome|pulsa|phone bill|token|电费|水费|网费|话费|\bluz\b|factura/i],
    ['Subscriptions', /netflix|spotify|youtube|disney|icloud|subscription|langganan|订阅|会员|suscripci[oó]n/i],
    ['Shopping', /shopee|tokopedia|lazada|amazon|clothes|baju|shoes|sepatu|\bmall\b|淘宝|京东|衣服|\bropa\b|zapatos|compras/i],
    ['Health & insurance', /doctor|dokter|pharmacy|apotek|\bobat\b|medicine|hospital|rumah sakit|bpjs|insurance|asuransi|医院|药|保险|m[eé]dico|farmacia|seguro/i],
    ['Fun & hobbies', /movie|cinema|bioskop|\bgame|steam|concert|konser|\bgym\b|电影|游戏|\bcine\b|juego|concierto/i],
    ['Housing', /\brent\b|\bsewa\b|\bkost?\b|mortgage|\bkpr\b|房租|租金|alquiler|hipoteca/i],
  ];
  K.guessCategory = function (book, desc) {
    const text = String(desc || '').trim().toLowerCase();
    if (text.length < 2) return '';
    const cats = K.list(book, 'categories');
    const alive = (id) => cats.some((x) => x.id === id);
    const past = K.list(book, 'txns')
      .filter((t) => t.cat && t.type !== 'income' && String(t.desc || '').trim().toLowerCase() === text && alive(t.cat))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
    if (past.length) return past[0].cat;
    for (let i = 0; i < CATEGORY_HINTS.length; i++) {
      if (!CATEGORY_HINTS[i][1].test(text)) continue;
      const wanted = CATEGORY_HINTS[i][0].toLowerCase();
      const hit = cats.find((x) => String(x.name || '').toLowerCase() === wanted);
      if (hit) return hit.id;
    }
    const named = cats.find((x) => x.name && String(x.name).length > 2 && text.indexOf(String(x.name).toLowerCase()) >= 0);
    return named ? named.id : '';
  };

  K.suggestPlan = function (profile, currencyOpt) {
    const cur = currencyOpt || profile.currency || 'IDR';
    const persona = K.PERSONAS[profile.persona] || K.PERSONAS.owl;
    const f = profile.facts || {};
    const pct = Object.assign({}, persona.rule);
    const notes = [];
    const income = Number(f.income) || 0;

    function move(from, to, amount) {
      const m = Math.min(amount, Math.max(0, pct[from] - (from === 'needs' ? 30 : 0)));
      pct[from] -= m;
      pct[to] += m;
      return m;
    }
    if (f.ef <= 1 && pct.invest > 5) {
      move('invest', 'savings', 5);
      notes.push('Your safety net is under 3 months, so 5% moves from investing to savings until it is.');
    }
    if (f.debt >= 2) {
      move('wants', 'savings', 5);
      notes.push('An extra 5% goes to debt payoff. Clear the highest-interest debt first (avalanche method).');
    }
    if (income > 0 && f.housing > 0) {
      const housingPct = (f.housing / income) * 100;
      if (housingPct > 30) {
        notes.push(
          'Housing takes ' + Math.round(housingPct) + '% of your income, above the common 30% guideline. Needs are raised to fit it.'
        );
      }
      // Needs must cover the real rent plus ~15% of income for essentials; take from wants, then investing, then savings.
      let shortfall = Math.ceil(housingPct + 15) - pct.needs;
      [['wants', 5], ['invest', 0], ['savings', 5]].forEach((step) => {
        if (shortfall <= 0) return;
        const m = Math.min(shortfall, Math.max(0, pct[step[0]] - step[1]));
        pct[step[0]] -= m;
        pct.needs += m;
        shortfall -= m;
      });
    }
    if ((f.goals || []).indexOf('invest') >= 0 && f.ef >= 2 && f.debt <= 1) {
      move('wants', 'invest', 5);
      notes.push('You want to grow wealth and your base is solid, so 5% shifts from wants to investing.');
    }
    const total = pct.needs + pct.wants + pct.savings + pct.invest;
    if (total !== 100) pct.needs += 100 - total;

    const amounts = {};
    Object.keys(pct).forEach((g) => (amounts[g] = (income * pct[g]) / 100));

    const cats = [];
    function add(group, name, emoji, share, kind) {
      cats.push({ group: group, name: name, emoji: emoji, share: share, kind: kind || 'flex' });
    }
    const housingShare = income > 0 && f.housing > 0 && amounts.needs > 0 ? Math.min(0.95, f.housing / amounts.needs) : 0.35;
    const g = HOUSEHOLD_GROCERY[f.household] || 0.3;
    const restNeeds = 1 - housingShare;
    const needWeights = [
      ['Groceries', '🛒', g, 'flex'],
      ['Transport', '🛵', 0.22, 'flex'],
      ['Bills & utilities', '💡', 0.2, 'fixed'],
      ['Health & insurance', '🩺', 0.15, 'fixed'],
    ];
    const needWeightSum = needWeights.reduce((s, w) => s + w[2], 0);
    add('needs', 'Housing', '🏠', housingShare, 'fixed');
    needWeights.forEach((w) => add('needs', w[0], w[1], (restNeeds * w[2]) / needWeightSum, w[3]));
    const wantsList = [
      ['Dining out', '🍜', 0.32],
      ['Fun & hobbies', '🎮', 0.22],
      ['Shopping', '🛍️', 0.26],
      ['Subscriptions', '📺', 0.08, 'fixed'],
    ];
    if (profile.persona === 'dolphin' || (f.goals || []).indexOf('family') >= 0) wantsList.push(['Giving & gifts', '💝', 0.18]);
    if ((f.goals || []).indexOf('travel') >= 0) wantsList.push(['Travel fund', '✈️', 0.18]);
    const wantsTotal = wantsList.reduce((s, w) => s + w[2], 0);
    wantsList.forEach((w) => add('wants', w[0], w[1], w[2] / wantsTotal, w[3]));
    const savingsList = [];
    if (f.ef < 3) savingsList.push(['Emergency fund', '🛟', 3]);
    if (f.debt >= 2) savingsList.push(['Debt payoff', '⛓️', 3]);
    if ((f.goals || []).indexOf('home') >= 0) savingsList.push(['Home deposit', '🏡', 2]);
    if ((f.goals || []).indexOf('education') >= 0) savingsList.push(['Education', '🎓', 1]);
    savingsList.push(['Goals & sinking funds', '🎯', 1]);
    const sTotal = savingsList.reduce((s, x) => s + x[2], 0);
    savingsList.forEach((x) => add('savings', x[0], x[1], x[2] / sTotal, 'fixed'));
    add('invest', 'Investing', '📈', 1, 'fixed');

    // normalise shares within each group and convert to rounded limits
    Object.keys(K.GROUPS).forEach((grp) => {
      const inGroup = cats.filter((c) => c.group === grp);
      const sum = inGroup.reduce((s, c) => s + c.share, 0) || 1;
      let allocated = 0;
      inGroup.forEach((c, i) => {
        c.share = c.share / sum;
        if (i === inGroup.length - 1) {
          c.limit = Math.max(0, Math.round((amounts[grp] - allocated) * 100) / 100);
        } else {
          c.limit = K.niceRound(amounts[grp] * c.share, cur);
          allocated += c.limit;
        }
      });
    });
    if (income > 0 && f.housing > 0) {
      const housing = cats.find((c) => c.name === 'Housing');
      const diff = f.housing - housing.limit;
      const groceries = cats.find((c) => c.name === 'Groceries');
      if (Math.abs(diff) > 0 && groceries.limit - diff >= 0) {
        housing.limit = f.housing;
        groceries.limit = Math.round((groceries.limit - diff) * 100) / 100;
      }
    }
    return { pct: pct, amounts: amounts, categories: cats, notes: notes, income: income };
  };

  // ---------------------------------------------------------------- investing
  K.ASSET_CLASSES = {
    stocks: { label: 'Stocks & ETFs', color: '#5b6cff' },
    bonds: { label: 'Bonds & SBN', color: '#16a5b8' },
    cash: { label: 'Cash & deposits', color: '#8fa3b8' },
    gold: { label: 'Gold', color: '#e0a400' },
    crypto: { label: 'Crypto', color: '#e2559b' },
    property: { label: 'Property', color: '#3aa76d' },
    other: { label: 'Other', color: '#a46bd6' },
  };

  K.targetFor = function (risk) {
    const r = Number(risk);
    if (!(r >= 0)) return { label: 'Balanced', mix: { stocks: 45, bonds: 35, cash: 10, gold: 10, crypto: 0 } };
    if (r < 25) return { label: 'Conservative', mix: { stocks: 25, bonds: 45, cash: 20, gold: 10, crypto: 0 } };
    if (r < 50) return { label: 'Balanced', mix: { stocks: 45, bonds: 35, cash: 10, gold: 10, crypto: 0 } };
    if (r < 75) return { label: 'Growth', mix: { stocks: 65, bonds: 20, cash: 5, gold: 5, crypto: 5 } };
    return { label: 'Aggressive', mix: { stocks: 80, bonds: 5, cash: 5, gold: 0, crypto: 10 } };
  };

  K.portfolio = function (book) {
    const target = (book.meta.target && book.meta.target.mix) || K.targetFor(50).mix;
    const rows = K.list(book, 'holdings').map((h) => {
      const qty = Number(h.qty) || 0;
      const price = Number(h.price) || 0;
      const cost = Number(h.cost) || 0;
      const value = qty * price;
      const basis = qty * cost;
      return Object.assign({}, h, {
        value: value,
        basis: basis,
        pl: value - basis,
        plPct: basis > 0 ? (value - basis) / basis : 0,
      });
    });
    const total = rows.reduce((s, r) => s + r.value, 0);
    const basis = rows.reduce((s, r) => s + r.basis, 0);
    const byClass = {};
    rows.forEach((r) => {
      const k = K.ASSET_CLASSES[r.cls] ? r.cls : 'other';
      byClass[k] = (byClass[k] || 0) + r.value;
    });
    const classes = Object.keys(Object.assign({}, target, byClass));
    const drift = classes
      .map((k) => {
        const actualPct = total > 0 ? ((byClass[k] || 0) / total) * 100 : 0;
        const targetPct = Number(target[k]) || 0;
        return {
          cls: k,
          actualPct: actualPct,
          targetPct: targetPct,
          diff: actualPct - targetPct,
          trade: total > 0 ? ((targetPct - actualPct) / 100) * total : 0,
        };
      })
      .sort((a, b) => b.targetPct - a.targetPct || b.actualPct - a.actualPct);
    const maxDrift = drift.reduce((m, d) => Math.max(m, Math.abs(d.diff)), 0);
    return {
      rows: rows.sort((a, b) => b.value - a.value),
      total: total,
      basis: basis,
      pl: total - basis,
      plPct: basis > 0 ? (total - basis) / basis : 0,
      byClass: byClass,
      drift: drift,
      maxDrift: maxDrift,
      target: target,
    };
  };

  /** Future value per year with monthly contributions (monthly compounding). */
  K.projectFV = function (start, monthly, annualPct, years) {
    const r = (Number(annualPct) || 0) / 100 / 12;
    const out = [];
    let v = Number(start) || 0;
    let contributed = v;
    out.push({ year: 0, value: v, contributed: contributed });
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) {
        v = v * (1 + r) + (Number(monthly) || 0);
        contributed += Number(monthly) || 0;
      }
      out.push({ year: y, value: v, contributed: contributed });
    }
    return out;
  };

  // ---------------------------------------------------------------- goals
  K.goalPlan = function (goal, todayStr) {
    const target = Number(goal.target) || 0;
    const saved = Number(goal.saved) || 0;
    const remaining = Math.max(0, target - saved);
    let months = null;
    if (goal.due) {
      const t = (todayStr || K.today()).slice(0, 7);
      const d = String(goal.due).slice(0, 7);
      months = Math.max(1, (Number(d.slice(0, 4)) - Number(t.slice(0, 4))) * 12 + (Number(d.slice(5, 7)) - Number(t.slice(5, 7))));
    }
    return {
      pct: target > 0 ? Math.min(1, saved / target) : 0,
      remaining: remaining,
      months: months,
      perMonth: months ? remaining / months : null,
      done: target > 0 && saved >= target,
    };
  };

  // ---------------------------------------------------------------- tips
  function dayOfYear(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 864e5);
  }

  K.tipsFor = function (ctx) {
    const book = ctx.book;
    const stats = ctx.stats;
    const profile = ctx.profile || {};
    const cur = book.meta.currency;
    const today = ctx.today || K.today();
    const tips = [];
    const persona = K.PERSONAS[profile.persona];

    const worst = stats.rows
      .filter((r) => r.status !== 'ok' && !r.isSaving)
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.pct - a.pct)[0];
    if (worst && stats.isCurrent) {
      const perDay = Math.max(0, worst.left) / Math.max(1, stats.daysLeft);
      tips.push({
        id: 'cat-' + worst.id,
        icon: worst.status === 'over' ? '🚨' : '⚠️',
        kind: 'data',
        title: worst.status === 'over' ? 'Rescue ' + worst.cat.name : 'Slow down on ' + worst.cat.name,
        body:
          worst.status === 'over'
            ? 'Move money from a category with room left so the plan stays honest, or pause ' + worst.cat.name.toLowerCase() + ' for the rest of the month.'
            : 'Keep it under ' + K.fmt(perDay, cur) + ' a day to finish the month inside the limit.',
      });
    }
    if (stats.income > 0 && stats.unassigned > stats.income * 0.02) {
      tips.push({
        id: 'unassigned',
        icon: '🧩',
        kind: 'data',
        title: K.fmt(stats.unassigned, cur) + ' has no job yet',
        body: 'Give it one: top up savings, your emergency fund or a goal. Money without a plan tends to disappear.',
      });
    } else if (stats.income > 0 && stats.unassigned < -stats.income * 0.01) {
      tips.push({
        id: 'overplanned',
        icon: '🧮',
        kind: 'data',
        title: 'Planned ' + K.fmt(-stats.unassigned, cur) + ' more than you earn',
        body: 'Trim a Wants category or two so your limits add up to your income.',
      });
    }
    if (stats.income > 0 && stats.day >= 10 && stats.savingsRate < 0.1) {
      tips.push({
        id: 'savings-rate',
        icon: '🐷',
        kind: 'data',
        title: 'Savings rate is ' + Math.round(Math.max(0, stats.savingsRate) * 100) + '%',
        body: 'Aim for at least 10–20%. Automating ' + K.fmt(stats.income * 0.1, cur) + ' on payday is the easiest first step.',
      });
    }
    const subs = K.list(book, 'categories').find((c) => /subscri|langganan/i.test(c.name || ''));
    if (subs && stats.income > 0 && (stats.byCat[subs.id] || 0) > stats.income * 0.05) {
      tips.push({
        id: 'subs',
        icon: '📺',
        kind: 'data',
        title: 'Subscriptions are over 5% of income',
        body: 'List every subscription and cancel the ones you have not used in 30 days.',
      });
    }
    if (stats.uncategorized > 0) {
      tips.push({
        id: 'uncat',
        icon: '🏷️',
        kind: 'data',
        title: stats.uncategorized + ' transaction' + (stats.uncategorized > 1 ? 's' : '') + ' without a category',
        body: 'Categorise them in the Sheet so warnings and insights stay accurate.',
      });
    }
    const hasEF = K.list(book, 'goals').some((g) => /emergency|darurat|safety/i.test(g.name || '')) ||
      K.list(book, 'categories').some((c) => /emergency|darurat/i.test(c.name || ''));
    if (!hasEF && (profile.facts ? profile.facts.ef <= 1 : true)) {
      tips.push({
        id: 'ef',
        icon: '🛟',
        kind: 'data',
        title: 'Start an emergency fund',
        body: 'Target 3–6 months of expenses' + (stats.spent > 0 ? ' (about ' + K.fmt(stats.spendLimit * 3 || stats.spent * 3, cur) + ')' : '') + '. It turns emergencies into inconveniences.',
      });
    }
    if (ctx.portfolio && ctx.portfolio.total > 0 && ctx.portfolio.maxDrift > 5) {
      const d = ctx.portfolio.drift.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
      tips.push({
        id: 'rebalance',
        icon: '⚖️',
        kind: 'data',
        title: 'Portfolio has drifted',
        body:
          (K.ASSET_CLASSES[d.cls] || { label: d.cls }).label +
          ' is ' + Math.abs(d.diff).toFixed(1) + '% ' + (d.diff > 0 ? 'above' : 'below') + ' target. Rebalance with new money first, so you sell less.',
      });
    }
    if (stats.isCurrent && stats.safeDaily != null && stats.flexLimit > 0) {
      tips.push({
        id: 'safe',
        icon: '🧭',
        kind: 'data',
        title: 'Safe to spend: ' + K.fmt(stats.safeDaily, cur) + ' a day',
        body: 'That is what is left across your flexible categories, spread over the ' + stats.daysLeft + ' days remaining.',
      });
    }
    if (persona) {
      const n = persona.tips.length;
      const start = dayOfYear(today) % n;
      for (let i = 0; i < n; i++) {
        tips.push({
          id: 'p-' + profile.persona + '-' + ((start + i) % n),
          icon: persona.emoji,
          kind: 'persona',
          title: persona.name + ' tip',
          body: persona.tips[(start + i) % n],
        });
      }
    }
    return tips;
  };

  // ---------------------------------------------------------------- demo data
  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  K.demoBook = function (todayStr, me) {
    const today = todayStr || K.today();
    const rnd = seeded(20261028);
    const book = K.newBook({ id: 'demo-' + K.uid(12), name: 'Demo household', currency: 'IDR' });
    const juwen = me || 'demo-juwen';
    const ayu = 'demo-ayu';
    const by = (who) => who;
    let t = Date.now() - 864e5 * 40;
    let stampN = 0;
    function rec(c, r, who) {
      t += 1000;
      // Dated rows look like they were entered on their own date (a few hours into the day), never in the future.
      let stamp = t;
      if (r.date) {
        stampN += 1;
        const dayStart = Date.parse(String(r.date) + 'T08:00:00');
        if (isFinite(dayStart)) {
          stamp = Math.min(dayStart + (stampN % 600) * 60000, Date.now() - 60000 - stampN);
        }
      }
      const op = { c: c, id: r.id || K.uid(10), r: Object.assign({}, r, { _u: stamp, _by: by(who || juwen) }) };
      K.applyOp(book, op);
      return op.id;
    }
    book.meta = Object.assign({}, book.meta, { _u: t, _by: juwen, target: K.targetFor(62) });
    rec('members', { id: juwen, name: 'You', color: '#5b6cff' });
    rec('members', { id: ayu, name: 'Ayu', color: '#e2559b' }, ayu);
    rec('incomes', { name: 'Salary', amount: 18500000, freq: 'monthly', owner: juwen });
    rec('incomes', { name: "Ayu's salary", amount: 12000000, freq: 'monthly', owner: ayu }, ayu);
    rec('incomes', { name: 'Design side gigs', amount: 750000, freq: 'weekly', owner: ayu }, ayu);
    const C = {};
    const catDefs = [
      ['housing', 'needs', 'Housing', '🏠', 7500000, 'fixed'],
      ['groceries', 'needs', 'Groceries', '🛒', 3200000, 'flex'],
      ['transport', 'needs', 'Transport', '🛵', 1500000, 'flex'],
      ['bills', 'needs', 'Bills & utilities', '💡', 1400000, 'fixed'],
      ['health', 'needs', 'Health & insurance', '🩺', 1100000, 'fixed'],
      ['dining', 'wants', 'Dining out', '🍜', 2000000, 'flex'],
      ['fun', 'wants', 'Fun & hobbies', '🎮', 1200000, 'flex'],
      ['shopping', 'wants', 'Shopping', '🛍️', 1500000, 'flex'],
      ['subs', 'wants', 'Subscriptions', '📺', 450000, 'fixed'],
      ['gifts', 'wants', 'Giving & gifts', '💝', 800000, 'flex'],
      ['ef', 'savings', 'Emergency fund', '🛟', 3000000, 'fixed'],
      ['home', 'savings', 'Home deposit', '🏡', 2500000, 'fixed'],
      ['invest', 'invest', 'Investing', '📈', 4500000, 'fixed'],
    ];
    catDefs.forEach((d, i) => {
      C[d[0]] = rec('categories', { id: 'c-' + d[0], group: d[1], name: d[2], emoji: d[3], limit: d[4], kind: d[5], order: i });
    });
    const mk = K.monthKey(today);
    const day = Number(today.slice(8, 10));
    const prevMk = K.shiftMonth(mk, -1);
    const spendPlan = [
      ['groceries', 'Supermarket run', 180000, 520000, 0.28],
      ['groceries', 'Pasar pagi', 60000, 180000, 0.2],
      ['transport', 'Gojek / Grab', 18000, 65000, 0.45],
      ['transport', 'Fuel', 100000, 250000, 0.12],
      ['dining', 'Lunch with team', 45000, 160000, 0.35],
      ['dining', 'Dinner date', 250000, 650000, 0.08],
      ['dining', 'Coffee', 28000, 62000, 0.35],
      ['fun', 'Cinema', 60000, 150000, 0.06],
      ['fun', 'Badminton court', 80000, 120000, 0.08],
      ['shopping', 'Tokopedia order', 90000, 620000, 0.12],
      ['shopping', 'Shopee checkout', 70000, 380000, 0.1],
      ['gifts', 'Birthday gift', 150000, 450000, 0.04],
    ];
    function monthTxns(m, lastDay, scale) {
      const dim = K.daysInMonth(m);
      rec('txns', { date: m + '-01', desc: 'Salary', amount: 18500000, type: 'income', cat: '', who: juwen });
      rec('txns', { date: m + '-01', desc: 'Salary', amount: 12000000, type: 'income', cat: '', who: ayu }, ayu);
      rec('txns', { date: m + '-01', desc: 'Apartment rent', amount: 7500000, type: 'expense', cat: C.housing, who: juwen });
      if (lastDay >= 3) rec('txns', { date: m + '-03', desc: 'PLN token + internet', amount: 1280000, type: 'expense', cat: C.bills, who: ayu }, ayu);
      if (lastDay >= 5) rec('txns', { date: m + '-05', desc: 'BPJS + health insurance', amount: 1100000, type: 'expense', cat: C.health, who: juwen });
      if (lastDay >= 2) rec('txns', { date: m + '-02', desc: 'Netflix + Spotify + iCloud', amount: 386000, type: 'expense', cat: C.subs, who: juwen });
      if (lastDay >= 2) rec('txns', { date: m + '-02', desc: 'Auto-transfer to emergency fund', amount: 3000000, type: 'expense', cat: C.ef, who: juwen });
      if (lastDay >= 2) rec('txns', { date: m + '-02', desc: 'Monthly index fund buy', amount: 4500000, type: 'expense', cat: C.invest, who: juwen });
      if (lastDay >= 6) rec('txns', { date: m + '-06', desc: 'Home deposit savings', amount: 2500000, type: 'expense', cat: C.home, who: ayu }, ayu);
      for (let d = 1; d <= Math.min(lastDay, dim); d++) {
        spendPlan.forEach((p) => {
          if (rnd() < p[4] * scale) {
            const amt = Math.round((p[2] + rnd() * (p[3] - p[2])) / 1000) * 1000;
            const who = rnd() < 0.5 ? juwen : ayu;
            rec('txns', { date: m + '-' + pad(d), desc: p[1], amount: amt, type: 'expense', cat: C[p[0]], who: who }, who);
          }
        });
      }
    }
    monthTxns(prevMk, K.daysInMonth(prevMk), 1);
    monthTxns(mk, day, 0.8);
    if (day >= 4) {
      rec('txns', { date: mk + '-' + pad(Math.max(1, day - 2)), desc: 'Sneakers (sale!)', amount: 1150000, type: 'expense', cat: C.shopping, who: ayu }, ayu);
    }
    rec('txns', { date: mk + '-' + pad(Math.max(1, day - 1)), desc: 'Weekend brunch', amount: 420000, type: 'expense', cat: C.dining, who: juwen });

    const due = K.shiftMonth(mk, 30) + '-01';
    rec('goals', { name: 'Emergency fund', emoji: '🛟', target: 90000000, saved: 41500000, due: K.shiftMonth(mk, 14) + '-01' });
    rec('goals', { name: 'Home deposit', emoji: '🏡', target: 250000000, saved: 62000000, due: due });
    rec('goals', { name: 'Japan trip', emoji: '🗾', target: 35000000, saved: 21800000, due: K.shiftMonth(mk, 5) + '-01' }, ayu);

    const H = [
      ['BBCA', 'Bank Central Asia', 'stocks', 1500, 8150, 9875],
      ['VOO', 'Vanguard S&P 500 ETF (fractional)', 'stocks', 3.2, 7650000, 9210000],
      ['TLKM', 'Telkom Indonesia', 'stocks', 2000, 3900, 3110],
      ['ORI025', 'Indonesian retail bond', 'bonds', 1, 30000000, 30150000],
      ['RDPU', 'Money-market fund', 'cash', 1, 18000000, 18620000],
      ['ANTAM', 'Gold (grams)', 'gold', 12, 1180000, 1625000],
      ['BTC', 'Bitcoin', 'crypto', 0.012, 980000000, 1450000000],
    ];
    H.forEach((h) => rec('holdings', { symbol: h[0], name: h[1], cls: h[2], qty: h[3], cost: h[4], price: h[5] }));
    return book;
  };
})(typeof window !== 'undefined' ? window : globalThis);
