/* ------------------------- views: income, debts, challenges, Mint, dates */
const AMOUNT_HINT = () => (/^\s*(rp\.?|idr)\s*$/i.test(state.couple.currency) ? "e.g. 250rb or 1,5jt" : "e.g. 250 or 1.5k");
/** A text amount field: accepts "250rb", "1,5jt", "Rp 25.000" as well as plain numbers. */
function amountInput(name, label, { value = "", placeholder = AMOUNT_HINT(), style = "", required = false } = {}) {
  return `<input name="${name}" type="text" autocomplete="off" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" value="${esc(value)}"${style ? ` style="${style}"` : ""}${required ? " required" : ""}>`;
}
function mintStorage() {
  return ui.mintStorage || localStorage;
}

/** Income, fair split, fun money and the savings-rate dial. */
function incomeCardHTML() {
  const cur = state.couple.currency;
  const r = state.retirement;
  const n = names();
  const shares = partnerShares(state);
  const rate = savingsRatePlan(state);
  const yearsText = years => years === null ? "100+ years" : years < 1 ? "under a year" : `${Math.round(years)} years`;
  const table = rate ? `<div class="rate-table" role="table" aria-label="Savings rate and years to financial freedom">
      ${rate.rows.map(row => `<div role="row" class="rate-row ${Math.abs(row.rate - rate.currentRate) < 0.05 ? "now" : ""}">
        <span role="cell">Save ${Math.round(row.rate * 100)}%</span><span role="cell"><b>${esc(yearsText(row.years))}</b></span></div>`).join("")}
    </div>
    <p class="small">You save about <b>${Math.round(rate.currentRate * 100)}%</b> of your take-home pay now (pots + investing), so freedom is about <b>${esc(yearsText(rate.currentYears))}</b> away if you lived on the rest.</p>
    <p class="small muted">Each row assumes you live on what you don't save, so a higher rate both grows your money and lowers the number you need. ${esc(rate.realRate.toFixed(1))}% real return, from your assumptions.</p>`
    : `<p class="small muted">Add your take-home pay to see how your savings rate sets the years to financial freedom.</p>`;
  return `<div class="section-head"><div><h2>Our income &amp; savings rate</h2>
      <p class="muted small">Take-home pay per month. Used for a fair split of weekly targets and the savings-rate dial.</p></div></div>
    <div class="card">
      <form class="fields-2" data-form="retirement">
        <label class="field">${esc(n.a)}'s take-home / month (${esc(cur)})<input name="incomeA" type="number" step="any" min="0" value="${esc(r.incomeA)}"></label>
        <label class="field">${esc(n.b)}'s take-home / month (${esc(cur)})<input name="incomeB" type="number" step="any" min="0" value="${esc(r.incomeB)}"></label>
        <label class="field">Split weekly targets<select name="splitMode">
          <option value="equal" ${r.splitMode !== "income" ? "selected" : ""}>50 / 50</option>
          <option value="income" ${r.splitMode === "income" ? "selected" : ""}>By income</option></select></label>
        <label class="field">Fun money / month for dates (${esc(cur)})<input name="funMonthly" type="number" step="any" min="0" value="${esc(r.funMonthly)}"></label>
      </form>
      <p class="small">Split now: <b>${esc(n.a)} ${Math.round(shares.a * 100)}%</b> · <b>${esc(n.b)} ${Math.round(shares.b * 100)}%</b>${r.splitMode === "income" && !shares.byIncome ? ' <span class="muted">(add both incomes to split by income)</span>' : ""}</p>
      ${table}
    </div>`;
}

