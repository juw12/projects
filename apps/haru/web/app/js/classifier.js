// Screenshot sorter — JS port of ios ClipClassifier.swift / prototypes/tidy/tidy.py.
// All three read the same clip_lexicon.json; parity is checked against prototypes/tidy/expected.json.

const MAX_PATTERN_HITS = 3;

export class ClipClassifier {
  constructor(lexicon) {
    this.minScore = lexicon.min_score;
    this.wordsRule = lexicon.words_rule;
    this.rules = {};
    for (const [drawer, rule] of Object.entries(lexicon.drawers)) {
      this.rules[drawer] = {
        keywords: Object.entries(rule.keywords).map(([k, w]) => [k.toLowerCase(), w]),
        patterns: Object.entries(rule.patterns).map(([p, w]) => [new RegExp(p, "gimu"), w]),
      };
    }
  }

  static async load(url = "clip_lexicon.json") {
    const response = await fetch(url);
    return new ClipClassifier(await response.json());
  }

  scores(text) {
    const lowered = text.toLowerCase();
    const result = {};
    for (const [drawer, rule] of Object.entries(this.rules)) {
      let score = 0;
      for (const [keyword, weight] of rule.keywords) {
        if (lowered.includes(keyword)) score += weight;
      }
      for (const [pattern, weight] of rule.patterns) {
        pattern.lastIndex = 0;
        const hits = (text.match(pattern) || []).length;
        score += Math.min(hits, MAX_PATTERN_HITS) * weight;
      }
      result[drawer] = score;
    }

    // Short, digit-free, prose-like text → a fragment for the words drawer.
    const compact = [...text.replace(/\s/gu, "")];
    const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
    const rule = this.wordsRule;
    if (compact.length && compact.length <= rule.max_chars && lineCount <= rule.max_lines) {
      const digits = compact.filter((ch) => /\p{Nd}/u.test(ch)).length;
      if (digits / compact.length <= rule.max_digit_ratio) {
        result.words = (result.words || 0) + rule.bonus;
      }
    }
    return result;
  }

  classify(text) {
    const all = this.scores(text);
    let bestDrawer = null;
    let bestScore = -Infinity;
    for (const [drawer, score] of Object.entries(all)) {
      if (score > bestScore) {
        bestScore = score;
        bestDrawer = drawer;
      }
    }
    if (bestDrawer === null || bestScore < this.minScore) {
      return { drawer: "other", score: Math.max(0, ...Object.values(all)) };
    }
    return { drawer: bestDrawer, score: bestScore };
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EXPIRY_PATTERNS = [
  [/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/gi, ["y", "m", "d"]],
  [/(20\d{2})\s?[年년]\s?(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]?/gi, ["y", "m", "d"]],
  [/(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]/gi, ["m", "d"]],
  [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/gi, ["mon", "d"]],
];

/** Earliest upcoming date in a ticket/coupon ("11月14日", "2026.12.20", "Nov 14"), or null. */
export function findExpiry(text, today = new Date()) {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const currentYear = today.getFullYear();
  const found = [];
  for (const [pattern, fields] of EXPIRY_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const parts = {};
      fields.forEach((field, index) => {
        parts[field] = match[index + 1];
      });
      const month = parts.mon ? MONTHS.indexOf(parts.mon.slice(0, 3).toLowerCase()) + 1 : Number(parts.m);
      const day = Number(parts.d);
      if (!month || !day) continue;
      const explicitYear = parts.y ? Number(parts.y) : null;
      let date = new Date(explicitYear ?? currentYear, month - 1, day);
      if (date.getDate() !== day || date.getMonth() !== month - 1) continue;
      if (explicitYear === null && date < startOfToday) date = new Date(currentYear + 1, month - 1, day);
      if (date >= startOfToday) found.push(date);
    }
  }
  if (!found.length) return null;
  return new Date(Math.min(...found.map((d) => d.getTime())));
}

/** 64-bit difference hash of an image (as a hex string) for near-duplicate screenshots. */
export async function dHash(imageBitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      const j = i + 4;
      const left = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const right = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
      bits += left > right ? "1" : "0";
    }
  }
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a, b) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
