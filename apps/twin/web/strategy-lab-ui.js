/* Presentation only; all simulation rules live in strategy-lab.js. */
"use strict";

async function openStrategyLab(symbol) {
  const body = h("div", {}, spinner());
  openSheet(h("h2", {}, `Strategy Lab · ${symbol}`), body);
  const scope = proScope();
  const snapshot = GUEST || DEMO;
  try {
    const response = await api("api/chart", { symbol, span: "1Y" });
    if (!body.isConnected || scope !== proScope()) {
      return;
    }
    if (!response.ok) {
      throw new Error(response.error || "Could not load daily history.");
    }
    const data = response.data;
    if (data.span !== "1Y") {
      throw new Error("Daily one-year history is unavailable for this listing. No substitute timeframe was used.");
    }
    const asOf = Date.now() / 1000;
    let points = data.points || [];
    if (!snapshot) {
      // Exclude the current exchange-local date, even after closing, to avoid incomplete daily bars.
      const calendar = new Intl.DateTimeFormat("en-CA", {
        timeZone: data.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      });
      const today = calendar.format(new Date());
      points = points.filter((point) => point[0] <= asOf && calendar.format(new Date(point[0] * 1000)) !== today);
    }
    const fee = h("input", { type: "number", min: 0, max: 100, step: 1, value: 5, "aria-label": "Fee per side in basis points" });
    const slippage = h("input", { type: "number", min: 0, max: 100, step: 1, value: 5, "aria-label": "Slippage per side in basis points" });
    const results = h("div", { "aria-live": "polite" });
    let latest = null;
    const date = (stamp) => new Date(stamp * 1000).toISOString().slice(0, 10);
    const row = (name, strategy, benchmark) => h("tr", {},
      h("th", { scope: "row", style: "text-align:left;padding:8px 4px" }, name),
      h("td", { style: "padding:8px 4px;text-align:right" }, strategy),
      h("td", { style: "padding:8px 4px;text-align:right" }, benchmark));
    const run = () => {
      try {
        if (!fee.value.trim() || !slippage.value.trim()) {
          throw new Error("Enter both costs; use zero explicitly for a zero-cost experiment.");
        }
        latest = TwinLab.evaluate(points, { feeBps: Number(fee.value), slippageBps: Number(slippage.value), asOf });
        latest.source = { symbol, currency: data.currency || "USD", mode: snapshot ? "dated-demo-snapshot" : "delayed-yahoo-history" };
        const report = latest;
        const canvas = h("canvas", { "aria-label": "Holdout strategy and buy-and-hold equity curves", role: "img" });
        results.replaceChildren(
          h("div", { class: "card tight" },
            h("h3", {}, `Selected on training only: ${report.selectedPeriod}-session moving average`),
            h("p", { class: "small muted" }, `Compare 10, 20 and 50-session rules on the first 60% of observations, after a shared warmup. Freeze the best net-return rule before evaluating the last 40%. Ties select the shorter period.`),
            h("p", { class: "tiny muted" }, `Training: ${date(report.training.start)} to ${date(report.training.end)}. Holdout: ${date(report.holdout.start)} to ${date(report.holdout.end)} (${report.holdout.count} observations).`)),
          h("div", { class: "card tight" },
            h("h3", {}, "Holdout results · after costs"),
            h("table", { style: "width:100%;font-size:13px;border-collapse:collapse" },
              h("thead", {}, h("tr", {}, h("th", {}, "Metric"), h("th", {}, "Strategy"), h("th", {}, "Buy & hold"))),
              h("tbody", {},
                row("Net return", fmtPct(report.strategy.returnPct), fmtPct(report.benchmark.returnPct)),
                row("Worst drawdown", fmtPct(report.strategy.maxDrawdownPct), fmtPct(report.benchmark.maxDrawdownPct)),
                row("Completed trades", report.strategy.roundTrips, report.benchmark.roundTrips),
                row("Time invested", `${report.strategy.exposurePct.toFixed(1)}%`, `${report.benchmark.exposurePct.toFixed(1)}%`))),
            h("p", { class: "small", style: "font-weight:650" }, `Difference versus buy & hold: ${report.excessReturnPp > 0 ? "+" : ""}${report.excessReturnPp.toFixed(2)} percentage points.`),
            canvas,
            h("div", { class: "legend" }, h("span", {}, "Blue: strategy"), h("span", {}, "Gold: buy & hold"))),
          h("div", { class: "warn small" }, report.excessReturnPp > 0
            ? "This rule beat buy-and-hold in this sample. That does not demonstrate a repeatable edge."
            : "This rule did not beat buy-and-hold in this sample. Keep the benchmark visible instead of hiding the result."),
          h("details", {}, h("summary", { style: "cursor:pointer;margin:12px 0" }, "Evidence, assumptions and limitations"),
            h("p", { class: "small" }, "Above the moving average: long. Otherwise: cash. Signals use the previous observation; fills use the following observation's close with adverse slippage. Both methods start in cash, use the same holdout, and pay entry and final exit costs. Cash earns no interest. No orders are placed."),
            h("ul", { class: "small muted" }, report.warnings.map((warning) => h("li", {}, warning))),
            h("p", { class: "tiny muted" }, `Source: ${snapshot ? "bundled historical demo snapshot" : "delayed Yahoo history"}; listing currency: ${data.currency || "USD"}; data ends ${date(report.data.end)}. Price returns, not total returns. Engine ${report.engineVersion}.`)),
          h("button", { class: "btn ghost", onclick: async () => {
            const text = JSON.stringify(latest, null, 2);
            try {
              await navigator.clipboard.writeText(text);
              toast("Report copied, including input history and trade ledger");
            } catch (error) {
              const field = h("textarea", { readonly: "", rows: 8, "aria-label": "Strategy Lab report JSON" }, text);
              openSheet(h("h2", {}, "Copy research report"), field);
              field.select();
            }
          } }, "Copy reproducible report"));
        afterPaint(() => {
          if (canvas.isConnected) {
            proChart(canvas, {
              series: [
                { values: report.strategy.equity.map((point) => point[1]), color: "#4c8dff", fill: false },
                { values: report.benchmark.equity.map((point) => point[1]), color: "#f5b301", fill: false },
              ], baseline: 1, height: 180,
            });
          }
        });
      } catch (error) {
        latest = null;
        results.replaceChildren(errorBox(error.message));
      }
    };
    body.replaceChildren(
      h("p", { class: "small muted" }, "Test a simple trend rule against doing less. Deterministic research, not an AI recommendation or a trading signal."),
      h("div", { class: "pill gray" }, snapshot ? "Historical demo · not live prices" : "Daily history · current local date excluded"),
      h("div", { class: "grid2", style: "margin-top:12px" },
        h("label", { class: "f" }, "Fee per side (bps)", fee),
        h("label", { class: "f" }, "Slippage per side (bps)", slippage)),
      h("p", { class: "tiny muted" }, "One basis point is 0.01%. Defaults are illustrative, not your broker's fee schedule."),
      h("button", { class: "btn", onclick: run }, "Recalculate with these costs"), results);
    run();
  } catch (error) {
    if (body.isConnected && scope === proScope()) {
      body.replaceChildren(errorBox(error.message));
    }
  }
}
