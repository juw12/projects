/* ------------------------------------------------------------- language */
// The interface language is a per-device choice: "auto" (follow the phone), "en" or "id".
// Translation runs on the rendered DOM, so views stay plain English templates:
//  - each text block (an element's own text, with inline children such as <b> written as {0}, {1}…)
//    is looked up in a dictionary of English → Indonesian;
//  - numbers, money and dates become {#} and the couple's own words (names, pots, goals…) become {@},
//    so one entry covers "$92 this week" and "Rp 250.000 this week";
//  - attributes people hear or see (placeholder, aria-label, title) are translated the same way.
// In Indonesian mode anything without a translation is collected in i18n.missing (the self-test
// fails on it), so new English text can't slip through unnoticed.
const LANG_KEY = "together.lang";
const LANG_OPTIONS = [
  { id: "auto", label: "Automatic (phone language)" },
  { id: "en", label: "English" },
  { id: "id", label: "Bahasa Indonesia" },
];
/** English → Indonesian. Filled by the dictionary files that follow. */
const I18N = { id: {} };
const I18N_INLINE = new Set(["B", "STRONG", "I", "EM", "SPAN", "A", "SMALL", "BR", "CODE", "ABBR", "TIME", "KBD", "MARK", "SUP", "SUB", "U"]);
const I18N_SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE", "INPUT"]);
const I18N_ATTRS = ["placeholder", "aria-label", "title", "alt"];
const I18N_MONTHS = "Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Agt|Aug|Sep|Okt|Oct|Nov|Des|Dec";
const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const i18n = {
  missing: new Set(),
  produced: new Set(),
  override: null,
  get preference() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return LANG_OPTIONS.some(option => option.id === saved) ? saved : "auto";
    } catch (error) {
      return "auto";
    }
  },
  get lang() {
    if (this.override) return this.override;
    const fromUrl = params.get("lang");
    if (fromUrl === "en" || fromUrl === "id") return fromUrl;
    if (params.has("selftest")) return "en";
    const preference = this.preference;
    if (preference === "en" || preference === "id") return preference;
    const phone = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return /^(id|in)\b/i.test(phone) ? "id" : "en";
  },
  /** Locale for dates and decimals (undefined = the phone's own). */
  get locale() {
    return this.lang === "id" ? "id-ID" : undefined;
  },
  set(preference) {
    try {
      if (preference === "auto") localStorage.removeItem(LANG_KEY);
      else localStorage.setItem(LANG_KEY, preference);
    } catch (error) {
      /* storage blocked: applies for this session only */
    }
    document.documentElement.lang = this.lang;
  },

  /** Prepare the per-render lookup context: the couple's own words and the number pattern. */
  prepare() {
    const s = typeof state === "object" && state ? state : blankState();
    const words = [s.couple.a.name, s.couple.b.name,
      ...s.kids.map(k => k.name), ...s.funds.map(f => f.name), ...s.debts.map(d => d.name),
      ...s.goals.flatMap(g => [g.title, g.notes, ...(g.steps || []).map(step => step.text)]),
      ...s.milestones.flatMap(m => [m.title, m.notes]), ...s.bucket.map(b => b.text), ...s.dates.map(d => d.text),
      ...s.trips.flatMap(t => [t.name, t.destination]), ...s.kidPlans.map(p => p.name), ...s.tripSpends.map(x => x.note),
      ...s.checkins.flatMap(c => [c.appreciate, c.need, c.plan]),
      ...Object.values(s.talks || {}).map(t => t && t.note), ...Object.values((s.program && s.program.notes) || {})];
    const unique = [...new Set(words.filter(w => typeof w === "string" && w.trim().length >= 2).map(w => w.trim()))]
      .sort((x, y) => y.length - x.length);
    this.wordPattern = unique.length
      ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${unique.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "gu")
      : null;
    const currency = String(s.couple.currency || "").trim();
    const prefix = `(?:${currency && !/^\d/.test(currency) ? `${escapeRegExp(currency)}\\s?|` : ""}Rp\\s?)?`;
    this.numberPattern = new RegExp("(?<!\\{)(?:" + [
      `\\d{1,2} (?:${I18N_MONTHS})\\.?(?: \\d{4})?(?![\\p{L}])`,
      `(?:${I18N_MONTHS})\\.? \\d{1,2}, \\d{4}`,
      `(?:${I18N_MONTHS})\\.? \\d{4}`,
      `(?:${I18N_MONTHS}) \\d{1,2}(?![\\d,])`,
      "(?:dalam )?\\d+ (?:thn|bln|hari)(?: \\d+ bln)?(?: lalu)?",
      "hari ini",
      `${prefix}[−-]?\\d(?:[\\d.,]*\\d)?%?(?!\\})`,
      `(?<=[(\\s])(?:${currency && !/^\\d/.test(currency) ? `${escapeRegExp(currency)}|` : ""}Rp)(?=\\))`,
    ].join("|") + ")", "gu");
    this.prepared = true;
  },

  /** Turn text into {@}/{#} templates. Returns [template, words, numbers]. */
  templateOf(text, withWords) {
    const words = [];
    const numbers = [];
    let out = text;
    if (withWords && this.wordPattern) {
      out = out.replace(this.wordPattern, match => {
        words.push(match);
        return "\u0001";
      });
    }
    const runs = [...out.matchAll(/\u0001(?:, \u0001)+/g)];
    for (const run of runs.reverse()) {
      const start = (out.slice(0, run.index).match(/\u0001/g) || []).length;
      const count = (run[0].match(/\u0001/g) || []).length;
      words.splice(start, count, words.slice(start, start + count).join(", "));
      out = out.slice(0, run.index) + "\u0001" + out.slice(run.index + run[0].length);
    }
    out = out.replace(this.numberPattern, match => {
      numbers.push(match);
      return "{#}";
    });
    return [out.replace(/\u0001/g, "{@}"), words, numbers];
  },
  /** Put values back into a translation, translating any of the couple's words that are app phrases. */
  fill(translation, words, numbers) {
    let w = 0;
    let n = 0;
    return translation
      .replace(/\{@(\d*)\}/g, (_, index) => {
        const word = index ? words[Number(index) - 1] : words[w++];
        return word === undefined ? "" : (I18N.id[word] || word);
      })
      .replace(/\{#(\d*)\}/g, (_, index) => {
        const number = index ? numbers[Number(index) - 1] : numbers[n++];
        return number === undefined ? "" : number;
      });
  },
  /** Look a (whitespace-normalised) text up: exact, then with numbers, then with the couple's words. */
  lookup(text) {
    const dict = I18N.id;
    if (dict[text] !== undefined) return dict[text];
    const [numbersOnly, , numbers] = this.templateOf(text, false);
    if (dict[numbersOnly] !== undefined) return this.fill(dict[numbersOnly], [], numbers);
    const [full, words, values] = this.templateOf(text, true);
    if (dict[full] !== undefined) return this.fill(dict[full], words, values);
    if (/[A-Za-z]{2}/.test(full.replace(/\{[@#\d]*\}/g, ""))) this.missing.add(full);
    return null;
  },
  /** Translate one string (toasts, confirms). Unknown strings are returned unchanged. */
  text(value) {
    if (this.lang !== "id" || typeof value !== "string" || !value.trim() || this.produced.has(value)) return value;
    this.prepare();
    const lead = value.match(/^\s*/)[0];
    const trail = value.match(/\s*$/)[0];
    const result = this.lookup(value.trim().replace(/\s+/g, " "));
    if (result === null) return value;
    const out = lead + result + trail;
    if (this.produced.size > 500) this.produced.clear();
    this.produced.add(out);
    return out;
  },

  translateBlock(el) {
    if (el.__i18nOut !== undefined && el.__i18nOut === el.textContent) return;
    const children = [];
    const iconsBefore = [];
    const iconsAfter = [];
    let key = "";
    let seenText = false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        key += node.nodeValue;
        if (node.nodeValue.trim()) seenText = true;
      } else if (node.nodeType === 1) {
        if (node.tagName.toLowerCase() === "svg" && !node.textContent.trim()) {
          (seenText ? iconsAfter : iconsBefore).push(node);
        } else {
          key += `{${children.length}}`;
          children.push(node);
        }
      }
    }
    const lead = /^\s/.test(key) ? " " : "";
    const trail = /\s$/.test(key) ? " " : "";
    const translated = this.lookup(key.trim().replace(/\s+/g, " "));
    if (translated === null) return;
    const parts = translated.split(/\{(\d)\}/);
    const fragment = document.createDocumentFragment();
    iconsBefore.forEach(node => fragment.appendChild(node));
    parts.forEach((part, index) => {
      if (index % 2) {
        const child = children[Number(part)];
        if (child) fragment.appendChild(child);
      } else {
        const text = (index === 0 ? lead : "") + part + (index === parts.length - 1 ? trail : "");
        if (text) fragment.appendChild(document.createTextNode(text));
      }
    });
    iconsAfter.forEach(node => fragment.appendChild(node));
    el.textContent = "";
    el.appendChild(fragment);
    el.__i18nOut = el.textContent;
  },
  translateTextNode(node) {
    if (node.__i18nOut !== undefined && node.__i18nOut === node.nodeValue) return;
    const value = node.nodeValue;
    if (!value.trim()) return;
    const translated = this.lookup(value.trim().replace(/\s+/g, " "));
    if (translated === null) return;
    node.nodeValue = value.match(/^\s*/)[0] + translated + value.match(/\s*$/)[0];
    node.__i18nOut = node.nodeValue;
  },
  translateAttributes(el) {
    for (const attr of I18N_ATTRS) {
      const value = el.getAttribute(attr);
      if (!value || !value.trim()) continue;
      const done = el.__i18nAttrs || (el.__i18nAttrs = {});
      if (done[attr] === value) continue;
      const translated = this.lookup(value.trim().replace(/\s+/g, " "));
      if (translated !== null) {
        el.setAttribute(attr, translated);
        done[attr] = translated;
      }
    }
  },
  /** Translate everything under `root` (no-op in English). */
  translate(root) {
    if (!root) return;
    document.documentElement.lang = this.lang;
    if (this.lang !== "id") return;
    this.prepare();
    const elements = [root, ...root.querySelectorAll("*")];
    for (const el of elements) {
      if (I18N_SKIP.has(el.tagName) || el.closest('[translate="no"]')) {
        if (el.tagName === "INPUT") this.translateAttributes(el);
        continue;
      }
      this.translateAttributes(el);
      let hasText = false;
      let allInline = true;
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.nodeValue.trim()) hasText = true;
        else if (node.nodeType === 1 && !I18N_INLINE.has(node.tagName) && node.tagName.toLowerCase() !== "svg") allInline = false;
      }
      if (!hasText) continue;
      if (allInline) {
        this.translateBlock(el);
      } else {
        for (const node of [...el.childNodes]) {
          if (node.nodeType === 3) this.translateTextNode(node);
        }
      }
    }
  },
};
