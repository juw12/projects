/* Twin Academy — interactive classes (3 levels × 4 lessons).
 *
 * Each lesson: short reading → hands-on widget → quiz with instant feedback.
 * First completion earns points; finishing a level earns a badge, a completion card
 * and unlocks the next level. Progress is stored like other Twin practice data.
 * Educational only: illustrative numbers are labelled, nothing here is advice and the
 * completion card is not an accredited qualification.
 */
"use strict";

const LESSON_XP = 50;
const COURSE_XP = 100;

/* ------------------------------------------------------------ progress */
function academy() {
  const saved = proRead("academy", null) || {};
  return { done: saved.done || {}, badges: saved.badges || [], days: saved.days || [] };
}
function academyDone(lessonId) {
  return Boolean(academy().done[lessonId]);
}
function academyXp(progress = academy()) {
  const lessons = Object.keys(progress.done).length * LESSON_XP;
  return lessons + progress.badges.length * COURSE_XP;
}
function academyStreak(progress = academy()) {
  const days = new Set(progress.days);
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
function courseProgress(course, progress = academy()) {
  const done = course.lessons.filter((l) => progress.done[l.id]).length;
  return { done, total: course.lessons.length, pct: Math.round(100 * done / course.lessons.length) };
}
function courseUnlocked(index, progress = academy()) {
  return index === 0 || courseProgress(COURSES[index - 1], progress).done === COURSES[index - 1].lessons.length;
}
function completeLesson(course, lesson) {
  const progress = academy();
  const first = !progress.done[lesson.id];
  const today = new Date().toISOString().slice(0, 10);
  progress.done[lesson.id] = progress.done[lesson.id] || new Date().toISOString();
  if (!progress.days.includes(today)) {
    progress.days.push(today);
  }
  let badge = false;
  if (courseProgress(course, progress).done === course.lessons.length && !progress.badges.includes(course.id)) {
    progress.badges.push(course.id);
    badge = true;
  }
  proWrite("academy", progress);
  return { first, badge };
}

/* ------------------------------------------------------------- helpers */
function slider(label, min, max, step, value, format, onInput) {
  const out = h("b", {}, format(value));
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label, style: "padding:0;border:0;background:none" });
  input.addEventListener("input", () => {
    out.textContent = format(Number(input.value));
    onInput(Number(input.value));
  });
  return { el: h("div", { style: "margin:8px 0" }, h("div", { class: "between small" }, h("span", { class: "muted" }, label), out), input), input };
}
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pctFmt = (v) => `${Number(v).toFixed(1).replace(/\.0$/, "")}%`;
const moneyFmt = (v) => fmtMoney(v, 0);

