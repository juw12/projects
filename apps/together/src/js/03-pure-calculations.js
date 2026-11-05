/* ----------------------------------------------------- pure calculations */
function ageOn(birthText, onDate) {
  const birth = parseDate(birthText);
  if (!birth || !onDate) return null;
  let age = onDate.getFullYear() - birth.getFullYear();
  const hadBirthday = onDate.getMonth() > birth.getMonth() ||
    (onDate.getMonth() === birth.getMonth() && onDate.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  return age;
}
function dateAtAge(birthText, age) {
  const birth = parseDate(birthText);
  return birth ? new Date(birth.getFullYear() + age, birth.getMonth(), birth.getDate()) : null;
}
function monthsToReach(target, saved, monthly) {
  const remaining = (Number(target) || 0) - (Number(saved) || 0);
  if (remaining <= 0) return 0;
  if (!(Number(monthly) > 0)) return Infinity;
  return Math.ceil(remaining / Number(monthly));
}
function requiredMonthly(target, saved, deadline, now) {
  const remaining = (Number(target) || 0) - (Number(saved) || 0);
  if (remaining <= 0) return 0;
  const months = monthsBetween(now, deadline);
  if (months <= 0) return remaining;
  return remaining / months;
}
/** Future value of a lump sum plus monthly deposits, compounded monthly. */
function futureValue(present, monthly, annualRatePercent, years) {
  const months = Math.max(0, Math.round(years * 12));
  const rate = (Number(annualRatePercent) || 0) / 100 / 12;
  if (rate === 0) return present + monthly * months;
  const growth = Math.pow(1 + rate, months);
  return present * growth + monthly * (growth - 1) / rate;
}
/** Monthly deposit needed to grow `present` into `target` over `years` at an annual rate (compounded monthly). */
function requiredMonthlyForTarget(present, target, annualRatePercent, years) {
  const months = Math.max(1, Math.round(years * 12));
  const rate = (Number(annualRatePercent) || 0) / 100 / 12;
  const grown = rate === 0 ? present : present * Math.pow(1 + rate, months);
  const gap = target - grown;
  if (gap <= 0) return 0;
  if (rate === 0) return gap / months;
  return gap * rate / (Math.pow(1 + rate, months) - 1);
}
/** Convert a future amount into today's purchasing power. */
function toTodaysMoney(amount, inflationPercent, years) {
  return amount / Math.pow(1 + (Number(inflationPercent) || 0) / 100, years);
}
function retirementPlan(state, now) {
  const r = state.retirement;
  const retireOn = retirementDate(state.couple);
  const years = retireOn ? Math.max(0, monthsBetween(now, retireOn) / 12) : 30;
  const netRate = (Number(r.rate) || 0) - (Number(r.fees) || 0);
  const projectedNominal = futureValue(Number(r.saved) || 0, Number(r.monthly) || 0, netRate, years);
  const projectedReal = toTodaysMoney(projectedNominal, r.inflation, years);
  const withdrawal = (Number(r.withdrawal) || 4) / 100;
  const targetReal = (Number(r.spend) || 0) > 0 ? Number(r.spend) / withdrawal : 0;
  const targetNominal = targetReal * Math.pow(1 + (Number(r.inflation) || 0) / 100, years);
  const neededMonthly = targetReal ? requiredMonthlyForTarget(Number(r.saved) || 0, targetNominal, netRate, years) : 0;
  return {
    retireOn, years, netRate, projectedNominal, projectedReal, targetReal, targetNominal, neededMonthly,
    incomeReal: projectedReal * withdrawal,
    onTrack: targetReal ? projectedReal / targetReal : null,
  };
}
function educationPlans(state, now) {
  const r = state.retirement;
  const netRate = (Number(r.rate) || 0) - (Number(r.fees) || 0);
  if (!(Number(r.eduCost) > 0)) return [];
  return state.kids.map(kid => {
    const birth = parseDate(kid.birth);
    if (!birth) return null;
    const start = new Date(birth.getFullYear() + 18, birth.getMonth(), birth.getDate());
    const years = Math.max(0, monthsBetween(now, start) / 12);
    const cost = Number(r.eduCost) * Math.pow(1 + (Number(r.eduInflation) || 0) / 100, years);
    return { kid, start, years, cost, monthly: years > 0 ? requiredMonthlyForTarget(0, cost, netRate, years) : cost };
  }).filter(Boolean);
}
function programProgress(program) {
  const doneCount = PROGRAM.filter((_, index) => program.done[index + 1]).length;
  const current = PROGRAM.findIndex((_, index) => !program.done[index + 1]);
  return { doneCount, currentWeek: current === -1 ? null : current + 1, finished: current === -1 };
}

function goalProgress(goal) {
  if (goal.done) return 1;
  const steps = goal.steps || [];
  if (!steps.length) return 0;
  return steps.filter(step => step.done).length / steps.length;
}

/* ----------------------------------------------- shared piggy bank (pots) */
function fundContributions(fund, state) {
  return (state.contributions || []).filter(c => c.fundId === fund.id);
}
/** Sum of every deposit logged with the + Add form (withdrawals are negative). */
function fundLogged(fund, state) {
  return fundContributions(fund, state).reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}
/** A pot's balance: its starting/adjusted amount plus every logged deposit (never below zero). */
function fundSaved(fund, state) {
  return Math.max(0, (Number(fund.saved) || 0) + fundLogged(fund, state));
}
function totalSaved(state) {
  return state.funds.reduce((sum, fund) => sum + fundSaved(fund, state), 0);
}
/** Logged deposits per partner ("both" = put in together). Only covers deposits made with the + Add form. */
function contributionSplit(contributions) {
  const split = { a: 0, b: 0, both: 0 };
  for (const c of contributions) {
    const who = c.by === "a" || c.by === "b" ? c.by : "both";
    split[who] += Number(c.amount) || 0;
  }
  return split;
}
function fundStatus(fund, state, now) {
  const saved = fundSaved(fund, state);
  const months = monthsToReach(fund.target, saved, fund.monthly);
  const reachDate = Number.isFinite(months) ? addMonths(now, months) : null;
  const milestone = state.milestones.find(item => item.id === fund.milestoneId);
  const deadline = milestone ? parseDate(milestone.date) : null;
  let needed = null;
  let onTrack = null;
  if (deadline) {
    needed = requiredMonthly(fund.target, saved, deadline, now);
    onTrack = months === 0 || (reachDate !== null && reachDate <= deadline);
  }
  return { saved, months, reachDate, milestone, deadline, needed, onTrack, progress: fund.target > 0 ? clamp(saved / fund.target, 0, 1) : 0 };
}

/* ---------------------------------------------------------- weekly plan */
const WEEKS_PER_MONTH = 52 / 12;
/** Monday 00:00 of the week containing `date`. */
function startOfWeek(date) {
  const day = startOfDay(date);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
}
/** ISO week number, used to rotate the weekly fun pick. */
function isoWeekNumber(date) {
  const thursday = startOfWeek(date);
  thursday.setDate(thursday.getDate() + 3);
  const firstThursday = startOfWeek(new Date(thursday.getFullYear(), 0, 4));
  firstThursday.setDate(firstThursday.getDate() + 3);
  return 1 + Math.round((thursday - firstThursday) / (7 * 864e5));
}
/**
 * This week's plan (Mon–Sun): how much goes into each pot, what is already in, the next goal step
 * and one fun thing from the bucket list. Weekly amount = monthly plan × 12 / 52; a pot that is behind
 * its milestone uses the amount it actually needs. Fully funded pots and pots without a plan are left out.
 */
function weeklyPlan(state, now) {
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const fromISO = toISO(weekStart);
  const toISODate = toISO(weekEnd);
  const shares = partnerShares(state);
  const pots = [];
  for (const fund of state.funds) {
    const status = fundStatus(fund, state, now);
    if (status.months === 0) continue;
    const monthly = Math.max(Number(fund.monthly) || 0, status.onTrack === false ? status.needed || 0 : 0);
    if (!(monthly > 0)) continue;
    const remaining = Math.max(0, (Number(fund.target) || 0) - status.saved);
    const weekly = Math.min(monthly / WEEKS_PER_MONTH, remaining);
    const thisWeek = fundContributions(fund, state).filter(c => c.date >= fromISO && c.date <= toISODate);
    const added = thisWeek.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const split = contributionSplit(thisWeek);
    pots.push({
      fund, weekly, daily: weekly / 7, added, split, done: added >= weekly - 0.5, behind: status.onTrack === false, status,
      targets: { a: weekly * shares.a, b: weekly * shares.b },
      byPartner: perPartner(split),
    });
  }
  let step = null;
  for (const goal of state.goals.slice().sort((x, y) => (x.due || "9999").localeCompare(y.due || "9999"))) {
    const next = !goal.done && (goal.steps || []).find(s => !s.done);
    if (next) {
      step = { goal, step: next };
      break;
    }
  }
  const dreams = state.bucket.filter(item => !item.done);
  const withPot = dreams.filter(item => state.funds.some(f => f.bucketId === item.id));
  const pool = withPot.length ? withPot : dreams;
  const fun = pool.length ? pool[isoWeekNumber(now) % pool.length] : null;
  return {
    weekStart, weekEnd, pots, step, fun, shares,
    funPot: fun ? state.funds.find(f => f.bucketId === fun.id) || null : null,
    daysLeft: daysBetween(now, weekEnd) + 1,
    totalWeekly: pots.reduce((sum, p) => sum + p.weekly, 0),
    totalAdded: pots.reduce((sum, p) => sum + Math.max(0, p.added), 0),
  };
}

/* ---------------------------------------------------- financial freedom */
/** Months until `balance` (growing at a real annual rate, plus `monthly` each month) reaches `target`;
 *  null if not within 100 years. `boost` adds `amount` per month from `fromMonth` on (e.g. after debts are paid). */
function monthsToFreedom(balance, monthly, realRatePercent, target, boost = null) {
  if (balance >= target) return 0;
  const rate = realRatePercent / 100 / 12;
  let value = balance;
  for (let month = 1; month <= 1200; month++) {
    const extra = boost && month > boost.fromMonth ? boost.amount : 0;
    value = value * (1 + rate) + monthly + extra;
    if (value >= target) return month;
  }
  return null;
}
/**
 * Financial freedom = long-term investments big enough that the safe withdrawal rate covers the yearly
 * spending you want: target = spend / withdrawal (in today's money). Uses the same assumptions as the
 * retirement planner; growth is the real return (after fees and inflation).
 */
function freedomPlan(state, now) {
  const r = state.retirement;
  const spend = Number(r.spend) || 0;
  const withdrawal = (Number(r.withdrawal) || 4) / 100;
  if (!(spend > 0)) return null;
  const target = spend / withdrawal;
  const realRate = realReturnPercent(r);
  const invested = Number(r.saved) || 0;
  const monthly = Number(r.monthly) || 0;
  const months = monthsToFreedom(invested, monthly, realRate, target);
  const date = months === null ? null : addMonths(now, months);
  const extraMonthly = monthly > 0 ? Math.ceil(monthly * 0.1) : 0;
  const monthsWithExtra = extraMonthly ? monthsToFreedom(invested, monthly + extraMonthly, realRate, target) : null;
  // Once debt-free, what you paid on debts each month can go to investing instead.
  const debts = debtPlan(state, now);
  let afterDebts = null;
  if (debts.count && debts.feasible && debts.months > 0 && months !== 0) {
    const monthsBoosted = monthsToFreedom(invested, monthly, realRate, target, { fromMonth: debts.months, amount: debts.budget });
    afterDebts = { debtFreeDate: debts.date, amount: debts.budget, months: monthsBoosted, date: monthsBoosted === null ? null : addMonths(now, monthsBoosted) };
  }
  return {
    target, invested, monthly, realRate, months, date, afterDebts,
    progress: clamp(invested / target, 0, 1),
    ageA: date ? ageOn(state.couple.a.birth, date) : null,
    ageB: date ? ageOn(state.couple.b.birth, date) : null,
    extraMonthly,
    soonerBy: months !== null && monthsWithExtra !== null ? months - monthsWithExtra : null,
  };
}
function currentStageIndex(state) {
  let index = STAGE_INDEX[state.couple.stage] ?? 0;
  for (const milestone of state.milestones) {
    if (milestone.done) index = Math.max(index, STAGE_INDEX[milestone.stage] ?? 0);
  }
  return index;
}
function nextMilestone(state, now) {
  const today = toISO(now);
  return state.milestones.filter(item => !item.done && item.date && item.date >= today).sort(byDate)[0] || null;
}
function retirementDate(couple) {
  const dates = [dateAtAge(couple.a.birth, couple.retireAge), dateAtAge(couple.b.birth, couple.retireAge)].filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(Number)));
}

