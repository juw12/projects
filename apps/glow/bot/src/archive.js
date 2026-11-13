// Mission history: the last finished jobs of a chat, newest first, so "/missions" can list them,
// show a report again and run one again. Plain JSON, kept in the chat's state.

export const ARCHIVE_KEEP = 20;
const REPORT_KEEP = 3500;
const GOAL_KEEP = 600;

const clip = (text, max) => {
  const value = String(text == null ? "" : text);
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
};

// entry = { kind, goal, report, status ("done" | "stopped" | "failed"), error?, at, by, scheduleId? }
export function archiveJob(archive, entry, keep = ARCHIVE_KEEP) {
  const list = Array.isArray(archive) ? archive.slice() : [];
  const seq = list.reduce((max, item) => Math.max(max, item.n || 0), 0) + 1;
  list.unshift({
    n: seq,
    kind: entry.kind || "lead",
    goal: clip(entry.goal, GOAL_KEEP),
    report: clip(entry.report, REPORT_KEEP),
    status: entry.status || "done",
    error: clip(entry.error || "", 400),
    at: entry.at || 0,
    by: entry.by || 0,
    scheduleId: entry.scheduleId || null,
  });
  return list.slice(0, keep);
}

// Find an entry by its number ("/missions 7"), or null.
export function findArchived(archive, n) {
  const wanted = Number(n);
  return (archive || []).find((item) => item.n === wanted) || null;
}

const STATUS_MARK = { done: "✅", stopped: "⏹", failed: "⚠️" };

// One line per entry for the "/missions" list: "#7 ✅ 13 Nov · plan a trip to Tokyo…"
export function archiveLines(archive, formatDate, limit = 10) {
  return (archive || []).slice(0, limit).map((item) => {
    const mark = STATUS_MARK[item.status] || "•";
    const when = formatDate ? formatDate(item.at) : "";
    const repeat = item.scheduleId ? " 🔁" : "";
    return `#${item.n} ${mark}${repeat} ${when ? when + " · " : ""}${clip(item.goal.replace(/\s+/g, " "), 70)}`;
  });
}
