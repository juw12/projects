/* -------------------------------------------------------------------- store */
function blankState() {
  return {
    schema: SCHEMA_VERSION,
    couple: { a: { name: "", birth: "" }, b: { name: "", birth: "" }, since: "", wedding: "", stage: "dating", currency: "$", retireAge: 65 },
    milestones: [], goals: [], funds: [],
    retirement: { saved: 0, monthly: 0, rate: 5, fees: 0.5, inflation: 2.5, spend: 0, withdrawal: 4, eduCost: 0, eduInflation: 5 },
    checkins: [], talks: {}, bucket: [], kids: [], networth: [],
    program: { started: "", done: {}, notes: {} },
    _deleted: {},
    updatedAt: null, lastBackupAt: null,
  };
}
/** Accepts any older or partial shape and returns a complete current-schema state. */
function migrate(raw) {
  const base = blankState();
  if (!raw || typeof raw !== "object") return base;
  if (!raw.schema && ("a" in raw || "b" in raw)) {
    // v0/v1 prototype: flat names, simple goals and funds
    base.couple.a.name = String(raw.a || "");
    base.couple.b.name = String(raw.b || "");
    base.couple.since = String(raw.since || "");
    base.milestones = (raw.milestones || []).map(m => ({ id: uid(), stage: "dating", title: String(m.title || ""), date: String(m.date || ""), done: false, notes: "" }));
    base.goals = (raw.goals || []).map(g => ({ id: uid(), title: String(g.title || ""), category: "love", owner: "both", due: "", steps: [], notes: "", done: !!g.done }));
    base.funds = (raw.funds || []).map(f => ({ id: uid(), name: String(f.name || ""), target: +f.target || 0, saved: +f.saved || 0, monthly: +f.monthly || 0, milestoneId: "" }));
    return base;
  }
  const merged = { ...base, ...raw, couple: { ...base.couple, ...(raw.couple || {}) }, retirement: { ...base.retirement, ...(raw.retirement || {}) } };
  merged.couple.a = { ...base.couple.a, ...(raw.couple?.a || {}) };
  merged.couple.b = { ...base.couple.b, ...(raw.couple?.b || {}) };
  for (const key of ["milestones", "goals", "funds", "checkins", "bucket", "kids", "networth"]) {
    merged[key] = Array.isArray(raw[key]) ? raw[key].filter(x => x && typeof x === "object") : [];
  }
  merged.goals.forEach(goal => {
    goal.steps = Array.isArray(goal.steps) ? goal.steps : [];
  });
  merged.talks = raw.talks && typeof raw.talks === "object" ? raw.talks : {};
  merged.program = { ...base.program, ...(raw.program || {}) };
  merged.program.done = { ...(merged.program.done || {}) };
  merged.program.notes = { ...(merged.program.notes || {}) };
  merged._deleted = raw._deleted && typeof raw._deleted === "object" ? { ...raw._deleted } : {};
  merged.schema = SCHEMA_VERSION;
  return merged;
}
function validateImport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "This file is not a Together backup.";
  if (data.app !== "together") return "This file is not a Together backup (missing app marker).";
  if (!data.state || typeof data.state !== "object") return "The backup has no plan data inside.";
  if (Number(data.state.schema) > SCHEMA_VERSION) return "This backup comes from a newer version of Together.";
  return null;
}

const store = {
  key: APP_KEY,
  persist: true,
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? migrate(JSON.parse(raw)) : blankState();
    } catch (error) {
      return blankState();
    }
  },
  save(nextState) {
    nextState.updatedAt = new Date().toISOString();
    if (!this.persist) return true;
    try {
      localStorage.setItem(this.key, JSON.stringify(nextState));
      return true;
    } catch (error) {
      toast("⚠️ Could not save — storage is full or blocked. Export a backup now.");
      return false;
    }
  },
  exportText(currentState) {
    return JSON.stringify({ app: "together", exportedAt: new Date().toISOString(), state: currentState }, null, 2);
  },
  importText(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { error: "That file is not valid JSON." };
    }
    if (data && data.app === "together" && data.format === "encrypted-v1") return { encrypted: data };
    const problem = validateImport(data);
    if (problem) return { error: problem };
    return { state: migrate(data.state) };
  },
};

