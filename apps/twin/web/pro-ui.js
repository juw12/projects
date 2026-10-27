/* Twin 1.3 UI: scrub charts, order ticket, pending orders, price alerts,
 * Replay Lab, Portfolio X-ray, movers and guest tools (share link, save progress).
 *
 * Loaded before the main inline script. Functions here only run after boot, so they
 * can use the app's helpers (h, put, api, state, toast, openSheet, ...) at call time.
 * Order and replay rules live in pro.js (unit-tested); this file is presentation + storage.
 */
"use strict";

const UNIVERSE = ["SPY", "QQQ", "VTI", "AGG", "GLD", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "KO", "AXP", "BAC", "JPM"];

(function injectProStyles() {
  const css = `
  .scrub-head .big { transition: none; }
  .scrub-canvas { touch-action: pan-y; cursor: crosshair; }
  .ind-row { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0 2px; }
  .ind-row .chip { padding:5px 10px; font-size:12.5px; }
  .range { position:relative; height:6px; background:var(--card2); border-radius:3px; margin:8px 0 4px; }
  .range i { position:absolute; top:-4px; width:14px; height:14px; border-radius:50%; background:var(--text); transform:translateX(-50%); }
  .ticket .seg { margin-top:0; }
  .ticket .types { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:8px 0; }
  .ticket .types button { border:1px solid var(--line); background:var(--card); border-radius:10px; padding:8px 4px; font-size:12.5px; font-weight:650; cursor:pointer; color:var(--text); }
  .ticket .types button.on { border-color:var(--blue); background:rgba(76,141,255,.14); }
  .preview { background:var(--card2); border-radius:12px; padding:10px 12px; font-size:13px; margin:10px 0; }
  .preview .kv { padding:4px 0; font-size:13px; }
  .order-row { display:flex; gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); }
  .order-row:last-child { border-bottom:0; }
  .replay-top { display:flex; justify-content:space-between; align-items:flex-end; gap:10px; }
  .replay-controls { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:10px; }
  .replay-controls .btn { padding:11px 4px; font-size:13.5px; }
  .tick-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
  .tick { background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:8px 6px; text-align:center; cursor:pointer; }
  .tick b { display:block; font-size:13px; }
  .tick span { font-size:11.5px; font-weight:700; }
  .legend { display:flex; gap:14px; font-size:12px; color:var(--muted); margin-top:4px; }
  .legend i { display:inline-block; width:10px; height:3px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  .mover { flex:none; background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:8px 12px; cursor:pointer; text-align:left; color:var(--text); }
  .mover b { display:block; font-size:13.5px; }
  .grade { font-size:44px; font-weight:800; line-height:1; }
  .share-card { background:linear-gradient(135deg, rgba(76,141,255,.18), rgba(34,197,94,.14)); border:1px solid var(--line); }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
})();

/* ------------------------------------------------------------- storage */
const proMemory = new Map();
function proScope() {
  const profile = state.profile || {};
  if (GUEST) {
    return "guest";
  }
  return (DEMO ? "demo:" : "server:") + (profile.created || profile.name || "me");
}
function proStorage() {
  return GUEST ? window.sessionStorage : window.localStorage;
}
function proKey(kind, scope = proScope()) {
  return `twin-pro:${kind}:${scope}`;
}
function proRead(kind, fallback) {
  const key = proKey(kind);
  try {
    const raw = proStorage().getItem(key);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (error) {
    // Storage blocked: fall back to memory for this page.
  }
  return proMemory.has(key) ? JSON.parse(proMemory.get(key)) : fallback;
}
function proWrite(kind, value) {
  const key = proKey(kind);
  const raw = JSON.stringify(value);
  proMemory.set(key, raw);
  try {
    proStorage().setItem(key, raw);
  } catch (error) {
    // Memory copy keeps working until reload.
  }
}
function proClearGuest() {
  for (const kind of ["orders", "alerts", "replay", "academy", "twinagent"]) {
    const key = proKey(kind, "guest");
    proMemory.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      // Nothing persisted.
    }
  }
}
// Move guest-only data (orders, alerts, replay) into a freshly saved profile.
function proAdoptGuest(newScope) {
  for (const kind of ["orders", "alerts", "replay", "academy", "twinagent"]) {
    let raw = proMemory.get(proKey(kind, "guest"));
    try {
      raw = sessionStorage.getItem(proKey(kind, "guest")) || raw;
    } catch (error) {
      // Use the memory copy.
    }
    if (raw) {
      try {
        localStorage.setItem(proKey(kind, newScope), raw);
      } catch (error) {
        proMemory.set(proKey(kind, newScope), raw);
      }
    }
  }
  proClearGuest();
}

/* ------------------------------------------------------- scrub chart */
const fmtDay = (t, intraday) => {
  const d = new Date(t * 1000);
  return intraday
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Multi-series line chart with Robinhood-style press-and-drag scrubbing.
// series: [{ values, color, width, dash, fill }]; first series drives scrubbing.
function proChart(canvas, opts) {
  const height = opts.height || 200;
  let hover = null;
  const draw = () => {
    const { ctx, width } = prepCanvas(canvas, height);
    const main = opts.series[0].values;
    if (!main || main.length < 2) {
      ctx.fillStyle = cssColor("--muted");
      ctx.fillText("No chart data", 10, height / 2);
      return;
    }
    const all = opts.series.flatMap((s) => s.values.filter((v) => v !== null && Number.isFinite(v)));
    if (opts.baseline !== undefined && opts.baseline !== null) {
      all.push(opts.baseline);
    }
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = 10;
    const x = (i) => (width - 2) * i / (main.length - 1) + 1;
    const y = (v) => pad + (height - 2 * pad) * (hi - v) / (hi - lo);
    const up = main[main.length - 1] >= (opts.baseline ?? main[0]);
    if (opts.baseline !== undefined && opts.baseline !== null) {
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = cssColor("--line");
      ctx.beginPath();
      ctx.moveTo(0, y(opts.baseline));
      ctx.lineTo(width, y(opts.baseline));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    opts.series.forEach((s, k) => {
      const color = adaptChartColor(s.color || (up ? "#22c55e" : "#ef4444"));
      const path = () => {
        ctx.beginPath();
        let started = false;
        s.values.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) {
            return;
          }
          if (started) {
            ctx.lineTo(x(i), y(v));
          } else {
            ctx.moveTo(x(i), y(v));
            started = true;
          }
        });
      };
      if (k === 0 && s.fill !== false) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color + "44");
        gradient.addColorStop(1, color + "00");
        path();
        ctx.lineTo(x(main.length - 1), height);
        ctx.lineTo(x(0), height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      path();
      ctx.setLineDash(s.dash || []);
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || (k === 0 ? 2 : 1.4);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    if (hover !== null) {
      ctx.strokeStyle = cssColor("--muted");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(hover), 0);
      ctx.lineTo(x(hover), height);
      ctx.stroke();
      ctx.fillStyle = cssColor("--text");
      ctx.beginPath();
      ctx.arc(x(hover), y(main[hover]), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const indexAt = (event) => {
    const rect = canvas.getBoundingClientRect();
    const n = opts.series[0].values.length;
    return Math.max(0, Math.min(n - 1, Math.round((event.clientX - rect.left) / rect.width * (n - 1))));
  };
  const move = (event) => {
    hover = indexAt(event);
    draw();
    if (opts.onScrub) {
      opts.onScrub(hover);
    }
  };
  const leave = () => {
    hover = null;
    draw();
    if (opts.onScrub) {
      opts.onScrub(null);
    }
  };
  canvas.classList.add("scrub-canvas");
  canvas.onpointerdown = move;
  canvas.onpointermove = (event) => {
    if (event.pointerType === "mouse" || event.buttons || event.pressure > 0) {
      move(event);
    }
  };
  canvas.onpointerleave = leave;
  canvas.onpointerup = (event) => {
    if (event.pointerType !== "mouse") {
      leave();
    }
  };
  canvas.onpointercancel = leave;
  chartRenderers.set(canvas, draw);
  draw();
}

/* ----------------------------------------------------------- order ticket */
const TYPE_LABELS = [
  ["market", "Market"], ["limit", "Limit"], ["stop", "Stop"],
  ["stop_limit", "Stop-limit"], ["trailing", "Trailing stop"],
];
const TYPE_HELP = {
  market: "Fills right away at the current price.",
  limit: "Buy at or below / sell at or above your price. You may not get filled.",
  stop: "Becomes a market order once the price crosses your stop. Fills can be worse in fast markets.",
  stop_limit: "Once the stop is crossed, it becomes a limit order. Safer price, but it may never fill.",
  trailing: "The stop follows the price by a set %. Sell trails below the high; buy trails above the low.",
};

// Shared ticket for the practice portfolio and Replay Lab.
// cfg: { symbol, price, side, held, cash, equity, limits, where: "live"|"replay", submit(fields) -> Promise<{ok,error,message}> }
function orderTicket(cfg) {
  const currency = cfg.currency || "USD";
  const fx = currency === "USD" ? 1 : (cfg.fx || 1);
  const unit = currency === "USD" ? "$" : currency;
  let side = cfg.side || "buy";
  let type = "market";
  let byDollars = true;
  let bracketOn = false;
  const amount = h("input", { type: "number", inputmode: "decimal", placeholder: "Amount in $", "aria-label": "Order amount" });
  const limit = h("input", { type: "number", inputmode: "decimal", placeholder: "Limit price", "aria-label": "Limit price" });
  const stop = h("input", { type: "number", inputmode: "decimal", placeholder: "Stop price", "aria-label": "Stop price" });
  const trail = h("input", { type: "number", inputmode: "decimal", placeholder: "Trail % (e.g. 8)", "aria-label": "Trail percent" });
  const tp = h("input", { type: "number", inputmode: "decimal", placeholder: "Take-profit price", "aria-label": "Take-profit price" });
  const sl = h("input", { type: "number", inputmode: "decimal", placeholder: "Stop-loss price", "aria-label": "Stop-loss price" });
  // TwinAgent can suggest values; the user still reviews and submits the ticket.
  if (cfg.prefill && side === "buy") {
    amount.value = cfg.prefill.dollars ?? "";
    if (cfg.prefill.take_profit && cfg.prefill.stop_loss) {
      bracketOn = true;
      tp.value = cfg.prefill.take_profit;
      sl.value = cfg.prefill.stop_loss;
    }
  }
  const fieldsBox = h("div");
  const bracketBox = h("div");
  const preview = h("div", { class: "preview" });
  const errorSlot = h("div");
  const sideSeg = h("div", { class: "seg" });
  const typeGrid = h("div", { class: "types" });
  const unitSeg = h("div", { class: "seg" });
  const submitButton = h("button", { class: "btn" });

  const drawSide = () => {
    sideSeg.replaceChildren(...["buy", "sell"].map((s) => h("button", {
      class: side === s ? "on" : "",
      onclick: () => {
        side = s;
        if (s === "sell") {
          bracketOn = false;
        }
        redraw();
      },
    }, s === "buy" ? "Buy" : `Sell${cfg.held ? ` (${+cfg.held.toFixed(4)} held)` : ""}`)));
  };
  const drawTypes = () => {
    typeGrid.replaceChildren(...TYPE_LABELS.map(([id, label]) => h("button", {
      class: type === id ? "on" : "", "data-type": id,
      onclick: () => {
        type = id;
        redraw();
      },
    }, label)));
  };
  const drawUnits = () => {
    unitSeg.replaceChildren(...[[true, "Dollars"], [false, "Shares"]].map(([d, label]) => h("button", {
      class: byDollars === d ? "on" : "",
      onclick: () => {
        byDollars = d;
        amount.placeholder = d ? (currency === "USD" ? "Amount in $" : "Amount in US$ (practice cash)") : "Shares";
        redraw();
      },
    }, label)));
  };
  const drawFields = () => {
    const rows = [];
    if (type === "limit" || type === "stop_limit") {
      rows.push(h("label", { class: "f" }, `Limit price (${unit})`), limit);
    }
    if (type === "stop" || type === "stop_limit") {
      rows.unshift(h("label", { class: "f" }, `Stop price (${unit})`), stop);
    }
    if (type === "trailing") {
      rows.push(h("label", { class: "f" }, "Trail by (%)"), trail);
    }
    rows.push(h("p", { class: "tiny muted", style: "margin:6px 0 0" }, TYPE_HELP[type]));
    fieldsBox.replaceChildren(...rows);
    bracketBox.replaceChildren(side === "buy" ? h("div", {},
      h("label", { class: "row small", style: "gap:8px;margin-top:10px;cursor:pointer" },
        h("input", {
          type: "checkbox", style: "width:auto;flex:none", checked: bracketOn ? "" : null,
          onchange: (event) => {
            bracketOn = event.target.checked;
            redraw();
          },
        }),
        h("span", {}, "Add take-profit / stop-loss (bracket)")),
      bracketOn ? h("div", { class: "grid2" },
        h("div", {}, h("label", { class: "f" }, `Take-profit (${unit})`), tp),
        h("div", {}, h("label", { class: "f" }, `Stop-loss (${unit})`), sl)) : null) : null);
  };
  const fields = () => {
    const f = { symbol: cfg.symbol, side, type };
    if (byDollars) {
      f.dollars = amount.value;
    } else {
      f.qty = amount.value;
    }
    if (type === "limit" || type === "stop_limit") {
      f.limit = limit.value;
    }
    if (type === "stop" || type === "stop_limit") {
      f.stop = stop.value;
    }
    if (type === "trailing") {
      f.trail_pct = trail.value;
    }
    if (bracketOn && side === "buy") {
      f.take_profit = tp.value;
      f.stop_loss = sl.value;
    }
    return f;
  };
  const updatePreview = () => {
    const f = fields();
    const value = Number(amount.value) || 0;
    const entry = Number(f.limit) || Number(f.stop) || cfg.price;
    // Amounts are in US dollars (practice cash); prices are in the listing's own currency.
    const shares = byDollars ? value / (entry * fx) : value;
    const localCost = shares * entry;
    const rows = [
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Reference price"),
        h("b", {}, currency === "USD" ? fmtMoney(cfg.price) : `${TwinGlobal.price(cfg.price, currency)} ≈ ${fmtMoney(cfg.price * fx)}`)),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Estimated size"),
        h("b", {}, value ? `${shares.toFixed(4)} sh ≈ ${currency === "USD" ? fmtMoney(localCost) : `${TwinGlobal.price(localCost, currency)} ≈ ${fmtMoney(localCost * fx)}`}` : "—")),
    ];
    const stopLevel = Number(f.stop_loss) || (side === "sell" ? null : null);
    if (side === "buy" && value && stopLevel && stopLevel < entry) {
      const risk = (entry - stopLevel) * shares * fx;
      const pctOfEquity = cfg.equity ? 100 * risk / cfg.equity : null;
      rows.push(h("div", { class: "kv" }, h("span", { class: "muted" }, "Max loss if stop fills"),
        h("b", { class: "down" }, `${fmtMoney(risk)}${pctOfEquity !== null ? ` (${pctOfEquity.toFixed(1)}% of account)` : ""}`)));
      const target = Number(f.take_profit);
      if (target > entry) {
        const rr = (target - entry) / (entry - stopLevel);
        rows.push(h("div", { class: "kv" }, h("span", { class: "muted" }, "Reward : risk"),
          h("b", { class: rr >= ((cfg.limits || {}).min_reward_risk || 1.5) ? "up" : "" }, rr.toFixed(2) + " : 1")));
      }
      const cap = (cfg.limits || {}).max_loss_per_trade_usd;
      if (cap && risk > cap) {
        rows.push(h("div", { class: "warn", style: "margin:6px 0 0" }, `Above your max loss per trade (${fmtMoney(cap)}). Consider a smaller size or a closer stop.`));
      }
    } else if (side === "buy" && value && !bracketOn && type !== "trailing") {
      rows.push(h("div", { class: "tiny muted", style: "margin-top:4px" }, "Tip: add a stop-loss to see your max loss before you trade."));
    }
    if (side === "buy" && value && shares * entry * fx > (cfg.cash || 0) + 0.005) {
      rows.push(h("div", { class: "warn", style: "margin:6px 0 0" }, `More than your cash (${fmtMoney(cfg.cash)}). ${type === "market" ? "This order will be rejected." : "It will be rejected if cash is still short when it triggers."}`));
    }
    preview.replaceChildren(...rows);
  };
  const redraw = () => {
    drawSide();
    drawTypes();
    drawUnits();
    drawFields();
    submitButton.className = "btn " + (side === "buy" ? "green" : "red");
    submitButton.textContent = cfg.where === "broker"
      ? `Review ${cfg.brokerMode === "live" ? "LIVE" : "paper"} order`
      : type === "market"
        ? `${side === "buy" ? "Buy" : "Sell"} ${cfg.symbol} now`
        : `Place ${TYPE_LABELS.find((t) => t[0] === type)[1].toLowerCase()} ${side}`;
    updatePreview();
  };
  for (const input of [amount, limit, stop, trail, tp, sl]) {
    input.addEventListener("input", updatePreview);
  }
  submitButton.addEventListener("click", async () => {
    errorSlot.replaceChildren();
    submitButton.disabled = true;
    try {
      const result = await cfg.submit(fields());
      if (!result || !result.ok) {
        put(errorSlot, errorBox((result && result.error) || "Order failed."));
      }
    } catch (error) {
      put(errorSlot, errorBox(error.message || String(error)));
    } finally {
      submitButton.disabled = false;
    }
  });
  redraw();
  return h("div", { class: "ticket" },
    sideSeg, typeGrid, unitSeg, amount, fieldsBox, bracketBox, preview, errorSlot, submitButton,
    h("p", { class: "tiny muted center", style: "margin-top:10px" },
      cfg.where === "replay"
        ? "Replay orders are checked once per day at the closing price."
        : cfg.where === "broker"
          ? `Sends a ${cfg.brokerMode === "live" ? "REAL-MONEY" : "paper"} order to ${brokerName(cfg.brokerProvider)} after a server preview and your confirmation.${cfg.brokerProvider === "ibkr" ? " IBKR trades whole shares; dollar amounts round down." : ""}`
        : (GUEST || DEMO)
          ? "Practice money. Snapshot prices don't move, so pending orders wait. Use Replay Lab to watch orders fill over time."
          : "Practice money. Pending orders are checked about once a minute while Twin is open (no background execution)."));
}

/* --------------------------------------------- pending orders (practice portfolio) */
function liveBook() {
  return proRead("orders", { orders: [] });
}
function saveLiveBook(book) {
  book.orders = book.orders.filter((o) => o.status === "open" || Date.now() - Date.parse(o.closed || o.created) < 14 * 864e5).slice(-60);
  proWrite("orders", book);
}

async function executeMarket(fields, note) {
  const body = { symbol: fields.symbol, side: fields.side, note };
  if (fields.qty) {
    body.qty = Number(fields.qty);
  } else {
    body.dollars = Number(fields.dollars);
  }
  return api("api/paper/order", body);
}

// Place an order on the practice portfolio from the ticket.
async function submitLiveOrder(fields, price) {
  let order;
  try {
    order = TwinPro.createOrder(fields, price, new Date().toISOString());
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const check = TwinPro.checkOrder(order, price);
  if (check.fill) {
    const result = await executeMarket(order, order.type === "market" ? "" : order.type + " order");
    if (!result.ok) {
      return result;
    }
    state.paper = result.paper;
    if (order.bracket && order.side === "buy") {
      const book = liveBook();
      book.orders.push(...TwinPro.bracketLegs(order, result.fill.qty, new Date().toISOString(), result.fill.price));
      saveLiveBook(book);
    }
    closeSheet();
    toast(`Practice ${order.side}: ${result.fill.qty} ${order.symbol} @ ${TwinGlobal.price(result.fill.price, result.fill.currency)}${order.bracket ? " · bracket set" : ""}`);
    switchTab(state.tab);
    return { ok: true };
  }
  const book = liveBook();
  book.orders.push(check.order);
  saveLiveBook(book);
  closeSheet();
  toast("Order placed: " + TwinPro.describeOrder(order));
  switchTab(state.tab);
  return { ok: true };
}

let syncing = false;
// Merge a sync result into the latest stored book. Fills from the sync win (they
// really happened); otherwise anything the user closed meanwhile stays closed;
// orders added meanwhile are kept; new bracket legs from the sync are appended.
function mergeOrderBooks(latest, synced, knownIds) {
  const syncedById = new Map(synced.orders.map((o) => [o.id, o]));
  const merged = latest.orders.map((current) => {
    const result = syncedById.get(current.id);
    if (!result) {
      return current;
    }
    if (result.status === "filled") {
      return result;
    }
    return current.status !== "open" ? current : result;
  });
  const present = new Set(latest.orders.map((o) => o.id));
  for (const order of synced.orders) {
    if (!present.has(order.id) && !knownIds.has(order.id)) {
      merged.push(order);
    }
  }
  return { ...latest, orders: merged };
}
// Check pending orders and price alerts against fresh quotes. Safe to call often.
async function syncLiveOrders(extraPrices = {}) {
  if (syncing || !state.profile) {
    return [];
  }
  const book = liveBook();
  const alerts = proRead("alerts", []);
  const symbols = [...new Set([
    ...book.orders.filter((o) => o.status === "open").map((o) => o.symbol),
    ...alerts.filter((a) => !a.triggered).map((a) => a.symbol),
  ])].filter((s) => !(extraPrices[s] > 0));
  if (!symbols.length && !Object.keys(extraPrices).length) {
    return [];
  }
  syncing = true;
  const messages = [];
  // The book is re-read before saving: a cancel, a new order or a guest reset can
  // happen while quotes are loading, and a stale copy must never overwrite them.
  const scopeAtStart = proKey("orders");
  const knownIds = new Set(book.orders.map((o) => o.id));
  try {
    const prices = { ...extraPrices };
    if (symbols.length) {
      const quotes = await api("api/quotes", { symbols });
      if (quotes.ok) {
        for (const [symbol, q] of Object.entries(quotes.quotes || {})) {
          prices[symbol] = q.price;
        }
      }
    }
    if (proKey("orders") !== scopeAtStart) {
      return [];
    }
    const now = new Date().toISOString();
    for (let i = 0; i < book.orders.length; i++) {
      const order = book.orders[i];
      const price = prices[order.symbol];
      const current = liveBook().orders.find((o) => o.id === order.id);
      if (current && current.status !== "open") {
        book.orders[i] = current;
        continue;
      }
      if (order.status !== "open" || !(price > 0)) {
        continue;
      }
      const check = TwinPro.checkOrder(order, price);
      book.orders[i] = check.order;
      if (!check.fill) {
        continue;
      }
      const result = await executeMarket(order, (order.role || order.type) + " order");
      if (!result.ok) {
        book.orders[i] = { ...check.order, status: "rejected", reason: result.error, closed: now };
        messages.push(`Order rejected: ${TwinPro.describeOrder(order)} — ${result.error}`);
        continue;
      }
      state.paper = result.paper;
      book.orders[i] = { ...check.order, status: "filled", fill_price: result.fill.price, closed: now };
      messages.push(`Filled: ${order.side} ${result.fill.qty} ${order.symbol} @ ${TwinGlobal.price(result.fill.price, result.fill.currency)}`);
      if (order.group) {
        for (const other of book.orders) {
          if (other.group === order.group && other.id !== order.id && other.status === "open") {
            Object.assign(other, { status: "cancelled", reason: "other bracket leg filled", closed: now });
          }
        }
      }
      if (order.bracket && order.side === "buy") {
        book.orders.push(...TwinPro.bracketLegs(order, result.fill.qty, now, result.fill.price));
      }
    }
    if (proKey("orders") !== scopeAtStart) {
      return messages;
    }
    saveLiveBook(mergeOrderBooks(liveBook(), book, knownIds));
    let alertsChanged = false;
    for (const alert of alerts) {
      const price = prices[alert.symbol];
      if (alert.triggered || !(price > 0)) {
        continue;
      }
      if ((alert.dir === "above" && price >= alert.price) || (alert.dir === "below" && price <= alert.price)) {
        alert.triggered = now;
        alert.hit_price = price;
        alertsChanged = true;
        messages.push(`🔔 ${alert.symbol} is ${alert.dir} ${fmtMoney(alert.price)} (now ${fmtMoney(price)})`);
      }
    }
    if (alertsChanged) {
      const triggered = new Map(alerts.filter((a) => a.triggered).map((a) => [a.id, a]));
      proWrite("alerts", proRead("alerts", []).map((a) => (!a.triggered && triggered.has(a.id) ? triggered.get(a.id) : a)));
    }
  } finally {
    syncing = false;
  }
  if (messages.length) {
    toast(messages[0] + (messages.length > 1 ? ` (+${messages.length - 1} more)` : ""), 4200);
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      try {
        new Notification("Twin", { body: messages.join("\n"), icon: "icons/icon-192.png" });
      } catch (error) {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }
  return messages;
}

setInterval(() => {
  if (state.profile && !DEMO && !GUEST && document.visibilityState === "visible") {
    syncLiveOrders().catch(() => {});
  }
}, 60000);

function openOrdersCard() {
  const book = liveBook();
  const open = book.orders.filter((o) => o.status === "open");
  const recent = book.orders.filter((o) => o.status !== "open").slice(-4).reverse();
  if (!open.length && !recent.length) {
    return null;
  }
  const card = h("div", { class: "card", id: "open-orders" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Orders"), h("span", { class: "pill blue" }, `${open.length} open`)));
  for (const order of open) {
    put(card, h("div", { class: "order-row" },
      h("div", { style: "flex:1;min-width:0" },
        h("b", {}, TwinPro.describeOrder(order)),
        h("div", { class: "tiny muted" },
          order.role ? `Bracket ${order.role === "take_profit" ? "take-profit" : "stop-loss"} · ` : "",
          order.type === "trailing" && order.level ? `fires at ~${fmtMoney(order.level)} · ` : "",
          order.triggered ? "stop triggered, waiting for limit · " : "",
          "good till cancelled")),
      h("button", {
        class: "btn small ghost",
        onclick: () => {
          const latest = liveBook();
          const target = latest.orders.find((o) => o.id === order.id);
          if (target && target.status === "open") {
            Object.assign(target, { status: "cancelled", reason: "cancelled by you", closed: new Date().toISOString() });
            saveLiveBook(latest);
            toast("Order cancelled");
            switchTab(state.tab);
          }
        },
      }, "Cancel")));
  }
  for (const order of recent) {
    put(card, h("div", { class: "order-row tiny muted" },
      h("span", { class: "pill " + (order.status === "filled" ? "green" : order.status === "rejected" ? "red" : "gray"), style: "flex:none" }, order.status),
      h("span", { style: "flex:1;min-width:0" }, TwinPro.describeOrder(order),
        order.fill_price ? ` @ ${fmtMoney(order.fill_price)}` : "", order.reason ? ` — ${order.reason}` : "")));
  }
  if (GUEST || DEMO) {
    put(card, h("p", { class: "tiny muted" }, "Snapshot prices don't change, so open orders here wait. Replay Lab shows the same order types filling over real history."));
  }
  return card;
}

/* ----------------------------------------------------------------- alerts */
function openAlerts(symbol, price) {
  const list = h("div");
  const target = h("input", { type: "number", inputmode: "decimal", placeholder: "Alert price ($)", "aria-label": "Alert price" });
  const draw = () => {
    const alerts = proRead("alerts", []).filter((a) => a.symbol === symbol);
    list.replaceChildren(...(alerts.length ? alerts.map((alert) => h("div", { class: "order-row" },
      h("div", { style: "flex:1" }, h("b", {}, `${alert.dir === "above" ? "↑ Above" : "↓ Below"} ${fmtMoney(alert.price)}`),
        h("div", { class: "tiny muted" }, alert.triggered ? `Triggered at ${fmtMoney(alert.hit_price)}` : "Active")),
      h("button", {
        class: "btn small ghost",
        onclick: () => {
          proWrite("alerts", proRead("alerts", []).filter((a) => a.id !== alert.id));
          draw();
        },
      }, "Delete"))) : [h("p", { class: "muted small" }, "No alerts for " + symbol + " yet.")]));
  };
  const add = () => {
    const value = Number(target.value);
    if (!(value > 0)) {
      toast("Enter a price above $0");
      return;
    }
    const alerts = proRead("alerts", []);
    if (alerts.filter((a) => !a.triggered).length >= 30) {
      toast("Up to 30 active alerts");
      return;
    }
    alerts.push({ id: Date.now().toString(36), symbol, price: value, dir: value >= price ? "above" : "below", created: new Date().toISOString() });
    proWrite("alerts", alerts);
    target.value = "";
    toast(`Alert set: ${symbol} ${value >= price ? "above" : "below"} ${fmtMoney(value)}`);
    draw();
  };
  draw();
  openSheet(
    h("h2", {}, `🔔 Price alerts · ${symbol}`),
    h("p", { class: "muted small" }, `Now ${fmtMoney(price)}. Twin picks "above" or "below" from your price.`),
    h("div", { class: "row" }, target, h("button", { class: "btn small primary", style: "flex:none", onclick: add }, "Add")),
    list,
    "Notification" in window && Notification.permission === "default" ? h("button", {
      class: "btn ghost", style: "margin-top:10px",
      onclick: async () => {
        const permission = await Notification.requestPermission();
        toast(permission === "granted" ? "Notifications on (while Twin is open)" : "Notifications not allowed");
      },
    }, "Allow notifications") : null,
    h("p", { class: "tiny muted" }, (GUEST || DEMO)
      ? "Snapshot prices don't move, so alerts here won't trigger. With your local server they're checked about once a minute while Twin is open."
      : "Checked about once a minute while Twin is open. Twin has no push server, so closed-app alerts are not possible."),
    h("button", { class: "btn", onclick: closeSheet }, "Done"));
}

/* ---------------------------------------------------- stock sheet (1.3) */
async function openStockPro(symbol) {
  symbol = symbol.toUpperCase();
  const body = h("div", {}, spinner());
  const sheet = openSheet(body);
  let span = "1M";
  const indicators = new Set(proRead("indicators", ["sma20"]));
  const draw = async () => {
    const result = await api("api/chart", { symbol, span });
    body.replaceChildren();
    if (!result.ok) {
      put(body, h("h2", {}, symbol), errorBox(result.error));
      return;
    }
    const d = TwinGlobal.remember({ ...result.data, symbol });
    const cur = d.currency || TwinGlobal.listing(symbol).currency;
    const isIndex = TwinGlobal.listing(symbol).isIndex;
    const money = (value) => (isIndex ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : TwinGlobal.price(value, cur));
    const points = d.points || [];
    const closes = points.map((p) => p[1]);
    const times = points.map((p) => p[0]);
    const watching = state.profile.watchlist.includes(symbol);
    const held = state.paper && state.paper.positions.find((p) => p.symbol === symbol);
    const activeAlerts = proRead("alerts", []).filter((a) => a.symbol === symbol && !a.triggered).length;
    const openOrders = liveBook().orders.filter((o) => o.symbol === symbol && o.status === "open").length;
    const priceEl = h("div", { class: "big" }, money(d.price));
    const changeEl = h("div", { class: signClass(d.change) + " small", style: "font-weight:650" });
    const spanWord = { "1D": "today", "1W": "past week", "1M": "past month", "3M": "past 3 months", "1Y": "past year", "5Y": "past 5 years" }[span];
    const setChange = (value, base, label) => {
      const diff = value - base;
      changeEl.className = signClass(diff) + " small";
      changeEl.replaceChildren(`${diff >= 0 ? "+" : ""}${money(diff)} (${fmtPct(base ? 100 * diff / base : 0)}) `, h("span", { class: "muted" }, label));
    };
    const base = span === "1D" ? d.prev : closes[0];
    setChange(d.price, base, spanWord);
    const canvas = h("canvas");
    const series = [{ values: closes }];
    const smaPeriods = { sma20: 20, sma50: 50 };
    const smaColors = { sma20: "#f5b301", sma50: "#a78bfa" };
    for (const key of ["sma20", "sma50"]) {
      if (indicators.has(key) && closes.length > smaPeriods[key] + 2) {
        series.push({ values: TwinPro.sma(closes, smaPeriods[key]), color: smaColors[key], width: 1.3, fill: false });
      }
    }
    const rsiValues = TwinPro.rsi(closes);
    const lastRsi = rsiValues[rsiValues.length - 1];
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    const posPct = hi > lo ? 100 * (d.price - lo) / (hi - lo) : 50;
    const indicatorChip = (key, label) => h("button", {
      class: "chip" + (indicators.has(key) ? " on" : ""),
      onclick: () => {
        if (indicators.has(key)) {
          indicators.delete(key);
        } else {
          indicators.add(key);
        }
        proWrite("indicators", [...indicators]);
        draw();
      },
    }, label);
    put(body,
      h("div", { class: "between" },
        h("div", {}, h("div", { class: "muted small" }, d.name), h("h2", { style: "margin:0" }, symbol)),
        h("div", { class: "row", style: "flex:none;gap:6px" },
          h("button", { class: "btn small ghost", "aria-label": "Price alerts", onclick: () => openAlerts(symbol, d.price) }, activeAlerts ? `🔔 ${activeAlerts}` : "🔔"),
          h("button", {
            class: "btn small " + (watching ? "" : "ghost"),
            onclick: async () => {
              const list = watching ? state.profile.watchlist.filter((s) => s !== symbol) : [...state.profile.watchlist, symbol];
              const saved = await api("api/profile", { watchlist: list });
              if (saved.ok) {
                state.profile = saved.profile;
                toast(watching ? "Removed from watchlist" : "Added to watchlist");
                draw();
              }
            },
          }, watching ? "★ Watching" : "☆ Watch"))),
      h("div", { class: "scrub-head", style: "margin-top:8px" }, priceEl, changeEl),
      canvas,
      h("div", { class: "chips", style: "justify-content:space-between" },
        ["1D", "1W", "1M", "3M", "1Y", "5Y"].map((s) => h("button", { class: "chip" + (s === span ? " on" : ""), onclick: () => { span = s; draw(); } }, s))),
      h("div", { class: "ind-row" }, indicatorChip("sma20", "SMA 20"), indicatorChip("sma50", "SMA 50"),
        h("span", { class: "tiny muted", style: "align-self:center" }, "Drag the chart to see any point")),
      TwinGlobal.listingPanel(symbol, d),
      h("div", { class: "card tight" },
        h("div", { class: "between tiny muted" }, h("span", {}, "Low " + fmtPrice(lo)), h("span", {}, `Range in view (${span})`), h("span", {}, "High " + fmtPrice(hi))),
        h("div", { class: "range" }, h("i", { style: `left:${Math.max(0, Math.min(100, posPct))}%` })),
        h("div", { class: "grid3", style: "margin-top:8px" },
          h("div", { class: "stat" }, h("div", { class: "k" }, "RSI 14"), h("div", { class: "v", style: "font-size:16px" }, lastRsi === null ? "—" : lastRsi.toFixed(0)),
            h("div", { class: "tiny muted" }, lastRsi === null ? "need more data" : lastRsi >= 70 ? "stretched up" : lastRsi <= 30 ? "stretched down" : "neutral")),
          h("div", { class: "stat" }, h("div", { class: "k" }, "From high"), h("div", { class: "v", style: "font-size:16px" }, fmtPct(hi ? 100 * (d.price / hi - 1) : 0, 1))),
          h("div", { class: "stat" }, h("div", { class: "k" }, "Volatility"), h("div", { class: "v", style: "font-size:16px" },
            (() => {
              const perYear = { "1D": 252 * 78, "1W": 252 * 13, "1M": 252, "3M": 252, "1Y": 252, "5Y": 52 }[span];
              const stats = TwinPro.seriesStats(closes, perYear);
              return stats.volatility_pct === null ? "—" : stats.volatility_pct.toFixed(0) + "%";
            })()), h("div", { class: "tiny muted" }, "annualized")))),
      held ? h("div", { class: "card tight" },
        h("div", { class: "between" }, h("b", {}, "Your practice position"), h("span", { class: signClass(held.gain) }, fmtMoney(held.gain) + " " + fmtPct(held.gain_pct))),
        h("div", { class: "muted small" }, `${held.qty} shares · avg ${fmtMoney(held.avg_cost)} · worth ${fmtMoney(held.value)}`)) : null,
      openOrders ? h("p", { class: "small" }, h("a", {
        href: "#invest",
        onclick: (event) => {
          event.preventDefault();
          closeSheet();
          state.investView = "portfolio";
          switchTab("invest");
        },
      }, `${openOrders} open order${openOrders > 1 ? "s" : ""} for ${symbol} ›`)) : null,
      isIndex ? h("p", { class: "tiny muted" }, "Indices can't be bought directly — search for an index fund or ETF that tracks it.") : h("div", { class: "fab-row" },
        h("button", { class: "btn green", onclick: () => openOrderPro(symbol, "buy", d.price, held) }, "Buy"),
        h("button", { class: "btn red", disabled: held ? null : "", onclick: () => openOrderPro(symbol, "sell", d.price, held) }, "Sell")),
      h("div", { class: "fab-row" },
        h("button", {
          class: "btn",
          onclick: () => {
            closeSheet();
            state.goalPrefill = symbol;
            state.investView = "goal";
            switchTab("invest");
          },
        }, "🎯 Simulate investing"),
        h("button", {
          class: "btn",
          onclick: () => {
            closeSheet();
            state.tradeView = "checklist";
            state.tradeSymbol = GUEST || DEMO ? "TSLA" : symbol;
            state.tradeMode = GUEST || DEMO ? "demo" : "live";
            switchTab("trade");
          },
        }, GUEST || DEMO ? "Try TSLA replay" : "⚡ Plan a day trade")),
      h("button", { class: "btn primary", id: "stock-twinagent", onclick: () => openTwinAgent(symbol) }, "🤖 TwinAgent research report"),
      h("button", { class: "btn", onclick: () => openStrategyLab(symbol) }, "Strategy Lab · test against buy & hold"),
      h("button", {
        class: "btn ghost",
        onclick: () => {
          closeSheet();
          state.tradeView = "replay";
          switchTab("trade");
        },
      }, "⏪ Practise orders in Replay Lab"),
      h("p", { class: "tiny muted" }, `${d.exchange || ""} · delayed quote · practice money only`));
    afterPaint(() => proChart(canvas, {
      series, baseline: span === "1D" ? d.prev : undefined, height: 210,
      onScrub: (index) => {
        if (index === null) {
          priceEl.textContent = money(d.price);
          setChange(d.price, base, spanWord);
        } else {
          priceEl.textContent = money(closes[index]);
          setChange(closes[index], base, fmtDay(times[index], span === "1D" || span === "1W"));
        }
      },
    }));
    syncLiveOrders({ [symbol]: d.price }).catch(() => {});
  };
  draw();
  return sheet;
}

function openOrderPro(symbol, side, price, held, prefill = null) {
  const paper = state.paper || state.profile.paper || {};
  const holder = h("div");
  const header = h("p", { class: "muted small" });
  const seg = h("div", { class: "seg", id: "account-switch" });
  let account = state.orderAccount || "practice";
  let status = null;
  const listingInfo = TwinGlobal.listing(symbol);
  const quoteInfo = TwinGlobal.info(symbol);
  const draw = () => {
    const brokerOn = brokerCanTrade(status, listingInfo);
    if (!brokerOn) {
      account = "practice";
    }
    seg.hidden = !brokerOn;
    seg.replaceChildren(...(brokerOn ? [["practice", "Practice"], ["broker", `${brokerName(status.provider)} ${status.mode === "live" ? "LIVE" : "paper"}`]] : []).map(([id, label]) => h("button", {
      class: account === id ? "on" : "", "data-account": id,
      style: id === "broker" && status.mode === "live" ? "color:var(--red)" : "",
      onclick: () => {
        account = id;
        state.orderAccount = id;
        draw();
      },
    }, label)));
    if (account === "broker") {
      const acct = status.account || {};
      header.replaceChildren(brokerBadge(status.mode, status.provider), ` Buying power ${brokerMoney(acct.buying_power, acct.currency)} · max ${fmtMoney(status.max_order_usd, 0)} per order`);
      holder.replaceChildren(orderTicket({
        symbol, price, side, held: 0, cash: acct.buying_power, equity: acct.equity,
        limits: state.profile.limits, where: "broker", brokerMode: status.mode, brokerProvider: status.provider,
        currency: quoteInfo.currency, fx: quoteInfo.fx_usd,
        submit: (fields) => submitBrokerOrder(fields),
      }));
    } else {
      header.replaceChildren(`Practice cash ${fmtMoney(paper.cash)}${held ? ` · you hold ${held.qty} sh` : ""}${quoteInfo.currency !== "USD" && quoteInfo.fx_usd ? ` · 1 ${quoteInfo.currency} = ${fmtMoney(quoteInfo.fx_usd, quoteInfo.fx_usd < 0.01 ? 6 : 4)}` : ""}`);
      holder.replaceChildren(orderTicket({
        symbol, price, side, held: held ? held.qty : 0, cash: paper.cash, equity: paper.value || paper.cash,
        limits: state.profile.limits, where: "live", currency: quoteInfo.currency, fx: quoteInfo.fx_usd,
        prefill,
        submit: (fields) => submitLiveOrder(fields, price),
      }));
      if (status && status.connected && !listingInfo.us) {
        put(holder, h("p", { class: "tiny muted" }, `Alpaca trades US listings only, so ${symbol} (${listingInfo.exchange}) is practice-only here. Connect Interactive Brokers in Me → Real trading to trade it for real.`));
      }
    }
  };
  draw();
  openSheet(h("h2", {}, `Trade ${symbol}`), seg, header, holder);
  brokerStatus().then((s) => {
    status = s;
    if (s && s.connected && holder.isConnected) {
      draw();
    }
  }).catch(() => {});
}

/* ------------------------------------------------------- Portfolio X-ray */
function xrayCard(p) {
  const alloc = TwinPro.allocation(p.positions, p.cash);
  const colors = { "US stock fund": "#4c8dff", "Intl stock fund": "#38bdf8", "Bond fund": "#22c55e", Gold: "#f5b301", "Single stock": "#a78bfa", Cash: "#6b7280" };
  const out = h("div");
  const card = h("div", { class: "card", id: "xray" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Portfolio X-ray"), h("span", { class: "tiny muted" }, "practice")),
    h("div", { class: "bar", style: "margin-top:10px;height:14px" },
      alloc.classes.map((c) => h("div", { title: `${c.name} ${c.pct}%`, style: `width:${c.pct}%;background:${colors[c.name] || "#888"}` }))),
    h("div", { class: "legend", style: "flex-wrap:wrap" },
      alloc.classes.map((c) => h("span", {}, h("i", { style: `background:${colors[c.name] || "#888"}` }), `${c.name} ${c.pct.toFixed(0)}%`))),
    alloc.note ? h("div", { class: "warn" }, alloc.note) : null,
    TwinGlobal.exposure(p.positions, p.cash),
    p.positions.length ? h("button", {
      class: "btn ghost", id: "xray-run",
      onclick: async (event) => {
        event.target.disabled = true;
        out.replaceChildren(spinner("Loading a year of prices…"));
        const symbols = [...new Set([...p.positions.map((pos) => pos.symbol), "SPY"])];
        const charts = await Promise.all(symbols.map((s) => api("api/chart", { symbol: s, span: "1Y" })));
        const seriesBySymbol = {};
        symbols.forEach((s, i) => {
          if (charts[i].ok) {
            seriesBySymbol[s] = charts[i].data.points;
          }
        });
        const weights = Object.fromEntries(p.positions.map((pos) => [pos.symbol, pos.value]));
        const lb = TwinPro.lookback(weights, seriesBySymbol, "SPY");
        out.replaceChildren();
        event.target.disabled = false;
        if (!lb) {
          put(out, errorBox("Not enough shared price history for this mix."));
          return;
        }
        const canvas = h("canvas");
        const row = (label, a, b, higherBetter) => h("tr", {}, h("td", {}, label),
          h("td", { class: "r " + (higherBetter === null ? "" : (higherBetter ? a > b : a < b) ? "up" : "down") }, a),
          h("td", { class: "r muted" }, b));
        put(out,
          h("p", { class: "small", style: "margin-top:10px" }, h("b", {}, "If you had held today's mix for the past year:")),
          canvas,
          h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--blue)" }), "Your mix"), h("span", {}, h("i", { style: "background:var(--muted)" }), "SPY")),
          h("table", { style: "margin-top:8px" },
            h("tr", {}, h("th", {}, ""), h("th", { class: "r" }, "Your mix"), h("th", { class: "r" }, "SPY")),
            row("Return", lb.portfolio.total_return_pct + "%", lb.benchmark.total_return_pct + "%", true),
            row("Worst drop", lb.portfolio.max_drawdown_pct + "%", lb.benchmark.max_drawdown_pct + "%", null),
            row("Volatility", (lb.portfolio.volatility_pct ?? "—") + "%", (lb.benchmark.volatility_pct ?? "—") + "%", null)),
          h("p", { class: "tiny muted" }, `Hypothetical look-back using daily closes, no rebalancing, ${lb.covered_weight_pct.toFixed(0)}% of holdings covered. Not your actual results, and the past doesn't predict the future.`));
        afterPaint(() => proChart(canvas, {
          height: 150,
          series: [{ values: lb.curve.map((v) => 100 * v), color: "#4c8dff" }, { values: lb.bench.map((v) => 100 * v), color: "#8a97a8", fill: false, dash: [4, 3] }],
          baseline: 100,
        }));
      },
    }, "📊 Look back one year vs SPY") : null,
    out);
  return card;
}

