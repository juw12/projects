/* Twin real trading UI — Alpaca (US) or Interactive Brokers (global) through your own Twin server.
 *
 * Alpaca keys are entered once and sent only to the local Twin server, which stores them;
 * the browser never receives them back. IBKR uses the official Client Portal Gateway that
 * the user runs and logs in to on the same computer, so Twin never sees IBKR passwords.
 * The public web build and guest sessions never show a connect form.
 * Every order: ticket → server preview → confirm → send.
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

const BROKER_NAMES = { alpaca: "Alpaca", ibkr: "IBKR" };

function brokerName(provider) {
  return BROKER_NAMES[provider] || BROKER_NAMES.alpaca;
}

/* Can the connected broker trade this listing? Alpaca is US-only; IBKR covers most exchanges. */
function brokerCanTrade(status, listingInfo) {
  if (!status || !status.connected) {
    return false;
  }
  return status.provider === "ibkr" || Boolean(listingInfo && listingInfo.us);
}

function brokerBadge(mode, provider) {
  const name = brokerName(provider || (brokerCache.status && brokerCache.status.provider));
  return mode === "live"
    ? h("span", { class: "pill red", "data-broker-mode": "live" }, `${name} LIVE · real money`)
    : h("span", { class: "pill amber", "data-broker-mode": "paper" }, `${name} paper`);
}

/* Money in the broker account's own currency (IBKR accounts can be EUR, GBP, …). */
function brokerMoney(value, currency) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return !currency || currency === "USD" ? fmtMoney(value) : TwinGlobal.money(Number(value), currency);
}

/* ------------------------------------------------------------ Me card */
function brokerCard() {
  const card = h("div", { class: "card", id: "broker-card" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, "Real trading"), h("button", { class: "help", onclick: () => openGuide("real") }, "?")));
  if (!brokerAvailable()) {
    put(card,
      h("p", { class: "small muted" }, "Real trading connects your own brokerage account — Alpaca for US stocks, or Interactive Brokers for stocks on most world exchanges — through Twin running on your computer. This web/guest version never asks for broker keys or logins — never paste them into a public website."),
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
  const name = brokerName(status.provider);
  const ibkr = status.provider === "ibkr";
  const cur = acct.currency;
  const cap = h("input", { type: "number", inputmode: "decimal", value: status.max_order_usd, "aria-label": "Max dollars per order" });
  const hint = ibkr
    ? `IBKR gateway${acct.account_number_hint ? " · acct " + acct.account_number_hint : ""}${cur && cur !== "USD" ? " · " + cur + " account" : ""}`
    : `key ${status.key_hint}${acct.account_number_hint ? " · acct " + acct.account_number_hint : ""}`;
  put(card,
    h("div", { class: "between", style: "margin-top:8px" }, brokerBadge(status.mode, status.provider),
      h("span", { class: "tiny muted", "data-broker-provider": status.provider || "alpaca" }, hint)),
    status.error ? errorBox(status.error) : h("div", { class: "grid3", style: "margin-top:10px" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "Equity"), h("div", { class: "v", style: "font-size:16px" }, brokerMoney(acct.equity, cur))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Cash"), h("div", { class: "v", style: "font-size:16px" }, brokerMoney(acct.cash, cur))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Buying power"), h("div", { class: "v", style: "font-size:16px" }, brokerMoney(acct.buying_power, cur)))),
    acct.pattern_day_trader ? h("div", { class: "warn" }, "Alpaca flags this account as a pattern day trader.") : null,
    ibkr && status.error ? h("p", { class: "tiny muted" }, `Is the IBKR Client Portal Gateway running and logged in? Open ${status.gateway || "https://localhost:5000"} in this browser to log in again (sessions time out).`) : null,
    h("label", { class: "f" }, "Max US dollars per buy order"),
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
        const question = ibkr
          ? "Disconnect IBKR from Twin? Your gateway stays logged in until you log out there. Open orders at IBKR stay open."
          : "Disconnect Alpaca? Twin deletes the stored keys. Open orders at Alpaca stay open.";
        if (!confirm(question)) {
          return;
        }
        await api("api/broker/disconnect");
        brokerCache.status = null;
        switchTab("me");
      },
    }, "Disconnect broker"),
    h("p", { class: "tiny muted" }, ibkr
      ? "Twin talks only to the IBKR gateway on this computer and never stores your IBKR login. IBKR holds your money and executes orders; Twin is not a broker and gives no advice."
      : `Keys live unencrypted in Twin's data folder. Files are owner-only on POSIX; Windows access permissions are not configured or verified. Use paper keys on a trusted computer. ${name} holds your money and executes orders; Twin is not a broker and gives no advice.`));
}

