'use strict';
// Optional network integration check. Downloads an existing official installer;
// it NEVER executes an installer or changes the user's installed application.
const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const oldInstaller = process.env.AIRIZ_UPDATE_FIXTURE;
const profile = path.join(root, '.test-data', 'updater-download');
let application;
let server;

(async () => {
  assert(oldInstaller, 'Set AIRIZ_UPDATE_FIXTURE to the previously published 1.0.0 installer.');
  const sha512 = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(oldInstaller)) sha512.update(chunk);
  const file = {
    url: 'https://github.com/juw12/projects/releases/download/airiz-desktop-v1.0.0/AIRIZ-Console-Setup-1.0.0-x64.exe',
    sha512: sha512.digest('base64'), size: fs.statSync(oldInstaller).size
  };
  const feed = { version: '1.0.0', files: [file], path: file.url, sha512: file.sha512, releaseDate: new Date().toISOString() };
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/yaml', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(feed));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  application = await _electron.launch({
    executablePath: path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe'),
    args: ['--airiz-data-dir=' + profile],
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') },
    timeout: 60000
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.airizDesktop && window.AirizConsole);
  await application.evaluate(({ app, dialog }, feedUrl) => {
    const request = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const updater = request('electron-updater').autoUpdater;
    const SemVer = request('semver').SemVer;
    globalThis.__updateInstallCalls = 0;
    globalThis.__updatePrompts = 0;
    updater.quitAndInstall = () => { globalThis.__updateInstallCalls++; };
    dialog.showMessageBox = async () => { globalThis.__updatePrompts++; return { response: 0 }; };
    if (updater.autoInstallOnAppQuit !== false || updater.autoDownload !== false) throw new Error('Automatic installation/download is not disabled.');
    // Debug-only version/feed override; no such setter exists in the renderer bridge.
    updater.currentVersion = new SemVer('0.9.0');
    updater.setFeedURL({ provider: 'generic', url: feedUrl });
  }, 'http://127.0.0.1:' + server.address().port + '/');
  let state = await page.evaluate(() => airizDesktop.checkForUpdates());
  assert.equal(state.status, 'available', state.message);
  state = await page.evaluate(() => airizDesktop.downloadUpdate());
  assert.equal(state.status, 'downloaded', state.message);
  await application.evaluate(({ dialog }) => {
    globalThis.__updatePromptTitles = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__updatePrompts++;
      globalThis.__updatePromptTitles.push(options.title);
      return { response: 0 };
    };
  });
  await page.evaluate(() => {
    window.__savedApi = AirizConsole;
    window.AirizConsole = { ...window.__savedApi, getStatus: () => ({ connected: true, demoMode: false }) };
  });
  state = await page.evaluate(() => airizDesktop.installUpdate());
  assert.equal(await application.evaluate(() => globalThis.__updatePromptTitles.at(-1)), 'Install AIRIZ update?');
  assert.equal(state.status, 'downloaded');
  await page.evaluate(() => {
    window.AirizConsole = { ...window.__savedApi, getStatus: () => ({ connected: true, demoMode: false, macroRunning: true }) };
  });
  state = await page.evaluate(() => airizDesktop.installUpdate());
  assert.equal(await application.evaluate(() => globalThis.__updatePromptTitles.at(-1)), 'Install AIRIZ update when finished?');
  assert.equal(state.status, 'downloaded');
  await page.evaluate(() => { window.AirizConsole = window.__savedApi; });
  assert.equal(await application.evaluate(() => globalThis.__updateInstallCalls), 0);
  const report = {
    result: 'passed',
    checks: [
      'Real electron-updater parsed the feed and detected the published 1.0.0 installer using a simulated 0.9.0 current version.',
      'The actual official executable was downloaded and passed the updater checksum/signature-policy pipeline.',
      'With a device connected, installation is offered directly (no manual disconnect); cancelling did not install or quit.',
      'With a macro running, the app offers to install automatically when it finishes; declining installed nothing.',
      'No installer was executed.'
    ],
    fixture_version: '1.0.0', simulated_current_version: '0.9.0', actual_installer_executed: false
  };
  fs.writeFileSync(process.env.AIRIZ_UPDATE_REPORT || path.join(profile, 'results.json'), JSON.stringify(report, null, 2));
  await application.close();
  server.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async error => {
  console.error(error);
  if (application) {
    await application.evaluate(({ app }) => app.exit(1)).catch(() => {});
    await application.close().catch(() => {});
  }
  if (server) server.close();
  process.exitCode = 1;
});
