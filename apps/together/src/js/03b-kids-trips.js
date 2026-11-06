/* ------------------------------------------ kids' plans and trip budgets */

/* ---- kids' plans: an investment or deposit plan per child and goal ---- */
// Starting rates are editable illustrations, not quotes. Tax is on growth, using Indonesia's rules
// (pajak.go.id): 20% final tax on deposit interest, 10% on retail government bond (SBN) coupons,
// none on mutual-fund gains for individuals.
const KID_PRODUCTS = {
  deposit: { name: "Time deposit (deposito)", rate: 4, tax: 20 },
  mmf: { name: "Money-market fund (reksa dana pasar uang)", rate: 4.5, tax: 0 },
  sbn: { name: "Retail government bonds (SBN: ORI, SBR, ST)", rate: 6, tax: 10 },
  index: { name: "Equity index fund (reksa dana indeks saham)", rate: 9, tax: 0 },
  gold: { name: "Gold (emas)", rate: 5, tax: 0 },
  custom: { name: "Something else", rate: 5, tax: 0 },
};
const KID_GOALS = [
  { id: "primary", name: "Primary school (SD)", age: 6 },
  { id: "junior", name: "Junior high (SMP)", age: 12 },
  { id: "senior", name: "Senior high (SMA)", age: 15 },
  { id: "university", name: "University", age: 18 },
  { id: "start", name: "A head start in life", age: 21 },
];

/** Yearly growth after tax on that growth, in %. */
function kidPlanNetRate(plan) {
  const gross = Number(plan.rate) || 0;
  const tax = clamp(Number(plan.tax) || 0, 0, 100);
  return gross * (1 - tax / 100);
}
/** A plan's deposits and balance updates, oldest first. */
function kidPlanLogs(plan, state) {
  return (state.kidLogs || []).filter(log => log.planId === plan.id).slice().sort(byDate);
}
/** What's in the plan now. With a logged balance, that balance plus deposits made after it;
 *  without one, simply what was put in (growth isn't known until you check the account). */
function kidPlanBalance(plan, state) {
  const logs = kidPlanLogs(plan, state);
  const deposits = logs.filter(log => log.kind !== "balance");
  const putIn = (Number(plan.start) || 0) + deposits.reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const snapshots = logs.filter(log => log.kind === "balance");
  const last = snapshots[snapshots.length - 1];
  if (!last) return { balance: putIn, putIn, growth: 0, measured: false, asOf: null };
  const after = deposits.filter(log => log.date > last.date).reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const balance = (Number(last.amount) || 0) + after;
  return { balance, putIn, growth: balance - putIn, measured: true, asOf: last.date };
}
/** The date the money is needed: the child's birthday at the plan's target age. */
function kidPlanTargetDate(plan, state) {
  const kid = state.kids.find(k => k.id === plan.kidId);
  const birth = kid ? parseDate(kid.birth) : null;
  if (!birth) return null;
  const age = Math.max(0, Number(plan.targetAge) || 0);
  return { kid, date: new Date(birth.getFullYear() + age, birth.getMonth(), birth.getDate()) };
}
/** Net yearly rate (%) at which `present` plus `monthly` grows into `target` over `years`;
 *  0 if no growth is needed, null if even 40% a year wouldn't get there. */
function rateNeeded(present, monthly, target, years) {
  if (futureValue(present, monthly, 0, years) >= target) return 0;
  if (futureValue(present, monthly, 40, years) < target) return null;
  let low = 0;
  let high = 40;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (futureValue(present, monthly, mid, years) >= target) high = mid;
    else low = mid;
  }
  return high;
}
/** Projection to the target date: yearly points (what you put in vs growth), the cost then,
 *  and what closes any gap (more per month, or a higher rate). */
