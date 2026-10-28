'use strict';
/*
 * Packaged-app check of "Share control" -> "Connect by code".
 * PC side = the packaged Windows app (demo device); phone side = a mobile Chromium page on the
 * public console. Also the reverse: the packaged app joining a browser PC by code.
 * Usage: node tests/remote-code-check.cjs [--lang zh-TW]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron, chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const exe = path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const PUBLIC_URL = process.env.AIRIZ_URL || 'https://juw12.github.io/projects/airiz-motor/index.html';
const language = (process.argv.indexOf('--lang') > 0 && process.argv[process.argv.indexOf('--lang') + 1]) || 'en';
const settings = JSON.stringify({ language, region: 'ID' });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function stamp(text) {
  console.log(new Date().toISOString().slice(11, 19) + ' ' + text);
}

async function closeDialogs(page) {
  // 1.7.0+: the Remote-by-code launcher opens at every start (only on consoles that have it).
  const hasLauncher = await page.evaluate(() => !!document.getElementById('qc-open'));
  if (hasLauncher) {
    await page.waitForFunction(() => document.getElementById('qc-dialog')?.open === true, null, { timeout: 5000 }).catch(() => {});
  }
  await page.evaluate(() => {
    for (const id of ['install-gate', 'i18n-dialog', 'qc-dialog']) {
      const dialog = document.getElementById(id);
      if (dialog && dialog.open) dialog.close();
    }
  });
}

async function closeDesktop(desktop) {
  // Disconnect first: closing while connected shows the (intended) 'Finish the device session' warning.
  await desktop.page.evaluate(() => {
    const button = document.getElementById('btn-disconnect');
    if (button && !button.disabled) button.click();
  }).catch(() => {});
  await desktop.page.waitForTimeout(800);
  await desktop.app.close();
}

async function launchDesktop() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-remote-'));
  const app = await _electron.launch({ executablePath: exe, args: ['--user-data-dir=' + profile] });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.AirizConsole && window.AirizI18n);
  await page.evaluate(value => {
    localStorage.setItem('airiz.i18n.v1', value);
  }, settings);
  await page.reload();
  await page.waitForFunction(() => window.AirizConsole && window.AirizI18n);
  await closeDialogs(page);
  return { app, page };
}

async function launchPhone(browser) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  await context.addInitScript(value => localStorage.setItem('airiz.i18n.v1', value), settings);
  const page = await context.newPage();
  await page.goto(PUBLIC_URL);
  await page.waitForFunction(() => window.AirizConsole);
  await closeDialogs(page);
  return page;
}

async function shareFrom(pc) {
  await pc.click('#btn-demo');
  await pc.waitForTimeout(1200);
  await pc.click('#btn-share-control');
  await pc.click('#share-control-start');
  for (let index = 0; index < 40; index += 1) {
    const code = (await pc.locator('#share-control-code').innerText().catch(() => '')).trim();
    if (/^\d{6}$/.test(code)) return code;
    await pc.waitForTimeout(500);
  }
  throw new Error('No code on PC; status: ' + await pc.locator('#share-control-status').innerText());
}

async function joinAndApprove(pc, controller, code, label) {
  await controller.click('#btn-connect-code');
  await controller.fill('#connect-code-input', code);
  await controller.click('#connect-code-go');
  let allowed = false;
  for (let second = 1; second <= 45; second += 1) {
    await controller.waitForTimeout(1000);
    const allow = pc.locator('#share-control-list button.btn-primary');
    if (!allowed && await allow.count()) {
      await allow.first().click();
      allowed = true;
      stamp(label + ': PC allowed after ' + second + ' s');
    }
    const status = await controller.evaluate(() => AirizConsole.getStatus());
    const text = await controller.locator('#connect-code-status').innerText().catch(() => '');
    if (second % 5 === 0 || status.connected) stamp(label + ': t+' + second + ' s ' + JSON.stringify(text) + ' connected=' + status.connected);
    if (status.connected && status.deviceFirmware) return { ok: true, allowed, text, status };
  }
  return {
    ok: false, allowed,
    text: await controller.locator('#connect-code-status').innerText().catch(() => ''),
    pcStatus: await pc.locator('#share-control-status').innerText().catch(() => ''),
  };
}

(async () => {
  const results = {};
  const browser = await chromium.launch({ executablePath: edge, headless: true });

  // 1. Desktop app shares, phone browser joins.
  let desktop = await launchDesktop();
  const errors = [];
  desktop.page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) errors.push('desktop ' + message.type() + ': ' + message.text());
  });
  const code = await shareFrom(desktop.page);
  stamp('desktop share code ' + code);
  const phone = await launchPhone(browser);
  phone.on('console', message => {
    if (['error', 'warning'].includes(message.type())) errors.push('phone ' + message.type() + ': ' + message.text());
  });
  results.desktopHostsPhone = await joinAndApprove(desktop.page, phone, code, 'desktop->phone');
  await desktop.page.screenshot({ path: path.join(root, 'dist', 'remote-desktop-host.png') });
  await desktop.app.close();

  // 2. Browser PC shares, desktop app joins.
  const browserPcContext = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await browserPcContext.addInitScript(value => localStorage.setItem('airiz.i18n.v1', value), settings);
  const browserPc = await browserPcContext.newPage();
  await browserPc.goto(PUBLIC_URL);
  await browserPc.waitForFunction(() => window.AirizConsole);
  await closeDialogs(browserPc);
  const code2 = await shareFrom(browserPc);
  stamp('browser share code ' + code2);
  desktop = await launchDesktop();
  desktop.page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) errors.push('desktop-ctl ' + message.type() + ': ' + message.text());
  });
  results.browserHostsDesktop = await joinAndApprove(browserPc, desktop.page, code2, 'browser->desktop');
  await desktop.page.screenshot({ path: path.join(root, 'dist', 'remote-desktop-controller.png') });
  await closeDesktop(desktop);
  await browser.close();
  results.errors = errors.slice(0, 30);
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.desktopHostsPhone.ok && results.browserHostsDesktop.ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(2);
});
