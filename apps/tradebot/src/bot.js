// What the owner can say to the bot. Every handler changes `state` and returns
// { messages: [{ html, buttons? }], toast?, edit? }; the Worker does the sending.
//
// Every answer says what happened and what to do next. A refusal always says that nothing was
// bought, sold or erased. Raw errors never reach the chat.

import { MAX_WATCH, approve, blocked, decide, look, manualBuy, manualSell, newState, prices, skip, tick, tracked, worth, TICK_MS } from "./agent.js";
import { backtest } from "./backtest.js";
import { TIMEFRAMES, normalizeSymbol } from "./market.js";
import * as render from "./render.js";
import { Problem, errorText, escapeHtml } from "./util.js";

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
  { command: "desk", description: "The second opinion (Bull, Bear, Risk) and its record" },
  { command: "reset", description: "Start over with fresh practice money" },
  { command: "help", description: "How this works" },
];

// Commands that only show something. A misspelled one is simply run; one that acts is not.
const READ_ONLY = new Set(["status", "signals", "help", "history", "watchlist"]);

// Everyday words that clearly ask for one of the read-only commands.
const PLAIN = [
  [/\b(how\b.*\b(going|doing)|account|balance|profit|portfolio|how much|holding|positions?)\b/i, "status"],
  [/\b(signals?|what do you see|markets?)\b/i, "signals"],
  [/\b(trade history|past trades|closed trades)\b/i, "history"],
  [/\b(watch ?list|watching)\b/i, "watchlist"],
  [/\b(what can you do|commands|how do(es)? (you|this|it) work)\b/i, "help"],
];

const OLD_BUTTON = "This button is from an older message and no longer works. Nothing was done. /status shows the account.";

const say = (html, buttons) => ({ messages: [{ html, buttons }] });
const warn = (html) => say(`⚠️ ${html}`);
const quote = (text) => `<code>${escapeHtml(String(text).slice(0, 40))}</code>`;
const names = (symbols) => symbols.map(render.coin).join(", ");

function unreadable(text, nothing) {
  return warn(`I cannot read ${quote(text)} as a coin name, so ${nothing}. Use the short name, like BTC, ETH or DOGE.`);
}

function dollars(text) {
  return Number(String(text).replace(/[$,]/g, ""));
}

function statusOf(state, now) {
  return render.status(state, { value: worth(state), prices: prices(state), now });
}

// Open offers are closed (for example when buying is paused). Returns a sentence, or "".
function withdrawOffers(state, symbols = Object.keys(state.pending)) {
  const closed = symbols.filter((symbol) => state.pending[symbol]);
  for (const symbol of closed) {
    delete state.pending[symbol];
    if (state.day && state.day.offers) state.day.offers[symbol] = "withdrawn";
  }
  if (!closed.length) return "";
  return ` My open ${closed.length === 1 ? "offer" : "offers"} for ${names(closed)} ${closed.length === 1 ? "is" : "are"} closed: nothing was bought.`;
}