function projectKidPlan(plan, state, now) {
  const target = kidPlanTargetDate(plan, state);
  if (!target) return null;
  const months = Math.max(0, monthsBetween(now, target.date));
  const years = months / 12;
  const netRate = kidPlanNetRate(plan);
  const monthly = Math.max(0, Number(plan.monthly) || 0);
  const current = kidPlanBalance(plan, state);
  const series = [];
  for (let year = 0; year * 12 < months + 12; year += 1) {
    const m = Math.min(year * 12, months);
    const value = futureValue(current.balance, monthly, netRate, m / 12);
    const putIn = current.putIn + monthly * m;
    series.push({ month: m, date: addMonths(now, m), age: ageOn(target.kid.birth, addMonths(now, m)), value, putIn, growth: value - putIn });
    if (m === months) break;
  }
  const final = series[series.length - 1].value;
  const inflation = plan.inflation === "" || plan.inflation === undefined ? Number(state.retirement.eduInflation) || 0 : Number(plan.inflation) || 0;
  const costToday = Math.max(0, Number(plan.cost) || 0);
  const costThen = costToday > 0 ? costToday * Math.pow(1 + inflation / 100, years) : null;
  const gap = costThen !== null ? costThen - final : null;
  return {
    kid: target.kid, date: target.date, months, years, netRate, monthly, weekly: monthly * 12 / 52,
    now: current, series, final, finalPutIn: series[series.length - 1].putIn, inflation, costToday, costThen, gap,
    neededMonthly: costThen !== null && months > 0 ? requiredMonthlyForTarget(current.balance, costThen, netRate, years) : null,
    neededRate: costThen !== null && months > 0 ? rateNeeded(current.balance, monthly, costThen, years) : null,
  };
}
/** Money-weighted yearly return (%) of dated cash flows (negative = money in, positive = value now). */
function annualizedReturn(flows) {
  const dated = flows.filter(flow => flow.date instanceof Date && Number.isFinite(flow.amount) && flow.amount !== 0)
    .sort((x, y) => x.date - y.date);
  if (dated.length < 2 || !dated.some(f => f.amount < 0) || !dated.some(f => f.amount > 0)) return null;
  const t0 = dated[0].date;
  const yearsFrom = date => (date - t0) / (365.25 * 864e5);
  const npv = rate => dated.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, yearsFrom(flow.date)), 0);
  let low = -0.99;
  let high = 10;
  let npvLow = npv(low);
  if (npvLow * npv(high) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (value * npvLow > 0) {
      low = mid;
      npvLow = value;
    } else {
      high = mid;
    }
  }
  return ((low + high) / 2) * 100;
}
/** Real yearly growth from what you put in and the balances you logged; needs ~2 months of history. */
function kidRealGrowth(plan, state) {
  const logs = kidPlanLogs(plan, state);
  const snapshots = logs.filter(log => log.kind === "balance");
  const last = snapshots[snapshots.length - 1];
  if (!last) return null;
  const flows = [];
  const since = parseDate(plan.since);
  if (since && Number(plan.start) > 0) flows.push({ date: since, amount: -Number(plan.start) });
  for (const log of logs) {
    if (log.kind !== "balance" && log.date <= last.date && parseDate(log.date)) flows.push({ date: parseDate(log.date), amount: -(Number(log.amount) || 0) });
  }
  const end = parseDate(last.date);
  const first = flows.reduce((min, flow) => (!min || flow.date < min ? flow.date : min), null);
  if (!end || !first) return null;
  const days = daysBetween(first, end);
  if (days < 60) return { tooSoon: true, days, since: first };
  flows.push({ date: end, amount: Number(last.amount) || 0 });
  const rate = annualizedReturn(flows);
  return rate === null ? null : { rate, since: first, asOf: last.date, days };
}
/** Home card line: this week's combined kids' target and what went in. */
function kidsWeek(state, now) {
  const start = toISO(startOfWeek(now));
  const end = toISO(new Date(startOfWeek(now).getFullYear(), startOfWeek(now).getMonth(), startOfWeek(now).getDate() + 6));
  const plans = state.kidPlans.filter(plan => Number(plan.monthly) > 0);
  const target = plans.reduce((sum, plan) => sum + Number(plan.monthly) * 12 / 52, 0);
  const added = (state.kidLogs || []).filter(log => log.kind !== "balance" && log.date >= start && log.date <= end && Number(log.amount) > 0)
    .reduce((sum, log) => sum + Number(log.amount), 0);
  return { plans: plans.length, target, added };
}

