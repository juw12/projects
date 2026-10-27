import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../web');
const output = path.join(root, 'www');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true, filter: name => !name.includes(path.sep + 'updates') && !name.endsWith('README.md') });
await build({ entryPoints: [path.join(root, 'src/mobile-bridge.mjs')], outfile: path.join(output, 'mobile-bridge.js'), bundle: true, format: 'iife', target: ['safari16', 'chrome100'], minify: false });
let html = fs.readFileSync(path.join(output, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
html = html.replace('<html ', '<html class="mobile-native" ');
html = html.replace(/(<body[^>]*>)/, '$1<div id="mobile-starting" role="status">Starting AIRIZ Mobile…</div>');
html = html.replace('<script src="data/commands.js">', '<script src="mobile-bridge.js"></script>\n<script src="data/commands.js">');
html = html.replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
const csp = "default-src 'self'; script-src 'self' " + hashes.join(' ')
  + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' capacitor: https://0.peerjs.com wss://0.peerjs.com wss://airiz-relay.juw12.workers.dev; object-src 'none'; frame-src 'none'; base-uri 'none'";
html = html.replace('</head>', '<meta http-equiv="Content-Security-Policy" content="' + csp + '"><link rel="stylesheet" href="mobile-native.css"></head>');
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.copyFileSync(path.join(root, 'src/mobile-native.css'), path.join(output, 'mobile-native.css'));
console.log('Bundled the shared console and native Bluetooth bridge; no remote UI is loaded.');