/* ------------------------------------------------------------- movers */
async function moversCard() {
  const card = h("div", { class: "card", id: "movers" }, h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Market movers"), h("span", { class: "tiny muted" }, (GUEST || DEMO) ? "snapshot" : "delayed")), spinner());
  api("api/quotes", { symbols: UNIVERSE }).then((result) => {
    card.lastChild.remove();
    if (!result.ok) {
      put(card, h("p", { class: "muted small" }, result.error));
      return;
    }
    const quotes = Object.values(result.quotes || {}).filter((q) => Number.isFinite(q.change_pct));
    const sorted = [...quotes].sort((a, b) => b.change_pct - a.change_pct);
    const pick = [...sorted.slice(0, 3), ...sorted.slice(-3).reverse()].filter((q, i, arr) => arr.indexOf(q) === i);
    const index = ["SPY", "QQQ", "AGG", "GLD"].map((s) => result.quotes[s]).filter(Boolean);
    put(card,
      h("div", { class: "chips", style: "margin-top:8px" }, index.map((q) => h("button", { class: "mover", onclick: () => openStock(q.symbol) },
        h("b", {}, q.symbol), h("span", { class: signClass(q.change_pct) + " tiny" }, fmtPct(q.change_pct))))),
      h("div", { class: "tiny muted", style: "margin:6px 0 2px" }, "Biggest moves today"),
      h("div", { class: "chips" }, pick.map((q) => h("button", { class: "mover", onclick: () => openStock(q.symbol) },
        h("b", {}, q.symbol), h("span", { class: "small" }, fmtPrice(q.price) + " "), h("span", { class: signClass(q.change_pct) + " tiny", style: "font-weight:700" }, fmtPct(q.change_pct))))));
  });
  return card;
}

/* -------------------------------------------------------------- Replay Lab */
const replayData = { key: null, timeline: null, names: {} };

async function loadReplayTimeline(statusEl) {
  const key = (GUEST || DEMO) ? "snapshot" : "server";
  if (replayData.key === key && replayData.timeline) {
    return replayData.timeline;
  }
  const symbols = UNIVERSE;
  const results = [];
  for (let i = 0; i < symbols.length; i += 4) {
    if (statusEl) {
      statusEl.textContent = `Loading a year of daily prices… ${Math.min(100, Math.round(100 * i / symbols.length))}%`;
    }
    results.push(...await Promise.all(symbols.slice(i, i + 4).map((s) => api("api/chart", { symbol: s, span: "1Y" }))));
  }
  const seriesBySymbol = {};
  symbols.forEach((s, i) => {
    if (results[i].ok && results[i].data.points && results[i].data.points.length > 100) {
      seriesBySymbol[s] = results[i].data.points;
      replayData.names[s] = results[i].data.name;
    }
  });
  if (!seriesBySymbol.SPY) {
    throw new Error("Could not load SPY history for the replay.");
  }
  replayData.timeline = TwinPro.buildTimeline(seriesBySymbol, "SPY");
  replayData.key = key;
  return replayData.timeline;
}

function replayGrade(summary) {
  const edge = summary.return_pct - summary.bench_return_pct;
  if (summary.closed_trades === 0 && Math.abs(summary.return_pct) < 0.01) {
    return ["—", "You stayed in cash the whole time."];
  }
  if (edge >= 5) {
    return ["A", "You beat buy-and-hold SPY by a wide margin. Check whether luck or a repeatable rule did it."];
  }
  if (edge >= 0) {
    return ["B", "You beat buy-and-hold SPY. Most active traders don't."];
  }
  if (edge >= -5) {
    return ["C", "Close to SPY. Doing nothing in an index fund would have been about as good."];
  }
  return ["D", "Buy-and-hold SPY did better. Try fewer trades, stop-losses and bigger winners than losers."];
}

async function renderReplay(main) {
  const label = h("span", {}, "Loading a year of daily prices…");
  const status = h("div", { class: "loading" }, h("div", { class: "spinner" }), label);
  put(main, status);
  let timeline;
  try {
    timeline = await loadReplayTimeline(label);
  } catch (error) {
    status.replaceWith(errorBox(error.message));
    return;
  }
  status.remove();
  const saved = proRead("replay", null);
  if (!saved || saved.version !== 1 || saved.key !== replayData.key || saved.day >= timeline.dates.length) {
    renderReplaySetup(main, timeline);
    return;
  }
  renderReplayGame(main, timeline, saved);
}

function renderReplaySetup(main, timeline) {
  let back = 126;
  const cash = h("input", { type: "number", inputmode: "decimal", value: "10000", "aria-label": "Starting cash" });
  const options = [[63, "3 months ago"], [126, "6 months ago"], [189, "9 months ago"]].filter(([d]) => d < timeline.dates.length - 25);
  const chips = h("div", { class: "chips" });
  const drawChips = () => chips.replaceChildren(...options.map(([d, label]) => h("button", {
    class: "chip" + (back === d ? " on" : ""), onclick: () => { back = d; drawChips(); },
  }, label)));
  drawChips();
  put(main, h("div", { class: "card" },
    h("div", { style: "font-size:34px" }, "⏪"),
    h("h2", {}, "Replay Lab"),
    h("p", { class: "muted" }, "Go back in time and trade real daily prices day by day. Try limit, stop, trailing-stop and bracket orders, then see if you beat simply holding SPY."),
    h("label", { class: "f" }, "Start from"), chips,
    h("label", { class: "f" }, "Starting cash ($)"), cash,
    h("div", { style: "height:12px" }),
    h("button", {
      class: "btn primary", id: "replay-start",
      onclick: () => {
        const amount = Number(cash.value);
        if (!(amount >= 100 && amount <= 1e9)) {
          toast("Starting cash must be between $100 and $1,000,000,000");
          return;
        }
        const replay = TwinPro.newReplay(timeline, timeline.dates.length - 1 - back, amount);
        replay.key = replayData.key;
        proWrite("replay", replay);
        switchTab("trade");
      },
    }, "Start replay"),
    h("p", { class: "tiny muted" }, `${Object.keys(timeline.closes).length} stocks and funds · daily closes only · future prices stay hidden until you get there. ${(GUEST || DEMO) ? "Uses the saved snapshot's past year." : "Uses live delayed history from your server."}`)));
}

function renderReplayGame(main, timeline, replay) {
  const summary = TwinPro.replaySummary(replay, timeline);
  const prices = TwinPro.pricesAt(timeline, replay.day);
  const prevPrices = TwinPro.pricesAt(timeline, Math.max(0, replay.day - 1));
  const save = () => proWrite("replay", replay);
  const advance = (steps) => {
    const events = TwinPro.replayAdvance(replay, timeline, steps);
    save();
    const fills = events.filter((e) => e.kind === "filled").length;
    if (events.length) {
      toast(`${fills} fill${fills === 1 ? "" : "s"}${events.length > fills ? `, ${events.length - fills} other update${events.length - fills === 1 ? "" : "s"}` : ""}`);
    }
    switchTab("trade");
  };
  const done = summary.days_left === 0;
  const canvas = h("canvas");
  const total = timeline.dates.length - 1 - replay.start_day;
  put(main, h("div", { class: "card", id: "replay-card" },
    h("div", { class: "replay-top" },
      h("div", {},
        h("div", { class: "muted small" }, "Replay · " + fmtDay(summary.date)),
        h("div", { class: "big", id: "replay-value" }, fmtMoney(summary.value)),
        h("div", { class: signClass(summary.return_pct) + " small", style: "font-weight:650" }, `${fmtPct(summary.return_pct)} you`,
          h("span", { class: "muted" }, ` · SPY ${fmtPct(summary.bench_return_pct)}`))),
      h("span", { class: "pill " + (summary.beat_bench ? "green" : "gray") }, summary.beat_bench ? "Beating SPY" : "Behind SPY")),
    canvas,
    h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--blue)" }), "You"), h("span", {}, h("i", { style: "background:var(--muted)" }), "Buy & hold SPY")),
    h("div", { class: "progress", style: "margin:10px 0 0" }, h("div", { style: `width:${100 * summary.days_played / Math.max(1, total)}%` })),
    h("div", { class: "between tiny muted" }, h("span", {}, `Day ${summary.days_played} of ${total}`), h("span", {}, `${summary.days_left} trading days left`)),
    done ? null : h("div", { class: "replay-controls" },
      h("button", { class: "btn primary", id: "replay-next", onclick: () => advance(1) }, "+1 day"),
      h("button", { class: "btn", onclick: () => advance(5) }, "+1 week"),
      h("button", { class: "btn", onclick: () => advance(21) }, "+1 month"),
      h("button", {
        class: "btn ghost",
        onclick: () => {
          if (confirm("Fast-forward to the end of the replay? Open orders keep working along the way.")) {
            advance(summary.days_left);
          }
        },
      }, "⏭ End"))));
  afterPaint(() => proChart(canvas, {
    height: 130,
    series: [{ values: replay.equity.map((e) => e[1]), color: "#4c8dff" }, { values: replay.equity.map((e) => e[2]), color: "#8a97a8", fill: false, dash: [4, 3] }],
    baseline: replay.account.start_cash,
  }));

  if (done) {
    const [grade, line] = replayGrade(summary);
    put(main, h("div", { class: "card share-card", id: "replay-result" },
      h("div", { class: "between" }, h("div", {}, h("div", { class: "muted tiny" }, "REPLAY RESULT"), h("h2", { style: "margin:2px 0" }, summary.beat_bench ? "You beat SPY 🎉" : "SPY won this time")),
        h("div", { class: "grade" }, grade)),
      h("p", { class: "small" }, line),
      h("div", { class: "grid2" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "Your return"), h("div", { class: "v " + signClass(summary.return_pct) }, fmtPct(summary.return_pct))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "SPY buy & hold"), h("div", { class: "v" }, fmtPct(summary.bench_return_pct))),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Win rate"), h("div", { class: "v" }, summary.win_rate_pct === null ? "—" : summary.win_rate_pct.toFixed(0) + "%")),
        h("div", { class: "stat" }, h("div", { class: "k" }, "Worst drop"), h("div", { class: "v" }, fmtPct(summary.max_drawdown_pct)))),
      h("button", { class: "btn primary", style: "margin-top:12px", onclick: () => shareText(`I ${summary.beat_bench ? "beat" : "tried to beat"} the S&P 500 in Twin's Replay Lab: ${fmtPct(summary.return_pct)} vs SPY ${fmtPct(summary.bench_return_pct)} (practice money). Try it as a guest:`) }, "Share result")));
  }

  put(main, h("div", { class: "card" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Trade on " + fmtDay(summary.date)), h("span", { class: "tiny muted" }, "cash " + fmtMoney(replay.account.cash))),
    h("div", { class: "tick-grid", style: "margin-top:10px" }, Object.keys(timeline.closes).map((symbol) => {
      const price = prices[symbol];
      const prev = prevPrices[symbol];
      const change = prev ? 100 * (price / prev - 1) : 0;
      return h("div", { class: "tick", "data-symbol": symbol, onclick: () => !done && openReplayTicket(timeline, replay, symbol) },
        h("b", {}, symbol), h("div", { class: "tiny" }, price ? fmtPrice(price) : "—"),
        h("span", { class: signClass(change) }, fmtPct(change, 1)));
    })),
    done ? h("p", { class: "tiny muted" }, "Replay finished. Start a new one below.") : h("p", { class: "tiny muted" }, "Tap a ticker to see its chart up to today and place an order.")));

  const positions = Object.entries(replay.account.positions);
  if (positions.length) {
    put(main, h("div", { class: "card" }, h("h3", {}, "Replay positions"),
      h("div", { class: "list" }, positions.map(([symbol, pos]) => {
        const value = pos.qty * prices[symbol];
        const gain = value - pos.cost;
        return h("div", { class: "item", onclick: () => !done && openReplayTicket(timeline, replay, symbol, "sell") },
          h("div", { style: "flex:1;min-width:0" }, h("div", { class: "sym" }, symbol), h("div", { class: "nm" }, `${pos.qty.toFixed(4)} sh · avg ${fmtPrice(pos.cost / pos.qty)}`)),
          h("div", { class: "px" }, h("div", { style: "font-weight:650" }, fmtMoney(value)), h("div", { class: signClass(gain) + " small" }, fmtPct(100 * gain / pos.cost))));
      }))));
  }
  const open = replay.account.orders.filter((o) => o.status === "open");
  if (open.length) {
    put(main, h("div", { class: "card" }, h("h3", {}, `Open replay orders (${open.length})`),
      open.map((order) => h("div", { class: "order-row" },
        h("div", { style: "flex:1;min-width:0" }, h("b", {}, TwinPro.describeOrder(order)),
          h("div", { class: "tiny muted" }, order.role ? (order.role === "take_profit" ? "bracket take-profit" : "bracket stop-loss") : "good till cancelled",
            order.type === "trailing" && order.level ? ` · fires near ${fmtMoney(order.level)}` : "")),
        done ? null : h("button", {
          class: "btn small ghost",
          onclick: () => {
            TwinPro.cancelOrder(replay.account, order.id, new Date().toISOString());
            replay.log.push({ day: replay.day, kind: "cancelled", text: "Cancelled: " + TwinPro.describeOrder(order) });
            save();
            switchTab("trade");
          },
        }, "Cancel")))));
  }
  if (replay.log.length) {
    put(main, h("div", { class: "card" }, h("h3", {}, "Replay journal"),
      replay.log.slice(-10).reverse().map((entry) => h("div", { class: "order-row small" },
        h("span", { class: "tiny muted", style: "flex:none;width:76px" }, fmtDay(timeline.dates[entry.day]).replace(/, \d{4}$/, "")),
        h("span", { class: entry.kind === "rejected" ? "down" : "" }, entry.text)))));
  }
  put(main, h("button", {
    class: "btn ghost", id: "replay-new",
    onclick: () => {
      if (done || confirm("Start a new replay? This one will be erased.")) {
        proWrite("replay", null);
        switchTab("trade");
      }
    },
  }, done ? "New replay" : "Restart replay"));
}

