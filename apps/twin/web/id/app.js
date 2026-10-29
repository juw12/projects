/* Twin Indonesia app shell (codename Satu): state, routing, views and interactions.
 * Hosted inside Twin at web/id/; shares Twin's theme, service worker and demo data.
 * Depends on engine.js (logic), feeds.js (live data), snapshot.js, ideas.js and
 * content.js (data), plus Twin's ../demo.js for wallet transfers in the browser
 * version. Works from file:// with no server.
 */
(function () {
  'use strict';

  const E = window.SatuEngine;
  const F = window.SatuFeeds;
  const SNAP = window.SATU_SNAPSHOT;
  const C = window.SATU_CONTENT;
  const IDEAS = window.SATU_IDEAS || [];
  const VERSION = '1.14.0'; // Twin release that ships this module

  const params = new URLSearchParams(location.search);
  const SELFTEST = params.has('selftest');
  const OFFLINE = params.has('offline') || SELFTEST;
  const DEMO = params.has('demo');
  const STORAGE_KEY = SELFTEST ? 'twin_id_selftest_v1' : DEMO ? 'twin_id_demo_v1' : 'twin_id_state_v1';
  // Only the real wallet (not the demo or self-test) is summarised for Twin and synced.
  const SYNCS = !DEMO && !SELFTEST;
  // Twin's Home and Me screens read this summary (same origin) to show the rupiah wallet.
  const SUMMARY_KEY = 'twin_id_summary_v1';
  // The Twin account and server revision this browser's wallet last synced with.
  const SYNC_KEY = 'twin_id_sync_v1';
  // A local wallet replaced by the account copy is kept here, just in case.
  const BACKUP_KEY = 'twin_id_state_backup_v1';

  const INSTRUMENTS = {};
  const KNOWN_BY_MARKET = { US: [], IDX: [], CRYPTO: [], GOLD: [] };
  for (const instrument of SNAP.instruments) {
    INSTRUMENTS[instrument.symbol] = instrument;
    KNOWN_BY_MARKET[instrument.market].push(instrument.symbol);
  }
  const SYMBOLS = Object.keys(INSTRUMENTS);
  const MARKET_COLORS = { US: '#6366f1', IDX: '#ef4444', CRYPTO: '#8b5cf6', GOLD: '#f59e0b', CASH: '#cbd5e1' };
  const DEFAULT_WATCH = { US: ['VOO', 'AAPL', 'NVDA'], IDX: ['BBCA', 'TLKM', 'ANTM'], CRYPTO: ['BTC', 'ETH'], GOLD: ['XAU'] };
  const ANALYSTS = C.analysts;

  const runtime = {
    prices: {},
    fxRate: SNAP.fx.USDIDR,
    fxAsOf: Date.parse(SNAP.fx.asOf),
    benchmarks: {},
    sources: { stocks: 'snapshot', crypto: 'snapshot', stocksTime: null, cryptoTime: null },
    news: SNAP.news.slice(),
    newsSource: 'snapshot',
    server: false,
    // Account sync with Twin's server (signed-in Twin account only).
    sync: { enabled: false, status: 'off', account: null, rev: 0, pushing: false, pending: false, lastSyncedAt: null },
    serverProbe: null,
    // Twin's US dollar practice portfolio, linked for transfers (see linkUsdWallet).
    usd: { kind: null, paper: null, checking: false, checkedAt: 0, reason: '', error: '' },
    transfer: null,
    summaryAt: 0,
    storageOk: true,
    charts: {},
    chartPoints: {},
    chartRange: {},
    ticket: null,
    onboarding: freshOnboarding(),
    lessonState: {},
    riskDraft: null,
    rng: E.makeRng((Date.now() ^ 0x9e3779b9) >>> 0),
    timers: [],
    search: '',
    draft: '',
    draftSentiment: '',
    deskAnalyst: 'all',
    lastRouteKey: null,
    saveTimer: null,
  };

  function freshOnboarding() {
    return { step: 0, markets: E.MARKET_ORDER.slice(), answers: {}, cash: 10000000 };
  }

  // ------------------------------------------------------------ prices

  function seedPrices() {
    for (const instrument of SNAP.instruments) {
      runtime.prices[instrument.symbol] = {
        price: instrument.price,
        raw: instrument.price,
        prev: instrument.prev,
        changePct: instrument.changePct,
        dayHigh: instrument.dayHigh,
        dayLow: instrument.dayLow,
        high52: instrument.high52,
        low52: instrument.low52,
        volume: instrument.volume,
        time: instrument.time ? instrument.time * 1000 : null,
        spark: instrument.spark || [],
        source: 'Snapshot',
      };
    }
    for (const [name, bench] of Object.entries(SNAP.benchmarks)) {
      runtime.benchmarks[name] = bench.price;
    }
  }

  function mergePrices(updates) {
    for (const [symbol, update] of Object.entries(updates)) {
      const current = runtime.prices[symbol] || {};
      const clean = {};
      for (const [key, value] of Object.entries(update)) {
        if (value != null) clean[key] = value;
      }
      clean.raw = clean.price || current.raw;
      runtime.prices[symbol] = Object.assign({}, current, clean);
    }
  }

  function benchPrice(name) {
    if (!name) return null;
    if (name === 'BTC') return runtime.prices.BTC.price;
    return runtime.benchmarks[name] || null;
  }

  // ------------------------------------------------------------- state

  let state = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? E.migrateState(JSON.parse(raw)) : null;
    } catch (error) {
      runtime.storageOk = false;
      return null;
    }
  }

  function save() {
    if (!state) return;
    state.savedAt = new Date().toISOString();
    persistLocal();
    if (runtime.sync.enabled) scheduleSync();
  }

  /** Write the wallet (and Twin's summary of it) to this browser, keeping savedAt. */
  function persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      runtime.storageOk = false;
    }
    writeSummary();
  }

  /** The numbers Twin shows on Home and Me. Price ticks refresh it at most every 10 s. */
  function writeSummary(throttled) {
    if (!SYNCS || !state || !state.profile || !state.profile.onboarded) return;
    if (throttled && Date.now() - runtime.summaryAt < 10000) return;
    runtime.summaryAt = Date.now();
    try {
      localStorage.setItem(SUMMARY_KEY, JSON.stringify(Object.assign(E.walletSummary(state, ctx()), { simulated: isSimulated() })));
    } catch (error) {
      // Twin just won't show the summary
    }
  }

  function clearSummary() {
    if (!SYNCS) return;
    try {
      localStorage.removeItem(SUMMARY_KEY);
    } catch (error) {
      // nothing stored
    }
  }

  function ctx(overrides) {
    const simulated = state && state.settings.dataMode === 'simulated';
    return Object.assign(
      {
        instruments: INSTRUMENTS,
        prices: runtime.prices,
        fxRate: runtime.fxRate,
        now: Date.now(),
        respectHours: simulated ? false : !state || state.settings.respectHours !== false,
      },
      overrides || {}
    );
  }

  function isSimulated() {
    return !!state && state.settings.dataMode === 'simulated';
  }

  function defaultWatchlist(markets) {
    const list = [];
    for (const market of E.MARKET_ORDER) {
      if (markets.indexOf(market) !== -1) list.push(...DEFAULT_WATCH[market]);
    }
    return list;
  }

  // ----------------------------------------------------------- helpers

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function parseAmount(value) {
    const digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  function parseDecimal(value) {
    const text = String(value == null ? '' : value).trim().replace(/\s/g, '').replace(',', '.');
    const number = parseFloat(text);
    return Number.isFinite(number) ? number : 0;
  }

  function floorDecimals(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor + 1e-7) / factor;
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(ms) {
    return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function timeAgo(value) {
    const ms = typeof value === 'number' ? value : Date.parse(value);
    if (!ms) return '';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return fmtDate(ms);
  }

  function priceText(symbol) {
    const instrument = INSTRUMENTS[symbol];
    const quote = runtime.prices[symbol];
    return instrument && quote ? E.formatPrice(instrument.market, quote.price) : '—';
  }

  function usdToIdrText(symbol) {
    const quote = runtime.prices[symbol];
    return `≈ ${E.formatIdr(quote.price * runtime.fxRate)}`;
  }

  function changeSpan(symbol, extraClass) {
    const quote = runtime.prices[symbol];
    const pct = quote ? quote.changePct : 0;
    return `<span class="${pct >= 0 ? 'up' : 'down'} ${extraClass || ''}" data-change="${esc(symbol)}">${E.formatPct(pct)}</span>`;
  }

  function badgeText(symbol) {
    return symbol.length > 4 ? symbol.slice(0, 4) : symbol;
  }

  // Drawn market marks. Flag emoji and the coin emoji do not render on
  // Windows, so every market gets a small inline SVG that looks the same on
  // every platform. All marks share a 30x20 canvas.
  const MARKET_ICONS = {
    US: `<svg class="micon flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <rect width="30" height="20" fill="#fff"/>
        <path fill="#b22234" d="M0 0h30v1.54H0zM0 3.08h30v1.54H0zM0 6.15h30v1.54H0zM0 9.23h30v1.54H0zM0 12.31h30v1.54H0zM0 15.38h30v1.54H0zM0 18.46h30v1.54H0z"/>
        <rect width="12" height="10.77" fill="#3c3b6e"/>
        <g fill="#fff"><circle cx="2.5" cy="2.4" r=".7"/><circle cx="6" cy="2.4" r=".7"/><circle cx="9.5" cy="2.4" r=".7"/><circle cx="4.25" cy="5.4" r=".7"/><circle cx="7.75" cy="5.4" r=".7"/><circle cx="2.5" cy="8.4" r=".7"/><circle cx="6" cy="8.4" r=".7"/><circle cx="9.5" cy="8.4" r=".7"/></g>
      </svg>`,
    IDX: `<svg class="micon flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <rect width="30" height="20" fill="#fff"/>
        <rect width="30" height="10" fill="#ce1126"/>
      </svg>`,
    CRYPTO: `<svg class="micon" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <circle cx="15" cy="10" r="9.6" fill="#f7931a"/>
        <path d="M13.2 3.2v2.2M15.9 3.2v2.2M13.2 14.6v2.2M15.9 14.6v2.2" stroke="#fff" stroke-width="1.3"/>
        <text x="15.2" y="14.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#fff">B</text>
      </svg>`,
    GOLD: `<svg class="micon" viewBox="0 0 30 20" aria-hidden="true" focusable="false">
        <path d="M8.5 4h13l5.5 12.5H3z" fill="#c9971c"/>
        <path d="M9.6 5.4h10.8l2.1 4.8h-15z" fill="#f4d46a"/>
      </svg>`,
  };

  function marketIcon(marketId) {
    return MARKET_ICONS[marketId] || '';
  }

  function marketLabel(marketId) {
    const market = E.MARKETS[marketId];
    return `<span class="mlabel">${marketIcon(marketId)}${esc(market.short)}</span>`;
  }

  function statusFor(marketId) {
    if (isSimulated()) {
      return { open: true, state: 'open', label: 'Simulation · always open', localTime: '', zone: '' };
    }
    return E.marketStatus(marketId, Date.now());
  }

  function linkify(text) {
    return esc(text).replace(/\$([A-Z]{1,5})\b/g, (match, symbol) =>
      INSTRUMENTS[symbol] ? `<a href="#asset/${symbol}">$${symbol}</a>` : match
    );
  }

  function planId() {
    return (state && state.plan && state.plan.id) || 'free';
  }

  function holds(symbol) {
    return !!(state && state.positions[symbol]);
  }

  // ------------------------------------------------------------ charts

  function sparkSvg(values, positive) {
    if (!values || values.length < 2) {
      return '<svg class="spark" viewBox="0 0 72 28" aria-hidden="true"></svg>';
    }
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const points = values
      .map((value, index) => `${((index / (values.length - 1)) * 72).toFixed(1)},${(26 - ((value - min) / span) * 24).toFixed(1)}`)
      .join(' ');
    const stroke = positive ? 'var(--up)' : 'var(--down)';
    return `<svg class="spark" viewBox="0 0 72 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function chartHtml(key, points, marketId) {
    if (!points || points.length < 2) {
      return `<div class="empty small">No chart for this range${OFFLINE ? ' while offline' : ' yet'}.</div>`;
    }
    runtime.chartPoints[key] = { points, market: marketId };
    const width = 600;
    const height = 220;
    const pad = 6;
    const values = points.map((point) => point[1]);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const x = (index) => pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = (value) => pad + 16 + (1 - (value - min) / span) * (height - pad * 2 - 20);
    const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[1]).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
    const positive = values[values.length - 1] >= values[0];
    const color = positive ? 'var(--up)' : 'var(--down)';
    const first = points[0];
    const last = points[points.length - 1];
    const changePct = ((last[1] - first[1]) / first[1]) * 100;
    const label = `${E.formatPct(changePct)} over this range · high ${E.formatPrice(marketId, max)} · low ${E.formatPrice(marketId, min)}`;
    return `<div class="chart-wrap" data-chart="${esc(key)}">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
        <path d="${area}" fill="${color}" opacity="0.08"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      </svg>
      <div class="chart-tip">${esc(label)}</div>
      <div class="chart-cursor"></div>
    </div>`;
  }

  function chartPointsFor(symbol, range) {
    const key = `${symbol}|${range}`;
    if (runtime.charts[key]) return runtime.charts[key];
    const instrument = INSTRUMENTS[symbol];
    if (instrument.hist && instrument.hist[range]) return instrument.hist[range];
    if (range === '1D') {
      const spark = runtime.prices[symbol].spark || [];
      return spark.length > 1 ? spark.map((value) => [null, value]) : null;
    }
    return null;
  }

  // ------------------------------------------------------- shell & routing

  const routes = {
    home: viewHome,
    markets: viewMarkets,
    asset: viewAsset,
    portfolio: viewPortfolio,
    community: viewCommunity,
    desk: viewDesk,
    learn: viewLearn,
    lesson: viewLesson,
    me: viewMe,
    plans: viewPlans,
    guide: viewGuide,
    risk: viewRisk,
    // #transfer (optionally #transfer/idr_to_usd) opens Portfolio with the transfer sheet;
    // Twin's Me screen links here.
    transfer: viewPortfolio,
  };

  const NAV_FOR = { asset: 'markets', desk: 'community', lesson: 'learn', transfer: 'portfolio' };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/');
    const name = parts.shift() || 'home';
    const arg = parts.length ? decodeURIComponent(parts.join('/')) : null;
    return { name: routes[name] ? name : 'home', arg };
  }

  function shellHtml() {
    return `
      <header class="topbar">
        <a class="brand" href="../" title="Back to Twin"><span class="brand-mark">T</span><span class="brand-text">Twin<small>Indonesia</small></span></a>
        ${DEMO ? '<span class="badge warn" title="Demo account"><span class="lbl-long">Demo account</span><span class="lbl-short">Demo</span></span>' : ''}
        <span class="spacer"></span>
        <span class="status-chip" id="data-chip"></span>
        <a class="badge brand" href="#plans" id="plan-badge"></a>
        <a class="avatar-btn row" style="justify-content:center" href="#me" aria-label="Me and settings" id="avatar"></a>
      </header>
      <div class="shell">
        <nav class="nav" id="nav" aria-label="Main">
          <a href="#home" data-route="home"><span class="ico">⌂</span>Home</a>
          <a href="#markets" data-route="markets"><span class="ico">📈</span>Markets</a>
          <a href="#portfolio" data-route="portfolio"><span class="ico">💼</span>Portfolio</a>
          <a href="#community" data-route="community"><span class="ico">💬</span>Community</a>
          <a href="#learn" data-route="learn"><span class="ico">🎓</span>Learn</a>
        </nav>
        <main class="view" id="view" tabindex="-1"></main>
      </div>`;
  }

  function updateChrome(route) {
    const chip = document.getElementById('data-chip');
    if (chip) {
      let dot = '';
      let label = '';
      let shortLabel = '';
      if (isSimulated()) {
        dot = 'sim';
        label = 'Simulated market';
        shortLabel = 'Simulated';
      } else if (runtime.sources.stocks === 'live' || runtime.sources.crypto === 'live') {
        dot = 'live';
        label = 'Live · delayed';
        shortLabel = 'Live';
      } else {
        label = `Snapshot ${fmtDate(Date.parse(SNAP.takenAt))}`;
        shortLabel = 'Snapshot';
      }
      chip.title = label;
      chip.innerHTML = `<span class="dot ${dot}"></span><span class="lbl-long">${esc(label)}</span><span class="lbl-short">${esc(shortLabel)}</span>`;
    }
    const badge = document.getElementById('plan-badge');
    if (badge) badge.textContent = planName(planId());
    const avatar = document.getElementById('avatar');
    if (avatar && state) avatar.textContent = (state.profile.name || 'G').slice(0, 1).toUpperCase();
    const active = NAV_FOR[route.name] || route.name;
    document.querySelectorAll('#nav a').forEach((link) => {
      link.classList.toggle('active', link.dataset.route === active);
    });
  }

  function planName(id) {
    const plan = C.plans.find((item) => item.id === id);
    return plan ? plan.name : 'Free';
  }

  function render() {
    const app = document.getElementById('app');
    if (!state || !state.profile || !state.profile.onboarded) {
      renderOnboarding();
      return;
    }
    if (!document.getElementById('view')) {
      app.innerHTML = shellHtml();
    }
    const route = parseHash();
    const routeKey = `${route.name}/${route.arg || ''}`;
    const view = document.getElementById('view');
    runtime.chartPoints = {};
    view.innerHTML = routes[route.name](route.arg);
    updateChrome(route);
    if (runtime.lastRouteKey !== routeKey) {
      window.scrollTo(0, 0);
      runtime.lastRouteKey = routeKey;
    }
    afterRender(route);
  }

  function afterRender(route) {
    revealActiveChips();
    if (route.name === 'portfolio' || route.name === 'transfer') {
      linkUsdWallet(false);
    }
    if (route.name === 'asset' && INSTRUMENTS[route.arg]) {
      ensureChart(route.arg);
    }
    if (route.name === 'lesson') {
      updateWidgetResult(route.arg);
    }
  }

  // Chip rows scroll sideways on phones. Keep the selected chip in view, for
  // example the Crypto room, which otherwise sits off-screen to the right.
  function revealActiveChips() {
    document.querySelectorAll('#view .chips').forEach((row) => {
      const active = row.querySelector('.active');
      if (!active || row.scrollWidth <= row.clientWidth) return;
      const offset = active.getBoundingClientRect().left - row.getBoundingClientRect().left;
      row.scrollLeft += offset - (row.clientWidth - active.offsetWidth) / 2;
    });
  }

  async function ensureChart(symbol) {
    if (OFFLINE || isSimulated()) return;
    const range = runtime.chartRange[symbol] || '1M';
    const key = `${symbol}|${range}`;
    if (runtime.charts[key]) return;
    const points = await F.loadChart(INSTRUMENTS[symbol], range);
    if (!points) return;
    runtime.charts[key] = points;
    const holder = document.getElementById('chart-holder');
    if (holder && holder.dataset.key === key) {
      holder.innerHTML = chartHtml(key, points, INSTRUMENTS[symbol].market);
    }
  }

  // ---------------------------------------------------------- onboarding

  function renderOnboarding() {
    const ob = runtime.onboarding;
    const steps = [obWelcome, obMarkets, obRisk, obReady];
    const progress = ob.step
      ? `<div class="steps">${[1, 2, 3].map((n) => `<span class="${n <= ob.step ? 'on' : ''}"></span>`).join('')}</div>`
      : '';
    document.getElementById('app').innerHTML = `<div class="onboard">${progress}${steps[ob.step]()}</div>`;
  }

  function obWelcome() {
    return `
      <a class="brand" href="../" title="Back to Twin"><span class="brand-mark">T</span><span class="brand-text">Twin<small>Indonesia</small></span></a>
      <div class="hero-title">US stocks, Indonesian stocks, crypto and gold. One app. Practice first.</div>
      <p class="muted">Twin Indonesia is the rupiah side of Twin and a working prototype. Every trade uses practice money with real, delayed prices, so you can learn how each market works before any real money is involved.</p>
      <div class="card flat stack" style="margin:18px 0">
        <div class="row"><span class="pick-ico">🌏</span><div><b>Four markets, one rupiah wallet</b><div class="small muted">Fractional US shares, IDX lots, crypto and gold by the gram, with every fee shown up front.</div></div></div>
        <div class="row"><span class="pick-ico">🧾</span><div><b>Analysts with receipts</b><div class="small muted">Only licensed advisers publish ideas, and every idea is scored automatically. Losses stay on the record.</div></div></div>
        <div class="row"><span class="pick-ico">🛡️</span><div><b>Scam Shield</b><div class="small muted">"Pasti cuan" promises, private signal groups and illegal platforms are blocked and explained.</div></div></div>
        <div class="row"><span class="pick-ico">🎓</span><div><b>Learn by doing</b><div class="small muted">Interactive lessons with calculators, quizzes and missions tied to your practice portfolio.</div></div></div>
      </div>
      <button class="btn primary block" data-action="ob-next">Start as guest</button>
      <div style="height:8px"></div>
      <a class="btn block" href="?demo#home">Explore a demo account</a>
      <p class="footnote">No account, email or money needed. Everything stays in this browser. Not investment advice.</p>`;
  }

  function obMarkets() {
    const ob = runtime.onboarding;
    const picks = E.MARKET_ORDER.map((id) => {
      const market = E.MARKETS[id];
      const selected = ob.markets.indexOf(id) !== -1;
      return `<button class="pick ${selected ? 'selected' : ''}" data-action="ob-toggle-market" data-market="${id}" aria-pressed="${selected}">
        <span class="pick-ico">${marketIcon(id)}</span>
        <span><b>${esc(market.name)}</b><span class="small muted" style="display:block">${esc(market.blurb)}</span></span>
      </button>`;
    }).join('');
    return `
      <h1>Which markets interest you?</h1>
      <p class="muted">You can change this any time. US stocks come first, then Indonesia, crypto and gold.</p>
      ${picks}
      <div class="row" style="margin-top:12px">
        <button class="btn" data-action="ob-back">Back</button>
        <button class="btn primary grow" data-action="ob-next" ${ob.markets.length ? '' : 'disabled'}>Continue</button>
      </div>`;
  }

  function riskQuizHtml(answers, prefix) {
    return C.riskQuestions.map((question) => {
      const options = question.options.map((option, index) => {
        const value = question.boolean ? index === 1 : index;
        const chosen = answers[question.key] === value;
        return `<button class="chip ${chosen ? 'active' : ''}" data-action="${prefix}-answer" data-key="${question.key}" data-value="${question.boolean ? String(value) : index}">${esc(option)}</button>`;
      }).join('');
      return `<div class="card flat"><b>${esc(question.q)}</b><div class="row wrap" style="margin-top:10px">${options}</div></div>`;
    }).join('');
  }

  function quizComplete(answers) {
    return C.riskQuestions.every((question) => answers[question.key] !== undefined);
  }

  function obRisk() {
    const answers = runtime.onboarding.answers;
    return `
      <h1>Your risk profile</h1>
      <p class="muted">Five questions. Your answers set guard-rails that the order ticket checks before every trade.</p>
      <div class="stack">${riskQuizHtml(answers, 'ob')}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-action="ob-back">Back</button>
        <button class="btn primary grow" data-action="ob-next" ${quizComplete(answers) ? '' : 'disabled'}>See my profile</button>
      </div>`;
  }

  function riskSummaryHtml(risk) {
    return `
      <div class="row between"><h2 style="margin:0">${esc(risk.label)}</h2><span class="badge brand">score ${risk.score}/12</span></div>
      <ul class="feature-list">
        <li>No single asset above <b>${risk.maxPositionPct}%</b> of your portfolio</li>
        <li>Crypto capped at <b>${risk.maxCryptoPct}%</b> of your portfolio</li>
        <li>The order ticket warns you before an order breaks these limits</li>
      </ul>
      ${risk.capped ? '<div class="notice warn">Capped at Balanced because you have no emergency fund yet. Build 3–6 months of savings before taking more risk.</div>' : ''}`;
  }

  function obReady() {
    const ob = runtime.onboarding;
    const risk = E.riskProfile(ob.answers);
    const cashOptions = [1000000, 10000000, 100000000]
      .map((cash) => `<button class="chip ${ob.cash === cash ? 'active' : ''}" data-action="ob-cash" data-cash="${cash}">${E.formatIdr(cash, { compact: true })}</button>`)
      .join('');
    return `
      <h1>You're set</h1>
      <div class="card">${riskSummaryHtml(risk)}</div>
      <div class="card flat" style="margin-top:14px">
        <b>Practice cash</b>
        <p class="small muted">Start with an amount close to what you would really invest. Practice money cannot be withdrawn.</p>
        <div class="row wrap">${cashOptions}</div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-action="ob-back">Back</button>
        <button class="btn primary grow" data-action="ob-finish">Start practising</button>
      </div>`;
  }

  function finishOnboarding() {
    const ob = runtime.onboarding;
    const risk = E.riskProfile(ob.answers);
    state = E.createState({
      startingCashIdr: ob.cash,
      watchlist: defaultWatchlist(ob.markets),
      profile: {
        name: 'Guest',
        markets: E.MARKET_ORDER.filter((id) => ob.markets.indexOf(id) !== -1),
        answers: Object.assign({}, ob.answers),
        risk,
        onboarded: true,
        createdAt: new Date().toISOString(),
      },
    });
    state.learn.streak = E.bumpStreak(state.learn.streak, Date.now());
    save();
    location.hash = '#home';
    render();
    startTimers();
  }

  // ---------------------------------------------------------------- home

  function allocationHtml(value, onHero) {
    const total = value.totalIdr || 1;
    const parts = [['CASH', value.cashIdr]].concat(E.MARKET_ORDER.map((id) => [id, value.byMarket[id]]));
    const bar = parts
      .filter((part) => part[1] > 0)
      .map((part) => `<span style="width:${((part[1] / total) * 100).toFixed(2)}%;background:${MARKET_COLORS[part[0]]}"></span>`)
      .join('');
    const legend = parts
      .filter((part) => part[1] > 0)
      .map((part) => `<span><i style="background:${MARKET_COLORS[part[0]]}"></i>${part[0] === 'CASH' ? 'Cash' : E.MARKETS[part[0]].short} ${((part[1] / total) * 100).toFixed(0)}%</span>`)
      .join('');
    return `<div class="alloc" ${onHero ? '' : 'style="background:var(--surface-2)"'}>${bar}</div><div class="legend">${legend}</div>`;
  }

  function coachSuggestion() {
    const next = E.missions(state).find((mission) => !mission.done);
    const chosen = state.profile.markets;
    const firstWatch = state.watchlist.find((symbol) => INSTRUMENTS[symbol]) || DEFAULT_WATCH[chosen[0]][0];
    if (next) {
      if (next.id === 'first-trade') {
        return { title: next.label, body: `Try a small buy. The ticket shows every fee and the break-even move before you confirm.`, href: `#asset/${firstWatch}`, cta: `Open ${firstWatch}` };
      }
      if (next.id === 'limit') {
        return { title: next.label, body: 'A limit order only fills at your price or better. Useful when a market is closed or moving fast.', href: `#asset/${firstWatch}`, cta: 'Try a limit order' };
      }
      if (next.id === 'markets') {
        const bought = new Set(state.orders.filter((o) => o.status === 'filled' && o.side === 'buy').map((o) => o.market));
        const missing = chosen.find((id) => !bought.has(id));
        return { title: next.label, body: `You have not bought in ${E.MARKETS[missing].name} yet. Each market behaves differently; small practice positions teach a lot.`, href: `#markets/${missing}`, cta: `Open ${E.MARKETS[missing].short}` };
      }
      if (next.id === 'scam-shield') {
        return { title: next.label, body: 'Five minutes on how investasi bodong works, and how to check a licence with OJK.', href: '#lesson/scam-shield', cta: 'Start lesson' };
      }
      if (next.id === 'post') {
        return { title: next.label, body: 'Ask a question in the Lobby. Use $TICKER to link an asset.', href: '#community/lobby', cta: 'Open the Lobby' };
      }
    }
    const lesson = C.lessons.find((item) => !state.learn.completed[item.id]);
    if (lesson) {
      return { title: `Next lesson: ${lesson.title}`, body: `${lesson.minutes} minutes, interactive.`, href: `#lesson/${lesson.id}`, cta: 'Start lesson' };
    }
    return { title: 'All missions and lessons done', body: 'Keep practising, and see how licensed analysts are scored on the Analyst Desk.', href: '#desk', cta: 'Open Analyst Desk' };
  }

  function instrumentRow(symbol, extra) {
    const instrument = INSTRUMENTS[symbol];
    const quote = runtime.prices[symbol];
    const positive = (quote.changePct || 0) >= 0;
    return `<a class="list-item" href="#asset/${encodeURIComponent(symbol)}">
      <span class="sym-badge ${instrument.market}">${esc(badgeText(symbol))}</span>
      <span class="li-main"><span class="li-title">${esc(symbol)}</span><span class="li-sub">${esc(instrument.name)}${extra ? ` · ${extra}` : ''}</span></span>
      ${sparkSvg(quote.spark, positive)}
      <span class="li-right"><span class="num" data-price="${esc(symbol)}">${priceText(symbol)}</span><span class="small">${changeSpan(symbol)}</span></span>
    </a>`;
  }

  function newsItemHtml(item) {
    const market = E.MARKETS[item.market] ? item.market : 'US';
    const tickers = (item.tickers || []).slice(0, 3).map((t) => `$${esc(t)}`).join(' ');
    return `<a class="list-item" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">
      <span class="sym-badge ${market}">${esc(E.MARKETS[market].short.slice(0, 4))}</span>
      <span class="li-main"><span style="font-weight:600">${esc(item.title)}</span><span class="li-sub">${esc(item.source)} · ${esc(timeAgo(item.time))}${tickers ? ` · ${tickers}` : ''}</span></span>
    </a>`;
  }

  function newsFor(filter) {
    return runtime.news.filter((item) => {
      if (filter.symbol) return (item.tickers || []).indexOf(filter.symbol) !== -1;
      return !filter.markets || filter.markets.indexOf(item.market) !== -1;
    });
  }

  function allPosts() {
    return C.posts.concat(state.community.posts).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  function visiblePosts() {
    const rooms = {};
    for (const room of C.rooms) rooms[room.id] = room;
    return allPosts().filter((post) => rooms[post.room] && E.canAccess(planId(), rooms[post.room].tier));
  }

  function viewHome() {
    const value = E.portfolioValue(state, ctx());
    const coach = coachSuggestion();
    const chosen = state.profile.markets;
    const watch = state.watchlist.filter((symbol) => INSTRUMENTS[symbol]);
    const universe = SYMBOLS.filter((symbol) => chosen.indexOf(INSTRUMENTS[symbol].market) !== -1);
    const sorted = universe.slice().sort((a, b) => runtime.prices[b].changePct - runtime.prices[a].changePct);
    const movers = sorted.slice(0, 3).concat(sorted.slice(-3).reverse());
    const news = newsFor({ markets: chosen }).slice(0, 5);
    const posts = visiblePosts().filter((post) => !E.scamCheck(post.text).blocked).slice(0, 3);
    const dayPositive = value.dayChangeIdr >= 0;
    return `
      <div class="card hero">
        <div class="row between"><span class="muted small">Practice portfolio</span><a href="#portfolio" class="small" style="color:#fff">Details →</a></div>
        <div class="big-number num" data-pv="total">${E.formatIdr(value.totalIdr)}</div>
        <div class="small"><span class="${dayPositive ? 'up' : 'down'}" data-pv="day">${E.formatIdr(value.dayChangeIdr, { sign: true })}</span> today · <span data-pv="return">${E.formatPct(value.returnPct)}</span> since you started</div>
        ${allocationHtml(value, true)}
      </div>

      <div class="card" style="margin-top:14px">
        <div class="row between wrap">
          <div class="grow"><span class="badge brand">Next step</span><h3 style="margin-top:8px">${esc(coach.title)}</h3><p class="small muted" style="margin:0">${esc(coach.body)}</p></div>
          <a class="btn primary" href="${coach.href}">${esc(coach.cta)}</a>
        </div>
      </div>

      <div class="section-title"><h2>Watchlist</h2><a href="#markets" class="small">All markets →</a></div>
      <div class="list">${watch.map((symbol) => instrumentRow(symbol, E.MARKETS[INSTRUMENTS[symbol].market].short)).join('') || '<div class="empty">Star assets in Markets to watch them here.</div>'}</div>

      <div class="grid-2">
        <div>
          <div class="section-title"><h2>Movers</h2><span class="small muted">your markets, 24h / today</span></div>
          <div class="list">${movers.map((symbol) => instrumentRow(symbol, E.MARKETS[INSTRUMENTS[symbol].market].short)).join('')}</div>
        </div>
        <div>
          <div class="section-title"><h2>News</h2><span class="small muted">${runtime.newsSource === 'snapshot' ? 'snapshot' : 'latest'}</span></div>
          <div class="list">${news.map(newsItemHtml).join('') || '<div class="empty">No headlines for your markets yet.</div>'}</div>
        </div>
      </div>

      <div class="section-title"><h2>Community</h2><a href="#community" class="small">Open rooms →</a></div>
      <div class="grid-2">
        <div class="list">${posts.map(postHtml).join('')}</div>
        ${deskTeaserHtml()}
      </div>
      ${footnoteHtml()}`;
  }

  function deskTeaserHtml() {
    const cards = Object.values(ANALYSTS).map((analyst) => {
      const card = analystScorecard(analyst.id);
      return `<div class="row between small"><span><b>${esc(analyst.name)}</b> <span class="muted">${esc(analyst.focus.split('·')[0])}</span></span><span class="num">${card.count} ideas · ${card.winRate.toFixed(0)}% wins · avg ${E.formatPct(card.avgReturnPct, 1)}</span></div>`;
    }).join('<hr class="sep">');
    return `<div class="card">
      <div class="row between"><h3 style="margin:0">Analyst Desk</h3><span class="badge info">Licensed only</span></div>
      <p class="small muted">Every idea is scored automatically against the market, losers included. Track records are free; live ideas need Pro.</p>
      ${cards}
      <div style="margin-top:12px"><a class="btn block" href="#desk">See track records</a></div>
    </div>`;
  }

  function footnoteHtml() {
    const stocks = runtime.sources.stocks === 'live' ? `live (${esc(runtime.sources.stocksTime || 'delayed')})` : `snapshot ${esc(SNAP.sources.stocks)}`;
    return `<p class="footnote">Practice money only. Not investment advice. Stocks: ${stocks}. Crypto & gold: ${runtime.sources.crypto === 'live' ? 'CoinGecko live' : 'CoinGecko snapshot'}. USD/IDR ${E.formatIdr(runtime.fxRate)}. ${isSimulated() ? 'Simulated mode is on: prices are random and not real.' : ''}</p>`;
  }

  // ------------------------------------------------------------- markets

  function feeSummary(marketId) {
    const buy = E.feeRate(marketId, 'buy') * 100;
    const sell = E.feeRate(marketId, 'sell') * 100;
    return `Buy ${buy.toFixed(2)}% · sell ${sell.toFixed(2)}% · break-even +${E.breakEvenPct(marketId).toFixed(2)}%`;
  }

  function marketListHtml(marketId) {
    const term = runtime.search.trim().toLowerCase();
    const rows = KNOWN_BY_MARKET[marketId]
      .filter((symbol) => !term || symbol.toLowerCase().indexOf(term) !== -1 || INSTRUMENTS[symbol].name.toLowerCase().indexOf(term) !== -1)
      .map((symbol) => {
        const watched = state.watchlist.indexOf(symbol) !== -1;
        return `<div class="row" style="border-top:1px solid var(--line)">
          <div class="grow">${instrumentRow(symbol, holds(symbol) ? 'you hold this' : '')}</div>
          <button class="btn ghost small" data-action="watch" data-symbol="${esc(symbol)}" aria-label="${watched ? 'Remove from' : 'Add to'} watchlist" title="Watchlist">${watched ? '★' : '☆'}</button>
        </div>`;
      });
    return rows.join('') || '<div class="empty">No matches.</div>';
  }

  function viewMarkets(arg) {
    const marketId = E.MARKETS[arg] ? arg : state.profile.markets[0];
    const market = E.MARKETS[marketId];
    const status = statusFor(marketId);
    const chips = E.MARKET_ORDER.map((id) => {
      const mine = state.profile.markets.indexOf(id) !== -1;
      return `<a class="chip ${id === marketId ? 'active' : ''}" href="#markets/${id}">${marketLabel(id)}${mine ? '' : ' ·'}</a>`;
    }).join('');
    const unitLine = {
      US: 'Fractional shares from $1. Paid in rupiah at the live USD/IDR rate plus a conversion spread.',
      IDX: 'Lots of 100 shares. Limit prices must follow IDX price steps.',
      CRYPTO: 'Fractional coins from Rp10,000. Trades 24/7. Very volatile.',
      GOLD: 'By the gram from Rp10,000. A ~2% round-trip spread makes it a long-term holding.',
    }[marketId];
    return `
      <div class="chips">${chips}</div>
      <div class="card" style="margin-top:12px">
        <div class="row between wrap">
          <h1 class="mlabel" style="margin:0">${marketIcon(marketId)}${esc(market.name)}</h1>
          <span class="badge ${status.open ? 'up' : 'warn'}">${esc(status.label)}${status.localTime ? ` · ${esc(status.localTime)} ${esc(status.zone)}` : ''}</span>
        </div>
        <p class="small muted" style="margin-top:6px">${esc(unitLine)}</p>
        <div class="small"><b>Fees:</b> ${feeSummary(marketId)}</div>
        <div class="tiny muted">${esc(E.FEES[marketId].source)}</div>
      </div>
      <div style="margin:12px 0"><input type="search" placeholder="Search ${esc(market.name)}" value="${esc(runtime.search)}" data-input="search" data-market="${marketId}" aria-label="Search"></div>
      <div class="list" id="market-list">${marketListHtml(marketId)}</div>
      ${footnoteHtml()}`;
  }

  // --------------------------------------------------------------- asset

  function ideasFor(symbol) {
    return IDEAS.filter((idea) => idea.symbol === symbol);
  }

  function scoreFor(idea) {
    const quote = runtime.prices[idea.symbol];
    return E.scoreIdea(idea, quote ? quote.price : 0, Date.now(), benchPrice(idea.benchmark));
  }

  function analystScorecard(analystId) {
    return E.scorecard(IDEAS.filter((idea) => idea.analyst === analystId).map(scoreFor));
  }

  function viewAsset(symbol) {
    const instrument = INSTRUMENTS[symbol];
    if (!instrument) {
      return `<div class="empty">Unknown asset. <a href="#markets">Back to markets</a></div>`;
    }
    const marketId = instrument.market;
    const market = E.MARKETS[marketId];
    const quote = runtime.prices[symbol];
    const status = statusFor(marketId);
    const range = runtime.chartRange[symbol] || '1M';
    const ranges = instrument.twin ? ['1D', '1W', '1M', '1Y', '5Y'] : ['1D', '1W', '1M', '1Y'];
    const key = `${symbol}|${range}`;
    const value = E.portfolioValue(state, ctx());
    const position = value.positions.find((item) => item.symbol === symbol);
    const watched = state.watchlist.indexOf(symbol) !== -1;
    const posts = visiblePosts().filter((post) => E.cashtags(post.text, SYMBOLS).indexOf(symbol) !== -1).slice(0, 4);
    const news = newsFor({ symbol }).slice(0, 4);
    const ideas = ideasFor(symbol);
    const unit = {
      US: `Fractional from $1 · ${usdToIdrText(symbol)} per share at ${E.formatIdr(runtime.fxRate)}/USD`,
      IDX: `1 lot = 100 shares = ${E.formatIdr(quote.price * 100)} · price step Rp${E.idxTick(quote.price)}`,
      CRYPTO: 'Fractional · minimum order Rp10.000 · trades 24/7',
      GOLD: 'Per gram · minimum order Rp10.000 · reference price from tokenised gold (XAUT)',
    }[marketId];
    const stat = (label, text) => `<div class="kpi"><div class="label">${label}</div><div class="value small">${text}</div></div>`;
    const range52 = quote.low52 && quote.high52 ? `${E.formatPrice(marketId, quote.low52)} – ${E.formatPrice(marketId, quote.high52)}` : '—';
    const rangeDay = quote.dayLow && quote.dayHigh ? `${E.formatPrice(marketId, quote.dayLow)} – ${E.formatPrice(marketId, quote.dayHigh)}` : '—';
    return `
      <div class="row between"><a href="#markets/${marketId}" class="small">← ${esc(market.name)}</a>
        <button class="btn small" data-action="watch" data-symbol="${esc(symbol)}">${watched ? '★ Watching' : '☆ Watch'}</button></div>
      <div class="row" style="margin-top:10px">
        <span class="sym-badge ${marketId}">${esc(badgeText(symbol))}</span>
        <div class="grow"><h1 style="margin:0">${esc(symbol)}</h1><div class="small muted">${esc(instrument.name)} · ${esc(instrument.exchange)}</div></div>
      </div>
      <div class="row wrap" style="margin-top:10px;align-items:baseline">
        <span class="big-number num" data-price="${esc(symbol)}">${priceText(symbol)}</span>
        ${changeSpan(symbol, 'num')}
        ${marketId === 'US' ? `<span class="small muted" data-idr="${esc(symbol)}">${usdToIdrText(symbol)}</span>` : ''}
      </div>
      <div class="small muted">${esc(quote.source)}${quote.time ? ` · ${esc(fmtDateTime(quote.time))}` : ''} · <span class="${status.open ? 'up' : ''}">${esc(status.label)}</span></div>

      <div class="card" style="margin-top:12px">
        <div class="segmented" role="tablist">${ranges.map((item) => `<button class="${item === range ? 'active' : ''}" data-action="chart-range" data-symbol="${esc(symbol)}" data-range="${item}">${item}</button>`).join('')}</div>
        <div id="chart-holder" data-key="${esc(key)}" style="margin-top:8px">${chartHtml(key, chartPointsFor(symbol, range), marketId)}</div>
      </div>

      <div class="row" style="margin-top:12px">
        <button class="btn buy grow" data-action="open-ticket" data-symbol="${esc(symbol)}" data-side="buy">Buy</button>
        <button class="btn sell grow" data-action="open-ticket" data-symbol="${esc(symbol)}" data-side="sell" ${position ? '' : 'disabled'}>Sell</button>
      </div>
      <p class="tiny muted" style="margin-top:6px">${esc(unit)}</p>

      ${position ? `<div class="card" style="margin-top:12px">
        <h3>Your position</h3>
        <div class="kpis">
          ${stat('Holding', esc(E.formatQty(marketId, position.qty, symbol)))}
          ${stat('Average price', esc(E.formatPrice(marketId, position.avgPriceLocal)))}
          ${stat('Value', `<span data-posval="${esc(symbol)}">${E.formatIdr(position.valueIdr)}</span>`)}
          ${stat('Profit / loss', `<span class="${position.pnlIdr >= 0 ? 'up' : 'down'}">${E.formatIdr(position.pnlIdr, { sign: true })} (${E.formatPct(position.pnlPct)})</span>`)}
        </div>
        <p class="tiny muted" style="margin-top:8px">P/L includes the fees you paid to buy; selling costs another ${(E.feeRate(marketId, 'sell') * 100).toFixed(2)}%.</p>
      </div>` : ''}

      <div class="section-title"><h2>Key facts</h2></div>
      <div class="kpis">
        ${stat('Day range', rangeDay)}
        ${stat('52-week range', range52)}
        ${stat('Fees', feeSummary(marketId))}
        ${stat('Volume', quote.volume ? Number(quote.volume).toLocaleString('en-US') : '—')}
      </div>

      <div class="section-title"><h2>Analyst ideas</h2><a class="small" href="#desk">Analyst Desk →</a></div>
      ${ideas.length ? `<div class="stack">${ideas.map((idea) => ideaHtml(idea)).join('')}</div>` : '<div class="card flat empty">No licensed analyst has published on this asset yet.</div>'}

      <div class="grid-2">
        <div>
          <div class="section-title"><h2>Talk about $${esc(symbol)}</h2><a class="small" href="#community/${roomForMarket(marketId)}">Room →</a></div>
          <div class="list">${posts.map(postHtml).join('') || '<div class="empty">No posts mention this asset yet.</div>'}</div>
        </div>
        <div>
          <div class="section-title"><h2>News</h2></div>
          <div class="list">${news.map(newsItemHtml).join('') || '<div class="empty">No recent headlines tagged with this asset.</div>'}</div>
        </div>
      </div>
      ${footnoteHtml()}`;
  }

  function roomForMarket(marketId) {
    return { US: 'us', IDX: 'idx', CRYPTO: 'crypto', GOLD: 'gold' }[marketId] || 'lobby';
  }

  // -------------------------------------------------------------- ticket

  function openTicket(symbol, side, source) {
    const instrument = INSTRUMENTS[symbol];
    const marketId = instrument.market;
    const quote = runtime.prices[symbol];
    const sell = side === 'sell';
    const held = E.availableQty(state, symbol);
    runtime.ticket = {
      symbol,
      side: sell ? 'sell' : 'buy',
      type: 'market',
      mode: marketId === 'IDX' ? 'lots' : sell ? 'qty' : 'amount',
      amount: marketId === 'US' ? '200000' : '100000',
      qty: sell && held ? String(held) : '',
      lots: sell && held ? String(Math.floor(held / 100)) : '1',
      limit: String(E.tidyPrice(marketId, quote.price)),
      source: source || null,
    };
    renderTicket();
  }

  // Deep link: ?ticket=BBCA (optionally &side=sell) opens the practice order
  // ticket, so news items, ideas and docs can link straight to a trade.
  function openLinkedTicket(search) {
    const linkParams = new URLSearchParams(search);
    const symbol = (linkParams.get('ticket') || '').toUpperCase();
    if (!symbol || !INSTRUMENTS[symbol] || !state || !state.profile || !state.profile.onboarded) {
      return false;
    }
    openTicket(symbol, linkParams.get('side') === 'sell' ? 'sell' : 'buy', null);
    return true;
  }

  function ticketOrder() {
    const ticket = runtime.ticket;
    const marketId = INSTRUMENTS[ticket.symbol].market;
    const current = runtime.prices[ticket.symbol].price;
    const limit = parseDecimal(ticket.limit);
    const price = ticket.type === 'limit' ? limit : current;
    let qty = 0;
    if (ticket.mode === 'lots') {
      qty = Math.max(0, Math.floor(parseDecimal(ticket.lots))) * 100;
    } else if (ticket.mode === 'amount') {
      const amount = parseAmount(ticket.amount);
      if (ticket.side === 'buy') {
        qty = E.qtyForAmount({ market: marketId, amountIdr: amount, price, fxRate: runtime.fxRate });
      } else if (price > 0) {
        const fx = marketId === 'US' ? runtime.fxRate : 1;
        qty = floorDecimals(amount / (price * fx), E.MARKETS[marketId].qtyDecimals);
      }
    } else {
      qty = floorDecimals(parseDecimal(ticket.qty), E.MARKETS[marketId].qtyDecimals);
    }
    return {
      symbol: ticket.symbol,
      side: ticket.side,
      type: ticket.type,
      qty,
      limitPrice: ticket.type === 'limit' ? limit : null,
      source: ticket.source,
    };
  }

  function renderTicket() {
    const ticket = runtime.ticket;
    const instrument = INSTRUMENTS[ticket.symbol];
    const marketId = instrument.market;
    const status = statusFor(marketId);
    const segmented = (action, current, options) =>
      `<div class="segmented">${options.map(([value, label, cls]) => `<button class="${value === current ? `active ${cls || ''}` : ''}" data-action="${action}" data-value="${value}">${label}</button>`).join('')}</div>`;
    const currency = marketId === 'US' ? 'USD' : 'Rp';
    let inputs = '';
    if (marketId === 'IDX') {
      inputs = `<label class="field"><span>Lots (1 lot = 100 shares)</span>
        <div class="row"><button class="btn" data-action="ticket-step" data-delta="-1" aria-label="One lot less">−</button>
        <input type="text" inputmode="numeric" value="${esc(ticket.lots)}" data-input="ticket-lots" aria-label="Lots">
        <button class="btn" data-action="ticket-step" data-delta="1" aria-label="One lot more">+</button></div></label>`;
    } else {
      const unitName = E.MARKETS[marketId].unitPlural;
      inputs = `<div class="row between" style="margin-bottom:8px">${segmented('ticket-mode', ticket.mode, [['amount', 'Amount (Rp)'], ['qty', `Quantity (${unitName})`]])}
        ${ticket.side === 'sell' ? '<button class="btn small" data-action="ticket-max">Max</button>' : ''}</div>
        ${ticket.mode === 'amount'
          ? `<label class="field"><span>${ticket.side === 'buy' ? 'Amount to spend, incl. fees' : 'Amount to sell (before fees)'}</span><input type="text" inputmode="numeric" value="${esc(ticket.amount)}" data-input="ticket-amount" aria-label="Amount in rupiah"></label>`
          : `<label class="field"><span>Quantity</span><input type="text" inputmode="decimal" value="${esc(ticket.qty)}" data-input="ticket-qty" aria-label="Quantity"></label>`}`;
    }
    if (ticket.side === 'sell' && marketId === 'IDX') {
      inputs += '<div style="margin:-4px 0 10px"><button class="btn small" data-action="ticket-max">Sell all</button></div>';
    }
    const limitInput = ticket.type === 'limit'
      ? `<label class="field"><span>Limit price (${currency})${marketId === 'IDX' ? ` · step Rp${E.idxTick(parseDecimal(ticket.limit) || runtime.prices[ticket.symbol].price)}` : ''}</span>
          <div class="row"><input type="text" inputmode="decimal" value="${esc(ticket.limit)}" data-input="ticket-limit" aria-label="Limit price">
          ${marketId === 'IDX' ? '<button class="btn small" data-action="ticket-round">Snap to step</button>' : ''}</div></label>`
      : '';
    openModal(`
      <div class="modal-head"><h2 style="margin:0">${ticket.side === 'buy' ? 'Buy' : 'Sell'} ${esc(ticket.symbol)} <span class="badge">practice</span></h2>
        <button class="close-x" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="row wrap" style="margin-bottom:10px">
        ${segmented('ticket-side', ticket.side, [['buy', 'Buy', 'buy'], ['sell', 'Sell', 'sell']])}
        ${segmented('ticket-type', ticket.type, [['market', 'Market'], ['limit', 'Limit']])}
      </div>
      <div class="small muted" style="margin-bottom:10px">Now <b class="num" data-price="${esc(ticket.symbol)}">${priceText(ticket.symbol)}</b> · ${esc(status.label)}</div>
      ${inputs}
      ${limitInput}
      <div id="ticket-preview"></div>
      <button class="btn primary block" id="ticket-confirm" data-action="ticket-confirm" style="margin-top:12px">Confirm</button>
      <p class="tiny muted" style="margin-top:8px">Practice money only. Delayed prices. You place every order yourself; Twin never trades for you.</p>`);
    renderTicketPreview();
  }

  function renderTicketPreview() {
    const holder = document.getElementById('ticket-preview');
    if (!holder || !runtime.ticket) return;
    const ticket = runtime.ticket;
    const marketId = INSTRUMENTS[ticket.symbol].market;
    const order = ticketOrder();
    const check = E.validateOrder(state, order, ctx());
    const quote = check.quote;
    let table = '';
    if (quote) {
      const rows = [];
      rows.push(['Quantity', esc(E.formatQty(marketId, order.qty, ticket.symbol))]);
      rows.push([ticket.type === 'limit' ? 'Limit price' : 'Price (est.)', esc(E.formatPrice(marketId, quote.price))]);
      if (marketId === 'US') {
        rows.push(['Value', `${E.formatUsd(quote.grossLocal)} ≈ ${E.formatIdr(quote.grossIdr)}`]);
        rows.push(['USD/IDR', E.formatIdr(runtime.fxRate)]);
      } else {
        rows.push(['Value', E.formatIdr(quote.grossIdr)]);
      }
      for (const line of quote.lines) {
        rows.push([`${esc(line.label)} (${(line.rate * 100).toFixed(2)}%)`, `${ticket.side === 'buy' ? '+' : '−'}${E.formatIdr(line.idr)}`]);
      }
      table = `<table class="preview-table">${rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`).join('')}
        <tr class="total"><td>${ticket.side === 'buy' ? 'You pay' : 'You receive'}</td><td>${E.formatIdr(quote.totalIdr)}</td></tr></table>`;
      if (ticket.side === 'buy') {
        table += `<p class="small muted" style="margin-top:8px">Break-even: the price must rise <b>${E.formatPct(quote.breakEvenPct)}</b> before selling covers both fees.</p>`;
      } else {
        const position = state.positions[ticket.symbol];
        if (position && order.qty > 0) {
          const costPart = position.costIdr * Math.min(1, order.qty / position.qty);
          const pnl = quote.totalIdr - costPart;
          table += `<p class="small" style="margin-top:8px">Profit/loss on this sale after all fees: <b class="${pnl >= 0 ? 'up' : 'down'}">${E.formatIdr(pnl, { sign: true })}</b></p>`;
        }
      }
    }
    const notes = [];
    if (check.ok && check.willQueue) {
      notes.push(`<div class="notice info">The market is closed (${esc(check.status.label)}). This market order will queue and fill at the first price after the open. ${ticket.side === 'buy' ? 'We hold 5% extra cash until then in case the price moves.' : ''}</div>`);
    }
    if (check.ok && order.type === 'limit') {
      notes.push(`<div class="notice info">Fills only when the price reaches ${esc(E.formatPrice(marketId, order.limitPrice))} or better${isSimulated() ? '' : ' during trading hours'}.</div>`);
    }
    if (check.warnings && check.warnings.length) {
      notes.push(`<div class="notice warn"><b>Guard-rail check</b><ul>${check.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
    }
    if (check.errors && check.errors.length) {
      notes.push(`<div class="notice error"><ul>${check.errors.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
    }
    holder.innerHTML = `${table}<div class="stack" style="margin-top:10px">${notes.join('')}</div>`;
    const confirm = document.getElementById('ticket-confirm');
    if (confirm) {
      confirm.disabled = !check.ok;
      let label = ticket.side === 'buy' ? 'Confirm practice buy' : 'Confirm practice sell';
      if (order.type === 'limit') label = 'Place limit order';
      else if (check.willQueue) label = 'Queue for the open';
      if (check.warnings && check.warnings.length && check.ok) label += ' anyway';
      confirm.textContent = label;
    }
  }

  function confirmTicket() {
    const order = ticketOrder();
    const outcome = E.placeOrder(state, order, ctx());
    if (!outcome.result.ok) {
      toast(outcome.result.errors[0], 'error');
      return;
    }
    state = outcome.state;
    state.learn.streak = E.bumpStreak(state.learn.streak, Date.now());
    save();
    closeModal();
    const placed = outcome.result.order;
    const what = `${placed.side === 'buy' ? 'Bought' : 'Sold'} ${E.formatQty(placed.market, placed.qty, placed.symbol)} ${placed.symbol}`;
    if (placed.status === 'filled') {
      toast(`${what} at ${E.formatPrice(placed.market, placed.fillPrice)}`, 'ok');
    } else if (placed.status === 'queued') {
      toast('Order queued until the market opens.', 'ok');
    } else {
      toast('Limit order placed.', 'ok');
    }
    render();
  }

  // ----------------------------------------------------------- portfolio

  function orderRow(order, cancellable) {
    const marketId = order.market;
    const statusClass = { filled: 'up', open: 'info', queued: 'info', cancelled: '', rejected: 'down' }[order.status] || '';
    const price = order.fillPrice || order.limitPrice;
    return `<div class="list-item" style="cursor:default">
      <span class="sym-badge ${marketId}">${esc(badgeText(order.symbol))}</span>
      <span class="li-main"><span class="li-title">${order.side === 'buy' ? 'Buy' : 'Sell'} ${esc(order.symbol)} <span class="badge ${statusClass}">${esc(order.status)}</span></span>
        <span class="li-sub">${esc(E.formatQty(marketId, order.qty, order.symbol))} · ${order.type}${price ? ` @ ${esc(E.formatPrice(marketId, price))}` : ''} · ${esc(fmtDateTime(Date.parse(order.filledAt || order.createdAt)))}${order.note ? ` · ${esc(order.note)}` : ''}</span></span>
      <span class="li-right">${order.totalIdr ? `<span class="num">${E.formatIdr(order.totalIdr)}</span>` : ''}${order.realizedIdr != null ? `<span class="small ${order.realizedIdr >= 0 ? 'up' : 'down'}">${E.formatIdr(order.realizedIdr, { sign: true })}</span>` : ''}
        ${cancellable ? `<button class="btn small" data-action="cancel-order" data-id="${esc(order.id)}">Cancel</button>` : ''}</span>
    </div>`;
  }

  function xrayHtml(value) {
    if (!E.canAccess(planId(), 'plus')) {
      return `<div class="card flat"><div class="row between"><b>Portfolio X-ray</b><span class="badge">Plus</span></div><p class="small muted">See currency exposure and how close you are to your guard-rails. Included with Plus.</p><a class="btn small" href="#plans">See plans</a></div>`;
    }
    const total = value.totalIdr || 1;
    const usdPct = (value.byMarket.US / total) * 100;
    const cryptoPct = (value.byMarket.CRYPTO / total) * 100;
    const biggest = value.positions[0];
    const biggestPct = biggest ? (biggest.valueIdr / total) * 100 : 0;
    const risk = state.profile.risk;
    const bar = (pct, limit) => `<div class="progress" title="${pct.toFixed(1)}%"><span style="width:${clamp((pct / Math.max(limit, 1)) * 100, 0, 100)}%;${pct > limit ? 'background:var(--down)' : ''}"></span></div>`;
    return `<div class="card"><div class="row between"><b>Portfolio X-ray</b><span class="badge brand">Plus</span></div>
      <div class="stack small" style="margin-top:10px">
        <div><div class="row between"><span>US dollar exposure</span><span class="num">${usdPct.toFixed(1)}% of portfolio</span></div><div class="tiny muted">A 10% move in USD/IDR changes your total by about ${(usdPct / 10).toFixed(1)}%.</div></div>
        <div><div class="row between"><span>Largest position${biggest ? ` (${esc(biggest.symbol)})` : ''}</span><span class="num">${biggestPct.toFixed(1)}% / limit ${risk.maxPositionPct}%</span></div>${bar(biggestPct, risk.maxPositionPct)}</div>
        <div><div class="row between"><span>Crypto</span><span class="num">${cryptoPct.toFixed(1)}% / limit ${risk.maxCryptoPct}%</span></div>${bar(cryptoPct, risk.maxCryptoPct)}</div>
      </div></div>`;
  }

  function viewPortfolio() {
    const value = E.portfolioValue(state, ctx());
    const open = state.orders.filter((order) => order.status === 'open' || order.status === 'queued');
    const history = state.orders.filter((order) => order.status !== 'open' && order.status !== 'queued').slice(0, 30);
    const kpi = (label, html) => `<div class="kpi"><div class="label">${label}</div><div class="value">${html}</div></div>`;
    const positions = value.positions.map((position) => {
      const marketId = position.market;
      return `<a class="list-item" href="#asset/${encodeURIComponent(position.symbol)}">
        <span class="sym-badge ${marketId}">${esc(badgeText(position.symbol))}</span>
        <span class="li-main"><span class="li-title">${esc(position.symbol)}</span><span class="li-sub">${esc(E.formatQty(marketId, position.qty, position.symbol))} · avg ${esc(E.formatPrice(marketId, position.avgPriceLocal))}</span></span>
        <span class="li-right"><span class="num" data-posval="${esc(position.symbol)}">${E.formatIdr(position.valueIdr)}</span><span class="small ${position.pnlIdr >= 0 ? 'up' : 'down'}">${E.formatIdr(position.pnlIdr, { sign: true })} (${E.formatPct(position.pnlPct)})</span></span>
      </a>`;
    }).join('');
    const byMarket = E.MARKET_ORDER.map((id) => {
      const pct = (value.byMarket[id] / (value.totalIdr || 1)) * 100;
      return `<div><div class="row between small"><span>${marketLabel(id)}</span><span class="num">${E.formatIdr(value.byMarket[id])} · ${pct.toFixed(1)}%</span></div><div class="progress"><span style="width:${pct.toFixed(2)}%;background:${MARKET_COLORS[id]}"></span></div></div>`;
    }).join('');
    return `
      <h1>Portfolio <span class="badge">practice</span></h1>
      <div class="card">
        <div class="muted small">Total value</div>
        <div class="big-number num" data-pv="total">${E.formatIdr(value.totalIdr)}</div>
        <div class="small"><span data-pv="return">${E.formatPct(value.returnPct)}</span> ${basisText(value)}</div>
        ${allocationHtml(value, false)}
      </div>
      ${walletsCardHtml(value)}
      <div class="kpis" style="margin-top:12px">
        ${kpi('Cash available', E.formatIdr(value.availableIdr))}
        ${kpi('Held for orders', E.formatIdr(value.reservedIdr))}
        ${kpi('Unrealised P/L', `<span class="${value.unrealizedIdr >= 0 ? 'up' : 'down'}">${E.formatIdr(value.unrealizedIdr, { sign: true })}</span>`)}
        ${kpi('Realised P/L', `<span class="${value.realizedIdr >= 0 ? 'up' : 'down'}">${E.formatIdr(value.realizedIdr, { sign: true })}</span>`)}
      </div>
      <div class="grid-2" style="margin-top:14px">
        <div class="card"><h3>By market</h3><div class="stack">${byMarket}</div></div>
        ${xrayHtml(value)}
      </div>
      <div class="section-title"><h2>Positions</h2><span class="small muted">${value.positions.length}</span></div>
      <div class="list">${positions || '<div class="empty">No positions yet. <a href="#markets">Find something to practise with →</a></div>'}</div>
      <div class="section-title"><h2>Open orders</h2><span class="small muted">${open.length}</span></div>
      <div class="list">${open.map((order) => orderRow(order, true)).join('') || '<div class="empty">No open orders.</div>'}</div>
      <div class="section-title"><h2>History</h2></div>
      <div class="list">${history.map((order) => orderRow(order, false)).join('') || '<div class="empty">Your filled and cancelled orders appear here.</div>'}</div>
      ${footnoteHtml()}`;
  }

  // ------------------------------------------------------ two wallets (1.13)
  // Twin keeps practice money in two wallets: US dollars (Twin's portfolio) and rupiah
  // (this module). Money moves between them at the USD/IDR mid rate minus a practice
  // spread (E.quoteTransfer). On Twin's server one request updates both ledgers; in the
  // browser version Twin's demo engine (../demo.js) updates both copies in this browser.
  // The demo account and the self-test never move money.

  function basisText(value) {
    const start = E.formatIdr(state.wallet.startingCashIdr || 0);
    const moved = value.contributionsIdr || 0;
    if (!moved) return `since you started with ${start}`;
    return `on ${E.formatIdr(value.basisIdr)} put in (${start} to start, ${moved > 0 ? '+' : '−'}${E.formatIdr(Math.abs(moved))} moved between wallets)`;
  }

  function guestSessionActive() {
    try {
      return sessionStorage.getItem('tt-guest-active') === '1';
    } catch (error) {
      return false;
    }
  }

  function twinPrefersServer() {
    try {
      return localStorage.getItem('tt-runtime-mode') === 'server';
    } catch (error) {
      return false;
    }
  }

  /** Is Twin's own server behind this page? Asked once per page view. */
  function serverDetected() {
    if (!runtime.serverProbe) runtime.serverProbe = OFFLINE ? Promise.resolve(false) : F.detectServer();
    return runtime.serverProbe;
  }

  /**
   * Which US dollar wallet Twin uses here, decided the way Twin decides: 'server' (the
   * signed-in account on Twin's server), 'guest' (this tab's guest session), 'browser'
   * (a profile saved in this browser), or null when there is none to link.
   */
  async function usdWalletKind() {
    if (!SYNCS) return null;
    if (await serverDetected()) return 'server';
    if (!window.TwinDemo || !/^https?:$/.test(location.protocol)) return null;
    // Twin ran on its server here before: while it is down, don't link a different (browser) account.
    if (!/\.github\.io$/.test(location.hostname) && twinPrefersServer()) return null;
    return guestSessionActive() && window.TwinDemo.hasGuest() ? 'guest' : 'browser';
  }

  function twinDemoCall(kind, path, body) {
    return window.TwinDemo[kind === 'guest' ? 'guest' : 'api'](path, body || {});
  }

  /** Load Twin's US dollar portfolio (cash and value) for the wallets card and transfers. */
  async function linkUsdWallet(force) {
    const usd = runtime.usd;
    if (!SYNCS || usd.checking) return;
    if (!force && usd.checkedAt && Date.now() - usd.checkedAt < 30000) return;
    usd.checking = true;
    let kind = null;
    let paper = null;
    let reason = '';
    let error = '';
    try {
      kind = await usdWalletKind();
      if (kind === 'server') {
        const result = await F.loadPaper();
        if (!result) {
          reason = 'offline';
        } else if (result.status === 401) {
          reason = 'signed-out';
        } else if (result.data && result.data.ok) {
          paper = result.data.paper;
        } else {
          reason = 'error';
          error = (result.data && result.data.error) || '';
        }
      } else if (kind) {
        const result = await twinDemoCall(kind, 'api/paper');
        if (result && result.ok) {
          paper = result.paper;
        } else if (result && result.auth === false) {
          reason = 'signed-out';
        } else {
          reason = 'error';
          error = (result && result.error) || '';
        }
      } else {
        reason = window.TwinDemo && /^https?:$/.test(location.protocol) ? 'offline' : 'unavailable';
      }
    } catch (failure) {
      reason = 'error';
      error = String((failure && failure.message) || failure || '');
    } finally {
      Object.assign(usd, { kind, paper, reason, error, checking: false, checkedAt: Date.now() });
    }
    refreshWalletsCard();
    if (runtime.transfer && modalOpen()) renderTransferPreview();
  }

  /** Why the US dollar wallet isn't linked (plain text), or '' when it is. */
  function usdLinkMessage() {
    const usd = runtime.usd;
    if (usd.paper) return '';
    if (usd.checking || !usd.checkedAt) return 'Linking your US dollar wallet…';
    if (usd.reason === 'signed-out') {
      return usd.kind === 'server'
        ? 'Log in to Twin on this server to link your US dollar wallet.'
        : 'Log in to Twin in this browser (or start a guest session) to link your US dollar wallet.';
    }
    if (usd.reason === 'offline') return "Can't reach your Twin server right now, so your US dollar wallet isn't linked.";
    if (usd.reason === 'error') return `Couldn't load your US dollar wallet${usd.error ? `: ${usd.error}` : ''}.`;
    return 'Open Twin Indonesia from Twin (not as a file) to link your US dollar wallet.';
  }

  function transferRowHtml(record) {
    const toIdr = record.direction === 'usd_to_idr';
    const when = Date.parse(record.at);
    const fee = record.feeCurrency === 'USD' ? E.formatUsd(record.fee) : E.formatIdr(record.fee);
    const amounts = toIdr
      ? `${E.formatUsd(record.usd)} → ${E.formatIdr(record.idr)}`
      : `${E.formatIdr(record.idr)} → ${E.formatUsd(record.usd)}`;
    return `<div class="list-item" style="cursor:default">
      <span class="li-main"><span class="li-title">${toIdr ? 'To rupiah' : 'To US dollars'}</span>
        <span class="li-sub">${when ? esc(fmtDateTime(when)) : ''} · ${esc(E.formatIdr(record.mid))}/USD</span></span>
      <span class="li-right"><span class="num">${esc(amounts)}</span><span class="tiny muted">spread ${esc(fee)}</span></span>
    </div>`;
  }

  function walletsCardHtml(value) {
    const head = '<div class="row between"><b>Your two wallets</b><span class="badge">practice</span></div>';
    if (!SYNCS) {
      return `<div class="card" id="wallets-card" style="margin-top:12px">${head}
        <p class="small muted" style="margin:8px 0 0">Twin keeps practice money in US dollars and in rupiah. Moving money between them is off in the demo account and the self-test.</p></div>`;
    }
    const usd = runtime.usd;
    const rate = runtime.fxRate;
    const paper = usd.paper;
    const tile = (label, big, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value">${big}</div><div class="tiny muted">${sub}</div></div>`;
    const rupiahTile = tile('Rupiah wallet (here)', `<span data-pv="total">${E.formatIdr(value.totalIdr)}</span>`,
      `Free cash <span data-pv="free">${E.formatIdr(value.availableIdr)}</span>`);
    let usdTile = '';
    let combinedLine = '';
    if (paper) {
      const usdValue = Number(paper.value) || 0;
      const usdCash = Number(paper.cash) || 0;
      usdTile = tile('US dollar wallet (Twin)', E.formatUsd(usdValue), `Cash ${E.formatUsd(usdCash)} ≈ ${E.formatIdr(usdCash * rate)}`);
      const combined = E.combinedWallets(value.totalIdr, usdValue, rate);
      if (combined) {
        combinedLine = `<div class="row between small" style="margin-top:10px"><span>All practice money</span>
          <span class="num"><b data-pv="combined">≈ ${E.formatIdr(combined.idr)}</b> · <span data-pv="combined-usd">${E.formatUsd(combined.usd)}</span></span></div>`;
      }
    } else {
      usdTile = tile('US dollar wallet (Twin)', '—', esc(usdLinkMessage()));
    }
    let extra = '';
    if (!paper && usd.checkedAt && !usd.checking) {
      extra = usd.reason === 'signed-out'
        ? '<a class="btn small ghost" href="../">Open Twin</a>'
        : '<button class="btn small ghost" data-action="wallets-retry">Try again</button>';
    }
    const disabled = paper ? '' : 'disabled';
    const recent = (state.transfers || []).slice(0, 3);
    return `<div class="card" id="wallets-card" style="margin-top:12px">${head}
      <div class="kpis" style="grid-template-columns:1fr 1fr;margin-top:10px">${rupiahTile}${usdTile}</div>
      ${combinedLine}
      <div class="tiny muted" style="margin-top:4px">1 USD = <span data-pv="fx">${E.formatIdr(rate)}</span> (mid rate, delayed)</div>
      <div class="row wrap" style="margin-top:10px">
        <button class="btn small" data-action="transfer-open" data-direction="usd_to_idr" ${disabled}>US dollars → rupiah</button>
        <button class="btn small" data-action="transfer-open" data-direction="idr_to_usd" ${disabled}>Rupiah → US dollars</button>
        ${extra}
      </div>
      ${recent.length ? `<div class="list" style="margin-top:10px">${recent.map(transferRowHtml).join('')}</div>` : ''}
      <p class="tiny muted" style="margin:8px 0 0">Moves convert at the mid rate minus a ${(E.FX_SPREAD * 100).toFixed(1)}% practice spread. Money you move counts as money put in, so returns show only investment gains and the spread shows as a small cost.</p>
    </div>`;
  }

  function refreshWalletsCard() {
    const card = document.getElementById('wallets-card');
    if (!card || !state || !state.profile || !state.profile.onboarded) return;
    card.outerHTML = walletsCardHtml(E.portfolioValue(state, ctx()));
  }

  /** US dollar amounts: "100", "1,000", "12,5", "1.234,56" and "$1,234.56" all work. */
  function parseUsd(value) {
    let text = String(value == null ? '' : value).replace(/[\s$]/g, '');
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > lastDot) {
      // A comma is the decimal mark ("12,5", "1.234,56") unless it groups thousands ("1,000").
      text = lastDot === -1 && /,\d{3}$/.test(text) ? text.replace(/,/g, '') : text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
    const number = parseFloat(text);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function openTransfer(direction) {
    if (DEMO) {
      toast('Moving money between wallets is off in the demo account.', 'error');
      return;
    }
    if (!state || !state.profile || !state.profile.onboarded) return;
    runtime.transfer = { direction: direction === 'idr_to_usd' ? 'idr_to_usd' : 'usd_to_idr', amount: '', busy: false };
    renderTransfer();
    linkUsdWallet(false);
  }

  /** What can be moved: US dollar cash in Twin, or rupiah cash not held for open orders. */
  function transferAvailable(direction) {
    if (direction === 'idr_to_usd') return Math.max(0, E.availableCash(state));
    const paper = runtime.usd.paper;
    return paper ? Math.max(0, Number(paper.cash) || 0) : 0;
  }

  function transferQuote() {
    const draft = runtime.transfer;
    const amount = draft.direction === 'usd_to_idr' ? parseUsd(draft.amount) : parseAmount(draft.amount);
    return E.quoteTransfer(draft.direction, amount, runtime.fxRate);
  }

  function transferCheck() {
    const draft = runtime.transfer;
    const quote = transferQuote();
    const errors = [];
    if (!runtime.usd.paper) {
      errors.push(usdLinkMessage());
    } else if (!quote.ok) {
      if (String(draft.amount).trim()) errors.push(quote.error);
    } else if (draft.direction === 'usd_to_idr' && quote.usd > transferAvailable('usd_to_idr') + 0.005) {
      errors.push(`Not enough US dollar cash: ${E.formatUsd(transferAvailable('usd_to_idr'))} available.`);
    } else if (draft.direction === 'idr_to_usd' && quote.idr > transferAvailable('idr_to_usd') + 0.5) {
      errors.push(`Only ${E.formatIdr(transferAvailable('idr_to_usd'))} of rupiah cash is free (the rest is held for open orders).`);
    }
    return { quote, errors, ok: quote.ok && !errors.length };
  }

  function renderTransfer() {
    const draft = runtime.transfer;
    if (!draft) return;
    const toIdr = draft.direction === 'usd_to_idr';
    const available = transferAvailable(draft.direction);
    const availableText = toIdr ? (runtime.usd.paper ? E.formatUsd(available) : '—') : E.formatIdr(available);
    openModal(`
      <div class="modal-head"><h2 style="margin:0">Move money <span class="badge">practice</span></h2>
        <button class="close-x" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="segmented" style="margin-bottom:12px">
        <button class="${toIdr ? 'active' : ''}" data-action="transfer-direction" data-value="usd_to_idr">US dollars → rupiah</button>
        <button class="${toIdr ? '' : 'active'}" data-action="transfer-direction" data-value="idr_to_usd">Rupiah → US dollars</button>
      </div>
      <label class="field"><span>${toIdr ? 'US dollars to move from Twin' : 'Rupiah to move to Twin'} · available <b id="transfer-available">${esc(availableText)}</b></span>
        <input type="text" id="transfer-amount" inputmode="${toIdr ? 'decimal' : 'numeric'}" value="${esc(draft.amount)}" data-input="transfer-amount" placeholder="${toIdr ? 'e.g. 100' : 'e.g. 1.000.000'}" aria-label="${toIdr ? 'Amount in US dollars' : 'Amount in rupiah'}"></label>
      <div class="row wrap" style="margin:-4px 0 10px">
        <button class="btn small" data-action="transfer-fill" data-pct="25">25%</button>
        <button class="btn small" data-action="transfer-fill" data-pct="50">50%</button>
        <button class="btn small" data-action="transfer-fill" data-pct="100">Max</button>
      </div>
      <div id="transfer-preview"></div>
      <button class="btn primary block" id="transfer-confirm" data-action="transfer-confirm" style="margin-top:12px">Move money</button>
      <p class="tiny muted" style="margin-top:8px">Practice money only: nothing real is converted. Rates are delayed, and the ${(E.FX_SPREAD * 100).toFixed(1)}% spread is a practice assumption; real banks and apps charge different spreads and fees.</p>`);
    renderTransferPreview();
  }

  function renderTransferPreview() {
    const holder = document.getElementById('transfer-preview');
    const draft = runtime.transfer;
    if (!holder || !draft) return;
    const check = transferCheck();
    const quote = check.quote;
    const toIdr = draft.direction === 'usd_to_idr';
    const available = document.getElementById('transfer-available');
    if (available) {
      const amount = transferAvailable(draft.direction);
      available.textContent = toIdr ? (runtime.usd.paper ? E.formatUsd(amount) : '—') : E.formatIdr(amount);
    }
    let table = '';
    if (quote.ok) {
      const fee = quote.feeCurrency === 'USD' ? E.formatUsd(quote.fee) : E.formatIdr(quote.fee);
      const rows = [
        ['You send', toIdr ? E.formatUsd(quote.usd) : E.formatIdr(quote.idr)],
        ['Mid rate', `1 USD = ${E.formatIdr(quote.mid)}`],
        [`Practice spread (${(quote.spread * 100).toFixed(1)}%)`, `−${fee}`],
      ];
      table = `<table class="preview-table">${rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td></tr>`).join('')}
        <tr class="total"><td>You get (est.)</td><td>${toIdr ? E.formatIdr(quote.idr) : E.formatUsd(quote.usd)}</td></tr></table>`;
      if (check.ok) {
        const usdCash = Number(runtime.usd.paper.cash) || 0;
        const idrFree = E.availableCash(state);
        const usdAfter = toIdr ? usdCash - quote.usd : usdCash + quote.usd;
        const idrAfter = toIdr ? idrFree + quote.idr : idrFree - quote.idr;
        table += `<p class="small muted" style="margin-top:8px">Afterwards: US dollar cash ${E.formatUsd(usdAfter)} · free rupiah cash ${E.formatIdr(idrAfter)}</p>`;
      }
    }
    const notes = [];
    if (check.errors.length) {
      notes.push(`<div class="notice error"><ul>${check.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul></div>`);
    }
    if (check.ok) {
      notes.push(`<div class="notice info">This counts as money moved ${toIdr ? 'into your rupiah wallet' : 'back to Twin'}, not as a profit or loss. The final amount uses the rate when you confirm.</div>`);
    }
    holder.innerHTML = `${table}<div class="stack" style="margin-top:10px">${notes.join('')}</div>`;
    const confirm = document.getElementById('transfer-confirm');
    if (confirm) {
      confirm.disabled = !check.ok || draft.busy;
      if (draft.busy) {
        confirm.textContent = 'Moving…';
      } else if (quote.ok) {
        confirm.textContent = `Move ${toIdr ? E.formatUsd(quote.usd) : E.formatIdr(quote.idr)} to ${toIdr ? 'rupiah' : 'US dollars'}`;
      } else {
        confirm.textContent = 'Move money';
      }
    }
  }

  async function confirmTransfer() {
    const draft = runtime.transfer;
    if (!draft || draft.busy) return;
    const check = transferCheck();
    if (!check.ok) {
      renderTransferPreview();
      return;
    }
    if (!SYNCS) {
      toast('Moving money is off in the demo account and the self-test.', 'error');
      return;
    }
    draft.busy = true;
    renderTransferPreview();
    const amount = draft.direction === 'usd_to_idr' ? check.quote.usd : check.quote.idr;
    let outcome = null;
    try {
      outcome = await executeTransfer(draft, amount);
    } catch (error) {
      outcome = { ok: false, error: 'Something went wrong, so nothing was moved.' };
    }
    draft.busy = false;
    if (outcome.ok) {
      const record = outcome.transfer;
      if (runtime.transfer === draft) closeModal();
      toast(record.direction === 'usd_to_idr'
        ? `Moved ${E.formatUsd(record.usd)} → ${E.formatIdr(record.idr)} into your rupiah wallet.`
        : `Moved ${E.formatIdr(record.idr)} → ${E.formatUsd(record.usd)} back to Twin.`, 'ok');
      render();
      return;
    }
    if (outcome.error) toast(outcome.error, 'error');
    if (runtime.transfer === draft && modalOpen()) renderTransferPreview();
  }

  /** Wait for any upload in flight, then pull: adopts a newer account copy or uploads ours. */
  async function settleWalletSync() {
    clearTimeout(runtime.saveTimer);
    for (let waited = 0; runtime.sync.pushing && waited < 15000; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await pullWallet();
  }

  async function executeTransfer(draft, amount) {
    const direction = draft.direction;
    const kind = runtime.usd.kind;
    if (kind === 'server') {
      if (!runtime.server) runtime.server = await serverDetected();
      // Bring this browser's rupiah wallet in line with the account first, so the move
      // builds on the latest copy and the revision check passes.
      await settleWalletSync();
      if (runtime.transfer !== draft) {
        return { ok: false, error: 'Your rupiah wallet was just updated from your Twin account. Check the amounts and try again.' };
      }
      if (!runtime.sync.enabled) {
        return {
          ok: false,
          error: runtime.sync.status === 'offline'
            ? "Can't reach Twin's server, so nothing was moved."
            : 'Log in to Twin on this server to move money between your wallets.',
        };
      }
      let result = await F.transferWallets(direction, amount, runtime.sync.rev);
      if (result && result.data && result.data.code === 'no_wallet') {
        await pushWallet();
        result = await F.transferWallets(direction, amount, runtime.sync.rev);
      }
      if (!result) return { ok: false, error: "Can't reach Twin's server, so nothing was moved." };
      if (result.status === 401) {
        runtime.sync.enabled = false;
        runtime.sync.status = 'signed-out';
        Object.assign(runtime.usd, { paper: null, reason: 'signed-out' });
        return { ok: false, error: 'Your Twin session has ended, so nothing was moved. Log in to Twin again.' };
      }
      const data = result.data || {};
      if (data.conflict) {
        await pullWallet();
        return { ok: false, error: 'Your rupiah wallet changed on another device, so nothing was moved. It is up to date here now; try again.' };
      }
      if (!data.ok) return { ok: false, error: data.error || 'The move failed, so nothing was moved.' };
      runtime.sync.rev = data.rev;
      writeSyncMeta();
      adoptTransferResult(data.wallet, data.paper);
      markSynced();
      refreshSyncNote();
      return { ok: true, transfer: data.transfer };
    }
    if (kind === 'guest' || kind === 'browser') {
      // Twin's demo engine reads the rupiah wallet from this browser's storage.
      persistLocal();
      const result = await twinDemoCall(kind, 'api/wallet/transfer', { direction, amount });
      if (!result || !result.ok) {
        if (result && result.auth === false) Object.assign(runtime.usd, { paper: null, reason: 'signed-out' });
        return { ok: false, error: (result && result.error) || 'The move failed, so nothing was moved.' };
      }
      adoptTransferResult(result.wallet, result.paper);
      if (!result.paper) linkUsdWallet(true);
      return { ok: true, transfer: result.transfer };
    }
    return { ok: false, error: usdLinkMessage() || "Your US dollar wallet isn't linked." };
  }

  /** Both ledgers come back from the move: keep the rupiah wallet and Twin's cash in step. */
  function adoptTransferResult(wallet, paper) {
    const next = wallet ? E.migrateState(wallet) : null;
    if (next && next.profile) {
      state = next;
      persistLocal();
    }
    if (paper) {
      Object.assign(runtime.usd, { paper, reason: '', error: '', checkedAt: Date.now() });
    }
  }

  /** #transfer (from Twin's Me screen) opens the transfer sheet over Portfolio. */
  function maybeOpenTransferFromHash() {
    const route = parseHash();
    if (route.name !== 'transfer' || !state || !state.profile || !state.profile.onboarded) return false;
    try {
      history.replaceState(null, '', '#portfolio');
    } catch (error) {
      // the address bar keeps #transfer; nothing else depends on it
    }
    runtime.lastRouteKey = 'portfolio/';
    openTransfer(route.arg === 'idr_to_usd' ? 'idr_to_usd' : 'usd_to_idr');
    return true;
  }

  // ----------------------------------------------------------- community

  function postHtml(post) {
    const shield = E.scamCheck(post.text);
    const hidden = shield.blocked && !state.community.revealed[post.id];
    const liked = !!state.community.likes[post.id];
    const reported = !!state.community.reports[post.id];
    const tickers = E.cashtags(post.text, SYMBOLS);
    const holder = post.mine ? tickers.some(holds) : !!post.holder;
    const room = C.rooms.find((item) => item.id === post.room);
    const sentiment = post.sentiment ? `<span class="badge ${post.sentiment === 'bullish' ? 'up' : post.sentiment === 'bearish' ? 'down' : ''}">${esc(post.sentiment)}</span>` : '';
    const initials = (post.name || post.handle || '?').slice(0, 2).toUpperCase();
    const body = hidden
      ? `<div class="shielded">🛡️ <b>Hidden by Scam Shield</b><ul style="margin:6px 0 6px 18px;padding:0">${shield.flags.filter((f) => f.severity === 'block').map((f) => `<li>${esc(f.label)}</li>`).join('')}</ul>
          <button class="btn small" data-action="reveal" data-id="${esc(post.id)}">Show anyway</button> <a class="small" href="#lesson/scam-shield">Why?</a></div>`
      : `<div class="post-text">${linkify(post.text)}</div>${shield.flags.length ? `<div style="margin-top:6px">${shield.flags.map((f) => `<span class="badge warn">⚠ ${esc(f.label)}</span>`).join(' ')}</div>` : ''}`;
    return `<div class="post">
      <div class="post-head">
        <span class="post-avatar">${esc(initials)}</span>
        <b>${esc(post.name)}</b><span class="small muted">@${esc(post.handle)} · ${esc(timeAgo(post.createdAt))}${room ? ` · ${esc(room.name)}` : ''}</span>
        ${post.mine ? '<span class="badge brand">you</span>' : ''}
        ${holder ? '<span class="badge up" title="Holds a mentioned asset in their portfolio">✓ holder</span>' : ''}
        ${sentiment}
      </div>
      ${body}
      <div class="post-actions">
        <button class="btn small ghost" data-action="like" data-id="${esc(post.id)}" aria-pressed="${liked}">${liked ? '♥' : '♡'} ${(post.likes || 0) + (liked ? 1 : 0)}</button>
        ${post.mine ? '' : `<button class="btn small ghost" data-action="report" data-id="${esc(post.id)}" ${reported ? 'disabled' : ''}>${reported ? 'Reported' : '⚑ Report'}</button>`}
      </div>
    </div>`;
  }

  function viewCommunity(arg) {
    const room = C.rooms.find((item) => item.id === arg) || C.rooms[0];
    const unlocked = E.canAccess(planId(), room.tier);
    const chips = C.rooms.map((item) => {
      const locked = !E.canAccess(planId(), item.tier);
      return `<a class="chip ${item.id === room.id ? 'active' : ''}" href="#community/${item.id}">${locked ? '🔒 ' : ''}${esc(item.name)}</a>`;
    }).join('') + '<a class="chip" href="#desk">🧾 Analyst Desk</a>';
    const posts = allPosts().filter((post) => post.room === room.id);
    const composer = `<div class="card flat">
      <textarea data-input="composer" maxlength="600" placeholder="Ask a question or share what you learned. Use $TICKER to link an asset." aria-label="Write a post">${esc(runtime.draft)}</textarea>
      <div id="composer-check" class="small" style="margin:6px 0">${composerCheckHtml(runtime.draft)}</div>
      <div class="row between">
        <select data-input="composer-sentiment" style="max-width:180px" aria-label="Sentiment">
          ${[['', 'No sentiment'], ['bullish', 'Bullish'], ['bearish', 'Bearish'], ['neutral', 'Neutral']].map(([v, l]) => `<option value="${v}" ${runtime.draftSentiment === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn primary" data-action="post-submit">Post</button>
      </div>
    </div>`;
    const plan = C.plans.find((item) => item.id === room.tier);
    return `
      <h1>Community</h1>
      <div class="chips">${chips}</div>
      <div class="card" style="margin-top:12px">
        <div class="row between"><h2 style="margin:0">${esc(room.name)}</h2>${room.tier === 'free' ? '<span class="badge">open to all</span>' : '<span class="badge brand">members</span>'}</div>
        <p class="small muted" style="margin:6px 0 0">${esc(room.about)} Scam Shield checks every post. Discussion only: specific paid recommendations come from licensed analysts on the Analyst Desk.</p>
      </div>
      ${unlocked ? `<div style="margin-top:12px">${composer}</div>
        <div class="list" style="margin-top:12px">${posts.map(postHtml).join('') || '<div class="empty">No posts yet. Start the conversation.</div>'}</div>`
        : `<div class="card paywall" style="margin-top:12px"><div style="font-size:2rem">🔒</div><h2>Members' room</h2><p class="muted">Join ${esc(plan.name)} (${E.formatIdr(plan.priceIdr)}/month) to read and post here. ${posts.length} posts waiting.</p><a class="btn primary" href="#plans">See plans</a>
          <div class="lock" style="margin-top:16px;text-align:left">${posts.slice(0, 2).map(postHtml).join('')}</div></div>`}`;
  }

  function composerCheckHtml(text) {
    if (!text || text.trim().length < 3) return '<span class="muted">Scam Shield checks your post as you type.</span>';
    const shield = E.scamCheck(text);
    const tags = E.cashtags(text, SYMBOLS);
    const parts = [];
    if (shield.blocked) {
      parts.push(`<span class="down">🛡️ This can't be posted: ${shield.flags.filter((f) => f.severity === 'block').map((f) => esc(f.label.toLowerCase())).join('; ')}.</span>`);
    } else if (shield.flags.length) {
      parts.push(`<span style="color:var(--warn)">⚠ ${esc(shield.flags[0].label)}. It will be labelled.</span>`);
    } else {
      parts.push('<span class="up">🛡️ Looks fine.</span>');
    }
    if (tags.length) parts.push(`<span class="muted">Links: ${tags.map((t) => `$${esc(t)}`).join(' ')}</span>`);
    return parts.join(' ');
  }

  function submitPost() {
    const route = parseHash();
    const room = C.rooms.find((item) => item.id === route.arg) || C.rooms[0];
    const text = runtime.draft.trim();
    if (text.length < 3) {
      toast('Write a little more first.', 'error');
      return;
    }
    if (!E.canAccess(planId(), room.tier)) {
      toast('This room is for members.', 'error');
      return;
    }
    const shield = E.scamCheck(text);
    if (shield.blocked) {
      toast('Scam Shield blocked this post. See the reason under the text box.', 'error');
      return;
    }
    state.community.posts.unshift({
      id: `u-${Date.now().toString(36)}`,
      room: room.id,
      handle: (state.profile.name || 'guest').toLowerCase().replace(/[^a-z0-9_.]/g, '') || 'guest',
      name: state.profile.name || 'Guest',
      createdAt: new Date().toISOString(),
      text,
      sentiment: runtime.draftSentiment || null,
      likes: 0,
      mine: true,
    });
    runtime.draft = '';
    runtime.draftSentiment = '';
    state.learn.streak = E.bumpStreak(state.learn.streak, Date.now());
    save();
    toast('Posted.', 'ok');
    render();
  }

  // ------------------------------------------------------- analyst desk

  function ideaHtml(idea) {
    const analyst = ANALYSTS[idea.analyst];
    const score = scoreFor(idea);
    const pro = E.canAccess(planId(), 'pro');
    const isOpen = score.status === 'Open';
    const locked = isOpen && !pro;
    const marketId = idea.market;
    const statusClass = { 'Target hit': 'up', 'Stopped out': 'down', Expired: 'warn', Open: 'info' }[score.status];
    const kpi = (label, text) => `<div class="kpi"><div class="label">${label}</div><div class="value small">${text}</div></div>`;
    const resultText = `<span class="${score.returnPct >= 0 ? 'up' : 'down'}">${E.formatPct(score.returnPct)}</span>${score.benchPct != null ? ` <span class="muted">vs ${E.formatPct(score.benchPct, 1)} ${esc(idea.benchmark === '^JKSE' ? 'IHSG' : idea.benchmark === '^GSPC' ? 'S&P 500' : idea.benchmark)}</span>` : ''}`;
    const details = `<div class="kpis" style="margin-top:10px">
        ${kpi('Entry', esc(E.formatPrice(marketId, idea.entry)))}
        ${kpi('Target', esc(E.formatPrice(marketId, idea.target)))}
        ${kpi('Stop', esc(E.formatPrice(marketId, idea.stop)))}
        ${kpi(isOpen ? 'Return so far' : 'Result', resultText)}
      </div>
      <p class="small" style="margin:10px 0 0">${esc(idea.rationale)}</p>`;
    return `<div class="card flat">
      <div class="row between wrap">
        <div class="row"><span class="sym-badge ${marketId}">${esc(badgeText(idea.symbol))}</span>
          <div><b>${idea.direction === 'BUY' ? 'Buy' : 'Sell / avoid'} <a href="#asset/${esc(idea.symbol)}">${esc(idea.symbol)}</a></b>
          <div class="small muted">${esc(analyst.name)} · ${esc(fmtDate(Date.parse(idea.createdAt)))} · ${idea.horizonDays}-day horizon</div></div></div>
        <span class="badge ${statusClass}">${esc(score.status)}${idea.closed ? ` · ${esc(fmtDate(Date.parse(idea.closed.at)))}` : ''}</span>
      </div>
      ${locked ? `<div style="position:relative"><div class="lock">${details}</div><div class="row" style="position:absolute;inset:0;justify-content:center"><a class="btn primary small" href="#plans">Unlock live ideas with Pro</a></div></div>` : details}
      ${pro && isOpen ? `<div style="margin-top:10px"><button class="btn small" data-action="idea-ticket" data-id="${esc(idea.id)}">Send to practice ticket</button> <span class="tiny muted">You still review and confirm.</span></div>` : ''}
    </div>`;
  }

  function viewDesk() {
    const filter = runtime.deskAnalyst;
    const analystCards = Object.values(ANALYSTS).map((analyst) => {
      const card = analystScorecard(analyst.id);
      const openCount = IDEAS.filter((idea) => idea.analyst === analyst.id && scoreFor(idea).status === 'Open').length;
      return `<button class="card pick ${filter === analyst.id ? 'selected' : ''}" style="display:block" data-action="desk-filter" data-analyst="${analyst.id}">
        <div class="row"><span class="post-avatar" style="background:${analyst.color};color:#fff;border:0">${esc(analyst.initials)}</span>
          <div class="grow"><b>${esc(analyst.name)}</b><div class="tiny muted">${esc(analyst.focus)}</div></div></div>
        <div class="tiny" style="margin:6px 0"><span class="badge info">✓ ${esc(analyst.licence)}</span></div>
        <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
          <div class="kpi"><div class="label">Ideas (open)</div><div class="value">${card.count} (${openCount})</div></div>
          <div class="kpi"><div class="label">Win rate</div><div class="value">${card.winRate.toFixed(0)}%</div></div>
          <div class="kpi"><div class="label">Avg result</div><div class="value ${card.avgReturnPct >= 0 ? 'up' : 'down'}">${E.formatPct(card.avgReturnPct, 1)}</div></div>
          <div class="kpi"><div class="label">Avg vs benchmark</div><div class="value">${card.avgExcessPct == null ? '—' : E.formatPct(card.avgExcessPct, 1)}</div></div>
        </div>
      </button>`;
    }).join('');
    const ideas = IDEAS.filter((idea) => filter === 'all' || idea.analyst === filter)
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return `
      <div class="row between wrap"><h1 style="margin:0">Analyst Desk</h1><a class="small" href="#community">← Community</a></div>
      <div class="notice info" style="margin-top:10px">Only licensed investment advisers can publish here. Every idea is timestamped, scored automatically against a benchmark, and can never be edited or deleted. <b>Demo:</b> these analysts are fictional, and their ideas were picked with hindsight from real price history to show how scoring works. This is not a real track record and not advice.</div>
      ${E.canAccess(planId(), 'pro') ? '' : '<div class="notice" style="margin-top:10px">Track records and closed ideas are free for everyone. Live (open) ideas need <a href="#plans">Pro</a>.</div>'}
      <div class="grid-3" style="margin-top:14px">${analystCards}</div>
      <div class="row between" style="margin-top:14px"><h2 style="margin:0">${filter === 'all' ? 'All ideas' : `Ideas by ${esc(ANALYSTS[filter].name)}`}</h2>
        ${filter === 'all' ? '' : '<button class="btn small" data-action="desk-filter" data-analyst="all">Show all</button>'}</div>
      <div class="stack" style="margin-top:10px">${ideas.map(ideaHtml).join('')}</div>
      <p class="footnote">Scoring: return from entry to target or stop (when hit) or to the latest price. Benchmarks: IHSG for IDX, S&P 500 for US, Bitcoin for other crypto. Daily data means hit dates are approximate.</p>`;
  }

  // --------------------------------------------------------------- learn

  function badges() {
    return C.levels.filter((level) => {
      const lessons = C.lessons.filter((lesson) => lesson.level === level.id);
      return lessons.every((lesson) => state.learn.completed[lesson.id]);
    });
  }

  function viewLearn() {
    const xp = E.totalXp(state);
    const done = C.lessons.filter((lesson) => state.learn.completed[lesson.id]).length;
    const missions = E.missions(state);
    const earned = badges();
    const levels = C.levels.map((level) => {
      const lessons = C.lessons.filter((lesson) => lesson.level === level.id);
      const items = lessons.map((lesson) => {
        const index = C.lessons.indexOf(lesson) + 1;
        const complete = state.learn.completed[lesson.id];
        return `<a class="list-item lesson-card" href="#lesson/${lesson.id}">
          <span class="lesson-num ${complete ? 'done' : ''}">${complete ? '✓' : index}</span>
          <span class="li-main"><span class="li-title">${esc(lesson.title)}</span><span class="li-sub">${lesson.minutes} min · interactive${complete ? ` · scored ${complete.score}/${complete.total}` : ''}</span></span>
          <span class="small muted">→</span></a>`;
      }).join('');
      return `<div class="section-title"><h2>Level ${level.id} · ${esc(level.name)}</h2></div><div class="list">${items}</div>`;
    }).join('');
    return `
      <h1>Twin Academy · Indonesia</h1>
      <div class="kpis">
        <div class="kpi"><div class="label">XP</div><div class="value">${xp}</div></div>
        <div class="kpi"><div class="label">Streak</div><div class="value">${state.learn.streak.count} day${state.learn.streak.count === 1 ? '' : 's'}</div></div>
        <div class="kpi"><div class="label">Lessons</div><div class="value">${done}/${C.lessons.length}</div></div>
        <div class="kpi"><div class="label">Badges</div><div class="value small">${earned.map((level) => `🏅 ${esc(level.name)}`).join('<br>') || '—'}</div></div>
      </div>
      <div class="section-title"><h2>Missions</h2><span class="small muted">practice tasks, checked automatically</span></div>
      <div class="list">${missions.map((mission) => `<div class="list-item" style="cursor:default"><span class="lesson-num ${mission.done ? 'done' : ''}">${mission.done ? '✓' : '•'}</span><span class="li-main"><span class="li-title">${esc(mission.label)}</span></span><span class="badge ${mission.done ? 'up' : ''}">+${mission.xp} XP</span></div>`).join('')}</div>
      ${levels}
      <p class="footnote">Lessons are free for everyone. XP: 50 per lesson plus 10 per correct quiz answer, plus mission XP. Progress is a learning record, not a certificate.</p>`;
  }

  function lessonState(id) {
    if (!runtime.lessonState[id]) {
      runtime.lessonState[id] = { answers: {}, widget: {} };
    }
    return runtime.lessonState[id];
  }

  function viewLesson(id) {
    const lesson = C.lessons.find((item) => item.id === id);
    if (!lesson) return '<div class="empty">Lesson not found. <a href="#learn">Back to Academy</a></div>';
    const ls = lessonState(id);
    const index = C.lessons.indexOf(lesson);
    const next = C.lessons[index + 1];
    const complete = state.learn.completed[id];
    const cards = lesson.cards.map((card, i) => `<div class="row" style="align-items:flex-start"><span class="lesson-num">${i + 1}</span><p class="grow" style="margin:6px 0 0">${esc(card)}</p></div>`).join('');
    const quiz = lesson.quiz.map((question, qIndex) => {
      const chosen = ls.answers[qIndex];
      const options = question.options.map((option, oIndex) => {
        let cls = '';
        if (chosen !== undefined) {
          if (oIndex === question.answer) cls = 'correct';
          else if (oIndex === chosen) cls = 'wrong';
        }
        return `<button class="quiz-option ${cls}" data-action="quiz-answer" data-lesson="${id}" data-q="${qIndex}" data-option="${oIndex}" ${chosen !== undefined ? 'disabled' : ''}>${esc(option)}</button>`;
      }).join('');
      const why = chosen !== undefined ? `<div class="notice ${chosen === question.answer ? 'ok' : 'warn'}">${chosen === question.answer ? 'Correct. ' : 'Not quite. '}${esc(question.why)}</div>` : '';
      return `<div class="card flat"><b>${qIndex + 1}. ${esc(question.q)}</b>${options}${why}</div>`;
    }).join('');
    const answered = Object.keys(ls.answers).length === lesson.quiz.length;
    const correct = lesson.quiz.filter((question, qIndex) => ls.answers[qIndex] === question.answer).length;
    return `
      <a href="#learn" class="small">← Academy</a>
      <div class="row between wrap" style="margin-top:8px"><h1 style="margin:0">${esc(lesson.title)}</h1><span class="badge">Level ${lesson.level} · ${lesson.minutes} min</span></div>
      ${complete ? `<div class="notice ok" style="margin-top:10px">Completed ${esc(fmtDate(Date.parse(complete.at)))} · ${complete.score}/${complete.total} correct · +${complete.xp} XP</div>` : ''}
      <div class="card stack" style="margin-top:12px">${cards}</div>
      <div class="section-title"><h2>Try it</h2></div>
      <div class="widget">${widgetHtml(lesson.widget, ls.widget)}<div id="widget-result" style="margin-top:10px"></div></div>
      <div class="section-title"><h2>Quick check</h2></div>
      <div class="stack">${quiz}</div>
      <div class="row" style="margin-top:14px">
        ${complete ? '' : `<button class="btn primary grow" data-action="lesson-complete" data-lesson="${id}" ${answered ? '' : 'disabled'}>${answered ? `Complete lesson (+${50 + correct * 10} XP)` : 'Answer every question to finish'}</button>`}
        ${next ? `<a class="btn ${complete ? 'primary grow' : ''}" href="#lesson/${next.id}">Next: ${esc(next.title)} →</a>` : '<a class="btn" href="#learn">Back to Academy</a>'}
      </div>`;
  }

  const MATCH_ITEMS = [
    { text: 'Bought in lots of 100 shares', answer: 'IDX' },
    { text: 'Trades 24/7 and can move 10% in a day', answer: 'CRYPTO' },
    { text: 'Priced in US dollars, fractional from $1', answer: 'US' },
    { text: 'Bought by the gram with a ~2% round-trip spread', answer: 'GOLD' },
  ];

  function numberField(field, label, value, attrs) {
    return `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" data-input="widget" data-field="${field}" value="${esc(value)}" ${attrs || ''}></label>`;
  }

  function rangeField(field, label, value, min, max, step) {
    return `<label class="field"><span>${label}: <b data-echo="${field}">${esc(value)}</b></span><input type="range" min="${min}" max="${max}" step="${step}" data-input="widget" data-field="${field}" value="${esc(value)}"></label>`;
  }

  function widgetDefaults(type) {
    return {
      'fee-calculator': { market: 'IDX', amount: '1000000' },
      'lot-calculator': { budget: '1000000', price: '4500' },
      'compound-slider': { initial: '1000000', monthly: '200000', rate: '6', years: '10' },
      allocation: { US: '30', IDX: '30', CRYPTO: '10', GOLD: '30' },
      'sizing-calculator': { capital: '10000000', risk: '1', entry: '1000', stop: '900', market: 'IDX' },
      'fx-calculator': { stock: '10', fx: '-5' },
    }[type] || {};
  }

  function widgetHtml(type, data) {
    const defaults = widgetDefaults(type);
    for (const key of Object.keys(defaults)) {
      if (data[key] === undefined) data[key] = defaults[key];
    }
    if (type === 'market-match') {
      return `<b>Match each statement to its market</b>${MATCH_ITEMS.map((item, index) => {
        const chosen = data[`m${index}`];
        const buttons = E.MARKET_ORDER.map((id) => {
          let cls = '';
          if (chosen === id) cls = id === item.answer ? 'active' : 'wrong';
          return `<button class="chip ${cls}" data-action="match" data-index="${index}" data-market="${id}">${marketLabel(id)}</button>`;
        }).join('');
        return `<div style="margin-top:10px"><div class="small">${esc(item.text)}</div><div class="row wrap" style="margin-top:4px">${buttons}</div></div>`;
      }).join('')}`;
    }
    if (type === 'fee-calculator') {
      return `<b>What does a round trip cost?</b>
        <label class="field" style="margin-top:8px"><span>Market</span><select data-input="widget" data-field="market">${E.MARKET_ORDER.map((id) => `<option value="${id}" ${data.market === id ? 'selected' : ''}>${esc(E.MARKETS[id].name)}</option>`).join('')}</select></label>
        ${numberField('amount', 'Amount traded (Rp)', data.amount)}`;
    }
    if (type === 'lot-calculator') {
      return `<b>How many IDX lots fit your budget?</b>
        <div class="grid-2" style="margin-top:8px">${numberField('budget', 'Budget (Rp)', data.budget)}${numberField('price', 'Share price (Rp)', data.price)}</div>`;
    }
    if (type === 'scam-sorter') {
      return `<b>Scam or OK? Label each message.</b>${C.scamExamples.map((example, index) => {
        const label = data[`s${index}`];
        const buttons = [['scam', '🚩 Scam'], ['ok', '👍 Looks OK']].map(([value, text]) => `<button class="chip ${label === value ? 'active' : ''}" data-action="scam-label" data-index="${index}" data-label="${value}">${text}</button>`).join('');
        return `<div class="card flat" style="margin-top:8px"><div class="small">“${esc(example.text)}”</div><div class="row wrap" style="margin-top:6px">${buttons}</div><div class="tiny" data-scam-feedback="${index}"></div></div>`;
      }).join('')}`;
    }
    if (type === 'compound-slider') {
      return `<b>Watch compounding work</b>
        <div class="grid-2" style="margin-top:8px">${numberField('initial', 'Starting amount (Rp)', data.initial)}${numberField('monthly', 'Added every month (Rp)', data.monthly)}</div>
        ${rangeField('rate', 'Return per year (%)', data.rate, 0, 15, 0.5)}
        ${rangeField('years', 'Years', data.years, 1, 30, 1)}`;
    }
    if (type === 'allocation') {
      return `<b>Mix the four markets</b><p class="tiny muted">Weights are normalised to 100%. Volatility uses teaching assumptions: US 18%, IDX 20%, crypto 65%, gold 15% a year.</p>
        ${E.MARKET_ORDER.map((id) => rangeField(id, `${E.MARKETS[id].name} weight`, data[id], 0, 100, 5)).join('')}`;
    }
    if (type === 'sizing-calculator') {
      return `<b>Size a position from your stop</b>
        <div class="grid-2" style="margin-top:8px">${numberField('capital', 'Portfolio (Rp)', data.capital)}${numberField('risk', 'Risk per idea (%)', data.risk)}${numberField('entry', 'Entry price', data.entry)}${numberField('stop', 'Stop price', data.stop)}</div>
        <label class="field"><span>Market</span><select data-input="widget" data-field="market"><option value="IDX" ${data.market === 'IDX' ? 'selected' : ''}>IDX (lots of 100)</option><option value="OTHER" ${data.market === 'OTHER' ? 'selected' : ''}>Other (any quantity)</option></select></label>`;
    }
    if (type === 'fx-calculator') {
      return `<b>Your rupiah result on a US stock</b>
        ${rangeField('stock', 'Stock return in USD (%)', data.stock, -30, 30, 1)}
        ${rangeField('fx', 'USD/IDR change (%)', data.fx, -15, 15, 1)}`;
    }
    if (type === 'scorecard-reader') {
      const rows = Object.values(ANALYSTS).map((analyst) => {
        const card = analystScorecard(analyst.id);
        const chosen = data.pick === analyst.id;
        return `<tr><td><button class="chip ${chosen ? 'active' : ''}" data-action="score-pick" data-analyst="${analyst.id}">${esc(analyst.name)}</button></td><td>${card.count}</td><td>${card.winRate.toFixed(0)}%</td><td>${E.formatPct(card.avgReturnPct, 1)}</td><td>${card.avgExcessPct == null ? '—' : E.formatPct(card.avgExcessPct, 1)}</td></tr>`;
      }).join('');
      return `<b>Who beat their benchmark by the most, on average?</b><p class="tiny muted">Live scorecards from the demo Analyst Desk (scored against current prices).</p>
        <div style="overflow-x:auto"><table class="preview-table"><tr class="muted"><td>Analyst</td><td>Ideas</td><td>Wins</td><td>Avg</td><td>Avg vs bench</td></tr>${rows}</table></div>`;
    }
    return '';
  }

  function updateWidgetResult(id) {
    const lesson = C.lessons.find((item) => item.id === id);
    const holder = document.getElementById('widget-result');
    if (!lesson || !holder) return;
    const data = lessonState(id).widget;
    holder.innerHTML = widgetResultHtml(lesson.widget, data);
    document.querySelectorAll('[data-echo]').forEach((el) => {
      el.textContent = data[el.dataset.echo];
    });
    if (lesson.widget === 'scam-sorter') {
      C.scamExamples.forEach((example, index) => {
        const el = document.querySelector(`[data-scam-feedback="${index}"]`);
        const label = data[`s${index}`];
        if (!el || !label) return;
        const right = (label === 'scam') === example.scam;
        const flags = E.scamCheck(example.text).flags.map((flag) => flag.label);
        el.innerHTML = `<span class="${right ? 'up' : 'down'}">${right ? 'Right.' : 'Look again.'}</span> ${flags.length ? `Scam Shield: ${esc(flags.join('; '))}.` : 'Scam Shield finds no red flags.'}`;
      });
    }
  }

  function widgetResultHtml(type, data) {
    if (type === 'market-match') {
      const right = MATCH_ITEMS.filter((item, index) => data[`m${index}`] === item.answer).length;
      const tried = MATCH_ITEMS.filter((item, index) => data[`m${index}`]).length;
      return tried ? `<div class="notice ${right === MATCH_ITEMS.length ? 'ok' : 'info'}">${right}/${MATCH_ITEMS.length} correct${right === MATCH_ITEMS.length ? '. Nicely done.' : '.'}</div>` : '';
    }
    if (type === 'fee-calculator') {
      const amount = parseAmount(data.amount);
      const buy = amount * E.feeRate(data.market, 'buy');
      const sell = amount * E.feeRate(data.market, 'sell');
      const roundTrip = buy + sell;
      return `<table class="preview-table"><tr><td>Fees to buy</td><td>${E.formatIdr(buy)}</td></tr><tr><td>Fees to sell (same price)</td><td>${E.formatIdr(sell)}</td></tr>
        <tr class="total"><td>Round trip</td><td>${E.formatIdr(roundTrip)}</td></tr></table>
        <p class="small" style="margin-top:8px">Break-even move: <b>+${E.breakEvenPct(data.market).toFixed(2)}%</b>. Ten round trips with this amount cost about <b>${E.formatIdr(roundTrip * 10)}</b>.</p>`;
    }
    if (type === 'lot-calculator') {
      const budget = parseAmount(data.budget);
      const price = parseAmount(data.price);
      if (!(price > 0)) return '<div class="notice warn">Enter a share price.</div>';
      const tick = E.idxTick(price);
      const onTick = E.isOnTick(price);
      const lots = Math.floor(budget / (price * 100 * (1 + E.feeRate('IDX', 'buy'))));
      const cost = E.quoteOrder({ market: 'IDX', side: 'buy', qty: lots * 100, price, fxRate: 1 });
      return `<table class="preview-table"><tr><td>Price step at Rp${price.toLocaleString('id-ID')}</td><td>Rp${tick}${onTick ? ' ✓' : ` · nearest valid Rp${E.roundToTick(price).toLocaleString('id-ID')}`}</td></tr>
        <tr><td>One lot (100 shares)</td><td>${E.formatIdr(price * 100)}</td></tr>
        <tr class="total"><td>Whole lots you can buy incl. 0.15% fee</td><td>${lots}</td></tr>
        <tr><td>Total cost</td><td>${E.formatIdr(lots ? cost.totalIdr : 0)}</td></tr><tr><td>Left over</td><td>${E.formatIdr(budget - (lots ? cost.totalIdr : 0))}</td></tr></table>`;
    }
    if (type === 'scam-sorter') {
      const labelled = C.scamExamples.filter((example, index) => data[`s${index}`]).length;
      const right = C.scamExamples.filter((example, index) => data[`s${index}`] && (data[`s${index}`] === 'scam') === example.scam).length;
      return labelled ? `<div class="notice ${right === C.scamExamples.length ? 'ok' : 'info'}">${right}/${C.scamExamples.length} labelled correctly. Report anything suspicious to OJK: 157 or WhatsApp 081-157-157-157.</div>` : '';
    }
    if (type === 'compound-slider') {
      const result = E.compound({ initialIdr: parseAmount(data.initial), monthlyIdr: parseAmount(data.monthly), annualPct: parseDecimal(data.rate), years: parseDecimal(data.years) });
      const weekly = E.weeklyEarnings(parseAmount(data.initial), parseDecimal(data.rate));
      const series = result.series.map((value, index) => [null, value]);
      return `<table class="preview-table"><tr><td>You put in</td><td>${E.formatIdr(result.contributedIdr)}</td></tr><tr><td>Growth</td><td class="up">${E.formatIdr(result.growthIdr, { sign: true })}</td></tr>
        <tr class="total"><td>After ${esc(data.years)} years</td><td>${E.formatIdr(result.futureIdr)}</td></tr></table>
        <div style="height:120px;margin-top:8px">${chartHtml('widget|compound', series, 'IDX').replace('class="chart-wrap"', 'class="chart-wrap" style="height:120px"')}</div>
        <p class="small">The starting amount alone earns about <b>${E.formatIdr(weekly)}</b> a week at ${esc(data.rate)}% a year. Assumes a constant return, which real markets never give.</p>`;
    }
    if (type === 'allocation') {
      const raw = {};
      let sum = 0;
      for (const id of E.MARKET_ORDER) {
        raw[id] = parseDecimal(data[id]);
        sum += raw[id];
      }
      if (!(sum > 0)) return '<div class="notice warn">Give at least one market some weight.</div>';
      const weights = {};
      for (const id of E.MARKET_ORDER) weights[id] = (raw[id] / sum) * 100;
      const vol = E.portfolioVolatility(weights);
      const average = E.MARKET_ORDER.reduce((total, id) => total + (weights[id] / 100) * E.ASSUMED_VOLATILITY[id], 0);
      return `<div class="legend">${E.MARKET_ORDER.map((id) => `<span><i style="background:${MARKET_COLORS[id]}"></i>${E.MARKETS[id].short} ${weights[id].toFixed(0)}%</span>`).join('')}</div>
        <table class="preview-table" style="margin-top:8px"><tr><td>Weighted average of the parts</td><td>${average.toFixed(1)}% a year</td></tr>
        <tr class="total"><td>Portfolio volatility (with correlation)</td><td>${vol.toFixed(1)}% a year</td></tr></table>
        <p class="small" style="margin-top:6px">Diversification saves <b>${(average - vol).toFixed(1)} points</b> of volatility. Roughly, a typical bad year could be about −${(vol).toFixed(0)}% or worse.</p>`;
    }
    if (type === 'sizing-calculator') {
      const lot = data.market === 'IDX' ? 100 : 1;
      const result = E.positionSize({ capitalIdr: parseAmount(data.capital), riskPct: parseDecimal(data.risk), entry: parseDecimal(data.entry), stop: parseDecimal(data.stop), lotSize: lot });
      return `<table class="preview-table"><tr><td>Money at risk</td><td>${E.formatIdr(result.riskIdr)}</td></tr>
        <tr class="total"><td>Position size</td><td>${result.units.toLocaleString('en-US')} shares${lot === 100 ? ` (${result.units / 100} lots)` : ''}</td></tr>
        <tr><td>Position value</td><td>${E.formatIdr(result.valueIdr)} · ${result.pctOfCapital.toFixed(1)}% of portfolio</td></tr></table>
        <p class="tiny muted" style="margin-top:6px">Gaps can jump past a stop, so the real loss can be larger.</p>`;
    }
    if (type === 'fx-calculator') {
      const stock = parseDecimal(data.stock);
      const fx = parseDecimal(data.fx);
      const total = E.fxAdjustedReturn(stock, fx);
      return `<table class="preview-table"><tr><td>Stock in USD</td><td>${E.formatPct(stock, 1)}</td></tr><tr><td>USD/IDR</td><td>${E.formatPct(fx, 1)}</td></tr>
        <tr class="total"><td>Your result in rupiah</td><td class="${total >= 0 ? 'up' : 'down'}">${E.formatPct(total, 2)}</td></tr></table>
        <p class="small" style="margin-top:6px">(1 ${stock >= 0 ? '+' : '−'} ${Math.abs(stock)}%) × (1 ${fx >= 0 ? '+' : '−'} ${Math.abs(fx)}%) − 1, before the conversion spread.</p>`;
    }
    if (type === 'scorecard-reader') {
      if (!data.pick) return '';
      const cards = Object.values(ANALYSTS).map((analyst) => ({ id: analyst.id, card: analystScorecard(analyst.id) }));
      const best = cards.filter((entry) => entry.card.avgExcessPct != null).sort((a, b) => b.card.avgExcessPct - a.card.avgExcessPct)[0];
      const right = best && data.pick === best.id;
      return `<div class="notice ${right ? 'ok' : 'warn'}">${right ? 'Right' : 'Not quite'}: ${esc(ANALYSTS[best.id].name)} has the highest average excess return (${E.formatPct(best.card.avgExcessPct, 1)}). A high win rate alone does not prove skill: compare the average result with what the benchmark did over the same days.</div>`;
    }
    return '';
  }

  function completeLesson(id) {
    const lesson = C.lessons.find((item) => item.id === id);
    const ls = lessonState(id);
    const correct = lesson.quiz.filter((question, index) => ls.answers[index] === question.answer).length;
    const xp = 50 + correct * 10;
    state.learn.completed[id] = { at: new Date().toISOString(), score: correct, total: lesson.quiz.length, xp };
    state.learn.streak = E.bumpStreak(state.learn.streak, Date.now());
    save();
    toast(`Lesson complete: +${xp} XP`, 'ok');
    render();
  }

  // ------------------------------------------------------------ me/plans

  function viewMe() {
    const risk = state.profile.risk;
    const marketToggles = E.MARKET_ORDER.map((id) => {
      const on = state.profile.markets.indexOf(id) !== -1;
      return `<button class="chip ${on ? 'active' : ''}" data-action="me-market" data-market="${id}">${marketLabel(id)}</button>`;
    }).join('');
    const stocksLine = runtime.sources.stocks === 'live' ? `Live · ${esc(runtime.sources.stocksTime || '')}` : `Snapshot · ${esc(SNAP.sources.stocks)}`;
    const cryptoLine = runtime.sources.crypto === 'live' ? `Live · ${esc(fmtDateTime(runtime.sources.cryptoTime))}` : `Snapshot · ${esc(fmtDateTime(Date.parse(SNAP.takenAt)))}`;
    return `
      <h1>Me</h1>
      <div class="grid-2">
        <div class="card">
          <label class="field"><span>Display name</span><input type="text" maxlength="24" value="${esc(state.profile.name)}" data-input="me-name"></label>
          <b>My markets</b><div class="row wrap" style="margin-top:8px">${marketToggles}</div>
          <hr class="sep">
          ${riskSummaryHtml(risk)}
          <a class="btn small" href="#risk">Retake risk questions</a>
        </div>
        <div class="card">
          <div class="row between"><b>Plan</b><span class="badge brand">${esc(planName(planId()))}</span></div>
          <p class="small muted">${state.plan.renewsAt ? `Renews ${esc(fmtDate(Date.parse(state.plan.renewsAt)))} (demo billing, nothing is charged).` : 'Free forever. Upgrade any time.'}</p>
          <a class="btn small" href="#plans">Manage plan</a>
          <hr class="sep">
          <b>Prices</b>
          <div class="segmented" style="margin:8px 0">
            <button class="${isSimulated() ? '' : 'active'}" data-action="data-mode" data-mode="live">Live (delayed)</button>
            <button class="${isSimulated() ? 'active' : ''}" data-action="data-mode" data-mode="simulated">Simulated</button>
          </div>
          <p class="tiny muted">Simulated mode moves prices randomly every 2 seconds and keeps every market open, so you can practise limit orders any time. Simulated prices are not real.</p>
          <div class="toggle"><span class="small">Respect trading hours (queue orders while markets are closed)</span>
            <input type="checkbox" data-input="respect-hours" ${state.settings.respectHours !== false ? 'checked' : ''} ${isSimulated() ? 'disabled' : ''} aria-label="Respect trading hours"></div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:14px">
        <div class="card">
          <b>Your data</b>
          <p class="small muted" id="sync-note">${syncNote()} ${runtime.storageOk ? '' : '<span class="down">Storage is blocked here, so changes are lost when you close the tab.</span>'}</p>
          <div class="row wrap">
            <button class="btn small" data-action="export">Export JSON</button>
            <label class="btn small" style="cursor:pointer">Import JSON<input type="file" accept="application/json" data-input="import" style="display:none"></label>
            <button class="btn small" data-action="reset" style="color:var(--down)">Reset practice account</button>
            ${DEMO ? '<a class="btn small" href="index.html">Leave demo</a>' : ''}
          </div>
        </div>
        <div class="card small">
          <b>Data sources</b>
          <div class="muted" style="margin-top:6px">US & IDX stocks: ${stocksLine}<br>Crypto & gold: ${cryptoLine} (CoinGecko; gold via XAUT ÷ 31.1035 g)<br>USD/IDR: ${E.formatIdr(runtime.fxRate)}<br>News: ${runtime.newsSource === 'server' ? 'Twin server (all feeds, every 10 min)' : runtime.newsSource === 'browser' ? 'Twin + Antara (live)' : 'bundled snapshot'}${SNAP.newsTakenAt ? ` · snapshot headlines ${esc(fmtDateTime(Date.parse(SNAP.newsTakenAt)))}` : ''}</div>
          <hr class="sep">
          <b>App version</b>
          <div id="id-update" style="margin-top:6px">${updateRowHtml()}</div>
          <hr class="sep">
          <b>About</b>
          <p class="muted" style="margin-top:6px">Twin Indonesia ${VERSION} · prototype. Practice money only, not investment advice, not a licensed broker. <a href="#guide">How Twin Indonesia works</a></p>
        </div>
      </div>`;
  }

  function viewRisk() {
    if (!runtime.riskDraft) runtime.riskDraft = Object.assign({}, state.profile.answers || {});
    const answers = runtime.riskDraft;
    return `
      <a href="#me" class="small">← Me</a>
      <h1 style="margin-top:8px">Risk questions</h1>
      <div class="stack">${riskQuizHtml(answers, 'risk')}</div>
      ${quizComplete(answers) ? `<div class="card" style="margin-top:14px">${riskSummaryHtml(E.riskProfile(answers))}</div>` : ''}
      <button class="btn primary block" style="margin-top:14px" data-action="risk-save" ${quizComplete(answers) ? '' : 'disabled'}>Save profile</button>`;
  }

  function viewPlans() {
    const current = planId();
    const cards = C.plans.map((plan) => {
      const isCurrent = plan.id === current;
      const action = isCurrent
        ? '<button class="btn block" disabled>Current plan</button>'
        : plan.id === 'free'
          ? '<button class="btn block" data-action="cancel-plan">Switch to Free</button>'
          : `<button class="btn primary block" data-action="choose-plan" data-plan="${plan.id}">Choose ${esc(plan.name)}</button>`;
      return `<div class="card plan-card ${isCurrent ? 'current' : ''}">
        <div class="row between"><h2 style="margin:0">${esc(plan.name)}</h2>${isCurrent ? '<span class="badge brand">current</span>' : ''}</div>
        <div class="small muted">${esc(plan.tagline)}</div>
        <div class="price-tag" style="margin-top:10px">${plan.priceIdr ? `${E.formatIdr(plan.priceIdr)}<span class="small muted"> /month</span>` : 'Rp0'}</div>
        <ul class="feature-list">${plan.features.map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul>
        ${action}
      </div>`;
    }).join('');
    return `
      <h1>Plans</h1>
      <p class="muted">Learning, practice trading, Scam Shield and analyst track records stay free. Paid plans add members' rooms and live ideas from licensed advisers.</p>
      <div class="grid-3">${cards}</div>
      <p class="footnote">Prices are placeholders for this prototype and checkout is simulated; nothing is charged. In production, in-app subscriptions go through Google Play / App Store billing or a licensed payment gateway, and analyst revenue shares follow the adviser's licence terms.</p>`;
  }

  function openCheckout(id) {
    const plan = C.plans.find((item) => item.id === id);
    openModal(`
      <div class="modal-head"><h2 style="margin:0">Join ${esc(plan.name)}</h2><button class="close-x" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="price-tag">${E.formatIdr(plan.priceIdr)}<span class="small muted"> /month</span></div>
      <ul class="feature-list">${plan.features.map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul>
      <div class="notice warn">Demo checkout: no payment is taken and no card details are asked for.</div>
      <button class="btn primary block" style="margin-top:12px" data-action="checkout-confirm" data-plan="${plan.id}">Activate ${esc(plan.name)} (demo)</button>`);
  }

  function viewGuide() {
    return `
      <h1>How Twin Indonesia works</h1>
      <div class="stack">${C.guide.map((section) => `<div class="card"><h2>${esc(section.title)}</h2>${section.body.map((p) => `<p class="small">${esc(p)}</p>`).join('')}</div>`).join('')}
        <div class="card"><h2>From practice to real money</h2><p class="small">This prototype never touches real money. A real launch in Indonesia needs licensed partners or licences for every market: an OJK-licensed securities broker for IDX stocks, an OJK-approved provider for US-stock derivatives, an OJK-licensed digital-asset trader for crypto, a regulated provider for gold, and an OJK investment-adviser licence for anyone who sells recommendations. See docs/GUIDE.md.</p></div>
      </div>`;
  }

  // --------------------------------------------------------- modal/toast

  function openModal(html) {
    document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  }

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    runtime.ticket = null;
    runtime.transfer = null;
  }

  function modalOpen() {
    return !!document.querySelector('#modal-root .modal');
  }

  function toast(message, kind) {
    const root = document.getElementById('toast-root');
    const element = document.createElement('div');
    element.className = `toast ${kind || ''}`;
    element.setAttribute('role', 'status');
    element.textContent = message;
    root.appendChild(element);
    setTimeout(() => element.remove(), 3800);
  }

  // -------------------------------------------------------------- actions

  const actions = {
    'update-check': async (data, button) => {
      if (!window.TwinUpdate) return;
      button.disabled = true;
      await window.TwinUpdate.check(true);
      paintUpdateRow();
    },
    'update-apply': () => {
      if (window.TwinUpdate) window.TwinUpdate.apply();
    },
    'ob-next': () => {
      runtime.onboarding.step = Math.min(3, runtime.onboarding.step + 1);
      renderOnboarding();
      window.scrollTo(0, 0);
    },
    'ob-back': () => {
      runtime.onboarding.step = Math.max(0, runtime.onboarding.step - 1);
      renderOnboarding();
    },
    'ob-toggle-market': (data) => {
      const markets = runtime.onboarding.markets;
      const index = markets.indexOf(data.market);
      if (index === -1) markets.push(data.market);
      else markets.splice(index, 1);
      renderOnboarding();
    },
    'ob-answer': (data) => {
      runtime.onboarding.answers[data.key] = data.value === 'true' ? true : data.value === 'false' ? false : Number(data.value);
      renderOnboarding();
    },
    'ob-cash': (data) => {
      runtime.onboarding.cash = Number(data.cash);
      renderOnboarding();
    },
    'ob-finish': () => finishOnboarding(),
    'risk-answer': (data) => {
      runtime.riskDraft[data.key] = data.value === 'true' ? true : data.value === 'false' ? false : Number(data.value);
      render();
    },
    'risk-save': () => {
      state.profile.answers = Object.assign({}, runtime.riskDraft);
      state.profile.risk = E.riskProfile(state.profile.answers);
      runtime.riskDraft = null;
      save();
      toast(`Risk profile saved: ${state.profile.risk.label}.`, 'ok');
      location.hash = '#me';
    },
    watch: (data) => {
      const list = state.watchlist;
      const index = list.indexOf(data.symbol);
      if (index === -1) list.push(data.symbol);
      else list.splice(index, 1);
      save();
      render();
    },
    'chart-range': (data) => {
      runtime.chartRange[data.symbol] = data.range;
      render();
    },
    'open-ticket': (data) => openTicket(data.symbol, data.side),
    'ticket-side': (data) => {
      const ticket = runtime.ticket;
      ticket.side = data.value;
      const marketId = INSTRUMENTS[ticket.symbol].market;
      if (marketId !== 'IDX') ticket.mode = ticket.side === 'sell' ? 'qty' : 'amount';
      if (ticket.side === 'sell') {
        const held = E.availableQty(state, ticket.symbol);
        ticket.qty = held ? String(held) : '';
        if (marketId === 'IDX') ticket.lots = String(Math.max(1, Math.floor(held / 100)));
      }
      renderTicket();
    },
    'ticket-type': (data) => {
      runtime.ticket.type = data.value;
      renderTicket();
    },
    'ticket-mode': (data) => {
      runtime.ticket.mode = data.value;
      renderTicket();
    },
    'ticket-step': (data) => {
      const ticket = runtime.ticket;
      ticket.lots = String(Math.max(1, Math.floor(parseDecimal(ticket.lots)) + Number(data.delta)));
      renderTicket();
    },
    'ticket-max': () => {
      const ticket = runtime.ticket;
      const held = E.availableQty(state, ticket.symbol);
      if (INSTRUMENTS[ticket.symbol].market === 'IDX') {
        ticket.lots = String(Math.floor(held / 100));
      } else {
        ticket.mode = 'qty';
        ticket.qty = String(held);
      }
      renderTicket();
    },
    'ticket-round': () => {
      const ticket = runtime.ticket;
      const limit = parseDecimal(ticket.limit);
      if (limit > 0) ticket.limit = String(E.roundToTick(limit));
      renderTicket();
    },
    'ticket-confirm': () => confirmTicket(),
    'transfer-open': (data) => openTransfer(data.direction),
    'transfer-direction': (data) => {
      const draft = runtime.transfer;
      if (!draft || draft.busy) return;
      draft.direction = data.value === 'idr_to_usd' ? 'idr_to_usd' : 'usd_to_idr';
      draft.amount = '';
      renderTransfer();
    },
    'transfer-fill': (data) => {
      const draft = runtime.transfer;
      if (!draft || draft.busy) return;
      const amount = transferAvailable(draft.direction) * (clamp(Number(data.pct) || 0, 0, 100) / 100);
      draft.amount = draft.direction === 'usd_to_idr'
        ? (Math.floor(amount * 100 + 1e-6) / 100).toFixed(2)
        : Math.floor(amount + 1e-6).toLocaleString('id-ID');
      renderTransfer();
    },
    'transfer-confirm': () => confirmTransfer(),
    'wallets-retry': () => linkUsdWallet(true),
    'close-modal': () => closeModal(),
    backdrop: (data, target, event) => {
      if (event.target === target) closeModal();
    },
    'cancel-order': (data) => {
      state = E.cancelOrder(state, data.id);
      save();
      toast('Order cancelled.');
      render();
    },
    'post-submit': () => submitPost(),
    like: (data) => {
      if (state.community.likes[data.id]) delete state.community.likes[data.id];
      else state.community.likes[data.id] = true;
      save();
      render();
    },
    report: (data) => {
      state.community.reports[data.id] = true;
      save();
      toast('Reported to moderators. Thank you.');
      render();
    },
    reveal: (data) => {
      state.community.revealed[data.id] = true;
      save();
      render();
    },
    'desk-filter': (data) => {
      runtime.deskAnalyst = runtime.deskAnalyst === data.analyst ? 'all' : data.analyst;
      render();
    },
    'idea-ticket': (data) => {
      const idea = IDEAS.find((item) => item.id === data.id);
      if (!idea) return;
      openTicket(idea.symbol, idea.direction === 'SELL' ? 'sell' : 'buy', `idea:${idea.id}`);
    },
    'quiz-answer': (data) => {
      lessonState(data.lesson).answers[Number(data.q)] = Number(data.option);
      render();
    },
    'lesson-complete': (data) => completeLesson(data.lesson),
    match: (data) => {
      lessonState('four-markets').widget[`m${data.index}`] = data.market;
      render();
    },
    'scam-label': (data) => {
      lessonState('scam-shield').widget[`s${data.index}`] = data.label;
      render();
    },
    'score-pick': (data) => {
      lessonState('judging-analysts').widget.pick = data.analyst;
      render();
    },
    'choose-plan': (data) => openCheckout(data.plan),
    'checkout-confirm': (data) => {
      const now = Date.now();
      state.plan = { id: data.plan, since: new Date(now).toISOString(), renewsAt: new Date(now + 30 * E.DAY_MS).toISOString() };
      save();
      closeModal();
      toast(`${planName(data.plan)} is active (demo).`, 'ok');
      render();
    },
    'cancel-plan': () => {
      state.plan = { id: 'free', since: null, renewsAt: null };
      save();
      toast('Switched to Free.');
      render();
    },
    'me-market': (data) => {
      const markets = state.profile.markets;
      const index = markets.indexOf(data.market);
      if (index === -1) markets.push(data.market);
      else if (markets.length > 1) markets.splice(index, 1);
      state.profile.markets = E.MARKET_ORDER.filter((id) => markets.indexOf(id) !== -1);
      save();
      render();
    },
    'data-mode': (data) => {
      state.settings.dataMode = data.mode;
      save();
      startTimers();
      if (data.mode === 'live') refreshLive();
      render();
    },
    export: () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `twin-indonesia-practice-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 0);
    },
    reset: () => {
      if (!SELFTEST && !window.confirm('Reset your practice account? Positions, orders, posts and lesson progress will be erased.')) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        // storage blocked: memory state is discarded below anyway
      }
      state = null;
      clearSummary();
      runtime.onboarding = freshOnboarding();
      runtime.lessonState = {};
      location.hash = '';
      document.getElementById('app').innerHTML = '';
      render();
    },
  };

  const inputs = {
    search: (el) => {
      runtime.search = el.value;
      const list = document.getElementById('market-list');
      if (list) list.innerHTML = marketListHtml(el.dataset.market);
    },
    'ticket-lots': (el) => {
      runtime.ticket.lots = el.value;
      renderTicketPreview();
    },
    'ticket-amount': (el) => {
      runtime.ticket.amount = el.value;
      renderTicketPreview();
    },
    'ticket-qty': (el) => {
      runtime.ticket.qty = el.value;
      renderTicketPreview();
    },
    'ticket-limit': (el) => {
      runtime.ticket.limit = el.value;
      renderTicketPreview();
    },
    'transfer-amount': (el) => {
      if (!runtime.transfer || runtime.transfer.busy) return;
      runtime.transfer.amount = el.value;
      renderTransferPreview();
    },
    composer: (el) => {
      runtime.draft = el.value;
      const check = document.getElementById('composer-check');
      if (check) check.innerHTML = composerCheckHtml(el.value);
    },
    'composer-sentiment': (el) => {
      runtime.draftSentiment = el.value;
    },
    widget: (el) => {
      const route = parseHash();
      lessonState(route.arg).widget[el.dataset.field] = el.value;
      updateWidgetResult(route.arg);
    },
    'me-name': (el, event) => {
      if (event.type !== 'change') return;
      state.profile.name = el.value.trim().slice(0, 24) || 'Guest';
      save();
      updateChrome(parseHash());
    },
    'respect-hours': (el, event) => {
      if (event.type !== 'change') return;
      state.settings.respectHours = el.checked;
      save();
      afterPriceUpdate();
    },
    import: (el, event) => {
      if (event.type !== 'change' || !el.files || !el.files[0]) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = E.migrateState(JSON.parse(reader.result));
          if (!imported || !imported.profile) throw new Error('invalid');
          state = imported;
          save();
          toast('Practice account imported.', 'ok');
          render();
        } catch (error) {
          toast('That file is not a Twin Indonesia export.', 'error');
        }
      };
      reader.readAsText(el.files[0]);
    },
  };

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || target.disabled) return;
      const handler = actions[target.dataset.action];
      if (!handler) return;
      event.preventDefault();
      handler(target.dataset, target, event);
    });
    const onInput = (event) => {
      const target = event.target.closest && event.target.closest('[data-input]');
      if (!target) return;
      const handler = inputs[target.dataset.input];
      if (handler) handler(target, event);
    };
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modalOpen()) closeModal();
    });
    document.addEventListener('pointermove', (event) => {
      const wrap = event.target.closest && event.target.closest('.chart-wrap');
      if (!wrap) return;
      const entry = runtime.chartPoints[wrap.dataset.chart];
      if (!entry) return;
      const rect = wrap.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const point = entry.points[Math.round(ratio * (entry.points.length - 1))];
      wrap.querySelector('.chart-tip').textContent = `${E.formatPrice(entry.market, point[1])}${point[0] ? ` · ${fmtDateTime(point[0] * 1000)}` : ''}`;
      const cursor = wrap.querySelector('.chart-cursor');
      cursor.style.display = 'block';
      cursor.style.left = `${ratio * 100}%`;
    });
    window.addEventListener('hashchange', () => {
      if (modalOpen()) closeModal();
      render();
      maybeOpenTransferFromHash();
    });
    // Another tab changed this wallet (a trade or a transfer): load its copy, so this tab
    // never saves an older wallet over it and both wallets stay in step.
    window.addEventListener('storage', (event) => {
      if (!SYNCS || event.key !== STORAGE_KEY || !event.newValue) return;
      const next = load();
      if (!next || !next.profile || JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      render();
      if (runtime.transfer && modalOpen()) renderTransferPreview();
      if (runtime.ticket && modalOpen()) renderTicketPreview();
    });
  }

  // ------------------------------------------------------ live updates

  function updateLive() {
    document.querySelectorAll('[data-price]').forEach((el) => {
      el.textContent = priceText(el.dataset.price);
    });
    document.querySelectorAll('[data-change]').forEach((el) => {
      const quote = runtime.prices[el.dataset.change];
      if (!quote) return;
      el.textContent = E.formatPct(quote.changePct);
      el.classList.toggle('up', quote.changePct >= 0);
      el.classList.toggle('down', quote.changePct < 0);
    });
    document.querySelectorAll('[data-idr]').forEach((el) => {
      el.textContent = usdToIdrText(el.dataset.idr);
    });
    if (state && document.querySelector('[data-pv], [data-posval]')) {
      const value = E.portfolioValue(state, ctx());
      document.querySelectorAll('[data-pv="total"]').forEach((el) => {
        el.textContent = E.formatIdr(value.totalIdr);
      });
      document.querySelectorAll('[data-pv="return"]').forEach((el) => {
        el.textContent = E.formatPct(value.returnPct);
      });
      document.querySelectorAll('[data-pv="day"]').forEach((el) => {
        el.textContent = E.formatIdr(value.dayChangeIdr, { sign: true });
      });
      document.querySelectorAll('[data-pv="free"]').forEach((el) => {
        el.textContent = E.formatIdr(value.availableIdr);
      });
      document.querySelectorAll('[data-pv="fx"]').forEach((el) => {
        el.textContent = E.formatIdr(runtime.fxRate);
      });
      const paper = runtime.usd.paper;
      const combined = paper ? E.combinedWallets(value.totalIdr, Number(paper.value) || 0, runtime.fxRate) : null;
      if (combined) {
        document.querySelectorAll('[data-pv="combined"]').forEach((el) => {
          el.textContent = `≈ ${E.formatIdr(combined.idr)}`;
        });
        document.querySelectorAll('[data-pv="combined-usd"]').forEach((el) => {
          el.textContent = E.formatUsd(combined.usd);
        });
      }
      document.querySelectorAll('[data-posval]').forEach((el) => {
        const position = value.positions.find((item) => item.symbol === el.dataset.posval);
        if (position) el.textContent = E.formatIdr(position.valueIdr);
      });
    }
    if (runtime.ticket && modalOpen()) renderTicketPreview();
    if (runtime.transfer && modalOpen() && !runtime.transfer.busy) renderTransferPreview();
    if (state && state.profile && state.profile.onboarded) updateChrome(parseHash());
  }

  function afterPriceUpdate() {
    if (!state || !state.profile || !state.profile.onboarded) return;
    // While a move between wallets is in flight, fills wait: the move returns the new wallet.
    if (runtime.transfer && runtime.transfer.busy) return;
    const outcome = E.processOrders(state, ctx());
    if (outcome.fills.length) {
      state = outcome.state;
      save();
      for (const order of outcome.fills) {
        toast(`Filled: ${order.side} ${E.formatQty(order.market, order.qty, order.symbol)} ${order.symbol} at ${E.formatPrice(order.market, order.fillPrice)}`, 'ok');
      }
      const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (!modalOpen() && !typing) {
        render();
        return;
      }
    }
    writeSummary(true);
    updateLive();
  }

  async function refreshStocks() {
    if (OFFLINE || isSimulated()) return;
    const stocks = await F.loadStocks(SNAP.instruments);
    if (!stocks || isSimulated()) return;
    mergePrices(stocks.prices);
    if (stocks.fxRate) runtime.fxRate = stocks.fxRate;
    if (stocks.fxAsOf) runtime.fxAsOf = stocks.fxAsOf;
    Object.assign(runtime.benchmarks, stocks.benchmarks);
    runtime.sources.stocks = 'live';
    runtime.sources.stocksTime = stocks.takenAt;
    afterPriceUpdate();
  }

  async function refreshCrypto() {
    if (OFFLINE || isSimulated()) return;
    const crypto = await F.loadCrypto(SNAP.instruments);
    if (!crypto || isSimulated()) return;
    mergePrices(crypto.prices);
    runtime.sources.crypto = 'live';
    runtime.sources.cryptoTime = Date.now();
    afterPriceUpdate();
  }

  async function refreshNews() {
    if (OFFLINE) return;
    const result = await F.loadNews(runtime.server, KNOWN_BY_MARKET);
    if (!result) return;
    const seen = new Set();
    const merged = [];
    for (const item of result.items.concat(SNAP.news)) {
      if (!item || seen.has(item.link)) continue;
      seen.add(item.link);
      merged.push(item);
    }
    merged.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    runtime.news = merged;
    runtime.newsSource = result.source;
    const route = parseHash();
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (state && state.profile && state.profile.onboarded && !modalOpen() && !typing && (route.name === 'home' || route.name === 'asset')) {
      render();
    }
  }

  function refreshLive() {
    return Promise.all([refreshStocks(), refreshCrypto()]);
  }

  function simTick() {
    for (const symbol of SYMBOLS) {
      const quote = runtime.prices[symbol];
      const marketId = INSTRUMENTS[symbol].market;
      const raw = E.simulateStep(quote.raw || quote.price, marketId, 0.02, runtime.rng);
      const price = E.tidyPrice(marketId, raw);
      const spark = (quote.spark || []).slice(-29).concat(price);
      runtime.prices[symbol] = Object.assign({}, quote, {
        raw,
        price,
        changePct: ((price - quote.prev) / quote.prev) * 100,
        spark,
        source: 'Simulated (not real)',
        time: Date.now(),
      });
    }
    afterPriceUpdate();
  }

  function stopTimers() {
    for (const timer of runtime.timers) clearInterval(timer);
    runtime.timers = [];
  }

  function startTimers() {
    stopTimers();
    if (SELFTEST) return;
    if (isSimulated()) {
      runtime.timers.push(setInterval(simTick, 2000));
    } else if (!OFFLINE) {
      runtime.timers.push(setInterval(refreshCrypto, 120000));
      runtime.timers.push(setInterval(refreshStocks, 600000));
      runtime.timers.push(setInterval(refreshNews, 900000));
    }
    runtime.timers.push(setInterval(afterPriceUpdate, 30000));
    runtime.timers.push(setInterval(() => {
      if (runtime.sync.enabled && runtime.sync.status === 'offline') pullWallet();
    }, 60000));
  }

  // ------------------------------------------------------- account sync
  // On Twin's own server, a signed-in Twin account keeps a copy of this wallet, so it
  // follows you to other browsers. The account copy wins when it changed elsewhere;
  // hidden tabs never upload, and every pull happens before any upload (see E.syncAction).

  async function connectServer() {
    runtime.server = await serverDetected();
    if (!runtime.server || !SYNCS) return;
    await pullWallet();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pullWallet();
    });
  }

  function readSyncMeta() {
    try {
      const meta = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
      return meta && typeof meta === 'object' ? meta : null;
    } catch (error) {
      return null;
    }
  }

  function writeSyncMeta() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify({ account: runtime.sync.account, rev: runtime.sync.rev }));
    } catch (error) {
      // sync still works for this page view
    }
  }

  function backupLocal() {
    if (!state || !state.profile) return;
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
    } catch (error) {
      // best effort
    }
  }

  function markSynced() {
    runtime.sync.status = 'synced';
    runtime.sync.lastSyncedAt = Date.now();
  }

  async function pullWallet() {
    if (!runtime.server || !SYNCS) return;
    try {
      await pullWalletOnce();
    } finally {
      refreshSyncNote();
    }
  }

  async function pullWalletOnce() {
    const sync = runtime.sync;
    const result = await F.loadWallet();
    if (!result) {
      sync.status = 'offline';
      return;
    }
    if (result.status === 401) {
      sync.enabled = false;
      sync.status = 'signed-out';
      return;
    }
    const data = result.data;
    if (result.status !== 200 || !data || !data.ok) {
      sync.status = 'error';
      return;
    }
    const remoteState = data.wallet ? E.migrateState(data.wallet) : null;
    const remote = { wallet: remoteState, rev: data.rev, account: data.account };
    const action = E.syncAction(state, remote, readSyncMeta());
    sync.enabled = true;
    sync.account = data.account;
    sync.rev = data.rev;
    writeSyncMeta();
    if (action === 'adopt') {
      adoptWallet(remoteState);
    } else if (action === 'detach') {
      detachWallet();
    } else if (action === 'push') {
      await pushWallet();
      return;
    }
    markSynced();
  }

  function adoptWallet(incoming) {
    const changed = !state || JSON.stringify(state) !== JSON.stringify(incoming);
    if (changed) backupLocal();
    state = incoming;
    persistLocal();
    if (!changed) return;
    startTimers();
    if (modalOpen()) closeModal();
    render();
    toast('Loaded your rupiah wallet from your Twin account.', 'ok');
  }

  function detachWallet() {
    backupLocal();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // memory state is discarded below anyway
    }
    clearSummary();
    state = null;
    runtime.onboarding = freshOnboarding();
    if (modalOpen()) closeModal();
    location.hash = '';
    render();
    toast('This Twin account has no rupiah wallet yet, so you start fresh. The other wallet stays with its own account.', 'ok');
  }

  function scheduleSync() {
    clearTimeout(runtime.saveTimer);
    runtime.saveTimer = setTimeout(pushWallet, 800);
  }

  async function pushWallet() {
    const sync = runtime.sync;
    if (!sync.enabled || !state || !state.profile) return;
    // A background tab never uploads: it pulls first when it becomes visible again.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (sync.pushing) {
      sync.pending = true;
      return;
    }
    sync.pushing = true;
    sync.pending = false;
    let conflict = false;
    try {
      const result = await F.saveWallet(state, sync.rev);
      if (!result) {
        sync.status = 'offline';
      } else if (result.status === 401) {
        sync.enabled = false;
        sync.status = 'signed-out';
      } else if (result.data && result.data.ok) {
        sync.rev = result.data.rev;
        writeSyncMeta();
        markSynced();
      } else if (result.data && result.data.conflict) {
        conflict = true;
      } else {
        sync.status = 'error';
      }
    } finally {
      sync.pushing = false;
    }
    if (conflict) {
      // Another browser saved first: its copy wins (this one is kept as a backup).
      await pullWallet();
    } else if (sync.pending && sync.enabled) {
      scheduleSync();
    }
    refreshSyncNote();
  }

  /** Keep Settings' "Your data" line current when a sync finishes in the background. */
  function refreshSyncNote() {
    const note = document.getElementById('sync-note');
    if (!note) return;
    const blocked = runtime.storageOk ? '' : '<span class="down">Storage is blocked here, so changes are lost when you close the tab.</span>';
    note.innerHTML = `${syncNote()} ${blocked}`;
  }

  function syncNote() {
    if (!runtime.server || !SYNCS) return 'Stored in this browser.';
    const sync = runtime.sync;
    if (sync.enabled) {
      const when = sync.lastSyncedAt ? ` Last synced ${esc(fmtDateTime(sync.lastSyncedAt))}.` : '';
      const problem = sync.status === 'offline' ? ' <span class="down">Server unreachable; changes upload when it is back.</span>'
        : sync.status === 'error' ? ' <span class="down">The last sync failed; it retries on your next change.</span>' : '';
      return `Stored in this browser and synced to your Twin account on this server.${when}${problem}`;
    }
    return 'Stored in this browser. <a href="../">Log in to Twin</a> on this server to keep it in your account and use it on other devices.';
  }

  // ------------------------------------------------------------- demo

  function histPrice(symbol, daysAgo) {
    const points = (INSTRUMENTS[symbol].hist && INSTRUMENTS[symbol].hist['1M']) || [];
    const cutoff = Date.now() / 1000 - daysAgo * 86400;
    let chosen = null;
    for (const point of points) {
      if (point[0] <= cutoff) chosen = point;
    }
    return chosen ? E.tidyPrice(INSTRUMENTS[symbol].market, chosen[1]) : runtime.prices[symbol].price;
  }

  function demoState() {
    const markets = E.MARKET_ORDER.slice();
    const answers = { goal: 1, horizon: 2, drawdown: 2, experience: 1, emergencyFund: true };
    let demo = E.createState({
      startingCashIdr: 10000000,
      watchlist: defaultWatchlist(markets),
      profile: { name: 'Demo investor', markets, answers, risk: E.riskProfile(answers), onboarded: true, createdAt: new Date(Date.now() - 12 * E.DAY_MS).toISOString() },
    });
    const buys = [
      ['VOO', 1500000, 9],
      ['AAPL', 700000, 6],
      ['BBCA', 3, 11],
      ['TLKM', 5, 8],
      ['BTC', 600000, 5],
      ['XAU', 900000, 10],
    ];
    for (const [symbol, size, daysAgo] of buys) {
      const marketId = INSTRUMENTS[symbol].market;
      const price = histPrice(symbol, daysAgo);
      const prices = Object.assign({}, runtime.prices, { [symbol]: Object.assign({}, runtime.prices[symbol], { price }) });
      const when = Date.now() - daysAgo * E.DAY_MS;
      const qty = marketId === 'IDX' ? size * 100 : E.qtyForAmount({ market: marketId, amountIdr: size, price, fxRate: runtime.fxRate });
      const outcome = E.placeOrder(demo, { symbol, side: 'buy', type: 'market', qty }, ctx({ prices, now: when, respectHours: false }));
      if (outcome.result.ok) demo = outcome.state;
    }
    demo.orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const antm = runtime.prices.ANTM.price;
    const limit = E.roundToTick(antm * 0.95, 'down');
    const limitOrder = E.placeOrder(demo, { symbol: 'ANTM', side: 'buy', type: 'limit', qty: 200, limitPrice: limit }, ctx({ respectHours: true }));
    if (limitOrder.result.ok) demo = limitOrder.state;
    const lessonAt = new Date(Date.now() - 2 * E.DAY_MS).toISOString();
    demo.learn.completed = {
      'four-markets': { at: lessonAt, score: 3, total: 3, xp: 80 },
      fees: { at: lessonAt, score: 2, total: 2, xp: 70 },
    };
    demo.learn.streak = { count: 3, lastDay: new Date().toISOString().slice(0, 10) };
    demo.community.posts = [{
      id: 'u-demo-1',
      room: 'lobby',
      handle: 'demo.investor',
      name: 'Demo investor',
      createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      text: 'First week practising in all four markets. The fee preview stopped me from flipping $XAU every day.',
      likes: 3,
      mine: true,
    }];
    demo.plan = { id: 'plus', since: new Date(Date.now() - 5 * E.DAY_MS).toISOString(), renewsAt: new Date(Date.now() + 25 * E.DAY_MS).toISOString() };
    return demo;
  }

  // ------------------------------------------------------------ self-test

  function runSelfTest() {
    const steps = [];
    const errors = [];
    const step = (name, fn) => {
      try {
        const detail = fn();
        steps.push({ name, ok: true, detail: detail == null ? null : detail });
      } catch (error) {
        steps.push({ name, ok: false, error: String(error && error.stack ? error.stack : error) });
        errors.push(`${name}: ${error && error.message ? error.message : error}`);
      }
    };
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const view = () => document.getElementById('view');
    const storedSummary = () => {
      try {
        return localStorage.getItem(SUMMARY_KEY);
      } catch (error) {
        return null;
      }
    };
    const summaryBefore = storedSummary();

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // ignore
    }
    state = null;

    step('onboarding renders', () => {
      render();
      assert(document.querySelector('.onboard'), 'onboarding missing');
      runtime.onboarding.step = 1;
      renderOnboarding();
      runtime.onboarding.step = 2;
      renderOnboarding();
      runtime.onboarding.answers = { goal: 2, horizon: 3, drawdown: 2, experience: 2, emergencyFund: true };
      runtime.onboarding.step = 3;
      renderOnboarding();
      assert(/Growth|Aggressive/.test(document.querySelector('.onboard').textContent), 'risk result missing');
    });

    step('finish onboarding', () => {
      finishOnboarding();
      assert(state && state.profile.onboarded, 'no state');
      state.settings.respectHours = false;
      return state.profile.risk.label;
    });

    const routeList = ['home', 'markets', 'markets/US', 'markets/IDX', 'markets/CRYPTO', 'markets/GOLD', 'asset/AAPL', 'asset/BBCA', 'asset/BTC', 'asset/XAU', 'portfolio', 'community', 'community/idx', 'community/dividend', 'desk', 'learn', 'me', 'plans', 'guide', 'risk']
      .concat(C.lessons.map((lesson) => `lesson/${lesson.id}`));
    for (const route of routeList) {
      step(`route #${route}`, () => {
        location.hash = `#${route}`;
        render();
        assert(view() && view().textContent.trim().length > 40, 'empty view');
      });
    }

    step('buy US by amount', () => {
      openTicket('VOO', 'buy');
      runtime.ticket.amount = '300000';
      renderTicketPreview();
      assert(!document.getElementById('ticket-confirm').disabled, 'confirm disabled');
      confirmTicket();
      assert(state.positions.VOO && state.positions.VOO.qty > 0, 'no VOO position');
      return state.positions.VOO.qty;
    });

    step('buy IDX lots', () => {
      openTicket('BBCA', 'buy');
      runtime.ticket.lots = '2';
      confirmTicket();
      assert(state.positions.BBCA.qty === 200, 'BBCA should be 200 shares');
    });

    step('ticket deep link', () => {
      assert(openLinkedTicket('?ticket=bbca&side=sell'), 'link did not open the ticket');
      assert(runtime.ticket.symbol === 'BBCA' && runtime.ticket.side === 'sell', 'wrong ticket');
      assert(document.getElementById('ticket-confirm'), 'ticket not rendered');
      closeModal();
      assert(!openLinkedTicket('?ticket=NOPE'), 'unknown symbol should be ignored');
      assert(!openLinkedTicket(''), 'missing symbol should be ignored');
    });

    step('market marks are drawn, not emoji', () => {
      location.hash = '#markets/US';
      render();
      const marks = view().querySelectorAll('.chips svg.micon');
      assert(marks.length === E.MARKET_ORDER.length, `expected ${E.MARKET_ORDER.length} chip marks, got ${marks.length}`);
      assert(view().querySelector('h1 svg.micon'), 'market heading mark missing');
      assert(!/[\u{1F1E6}-\u{1F1FF}\u{1FA99}]/u.test(document.body.innerHTML), 'flag or coin emoji still rendered');
    });

    step('IDX tick validation', () => {
      openTicket('BBCA', 'buy');
      runtime.ticket.type = 'limit';
      runtime.ticket.limit = String(runtime.prices.BBCA.price + 1);
      renderTicketPreview();
      assert(document.getElementById('ticket-confirm').disabled, 'off-tick limit should be rejected');
      closeModal();
    });

    step('limit order then cancel', () => {
      const limit = E.roundToTick(runtime.prices.BBCA.price * 0.8, 'down');
      const outcome = E.placeOrder(state, { symbol: 'BBCA', side: 'buy', type: 'limit', qty: 100, limitPrice: limit }, ctx());
      assert(outcome.result.ok, outcome.result.errors && outcome.result.errors[0]);
      state = outcome.state;
      const id = outcome.result.order.id;
      assert(E.availableCash(state) < state.wallet.cashIdr, 'cash not reserved');
      state = E.cancelOrder(state, id);
      assert(E.availableCash(state) === state.wallet.cashIdr, 'reservation not released');
    });

    step('crypto and gold buys', () => {
      for (const symbol of ['BTC', 'XAU']) {
        openTicket(symbol, 'buy');
        runtime.ticket.amount = '250000';
        confirmTicket();
        assert(state.positions[symbol], `no ${symbol} position`);
      }
    });

    step('sell half of VOO', () => {
      const before = state.positions.VOO.qty;
      openTicket('VOO', 'sell');
      runtime.ticket.mode = 'qty';
      runtime.ticket.qty = String(before / 2);
      confirmTicket();
      assert(Math.abs(state.positions.VOO.qty - before / 2) < 1e-6, 'half not sold');
      return state.realizedIdr;
    });

    step('portfolio adds up', () => {
      const value = E.portfolioValue(state, ctx());
      const sum = value.cashIdr + E.MARKET_ORDER.reduce((total, id) => total + value.byMarket[id], 0);
      assert(Math.abs(sum - value.totalIdr) < 1, 'totals mismatch');
      location.hash = '#portfolio';
      render();
      return Math.round(value.totalIdr);
    });

    step('community post and Scam Shield', () => {
      location.hash = '#community/lobby';
      render();
      runtime.draft = 'Join VIP grup, pasti cuan 10% per minggu! WA 081234567890';
      const before = state.community.posts.length;
      submitPost();
      assert(state.community.posts.length === before, 'scam post was accepted');
      runtime.draft = 'How do you think about the FX spread on $VOO?';
      submitPost();
      assert(state.community.posts.length === before + 1, 'clean post rejected');
    });

    step('members room locked on Free', () => {
      location.hash = '#community/dividend';
      render();
      assert(view().querySelector('.paywall'), 'paywall missing');
    });

    step('checkout Pro unlocks rooms and ideas', () => {
      actions['checkout-confirm']({ plan: 'pro' });
      location.hash = '#community/dividend';
      render();
      assert(!view().querySelector('.paywall'), 'room still locked');
      location.hash = '#desk';
      render();
      assert(view().querySelectorAll('[data-action="idea-ticket"]').length > 0, 'no idea tickets for Pro');
    });

    step('complete a lesson', () => {
      const lesson = C.lessons.find((item) => item.id === 'scam-shield');
      lesson.quiz.forEach((question, index) => {
        lessonState(lesson.id).answers[index] = question.answer;
      });
      completeLesson(lesson.id);
      assert(state.learn.completed['scam-shield'].score === lesson.quiz.length, 'score wrong');
      return E.totalXp(state);
    });

    step('widgets compute', () => {
      for (const lesson of C.lessons) {
        location.hash = `#lesson/${lesson.id}`;
        render();
        const html = widgetResultHtml(lesson.widget, lessonState(lesson.id).widget);
        if (['fee-calculator', 'lot-calculator', 'compound-slider', 'allocation', 'sizing-calculator', 'fx-calculator'].indexOf(lesson.widget) !== -1) {
          assert(/Rp|%/.test(html), `${lesson.widget} produced no result`);
        }
      }
    });

    step('simulated tick moves prices', () => {
      state.settings.dataMode = 'simulated';
      const before = SYMBOLS.map((symbol) => runtime.prices[symbol].raw);
      simTick();
      const moved = SYMBOLS.filter((symbol, index) => runtime.prices[symbol].raw !== before[index]).length;
      assert(moved === SYMBOLS.length, 'not every price moved');
      state.settings.dataMode = 'live';
      return moved;
    });

    step('demo state builds', () => {
      const demo = demoState();
      assert(Object.keys(demo.positions).length === 6, `demo positions: ${Object.keys(demo.positions).length}`);
      assert(demo.orders.some((order) => order.status === 'open'), 'demo limit order missing');
    });

    step('wallet summary for Twin matches the portfolio', () => {
      const summary = E.walletSummary(state, ctx());
      const value = E.portfolioValue(state, ctx());
      assert(summary.valueIdr === Math.round(value.totalIdr), 'summary value differs from the portfolio');
      assert(summary.positions === value.positions.length, 'position count differs');
      assert(storedSummary() === summaryBefore, "the self-test changed Twin's wallet summary");
      assert(!runtime.sync.enabled, 'the self-test must never sync');
      return summary.valueIdr;
    });

    step('wallet transfers: quote, ledger effect and transfer sheet', () => {
      const quote = E.quoteTransfer('usd_to_idr', 100, 16290);
      assert(quote.ok && quote.idr === 1620855 && quote.fee === 8145 && quote.basis === 1629000, `usd_to_idr quote ${JSON.stringify(quote)}`);
      const back = E.quoteTransfer('idr_to_usd', 1000000, 16290);
      assert(back.ok && back.usd === 61.08 && back.fee === 0.31 && back.basis === 61.39, `idr_to_usd quote ${JSON.stringify(back)}`);
      const before = E.portfolioValue(state, ctx());
      const applied = E.applyTransferToState(state, quote);
      assert(applied.ok, applied.error);
      const after = E.portfolioValue(applied.state, ctx());
      assert(Math.abs(after.totalIdr - before.totalIdr - 1620855) < 1, 'the rupiah total should grow by what arrived');
      assert(Math.abs(after.gainIdr - (before.gainIdr - 8145)) < 1, 'the spread should show as a cost, not a gain');
      assert(applied.state.transfers[0].direction === 'usd_to_idr', 'transfer not logged');
      location.hash = '#portfolio';
      render();
      assert(document.getElementById('wallets-card'), 'wallets card missing');
      runtime.usd = { kind: 'selftest', paper: { cash: 500, value: 650 }, checking: false, checkedAt: Date.now(), reason: '', error: '' };
      openTransfer('usd_to_idr');
      runtime.transfer.amount = '100';
      renderTransferPreview();
      assert(/You get/.test(document.getElementById('transfer-preview').textContent), 'transfer preview missing');
      assert(!document.getElementById('transfer-confirm').disabled, 'a $100 move should be allowed');
      runtime.transfer.amount = '900';
      renderTransferPreview();
      assert(document.getElementById('transfer-confirm').disabled, 'moving more than the USD cash must be blocked');
      actions['transfer-direction']({ value: 'idr_to_usd' });
      actions['transfer-fill']({ pct: '100' });
      assert(parseAmount(runtime.transfer.amount) === Math.floor(E.availableCash(state)), 'Max should fill the free rupiah cash');
      assert(parseUsd('1,000') === 1000 && parseUsd('12,5') === 12.5 && parseUsd('1.234,56') === 1234.56 && parseUsd('$1,234.56') === 1234.56, 'USD amount parsing');
      closeModal();
      assert(!runtime.transfer, 'closing the sheet should drop the draft');
      runtime.usd = { kind: null, paper: null, checking: false, checkedAt: 0, reason: '', error: '' };
      return quote.idr;
    });

    step('reset returns to onboarding', () => {
      actions.reset();
      assert(document.querySelector('.onboard'), 'not back to onboarding');
    });

    const report = { ok: errors.length === 0 && !window.__satuErrors.length, steps: steps.length, failed: steps.filter((item) => !item.ok), errors: errors.concat(window.__satuErrors) };
    const pre = document.createElement('pre');
    pre.id = 'selftest';
    pre.textContent = JSON.stringify(report);
    document.body.appendChild(pre);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // ignore
    }
  }


  // ------------------------------------------------------------- app updates (1.14)
  // update.js (shared with Twin) shows the "Update ready" banner; this row mirrors it on the Me screen.
  function updateState() {
    return (window.TwinUpdate && window.TwinUpdate.state) || { status: 'idle' };
  }

  function updateRowHtml() {
    const current = updateState();
    const text = window.TwinUpdate ? window.TwinUpdate.describeStatus(current, 'Twin') : 'Twin checks for updates automatically.';
    const busy = ['checking', 'downloading', 'updating', 'installing', 'restarting'].includes(current.status);
    const blocked = current.kind === 'server' && current.server && current.server.can_install === false;
    const canApply = current.status === 'ready' && !blocked;
    const applyLabel = current.kind === 'server' ? 'Update Twin on this computer' : current.message === 'elsewhere' ? 'Reload' : 'Update now';
    return `<p class="small muted" id="id-update-status">Twin ${esc(VERSION)} · ${esc(text)}</p>
          <div class="row wrap">
            <button class="btn small" data-action="update-check" id="id-update-check" ${busy ? 'disabled' : ''}>Check for updates</button>
            ${canApply ? `<button class="btn small primary" data-action="update-apply" id="id-update-apply">${esc(applyLabel)}</button>` : ''}
          </div>`;
  }

  function paintUpdateRow() {
    const row = document.getElementById('id-update');
    if (row) row.innerHTML = updateRowHtml();
  }

  function startUpdates() {
    if (!window.TwinUpdate) {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
      }
      return;
    }
    // One worker for all of Twin: Twin's own worker at the app root, shared update notice.
    window.TwinUpdate.init({
      version: VERSION,
      appName: 'Twin',
      swUrl: /^https?:$/.test(location.protocol) ? '../sw.js' : null,
      scope: '../',
      releaseUrl: '../release.json',
      apiBase: '../',
      serverMode: () => serverDetected(),
      isBusy: () => modalOpen(),
      offset: 76,
    });
    window.TwinUpdate.subscribe(paintUpdateRow);
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    window.__satuErrors = window.__satuErrors || [];
    seedPrices();
    bindEvents();
    state = load();
    if (DEMO && !state) {
      state = demoState();
      save();
    }
    if (SELFTEST) {
      runSelfTest();
      return;
    }
    render();
    startTimers();
    openLinkedTicket(location.search);
    maybeOpenTransferFromHash();
    if (!OFFLINE) {
      connectServer().then(refreshNews);
      if (!isSimulated()) refreshLive();
    }
    startUpdates();
  }

  window.addEventListener('error', (event) => {
    window.__satuErrors = window.__satuErrors || [];
    window.__satuErrors.push(String(event.message));
  });

  boot();
})();
