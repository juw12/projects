/* ---------------------------------------------------------------- demo data */
function demoState() {
  const now = new Date();
  const s = blankState();
  s.couple = { a: { name: "Mia", birth: "1997-05-03" }, b: { name: "Leo", birth: "1995-09-21" }, since: "2022-02-14", wedding: "", stage: "dating", currency: "$", retireAge: 65 };
  s.milestones = buildTemplate(s.couple, now);
  s.milestones.unshift({ id: uid(), stage: "dating", title: "Moved in together", date: toISO(addMonths(now, -8)), done: true, notes: "" });
  Object.assign(s.milestones[1], { done: true, date: toISO(addMonths(now, -3)) });
  const wedding = s.milestones.find(m => m.title.startsWith("Wedding"));
  const home = s.milestones.find(m => m.title.startsWith("Buy our first home"));
  s.goals = [
    { id: uid(), title: "Debt-free before the wedding", category: "money", owner: "both", due: wedding.date, notes: "Start married life with a clean slate.", done: false,
      steps: [{ id: uid(), text: "List all debts together", done: true }, { id: uid(), text: "Agree a monthly budget", done: true }, { id: uid(), text: "Pay off Leo's car loan", done: false }] },
    { id: uid(), title: "Run a half marathon together", category: "health", owner: "both", due: toISO(addMonths(now, 9)), notes: "", done: false,
      steps: [{ id: uid(), text: "Sign up for a 10k", done: true }, { id: uid(), text: "Train 3×/week", done: false }] },
    { id: uid(), title: "Finish my master's degree", category: "career", owner: "a", due: toISO(addMonths(now, 14)), notes: "Leo covers dinners during exam weeks", done: false,
      steps: [{ id: uid(), text: "Submit thesis proposal", done: false }] },
    { id: uid(), title: "Learn 5 of Grandma's recipes", category: "family", owner: "b", due: "", notes: "", done: false, steps: [] },
  ];
  s.funds = [
    { id: uid(), name: "Emergency fund", target: 12000, saved: 7500, monthly: 400, milestoneId: "" },
    { id: uid(), name: "Wedding", target: 18000, saved: 6000, monthly: 350, milestoneId: wedding.id },
    { id: uid(), name: "Home deposit", target: 60000, saved: 9000, monthly: 900, milestoneId: home.id },
  ];
  s.retirement = { ...s.retirement, saved: 22000, monthly: 600, rate: 5 };
  s.lastBackupAt = new Date(now.getTime() - 10 * 864e5).toISOString();
  s.retirement = { ...s.retirement, spend: 45000, eduCost: 60000, incomeA: 4200, incomeB: 3300, splitMode: "income", debtExtra: 150, debtMethod: "avalanche", funMonthly: 250 };
  s.kids = [{ id: uid(), name: "Baby (due)", birth: toISO(addMonths(now, 30)) }];
  s.program = { started: toISO(new Date(now.getTime() - 15 * 864e5)), done: { 1: toISO(new Date(now.getTime() - 14 * 864e5)), 2: toISO(new Date(now.getTime() - 6 * 864e5)) }, notes: { 1: "Leo is more stressed about his dad's health than I knew." } };
  s.networth = [-6, -4, -2, 0].map((offset, i) => ({ id: uid(), date: toISO(addMonths(now, offset)), assets: 41000 + i * 3200, debts: 14000 - i * 1500 }));
  s.couple.since = toISO(new Date(2022, now.getMonth(), now.getDate() + 12));
  s.checkins = [3, 4, 3, 5, 4].map((score, i) => ({ id: uid(), date: toISO(addMonths(now, -6 + i)), ratingA: score, ratingB: Math.min(5, score + (i % 2)),
    appreciate: "", need: "", plan: "" }));
  s.checkins.push({ id: uid(), date: toISO(addMonths(now, -1)), ratingA: 4, ratingB: 5, appreciate: "You cooked every night during my deadline week.", need: "More walks without phones.", plan: "Sunday picnic at the lake" });
  s.talks = { values: { status: "agreed", note: "Honesty, family, adventure." }, money: { status: "talked", note: "" } };
  s.bucket = [{ id: uid(), text: "See the northern lights", done: false }, { id: uid(), text: "Road trip along the coast", done: true }, { id: uid(), text: "Dance at our 50th anniversary", done: false },
    { id: uid(), text: "Cooking class for two", done: false, cost: 90 }];
  s.funds.push({ id: uid(), name: "Northern lights trip", target: 5000, saved: 0, monthly: 150, milestoneId: "", bucketId: s.bucket[0].id });
  const [emergency, weddingPot, , trip] = s.funds;
  const daysAgo = days => toISO(new Date(now.getTime() - days * 864e5));
  s.contributions = [
    { id: uid(), fundId: weddingPot.id, amount: 200, by: "a", date: daysAgo(40) },
    { id: uid(), fundId: weddingPot.id, amount: 150, by: "b", date: daysAgo(38) },
    { id: uid(), fundId: trip.id, amount: 600, by: "both", date: daysAgo(30) },
    { id: uid(), fundId: trip.id, amount: 400, by: "b", date: daysAgo(12) },
    { id: uid(), fundId: emergency.id, amount: 50, by: "a", date: daysAgo(0) },
    { id: uid(), fundId: weddingPot.id, amount: 80, by: "b", date: daysAgo(0) },
    { id: uid(), fundId: emergency.id, amount: 120, by: "both", date: daysAgo(7) },
    { id: uid(), fundId: weddingPot.id, amount: 260, by: "a", date: daysAgo(8) },
    { id: uid(), fundId: trip.id, amount: 100, by: "b", date: daysAgo(9) },
  ];
  s.debts = [
    { id: uid(), name: "Leo's car loan", balance: 6400, rate: 7.5, minimum: 210 },
    { id: uid(), name: "Credit card", balance: 1800, rate: 22, minimum: 55 },
  ];
  s.challenges = [{ id: uid(), kind: "52week", fundId: trip.id, unit: 2, started: daysAgo(15), ticks: { 1: daysAgo(14), 2: daysAgo(7) } }];
  s.dates = [
    { id: uid(), date: daysAgo(3), text: "Picnic in the park", cost: 18 },
    { id: uid(), date: daysAgo(20), text: "Karaoke night", cost: 45 },
  ];
  // Kids' plan: University for the baby, in an index fund, with a balance checked 10 days ago.
  const baby = s.kids[0];
  const uni = { id: uid(), kidId: baby.id, name: "University", targetAge: 18, product: "index", rate: 9, tax: 0, cost: 60000, inflation: "",
    start: 1500, since: toISO(addMonths(now, -8)), monthly: 150 };
  s.kidPlans = [uni];
  s.kidLogs = [-7, -6, -5, -4, -3, -2, -1].map((offset, i) => ({ id: uid(), planId: uni.id, kind: "deposit", amount: 150, by: ["a", "b", "both"][i % 3], date: toISO(addMonths(now, offset)) }));
  s.kidLogs.push({ id: uid(), planId: uni.id, kind: "balance", amount: 2685, by: "", date: daysAgo(10) });
  // Honeymoon (saving in a pot tied to the roadmap) and a past weekend away with its spending.
  const honeymoonMilestone = s.milestones.find(m => m.title === "Honeymoon");
  const honeymoonDate = honeymoonMilestone && honeymoonMilestone.date ? honeymoonMilestone.date : toISO(addMonths(now, 14));
  const honeymoon = { id: uid(), name: "Honeymoon in Bali", kind: "honeymoon", destination: "Ubud and the Gili Islands", date: honeymoonDate, nights: 7,
    budget: { flights: 1400, stay: 160, food: 90, activities: 600, transport: 200, other: 300 }, buffer: 10, fundId: "", milestoneId: "" };
  const honeymoonPot = { id: uid(), name: "Honeymoon in Bali", target: Math.round(tripBudget(honeymoon).total), saved: 0, monthly: 250,
    milestoneId: honeymoonMilestone ? honeymoonMilestone.id : "" };
  honeymoon.fundId = honeymoonPot.id;
  honeymoon.milestoneId = honeymoonPot.milestoneId;
  s.funds.push(honeymoonPot);
  s.contributions.push(
    { id: uid(), fundId: honeymoonPot.id, amount: 500, by: "both", date: daysAgo(45) },
    { id: uid(), fundId: honeymoonPot.id, amount: 250, by: "a", date: daysAgo(15) },
  );
  const weekend = { id: uid(), name: "Weekend in the mountains", kind: "holiday", destination: "Lake cabin", date: toISO(addMonths(now, -2)), nights: 2,
    budget: { flights: 0, stay: 120, food: 60, activities: 80, transport: 70, other: 40 }, buffer: 10, fundId: "", milestoneId: "" };
  s.trips = [honeymoon, weekend];
  s.tripSpends = [["stay", 240], ["food", 205], ["activities", 65], ["transport", 82], ["other", 25]]
    .map(([cat, amount]) => ({ id: uid(), tripId: weekend.id, cat, amount, by: "both", date: weekend.date }));
  return s;
}

