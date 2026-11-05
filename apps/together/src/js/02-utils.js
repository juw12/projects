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

