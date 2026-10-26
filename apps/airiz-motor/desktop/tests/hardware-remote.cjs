'use strict';

// Hardware-in-the-loop check of the Phone remote with a real AIRIZ device.
// Usage: AIRIZ_PORT=COM4 node tests/hardware-remote.cjs
// 1. USB: connect, Phone remote -> Start remote, read the PIN, Stop motor.
// 2. Bluetooth (same web code as the website / Bluefy): connect AIRIZ-BT,
//    enter the PIN, run LED + version commands, Stop motor, disconnect.
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
    assert.equal(await page.locator('#btn-connect-ble').isVisible(), false, 'desktop hides the website Bluetooth button');

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

    await page.locator('#btn-phone-remote').click();
    await page.locator('#phone-remote-dialog').waitFor({ state: 'visible' });
    await page.locator('#phone-remote-start').click();
    await page.waitForFunction(() => {
      const pin = document.getElementById('phone-remote-pin');
      const status = document.getElementById('phone-remote-status').textContent;
      return (pin && !pin.hidden) || /did not start|failed|missing/i.test(status);
    }, null, { timeout: 180000 });
    const pin = (await page.locator('#phone-remote-pin-value').innerText()).trim();
    assert.match(pin, /^\d{6}$/, await page.locator('#phone-remote-status').innerText());
    pass('Phone remote installed/started over USB and showed a PIN', await page.locator('#phone-remote-status').innerText());
    await page.locator('#phone-remote-close').click();

    await page.locator('#btn-stop-motor').click();
    assert.match((await lastCommands(page, 1))[0], /soc:motor\/status/);
    pass('Stop motor over USB sends the driver stop');
    await page.locator('#btn-disconnect').click();
    await page.waitForFunction(() => !AirizConsole.getStatus().connected);

    // ---- Bluetooth through the shared web code
    await page.evaluate(() => {
      window.airizDesktop.onBluetoothDevices(devices => {
        const device = devices.find(item => /AIRIZ/i.test(item.name) || /88:88:88:88:88:88/i.test(item.id));
        if (device) window.airizDesktop.chooseBluetoothDevice(device.id);
      });
      const button = document.createElement('button');
      button.id = 'test-ble-connect';
      button.textContent = 'test';
      button.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
      button.addEventListener('click', () => {
        window.__ble = { state: 'running' };
        AirizBle.requestWebBluetoothPort(lost => window.dispatchEvent(new CustomEvent('airiz-port-lost', { detail: lost })))
          .then(port => AirizConsole.connectPort(port).then(() => { window.__ble = { state: 'ok', bridge: port.bridge, fw: port.firmwareVersion }; }))
          .catch(error => { window.__ble = { state: 'error', message: error.message }; });
      });
      document.body.append(button);
    });
    await page.locator('#test-ble-connect').click();
    await page.locator('#airiz-pin-dialog').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#airiz-pin-input').fill('000000');
    await page.locator('#airiz-pin-ok').click();
    await page.waitForFunction(() => /Wrong PIN/.test(document.getElementById('airiz-pin-message')?.textContent || '')
      && document.getElementById('airiz-pin-dialog').open, null, { timeout: 20000 });
    pass('Wrong PIN is rejected and asked again');
    await page.locator('#airiz-pin-input').fill(pin);
    await page.locator('#airiz-pin-ok').click();
    await page.waitForFunction(() => window.__ble && window.__ble.state !== 'running', null, { timeout: 30000 });
    const ble = await page.evaluate(() => window.__ble);
    assert.equal(ble.state, 'ok', ble.message);
    assert.equal(ble.bridge, true);
    pass('Bluetooth connected and unlocked with the PIN', 'firmware ' + ble.fw);

    for (const command of ['diag spotled on', 'diag spotled off', 'diag ver sw']) {
      await page.evaluate(text => AirizConsole.sendCommand(text), command);
      await page.waitForTimeout(2500);
    }
    const consoleText = await page.locator('#console-output').innerText();
    assert.match(consoleText.replace(/\s+/g, ''), /#INFO#0:0\.0\.0\.3#END##AUTH#ok#END#/);
    pass('LED and version commands answered over Bluetooth');

    await page.locator('#btn-stop-motor').click();
    await page.waitForTimeout(800);
    const recent = await lastCommands(page, 4);
    const tail = (await page.locator('#console-output').innerText()).slice(-400);
    assert.ok(recent.some(text => /(^|\s|>)stop\s*$/.test(text)), JSON.stringify({ recent, tail }));
    await page.waitForTimeout(2000);
    pass('Stop motor over Bluetooth uses the bridge stop command');
    await page.locator('#btn-disconnect').click();
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
