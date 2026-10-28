/* AIRIZ Console language & region.
 *
 * The UI is written in English. This layer translates what is on screen (text, title, aria-label,
 * placeholder and a few rich guide paragraphs) from the dictionaries in i18n-strings.js, and keeps
 * translating whatever the app renders later (MutationObserver). Switching back to English restores
 * the original text. The serial console output, inputs and code are never translated.
 *
 * First start: a modal asks for language and region before the console can be used.
 * Later: header button "Language" opens the same dialog.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'airiz.i18n.v1';
  const LANGUAGES = {
    en: { label: 'English', htmlLang: 'en' },
    'zh-TW': { label: '繁體中文', htmlLang: 'zh-Hant-TW' },
    'zh-CN': { label: '简体中文', htmlLang: 'zh-Hans-CN' }
  };
  const REGIONS = {
    TW: { flag: 'TW', timeZone: 'Asia/Taipei', language: 'zh-TW', names: { en: 'Taiwan', 'zh-TW': '台灣', 'zh-CN': '台湾' } },
    CN: { flag: 'CN', timeZone: 'Asia/Shanghai', language: 'zh-CN', names: { en: 'China (mainland)', 'zh-TW': '中國大陸', 'zh-CN': '中国大陆' } },
    ID: { flag: 'ID', timeZone: 'Asia/Jakarta', language: 'en', names: { en: 'Indonesia (Batam)', 'zh-TW': '印尼（巴淡島）', 'zh-CN': '印尼（巴淡岛）' } },
    OTHER: { flag: '', timeZone: '', language: 'en', names: { en: 'Other', 'zh-TW': '其他地區', 'zh-CN': '其他地区' } }
  };
  const UI = {
    en: {
      title: 'Language & region',
      welcome: 'Welcome to AIRIZ Console',
      intro: 'Choose the language for the console and the region you work in. You can change both later with the Language button at the top.',
      language: 'Language',
      region: 'Region',
      regionNote: 'The region sets date and time formats and is shown on Teams share-code posts.',
      start: 'Continue',
      save: 'Save',
      cancel: 'Cancel',
      button: 'Language'
    },
    'zh-TW': {
      title: '語言與地區',
      welcome: '歡迎使用 AIRIZ Console',
      intro: '請選擇主控台的顯示語言與您所在的地區。之後可隨時從上方的「語言」按鈕變更。',
      language: '語言',
      region: '地區',
      regionNote: '地區用於日期與時間格式，並會顯示在 Teams 分享代碼的訊息中。',
      start: '繼續',
      save: '儲存',
      cancel: '取消',
      button: '語言'
    },
    'zh-CN': {
      title: '语言与地区',
      welcome: '欢迎使用 AIRIZ Console',
      intro: '请选择控制台的显示语言与您所在的地区。之后可随时从上方的“语言”按钮更改。',
      language: '语言',
      region: '地区',
      regionNote: '地区用于日期与时间格式，并会显示在 Teams 分享代码的消息中。',
      start: '继续',
      save: '保存',
      cancel: '取消',
      button: '语言'
    }
  };
  const ATTRIBUTES = ['title', 'aria-label', 'placeholder'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'svg', 'SVG']);
  const SKIP_SELECTOR = '[data-i18n-skip], #console-output, .console-output, #i18n-dialog';
  const INLINE_TAGS = new Set(['B', 'STRONG', 'EM', 'I', 'CODE', 'KBD', 'A', 'BR', 'SMALL', 'SPAN', 'U', 'MARK']);
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  const sources = new WeakMap();        // text node -> English source
  const written = new WeakMap();        // text node -> last value written by this layer
  const attrSources = new WeakMap();    // element -> { attr: English }
  const attrWritten = new WeakMap();    // element -> { attr: value written }
  const blockSources = new WeakMap();   // element -> original English innerHTML
  const translatedBlocks = new Set();
  const missing = new Set();
  let settings = loadSettings();
  let dictionary = null;
  let reverse = new Map();
  let observer = null;

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && LANGUAGES[stored.language] && REGIONS[stored.region]) return stored;
    } catch (error) {
      // Fall through to defaults.
    }
    return null;
  }

  function saveSettings(next) {
    settings = { language: next.language, region: next.region, chosen: true, at: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // Storage unavailable: keep the choice for this session only.
    }
  }

  function guessRegion() {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (error) {
      zone = '';
    }
    const lang = (navigator.language || '').toLowerCase();
    if (zone === 'Asia/Taipei' || lang === 'zh-tw') return 'TW';
    if (zone === 'Asia/Shanghai' || zone === 'Asia/Chongqing' || zone === 'Asia/Urumqi' || lang === 'zh-cn') return 'CN';
    if (zone.startsWith('Asia/Jakarta') || zone === 'Asia/Pontianak' || lang.startsWith('id')) return 'ID';
    return 'OTHER';
  }

  function guessLanguage(region) {
    const lang = (navigator.language || '').toLowerCase();
    if (lang === 'zh-tw' || lang === 'zh-hk' || lang.startsWith('zh-hant')) return 'zh-TW';
    if (lang.startsWith('zh')) return 'zh-CN';
    return REGIONS[region].language;
  }

  function currentLanguage() {
    return settings ? settings.language : 'en';
  }

  function currentRegion() {
    return settings ? settings.region : guessRegion();
  }

  function locale() {
    const language = currentLanguage();
    const region = currentRegion();
    if (language === 'en') return region === 'OTHER' ? undefined : 'en-' + REGIONS[region].flag;
    return language;
  }

  function normalize(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ dictionary

  function loadDictionary(language) {
    const all = window.AIRIZ_I18N_STRINGS || {};
    dictionary = language === 'en' ? null : (all[language] || null);
    reverse = new Map();
    if (!dictionary) return;
    dictionary.compiled = dictionary.compiled || (dictionary.patterns || []).map(([source, target]) => [new RegExp(source), target]);
    for (const [key, value] of Object.entries(dictionary.text || {})) reverse.set(value, key);
  }

  function formatDate(day, month, year) {
    const date = new Date(Date.UTC(year, month, day || 1, 12));
    const options = day
      ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
      : { year: 'numeric', month: 'long', timeZone: 'UTC' };
    try {
      return new Intl.DateTimeFormat(locale(), options).format(date);
    } catch (error) {
      return null;
    }
  }

  function translateCore(text) {
    // Dates such as "23 Oct 2026" or "Jun 2026" follow the region in every language.
    let match = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(text);
    if (match) return formatDate(Number(match[1]), MONTHS[match[2]], Number(match[3]));
    match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(text);
    if (match) return formatDate(0, MONTHS[match[1]], Number(match[2]));
    if (!dictionary) return null;
    const direct = dictionary.text[text];
    if (direct !== undefined) return direct;
    for (const [pattern, target] of dictionary.compiled) {
      if (pattern.test(text)) {
        return text.replace(pattern, (...groups) => target.replace(/\$(\d)/g, (_, index) => {
          const value = groups[Number(index)] || '';
          return dictionary.text[value] !== undefined ? dictionary.text[value] : value;
        }));
      }
    }
    if (/[A-Za-z]{3}/.test(text) && missing.size < 2000) missing.add(text);
    return null;
  }

  function translateString(value) {
    const core = normalize(value);
    if (!core || !/[A-Za-z]/.test(core)) return null;
    const translated = translateCore(core);
    if (translated === null || translated === core) return null;
    const lead = value.match(/^\s*/)[0];
    const trail = value.match(/\s*$/)[0];
    return (lead ? ' ' : '') + translated + (trail && trail !== value ? ' ' : '');
  }

  function t(text) {
    if (typeof text !== 'string') return text;
    return translateString(text) || text;
  }

  // ------------------------------------------------------------------ DOM

  function skipped(element) {
    return !element || SKIP_TAGS.has(element.tagName) || !!element.closest(SKIP_SELECTOR) || element.isContentEditable;
  }

  function englishFor(node) {
    const value = node.nodeValue;
    if (written.get(node) === value) return sources.get(node);
    // Changed by the app. If the app wrote back a translated label, map it to English again.
    const english = reverse.has(normalize(value)) ? reverse.get(normalize(value)) : value;
    sources.set(node, english);
    return english;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (skipped(parent) || inTranslatedBlock(parent)) return;
    const english = englishFor(node);
    if (english === undefined || !/[A-Za-z]/.test(english)) return;
    const next = dictionary || hasDate(english) ? (translateString(english) || english) : english;
    if (node.nodeValue !== next) {
      written.set(node, next);
      node.nodeValue = next;
    } else {
      written.set(node, next);
    }
  }

  function hasDate(text) {
    return /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/.test(text);
  }

  function translateAttributes(element) {
    if (skipped(element) && element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT') return;
    if (element.closest(SKIP_SELECTOR)) return;
    let originals = attrSources.get(element);
    let writes = attrWritten.get(element);
    for (const name of ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name);
      if (!originals) {
        originals = {};
        writes = {};
        attrSources.set(element, originals);
        attrWritten.set(element, writes);
      }
      if (writes[name] !== value) originals[name] = reverse.get(normalize(value)) || value;
      const english = originals[name];
      const next = dictionary ? (translateString(english) || english) : english;
      writes[name] = next;
      if (value !== next) element.setAttribute(name, next);
    }
  }

  function isMixed(element) {
    let hasText = false;
    let hasInline = false;
    for (const child of element.childNodes) {
      if (child.nodeType === 3 && /[A-Za-z]{2}/.test(child.nodeValue)) hasText = true;
      if (child.nodeType === 1) {
        if (!INLINE_TAGS.has(child.tagName) || child.id || child.querySelector('[id], input, button, select')) return false;
        hasInline = true;
      }
    }
    return hasText && hasInline;
  }

  function inTranslatedBlock(element) {
    for (let current = element; current; current = current.parentElement) {
      if (current.dataset && current.dataset.i18nBlock) return true;
    }
    return false;
  }

  function translateBlock(element) {
    if (!dictionary || !dictionary.html || element.id || element.dataset.i18nBlock || skipped(element)) return false;
    if (!isMixed(element)) return false;
    const html = dictionary.html[normalize(element.textContent)];
    if (html === undefined) return false;
    blockSources.set(element, element.innerHTML);
    element.dataset.i18nBlock = currentLanguage();
    element.innerHTML = html;
    translatedBlocks.add(element);
    return true;
  }

  function restoreBlocks() {
    for (const element of translatedBlocks) {
      if (blockSources.has(element)) element.innerHTML = blockSources.get(element);
      delete element.dataset.i18nBlock;
    }
    translatedBlocks.clear();
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 || root.closest(SKIP_SELECTOR)) return;
    const elements = [root, ...root.querySelectorAll('*')];
    for (const element of elements) {
      if (element.closest(SKIP_SELECTOR)) continue;
      translateAttributes(element);
      if (!inTranslatedBlock(element)) translateBlock(element);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          if (written.get(record.target) !== record.target.nodeValue) translateTextNode(record.target);
        } else if (record.type === 'attributes') {
          const element = record.target;
          const writes = attrWritten.get(element);
          if (!writes || writes[record.attributeName] !== element.getAttribute(record.attributeName)) translateAttributes(element);
        } else {
          if (record.target.nodeType === 1 && record.target.dataset.i18nBlock) continue;
          for (const node of record.addedNodes) translateTree(node);
          const parent = record.target;
          if (parent.nodeType === 1 && !parent.dataset.i18nBlock && !parent.id && dictionary) {
            if (translateBlock(parent)) continue;
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES
    });
  }

  function apply() {
    const language = currentLanguage();
    restoreBlocks();
    loadDictionary(language);
    document.documentElement.lang = LANGUAGES[language].htmlLang;
    document.documentElement.dataset.region = currentRegion();
    translateTree(document.body);
    renderButton();
    window.dispatchEvent(new CustomEvent('airiz:language', { detail: { language, region: currentRegion() } }));
  }

  // ------------------------------------------------------------------ dialog

  function ui() {
    return UI[currentLanguage()] || UI.en;
  }

  function buildDialog() {
    let dialog = document.getElementById('i18n-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'i18n-dialog';
    dialog.className = 'help-dialog i18n-dialog';
    dialog.setAttribute('aria-labelledby', 'i18n-title');
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', event => {
      if (!settings) event.preventDefault();
    });
    return dialog;
  }

  function regionLabel(code, language) {
    return REGIONS[code].names[language] || REGIONS[code].names.en;
  }

  function renderDialog(dialog, draft, firstRun) {
    const text = UI[draft.language] || UI.en;
    const languageButtons = Object.entries(LANGUAGES).map(([code, info]) =>
      `<button type="button" class="i18n-choice${code === draft.language ? ' selected' : ''}" data-language="${code}" aria-pressed="${code === draft.language}">${info.label}</button>`).join('');
    const regionOptions = Object.keys(REGIONS).map(code =>
      `<option value="${code}"${code === draft.region ? ' selected' : ''}>${regionLabel(code, draft.language)}</option>`).join('');
    dialog.innerHTML = `
      <form method="dialog" class="i18n-form">
        <div class="i18n-globe" aria-hidden="true">🌐</div>
        <h2 id="i18n-title">${firstRun ? text.welcome : text.title}</h2>
        <p class="i18n-intro">${text.intro}</p>
        <div class="i18n-field"><span class="i18n-label">${text.language}</span><div class="i18n-choices" role="group">${languageButtons}</div></div>
        <label class="i18n-field"><span class="i18n-label">${text.region}</span><select class="select" id="i18n-region">${regionOptions}</select></label>
        <p class="i18n-note">${text.regionNote}</p>
        <div class="i18n-actions">
          ${firstRun ? '' : `<button type="button" class="btn btn-secondary" id="i18n-cancel">${text.cancel}</button>`}
          <button type="submit" class="btn btn-primary" id="i18n-save">${firstRun ? text.start : text.save}</button>
        </div>
      </form>`;
    for (const button of dialog.querySelectorAll('[data-language]')) {
      button.addEventListener('click', () => {
        draft.language = button.dataset.language;
        draft.languageTouched = true;
        renderDialog(dialog, draft, firstRun);
      });
    }
    dialog.querySelector('#i18n-region').addEventListener('change', event => {
      const previous = draft.region;
      draft.region = event.target.value;
      // Suggest the region's language only if the user has not picked one yet.
      if (!draft.languageTouched && REGIONS[previous].language === draft.language) draft.language = REGIONS[draft.region].language;
      renderDialog(dialog, draft, firstRun);
    });
    const cancel = dialog.querySelector('#i18n-cancel');
    if (cancel) cancel.addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', () => {
      saveSettings(draft);
      apply();
    });
  }

  function openDialog(firstRun) {
    const dialog = buildDialog();
    const region = currentRegion();
    const draft = { language: settings ? settings.language : guessLanguage(region), region, languageTouched: !!settings };
    renderDialog(dialog, draft, firstRun);
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector('.i18n-choice.selected');
    if (first) first.focus();
  }

  function renderButton() {
    let button = document.getElementById('btn-language');
    const host = document.querySelector('.header-meta');
    if (!button && host) {
      button = document.createElement('button');
      button.id = 'btn-language';
      button.type = 'button';
      button.className = 'theme-switcher';
      button.dataset.i18nSkip = '';
      button.addEventListener('click', () => openDialog(false));
      const theme = document.getElementById('theme-toggle');
      host.insertBefore(button, theme || host.firstChild);
    }
    if (!button) return;
    const language = currentLanguage();
    button.innerHTML = `<span aria-hidden="true">🌐</span><span>${LANGUAGES[language].label} · ${regionLabel(currentRegion(), language)}</span>`;
    button.title = ui().title;
    button.setAttribute('aria-label', ui().title);
  }

  // ------------------------------------------------------------------ native dialogs

  for (const name of ['alert', 'confirm', 'prompt']) {
    const original = window[name];
    if (typeof original !== 'function') continue;
    window[name] = function (message, ...rest) {
      return original.call(window, t(message), ...rest);
    };
  }

  function originalText(element) {
    if (!element) return '';
    let text = '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) text += sources.has(node) ? sources.get(node) : node.nodeValue;
    return text;
  }

  function start() {
    apply();
    observe();
    if (!settings) openDialog(true);
  }

  window.AirizI18n = {
    t,
    language: currentLanguage,
    region: currentRegion,
    regionLabel: code => regionLabel(code || currentRegion(), 'en'),
    locale,
    timeZone: () => (REGIONS[currentRegion()] || REGIONS.OTHER).timeZone || undefined,
    originalText,
    open: () => openDialog(!settings),
    missing: () => [...missing].sort(),
    set(language, region) {
      if (!LANGUAGES[language] || !REGIONS[region || currentRegion()]) return false;
      saveSettings({ language, region: region || currentRegion() });
      apply();
      return true;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