function openReplayTicket(timeline, replay, symbol, side = "buy") {
  const closes = timeline.closes[symbol].slice(0, replay.day + 1).filter((v) => v > 0);
  const recent = closes.slice(-90);
  const price = closes[closes.length - 1];
  const pos = replay.account.positions[symbol];
  const canvas = h("canvas");
  const value = TwinPro.accountValue(replay.account, TwinPro.pricesAt(timeline, replay.day));
  openSheet(
    h("div", { class: "between" },
      h("div", {}, h("div", { class: "muted small" }, (replayData.names[symbol] || symbol) + " · " + fmtDay(timeline.dates[replay.day])), h("h2", { style: "margin:0" }, symbol)),
      h("div", { class: "big", style: "font-size:26px" }, fmtMoney(price))),
    canvas,
    h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--amber)" }), "SMA 20"), h("span", {}, "Last 90 trading days, nothing after today")),
    orderTicket({
      symbol, price, side, held: pos ? pos.qty : 0, cash: replay.account.cash, equity: value,
      limits: state.profile.limits, where: "replay",
      submit: async (fields) => {
        try {
          const result = TwinPro.replayPlace(replay, timeline, fields);
          proWrite("replay", replay);
          closeSheet();
          const order = result.order;
          toast(order.status === "filled" ? `Filled at ${fmtMoney(order.fill_price)}` : order.status === "rejected" ? "Rejected: " + order.reason : "Order placed. Advance days to see if it fills.");
          switchTab("trade");
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
    }));
  afterPaint(() => proChart(canvas, {
    height: 150,
    series: [{ values: recent }, { values: TwinPro.sma(closes, 20).slice(-90), color: "#f5b301", fill: false, width: 1.2 }],
  }));
}

/* ------------------------------------------------------------ guest tools */
function guestLink() {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "?guest";
  return url.href;
}

async function shareText(text) {
  const url = guestLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Twin", text, url });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("Link copied — paste it to a friend");
  } catch (error) {
    openSheet(h("h2", {}, "Share Twin"), h("p", { class: "muted small" }, "Copy this link:"),
      h("input", { value: url, readonly: "", onclick: (event) => event.target.select() }),
      h("button", { class: "btn", style: "margin-top:10px", onclick: closeSheet }, "Done"));
  }
}

