// What the owner can say to the bot. Every handler changes `state` and returns
// { messages: [{ html, buttons? }], toast?, edit? }; the Worker does the sending.

import { MAX_WATCH, approve, blocked, decide, look, manualBuy, manualSell, newState, prices, tick, tracked, worth, TICK_MS } from "./agent.js";
import { backtest } from "./backtest.js";
import { TIMEFRAMES, normalizeSymbol } from "./market.js";
import * as render from "./render.js";
import { clip, errorText, escapeHtml } from "./util.js";

export const COMMANDS = [
  { command: "status", description: "Account, positions and profit" },
  { command: "signals", description: "What the agent sees in each market" },
  { command: "buy", description: "Buy now: /buy BTC 500" },
  { command: "sell", description: "Sell now: /sell BTC" },
  { command: "watch", description: "Add a market: /watch DOGE" },
  { command: "unwatch", description: "Remove a market: /unwatch DOGE" },
  { command: "watchlist", description: "The markets being watched" },
  { command: "auto", description: "Trade alone or ask first: /auto on, /auto off" },
  { command: "pause", description: "Stop new buys" },
  { command: "resume", description: "Allow new buys again" },
  { command: "risk", description: "Risk per trade in percent: /risk 1" },
  { command: "timeframe", description: "Candle size: 15m, 1h, 4h or 1d" },
  { command: "backtest", description: "Try the rules on past prices" },
  { command: "history", description: "Closed trades" },
  { command: "reset", description: "Start over with fresh practice money" },
  { command: "help", description: "How this works" },
];

const say = (html, buttons) => ({ messages: [{ html, buttons }] });

function symbolOf(text) {
  const symbol = normalizeSymbol(text);
  if (!symbol) throw new Error("Which market? For example BTC, ETH or SOL.");
  return symbol;
}

function statusOf(state) {
  return render.status(state, { value: worth(state), prices: prices(state) });
}

