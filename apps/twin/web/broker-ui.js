/* Twin real trading UI (Alpaca through your own Twin server).
 *
 * Keys are entered once and sent only to the local Twin server, which stores them and
 * talks to Alpaca. The browser never receives them back. The public web build and guest
 * sessions never show a key form. Every order: ticket → server preview → confirm → send.
 */
"use strict";

const brokerCache = { status: null, at: 0 };

function brokerAvailable() {
  return !DEMO && !GUEST && readPreference("tt-runtime-mode") === "server";
}

async function brokerStatus(force = false) {
  if (!brokerAvailable()) {
    return null;
  }
  if (!force && brokerCache.status && Date.now() - brokerCache.at < 30000) {
    return brokerCache.status;
  }
  const result = await api("api/broker/status");
  brokerCache.status = result.ok ? result.broker : null;
  brokerCache.at = Date.now();
  return brokerCache.status;
}

function brokerBadge(mode) {
  return mode === "live"
    ? h("span", { class: "pill red", "data-broker-mode": "live" }, "LIVE · real money")
    : h("span", { class: "pill amber", "data-broker-mode": "paper" }, "Alpaca paper");
}

/* ------------------------------------------------------------ Me card */
function brokerCard() {
  const card = h("div", { class: "card", id: "broker-card" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Real trading"), h("button", { class: "help", onclick: () => openGuide("real") }, "?")));
  if (!brokerAvailable()) {
    put(card,
      h("p", { class: "small muted" }, "Real trading connects your own Alpaca brokerage account through Twin running on your computer. This web/guest version never asks for broker keys — never paste keys into a public website."),
      h("p", { class: "small" }, "To use it: run Twin on your Mac (", h("code", {}, "python3 apps/twin/server.py --lan"), "), sign in, then open Me → Real trading."),
      h("button", { class: "btn ghost", onclick: () => { state.academyFocus = "trading"; switchTab("learn"); } }, "🎓 Take the Real-money readiness class first"));
    return card;
  }
  put(card, spinner());
  brokerStatus(true).then((status) => {
    card.lastChild.remove();
    if (!status) {
      put(card, errorBox("Could not load broker status."));
    } else if (status.connected) {
      drawConnected(card, status);
    } else {
      drawConnectForm(card, status);
    }
  });
  return card;
}

function drawConnected(card, status) {
  const acct = status.account || {};
  const cap = h("input", { type: "number", inputmode: "decimal", value: status.max_order_usd, "aria-label": "Max dollars per order" });
  put(card,
    h("div", { class: "between", style: "margin-top:8px" }, brokerBadge(status.mode),
      h("span", { class: "tiny muted" }, `key ${status.key_hint}${acct.account_number_hint ? " · acct " + acct.account_number_hint : ""}`)),
    status.error ? errorBox(status.error) : h("div", { class: "grid3", style: "margin-top:10px" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "Equity"), h("div", { class: "v", style: "font-size:16px" }, fmtMoney(acct.equity))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Cash"), h("div", { class: "v", style: "font-size:16px" }, fmtMoney(acct.cash))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Buying power"), h("div", { class: "v", style: "font-size:16px" }, fmtMoney(acct.buying_power)))),
    acct.pattern_day_trader ? h("div", { class: "warn" }, "Alpaca flags this account as a pattern day trader.") : null,
    h("label", { class: "f" }, "Max dollars per buy order"),
    h("div", { class: "row" }, cap, h("button", {
      class: "btn small", style: "flex:none",
      onclick: async () => {
        const r = await api("api/broker/settings", { max_order_usd: cap.value });
        toast(r.ok ? "Max order saved" : r.error);
        brokerCache.status = null;
      },
    }, "Save")),
    h("div", { style: "height:10px" }),
    h("button", { class: "btn", onclick: () => { state.investView = "real"; switchTab("invest"); } }, "Open real account"),
    h("div", { style: "height:8px" }),
    h("button", {
      class: "btn ghost",
      onclick: async () => {
        if (!confirm("Disconnect Alpaca? Twin deletes the stored keys. Open orders at Alpaca stay open.")) {
          return;
        }
        await api("api/broker/disconnect");
        brokerCache.status = null;
        switchTab("me");
      },
    }, "Disconnect broker"),
    h("p", { class: "tiny muted" }, "Keys live in Twin's data folder on this computer (owner-only file, not encrypted). Alpaca holds your money and executes orders; Twin is not a broker and gives no advice."));
}

