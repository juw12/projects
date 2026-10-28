'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isTeamsWorkflowUrl, teamsWorkflowFromClipboard } = require('../security.cjs');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../web/ziris-team.js'), 'utf8');
const KEY = 'airiz.team.v1';
const HOOK = 'https://prod-01.westus.logic.azure.com/workflows/test/triggers/manual/paths/invoke?sig=TEST_ONLY';
const OTHER_HOOK = 'https://default123.45.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/other/triggers/manual/paths/invoke?sig=TEST_ONLY';

function fixture({ stored = new Map(), post, failStorage = false, browserFetch } = {}) {
  const posts = [];
  const context = {
    URL, TypeError, TextEncoder, TextDecoder, btoa, atob, AbortController, setTimeout, clearTimeout,
    location: { hash: '' },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => {
        if (failStorage) throw new Error('Storage is blocked');
        stored.set(key, value);
      }
    },
    document: { readyState: 'loading', addEventListener() {} },
    window: {
      airizDesktop: {
        postToTeams: async (url, body) => {
          posts.push({ url, message: JSON.parse(body) });
          return post ? post(url, body) : { ok: true, status: 202 };
        }
      }
    }
  };
  if (browserFetch) {
    delete context.window.airizDesktop;
    context.fetch = browserFetch;
  }
  vm.runInNewContext(SOURCE, context);
  return {
    team: context.window.AirizTeam,
    posts,
    stored,
    settings: () => JSON.parse(stored.get(KEY) || '{}')
  };
}

function invitePassFromPost(post, team) {
  const card = post.message.attachments[0].content;
  return team.readPass(card.actions[0].url);
}

test('one owner action submits a shared Co-admin invite, then enables and persists the Owner locally', async () => {
  const subject = fixture();
  assert.equal(subject.team.member, null);
  assert.equal(subject.posts.length, 0, 'startup is silent');
  const result = await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.persisted, true);
  assert.equal(result.reused, false);
  assert.equal(result.status, 202);
  assert.equal(result.delivered, undefined, 'acceptance must not be represented as delivery');
  assert.equal(subject.posts.length, 1, 'invite is also the test, not two cards');
  assert.equal(subject.posts[0].url, HOOK);
  const invite = invitePassFromPost(subject.posts[0], subject.team);
  assert.equal(invite.shared, true);
  assert.equal(invite.role, 'coadmin');
  assert.equal(invite.name, '');
  assert.equal(subject.team.member.name, 'Juwen Lie');
  assert.equal(subject.team.member.role, 'owner');
  assert.equal(subject.settings().autoPost, true);
  assert.equal(subject.settings().ownerSetup.invite, invite.pass);
  assert.ok(!JSON.stringify(subject.posts[0]).includes(subject.settings().pass), 'Owner pass is never shared');
  const log = JSON.parse(subject.stored.get('airiz.team.log.v1'));
  assert.equal(log[0].kind, 'invite');
  assert.ok(!JSON.stringify(log).includes('TEST_ONLY'), 'logs never contain webhook credentials');
});

test('same destination reuses the accepted invite; reload neither posts nor re-enables a paused switch', async () => {
  const first = fixture();
  const original = await first.team.setupOwner({ workflowUrl: HOOK });
  const repeated = await first.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(repeated.reused, true);
  assert.equal(first.posts.length, 1);
  assert.equal(repeated.inviteLink, original.inviteLink);
  const paused = first.settings();
  paused.autoPost = false;
  first.stored.set(KEY, JSON.stringify(paused));
  const reopened = fixture({ stored: first.stored });
  assert.equal(reopened.posts.length, 0);
  assert.equal(reopened.team.member.role, 'owner');
  assert.equal(reopened.settings().autoPost, false);
  const enabled = await reopened.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(enabled.reused, true);
  assert.equal(reopened.settings().autoPost, true);
  assert.equal(reopened.posts.length, 0);
});

test('changing the workflow issues one new invite and replaces the saved destination', async () => {
  const subject = fixture();
  await subject.team.setupOwner({ workflowUrl: HOOK });
  const result = await subject.team.setupOwner({ workflowUrl: OTHER_HOOK });
  assert.equal(subject.posts.length, 2);
  assert.equal(result.reused, false);
  assert.equal(subject.team.member.hook, OTHER_HOOK);
  assert.equal(subject.team.readPass(subject.settings().ownerSetup.invite).hook, OTHER_HOOK);
});

test('failed setup preserves the previous member, invite and paused auto-post setting', async () => {
  const previous = fixture();
  const pass = previous.team.createPass({ workflowUrl: HOOK });
  previous.team.joinTeam(pass, 'Existing Co-admin');
  const settings = previous.settings();
  settings.autoPost = false;
  previous.stored.set(KEY, JSON.stringify(settings));
  const snapshot = previous.stored.get(KEY);
  const subject = fixture({
    stored: previous.stored,
    post: async () => ({ ok: false, status: 403, error: 'Teams answered HTTP 403.' })
  });
  await assert.rejects(subject.team.setupOwner({ workflowUrl: OTHER_HOOK }), /HTTP 403/);
  assert.equal(subject.stored.get(KEY), snapshot);
  assert.equal(subject.team.member.name, 'Existing Co-admin');
  assert.equal(subject.team.member.role, 'coadmin');
  assert.equal(subject.settings().autoPost, false);
  assert.equal(subject.posts.length, 1);
  assert.equal(subject.stored.has('airiz.team.log.v1'), false);
});

