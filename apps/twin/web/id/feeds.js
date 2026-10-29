/* Twin Indonesia live-data adapters (codename Satu). Every loader resolves to null (never throws) when a
 * source is unreachable, so the app silently keeps its snapshot or simulation.
 *
 *   US + IDX stocks, USD/IDR, charts  -> Twin's hourly demo snapshot: ../demo on the
 *                                        same origin, else the published copy
 *   Crypto + gold                     -> CoinGecko public API (CORS *)
 *   News                              -> Twin's server (every feed) when it runs; else
 *                                        Twin news.json + Antara RSS (CORS *), with the
 *                                        other feeds baked into snapshot.js hourly
 *   Wallet sync                       -> Twin's server, signed-in Twin account only
 */
(function (root) {
  'use strict';

  // Inside Twin the demo snapshot sits next to this module, on the same origin and
  // refreshed by the same hourly job. Opened from disk, use the published copy.
  const TWIN_REMOTE = 'https://juw12.github.io/projects/twin/demo';
  const TWIN_BASES = Array.from(new Set(
    typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
      ? [new URL('../demo', location.href).href, TWIN_REMOTE]
      : [TWIN_REMOTE]
  ));
  const TWIN_BASE = TWIN_BASES[0];
  const COINGECKO = 'https://api.coingecko.com/api/v3';
  const ANTARA_RSS = 'https://www.antaranews.com/rss/ekonomi-bursa.xml';
  const GRAMS_PER_TROY_OUNCE = 31.1034768;
  const chartCache = new Map();

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || 12000) : null;
    try {
      const response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}, controller ? { signal: controller.signal } : {}));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchJson(url, timeoutMs) {
    const response = await fetchWithTimeout(url, null, timeoutMs);
    return response.json();
  }

  /** Twin server API next to this module (web/id/ is served from Twin's root). */
  function serverUrl(path) {
    return new URL(`../${path}`, location.href).href;
  }

  /** POST to Twin's server with the session cookie. Resolves {status, data}, or null when
   *  the server can't be reached. HTTP errors such as 401 resolve too, so callers can tell
   *  "signed out" from "offline". */
  async function postServer(path, body, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || 15000) : null;
    try {
      const response = await fetch(serverUrl(path), Object.assign({
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      }, controller ? { signal: controller.signal } : {}));
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      return { status: response.status, data };
    } catch (error) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** First Twin data file that loads, trying the same-origin copy first. */
  async function fetchTwinJson(path, timeoutMs) {
    let lastError = null;
    for (const base of TWIN_BASES) {
      try {
        return await fetchJson(`${base}/${path}`, timeoutMs);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Twin data unavailable');
  }

  function twinChartName(symbol) {
    return symbol.replace('^', '_') + '.json';
  }

  /** Stocks + FX from Twin's world.json. */
  async function loadStocks(instruments) {
    try {
      const world = await fetchTwinJson('world.json');
      const prices = {};
      for (const instrument of instruments) {
        if (!instrument.twin) continue;
        const quote = world.quotes[instrument.twin];
        if (!quote || !(quote.price > 0)) continue;
        prices[instrument.symbol] = {
          price: quote.price,
          prev: quote.prev || quote.price,
          changePct: quote.change_pct || 0,
          dayHigh: quote.day_high,
          dayLow: quote.day_low,
          high52: quote.high52,
          low52: quote.low52,
          volume: quote.volume,
          time: quote.time ? quote.time * 1000 : null,
          spark: Array.isArray(quote.spark) ? quote.spark : null,
          source: 'Yahoo Finance via Twin · delayed',
        };
      }
      const benchmarks = {};
      for (const symbol of ['^JKSE', '^GSPC']) {
        if (world.quotes[symbol]) benchmarks[symbol] = world.quotes[symbol].price;
      }
      const usdPerIdr = world.fx_usd && world.fx_usd.IDR;
      return {
        prices,
        benchmarks,
        fxRate: usdPerIdr ? 1 / usdPerIdr : null,
        fxAsOf: world.fx_as_of ? world.fx_as_of * 1000 : null,
        takenAt: world.snapshot_taken || null,
      };
    } catch (error) {
      return null;
    }
  }

  /** Crypto + gold (per gram) from one batched CoinGecko call. */
  async function loadCrypto(instruments) {
    const coins = instruments.filter((instrument) => instrument.cg);
    if (!coins.length) return null;
    try {
      const ids = coins.map((instrument) => instrument.cg).join(',');
      const rows = await fetchJson(
        `${COINGECKO}/coins/markets?vs_currency=idr&ids=${ids}&sparkline=true&price_change_percentage=24h`
      );
      const byId = {};
      for (const row of rows) byId[row.id] = row;
      const prices = {};
      for (const instrument of coins) {
        const row = byId[instrument.cg];
        if (!row || !(row.current_price > 0)) continue;
        const scale = instrument.market === 'GOLD' ? GRAMS_PER_TROY_OUNCE : 1;
        const price = row.current_price / scale;
        const change = row.price_change_percentage_24h || 0;
        const week = (row.sparkline_in_7d && row.sparkline_in_7d.price) || [];
        const lastDay = week.slice(-24).map((value) => value / scale);
        prices[instrument.symbol] = {
          price,
          prev: price / (1 + change / 100),
          changePct: change,
          dayHigh: row.high_24h ? row.high_24h / scale : null,
          dayLow: row.low_24h ? row.low_24h / scale : null,
          time: row.last_updated ? Date.parse(row.last_updated) : Date.now(),
          spark: lastDay.length > 2 ? lastDay.filter((_, index) => index % 2 === 0 || index === lastDay.length - 1) : null,
          source: instrument.market === 'GOLD' ? 'CoinGecko XAUT ÷ 31.1035 g' : 'CoinGecko',
        };
      }
      return { prices };
    } catch (error) {
      return null;
    }
  }

  const COINGECKO_DAYS = { '1D': 1, '1W': 7, '1M': 30, '1Y': 365, '5Y': 1825 };

  /** Chart points [[unixSeconds, price], ...] for a range, cached per session. */
  async function loadChart(instrument, range) {
    const key = `${instrument.symbol}|${range}`;
    if (chartCache.has(key)) return chartCache.get(key);
    let points = null;
    try {
      if (instrument.twin) {
        const chart = await fetchTwinJson(`world/${twinChartName(instrument.twin)}`);
        for (const [name, block] of Object.entries(chart)) {
          if (block && Array.isArray(block.points)) {
            chartCache.set(`${instrument.symbol}|${name}`, block.points);
          }
        }
        points = chartCache.get(key) || null;
      } else if (instrument.cg) {
        const days = COINGECKO_DAYS[range] || 30;
        const payload = await fetchJson(
          `${COINGECKO}/coins/${instrument.cg}/market_chart?vs_currency=idr&days=${days}${days > 90 ? '&interval=daily' : ''}`
        );
        const scale = instrument.market === 'GOLD' ? GRAMS_PER_TROY_OUNCE : 1;
        points = (payload.prices || []).map(([ms, price]) => [Math.floor(ms / 1000), price / scale]);
        chartCache.set(key, points);
      }
    } catch (error) {
      points = null;
    }
    return points && points.length > 1 ? points : null;
  }

  // ------------------------------------------------------------------ news

  const CRYPTO_WORDS = {
    BTC: /\b(bitcoin|btc)\b/i,
    ETH: /\b(ethereum|ether|eth)\b/i,
    SOL: /\bsolana\b|\bSOL\b/,
    BNB: /\b(bnb|binance coin)\b/i,
    XRP: /\b(xrp|ripple)\b/i,
    DOGE: /\b(dogecoin|doge)\b/i,
  };

  function tagTickers(text, market, knownByMarket) {
    const found = [];
    const add = (symbol) => {
      if (found.indexOf(symbol) === -1) found.push(symbol);
    };
    for (const code of knownByMarket.IDX || []) {
      if (new RegExp(`\\b${code}\\b`).test(text)) add(code);
    }
    for (const ticker of knownByMarket.US || []) {
      const pattern = ticker.length <= 2 ? new RegExp(`(\\$${ticker}\\b|\\(${ticker}\\))`) : new RegExp(`(\\$|\\b)${ticker}\\b`);
      if (pattern.test(text)) add(ticker);
    }
    for (const [symbol, pattern] of Object.entries(CRYPTO_WORDS)) {
      if (pattern.test(text)) add(symbol);
    }
    if (market === 'GOLD' || /\b(gold|emas|bullion)\b/i.test(text)) {
      if (market === 'GOLD' || market === 'IDX') add('XAU');
    }
    return found;
  }

  function cleanText(raw, limit) {
    const holder = document.createElement('div');
    holder.innerHTML = String(raw || '');
    const value = (holder.textContent || '').replace(/\s+/g, ' ').trim();
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  }

  async function loadAntara(knownByMarket) {
    try {
      const response = await fetchWithTimeout(ANTARA_RSS, null, 10000);
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      return Array.from(xml.querySelectorAll('item'))
        .slice(0, 10)
        .map((node) => {
          const title = cleanText(node.querySelector('title') && node.querySelector('title').textContent, 200);
          const link = (node.querySelector('link') && node.querySelector('link').textContent.trim()) || '';
          const summary = cleanText(node.querySelector('description') && node.querySelector('description').textContent, 240);
          const pub = node.querySelector('pubDate') && node.querySelector('pubDate').textContent;
          return {
            id: `antara:${link}`,
            source: 'Antara',
            title,
            summary,
            link,
            time: pub ? new Date(pub).toISOString() : null,
            market: 'IDX',
            tickers: tagTickers(`${title} ${summary}`, 'IDX', knownByMarket),
          };
        })
        .filter((item) => item.title && /^https?:\/\//.test(item.link));
    } catch (error) {
      return [];
    }
  }

  async function loadTwinNews(knownByMarket) {
    try {
      const payload = await fetchTwinJson('news.json');
      return (payload.items || [])
        .filter((item) => item.title && /^https?:\/\//.test(item.link || ''))
        .slice(0, 12)
        .map((item) => ({
          id: `twin:${item.id || item.link}`,
          source: item.source || 'Yahoo Finance',
          title: cleanText(item.title, 200),
          summary: cleanText(item.summary, 240),
          link: item.link,
          time: item.time || null,
          market: 'US',
          tickers: (item.touches || [item.ticker]).filter((ticker) => (knownByMarket.US || []).indexOf(ticker) !== -1),
        }));
    } catch (error) {
      return [];
    }
  }

  /** Twin's server reads every feed (all markets); otherwise the CORS-friendly sources. */
  async function loadNews(serverAvailable, knownByMarket) {
    if (serverAvailable) {
      const result = await postServer('api/indonesia/news', {}, 20000);
      const payload = result && result.status === 200 ? result.data : null;
      if (payload && Array.isArray(payload.items) && payload.items.length) {
        return { items: payload.items, source: 'server', fetchedAt: payload.fetchedAt || null };
      }
    }
    const [us, idx] = await Promise.all([loadTwinNews(knownByMarket), loadAntara(knownByMarket)]);
    const items = us.concat(idx);
    return items.length ? { items, source: 'browser' } : null;
  }

  /** True when this page is served by Twin's own server (python server.py), which adds
   *  the full news feed and account sync. Static hosts (GitHub Pages) and file:// skip
   *  the probe entirely. */
  async function detectServer() {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
    if (/\.github\.io$/.test(location.hostname)) return false;
    try {
      const health = await fetchJson(serverUrl('api/health'), 5000);
      return !!health && (health.app === 'twin' || health.app === 'trade-twin');
    } catch (error) {
      return false;
    }
  }

  /** The signed-in account's wallet: {status, data:{wallet, rev, account, savedAt}} or null. */
  function loadWallet() {
    return postServer('api/indonesia/wallet', {}, 15000);
  }

  /** Save the wallet on top of revision `rev`; data.conflict means another device saved first. */
  function saveWallet(state, rev) {
    return postServer('api/indonesia/wallet/save', { state, rev }, 20000);
  }

  root.SatuFeeds = {
    TWIN_BASE,
    TWIN_BASES,
    loadStocks,
    loadCrypto,
    loadChart,
    loadNews,
    detectServer,
    loadWallet,
    saveWallet,
    tagTickers,
  };
})(typeof window !== 'undefined' ? window : globalThis);