const handlers = {
  async start(ctx) {
    return { messages: [render.help(ctx.state.settings)] };
  },

  async help(ctx) {
    return { messages: [render.help(ctx.state.settings)] };
  },

  async status(ctx) {
    const { state } = ctx;
    const messages = [];
    // Prices older than one round are refreshed first, so the numbers are current.
    if (!state.lastTick || ctx.now - state.lastTick.at > TICK_MS) messages.push(...(await tick(state, ctx)));
    messages.push(statusOf(state));
    return { messages };
  },

  async signals(ctx) {
    const { state } = ctx;
    const rows = [];
    for (const symbol of tracked(state)) {
      try {
        const view = await look(ctx.market, symbol, state.settings.timeframe, ctx.now);
        rows.push({
          symbol,
          price: view.price,
          decision: decide(state, view, ctx.now),
          held: !!state.portfolio.positions[symbol],
          blocked: blocked(state),
        });
      } catch (error) {
        rows.push({ symbol, error: clip(errorText(error), 120) });
      }
    }
    if (!rows.length) return say("Nothing on the watchlist. Add a market with /watch BTC.");
    return { messages: [render.signals(rows, state.settings)] };
  },

  async buy(ctx, args) {
    if (!args[0]) return say("Say what to buy: <code>/buy BTC</code> or <code>/buy BTC 500</code> (dollars).");
    const symbol = symbolOf(args[0]);
    let usd = 0;
    if (args[1] !== undefined) {
      usd = Number(String(args[1]).replace(/[$,]/g, ""));
      if (!(usd > 0)) throw new Error("The amount is in dollars, for example /buy BTC 500.");
    }
    const trade = await manualBuy(ctx.state, symbol, usd, ctx);
    const message = render.bought(trade);
    message.html += "\nI will look after it from here: trailing stop, and out when the trend breaks.";
    return { messages: [message] };
  },

  async sell(ctx, args) {
    if (!args[0]) return say("Say what to sell: <code>/sell BTC</code> or <code>/sell all</code>.");
    const held = Object.keys(ctx.state.portfolio.positions);
    const symbols = args[0].toLowerCase() === "all" ? held : [symbolOf(args[0])];
    if (!symbols.length) return say("Holding nothing right now.");
    const messages = [];
    for (const symbol of symbols) messages.push(render.sold(await manualSell(ctx.state, symbol, ctx)));
    return { messages };
  },

  async watch(ctx, args) {
    const { settings } = ctx.state;
    if (!args[0]) return handlers.watchlist(ctx);
    const symbol = symbolOf(args[0]);
    if (settings.watchlist.includes(symbol)) return say(`Already watching ${render.coin(symbol)}.`);
    if (settings.watchlist.length >= MAX_WATCH) return say(`The watchlist is full (${MAX_WATCH}). Remove one with /unwatch first.`);
    let view;
    try {
      view = await look(ctx.market, symbol, settings.timeframe, ctx.now);
    } catch (error) {
      return say(`I cannot find a ${render.coin(symbol)}/USDT market with live prices.`);
    }
    settings.watchlist.push(symbol);
    return say(`👀 Watching <b>${render.coin(symbol)}</b>, now ${render.price(view.price)}.`);
  },

  async unwatch(ctx, args) {
    const { settings, portfolio } = ctx.state;
    if (!args[0]) return say("Say which one: <code>/unwatch DOGE</code>.");
    const symbol = symbolOf(args[0]);
    if (!settings.watchlist.includes(symbol)) return say(`${render.coin(symbol)} is not on the watchlist.`);
    settings.watchlist = settings.watchlist.filter((entry) => entry !== symbol);
    delete ctx.state.pending[symbol];
    const note = portfolio.positions[symbol] ? " I still look after the position you hold." : "";
    return say(`Stopped watching ${render.coin(symbol)}.${note}`);
  },

  async watchlist(ctx) {
    const list = ctx.state.settings.watchlist.map(render.coin).join(", ");
    return say(`👀 Watching: <b>${list || "nothing"}</b>\nAdd with /watch DOGE, remove with /unwatch DOGE.`);
  },

  async auto(ctx, args) {
    const { settings } = ctx.state;
    const want = String(args[0] || "").toLowerCase();
    if (want === "on") settings.auto = true;
    else if (want === "off") settings.auto = false;
    else return say(`Auto is <b>${settings.auto ? "on" : "off"}</b>. <code>/auto on</code>: I trade alone. <code>/auto off</code>: I ask you before every buy.`);
    if (settings.auto) ctx.state.pending = {};
    return say(settings.auto ? "🤖 Auto is on: I buy and sell alone and tell you each time." : "🙋 Auto is off: I ask you before every buy. Stops and exits still run alone.");
  },

  async pause(ctx) {
    ctx.state.settings.paused = true;
    ctx.state.pending = {};
    return say("⏸ Paused: no new buys. Stops and exits still protect what you hold. /resume to continue.");
  },

  async resume(ctx) {
    ctx.state.settings.paused = false;
    return say("▶️ Resumed: I am looking for trades again.");
  },

  async risk(ctx, args) {
    const { settings } = ctx.state;
    if (!args[0]) {
      return say(`Risk is <b>${settings.riskPct}%</b> of the account per trade: that is what a stop-out costs. Change it with <code>/risk 0.5</code> (0.1 to 5).`);
    }
    const value = Number(String(args[0]).replace("%", ""));
    if (!(value >= 0.1 && value <= 5)) throw new Error("Risk must be between 0.1 and 5 percent.");
    settings.riskPct = Math.round(value * 100) / 100;
    return say(`Risk per trade is now <b>${settings.riskPct}%</b> of the account.`);
  },

  async timeframe(ctx, args) {
    const { state } = ctx;
    const choices = Object.keys(TIMEFRAMES).join(", ");
    const want = String(args[0] || "").toLowerCase();
    if (!want) return say(`I read <b>${state.settings.timeframe}</b> candles. Choices: ${choices}.`);
    if (!TIMEFRAMES[want]) throw new Error(`Choose one of: ${choices}.`);
    state.settings.timeframe = want;
    state.pending = {};
    for (const memo of Object.values(state.marks)) delete memo.decided;
    return say(`I now read <b>${want}</b> candles. Open positions keep their stops.`);
  },

  async backtest(ctx, args) {
    const { settings } = ctx.state;
    const symbols = args[0] ? [symbolOf(args[0])] : settings.watchlist.slice(0, 4);
    if (!symbols.length) return say("Say which market: <code>/backtest BTC</code>.");
    const rows = [];
    for (const symbol of symbols) {
      try {
        const { source, candles } = await ctx.market.candles(symbol, settings.timeframe, 1000);
        const result = backtest(candles.slice(0, -1), { riskPct: settings.riskPct, maxPositionPct: settings.maxPositionPct });
        rows.push({ symbol, source, result });
      } catch (error) {
        rows.push({ symbol, error: clip(errorText(error), 120) });
      }
    }
    return { messages: [render.backtests(rows, settings.timeframe)] };
  },

  async history(ctx) {
    return { messages: [render.history(ctx.state.trades)] };
  },

  async reset(ctx, args) {
    const cash = args[0] === undefined ? 10000 : Number(String(args[0]).replace(/[$,]/g, ""));
    if (!(cash >= 100 && cash <= 10000000)) throw new Error("Start with between $100 and $10,000,000 of practice money.");
    return say(`Start over with <b>${render.money(cash)}</b> of practice money? Positions and the trade history are erased.`, [
      [
        { text: "🗑 Yes, start over", data: `reset:${Math.round(cash)}` },
        { text: "Keep it", data: "keep" },
      ],
    ]);
  },
};

async function onText(ctx, text) {
  const match = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  const handler = match && handlers[match[1].toLowerCase()];
  if (!handler) return say("I only understand commands. /help shows them all, /status shows the account.");
  const args = String(match[2] || "").trim().split(/\s+/).filter(Boolean);
  return handler(ctx, args);
}

async function onButton(ctx, query) {
  const { state } = ctx;
  const [action, value] = String(query.data || "").split(":");
  const original = (query.message && query.message.text) || "";
  const done = (note, messages = []) => ({ toast: note, edit: `${escapeHtml(original)}\n\n<i>${escapeHtml(note)}</i>`, messages });
  if (action === "ok") {
    const symbol = symbolOf(value);
    try {
      const trade = await approve(state, symbol, ctx);
      return done("Approved.", [render.bought(trade)]);
    } catch (error) {
      return done(errorText(error));
    }
  }
  if (action === "no") {
    delete state.pending[symbolOf(value)];
    return done("Skipped.");
  }
  if (action === "reset") {
    const fresh = newState(Number(value) || 10000);
    fresh.settings = state.settings;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, fresh);
    return done("Done.", [{ html: `🆕 Fresh start with <b>${render.money(state.portfolio.cash)}</b> of practice money.` }]);
  }
  if (action === "keep") return done("Kept as it is.");
  return { toast: "That button is too old." };
}

// ctx = { state, market, now }
export async function handleUpdate(ctx, update) {
  try {
    if (update.callback_query) return await onButton(ctx, update.callback_query);
    return await onText(ctx, String((update.message && update.message.text) || "").trim());
  } catch (error) {
    const note = clip(errorText(error), 300);
    return { toast: update.callback_query ? note : undefined, messages: [{ html: `⚠️ ${escapeHtml(note)}` }] };
  }
}
