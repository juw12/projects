/* --------------------------------------- views: kids' plans and trips */
const monthYear = date => date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
const pct = value => `${(Math.round(value * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

/** Stacked yearly bars: what you put in (bottom) and what it earned (top). */
function growthChartSVG(projection, cur) {
  const points = projection.series;
  const width = 320;
  const height = 150;
  const top = 18;
  const bottom = 22;
  const left = 4;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...points.map(p => p.value), projection.costThen || 0);
  const slot = (width - left * 2) / points.length;
  const barWidth = Math.max(2, Math.min(22, slot * 0.7));
  const y = value => top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const label = p => (p.age !== null && p.age >= 0 ? `age ${p.age}` : String(p.date.getFullYear()));
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const bars = points.map((p, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const putIn = Math.min(p.putIn, p.value);
    const growth = Math.max(0, p.value - putIn);
    return `<rect class="chart-put" x="${x.toFixed(1)}" y="${y(putIn).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(y(0) - y(putIn)).toFixed(1)}"/>
      ${growth > 0 ? `<rect class="chart-growth" x="${x.toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(y(putIn) - y(p.value)).toFixed(1)}"/>` : ""}
      ${labelAt.has(index) ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 6}" font-size="10" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}" fill="currentColor" opacity=".7">${esc(label(p))}</text>` : ""}`;
  }).join("");
  const goalLine = projection.costThen ? `<line x1="${left}" x2="${width - left}" y1="${y(projection.costThen).toFixed(1)}" y2="${y(projection.costThen).toFixed(1)}" class="chart-goal"/>
    <text x="${left}" y="${(y(projection.costThen) - 4).toFixed(1)}" font-size="10" fill="currentColor" opacity=".75">Goal ${esc(money(projection.costThen, cur))}</text>` : "";
  const summary = `Grows to ${money(projection.final, cur)} by ${monthYear(projection.date)}: ${money(projection.finalPutIn, cur)} put in and ${money(projection.final - projection.finalPutIn, cur)} growth.`;
  return `<svg class="growth-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(summary)}">${bars}${goalLine}</svg>
    <div class="chart-legend small muted"><span><i class="swatch put"></i>What you put in</span><span><i class="swatch growth"></i>Growth</span>${projection.costThen ? '<span><i class="swatch goal"></i>Goal</span>' : ""}</div>`;
}