function drawConnectForm(card, status) {
  let mode = "paper";
  let provider = brokerCache.connectProvider || "alpaca";
  const keyId = h("input", { placeholder: "API key ID", autocomplete: "off", autocapitalize: "none", spellcheck: "false", "aria-label": "Alpaca API key ID" });
  const secret = h("input", { type: "password", placeholder: "API secret key", autocomplete: "off", "aria-label": "Alpaca API secret" });
  const cap = h("input", { type: "number", inputmode: "decimal", placeholder: "Max US$ per order (default paper $25,000 · live $1,000)", "aria-label": "Max order" });
  const password = h("input", { type: "password", placeholder: "Your Twin password", autocomplete: "current-password", "aria-label": "Twin password" });
  const phrase = h("input", { placeholder: `Type ${status.live_phrase}`, autocapitalize: "characters", "aria-label": "Live confirmation phrase" });
  const providerSeg = h("div", { class: "seg", id: "broker-provider" });
  const intro = h("div");
  const keysBox = h("div");
  const liveBox = h("div");
  const errorSlot = h("div");
  const seg = h("div", { class: "seg" });
  const connectButton = h("button", { class: "btn primary", id: "broker-connect" });
  const draw = () => {
    const name = brokerName(provider);
    providerSeg.replaceChildren(...[["alpaca", "Alpaca · US stocks"], ["ibkr", "Interactive Brokers · global"]].map(([id, label]) => h("button", {
      class: provider === id ? "on" : "", "data-provider": id,
      onclick: () => {
        provider = id;
        brokerCache.connectProvider = id;
        errorSlot.replaceChildren();
        draw();
      },
    }, label)));
    seg.replaceChildren(...[["paper", "Paper (fake money)"], ["live", "Live (real money)"]].map(([id, label]) => h("button", {
      class: mode === id ? "on" : "", "data-mode": id,
      onclick: () => {
        mode = id;
        draw();
      },
    }, label)));
    if (provider === "ibkr") {
      intro.replaceChildren(
        h("p", { class: "small muted" }, "Connect an ", h("a", { href: "https://www.interactivebrokers.com", target: "_blank", rel: "noopener" }, "Interactive Brokers"),
          " account to trade listings on most world exchanges (Tokyo, London, Hong Kong, Jakarta, Frankfurt, …). Which markets you can trade depends on your country and the market permissions on your IBKR account."),
        h("ol", { class: "small", id: "ibkr-steps", style: "padding-left:18px;margin:6px 0" },
          h("li", {}, "Download IBKR's ", h("a", { href: "https://www.interactivebrokers.com/en/trading/ib-api.php", target: "_blank", rel: "noopener" }, "Client Portal Gateway"), " (needs Java) and start it on this computer: ", h("code", {}, "bin/run.sh root/conf.yaml")),
          h("li", {}, "Open ", h("a", { href: "https://localhost:5000", target: "_blank", rel: "noopener" }, "https://localhost:5000"), " and log in (your browser will warn about its self-signed certificate — that's expected for this local gateway)."),
          h("li", {}, "Log in with your ", h("b", {}, mode === "live" ? "live" : "paper"), " username, then come back and press Connect.")));
      keysBox.replaceChildren();
    } else {
      intro.replaceChildren(h("p", { class: "small muted" }, "Connect an ", h("a", { href: "https://alpaca.markets", target: "_blank", rel: "noopener" }, "Alpaca"),
        " account (US stocks & ETFs). Create API keys in Alpaca's dashboard — paper and live keys are different."));
      keysBox.replaceChildren(h("label", { class: "f" }, "API key ID"), keyId, h("label", { class: "f" }, "Secret key"), secret);
    }
    const ready = academyDone("readiness");
    liveBox.replaceChildren(...(mode === "live" ? [
      h("div", { class: "err", style: "white-space:normal" },
        h("b", {}, "Live orders use real money. "),
        "You can lose money, including more than you expect in fast markets. Twin is not a broker or adviser."),
      ready ? null : h("div", { class: "warn" }, "You haven't finished the Real-money readiness class in Learn yet. Strongly recommended first."),
      h("label", { class: "f" }, "Twin password"), password,
      h("label", { class: "f" }, `Type ${status.live_phrase} to confirm`), phrase,
    ] : [h("p", { class: "tiny muted" }, provider === "ibkr"
      ? "IBKR paper accounts use fake money and real market prices. Twin checks that the gateway is logged in to a paper account."
      : "Paper uses Alpaca's simulated account with fake money and real market prices — the best next step after Twin's practice portfolio.")]));
    connectButton.textContent = `Connect ${name}`;
  };
  connectButton.addEventListener("click", async () => {
    errorSlot.replaceChildren();
    connectButton.disabled = true;
    const r = await api("api/broker/connect", {
      provider,
      key_id: provider === "alpaca" ? keyId.value : undefined,
      secret: provider === "alpaca" ? secret.value : undefined,
      mode, max_order_usd: cap.value,
      password: mode === "live" ? password.value : undefined, phrase: mode === "live" ? phrase.value : undefined,
    });
    connectButton.disabled = false;
    secret.value = "";
    password.value = "";
    if (!r.ok) {
      put(errorSlot, errorBox(r.error));
      return;
    }
    brokerCache.status = r.broker;
    brokerCache.at = Date.now();
    toast(mode === "live" ? "Live trading connected — be careful" : `${brokerName(provider)} paper connected`);
    switchTab("me");
  });
  draw();
  put(card,
    h("label", { class: "f" }, "Broker"), providerSeg, intro,
    seg, keysBox,
    h("label", { class: "f" }, "Max US dollars per buy order (optional)"), cap, liveBox, errorSlot,
    h("div", { style: "height:10px" }),
    connectButton,
    h("p", { class: "tiny muted" }, "Keys and logins go only to the Twin server on this computer and are never shown again."));
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
  if (result.preview.needs_contract) {
    openContractPicker(order, result.preview);
    return { ok: true };
  }
  openBrokerConfirm(result.preview);
  return { ok: true };
}