function forgetPassed(state) {
  for (const memo of Object.values(state.marks)) delete memo.passed;
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
    messages.push(statusOf(state, ctx.now));
    return { messages };
  },

  async signals(ctx) {
    const { state } = ctx;
    const rows = [];
    for (const symbol of tracked(state)) {
      try {
        const view = await look(ctx.market, symbol, state.settings.timeframe, ctx.now);
        const last = view.closed[view.closed.length - 1];
        const memo = state.marks[symbol] || {};
        rows.push({
          symbol,
          price: view.price,
          decision: decide(state, view, ctx.now),
          held: state.portfolio.positions[symbol] || null,
          blocked: blocked(state),
          pending: state.pending[symbol] || null,
          passed: memo.passed || "",
          judged: !!last && memo.decided === last.t,
        });
      } catch (error) {
        rows.push({ symbol, error });
      }
    }
    if (!rows.length) return say("Nothing on the watchlist, so there are no signals. Add a coin with <code>/watch BTC</code>.");
    return { messages: [render.signals(rows, state, ctx.now)] };
  },

  async buy(ctx, args) {
    if (!args[0]) {
      return say("Say what to buy: <code>/buy BTC</code> (I pick the size by my risk rule) or <code>/buy BTC 500</code> (500 dollars of practice money).");
    }
    const symbol = normalizeSymbol(args[0]);
    if (!symbol) return unreadable(args[0], "nothing was bought");
    const name = render.coin(symbol);
    let usd = 0;
    if (args[1] !== undefined) {
      usd = dollars(args[1]);
      if (!(usd > 0)) return warn(`Nothing was bought. The amount is in dollars, for example <code>/buy ${name} 500</code>.`);
    }
    try {
      return { messages: [render.bought(await manualBuy(ctx.state, symbol, usd, ctx), ctx.state.settings)] };
    } catch (error) {
      if (error && error.kind) return warn(`Not bought. ${render.noPrice(error, name)}`);
      throw error;
    }
  },

  async sell(ctx, args) {
    const { state } = ctx;
    const held = Object.keys(state.portfolio.positions);
    if (!args[0]) {
      const holding = held.length ? `You hold: ${names(held)}.` : "You hold no coins right now.";
      return say(`Say what to sell: <code>/sell ${held.length ? render.coin(held[0]) : "BTC"}</code> or <code>/sell all</code>. ${holding}`);
    }
    const everything = args[0].toLowerCase() === "all";
    const symbol = everything ? null : normalizeSymbol(args[0]);
    if (!everything && !symbol) return unreadable(args[0], "nothing was sold");
    if (everything && !held.length) return say("Holding nothing right now, so there is nothing to sell.");
    const messages = [];
    for (const entry of everything ? held : [symbol]) {
      try {
        messages.push(render.sold(await manualSell(state, entry, ctx), state));
      } catch (error) {
        if (!(error && error.kind)) throw error;
        messages.push({ html: `⚠️ ${render.coin(entry)} not sold. ${render.noPrice(error, render.coin(entry))}` });
      }
    }
    return { messages };
  },

  async watch(ctx, args) {
    const { state } = ctx;
    const { settings } = state;
    if (!args[0]) return handlers.watchlist(ctx);
    const symbol = normalizeSymbol(args[0]);
    if (!symbol) return unreadable(args[0], "nothing was added");
    const name = render.coin(symbol);
    if (settings.watchlist.includes(symbol)) return say(`Already watching ${name}, so nothing changed. /signals shows what I see in it.`);
    if (settings.watchlist.length >= MAX_WATCH) {
      return warn(`Not added: the watchlist is full (${MAX_WATCH} coins). Make room first, for example <code>/unwatch ${render.coin(settings.watchlist[0])}</code>.`);
    }
    let view;
    try {
      view = await look(ctx.market, symbol, settings.timeframe, ctx.now);
    } catch (error) {
      return warn(`Not added. ${render.noPrice(error, name)}`);
    }
    settings.watchlist.push(symbol);
    const next = settings.paused
      ? "Buying is paused, so I only watch it for now."
      : settings.auto
        ? "I judge it at my next 5-minute check and buy it if all 3 checks pass."
        : "I judge it at my next 5-minute check and ask you before buying it.";
    return say(`👀 Watching <b>${name}</b>, now ${render.price(view.price)}. ${next}`);
  },

  async unwatch(ctx, args) {
    const { state } = ctx;
    const { settings, portfolio } = state;
    const watching = () => (settings.watchlist.length ? `Watching now: ${names(settings.watchlist)}.` : "The watchlist is empty now, so I will not buy anything. /watch BTC adds a coin.");
    if (!args[0]) return say(`Say which one: <code>/unwatch ${settings.watchlist.length ? render.coin(settings.watchlist[0]) : "DOGE"}</code>. ${watching()}`);
    const symbol = normalizeSymbol(args[0]);
    if (!symbol) return unreadable(args[0], "nothing was removed");
    const name = render.coin(symbol);
    if (!settings.watchlist.includes(symbol)) return say(`${name} is not on the watchlist, so nothing changed. ${watching()}`);
    settings.watchlist = settings.watchlist.filter((entry) => entry !== symbol);
    const offer = withdrawOffers(state, [symbol]);
    if (state.marks[symbol]) delete state.marks[symbol].passed;
    if (state.day && state.day.notTaken) delete state.day.notTaken[symbol];
    const held = portfolio.positions[symbol] ? ` You still hold ${name}: I keep its stop and sell rules on, and will not buy it again once it is sold.` : "";
    return say(`Stopped watching ${name}: I will not buy it.${offer}${held} ${watching()}`);
  },

  async watchlist(ctx) {
    const list = ctx.state.settings.watchlist;
    return say(
      `👀 Watching: <b>${names(list) || "nothing"}</b> (${list.length} of ${MAX_WATCH})\nAdd with <code>/watch DOGE</code>, remove with <code>/unwatch DOGE</code>. /signals shows what I see in each.`,
    );
  },

  async auto(ctx, args) {
    const { state } = ctx;
    const { settings } = state;
    const want = String(args[0] || "").toLowerCase();
    if (want !== "on" && want !== "off") {
      const now = settings.auto
        ? "Auto is <b>on</b>: I buy alone when all 3 checks pass and tell you each time. <code>/auto off</code> makes me ask you before every buy."
        : "Auto is <b>off</b>: I ask you before every buy. <code>/auto on</code> lets me buy alone when all 3 checks pass.";
      return say(`${now} Selling (stops and sell rules) always runs alone.`);
    }
    settings.auto = want === "on";
    if (!settings.auto) {
      return say("🙋 Auto is off: I ask you before every buy, and you have until the candle closes to answer. No answer means no buy. Selling (stops and sell rules) still runs alone.");
    }
    const offers = withdrawOffers(state);
    forgetPassed(state);
    return say(`🤖 Auto is on: I buy alone when all 3 checks pass and tell you each time. Selling runs alone too.${offers} <code>/auto off</code> makes me ask first again.`);
  },

  async pause(ctx) {
    ctx.state.settings.paused = true;
    const offers = withdrawOffers(ctx.state);
    return say(`⏸ Paused: I buy nothing until you send /resume. Stops and sell rules still protect what you hold.${offers}`);
  },

  async resume(ctx) {
    ctx.state.settings.paused = false;
    return say(`▶️ Resumed: buying is allowed again. ${render.nextStep(ctx.state, ctx.now)}`);
  },

  async risk(ctx, args) {
    const { state } = ctx;
    const { settings } = state;
    const account = worth(state);
    const cost = () =>
      `a trade that hits its stop costs about ${render.money((account * settings.riskPct) / 100)} of today's ${render.money(account)}, less when the ${settings.maxPositionPct}% per-coin cap makes the trade smaller`;
    if (!args[0]) {
      return say(`Risk is <b>${settings.riskPct}%</b> of the account per trade: ${cost()}. Change it with <code>/risk 0.5</code> (0.1 to 5).`);
    }
    const value = Number(String(args[0]).replace("%", ""));
    if (!(value >= 0.1 && value <= 5)) {
      return warn(`Risk stays at ${settings.riskPct}%. It must be between 0.1 and 5 percent, for example <code>/risk 0.5</code>.`);
    }
    settings.riskPct = Math.round(value * 100) / 100;
    return say(`Risk per trade is now <b>${settings.riskPct}%</b> of the account: ${cost()}. This is for new trades; open ones keep their size and stop.`);
  },

  async timeframe(ctx, args) {
    const { state } = ctx;
    const { settings } = state;
    const choices = Object.keys(TIMEFRAMES).join(", ");
    const want = String(args[0] || "").toLowerCase();
    if (!want) {
      const close = render.hour(render.nextClose(settings.timeframe, ctx.now));
      return say(
        `I read <b>${settings.timeframe}</b> candles: one candle is one ${settings.timeframe} slice of the price, and I judge each coin when a candle closes (next at ${close}). Shorter candles mean more trades and more noise. Change with <code>/timeframe 1h</code>; the choices are ${choices}.`,
      );
    }
    if (!TIMEFRAMES[want]) return warn(`The candle size stays at ${settings.timeframe}. Choose one of: ${choices}, for example <code>/timeframe 1h</code>.`);
    if (want === settings.timeframe) return say(`I already read ${want} candles, so nothing changed.`);
    settings.timeframe = want;
    const offers = withdrawOffers(state);
    forgetPassed(state);
    for (const memo of Object.values(state.marks)) delete memo.decided;
    return say(`I now read <b>${want}</b> candles. Open positions keep their stops, and I judge every coin again at my next 5-minute check.${offers}`);
  },

  async backtest(ctx, args) {
    const { settings } = ctx.state;
    let symbols = settings.watchlist.slice(0, 4);
    if (args[0]) {
      const symbol = normalizeSymbol(args[0]);
      if (!symbol) return unreadable(args[0], "there is no backtest");
      symbols = [symbol];
    }
    if (!symbols.length) return say("Say which coin: <code>/backtest BTC</code>.");
    const rows = [];
    for (const symbol of symbols) {
      try {
        const { source, candles } = await ctx.market.candles(symbol, settings.timeframe, 1000);
        const result = backtest(candles.slice(0, -1), { riskPct: settings.riskPct, maxPositionPct: settings.maxPositionPct });
        rows.push({ symbol, source, result });
      } catch (error) {
        rows.push({ symbol, error });
      }
    }
    return { messages: [render.backtests(rows, settings.timeframe)] };
  },

  async history(ctx) {
    return { messages: [render.history(ctx.state.trades)] };
  },

  async desk(ctx, args) {
    const { settings } = ctx.state;
    const want = String(args[0] || "").toLowerCase();
    if (want === "on" || want === "off") settings.desk = want === "on";
    return { messages: [render.deskReport(ctx.state)] };
  },

  async reset(ctx, args) {
    const { state } = ctx;
    const cash = args[0] === undefined ? 10000 : dollars(args[0]);
    if (!(cash >= 100 && cash <= 10000000)) {
      return warn("Nothing was erased. Start with between $100 and $10,000,000 of practice money, for example <code>/reset 10000</code>.");
    }
    return say(
      `Start over with <b>${render.money(cash)}</b> of practice money?\nThis erases ${erased(state)}. Your settings and watchlist stay.`,
      [
        [
          { text: "🗑 Yes, start over", data: `reset:${Math.round(cash)}` },
          { text: "Keep it", data: "keep" },
        ],
      ],
    );
  },
};