/* -------------------------------------------------------------- widgets */
// Each widget(box, done) renders into box; call done() when a required task is finished.
const WIDGETS = {
  compound(box) {
    let monthly = 200;
    let years = 20;
    let rate = 7;
    const canvas = h("canvas");
    const result = h("div", { class: "grid3", style: "margin-top:8px" });
    const draw = () => {
      const balances = [0];
      const paid = [0];
      let balance = 0;
      for (let m = 1; m <= years * 12; m++) {
        balance = balance * (1 + rate / 100 / 12) + monthly;
        if (m % 12 === 0) {
          balances.push(balance);
          paid.push(monthly * m);
        }
      }
      result.replaceChildren(
        h("div", { class: "stat" }, h("div", { class: "k" }, "Ending value"), h("div", { class: "v", style: "font-size:16px" }, moneyFmt(balance))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "You put in"), h("div", { class: "v", style: "font-size:16px" }, moneyFmt(monthly * years * 12))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Growth"), h("div", { class: "v up", style: "font-size:16px" }, moneyFmt(balance - monthly * years * 12))));
      afterPaint(() => proChart(canvas, { height: 140, series: [{ values: balances, color: "#4c8dff" }, { values: paid, color: "#8a97a8", fill: false, dash: [4, 3] }] }));
    };
    put(box,
      slider("Monthly amount", 0, 2000, 25, monthly, moneyFmt, (v) => { monthly = v; draw(); }).el,
      slider("Years", 1, 40, 1, years, (v) => `${v} yrs`, (v) => { years = v; draw(); }).el,
      slider("Yearly return (illustrative)", 0, 12, 0.5, rate, pctFmt, (v) => { rate = v; draw(); }).el,
      canvas, h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--blue)" }), "Balance"), h("span", {}, h("i", { style: "background:var(--muted)" }), "Money you added")),
      result);
    draw();
  },
  riskReturn(box) {
    let stocks = 60;
    const out = h("div");
    const draw = () => {
      const w = stocks / 100;
      const mean = w * 8 + (1 - w) * 3.5;
      const sd = Math.sqrt((w * 16) ** 2 + ((1 - w) * 6) ** 2 + 2 * w * (1 - w) * 16 * 6 * 0.1);
      out.replaceChildren(h("div", { class: "grid3" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Average year"), h("div", { class: "v", style: "font-size:16px" }, pctFmt(mean))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "2 in 3 years"), h("div", { class: "v", style: "font-size:14px" }, `${pctFmt(mean - sd)} to ${pctFmt(mean + sd)}`)),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Bad year (1 in 20)"), h("div", { class: "v down", style: "font-size:16px" }, pctFmt(mean - 1.65 * sd)))),
        h("div", { class: "bar", style: "margin-top:10px;height:14px" }, h("div", { style: `width:${stocks}%;background:var(--blue)` }), h("div", { style: `width:${100 - stocks}%;background:var(--green)` })),
        h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--blue)" }), `Stocks ${stocks}%`), h("span", {}, h("i", { style: "background:var(--green)" }), `Bonds ${100 - stocks}%`)),
        h("p", { class: "tiny muted" }, "Illustrative assumptions: stocks 8% average / 16% swings, bonds 3.5% / 6%. Real markets can do worse."));
    };
    put(box, slider("Stocks in the mix", 0, 100, 5, stocks, (v) => `${v}%`, (v) => { stocks = v; draw(); }).el, out);
    draw();
  },
  diversify(box) {
    let n = 1;
    const canvas = h("canvas");
    const out = h("div");
    const vol = (k) => 35 * Math.sqrt(0.3 + 0.7 / k);
    const draw = () => {
      out.replaceChildren(h("p", { class: "small" }, `With ${n} stock${n > 1 ? "s" : ""}, typical yearly swings ≈ `, h("b", {}, pctFmt(vol(n))), `. The floor is ≈ ${pctFmt(vol(1e9))}: market risk you can't diversify away.`));
      const values = Array.from({ length: 50 }, (_, i) => vol(i + 1));
      const marker = values.map((v, i) => (i + 1 === n ? v : null));
      afterPaint(() => proChart(canvas, { height: 120, series: [{ values, color: "#a78bfa" }, { values: marker, color: "#ef4444", fill: false, width: 6 }] }));
    };
    put(box, slider("Number of different stocks", 1, 50, 1, n, (v) => `${v}`, (v) => { n = v; draw(); }).el, canvas,
      h("p", { class: "tiny muted" }, "Model: each stock swings 35%/yr, average correlation 0.3 (illustrative)."), out);
    draw();
  },
  fees(box) {
    let fee = 1;
    const out = h("div");
    const draw = () => {
      const gross = 10000 * 1.07 ** 30;
      const net = 10000 * (1.07 - fee / 100) ** 30;
      const real = net / 1.03 ** 30;
      out.replaceChildren(h("div", { class: "grid3" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "No fee"), h("div", { class: "v", style: "font-size:16px" }, moneyFmt(gross))),
        h("div", { class: "stat" }, h("div", { class: "k" }, `With ${pctFmt(fee)} fee`), h("div", { class: "v", style: "font-size:16px" }, moneyFmt(net))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Fee cost"), h("div", { class: "v down", style: "font-size:16px" }, pctFmt(100 * (1 - net / gross))))),
        h("p", { class: "small" }, `After 3% yearly inflation, ${moneyFmt(net)} in 30 years buys what `, h("b", {}, moneyFmt(real)), " buys today."));
    };
    put(box, h("p", { class: "small muted" }, "$10,000 invested for 30 years at 7%/yr (illustrative)."),
      slider("Yearly fee", 0, 2, 0.05, fee, (v) => `${v.toFixed(2)}%`, (v) => { fee = v; draw(); }).el, out);
    draw();
  },
  sorter(box, done) {
    const items = [["AAPL", "Single stock"], ["VTI", "Stock fund (ETF)"], ["AGG", "Bond fund"], ["GLD", "Commodity fund"], ["KO", "Single stock"], ["QQQ", "Stock fund (ETF)"]];
    const groups = ["Single stock", "Stock fund (ETF)", "Bond fund", "Commodity fund"];
    const placed = {};
    let picked = null;
    const area = h("div");
    const draw = () => {
      const left = items.filter(([s]) => !placed[s]);
      area.replaceChildren(
        h("p", { class: "small muted" }, picked ? `Where does ${picked} go?` : "Tap a ticker, then tap its group."),
        h("div", { class: "chips" }, left.map(([s]) => h("button", { class: "chip" + (picked === s ? " on" : ""), "data-item": s, onclick: () => { picked = s; draw(); } }, s))),
        h("div", { class: "grid2" }, groups.map((g) => h("div", {
          class: "stat", "data-group": g, style: "cursor:pointer;min-height:64px",
          onclick: () => {
            if (!picked) {
              return;
            }
            const right = items.find(([s]) => s === picked)[1] === g;
            toast(right ? `✓ ${picked} is a ${g.toLowerCase()}` : `Not quite — try again`);
            if (right) {
              placed[picked] = g;
            }
            picked = null;
            draw();
            if (Object.keys(placed).length === items.length) {
              done();
            }
          },
        }, h("div", { class: "k" }, g), h("div", { class: "small", style: "font-weight:700" }, items.filter(([s]) => placed[s] === g).map(([s]) => s).join(" · ") || "—")))));
    };
    draw();
    put(box, area);
  },
  async chartRead(box, done) {
    put(box, spinner("Loading a year of SPY…"));
    const r = await api("api/chart", { symbol: "SPY", span: "1Y" });
    box.replaceChildren();
    if (!r.ok) {
      put(box, errorBox(r.error));
      done();
      return;
    }
    const closes = r.data.points.map((p) => p[1]);
    const sma50 = TwinPro.sma(closes, 50);
    const last = closes[closes.length - 1];
    const above = last > sma50[sma50.length - 1];
    const stats = TwinPro.seriesStats(closes);
    const canvas = h("canvas");
    const feedback = h("div");
    const answered = new Set();
    const ask = (id, question, options, correct, why) => h("div", { class: "card tight" }, h("b", { class: "small" }, question),
      h("div", { class: "chips", style: "margin-top:6px" }, options.map((o) => h("button", {
        class: "chip", "data-answer": o,
        onclick: (event) => {
          const ok = o === correct;
          event.target.style.background = ok ? "var(--green)" : "var(--red)";
          event.target.style.color = "#fff";
          feedback.replaceChildren(h("div", { class: ok ? "ok" : "err", style: "white-space:normal" }, ok ? "✓ " + why : "Not quite. " + why));
          if (ok) {
            answered.add(id);
          }
          if (answered.size === 2) {
            done();
          }
        },
      }, o))));
    const dd = Math.abs(stats.max_drawdown_pct);
    const ddOptions = [Math.max(1, Math.round(dd / 3)), Math.round(dd), Math.round(dd * 2.5 + 5)].map((v) => `about ${v}%`);
    put(box, canvas,
      h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--green)" }), "SPY daily close"), h("span", {}, h("i", { style: "background:#f5b301" }), "50-day average")),
      ask("trend", "On the last day, is SPY above its 50-day average?", ["Above", "Below"], above ? "Above" : "Below",
        `SPY closed at ${fmtPrice(last)} vs a 50-day average of ${fmtPrice(sma50[sma50.length - 1])}. Above the average often means an uptrend, but it predicts nothing on its own.`),
      ask("dd", "Drag along the chart. What was the biggest fall from a high this year?", ddOptions, `about ${Math.round(dd)}%`,
        `The worst peak-to-low drop was ${dd.toFixed(1)}%. Even "safe" index funds have drops like this.`),
      feedback);
    afterPaint(() => proChart(canvas, { height: 160, series: [{ values: closes, color: "#22c55e" }, { values: sma50, color: "#f5b301", fill: false, width: 1.3 }] }));
  },
  async dca(box) {
    put(box, spinner("Loading SPY history…"));
    const r = await api("api/chart", { symbol: "SPY", span: "1Y" });
    box.replaceChildren();
    if (!r.ok) {
      put(box, errorBox(r.error));
      return;
    }
    const closes = r.data.points.map((p) => p[1]);
    const last = closes[closes.length - 1];
    const buys = Array.from({ length: 12 }, (_, i) => closes[Math.min(closes.length - 1, i * Math.floor(closes.length / 12))]);
    const dcaShares = buys.reduce((a, p) => a + 100 / p, 0);
    const lumpShares = 1200 / closes[0];
    const best = Math.min(...buys);
    put(box, h("p", { class: "small muted" }, "Real SPY prices from the past year: $1,200 at once vs $100 a month for 12 months."),
      h("div", { class: "grid2" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "All at once"), h("div", { class: "v" }, fmtMoney(lumpShares * last))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "$100 / month"), h("div", { class: "v" }, fmtMoney(dcaShares * last)))),
      h("p", { class: "small" }, `Lowest monthly buy price: ${fmtMoney(best)}. `,
        lumpShares > dcaShares ? "This year, investing all at once won (prices mostly rose)." : "This year, spreading buys out won (prices dipped along the way)."),
      h("p", { class: "tiny muted" }, "In rising markets lump sums usually win; monthly investing mainly reduces regret and fits a paycheck."));
  },
  portfolio(box) {
    const mix = { "US stocks": 50, "Intl stocks": 20, Bonds: 25, Gold: 5, "Single stocks": 0 };
    const assume = { "US stocks": [8, 16], "Intl stocks": [7.5, 18], Bonds: [3.5, 6], Gold: [4, 15], "Single stocks": [9, 35] };
    const out = h("div");
    const draw = () => {
      const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
      const mean = Object.entries(mix).reduce((a, [k, w]) => a + w / total * assume[k][0], 0);
      const sd = Math.sqrt(Object.entries(mix).reduce((a, [k, w]) => a + (w / total * assume[k][1]) ** 2, 0) + 0.3 * 2 * (w(mix["US stocks"]) * w(mix["Intl stocks"]) * 16 * 18));
      function w(v) {
        return v / total;
      }
      const notes = [];
      if (mix["Single stocks"] / total > 0.25) {
        notes.push("Over a quarter in single stocks: one company can swing your result.");
      }
      if (mix.Bonds / total < 0.1 && mix["US stocks"] / total > 0.7) {
        notes.push("Almost all stocks: big growth potential, big drops (often 30%+).");
      }
      if (!notes.length) {
        notes.push("Balanced: spread across asset types.");
      }
      out.replaceChildren(h("div", { class: "grid2" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Average year (illustrative)"), h("div", { class: "v" }, pctFmt(mean))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Typical swing"), h("div", { class: "v" }, "±" + pctFmt(sd)))),
        h("div", { class: "warn" }, notes.join(" ")));
    };
    for (const key of Object.keys(mix)) {
      put(box, slider(key, 0, 100, 5, mix[key], (v) => `${v}`, (v) => { mix[key] = v; draw(); }).el);
    }
    put(box, out);
    draw();
  },
  orderSandbox(box, done) {
    const path = [100, 103, 107, 105, 99, 95, 97, 102, 109, 104, 98, 101];
    const typeSel = h("select", { "aria-label": "Order type" },
      [["limit-buy", "Buy limit"], ["stop-sell", "Sell stop (stop-loss)"], ["trailing-sell", "Sell trailing stop"], ["limit-sell", "Sell limit (take-profit)"]].map(([v, l]) => h("option", { value: v }, l)));
    const level = h("input", { type: "number", value: "96", "aria-label": "Price or trail %" });
    const canvas = h("canvas");
    const out = h("div");
    const tried = new Set();
    const run = () => {
      const [kind, side] = typeSel.value.split("-");
      const fields = { symbol: "DEMO", side, qty: 1 };
      if (kind === "limit") {
        Object.assign(fields, { type: "limit", limit: level.value });
      } else if (kind === "stop") {
        Object.assign(fields, { type: "stop", stop: level.value });
      } else {
        Object.assign(fields, { type: "trailing", trail_pct: level.value });
      }
      let order;
      try {
        order = TwinPro.createOrder(fields, path[0], "t0");
      } catch (error) {
        out.replaceChildren(errorBox(error.message));
        return;
      }
      let fillAt = null;
      for (let i = 1; i < path.length && fillAt === null; i++) {
        const r = TwinPro.checkOrder(order, path[i]);
        order = r.order;
        if (r.fill) {
          fillAt = i;
        }
      }
      tried.add(typeSel.value);
      const marker = path.map((v, i) => (i === fillAt ? v : null));
      afterPaint(() => proChart(canvas, { height: 140, series: [{ values: path, color: "#4c8dff" }, { values: marker, color: "#ef4444", fill: false, width: 7 }] }));
      out.replaceChildren(h("div", { class: fillAt === null ? "warn" : "ok", style: "white-space:normal" },
        fillAt === null ? `${TwinPro.describeOrder(order)} never filled on this path.` : `Filled on step ${fillAt} at $${path[fillAt]}. ${TwinPro.describeOrder(order)}.`),
        tried.size < 2 ? h("p", { class: "tiny muted" }, "Try a second order type to finish the exercise.") : null);
      if (tried.size >= 2) {
        done();
      }
    };
    typeSel.addEventListener("change", () => {
      level.value = { "limit-buy": 96, "stop-sell": 97, "trailing-sell": 8, "limit-sell": 108 }[typeSel.value];
    });
    put(box, h("p", { class: "small muted" }, "Price starts at $100. Pick an order, set its price (or trail %), and replay the path."),
      h("div", { class: "row" }, typeSel, level), h("button", { class: "btn primary", style: "margin-top:8px", id: "sandbox-run", onclick: run }, "Replay price path"), canvas, out);
    afterPaint(() => proChart(canvas, { height: 140, series: [{ values: path, color: "#4c8dff" }] }));
  },
  sizing(box) {
    let account = 10000;
    let risk = 1;
    let entry = 50;
    let stop = 47;
    const out = h("div");
    const draw = () => {
      const perShare = entry - stop;
      if (perShare <= 0) {
        out.replaceChildren(errorBox("The stop must be below the entry for a buy."));
        return;
      }
      const budget = account * risk / 100;
      const shares = Math.floor(budget / perShare);
      out.replaceChildren(h("div", { class: "grid3" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Risk budget"), h("div", { class: "v", style: "font-size:16px" }, fmtMoney(budget))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Shares"), h("div", { class: "v", style: "font-size:16px" }, String(shares))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Position"), h("div", { class: "v", style: "font-size:16px" }, fmtMoney(shares * entry)))),
        h("p", { class: "small" }, `shares = ⌊${fmtMoney(budget)} ÷ ${fmtMoney(perShare)}⌋ = ${shares}`),
        shares * entry > account ? h("div", { class: "warn" }, "That position is bigger than the account — the stop is too tight for this risk.") : null);
    };
    put(box,
      slider("Account size", 1000, 100000, 1000, account, moneyFmt, (v) => { account = v; draw(); }).el,
      slider("Risk per trade", 0.25, 5, 0.25, risk, pctFmt, (v) => { risk = v; draw(); }).el,
      slider("Entry price", 5, 200, 1, entry, moneyFmt, (v) => { entry = v; draw(); }).el,
      slider("Stop price", 1, 199, 1, stop, moneyFmt, (v) => { stop = v; draw(); }).el, out);
    draw();
  },
  expectancy(box) {
    let win = 40;
    let reward = 2;
    const canvas = h("canvas");
    const out = h("div");
    const draw = () => {
      const p = win / 100;
      const edge = p * reward - (1 - p);
      const rng = seeded(7);
      const curve = [100];
      for (let i = 0; i < 100; i++) {
        curve.push(curve[i] + (rng() < p ? reward : -1));
      }
      out.replaceChildren(h("p", { class: "small" }, "Expectancy per trade = win% × reward − loss% × 1 = ",
        h("b", { class: edge > 0 ? "up" : "down" }, `${edge >= 0 ? "+" : ""}${edge.toFixed(2)}R`),
        edge > 0 ? " — positive edge before costs." : " — this loses over time."),
        h("p", { class: "tiny muted" }, "Chart: one random run of 100 trades risking 1R each (seeded). Real runs vary a lot."));
      afterPaint(() => proChart(canvas, { height: 130, series: [{ values: curve, color: edge > 0 ? "#22c55e" : "#ef4444" }], baseline: 100 }));
    };
    put(box,
      slider("Win rate", 10, 90, 5, win, (v) => `${v}%`, (v) => { win = v; draw(); }).el,
      slider("Average win (in R)", 0.5, 5, 0.25, reward, (v) => `${v}R`, (v) => { reward = v; draw(); }).el, canvas, out);
    draw();
  },
  readiness(box, done) {
    const items = [
      "I have an emergency fund and no high-interest debt.",
      "I'll only trade money I can afford to lose.",
      "I've practised in Twin and Alpaca paper first.",
      "I'll set a max $ per order and a daily order limit.",
      "I'll use a stop-loss or a pre-set exit on every trade.",
      "I know trading gains are taxable and I'll keep records.",
      "I understand day-trading rules for small margin accounts (check my broker).",
    ];
    const ticked = new Set();
    const list = h("div");
    const draw = () => list.replaceChildren(...items.map((text, i) => h("label", { class: "row small", style: "gap:8px;margin:7px 0;cursor:pointer" },
      h("input", {
        type: "checkbox", style: "width:auto;flex:none", checked: ticked.has(i) ? "" : null, "data-check": i,
        onchange: (event) => {
          if (event.target.checked) {
            ticked.add(i);
          } else {
            ticked.delete(i);
          }
          if (ticked.size === items.length) {
            done();
          }
        },
      }), h("span", {}, text))));
    draw();
    put(box, h("p", { class: "small muted" }, "Tick each item honestly. This is your personal checklist, not advice."), list);
  },
};