function drawConnectForm(card, status) {
  let mode = "paper";
  const keyId = h("input", { placeholder: "API key ID", autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-label": "Alpaca API key ID" });
  const secret = h("input", { type: "password", placeholder: "API secret key", autocomplete: "off", "aria-label": "Alpaca API secret" });
  const cap = h("input", { type: "number", inputmode: "decimal", placeholder: "Max $ per order (default paper $25,000 · live $1,000)", "aria-label": "Max order" });
  const password = h("input", { type: "password", placeholder: "Your Twin password", autocomplete: "current-password", "aria-label": "Twin password" });
  const phrase = h("input", { placeholder: `Type ${status.live_phrase}`, autocapitalize: "characters", "aria-label": "Live confirmation phrase" });
  const liveBox = h("div");
  const errorSlot = h("div");
  const seg = h("div", { class: "seg" });
  const drawMode = () => {
    seg.replaceChildren(...[["paper", "Paper (fake money)"], ["live", "Live (real money)"]].map(([id, label]) => h("button", {
      class: mode === id ? "on" : "", "data-mode": id,
      onclick: () => {
        mode = id;
        drawMode();
      },
    }, label)));
    const ready = academyDone("readiness");
    liveBox.replaceChildren(...(mode === "live" ? [
      h("div", { class: "err", style: "white-space:normal" },
        h("b", {}, "Live orders use real money. "),
        "You can lose money, including more than you expect in fast markets. Twin is not a broker or adviser."),
      ready ? null : h("div", { class: "warn" }, "You haven't finished the Real-money readiness class in Learn yet. Strongly recommended first."),
      h("label", { class: "f" }, "Twin password"), password,
      h("label", { class: "f" }, `Type ${status.live_phrase} to confirm`), phrase,
    ] : [h("p", { class: "tiny muted" }, "Paper uses Alpaca's simulated account with fake money and real market prices — the best next step after Twin's practice portfolio.")]));
  };
  drawMode();
  put(card,
    h("p", { class: "small muted" }, "Connect an ", h("a", { href: "https://alpaca.markets", target: "_blank", rel: "noopener" }, "Alpaca"),
      " account (US stocks & ETFs). Create API keys in Alpaca's dashboard — paper and live keys are different."),
    seg, h("label", { class: "f" }, "API key ID"), keyId, h("label", { class: "f" }, "Secret key"), secret,
    h("label", { class: "f" }, "Max dollars per buy order (optional)"), cap, liveBox, errorSlot,
    h("div", { style: "height:10px" }),
    h("button", {
      class: "btn primary", id: "broker-connect",
      onclick: async (event) => {
        errorSlot.replaceChildren();
        event.target.disabled = true;
        const r = await api("api/broker/connect", {
          key_id: keyId.value, secret: secret.value, mode, max_order_usd: cap.value,
          password: mode === "live" ? password.value : undefined, phrase: mode === "live" ? phrase.value : undefined,
        });
        event.target.disabled = false;
        secret.value = "";
        password.value = "";
        if (!r.ok) {
          put(errorSlot, errorBox(r.error));
          return;
        }
        brokerCache.status = r.broker;
        brokerCache.at = Date.now();
        toast(mode === "live" ? "Live trading connected — be careful" : "Alpaca paper connected");
        switchTab("me");
      },
    }, "Connect Alpaca"),
    h("p", { class: "tiny muted" }, "Keys go only to the Twin server on this computer and are never shown again."));
}

/* ------------------------------------------------------ order ticket path */
async function submitBrokerOrder(fields) {
  const order = { ...fields };
  if (order.type === "trailing") {
    order.type = "trailing_stop";
  }
  const result = await api("api/broker/preview", { order });
  if (!result.ok) {
    return result;
  }
  openBrokerConfirm(result.preview);
  return { ok: true };
}

function openBrokerConfirm(preview) {
  const live = preview.mode === "live";
  const errorSlot = h("div");
  const button = h("button", { class: "btn " + (live ? "red" : "primary"), id: "broker-confirm" },
    live ? "Place REAL order" : "Send paper order to Alpaca");
  if (live) {
    // A short pause before a real-money order can be confirmed.
    let wait = 3;
    button.disabled = true;
    button.textContent = `Place REAL order (${wait})`;
    const timer = setInterval(() => {
      wait -= 1;
      if (wait <= 0 || !button.isConnected) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = "Place REAL order";
      } else {
        button.textContent = `Place REAL order (${wait})`;
      }
    }, 1000);
  }
  button.addEventListener("click", async () => {
    errorSlot.replaceChildren();
    button.disabled = true;
    const r = await api("api/broker/order", { preview_id: preview.preview_id, confirm: true });
    if (!r.ok) {
      button.disabled = false;
      put(errorSlot, errorBox(r.error));
      return;
    }
    closeSheet();
    toast(`${live ? "LIVE" : "Paper"} order sent to Alpaca · ${r.order.status}`, 4000);
    state.investView = "real";
    switchTab("invest");
  });
  openSheet(
    h("div", { class: "between" }, h("h2", { style: "margin:0" }, "Review order"), brokerBadge(preview.mode)),
    h("div", { class: "preview", id: "broker-preview" },
      h("div", { style: "font-weight:700;margin-bottom:6px" }, preview.summary),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Estimated amount"), h("b", {}, fmtMoney(preview.estimate_usd))),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Reference price"), h("b", {}, preview.reference_price ? fmtMoney(preview.reference_price) : "—")),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Buying power"), h("b", {}, fmtMoney((preview.account || {}).buying_power)))),
    (preview.warnings || []).map((w) => h("div", { class: w.startsWith("LIVE") ? "err" : "warn", style: "white-space:normal" }, w)),
    errorSlot, button,
    h("button", { class: "btn ghost", style: "margin-top:8px", onclick: closeSheet }, "Cancel"),
    h("p", { class: "tiny muted center" }, `Preview expires in ${Math.round(preview.expires_in / 60)} min. Prices can move before the order fills; market and stop orders can fill at a different price.`));
}

