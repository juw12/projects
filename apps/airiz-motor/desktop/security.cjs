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
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return (url.hostname === 'github.com' && url.pathname.startsWith('/juw12/projects/'))
      || (url.hostname === 'juw12.github.io' && url.pathname.startsWith('/projects/airiz-motor/'))
      || (!url.search && !url.hash && (url.href === 'https://teams.microsoft.com/'
        || url.href === 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook'));
  } catch {
    return false;
  }
}

// Ziris PTB Teams auto-post: Power Automate workflow / Teams webhook endpoints only.
function isTeamsWorkflowUrl(value) {
  try {
    const text = String(value || '').trim();
    if (!text || text.length > 4000 || /\s/.test(text)) return false;
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || (url.port && url.port !== '443')) return false;
    const allowedHost = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.logic\.azure\.com$/i.test(url.hostname)
      || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.api\.powerplatform\.com$/i.test(url.hostname)
      || /^[a-z0-9-]+\.webhook\.office\.com$/i.test(url.hostname);
    const triggerPath = /\/workflows\/[^/]+\/triggers\/[^/]+\/paths\/invoke\/?$/i.test(url.pathname)
      || (/\.webhook\.office\.com$/i.test(url.hostname) && /^\/webhookb2\/.+/i.test(url.pathname));
    return allowedHost && triggerPath;
  } catch {
    return false;
  }
}

// Owner setup is the only clipboard reader. Do not expose unrelated clipboard data to the renderer.
function teamsWorkflowFromClipboard(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return isTeamsWorkflowUrl(text) ? text : '';
}

// Ziris PTB invite handed over from the website / Teams:
//   airiz-console://join?team=ZPTB1-<base64url>&name=<display name>
// Only the pass text and a cleaned name leave this function; the renderer still validates the pass.
const DEEP_LINK_SCHEME = 'airiz-console';

function parseTeamInvite(value) {
  try {
    const text = String(value || '');
    if (text.length > 8000) return null;
    const url = new URL(text);
    if (url.protocol !== DEEP_LINK_SCHEME + ':' || url.username || url.password) return null;
    const action = (url.hostname || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase();
    if (action !== 'join') return null;
    const pass = String(url.searchParams.get('team') || '').trim();
    if (!/^ZPTB1-[A-Za-z0-9_-]{16,6000}$/.test(pass)) return null;
    const name = String(url.searchParams.get('name') || '')
      .replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { pass, name };
  } catch {
    return null;
  }
}

function findTeamInvite(argv) {
  for (const argument of Array.isArray(argv) ? argv : []) {
    if (typeof argument === 'string' && argument.toLowerCase().startsWith(DEEP_LINK_SCHEME + ':')) {
      const invite = parseTeamInvite(argument);
      if (invite) return invite;
    }
  }
  return null;
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

module.exports = {
  isAppUrl, resolveAsset, canOpenExternal, isTeamsWorkflowUrl, teamsWorkflowFromClipboard, publicPort,
  DEEP_LINK_SCHEME, parseTeamInvite, findTeamInvite
};