function kidPlanCard(plan, now) {
  const cur = state.couple.currency;
  const product = KID_PRODUCTS[plan.product] || KID_PRODUCTS.custom;
  const p = projectKidPlan(plan, state, now);
  const title = `${p ? p.kid.name : "A child"}: ${plan.name || "Plan"}`;
  const tools = `<span style="white-space:nowrap"><button type="button" class="ghost" data-act="edit-kidplan" data-id="${esc(plan.id)}" aria-label="Edit ${esc(title)}">${icon("pencil")}</button><button type="button" class="ghost" data-act="delete-kidplan" data-id="${esc(plan.id)}" aria-label="Delete ${esc(title)}">${icon("trash")}</button></span>`;
  if (!p) {
    return `<article class="card"><div class="spread"><h3>${esc(title)}</h3>${tools}</div>
      <p class="small muted">This child was removed or has no birth date, so there's no target date. Edit the plan to pick a child.</p></article>`;
  }
  const tax = Number(plan.tax) || 0;
  const rateLine = `${esc(product.name)} · ${esc(pct(Number(plan.rate) || 0))} a year${tax ? `, ${esc(pct(p.netRate))} after ${esc(pct(tax))} tax` : ""}`;
  let verdict = "";
  if (p.months === 0) {
    verdict = '<span class="chip ok">The day is here. Time to use it.</span>';
  } else if (p.gap !== null) {
    if (p.gap <= 0) {
      verdict = `<span class="chip ok" style="white-space:normal">✓ On track: about ${esc(money(-p.gap, cur))} more than the goal</span>`;
    } else {
      const rateText = p.neededRate === null ? "" : ` or growth of about ${esc(pct(p.neededRate))} a year after tax`;
      verdict = `<span class="chip warn" style="white-space:normal">Short by about ${esc(money(p.gap, cur))}. Put in ${esc(money(p.neededMonthly, cur))}/month${rateText}.</span>`;
    }
  } else {
    verdict = '<span class="small muted">Add what it will cost (in today\'s money) to see if you\'re on track.</span>';
  }
  const real = kidRealGrowth(plan, state);
  let realLine;
  if (!real) realLine = '<p class="small muted">Check the account now and then and tap <b>Update balance</b>: the app then works out your real growth rate.</p>';
  else if (real.tooSoon) realLine = `<p class="small muted">Real growth shows once there's about two months of history (${real.days} days so far).</p>`;
  else {
    const diff = real.rate - p.netRate;
    realLine = `<p class="small">Real growth: <b>${esc(pct(real.rate))} a year</b> since ${esc(monthYear(real.since))}
      <span class="chip ${diff >= -0.25 ? "ok" : "warn"}">${diff >= -0.25 ? "at or above" : "below"} the plan's ${esc(pct(p.netRate))}</span></p>`;
  }
  const logs = kidPlanLogs(plan, state);
  const history = logs.length ? `<details class="small" style="margin-top:4px"><summary>History (${logs.length})</summary><ul class="clean">${logs.slice(-8).reverse().map(log => `<li class="spread">
      <span>${esc(formatDate(log.date))} · ${log.kind === "balance" ? "Balance checked" : esc(log.by === "a" || log.by === "b" ? ownerLabel(log.by) : "Together")}</span>
      <span>${log.kind === "balance" ? "" : Number(log.amount) < 0 ? "−" : "+"}${esc(money(Math.abs(Number(log.amount) || 0), cur))}
      <button type="button" class="ghost" data-act="delete-kidlog" data-id="${esc(log.id)}" aria-label="Remove this ${log.kind === "balance" ? "balance" : "deposit"}">${icon("close")}</button></span></li>`).join("")}</ul></details>` : "";
  const table = `<details class="small"><summary>Year by year</summary><div class="rate-table lines" role="table" aria-label="${esc(title)} year by year">
      <div role="row" class="rate-row kid-row head"><span role="columnheader">When</span><span role="columnheader">Put in</span><span role="columnheader">Growth</span><span role="columnheader">Value</span></div>
      ${p.series.map(point => `<div role="row" class="rate-row kid-row"><span role="cell">${esc(point.age !== null && point.age >= 0 ? `Age ${point.age}` : String(point.date.getFullYear()))}</span>
        <span role="cell">${esc(money(point.putIn, cur))}</span><span role="cell">${esc(money(point.growth, cur))}</span><span role="cell"><b>${esc(money(point.value, cur))}</b></span></div>`).join("")}
    </div></details>`;
  return `<article class="card kid-plan">
    <div class="spread"><div style="min-width:0"><h3>${esc(title)}</h3>
      <div class="small muted">${rateLine}</div>
      <div class="small muted">${esc(money(p.monthly, cur))}/month (about ${esc(money(p.weekly, cur))} a week) · needed ${esc(monthYear(p.date))}${p.months ? `, ${esc(relativeTime(toISO(p.date), now))}` : ""}</div></div>${tools}</div>
    <div class="stats" style="margin-top:8px">
      <div class="stat"><b>${esc(money(p.now.balance, cur))}</b><span class="small muted">${p.now.measured ? `now (checked ${esc(formatDate(p.now.asOf))})` : "put in so far"}</span></div>
      <div class="stat"><b>${esc(money(p.final, cur))}</b><span class="small muted">projected by then</span></div>
      ${p.costThen !== null ? `<div class="stat"><b>${esc(money(p.costThen, cur))}</b><span class="small muted">goal then (${esc(money(p.costToday, cur))} today + ${esc(pct(p.inflation))}/yr)</span></div>` : ""}
    </div>
    ${p.series.length > 1 ? growthChartSVG(p, cur) : ""}
    <div style="margin:6px 0">${verdict}</div>
    ${realLine}
    ${p.series.length > 1 ? table : ""}
    ${history}
    <form class="row" data-form="kid-deposit" data-id="${esc(plan.id)}" style="margin-top:10px;flex-wrap:nowrap">
      ${amountInput("amount", `Deposit into ${title}`, { style: "flex:1;min-width:0", placeholder: money(p.monthly, cur) })}
      ${contributorSelect(`Who is depositing into ${title}`)}<button type="submit">+ Deposit</button></form>
    <button type="button" class="ghost small" data-act="kid-balance" data-id="${esc(plan.id)}" style="margin-top:6px">Update balance</button>
  </article>`;
}