/** Suggested lifelong roadmap, anchored on today and (if known) the wedding date. */
function buildTemplate(couple, now) {
  const stageIndex = STAGE_INDEX[couple.stage] ?? 0;
  const inMonths = n => addMonths(now, n);
  const weddingKnown = parseDate(couple.wedding);
  const wedding = weddingKnown || (stageIndex <= 0 ? inMonths(24) : stageIndex === 1 ? inMonths(12) : now);
  const fromWedding = n => addMonths(wedding, n);
  const retire = retirementDate(couple) || fromWedding(35 * 12);
  const items = [
    ["dating", "Meet each other's families", inMonths(3), "Visit, share a meal, listen to their stories."],
    ["dating", "Have the big money talk", inMonths(5), "Debts, income, savings, spending style. Use the Talk deck."],
    ["dating", "First trip together", inMonths(8), ""],
    ["engaged", "Get engaged", addMonths(wedding, -12), ""],
    ["engaged", "Pre-marriage course or counselling", addMonths(wedding, -6), "Many couples find this valuable before the wedding."],
    ["married", "Wedding day", wedding, ""],
    ["married", "Honeymoon", fromWedding(1), ""],
    ["married", "Emergency fund: 3–6 months of expenses", fromWedding(12), ""],
    ["home", "Buy our first home", fromWedding(30), ""],
    ["kids", "Wills, guardians & life insurance", fromWedding(34), "Do this before the first baby arrives."],
    ["kids", "Welcome our first child", fromWedding(36), ""],
    ["kids", "Welcome our second child", fromWedding(60), "Edit or delete — your family, your plan."],
    ["family", "First child starts school", fromWedding(36 + 72), ""],
    ["family", "10th wedding anniversary", fromWedding(120), "Plan something special, just the two of us."],
    ["growth", "Big adventure for two", fromWedding(180), ""],
    ["growth", "Health check-ups & fitness reset", fromWedding(210), ""],
    ["growth", "Talk about caring for our parents", fromWedding(228), "Who helps, how, and what it means for money and time. Ask them what they want."],
    ["nest", "Kids leave home", fromWedding(36 + 216), ""],
    ["nest", "Silver anniversary — 25 years", fromWedding(300), ""],
    ["nest", "Retirement check: pensions, when to claim, health cover", addMonths(retire, -24), "Two years out: confirm the numbers in Money → Retiring together."],
    ["retire", "Retire together", retire, `Both of you at least ${couple.retireAge}.`],
    ["retire", "Decide where we'll live as we age", addMonths(retire, 24), "Stay, downsize, or move closer to family? Think about stairs, transport and care nearby."],
    ["golden", "Wills, powers of attorney & wishes written down", addMonths(retire, 60), "Update wills and beneficiaries, choose who decides if you can't, and tell family where documents are. See the Legacy talk."],
    ["golden", "Golden anniversary — 50 years", fromWedding(600), ""],
    ["golden", "Write our family story for the grandkids", fromWedding(612), ""],
  ];
  const today = toISO(now);
  return items
    .filter(([stage, , date]) => STAGE_INDEX[stage] >= stageIndex && toISO(date) >= today)
    .map(([stage, title, date, notes]) => ({ id: uid(), stage, title, date: toISO(date), done: false, notes }));
}

