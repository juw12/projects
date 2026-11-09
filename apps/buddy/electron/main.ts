/**
 * Electron main process for Buddy.
 * - Creates the main window
 * - Spawns the OS-level keyboard hook subprocess (PowerShell on Windows)
 * - Forwards keyboard events to the renderer for the audio + particle feedback
 * - Manages the system tray with pause/resume + quit
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } from 'electron';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/ipc.js';
import { spawnHook, type HookHandle } from './hooks/spawn.js';
import type { KeyboardEvent } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const APP_ROOT = app.getAppPath();
const RENDERER_FILE = path.join(APP_ROOT, 'dist', 'index.html');
const RENDERER_DEV_URL = VITE_DEV_SERVER_URL ?? `file://${RENDERER_FILE}`;
const HOOK_SCRIPT_PATH = path.join(APP_ROOT, 'scripts', 'keyboard-hook.ps1');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let hookHandle: HookHandle | null = null;
let isQuitting = false;
let keyboardPaused = false;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#06080d',
    show: true,
    frame: true,
    title: 'Buddy',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(RENDERER_DEV_URL);
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  return win;
}

function buildTrayIcon(): Electron.NativeImage {
  const TRAY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR42mNk+M9Qz0AEYBxVSF6F6BwcDQAAxkA1YQYGBgYGBgYGBgYGhgYGBgYGhgYGBgYGBgYG/ANqGQEAaP6D2QAAAABJRU5ErkJggg==';
  return nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_BASE64, 'base64'));
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: keyboardPaused ? 'Resume keyboard sound' : 'Pause keyboard sound',
      click: () => {
        keyboardPaused = !keyboardPaused;
        refreshTray();
        mainWindow?.webContents.send(IPC.KEYBOARD_EVENT, { __paused: keyboardPaused } as unknown as KeyboardEvent);
      },
    },
    { type: 'separator' },
    {
      label: 'Open Buddy',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Buddy',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(`Buddy — keyboard sound ${keyboardPaused ? 'paused' : 'active'}`);
}

async function startHook(): Promise<void> {
  if (hookHandle) return;
  hookHandle = spawnHook({
    scriptPath: HOOK_SCRIPT_PATH,
    onEvent: (event: KeyboardEvent) => {
      if (keyboardPaused) return;
      mainWindow?.webContents.send(IPC.KEYBOARD_EVENT, event);
    },
    onError: (err: Error) => {
      console.error('[hook] error:', err);
    },
    onExit: (code: number | null) => {
      console.log(`[hook] exited with code ${code}`);
      hookHandle = null;
    },
  });
}

async function stopHook(): Promise<void> {
  if (!hookHandle) return;
  await hookHandle.stop();
  hookHandle = null;
}

app.whenReady().then(async () => {
  mainWindow = createMainWindow();
  await startHook();

  tray = new Tray(buildTrayIcon());
  refreshTray();
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
});

app.on('window-all-closed', () => {
  /* keep running in tray */
});

app.on('before-quit', async () => {
  isQuitting = true;
  await stopHook();
});

app.on('will-quit', () => {
  if (process.platform === 'win32') {
    try {
      execSync('powershell -NoProfile -Command "Get-Process buddy-hook -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
    } catch {
      /* best effort */
    }
  }
});

ipcMain.handle('buddy:open-settings', () => {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.handle(IPC.GET_PROFILE, () => 'cherry-blue');

ipcMain.handle(IPC.SET_PROFILE, (_evt, profileId: string) => profileId);

app.on('web-contents-created', (_evt, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