/* ---- trips: honeymoon and holiday budgets, saving for them, spending on them ---- */
const TRIP_KINDS = {
  honeymoon: { name: "Honeymoon", nights: 7 },
  holiday: { name: "Holiday", nights: 4 },
  anniversary: { name: "Anniversary trip", nights: 3 },
  family: { name: "Family trip", nights: 5 },
};
const TRIP_LINES = [
  { id: "flights", label: "Flights & transfers", per: "trip" },
  { id: "stay", label: "Stay", per: "night" },
  { id: "food", label: "Food & drinks", per: "day" },
  { id: "activities", label: "Activities & tours", per: "trip" },
  { id: "transport", label: "Getting around", per: "trip" },
  { id: "other", label: "Shopping & gifts", per: "trip" },
];
/** Budget lines (per trip, per night or per day for both of you) plus a safety buffer. */
function tripBudget(trip) {
  const nights = Math.max(0, Math.round(Number(trip.nights) || 0));
  const days = nights + 1;
  const lines = TRIP_LINES.map(line => {
    const unit = Math.max(0, Number(trip.budget && trip.budget[line.id]) || 0);
    const qty = line.per === "night" ? nights : line.per === "day" ? days : 1;
    return { ...line, unit, qty, amount: unit * qty };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const bufferPct = clamp(Number(trip.buffer) || 0, 0, 100);
  const buffer = subtotal * bufferPct / 100;
  return { nights, days, lines, subtotal, bufferPct, buffer, total: subtotal + buffer };
}
/** Where a trip stands: saving before it, a daily allowance during it, the verdict after it. */
function tripStatus(trip, state, now) {
  const budget = tripBudget(trip);
  const start = parseDate(trip.date);
  const lastDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + budget.nights) : null;
  const today = startOfDay(now);
  const phase = !start ? "someday" : today < start ? "before" : today <= lastDay ? "during" : "after";
  const fund = trip.fundId ? state.funds.find(f => f.id === trip.fundId) : null;
  const saved = fund ? fundSaved(fund, state) : 0;
  const spends = (state.tripSpends || []).filter(s => s.tripId === trip.id);
  const spentBy = Object.fromEntries(TRIP_LINES.map(line => [line.id, 0]));
  for (const s of spends) spentBy[TRIP_LINES.some(line => line.id === s.cat) ? s.cat : "other"] += Number(s.amount) || 0;
  const spent = spends.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const toSave = Math.max(0, budget.total - saved);
  const monthsLeft = phase === "before" ? Math.max(0, monthsBetween(today, start)) : 0;
  const daysUntil = phase === "before" ? daysBetween(today, start) : 0;
  const neededMonthly = phase === "before" && toSave > 0 ? toSave / Math.max(1, monthsLeft) : 0;
  const dayNumber = phase === "during" ? daysBetween(start, today) + 1 : 0;
  const daysLeft = phase === "during" ? Math.max(1, budget.days - dayNumber + 1) : 0;
  const left = budget.total - spent;
  return {
    budget, start, lastDay, phase, fund, saved, ready: budget.total > 0 && saved >= budget.total - 0.5, toSave,
    monthsLeft, daysUntil, neededMonthly, neededWeekly: neededMonthly * 12 / 52,
    spends, spent, spentBy, left, dayNumber, daysLeft, perDayLeft: phase === "during" ? left / daysLeft : 0,
  };
}
