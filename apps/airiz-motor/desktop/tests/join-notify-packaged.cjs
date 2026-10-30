'use strict';

// 1.11.15: in the packaged Windows app, "asks to join" notifications are allowed and clicking one
// brings a minimized console back to the front (airizDesktop.showWindow -> airiz:show-window).
const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const profile = path.join(root, '.test-data', 'join-notify');

(async () => {
  fs.rmSync(profile, { recursive: true, force: true });
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--airiz-data-dir=' + profile],
    timeout: 60000,
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.airizDesktop && !!window.AirizRemoteControl, null, { timeout: 30000 });

    assert.equal(await page.evaluate(() => typeof window.airizDesktop.showWindow), 'function', 'showWindow bridge');
    assert.equal(await page.evaluate(() => Notification.permission), 'granted', 'notifications allowed');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await page.waitForTimeout(800);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true, 'minimized');

    const shown = await page.evaluate(() => window.airizDesktop.showWindow());
    assert.equal(shown, true, 'showWindow returns true');
    await page.waitForTimeout(800);
    const state = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { minimized: win.isMinimized(), visible: win.isVisible() };
    });
    assert.deepEqual(state, { minimized: false, visible: true }, 'restored and visible');

    // The real notification path in the packaged app (Windows shows it; here we only check it is created).
    const created = await page.evaluate(() => {
      try {
        const note = new Notification('Test phone asks to join the AIRIZ', { body: 'packaged check', requireInteraction: true, silent: true });
        note.close();
        return true;
      } catch (error) {
        return String(error);
      }
    });
    assert.equal(created, true, 'Notification can be created');
    console.log(JSON.stringify({ result: 'passed', showWindow: true, notifications: 'granted', restored: state }));
  } finally {
    await app.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
