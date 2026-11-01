/* Pips Phone Trail - import app times from a Screen Time / Digital Wellbeing screenshot.
 *
 * parseUsageText(text)  -> { apps: [{app, minutes}], pickups, total }
 *   Reads text copied from (or OCR'd from) iPhone Settings > Screen Time > See All App & Website
 *   Activity, or Android Digital Wellbeing. Durations like "1h 23m", "45m", "1 hr 5 min",
 *   "1 j 23 mnt", "1小时23分钟", "1小時23分鐘" are understood. An app name and its time may be on the
 *   same line or on two lines.
 * placeEntries(apps, options) -> [{app, hour, minutes}]
 *   Screen Time lists only daily totals per app, so "spread" mode spreads them over the day window
 *   (a guess the user can edit); "hour" mode puts everything in one hour (for a screenshot of a single
 *   hour bar).
 * No network, no DOM: tested in CI by tools/check-web.mjs.
 */
(function (global) {
  "use strict";

  const HOUR_UNITS = "hours|hour|hrs|hr|h|jam|j|小时|小時|时|時";
  const MINUTE_UNITS = "minutes|minute|mins|min|menit|mnt|m|分钟|分鐘|分";
  const SECOND_UNITS = "seconds|second|secs|sec|s|detik|dtk|秒";
  const PART = `(\\d+)\\s*(${HOUR_UNITS}|${MINUTE_UNITS}|${SECOND_UNITS})(?![a-z])`;
  // A whole duration: one or more parts, optionally preceded by "<" ("< 1m").
  const DURATION_AT_END = new RegExp(`(?:^|\\s|(?<=[^\\d\\s]))(<\\s*)?((?:${PART}\\s*){1,3})$`, "i");
  const PART_GLOBAL = new RegExp(PART, "gi");

  // Lines that are headings or labels, never app names.
  const NOISE = [
    "screen time", "daily average", "average", "total", "today", "yesterday", "this week", "last week",
    "most used", "show categories", "show apps", "show more", "see all", "app & website activity",
    "updated", "limits", "notifications", "first pickup", "pickups", "social", "productivity",
    "entertainment", "games", "education", "information & reading", "creativity", "utilities", "other",
    "durasi layar", "rata-rata", "harian", "paling sering", "hari ini", "kemarin", "pemberitahuan",
    "ambilan", "batas", "diperbarui", "tampilkan", "lihat semua",
    "屏幕使用时间", "螢幕使用時間", "每日平均", "平均", "总计", "總計", "今天", "昨天", "最常使用",
    "通知", "拿起", "限额", "限額", "显示", "顯示", "更新",
    "digital wellbeing", "screen time today", "unlocks", "dashboard",
  ];
  const PICKUP_WORDS = /(pickups?|unlocks?|ambilan|buka hp|拿起|解锁|解鎖)/i;
  const FIRST_WORDS = /(first|pertama|第一次|首次)/i;
  const TIME_OF_DAY = /\b\d{1,2}[:.]\d{2}\b/;
  const DATE_WORDS = new RegExp(
    "\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|" +
    "september|october|november|december|januari|februari|maret|mei|juni|juli|agustus|oktober|desember|" +
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|" +
    "senin|selasa|rabu|kamis|jumat|sabtu|minggu)\\b|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|星期|週[一二三四五六日]|周[一二三四五六日]|\\d{1,2}/\\d{1,2}",
    "i"
  );

  function normalize(text) {
    return String(text || "")
      .replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
      .replace(/[\u00A0\u2009\u202F]/g, " ")
      .replace(/\r/g, "")
      .replace(/(\d)\s*rn(?![a-z])/gi, "$1m")          // OCR often reads "m" as "rn"
      .replace(/[ \t]*[>›»|]+[ \t]*$/gm, "")            // chevrons at the end of a row
      .replace(/([\u3000-\u9fff\uff00-\uffef])[ \t]+(?=[\u3000-\u9fff\uff00-\uffef])/g, "$1")  // "小 時" -> "小時"
      .replace(/(^|\s)[TlI|]h(?=\s+\d+\s*m)/gm, (_, before) => before + "1h");  // OCR "Th 23m" -> "1h 23m"
  }

  function unitKind(unit) {
    const u = unit.toLowerCase();
    if (new RegExp(`^(${HOUR_UNITS})$`, "i").test(u)) return "h";
    if (new RegExp(`^(${MINUTE_UNITS})$`, "i").test(u)) return "m";
    return "s";
  }

  /** "1h 23m" -> 83; "< 1m" -> 1; "45s" -> 1; returns null when the text is not a duration. */
  function durationMinutes(text) {
    const match = normalize(text).trim().match(new RegExp(`^(<\\s*)?((?:${PART}\\s*){1,3})$`, "i"));
    if (!match) return null;
    return partsToMinutes(match[2], Boolean(match[1]));
  }

  function partsToMinutes(partsText, lessThan) {
    let seconds = 0;
    let parts = 0;
    for (const part of partsText.matchAll(PART_GLOBAL)) {
      const value = Number(part[1]);
      const kind = unitKind(part[2]);
      seconds += kind === "h" ? value * 3600 : kind === "m" ? value * 60 : value;
      parts++;
    }
    if (!parts) return null;
    if (lessThan) return 1;
    return Math.max(1, Math.round(seconds / 60));
  }

  function isNoise(name) {
    const lower = name.toLowerCase();
    if (!/[\p{L}]/u.test(name)) return true;
    // OCR junk from the bar chart ("士 =", "了 |"): mostly symbols, not a name
    const visible = name.replace(/\s/g, "");
    const letters = (visible.match(/[\p{L}\p{N}.]/gu) || []).length;
    if (/[=+*#_~^|]/.test(visible) || letters / visible.length < 0.6) return true;
    if (TIME_OF_DAY.test(name) || DATE_WORDS.test(name)) return true;
    return NOISE.some((word) => lower === word || lower.startsWith(word + " ") || lower.startsWith(word + ":"));
  }

  // App icons come out of OCR as junk in front of the name: "@", "0)", "()", "B ".
  const ICON_JUNK = /^(?:[^\p{L}\s]\S?|\S[^\p{L}\s]|\p{L})\s+(?=\S{2,})/u;

  function cleanName(raw) {
    let name = raw
      .replace(/^[^\p{L}\p{N}]+/u, "")       // icons OCR'd as "@", "©", "»" ...
      .replace(/[\s>›»|:·•.\-–—]+$/u, "")      // chevrons / separators at the end
      .replace(/\s{2,}/g, " ")
      .trim();
    for (let i = 0; i < 2 && ICON_JUNK.test(name); i++) {
      name = name.replace(ICON_JUNK, "").replace(/^[^\p{L}\p{N}]+/u, "");
    }
    return name.trim();
  }

  function parseUsageText(text) {
    const lines = normalize(text).split("\n").map((l) => l.trim()).filter(Boolean);
    const totals = new Map();
    let pickups = null;
    let total = null;
    let pendingName = null;
    let sawApp = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (PICKUP_WORDS.test(line) && !FIRST_WORDS.test(line)) {
        const sameLine = line.replace(TIME_OF_DAY, "").match(/(?:^|\s)(\d{1,4})(?:\s|$)/);
        const nextLine = lines[i + 1] && /^\d{1,4}$/.test(lines[i + 1]) ? lines[i + 1] : null;
        const value = sameLine ? sameLine[1] : nextLine;
        if (value !== null && value !== undefined && pickups === null) {
          pickups = Number(value);
          if (!sameLine) i++;
        }
        pendingName = null;
        continue;
      }

      const match = line.match(DURATION_AT_END);
      if (match) {
        const minutes = partsToMinutes(match[2], Boolean(match[1]));
        const namePart = cleanName(line.slice(0, match.index));
        let name = null;
        if (namePart && !isNoise(namePart)) {
          name = namePart;
        } else if (!namePart && pendingName) {
          name = pendingName;
        }
        if (name && minutes) {
          const key = name.toLowerCase();
          const prev = totals.get(key) || { app: name, minutes: 0 };
          prev.minutes += minutes;
          totals.set(key, prev);
          sawApp = true;
        } else if (!sawApp && total === null && minutes) {
          total = minutes;   // the big "4h 12m" at the top of the page
        }
        pendingName = null;
        continue;
      }

      const name = cleanName(line);
      pendingName = name && !isNoise(name) && name.length <= 40 ? name : null;
    }
    return { apps: [...totals.values()], pickups, total };
  }

  /**
   * Turn daily totals into hour entries.
   * options: {mode: "spread"|"hour", hour, startHour, endHour}
   */
  function placeEntries(apps, options) {
    const start = options.startHour;
    const end = options.endHour;
    if (options.mode === "hour") {
      return apps.map((a) => ({ app: a.app, hour: options.hour, minutes: Math.min(60, a.minutes) }));
    }
    // Cut each app into chunks of at most 30 minutes, interleave the apps (most used first) and lay the
    // chunks evenly over the window. Same input always gives the same day.
    const chunkLists = apps
      .slice()
      .sort((a, b) => b.minutes - a.minutes)
      .map((a) => {
        const pieces = Math.max(1, Math.ceil(a.minutes / 30));
        const base = Math.floor(a.minutes / pieces);
        let rest = a.minutes - base * pieces;
        return Array.from({ length: pieces }, () => {
          const extra = rest > 0 ? 1 : 0;
          rest -= extra;
          return { app: a.app, minutes: base + extra };
        });
      });
    const chunks = [];
    for (let round = 0; chunkLists.some((list) => list.length > round); round++) {
      for (const list of chunkLists) {
        if (list[round]) chunks.push(list[round]);
      }
    }
    const hours = Math.max(1, end - start);
    const merged = new Map();
    chunks.forEach((chunk, index) => {
      const hour = start + Math.min(hours - 1, Math.floor((index * hours) / chunks.length));
      const key = hour + "|" + chunk.app.toLowerCase();
      const prev = merged.get(key) || { app: chunk.app, hour, minutes: 0 };
      prev.minutes = Math.min(60, prev.minutes + chunk.minutes);
      merged.set(key, prev);
    });
    return [...merged.values()].sort((a, b) => a.hour - b.hour);
  }

  global.PipsImport = { parseUsageText, placeEntries, durationMinutes };
})(typeof window !== "undefined" ? window : globalThis);
