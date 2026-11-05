/* ------------------------------------ money plans: debts, rates, habits */

/* ---- amounts: Rupiah-friendly parsing ("250rb", "1,5jt", "Rp 25.000", "25k") ---- */
/** Parse a typed amount into a number (NaN if it isn't one). Thousands separators and
 *  k / rb / ribu (×1,000) and jt / juta / m (×1,000,000) suffixes are understood. */
function parseTypedAmount(input) {
  let text = String(input ?? "").trim().toLowerCase().replace(/\s+/g, "");
  text = text.replace(/^(rp\.?|idr|usd|\$)/, "");
  let sign = 1;
  if (text.startsWith("-") || text.startsWith("−")) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  let multiplier = 1;
  const suffix = text.match(/(ribu|rb|k|juta|jt|m)$/);
  if (suffix) {
    multiplier = /^(ribu|rb|k)$/.test(suffix[1]) ? 1e3 : 1e6;
    text = text.slice(0, -suffix[1].length);
  }
  if (!/^[\d.,]+$/.test(text)) return NaN;
  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  if (hasDot && hasComma) {
    const decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    text = text.split(thousands).join("").replace(decimal, ".");
  } else if (hasDot || hasComma) {
    const separator = hasDot ? "." : ",";
    const groups = text.split(separator);
    const looksLikeThousands = !suffix && groups.length > 1 && groups.slice(1).every(g => g.length === 3);
    text = looksLikeThousands ? groups.join("") : groups.length === 2 ? groups.join(".") : NaN;
  }
  const value = Number(text);
  return Number.isFinite(value) ? sign * value * multiplier : NaN;
}

/* ---- partner split by income ---- */
/** Each partner's share of a shared target: 50/50, or by take-home income when the couple chose that. */
function partnerShares(state) {
  const r = state.retirement;
  const a = Math.max(0, Number(r.incomeA) || 0);
  const b = Math.max(0, Number(r.incomeB) || 0);
  if (r.splitMode === "income" && a + b > 0) return { a: a / (a + b), b: b / (a + b), byIncome: true };
  return { a: 0.5, b: 0.5, byIncome: false };
}
/** What each partner put in, counting "together" deposits half each. */
function perPartner(split) {
  return { a: split.a + split.both / 2, b: split.b + split.both / 2 };
}

/* ---- savings streak ---- */
const STREAK_MILESTONES = [4, 8, 12, 26, 52, 104];
/** Weeks in a row (Mon–Sun) in which you put at least this week's combined target into your pots.
 *  Past weeks are judged against today's target, so the count is a motivator, not an audit. */
function savingStreak(state, now) {
  const target = weeklyPlan(state, now).totalWeekly;
  if (!(target > 0)) return { weeks: 0, thisWeekDone: false, target: 0 };
  const savedBetween = (from, to) => (state.contributions || [])
    .filter(c => c.date >= toISO(from) && c.date <= toISO(to) && Number(c.amount) > 0)
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const weekEnd = start => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const thisWeek = startOfWeek(now);
  const thisWeekDone = savedBetween(thisWeek, weekEnd(thisWeek)) >= target - 0.5;
  let weeks = 0;
  let cursor = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7);
  while (weeks < 520 && savedBetween(cursor, weekEnd(cursor)) >= target - 0.5) {
    weeks += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }
  return { weeks: weeks + (thisWeekDone ? 1 : 0), thisWeekDone, target };
}

/* ---- saving challenges ---- */
const CHALLENGES = {
  "52week": {
    name: "52-week challenge",
    weeks: 52,
    blurb: "Week 1 put in one amount, week 2 twice that, up to 52 times in week 52: 1,378 times the amount in a year.",
    amount: (unit, step) => unit * step,
  },
  nospend: {
    name: "No-spend weekends",
    weeks: 8,
    blurb: "Eight weekends without spending on extras. Each one, move what you would have spent into the pot.",
    amount: unit => unit,
  },
};
/** Where a challenge is now: step = weeks since it started + 1 (capped at its length). */
function challengeStatus(challenge, now) {
  const def = CHALLENGES[challenge.kind] || CHALLENGES.nospend;
  const started = parseDate(challenge.started) || now;
  const step = clamp(Math.floor(daysBetween(startOfWeek(started), now) / 7) + 1, 1, def.weeks);
  const ticks = challenge.ticks || {};
  const doneCount = Object.keys(ticks).filter(key => ticks[key]).length;
  const unit = Number(challenge.unit) || 0;
  let saved = 0;
  for (const key of Object.keys(ticks)) {
    if (ticks[key]) saved += def.amount(unit, Number(key));
  }
  return {
    def, step, doneCount, saved,
    amount: def.amount(unit, step),
    doneThisStep: Boolean(ticks[step]),
    finished: doneCount >= def.weeks,
    goal: Array.from({ length: def.weeks }, (_, i) => def.amount(unit, i + 1)).reduce((sum, v) => sum + v, 0),
  };
}

