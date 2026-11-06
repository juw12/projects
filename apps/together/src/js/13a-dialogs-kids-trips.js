/* --------------------------------------- dialogs: kids' plans and trips */
const numberOr = (text, fallback) => (text === "" || text === undefined || text === null || !Number.isFinite(Number(text)) ? fallback : Number(text));
function rememberContributor(by) {
  try {
    localStorage.setItem(store.key + ME_KEY_SUFFIX, by);
  } catch (error) {
    /* storage blocked: the choice just isn't remembered */
  }
}

/** New/edit kids' plan. Leaving rate or tax empty uses the product's starting value. */
function kidPlanDialog(existing, preset = {}) {
  const kids = state.kids.filter(kid => parseDate(kid.birth));
  if (!kids.length) {
    toast("Add a child (or a due date) in Settings first.");
    return;
  }
  const cur = state.couple.currency;
  const p = existing || { kidId: kids[0].id, name: "University", targetAge: 18, product: "deposit", rate: "", tax: "", cost: "", inflation: "", start: "", since: toISO(new Date()), monthly: "", ...preset };
  const goal = KID_GOALS.find(g => g.name === p.name && g.age === Number(p.targetAge));
  const product = KID_PRODUCTS[p.product] ? p.product : "custom";
  openDialog(existing ? "Edit kids' plan" : "New kids' plan", `
    <div class="fields-2">
      <label class="field">For<select name="kidId">${kids.map(kid => `<option value="${esc(kid.id)}" ${kid.id === p.kidId ? "selected" : ""}>${esc(kid.name)}</option>`).join("")}</select></label>
      <label class="field">Saving for<select name="goal">${KID_GOALS.map(g => `<option value="${g.id}" ${goal && goal.id === g.id ? "selected" : ""}>${esc(g.name)} (age ${g.age})</option>`).join("")}
        <option value="custom" ${goal ? "" : "selected"}>Something else…</option></select></label>
      <label class="field">If something else: what?<input name="customName" value="${esc(goal ? "" : p.name)}" placeholder="e.g. Music school"></label>
      <label class="field">Needed at age<input name="customAge" type="number" min="0" max="40" value="${esc(goal ? "" : p.targetAge)}" placeholder="18"></label>
      <label class="field">What it costs, in today's money (${esc(cur)})${amountInput("cost", "Cost in today's money", { value: p.cost })}</label>
      <label class="field">Cost rises per year (%)<input name="inflation" type="number" step="0.1" value="${esc(p.inflation)}" placeholder="${esc(state.retirement.eduInflation)} (education inflation)"></label>
    </div>
    <label class="field">Where the money goes<select name="product">${Object.entries(KID_PRODUCTS).map(([id, item]) => `<option value="${id}" ${product === id ? "selected" : ""}>${esc(item.name)}: ~${item.rate}%${item.tax ? `, ${item.tax}% tax` : ""}</option>`).join("")}</select></label>
    <div class="fields-2">
      <label class="field">Growth per year, before tax (%)<input name="rate" type="number" step="0.01" min="0" max="40" value="${esc(p.rate)}" placeholder="Leave empty for the usual rate"></label>
      <label class="field">Tax on that growth (%)<input name="tax" type="number" step="1" min="0" max="100" value="${esc(p.tax)}" placeholder="Leave empty for the usual tax"></label>
      <label class="field">Already in it (${esc(cur)})${amountInput("start", "Amount already in the plan", { value: p.start })}</label>
      <label class="field">Since<input name="since" type="date" value="${esc(p.since)}"></label>
      <label class="field" style="grid-column:1/-1">We'll put in per month (${esc(cur)})${amountInput("monthly", "Monthly deposit", { value: p.monthly })}</label>
    </div>
    <p class="small muted">Check your bank's or fund's actual rate. Funds and gold move up and down; the plan uses a steady average.</p>`, values => {
    const chosenGoal = KID_GOALS.find(g => g.id === values.goal);
    const productId = KID_PRODUCTS[values.product] ? values.product : "custom";
    const fresh = KID_PRODUCTS[productId];
    const old = existing ? KID_PRODUCTS[existing.product] || KID_PRODUCTS.custom : null;
    // Switching product carries over a rate or tax only if the couple had changed it themselves.
    const keepOrPreset = (field, presetValue) => {
      const typed = numberOr(values[field], null);
      if (typed === null) return presetValue;
      if (old && existing.product !== productId && typed === old[field]) return presetValue;
      return typed;
    };
    const clean = {
      kidId: kids.some(kid => kid.id === values.kidId) ? values.kidId : kids[0].id,
      name: chosenGoal ? chosenGoal.name : (values.customName || "").trim() || "Plan",
      targetAge: chosenGoal ? chosenGoal.age : clamp(Math.round(numberOr(values.customAge, 18)), 0, 40),
      product: productId,
      rate: clamp(keepOrPreset("rate", fresh.rate), 0, 40),
      tax: clamp(keepOrPreset("tax", fresh.tax), 0, 100),
      cost: Math.max(0, parseTypedAmount(values.cost) || 0),
      inflation: values.inflation === "" ? "" : clamp(Number(values.inflation) || 0, 0, 30),
      start: Math.max(0, parseTypedAmount(values.start) || 0),
      since: parseDate(values.since) ? values.since : toISO(new Date()),
      monthly: Math.max(0, parseTypedAmount(values.monthly) || 0),
    };
    if (existing) Object.assign(existing, clean);
    else state.kidPlans.push({ id: uid(), ...clean });
    commit(existing ? "Plan updated" : "Plan added. The chart shows how it grows.");
  });
}
function kidBalanceDialog(plan) {
  const cur = state.couple.currency;
  const now = kidPlanBalance(plan, state);
  openDialog("Update balance", `
    <p class="small">Look up what's in the account or fund today (interest and growth included). Together compares it with what you put in to show your real growth rate.</p>
    <div class="fields-2">
      <label class="field">Balance now (${esc(cur)})${amountInput("amount", "Balance now", { value: Math.round(now.balance), required: true })}</label>
      <label class="field">Checked on<input name="date" type="date" value="${esc(toISO(new Date()))}"></label>
    </div>`, values => {
    const amount = parseTypedAmount(values.amount);
    if (!(amount >= 0)) {
      toast("Enter the balance as a number.");
      return;
    }
    state.kidLogs.push({ id: uid(), planId: plan.id, kind: "balance", amount, by: "", date: parseDate(values.date) ? values.date : toISO(new Date()) });
    const real = kidRealGrowth(plan, state);
    commit(real && !real.tooSoon ? `Balance saved. Real growth: ${pct(real.rate)} a year.` : "Balance saved.");
  });
}

