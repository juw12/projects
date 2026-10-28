'use strict';

// Exercise the real packaged preload/IPC path without touching the real clipboard or Teams.
const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const executable = process.env.AIRIZ_EXE || path.join(root, 'dist', 'win-unpacked', 'AIRIZ Console.exe');
const out = path.join(root, '.test-data', 'owner-setup');
const profile = path.join(out, 'packaged-profile');
const HOOK = 'https://prod-01.westus.logic.azure.com/workflows/test/triggers/manual/paths/invoke?sig=TEST_ONLY';
const OTHER_HOOK = 'https://prod-01.westus.logic.azure.com/workflows/other/triggers/manual/paths/invoke?sig=TEST_ONLY';
const results = { checks: [], errors: [] };
let runningApp;

function record(name) {
  results.checks.push(name);
  console.log('PASS: ' + name);
}

async function launch() {
  const app = await _electron.launch({
    executablePath: executable,
    args: ['--airiz-data-dir=' + profile],
    timeout: 60000,
    env: { ...process.env, LOCALAPPDATA: path.join(profile, 'update-cache') }
  });
  runningApp = app;
  await app.evaluate(({ net, clipboard }) => {
    globalThis.__ownerTest = { clipboard: '', reads: 0, posts: [], status: 202 };
    clipboard.readText = () => {
      globalThis.__ownerTest.reads += 1;
      return globalThis.__ownerTest.clipboard;
    };
    const originalFetch = net.fetch.bind(net);
    net.fetch = async (url, options) => {
      if (String(url).includes('/workflows/')) {
        const state = globalThis.__ownerTest;
        state.posts.push({ url: String(url), body: JSON.parse(options.body), redirect: options.redirect });
        return { ok: state.status >= 200 && state.status < 300, status: state.status };
      }
      return originalFetch(url, options);
    };
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => results.errors.push(error.message));
  const isolateClipboardWrite = () => {
    window.__ownerCopies = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__ownerCopies.push(text); },
        readText: async () => { throw new Error('Use the desktop URL-filtered bridge'); }
      }
    });
  };
  await page.addInitScript(isolateClipboardWrite);
  await page.evaluate(isolateClipboardWrite);
  await page.waitForFunction(() => window.airizDesktop && window.AirizTeam);
  if (await page.evaluate(() => !localStorage.getItem('airiz.i18n.v1'))) {
    await page.locator('#i18n-dialog').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.i18n-choice[data-language="en"]').click();
    await page.locator('#i18n-save').click();
  }
  await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#qc-close').click();
  await page.locator('#tab-team').click();
  return { app, page };
}

async function settled(page, state) {
  await page.waitForFunction(expected => {
    return document.getElementById('team-owner-card').getAttribute('aria-busy') === 'false'
      && document.getElementById('team-owner-status').dataset.state === expected;
  }, state);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  try {
    let { app, page } = await launch();
    results.info = await page.evaluate(() => airizDesktop.getAppInfo());
    assert.equal(results.info.packaged, true);
    assert.equal(results.info.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => typeof airizDesktop.readTeamsWorkflowClipboard), 'function');
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.reads), 0);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.posts.length), 0);
    record('Packaged sandboxed app exposes the narrow clipboard bridge and startup is silent');

    await app.evaluate(() => { globalThis.__ownerTest.clipboard = 'UNRELATED_PRIVATE_CLIPBOARD'; });
    const unrelated = await page.evaluate(() => airizDesktop.readTeamsWorkflowClipboard());
    assert.deepEqual(unrelated, { ok: false });
    assert.ok(!JSON.stringify(unrelated).includes('UNRELATED_PRIVATE_CLIPBOARD'));
    const rejected = await page.evaluate(() => airizDesktop.postToTeams('https://example.com/hook', '{}'));
    assert.equal(rejected.ok, false);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.posts.length), 0);
    record('Native bridge does not reveal unrelated clipboard text and refuses non-Teams destinations');

    await app.evaluate((_electron, hook) => { globalThis.__ownerTest.clipboard = hook; }, HOOK);
    const filtered = await page.evaluate(() => airizDesktop.readTeamsWorkflowClipboard());
    assert.equal(filtered.workflowUrl, HOOK);
    await page.locator('#team-owner-setup').click();
    await settled(page, 'ok');
    assert.equal(await page.evaluate(() => AirizTeam.member.role), 'owner');
    assert.equal(await page.locator('#team-auto-post').isChecked(), true);
    assert.equal(await page.locator('#team-owner-url').getAttribute('type'), 'password');
    assert.equal(await page.locator('#team-owner-setup').isDisabled(), true);
    const posts = await app.evaluate(() => globalThis.__ownerTest.posts);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].redirect, 'error');
    const invite = posts[0].body.attachments[0].content.actions[0].url;
    assert.equal(await page.evaluate(link => AirizTeam.readPass(link).role, invite), 'coadmin');
    assert.equal(await page.evaluate(() => window.__ownerCopies.at(-1)), invite);
    record('One native button action reads the filtered URL, posts through main IPC, saves Owner and enables auto-post');

    const snapshot = await page.evaluate(() => localStorage.getItem('airiz.team.v1'));
    await app.evaluate(() => { globalThis.__ownerTest.status = 403; });
    await page.locator('#team-owner-url').fill(OTHER_HOOK);
    await page.locator('#team-owner-setup').click();
    await settled(page, 'error');
    assert.equal(await page.evaluate(() => localStorage.getItem('airiz.team.v1')), snapshot);
    assert.equal(await page.evaluate(() => AirizTeam.member.hook), HOOK);
    record('Native HTTP rejection keeps the previous owner profile and reports a retryable error');

    await page.locator('#team-auto-post').uncheck();
    await app.close();
    runningApp = null;
    ({ app, page } = await launch());
    assert.equal(await page.evaluate(() => AirizTeam.member.role), 'owner');
    assert.equal(await page.locator('#team-owner-url').inputValue(), HOOK);
    assert.equal(await page.locator('#team-auto-post').isChecked(), false);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.reads), 0);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.posts.length), 0);
    await page.locator('#team-owner-setup').click();
    await settled(page, 'ok');
    assert.equal(await page.locator('#team-auto-post').isChecked(), true);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.posts.length), 0);
    assert.equal(await app.evaluate(() => globalThis.__ownerTest.reads), 0);
    record('Real process restart restores Owner, respects a paused switch and re-enables without reposting');
    assert.deepEqual(results.errors, []);
    results.ok = true;
  } catch (error) {
    results.ok = false;
    results.failure = error.stack;
    if (runningApp) {
      try {
        const activePage = await runningApp.firstWindow();
        results.diagnostics = await activePage.evaluate(() => ({
          status: document.getElementById('team-owner-status')?.textContent,
          busy: document.getElementById('team-owner-card')?.getAttribute('aria-busy')
        }));
      } catch {
        // The process may already have exited after a test failure.
      }
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (runningApp) await runningApp.close();
    fs.writeFileSync(path.join(out, 'packaged-report.json'), JSON.stringify(results, null, 2));
  }
})();
