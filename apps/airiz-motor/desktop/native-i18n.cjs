'use strict';

// 1.11.25: native Windows dialogs and the app menu follow the language chosen in the
// console (English / 繁體中文 / 简体中文). They use the same generated dictionary as the
// web UI (web/i18n-strings.js), so every translation lives in one place: i18n/zh-TW.json.

const fs = require('node:fs');
const path = require('node:path');

const LANGUAGES = new Set(['en', 'zh-TW', 'zh-CN']);

function normalize(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function loadDictionaries(webRoot) {
  try {
    const source = fs.readFileSync(path.join(webRoot, 'i18n-strings.js'), 'utf8');
    const start = source.indexOf('=');
    const end = source.lastIndexOf('}');
    if (start < 0 || end < start) return {};
    return JSON.parse(source.slice(start + 1, end + 1));
  } catch {
    // A missing or damaged dictionary must never block a safety dialog: fall back to English.
    return {};
  }
}

function createNativeI18n(webRoot, initialLanguage = 'en') {
  const dictionaries = loadDictionaries(webRoot);
  const compiled = {};
  let language = LANGUAGES.has(initialLanguage) ? initialLanguage : 'en';

  function patternsFor(code) {
    if (!compiled[code]) {
      compiled[code] = [];
      for (const [source, replacement] of dictionaries[code]?.patterns || []) {
        try {
          compiled[code].push([new RegExp(source), replacement]);
        } catch {
          // Skip a pattern the JS engine cannot compile.
        }
      }
    }
    return compiled[code];
  }

  function translateParagraph(text) {
    const dictionary = dictionaries[language];
    if (language === 'en' || !dictionary) return text;
    const key = normalize(text);
    if (!key) return text;
    if (Object.prototype.hasOwnProperty.call(dictionary.text || {}, key)) return dictionary.text[key];
    for (const [pattern, replacement] of patternsFor(language)) {
      if (pattern.test(key)) return key.replace(pattern, replacement);
    }
    return text;
  }

  // Blank-line separated paragraphs are translated one by one so dialog layout survives.
  function t(text) {
    if (text === undefined || text === null) return text;
    return String(text).split(/(\n\s*\n)/).map(part => (/^\n\s*\n$/.test(part) ? part : translateParagraph(part))).join('');
  }

  function dialog(options) {
    const translated = { ...options };
    for (const field of ['title', 'message', 'detail', 'checkboxLabel']) {
      if (typeof translated[field] === 'string') translated[field] = t(translated[field]);
    }
    if (Array.isArray(translated.buttons)) translated.buttons = translated.buttons.map(t);
    return translated;
  }

  return {
    t,
    dialog,
    language: () => language,
    setLanguage(code) {
      const next = LANGUAGES.has(code) ? code : 'en';
      const changed = next !== language;
      language = next;
      return changed;
    }
  };
}

module.exports = { createNativeI18n, LANGUAGES };