/* ------------------------------------------------------ real account view */
async function investReal(body) {
  if (!brokerAvailable()) {
    put(body, brokerCard());
    return;
  }
  put(body, spinner("Loading your Alpaca account…"));
  const status = await brokerStatus(true);
  body.replaceChildren();
  if (!status || !status.connected) {
    put(body, brokerCard());
    return;
  }
  const acct = status.account || {};
  const dayChange = acct.equity && acct.last_equity ? acct.equity - acct.last_equity : null;
  put(body, h("div", { class: "card", id: "real-account" },
    h("div", { class: "between" }, h("div", { class: "muted small" }, "Alpaca account"), brokerBadge(status.mode)),
    h("div", { class: "big" }, fmtMoney(acct.equity)),
    dayChange === null ? null : h("div", { class: signClass(dayChange) + " small", style: "font-weight:650" },
      `${dayChange >= 0 ? "+" : ""}${fmtMoney(dayChange)} today`),
    h("div", { class: "grid2", style: "margin-top:10px" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "Cash"), h("div", { class: "v" }, fmtMoney(acct.cash))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Buying power"), h("div", { class: "v" }, fmtMoney(acct.buying_power))))));
  const data = await api("api/broker/portfolio");
  if (!data.ok) {
    put(body, errorBox(data.error));
    return;
  }
  put(body, h("div", { class: "card" }, h("h3", {}, "Positions"),
    data.positions.length ? h("div", { class: "list" }, data.positions.map((p) => h("div", { class: "item", onclick: () => openStock(p.symbol) },
      h("div", { style: "flex:1;min-width:0" }, h("div", { class: "sym" }, p.symbol), h("div", { class: "nm" }, `${p.qty} sh · avg ${fmtPrice(p.avg_cost)}`)),
      h("div", { class: "px" }, h("div", { style: "font-weight:650" }, fmtMoney(p.value)), h("div", { class: signClass(p.gain) + " small" }, fmtPct(p.gain_pct))))))
      : h("p", { class: "muted small" }, "No positions yet. Open a stock and choose the Alpaca account in the order ticket.")));
  const orders = h("div", { class: "card", id: "real-orders" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, `Open orders (${data.orders.length})`),
      data.orders.length ? h("button", {
        class: "btn small red", id: "cancel-all",
        onclick: async () => {
          if (!confirm(`Cancel ALL ${data.orders.length} open orders at Alpaca (${status.mode})?`)) {
            return;
          }
          const r = await api("api/broker/cancel_all");
          toast(r.ok ? `Cancel requested for ${r.cancelled} order(s)` : r.error);
          switchTab("invest");
        },
      }, "Cancel all") : null));
  for (const o of data.orders) {
    put(orders, h("div", { class: "order-row" },
      h("div", { style: "flex:1;min-width:0" }, h("b", {}, `${o.side.toUpperCase()} ${o.qty || "$" + o.notional} ${o.symbol} · ${o.type}`),
        h("div", { class: "tiny muted" }, [o.limit_price && `limit ${o.limit_price}`, o.stop_price && `stop ${o.stop_price}`, o.trail_percent && `trail ${o.trail_percent}%`, o.order_class !== "simple" && o.order_class, o.status, o.time_in_force].filter(Boolean).join(" · "))),
      h("button", {
        class: "btn small ghost",
        onclick: async () => {
          const r = await api("api/broker/cancel", { id: o.id });
          toast(r.ok ? "Cancel requested" : r.error);
          switchTab("invest");
        },
      }, "Cancel")));
  }
  put(body, orders);
  if (data.recent.length) {
    put(body, h("div", { class: "card" }, h("h3", {}, "Recent orders"),
      h("table", {}, data.recent.map((o) => h("tr", {},
        h("td", {}, h("span", { class: "pill " + (o.side === "buy" ? "green" : "red") }, o.side.toUpperCase())),
        h("td", {}, h("b", {}, o.symbol), h("div", { class: "tiny muted" }, o.status)),
        h("td", { class: "r" }, o.filled_avg_price ? `${o.filled_qty} @ ${fmtPrice(Number(o.filled_avg_price))}` : (o.qty || "$" + o.notional)))))));
  }
  put(body, h("p", { class: "tiny muted" }, "Data from Alpaca. Twin is not a broker; orders execute at Alpaca under their terms."));
}
