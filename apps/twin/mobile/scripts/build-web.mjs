// Copies Twin's web app (../web) into www/ for the Android app. The app opens the same Twin as
// https://juw12.github.io/projects/twin/ and runs from these files, so it works without a connection:
// practice money, replays and research. Real trading needs Twin's own server on a computer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.resolve(root, '..', 'web');
const www = path.join(root, 'www');
// The files are already on the phone: no offline worker, no web-install manifest, no desktop settings.
const skip = new Set(['sw.js', 'manifest.webmanifest', 'desktop.json']);

fs.rmSync(www, { recursive: true, force: true });
let copied = 0;
function copy(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) {
      continue;
    }
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copy(source, target);
    } else {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(source, target);
      copied += 1;
    }
  }
}
copy(web, www);

// Every page that linked the web-install manifest loses the link (the file is not shipped).
let pages = 0;
function unlink(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      unlink(file);
    } else if (entry.name.endsWith('.html')) {
      const before = fs.readFileSync(file, 'utf8');
      const after = before.replace(/[ \t]*<link rel="manifest"[^>]*>\r?\n?/g, '');
      if (after !== before) {
        fs.writeFileSync(file, after);
        pages += 1;
      }
    }
  }
}
unlink(www);

const index = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
if (!index.includes('<div id="app"></div>')) {
  throw new Error('web/index.html no longer has <div id="app"></div>: the Android check looks for it');
}
console.log(`Copied ${copied} Twin files into www/ (${pages} page(s) without the web-install manifest).`);