// What a reset throws away, in words.
function erased(state) {
  const held = Object.keys(state.portfolio.positions).length;
  const closed = state.trades.filter((trade) => trade.side === "sell").length;
  const result = worth(state) - state.portfolio.start;
  const coins = held === 0 ? "" : `the ${held === 1 ? "1 coin" : `${held} coins`} you hold, `;
  return `${coins}${closed === 1 ? "1 closed trade" : `${closed} closed trades`} and the result so far (${render.signedMoney(result)})`;
}

// Edit distance where swapping two neighbouring letters counts as one mistake.
function distance(left, right) {
  const rows = [];
  for (let i = 0; i <= left.length; i++) {
    rows.push([i]);
    for (let j = 1; j <= right.length; j++) {
      if (i === 0) {
        rows[i][j] = j;
        continue;
      }
      const change = left[i - 1] === right[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + change);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) best = Math.min(best, rows[i - 2][j - 2] + 1);
      rows[i][j] = best;
    }
  }
  return rows[left.length][right.length];
}

// The one command a misspelled word most likely means, or null when it is not clear.
export function nearest(word) {
  const known = COMMANDS.map((entry) => entry.command);
  const limit = word.length <= 4 ? 1 : 2;
  let best = [];
  let least = limit + 1;
  for (const name of known) {
    const far = distance(word, name);
    if (far < least) {
      best = [name];
      least = far;
    } else if (far === least) {
      best.push(name);
    }
  }
  if (least <= limit && best.length === 1) return best[0];
  if (word.length < 3) return null;
  const starts = known.filter((name) => name.startsWith(word));
  return starts.length === 1 ? starts[0] : null;
}

