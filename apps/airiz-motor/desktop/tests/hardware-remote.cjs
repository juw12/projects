'use strict';

// Hardware-in-the-loop check with a real AIRIZ device.
// Usage: AIRIZ_PORT=COM4 node tests/hardware-remote.cjs
// USB: connect, Stop motor, disconnect. (1.11.18: the Bluetooth phone remote was removed;
// phones use Remote by code, covered by remote-code-check.cjs.)
const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const profile = path.join(root, '.test-data', 'hardware-remote');
const report = path.join(root, '.test-data', 'hardware-remote-results.json');
const portName = process.env.AIRIZ_PORT || 'COM4';
const results = [];
const pass = (name, detail) => {
  results.push({ name, detail: detail || null });
  console.log('PASS: ' + name + (detail ? ' — ' + detail : ''));
};

async function lastCommands(page, count) {
  return page.$$eval('#console-output .command', nodes => nodes.map(node => node.innerText)).then(list => list.slice(-count));
}

(async () => {
  fs.rmSync(profile, { recursive: true, force: true });
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--airiz-data-dir=' + profile],
    timeout: 60000,
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') }
  });
  // Auto-confirm native dialogs (e.g. "close while connected") so the run cannot hang.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  try {
    const page = await app.firstWindow();
    app.process().stdout?.on('data', data => process.stdout.write('[app] ' + data));
    app.process().stderr?.on('data', data => process.stdout.write('[app-err] ' + data));
    page.on('close', () => console.log('[page closed]'));
    page.on('crash', () => console.log('[page crashed]'));
    page.on('console', message => { if (message.type() === 'error') console.log('[console] ' + message.text()); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.AirizConsole && window.AirizBle);
    assert.equal(await page.locator('#btn-connect-ble').count(), 0, 'Bluetooth connect removed (1.11.18)');

    // ---- USB
    await page.locator('#btn-connect').click();
    await page.locator('#native-serial-dialog').waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);
    console.log('Ports offered: ' + JSON.stringify(await page.$$eval('[data-port-id]', nodes => nodes.map(node => node.innerText.replace(/\s+/g, ' ')))));
    const choice = page.locator('[data-port-id]', { hasText: portName }).first();
    await choice.waitFor({ timeout: 15000 });
    await choice.click();
    try {
      await page.waitForFunction(() => AirizConsole.getStatus().connected, null, { timeout: 15000 });
    } catch (error) {
      console.log('Console: ' + (await page.locator('#console-output').innerText()).slice(-1500));
      throw error;
    }
    pass('USB serial connected', portName);


    await page.locator('#btn-stop-motor').click();
    assert.match((await lastCommands(page, 1))[0], /soc:motor\/status/);
    pass('Stop motor over USB sends the driver stop');
    await page.locator('#btn-disconnect').click();
    await page.waitForFunction(() => !AirizConsole.getStatus().connected);

    assert.deepEqual(errors, []);
    pass('No page errors');
  } finally {
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
    await app.close().catch(() => {});
  }
})().catch(error => {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
});