/* --------------------------------------------------------------- courses */
const COURSES = [
  {
    id: "basics", level: 1, icon: "🌱", title: "Money basics", subtitle: "How investing grows money", color: "#22c55e",
    lessons: [
      { id: "compound", title: "Compound growth", minutes: 4, widget: "compound",
        read: ["Compounding means your gains start earning gains of their own.", "Time matters more than timing: the last years of a long plan add the most money.", "Move the sliders and watch how years change the gap between what you put in and what you end with."],
        quiz: [{ q: "At the same return, going from 15 to 30 years of investing will make the ending balance…", options: ["About double", "More than double", "Less than double"], answer: 1, why: "Growth stacks on growth, so doubling the time more than doubles the result." }] },
      { id: "riskreturn", title: "Risk and return", minutes: 4, widget: "riskReturn",
        read: ["Higher expected returns come with bigger swings.", "Stocks have grown faster than bonds over long periods, but they also fall harder.", "Slide the mix and compare an average year with a bad one."],
        quiz: [{ q: "Adding more stocks to a mix usually means…", options: ["Lower return, smaller swings", "Higher expected return, bigger swings", "Higher return, no extra risk"], answer: 1, why: "There's no free lunch: more expected return comes with more volatility." }] },
      { id: "diversify", title: "Diversification", minutes: 3, widget: "diversify",
        read: ["Owning many different companies smooths out the ups and downs of any one.", "Most of the benefit arrives with the first 20–30 stocks — or one broad fund.", "Some risk always stays: when the whole market falls, most stocks fall."],
        quiz: [{ q: "Can diversification remove all investment risk?", options: ["Yes, with enough stocks", "No — market-wide risk remains", "Only with bonds"], answer: 1, why: "Company-specific risk shrinks; market risk stays." }] },
      { id: "fees", title: "Fees and inflation", minutes: 3, widget: "fees",
        read: ["A small yearly fee compounds against you, just like returns compound for you.", "Inflation shrinks what money can buy, so compare returns after inflation.", "Low-cost index funds often charge under 0.1% a year."],
        quiz: [{ q: "Over 30 years at 7%, a 1% yearly fee costs roughly how much of your ending value?", options: ["About 1%", "About 25%", "About 75%"], answer: 1, why: "(1.06 ÷ 1.07)³⁰ ≈ 0.75 — roughly a quarter of the ending value." }] },
    ],
  },
  {
    id: "investing", level: 2, icon: "📈", title: "Investing", subtitle: "Funds, charts and portfolios", color: "#4c8dff",
    lessons: [
      { id: "assets", title: "Stocks, ETFs, bonds", minutes: 4, widget: "sorter", widgetRequired: true,
        read: ["A stock is a piece of one company. An ETF is a basket you buy like a stock.", "Bond funds lend money to governments or companies for interest.", "Sort the tickers into the right groups to finish."],
        quiz: [{ q: "What does buying one share of VTI give you?", options: ["One company", "A slice of thousands of US companies", "A bank deposit"], answer: 1, why: "VTI is a total-US-market ETF." }] },
      { id: "charts", title: "Reading a chart", minutes: 5, widget: "chartRead", widgetRequired: true,
        read: ["A price chart shows where a price has been, not where it will go.", "A moving average smooths noise; many people compare price to its 50-day average.", "Answer the two questions about the real SPY chart."],
        quiz: [{ q: "A price above its 50-day average…", options: ["Guarantees it keeps rising", "Shows a recent uptrend, nothing more", "Means it's undervalued"], answer: 1, why: "Indicators describe the past; they don't promise the future." }] },
      { id: "dca", title: "Lump sum vs monthly", minutes: 4, widget: "dca",
        read: ["Dollar-cost averaging means investing a fixed amount on a schedule.", "It buys more shares when prices dip and fewer when they rise.", "See how it compared with investing all at once over the past year."],
        quiz: [{ q: "The main benefit of investing monthly is…", options: ["Always higher returns", "Less timing regret and it fits a paycheck", "No losses"], answer: 1, why: "Lump sums often win in rising markets; regular investing is a behaviour tool." }] },
      { id: "build", title: "Build a portfolio", minutes: 5, widget: "portfolio",
        read: ["Allocation — how much you hold in each asset type — drives most of your risk.", "A simple mix of broad funds beats a pile of random picks for most people.", "Adjust the mix and read the feedback."],
        quiz: [{ q: "Which change lowers the risk of one company sinking your portfolio?", options: ["Buying more of your favourite stock", "Shifting single stocks into a broad fund", "Checking prices more often"], answer: 1, why: "Broad funds spread company-specific risk." }] },
    ],
  },
  {
    id: "trading", level: 3, icon: "⚡", title: "Trading", subtitle: "Orders, risk and going real", color: "#f5b301",
    lessons: [
      { id: "orders", title: "Order types", minutes: 5, widget: "orderSandbox", widgetRequired: true,
        read: ["Market orders fill now at whatever price is available.", "Limit orders set the worst price you accept; they may never fill.", "Stops become market orders once crossed; trailing stops follow the price.", "Replay the price path with two different order types."],
        quiz: [{ q: "You want to sell only if the price falls to $95, to cap a loss. Which order?", options: ["Buy limit at $95", "Sell stop at $95", "Sell limit at $95"], answer: 1, why: "A sell stop triggers when price drops to the stop. A sell limit at $95 would fill immediately above $95." }] },
      { id: "sizing", title: "Position sizing", minutes: 5, widget: "sizing",
        read: ["Decide how much you're willing to lose first, then size the trade.", "Shares = risk budget ÷ (entry − stop).", "Many traders risk 0.5–2% of the account per trade."],
        quiz: [{ q: "Account $20,000, risk 1%, entry $40, stop $38. How many shares?", options: ["50", "100", "500"], answer: 1, why: "$200 budget ÷ $2 risk per share = 100 shares." }] },
      { id: "edge", title: "Win rate vs reward", minutes: 4, widget: "expectancy",
        read: ["You don't need to win most trades if winners are bigger than losers.", "Expectancy = win% × average win − loss% × average loss.", "Costs, slippage and emotions shrink real results."],
        quiz: [{ q: "40% win rate, winners 2R, losers 1R. Expectancy per trade?", options: ["−0.2R", "+0.2R", "+0.8R"], answer: 1, why: "0.4 × 2 − 0.6 × 1 = +0.2R." }] },
      { id: "readiness", title: "Real-money readiness", minutes: 5, widget: "readiness", widgetRequired: true,
        read: ["Real money adds real emotions. Start small and use guard-rails.", "Practise in Twin, then Alpaca paper, before any live order.", "Twin's live mode adds a max $ per order, a daily order limit, a preview and a confirm step — keep them on."],
        quiz: [{ q: "Best first step before turning on live trading?", options: ["Go all-in to learn fast", "Paper-trade the same plan and set limits", "Turn off stop-losses"], answer: 1, why: "Practise the exact plan with fake money and strict limits first." }] },
    ],
  },
];