/** Debt-free plan: list, method, extra per month, debt-free date and interest saved. */
function debtCardHTML(now) {
  const cur = state.couple.currency;
  const r = state.retirement;
  const plan = debtPlan(state, now);
  const debts = state.debts.slice().sort((x, y) => (plan.payoff[x.id] || 9999) - (plan.payoff[y.id] || 9999));
  const methodName = plan.method === "snowball" ? "smallest balance first" : "highest interest first";
  let summary = "";
  if (plan.count) {
    if (!plan.feasible) {
      summary = `<p class="small"><span class="chip warn" style="white-space:normal">At these payments the debts never clear: interest grows faster. Add an extra amount per month.</span></p>`;
    } else {
      const saved = plan.other.feasible ? plan.other.totalInterest - plan.totalInterest : null;
      summary = `<p class="small">Debt-free around <b>${esc(plan.date.toLocaleDateString(i18n.locale, { month: "short", year: "numeric" }))}</b> (${plan.months} months), paying ${esc(money(plan.budget, cur))}/month in total and ${esc(money(plan.totalInterest, cur))} interest.</p>
        ${saved !== null && Math.abs(saved) >= 1 ? `<p class="small muted">${saved > 0 ? `That's ${esc(money(saved, cur))} less interest than the other order.` : `The other order would save ${esc(money(-saved, cur))} interest, but ${plan.method === "snowball" ? "quick wins keep many couples going" : "this one clears the biggest cost first"}.`}</p>` : ""}`;
    }
  }
  return `<div class="section-head"><div><h2>Debt-free plan</h2><p class="muted small">Clearing debt is usually the first big step to freedom.</p></div>
      <button type="button" class="primary" data-act="add-debt">+ Debt</button></div>
    <div class="card">
      ${debts.length ? `<ul class="clean">${debts.map(d => {
        const month = plan.payoff[d.id];
        return `<li class="spread debt-row"><div style="min-width:0"><b>${esc(d.name)}</b>
            <div class="small muted">${esc(money(d.balance, cur))} · ${esc(String(Number(d.rate) || 0))}% a year · min ${esc(money(d.minimum, cur))}/month</div>
            ${Number(d.balance) > 0 ? `<div class="small">${month ? `Paid off ${esc(addMonths(now, month).toLocaleDateString(i18n.locale, { month: "short", year: "numeric" }))}` : "Not cleared at these payments"}</div>` : '<span class="chip ok">✓ Paid off</span>'}</div>
          <span style="white-space:nowrap"><button type="button" class="ghost" data-act="edit-debt" data-id="${esc(d.id)}" aria-label="Edit ${esc(d.name)}">${icon("pencil")}</button><button type="button" class="ghost" data-act="delete-debt" data-id="${esc(d.id)}" aria-label="Delete ${esc(d.name)}">${icon("trash")}</button></span></li>`;
      }).join("")}</ul>` : '<div class="empty">No debts? Lovely. If you have any (cards, loans, buy-now-pay-later), add them to get a debt-free date.</div>'}
      ${debts.length ? `<form class="fields-2" data-form="retirement" style="margin-top:10px">
        <label class="field">Order<select name="debtMethod">
          <option value="avalanche" ${plan.method === "avalanche" ? "selected" : ""}>Highest interest first (pay less)</option>
          <option value="snowball" ${plan.method === "snowball" ? "selected" : ""}>Smallest balance first (quick wins)</option></select></label>
        <label class="field">Extra on top of minimums / month (${esc(cur)})<input name="debtExtra" type="number" step="any" min="0" value="${esc(r.debtExtra)}"></label>
      </form>
      ${summary}
      <p class="small muted">Paying ${esc(methodName)}; when a debt is gone, its payment rolls into the next one. Update balances now and then with the pencil.</p>` : ""}
    </div>`;
}

/** Saving challenges: 52-week and no-spend weekends, each feeding a pot. */
function challengesCardHTML(now) {
  const cur = state.couple.currency;
  const rows = state.challenges.map(ch => {
    const s = challengeStatus(ch, now);
    const fund = state.funds.find(f => f.id === ch.fundId);
    return `<article class="card">
      <div class="spread"><div style="min-width:0"><h3>${esc(s.def.name)}</h3>
        <div class="small muted">Into ${esc(fund ? fund.name : "a deleted pot")} · ${s.doneCount}/${s.def.weeks} done · ${esc(money(s.saved, cur))} of ${esc(money(s.goal, cur))}</div></div>
        <button type="button" class="ghost" data-act="delete-challenge" data-id="${esc(ch.id)}" aria-label="Stop ${esc(s.def.name)}">${icon("trash")}</button></div>
      <div class="bar" style="margin:8px 0"><span style="width:${(s.doneCount / s.def.weeks) * 100}%"></span></div>
      ${s.finished ? '<span class="chip ok">✓ Challenge complete, well done you two</span>'
        : s.doneThisStep ? `<span class="chip ok">✓ Week ${s.step} done</span>`
        : `<button type="button" data-act="challenge-tick" data-id="${esc(ch.id)}" ${fund ? "" : "disabled"}>Week ${s.step}: put ${esc(money(s.amount, cur))} in</button>`}
    </article>`;
  }).join("");
  return `<div class="section-head"><div><h2>Saving challenges</h2><p class="muted small">A small game for two. Each tick adds the amount to a pot.</p></div>
      <button type="button" data-act="add-challenge" ${state.funds.length ? "" : "disabled title=\"Add a savings pot first\""}>+ Challenge</button></div>
    ${rows ? `<div class="grid">${rows}</div>` : `<div class="empty">${state.funds.length ? "Start a 52-week challenge or a run of no-spend weekends." : "Add a savings pot first, then start a challenge for it."}</div>`}`;
}

