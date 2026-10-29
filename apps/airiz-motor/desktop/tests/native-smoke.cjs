'use strict';

const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const profile = process.env.AIRIZ_TEST_PROFILE || path.join(root, '.test-data', 'packaged-smoke');
const reportFile = process.env.AIRIZ_TEST_REPORT || path.join(root, '.test-data', 'native-smoke-results.json');
const checks = [];
let bluetoothDevicesListed = 0;
let runningApp = null;

async function launch() {
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--airiz-data-dir=' + profile, '--use-fake-device-for-media-stream'],
    timeout: 60000,
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') }
  });
  runningApp = app;
  await app.evaluate(({ dialog }) => {
    globalThis.__dialogs = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__dialogs.push(options);
      return { response: options.title === 'AIRIZ device media access' ? 1 : 0 };
    };
  });
  return app;
}

async function record(name) {
  checks.push(name);
  console.log('PASS: ' + name);
}

(async () => {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  let app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.airizDesktop && window.AirizConsole);
  assert.equal(page.url(), 'airiz://app/');
  const info = await page.evaluate(() => window.airizDesktop.getAppInfo());
  assert.equal(info.packaged, true);
  assert.equal(info.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  assert.equal(await page.locator('#desktop-download-banner').isVisible(), false);
  assert.equal(await page.locator('#btn-install-app').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, serial: !!navigator.serial, node: typeof require })), {
    secure: true, serial: true, node: 'undefined'
  });
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  await record('Actual packaged Windows process loads bundled local UI with secure origin and sandboxed renderer');

  // 1.5.0: a fresh profile must ask for language & region before the console can be used.
  await page.locator('#i18n-dialog').waitFor({ state: 'visible' });
  await page.locator(".i18n-choice[data-language='en']").click();
  await page.locator('#i18n-save').click();
  await page.locator('#i18n-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.AirizI18n.language()), 'en');
  await record('First start asks for language & region; English chosen and saved');

  // 1.7.0: right after the language box, the one-button Remote-by-code launcher opens.
  await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('#qc-open').isVisible(), true);
  assert.equal(await page.locator('#qc-code').isVisible(), true);
  assert.equal(await page.locator('#qc-share').isVisible(), true);
  await page.locator('#qc-close').click();
  await page.locator('#qc-dialog').waitFor({ state: 'hidden' });
  await record('Start screen offers the one-button Remote by code launcher (join by code + share motor and camera); header button stays visible');

  await page.locator('#btn-connect').click();
  await page.locator('#native-serial-dialog').waitFor({ state: 'visible' });
  await page.locator('#native-serial-cancel').click();
  await page.locator('#native-serial-dialog').waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => AirizConsole.getStatus())).connected, false);
  await app.evaluate(({ session, BrowserWindow }) => {
    globalThis.__chosenPort = null;
    session.defaultSession.emit('select-serial-port', { preventDefault() {} }, [
      { portId: 'smoke-fake-port', portName: 'TEST ONLY', displayName: 'Synthetic selector check' }
    ], BrowserWindow.getAllWindows()[0].webContents, selected => {globalThis.__chosenPort = selected;});
  });
  await page.locator('#native-serial-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => airizDesktop.chooseSerialPort('not-a-real-id')), false);
  await page.locator('[data-port-id="smoke-fake-port"]').click();
  assert.equal(await app.evaluate(() => globalThis.__chosenPort), 'smoke-fake-port');
  await record('Native serial chooser opens and cancels; synthetic selection works without opening physical hardware');

  assert.equal(await page.locator('#btn-connect-ble').isVisible(), true);
  await page.locator('#btn-connect-ble').click();
  await page.locator('#bluetooth-picker-dialog').waitFor({ state: 'visible' });
  await page.waitForTimeout(3000);
  const airizListed = await page.locator('#bluetooth-picker-list [data-bluetooth-id]').count();
  // A PC without a Bluetooth adapter (the GitHub runner) ends the request by itself and
  // closes the picker before Cancel can be pressed.
  if (await page.locator('#bluetooth-picker-dialog').isVisible()) {
    await page.locator('#bluetooth-picker-cancel').click();
  }
  await page.locator('#bluetooth-picker-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('btn-connect-ble').disabled, null, { timeout: 60000 });
  assert.equal((await page.evaluate(() => AirizConsole.getStatus())).connected, false);
  await record('Connect Bluetooth opens the in-app device picker (' + airizListed + ' AIRIZ device(s) in range) and cancels without connecting');

  await page.locator('#btn-demo').click();
  for (const direction of ['pan-fwd', 'rising-fwd', 'pan-rev', 'rising-rev']) {
    await page.locator('[data-jog="' + direction + '"]').click();
    await page.waitForTimeout(450);
  }
  assert.equal(await page.locator('#console-output .command').count(), 4);
  assert.equal(await page.locator('#keyboard-toggle').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#console-output .command').count(), 5);
  await page.keyboard.press('Escape');
  await page.locator('#btn-bluetooth-on').click();
  assert.match(await page.locator('#console-output .command').last().innerText(), /diag ble on/);
  await page.locator('#btn-app-updates').click();
  assert.equal(await page.locator('#desktop-updates-dialog').isVisible(), true);
  await page.locator('#desktop-update-close').click();
  await record('Native auto-ready jog/keyboard, Bluetooth initialization and update panel work');

  assert.equal(await page.locator('#btn-bluetooth-check').isVisible(), true);
  await page.locator('#btn-bluetooth-check').click();
  await page.locator('#bluetooth-check-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('bt-step-2').dataset.state !== 'wait', { timeout: 15000 });
  let devicesListed = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    devicesListed = await page.locator('#bluetooth-device-list [data-bluetooth-id]').count();
    const finished = await page.locator('#bluetooth-check-result').innerText();
    if (devicesListed > 0 || finished) break;
    await page.waitForTimeout(500);
  }
  if (!(await page.locator('#bluetooth-check-result').innerText())) await page.locator('#bluetooth-check-cancel').click();
  await page.waitForFunction(() => document.getElementById('bluetooth-check-result').dataset.result, { timeout: 15000 });
  assert.equal(await page.locator('#bluetooth-check-result').getAttribute('data-result'), 'not-selected');
  assert.equal(await page.locator('#bt-step-1').getAttribute('data-state'), 'skip');
  await page.locator('#bluetooth-check-close').click();
  bluetoothDevicesListed = devicesListed;
  await record('Bluetooth check runs inside the app (demo: radio step skipped), lists ' + devicesListed + ' nearby devices and cancels without pairing');

  const prepared = await page.evaluate(() => window.AirizConsole.prepareForUpdate());
  assert.deepEqual(prepared, { ready: true, reconnect: null });
  assert.equal(await page.evaluate(() => window.AirizConsole.getStatus().connected), false);
  await page.evaluate(() => window.AirizConsole.cancelPreparedUpdate());
  await page.locator('#btn-demo').click();
  await record('Update preparation closes the active session itself instead of requiring a manual disconnect');

  for (const view of ['console', 'camera', 'team', 'guide', 'controller']) {
    await page.locator('#tab-' + view).click();
    assert.equal(await page.locator('#view-' + view).isVisible(), true);
  }
  assert.equal(await page.locator('#tab-sfx, #view-sfx, .sfx-card').count(), 0);
  await page.locator('#tab-camera').click();
  await page.locator('#camera-mode-select').selectOption('auto');
  await page.locator('#btn-camera-start').click();
  await page.waitForFunction(() => document.getElementById('camera-preview').readyState >= 2, { timeout: 15000 });
  await page.locator('#btn-camera-stop').click();
  await record('Camera preview works with synthetic device; all workspaces load and the removed Sound FX tab is gone');

  // 1.10.0: Talk & listen in the packaged app with the demo AIRIZ (no microphone or hardware, muted).
  await page.locator('#tab-controller').click();
  await page.waitForFunction(() => window.AirizVoice && window.AirizVoice.state.mode === 'demo', null, { timeout: 15000 });
  await page.evaluate(() => {
    window.AirizVoiceDemoSpeed = 8;
    for (const [id, value, type] of [['voice-speaker', '0', 'change'], ['voice-volume', '0', 'input']]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event(type));
    }
    const rate = 48000;
    const tone = new Float32Array(rate);
    for (let i = 0; i < tone.length; i++) {
      tone[i] = 0.2 * Math.sin(2 * Math.PI * 300 * i / rate) * Math.sin(Math.PI * i / tone.length);
    }
    window.AirizVoice.send(window.AirizVoice.buildMessage(tone, rate));
  });
  await page.waitForFunction(() => document.getElementById('voice-status').textContent === 'Played on the AIRIZ.', null, { timeout: 30000 });
  // A PC without any sound device (CI runner) cannot create an audio output; Listen needs one.
  const audioOutput = await page.evaluate(() => {
    try {
      const probe = new (window.AudioContext || window.webkitAudioContext)();
      probe.close();
      return true;
    } catch (error) {
      return false;
    }
  });
  if (audioOutput) {
    await page.locator('#voice-listen').click();
    await page.waitForFunction(() => window.AirizVoice.state.frames.framesPlayed > 5, null, { timeout: 30000 });
    await page.locator('#voice-listen').click();
    await page.waitForFunction(() => window.AirizVoice.state.listen === 'off' && !window.AirizVoice.state.listening, null, { timeout: 15000 });
  }
  await record('Talk & listen works with the demo AIRIZ: a message plays' + (audioOutput ? ' and Listen plays the demo microphone' : ' (no sound device: Listen skipped)'));

  await page.locator('#tab-controller').click();
  const logPath = path.join(profile, 'native-export-check.txt');
  await app.evaluate(({ session }, destination) => {
    globalThis.__exportState = null;
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      item.once('done', (_done, state) => {globalThis.__exportState = state;});
    });
  }, logPath);
  await page.locator('#btn-save-log').click();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await app.evaluate(() => globalThis.__exportState === 'completed')) break;
    await page.waitForTimeout(200);
  }
  assert.equal(await app.evaluate(() => globalThis.__exportState), 'completed');
  assert.match(fs.readFileSync(logPath, 'utf8'), /diag motor pan forward/);
  await record('Native log export writes a real file to the explicitly selected test directory');
  await page.locator('#btn-disconnect').click();
  await page.locator('#theme-toggle').click();
  await page.evaluate(() => {
    localStorage.setItem('airiz.macros.v1', JSON.stringify([
      { id: 'native-persistence', name: 'Native persistence check', desc: 'test', params: [], steps: [] }
    ]));
  });
  await app.close();
  fs.writeFileSync(path.join(profile, 'pending-reconnect.json'), JSON.stringify({
    baudRate: 115200, usbVendorId: 4660, usbProductId: 22136, expiresAt: Date.now() + 600000
  }));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.AirizI18n);
  assert.equal(await page.evaluate(() => document.getElementById('i18n-dialog')?.open === true), false);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.AirizConsole);
  await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#qc-close').click();
  await record('Remote by code launcher opens again on the next app start');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('#tab-console').click();
  assert.match(await page.locator('#macro-select').innerText(), /Native persistence check/);
  await page.context().route('https://**/*', route => route.abort());
  await page.context().route('http://**/*', route => route.abort());
  await page.reload();
  await page.waitForFunction(() => window.AirizConsole);
  await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#qc-close').click();
  await page.locator('#btn-demo').click();
  await page.locator('[data-jog="pan-fwd"]').click();
  assert.match(await page.locator('#console-output').innerText(), /diag motor pan forward 2 1/);
  await record('Saved macros and theme survive a full app restart; bundled UI and demo reload with HTTP/HTTPS blocked');
  assert.equal(fs.existsSync(path.join(profile, 'pending-reconnect.json')), false);
  await record('Post-update reconnect request is consumed once on restart (no matching test device, so it falls back safely)');

  await page.locator('#btn-disconnect').click();
  await page.evaluate(() => {
    window.__originalApi = window.AirizConsole;
    window.AirizConsole = { getStatus: () => ({ connected: true, demoMode: false }) };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(500);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await app.evaluate(() => globalThis.__dialogs.at(-1).title), 'Finish the device session before closing');
  await page.evaluate(() => { window.AirizConsole = window.__originalApi; });
  await record('Active-device close warning defaults to keeping the app open; it never claims to stop a motor');

  await page.locator('#theme-toggle').click();
  await page.locator('#theme-toggle').click();
  await page.locator('#btn-demo').click();
  await page.locator('[data-jog="pan-fwd"]').click();
  await page.waitForTimeout(4700);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.AIRIZ_SCREENSHOT) await page.screenshot({ path: process.env.AIRIZ_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  await app.close();
  const report = {
    result: 'passed', packaged: true, version: info.version, checks,
    bluetoothDevicesListed, javascriptErrors: errors, physicalHardwareExercised: false,
    installerWizardExecuted: false
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(async error => {
  console.error(error);
  if (runningApp) {
    await runningApp.evaluate(({ app }) => app.exit(1)).catch(() => {});
    await runningApp.close().catch(() => {});
  }
  process.exitCode = 1;
});
