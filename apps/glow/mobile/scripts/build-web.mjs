// Bundles GlowLead (and the pieces it loads) into www/ for the Android app. Nothing is loaded from a remote UI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.resolve(root, '../web');
const output = path.join(root, 'www');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const folder of ['lead', 'shared', 'room', 'icons']) {
  fs.cpSync(path.join(web, folder), path.join(output, folder), { recursive: true, filter: (name) => !name.endsWith('.md') });
}
// The app opens straight into GlowLead and never registers the web service worker (the app ships its own files).
fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=lead/index.html"><title>Glow</title>\n');
const leadHtml = path.join(output, 'lead', 'index.html');
let html = fs.readFileSync(leadHtml, 'utf8');
if (!html.includes('./lead.js')) throw new Error('GlowLead page layout changed: lead.js not found');
html = html.replace('<script src="./lead.js"', '<script>window.GLOW_NATIVE_APP = true;</script>\n<script src="./lead.js"');
html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
fs.writeFileSync(leadHtml, html);
console.log('Bundled GlowLead for the Glow Android app into www/.');
