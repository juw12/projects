// GlowRoom engine: turns a goal into real work done by an AI crew, entirely in the browser.
//
//   Nova (leader)    plans the work and writes the final answer
//   Scout (explore)  searches the live web and reads pages
//   Byte (coder)     writes JavaScript and executes it in a sandboxed Web Worker
//   Probe (tester)   writes tests and runs them against Byte's code
//   Sentinel (checker) reviews and fact-checks
//   Pixel (media)    writes copy and draws SVG graphics
//
// AI provider: Glow AI by default — the same AI and account as GlowChat (same origin, so the
// sign-in is shared). Guests get Glow Free instantly; signing in unlocks GPT-5 mini, Claude, Gemini…
// Or bring your own key
// (OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, or any OpenAI-compatible server).
// Web access: DuckDuckGo results + page reading via the Jina reader, Wikipedia as fallback.
(function () {
  'use strict';

  const SETTINGS_KEY = 'crew-ai-settings';
  const SESSION_KEY = 'crew-ai-key-session';
  const RUNS_KEY = 'crew-runs-v1';
  const MAX_RUNS = 30;

  const PROVIDERS = {
    glow: {
      label: 'Glow AI (default)',
      format: 'openai',
      url: 'https://text.pollinations.ai/openai',
      model: 'openai',
      needsKey: false,
      note: 'Works right away as Glow Free. Sign in with your Glow account for stronger models — one account for GlowChat and GlowRoom.'
    },
    openai: {
      label: 'OpenAI',
      format: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      needsKey: true,
      note: 'Key from platform.openai.com → API keys.'
    },
    anthropic: {
      label: 'Anthropic Claude',
      format: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      model: 'claude-haiku-4-5',
      needsKey: true,
      note: 'Key from console.anthropic.com.'
    },
    gemini: {
      label: 'Google Gemini',
      format: 'openai',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash',
      needsKey: true,
      note: 'Key from aistudio.google.com (has a free tier).'
    },
    openrouter: {
      label: 'OpenRouter',
      format: 'openai',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-4o-mini',
      needsKey: true,
      note: 'One key for many models — openrouter.ai/keys.'
    },
    groq: {
      label: 'Groq',
      format: 'openai',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
      needsKey: true,
      note: 'Very fast; free tier at console.groq.com.'
    },
    custom: {
      label: 'Custom (OpenAI-compatible URL)',
      format: 'openai',
      url: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3.1',
      needsKey: false,
      note: 'Ollama / LM Studio / your own server. Ollama needs OLLAMA_ORIGINS set to allow this site.'
    }
  };

  const BOTS = {
    leader: { name: 'Nova', role: 'Team Lead', color: '#8b5cf6', skill: 'plans the work, coordinates, writes the final answer' },
    explore: { name: 'Scout', role: 'Research Agent', color: '#ec4899', skill: 'searches the live web, reads sources, reports facts with citations' },
    coder: { name: 'Byte', role: 'Software Developer', color: '#3b82f6', skill: 'writes JavaScript and actually runs it to compute results, convert data, or prototype logic' },
    tester: { name: 'Probe', role: 'QA Engineer', color: '#10b981', skill: 'writes and runs tests against code, checks edge cases' },
    checker: { name: 'Sentinel', role: 'Reviewer', color: '#f59e0b', skill: 'reviews work for errors, risks and gaps; fact-checks claims' },
    media: { name: 'Pixel', role: 'Content Creator', color: '#ef4444', skill: 'writes copy (posts, emails, docs) and draws SVG graphics/logos/diagrams' }
  };

  const LANGUAGE_RULE = 'Always reply in the same language the user wrote the goal in.';

  // ==================================================================
  // Small utilities
  // ==================================================================
  const uid = () => Math.random().toString(36).slice(2, 10);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // A short, readable title for a mission: its first line, without Markdown.
  function goalTitle(goal, max = 120) {
    const first = String(goal || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    const plain = first.replace(/\*\*|__|`|^#+\s*/g, '').trim();
    return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain;
  }

  // Glow Free is shared and anonymous: about one reply every ~30 s per visitor.
  // Its calls go one at a time, and "Retry after N s" answers are waited out instead of failing the mission.
  let glowFreeTail = Promise.resolve();
  let lastWaitNoticeAt = 0;
  function inGlowFreeLine(task) {
    const turn = glowFreeTail.then(task);
    glowFreeTail = turn.catch(() => {});
    return turn;
  }
  function freeLimitSeconds(status, detail, headerSeconds) {
    if (status !== 402 && status !== 429) return 0;
    const stated = /retry after\s+(\d+)\s*s/i.exec(detail || '');
    if (stated) return Number(stated[1]);
    if (headerSeconds) return headerSeconds;
    return /free limit|rate limit|too many/i.test(detail || '') || status === 429 ? 15 : 0;
  }
  // Shared free endpoints sometimes accept a request and then never answer. A timer per request
  // (re-armed on every streamed chunk) aborts it so the crew can retry instead of freezing a mission.
  const REQUEST_TIMEOUT_MS = 75000;
  const STALL_TIMEOUT_MS = 45000;
  // A stream that keeps sending keep-alive pings but no text, or that runs far too long, is also stuck.
  const STREAM_MAX_MS = 240000;
  function requestTimer(outer) {
    const ctrl = new AbortController();
    const state = { timedOut: false, timer: null };
    const onOuter = () => ctrl.abort();
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener('abort', onOuter, { once: true });
    }
    return {
      signal: ctrl.signal,
      arm(ms) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timedOut = true;
          ctrl.abort();
        }, ms);
      },
      done() {
        clearTimeout(state.timer);
        if (outer) outer.removeEventListener('abort', onOuter);
      },
      get timedOut() {
        return state.timedOut;
      }
    };
  }
  function slowNotice(text) {
    if (Date.now() - lastWaitNoticeAt < 25000) return;
    lastWaitNoticeAt = Date.now();
    emitter.dispatchEvent(new CustomEvent('notice', { detail: text }));
  }
  // An empty reply from the shared Glow Free AI usually means it is busy: wait a bit before asking again.
  function waitAfterEmpty(settings, retriesLeft, signal) {
    const seconds = settings.provider === 'glow' ? (retriesLeft > 1 ? 12 : 30) : 3;
    slowNotice(`The AI sent an empty reply, so the crew asks again in ${seconds} s…`);
    return sleepUnlessAborted(seconds * 1000, signal);
  }
  const TIMEOUT_MESSAGE = 'The AI did not answer in time. Try again in a minute, or sign in for faster Glow AI models.';

  function sleepUnlessAborted(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Stopped', 'AbortError'));
        }, { once: true });
      }
    });
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function truncate(text, max) {
    const s = String(text || '');
    return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
  }

  function extractBlocks(text, langs) {
    const re = /```([\w-]*)\s*\n([\s\S]*?)```/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const lang = (m[1] || '').toLowerCase();
      if (!langs || langs.includes(lang)) out.push({ lang, code: m[2].trim() });
    }
    return out;
  }

  function extractJson(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (err) {
      return null;
    }
  }


  // ==================================================================
  // Glow link — GlowRoom and Glow share one origin, so they share the Glow
  // account (Puter sign-in), the chosen Glow model and a hand-off inbox.
  // ==================================================================
  const GLOW_STORE_KEY = 'mufakat.v1';      // Glow's own storage key (kept from its original name)
  const GLOW_INBOX_KEY = 'glow.inbox';      // results handed from GlowRoom to Glow
  const PUTER_SDK_URL = 'https://js.puter.com/v2/';
  const GLOW_MODELS = [
    ['gpt-5-mini', 'GPT-5 mini'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['claude-haiku-4-5', 'Claude Haiku 4.5'],
    ['deepseek-flash', 'DeepSeek V4.1 Flash'],
    ['gpt-5-nano', 'GPT-5 nano (fastest)'],
    ['grok-4-1-fast-non-reasoning', 'Grok 4.1 Fast'],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (premium)']
  ];
  const GLOW_DEFAULT_MODEL = 'gpt-5-mini';
  const glow = { signedIn: false, name: '', checking: false, notice: '' };
  let puterPromise = null;

  function glowUrl() {
    return /mobile\.html$/.test(location.pathname) ? '../chat/mobile.html' : '../chat/';
  }

  function readGlowStore() {
    try {
      return JSON.parse(localStorage.getItem(GLOW_STORE_KEY)) || null;
    } catch (err) {
      return null;
    }
  }

  // Update only Glow's account fields, leaving its chats and keys untouched.
  function writeGlowAccount(account, name) {
    try {
      const store = readGlowStore() || { settings: {}, conversations: [], arenaStats: {}, deleted: {} };
      store.settings = { ...(store.settings || {}), account, accountName: name };
      localStorage.setItem(GLOW_STORE_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn('[GlowRoom] Could not update the Glow account', err);
    }
  }

  function glowModel() {
    const chosen = getSettings().model;
    if (GLOW_MODELS.some(([id]) => id === chosen)) return chosen;
    const last = (readGlowStore()?.settings?.lastModel) || '';
    if (last.startsWith('puter::')) return last.slice(7);
    return GLOW_DEFAULT_MODEL;
  }

  function glowModelName(id) {
    const hit = GLOW_MODELS.find(([mid]) => mid === id);
    return hit ? hit[1] : id;
  }

  function ensurePuter() {
    if (window.puter) return Promise.resolve(window.puter);
    if (!puterPromise) {
      puterPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PUTER_SDK_URL;
        script.async = true;
        script.onload = () => (window.puter ? resolve(window.puter) : reject(new Error('Glow sign-in did not start.')));
        script.onerror = () => {
          puterPromise = null;
          script.remove();
          reject(new Error("Couldn't reach Glow sign-in. Check your connection or ad-blocker."));
        };
        document.head.appendChild(script);
      });
    }
    return puterPromise;
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
  }

  // Quietly pick up an existing Glow sign-in (only if this browser signed in to Glow before).
  async function restoreGlowSession() {
    const account = readGlowStore()?.settings?.account;
    if (account !== 'puter') return false;
    glow.checking = true;
    try {
      const sdk = await withTimeout(ensurePuter(), 10000, 'Glow sign-in is taking too long to load.');
      glow.signedIn = !!sdk.auth.isSignedIn();
      if (glow.signedIn) {
        const user = await Promise.resolve(sdk.auth.getUser()).catch(() => null);
        glow.name = (user && user.username) || readGlowStore()?.settings?.accountName || '';
      }
    } catch (err) {
      glow.signedIn = false;
    }
    glow.checking = false;
    emitter.dispatchEvent(new CustomEvent('settings'));
    return glow.signedIn;
  }

  async function glowSignIn() {
    const sdk = window.puter || (await ensurePuter());
    if (!sdk.auth.isSignedIn()) await sdk.auth.signIn();
    const user = await Promise.resolve(sdk.auth.getUser()).catch(() => null);
    glow.signedIn = true;
    glow.name = (user && user.username) || 'Glow user';
    glow.notice = '';
    writeGlowAccount('puter', glow.name);
    emitter.dispatchEvent(new CustomEvent('settings'));
  }

  async function glowSignOut() {
    try {
      if (window.puter) await Promise.resolve(window.puter.auth.signOut());
    } catch (err) {
      console.warn('[GlowRoom] Glow sign-out failed', err);
    }
    glow.signedIn = false;
    glow.name = '';
    writeGlowAccount('guest', '');
    emitter.dispatchEvent(new CustomEvent('settings'));
  }

  function puterErrorText(error) {
    const inner = (error && typeof error.error === 'object' && error.error) || error || {};
    const both = `${inner.code || ''} ${inner.message || error?.message || ''}`;
    if (/insufficient|funds|quota|allowance|usage.?limit|credits|exceeded/i.test(both)) return 'Your free Glow AI allowance is used up for now.';
    if (/auth|unauthori[sz]ed|401|token/i.test(both)) return 'Your Glow sign-in expired.';
    return 'Glow AI is unavailable right now.';
  }

  function mergeRoles(list) {
    const out = [];
    list.forEach(m => {
      const last = out[out.length - 1];
      if (last && last.role === m.role) {
        last.content += '\n\n' + m.content;
      } else {
        out.push({ role: m.role, content: String(m.content || '') });
      }
    });
    return out;
  }

  // Signed-in Glow AI through Puter (streams; reasoning parts are not shown).
  async function chatGlowAccount({ system, messages, onToken, signal }) {
    const sdk = await ensurePuter();
    if (!sdk.auth.isSignedIn()) {
      glow.signedIn = false;
      throw new Error('Your Glow sign-in expired.');
    }
    const aborted = new Promise((_, reject) => {
      if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    aborted.catch(() => {});
    let response;
    try {
      response = await Promise.race([
        withTimeout(sdk.ai.chat([{ role: 'system', content: system }, ...mergeRoles(messages)], { model: glowModel(), stream: true }), 45000, 'Glow AI took too long to answer.'),
        aborted
      ]);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error(puterErrorText(err));
    }
    if (!response || typeof response[Symbol.asyncIterator] !== 'function') {
      const text = String(response?.message?.content || response || '');
      if (!text.trim()) throw new Error('Glow AI returned an empty answer.');
      onToken && onToken(text, text);
      return text;
    }
    const iterator = response[Symbol.asyncIterator]();
    let full = '';
    while (true) {
      const step = await Promise.race([withTimeout(iterator.next(), 45000, 'Glow AI stopped responding.'), aborted]);
      if (step.done) break;
      const part = step.value || {};
      if (part.error) throw new Error(puterErrorText(part.error));
      const type = part.type || 'text';
      if (type === 'text' && typeof part.text === 'string' && part.text) {
        full += part.text;
        onToken && onToken(part.text, full);
      }
    }
    if (!full.trim()) throw new Error('Glow AI returned an empty answer.');
    return full;
  }

  // Hand a finished result to Glow as a new chat, so the user can keep talking about it there.
  function sendToGlow(run) {
    const answer = run.final || [...run.steps].reverse().find(s => s.output)?.output || '';
    const sources = [];
    run.steps.forEach(s => (s.artifacts || []).forEach(a => {
      if (a.type === 'sources') a.items.forEach(item => sources.push(`- [${item.title}](${item.url})`));
    }));
    const who = run.mode === 'team' ? 'the whole crew' : (BOTS[run.steps[0]?.bot]?.name || 'the crew');
    const body = `${answer}${sources.length ? '\n\n**Sources the crew read**\n' + [...new Set(sources)].slice(0, 12).join('\n') : ''}\n\n— From GlowRoom: ${who} worked on this.`;
    const conversation = {
      id: 'crew-' + run.id,
      type: 'chat',
      title: goalTitle(run.goal, 70),
      messages: [
        { role: 'user', content: run.goal },
        { role: 'assistant', content: body }
      ],
      source: 'crewroom',
      updated: Date.now()
    };
    let inbox = [];
    try {
      inbox = JSON.parse(localStorage.getItem(GLOW_INBOX_KEY) || '[]');
    } catch (err) {
      inbox = [];
    }
    if (!Array.isArray(inbox)) inbox = [];
    inbox = inbox.filter(c => c && c.id !== conversation.id).concat(conversation).slice(-10);
    localStorage.setItem(GLOW_INBOX_KEY, JSON.stringify(inbox));
    window.open(glowUrl() + '#from-crewroom', 'glow');
  }

  function glowStatus() {
    return {
      signedIn: glow.signedIn,
      name: glow.name,
      checking: glow.checking,
      model: glow.signedIn ? glowModelName(glowModel()) : 'Glow Free',
      url: glowUrl()
    };
  }

  // ==================================================================
  // Settings
  // ==================================================================
  function getSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch (err) {
      saved = {};
    }
    const provider = saved.provider === 'free' ? 'glow' : (PROVIDERS[saved.provider] ? saved.provider : 'glow');
    const key = saved.rememberKey ? (saved.apiKey || '') : (sessionStorage.getItem(SESSION_KEY) || '');
    return {
      provider,
      model: saved.model || '',
      baseUrl: saved.baseUrl || '',
      rememberKey: !!saved.rememberKey,
      apiKey: key,
      webAccess: saved.webAccess !== false,
      realMode: saved.realMode !== false
    };
  }

  function saveSettings(next) {
    const current = getSettings();
    const merged = { ...current, ...next };
    const stored = {
      provider: merged.provider,
      model: merged.model,
      baseUrl: merged.baseUrl,
      rememberKey: merged.rememberKey,
      webAccess: merged.webAccess,
      realMode: merged.realMode,
      apiKey: merged.rememberKey ? merged.apiKey : ''
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    if (merged.rememberKey) {
      sessionStorage.removeItem(SESSION_KEY);
    } else if (merged.apiKey) {
      sessionStorage.setItem(SESSION_KEY, merged.apiKey);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
    emitter.dispatchEvent(new CustomEvent('settings'));
  }

  function providerLabel() {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    if (s.provider === 'glow') return glow.signedIn ? `Glow AI · ${glowModelName(glowModel())}` : 'Glow Free';
    return `${p.label} · ${s.model || p.model}`;
  }

  function isReady() {
    const s = getSettings();
    return !PROVIDERS[s.provider].needsKey || !!s.apiKey;
  }

  // ==================================================================
  // LLM chat with streaming (OpenAI-compatible + Anthropic)
  // ==================================================================
  function chat(options) {
    const s = getSettings();
    const usesGlowFree = s.provider === 'glow' && (!glow.signedIn || options.glowFree);
    return usesGlowFree ? inGlowFreeLine(() => chatOnce(options)) : chatOnce(options);
  }

  async function chatOnce({ system, messages, onToken, signal, maxTokens = 2000, temperature = 0.4, noStream = false, emptyRetries = 2, glowFree = false }) {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    if (s.provider === 'glow' && glow.signedIn && !glowFree) {
      try {
        return await chatGlowAccount({ system, messages, onToken, signal });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        // Keep the crew working: fall back to Glow Free and tell the user why.
        glow.notice = err.message + ' Using Glow Free for now.';
        emitter.dispatchEvent(new CustomEvent('notice', { detail: glow.notice }));
      }
    }
    const url = (s.provider === 'custom' && s.baseUrl) ? s.baseUrl : p.url;
    const model = s.provider === 'glow' ? p.model : (s.model || p.model);
    if (p.needsKey && !s.apiKey) {
      throw new Error(`Add your ${p.label} API key in AI settings (or switch back to Glow AI).`);
    }

    let headers;
    let body;
    if (p.format === 'anthropic') {
      headers = {
        'content-type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      body = { model, system, messages, max_tokens: maxTokens, temperature, stream: !noStream };
    } else {
      headers = { 'content-type': 'application/json' };
      if (s.apiKey) headers.authorization = 'Bearer ' + s.apiKey;
      body = { model, messages: [{ role: 'system', content: system }, ...messages], stream: !noStream, temperature };
      if (s.provider === 'glow') {
        // Glow Free now runs a reasoning model that, at its default effort, often stops after thinking
        // (or tries a tool call) and sends no answer text. Low effort answers reliably.
        body.reasoning_effort = 'low';
        // The free endpoint caches identical requests, so a retry must differ or it returns the same empty reply.
        if (emptyRetries < 2) body.seed = Math.floor(Math.random() * 1e9);
      }
      if (s.provider === 'openrouter') {
        headers['HTTP-Referer'] = location.origin;
        headers['X-Title'] = 'GlowRoom';
      }
    }

    let res;
    let limitWaits = 0;
    let timer = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (timer) timer.done();
      timer = requestTimer(signal);
      timer.arm(REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: timer.signal });
      } catch (err) {
        timer.done();
        if (!timer.timedOut) {
          const dropped = err && err.name === 'TypeError' && !(signal && signal.aborted);
          if (!dropped || attempt >= 2) throw err;
          // The connection dropped (e.g. reset by the network): wait a moment and send it again.
          slowNotice('The connection to the AI dropped, so the request is being sent again…');
          await sleepUnlessAborted(3000, signal);
          continue;
        }
        if (attempt < 2) {
          slowNotice('The AI is slow to answer, so the request is being sent again…');
          continue;
        }
        throw new Error(TIMEOUT_MESSAGE);
      }
      if (res.ok) break;
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      let detail = '';
      try {
        const errJson = await res.clone().json();
        detail = errJson.error?.message || errJson.message || JSON.stringify(errJson).slice(0, 200);
      } catch (err) {
        detail = res.statusText;
      }
      const limitSeconds = s.provider === 'glow' ? freeLimitSeconds(res.status, detail, retryAfter) : 0;
      if (limitSeconds && limitWaits < 6) {
        limitWaits += 1;
        attempt -= 1; // waiting out the free limit doesn't use up the normal retries
        const seconds = Math.min(limitSeconds, 60) + 1;
        if (Date.now() - lastWaitNoticeAt > 25000) {
          lastWaitNoticeAt = Date.now();
          emitter.dispatchEvent(new CustomEvent('notice', {
            detail: `Glow Free is shared (about one reply every 30 s), so the crew waits ${seconds}s and carries on. Sign in for faster models.`
          }));
        }
        await sleepUnlessAborted(seconds * 1000, signal);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleepUnlessAborted(Math.max(retryAfter * 1000, [2500, 6000, 12000][attempt]), signal);
        continue;
      }
      if (/turnstile/i.test(detail) && /^(localhost|127\.)/.test(location.hostname)) {
        throw new Error('Glow Free does not accept requests from localhost. Open the live site (github.io), or add your own API key in AI settings.');
      }
      throw new Error(`AI provider error ${res.status}: ${detail}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!res.body || contentType.includes('application/json')) {
      timer.arm(REQUEST_TIMEOUT_MS);
      let json;
      try {
        json = await res.json();
      } catch (err) {
        timer.done();
        if (timer.timedOut) throw new Error(TIMEOUT_MESSAGE);
        throw err;
      }
      timer.done();
      const text = p.format === 'anthropic'
        ? (json.content || []).map(c => c.text || '').join('')
        : (json.choices?.[0]?.message?.content || '');
      if (!text.trim()) {
        if (emptyRetries > 0) {
          await waitAfterEmpty(s, emptyRetries, signal);
          return chatOnce({ system, messages, onToken, signal, maxTokens, temperature, noStream: true, emptyRetries: emptyRetries - 1, glowFree: true });
        }
        throw new Error('The AI returned an empty answer. Try again, or pick another provider in AI settings.');
      }
      onToken && onToken(text, text);
      return text;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let stalled = false;
    const streamStartedAt = Date.now();
    let lastProgressAt = Date.now();
    while (true) {
      const now = Date.now();
      if (now - lastProgressAt > STALL_TIMEOUT_MS || now - streamStartedAt > STREAM_MAX_MS) {
        stalled = true; // only pings and no new text (or far too long): stop waiting
        try {
          reader.cancel();
        } catch (err) {
          // already closed
        }
        break;
      }
      timer.arm(STALL_TIMEOUT_MS);
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        const dropped = err && err.name === 'TypeError' && !(signal && signal.aborted);
        if (!timer.timedOut && !dropped) {
          timer.done();
          throw err;
        }
        stalled = true; // the stream stopped or the connection dropped: keep what arrived, or retry below
        break;
      }
      const { value, done } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch (err) {
          continue;
        }
        let delta = '';
        if (p.format === 'anthropic') {
          if (json.type === 'content_block_delta') delta = json.delta?.text || '';
          if (json.type === 'error') throw new Error(json.error?.message || 'Anthropic stream error');
        } else {
          if (json.error) throw new Error('AI provider error: ' + (json.error.message || JSON.stringify(json.error).slice(0, 200)));
          delta = json.choices?.[0]?.delta?.content || '';
        }
        if (delta) {
          full += delta;
          lastProgressAt = Date.now();
          onToken && onToken(delta, full);
        }
      }
    }
    timer.done();
    if (stalled && full.trim().length > 200) return full;
    if (stalled) full = ''; // too little arrived before the stream broke off: ask again below
    if (!full.trim()) {
      if (emptyRetries > 0) {
        // Some free/shared endpoints occasionally return an empty (or stalled) stream; wait, then retry without streaming.
        await waitAfterEmpty(s, emptyRetries, signal);
        return chatOnce({ system, messages, onToken, signal, maxTokens, temperature, noStream: true, emptyRetries: emptyRetries - 1, glowFree: true });
      }
      throw new Error('The AI returned an empty answer. Try again, or pick another provider in AI settings.');
    }
    return full;
  }

  // ==================================================================
  // Tools
  // ==================================================================
  // Decode search-engine redirect links to the real destination URL.
  function decodeResultUrl(link) {
    try {
      const uddg = link.match(/[?&]uddg=([^&)]+)/);
      if (uddg) return decodeURIComponent(uddg[1]);
      const bing = link.match(/bing\.com\/ck\/a\?.*?[?&]u=a1([^&)]+)/);
      if (bing) {
        const b64 = bing[1].replace(/-/g, '+').replace(/_/g, '/');
        return atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
      }
    } catch (err) {
      return null;
    }
    return link;
  }

  const SEARCH_ENGINE_HOSTS = /(^|\.)(duckduckgo\.com|bing\.com|microsoft\.com|msn\.com|jina\.ai|go\.microsoft\.com)$/i;

  // Parse Jina-rendered markdown of a results page into [{title,url,snippet}].
  function parseSearchMarkdown(md) {
    const lines = md.split('\n');
    const results = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^(?:#{2,3}\s*|\d+\.\s*)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (!m) continue;
      const url = decodeResultUrl(m[2]);
      if (!url || !/^https?:\/\//.test(url)) continue;
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch (err) {
        continue;
      }
      if (SEARCH_ENGINE_HOSTS.test(host) || /\/y\.js/.test(url) || seen.has(url)) continue;
      const title = m[1].replace(/\*\*/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      if (title.length < 6) continue;
      const snippetLines = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        if (/^(?:#{2,3}\s*|\d+\.\s*)\[/.test(lines[j])) break;
        snippetLines.push(lines[j]);
      }
      const snippet = snippetLines.join(' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      seen.add(url);
      results.push({ title, url, snippet });
      if (results.length >= 6) break;
    }
    return results;
  }

  const SEARCH_ENGINES = [
    q => 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q),
    q => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
    q => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q)
  ];

  async function webSearch(query, signal) {
    for (const engine of SEARCH_ENGINES) {
      try {
        const res = await fetch('https://r.jina.ai/' + engine(query), { signal, headers: { 'X-Return-Format': 'markdown' } });
        if (!res.ok) continue;
        const results = parseSearchMarkdown(await res.text());
        if (results.length >= 2) return results;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
      }
    }

    // Last resort: Wikipedia search (always CORS-enabled, never rate-limited for this volume).
    const wiki = 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=' + encodeURIComponent(query);
    const res = await fetch(wiki, { signal });
    const json = await res.json();
    return (json.query?.search || []).map(r => ({
      title: r.title,
      url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title.replace(/ /g, '_')),
      snippet: r.snippet.replace(/<[^>]+>/g, '')
    }));
  }

  async function readUrl(url, signal, maxChars = 40000) {
    const res = await fetch('https://r.jina.ai/' + url, { signal, headers: { 'X-Return-Format': 'text' } });
    if (!res.ok) throw new Error('Could not read ' + url + ' (' + res.status + ')');
    const text = await res.text();
    return truncate(text.replace(/\n{3,}/g, '\n\n'), maxChars);
  }

  const STOP_WORDS = new Set('the and for with that this what which are was were from have has had you your about into than then them they their there these those best right now compare price how why when where who will would could should can get make does more most just also only over under very much many some such each other like using use'.split(' '));

  // Pick the paragraphs of a page most relevant to the question (drops nav/boilerplate).
  function relevantExcerpt(text, question, maxChars) {
    const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(t => !STOP_WORDS.has(t)))];
    const paras = String(text)
      .split(/\n+/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 50 && !/^(skip to|sign in|log in|subscribe|cookie|menu|share|advertisement)/i.test(p));
    const scored = paras.map((p, i) => {
      const lower = p.toLowerCase();
      let score = 0;
      terms.forEach(t => {
        if (lower.includes(t)) score += 2;
      });
      if (/[$€£¥]\s?\d|\d+(\.\d+)?\s?(mm|cm|kg|%|usd|gb|mb|hz|w|mph|km)/i.test(p)) score += 2;
      if (/\d/.test(p)) score += 1;
      return { p, i, score };
    });
    const picked = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const chosen = [];
    let used = 0;
    for (const s of picked) {
      if (used + s.p.length > maxChars) continue;
      chosen.push(s);
      used += s.p.length + 1;
      if (used > maxChars * 0.95) break;
    }
    if (!chosen.length) return paras.join('\n').slice(0, maxChars);
    return chosen.sort((a, b) => a.i - b.i).map(s => s.p).join('\n');
  }

  // Some reasoning models leak "let me open/search…" monologue into the answer.
  function looksLikeLeakedReasoning(text) {
    const hits = (String(text).match(/\b(let's|let me|we need to|i will|we should|i need to)\s+(open|search|browse|fetch|check|look|use the|find)/gi) || []).length;
    return hits >= 3;
  }

  // Runs untrusted JavaScript in a throwaway Worker: no DOM, no access to this page's storage.
  function runJS(code, timeoutMs = 6000) {
    return new Promise(resolve => {
      const prelude = `
        const __out = [];
        const __fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch (e) { return String(v); } };
        const __push = (kind, args) => { __out.push((kind === 'log' ? '' : '[' + kind + '] ') + args.map(__fmt).join(' ')); };
        console.log = (...a) => __push('log', a);
        console.info = (...a) => __push('log', a);
        console.warn = (...a) => __push('warn', a);
        console.error = (...a) => __push('error', a);
        console.table = (d) => __push('log', [d]);
        let __passed = 0, __failed = 0;
        function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
        async function test(name, fn) {
          try { await fn(); __passed++; __out.push('✓ ' + name); }
          catch (e) { __failed++; __out.push('✗ ' + name + ' — ' + (e && e.message || e)); }
        }
        self.onmessage = async (ev) => {
          try {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            await new AsyncFunction('assert', 'test', ev.data)(assert, test);
            self.postMessage({ ok: true, out: __out, passed: __passed, failed: __failed });
          } catch (e) {
            self.postMessage({ ok: false, out: __out, error: String(e && e.stack || e), passed: __passed, failed: __failed });
          }
        };`;
      const blob = new Blob([prelude], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      const started = performance.now();
      const timer = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ ok: false, out: [], error: `Timed out after ${timeoutMs / 1000}s`, ms: timeoutMs });
      }, timeoutMs);
      worker.onmessage = e => {
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ ...e.data, ms: Math.round(performance.now() - started) });
      };
      worker.onerror = e => {
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve({ ok: false, out: [], error: e.message || 'Script error', ms: Math.round(performance.now() - started) });
      };
      worker.postMessage(code);
    });
  }

  // ==================================================================
  // Runs: storage + events
  // ==================================================================
  const emitter = new EventTarget();
  const controllers = {};
  let runs = loadRuns();

  function loadRuns() {
    try {
      const list = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]');
      // Anything still "running" from a previous page load was interrupted.
      list.forEach(r => {
        if (r.status === 'running') r.status = 'stopped';
        (r.steps || []).forEach(st => {
          if (st.status === 'running' || st.status === 'queued') st.status = 'stopped';
        });
      });
      return list;
    } catch (err) {
      return [];
    }
  }

  let saveTimer = null;
  const removedHere = new Set();
  // Missions saved by another Glow page (GlowLead runs GlowRoom missions too) are kept, not overwritten.
  function mergeStoredRuns() {
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]');
    } catch (err) {
      stored = [];
    }
    if (!Array.isArray(stored)) return false;
    const known = new Set(runs.map(r => r.id));
    const added = stored.filter(r => r && r.id && !known.has(r.id) && !removedHere.has(r.id));
    if (!added.length) return false;
    runs = runs.concat(added).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, MAX_RUNS);
    return true;
  }
  window.addEventListener('storage', e => {
    if (e.key !== RUNS_KEY) return;
    let stored = [];
    try {
      stored = JSON.parse(e.newValue || '[]');
    } catch (err) {
      stored = [];
    }
    let updated = mergeStoredRuns();
    // Finished missions from the other page replace our stale copy (only ones we are not running here).
    (Array.isArray(stored) ? stored : []).forEach(r => {
      const mine = runs.find(x => x.id === r.id);
      if (mine && !controllers[r.id] && mine.status === 'running' && r.status !== 'running') {
        Object.assign(mine, r);
        updated = true;
      }
    });
    if (updated) emitter.dispatchEvent(new CustomEvent('run', { detail: null }));
  });
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      mergeStoredRuns();
      try {
        localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
      } catch (err) {
        // Storage full: drop the oldest half and retry once.
        runs = runs.slice(0, Math.ceil(runs.length / 2));
        try {
          localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
        } catch (err2) {
          console.warn('Could not save runs', err2);
        }
      }
    }, 300);
  }

  function getRun(id) {
    return runs.find(r => r.id === id);
  }

  function changed(run) {
    persist();
    emitter.dispatchEvent(new CustomEvent('run', { detail: run }));
  }

  function botEvent(run, agent, phase, detail, tool) {
    const ev = { runId: run.id, agent, phase, detail: String(detail || '').slice(0, 200), tool: tool || null, ts: Date.now() };
    emitter.dispatchEvent(new CustomEvent('bot', { detail: ev }));
  }

  // ==================================================================
  // Planning
  // ==================================================================
  async function plan(run, allowed, signal) {
    const roster = allowed.map(id => `- ${id} (${BOTS[id].name}): ${BOTS[id].skill}`).join('\n');
    const system = [
      'You are Nova, lead of an AI crew. Break the user goal into 1-4 concrete steps, each assigned to one crew member.',
      'Available crew:',
      roster,
      'Rules: use the fewest steps that produce a great result. Only use "explore" when current/real-world facts are needed.',
      'Use "coder" when computation, data processing, algorithms or code are involved; add "tester" after coder only for non-trivial code.',
      'Use "media" for writing copy or graphics. Use "checker" last when accuracy matters.',
      'Do NOT add a final summary step — you write the final answer yourself afterwards.',
      'Reply with JSON only: {"steps":[{"bot":"explore","task":"..."}]}'
    ].join('\n');
    let text = '';
    try {
      text = await chat({
        system,
        messages: [{ role: 'user', content: run.goal + (run.context ? '\n\nContext from earlier work:\n' + truncate(run.context, 2000) : '') }],
        signal,
        temperature: 0.2,
        maxTokens: 600
      });
    } catch (err) {
      if (err.name === 'AbortError' || /API key/.test(err.message)) throw err;
      // The planner didn't answer (busy free AI, empty reply…): use the built-in plan instead of giving up.
      botEvent(run, 'leader', 'tool', 'Planner busy, so Nova uses a standard plan', 'plan');
      run.planNote = err.message;
    }
    const json = extractJson(text);
    let steps = (json && Array.isArray(json.steps)) ? json.steps : [];
    steps = steps
      .filter(s => s && allowed.includes(s.bot) && s.bot !== 'leader' && s.task)
      .slice(0, 4)
      .map(s => ({ bot: s.bot, task: String(s.task).slice(0, 400) }));
    if (!steps.length) steps = heuristicPlan(run.goal, allowed);
    return steps;
  }

  function heuristicPlan(goal, allowed) {
    const g = goal.toLowerCase();
    const steps = [];
    const add = (bot, task) => {
      if (allowed.includes(bot)) steps.push({ bot, task });
    };
    if (/(research|find|latest|compare|news|price|market|who|what is|search|best)/.test(g)) add('explore', 'Research: ' + goal);
    if (/(code|script|function|calculate|compute|convert|algorithm|parse|json|csv|regex|simulate)/.test(g)) add('coder', goal);
    if (/(logo|svg|icon|banner|draw|graphic|diagram|post|tweet|email|copy|caption|slogan)/.test(g)) add('media', goal);
    if (!steps.length) add('explore', 'Gather useful facts for: ' + goal);
    if (!steps.length) steps.push({ bot: allowed.find(b => b !== 'leader') || 'leader', task: goal });
    return steps;
  }

  // ==================================================================
  // Step execution per bot
  // ==================================================================
  function priorWork(run, uptoIndex) {
    return run.steps
      .slice(0, uptoIndex)
      .filter(s => s.output)
      .map(s => `### ${BOTS[s.bot].name} (${s.bot}) — ${s.task}\n${truncate(s.output, 2500)}`)
      .join('\n\n');
  }

  function baseSystem(bot, extra) {
    const b = BOTS[bot];
    return [
      `You are ${b.name}, the ${b.role} in an AI crew called GlowRoom. You ${b.skill}.`,
      'Be concrete and genuinely useful: give the actual result, not a description of what you would do.',
      'Use Markdown. Keep it focused.',
      `Today's date: ${new Date().toDateString()}.`,
      LANGUAGE_RULE,
      extra || ''
    ].join('\n');
  }

  async function execStep(run, index, signal) {
    const step = run.steps[index];
    const bot = step.bot;
    const prior = priorWork(run, index);
    const userContent = [
      `Overall goal: ${run.goal}`,
      run.context ? `Earlier conversation context:\n${truncate(run.context, 2000)}` : '',
      prior ? `Work done so far by teammates:\n${prior}` : '',
      `Your task: ${step.task}`
    ].filter(Boolean).join('\n\n');

    const stream = (delta, full) => {
      step.output = full;
      changed(run);
    };

    step.artifacts = [];
    const settings = getSettings();

    if (bot === 'explore' && settings.webAccess) {
      // 1) Search query
      botEvent(run, bot, 'tool', 'Choosing a search query', 'llm');
      let query = await chat({
        system: `Write ONE concise web search query (max 10 words) for the task. Today is ${new Date().toDateString()}. Do not add a year unless the user mentioned one. Output only the query text.`,
        messages: [{ role: 'user', content: step.task + '\nGoal: ' + run.goal }],
        signal,
        temperature: 0,
        maxTokens: 60
      });
      query = query.replace(/["\n]/g, ' ').trim().slice(0, 120) || step.task.slice(0, 100);
      botEvent(run, bot, 'tool', 'Searching: ' + query, 'web_search');
      const results = await webSearch(query, signal);
      // 2) Read the top pages
      const sources = [];
      for (const r of results.slice(0, 3)) {
        botEvent(run, bot, 'tool', 'Reading ' + r.title, 'read_url');
        try {
          const raw = await readUrl(r.url, signal);
          sources.push({ ...r, text: relevantExcerpt(raw, query + ' ' + step.task, 3200) });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          sources.push({ ...r, text: r.snippet });
        }
      }
      results.slice(3).forEach(r => sources.push({ ...r, text: r.snippet }));
      step.artifacts.push({ type: 'sources', query, items: sources.map(s => ({ title: s.title, url: s.url, snippet: s.snippet })) });
      changed(run);
      const sourceText = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${truncate(s.text, 3000)}`).join('\n\n');
      botEvent(run, bot, 'tool', 'Writing findings', 'llm');
      const researchSystem = baseSystem(bot, [
        'The relevant text of each source has ALREADY been fetched for you and is included below. You cannot browse, open links or search again.',
        'Write the answer directly — do not describe your process or what you would do.',
        'Base facts on the sources and cite them inline like [1], [2]. If a detail is missing from the sources, say so briefly.',
        'Prefer a compact Markdown table when comparing items. End with a "Sources" list (number, title, URL).'
      ].join('\n'));
      const researchMessages = [{ role: 'user', content: userContent + '\n\nSources (fetched just now):\n' + sourceText }];
      let answer = await chat({ system: researchSystem, messages: researchMessages, onToken: stream, signal });
      if (looksLikeLeakedReasoning(answer)) {
        botEvent(run, bot, 'tool', 'Tidying up the answer', 'llm');
        step.output = '';
        changed(run);
        answer = await chat({
          system: researchSystem + '\nIMPORTANT: Output ONLY the final answer for the user. No planning, no "let\'s open", no narration.',
          messages: researchMessages,
          onToken: stream,
          signal,
          temperature: 0.2
        });
      }
      return;
    }

    if (bot === 'coder') {
      const system = baseSystem(bot, [
        'Write self-contained modern JavaScript that will be EXECUTED in a Web Worker (no DOM, no window, no require/import; fetch is available).',
        'Print the actual results with console.log. Keep it under 120 lines.',
        'Reply with a 1-2 sentence plan, then exactly one ```js code block, then nothing else.'
      ].join('\n'));
      botEvent(run, bot, 'tool', 'Writing code', 'file_write');
      let text = await chat({ system, messages: [{ role: 'user', content: userContent }], onToken: stream, signal });
      for (let attempt = 0; attempt < 2; attempt++) {
        const block = extractBlocks(text, ['js', 'javascript', ''])[0];
        if (!block) break;
        botEvent(run, bot, 'tool', 'Running code', 'run_js');
        const result = await runJS(block.code);
        step.artifacts = step.artifacts.filter(a => a.type !== 'run');
        step.artifacts.push({ type: 'run', code: block.code, ...result });
        changed(run);
        if (result.ok) {
          step.output = text + '\n\n**Execution output**\n```text\n' + truncate(result.out.join('\n') || '(no output)', 4000) + '\n```';
          changed(run);
          return;
        }
        if (attempt === 1) break;
        botEvent(run, bot, 'error', 'Code failed — fixing: ' + String(result.error).split('\n')[0], 'run_js');
        text = await chat({
          system,
          messages: [
            { role: 'user', content: userContent },
            { role: 'assistant', content: text },
            { role: 'user', content: 'Running it failed with:\n' + truncate(result.error, 1200) + '\nOutput before failure:\n' + truncate(result.out.join('\n'), 800) + '\nFix the code. Same reply format.' }
          ],
          onToken: stream,
          signal
        });
      }
      const last = step.artifacts.find(a => a.type === 'run');
      if (last && !last.ok) {
        step.output = text + '\n\n**Execution failed**\n```text\n' + truncate(last.error, 1500) + '\n```';
      }
      return;
    }

    if (bot === 'tester') {
      const codeStep = run.steps.slice(0, index).reverse().find(s => s.artifacts?.some(a => a.type === 'run'));
      const code = codeStep?.artifacts.find(a => a.type === 'run')?.code;
      if (code) {
        const system = baseSystem(bot, [
          'Write tests for the given code. Helpers available: test(name, fn) and assert(condition, message). The code under test will be prepended to your tests, so call its functions directly.',
          'Cover normal cases and 2-3 edge cases. Reply with one line of intent, then exactly one ```js block containing only the tests.'
        ].join('\n'));
        botEvent(run, bot, 'tool', 'Writing tests', 'write_tests');
        const text = await chat({
          system,
          messages: [{ role: 'user', content: `Code under test:\n\`\`\`js\n${truncate(code, 6000)}\n\`\`\`\n\n${userContent}` }],
          onToken: stream,
          signal
        });
        const block = extractBlocks(text, ['js', 'javascript', ''])[0];
        if (block) {
          botEvent(run, bot, 'tool', 'Running tests', 'run_tests');
          const result = await runJS(code + '\n\n// ---- tests ----\n' + block.code, 8000);
          step.artifacts.push({ type: 'run', code: block.code, label: 'Tests', ...result });
          const summary = `**Test results: ${result.passed || 0} passed, ${result.failed || 0} failed**${result.ok ? '' : ' (run error)'}`;
          step.output = text + '\n\n' + summary + '\n```text\n' + truncate((result.out || []).join('\n') + (result.error ? '\n' + result.error : ''), 3000) + '\n```';
          changed(run);
          if (result.failed) botEvent(run, bot, 'error', `${result.failed} test(s) failed`, 'run_tests');
        }
        return;
      }
    }

    if (bot === 'media') {
      const system = baseSystem(bot, [
        'If the task needs a visual (logo, icon, banner, diagram, chart, illustration), include exactly one complete ```svg block:',
        'self-contained <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"> with no scripts, no external images or fonts (use system fonts), under 8 KB, visually polished.',
        'Plan the layout first: keep every element inside a 10% margin, never let text overlap shapes (put text below or beside the mark), use a cohesive 2-4 colour palette and text-anchor="middle" for centred text.',
        'For writing tasks (posts, emails, copy), give ready-to-use text, optionally 2-3 variants.'
      ].join('\n'));
      botEvent(run, bot, 'tool', 'Creating', 'image_gen');
      const text = await chat({ system, messages: [{ role: 'user', content: userContent }], onToken: stream, signal, maxTokens: 3500 });
      const svg = extractBlocks(text, ['svg', 'xml', 'html']).find(b => b.code.includes('<svg'));
      if (svg) {
        const clean = sanitizeSvg(svg.code);
        if (clean) step.artifacts.push({ type: 'svg', svg: clean });
        changed(run);
      }
      return;
    }

    // leader / checker / tester-without-code / explore-without-web
    const extras = {
      checker: 'Review the teammates\' work critically: list concrete errors, risks or gaps (with fixes), then give a verdict line: "Verdict: Approve" or "Verdict: Needs changes".',
      tester: 'No code was provided; verify the work by listing checks you performed and any problems found.',
      explore: 'Web access is turned off; answer from your own knowledge and say that sources were not checked live.',
      leader: ''
    };
    botEvent(run, bot, 'tool', 'Thinking', 'llm');
    const generic = await chat({ system: baseSystem(bot, extras[bot] || ''), messages: [{ role: 'user', content: userContent }], onToken: stream, signal });
    if (looksLikeLeakedReasoning(generic)) {
      step.output = '';
      changed(run);
      await chat({
        system: baseSystem(bot, (extras[bot] || '') + '\nOutput ONLY the final answer. No narration of your process.'),
        messages: [{ role: 'user', content: userContent }],
        onToken: stream,
        signal,
        temperature: 0.2
      });
    }
  }

  function sanitizeSvg(code) {
    const start = code.indexOf('<svg');
    const end = code.lastIndexOf('</svg>');
    if (start < 0 || end < 0) return null;
    let svg = code.slice(start, end + 6);
    svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return svg;
  }

  // ==================================================================
  // Orchestration
  // ==================================================================
  // bots: array of bot ids the user picked. One non-leader bot → solo run.
  // Leader, several bots, or none → Nova plans across the allowed bots.
  function start(goal, options = {}) {
    const picked = (options.bots || []).filter(b => BOTS[b]);
    const solo = picked.length === 1 && picked[0] !== 'leader';
    const run = {
      id: uid(),
      goal: String(goal).trim(),
      context: options.context || '',
      parentId: options.parentId || null,
      createdAt: Date.now(),
      finishedAt: null,
      status: 'running',
      provider: providerLabel(),
      mode: solo ? 'solo' : 'team',
      allowed: picked.length > 1 ? picked : Object.keys(BOTS),
      steps: [],
      final: '',
      error: null,
      meta: options.meta || {}
    };
    if (solo) run.steps.push({ bot: picked[0], task: run.goal, status: 'queued', output: '', artifacts: [] });
    runs.unshift(run);
    changed(run);
    execute(run).catch(err => console.error(err));
    return run;
  }

  async function execute(run) {
    const ctrl = new AbortController();
    controllers[run.id] = ctrl;
    const signal = ctrl.signal;
    try {
      if (run.mode === 'team') {
        botEvent(run, 'leader', 'start', 'Planning: ' + goalTitle(run.goal), 'plan');
        run.planning = true;
        changed(run);
        const steps = await plan(run, run.allowed, signal);
        run.planning = false;
        run.steps = steps.map(s => ({ ...s, status: 'queued', output: '', artifacts: [] }));
        botEvent(run, 'leader', 'tool', `Plan: ${steps.map(s => BOTS[s.bot].name).join(' → ')}`, 'delegate');
        changed(run);
      }

      for (let i = 0; i < run.steps.length; i++) {
        const step = run.steps[i];
        step.status = 'running';
        step.startedAt = Date.now();
        changed(run);
        botEvent(run, step.bot, 'start', step.task);
        try {
          await execStep(run, i, signal);
          step.status = 'done';
          step.finishedAt = Date.now();
          botEvent(run, step.bot, 'end', 'Finished: ' + step.task);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          step.status = 'error';
          step.error = err.message;
          step.finishedAt = Date.now();
          botEvent(run, step.bot, 'error', err.message);
          // Provider/auth errors stop the run; tool errors let the team continue.
          if (/AI provider error|API key/.test(err.message)) throw err;
        }
        changed(run);
      }

      if (run.mode === 'team' && run.steps.some(s => s.output)) {
        botEvent(run, 'leader', 'tool', 'Writing the final answer', 'report');
        run.writingFinal = true;
        changed(run);
        await chat({
          system: baseSystem('leader', [
            'Write the final deliverable for the user, combining your team\'s work. Lead with the answer.',
            'Keep the researcher\'s citation numbers [n] exactly as they are (do not invent new numbers); the source list is appended automatically. Include final code blocks or copy if they are part of the deliverable.',
            'If a reviewer requested changes, apply them. Do not describe the process; deliver the result.'
          ].join('\n')),
          messages: [{ role: 'user', content: `Goal: ${run.goal}\n\nTeam work:\n${priorWork(run, run.steps.length)}` }],
          onToken: (d, full) => {
            run.final = full;
            changed(run);
          },
          signal,
          maxTokens: 3000
        }).catch(err => {
          if (err.name === 'AbortError' || /API key/.test(err.message)) throw err;
          // Nova couldn't write the summary: hand over the team's own work rather than nothing.
          run.final = '_Nova could not write a summary (' + err.message + '), so here is the team\'s work as it is._\n\n' +
            run.steps.filter(s => s.output).map(s => `### ${BOTS[s.bot].name}\n${s.output}`).join('\n\n');
          changed(run);
        });
        run.writingFinal = false;
        const realSources = [];
        run.steps.forEach(s => (s.artifacts || []).forEach(a => {
          if (a.type === 'sources') {
            a.items.forEach(item => {
              if (!realSources.some(x => x.url === item.url)) realSources.push(item);
            });
          }
        }));
        if (realSources.length) {
          run.final += '\n\n---\n**Sources the crew actually read**\n' +
            realSources.map((s, i) => `${i + 1}. [${s.title.replace(/[\[\]]/g, '')}](${s.url})`).join('\n');
          changed(run);
        }
        botEvent(run, 'leader', 'end', 'Delivered: ' + goalTitle(run.goal));
      } else if (run.steps[0]) {
        run.final = run.steps[0].output;
      }
      run.status = run.steps.some(s => s.status === 'error') && !run.final ? 'error' : 'done';
    } catch (err) {
      if (err.name === 'AbortError') {
        run.status = 'stopped';
        run.steps.forEach(s => {
          if (s.status === 'running' || s.status === 'queued') s.status = 'stopped';
        });
      } else {
        run.status = 'error';
        run.error = err.message;
        botEvent(run, 'leader', 'error', err.message);
      }
    } finally {
      run.planning = false;
      run.writingFinal = false;
      run.finishedAt = Date.now();
      delete controllers[run.id];
      changed(run);
      emitter.dispatchEvent(new CustomEvent('finished', { detail: run }));
    }
  }

  function stop(id) {
    controllers[id]?.abort();
  }

  function remove(id) {
    stop(id);
    removedHere.add(id);
    runs = runs.filter(r => r.id !== id);
    persist();
    emitter.dispatchEvent(new CustomEvent('run', { detail: null }));
  }

  function rerun(id) {
    const r = getRun(id);
    if (!r) return null;
    const bots = r.mode === 'solo' ? [r.steps[0]?.bot] : (r.allowed.length === Object.keys(BOTS).length ? [] : r.allowed);
    return start(r.goal, { bots, context: r.context, meta: r.meta });
  }

  function followUp(id, question) {
    const r = getRun(id);
    if (!r) return null;
    const context = `Previous goal: ${r.goal}\nPrevious result:\n${truncate(r.final || priorWork(r, r.steps.length), 3500)}`;
    const bots = r.mode === 'solo' ? [r.steps[0]?.bot] : [];
    return start(question, { bots, context, parentId: r.id, meta: r.meta });
  }

  function toMarkdown(run) {
    const lines = [`# ${goalTitle(run.goal, 200)}`, '', `_GlowRoom · ${new Date(run.createdAt).toLocaleString()} · ${run.provider}_`, ''];
    if (run.final) lines.push(run.final, '');
    if (run.mode === 'team') {
      lines.push('---', '## Team work', '');
      run.steps.forEach(s => {
        lines.push(`### ${BOTS[s.bot].name} — ${s.task}`, '', s.output || '_(no output)_', '');
      });
    }
    return lines.join('\n');
  }

  // ==================================================================
  // Markdown → safe HTML
  // ==================================================================
  function renderMarkdown(md) {
    // Normalise model-specific citation marks like 【1†L3】 to [1].
    const src = String(md || '').replace(/【(\d+)[^】]*】/g, '[$1]');
    const blocks = [];
    let text = src.replace(/```([\w-]*)[^\n]*\n([\s\S]*?)(```|$)/g, (m, lang, code) => {
      blocks.push(`<div class="crx-code"><div class="crx-code-bar"><span>${esc(lang || 'text')}</span><button type="button" data-copy>Copy</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    text = esc(text);
    const inline = s => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) {
        out.push('<p>' + inline(para.join(' ')) + '</p>');
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out.push(`<${list.type}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.type}>`);
        list = null;
      }
    };
    text.split('\n').forEach(raw => {
      const line = raw.trimEnd();
      const block = line.match(/^\u0000(\d+)\u0000$/);
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (block) {
        flushPara();
        flushList();
        out.push(`\u0000${block[1]}\u0000`);
      } else if (heading) {
        flushPara();
        flushList();
        const level = Math.min(4, heading[1].length + 1);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (ul || ol) {
        flushPara();
        const type = ul ? 'ul' : 'ol';
        if (!list || list.type !== type) {
          flushList();
          list = { type, items: [] };
        }
        list.items.push((ul || ol)[1]);
      } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        flushPara();
        flushList();
        out.push('<hr>');
      } else if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara();
        flushList();
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
        const cells = line.trim().slice(1, -1).split('|').map(c => `<td>${inline(c.trim())}</td>`).join('');
        const last = out[out.length - 1];
        if (last && last.startsWith('<table')) {
          out[out.length - 1] = last.replace('</table>', `<tr>${cells}</tr></table>`);
        } else {
          out.push(`<table class="crx-table"><tr>${cells}</tr></table>`);
        }
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara();
    flushList();
    return out.join('\n').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
  }

  // ==================================================================
  // UI: results drawer, history, settings (shared by desktop + mobile)
  // ==================================================================
  const CSS = `
  .crx-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(2,6,12,.5);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s}
  .crx-backdrop.open{opacity:1;pointer-events:auto}
  @media (min-width:1100px){.crx-backdrop{background:rgba(2,6,12,.12);backdrop-filter:none}}
  .crx-drawer{position:fixed;top:0;right:0;bottom:0;z-index:2001;width:min(620px,100vw);display:flex;flex-direction:column;
    background:var(--crx-bg,#0d131d);color:var(--crx-text,#e8eef6);border-left:1px solid var(--crx-line,#243045);
    box-shadow:-30px 0 60px -30px rgba(0,0,0,.8);transform:translateX(102%);transition:transform .3s cubic-bezier(.2,.9,.2,1);
    font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55}
  .crx-drawer.open{transform:none}
  [data-theme="light"] .crx-drawer{--crx-bg:#f8fafc;--crx-panel:#fff;--crx-panel2:#f1f5f9;--crx-text:#0f172a;--crx-muted:#475569;--crx-line:#e2e8f0}
  .crx-head{display:flex;align-items:center;gap:10px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 12px;border-bottom:1px solid var(--crx-line,#243045)}
  .crx-head h2{flex:1;margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .crx-x{width:36px;height:36px;border-radius:10px;border:1px solid var(--crx-line,#243045);background:var(--crx-panel,#151d2b);color:inherit;cursor:pointer;font-size:18px;line-height:1}
  .crx-body{flex:1;overflow-y:auto;padding:16px 16px calc(24px + env(safe-area-inset-bottom,0px))}
  .crx-goal{font-size:18px;font-weight:700;letter-spacing:-.02em;margin:0 0 6px}
  .crx-owner{margin:0 0 8px;font-size:13px;color:#e7b75d}
  .crx-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--crx-muted,#94a3b8);font-size:12px;margin-bottom:14px}
  .crx-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;font:700 10px/1.4 'SF Mono',Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;background:var(--crx-panel2,#1a2332)}
  .crx-badge.running{color:#10b981;background:rgba(16,185,129,.14)} .crx-badge.done{color:#3b82f6;background:rgba(59,130,246,.14)}
  .crx-badge.error{color:#ef4444;background:rgba(239,68,68,.14)} .crx-badge.stopped{color:#f59e0b;background:rgba(245,158,11,.14)}
  .crx-badge.running::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;animation:crx-blink 1s infinite}
  @keyframes crx-blink{50%{opacity:.25}}
  .crx-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
  .crx-glow{position:relative;border-radius:14px;padding:14px 14px 12px;margin:0 0 16px;background:linear-gradient(135deg,rgba(251,191,36,.14),rgba(236,72,153,.12) 55%,rgba(139,92,246,.14));border:1px solid rgba(251,191,36,.35)}
  .crx-glow p{margin:6px 0 10px;font-size:13px;line-height:1.5;color:var(--crx-text,#e2e8f0)}
  .crx-glow-h{display:flex;align-items:center;gap:8px;font-size:14px}
  .crx-glow-h .crx-badge{margin-left:auto}
  .crx-glow-logo{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:linear-gradient(135deg,#fbbf24,#ec4899);color:#fff;font-size:13px}
  .crx-glow .crx-field{margin-bottom:10px}
  a.crx-btn{text-decoration:none;display:inline-flex;align-items:center}
  .crx-btn.glow{background:linear-gradient(135deg,#f59e0b,#ec4899);border-color:transparent;color:#fff;font-weight:600}
  .crx-btn.glow:hover{filter:brightness(1.08)}
  .crx-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--crx-line,#2d3a4f);background:var(--crx-panel,#151d2b);color:inherit;font:600 13px/1 inherit;cursor:pointer}
  .crx-btn:hover{border-color:#6d7cff}
  .crx-btn.primary{background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-color:transparent;color:#fff}
  .crx-btn.danger{color:#ef4444;border-color:rgba(239,68,68,.35)}
  .crx-card{background:var(--crx-panel,#151d2b);border:1px solid var(--crx-line,#243045);border-radius:14px;margin-bottom:12px;overflow:hidden}
  .crx-card-h{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--crx-line,#243045);cursor:pointer;user-select:none}
  .crx-ava{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 12px/1 inherit;flex:none}
  .crx-card-h b{font-size:13px} .crx-card-h .t{flex:1;min-width:0;color:var(--crx-muted,#94a3b8);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .crx-card-b{padding:12px 14px}
  .crx-card.collapsed .crx-card-b{display:none}
  .crx-final{border-color:rgba(139,92,246,.55);box-shadow:0 0 0 1px rgba(139,92,246,.15),0 14px 40px -24px rgba(139,92,246,.7)}
  .crx-md h2,.crx-md h3,.crx-md h4,.crx-md h5{margin:14px 0 6px;font-size:15px} .crx-md p{margin:0 0 10px} .crx-md ul,.crx-md ol{margin:0 0 10px;padding-left:20px}
  .crx-md a{color:#8b9cff;word-break:break-word} .crx-md code{font:12px 'SF Mono',Consolas,monospace;background:var(--crx-panel2,#1a2332);padding:1px 5px;border-radius:5px}
  .crx-md hr{border:0;border-top:1px solid var(--crx-line,#243045);margin:14px 0}
  .crx-table{border-collapse:collapse;margin:0 0 10px;font-size:13px;display:block;overflow-x:auto} .crx-table td{border:1px solid var(--crx-line,#2d3a4f);padding:5px 8px}
  .crx-table tr:first-child td{font-weight:700;background:var(--crx-panel2,#1a2332)}
  .crx-code{margin:0 0 10px;border:1px solid var(--crx-line,#2d3a4f);border-radius:10px;overflow:hidden}
  .crx-code-bar{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;font:600 11px 'SF Mono',Consolas,monospace;color:var(--crx-muted,#94a3b8);background:var(--crx-panel2,#1a2332)}
  .crx-code-bar button{border:0;background:none;color:#8b9cff;font:inherit;cursor:pointer}
  .crx-code pre{margin:0;padding:10px 12px;overflow-x:auto;font:12px/1.5 'SF Mono',Consolas,monospace;background:var(--crx-bg,#0a0e14)}
  .crx-code pre code{background:none;padding:0}
  .crx-run{margin-top:8px;border-radius:10px;border:1px solid var(--crx-line,#2d3a4f);overflow:hidden}
  .crx-run-h{display:flex;gap:8px;align-items:center;padding:6px 10px;font:600 11px 'SF Mono',Consolas,monospace;background:var(--crx-panel2,#1a2332)}
  .crx-run-h .ok{color:#10b981} .crx-run-h .bad{color:#ef4444}
  .crx-run pre{margin:0;padding:10px 12px;max-height:260px;overflow:auto;font:12px/1.5 'SF Mono',Consolas,monospace;white-space:pre-wrap;background:#05080d;color:#d1fae5}
  .crx-svg{margin-top:8px;border-radius:12px;border:1px solid var(--crx-line,#2d3a4f);background:repeating-conic-gradient(#1a2332 0 25%,#151d2b 0 50%) 0 0/20px 20px;padding:14px;text-align:center}
  .crx-svg img{max-width:100%;max-height:360px}
  .crx-sources{margin-top:8px;display:grid;gap:6px}
  .crx-src{display:block;padding:8px 10px;border-radius:10px;border:1px solid var(--crx-line,#2d3a4f);text-decoration:none;color:inherit;background:var(--crx-panel2,#1a2332)}
  .crx-src b{display:block;font-size:13px;color:#8b9cff} .crx-src span{font-size:12px;color:var(--crx-muted,#94a3b8)}
  .crx-cursor::after{content:'▍';margin-left:2px;animation:crx-blink 1s infinite;color:#8b5cf6}
  .crx-wait{color:var(--crx-muted,#94a3b8);font-style:italic}
  .crx-follow{display:flex;gap:8px;margin-top:6px}
  .crx-follow input,.crx-field input,.crx-field select{flex:1;width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--crx-line,#2d3a4f);background:var(--crx-panel,#151d2b);color:inherit;font:inherit;outline:none}
  .crx-follow input:focus,.crx-field input:focus,.crx-field select:focus{border-color:#6d7cff}
  .crx-err{padding:10px 12px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);color:#fca5a5;margin-bottom:12px}
  [data-theme="light"] .crx-err{color:#b91c1c}
  .crx-hist{display:grid;gap:8px}
  .crx-hist-item{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid var(--crx-line,#243045);background:var(--crx-panel,#151d2b);cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%}
  .crx-hist-item:hover{border-color:#6d7cff} .crx-hist-item .g{flex:1;min-width:0} .crx-hist-item .g b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .crx-hist-item .g span{font-size:12px;color:var(--crx-muted,#94a3b8)}
  .crx-field{display:grid;gap:6px;margin-bottom:14px} .crx-field label{font-size:12px;font-weight:700;color:var(--crx-muted,#94a3b8);text-transform:uppercase;letter-spacing:.06em}
  .crx-field small{color:var(--crx-muted,#94a3b8);font-size:12px}
  .crx-check{display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:13px}
  .crx-note{padding:10px 12px;border-radius:10px;background:var(--crx-panel2,#1a2332);color:var(--crx-muted,#94a3b8);font-size:12px;margin-bottom:14px}
  .crx-test-out{margin-top:10px;font-size:13px}
  .crx-steps-plan{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .crx-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:99px;background:var(--crx-panel2,#1a2332);font-size:12px}
  .crx-chip i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 10px/1 inherit;font-style:normal}
  .crx-chip.running{outline:2px solid #10b981} .crx-chip.done{opacity:.75} .crx-chip.error{outline:2px solid #ef4444}
  `;

  let drawer = null;
  let backdrop = null;
  let view = { type: null, runId: null };
  const collapsed = {};

  function ensureUi() {
    if (drawer) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    backdrop = document.createElement('div');
    backdrop.className = 'crx-backdrop';
    drawer = document.createElement('aside');
    drawer.className = 'crx-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML = '<div class="crx-head"><h2></h2><button class="crx-x" type="button" aria-label="Close">×</button></div><div class="crx-body"></div>';
    document.body.append(backdrop, drawer);
    backdrop.addEventListener('click', close);
    drawer.querySelector('.crx-x').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        e.stopPropagation();
        close();
      }
    }, true);
    drawer.addEventListener('click', onDrawerClick);
    emitter.addEventListener('run', e => {
      if (view.type === 'run' && (!e.detail || e.detail.id === view.runId)) scheduleRender();
      if (view.type === 'history') scheduleRender();
    });
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function openDrawer(title) {
    ensureUi();
    drawer.querySelector('h2').textContent = title;
    drawer.classList.add('open');
    backdrop.classList.add('open');
  }

  function close() {
    if (!drawer) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    view = { type: null, runId: null };
  }

  function openRun(id) {
    view = { type: 'run', runId: id };
    openDrawer('Result');
    drawer.querySelector('.crx-body').scrollTop = 0;
    render();
  }

  function openHistory() {
    view = { type: 'history' };
    openDrawer('Results');
    render();
  }

  function openSettings() {
    view = { type: 'settings' };
    openDrawer('AI settings');
    render();
    if (getSettings().provider === 'glow' && !glow.signedIn) ensurePuter().catch(() => {});
  }

  function avatar(bot, size) {
    const b = BOTS[bot] || { name: '?', color: '#64748b' };
    return `<span class="crx-ava" style="background:${b.color};${size ? `width:${size}px;height:${size}px` : ''}">${esc(b.name[0])}</span>`;
  }

  function fmtAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return new Date(ts).toLocaleDateString();
  }

  function render() {
    if (!drawer || !view.type) return;
    const body = drawer.querySelector('.crx-body');
    const keepFocus = document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (keepFocus) return; // don't clobber typing; next render after blur
    if (view.type === 'history') body.innerHTML = historyHtml();
    if (view.type === 'settings') body.innerHTML = settingsHtml();
    if (view.type === 'run') {
      const run = getRun(view.runId);
      body.innerHTML = run ? runHtml(run) : '<p>Result not found.</p>';
    }
  }

  function historyHtml() {
    if (!runs.length) {
      return '<div class="crx-note">No results yet. Give the crew a goal — e.g. "Compare the 3 best budget 3D printers" or "@byte calculate monthly payments for a $20k loan at 6% over 5 years".</div>';
    }
    return '<div class="crx-actions"><button class="crx-btn" data-act="settings">AI settings</button></div><div class="crx-hist">' + runs.map(r => {
      const bots = r.mode === 'solo' ? [r.steps[0]?.bot] : ['leader', ...new Set(r.steps.map(s => s.bot))];
      return `<button class="crx-hist-item" data-open="${r.id}">
        <span style="display:flex">${bots.slice(0, 4).map((b, i) => `<span style="margin-left:${i ? -8 : 0}px">${avatar(b, 26)}</span>`).join('')}</span>
        <span class="g"><b>${r.meta && r.meta.from === 'glowlead' ? '👑 ' : ''}${esc(goalTitle(r.goal))}</b><span>${fmtAgo(r.createdAt)} · ${esc(r.provider)}</span></span>
        <span class="crx-badge ${r.status}">${r.status}</span>
      </button>`;
    }).join('') + '</div>';
  }

  function settingsHtml() {
    const s = getSettings();
    const p = PROVIDERS[s.provider];
    const isGlow = s.provider === 'glow';
    const glowCard = !isGlow ? '' : `
      <div class="crx-glow">
        <div class="crx-glow-h"><span class="crx-glow-logo">✦</span><b>Glow AI</b><span class="crx-badge ${glow.signedIn ? 'done' : ''}">${glow.signedIn ? 'signed in' : 'guest'}</span></div>
        <p>${glow.signedIn
          ? `Signed in as <b>${esc(glow.name || 'your Glow account')}</b>. The crew uses your Glow models — the same account and allowance as GlowChat.`
          : (glow.checking ? 'Checking your Glow account…' : 'Using <b>Glow Free</b> (no sign-up). Sign in with your Glow account for stronger models like GPT-5 mini, Claude and Gemini — one account for GlowChat and GlowRoom.')}</p>
        ${glow.signedIn ? `<div class="crx-field"><label>Glow model</label><select data-set="model">${GLOW_MODELS.map(([id, name]) => `<option value="${id}" ${id === glowModel() ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div>` : ''}
        ${glow.notice ? `<div class="crx-err">${esc(glow.notice)}</div>` : ''}
        <div class="crx-actions" style="margin:0">
          ${glow.signedIn ? '<button class="crx-btn" data-act="glow-signout">Sign out</button>' : '<button class="crx-btn primary" data-act="glow-signin">Sign in with Glow</button>'}
          <a class="crx-btn" href="${glowUrl()}" target="glow" rel="noopener">Open GlowChat ↗</a>
        </div>
      </div>`;
    return `
      <div class="crx-note">Your crew needs an AI model to think. <b>Glow AI</b> works instantly — no key, no sign-up. Prefer your own provider? Pick it below; keys stay in this browser and go only to that provider.</div>
      ${glowCard}
      <div class="crx-field"><label>Provider</label>
        <select data-set="provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === s.provider ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <small>${esc(p.note)}</small></div>
      ${p.needsKey || s.provider === 'custom' ? `<div class="crx-field"><label>API key${p.needsKey ? '' : ' (optional)'}</label><input data-set="apiKey" type="password" autocomplete="off" placeholder="Paste key" value="${esc(s.apiKey)}"></div>
      <label class="crx-check"><input type="checkbox" data-set="rememberKey" ${s.rememberKey ? 'checked' : ''}> Remember key on this device (otherwise cleared when the tab closes)</label>` : ''}
      ${isGlow ? '' : `<div class="crx-field"><label>Model</label><input data-set="model" placeholder="${esc(p.model)}" value="${esc(s.model)}"><small>Leave empty for the default (${esc(p.model)}).</small></div>`}
      ${s.provider === 'custom' ? `<div class="crx-field"><label>Endpoint URL</label><input data-set="baseUrl" placeholder="${esc(p.url)}" value="${esc(s.baseUrl)}"></div>` : ''}
      <label class="crx-check"><input type="checkbox" data-set="webAccess" ${s.webAccess ? 'checked' : ''}> Let Scout search and read the live web</label>
      <label class="crx-check"><input type="checkbox" data-set="realMode" ${s.realMode ? 'checked' : ''}> Commands produce real AI results (off = demo simulation only)</label>
      <div class="crx-actions"><button class="crx-btn primary" data-act="test">Test connection</button><button class="crx-btn" data-act="history">View results</button></div>
      <div id="crx-test-out" class="crx-test-out"></div>`;
  }

  function stepCard(run, step, index) {
    const b = BOTS[step.bot];
    const key = run.id + ':' + index;
    const isCollapsed = collapsed[key] ?? (run.mode === 'team' && step.status === 'done' && !!run.final);
    const running = step.status === 'running';
    let inner = '';
    if (step.output) {
      inner += `<div class="crx-md ${running ? 'crx-cursor' : ''}">${renderMarkdown(step.output)}</div>`;
    } else if (running) {
      inner += '<div class="crx-wait">Working…</div>';
    } else if (step.status === 'queued') {
      inner += '<div class="crx-wait">Waiting for teammates…</div>';
    }
    (step.artifacts || []).forEach(a => {
      if (a.type === 'sources' && a.items?.length) {
        inner += `<div class="crx-sources"><small style="color:var(--crx-muted,#94a3b8)">Searched “${esc(a.query)}”</small>${a.items.map((s, i) =>
          `<a class="crx-src" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><b>[${i + 1}] ${esc(s.title)}</b><span>${esc(s.snippet || s.url)}</span></a>`).join('')}</div>`;
      }
      if (a.type === 'run') {
        const status = a.ok
          ? `<span class="ok">✓ ran in ${a.ms} ms</span>${a.passed || a.failed ? ` · ${a.passed} passed · <span class="${a.failed ? 'bad' : 'ok'}">${a.failed} failed</span>` : ''}`
          : `<span class="bad">✗ ${esc(String(a.error || '').split('\n')[0])}</span>`;
        inner += `<div class="crx-run"><div class="crx-run-h">${esc(a.label || 'Execution')} · ${status}<span style="flex:1"></span><button class="crx-btn" style="height:24px;padding:0 8px;font-size:11px" data-rerun-code="${index}">Run again</button></div><pre>${esc((a.out || []).join('\n') || (a.ok ? '(no output)' : a.error || ''))}</pre></div>`;
      }
      if (a.type === 'svg') {
        const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.svg);
        inner += `<div class="crx-svg"><img alt="Generated graphic" src="${src}"><div style="margin-top:10px"><a class="crx-btn" download="crewroom-${run.id}.svg" href="${src}">Download SVG</a></div></div>`;
      }
    });
    if (step.error) inner += `<div class="crx-err">${esc(step.error)}</div>`;
    return `<div class="crx-card ${isCollapsed ? 'collapsed' : ''}" data-key="${key}">
      <div class="crx-card-h" data-toggle="${key}">${avatar(step.bot)}<b>${esc(b.name)}</b><span class="t">${esc(step.task)}</span><span class="crx-badge ${step.status === 'queued' ? '' : step.status}">${step.status}</span></div>
      <div class="crx-card-b">${inner}</div></div>`;
  }

  function runHtml(run) {
    const elapsed = Math.round(((run.finishedAt || Date.now()) - run.createdAt) / 1000);
    let html = `<h3 class="crx-goal" title="${esc(run.goal.slice(0, 600))}">${esc(goalTitle(run.goal, 200))}</h3>${run.meta && run.meta.from === 'glowlead' ? '<p class="crx-owner">👑 Mission from GlowLead — it checks this result and uses it in its report.</p>' : ''}
      <div class="crx-meta"><span class="crx-badge ${run.status}">${run.status}</span><span>${esc(run.provider)}</span><span>${elapsed}s</span>${run.parentId ? '<span>follow-up</span>' : ''}</div>
      <div class="crx-actions">
        ${run.status === 'running' ? '<button class="crx-btn danger" data-act="stop">■ Stop</button>' : '<button class="crx-btn" data-act="rerun">↻ Re-run</button>'}
        ${run.status === 'done' ? '<button class="crx-btn glow" data-act="to-glow" title="Open this result as a chat in GlowChat">✦ Continue in GlowChat</button>' : ''}
        <button class="crx-btn" data-act="copy">Copy</button>
        <button class="crx-btn" data-act="download">Download .md</button>
        <button class="crx-btn" data-act="history">All results</button>
        <button class="crx-btn danger" data-act="delete" style="margin-left:auto">Delete</button>
      </div>`;
    if (run.error) {
      html += `<div class="crx-err">${esc(run.error)}${/API key|401|403/.test(run.error) ? ' — <a href="#" data-act="settings" style="color:inherit;text-decoration:underline">open AI settings</a>' : ''}</div>`;
    }
    if (run.mode === 'team') {
      if (run.planning) {
        html += `<div class="crx-card"><div class="crx-card-b"><span class="crx-wait">${avatar('leader', 22)} Nova is planning who does what…</span></div></div>`;
      } else if (run.steps.length) {
        html += `<div class="crx-steps-plan">${run.steps.map(s =>
          `<span class="crx-chip ${s.status}"><i style="background:${BOTS[s.bot].color}">${esc(BOTS[s.bot].name[0])}</i>${esc(BOTS[s.bot].name)}</span>`).join('<span style="color:var(--crx-muted)">→</span>')}<span style="color:var(--crx-muted)">→</span><span class="crx-chip ${run.writingFinal ? 'running' : run.final ? 'done' : ''}"><i style="background:${BOTS.leader.color}">N</i>Final</span></div>`;
      }
      if (run.final || run.writingFinal) {
        html += `<div class="crx-card crx-final"><div class="crx-card-h">${avatar('leader')}<b>Final answer</b><span class="t">by Nova</span></div><div class="crx-card-b"><div class="crx-md ${run.writingFinal ? 'crx-cursor' : ''}">${run.final ? renderMarkdown(run.final) : '<span class="crx-wait">Writing…</span>'}</div></div></div>`;
      }
    }
    html += run.steps.map((s, i) => stepCard(run, s, i)).join('');
    if (run.status !== 'running') {
      html += `<div class="crx-field" style="margin-top:16px"><label>Follow up</label><div class="crx-follow"><input data-follow placeholder="Ask a follow-up or request changes…"><button class="crx-btn primary" data-act="follow">Send</button></div></div>`;
    }
    return html;
  }

  async function onDrawerClick(e) {
    const t = e.target;
    const copyBtn = t.closest('[data-copy]');
    if (copyBtn) {
      const code = copyBtn.closest('.crx-code').querySelector('code').textContent;
      navigator.clipboard?.writeText(code);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      return;
    }
    const toggle = t.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      const card = toggle.closest('.crx-card');
      collapsed[key] = !card.classList.contains('collapsed');
      card.classList.toggle('collapsed', collapsed[key]);
      return;
    }
    const openBtn = t.closest('[data-open]');
    if (openBtn) {
      openRun(openBtn.dataset.open);
      return;
    }
    const rerunCode = t.closest('[data-rerun-code]');
    if (rerunCode) {
      const run = getRun(view.runId);
      const step = run?.steps[Number(rerunCode.dataset.rerunCode)];
      const art = step?.artifacts.find(a => a.type === 'run');
      if (art) {
        const testedCode = step.bot === 'tester'
          ? (run.steps.find(s => s.bot === 'coder')?.artifacts.find(a => a.type === 'run')?.code || '') + '\n' + art.code
          : art.code;
        const result = await runJS(testedCode, 8000);
        Object.assign(art, result);
        changed(run);
      }
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) return;
    e.preventDefault();
    const run = getRun(view.runId);
    if (act === 'stop' && run) stop(run.id);
    if (act === 'rerun' && run) openRun(rerun(run.id).id);
    if (act === 'copy' && run) {
      navigator.clipboard?.writeText(run.final || toMarkdown(run));
      toastIn(t, 'Copied');
    }
    if (act === 'download' && run) {
      const blob = new Blob([toMarkdown(run)], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'glowroom-' + goalTitle(run.goal, 40).replace(/[^\w]+/g, '-').toLowerCase() + '.md';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (act === 'delete' && run) {
      remove(run.id);
      openHistory();
    }
    if (act === 'history') openHistory();
    if (act === 'settings') openSettings();
    if (act === 'follow' && run) {
      const input = drawer.querySelector('[data-follow]');
      const q = input.value.trim();
      if (!q) {
        input.focus();
        return;
      }
      input.blur();
      openRun(followUp(run.id, q).id);
    }
    if (act === 'test') testConnection();
    if (act === 'to-glow' && run) sendToGlow(run);
    if (act === 'glow-signin') {
      try {
        await glowSignIn();
      } catch (err) {
        glow.notice = /closed/i.test(String(err?.message || err?.error || '')) ? 'The sign-in window was closed.' : "Sign-in didn't finish. Try again.";
      }
      render();
    }
    if (act === 'glow-signout') {
      await glowSignOut();
      render();
    }
  }

  function toastIn(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  // Settings form: save on change.
  document.addEventListener('change', e => {
    const el = e.target.closest?.('.crx-drawer [data-set]');
    if (!el) return;
    const field = el.dataset.set;
    const value = el.type === 'checkbox' ? el.checked : el.value.trim();
    const patch = { [field]: value };
    if (field === 'provider') {
      patch.model = '';
      patch.baseUrl = '';
    }
    saveSettings(patch);
    if (field === 'provider' || el.type === 'checkbox') {
      el.blur();
      render();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches?.('.crx-drawer [data-follow]')) {
      drawer.querySelector('[data-act="follow"]').click();
    }
    if (e.key === 'Enter' && e.target.matches?.('.crx-drawer [data-set]')) {
      e.target.blur();
    }
  });
  document.addEventListener('focusout', e => {
    if (e.target.matches?.('.crx-drawer input')) setTimeout(scheduleRender, 50);
  });

  async function testConnection() {
    const out = document.getElementById('crx-test-out');
    if (!out) return;
    out.innerHTML = '<span class="crx-wait">Contacting ' + esc(providerLabel()) + '…</span>';
    const started = performance.now();
    try {
      const text = await chat({
        system: 'You are a connectivity check.',
        messages: [{ role: 'user', content: 'Reply with exactly: Crew ready' }],
        temperature: 0,
        maxTokens: 20
      });
      out.innerHTML = `<div class="crx-note" style="color:#10b981">✓ Connected in ${Math.round(performance.now() - started)} ms — model replied: “${esc(text.trim().slice(0, 80))}”</div>`;
    } catch (err) {
      out.innerHTML = `<div class="crx-err">${esc(err.message)}</div>`;
    }
  }

  window.CrewEngine = {
    BOTS,
    goalTitle,
    PROVIDERS,
    start,
    stop,
    rerun,
    followUp,
    getRun,
    get runs() {
      return runs;
    },
    on: (type, fn) => emitter.addEventListener(type, e => fn(e.detail)),
    getSettings,
    saveSettings,
    providerLabel,
    isReady,
    openRun,
    openHistory,
    openSettings,
    close,
    renderMarkdown,
    toMarkdown,
    tools: { webSearch, readUrl, runJS, chat },
    glow: {
      status: glowStatus,
      signIn: glowSignIn,
      signOut: glowSignOut,
      send: id => {
        const run = getRun(id);
        if (run) sendToGlow(run);
      },
      url: glowUrl
    }
  };
  // Pick up an existing Glow sign-in without blocking the page.
  setTimeout(() => {
    restoreGlowSession();
  }, 300);
})();
