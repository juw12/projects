// Copies the Vitals dashboard into www/ for the Android and iPhone apps. The app runs fully offline
// from these files and opens on the phone layout (mobile.html). The file list is the one the
// desktop installers use (../web/files.txt), so the phone app always ships the same dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.resolve(root, '..');
const www = path.join(root, 'www');
// The files are already on the phone: no offline worker or web-install manifest needed.
const skip = new Set(['web/sw.js', 'web/manifest.webmanifest']);

const files = fs.readFileSync(path.join(app, 'web/files.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('web/') && !skip.has(line));

fs.rmSync(www, { recursive: true, force: true });
for (const file of files) {
  const target = path.join(www, file.slice('web/'.length));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(app, file), target);
}

// Capacitor opens index.html: make it the phone layout.
const mobile = fs.readFileSync(path.join(app, 'web/mobile.html'), 'utf8')
  .replace(/\s*<link rel="manifest"[^>]*>/, '');
if (!mobile.includes('data-layout="mobile"')) {
  throw new Error('web/mobile.html no longer sets data-layout="mobile"');
}
fs.writeFileSync(path.join(www, 'index.html'), mobile);
console.log(`Copied ${files.length} dashboard files into www/ (index.html is the phone layout).`);
