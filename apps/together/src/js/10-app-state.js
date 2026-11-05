/* --------------------------------------------------------------- app state */
let state = blankState();
let ui = { tab: "home", goalFilter: "all", now: new Date(), installPrompt: null };
let undoSnapshot = null;
const TABS = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "roadmap", icon: "🗺️", label: "Roadmap" },
  { id: "goals", icon: "🎯", label: "Goals" },
  { id: "money", icon: "💰", label: "Money" },
  { id: "us", icon: "💞", label: "Us" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

let lastCommitted = JSON.stringify(blankState());
let sync = null;
let pendingRender = false;

/** Stamp changes for sync, save locally, then push to partner / refresh reminders. */
function persist() {
  stampChanges(JSON.parse(lastCommitted), state);
  lastCommitted = JSON.stringify(state);
  store.save(state);
  if (sync && sync.active) sync.schedulePush();
  reminders.schedule();
}
function commit(message) {
  persist();
  render();
  if (message) toast(message);
}
function commitWithUndo(message, mutate) {
  undoSnapshot = JSON.stringify(state);
  mutate();
  persist();
  render();
  toast(message, true);
}
/** Merge a plan received from the partner's device into this one. */
function applyRemotePlan(plan) {
  const merged = mergeStates(state, plan);
  const changed = planFingerprint(merged) !== planFingerprint(state);
  state = merged;
  lastCommitted = JSON.stringify(state);
  store.save(state);
  if (changed) {
    safeRender();
    reminders.schedule();
  }
}
/** Re-render unless the user is typing; then wait until they leave the field or close the dialog. */
function safeRender() {
  const active = document.activeElement;
  const typing = active && active.closest && active.closest("#view, dialog") && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.type !== "checkbox";
  if (typing || document.getElementById("dialog").open) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  render();
}
function names() {
  return { a: state.couple.a.name || "Partner A", b: state.couple.b.name || "Partner B" };
}
function ownerLabel(owner) {
  const n = names();
  return owner === "a" ? n.a : owner === "b" ? n.b : "Both of us";
}
function agesLine(dateText) {
  const date = parseDate(dateText);
  if (!date) return "";
  const n = names();
  const ageA = ageOn(state.couple.a.birth, date);
  const ageB = ageOn(state.couple.b.birth, date);
  const parts = [];
  if (ageA !== null) parts.push(`${esc(n.a)} ${ageA}`);
  if (ageB !== null) parts.push(`${esc(n.b)} ${ageB}`);
  for (const kid of state.kids) {
    const kidAge = ageOn(kid.birth, date);
    if (kidAge !== null && kidAge >= 0) parts.push(`${esc(kid.name)} ${kidAge}`);
  }
  return parts.length ? `🎂 ${parts.join(" · ")}` : "";
}

