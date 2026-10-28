'use strict';

// Browser-only owner setup checks. All Teams requests and clipboard operations are stubbed.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const web = path.resolve(root, '../web');
const out = path.resolve(process.env.AIRIZ_OWNER_REPORT_DIR || path.join(root, '.test-data', 'owner-setup'));
const HOOK = 'https://prod-01.westus.logic.azure.com/workflows/test/triggers/manual/paths/invoke?sig=TEST_ONLY';
const OTHER_HOOK = 'https://default123.45.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/other/triggers/manual/paths/invoke?sig=TEST_ONLY';
const results = { checks: [], errors: [], missing: {} };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function record(language, name) {
  results.checks.push({ language, name });
  console.log('PASS [' + language + ']: ' + name);
}

async function closeLauncher(page) {
  await page.locator('#qc-dialog').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#qc-close').click();
}

async function openTeam(page, url) {
  await page.goto(url);
  await closeLauncher(page);
  await page.locator('#tab-team').click();
}

async function settled(page, state) {
  await page.waitForFunction(expected => {
    return document.getElementById('team-owner-card').getAttribute('aria-busy') === 'false'
      && document.getElementById('team-owner-status').dataset.state === expected;
  }, state);
}

async function runLanguage(browser, url, language) {
  const posts = [];
  let status = 202;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  await context.addInitScript(({ language, hook }) => {
    localStorage.setItem('airiz.i18n.v1', JSON.stringify({ language, region: 'TW', chosen: true }));
    window.__clipboardReads = 0;
    window.__clipboardWrites = [];
    window.__clipboardText = hook;
    window.__clipboardDenied = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => {
          window.__clipboardReads += 1;
          if (window.__clipboardDenied) throw new Error('denied');
          return window.__clipboardText;
        },
        writeText: async value => { window.__clipboardWrites.push(value); }
      }
    });
  }, { language, hook: HOOK });
  await context.route('**/workflows/**', async route => {
    if (route.request().method() === 'POST') posts.push(JSON.parse(route.request().postData()));
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({
      status,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' },
      body: ''
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => results.errors.push({ language, message: error.message }));
  await openTeam(page, url);
  assert.equal(posts.length, 0);
  assert.equal(await page.evaluate(() => window.__clipboardReads), 0);
  assert.equal(await page.locator('#team-owner-url').getAttribute('type'), 'password');
  assert.equal(await page.locator('#team-owner-setup').isVisible(), true);
  record(language, 'Owner setup is visible first, address masked, startup does not read clipboard or post');

  // Two immediate clicks still issue one request; no manual create/join/test/toggle is needed.
  await page.evaluate(() => {
    document.getElementById('team-owner-setup').click();
    document.getElementById('team-owner-setup').click();
  });
  await settled(page, 'ok');
  assert.equal(posts.length, 1);
  assert.equal(await page.evaluate(() => window.__clipboardReads), 1);
  assert.equal(await page.evaluate(() => AirizTeam.member.role), 'owner');
  assert.equal(await page.evaluate(() => AirizTeam.member.name), 'Juwen Lie');
  assert.equal(await page.locator('#team-auto-post').isChecked(), true);
  assert.equal(await page.locator('#team-owner-setup').isDisabled(), true);
  const originalLink = await page.locator('#team-owner-pass').inputValue();
  assert.equal(posts[0].attachments[0].content.actions[0].url, originalLink);
  assert.equal(await page.evaluate(link => AirizTeam.readPass(link).role, originalLink), 'coadmin');
  assert.equal(await page.evaluate(link => AirizTeam.readPass(link).shared, originalLink), true);
  assert.equal(await page.evaluate(() => window.__clipboardWrites.at(-1)), originalLink);
  assert.equal(await page.locator('#team-owner-progress [data-state="done"]').count(), 4);
  assert.ok(!JSON.stringify(posts).includes(await page.evaluate(() => AirizTeam.member.pass)));
  record(language, 'One action uses the copied URL, posts one shared Co-admin invite, enables/saves Owner and copies the link');
  await page.locator('#team-owner-card').screenshot({ path: path.join(out, 'owner-setup-' + language + '.png') });

  await openTeam(page, url);
  assert.equal(posts.length, 1);
  assert.equal(await page.evaluate(() => window.__clipboardReads), 0);
  assert.equal(await page.locator('#team-owner-url').inputValue(), HOOK);
  assert.equal(await page.locator('#team-owner-setup').isDisabled(), true);
  await page.locator('#team-auto-post').uncheck();
  await openTeam(page, url);
  assert.equal(await page.locator('#team-auto-post').isChecked(), false);
  assert.equal(await page.locator('#team-owner-setup').isEnabled(), true);
  await page.locator('#team-owner-setup').click();
  await settled(page, 'ok');
  assert.equal(await page.locator('#team-auto-post').isChecked(), true);
  assert.equal(posts.length, 1);
  assert.equal(await page.locator('#team-owner-pass').inputValue(), originalLink);
  record(language, 'Reload restores Owner without clipboard/posting; paused auto-post stays off and re-enables without another invite');

  await page.locator('#team-auto-post').uncheck();
  const beforeFailure = await page.evaluate(() => localStorage.getItem('airiz.team.v1'));
  status = 403;
  await page.locator('#team-owner-url').fill(OTHER_HOOK);
  await page.locator('#team-owner-setup').click();
  await settled(page, 'error');
  assert.equal(posts.length, 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('airiz.team.v1')), beforeFailure);
  assert.equal(await page.evaluate(() => AirizTeam.member.hook), HOOK);
  assert.equal(await page.locator('#team-auto-post').isChecked(), false);
  assert.equal(await page.locator('#team-owner-step-invite').getAttribute('data-state'), 'error');
  assert.equal(await page.locator('#team-owner-setup').isEnabled(), true);
  record(language, 'Rejected workflow preserves the previous profile and paused switch, with a visible recoverable failure');

  status = 202;
  await page.locator('#team-owner-setup').click();
  await settled(page, 'ok');
  assert.equal(posts.length, 3);
  assert.equal(await page.evaluate(() => AirizTeam.member.hook), OTHER_HOOK);
  assert.equal(await page.locator('#team-auto-post').isChecked(), true);
  record(language, 'Explicit retry succeeds and updates the saved endpoint');

  await page.locator('#team-owner-url').fill('https://example.com/private-notes');
  await page.locator('#team-owner-setup').click();
  await settled(page, 'error');
  assert.equal(posts.length, 3);
  assert.equal(await page.evaluate(() => AirizTeam.member.hook), OTHER_HOOK);
  record(language, 'Invalid destination is refused before any request or profile change');

  // Independent guest profile: unrelated and blocked clipboards require a deliberate paste.
  const guest = await context.newPage();
  guest.on('pageerror', error => results.errors.push({ language, message: error.message }));
  await guest.goto(url);
  await guest.evaluate(() => localStorage.removeItem('airiz.team.v1'));
  await openTeam(guest, url);
  await guest.evaluate(() => { window.__clipboardText = 'UNRELATED_PRIVATE_TEXT'; });
  await guest.locator('#team-owner-setup').click();
  await settled(guest, 'error');
  assert.equal(posts.length, 3);
  assert.equal(await guest.locator('#team-owner-url').inputValue(), '');
  assert.equal(await guest.evaluate(() => AirizTeam.member), null);
  assert.ok(!(await guest.locator('#view-team').innerText()).includes('UNRELATED_PRIVATE_TEXT'));
  await guest.evaluate(() => { window.__clipboardDenied = true; });
  await guest.locator('#team-owner-setup').click();
  await settled(guest, 'error');
  const readsBeforePaste = await guest.evaluate(() => window.__clipboardReads);
  await guest.locator('#team-owner-url').fill(HOOK);
  await guest.locator('#team-owner-setup').click();
  await settled(guest, 'ok');
  assert.equal(posts.length, 4);
  assert.equal(await guest.evaluate(() => window.__clipboardReads), readsBeforePaste);
  record(language, 'Unrelated clipboard is never displayed; denied clipboard has a working manual-paste fallback');

  // Advanced controls remain available and cannot silently replace the local Owner profile.
  await guest.locator('.team-owner-details summary').click();
  await guest.locator('#team-owner-name').fill('Example Co-admin');
  await guest.locator('#team-owner-create').click();
  assert.equal(await guest.evaluate(() => AirizTeam.readPass(document.getElementById('team-owner-pass').value).name), 'Example Co-admin');
  assert.equal(await guest.evaluate(() => AirizTeam.member.role), 'owner');
  assert.equal(posts.length, 4);
  await guest.locator('#team-owner-post').click();
  await guest.waitForFunction(() => !document.getElementById('team-owner-post').disabled);
  assert.equal(posts.length, 5);
  record(language, 'Advanced personal invites and explicit repost still work independently of Owner setup');

  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.locator('#team-owner-card').scrollIntoViewIfNeeded();
  const mobileLayout = await guest.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > innerWidth + 1;
    }).slice(0, 15).map(element => ({
      tag: element.tagName, id: element.id, className: String(element.className),
      right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width
    }))
  }));
  results.mobileLayout = mobileLayout;
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.viewport + 1, JSON.stringify(mobileLayout));
  record(language, 'Owner setup fits a narrow phone viewport without horizontal overflow');
  await guest.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = () => false;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'airiz.team.v1') throw new Error('Storage is blocked');
      return originalSetItem.call(this, key, value);
    };
  });
  await guest.locator('#team-owner-url').fill(OTHER_HOOK);
  await guest.locator('#team-owner-setup').click();
  await settled(guest, 'warning');
  assert.equal(posts.length, 6);
  assert.equal(await guest.evaluate(() => AirizTeam.member.hook), OTHER_HOOK);
  assert.equal(await guest.locator('#team-owner-step-save').getAttribute('data-state'), 'error');
  assert.equal(await guest.locator('#team-owner-setup').isDisabled(), true);
  record(language, 'Storage and copy denial are reported as session-only warnings, not a false rollback or duplicate invite');
  results.missing[language] = [...new Set([
    ...await page.evaluate(() => AirizI18n.missing()),
    ...await guest.evaluate(() => AirizI18n.missing())
  ])];
  await context.close();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = path.resolve(web, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(web + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
    for (const language of ['en', 'zh-TW']) await runLanguage(browser, url, language);
    assert.deepEqual(results.errors, []);
    results.ok = true;
  } catch (error) {
    results.ok = false;
    results.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(results, null, 2));
  }
})();
