'use strict';

const { app, BrowserWindow, protocol, session, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { isAppUrl, resolveAsset, canOpenExternal } = require('./security.cjs');
const { createSerialChooser } = require('./serial-chooser.cjs');
const { createUpdateController } = require('./update-controller.cjs');
const { createGrantStore } = require('./device-grants.cjs');

protocol.registerSchemesAsPrivileged([{
  scheme: 'airiz',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);
app.enableSandbox();
app.setAppUserModelId('com.airiz.console');

// Tests and managed portable deployments can explicitly choose their profile.
// Normal installed usage stores its own workspace in Electron's per-user app data.
const profileArgument = process.argv.find(argument => argument.startsWith('--airiz-data-dir='));
if (profileArgument) {
  const profile = path.resolve(profileArgument.slice('--airiz-data-dir='.length));
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  for (const [key, directory] of [['sessionData', 'session'], ['logs', 'logs'], ['crashDumps', 'crashes']]) {
    const destination = path.join(profile, directory);
    fs.mkdirSync(destination, { recursive: true });
    app.setPath(key, destination);
  }
}

let mainWindow = null;
let chooser = null;
let updates = null;
let grants = null;
let bluetoothCallback = null;
let closeConfirmed = false;
let closeDialogPending = false;
const webRoot = app.isPackaged ? path.join(__dirname, 'web') : path.resolve(__dirname, '../web');
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

function trustedSender(event) {
  return mainWindow && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && isAppUrl(event.senderFrame.url);
}

function buildCsp() {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
  return [
    "default-src 'self'", "script-src 'self' " + hashes.join(' '),
    "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:",
    "media-src 'self' blob:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'none'", "frame-src 'none'", "form-action 'none'"
  ].join('; ');
}

async function closeSafely(event) {
  if (closeConfirmed) return;
  event.preventDefault();
  if (closeDialogPending) return;
  closeDialogPending = true;
  try {
    const state = await mainWindow.webContents.executeJavaScript('window.AirizConsole?.getStatus?.() || {}');
    const active = (state.connected && !state.demoMode) || state.macroRunning
      || state.cameraRecording || state.sessionActive;
    if (active) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'Finish the device session before closing',
        message: 'A device connection, macro, recording or session is active.',
        detail: 'Closing disconnects this console. It does NOT stop a motor move already sent. Finish or safely stop your bench test first. Unsaved recording/session output may be interrupted.',
        buttons: ['Keep app open', 'Close anyway'], defaultId: 0, cancelId: 0,
        noLink: true
      });
      if (result.response !== 1) return;
    }
    chooser?.cancel();
    closeConfirmed = true;
    mainWindow.close();
  } catch {
    // A failed renderer must not silently discard a potentially active session.
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'Close AIRIZ Console?',
      message: 'The console state could not be read.',
      detail: 'Confirm the device is safe before closing. Closing this app is not a motor-stop command.',
      buttons: ['Keep app open', 'Close anyway'], defaultId: 0, cancelId: 0
    });
    if (result.response === 1) {
      closeConfirmed = true;
      mainWindow.destroy();
    }
  } finally {
    closeDialogPending = false;
  }
}

function configurePermissions(appSession) {
  const allowed = new Set(['serial', 'bluetooth', 'media', 'fileSystem', 'clipboard-sanitized-write', 'fullscreen']);
  const approvedMedia = new Set();
  appSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    const trusted = contents === mainWindow?.webContents && allowed.has(permission)
      && (isAppUrl(origin) || isAppUrl(details?.requestingUrl) || isAppUrl(details?.securityOrigin));
    if (!trusted) return false;
    if (permission === 'media') return approvedMedia.has(details?.mediaType);
    return true;
  });
  appSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const trusted = contents === mainWindow?.webContents
      && isAppUrl(details.requestingUrl || contents.getURL());
    if (!trusted || !allowed.has(permission)) {
      callback(false);
      return;
    }
    if (permission === 'media') {
      const kinds = details.mediaTypes?.join(' and ') || 'camera or microphone';
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'AIRIZ device media access',
        message: 'Allow access to ' + kinds + '?',
        detail: 'Media stays in this local console unless you explicitly save or export it.',
        buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response === 1) {
        for (const kind of details.mediaTypes || []) approvedMedia.add(kind);
      }
      callback(result.response === 1);
      return;
    }
    // File access still uses Chromium's native, user-initiated file/folder picker.
    callback(true);
  });
  appSession.on('file-system-access-restricted', (event, _details, callback) => {
    event.preventDefault();
    callback('tryAgain');
  });
  appSession.on('will-download', (event, item, contents) => {
    if (contents !== mainWindow?.webContents || !isAppUrl(contents.getURL())) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      title: 'Save AIRIZ export',
      defaultPath: path.basename(item.getFilename())
    });
  });
}