/** Real numbers from Mint on this device (read only). */
function mintCardHTML() {
  const cur = state.couple.currency;
  const books = readMintBooks(mintStorage());
  if (!books.length) {
    return `<section class="card"><h2>From Mint</h2>
      <p class="small">Use Mint on this phone for day-to-day spending and Together can pick up your real monthly numbers here. Nothing leaves the device.</p>
      <a class="btn" href="../mint/web.html" target="_blank" rel="noopener">Open Mint</a></section>`;
  }
  const chosenId = books.some(b => b.id === ui.mintBook) ? ui.mintBook : books[0].id;
  const summary = summarizeMintBook(books.find(b => b.id === chosenId).book, ui.now);
  const label = summary.months ? `average of the last ${summary.months} month${summary.months === 1 ? "" : "s"}${summary.partial ? " (this month so far)" : ""}` : "no transactions yet";
  return `<section class="card"><h2>From Mint</h2>
    ${books.length > 1 ? `<label class="field">Budget<select data-mint-book>${books.map(b => `<option value="${esc(b.id)}" ${b.id === chosenId ? "selected" : ""}>${esc((b.book.meta && b.book.meta.name) || "Budget")}</option>`).join("")}</select></label>` : ""}
    <p class="small muted">${esc(summary.name)}${summary.currency ? ` · ${esc(summary.currency)}` : ""} · ${esc(label)}</p>
    <div class="stats">
      <div class="stat"><b>${esc(money(summary.income, cur))}</b><span class="small muted">income / month</span></div>
      <div class="stat"><b>${esc(money(summary.spent, cur))}</b><span class="small muted">spending / month</span></div>
      <div class="stat"><b>${esc(money(summary.saved, cur))}</b><span class="small muted">saved / month</span></div>
    </div>
    ${summary.months ? `<div class="row" style="margin-top:10px">
      <button type="button" data-act="mint-spend" data-id="${esc(chosenId)}">Use spending for our freedom number</button>
      ${summary.saved > 0 ? `<button type="button" data-act="mint-saving" data-id="${esc(chosenId)}">Use saving as monthly investing</button>` : ""}</div>` : ""}
    <p class="small muted">Read from Mint in this browser only; Together never changes Mint. Amounts are in Mint's currency.</p></section>`;
}

/** Us tab: date nights against the monthly fun money. */
function dateNightsHTML() {
  const cur = state.couple.currency;
  const fun = funPlan(state, ui.now);
  const recent = state.dates.slice().sort(byDate).reverse().slice(0, 5);
  return `<section class="card">
    <div class="spread"><h2>Date nights</h2><button type="button" data-act="date-done">+ We went out</button></div>
    ${fun.budget ? `<p class="small">${esc(money(fun.spent, cur))} of ${esc(money(fun.budget, cur))} fun money used this month · <b>${esc(money(Math.max(0, fun.left), cur))}</b> left</p>
      <div class="bar" style="margin:6px 0"><span style="width:${clamp(fun.spent / fun.budget, 0, 1) * 100}%"></span></div>`
      : '<p class="small muted">Set a monthly fun-money amount on the Money tab to budget your dates.</p>'}
    <p class="small"><span class="muted">This week's idea:</span> ${esc(fun.idea.text)}${fun.idea.cost ? ` (~${esc(money(fun.idea.cost, cur))})` : ""}</p>
    ${recent.length ? `<ul class="clean small">${recent.map(d => `<li class="spread"><span>${esc(formatDate(d.date))} · ${esc(d.text)}${Number(d.cost) ? ` · ${esc(money(d.cost, cur))}` : ""}</span>
      <button type="button" class="ghost" data-act="delete-date" data-id="${esc(d.id)}" aria-label="Delete ${esc(d.text)}">${icon("close")}</button></li>`).join("")}</ul>` : ""}
  </section>`;
}
