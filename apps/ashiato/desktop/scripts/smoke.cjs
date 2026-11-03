// Launches the packaged Ashiato app, waits for the app to render, walks a few screens and saves
// screenshots. Usage: node scripts/smoke.cjs <path-to-executable> <output-dir>
'use strict';
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const [executablePath, outDir = 'dist/smoke'] = process.argv.slice(2);
  if (!executablePath || !fs.existsSync(executablePath)) throw new Error('Executable not found: ' + executablePath);
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ashiato-smoke-'));
  const app = await electron.launch({ executablePath, args: [`--ashiato-data-dir=${profile}`], timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1180, height: 820 }).catch(() => {});
  await page.waitForSelector('body[data-ready]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  // First run shows onboarding; then switch to the sample days and visit the main screens.
  await page.screenshot({ path: path.join(outDir, '01-first-run.png') });
  await page.evaluate(() => {
    localStorage.setItem('diary.sample', '1');
    localStorage.setItem('onboarding.done', '1');
  });
  await page.reload();
  await page.waitForSelector('body[data-ready]', { timeout: 60000 });
  const screens = [
    ['02-today', '#/today'],
    ['03-days', '#/days'],
    ['04-map', '#/map'],
    ['05-memories', '#/memories'],
    ['06-tidy', '#/today?sheet=tidy'],
  ];
  for (const [name, hash] of screens) {
    await page.evaluate((target) => { location.hash = target; }, hash);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  }
  const info = await page.evaluate(() => ({
    platform: document.documentElement.dataset.platform,
    origin: location.origin,
    ready: document.body.hasAttribute('data-ready'),
  }));
  fs.writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify({ info, errors }, null, 2));
  await app.close();
  console.log(JSON.stringify({ info, errors }, null, 2));
  if (!info.ready || info.platform !== 'desktop') throw new Error('App did not start as the desktop build');
  const fatal = errors.filter((text) => !/tile\.openstreetmap|open-meteo|Failed to load resource/i.test(text));
  if (fatal.length) throw new Error('JavaScript errors: ' + fatal.join(' | '));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