/** Anniversaries and birthdays coming up within `withinDays`. */
function upcomingCelebrations(state, now, withinDays = 30) {
  const list = [];
  const consider = (text, label, isAnniversary) => {
    const origin = parseDate(text);
    if (!origin) return;
    let next = new Date(now.getFullYear(), origin.getMonth(), origin.getDate());
    if (startOfDay(next) < startOfDay(now)) next = new Date(now.getFullYear() + 1, origin.getMonth(), origin.getDate());
    const days = daysBetween(now, next);
    const years = next.getFullYear() - origin.getFullYear();
    if (days <= withinDays && years > 0) {
      list.push({ days, date: toISO(next), years, text: isAnniversary ? `${label} — ${years} year${years === 1 ? "" : "s"}` : `${label} turns ${years}` });
    }
  };
  const n = { a: state.couple.a.name || "Partner A", b: state.couple.b.name || "Partner B" };
  consider(state.couple.since, "Our together-anniversary", true);
  consider(state.couple.wedding, "Our wedding anniversary", true);
  consider(state.couple.a.birth, n.a, false);
  consider(state.couple.b.birth, n.b, false);
  for (const kid of state.kids) consider(kid.birth, kid.name, false);
  return list.sort((x, y) => x.days - y.days);
}
function icsEscape(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** Build an iCalendar file. events: { uid, title, date (YYYY-MM-DD), allDay, time "HH:MM", rrule, description } */
function buildICS(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Together//Couple Life Plan//EN", "CALSCALE:GREGORIAN"];
  for (const event of events) {
    const day = event.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${event.uid}@together.local`, `DTSTAMP:${stamp}`);
    if (event.allDay) {
      const next = toISO(new Date(parseDate(event.date).getTime() + 864e5)).replace(/-/g, "");
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`);
    } else {
      const time = (event.time || "19:00").replace(":", "") + "00";
      lines.push(`DTSTART:${day}T${time}`, "DURATION:PT30M");
    }
    if (event.rrule) lines.push(`RRULE:${event.rrule}`);
    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
/** Average connection score (1-5, both partners) per check-in, oldest first. */
function checkinTrend(checkins) {
  return checkins.slice().sort(byDate).map(c => ({ date: c.date, score: ((Number(c.ratingA) || 0) + (Number(c.ratingB) || 0)) / 2 }));
}

/** True when there is real data that has not been backed up in the last 30 days. */
function backupDue(state, now) {
  const hasData = state.milestones.length + state.goals.length + state.checkins.length > 0;
  if (!hasData) return false;
  if (!state.lastBackupAt) return true;
  return daysBetween(new Date(state.lastBackupAt), now) >= 30;
}

/** Short, prioritized "what should we do now" list for the home screen (max 5). */
function focusItems(state, now) {
  const items = [];
  const today = toISO(now);
  for (const party of upcomingCelebrations(state, now).slice(0, 1)) {
    items.push({ icon: "calendar", text: `${party.text} ${party.days === 0 ? "is today!" : `in ${party.days} day${party.days === 1 ? "" : "s"}`} — plan something special`, tab: "us" });
  }
  const overdue = state.milestones.filter(m => !m.done && m.date && m.date < today).sort(byDate);
  if (overdue.length) {
    const more = overdue.length > 1 ? ` (+${overdue.length - 1} more)` : "";
    items.push({ icon: "clock", text: `“${overdue[0].title}” was planned for ${formatDate(overdue[0].date, "month")} — tick it off or pick a new date${more}`, tab: "roadmap" });
  }
  const lastCheckin = state.checkins.slice().sort(byDate).pop();
  const sinceCheckin = lastCheckin ? daysBetween(parseDate(lastCheckin.date), now) : null;
  if (sinceCheckin === null || sinceCheckin >= 30) {
    items.push({ icon: "message", text: sinceCheckin === null ? "Do your first couple check-in (10 minutes)" : `Monthly check-in is due (last one ${sinceCheckin} days ago)`, act: "checkin" });
  }
  const behind = state.funds.map(fund => ({ fund, status: fundStatus(fund, state, now) })).filter(x => x.status.onTrack === false);
  if (behind.length === 1) {
    const { fund, status } = behind[0];
    items.push({ icon: "alert", text: `${fund.name} needs ${money(status.needed, state.couple.currency)}/month to be ready for ${status.milestone.title}`, tab: "money" });
  } else if (behind.length > 1) {
    items.push({ icon: "alert", text: `${behind.length} savings pots are behind schedule (${behind.map(x => x.fund.name).join(", ")})`, tab: "money" });
  }
  const upcoming = nextMilestone(state, now);
  if (upcoming && daysBetween(now, parseDate(upcoming.date)) <= 365) {
    items.push({ icon: "flag", text: `${upcoming.title} — ${relativeTime(upcoming.date, now)}`, tab: "roadmap" });
  }
  const openSteps = [];
  for (const goal of state.goals) {
    if (goal.done) continue;
    const step = (goal.steps || []).find(s => !s.done);
    if (step) openSteps.push({ goal, step });
  }
  openSteps.sort((x, y) => (x.goal.due || "9999").localeCompare(y.goal.due || "9999"));
  if (openSteps.length) {
    const { goal, step } = openSteps[0];
    items.push({ icon: "target", text: `Next step for “${goal.title}”: ${step.text}`, tab: "goals" });
  }
  if (backupDue(state, now)) {
    items.push({ icon: "download", text: state.lastBackupAt ? "It's been a month — export a fresh backup of your plan" : "Export your first backup (and share it with your partner)", tab: "settings" });
  }
  const program = state.program || { started: "", done: {} };
  if (program.started && !programProgress(program).finished) {
    const week = programProgress(program).currentWeek;
    items.push({ icon: "book", text: `Foundations week ${week}: ${PROGRAM[week - 1].title}`, tab: "us" });
  }
  const stageIdx = currentStageIndex(state);
  const talk = TALKS.find(t => STAGE_INDEX[t.stage] <= stageIdx + 1 && (state.talks[t.id]?.status || "todo") === "todo");
  if (talk) items.push({ icon: "message", text: `Talk about: ${talk.title}`, tab: "us" });
  return items.slice(0, 5);
}

