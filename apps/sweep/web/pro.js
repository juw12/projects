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
            messages: [{ role: 'user', content: options.user }].concat(continuationMessages(options))
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
    const payload = {
      model: model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ].concat(continuationMessages(options))
    };
    // The keyless Pollinations model is a reasoning model with a hard ~1500-token reply cap;
    // at the default effort its thinking alone can use the whole cap, cutting answers off.
    if (providerId === 'free' && /pollinations\.ai/.test(base)) payload.reasoning_effort = 'low';
    return {
      url: base + '/chat/completions',
      init: {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      }
    };
  }

  // When a reply was cut off by the provider's length cap, ask for the rest in a follow-up turn.
  function continuationMessages(options) {
    if (!options.partial) return [];
    return [
      { role: 'assistant', content: options.partial },
      { role: 'user', content: 'Your reply was cut off. Continue exactly where you stopped — do not repeat anything and do not add any comment.' }
    ];
  }

  // Joins a continuation onto the text so far, dropping any overlap the model repeated.
  function joinContinuation(previous, next) {
    const maxOverlap = Math.min(400, previous.length, next.length);
    for (let size = maxOverlap; size >= 12; size--) {
      if (previous.slice(-size) === next.slice(0, size)) return previous + next.slice(size);
    }
    const lastLine = previous.slice(previous.lastIndexOf('\n') + 1);
    if (lastLine.length >= 12 && next.indexOf(lastLine) === 0) return previous + next.slice(lastLine.length);
    return previous + next;
  }

  function wasCutOff(kind, data) {
    if (kind === 'anthropic') return data.stop_reason === 'max_tokens';
    return (((data.choices || [])[0] || {}).finish_reason) === 'length';
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
    return { text: textOut, cutOff: wasCutOff(kind, data) };
  }

  const MAX_CONTINUATIONS = 3;

  // Calls one endpoint and, if the provider cut the reply off at its length cap, asks it to
  // continue (up to MAX_CONTINUATIONS times) so long files come back whole.
  async function callWithContinuation(makeRequest, kind, signal, attempts, attemptMs, options) {
    let reply = await callEndpoint(makeRequest(options), kind, signal, attempts, attemptMs);
    let textOut = reply.text;
    for (let round = 0; reply.cutOff && round < MAX_CONTINUATIONS; round++) {
      reply = await callEndpoint(makeRequest(Object.assign({}, options, { partial: textOut })), kind, signal, attempts, attemptMs);
      textOut = joinContinuation(textOut, reply.text);
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
          let order = ready.length ? ready : chain;
          if (options.freeStart && order.length > 1) {
            const shift = options.freeStart % order.length;
            order = order.slice(shift).concat(order.slice(0, shift));
          }
          for (let index = 0; index < order.length; index++) {
            const entry = order[index];
            try {
              const textOut = await callWithContinuation(function (requestOptions) {
                return buildRequest('openai', entry.base, entry.model, '', 'free', requestOptions);
              }, 'openai', controller.signal, 1, FREE_ATTEMPT_MS, options);
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
        answer = await callWithContinuation(function (requestOptions) {
          return buildRequest(provider.kind, base, model, key, settings.provider, requestOptions);
        }, provider.kind, controller.signal, 3, 0, options);
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
  // Spec vocabulary the AI must use consistently (users can add their own terms per project).
  const SPEC_GLOSSARY = {
    zh: {
      'Requirements': '需求', 'User story': '用户故事', 'Acceptance criteria': '验收标准', 'Design': '设计',
      'Tasks': '任务', 'Definition of Done': '完成标准', 'Out of scope': '不在范围内', 'Non-goals': '非目标',
      'Success criteria': '成功标准', 'Edge cases': '边界情况', 'Data model': '数据模型', 'Introduction': '简介',
      'streak': '连续天数', 'Primary user': '主要用户', 'Job to be done': '待完成的任务'
    },
    id: {
      'Requirements': 'Kebutuhan', 'User story': 'Cerita pengguna', 'Acceptance criteria': 'Kriteria penerimaan',
      'Design': 'Desain', 'Tasks': 'Tugas', 'Definition of Done': 'Definisi selesai', 'Out of scope': 'Di luar cakupan',
      'Non-goals': 'Bukan tujuan', 'Success criteria': 'Kriteria sukses', 'Edge cases': 'Kasus tepi',
      'Data model': 'Model data', 'Introduction': 'Pendahuluan', 'streak': 'streak (hari beruntun)',
      'Primary user': 'Pengguna utama', 'Job to be done': 'Pekerjaan yang ingin diselesaikan'
    }
  };

  function proseOnly(textValue) {
    return String(textValue || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b(WHEN|THEN|IF|WHILE|WHERE|THE SYSTEM SHALL|SHALL)\b/g, ' ');
  }

  function countMatches(textValue, pattern) {
    return (String(textValue || '').match(pattern) || []).length;
  }

  // Structural checks catch the failures free models make most often: dropped sections,
  // translated ids or EARS keywords, untranslated output, truncation.
  function validateTranslation(english, translated, lang) {
    const problems = [];
    const out = String(translated || '');
    if (!out.trim()) return ['The answer was empty.'];
    const ratio = out.length / Math.max(1, english.length);
    if (ratio < 0.25) problems.push('The translation looks cut off (much shorter than the original).');
    if (ratio > 3) problems.push('The translation is much longer than the original; translate only, do not add content.');
    const headingsIn = countMatches(english, /^#{1,6}\s/gm);
    const headingsOut = countMatches(out, /^#{1,6}\s/gm);
    if (headingsOut < headingsIn) problems.push('Keep every heading: ' + headingsIn + ' in the original, ' + headingsOut + ' in the translation.');
    if (countMatches(out, /^```/gm) !== countMatches(english, /^```/gm)) problems.push('Keep every code block exactly.');
    const earsIn = countMatches(english, /THE SYSTEM SHALL/g);
    if (countMatches(out, /THE SYSTEM SHALL/g) < earsIn) problems.push('Keep the EARS keywords "THE SYSTEM SHALL", "WHEN", "IF" in English capitals.');
    const boxesIn = countMatches(english, /^\s*[-*] \[[ xX]\]/gm);
    if (countMatches(out, /^\s*[-*] \[[ xX]\]/gm) < boxesIn) problems.push('Keep every checkbox line ("- [ ]").');
    const ids = (english.match(/\b(?:R|T|AC|NFR)-?\d+(?:\.\d+)?\b/g) || []).filter(function (id, index, list) { return list.indexOf(id) === index; });
    const lost = ids.filter(function (id) { return out.indexOf(id) === -1; });
    if (lost.length) problems.push('Keep these ids unchanged: ' + lost.slice(0, 8).join(', ') + '.');
    const prose = proseOnly(out);
    if (lang === 'zh') {
      const han = countMatches(prose, /[\u4e00-\u9fff]/g);
      const latin = countMatches(prose, /[A-Za-z]/g);
      if (han < 20 || han / Math.max(1, han + latin / 4) < 0.5) problems.push('Most of the text is still in English; translate the prose into Simplified Chinese.');
    } else if (lang === 'id') {
      const words = countMatches(prose.toLowerCase(), /\b(yang|dan|untuk|dengan|tidak|pengguna|akan|dari|ini|saat|sistem|harus)\b/g);
      if (words < 5 || out.trim() === english.trim()) problems.push('Most of the text is still in English; translate the prose into Bahasa Indonesia.');
    }
    return problems;
  }

  // Translates one generated spec file for people who read the plan in another language.
  // Structure the AI builder depends on (headings, ids like R1/T3, EARS keywords, code,
  // file paths, commands, [P] markers, checkboxes) is kept exactly. Answers are checked; a
  // failing answer is retried once on a different free service with the problems listed.
  async function translateSpecFile(filename, content, lang, options) {
    const target = LANGUAGE_NAMES[lang] || lang;
    const glossary = Object.assign({}, SPEC_GLOSSARY[lang] || {}, (options && options.glossary) || {});
    const glossaryLines = Object.keys(glossary).map(function (term) { return '- ' + term + ' → ' + glossary[term]; }).join('\n');
    const system = [
      'You translate software specification files into ' + target + '.',
      'Translate prose, headings and list items. Keep Markdown structure, line breaks and checkbox syntax exactly.',
      'Do NOT translate: code blocks, inline code, file paths, URLs, shell commands, ids such as R1, T3, AC-2, [P] markers,',
      'or the EARS keywords WHEN / IF / WHILE / WHERE / THEN THE SYSTEM SHALL (keep those in English capitals so agents can parse them).',
      'Keep product names and brand names unchanged. Use natural, plain wording a native speaker would write.',
      glossaryLines ? 'Always use this glossary:\n' + glossaryLines : '',
      'Reply with ONLY the translated file content, no commentary and no code fences around the whole answer.'
    ].filter(Boolean).join('\n');
    let user = 'File: ' + filename + '\n---\n' + content;
    let best = null;
    let bestProblems = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await aiComplete({ system: system, user: user, maxTokens: 4000, cache: attempt === 0, freeStart: attempt });
      const text = stripFences(answer);
      const problems = validateTranslation(content, text, lang);
      if (!problems.length) return { text: text, problems: [] };
      if (!best || problems.length < bestProblems.length) {
        best = text;
        bestProblems = problems;
      }
      user = 'File: ' + filename + '\n---\n' + content + '\n\n---\nA previous translation had these problems. Avoid them:\n- ' + problems.join('\n- ');
    }
    return { text: best, problems: bestProblems };
  }

  // ----- meaning check (back-translation) -----
  // The translation is translated back into English and compared with the original by shared
  // content words (Dice overlap). Calibrated on real free-AI round trips: faithful translations
  // scored 0.56–0.67, unrelated text at most 0.25, so 0.42 separates the two with margin.
  const MEANING_OK = 0.42;
  const MEANING_SECTION_OK = 0.3;
  const MEANING_STOP = {};
  ('a an the and or of to in on for with by is are be as at it this that from will shall when then if while where can must ' +
    'should not no into than so each per their its your you we they them has have had do does was were any all more most other ' +
    'some such only own same too very just also how what which who whom why use used using').split(' ').forEach(function (word) {
    MEANING_STOP[word] = true;
  });

  function meaningWords(textValue) {
    return String(textValue || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (word) { return word.length > 2 && !MEANING_STOP[word]; })
      .map(function (word) { return word.replace(/(ing|ed|es|s)$/, ''); });
  }

  function diceScore(first, second) {
    if (!first.length && !second.length) return 1;
    const counts = {};
    first.forEach(function (word) { counts[word] = (counts[word] || 0) + 1; });
    let shared = 0;
    second.forEach(function (word) {
      if (counts[word] > 0) {
        shared++;
        counts[word]--;
      }
    });
    return (2 * shared) / (first.length + second.length);
  }

  function markdownSections(textValue) {
    const sections = [];
    let current = { heading: '', body: '' };
    String(textValue || '').split('\n').forEach(function (line) {
      if (/^#{1,6}\s/.test(line)) {
        sections.push(current);
        current = { heading: line.replace(/^#+\s*/, '').trim(), body: '' };
      } else {
        current.body += line + '\n';
      }
    });
    sections.push(current);
    return sections.filter(function (section) { return section.heading || section.body.trim(); });
  }

  function meaningScore(english, backTranslation) {
    const overall = diceScore(meaningWords(english), meaningWords(backTranslation));
    const original = markdownSections(english);
    const back = markdownSections(backTranslation);
    const weak = [];
    if (original.length === back.length && original.length > 1) {
      original.forEach(function (section, index) {
        const words = meaningWords(section.body);
        if (words.length < 10) return;
        if (diceScore(words, meaningWords(back[index].body)) < MEANING_SECTION_OK) weak.push(section.heading || '—');
      });
    }
    return { score: Math.round(overall * 100) / 100, ok: overall >= MEANING_OK && !weak.length, weak: weak };
  }

  async function meaningCheck(english, translated) {
    const back = await aiComplete({
      system: 'Translate this text back into English as literally as possible. Keep the Markdown structure. Reply with only the translation.',
      user: translated,
      maxTokens: 4000,
      cache: true,
      freeStart: 1
    });
    return meaningScore(english, stripFences(back));
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
          openDirectPrompt();
          openDropPrompt();
          checkDropReplies(true).catch(function () { /* offline */ });
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

  // Base URL for links that open Sweep on another device ("…/sweep/" rather than "…/sweep/index.html").
  function shareBase() {
    return location.href.split('#')[0].split('?')[0].replace(/index\.html$/, '');
  }

  // Compact v2 pairing secret: "2|expiry minutes (base36)|gist|passphrase|token".
  // Hex gist ids are packed as base64url and the "github_pat_" prefix becomes "~",
  // which keeps the QR roughly two versions smaller (bigger modules, easier to scan).
  function packPairingSecret(token, passphrase, gistId, expiresAt) {
    const gist = /^[0-9a-f]{32}$/.test(gistId || '')
      ? '*' + bytesToBase64Url(new Uint8Array(gistId.match(/../g).map(function (pair) { return parseInt(pair, 16); })))
      : (gistId || '');
    const shortToken = token.indexOf('github_pat_') === 0 ? '~' + token.slice(11) : token;
    return ['2', Math.ceil(expiresAt / 60000).toString(36), gist, passphrase, shortToken].join('|');
  }

  function unpackPairingSecret(secret) {
    if (secret && typeof secret === 'object') return secret; // v1 links: { t, p, g, exp }
    const parts = String(secret || '').split('|');
    if (parts.length < 5 || parts[0] !== '2') return null;
    let gist = parts[2];
    if (gist.charAt(0) === '*') {
      gist = Array.prototype.map.call(base64UrlToBytes(gist.slice(1)), function (byte) {
        return ('0' + byte.toString(16)).slice(-2);
      }).join('');
    }
    const token = parts.slice(4).join('|');
    return {
      t: token.charAt(0) === '~' ? 'github_pat_' + token.slice(1) : token,
      p: parts[3],
      g: gist,
      exp: parseInt(parts[1], 36) * 60000
    };
  }

  async function createPairingLink() {
    const secrets = syncSecrets();
    const settings = syncSettings();
    const code = randomCode(10, PAIR_ALPHABET);
    const secretText = packPairingSecret(secrets.token, secrets.passphrase, settings.gistId || '', Date.now() + PAIR_TTL_MS);
    const envelope = await encryptPayload(secretText, code);
    // Preferred: park the encrypted secret on the backup relay so the link (and QR) stay tiny.
    if (!window.SWEEP_DISABLE_RELAY) {
      try {
        const topicId = randomCode(16, TOPIC_ALPHABET);
        await relayPut('sweep' + topicId, envelope);
        return { url: shareBase() + '#pair=r' + topicId, code: code, short: true };
      } catch (error) {
        /* relay unreachable: fall back to the self-contained link */
      }
    }
    // One compact base64url blob (salt 16 B | iv 12 B | ciphertext) keeps the link and QR small.
    const parsed = JSON.parse(envelope);
    const salt = fromBase64(parsed.salt);
    const iv = fromBase64(parsed.iv);
    const data = fromBase64(parsed.data);
    const packed = new Uint8Array(salt.length + iv.length + data.length);
    packed.set(salt, 0);
    packed.set(iv, salt.length);
    packed.set(data, salt.length + iv.length);
    return { url: shareBase() + '#pair=' + bytesToBase64Url(packed), code: code };
  }

  async function redeemPairing(payload, code) {
    const damaged = t('This link is damaged. Create a new one on the other device.');
    if (/^r[a-z0-9]{16}$/.test(payload)) {
      const latest = await relayLatest('sweep' + payload.slice(1));
      if (!latest) throw new Error(t('This link has expired. Create a new one on the other device.'));
      return applyPairingEnvelope(latest.text, code, damaged);
    }
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
    return applyPairingEnvelope(envelope, code, damaged);
  }

  async function applyPairingEnvelope(envelope, code, damaged) {
    let secret;
    try {
      secret = await decryptPayload(envelope, normalizeCode(code));
    } catch (error) {
      throw new Error(t('That code does not match. Check the code on the other device.'));
    }
    try {
      secret = unpackPairingSecret(secret);
    } catch (error) {
      secret = null;
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

  // QR plus a "bigger" toggle: a larger code gives the phone camera more pixels per module.
  function qrBlock(svg) {
    return '<div class="sync-qr-wrap"><div class="sync-qr">' + svg + '</div>' +
      '<button type="button" class="btn btn-text btn-sm sync-qr-zoom" data-pro="qr-zoom" aria-pressed="false">' +
      esc(t('Show bigger QR')) + '</button></div>';
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
          (qr ? qrBlock(qr) : '') +
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
  // No-account sync: direct device-to-device (WebRTC) and encrypted sync files
  // =====================================================================
  // Both paths use the same encryption and three-way merge as Gist sync. Direct sync uses the
  // free PeerJS broker only to introduce the two browsers; the workspace then travels over an
  // encrypted WebRTC data channel, additionally sealed with a one-time code that never leaves
  // the link fragment. Sync files are the same encrypted envelope saved to disk.
  const DIRECT_BASE_KEY = 'sweep_direct_base_v1';
  const DIRECT_SNAPSHOT_KEY = 'sweep_direct_snapshot_v1';
  const DIRECT_PENDING_KEY = 'sweep_direct_pending_v1';
  const DIRECT_WAIT_MS = 10 * 60 * 1000;
  const DIRECT_PEER_PREFIX = 'sweep-';
  let peerLoader = null;
  let directHost = null;

  function loadPeerLibrary() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerLoader) return peerLoader;
    peerLoader = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = 'vendor/peerjs.min.js';
      script.async = true;
      script.onload = function () {
        if (window.Peer) resolve(window.Peer);
        else reject(new Error(t('Could not start direct sync on this browser.')));
      };
      script.onerror = function () {
        peerLoader = null;
        reject(new Error(t('Could not start direct sync on this browser.')));
      };
      document.head.appendChild(script);
    });
    return peerLoader;
  }

  function localWorkspace() {
    trackChanges();
    return { projects: (state.projects || []).slice(), tombstones: tombstones() };
  }

  async function adoptWorkspace(local, merged) {
    writeJson(localStorage, TOMBSTONE_KEY, merged.tombstones || {});
    const changed = JSON.stringify(merged.projects) !== JSON.stringify(local.projects);
    if (changed) {
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
    return changed;
  }

  function saveDirectBase(projects) {
    const base = {};
    projects.forEach(function (project) {
      base[project.id] = contentHash(project);
    });
    writeJson(localStorage, DIRECT_BASE_KEY, base);
    const snapshot = {};
    projects.forEach(function (project) {
      snapshot[project.id] = project;
    });
    if (!writeJson(localStorage, DIRECT_SNAPSHOT_KEY, snapshot)) {
      try {
        localStorage.removeItem(DIRECT_SNAPSHOT_KEY);
      } catch (error) {
        /* storage unavailable */
      }
    }
  }

  function announceMerge(merged) {
    (merged.conflicts || []).forEach(function (conflict) {
      toast(t('“{name}” was edited on two devices — kept both versions', { name: conflict.name }));
    });
    const merges = merged.merges || [];
    if (merges.length) {
      rememberClashes(merges);
      const clashCount = merges.reduce(function (sum, merge) { return sum + merge.clashes.length; }, 0);
      if (!clashCount) toast(t('Merged edits to “{name}” from two devices', { name: merges[0].name }));
    }
  }

  // Merge a workspace that arrived from another device (direct sync or a sync file).
  async function mergeIncoming(remote) {
    if (!remote || !Array.isArray(remote.projects)) throw new Error(t('That file is not a Sweep sync file.'));
    const local = localWorkspace();
    const base = readJson(localStorage, DIRECT_BASE_KEY, null);
    const merged = mergeWorkspaces(local, remote, base, readJson(localStorage, DIRECT_SNAPSHOT_KEY, {}));
    const changed = await adoptWorkspace(local, merged);
    saveDirectBase(merged.projects);
    announceMerge(merged);
    return { merged: merged, changed: changed };
  }

  function swapClashSides(merges) {
    return (merges || []).map(function (merge) {
      return {
        id: merge.id,
        name: merge.name,
        clashes: merge.clashes.map(function (clash) {
          return Object.assign({}, clash, {
            local: clash.remote,
            remote: clash.local,
            kept: clash.kept === 'local' ? 'remote' : 'local'
          });
        })
      };
    });
  }

  function directStatus(message, kind) {
    const node = document.getElementById('direct-status');
    if (!node) return;
    node.textContent = message;
    node.className = 'settings-status' + (kind ? ' ' + kind : '');
  }

  function stopDirectHost() {
    if (!directHost) return;
    const host = directHost;
    directHost = null;
    clearTimeout(host.timer);
    if (host.stopRelay) host.stopRelay();
    try {
      if (host.peer) host.peer.destroy();
    } catch (error) {
      /* already closed */
    }
  }

  function finishDirectHost(host) {
    // Close this session a moment later; the user may already have started a new one.
    setTimeout(function () {
      if (directHost === host) stopDirectHost();
    }, 3000);
  }

  async function openPeer(Peer, peerId) {
    const peer = peerId ? new Peer(peerId, { debug: 0 }) : new Peer({ debug: 0 });
    await new Promise(function (resolve, reject) {
      peer.on('open', resolve);
      peer.on('error', function (error) {
        reject(new Error(t('Could not reach the direct sync service. Check your connection.') + ' (' + (error.type || error.message) + ')'));
      });
      setTimeout(function () { reject(new Error(t('Could not reach the direct sync service. Check your connection.'))); }, 12000);
    });
    return peer;
  }

  async function startDirectHost() {
    if (typeof state === 'undefined' || !state.workspace) throw new Error('Open a workspace first.');
    stopDirectHost();
    const code = randomCode(10, PAIR_ALPHABET);
    const hostKey = randomCode(20, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const host = { peer: null, code: code, stopRelay: null, viaRelayOnly: false };
    host.timer = setTimeout(function () {
      if (directHost !== host) return;
      stopDirectHost();
      directStatus(t('Direct sync stopped after 10 minutes. Start again when both devices are ready.'));
    }, DIRECT_WAIT_MS);
    directHost = host;
    // Two independent paths: WebRTC via the PeerJS broker, and the encrypted backup relay.
    // Whichever reaches the other device first wins; either one failing is fine.
    let peerError = null;
    try {
      const Peer = window.SWEEP_DISABLE_PEER ? null : await loadPeerLibrary();
      if (!Peer) throw new Error('disabled');
      host.peer = await openPeer(Peer, DIRECT_PEER_PREFIX + hostKey);
    } catch (error) {
      peerError = error;
      host.peer = null;
    }
    let relayError = null;
    try {
      await hostRelayListen(host, hostKey);
    } catch (error) {
      relayError = error;
    }
    if (!host.peer && relayError) {
      stopDirectHost();
      throw peerError || relayError;
    }
    host.viaRelayOnly = !host.peer;
    if (host.peer) {
      host.peer.on('connection', function (connection) {
        connection.on('data', async function (message) {
          if (!message || message.type !== 'hello') return;
          try {
            directStatus(t('Other device connected — merging…'));
            const remote = await decryptPayload(message.payload, code);
            const result = await mergeIncoming(remote);
            const reply = await encryptPayload({ projects: result.merged.projects, tombstones: result.merged.tombstones }, code);
            connection.send({ type: 'merged', payload: reply, merges: swapClashSides(result.merged.merges) });
            directStatus('✓ ' + t('Synced with your other device · {count} project(s)', { count: result.merged.projects.length }), 'ok');
            toast(t('Synced with your other device'));
            finishDirectHost(host);
          } catch (error) {
            connection.send({ type: 'error', message: error.message });
            directStatus('✗ ' + error.message, 'error');
          }
        });
      });
    }
    return { url: shareBase() + '#direct=' + hostKey + '.' + code, code: code, viaRelayOnly: host.viaRelayOnly };
  }

  // Errors the other device reported (wrong code, merge failure): retrying another way won't help.
  function fatalError(message) {
    const error = new Error(message);
    error.fatal = true;
    return error;
  }

  async function joinViaPeer(hostKey, code, onStatus) {
    if (window.SWEEP_DISABLE_PEER) throw new Error('disabled');
    const Peer = await loadPeerLibrary();
    const peer = await openPeer(Peer, null);
    try {
      if (onStatus) onStatus(t('Connecting…'));
      const connection = peer.connect(DIRECT_PEER_PREFIX + hostKey, { reliable: true });
      const local = localWorkspace();
      const reply = await new Promise(function (resolve, reject) {
        const timer = setTimeout(function () { reject(new Error('timeout')); }, 25000);
        peer.on('error', function (error) {
          clearTimeout(timer);
          reject(new Error(error.type || error.message));
        });
        connection.on('open', async function () {
          connection.send({ type: 'hello', payload: await encryptPayload(local, code) });
        });
        connection.on('data', function (message) {
          if (!message) return;
          clearTimeout(timer);
          if (message.type === 'error') reject(fatalError(message.message));
          else if (message.type === 'merged') resolve(message);
        });
      });
      return { remote: await decryptPayload(reply.payload, code), merges: reply.merges || [], via: 'direct' };
    } finally {
      setTimeout(function () {
        try {
          peer.destroy();
        } catch (error) {
          /* already closed */
        }
      }, 1500);
    }
  }

  async function joinDirect(hostKey, code, onStatus) {
    if (typeof state === 'undefined' || !state.workspace) throw new Error('Open a workspace first.');
    let answer;
    try {
      answer = await joinViaPeer(hostKey, code, onStatus);
    } catch (error) {
      if (error.fatal) throw error;
      // WebRTC blocked, broker down or host on relay only: use the encrypted backup relay.
      answer = await joinViaRelay(hostKey, code, onStatus);
    }
    // The host already merged both sides; adopt its result so both devices end identical.
    const changed = await adoptWorkspace(localWorkspace(), answer.remote);
    saveDirectBase(answer.remote.projects);
    if (answer.merges && answer.merges.length) rememberClashes(answer.merges);
    return { changed: changed, count: answer.remote.projects.length, via: answer.via };
  }

  async function showDirectPanel() {
    const panel = document.getElementById('direct-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="settings-note">' + esc(t('Starting direct sync…')) + '</p>';
    try {
      const host = await startDirectHost();
      const qr = window.SweepQR ? window.SweepQR.svg(host.url, { ecc: 'M', border: 4, label: t('QR code to sync another device directly') }) : '';
      panel.innerHTML =
        '<div class="sync-link-grid">' +
          (qr ? qrBlock(qr) : '') +
          '<div class="sync-link-copy">' +
            '<p class="settings-note"><b>' + esc(t('Scan this with your other device')) + '</b> ' + esc(t('(or open the link there). Keep this screen open until it says synced.')) + '</p>' +
            '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-pro="sync-copy-link" data-link="' + esc(host.url) + '">' + esc(t('Copy link')) + '</button>' +
              '<button type="button" class="btn btn-text btn-sm" data-pro="direct-stop">' + esc(t('Stop')) + '</button></div>' +
            '<p class="settings-status" id="direct-status" role="status">' + esc(t('Waiting for your other device…')) + (host.viaRelayOnly ? ' ' + esc(t('(using the backup relay)')) : '') + '</p>' +
            '<p class="settings-note small">' + esc(t('Works while both devices are online — directly when the network allows, otherwise through an encrypted backup relay.')) + '</p>' +
          '</div>' +
        '</div>';
    } catch (error) {
      panel.innerHTML = '<p class="settings-status error">✗ ' + esc(error.message) + '</p>';
    }
  }

  function captureDirectHash() {
    const match = location.hash.match(/^#direct=([a-z0-9]{20})\.([A-Z2-9]{10})$/);
    if (!match) return;
    try {
      sessionStorage.setItem(DIRECT_PENDING_KEY, JSON.stringify({ host: match[1], code: match[2] }));
    } catch (error) {
      /* storage unavailable */
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  let directReturnFocus = null;
  function openDirectPrompt() {
    const pending = readJson(sessionStorage, DIRECT_PENDING_KEY, null);
    if (!pending || document.getElementById('direct-modal')) return;
    if (typeof state === 'undefined' || !state.workspace) return;
    directReturnFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.id = 'direct-modal';
    modal.className = 'studio-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'direct-title');
    modal.innerHTML = '<div class="studio-modal-card settings-card">' +
      '<button type="button" class="studio-modal-close" data-direct="close" aria-label="' + esc(t('Close')) + '">×</button>' +
      '<h2 id="direct-title">' + esc(t('Sync with your other device?')) + '</h2>' +
      '<p class="settings-note">' + esc(t('Your projects on both devices will be merged. Nothing is deleted unless you deleted it on one of them.')) + '</p>' +
      '<div class="settings-actions"><button type="button" class="btn btn-primary btn-sm" data-direct="join">' + esc(t('Sync now')) + '</button>' +
        '<button type="button" class="btn btn-text btn-sm" data-direct="close">' + esc(t('Cancel')) + '</button>' +
        '<span class="settings-status" id="direct-join-status" role="status"></span></div>' +
    '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('studio-modal-open');
    const status = modal.querySelector('#direct-join-status');
    modal.addEventListener('click', async function (event) {
      const action = event.target.closest('[data-direct]');
      if (event.target === modal || (action && action.getAttribute('data-direct') === 'close')) {
        closeDirectPrompt(true);
        return;
      }
      if (!action || action.getAttribute('data-direct') !== 'join' || action.disabled) return;
      action.disabled = true;
      status.className = 'settings-status';
      status.textContent = t('Connecting…');
      try {
        const result = await joinDirect(pending.host, pending.code, function (message) {
          status.className = 'settings-status';
          status.textContent = message;
        });
        status.className = 'settings-status ok';
        status.textContent = '✓ ' + t('Synced with your other device · {count} project(s)', { count: result.count });
        toast(t('Synced with your other device'));
        setTimeout(function () { closeDirectPrompt(true); }, 1200);
      } catch (error) {
        action.disabled = false;
        status.className = 'settings-status error';
        status.textContent = '✗ ' + error.message;
      }
    });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDirectPrompt(true);
    });
    modal.querySelector('[data-direct="join"]').focus();
  }

  function closeDirectPrompt(clearPending) {
    const modal = document.getElementById('direct-modal');
    if (clearPending) {
      try {
        sessionStorage.removeItem(DIRECT_PENDING_KEY);
      } catch (error) {
        /* storage unavailable */
      }
    }
    if (!modal) return;
    modal.remove();
    if (!document.getElementById('settings-modal')) document.body.classList.remove('studio-modal-open');
    if (directReturnFocus && document.contains(directReturnFocus)) directReturnFocus.focus();
    directReturnFocus = null;
  }

  // =====================================================================
  // Backup relay (ntfy.sh): an encrypted mailbox used when WebRTC cannot connect, for
  // "send now, pick up later" and for short device-linking links.
  // =====================================================================
  // ntfy.sh is a free, open-source push service with open CORS. Sweep only ever puts ciphertext
  // there (AES-GCM; the key comes from the one-time code in the link fragment, which never reaches
  // the relay). Files expire after 3 hours on ntfy.sh. Set window.SWEEP_RELAY_URL to use a
  // self-hosted ntfy server instead.
  const RELAY_URL = 'https://ntfy.sh';
  const RELAY_FILE_TTL_MS = 3 * 60 * 60 * 1000;
  const DROP_OUTBOX_KEY = 'sweep_drop_outbox_v1';
  const DROP_PENDING_KEY = 'sweep_drop_pending_v1';
  const TOPIC_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let lastDropCheck = 0;

  function relayEndpoint() {
    return String(window.SWEEP_RELAY_URL || RELAY_URL).replace(/\/$/, '');
  }

  async function relayFetch(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs || 20000);
    try {
      return await fetch(url, Object.assign({}, init || {}, { signal: controller.signal }));
    } catch (error) {
      throw new Error(t('Could not reach the backup relay. Check your connection.'));
    } finally {
      clearTimeout(timer);
    }
  }

  // Topic for a direct-sync session: derived from the host key so the relay never sees the key.
  async function directRelayTopic(hostKey, suffix) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sweep-relay:' + hostKey));
    const hex = Array.prototype.map.call(new Uint8Array(digest).subarray(0, 12), function (byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join('');
    return 'sweep' + hex + suffix;
  }

  async function gzipText(textValue) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([textValue]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzipBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  // Compress (when the browser can) and encrypt with the one-time code.
  async function sealForRelay(object, code) {
    const json = JSON.stringify(object);
    let packed = null;
    try {
      packed = await gzipText(json);
    } catch (error) {
      packed = null;
    }
    return encryptPayload(packed ? { z: toBase64(packed) } : { j: json }, code);
  }

  async function openFromRelay(textValue, code) {
    let inner;
    try {
      inner = await decryptPayload(textValue, code);
    } catch (error) {
      throw new Error(t('That code does not match. Check the code on the other device.'));
    }
    if (inner && typeof inner.z === 'string') return JSON.parse(await gunzipBytes(fromBase64(inner.z)));
    if (inner && typeof inner.j === 'string') return JSON.parse(inner.j);
    return inner;
  }

  async function relayPut(topic, textValue) {
    const response = await relayFetch(relayEndpoint() + '/' + topic, {
      method: 'PUT',
      body: textValue,
      headers: { 'Filename': 'sweep.txt', 'X-Message': 'sweep' }
    }, 45000);
    if (!response.ok) {
      throw new Error(t('The backup relay is busy. Try again in a minute.') + ' (' + response.status + ')');
    }
    return response.json();
  }

  async function relayList(topic, sinceSeconds) {
    const response = await relayFetch(relayEndpoint() + '/' + topic + '/json?poll=1&since=' + (sinceSeconds || 'all'), {}, 20000);
    if (!response.ok) throw new Error(t('The backup relay is busy. Try again in a minute.') + ' (' + response.status + ')');
    const body = await response.text();
    return body.split('\n').map(function (line) {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    }).filter(function (message) {
      return message && message.event === 'message' && message.attachment && message.attachment.url;
    });
  }

  async function relayDownload(message) {
    const response = await relayFetch(message.attachment.url, {}, 45000);
    if (!response.ok) throw new Error(t('This transfer has expired. Send it again from the other device.'));
    return response.text();
  }

  // ntfy.sh needs about a second before a new file shows up in a poll, so one-shot reads retry briefly.
  async function relayLatest(topic, sinceSeconds, retries) {
    let list = await relayList(topic, sinceSeconds);
    for (let attempt = 0; !list.length && attempt < (retries === undefined ? 3 : retries); attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, 1200); });
      list = await relayList(topic, sinceSeconds);
    }
    if (!list.length) return null;
    const last = list[list.length - 1];
    return { message: last, text: await relayDownload(last) };
  }

  // Calls onMessage once per new file on the topic: an initial poll for files already waiting,
  // then a live stream (EventSource), with a slow poll as a safety net for proxies that block it.
  function relayWatch(topic, sinceSeconds, onMessage) {
    let closed = false;
    let source = null;
    const seen = {};
    const handle = function (message) {
      if (closed || !message || message.event !== 'message' || !message.attachment || seen[message.id]) return;
      seen[message.id] = true;
      onMessage(message);
    };
    const poll = function () {
      relayList(topic, sinceSeconds).then(function (list) { list.forEach(handle); }).catch(function () { /* retry later */ });
    };
    poll();
    if (typeof EventSource !== 'undefined') {
      try {
        source = new EventSource(relayEndpoint() + '/' + topic + '/sse?since=' + sinceSeconds);
        source.onmessage = function (event) {
          try {
            handle(JSON.parse(event.data));
          } catch (error) {
            /* ignore keepalives */
          }
        };
      } catch (error) {
        source = null;
      }
    }
    const timer = setInterval(poll, 8000);
    return function stop() {
      closed = true;
      clearInterval(timer);
      if (source) source.close();
    };
  }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  // ----- direct sync over the relay (fallback when WebRTC or the PeerJS broker fails) -----
  async function hostRelayListen(host, hostKey) {
    const inbox = await directRelayTopic(hostKey, 'h');
    const outbox = await directRelayTopic(hostKey, 'r');
    host.stopRelay = relayWatch(inbox, nowSeconds() - 5, async function (message) {
      if (directHost !== host) return;
      try {
        const hello = JSON.parse(await relayDownload(message));
        if (!hello || hello.type !== 'hello') return;
        directStatus(t('Other device connected — merging…'));
        const remote = await openFromRelay(hello.payload, host.code);
        const result = await mergeIncoming(remote);
        const reply = {
          type: 'merged',
          payload: await sealForRelay({ projects: result.merged.projects, tombstones: result.merged.tombstones }, host.code),
          merges: swapClashSides(result.merged.merges)
        };
        await relayPut(outbox, JSON.stringify(reply));
        directStatus('✓ ' + t('Synced with your other device · {count} project(s)', { count: result.merged.projects.length }), 'ok');
        toast(t('Synced with your other device'));
        finishDirectHost(host);
      } catch (error) {
        relayPut(outbox, JSON.stringify({ type: 'error', message: error.message })).catch(function () { /* best effort */ });
        directStatus('✗ ' + error.message, 'error');
      }
    });
  }

  async function joinViaRelay(hostKey, code, onStatus) {
    if (onStatus) onStatus(t('Trying the backup relay…'));
    const inbox = await directRelayTopic(hostKey, 'h');
    const outbox = await directRelayTopic(hostKey, 'r');
    const since = nowSeconds() - 2;
    const hello = { type: 'hello', payload: await sealForRelay(localWorkspace(), code) };
    return new Promise(function (resolve, reject) {
      let stop = null;
      const timer = setTimeout(function () {
        if (stop) stop();
        reject(new Error(t('The other device did not answer. Keep its Sync screen open and try again.')));
      }, 75000);
      stop = relayWatch(outbox, since, async function (message) {
        try {
          const reply = JSON.parse(await relayDownload(message));
          if (!reply) return;
          clearTimeout(timer);
          stop();
          if (reply.type === 'error') {
            reject(new Error(reply.message));
            return;
          }
          resolve({ remote: await openFromRelay(reply.payload, code), merges: reply.merges || [], via: 'relay' });
        } catch (error) {
          clearTimeout(timer);
          stop();
          reject(error);
        }
      });
      relayPut(inbox, JSON.stringify(hello)).catch(function (error) {
        clearTimeout(timer);
        stop();
        reject(error);
      });
    });
  }

  // ----- send now, pick up later -----
  async function sendDrop() {
    if (typeof state === 'undefined' || !state.workspace) throw new Error('Open a workspace first.');
    const topicId = randomCode(22, TOPIC_ALPHABET);
    const code = randomCode(10, PAIR_ALPHABET);
    const local = localWorkspace();
    await relayPut('sweep' + topicId, await sealForRelay(Object.assign({}, local, { savedAt: Date.now() }), code));
    // What we sent becomes the common ancestor for merging the other device's answer later.
    saveDirectBase(local.projects);
    const outbox = readJson(localStorage, DROP_OUTBOX_KEY, []).filter(function (item) {
      return item.expires > Date.now();
    });
    outbox.push({ topic: topicId, code: code, at: Date.now(), expires: Date.now() + RELAY_FILE_TTL_MS * 2 });
    writeJson(localStorage, DROP_OUTBOX_KEY, outbox);
    return { url: shareBase() + '#drop=' + topicId + '.' + code, expires: Date.now() + RELAY_FILE_TTL_MS };
  }

  async function receiveDrop(topicId, code) {
    if (typeof state === 'undefined' || !state.workspace) throw new Error('Open a workspace first.');
    const latest = await relayLatest('sweep' + topicId);
    if (!latest) throw new Error(t('This transfer has expired. Send it again from the other device.'));
    const remote = await openFromRelay(latest.text, code);
    const result = await mergeIncoming(remote);
    // Answer with the merged result so the sending device can pick up this device's projects too.
    try {
      await relayPut('sweep' + topicId + 'r', await sealForRelay({
        projects: result.merged.projects,
        tombstones: result.merged.tombstones,
        merges: swapClashSides(result.merged.merges)
      }, code));
    } catch (error) {
      /* the sender just won't get this device's projects back */
    }
    return { count: result.merged.projects.length, changed: result.changed };
  }

  // On the sending device: merge answers that arrived while it was closed.
  async function checkDropReplies(force) {
    if (typeof state === 'undefined' || !state.workspace) return 0;
    if (!force && Date.now() - lastDropCheck < 60000) return 0;
    lastDropCheck = Date.now();
    const outbox = readJson(localStorage, DROP_OUTBOX_KEY, []);
    const keep = [];
    let picked = 0;
    for (let i = 0; i < outbox.length; i++) {
      const item = outbox[i];
      if (item.expires <= Date.now()) continue;
      try {
        const reply = await relayLatest('sweep' + item.topic + 'r', 0, 1);
        if (!reply) {
          keep.push(item);
          continue;
        }
        const remote = await openFromRelay(reply.text, item.code);
        await mergeIncoming(remote);
        if (remote.merges && remote.merges.length) rememberClashes(remote.merges);
        picked++;
      } catch (error) {
        keep.push(item);
      }
    }
    writeJson(localStorage, DROP_OUTBOX_KEY, keep);
    if (picked) toast(t('Picked up changes from your other device'));
    return picked;
  }

  function captureDropHash() {
    const match = location.hash.match(/^#drop=([a-z0-9]{22})\.([A-Z2-9]{10})$/);
    if (!match) return;
    try {
      sessionStorage.setItem(DROP_PENDING_KEY, JSON.stringify({ topic: match[1], code: match[2] }));
    } catch (error) {
      /* storage unavailable */
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  let dropReturnFocus = null;
  function openDropPrompt() {
    const pending = readJson(sessionStorage, DROP_PENDING_KEY, null);
    if (!pending || document.getElementById('drop-modal')) return;
    if (typeof state === 'undefined' || !state.workspace) return;
    dropReturnFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.id = 'drop-modal';
    modal.className = 'studio-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'drop-title');
    modal.innerHTML = '<div class="studio-modal-card settings-card">' +
      '<button type="button" class="studio-modal-close" data-drop="close" aria-label="' + esc(t('Close')) + '">×</button>' +
      '<h2 id="drop-title">' + esc(t('Get projects from your other device?')) + '</h2>' +
      '<p class="settings-note">' + esc(t('They will be merged with the projects on this device. Nothing is deleted unless you deleted it on one of them.')) + '</p>' +
      '<div class="settings-actions"><button type="button" class="btn btn-primary btn-sm" data-drop="get">' + esc(t('Get them')) + '</button>' +
        '<button type="button" class="btn btn-text btn-sm" data-drop="close">' + esc(t('Cancel')) + '</button>' +
        '<span class="settings-status" id="drop-status" role="status"></span></div>' +
    '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('studio-modal-open');
    const status = modal.querySelector('#drop-status');
    modal.addEventListener('click', async function (event) {
      const action = event.target.closest('[data-drop]');
      if (event.target === modal || (action && action.getAttribute('data-drop') === 'close')) {
        closeDropPrompt(true);
        return;
      }
      if (!action || action.getAttribute('data-drop') !== 'get' || action.disabled) return;
      action.disabled = true;
      status.className = 'settings-status';
      status.textContent = t('Downloading…');
      try {
        const result = await receiveDrop(pending.topic, pending.code);
        status.className = 'settings-status ok';
        status.textContent = '✓ ' + t('Merged · {count} project(s)', { count: result.count });
        toast(t('Projects from your other device are here'));
        setTimeout(function () { closeDropPrompt(true); }, 1200);
      } catch (error) {
        action.disabled = false;
        status.className = 'settings-status error';
        status.textContent = '✗ ' + error.message;
      }
    });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDropPrompt(true);
    });
    modal.querySelector('[data-drop="get"]').focus();
  }

  function closeDropPrompt(clearPending) {
    const modal = document.getElementById('drop-modal');
    if (clearPending) {
      try {
        sessionStorage.removeItem(DROP_PENDING_KEY);
      } catch (error) {
        /* storage unavailable */
      }
    }
    if (!modal) return;
    modal.remove();
    if (!document.getElementById('settings-modal')) document.body.classList.remove('studio-modal-open');
    if (dropReturnFocus && document.contains(dropReturnFocus)) dropReturnFocus.focus();
    dropReturnFocus = null;
  }

  async function showDropPanel() {
    const panel = document.getElementById('drop-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="settings-note">' + esc(t('Encrypting and uploading…')) + '</p>';
    try {
      const drop = await sendDrop();
      const qr = window.SweepQR ? window.SweepQR.svg(drop.url, { ecc: 'M', border: 4, label: t('QR code to pick up your projects on another device') }) : '';
      panel.innerHTML =
        '<div class="sync-link-grid">' +
          (qr ? qrBlock(qr) : '') +
          '<div class="sync-link-copy">' +
            '<p class="settings-note"><b>' + esc(t('Open this on your other device within 3 hours.')) + '</b> ' + esc(t('It does not need to be online now. When it opens the link, this device picks up its projects the next time you open Sweep.')) + '</p>' +
            '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-pro="sync-copy-link" data-link="' + esc(drop.url) + '">' + esc(t('Copy link')) + '</button></div>' +
            '<p class="settings-note small">' + esc(t('Encrypted on this device; the relay only stores unreadable data for 3 hours.')) + '</p>' +
          '</div>' +
        '</div>';
    } catch (error) {
      panel.innerHTML = '<p class="settings-status error">✗ ' + esc(error.message) + '</p>';
    }
  }

  // "Got a link?" — open any Sweep sync link pasted from a chat or email.
  function openPastedLink(value) {
    const raw = String(value || '').trim();
    const hashAt = raw.indexOf('#');
    const hash = hashAt >= 0 ? raw.slice(hashAt) : '#' + raw;
    let match = hash.match(/^#pair=([A-Za-z0-9_\-.]+)$/);
    if (match) {
      sessionStorage.setItem(PAIR_PENDING_KEY, match[1]);
      closeSettings();
      openPairPrompt();
      return 'pair';
    }
    match = hash.match(/^#direct=([a-z0-9]{20})\.([A-Z2-9]{10})$/);
    if (match) {
      sessionStorage.setItem(DIRECT_PENDING_KEY, JSON.stringify({ host: match[1], code: match[2] }));
      closeSettings();
      openDirectPrompt();
      return 'direct';
    }
    match = hash.match(/^#drop=([a-z0-9]{22})\.([A-Z2-9]{10})$/);
    if (match) {
      sessionStorage.setItem(DROP_PENDING_KEY, JSON.stringify({ topic: match[1], code: match[2] }));
      closeSettings();
      openDropPrompt();
      return 'drop';
    }
    throw new Error(t('That is not a Sweep sync link.'));
  }

  // ----- encrypted sync files -----
  async function exportSyncFile(passphrase) {
    if (!passphrase || passphrase.length < 6) throw new Error(t('Use a file passphrase of at least 6 characters.'));
    const payload = await encryptPayload(Object.assign(localWorkspace(), { savedAt: Date.now() }), passphrase);
    const day = new Date().toISOString().slice(0, 10);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sweep-sync-' + day + '.sweep';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return link.download;
  }

  async function importSyncFile(file, passphrase) {
    if (!file) throw new Error(t('Choose a sync file first.'));
    if (!passphrase) throw new Error(t('Enter the passphrase the file was saved with.'));
    const text = await file.text();
    let remote;
    try {
      remote = await decryptPayload(text, passphrase);
    } catch (error) {
      if (/Not a Sweep sync file|JSON/.test(error.message)) throw new Error(t('That file is not a Sweep sync file.'));
      throw new Error(t('Wrong passphrase for this file.'));
    }
    return mergeIncoming(remote);
  }

  function noAccountHtml() {
    const secrets = syncSecrets();
    return '<div class="sync-noaccount">' +
      '<h3>' + esc(t('No GitHub account?')) + '</h3>' +
      '<p class="settings-note">' + esc(t('Sync two devices while both are open, send your projects to pick up later (within 3 hours), or move an encrypted sync file. Same encryption and merge as above.')) + '</p>' +
      '<div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" data-pro="direct-start">' + esc(t('Sync with another device now')) + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-pro="drop-send">' + esc(t('Send — pick up later')) + '</button></div>' +
      '<div id="direct-panel" class="sync-link-panel" hidden></div>' +
      '<div id="drop-panel" class="sync-link-panel" hidden></div>' +
      '<label class="settings-field"><span>' + esc(t('Got a link from your other device? Paste it here')) + '</span>' +
        '<span class="input-with-button"><input type="url" id="sync-paste-link" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…#direct=…" data-no-i18n>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-pro="paste-link">' + esc(t('Open')) + '</button></span></label>' +
      '<p class="settings-status" id="paste-status" role="status"></p>' +
      '<label class="settings-field"><span>' + esc(t('Sync file passphrase')) + '</span>' +
        '<input type="password" id="sync-file-pass" autocomplete="new-password" value="' + esc(secrets.passphrase || '') + '"></label>' +
      '<div class="settings-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm" data-pro="file-export">' + esc(t('Download sync file')) + '</button>' +
        '<label class="btn btn-secondary btn-sm file-pick">' + esc(t('Open sync file')) +
          '<input type="file" id="sync-file-input" accept=".sweep,application/json" hidden></label>' +
        '<span class="settings-status" id="file-status" role="status"></span>' +
      '</div>' +
    '</div>';
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
      '<div id="sync-link-panel" class="sync-link-panel" hidden></div>' +
      noAccountHtml();
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

  async function onSyncFileChosen(input) {
    const file = input.files && input.files[0];
    const field = document.getElementById('sync-file-pass');
    setStatus('file-status', t('Merging…'));
    try {
      const result = await importSyncFile(file, field ? field.value : '');
      setStatus('file-status', '✓ ' + t('Merged the sync file · {count} project(s)', { count: result.merged.projects.length }), 'ok');
    } catch (error) {
      setStatus('file-status', '✗ ' + error.message, 'error');
    } finally {
      input.value = '';
    }
  }

  function onSettingsChange(event) {
    if (event.target && event.target.id === 'sync-file-input') {
      onSyncFileChosen(event.target);
      return;
    }
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
    if (name === 'qr-zoom') {
      const grid = action.closest('.sync-link-grid');
      if (grid) {
        const big = grid.classList.toggle('is-big');
        action.setAttribute('aria-pressed', big ? 'true' : 'false');
        action.textContent = big ? t('Show smaller QR') : t('Show bigger QR');
        if (big) grid.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (name === 'sync-copy-link') {
      const link = action.getAttribute('data-link');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(function () { toast(t('Link copied')); });
      }
      return;
    }
    if (name === 'drop-send') {
      showDropPanel();
      return;
    }
    if (name === 'paste-link') {
      const field = document.getElementById('sync-paste-link');
      try {
        openPastedLink(field ? field.value : '');
      } catch (error) {
        setStatus('paste-status', '✗ ' + error.message, 'error');
      }
      return;
    }
    if (name === 'direct-start') {
      showDirectPanel();
      return;
    }
    if (name === 'direct-stop') {
      stopDirectHost();
      const panel = document.getElementById('direct-panel');
      if (panel) {
        panel.hidden = true;
        panel.innerHTML = '';
      }
      return;
    }
    if (name === 'file-export') {
      const field = document.getElementById('sync-file-pass');
      try {
        const fileName = await exportSyncFile(field ? field.value : '');
        setStatus('file-status', '✓ ' + t('Saved {file} — open it on your other device with the same passphrase.', { file: fileName }), 'ok');
      } catch (error) {
        setStatus('file-status', '✗ ' + error.message, 'error');
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
  captureDirectHash();
  captureDropHash();

  function init() {
    settingsButton();
    renderClashBanner();
    setTimeout(openPairPrompt, 400);
    setTimeout(openDirectPrompt, 500);
    setTimeout(openDropPrompt, 600);
    setTimeout(function () { checkDropReplies(true).catch(function () { /* offline */ }); }, 1500);
    wrapPersistence();
    document.addEventListener('visibilitychange', syncOnFocus);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkDropReplies(false).catch(function () { /* offline */ });
    });
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
      validateTranslation: validateTranslation,
      meaningCheck: meaningCheck,
      meaningScore: meaningScore,
      glossary: SPEC_GLOSSARY,
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
      startDirect: startDirectHost,
      joinDirect: joinDirect,
      stopDirect: stopDirectHost,
      sendDrop: sendDrop,
      receiveDrop: receiveDrop,
      checkDropReplies: checkDropReplies,
      openLink: openPastedLink,
      relay: { put: relayPut, latest: relayLatest, seal: sealForRelay, open: openFromRelay, endpoint: relayEndpoint },
      exportFile: exportSyncFile,
      importFile: importSyncFile,
      mergeIncoming: mergeIncoming,
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