/** Money tab: investment / deposit plans per child, with growth and real growth. */
function kidsPlansHTML(now) {
  const kids = state.kids.filter(kid => parseDate(kid.birth));
  const cards = state.kidPlans.map(plan => kidPlanCard(plan, now)).join("");
  return `<div class="section-head"><div><h2>Kids' plans</h2><p class="muted small">Invest or save for each child's next step and watch it grow: what you put in, what it earns, and whether it's enough.</p></div>
      <button type="button" class="primary" data-act="add-kidplan" ${kids.length ? "" : 'disabled title="Add a child in Settings first"'}>+ Plan</button></div>
    ${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">${kids.length ? "Start a plan for school or university: pick a deposit, bonds or a fund, set a monthly amount and see how it grows." : "Add your children (or a due date) in Settings, then start a plan for each of them."}</div>`}
    <p class="small muted">Rates are steady averages you can edit, not quotes; funds and gold go up and down. Tax presets follow Indonesia's rules (20% on deposit interest, 10% on SBN coupons, none on fund gains). Not financial advice.</p>`;
}

function tripCard(trip, now) {
  const cur = state.couple.currency;
  const s = tripStatus(trip, state, now);
  const kind = TRIP_KINDS[trip.kind] || TRIP_KINDS.holiday;
  const dates = s.start ? `${formatDate(trip.date)} – ${formatDate(toISO(s.lastDay))}` : "Date not set";
  const tools = `<span style="white-space:nowrap"><button type="button" class="ghost" data-act="edit-trip" data-id="${esc(trip.id)}" aria-label="Edit ${esc(trip.name)}">${icon("pencil")}</button><button type="button" class="ghost" data-act="delete-trip" data-id="${esc(trip.id)}" aria-label="Delete ${esc(trip.name)}">${icon("trash")}</button></span>`;
  const showSpent = s.spent > 0 || s.phase === "during" || s.phase === "after";
  const lines = s.budget.lines.filter(line => line.amount > 0 || s.spentBy[line.id] > 0).map(line => {
    const unit = line.per === "trip" ? "" : ` <span class="muted">(${esc(money(line.unit, cur))} × ${line.qty} ${line.per === "night" ? "nights" : "days"})</span>`;
    const spent = s.spentBy[line.id];
    return `<div role="row" class="rate-row trip-row"><span role="cell">${esc(line.label)}${unit}</span><span role="cell">${esc(money(line.amount, cur))}</span>
      ${showSpent ? `<span role="cell" class="${spent > line.amount + 0.5 ? "over" : ""}">${esc(money(spent, cur))}</span>` : ""}</div>`;
  }).join("");
  const breakdown = `<div class="rate-table lines${showSpent ? " with-spent" : ""}" role="table" aria-label="${esc(trip.name)} budget">
      <div role="row" class="rate-row trip-row head"><span role="columnheader">Budget</span><span role="columnheader">Planned</span>${showSpent ? '<span role="columnheader">Spent</span>' : ""}</div>
      ${lines}
      ${s.budget.buffer > 0 ? `<div role="row" class="rate-row trip-row"><span role="cell">Buffer (${esc(pct(s.budget.bufferPct))})</span><span role="cell">${esc(money(s.budget.buffer, cur))}</span>${showSpent ? '<span role="cell"></span>' : ""}</div>` : ""}
      <div role="row" class="rate-row trip-row total"><span role="cell"><b>Total</b></span><span role="cell"><b>${esc(money(s.budget.total, cur))}</b></span>${showSpent ? `<span role="cell"><b>${esc(money(s.spent, cur))}</b></span>` : ""}</div>
    </div>`;
  let phaseBlock = "";
  if (s.phase === "before" || s.phase === "someday") {
    const progress = s.budget.total > 0 ? clamp(s.saved / s.budget.total, 0, 1) : 0;
    phaseBlock = s.fund
      ? `<p class="small" style="margin-bottom:4px">Saved <b>${esc(money(s.saved, cur))}</b> of ${esc(money(s.budget.total, cur))} in the <b>${esc(s.fund.name)}</b> pot</p>
        <div class="bar" role="progressbar" aria-label="${esc(trip.name)} saved" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}"><span style="width:${progress * 100}%"></span></div>
        ${s.ready ? '<p class="small"><span class="chip ok">✓ Fully saved. Enjoy it!</span></p>'
          : s.phase === "before" ? `<p class="small">Put away <b>${esc(money(s.neededMonthly, cur))}/month</b> (about ${esc(money(s.neededWeekly, cur))} a week) to be ready ${esc(relativeTime(trip.date, now))}. Add to the pot on Home or above.</p>`
          : '<p class="small muted">Set a date to get a monthly amount.</p>'}`
      : `<p class="small">${s.phase === "before" ? `About <b>${esc(money(s.neededMonthly, cur))}/month</b> until you go (${esc(relativeTime(trip.date, now))}).` : "Set a date to get a monthly amount."}</p>
        <button type="button" data-act="trip-pot" data-id="${esc(trip.id)}">Save for it in a pot</button>`;
  } else if (s.phase === "during") {
    phaseBlock = `<p class="small"><span class="chip">Day ${s.dayNumber} of ${s.budget.days}</span> <b>${esc(money(Math.max(0, s.left), cur))}</b> left:
      ${s.left > 0 ? `about <b>${esc(money(s.perDayLeft, cur))} a day</b> for the rest of the trip.` : '<span class="chip warn">over budget, so go easy for the rest of the trip</span>'}</p>`;
  } else {
    const diff = s.budget.total - s.spent;
    phaseBlock = s.spent > 0
      ? `<p class="small">${diff >= 0 ? `<span class="chip ok">Came in ${esc(money(diff, cur))} under budget</span>` : `<span class="chip warn">Went ${esc(money(-diff, cur))} over budget</span>`} Worth remembering for the next one.</p>`
      : '<p class="small muted">Log what you spent to see how it compared with the plan.</p>';
  }
  const recent = s.spends.slice().sort(byDate).reverse().slice(0, 6);
  const spendList = recent.length ? `<details class="small"><summary>Spending (${s.spends.length})</summary><ul class="clean">${recent.map(sp => `<li class="spread">
      <span>${esc(formatDate(sp.date))} · ${esc((TRIP_LINES.find(line => line.id === sp.cat) || TRIP_LINES[5]).label)}${sp.note ? ` · ${esc(sp.note)}` : ""}</span>
      <span>${esc(money(sp.amount, cur))}<button type="button" class="ghost" data-act="delete-tripspend" data-id="${esc(sp.id)}" aria-label="Remove this ${esc(money(sp.amount, cur))} expense">${icon("close")}</button></span></li>`).join("")}</ul></details>` : "";
  return `<article class="card trip">
    <div class="spread"><div style="min-width:0"><h3>${esc(trip.name)}</h3>
      <div class="small muted">${esc(kind.name)}${trip.destination ? ` · ${esc(trip.destination)}` : ""} · ${esc(dates)} · ${s.budget.nights} night${s.budget.nights === 1 ? "" : "s"}</div></div>${tools}</div>
    <div style="margin:8px 0">${phaseBlock}</div>
    ${breakdown}
    ${spendList}
    <form class="row trip-spend" data-form="trip-spend" data-id="${esc(trip.id)}" style="margin-top:10px">
      ${amountInput("amount", `Spent on ${trip.name}`, { style: "flex:1 1 7rem;min-width:0" })}
      <select name="cat" aria-label="What it was for" style="flex:1 1 8rem;width:auto;min-width:0">${TRIP_LINES.map(line => `<option value="${line.id}" ${line.id === "food" ? "selected" : ""}>${esc(line.label)}</option>`).join("")}</select>
      <button type="submit">+ Spent</button></form>
  </article>`;
}

