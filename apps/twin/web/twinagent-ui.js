/* TwinAgent UI: Trade tab view, stock-page sheet, report, journal and track record.
 * Presentation only. All research rules live in twinagent.js (unit-tested and deterministic).
 * TwinAgent never places orders: a positive verdict can only pre-fill the practice ticket.
 */
"use strict";

const TWINAGENT_QUICK = ["AAPL", "MSFT", "NVDA", "TSLA", "KO", "SPY"];
const TA_RATING_CLASS = { Buy: "green", Overweight: "green", Hold: "gray", Underweight: "red", Sell: "red", "No call": "gray" };

(function injectTwinAgentStyles() {
  const css = `
  .ta-hero { padding: 18px 16px 14px; }
  .ta-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
  .ta-ticker { font-size:15px; font-weight:700; letter-spacing:-.01em; }
  .ta-ticker span { font-weight:500; color:var(--muted); margin-left:6px; font-size:13px; }
  .ta-verdict { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin:14px 0 2px; }
  .ta-rating { font-size:30px; font-weight:720; letter-spacing:-.03em; line-height:1; }
  .ta-rating.up { color:var(--positive-text); }
  .ta-rating.down { color:var(--negative-text); }
  .ta-score { text-align:right; font-size:22px; font-weight:680; letter-spacing:-.02em; line-height:1; font-variant-numeric:tabular-nums; }
  .ta-score small { display:block; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin-top:4px; }
  .ta-meter { position:relative; height:6px; border-radius:3px; margin:14px 0 6px;
    background:linear-gradient(90deg, var(--red) 0%, var(--card2) 50%, var(--green) 100%); }
  .ta-meter i { position:absolute; top:-5px; width:3px; height:16px; border-radius:2px; background:var(--text); transform:translateX(-50%); box-shadow:0 0 0 2px var(--card); }
  .ta-scale { display:flex; justify-content:space-between; font-size:10.5px; color:var(--muted); letter-spacing:.04em; text-transform:uppercase; }
  .ta-metrics { display:grid; grid-template-columns:repeat(2, 1fr); gap:1px; margin:14px 0 4px; background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .ta-metrics div { background:var(--card); padding:9px 11px; }
  .ta-metrics span { display:block; font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
  .ta-metrics b { font-size:15px; font-weight:650; font-variant-numeric:tabular-nums; }
  .ta-pipe { display:flex; flex-wrap:wrap; gap:4px 12px; margin:12px 0 4px; font-size:12px; color:var(--muted); }
  .ta-pipe span { display:inline-flex; align-items:center; gap:5px; }
  .ta-pipe span::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--green); }
  .ta-pipe span.off { text-decoration:line-through; opacity:.7; }
  .ta-pipe span.off::before { background:var(--line-strong); }
  .ta-notes { margin:10px 0 0; padding:0; list-style:none; font-size:13px; }
  .ta-notes li { padding:6px 0; border-top:1px solid var(--line); }
  .ta-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .ta-head .ta-hic { width:30px; height:30px; border-radius:8px; display:grid; place-items:center; background:var(--accent-soft); color:var(--accent-text); flex:none; }
  .ta-head .ta-hic .ico { width:16px; height:16px; margin:0; }
  .ta-head h3 { margin:0 !important; font-size:15px !important; letter-spacing:-.01em !important; text-transform:none !important; color:var(--text) !important; }
  .ta-head p { margin:0; font-size:12px; color:var(--muted); }
  .ta-row { display:grid; grid-template-columns:1fr 64px 44px; align-items:center; gap:10px; }
  .ta-bar { position:relative; height:6px; border-radius:3px; background:var(--card2); }
  .ta-bar::after { content:""; position:absolute; left:50%; top:-2px; width:1px; height:10px; background:var(--line-strong); }
  .ta-bar i { position:absolute; top:0; bottom:0; border-radius:3px; }
  .ta-bar i.up { background:var(--green); }
  .ta-bar i.down { background:var(--red); }
  .ta-val { text-align:right; font-weight:650; font-size:13.5px; font-variant-numeric:tabular-nums; }
  details.ta-agent { border-top:1px solid var(--line); }
  details.ta-agent:first-of-type { border-top:0; }
  details.ta-agent > summary { list-style:none; cursor:pointer; padding:11px 0; }
  details.ta-agent > summary::-webkit-details-marker { display:none; }
  .ta-agent-name { font-weight:620; font-size:14px; }
  .ta-agent-name small { display:block; font-weight:500; font-size:11.5px; color:var(--muted); }
  .ta-agent-body { padding:2px 0 12px; }
  .ta-table { width:100%; border-collapse:collapse; font-size:12.5px; table-layout:fixed; }
  .ta-table th, .ta-table td { padding:6px 3px; text-align:right; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
  .ta-table th:first-child, .ta-table td:first-child { text-align:left; width:46%; }
  .ta-table tr:last-child td { border-bottom:0; }
  .ta-side-label { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; margin:12px 0 4px; }
  .ta-side-label.bull { color:var(--positive-text); }
  .ta-side-label.bear { color:var(--negative-text); }
  .ta-side-label .ico { margin:0; width:14px; height:14px; }
  .ta-point { padding:9px 0 9px 12px; border-left:2px solid var(--green); margin:6px 0; }
  .ta-point.bear { border-left-color:var(--red); }
  .ta-point b { font-size:13.5px; font-weight:620; }
  .ta-point .tiny { display:block; margin-top:2px; }
  .ta-check { display:flex; gap:10px; font-size:13px; padding:7px 0; border-top:1px solid var(--line); }
  .ta-check:first-of-type { border-top:0; }
  .ta-check b { flex:none; width:18px; height:18px; border-radius:50%; display:grid; place-items:center; font-size:11px; }
  .ta-check b.up { background:var(--green-soft); }
  .ta-check b.down { background:var(--red-soft); }
  .ta-summary { font-size:14px; font-weight:620; margin:0 0 10px; }
  .ta-headline { font-size:12.5px; padding:7px 0; border-top:1px solid var(--line); overflow-wrap:anywhere; }
  .ta-headline a { color:var(--text); text-decoration:none; font-weight:560; }
  .ta-good { border:1px solid var(--line); border-left:3px solid var(--green); border-radius:10px; padding:10px 12px; font-size:13px; background:var(--card2); }
  .ta-search { display:flex; gap:8px; align-items:stretch; margin:12px 0 8px; }
  .ta-search .ta-field { position:relative; flex:1; min-width:0; }
  .ta-search .ta-field .ico { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--muted); margin:0; width:16px; height:16px; pointer-events:none; }
  :root[data-theme] .ta-search input { width:100%; padding-left:36px; text-transform:uppercase; font-weight:650; letter-spacing:.02em; }
  .ta-search .btn { flex:none; width:auto; padding:10px 18px; }
  .ta-intro { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin:12px 0 4px; }
  .ta-intro div { border:1px solid var(--line); border-radius:10px; padding:9px 10px; font-size:11.5px; color:var(--muted); line-height:1.35; }
  .ta-intro b { display:block; color:var(--text); font-size:12.5px; margin-bottom:2px; }
  details.ta { border-top:1px solid var(--line); padding:4px 0; }
  details.ta summary { cursor:pointer; font-weight:620; padding:8px 0; display:flex; justify-content:space-between; gap:8px; list-style:none; }
  details.ta summary::-webkit-details-marker { display:none; }
  .ta-wrap { overflow-wrap:anywhere; }
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

function taTone(score) {
  return score === null || score === undefined ? "" : score > 0.05 ? "up" : score < -0.05 ? "down" : "";
}

function taMeter(score) {
  const position = score === null || score === undefined ? 50 : 50 + 50 * Math.max(-1, Math.min(1, score));
  return h("div", { class: "ta-meter", role: "img", "aria-label": `Evidence score ${score === null ? "unavailable" : score.toFixed(2)} on a scale from minus 1 to plus 1` },
    h("i", { style: `left:${position}%` }));
}

function taBar(score) {
  const value = Math.max(-1, Math.min(1, score || 0));
  const width = Math.abs(value) * 50;
  return h("div", { class: "ta-bar", "aria-hidden": "true" },
    h("i", { class: value >= 0 ? "up" : "down", style: value >= 0 ? `left:50%;width:${width}%` : `left:${50 - width}%;width:${width}%` }));
}

function taSection(icon, title, subtitle) {
  return h("div", { class: "ta-head" }, h("span", { class: "ta-hic" }, TwinIcons.svg(icon)),
    h("div", {}, h("h3", {}, title), subtitle ? h("p", {}, subtitle) : null));
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
  openSheet(h("h2", {}, `TwinAgent · ${String(symbol).toUpperCase()}`), body);
  return runTwinAgent(symbol, body);
}

/* -------------------------------------------------------------- report */
function taReportView(report, context) {
  const decision = report.decision;
  const agents = Object.values(report.agents);
  const snapshot = report.mode === "demo";
  const tone = { Buy: "up", Overweight: "up", Underweight: "down", Sell: "down" }[decision.rating] || "";
  const metric = (label, value) => h("div", {}, h("span", {}, label), h("b", {}, value));
  return h("div", { class: "ta-report", "data-symbol": report.symbol },
    h("div", { class: "card ta-hero" },
      h("div", { class: "ta-top" },
        h("div", { style: "min-width:0" },
          h("div", { class: "ta-ticker ta-wrap" }, report.symbol, h("span", {}, report.name)),
          h("div", { class: "eyebrow", style: "margin-top:2px" }, "TwinAgent verdict")),
        h("span", { class: "pill gray" }, snapshot ? "Demo snapshot" : "Delayed live")),
      h("div", { class: "ta-verdict" },
        h("div", { class: `ta-rating ${tone}`, id: "ta-rating" }, decision.rating),
        decision.noCall ? null : h("div", { class: `ta-score ${tone}` }, `${decision.composite > 0 ? "+" : ""}${decision.composite.toFixed(2)}`, h("small", {}, "Evidence score"))),
      decision.noCall ? null : taMeter(decision.composite),
      decision.noCall ? null : h("div", { class: "ta-scale" }, h("span", {}, "Bearish −1"), h("span", {}, "0"), h("span", {}, "+1 Bullish")),
      h("div", { class: "ta-metrics" },
        metric("Confidence", decision.noCall ? "None" : decision.confidenceLabel),
        metric("Evidence", `${Math.round(100 * decision.coverage)}%`),
        metric("Agreement", decision.agreement === null ? "—" : `${Math.round(100 * decision.agreement)}%`),
        metric("Last price", report.price ? TwinGlobal.price(report.price, report.currency) : "—")),
      h("div", { class: "ta-pipe", "aria-label": "Research pipeline" },
        agents.map((agent) => h("span", { class: agent.status === "active" ? "" : "off", title: agent.reason || "" }, agent.name.replace(" analyst", ""))),
        h("span", {}, "Debate"), h("span", {}, "Manager"), h("span", {}, "Risk gate")),
      h("ul", { class: "ta-notes" },
        decision.reasons.map((reason) => h("li", {}, reason)),
        report.baseRate && report.baseRate.count ? h("li", {},
          `History check: in ${report.baseRate.count} past months with a ${report.baseRate.bucket} price read, the next month averaged ${taPct(report.baseRate.meanNext, 2)}`,
          report.baseRate.hitRate !== null ? ` and moved the expected way ${Math.round(100 * report.baseRate.hitRate)}% of the time.` : ".") : null),
      h("p", { class: "tiny muted", style: "margin:10px 0 0" },
        `${snapshot ? "Historical demo snapshot" : "Delayed live data"} · prices to ${taDate(report.dataEnd)} · analysis as of ${report.asOfDate}`)),
    taRiskCard(report, context),
    taDebateCard(report.debate),
    h("div", { class: "card" },
      taSection("layers", "Analyst team", `Fixed weights: trend ${pctWeight("trend")} · fundamentals ${pctWeight("fundamentals")} · risk ${pctWeight("risk")} · news ${pctWeight("news")} · 13F ${pctWeight("holdings")}`),
      agents.map((agent) => taAgentDetails(agent, report)),
      h("p", { class: "tiny muted", style: "margin:8px 0 0" }, "Analysts without fresh evidence abstain and their weight is removed. Tap a row for the evidence.")),
    taScorecardCard(report.scorecard),
    h("div", { class: "card" },
      taSection("share", "Reproduce and share", `TwinAgent ${report.engineVersion} · fingerprint ${report.inputFingerprint}`),
      h("p", { class: "small muted", style: "margin-top:0" }, "The same evidence always gives this exact report."),
      h("div", { class: "fab-row" },
        h("button", { class: "btn", onclick: () => taCopy(JSON.stringify(report, null, 2), "TwinAgent report JSON") }, "Copy JSON"),
        h("button", { class: "btn", onclick: () => taCopy(taMarkdown(report), "TwinAgent report Markdown") }, "Copy Markdown")),
      h("details", { class: "ta" }, h("summary", {}, h("span", {}, "Limitations"), TwinIcons.svg("chevron")),
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
    taSection("shield", "Risk gate", "Your own limits have the final say"),
    h("p", { class: "ta-summary" }, gate.summary),
    gate.checks.map((check) => h("div", { class: "ta-check" }, h("b", { class: check.pass ? "up" : "down" }, check.pass ? "✓" : "✗"), h("span", {}, check.message))),
    ticket ? h("div", { class: "preview", style: "margin-top:12px" },
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
    h("p", { class: "tiny muted", style: "margin-bottom:0" }, "TwinAgent never places orders. The ticket opens on your practice account for you to check and confirm. Stops are not guaranteed: gaps can fill worse."));
}

function taDebateCard(debate) {
  const side = (points, kind) => points.length ? points.map((point) => h("div", { class: `ta-point ${kind}` },
    h("b", {}, `${point.label}: ${point.display}`),
    h("span", { class: "tiny muted" }, `${point.agentName} · weight ${point.contribution > 0 ? "+" : ""}${point.contribution.toFixed(3)}`),
    point.rebuttal ? h("span", { class: "tiny" }, `Rebuttal (${point.rebuttal.agentName}): ${point.rebuttal.label} ${point.rebuttal.display}`) : null))
    : [h("p", { class: "small muted" }, kind === "bear" ? "No bear points in the available evidence." : "No bull points in the available evidence.")];
  const verdict = debate.winner === "balanced" ? "Balanced" : debate.winner === "bull" ? "Bull case stronger" : "Bear case stronger";
  return h("div", { class: "card", id: "ta-debate" },
    taSection("scale", "Bull vs bear", `${verdict} · ${debate.bullTotal.toFixed(3)} vs ${debate.bearTotal.toFixed(3)} weighted evidence`),
    h("div", { class: "ta-side-label bull" }, TwinIcons.svg("up"), "Bull case"), side(debate.bull, "bull"),
    h("div", { class: "ta-side-label bear" }, TwinIcons.svg("down"), "Bear case"), side(debate.bear, "bear"),
    debate.emptySide ? h("p", { class: "tiny muted", style: "margin-bottom:0" }, debate.emptySide) : null);
}

function taAgentDetails(agent, report) {
  const body = [];
  if (agent.status !== "active") {
    body.push(h("p", { class: "small muted", style: "margin:0" }, `Abstained: ${agent.reason}`));
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
      body.push(h("div", { class: "small" }, agent.holders.map((holder) => h("div", { class: "kv" }, h("span", {}, holder.person || holder.filer), h("b", {}, `${holder.weight}%`))),
        agent.changes.map((change) => h("div", { class: "kv" }, h("span", {}, change.person || change.filer), h("b", {}, `${change.status}${change.changePct !== null && change.changePct !== undefined ? ` ${change.changePct}%` : ""}`)))));
      body.push(h("p", { class: "tiny muted" }, "Weights are each investor's top-10 portfolio share from the latest 13F (quarter and filing date in the report)."));
    }
  }
  for (const warning of agent.warnings || []) {
    body.push(h("p", { class: "tiny muted" }, `Note: ${warning}`));
  }
  return h("details", { class: "ta-agent", "data-agent": agent.agent },
    h("summary", {}, h("div", { class: "ta-row" },
      h("div", { class: "ta-agent-name" }, agent.name, h("small", {}, agent.status === "active" ? `${pctWeight(agent.agent)} weight` : "Abstained")),
      agent.status === "active" ? taBar(agent.score) : h("span"),
      h("div", { class: `ta-val ${agent.status === "active" ? taTone(agent.score) : "muted"}` }, agent.status === "active" ? `${agent.score > 0 ? "+" : ""}${agent.score.toFixed(2)}` : "—"))),
    h("div", { class: "ta-agent-body" }, body));
}

function taScorecardCard(card) {
  if (!card || card.status !== "active") {
    return h("div", { class: "card", id: "ta-scorecard" }, taSection("bars", "Walk-forward scorecard", "Price evidence replayed on history"),
      h("p", { class: "small muted", style: "margin:0" }, card ? card.reason : "Unavailable."));
  }
  const row = (label, a, b, c) => h("tr", {}, h("td", {}, label), h("td", {}, a), h("td", {}, b), h("td", {}, c));
  const ratio = (value) => (value === null ? "—" : value.toFixed(2));
  return h("div", { class: "card", id: "ta-scorecard" },
    taSection("bars", "Walk-forward scorecard", `${card.from} → ${card.to} · ${card.decisions} monthly decisions · ${card.costBps} bps costs`),
    h("table", { class: "ta-table" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "TwinAgent"), h("th", {}, "Buy & hold"), h("th", {}, `Equal exp. ${Math.round(100 * card.exposureMatched.exposure)}%`))),
      h("tbody", {},
        row("Yearly growth", taPct(card.strategy.cagr), taPct(card.buyHold.cagr), taPct(card.exposureMatched.cagr)),
        row("Worst drop", taPct(card.strategy.maxDrawdown, 0), taPct(card.buyHold.maxDrawdown, 0), taPct(card.exposureMatched.maxDrawdown, 0)),
        row("Return per risk", ratio(card.strategy.sharpe), ratio(card.buyHold.sharpe), ratio(card.exposureMatched.sharpe)))),
    h("p", { class: "small", style: "margin:12px 0 8px" },
      `After bullish reads the next month averaged ${taPct(card.buckets.bullish.meanNext, 2)} (n=${card.buckets.bullish.count}); after bearish reads ${taPct(card.buckets.bearish.meanNext, 2)} (n=${card.buckets.bearish.count}).`,
      card.tStat !== null ? ` Difference t = ${card.tStat}.` : ""),
    h("div", { class: card.separates ? "ta-good" : "warn", style: "font-size:13px;margin:0" }, card.verdict),
    h("details", { class: "ta", style: "margin-top:10px" }, h("summary", {}, h("span", {}, "Stability check (two halves)"), TwinIcons.svg("chevron")),
      card.halves.map((part) => h("p", { class: "small" }, `${part.from} → ${part.to}: TwinAgent ${taPct(part.strategyCagr)} a year vs buy & hold ${taPct(part.buyHoldCagr)}; bull-minus-bear spread ${taPct(part.spread, 2)} a month.`))),
    h("p", { class: "tiny muted", style: "margin-bottom:0" }, "Each month-end rating sets next month's exposure (Buy 100% … Sell 0%), using monthly total returns. Rules and weights are fixed in advance; headlines, filings and 13Fs are not archived historically, so they are not in this replay."));
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
    value: state.agentSymbol || "AAPL", autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
    "aria-label": "TwinAgent ticker", placeholder: "Ticker, e.g. AAPL",
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
      h("div", { class: "eyebrow" }, "Research"),
      h("h2", { style: "margin:2px 0 4px" }, "TwinAgent"),
      h("p", { class: "small muted", style: "margin:0" }, "Five analysts argue a bull and a bear case from cited evidence. A portfolio manager weighs them; your own risk limits have the final say."),
      h("div", { class: "ta-search" },
        h("div", { class: "ta-field" }, TwinIcons.svg("search"), input),
        h("button", { class: "btn primary", id: "twinagent-run", onclick: () => run() }, "Research")),
      h("div", { class: "ind-row" }, quick.map((symbol) => h("button", { class: "chip", onclick: () => run(symbol) }, symbol))),
      h("div", { class: "ta-intro" },
        h("div", {}, h("b", {}, "Free"), "No AI subscription"),
        h("div", {}, h("b", {}, "Repeatable"), "Same evidence, same report"),
        h("div", {}, h("b", {}, "No hindsight"), "Future data filtered out")),
      (GUEST || DEMO) ? h("p", { class: "tiny muted", style: "margin:10px 0 0" }, "Web demo uses the dated snapshot for the tickers above. Run Twin on your computer to research any listing with live data.") : null),
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
  const card = h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "TwinAgent journal"),
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
    h("h3", { style: "margin-top:0" }, "TwinAgent journal"),
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