/* ------------------------------------------------------------- screens */
function renderLearn(main) {
  const progress = academy();
  const totalLessons = COURSES.reduce((a, c) => a + c.lessons.length, 0);
  const done = Object.keys(progress.done).length;
  put(main,
    h("div", { class: "card share-card p-card academy-card", id: "academy-hero" },
      h("div", { class: "hero-glow", "aria-hidden": "true" }),
      h("div", { class: "between" },
        h("div", {}, h("div", { class: "muted tiny" }, "TWIN ACADEMY"), h("h2", { style: "margin:2px 0" }, "Learn by doing")),
        h("div", { style: "font-size:34px" }, "🎓")),
      h("div", { class: "grid3", style: "margin-top:8px" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Points"), h("div", { class: "v", id: "academy-xp" }, String(academyXp(progress)))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Streak"), h("div", { class: "v" }, `${academyStreak(progress)}🔥`)),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Lessons"), h("div", { class: "v" }, `${done}/${totalLessons}`))),
      h("p", { class: "tiny muted" }, "Short interactive classes. Educational only — not financial advice.")));
  COURSES.forEach((course, index) => {
    const cp = courseProgress(course, progress);
    const unlocked = courseUnlocked(index, progress);
    const badge = progress.badges.includes(course.id);
    put(main, h("div", {
      class: "card course-card" + (unlocked ? "" : " locked"), "data-course": course.id, style: `cursor:pointer;--course:${course.color}` + (unlocked ? "" : ";opacity:0.6"),
      onclick: () => (unlocked ? openCourse(course) : toast(`Finish "${COURSES[index - 1].title}" to unlock`)),
    },
      h("div", { class: "row", style: "gap:12px" },
        h("div", { class: "course-ic", style: `--course:${course.color}` }, unlocked ? course.icon : "🔒"),
        h("div", { style: "flex:1;min-width:0" },
          h("div", { class: "tiny muted" }, `LEVEL ${course.level} · ${course.lessons.length} lessons · ${course.lessons.reduce((a, l) => a + l.minutes, 0)} min`),
          h("b", {}, course.title), h("div", { class: "small muted" }, course.subtitle)),
        badge ? h("span", { class: "pill green", style: "flex:none" }, "✓ Done") : h("span", { class: "muted", style: "flex:none" }, "›")),
      h("div", { class: "progress", style: "margin:10px 0 2px" }, h("div", { style: `width:${cp.pct}%;background:${course.color}` })),
      h("div", { class: "tiny muted" }, `${cp.done} of ${cp.total} complete`)));
  });
  if (state.academyFocus) {
    const target = COURSES.find((c) => c.id === state.academyFocus);
    state.academyFocus = null;
    const index = COURSES.indexOf(target);
    if (target && courseUnlocked(index)) {
      openCourse(target);
    }
  }
}

