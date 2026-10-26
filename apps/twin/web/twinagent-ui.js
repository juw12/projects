/* TwinAgent UI: Trade tab view, stock-page sheet, report, journal and track record.
 * Presentation only. All research rules live in twinagent.js (unit-tested and deterministic).
 * TwinAgent never places orders: a positive verdict can only pre-fill the practice ticket.
 */
"use strict";

const TWINAGENT_QUICK = ["AAPL", "MSFT", "NVDA", "TSLA", "KO", "SPY"];
const TA_RATING_CLASS = { Buy: "green", Overweight: "green", Hold: "gray", Underweight: "red", Sell: "red", "No call": "gray" };

(function injectTwinAgentStyles() {
  const css = `
  .ta-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
  .ta-rating { font-size:26px; font-weight:800; line-height:1.1; }
  .ta-meter { position:relative; height:8px; border-radius:4px; margin:10px 0 4px;
    background:linear-gradient(90deg, var(--red), var(--card2) 50%, var(--green)); }
  .ta-meter i { position:absolute; top:-4px; width:4px; height:16px; border-radius:2px; background:var(--text); transform:translateX(-50%); }
  .ta-steps { display:flex; flex-wrap:wrap; gap:5px; margin:8px 0 2px; }
  .ta-step { font-size:11.5px; padding:4px 8px; border-radius:999px; background:var(--card2); border:1px solid var(--line); }
  .ta-step.on { border-color:var(--green); }
  .ta-step.off { opacity:.55; text-decoration:line-through; }
  .ta-table { width:100%; border-collapse:collapse; font-size:12.5px; table-layout:fixed; }
  .ta-table th, .ta-table td { padding:5px 3px; text-align:right; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
  .ta-table th:first-child, .ta-table td:first-child { text-align:left; width:40%; }
  .ta-side { border-left:3px solid var(--green); padding:2px 0 2px 9px; margin:8px 0; }
  .ta-side.bear { border-color:var(--red); }
  .ta-side .tiny { display:block; }
  details.ta { border-top:1px solid var(--line); padding:4px 0; }
  details.ta summary { cursor:pointer; font-weight:650; padding:7px 0; display:flex; justify-content:space-between; gap:8px; }
  .ta-wrap { overflow-wrap:anywhere; }
  .ta-check { display:flex; gap:8px; font-size:13px; padding:4px 0; }
  .ta-check b { flex:none; width:16px; }
  .ta-headline { font-size:12.5px; padding:5px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
  .ta-headline:last-child { border-bottom:0; }
  .ta-good { border:1px solid var(--green); border-radius:12px; padding:10px 12px; font-size:13px; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
})();

/* ------------------------------------------------------------- helpers */
const taPct = (value, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : fmtPct(100 * value, digits));
const taDate = (seconds) => (seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "—");

function taPill(rating) {
  return h("span", { class: `pill ${TA_RATING_CLASS[rating] || "gray"}` }, rating);
}

function taMeter(score) {
  const position = score === null || score === undefined ? 50 : 50 + 50 * Math.max(-1, Math.min(1, score));
  return h("div", { class: "ta-meter", role: "img", "aria-label": `Evidence score ${score === null ? "unavailable" : score.toFixed(2)} on a scale from minus 1 to plus 1` },
    h("i", { style: `left:${position}%` }));
}

function taCopy(text, label) {
  const fallback = () => {
    const field = h("textarea", { readonly: "", rows: 8, "aria-label": label }, text);
    openSheet(h("h2", {}, label), field, h("button", { class: "btn", onclick: closeSheet }, "Done"));
    field.select();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(fallback);
  } else {
    fallback();
  }
}

function taContext(symbol) {
  const profile = state.profile || {};
  const paper = state.paper || profile.paper || {};
  const positions = Array.isArray(paper.positions) ? paper.positions : Object.values(paper.positions || {});
  const held = positions.find((position) => position.symbol === symbol) || null;
  const quiz = profile.quiz || {};
  return {
    held,
    profile: { riskLevel: !quiz.unassessed && quiz.risk_level ? quiz.risk_level : 2, limits: profile.limits || {} },
    portfolio: {
      cash: Number(paper.cash) || 0,
      equity: Number(paper.value) || Number(paper.cash) || 0,
      heldValue: held ? Number(held.value) || 0 : 0,
    },
  };
}

/* ------------------------------------------------------------- journal */
function taJournal() {
  return proRead("twinagent", []);
}

function taRemember(report) {
  if (report.decision.noCall) {
    return;
  }
  const log = taJournal();
  if (log.some((entry) => entry.symbol === report.symbol && entry.fingerprint === report.inputFingerprint)) {
    return;
  }
  log.unshift({
    id: `${Date.now().toString(36)}-${report.symbol}`, symbol: report.symbol, name: report.name,
    rating: report.decision.rating, composite: report.decision.composite, confidence: report.decision.confidenceLabel,
    price: report.price, dataEnd: report.dataEnd, asOf: report.asOf, fingerprint: report.inputFingerprint,
    engineVersion: report.engineVersion, mode: report.mode, savedAt: new Date().toISOString(),
  });
  proWrite("twinagent", log.slice(0, 200));
}

/* ----------------------------------------------------------------- run */
async function runTwinAgent(symbol, container) {
  symbol = String(symbol || "").trim().toUpperCase();
  if (!symbol) {
    container.replaceChildren(errorBox("Enter a ticker, e.g. AAPL."));
    return null;
  }
  const scope = proScope();
  container.replaceChildren(h("div", { class: "card", "aria-live": "polite" },
    h("div", { class: "row", style: "gap:10px" }, spinner(), h("b", {}, `Researching ${symbol}…`)),
    h("p", { class: "tiny muted" }, "Gathering prices, filings, headlines and 13F holdings, then five analysts, a bull-vs-bear debate, the portfolio manager and your risk gate.")));
  if (!state.paper) {
    const paper = await api("api/paper");
    if (paper.ok) {
      state.paper = paper.paper;
    }
  }
  const response = await api("api/twinagent/evidence", { symbol });
  if (!container.isConnected || scope !== proScope()) {
    return null;
  }
  if (!response.ok) {
    container.replaceChildren(errorBox(response.error || "Could not gather evidence."));
    return null;
  }
  const context = taContext(symbol);
  let report;
  try {
    report = TwinAgent.analyze(response.bundle, { profile: context.profile, portfolio: context.portfolio });
  } catch (error) {
    container.replaceChildren(errorBox(error.message));
    return null;
  }
  taRemember(report);
  container.replaceChildren(taReportView(report, context));
  return report;
}

function openTwinAgent(symbol) {
  const body = h("div");
  openSheet(h("h2", {}, `🤖 TwinAgent · ${String(symbol).toUpperCase()}`), body);
  return runTwinAgent(symbol, body);
}

/* -------------------------------------------------------------- report */
function taReportView(report, context) {
  const decision = report.decision;
  const agents = Object.values(report.agents);
  const snapshot = report.mode === "demo";
  return h("div", { class: "ta-report", "data-symbol": report.symbol },
    h("div", { class: "card" },
      h("div", { class: "ta-head" },
        h("div", { style: "min-width:0" },
          h("div", { class: "muted small ta-wrap" }, report.name),
          h("div", { class: "ta-rating", id: "ta-rating" }, decision.rating),
          h("div", { class: "small" }, decision.noCall ? "Not enough evidence for a call"
            : `${decision.confidenceLabel} confidence · ${Math.round(100 * decision.coverage)}% of evidence available`)),
        taPill(decision.rating)),
      decision.noCall ? null : taMeter(decision.composite),
      decision.noCall ? null : h("div", { class: "legend" }, h("span", {}, "Bearish −1"), h("span", { style: "margin-left:auto" }, "+1 Bullish")),
      h("div", { class: "ta-steps", "aria-label": "Research pipeline" },
        agents.map((agent) => h("span", { class: `ta-step ${agent.status === "active" ? "on" : "off"}`, title: agent.reason || "" },
          `${agent.status === "active" ? "✓" : "–"} ${agent.name.replace(" analyst", "")}`)),
        h("span", { class: "ta-step on" }, "⚖ Debate"), h("span", { class: "ta-step on" }, "🧭 Manager"), h("span", { class: "ta-step on" }, "🛡 Risk gate")),
      h("ul", { class: "small", style: "margin:8px 0 0;padding-left:18px" }, decision.reasons.map((reason) => h("li", {}, reason))),
      report.baseRate && report.baseRate.count ? h("p", { class: "small", style: "margin:6px 0 0" },
        `History check: in ${report.baseRate.count} past months with a ${report.baseRate.bucket} price read, the next month averaged ${taPct(report.baseRate.meanNext, 2)}`,
        report.baseRate.hitRate !== null ? ` and moved the expected way ${Math.round(100 * report.baseRate.hitRate)}% of the time.` : ".") : null,
      h("p", { class: "tiny muted", style: "margin:8px 0 0" },
        `${snapshot ? "Historical demo snapshot" : "Delayed live data"} · prices to ${taDate(report.dataEnd)} · analysis as of ${report.asOfDate}`)),
    taRiskCard(report, context),
    taDebateCard(report.debate),
    h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "Analyst team"),
      h("p", { class: "tiny muted" }, `Fixed weights: trend ${pctWeight("trend")}, fundamentals ${pctWeight("fundamentals")}, risk ${pctWeight("risk")}, news ${pctWeight("news")}, 13F ${pctWeight("holdings")}. Analysts without fresh evidence abstain and their weight is removed.`),
      agents.map((agent) => taAgentDetails(agent, report))),
    taScorecardCard(report.scorecard),
    h("div", { class: "card" },
      h("h3", { style: "margin-top:0" }, "Reproduce and share"),
      h("p", { class: "tiny muted ta-wrap" }, `TwinAgent ${report.engineVersion} · evidence fingerprint ${report.inputFingerprint}. The same evidence always gives this exact report.`),
      h("div", { class: "fab-row" },
        h("button", { class: "btn", onclick: () => taCopy(JSON.stringify(report, null, 2), "TwinAgent report JSON") }, "Copy JSON"),
        h("button", { class: "btn", onclick: () => taCopy(taMarkdown(report), "TwinAgent report Markdown") }, "Copy Markdown")),
      h("details", { class: "ta" }, h("summary", {}, "Limitations"),
        h("ul", { class: "small muted" }, report.limitations.map((line) => h("li", {}, line))),
        Object.keys(report.sourceErrors || {}).length ? h("p", { class: "small" }, "Unavailable sources: ",
          Object.entries(report.sourceErrors).map(([name, message]) => `${name}: ${message}`).join(" · ")) : null)));
}

function pctWeight(name) {
  return `${Math.round(100 * TwinAgent.WEIGHTS[name])}%`;
}

function taRiskCard(report, context) {
  const gate = report.riskGate;
  const ticket = gate.ticket;
  return h("div", { class: "card", id: "ta-risk" },
    h("h3", { style: "margin-top:0" }, "🛡 Risk gate · your limits decide"),
    h("p", { class: "small", style: "font-weight:650" }, gate.summary),
    gate.checks.map((check) => h("div", { class: "ta-check" }, h("b", { class: check.pass ? "up" : "down" }, check.pass ? "✓" : "✗"), h("span", {}, check.message))),
    ticket ? h("div", { class: "preview" },
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Practice buy"), h("b", {}, fmtMoney(ticket.dollars))),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Stop-loss"), h("b", {}, TwinGlobal.price(ticket.stop_loss, report.currency))),
      h("div", { class: "kv" }, h("span", { class: "muted" }, `Take-profit (${ticket.rewardRisk}:1)`), h("b", {}, TwinGlobal.price(ticket.take_profit, report.currency))),
      h("div", { class: "kv" }, h("span", { class: "muted" }, "Planned loss at stop"), h("b", { class: "down" }, fmtMoney(ticket.plannedRisk)))) : null,
    ticket ? h("button", {
      class: "btn primary", id: "ta-open-ticket",
      onclick: () => openOrderPro(report.symbol, "buy", report.price, context.held, {
        dollars: ticket.dollars, take_profit: ticket.take_profit, stop_loss: ticket.stop_loss,
      }),
    }, "Review in practice ticket") : null,
    h("p", { class: "tiny muted" }, "TwinAgent never places orders. The ticket opens on your practice account for you to check and confirm. Stops are not guaranteed: gaps can fill worse."));
}

function taDebateCard(debate) {
  const side = (points, kind) => points.length ? points.map((point) => h("div", { class: `ta-side ${kind}` },
    h("b", { class: "small" }, `${point.label}: ${point.display}`),
    h("span", { class: "tiny muted" }, `${point.agentName} · weight ${point.contribution > 0 ? "+" : ""}${point.contribution.toFixed(3)}`),
    point.rebuttal ? h("span", { class: "tiny" }, `↳ Rebuttal (${point.rebuttal.agentName}): ${point.rebuttal.label} ${point.rebuttal.display}`) : null))
    : [h("p", { class: "small muted" }, kind === "bear" ? "No bear points in the available evidence." : "No bull points in the available evidence.")];
  return h("div", { class: "card", id: "ta-debate" },
    h("h3", { style: "margin-top:0" }, "⚖ Bull vs bear"),
    h("p", { class: "tiny muted" }, `Each side argues only from cited evidence. Weight: bull ${debate.bullTotal.toFixed(3)} vs bear ${debate.bearTotal.toFixed(3)} → ${debate.winner === "balanced" ? "balanced" : `${debate.winner} case stronger`}.`),
    h("div", { class: "small", style: "font-weight:700;margin-top:8px" }, "🐂 Bull case"), side(debate.bull, "bull"),
    h("div", { class: "small", style: "font-weight:700;margin-top:8px" }, "🐻 Bear case"), side(debate.bear, "bear"),
    debate.emptySide ? h("p", { class: "tiny muted" }, debate.emptySide) : null);
}

function taAgentDetails(agent, report) {
  const body = [];
  if (agent.status !== "active") {
    body.push(h("p", { class: "small muted" }, `Abstained: ${agent.reason}`));
  } else {
    body.push(h("table", { class: "ta-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Evidence"), h("th", {}, "Value"), h("th", {}, "Score"))),
      h("tbody", {}, agent.signals.map((signal) => h("tr", { title: signal.rule },
        h("td", {}, signal.label), h("td", {}, signal.display), h("td", { class: signClass(signal.score) }, signal.score.toFixed(2)))))));
    const source = agent.source || {};
    if (agent.agent === "fundamentals") {
      body.push(h("p", { class: "tiny muted" }, `${source.kind}: ${source.form || "filing"} for ${source.period}, filed ${source.filed}. Only filings dated on or before the analysis date are used.`));
    } else if (agent.agent === "trend" || agent.agent === "risk") {
      body.push(h("p", { class: "tiny muted" }, `${source.observations} daily closes, ${source.span} (${source.currency}).`));
    } else if (agent.agent === "news") {
      body.push(h("p", { class: "tiny muted" }, `${agent.screening.relevant} relevant in ${agent.screening.lookbackDays} days; ${agent.screening.screenedOut} loosely tagged headlines screened out. Matched on ${report.symbol}${agent.screening.aliases.length ? ` or ${agent.screening.aliases.join(", ")}` : ""}.`));
      body.push(h("div", {}, agent.headlines.slice(0, 6).map((item) => h("div", { class: "ta-headline" },
        item.link ? h("a", { href: item.link, target: "_blank", rel: "noopener" }, item.title) : item.title,
        h("div", { class: "tiny muted" }, `${item.source} · ${String(item.time).slice(0, 10)} · tone ${item.score > 0 ? "+" : ""}${item.score.toFixed(2)}`,
          item.matched.positive.length ? ` · + ${item.matched.positive.join(", ")}` : "",
          item.matched.negative.length ? ` · − ${item.matched.negative.join(", ")}` : "",
          item.question ? " · question headline (half weight)" : "")))));
    } else if (agent.agent === "holdings") {
      body.push(h("div", { class: "small" }, agent.holders.map((holder) => h("div", {}, `${holder.person || holder.filer}: ${holder.weight}% of top-10 (quarter ${holder.quarter}, filed ${holder.filed})`)),
        agent.changes.map((change) => h("div", {}, `${change.person || change.filer}: ${change.status}${change.changePct !== null && change.changePct !== undefined ? ` (${change.changePct}%)` : ""}`))));
    }
  }
  for (const warning of agent.warnings || []) {
    body.push(h("p", { class: "tiny", style: "color:var(--muted)" }, `⚠ ${warning}`));
  }
  return h("details", { class: "ta", "data-agent": agent.agent },
    h("summary", {}, h("span", {}, agent.name),
      h("span", { class: agent.status === "active" ? signClass(agent.score) : "muted" }, agent.status === "active" ? agent.score.toFixed(2) : "abstained")),
    body);
}

function taScorecardCard(card) {
  if (!card || card.status !== "active") {
    return h("div", { class: "card", id: "ta-scorecard" }, h("h3", { style: "margin-top:0" }, "📈 Walk-forward scorecard"),
      h("p", { class: "small muted" }, card ? card.reason : "Unavailable."));
  }
  const row = (label, a, b, c) => h("tr", {}, h("td", {}, label), h("td", {}, a), h("td", {}, b), h("td", {}, c));
  const ratio = (value) => (value === null ? "—" : value.toFixed(2));
  return h("div", { class: "card", id: "ta-scorecard" },
    h("h3", { style: "margin-top:0" }, "📈 Walk-forward scorecard"),
    h("p", { class: "tiny muted" }, `TwinAgent's price evidence replayed month by month, ${card.from} to ${card.to} (${card.decisions} decisions). Each month-end rating sets the next month's exposure (Buy 100% … Sell 0%), with ${card.costBps} bps per unit of turnover. Monthly total returns.`),
    h("table", { class: "ta-table" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "TwinAgent"), h("th", {}, "Buy & hold"), h("th", {}, `Same avg exposure (${Math.round(100 * card.exposureMatched.exposure)}%)`))),
      h("tbody", {},
        row("Yearly growth", taPct(card.strategy.cagr), taPct(card.buyHold.cagr), taPct(card.exposureMatched.cagr)),
        row("Worst drop", taPct(card.strategy.maxDrawdown, 0), taPct(card.buyHold.maxDrawdown, 0), taPct(card.exposureMatched.maxDrawdown, 0)),
        row("Return per risk", ratio(card.strategy.sharpe), ratio(card.buyHold.sharpe), ratio(card.exposureMatched.sharpe)))),
    h("p", { class: "small", style: "margin:10px 0 4px" },
      `After bullish reads the next month averaged ${taPct(card.buckets.bullish.meanNext, 2)} (n=${card.buckets.bullish.count}); after bearish reads ${taPct(card.buckets.bearish.meanNext, 2)} (n=${card.buckets.bearish.count}).`,
      card.tStat !== null ? ` Difference t = ${card.tStat}.` : ""),
    h("div", { class: card.separates ? "ta-good" : "warn", style: "font-size:13px" }, card.verdict),
    h("details", { class: "ta" }, h("summary", {}, "Stability check (two halves)"),
      card.halves.map((part) => h("p", { class: "small" }, `${part.from} → ${part.to}: TwinAgent ${taPct(part.strategyCagr)} a year vs buy & hold ${taPct(part.buyHoldCagr)}; bull-minus-bear spread ${taPct(part.spread, 2)} a month.`))),
    h("p", { class: "tiny muted" }, "Rules and weights are fixed in advance and identical for every ticker. Headlines, filings and 13Fs are not archived historically, so they are not in this replay."));
}

function taMarkdown(report) {
  const lines = [
    `# TwinAgent: ${report.symbol} (${report.name})`, "",
    `- Rating: **${report.decision.rating}**${report.decision.noCall ? "" : ` (score ${report.decision.composite}, ${report.decision.confidenceLabel} confidence, ${Math.round(100 * report.decision.coverage)}% evidence coverage)`}`,
    `- Analysis as of ${report.asOfDate}; prices to ${taDate(report.dataEnd)}; mode: ${report.mode}`,
    `- Risk gate: ${report.riskGate.summary}`,
    `- Engine ${report.engineVersion}; evidence fingerprint ${report.inputFingerprint}`, "", "## Analysts",
  ];
  for (const agent of Object.values(report.agents)) {
    lines.push(`### ${agent.name}: ${agent.status === "active" ? agent.score.toFixed(2) : "abstained"}`);
    if (agent.status !== "active") {
      lines.push(agent.reason);
    }
    for (const signal of agent.signals) {
      lines.push(`- ${signal.label}: ${signal.display} → ${signal.score.toFixed(2)} (${signal.rule})`);
    }
    for (const warning of agent.warnings || []) {
      lines.push(`- ⚠ ${warning}`);
    }
  }
  lines.push("", "## Debate", ...report.debate.bull.map((point) => `- Bull: ${point.label} ${point.display}`),
    ...report.debate.bear.map((point) => `- Bear: ${point.label} ${point.display}`));
  if (report.scorecard.status === "active") {
    const card = report.scorecard;
    lines.push("", "## Walk-forward scorecard (price evidence)",
      `- ${card.from} to ${card.to}: CAGR ${taPct(card.strategy.cagr)} vs buy & hold ${taPct(card.buyHold.cagr)}; worst drop ${taPct(card.strategy.maxDrawdown, 0)} vs ${taPct(card.buyHold.maxDrawdown, 0)}`,
      `- ${card.verdict}`);
  }
  lines.push("", "## Limitations", ...report.limitations.map((line) => `- ${line}`));
  return lines.join("\n");
}