test('failed first setup leaves the app as a guest and permits an explicit retry', async () => {
  let attempts = 0;
  const subject = fixture({
    post: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, error: 'Teams did not answer in time.' };
      return { ok: true, status: 202 };
    }
  });
  await assert.rejects(subject.team.setupOwner({ workflowUrl: HOOK }), /did not answer/);
  assert.equal(subject.team.member, null);
  assert.equal(subject.stored.has(KEY), false);
  assert.equal(attempts, 1, 'never automatically retry an ambiguous timeout');
  await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(attempts, 2);
  assert.equal(subject.team.member.role, 'owner');
});

test('double invocation shares one in-flight request', async () => {
  let finish;
  const subject = fixture({ post: () => new Promise(resolve => { finish = resolve; }) });
  const first = subject.team.setupOwner({ workflowUrl: HOOK });
  const second = subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(first, second);
  assert.equal(subject.posts.length, 1);
  assert.equal(subject.team.member, null, 'profile is not committed before acceptance');
  finish({ ok: true, status: 202 });
  await Promise.all([first, second]);
  assert.equal(subject.posts.length, 1);
  assert.equal(subject.team.member.role, 'owner');
});

test('unavailable storage is reported accurately; accepted invite still prevents repeats this session', async () => {
  const subject = fixture({ failStorage: true });
  const result = await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(result.persisted, false);
  assert.equal(subject.stored.has(KEY), false);
  assert.equal(subject.team.member.role, 'owner');
  const again = await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(again.reused, true);
  assert.equal(again.persisted, false);
  assert.equal(subject.posts.length, 1);
});

test('a changed local profile is not overwritten by a late workflow response', async () => {
  let finish;
  const subject = fixture({ post: () => new Promise(resolve => { finish = resolve; }) });
  const pending = subject.team.setupOwner({ workflowUrl: HOOK });
  subject.team.joinTeam(subject.team.createPass({ workflowUrl: OTHER_HOOK }), 'Another Co-admin');
  const snapshot = subject.stored.get(KEY);
  finish({ ok: true, status: 202 });
  await assert.rejects(pending, /settings changed/);
  assert.equal(subject.team.member.name, 'Another Co-admin');
  assert.equal(subject.stored.get(KEY), snapshot);
});

test('an invalid saved receipt is not used to claim that an invite was already accepted', async () => {
  const previous = fixture();
  await previous.team.setupOwner({ workflowUrl: HOOK });
  const broken = previous.settings();
  broken.ownerSetup.invite = broken.pass;
  previous.stored.set(KEY, JSON.stringify(broken));
  const subject = fixture({ stored: previous.stored });
  await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(subject.posts.length, 1);
  assert.equal(invitePassFromPost(subject.posts[0], subject.team).role, 'coadmin');
});

test('desktop and web agree on allowed endpoints; invalid clipboard content never leaves the bridge', async () => {
  const subject = fixture();
  const allowed = [HOOK, OTHER_HOOK, 'https://contoso.webhook.office.com/webhookb2/test'];
  for (const url of allowed) {
    assert.equal(subject.team.isWorkflowUrl(url), true);
    assert.equal(isTeamsWorkflowUrl(url), true);
    assert.equal(teamsWorkflowFromClipboard('  ' + url + '\n'), url);
  }
  const rejected = [
    '', 'my private clipboard notes', 'https://example.com/hook',
    'https://prod-01.westus.logic.azure.com/',
    HOOK.replace('https:', 'http:'), HOOK.replace('.com/', '.com:8443/'),
    HOOK.replace('https://', 'https://user:password@'), HOOK + '#secret',
    HOOK.replace('.azure.com/', '.azure.com.evil.test/'),
    HOOK.replace('prod-01', 'prod-\n01'), HOOK + 'a'.repeat(4001)
  ];
  for (const url of rejected) {
    assert.equal(subject.team.isWorkflowUrl(url), false);
    assert.equal(isTeamsWorkflowUrl(url), false);
    assert.equal(teamsWorkflowFromClipboard(url), '');
    await assert.rejects(subject.team.setupOwner({ workflowUrl: url }), /complete HTTPS/);
  }
  assert.equal(subject.posts.length, 0);
  assert.equal(subject.team.member, null);
});

test('browser transport omits cookies/referrer, refuses redirects and sanitizes network errors', async () => {
  let request;
  const subject = fixture({
    browserFetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202 };
    }
  });
  await subject.team.setupOwner({ workflowUrl: HOOK });
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  const blocked = fixture({
    browserFetch: async () => { throw new TypeError('private network details'); }
  });
  await assert.rejects(blocked.team.setupOwner({ workflowUrl: HOOK }), /No connection to Teams/);
  assert.equal(blocked.team.member, null);
});
