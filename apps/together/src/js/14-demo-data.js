/* ---------------------------------------------------------------- demo data */
function demoState() {
  const now = new Date();
  const s = blankState();
  s.couple = { a: { name: "Mia", birth: "1997-05-03" }, b: { name: "Leo", birth: "1995-09-21" }, since: "2022-02-14", wedding: "", stage: "dating", currency: "$", retireAge: 65 };
  s.milestones = buildTemplate(s.couple, now);
  s.milestones.unshift({ id: uid(), stage: "dating", title: "Moved in together 🏠", date: toISO(addMonths(now, -8)), done: true, notes: "" });
  Object.assign(s.milestones[1], { done: true, date: toISO(addMonths(now, -3)) });
  const wedding = s.milestones.find(m => m.title.startsWith("Wedding"));
  const home = s.milestones.find(m => m.title.startsWith("Buy our first home"));
  s.goals = [
    { id: uid(), title: "Debt-free before the wedding", category: "money", owner: "both", due: wedding.date, notes: "Start married life with a clean slate.", done: false,
      steps: [{ id: uid(), text: "List all debts together", done: true }, { id: uid(), text: "Agree a monthly budget", done: true }, { id: uid(), text: "Pay off Leo's car loan", done: false }] },
    { id: uid(), title: "Run a half marathon together", category: "health", owner: "both", due: toISO(addMonths(now, 9)), notes: "", done: false,
      steps: [{ id: uid(), text: "Sign up for a 10k", done: true }, { id: uid(), text: "Train 3×/week", done: false }] },
    { id: uid(), title: "Finish my master's degree", category: "career", owner: "a", due: toISO(addMonths(now, 14)), notes: "Leo covers dinners during exam weeks 💪", done: false,
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
  s.retirement = { ...s.retirement, spend: 45000, eduCost: 60000 };
  s.kids = [{ id: uid(), name: "Baby (due)", birth: toISO(addMonths(now, 30)) }];
  s.program = { started: toISO(new Date(now.getTime() - 15 * 864e5)), done: { 1: toISO(new Date(now.getTime() - 14 * 864e5)), 2: toISO(new Date(now.getTime() - 6 * 864e5)) }, notes: { 1: "Leo is more stressed about his dad's health than I knew." } };
  s.networth = [-6, -4, -2, 0].map((offset, i) => ({ id: uid(), date: toISO(addMonths(now, offset)), assets: 41000 + i * 3200, debts: 14000 - i * 1500 }));
  s.couple.since = toISO(new Date(2022, now.getMonth(), now.getDate() + 12));
  s.checkins = [3, 4, 3, 5, 4].map((score, i) => ({ id: uid(), date: toISO(addMonths(now, -6 + i)), ratingA: score, ratingB: Math.min(5, score + (i % 2)),
    appreciate: "", need: "", plan: "" }));
  s.checkins.push({ id: uid(), date: toISO(addMonths(now, -1)), ratingA: 4, ratingB: 5, appreciate: "You cooked every night during my deadline week.", need: "More walks without phones.", plan: "Sunday picnic at the lake" });
  s.talks = { values: { status: "agreed", note: "Honesty, family, adventure." }, money: { status: "talked", note: "" } };
  s.bucket = [{ id: uid(), text: "See the northern lights", done: false }, { id: uid(), text: "Road trip along the coast", done: true }, { id: uid(), text: "Dance at our 50th anniversary", done: false }];
  return s;
}