/* ---- debt-free plan ---- */
/**
 * Month-by-month payoff: interest accrues (APR / 12), every debt gets its minimum, and the rest of the
 * budget (all minimums + extra) goes to one target at a time. Paid-off minimums roll into the next target.
 * Avalanche = highest interest first (least interest paid); snowball = smallest balance first (quick wins).
 */
function simulateDebts(debts, extraMonthly, method) {
  const list = (debts || [])
    .filter(d => Number(d.balance) > 0)
    .map(d => ({ id: d.id, balance: Number(d.balance), rate: (Number(d.rate) || 0) / 100 / 12, minimum: Math.max(0, Number(d.minimum) || 0) }));
  const budget = list.reduce((sum, d) => sum + d.minimum, 0) + Math.max(0, Number(extraMonthly) || 0);
  if (!list.length) return { months: 0, totalInterest: 0, payoff: {}, feasible: true, budget, order: [] };
  const order = list.slice()
    .sort(method === "snowball" ? (x, y) => x.balance - y.balance : (x, y) => y.rate - x.rate || x.balance - y.balance)
    .map(d => d.id);
  const byId = new Map(list.map(d => [d.id, d]));
  const payoff = {};
  let totalInterest = 0;
  for (let month = 1; month <= 600; month++) {
    for (const d of list) {
      if (d.balance > 0) {
        const interest = d.balance * d.rate;
        d.balance += interest;
        totalInterest += interest;
      }
    }
    let available = budget;
    for (const d of list) {
      if (d.balance > 0) {
        const pay = Math.min(d.minimum, d.balance, available);
        d.balance -= pay;
        available -= pay;
      }
    }
    for (const id of order) {
      const d = byId.get(id);
      if (d.balance > 0 && available > 0) {
        const pay = Math.min(available, d.balance);
        d.balance -= pay;
        available -= pay;
      }
    }
    for (const d of list) {
      if (d.balance <= 0.005 && !payoff[d.id]) {
        d.balance = 0;
        payoff[d.id] = month;
      }
    }
    if (list.every(d => d.balance <= 0)) return { months: month, totalInterest, payoff, feasible: true, budget, order };
  }
  return { months: null, totalInterest, payoff, feasible: false, budget, order };
}
function debtPlan(state, now) {
  const r = state.retirement;
  const method = r.debtMethod === "snowball" ? "snowball" : "avalanche";
  const chosen = simulateDebts(state.debts, r.debtExtra, method);
  const other = simulateDebts(state.debts, r.debtExtra, method === "snowball" ? "avalanche" : "snowball");
  const open = (state.debts || []).filter(d => Number(d.balance) > 0);
  return {
    ...chosen, method, other,
    count: open.length,
    total: open.reduce((sum, d) => sum + Number(d.balance), 0),
    date: chosen.months ? addMonths(now, chosen.months) : null,
  };
}

/* ---- savings rate → years to freedom ---- */
function realReturnPercent(r) {
  const nominal = (Number(r.rate) || 0) - (Number(r.fees) || 0);
  return ((1 + nominal / 100) / (1 + (Number(r.inflation) || 0) / 100) - 1) * 100;
}
/**
 * If you save `rate` of take-home pay and live on the rest, how long until investments cover that
 * spending? target = (income × (1 − rate) × 12) / withdrawal; saving = income × rate per month.
 */
