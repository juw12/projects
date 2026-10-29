'use strict';

// 1.11.8: Smart detection in the packaged Windows app - notifications allowed, detection keeps
// working while the window is minimized (worker clock + no background throttling while armed).
const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const profile = path.join(root, '.test-data', 'alerts');

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
    await page.evaluate(() => localStorage.setItem('airiz.ptz.v1', JSON.stringify({ detect: { sensitivity: 100, cooldown: 3 } })));
    await page.reload();
    await page.waitForFunction(() => window.AirizConsole && window.AirizPtz);
    await page.locator('#btn-demo').click();
    await page.waitForFunction(() => AirizConsole.getStatus().connected, null, { timeout: 15000 });
    await page.locator('#tab-camera').click();
    await page.waitForTimeout(2000);
    if (await page.evaluate(() => !document.getElementById('btn-camera-start').disabled)) {
      await page.locator('#btn-camera-start').click();
    }
    await page.waitForFunction(() => document.getElementById('ptz-video').videoWidth > 0, null, { timeout: 20000 });

    assert.equal(await page.evaluate(() => Notification.permission), 'granted');
    console.log('PASS: desktop notifications are allowed in the Windows app');

    const throttled = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling());
    assert.equal(await throttled(), true);
    await page.evaluate(() => document.querySelectorAll('#ptz-card details').forEach(item => { item.open = true; }));
    await page.locator('#ptz-detect-toggle').click();
    await page.waitForTimeout(500);
    assert.equal(await throttled(), false);
    console.log('PASS: arming detection keeps a minimized window working (no background throttling)');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await page.waitForTimeout(1000);
    const hidden = await page.evaluate(() => document.visibilityState);
    const before = await page.evaluate(() => AirizPtz.events.length);
    await page.waitForFunction(count => AirizPtz.events.length > count, before, { timeout: 25000 });
    console.log('PASS: motion is still detected while the window is minimized (visibility: ' + hidden + ')');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await page.locator('#ptz-detect-toggle').click();
    await page.waitForTimeout(500);
    assert.equal(await throttled(), true);
    console.log('PASS: disarming puts normal background throttling back');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
