// Scheduled missions: "/every mon,thu 08:00 research cheap flights to Tokyo".
//
// A schedule is plain JSON kept in the chat's state:
//   { id, days: [0..6] (0 = Sunday), hour, minute, goal, created, lastRun, runs, fails, lastResult, lastEnd, heldFor }
// Times are on the owner's clock (UTC+7, the same clock /daily uses). Everything here is pure:
// it parses, computes the next run and describes; the chat object decides when to start the job.

export const OWNER_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MAX_SCHEDULES = 5;
export const GOAL_MIN = 4;
export const GOAL_MAX = 600;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

// Day names in the four Glow languages (English, Indonesian, simplified and traditional Chinese).
const DAY_WORDS = new Map([
  ["sun", 0], ["sunday", 0], ["min", 0], ["minggu", 0], ["ahad", 0],
  ["mon", 1], ["monday", 1], ["sen", 1], ["senin", 1],
  ["tue", 2], ["tues", 2], ["tuesday", 2], ["sel", 2], ["selasa", 2],
  ["wed", 3], ["wednesday", 3], ["rab", 3], ["rabu", 3],
  ["thu", 4], ["thur", 4], ["thurs", 4], ["thursday", 4], ["kam", 4], ["kamis", 4],
  ["fri", 5], ["friday", 5], ["jum", 5], ["jumat", 5], ["jum'at", 5],
  ["sat", 6], ["saturday", 6], ["sab", 6], ["sabtu", 6],
]);
const GROUP_WORDS = new Map([
  ["daily", ALL_DAYS], ["everyday", ALL_DAYS], ["day", ALL_DAYS], ["days", ALL_DAYS],
  ["hari", ALL_DAYS], ["harian", ALL_DAYS], ["tiap", null], ["setiap", null], ["every", null], ["each", null],
  ["weekday", WEEKDAYS], ["weekdays", WEEKDAYS], ["workday", WEEKDAYS], ["workdays", WEEKDAYS],
  ["weekend", WEEKENDS], ["weekends", WEEKENDS], ["akhir", null], ["pekan", WEEKENDS],
  ["kerja", WEEKDAYS],
]);
const CHINESE_DAYS = { "日": 0, "天": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6 };

// "8", "08:30", "8.30", "8am", "8:15pm", "20:15", "8 pm" -> { hour, minute } or null.
export function parseClock(word, next) {
  const match = String(word || "").toLowerCase().match(/^(\d{1,2})(?:[:.h](\d{2}))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  let meridiem = match[3] || "";
  let used = 1;
  if (!meridiem && /^(am|pm)$/i.test(String(next || ""))) {
    meridiem = String(next).toLowerCase();
    used = 2;
  }
  if (!match[2] && !meridiem) return null; // a bare "8" is too easy to confuse with words like "8 flights"
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, used };
}

function chineseDays(word) {
  if (/^(每天|每日|天天)$/.test(word)) return ALL_DAYS;
  if (/^(工作日|平日)$/.test(word)) return WEEKDAYS;
  if (/^(周末|週末)$/.test(word)) return WEEKENDS;
  const days = [];
  for (const piece of word.split(/[,，、和]/)) {
    const match = piece.match(/^(?:每)?(?:周|週|星期|礼拜|禮拜)([日天一二三四五六])$/);
    if (!match) return null;
    days.push(CHINESE_DAYS[match[1]]);
  }
  return days.length ? days : null;
}

// One word (or a comma list like "mon,wed,fri" or a range "mon-fri") -> days, or null.
function dayWord(raw) {
  const word = raw.toLowerCase().replace(/[.,;]+$/, "");
  if (!word) return null;
  const chinese = chineseDays(word);
  if (chinese) return chinese;
  const range = word.match(/^([a-z']+)-([a-z']+)$/);
  if (range && DAY_WORDS.has(range[1]) && DAY_WORDS.has(range[2])) {
    const days = [];
    for (let day = DAY_WORDS.get(range[1]); ; day = (day + 1) % 7) {
      days.push(day);
      if (day === DAY_WORDS.get(range[2])) break;
    }
    return days;
  }
  const parts = word.split(",").filter(Boolean);
  if (parts.length > 1 && parts.every((part) => DAY_WORDS.has(part))) return parts.map((part) => DAY_WORDS.get(part));
  if (DAY_WORDS.has(word)) return [DAY_WORDS.get(word)];
  if (GROUP_WORDS.has(word)) return GROUP_WORDS.get(word) || [];
  return null;
}

// "/every" arguments -> { days, hour, minute, goal } or { error: "time" | "goal" }. No day words = every day.
// The when-part comes first, in any order of days and time: "mon,thu 08:00 <goal>",
// "8am weekdays <goal>", "daily 7:30 <goal>", "setiap senin 08:00 <goal>", "每周一 8:00 <goal>".
export function parseEvery(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const days = new Set();
  let clock = null;
  let index = 0;
  while (index < words.length) {
    // Once both the days and the time are known, the rest is the goal ("10:00 weekend deals").
    if (clock && days.size) break;
    const time = clock ? null : parseClock(words[index], words[index + 1]);
    if (time) {
      clock = time;
      index += time.used;
      continue;
    }
    const found = dayWord(words[index]);
    if (found === null) break;
    found.forEach((day) => days.add(day));
    index += 1;
  }
  const goal = words.slice(index).join(" ").trim();
  if (!clock) return { error: "time" };
  if (goal.length < GOAL_MIN) return { error: "goal" };
  return {
    days: days.size ? [...days].sort((a, b) => a - b) : ALL_DAYS.slice(),
    hour: clock.hour,
    minute: clock.minute,
    goal: goal.slice(0, GOAL_MAX),
  };
}

