'use strict';

const path = require('node:path');

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'airiz:' && url.hostname === 'app'
      && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function resolveAsset(root, requestUrl) {
  if (!isAppUrl(requestUrl)) return null;
  try {
    const pathname = decodeURIComponent(new URL(requestUrl).pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return null;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = path.resolve(root, relative);
    const boundary = path.resolve(root) + path.sep;
    if (!full.startsWith(boundary)) return null;
    const extension = path.extname(full).toLowerCase();
    if (!['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.png', '.ico'].includes(extension)) return null;
    return full;
  } catch {
    return null;
  }
}

function canOpenExternal(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return (url.hostname === 'github.com' && url.pathname.startsWith('/juwpegatron/projects/'))
      || (url.hostname === 'juwpegatron.github.io' && url.pathname.startsWith('/projects/airiz-motor/'));
  } catch {
    return false;
  }
}

function publicPort(port) {
  return {
    id: String(port.portId),
    name: String(port.displayName || port.portName || 'Serial device'),
    port: String(port.portName || ''),
    vendorId: String(port.vendorId || ''),
    productId: String(port.productId || '')
  };
}

module.exports = { isAppUrl, resolveAsset, canOpenExternal, publicPort };