/* -------------------------------------------------- Trade tab: TwinAgent */
function renderTwinAgent(main) {
  const watch = ((state.profile && state.profile.watchlist) || []).filter((symbol) => !(GUEST || DEMO) || TWINAGENT_QUICK.includes(symbol));
  const quick = [...new Set([...TWINAGENT_QUICK, ...watch])].slice(0, 8);
  const input = h("input", {
    value: state.agentSymbol || "AAPL", autocapitalize: "characters", "aria-label": "TwinAgent ticker",
    style: "text-transform:uppercase;font-weight:700;flex:1;min-width:0",
  });
  const output = h("div", { id: "twinagent-output" });
  const journal = h("div", { id: "twinagent-journal" });
  const run = async (symbol) => {
    state.agentSymbol = String(symbol || input.value).trim().toUpperCase();
    input.value = state.agentSymbol;
    await runTwinAgent(state.agentSymbol, output);
    drawTwinAgentJournal(journal);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      run();
    }
  });
  put(main,
    h("div", { class: "card" },
      h("h3", { style: "margin-top:0" }, "🤖 TwinAgent research team"),
      h("p", { class: "small" }, "Five analysts (trend, fundamentals, risk, news, 13F holdings) argue a bull and a bear case from cited evidence. A portfolio manager weighs them, and your own risk limits have the final say."),
      h("p", { class: "tiny muted" }, "Free, private and repeatable: no AI subscription, no data leaves your device in the web demo, and the same evidence always gives the same answer."),
      h("div", { class: "row", style: "gap:8px" }, input, h("button", { class: "btn primary", id: "twinagent-run", style: "flex:none;width:auto;padding:10px 16px", onclick: () => run() }, "Research")),
      h("div", { class: "ind-row" }, quick.map((symbol) => h("button", { class: "chip", onclick: () => run(symbol) }, symbol))),
      (GUEST || DEMO) ? h("p", { class: "tiny muted" }, "Web demo: uses the dated snapshot for the US tickers above. Run Twin on your computer to research any listing with live data.") : null),
    output, journal, taCompareCard());
  drawTwinAgentJournal(journal);
}

