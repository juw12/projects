'use strict';

// 1.11.6: Camera > Open in new window inside the packaged Windows app.
const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const profile = path.join(root, '.test-data', 'camera-window');

(async () => {
  fs.rmSync(profile, { recursive: true, force: true });
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--airiz-data-dir=' + profile, '--use-fake-device-for-media-stream'],
    timeout: 60000,
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') }
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (_window, options) => ({ response: options.title === 'AIRIZ device media access' ? 1 : 0 });
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.airizDesktop && window.AirizConsole);
    await page.locator('#i18n-dialog').waitFor({ state: 'visible' });
    await page.locator(".i18n-choice[data-language='en']").click();
    await page.locator('#i18n-save').click();
    await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#qc-close').click();
    await page.locator('#btn-demo').click();
    await page.locator('#tab-camera').click();

    const opened = app.waitForEvent('window', { timeout: 20000 });
    await page.locator('#btn-camera-popout').click();
    const child = await opened;
    child.on('pageerror', error => errors.push('window: ' + error.message));
    assert.equal(child.url(), 'airiz://app/camera-view.html');
    await child.waitForFunction(() => document.getElementById('cv-video').videoWidth > 0, null, { timeout: 20000 });
    assert.equal(await child.evaluate(() => window.AirizCameraView.source === 'console'
      && window.AirizCameraView.stream === window.opener.AirizConsole.getCameraStream()), true);
    console.log('PASS: the camera window opens inside the app and shows the console\'s own live camera');

    const info = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({
      title: win.getTitle(), url: win.webContents.getURL(), prefs: win.webContents.getLastWebPreferences(),
      size: win.getSize()
    })));
    const camera = info.find(win => win.url.endsWith('/camera-view.html'));
    assert.ok(camera, 'camera window found');
    assert.equal(camera.prefs.sandbox, true);
    assert.equal(camera.prefs.contextIsolation, true);
    assert.equal(camera.prefs.nodeIntegration, false);
    console.log('PASS: the camera window is sandboxed (' + camera.size.join('x') + ', "' + camera.title + '")');

    const nested = await child.evaluate(() => window.open('https://example.com/', '_blank') === null);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(nested, true);
    assert.equal(after, 2);
    await child.evaluate(() => { location.href = 'https://example.com/'; });
    await child.waitForTimeout(800);
    assert.equal(child.url(), 'airiz://app/camera-view.html');
    console.log('PASS: the camera window cannot open more windows or navigate away from the app');

    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await page.locator('#btn-camera-popout').click();
    await page.waitForTimeout(800);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), before);
    console.log('PASS: clicking again reuses the same window');

    const blocked = await page.evaluate(() => window.open('airiz://app/index.html', '_blank') === null);
    assert.equal(blocked, true);
    console.log('PASS: any other app page is still refused as a new window');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
