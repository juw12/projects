// Tests for apps/sortie/web/js/core.js (a classic browser script), run with plain Node.
// core.js is evaluated in a vm context with tiny document/localStorage stubs, and its helpers are
// read back from that context. Covers naming/sanitising, file typing, smart-rule buckets and the
// duplicate detector that decides which files the "clean up copies" action may remove.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../web/js/core.js", import.meta.url), "utf8");

function loadCore(savedSettings) {
  const store = new Map(savedSettings === undefined ? [] : [["sortie.settings", savedSettings]]);
  const context = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  };
  context.window = context;
  vm.createContext(context);
  const exported = "fmtSize sanitizeFolderName sanitizeFileName splitName extOf typeOf kindLabel bucketOf " +
    "ruleRegex duplicateIds escapeHtml isoDate hashHue settings DEFAULT_SETTINGS saveSettings";
  vm.runInContext(`${source}\n;globalThis.__core = { ${exported.split(" ").join(", ")} };`, context, { filename: "core.js" });
  return { core: context.__core, store };
}

const { core } = loadCore();
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("fmtSize picks the right unit and precision", () => {
  assert.equal(core.fmtSize(0), "0 B");
  assert.equal(core.fmtSize(1023), "1023 B");
  assert.equal(core.fmtSize(1536), "1.5 KB");
  assert.equal(core.fmtSize(25 * 1048576), "25 MB");
  assert.equal(core.fmtSize(3 * 1024 ** 4), "3.0 TB");
});

test("folder and file names are made safe for the disk", () => {
  assert.equal(core.sanitizeFolderName('  ..My:  "Tax"/2026*  '), "My Tax2026");
  assert.equal(core.sanitizeFolderName("x".repeat(100)).length, 60);
  assert.equal(core.sanitizeFolderName(null), "");
  assert.equal(core.sanitizeFileName('a<b>c|d?.txt'), "a_b_c_d_.txt");
  assert.equal(core.sanitizeFileName("../../etc/passwd"), ".._.._etc_passwd", "no path separators survive");
});

test("splitName and extOf handle dotfiles and no extension", () => {
  assert.deepEqual([...core.splitName("report.final.pdf")], ["report.final", ".pdf"]);
  assert.deepEqual([...core.splitName(".bashrc")], [".bashrc", ""]);
  assert.deepEqual([...core.splitName("README")], ["README", ""]);
  assert.equal(core.extOf("Photo.JPG"), "jpg");
  assert.equal(core.extOf(".env"), "");
});

test("file types and Finder-style kind labels", () => {
  assert.equal(core.typeOf("part.STEP").name, "3D & CAD");
  assert.equal(core.typeOf("song.flac").name, "Audio");
  assert.equal(core.typeOf("mystery.xyz").name, "Other");
  assert.equal(core.kindLabel("bracket.step"), "STEP CAD model");
  assert.equal(core.kindLabel("notes"), "File");
});

test("smart mode: rules win over type, folder names are sanitised", () => {
  const settings = core.settings;
  const saved = settings.rules;
  try {
    settings.rules = [{ pattern: "invoice", folder: "Fin/ance" }, { pattern: "(", folder: "Broken" }];
    assert.equal(core.bucketOf({ name: "Invoice-0042.pdf" }, "smart").name, "Finance");
    assert.equal(core.bucketOf({ name: "photo.png" }, "smart").name, "Images");
    // an invalid regex is matched literally instead of throwing
    assert.equal(core.bucketOf({ name: "draft (2).docx" }, "smart").name, "Broken");
  } finally {
    settings.rules = saved;
  }
});

test("date and size buckets", () => {
  const march = new Date(2026, 2, 15).getTime();
  assert.equal(core.bucketOf({ name: "a", modified: march }, "date").name, "2026-03");
  assert.match(core.bucketOf({ name: "a", size: 10 }, "size").name, /^Small/);
  assert.match(core.bucketOf({ name: "a", size: 50 * 1048576 }, "size").name, /^Medium/);
  assert.match(core.bucketOf({ name: "a", size: 200 * 1048576 }, "size").name, /^Large/);
});

test("duplicate detector flags copies but never the original", () => {
  const files = [
    { id: 1, name: "Report.pdf", modified: 5 },
    { id: 2, name: "Report (1).pdf", modified: 6 },
    { id: 3, name: "report copy.pdf", modified: 7 },
    { id: 4, name: "Report.docx", modified: 1 },
    { id: 5, name: "photo_copy 2.jpg", modified: 3 },
    { id: 6, name: "photo (3).jpg", modified: 2 },
    { id: 7, name: "unique.txt", modified: 1 },
  ];
  const ids = core.duplicateIds(files);
  assert.ok(!ids.has(1) && ids.has(2) && ids.has(3), "copies of Report.pdf flagged, original kept");
  assert.ok(!ids.has(4), "same base, different extension is not a duplicate");
  assert.ok(!ids.has(7));
  // when every name looks like a copy, the oldest one is kept
  assert.ok(ids.has(5) && !ids.has(6));
});

test("escapeHtml neutralises markup", () => {
  assert.equal(core.escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("saved settings merge over defaults; corrupt storage falls back", () => {
  const { core: custom } = loadCore(JSON.stringify({ mode: "date", ai: { provider: "ollama" } }));
  assert.equal(custom.settings.mode, "date");
  assert.equal(custom.settings.ai.provider, "ollama");
  assert.equal(custom.settings.ai.jsonMode, true, "missing nested keys come from the defaults");
  assert.equal(custom.settings.rules.length, custom.DEFAULT_SETTINGS.rules.length);
  const { core: broken } = loadCore("{not json");
  assert.equal(broken.settings.mode, "smart");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log("ok   -", name);
  } catch (error) {
    failed += 1;
    console.log("FAIL -", name, "\n   ", error && error.stack || error);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
