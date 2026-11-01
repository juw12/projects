'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  // True: the desktop app auto-downloads and auto-installs updates when the device
  // is idle. False: the existing manual flow (Updates dialog) stays in charge.
  autoUpdate: false,
  // 1.11.25: console language, so native dialogs and the menu match the UI from the first moment.
  language: 'en'
});
const LANGUAGES = new Set(['en', 'zh-TW', 'zh-CN']);

function normalizeValue(key, value) {
  if (key === 'autoUpdate') return value === true;
  if (key === 'language') return LANGUAGES.has(value) ? value : DEFAULTS.language;
  return value;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

// Tiny per-user preferences store. Lives in the desktop app's userData folder so it
// survives restarts and stays separate from any browser/mobile localStorage. Atomic
// writes (write to .tmp then rename) so a crash mid-write never leaves a corrupt
// file that breaks the next launch.
function createPreferencesStore(directory) {
  const file = path.join(directory, 'preferences.json');
  let current = { ...DEFAULTS, ...readJson(file, {}) };
  // Defensive: unknown keys from older versions do not leak into the persisted file.
  current = {
    autoUpdate: normalizeValue('autoUpdate', current.autoUpdate),
    language: normalizeValue('language', current.language)
  };
  if (current.autoUpdate !== DEFAULTS.autoUpdate || current.language !== DEFAULTS.language) writeJson(file, current);

  return {
    get(key) {
      return key in current ? current[key] : DEFAULTS[key];
    },
    set(key, value) {
      if (!(key in DEFAULTS)) throw new Error('Unknown preference: ' + key);
      const normalized = normalizeValue(key, value);
      if (current[key] === normalized) return current[key];
      current = { ...current, [key]: normalized };
      writeJson(file, current);
      return current[key];
    },
    snapshot() {
      return { ...current };
    }
  };
}

module.exports = { createPreferencesStore, DEFAULTS };