// The next time (UTC ms) this schedule should run, strictly after `after` and after its last run.
export function nextRunAt(schedule, after, offsetMs = OWNER_OFFSET_MS) {
  const from = Math.max(after, schedule.lastRun || 0);
  const local = from + offsetMs;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const start = dayStart + ahead * DAY_MS;
    const weekday = new Date(start).getUTCDay();
    if (!schedule.days.includes(weekday)) continue;
    const at = start + (schedule.hour * 60 + schedule.minute) * 60000 - offsetMs;
    if (at > from) return at;
  }
  return Infinity; // no days at all: never
}

// Which schedules are due at `now` (their next run after their last run has come).
export function dueSchedules(schedules, now, offsetMs = OWNER_OFFSET_MS) {
  return (schedules || []).filter((schedule) => {
    const base = schedule.lastRun || schedule.created || 0;
    return nextRunAt(schedule, base, offsetMs) <= now;
  });
}

// When this schedule's run is (or was) due: the first run time after its last run.
export function dueAt(schedule, offsetMs = OWNER_OFFSET_MS) {
  return nextRunAt(schedule, schedule.lastRun || schedule.created || 0, offsetMs);
}

// The earliest next run among all schedules (for the alarm), or null.
export function nextScheduleTime(schedules, now, offsetMs = OWNER_OFFSET_MS) {
  let best = Infinity;
  for (const schedule of schedules || []) {
    const base = schedule.lastRun || schedule.created || 0;
    best = Math.min(best, Math.max(now, nextRunAt(schedule, base, offsetMs)));
  }
  return best === Infinity ? null : best;
}

const DAY_NAMES = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  id: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
  "zh-Hans": ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  "zh-Hant": ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
};
const GROUP_NAMES = {
  en: { all: "every day", weekdays: "weekdays", weekends: "weekends" },
  id: { all: "setiap hari", weekdays: "hari kerja", weekends: "akhir pekan" },
  "zh-Hans": { all: "每天", weekdays: "工作日", weekends: "周末" },
  "zh-Hant": { all: "每天", weekdays: "工作日", weekends: "週末" },
};

const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// "Mon, Thu 08:00" / "every day 07:30" in the chat's language.
export function describeWhen(schedule, lang = "en") {
  const names = DAY_NAMES[lang] || DAY_NAMES.en;
  const groups = GROUP_NAMES[lang] || GROUP_NAMES.en;
  const days = [...schedule.days].sort((a, b) => a - b);
  let dayText;
  if (same(days, ALL_DAYS)) dayText = groups.all;
  else if (same(days, WEEKDAYS)) dayText = groups.weekdays;
  else if (same(days, WEEKENDS)) dayText = groups.weekends;
  else dayText = days.map((day) => names[day]).join(", ");
  const clock = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  return `${dayText} ${clock}`;
}

const MONTH_NAMES = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
};
const NEAR_DAYS = {
  en: { "-1": "yesterday", 0: "today", 1: "tomorrow" },
  id: { "-1": "kemarin", 0: "hari ini", 1: "besok" },
  "zh-Hans": { "-1": "昨天", 0: "今天", 1: "明天" },
  "zh-Hant": { "-1": "昨天", 0: "今天", 1: "明天" },
};

// "08:11" on the owner's clock.
export function clockAt(at, offsetMs = OWNER_OFFSET_MS) {
  return new Date(at + offsetMs).toISOString().slice(11, 16);
}

// One moment in the owner's words: "today 08:00", "tomorrow 07:30", "Mon 16 Nov 08:00".
export function describeAt(at, now, lang = "en", offsetMs = OWNER_OFFSET_MS) {
  if (!Number.isFinite(at)) return "";
  const clock = clockAt(at, offsetMs);
  const days = Math.floor((at + offsetMs) / DAY_MS) - Math.floor((now + offsetMs) / DAY_MS);
  const near = (NEAR_DAYS[lang] || NEAR_DAYS.en)[days];
  if (near) return `${near} ${clock}`;
  const date = new Date(at + offsetMs);
  const weekday = (DAY_NAMES[lang] || DAY_NAMES.en)[date.getUTCDay()];
  if (lang === "zh-Hans" || lang === "zh-Hant") return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${weekday} ${clock}`;
  const month = (MONTH_NAMES[lang] || MONTH_NAMES.en)[date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month} ${clock}`;
}

// A new schedule object, ready to store.
export function createSchedule(parsed, id, now) {
  return {
    id: String(id),
    days: parsed.days,
    hour: parsed.hour,
    minute: parsed.minute,
    goal: parsed.goal,
    created: now,
    lastRun: 0,
    runs: 0,
    fails: 0,
    lastResult: "", // how its last run ended: "done" | "failed" | "stopped"
    lastEnd: 0,
    heldFor: 0, // the due time of the run the owner was told is waiting
  };
}
