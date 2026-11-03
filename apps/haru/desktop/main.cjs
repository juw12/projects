'use strict';
// Haru for Windows and macOS: the web app in ../web/app served from a private app:// origin,
// so ES modules, IndexedDB (the diary) and fetch work exactly as on the web, fully offline.
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const HOST = 'haru';
const START_URL = `${SCHEME}://${HOST}/index.html`;
const HOMEPAGE = 'https://juw12.github.io/projects/haru/app/';

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);
app.enableSandbox();
app.setAppUserModelId('io.github.juw12.haru');

const webRoot = app.isPackaged ? path.join(__dirname, 'app') : path.resolve(__dirname, '../web/app');

// Profile override for tests (keeps CI runs out of the real diary).
const profileArgument = process.argv.find((argument) => argument.startsWith('--haru-data-dir='));
if (profileArgument) app.setPath('userData', path.resolve(profileArgument.split('=')[1]));

function resolveAsset(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== HOST) return null;
  let relative = decodeURIComponent(url.pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const filePath = path.normalize(path.join(webRoot, relative));
  if (filePath !== webRoot && !filePath.startsWith(webRoot + path.sep)) return null;
  return filePath;
}

function isExternal(url) {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Haru',
    backgroundColor: '#F6EFE2',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(webRoot, 'icons/icon-512.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault();
      if (isExternal(url)) shell.openExternal(url);
    }
  });
  window.loadURL(START_URL);
  return window;
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, (request) => {
      const filePath = resolveAsset(request.url);
      if (!filePath) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    });

    // OpenStreetMap asks apps to identify themselves; app:// pages send no Referer of their own.
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://*.tile.openstreetmap.org/*'] },
      (details, callback) => {
        details.requestHeaders.Referer = HOMEPAGE;
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    // Only what the diary needs: no camera/mic/location prompts on desktop (photos come from files).
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