function savingsRatePlan(state) {
  const r = state.retirement;
  const income = (Number(r.incomeA) || 0) + (Number(r.incomeB) || 0);
  if (!(income > 0)) return null;
  const withdrawal = (Number(r.withdrawal) || 4) / 100;
  const realRate = realReturnPercent(r);
  const invested = Number(r.saved) || 0;
  const potsMonthly = state.funds.reduce((sum, f) => sum + (Number(f.monthly) || 0), 0);
  const currentRate = clamp(((Number(r.monthly) || 0) + potsMonthly) / income, 0, 1);
  const yearsAt = rate => {
    const target = income * (1 - rate) * 12 / withdrawal;
    const months = monthsToFreedom(invested, income * rate, realRate, target);
    return months === null ? null : months / 12;
  };
  const rows = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(rate => ({ rate, years: yearsAt(rate) }));
  return { income, currentRate, currentYears: yearsAt(currentRate), rows, realRate };
}

/* ---- fun money & date nights ---- */
const DATE_IDEAS = [
  "Sunset walk and street food", "Cook a new recipe together", "Picnic in the park", "Board-game night at home",
  "Movie night with homemade snacks", "Visit a free museum or exhibition", "Morning run, then breakfast out",
  "Plan your next trip over coffee", "Karaoke night", "Try a café neither of you knows", "Stargazing with a blanket",
  "Bike ride somewhere new",
];
/** This month's fun budget, what dates cost so far, and this week's date idea. */
function funPlan(state, now) {
  const r = state.retirement;
  const budget = Math.max(0, Number(r.funMonthly) || 0);
  const month = toISO(now).slice(0, 7);
  const spent = (state.dates || []).filter(d => String(d.date).slice(0, 7) === month).reduce((sum, d) => sum + (Number(d.cost) || 0), 0);
  const left = budget - spent;
  const affordable = state.bucket.filter(item => !item.done && Number(item.cost) > 0 && (!budget || Number(item.cost) <= left));
  const week = isoWeekNumber(now);
  const idea = affordable.length
    ? { text: affordable[week % affordable.length].text, cost: Number(affordable[week % affordable.length].cost), bucketId: affordable[week % affordable.length].id }
    : { text: DATE_IDEAS[week % DATE_IDEAS.length], cost: 0, bucketId: "" };
  return { budget, spent, left, weekly: budget / WEEKS_PER_MONTH, idea };
}

/* ---- Mint (same site, same device): read its budget books, never write ---- */
const MINT_FREQ = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
/** Average monthly income / spending / saving from one Mint book, using Mint's own rules
 *  (income txns; savings & investing categories count as saved; everything else is spending). */
function summarizeMintBook(book, today) {
  const live = name => Object.values((book && book[name]) || {}).filter(record => record && !record._del);
  const currency = (book && book.meta && book.meta.currency) || "";
  const planned = live("incomes")
    .filter(inc => !inc.cur || inc.cur === currency)
    .reduce((sum, inc) => sum + (Number(inc.amount) || 0) * (MINT_FREQ[inc.freq] || 1), 0);
  const groupOf = {};
  for (const cat of live("categories")) groupOf[cat.id] = cat.group;
  const months = {};
  for (const t of live("txns")) {
    if (typeof t.date !== "string") continue;
    const key = t.date.slice(0, 7);
    const m = months[key] ||= { income: 0, spent: 0, saved: 0 };
    const amount = Math.abs(Number(t.amount) || 0);
    if (t.type === "income") m.income += amount;
    else if (groupOf[t.cat] === "savings" || groupOf[t.cat] === "invest") m.saved += amount;
    else m.spent += amount;
  }
  const current = toISO(today).slice(0, 7);
  let used = Object.keys(months).filter(key => key < current).sort().slice(-3);
  const partial = !used.length && months[current];
  if (partial) used = [current];
  if (!used.length) return { name: (book && book.meta && book.meta.name) || "Mint budget", currency, months: 0, income: planned, spent: 0, saved: 0, partial: false };
  const avg = field => used.reduce((sum, key) => sum + months[key][field], 0) / used.length;
  return {
    name: (book.meta && book.meta.name) || "Mint budget",
    currency, months: used.length, partial: Boolean(partial),
    income: Math.max(planned, avg("income")), spent: avg("spent"), saved: avg("saved"),
  };
}
/** Mint budgets saved in this browser (same site as Together). `storage` is injectable for tests. */
function readMintBooks(storage) {
  try {
    const list = JSON.parse(storage.getItem("mint.budget.books") || "[]");
    return (Array.isArray(list) ? list : [])
      .map(entry => {
        const book = JSON.parse(storage.getItem(`mint.budget.book.${entry && entry.id}`) || "null");
        return book ? { id: entry.id, book } : null;
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}