/* IBKR found several listings for the symbol (e.g. a stock on its home exchange and in Germany). */
function openContractPicker(order, info) {
  const errorSlot = h("div");
  openSheet(
    h("h2", { style: "margin:0 0 6px" }, `Which ${info.symbol}?`),
    h("p", { class: "small muted" }, info.message),
    h("div", { class: "list", id: "contract-picker" }, (info.candidates || []).map((c) => h("div", {
      class: "item", "data-conid": c.conid,
      onclick: async () => {
        errorSlot.replaceChildren();
        const r = await api("api/broker/preview", { order: { ...order, conid: c.conid } });
        if (!r.ok) {
          put(errorSlot, errorBox(r.error));
          return;
        }
        closeSheet();
        openBrokerConfirm(r.preview);
      },
    }, h("div", { style: "flex:1" }, h("b", {}, c.header), h("div", { class: "tiny muted" }, `IBKR contract ${c.conid}`))))),
    errorSlot,
    h("button", { class: "btn ghost", style: "margin-top:8px", onclick: closeSheet }, "Cancel"));
}

function openBrokerConfirm(preview) {
  const live = preview.mode === "live";
  const name = brokerName(preview.provider);
  const local = preview.currency && preview.currency !== "USD";
  const errorSlot = h("div");
  const button = h("button", { class: "btn " + (live ? "red" : "primary"), id: "broker-confirm" },
    live ? "Place REAL order" : `Send paper order to ${name}`);
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
    if (r.needs_confirmation) {
      openBrokerQuestion(r);
      return;
    }
    brokerOrderSent(r);
  });
  const acct = preview.account || {};
  const kv = (label, value) => h("div", { class: "kv" }, h("span", { class: "muted" }, label), h("b", {}, value));
  openSheet(
    h("div", { class: "between" }, h("h2", { style: "margin:0" }, "Review order"), brokerBadge(preview.mode, preview.provider)),
    h("div", { class: "preview", id: "broker-preview" },
      h("div", { style: "font-weight:700;margin-bottom:6px" }, preview.summary),
      preview.contract ? kv("Listing", preview.contract.header) : null,
      local ? kv("Estimated amount", `${TwinGlobal.money(preview.estimate_local, preview.currency)} ≈ ${fmtMoney(preview.estimate_usd)}`)
        : kv("Estimated amount", fmtMoney(preview.estimate_usd)),
      kv("Reference price", preview.reference_price ? (local ? TwinGlobal.money(preview.reference_price, preview.currency) : fmtMoney(preview.reference_price)) : "—"),
      preview.commission !== undefined && preview.commission !== null ? kv("Est. commission", String(preview.commission)) : null,
      kv("Buying power", brokerMoney(acct.buying_power, acct.currency))),
    (preview.warnings || []).map((w) => h("div", { class: w.startsWith("LIVE") ? "err" : "warn", style: "white-space:normal" }, w)),
    errorSlot, button,
    h("button", { class: "btn ghost", style: "margin-top:8px", onclick: closeSheet }, "Cancel"),
    h("p", { class: "tiny muted center" }, `Preview expires in ${Math.round(preview.expires_in / 60)} min. Prices can move before the order fills; market and stop orders can fill at a different price.`));
}

