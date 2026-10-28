/* Ziris PTB team: owner, members and Microsoft Teams auto-post.
 *
 * When a team member shares the AIRIZ camera (Camera -> Share to phone) the console shows a
 * 6-digit code. For members of the Ziris PTB team this module posts that code automatically
 * to the "Ziris PTB" Microsoft Teams group chat, so the phone user can read it there.
 *
 * Who counts as a member: anyone who installed a team pass issued by the owner (Juwen Lie).
 * The pass carries the member's name and role and the private Teams Workflow address of the
 * Ziris PTB chat. Without a pass nothing is ever sent, so the public app stays quiet for
 * everybody outside the team.
 *
 * Transport: the Windows desktop app posts from its main process (airizDesktop.postToTeams),
 * a browser posts directly to the Workflow (Power Automate allows cross-origin POST).
 * Nothing else leaves the PC: the message holds the code, the public watch link, the member
 * name and the PC label.
 */
(function () {
  'use strict';

  const OWNER_NAME = 'Juwen Lie';
  const TEAM_NAME = 'Ziris PTB';
  const PASS_PREFIX = 'ZPTB1-';
  const SETTINGS_KEY = 'airiz.team.v1';
  const LOG_KEY = 'airiz.team.log.v1';
  const LOG_LIMIT = 25;
  const POST_TIMEOUT_MS = 20000;
  const PUBLIC_BASE = 'https://juw12.github.io/projects/airiz-motor/';
  const ROLES = Object.freeze({ owner: 'Owner', coadmin: 'Co-admin', tester: 'Tester' });
  const WORKFLOW_HOSTS = [
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.logic\.azure\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.api\.powerplatform\.com$/i,
    /^[a-z0-9-]+\.webhook\.office\.com$/i
  ];

  // ------------------------------------------------------------------ helpers

  function base64UrlEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function cleanName(value) {
    return String(value || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function isWorkflowUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' && !url.username && !url.password
        && WORKFLOW_HOSTS.some(pattern => pattern.test(url.hostname));
    } catch {
      return false;
    }
  }

  function roleLabel(role) {
    return ROLES[role] || 'Member';
  }

  // ------------------------------------------------------------------ team pass

  function createPass({ name, role, workflowUrl }) {
    const memberName = cleanName(name);
    if (!memberName) throw new Error('Enter the member name.');
    if (!ROLES[role]) throw new Error('Choose a role.');
    if (!isWorkflowUrl(workflowUrl)) {
      throw new Error('Paste the HTTPS address of the Ziris PTB Teams workflow (Power Automate webhook).');
    }
    const body = {
      v: 1,
      team: TEAM_NAME,
      owner: OWNER_NAME,
      name: memberName,
      role,
      hook: String(workflowUrl).trim(),
      issued: new Date().toISOString().slice(0, 10)
    };
    return PASS_PREFIX + base64UrlEncode(JSON.stringify(body));
  }

  function readPass(text) {
    const value = String(text || '').replace(/\s+/g, '');
    if (!value.startsWith(PASS_PREFIX)) throw new Error('This is not a Ziris PTB team pass (it starts with ' + PASS_PREFIX + ').');
    let body;
    try {
      body = JSON.parse(base64UrlDecode(value.slice(PASS_PREFIX.length)));
    } catch {
      throw new Error('The team pass is incomplete. Copy the whole pass again.');
    }
    if (!body || body.v !== 1 || body.team !== TEAM_NAME) throw new Error('This pass is not for the ' + TEAM_NAME + ' team.');
    const name = cleanName(body.name);
    if (!name || !ROLES[body.role]) throw new Error('The team pass has no valid member name or role.');
    if (!isWorkflowUrl(body.hook)) throw new Error('The team pass has no valid Teams workflow address.');
    return Object.freeze({
      name,
      role: body.role,
      roleLabel: roleLabel(body.role),
      hook: body.hook,
      issued: String(body.issued || '').slice(0, 10),
      pass: value
    });
  }

  // ------------------------------------------------------------------ storage

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        pass: typeof stored.pass === 'string' ? stored.pass : '',
        autoCamera: stored.autoCamera !== false,
        autoControl: stored.autoControl === true
      };
    } catch {
      return { pass: '', autoCamera: true, autoControl: false };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode: the pass then lasts for this session only.
    }
  }

  function loadLog() {
    try {
      const entries = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      return Array.isArray(entries) ? entries.slice(0, LOG_LIMIT) : [];
    } catch {
      return [];
    }
  }

  function addLog(entry) {
    const entries = [entry, ...loadLog()].slice(0, LOG_LIMIT);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch {
      // Ignore: the log is a convenience only.
    }
    return entries;
  }

  let settings = loadSettings();

  function currentMember() {
    if (!settings.pass) return null;
    try {
      return readPass(settings.pass);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ message

  function publicLink(kind, code) {
    return kind === 'control'
      ? PUBLIC_BASE + 'index.html#control=' + code
      : PUBLIC_BASE + 'watch.html#' + code;
  }

  function pcLabel() {
    const label = typeof window.AirizDeviceLabel === 'function' ? window.AirizDeviceLabel() : '';
    return cleanName(label) || 'AIRIZ PC';
  }

  function buildMessage({ kind, code, member, test }) {
    const camera = kind !== 'control';
    const title = test
      ? 'AIRIZ console test message'
      : camera ? 'AIRIZ camera share code' : 'AIRIZ remote control code';
    const instructions = test
      ? 'Auto-post to ' + TEAM_NAME + ' works on this PC.'
      : camera
        ? 'Phone: open the AIRIZ console \u2192 Camera \u2192 enter the code \u2192 Watch, or tap the button below.'
        : 'Phone or PC: AIRIZ console \u2192 Connect by code \u2192 enter the code. The PC operator must press Allow.';
    const when = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const body = [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
      {
        type: 'TextBlock',
        text: test ? 'TEST' : code,
        size: 'ExtraLarge',
        weight: 'Bolder',
        fontType: 'Monospace',
        color: 'Accent',
        spacing: 'Small'
      },
      { type: 'TextBlock', text: instructions, wrap: true, spacing: 'Small' },
      {
        type: 'FactSet',
        facts: [
          { title: 'Shared by', value: member.name + ' (' + member.roleLabel + ')' },
          { title: 'PC', value: pcLabel() },
          { title: 'Time', value: when },
          { title: 'Valid', value: test ? '-' : 'Only while sharing is on' }
        ]
      },
      {
        type: 'TextBlock',
        text: 'Sent automatically by the AIRIZ console for the ' + TEAM_NAME + ' team \u00b7 owner ' + OWNER_NAME,
        isSubtle: true,
        size: 'Small',
        wrap: true
      }
    ];
    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body,
      actions: test ? [] : [{
        type: 'Action.OpenUrl',
        title: camera ? 'Watch on phone' : 'Open AIRIZ console',
        url: publicLink(kind, code)
      }]
    };
    return {
      type: 'message',
      summary: test ? title : title + ' ' + code,
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }]
    };
  }

  async function postMessage(workflowUrl, message) {
    if (!isWorkflowUrl(workflowUrl)) throw new Error('Invalid Teams workflow address.');
    const body = JSON.stringify(message);
    const desktop = window.airizDesktop;
    if (desktop && typeof desktop.postToTeams === 'function') {
      const result = await desktop.postToTeams(workflowUrl, body);
      if (!result || !result.ok) throw new Error((result && result.error) || 'Teams did not accept the message.');
      return result;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      const response = await fetch(workflowUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('Teams answered HTTP ' + response.status + '.');
      return { ok: true, status: response.status };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Teams did not answer in time.');
      if (error instanceof TypeError) throw new Error('No connection to Teams (network or firewall).');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ automation

  const sentCodes = new Set();
  const listeners = new Set();
  let lastShare = null;

  function notify(state) {
    listeners.forEach(listener => {
      try {
        listener(state);
      } catch {
        // A broken view must not stop the others.
      }
    });
  }

  async function sendShareCode(kind, code, { manual = false } = {}) {
    const member = currentMember();
    if (!member) return { skipped: 'not-member' };
    if (!/^\d{6}$/.test(String(code))) return { skipped: 'bad-code' };
    const key = kind + ':' + code;
    if (!manual) {
      const enabled = kind === 'control' ? settings.autoControl : settings.autoCamera;
      if (!enabled) {
        notify({ kind, code, status: 'off' });
        return { skipped: 'off' };
      }
      if (sentCodes.has(key)) return { skipped: 'already-sent' };
    }
    sentCodes.add(key);
    notify({ kind, code, status: 'sending' });
    try {
      await postMessage(member.hook, buildMessage({ kind, code, member }));
      addLog({ at: Date.now(), kind, code, ok: true, by: member.name });
      notify({ kind, code, status: 'sent', at: Date.now() });
      return { ok: true };
    } catch (error) {
      sentCodes.delete(key);
      const message = (error && error.message) || String(error);
      addLog({ at: Date.now(), kind, code, ok: false, by: member.name, error: message });
      notify({ kind, code, status: 'failed', error: message });
      return { ok: false, error: message };
    }
  }

  document.addEventListener('airiz:share-code', event => {
    const detail = event.detail || {};
    const kind = detail.kind === 'control' ? 'control' : 'camera';
    if (!detail.code) {
      if (lastShare && lastShare.kind === kind) lastShare = null;
      notify({ kind, code: null, status: 'stopped' });
      return;
    }
    lastShare = { kind, code: String(detail.code) };
    sendShareCode(kind, String(detail.code));
  });

  // ------------------------------------------------------------------ views

  const $ = id => document.getElementById(id);

  function formatTime(value) {
    return new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  function setText(id, text) {
    const element = $(id);
    if (element) element.textContent = text;
  }

  function renderLog() {
    const list = $('team-log');
    if (!list) return;
    const entries = loadLog();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'Nothing sent from this PC yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...entries.map(entry => {
      const item = document.createElement('li');
      const badge = document.createElement('span');
      badge.className = 'team-log-badge ' + (entry.ok ? 'ok' : 'failed');
      badge.textContent = entry.ok ? 'Sent' : 'Failed';
      const what = entry.kind === 'test' ? 'Test message'
        : (entry.kind === 'control' ? 'Control code ' : 'Camera code ') + entry.code;
      item.append(badge, document.createTextNode(' ' + what + ' \u00b7 ' + formatTime(entry.at)
        + ' \u00b7 ' + (entry.by || '') + (entry.ok ? '' : ' \u00b7 ' + (entry.error || ''))));
      return item;
    }));
  }

  function renderMembership() {
    const member = currentMember();
    document.documentElement.classList.toggle('ziris-member', !!member);
    setText('team-member-name', member ? member.name : 'Not signed in');
    setText('team-member-role', member ? member.roleLabel : 'Guest');
    setText('team-member-note', member
      ? 'Team pass from ' + OWNER_NAME + (member.issued ? ' \u00b7 issued ' + member.issued : '') + '. '
        + 'Share codes from this PC go to the ' + TEAM_NAME + ' Teams chat.'
      : 'Only ' + TEAM_NAME + ' members (co-admins and testers added by ' + OWNER_NAME + ') can use the Teams auto-post. '
        + 'Paste the team pass you received from the owner below.');
    const joined = $('team-joined');
    const join = $('team-join');
    if (joined) joined.hidden = !member;
    if (join) join.hidden = !!member;
    const camera = $('team-auto-camera');
    const control = $('team-auto-control');
    if (camera) {
      camera.checked = settings.autoCamera;
      camera.disabled = !member;
    }
    if (control) {
      control.checked = settings.autoControl;
      control.disabled = !member;
    }
    const test = $('team-test');
    if (test) test.disabled = !member;
    const sidebar = $('sidebar-team-member');
    if (sidebar) sidebar.textContent = member ? member.name + ' \u00b7 ' + member.roleLabel : 'Guest';
    renderCameraLine();
    renderLog();
  }

  let cameraState = null;

  function renderCameraLine() {
    const line = $('relay-teams-status');
    if (!line) return;
    const member = currentMember();
    const resend = $('btn-relay-teams-send');
    if (!member) {
      line.hidden = true;
      if (resend) resend.hidden = true;
      return;
    }
    line.hidden = false;
    const state = cameraState;
    const active = lastShare && lastShare.kind === 'camera' ? lastShare.code : null;
    if (resend) {
      resend.hidden = !active;
      resend.disabled = !!(state && state.status === 'sending');
    }
    let text;
    if (!state || state.status === 'stopped' || !active) {
      text = settings.autoCamera
        ? 'Teams auto-post is on: the share code goes to ' + TEAM_NAME + ' as soon as it appears.'
        : 'Teams auto-post is off (Team page). Use Send to Teams to post the code yourself.';
    } else if (state.status === 'sending') {
      text = 'Sending code ' + state.code + ' to ' + TEAM_NAME + '\u2026';
    } else if (state.status === 'sent') {
      text = 'Code ' + state.code + ' sent to ' + TEAM_NAME + ' at '
        + new Date(state.at).toLocaleTimeString([], { timeStyle: 'short' }) + '.';
    } else if (state.status === 'failed') {
      text = 'Could not send code ' + state.code + ' to ' + TEAM_NAME + ': ' + state.error + ' Press Send to Teams to retry.';
    } else {
      text = 'Teams auto-post is off. Press Send to Teams to post code ' + state.code + '.';
    }
    line.textContent = text;
    line.dataset.state = state ? state.status : 'idle';
  }

  function renderControlLine(state) {
    const status = $('share-control-status');
    if (!status || !state || !state.code) return;
    const extra = state.status === 'sent' ? ' Code sent to ' + TEAM_NAME + ' in Teams.'
      : state.status === 'failed' ? ' (Teams post failed: ' + state.error + ')' : '';
    if (extra && !status.textContent.includes(extra)) status.textContent += extra;
  }

  listeners.add(state => {
    if (state.kind === 'camera') {
      cameraState = state;
      renderCameraLine();
    } else {
      renderControlLine(state);
    }
    if (state.status === 'sent' || state.status === 'failed') renderLog();
  });

  function showTeamStatus(text, isError) {
    const status = $('team-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.state = isError ? 'error' : 'ok';
  }

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      if (input) {
        input.select();
        return document.execCommand('copy');
      }
      return false;
    }
  }

  function bindTeamPage() {
    const joinButton = $('team-join-button');
    if (joinButton) {
      joinButton.addEventListener('click', () => {
        const input = $('team-pass-input');
        try {
          const member = readPass(input.value);
          settings = { ...settings, pass: member.pass };
          saveSettings(settings);
          input.value = '';
          renderMembership();
          showTeamStatus('Welcome, ' + member.name + ' (' + member.roleLabel + '). Press Send test message to check Teams.', false);
        } catch (error) {
          showTeamStatus(error.message, true);
        }
      });
    }
    const leaveButton = $('team-leave');
    if (leaveButton) {
      leaveButton.addEventListener('click', () => {
        if (!confirm('Remove the ' + TEAM_NAME + ' team pass from this PC? Auto-post stops until a pass is added again.')) return;
        settings = { ...settings, pass: '' };
        saveSettings(settings);
        renderMembership();
        showTeamStatus('Team pass removed from this PC.', false);
      });
    }
    for (const [id, key] of [['team-auto-camera', 'autoCamera'], ['team-auto-control', 'autoControl']]) {
      const box = $(id);
      if (!box) continue;
      box.addEventListener('change', () => {
        settings = { ...settings, [key]: box.checked };
        saveSettings(settings);
        renderCameraLine();
      });
    }
    const testButton = $('team-test');
    if (testButton) {
      testButton.addEventListener('click', async () => {
        const member = currentMember();
        if (!member) return;
        testButton.disabled = true;
        showTeamStatus('Sending a test message to ' + TEAM_NAME + '\u2026', false);
        try {
          await postMessage(member.hook, buildMessage({ kind: 'camera', code: '000000', member, test: true }));
          addLog({ at: Date.now(), kind: 'test', code: '', ok: true, by: member.name });
          showTeamStatus('Test message sent. Check the ' + TEAM_NAME + ' chat in Teams.', false);
        } catch (error) {
          addLog({ at: Date.now(), kind: 'test', code: '', ok: false, by: member.name, error: error.message });
          showTeamStatus('Test failed: ' + error.message, true);
        } finally {
          testButton.disabled = false;
          renderLog();
        }
      });
    }
    const createButton = $('team-owner-create');
    if (createButton) {
      createButton.addEventListener('click', () => {
        const output = $('team-owner-pass');
        try {
          const pass = createPass({
            name: $('team-owner-name').value,
            role: $('team-owner-role').value,
            workflowUrl: $('team-owner-url').value
          });
          output.value = pass;
          $('team-owner-copy').disabled = false;
          setText('team-owner-status', 'Pass ready for ' + cleanName($('team-owner-name').value)
            + '. Send it privately (Teams 1:1 chat). Anyone holding it can post to ' + TEAM_NAME + '.');
        } catch (error) {
          output.value = '';
          $('team-owner-copy').disabled = true;
          setText('team-owner-status', error.message);
        }
      });
    }
    const copyButton = $('team-owner-copy');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        const output = $('team-owner-pass');
        if (!output.value) return;
        const copied = await copyText(output.value, output);
        setText('team-owner-status', copied ? 'Pass copied.' : 'Select the pass and copy it with Ctrl+C.');
      });
    }
    const resend = $('btn-relay-teams-send');
    if (resend) {
      resend.addEventListener('click', () => {
        if (lastShare && lastShare.kind === 'camera') sendShareCode('camera', lastShare.code, { manual: true });
      });
    }
    window.addEventListener('storage', event => {
      if (event.key === SETTINGS_KEY) {
        settings = loadSettings();
        renderMembership();
      }
      if (event.key === LOG_KEY) renderLog();
    });
    document.querySelectorAll('[data-owner-name]').forEach(element => {
      element.textContent = OWNER_NAME;
    });
    renderMembership();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindTeamPage);
  else bindTeamPage();

  window.AirizTeam = Object.freeze({
    OWNER_NAME,
    TEAM_NAME,
    ROLES,
    createPass,
    readPass,
    isWorkflowUrl,
    buildMessage,
    publicLink,
    sendShareCode,
    get member() {
      return currentMember();
    }
  });
})();
