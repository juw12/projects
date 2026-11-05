// Golden parity for the web screenshot sorter (web/app/js/classifier.js).
// Same golden file as the Swift tests and prototypes/tidy/tidy.py. Run: node classifier_parity.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const haru = path.resolve(here, "..");

globalThis.fetch = async (url) => {
  const text = await readFile(path.join(haru, "web", "app", url), "utf8");
  return { json: async () => JSON.parse(text) };
};

const { ClipClassifier, findExpiry } = await import(pathToFileURL(path.join(haru, "web/app/js/classifier.js")).href);
const classifier = await ClipClassifier.load("clip_lexicon.json");
const golden = JSON.parse(await readFile(path.join(haru, "prototypes/tidy/expected.json"), "utf8"));
const [year, month, day] = golden.today.split("-").map(Number);
const today = new Date(year, month - 1, day);

const iso = (date) =>
  date === null
    ? null
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const failures = [];
for (const testCase of golden.cases) {
  const { drawer, score } = classifier.classify(testCase.text);
  const expiry = iso(findExpiry(testCase.text, today));
  if (drawer !== testCase.drawer || Math.abs(score - testCase.score) > 1e-9 || expiry !== testCase.expiry) {
    failures.push({ text: testCase.text.slice(0, 40), want: [testCase.drawer, testCase.score, testCase.expiry], got: [drawer, score, expiry] });
  }
}
console.log(JSON.stringify({ cases: golden.cases.length, failures }));
process.exit(failures.length ? 1 : 0);