/** Money tab: honeymoon and holiday plans. */
function tripsHTML(now) {
  const trips = state.trips.slice().sort((x, y) => {
    const done = t => (tripStatus(t, state, now).phase === "after" ? 1 : 0);
    return done(x) - done(y) || (x.date || "9999").localeCompare(y.date || "9999");
  });
  return `<div class="section-head"><div><h2>Trips &amp; honeymoon</h2><p class="muted small">Plan what it costs, save for it in a pot, then track spending while you're away.</p></div>
      <button type="button" class="primary" data-act="add-trip">+ Trip</button></div>
    ${trips.length ? `<div class="grid">${trips.map(trip => tripCard(trip, now)).join("")}</div>` : '<div class="empty">Plan your honeymoon or next holiday: flights, stay, food and fun, plus a buffer. Together works out what to save each month.</div>'}`;
}

/** Home card line for the kids' plans this week. */
function kidsWeekRowHTML(now) {
  const cur = state.couple.currency;
  const week = kidsWeek(state, now);
  if (!week.plans) return "";
  const done = week.added >= week.target - 0.5;
  return `<div class="focus-item" style="margin-top:8px"><span class="ico">${icon("target")}</span>
      <div style="flex:1;min-width:0"><span class="muted small">Kids' plans:</span> ${esc(money(week.added, cur))} of ${esc(money(week.target, cur))} this week</div>
      ${done ? '<span class="chip ok">✓ Done</span>' : '<button class="ghost small" type="button" data-act="tab" data-id="money">Add →</button>'}</div>`;
}
