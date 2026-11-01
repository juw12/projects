'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNativeI18n } = require('../native-i18n.cjs');
const { createPreferencesStore } = require('../preferences.cjs');
const { busyReason, waitPhrase } = require('../update-controller.cjs');

const webRoot = path.resolve(__dirname, '../../web');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');

function literalStrings() {
  const strings = new Set();
  // Menu labels: t('...')
  for (const match of mainSource.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)) strings.add(match[1]);
  // Dialog fields and buttons inside showDialog({...}) blocks.
  for (const block of mainSource.matchAll(/showDialog\(\{([\s\S]*?)\}\)/g)) {
    const body = block[1];
    // Skip the first piece of a concatenated string ('…' + …); full sentences are in dynamicSamples.
    for (const field of body.matchAll(/(?:title|message|detail):\s*'((?:[^'\\]|\\.)+)'(?!\s*\+)\s*(?:,|\n|$)/g)) strings.add(field[1]);
    const buttons = body.match(/buttons:\s*\[([^\]]*)\]/);
    if (buttons) for (const button of buttons[1].matchAll(/'((?:[^'\\]|\\.)+)'/g)) strings.add(button[1]);
  }
  strings.delete('AIRIZ Console');
  return [...strings].map(text => text.replace(/\\n/g, '\n').replace(/\\'/g, "'"));
}

const dynamicSamples = [
  'Allow access to camera?',
  'Allow access to microphone?',
  'Allow access to camera and microphone?',
  'Confirm this PIN matches the device: 123456',
  'Install AIRIZ Console 1.11.25 now?',
  'The device connection closes briefly, the update installs, and the app restarts and reconnects to the same device automatically. Finish any motion in progress first: closing the port does not stop an already-issued move. This release is unsigned.',
  'The app installs the update and restarts automatically. Finish any motion in progress first: closing the port does not stop an already-issued move. This release is unsigned.',
  'Windows desktop edition. The full interface is bundled locally.\n\nHardware control requires a compatible connected device. UI locking is not a hardware emergency stop.',
  'AIRIZ Console startup failed',
  'Media stays in this local console unless you explicitly save or export it, or choose Camera → Share to phone (live view for people with the link). The microphone is only used while you hold Hold to talk: that message goes to the AIRIZ speaker.',
  ...['a macro is running', 'a camera recording is running', 'a device audio transfer is running', 'a camera session is open']
    .map(reason => 'Install 1.11.25 automatically when ' + waitPhrase(reason) + '?')
];

test('main.cjs dialogs and menu labels were found', () => {
  const strings = literalStrings();
  assert.ok(strings.includes('Keep app open'));
  assert.ok(strings.includes('Check for updates…'));
  assert.ok(strings.length >= 30, 'found ' + strings.length);
});

for (const language of ['zh-TW', 'zh-CN']) {
  test(language + ': every native dialog and menu string is translated', () => {
    const text = createNativeI18n(webRoot, language);
    const missing = [...literalStrings(), ...dynamicSamples].filter(source => text.t(source) === source);
    assert.deepEqual(missing, []);
  });
}

test('English stays untouched and paragraph breaks survive translation', () => {
  const english = createNativeI18n(webRoot, 'en');
  assert.equal(english.t('Keep app open'), 'Keep app open');
  const chinese = createNativeI18n(webRoot, 'zh-TW');
  const about = chinese.t(dynamicSamples[7]);
  assert.match(about, /\n\n/);
  assert.doesNotMatch(about, /desktop edition|bundled|emergency stop/);
  const options = chinese.dialog({ title: 'Close AIRIZ Console?', buttons: ['Keep app open', 'Close anyway'], defaultId: 0 });
  assert.deepEqual(options.buttons, ['保持 App 開啟', '仍要關閉']);
  assert.equal(options.defaultId, 0);
});

test('unknown languages and a missing dictionary fall back to English', () => {
  const text = createNativeI18n(webRoot, 'zh-TW');
  text.setLanguage('fr');
  assert.equal(text.language(), 'en');
  const broken = createNativeI18n(path.join(os.tmpdir(), 'no-such-airiz-web'), 'zh-TW');
  assert.equal(broken.t('Keep app open'), 'Keep app open');
});

test('schedule confirmation reads "when the macro finishes", not "is running finishes"', () => {
  assert.equal(waitPhrase(busyReason({ connected: true, macroRunning: true })), 'the macro finishes');
  assert.equal(waitPhrase(busyReason({ connected: true, sessionActive: true })), 'the camera session is closed');
  assert.doesNotMatch(mainSource, /reason\.replace\(\/\^an\? \/, 'the '\) \+ ' finishes\?'/);
});

test('language preference is stored and normalized', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-prefs-'));
  const store = createPreferencesStore(directory);
  assert.equal(store.get('language'), 'en');
  assert.equal(store.set('language', 'zh-TW'), 'zh-TW');
  assert.equal(createPreferencesStore(directory).get('language'), 'zh-TW');
  assert.equal(store.set('language', 'klingon'), 'en');
  assert.equal(store.get('autoUpdate'), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