/** Make a savings pot (and a roadmap milestone when dated) for a trip. */
function createTripPot(trip) {
  const status = tripStatus(trip, state, new Date());
  let milestone = null;
  if (trip.date) {
    milestone = trip.kind === "honeymoon" ? state.milestones.find(m => !m.done && m.title === "Honeymoon") : null;
    if (milestone) {
      milestone.date = trip.date;
    } else {
      milestone = { id: uid(), stage: trip.kind === "honeymoon" ? "married" : STAGES[currentStageIndex(state)].id, title: trip.name, date: trip.date, done: false, notes: "" };
      state.milestones.push(milestone);
    }
  }
  const fund = { id: uid(), name: trip.name, target: Math.round(status.budget.total), saved: 0, monthly: Math.ceil(status.neededMonthly), milestoneId: milestone ? milestone.id : "" };
  state.funds.push(fund);
  trip.fundId = fund.id;
  trip.milestoneId = milestone ? milestone.id : "";
  return fund;
}
/** Keep a trip's pot target and milestone date in step with its budget and date. */
function syncTripPot(trip) {
  const fund = trip.fundId ? findIn(state.funds, trip.fundId) : null;
  if (!fund) {
    trip.fundId = "";
    return;
  }
  fund.target = Math.round(tripBudget(trip).total);
  const milestone = fund.milestoneId ? findIn(state.milestones, fund.milestoneId) : null;
  if (milestone && trip.date && milestone.date !== trip.date) milestone.date = trip.date;
}
function tripDialog(existing) {
  const cur = state.couple.currency;
  const honeymoonFirst = !state.trips.some(t => t.kind === "honeymoon") && ["dating", "engaged", "married"].includes(state.couple.stage);
  const honeymoonMilestone = state.milestones.find(m => !m.done && m.title === "Honeymoon" && m.date);
  const kind = existing ? existing.kind : honeymoonFirst ? "honeymoon" : "holiday";
  const t = existing || { name: "", kind, destination: "", date: kind === "honeymoon" && honeymoonMilestone ? honeymoonMilestone.date : "",
    nights: TRIP_KINDS[kind].nights, budget: {}, buffer: 10 };
  const hint = { flights: "total for both", stay: "per night", food: "per day, both of you", activities: "total", transport: "total", other: "total" };
  openDialog(existing ? "Edit trip" : "Plan a trip", `
    <div class="fields-2">
      <label class="field">Trip<input name="name" required value="${esc(t.name)}" placeholder="e.g. Honeymoon in Bali"></label>
      <label class="field">Kind<select name="kind">${Object.entries(TRIP_KINDS).map(([id, k]) => `<option value="${id}" ${t.kind === id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}</select></label>
      <label class="field">Where<input name="destination" value="${esc(t.destination)}" placeholder="e.g. Ubud and Gili"></label>
      <label class="field">Leaving on<input name="date" type="date" value="${esc(t.date)}"></label>
      <label class="field">Nights<input name="nights" type="number" min="0" max="365" value="${esc(t.nights)}"></label>
      <label class="field">Buffer for surprises (%)<input name="buffer" type="number" min="0" max="100" step="1" value="${esc(t.buffer)}"></label>
    </div>
    <fieldset class="trip-budget"><legend class="small muted">Budget (${esc(cur)})</legend><div class="fields-2">
      ${TRIP_LINES.map(line => `<label class="field">${esc(line.label)} <span class="muted">(${hint[line.id]})</span>${amountInput(`b_${line.id}`, `${line.label}, ${hint[line.id]}`, { value: (t.budget && t.budget[line.id]) || "" })}</label>`).join("")}
    </div></fieldset>
    ${existing && existing.fundId && findIn(state.funds, existing.fundId) ? '<p class="small muted">Its savings pot target follows this budget.</p>'
      : '<label class="row small"><input type="checkbox" name="savePot" value="1" checked style="width:auto"> Save for it in a pot (adds it to the roadmap and your weekly targets)</label>'}`, values => {
    const kindId = TRIP_KINDS[values.kind] ? values.kind : "holiday";
    const clean = {
      name: (values.name || "").trim() || TRIP_KINDS[kindId].name,
      kind: kindId,
      destination: (values.destination || "").trim(),
      date: parseDate(values.date) ? values.date : "",
      nights: clamp(Math.round(Number(values.nights) || 0), 0, 365),
      budget: Object.fromEntries(TRIP_LINES.map(line => [line.id, Math.max(0, parseTypedAmount(values[`b_${line.id}`]) || 0)])),
      buffer: clamp(Number(values.buffer) || 0, 0, 100),
    };
    let trip = existing;
    if (trip) {
      Object.assign(trip, clean);
      syncTripPot(trip);
    } else {
      trip = { id: uid(), fundId: "", milestoneId: "", ...clean };
      state.trips.push(trip);
    }
    if (values.savePot && !(trip.fundId && findIn(state.funds, trip.fundId))) createTripPot(trip);
    const total = tripBudget(trip).total;
    commit(`${trip.name}: ${money(total, state.couple.currency)} planned${trip.fundId ? ", with a savings pot" : ""}.`);
  }, existing ? "Save" : "Plan it");
}

Object.assign(actions, {
  "add-kidplan": () => kidPlanDialog(null),
  "plan-kid": id => {
    const plan = educationPlans(state, new Date()).find(e => e.kid.id === id);
    kidPlanDialog(null, { kidId: id, cost: Number(state.retirement.eduCost) || "", monthly: plan ? Math.ceil(plan.monthly) : "" });
  },
  "edit-kidplan": id => {
    const plan = findIn(state.kidPlans, id);
    if (plan) kidPlanDialog(plan);
  },
  "delete-kidplan": id => {
    const plan = findIn(state.kidPlans, id);
    if (!plan) return;
    commitWithUndo(`${plan.name} plan deleted`, () => {
      state.kidPlans = state.kidPlans.filter(p => p.id !== id);
      state.kidLogs = state.kidLogs.filter(log => log.planId !== id);
    });
  },
  "kid-balance": id => {
    const plan = findIn(state.kidPlans, id);
    if (plan) kidBalanceDialog(plan);
  },
  "delete-kidlog": id => removeFrom("kidLogs", id, "Entry"),
  "add-trip": () => tripDialog(null),
  "edit-trip": id => {
    const trip = findIn(state.trips, id);
    if (trip) tripDialog(trip);
  },
  "delete-trip": id => {
    const trip = findIn(state.trips, id);
    if (!trip) return;
    const keepsPot = trip.fundId && findIn(state.funds, trip.fundId);
    commitWithUndo(`${trip.name} deleted${keepsPot ? " (its savings pot stays)" : ""}`, () => {
      state.trips = state.trips.filter(t => t.id !== id);
      state.tripSpends = state.tripSpends.filter(s => s.tripId !== id);
    });
  },
  "trip-pot": id => {
    const trip = findIn(state.trips, id);
    if (!trip) return;
    const fund = createTripPot(trip);
    commit(`Savings pot "${fund.name}" added: ${money(fund.monthly, state.couple.currency)}/month.`);
  },
  "delete-tripspend": id => removeFrom("tripSpends", id, "Expense"),
});

Object.assign(forms, {
  "kid-deposit": (values, form) => {
    const plan = findIn(state.kidPlans, form.dataset.id);
    const amount = parseTypedAmount(values.amount);
    if (!plan || !amount || !Number.isFinite(amount)) return;
    const by = ["a", "b", "both"].includes(values.by) ? values.by : "both";
    rememberContributor(by);
    state.kidLogs.push({ id: uid(), planId: plan.id, kind: "deposit", amount, by, date: toISO(new Date()) });
    const kid = state.kids.find(k => k.id === plan.kidId);
    commit(`${money(Math.abs(amount), state.couple.currency)} ${amount > 0 ? "into" : "out of"} ${kid ? `${kid.name}'s ` : ""}${plan.name}`);
  },
  "trip-spend": (values, form) => {
    const trip = findIn(state.trips, form.dataset.id);
    const amount = parseTypedAmount(values.amount);
    if (!trip || !(amount > 0)) return;
    const cat = TRIP_LINES.some(line => line.id === values.cat) ? values.cat : "other";
    state.tripSpends.push({ id: uid(), tripId: trip.id, cat, amount, by: lastContributor(), date: toISO(new Date()) });
    const s = tripStatus(trip, state, new Date());
    const cur = state.couple.currency;
    commit(s.phase === "during" && s.left > 0
      ? `Logged. ${money(s.left, cur)} left: about ${money(s.perDayLeft, cur)} a day.`
      : s.left < 0 ? `Logged. That's ${money(-s.left, cur)} over the trip budget.` : `Logged. ${money(s.left, cur)} of the budget left.`);
  },
});
