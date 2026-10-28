'use strict';
// Packaged-app check for the Ziris PTB team page, guide and the desktop Teams post bridge.
// Posts only to a non-existent workflow id, so nothing reaches any real Teams chat.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const executable = path.join(__dirname, '..', 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const FAKE_WORKFLOW = 'https://prod-00.westus.logic.azure.com:443/workflows/00000000000000000000000000000000/'
  + 'triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=invalid';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-teams-check-'));
  const app = await _electron.launch({ executablePath: executable, args: ['--airiz-data-dir=' + profile] });
  const results = [];
  const check = (ok, label) => {
    results.push(ok);
    console.log((ok ? 'PASS ' : 'FAIL ') + label);
  };
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#tab-team', { timeout: 30000 });
    const version = await page.evaluate(() => window.airizDesktop.getAppInfo().then(info => info.version));
    check(version === '1.4.0', 'packaged app reports version ' + version);
    check(await page.evaluate(() => typeof window.airizDesktop.postToTeams === 'function'), 'desktop Teams bridge exposed');
    const rejected = await page.evaluate(() => window.airizDesktop.postToTeams('https://example.com/hook', '{}'));
    check(rejected.ok === false && /Invalid/.test(rejected.error), 'bridge refuses non-Teams hosts');
    const notJson = await page.evaluate(url => window.airizDesktop.postToTeams(url, 'not json'), FAKE_WORKFLOW);
    check(notJson.ok === false && /JSON/.test(notJson.error), 'bridge refuses non-JSON bodies');
    const reached = await page.evaluate(url => window.airizDesktop.postToTeams(url, JSON.stringify({ type: 'message' })), FAKE_WORKFLOW);
    console.log('  fake workflow answer:', JSON.stringify(reached));
    check(reached.ok === false && (reached.status >= 400 || /connection|time/.test(reached.error || '')),
      'main process reaches Power Automate (fake workflow correctly rejected)');
    await page.click('#tab-team');
    check(await page.isVisible('#view-team'), 'Ziris PTB team page opens in the desktop app');
    check((await page.textContent('#sidebar-owner strong')).trim() === 'Juwen Lie', 'owner Juwen Lie in sidebar');
    await page.click('#tab-guide');
    check((await page.locator('.guide-timeline li').count()) >= 6, 'guide & history page in the desktop app');
  } finally {
    await app.close();
  }
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' packaged Teams checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
