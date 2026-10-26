/* Twin Global (1.4): any stock, any exchange, any home currency.
 *
 * - Exchange metadata from Yahoo-style suffixes (7203.T, BBCA.JK, VOD.L …): country, flag,
 *   time zone, regular session hours and currency. Market open/closed status uses real exchange
 *   calendars (holidays, early closes, lunch breaks) from demo/calendars.json.
 * - Universal search (live server: every Yahoo listing; web demo: the bundled global snapshot).
 * - World markets screen, Home search bar + world strip, stock-page listing panel,
 *   portfolio exposure by country and currency, and a display-currency preference.
 * Practice cash stays in US dollars; foreign prices convert at the delayed FX rate.
 */
"use strict";

const TwinGlobal = (() => {
  // suffix: [country, exchange, IANA zone, open, close, currency, lunchStart, lunchEnd, weekdays]
  const MON_FRI = [1, 2, 3, 4, 5];
  const SUN_THU = [0, 1, 2, 3, 4];
  const EXCHANGES = {
    "": ["US", "NYSE / Nasdaq", "America/New_York", "09:30", "16:00", "USD"],
    TO: ["CA", "Toronto", "America/Toronto", "09:30", "16:00", "CAD"],
    V: ["CA", "TSX Venture", "America/Toronto", "09:30", "16:00", "CAD"],
    NE: ["CA", "Cboe Canada", "America/Toronto", "09:30", "16:00", "CAD"],
    SA: ["BR", "B3 São Paulo", "America/Sao_Paulo", "10:00", "17:00", "BRL"],
    MX: ["MX", "Mexico", "America/Mexico_City", "08:30", "15:00", "MXN"],
    L: ["GB", "London", "Europe/London", "08:00", "16:30", "GBP"],
    IR: ["IE", "Dublin", "Europe/Dublin", "08:00", "16:30", "EUR"],
    DE: ["DE", "Xetra", "Europe/Berlin", "09:00", "17:30", "EUR"],
    F: ["DE", "Frankfurt", "Europe/Berlin", "08:00", "20:00", "EUR"],
    PA: ["FR", "Euronext Paris", "Europe/Paris", "09:00", "17:30", "EUR"],
    AS: ["NL", "Euronext Amsterdam", "Europe/Amsterdam", "09:00", "17:30", "EUR"],
    BR: ["BE", "Euronext Brussels", "Europe/Brussels", "09:00", "17:30", "EUR"],
    LS: ["PT", "Euronext Lisbon", "Europe/Lisbon", "08:00", "16:30", "EUR"],
    MI: ["IT", "Milan", "Europe/Rome", "09:00", "17:30", "EUR"],
    MC: ["ES", "Madrid", "Europe/Madrid", "09:00", "17:30", "EUR"],
    VI: ["AT", "Vienna", "Europe/Vienna", "09:00", "17:30", "EUR"],
    SW: ["CH", "SIX Swiss", "Europe/Zurich", "09:00", "17:30", "CHF"],
    ST: ["SE", "Stockholm", "Europe/Stockholm", "09:00", "17:30", "SEK"],
    CO: ["DK", "Copenhagen", "Europe/Copenhagen", "09:00", "17:00", "DKK"],
    HE: ["FI", "Helsinki", "Europe/Helsinki", "10:00", "18:30", "EUR"],
    OL: ["NO", "Oslo", "Europe/Oslo", "09:00", "16:20", "NOK"],
    WA: ["PL", "Warsaw", "Europe/Warsaw", "09:00", "17:00", "PLN"],
    IS: ["TR", "Borsa Istanbul", "Europe/Istanbul", "10:00", "18:00", "TRY"],
    T: ["JP", "Tokyo", "Asia/Tokyo", "09:00", "15:30", "JPY", "11:30", "12:30"],
    HK: ["HK", "Hong Kong", "Asia/Hong_Kong", "09:30", "16:00", "HKD", "12:00", "13:00"],
    SS: ["CN", "Shanghai", "Asia/Shanghai", "09:30", "15:00", "CNY", "11:30", "13:00"],
    SZ: ["CN", "Shenzhen", "Asia/Shanghai", "09:30", "15:00", "CNY", "11:30", "13:00"],
    TW: ["TW", "Taiwan", "Asia/Taipei", "09:00", "13:30", "TWD"],
    TWO: ["TW", "Taipei Exchange", "Asia/Taipei", "09:00", "13:30", "TWD"],
    KS: ["KR", "Korea (KOSPI)", "Asia/Seoul", "09:00", "15:30", "KRW"],
    KQ: ["KR", "Korea (KOSDAQ)", "Asia/Seoul", "09:00", "15:30", "KRW"],
    NS: ["IN", "NSE India", "Asia/Kolkata", "09:15", "15:30", "INR"],
    BO: ["IN", "BSE India", "Asia/Kolkata", "09:15", "15:30", "INR"],
    JK: ["ID", "Indonesia (IDX)", "Asia/Jakarta", "09:00", "16:00", "IDR", "12:00", "13:30"],
    SI: ["SG", "Singapore", "Asia/Singapore", "09:00", "17:00", "SGD", "12:00", "13:00"],
    KL: ["MY", "Bursa Malaysia", "Asia/Kuala_Lumpur", "09:00", "17:00", "MYR", "12:30", "14:30"],
    BK: ["TH", "Thailand (SET)", "Asia/Bangkok", "10:00", "16:30", "THB", "12:30", "14:30"],
    PS: ["PH", "Philippines", "Asia/Manila", "09:30", "15:00", "PHP", "12:00", "13:00"],
    AX: ["AU", "ASX", "Australia/Sydney", "10:00", "16:00", "AUD"],
    NZ: ["NZ", "NZX", "Pacific/Auckland", "10:00", "16:45", "NZD"],
    JO: ["ZA", "Johannesburg", "Africa/Johannesburg", "09:00", "17:00", "ZAR"],
    SR: ["SA", "Saudi (Tadawul)", "Asia/Riyadh", "10:00", "15:00", "SAR", null, null, SUN_THU],
    QA: ["QA", "Qatar", "Asia/Qatar", "09:30", "13:15", "QAR", null, null, SUN_THU],
    AE: ["AE", "Abu Dhabi", "Asia/Dubai", "10:00", "15:00", "AED"],
    TA: ["IL", "Tel Aviv", "Asia/Jerusalem", "10:00", "17:25", "ILS"],
  };
  const INDEX_HOME = {
    "^GSPC": "", "^IXIC": "", "^DJI": "", "^GSPTSE": "TO", "^BVSP": "SA", "^FTSE": "L", "^GDAXI": "DE",
    "^FCHI": "PA", "^STOXX50E": "DE", "^N225": "T", "^HSI": "HK", "000001.SS": "SS", "^KS11": "KS",
    "^TWII": "TW", "^NSEI": "NS", "^JKSE": "JK", "^STI": "SI", "^AXJO": "AX", "^TASI.SR": "SR",
  };
  const REGIONS = {
    Americas: ["US", "CA", "BR", "MX"],
    Europe: ["GB", "IE", "DE", "FR", "NL", "BE", "PT", "IT", "ES", "AT", "CH", "SE", "DK", "FI", "NO", "PL", "TR", "EU"],
    "Asia-Pacific": ["JP", "HK", "CN", "TW", "KR", "IN", "ID", "SG", "MY", "TH", "PH", "AU", "NZ", "VN"],
    "Middle East & Africa": ["SA", "QA", "AE", "IL", "ZA"],
  };
  const COUNTRY = {
    US: "United States", CA: "Canada", BR: "Brazil", MX: "Mexico", GB: "United Kingdom", IE: "Ireland",
    DE: "Germany", FR: "France", NL: "Netherlands", BE: "Belgium", PT: "Portugal", IT: "Italy", ES: "Spain",
    AT: "Austria", CH: "Switzerland", SE: "Sweden", DK: "Denmark", FI: "Finland", NO: "Norway", PL: "Poland",
    TR: "Türkiye", EU: "Eurozone", JP: "Japan", HK: "Hong Kong", CN: "China", TW: "Taiwan", KR: "South Korea",
    IN: "India", ID: "Indonesia", SG: "Singapore", MY: "Malaysia", TH: "Thailand", PH: "Philippines",
    AU: "Australia", NZ: "New Zealand", VN: "Vietnam", SA: "Saudi Arabia", QA: "Qatar", AE: "UAE",
    IL: "Israel", ZA: "South Africa",
  };
  const DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "HKD", "SGD", "IDR", "INR", "KRW", "AUD", "CAD",
    "CHF", "MYR", "THB", "PHP", "VND", "TWD", "BRL", "MXN", "ZAR", "SAR", "AED"];
  const DOLLAR_FAMILY = new Set(["CAD", "AUD", "HKD", "SGD", "NZD", "TWD", "MXN", "BRL"]);
  const WHOLE_UNITS = new Set(["JPY", "KRW", "IDR", "VND", "CLP", "HUF", "ISK"]);
  const DISPLAY_KEY = "twin-display-currency";
  const RECENT_KEY = "twin-recent-searches";
  const infoCache = {};
  let worldPromise = null;
  let fxTable = { USD: 1 };
  let worldFxAsOf = null;
  function setFxTime(stamp) {
    if (!stamp) {
      return;
    }
    const when = new Date(typeof stamp === "number" ? stamp * 1000 : String(stamp).replace(" UTC", "Z").replace(" ", "T"));
    if (Number.isNaN(when.getTime())) {
      return;
    }
    const sameDay = when.toDateString() === new Date().toDateString();
    worldFxAsOf = when.toLocaleString([], sameDay ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  // ------------------------------------------------------------------ listings
  function suffixOf(symbol) {
    const s = String(symbol || "").toUpperCase();
    if (Object.prototype.hasOwnProperty.call(INDEX_HOME, s)) {
      return INDEX_HOME[s];
    }
    const dot = s.lastIndexOf(".");
    if (dot > 0) {
      const tail = s.slice(dot + 1);
      if (EXCHANGES[tail]) {
        return tail;
      }
    }
    return "";
  }

  function listing(symbol) {
    const suffix = suffixOf(symbol);
    const [country, exchange, zone, open, close, currency, lunchStart, lunchEnd, days] = EXCHANGES[suffix];
    const isIndex = String(symbol).startsWith("^") || Object.prototype.hasOwnProperty.call(INDEX_HOME, String(symbol).toUpperCase());
    const shownCountry = String(symbol).toUpperCase() === "^STOXX50E" ? "EU" : country;
    return {
      suffix, country: shownCountry, countryName: COUNTRY[shownCountry] || shownCountry, exchange, zone, open, close,
      currency, lunchStart, lunchEnd, days: days || MON_FRI, us: suffix === "" && !isIndex, isIndex,
      flag: flag(shownCountry),
    };
  }

  function flag(code) {
    if (!code || code.length !== 2) {
      return "🌐";
    }
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  function regionOf(country) {
    return Object.keys(REGIONS).find((name) => REGIONS[name].includes(country)) || "Other";
  }

  // ------------------------------------------------------------ market clock
  // Real exchange calendars (holidays, early closes, session hours) from demo/calendars.json,
  // built with the open-source exchange_calendars package. Until it loads, or for dates past
  // its window, the hand-written weekday/hours table above is used.
  let CAL = null;
  let calPromise = null;
  function loadCalendars() {
    if (!calPromise) {
      calPromise = fetch("demo/calendars.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          CAL = data && data.exchanges ? data : null;
          return CAL;
        })
        .catch(() => null);
    }
    return calPromise;
  }

  function localParts(date, zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return {
      dow, ymd: `${get("year")}-${get("month")}-${get("day")}`,
      minutes: Number(get("hour")) * 60 + Number(get("minute")), label: `${get("hour")}:${get("minute")}`,
    };
  }

  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const span = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function addDays(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return { ymd: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
  }

  function calendarFor(info) {
    return CAL && CAL.exchanges ? CAL.exchanges[info.suffix] || null : null;
  }

  // The regular session on a local date, or null (weekend / holiday). `known` = calendar covered it.
  function sessionOn(info, cal, ymd, dow) {
    const covered = cal && ymd <= cal.valid_to && (!CAL.valid_from || ymd >= CAL.valid_from);
    if (covered) {
      // exchange_calendars weekmask starts on Monday.
      const tradingDay = cal.weekmask[(dow + 6) % 7] === "1";
      if (!tradingDay) {
        return { known: true, session: null };
      }
      if (cal.holidays.includes(ymd)) {
        return { known: true, session: null, holiday: true };
      }
      const open = (cal.late_open && cal.late_open[ymd]) || cal.open;
      const close = (cal.early_close && cal.early_close[ymd]) || cal.close;
      const lunchPair = cal.lunch || (info.lunchStart ? [info.lunchStart, info.lunchEnd] : null);
      const lunch = lunchPair && toMinutes(lunchPair[0]) < toMinutes(close) ? lunchPair : null;
      return {
        known: true,
        session: { open, close, lunch, early: Boolean(cal.early_close && cal.early_close[ymd]) },
      };
    }
    if (!info.days.includes(dow)) {
      return { known: false, session: null };
    }
    const lunch = info.lunchStart ? [info.lunchStart, info.lunchEnd] : null;
    return { known: false, session: { open: info.open, close: info.close, lunch, early: false } };
  }

  function marketStatus(symbol, now = new Date()) {
    const info = listing(symbol);
    const cal = calendarFor(info);
    const zone = (cal && cal.tz) || info.zone;
    const local = localParts(now, zone);
    const m = local.minutes;
    const today = sessionOn(info, cal, local.ymd, local.dow);
    const base = { localTime: local.label, calendar: Boolean(cal), holidaysKnown: today.known };
    if (today.session) {
      const open = toMinutes(today.session.open);
      const close = toMinutes(today.session.close);
      const lunch = today.session.lunch ? today.session.lunch.map(toMinutes) : null;
      if (m >= open && m < close) {
        if (lunch && m >= lunch[0] && m < lunch[1]) {
          return { ...base, open: false, lunch: true, text: `Lunch break · reopens in ${span(lunch[1] - m)}` };
        }
        const until = lunch && m < lunch[0] ? lunch[0] : close;
        const what = until === close ? (today.session.early ? `closes early (${today.session.close})` : "closes") : "lunch";
        return { ...base, open: true, early: today.session.early, text: `Open · ${what} in ${span(until - m)}` };
      }
    }
    for (let d = 0; d < 15; d += 1) {
      const day = addDays(local.ymd, d);
      const next = sessionOn(info, cal, day.ymd, day.dow);
      if (!next.session) {
        continue;
      }
      const open = toMinutes(next.session.open);
      if (d === 0 && m >= open) {
        continue;
      }
      const wait = d * 1440 + open - m;
      const when = d === 0 ? "" : d === 1 ? " tomorrow" : ` ${DOW[day.dow]}`;
      const why = today.holiday ? "Closed · holiday" : "Closed";
      return { ...base, open: false, holiday: Boolean(today.holiday), text: `${why} · opens${when} ${next.session.open} (in ${span(wait)})` };
    }
    return { ...base, open: false, holiday: Boolean(today.holiday), text: today.holiday ? "Closed · holiday" : "Closed" };
  }

  // Upcoming market holidays for an exchange (for the listing panel).
  function upcomingHolidays(symbol, count = 3, now = new Date()) {
    const info = listing(symbol);
    const cal = calendarFor(info);
    if (!cal) {
      return [];
    }
    const today = localParts(now, cal.tz || info.zone).ymd;
    return cal.holidays.filter((d) => d >= today).slice(0, count);
  }

  // ------------------------------------------------------------- currencies
  function money(value, currency = "USD", opts = {}) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "—";
    }
    const n = Number(value);
    const abs = Math.abs(n);
    let digits = opts.digits;
    if (digits === undefined) {
      digits = WHOLE_UNITS.has(currency) && abs >= 100 ? 0 : abs > 0 && abs < 1 ? 4 : 2;
    }
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency", currency,
        currencyDisplay: DOLLAR_FAMILY.has(currency) || currency === "USD" ? "symbol" : "narrowSymbol",
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(n);
    } catch (error) {
      return `${n.toFixed(digits)} ${currency}`;
    }
  }

  function remember(q) {
    if (q && q.symbol) {
      infoCache[q.symbol] = {
        currency: q.currency || listing(q.symbol).currency, fx_usd: q.fx_usd, name: q.name, exchange: q.exchange,
      };
      if (q.currency && q.fx_usd) {
        fxTable[q.currency] = q.fx_usd;
      }
    }
    return q;
  }

  function info(symbol) {
    const cached = infoCache[symbol] || {};
    const currency = cached.currency || listing(symbol).currency;
    const fx = cached.fx_usd || fxTable[currency] || (currency === "USD" ? 1 : null);
    return { currency, fx_usd: fx, name: cached.name, exchange: cached.exchange };
  }

  function displayCurrency() {
    try {
      return localStorage.getItem(DISPLAY_KEY) || "USD";
    } catch (error) {
      return "USD";
    }
  }

  function setDisplayCurrency(code) {
    try {
      localStorage.setItem(DISPLAY_KEY, code);
    } catch (error) {
      /* storage blocked: preference lasts for this page only */
    }
    window.dispatchEvent(new CustomEvent("twin-currency-change", { detail: code }));
  }

  async function ensureFx() {
    const missing = DISPLAY_CURRENCIES.filter((c) => !fxTable[c]);
    if (!missing.length) {
      return fxTable;
    }
    const result = await api("api/fx", { currencies: missing }).catch(() => null);
    if (result && result.ok) {
      fxTable = { ...result.fx_usd, ...fxTable };
      setFxTime(result.as_of);
    }
    return fxTable;
  }

  // US dollars → user's display currency (string), or null when it is USD / rate unknown.
  function inDisplay(usd) {
    const code = displayCurrency();
    if (code === "USD" || !fxTable[code] || usd === null || usd === undefined) {
      return null;
    }
    return money(usd / fxTable[code], code);
  }

  // --------------------------------------------------------------- data
  function world() {
    if (!worldPromise) {
      worldPromise = api("api/world", {}).then((result) => {
        if (!result.ok) {
          worldPromise = null;
          throw new Error(result.error || "World markets unavailable");
        }
        Object.values(result.quotes || {}).forEach(remember);
        fxTable = { ...result.fx_usd, ...fxTable };
        setFxTime(result.fx_as_of || result.as_of);
        return result;
      });
    }
    return worldPromise;
  }

  function usListingFor(symbol) {
    return world().then((data) => {
      const item = data.universe.find((u) => u.symbol === symbol);
      return item ? item.us_listing : null;
    }).catch(() => null);
  }

  function recent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 8);
    } catch (error) {
      return [];
    }
  }

  function addRecent(row) {
    try {
      const list = [row, ...recent().filter((r) => r.symbol !== row.symbol)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (error) {
      /* ignore */
    }
  }

  // --------------------------------------------------------------- UI bits
  function spark(values, up) {
    if (!values || values.length < 2) {
      return h("span");
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pts = values.map((v, i) => `${(100 * i / (values.length - 1)).toFixed(1)},${(28 - 26 * (v - lo) / ((hi - lo) || 1)).toFixed(1)}`).join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 30");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "g-spark " + (up ? "up" : "down"));
    svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    return svg;
  }

  function statusDot(symbol) {
    const status = marketStatus(symbol);
    return h("span", { class: "g-dot" + (status.open ? " open" : ""), title: status.text });
  }

  function pct(value) {
    return h("span", { class: "g-pct " + signClass(value) }, fmtPct(value));
  }

  function openSymbol(symbol, row) {
    if (row) {
      addRecent({ symbol: row.symbol, name: row.name, exchange: row.exchange });
    }
    closeSheet();
    setTimeout(() => openStockPro(symbol), 60);
  }

  function resultRow(row) {
    const info = listing(row.symbol);
    return h("button", { class: "g-row", "data-symbol": row.symbol, onclick: () => openSymbol(row.symbol, row) },
      h("span", { class: "g-flag" }, row.type === "Index" ? "📊" : info.flag),
      h("span", { class: "g-row-main" },
        h("b", {}, row.name || row.symbol),
        h("span", { class: "tiny muted" }, `${row.symbol} · ${row.exchange || info.exchange}`)),
      h("span", { class: "pill " + (row.type === "ETF" ? "blue" : row.type === "Index" ? "amber" : "green") }, row.type || "Stock"));
  }

  // --------------------------------------------------------- universal search
  function openSearch(initial = "") {
    const input = h("input", {
      id: "g-search-input", type: "search", placeholder: "Company, ticker or country — e.g. Toyota, BBCA, India",
      autocomplete: "off", autocapitalize: "none", spellcheck: "false", value: initial,
    });
    let region = "All";
    let lastResults = [];
    let timer = null;
    let token = 0;
    const chips = h("div", { class: "chips g-regions" });
    const list = h("div", { class: "g-list", id: "g-search-results" });
    const foot = h("p", { class: "tiny muted", style: "margin-top:10px" });

    const drawChips = () => chips.replaceChildren(...["All", ...Object.keys(REGIONS)].map((name) => h("button", {
      class: "chip" + (region === name ? " on" : ""),
      onclick: () => {
        region = name;
        drawChips();
        render(lastResults);
      },
    }, name)));

    const inRegion = (row) => region === "All" || regionOf(listing(row.symbol).country) === region;

    const render = (rows) => {
      const shown = rows.filter(inRegion);
      list.replaceChildren(...(shown.length ? shown.map(resultRow)
        : [h("p", { class: "muted small", style: "padding:12px 4px" }, input.value.trim()
          ? `No matches${region === "All" ? "" : " in " + region}.`
          : "Type to search.")]));
    };

    const popular = async () => {
      const recents = recent();
      const blocks = [];
      if (recents.length) {
        blocks.push(h("div", { class: "g-sub" }, "Recent"), ...recents.map((r) => resultRow({ ...r, type: r.symbol.startsWith("^") ? "Index" : "Stock" })));
      }
      try {
        const data = await world();
        const picks = [];
        for (const name of Object.keys(REGIONS)) {
          if (region !== "All" && region !== name) {
            continue;
          }
          picks.push(...data.universe.filter((u) => REGIONS[name].includes(u.country)).slice(0, region === "All" ? 3 : 12));
        }
        blocks.push(h("div", { class: "g-sub" }, region === "All" ? "Popular around the world" : `Popular in ${region}`),
          ...picks.map((u) => resultRow({ symbol: u.symbol, name: u.name, exchange: (data.quotes[u.symbol] || {}).exchange, type: "Stock" })));
      } catch (error) {
        /* world list unavailable: keep recents only */
      }
      list.replaceChildren(...blocks);
    };

    const run = async () => {
      const q = input.value.trim();
      const mine = ++token;
      if (!q) {
        lastResults = [];
        foot.textContent = "";
        popular();
        return;
      }
      list.replaceChildren(spinner("Searching…"));
      const result = await api("api/search", { q }).catch((error) => ({ ok: false, error: error.message }));
      if (mine !== token) {
        return;
      }
      if (!result.ok) {
        list.replaceChildren(errorBox(result.error || "Search failed"));
        return;
      }
      lastResults = result.results || [];
      render(lastResults);
      foot.textContent = result.snapshot
        ? "Web demo: searches the bundled snapshot (US + ~55 large companies on 25+ exchanges). Run Twin on your computer to search every listing Yahoo Finance covers — dozens of exchanges worldwide."
        : "Delayed data from Yahoo Finance. Twin practice trades work for any listing; prices convert to US dollars at the delayed FX rate.";
    };

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(run, 220);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = list.querySelector(".g-row");
        if (first) {
          first.click();
        }
      }
    });
    drawChips();
    openSheet(
      h("div", { class: "g-search-head" }, h("span", { class: "g-search-icon" }, "🔍"), input),
      chips, list, foot,
    );
    setTimeout(() => input.focus(), 80);
    run();
  }

  // ---------------------------------------------------------- world markets
  function heatColor(change) {
    if (!Number.isFinite(change)) {
      return "var(--card2)";
    }
    const strength = Math.min(1, Math.abs(change) / 3);
    const alpha = (0.18 + 0.6 * strength).toFixed(2);
    return change >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`;
  }

  async function openWorld() {
    const body = h("div", {}, spinner("Loading world markets…"));
    openSheet(h("div", { class: "between" }, h("h2", { style: "margin:0" }, "🌍 World markets"),
      h("button", { class: "btn small ghost", onclick: () => openSearch() }, "🔍 Search")), body);
    let data;
    try {
      data = await world();
    } catch (error) {
      body.replaceChildren(errorBox(error.message));
      return;
    }
    let region = "All";
    const content = h("div");
    const seg = h("div", { class: "seg g-seg" });
    const draw = () => {
      seg.replaceChildren(...["All", ...Object.keys(REGIONS)].map((name) => h("button", {
        class: region === name ? "on" : "",
        onclick: () => {
          region = name;
          draw();
        },
      }, name === "Middle East & Africa" ? "MEA" : name === "Asia-Pacific" ? "Asia" : name)));
      const keep = (item) => region === "All" || REGIONS[region].includes(item.country);
      const indices = data.indices.filter(keep);
      const stocks = data.universe.filter(keep).map((u) => ({ ...u, q: data.quotes[u.symbol] || {} }))
        .filter((s) => Number.isFinite(s.q.change_pct));
      const sorted = [...stocks].sort((a, b) => b.q.change_pct - a.q.change_pct);
      const clocks = [...new Map(data.indices.filter(keep).map((i) => [listing(i.symbol).exchange, i])).values()];
      content.replaceChildren(
        h("div", { class: "g-clocks" }, clocks.map((i) => {
          const info = listing(i.symbol);
          const status = marketStatus(i.symbol);
          return h("div", { class: "g-clock", title: status.text },
            h("span", {}, info.flag, " ", h("b", {}, status.localTime)),
            h("span", { class: "tiny " + (status.open ? "up" : "muted") }, status.open ? "● open" : status.lunch ? "lunch" : "closed"));
        })),
        h("div", { class: "g-index-grid" }, indices.map((i) => {
          const q = data.quotes[i.symbol] || {};
          return h("button", { class: "g-index", onclick: () => openSymbol(i.symbol) },
            h("div", { class: "between" }, h("span", { class: "small" }, listing(i.symbol).flag, " ", h("b", {}, i.name)), statusDot(i.symbol)),
            h("div", { class: "g-index-value" }, q.price ? Number(q.price).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"),
            h("div", { class: "between" }, pct(q.change_pct), spark(q.spark, (q.change_pct || 0) >= 0)));
        })),
        sorted.length ? h("div", { class: "card tight" },
          h("div", { class: "between" }, h("b", {}, "Biggest moves"), h("span", { class: "tiny muted" }, "last session · local currency")),
          h("div", { class: "grid2", style: "margin-top:8px" },
            h("div", {}, sorted.slice(0, 4).map((s) => moverRow(s))),
            h("div", {}, sorted.slice(-4).reverse().map((s) => moverRow(s))))) : null,
        stocks.length ? h("div", { class: "card tight" },
          h("div", { class: "between" }, h("b", {}, "Heatmap"), h("span", { class: "tiny muted" }, "tap a tile")),
          h("div", { class: "g-heat" }, stocks.map((s) => h("button", {
            class: "g-tile", style: `background:${heatColor(s.q.change_pct)}`, onclick: () => openSymbol(s.symbol),
            title: `${s.name} ${fmtPct(s.q.change_pct)}`,
          }, h("span", { class: "g-tile-name" }, listing(s.symbol).flag, " ", s.name.split(" ")[0]), h("span", { class: "g-tile-pct" }, fmtPct(s.q.change_pct, 1)))))) : null,
        h("p", { class: "tiny muted" },
          `${data.snapshot ? "Snapshot " + data.as_of : "Delayed quotes · " + data.as_of}. Open/closed uses each exchange's own holiday calendar and regular session (auctions not shown). Index levels in local points.`),
      );
    };
    const moverRow = (s) => h("button", { class: "g-mover", onclick: () => openSymbol(s.symbol) },
      h("span", { class: "small" }, listing(s.symbol).flag, " ", s.name),
      pct(s.q.change_pct));
    body.replaceChildren(seg, content);
    draw();
  }

  // ---------------------------------------------------------------- Home
  function searchBar() {
    return h("button", { class: "g-searchbar", id: "home-search", onclick: () => openSearch() },
      h("span", {}, "🔍"),
      h("span", { class: "g-searchbar-text" }, "Search any stock, any exchange"),
      h("span", { class: "g-searchbar-flags", "aria-hidden": "true" }, "🇺🇸🇯🇵🇮🇩🇬🇧"));
  }

  function worldStrip() {
    const row = h("div", { class: "g-strip" }, spinner());
    const card = h("div", { class: "card tight", id: "world-strip" },
      h("div", { class: "between" }, h("b", {}, "🌍 World markets"),
        h("a", { href: "#", onclick: (event) => { event.preventDefault(); openWorld(); } }, "See all ›")),
      row);
    const load = () => world().then((data) => {
      row.replaceChildren(...data.indices.slice(0, 18).map((i) => {
        const q = data.quotes[i.symbol] || {};
        return h("button", { class: "g-chip", onclick: () => openSymbol(i.symbol) },
          h("span", { class: "tiny" }, listing(i.symbol).flag, " ", i.name, " ", statusDot(i.symbol)),
          pct(q.change_pct));
      }));
    }).catch((error) => row.replaceChildren(h("span", { class: "tiny muted" }, error.message)));
    // Let the rest of Home paint first; the global snapshot is ~750 KB in the web demo.
    setTimeout(load, 400);
    return card;
  }

  // ------------------------------------------------------- stock page panel
  function rangeBar(label, lo, hi, now, currency) {
    if (!(hi > lo) || !Number.isFinite(now)) {
      return null;
    }
    const pos = Math.max(0, Math.min(100, 100 * (now - lo) / (hi - lo)));
    return h("div", { class: "g-range" },
      h("div", { class: "between tiny muted" }, h("span", {}, money(lo, currency)), h("span", {}, label), h("span", {}, money(hi, currency))),
      h("div", { class: "range" }, h("i", { style: `left:${pos}%` })));
  }

  // "FX as of 14:05" from the quote (server) or the snapshot time (web demo).
  function fxLabel(d) {
    const stamp = d && (d.fx_time || d.fxTime);
    if (stamp) {
      const when = new Date(typeof stamp === "number" ? stamp * 1000 : stamp);
      if (!Number.isNaN(when.getTime())) {
        return `exchange rate as of ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
    }
    return worldFxAsOf ? `exchange rate as of ${worldFxAsOf}` : "latest exchange rate";
  }

  function holidayRow(symbol, status) {
    const info = listing(symbol);
    if (info.isIndex) {
      return null;
    }
    const days = upcomingHolidays(symbol, 3);
    const fmt = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
    if (!days.length) {
      return status && status.calendar === false && CAL
        ? h("div", { class: "tiny muted", style: "margin-top:6px" }, "Holiday calendar not available for this exchange — weekday hours only.")
        : null;
    }
    return h("div", { class: "tiny muted", style: "margin-top:6px" }, `Next market holidays: ${days.map(fmt).join(" · ")}`);
  }

  function listingPanel(symbol, d) {
    remember({ ...d, symbol });
    const info = listing(symbol);
    const status = marketStatus(symbol);
    const currency = d.currency || info.currency;
    const rate = d.fx_usd || (currency === "USD" ? 1 : fxTable[currency]);
    const usd = rate && d.price ? d.price * rate : null;
    const shown = currency === "USD" ? inDisplay(usd) : (usd !== null ? (inDisplay(usd) || money(usd, "USD")) : null);
    const panel = h("div", { class: "g-listing", id: "listing-panel" },
      h("div", { class: "g-listing-row" },
        h("span", { class: "g-flag" }, info.flag),
        h("span", { class: "small" }, h("b", {}, d.exchange || info.exchange), ` · ${info.countryName}`),
        h("span", { class: "pill blue" }, currency),
        h("span", { class: "pill " + (status.open ? "green" : "") + " g-status", title: `Local time ${status.localTime}` }, status.text)),
      shown ? h("div", { class: "tiny muted", style: "margin-top:4px" }, `≈ ${shown} per share · ${fxLabel(d)}`) : null,
      rangeBar("Day range", d.day_low, d.day_high, d.price, currency),
      rangeBar("52-week range", d.low52, d.high52, d.price, currency),
      holidayRow(symbol, status));
    if (!info.us && !info.isIndex) {
      const note = h("div", { class: "g-real tiny" },
        h("b", {}, "Real money: "),
        `Connect Interactive Brokers in Me → Real trading (on your own Twin server) to buy ${d.name || symbol} on ${d.exchange || info.exchange} — IBKR covers most major world exchanges; which ones you can trade depends on your country and market permissions. Alpaca stays US-only. Practice trading here works for any listing.`);
      usListingFor(symbol).then((us) => {
        if (us && note.isConnected) {
          put(note, " ", h("a", { href: "#", onclick: (event) => { event.preventDefault(); closeSheet(); setTimeout(() => openStockPro(us), 60); } }, `US listing: ${us} ›`));
        }
      });
      put(panel, note);
    }
    return panel;
  }

  // Price string in the listing's own currency.
  function price(value, currency) {
    return money(value, currency || "USD");
  }

  // ------------------------------------------------------ portfolio exposure
  function exposure(positions, cash) {
    if (!positions || !positions.length) {
      return null;
    }
    const byCountry = {};
    const byCurrency = { USD: cash || 0 };
    let total = cash || 0;
    for (const p of positions) {
      const info = listing(p.symbol);
      const country = info.isIndex ? "US" : info.country;
      byCountry[country] = (byCountry[country] || 0) + p.value;
      const currency = p.currency || info.currency;
      byCurrency[currency] = (byCurrency[currency] || 0) + p.value;
      total += p.value;
    }
    const invested = total - (cash || 0);
    const colors = ["#4c8dff", "#22c55e", "#f5b301", "#a78bfa", "#38bdf8", "#f472b6", "#fb923c", "#94a3b8"];
    const bar = (entries, base, label, nameOf) => {
      const sorted = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      return h("div", { style: "margin-top:10px" },
        h("div", { class: "tiny muted" }, label),
        h("div", { class: "bar", style: "height:10px;margin-top:4px" },
          sorted.map(([k, v], i) => h("div", { title: `${nameOf(k)} ${(100 * v / base).toFixed(0)}%`, style: `width:${100 * v / base}%;background:${colors[i % colors.length]}` }))),
        h("div", { class: "legend", style: "flex-wrap:wrap" },
          sorted.map(([k, v], i) => h("span", {}, h("i", { style: `background:${colors[i % colors.length]}` }), `${nameOf(k)} ${(100 * v / base).toFixed(0)}%`))));
    };
    const home = Object.keys(byCountry).length === 1 ? Object.keys(byCountry)[0] : null;
    return h("div", { class: "g-exposure" },
      bar(Object.entries(byCountry), invested || 1, "Where your stocks are listed", (k) => `${flag(k)} ${COUNTRY[k] || k}`),
      bar(Object.entries(byCurrency), total || 1, "Currency exposure (incl. cash)", (k) => k),
      home ? h("p", { class: "tiny muted", style: "margin:6px 0 0" }, `All holdings are listed in ${COUNTRY[home] || home}. Search other markets to diversify by country — and remember foreign stocks add currency risk.`) : null);
  }

  // ------------------------------------------------------- Me: currency
  function currencyCard() {
    const select = h("select", { id: "display-currency", "aria-label": "Display currency" },
      DISPLAY_CURRENCIES.map((code) => h("option", { value: code, selected: code === displayCurrency() ? "" : null }, code)));
    const note = h("p", { class: "tiny muted", style: "margin:6px 0 0" });
    const refresh = () => {
      const code = displayCurrency();
      note.textContent = code === "USD"
        ? "Practice cash is kept in US dollars. Pick your home currency to also see values converted."
        : (fxTable[code] ? `1 USD ≈ ${money(1 / fxTable[code], code, { digits: WHOLE_UNITS.has(code) ? 0 : 4 })} (${fxLabel({})}). Practice cash is still kept in US dollars.` : "Loading exchange rate…");
    };
    select.addEventListener("change", async () => {
      setDisplayCurrency(select.value);
      await ensureFx();
      refresh();
      toast(`Showing values in ${select.value} too`);
    });
    ensureFx().then(refresh);
    refresh();
    return h("div", { class: "card", id: "currency-card" },
      h("h3", { style: "margin-top:0" }, "🌍 Home currency"),
      h("div", { class: "row" }, h("span", { class: "small", style: "flex:1" }, "Show prices and totals also in"), select),
      note);
  }

  // -------------------------------------------------------------- styles
  const style = document.createElement("style");
  style.textContent = `
    .g-searchbar { display:flex; align-items:center; gap:10px; width:100%; margin:10px 0 4px; padding:13px 14px;
      border-radius:14px; border:1px solid var(--line); background:var(--card); color:var(--muted); font:inherit; cursor:pointer;
      box-shadow:0 1px 2px rgba(0,0,0,.06); text-align:left; }
    .g-searchbar-text { flex:1; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .g-searchbar-flags { flex:none; letter-spacing:1px; font-size:13px; }
    @media (max-width: 380px) { .g-searchbar-flags { display:none; } }
    .g-strip { display:flex; gap:8px; overflow-x:auto; padding:8px 0 2px; scrollbar-width:none; }
    .g-strip::-webkit-scrollbar { display:none; }
    .g-chip { flex:none; display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:12px; border:1px solid var(--line);
      background:var(--card2); color:var(--text); font:inherit; text-align:left; cursor:pointer; min-width:112px; }
    .g-pct { font-weight:700; font-size:13px; }
    .g-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--gray); vertical-align:middle; }
    .g-dot.open { background:var(--green); box-shadow:0 0 0 3px rgba(34,197,94,.18); }
    .g-search-head { display:flex; align-items:center; gap:8px; position:sticky; top:0; }
    .g-search-head input { flex:1; font-size:16px; }
    .g-search-icon { font-size:18px; }
    .g-regions { margin:10px 0 4px; flex-wrap:nowrap; overflow-x:auto; }
    .g-list { display:flex; flex-direction:column; }
    .g-sub { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:14px 2px 4px; }
    .g-row { display:flex; align-items:center; gap:12px; padding:10px 4px; border:0; border-bottom:1px solid var(--line);
      background:transparent; color:var(--text); font:inherit; text-align:left; cursor:pointer; width:100%; }
    .g-row:hover { background:var(--card2); }
    .g-row-main { flex:1; display:flex; flex-direction:column; min-width:0; }
    .g-row-main b { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .g-flag { font-size:22px; flex:none; width:30px; text-align:center; }
    .g-seg { margin:12px 0 4px; }
    .g-clocks { display:flex; gap:8px; overflow-x:auto; padding:8px 0; scrollbar-width:none; }
    .g-clock { flex:none; display:flex; flex-direction:column; align-items:center; gap:2px; padding:6px 10px; border-radius:10px;
      background:var(--card2); font-size:13px; }
    .g-index-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:8px 0; }
    .g-index { display:flex; flex-direction:column; gap:4px; padding:10px 12px; border-radius:14px; border:1px solid var(--line);
      background:var(--card); color:var(--text); font:inherit; text-align:left; cursor:pointer; }
    .g-index-value { font-size:18px; font-weight:750; letter-spacing:-.01em; }
    .g-spark { width:56px; height:22px; flex:none; }
    .g-spark.up { color:var(--green); } .g-spark.down { color:var(--red); }
    .g-mover { display:flex; justify-content:space-between; gap:6px; width:100%; padding:6px 0; border:0; background:none;
      color:var(--text); font:inherit; cursor:pointer; text-align:left; }
    .g-heat { display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:6px; margin-top:8px; }
    .g-tile { display:flex; flex-direction:column; gap:2px; padding:8px; border-radius:10px; border:0; color:var(--text);
      font:inherit; text-align:left; cursor:pointer; min-height:54px; }
    .g-tile-name { font-size:12px; font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .g-tile-pct { font-size:13px; font-weight:800; }
    .g-listing { margin:10px 0 4px; padding:10px 12px; border-radius:14px; background:var(--card2); }
    .g-listing-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .g-listing .g-flag { font-size:20px; width:auto; }
    .g-status { font-weight:650; }
    .g-range { margin-top:8px; }
    .g-real { margin-top:10px; padding:8px 10px; border-radius:10px; border:1px dashed var(--line); line-height:1.45; }
    .g-exposure .legend span { font-size:12px; }
  `;
  document.head.append(style);

  loadCalendars();

  return {
    listing, flag, regionOf, marketStatus, upcomingHolidays, loadCalendars, money, price, remember, info, displayCurrency, setDisplayCurrency,
    ensureFx, inDisplay, world, openSearch, openWorld, searchBar, worldStrip, listingPanel, exposure,
    currencyCard, REGIONS, COUNTRY, EXCHANGES,
  };
})();
window.TwinGlobal = TwinGlobal;
