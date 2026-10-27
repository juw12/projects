/* Sweep Plus — optional paid tier + tips. Everything Sweep already did stays free.
 *
 * How it works (no server needed):
 *   - You sell "Sweep Plus" on Lemon Squeezy (monthly / yearly / lifetime) with license keys turned on.
 *   - Buyers paste their key here; Sweep checks it with Lemon Squeezy's public License API
 *     (https://docs.lemonsqueezy.com/api/license-api) and re-checks every few days.
 *   - Tips go to Trakteer / Saweria (Indonesia) or Ko-fi / GitHub Sponsors (global).
 *   - Until at least one checkout link is filled in below, Plus features are free for everyone
 *     ("free during beta") and no paywall is shown.
 *
 * Plus features are unlocked in the browser, so this is an honour system that makes paying easy;
 * it is not DRM.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration — fill these in (see apps/sweep/README.md → "Earning from Sweep").
  // ---------------------------------------------------------------------------
  const DEFAULT_CONFIG = {
    // Lemon Squeezy checkout links ("Share" button on each product/variant).
    checkout: { monthly: '', yearly: '', lifetime: '' },
    prices: { monthly: '$3 / month', yearly: '$24 / year', lifetime: '$49 once' },
    // Optional but recommended: only accept keys from your store / products (numbers from the dashboard).
    storeId: 0,
    productIds: [],
    // Tip / membership pages (leave empty to hide).
    tips: { trakteer: '', saweria: '', kofi: '', githubSponsors: '' },
    // Shown as "Using Sweep with a team?" contact.
    teamEmail: ''
  };

  const LICENSE_KEY = 'sweep_plus_v1';
  const PREFS_KEY = 'sweep_plus_prefs_v1';
  const LICENSE_API = 'https://api.lemonsqueezy.com/v1/licenses/';
  const RECHECK_MS = 3 * 24 * 3600 * 1000;
  const OFFLINE_GRACE_MS = 14 * 24 * 3600 * 1000;

  const config = mergeConfig(DEFAULT_CONFIG, window.SWEEP_PLUS_CONFIG || {});

  const t = function (text, vars) {
    return window.SweepI18n ? window.SweepI18n.t(text, vars) : text.replace(/\{(\w+)\}/g, function (_, key) {
      return vars && vars[key] !== undefined ? vars[key] : '{' + key + '}';
    });
  };

  function mergeConfig(base, extra) {
    const out = JSON.parse(JSON.stringify(base));
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] && typeof extra[key] === 'object' && !Array.isArray(extra[key]) && out[key] && typeof out[key] === 'object') {
        out[key] = Object.assign({}, out[key], extra[key]);
      } else {
        out[key] = extra[key];
      }
    });
    return out;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* storage unavailable */
    }
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  // ---------------------------------------------------------------------------
  // Plans and licence
  // ---------------------------------------------------------------------------
  function paywallOn() {
    return !!(config.checkout.monthly || config.checkout.yearly || config.checkout.lifetime);
  }

  function license() {
    return readJson(LICENSE_KEY, null);
  }

  function licenseActive(entry) {
    if (!entry || !entry.key) return false;
    if (entry.status !== 'active') return false;
    if (entry.expiresAt && Date.parse(entry.expiresAt) < Date.now()) return false;
    return Date.now() - (entry.checkedAt || 0) < OFFLINE_GRACE_MS;
  }

  function isPlus() {
    return !paywallOn() || licenseActive(license());
  }

  function statusLabel() {
    const entry = license();
    if (licenseActive(entry)) {
      return t('Plus is active') + (entry.variantName ? ' · ' + entry.variantName : '');
    }
    if (!paywallOn()) return t('Free during the beta');
    if (entry && entry.status === 'expired') return t('Your Plus subscription has ended');
    return t('Not active');
  }

  async function licenseCall(action, params) {
    let response;
    try {
      response = await fetch(LICENSE_API + action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
      });
    } catch (error) {
      const offline = new Error(t('Could not reach the licence server. Check your connection.'));
      offline.offline = true;
      throw offline;
    }
    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }
    return body;
  }

  function checkProduct(meta) {
    if (!meta) return;
    if (config.storeId && Number(meta.store_id) !== Number(config.storeId)) {
      throw new Error(t('This key belongs to a different product.'));
    }
    if (config.productIds && config.productIds.length && config.productIds.map(Number).indexOf(Number(meta.product_id)) === -1) {
      throw new Error(t('This key belongs to a different product.'));
    }
  }

  function instanceName() {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'browser';
    return 'Sweep · ' + platform + ' · ' + new Date().toISOString().slice(0, 10);
  }

  async function activate(rawKey) {
    const key = String(rawKey || '').trim();
    if (!/^[A-Za-z0-9-]{8,}$/.test(key)) throw new Error(t('Paste the licence key from your receipt email.'));
    const body = await licenseCall('activate', { license_key: key, instance_name: instanceName() });
    if (!body.activated) {
      const message = String(body.error || '');
      if (/limit/i.test(message)) throw new Error(t('This key is already used on the maximum number of devices. Deactivate it on another device first.'));
      if (/not found|invalid/i.test(message)) throw new Error(t('That licence key was not found. Check for typos.'));
      throw new Error(message || t('The key could not be activated.'));
    }
    checkProduct(body.meta);
    const entry = {
      key: key,
      instanceId: body.instance && body.instance.id,
      status: (body.license_key && body.license_key.status) || 'active',
      expiresAt: (body.license_key && body.license_key.expires_at) || null,
      productName: body.meta && body.meta.product_name,
      variantName: body.meta && body.meta.variant_name,
      checkedAt: Date.now()
    };
    writeJson(LICENSE_KEY, entry);
    notify();
    return entry;
  }

  async function revalidate(force) {
    const entry = license();
    if (!entry || !entry.key) return null;
    if (!force && Date.now() - (entry.checkedAt || 0) < RECHECK_MS) return entry;
    try {
      const params = { license_key: entry.key };
      if (entry.instanceId) params.instance_id = entry.instanceId;
      const body = await licenseCall('validate', params);
      if (body.valid) checkProduct(body.meta);
      entry.status = body.valid ? ((body.license_key && body.license_key.status) || 'active') : ((body.license_key && body.license_key.status) || 'invalid');
      entry.expiresAt = (body.license_key && body.license_key.expires_at) || entry.expiresAt || null;
      entry.checkedAt = Date.now();
    } catch (error) {
      if (!error.offline) {
        entry.status = 'invalid';
        entry.checkedAt = Date.now();
      }
      // Offline: keep the last answer; licenseActive() allows OFFLINE_GRACE_MS.
    }
    writeJson(LICENSE_KEY, entry);
    notify();
    return entry;
  }

  async function deactivate() {
    const entry = license();
    if (entry && entry.key && entry.instanceId) {
      try {
        await licenseCall('deactivate', { license_key: entry.key, instance_id: entry.instanceId });
      } catch (error) {
        /* still remove locally */
      }
    }
    writeJson(LICENSE_KEY, null);
    notify();
  }

  const listeners = [];
  function notify() {
    listeners.forEach(function (listener) {
      try {
        listener(isPlus());
      } catch (error) {
        /* ignore */
      }
    });
    const badge = document.getElementById('plus-btn');
    if (badge) badge.classList.toggle('is-plus', licenseActive(license()));
  }

  // ---------------------------------------------------------------------------
  // Plus features
  // ---------------------------------------------------------------------------
  function prefs() {
    return Object.assign({ cleanCard: false, cardAccent: '', rate: '', currency: '' }, readJson(PREFS_KEY, {}));
  }

  function savePrefs(next) {
    writeJson(PREFS_KEY, Object.assign(prefs(), next));
  }

  // Used by Studio's share card.
  function cardOptions() {
    if (!isPlus()) return null;
    const current = prefs();
    if (!current.cleanCard && !current.cardAccent) return null;
    return { hideWatermark: !!current.cleanCard, accent: /^#[0-9a-f]{6}$/i.test(current.cardAccent) ? current.cardAccent : '' };
  }

  function currentProject() {
    return (typeof state !== 'undefined' && state.currentProject) || null;
  }

  function trackedHours(project, key) {
    const entry = project && project.timeLog && project.timeLog[key];
    if (!entry) return 0;
    const running = entry.runningSince ? Math.max(0, Math.min(Date.now() - entry.runningSince, 6 * 3600 * 1000)) : 0;
    return ((entry.spentMs || 0) + running) / 3600000;
  }

  function projectTasks(project) {
    const summary = window.SweepStudio.boardSummary(project);
    return summary.tasks.map(function (task) {
      return {
        id: task.id,
        key: task.key,
        phase: task.phase,
        title: task.title,
        status: task.status,
        estimate: task.hours,
        tracked: Math.round(trackedHours(project, task.key) * 100) / 100,
        deps: task.deps || [],
        reqs: task.reqs || [],
        parallel: !!task.parallel
      };
    });
  }

  function csvCell(value) {
    const textValue = String(value == null ? '' : value);
    return /[",\n\r]/.test(textValue) ? '"' + textValue.replace(/"/g, '""') + '"' : textValue;
  }

  function csv(rows) {
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function slugName(value) {
    return String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  }

  function taskDescription(project, task) {
    const lines = [
      task.id + ' · ' + task.phase + ' · ' + t('estimate {hours} h', { hours: task.estimate }),
      task.deps.length ? t('Depends on: {list}', { list: task.deps.join(', ') }) : '',
      task.reqs.length ? t('Covers requirements: {list}', { list: task.reqs.join(', ') }) : '',
      t('Planned with Sweep for "{name}".', { name: project.name })
    ];
    return lines.filter(Boolean).join('\n');
  }

  const STATUS_NAMES = {
    jira: { todo: 'To Do', doing: 'In Progress', done: 'Done' },
    linear: { todo: 'Todo', doing: 'In Progress', done: 'Done' }
  };

  function exportTasks(project, format) {
    const tasks = projectTasks(project);
    const base = slugName(project.name);
    if (format === 'jira') {
      const rows = [['Summary', 'Description', 'Issue Type', 'Status', 'Labels', 'Original Estimate']];
      tasks.forEach(function (task) {
        rows.push([task.title, taskDescription(project, task), 'Task', STATUS_NAMES.jira[task.status] || 'To Do', 'sweep-' + task.phase, Math.round(task.estimate * 3600)]);
      });
      return { filename: base + '-jira.csv', mime: 'text/csv', text: csv(rows) };
    }
    if (format === 'linear') {
      const rows = [['Title', 'Description', 'Status', 'Labels', 'Estimate']];
      tasks.forEach(function (task) {
        rows.push([task.title, taskDescription(project, task), STATUS_NAMES.linear[task.status] || 'Todo', 'Sweep ' + task.phase, task.estimate]);
      });
      return { filename: base + '-linear.csv', mime: 'text/csv', text: csv(rows) };
    }
    if (format === 'github') {
      const quote = function (value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; };
      const phases = tasks.map(function (task) { return task.phase; }).filter(function (phase, index, list) { return list.indexOf(phase) === index; });
      const lines = [
        '#!/usr/bin/env bash',
        '# Creates one GitHub issue per Sweep task. Run inside your repo with the GitHub CLI (gh auth login first).',
        '# Project: ' + project.name.replace(/\n/g, ' '),
        'set -euo pipefail',
        'gh label create sweep --color 8b1a1a --description "Planned with Sweep" --force'
      ];
      phases.forEach(function (phase) {
        lines.push('gh label create ' + quote('sweep:' + phase) + ' --color ededed --force');
      });
      tasks.filter(function (task) { return task.status !== 'done'; }).forEach(function (task) {
        lines.push('gh issue create --title ' + quote('[' + task.id + '] ' + task.title) +
          ' --body ' + quote(taskDescription(project, task)) +
          ' --label sweep --label ' + quote('sweep:' + task.phase));
      });
      return { filename: base + '-github-issues.sh', mime: 'text/x-shellscript', text: lines.join('\n') + '\n' };
    }
    const rows = [['ID', 'Phase', 'Title', 'Status', 'Estimate (h)', 'Tracked (h)', 'Depends on', 'Requirements', 'Parallel']];
    tasks.forEach(function (task) {
      rows.push([task.id, task.phase, task.title, task.status, task.estimate, task.tracked, task.deps.join(' '), task.reqs.join(' '), task.parallel ? 'yes' : '']);
    });
    return { filename: base + '-tasks.csv', mime: 'text/csv', text: csv(rows) };
  }

  function formatMoney(amount, currency) {
    const rounded = Math.round(amount * 100) / 100;
    return (currency ? currency + ' ' : '') + rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function timeReport(project, format, options) {
    const opts = Object.assign({ rate: 0, currency: '' }, options || {});
    const rate = Number(opts.rate) || 0;
    const tasks = projectTasks(project).filter(function (task) { return task.tracked > 0 || task.status === 'done'; });
    const totalTracked = tasks.reduce(function (sum, task) { return sum + task.tracked; }, 0);
    const totalEstimate = tasks.reduce(function (sum, task) { return sum + task.estimate; }, 0);
    const base = slugName(project.name);
    const day = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      const header = ['Task', 'Phase', 'Status', 'Estimate (h)', 'Tracked (h)'];
      if (rate) header.push('Amount' + (opts.currency ? ' (' + opts.currency + ')' : ''));
      const rows = [header];
      tasks.forEach(function (task) {
        const row = [task.id + ' ' + task.title, task.phase, task.status, task.estimate, task.tracked];
        if (rate) row.push(Math.round(task.tracked * rate * 100) / 100);
        rows.push(row);
      });
      const total = ['Total', '', '', Math.round(totalEstimate * 100) / 100, Math.round(totalTracked * 100) / 100];
      if (rate) total.push(Math.round(totalTracked * rate * 100) / 100);
      rows.push(total);
      return { filename: base + '-time-' + day + '.csv', mime: 'text/csv', text: csv(rows) };
    }
    const lines = [
      '# ' + t('Time report — {name}', { name: project.name }),
      '',
      t('Date: {date}', { date: day }) + '  ',
      t('Tracked: {hours} h of {estimate} h estimated', { hours: Math.round(totalTracked * 10) / 10, estimate: Math.round(totalEstimate * 10) / 10 }) +
        (rate ? '  \n' + t('Rate: {rate} per hour · Total: {total}', { rate: formatMoney(rate, opts.currency), total: formatMoney(totalTracked * rate, opts.currency) }) : ''),
      '',
      '| ' + [t('Task'), t('Status'), t('Estimate'), t('Tracked')].concat(rate ? [t('Amount')] : []).join(' | ') + ' |',
      '|' + ' --- |'.repeat(rate ? 5 : 4)
    ];
    tasks.forEach(function (task) {
      const cells = [task.id + ' ' + task.title.replace(/\|/g, '/'), task.status, task.estimate + ' h', task.tracked + ' h'];
      if (rate) cells.push(formatMoney(task.tracked * rate, opts.currency));
      lines.push('| ' + cells.join(' | ') + ' |');
    });
    lines.push('', '_' + t('Generated with Sweep') + '_', '');
    return { filename: base + '-time-' + day + '.md', mime: 'text/markdown', text: lines.join('\n') };
  }

  function download(file) {
    const blob = new Blob([file.text], { type: file.mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const PERKS = [
    ['Export tasks to Jira, Linear or GitHub Issues', 'CSV files for Jira and Linear import, or a ready-to-run gh script that opens one issue per task.'],
    ['Client time report', 'Tracked hours per task as CSV or Markdown, with your hourly rate and total — ready for an invoice.'],
    ['Share card in your colours', 'Remove the “Planned with Sweep” mark and pick your own accent colour.'],
    ['Keep Sweep independent', 'No ads, no tracking, your data stays on your devices. Plus pays for the time that goes into it.']
  ];

  function plansHtml() {
    if (!paywallOn()) {
      return '<p class="settings-note">' + esc(t('Plus is free while Sweep is in beta — enjoy the extra tools below.')) + '</p>';
    }
    const plans = [
      ['monthly', t('Monthly')],
      ['yearly', t('Yearly')],
      ['lifetime', t('Lifetime')]
    ].filter(function (plan) { return config.checkout[plan[0]]; });
    return '<div class="plus-plans">' + plans.map(function (plan) {
      return '<a class="plus-plan' + (plan[0] === 'yearly' ? ' is-featured' : '') + '" href="' + esc(config.checkout[plan[0]]) + '" target="_blank" rel="noopener" data-plus-plan="' + plan[0] + '">' +
        '<span class="plus-plan-name">' + esc(plan[1]) + '</span>' +
        '<span class="plus-plan-price" data-no-i18n>' + esc(config.prices[plan[0]] || '') + '</span>' +
        '<span class="plus-plan-cta">' + esc(t('Get Plus')) + ' ↗</span></a>';
    }).join('') + '</div>' +
    '<p class="settings-note small">' + esc(t('Secure checkout by Lemon Squeezy (cards, PayPal and local methods). Your licence key arrives by email — paste it below.')) + '</p>';
  }

  function licenseHtml() {
    const entry = license();
    const active = licenseActive(entry);
    if (active) {
      return '<div class="settings-actions"><span class="settings-status ok">✓ ' + esc(statusLabel()) + '</span>' +
        '<button type="button" class="btn btn-text btn-sm" data-plus="deactivate">' + esc(t('Remove from this device')) + '</button></div>';
    }
    return '<label class="settings-field"><span>' + esc(t('Licence key')) + '</span>' +
      '<span class="input-with-button"><input type="text" id="plus-key" autocomplete="off" spellcheck="false" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" data-no-i18n value="' + esc(entry && entry.key ? entry.key : '') + '">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-plus="activate">' + esc(t('Activate')) + '</button></span></label>' +
      '<p class="settings-status" id="plus-status" role="status">' + (entry && entry.key ? esc(statusLabel()) : '') + '</p>';
  }

  function tipsHtml() {
    const links = [
      ['trakteer', 'Trakteer', t('Indonesia · GoPay, OVO, DANA, bank')],
      ['saweria', 'Saweria', t('Indonesia · QRIS, e-wallets')],
      ['kofi', 'Ko-fi', t('Worldwide · card, PayPal')],
      ['githubSponsors', 'GitHub Sponsors', t('Worldwide · monthly or one-time')]
    ].filter(function (link) { return config.tips[link[0]]; });
    if (!links.length) return '';
    return '<h3>' + esc(t('Prefer a one-time tip?')) + '</h3>' +
      '<div class="plus-tips">' + links.map(function (link) {
        return '<a class="plus-tip" href="' + esc(config.tips[link[0]]) + '" target="_blank" rel="noopener"><b data-no-i18n>' + esc(link[1]) + '</b><span>' + esc(link[2]) + '</span></a>';
      }).join('') + '</div>';
  }

  function toolsHtml() {
    const project = currentProject();
    const locked = !isPlus();
    const lock = locked ? ' 🔒' : '';
    const current = prefs();
    if (!project) {
      return '<p class="settings-note">' + esc(t('Open a project to use the Plus tools.')) + '</p>';
    }
    return '<h3>' + esc(t('Tools for “{name}”', { name: project.name })) + '</h3>' +
      '<div class="plus-tools">' +
        '<div class="plus-tool"><b>' + esc(t('Export tasks')) + lock + '</b><div class="settings-actions">' +
          ['jira', 'linear', 'github', 'csv'].map(function (format) {
            const label = { jira: 'Jira CSV', linear: 'Linear CSV', github: t('GitHub Issues script'), csv: t('Plain CSV') }[format];
            return '<button type="button" class="btn btn-secondary btn-sm" data-plus="export" data-format="' + format + '">' + esc(label) + '</button>';
          }).join('') +
        '</div></div>' +
        '<div class="plus-tool"><b>' + esc(t('Client time report')) + lock + '</b>' +
          '<div class="plus-inline">' +
            '<label class="settings-field"><span>' + esc(t('Hourly rate (optional)')) + '</span><input type="number" id="plus-rate" min="0" step="any" inputmode="decimal" value="' + esc(current.rate) + '"></label>' +
            '<label class="settings-field"><span>' + esc(t('Currency')) + '</span><input type="text" id="plus-currency" maxlength="6" placeholder="IDR" data-no-i18n value="' + esc(current.currency) + '"></label>' +
          '</div>' +
          '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-plus="time" data-format="csv">CSV</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-plus="time" data-format="md">Markdown</button></div></div>' +
        '<div class="plus-tool"><b>' + esc(t('Share card')) + lock + '</b>' +
          '<label class="settings-check"><input type="checkbox" id="plus-clean-card"' + (current.cleanCard ? ' checked' : '') + '> ' + esc(t('Hide “Planned with Sweep”')) + '</label>' +
          '<label class="settings-field plus-color"><span>' + esc(t('Accent colour')) + '</span><input type="color" id="plus-accent" value="' + esc(/^#[0-9a-f]{6}$/i.test(current.cardAccent) ? current.cardAccent : '#8b1a1a') + '"></label>' +
          '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-plus="card-save">' + esc(t('Save card style')) + '</button>' +
          '<button type="button" class="btn btn-text btn-sm" data-plus="card-reset">' + esc(t('Reset')) + '</button></div></div>' +
      '</div>';
  }

  function modalHtml() {
    return '<div class="studio-modal-card settings-card plus-card">' +
      '<button type="button" class="studio-modal-close" data-plus="close" aria-label="' + esc(t('Close')) + '">×</button>' +
      '<h2 id="plus-title">Sweep Plus <span class="plus-pill' + (licenseActive(license()) ? ' ok' : '') + '">' + esc(statusLabel()) + '</span></h2>' +
      '<ul class="plus-perks">' + PERKS.map(function (perk) {
        return '<li><b>' + esc(t(perk[0])) + '</b><span>' + esc(t(perk[1])) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="settings-note">' + esc(t('Everything you use today stays free. Plus adds extra tools.')) + '</p>' +
      plansHtml() +
      (paywallOn() || license() ? licenseHtml() : '') +
      toolsHtml() +
      tipsHtml() +
      (config.teamEmail
        ? '<p class="settings-note">' + esc(t('Using Sweep with a team?')) + ' <a href="mailto:' + esc(config.teamEmail) + '?subject=Sweep%20for%20teams">' + esc(t('Get in touch')) + '</a></p>'
        : '') +
    '</div>';
  }

  let returnFocus = null;

  function openPlus(focusSelector) {
    let modal = document.getElementById('plus-modal');
    if (!modal) {
      returnFocus = document.activeElement;
      modal = document.createElement('div');
      modal.id = 'plus-modal';
      modal.className = 'studio-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'plus-title');
      document.body.appendChild(modal);
      document.body.classList.add('studio-modal-open');
      modal.addEventListener('click', onClick);
      modal.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closePlus();
        if (event.key === 'Enter' && event.target && event.target.id === 'plus-key') activateFromForm();
      });
    }
    modal.innerHTML = modalHtml();
    if (window.SweepI18n && window.SweepI18n.translateDom) window.SweepI18n.translateDom(modal);
    const target = (focusSelector && modal.querySelector(focusSelector)) || modal.querySelector('.studio-modal-close');
    if (target) target.focus();
  }

  function closePlus() {
    const modal = document.getElementById('plus-modal');
    if (!modal) return;
    modal.remove();
    if (!document.querySelector('.studio-modal')) document.body.classList.remove('studio-modal-open');
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  function setStatus(message, kind) {
    const node = document.getElementById('plus-status');
    if (!node) return;
    node.textContent = message;
    node.className = 'settings-status' + (kind ? ' ' + kind : '');
  }

  async function activateFromForm() {
    const field = document.getElementById('plus-key');
    const button = document.querySelector('[data-plus="activate"]');
    if (!field) return;
    if (button) button.disabled = true;
    setStatus(t('Checking your key…'));
    try {
      await activate(field.value);
      toast(t('Thank you! Sweep Plus is active.'));
      openPlus();
    } catch (error) {
      setStatus('✗ ' + error.message, 'error');
      if (button) button.disabled = false;
    }
  }

  function requirePlus() {
    if (isPlus()) return true;
    openPlus('.plus-plan');
    toast(t('This is a Sweep Plus tool.'));
    return false;
  }

  async function onClick(event) {
    const modal = document.getElementById('plus-modal');
    const action = event.target.closest('[data-plus]');
    if (event.target === modal) {
      closePlus();
      return;
    }
    if (!action) return;
    const name = action.getAttribute('data-plus');
    const project = currentProject();
    if (name === 'close') closePlus();
    if (name === 'activate') activateFromForm();
    if (name === 'deactivate') {
      await deactivate();
      toast(t('Plus removed from this device.'));
      openPlus();
    }
    if (name === 'export' && project && requirePlus()) {
      download(exportTasks(project, action.getAttribute('data-format')));
    }
    if (name === 'time' && project && requirePlus()) {
      const rate = document.getElementById('plus-rate');
      const currency = document.getElementById('plus-currency');
      savePrefs({ rate: rate ? rate.value : '', currency: currency ? currency.value.trim() : '' });
      download(timeReport(project, action.getAttribute('data-format'), { rate: rate ? rate.value : 0, currency: currency ? currency.value.trim() : '' }));
    }
    if (name === 'card-save' && requirePlus()) {
      const clean = document.getElementById('plus-clean-card');
      const accent = document.getElementById('plus-accent');
      savePrefs({ cleanCard: !!(clean && clean.checked), cardAccent: accent ? accent.value : '' });
      toast(t('Card style saved — open Share to see it.'));
    }
    if (name === 'card-reset') {
      savePrefs({ cleanCard: false, cardAccent: '' });
      openPlus();
    }
  }

  function headerButton() {
    if (document.getElementById('plus-btn')) return;
    const anchor = document.getElementById('settings-btn') || document.getElementById('theme-toggle');
    if (!anchor || !anchor.parentNode) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'plus-btn';
    button.className = 'icon-btn plus-btn';
    button.setAttribute('aria-label', 'Sweep Plus');
    button.setAttribute('title', 'Sweep Plus');
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>';
    button.addEventListener('click', function () { openPlus(); });
    anchor.parentNode.insertBefore(button, anchor);
    notify();
  }

  function init() {
    // pro.js adds the settings button on DOMContentLoaded; place ours next to it.
    setTimeout(headerButton, 0);
    setTimeout(headerButton, 600);
    if (license()) {
      setTimeout(function () { revalidate(false); }, 2500);
    }
  }

  window.SweepPlus = {
    config: config,
    isPlus: isPlus,
    paywallOn: paywallOn,
    license: license,
    activate: activate,
    revalidate: revalidate,
    deactivate: deactivate,
    open: openPlus,
    close: closePlus,
    cardOptions: cardOptions,
    exportTasks: exportTasks,
    timeReport: timeReport,
    onChange: function (listener) { listeners.push(listener); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
