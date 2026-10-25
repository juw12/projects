/* Trade Twin — offline demo engine.
 *
 * When no Trade Twin server answers (e.g. on GitHub Pages), the app runs on this
 * file instead. It answers the same API calls from a bundled snapshot of real data
 * (demo/*.json): delayed quotes and charts, monthly total-return histories, SEC 13F
 * holdings for five investors, a news snapshot and the day-trader-skill TSLA replay.
 * Accounts and the practice portfolio live only in this browser (localStorage).
 *
 * The rules below (personality scoring, limits, sizing, risk) mirror server.py so
 * the demo behaves like the real app. The goal planner runs its 10,000 futures here.
 */
"use strict";

(function () {
  const STORE = "trade-twin-demo-v1";
  const cache = {};

  // ----------------------------------------------------------------- data
  async function load(name) {
    if (!cache[name]) {
      const response = await fetch("demo/" + name + ".json", { cache: "force-cache" });
      if (!response.ok) {
        throw new Error("demo data missing: " + name);
      }
      cache[name] = await response.json();
    }
    return cache[name];
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || { users: {}, session: null };
    } catch (error) {
      return { users: {}, session: null };
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORE, JSON.stringify(store));
  }

  async function digest(text) {
    if (window.crypto && crypto.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return "plain:" + text;
  }

  const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

  // ------------------------------------------------------- profile rules
  const ARCHETYPES = {
    builder: {
      title: "Steady Builder", emoji: "🌱", focus: "invest",
      summary: "You value sleep over thrills. Long horizon, low tolerance for big swings: regular investing into broad index funds fits you best.",
      suggest: "Start in Invest → Goal planner with a broad index fund (e.g. SPY) and a monthly amount.",
    },
    grower: {
      title: "Balanced Grower", emoji: "🌳", focus: "invest",
      summary: "Growth-minded but measured. You can ride out normal dips; a core of index funds plus a few companies you understand suits you.",
      suggest: "Build a core with the Goal planner, then explore Copy an investor with paper money.",
    },
    opportunist: {
      title: "Opportunity Hunter", emoji: "🦊", focus: "invest",
      summary: "Curious, research-driven, comfortable with volatility. You like picking stocks and following smart money, holding for weeks to years.",
      suggest: "Try Copy an investor, follow your watchlist news, and paper-trade your ideas first.",
    },
    trader: {
      title: "Active Trader", emoji: "⚡", focus: "trade",
      summary: "Fast, hands-on and loss-tolerant, with time to watch the market. Day trading is a skill game where most beginners lose — your edge is strict rules and small risk.",
      suggest: "Learn the Trade flow in Demo, then paper-trade live setups. Let the Time Machine veto bad odds.",
    },
  };

  const RISK_TABLE = {
    1: { risk_pct: 0.25, trades: 1, min_rr: 2.0, target: "2R", cash_buffer: 20, max_pos: 25 },
    2: { risk_pct: 0.5, trades: 2, min_rr: 2.0, target: "2R", cash_buffer: 15, max_pos: 35 },
    3: { risk_pct: 0.75, trades: 3, min_rr: 1.5, target: "1.5R", cash_buffer: 10, max_pos: 50 },
    4: { risk_pct: 1.0, trades: 3, min_rr: 1.5, target: "1.5R", cash_buffer: 10, max_pos: 60 },
    5: { risk_pct: 1.0, trades: 4, min_rr: 1.0, target: "1R", cash_buffer: 10, max_pos: 75 },
  };

  const round2 = (x) => Math.round(x * 100) / 100;

  function scoreQuiz(answers) {
    const risk = answers.risk_points || [];
    const style = answers.style_points || [];
    const flags = answers.flags || [];
    if (!risk.length || !style.length) {
      throw new Error("answer every question");
    }
    const riskAvg = risk.reduce((a, b) => a + b, 0) / risk.length;
    const styleAvg = style.reduce((a, b) => a + b, 0) / style.length;
    let level = Math.max(1, Math.min(5, Math.round(riskAvg)));
    let key;
    if (styleAvg >= 3.8 && level >= 3) {
      key = "trader";
    } else if (styleAvg >= 2.8 && level >= 3) {
      key = "opportunist";
    } else if (level >= 3 || styleAvg >= 2.5) {
      key = "grower";
    } else {
      key = "builder";
    }
    const cautions = [];
    if (flags.includes("no_emergency_fund")) {
      cautions.push("Build an emergency fund (3–6 months of expenses) before taking real market risk.");
      level = Math.min(level, 2);
    }
    if (flags.includes("need_money_soon")) {
      cautions.push("Money you need within ~3 years usually belongs in cash or short-term bonds, not stocks.");
      level = Math.min(level, 2);
    }
    if (flags.includes("panic_seller")) {
      cautions.push("You said you'd sell after a big drop. Automate investing and avoid checking prices daily.");
    }
    if (key === "trader" && flags.includes("beginner")) {
      cautions.push("You're new: stay on paper money until you have 50+ planned trades logged.");
    }
    if (key === "trader" && level < 3) {
      key = "opportunist";
    }
    return {
      archetype: key,
      risk_level: level,
      style_score: round2(styleAvg),
      risk_score: round2(riskAvg),
      cautions,
      taken: new Date().toISOString(),
      ...ARCHETYPES[key],
    };
  }

  function limitsFor(level, budget) {
    const row = RISK_TABLE[level];
    const perTrade = round2(budget * row.risk_pct / 100);
    return {
      budget,
      risk_pct: row.risk_pct,
      max_loss_per_trade_usd: perTrade,
      max_daily_loss_usd: round2(perTrade * 3),
      max_trades_per_day: row.trades,
      min_reward_risk: row.min_rr,
      default_target: row.target,
      cash_buffer_pct: row.cash_buffer,
      max_position_pct: row.max_pos,
      max_order_usd: round2(budget * row.max_pos / 100),
      flat_by: "15:55",
      no_entries_before: "09:45",
      no_entries_after: "15:30",
    };
  }

  function defaultProfile(name, email) {
    return {
      name,
      email,
      created: new Date().toISOString(),
      onboarded: false,
      quiz: null,
      watchlist: ["SPY", "AAPL", "MSFT", "NVDA", "TSLA"],
      budget: 5000,
      limits: null,
      paper: { start_cash: 10000, cash: 10000, positions: {}, history: [], snapshots: [] },
      goal: { tickers: "SPY", years: 20, initial: 1000, monthly: 200, target: 100000 },
      guide_done: [],
    };
  }

  // ---------------------------------------------------------- market
  async function quote(symbol) {
    const market = await load("market");
    const q = market.quotes[symbol];
    if (!q) {
      throw new Error(`${symbol} is not in the demo snapshot (has ${Object.keys(market.quotes).join(", ")}). Run Trade Twin on your computer for any ticker.`);
    }
    return q;
  }

  async function paperState(profile) {
    const paper = profile.paper;
    const rows = [];
    let holdings = 0;
    for (const [sym, pos] of Object.entries(paper.positions)) {
      const q = await quote(sym).catch(() => null);
      const price = q ? q.price : pos.cost / pos.qty;
      const value = pos.qty * price;
      holdings += value;
      rows.push({
        symbol: sym,
        name: q ? q.name : sym,
        qty: Math.round(pos.qty * 1e6) / 1e6,
        avg_cost: pos.cost / pos.qty,
        price,
        value: round2(value),
        gain: round2(value - pos.cost),
        gain_pct: pos.cost ? round2((value / pos.cost - 1) * 100) : 0,
        day_pct: q ? q.change_pct : null,
        spark: q ? q.spark : [],
      });
    }
    rows.sort((a, b) => b.value - a.value);
    const value = round2(paper.cash + holdings);
    const today = new Date().toISOString().slice(0, 10);
    const snaps = paper.snapshots;
    if (snaps.length && snaps[snaps.length - 1][0] === today) {
      snaps[snaps.length - 1][1] = value;
    } else {
      snaps.push([today, value]);
    }
    return {
      cash: round2(paper.cash),
      start_cash: paper.start_cash,
      value,
      gain: round2(value - paper.start_cash),
      gain_pct: round2((value / paper.start_cash - 1) * 100),
      positions: rows,
      history: paper.history.slice(-50).reverse(),
      snapshots: snaps.slice(-365),
      errors: {},
    };
  }

  // Parse a user-supplied number: finite and within [low, high], else a friendly error.
  function num(value, name, low, high, fallback) {
    if (value === undefined || value === null || value === "") {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`${name} is required`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`${name} must be a number`);
    }
    if (low !== undefined && n < low) {
      throw new Error(`${name} must be at least ${low}`);
    }
    if (high !== undefined && n > high) {
      throw new Error(`${name} must be at most ${high}`);
    }
    return n;
  }

  async function paperOrder(profile, symbol, side, dollars, qty, note) {
    symbol = String(symbol || "").trim().toUpperCase();
    const q = await quote(symbol);
    const price = q.price;
    if (dollars !== undefined && dollars !== null && dollars !== "") {
      qty = Number(dollars) / price;
    }
    qty = Number(qty || 0);
    if (!(qty > 0)) {
      throw new Error("enter an amount");
    }
    const paper = profile.paper;
    const pos = paper.positions[symbol];
    if (side === "buy") {
      const cost = qty * price;
      if (cost > paper.cash + 0.005) {
        throw new Error(`not enough paper cash ($${paper.cash.toFixed(2)} available)`);
      }
      paper.cash -= cost;
      if (pos) {
        pos.qty += qty;
        pos.cost += cost;
      } else {
        paper.positions[symbol] = { qty, cost };
      }
    } else if (side === "sell") {
      if (!pos || pos.qty + 1e-9 < qty) {
        throw new Error(`you hold ${(pos ? pos.qty : 0).toFixed(4)} ${symbol}`);
      }
      const avg = pos.cost / pos.qty;
      paper.cash += qty * price;
      pos.qty -= qty;
      pos.cost -= avg * qty;
      if (pos.qty < 1e-6) {
        delete paper.positions[symbol];
      }
    } else {
      throw new Error("side must be buy or sell");
    }
    const fill = { symbol, side, qty: Math.round(qty * 1e6) / 1e6, price, amount: round2(qty * price) };
    paper.history.push({ time: new Date().toISOString(), note: note || "", ...fill });
    return fill;
  }

  // ------------------------------------------------- goal planner (10,000 futures)
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pct(values, q) {
    const sorted = Float64Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  }

  async function goalSim(tickers, years, initial, monthlyAdd, goal) {
    const monthly = await load("monthly");
    const missing = tickers.filter((t) => !monthly[t]);
    if (missing.length) {
      throw new Error(`Demo history covers ${Object.keys(monthly).join(", ")}. ${missing.join(", ")} needs the full app on your computer.`);
    }
    const weight = 1 / tickers.length;
    const months = Object.keys(monthly[tickers[0]])
      .filter((m) => tickers.every((t) => m in monthly[t]))
      .sort();
    if (months.length < 60) {
      throw new Error(`need at least 5 years of shared history; ${months.length} months available`);
    }
    const history = months.map((m) => tickers.reduce((sum, t) => sum + weight * monthly[t][m], 0));
    const paths = 10000;
    const nMonths = Math.round(years * 12);
    const rand = rng32(19);
    const yearly = Array.from({ length: years + 1 }, () => new Float64Array(paths));
    const finals = new Float64Array(paths);
    const worst = new Float64Array(paths);
    for (let p = 0; p < paths; p++) {
      let value = initial;
      let peak = value;
      let dd = 0;
      yearly[0][p] = value;
      let m = 0;
      while (m < nMonths) {
        const start = Math.floor(rand() * history.length);
        for (let k = 0; k < 12 && m < nMonths; k++) {
          value = (value + monthlyAdd) * (1 + history[(start + k) % history.length]);
          if (value > peak) {
            peak = value;
          }
          if (peak > 0) {
            dd = Math.min(dd, value / peak - 1);
          }
          m += 1;
          if (m % 12 === 0) {
            yearly[m / 12][p] = value;
          }
        }
      }
      finals[p] = value;
      worst[p] = dd;
    }
    const contributed = initial + monthlyAdd * nMonths;
    let growth = 1;
    let hpeak = 1;
    let maxDd = 0;
    for (const r of history) {
      growth *= 1 + r;
      hpeak = Math.max(hpeak, growth);
      maxDd = Math.min(maxDd, growth / hpeak - 1);
    }
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, r) => a + (r - mean) ** 2, 0) / (history.length - 1);
    let worst12 = Infinity;
    for (let i = 0; i + 12 <= history.length; i++) {
      let g = 1;
      for (let k = 0; k < 12; k++) {
        g *= 1 + history[i + k];
      }
      worst12 = Math.min(worst12, g - 1);
    }
    const historyYears = months.length / 12;
    const count = (arr, test) => arr.reduce((n, v) => n + (test(v) ? 1 : 0), 0);
    return {
      weights: Object.fromEntries(tickers.map((t) => [t, round2(weight * 100)])),
      years, initial, monthly: monthlyAdd, goal, paths, seed: 19,
      contributed: round2(contributed),
      bands: yearly.map((col) => [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => round2(pct(col, q)))),
      median: round2(pct(finals, 0.5)),
      p5: round2(pct(finals, 0.05)),
      p95: round2(pct(finals, 0.95)),
      p_goal: goal ? count(finals, (v) => v >= goal) / paths : null,
      p_loss: count(finals, (v) => v < contributed) / paths,
      median_worst_drop: Math.round(pct(worst, 0.5) * 1000) / 10,
      bad_case_worst_drop: Math.round(pct(worst, 0.05) * 1000) / 10,
      history: {
        from: months[0],
        to: months[months.length - 1],
        months: months.length,
        cagr_pct: round2((growth ** (1 / historyYears) - 1) * 100),
        vol_pct: round2(Math.sqrt(variance) * Math.sqrt(12) * 100),
        max_drawdown_pct: Math.round(maxDd * 1000) / 10,
        worst_12m_pct: Math.round(worst12 * 1000) / 10,
      },
      warnings: historyYears < 20
        ? [`Only ${Math.round(historyYears)} years of shared history, which may not include a full crash and recovery. Results are likely too optimistic. For a longer record try SPY (since 1993) or a mix like SPY + AGG.`]
        : [],
      note: `Built in your browser from ${tickers.join("/")}'s monthly total returns ${months[0]} to ${months[months.length - 1]} (block bootstrap, 12-month blocks, rebalanced monthly, 10,000 paths). Not a prediction.`,
    };
  }

  // ------------------------------------------------ day trade (TSLA replay)
  function sizing(plan, limits) {
    const per = plan.risk_per_share;
    const entry = plan.entry;
    const budget = limits.budget;
    const candidates = [
      { name: "max loss", shares: Math.floor(limits.max_loss_per_trade_usd / per), how: `$${limits.max_loss_per_trade_usd} max loss / ${per} risk a share` },
      { name: "position cap", shares: Math.floor(budget * limits.max_position_pct / 100 / entry), how: `${limits.max_position_pct}% of $${budget} / ${entry}` },
      { name: "max order", shares: Math.floor(limits.max_order_usd / entry), how: `$${limits.max_order_usd} / ${entry}` },
      { name: "cash", shares: Math.floor(budget * (1 - limits.cash_buffer_pct / 100) / entry), how: `budget minus ${limits.cash_buffer_pct}% cash buffer / ${entry}` },
    ];
    const binding = candidates.reduce((a, b) => (b.shares < a.shares ? b : a));
    candidates.forEach((c) => (c.binds = c === binding));
    const qty = Math.max(0, binding.shares);
    return {
      sizing: {
        symbol: plan.symbol, qty, bound_by: binding.name,
        cost: round2(qty * entry), max_loss: round2(qty * per),
        budget, max_loss_per_trade_usd: limits.max_loss_per_trade_usd,
        limits: candidates,
        refusal: plan.reward_risk + 1e-9 < limits.min_reward_risk
          ? `reward:risk ${plan.reward_risk.toFixed(2)} is under your minimum ${limits.min_reward_risk.toFixed(2)}, so the risk check would block it. No order. Skip it, or plan a bigger target.`
          : qty === 0 ? `Your $${limits.max_loss_per_trade_usd} max loss can't cover even 1 share at ${per} risk a share.` : null,
      },
      orders: qty && plan.reward_risk + 1e-9 >= limits.min_reward_risk ? [{ why: `opening-range breakout on ${plan.symbol}: ${qty} shares, bound by your ${binding.name} (${qty} x ${per} = $${round2(qty * per)} at the stop)` }] : [],
    };
  }

  function riskCheck(plan, size, limits) {
    const s = size.sizing;
    const reasons = [];
    if (!s.qty) {
      reasons.push("no shares fit your limits");
    }
    if (s.max_loss > limits.max_loss_per_trade_usd + 1e-9) {
      reasons.push(`max loss $${s.max_loss} is over your $${limits.max_loss_per_trade_usd} limit`);
    }
    if (plan.reward_risk + 1e-9 < limits.min_reward_risk) {
      reasons.push(`reward:risk ${plan.reward_risk} is below your minimum ${limits.min_reward_risk}`);
    }
    const verdict = reasons.length ? "BLOCK" : "PASS";
    return {
      results: [{
        verdict, symbol: plan.symbol, side: "buy", amount: `${s.qty} shares`, reasons, warnings: [],
        info: [
          `entry ${plan.entry}, stop ${plan.stop}, target ${plan.target}: risk ${plan.risk_per_share} a share`,
          `max loss $${s.max_loss} (limit $${limits.max_loss_per_trade_usd}), reward:risk ${plan.reward_risk} (min ${limits.min_reward_risk})`,
        ],
      }],
      pass: verdict === "PASS" ? 1 : 0,
      block: verdict === "BLOCK" ? 1 : 0,
      paper: true,
    };
  }

  async function trade(profile, store, mode, step, params) {
    if (mode !== "demo") {
      return fail("Live checks need the Trade Twin server running on your computer. In this web demo, use Demo (TSLA replay).");
    }
    const data = await load("trade");
    const limits = profile.limits || limitsFor(2, profile.budget || 5000);
    const session = store.trade || (store.trade = {});
    if (step === "scanner") {
      return { ok: true, data: data.scanner };
    }
    if (step === "entry") {
      const symbol = String(params.symbol || "").toUpperCase();
      if (symbol !== "TSLA") {
        return fail("demo data only has TSLA; the live market needs the app on your computer");
      }
      session.entry = true;
      return { ok: true, data: data.entry };
    }
    if (step === "exit") {
      const target = data.plans[params.target_rule] ? params.target_rule : "2R";
      session.target = target;
      return { ok: true, data: data.plans[target].exit };
    }
    const target = session.target || limits.default_target || "2R";
    const plan = data.plans[target].exit;
    if (step === "timemachine") {
      return { ok: true, data: data.plans[target].timemachine };
    }
    const size = sizing(plan, limits);
    if (step === "budget") {
      return { ok: true, data: size };
    }
    const risk = riskCheck(plan, size, limits);
    if (step === "risk") {
      return { ok: true, data: risk };
    }
    if (step === "broker") {
      const s = size.sizing;
      const ready = risk.pass === 1;
      return {
        ok: true,
        data: [{
          index: 1, ready, paper: true, broker: "alpaca",
          status: ready ? "READY: risk check PASS, waiting for your yes" : "NOT READY: the risk check blocked this order",
          plain: `BUY ${s.qty} ${plan.symbol}, market, good for today / stop-loss ${plan.stop} / take-profit ${plan.target} / max loss about $${s.max_loss} if the stop fills at ${plan.stop} (it can fill worse in a fast market)`,
          why: size.orders.length ? size.orders[0].why : "",
        }],
      };
    }
    return fail("unknown step " + step);
  }

  // ------------------------------------------------------------ router
  async function api(path, body = {}) {
    const route = path.replace(/^\/?api\//, "");
    const store = readStore();
    try {
      if (route === "signup") {
        const username = String(body.username || "").trim().toLowerCase();
        if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
          return fail("username: 3-24 letters, numbers, dot or underscore");
        }
        if (String(body.password || "").length < 8) {
          return fail("password must be at least 8 characters");
        }
        if (!String(body.name || "").trim()) {
          return fail("enter your name");
        }
        if (store.users[username]) {
          return fail("that username is taken (on this browser)");
        }
        store.users[username] = {
          hash: await digest(username + ":" + body.password),
          profile: defaultProfile(String(body.name).trim(), String(body.email || "").trim()),
        };
        store.session = username;
        writeStore(store);
        return { ok: true, profile: store.users[username].profile };
      }
      if (route === "login") {
        const username = String(body.username || "").trim().toLowerCase();
        const user = store.users[username];
        if (!user || user.hash !== await digest(username + ":" + (body.password || ""))) {
          return fail("wrong username or password");
        }
        store.session = username;
        writeStore(store);
        return { ok: true, profile: user.profile };
      }
      const user = store.session && store.users[store.session];
      if (!user) {
        return fail("login required", { auth: false });
      }
      const profile = user.profile;
      const save = () => writeStore(store);
      switch (route) {
        case "logout":
          store.session = null;
          save();
          return { ok: true };
        case "me":
          return { ok: true, profile };
        case "profile": {
          for (const key of ["name", "email", "goal", "onboarded", "guide_done"]) {
            if (key in body) {
              profile[key] = body[key];
            }
          }
          if ("watchlist" in body) {
            profile.watchlist = [...new Set(body.watchlist.map((s) => String(s).trim().toUpperCase()).filter(Boolean))].slice(0, 40);
          }
          if ("budget" in body) {
            const budget = num(body.budget, "budget", 1, 1e9);
            profile.budget = budget;
            profile.limits = limitsFor((profile.quiz || {}).risk_level || 2, budget);
          }
          if (body.limits) {
            const limits = profile.limits || limitsFor(2, profile.budget);
            for (const [key, value] of Object.entries(body.limits)) {
              if (key in limits && value !== "" && value !== null) {
                limits[key] = typeof limits[key] === "number" ? num(value, key, 0, 1e9) : String(value).slice(0, 20);
              }
            }
            profile.limits = limits;
          }
          save();
          return { ok: true, profile };
        }
        case "quiz": {
          const result = scoreQuiz(body.answers || {});
          profile.quiz = result;
          profile.limits = limitsFor(result.risk_level, profile.budget || 5000);
          if (body.paper_cash && !Object.keys(profile.paper.positions).length && !profile.paper.history.length) {
            const cash = num(body.paper_cash, "practice money", 100, 1e9);
            profile.paper.cash = cash;
            profile.paper.start_cash = cash;
          }
          save();
          return { ok: true, profile };
        }
        case "quotes": {
          const quotes = {};
          const errors = {};
          for (const sym of body.symbols || profile.watchlist) {
            try {
              quotes[sym] = await quote(sym);
            } catch (error) {
              errors[sym] = "not in demo snapshot";
            }
          }
          return { ok: true, quotes, errors };
        }
        case "chart": {
          const market = await load("market");
          const sym = String(body.symbol || "").toUpperCase();
          const charts = market.charts[sym];
          if (!charts) {
            await quote(sym);
          }
          return { ok: true, data: charts[body.span || "1D"] || charts["1D"] };
        }
        case "paper": {
          const paper = await paperState(profile);
          save();
          return { ok: true, paper };
        }
        case "paper/order": {
          const fill = await paperOrder(profile, body.symbol, body.side, body.dollars, body.qty, body.note);
          const paper = await paperState(profile);
          save();
          return { ok: true, fill, paper };
        }
        case "paper/copy": {
          const amount = Number(body.amount || 0);
          if (!(amount > 0) || amount > profile.paper.cash + 0.005) {
            return fail(`amount must be between $0 and your paper cash ($${profile.paper.cash.toFixed(2)})`);
          }
          const weights = body.weights || [];
          weights.forEach((w) => {
            w.weight = num(w.weight, "weight", 0);
          });
          const total = weights.reduce((a, w) => a + w.weight, 0) || 1;
          const fills = [];
          const errors = [];
          for (const w of weights) {
            try {
              fills.push(await paperOrder(profile, w.ticker, "buy", amount * w.weight / total, null, body.note || "copy"));
            } catch (error) {
              errors.push(`${w.ticker}: ${error.message}`);
            }
          }
          const paper = await paperState(profile);
          save();
          return { ok: true, fills, errors, paper };
        }
        case "paper/reset": {
          const cash = num(body.cash, "practice money", 100, 1e9, profile.paper.start_cash);
          profile.paper = { start_cash: cash, cash, positions: {}, history: [], snapshots: [] };
          save();
          return { ok: true, paper: await paperState(profile) };
        }
        case "goal": {
          const tickers = String(body.tickers || "").split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
          if (!tickers.length) {
            return fail("pick at least one ticker");
          }
          const years = Math.round(num(body.years, "years", 1, 40, 20));
          const result = await goalSim(
            tickers,
            years,
            num(body.initial, "starting amount", 0, 1e10, 0),
            num(body.monthly, "monthly amount", 0, 1e8, 0),
            num(body.target, "goal", 0, 1e12, 0),
          );
          profile.goal = { tickers: tickers.join(","), years, initial: body.initial, monthly: body.monthly, target: body.target };
          save();
          return { ok: true, result };
        }
        case "news": {
          const news = await load("news");
          return { ok: true, data: news, tickers: news.tickers };
        }
        case "copycat": {
          const copycat = await load("copycat");
          if (body.action === "filers") {
            const featured = new Set(copycat.demo_ciks);
            return { filers: [...copycat.filers].sort((a, b) => featured.has(b.cik) - featured.has(a.cik)) };
          }
          const cik = String(body.cik || "").padStart(10, "0");
          if (!copycat.copy[cik]) {
            return fail("This web demo includes Berkshire Hathaway, Scion (Burry), Pershing Square (Ackman), ARK (Cathie Wood) and Baupost (Klarman). Run Trade Twin on your computer to read any investor's latest 13F live from SEC EDGAR.");
          }
          return { ok: true, data: body.action === "diff" ? copycat.diff[cik] : copycat.copy[cik] };
        }
        case "trade": {
          const result = await trade(profile, store, body.mode, body.step, body.params || {});
          save();
          return result;
        }
        case "trade/reset":
          store.trade = {};
          save();
          return { ok: true };
        default:
          return fail("not available in the web demo");
      }
    } catch (error) {
      return fail(error.message || String(error));
    }
  }

  window.TradeTwinDemo = {
    api,
    meta: () => load("meta"),
  };
})();