async function drawTwinAgentJournal(box) {
  const log = taJournal();
  if (!log.length) {
    box.replaceChildren();
    return;
  }
  const scope = proScope();
  const card = h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "📒 Your TwinAgent journal"),
    h("p", { class: "tiny muted" }, "Every call is saved with its evidence fingerprint and scored later against the S&P 500 from the first close after the call (21 sessions)."), spinner());
  box.replaceChildren(card);
  const recent = log.slice(0, 12);
  const symbols = [...new Set([...recent.map((entry) => entry.symbol), "SPY"])].slice(0, 8);
  const charts = {};
  await Promise.all(symbols.map(async (symbol) => {
    const response = await api("api/chart", { symbol, span: "1Y" });
    charts[symbol] = response.ok ? response.data : null;
  }));
  if (!box.isConnected || scope !== proScope()) {
    return;
  }
  const settled = recent.map((entry) => ({
    ...entry, outcome: charts[entry.symbol] ? TwinAgent.settle(entry, charts[entry.symbol], charts.SPY) : { status: "pending" },
  }));
  const record = TwinAgent.trackRecord(settled);
  card.replaceChildren();
  put(card,
    h("h3", { style: "margin-top:0" }, "📒 Your TwinAgent journal"),
    h("p", { class: "small" }, record.scored
      ? `Scored calls: ${record.scored} · right direction vs S&P 500 ${Math.round(100 * record.hitRate)}% · average edge ${taPct(record.meanAlpha, 2)}.`
      : record.warning),
    record.scored && record.warning ? h("p", { class: "tiny muted" }, record.warning) : null,
    h("div", { class: "list" }, settled.map((entry) => h("div", { class: "order-row" },
      h("div", { style: "flex:1;min-width:0" }, h("b", {}, entry.symbol), " ", taPill(entry.rating),
        h("div", { class: "tiny muted" }, `${taDate(entry.dataEnd)} · ${entry.confidence} confidence · ${entry.mode}`)),
      h("div", { class: "tiny", style: "text-align:right" }, entry.outcome.status === "pending"
        ? "pending"
        : h("span", { class: signClass(entry.outcome.alpha) }, `${taPct(entry.outcome.alpha)} vs SPY${entry.outcome.status === "provisional" ? " (so far)" : ""}`))))),
    h("button", {
      class: "btn ghost small", style: "margin-top:8px",
      onclick: () => {
        if (window.confirm("Clear your TwinAgent journal on this device?")) {
          proWrite("twinagent", []);
          drawTwinAgentJournal(box);
        }
      },
    }, "Clear journal"));
}

