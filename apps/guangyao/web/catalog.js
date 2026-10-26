/* Published content (lessons, materials, events) shared by the learner app and the admin console.
 * Source of truth: a public GitHub repository that only its collaborators can write to.
 * Everything read from it is treated as untrusted input and sanitised before use. */
'use strict';

(function () {
  const CONFIG = Object.freeze({
    owner: 'juwpegatron',
    repo: 'guangyao-content',
    branch: 'main',
    catalogPath: 'catalog.json',
    maxFileBytes: 20 * 1024 * 1024
  });
  const CACHE_KEY = 'guangyao-catalog-v1';
  const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const FILE_PATH_PATTERN = /^files\/[A-Za-z0-9._\/-]{1,200}$/;
  const EVENT_TYPES = ['online', 'offline', 'social'];

  const list = value => Array.isArray(value) ? value : [];
  const text = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, limit) : '';
  const isoDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '';
  const status = value => value === 'draft' ? 'draft' : 'published';

  function httpsUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  /* Returns an 11-character YouTube id for watch, short, embed and youtu.be links. */
  function youtubeId(value) {
    const url = httpsUrl(value);
    if (!url) return '';
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = parsed.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = parsed.searchParams.get('v') || (parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/) || [])[1] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  }

  function sanitizeQuiz(raw) {
    const options = list(raw?.options).map(option => text(option, 80)).filter(Boolean).slice(0, 4);
    const question = text(raw?.question, 200);
    const answer = Number.isInteger(raw?.answer) && raw.answer >= 0 && raw.answer < options.length ? raw.answer : -1;
    if (!question || options.length < 2 || answer < 0) return null;
    return {question, options, answer, explain: text(raw?.explain, 300)};
  }

  function sanitizeLesson(raw) {
    if (!raw || !ID_PATTERN.test(raw.id)) return null;
    const title = text(raw.title, 60);
    const reading = list(raw.reading).map(paragraph => text(paragraph, 800)).filter(Boolean).slice(0, 12);
    if (!title || !reading.length) return null;
    return {
      id: raw.id,
      title,
      summary: text(raw.summary, 300),
      reading,
      video: youtubeId(raw.video) ? `https://www.youtube.com/watch?v=${youtubeId(raw.video)}` : '',
      quiz: list(raw.quiz).map(sanitizeQuiz).filter(Boolean).slice(0, 5),
      reflect: text(raw.reflect, 200),
      cards: list(raw.cards).map(card => [text(card?.[0], 120), text(card?.[1], 240)]).filter(([front, back]) => front && back).slice(0, 20),
      materials: [...new Set(list(raw.materials).filter(id => ID_PATTERN.test(id)))].slice(0, 10),
      order: Number.isInteger(raw.order) ? Math.max(0, Math.min(raw.order, 9999)) : 0,
      status: status(raw.status),
      author: text(raw.author, 40),
      publishedAt: isoDate(raw.publishedAt),
      updatedAt: isoDate(raw.updatedAt)
    };
  }

  function sanitizeMaterial(raw) {
    if (!raw || !ID_PATTERN.test(raw.id)) return null;
    const title = text(raw.title, 80);
    const kind = ['file', 'link', 'video'].includes(raw.kind) ? raw.kind : '';
    if (!title || !kind) return null;
    const material = {
      id: raw.id,
      title,
      kind,
      description: text(raw.description, 400),
      notes: text(raw.notes, 4000),
      tags: list(raw.tags).map(tag => text(tag, 20)).filter(Boolean).slice(0, 6),
      status: status(raw.status),
      author: text(raw.author, 40),
      publishedAt: isoDate(raw.publishedAt),
      updatedAt: isoDate(raw.updatedAt)
    };
    if (kind === 'file') {
      if (!FILE_PATH_PATTERN.test(raw.path || '') || String(raw.path).includes('..')) return null;
      material.path = raw.path;
      material.commit = /^[0-9a-f]{40}$/.test(raw.commit || '') ? raw.commit : '';
      material.size = Number.isInteger(raw.size) && raw.size >= 0 ? raw.size : 0;
      material.mime = text(raw.mime, 80);
      material.filename = text(raw.filename, 120) || raw.path.split('/').pop();
    } else {
      material.url = httpsUrl(raw.url);
      if (!material.url) return null;
    }
    return material;
  }

  function sanitizeEvent(raw) {
    if (!raw || !ID_PATTERN.test(raw.id)) return null;
    const title = text(raw.title, 60);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time || '')) return null;
    return {
      id: raw.id,
      title,
      date: raw.date,
      time: raw.time,
      duration: text(raw.duration, 20) || '60 分鐘',
      type: EVENT_TYPES.includes(raw.type) ? raw.type : 'online',
      teacher: text(raw.teacher, 30),
      place: text(raw.place, 100),
      description: text(raw.description, 1000),
      signupUrl: httpsUrl(raw.signupUrl),
      status: status(raw.status),
      publishedAt: isoDate(raw.publishedAt)
    };
  }

  function unique(items) {
    const seen = new Set();
    return items.filter(item => item && !seen.has(item.id) && seen.add(item.id));
  }

  function sanitize(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      schema: 1,
      updatedAt: isoDate(source.updatedAt),
      settings: {
        announcement: text(source.settings?.announcement, 200),
        hideSamples: source.settings?.hideSamples === true
      },
      lessons: unique(list(source.lessons).slice(0, 300).map(sanitizeLesson)),
      materials: unique(list(source.materials).slice(0, 500).map(sanitizeMaterial)),
      events: unique(list(source.events).slice(0, 300).map(sanitizeEvent))
    };
  }

  const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
  const rawUrl = path => `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${encodePath(path)}`;
  /* Commit-pinned CDN links are immutable and served with the right content type. */
  function fileUrl(material) {
    if (!material || material.kind !== 'file') return material?.url || '';
    return material.commit
      ? `https://cdn.jsdelivr.net/gh/${CONFIG.owner}/${CONFIG.repo}@${material.commit}/${encodePath(material.path)}`
      : rawUrl(material.path);
  }
  const historyUrl = () => `https://github.com/${CONFIG.owner}/${CONFIG.repo}/commits/${CONFIG.branch}`;

  /* Converts a published lesson into the interactive lesson-player format. */
  function lessonContent(lesson, materials = []) {
    const attached = lesson.materials.map(id => materials.find(item => item.id === id && item.status === 'published')).filter(Boolean);
    return {
      official: true,
      id: lesson.id,
      title: lesson.title,
      reading: lesson.reading,
      summary: lesson.summary || lesson.reading[0].slice(0, 120),
      mcqs: lesson.quiz.map(item => ({question: item.question, options: item.options, answer: item.answer, explain: item.explain || '答案取自本課內容。'})),
      reflect: lesson.reflect,
      cards: lesson.cards.length ? lesson.cards : lesson.quiz.map(item => [item.question, item.options[item.answer]]),
      video: youtubeId(lesson.video),
      attachments: attached.map(item => ({id: item.id, title: item.title, url: fileUrl(item), kind: item.kind}))
    };
  }

  const published = catalog => ({
    ...catalog,
    lessons: catalog.lessons.filter(item => item.status === 'published').sort((a, b) => a.order - b.order || (b.publishedAt || '').localeCompare(a.publishedAt || '')),
    materials: catalog.materials.filter(item => item.status === 'published').sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')),
    events: catalog.events.filter(item => item.status === 'published').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  });

  let current = sanitize(null);
  let lastFetched = 0;
  let source = 'none';
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) {
      current = sanitize(cached);
      source = 'cache';
    }
  } catch {
    current = sanitize(null);
  }

  async function fetchJson(url, headers = {}) {
    const response = await fetch(url, {cache: 'no-store', headers});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  /* Raw GitHub is CDN-cached for up to five minutes; the API is fresh but rate-limited. */
  async function refresh({fresh = false} = {}) {
    if (!fresh && Date.now() - lastFetched < 30000) return current;
    const raw = rawUrl(CONFIG.catalogPath) + `?t=${Math.floor(Date.now() / 30000)}`;
    const api = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.catalogPath}?ref=${CONFIG.branch}`;
    let data;
    try {
      data = fresh ? await fetchJson(api, {Accept: 'application/vnd.github.raw'}) : await fetchJson(raw);
    } catch {
      data = fresh ? await fetchJson(raw) : await fetchJson(api, {Accept: 'application/vnd.github.raw'});
    }
    const next = sanitize(data);
    lastFetched = Date.now();
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    source = 'network';
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      /* Storage full or disabled: keep the in-memory copy only. */
    }
    if (changed) document.dispatchEvent(new CustomEvent('guangyao:catalog', {detail: next}));
    return next;
  }

  /* Test hook: lets the browser suite inject a catalog without network access. */
  function inject(raw) {
    current = sanitize(raw);
    lastFetched = Date.now();
    source = 'test';
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(current));
    } catch {
      /* ignore */
    }
    document.dispatchEvent(new CustomEvent('guangyao:catalog', {detail: current}));
  }

  window.GY_CATALOG = {
    CONFIG,
    ID_PATTERN,
    sanitize,
    sanitizeLesson,
    sanitizeMaterial,
    sanitizeEvent,
    refresh,
    inject,
    fileUrl,
    rawUrl,
    historyUrl,
    httpsUrl,
    youtubeId,
    lessonContent,
    published,
    get current() {
      return current;
    },
    get live() {
      return published(current);
    },
    get source() {
      return source;
    }
  };
})();
