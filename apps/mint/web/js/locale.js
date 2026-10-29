/* Mint: language and region, shared by Budget (budget/) and Templates (app.html).
 *
 * Load it first, synchronously, in <head>. It
 *   1. moves budgets saved by older versions to their current storage keys (once, before any other script reads them);
 *   2. exposes window.MintLocale (languages, regions, the current choice);
 *   3. on a person's first visit, asks for a language and a region before the app continues.
 *      The region sets the currency for new budgets and templates. Both choices can be changed later in Settings.
 *
 * Storage: mint.lang (en | id | zh | es), mint.region (ISO country code or "XX" for other), mint.currency (ISO 4217).
 */
(function (root) {
  'use strict';

  var LANG_KEY = 'mint.lang';
  var REGION_KEY = 'mint.region';
  var CURRENCY_KEY = 'mint.currency';

  // ---------------------------------------------------------------- one-time storage migration
  // Budgets created before Mint 3.1 were saved under an older prefix. Copy them to mint.budget.* and drop the old keys.
  (function migrateStorage() {
    var LEGACY_PREFIX = 'kitty.';
    var LEGACY_LANG = 'kitty.lang';
    try {
      var store = root.localStorage;
      var legacyKeys = [];
      for (var i = 0; i < store.length; i++) {
        var key = store.key(i);
        if (key && key.indexOf(LEGACY_PREFIX) === 0) legacyKeys.push(key);
      }
      legacyKeys.forEach(function (key) {
        var value = store.getItem(key);
        if (key === LEGACY_LANG) {
          if (!store.getItem(LANG_KEY) && value) store.setItem(LANG_KEY, value);
        } else {
          var target = 'mint.budget.' + key.slice(LEGACY_PREFIX.length);
          if (store.getItem(target) === null && value !== null) store.setItem(target, value);
        }
        store.removeItem(key);
      });
    } catch (e) {
      /* storage blocked: nothing to move */
    }
  })();

  // ---------------------------------------------------------------- languages and regions
  var LANGS = [
    { code: 'en', name: 'English', locale: 'en' },
    { code: 'id', name: 'Bahasa Indonesia', locale: 'id' },
    { code: 'zh', name: '简体中文', locale: 'zh-CN' },
    { code: 'es', name: 'Español', locale: 'es' },
  ];

  // Region -> currency. Every currency here is supported by Budget; Templates falls back to US dollars for the
  // ones its sample data doesn't cover.
  var REGIONS = [
    ['ID', 'IDR'], ['SG', 'SGD'], ['MY', 'MYR'], ['PH', 'PHP'], ['TH', 'THB'], ['VN', 'VND'],
    ['CN', 'CNY'], ['HK', 'HKD'], ['TW', 'TWD'], ['JP', 'JPY'], ['KR', 'KRW'], ['IN', 'INR'],
    ['AU', 'AUD'], ['NZ', 'NZD'], ['US', 'USD'], ['CA', 'CAD'], ['MX', 'MXN'], ['CO', 'COP'],
    ['BR', 'BRL'], ['GB', 'GBP'], ['ES', 'EUR'], ['DE', 'EUR'], ['FR', 'EUR'], ['IT', 'EUR'],
    ['NL', 'EUR'], ['IE', 'EUR'], ['PT', 'EUR'], ['AE', 'AED'], ['XX', 'USD'],
  ].map(function (pair) {
    return { code: pair[0], currency: pair[1] };
  });

  var ENGLISH_REGION_NAMES = {
    ID: 'Indonesia', SG: 'Singapore', MY: 'Malaysia', PH: 'Philippines', TH: 'Thailand', VN: 'Vietnam',
    CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', JP: 'Japan', KR: 'South Korea', IN: 'India', AU: 'Australia',
    NZ: 'New Zealand', US: 'United States', CA: 'Canada', MX: 'Mexico', CO: 'Colombia', BR: 'Brazil',
    GB: 'United Kingdom', ES: 'Spain', DE: 'Germany', FR: 'France', IT: 'Italy', NL: 'Netherlands',
    IE: 'Ireland', PT: 'Portugal', AE: 'United Arab Emirates',
  };

  // Time zone -> region, for a good first guess when the browser language has no country (e.g. plain "en").
  var ZONE_REGION = {
    'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Pontianak': 'ID',
    'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Manila': 'PH',
    'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Shanghai': 'CN',
    'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Kolkata': 'IN',
    'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Europe/London': 'GB', 'Europe/Madrid': 'ES', 'Europe/Berlin': 'DE',
    'Europe/Paris': 'FR', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Dublin': 'IE', 'Europe/Lisbon': 'PT',
    'America/Mexico_City': 'MX', 'America/Bogota': 'CO', 'America/Sao_Paulo': 'BR', 'America/Toronto': 'CA',
    'America/Vancouver': 'CA', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Perth': 'AU',
    'Pacific/Auckland': 'NZ',
  };

  var TEXT = {
    en: {
      title: 'Welcome to Mint',
      lead: 'Choose your language and region to continue.',
      language: 'Language',
      region: 'Region',
      note: 'Your region sets the currency for new budgets and templates. You can change both later in Settings.',
      go: 'Continue',
      other: 'Other region',
      currency: 'Currency',
    },
    id: {
      title: 'Selamat datang di Mint',
      lead: 'Pilih bahasa dan wilayah untuk melanjutkan.',
      language: 'Bahasa',
      region: 'Wilayah',
      note: 'Wilayah menentukan mata uang untuk anggaran dan template baru. Keduanya bisa diubah nanti di Pengaturan.',
      go: 'Lanjutkan',
      other: 'Wilayah lain',
      currency: 'Mata uang',
    },
    zh: {
      title: '欢迎使用 Mint',
      lead: '请选择语言和地区以继续。',
      language: '语言',
      region: '地区',
      note: '地区决定新预算和新模板使用的货币。之后可在“设置”中更改。',
      go: '继续',
      other: '其他地区',
      currency: '货币',
    },
    es: {
      title: 'Bienvenido a Mint',
      lead: 'Elige tu idioma y tu región para continuar.',
      language: 'Idioma',
      region: 'Región',
      note: 'Tu región define la moneda de los presupuestos y plantillas nuevos. Puedes cambiar ambos más tarde en Ajustes.',
      go: 'Continuar',
      other: 'Otra región',
      currency: 'Moneda',
    },
  };

  function read(key) {
    try {
      return root.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      root.localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  function supportedLang(code) {
    return LANGS.some(function (l) {
      return l.code === code;
    });
  }

  function findRegion(code) {
    for (var i = 0; i < REGIONS.length; i++) {
      if (REGIONS[i].code === code) return REGIONS[i];
    }
    return null;
  }

  function browserLanguages() {
    var nav = root.navigator || {};
    return (nav.languages && nav.languages.length ? Array.prototype.slice.call(nav.languages) : [nav.language || 'en']).map(String);
  }

  function guessLang() {
    var langs = browserLanguages();
    for (var i = 0; i < langs.length; i++) {
      var base = langs[i].toLowerCase().split('-')[0];
      if (base === 'in' || base === 'ms') return 'id';
      if (supportedLang(base)) return base;
    }
    return 'en';
  }

  function guessRegion() {
    var langs = browserLanguages();
    for (var i = 0; i < langs.length; i++) {
      var match = /^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})\b/.exec(langs[i]);
      if (match && findRegion(match[1].toUpperCase())) return match[1].toUpperCase();
    }
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (ZONE_REGION[zone]) return ZONE_REGION[zone];
    } catch (e) {
      /* old browser */
    }
    var base = (langs[0] || 'en').toLowerCase().split('-')[0];
    return { id: 'ID', ms: 'MY', zh: 'CN', ja: 'JP', ko: 'KR', th: 'TH', vi: 'VN', es: 'ES' }[base] || 'XX';
  }

  function regionName(code, lang) {
    if (code === 'XX') return (TEXT[lang] || TEXT.en).other;
    try {
      var names = new Intl.DisplayNames([langInfo(lang).locale], { type: 'region' });
      var name = names.of(code);
      if (name && name !== code) return name;
    } catch (e) {
      /* Intl.DisplayNames is missing in old browsers */
    }
    return ENGLISH_REGION_NAMES[code] || code;
  }

  function currencyName(currency, lang) {
    try {
      var names = new Intl.DisplayNames([langInfo(lang).locale], { type: 'currency' });
      return names.of(currency) || currency;
    } catch (e) {
      return currency;
    }
  }

  function langInfo(code) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === code) return LANGS[i];
    }
    return LANGS[0];
  }

  function current() {
    var lang = read(LANG_KEY);
    var region = read(REGION_KEY);
    var known = findRegion(region);
    return {
      lang: supportedLang(lang) ? lang : guessLang(),
      region: known ? known.code : null,
      currency: read(CURRENCY_KEY) || (known ? known.currency : null),
      chosen: !!known,
    };
  }

  function save(lang, regionCode) {
    var region = findRegion(regionCode) || findRegion('XX');
    if (supportedLang(lang)) write(LANG_KEY, lang);
    write(REGION_KEY, region.code);
    write(CURRENCY_KEY, region.currency);
    try {
      root.dispatchEvent(new root.CustomEvent('mint:locale', { detail: { lang: lang, region: region.code, currency: region.currency } }));
    } catch (e) {
      /* ignore */
    }
    return region;
  }

  // ---------------------------------------------------------------- first-visit gate
  function scriptBase() {
    var scripts = root.document ? root.document.getElementsByTagName('script') : [];
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (/(^|\/)js\/locale\.js(\?|$)/.test(src)) return src.replace(/js\/locale\.js.*$/, '');
    }
    return '';
  }
  var BASE = scriptBase();

  function shouldAsk() {
    if (!root.document || current().chosen) return false;
    var params = new URLSearchParams(root.location.search);
    if (params.get('demo') === '1' || params.has('nolocale')) return false;
    if (/\/(demo|tests|get)\.html$/.test(root.location.pathname)) return false;
    return true;
  }

  var STYLE = [
    '.mint-locale{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;overflow:auto;',
    'background:var(--ml-bg);color:var(--ml-text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"PingFang SC","Noto Sans SC",sans-serif;',
    '--ml-bg:#f6f7f5;--ml-card:#fff;--ml-text:#101413;--ml-muted:#5d6763;--ml-line:#e2e6e3;--ml-accent:#0b8564;--ml-accent-ink:#fff;--ml-soft:#e7f4ef}',
    '.mint-locale.dark{--ml-bg:#0b0d0c;--ml-card:#151918;--ml-text:#eef2f0;--ml-muted:#9aa5a0;--ml-line:#262c2a;--ml-accent:#34d399;--ml-accent-ink:#04211a;--ml-soft:#12261f}',
    '.mint-locale .ml-card{width:min(520px,100%);background:var(--ml-card);border:1px solid var(--ml-line);border-radius:24px;padding:28px;box-shadow:0 24px 60px rgba(0,0,0,.12)}',
    '.mint-locale .ml-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px}',
    '.mint-locale .ml-brand img{width:36px;height:36px;border-radius:10px}',
    '.mint-locale h1{font-size:28px;line-height:1.15;letter-spacing:-.5px;margin:22px 0 6px}',
    '.mint-locale .ml-lead{color:var(--ml-muted);margin:0 0 22px}',
    '.mint-locale .ml-label{display:block;font-size:13px;font-weight:700;color:var(--ml-muted);margin:0 0 8px}',
    '.mint-locale .ml-langs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}',
    '.mint-locale .ml-lang{border:1px solid var(--ml-line);background:transparent;color:inherit;font:inherit;font-weight:600;border-radius:14px;padding:12px;text-align:left;cursor:pointer}',
    '.mint-locale .ml-lang[aria-pressed="true"]{border-color:var(--ml-accent);background:var(--ml-soft);box-shadow:inset 0 0 0 1px var(--ml-accent)}',
    '.mint-locale select{width:100%;font:inherit;color:inherit;background:var(--ml-card);border:1px solid var(--ml-line);border-radius:14px;padding:12px 14px}',
    '.mint-locale .ml-currency{color:var(--ml-muted);font-size:14px;margin:8px 2px 0}',
    '.mint-locale .ml-note{color:var(--ml-muted);font-size:13px;margin:18px 0 22px}',
    '.mint-locale .ml-go{width:100%;border:0;border-radius:14px;padding:14px;font:inherit;font-weight:800;background:var(--ml-accent);color:var(--ml-accent-ink);cursor:pointer}',
    '.mint-locale .ml-go:focus-visible,.mint-locale .ml-lang:focus-visible,.mint-locale select:focus-visible{outline:3px solid var(--ml-accent);outline-offset:2px}',
    '@media (max-width:420px){.mint-locale .ml-card{padding:22px}.mint-locale h1{font-size:24px}.mint-locale .ml-langs{grid-template-columns:1fr}}',
  ].join('');

  function prefersDark() {
    var theme = read('mint.theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showGate(onDone) {
    var doc = root.document;
    var state = { lang: current().lang, region: guessRegion() };
    var style = doc.createElement('style');
    style.textContent = STYLE;
    doc.head.appendChild(style);
    var wrap = doc.createElement('div');
    wrap.className = 'mint-locale' + (prefersDark() ? ' dark' : '');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'mint-locale-title');
    wrap.setAttribute('translate', 'no');
    doc.body.appendChild(wrap);
    doc.documentElement.style.overflow = 'hidden';

    function regionOptions() {
      var lang = state.lang;
      var list = REGIONS.filter(function (r) {
        return r.code !== 'XX';
      }).map(function (r) {
        return { code: r.code, name: regionName(r.code, lang) };
      });
      list.sort(function (a, b) {
        return a.name.localeCompare(b.name, langInfo(lang).locale);
      });
      list.push({ code: 'XX', name: regionName('XX', lang) });
      return list.map(function (r) {
        return '<option value="' + r.code + '"' + (r.code === state.region ? ' selected' : '') + '>' + escapeHtml(r.name) + '</option>';
      }).join('');
    }

    function render() {
      var t = TEXT[state.lang] || TEXT.en;
      var region = findRegion(state.region) || findRegion('XX');
      wrap.innerHTML =
        '<div class="ml-card">' +
        '<div class="ml-brand"><img src="' + BASE + 'icons/app-icon.svg" alt="">Mint</div>' +
        '<h1 id="mint-locale-title">' + escapeHtml(t.title) + '</h1>' +
        '<p class="ml-lead">' + escapeHtml(t.lead) + '</p>' +
        '<span class="ml-label" id="mint-locale-lang">' + escapeHtml(t.language) + '</span>' +
        '<div class="ml-langs" role="group" aria-labelledby="mint-locale-lang">' +
        LANGS.map(function (l) {
          return '<button type="button" class="ml-lang" data-lang="' + l.code + '" lang="' + l.locale + '" aria-pressed="' + (l.code === state.lang) + '">' + escapeHtml(l.name) + '</button>';
        }).join('') +
        '</div>' +
        '<label class="ml-label" for="mint-locale-region">' + escapeHtml(t.region) + '</label>' +
        '<select id="mint-locale-region">' + regionOptions() + '</select>' +
        '<p class="ml-currency">' + escapeHtml(t.currency) + ': ' + escapeHtml(currencyName(region.currency, state.lang)) + ' (' + region.currency + ')</p>' +
        '<p class="ml-note">' + escapeHtml(t.note) + '</p>' +
        '<button type="button" class="ml-go">' + escapeHtml(t.go) + '</button>' +
        '</div>';
      doc.documentElement.lang = langInfo(state.lang).locale;
    }

    wrap.addEventListener('click', function (event) {
      var langButton = event.target.closest('[data-lang]');
      if (langButton) {
        state.lang = langButton.getAttribute('data-lang');
        render();
        var again = wrap.querySelector('[data-lang="' + state.lang + '"]');
        if (again) again.focus();
        return;
      }
      if (event.target.closest('.ml-go')) {
        save(state.lang, state.region);
        doc.documentElement.style.overflow = '';
        wrap.remove();
        style.remove();
        if (onDone) onDone(current());
      }
    });
    wrap.addEventListener('change', function (event) {
      if (event.target.id === 'mint-locale-region') {
        state.region = event.target.value;
        render();
        var select = wrap.querySelector('#mint-locale-region');
        if (select) select.focus();
      }
    });
    render();
    var first = wrap.querySelector('.ml-lang[aria-pressed="true"]');
    if (first) first.focus();
  }

  var api = {
    LANGS: LANGS,
    REGIONS: REGIONS,
    current: current,
    save: save,
    regionName: regionName,
    currencyName: currencyName,
    guessRegion: guessRegion,
    // Show the language and region screen now (also used by "Language & region" in Settings).
    ask: function (onDone) {
      if (root.document.body) showGate(onDone);
      else root.document.addEventListener('DOMContentLoaded', function () {
        showGate(onDone);
      });
    },
  };
  root.MintLocale = api;

  // First visit: ask, then reload so every part of the page starts in the chosen language.
  if (shouldAsk()) {
    root.__mintLocalePending = true;
    api.ask(function () {
      root.location.reload();
    });
  }
})(window);