function brokerOrderSent(r) {
  const live = r.mode === "live";
  toast(`${live ? "LIVE" : "Paper"} order sent to ${brokerName(r.provider)} · ${(r.order && r.order.status) || "submitted"}`, 4000);
  state.investView = "real";
  switchTab("invest");
}

/* IBKR sometimes asks a precautionary question after an order is submitted for checking
   (e.g. "price is far from the market"). Nothing is placed until the user answers here. */
function openBrokerQuestion(question) {
  const live = question.mode === "live";
  const errorSlot = h("div");
  const answer = async (confirm, button) => {
    errorSlot.replaceChildren();
    button.disabled = true;
    const r = await api("api/broker/reply", { reply_token: question.reply_token, confirm });
    if (!r.ok) {
      button.disabled = false;
      put(errorSlot, errorBox(r.error));
      return;
    }
    closeSheet();
    if (r.cancelled) {
      toast("Order not sent");
    } else if (r.needs_confirmation) {
      openBrokerQuestion(r);
    } else {
      brokerOrderSent(r);
    }
  };
  const yes = h("button", { class: "btn " + (live ? "red" : "primary"), id: "broker-question-yes" }, live ? "Yes, place the REAL order" : "Yes, send it");
  const no = h("button", { class: "btn ghost", id: "broker-question-no", style: "margin-top:8px" }, "No, don't send");
  yes.addEventListener("click", () => answer(true, yes));
  no.addEventListener("click", () => answer(false, no));
  openSheet(
    h("div", { class: "between" }, h("h2", { style: "margin:0" }, "IBKR asks"), brokerBadge(question.mode, "ibkr")),
    h("p", { class: "small muted" }, question.summary),
    h("div", { id: "broker-question" }, (question.messages || []).map((m) => h("div", { class: live ? "err" : "warn", style: "white-space:normal" }, m))),
    h("p", { class: "tiny muted" }, "Nothing has been placed yet. Twin never answers these for you."),
    errorSlot, yes, no);
}