// The owner most likely meant `command`. Showing something is safe, so it is done with a note;
// anything that changes the account or the settings is only offered.
async function guessed(ctx, command, args, typed) {
  const full = [`/${command}`, ...args].join(" ");
  if (!READ_ONLY.has(command)) return say(`Did you mean ${quote(full)}? Nothing was done. Send it like that and I will do it.`);
  const result = await handlers[command](ctx, args);
  const note = `<i>I read ${typed ? escapeHtml(typed) : "that"} as /${command}.</i>`;
  const answer = result.messages[result.messages.length - 1];
  result.messages[result.messages.length - 1] = { ...answer, html: `${note}\n\n${answer.html}` };
  return result;
}

async function onText(ctx, text) {
  const match = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (match) {
    const word = match[1].toLowerCase();
    const args = String(match[2] || "").trim().split(/\s+/).filter(Boolean);
    if (Object.hasOwn(handlers, word)) return handlers[word](ctx, args);
    const command = nearest(word);
    if (command) return guessed(ctx, command, args, `/${word}`);
    return say(`I only understand commands, and ${quote(`/${word}`)} is not one of them. /help lists them all, /status shows the account.`);
  }
  const words = text.split(/\s+/).filter(Boolean);
  const first = String(words[0] || "").toLowerCase();
  if (first !== "start" && Object.hasOwn(handlers, first)) return guessed(ctx, first, words.slice(1), "");
  const topic = PLAIN.find(([pattern]) => pattern.test(text));
  if (topic) return guessed(ctx, topic[1], [], "");
  return say("I only understand commands, not everyday sentences. Try /status (the account), /signals (what I see in each coin) or /help (how I trade, and every command).");
}