function inviteCard() {
  return h("div", { class: "card share-card", id: "invite" },
    h("div", { class: "between" },
      h("div", {}, h("b", {}, "Invite a friend"), h("div", { class: "small muted" }, "They join as a guest in one tap. No sign-up.")),
      h("button", { class: "btn small primary", style: "flex:none", onclick: () => shareText("Practice investing and day trading with me on Twin — no sign-up, practice money only:") }, "Share")));
}

function openSaveProgress() {
  const name = h("input", { placeholder: "Your name", autocomplete: "name" });
  const username = h("input", { placeholder: "username", autocapitalize: "none", autocomplete: "username" });
  const password = h("input", { type: "password", placeholder: "8+ characters", autocomplete: "new-password" });
  const errorSlot = h("div");
  const serverMode = !DEMO && readPreference("tt-runtime-mode") === "server";
  const submit = async (event) => {
    errorSlot.replaceChildren();
    event.target.disabled = true;
    try {
      const body = { name: name.value, username: username.value, password: password.value };
      let result;
      if (serverMode) {
        const guestWatchlist = [...state.profile.watchlist];
        result = await window.fetch("api/signup", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
        }).then((r) => r.json()).catch(() => ({ ok: false, error: "Can't reach your Twin server." }));
        if (result.ok) {
          await window.fetch("api/profile", {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
            body: JSON.stringify({ watchlist: guestWatchlist }),
          }).catch(() => {});
        }
      } else {
        result = await window.TwinDemo.saveGuest(body);
      }
      if (!result.ok) {
        put(errorSlot, errorBox(result.error));
        return;
      }
      const profile = result.profile;
      const scope = (serverMode ? "server:" : "demo:") + (profile.created || profile.name);
      proAdoptGuest(scope);
      await window.TwinDemo.guest("api/logout").catch(() => {});
      clearPrivateState();
      GUEST = false;
      setGuestActive(false);
      if (serverMode) {
        DEMO = false;
        location.reload();
        return;
      }
      DEMO = true;
      state.profile = profile;
      state.tab = "home";
      renderShell();
      toast("Saved! Your practice progress is now a profile on this browser.");
    } finally {
      event.target.disabled = false;
    }
  };
  openSheet(
    h("h2", {}, "Save my progress"),
    h("p", { class: "muted small" }, serverMode
      ? "Creates an account on your Twin server and keeps your watchlist, replay, orders and alerts. Snapshot practice trades stay behind because the server uses live prices."
      : "Turns this guest session into a profile on this browser. Keeps your practice portfolio, trades, watchlist, goal, replay, orders and alerts."),
    h("label", { class: "f" }, "Name"), name,
    h("label", { class: "f" }, "Username"), username,
    h("label", { class: "f" }, "Password"), password,
    errorSlot,
    h("div", { style: "height:12px" }),
    h("button", { class: "btn primary", id: "save-progress-submit", onclick: submit }, "Save my progress"),
    h("p", { class: "tiny muted center", style: "margin-top:10px" }, serverMode
      ? "Stored on your own computer."
      : "Browser-only profile, not a cloud account. Anyone with access to this browser can read its storage. Use a unique password."));
}