function openCourse(course) {
  const progress = academy();
  const cp = courseProgress(course, progress);
  openSheet(
    h("div", { style: "font-size:38px" }, course.icon),
    h("h2", { style: "margin:4px 0" }, `Level ${course.level}: ${course.title}`),
    h("p", { class: "muted small" }, course.subtitle),
    h("div", { class: "progress" }, h("div", { style: `width:${cp.pct}%;background:${course.color}` })),
    h("div", { class: "list" }, course.lessons.map((lesson, i) => h("div", { class: "item", "data-lesson": lesson.id, onclick: () => openLesson(course, lesson) },
      h("div", { class: "dot", style: `width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;flex:none;background:${progress.done[lesson.id] ? "var(--green)" : "var(--card2)"};color:${progress.done[lesson.id] ? "#04130a" : "var(--muted)"}` },
        progress.done[lesson.id] ? "✓" : i + 1),
      h("div", { style: "flex:1;min-width:0" }, h("b", {}, lesson.title), h("div", { class: "tiny muted" }, `${lesson.minutes} min · +${LESSON_XP} pts`)),
      h("span", { class: "muted" }, "›")))),
    progress.badges.includes(course.id)
      ? h("button", { class: "btn primary", style: "margin-top:12px", onclick: () => openCertificate(course) }, "🏅 View completion card")
      : h("p", { class: "tiny muted" }, `Finish all lessons for a badge, +${COURSE_XP} points and a completion card.`));
}

