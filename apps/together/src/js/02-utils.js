/* -------------------------------------------------------------------- utils */
let idCounter = 0;
function uid() {
  idCounter += 1;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + idCounter.toString(36);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function parseDate(text) {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function toISO(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function addMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), lastDay));
  return result;
}
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 864e5);
}
function monthsBetween(from, to) {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}
function formatDate(text, style = "medium") {
  const date = parseDate(text);
  if (!date) return "No date";
  const options = style === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" };
  return date.toLocaleDateString(undefined, options);
}
function relativeTime(text, now) {
  const date = parseDate(text);
  if (!date) return "";
  const days = daysBetween(now, date);
  if (days === 0) return "today";
  const abs = Math.abs(days);
  let span;
  if (abs < 45) {
    span = `${abs} day${abs === 1 ? "" : "s"}`;
  } else {
    const months = Math.abs(days > 0 ? monthsBetween(now, date) : monthsBetween(date, now));
    const years = Math.floor(months / 12);
    const rest = months % 12;
    span = years ? `${years} yr${years === 1 ? "" : "s"}${rest ? ` ${rest} mo` : ""}` : `${rest} mo`;
  }
  return days > 0 ? `in ${span}` : `${span} ago`;
}
function money(amount, currency) {
  const rounded = Math.round(Number(amount) || 0);
  return `${currency}${rounded.toLocaleString()}`;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function byDate(a, b) {
  return (a.date || "9999").localeCompare(b.date || "9999");
}

/* ------------------------------------------------------------------ icons */
/** Line icons (24px grid, stroke = currentColor). Decorative: always aria-hidden. */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sync: '<path d="M20 11A8 8 0 0 0 5.6 6.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.4 4.6L20 16M20 20v-4h-4"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  message: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  logo: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
};
function icon(name, className = "i") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}
