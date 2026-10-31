'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every local module the main process requires must be listed in build.files,
// otherwise the packaged app crashes on start while `npm start` works fine.
test('every local module required by main.cjs ships in the packaged app', () => {
  const root = path.join(__dirname, '..');
  const files = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files
    .filter(entry => typeof entry === 'string');
  const pending = ['main.cjs', 'preload.cjs'];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(files.includes(file), file + ' is required at runtime but missing from build.files');
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) pending.push(match[1]);
  }
  assert.ok(seen.has('preferences.cjs'));
});
