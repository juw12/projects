/* --------------------------------------------------------------- app state */
let state = blankState();
let ui = { tab: "home", goalFilter: "all", now: new Date(), installPrompt: null };
let undoSnapshot = null;
const TABS = [
  { id: "home", icon: "home", label: "Home" },
  { id: "roadmap", icon: "map", label: "Roadmap" },
  { id: "goals", icon: "target", label: "Goals" },
  { id: "money", icon: "wallet", label: "Money" },
  { id: "us", icon: "heart", label: "Us" },
  { id: "settings", icon: "sliders", label: "Settings" },
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
  return parts.length ? `Ages ${parts.join(" · ")}` : "";
}

/* ------------------------------------------------------------------ theme */
/** Appearance is a per-device preference (not part of the shared plan): "system" | "light" | "dark".
 *  The <head> applies it before first paint; this keeps it in sync afterwards. */
const THEME_KEY = "together.theme";
const THEME_OPTIONS = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];
function resolveTheme(preference, systemPrefersDark) {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark ? "dark" : "light";
}
const theme = {
  media: window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null,
  get preference() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEME_OPTIONS.some(option => option.id === saved) ? saved : "system";
    } catch (error) {
      return "system";
    }
  },
  apply() {
    const resolved = resolveTheme(this.preference, !!(this.media && this.media.matches));
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === "dark" ? "#1b1819" : "#ffffff";
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      const current = THEME_OPTIONS.find(option => option.id === this.preference);
      const next = THEME_OPTIONS[(THEME_OPTIONS.indexOf(current) + 1) % THEME_OPTIONS.length];
      toggle.innerHTML = icon(current.icon);
      toggle.setAttribute("aria-label", `Appearance: ${current.label}. Switch to ${next.label}`);
      toggle.title = `Appearance: ${current.label}`;
    }
  },
  set(preference) {
    try {
      if (preference === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, preference);
    } catch (error) {
      /* storage blocked: still apply for this session */
    }
    this.apply();
  },
  cycle() {
    const index = THEME_OPTIONS.findIndex(option => option.id === this.preference);
    this.set(THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].id);
  },
  init() {
    if (this.media) this.media.addEventListener("change", () => this.apply());
    this.apply();
  },
};