function openLesson(course, lesson) {
  let widgetOk = !lesson.widgetRequired;
  const answered = new Set();
  const finish = h("button", { class: "btn primary", id: "lesson-complete", disabled: "" }, academyDone(lesson.id) ? "Completed ✓ (review)" : "Complete lesson");
  const hint = h("p", { class: "tiny muted center" });
  const refresh = () => {
    const ready = widgetOk && answered.size === lesson.quiz.length;
    finish.disabled = !ready;
    hint.textContent = ready ? "" : !widgetOk ? "Finish the hands-on exercise and the quiz to complete." : "Answer the quiz correctly to complete.";
  };
  const widgetBox = h("div", { class: "card", id: "lesson-widget" });
  const quiz = lesson.quiz.map((item, qi) => {
    const feedback = h("div");
    return h("div", { class: "card tight", "data-quiz": qi },
      h("b", {}, item.q),
      h("div", { style: "margin-top:6px" }, item.options.map((option, oi) => h("button", {
        class: "opt", "data-option": oi,
        onclick: (event) => {
          const ok = oi === item.answer;
          event.target.style.borderColor = ok ? "var(--green)" : "var(--red)";
          event.target.style.background = ok ? "rgba(34,197,94,.14)" : "rgba(239,68,68,.12)";
          feedback.replaceChildren(h("div", { class: ok ? "ok" : "err", style: "white-space:normal" }, (ok ? "✓ Correct. " : "Not quite. ") + item.why));
          if (ok) {
            answered.add(qi);
          }
          refresh();
        },
      }, option))), feedback);
  });
  finish.addEventListener("click", () => {
    const result = completeLesson(course, lesson);
    closeSheet();
    if (result.badge) {
      toast(`🏅 Level ${course.level} complete! +${LESSON_XP + COURSE_XP} points`, 3500);
      setTimeout(() => openCertificate(course), 400);
    } else {
      toast(result.first ? `✓ Lesson complete · +${LESSON_XP} points` : "Lesson reviewed");
    }
    if (state.tab === "learn") {
      switchTab("learn");
    }
  });
  openSheet(
    h("div", { class: "tiny muted" }, `LEVEL ${course.level} · ${course.title.toUpperCase()}`),
    h("h2", { style: "margin:4px 0 8px" }, lesson.title),
    h("div", { class: "article" }, lesson.read.map((p) => h("p", {}, p))),
    h("h3", { style: "margin-top:14px" }, "Try it"), widgetBox,
    h("h3", {}, "Quick check"), quiz, finish, hint);
  const result = WIDGETS[lesson.widget](widgetBox, () => {
    widgetOk = true;
    refresh();
  });
  if (result && result.catch) {
    result.catch((error) => put(widgetBox, errorBox(String(error.message || error))));
  }
  refresh();
}