/* ------------------------------------------------------ real account view */
async function investReal(body) {
  if (!brokerAvailable()) {
    put(body, brokerCard());
    return;
  }
  put(body, spinner("Loading your broker account…"));
  const status = await brokerStatus(true);
  body.replaceChildren();
  if (!status || !status.connected) {
    put(body, brokerCard());
    return;
  }
  const name = brokerName(status.provider);
  const acct = status.account || {};
  const cur = acct.currency;
  const dayChange = acct.equity && acct.last_equity ? acct.equity - acct.last_equity : null;
  put(body, h("div", { class: "card", id: "real-account" },
    h("div", { class: "between" }, h("div", { class: "muted small" }, `${name} account`), brokerBadge(status.mode, status.provider)),
    h("div", { class: "big" }, brokerMoney(acct.equity, cur)),
    dayChange === null ? null : h("div", { class: signClass(dayChange) + " small", style: "font-weight:650" },
      `${dayChange >= 0 ? "+" : ""}${fmtMoney(dayChange)} today`),
    status.error ? errorBox(status.error) : null,
    h("div", { class: "grid2", style: "margin-top:10px" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "Cash"), h("div", { class: "v" }, brokerMoney(acct.cash, cur))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "Buying power"), h("div", { class: "v" }, brokerMoney(acct.buying_power, cur))))));
  const data = await api("api/broker/portfolio");
  if (!data.ok) {
    put(body, errorBox(data.error));
    return;
  }
  const posMoney = (value, p) => (p.currency && p.currency !== "USD" ? TwinGlobal.money(Number(value), p.currency) : fmtMoney(value));
  put(body, h("div", { class: "card" }, h("h3", {}, "Positions"),
    data.positions.length ? h("div", { class: "list" }, data.positions.map((p) => {
      const openSymbol = p.twin_symbol || p.symbol;
      return h("div", { class: "item", onclick: () => openStock(openSymbol) },
        h("div", { style: "flex:1;min-width:0" }, h("div", { class: "sym" }, p.twin_symbol || p.symbol),
          h("div", { class: "nm" }, `${p.qty} sh · avg ${p.currency && p.currency !== "USD" ? posMoney(p.avg_cost, p) : fmtPrice(p.avg_cost)}${p.exchange ? " · " + p.exchange : ""}`)),
        h("div", { class: "px" }, h("div", { style: "font-weight:650" }, posMoney(p.value, p)),
          h("div", { class: signClass(p.gain) + " small" }, p.gain_pct === null || p.gain_pct === undefined ? "—" : fmtPct(p.gain_pct))));
    }))
      : h("p", { class: "muted small" }, `No positions yet. Open a stock and choose the ${name} account in the order ticket.`)));
  const orders = h("div", { class: "card", id: "real-orders" },
    h("div", { class: "between" }, h("h3", { style: "margin:0" }, `Open orders (${data.orders.length})`),
      data.orders.length ? h("button", {
        class: "btn small red", id: "cancel-all",
        onclick: async () => {
          if (!confirm(`Cancel ALL ${data.orders.length} open orders at ${name} (${status.mode})?`)) {
            return;
          }
          const r = await api("api/broker/cancel_all");
          toast(r.ok ? `Cancel requested for ${r.cancelled.length === undefined ? r.cancelled : r.cancelled.length} order(s)` : r.error);
          switchTab("invest");
        },
      }, "Cancel all") : null));
  for (const o of data.orders) {
    const title = o.description
      ? o.description
      : `${String(o.side || "").toUpperCase()} ${o.qty || "$" + o.notional} ${o.symbol} · ${o.type}`;
    put(orders, h("div", { class: "order-row" },
      h("div", { style: "flex:1;min-width:0" }, h("b", {}, title),
        h("div", { class: "tiny muted" }, [o.limit_price && `limit ${o.limit_price}`, o.stop_price && `stop ${o.stop_price}`, o.trail_percent && `trail ${o.trail_percent}%`,
          o.order_class && o.order_class !== "simple" && o.order_class, o.exchange, o.status, o.time_in_force].filter(Boolean).join(" · "))),
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
        h("td", {}, h("span", { class: "pill " + (o.side === "buy" ? "green" : "red") }, String(o.side || "").toUpperCase())),
        h("td", {}, h("b", {}, o.symbol), h("div", { class: "tiny muted" }, o.status)),
        h("td", { class: "r" }, o.filled_avg_price ? `${o.filled_qty} @ ${fmtPrice(Number(o.filled_avg_price))}` : (o.qty || "$" + o.notional)))))));
  }
  put(body, h("p", { class: "tiny muted" }, `Data from ${status.provider === "ibkr" ? "Interactive Brokers" : "Alpaca"}. Twin is not a broker; orders execute at ${name} under their terms.`));
}
