// GlowBot's words, checked. A key that is missing shows up in someone's chat as the raw key name,
// and one unclosed <b> makes Telegram refuse the whole message, so both are caught here: the four
// languages must stay in step, every key the code asks for must exist, and every text must be
// markup Telegram accepts and fit its length limits.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS } from "../src/missions.js";
import {
  COMMANDS,
  OWNER_COMMANDS,
  LANGS,
  LANG_NAMES,
  STRING_KEYS,
  commandList,
  escapeHtml,
  isLang,
  pickLang,
  stringsFor,
  t,
  tPlain,
} from "../src/strings.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const WORDS = fs.readFileSync(path.join(SRC, "strings.js"), "utf8");

// Everything in src/ except the word list itself: the code that asks for keys.
const CODE = fs
  .readdirSync(SRC)
  .filter((name) => name.endsWith(".js") && name !== "strings.js")
  .sort()
  .map((name) => fs.readFileSync(path.join(SRC, name), "utf8"))
  .join("\n");

const ENGLISH = stringsFor("en");

// t(lang, "key") and tPlain(lang, "key"), and the same with a choice: t(lang, flag ? "a" : "b")
const ASKED = /\b(t|tPlain)\(\s*[^,()]+,\s*"([^"]+)"/g;
const ASKED_EITHER = /\b(t|tPlain)\(\s*[^,()]+,\s*[^,"`]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g;
// keys put together from a name: t(lang, `mode.${mode}`)
const BUILT = /`([a-z]+(?:\.[a-z]+)*\.)\$\{/g;

const placeholders = (text) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1]).sort();
const tags = (text) => [...text.matchAll(/<[^>]*>/g)].map((match) => match[0]);
const unique = (list) => [...new Set(list)].sort();

// The names that follow a prefix: family("cmd.") -> ["agent", "agents", "apps", ...]
function family(prefix) {
  return STRING_KEYS.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
}

// Every key the code passes straight to t() or tPlain(), split by which of the two it uses.
function askedKeys() {
  const html = new Set();
  const plain = new Set();
  for (const match of CODE.matchAll(ASKED)) (match[1] === "t" ? html : plain).add(match[2]);
  for (const match of CODE.matchAll(ASKED_EITHER)) {
    const bucket = match[1] === "t" ? html : plain;
    bucket.add(match[2]);
    bucket.add(match[3]);
  }
  return { html, plain, all: new Set([...html, ...plain]) };
}

// One tag Telegram's HTML mode takes, or null. Only the four the bot uses are let through.
function readTag(tag) {
  const simple = /^<(\/?)(b|i|code)>$/.exec(tag);
  if (simple) return { name: simple[2], closing: simple[1] === "/" };
  if (tag === "</a>") return { name: "a", closing: true };
  if (/^<a href="[^"<>]+">$/.test(tag)) return { name: "a", closing: false };
  return null;
}

// ---- the four languages stay in step -------------------------------------------------------

test("all four languages carry exactly the same keys", () => {
  assert.deepEqual(LANGS, ["en", "id", "zh-Hans", "zh-Hant"]);
  assert.deepEqual(Object.keys(LANG_NAMES), LANGS);
  assert.ok(STRING_KEYS.length >= 100, "the key list looks cut short");
  assert.equal(new Set(STRING_KEYS).size, STRING_KEYS.length);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(stringsFor(lang)).sort(), [...STRING_KEYS].sort(), `${lang} and English have different keys`);
  }
});

test("no key is written twice in one language", () => {
  // In an object literal the second one would win without a word, so count the lines instead.
  const entries = [...WORDS.matchAll(/^  "([A-Za-z.]+)": /gm)].map((match) => match[1]);
  assert.equal(entries.length, LANGS.length * STRING_KEYS.length);
  assert.deepEqual(unique(entries), [...STRING_KEYS].sort());
});

test("no text is empty, and no translation is a forgotten copy of a long English text", () => {
  for (const lang of LANGS) {
    const table = stringsFor(lang);
    for (const key of STRING_KEYS) {
      assert.equal(typeof table[key], "string", `${lang} ${key}`);
      assert.ok(table[key].trim().length > 0, `${lang} ${key} is empty`);
    }
  }
  // The Chinese texts share no script with English, so a long text that is letter for letter the
  // English one was never translated. (Short ones such as "OK" may well be the same.)
  for (const lang of ["zh-Hans", "zh-Hant"]) {
    const copied = STRING_KEYS.filter((key) => ENGLISH[key].length > 40 && stringsFor(lang)[key] === ENGLISH[key]);
    assert.deepEqual(copied, [], `${lang} still has English text`);
  }
});

test("every translation keeps the placeholders and the tags of the English text", () => {
  for (const lang of LANGS) {
    const table = stringsFor(lang);
    for (const key of STRING_KEYS) {
      assert.deepEqual(placeholders(table[key]), placeholders(ENGLISH[key]), `${lang} ${key}: placeholders`);
      // sorted, because a sentence may put its words (and so its tags) in another order
      assert.deepEqual(tags(table[key]).sort(), tags(ENGLISH[key]).sort(), `${lang} ${key}: tags`);
    }
  }
});

// ---- markup Telegram accepts ---------------------------------------------------------------

test("every text is markup Telegram accepts: known tags, each one closed, nothing stray", () => {
  for (const lang of LANGS) {
    const table = stringsFor(lang);
    for (const key of STRING_KEYS) {
      const where = `${lang} ${key}`;
      const open = [];
      for (const tag of tags(table[key])) {
        const found = readTag(tag);
        assert.ok(found, `${where}: Telegram would refuse ${tag}`);
        // t() escapes & < > only, so a value dropped inside a tag could break out of its quotes
        assert.equal(placeholders(tag).length, 0, `${where}: a placeholder inside ${tag}`);
        if (found.closing) assert.equal(open.pop(), found.name, `${where}: ${tag} closes nothing`);
        else open.push(found.name);
      }
      assert.deepEqual(open, [], `${where}: a tag is never closed`);
      const rest = table[key].replace(/<[^>]*>/g, "").replace(/&(?:lt|gt|amp|quot);/g, "");
      assert.doesNotMatch(rest, /[<>&]/, `${where}: a bare <, > or & (write &lt; &gt; &amp;)`);
    }
  }
});

test("the texts Telegram shows as plain text carry no markup", () => {
  // Toasts, the command menu, the bot's profile and button labels are shown letter for letter,
  // and so is anything fetched with tPlain(): a <b> there would be read out as "<b>".
  const prefixes = ["toast.", "cmd.", "bot.", "btn."];
  for (const prefix of prefixes) assert.ok(family(prefix).length > 0, `no ${prefix}* keys were found`);
  const plain = unique([
    ...STRING_KEYS.filter((key) => prefixes.some((prefix) => key.startsWith(prefix))),
    ...askedKeys().plain,
  ]);
  for (const lang of LANGS) {
    for (const key of plain) {
      assert.doesNotMatch(stringsFor(lang)[key], /[<>&]/, `${lang} ${key} is plain text but carries markup`);
    }
  }
});

// ---- the code and the word list agree -------------------------------------------------------

test("every key the code asks for exists", () => {
  const asked = askedKeys().all;
  assert.ok(asked.size >= 50, "the scan of src/ found too few t() calls to be trusted");
  assert.deepEqual([...asked].filter((key) => !STRING_KEYS.includes(key)), []);

  // Keys also travel through variables (toast("toast.ok"), a title key, a role key), so any quoted
  // "family.name" in the code whose family is one of ours has to be a real key too.
  const families = new Set(STRING_KEYS.filter((key) => key.includes(".")).map((key) => key.split(".")[0]));
  const dotted = unique([...CODE.matchAll(/"([a-z]+(?:\.[a-zA-Z]+)+)"/g)].map((match) => match[1]));
  const lookAlikes = dotted.filter((text) => families.has(text.split(".")[0]) && !STRING_KEYS.includes(text));
  assert.deepEqual(lookAlikes, []);
});

test("every key is asked for somewhere: no text is left over", () => {
  const quoted = new Set([...CODE.matchAll(/"([A-Za-z.]+)"/g)].map((match) => match[1]));
  const built = unique([...CODE.matchAll(BUILT)].map((match) => match[1]));
  // cmd.* is built inside strings.js itself, by commandList()
  assert.deepEqual(built, ["agent.role.", "board.phase.", "board.state.", "every.last.", "mode."]);
  assert.match(WORDS, /`cmd\.\$\{command\}`/);
  const prefixes = [...built, "cmd."];
  const leftOver = STRING_KEYS.filter((key) => !quoted.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)));
  assert.deepEqual(leftOver, []);
});

test("the keys built from a name cover exactly the names the code uses", () => {
  // A new mode, job phase, job state, agent or command without its text would show the raw key.
  const modes = /const MODES = (\[[^\]]+\]);/.exec(CODE);
  assert.ok(modes, "MODES was not found in the code");
  const phases = unique([...CODE.matchAll(/\bjob\.phase = "([a-z]+)"/g)].map((match) => match[1]));
  const states = unique([...CODE.matchAll(/\b(?:job|current)\.status = "([a-z]+)"/g)].map((match) => match[1]));
  assert.ok(phases.length >= 2 && states.includes("active"), "the scan for job phases and states found too little");

  assert.deepEqual(family("cmd."), [...COMMANDS, ...OWNER_COMMANDS].sort());
  assert.deepEqual(family("agent.role."), Object.values(AGENTS).map((agent) => agent.key).sort());
  assert.deepEqual(family("mode.").filter((name) => name !== "set"), JSON.parse(modes[1]).sort());
  assert.deepEqual(family("board.phase."), phases);
  // a running job shows its phase; every other state has a text of its own
  assert.deepEqual(family("board.state."), states.filter((state) => state !== "active"));
});

// ---- Telegram's limits ----------------------------------------------------------------------

test("the texts Telegram limits in length fit in every language", () => {
  for (const lang of LANGS) {
    const table = stringsFor(lang);
    assert.ok(table["bot.short"].length <= 120, `${lang}: the short description has ${table["bot.short"].length} characters`);
    assert.ok(table["bot.description"].length <= 512, `${lang}: the description has ${table["bot.description"].length} characters`);
    for (const name of family("toast.")) {
      assert.ok(table[`toast.${name}`].length <= 200, `${lang}: toast.${name} is too long for a toast`);
    }
    for (const name of family("btn.")) {
      assert.ok(table[`btn.${name}`].length <= 40, `${lang}: btn.${name} would not fit on a button`);
    }
  }
});

test("the command menu is one Telegram accepts, in every language", () => {
  assert.equal(new Set(COMMANDS).size, COMMANDS.length);
  for (const lang of LANGS) {
    const menu = commandList(lang);
    assert.deepEqual(menu.map((entry) => entry.command), COMMANDS);
    for (const { command, description } of menu) {
      assert.match(command, /^[a-z0-9_]{1,32}$/);
      assert.equal(description, stringsFor(lang)[`cmd.${command}`]);
      assert.ok(description.length >= 1 && description.length <= 256, `${lang}: /${command} has ${description.length} characters`);
    }
  }
  assert.deepEqual(commandList("fr"), commandList("en"));
});

// ---- t() and tPlain() -----------------------------------------------------------------------

test("t() escapes what it drops in and tPlain() leaves it alone", () => {
  const key = STRING_KEYS.find((candidate) => placeholders(ENGLISH[candidate]).length === 1);
  const [name] = placeholders(ENGLISH[key]);
  const nasty = '<b>Tom & "Jerry"</b>';

  assert.equal(t("en", key, { [name]: nasty }), ENGLISH[key].replace(`{${name}}`, '&lt;b&gt;Tom &amp; "Jerry"&lt;/b&gt;'));
  assert.equal(tPlain("en", key, { [name]: nasty }), ENGLISH[key].replace(`{${name}}`, nasty));
  assert.equal(t("en", key, { [name]: 7 }), ENGLISH[key].replace(`{${name}}`, "7"));
  assert.equal(t("en", key, { [name]: null }), ENGLISH[key].replace(`{${name}}`, ""));

  // a value that looks like a placeholder is not filled in a second time
  assert.equal(tPlain("en", key, { [name]: `{${name}}` }), ENGLISH[key]);
});

test("a placeholder nobody filled stays as written", () => {
  const key = STRING_KEYS.find((candidate) => placeholders(ENGLISH[candidate]).length === 1);
  assert.equal(t("en", key), ENGLISH[key]);
  assert.equal(t("en", key, {}), ENGLISH[key]);
  assert.equal(t("en", key, { somethingElse: "x" }), ENGLISH[key]);
  assert.equal(tPlain("en", key), ENGLISH[key]);
});

test("an unknown key comes back as the key, and an unknown language as English", () => {
  assert.equal(t("en", "no.such<key>"), "no.such&lt;key&gt;");
  assert.equal(tPlain("en", "no.such<key>"), "no.such<key>");
  // names every object has are not keys
  assert.equal(t("en", "constructor"), "constructor");
  assert.equal(tPlain("id", "toString"), "toString");

  for (const lang of ["fr", "", undefined, "constructor", "EN"]) {
    assert.equal(t(lang, "help"), ENGLISH.help);
    assert.equal(tPlain(lang, "bot.short"), ENGLISH["bot.short"]);
  }
  assert.equal(t("id", "help"), stringsFor("id").help);
  assert.notEqual(stringsFor("id").help, ENGLISH.help);
});

test("escapeHtml() escapes the three characters Telegram cares about, once", () => {
  assert.equal(escapeHtml("<a & b>"), "&lt;a &amp; b&gt;");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  assert.equal(escapeHtml('say "hi"'), 'say "hi"');
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
});

// ---- picking a language ---------------------------------------------------------------------

test("pickLang() maps what Telegram sends to one of the four languages", () => {
  const cases = {
    en: ["en", "en-US", "EN", "fr", "de", "ja", "indonesian", "", "   "],
    id: ["id", "ID", "id-ID", "id_ID", "in", "ms", "ms-MY", " id "],
    "zh-Hans": ["zh", "zh-CN", "zh-cn", "zh-hans", "zh-Hans-CN", "zh_Hans", "zh-SG"],
    "zh-Hant": ["zh-TW", "zh-tw", "zh-HK", "zh-MO", "zh-hant", "zh-Hant-TW", "zh_Hant_HK"],
  };
  for (const [expected, codes] of Object.entries(cases)) {
    for (const code of codes) assert.equal(pickLang(code), expected, JSON.stringify(code));
  }
  for (const nothing of [undefined, null, 0, false]) assert.equal(pickLang(nothing), "en");
  for (const lang of LANGS) assert.equal(pickLang(lang), lang);
});

test("isLang() knows only the four exact codes", () => {
  for (const lang of LANGS) assert.equal(isLang(lang), true);
  for (const other of ["zh", "EN", "zh-hans", "fr", "", undefined, null]) assert.equal(isLang(other), false);
});
