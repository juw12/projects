/* Mint Budget i18n: language detection, t() for strings built in code, and a DOM pass that translates
 * rendered UI text (text nodes + placeholder/title/aria-label) from per-language dictionaries.
 *
 * Keys are the English source strings. Keys may contain {placeholders}; in the DOM pass they act as
 * patterns, so "{name} is over budget" also translates "Shopping is over budget" (and the captured
 * "Shopping" is translated too when it is itself a key). User data is never touched: anything inside
 * [translate="no"], form fields, code and SVG text marked with translate="no" is skipped.
 */
(function (root) {
  'use strict';
  const K = (root.MintBudget = root.MintBudget || {});

  const LANGS = [
    { code: 'en', name: 'English', short: 'EN', locale: 'en-US' },
    { code: 'id', name: 'Bahasa Indonesia', short: 'ID', locale: 'id-ID' },
    { code: 'zh', name: '简体中文', short: '中文', locale: 'zh-CN' },
    { code: 'es', name: 'Español', short: 'ES', locale: 'es-ES' },
  ];
  // One language for all of Mint (Budget and Templates), chosen on the first visit (../js/locale.js).
  const STORE_KEY = 'mint.lang';
  const dicts = { en: {} };
  const compiled = {};
  const missing = new Set();
  let lang = 'en';
  let collect = false;

  function supported(code) {
    return LANGS.some((l) => l.code === code);
  }

  function detect() {
    try {
      const fromUrl = new URLSearchParams(root.location.search).get('lang');
      if (fromUrl && supported(fromUrl)) return fromUrl;
      const stored = root.localStorage.getItem(STORE_KEY);
      if (stored && supported(stored)) return stored;
    } catch (e) {
      /* storage blocked: fall through to the browser language */
    }
    const prefs = (root.navigator && (root.navigator.languages || [root.navigator.language])) || [];
    for (const pref of prefs) {
      const base = String(pref || '').toLowerCase().split('-')[0];
      if (base === 'in' || base === 'ms') return 'id';
      if (supported(base)) return base;
    }
    return 'en';
  }

  function add(code, dict) {
    dicts[code] = Object.assign(dicts[code] || {}, dict);
    compiled[code] = null;
    lowerMaps[code] = null;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Pattern keys ("{name} is over budget") compiled to anchored regexes, most specific first.
  function patternsFor(code) {
    if (compiled[code]) return compiled[code];
    const dict = dicts[code] || {};
    const list = [];
    Object.keys(dict).forEach((key) => {
      if (key.indexOf('{') < 0) return;
      const names = [];
      const source = escapeRe(key).replace(/\\\{(\w+)\\\}/g, (m, name) => {
        names.push(name);
        return '([\\s\\S]+?)';
      });
      list.push({ re: new RegExp('^' + source + '$'), names: names, out: dict[key], weight: key.replace(/\{\w+\}/g, '').length });
    });
    list.sort((a, b) => b.weight - a.weight);
    compiled[code] = list;
    return list;
  }

  function fill(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  }

  /** Translate a source string built in code. Missing keys fall back to English. */
  function t(key, vars) {
    const dict = dicts[lang];
    let out = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
    if (out == null) {
      if (lang !== 'en' && collect) missing.add(key);
      out = key;
    }
    return fill(out, vars);
  }

  const lowerMaps = {};
  function lowerLookup(code, text) {
    if (!lowerMaps[code]) {
      const map = {};
      Object.keys(dicts[code] || {}).forEach((k) => {
        if (k.indexOf('{') < 0) map[k.toLowerCase()] = dicts[code][k];
      });
      lowerMaps[code] = map;
    }
    const hit = lowerMaps[code][text.toLowerCase()];
    if (hit == null) return null;
    // keep the caller's casing style for sentence-internal words ("pause shopping")
    return text[0] === text[0].toLowerCase() && code !== 'zh' ? hit.charAt(0).toLowerCase() + hit.slice(1) : hit;
  }

  // Leading emoji / symbols ("🛒 Groceries", "⚠️ This brings…") are kept and the words after them translated.
  const PREFIX_RE = /^([^\p{L}\p{N}"“(]+?)\s*([\p{L}"“(][\s\S]*)$/u;

  /** Translate visible text (exact key, then pattern). Returns null when nothing matches. */
  function translateText(text, depth) {
    const dict = dicts[lang];
    if (!dict || lang === 'en') return null;
    if (Object.prototype.hasOwnProperty.call(dict, text)) return dict[text];
    const lower = lowerLookup(lang, text);
    if (lower != null) return lower;
    const pre = PREFIX_RE.exec(text);
    if (pre && pre[1].trim()) {
      const rest = translateText(pre[2], depth);
      if (rest != null) return pre[1] + rest;
    }
    if ((depth || 0) > 2) return null;
    const list = patternsFor(lang);
    for (let i = 0; i < list.length; i++) {
      const m = list[i].re.exec(text);
      if (!m) continue;
      const vars = {};
      list[i].names.forEach((name, idx) => {
        const value = m[idx + 1];
        const inner = translateText(value.trim(), (depth || 0) + 1);
        vars[name] = inner == null ? value : value.replace(value.trim(), inner);
      });
      return fill(list[i].out, vars);
    }
    return null;
  }

  const NUMERIC_ONLY = /^[\s\d.,:;%+\-–—−·/()×=<>≈~#*!?'"“”‘’…|•→←↑↓]*$/;
  // money amounts ("Rp 914.000", "+Rp 1,2 jt", "$1.2k", "¥3,000") and similar data tokens
  const AMOUNT_RE = /[+\-−]?(?:Rp|US\$|S\$|NT\$|A\$|RM|₱|฿|₫|₹|€|£|¥|\$|[A-Z]{3})?\s?[+\-−]?\d[\d.,\s]*(?:\s?(?:jt|rb|M|K|k|B|bn|m|T|Jt|Rb))?\b%?/g;
  const IGNORE = new Set(['Mint', 'iPhone', 'Android', 'ntfy.sh', 'github.com/juw12/projects', 'HM', 'AES-GCM']);
  function looksTranslatable(text) {
    if (NUMERIC_ONLY.test(text) || IGNORE.has(text)) return false;
    if (/^[A-Z]{3}$/.test(text)) return false; // currency codes
    const rest = text.replace(AMOUNT_RE, ' ').replace(/[\s·/()+=:%,.\-–—]+/g, ' ').trim();
    return /[A-Za-z]{2,}/.test(rest);
  }

  const written = new WeakMap();
  const SKIP_SELECTOR = '[translate="no"], script, style, textarea, code, pre, .notranslate';

  function translateTextNode(node) {
    const raw = node.data;
    if (!raw || written.get(node) === raw) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const out = translateText(trimmed);
    if (out == null) {
      if (collect && looksTranslatable(trimmed)) missing.add(trimmed);
      return;
    }
    const next = raw.replace(trimmed, out);
    written.set(node, next);
    if (next !== raw) node.data = next;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];
  function translateAttrs(el) {
    if (el.closest(SKIP_SELECTOR)) return;
    ATTRS.forEach((attr) => {
      const value = el.getAttribute(attr);
      if (!value) return;
      const marker = 'data-i18n-' + attr;
      if (el.getAttribute(marker) === value) return;
      const trimmed = value.trim();
      const out = translateText(trimmed);
      if (out == null) {
        if (collect && looksTranslatable(trimmed)) missing.add(trimmed);
        return;
      }
      el.setAttribute(attr, out);
      el.setAttribute(marker, out);
    });
  }

  function translateDOM(rootNode) {
    if (lang === 'en' || !rootNode) return;
    const base = rootNode.nodeType === 3 ? rootNode.parentNode : rootNode;
    if (!base) return;
    if (rootNode.nodeType === 3) {
      translateTextNode(rootNode);
      return;
    }
    if (rootNode.nodeType === 1) translateAttrs(rootNode);
    const walker = root.document.createTreeWalker(rootNode, 1 | 4);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) translateTextNode(node);
      else translateAttrs(node);
      node = walker.nextNode();
    }
  }

  let observer = null;
  function observe() {
    if (observer || !root.MutationObserver || !root.document) return;
    observer = new root.MutationObserver((records) => {
      if (lang === 'en') return;
      records.forEach((r) => {
        if (r.type === 'characterData') translateTextNode(r.target);
        else if (r.type === 'attributes') translateAttrs(r.target);
        else r.addedNodes.forEach((n) => translateDOM(n));
      });
    });
    observer.observe(root.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function info(code) {
    return LANGS.find((l) => l.code === (code || lang)) || LANGS[0];
  }

  function setLang(code, opts) {
    if (!supported(code)) code = 'en';
    lang = code;
    try {
      root.localStorage.setItem(STORE_KEY, code);
    } catch (e) {
      /* ignore */
    }
    if (root.document) {
      root.document.documentElement.lang = info(code).locale;
      if (!opts || !opts.silent) root.dispatchEvent(new root.CustomEvent('mint:lang', { detail: { lang: code } }));
      translateDOM(root.document.body);
    }
  }

  lang = detect();
  if (root.document) {
    root.document.documentElement.lang = info(lang).locale;
    // Watch from the start: app.js may render synchronously before DOMContentLoaded.
    observe();
    const sweep = () => translateDOM(root.document.body);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', sweep);
    else sweep();
    root.addEventListener('load', sweep);
  }

  K.LANGS = LANGS;
  K.t = t;
  K.i18n = {
    add: add,
    t: t,
    get lang() {
      return lang;
    },
    get locale() {
      return info().locale;
    },
    info: info,
    setLang: setLang,
    translateDOM: translateDOM,
    translateText: translateText,
    dict: (code) => dicts[code || lang] || {},
    /** Translate a runtime string (exact or pattern); falls back to the input. For text that never hits the DOM. */
    tr: (text) => {
      if (!text || lang === 'en') return text;
      const out = translateText(String(text).trim());
      return out == null ? text : out;
    },
    missing: () => Array.from(missing).sort(),
    resetMissing: () => missing.clear(),
    collect: (on) => {
      collect = on !== false;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