function taCompareCard() {
  const rows = [
    ["Cost per run", "Free; runs in the browser", "Paid LLM calls per run"],
    ["Same input → same answer", "Yes, fingerprinted", "No (model sampling)"],
    ["Every number cites its source", "Yes, with dates", "Prose reports"],
    ["Future data blocked", "Every input filtered by as-of date; tested", "Point-in-time controls in recent releases"],
    ["Tested on history", "Decades of monthly walk-forward in seconds", "Ticker/date grid; LLM cost per cell"],
    ["Your risk limits enforced", "Deterministic gate sizes or blocks", "LLM risk debate"],
    ["Reads full articles and nuance", "No: transparent word list", "Yes (LLM)"],
    ["Phone app, practice account", "Yes", "Python CLI"],
  ];
  return h("details", { class: "card ta" },
    h("summary", {}, h("span", {}, "How TwinAgent compares with TradingAgents"), h("span", { class: "muted" }, "›")),
    h("table", { class: "ta-table" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "TwinAgent"), h("th", {}, "TradingAgents"))),
      h("tbody", {}, rows.map(([label, ours, theirs]) => h("tr", {}, h("td", {}, label), h("td", {}, ours), h("td", {}, theirs))))),
    h("p", { class: "tiny muted" }, "TradingAgents (TauricResearch) is an open-source research framework built on large language models. Neither tool has shown it can reliably beat the market; TwinAgent's own scorecard says so when it can't."));
}
