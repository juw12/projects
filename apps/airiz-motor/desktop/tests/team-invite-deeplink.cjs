'use strict';
// Packaged-app check (1.7.3): the website's "Open in the AIRIZ Windows app" link
// airiz-console://join?team=…&name=… makes the Windows app join Ziris PTB too,
// both when the link starts the app and when the app is already running (second instance).
// Uses a fake workflow id and a temporary profile; nothing is posted and no handler is registered.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright-core');

const executable = path.join(__dirname, '..', 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const FAKE_WORKFLOW = 'https://prod-00.westus.logic.azure.com:443/workflows/00000000000000000000000000000000/'
  + 'triggers/manual/paths/invoke?api-version=2016-06-01&sig=invalid';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const results = [];
  const check = (ok, label) => {
    results.push(!!ok);
    console.log((ok ? 'PASS ' : 'FAIL ') + label);
  };

  // Build a real shared invite with the app's own code (fresh helper profile).
  const helperProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-deeplink-helper-'));
  let app = await _electron.launch({ executablePath: executable, args: ['--airiz-data-dir=' + helperProfile] });
  let page = await app.firstWindow();
  await page.waitForFunction(() => !!window.AirizTeam, null, { timeout: 30000 });
  const pass = await page.evaluate(hook => window.AirizTeam.createPass({ name: '', workflowUrl: hook }), FAKE_WORKFLOW);
  const link = await page.evaluate(([value, name]) => window.AirizTeam.appJoinLink(value, name), [pass, 'Luar Handoyo']);
  await app.close();
  check(link.startsWith('airiz-console://join?team=ZPTB1-') && link.endsWith('&name=Luar%20Handoyo'), 'website builds the hand-off link');

  // 1) The link starts the app.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'airiz-deeplink-'));
  app = await _electron.launch({ executablePath: executable, args: ['--airiz-data-dir=' + profile, link] });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.AirizTeam && window.AirizTeam.member, null, { timeout: 30000 }).catch(() => {});
  const member = await page.evaluate(() => {
    const m = window.AirizTeam.member;
    return m && { name: m.name, role: m.roleLabel };
  });
  check(member && member.name === 'Luar Handoyo' && member.role === 'Co-admin', 'cold start with the link: app joined as ' + JSON.stringify(member));
  check(await page.isVisible('#view-team'), 'Team page opened');
  const status = await page.textContent('#team-status');
  check(/Windows app on this PC joined/.test(status), 'status: ' + status.trim());
  check(await page.evaluate(() => document.getElementById('team-app-handoff').hidden), 'no "Open in app" button inside the app itself');

  // 2) The app is already running: a second launch with a new name hands the invite over and exits.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('airiz.team.v1'));
    localStorage.setItem('airiz.team.v1', JSON.stringify({ ...stored, pass: '', name: '' }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.AirizTeam, null, { timeout: 30000 });
  check(!(await page.evaluate(() => window.AirizTeam.member)), 'left the team before the second-instance test');
  const secondLink = link.replace('Luar%20Handoyo', 'Tian%20Cheng');
  const second = spawn(executable, ['--airiz-data-dir=' + profile, secondLink], { stdio: 'ignore' });
  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('still running'), 20000);
    second.on('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  check(exitCode === 0, 'second instance handed over and exited (' + exitCode + ')');
  let joined = null;
  for (let attempt = 0; attempt < 20 && !joined; attempt += 1) {
    await sleep(500);
    joined = await page.evaluate(() => window.AirizTeam.member && window.AirizTeam.member.name);
  }
  check(joined === 'Tian Cheng', 'running app joined from the second launch as ' + joined);

  // 3) A bad link is ignored.
  await page.evaluate(() => localStorage.setItem('airiz.team.v1', JSON.stringify({ pass: '', name: '' })));
  await page.reload();
  await page.waitForFunction(() => !!window.AirizTeam, null, { timeout: 30000 });
  const bad = spawn(executable, ['--airiz-data-dir=' + profile, 'airiz-console://join?team=ZPTB1-forged&name=Eve'], { stdio: 'ignore' });
  await new Promise(resolve => bad.on('exit', resolve));
  await sleep(1500);
  check(!(await page.evaluate(() => window.AirizTeam.member)), 'forged link ignored');
  await app.close();

  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' invite hand-off checks passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
