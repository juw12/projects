/* TwinAgent: evidence-first multi-agent research for Twin.
 *
 * Pure and deterministic: no network, storage, DOM, randomness or clock reads.
 * Every agent sees only inputs timestamped at or before `asOf`, cites the evidence
 * behind each signal, and abstains instead of guessing when its evidence is
 * missing or stale. A deterministic risk gate has the last word and can only draft
 * a practice ticket for the user to review; it never submits an order.
 */
"use strict";

const TwinAgent = (() => {
  const VERSION = "1.0.0";
  const DAY = 86400;
  const WEIGHTS = Object.freeze({ trend: 0.35, fundamentals: 0.25, risk: 0.15, news: 0.15, holdings: 0.10 });
  const AGENT_NAMES = Object.freeze({
    trend: "Trend analyst", fundamentals: "Fundamentals analyst", risk: "Risk analyst",
    news: "News analyst", holdings: "13F holdings analyst",
  });
  const EXPOSURE = Object.freeze({ Buy: 1, Overweight: 0.75, Hold: 0.5, Underweight: 0.25, Sell: 0 });
  // Annualized volatility each assessed risk level is allowed to buy into.
  const VOL_LIMIT = Object.freeze({ 1: 0.25, 2: 0.35, 3: 0.5, 4: 0.7, 5: 0.9 });
  const POSITIVE = new Set(("beat beats surge surges soar soars jump jumps rally rallies record upgrade upgraded upgrades " +
    "raise raises raised outperform outperforms growth strong stronger gain gains win wins approval approved boost boosts " +
    "expands expansion profit profitable bullish buyback breakthrough tops doubles accelerate accelerates partnership " +
    "demand rebound rebounds").split(" "));
  const NEGATIVE = new Set(("miss misses missed plunge plunges drop drops fall falls slump slumps sink sinks tumble tumbles " +
    "downgrade downgraded downgrades cut cuts lawsuit sue sued probe investigation recall weak weaker loss losses bearish " +
    "warning warns risk risks bubble layoffs delay delays decline declines concern concerns fear fears crash overvalued " +
    "selloff halt fraud fined slowdown").split(" "));
  const NEGATIONS = new Set(["not", "no", "never", "without", "despite"]);
  const NEGATIVE_PHRASES = ["red flag", "sell-off", "price target cut"];
  const ETF_ALIASES = Object.freeze({
    SPY: ["S&P 500", "S&P", "stock market", "Wall Street", "stocks"],
    QQQ: ["Nasdaq", "Nasdaq 100", "tech stocks"], VTI: ["stock market", "total market"],
    DIA: ["Dow", "Dow Jones"], IWM: ["Russell 2000", "small caps"],
  });
  const GENERIC_NAME_WORDS = new Set(["inc", "inc.", "corp", "corp.", "corporation", "company", "co", "co.", "the",
    "plc", "ltd", "group", "holdings", "trust", "etf", "fund", "class", "state", "street", "spdr", "invesco", "ishares",
    "vanguard", "platforms", "technologies", "international"]);

  /* ---------------------------------------------------------------- helpers */
  const clamp = (value, low = -1, high = 1) => Math.max(low, Math.min(high, value));
  const round = (value, digits = 4) => (value === null || value === undefined || !Number.isFinite(value)
    ? null : Math.round(value * 10 ** digits) / 10 ** digits);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const pct = (value, digits = 1) => (value === null || !Number.isFinite(value) ? "n/a" : `${value >= 0 ? "+" : ""}${(100 * value).toFixed(digits)}%`);
  const plainPct = (value, digits = 0) => `${(100 * value).toFixed(digits)}%`;
  const isoDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

  function std(values) {
    if (values.length < 2) {
      return null;
    }
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
  }

  function toSeconds(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e11 ? value / 1000 : value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00Z` : value);
      return Number.isFinite(parsed) ? parsed / 1000 : null;
    }
    return null;
  }

  // Stable serialization so the same evidence always produces the same fingerprint.
  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function fingerprint(value) {
    let hash = 0x811c9dc5;
    const text = stableStringify(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function abstain(agent, reason, extra = {}) {
    return { agent, name: AGENT_NAMES[agent], status: "abstained", score: null, reason, signals: [], evidence: [], warnings: [], ...extra };
  }

  function combine(signals) {
    const usable = signals.filter((signal) => signal.score !== null && Number.isFinite(signal.score));
    const total = usable.reduce((sum, signal) => sum + signal.weight, 0);
    if (!total) {
      return null;
    }
    return usable.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / total;
  }

  /* ------------------------------------------------------------ price data */
  function cleanDaily(points, asOf) {
    if (!Array.isArray(points)) {
      return { points: [], dropped: 0 };
    }
    let previous = -Infinity;
    let dropped = 0;
    const clean = [];
    for (const point of points) {
      if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number" ||
          !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[1] <= 0) {
        dropped += 1;
        continue;
      }
      if (point[0] <= previous) {
        throw new Error("Price history must be strictly chronological.");
      }
      previous = point[0];
      if (point[0] <= asOf) {
        clean.push([point[0], point[1]]);
      }
    }
    return { points: clean, dropped };
  }

  // Calendar-equivalent windows let daily (live) and monthly (scorecard) data share one rulebook.
  function scorePriceFeatures(features) {
    const trend = [
      { id: "trend.sma", label: "Price vs long-run average", weight: 0.4, value: features.trendGap,
        score: clamp(features.trendGap / 0.10), rule: "±10% from the ~10-month average maps to ±1" },
      { id: "trend.momentum", label: "12-1 month momentum", weight: 0.3, value: features.momentum,
        score: clamp(features.momentum / 0.30), rule: "±30% maps to ±1; skips the most recent month" },
      { id: "trend.short", label: "3-month momentum", weight: 0.15, value: features.shortMomentum,
        score: clamp(features.shortMomentum / 0.15), rule: "±15% maps to ±1" },
    ];
    if (features.relative !== null && features.relative !== undefined && Number.isFinite(features.relative)) {
      trend.push({ id: "trend.relative", label: "6-month return vs S&P 500 (SPY)", weight: 0.15, value: features.relative,
        score: clamp(features.relative / 0.15), rule: "±15 percentage points maps to ±1" });
    }
    const risk = [
      { id: "risk.volatility", label: "Annualized volatility", weight: 0.5, value: features.volatility,
        score: clamp((0.30 - features.volatility) / 0.30, -1, 0.5), rule: "30% is neutral; 60%+ is −1; calm stocks score at most +0.5" },
      { id: "risk.drawdown", label: "Drop from 1-year high", weight: 0.5, value: features.drawdown,
        score: clamp((features.drawdown + 0.20) / 0.20, -1, 0.5), rule: "−20% is neutral; −40% or worse is −1" },
    ];
    return { trend, risk, trendScore: combine(trend), riskScore: combine(risk) };
  }

  function dailyFeatures(closes, benchmarkCloses) {
    const n = closes.length;
    const last = closes[n - 1];
    const logReturns = [];
    for (let index = Math.max(1, n - 63); index < n; index += 1) {
      logReturns.push(Math.log(closes[index] / closes[index - 1]));
    }
    const momentumStart = Math.max(0, n - 253);
    let relative = null;
    if (benchmarkCloses && benchmarkCloses.length >= 127 && n >= 127) {
      const own = last / closes[n - 127] - 1;
      const bench = benchmarkCloses[benchmarkCloses.length - 1] / benchmarkCloses[benchmarkCloses.length - 127] - 1;
      relative = own - bench;
    }
    return {
      trendGap: last / mean(closes.slice(n - 200)) - 1,
      momentum: closes[n - 22] / closes[momentumStart] - 1,
      momentumSessions: n - 22 - momentumStart,
      shortMomentum: last / closes[n - 64] - 1,
      volatility: std(logReturns) * Math.sqrt(252),
      drawdown: last / Math.max(...closes.slice(Math.max(0, n - 252))) - 1,
      relative,
    };
  }

  function evidenceFor(signal, unit = "pct") {
    return { ...signal, value: round(signal.value, 4), score: round(signal.score, 3),
      display: unit === "pct" ? pct(signal.value) : String(round(signal.value, 2)) };
  }

  function priceAgents(daily, benchmark, symbol, asOf) {
    const { points, dropped } = cleanDaily(daily && daily.points, asOf);
    if (points.length < 210) {
      const reason = `Needs at least 210 daily closes up to the analysis date; found ${points.length}.`;
      return { trend: abstain("trend", reason), risk: abstain("risk", reason), points };
    }
    const closes = points.map((point) => point[1]);
    let benchCloses = null;
    if (benchmark && symbol !== "SPY") {
      // Align on dates both series share, so the relative read never mixes calendars.
      const own = new Map(points.map((point) => [isoDate(point[0]), point[1]]));
      const paired = cleanDaily(benchmark.points, asOf).points.filter((point) => own.has(isoDate(point[0])));
      if (paired.length >= 127) {
        benchCloses = paired.map((point) => point[1]);
      }
    }
    const features = dailyFeatures(closes, benchCloses);
    const scored = scorePriceFeatures(features);
    const span = `${isoDate(points[0][0])} to ${isoDate(points.at(-1)[0])}`;
    const source = { kind: "daily closes", span, observations: points.length, currency: daily.currency || "USD" };
    const warnings = dropped ? [`${dropped} invalid price observations were ignored.`] : [];
    if (features.momentumSessions < 240) {
      warnings.push(`Momentum uses ${features.momentumSessions} sessions (about ${(features.momentumSessions / 21).toFixed(0)} months), the history available.`);
    }
    // ATR proxy: mean absolute close-to-close move over 14 sessions.
    const moves = closes.slice(-15).slice(1).map((close, index) => Math.abs(close - closes.slice(-15)[index]));
    return {
      points,
      features,
      price: closes.at(-1),
      atr: mean(moves),
      trend: { agent: "trend", name: AGENT_NAMES.trend, status: "active", score: round(scored.trendScore, 4),
        signals: scored.trend.map((signal) => evidenceFor(signal)), source, warnings },
      risk: { agent: "risk", name: AGENT_NAMES.risk, status: "active", score: round(scored.riskScore, 4),
        signals: scored.risk.map((signal) => evidenceFor(signal)), source, warnings: [...warnings] },
    };
  }

  /* --------------------------------------------------------- fundamentals */
  function fundamentalsAgent(input, asOf) {
    const rows = (input && Array.isArray(input.rows) ? input.rows : [])
      .map((row) => ({ ...row, filedAt: toSeconds(row.filed), endAt: toSeconds(row.end) }))
      .filter((row) => row.filedAt !== null && row.endAt !== null && row.filedAt <= asOf)
      .sort((a, b) => b.endAt - a.endAt || b.filedAt - a.filedAt);
    if (!rows.length) {
      return abstain("fundamentals", input && input.error
        ? `Filed fundamentals unavailable: ${input.error}`
        : "No SEC-filed fundamentals available up to the analysis date (funds/ETFs and non-US listings usually have none here).");
    }
    const latest = rows[0];
    const ageDays = (asOf - latest.filedAt) / DAY;
    if (ageDays > 200) {
      return abstain("fundamentals", `Latest filing (${latest.filed}) is ${ageDays.toFixed(0)} days old; too stale to use.`);
    }
    const finite = (value) => typeof value === "number" && Number.isFinite(value);
    const warnings = [];
    const outlier = (finite(latest.eps_yoy) && Math.abs(latest.eps_yoy) > 150) ||
      (finite(latest.net_margin) && latest.net_margin > 60) || (finite(latest.revenue_yoy) && Math.abs(latest.revenue_yoy) > 100);
    if (outlier) {
      warnings.push("Extreme reported figures (e.g. EPS growth above 150% or net margin above 60%) usually mean one-off items. Earnings signals are capped; verify the filing.");
    }
    const cap = outlier ? 0.3 : 1;
    const earnings = finite(latest.eps_yoy) ? latest.eps_yoy : latest.net_income_yoy;
    const yearAgo = rows.find((row) => latest.endAt - row.endAt > 330 * DAY && latest.endAt - row.endAt < 400 * DAY);
    const signals = [];
    if (finite(latest.revenue_yoy)) {
      signals.push({ id: "fund.revenue", label: "Revenue growth vs year earlier", weight: 0.35, value: latest.revenue_yoy / 100,
        score: clamp(latest.revenue_yoy / 20), rule: "±20% maps to ±1" });
    }
    if (finite(earnings)) {
      signals.push({ id: "fund.earnings", label: finite(latest.eps_yoy) ? "Diluted EPS growth vs year earlier" : "Net income growth vs year earlier",
        weight: 0.3, value: earnings / 100, score: clamp(earnings / 30, -cap, cap), rule: "±30% maps to ±1" });
    }
    if (finite(latest.net_margin)) {
      signals.push({ id: "fund.margin", label: "Net margin", weight: 0.2, value: latest.net_margin / 100,
        score: clamp((latest.net_margin - 10) / 20, -cap, cap), rule: "10% is neutral; 30% is +1; −10% is −1" });
    }
    if (yearAgo && finite(latest.operating_margin) && finite(yearAgo.operating_margin)) {
      const change = latest.operating_margin - yearAgo.operating_margin;
      signals.push({ id: "fund.margin_trend", label: "Operating-margin change vs year earlier", weight: 0.15, value: change / 100,
        score: clamp(change / 5), rule: "±5 percentage points maps to ±1" });
    }
    if (!signals.length) {
      return abstain("fundamentals", "The latest filing has no usable growth or margin figures.");
    }
    return {
      agent: "fundamentals", name: AGENT_NAMES.fundamentals, status: "active", score: round(combine(signals), 4),
      signals: signals.map((signal) => evidenceFor(signal)),
      source: { kind: input.source || "SEC XBRL company facts", form: latest.form || null, period: latest.fiscal || latest.end,
        periodEnd: latest.end, filed: latest.filed, entity: input.entity || null, availability: input.availability || "filing date" },
      confidenceFactor: outlier ? 0.5 : 1, warnings,
    };
  }

  /* ------------------------------------------------------------------ news */
  function aliasesFor(symbol, name) {
    const aliases = [...(ETF_ALIASES[symbol] || [])];
    const words = String(name || "").replace(/[,.()]/g, " ").split(/\s+/).filter(Boolean);
    const first = words.find((word) => !GENERIC_NAME_WORDS.has(word.toLowerCase()) && word.length >= 3);
    if (first && !ETF_ALIASES[symbol]) {
      aliases.push(first);
    }
    return [...new Set(aliases)];
  }

  function headlineSentiment(text) {
    const lower = text.toLowerCase();
    const tokens = lower.replace(/[^a-z0-9&\s-]/g, " ").split(/\s+/).filter(Boolean);
    const positive = [];
    const negative = [];
    tokens.forEach((token, index) => {
      const word = token.replace(/-/g, "");
      const negated = tokens.slice(Math.max(0, index - 2), index).some((prior) => NEGATIONS.has(prior));
      if (POSITIVE.has(word)) {
        (negated ? negative : positive).push(token);
      } else if (NEGATIVE.has(word)) {
        (negated ? positive : negative).push(token);
      }
    });
    for (const phrase of NEGATIVE_PHRASES) {
      if (lower.includes(phrase)) {
        negative.push(phrase);
      }
    }
    const total = positive.length + negative.length;
    return { positive, negative, score: total ? (positive.length - negative.length) / total : 0 };
  }

  function newsAgent(input, symbol, name, asOf, lookbackDays = 7) {
    const items = input && Array.isArray(input.items) ? input.items : [];
    if (input && input.error && !items.length) {
      return abstain("news", `Headlines unavailable: ${input.error}`);
    }
    const aliases = aliasesFor(symbol, name);
    const symbolPattern = new RegExp(`(^|[^A-Za-z])\\$?${symbol.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}([^A-Za-z]|$)`);
    const aliasPatterns = aliases.map((alias) => new RegExp(`(^|[^a-z])${alias.toLowerCase().replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}([^a-z]|$)`));
    const seen = new Set();
    let olderThanWindow = 0;
    let screenedOut = 0;
    const relevant = [];
    for (const item of items) {
      const at = toSeconds(item.time);
      // Future items are dropped silently: even counting them would leak hindsight.
      if (at === null || at > asOf) {
        continue;
      }
      if (at < asOf - lookbackDays * DAY) {
        olderThanWindow += 1;
        continue;
      }
      const title = String(item.title || "").trim();
      const key = title.toLowerCase().replace(/\W+/g, " ").trim();
      if (!title || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const text = `${title} ${item.summary || ""}`;
      const lower = text.toLowerCase();
      if (!symbolPattern.test(text) && !aliasPatterns.some((pattern) => pattern.test(lower))) {
        screenedOut += 1;
        continue;
      }
      const sentiment = headlineSentiment(text);
      const question = title.endsWith("?");
      relevant.push({
        id: item.id || `news.${fingerprint(title)}`, title, source: item.source || "unknown", time: item.time,
        link: item.link || null, score: round(sentiment.score, 3), weight: question ? 0.5 : 1,
        matched: { positive: sentiment.positive, negative: sentiment.negative }, question,
      });
    }
    const screening = { lookbackDays, aliases, relevant: relevant.length, screenedOut, olderThanWindow };
    if (relevant.length < 2) {
      return abstain("news", `Only ${relevant.length} relevant headline(s) in the last ${lookbackDays} days; ${screenedOut} mentioned the ticker loosely and were screened out.`, { screening });
    }
    const totalWeight = relevant.reduce((sum, item) => sum + item.weight, 0);
    const raw = relevant.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
    const coverage = Math.min(1, relevant.length / 5);
    const sources = new Set(relevant.map((item) => item.source));
    const warnings = ["Headline tone uses a transparent word list. It cannot read sarcasm, context or full articles."];
    if (sources.size < 2) {
      warnings.push(`All relevant headlines come from one source (${[...sources][0]}).`);
    }
    return {
      agent: "news", name: AGENT_NAMES.news, status: "active", score: round(raw * coverage, 4),
      signals: [evidenceFor({ id: "news.tone", label: `Headline tone (${relevant.length} relevant)`, weight: 1, value: raw,
        score: raw * coverage, rule: "net positive minus negative words per headline; questions count half; fewer than 5 headlines shrink the score" }, "num")],
      headlines: relevant, screening, source: { kind: input.source || "headline feed", sources: [...sources] }, warnings,
    };
  }

  /* -------------------------------------------------------------- holdings */
  function holdingsAgent(input, symbol, asOf) {
    if (!input || !input.copy) {
      return abstain("holdings", "No 13F holdings snapshot available.");
    }
    const filers = new Map((input.filers || []).map((filer) => [filer.cik, filer]));
    const holders = [];
    const changes = [];
    let newestQuarter = null;
    for (const [cik, filing] of Object.entries(input.copy)) {
      const filedAt = toSeconds(filing.filed);
      if (filedAt === null || filedAt > asOf) {
        continue;
      }
      const quarterAt = toSeconds(filing.as_of);
      newestQuarter = Math.max(newestQuarter ?? -Infinity, quarterAt ?? -Infinity);
      const who = filers.get(cik) || {};
      for (const row of filing.weights || []) {
        if (row.ticker === symbol || (row.classes || []).includes(symbol)) {
          holders.push({ cik, filer: who.name || filing.source, person: who.person || "", weight: row.weight,
            quarter: filing.as_of, filed: filing.filed });
        }
      }
      for (const change of ((input.diff || {})[cik] || {}).changes || []) {
        if (change.ticker === symbol) {
          changes.push({ cik, filer: who.name || cik, person: who.person || "", status: change.status,
            changePct: change.change_pct, quarter: filing.as_of, filed: filing.filed });
        }
      }
    }
    if (!holders.length && !changes.length) {
      return abstain("holdings", "Not in the tracked investors' top-10 holdings and no reported changes. Absence is not evidence either way.");
    }
    const lagDays = newestQuarter === null ? null : (asOf - newestQuarter) / DAY;
    if (lagDays !== null && lagDays > 200) {
      return abstain("holdings", `Newest 13F quarter ended ${lagDays.toFixed(0)} days ago; too stale to use.`);
    }
    const heldWeight = holders.reduce((sum, holder) => sum + (Number(holder.weight) || 0), 0);
    const changeValue = { NEW: 0.3, ADDED: 0.2, REDUCED: -0.2, "SOLD OUT": -0.4 };
    const flow = changes.reduce((sum, change) => sum + (changeValue[change.status] || 0), 0);
    const signals = [];
    if (holders.length) {
      signals.push({ id: "holdings.held", label: `In ${holders.length} tracked investor top-10 portfolio(s)`, weight: 0.6,
        value: heldWeight / 100, score: clamp(heldWeight / 40, 0, 0.6), rule: "summed portfolio weight; 24%+ caps at +0.6" });
    }
    if (changes.length) {
      signals.push({ id: "holdings.flow", label: "Latest quarter-on-quarter changes", weight: 0.4, value: flow,
        score: clamp(flow), rule: "new +0.3, added +0.2, reduced −0.2, sold out −0.4" });
    }
    return {
      agent: "holdings", name: AGENT_NAMES.holdings, status: "active", score: round(combine(signals), 4),
      signals: signals.map((signal) => evidenceFor(signal, signal.id === "holdings.flow" ? "num" : "pct")),
      holders, changes, source: { kind: "SEC 13F-HR filings", lagDays: round(lagDays, 0) },
      warnings: ["13F reports describe quarter-end long positions, are filed up to 45 days later and exclude shorts and cash."],
    };
  }

  /* ---------------------------------------------- debate, decision, risk */
  function debate(agents) {
    const points = [];
    for (const agent of Object.values(agents)) {
      if (agent.status !== "active") {
        continue;
      }
      const totalWeight = agent.signals.reduce((sum, signal) => sum + signal.weight, 0) || 1;
      for (const signal of agent.signals) {
        const contribution = WEIGHTS[agent.agent] * signal.weight / totalWeight * signal.score;
        if (Math.abs(contribution) >= 0.002) {
          points.push({ agent: agent.agent, agentName: agent.name, id: signal.id, label: signal.label, display: signal.display,
            contribution: round(contribution, 4) });
        }
      }
    }
    const bull = points.filter((point) => point.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
    const bear = points.filter((point) => point.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 3);
    const rebut = (point, opponents) => opponents.find((other) => other.agent !== point.agent) || null;
    const bullTotal = points.filter((point) => point.contribution > 0).reduce((sum, point) => sum + point.contribution, 0);
    const bearTotal = points.filter((point) => point.contribution < 0).reduce((sum, point) => sum - point.contribution, 0);
    return {
      bull: bull.map((point) => ({ ...point, rebuttal: rebut(point, bear) })),
      bear: bear.map((point) => ({ ...point, rebuttal: rebut(point, bull) })),
      bullTotal: round(bullTotal, 4), bearTotal: round(bearTotal, 4),
      winner: Math.abs(bullTotal - bearTotal) < 0.02 ? "balanced" : bullTotal > bearTotal ? "bull" : "bear",
      emptySide: !bull.length ? "No bull case is supported by the available evidence." :
        !bear.length ? "No bear case is supported by the available evidence. Missing evidence is not proof of safety." : null,
    };
  }

  function ratingFor(score) {
    if (score >= 0.45) {
      return "Buy";
    }
    if (score >= 0.15) {
      return "Overweight";
    }
    if (score > -0.15) {
      return "Hold";
    }
    return score > -0.45 ? "Underweight" : "Sell";
  }

  function decide(agents) {
    const active = Object.values(agents).filter((agent) => agent.status === "active");
    const coverage = active.reduce((sum, agent) => sum + WEIGHTS[agent.agent], 0);
    const reasons = [];
    if (agents.trend.status !== "active") {
      reasons.push("The trend analyst could not run, so there is no price evidence.");
    }
    if (coverage < 0.5) {
      reasons.push(`Only ${(100 * coverage).toFixed(0)}% of the evidence weight is available (minimum 50%).`);
    }
    if (reasons.length) {
      return { rating: "No call", noCall: true, composite: null, coverage: round(coverage, 3), agreement: null,
        confidence: 0, confidenceLabel: "None", reasons };
    }
    const composite = active.reduce((sum, agent) => sum + WEIGHTS[agent.agent] * agent.score, 0) / coverage;
    const dissent = active.filter((agent) => Math.abs(agent.score) > 0.05 && Math.sign(agent.score) !== Math.sign(composite))
      .reduce((sum, agent) => sum + WEIGHTS[agent.agent], 0);
    const agreement = 1 - dissent / coverage;
    const factor = Math.min(...active.map((agent) => agent.confidenceFactor ?? 1));
    const confidence = Math.abs(composite) * Math.sqrt(coverage) * agreement * factor;
    return {
      rating: ratingFor(composite), noCall: false, composite: round(composite, 4), coverage: round(coverage, 3),
      agreement: round(agreement, 3), confidence: round(confidence, 3),
      confidenceLabel: confidence >= 0.35 ? "High" : confidence >= 0.15 ? "Medium" : "Low",
      reasons: [`Weighted evidence score ${composite.toFixed(2)} on a −1 to +1 scale; ${(100 * agreement).toFixed(0)}% of active evidence agrees in direction.`],
    };
  }

  function riskGate(decision, price, options) {
    const profile = options.profile || {};
    const limits = profile.limits || {};
    const portfolio = options.portfolio || {};
    const level = Math.max(1, Math.min(5, Math.round(Number(profile.riskLevel) || 2)));
    const checks = [];
    const add = (id, pass, message) => checks.push({ id, pass, message });
    if (decision.noCall || !price) {
      add("evidence", false, "No call: TwinAgent will not size a trade without enough evidence.");
      return { action: "no-call", summary: "No trade idea. Gather more evidence first.", checks, ticket: null };
    }
    const vol = price.volatility;
    const volLimit = VOL_LIMIT[level];
    const bullish = decision.rating === "Buy" || decision.rating === "Overweight";
    const held = Number(portfolio.heldValue) || 0;
    if (!bullish) {
      const bearish = decision.rating === "Underweight" || decision.rating === "Sell";
      add("direction", false, `${decision.rating}: no new buy.`);
      if (bearish && held > 0) {
        return { action: "review-holding", summary: `You hold ${symbolMoney(held)} of this in practice. Review whether it still fits your plan; Twin will not sell for you.`, checks, ticket: null };
      }
      return { action: bearish ? "avoid" : "hold", summary: bearish ? "Avoid new buys for now." : "Hold: wait for clearer evidence.", checks, ticket: null };
    }
    add("direction", true, `${decision.rating} supported by the weighted evidence.`);
    const volOk = vol <= volLimit;
    add("volatility", volOk, `Volatility ${plainPct(vol)} a year vs your risk level ${level} limit of ${plainPct(volLimit)}.`);
    if (!volOk) {
      return { action: "hold", summary: "Downgraded to Hold: too volatile for your risk profile.", checks, ticket: null };
    }
    const equity = Math.max(0, Number(portfolio.equity) || Number(limits.budget) || 0);
    const cash = Math.max(0, Number(portfolio.cash) || 0);
    const maxLoss = Number(limits.max_loss_per_trade_usd) > 0 ? Number(limits.max_loss_per_trade_usd) : 0.005 * equity;
    const stopDistance = Math.max(2.5 * price.atr, 0.02 * price.last);
    const shareRisk = maxLoss / stopDistance * price.last;
    const positionCap = (Number(limits.max_position_pct) > 0 ? Number(limits.max_position_pct) : 25) / 100 * equity - held;
    const cashAvailable = cash - (Number(limits.cash_buffer_pct) || 0) / 100 * equity;
    let dollars = Math.min(shareRisk, positionCap, cashAvailable);
    const scale = (decision.rating === "Overweight" ? 0.5 : 1) * (decision.confidenceLabel === "Low" ? 0.5 : 1);
    dollars *= scale;
    // Dollar sizing is currency-neutral: shares × price × FX cancels the FX in stop distance × shares × FX.
    add("risk-budget", shareRisk > 0, `Stop ${plainPct(stopDistance / price.last, 1)} below entry (2.5× the average daily move) caps the planned loss near ${symbolMoney(maxLoss * scale)}.`);
    add("concentration", positionCap > 1, `Position limit leaves ${symbolMoney(Math.max(0, positionCap))} of room.`);
    add("cash", cashAvailable > 1, `Cash after your buffer: ${symbolMoney(Math.max(0, cashAvailable))}.`);
    if (!(dollars >= 1)) {
      return { action: "hold", summary: "No room within your limits for a new position.", checks, ticket: null };
    }
    const rewardRisk = Number(limits.min_reward_risk) > 0 ? Number(limits.min_reward_risk) : 2;
    const ticket = {
      symbol: options.symbol, side: "buy", dollars: Math.floor(dollars * 100) / 100,
      reference: round(price.last, 4), stop_loss: round(price.last - stopDistance, 2),
      take_profit: round(price.last + rewardRisk * stopDistance, 2), rewardRisk,
      plannedRisk: round(dollars / price.last * stopDistance, 2),
    };
    return {
      action: "practice-buy",
      summary: `Draft a practice buy of about ${symbolMoney(ticket.dollars)}${scale < 1 ? " (reduced for an Overweight rating or low confidence)" : ""}. You review and place it yourself.`,
      checks, ticket,
    };
  }

  function symbolMoney(value) {
    return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /* --------------------------------------------- walk-forward scorecard */
  function monthEnd(key) {
    const [year, month] = key.split("-").map(Number);
    return Date.UTC(year, month, 1) / 1000;
  }

  function contiguousMonths(map, asOf) {
    const keys = Object.keys(map || {}).filter((key) => /^\d{4}-\d{2}$/.test(key) &&
      typeof map[key] === "number" && Number.isFinite(map[key]) && map[key] > -1 && monthEnd(key) <= asOf).sort();
    const run = [];
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (run.length) {
        const [year, month] = run[0].split("-").map(Number);
        const expected = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
        if (keys[index] !== expected) {
          break;
        }
      }
      run.unshift(keys[index]);
    }
    return run;
  }

  function stats(returns) {
    if (!returns.length) {
      return null;
    }
    let equity = 1;
    let peak = 1;
    let worst = 0;
    for (const value of returns) {
      equity *= 1 + value;
      peak = Math.max(peak, equity);
      worst = Math.min(worst, equity / peak - 1);
    }
    const deviation = std(returns);
    return {
      totalReturn: round(equity - 1, 4), cagr: round(equity ** (12 / returns.length) - 1, 4),
      volatility: round(deviation * Math.sqrt(12), 4),
      sharpe: deviation ? round(mean(returns) / deviation * Math.sqrt(12), 3) : null,
      maxDrawdown: round(worst, 4), months: returns.length,
    };
  }

  function bucket(rows) {
    if (!rows.length) {
      return { count: 0, meanNext: null, hitRate: null };
    }
    return { count: rows.length, meanNext: round(mean(rows.map((row) => row.next)), 5), hitRate: null };
  }

  function welch(a, b) {
    if (a.length < 3 || b.length < 3) {
      return null;
    }
    const se = Math.sqrt(std(a) ** 2 / a.length + std(b) ** 2 / b.length);
    return se ? (mean(a) - mean(b)) / se : null;
  }

  function scorecard(monthly, options = {}) {
    const asOf = options.asOf;
    const costBps = options.costBps ?? 10;
    const keys = contiguousMonths(monthly, asOf);
    if (keys.length < 72) {
      return { status: "abstained", reason: `Needs at least 72 consecutive months of history; found ${keys.length}.` };
    }
    const benchmark = options.benchmark && options.symbol !== "SPY" ? options.benchmark : null;
    const index = [1];
    for (let position = 1; position < keys.length; position += 1) {
      index.push(index[position - 1] * (1 + monthly[keys[position]]));
    }
    const benchIndex = benchmark ? keys.map((key) => benchmark[key]) : null;
    const decisions = [];
    let previousExposure = 0;
    const strategy = [];
    const passive = [];
    for (let t = 12; t < keys.length - 1; t += 1) {
      const window = index.slice(t - 11, t + 1);
      const logs = [];
      for (let position = t - 11; position <= t; position += 1) {
        logs.push(Math.log(index[position] / index[position - 1]));
      }
      let relative = null;
      if (benchIndex && benchIndex.slice(t - 5, t + 1).every((value) => typeof value === "number" && Number.isFinite(value))) {
        const benchSix = benchIndex.slice(t - 5, t + 1).reduce((product, value) => product * (1 + value), 1) - 1;
        relative = index[t] / index[t - 6] - 1 - benchSix;
      }
      const scored = scorePriceFeatures({
        trendGap: index[t] / mean(index.slice(t - 9, t + 1)) - 1,
        momentum: index[t - 1] / index[t - 12] - 1,
        shortMomentum: index[t] / index[t - 3] - 1,
        volatility: std(logs) * Math.sqrt(12),
        drawdown: index[t] / Math.max(...window) - 1,
        relative,
      });
      const composite = (WEIGHTS.trend * scored.trendScore + WEIGHTS.risk * scored.riskScore) / (WEIGHTS.trend + WEIGHTS.risk);
      const rating = ratingFor(composite);
      const exposure = EXPOSURE[rating];
      const next = monthly[keys[t + 1]];
      const cost = costBps / 10000 * Math.abs(exposure - previousExposure);
      strategy.push(exposure * next - cost);
      passive.push(next - (t === 12 ? costBps / 10000 : 0));
      decisions.push({ month: keys[t], rating, composite: round(composite, 4), exposure, next });
      previousExposure = exposure;
    }
    const averageExposure = mean(decisions.map((row) => row.exposure));
    const matched = decisions.map((row, position) => averageExposure * row.next - (position === 0 ? costBps / 10000 * averageExposure : 0));
    const bullish = decisions.filter((row) => row.exposure >= 0.75);
    const bearish = decisions.filter((row) => row.exposure <= 0.25);
    const neutral = decisions.filter((row) => row.exposure === 0.5);
    const bullBucket = { ...bucket(bullish), hitRate: bullish.length ? round(bullish.filter((row) => row.next > 0).length / bullish.length, 3) : null };
    const bearBucket = { ...bucket(bearish), hitRate: bearish.length ? round(bearish.filter((row) => row.next < 0).length / bearish.length, 3) : null };
    const spreadOf = (rows) => {
      const up = rows.filter((row) => row.exposure >= 0.75).map((row) => row.next);
      const down = rows.filter((row) => row.exposure <= 0.25).map((row) => row.next);
      return up.length && down.length ? mean(up) - mean(down) : null;
    };
    const half = Math.floor(decisions.length / 2);
    const halves = [decisions.slice(0, half), decisions.slice(half)].map((rows, part) => {
      const own = (part ? strategy.slice(half) : strategy.slice(0, half));
      const base = (part ? passive.slice(half) : passive.slice(0, half));
      return {
        from: rows[0].month, to: rows.at(-1).month, spread: round(spreadOf(rows), 5),
        strategyCagr: stats(own).cagr, buyHoldCagr: stats(base).cagr,
      };
    });
    const spread = spreadOf(decisions);
    const tStat = welch(bullish.map((row) => row.next), bearish.map((row) => row.next));
    const strategyStats = stats(strategy);
    const passiveStats = stats(passive);
    const matchedStats = stats(matched);
    const separates = tStat !== null && Math.abs(tStat) >= 2 && spread > 0 &&
      halves.every((part) => part.spread !== null && part.spread > 0);
    const verdict = separates
      ? "Bullish months were followed by meaningfully better returns than bearish months, in both halves of history."
      : "Bullish and bearish months were not reliably separated (|t| < 2 or inconsistent halves). Treat the rating as a risk lens, not a forecast.";
    return {
      status: "active", method: "monthly walk-forward, decision at month end, applied to the following month",
      priceCoreOnly: true, costBps, from: decisions[0].month, to: decisions.at(-1).month, decisions: decisions.length,
      strategy: strategyStats, buyHold: passiveStats, exposureMatched: { ...matchedStats, exposure: round(averageExposure, 3) },
      buckets: { bullish: bullBucket, neutral: bucket(neutral), bearish: bearBucket },
      spread: round(spread, 5), tStat: round(tStat, 2), halves, separates, verdict,
      latest: decisions.at(-1),
      ledger: decisions.map((row) => [row.month, row.rating, row.exposure, round(row.next, 5)]),
    };
  }

  /* ----------------------------------------------------- track record */
  function settle(entry, daily, benchmark, minSessions = 5, horizon = 21) {
    const points = cleanDaily(daily && daily.points, Infinity).points;
    const start = points.findIndex((point) => point[0] > entry.dataEnd);
    if (start < 0 || points.length - 1 - start < minSessions) {
      return { status: "pending", sessions: start < 0 ? 0 : points.length - 1 - start };
    }
    const end = Math.min(points.length - 1, start + horizon);
    const own = points[end][1] / points[start][1] - 1;
    let bench = null;
    if (benchmark && entry.symbol !== "SPY") {
      const benchPoints = cleanDaily(benchmark.points, Infinity).points;
      const at = (time) => {
        let found = null;
        for (const point of benchPoints) {
          if (point[0] <= time) {
            found = point[1];
          }
        }
        return found;
      };
      const first = at(points[start][0]);
      const last = at(points[end][0]);
      bench = first && last ? last / first - 1 : null;
    }
    const alpha = bench === null ? own : own - bench;
    const direction = { Buy: 1, Overweight: 1, Underweight: -1, Sell: -1 }[entry.rating] || 0;
    return {
      status: end - start >= horizon ? "settled" : "provisional", sessions: end - start,
      entryDate: isoDate(points[start][0]), exitDate: isoDate(points[end][0]),
      returnPct: round(own, 5), benchmarkPct: round(bench, 5), alpha: round(alpha, 5),
      correct: direction ? alpha * direction > 0 : null,
    };
  }

  function trackRecord(settled) {
    const scored = settled.filter((row) => row.outcome && row.outcome.correct !== null && row.outcome.status !== "pending");
    if (!scored.length) {
      return { scored: 0, hitRate: null, meanAlpha: null, warning: "No directional calls have enough history after the decision yet." };
    }
    return {
      scored: scored.length,
      hitRate: round(scored.filter((row) => row.outcome.correct).length / scored.length, 3),
      meanAlpha: round(mean(scored.map((row) => row.outcome.alpha * ({ Buy: 1, Overweight: 1 }[row.rating] ? 1 : -1))), 5),
      warning: scored.length < 20 ? `Only ${scored.length} scored call(s); far too few to judge skill.` : null,
    };
  }

  /* ------------------------------------------------------------ analyze */
  function analyze(bundle, options = {}) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error("Missing evidence bundle.");
    }
    const symbol = String(bundle.symbol || "").toUpperCase();
    if (!/^[A-Z0-9^][A-Z0-9.\-^=]{0,14}$/.test(symbol)) {
      throw new Error("Invalid symbol.");
    }
    const asOf = toSeconds(options.asOf ?? bundle.asOf);
    if (asOf === null) {
      throw new Error("Analysis needs an explicit as-of time.");
    }
    const name = bundle.name || (bundle.daily && bundle.daily.name) || symbol;
    const price = priceAgents(bundle.daily, bundle.benchmark, symbol, asOf);
    const agents = {
      trend: price.trend,
      fundamentals: fundamentalsAgent(bundle.fundamentals, asOf),
      risk: price.risk,
      news: newsAgent(bundle.news, symbol, name, asOf, options.lookbackDays || 7),
      holdings: holdingsAgent(bundle.holdings, symbol, asOf),
    };
    const decision = decide(agents);
    const card = bundle.monthly ? scorecard(bundle.monthly, { asOf, symbol, benchmark: bundle.benchmarkMonthly, costBps: options.costBps ?? 10 })
      : { status: "abstained", reason: "No long monthly history for this listing." };
    let baseRate = null;
    if (card.status === "active" && !decision.noCall) {
      const exposure = EXPOSURE[decision.rating];
      const key = exposure >= 0.75 ? "bullish" : exposure <= 0.25 ? "bearish" : "neutral";
      baseRate = { bucket: key, ...card.buckets[key], note: "Historical months whose price-core rating fell in the same bucket. Price evidence only." };
    }
    const gate = riskGate(decision, price.price ? { last: price.price, atr: price.atr, volatility: price.features.volatility } : null,
      { ...options, symbol });
    const usedInputs = {
      symbol, asOf, daily: price.points, benchmark: bundle.benchmark ? cleanDaily(bundle.benchmark.points, asOf).points : null,
      fundamentals: bundle.fundamentals || null, news: bundle.news || null, holdings: bundle.holdings || null,
      monthly: bundle.monthly || null, benchmarkMonthly: bundle.benchmarkMonthly || null,
      profile: options.profile || null, portfolio: options.portfolio || null,
    };
    return {
      engine: "TwinAgent", engineVersion: VERSION, symbol, name, asOf, asOfDate: isoDate(asOf),
      dataEnd: price.points.length ? price.points.at(-1)[0] : null, mode: bundle.mode || "unknown",
      price: price.price ? round(price.price, 4) : null, currency: (bundle.daily && bundle.daily.currency) || "USD",
      inputFingerprint: fingerprint(usedInputs),
      weights: WEIGHTS, agents, debate: debate(agents), decision, scorecard: card, baseRate, riskGate: gate,
      sourceErrors: bundle.errors || {},
      limitations: [
        "Research and education only. Not investment advice, a forecast or a recommendation to trade.",
        "The walk-forward scorecard tests the price evidence only; archived headlines, filings and 13Fs are not replayed historically.",
        "Rules and weights are fixed and published, not fitted to this stock. They can still be wrong for any period.",
        "Delayed, unofficial data. Total-return monthly history; daily analysis uses price closes.",
      ],
    };
  }

  return Object.freeze({
    VERSION, WEIGHTS, EXPOSURE, VOL_LIMIT, analyze, scorecard, settle, trackRecord, ratingFor, fingerprint,
    headlineSentiment, toSeconds,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TwinAgent;
}