function openCertificate(course) {
  const progress = academy();
  const name = (state.profile && state.profile.name) || "Learner";
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const canvas = h("canvas", { style: "border-radius:14px", id: "certificate" });
  const draw = () => {
    const width = canvas.parentElement ? canvas.parentElement.clientWidth || 340 : 340;
    const height = Math.round(width * 0.66);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, "#0d1b2a");
    grad.addColorStop(1, "#14324a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = course.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.fillStyle = "#9fb3c8";
    ctx.font = "600 11px -apple-system, sans-serif";
    ctx.fillText("TWIN ACADEMY · COMPLETION CARD", 26, 38);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 22px -apple-system, sans-serif";
    ctx.fillText(`${course.icon} Level ${course.level}: ${course.title}`, 26, 74);
    ctx.font = "600 16px -apple-system, sans-serif";
    ctx.fillStyle = "#dbe7f3";
    ctx.fillText(`Completed by ${name}`, 26, 108);
    ctx.font = "13px -apple-system, sans-serif";
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(`${course.lessons.length} interactive lessons · ${date}`, 26, 132);
    ctx.fillText(`${academyXp(progress)} academy points`, 26, 152);
    ctx.font = "10.5px -apple-system, sans-serif";
    ctx.fillText("Educational practice record, not an accredited qualification.", 26, height - 26);
  };
  openSheet(
    h("h2", {}, "🏅 Completion card"),
    canvas,
    h("div", { class: "row", style: "margin-top:12px" },
      h("button", {
        class: "btn primary",
        onclick: () => canvas.toBlob((blob) => {
          const link = h("a", { href: URL.createObjectURL(blob), download: `twin-academy-level-${course.level}.png` });
          document.body.append(link);
          link.click();
          link.remove();
        }),
      }, "Download"),
      h("button", { class: "btn", onclick: () => shareText(`I finished Level ${course.level} (${course.title}) in Twin Academy. Learn investing and trading for free as a guest:`) }, "Share")),
    h("p", { class: "tiny muted" }, "Educational practice record, not an accredited qualification."));
  afterPaint(draw);
}

function academyHomeCard() {
  const progress = academy();
  for (let i = 0; i < COURSES.length; i++) {
    const course = COURSES[i];
    const next = course.lessons.find((l) => !progress.done[l.id]);
    if (next && courseUnlocked(i, progress)) {
      return h("div", {
        class: "card tight", id: "home-academy", style: "cursor:pointer",
        onclick: () => {
          switchTab("learn");
          openLesson(course, next);
        },
      }, h("div", { class: "between" },
        h("div", { class: "row", style: "gap:12px" }, h("div", { style: "font-size:26px;flex:none" }, "🎓"),
          h("div", {}, h("div", { class: "muted tiny" }, `CONTINUE LEARNING · LEVEL ${course.level}`), h("b", {}, next.title))),
        h("span", { class: "pill blue", style: "flex:none" }, `+${LESSON_XP}`)));
    }
  }
  return null;
}