async function onButton(ctx, query) {
  const { state } = ctx;
  const [action, value] = String(query.data || "").split(":");
  const original = (query.message && query.message.text) || "";
  const time = render.hour(ctx.now);
  // The message keeps its text and gets one closing line; the buttons go away.
  const closed = (note) => `${escapeHtml(original.split("\n\n— ")[0])}\n\n— <i>${escapeHtml(note)}</i>`;

  if (action === "ok" || action === "no") {
    const symbol = normalizeSymbol(value);
    if (!symbol) return { toast: OLD_BUTTON };
    const name = render.coin(symbol);
    if (action === "no") {
      if (skip(state, symbol)) {
        return {
          toast: `Skipped ${name}. Nothing was bought.`,
          edit: closed(`Skipped ${time}: nothing was bought. I will not offer ${name} again until this signal goes away and comes back. Changed your mind? /buy ${name}.`),
        };
      }
      const note = state.portfolio.positions[symbol]
        ? `This offer was already approved: the account holds ${name}. To sell it, send /sell ${name}.`
        : "This offer is already closed, so there was nothing to skip. Nothing was bought.";
      return { toast: note, edit: closed(note) };
    }
    try {
      const trade = await approve(state, symbol, ctx);
      return {
        toast: `Bought ${name} with practice money.`,
        edit: closed(`Approved ${time}: bought, details below.`),
        messages: [render.bought(trade, state.settings)],
      };
    } catch (error) {
      if (error instanceof Problem) return { toast: error.message, edit: closed(error.message) };
      if (!(error && error.kind)) throw error;
      // Only the price is missing: the offer and its buttons stay.
      const note = `Nothing was bought: I could not read the ${name} price just now. The offer stays open; tap Approve again in a few minutes.`;
      return { toast: note, messages: [{ html: `⚠️ ${note}` }] };
    }
  }

  if (action === "reset") {
    const cash = Number(value);
    if (!(cash >= 100 && cash <= 10000000)) return { toast: OLD_BUTTON };
    const gone = erased(state);
    const fresh = newState(cash);
    fresh.settings = state.settings;
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, fresh);
    const { settings } = state;
    return {
      toast: "Started over.",
      edit: closed(`Started over ${time} with ${render.money(cash)}.`),
      messages: [
        {
          html: [
            `🆕 Fresh start with <b>${render.money(cash)}</b> of practice money.`,
            `Erased: ${gone}.`,
            "Kept: your settings and watchlist.",
            "",
            render.modeLine(settings),
            `Watching: ${names(settings.watchlist) || "nothing"}`,
            `Next: ${render.nextStep(state, ctx.now)}`,
          ].join("\n"),
        },
      ],
    };
  }

  if (action === "keep") {
    const note = "Kept as it is: nothing was erased.";
    return { toast: note, edit: closed(note) };
  }
  return { toast: OLD_BUTTON };
}

// ctx = { state, market, now }
export async function handleUpdate(ctx, update) {
  const button = update.callback_query;
  try {
    if (button) return await onButton(ctx, button);
    return await onText(ctx, String((update.message && update.message.text) || "").trim());
  } catch (error) {
    let note;
    if (error instanceof Problem) {
      note = error.message;
    } else if (error && error.kind) {
      note = "I could not read prices just now, so nothing was done. Try again in a few minutes.";
    } else {
      console.error("command failed: " + errorText(error));
      note = "Something went wrong on my side, and nothing was changed. /status shows where the account stands.";
    }
    return { toast: button ? note : undefined, messages: [{ html: `⚠️ ${escapeHtml(note)}` }] };
  }
}
