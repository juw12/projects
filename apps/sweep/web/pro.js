/* Sweep Pro — Settings (language, AI assist, cross-device sync).
 *
 * AI assist: optional. A free keyless provider (Pollinations, shared + rate-limited) or the
 * user's own key for OpenRouter, OpenAI, Anthropic, Groq or any OpenAI-compatible endpoint.
 * Calls go straight from the browser to the chosen provider; Sweep has no server.
 *
 * Sync: the workspace is encrypted in the browser (PBKDF2 → AES-GCM) with a sync passphrase,
 * then stored in a private GitHub Gist owned by the user. Projects merge by id; the newest
 * edit wins and deletions travel as tombstones.
 */
(function () {
  'use strict';

  const t = function (text, vars) {
    return window.SweepI18n ? window.SweepI18n.t(text, vars) : text;
  };

  // ---------- small helpers ----------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false; /* storage full or unavailable */
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function timeAgo(timestamp) {
    if (!timestamp) return t('Never synced');
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    const lang = window.SweepI18n ? window.SweepI18n.getLanguage() : 'en';
    try {
      const formatter = new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-Hans' : lang, { numeric: 'auto' });
      if (seconds < 60) return formatter.format(-seconds, 'second');
      if (seconds < 3600) return formatter.format(-Math.round(seconds / 60), 'minute');
      if (seconds < 86400) return formatter.format(-Math.round(seconds / 3600), 'hour');
      return formatter.format(-Math.round(seconds / 86400), 'day');
    } catch (error) {
      return Math.round(seconds / 60) + ' min ago';
    }
  }

  // =====================================================================
  // AI assist
  // =====================================================================
  const AI_SETTINGS_KEY = 'sweep_ai_v1';
  const AI_KEY_KEY = 'sweep_ai_key_v1';
  const PROVIDERS = {
    free: { label: 'Free (no key, shared & rate-limited)', base: 'https://text.pollinations.ai/openai', model: 'openai-fast', kind: 'openai', keyless: true },
    openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', kind: 'openai', keyUrl: 'https://openrouter.ai/keys' },
    openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini', kind: 'openai', keyUrl: 'https://platform.openai.com/api-keys' },
    anthropic: { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5', kind: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
    groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', kind: 'openai', keyUrl: 'https://console.groq.com/keys' },
    custom: { label: 'Custom (OpenAI-compatible)', base: '', model: '', kind: 'openai' }
  };

  function aiSettings() {
    const saved = readJson(localStorage, AI_SETTINGS_KEY, {});
    const provider = PROVIDERS[saved.provider] ? saved.provider : 'free';
    return {
      provider: provider,
      model: saved.model || PROVIDERS[provider].model,
      base: saved.base || '',
      remember: saved.remember !== false
    };
  }

  function aiKey() {
    try {
      return localStorage.getItem(AI_KEY_KEY) || sessionStorage.getItem(AI_KEY_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function saveAiSettings(next, key) {
    writeJson(localStorage, AI_SETTINGS_KEY, {
      provider: next.provider,
      model: next.model,
      base: next.base,
      remember: next.remember
    });
    try {
      localStorage.removeItem(AI_KEY_KEY);
      sessionStorage.removeItem(AI_KEY_KEY);
      if (key) (next.remember ? localStorage : sessionStorage).setItem(AI_KEY_KEY, key);
    } catch (error) {
      /* storage unavailable */
    }
  }

  function aiReady() {
    const settings = aiSettings();
    const provider = PROVIDERS[settings.provider];
    if (provider.keyless) return true;
    if (settings.provider === 'custom' && !settings.base) return false;
    return !!aiKey() || settings.provider === 'custom';
  }

  function friendlyAiError(status, detail) {
    if (status === 401 || status === 403) return 'The provider rejected the API key (' + status + ').';
    if (status === 404) return 'Model or endpoint not found (404). Check the model name in Settings.';
    if (status === 429) return 'The provider is rate-limiting requests (429). Wait a moment and try again.';
    if (status === 402) return 'The free quota is used up for now (402). Wait a moment, or add your own key in Settings.';
    if (status >= 500) return 'The provider had an error (' + status + '). Try again shortly.';
    return 'Request failed (' + status + '). ' + String(detail || '').slice(0, 160);
  }

  const activeAiControllers = new Set();

  // Keyless endpoints tried in order when the free tier is busy (429/5xx/network/empty).
  // All are OpenAI-compatible and send CORS headers, so the browser can call them directly.
  const FREE_CHAIN = [
    { base: 'https://text.pollinations.ai/openai', model: 'openai-fast', name: 'Pollinations' },
    { base: 'https://api.llm7.io/v1', model: 'default', name: 'LLM7' },
    { base: 'https://text.pollinations.ai/openai', model: 'openai', name: 'Pollinations' }
  ];
  // A free service that said "slow down" (402/429) is skipped for a while instead of retried.
  const FREE_COOLDOWN_MS = 30000;
  const FREE_ATTEMPT_MS = 60000;
  const freeCooldown = {};
  const AI_CACHE_KEY = 'sweep_ai_cache_v1';
  const AI_CACHE_LIMIT = 40;
  const AI_CACHE_TTL = 24 * 3600 * 1000;
  let freeQueue = Promise.resolve();
  let lastFreeCall = 0;
  const FREE_SPACING_MS = 1200;

  function quickHash(textValue) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < textValue.length; i++) {
      const code = textValue.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  function cachedAnswer(key) {
    const cache = readJson(localStorage, AI_CACHE_KEY, {});
    const hit = cache[key];
    if (!hit || Date.now() - hit.at > AI_CACHE_TTL) return null;
    return hit.text;
  }

  function rememberAnswer(key, textValue) {
    const cache = readJson(localStorage, AI_CACHE_KEY, {});
    cache[key] = { at: Date.now(), text: textValue };
    const keys = Object.keys(cache).sort(function (a, b) { return cache[b].at - cache[a].at; });
    keys.slice(AI_CACHE_LIMIT).forEach(function (old) { delete cache[old]; });
    if (!writeJson(localStorage, AI_CACHE_KEY, cache)) {
      writeJson(localStorage, AI_CACHE_KEY, {});
    }
  }

  // Shared free endpoints allow roughly one request at a time per visitor, so free calls
  // are serialized and spaced instead of firing in parallel and getting 429s.
  function enqueueFree(task) {
    const run = freeQueue.then(async function () {
      const wait = lastFreeCall + FREE_SPACING_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        lastFreeCall = Date.now();
      }
    });
    freeQueue = run.catch(function () { /* keep the queue alive */ });
    return run;
  }

  function buildRequest(kind, base, model, key, providerId, options) {
    if (kind === 'anthropic') {
      return {
        url: base + '/messages',
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: model,
            max_tokens: options.maxTokens || 2400,
            system: options.system,
            messages: [{ role: 'user', content: options.user }]
          })
        }
      };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = location.origin;
      headers['X-Title'] = 'Sweep';
    }
    return {
      url: base + '/chat/completions',
      init: {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user }
          ]
        })
      }
    };
  }

  function readAnswer(kind, data) {
    return kind === 'anthropic'
      ? (data.content || []).map(function (part) { return part.text || ''; }).join('')
      : (((data.choices || [])[0] || {}).message || {}).content || '';
  }

  // One endpoint, up to `attempts` tries with backoff on 429/5xx. Errors carry .retryable
  // so the free chain knows when moving to the next endpoint makes sense.
  async function callEndpoint(request, kind, signal, attempts, attemptMs) {
    // Each endpoint gets its own time budget so one stalled free service cannot eat the whole
    // request; a per-attempt timeout is "retryable" (try the next service), a user cancel is not.
    let attemptTimedOut = false;
    let attemptTimer = null;
    let fetchSignal = signal;
    if (attemptMs) {
      const attemptController = new AbortController();
      const forward = function () { attemptController.abort(); };
      if (signal.aborted) attemptController.abort();
      else signal.addEventListener('abort', forward, { once: true });
      attemptTimer = setTimeout(function () {
        attemptTimedOut = true;
        attemptController.abort();
      }, attemptMs);
      fetchSignal = attemptController.signal;
    }
    try {
      return await callEndpointOnce(request, kind, fetchSignal, attempts);
    } catch (error) {
      if (error.name === 'AbortError' && attemptTimedOut && !signal.aborted) {
        const slow = new Error(t('The AI request timed out.'));
        slow.retryable = true;
        throw slow;
      }
      throw error;
    } finally {
      clearTimeout(attemptTimer);
    }
  }

  async function callEndpointOnce(request, kind, signal, attempts) {
    let response;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        response = await fetch(request.url, Object.assign({}, request.init, { signal: signal }));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (attempt === attempts - 1) {
          const network = new Error(t('Could not reach the AI service. Check your connection.'));
          network.retryable = true;
          throw network;
        }
        await sleep(1200 * Math.pow(2, attempt));
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts - 1) break;
      const header = Number(response.headers.get('retry-after'));
      const wait = Number.isFinite(header) && header > 0 ? Math.min(header, 10) * 1000 : 1500 * Math.pow(2, attempt);
      await sleep(wait);
    }
    if (!response.ok) {
      const detail = await response.text().catch(function () { return ''; });
      const failure = new Error(friendlyAiError(response.status, detail));
      failure.status = response.status;
      failure.retryable = [400, 402, 404, 408, 413, 429].indexOf(response.status) !== -1 || response.status >= 500;
      failure.rateLimited = response.status === 402 || response.status === 429;
      throw failure;
    }
    const data = await response.json();
    const textOut = String(readAnswer(kind, data) || '');
    if (!textOut.trim()) {
      const empty = new Error(t('The model returned an empty answer.'));
      empty.retryable = true;
      throw empty;
    }
    return textOut;
  }

  async function aiComplete(options) {
    const settings = aiSettings();
    const provider = PROVIDERS[settings.provider];
    const key = aiKey();
    const base = (settings.provider === 'custom' ? settings.base : provider.base).replace(/\/$/, '');
    const model = settings.model || provider.model;
    if (!provider.keyless && settings.provider !== 'custom' && !key) throw new Error(t('Set up AI in Settings first'));
    if (!base) throw new Error(t('Set up AI in Settings first'));

    const cacheKey = options.cache === false ? '' : quickHash(settings.provider + '|' + model + '|' + options.system + '|' + options.user);
    if (cacheKey) {
      const hit = cachedAnswer(cacheKey);
      if (hit) return hit;
    }

    const controller = new AbortController();
    activeAiControllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs || 180000);

    try {
      let answer;
      if (provider.keyless) {
        // Free tier: the user's chosen model first, then the rest of the keyless chain.
        const chain = [{ base: base, model: model, name: 'Pollinations' }].concat(FREE_CHAIN.filter(function (entry) {
          return !(entry.base === base && entry.model === model);
        }));
        answer = await enqueueFree(async function () {
          let lastError = null;
          const now = Date.now();
          const ready = chain.filter(function (entry) { return !(freeCooldown[entry.base] > now); });
          const order = ready.length ? ready : chain;
          for (let index = 0; index < order.length; index++) {
            const entry = order[index];
            try {
              const request = buildRequest('openai', entry.base, entry.model, '', 'free', options);
              const textOut = await callEndpoint(request, 'openai', controller.signal, 1, FREE_ATTEMPT_MS);
              if (entry !== chain[0]) notifyAiFallback(entry.name);
              return textOut;
            } catch (error) {
              if (error.name === 'AbortError' || !error.retryable) throw error;
              if (error.rateLimited) freeCooldown[entry.base] = Date.now() + FREE_COOLDOWN_MS;
              lastError = error;
            }
          }
          const busy = new Error(t('All free AI services are busy right now. Try again in a minute, or add your own free key (Groq or OpenRouter) in Settings → AI.'));
          busy.cause = lastError;
          throw busy;
        });
      } else {
        const request = buildRequest(provider.kind, base, model, key, settings.provider, options);
        answer = await callEndpoint(request, provider.kind, controller.signal, 3);
      }
      if (cacheKey) rememberAnswer(cacheKey, answer);
      return answer;
    } catch (error) {
      if (error.name === 'AbortError') {
        const cancelled = new Error(timedOut ? t('The AI request timed out.') : t('Cancelled'));
        cancelled.cancelled = !timedOut;
        throw cancelled;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      activeAiControllers.delete(controller);
    }
  }

  let fallbackNoticeAt = 0;
  function notifyAiFallback(name) {
    if (Date.now() - fallbackNoticeAt < 60000) return;
    fallbackNoticeAt = Date.now();
    toast(t('Main free AI was busy — answered by {name} instead', { name: name }));
  }

  function cancelAi() {
    activeAiControllers.forEach(function (controller) {
      controller.abort();
    });
  }

  function stripFences(textValue) {
    const value = String(textValue || '').trim();
    const fenced = value.match(/^```[a-zA-Z0-9-]*\n([\s\S]*?)\n```$/);
    return fenced ? fenced[1].trim() : value;
  }

  function extractJson(textValue) {
    const cleaned = stripFences(textValue);
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error('The AI answer was not valid JSON.');
    }
  }

  function languageInstruction() {
    return 'Write in the same language as the brief (if the brief mixes languages, use the language of the problem statement).';
  }

  async function sharpenBrief(project, issues) {
    const brief = {
      name: project.name,
      oneLiner: project.oneLiner,
      problem: project.problem,
      targetUser: project.targetUser,
      jtbd: project.jtbd,
      successChecks: project.successChecks || [],
      nonGoals: project.nonGoals,
      overlap: project.overlap
    };
    const system = [
      'You are a senior product manager who writes small, testable app briefs for indie builders.',
      'Improve the brief so it scores higher on clarity, testability, scope and user focus.',
      'Rules: keep the product idea and name; do not add big new features; be concrete and short.',
      'successChecks: 3-5 items, each an action plus a visible result a stranger can verify in a minute.',
      'jtbd must follow "When ..., I want ..., so I can ..." (or the natural equivalent in the brief\'s language).',
      'targetUser: a specific group with a qualifier. nonGoals: 2-4 items separated by "; ". overlap: name real alternatives people use today and how this differs.',
      languageInstruction(),
      'Reply with ONLY a JSON object with keys: oneLiner, problem, targetUser, jtbd, successChecks (array of strings), nonGoals, overlap.'
    ].join('\n');
    const user = 'Current brief (JSON):\n' + JSON.stringify(brief, null, 2) +
      '\n\nSpec Score issues to fix:\n' + (issues.length ? issues.map(function (issue) { return '- ' + issue; }).join('\n') : '- none, just tighten wording');
    const answer = await aiComplete({ system: system, user: user, maxTokens: 1600 });
    const parsed = extractJson(answer);
    const out = {};
    ['oneLiner', 'problem', 'targetUser', 'jtbd', 'nonGoals', 'overlap'].forEach(function (field) {
      if (typeof parsed[field] === 'string' && parsed[field].trim()) out[field] = parsed[field].trim().slice(0, 2000);
    });
    if (Array.isArray(parsed.successChecks)) {
      const checks = parsed.successChecks.map(function (item) { return String(item).trim(); }).filter(Boolean).slice(0, 6);
      if (checks.length) out.successChecks = checks;
    }
    if (!Object.keys(out).length) throw new Error('The AI answer had no usable fields.');
    return out;
  }

  async function improveSpecFile(project, filename, content) {
    const system = [
      'You are a senior product engineer improving a spec file that an AI coding agent will follow.',
      'Make it more specific, testable and unambiguous. Keep the same file purpose, structure and headings.',
      filename === 'specs/requirements.md'
        ? 'Keep EARS acceptance criteria ("WHEN ... THEN THE SYSTEM SHALL ...", "IF ... THEN THE SYSTEM SHALL ..."), add missing edge cases and error states.'
        : 'Keep task ids, dependencies and [P] markers if present.',
      'Do not invent features beyond the brief; non-goals stay out of scope. Stay concise.',
      languageInstruction(),
      'Reply with ONLY the complete improved file content, no commentary and no code fences.'
    ].join('\n');
    const user = 'Brief: ' + project.name + ' — ' + (project.oneLiner || '') +
      '\nTarget user: ' + (project.targetUser || '') +
      '\nNon-goals: ' + (project.nonGoals || '') +
      '\n\nFile: ' + filename + '\n---\n' + content;
    const answer = await aiComplete({ system: system, user: user, maxTokens: 3200 });
    return stripFences(answer);
  }


  const LANGUAGE_NAMES = { en: 'English', zh: 'Simplified Chinese (简体中文)', id: 'Bahasa Indonesia' };

  // Translates one generated spec file for people who read the plan in another language.
  // Structure the AI builder depends on (headings, ids like R1/T3, EARS keywords, code,
  // file paths, commands, [P] markers, checkboxes) is kept exactly.
  async function translateSpecFile(filename, content, lang) {
    const target = LANGUAGE_NAMES[lang] || lang;
    const system = [
      'You translate software specification files into ' + target + '.',
      'Translate prose, headings and list items. Keep Markdown structure, line breaks and checkbox syntax exactly.',
      'Do NOT translate: code blocks, inline code, file paths, URLs, shell commands, ids such as R1, T3, AC-2, [P] markers,',
      'or the EARS keywords WHEN / IF / WHILE / WHERE / THEN THE SYSTEM SHALL (keep those in English capitals so agents can parse them).',
      'Keep product names and brand names unchanged.',
      'Reply with ONLY the translated file content, no commentary and no code fences around the whole answer.'
    ].join('\n');
    const answer = await aiComplete({ system: system, user: 'File: ' + filename + '\n---\n' + content, maxTokens: 4000 });
    return stripFences(answer);
  }

  // =====================================================================
  // Sync (encrypted GitHub Gist)
  // =====================================================================
  const SYNC_SETTINGS_KEY = 'sweep_sync_v1';
  const SYNC_SECRET_KEY = 'sweep_sync_secret_v1';
  const TOMBSTONE_KEY = 'sweep_tombstones_v1';
  const BASE_KEY = 'sweep_sync_base_v1';
  const GIST_FILE = 'sweep-sync.json';
  const GIST_DESCRIPTION = 'Sweep sync (encrypted)';
  const GITHUB_API = 'https://api.github.com';
  const PBKDF2_ITERATIONS = 250000;

  function syncSettings() {
    return readJson(localStorage, SYNC_SETTINGS_KEY, { gistId: '', auto: true, lastSync: 0, remember: true });
  }

  function saveSyncSettings(settings) {
    writeJson(localStorage, SYNC_SETTINGS_KEY, settings);
  }

  function syncSecrets() {
    return readJson(localStorage, SYNC_SECRET_KEY, null) || readJson(sessionStorage, SYNC_SECRET_KEY, { token: '', passphrase: '' });
  }

  function saveSyncSecrets(secrets, remember) {
    try {
      localStorage.removeItem(SYNC_SECRET_KEY);
      sessionStorage.removeItem(SYNC_SECRET_KEY);
    } catch (error) {
      /* storage unavailable */
    }
    if (secrets.token || secrets.passphrase) writeJson(remember ? localStorage : sessionStorage, SYNC_SECRET_KEY, secrets);
  }

  function syncConfigured() {
    const secrets = syncSecrets();
    return !!(secrets.token && secrets.passphrase);
  }

  function toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(passphrase, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptPayload(object, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(object)));
    return JSON.stringify({
      v: 1,
      app: 'sweep',
      kdf: 'PBKDF2-SHA256-' + PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(cipher))
    });
  }

  async function decryptPayload(textValue, passphrase) {
    const envelope = JSON.parse(textValue);
    if (!envelope || envelope.app !== 'sweep' || envelope.v !== 1) throw new Error('Not a Sweep sync file');
    const key = await deriveKey(passphrase, fromBase64(envelope.salt));
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (error) {
      throw new Error(t('Wrong sync passphrase for this gist'));
    }
  }

  async function github(path, options) {
    const secrets = syncSecrets();
    const init = Object.assign({ method: 'GET' }, options || {});
    init.headers = Object.assign({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + secrets.token,
      'X-GitHub-Api-Version': '2022-11-28'
    }, init.body ? { 'Content-Type': 'application/json' } : {});
    const response = await fetch(GITHUB_API + path, init);
    if (response.status === 401) throw new Error('GitHub rejected the token (401).');
    if (response.status === 403) throw new Error('The token lacks the Gists permission, or GitHub is rate-limiting (403).');
    if (!response.ok && response.status !== 404) throw new Error('GitHub error ' + response.status);
    return response;
  }

  async function findGist() {
    const settings = syncSettings();
    if (settings.gistId) {
      const response = await github('/gists/' + settings.gistId);
      if (response.ok) return response.json();
    }
    const listResponse = await github('/gists?per_page=100');
    if (!listResponse.ok) return null;
    const list = await listResponse.json();
    const match = (list || []).find(function (gist) {
      return gist.description === GIST_DESCRIPTION && gist.files && gist.files[GIST_FILE];
    });
    if (!match) return null;
    const full = await github('/gists/' + match.id);
    return full.ok ? full.json() : null;
  }

  async function gistContent(gist) {
    const file = gist.files && gist.files[GIST_FILE];
    if (!file) return null;
    if (file.truncated && file.raw_url) {
      const raw = await fetch(file.raw_url);
      return raw.text();
    }
    return file.content;
  }

  // ----- change tracking: updatedAt stamps + tombstones -----
  const fingerprints = new Map();
  let knownIds = null;

  function projectFingerprint(project) {
    const copy = Object.assign({}, project);
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }

  function tombstones() {
    return readJson(localStorage, TOMBSTONE_KEY, {});
  }

  // Short content hash per project, remembered at each successful sync. Comparing both sides
  // against it tells "only one device edited" (safe to take the newer) from "both edited"
  // (a real conflict: keep both versions instead of silently dropping one).
  function contentHash(project) {
    const text = projectFingerprint(project);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  }

  function syncBase() {
    return readJson(localStorage, BASE_KEY, {});
  }

  function conflictCopy(project, stamp) {
    const copy = JSON.parse(JSON.stringify(project));
    copy.id = 'p' + stamp.toString(36) + Math.random().toString(36).slice(2, 8);
    copy.name = (project.name || t('Untitled')) + ' (' + t('conflict copy') + ')';
    copy.conflictOf = project.id;
    copy.updatedAt = stamp;
    return copy;
  }

  function trackChanges() {
    if (typeof state === 'undefined' || !Array.isArray(state.projects)) return;
    const now = Date.now();
    const currentIds = new Set();
    state.projects.forEach(function (project) {
      if (!project || !project.id) return;
      currentIds.add(project.id);
      const print = projectFingerprint(project);
      const previous = fingerprints.get(project.id);
      if (previous !== undefined && previous !== print) project.updatedAt = now;
      if (previous === undefined && !project.updatedAt) project.updatedAt = Date.parse(project.createdAt || '') || now;
      fingerprints.set(project.id, print);
    });
    if (knownIds) {
      const stones = tombstones();
      let changed = false;
      knownIds.forEach(function (id) {
        if (!currentIds.has(id)) {
          stones[id] = now;
          fingerprints.delete(id);
          changed = true;
        }
      });
      if (changed) writeJson(localStorage, TOMBSTONE_KEY, stones);
    }
    knownIds = currentIds;
  }

  // ----- three-way merge -----
  // The last synced workspace is kept per device as a snapshot (the common ancestor). When both
  // devices edited the same project, every field is merged against that ancestor: changes on
  // only one side are taken automatically, lists merge item by item, and only a field changed
  // differently on both sides counts as a clash (the newer edit wins, the other is offered in
  // the review dialog so nothing is lost).
  const SNAPSHOT_KEY = 'sweep_sync_snapshot_v1';
  const PENDING_KEY = 'sweep_sync_conflicts_v1';

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function same(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function hasIds(list) {
    return Array.isArray(list) && list.length > 0 && list.every(function (item) {
      return isPlainObject(item) && (typeof item.id === 'string' || typeof item.id === 'number');
    });
  }

  function idArrays(mine, theirs, base) {
    const lists = [mine, theirs, base].filter(function (list) { return Array.isArray(list) && list.length; });
    return lists.length > 0 && lists.every(hasIds);
  }

  function itemLabel(item) {
    if (!isPlainObject(item)) return '';
    return String(item.title || item.name || item.label || item.text || item.id || '').slice(0, 60);
  }

  function mergeValue(base, mine, theirs, path, labels, clashes, preferMine) {
    if (same(mine, theirs)) return clone(mine);
    if (same(base, mine)) return clone(theirs);
    if (same(base, theirs)) return clone(mine);
    if (isPlainObject(mine) && isPlainObject(theirs)) {
      const ancestor = isPlainObject(base) ? base : {};
      const keys = Object.keys(mine).concat(Object.keys(theirs).filter(function (key) { return !(key in mine); }));
      const result = {};
      keys.forEach(function (key) {
        if (key === 'updatedAt') return;
        const value = mergeValue(ancestor[key], mine[key], theirs[key], path.concat(key), labels.concat(key), clashes, preferMine);
        if (value !== undefined) result[key] = value;
      });
      return result;
    }
    if (Array.isArray(mine) && Array.isArray(theirs)) {
      const ancestorList = Array.isArray(base) ? base : [];
      if (idArrays(mine, theirs, ancestorList)) return mergeById(ancestorList, mine, theirs, path, labels, clashes, preferMine);
      return mergeList(ancestorList, mine, theirs);
    }
    clashes.push({ path: path, labels: labels, local: clone(mine), remote: clone(theirs), kept: preferMine ? 'local' : 'remote' });
    return clone(preferMine ? mine : theirs);
  }

  function mergeById(base, mine, theirs, path, labels, clashes, preferMine) {
    const index = function (list) {
      const map = {};
      list.forEach(function (item) { map[String(item.id)] = item; });
      return map;
    };
    const baseMap = index(base);
    const mineMap = index(mine);
    const theirMap = index(theirs);
    const order = mine.map(function (item) { return String(item.id); });
    theirs.forEach(function (item) {
      if (!(String(item.id) in mineMap)) order.push(String(item.id));
    });
    const result = [];
    order.forEach(function (id) {
      const inMine = id in mineMap;
      const inTheirs = id in theirMap;
      const inBase = id in baseMap;
      if (inMine && inTheirs) {
        const label = itemLabel(mineMap[id]) || itemLabel(theirMap[id]) || id;
        result.push(mergeValue(baseMap[id], mineMap[id], theirMap[id], path.concat('#' + id), labels.concat(label), clashes, preferMine));
        return;
      }
      const present = inMine ? mineMap[id] : theirMap[id];
      // Removed on the other device: drop it only if this side left it untouched.
      if (inBase && same(baseMap[id], present)) return;
      result.push(clone(present));
    });
    return result;
  }

  function mergeList(base, mine, theirs) {
    const key = function (item) { return JSON.stringify(item); };
    const baseKeys = new Set(base.map(key));
    const mineKeys = new Set(mine.map(key));
    const theirKeys = new Set(theirs.map(key));
    const kept = mine.filter(function (item) {
      const k = key(item);
      return theirKeys.has(k) || !baseKeys.has(k);
    });
    const added = theirs.filter(function (item) {
      const k = key(item);
      return !baseKeys.has(k) && !mineKeys.has(k);
    });
    return clone(kept.concat(added));
  }

  function mergeProject(base, mine, theirs) {
    const clashes = [];
    const preferMine = (mine.updatedAt || 0) >= (theirs.updatedAt || 0);
    const merged = mergeValue(base, mine, theirs, [], [], clashes, preferMine);
    merged.id = mine.id;
    merged.updatedAt = Math.max(mine.updatedAt || 0, theirs.updatedAt || 0, Date.now());
    return { project: merged, clashes: clashes };
  }

  function syncSnapshot() {
    return readJson(localStorage, SNAPSHOT_KEY, {});
  }

  function saveSnapshot(projects) {
    const snapshot = {};
    projects.forEach(function (project) {
      snapshot[project.id] = project;
    });
    if (!writeJson(localStorage, SNAPSHOT_KEY, snapshot)) {
      try {
        localStorage.removeItem(SNAPSHOT_KEY);
      } catch (error) {
        /* storage unavailable */
      }
    }
  }

  function mergeWorkspaces(local, remote, base, snapshot) {
    const stones = Object.assign({}, remote.tombstones || {});
    Object.keys(local.tombstones || {}).forEach(function (id) {
      stones[id] = Math.max(stones[id] || 0, local.tombstones[id]);
    });
    const byId = {};
    const remoteById = {};
    const conflicts = [];
    const merges = [];
    (remote.projects || []).forEach(function (project) {
      if (project && project.id) remoteById[project.id] = project;
    });
    function consider(project) {
      if (!project || !project.id) return;
      const existing = byId[project.id];
      if (!existing || (project.updatedAt || 0) > (existing.updatedAt || 0)) byId[project.id] = project;
    }
    (remote.projects || []).forEach(consider);
    (local.projects || []).forEach(consider);
    if (base) {
      const stamp = Date.now();
      const ancestors = snapshot || {};
      (local.projects || []).forEach(function (mine, index) {
        if (!mine || !mine.id) return;
        const theirs = remoteById[mine.id];
        const known = base[mine.id];
        if (!theirs || !known) return;
        const mineHash = contentHash(mine);
        const theirsHash = contentHash(theirs);
        if (mineHash === theirsHash || mineHash === known || theirsHash === known) return;
        const ancestor = ancestors[mine.id];
        if (ancestor && contentHash(ancestor) === known) {
          const result = mergeProject(ancestor, mine, theirs);
          byId[mine.id] = result.project;
          merges.push({ id: mine.id, name: result.project.name || mine.name, clashes: result.clashes });
          return;
        }
        // No common ancestor on this device (first sync after an update): keep both versions.
        const loser = byId[mine.id] === mine ? theirs : mine;
        const copy = conflictCopy(loser, stamp + index);
        byId[copy.id] = copy;
        conflicts.push({ id: mine.id, name: mine.name, copyId: copy.id });
      });
    }
    const projects = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (project) {
      return !(stones[project.id] && stones[project.id] >= (project.updatedAt || 0));
    });
    const order = (local.projects || []).map(function (project) { return project.id; });
    projects.sort(function (a, b) {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia === -1 && ib === -1) return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (ia === -1) return -1;
      if (ib === -1) return 1;
      return ia - ib;
    });
    return { projects: projects, tombstones: stones, conflicts: conflicts, merges: merges };
  }

  // ----- clash review -----
  function pendingClashes() {
    return readJson(localStorage, PENDING_KEY, []);
  }

  function savePendingClashes(list) {
    writeJson(localStorage, PENDING_KEY, list);
    renderClashBanner();
  }

  function rememberClashes(merges) {
    const list = pendingClashes();
    merges.forEach(function (merge) {
      if (!merge.clashes.length) return;
      const existing = list.find(function (entry) { return entry.projectId === merge.id; });
      const entry = existing || { projectId: merge.id, name: merge.name, fields: [] };
      entry.name = merge.name;
      entry.at = Date.now();
      merge.clashes.forEach(function (clash) {
        const pathKey = JSON.stringify(clash.path);
        entry.fields = entry.fields.filter(function (field) { return JSON.stringify(field.path) !== pathKey; });
        entry.fields.push(clash);
      });
      if (!existing) list.push(entry);
    });
    savePendingClashes(list);
  }

  function setAtPath(target, path, value) {
    let container = target;
    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      const last = i === path.length - 1;
      if (Array.isArray(container) && segment.charAt(0) === '#') {
        const id = segment.slice(1);
        const position = container.findIndex(function (item) { return item && String(item.id) === id; });
        if (last) {
          if (value === undefined) {
            if (position !== -1) container.splice(position, 1);
          } else if (position === -1) {
            container.push(clone(value));
          } else {
            container[position] = clone(value);
          }
          return true;
        }
        if (position === -1) return false;
        container = container[position];
      } else {
        if (last) {
          if (value === undefined) delete container[segment];
          else container[segment] = clone(value);
          return true;
        }
        if (container[segment] === undefined || container[segment] === null) return false;
        container = container[segment];
      }
    }
    return false;
  }

  const FIELD_LABELS = {
    name: 'Name', oneLiner: 'One-liner', problem: 'Problem', targetUser: 'Target user', jtbd: 'Job to be done',
    nonGoals: 'Non-goals', overlap: 'Overlap', status: 'Status', successChecks: 'Success checks',
    board: 'Board', tasks: 'Tasks', title: 'Title', notes: 'Notes', verifyGates: 'Verify'
  };

  function clashLabel(field) {
    const parts = (field.labels && field.labels.length ? field.labels : field.path).map(function (part) {
      return FIELD_LABELS[part] ? t(FIELD_LABELS[part]) : String(part).replace(/^#/, '');
    });
    return parts.join(' › ') || t('Project');
  }

  function previewValue(value) {
    if (value === undefined || value === null || value === '') return '<em>' + esc(t('(empty)')) + '</em>';
    const textValue = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    return esc(textValue.length > 280 ? textValue.slice(0, 280) + '…' : textValue);
  }

  function renderClashBanner() {
    let banner = document.getElementById('sync-clash-banner');
    const list = pendingClashes().filter(function (entry) { return entry.fields && entry.fields.length; });
    if (!list.length) {
      if (banner) banner.remove();
      return;
    }
    const count = list.reduce(function (sum, entry) { return sum + entry.fields.length; }, 0);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sync-clash-banner';
      banner.className = 'update-banner clash-banner';
      banner.setAttribute('role', 'status');
      banner.addEventListener('click', function (event) {
        const action = event.target.closest('[data-clash]');
        if (!action) return;
        if (action.getAttribute('data-clash') === 'review') openClashReview();
        if (action.getAttribute('data-clash') === 'dismiss') banner.hidden = true;
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    banner.innerHTML = '<span>' + esc(t('Sync merged edits from two devices — {count} change(s) clashed and need a quick look.', { count: count })) + '</span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-clash="review">' + esc(t('Review')) + '</button>' +
      '<button type="button" class="btn btn-text btn-sm" data-clash="dismiss">' + esc(t('Later')) + '</button>';
  }

  let clashReturnFocus = null;
  function openClashReview() {
    const list = pendingClashes().filter(function (entry) { return entry.fields && entry.fields.length; });
    if (!list.length) return;
    closeClashReview();
    clashReturnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'studio-modal';
    overlay.id = 'clash-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'clash-title');
    overlay.innerHTML = '<div class="studio-modal-card clash-card">' +
      '<button type="button" class="studio-modal-close" data-clash-action="close" aria-label="' + esc(t('Close')) + '">×</button>' +
      '<h2 id="clash-title">' + esc(t('Review sync clashes')) + '</h2>' +
      '<p class="settings-note">' + esc(t('Both devices changed these fields. Everything else was merged automatically. The newer edit is selected — pick the version to keep.')) + '</p>' +
      '<div class="clash-list">' +
      list.map(function (entry, entryIndex) {
        return '<section class="clash-project"><h3>' + esc(entry.name || t('Untitled')) + '</h3>' +
          entry.fields.map(function (field, fieldIndex) {
            const name = 'clash-' + entryIndex + '-' + fieldIndex;
            return '<fieldset class="clash-field"><legend>' + esc(clashLabel(field)) + '</legend>' +
              '<label class="clash-option"><input type="radio" name="' + name + '" value="local"' + (field.kept === 'local' ? ' checked' : '') + '>' +
                '<span class="clash-side">' + esc(t('This device')) + '</span><span class="clash-value">' + previewValue(field.local) + '</span></label>' +
              '<label class="clash-option"><input type="radio" name="' + name + '" value="remote"' + (field.kept === 'remote' ? ' checked' : '') + '>' +
                '<span class="clash-side">' + esc(t('Other device')) + '</span><span class="clash-value">' + previewValue(field.remote) + '</span></label>' +
            '</fieldset>';
          }).join('') + '</section>';
      }).join('') + '</div>' +
      '<div class="settings-actions"><button type="button" class="btn btn-primary btn-sm" data-clash-action="apply">' + esc(t('Keep selected versions')) + '</button>' +
        '<button type="button" class="btn btn-text btn-sm" data-clash-action="close">' + esc(t('Later')) + '</button></div>' +
    '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('studio-modal-open');
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        closeClashReview();
        return;
      }
      const action = event.target.closest('[data-clash-action]');
      if (!action) return;
      if (action.getAttribute('data-clash-action') === 'apply') applyClashChoices(list, overlay);
      else closeClashReview();
    });
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeClashReview();
    });
    const first = overlay.querySelector('input[type="radio"]:checked') || overlay.querySelector('button');
    if (first) first.focus();
  }

  function closeClashReview() {
    const overlay = document.getElementById('clash-modal');
    if (!overlay) return;
    overlay.remove();
    if (!document.getElementById('settings-modal')) document.body.classList.remove('studio-modal-open');
    if (clashReturnFocus && document.contains(clashReturnFocus)) clashReturnFocus.focus();
    clashReturnFocus = null;
  }

  async function applyClashChoices(list, overlay) {
    let changed = 0;
    list.forEach(function (entry, entryIndex) {
      const project = (typeof state !== 'undefined' && state.projects || []).find(function (item) { return item.id === entry.projectId; });
      entry.fields.forEach(function (field, fieldIndex) {
        const picked = overlay.querySelector('input[name="clash-' + entryIndex + '-' + fieldIndex + '"]:checked');
        const choice = picked ? picked.value : field.kept;
        if (project && choice !== field.kept && setAtPath(project, field.path, choice === 'local' ? field.local : field.remote)) changed++;
      });
    });
    const remaining = pendingClashes().filter(function (entry) {
      return !list.some(function (done) { return done.projectId === entry.projectId; });
    });
    savePendingClashes(remaining);
    closeClashReview();
    if (changed && typeof window.saveState === 'function') {
      await window.saveState();
      rerenderCurrentView();
    }
    toast(changed ? t('Kept your picks — syncing them now') : t('Kept the newer versions'));
  }

  let syncing = null;
  let suppressAutoPush = false;
  const syncListeners = [];

  function notifySync(status) {
    syncListeners.forEach(function (listener) {
      try {
        listener(status);
      } catch (error) {
        /* listener failed */
      }
    });
  }

  function rerenderCurrentView() {
    try {
      const current = state.currentProject && state.projects.find(function (project) { return project.id === state.currentProject.id; });
      if (state.currentProject && current) state.currentProject = current;
      const visible = Array.prototype.find.call(document.querySelectorAll('main section[id^="section-"]'), function (section) {
        return section.style.display !== 'none' && section.id !== 'section-gate';
      });
      const view = visible ? visible.id.replace('section-', '') : 'catalog';
      if (typeof navigateTo === 'function' && view !== 'brief') {
        navigateTo(view === 'plan' && !state.currentProject ? 'catalog' : view);
      } else if (typeof renderCatalog === 'function') {
        renderCatalog();
      }
    } catch (error) {
      /* best-effort refresh */
    }
  }

  async function syncNow(options) {
    if (syncing) return syncing;
    if (!syncConfigured()) throw new Error('Add a GitHub token and a sync passphrase first.');
    if (typeof state === 'undefined' || !state.workspace) throw new Error('Open a workspace first.');
    syncing = (async function () {
      notifySync({ phase: 'syncing' });
      const secrets = syncSecrets();
      trackChanges();
      const local = { projects: (state.projects || []).slice(), tombstones: tombstones() };
      const gist = await findGist();
      let merged = local;
      if (gist) {
        const content = await gistContent(gist);
        if (content) {
          const remote = await decryptPayload(content, secrets.passphrase);
          merged = mergeWorkspaces(local, remote, syncBase(), syncSnapshot());
        }
      }
      writeJson(localStorage, TOMBSTONE_KEY, merged.tombstones);
      const changedLocally = JSON.stringify(merged.projects) !== JSON.stringify(local.projects);
      if (changedLocally) {
        state.projects = merged.projects;
        suppressAutoPush = true;
        try {
          await window.saveState();
        } finally {
          suppressAutoPush = false;
        }
        trackChanges();
        rerenderCurrentView();
      }
      const payload = await encryptPayload({
        projects: merged.projects,
        tombstones: merged.tombstones,
        savedAt: Date.now()
      }, secrets.passphrase);
      const body = JSON.stringify(gist
        ? { files: { [GIST_FILE]: { content: payload } } }
        : { description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: payload } } });
      const saveResponse = await github(gist ? '/gists/' + gist.id : '/gists', { method: gist ? 'PATCH' : 'POST', body: body });
      if (!saveResponse.ok) throw new Error('GitHub error ' + saveResponse.status);
      const saved = await saveResponse.json();
      const settings = syncSettings();
      settings.gistId = saved.id || (gist && gist.id) || settings.gistId;
      settings.lastSync = Date.now();
      saveSyncSettings(settings);
      const nextBase = {};
      merged.projects.forEach(function (project) {
        nextBase[project.id] = contentHash(project);
      });
      writeJson(localStorage, BASE_KEY, nextBase);
      saveSnapshot(merged.projects);
      (merged.conflicts || []).forEach(function (conflict) {
        toast(t('“{name}” was edited on two devices — kept both versions', { name: conflict.name }));
      });
      const merges = merged.merges || [];
      const clashCount = merges.reduce(function (sum, merge) { return sum + merge.clashes.length; }, 0);
      if (merges.length) {
        rememberClashes(merges);
        if (!clashCount) {
          toast(t('Merged edits to “{name}” from two devices', { name: merges[0].name }));
        }
      }
      const result = {
        phase: 'done',
        pulled: changedLocally,
        count: merged.projects.length,
        at: settings.lastSync,
        conflicts: (merged.conflicts || []).length,
        merged: merges.length,
        clashes: clashCount
      };
      notifySync(result);
      if (options && options.announce) toast(t('Last synced {when}', { when: timeAgo(settings.lastSync) }).replace('{when}', timeAgo(settings.lastSync)));
      return result;
    })();
    try {
      return await syncing;
    } catch (error) {
      notifySync({ phase: 'error', message: error.message });
      throw error;
    } finally {
      syncing = null;
    }
  }

  let autoTimer = null;
  function scheduleAutoSync() {
    if (suppressAutoPush || !syncConfigured() || !syncSettings().auto) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      syncNow().catch(function (error) {
        toast('Sync: ' + error.message);
      });
    }, 4000);
  }

  let lastFocusSync = 0;
  function syncOnFocus() {
    if (document.visibilityState !== 'visible' || !syncConfigured() || !syncSettings().auto) return;
    if (typeof state === 'undefined' || !state.workspace) return;
    if (Date.now() - lastFocusSync < 60000) return;
    lastFocusSync = Date.now();
    syncNow().catch(function () { /* surfaced in Settings */ });
  }

  function wrapPersistence() {
    if (typeof window.saveState !== 'function' || window.saveState.__sweepPro) return;
    const original = window.saveState;
    const wrapped = async function () {
      trackChanges();
      const result = await original.apply(this, arguments);
      scheduleAutoSync();
      return result;
    };
    wrapped.__sweepPro = true;
    window.saveState = wrapped;

    if (typeof window.enterApp === 'function' && !window.enterApp.__sweepPro) {
      const originalEnter = window.enterApp;
      const wrappedEnter = function () {
        const result = originalEnter.apply(this, arguments);
        setTimeout(function () {
          knownIds = null;
          trackChanges();
          lastFocusSync = 0;
          syncOnFocus();
        }, 300);
        return result;
      };
      wrappedEnter.__sweepPro = true;
      window.enterApp = wrappedEnter;
    }
  }

  // ----- device linking -----
  // "Link another device" packs the token, passphrase and gist id into a link, encrypted with a
  // one-time 10-character code shown only on this screen (PBKDF2 + AES-GCM). The link alone is
  // useless and so is the code alone. Links expire after 15 minutes.
  const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PAIR_TTL_MS = 15 * 60 * 1000;
  const PAIR_PENDING_KEY = 'sweep_pair_pending_v1';

  function randomCode(length, alphabet) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function generatePassphrase() {
    const raw = randomCode(24, 'abcdefghjkmnpqrstuvwxyz23456789');
    return raw.match(/.{4}/g).join('-');
  }

  function bytesToBase64Url(bytes) {
    return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    return fromBase64(padded + '==='.slice((padded.length + 3) % 4));
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatCode(code) {
    return code.slice(0, 5) + '-' + code.slice(5);
  }

  async function createPairingLink() {
    const secrets = syncSecrets();
    const settings = syncSettings();
    const code = randomCode(10, PAIR_ALPHABET);
    const envelope = await encryptPayload({
      t: secrets.token,
      p: secrets.passphrase,
      g: settings.gistId || '',
      exp: Date.now() + PAIR_TTL_MS
    }, code);
    // One compact base64url blob (salt 16 B | iv 12 B | ciphertext) keeps the link and QR small.
    const parsed = JSON.parse(envelope);
    const salt = fromBase64(parsed.salt);
    const iv = fromBase64(parsed.iv);
    const data = fromBase64(parsed.data);
    const packed = new Uint8Array(salt.length + iv.length + data.length);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(data, salt.length + iv.length);
    const base = location.href.split('#')[0].split('?')[0];
    return { url: base + '#pair=' + bytesToBase64Url(packed), code: code };
  }

  async function redeemPairing(payload, code) {
    const damaged = t('This link is damaged. Create a new one on the other device.');
    let packed;
    try {
      packed = base64UrlToBytes(payload);
    } catch (error) {
      throw new Error(damaged);
    }
    if (packed.length < 16 + 12 + 17) throw new Error(damaged);
    const envelope = JSON.stringify({
      v: 1,
      app: 'sweep',
      salt: toBase64(packed.subarray(0, 16)),
      iv: toBase64(packed.subarray(16, 28)),
      data: toBase64(packed.subarray(28))
    });
    let secret;
    try {
      secret = await decryptPayload(envelope, normalizeCode(code));
    } catch (error) {
      throw new Error(t('That code does not match. Check the code on the other device.'));
    }
    if (!secret || !secret.t || !secret.p) throw new Error(damaged);
    if (secret.exp && Date.now() > secret.exp) throw new Error(t('This link has expired. Create a new one on the other device.'));
    saveSyncSecrets({ token: secret.t, passphrase: secret.p }, true);
    const settings = syncSettings();
    settings.gistId = secret.g || settings.gistId || '';
    settings.auto = true;
    settings.remember = true;
    saveSyncSettings(settings);
    return true;
  }

  async function showLinkPanel() {
    const panel = document.getElementById('sync-link-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="settings-note">' + esc(t('Creating a secure link…')) + '</p>';
    try {
      const pairing = await createPairingLink();
      const qr = window.SweepQR ? window.SweepQR.svg(pairing.url, { ecc: 'L', border: 4, label: t('QR code to link another device') }) : '';
      panel.innerHTML =
        '<div class="sync-link-grid">' +
          (qr ? '<div class="sync-qr">' + qr + '</div>' : '') +
          '<div class="sync-link-copy">' +
            '<p class="settings-note"><b>' + esc(t('On your phone: scan this code.')) + '</b> ' + esc(t('On a computer: open the link instead.')) + '</p>' +
            '<p class="settings-note">' + esc(t('Then type this one-time code:')) + '</p>' +
            '<p class="pair-code" data-no-i18n>' + esc(formatCode(pairing.code)) + '</p>' +
            '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-pro="sync-copy-link" data-link="' + esc(pairing.url) + '">' + esc(t('Copy link')) + '</button></div>' +
            '<p class="settings-note small">' + esc(t('Expires in 15 minutes. Never send the link and the code in the same message.')) + '</p>' +
          '</div>' +
        '</div>';
    } catch (error) {
      panel.innerHTML = '<p class="settings-status error">✗ ' + esc(error.message) + '</p>';
    }
  }

  function capturePairingHash() {
    const match = location.hash.match(/^#pair=([A-Za-z0-9_\-.]+)$/);
    if (!match) return;
    try {
      sessionStorage.setItem(PAIR_PENDING_KEY, match[1]);
    } catch (error) {
      /* storage unavailable */
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  let pairReturnFocus = null;
  function openPairPrompt() {
    let payload = '';
    try {
      payload = sessionStorage.getItem(PAIR_PENDING_KEY) || '';
    } catch (error) {
      payload = '';
    }
    if (!payload || document.getElementById('pair-modal')) return;
    pairReturnFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.id = 'pair-modal';
    modal.className = 'studio-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pair-title');
    modal.innerHTML = '<div class="studio-modal-card settings-card">' +
      '<button type="button" class="studio-modal-close" data-pair="close" aria-label="' + esc(t('Close')) + '">×</button>' +
      '<h2 id="pair-title">' + esc(t('Link this device')) + '</h2>' +
      '<p class="settings-note">' + esc(t('Enter the one-time code shown on your other device to turn on sync here.')) + '</p>' +
      '<label class="settings-field"><span>' + esc(t('One-time code')) + '</span>' +
        '<input type="text" id="pair-code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="11" placeholder="ABCDE-23456" data-no-i18n></label>' +
      '<div class="settings-actions"><button type="button" class="btn btn-primary btn-sm" data-pair="link">' + esc(t('Link device')) + '</button>' +
        '<button type="button" class="btn btn-text btn-sm" data-pair="close">' + esc(t('Cancel')) + '</button>' +
        '<span class="settings-status" id="pair-status" role="status"></span></div>' +
    '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('studio-modal-open');
    const input = modal.querySelector('#pair-code');
    const submit = async function () {
      const status = modal.querySelector('#pair-status');
      status.className = 'settings-status';
      status.textContent = t('Linking…');
      try {
        await redeemPairing(payload, input.value);
        try {
          sessionStorage.removeItem(PAIR_PENDING_KEY);
        } catch (error) {
          /* storage unavailable */
        }
        closePairPrompt();
        toast(t('This device is linked — syncing now'));
        if (typeof state !== 'undefined' && state.workspace) {
          syncNow({ announce: true }).catch(function (error) { toast('Sync: ' + error.message); });
        }
      } catch (error) {
        status.className = 'settings-status error';
        status.textContent = '✗ ' + error.message;
      }
    };
    modal.addEventListener('click', function (event) {
      const action = event.target.closest('[data-pair]');
      if (event.target === modal || (action && action.getAttribute('data-pair') === 'close')) {
        closePairPrompt();
        return;
      }
      if (action && action.getAttribute('data-pair') === 'link') submit();
    });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePairPrompt();
      if (event.key === 'Enter' && event.target === input) submit();
    });
    input.focus();
  }

  function closePairPrompt() {
    const modal = document.getElementById('pair-modal');
    if (!modal) return;
    modal.remove();
    if (!document.getElementById('settings-modal')) document.body.classList.remove('studio-modal-open');
    if (pairReturnFocus && document.contains(pairReturnFocus)) pairReturnFocus.focus();
    pairReturnFocus = null;
  }

  // =====================================================================
  // Settings modal
  // =====================================================================
  const ui = { tab: 'language' };

  function settingsButton() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle || document.getElementById('settings-btn')) return;
    const button = document.createElement('button');
    button.className = 'icon-btn';
    button.id = 'settings-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Settings');
    button.setAttribute('title', 'Settings');
    button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    button.addEventListener('click', function () { openSettings(); });
    toggle.parentNode.insertBefore(button, toggle);
  }

  function languageTabHtml() {
    const current = window.SweepI18n ? window.SweepI18n.getLanguage() : 'en';
    const languages = window.SweepI18n ? window.SweepI18n.languages : [{ code: 'en', label: 'English' }];
    return '<h3>' + esc(t('Interface language')) + '</h3>' +
      '<div class="lang-options" role="radiogroup" aria-label="' + esc(t('Interface language')) + '">' +
        languages.map(function (language) {
          return '<button type="button" role="radio" class="lang-option' + (language.code === current ? ' active' : '') + '" aria-checked="' + (language.code === current) + '" data-lang="' + language.code + '" data-no-i18n>' +
            esc(language.label) + '</button>';
        }).join('') +
      '</div>' +
      '<p class="settings-note">' + esc(t('Your briefs, plans and specs stay in the language you write them in.')) + '</p>' +
      (current !== 'en'
        ? '<p class="settings-note small">' + esc(t('Spotted an awkward translation?')) + ' <a href="' + translationIssueUrl(current) + '" target="_blank" rel="noopener">' + esc(t('Suggest a better wording')) + ' ↗</a></p>'
        : '');
  }

  function translationIssueUrl(lang) {
    const name = lang === 'zh' ? '简体中文' : 'Bahasa Indonesia';
    const visible = Array.prototype.find.call(document.querySelectorAll('main section[id^="section-"]'), function (section) {
      return section.style.display !== 'none';
    });
    const body = [
      'Language: ' + name,
      'Screen: ' + (visible ? visible.id.replace('section-', '') : 'unknown'),
      '',
      'Current text:',
      '',
      'Better wording:',
      '',
      'Why (optional):'
    ].join('\n');
    return 'https://github.com/juw12/projects/issues/new?title=' + encodeURIComponent('Sweep translation (' + lang + '): ') + '&body=' + encodeURIComponent(body);
  }

  function aiTabHtml() {
    const settings = aiSettings();
    const provider = PROVIDERS[settings.provider];
    return '<h3>' + esc(t('AI assist')) + '</h3>' +
      '<p class="settings-note">' + esc(t('AI is optional. Sweep works fully offline without it.')) + '</p>' +
      '<label class="settings-field"><span>' + esc(t('Provider')) + '</span>' +
        '<select id="ai-provider">' + Object.keys(PROVIDERS).map(function (id) {
          return '<option value="' + id + '"' + (id === settings.provider ? ' selected' : '') + '>' + esc(t(PROVIDERS[id].label)) + '</option>';
        }).join('') + '</select></label>' +
      '<div id="ai-key-row"' + (provider.keyless ? ' hidden' : '') + '>' +
        '<label class="settings-field"><span>' + esc(t('API key')) + (provider.keyUrl ? ' · <a href="' + provider.keyUrl + '" target="_blank" rel="noopener">get one ↗</a>' : '') + '</span>' +
          '<input type="password" id="ai-key" autocomplete="off" spellcheck="false" value="' + esc(aiKey()) + '" placeholder="sk-…"></label>' +
        '<label class="settings-check"><input type="checkbox" id="ai-remember"' + (settings.remember ? ' checked' : '') + '> ' + esc(t('Remember the key on this device')) + '</label>' +
        '<p class="settings-note small">' + esc(t('Off: the key is kept only until you close this tab.')) + '</p>' +
      '</div>' +
      '<label class="settings-field" id="ai-base-row"' + (settings.provider === 'custom' ? '' : ' hidden') + '><span>' + esc(t('Base URL')) + '</span>' +
        '<input type="text" id="ai-base" spellcheck="false" value="' + esc(settings.base) + '" placeholder="https://api.example.com/v1"></label>' +
      '<label class="settings-field"><span>' + esc(t('Model')) + '</span>' +
        '<input type="text" id="ai-model" spellcheck="false" value="' + esc(settings.model) + '" placeholder="' + esc(provider.model || 'model-id') + '"></label>' +
      '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-pro="ai-test">' + esc(t('Test connection')) + '</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-pro="ai-save">' + esc(t('Save')) + '</button>' +
        '<span class="settings-status" id="ai-status" role="status"></span></div>' +
      '<p class="settings-note small">' + esc(t('Your key is sent only to the provider you pick, straight from your browser. Sweep has no server.')) + '</p>';
  }

  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=Sweep%20sync' +
    '&description=Encrypted%20Sweep%20workspace%20sync%20(private%20gist)&expires_in=366&gists=write';

  function syncTabHtml() {
    const settings = syncSettings();
    const secrets = syncSecrets();
    const configured = syncConfigured();
    return '<h3>' + esc(t('Sync across devices')) + '</h3>' +
      '<p class="settings-note">' + esc(t('Your workspace is encrypted with your sync passphrase, then saved to a private GitHub Gist you own. Use the same token and passphrase on another device to sync.')) + '</p>' +
      (configured ? '' :
        '<ol class="sync-steps">' +
          '<li>' + esc(t('Create a token — the link pre-fills everything (only the “Gists” permission). Click “Generate token” on GitHub and copy it.')) + '</li>' +
          '<li>' + esc(t('Paste it below, press “Generate” for a strong passphrase, then “Sync now”.')) + '</li>' +
          '<li>' + esc(t('On your other devices, use “Link another device” — no typing needed.')) + '</li>' +
        '</ol>') +
      '<label class="settings-field"><span>' + esc(t('GitHub token')) + ' · <a href="' + TOKEN_URL + '" target="_blank" rel="noopener">' + esc(t('create (pre-filled)')) + ' ↗</a></span>' +
        '<input type="password" id="sync-token" autocomplete="off" spellcheck="false" value="' + esc(secrets.token) + '" placeholder="github_pat_…"></label>' +
      '<p class="settings-note small">' + esc(t('Create a token with only the “Gists” permission.')) + '</p>' +
      '<label class="settings-field"><span>' + esc(t('Sync passphrase')) + '</span>' +
        '<span class="input-with-button"><input type="password" id="sync-pass" autocomplete="new-password" value="' + esc(secrets.passphrase) + '">' +
        '<button type="button" class="btn btn-secondary btn-sm" data-pro="sync-generate">' + esc(t('Generate')) + '</button></span></label>' +
      '<p class="settings-note small">' + esc(t('Never leaves this device. Without it the gist is unreadable.')) + '</p>' +
      '<label class="settings-check"><input type="checkbox" id="sync-remember"' + (settings.remember !== false ? ' checked' : '') + '> ' + esc(t('Remember the key on this device')) + '</label>' +
      '<label class="settings-check"><input type="checkbox" id="sync-auto"' + (settings.auto !== false ? ' checked' : '') + '> ' + esc(t('Sync automatically')) + '</label>' +
      '<div class="settings-actions"><button type="button" class="btn btn-primary btn-sm" data-pro="sync-now">' + esc(t('Sync now')) + '</button>' +
        (configured ? '<button type="button" class="btn btn-secondary btn-sm" data-pro="sync-link">' + esc(t('Link another device')) + '</button>' : '') +
        (configured ? '<button type="button" class="btn btn-text btn-sm" data-pro="sync-disconnect">' + esc(t('Disconnect')) + '</button>' : '') +
        '<span class="settings-status" id="sync-status" role="status">' + esc(settings.lastSync ? t('Last synced {when}', { when: timeAgo(settings.lastSync) }).replace('{when}', timeAgo(settings.lastSync)) : t('Never synced')) + '</span></div>' +
      '<div id="sync-link-panel" class="sync-link-panel" hidden></div>';
  }

  function settingsBodyHtml() {
    if (ui.tab === 'ai') return aiTabHtml();
    if (ui.tab === 'sync') return syncTabHtml();
    return languageTabHtml();
  }

  function renderSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-settings-tab]').forEach(function (button) {
      const active = button.getAttribute('data-settings-tab') === ui.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    modal.querySelector('.settings-body').innerHTML = settingsBodyHtml();
  }

  function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.remove();
    document.body.classList.remove('studio-modal-open');
    const trigger = document.getElementById('settings-btn');
    if (trigger) trigger.focus();
  }

  function openSettings(tab) {
    if (tab) ui.tab = tab;
    closeSettings();
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'studio-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'settings-title');
    modal.innerHTML =
      '<div class="studio-modal-card settings-card">' +
        '<button type="button" class="studio-modal-close" aria-label="' + esc(t('Close')) + '" data-pro="close">×</button>' +
        '<h2 id="settings-title">' + esc(t('Settings')) + '</h2>' +
        '<div class="settings-tabs" role="tablist">' +
          '<button type="button" role="tab" data-settings-tab="language">' + esc(t('Language')) + '</button>' +
          '<button type="button" role="tab" data-settings-tab="ai">' + esc(t('AI assist')) + '</button>' +
          '<button type="button" role="tab" data-settings-tab="sync">' + esc(t('Sync')) + '</button>' +
        '</div>' +
        '<div class="settings-body" role="tabpanel"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('studio-modal-open');
    renderSettings();
    modal.addEventListener('click', onSettingsClick);
    modal.addEventListener('change', onSettingsChange);
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSettings();
    });
    const first = modal.querySelector('[data-settings-tab].active');
    if (first) first.focus();
  }

  function readAiForm() {
    const provider = document.getElementById('ai-provider').value;
    return {
      settings: {
        provider: provider,
        model: document.getElementById('ai-model').value.trim() || PROVIDERS[provider].model,
        base: (document.getElementById('ai-base') || {}).value ? document.getElementById('ai-base').value.trim() : '',
        remember: !!(document.getElementById('ai-remember') || {}).checked
      },
      key: ((document.getElementById('ai-key') || {}).value || '').trim()
    };
  }

  function readSyncForm() {
    return {
      token: document.getElementById('sync-token').value.trim(),
      passphrase: document.getElementById('sync-pass').value,
      remember: document.getElementById('sync-remember').checked,
      auto: document.getElementById('sync-auto').checked
    };
  }

  function persistSyncForm() {
    const form = readSyncForm();
    saveSyncSecrets({ token: form.token, passphrase: form.passphrase }, form.remember);
    const settings = syncSettings();
    settings.remember = form.remember;
    settings.auto = form.auto;
    saveSyncSettings(settings);
  }

  function setStatus(id, message, kind) {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = message;
    node.className = 'settings-status' + (kind ? ' ' + kind : '');
  }

  function onSettingsChange(event) {
    if (event.target.id === 'ai-provider') {
      const provider = PROVIDERS[event.target.value];
      document.getElementById('ai-key-row').hidden = !!provider.keyless;
      document.getElementById('ai-base-row').hidden = event.target.value !== 'custom';
      const model = document.getElementById('ai-model');
      model.value = provider.model;
      model.placeholder = provider.model || 'model-id';
    }
    if (event.target.id && event.target.id.indexOf('sync-') === 0) persistSyncForm();
  }

  async function onSettingsClick(event) {
    const modal = document.getElementById('settings-modal');
    if (event.target === modal) {
      closeSettings();
      return;
    }
    const tab = event.target.closest('[data-settings-tab]');
    if (tab) {
      ui.tab = tab.getAttribute('data-settings-tab');
      renderSettings();
      return;
    }
    const lang = event.target.closest('[data-lang]');
    if (lang && window.SweepI18n) {
      window.SweepI18n.setLanguage(lang.getAttribute('data-lang'));
      openSettings('language');
      return;
    }
    const action = event.target.closest('[data-pro]');
    if (!action) return;
    const name = action.getAttribute('data-pro');
    if (name === 'close') closeSettings();
    if (name === 'ai-save') {
      const form = readAiForm();
      saveAiSettings(form.settings, form.key);
      setStatus('ai-status', '✓ ' + t('Save'), 'ok');
      notifyAi();
    }
    if (name === 'ai-test') {
      const form = readAiForm();
      saveAiSettings(form.settings, form.key);
      notifyAi();
      setStatus('ai-status', t('Testing…'));
      action.disabled = true;
      try {
        const reply = await aiComplete({ system: 'Reply with exactly: OK', user: 'Say OK', maxTokens: 20, timeoutMs: 45000, cache: false });
        setStatus('ai-status', '✓ ' + t('Connected') + ' · ' + reply.trim().slice(0, 24), 'ok');
      } catch (error) {
        setStatus('ai-status', '✗ ' + error.message, 'error');
      } finally {
        action.disabled = false;
      }
    }
    if (name === 'sync-generate') {
      const field = document.getElementById('sync-pass');
      if (field) {
        field.value = generatePassphrase();
        field.type = 'text';
        persistSyncForm();
        setStatus('sync-status', t('Strong passphrase created — it is saved on this device.'), 'ok');
      }
      return;
    }
    if (name === 'sync-link') {
      persistSyncForm();
      showLinkPanel();
      return;
    }
    if (name === 'sync-copy-link') {
      const link = action.getAttribute('data-link');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(function () { toast(t('Link copied')); });
      }
      return;
    }
    if (name === 'sync-now') {
      persistSyncForm();
      setStatus('sync-status', t('Syncing…'));
      action.disabled = true;
      try {
        const result = await syncNow();
        setStatus('sync-status', '✓ ' + t('Last synced {when}', { when: timeAgo(result.at) }).replace('{when}', timeAgo(result.at)) + ' · ' + result.count + ' ' + (result.count === 1 ? 'project' : 'projects'), 'ok');
      } catch (error) {
        setStatus('sync-status', '✗ ' + error.message, 'error');
      } finally {
        action.disabled = false;
      }
    }
    if (name === 'sync-disconnect') {
      saveSyncSecrets({ token: '', passphrase: '' }, false);
      const settings = syncSettings();
      settings.gistId = '';
      settings.lastSync = 0;
      saveSyncSettings(settings);
      renderSettings();
    }
  }

  const aiListeners = [];
  function notifyAi() {
    aiListeners.forEach(function (listener) {
      try {
        listener();
      } catch (error) {
        /* listener failed */
      }
    });
  }

  function paletteCommands() {
    const commands = [
      { group: 'Actions', label: t('Settings'), hint: '', run: function () { openSettings(); } },
      { group: 'Actions', label: t('Settings') + ' · ' + t('AI assist'), hint: '', run: function () { openSettings('ai'); } },
      { group: 'Actions', label: t('Settings') + ' · ' + t('Sync'), hint: '', run: function () { openSettings('sync'); } }
    ];
    (window.SweepI18n ? window.SweepI18n.languages : []).forEach(function (language) {
      commands.push({
        group: 'Actions',
        label: t('Language') + ' · ' + language.label,
        hint: '',
        run: function () { window.SweepI18n.setLanguage(language.code); }
      });
    });
    if (syncConfigured()) {
      commands.push({
        group: 'Actions',
        label: t('Sync now'),
        hint: '',
        run: function () {
          syncNow({ announce: true }).catch(function (error) { toast('Sync: ' + error.message); });
        }
      });
    }
    return commands;
  }

  // =====================================================================
  // Dialog focus trap — Tab / Shift+Tab stay inside the open modal dialog.
  // =====================================================================
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openDialog() {
    const dialogs = Array.prototype.filter.call(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
      function (dialog) {
        return dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden';
      }
    );
    return dialogs[dialogs.length - 1] || null;
  }

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const dialog = openDialog();
    if (!dialog) return;
    const focusables = Array.prototype.filter.call(dialog.querySelectorAll(FOCUSABLE), function (element) {
      return element.getClientRects().length;
    });
    if (!focusables.length) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // =====================================================================
  // Offline support + "new version ready" prompt for the main app pages.
  // =====================================================================
  function showUpdateBanner() {
    if (document.getElementById('sweep-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sweep-update-banner';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML =
      '<span>' + esc(t('A new version of Sweep is ready.')) + '</span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-update="reload">' + esc(t('Reload')) + '</button>' +
      '<button type="button" class="btn btn-text btn-sm" data-update="later">' + esc(t('Later')) + '</button>';
    banner.addEventListener('click', function (event) {
      const action = event.target.closest('[data-update]');
      if (!action) return;
      if (action.getAttribute('data-update') === 'reload') {
        location.reload();
      } else {
        banner.remove();
      }
    });
    document.body.appendChild(banner);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) showUpdateBanner();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (registration) {
        // Check for a newer version when the app comes back to the foreground.
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') registration.update().catch(function () {});
        });
      }).catch(function () {
        /* offline support unavailable (private mode, unsupported browser) */
      });
    });
  }

  capturePairingHash();

  function init() {
    settingsButton();
    renderClashBanner();
    setTimeout(openPairPrompt, 400);
    wrapPersistence();
    document.addEventListener('visibilitychange', syncOnFocus);
    document.addEventListener('keydown', trapFocus);
    registerServiceWorker();
    if (window.SweepI18n && window.SweepI18n.onChange) {
      // Re-render the current view so text built in JavaScript (dates, counts) follows the language.
      window.SweepI18n.onChange(function () {
        if (typeof state !== 'undefined' && state.workspace) {
          rerenderCurrentView();
        }
      });
    }
  }

  window.SweepPro = {
    openSettings: openSettings,
    paletteCommands: paletteCommands,
    ai: {
      ready: aiReady,
      settings: aiSettings,
      complete: aiComplete,
      cancel: cancelAi,
      sharpenBrief: sharpenBrief,
      improveSpecFile: improveSpecFile,
      translateSpecFile: translateSpecFile,
      onChange: function (listener) { aiListeners.push(listener); },
      providers: PROVIDERS
    },
    sync: {
      now: syncNow,
      configured: syncConfigured,
      merge: mergeWorkspaces,
      mergeProject: mergeProject,
      hash: contentHash,
      reviewClashes: openClashReview,
      pendingClashes: pendingClashes,
      createPairingLink: createPairingLink,
      redeemPairing: redeemPairing,
      openPairPrompt: openPairPrompt,
      generatePassphrase: generatePassphrase,
      encrypt: encryptPayload,
      decrypt: decryptPayload,
      onStatus: function (listener) { syncListeners.push(listener); }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