async function createWindow() {
  const csp = buildCsp();
  protocol.handle('airiz', async request => {
    const filename = resolveAsset(webRoot, request.url);
    if (!filename || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    try {
      const content = request.method === 'HEAD' ? null : await fs.promises.readFile(filename);
      return new Response(content, {
        headers: {
          'Content-Type': contentTypes[path.extname(filename).toLowerCase()],
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  mainWindow = new BrowserWindow({
    width: 1460, height: 1040, minWidth: 760, minHeight: 650,
    title: 'AIRIZ Console', backgroundColor: '#0d1117',
    icon: path.join(__dirname, 'assets', 'app.ico'), show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false, webviewTag: false
    }
  });
  configurePermissions(session.defaultSession);
  grants = createGrantStore(app.getPath('userData'));
  // Only ports the user explicitly chose before are reopened automatically.
  session.defaultSession.setDevicePermissionHandler(details => {
    return details.deviceType === 'serial' && isAppUrl(details.origin) && grants.allows(details.device);
  });
  chooser = createSerialChooser(session.defaultSession, () => mainWindow, port => grants.remember(port));

  // Web Bluetooth device picker for the in-app Bluetooth check.
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    bluetoothCallback = callback;
    mainWindow.webContents.send('airiz:bluetooth-devices', devices.slice(0, 200).map(device => ({
      id: String(device.deviceId),
      name: String(device.deviceName || '')
    })));
  });
  session.defaultSession.setBluetoothPairingHandler(async (details, callback) => {
    if (details.pairingKind === 'providePin') {
      callback({ confirmed: false });
      return;
    }
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Pair Bluetooth device?',
      message: 'Pair with the selected Bluetooth device?',
      detail: details.pin ? 'Confirm this PIN matches the device: ' + details.pin : 'Only pair with your own AIRIZ device.',
      buttons: ['Cancel', 'Pair'], defaultId: 0, cancelId: 0, noLink: true
    });
    callback({ confirmed: answer.response === 1 });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (canOpenExternal(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', () => {
    chooser.cancel();
    if (bluetoothCallback) bluetoothCallback('');
    bluetoothCallback = null;
  });
  mainWindow.on('close', closeSafely);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  ipcMain.handle('airiz:app-info', event => {
    if (!trustedSender(event)) throw new Error('Untrusted sender');
    return { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, offline: true, portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
  });
  ipcMain.handle('airiz:bluetooth-choice', (event, id) => {
    if (!trustedSender(event) || typeof id !== 'string' || id.length > 256 || !bluetoothCallback) return false;
    const callback = bluetoothCallback;
    bluetoothCallback = null;
    callback(id);
    return true;
  });
  ipcMain.handle('airiz:take-pending-reconnect', event => {
    if (!trustedSender(event)) throw new Error('Untrusted sender');
    return grants.takePendingReconnect();
  });
  ipcMain.handle('airiz:serial-choice', (event, id) => {
    if (!trustedSender(event) || typeof id !== 'string' || id.length > 256) return false;
    return chooser.choose(event.sender, id);
  });

  const { autoUpdater } = require('electron-updater');
  updates = createUpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    publish: state => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('airiz:update-state', state);
    },
    getDeviceState: () => mainWindow.webContents.executeJavaScript('window.AirizConsole?.getStatus?.() || null'),
    confirmInstall: async (version, connected) => {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Install AIRIZ update?',
        message: 'Install AIRIZ Console ' + version + ' now?',
        detail: (connected
          ? 'The device connection closes briefly, the update installs, and the app restarts and reconnects to the same device automatically. '
          : 'The app installs the update and restarts automatically. ')
          + 'Finish any motion in progress first: closing the port does not stop an already-issued move. This release is unsigned.',
        buttons: ['Not now', 'Install and restart'], defaultId: 1, cancelId: 0, noLink: true
      });
      return answer.response === 1;
    },
    confirmSchedule: async (version, reason) => {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Install AIRIZ update when finished?',
        message: 'Install ' + version + ' automatically when ' + reason.replace(/^an? /, 'the ') + ' finishes?',
        detail: 'You can keep working. When it finishes, the app installs the update, restarts and reconnects to the same device.',
        buttons: ['Not now', 'Install when finished'], defaultId: 1, cancelId: 0, noLink: true
      });
      return answer.response === 1;
    },
    prepareForInstall: async () => {
      const result = await mainWindow.webContents.executeJavaScript('window.AirizConsole?.prepareForUpdate?.() || null');
      if (!result || result.ready !== true) return false;
      if (result.reconnect) grants.savePendingReconnect(result.reconnect);
      chooser.cancel();
      closeConfirmed = true;
      return true;
    },
    abortInstall: async () => {
      closeConfirmed = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.executeJavaScript('window.AirizConsole?.cancelPreparedUpdate?.()');
      }
    },
    openPortable: url => {
      if (canOpenExternal(url)) return shell.openExternal(url);
      throw new Error('Unexpected portable update URL.');
    }
  });
  for (const [channel, action] of [
    ['airiz:update-state', () => updates.snapshot()],
    ['airiz:update-check', () => updates.check()],
    ['airiz:update-download', () => updates.download()],
    ['airiz:update-install', () => updates.install()],
    ['airiz:update-cancel-schedule', () => updates.cancelScheduled()]
  ]) {
    ipcMain.handle(channel, event => {
      if (!trustedSender(event)) throw new Error('Untrusted update request.');
      return action();
    });
  }
  if (app.isPackaged) {
    setTimeout(() => updates.check(), 5000).unref();
    setInterval(() => updates.check(), 6 * 60 * 60 * 1000).unref();
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Close AIRIZ Console', accelerator: 'Alt+F4', click: () => mainWindow.close() }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Check for updates…', click: () => {
        mainWindow.webContents.send('airiz:show-updates');
        updates.check();
      } },
      { label: 'About AIRIZ Console', click: () => dialog.showMessageBox(mainWindow, {
        title: 'AIRIZ Console', message: 'AIRIZ Console ' + app.getVersion(),
        detail: 'Windows desktop edition. The full interface is bundled locally.\n\nHardware control requires a compatible connected device. UI locking is not a hardware emergency stop.'
      }) },
      { label: 'Release notes and downloads', click: () => shell.openExternal('https://github.com/juw12/projects/releases/tag/airiz-desktop-v' + app.getVersion()) }
    ] }
  ]));
  await mainWindow.loadURL('airiz://app/');
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch(error => {
    dialog.showErrorBox('AIRIZ Console startup failed', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
